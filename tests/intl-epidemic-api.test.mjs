// 國際重要疫情資訊：推送端點（scripts/lib/intl-feed-api.mjs）、閘道手動匯入（/api/gateway/intl-epidemic/*）、
// 共用上架流程（scripts/lib/intl-epidemic-publish.mjs）、後台頁 /admin/intl-epidemic/ 的渲染與純邏輯（docs/intl-epidemic.md 第 6 節）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { createIntlFeedApi, MAX_BODY } from '../scripts/lib/intl-feed-api.mjs';
import { publishFeed, canImportIntl, REPO_PATHS } from '../scripts/lib/intl-epidemic-publish.mjs';
import { SNAPSHOT_FILE, RECORD_FILE } from '../scripts/lib/intl-epidemic.mjs';
import { createGatewayApi } from '../scripts/lib/gateway/index.mjs';
import { createHeaderAuth, principalFrom } from '../scripts/lib/gateway/auth.mjs';
import { createLocalGit } from '../scripts/lib/gateway/git-local.mjs';
import { createAuditLog, verifyAudit } from '../scripts/lib/gateway/store.mjs';
import { INTL_ADMIN_HREF } from '../scripts/lib/governance.mjs';
import { NAV } from '../src/templates/admin/_partials.mjs';
import { PAGE_RULES, canAccess, makeSession, DEMO_ACCOUNTS } from '../src/client/admin/auth-rules.js';
import * as page from '../src/templates/admin/intl-epidemic.mjs';
import { makeCtx } from '../scripts/lib/pages.mjs';
import * as C from '../src/client/admin/intl-epidemic-core.js';
import { govern } from './helpers.mjs';

const TODAY = '2026-10-13';
const tmpDir = (p = 'intl-api-') => fs.mkdtempSync(path.join(os.tmpdir(), p));
const TOKEN = 'test-token-0123456789abcdef';
const GIT_WORDS = /分支|branch|commit|提交|合併|merge|pull request|\bPR\b|\bMR\b|GitLab|GitHub|\bgit\b/i;

const item = (id, over = {}) => ({
  id,
  status: 'published',
  publishedAt: '2026-10-10T08:00:00+08:00',
  disease: '登革熱',
  headline: `越南-登革熱 ${id}`,
  body: `越南南部登革熱病例上升（測試 ${id}）。`,
  areas: [{ country: '越南', iso2: 'VN' }],
  ...over,
});
const feedOf = (items, over = {}) => ({ version: '1', producer: '測試資料庫', mode: 'delta', items, ...over });

