// 第六十二輪（Issue #140「防 AI 自動化攻擊探測」）：共用速率限制與四個後端的 429。
//   (1) 限流數學：滑動記錄、retryAfter 是真實秒數、被拒的不記、記憶體上限（不會整個清空）
//   (2) clientKey：只有連線來自信任的代理才採信 X-Forwarded-For，而且取最後一個非代理位址
//   (3) 寫入閘道：每 IP、登入與認證失敗、每帳號寫入三個範圍；429 在讀本體之前；稽核記 rate_limited（只記一筆、不記本體）
//   (4) 電子報模擬後端（每 IP 每分鐘 5 次，退訂與 health 不限）、問答紀錄信標、國際疫情推送端點（429 在權杖檢查之前）
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { createRateLimiter, clientKey, tooMany, ipMatcher, RATE_MESSAGE } from '../scripts/lib/rate-limit.mjs';
import { createGatewayApi, rateLimitFromEnv, configFromEnv, DEFAULT_RATE_LIMIT } from '../scripts/lib/gateway/index.mjs';
import { DEV_SESSION_HEADER } from '../scripts/lib/gateway/auth.mjs';
import { verifyAudit } from '../scripts/lib/gateway/store.mjs';
import { makeSession, DEMO_ACCOUNTS } from '../src/client/admin/auth-rules.js';
import { createSubscriptionApi, HTTP_RATE } from '../scripts/lib/subscribe-mock.mjs';
import { createAskLogApi, RATE as ASK_RATE } from '../scripts/lib/ask-log-mock.mjs';
import { createIntlFeedApi, RATE as INTL_RATE } from '../scripts/lib/intl-feed-api.mjs';

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), `r62-${p}-`));

/** 假請求：本體可讀（Readable），記錄有沒有被讀過 */
function fakeReq({ method = 'GET', body = '', headers = {}, ip = '127.0.0.1' } = {}) {
  let read = false;
  const r = Readable.from(
    (function* () {
      read = true;
      if (body) yield Buffer.from(body);
    })(),
  );
  r.method = method;
  r.headers = { host: 'localhost:4173', ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])) };
  r.socket = { remoteAddress: ip };
  Object.defineProperty(r, 'bodyRead', { get: () => read });
  return r;
}
function fakeRes() {
  const res = { statusCode: 0, headers: {}, body: '' };
  res.setHeader = (k, v) => (res.headers[k.toLowerCase()] = v);
  res.end = (b = '') => (res.body = String(b));
  return res;
}
async function call(api, pathname, opts = {}, search = '') {
  const req = fakeReq(opts);
  const res = fakeRes();
  const handled = await api.handle(req, res, pathname, new URLSearchParams(search));
  return { handled, req, ...res, json: () => JSON.parse(res.body) };
}

// ───────────────────────── (1) 限流數學 ─────────────────────────
test('限流：視窗內第 max+1 次被擋；retryAfter＝最舊那筆離開視窗的真實秒數；被拒的不記；視窗過後恢復', () => {
  let t = 1_000_000;
  const rl = createRateLimiter({ windowMs: 60_000, max: 3, now: () => t });
  assert.deepEqual(rl.hit('a'), { ok: true, remaining: 2, retryAfterSec: 0, count: 1, denied: 0 });
  t += 10_000;
  rl.hit('a');
  t += 10_000;
  assert.equal(rl.hit('a').remaining, 0);
  t += 5_000; // 第一筆在 25 秒前，還要 35 秒才離開視窗
  const r = rl.hit('a');
  assert.equal(r.ok, false);
  assert.equal(r.retryAfterSec, 35);
  assert.equal(r.denied, 1, '剛開始被擋');
  assert.equal(rl.hit('a').denied, 2, '連續被擋的次數');
  assert.equal(rl.hit('b').ok, true, '別的 key 不受影響');
  t += 35_000; // 最舊那筆剛好離開
  const back = rl.hit('a');
  assert.equal(back.ok, true);
  assert.equal(back.count, 3, '被拒的請求沒有記進去：視窗內只有第 2、3 筆和這一筆');
  assert.equal(back.denied, 0);
  assert.equal(rl.hit('a').ok, false);
  rl.reset();
  assert.equal(rl.size, 0);
  assert.equal(rl.hit('a').ok, true);
  assert.throws(() => createRateLimiter({ windowMs: 0, max: 1 }), /正數/);
});

