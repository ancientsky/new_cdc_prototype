// 第五十二輪（合併後）：疫情報導編輯頁接上同時修改的版本檢查（docs/deploy.md §23.5、§23.6），分類主檔可以經閘道送審（§24.7）。
//
// 兩件以前沒做到的事：
//   1. /admin/bulletin/edit/ 存檔不帶版本碼、也沒有「載入最新版」：從網站版本開啟、而這篇已有進行中的送審件時，畫面只提醒，存檔照樣接著寫進那一件。
//   2. 在頁面上新增分類後，上架包會多一個 content/master/bulletin-categories.json，送審卻沒帶——閘道收到的文章用了一個網站上沒有的分類。
// 現在：疫情報導編輯頁與 /admin/publish/ 用同一套版本檢查（getBaseHash、reloadLatest）；分類主檔跟文章一起送，
// 閘道以分類代號為單位合併到網站上的主檔（路徑寫死，不收前端送的路徑），送審期間主檔變了不能核准，重新開啟時併入。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { govern, distBasePath, distEnv } from './helpers.mjs';
import { makeCtx } from '../scripts/lib/pages.mjs';
import { adGroupsOf, makeSession, DEMO_ACCOUNTS } from '../src/client/admin/auth-rules.js';
import { principalFrom, normAccount } from '../scripts/lib/gateway/auth.mjs';
import { createValidator, CATEGORIES_PATH } from '../scripts/lib/gateway/validate-item.mjs';
import { createLocalGit, SERVICE_IDENTITY } from '../scripts/lib/gateway/git-local.mjs';
import { createGatewayApi } from '../scripts/lib/gateway/index.mjs';
import { contentVersion, versionOfText } from '../src/client/admin/content-version.js';
import * as B from '../src/client/admin/bulletin-edit-core.js';
import * as bulletinTpl from '../src/templates/admin/bulletin-edit.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TODAY = '2026-10-14';
const NOW = Date.parse('2026-10-14T02:00:00Z');
const tmpDir = (p = 'r52b-') => fs.mkdtempSync(path.join(os.tmpdir(), p));
const acct = (sub) => DEMO_ACCOUNTS.find((a) => a.sub === sub);
const P = (sub) =>
  principalFrom({ account: normAccount(sub), name: acct(sub).name, email: `${sub}@cdc-prototype.invalid`, groups: adGroupsOf(acct(sub)) }, 'dev');
