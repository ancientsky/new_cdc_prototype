// 智慧問答查詢紀錄的「HTTP 模擬後端」（第四十一輪；說明見 docs/ask-log.md）：scripts/serve.mjs 掛載，開發時用。
//
// 它是正式收件端點的「契約替身」：請求格式、回應碼、驗證與遮蔽規則都照正式版該有的樣子做；
// 正式版只要換掉本檔背後的儲存（這裡是 .local/ask-log/ 的 NDJSON 日檔），前端 src/client/answer/log.js 不必改。
//
// 端點
//   POST /api/ask-log                 本體＝一筆 JSON（Content-Type 可為 text/plain 或 application/json；前端用 text/plain 避免跨網域預檢）
//                                     → 204（無內容）。錯誤格式 { error: '代碼' }：
//                                       400 bad_json／invalid（沒有問句）、403 forbidden（跨站 Origin）、405 method、
//                                       413 too_large（本體 > 2 KB）、415 unsupported、429 rate（附 Retry-After）、503 full（當日檔過大）
//   GET  /api/dev/ask-log/report      只給本機（loopback）：回傳彙整報表（與 npm run ask-log:report 同一個函式）；?min=K 調整門檻
//                                     非本機 → 403；/api/dev/ask-log/ 底下其他路徑 → 404
//
// 為什麼伺服器端還要再驗證、再遮蔽一次（前端已遮蔽過）：前端程式在使用者的瀏覽器裡，任何人都能繞過它直接 POST。
//   收件端必須自己保證「存下來的東西一定已遮蔽、一定只有允許的欄位」，不能信任前端。正式端點也必須照做。
//   - 欄位白名單（ALLOWED）：其他鍵一律丟掉；每個欄位檢查型別、格式與長度，不合格的設成 null。
//   - 問句：maskPII（與引擎同一份規則，src/client/answer/text.js）、去控制字元、空白合併、截到 200 字。
//   - 時間：用伺服器自己的時間、只到分鐘（不採信前端的 t，避免時鐘偏差，也少一個可指認個人的細節）。
//   - 不存 IP、User-Agent、Referer、cookie。IP 只在記憶體裡做節流（每分鐘 30 筆），不寫檔。
//     第六十二輪（Issue #140）：改用共用的 rate-limit.mjs（記憶體有上限但不會「整個清空」——舊版超過一萬個 IP 就清空，等於讓灌假 IP 的人重設所有計數），
//     門檻由 60 降為 30：一位民眾一分鐘問不到 30 題，這支信標是匿名、免登入的寫入端點，最容易被拿來灌假紀錄、污染「查無結果」報表。
// 保存期限：每次寫入時順手刪掉超過 retentionDays（預設 90，ASK_LOG_RETENTION_DAYS）天的日檔。
// 儲存：.local/ask-log/YYYY-MM-DD.ndjson（臺灣日期；.local/ 已在 .gitignore，絕不進版控）。
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../../site.config.mjs';
import { maskPII } from '../../src/client/answer/text.js';
import { askLogSetting } from './forms.mjs';
import { MOCK_COOKIE } from '../../src/client/answer/log.js';
import { DEFAULT_DIR, reportFromDir, taipeiDate } from './ask-log-report.mjs';
import { createRateLimiter, clientKey, tooMany } from './rate-limit.mjs';

export const MAX_BODY = 2 * 1024;
export const MAX_DAY_BYTES = 20 * 1024 * 1024;
export const RATE = { windowMs: 60_000, max: 30 };
const OUTCOMES = new Set(['answered', 'low-relevance', 'stats', 'no-match', 'no-source', 'refused', 'paused']);
const LOOPBACK = /^(::1|127\.\d+\.\d+\.\d+|::ffff:127\.\d+\.\d+\.\d+)$/;