test('限流：記憶體有上限——閒置的 key 先清；仍太多時淘汰最早出現的，絕不整個清空（否則灌假 IP 就能重設所有人的計數）', () => {
  let t = 0;
  const rl = createRateLimiter({ windowMs: 1000, max: 1, now: () => t, maxKeys: 100 });
  assert.equal(rl.hit('victim').ok, true);
  assert.equal(rl.hit('victim').ok, false);
  for (let i = 0; i < 99; i++) rl.hit(`spoof-${i}`);
  assert.equal(rl.size, 100);
  assert.equal(rl.hit('victim').ok, false, '還在上限內：計數沒被重設');
  rl.hit('spoof-new'); // 第 101 個：淘汰最早出現的（victim），不是全部清空
  assert.equal(rl.size, 100);
  assert.equal(rl.hit('spoof-98').ok, false, '其他 key 的計數都還在');
  t += 1000; // 全部閒置：下一次 hit 時清掉
  rl.hit('fresh');
  assert.equal(rl.size, 1);
});

// ───────────────────────── (2) clientKey ─────────────────────────
test('clientKey：直連時用 socket 位址（偽造的 X-Forwarded-For 不算）；來自信任代理才看 XFF，取最後一個非代理位址', () => {
  const r = (ip, xff) => ({ socket: { remoteAddress: ip }, headers: xff ? { 'x-forwarded-for': xff } : {} });
  assert.equal(clientKey(r('198.51.100.9', '1.2.3.4')), '198.51.100.9', '沒有信任的代理：攻擊者不能自己選 key');
  assert.equal(clientKey(r('198.51.100.9', '1.2.3.4'), { trustedProxies: ['10.0.0.5'] }), '198.51.100.9', '對端不是我們的代理');
  assert.equal(clientKey(r('10.0.0.5', '203.0.113.7'), { trustedProxies: ['10.0.0.5'] }), '203.0.113.7');
  assert.equal(clientKey(r('10.0.0.5', '1.2.3.4, 203.0.113.7'), { trustedProxies: ['10.0.0.5'] }), '203.0.113.7', '用戶端偽造的在左邊，代理加的在最右');
  assert.equal(clientKey(r('10.0.0.5', '1.2.3.4, 203.0.113.7, 10.0.0.9'), { trustedProxies: ['10.0.0.0/8'] }), '203.0.113.7', '多層代理（CIDR）：跳過所有代理');
  assert.equal(clientKey(r('::ffff:10.0.0.5', '203.0.113.7:51234'), { trustedProxies: ['10.0.0.5'] }), '203.0.113.7', 'IPv4-mapped 與 :port 都正規化');
  assert.equal(clientKey(r('10.0.0.5', '[2001:db8::1]:443'), { trustedProxies: ['10.0.0.5'] }), '2001:db8::1');
  assert.equal(clientKey(r('10.0.0.5', 'garbage, <script>'), { trustedProxies: ['10.0.0.5'] }), '10.0.0.5', '看不懂的標頭 ⇒ 代理本身');
  assert.equal(clientKey(r('10.0.0.5'), { trustedProxies: ['10.0.0.5'] }), '10.0.0.5');
  assert.equal(clientKey({ headers: {} }), 'unknown');
  assert.equal(ipMatcher(['10.0.0.0/8'])('::ffff:10.1.2.3'), true);
  assert.equal(ipMatcher(['10.0.0.0/8'])('11.0.0.1'), false);
});

