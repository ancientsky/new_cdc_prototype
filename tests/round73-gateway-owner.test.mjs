// 第七十三輪：權責單位不能被送審者改走（docs/deploy.md §14.10）。
//   以前寫入閘道只看「送來的 owner」判斷能不能存／送審：慢性組的編輯把急性組已上線的 Q&A 的 owner 改成慢性組送審，
//   慢性組的審核人就能核准上線（跨單位接管）。現在：
//   1. 網站上已有 ⇒ 依網站上（main）的 owner 判斷；有進行中的送審件 ⇒ 依那一件原本的權責單位判斷。改了 owner 也拿不到修改權（403，白話）。
//   2. 原單位的編輯可以把權責單位改給別的單位：送審件記 ownerChange，歷程與稽核記 owner-change，提交訊息記 Owner-Change；
//      要原單位（或車道指定審核單位）的審核人核准，新單位自己核准不算數。
//   3. 跨單位角色（總編輯、治理幕僚、平台管理）可以改權責單位。
//   4. 重新審閱、交接、「不用修改，再送出」也依原本的權責單位。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { adGroupsOf, adGroupName, DEMO_ACCOUNTS } from '../src/client/admin/auth-rules.js';
import { principalFrom, normAccount } from '../scripts/lib/gateway/auth.mjs';
import { createValidator } from '../scripts/lib/gateway/validate-item.mjs';
import { createLocalGit } from '../scripts/lib/gateway/git-local.mjs';
import { createGatewayApi } from '../scripts/lib/gateway/index.mjs';
import { verifyAudit } from '../scripts/lib/gateway/store.mjs';

const tmpDir = (p = 'r73-') => fs.mkdtempSync(path.join(os.tmpdir(), p));
const acct = (sub) => DEMO_ACCOUNTS.find((a) => a.sub === sub);
const P = (sub) =>
  principalFrom({ account: normAccount(sub), name: acct(sub).name, email: `${sub}@cdc-prototype.invalid`, groups: adGroupsOf(acct(sub)) }, 'dev');
/** 示範名冊沒有「兼編輯的治理幕僚／平台管理」：直接用 AD 群組組出來 */
const custom = (account, name, unit, roles) =>
  principalFrom({ account, name, email: `${account}@cdc-prototype.invalid`, groups: roles.map((r) => adGroupName(unit, r)) }, 'dev');
const validator = createValidator();
const CTX = { origin: 'http://localhost:4173', basePath: '' };
const ACUTE = 'unit.acute-infectious';
const CHRONIC = 'unit.chronic-infectious';

function faq(id, over = {}) {
  return {
    id,
    type: 'faq',
    title: '登革熱發燒要多久就醫？',
    question: '登革熱發燒要多久就醫？',
    owner: ACUTE,
    steward: '急性傳染病組承辦人',
    publishedAt: '2026-10-10',
    reviewedAt: '2026-10-10',
    reviewPeriodMonths: 6,
    status: 'published',
    audience: ['public'],
    tasks: ['symptoms'],
    sensitivity: 'public',
    license: 'OGDL-1.0',
    languages: { 'zh-TW': { status: 'source' } },
    summary: '出現發燒請儘速就醫。',
    answerMarkdown: '出現發燒、頭痛、後眼窩痛時，請儘速就醫。',
    ...over,
  };
}

/** 與 round30 的 makeApi 同一套接法；main 上先放一筆急性組已上線的 Q&A */
function makeApi() {
  const d = tmpDir();
  const seed = path.join(d, 'seed');
  fs.mkdirSync(path.join(seed, 'faq'), { recursive: true });
  const id = `faq.r73-${crypto.randomBytes(3).toString('hex')}`;
  fs.writeFileSync(path.join(seed, 'faq', `${id.slice(4)}.json`), JSON.stringify(faq(id), null, 2));
  const api = createGatewayApi({
    stateFile: path.join(d, 'state.json'),
    auditFile: path.join(d, 'audit.jsonl'),
    outboxDir: path.join(d, 'outbox'),
    gitProvider: createLocalGit({ dir: path.join(d, 'repo'), seedDir: seed }),
    validator,
    csrfSecret: 'test-secret',
    rateLimit: null,
  });
  const onMain = async () => JSON.parse(await api.git.readFile('main', `content/faq/${id.slice(4)}.json`));
  return { api, W: api.workflow, id, onMain };
}

