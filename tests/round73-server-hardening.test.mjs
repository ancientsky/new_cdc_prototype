// 第七十三輪（安全稽核：伺服器端，docs/deploy.md §35）回歸測試。每一個 test 對應稽核報告的一項：
//   1.【嚴重】serve.mjs 路徑穿越（..%2f）           2.【高】讀檔錯誤讓 process 當掉；只收 GET／HEAD
//   3.【高】/api/dev/* 在正式部署與同機代理後面要關   4.【中】Host 標頭污染（信件連結）；非 dev 模式必須設 PUBLIC_ORIGIN
//   5.【中】ipMatcher 驗證與 IPv6                    6.【中】clientKey 從右往左走、IPv6 以 /64 分組
//   7.【中】國際疫情 feed 多餘欄位進公開 JSON          8.【中】CSV 解析上限
//   9.【低】確認 token 只用一次、狀態機節流用 clientKey、認證失敗稽核不逐筆、ask-log page 欄位
import './helpers.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { resolveStatic, createStaticHandler, devEndpointsFrom, isInside } from '../scripts/lib/static-serve.mjs';
import { ipMatcher, clientIp, clientKey, rateKey, normIp, isDirectLoopback, hasProxyHeaders, linkOrigin } from '../scripts/lib/rate-limit.mjs';
import { createDevAuth, DEV_SESSION_HEADER } from '../scripts/lib/gateway/auth.mjs';
import { createGatewayApi } from '../scripts/lib/gateway/index.mjs';
import { makeSession, DEMO_ACCOUNTS } from '../src/client/admin/auth-rules.js';
import { createSubscriptionApi } from '../scripts/lib/subscribe-mock.mjs';
import { parseEml } from '../scripts/lib/mail-outbox.mjs';
import { createService } from '../src/client/subscribe-service.js';
import { CONFIRM_TTL_MS } from '../src/client/subscribe-rules.js';
import { createAskLogApi, cleanPage, sanitizeEvent } from '../scripts/lib/ask-log-mock.mjs';
import { createIntlFeedApi } from '../scripts/lib/intl-feed-api.mjs';
import { parseFeed, validateFeed, planImport, LEGACY_FIELDS } from '../scripts/lib/intl-epidemic.mjs';
import { publishFeed } from '../scripts/lib/intl-epidemic-publish.mjs';
import * as R from '../src/client/intl-epidemic-rules.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), `r73-${p}-`));

/** 假請求（本體可讀）與假回應：跟 round63 的同一套 */
function fakeReq({ method = 'GET', body = '', headers = {}, ip = '127.0.0.1' } = {}) {
  const r = Readable.from(
    (function* () {
      if (body) yield Buffer.from(body);
    })(),
  );
  r.method = method;
  r.headers = { host: 'localhost:4173', ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])) };
  r.socket = { remoteAddress: ip };
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
  return { handled, ...res, json: () => JSON.parse(res.body) };
}

/** 原樣送出路徑（不讓 fetch／URL 先正規化，等同 curl --path-as-is） */
function rawGet(port, rawPath, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: rawPath, method, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}
const freePort = () =>
  new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = /** @type {net.AddressInfo} */ (s.address());
      s.close(() => resolve(port));
    });
  });