/** 欄位白名單與各自的清洗規則：回傳清洗後的值，不合格回傳 null */
const str = (re, max) => (v) => (typeof v === 'string' && v.length <= max && re.test(v) ? v : null);
export const ALLOWED = {
  lang: str(/^[a-z]{2,3}(-[A-Z]{2})?$/, 10),
  view: (v) => (v === 'public' || v === 'pro' ? v : null),
  outcome: (v) => (OUTCOMES.has(v) ? v : null),
  refusalKind: str(/^[a-z][a-z0-9-]*$/, 40),
  intent: str(/^[a-z][a-z0-9_.-]*$/, 40),
  disease: str(/^disease\.[a-z0-9-]+$/, 60),
  relevance: (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1 ? Math.round(v * 100) / 100 : null),
  top: (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && /^[\w.:#/-]{1,80}$/.test(x)).slice(0, 3) : []),
  page: (v) => (typeof v === 'string' && v.startsWith('/') ? v.split(/[?#]/)[0].slice(0, 200) : null),
  ev: str(/^[\w.+-]*$/, 40),
};

/** 問句清洗：遮蔽個資（伺服器端再做一次）、去控制字元、空白合併、截 200 字 */
export function cleanQuery(q) {
  if (typeof q !== 'string') return '';
  return maskPII(q.slice(0, 1000))
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

/** 一筆請求本體 → 要寫入的紀錄（沒有問句回傳 null）。未知欄位丟掉；t 用伺服器時間到分鐘 */
export function sanitizeEvent(body, now = new Date()) {
  const q = cleanQuery(body?.q);
  if (!q) return null;
  const out = { v: 1, q };
  for (const [k, fn] of Object.entries(ALLOWED)) out[k] = fn(body[k]);
  out.outcome ??= 'answered';
  out.t = `${now.toISOString().slice(0, 16)}Z`;
  return out;
}

/** 刪掉超過保存天數的日檔（檔名日期 < 今天 − days） */
export function pruneOld(dir, days, now = new Date()) {
  if (!fs.existsSync(dir)) return [];
  const cutoff = taipeiDate(new Date(now.getTime() - days * 86400_000).toISOString());
  const removed = [];
  for (const f of fs.readdirSync(dir)) {
    const m = /^(\d{4}-\d{2}-\d{2})\.ndjson$/.exec(f);
    if (m && m[1] < cutoff) {
      fs.rmSync(path.join(dir, f), { force: true });
      removed.push(f);
    }
  }
  return removed;
}

export function createAskLogApi({
  dir = process.env.ASK_LOG_DIR || DEFAULT_DIR,
  retentionDays = askLogSetting(config).retentionDays,
  now = () => new Date(),
  rate = RATE,
  devReport = true,
  contentDir,
  trustedProxies = [],
} = {}) {
  // ip → 時間戳，只在記憶體（rate-limit.mjs）；rate: null ⇒ 不限流（只給測試）
  const limiter = rate ? createRateLimiter({ ...rate, now: () => now().getTime() }) : null;
  let lastPrune = '';

  async function readBody(req) {
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > MAX_BODY) throw Object.assign(new Error('too large'), { code: 'too_large' });
      chunks.push(c);
    }
    const type = String(req.headers['content-type'] ?? '')
      .split(';')[0]
      .trim()
      .toLowerCase();
    if (type && type !== 'text/plain' && type !== 'application/json') throw Object.assign(new Error('unsupported'), { code: 'unsupported' });
    try {
      const j = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (j && typeof j === 'object' && !Array.isArray(j)) return j;
    } catch {
      /* 落到下面 */
    }
    throw Object.assign(new Error('bad json'), { code: 'bad_json' });
  }

  /** 處理請求；不是本模組的路徑回傳 false（交給下一個處理者）。pathname 已去掉 basePath。 */
  async function handle(req, res, pathname, searchParams = new URLSearchParams()) {
    const isLog = pathname === '/api/ask-log';
    const isDev = pathname === '/api/dev/ask-log' || pathname.startsWith('/api/dev/ask-log/');
    if (!isLog && !isDev) return false;
    const json = (status, body, headers = {}) => {
      res.statusCode = status;
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
      if (body == null) res.end();
      else {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify(body));
      }
      return true;
    };
    const method = req.method ?? 'GET';
    const ip = String(req.socket?.remoteAddress ?? 'unknown');

    if (isDev) {
      if (!devReport) return json(404, { error: 'notfound' });
      if (!LOOPBACK.test(ip)) return json(403, { error: 'forbidden' });
      if (pathname !== '/api/dev/ask-log/report') return json(404, { error: 'notfound' });
      if (method !== 'GET') return json(405, { error: 'method' }, { Allow: 'GET' });
      const min = Number(searchParams.get('min')) || undefined;
      return json(200, reportFromDir(dir, { minCount: min, contentDir, now: now() }));
    }

    if (method !== 'POST') return json(405, { error: 'method' }, { Allow: 'POST' });
    // 同源檢查：瀏覽器的跨站 POST 會帶 Origin；不同源一律拒絕（模擬後端只收本站頁面送來的紀錄）
    const o = req.headers.origin;
    if (o === 'null') return json(403, { error: 'forbidden' });
    if (o) {
      let host = '';
      try {
        host = new URL(o).host;
      } catch {
        /* 無效 Origin 視為不同源 */
      }
      if (host !== req.headers.host) return json(403, { error: 'forbidden' });
    }
    const t = now();
    // 讀本體之前限流；放在反向代理後面時，只有連線來自 trustedProxies 才採信 X-Forwarded-For（否則攻擊者自己選 key）
    const r = limiter?.hit(clientKey(req, { trustedProxies }));
    if (r && !r.ok) return tooMany(res, r.retryAfterSec, { req, error: 'rate' });
    try {
      const ev = sanitizeEvent(await readBody(req), t);
      if (!ev) return json(400, { error: 'invalid' });
      fs.mkdirSync(dir, { recursive: true });
      const day = taipeiDate(t.toISOString());
      const file = path.join(dir, `${day}.ndjson`);
      if (fs.existsSync(file) && fs.statSync(file).size > MAX_DAY_BYTES) return json(503, { error: 'full' });
      fs.appendFileSync(file, `${JSON.stringify(ev)}\n`);
      if (lastPrune !== day) {
        pruneOld(dir, retentionDays, t);
        lastPrune = day;
      }
      return json(204, null);
    } catch (e) {
      if (e?.code === 'too_large') return json(413, { error: 'too_large' });
      if (e?.code === 'bad_json') return json(400, { error: 'bad_json' });
      if (e?.code === 'unsupported') return json(415, { error: 'unsupported' });
      console.error('[ask-log-mock]', e?.message ?? e);
      return json(500, { error: 'server' });
    }
  }

  // 標記 cookie：serve.mjs 回應靜態檔時帶上，前端 log.js 看到它才知道「這裡有模擬後端」（GitHub Pages 等純靜態伺服器沒有，就不送）
  const cookie = `${MOCK_COOKIE}=1; Path=/; SameSite=Strict`;
  return { handle, dir, retentionDays, cookie };
}