async function serve(handler) {
  const srv = http.createServer(async (rq, rs) => {
    const u = new URL(rq.url, 'http://x');
    if (!(await handler(rq, rs, u.pathname, u.searchParams))) {
      rs.statusCode = 404;
      rs.end();
    }
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { srv, base: `http://127.0.0.1:${srv.address().port}` };
}
const readJSON = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

// ───────────────────────── 推送端點 ─────────────────────────
test('推送端點：沒設權杖 ⇒ 503 disabled（白話說明 INTL_FEED_TOKEN）；health 回 enabled', async () => {
  const api = createIntlFeedApi({ token: '', snapshotsDir: tmpDir() });
  const { srv, base } = await serve(api.handle);
  try {
    assert.deepEqual(await (await fetch(`${base}/api/intl-epidemic/health`)).json(), { ok: true, enabled: false });
    const r = await fetch(`${base}/api/intl-epidemic`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: '{}',
    });
    assert.equal(r.status, 503);
    const j = await r.json();
    assert.equal(j.error, 'disabled');
    assert.match(j.message, /INTL_FEED_TOKEN/);
    assert.equal((await fetch(`${base}/api/other`)).status, 404, '不是自己的路徑就交給下一個');
  } finally {
    srv.close();
  }
});

test('推送端點：錯權杖 401、好權杖上架並寫檔、held 202、看不懂 400、CSV 本體、Content-Type、稽核不含權杖', async () => {
  const dir = tmpDir();
  const auditFile = path.join(tmpDir(), 'audit.jsonl');
  const audit = createAuditLog(auditFile);
  const api = createIntlFeedApi({ token: TOKEN, snapshotsDir: dir, audit, today: TODAY, rate: { windowMs: 60_000, max: 100 } });
  const { srv, base } = await serve(api.handle);
  const post = (body, { type = 'application/json', token = TOKEN, query = '' } = {}) =>
    fetch(`${base}/api/intl-epidemic${query}`, {
      method: 'POST',
      headers: { 'content-type': type, ...(token != null ? { authorization: `Bearer ${token}` } : {}) },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
  try {
    assert.deepEqual(await (await fetch(`${base}/api/intl-epidemic/health`)).json(), { ok: true, enabled: true });
    const bad = await post(feedOf([item('a1')]), { token: 'wrong' });
    assert.equal(bad.status, 401);
    assert.match(bad.headers.get('www-authenticate'), /Bearer/);
    assert.equal((await post(feedOf([item('a1')]), { token: null })).status, 401, '沒帶權杖');
    assert.equal(fs.readdirSync(dir).length, 0, '認證失敗不寫任何檔');
    assert.equal((await post('x', { type: 'text/plain' })).status, 415);
    assert.equal((await fetch(`${base}/api/intl-epidemic`)).status, 405);

    const ok = await post(feedOf([item('a1'), item('a2')]));
    assert.equal(ok.status, 200);
    const j = await ok.json();
    assert.equal(j.ok, true);
    assert.equal(j.held, false);
    assert.deepEqual(j.changes, { new: 2, updated: 0, withdrawn: 0, unchanged: 0 });
    assert.deepEqual(j.rejected, []);
    assert.ok(Array.isArray(j.unmapped));
    assert.ok(j.report);
    const snap = readJSON(path.join(dir, SNAPSHOT_FILE));
    assert.deepEqual(
      snap.data.map((r) => r.id),
      ['a1', 'a2'],
    );
    assert.equal(snap.data[0].provenance.source, 'push');
    assert.equal(snap.meta.source, 'push');
    const rec = readJSON(path.join(dir, RECORD_FILE));
    assert.equal(rec.lastRun.source, 'push');
    assert.equal(rec.lastRun.producer, '測試資料庫');

    // 同一批再送：noop，不重寫快照
    const again = await (await post(feedOf([item('a1'), item('a2')]))).json();
    assert.equal(again.noop, true);

    // 退回超過 20% ⇒ 整批保留 202；快照不動，紀錄記 held
    const held = await post(feedOf([item('a3'), item('a4', { publishedAt: 'not-a-date' }), item('a5', { headline: '' })]));
    assert.equal(held.status, 202);
    const hj = await held.json();
    assert.equal(hj.held, true);
    assert.equal(hj.ok, false);
    assert.ok(hj.heldReasons.length);
    assert.equal(hj.rejected.length, 2);
    assert.deepEqual(
      readJSON(path.join(dir, SNAPSHOT_FILE)).data.map((r) => r.id),
      ['a1', 'a2'],
    );
    assert.ok(readJSON(path.join(dir, RECORD_FILE)).lastRun.held);

    // 看不懂 ⇒ 400
    const nj = await post('{not json');
    assert.equal(nj.status, 400);
    assert.equal((await nj.json()).error, 'bad_json');
    const nf = await post({ hello: 1 });
    assert.equal(nf.status, 400);
    assert.equal((await nf.json()).error, 'bad_feed');
    assert.equal((await post(feedOf([item('a9')]), { query: '?mode=weird' })).status, 400);

    // CSV 本體（delta：只動送來的那一則）
    const csv = 'id,publishedAt,disease,headline,body,countries,iso2s\na6,2026-10-11,麻疹,墨西哥-麻疹,墨西哥麻疹病例增加。,墨西哥,MX\n';
    const cr = await post(csv, { type: 'text/csv', query: '?mode=delta' });
    assert.equal(cr.status, 200, await cr.clone().text());
    assert.deepEqual((await cr.json()).changes.new, 1);
    assert.deepEqual(
      readJSON(path.join(dir, SNAPSHOT_FILE))
        .data.map((r) => r.id)
        .sort(),
      ['a1', 'a2', 'a6'],
    );

    // dry=1 不寫檔
    const before = fs.readFileSync(path.join(dir, SNAPSHOT_FILE), 'utf8');
    const dr = await (await post(feedOf([item('a7')]), { query: '?dry=1' })).json();
    assert.equal(dr.dry, true);
    assert.equal(dr.changes.new, 1);
    assert.equal(fs.readFileSync(path.join(dir, SNAPSHOT_FILE), 'utf8'), before);

    // 稽核：有紀錄、雜湊鏈完整、不含權杖
    const entries = audit.read();
    assert.ok(entries.some((e) => e.action === 'intl-push-auth' && e.result === 'denied'));
    assert.ok(entries.some((e) => e.action === 'intl-epidemic-import' && e.result === 'held'));
    assert.equal(verifyAudit(entries).ok, true);
    assert.doesNotMatch(fs.readFileSync(auditFile, 'utf8'), new RegExp(TOKEN));
  } finally {
    srv.close();
  }
});

test('推送端點：每分鐘節流 429（附 Retry-After），含認證失敗的嘗試', async () => {
  let t = 1_000_000;
  const api = createIntlFeedApi({ token: TOKEN, snapshotsDir: tmpDir(), today: TODAY, rate: { windowMs: 60_000, max: 2 }, now: () => t });
  const { srv, base } = await serve(api.handle);
  const post = () =>
    fetch(`${base}/api/intl-epidemic`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer nope' }, body: '{}' });
  try {
    assert.equal((await post()).status, 401);
    assert.equal((await post()).status, 401);
    const r = await post();
    assert.equal(r.status, 429);
    assert.ok(Number(r.headers.get('retry-after')) > 0);
    t += 61_000;
    assert.equal((await post()).status, 401, '一分鐘後恢復');
  } finally {
    srv.close();
  }
});

test('推送端點：本體超過 2 MB 回 413，而且讀完才回（同一條連線還能繼續用）', { timeout: 20000 }, async () => {
  const api = createIntlFeedApi({ token: TOKEN, snapshotsDir: tmpDir(), today: TODAY });
  const { srv, base } = await serve(api.handle);
  const u = new URL(base);
  try {
    const body = Buffer.concat([Buffer.from('{"pad":"'), Buffer.alloc(MAX_BODY + 4 * 1024 * 1024, 0x20), Buffer.from('"}')]);
    const req1 = `POST /api/intl-epidemic HTTP/1.1\r\nHost: ${u.host}\r\nConnection: keep-alive\r\nContent-Type: application/json\r\nAuthorization: Bearer ${TOKEN}\r\nContent-Length: ${body.length}\r\n\r\n`;
    const req2 = `GET /api/intl-epidemic/health HTTP/1.1\r\nHost: ${u.host}\r\nConnection: close\r\n\r\n`;
    const out = await new Promise((resolve, reject) => {
      const sock = net.connect(Number(u.port), u.hostname);
      let buf = '';
      let second = false;
      sock.on('data', (d) => {
        buf += d.toString('latin1');
        if (!second && /^HTTP\/1\.1 \d+/.test(buf) && buf.includes('\r\n\r\n')) {
          second = true;
          setTimeout(() => sock.write(req2), 20);
        }
      });
      sock.on('error', reject);
      sock.on('close', () => resolve(buf));
      sock.write(req1);
      sock.write(body);
    });
    const statuses = [...out.matchAll(/HTTP\/1\.1 (\d{3})/g)].map((m) => Number(m[1]));
    assert.deepEqual(statuses, [413, 200], out.slice(0, 300));
  } finally {
    srv.close();
  }
});

test('publishFeed：有 Git 供應者就把兩個檔提交到目標分支（服務帳號、尾端記來源）；與上次相同不產生版本', async () => {
  const d = tmpDir();
  const git = createLocalGit({ dir: path.join(d, 'repo') });
  const snapshotsDir = path.join(d, 'snap');
  const r = await publishFeed({ feed: feedOf([item('p1')]), source: 'push', git, snapshotsDir, today: TODAY });
  assert.equal(r.ok, true);
  assert.ok(r.version?.sha);
  const log = await git.log('main', 5);
  assert.match(log[0].message, /^data: 國際重要疫情資訊（推送）新增 1、更新 0、撤下 0/);
  assert.match(log[0].message, /\nSource: push\n/);
  assert.match(log[0].message, /\nProducer: 測試資料庫/);
  assert.equal(log[0].authorName, 'CDC Web Gateway');
  assert.match(await git.readFile('main', REPO_PATHS.snapshot), /"p1"/);
  assert.match(await git.readFile('main', REPO_PATHS.record), /"lastRun"/);
  const again = await publishFeed({ feed: feedOf([item('p1')]), source: 'push', git, snapshotsDir, today: TODAY });
  assert.equal(again.noop, true);
  assert.equal(again.version, null, '沒有寫檔就不產生版本');
  assert.equal((await git.log('main', 5)).length, log.length);
});

// ───────────────────────── 閘道手動匯入 ─────────────────────────
function makeGateway() {
  const d = tmpDir('intl-gw-');
  const seed = path.join(d, 'seed');
  fs.mkdirSync(path.join(seed, 'faq'), { recursive: true });
  fs.writeFileSync(path.join(seed, 'faq', 'x.json'), '{}\n');
  const snapshotsDir = path.join(d, 'snap');
  const api = createGatewayApi({
    stateFile: path.join(d, 'state.json'),
    auditFile: path.join(d, 'audit.jsonl'),
    outboxDir: path.join(d, 'outbox'),
    gitProvider: createLocalGit({ dir: path.join(d, 'repo'), seedDir: seed }),
    authAdapter: createHeaderAuth({ trustedProxies: ['127.0.0.1'] }),
    csrfSecret: 'test-secret',
    intl: { snapshotsDir, today: TODAY },
  });
  return { api, snapshotsDir };
}
const WHO = {
  epi: {
    'X-Remote-User': 'CDC\\demo-003',
    'X-Remote-Groups': 'CDC-WEB-epidemic-intelligence-editor;CDC-WEB-epidemic-intelligence-situation-publisher',
    'X-Remote-Name': encodeURIComponent('陳○宏'),
  },
  acute: { 'X-Remote-User': 'CDC\\demo-001', 'X-Remote-Groups': 'CDC-WEB-acute-infectious-editor' },
  it: { 'X-Remote-User': 'CDC\\demo-006', 'X-Remote-Groups': 'CDC-WEB-it-platform' },
};

test('權限：疫情中心的編輯／審核或跨單位角色才可以匯入', () => {
  const P = (groups) => principalFrom({ account: 'x', groups }, 'dev');
  assert.equal(canImportIntl(P(['CDC-WEB-epidemic-intelligence-editor'])), true);
  assert.equal(canImportIntl(P(['CDC-WEB-epidemic-intelligence-reviewer'])), true);
  assert.equal(canImportIntl(P(['CDC-WEB-pr-chief-editor'])), true);
  assert.equal(canImportIntl(P(['CDC-WEB-it-platform'])), true);
  assert.equal(canImportIntl(P(['CDC-WEB-acute-infectious-editor', 'CDC-WEB-acute-infectious-reviewer'])), false);
  assert.equal(canImportIntl(null), false);
});

test('閘道：未登入 401、非疫情中心 403（白話）、dry 不寫檔、確認後寫檔並留下版本（尾端記承辦人）', async () => {
  const { api, snapshotsDir } = makeGateway();
  const { srv, base } = await serve(api.handle);
  const host = new URL(base).host;
  const csrf = async (who) => (await (await fetch(`${base}/api/gateway/session`, { headers: who })).json()).csrfToken;
  const post = async (who, body) =>
    fetch(`${base}/api/gateway/intl-epidemic/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: `http://${host}`, 'x-csrf-token': await csrf(who), ...who },
      body: JSON.stringify(body),
    });
  try {
    const anon = await fetch(`${base}/api/gateway/intl-epidemic/status`);
    assert.equal(anon.status, 401);
    const anonPost = await fetch(`${base}/api/gateway/intl-epidemic/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: `http://${host}` },
      body: '{}',
    });
    assert.equal(anonPost.status, 401);

    const denied = await post(WHO.acute, { feed: feedOf([item('g1')]) });
    assert.equal(denied.status, 403);
    assert.match((await denied.json()).message, /疫情中心/);
    assert.equal((await fetch(`${base}/api/gateway/intl-epidemic/status`, { headers: WHO.acute })).status, 403);

    // 沒有 CSRF token：既有規則照擋
    const noCsrf = await fetch(`${base}/api/gateway/intl-epidemic/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: `http://${host}`, ...WHO.epi },
      body: JSON.stringify({ feed: feedOf([item('g1')]) }),
    });
    assert.equal(noCsrf.status, 403);

    const dry = await post(WHO.epi, { feed: feedOf([item('g1'), item('g2')]), mode: 'delta', dry: true });
    assert.equal(dry.status, 200, await dry.clone().text());
    const dj = await dry.json();
    assert.equal(dj.dry, true);
    assert.equal(dj.saved, false);
    assert.deepEqual(dj.changes, { new: 2, updated: 0, withdrawn: 0, unchanged: 0 });
    assert.equal(fs.existsSync(path.join(snapshotsDir, SNAPSHOT_FILE)), false, 'dry 不寫檔');
    assert.equal(fs.existsSync(path.join(snapshotsDir, RECORD_FILE)), false);

    const real = await post(WHO.epi, { feed: feedOf([item('g1'), item('g2')]), mode: 'delta' });
    assert.equal(real.status, 200);
    const rj = await real.json();
    assert.equal(rj.saved, true);
    assert.doesNotMatch(JSON.stringify(rj), /\bsha\b|data\/snapshots/, '回應不帶版本細節與檔案路徑');
    const snap = readJSON(path.join(snapshotsDir, SNAPSHOT_FILE));
    assert.deepEqual(
      snap.data.map((r) => r.id),
      ['g1', 'g2'],
    );
    assert.equal(snap.data[0].provenance.source, 'manual');
    assert.equal(snap.data[0].provenance.by, 'demo-003', '快照只記帳號');
    const log = await api.git.log('main', 3);
    assert.match(log[0].message, /國際重要疫情資訊（後台手動匯入）新增 2/);
    assert.match(log[0].message, /\nSource: manual\n/);
    assert.match(log[0].message, /\nImported-by: 陳○宏 \(AD: demo-003\)/);
    assert.match(await api.git.readFile('main', REPO_PATHS.snapshot), /"g2"/);

    // 狀態：lastRun 是剛才那次
    const st = await (await fetch(`${base}/api/gateway/intl-epidemic/status`, { headers: WHO.epi })).json();
    assert.equal(st.lastRun.source, 'manual');
    assert.equal(st.lastRun.by, 'demo-003');
    assert.equal(st.history.length, 1);

    // 跨單位（平台管理）可以；CSV 字串也收
    const csv = 'id,publishedAt,disease,headline,body,countries,iso2s\ng3,2026-10-11,麻疹,墨西哥-麻疹,內文,墨西哥,MX\n';
    const it = await post(WHO.it, { feed: csv, mode: 'delta' });
    assert.equal(it.status, 200, await it.clone().text());
    assert.equal((await it.json()).changes.new, 1);

    // 整批保留 ⇒ 202；看不懂 ⇒ 400；mode 不對 ⇒ 400
    const held = await post(WHO.epi, { feed: feedOf([item('g4', { headline: '' }), item('g5', { publishedAt: 'x' })]), mode: 'delta' });
    assert.equal(held.status, 202);
    assert.equal((await held.json()).held, true);
    assert.equal((await post(WHO.epi, { feed: { hello: 1 } })).status, 400);
    assert.equal((await post(WHO.epi, { feed: feedOf([item('g6')]), mode: 'all' })).status, 400);
    assert.equal((await post(WHO.epi, {})).status, 400);

    const audit = api.audit.read();
    assert.ok(audit.some((e) => e.action === 'intl-epidemic-import' && e.result === 'denied' && e.actor?.account === 'demo-001'));
    assert.ok(audit.some((e) => e.action === 'intl-epidemic-import' && e.result === 'ok' && e.actor?.account === 'demo-003'));
  } finally {
    srv.close();
  }
});

// ───────────────────────── 後台頁 ─────────────────────────
const RUN = {
  at: '2026-10-13T00:30:00.000Z',
  source: 'push',
  by: null,
  shape: 'v1',
  mode: 'full',
  producer: '疫情中心資料庫',
  received: 10,
  accepted: 7,
  counts: { new: 1, updated: 2, withdrawn: 3, unchanged: 1, rejected: 3, upgraded: 0 },
  total: 76,
  held: { reasons: ['退回 3／10 則（30%），超過 20%'] },
  rejected: [{ id: 'rej-1', index: 4, headline: '某國-某病', errors: ['缺少發布時間'] }],
  unmapped: [{ kind: 'disease', value: '奇怪病', ids: ['u-1', 'u-2'] }],
  withdrawn: [],
  warnings: [],
  wroteSnapshot: false,
};

test('後台頁：狀態框（held 紅框與理由）、退回表、對不上表、現行清單連到站內頁、歷史、導覽與權限', () => {
  const site = govern(TODAY);
  site.snapshots.intlImport = {
    version: 1,
    lastRun: RUN,
    history: [{ at: RUN.at, source: 'push', received: 10, counts: RUN.counts, unmapped: 1, held: RUN.held.reasons, wroteSnapshot: false }],
  };
  const ctx = makeCtx(site, 'zh-TW', { path: '/admin/intl-epidemic/', alternates: ['zh-TW'] });
  const body = String(page.render(ctx));
  assert.match(body, /adm-box--err/);
  assert.match(body, /整批保留不動/);
  assert.match(body, /退回 3／10 則/);
  assert.match(body, /推送（疫情中心系統送來）/);
  assert.match(body, /<code>rej-1<\/code>\s*<\/td>\s*<td>某國-某病<\/td>\s*<td>缺少發布時間/);
  assert.match(body, /奇怪病/);
  assert.match(body, /<code>u-2<\/code>/);
  assert.match(body, /下次匯入會自動對上/);
  assert.match(body, /href="[^"]*\/travel\/alerts\/[A-Za-z0-9_.-]+\/"/);
  assert.match(body, /排程拉取/);
  assert.match(body, /推送/);
  assert.match(body, /手動/);
  assert.match(body, /id="adm-intl-data"/);
  assert.match(body, /<option value="VN">越南（VN）<\/option>/);
  // 只看同事讀得到的文字（嵌入資料與國家下拉的 ISO 國碼會有 MR＝茅利塔尼亞之類，不算）
  const visible = body
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<select[\s\S]*?<\/select>/g, ' ')
    .replace(/<[^>]+>/g, ' ');
  assert.doesNotMatch(visible, GIT_WORDS, '後台頁文案不出現版本控制用語');
  const full = String(page.layout(ctx, { ...page.meta(), body }));
  assert.match(full, /href="[^"]*\/admin\/intl-epidemic\/" aria-current="page">國際疫情匯入/);
  const k = NAV.findIndex((n) => n.key === 'intl-epidemic');
  assert.equal(NAV[k - 1].key, 'situation', '放在「疫情發布」旁');
  assert.equal(INTL_ADMIN_HREF, '/admin/intl-epidemic/');
  assert.ok(site.gov.todos.filter((t) => String(t.kind).startsWith('intl-feed')).every((t) => t.href === '/admin/intl-epidemic/'));
  assert.deepEqual(PAGE_RULES['intl-epidemic'], ['situation-publisher', 'chief-editor', 'governance', 'platform']);
  const ses = (sub) => makeSession(DEMO_ACCOUNTS.find((a) => a.sub === sub));
  assert.equal(canAccess(ses('demo-003'), 'intl-epidemic'), true, '疫情中心');
  assert.equal(canAccess(ses('demo-006'), 'intl-epidemic'), true, '平台管理');
  assert.equal(canAccess(ses('demo-001'), 'intl-epidemic'), false, '其他單位承辦人');
});

