// 第三十輪：寫入閘道（issue #28）——同事按按鈕，閘道代寫 Git。
//   單元：AD 群組 ↔ 角色、三種身分轉接器（dev／header 只信任代理 IP／oidc 驗章）、寫入前驗證（白話欄位錯誤、路徑穿越）、
//        白話欄位差異、local Git 供應者（分支、提交尾註、合併、衝突）、GitLab 供應者的請求形狀（假 fetch）、
//        工作流程（四眼原則、角色、單位、發布車道、通知、稽核雜湊鏈）、HTTP 層（同源＋CSRF token、大小上限、Content-Type）。
//   端到端：Playwright 開開發伺服器，承辦人存草稿 → 送審 → 另一位審核人退回（意見必填）→ 承辦人修改再送審 → 審核人核准上線 → 本機版本庫 main 上的檔案真的改了。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { config } from '../site.config.mjs';
import { parseAdGroup, adGroupName, adGroupsOf, makeSession, DEMO_ACCOUNTS } from '../src/client/admin/auth-rules.js';
import { principalFrom, createDevAuth, createHeaderAuth, createOidcAuth, normAccount, DEV_SESSION_HEADER } from '../scripts/lib/gateway/auth.mjs';
import { verifyJwt, signJwtForTest } from '../scripts/lib/gateway/jwt.mjs';
import { verifyGoogleIdToken, createGoogleAuth, createDirectoryLookup, groupFromEmail, SESSION_COOKIE } from '../scripts/lib/gateway/google.mjs';
import { createValidator, contentPathOf, assertContentPath, plainError } from '../scripts/lib/gateway/validate-item.mjs';
import { fieldDiff, textDiff } from '../scripts/lib/gateway/field-diff.mjs';
import { createLocalGit } from '../scripts/lib/gateway/git-local.mjs';
import { createGitLab } from '../scripts/lib/gateway/git-gitlab.mjs';
import { createGatewayApi } from '../scripts/lib/gateway/index.mjs';
import { verifyAudit } from '../scripts/lib/gateway/store.mjs';
import { createDemoDirectory } from '../scripts/lib/gateway/workflow.mjs';
import { loadLanes } from '../scripts/lib/lanes.mjs';
import { parseEml } from '../scripts/lib/mail-outbox.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmpDir = (p = 'gw-') => fs.mkdtempSync(path.join(os.tmpdir(), p));
const req = (ip, headers = {}) => ({ socket: { remoteAddress: ip }, headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])) });
const acct = (sub) => DEMO_ACCOUNTS.find((a) => a.sub === sub);
const P = (sub) => principalFrom({ account: normAccount(sub), name: acct(sub).name, email: `${sub}@cdc-prototype.invalid`, groups: adGroupsOf(acct(sub)) }, 'dev');
const GIT_WORDS = /分支|branch|commit|提交|合併|merge|pull request|\bPR\b|\bMR\b|GitLab|GitHub|\bgit\b/i;

/** 一筆合法的 Q&A（與後台匯出同形狀） */
function faq(id = `faq.gw-test-${crypto.randomBytes(3).toString('hex')}`, over = {}) {
  return {
    id, type: 'faq', title: '登革熱發燒要多久就醫？', question: '登革熱發燒要多久就醫？', owner: 'unit.acute-infectious', steward: '急性傳染病組承辦人',
    publishedAt: '2026-10-10', reviewedAt: '2026-10-10', reviewPeriodMonths: 6, status: 'draft', audience: ['public'], tasks: ['symptoms'], sensitivity: 'public', license: 'OGDL-1.0',
    languages: { 'zh-TW': { status: 'source' } }, summary: '出現發燒請儘速就醫。告知醫師旅遊史。',
    answerMarkdown: '出現發燒、頭痛、後眼窩痛時，請儘速就醫。就醫時告知醫師旅遊史與活動地點。', ...over,
  };
}

// ───────────────────────── AD 群組 ↔ 角色 ─────────────────────────
test('AD 群組命名：CDC-WEB-<單位>-<角色> 雙向；含連字號的角色與網域前綴都認得', () => {
  assert.equal(adGroupName('unit.acute-infectious', 'editor'), 'CDC-WEB-acute-infectious-editor');
  assert.deepEqual(parseAdGroup('CDC-WEB-acute-infectious-editor'), { unit: 'unit.acute-infectious', role: 'editor' });
  assert.deepEqual(parseAdGroup('CDC\\CDC-WEB-pr-chief-editor'), { unit: 'unit.pr', role: 'chief-editor' });
  assert.deepEqual(parseAdGroup('cdc-web-epidemic-intelligence-situation-publisher'), { unit: 'unit.epidemic-intelligence', role: 'situation-publisher' });
  assert.equal(parseAdGroup('Domain Users'), null);
  assert.equal(parseAdGroup('CDC-WEB-pr-superuser'), null);
  const p = principalFrom({ account: 'x', groups: ['CDC-WEB-pr-editor', 'CDC-WEB-pr-reviewer', 'CDC-WEB-it-platform', 'Domain Users'] }, 'header');
  assert.deepEqual(p.roles.sort(), ['審核', '管理', '編輯'].sort());
  assert.equal(p.primaryUnit, 'unit.pr');
  assert.equal(p.crossUnit, true, 'platform 是跨單位角色');
  assert.deepEqual(p.groups, ['CDC-WEB-pr-editor', 'CDC-WEB-pr-reviewer', 'CDC-WEB-it-platform'], '不相干的群組不帶進來');
  assert.equal(normAccount('CDC\\Wang.An'), 'wang.an');
  assert.equal(normAccount('wang@cdc.gov.tw'), 'wang');
  assert.equal(normAccount('a b'), null);
});

// ───────────────────────── 身分轉接器 ─────────────────────────
test('header 轉接器：只信任設定的代理 IP（含 CIDR）；其他來源帶身分標頭一律拒絕', async () => {
  const a = createHeaderAuth({ trustedProxies: ['10.1.2.3', '192.168.10.0/24'] });
  const H = { 'X-Remote-User': 'CDC\\wang', 'X-Remote-Groups': 'CDC-WEB-acute-infectious-editor;CDC-WEB-acute-infectious-reviewer', 'X-Remote-Name': encodeURIComponent('王○安') };
  const ok = await a.authenticate(req('10.1.2.3', H));
  assert.equal(ok.ok, true);
  assert.equal(ok.principal.account, 'wang');
  assert.equal(ok.principal.name, '王○安', '中文姓名以 percent-encoding 傳遞');
  assert.deepEqual(ok.principal.roles.sort(), ['審核', '編輯'].sort());
  assert.equal((await a.authenticate(req('::ffff:192.168.10.77', H))).ok, true, 'CIDR 範圍內（IPv4-mapped IPv6）');
  for (const ip of ['127.0.0.1', '10.1.2.4', '192.168.11.1', '::1']) {
    const r = await a.authenticate(req(ip, H));
    assert.equal(r.ok, false, `${ip} 不是代理`);
    assert.equal(r.code, 'untrusted_proxy');
  }
  assert.equal((await a.authenticate(req('10.1.2.3', {}))).code, 'no_identity');
  assert.throws(() => createHeaderAuth({ trustedProxies: [] }), /trustedProxies/);
  // IIS 只給帳號：由群組查詢（LDAP）補
  const b = createHeaderAuth({ trustedProxies: ['10.1.2.3'], groupLookup: async (acc) => (acc === 'lin' ? ['CDC-WEB-pr-reviewer'] : []) });
  assert.deepEqual((await b.authenticate(req('10.1.2.3', { 'X-Remote-User': 'CDC\\lin' }))).principal.roles, ['審核']);
});

