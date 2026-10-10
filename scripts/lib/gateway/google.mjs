// @ts-check
// Google Workspace 登入（第三十輪，Yulun 補充）：機關同事都有公司 Gmail（Workspace），這是最快能試辦的 SSO。
//
// 流程（OpenID Connect，授權碼＋PKCE）：
//   1. GET /api/gateway/login        → 302 到 accounts.google.com（帶 code_challenge=S256、state、nonce、hd=<機關網域>）
//   2. Google 登入（含兩步驟驗證）→ 302 回 /api/gateway/login/callback?code=&state=
//   3. 閘道用 code＋code_verifier（＋client secret）向 oauth2.googleapis.com/token 換 id_token，驗章與宣告：
//        iss 是 Google、aud 是本閘道、nonce 相符、email_verified=true、hd=機關網域、email 也必須是 @機關網域
//        （hd 只有 Workspace 帳號才有，個人 Gmail 沒有；只看 hd 或只看 email 都不夠，兩個都查）
//   4. 查角色（Google 的 ID token 沒有群組）：
//        (a) Google 群組：cdc-web-<unit>-<role>@網域（通常由 GCDS 從 AD 同步過來），以唯讀服務帳號呼叫 Admin SDK Directory API
//        (b) 後備：閘道設定檔裡的「email → 群組」對照（試辦期、群組還沒同步時用）
//   5. 發一個簽章的 HttpOnly 工作階段 cookie（8 小時；預設每 15 分鐘重查一次群組，離職或調動的延遲最多 15 分鐘）
// 絕不相信前端送來的 email：身分只來自閘道自己換到、自己驗過的 id_token。
import crypto from 'node:crypto';
import fs from 'node:fs';
import { verifyJwt } from './jwt.mjs';
import { principalFrom } from './auth.mjs';

export const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
export const SESSION_COOKIE = 'cdc_gw_session';
const LOGIN_COOKIE = 'cdc_gw_login';
const b64u = (buf) => Buffer.from(buf).toString('base64url');

/**
 * 驗 Google 的 id_token 並做網域檢查；回傳 claims，不合格丟 { code, message }。
 * @param {string} token
 * @param {{ jwks: any, clientId: string, domain: string, nonce?: string, now?: number }} o
 */
export function verifyGoogleIdToken(token, { jwks, clientId, domain, nonce, now = Date.now() }) {
  let claims;
  try { claims = verifyJwt(token, { jwks, audience: clientId, now }); } catch (e) { throw Object.assign(new Error(e.message), { code: `token_${e.code ?? 'bad'}` }); }
  const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
  if (!GOOGLE_ISSUERS.includes(claims.iss)) fail('token_issuer', '不是 Google 簽發的登入憑證');
  if (nonce != null && claims.nonce !== nonce) fail('token_nonce', '登入流程不一致，請重新登入');
  if (claims.email_verified !== true && claims.email_verified !== 'true') fail('email_unverified', 'Google 帳號的 email 尚未驗證');
  const d = String(domain).toLowerCase();
  if (String(claims.hd ?? '').toLowerCase() !== d) fail('hd', `只接受機關 Workspace 帳號（@${d}）`);
  const email = String(claims.email ?? '').toLowerCase();
  if (!email.endsWith(`@${d}`) || email.indexOf('@') !== email.lastIndexOf('@')) fail('email_domain', `只接受 @${d} 的帳號`);
  return claims;
}

/** Google 群組 email → AD 群組名稱（cdc-web-acute-infectious-editor@cdc.gov.tw → CDC-WEB-acute-infectious-editor） */
export const groupFromEmail = (e) => { const local = String(e).split('@')[0]; return /^cdc-web-/i.test(local) ? `CDC-WEB-${local.slice(8)}` : local; };

/**
 * 角色來源 (b)：設定檔對照 { "wang@cdc.gov.tw": ["CDC-WEB-acute-infectious-editor"], … }
 * @param {Record<string,string[]>|string} mapOrFile
 */
export function createRoleMapLookup(mapOrFile) {
  const map = typeof mapOrFile === 'string' ? JSON.parse(fs.readFileSync(mapOrFile, 'utf8')) : mapOrFile ?? {};
  const norm = Object.fromEntries(Object.entries(map).map(([k, v]) => [k.toLowerCase(), Array.isArray(v) ? v : []]));
  return async (email) => norm[String(email).toLowerCase()] ?? [];
}

/**
 * 角色來源 (a)：Admin SDK Directory API（groups.list?userKey=），以唯讀服務帳號＋全網域委派（sub＝一位唯讀管理員）呼叫。
 * 只要 scope admin.directory.group.readonly。Cloud Identity Groups API（searchTransitiveGroups）可替代，見 docs/deploy.md §14。
 * @param {{ serviceAccount: { client_email: string, private_key: string }, subject: string, domain: string, fetchFn?: typeof fetch, now?: () => number }} o
 */