const gitOut = (dir, args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
const GIT_WORDS = /分支|branch|commit|提交|合併請求|merge|pull request|\bPR\b|\bMR\b|GitLab|GitHub|\bgit\b/i;
const validator = createValidator();
const site = govern(TODAY);
const readRel = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const CATS = JSON.parse(readRel(CATEGORIES_PATH));
const ART = 'article.teb-42-19-1',
  ART_REL = 'content/articles/teb-42-19-1.json';
const ART2_REL = 'content/articles/teb-42-13-2.json';
const fileItem = (rel) => JSON.parse(readRel(rel));
// 疫情報導分類：跨單位的總編輯（張○玲）改文章，治理幕僚（李○翰）審核；文章的權責單位是各區管制中心
const EDITOR = P('demo-004'),
  REVIEWER = P('demo-005'),
  OTHER_EDITOR = P('demo-003');

/** 頁面拿到的資料島 */
function island() {
  const h = String(bulletinTpl.render(makeCtx(site, 'zh-TW', { path: '/admin/bulletin/edit/', alternates: ['zh-TW'], view: 'admin' })));
  const m = h.match(/<script type="application\/json" id="adm-bulletin-data">([\s\S]*?)<\/script>/);
  assert.ok(m, '沒有資料島');
  return JSON.parse(m[1]);
}
const D = island();

/** 閘道的測試版本庫的種子：文章、疫情報導卷期、分類主檔 */
function makeSeed() {
  const seedDir = path.join(tmpDir('r52b-seed-'), 'seed');
  for (const sub of ['articles', 'publications', 'master']) fs.mkdirSync(path.join(seedDir, sub), { recursive: true });
  for (const f of fs.readdirSync(path.join(ROOT, 'content/articles')))
    fs.copyFileSync(path.join(ROOT, 'content/articles', f), path.join(seedDir, 'articles', f));
  for (const f of fs.readdirSync(path.join(ROOT, 'content/publications')).filter((x) => x.startsWith('bulletin-')))
    fs.copyFileSync(path.join(ROOT, 'content/publications', f), path.join(seedDir, 'publications', f));
  fs.copyFileSync(path.join(ROOT, CATEGORIES_PATH), path.join(seedDir, 'master', 'bulletin-categories.json'));
  return seedDir;
}
function makeApi() {
  const d = tmpDir();
  const seedDir = makeSeed();
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
  return { api, W: api.workflow, git, repo: path.join(d, 'repo'), seedDir };
}
const show = (repo, ref, rel) => gitOut(repo, ['show', `${ref}:${rel}`]);
const branches = (repo) => gitOut(repo, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/cms/']).trim().split('\n').filter(Boolean);
/** 資訊室（或另一個管道）直接在 main 上改檔 */
async function directEdit(git, rel, text, message = '資訊室直接更新\n') {
  await git.commit({ branch: 'main', files: [{ path: rel, content: text }], message, author: SERVICE_IDENTITY });
}
const NEW_CAT = { key: 'special-report', label: '疫調專題', labelEn: 'Special Report', order: 9 };
const OTHER_CAT = { key: 'one-health', label: '同一健康', labelEn: 'One Health', order: 10 };

// ───────────────────────── 分類主檔的合併（純函式）─────────────────────────
test('分類主檔三方合併：以代號為單位；兩人各加一個分類兩個都在；同一個分類兩邊改得不一樣算衝突、先用網站上的', () => {
  const start = CATS;
  const mine = [...CATS, NEW_CAT];
  const theirs = [...CATS, OTHER_CAT];
  const m = B.mergeCategories(start, mine, theirs);
  assert.deepEqual(m.conflicts, []);
  assert.deepEqual(
    m.rows.map((c) => c.key),
    [...CATS.map((c) => c.key), 'one-health', 'special-report'],
  );
  assert.deepEqual(m.mine, ['special-report']);
  assert.deepEqual(m.theirs, ['one-health']);
  // 合併後的檔案：原本的分類一個位元組都不動、一個分類一行，只多兩行
  const text = B.categoriesJson(m.rows, theirs);
  const lines = readRel(CATEGORIES_PATH).trimEnd().split('\n');
  const out = text.trimEnd().split('\n');
  assert.equal(out.length, lines.length + 2);
  for (const l of lines.slice(1, -2)) assert.ok(out.includes(l), `原檔的行不見了：${l}`);
  // 只有我改（中文名稱）／只有網站上改（停用）
  const renamed = CATS.map((c) => (c.key === 'notice' ? { ...c, label: '重要疫訊（更正）' } : c));
  const retired = CATS.map((c) => (c.key === 'biosafety' ? { ...c, retiredAt: '2026-10-01' } : c));
  const m2 = B.mergeCategories(CATS, renamed, retired);
  assert.equal(m2.rows.find((c) => c.key === 'notice').label, '重要疫訊（更正）');
  assert.equal(m2.rows.find((c) => c.key === 'biosafety').retiredAt, '2026-10-01');
  // 兩邊都改同一個：衝突，先用網站上的
  const theirsRenamed = CATS.map((c) => (c.key === 'notice' ? { ...c, label: '重要疫情訊息' } : c));
  const m3 = B.mergeCategories(CATS, renamed, theirsRenamed);
  assert.equal(m3.rows.find((c) => c.key === 'notice').label, '重要疫情訊息');
  assert.deepEqual(
    m3.conflicts.map((c) => [c.key, c.yours.label]),
    [['notice', '重要疫訊（更正）']],
  );
  // 兩邊改成一樣不算衝突；兩人用同一個代號加了不同的分類算衝突
  assert.equal(B.mergeCategories(CATS, theirsRenamed, theirsRenamed).conflicts.length, 0);
  assert.deepEqual(
    B.mergeCategories(CATS, [...CATS, NEW_CAT], [...CATS, { ...NEW_CAT, label: '別的' }]).conflicts.map((c) => c.key),
    ['special-report'],
  );
  // 表單沒有的鍵不算修改
  assert.equal(
    B.mergeCategories(
      CATS,
      CATS.map((c) => ({ ...c })),
      CATS.map((c) => ({ ...c, x: 1 })),
    ).conflicts.length,
    0,
  );
  // 給審核人看的句子
  assert.deepEqual(B.categoryChanges(CATS, [...renamed.map((c) => (c.key === 'biosafety' ? { ...c, retiredAt: '2026-10-01' } : c)), NEW_CAT]), [
    '停用分類「生安專欄」',
    '修改分類「重要疫訊」：中文名稱',
    '新增分類「疫調專題」（代號 special-report）',
  ]);
});

// ───────────────────────── 頁面的版本碼 ─────────────────────────
test('疫情報導編輯頁的版本碼：資料島（還原舊分類代號、附上正本雜湊）算出的碼＝content 檔的碼（每一篇）', () => {
  assert.ok(D.articles.length >= 4);
  for (const a of D.articles) {
    const live = {
      ...a,
      ...(D.legacyArticleTypes?.[a.id] ? { articleType: D.legacyArticleTypes[a.id] } : {}),
      ...(D.sourceHashes?.[a.id] ? { sourceHash: D.sourceHashes[a.id] } : {}),
    };
    const file = readRel(site.byId.get(a.id).__file);
    assert.equal(contentVersion(live), versionOfText(file), a.id);
  }
  assert.equal(B.categoriesChanged(D.categories, CATS), false, '資料島的分類＝主檔（合併起點）');
});

// ───────────────────────── 閘道：分類主檔跟文章一起送 ─────────────────────────
test('閘道：新增分類＋文章用它 ⇒ 分類主檔寫在固定路徑、只多一行；一般車道（主檔變更需審核）、四眼原則照舊；核准後網站上兩個檔都更新', async () => {
  const { W, repo } = makeApi();
  const x = fileItem(ART_REL);
  const item = { ...x, articleType: NEW_CAT.key };
  // 沒帶分類主檔 ⇒ 文章用了網站上沒有的分類，檢查就擋（以前的情況）
  await assert.rejects(
    W.saveDraft(EDITOR, { item, baseHash: contentVersion(x) }),
    (e) => e.status === 422 && e.fields.some((f) => /分類「special-report」不在分類主檔/.test(f.message)),
  );
  assert.deepEqual(branches(repo), []);
  // 帶 path 也沒用：路徑由閘道決定
  const s1 = await W.saveDraft(EDITOR, { item, baseHash: contentVersion(x), categories: { items: [...CATS, NEW_CAT], start: CATS, path: '../../etc/x' } });
  assert.equal(s1.categories, true);
  const [br] = branches(repo);
  const onBranch = show(repo, br, CATEGORIES_PATH);
  assert.equal(onBranch, B.categoriesJson([...CATS, NEW_CAT], CATS));
  assert.equal(onBranch.trimEnd().split('\n').length, readRel(CATEGORIES_PATH).trimEnd().split('\n').length + 1, '只多一行');
  assert.deepEqual(
    gitOut(repo, ['diff', '--name-only', `main...${br}`])
      .trim()
      .split('\n')
      .sort(),
    [ART_REL, CATEGORIES_PATH].sort(),
  );
  assert.equal(s1.laneLabel, '一般車道');
  assert.ok(s1.laneNotes.some((n) => /分類主檔/.test(n)));
  // 再存一版沒改分類 ⇒ 仍帶著（送審件裡已有）；改回原樣 ⇒ 分類主檔改回網站上的
  const s2 = await W.saveDraft(EDITOR, {
    item: { ...item, pages: '1-9' },
    submissionId: s1.id,
    baseHash: s1.contentHash,
    categories: { items: [...CATS, NEW_CAT], start: CATS },
  });
  assert.equal(s2.categories, true);
  const sub = await W.submit(EDITOR, { submissionId: s2.id }, {});
  assert.equal(sub.status, 'in_review');
  // 審核人看到：分類主檔也會更新
  const diff = await W.diff(REVIEWER, s1.id);
  assert.deepEqual(diff.categories.changes, ['新增分類「疫調專題」（代號 special-report）']);
  // 四眼原則：存過的人不能核准
  await assert.rejects(W.approve(EDITOR, { submissionId: s1.id }, {}), (e) => e.status === 403);
  const done = await W.approve(REVIEWER, { submissionId: s1.id }, {});
  assert.equal(done.status, 'published');
  assert.equal(JSON.parse(show(repo, 'main', ART_REL)).articleType, NEW_CAT.key);
  assert.equal(show(repo, 'main', CATEGORIES_PATH), onBranch);
});

test('閘道：兩篇各加一個分類 ⇒ 兩個都在；送審期間網站上的主檔變了 ⇒ 不能核准（outdated）；重新開啟時已併入，再存就從網站上的最新版另開，核准後兩個都在', async () => {
  const { W, repo } = makeApi();
  const a = fileItem(ART_REL),
    b = fileItem(ART2_REL);
  const sa = await W.submit(
    EDITOR,
    { item: { ...a, articleType: NEW_CAT.key }, baseHash: contentVersion(a), categories: { items: [...CATS, NEW_CAT], start: CATS } },
    {},
  );
  const sb = await W.submit(
    EDITOR,
    { item: { ...b, articleType: OTHER_CAT.key }, baseHash: contentVersion(b), categories: { items: [...CATS, OTHER_CAT], start: CATS } },
    {},
  );
  await W.approve(REVIEWER, { submissionId: sa.id }, {});
  // B 的送審件開始後網站上的主檔變了 ⇒ 不能核准、核准不記；審核人看到說明
  await assert.rejects(
    W.approve(REVIEWER, { submissionId: sb.id }, {}),
    (e) => e.code === 'outdated' && /分類主檔/.test(e.message) && !GIT_WORDS.test(e.message),
  );
  assert.equal((await W.detail(REVIEWER, sb.id)).approvals.length, 0);
  const d = await W.diff(REVIEWER, sb.id);
  assert.match(d.outdated.text, /疫調專題/);
  assert.deepEqual(d.categories.changes, ['新增分類「同一健康」（代號 one-health）'], '差異是這一件自己改的（跟開始時比）');
  await W.returnForChanges(REVIEWER, { submissionId: sb.id, comment: '請重新開啟' }, {});
  // 重新開啟：分類已併入網站上的更新，起點換成網站上的
  const c = await W.contentFor(EDITOR, sb.id);
  assert.deepEqual(c.categories.items.map((x) => x.key).sort(), [...CATS.map((x) => x.key), NEW_CAT.key, OTHER_CAT.key].sort());
  assert.deepEqual(
    c.categories.start.map((x) => x.key),
    [...CATS.map((x) => x.key), NEW_CAT.key],
  );
  assert.match(c.categories.text, /已併進來/);
  const re = await W.submit(
    EDITOR,
    { item: c.item, submissionId: sb.id, baseHash: c.contentHash, categories: { items: c.categories.items, start: c.categories.start } },
    {},
  );
  assert.equal(re.status, 'in_review');
  assert.ok(re.history.some((h) => h.label === '併入網站上的最新版本'));
  await W.approve(REVIEWER, { submissionId: sb.id }, {});
  const main = JSON.parse(show(repo, 'main', CATEGORIES_PATH));
  assert.deepEqual(main.map((x) => x.key).sort(), [...CATS.map((x) => x.key), NEW_CAT.key, OTHER_CAT.key].sort());
  assert.equal(JSON.parse(show(repo, 'main', ART2_REL)).articleType, OTHER_CAT.key);
});

test('閘道：「不用修改，再送出」時網站上的主檔變了 ⇒ 沒有衝突就直接併入；同一個分類兩邊改得不一樣 ⇒ 409（附網站上的主檔），什麼都不寫', async () => {
  const { W, git, repo } = makeApi();
  const a = fileItem(ART_REL);
  const s1 = await W.saveDraft(EDITOR, {
    item: { ...a, articleType: NEW_CAT.key },
    baseHash: contentVersion(a),
    categories: { items: [...CATS, NEW_CAT], start: CATS },
  });
  await directEdit(git, CATEGORIES_PATH, B.categoriesJson([...CATS, OTHER_CAT], CATS));
  const sub = await W.submit(EDITOR, { submissionId: s1.id }, {});
  assert.equal(sub.status, 'in_review');
  await W.approve(REVIEWER, { submissionId: s1.id }, {});
  assert.deepEqual(
    JSON.parse(show(repo, 'main', CATEGORIES_PATH))
      .map((x) => x.key)
      .slice(-2)
      .sort(),
    [NEW_CAT.key, OTHER_CAT.key].sort(),
  );
  // 衝突：網站上把「重要疫訊」改名，我也改了、改得不一樣
  const b = fileItem(ART2_REL);
  const cur = JSON.parse(show(repo, 'main', CATEGORIES_PATH));
  await directEdit(
    git,
    CATEGORIES_PATH,
    B.categoriesJson(
      cur.map((c) => (c.key === 'notice' ? { ...c, label: '重要疫情訊息' } : c)),
      cur,
    ),
  );
  const before = branches(repo);
  await assert.rejects(
    W.saveDraft(EDITOR, {
      item: b,
      baseHash: contentVersion(b),
      categories: { items: cur.map((c) => (c.key === 'notice' ? { ...c, label: '重要疫訊（更正）' } : c)), start: cur },
    }),
    (e) =>
      e.status === 409 &&
      e.extra.stale.kind === 'categories' &&
      e.extra.stale.categories.conflicts[0].key === 'notice' &&
      e.extra.stale.categories.rows.some((c) => c.label === '重要疫情訊息') &&
      /重要疫訊/.test(e.message) &&
      !GIT_WORDS.test(e.message),
  );
  assert.deepEqual(branches(repo), before, '什麼都沒寫');
});

test('閘道：分類主檔只跟疫情報導文章一起送；格式與內容不對 ⇒ 擋下，錯誤說第幾個分類哪一欄（不出現 JSON 路徑）', async () => {
  const { W, api } = makeApi();
  const a = fileItem(ART_REL);
  const faq = JSON.parse(readRel('content/faq/dengue-fever-when-to-see-doctor.json'));
  await assert.rejects(
    W.saveDraft(EDITOR, { item: faq, categories: { items: CATS, start: CATS } }),
    (e) => e.status === 422 && e.fields[0].field === 'categories',
  );
  await assert.rejects(
    W.saveDraft(EDITOR, { item: a, baseHash: contentVersion(a), categories: { items: [...CATS, { key: 'Bad Key', label: '壞的', evil: 1 }], start: CATS } }),
    (e) =>
      e.status === 422 &&
      e.fields.every((f) => f.field === 'categories') &&
      e.fields.some((f) => /第 9 個分類「壞的」/.test(f.message)) &&
      !e.fields.some((f) => /\/\d/.test(f.message)),
  );
  // 已上架的分類不能刪（只能停用）：閘道自己擋，不靠頁面
  await assert.rejects(
    W.saveDraft(EDITOR, { item: a, baseHash: contentVersion(a), categories: { items: CATS.filter((c) => c.key !== 'biosafety'), start: CATS } }),
    (e) => e.status === 422 && e.fields[0].field === 'categories' && /不能刪除.*生安專欄/.test(e.message),
  );
  // HTTP：格式不對 ⇒ 400
  const sess = { 'x-cdc-dev-session': Buffer.from(JSON.stringify(makeSession(acct('demo-004')))).toString('base64url') };
  const call = async (body) => {
    const chunks = [];
    const req = Object.assign(
      (async function* () {
        yield Buffer.from(JSON.stringify(body));
      })(),
      {
        method: 'POST',
        headers: { host: 'localhost', origin: 'http://localhost', 'content-type': 'application/json', 'x-csrf-token': api.csrfFor(EDITOR), ...sess },
        socket: { remoteAddress: '127.0.0.1' },
      },
    );
    const res = {
      statusCode: 0,
      setHeader() {},
      end(b) {
        if (b) chunks.push(String(b));
      },
    };
    await api.handle(req, res, '/api/gateway/drafts', new URLSearchParams());
    return { status: res.statusCode, body: JSON.parse(chunks.join('') || 'null') };
  };
  assert.equal((await call({ item: a, baseHash: contentVersion(a), categories: { items: 'x', start: [] } })).status, 400);
  assert.equal((await call({ item: a, baseHash: contentVersion(a), categories: { items: Array(61).fill({ key: 'a', label: 'a' }), start: [] } })).status, 400);
  const ok = await call({ item: { ...a, articleType: NEW_CAT.key }, baseHash: contentVersion(a), categories: { items: [...CATS, NEW_CAT], start: CATS } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.categories, true);
});

test('閘道：重新開啟送審件時帶回新卷期與分類主檔；從網站版本開啟、已有進行中的送審件 ⇒ 409 open（疫情報導也一樣）', async () => {
  const { W } = makeApi();
  const st = {
    ...B.emptyState({ today: TODAY, categories: CATS }),
    owner: 'unit.epidemic-intelligence',
    issueMode: 'new',
    newVolume: '42',
    newIssue: '30',
    newDate: '2026-10-20',
    articleNo: '1',
    title: '閘道測試文章（新卷期）',
    articleType: NEW_CAT.key,
    authors: '甲 | 1 | * | a@cdc.gov.tw',
    affiliations: '1 | 疫情中心',
    pages: '1-5',
    doi: '10.6524/EB.202610_42(30).0001',
    abstract: '摘要。',
    sections: [{ key: 'origin', heading: '事件源起', markdown: '經過。' }],
  };
  const issue = B.resolveIssue(st, D.issues, { today: TODAY });
  const item = B.buildArticle(st, { today: TODAY, issue });
  const { _new, ...issueJson } = issue;
  void _new;
  const s1 = await W.saveDraft(OTHER_EDITOR, { item, baseHash: 'new', companions: [issueJson], categories: { items: [...CATS, NEW_CAT], start: CATS } });
  const c = await W.contentFor(OTHER_EDITOR, s1.id);
  assert.deepEqual(
    c.companions.map((x) => x.id),
    [issueJson.id],
  );
  assert.equal(c.companions[0].publishedAt, '2026-10-20');
  assert.deepEqual(
    c.categories.items.map((x) => x.key),
    [...CATS.map((x) => x.key), NEW_CAT.key],
  );
  assert.deepEqual(c.categories.start, CATS);
  // 既有文章：已有進行中的送審件時，依網站版本存 ⇒ 409 open
  const a = fileItem(ART_REL);
  const sa = await W.saveDraft(EDITOR, { item: { ...a, pages: '9-10' }, baseHash: contentVersion(a) });
  await assert.rejects(
    W.saveDraft(EDITOR, { item: { ...a, title: `${a.title}（另一位）` }, submissionId: sa.id, baseHash: contentVersion(a) }),
    (e) => e.status === 409 && e.extra.stale.kind === 'open',
  );
  const cur = await W.current(EDITOR, { contentId: ART, type: 'article', base: contentVersion(a) });
  assert.equal(cur.open.id, sa.id);
  assert.notEqual(cur.open.contentHash, contentVersion(a));
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
  '端到端（疫情報導編輯頁＋真的閘道）：開啟後別人先上線 ⇒ 存檔被擋、載入最新版保留我的修改；已有送審件時一開啟就擋；新增分類經閘道送審、與網站上別人加的分類合併、同一分類衝突時載入最新版',
  { timeout: 240000 },
  async (t) => {
    const js = path.join(DIST, 'assets/js/admin/bulletin-edit.js');
    if (!fs.existsSync(js)) return t.skip('dist 尚未建置');
    if (!fs.readFileSync(js, 'utf8').includes('__admBulletin')) return t.skip('dist 是舊版（請重新建置）');
    let chromium;
    try {
      ({ chromium } = await import('playwright'));
    } catch {
      return t.skip('沒有 Playwright');
    }
    if (!fs.existsSync(CHROME)) return t.skip('沒有 Chromium');
    const seedDir = makeSeed();
    const d = tmpDir('r52b-e2e-');
    const repo = path.join(d, 'repo');
    const port = await freePort();
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
    const x = fileItem(ART_REL);
    /** 送審件目前的分支（網站上的主檔變了、另開新分支後是 -v2；舊分支留著當紀錄） */
    const onBranch = (rel) => {
      const br = branches(repo).sort((a, b) => a.length - b.length || a.localeCompare(b));
      assert.ok(br.length >= 1 && br.every((b) => b.startsWith(br[0])), `應只有一個送審件：${br}`);
      return show(repo, br[br.length - 1], rel);
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
    const ready = async (page) => {
      await page.waitForFunction(() => window.__admBulletin?.live, null, { timeout: 20000 });
      await page.waitForFunction(() => document.body.classList.contains('adm-gw') && document.querySelector('#gw-state')?.textContent, null, {
        timeout: 15000,
      });
      await page.waitForTimeout(400); // 開啟時的版本檢查跑完
    };
    const syncText = (page) => page.evaluate(() => document.querySelector('#gw-sync')?.textContent ?? '');
    const changed = (page) => page.evaluate(() => document.querySelector('#te-changed')?.dataset.changed ?? '');
    const waitSync = (page, re) =>
      page.waitForFunction((src) => new RegExp(src).test(document.querySelector('#gw-sync')?.textContent ?? ''), re.source, { timeout: 20000 });
    const waitStatus = (page, re) =>
      page.waitForFunction(
        (src) => new RegExp(src).test(document.querySelector('#gw-status')?.textContent ?? '') && !document.querySelector('#gw-save').disabled,
        re.source,
        { timeout: 20000 },
      );
    try {
      for (let i = 0; i < 80; i++) {
        try {
          if ((await fetch(`${base}/api/gateway/health`)).ok) break;
        } catch {
          /* 等伺服器 */
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      // ① A 開啟修改頁：版本碼＝檔案的版本碼
      const pa = await as('demo-004');
      await pa.goto(`${base}/admin/bulletin/edit/?edit=${ART}`);
      await ready(pa);
      assert.equal(await syncText(pa), '', '剛開啟、沒有別人在改：沒有提醒');
      assert.equal(await pa.evaluate(() => window.__admBulletin.getBaseHash()), versionOfText(readRel(ART_REL)));

      // ② B 改篇名、送審；李○翰核准上線
      const pb = await as('demo-004');
      await pb.goto(`${base}/admin/bulletin/edit/?edit=${ART}`);
      await ready(pb);
      await pb.fill('#te-title', `${x.title}（B 改）`);
      await pb.waitForFunction(() => /title/.test(document.querySelector('#te-changed')?.dataset.changed ?? ''), null, { timeout: 15000 });
      await pb.click('#gw-submit');
      await pb.waitForFunction(() => /已送審/.test(document.querySelector('#gw-status')?.textContent ?? ''), null, { timeout: 20000 });
      const sidB = await pb.evaluate(() => JSON.parse(localStorage.getItem('cdc.admin.gwCurrent') ?? 'null')?.sid);
      const pr = await as('demo-005');
      await pr.goto(`${base}/admin/review/?item=${sidB}`);
      await pr.waitForFunction(() => !document.querySelector('#gw-approve')?.disabled, null, { timeout: 20000 });
      await pr.click('#gw-approve');
      await pr.waitForFunction(() => /已上線/.test(document.querySelector('#gw-act-msg')?.textContent ?? ''), null, { timeout: 20000 });
      assert.match(JSON.parse(show(repo, 'main', ART_REL)).title, /B 改/);
      await pb.context().close();

      // ③ A 還在舊版上：改摘要後存草稿 ⇒ 被擋，什麼都沒寫；說明是誰、改了什麼
      await pa.fill('#te-summary', 'A 改的摘要一句。');
      await pa.waitForFunction(() => /summary/.test(document.querySelector('#te-changed')?.dataset.changed ?? ''), null, { timeout: 15000 });
      await pa.click('#gw-save');
      await waitSync(pa, /已經更新/);
      const blocked = await syncText(pa);
      assert.match(blocked, /張○玲修改、李○翰核准/);
      assert.match(blocked, /標題/);
      assert.doesNotMatch(blocked, GIT_WORDS);
      assert.deepEqual(branches(repo), [], 'A 的舊版沒有寫進系統');
      // 載入最新版（保留我的修改）：篇名是 B 的、摘要是 A 的；畫面上的改動只列 A 改的（editBase 已換成最新版）
      await pa.click('#gw-sync button.adm-btn--sm:not(.adm-btn--ghost)');
      await waitSync(pa, /已載入最新版/);
      assert.match(await syncText(pa), /你的修改已重新套用：摘要/);
      assert.match(await syncText(pa), /別人改了：.*標題/);
      assert.equal(await pa.inputValue('#te-title'), `${x.title}（B 改）`);
      assert.equal(await pa.inputValue('#te-summary'), 'A 改的摘要一句。');
      assert.equal(await changed(pa), 'summary');
      assert.equal(await pa.evaluate(() => window.__admBulletin.getBaseHash()), versionOfText(show(repo, 'main', ART_REL)));
      await pa.click('#gw-save');
      await waitStatus(pa, /已儲存草稿/);
      let f = JSON.parse(onBranch(ART_REL));
      assert.match(f.title, /B 改/, 'B 的修改沒有被蓋掉');
      assert.equal(f.summary, 'A 改的摘要一句。');
      assert.equal(f.articleType, x.articleType, '沒改分類：舊分類代號原樣');

      // ④ 已有進行中的送審件時，另一位從網站版本開啟 ⇒ 一開啟就提醒，存檔鈕停用，可以「從那一件繼續」
      const pc = await as('demo-004');
      await pc.goto(`${base}/admin/bulletin/edit/?edit=${ART}`);
      await ready(pc);
      await waitSync(pc, /已有進行中的送審件/);
      assert.equal(await pc.isDisabled('#gw-save'), true);
      assert.equal(await pc.isDisabled('#gw-submit'), true);
      assert.match(await pc.getAttribute('#gw-sync a', 'href'), /\/admin\/bulletin\/edit\/\?gw=gw-/);
      // 從那一件繼續：表單＝送審件的版本；A 又存了一版後，C 依舊版存 ⇒ 擋下；載入最新版後存得進去
      await pc.click('#gw-sync a');
      await pc.waitForFunction(() => window.__admBulletin?.source === 'gateway' && location.search.includes('gw='), null, { timeout: 20000 });
      await pc.waitForTimeout(300);
      assert.equal(await pc.inputValue('#te-summary'), 'A 改的摘要一句。');
      assert.equal(await pc.inputValue('#te-title'), `${x.title}（B 改）`);
      assert.equal(await pc.isDisabled('#gw-save'), false);
      await pa.fill('#te-pages', '1-12');
      await pa.waitForTimeout(400);
      await pa.click('#gw-save');
      await waitStatus(pa, /已儲存草稿/);
      await pc.fill('#te-keywords', '肉毒桿菌中毒、群聚、C 加的關鍵字');
      await pc.waitForFunction(() => /keywords/.test(document.querySelector('#te-changed')?.dataset.changed ?? ''), null, { timeout: 15000 });
      await pc.click('#gw-save');
      await waitSync(pc, /又有人存過/);
      assert.match(await syncText(pc), /張○玲/);
      assert.equal(JSON.parse(onBranch(ART_REL)).pages, '1-12', '沒有被 C 的舊版蓋掉');
      await pc.click('#gw-sync button.adm-btn--sm:not(.adm-btn--ghost)');
      await waitSync(pc, /已載入最新版/);
      assert.equal(await pc.inputValue('#te-pages'), '1-12');
      assert.match(await pc.inputValue('#te-keywords'), /C 加的關鍵字/);
      assert.equal(await changed(pc), 'keywords', '送審件的版本當成新的起點：A 的修改不算 C 改的');
      await pc.click('#gw-save');
      await waitStatus(pc, /已儲存草稿/);
      f = JSON.parse(onBranch(ART_REL));
      assert.equal(f.pages, '1-12');
      assert.ok(f.keywords.includes('C 加的關鍵字'));
      assert.equal(f.summary, 'A 改的摘要一句。');
      // C 重新整理（網址不帶送審件）：本機草稿仍以送審件的版本為底，送審件裡 B、A 的修改不會掉回網站上的值；開啟時說「你正在接著改這一件」
      await pc.goto(`${base}/admin/bulletin/edit/`);
      await pc.waitForFunction(() => window.__admBulletin?.live && document.querySelector('#gw-state')?.textContent, null, { timeout: 20000 });
      await waitSync(pc, /正在接著改這一件/);
      const exp = await pc.evaluate(() => ({
        a: window.__admBulletin.current().article,
        src: window.__admBulletin.source,
        h: window.__admBulletin.getBaseHash(),
      }));
      assert.equal(exp.src, 'gateway');
      assert.match(exp.a.title, /B 改/);
      assert.equal(exp.a.pages, '1-12');
      assert.equal(exp.h, versionOfText(onBranch(ART_REL)));
      assert.equal(await pc.isDisabled('#gw-save'), false);
      await pc.context().close();
      // A 再存之前先載入最新版（C 存過一版）
      await pa.click('#gw-save');
      await waitSync(pa, /又有人存過/);
      await pa.click('#gw-sync button.adm-btn--sm:not(.adm-btn--ghost)');
      await waitSync(pa, /已載入最新版/);
      assert.match(await pa.inputValue('#te-keywords'), /C 加的關鍵字/);

      // ⑤ 分類：A 加一個分類並用在這篇，也把「重要疫訊」改名；同時網站上（資訊室）加了另一個分類、也把「重要疫訊」改了名
      await pa.fill('#te-cat-new', NEW_CAT.label);
      await pa.fill('#te-cat-new-en', NEW_CAT.labelEn);
      await pa.click('#te-cat-add');
      await pa.selectOption('#te-type', NEW_CAT.key);
      const noticeRow = await pa.evaluate(() =>
        [...document.querySelectorAll('#te-cats tr')].findIndex((tr) => tr.querySelector('[data-ck="key"]')?.value === 'notice'),
      );
      await pa.fill(`#te-cats tr:nth-child(${noticeRow + 1}) [data-ck="label"]`, '重要疫訊（更正）');
      await pa.waitForTimeout(500);
      const git = createLocalGit({ dir: repo });
      const main0 = JSON.parse(show(repo, 'main', CATEGORIES_PATH));
      await directEdit(
        git,
        CATEGORIES_PATH,
        B.categoriesJson([...main0.map((c) => (c.key === 'notice' ? { ...c, label: '重要疫情訊息' } : c)), OTHER_CAT], main0),
      );
      await pa.click('#gw-submit');
      await waitSync(pa, /重要疫訊/);
      assert.match(await syncText(pa), /網站上已經有人改過/);
      assert.doesNotMatch(await syncText(pa), GIT_WORDS);
      assert.doesNotMatch(onBranch(CATEGORIES_PATH), /special-report/, '衝突時什麼都沒寫');
      // 載入最新版：衝突的分類先用網站上的、列出我的值；我加的分類仍在
      await pa.click('#gw-sync button.adm-btn--sm:not(.adm-btn--ghost)');
      await waitSync(pa, /已載入最新版/);
      assert.match(await syncText(pa), /兩邊都改了/);
      assert.match(await syncText(pa), /重要疫訊（更正）/);
      assert.equal(await pa.inputValue(`#te-cats tr:nth-child(${noticeRow + 1}) [data-ck="label"]`), '重要疫情訊息');
      assert.equal(await pa.inputValue('#te-type'), NEW_CAT.key);
      await pa.click('#gw-submit');
      await pa.waitForFunction(() => /已送審/.test(document.querySelector('#gw-status')?.textContent ?? ''), null, { timeout: 20000 });
      const cats = JSON.parse(onBranch(CATEGORIES_PATH));
      assert.deepEqual(
        cats
          .map((c) => c.key)
          .slice(-2)
          .sort(),
        [NEW_CAT.key, OTHER_CAT.key].sort(),
        '我加的與網站上別人加的分類都在',
      );
      assert.equal(cats.find((c) => c.key === 'notice').label, '重要疫情訊息');
      const sidA = await pa.evaluate(() => JSON.parse(localStorage.getItem('cdc.admin.gwCurrent') ?? 'null')?.sid);

      // ⑥ 審核人看到「也會更新分類」；退回後 A 重新開啟（?gw=）：分類與這篇的分類都帶回表單，再送審、核准，網站上兩個檔都更新
      await pr.goto(`${base}/admin/review/?item=${sidA}`);
      await pr.waitForFunction(() => /疫調專題/.test(document.querySelector('#gw-diff-cats')?.textContent ?? ''), null, { timeout: 20000 });
      assert.match(await pr.textContent('#gw-d-meta'), /一起上線疫情報導分類主檔/);
      await pr.fill('#gw-comment', '請確認新分類的英文名稱。');
      await pr.click('#gw-return');
      await pr.waitForFunction(() => /已退回/.test(document.querySelector('#gw-act-msg')?.textContent ?? ''), null, { timeout: 20000 });
      await pa.goto(`${base}/admin/bulletin/edit/?gw=${sidA}`);
      await pa.waitForFunction(() => window.__admBulletin?.source === 'gateway' && /退回/.test(document.querySelector('#gw-status')?.textContent ?? ''), null, {
        timeout: 20000,
      });
      assert.equal(await pa.inputValue('#te-type'), NEW_CAT.key, '分類主檔帶回來了，這篇的分類還選得到');
      assert.ok(await pa.evaluate((k) => [...document.querySelectorAll('#te-cats [data-ck="key"]')].some((i) => i.value === k), NEW_CAT.key));
      await pa.click('#gw-submit');
      await pa.waitForFunction(() => /已送審/.test(document.querySelector('#gw-status')?.textContent ?? ''), null, { timeout: 20000 });
      assert.ok(JSON.parse(onBranch(CATEGORIES_PATH)).some((c) => c.key === NEW_CAT.key));
      await pr.goto(`${base}/admin/review/?item=${sidA}`);
      await pr.waitForFunction(() => /疫調專題/.test(document.querySelector('#gw-diff-cats')?.textContent ?? ''), null, { timeout: 20000 });
      await pr.waitForFunction(() => !document.querySelector('#gw-approve')?.disabled, null, { timeout: 20000 });
      await pr.click('#gw-approve');
      await pr.waitForFunction(() => /已上線/.test(document.querySelector('#gw-act-msg')?.textContent ?? ''), null, { timeout: 20000 });
      const m = JSON.parse(show(repo, 'main', ART_REL));
      assert.equal(m.articleType, NEW_CAT.key);
      assert.match(m.title, /B 改/);
      assert.equal(m.summary, 'A 改的摘要一句。');
      assert.equal(m.pages, '1-12');
      assert.ok(m.keywords.includes('C 加的關鍵字'));
      const mc = JSON.parse(show(repo, 'main', CATEGORIES_PATH));
      assert.ok(mc.some((c) => c.key === NEW_CAT.key) && mc.some((c) => c.key === OTHER_CAT.key));
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      srv.kill();
      if (stderr.trim() && process.env.DEBUG_E2E) console.error(stderr);
    }
  },
);