test('tooMany：通用 429（不說門檻）＋Retry-After＋no-store；有傳 req 就放掉本體', () => {
  const res = fakeRes();
  let resumed = false;
  tooMany(res, 12.2, { req: /** @type {any} */ ({ resume: () => (resumed = true) }) });
  assert.equal(res.statusCode, 429);
  assert.equal(res.headers['retry-after'], '13');
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.deepEqual(JSON.parse(res.body), { error: 'rate_limited', message: RATE_MESSAGE });
  assert.equal(resumed, true);
});

// ───────────────────────── (3) 寫入閘道 ─────────────────────────
test('閘道設定：GATEWAY_RATE_LIMIT 空白＝預設、off＝關、逐項覆寫；格式不對就不啟動', () => {
  assert.deepEqual(configFromEnv({}).rateLimit, {
    ip: { max: 120, windowMs: 60_000 },
    auth: { max: 10, windowMs: 60_000 },
    write: { max: 60, windowMs: 60_000 },
  });
  assert.equal(configFromEnv({ GATEWAY_RATE_LIMIT: 'off' }).rateLimit, null);
  assert.deepEqual(rateLimitFromEnv('ip:240/60, auth:20/30'), {
    ip: { max: 240, windowMs: 60_000 },
    auth: { max: 20, windowMs: 30_000 },
    write: { ...DEFAULT_RATE_LIMIT.write },
  });
  assert.throws(() => rateLimitFromEnv('ip=240'), /GATEWAY_RATE_LIMIT 格式不對/);
  assert.throws(() => rateLimitFromEnv('bogus:1/1'), /GATEWAY_RATE_LIMIT/);
});

function gateway(rateLimit) {
  const d = tmp('gw');
  const api = createGatewayApi({
    stateFile: path.join(d, 'state.json'),
    auditFile: path.join(d, 'audit.jsonl'),
    outboxDir: path.join(d, 'outbox'),
    gitProvider: /** @type {any} */ ({}),
    csrfSecret: 'r62',
    rateLimit,
  });
  const audit = () =>
    fs.existsSync(path.join(d, 'audit.jsonl'))
      ? fs
          .readFileSync(path.join(d, 'audit.jsonl'), 'utf8')
          .trim()
          .split('\n')
          .map((l) => JSON.parse(l))
      : [];
  return { api, audit };
}
const session = (sub) => Buffer.from(JSON.stringify(makeSession(DEMO_ACCOUNTS.find((a) => a.sub === sub)))).toString('base64url');

test('閘道：每 IP 上限（含 /health）⇒ 429 rate_limited＋Retry-After；稽核只在開始被擋時記一筆 { ip, path, scope }', async () => {
  const { api, audit } = gateway({ ip: { max: 3, windowMs: 60_000 } });
  for (let i = 0; i < 3; i++) assert.equal((await call(api, '/api/gateway/health')).statusCode, 200);
  const r = await call(api, '/api/gateway/health');
  assert.equal(r.statusCode, 429);
  assert.ok(Number(r.headers['retry-after']) > 0);
  assert.equal(r.headers['cache-control'], 'no-store');
  assert.deepEqual(r.json(), { error: 'rate_limited', message: '操作太頻繁，請稍後再試' });
  assert.equal((await call(api, '/api/gateway/session')).statusCode, 429, '同一個 IP 的其他端點也被擋');
  assert.equal((await call(api, '/api/gateway/health', { ip: '127.0.0.2' })).statusCode, 200, '別的 IP 不受影響');
  const rows = audit().filter((e) => e.action === 'rate_limited');
  assert.equal(rows.length, 1, '連續被擋只記第一次（被灌時稽核檔不會跟著被灌）');
  assert.deepEqual([rows[0].result, rows[0].ip, rows[0].path, rows[0].scope], ['denied', '127.0.0.1', '/health', 'ip']);
  assert.equal(verifyAudit(audit()).ok, true, '雜湊鏈完整');
});

