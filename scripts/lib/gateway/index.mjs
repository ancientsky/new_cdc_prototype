// @ts-check
// 寫入閘道（第三十輪，issue #28）：後台與 Git 之間的一層小服務。scripts/serve.mjs 掛在 /api/gateway/。
//
// 為什麼要有這層：同事（多數沒用過 Git）只會看到後台的「儲存草稿／送審／退回修改／核准上線」；
// Git（正式環境是機關自架 GitLab）只是背後的版本紀錄與稽核軌跡，只有資訊室會直接操作。
// 閘道負責三件事：認人（AD 群組→角色）、守規則（驗證、四眼原則、發布車道）、代為寫入（服務帳號＋提交訊息尾端記下真正的承辦人）。
// 設計理由與部署方式：docs/architecture-decisions.md §23、docs/deploy.md §14、ARCHITECTURE §36。
//
// 端點（皆 JSON；錯誤格式 { error: 代碼, message: 白話中文, fields?: [{ field, label, message }] }）
//   GET  /api/gateway/health                 → { ok, service:'cdc-web-gateway', auth }（前端用它判斷「有沒有閘道」）
//   GET  /api/gateway/session                → { user: { account, name, unit, roles[] }, csrfToken }
//   GET  /api/gateway/items?view=mine|queue|all&contentId=&editor=   → { items: [...] }（editor：第六十七輪，只列這個帳號目前承辦的）
//   GET  /api/gateway/items/:id              → 送審件（狀態、歷程、意見、能做什麼）
//   GET  /api/gateway/items/:id/diff         → 白話欄位差異
//   GET  /api/gateway/items/:id/content      → { item, contentHash, update?, companions?, categories? } 目前這版的內容（承辦人被退回後重新開啟用）；
//        companions／categories（第五十二輪）：一起送的配套內容與分類主檔，編輯頁重新開啟時帶回表單；
//        contentHash＝版本碼（第五十二輪），存檔時以 baseHash 帶回；update＝送審件開始後網站版本變了，內容已三方合併（§23）
//   GET  /api/gateway/current?contentId=&type=&base=   → { exists, contentHash, item, open, stale? }
//        修改已上架內容（?edit=）開啟時用：main 上的現行版、進行中的送審件、頁面上的版本（base）是否已過期（第五十二輪）
//   GET  /api/gateway/items/:id/preview      → 預覽頁（HTML；CSP sandbox，不執行任何腳本）
//   POST /api/gateway/drafts                 { item, submissionId?, baseHash?, companions?, files?, categories? }  儲存草稿
//   POST /api/gateway/submit                 { item?, submissionId?, baseHash?, companions?, files?, categories? } 送審
//        categories（第五十二輪，docs/deploy.md §24.7）：{ items, start }＝疫情報導分類主檔（表單上的與開始改時的；各最多 60 列），
//        只能跟疫情報導文章一起送；閘道以分類代號為單位合併到網站上的主檔再寫入，路徑由閘道決定（不收路徑）。
//        同一個分類兩邊改得不一樣 ⇒ 409 stale（kind: categories，附網站上的主檔與衝突的分類）。
//        baseHash（第五十二輪）：開啟時的版本碼（src/client/admin/content-version.js；新內容為 'new'）。與現在的版本不同 ⇒
//        409 { error: 'stale', message, stale: { kind, by[], fields[], contentHash, submissionId? } }，不寫入；網站上已有同 ID ⇒ 409 exists。
//        沒帶 ⇒ 照舊接受（舊版頁面、其他編輯頁），稽核記 baseHash: missing。回應多帶 contentHash（存好的這一版的版本碼）。
//   第五十三輪（docs/deploy.md §25）：/drafts、/submit 另收 master: { name, items, start }（不帶 item）＝單獨送審的主檔（目前只有 immunization-schedule）。
//        路徑與權責單位由名稱查 validate-item.mjs 的 MASTER_FILES（不收路徑）；各最多 400 列、每列是物件，否則 400。baseHash＝開始時主檔的版本碼。
//        以列的 id 合併到網站上的主檔；同一筆同一欄兩邊改得不一樣 ⇒ 409 stale（kind: master，附現在的主檔與衝突的列）。回應多帶 rows（寫進去的整份主檔）。
//        GET /current?contentId=master.immunization-schedule&type=master 回網站上的整份主檔與版本碼。
//   GATEWAY_REQUIRE_BASE_HASH=1（第五十三輪，預設關）：沒帶 baseHash 的 /drafts、/submit 一律 428 version_required（預設照舊接受、稽核記 baseHash: missing）。
//   POST /api/gateway/rereview               { contentId, type, note? } 送出重新審閱（第五十輪：內容不改，現行版原樣送審；核准後只更新最後審閱日）
//        /submit 另收 reReview: true（修改到期內容時一併標為重新審閱）
//   POST /api/gateway/items/:id/return       { comment }              退回修改（意見必填）
//   POST /api/gateway/items/:id/approve      { comment? }             核准上線（送審期間網站版本變了 ⇒ 409 outdated，不記核准）
//   POST /api/gateway/items/:id/handover     { note? }                接手（第六十七輪）：同單位的編輯把自己設為承辦人；原承辦人不再收通知、仍不能核准
//   GET  /api/gateway/intl-epidemic/status   → { lastRun, history }   國際疫情匯入紀錄（第四十三輪；docs/intl-epidemic.md）
//   POST /api/gateway/intl-epidemic/import   { feed, mode?, dry? }    後台手動匯入（feed：v1 物件、舊官網匯出列或 CSV 字串；本體 ≤ 2 MB）
//        只有疫情中心的編輯／審核或跨單位角色可用；與推送端點同一段上架流程（scripts/lib/intl-epidemic-publish.mjs），held → 202
//
// 安全：POST 一律要 (1) Content-Type: application/json、(2) Origin 與 Host 同源（Sec-Fetch-Site 若有須為 same-origin）、
// (3) X-CSRF-Token（GET /session 取得，HMAC 綁帳號）；本體 ≤ 512 KB；回應 no-store＋nosniff＋CSP default-src 'none'。
// 速率限制（第六十三輪，Issue #140）：每 IP 全部端點、每 IP 登入與認證失敗、每帳號寫入，超過 ⇒ 429 rate_limited＋Retry-After（GATEWAY_RATE_LIMIT）。
// 錯誤回應一律是 { error, message }：不帶堆疊、版本、檔案路徑（500 只回白話訊息，細節只進伺服器 log）。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createGoogleAuth, createDirectoryLookup } from './google.mjs';
import { config } from '../../../site.config.mjs';
import { ROOT, readJSON } from '../load.mjs';
import { md } from '../markdown.mjs';
/** HTML 跳脫（不引入 render.mjs，閘道模組自成一體） */
const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
import { createAuth, DEV_SESSION_HEADER } from './auth.mjs';
import { createLocalGit } from './git-local.mjs';
import { createGitLab } from './git-gitlab.mjs';
import { createValidator, MASTER_FILES } from './validate-item.mjs';
import { createStateStore, createAuditLog } from './store.mjs';
import { createNotifier } from './notify.mjs';
import { createWorkflow, GatewayError } from './workflow.mjs';
import { loadLanes, validateLanes } from '../lanes.mjs';
import { publishFeed, readImportRecord, canImportIntl, PublishError } from '../intl-epidemic-publish.mjs';
import { createRateLimiter, clientKey, tooMany, ipMatcher } from '../rate-limit.mjs';