/** 一個小小的假 dist：index.html、404.html、子目錄、指向外面的 symlink；外面放一個「祕密」檔 */
function fakeDist() {
  const top = tmp('dist');
  const dist = path.join(top, 'dist');
  fs.mkdirSync(path.join(dist, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>home</title>');
  fs.writeFileSync(path.join(dist, '404.html'), '<!doctype html><title>404</title>NOTFOUND-PAGE');
  fs.writeFileSync(path.join(dist, 'sub', 'index.html'), 'SUB');
  fs.writeFileSync(path.join(dist, 'app.js'), 'console.log(1)');
  fs.writeFileSync(path.join(top, 'secret.txt'), 'TOP-SECRET');
  fs.symlinkSync(path.join(top, 'secret.txt'), path.join(dist, 'leak.txt'));
  fs.symlinkSync(top, path.join(dist, 'up'));
  return { top, dist };
}

// ───────────────────────── 1. 路徑穿越 ─────────────────────────
test('1 resolveStatic：..%2f 解碼後的 ..、\\0、symlink 走出 dist、FIFO 一律拒絕；正常檔與目錄 index 照給', () => {
  const { dist } = fakeDist();
  const real = fs.realpathSync(dist);
  assert.equal(resolveStatic(dist, '/'), path.join(real, 'index.html'));
  assert.equal(resolveStatic(dist, '/sub'), path.join(real, 'sub', 'index.html'));
  assert.equal(resolveStatic(dist, '/app.js'), path.join(real, 'app.js'));
  for (const bad of [
    '/../secret.txt',
    '/../../../../etc/passwd',
    '/sub/../../secret.txt',
    '/..\\secret.txt',
    '/leak.txt',
    '/up/secret.txt',
    '/index.html\0.png',
    '/nope.html',
  ])
    assert.equal(resolveStatic(dist, bad), null, bad);
  if (process.platform !== 'win32') {
    execFileSync('mkfifo', [path.join(dist, 'pipe.html')]);
    assert.equal(resolveStatic(dist, '/pipe.html'), null, 'FIFO 不是一般檔案');
  }
  assert.equal(isInside('/a/dist', '/a/dist-internal/x'), false, '前綴相同的兄弟目錄不算在裡面');
});

test('1+2 serve.mjs（真的啟動）：..%2f 等向量全部 404、/proc/self/mem 不會讓 process 當掉、非 GET/HEAD 405、basePath 有邊界', { timeout: 30000 }, async () => {
  const { top, dist } = fakeDist();
  const port = await freePort();
  const env = {
    ...process.env,
    DIST_DIR: dist,
    BASE_PATH: '/bp',
    GATEWAY: 'off',
    SUBSCRIPTIONS_FILE: path.join(top, 'subs.json'),
    OUTBOX_DIR: path.join(top, 'outbox'),
    ASK_LOG_DIR: path.join(top, 'ask-log'),
    INTL_FEED_TOKEN: '',
    MOCK_RATE_LIMIT: 'off',
  };
  for (const k of ['PUBLIC_ORIGIN', 'GATEWAY_TRUSTED_PROXIES', 'DEV_ENDPOINTS', 'NODE_ENV', 'SITE_MODE']) delete env[k];
  const child = spawn(process.execPath, [path.join(ROOT, 'scripts/serve.mjs'), String(port)], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (err += d));
  try {
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`serve.mjs 沒有啟動：${out}${err}`)), 15000);
      child.stdout.on('data', () => out.includes(`localhost:${port}`) && (clearTimeout(t), resolve()));
      child.on('exit', (c) => reject(new Error(`serve.mjs 結束了（${c}）：${err}`)));
    });
    assert.match(out, /開發用端點.*已開啟（本機開發/, '啟動訊息說明開發用端點的狀態');
    assert.equal((await rawGet(port, '/bp/')).status, 200);
    assert.equal((await rawGet(port, '/bp/sub/')).body, 'SUB');
    const vectors = [
      '/bp/..%2fsecret.txt',
      '/bp/..%2f..%2fpackage.json',
      '/bp/%2e%2e%2fsecret.txt',
      '/bp..%2fsecret.txt',
      '/bp/..%5csecret.txt',
      '/bp/..%2f..%2f..%2f..%2f..%2f..%2fetc%2fpasswd',
      '/bp/..%2f..%2f..%2f..%2f..%2f..%2fproc%2fself%2fenviron',
      '/bp/leak.txt',
      '/bp/up/secret.txt',
      '/bpXYZ',
    ];
    for (const v of vectors) {
      const r = await rawGet(port, v);
      assert.ok(r.status === 404 || r.status === 400, `${v} → ${r.status}`);
      assert.doesNotMatch(r.body, /TOP-SECRET|root:x:0|"name":|INTL_FEED|PATH=/, v);
    }
    assert.equal((await rawGet(port, '/bp/index.html%00.png')).status, 400);
    // 2. 舊版：讀 /proc/self/mem 丟 EIO，沒人接 ⇒ process 結束。現在不在 dist 裡直接 404，而且之後的請求照常
    for (const p of ['/bp/..%2f..%2f..%2f..%2f..%2f..%2fproc%2fself%2fmem', '/bp/..%2f..%2f..%2f..%2f..%2f..%2fdev%2fzero'])
      assert.equal((await rawGet(port, p)).status, 404);
    assert.equal((await rawGet(port, '/bp/')).status, 200, '伺服器還活著');
    assert.equal(child.exitCode, null);
    // §18-c：只收 GET／HEAD
    const del = await rawGet(port, '/bp/index.html', 'DELETE');
    assert.equal(del.status, 405);
    assert.equal(del.headers.allow, 'GET, HEAD');
    const head = await rawGet(port, '/bp/index.html', 'HEAD');
    assert.equal(head.status, 200);
    assert.equal(head.body, '');
    assert.equal(head.headers['x-content-type-options'], 'nosniff');
    // 3. 本機直連可以看模擬信件匣；帶代理標頭（同機反向代理）就 403
    assert.equal((await rawGet(port, '/bp/api/dev/outbox')).status, 200);
  } finally {
    child.kill();
  }
});