test('dev 轉接器：讀後台送來的模擬工作階段；只接受本機連線；逾時拒絕', async () => {
  const a = createDevAuth();
  const s = makeSession(acct('demo-002'));
  const h = { [DEV_SESSION_HEADER]: Buffer.from(JSON.stringify(s)).toString('base64url') };
  const r = await a.authenticate(req('127.0.0.1', h));
  assert.equal(r.ok, true);
  assert.equal(r.principal.account, 'demo-002');
  assert.deepEqual(r.principal.groups, ['CDC-WEB-acute-infectious-editor', 'CDC-WEB-acute-infectious-reviewer']);
  assert.equal((await a.authenticate(req('10.0.0.5', h))).code, 'dev_remote');
  const old = makeSession(acct('demo-002'), { now: Date.now() - 9 * 3600e3 });
  assert.equal((await a.authenticate(req('127.0.0.1', { [DEV_SESSION_HEADER]: Buffer.from(JSON.stringify(old)).toString('base64url') }))).ok, false);
  assert.equal((await a.authenticate(req('127.0.0.1', { [DEV_SESSION_HEADER]: 'not-json' }))).code, 'bad_session');
});

test('oidc 轉接器：JWKS 驗章、iss／aud／exp；拒絕 alg none、竄改、過期、發給別人的 token', async () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', use: 'sig', alg: 'RS256' };
  const iss = 'https://sso.cdc.example/realms/cdc', aud = 'cdc-web-gateway';
  const now = Date.now();
  const claims = { iss, aud, sub: 'u1', preferred_username: 'lin', name: '林○慧', groups: ['/CDC-WEB-acute-infectious-reviewer', 'other'], exp: Math.floor(now / 1000) + 300, iat: Math.floor(now / 1000) };
  const tok = signJwtForTest(claims, privateKey, { kid: 'k1' });
  const a = createOidcAuth({ issuer: iss, audience: aud, jwks: { keys: [jwk] } });
  const r = await a.authenticate(req('203.0.113.9', { Authorization: `Bearer ${tok}` }));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.principal.account, 'lin');
  assert.deepEqual(r.principal.roles, ['審核'], 'Keycloak 的群組完整路徑（/開頭）也認得');
  const bad = async (t) => (await a.authenticate(req('1.1.1.1', { Authorization: `Bearer ${t}` }))).code;
  assert.equal(await bad(signJwtForTest({ ...claims, aud: 'other-app' }, privateKey, { kid: 'k1' })), 'token_audience');
  assert.equal(await bad(signJwtForTest({ ...claims, iss: 'https://evil' }, privateKey, { kid: 'k1' })), 'token_issuer');
  assert.equal(await bad(signJwtForTest({ ...claims, exp: Math.floor(now / 1000) - 3600 }, privateKey, { kid: 'k1' })), 'token_expired');
  const [h, , s] = tok.split('.');
  const forged = `${h}.${Buffer.from(JSON.stringify({ ...claims, groups: ['CDC-WEB-it-platform'] })).toString('base64url')}.${s}`;
  assert.equal(await bad(forged), 'token_signature');
  const none = `${Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.`;
  assert.equal(await bad(none), 'token_alg');
  const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  assert.equal(await bad(signJwtForTest(claims, other.privateKey, { kid: 'k1' })), 'token_signature');
  assert.equal((await a.authenticate(req('1.1.1.1', {}))).code, 'no_token');
  // ES256 與 JWKS 網址（金鑰輪替時重抓）
  const ec = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  let fetched = 0;
  const b = createOidcAuth({ issuer: iss, audience: aud, jwksUri: 'https://sso/jwks', fetchFn: async () => { fetched++; return { ok: true, json: async () => ({ keys: [{ ...ec.publicKey.export({ format: 'jwk' }), kid: 'e1' }] }) }; } });
  const r2 = await b.authenticate(req('1.1.1.1', { Authorization: `Bearer ${signJwtForTest(claims, ec.privateKey, { alg: 'ES256', kid: 'e1' })}` }));
  assert.equal(r2.ok, true);
  assert.equal(fetched, 1);
  assert.throws(() => verifyJwt('a.b', { jwks: { keys: [] } }), /格式/);
});

// ───────────────────────── Google Workspace 登入 ─────────────────────────
test('Google：id_token 必須 hd＝機關網域、email_verified、email 也是機關網域；iss／aud 也要對', () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwks = { keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'g1', alg: 'RS256', use: 'sig' }] };
  const now = Date.now();
  const base = { iss: 'https://accounts.google.com', aud: 'cid.apps.googleusercontent.com', sub: '1001', email: 'wang@cdc.gov.tw', email_verified: true, hd: 'cdc.gov.tw', name: '王○安', nonce: 'n1', exp: Math.floor(now / 1000) + 600 };
  const tok = (over = {}) => signJwtForTest({ ...base, ...over }, privateKey, { kid: 'g1' });
  const v = (t, nonce = 'n1') => { try { verifyGoogleIdToken(t, { jwks, clientId: 'cid.apps.googleusercontent.com', domain: 'cdc.gov.tw', nonce, now }); return 'ok'; } catch (e) { return e.code; } };
  assert.equal(v(tok()), 'ok');
  assert.equal(v(tok({ iss: 'accounts.google.com' })), 'ok', 'Google 兩種 iss 寫法都接受');
  assert.equal(v(tok({ hd: undefined })), 'hd', '個人 Gmail 沒有 hd');
  assert.equal(v(tok({ hd: 'other.gov.tw' })), 'hd');
  assert.equal(v(tok({ email_verified: false })), 'email_unverified');
  assert.equal(v(tok({ email: 'wang@gmail.com' })), 'email_domain', 'hd 對但 email 不是機關網域');
  assert.equal(v(tok({ email: 'x@evil.com@cdc.gov.tw' })), 'email_domain');
  assert.equal(v(tok({ iss: 'https://evil.example' })), 'token_issuer');
  assert.equal(v(tok({ aud: 'someone-else' })), 'token_audience');
  assert.equal(v(tok(), 'other-nonce'), 'token_nonce');
  assert.equal(groupFromEmail('cdc-web-acute-infectious-editor@cdc.gov.tw'), 'CDC-WEB-acute-infectious-editor');
});

