// 第六十六輪：同事離職或調動時怎麼交接（guide-staff §61、docs/deploy.md §33、architecture-decisions §52）。
//   1. 寫入閘道「接手」：同單位的編輯接手進行中的送審件；別單位 403；之後的通知只寄新承辦人；原承辦人仍受四眼原則；稽核有紀錄；
//      清單可依承辦人篩選（view=all&editor=）。
//   2. scripts/reassign-owner.mjs：試算不改檔、改寫只動 owner；不上架的單位不能當新單位；裁撤單位（retiredAt）的內容建置失敗。
//   3. postPublishReview.reviewedBy 只能寫單位或職稱，不能寫人名（規則 30）。
//   4. lanes.json 名單有個人帳號 ⇒ 建置警告（不擋）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { adGroupsOf, makeSession, DEMO_ACCOUNTS } from '../src/client/admin/auth-rules.js';
import { principalFrom, normAccount } from '../scripts/lib/gateway/auth.mjs';
import { createValidator } from '../scripts/lib/gateway/validate-item.mjs';
import { createLocalGit } from '../scripts/lib/gateway/git-local.mjs';
import { createGatewayApi } from '../scripts/lib/gateway/index.mjs';
import { verifyAudit } from '../scripts/lib/gateway/store.mjs';
import { parseEml } from '../scripts/lib/mail-outbox.mjs';
import { reassignOwner, formatReport, ReassignError } from '../scripts/lib/reassign-owner.mjs';
import { reviewedByProblem, validateSite } from '../scripts/lib/validate.mjs';
import { personalAccountEntries, personalAccountWarnings, loadLanes, PERSONAL_ACCOUNT_MSG } from '../scripts/lib/lanes.mjs';
import { loadSite } from '../scripts/lib/load.mjs';
import { config } from './helpers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmpDir = (p = 'r66-') => fs.mkdtempSync(path.join(os.tmpdir(), p));
const acct = (sub) => DEMO_ACCOUNTS.find((a) => a.sub === sub);
const P = (sub) =>
  principalFrom({ account: normAccount(sub), name: acct(sub).name, email: `${sub}@cdc-prototype.invalid`, groups: adGroupsOf(acct(sub)) }, 'dev');
const validator = createValidator();
const CTX = { origin: 'http://localhost:4173', basePath: '' };

function faq(id = `faq.r66-${crypto.randomBytes(3).toString('hex')}`) {
  return {
    id,
    type: 'faq',
    title: '登革熱發燒要多久就醫？',
    question: '登革熱發燒要多久就醫？',
    owner: 'unit.acute-infectious',
    steward: '急性傳染病組承辦人',
    publishedAt: '2026-10-10',
    reviewedAt: '2026-10-10',
    reviewPeriodMonths: 6,
    status: 'draft',
    audience: ['public'],
    tasks: ['symptoms'],
    sensitivity: 'public',
    license: 'OGDL-1.0',
    languages: { 'zh-TW': { status: 'source' } },
    summary: '出現發燒請儘速就醫。告知醫師旅遊史。',
    answerMarkdown: '出現發燒、頭痛、後眼窩痛時，請儘速就醫。就醫時告知醫師旅遊史與活動地點。',
  };
}
function makeApi() {
  const d = tmpDir();
  const seed = tmpDir('r66-seed-');
  fs.mkdirSync(path.join(seed, 'faq'), { recursive: true });
  fs.writeFileSync(path.join(seed, 'faq', 'old.json'), `${JSON.stringify(faq('faq.old'), null, 2)}\n`);
  const api = createGatewayApi({
    stateFile: path.join(d, 'state.json'),
    auditFile: path.join(d, 'audit.jsonl'),
    outboxDir: path.join(d, 'outbox'),
    gitProvider: createLocalGit({ dir: path.join(d, 'repo'), seedDir: seed }),
    validator,
    csrfSecret: 'r66',
  });
  const mails = () =>
    fs.existsSync(path.join(d, 'outbox'))
      ? fs
          .readdirSync(path.join(d, 'outbox'))
          .filter((f) => f.endsWith('.eml'))
          .sort()
          .map((f) => parseEml(fs.readFileSync(path.join(d, 'outbox', f), 'utf8')))
      : [];
  return { api, W: api.workflow, repo: path.join(d, 'repo'), mails };
}
/** 模擬 HTTP 呼叫（與 round53 同一個做法） */
function httpOf(api, sub) {
  const sess = { 'x-cdc-dev-session': Buffer.from(JSON.stringify(makeSession(acct(sub)))).toString('base64url') };
  return async (method, url, body) => {
    const chunks = [];
    const req = Object.assign(
      (async function* () {
        if (body) yield Buffer.from(JSON.stringify(body));
      })(),
      {
        method,
        headers: { host: 'localhost', origin: 'http://localhost', 'content-type': 'application/json', ...sess },
        socket: { remoteAddress: '127.0.0.1' },
      },
    );
    const res = {
      statusCode: 0,
      headers: {},
      setHeader(k, v) {
        this.headers[k.toLowerCase()] = v;
      },
      end(b) {
        if (b) chunks.push(String(b));
      },
    };
    const u = new URL(url, 'http://localhost');
    if (method === 'POST') req.headers['x-csrf-token'] = api.csrfFor(P(sub));
    await api.handle(req, res, u.pathname, u.searchParams);
    return { status: res.statusCode, body: JSON.parse(chunks.join('') || 'null') };
  };
}
const to = (m) => m.headers.to;

