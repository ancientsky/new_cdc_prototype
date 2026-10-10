// @ts-check
// 寫入閘道的「身分轉接器」（第三十輪）：閘道只需要知道兩件事——這個人是誰、他在哪些 AD 群組。
// 至於他是怎麼登入的（Keycloak、AD FS、Entra ID、IIS Windows 驗證），交給轉接器，閘道其餘程式完全不知道。
//
//   dev     本機開發：讀後台頁送來的模擬 SSO 工作階段（/admin/login/ 選的示範帳號），只接受本機（loopback）連線
//   header  信任的反向代理（IIS Windows 驗證＋ARR、Apache mod_auth_gssapi、oauth2-proxy…）在標頭帶使用者與群組；
//           **只接受設定好的代理 IP**，其他來源帶這些標頭一律拒絕（否則任何人都能自稱局長）
//   oidc    Bearer token（Keycloak／AD FS／Entra ID 簽的 JWT），以設定的 JWKS 驗章、驗 iss／aud／exp
//
// 每個轉接器都回傳同樣形狀的 principal（principalFrom），角色對照只有一份（src/client/admin/auth-rules.js 的群組命名）。
import fs from 'node:fs';
import { parseAdGroup, sessionProblem, adGroupsOf, CROSS_UNIT_ROLES, GATEWAY_ROLE_OF, ROLES } from '../../../src/client/admin/auth-rules.js';
import { verifyJwt } from './jwt.mjs';

export const DEV_SESSION_HEADER = 'x-cdc-dev-session';
const LOOPBACK = /^(::1|127\.\d+\.\d+\.\d+)$/;
export const normIp = (ip) => String(ip ?? '').replace(/^::ffff:/, '');
export const isLoopback = (ip) => LOOPBACK.test(normIp(ip));

/** 帳號正規化：CDC\wang、wang@cdc.gov.tw → wang（小寫）；只允許常見帳號字元 */
export function normAccount(raw) {
  const s = String(raw ?? '').trim().replace(/^.*\\/, '').replace(/@.*$/, '').toLowerCase();
  return /^[a-z0-9][a-z0-9._-]{0,63}$/.test(s) ? s : null;
}

/**
 * 身分 → principal（閘道其餘程式只看這個）。
 * roles：給同事看的三種角色（編輯／審核／管理）；adminRoles：後台角色（auth-rules.js）；units：有任何角色的單位。
 * @param {{ account: string, name?: string, email?: string, groups?: string[] }} who
 * @param {string} authMode
 */
export function principalFrom({ account, name, email, groups = [] }, authMode) {
  const memberships = [];
  const ours = [];
  for (const g of groups) {
    const m = parseAdGroup(g);
    if (m && ROLES[m.role]) { memberships.push(m); ours.push(String(g).replace(/^.*\\/, '')); }
  }
  const adminRoles = [...new Set(memberships.map((m) => m.role))];
  const units = [...new Set(memberships.map((m) => m.unit))];
  const primary = memberships.find((m) => m.role === 'editor')?.unit ?? units[0] ?? null;
  return {
    account, name: String(name ?? '').trim().slice(0, 60) || account, email: email ?? null, authMode,
    groups: ours, memberships, units, primaryUnit: primary, adminRoles,
    roles: [...new Set(adminRoles.map((r) => GATEWAY_ROLE_OF[r]).filter(Boolean))],
    crossUnit: adminRoles.some((r) => CROSS_UNIT_ROLES.includes(r)),
  };
}

const fail = (status, code, message) => ({ ok: false, status, code, message });

