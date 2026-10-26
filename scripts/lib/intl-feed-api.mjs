// 國際重要疫情資訊的推送端點（docs/intl-epidemic.md 第 2 節做法 C、第 6 節）：疫情中心系統核定一則時，呼叫這支 webhook，網站分鐘級上架。
// scripts/serve.mjs 掛在寫入閘道之後；與排程拉取、後台貼上走同一個匯入器與同一套把關（scripts/lib/intl-epidemic-publish.mjs）。
//
// 端點
//   GET  /api/intl-epidemic/health   → { ok: true, enabled }（enabled＝伺服器有設定 INTL_FEED_TOKEN）
//   POST /api/intl-epidemic          Authorization: Bearer <INTL_FEED_TOKEN>
//                                    Content-Type: application/json（交換格式 v1 或現行官網匯出的每列格式）或 text/csv（與 v1 等價的 CSV）
//                                    查詢參數（選填）：mode=full|delta（覆寫資料本身的 mode）、dry=1（只檢查不寫）
//     → 200 { ok, held:false, noop, changes:{new,updated,withdrawn,unchanged}, rejected:[…], unmapped:[…], message, report }
//     → 202 同上但 held:true（整批保留不動：快照沒改，只記匯入紀錄；heldReasons 說明理由）
//     錯誤 { error, message }：400 bad_feed／bad_json（看不懂）、401 unauthorized、413 too_large（> 2 MB）、415 unsupported、
//                              429 rate（附 Retry-After）、503 disabled（沒設 INTL_FEED_TOKEN）
//
// 安全
//   - 權杖比對用 timingSafeEqual（先各自做 SHA-256，長度不同也不會提早結束）；權杖、Authorization 標頭與本文都不寫進 log 或稽核。
//   - 每個來源 IP 每分鐘最多 RATE.max 次（含認證失敗的嘗試，擋暴力猜測）；只在記憶體計數。
//     第六十三輪（Issue #140）：改用共用的 rate-limit.mjs，門檻 30／分鐘；而且在「有沒有設定權杖」與「權杖對不對」之前判斷——
//     猜權杖的人先碰到 429，每分鐘最多試 30 次；未啟用時也不讓人用 503 的回應來高速確認端點存在。
//   - 本體超過上限時「讀完再回 413」：中途中斷讀取會毀掉請求串流，客戶端只看到連線被重設（ARCHITECTURE §36、gateway/index.mjs readBody 的註解）。
//   - 這支端點不吃 cookie、不看 Origin：它不是給瀏覽器用的，認證只靠 Bearer 權杖（因此也沒有 CSRF 問題）。
import crypto from 'node:crypto';
import { publishFeed, PublishError } from './intl-epidemic-publish.mjs';
import { createRateLimiter, clientKey, tooMany } from './rate-limit.mjs';

export const MAX_BODY = 2 * 1024 * 1024;
export const RATE = { windowMs: 60_000, max: 30 };
const PATH = '/api/intl-epidemic';
const digest = (s) => crypto.createHash('sha256').update(String(s)).digest();

/**
 * @param {{ token?: string, gitProvider?: any, audit?: any, snapshotsDir?: string, now?: () => number, rate?: {windowMs:number,max:number} | null, today?: string, trustedProxies?: string[] }} [opts]
 */