export function createDirectoryLookup({ serviceAccount, subject, domain, fetchFn = fetch, now = () => Date.now() }) {
  let token = null, tokenExp = 0;
  async function accessToken() {
    if (token && now() < tokenExp - 60e3) return token;
    const iat = Math.floor(now() / 1000);
    const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const body = b64u(JSON.stringify({ iss: serviceAccount.client_email, sub: subject, scope: 'https://www.googleapis.com/auth/admin.directory.group.readonly', aud: GOOGLE_TOKEN_URL, iat, exp: iat + 3600 }));
    const sig = crypto.sign('sha256', Buffer.from(`${head}.${body}`), serviceAccount.private_key).toString('base64url');
    const r = await fetchFn(GOOGLE_TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${body}.${sig}` }).toString() });
    if (!r.ok) throw new Error(`Google token ${r.status}`);
    const j = await r.json();
    token = j.access_token; tokenExp = now() + (j.expires_in ?? 3600) * 1000;
    return token;
  }
  return async (email) => {
    const out = [];
    let page = '';
    do {
      const u = new URL('https://admin.googleapis.com/admin/directory/v1/groups');
      u.searchParams.set('userKey', email); u.searchParams.set('domain', domain); u.searchParams.set('maxResults', '200');
      if (page) u.searchParams.set('pageToken', page);
      const r = await fetchFn(u.toString(), { headers: { authorization: `Bearer ${await accessToken()}`, accept: 'application/json' } });
      if (!r.ok) throw new Error(`Directory API ${r.status}`);
      const j = await r.json();
      for (const g of j.groups ?? []) out.push(groupFromEmail(g.email));
      page = j.nextPageToken ?? '';
    } while (page);
    return out;
  };
}

/* ───────── 簽章 cookie ───────── */
function seal(secret, obj) { const p = b64u(JSON.stringify(obj)); return `${p}.${crypto.createHmac('sha256', secret).update(p).digest('base64url')}`; }
function unseal(secret, v) {
  const [p, s] = String(v ?? '').split('.');
  if (!p || !s) return null;
  const want = crypto.createHmac('sha256', secret).update(p).digest('base64url');
  if (s.length !== want.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(want))) return null;
  try { return JSON.parse(Buffer.from(p, 'base64url').toString('utf8')); } catch { return null; }
}
export function readCookie(req, name) {
  for (const part of String(req.headers.cookie ?? '').split(';')) { const i = part.indexOf('='); if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim()); }
  return null;
}
const cookie = (name, value, { maxAge, secure, path = '/' }) => `${name}=${encodeURIComponent(value)}; Path=${path}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}; Max-Age=${maxAge}`;

/**
 * Google 轉接器（auth 介面＋登入端點）。
 * @param {{ clientId: string, clientSecret?: string, domain: string, redirectUri: string, jwks?: any, jwksUri?: string, groupLookup?: (email: string) => Promise<string[]>, roleMap?: Record<string,string[]>|string, sessionSecret?: string, sessionHours?: number, recheckMinutes?: number, fetchFn?: typeof fetch, now?: () => number, secureCookie?: boolean }} o
 */
export function createGoogleAuth({ clientId, clientSecret = '', domain, redirectUri, jwks, jwksUri = GOOGLE_JWKS_URL, groupLookup, roleMap, sessionSecret, sessionHours = 8, recheckMinutes = 15, fetchFn = fetch, now = () => Date.now(), secureCookie = true }) {
  if (!clientId || !domain || !redirectUri) throw new Error('google 模式需要 clientId、domain、redirectUri');
  const secret = sessionSecret ? Buffer.from(sessionSecret) : crypto.randomBytes(32);
  const fallback = roleMap ? createRoleMapLookup(roleMap) : null;
  let keys = jwks ?? null, keysAt = jwks ? Infinity : 0;
  async function getKeys(force = false) {
    if (force || now() - keysAt > 3600e3) { const r = await fetchFn(jwksUri); if (!r.ok) throw new Error(`JWKS ${r.status}`); keys = await r.json(); keysAt = now(); }
    return keys;
  }
  /** 群組：先 Google 群組（目錄 API），查不到任何本站群組再看後備對照檔 */
  async function groupsOf(email) {
    let g = [];
    if (groupLookup) { try { g = await groupLookup(email); } catch (e) { console.error('[gateway] Google 群組查詢失敗：', e?.message ?? e); } }
    if (!g.some((x) => /^CDC-WEB-/i.test(x)) && fallback) g = [...g, ...(await fallback(email))];
    return g;
  }
  async function verify(token, nonce) {
    try { return verifyGoogleIdToken(token, { jwks: await getKeys(), clientId, domain, nonce, now: now() }); } catch (e) {
      if (e.code === 'token_no_key' && !jwks) return verifyGoogleIdToken(token, { jwks: await getKeys(true), clientId, domain, nonce, now: now() });
      throw e;
    }
  }
  const toPrincipal = (s) => principalFrom({ account: s.email.split('@')[0], name: s.name, email: s.email, groups: s.groups }, 'google');

  return {
    mode: 'google',
    /** 登入：產生 PKCE verifier、state、nonce，存在短效簽章 cookie，轉去 Google */
    loginRedirect(next = '/admin/') {
      const verifier = b64u(crypto.randomBytes(32));
      const challenge = b64u(crypto.createHash('sha256').update(verifier).digest());
      const state = b64u(crypto.randomBytes(16)), nonce = b64u(crypto.randomBytes(16));
      const u = new URL(GOOGLE_AUTH_URL);
      for (const [k, v] of Object.entries({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: 'openid email profile', code_challenge: challenge, code_challenge_method: 'S256', state, nonce, hd: domain, prompt: 'select_account' })) u.searchParams.set(k, v);
      const safeNext = /^\/admin\/[\w\-/?=&.%]*$/.test(next) ? next : '/admin/';
      return { location: u.toString(), setCookie: cookie(LOGIN_COOKIE, seal(secret, { verifier, state, nonce, next: safeNext, exp: now() + 10 * 60e3 }), { maxAge: 600, secure: secureCookie }) };
    },
    /** 回呼：驗 state → 以 code＋verifier 換 token → 驗 id_token → 查群組 → 發工作階段 cookie */
    async callback(req, searchParams) {
      const login = unseal(secret, readCookie(req, LOGIN_COOKIE));
      if (!login || login.exp < now()) return { ok: false, status: 400, code: 'login_expired', message: '登入逾時，請重新登入' };
      const st = String(searchParams.get('state') ?? '');
      if (st.length !== login.state.length || !crypto.timingSafeEqual(Buffer.from(st), Buffer.from(login.state))) return { ok: false, status: 400, code: 'state', message: '登入流程不一致，請重新登入' };
      const code = searchParams.get('code');
      if (!code) return { ok: false, status: 400, code: 'no_code', message: '登入未完成' };
      const r = await fetchFn(GOOGLE_TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: clientId, code_verifier: login.verifier, ...(clientSecret ? { client_secret: clientSecret } : {}) }).toString() });
      if (!r.ok) return { ok: false, status: 401, code: 'exchange', message: '登入失敗，請重新登入' };
      const tok = await r.json();
      let claims;
      try { claims = await verify(String(tok.id_token ?? ''), login.nonce); } catch (e) { return { ok: false, status: 403, code: e.code ?? 'token', message: e.message }; }
      const email = String(claims.email).toLowerCase();
      const s = { email, name: String(claims.name ?? email), groups: await groupsOf(email), iat: now(), checkedAt: now(), exp: now() + sessionHours * 3600e3 };
      return { ok: true, principal: toPrincipal(s), next: login.next, setCookie: [cookie(SESSION_COOKIE, seal(secret, s), { maxAge: sessionHours * 3600, secure: secureCookie }), cookie(LOGIN_COOKIE, '', { maxAge: 0, secure: secureCookie })] };
    },
    logout() { return { setCookie: cookie(SESSION_COOKIE, '', { maxAge: 0, secure: secureCookie }) }; },
    /** 每個請求：Bearer id_token（自動化工具）或閘道自己發的工作階段 cookie；群組定期重查 */
    async authenticate(req, res) {
      const bearer = /^Bearer\s+(\S+)$/i.exec(String(req.headers.authorization ?? ''))?.[1];
      if (bearer) {
        try { const c = await verify(bearer); const email = String(c.email).toLowerCase(); return { ok: true, principal: toPrincipal({ email, name: String(c.name ?? email), groups: await groupsOf(email) }) }; } catch (e) { return { ok: false, status: 401, code: e.code ?? 'token', message: '登入憑證無效，請重新登入' }; }
      }
      const s = unseal(secret, readCookie(req, SESSION_COOKIE));
      if (!s || !(s.exp > now()) || !String(s.email ?? '').endsWith(`@${String(domain).toLowerCase()}`)) return { ok: false, status: 401, code: 'login_required', message: '請用機關 Google 帳號登入', loginUrl: '/api/gateway/login' };
      if (now() - s.checkedAt > recheckMinutes * 60e3) { // 群組定期重查：離開群組（或停用帳號）最晚 recheckMinutes 分鐘後失去權限
        s.groups = await groupsOf(s.email); s.checkedAt = now();
        res?.setHeader?.('Set-Cookie', cookie(SESSION_COOKIE, seal(secret, s), { maxAge: Math.max(0, Math.floor((s.exp - now()) / 1000)), secure: secureCookie }));
      }
      return { ok: true, principal: toPrincipal(s) };
    },
  };
}
