// 第五十二輪：同時修改不能悄悄蓋掉別人的修改（docs/deploy.md §23、guide-staff §54）。
//
// 以前的漏洞：同事 A 在 T0 開啟 /admin/publish/?edit=X；同事 B 對 X 的修改在 T1 核准上線；A 在 T2 存檔 ⇒ A 送的是依 T0 版本做的整份檔案，
// 閘道從 main 開新分支寫入，核准後就把 B 的修改悄悄改回去（分支是在 B 上線之後才開的，所以不會有任何衝突）。
// 同一個草稿兩個人改（都存到同一個分支）也一樣：後存的蓋掉先存的。
//
// 現在：存檔帶「開啟時的版本碼」（baseHash），閘道比對現在的版本，不同就 409 stale、不寫入；
// 送審件開始後網站版本變了 ⇒ 不能核准（409 outdated），承辦人重新開啟時三方合併、從 main 另開新分支。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { govern, distBasePath, distEnv } from './helpers.mjs';
import { adGroupsOf, makeSession, DEMO_ACCOUNTS } from '../src/client/admin/auth-rules.js';
import { principalFrom, normAccount } from '../scripts/lib/gateway/auth.mjs';
import { createValidator } from '../scripts/lib/gateway/validate-item.mjs';
import { createLocalGit, SERVICE_IDENTITY } from '../scripts/lib/gateway/git-local.mjs';
import { createGatewayApi } from '../scripts/lib/gateway/index.mjs';
import { mergeFields } from '../scripts/lib/gateway/workflow.mjs';
import { verifyAudit } from '../scripts/lib/gateway/store.mjs';
import { contentVersion, versionOfText, NEW_VERSION } from '../src/client/admin/content-version.js';
import { apiItem } from '../scripts/lib/emit-api.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NOW = Date.parse('2026-10-14T02:00:00Z');
const tmpDir = (p = 'r52-') => fs.mkdtempSync(path.join(os.tmpdir(), p));
const acct = (sub) => DEMO_ACCOUNTS.find((a) => a.sub === sub);
const P = (sub) =>
  principalFrom({ account: normAccount(sub), name: acct(sub).name, email: `${sub}@cdc-prototype.invalid`, groups: adGroupsOf(acct(sub)) }, 'dev');