// ───────────────────────── 1. 閘道：接手 ─────────────────────────
test('接手：同單位編輯接手審核中的送審件；別單位 403；通知只寄新承辦人；原承辦人仍不能核准（四眼）；稽核有 handover', async () => {
  const { api, W, repo, mails } = makeApi();
  const lin = P('demo-002'); // 急性組科長（編輯＋審核），原承辦人
  const wang = P('demo-001'); // 急性組承辦人，接手的人
  const other = P('demo-003'); // 疫情中心，別單位
  const chief = P('demo-004'); // 公關室內容總編輯（一般車道審核單位）
  const item = faq();
  const s = await W.submit(lin, { item }, CTX);
  assert.equal(s.status, 'in_review');
  assert.deepEqual(
    s.contacts.map((e) => e.account),
    ['demo-002'],
  );
  assert.equal(s.can.handover, false, '原承辦人自己是唯一承辦人，不用接手');

  // 別單位：403（白話說明），而且有稽核紀錄
  await assert.rejects(
    W.handover(other, { submissionId: s.id }),
    (e) => e.status === 403 && /權責單位是「急性傳染病組」/.test(e.message) && /同單位/.test(e.message),
  );
  // 沒有編輯角色（平台管理）：403
  await assert.rejects(W.handover(P('demo-006'), { submissionId: s.id }), (e) => e.status === 403);
  await assert.rejects(W.handover(wang, { submissionId: 'gw-20260101-000000' }), (e) => e.status === 404);

  assert.equal(W.list(wang, { view: 'all' }).find((x) => x.id === s.id).can.handover, true, '同單位的編輯看得到「接手」');
  const h = await W.handover(wang, { submissionId: s.id, note: '林科長調任，由王承辦接手' });
  assert.deepEqual(
    h.contacts.map((e) => e.account),
    ['demo-001'],
  );
  assert.deepEqual(
    h.editors.map((e) => [e.account, !!e.handedOver]),
    [
      ['demo-002', true],
      ['demo-001', false],
    ],
    '原承辦人留在承辦紀錄裡、標已交接',
  );
  assert.equal(h.status, 'in_review', '接手不改狀態、不改內容');
  assert.match(h.history.at(-1).label, /改由 王○安 承辦（接手 林○慧）：林科長調任/);
  await assert.rejects(W.handover(wang, { submissionId: s.id }), (e) => e.status === 409 && e.code === 'already');

  // 承辦人篩選（view=all&editor=）：只列目前承辦（沒交接出去）的
  assert.deepEqual(
    W.list(lin, { view: 'all', editor: 'demo-001' }).map((x) => x.id),
    [s.id],
  );
  assert.deepEqual(
    W.list(lin, { view: 'all', editor: 'demo-002' }).map((x) => x.id),
    [],
    '交接出去的人篩不到',
  );
  assert.deepEqual(
    W.list(lin, { view: 'mine' }).map((x) => x.id),
    [s.id],
    '「我的」仍看得到自己編過的',
  );

  // 四眼原則：交接出去的林科長（有審核角色）仍不能核准或退回；接手的王承辦也不能
  await assert.rejects(W.approve(lin, { submissionId: s.id }), (e) => e.status === 403 && /四眼原則/.test(e.message));
  await assert.rejects(W.returnForChanges(lin, { submissionId: s.id, comment: '我來退' }), (e) => e.status === 403 && /四眼原則/.test(e.message));

  // 退回：通知只寄新承辦人
  const before = mails().length;
  await W.returnForChanges(chief, { submissionId: s.id, comment: '請補充旅遊史怎麼說。' }, CTX);
  const ret = mails()
    .slice(before)
    .filter((m) => /已退回/.test(m.headers.subject));
  assert.deepEqual(ret.map(to), ['<demo-001@cdc-prototype.invalid>']);
  // 接手的人修改再送審 ⇒ 送審通知不寄給承辦紀錄上的任何人（含交接出去的林科長）
  const n2 = mails().length;
  await W.submit(wang, { item: { ...item, answerMarkdown: `${item.answerMarkdown}出國回來兩週內發燒也要說。` }, submissionId: s.id }, CTX);
  assert.deepEqual(mails().slice(n2).map(to), ['<demo-004@cdc-prototype.invalid>'], '送審通知只給審核人；林科長編過這件，不通知她審');
  const n3 = mails().length;
  const done = await W.approve(chief, { submissionId: s.id, comment: '可' }, CTX);
  assert.equal(done.status, 'published');
  assert.deepEqual(
    mails()
      .slice(n3)
      .filter((m) => /已核准上線/.test(m.headers.subject))
      .map(to),
    ['<demo-001@cdc-prototype.invalid>'],
    '核准通知只寄新承辦人',
  );
  // 上線的提交訊息照記兩位編輯（誰改過都留紀錄）
  const msg = execFileSync('git', ['-C', repo, 'log', '-1', '--format=%B', 'main'], { encoding: 'utf8' });
  assert.match(msg, /Edited-by: 林○慧 \(AD: demo-002\)/);
  assert.match(msg, /Edited-by: 王○安 \(AD: demo-001\)/);
  assert.match(msg, /Approved-by: 張○玲 \(AD: demo-004\)/);
  await assert.rejects(W.handover(lin, { submissionId: s.id }), (e) => e.status === 409 && /已經結束/.test(e.message), '已上線的不用接手');

  // 稽核：handover 有 from／to；拒絕的也記；雜湊鏈完整；不記意見全文
  const entries = api.audit.read();
  const ho = entries.find((e) => e.action === 'handover' && e.result === 'ok');
  assert.deepEqual([ho.from, ho.to, ho.submission, ho.actor.account], [['demo-002'], 'demo-001', s.id, 'demo-001']);
  assert.ok(entries.some((e) => e.action === 'handover' && e.result === 'denied' && e.actor.account === 'demo-003'));
  assert.equal(verifyAudit(entries).ok, true);
  assert.ok(!JSON.stringify(entries).includes('林科長調任'), '稽核只記字數，不記說明全文');
});