test('Google：授權碼＋PKCE 登入、群組（目錄 API → 對照檔後備）、簽章工作階段；前端送的 email 一律不信', async () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwks = { keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'g1' }] };
  let t = Date.now();
  const sa = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const calls = [];
  let pending = { nonce: '' };
  const fakeFetch = async (u, init = {}) => {
    calls.push({ u: String(u), init });
    const json = (body, status = 200) => ({ ok: status < 300, status, json: async () => body });
    if (String(u) === 'https://oauth2.googleapis.com/token') {
      const form = new URLSearchParams(init.body);
      if (form.get('grant_type') === 'urn:ietf:params:oauth:grant-type:jwt-bearer') return json({ access_token: 'sa-token', expires_in: 3600 });
      return json({ id_token: signJwtForTest({ iss: 'https://accounts.google.com', aud: 'cid', email: form.get('code') === 'lin' ? 'lin@cdc.gov.tw' : 'wang@cdc.gov.tw', email_verified: true, hd: 'cdc.gov.tw', name: '林○慧', nonce: pending.nonce, exp: Math.floor(t / 1000) + 600 }, privateKey, { kid: 'g1' }) });
    }
    if (String(u).startsWith('https://admin.googleapis.com/admin/directory/v1/groups')) {
      const q = new URL(u).searchParams;
      if (q.get('userKey') !== 'lin@cdc.gov.tw') return json({ groups: [] });
      return q.get('pageToken') ? json({ groups: [{ email: 'cdc-web-acute-infectious-reviewer@cdc.gov.tw' }] }) : json({ groups: [{ email: 'all-staff@cdc.gov.tw' }], nextPageToken: 'p2' });
    }
    return json({}, 404);
  };
  const lookup = createDirectoryLookup({ serviceAccount: { client_email: 'gw-reader@proj.iam.gserviceaccount.com', private_key: sa.privateKey.export({ type: 'pkcs8', format: 'pem' }) }, subject: 'directory-reader@cdc.gov.tw', domain: 'cdc.gov.tw', fetchFn: fakeFetch, now: () => t });
  const g = createGoogleAuth({ clientId: 'cid', clientSecret: 's', domain: 'cdc.gov.tw', redirectUri: 'https://web.cdc.gov.tw/api/gateway/login/callback', jwks, groupLookup: lookup, roleMap: { 'wang@cdc.gov.tw': ['CDC-WEB-acute-infectious-editor'] }, sessionSecret: 'sek', fetchFn: fakeFetch, now: () => t });
  // ① 轉去 Google
  const lr = g.loginRedirect('/admin/publish/');
  const u = new URL(lr.location);
  assert.equal(u.origin + u.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(u.searchParams.get('response_type'), 'code');
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
  assert.match(u.searchParams.get('code_challenge'), /^[A-Za-z0-9_-]{43}$/);
  assert.equal(u.searchParams.get('hd'), 'cdc.gov.tw');
  assert.match(lr.setCookie, /HttpOnly; SameSite=Lax; Secure/);
  pending = { nonce: u.searchParams.get('nonce') }; // 假的 Google 依登入請求的 nonce 簽 id_token
  const loginCookie = lr.setCookie.split(';')[0];
  // ② 回呼：state 不對 ⇒ 拒絕
  assert.equal((await g.callback(req('1.1.1.1', { cookie: loginCookie }), new URLSearchParams({ code: 'lin', state: 'x' }))).code, 'state');
  const cb = await g.callback(req('1.1.1.1', { cookie: loginCookie }), new URLSearchParams({ code: 'lin', state: u.searchParams.get('state') }));
  assert.equal(cb.ok, true, JSON.stringify(cb));
  assert.equal(cb.principal.account, 'lin');
  assert.deepEqual(cb.principal.roles, ['審核'], '群組來自 Google 群組（目錄 API，跨頁）');
  const exch = new URLSearchParams(calls.find((c) => c.init.body && /authorization_code/.test(c.init.body)).init.body);
  assert.ok(exch.get('code_verifier') && exch.get('code_verifier').length >= 43, '換 token 時帶 PKCE verifier');
  const saCall = new URLSearchParams(calls.find((c) => c.init.body && /jwt-bearer/.test(c.init.body)).init.body);
  const assertion = verifyJwt(saCall.get('assertion'), { jwks: { keys: [{ ...sa.publicKey.export({ format: 'jwk' }) }] }, now: t });
  assert.equal(assertion.scope, 'https://www.googleapis.com/auth/admin.directory.group.readonly', '目錄 API 只要唯讀權限');
  assert.equal(assertion.sub, 'directory-reader@cdc.gov.tw');
  // ③ 工作階段 cookie
  const sess = cb.setCookie[0].split(';')[0];
  const a1 = await g.authenticate(req('1.1.1.1', { cookie: sess, 'x-remote-user': 'boss', 'x-remote-email': 'boss@cdc.gov.tw' }));
  assert.equal(a1.principal.account, 'lin', '前端或代理送來的 email／帳號標頭一律忽略');
  const forged = `${SESSION_COOKIE}=${Buffer.from(JSON.stringify({ email: 'boss@cdc.gov.tw', groups: ['CDC-WEB-it-platform'], exp: t + 1e7 })).toString('base64url')}.AAAA`;
  const a2 = await g.authenticate(req('1.1.1.1', { cookie: forged }));
  assert.equal(a2.ok, false); assert.equal(a2.loginUrl, '/api/gateway/login');
  // ④ 後備對照檔：目錄沒有本站群組時才用
  const lr2 = g.loginRedirect(); pending = { nonce: new URL(lr2.location).searchParams.get('nonce') };
  const cb2 = await g.callback(req('1.1.1.1', { cookie: lr2.setCookie.split(';')[0] }), new URLSearchParams({ code: 'wang', state: new URL(lr2.location).searchParams.get('state') }));
  assert.deepEqual(cb2.principal.roles, ['編輯']);
  // ⑤ 群組定期重查（15 分鐘）＋過期
  t += 16 * 60e3;
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; } };
  assert.equal((await g.authenticate(req('1.1.1.1', { cookie: sess }), res)).ok, true);
  assert.match(res.headers['Set-Cookie'], new RegExp(`^${SESSION_COOKIE}=`));
  t += 9 * 3600e3;
  assert.equal((await g.authenticate(req('1.1.1.1', { cookie: sess }))).code, 'login_required');
  assert.throws(() => createGoogleAuth({ clientId: 'c', domain: 'cdc.gov.tw' }), /redirectUri/);
});

// ───────────────────────── 寫入前驗證 ─────────────────────────
const validator = createValidator();
test('驗證：合法內容通過；欄位錯誤翻成白話中文並標出欄位', () => {
  const ok = validator.validate(faq());
  assert.equal(ok.ok, true, JSON.stringify(ok.errors));
  assert.match(ok.path, /^content\/faq\/gw-test-[0-9a-f]{6}\.json$/);
  const bad = validator.validate(faq(undefined, { title: '', owner: 'unit.nope', audience: ['aliens'], summary: undefined, reviewedAt: '10/10/2026' }));
  assert.equal(bad.ok, false);
  const by = Object.fromEntries(bad.errors.map((e) => [e.field, e.message]));
  assert.match(by.title, /「標題」不能空白/);
  assert.match(by.summary, /「摘要」必填/);
  assert.match(by.owner, /「權責單位」unit\.nope 不在單位主檔/);
  assert.match(by.audience, /選項不在允許的清單內/);
  assert.match(by.reviewedAt, /日期請寫成 2026-10-10/);
  for (const e of bad.errors) assert.doesNotMatch(e.message, /must |instancePath/, `沒有英文原文：${e.message}`);
  assert.deepEqual(plainError("/ must have required property 'question'"), { field: 'question', label: '問題', message: '「問題」必填，請補上' });
});

test('路徑：只由型別與 id 推出、只能在 content/ 內；路徑穿越與不開放的型別一律拒絕', () => {
  assert.deepEqual(contentPathOf({ type: 'letter', id: 'news.2026-10-10-x' }), { ok: true, path: 'content/news/2026-10-10-x.json', dir: 'news' });
  assert.equal(contentPathOf({ type: 'document', id: 'doc.case-definition-dengue.2026-01-01' }).path, 'content/documents/case-definition-dengue.2026-01-01.json');
  for (const id of ['faq.../../../etc/passwd', 'faq.a/../../b', 'faq..hidden', 'FAQ.x', 'faq.x\u0000', 'faq.a..b', '../faq.x', 'faq.x/y']) {
    const r = contentPathOf({ type: 'faq', id });
    assert.equal(r.ok, false, id);
    assert.equal(r.errors[0].field, 'id');
  }
  for (const type of ['situation', 'migration', 'master', '../x', undefined]) assert.equal(contentPathOf({ type, id: 'faq.x' }).ok, false, String(type));
  assert.throws(() => assertContentPath('content/../scripts/build.mjs'), /outside/);
  assert.throws(() => assertContentPath('scripts/x.json'), /outside/);
  assert.equal(assertContentPath('content/faq/x.json'), 'content/faq/x.json');
  const v = validator.validate({ ...faq(), id: 'faq.../../x' });
  assert.equal(v.ok, false);
  assert.equal(v.path, undefined, '不合法的 id 根本不會產生路徑');
});