export const SERVICE_NAME = 'cdc-web-gateway';
export const MAX_BODY = 512 * 1024;
// 第四十五輪：疫情報導後台把 PDF 與圖檔（base64）跟內容一起送；只有 /drafts 與 /submit 讀到這個上限，內容本身仍限 512 KB
export const ITEM_WITH_FILES_MAX_BODY = 24 * 1024 * 1024;
export const MAX_FILES = 20;
export const MAX_FILES_BYTES = 16 * 1024 * 1024;
const FILE_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,99}$/i;
/** 國際疫情手動匯入：一整批 feed 可能比一筆內容大，與推送端點同上限 */
export const INTL_MAX_BODY = 2 * 1024 * 1024;
const INTL_DENIED = '國際疫情匯入只開放給疫情中心的承辦人與複核者，或總編輯、治理幕僚、平台管理；如需權限請洽資訊室';
const split = (s) => String(s ?? '').split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);

/**
 * 速率限制（第六十三輪，Issue #140；docs/deploy.md §31、docs/abuse-protection.md）。三個範圍、各自計數：
 *   ip    每個來源 IP，/api/gateway/ 底下的所有請求（含 GET /health：掃描器最常打的就是健康檢查這類固定路徑，而且它很便宜，限了不痛）
 *   auth  每個來源 IP，/login、/login/callback、/logout 與「認證失敗」——猜帳號、重放回呼、灌 OIDC 驗章都落在這裡
 *   write 每個帳號，POST 寫入（存草稿、送審、核准…）：已登入的帳號被盜或腳本失控時，限制它一分鐘能改多少東西
 * 全部在讀本體之前判斷：被擋的請求不花解析 24 MB 本體的成本。
 */
export const DEFAULT_RATE_LIMIT = Object.freeze({
  ip: Object.freeze({ max: 120, windowMs: 60_000 }),
  auth: Object.freeze({ max: 10, windowMs: 60_000 }),
  write: Object.freeze({ max: 60, windowMs: 60_000 }),
});
/**
 * GATEWAY_RATE_LIMIT → 設定。空白＝預設；off＝關閉（只給本機除錯，正式環境不要關）；
 * 也可逐項覆寫：「ip:240/60,auth:20/60」＝ ip 每 60 秒 240 次、auth 每 60 秒 20 次，沒寫的範圍用預設。格式不對就不啟動（不要默默用錯的數字）。
 * @returns {null | { ip: {max:number,windowMs:number}, auth: {max:number,windowMs:number}, write: {max:number,windowMs:number} }}
 */