test('接手：HTTP 路由 POST /items/:id/handover 與 GET /items?view=all&editor=；交接出去的人再存一版就又是承辦人', async () => {
  const { api, W } = makeApi();
  const s = await W.saveDraft(P('demo-001'), { item: faq() });
  const asLin = httpOf(api, 'demo-002'),
    asOther = httpOf(api, 'demo-003');
  assert.equal((await asOther('POST', `/api/gateway/items/${s.id}/handover`, {})).status, 403);
  const r = await asLin('POST', `/api/gateway/items/${s.id}/handover`, { note: '代理' });
  assert.equal(r.status, 200);
  assert.deepEqual(
    r.body.contacts.map((e) => e.account),
    ['demo-002'],
  );
  const l = await asLin('GET', '/api/gateway/items?view=all&editor=demo-002');
  assert.deepEqual(
    l.body.items.map((x) => x.id),
    [s.id],
  );
  assert.deepEqual((await asLin('GET', '/api/gateway/items?view=all&editor=demo-001')).body.items, []);
  assert.equal((await asLin('GET', '/api/gateway/items?view=all&editor=../x')).status, 200, '不合格的帳號參數就當沒篩');
  // 王承辦其實沒離開，又存了一版 ⇒ 兩位都是承辦人（通知兩位都收）
  const again = await W.saveDraft(P('demo-001'), {
    item: { ...faq(s.contentId), answerMarkdown: '出現發燒時請儘速就醫，並告知醫師旅遊史。' },
    submissionId: s.id,
  });
  assert.deepEqual(again.contacts.map((e) => e.account).sort(), ['demo-001', 'demo-002']);
});