test('後台頁：沒有匯入紀錄時說明、沒有退回時不出表', () => {
  assert.match(String(page.lastRunBox(null)), /還沒有匯入紀錄/);
  assert.match(String(page.rejectedTable({ rejected: [] })), /沒有退回/);
  assert.match(String(page.unmappedTable({ unmapped: [] })), /都對得上/);
  assert.match(String(page.historyTable([])), /尚無紀錄/);
  const ok = String(page.lastRunBox({ ...RUN, held: null, wroteSnapshot: true }));
  assert.match(ok, /adm-box--ok/);
  assert.match(ok, /2026-10-13 08:30（台北時間）/);
});

// ───────────────────────── 純邏輯 ─────────────────────────
const DISEASES = [{ id: 'disease.dengue', name: '登革熱', nameEn: 'Dengue fever', aliases: [] }];
const COUNTRIES = [
  { iso2: 'VN', name: '越南', nameEn: 'Vietnam' },
  { iso2: 'MX', name: '墨西哥', nameEn: 'Mexico' },
];
const CTX = { today: TODAY, diseases: DISEASES, countries: COUNTRIES };

test('core：單則表單 → item（台北時間、國家主檔帶名稱、其他國家、識別碼自動產生且穩定）', () => {
  const f = {
    publishedAt: '2026-10-12T09:30',
    disease: ' 登革熱 ',
    headline: '越南／墨西哥-登革熱',
    body: '內文\n第二段',
    iso2s: ['VN', 'MX', 'VN'],
    otherCountries: '帛琉; zz、某島',
    sourceUrl: 'https://example.org/x',
  };
  const it = C.itemFromForm(f, { countries: COUNTRIES });
  assert.equal(it.publishedAt, '2026-10-12T09:30:00+08:00');
  assert.equal(it.disease, '登革熱');
  assert.deepEqual(it.areas, [
    { country: '越南', countryEn: 'Vietnam', iso2: 'VN' },
    { country: '墨西哥', countryEn: 'Mexico', iso2: 'MX' },
    { country: '帛琉' },
    { iso2: 'ZZ' },
    { country: '某島' },
  ]);
  assert.match(it.id, /^manual-20261012-[0-9a-z]{1,8}$/);
  assert.equal(C.itemFromForm(f, { countries: COUNTRIES }).id, it.id, '同一則重送得到同一個 id');
  assert.equal(C.itemFromForm({ ...f, id: ' db-123 ' }, { countries: COUNTRIES }).id, 'db-123');
  assert.equal(it.instruction, undefined, '空欄位不帶');
  assert.equal(C.taipeiIso('2026-10-12'), '2026-10-12');
  assert.equal(C.taipeiIso(''), '');
});