test('閘道：認證失敗算進 auth 範圍（每 IP），超過後連登入也 429；成功認證不受影響', async () => {
  const { api, audit } = gateway({ auth: { max: 2, windowMs: 60_000 } });
  assert.equal((await call(api, '/api/gateway/session')).statusCode, 401);
  assert.equal((await call(api, '/api/gateway/session')).statusCode, 401);
  const r = await call(api, '/api/gateway/session');
  assert.equal(r.statusCode, 429);
  assert.equal(audit().find((e) => e.action === 'rate_limited').scope, 'auth');
  assert.equal((await call(api, '/api/gateway/logout', { method: 'POST' })).statusCode, 429, '/logout 也在 auth 範圍');
  const ok = await call(api, '/api/gateway/session', { headers: { [DEV_SESSION_HEADER]: session('demo-001') } });
  assert.equal(ok.statusCode, 200, '認證成功的請求不計入、也不被 auth 範圍擋');
});

test('閘道：每帳號寫入上限——在 CSRF 檢查與讀本體之前就 429，本體不被讀；稽核帶帳號，不帶本體', async () => {
  const { api, audit } = gateway({ write: { max: 2, windowMs: 60_000 } });
  const h = { [DEV_SESSION_HEADER]: session('demo-001'), 'content-type': 'application/json', origin: 'http://localhost:4173' };
  const secret = 'S3CRET-BODY-MARKER';
  for (let i = 0; i < 2; i++)
    assert.equal(
      (await call(api, '/api/gateway/drafts', { method: 'POST', headers: h, body: `{"x":"${secret}"}` })).statusCode,
      403,
      'CSRF token 不對（照舊 403）',
    );
  const r = await call(api, '/api/gateway/drafts', { method: 'POST', headers: h, body: `{"x":"${secret}"}` });
  assert.equal(r.statusCode, 429);
  const row = audit().find((e) => e.action === 'rate_limited');
  assert.deepEqual([row.scope, row.actor.account, row.path], ['write', 'demo-001', '/drafts']);
  assert.ok(!JSON.stringify(audit()).includes(secret), '稽核不記本體');
  const other = await call(api, '/api/gateway/drafts', { method: 'POST', headers: { ...h, [DEV_SESSION_HEADER]: session('demo-002') }, body: '{}' });
  assert.equal(other.statusCode, 403, '別的帳號不受影響（照舊走到 CSRF 檢查）');
});

test('閘道：rateLimit: null ⇒ 關閉（GATEWAY_RATE_LIMIT=off 的效果）', async () => {
  const { api } = gateway(null);
  for (let i = 0; i < 150; i++) assert.equal((await call(api, '/api/gateway/health')).statusCode, 200);
});

test('閘道：500 只回白話訊息，不帶堆疊、版本或路徑', async () => {
  const d = tmp('gw500');
  const api = createGatewayApi({
    stateFile: path.join(d, 'state.json'),
    auditFile: path.join(d, 'audit.jsonl'),
    outboxDir: path.join(d, 'outbox'),
    gitProvider: /** @type {any} */ ({}),
    authAdapter: {
      mode: 'dev',
      authenticate: async () => {
        throw new Error(`boom at ${d}/secret.mjs:12`);
      },
    },
  });
  const orig = console.error;
  console.error = () => {};
  try {
    const r = await call(api, '/api/gateway/session');
    assert.equal(r.statusCode, 500);
    assert.deepEqual(Object.keys(r.json()).sort(), ['error', 'message']);
    assert.ok(!r.body.includes(d) && !/at |\.mjs|node:|v\d+\.\d+/.test(r.body), r.body);
  } finally {
    console.error = orig;
  }
});