// ───────────────────────── 白話欄位差異 ─────────────────────────
test('白話差異：「摘要：第 2 句改了」，改前改後逐字標出；清單說新增／移除', () => {
  const d = textDiff('出現發燒請儘速就醫。告知醫師旅遊史。', '出現發燒請儘速就醫。告知醫師旅遊史與活動地點。');
  assert.equal(d.summary, '第 2 句改了');
  assert.equal(d.after[1].mark, 'changed');
  assert.deepEqual(d.after[1].parts.filter((x) => x.ch).map((x) => x.t), ['與活動地點']);
  const fd = fieldDiff(faq('faq.a'), faq('faq.a', { summary: '出現發燒請儘速就醫。告知醫師旅遊史與活動地點。', audience: ['public', 'professional'], owner: 'unit.pr', title: '新標題' }), { unitNames: { 'unit.acute-infectious': '急性傳染病組', 'unit.pr': '公關室' } });
  const by = Object.fromEntries(fd.changes.map((c) => [c.field, c]));
  assert.equal(fd.isNew, false);
  assert.equal(by.summary.summary, '第 2 句改了');
  assert.equal(by.audience.summary, '新增：professional');
  assert.equal(by.owner.summary, '由「急性傳染病組」改為「公關室」');
  assert.equal(by.title.label, '標題');
  assert.equal(fd.changes[0].field, 'title', '標題排第一');
  assert.ok(!by.status, '狀態欄（草稿／送審）不列入差異');
  assert.equal(textDiff('一。二。三。', '一。三。四。五。').summary, '新增第 3、4 句；刪除原第 2 句');
  const nd = fieldDiff(null, faq('faq.b'));
  assert.equal(nd.isNew, true);
  assert.ok(nd.changes.length > 3);
});