test('core：預覽列（錯誤標紅、對應到的疾病與國家、清單內重複 id）與摘要（超過兩成會整批保留）', () => {
  const good = C.itemFromForm({ publishedAt: '2026-10-12', disease: '登革熱', headline: 'h', body: 'b', iso2s: ['VN'] }, { countries: COUNTRIES });
  const bad = { id: 'bad-1', publishedAt: '2099-01-01', disease: '登革熱', headline: '', body: 'b', areas: [] };
  const odd = { id: 'odd', publishedAt: '2026-10-12', disease: '怪病', headline: 'h', body: 'b', areas: [{ country: '某島' }] };
  const rows = C.previewRows([good, bad, odd, { ...odd }], CTX);
  assert.equal(rows[0].bad, false);
  assert.equal(rows[0].diseaseName, '登革熱');
  assert.deepEqual(rows[0].countries, [{ label: '越南 VN', mapped: true, global: false }]);
  assert.equal(rows[1].bad, true);
  assert.ok(rows[1].errors.some((m) => /明天以後/.test(m)));
  assert.ok(rows[1].errors.some((m) => /標題/.test(m)));
  assert.equal(rows[2].bad, false);
  assert.equal(rows[2].diseaseName, null);
  assert.equal(rows[2].countries[0].mapped, false);
  assert.ok(rows[2].warnings.some((m) => /出現不只一次/.test(m)));
  const s = C.previewSummary(rows);
  assert.deepEqual([s.total, s.ok, s.bad, s.warned, s.willHold], [4, 3, 1, 2, true]);
  assert.match(s.text, /共 4 則、可上架 3、有錯會被退回 1/);
  assert.equal(C.previewSummary(C.previewRows([good], CTX)).willHold, false);
  const feed = C.buildFeed([good], { mode: 'delta', now: '2026-10-13T00:00:00Z' });
  assert.deepEqual(Object.keys(feed), ['version', 'producer', 'generatedAt', 'mode', 'items']);
  assert.equal(feed.version, '1');
  assert.equal(C.exportFilename(TODAY), 'intl-epidemic-20261013.json');
  assert.equal(C.changesText({ changes: { new: 1, updated: 2, withdrawn: 0, unchanged: 3 }, rejected: [{}] }), '新增 1、更新 2、撤下 0、不變 3、退回 1');
});