export function rateLimitFromEnv(v) {
  const s = String(v ?? '').trim();
  if (s === 'off') return null;
  const out = { ip: { ...DEFAULT_RATE_LIMIT.ip }, auth: { ...DEFAULT_RATE_LIMIT.auth }, write: { ...DEFAULT_RATE_LIMIT.write } };
  if (!s || s === 'on') return out;
  for (const part of s.split(',').map((x) => x.trim()).filter(Boolean)) {
    const m = /^(ip|auth|write):(\d{1,6})\/(\d{1,5})$/.exec(part);
    if (!m || Number(m[2]) < 1 || Number(m[3]) < 1) throw new Error(`GATEWAY_RATE_LIMIT 格式不對：「${part}」。請寫 off，或「範圍:次數/秒數」以逗號分隔（範圍：ip、auth、write），例：ip:120/60,auth:10/60,write:60/60`);
    out[m[1]] = { max: Number(m[2]), windowMs: Number(m[3]) * 1000 };
  }
  return out;
}

/** 環境變數 → 設定（祕密只從環境變數來，不進設定檔、不進 Git） */
export function configFromEnv(env = process.env) {
  const local = (p, d) => path.resolve(ROOT, env[p] || d);
  return {
    auth: {
      mode: env.GATEWAY_AUTH || 'dev',
      header: { trustedProxies: split(env.GATEWAY_TRUSTED_PROXIES), userHeader: env.GATEWAY_USER_HEADER || 'x-remote-user', groupsHeader: env.GATEWAY_GROUPS_HEADER || 'x-remote-groups', nameHeader: env.GATEWAY_NAME_HEADER || 'x-remote-name', emailHeader: env.GATEWAY_EMAIL_HEADER || 'x-remote-email' },
      google: {
        clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET || '', domain: env.GOOGLE_DOMAIN, redirectUri: env.GOOGLE_REDIRECT_URI,
        roleMap: env.GOOGLE_ROLE_MAP_FILE || undefined, sessionSecret: env.GATEWAY_SESSION_SECRET || '', secureCookie: env.GATEWAY_INSECURE_COOKIE !== '1',
        serviceAccountFile: env.GOOGLE_SA_KEY_FILE || '', adminSubject: env.GOOGLE_ADMIN_SUBJECT || '',
      },
      oidc: { issuer: env.OIDC_ISSUER, audience: env.OIDC_AUDIENCE, jwksUri: env.OIDC_JWKS_URI, jwksFile: env.OIDC_JWKS_FILE, userClaim: env.OIDC_USER_CLAIM || 'preferred_username', groupsClaim: env.OIDC_GROUPS_CLAIM || 'groups', nameClaim: env.OIDC_NAME_CLAIM || 'name' },
    },
    git: {
      provider: env.GATEWAY_GIT || 'local',
      dir: local('GATEWAY_REPO_DIR', '.local/gateway-repo'), seedDir: env.GATEWAY_SEED_DIR ? path.resolve(env.GATEWAY_SEED_DIR) : path.join(ROOT, 'content'),
      gitlab: { baseUrl: env.GITLAB_URL, project: env.GITLAB_PROJECT, token: env.GITLAB_TOKEN, targetBranch: env.GITLAB_TARGET_BRANCH || 'main' },
    },
    stateFile: local('GATEWAY_STATE_FILE', '.local/gateway-state.json'),
    auditFile: local('GATEWAY_AUDIT_FILE', '.local/gateway-audit.jsonl'),
    outboxDir: local('OUTBOX_DIR', '.local/outbox'),
    publicOrigin: env.PUBLIC_ORIGIN || '',
    csrfSecret: env.GATEWAY_CSRF_SECRET || '',
    // 第五十三輪：要不要拒絕沒帶版本碼的寫入（docs/deploy.md §25.6）。預設關：照舊接受，稽核記 baseHash: missing
    requireBaseHash: env.GATEWAY_REQUIRE_BASE_HASH === '1',
    // 第五十四輪：另指一份車道設定（預設 content/governance/lanes.json，與 CI 同一份）。給測試站或演練用，例：先關掉型別授權看審核流程
    lanesFile: env.GATEWAY_LANES_FILE ? path.resolve(ROOT, env.GATEWAY_LANES_FILE) : '',
    // 第六十三輪（Issue #140）：速率限制。GATEWAY_RATE_LIMIT＝空白（預設：ip 120/60 秒、auth 10/60 秒、write 每帳號 60/60 秒）｜off｜
    // 「ip:240/60,auth:20/60,write:60/60」逐項覆寫。來源 IP 只在連線來自 GATEWAY_TRUSTED_PROXIES 時才採信 X-Forwarded-For（rate-limit.mjs clientKey）。
    // 被擋 ⇒ 429 { error:'rate_limited' }＋Retry-After，稽核記 rate_limited { ip, path, scope }（每次開始被擋記一筆，不記本體）。
    rateLimit: rateLimitFromEnv(env.GATEWAY_RATE_LIMIT),
  };
}