test('2 createStaticHandler：開檔前檔案剛好被刪（重建 dist 的競態）⇒ 404，不丟未處理的例外；同一種錯誤每分鐘只記一行', async () => {
  const { dist } = fakeDist();
  const logs = [];
  const serve = createStaticHandler({ distDir: dist, log: (m) => logs.push(m) });
  const srv = http.createServer((req, res) => {
    const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const f = path.join(dist, url);
    serve(req, res, url);
    if (url.startsWith('/gone')) fs.rmSync(f, { force: true }); // createReadStream 是非同步開檔：在它開檔前刪掉
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const { port } = /** @type {net.AddressInfo} */ (srv.address());
  try {
    for (const n of [1, 2]) {
      fs.writeFileSync(path.join(dist, `gone${n}.html`), 'x');
      assert.equal((await rawGet(port, `/gone${n}.html`)).status, 404);
    }
    assert.equal(logs.length, 1, '兩次 ENOENT 只記一行');
    assert.match(logs[0], /ENOENT/);
    assert.equal((await rawGet(port, '/app.js')).status, 200, '之後照常服務');
  } finally {
    srv.close();
  }
});

// ───────────────────────── 3. 開發用端點 ─────────────────────────
test('3a devEndpointsFrom：本機開發預設開；正式環境的任何訊號都關；DEV_ENDPOINTS=on 強制開、=off 關', () => {
  assert.deepEqual(devEndpointsFrom({}), { on: true, forced: false, reasons: [] });
  for (const env of [
    { SITE_MODE: 'production' },
    { NODE_ENV: 'production' },
    { GATEWAY_TRUSTED_PROXIES: '10.0.0.5' },
    { PUBLIC_ORIGIN: 'https://cms.cdc.gov.tw' },
    { DEV_ENDPOINTS: 'off' },
  ])
    assert.equal(devEndpointsFrom(env).on, false, JSON.stringify(env));
  const forced = devEndpointsFrom({ DEV_ENDPOINTS: 'on', PUBLIC_ORIGIN: 'https://x.example' });
  assert.equal(forced.on, true);
  assert.equal(forced.forced, true);
  assert.deepEqual(forced.reasons, ['PUBLIC_ORIGIN 有設定']);
  assert.equal(devEndpointsFrom({ GATEWAY_TRUSTED_PROXIES: '  ' }).on, true, '空白不算有設');
});

test('3b 本機 socket＋代理標頭 ⇒ 不是本機直連：模擬信件匣、查詢紀錄報表、閘道 dev 登入都 403', async () => {
  for (const h of ['x-forwarded-for', 'forwarded', 'x-real-ip', 'x-forwarded-host']) {
    const req = { socket: { remoteAddress: '127.0.0.1' }, headers: { [h]: '203.0.113.66' } };
    assert.equal(hasProxyHeaders(req), true, h);
    assert.equal(isDirectLoopback(req), false, h);
  }
  assert.equal(isDirectLoopback({ socket: { remoteAddress: '::ffff:127.0.0.1' }, headers: {} }), true);
  assert.equal(isDirectLoopback({ socket: { remoteAddress: '10.0.0.1' }, headers: {} }), false);

  const d = tmp('dev');
  const sub = createSubscriptionApi({ dataFile: path.join(d, 's.json'), outboxDir: path.join(d, 'outbox'), httpRate: null });
  assert.equal((await call(sub, '/api/dev/outbox')).statusCode, 200);
  assert.equal((await call(sub, '/api/dev/outbox', { headers: { 'X-Forwarded-For': '203.0.113.66' } })).statusCode, 403);
  assert.equal((await call(sub, '/api/dev/outbox', { headers: { Forwarded: 'for=203.0.113.66' } })).statusCode, 403);
  const subOff = createSubscriptionApi({ dataFile: path.join(d, 's.json'), outboxDir: path.join(d, 'outbox'), devOutbox: false });
  assert.equal((await call(subOff, '/api/dev/outbox')).statusCode, 404);

  const ask = createAskLogApi({ dir: path.join(d, 'ask'), rate: null });
  assert.equal((await call(ask, '/api/dev/ask-log/report')).statusCode, 200);
  assert.equal((await call(ask, '/api/dev/ask-log/report', { headers: { 'X-Real-IP': '203.0.113.66' } })).statusCode, 403);

  const auth = createDevAuth();
  const session = Buffer.from(JSON.stringify(makeSession(DEMO_ACCOUNTS[0]))).toString('base64url');
  const direct = await auth.authenticate(/** @type {any} */ ({ socket: { remoteAddress: '127.0.0.1' }, headers: { [DEV_SESSION_HEADER]: session } }));
  assert.equal(direct.ok, true);
  const proxied = await auth.authenticate(
    /** @type {any} */ ({ socket: { remoteAddress: '127.0.0.1' }, headers: { [DEV_SESSION_HEADER]: session, 'x-forwarded-for': '203.0.113.66' } }),
  );
  assert.deepEqual([proxied.ok, proxied.status, proxied.code], [false, 403, 'dev_remote']);
});

// ───────────────────────── 4. Host 標頭污染 ─────────────────────────
test('4a linkOrigin：有 PUBLIC_ORIGIN 只用它；沒有時只接受本機 Host，其他一律 http://localhost', () => {
  const req = (host) => ({ headers: { host } });
  assert.equal(linkOrigin(req('evil.example:8080')), 'http://localhost');
  assert.equal(linkOrigin(req('cdc-gov-tw.evil.example')), 'http://localhost');
  assert.equal(linkOrigin(req('localhost.evil.example')), 'http://localhost');
  assert.equal(linkOrigin(req('127.0.0.1:4173')), 'http://127.0.0.1:4173');
  assert.equal(linkOrigin(req('LOCALHOST:4173')), 'http://localhost:4173');
  assert.equal(linkOrigin(req('[::1]:4173')), 'http://[::1]:4173');
  assert.equal(linkOrigin(req('evil.example'), 'https://www.cdc.gov.tw/'), 'https://www.cdc.gov.tw');
});

test('4b 電子報模擬後端：偽造 Host 寄出的確認信與管理信不帶攻擊者的網址', async () => {
  const d = tmp('host');
  const api = createSubscriptionApi({ dataFile: path.join(d, 's.json'), outboxDir: path.join(d, 'outbox'), httpRate: null });
  const body = JSON.stringify({ email: 'victim@example.com', topics: ['news'], frequency: 'weekly', lang: 'zh-TW', consent: true });
  const r = await call(api, '/api/subscriptions', { method: 'POST', body, headers: { host: 'evil.example:8080', 'content-type': 'application/json' } });
  assert.equal(r.statusCode, 202);
  const eml = parseEml(fs.readFileSync(path.join(d, 'outbox', fs.readdirSync(path.join(d, 'outbox'))[0]), 'utf8'));
  assert.doesNotMatch(eml.text + eml.headers['list-unsubscribe'], /evil\.example/);
  assert.match(eml.text, /http:\/\/localhost\/\S*subscribe\/\?confirm=/);
  const pub = createSubscriptionApi({
    dataFile: path.join(d, 's2.json'),
    outboxDir: path.join(d, 'outbox2'),
    httpRate: null,
    publicOrigin: 'https://www.cdc.gov.tw',
  });
  await call(pub, '/api/subscriptions', { method: 'POST', body, headers: { host: 'evil.example', 'content-type': 'application/json' } });
  assert.match(fs.readFileSync(path.join(d, 'outbox2', fs.readdirSync(path.join(d, 'outbox2'))[0]), 'utf8'), /https:\/\/www\.cdc\.gov\.tw\//);
});

test('4c 寫入閘道：非 dev 模式沒設 PUBLIC_ORIGIN 就不啟動；有設、或 dev 模式照常', () => {
  const d = tmp('gw');
  const base = {
    stateFile: path.join(d, 's.json'),
    auditFile: path.join(d, 'a.jsonl'),
    outboxDir: path.join(d, 'o'),
    gitProvider: /** @type {any} */ ({}),
    csrfSecret: 't',
  };
  const header = { mode: 'header', authenticate: async () => ({ ok: false }) };
  assert.throws(() => createGatewayApi({ ...base, authAdapter: header, publicOrigin: '' }), /PUBLIC_ORIGIN/);
  assert.doesNotThrow(() => createGatewayApi({ ...base, authAdapter: header, publicOrigin: 'https://cms.cdc.example' }));
  assert.doesNotThrow(() => createGatewayApi({ ...base, authAdapter: { mode: 'dev', authenticate: async () => ({ ok: false }) }, publicOrigin: '' }));
});

// ───────────────────────── 5. ipMatcher ─────────────────────────
test('5 ipMatcher：/33 以上、位元組 > 255、看不懂的寫法、/0 一律啟動失敗；IPv6 CIDR 真的照網段比；大小寫與寫法正規化', () => {
  for (const bad of ['10.0.0.1/33', '10.0.0.0/99', '10.300.0.0/8', '999.1.1.1', 'fd00::/129', 'proxy.local', '0.0.0.0/0', '::/0', '10.0.0.0/-1'])
    assert.throws(() => ipMatcher([bad]), /信任代理清單/, bad);
  const m = ipMatcher(['10.0.0.0/8', '192.0.2.7', 'fd00::/8', 'FD12::1', '2001:db8::/32']);
  assert.equal(m('8.8.8.8'), false, '舊版 /33 會信任 0–127.x');
  assert.equal(m('10.200.1.1'), true);
  assert.equal(m('::ffff:10.1.2.3'), true);
  assert.equal(m('192.0.2.7'), true);
  assert.equal(m('192.0.2.8'), false);
  assert.equal(m('fd00:abcd::5'), true, 'IPv6 CIDR');
  assert.equal(m('fd12:0:0:0:0:0:0:1'), true, 'IPv6 寫法不同也比得中');
  assert.equal(m('FD12::1'), true, '大小寫');
  assert.equal(m('2001:DB8:FFFF::1'), true);
  assert.equal(m('2001:db9::1'), false);
  assert.equal(m('fe80::1'), false);
  assert.equal(m(undefined), false);
  assert.equal(m('garbage'), false);
  assert.equal(ipMatcher([])('10.0.0.1'), false);
  assert.equal(normIp('::ffff:a01:203'), '10.1.2.3', 'hex 形式的 IPv4-mapped');
  assert.equal(normIp(' 2001:DB8:0:0::1 '), '2001:db8::1');
});

// ───────────────────────── 6. clientKey ─────────────────────────
test('6 clientIp／clientKey：從右往左走；整串都是信任位址 ⇒ socket（不取用戶端可寫的最左邊）；看不懂的一段 ⇒ 停在它右邊；IPv6 以 /64 分組', () => {
  const r = (ip, xff) => ({ socket: { remoteAddress: ip }, headers: xff ? { 'x-forwarded-for': xff } : {} });
  const T = { trustedProxies: ['10.0.0.0/8'] };
  assert.equal(clientIp(r('10.0.0.5', '10.1.1.1, 10.2.2.2'), T), '10.0.0.5', '內網同事自己寫 10.1.1.1 換不了 key');
  assert.equal(clientIp(r('10.0.0.5', '6.6.6.6, fe80::1%eth0'), T), '10.0.0.5', '看不懂的一段：不再跳過它往左找');
  assert.equal(clientIp(r('10.0.0.5', '6.6.6.6, garbage, 10.0.0.9'), T), '10.0.0.9', '停在看不懂那段的右邊');
  assert.equal(clientIp(r('10.0.0.5', '6.6.6.6, 198.51.100.7, 10.0.0.9'), T), '198.51.100.7', '一般情況照舊');
  assert.equal(clientIp(r('10.0.0.5', '[2001:DB8::1]:443'), T), '2001:db8::1', '完整位址（稽核用）已正規化');
  assert.equal(clientKey(r('10.0.0.5', '[2001:DB8::1]:443'), T), '2001:db8::/64');
  assert.equal(clientKey(r('2001:db8:1:2:aaaa::1')), clientKey(r('2001:db8:1:2:bbbb::9')), '同一個 /64 共用一個 key');
  assert.notEqual(clientKey(r('2001:db8:1:2::1')), clientKey(r('2001:db8:1:3::1')));
  assert.equal(rateKey('::1'), '::1');
  assert.equal(rateKey('203.0.113.5'), '203.0.113.5');
});

// ───────────────────────── 7. 國際疫情 feed 多餘欄位 ─────────────────────────
const CTX = {
  diseases: [{ id: 'disease.dengue', name: '登革熱', nameEn: 'Dengue fever' }],
  countries: [{ iso2: 'JP', name: '日本', nameEn: 'Japan' }],
  allowlist: { numbers: new Set(), domains: [], entries: [], errors: [] },
};
const item = (over = {}) => ({
  id: 'r73a',
  status: 'published',
  publishedAt: '2026-10-10T08:00:00+08:00',
  disease: '登革熱',
  headline: '日本-登革熱',
  body: '日本登革熱病例增加。',
  areas: [{ country: '日本', iso2: 'JP' }],
  ...over,
});
const plan = (items) =>
  planImport({ feed: { version: '1', mode: 'delta', items, shape: 'v1' }, today: '2026-10-13', now: '2026-10-13T02:00:00.000Z', source: 'feed', ...CTX });

test('7 國際疫情：item／area／reference 的未定義欄位一律退回；參考資料標題也掃個資；快照只白名單複製', () => {
  const p1 = plan([item({ areas: [{ country: '日本', iso2: 'JP', internalContact: '王小明 0912345678' }] })]);
  assert.equal(p1.changes.new.length, 0);
  assert.match(JSON.stringify(p1.report), /internalContact/);
  const p2 = plan([item({ references: [{ title: 'x', url: 'https://a.example/', reporterPhone: '0912345678' }] })]);
  assert.equal(p2.changes.new.length, 0);
  const p3 = plan([item({ secretNote: '內部' })]);
  assert.equal(p3.changes.new.length, 0);
  const v = validateFeed({ version: '1', items: [item({ references: [{ title: '聯絡人 0912345678', url: 'https://a.example/' }] })] }, CTX);
  assert.equal(v.results[0].pii, true, 'references[].title 也做個資掃描');
  const ok = plan([item({ references: [{ title: 'WHO', url: 'https://www.who.int/' }] })]);
  assert.deepEqual(ok.changes.new, ['r73a']);
  const row = ok.snapshotRows.find((x) => x.id === 'r73a');
  assert.deepEqual(row.areas, [{ country: '日本', iso2: 'JP' }]);
  assert.deepEqual(row.references, [{ title: 'WHO', url: 'https://www.who.int/' }]);
  // 舊格式（官網 ExportJSON）列：只留 LEGACY_FIELDS
  const legacy = [
    {
      headline: '日本-登革熱',
      description: '日本登革熱病例增加。',
      effective: '2026-10-10T08:00:00+08:00',
      alert_disease: '登革熱',
      areaDesc: '日本',
      ISO3166: 'JP',
      web: 'https://www.cdc.gov.tw/x?epidemicId=r73legacy',
      internalMemo: '王小明 0912345678',
      __proto__x: 1,
    },
  ];
  const lp = planImport({
    feed: parseFeed(legacy, { shape: 'legacy' }),
    mode: 'delta',
    today: '2026-10-13',
    now: '2026-10-13T02:00:00.000Z',
    source: 'official-export',
    ...CTX,
  });
  const lrow = lp.snapshotRows.find((x) => x.id === 'r73legacy');
  assert.ok(lrow, JSON.stringify(lp.report));
  assert.equal('internalMemo' in lrow, false);
  assert.equal('__proto__x' in lrow, false);
  assert.ok(LEGACY_FIELDS.includes('areaDetail'));
});

// ───────────────────────── 8. CSV 上限 ─────────────────────────
test('8 parseCsv：欄數、列數、單格長度有上限；只對認得的欄建物件（2 萬欄 × 1 千列不再卡 5 秒）；推送端點回 400 bad_feed', async () => {
  const header = Array.from({ length: 20000 }, (_, i) => `c${i}`).join(',');
  const t0 = performance.now();
  assert.throws(() => R.parseCsv(`${header}\n${'x\n'.repeat(1000)}`), /欄數太多/);
  assert.ok(performance.now() - t0 < 500, '在讀完表頭之前就停');
  assert.throws(() => R.parseCsv(`id\n${'x\n'.repeat(R.CSV_LIMITS.rows + 1)}`), /列數太多/);
  assert.equal(R.parseCsv(`id\n${'x\n'.repeat(R.CSV_LIMITS.rows)}`).length, R.CSV_LIMITS.rows, '剛好在上限內');
  assert.throws(() => R.parseCsv(`id,body\na,"${'y'.repeat(R.CSV_LIMITS.field + 1)}"\n`), /欄位太長/);
  assert.deepEqual(R.parseCsv('id,evil,headline,__proto__\na,b,c,d\n'), [{ id: 'a', headline: 'c' }], '不認得的欄名丟掉');
  // 60 欄（含 50 個不認得的）× 5000 列：仍然快
  const wide = ['id', ...Array.from({ length: 59 }, (_, i) => `x${i}`)].join(',');
  const t1 = performance.now();
  R.parseCsv(`${wide}\n${`a${',b'.repeat(59)}\n`.repeat(5000)}`);
  assert.ok(performance.now() - t1 < 2000);
  await assert.rejects(
    publishFeed({ feed: `${header}\nx\n`, shape: 'csv', source: 'push', dry: true, snapshotsDir: tmp('csv') }),
    (e) => e.code === 'bad_feed' && e.status === 400,
  );
});

// ───────────────────────── 9. 低風險項目 ─────────────────────────
test('9a 確認 token：第一次才換到 manageToken；重複確認只回 already；48 小時後作廢', () => {
  const db = { version: 1, subscriptions: [] };
  let clock = Date.parse('2026-10-10T00:00:00Z');
  const svc = createService({ load: () => db, save: () => {}, mail: () => {}, now: () => clock, uuid: () => crypto.randomUUID() });
  svc.subscribe({ email: 'reader@example.com', topics: ['news'], frequency: 'weekly', lang: 'zh-TW', consent: true });
  const s = db.subscriptions[0];
  const token = s.confirmToken;
  const first = svc.confirm(token);
  assert.equal(first.body.manageToken, s.manageToken);
  const again = svc.confirm(token);
  assert.equal(again.status, 200);
  assert.equal(again.body.already, true);
  assert.equal('manageToken' in again.body, false, '轉寄出去的確認連結換不到管理權');
  clock += CONFIRM_TTL_MS + 1000;
  assert.equal(svc.confirm(token).status, 410);
  assert.equal(s.confirmToken, null, '過期後作廢');
  assert.equal(svc.confirm(token).status, 404);
});

test('9b 電子報狀態機的每 IP 節流用 clientKey：代理後面的不同民眾不共用代理那一個 IP', async () => {
  const d = tmp('sub-ip');
  const api = createSubscriptionApi({
    dataFile: path.join(d, 's.json'),
    outboxDir: path.join(d, 'o'),
    httpRate: null,
    trustedProxies: ['127.0.0.1'],
    limits: { windowMs: 600_000, perIp: 1, perEmail: 5 },
  });
  const sub = (email, xff) =>
    call(api, '/api/subscriptions', {
      method: 'POST',
      body: JSON.stringify({ email, topics: ['news'], frequency: 'weekly', lang: 'zh-TW', consent: true }),
      headers: { 'content-type': 'application/json', 'x-forwarded-for': xff },
    });
  assert.equal((await sub('a@example.com', '203.0.113.1')).statusCode, 202);
  assert.equal((await sub('b@example.com', '203.0.113.1')).statusCode, 429, '同一位民眾第二次被擋');
  assert.equal((await sub('c@example.com', '203.0.113.2')).statusCode, 202, '另一位民眾不受影響');
});

test('9c 國際疫情推送：認證失敗的稽核每個來源每分鐘只記一筆', async () => {
  const rows = [];
  let t = 0;
  const api = createIntlFeedApi({ token: 'right-token', audit: { write: (a, o) => rows.push([a, o]) }, rate: null, now: () => t, snapshotsDir: tmp('intl') });
  const push = (ip) =>
    call(api, '/api/intl-epidemic', { method: 'POST', ip, headers: { 'content-type': 'application/json', authorization: 'Bearer guess' }, body: '{}' });
  for (let i = 0; i < 5; i++) assert.equal((await push('203.0.113.9')).statusCode, 401);
  assert.equal(rows.length, 1);
  await push('203.0.113.10');
  assert.equal(rows.length, 2, '別的來源另記');
  t += 60_000;
  await push('203.0.113.9');
  assert.equal(rows.length, 3, '下一分鐘再記');
  assert.equal(rows[0][0], 'intl-push-auth');
});

test('9d 問答紀錄 page 欄位：去控制字元與奇怪字元、遮蔽個資', () => {
  assert.equal(cleanPage('/zh/answer/?q=x'), '/zh/answer/');
  assert.equal(cleanPage('/a\n"},{evil'), null);
  assert.equal(cleanPage('/a b'), null);
  assert.equal(cleanPage('x'), null);
  const masked = cleanPage('/A123456789/0912345678');
  assert.ok(masked && !/A123456789|0912345678/.test(masked), masked);
  const ev = sanitizeEvent({ q: '流感', page: '/a\u0000/A123456789' });
  assert.equal(ev.page, null);
});