// ───────────────────────── 2. reassign-owner ─────────────────────────
function fixtureRoot() {
  const root = tmpDir('r66-root-');
  fs.mkdirSync(path.join(root, 'content/master'), { recursive: true });
  fs.mkdirSync(path.join(root, 'content/faq'), { recursive: true });
  fs.mkdirSync(path.join(root, 'content/news'), { recursive: true });
  fs.mkdirSync(path.join(root, 'content/assets/faq.a'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'content/master/units.json'), path.join(root, 'content/master/units.json'));
  const a = {
    id: 'faq.a',
    type: 'faq',
    title: '甲',
    owner: 'unit.acute-infectious',
    steward: '急性傳染病組承辦人',
    reviewedAt: '2026-01-02',
    publishedAt: '2025-12-01',
  };
  fs.writeFileSync(path.join(root, 'content/faq/a.json'), `${JSON.stringify(a, null, 2)}\n`);
  fs.writeFileSync(path.join(root, 'content/faq/b.json'), `{"id":"faq.b","type":"faq","title":"乙","owner":"unit.pr"}\n`);
  fs.writeFileSync(path.join(root, 'content/news/n.json'), `{\n  "id": "news.n", "type": "news", "title": "丙",\n  "owner":   "unit.acute-infectious"\n}\n`);
  fs.writeFileSync(path.join(root, 'content/master/diseases.json'), `[\n  {"id":"dengue","name":"登革熱","owner":"unit.acute-infectious"}\n]\n`);
  fs.writeFileSync(path.join(root, 'content/assets/faq.a/data.json'), `{"owner":"unit.acute-infectious"}\n`);
  return root;
}
const snapshot = (root) =>
  Object.fromEntries(
    ['content/faq/a.json', 'content/faq/b.json', 'content/news/n.json', 'content/master/diseases.json', 'content/assets/faq.a/data.json'].map((f) => [
      f,
      fs.readFileSync(path.join(root, f), 'utf8'),
    ]),
  );

test('reassign-owner：試算不改任何檔；改寫只動 owner（格式、reviewedAt 都不動）；--type 只改那些型別；附件資料夾不碰', () => {
  const root = fixtureRoot();
  const before = snapshot(root);
  const dry = reassignOwner({ root, from: 'unit.acute-infectious', to: 'unit.chronic-infectious', dryRun: true });
  assert.deepEqual(snapshot(root), before, '--dry-run 什麼都不改');
  assert.deepEqual(dry.rows.map((r) => r.id).sort(), ['dengue', 'faq.a', 'news.n']);
  assert.deepEqual(dry.files.sort(), ['content/faq/a.json', 'content/master/diseases.json', 'content/news/n.json']);
  const md = formatReport(dry, { today: '2026-10-26' });
  assert.match(md, /\| `faq.a` \| faq \| 甲 \| `content\/faq\/a.json` \|/);
  assert.match(md, /試算/);
  assert.match(md, /steward.*還寫著舊單位[\s\S]*faq\.a/);
  assert.match(md, /一般車道，由 OASIS 與公關室審核/);

  const onlyFaq = reassignOwner({ root, from: 'unit.acute-infectious', to: 'unit.chronic-infectious', types: ['faq'] });
  assert.deepEqual(onlyFaq.files, ['content/faq/a.json']);
  const after = snapshot(root);
  assert.equal(
    after['content/faq/a.json'],
    before['content/faq/a.json'].replace('"owner": "unit.acute-infectious"', '"owner": "unit.chronic-infectious"'),
    '只換 owner，一個字都不多動',
  );
  const a = JSON.parse(after['content/faq/a.json']);
  assert.deepEqual([a.reviewedAt, a.publishedAt, a.steward], ['2026-01-02', '2025-12-01', '急性傳染病組承辦人']);
  assert.equal(after['content/news/n.json'], before['content/news/n.json'], '型別不在 --type 就不動');
  assert.equal(after['content/master/diseases.json'], before['content/master/diseases.json']);

  reassignOwner({ root, from: 'unit.acute-infectious', to: 'unit.chronic-infectious' });
  const all = snapshot(root);
  assert.match(all['content/news/n.json'], /"owner":   "unit.chronic-infectious"/, '原本的空白也保留');
  assert.match(all['content/master/diseases.json'], /"owner":"unit.chronic-infectious"/);
  assert.equal(all['content/faq/b.json'], before['content/faq/b.json'], '別的單位的內容不動');
  assert.equal(all['content/assets/faq.a/data.json'], before['content/assets/faq.a/data.json'], 'content/assets/ 是附件，不碰');
});