// ───────────────────────── local Git 供應者 ─────────────────────────
function seed() {
  const d = tmpDir('gw-seed-');
  fs.mkdirSync(path.join(d, 'faq'), { recursive: true });
  fs.writeFileSync(path.join(d, 'faq', 'old.json'), `${JSON.stringify(faq('faq.old'), null, 2)}\n`);
  return d;
}
const gitOut = (dir, args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' });

test('local Git：bare repo、分支、提交（服務帳號）、合併（--no-ff）、刪來源分支、衝突時 main 不動', async () => {
  const dir = path.join(tmpDir(), 'repo');
  const g = createLocalGit({ dir, seedDir: seed() });
  await g.ensureReady();
  await g.ensureReady(); // 冪等
  assert.match(await g.readFile('main', 'content/faq/old.json'), /faq\.old/);
  assert.equal(await g.readFile('main', 'content/faq/none.json'), null);
  await g.createBranch('cms/a');
  const c1 = await g.commit({ branch: 'cms/a', files: [{ path: 'content/faq/new.json', content: '{"a":1}\n' }], message: '儲存草稿：測試\n\nEdited-by: 王○安 (AD: demo-001)\n' });
  assert.ok(c1.sha);
  assert.equal((await g.commit({ branch: 'cms/a', files: [{ path: 'content/faq/new.json', content: '{"a":1}\n' }], message: 'x' })).unchanged, true, '沒變不產生空提交');
  assert.deepEqual(await g.changedFiles('cms/a'), ['content/faq/new.json']);
  assert.equal(await g.readFile('main', 'content/faq/new.json'), null, '草稿不影響 main');
  const rv = await g.openReview({ branch: 'cms/a', title: '送審：測試', labels: ['網站內容::審核中'] });
  assert.equal((await g.openReview({ branch: 'cms/a', title: '送審：測試 2' })).id, rv.id, '同一分支只有一個審核');
  await g.comment(rv.id, '退回修改');
  await g.approve(rv.id, 'demo-002');
  const m = await g.merge(rv.id, { message: '上線：測試\n\nApproved-by: 林○慧 (AD: demo-002)\n' });
  assert.equal(await g.readFile('main', 'content/faq/new.json'), '{"a":1}\n');
  assert.equal(await g.branchExists('cms/a'), false, '合併後刪來源分支（同 GitLab）');
  const head = (await g.log('main', 1))[0];
  assert.equal(head.sha, m.sha);
  assert.equal(head.authorName, 'CDC Web Gateway');
  assert.match(head.message, /Approved-by: 林○慧 \(AD: demo-002\)/);
  assert.equal(gitOut(dir, ['rev-list', '--parents', '-n', '1', 'main']).trim().split(' ').length, 3, '合併提交有兩個父提交');
  assert.equal((await g.getReview(rv.id)).state, 'merged');
  // 衝突：兩個分支改同一檔
  await g.createBranch('cms/b'); await g.createBranch('cms/c');
  await g.commit({ branch: 'cms/b', files: [{ path: 'content/faq/old.json', content: 'B\n' }], message: 'b' });
  await g.commit({ branch: 'cms/c', files: [{ path: 'content/faq/old.json', content: 'C\n' }], message: 'c' });
  const rb = await g.openReview({ branch: 'cms/b', title: 'b' }), rc = await g.openReview({ branch: 'cms/c', title: 'c' });
  await g.merge(rb.id, { message: 'b' });
  const before = gitOut(dir, ['rev-parse', 'main']);
  await assert.rejects(g.merge(rc.id, { message: 'c' }), (e) => e.code === 'conflict');
  assert.equal(gitOut(dir, ['rev-parse', 'main']), before);
});

// ───────────────────────── GitLab 供應者（假 fetch）─────────────────────────
test('GitLab 供應者：REST v4 端點、PRIVATE-TOKEN、提交 actions（create／update）、合併請求、留言、核准、合併', async () => {
  const calls = [];
  const exists = new Set(['content/faq/old.json']);
  const fakeFetch = async (url, init = {}) => {
    const u = new URL(url);
    calls.push({ method: init.method, path: decodeURIComponent(u.pathname), rawPath: u.pathname, query: Object.fromEntries(u.searchParams), body: init.body ? JSON.parse(init.body) : null, token: init.headers['PRIVATE-TOKEN'] });
    const json = (status, body) => ({ status, ok: status < 300, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
    const p = decodeURIComponent(u.pathname);
    if (init.method === 'HEAD') return json(exists.has(p.split('/repository/files/')[1]) ? 200 : 404, {});
    if (init.method === 'GET' && p.endsWith('/raw')) return p.includes('missing') ? json(404, { message: '404' }) : { status: 200, ok: true, headers: { get: () => 'text/plain' }, text: async () => '{"x":1}' };
    if (init.method === 'GET' && p.endsWith('/merge_requests') ) return json(200, []);
    if (init.method === 'GET' && /merge_requests\/\d+$/.test(p)) return json(200, { iid: 7, sha: 'abc123' });
    if (init.method === 'POST' && p.endsWith('/merge_requests')) return json(201, { iid: 7, web_url: 'https://gitlab.cdc/x/-/merge_requests/7' });
    if (init.method === 'POST' && p.endsWith('/repository/commits')) return json(201, { id: 'c0ffee' });
    if (init.method === 'POST' && p.endsWith('/repository/branches')) return json(201, { commit: { id: 'base1' } });
    if (init.method === 'PUT' && p.endsWith('/merge')) return json(200, { merge_commit_sha: 'm3rge' });
    return json(init.method === 'POST' ? 201 : 200, {});
  };
  const g = createGitLab({ baseUrl: 'https://gitlab.cdc.internal/', project: 'web/cdc-site', token: 'glpat-test', fetchFn: fakeFetch });
  await g.createBranch('cms/faq-x-abc123');
  await g.commit({ branch: 'cms/faq-x-abc123', files: [{ path: 'content/faq/old.json', content: '{"a":1}\n' }, { path: 'content/faq/new.json', content: '{"b":2}\n' }], message: '儲存草稿：x\n\nEdited-by: 王○安 (AD: demo-001)\n' });
  const rv = await g.openReview({ branch: 'cms/faq-x-abc123', title: '送審：x', description: 'd', labels: ['網站內容::審核中'] });
  await g.comment(rv.id, '退回修改：請補來源');
  await g.setLabels(rv.id, ['網站內容::退回']);
  await g.approve(rv.id);
  const m = await g.merge(rv.id, { message: '上線：x\n\nApproved-by: 林○慧 (AD: demo-002)\n' });
  assert.equal(await g.readFile('main', 'content/faq/missing.json'), null);
  assert.equal(m.sha, 'm3rge');
  assert.ok(calls.every((c) => c.token === 'glpat-test'), '每個請求都帶 PRIVATE-TOKEN');
  assert.ok(calls.every((c) => c.rawPath.startsWith('/api/v4/projects/web%2Fcdc-site')), '專案路徑要 URL 編碼');
  const find = (method, suffix) => calls.find((c) => c.method === method && c.path.endsWith(suffix));
  assert.deepEqual(find('POST', '/repository/branches').body, { branch: 'cms/faq-x-abc123', ref: 'main' });
  const commit = find('POST', '/repository/commits').body;
  assert.equal(commit.branch, 'cms/faq-x-abc123');
  assert.match(commit.commit_message, /Edited-by: 王○安/);
  assert.deepEqual(commit.actions.map((a) => [a.action, a.file_path, a.encoding]), [['update', 'content/faq/old.json', 'text'], ['create', 'content/faq/new.json', 'text']]);
  const mr = find('POST', '/merge_requests').body;
  assert.deepEqual({ ...mr, description: undefined }, { source_branch: 'cms/faq-x-abc123', target_branch: 'main', title: '送審：x', description: undefined, labels: '網站內容::審核中', remove_source_branch: true, squash: false });
  assert.deepEqual(find('POST', '/merge_requests/7/notes').body, { body: '退回修改：請補來源' });
  assert.deepEqual(find('PUT', '/merge_requests/7').body, { labels: '網站內容::退回' });
  assert.ok(find('POST', '/merge_requests/7/approve'));
  assert.deepEqual(find('PUT', '/merge_requests/7/merge').body, { merge_commit_message: '上線：x\n\nApproved-by: 林○慧 (AD: demo-002)\n', should_remove_source_branch: true, sha: 'abc123' });
  // 同一個服務帳號第二次核准，GitLab 回 401：只是鏡像，不能讓第二位審核人的核准失敗
  const g401 = createGitLab({ baseUrl: 'https://g', project: 1, token: 't', fetchFn: async () => ({ status: 401, ok: false, headers: { get: () => 'application/json' }, json: async () => ({ message: '401 Unauthorized' }) }) });
  assert.deepEqual(await g401.approve(7), { recorded: false });
  await assert.rejects(createGitLab({ baseUrl: 'https://g', project: 1, token: 't', fetchFn: async () => ({ status: 500, ok: false, headers: { get: () => 'application/json' }, json: async () => ({}) }) }).approve(7), /500/);
  await assert.rejects(createGitLab({ baseUrl: 'https://g', project: 1, token: 't', fetchFn: async () => ({ status: 403, ok: false, headers: { get: () => 'application/json' }, json: async () => ({ message: '403 Forbidden' }) }) }).createBranch('x'), /403/);
  assert.throws(() => createGitLab({ baseUrl: 'https://g', project: 1 }), /token/);
});

// ───────────────────────── 工作流程（直接呼叫）─────────────────────────
function makeApi(over = {}) {
  const d = tmpDir();
  const api = createGatewayApi({
    stateFile: path.join(d, 'state.json'), auditFile: path.join(d, 'audit.jsonl'), outboxDir: path.join(d, 'outbox'),
    gitProvider: createLocalGit({ dir: path.join(d, 'repo'), seedDir: seed() }), validator, csrfSecret: 'test-secret', ...over,
  });
  return { api, dir: d, repo: path.join(d, 'repo'), outbox: path.join(d, 'outbox') };
}
const outboxMails = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.eml')).sort().map((f) => parseEml(fs.readFileSync(path.join(dir, f), 'utf8'))) : []);

test('工作流程：草稿 → 送審 → 退回（意見必填）→ 修改再送審 → 核准上線；四眼原則、角色、單位都擋得住', async () => {
  const { api, repo, outbox } = makeApi();
  const W = api.workflow;
  const editor = P('demo-001'), reviewer = P('demo-002'), pr = P('demo-004'), otherUnit = P('demo-008'), it = P('demo-006');
  const item = faq();
  await assert.rejects(W.saveDraft(otherUnit, { item }), (e) => e.status === 403 && /權責單位是「急性傳染病組」/.test(e.message));
  await assert.rejects(W.saveDraft(it, { item }), (e) => e.status === 403 && /「編輯」角色/.test(e.message));
  await assert.rejects(W.saveDraft(editor, { item: { ...item, title: '' } }), (e) => e.status === 422 && e.fields[0].field === 'title');
  assert.equal(fs.existsSync(path.join(repo, 'refs/heads')) ? gitOut(repo, ['branch', '--list', 'cms/*']).trim() : '', '', '驗證不過什麼都不寫');

  const s1 = await W.saveDraft(editor, { item });
  assert.equal(s1.status, 'draft'); assert.equal(s1.statusLabel, '草稿');
  assert.equal(s1.isNew, true);
  const branches = gitOut(repo, ['branch', '--list', 'cms/*']).trim();
  assert.match(branches, /cms\/faq-gw-test-[0-9a-f]{6}-[0-9a-f]{6}/);
  const draftMsg = gitOut(repo, ['log', '-1', '--format=%an|%B', branches.replace(/^[* ]+/, '')]);
  assert.match(draftMsg, /^CDC Web Gateway\|儲存草稿：/);
  assert.match(draftMsg, /Edited-by: 王○安 \(AD: demo-001\)/);
  assert.match(draftMsg, /Gateway-Submission: gw-\d{8}-[0-9a-f]{6}/);

  const s2 = await W.submit(editor, { item: { ...item, answerMarkdown: `${item.answerMarkdown}請多休息。` }, submissionId: s1.id }, { origin: 'http://localhost:4173', basePath: '' });
  assert.equal(s2.status, 'in_review');
  assert.equal(s2.requiredApprovals, 1);
  let mails = outboxMails(outbox);
  assert.equal(mails.length, 2, '通知同單位審核人（林○慧）與一般車道審核單位（公關室 張○玲）');
  assert.deepEqual(mails.map((m) => m.headers.to).sort(), ['<demo-002@cdc-prototype.invalid>', '<demo-004@cdc-prototype.invalid>']);
  assert.match(mails[0].headers.subject, /【請審核】登革熱/);
  assert.match(mails[0].text, /http:\/\/localhost:4173\/admin\/review\/\?item=gw-/);
  for (const m of mails) assert.doesNotMatch(`${m.headers.subject}\n${m.text}`, GIT_WORDS, '通知不出現 Git 用語');
  assert.equal(fs.readdirSync(path.join(outbox, 'teams')).length, 1, 'Teams 通知一則');
  await assert.rejects(W.saveDraft(editor, { item, submissionId: s1.id }), (e) => e.status === 409 && /審核中/.test(e.message));

  // 角色與四眼
  await assert.rejects(W.approve(editor, { submissionId: s1.id }), (e) => e.status === 403 && /「審核」或「管理」/.test(e.message));
  await assert.rejects(W.approve(otherUnit, { submissionId: s1.id }), (e) => e.status === 403 && /不屬於你的單位/.test(e.message));
  await assert.rejects(W.returnForChanges(reviewer, { submissionId: s1.id, comment: '  ' }), (e) => e.status === 422 && e.fields[0].field === 'comment');
  const r = await W.returnForChanges(reviewer, { submissionId: s1.id, comment: '請補充「何時要掛急診」。' }, { origin: 'http://localhost:4173', basePath: '' });
  assert.equal(r.status, 'returned'); assert.equal(r.statusLabel, '退回');
  assert.equal(r.comments[0].text, '請補充「何時要掛急診」。');
  mails = outboxMails(outbox);
  const ret = mails.find((m) => /已退回/.test(m.headers.subject));
  assert.equal(ret.headers.to, '<demo-001@cdc-prototype.invalid>');
  assert.match(ret.text, /請補充「何時要掛急診」/);
  assert.match(ret.text, /\/admin\/publish\/\?gw=/);

  // 林○慧（同時有編輯角色）幫忙改了一版 ⇒ 她就不能再核准
  const helped = await W.saveDraft(reviewer, { item: { ...item, answerMarkdown: '出現發燒請儘速就醫；出現嚴重腹痛、出血時請掛急診。' }, submissionId: s1.id });
  assert.equal(helped.status, 'draft');
  await W.submit(editor, { submissionId: s1.id }, {});
  await assert.rejects(W.approve(reviewer, { submissionId: s1.id }), (e) => e.status === 403 && /四眼原則/.test(e.message));
  // 公關室總編輯（一般車道審核單位）核准 ⇒ 上線
  const done = await W.approve(pr, { submissionId: s1.id, comment: '可' }, { origin: 'http://localhost:4173', basePath: '' });
  assert.equal(done.status, 'published'); assert.equal(done.statusLabel, '已上線');
  const onMain = JSON.parse(gitOut(repo, ['show', `main:${'content/faq/' + item.id.replace('faq.', '')}.json`]));
  assert.equal(onMain.status, 'published');
  assert.match(onMain.answerMarkdown, /掛急診/);
  const mergeMsg = gitOut(repo, ['log', '-1', '--format=%an|%B', 'main']);
  assert.match(mergeMsg, /^CDC Web Gateway\|上線：/);
  assert.match(mergeMsg, /Edited-by: 王○安 \(AD: demo-001\)/);
  assert.match(mergeMsg, /Edited-by: 林○慧 \(AD: demo-002\)/);
  assert.match(mergeMsg, /Approved-by: 張○玲 \(AD: demo-004\)/);
  assert.equal(gitOut(repo, ['branch', '--list', 'cms/*']).trim(), '', '上線後分支刪除');
  assert.ok(outboxMails(outbox).some((m) => /已核准上線/.test(m.headers.subject) && m.headers.to === '<demo-001@cdc-prototype.invalid>'));
  await assert.rejects(W.approve(pr, { submissionId: s1.id }), (e) => e.status === 409);

  // 稽核：只增不改、雜湊鏈完整；拒絕的動作也有紀錄
  const entries = api.audit.read();
  assert.ok(entries.some((e) => e.action === 'approve' && e.result === 'denied'));
  assert.ok(entries.some((e) => e.action === 'save-draft' && e.result === 'rejected'));
  assert.ok(entries.some((e) => e.action === 'publish' && e.approvedBy.includes('demo-004')));
  assert.equal(verifyAudit(entries).ok, true);
  const tampered = entries.map((e, i) => (i === 2 ? { ...e, actor: { ...e.actor, account: 'someone-else' } } : e));
  assert.equal(verifyAudit(tampered).ok, false);
  assert.ok(!JSON.stringify(entries).includes('掛急診'), '稽核不記內容本文');

  // 清單與差異
  assert.equal(W.list(pr, { view: 'queue' }).length, 0);
  const d = await W.diff(pr, s1.id);
  assert.match(d.note, /已經上線/);
});

test('發布車道：自動上線車道只給授權名單（可寫 team:<AD 群組>）；其他人降為一般車道；一級內容加 OASIS 審核', async () => {
  const cfg = structuredClone(loadLanes());
  // 名冊多一位公關室複核者：快車道上線後要通知「送審人以外」的公關室同事
  const directory = createDemoDirectory([...DEMO_ACCOUNTS, { sub: 'demo-009', name: '周○文', title: '科長', unit: 'unit.pr', roles: ['reviewer'] }]);
  const { api, repo, outbox } = makeApi({ lanesCfg: cfg, directory });
  const W = api.workflow;
  const news = { ...faq('news.2026-10-10-gw-fast'), type: 'news', newsType: 'press', bodyMarkdown: '2026 年 10 月 10 日疾管署說明。', reviewPeriodMonths: 0, owner: 'unit.pr' };
  delete news.question; delete news.answerMarkdown;
  const prEditor = P('demo-004');
  assert.equal(W.laneFor(news, prEditor).id, 'standard', '名單只有示範帳號 ⇒ 降為一般車道');
  assert.equal(W.laneFor(news, prEditor).requiredApprovals, 1);
  assert.match(W.laneFor(news, prEditor).reasons[0], /只限授權名單/);
  cfg.lanes.fast.allowedAuthors = ['team:CDC-WEB-pr-chief-editor'];
  const lane = W.laneFor(news, prEditor);
  assert.equal(lane.id, 'fast'); assert.equal(lane.requiredApprovals, 0);
  const done = await W.submit(prEditor, { item: news }, {});
  assert.equal(done.status, 'published', '快車道：送審即上線（CI＝審核者）');
  assert.match(gitOut(repo, ['log', '-1', '--format=%B', 'main']), /Approved-by: 自動（快車道/);
  assert.ok(outboxMails(outbox).some((m) => /上線後複核/.test(m.headers.subject) && m.headers.to === '<demo-009@cdc-prototype.invalid>'));
  const disease = { id: 'disease.dengue', type: 'disease' };
  const t1 = W.laneFor(disease, P('demo-001'));
  assert.deepEqual(t1.reviewers.sort(), ['unit.oasis', 'unit.pr']);
  assert.ok(createDemoDirectory().reviewersFor(['unit.oasis']).some((x) => x.account === 'demo-005'));
});

// ───────────────────────── HTTP 層 ─────────────────────────
async function serveApi(api) {
  const srv = http.createServer(async (rq, rs) => { const u = new URL(rq.url, 'http://x'); if (!(await api.handle(rq, rs, u.pathname, u.searchParams))) { rs.statusCode = 404; rs.end(); } });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { srv, base: `http://127.0.0.1:${srv.address().port}` };
}
test('HTTP：同源＋CSRF token 才能寫；Content-Type、大小上限、未知路徑；header 模式只信代理', async () => {
  const { api } = makeApi({ authAdapter: createHeaderAuth({ trustedProxies: ['127.0.0.1'] }) });
  const { srv, base } = await serveApi(api);
  const host = new URL(base).host;
  const who = { 'X-Remote-User': 'CDC\\demo-001', 'X-Remote-Groups': 'CDC-WEB-acute-infectious-editor', 'X-Remote-Name': encodeURIComponent('王○安') };
  try {
    const h = await (await fetch(`${base}/api/gateway/health`)).json();
    assert.deepEqual(h, { ok: true, service: 'cdc-web-gateway', auth: 'header' });
    const ses = await fetch(`${base}/api/gateway/session`, { headers: who });
    assert.equal(ses.headers.get('cache-control'), 'no-store');
    assert.match(ses.headers.get('content-security-policy'), /default-src 'none'/);
    const { user, csrfToken } = await ses.json();
    assert.deepEqual(user.roles, ['編輯']);
    const post = (p, body, headers = {}) => fetch(`${base}/api/gateway${p}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: `http://${host}`, 'x-csrf-token': csrfToken, ...who, ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
    assert.equal((await post('/drafts', { item: faq() }, { origin: 'https://evil.example' })).status, 403, '跨站來源');
    assert.equal((await fetch(`${base}/api/gateway/drafts`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken, ...who }, body: '{}' })).status, 403, '沒有 Origin');
    assert.equal((await post('/drafts', { item: faq() }, { 'x-csrf-token': 'nope' })).status, 403, '錯的 token');
    assert.equal((await post('/drafts', { item: faq() }, { 'sec-fetch-site': 'cross-site' })).status, 403);
    assert.equal((await post('/drafts', 'item=1', { 'content-type': 'application/x-www-form-urlencoded' })).status, 415);
    assert.equal((await post('/drafts', { item: faq(), pad: 'x'.repeat(600 * 1024) })).status, 413);
    const inv = await post('/drafts', { item: { ...faq(), id: 'faq.../../../scripts/x' } });
    assert.equal(inv.status, 422);
    assert.equal((await inv.json()).fields[0].field, 'id');
    const ok = await post('/drafts', { item: faq() });
    assert.equal(ok.status, 200, await ok.clone().text());
    const sub = await ok.json();
    assert.equal(sub.statusLabel, '草稿');
    assert.doesNotMatch(JSON.stringify(sub), /cms\/|branch|reviewId/, '回應不帶 Git 細節');
    const list = await (await fetch(`${base}/api/gateway/items?view=mine`, { headers: who })).json();
    assert.equal(list.items.length, 1);
    const pv = await fetch(`${base}/api/gateway/items/${sub.id}/preview`, { headers: who });
    assert.match(pv.headers.get('content-security-policy'), /^sandbox;/);
    assert.match(await pv.text(), /預覽（尚未上線）/);
    assert.equal((await fetch(`${base}/api/gateway/items/gw-x/../../etc`, { headers: who })).status, 404);
    // 不從代理來的身分標頭：拒絕並記稽核
    const { api: api2 } = makeApi({ authAdapter: createHeaderAuth({ trustedProxies: ['10.9.9.9'] }) });
    const s2 = await serveApi(api2);
    try {
      const r = await fetch(`${s2.base}/api/gateway/session`, { headers: who });
      assert.equal(r.status, 401);
      assert.equal((await r.json()).error, 'untrusted_proxy');
      assert.ok(api2.audit.read().some((e) => e.action === 'auth' && e.reason === 'untrusted_proxy'));
    } finally { s2.srv.close(); }
    // 沒有本站角色的帳號
    const nobody = await fetch(`${base}/api/gateway/session`, { headers: { 'X-Remote-User': 'guest', 'X-Remote-Groups': 'Domain Users' } });
    assert.equal(nobody.status, 403);
    // 反向代理改寫 Host（IIS ARR 預設）時，以 PUBLIC_ORIGIN 判斷同源
    const { api: api3 } = makeApi({ authAdapter: createHeaderAuth({ trustedProxies: ['127.0.0.1'] }), publicOrigin: 'https://cms.cdc.example' });
    const s3 = await serveApi(api3);
    try {
      const p3 = (origin) => fetch(`${s3.base}/api/gateway/drafts`, { method: 'POST', headers: { 'content-type': 'application/json', origin, 'x-csrf-token': csrfToken, ...who }, body: JSON.stringify({ item: faq() }) });
      assert.equal((await p3('https://cms.cdc.example')).status, 200, '對外網址同源');
      assert.equal((await p3(`http://${new URL(s3.base).host}`)).status, 403, '設了 PUBLIC_ORIGIN 就只認它');
    } finally { s3.srv.close(); }
  } finally { srv.close(); }
});

// ───────────────────────── 端到端（Playwright）─────────────────────────
const CHROME = process.env.CHROME_BIN || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const DIST = process.env.DIST_DIR ? path.resolve(process.env.DIST_DIR) : path.join(ROOT, 'dist');
const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });

