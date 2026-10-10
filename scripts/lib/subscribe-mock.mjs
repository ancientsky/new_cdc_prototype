// 電子報訂閱的「HTTP 模擬後端」（第二十八輪，Issue #38）：scripts/serve.mjs 掛載，開發時用。
//
// 它是正式寄信服務的「契約替身」：端點、狀態機、錯誤碼都照正式版該有的樣子做，正式版只要換掉本檔背後的儲存與寄信，
// 前端（src/client/subscribe.js 的 backend 介面）不必改。契約全文見 docs/deploy.md〈電子報寄信服務〉。
//
// 端點（皆 JSON；錯誤格式 { error: '代碼', fields?: {...} }）
//   GET  /api/health                         → { ok, service:'cdc-prototype-subscriptions', mode:'mock-http' }（前端用它偵測「有沒有後端」）
//   POST /api/subscriptions                  { email, topics[], frequency, lang, consent:true } → 202 { status:'pending' }（寄確認信）
//   GET  /api/subscriptions/confirm?token=   → 200 { status:'confirmed', manageToken, … }（可重複呼叫，冪等）
//   GET  /api/subscriptions/status?token=    → 200 { status, email(遮罩), topics, frequency, lang }（token＝manageToken）
//   POST /api/subscriptions/update           { token, topics[], frequency, lang } → 200
//   POST /api/subscriptions/unsubscribe      token 放 JSON、form 或 ?token=（RFC 8058 一鍵退訂：body 為 List-Unsubscribe=One-Click）→ 200
//   POST /api/subscriptions/manage-link      { email } → 202（不論信箱是否存在都回同樣內容，不洩漏誰訂閱了）
//   GET  /api/dev/outbox[/檔名]              只給本機（loopback）：列出／讀取模擬寄出的 .eml
//
// 安全與濫用防護（模擬版也做，因為正式版需要同樣的行為）
//   - 伺服器端重新驗證所有欄位（src/client/subscribe-rules.js，與前端同一份規則）；token 必須是 UUID 形狀才查表
//   - 蜜罐欄位 website：有值就假裝成功、什麼都不存
//   - 簡易節流：每個來源 IP 與每個信箱各自的滑動視窗（超過回 429 + Retry-After），避免被拿來對別人信箱灌確認信
//   - 對外回應不洩漏信箱是否已訂閱（一律 202 同樣內容）；錯誤訊息不回顯使用者輸入
//   - POST 檢查 Origin／Host 同源（Origin 存在時）；本體 ≤ 8 KB；儲存筆數與 outbox 檔數有上限
//   - 儲存：.local/subscriptions.json（git 忽略）；未確認超過 7 天的資料寫入時自動清掉（資料最小化）
// 注意：本模擬為了方便 IT 檢視，token 以明碼存檔；正式版應只存雜湊（見 docs/deploy.md）。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../../site.config.mjs';
import { ROOT } from './load.mjs';
import { buildEml, writeEml, parseEml, MOCK_FROM_ADDR } from './mail-outbox.mjs';
import { composeMail, mailText } from '../../src/client/subscribe-rules.js';
import { createService, DEFAULT_LIMITS } from '../../src/client/subscribe-service.js';

export const SERVICE_NAME = 'cdc-prototype-subscriptions';
export const DEFAULT_DATA_FILE = path.join(ROOT, '.local', 'subscriptions.json');
export const DEFAULT_OUTBOX = path.join(ROOT, '.local', 'outbox');
const MAX_BODY = 8 * 1024;
const MAX_OUTBOX_FILES = 5000;

/* ───────── 儲存 ───────── */
export function readSubscriptions(dataFile = DEFAULT_DATA_FILE) {
  try {
    const d = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    return Array.isArray(d?.subscriptions) ? d : { version: 1, subscriptions: [] };
  } catch { return { version: 1, subscriptions: [] }; }
}
function writeSubscriptions(dataFile, data) {
  fs.mkdirSync(path.dirname(dataFile), { recursive: true });
  const tmp = `${dataFile}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
  fs.renameSync(tmp, dataFile); // 先寫暫存檔再改名：中途當掉不會留下半個 JSON
}

/** 連結用的來源（含 basePath）：PUBLIC_ORIGIN 優先；否則取 Host 標頭（只接受主機名稱字元，避免偽造 Host 注入連結） */
function originOf(req, publicOrigin) {
  if (publicOrigin) return publicOrigin.replace(/\/$/, '');
  const host = String(req.headers.host ?? '');
  return `http://${/^[A-Za-z0-9.-]+(:\d{1,5})?$/.test(host) ? host : 'localhost'}`;
}