test('跨單位接管被擋：別單位的編輯把 owner 改成自己單位送審 ⇒ 403（白話），網站上的內容不變', async () => {
  const { api, W, id, onMain } = makeApi();
  const attacker = P('demo-009'); // 慢性組編輯
  const evil = faq(id, { owner: CHRONIC, steward: '慢性組', status: 'draft', answerMarkdown: '【被竄改】請勿就醫。' });
  const blocked = (e) =>
    e.status === 403 &&
    /權責單位是「急性傳染病組」，不是你的單位/.test(e.message) &&
    /改寫權責單位，不會讓你取得修改權/.test(e.message) &&
    !/owner|branch|git/i.test(e.message);
  await assert.rejects(W.submit(attacker, { item: evil }, CTX), blocked, '送審被擋');
  await assert.rejects(W.saveDraft(attacker, { item: evil }), blocked, '存草稿也被擋');
  // 不改 owner 也一樣（原本就擋）
  await assert.rejects(W.saveDraft(attacker, { item: faq(id, { status: 'draft' }) }), (e) => e.status === 403);
  assert.equal(W.list(attacker, { view: 'all' }).length, 0, '沒有留下送審件');
  const main = await onMain();
  assert.equal(main.owner, ACUTE);
  assert.doesNotMatch(main.answerMarkdown, /竄改/);
  // 重新審閱依網站上的 owner
  await assert.rejects(W.reReview(attacker, { contentId: id, type: 'faq' }, CTX), (e) => e.status === 403);

  // 進行中的送審件（新內容、還沒上線）：別單位帶著改過的 owner 也接不走，而且回 403，不是透露承辦人名字的 409
  const acuteEditor = P('demo-001');
  const fresh = faq(`faq.r73-new-${crypto.randomBytes(3).toString('hex')}`, { status: 'draft' });
  const d = await W.saveDraft(acuteEditor, { item: fresh });
  const grab = { ...fresh, owner: CHRONIC };
  await assert.rejects(W.saveDraft(attacker, { item: grab }), (e) => e.status === 403 && /急性傳染病組/.test(e.message));
  await assert.rejects(W.saveDraft(attacker, { item: grab, submissionId: d.id }), (e) => e.status === 403);
  await assert.rejects(W.submit(attacker, { submissionId: d.id }, CTX), (e) => e.status === 403, '「不用修改，再送出」也擋');

  const entries = api.audit.read();
  assert.ok(
    entries.some((e) => e.action === 'submit' && e.result === 'denied' && e.actor.account === 'demo-009'),
    '拒絕的也記稽核',
  );
  assert.ok(!entries.some((e) => e.action === 'owner-change'), '沒有權責單位變更');
  assert.equal(verifyAudit(entries).ok, true);
});