const gitOut = (dir, args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
const GIT_WORDS = /分支|branch|commit|提交|合併請求|merge|pull request|\bPR\b|\bMR\b|GitLab|GitHub|\bgit\b/i;
const validator = createValidator();

const REL = 'faq/dengue-fever-when-to-see-doctor.json',
  ID = 'faq.dengue-fever-when-to-see-doctor';
let SITE = null;
/** 頁面拿到的那一筆：v1 API 的形狀（含網址、sourceHash 等計算欄位） */
const apiOf = (rel) => {
  SITE ??= govern('2026-10-14');
  return apiItem(SITE.all.find((i) => i.__file === `content/${rel}`));
};
const live = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'content', REL), 'utf8'));
function makeApi() {
  const d = tmpDir();
  const seedDir = path.join(d, 'seed');
  fs.mkdirSync(path.join(seedDir, 'faq'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'content', REL), path.join(seedDir, REL));
  const git = createLocalGit({ dir: path.join(d, 'repo'), seedDir });
  const api = createGatewayApi({
    stateFile: path.join(d, 'state.json'),
    auditFile: path.join(d, 'audit.jsonl'),
    outboxDir: path.join(d, 'outbox'),
    gitProvider: git,
    validator,
    csrfSecret: 't',
    now: () => NOW,
  });
  return { api, W: api.workflow, git, repo: path.join(d, 'repo') };
}
const onMain = (repo) => JSON.parse(gitOut(repo, ['show', `main:content/${REL}`]));
const branches = (repo) => gitOut(repo, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/cms/']).trim().split('\n').filter(Boolean);
/** 資訊室（或譯者）不經後台、直接在 main 上改檔 */
async function directEdit(git, fn) {
  const cur = JSON.parse(await git.readFile('main', `content/${REL}`));
  await git.commit({
    branch: 'main',
    files: [{ path: `content/${REL}`, content: `${JSON.stringify(fn(cur), null, 2)}\n` }],
    message: '譯者更新英文譯文\n',
    author: SERVICE_IDENTITY,
  });
}
const A = P('demo-001'),
  B = P('demo-002'),
  CHIEF = P('demo-004');

// ───────────────────────── 版本碼 ─────────────────────────
test('版本碼：鍵的順序、API 形狀、狀態與最後審閱日都不影響；其他任何欄位（含表單沒有的）一改就不同', () => {
  const x = live();
  const v = contentVersion(x);
  assert.match(v, /^v1-[0-9a-f]{28}$/);
  const reordered = Object.fromEntries(Object.entries(x).reverse());
  reordered.languages = Object.fromEntries(Object.entries(x.languages).reverse());
  assert.equal(contentVersion(reordered), v, '鍵的順序不同不算改');
  assert.equal(contentVersion({ ...x, status: 'draft', reviewedAt: '2026-10-14' }), v, '存檔本來就會改的兩欄不算');
  assert.equal(versionOfText(fs.readFileSync(path.join(ROOT, 'content', REL), 'utf8')), v, '檔案文字與物件算出同一個碼');
  assert.equal(versionOfText(`${JSON.stringify(reordered)}`), v);
  // 頁面拿到的是 API 的一筆（多了網址、sourceHash 等計算欄位）：要與檔案同碼，否則每次存檔都會誤判
  SITE ??= govern('2026-10-14');
  for (const it of SITE.all.filter((i) => i.__file && i.status === 'published').slice(0, 200)) {
    const file = fs.readFileSync(path.join(ROOT, it.__file), 'utf8');
    assert.equal(contentVersion(apiItem(it)), versionOfText(file), it.id);
  }
  for (const [k, val] of [
    ['title', '改'],
    ['i18n', {}],
    ['aiWhitelist', null],
    ['legacyUrls', []],
    ['keywords', ['x']],
  ])
    assert.notEqual(contentVersion({ ...x, [k]: val }), v, k);
  assert.notEqual(contentVersion({ ...x, languages: { ...x.languages, en: { ...x.languages.en, reviewer: '別人' } } }), v, '巢狀的子欄位也算');
  assert.equal(contentVersion(null), NEW_VERSION);
  assert.equal(versionOfText(null), NEW_VERSION);
  assert.match(versionOfText('{壞掉'), /^v1-raw-/);
});

test('三方合併（欄位層級）：只有一方改的用那一方；兩方改得不一樣算衝突，先用網站上的，送審件的值交給同事', () => {
  const start = { id: 'x', title: 'A', summary: 's', keywords: ['k'], status: 'published', reviewedAt: '2026-01-01' };
  const mine = { id: 'x', title: 'A2', summary: 's', keywords: ['k'], extra: 1, status: 'draft', reviewedAt: '2026-10-14' };
  const theirs = { id: 'x', title: 'A', summary: 's2', keywords: ['k', 'j'], status: 'published', reviewedAt: '2026-09-01' };
  const m = mergeFields(start, mine, theirs);
  assert.deepEqual(m.item, { id: 'x', title: 'A2', summary: 's2', keywords: ['k', 'j'], status: 'draft', reviewedAt: '2026-10-14', extra: 1 });
  assert.deepEqual(m.conflicts, []);
  assert.deepEqual(m.changed.sort(), ['keywords', 'summary']);
  const c = mergeFields(start, { ...mine, summary: '我的' }, theirs);
  assert.equal(c.item.summary, 's2', '衝突時先用網站上的（不悄悄蓋掉已上線的更新）');
  assert.deepEqual(c.conflicts, [{ field: 'summary', label: '摘要', yours: '我的' }]);
  assert.equal(mergeFields(start, { ...mine, summary: 's2' }, theirs).conflicts.length, 0, '兩邊改成一樣不算衝突');
  const del = mergeFields(start, mine, { ...theirs, title: undefined });
  assert.deepEqual(
    del.conflicts.map((c) => c.field),
    ['title'],
    '一邊刪、一邊改也算衝突（先照網站上的：刪掉）',
  );
  assert.equal('title' in del.item, false);
});

// ───────────────────────── 存檔時的版本檢查 ─────────────────────────
test('A 開啟後 B 的修改先上線：A 依舊版存檔 ⇒ 409 stale（誰、何時、改了什麼），不寫入；帶新版的碼就存得進去', async () => {
  const { W, repo } = makeApi();
  const x = live();
  const v0 = contentVersion(apiOf(REL));
  assert.equal(v0, contentVersion(x));
  // B 改標題 → 送審 → 科長（總編輯）核准上線
  const sb = await W.submit(B, { item: { ...x, title: `${x.title}（B 改）`, question: `${x.question}（B 改）` }, baseHash: v0 }, {});
  assert.equal(sb.status, 'in_review');
  assert.match(sb.contentHash, /^v1-/);
  await W.approve(CHIEF, { submissionId: sb.id }, {});
  assert.match(onMain(repo).title, /B 改/);
  const v1 = contentVersion(onMain(repo));
  assert.notEqual(v1, v0);

  // A 依 T0 的版本改摘要
  const mine = { ...x, summary: 'A 寫的新摘要。' };
  await assert.rejects(W.saveDraft(A, { item: mine, baseHash: v0 }), (e) => {
    assert.equal(e.status, 409);
    assert.equal(e.code, 'stale');
    assert.equal(e.extra.stale.kind, 'site');
    assert.equal(e.extra.stale.contentHash, v1);
    assert.match(e.message, /網站上的版本已經更新/);
    assert.match(e.message, /林○慧修改、張○玲核准/, '說得出誰改、誰核准');
    assert.match(e.message, /標題/);
    assert.match(e.message, /問題/);
    assert.match(e.message, /載入最新版/);
    assert.doesNotMatch(e.message, GIT_WORDS, '同事看不到 Git 用語');
    return true;
  });
  await assert.rejects(W.submit(A, { item: mine, baseHash: v0 }, {}), (e) => e.code === 'stale');
  assert.deepEqual(branches(repo), [], '版本不符時什麼都不寫');
  assert.match(onMain(repo).title, /B 改/);

  // A 載入最新版、重新套用自己的修改後再存：成功，B 的修改還在
  const cur = await W.current(A, { contentId: ID, type: 'faq', base: v0 });
  assert.equal(cur.contentHash, v1);
  assert.equal(cur.stale.kind, 'site');
  assert.match(cur.stale.text, /網站更新要幾分鐘/);
  assert.equal(cur.item.title, onMain(repo).title);
  assert.match(cur.item.sourceHash, /^[0-9a-f]{12}$/, '與網站 API 一樣附上正本雜湊（修改頁標「譯文待複核」要用）');
  const sa = await W.saveDraft(A, { item: { ...cur.item, summary: 'A 寫的新摘要。' }, baseHash: cur.contentHash });
  assert.equal(sa.status, 'draft');
  const onBranch = JSON.parse(gitOut(repo, ['show', `${branches(repo)[0]}:content/${REL}`]));
  assert.match(onBranch.title, /B 改/, 'B 的修改沒有被蓋掉');
  assert.equal(onBranch.summary, 'A 寫的新摘要。');
  assert.equal(onBranch.sourceHash, undefined, '附上的正本雜湊不會寫進檔案');
  assert.equal(sa.contentHash, contentVersion(onBranch), '回應的版本碼＝存好的那一版');
});

test('同一版本照常存；鍵順序不同也照常存；新內容帶 new，但網站上已有同 ID ⇒ 409 exists', async () => {
  const { W, repo } = makeApi();
  const x = live();
  const reordered = Object.fromEntries(Object.entries(x).reverse());
  const s = await W.saveDraft(A, { item: { ...x, summary: '改一下。' }, baseHash: contentVersion(reordered) });
  assert.equal(s.status, 'draft');
  assert.equal(branches(repo).length, 1);
  // 再存一次（同一件、同一頁）：帶上次回來的碼
  const s2 = await W.saveDraft(A, { item: { ...x, summary: '再改一下。' }, submissionId: s.id, baseHash: s.contentHash });
  assert.notEqual(s2.contentHash, s.contentHash);
  // 新內容：帶 new；另一位同事同時也以「新內容」存同一個 ID ⇒ 不會接著寫進前一位的草稿
  const nid = 'faq.r52-brand-new';
  const n1 = await W.saveDraft(A, { item: { ...x, id: nid, legacyUrls: undefined, i18n: undefined }, baseHash: NEW_VERSION });
  assert.equal(n1.isNew, true);
  await assert.rejects(
    W.saveDraft(B, { item: { ...x, id: nid, title: 'B 的新內容', legacyUrls: undefined, i18n: undefined }, baseHash: NEW_VERSION }),
    (e) => e.extra?.stale?.kind === 'open' && e.extra.stale.submissionId === n1.id,
  );
});

test('網站上已有同 ID 的內容：以「新內容」存 ⇒ 409 exists，提示從「修改這頁」進來或換 ID', async () => {
  const { W } = makeApi();
  await assert.rejects(W.saveDraft(A, { item: live(), baseHash: NEW_VERSION }), (e) => {
    assert.equal(e.code, 'exists');
    assert.match(e.message, /網站上已經有這個內容 ID/);
    assert.match(e.message, /修改這頁/);
    return true;
  });
});

test('兩位同事改同一個草稿：後存的人依舊版存 ⇒ 409（說出前一位是誰、改了什麼）；載入最新版後存得進去，承辦列出兩位', async () => {
  const { W, repo } = makeApi();
  const x = live();
  const v0 = contentVersion(x);
  const s1 = await W.saveDraft(A, { item: { ...x, summary: 'A 的摘要。' }, baseHash: v0 });
  // B 從送審件開啟（?gw=）：拿到 A 存的那一版與它的碼
  const opened = await W.contentFor(B, s1.id);
  assert.equal(opened.contentHash, s1.contentHash);
  assert.equal(opened.item.summary, 'A 的摘要。');
  // A 還開著頁面，又改了關鍵字並存檔（碼是自己上次存的）
  const s2 = await W.saveDraft(A, {
    item: { ...x, summary: 'A 的摘要。', keywords: [...x.keywords, 'A 加的詞'] },
    submissionId: s1.id,
    baseHash: s1.contentHash,
  });
  // B 依自己開啟時的版本存 ⇒ 擋下，不蓋掉 A 剛加的關鍵字
  await assert.rejects(W.saveDraft(B, { item: { ...opened.item, title: 'B 的標題' }, submissionId: s1.id, baseHash: opened.contentHash }), (e) => {
    assert.equal(e.code, 'stale');
    assert.equal(e.extra.stale.kind, 'draft');
    assert.equal(e.extra.stale.submissionId, s1.id);
    assert.match(e.message, /又有人存過（王○安/);
    assert.match(e.message, /關鍵字/);
    assert.doesNotMatch(e.message, GIT_WORDS);
    return true;
  });
  assert.ok(JSON.parse(gitOut(repo, ['show', `${branches(repo)[0]}:content/${REL}`])).keywords.includes('A 加的詞'));
  const again = await W.contentFor(B, s1.id);
  assert.equal(again.contentHash, s2.contentHash);
  const s3 = await W.saveDraft(B, { item: { ...again.item, title: 'B 的標題' }, submissionId: s1.id, baseHash: again.contentHash });
  const f = JSON.parse(gitOut(repo, ['show', `${branches(repo)[0]}:content/${REL}`]));
  assert.equal(f.title, 'B 的標題');
  assert.ok(f.keywords.includes('A 加的詞'));
  assert.equal(f.summary, 'A 的摘要。');
  assert.deepEqual(
    s3.editors.map((e) => e.name),
    ['王○安', '林○慧'],
    '同一件裡兩位都列為承辦',
  );
  assert.equal(
    W.list(CHIEF, { view: 'all', contentId: ID }).filter((s) => ['draft', 'returned', 'in_review'].includes(s.status)).length,
    1,
    '審核人只會看到一件',
  );
});

test('已有進行中的送審件時，從網站版本（?edit=）開啟的人：存檔 ⇒ 409 open；不帶送審件編號 ⇒ 409 busy；開啟時就看得到那一件', async () => {
  const { W } = makeApi();
  const x = live();
  const v0 = contentVersion(x);
  const s1 = await W.saveDraft(A, { item: { ...x, summary: 'A 的摘要。' }, baseHash: v0 });
  // 開啟時（?edit=）就告訴 B：已有進行中的送審件（誰、狀態、從那一件繼續）
  const cur = await W.current(B, { contentId: ID, type: 'faq', base: v0 });
  assert.equal(cur.open.id, s1.id);
  assert.equal(cur.open.status, 'draft');
  assert.deepEqual(
    cur.open.editors.map((e) => e.name),
    ['王○安'],
  );
  assert.equal(cur.open.contentHash, s1.contentHash);
  assert.equal(cur.stale, undefined, '網站版本本身沒變');
  // 後台頁面找到這一件時會帶 submissionId；B 的內容卻是網站版本 ⇒ 擋下
  await assert.rejects(W.saveDraft(B, { item: { ...x, title: 'B 改' }, submissionId: s1.id, baseHash: v0 }), (e) => {
    assert.equal(e.extra.stale.kind, 'open');
    assert.match(e.message, /已經有一個進行中的送審件（草稿，承辦：王○安）/);
    assert.match(e.message, /摘要/);
    return true;
  });
  // 沒帶送審件編號也一樣：閘道自己找到進行中的那一件（以前會直接接著寫進去，蓋掉王○安的摘要）
  await assert.rejects(
    W.saveDraft(B, { item: { ...x, title: 'B 改' }, baseHash: v0 }),
    (e) => e.extra?.stale?.kind === 'open' && e.extra.stale.submissionId === s1.id,
  );
  await W.submit(A, { submissionId: s1.id }, {});
  await assert.rejects(W.saveDraft(B, { item: { ...x, title: 'B 改' }, baseHash: v0 }), (e) => e.code === 'in_review');
  // 重新審閱也一樣只會有一件
  await assert.rejects(W.reReview(B, { contentId: ID, type: 'faq' }, {}), (e) => e.code === 'busy');
});

test('沒帶版本碼（舊版頁面、其他編輯頁、上架包流程不經閘道）：照舊接受，稽核記 baseHash: missing', async () => {
  const { api, W } = makeApi();
  const s = await W.saveDraft(A, { item: { ...live(), summary: '舊頁面。' } });
  assert.equal(s.status, 'draft');
  const e = api.audit.read().find((x) => x.action === 'save-draft' && x.result === 'ok');
  assert.equal(e.baseHash, 'missing');
  const s2 = await W.saveDraft(A, { item: { ...live(), summary: '新頁面。' }, submissionId: s.id, baseHash: s.contentHash });
  assert.equal(
    api.audit
      .read()
      .filter((x) => x.action === 'save-draft' && x.result === 'ok')
      .pop().baseHash,
    undefined,
  );
  assert.equal(s2.status, 'draft');
  assert.equal(verifyAudit(api.audit.read()).ok, true);
});

// ───────────────────────── 送審期間網站版本變了 ─────────────────────────
test('送審期間網站版本被直接更新（例：譯者）：審核人不能核准（409 outdated，核准不記）；退回後承辦人重新開啟＝合併後的版本，再送審就能上線，兩邊的修改都在', async () => {
  const { W, git, repo } = makeApi();
  const x = live();
  const s1 = await W.submit(A, { item: { ...x, summary: 'A 的摘要。' }, baseHash: contentVersion(x) }, {});
  await directEdit(git, (c) => ({ ...c, languages: { ...c.languages, en: { ...c.languages.en, reviewer: '譯者甲' } } }));
  // 審核人看到的差異：只列這個送審件自己改的（摘要），加上說明
  const d = await W.diff(CHIEF, s1.id);
  assert.deepEqual(
    d.changes.map((c) => c.field).filter((f) => f !== 'reviewedAt'),
    ['summary'],
  );
  assert.match(d.outdated.text, /網站上的版本已經更新/);
  assert.match(d.outdated.text, /退回修改/);
  assert.deepEqual(d.outdated.fields, ['提供語言']);
  await assert.rejects(W.approve(CHIEF, { submissionId: s1.id }, {}), (e) => {
    assert.equal(e.status, 409);
    assert.equal(e.code, 'outdated');
    assert.match(e.message, /還不能核准/);
    assert.match(e.message, /退回修改/);
    assert.doesNotMatch(e.message, GIT_WORDS);
    return true;
  });
  assert.equal(W.detail(CHIEF, s1.id).approvals.length, 0, '被擋下的核准不記');
  assert.equal(onMain(repo).summary, x.summary, '沒有上線');
  await W.returnForChanges(CHIEF, { submissionId: s1.id, comment: '網站版本已更新，請重新開啟後再送審。' }, {});
  // 承辦人重新開啟：內容已併入譯者的更新；版本碼是「合併後」的
  const opened = await W.contentFor(A, s1.id);
  assert.match(opened.contentHash, /^v1-[0-9a-f]+\+v1-[0-9a-f]+$/);
  assert.equal(opened.item.languages.en.reviewer, '譯者甲');
  assert.equal(opened.item.summary, 'A 的摘要。');
  assert.deepEqual(opened.update.fields, ['提供語言']);
  assert.deepEqual(opened.update.conflicts, []);
  // 用舊頁面上的碼（分支版本）送 ⇒ 409 moved
  await assert.rejects(
    W.submit(A, { item: { ...x, summary: 'A 的摘要。' }, submissionId: s1.id, baseHash: s1.contentHash }, {}),
    (e) => e.extra?.stale?.kind === 'moved',
  );
  const s2 = await W.submit(A, { item: opened.item, submissionId: s1.id, baseHash: opened.contentHash }, {});
  assert.equal(s2.status, 'in_review');
  assert.ok(s2.history.some((h) => h.label === '併入網站上的最新版本'));
  assert.equal((await W.diff(CHIEF, s1.id)).outdated, undefined);
  const done = await W.approve(CHIEF, { submissionId: s1.id }, {});
  assert.equal(done.status, 'published');
  const m = onMain(repo);
  assert.equal(m.summary, 'A 的摘要。');
  assert.equal(m.languages.en.reviewer, '譯者甲', '譯者的更新沒有被蓋掉');
});

test('送審期間網站版本變了、而且兩邊改到同一欄：重新開啟時先顯示網站上的，送審件原本的值列出來讓承辦人自己決定；「不用修改，再送出」會被擋下', async () => {
  const { W, git } = makeApi();
  const x = live();
  const s1 = await W.saveDraft(A, { item: { ...x, summary: 'A 的摘要。' }, baseHash: contentVersion(x) });
  await directEdit(git, (c) => ({ ...c, summary: '資訊室改的摘要。' }));
  const opened = await W.contentFor(A, s1.id);
  assert.equal(opened.item.summary, '資訊室改的摘要。');
  assert.deepEqual(opened.update.conflicts, [{ field: 'summary', label: '摘要', yours: 'A 的摘要。' }]);
  await assert.rejects(W.submit(A, { submissionId: s1.id }, {}), (e) => e.extra?.stale?.kind === 'moved' && /系統不能替你決定/.test(e.message));
  // 沒有衝突的「不用修改，再送出」：閘道直接併入
  const { W: W2, git: g2, repo: r2 } = makeApi();
  const t1 = await W2.saveDraft(A, { item: { ...x, summary: 'A 的摘要。' }, baseHash: contentVersion(x) });
  await directEdit(g2, (c) => ({ ...c, keywords: [...c.keywords, '資訊室加的詞'] }));
  const t2 = await W2.submit(A, { submissionId: t1.id }, {});
  assert.equal(t2.status, 'in_review');
  await W2.approve(CHIEF, { submissionId: t1.id }, {});
  const m = onMain(r2);
  assert.equal(m.summary, 'A 的摘要。');
  assert.ok(m.keywords.includes('資訊室加的詞'));
});

test('舊版頁面（沒帶版本碼）在網站版本變了之後送審 ⇒ 409 moved（不會進審核、也不會卡在核准不了）', async () => {
  const { W, git } = makeApi();
  const x = live();
  const s1 = await W.saveDraft(A, { item: { ...x, summary: 'A 的摘要。' } });
  await directEdit(git, (c) => ({ ...c, keywords: [...c.keywords, '新詞'] }));
  await assert.rejects(W.submit(A, { item: { ...x, summary: 'A 的摘要。' }, submissionId: s1.id }, {}), (e) => e.extra?.stale?.kind === 'moved');
  assert.equal(W.detail(A, s1.id).status, 'draft');
});

test('配套內容：當成別件的配套內容時不能另外當主內容改；網站上已有、內容又不同 ⇒ 不蓋掉', async () => {
  const { W } = makeApi();
  const x = live();
  const comp = { ...x, id: 'faq.r52-companion', title: '配套 Q&A', question: '配套 Q&A', legacyUrls: undefined, i18n: undefined };
  const s1 = await W.saveDraft(A, { item: { ...x, summary: 'A 的摘要。' }, baseHash: contentVersion(x), companions: [comp] });
  assert.deepEqual(
    s1.companions.map((c) => c.id),
    ['faq.r52-companion'],
  );
  await assert.rejects(W.saveDraft(B, { item: { ...comp, status: 'draft' }, baseHash: NEW_VERSION }), (e) => e.code === 'busy' && /配套內容/.test(e.message));
  const cur = await W.current(B, { contentId: 'faq.r52-companion', type: 'faq' });
  assert.equal(cur.open.id, s1.id);
  assert.equal(cur.open.companionOf, s1.title);
});

// ───────────────────────── HTTP ─────────────────────────
test('HTTP：409 stale 的回應帶 stale 說明（不含 Git 用語）；版本碼格式不對就當沒帶；GET /current', async () => {
  const { api } = makeApi();
  const sess = { 'x-cdc-dev-session': Buffer.from(JSON.stringify(makeSession(acct('demo-001')))).toString('base64url') };
  const call = async (method, url, body) => {
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
    if (method === 'POST') req.headers['x-csrf-token'] = api.csrfFor(P('demo-001'));
    await api.handle(req, res, u.pathname, u.searchParams);
    return { status: res.statusCode, body: JSON.parse(chunks.join('') || 'null') };
  };
  const x = live();
  const ok = await call('POST', '/api/gateway/drafts', { item: { ...x, summary: 'HTTP。' }, baseHash: contentVersion(x) });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.match(ok.body.contentHash, /^v1-/);
  const stale = await call('POST', '/api/gateway/drafts', { item: { ...x, summary: 'HTTP 2。' }, submissionId: ok.body.id, baseHash: contentVersion(x) });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error, 'stale');
  assert.equal(stale.body.stale.kind, 'open');
  assert.equal(stale.body.stale.submissionId, ok.body.id);
  assert.doesNotMatch(JSON.stringify(stale.body), GIT_WORDS);
  const junk = await call('POST', '/api/gateway/drafts', { item: { ...x, summary: 'HTTP 3。' }, submissionId: ok.body.id, baseHash: '<script>' });
  assert.equal(junk.status, 200, '格式不對的版本碼當沒帶（照舊接受）');
  const cur = await call('GET', `/api/gateway/current?contentId=${ID}&type=faq&base=${contentVersion(x)}`);
  assert.equal(cur.status, 200);
  assert.equal(cur.body.open.id, ok.body.id);
  assert.equal(cur.body.exists, true);
  assert.equal((await call('GET', '/api/gateway/current?contentId=../x&type=faq')).status, 400);
  const content = await call('GET', `/api/gateway/items/${ok.body.id}/content`);
  assert.equal(content.body.contentHash, cur.body.open.contentHash);
  assert.equal(content.body.item.summary, 'HTTP 3。');
});