test('core：貼上的文字自動判斷 v1／CSV／舊官網匯出；看不懂給白話', () => {
  const v1 = C.parseInput(JSON.stringify(feedOf([item('x1')], { mode: 'full' })));
  assert.equal(v1.shape, 'v1');
  assert.equal(v1.mode, 'full');
  assert.equal(v1.items[0].id, 'x1');
  const csv = C.parseInput('﻿id,publishedAt,disease,headline,body,countries,iso2s\nc1,2026-10-11,麻疹,h,b,越南;墨西哥,VN;MX\n');
  assert.equal(csv.shape, 'csv');
  assert.deepEqual(
    csv.items[0].areas.map((a) => a.iso2),
    ['VN', 'MX'],
  );
  const legacy = C.parseInput(
    JSON.stringify([
      {
        headline: '越南-登革熱',
        description: 'd',
        effective: '2026-10-10 08:00:00',
        alert_disease: '登革熱',
        areaDesc: '越南',
        ISO3166: 'VN',
        web: 'https://www.cdc.gov.tw/TravelEpidemic/Detail/abc?epidemicId=abcDEF123',
      },
    ]),
  );
  assert.equal(legacy.shape, 'legacy');
  assert.equal(legacy.items.length, 1);
  assert.match(C.parseInput('hello').error, /看不懂/);
  assert.equal(C.parseInput('').error, '沒有內容');
});

test('core：lastRunView（模板與瀏覽器共用）', () => {
  assert.equal(C.lastRunView(null), null);
  const v = C.lastRunView(RUN);
  assert.equal(v.sourceLabel, '推送（疫情中心系統送來）');
  assert.deepEqual(v.held, ['退回 3／10 則（30%），超過 20%']);
  assert.deepEqual(
    v.stats.map((s) => [s.label, s.value]),
    [
      ['收到', 10],
      ['接受', 7],
      ['退回', 3],
      ['對不上主檔', 1],
      ['新增', 1],
      ['更新', 2],
      ['撤下', 3],
    ],
  );
  assert.deepEqual(C.lastRunView({ ...RUN, held: ['x'] }).held, ['x'], 'history 的 held 是字串陣列');
  assert.equal(C.fmtTaipei('2026-10-12T16:05:00Z'), '2026-10-13 00:05');
});