test('reassign-owner：兩個單位都要在主檔；不上架的單位、已裁撤的單位不能當新單位', () => {
  const root = fixtureRoot();
  const bad = (o) => assert.throws(() => reassignOwner({ root, dryRun: true, ...o }), ReassignError);
  bad({ from: 'unit.nope', to: 'unit.pr' });
  bad({ from: 'unit.pr', to: 'unit.nope' });
  bad({ from: 'unit.pr', to: 'unit.pr' });
  assert.throws(() => reassignOwner({ root, from: 'unit.pr', to: 'unit.director', dryRun: true }), /不上架內容/);
  const units = JSON.parse(fs.readFileSync(path.join(root, 'content/master/units.json'), 'utf8'));
  units.find((u) => u.id === 'unit.planning').retiredAt = '2026-01-01';
  units.find((u) => u.id === 'unit.planning').successor = 'unit.oasis';
  fs.writeFileSync(path.join(root, 'content/master/units.json'), JSON.stringify(units));
  assert.throws(() => reassignOwner({ root, from: 'unit.pr', to: 'unit.planning', dryRun: true }), /已於 2026-01-01 裁撤，請改指向承接單位 unit.oasis/);
});

test('裁撤單位（retiredAt）：owner 還指到它的內容建置失敗，訊息指向承接單位與 npm run reassign-owner；successor 必須存在', () => {
  const site = loadSite(config);
  site.today = '2026-10-26';
  assert.deepEqual(
    validateSite(site).filter((e) => /裁撤|successor|reviewedBy/.test(e)),
    [],
    '現有內容沒有裁撤單位、沒有人名',
  );
  const units = site.master.units.map((u) => (u.id === 'unit.planning' ? { ...u, retiredAt: '2026-01-01', successor: 'unit.oasis' } : u));
  const errs = validateSite({ ...site, master: { ...site.master, units } });
  const hit = errs.filter((e) => e.includes('unit.planning（企劃組）已於 2026-01-01 裁撤'));
  assert.ok(hit.length > 0, '企劃組的內容都報出來');
  assert.ok(hit.every((e) => e.includes('npm run reassign-owner -- --from unit.planning --to unit.oasis')));
  // 裁撤日還沒到：照常（可以先把改組寫進主檔）
  const future = site.master.units.map((u) => (u.id === 'unit.planning' ? { ...u, retiredAt: '2099-01-01', successor: 'unit.oasis' } : u));
  assert.equal(validateSite({ ...site, master: { ...site.master, units: future } }).filter((e) => e.includes('裁撤')).length, 0);
  // successor 不存在／沒填
  const noSucc = site.master.units.map((u) => (u.id === 'unit.ethics' ? { ...u, retiredAt: '2026-01-01' } : u));
  assert.ok(validateSite({ ...site, master: { ...site.master, units: noSucc } }).some((e) => /unit.ethics：retiredAt 已填，請一併填 successor/.test(e)));
  const badSucc = site.master.units.map((u) => (u.id === 'unit.ethics' ? { ...u, retiredAt: '2026-01-01', successor: 'unit.nope' } : u));
  assert.ok(validateSite({ ...site, master: { ...site.master, units: badSucc } }).some((e) => /successor unit.nope 不在 units 主檔/.test(e)));
});