test('端到端：承辦人存草稿 → 送審 → 審核人退回 → 承辦人修改再送審 → 審核人核准上線 → main 上的檔案改了', { timeout: 180000 }, async (t) => {
  if (!fs.existsSync(path.join(DIST, 'admin/publish/index.html'))) return t.skip('dist 尚未建置');
  let chromium;
  try { ({ chromium } = await import('playwright')); } catch { return t.skip('沒有 Playwright'); }
  if (!fs.existsSync(CHROME)) return t.skip('沒有 Chromium');
  const d = tmpDir('gw-e2e-');
  const port = await freePort();
  const env = { ...process.env, DIST_DIR: DIST, GATEWAY_REPO_DIR: path.join(d, 'repo'), GATEWAY_SEED_DIR: seed(), GATEWAY_STATE_FILE: path.join(d, 'state.json'), GATEWAY_AUDIT_FILE: path.join(d, 'audit.jsonl'), OUTBOX_DIR: path.join(d, 'outbox'), SUBSCRIPTIONS_FILE: path.join(d, 'subs.json') };
  const srv = spawn(process.execPath, [path.join(ROOT, 'scripts/serve.mjs'), String(port)], { cwd: ROOT, stdio: ['ignore', 'ignore', 'pipe'], env });
  let stderr = ''; srv.stderr.on('data', (c) => { stderr += c; });
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const errors = [];
  const base = `http://localhost:${port}${config.basePath}`;
  const contentId = `faq.gw-e2e-${crypto.randomBytes(2).toString('hex')}`;
  const repo = path.join(d, 'repo');
  try {
    for (let i = 0; i < 80; i++) { try { if ((await fetch(`${base}/api/gateway/health`)).ok) break; } catch { /* 等伺服器 */ } await new Promise((r) => setTimeout(r, 100)); }
    const as = async (sub) => {
      const ctx = await browser.newContext({ viewport: { width: 1360, height: 1000 } });
      // 初始化腳本也會跑進預覽的 sandbox iframe（那裡沒有 localStorage，正是我們要的隔離），所以包 try
      await ctx.addInitScript(({ s }) => { try { if (!localStorage.getItem('cdc.admin.session')) localStorage.setItem('cdc.admin.session', JSON.stringify(s)); } catch { /* sandbox iframe */ } }, { s: makeSession(acct(sub)) });
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(`${sub}: ${e.message}`));
      page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|Blocked script execution in 'about:srcdoc'/.test(m.text())) errors.push(`${sub}: ${m.text()}`); });
      return page;
    };
    const visibleText = (page) => page.evaluate(() => document.querySelector('main')?.innerText ?? '');

    // ① 承辦人：填表 → 預處理 → 儲存草稿
    const ed = await as('demo-001');
    await ed.goto(`${base}/admin/publish/`);
    await ed.waitForSelector('#gw-panel:not([hidden])', { timeout: 15000 });
    assert.equal(await ed.getAttribute('#gw-status', 'role'), 'status');
    await ed.selectOption('#f-type', 'faq');
    await ed.fill('#f-title', '登革熱發燒幾天內要就醫？（閘道示範）');
    await ed.fill('#f-id', contentId);
    await ed.click('#et-md');
    await ed.fill('#f-body', '出現發燒、頭痛、後眼窩痛時，請儘速就醫。就醫時請告知醫師旅遊史。');
    await ed.click('#btn-submit');
    await ed.waitForSelector('#sum');
    await ed.click('#gw-save');
    await ed.waitForFunction(() => document.querySelector('#gw-state')?.textContent === '草稿', null, { timeout: 15000 });
    assert.match(gitOut(repo, ['branch', '--list', 'cms/*']), /cms\/faq-gw-e2e-/, '草稿真的寫進版本庫');
    // ② 送審
    await ed.click('#gw-submit');
    await ed.waitForFunction(() => document.querySelector('#gw-state')?.textContent === '審核中', null, { timeout: 15000 });
    assert.doesNotMatch(await visibleText(ed), GIT_WORDS, `發布頁不出現 Git 用語：${(await visibleText(ed)).match(GIT_WORDS)?.[0]}`);
    assert.ok(fs.readdirSync(path.join(d, 'outbox')).some((f) => /gateway-submitted/.test(f)), '寄給審核人的模擬信');

    // ③ 審核人（另一位同事）：佇列 → 差異 → 退回（意見必填）
    const rv = await as('demo-002');
    await rv.goto(`${base}/admin/review/`);
    await rv.waitForSelector('#gw-review:not([hidden])', { timeout: 15000 });
    await rv.waitForSelector(`#gw-queue [data-sid]`);
    await rv.click('#gw-queue button[data-sid]');
    await rv.waitForSelector('#gw-diff .gw-change');
    assert.match(await rv.locator('#gw-diff').innerText(), /摘要/);
    assert.equal(await rv.evaluate(() => document.activeElement?.id), 'gw-d-h', '打開審核後焦點移到標題');
    // 無障礙：線上審核畫面（佇列＋差異）跑 axe，serious／critical 一項都不能有
    const { AxeBuilder } = await import('@axe-core/playwright');
    const axe = await new AxeBuilder({ page: rv }).include('#gw-review').include('#gw-detail').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    const serious = axe.violations.filter((v) => ['serious', 'critical'].includes(v.impact));
    assert.deepEqual(serious.map((v) => `${v.id}: ${v.nodes[0]?.target}`), []);
    // 預覽：無權限的 sandbox iframe（不執行腳本、讀不到後台的 localStorage）
    await rv.click('#gw-preview-btn');
    await rv.waitForSelector('#gw-preview-wrap:not([hidden]) iframe');
    assert.equal(await rv.getAttribute('#gw-preview-frame', 'sandbox'), '', '預覽在無權限的 sandbox iframe');
    await rv.frameLocator('#gw-preview-frame').locator('text=預覽（尚未上線）').waitFor();
    assert.match(await rv.frameLocator('#gw-preview-frame').locator('main').innerText(), /請儘速就醫/);
    await rv.click('#gw-preview-btn');
    assert.equal(await rv.locator('#gw-preview-frame').count(), 0, '收起預覽就移除 iframe');
    await rv.click('#gw-return');
    await rv.waitForFunction(() => /請寫下退回原因/.test(document.querySelector('#gw-act-msg')?.textContent ?? ''));
    assert.equal(await rv.evaluate(() => document.activeElement?.id), 'gw-comment', '沒寫意見時焦點回到意見欄');
    await rv.fill('#gw-comment', '請補上「出現警示徵象要立即就醫」。');
    await rv.click('#gw-return');
    await rv.waitForFunction(() => /已退回/.test(document.querySelector('#gw-act-msg')?.textContent ?? ''), null, { timeout: 15000 });
    assert.doesNotMatch(await visibleText(rv), GIT_WORDS, `複核頁不出現 Git 用語：${(await visibleText(rv)).match(GIT_WORDS)?.[0]}`);

    // ④ 承辦人：看到退回與意見 → 修改 → 再送審
    await ed.reload();
    await ed.waitForFunction(() => document.querySelector('#gw-state')?.textContent === '退回', null, { timeout: 15000 });
    assert.match(await ed.locator('#gw-panel').innerText(), /出現警示徵象要立即就醫/);
    await ed.click('#et-md');
    await ed.fill('#f-body', '出現發燒、頭痛、後眼窩痛時，請儘速就醫。出現警示徵象要立即就醫。就醫時請告知醫師旅遊史。');
    await ed.click('#gw-submit');
    await ed.waitForFunction(() => document.querySelector('#gw-state')?.textContent === '審核中', null, { timeout: 15000 });

    // ⑤ 審核人：核准上線
    await rv.goto(`${base}/admin/review/`);
    await rv.waitForSelector('#gw-queue button[data-sid]');
    await rv.click('#gw-queue button[data-sid]');
    await rv.waitForSelector('#gw-diff .gw-change');
    assert.match(await rv.locator('#gw-diff').innerText(), /警示徵象/);
    await rv.click('#gw-approve');
    await rv.waitForFunction(() => /已上線/.test(document.querySelector('#gw-act-msg')?.textContent ?? ''), null, { timeout: 15000 });

    const onMain = JSON.parse(gitOut(repo, ['show', `main:content/faq/${contentId.replace('faq.', '')}.json`]));
    assert.equal(onMain.status, 'published');
    assert.match(onMain.answerMarkdown, /出現警示徵象要立即就醫/);
    const msg = gitOut(repo, ['log', '-1', '--format=%B', 'main']);
    assert.match(msg, /Edited-by: 王○安 \(AD: demo-001\)/);
    assert.match(msg, /Approved-by: 林○慧 \(AD: demo-002\)/);
    const outFiles = fs.readdirSync(path.join(d, 'outbox'));
    assert.ok(outFiles.some((f) => /gateway-returned/.test(f)) && outFiles.some((f) => /gateway-approved/.test(f)), '退回與核准都通知承辦人');
    assert.ok(fs.readdirSync(path.join(d, 'outbox', 'teams')).length >= 3);
    assert.equal(verifyAudit(fs.readFileSync(path.join(d, 'audit.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))).ok, true);
    // ⑥ 承辦人頁面也看到已上線
    await ed.reload();
    await ed.waitForFunction(() => document.querySelector('#gw-state')?.textContent === '已上線', null, { timeout: 15000 });
    const edAxe = await new AxeBuilder({ page: ed }).include('#gw-panel').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    assert.deepEqual(edAxe.violations.filter((v) => ['serious', 'critical'].includes(v.impact)).map((v) => v.id), []);
    // ⑦ 沒有閘道（GitHub Pages）時維持瀏覽器示範：面板不出現、原本的「確認並送複核」還在
    await ed.goto(`${base}/admin/publish/?gateway=off`);
    await ed.waitForSelector('#f-title');
    await ed.waitForTimeout(300);
    assert.equal(await ed.isHidden('#gw-panel'), true);
    assert.equal(await ed.evaluate(() => document.body.classList.contains('adm-gw')), false);
    assert.deepEqual(errors, [], errors.join('\n'));
  } finally {
    await browser.close();
    srv.kill();
    if (stderr.trim()) console.error(stderr);
  }
});