/** Google 模式：角色來源 (a) 目錄 API（有服務帳號金鑰才啟用）＋ (b) 對照檔 */
export function googleFromConfig(g) {
  const sa = g.serviceAccountFile ? JSON.parse(fs.readFileSync(g.serviceAccountFile, 'utf8')) : null;
  return createGoogleAuth({ ...g, groupLookup: sa ? createDirectoryLookup({ serviceAccount: sa, subject: g.adminSubject, domain: g.domain }) : undefined });
}

export function createGitProvider(g) {
  if (g.provider === 'gitlab') return createGitLab(g.gitlab);
  return createLocalGit({ dir: g.dir, seedDir: g.seedDir });
}

/** 另指的車道設定檔：形狀不對就不啟動（寧可起不來，也不要用一份壞掉的名單決定誰能免審上線） */
function lanesFrom(file) {
  const c = loadLanes(file);
  const errs = validateLanes(c);
  if (errs.length) throw new Error(`GATEWAY_LANES_FILE（${file}）有誤：${errs.join('；')}`);
  return c;
}

/**
 * @param {Partial<ReturnType<typeof configFromEnv>> & { now?: () => number, gitProvider?: any, authAdapter?: any, validator?: any, directory?: any, lanesCfg?: any, intl?: { snapshotsDir?: string, today?: string } }} [opts]
 */
