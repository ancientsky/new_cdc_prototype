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
//   GET  /api/gateway/items?view=mine|queue|all&contentId=   → { items: [...] }
//   GET  /api/gateway/items/:id              → 送審件（狀態、歷程、意見、能做什麼）
//   GET  /api/gateway/items/:id/diff         → 白話欄位差異
//   GET  /api/gateway/items/:id/content      → 目前這版的內容 JSON（承辦人被退回後重新開啟用）
//   GET  /api/gateway/items/:id/preview      → 預覽頁（HTML；CSP sandbox，不執行任何腳本）
//   POST /api/gateway/drafts                 { item, submissionId? }  儲存草稿
//   POST /api/gateway/submit                 { item?, submissionId? } 送審
//   POST /api/gateway/items/:id/return       { comment }              退回修改（意見必填）
//   POST /api/gateway/items/:id/approve      { comment? }             核准上線
//
// 安全：POST 一律要 (1) Content-Type: application/json、(2) Origin 與 Host 同源（Sec-Fetch-Site 若有須為 same-origin）、
// (3) X-CSRF-Token（GET /session 取得，HMAC 綁帳號）；本體 ≤ 512 KB；回應 no-store＋nosniff＋CSP default-src 'none'。
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
import { createValidator } from './validate-item.mjs';
import { createStateStore, createAuditLog } from './store.mjs';
import { createNotifier } from './notify.mjs';
import { createWorkflow, GatewayError } from './workflow.mjs';

export const SERVICE_NAME = 'cdc-web-gateway';
export const MAX_BODY = 512 * 1024;
const split = (s) => String(s ?? '').split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);

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

/**
 * @param {Partial<ReturnType<typeof configFromEnv>> & { now?: () => number, gitProvider?: any, authAdapter?: any, validator?: any, directory?: any, lanesCfg?: any }} [opts]
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
  const workflow = createWorkflow({ git, validator, store, audit, notifier, unitNames, now, ...(opts.directory ? { directory: opts.directory } : {}), ...(opts.lanesCfg ? { lanesCfg: opts.lanesCfg } : {}) });
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
  const err = (res, status, code, message, fields) => send(res, status, { error: code, message, ...(fields ? { fields } : {}) });

  // 超過上限時不能中途 break：那會毀掉請求串流，連線被重設，客戶端只看到「fetch failed」而收不到 413
  // （第三十輪 CI 實測：本機常常剛好收得到，GitHub runner 上收不到）。所以超過後只丟棄、讀完再回 413。
  async function readBody(req) {
    const chunks = []; let size = 0;
    for await (const c of req) { size += c.length; if (size <= MAX_BODY) chunks.push(c); }
    if (size > MAX_BODY) throw new GatewayError(413, 'too_large', '內容太大（上限 512 KB）；附件請另外處理');
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
        if (a.code === 'untrusted_proxy') audit.write('auth', { result: 'denied', detail: { reason: a.code, ip: String(req.socket?.remoteAddress ?? '') } });
        return send(res, a.status, { error: a.code, message: a.message, ...(a.loginUrl ? { loginUrl: `${config.basePath}${a.loginUrl}` } : {}) });
      }
      const p = a.principal;
      if (!p.roles.length) return err(res, 403, 'no_role', '你的帳號沒有網站內容的角色（需要 CDC-WEB- 開頭的 AD 群組），請洽資訊室');
      if (method === 'POST') {
        const t = String(req.headers['x-csrf-token'] ?? '');
        const want = csrfFor(p);
        if (t.length !== want.length || !crypto.timingSafeEqual(Buffer.from(t), Buffer.from(want))) { audit.write('csrf-token', { actor: p, result: 'denied', detail: { path: sub } }); return err(res, 403, 'csrf', '頁面已過期，請重新整理後再試'); }
      }
      const ctx = { origin: originOf(req), basePath: config.basePath };

      if (method === 'GET') {
        if (sub === '/session') return send(res, 200, { user: { account: p.account, name: p.name, unit: p.primaryUnit, units: p.units, roles: p.roles }, csrfToken: csrfFor(p) });
        if (sub === '/items') {
          const v = ['mine', 'queue', 'all'].includes(String(searchParams.get('view'))) ? String(searchParams.get('view')) : 'mine';
          const cid = searchParams.get('contentId');
          return send(res, 200, { items: workflow.list(p, { view: v, contentId: cid && /^[a-z]+\.[a-z0-9.-]{1,120}$/.test(cid) ? cid : undefined }) });
        }
        const m = /^\/items\/(gw-\d{8}-[0-9a-f]{6})(\/diff|\/content|\/preview)?$/.exec(sub);
        if (m) {
          if (!m[2]) return send(res, 200, workflow.detail(p, m[1]));
          if (m[2] === '/diff') return send(res, 200, await workflow.diff(p, m[1]));
          if (m[2] === '/content') return send(res, 200, { item: await workflow.content(p, m[1]) });
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

      const body = await readBody(req);
      if (sub === '/drafts') return send(res, 200, await workflow.saveDraft(p, { item: body.item, submissionId: typeof body.submissionId === 'string' ? body.submissionId : undefined }));
      if (sub === '/submit') return send(res, 200, await workflow.submit(p, { item: body.item, submissionId: typeof body.submissionId === 'string' ? body.submissionId : undefined }, ctx));
      const m = /^\/items\/(gw-\d{8}-[0-9a-f]{6})\/(return|approve)$/.exec(sub);
      if (m && m[2] === 'return') return send(res, 200, await workflow.returnForChanges(p, { submissionId: m[1], comment: body.comment }, ctx));
      if (m && m[2] === 'approve') return send(res, 200, await workflow.approve(p, { submissionId: m[1], comment: body.comment }, ctx));
      return err(res, 404, 'notfound', '找不到');
    } catch (e) {
      if (e instanceof GatewayError) return err(res, e.status, e.code, e.message, e.fields);
      console.error('[gateway]', e?.message ?? e);
      return err(res, 500, 'server', '系統暫時無法處理，請稍後再試；若持續發生請洽資訊室');
    }
  }

  return { handle, workflow, git, audit, store, notifier, config: cfg, csrfFor, DEV_SESSION_HEADER };
}