// ───────────────────────── 3. reviewedBy 不寫人名 ─────────────────────────
test('postPublishReview.reviewedBy：單位 id、單位名稱＋職稱可以；人名、帳號、單位＋人名不行（規則 30）', () => {
  const units = JSON.parse(fs.readFileSync(path.join(ROOT, 'content/master/units.json'), 'utf8'));
  for (const ok of ['公關室承辦人', 'unit.pr', '公關室', '公關室 內容總編輯', '急性傳染病組科長', '公關室（值班）', '審核人', undefined])
    assert.equal(reviewedByProblem(ok, units), null, String(ok));
  for (const bad of ['王小明', '公關室王小明', '王○安', 'wang.an', '公關室承辦人 張三', 'ancientsky', '  ']) assert.ok(reviewedByProblem(bad, units), bad);
  assert.match(reviewedByProblem('王小明', units), /不寫人名或帳號/);
  // 接進建置：一筆內容寫了人名 ⇒ 治理門檻錯誤
  const site = loadSite(config);
  site.today = '2026-10-26';
  const victim = site.all.find((i) => i.postPublishReview?.reviewedBy);
  assert.ok(victim, '現有內容有 reviewedBy 的範例（公關室承辦人）');
  const orig = victim.postPublishReview;
  victim.postPublishReview = { ...orig, reviewedBy: '公關室陳大文' };
  try {
    assert.ok(validateSite(site).some((e) => e.startsWith(victim.__file) && /reviewedBy「公關室陳大文」看起來不是單位或職稱/.test(e)));
  } finally {
    victim.postPublishReview = orig;
  }
});

// ───────────────────────── 4. 發布名單的個人帳號 ─────────────────────────
test('lanes.json：名單有個人帳號 ⇒ 一行建置警告（不擋）；全部 team: ⇒ 沒有警告', () => {
  const cfg = loadLanes();
  const hits = personalAccountEntries(cfg);
  assert.ok(hits.some((h) => h.where === 'lanes.fast.allowedAuthors' && h.account === 'ancientsky'));
  assert.ok(hits.some((h) => h.where === 'reviewerAccounts.unit.pr'));
  assert.ok(!hits.some((h) => h.where.startsWith('lanes.fast.allowedAuthorsByType')), '型別授權已經是 team:');
  const w = personalAccountWarnings(cfg);
  assert.equal(w.length, 1, '只一行，不洗版');
  assert.ok(w[0].startsWith(PERSONAL_ACCOUNT_MSG));
  const teamOnly = structuredClone(cfg);
  for (const l of Object.values(teamOnly.lanes)) if (l.allowedAuthors) l.allowedAuthors = ['team:CDC-WEB-pr-chief-editor'];
  teamOnly.rules.urgentAllowedAuthors = ['TEAM:CDC-WEB-pr-chief-editor'];
  teamOnly.reviewerAccounts = { default: 'team:CDC-WEB-pr-reviewer' };
  assert.deepEqual(personalAccountWarnings(teamOnly), []);
  teamOnly.lanes.fast.allowedAuthorsByType.job = ['someone'];
  assert.deepEqual(personalAccountEntries(teamOnly), [{ where: 'lanes.fast.allowedAuthorsByType.job', account: 'someone' }]);
});

test('後台「我的內容」：有閘道才出現單位送審件（承辦人篩選、接手按鈕）；沒閘道時隱藏', () => {
  const tpl = fs.readFileSync(path.join(ROOT, 'src/templates/admin/mine.mjs'), 'utf8');
  assert.match(tpl, /id="gw-unit"[^>]*hidden/);
  assert.match(tpl, /id="gwu-editor"/);
  assert.match(tpl, /mine-gateway\.js/);
  const js = fs.readFileSync(path.join(ROOT, 'src/client/admin/mine-gateway.js'), 'utf8');
  assert.match(js, /if \(!gw\) return;/, '沒有閘道（GitHub Pages、?gateway=off）時什麼都不做');
  assert.match(js, /\/handover`/);
  assert.match(js, /view=all&editor=/);
  assert.doesNotMatch(js, /innerHTML/);
});