export function createGatewayApi(opts = {}) {
  const cfg = { ...configFromEnv(), ...opts };
  const now = opts.now ?? (() => Date.now());
  const auth = opts.authAdapter ?? (cfg.auth.mode === 'google' ? googleFromConfig(cfg.auth.google) : createAuth(cfg.auth));
  const git = opts.gitProvider ?? createGitProvider(cfg.git);
  const audit = createAuditLog(cfg.auditFile, { now });
  const store = createStateStore(cfg.stateFile);
  const notifier = createNotifier({ outboxDir: cfg.outboxDir, now });
  const units = readJSON(path.join(ROOT, 'content/master/units.json'), []);
  const unitNames = Object.fromEntries(units.map((u) => [u.id, u.name]));
  const validator = opts.validator ?? createValidator();
  // 第五十三輪：接種時程主檔的差異寫疫苗名稱（審核人看「B 型肝炎疫苗」而不是 vaccine.hepatitis-b）
  const vaccineNames = Object.fromEntries(readJSON(path.join(ROOT, 'content/master/vaccines.json'), []).map((v) => [v.id, v.name]));
  const workflow = createWorkflow({ git, validator, store, audit, notifier, unitNames, vaccineNames, now, requireBaseHash: cfg.requireBaseHash === true, ...(opts.directory ? { directory: opts.directory } : {}), ...(opts.lanesCfg ? { lanesCfg: opts.lanesCfg } : cfg.lanesFile ? { lanesCfg: lanesFrom(cfg.lanesFile) } : {}) });
  // 速率限制：opts.rateLimit 可整個換掉（測試用 null 關閉或給小數字），否則用環境變數的設定
  const rl = cfg.rateLimit ? { ...DEFAULT_RATE_LIMIT, ...cfg.rateLimit } : null;
  const limiters = rl ? { ip: createRateLimiter({ ...rl.ip, now }), auth: createRateLimiter({ ...rl.auth, now }), write: createRateLimiter({ ...rl.write, now }) } : null;
  const trustedProxy = ipMatcher(cfg.auth?.header?.trustedProxies ?? []);
  /** 記一次；超過就寫稽核（只在「剛開始被擋」那一次，避免被灌時稽核檔跟著被灌）並回 429。回傳 true＝已回應 */
  function limited(scope, key, ip, req, res, sub, actor) {
    if (!limiters) return false;
    const r = limiters[scope].hit(key);
    if (r.ok) return false;
    if (r.denied === 1) audit.write('rate_limited', { actor: actor ?? null, result: 'denied', detail: { ip, path: sub.slice(0, 120), scope } });
    return tooMany(res, r.retryAfterSec, { req, headers: { 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'" } });
  }
  const secret = cfg.csrfSecret ? Buffer.from(cfg.csrfSecret) : crypto.randomBytes(32);
  const csrfFor = (p) => crypto.createHmac('sha256', secret).update(`${p.authMode}|${p.account}`).digest('base64url');

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
  const err = (res, status, code, message, fields, extra) => send(res, status, { error: code, message, ...(fields ? { fields } : {}), ...(extra ?? {}) });
  /** 版本碼：'new' 或 v1-…（合併後的是兩段以 + 相接）；格式不對就當沒帶 */
  const baseOf = (v) => (typeof v === 'string' && /^(new|v1-[0-9a-z-]{8,64}(\+v1-[0-9a-z-]{8,64}|\+new)?)$/.test(v) ? v : undefined);

  /** 附件：[{ name, base64 }] → { name: Buffer }；檔名只收 content/assets 規則允許的字元（路徑由伺服器決定，不收路徑） */
  function decodeFiles(files) {
    if (files == null) return null;
    if (!Array.isArray(files) || files.length > MAX_FILES) throw new GatewayError(400, 'bad_files', `附件最多 ${MAX_FILES} 個`);
    const out = {};
    let total = 0;
    for (const f of files) {
      if (!f || typeof f.name !== 'string' || typeof f.base64 !== 'string' || !FILE_NAME_RE.test(f.name) || f.name.includes('..')) throw new GatewayError(400, 'bad_files', '附件格式不對（需要 name 與 base64；檔名只能用英數、點、連字號）', [{ field: 'assets', label: '附件與圖片', message: `附件「${String(f?.name ?? '').slice(0, 60)}」的檔名或內容格式不對` }]);
      const buf = Buffer.from(f.base64, 'base64');
      total += buf.length;
      if (total > MAX_FILES_BYTES) throw new GatewayError(413, 'too_large', `附件合計超過 ${MAX_FILES_BYTES / 1024 / 1024} MB`);
      out[f.name] = buf;
    }
    return out;
  }
  /** 配套內容（跟主內容一起送審、一起上線；例：疫情報導文章的新卷期）：最多 3 筆物件 */
  function decodeCompanions(list) {
    if (list == null) return [];
    if (!Array.isArray(list) || list.length > 3 || list.some((x) => !x || typeof x !== 'object' || Array.isArray(x))) throw new GatewayError(400, 'bad_companions', '配套內容格式不對（最多 3 筆）');
    return list;
  }
  /** 疫情報導分類主檔（第五十二輪）：{ items: [...], start: [...] }，各最多 60 列、每列是物件；格式不對就 400（內容由 validate-item.mjs 用建置同一套規則檢查） */
  function decodeCategories(v) {
    if (v == null) return null;
    const rows = (x) => Array.isArray(x) && x.length <= 60 && x.every((r) => r && typeof r === 'object' && !Array.isArray(r));
    if (typeof v !== 'object' || Array.isArray(v) || !rows(v.items) || !rows(v.start)) throw new GatewayError(400, 'bad_categories', '分類主檔格式不對（最多 60 個分類）', [{ field: 'categories', label: '分類管理', message: '分類主檔格式不對（最多 60 個分類）' }]);
    return { items: v.items, start: v.start };
  }
  /** 單獨送審的主檔（第五十三輪）：{ name, items: [...], start: [...] }，名稱要在 MASTER_FILES、各最多 maxRows 列、每列是物件；格式不對就 400（內容由 validateMaster 用建置同一套規則檢查） */
  function decodeMaster(v) {
    if (v == null) return null;
    const def = v && typeof v === 'object' && typeof v.name === 'string' && Object.hasOwn(MASTER_FILES, v.name) ? MASTER_FILES[v.name] : null;
    const rows = (x) => Array.isArray(x) && x.length <= (def?.maxRows ?? 0) && x.every((r) => r && typeof r === 'object' && !Array.isArray(r));
    if (!def || typeof v !== 'object' || Array.isArray(v) || !rows(v.items) || !rows(v.start)) throw new GatewayError(400, 'bad_master', `主檔格式不對（只收可送審的主檔；最多 ${def?.maxRows ?? 0} 筆）`, [{ field: 'master', label: def?.title ?? '主檔', message: '主檔格式不對' }]);
    return { name: v.name, items: v.items, start: v.start };
  }
  // 超過上限時不能中途 break：那會毀掉請求串流，連線被重設，客戶端只看到「fetch failed」而收不到 413
  // （第三十輪 CI 實測：本機常常剛好收得到，GitHub runner 上收不到）。所以超過後只丟棄、讀完再回 413。
  async function readBody(req, max = MAX_BODY) {
    const chunks = []; let size = 0;
    for await (const c of req) { size += c.length; if (size <= max) chunks.push(c); }
    if (size > max) throw new GatewayError(413, 'too_large', max === MAX_BODY ? '內容太大（上限 512 KB）；附件請另外處理' : `內容太大（上限 ${max / 1024 / 1024} MB）；請分批匯入`);
    const text = Buffer.concat(chunks).toString('utf8');
    if (!text) return {};
    try { const j = JSON.parse(text); if (j && typeof j === 'object' && !Array.isArray(j)) return j; } catch { /* 落到下面 */ }
    throw new GatewayError(400, 'bad_json', '送來的資料格式不對');
  }
  function sameOrigin(req) {
    const site = req.headers['sec-fetch-site'];
    if (site && site !== 'same-origin') return false;
    const o = req.headers.origin;
    if (!o || o === 'null') return false;
    // 反向代理改寫 Host 時（例如 IIS ARR 預設不保留 Host），以 PUBLIC_ORIGIN 為準
    try { const u = new URL(String(o)); return cfg.publicOrigin ? u.origin === new URL(cfg.publicOrigin).origin : u.host === req.headers.host; } catch { return false; }
  }
  function originOf(req) {
    if (cfg.publicOrigin) return cfg.publicOrigin.replace(/\/$/, '');
    const host = String(req.headers.host ?? '');
    return `http://${/^[A-Za-z0-9.-]+(:\d{1,5})?$/.test(host) ? host : 'localhost'}`;
  }

  /** 預覽頁：用建置同一個 Markdown 淨化器；CSP sandbox，頁內不會執行任何腳本 */
  function previewHtml(item, sub) {
    const base = config.basePath;
    // 第五十三輪：主檔（一整份表）：列出每一筆的名稱、年齡、階段、費用與是否已核對（差異在審核頁看，這裡看整份長什麼樣）
    if (Array.isArray(item)) {
      const css0 = ['tokens', 'base', 'components'].map((n) => `<link rel="stylesheet" href="${base}/assets/styles/${n}.css">`).join('');
      const tr = item.map((r) => `<tr><td>${esc(r?.label ?? r?.id ?? '')}</td><td>${esc(r?.ageLabel ?? '')}</td><td>${esc(r?.stage ?? '')}</td><td>${esc(r?.funded ?? '')}</td><td>${r?.verified === false ? '待核對' : '已核對'}</td></tr>`).join('');
      return `<!doctype html><html lang="zh-Hant-TW"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>預覽：${esc(sub.title)}</title>${css0}</head>
<body><div role="note" style="background:#fff4ce;border-bottom:2px solid #c9a227;padding:10px 16px"><strong>預覽（尚未上線）</strong>　狀態：${esc(sub.statusLabel)}　·　權責單位：${esc(sub.ownerName)}　·　送審中的整份主檔（${item.length} 筆），只有同事看得到。</div>
<main id="main" style="max-width:60rem;margin:0 auto;padding:16px"><h1>${esc(sub.title)}</h1><table><thead><tr><th scope="col">項目</th><th scope="col">年齡</th><th scope="col">階段</th><th scope="col">費用</th><th scope="col">核對</th></tr></thead><tbody>${tr}</tbody></table></main></body></html>`;
    }
    const css = ['tokens', 'base', 'components'].map((n) => `<link rel="stylesheet" href="${base}/assets/styles/${n}.css">`).join('');
    const textFields = ['answerMarkdown', 'bodyMarkdown', 'clarificationMarkdown', 'introMarkdown', 'abstractMarkdown', 'machineReadableMarkdown', 'transcriptMarkdown'];
    const blocks = [...textFields.filter((f) => item?.[f]).map((f) => md(item[f])), ...(item?.blocks ?? []).filter((b) => b.markdown).map((b) => `<h2>${esc(b.heading ?? '')}</h2>${md(b.markdown)}`), ...(item?.sections ?? []).filter((b) => b.markdown).map((b) => `<h2>${esc(b.heading ?? '')}</h2>${md(b.markdown)}`)];
    return `<!doctype html><html lang="zh-Hant-TW"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>預覽：${esc(item?.title ?? '')}</title>${css}</head>
<body><div role="note" style="background:#fff4ce;border-bottom:2px solid #c9a227;padding:10px 16px"><strong>預覽（尚未上線）</strong>　狀態：${esc(sub.statusLabel)}　·　權責單位：${esc(sub.ownerName)}　·　這是送審中的版本，只有同事看得到。</div>
<main id="main" style="max-width:46rem;margin:0 auto;padding:16px"><h1>${esc(item?.title ?? '')}</h1>${item?.summary ? `<p><strong>摘要：</strong>${esc(item.summary)}</p>` : ''}<div class="c-prose">${blocks.join('\n')}</div></main></body></html>`;
  }

  /** 不是 /api/gateway 開頭就回 false。pathname 已去掉 basePath。 */
  async function handle(req, res, pathname, searchParams) {
    if (pathname !== '/api/gateway' && !pathname.startsWith('/api/gateway/')) return false;
    const method = req.method ?? 'GET';
    const sub = pathname.slice('/api/gateway'.length) || '/';
    // 第六十三輪：先限流再做任何事（含 /health）。來源 IP 只在連線來自信任的代理時才看 X-Forwarded-For，否則攻擊者能自己挑 key
    const ip = clientKey(req, { trustedProxies: trustedProxy });
    if (limited('ip', ip, ip, req, res, sub)) return true;
    if ((sub === '/login' || sub === '/login/callback' || sub === '/logout') && limited('auth', ip, ip, req, res, sub)) return true;
    if (sub === '/health' && method === 'GET') return send(res, 200, { ok: true, service: SERVICE_NAME, auth: auth.mode });
    // Google（或其他需要閘道自己跑授權碼流程的轉接器）：登入、回呼、登出
    if (auth.loginRedirect && method === 'GET' && sub === '/login') {
      const r = auth.loginRedirect(String(searchParams.get('next') ?? '/admin/'));
      res.statusCode = 302; res.setHeader('Location', r.location); res.setHeader('Set-Cookie', r.setCookie); res.setHeader('Cache-Control', 'no-store'); res.end();
      return true;
    }
    if (auth.callback && method === 'GET' && sub === '/login/callback') {
      const r = await auth.callback(req, searchParams);
      if (!r.ok) { audit.write('login', { result: 'denied', detail: { reason: r.code } }); return err(res, r.status, r.code, r.message); }
      audit.write('login', { actor: r.principal, detail: { groups: r.principal.groups } });
      res.statusCode = 302; res.setHeader('Location', `${config.basePath}${r.next}`); res.setHeader('Set-Cookie', r.setCookie); res.setHeader('Cache-Control', 'no-store'); res.end();
      return true;
    }
    if (auth.logout && method === 'POST' && sub === '/logout' && sameOrigin(req)) { res.setHeader('Set-Cookie', auth.logout().setCookie); return send(res, 200, { ok: true }); }
    try {
      if (method === 'POST') {
        const type = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
        if (type !== 'application/json') return err(res, 415, 'unsupported', '請用 JSON 送出');
        if (!sameOrigin(req)) { audit.write('csrf-origin', { result: 'denied', detail: { path: sub, origin: String(req.headers.origin ?? '').slice(0, 100) } }); return err(res, 403, 'origin', '請從後台頁面操作'); }
      } else if (method !== 'GET') return err(res, 405, 'method', '不支援的操作', undefined);
      const a = await auth.authenticate(req, res);
      if (!a.ok) {
        // 認證失敗也算進 auth 範圍：一直拿假 token／假 session 來試的人，十次以後就只拿到 429
        if (limited('auth', ip, ip, req, res, sub)) return true;
        if (a.code === 'untrusted_proxy') audit.write('auth', { result: 'denied', detail: { reason: a.code, ip: String(req.socket?.remoteAddress ?? '') } });
        return send(res, a.status, { error: a.code, message: a.message, ...(a.loginUrl ? { loginUrl: `${config.basePath}${a.loginUrl}` } : {}) });
      }
      const p = a.principal;
      if (!p.roles.length) return err(res, 403, 'no_role', '你的帳號沒有網站內容的角色（需要 CDC-WEB- 開頭的 AD 群組），請洽資訊室');
      if (method === 'POST') {
        // 每個帳號的寫入上限：在檢查 CSRF、讀本體之前（被擋的請求不讀本體）
        if (limited('write', `acct:${p.authMode}:${p.account}`, ip, req, res, sub, p)) return true;
        const t = String(req.headers['x-csrf-token'] ?? '');
        const want = csrfFor(p);
        if (t.length !== want.length || !crypto.timingSafeEqual(Buffer.from(t), Buffer.from(want))) { audit.write('csrf-token', { actor: p, result: 'denied', detail: { path: sub } }); return err(res, 403, 'csrf', '頁面已過期，請重新整理後再試'); }
      }
      const ctx = { origin: originOf(req), basePath: config.basePath };

      if (method === 'GET') {
        if (sub === '/intl-epidemic/status') {
          if (!canImportIntl(p)) return err(res, 403, 'forbidden', INTL_DENIED);
          return send(res, 200, readImportRecord(opts.intl?.snapshotsDir));
        }
        if (sub === '/current') {
          const cid = String(searchParams.get('contentId') ?? ''), type = String(searchParams.get('type') ?? '');
          if (!/^[a-z]+\.[a-z0-9.-]{1,120}$/.test(cid) || !/^[a-z]{2,20}$/.test(type)) return err(res, 400, 'bad_query', '缺少內容 ID 或型別');
          return send(res, 200, await workflow.current(p, { contentId: cid, type, base: baseOf(searchParams.get('base')) }));
        }
        if (sub === '/session') return send(res, 200, { user: { account: p.account, name: p.name, unit: p.primaryUnit, units: p.units, roles: p.roles }, csrfToken: csrfFor(p) });
        if (sub === '/items') {
          const v = ['mine', 'queue', 'all'].includes(String(searchParams.get('view'))) ? String(searchParams.get('view')) : 'mine';
          const cid = searchParams.get('contentId');
          const ed = String(searchParams.get('editor') ?? '');
          return send(res, 200, { items: workflow.list(p, { view: v, contentId: cid && /^[a-z]+\.[a-z0-9.-]{1,120}$/.test(cid) ? cid : undefined, editor: /^[a-z0-9._-]{1,64}$/.test(ed) ? ed : undefined }) });
        }
        const m = /^\/items\/(gw-\d{8}-[0-9a-f]{6})(\/diff|\/content|\/preview)?$/.exec(sub);
        if (m) {
          if (!m[2]) return send(res, 200, workflow.detail(p, m[1]));
          if (m[2] === '/diff') return send(res, 200, await workflow.diff(p, m[1]));
          if (m[2] === '/content') return send(res, 200, await workflow.contentFor(p, m[1]));
          const item = await workflow.content(p, m[1]);
          res.statusCode = 200;
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          res.setHeader('X-Content-Type-Options', 'nosniff');
          res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; style-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'");
          res.setHeader('X-Robots-Tag', 'noindex, nofollow');
          res.end(previewHtml(item, workflow.detail(p, m[1])));
          return true;
        }
        return err(res, 404, 'notfound', '找不到');
      }

      if (sub === '/intl-epidemic/import') {
        if (!canImportIntl(p)) { audit.write('intl-epidemic-import', { actor: p, result: 'denied' }); return err(res, 403, 'forbidden', INTL_DENIED); }
        const b = await readBody(req, INTL_MAX_BODY);
        if (b.feed == null || (typeof b.feed !== 'string' && typeof b.feed !== 'object')) return err(res, 400, 'bad_feed', '沒有收到要匯入的資料（feed）');
        if (b.mode != null && b.mode !== 'full' && b.mode !== 'delta') return err(res, 400, 'bad_mode', '匯入方式只能是「只更新這幾則」（delta）或「這就是現行全部」（full）');
        try {
          const out = await publishFeed({
            feed: b.feed, source: 'manual', ...(b.mode ? { mode: b.mode } : {}), dry: b.dry === true,
            by: p.account, actor: p, producer: typeof b.feed === 'object' && typeof b.feed.producer === 'string' ? b.feed.producer.slice(0, 120) : `後台手動匯入（${p.account}）`,
            git, audit, ...(opts.intl?.snapshotsDir ? { snapshotsDir: opts.intl.snapshotsDir } : {}), ...(opts.intl?.today ? { today: opts.intl.today } : {}),
          });
          const { wrote, version, ...rest } = out; // 回應不帶檔案路徑與版本細節（同事看不到 Git）
          return send(res, out.held ? 202 : 200, { ...rest, saved: !out.dry && wrote.length > 0 });
        } catch (e) {
          if (e instanceof PublishError) throw new GatewayError(e.status, e.code, e.message);
          throw e;
        }
      }
      const withFiles = sub === '/drafts' || sub === '/submit';
      const body = await readBody(req, withFiles ? ITEM_WITH_FILES_MAX_BODY : MAX_BODY);
      if (withFiles) {
        const { files, ...rest } = body;
        if (Buffer.byteLength(JSON.stringify(rest), 'utf8') > MAX_BODY) throw new GatewayError(413, 'too_large', '內容太大（上限 512 KB）；附件請另外處理');
        const decoded = decodeFiles(files);
        const companions = decodeCompanions(body.companions);
        const master = decodeMaster(body.master);
        if (master && body.item != null) throw new GatewayError(400, 'bad_master', '主檔要單獨送，不能跟內容一起送');
        const args = { item: body.item, submissionId: typeof body.submissionId === 'string' ? body.submissionId : undefined, files: decoded, companions, reReview: body.reReview === true, baseHash: baseOf(body.baseHash), categories: decodeCategories(body.categories), master };
        if (sub === '/drafts') return send(res, 200, await workflow.saveDraft(p, args));
        return send(res, 200, await workflow.submit(p, args, ctx));
      }
      if (sub === '/rereview') {
        const contentId = typeof body.contentId === 'string' ? body.contentId : '', type = typeof body.type === 'string' ? body.type : '';
        return send(res, 200, await workflow.reReview(p, { contentId, type, note: typeof body.note === 'string' ? body.note : undefined }, ctx));
      }
      const m = /^\/items\/(gw-\d{8}-[0-9a-f]{6})\/(return|approve|handover)$/.exec(sub);
      if (m && m[2] === 'return') return send(res, 200, await workflow.returnForChanges(p, { submissionId: m[1], comment: body.comment }, ctx));
      if (m && m[2] === 'approve') return send(res, 200, await workflow.approve(p, { submissionId: m[1], comment: body.comment }, ctx));
      if (m && m[2] === 'handover') return send(res, 200, await workflow.handover(p, { submissionId: m[1], note: typeof body.note === 'string' ? body.note : undefined }));
      return err(res, 404, 'notfound', '找不到');
    } catch (e) {
      if (e instanceof GatewayError) return err(res, e.status, e.code, e.message, e.fields, e.extra);
      console.error('[gateway]', e?.message ?? e);
      return err(res, 500, 'server', '系統暫時無法處理，請稍後再試；若持續發生請洽資訊室');
    }
  }

  return { handle, workflow, git, audit, store, notifier, config: cfg, csrfFor, DEV_SESSION_HEADER };
}