test('原單位的編輯把權責單位改給別單位：送審件與稽核記 owner-change；新單位自己核准不算數，原單位核准後才上線', async () => {
  const { api, W, id, onMain } = makeApi();
  const acuteEditor = P('demo-001'),
    acuteReviewer = P('demo-002'),
    chronicEditor = P('demo-009'),
    chronicReviewer = P('demo-010');
  const moved = faq(id, { owner: CHRONIC, steward: '慢性傳染病組承辦人', status: 'draft' });
  const s = await W.submit(acuteEditor, { item: moved }, CTX);
  assert.equal(s.status, 'in_review');
  assert.equal(s.owner, CHRONIC);
  assert.deepEqual([s.ownerChange.from, s.ownerChange.to, s.ownerChange.fromName], [ACUTE, CHRONIC, '急性傳染病組']);
  const h = s.history.find((x) => x.action === 'owner-change');
  assert.ok(h, '歷程有 owner-change');
  assert.deepEqual([h.from, h.to, h.account], [ACUTE, CHRONIC, 'demo-001']);
  assert.match(h.label, /權責單位從「急性傳染病組」改為「慢性傳染病組」/);

  // 新單位的審核人不能自己核准接手；看得到但「審核」被擋，原因是白話
  const dv = W.detail(chronicReviewer, s.id);
  assert.equal(dv.can.approve, false);
  assert.match(dv.why.review, /需要原單位「急性傳染病組」或指定的審核單位核准/);
  await assert.rejects(W.approve(chronicReviewer, { submissionId: s.id }, CTX), (e) => e.status === 403 && /原單位「急性傳染病組」/.test(e.message));
  // 新單位的編輯也不能在核准前改它（原單位還沒簽核）
  assert.equal(dv.can.edit, false);

  // 原單位的審核人在審核清單上看得到，可以核准
  assert.ok(W.list(acuteReviewer, { view: 'queue' }).some((x) => x.id === s.id));
  const a = await W.approve(acuteReviewer, { submissionId: s.id }, CTX);
  assert.equal(a.status, 'published');
  assert.equal((await onMain()).owner, CHRONIC);
  const [last] = await api.git.log('main', 5);
  assert.match(last.message, /Owner-Change: unit\.acute-infectious -> unit\.chronic-infectious/);

  const entries = api.audit.read();
  const oc = entries.find((e) => e.action === 'owner-change' && e.result === 'ok');
  assert.ok(oc, '稽核有 owner-change');
  assert.deepEqual([oc.from, oc.to, oc.submission, oc.actor.account], [ACUTE, CHRONIC, s.id, 'demo-001']);
  assert.equal(verifyAudit(entries).ok, true);

  // 上線之後：權責單位是慢性組 ⇒ 慢性組可以改、急性組不行
  const d2 = await W.saveDraft(chronicEditor, { item: faq(id, { owner: CHRONIC, status: 'draft', summary: '慢性組接手後的摘要。' }) });
  assert.equal(d2.ownerChange, null);
  await assert.rejects(
    W.saveDraft(acuteEditor, { item: faq(id, { owner: ACUTE, status: 'draft' }), submissionId: d2.id }),
    (e) => e.status === 403 && /慢性傳染病組/.test(e.message),
  );
});

test('改回原單位就不算權責單位變更；交接依原單位；跨單位角色（總編輯、治理幕僚、平台管理）可以改權責單位', async () => {
  const { api, W, id } = makeApi();
  const acuteEditor = P('demo-001'),
    chronicEditor = P('demo-009');
  const d = await W.saveDraft(acuteEditor, { item: faq(id, { owner: CHRONIC, status: 'draft' }) });
  assert.equal(d.ownerChange.to, CHRONIC);
  await assert.rejects(
    W.handover(chronicEditor, { submissionId: d.id }),
    (e) => e.status === 403 && /急性傳染病組/.test(e.message),
    '新單位不能接手還沒簽核的送審件',
  );
  const back = await W.saveDraft(acuteEditor, { item: faq(id, { owner: ACUTE, status: 'draft' }), submissionId: d.id });
  assert.equal(back.ownerChange, null);
  assert.ok(back.history.some((x) => x.action === 'owner-change' && /改回/.test(x.label)));
  assert.ok(api.audit.read().some((e) => e.action === 'owner-change' && e.revert === true));

  for (const [label, who] of [
    ['總編輯', P('demo-004')],
    ['治理幕僚', custom('r73-gov', '治○幕', 'unit.oasis', ['editor', 'governance'])],
    ['平台管理', custom('r73-it', '平○管', 'unit.it', ['editor', 'platform'])],
  ]) {
    const { W: W2, id: id2, onMain } = makeApi();
    const s = await W2.submit(who, { item: faq(id2, { owner: CHRONIC, status: 'draft' }) }, CTX);
    assert.equal(s.status, 'in_review', label);
    assert.deepEqual([s.ownerChange.from, s.ownerChange.to], [ACUTE, CHRONIC], label);
    // 車道指定審核單位（公關室）可以核准
    const reviewer = who.account === 'demo-004' ? P('demo-002') : P('demo-004');
    const a = await W2.approve(reviewer, { submissionId: s.id }, CTX);
    assert.equal(a.status, 'published', label);
    assert.equal((await onMain()).owner, CHRONIC, label);
  }
});