/* ───────── dev ───────── */
export function createDevAuth({ now = () => Date.now() } = {}) {
  return {
    mode: 'dev',
    /** @param {import('node:http').IncomingMessage} req */
    async authenticate(req) {
      if (!isLoopback(req.socket?.remoteAddress)) return fail(403, 'dev_remote', '開發模式只接受本機連線');
      const raw = String(req.headers[DEV_SESSION_HEADER] ?? '');
      if (!raw) return fail(401, 'no_session', '請先登入後台');
      if (raw.length > 4096) return fail(400, 'bad_session', '登入資料格式不對');
      let s;
      try { s = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')); } catch { return fail(400, 'bad_session', '登入資料格式不對'); }
      const p = sessionProblem(s, now());
      if (p) return fail(401, `session_${p}`, '登入已逾時，請重新登入');
      const account = normAccount(s.sub);
      if (!account) return fail(400, 'bad_session', '登入資料格式不對');
      return { ok: true, principal: principalFrom({ account, name: s.name, email: `${account}@cdc-prototype.invalid`, groups: adGroupsOf(s) }, 'dev') };
    },
  };
}

/* ───────── header（信任的反向代理） ───────── */
function ipMatcher(list) {
  const rules = (list ?? []).map((x) => String(x).trim()).filter(Boolean).map((r) => {
    const m = /^(\d+\.\d+\.\d+\.\d+)\/(\d{1,2})$/.exec(r);
    if (!m) return (ip) => ip === r;
    const toInt = (a) => a.split('.').reduce((n, o) => n * 256 + Number(o), 0);
    const bits = Number(m[2]);
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    const net = (toInt(m[1]) & mask) >>> 0;
    return (ip) => /^\d+\.\d+\.\d+\.\d+$/.test(ip) && ((toInt(ip) & mask) >>> 0) === net;
  });
  return (ip) => rules.some((f) => f(normIp(ip)));
}
const hdr = (req, name) => { const v = req.headers[String(name).toLowerCase()]; return Array.isArray(v) ? v[0] : v; };
/** 名字可能是中文：代理以 percent-encoding（UTF-8）放進標頭（HTTP 標頭本身只保證 ASCII） */
function decodeHeaderText(v) { if (v == null) return undefined; try { return decodeURIComponent(String(v)); } catch { return String(v); } }

/**
 * @param {{ trustedProxies: string[], userHeader?: string, groupsHeader?: string, nameHeader?: string, emailHeader?: string, groupLookup?: (account: string) => Promise<string[]> }} opts
 */
export function createHeaderAuth({ trustedProxies, userHeader = 'x-remote-user', groupsHeader = 'x-remote-groups', nameHeader = 'x-remote-name', emailHeader = 'x-remote-email', groupLookup } = /** @type {any} */ ({})) {
  if (!trustedProxies?.length) throw new Error('header 模式必須設定 trustedProxies（反向代理的 IP）');
  const trusted = ipMatcher(trustedProxies);
  return {
    mode: 'header',
    trusts: (ip) => trusted(ip),
    /** @param {import('node:http').IncomingMessage} req */
    async authenticate(req) {
      const ip = req.socket?.remoteAddress;
      const user = hdr(req, userHeader);
      if (!trusted(ip)) return fail(401, user ? 'untrusted_proxy' : 'no_identity', user ? '身分標頭不是來自信任的代理，已拒絕' : '請先登入');
      const account = normAccount(user);
      if (!account) return fail(401, 'no_identity', '代理沒有帶使用者帳號');
      let groups = String(hdr(req, groupsHeader) ?? '').split(/[;,]/).map((g) => g.trim()).filter(Boolean);
      if (!groups.length && groupLookup) groups = await groupLookup(account); // IIS 只給帳號時，由閘道以 LDAP 查群組
      return { ok: true, principal: principalFrom({ account, name: decodeHeaderText(hdr(req, nameHeader)), email: hdr(req, emailHeader) ?? null, groups }, 'header') };
    },
  };
}

/* ───────── oidc ───────── */
/**
 * @param {{ issuer: string, audience: string|string[], jwks?: any, jwksFile?: string, jwksUri?: string, userClaim?: string, nameClaim?: string, emailClaim?: string, groupsClaim?: string, groupMap?: Record<string,string>, fetchFn?: typeof fetch, now?: () => number, cacheMs?: number }} opts
 */
export function createOidcAuth({ issuer, audience, jwks, jwksFile, jwksUri, userClaim = 'preferred_username', nameClaim = 'name', emailClaim = 'email', groupsClaim = 'groups', groupMap = {}, fetchFn = fetch, now = () => Date.now(), cacheMs = 10 * 60e3 }) {
  if (!issuer || !audience) throw new Error('oidc 模式必須設定 issuer 與 audience');
  if (!jwks && !jwksFile && !jwksUri) throw new Error('oidc 模式必須設定 jwks、jwksFile 或 jwksUri');
  let cached = jwks ?? (jwksFile ? JSON.parse(fs.readFileSync(jwksFile, 'utf8')) : null);
  let fetchedAt = jwks || jwksFile ? Infinity : 0;
  async function keys(force = false) {
    if (jwksUri && (force || now() - fetchedAt > cacheMs)) {
      const r = await fetchFn(jwksUri, { headers: { accept: 'application/json' } });
      if (!r.ok) throw new Error(`JWKS ${r.status}`);
      cached = await r.json(); fetchedAt = now();
    }
    return cached;
  }
  return {
    mode: 'oidc',
    /** @param {import('node:http').IncomingMessage} req */
    async authenticate(req) {
      const auth = String(hdr(req, 'authorization') ?? '');
      const token = /^Bearer\s+(\S+)$/i.exec(auth)?.[1] ?? hdr(req, 'x-forwarded-access-token');
      if (!token) return fail(401, 'no_token', '請先登入');
      let claims;
      try { claims = verifyJwt(String(token), { jwks: await keys(), issuer, audience, now: now() }); } catch (e) {
        // 金鑰輪替：找不到 kid 時重抓一次 JWKS
        if (e?.code === 'no_key' && jwksUri) { try { claims = verifyJwt(String(token), { jwks: await keys(true), issuer, audience, now: now() }); } catch (e2) { return fail(401, `token_${e2?.code ?? 'bad'}`, '登入憑證無效，請重新登入'); } }
        else return fail(401, `token_${e?.code ?? 'bad'}`, '登入憑證無效，請重新登入');
      }
      const account = normAccount(claims[userClaim] ?? claims.upn ?? claims.sub);
      if (!account) return fail(401, 'no_identity', '登入憑證沒有帳號');
      const rawGroups = Array.isArray(claims[groupsClaim]) ? claims[groupsClaim] : [];
      const groups = rawGroups.map((g) => groupMap[g] ?? String(g).replace(/^\//, '')); // Keycloak 完整路徑「/CDC-WEB-…」、Entra 物件 ID → 名稱
      return { ok: true, principal: principalFrom({ account, name: claims[nameClaim], email: claims[emailClaim] ?? null, groups }, 'oidc') };
    },
  };
}

/** 依設定建立轉接器 */
export function createAuth(cfg) {
  if (cfg.mode === 'header') return createHeaderAuth(cfg.header);
  if (cfg.mode === 'oidc') return createOidcAuth(cfg.oidc);
  return createDevAuth();
}