// ───────────────────────── (4) 模擬後端 ─────────────────────────
test('電子報模擬後端：每 IP 每分鐘 5 次（讀本體之前）⇒ 429 rate＋retryAfter；health 與退訂不限', async () => {
  assert.deepEqual(HTTP_RATE, { windowMs: 60_000, max: 5 }, '與 docs/deploy.md §13.4 的數字一致');
  const d = tmp('sub');
  const api = createSubscriptionApi({ dataFile: path.join(d, 's.json'), outboxDir: path.join(d, 'outbox'), basePath: '' });
  const post = (p, ip = '127.0.0.1') => call(api, p, { method: 'POST', ip, headers: { 'content-type': 'application/json' }, body: '{"email":"x"}' });
  for (let i = 0; i < 5; i++) assert.equal((await post('/api/subscriptions')).statusCode, 400);
  const r = await post('/api/subscriptions');
  assert.equal(r.statusCode, 429);
  assert.equal(r.req.bodyRead, false, '被擋的請求不讀本體（只放掉）');
  assert.equal(r.json().error, 'rate', '沿用電子報契約的錯誤碼（前端 subscribe.js 依此顯示「請 N 秒後再試」）');
  assert.ok(r.json().retryAfter > 0 && Number(r.headers['retry-after']) > 0);
  assert.equal((await call(api, '/api/subscriptions/confirm', {}, 'token=x')).statusCode, 429, 'confirm 也限');
  assert.equal((await call(api, '/api/health')).statusCode, 200, 'health 不限');
  assert.notEqual((await post('/api/subscriptions/unsubscribe')).statusCode, 429, '退訂不限（一鍵退訂來自信箱業者共用的 IP）');
  assert.equal((await post('/api/subscriptions', '198.51.100.1')).statusCode, 400, '別的 IP 不受影響');
});

test('問答紀錄信標：每 IP 每分鐘 30 次；放在代理後面時依信任代理取真實 IP', async () => {
  assert.deepEqual(ASK_RATE, { windowMs: 60_000, max: 30 });
  const api = createAskLogApi({ dir: tmp('ask'), rate: { windowMs: 60_000, max: 2 }, trustedProxies: ['10.0.0.5'] });
  const body = JSON.stringify({ q: '流感' });
  const send = (xff) => call(api, '/api/ask-log', { method: 'POST', ip: '10.0.0.5', headers: { 'content-type': 'text/plain', 'x-forwarded-for': xff }, body });
  assert.equal((await send('203.0.113.1')).statusCode, 204);
  assert.equal((await send('203.0.113.1')).statusCode, 204);
  const r = await send('203.0.113.1');
  assert.equal(r.statusCode, 429);
  assert.equal(r.json().error, 'rate');
  assert.equal(r.headers['retry-after'], '60');
  assert.equal((await send('203.0.113.2')).statusCode, 204, '代理後面的另一位民眾不受影響');
});

test('國際疫情推送端點：每 IP 每分鐘 30 次，429 在權杖檢查之前（猜權杖被減速）；未啟用時也先限流', async () => {
  assert.deepEqual(INTL_RATE, { windowMs: 60_000, max: 30 });
  const audit = {
    rows: [],
    write(a, o) {
      this.rows.push([a, o]);
    },
  };
  const api = createIntlFeedApi({ token: 'right-token', audit, rate: { windowMs: 60_000, max: 2 }, snapshotsDir: tmp('intl') });
  const push = () =>
    call(api, '/api/intl-epidemic', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer guess' }, body: '{}' });
  assert.equal((await push()).statusCode, 401);
  assert.equal((await push()).statusCode, 401);
  const r = await push();
  assert.equal(r.statusCode, 429);
  assert.equal(r.json().error, 'rate');
  assert.ok(!/30|每分鐘/.test(r.json().message), '訊息不說門檻');
  assert.equal(audit.rows.length, 2, '被限流的那次沒有走到權杖比對（沒有多一筆認證失敗）');
  const off = createIntlFeedApi({ token: '', rate: { windowMs: 60_000, max: 1 } });
  const p2 = () => call(off, '/api/intl-epidemic', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal((await p2()).statusCode, 503);
  assert.equal((await p2()).statusCode, 429);
});
