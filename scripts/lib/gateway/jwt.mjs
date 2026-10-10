// @ts-check
// 最小的 JWT（JWS compact）驗證：只用 node:crypto，不加任何套件（第三十輪，docs/deploy.md §14）。
//
// 只做閘道需要的那一件事：「這張 token 是我們信任的 IdP 簽的、給我們的、還沒過期」。
// 支援 RS256／PS256／ES256（Keycloak 預設 RS256；AD FS 與 Entra ID 也是 RS256）。故意不支援 none 與 HS*：
// 對稱金鑰代表閘道與 IdP 共用祕密，任何拿到設定檔的人都能偽造身分。
import crypto from 'node:crypto';

const b64url = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const ALGS = {
  RS256: (key) => ({ hash: 'sha256', key }),
  PS256: (key) => ({ hash: 'sha256', key: { key, padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 } }),
  ES256: (key) => ({ hash: 'sha256', key: { key, dsaEncoding: 'ieee-p1363' } }),
};

export class JwtError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) { super(message); this.code = code; }
}

/** JWKS（{ keys: [...] }）中找出這張 token 要用的公鑰 */
function pickKey(jwks, header) {
  const keys = Array.isArray(jwks?.keys) ? jwks.keys : [];
  const usable = keys.filter((k) => !k.use || k.use === 'sig');
  const hit = header.kid ? usable.find((k) => k.kid === header.kid) : usable.length === 1 ? usable[0] : null;
  if (!hit) throw new JwtError('no_key', `找不到簽章金鑰（kid=${header.kid ?? '無'}）`);
  if (hit.alg && hit.alg !== header.alg) throw new JwtError('alg_mismatch', '金鑰演算法與 token 不符');
  return crypto.createPublicKey({ key: hit, format: 'jwk' });
}

/**
 * 驗證 JWT，成功回傳 claims；失敗丟 JwtError。
 * @param {string} token
 * @param {{ jwks: any, issuer?: string, audience?: string|string[], now?: number, clockSkewSec?: number, algorithms?: string[] }} opts
 */
export function verifyJwt(token, { jwks, issuer, audience, now = Date.now(), clockSkewSec = 60, algorithms = ['RS256', 'PS256', 'ES256'] }) {
  const parts = String(token ?? '').split('.');
  if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]*$/.test(p))) throw new JwtError('malformed', 'token 格式不對');
  let header, claims;
  try { header = JSON.parse(b64url(parts[0]).toString('utf8')); claims = JSON.parse(b64url(parts[1]).toString('utf8')); } catch { throw new JwtError('malformed', 'token 無法解析'); }
  if (!header || typeof header.alg !== 'string' || !algorithms.includes(header.alg) || !ALGS[header.alg]) throw new JwtError('alg', `不接受的演算法 ${header?.alg}`);
  const key = pickKey(jwks, header);
  const { hash, key: verifyKey } = ALGS[header.alg](key);
  const ok = crypto.verify(hash, Buffer.from(`${parts[0]}.${parts[1]}`), /** @type {any} */ (verifyKey), b64url(parts[2]));
  if (!ok) throw new JwtError('signature', '簽章不符');
  const t = Math.floor(now / 1000);
  if (typeof claims.exp !== 'number' || t > claims.exp + clockSkewSec) throw new JwtError('expired', 'token 已過期');
  if (typeof claims.nbf === 'number' && t + clockSkewSec < claims.nbf) throw new JwtError('not_yet', 'token 尚未生效');
  if (issuer && claims.iss !== issuer) throw new JwtError('issuer', '簽發者不符');
  if (audience) {
    const want = Array.isArray(audience) ? audience : [audience];
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!want.some((a) => aud.includes(a) || claims.azp === a)) throw new JwtError('audience', 'token 不是發給本閘道的');
  }
  return claims;
}

/**
 * 測試與本機演練用：用私鑰簽一張 token（正式環境由 IdP 簽，閘道不簽）
 * @param {object} claims
 * @param {any} privateKey
 * @param {{ alg?: string, kid?: string }} [opts]
 */
export function signJwtForTest(claims, privateKey, { alg = 'RS256', kid } = {}) {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = enc({ alg, typ: 'JWT', ...(kid ? { kid } : {}) });
  const body = enc(claims);
  const signer = alg === 'ES256' ? { key: privateKey, dsaEncoding: 'ieee-p1363' } : alg === 'PS256' ? { key: privateKey, padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 } : privateKey;
  const sig = crypto.sign('sha256', Buffer.from(`${head}.${body}`), /** @type {any} */ (signer)).toString('base64url');
  return `${head}.${body}.${sig}`;
}