export function createIntlFeedApi({
  token = process.env.INTL_FEED_TOKEN,
  gitProvider,
  audit,
  snapshotsDir,
  now = () => Date.now(),
  rate = RATE,
  today,
  trustedProxies = [],
} = {}) {
  const secret = typeof token === 'string' && token.trim() ? digest(token.trim()) : null;
  const limiter = rate ? createRateLimiter({ ...rate, now }) : null; // ip → 時間戳，只在記憶體

  const send = (res, status, body, headers = {}) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
    res.end(JSON.stringify(body));
    return true;
  };
  /** 不讀本體就回應時，先把串流放掉（丟棄），連線才能繼續用 */
  const reject = (req, res, status, error, message, headers) => {
    req.resume();
    return send(res, status, { error, message }, headers);
  };

  function authorized(req) {
    const m = /^Bearer\s+(\S+)\s*$/i.exec(String(req.headers.authorization ?? ''));
    if (!m || !secret) return false;
    return crypto.timingSafeEqual(digest(m[1]), secret);
  }

  async function readText(req) {
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size <= MAX_BODY) chunks.push(c);
    }
    if (size > MAX_BODY) throw new PublishError(413, 'too_large', `內容太大（上限 ${MAX_BODY / 1024 / 1024} MB）：請改用 mode=delta 只送有變動的則，或分批送`);
    return Buffer.concat(chunks).toString('utf8');
  }

  /** 不是 /api/intl-epidemic 開頭就回 false。pathname 已去掉 basePath。 */
  async function handle(req, res, pathname, searchParams) {
    if (pathname !== PATH && !pathname.startsWith(`${PATH}/`)) return false;
    const method = req.method ?? 'GET';
    if (pathname === `${PATH}/health`) {
      if (method !== 'GET') return reject(req, res, 405, 'method', '只支援 GET');
      return send(res, 200, { ok: true, enabled: !!secret });
    }
    if (pathname !== PATH) return reject(req, res, 404, 'notfound', '找不到');
    if (method !== 'POST') return reject(req, res, 405, 'method', '請用 POST 送資料', { Allow: 'POST' });
    // 先限流，再看有沒有啟用、權杖對不對（理由見檔頭）。訊息不說門檻，避免給猜權杖的人調整速度的線索
    const ip = clientKey(req, { trustedProxies });
    const r = limiter?.hit(ip);
    if (r && !r.ok)
      return tooMany(res, r.retryAfterSec, { req, error: 'rate', headers: { 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'" } });
    if (!secret)
      return reject(
        req,
        res,
        503,
        'disabled',
        '推送端點尚未啟用：伺服器沒有設定 INTL_FEED_TOKEN 環境變數。請資訊室設定一組長隨機字串（例：openssl rand -hex 32）後重啟服務，並把同一組交給疫情中心的系統。',
      );
    if (!authorized(req)) {
      audit?.write?.('intl-push-auth', { result: 'denied', detail: { ip } });
      return reject(req, res, 401, 'unauthorized', '權杖不對或沒有帶：請在 Authorization 標頭帶 Bearer <INTL_FEED_TOKEN>', {
        'WWW-Authenticate': 'Bearer realm="intl-epidemic"',
      });
    }
    const type = String(req.headers['content-type'] ?? '')
      .split(';')[0]
      .trim()
      .toLowerCase();
    if (type !== 'application/json' && type !== 'text/csv')
      return reject(req, res, 415, 'unsupported', 'Content-Type 請用 application/json（交換格式 v1 或現行官網匯出格式）或 text/csv');
    const mode = searchParams?.get('mode') ?? undefined;
    const dry = ['1', 'true'].includes(String(searchParams?.get('dry') ?? ''));
    try {
      const text = await readText(req);
      let feed = text;
      if (type === 'application/json') {
        try {
          feed = JSON.parse(text.replace(/^﻿/, ''));
        } catch {
          throw new PublishError(400, 'bad_json', '看不懂這份資料：不是合法的 JSON');
        }
      }
      const out = await publishFeed({
        feed,
        ...(type === 'text/csv' ? { shape: 'csv' } : {}),
        source: 'push',
        ...(mode ? { mode: /** @type {any} */ (mode) } : {}),
        dry,
        git: gitProvider,
        audit,
        ...(snapshotsDir ? { snapshotsDir } : {}),
        ...(today ? { today } : {}),
      });
      return send(res, out.held ? 202 : 200, out);
    } catch (e) {
      if (e instanceof PublishError) return send(res, e.status, { error: e.code, message: e.message });
      console.error('[intl-feed] 處理失敗：', e?.message ?? e);
      return send(res, 500, { error: 'server', message: '系統暫時無法處理，請稍後再送；若持續發生請洽資訊室' });
    }
  }

  return { handle, enabled: !!secret, MAX_BODY };
}