const langPrefix = (lang) => (lang === 'en' ? '/en' : '');
/** 一位訂閱者在信裡會用到的連結（絕對網址）與 RFC 8058 一鍵退訂網址；週摘要產生器也用它，確保與模擬後端寄的信一致 */
export function linksFor(sub, origin, basePath = config.basePath) {
  const page = (q) => `${origin}${basePath}${langPrefix(sub.lang)}/subscribe/?${q}`;
  return {
    confirmUrl: sub.confirmToken ? page(`confirm=${sub.confirmToken}`) : undefined,
    manageUrl: page(`manage=${sub.manageToken}`),
    unsubscribeUrl: page(`unsubscribe=${sub.manageToken}`),
    privacyUrl: `${origin}${basePath}${langPrefix(sub.lang)}/policy/privacy/`,
    oneClickUrl: `${origin}${basePath}/api/subscriptions/unsubscribe?token=${sub.manageToken}`,
  };
}
/** 寄信共用標頭：List-Unsubscribe（https 一鍵＋mailto）、List-Unsubscribe-Post（RFC 8058）、List-Id */
export function listHeaders(oneClickUrl) {
  return {
    'List-Unsubscribe': `<${oneClickUrl}>, <mailto:unsubscribe@cdc-prototype.invalid?subject=unsubscribe>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    'List-Id': 'Taiwan CDC newsletter (prototype) <newsletter.cdc-prototype.invalid>',
    'X-CDC-Prototype': 'simulated message; written to the local outbox, never sent',
    'Auto-Submitted': 'auto-generated',
  };
}

export function createSubscriptionApi({
  dataFile = process.env.SUBSCRIPTIONS_FILE || DEFAULT_DATA_FILE,
  outboxDir = process.env.OUTBOX_DIR || DEFAULT_OUTBOX,
  basePath = config.basePath,
  publicOrigin = process.env.PUBLIC_ORIGIN || '',
  now = () => Date.now(),
  limits = DEFAULT_LIMITS,
  devOutbox = true,
} = {}) {
  // 狀態機與瀏覽器模擬後端共用（src/client/subscribe-service.js）；這裡只負責 HTTP、儲存（JSON 檔）與寄信（寫 .eml）
  let origin = 'http://localhost'; // 每個請求進來時更新（連結要用請求的 Host）
  function send(kind, sub) {
    const m = mailText(sub.lang);
    const links = linksFor(sub, origin, basePath);
    const mail = composeMail(kind, { lang: sub.lang, links, sub });
    const eml = buildEml({
      fromName: m.from, to: sub.email, subject: mail.subject, text: mail.text, html: mail.html, date: new Date(now()),
      headers: { ...listHeaders(links.oneClickUrl), ...(kind === 'welcome' ? { Precedence: 'bulk' } : {}) },
    });
    const outFiles = fs.existsSync(outboxDir) ? fs.readdirSync(outboxDir).length : 0;
    if (outFiles >= MAX_OUTBOX_FILES) throw Object.assign(new Error('outbox full'), { code: 'full' });
    return writeEml(outboxDir, kind, eml, new Date(now()));
  }
  const service = createService({ load: () => readSubscriptions(dataFile), save: (d) => writeSubscriptions(dataFile, d), mail: send, now, uuid: () => crypto.randomUUID(), limits });

  async function readBody(req) {
    const chunks = []; let size = 0;
    for await (const c of req) { size += c.length; if (size > MAX_BODY) throw Object.assign(new Error('too large'), { code: 'too_large' }); chunks.push(c); }
    const text = Buffer.concat(chunks).toString('utf8');
    const type = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    if (!text) return {};
    if (type === 'application/json') { try { const j = JSON.parse(text); return j && typeof j === 'object' && !Array.isArray(j) ? j : {}; } catch { throw Object.assign(new Error('bad json'), { code: 'bad_json' }); } }
    if (type === 'application/x-www-form-urlencoded') return Object.fromEntries(new URLSearchParams(text));
    throw Object.assign(new Error('unsupported media type'), { code: 'unsupported' });
  }

  /** 處理請求；不是 /api/ 開頭就回 false（讓靜態檔伺服器接手）。pathname 已去掉 basePath。 */
  async function handle(req, res, pathname, searchParams) {
    if (!pathname.startsWith('/api/')) return false;
    const json = (status, body, headers = {}) => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
      res.end(JSON.stringify(body));
      return true;
    };
    const reply = (r) => json(r.status, r.body, r.headers);
    const method = req.method ?? 'GET';
    origin = originOf(req, publicOrigin);
    const ip = String(req.socket?.remoteAddress ?? 'unknown');

    if (pathname === '/api/health' && method === 'GET') return json(200, { ok: true, service: SERVICE_NAME, mode: 'mock-http' });

    if (devOutbox && pathname.startsWith('/api/dev/outbox') && method === 'GET') {
      if (!/^(::1|127\.\d+\.\d+\.\d+|::ffff:127\.\d+\.\d+\.\d+)$/.test(ip)) return json(403, { error: 'forbidden' });
      const rest = pathname.slice('/api/dev/outbox'.length).replace(/^\//, '');
      if (!rest) {
        const files = fs.existsSync(outboxDir) ? fs.readdirSync(outboxDir).filter((f) => f.endsWith('.eml')).sort() : [];
        return json(200, { dir: path.relative(ROOT, outboxDir) || outboxDir, messages: files.map((f) => { const e = parseEml(fs.readFileSync(path.join(outboxDir, f), 'utf8')); return { file: f, to: e.headers.to, subject: e.headers.subject, listUnsubscribe: e.headers['list-unsubscribe'], text: e.text }; }) });
      }
      if (!/^[\w.-]+\.eml$/.test(rest) || !fs.existsSync(path.join(outboxDir, rest))) return json(404, { error: 'notfound' });
      res.statusCode = 200; res.setHeader('Content-Type', 'text/plain; charset=utf-8'); res.setHeader('Cache-Control', 'no-store');
      res.end(fs.readFileSync(path.join(outboxDir, rest), 'utf8'));
      return true;
    }

    if (!pathname.startsWith('/api/subscriptions')) return json(404, { error: 'notfound' });

    // 同源檢查：瀏覽器的跨站 POST 會帶 Origin；不同源一律拒絕（沒有 Origin 的 curl／一鍵退訂 POST 放行）
    if (method === 'POST') {
      const o = req.headers.origin;
      if (o === 'null') return json(403, { error: 'forbidden' });
      if (o) { let host = ''; try { host = new URL(o).host; } catch { /* 無效 Origin 視為不同源 */ } if (host !== req.headers.host) return json(403, { error: 'forbidden' }); }
    }

    try {
      if (method === 'GET' && pathname === '/api/subscriptions/confirm') return reply(service.confirm(searchParams.get('token')));
      if (method === 'GET' && pathname === '/api/subscriptions/status') return reply(service.status(searchParams.get('token')));
      if (method !== 'POST') return json(405, { error: 'method' }, { Allow: 'GET, POST' });
      const body = await readBody(req);
      origin = originOf(req, publicOrigin); // await 之後再取一次：service 呼叫是同步的，中間不會被別的請求改掉
      if (pathname === '/api/subscriptions') return reply(service.subscribe(body, { ip }));
      if (pathname === '/api/subscriptions/manage-link') return reply(service.manageLink(body.email, { ip }));
      if (pathname === '/api/subscriptions/update') return reply(service.update(body.token, body));
      // 退訂：token 可放 JSON、form 或 ?token=（RFC 8058 一鍵退訂的本體是 List-Unsubscribe=One-Click，token 在網址）
      if (pathname === '/api/subscriptions/unsubscribe') return reply(service.unsubscribe(body.token ?? searchParams.get('token')));
      return json(404, { error: 'notfound' });
    } catch (e) {
      if (e?.code === 'too_large') return json(413, { error: 'too_large' });
      if (e?.code === 'bad_json') return json(400, { error: 'bad_json' });
      if (e?.code === 'unsupported') return json(415, { error: 'unsupported' });
      if (e?.code === 'full') return json(503, { error: 'full' });
      console.error('[subscribe-mock]', e?.message ?? e);
      return json(500, { error: 'server' });
    }
  }

  return { handle, dataFile, outboxDir };
}

export { MOCK_FROM_ADDR };