// ───────────────────────── 端到端（Playwright＋真的閘道）─────────────────────────
const CHROME = process.env.CHROME_BIN || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const DIST = process.env.DIST_DIR ? path.resolve(process.env.DIST_DIR) : path.join(ROOT, 'dist');
const freePort = () =>
  new Promise((res) => {
    const s = net.createServer();
    s.listen(0, () => {
      const p = s.address().port;
      s.close(() => res(p));
    });
  });

test(
  '端到端：A 開啟後 B 的修改先上線 ⇒ A 存檔被擋、載入最新版保留 A 的修改；同一草稿兩人改；已有送審件時一開啟就提醒；送審期間網站版本更新 ⇒ 審核人不能核准、意見預先填好',
  { timeout: 240000 },
  async (t) => {
    const pub = path.join(DIST, 'assets/js/admin/publish-gateway.js');
    if (!fs.existsSync(pub)) return t.skip('dist 尚未建置');
    if (!fs.readFileSync(pub, 'utf8').includes('gw-sync')) return t.skip('dist 是舊版（請重新建置）');
    let chromium;
    try {
      ({ chromium } = await import('playwright'));
    } catch {
      return t.skip('沒有 Playwright');
    }
    if (!fs.existsSync(CHROME)) return t.skip('沒有 Chromium');
    const x = live();
    const d = tmpDir('r52-e2e-');
    const seedDir = path.join(d, 'seed');
    fs.mkdirSync(path.join(seedDir, 'faq'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'content', REL), path.join(seedDir, REL));
    const port = await freePort();
    const repo = path.join(d, 'repo');
    const env = {
      ...distEnv(DIST),
      GATEWAY_REPO_DIR: repo,
      GATEWAY_SEED_DIR: seedDir,
      GATEWAY_STATE_FILE: path.join(d, 'state.json'),
      GATEWAY_AUDIT_FILE: path.join(d, 'audit.jsonl'),
      OUTBOX_DIR: path.join(d, 'outbox'),
      SUBSCRIPTIONS_FILE: path.join(d, 'subs.json'),
    };
    const srv = spawn(process.execPath, [path.join(ROOT, 'scripts/serve.mjs'), String(port)], { cwd: ROOT, stdio: ['ignore', 'ignore', 'pipe'], env });
    let stderr = '';
    srv.stderr.on('data', (c) => {
      stderr += c;
    });
    const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
    const errors = [];
    const base = `http://localhost:${port}${distBasePath(DIST)}`;
    const onBranch = () => {
      const br = branches(repo);
      assert.equal(br.length, 1, `應只有一個送審分支：${br}`);
      return JSON.parse(gitOut(repo, ['show', `${br[0]}:content/${REL}`]));
    };
    async function as(sub) {
      const ctx = await browser.newContext({ viewport: { width: 1360, height: 1000 } });
      await ctx.addInitScript(
        ({ s }) => {
          try {
            if (!localStorage.getItem('cdc.admin.session')) localStorage.setItem('cdc.admin.session', JSON.stringify(s));
          } catch {
            /* sandbox iframe */
          }
        },
        { s: makeSession(acct(sub)) },
      );
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(`${sub}: ${e.message}`));
      page.on('console', (m) => {
        if (m.type() === 'error' && !/Failed to load resource|Blocked script execution in 'about:srcdoc'/.test(m.text())) errors.push(`${sub}: ${m.text()}`);
      });
      return page;
    }
    const gwCall = (page, method, p, body) =>
      page.evaluate(
        async ([m, pp, b]) => {
          const mod = await import(new URL('../../assets/js/admin/gateway-client.js', location.href).href);
          const gw = await mod.detectGateway();
          return m === 'GET' ? gw.get(pp) : gw.post(pp, b);
        },
        [method, p, body],
      );
    const ready = async (page) => {
      await page.waitForFunction(() => window.__admPublish?.editing?.base, null, { timeout: 20000 });
      await page.waitForFunction(() => document.body.classList.contains('adm-gw') && document.querySelector('#gw-state')?.textContent, null, {
        timeout: 15000,
      });
      await page.waitForTimeout(300); // checkCurrent（開啟時的版本檢查）跑完
    };
    const syncText = (page) => page.evaluate(() => document.querySelector('#gw-sync')?.textContent ?? '');
    try {
      for (let i = 0; i < 80; i++) {
        try {
          if ((await fetch(`${base}/api/gateway/health`)).ok) break;
        } catch {
          /* 等伺服器 */
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      // ① A（王○安）先開啟修改頁
      const pa = await as('demo-001');
      await pa.goto(`${base}/admin/publish/?edit=${ID}`);
      await ready(pa);
      assert.equal(await syncText(pa), '', '剛開啟、沒有別人在改：沒有提醒');
      const v0 = await pa.evaluate(() => window.__admPublish.getBaseHash());
      assert.equal(v0, contentVersion(x), '頁面算的版本碼＝檔案的版本碼（API 形狀與鍵順序不影響）');

      // ② B（林○慧）改標題、送審；總編輯核准上線
      const pb = await as('demo-002');
      await pb.goto(`${base}/admin/publish/?edit=${ID}`);
      await ready(pb);
      await pb.fill('#f-title', `${x.title}（B 改）`);
      await pb.waitForFunction(() => /標題/.test(document.querySelector('#edit-diff')?.textContent ?? ''), null, { timeout: 15000 });
      await pb.click('#gw-submit');
      await pb.waitForFunction(() => /已送審/.test(document.querySelector('#gw-status')?.textContent ?? ''), null, { timeout: 15000 });
      const sidB = await pb.evaluate(() => JSON.parse(localStorage.getItem('cdc.admin.gwCurrent') ?? 'null')?.sid);
      const pc = await as('demo-004');
      await pc.goto(`${base}/admin/review/?item=${sidB}`);
      await pc.waitForFunction(() => !document.querySelector('#gw-approve')?.disabled, null, { timeout: 15000 });
      await pc.click('#gw-approve');
      await pc.waitForFunction(() => /已上線/.test(document.querySelector('#gw-act-msg')?.textContent ?? ''), null, { timeout: 15000 });
      assert.match(onMain(repo).title, /B 改/);

      // ②' 網站（API）還沒跟上：這時才開修改頁的人，一開啟就看到「網站上有更新的版本」，按一下載入最新版
      const pd = await as('demo-001');
      await pd.goto(`${base}/admin/publish/?edit=${ID}`);
      await ready(pd);
      await pd.waitForFunction(() => /網站上有更新的版本/.test(document.querySelector('#gw-sync')?.textContent ?? ''), null, { timeout: 15000 });
      assert.match(await syncText(pd), /林○慧修改、張○玲核准/);
      assert.equal(await pd.inputValue('#f-title'), x.title, '頁面上還是網站（API）的舊版');
      await pd.click('#gw-sync button');
      await pd.waitForFunction(() => /已載入最新版/.test(document.querySelector('#gw-sync')?.textContent ?? ''), null, { timeout: 20000 });
      assert.equal(await pd.inputValue('#f-title'), `${x.title}（B 改）`);
      assert.equal(await pd.evaluate(() => window.__admPublish.getBaseHash()), contentVersion(onMain(repo)));
      await pd.context().close();

      // ③ A 還在舊版上：改審閱週期後存草稿 ⇒ 被擋，什麼都沒寫；說明是誰、改了什麼
      await pa.fill('#f-period', '12');
      await pa.waitForFunction(() => /審閱週期/.test(document.querySelector('#edit-diff')?.textContent ?? ''), null, { timeout: 15000 });
      await pa.click('#gw-save');
      await pa.waitForFunction(() => /已經更新/.test(document.querySelector('#gw-sync')?.textContent ?? ''), null, { timeout: 15000 });
      const blockedText = await syncText(pa);
      assert.match(blockedText, /林○慧修改、張○玲核准/);
      assert.match(blockedText, /標題/);
      assert.doesNotMatch(blockedText, GIT_WORDS);
      assert.deepEqual(branches(repo), [], 'A 的舊版沒有寫進系統');
      // 載入最新版（保留我的修改）：標題是 B 的、審閱週期是 A 的；畫面上的差異只列 A 改的
      await pa.click('#gw-sync button.adm-btn--sm:not(.adm-btn--ghost)');
      await pa.waitForFunction(() => /已載入最新版/.test(document.querySelector('#gw-sync')?.textContent ?? ''), null, { timeout: 20000 });
      assert.match(await syncText(pa), /你的修改已重新套用：審閱週期/);
      assert.match(await syncText(pa), /別人改了：.*標題/);
      assert.equal(await pa.inputValue('#f-title'), `${x.title}（B 改）`);
      assert.equal(await pa.inputValue('#f-period'), '12');
      assert.deepEqual((await pa.getAttribute('#edit-diff', 'data-changed')).split(' '), ['reviewPeriodMonths']);
      await pa.click('#gw-save');
      await pa.waitForFunction(() => /已儲存草稿/.test(document.querySelector('#gw-status')?.textContent ?? ''), null, { timeout: 15000 });
      let f = onBranch();
      assert.match(f.title, /B 改/, 'B 的修改沒有被蓋掉');
      assert.equal(f.reviewPeriodMonths, 12);
      assert.equal(f.languages.en.status, 'reviewed');
      const sidA = await pa.evaluate(() => JSON.parse(localStorage.getItem('cdc.admin.gwCurrent') ?? 'null')?.sid);

      // ④ 已有進行中的送審件時，另一位從網站版本開啟 ⇒ 一開啟就提醒，存檔鈕停用，可以「從那一件繼續」
      const pb2 = await as('demo-002');
      await pb2.goto(`${base}/admin/publish/?edit=${ID}`);
      await ready(pb2);
      await pb2.waitForFunction(() => /已有進行中的送審件/.test(document.querySelector('#gw-sync')?.textContent ?? ''), null, { timeout: 15000 });
      assert.match(await syncText(pb2), /承辦：王○安/);
      assert.equal(await pb2.isDisabled('#gw-save'), true);
      assert.equal(await pb2.getAttribute('#gw-sync a', 'href'), `${distBasePath(DIST)}/admin/publish/?gw=${sidA}`);

      // ⑤ 同一草稿兩人改：B 從那一件開啟；A 又存了一版；B 依舊版存 ⇒ 擋下；載入最新版後存得進去，兩人都列為承辦
      await pb2.click('#gw-sync a');
      await pb2.waitForFunction(
        (s) => window.__admPublish?.editing?.base && window.__admPublish.editing.source === 'gateway' && location.search.includes(s),
        sidA,
        { timeout: 20000 },
      );
      await pb2.waitForTimeout(300);
      await pa.fill('#f-period', '3');
      await pa.click('#gw-save');
      await pa.waitForFunction(
        () => /已儲存草稿/.test(document.querySelector('#gw-status')?.textContent ?? '') && !document.querySelector('#gw-save').disabled,
        null,
        { timeout: 15000 },
      );
      assert.equal(onBranch().reviewPeriodMonths, 3);
      await pb2.fill('#f-title', `${x.title}（B 第二次改）`);
      await pb2.waitForFunction(() => /標題/.test(document.querySelector('#edit-diff')?.textContent ?? ''), null, { timeout: 15000 }); // 差異列更新完才按（版面會移動）
      await pb2.click('#gw-save');
      await pb2.waitForFunction(() => /又有人存過/.test(document.querySelector('#gw-sync')?.textContent ?? ''), null, { timeout: 15000 });
      assert.match(await syncText(pb2), /王○安/);
      assert.match(await syncText(pb2), /審閱週期/);
      assert.equal(onBranch().reviewPeriodMonths, 3, '沒有被 B 的舊版蓋掉');
      await pb2.click('#gw-sync button.adm-btn--sm:not(.adm-btn--ghost)');
      await pb2.waitForFunction(() => /已載入最新版/.test(document.querySelector('#gw-sync')?.textContent ?? ''), null, { timeout: 20000 });
      assert.equal(await pb2.inputValue('#f-title'), `${x.title}（B 第二次改）`);
      assert.equal(await pb2.inputValue('#f-period'), '3');
      await pb2.click('#gw-save');
      await pb2.waitForFunction(() => /已儲存草稿/.test(document.querySelector('#gw-status')?.textContent ?? ''), null, { timeout: 15000 });
      f = onBranch();
      assert.match(f.title, /B 第二次改/);
      assert.equal(f.reviewPeriodMonths, 3);
      const detail = (await gwCall(pc, 'GET', `/items/${sidA}`)).data;
      assert.deepEqual(
        detail.editors.map((e) => e.name),
        ['王○安', '林○慧'],
      );

      // ⑥ 送審後，譯者直接更新了網站上的同一頁 ⇒ 審核人看到說明、「核准上線」停用、退回意見已預先填好
      const sub = (await gwCall(pb2, 'POST', '/submit', { submissionId: sidA })).data;
      assert.equal(sub.status, 'in_review');
      await directEdit(createLocalGit({ dir: repo }), (c) => ({ ...c, languages: { ...c.languages, en: { ...c.languages.en, reviewer: '譯者甲' } } }));
      await pc.goto(`${base}/admin/review/?item=${sidA}`);
      await pc.waitForFunction(() => /還不能核准/.test(document.querySelector('#gw-diff')?.textContent ?? ''), null, { timeout: 15000 });
      assert.equal(await pc.isDisabled('#gw-approve'), true);
      assert.match(await pc.inputValue('#gw-comment'), /網站上的版本在送審期間已更新/);
      assert.doesNotMatch(await pc.textContent('#gw-diff'), GIT_WORDS);
      await pc.click('#gw-return');
      await pc.waitForFunction(() => /已退回/.test(document.querySelector('#gw-act-msg')?.textContent ?? ''), null, { timeout: 15000 });
      // A 重新開啟：說明網站已更新、已併入；送審後就能核准，譯者的更新也在
      await pa.goto(`${base}/admin/publish/?gw=${sidA}`);
      await pa.waitForFunction(() => /已併進這個送審件/.test(document.querySelector('#gw-sync')?.textContent ?? ''), null, { timeout: 20000 });
      await pa.waitForFunction(() => !document.querySelector('#gw-submit')?.disabled, null, { timeout: 15000 });
      await pa.click('#gw-submit');
      await pa.waitForFunction(() => /已送審/.test(document.querySelector('#gw-status')?.textContent ?? ''), null, { timeout: 15000 });
      const done = (await gwCall(pc, 'POST', `/items/${sidA}/approve`, {})).data;
      assert.equal(done.status, 'published');
      const m = onMain(repo);
      assert.match(m.title, /B 第二次改/);
      assert.equal(m.reviewPeriodMonths, 3);
      assert.equal(m.languages.en.reviewer, '譯者甲');
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      srv.kill();
      if (stderr.trim() && process.env.DEBUG_E2E) console.error(stderr);
    }
  },
);
