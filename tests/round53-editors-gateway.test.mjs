// 第五十三輪：職缺、採購、接種時程三個編輯頁接上寫入閘道（docs/deploy.md §25、guide-staff §56）。
//
// 以前這三頁只能下載 JSON、由資訊室開 PR；現在有閘道時跟上架頁、疫情報導編輯頁一樣：存草稿、送審、審核、核准、退回，
// 存檔帶版本碼、被擋時「載入最新版（保留我的修改）」。沒有閘道（GitHub Pages、?gateway=off）時照舊只產生 JSON。
//   - 職缺與採購是一般內容（content/jobs、content/tenders）：甄選結果的個資規則（只公布報名編號、必須有下架日）由閘道照 CI 同一份規則擋；
//     審核人看到的差異逐欄、逐筆（異動紀錄、決標資訊、名單）。
//   - 接種時程是主檔（content/master/immunization-schedule.json），不是一筆內容：路徑寫死、以列（id）三方合併到網站上的主檔，
//     同一筆同一欄兩邊改得不一樣 ⇒ 409；一律走一般車道（主檔變更需審核）；審核人看到逐筆、逐欄的差異。
//   - 慢性傳染病組有自己的示範承辦人與科長。
//   - 沒帶版本碼的存檔：預設照舊接受（稽核記 baseHash: missing）；GATEWAY_REQUIRE_BASE_HASH=1 才拒絕（428）。
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
import { adGroupsOf, makeSession, DEMO_ACCOUNTS, canAccess } from '../src/client/admin/auth-rules.js';
import { principalFrom, normAccount } from '../scripts/lib/gateway/auth.mjs';
import { createValidator, MASTER_FILES, plainError } from '../scripts/lib/gateway/validate-item.mjs';
import { createLocalGit, SERVICE_IDENTITY } from '../scripts/lib/gateway/git-local.mjs';
import { createGatewayApi, configFromEnv } from '../scripts/lib/gateway/index.mjs';
import { parseEml } from '../scripts/lib/mail-outbox.mjs';
import { contentVersion, versionOfText, NEW_VERSION } from '../src/client/admin/content-version.js';
import { mergeRows, rowChanges, rowChangeText } from '../src/client/admin/master-merge.js';
import { scheduleDiffOptions } from '../src/client/admin/vaxschedule-edit-core.js';
import * as jobsTpl from '../src/templates/admin/jobs-edit.mjs';
import * as tendersTpl from '../src/templates/admin/tenders-edit.mjs';
import * as vaxTpl from '../src/templates/admin/vaccine-schedule.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TODAY = '2026-10-14';
const NOW = Date.parse('2026-10-14T02:00:00Z');
const tmpDir = (p = 'r53-') => fs.mkdtempSync(path.join(os.tmpdir(), p));
const acct = (sub) => DEMO_ACCOUNTS.find((a) => a.sub === sub);
const P = (sub) =>
  principalFrom({ account: normAccount(sub), name: acct(sub).name, email: `${sub}@cdc-prototype.invalid`, groups: adGroupsOf(acct(sub)) }, 'dev');
const gitOut = (dir, args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
const GIT_WORDS = /分支|branch|commit|提交|合併請求|merge|pull request|\bPR\b|\bMR\b|GitLab|GitHub|\bgit\b/i;
const validator = createValidator();
const site = govern(TODAY);
const readRel = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const fileItem = (rel) => JSON.parse(readRel(rel));
const SCHED_REL = 'content/master/immunization-schedule.json';
const SCHED = fileItem(SCHED_REL);
const SCHED_ID = 'master.immunization-schedule';
const JOB_REL = 'content/jobs/2026-08-10-system-analyst.json'; // 有甄選結果（下架日 2026-12-22，名單還在）
const JOB = 'job.2026-08-10-system-analyst';
const JOB2_REL = 'content/jobs/2026-09-30-epidemic-physician.json';
const JOB2 = 'job.2026-09-30-epidemic-physician';
const OLD_JOB = 'job.2026-05-25-quarantine-officer-kaoping'; // 甄選結果已過下架日：建置把名單從記憶體拿掉
const TEN_REL = 'content/tenders/2026-09-22-campaign-video.json';
const TEN = 'tender.2026-09-22-campaign-video';
const vname = (id) => site.master.vaccines.find((v) => v.id === id)?.name ?? id;
const DIFF = scheduleDiffOptions(vname);
const row = (rows, id) => rows.find((r) => r.id === id);
const withRow = (rows, id, patch) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r));
const schedJson = (rows) => `${JSON.stringify(rows, null, 2)}\n`;
const master = (items, start = SCHED) => ({ name: 'immunization-schedule', items, start });

/** 頁面拿到的資料島 */
function island(tpl, pagePath, id) {
  const h = String(tpl.render(makeCtx(site, 'zh-TW', { path: pagePath, alternates: ['zh-TW'], view: 'admin' })));
  const m = h.match(new RegExp(`<script type="application/json" id="${id}">([\\s\\S]*?)</script>`));
  assert.ok(m, `${pagePath} 沒有資料島 ${id}`);
  return { html: h, data: JSON.parse(m[1]) };
}

/** 閘道的測試版本庫的種子：職缺、採購、接種時程主檔，以及慢性傳染病組的一則 Q&A */
function makeSeed() {
  const seedDir = path.join(tmpDir('r53-seed-'), 'seed');
  for (const sub of ['jobs', 'tenders', 'master', 'faq']) fs.mkdirSync(path.join(seedDir, sub), { recursive: true });
  for (const sub of ['jobs', 'tenders'])
    for (const f of fs.readdirSync(path.join(ROOT, 'content', sub))) fs.copyFileSync(path.join(ROOT, 'content', sub, f), path.join(seedDir, sub, f));
  fs.copyFileSync(path.join(ROOT, SCHED_REL), path.join(seedDir, 'master', 'immunization-schedule.json'));
  fs.copyFileSync(path.join(ROOT, 'content/faq/tb-cough-two-weeks.json'), path.join(seedDir, 'faq', 'tb-cough-two-weeks.json'));
  return seedDir;
}
function makeApi(extra = {}) {
  const d = tmpDir();
  const git = createLocalGit({ dir: path.join(d, 'repo'), seedDir: makeSeed() });
  const api = createGatewayApi({
    stateFile: path.join(d, 'state.json'),
    auditFile: path.join(d, 'audit.jsonl'),
    outboxDir: path.join(d, 'outbox'),
    gitProvider: git,
    validator,
    csrfSecret: 't',
    now: () => NOW,
    ...extra,
  });
  const audit = () =>
    fs
      .readFileSync(path.join(d, 'audit.jsonl'), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  const outbox = () =>
    fs.existsSync(path.join(d, 'outbox'))
      ? fs
          .readdirSync(path.join(d, 'outbox'))
          .filter((f) => f.endsWith('.eml'))
          .map((f) => JSON.stringify(parseEml(fs.readFileSync(path.join(d, 'outbox', f), 'utf8'))))
      : [];
  return { api, W: api.workflow, git, repo: path.join(d, 'repo'), audit, outbox };
}
const show = (repo, ref, rel) => gitOut(repo, ['show', `${ref}:${rel}`]);
const branches = (repo) => gitOut(repo, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/cms/']).trim().split('\n').filter(Boolean);
const lastBranch = (repo) =>
  branches(repo)
    .sort((a, b) => a.length - b.length || a.localeCompare(b))
    .at(-1);
/** 資訊室（或另一個管道）直接在 main 上改檔 */
async function directEdit(git, rel, text, message = '資訊室直接更新\n') {
  await git.commit({ branch: 'main', files: [{ path: rel, content: text }], message, author: SERVICE_IDENTITY });
}
/** 模擬 HTTP 呼叫（與 round52-concurrent-edit 同一個做法） */
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
    const text = chunks.join('');
    let json = null;
    try {
      json = JSON.parse(text || 'null');
    } catch {
      json = text;
    }
    return { status: res.statusCode, body: json, headers: res.headers };
  };
}

// ───────────────────────── 純函式：主檔的合併與白話差異 ─────────────────────────
test('主檔三方合併（以列 id 對應）：不同列、同一列不同欄位都不算衝突；同一欄改得不一樣、一邊刪一邊改才算；我加的列放在原本的位置', () => {
  const mine = withRow(withRow(SCHED, 'sched.bcg-1', { note: '我改的備註' }), 'sched.mmr-1', { ageLabel: '我改的年齡' });
  const theirs = withRow(withRow(SCHED, 'sched.hpv', { note: '別人改的備註' }), 'sched.mmr-1', { note: '別人改的 MMR 備註' });
  const m = mergeRows(SCHED, mine, theirs, DIFF);
  assert.deepEqual(m.conflicts, []);
  assert.equal(row(m.rows, 'sched.bcg-1').note, '我改的備註');
  assert.equal(row(m.rows, 'sched.hpv').note, '別人改的備註');
  assert.equal(row(m.rows, 'sched.mmr-1').ageLabel, '我改的年齡', '同一列不同欄位：兩邊都留');
  assert.equal(row(m.rows, 'sched.mmr-1').note, '別人改的 MMR 備註');
  assert.deepEqual(m.mine.sort(), ['sched.bcg-1', 'sched.mmr-1']);
  assert.deepEqual(m.theirs.sort(), ['sched.hpv', 'sched.mmr-1']);
  assert.deepEqual(
    m.rows.map((r) => r.id),
    SCHED.map((r) => r.id),
    '順序不變',
  );
  // 同一列同一欄改得不一樣 ⇒ 衝突，先用網站上的，交回我的整列
  const c = mergeRows(SCHED, withRow(SCHED, 'sched.bcg-1', { note: 'A' }), withRow(SCHED, 'sched.bcg-1', { note: 'B' }), DIFF);
  assert.deepEqual(
    c.conflicts.map((x) => [x.key, x.fields, x.yours.note]),
    [['sched.bcg-1', ['note'], 'A']],
  );
  assert.equal(row(c.rows, 'sched.bcg-1').note, 'B');
  // 改成一樣不算衝突；一邊刪、一邊改 ⇒ 衝突（先用網站上的：那一列還在）
  assert.equal(mergeRows(SCHED, withRow(SCHED, 'sched.bcg-1', { note: 'B' }), withRow(SCHED, 'sched.bcg-1', { note: 'B' }), DIFF).conflicts.length, 0);
  const del = mergeRows(
    SCHED,
    SCHED.filter((r) => r.id !== 'sched.bcg-1'),
    withRow(SCHED, 'sched.bcg-1', { note: 'B' }),
    DIFF,
  );
  assert.deepEqual(
    del.conflicts.map((x) => [x.key, x.yours]),
    [['sched.bcg-1', null]],
  );
  assert.ok(row(del.rows, 'sched.bcg-1'));
  // 只有我刪 ⇒ 刪掉；我在 bcg-1 後面加一列、別人在最後加一列 ⇒ 兩列都在，我的在 bcg-1 後面
  assert.equal(
    row(
      mergeRows(
        SCHED,
        SCHED.filter((r) => r.id !== 'sched.bcg-1'),
        SCHED,
        DIFF,
      ).rows,
      'sched.bcg-1',
    ),
    undefined,
  );
  const added = { ...row(SCHED, 'sched.bcg-1'), id: 'sched.bcg-2', label: '卡介苗 新項目' };
  const at = SCHED.findIndex((r) => r.id === 'sched.bcg-1');
  const theirsAdd = [...SCHED, { ...row(SCHED, 'sched.mpox'), id: 'sched.mpox-2', label: '猴痘疫苗 第 2 劑' }];
  const a = mergeRows(SCHED, [...SCHED.slice(0, at + 1), added, ...SCHED.slice(at + 1)], theirsAdd, DIFF);
  assert.deepEqual(a.conflicts, []);
  assert.equal(a.rows[at + 1].id, 'sched.bcg-2');
  assert.equal(a.rows.at(-1).id, 'sched.mpox-2');
});

test('主檔的白話差異：逐筆、逐欄，月齡寫成幾歲幾個月、階段與費用寫中文、疫苗寫名稱；只換順序另外說', () => {
  const after = withRow(withRow(SCHED, 'sched.mmr-1', { ageMinMonths: 15, funded: 'self', note: '新的備註' }), 'sched.zoster', { ageMinMonths: 612 }).filter(
    (r) => r.id !== 'sched.rabies-pep',
  );
  const rc = rowChanges(SCHED, [...after, { ...row(SCHED, 'sched.bcg-1'), id: 'sched.bcg-2', label: '卡介苗 補種' }], DIFF);
  const byKind = Object.fromEntries(rc.rows.map((r) => [r.kind, r]));
  assert.deepEqual(Object.keys(byKind).sort(), ['added', 'changed', 'removed']);
  const t = rowChangeText(rc.rows.find((r) => r.key === 'sched.mmr-1'));
  assert.match(t, /^修改「.*MMR.*」（sched\.mmr-1）：/);
  assert.match(t, /建議年齡下限由「12 個月」改為「15 個月」/);
  assert.match(rowChangeText(rc.rows.find((r) => r.key === 'sched.zoster')), /建議年齡下限由「.+」改為「51 歲（612 個月）」/);
  assert.match(t, /費用由「公費」改為「自費」/);
  assert.match(t, /備註/);
  assert.match(rowChangeText(byKind.added), /^新增一筆「卡介苗 補種」（sched\.bcg-2）/);
  assert.match(rowChangeText(byKind.removed), /^刪除「.*」（sched\.rabies-pep）/);
  assert.ok(byKind.added.fields.some((f) => f.label === '疫苗' && /卡介苗/.test(f.to)));
  for (const r of rc.rows) assert.doesNotMatch(rowChangeText(r), /ageMinMonths|funded|undefined|\[object/);
  // 只換順序
  const swapped = [SCHED[1], SCHED[0], ...SCHED.slice(2)];
  assert.deepEqual(rowChanges(SCHED, swapped, DIFF), { rows: [], reordered: true });
  assert.deepEqual(
    rowChanges(
      SCHED,
      SCHED.map((r) => ({ ...r })),
      DIFF,
    ),
    { rows: [], reordered: false },
  );
});

test('版本碼：主檔整份算（列的順序算、每一列的鍵順序不算）；三個編輯頁資料島的版本碼＝content 檔的版本碼（每一筆）', () => {
  assert.equal(contentVersion(SCHED), versionOfText(readRel(SCHED_REL)));
  assert.match(contentVersion(SCHED), /^v1-[0-9a-f]{28}$/);
  const reKeyed = SCHED.map((r) => Object.fromEntries(Object.entries(r).reverse()));
  assert.equal(contentVersion(reKeyed), contentVersion(SCHED), '鍵的順序不算修改');
  assert.notEqual(contentVersion([SCHED[1], SCHED[0], ...SCHED.slice(2)]), contentVersion(SCHED), '列的順序算修改');
  assert.notEqual(contentVersion(withRow(SCHED, 'sched.bcg-1', { verified: true })), contentVersion(SCHED), '主檔沒有「每次存檔都會改」的欄位：已核對也算');
  // 接種時程
  const V = island(vaxTpl, '/admin/vaccines/schedule/', 'adm-vxs-data');
  assert.equal(V.data.version, versionOfText(readRel(SCHED_REL)));
  assert.equal(contentVersion(V.data.items), V.data.version, '資料島的主檔＝檔案');
  assert.match(V.html, /id="gw-panel"[^>]*hidden/, '送審面板預設隱藏（沒有閘道時不出現）');
  // 職缺：每一筆的版本碼由檔案算；名單已下架的那一筆，資料島沒有名單，所以不能由資料島算
  const J = island(jobsTpl, '/admin/jobs/edit/', 'adm-jobs-data');
  const jobFiles = fs.readdirSync(path.join(ROOT, 'content/jobs'));
  assert.equal(Object.keys(J.data.versions).length, jobFiles.length);
  for (const f of jobFiles) {
    const raw = readRel(`content/jobs/${f}`);
    const id = JSON.parse(raw).id;
    assert.equal(J.data.versions[id], versionOfText(raw), id);
    const { stage, ...it } = J.data.jobs.find((j) => j.id === id);
    void stage;
    if (J.data.resultTakenDown.includes(id)) assert.notEqual(contentVersion(it), J.data.versions[id], `${id}：資料島沒有名單`);
    else assert.equal(contentVersion(it), J.data.versions[id], id);
  }
  assert.ok(J.data.resultTakenDown.includes(OLD_JOB), '測試資料：至少一筆名單已下架');
  assert.match(J.html, /id="gw-panel"[^>]*hidden/);
  assert.match(J.html, /<ol class="adm-jf-steps" data-gw-hide>/, '有閘道時隱藏「下載後開 PR」的步驟');
  // 採購
  const T = island(tendersTpl, '/admin/tenders/edit/', 'adm-tenders-data');
  for (const f of fs.readdirSync(path.join(ROOT, 'content/tenders'))) {
    const raw = readRel(`content/tenders/${f}`);
    const id = JSON.parse(raw).id;
    assert.equal(T.data.versions[id], versionOfText(raw), id);
    assert.equal(contentVersion(T.data.tenders.find((x) => x.id === id)), T.data.versions[id], id);
  }
  assert.match(T.html, /id="gw-panel"[^>]*hidden/);
});

// ───────────────────────── 閘道：接種時程主檔 ─────────────────────────
test('閘道：主檔送審寫在固定路徑、只改到改的那一筆（其他位元組不動）；一般車道（主檔變更需審核）；審核人看到逐筆逐欄；四眼原則；核准後網站上的主檔更新', async () => {
  const { W, repo, outbox, audit } = makeApi();
  // A 型肝炎第 1 劑本來就有備註：改備註只動到那一行
  const mine = withRow(SCHED, 'sched.hepatitis-a-1', { note: '公費第 1 劑；依 115 年新版時程表更新。' });
  const s1 = await W.saveDraft(P('demo-001'), { master: { ...master(mine), path: '../../etc/passwd' }, baseHash: contentVersion(SCHED) });
  assert.equal(s1.status, 'draft');
  assert.equal(s1.contentId, SCHED_ID);
  assert.equal(s1.type, 'master');
  assert.equal(s1.master, 'immunization-schedule');
  assert.equal(s1.title, MASTER_FILES['immunization-schedule'].title);
  assert.equal(s1.laneLabel, '一般車道');
  assert.ok(
    s1.laneNotes.some((n) => /主檔變更需審核/.test(n)),
    s1.laneNotes.join('｜'),
  );
  assert.equal(s1.contentHash, contentVersion(mine));
  assert.deepEqual(s1.rows, mine);
  const br = lastBranch(repo);
  assert.deepEqual(
    gitOut(repo, ['diff', '--name-only', `main...${br}`])
      .trim()
      .split('\n'),
    [SCHED_REL],
    '只寫主檔的固定路徑',
  );
  const onBranch = show(repo, br, SCHED_REL);
  assert.equal(onBranch, schedJson(mine));
  const changedLines = gitOut(repo, ['diff', '--unified=0', `main...${br}`, '--', SCHED_REL])
    .split('\n')
    .filter((l) => /^[-+]\s/.test(l));
  assert.equal(changedLines.length, 2, `只改了一行（一刪一加）：\n${changedLines.join('\n')}`);
  assert.match(gitOut(repo, ['log', '-1', '--format=%B', br]), /Master-File: immunization-schedule/);
  // 送審（不必再帶主檔：已在送審件裡）
  const sub = await W.submit(P('demo-001'), { submissionId: s1.id }, {});
  assert.equal(sub.status, 'in_review');
  assert.equal(sub.requiredApprovals, 1);
  // 審核人看到的差異：逐筆逐欄、白話；上方說明核准後哪些頁面會變
  const d = await W.diff(P('demo-002'), s1.id);
  assert.equal(d.changes.length, 1);
  assert.equal(d.changes[0].type, 'rows');
  assert.match(d.changes[0].label, /sched\.hepatitis-a-1/);
  assert.match(d.changes[0].text, /備註/);
  assert.match(d.changes[0].rows[0].text, /依 115 年新版時程表更新/);
  assert.match(d.master.text, /時程地圖、表格、問答/);
  assert.doesNotMatch(JSON.stringify(d), GIT_WORDS);
  // 通知：審核人收到的連結到審核頁；承辦人收到的連結回接種時程編輯頁
  assert.ok(outbox().some((m) => /\/admin\/review\/\?item=gw-/.test(m)));
  // 四眼原則：送審的人不能核准；別組的科長不能核准
  await assert.rejects(W.approve(P('demo-001'), { submissionId: s1.id }, {}), (e) => e.status === 403);
  await assert.rejects(W.approve(P('demo-010'), { submissionId: s1.id }, {}), (e) => e.status === 403);
  await W.returnForChanges(P('demo-002'), { submissionId: s1.id, comment: '請補上依據。' }, {});
  assert.ok(
    outbox().some((m) => /\/admin\/vaccines\/schedule\/\?gw=gw-/.test(m)),
    '退回通知連回接種時程編輯頁',
  );
  // 承辦人重新開啟（?gw=）：內容＝送審件裡的整份主檔、版本碼＝它的碼
  const c = await W.contentFor(P('demo-001'), s1.id);
  assert.deepEqual(c.item, mine);
  assert.equal(c.contentHash, contentVersion(mine));
  const mine2 = withRow(mine, 'sched.hepatitis-a-1', { note: '公費第 1 劑；依 115 年新版時程表更新（疾管署 115-01 公告）。' });
  const s2 = await W.submit(P('demo-001'), { master: master(mine2, c.item), submissionId: s1.id, baseHash: contentVersion(c.item) }, {});
  assert.equal(s2.status, 'in_review');
  const done = await W.approve(P('demo-002'), { submissionId: s1.id }, {});
  assert.equal(done.status, 'published');
  assert.equal(show(repo, 'main', SCHED_REL), schedJson(mine2));
  const ap = audit().find((a) => a.action === 'approve' && a.result === 'ok');
  assert.ok(ap, '核准有稽核紀錄');
  assert.equal(ap.contentId, SCHED_ID);
});

test('閘道：兩人同時改主檔——網站上別人改了其他筆（或同一筆其他欄）照樣存、兩邊都在；同一筆同一欄 ⇒ 409（附網站上的主檔與我的值），什麼都不寫', async () => {
  const { W, git, repo } = makeApi();
  await W.ensureReady();
  // 資訊室在 main 上改了 hpv 的備註、mmr-1 的年齡寫法
  const main1 = withRow(withRow(SCHED, 'sched.hpv', { note: '別人改的 HPV 備註' }), 'sched.mmr-1', { ageLabel: '出生滿 12 個月（別人改）' });
  await directEdit(git, SCHED_REL, schedJson(main1));
  // 我依舊版改 mmr-1 的備註與 bcg-1 的已核對
  const mine = withRow(withRow(SCHED, 'sched.mmr-1', { note: '我改的 MMR 備註' }), 'sched.bcg-1', { verified: true });
  const s1 = await W.saveDraft(P('demo-001'), { master: master(mine), baseHash: contentVersion(SCHED) });
  const saved = JSON.parse(show(repo, lastBranch(repo), SCHED_REL));
  assert.equal(row(saved, 'sched.hpv').note, '別人改的 HPV 備註');
  assert.equal(row(saved, 'sched.mmr-1').ageLabel, '出生滿 12 個月（別人改）');
  assert.equal(row(saved, 'sched.mmr-1').note, '我改的 MMR 備註');
  assert.equal(row(saved, 'sched.bcg-1').verified, true);
  assert.deepEqual(s1.rows, saved, '回給編輯頁的是合併後的整份（之後以它為起點）');
  // 同一筆同一欄：網站上的 bcg-1 備註被改了，我（依舊的起點）也改 ⇒ 409 kind master，送審件不動
  const before = show(repo, lastBranch(repo), SCHED_REL);
  await directEdit(git, SCHED_REL, schedJson(withRow(main1, 'sched.bcg-1', { note: '別人改的卡介苗備註' })));
  const mine2 = withRow(saved, 'sched.bcg-1', { note: '我改的卡介苗備註' });
  // 送審件開始後網站上的主檔變了，而且這次改到同一欄：系統不能替我決定
  let err;
  await assert.rejects(W.saveDraft(P('demo-001'), { master: master(mine2, saved), submissionId: s1.id, baseHash: contentVersion(saved) }), (e) => {
    err = e;
    return e.status === 409;
  });
  assert.equal(err.code, 'stale');
  assert.equal(err.extra.stale.kind, 'master');
  assert.equal(err.extra.stale.submissionId, s1.id);
  assert.match(err.message, /卡介苗/);
  assert.match(err.message, /備註/);
  assert.doesNotMatch(err.message, GIT_WORDS);
  const rows = err.extra.stale.master.rows;
  assert.equal(row(rows, 'sched.bcg-1').note, '別人改的卡介苗備註', '附上的是合併後的最新版：先用網站上的');
  assert.equal(row(rows, 'sched.mmr-1').note, '我改的 MMR 備註', '送審件裡的修改還在');
  assert.equal(err.extra.stale.master.conflicts[0].yours.note, '我改的卡介苗備註');
  assert.equal(show(repo, lastBranch(repo), SCHED_REL), before, '什麼都沒寫');
  // 編輯頁「載入最新版」＝以附上的主檔為起點重新套用我的修改；衝突的那一欄我決定後再存 ⇒ 存得進去（另開一版，網站上的更新併進來）
  const m = mergeRows(saved, mine2, rows, DIFF);
  assert.equal(m.conflicts.length, 1);
  const retry = withRow(m.rows, 'sched.bcg-1', { note: '我改的卡介苗備註（已和資訊室確認）' });
  const s3 = await W.saveDraft(P('demo-001'), { master: master(retry, rows), submissionId: s1.id, baseHash: contentVersion(rows) });
  assert.equal(s3.id, s1.id);
  const final = JSON.parse(show(repo, lastBranch(repo), SCHED_REL));
  assert.equal(row(final, 'sched.bcg-1').note, '我改的卡介苗備註（已和資訊室確認）');
  assert.equal(row(final, 'sched.hpv').note, '別人改的 HPV 備註');
  assert.equal(row(final, 'sched.mmr-1').note, '我改的 MMR 備註');
  // 已有進行中的送審件時，另一位依網站版本改、沒指定送審件 ⇒ 409 open（請從那一件繼續），不悄悄寫進那一件
  const tip = show(repo, lastBranch(repo), SCHED_REL);
  await assert.rejects(
    W.saveDraft(P('demo-002'), { master: master(withRow(SCHED, 'sched.je-1', { note: 'x' })), baseHash: contentVersion(SCHED) }),
    (e) => e.status === 409 && e.extra.stale.kind === 'open' && e.extra.stale.submissionId === s1.id && /進行中的送審件/.test(e.message),
  );
  assert.equal(show(repo, lastBranch(repo), SCHED_REL), tip);
  // /current：網站上的主檔、版本碼、進行中的送審件
  const cur = await W.current(P('demo-002'), { contentId: SCHED_ID, type: 'master', base: contentVersion(SCHED) });
  assert.equal(cur.open.id, s1.id);
  assert.deepEqual(cur.item, JSON.parse(show(repo, 'main', SCHED_REL)));
  assert.equal(cur.contentHash, versionOfText(show(repo, 'main', SCHED_REL)));
  assert.equal(cur.stale.kind, 'site');
});

test('閘道：主檔送審期間網站上的主檔變了 ⇒ 不能核准（outdated）；重新開啟時已併入，再送審就能核准，兩邊的修改都在', async () => {
  const { W, git, repo } = makeApi();
  await W.ensureReady();
  const mine = withRow(SCHED, 'sched.je-1', { note: '日本腦炎第 1 劑備註（A）' });
  const s1 = await W.submit(P('demo-001'), { master: master(mine), baseHash: contentVersion(SCHED) }, {});
  assert.equal(s1.status, 'in_review');
  await directEdit(git, SCHED_REL, schedJson(withRow(SCHED, 'sched.zoster', { ageLabel: '50 歲以上（資訊室更正）' })));
  const d = await W.diff(P('demo-002'), s1.id);
  assert.ok(d.outdated, '要說明還不能核准');
  assert.match(d.outdated.text, /主檔|時程/);
  assert.equal(d.changes.length, 1, '下面列的是這個送審件自己改的');
  await assert.rejects(W.approve(P('demo-002'), { submissionId: s1.id }, {}), (e) => e.status === 409);
  await W.returnForChanges(P('demo-002'), { submissionId: s1.id, comment: '網站上的主檔更新了，請重新開啟後再送。' }, {});
  const c = await W.contentFor(P('demo-001'), s1.id);
  assert.ok(c.update, '重新開啟時說明網站上的主檔改了什麼');
  assert.match(c.update.text, /疫苗接種時程表/);
  assert.equal(row(c.item, 'sched.zoster').ageLabel, '50 歲以上（資訊室更正）');
  assert.equal(row(c.item, 'sched.je-1').note, '日本腦炎第 1 劑備註（A）');
  const s2 = await W.submit(P('demo-001'), { master: master(c.item, c.item), submissionId: s1.id, baseHash: contentVersion(c.item) }, {});
  assert.equal(s2.status, 'in_review');
  assert.equal((await W.diff(P('demo-002'), s1.id)).outdated, undefined);
  assert.equal((await W.approve(P('demo-002'), { submissionId: s1.id }, {})).status, 'published');
  const m = JSON.parse(show(repo, 'main', SCHED_REL));
  assert.equal(row(m, 'sched.zoster').ageLabel, '50 歲以上（資訊室更正）');
  assert.equal(row(m, 'sched.je-1').note, '日本腦炎第 1 劑備註（A）');
});

test('閘道：主檔檢查跟 CI 同一套，錯誤說第幾筆哪一欄（不出現 JSON 路徑）；不開放的主檔、格式不對、與內容一起送、版本碼對不上都擋', async () => {
  const { W, api, repo } = makeApi();
  const at = SCHED.findIndex((r) => r.id === 'sched.mmr-1');
  const bad = withRow(withRow(SCHED, 'sched.mmr-1', { vaccine: 'vaccine.zzz' }), 'sched.bcg-1', { stage: 'nope' });
  let err;
  await assert.rejects(W.saveDraft(P('demo-001'), { master: master(bad), baseHash: contentVersion(SCHED) }), (e) => {
    err = e;
    return e.status === 422;
  });
  const msgs = err.fields.map((f) => f.message).join('\n');
  assert.match(msgs, new RegExp(`第 ${at + 1} 筆（.*MMR.*）`));
  assert.match(msgs, /vaccine\.zzz/);
  assert.match(msgs, /不在疫苗主檔/);
  assert.match(msgs, /階段|stage/);
  for (const f of err.fields) assert.doesNotMatch(f.message, /must |instancePath|^\//, f.message);
  // 重複的 id
  await assert.rejects(
    W.saveDraft(P('demo-001'), { master: master([...SCHED, { ...SCHED[0] }]), baseHash: contentVersion(SCHED) }),
    (e) => e.status === 422 && e.fields.some((f) => /重複/.test(f.message)),
  );
  // 不開放的主檔（例：單位主檔）
  await assert.rejects(W.saveDraft(P('demo-001'), { master: { name: 'units', items: [], start: [] }, baseHash: NEW_VERSION }), (e) => e.status === 422);
  // 版本碼和起點對不上
  await assert.rejects(
    W.saveDraft(P('demo-001'), { master: master(SCHED, SCHED.slice(1)), baseHash: contentVersion(SCHED) }),
    (e) => e.status === 400 && e.code === 'bad_master',
  );
  // 別組不能改急性傳染病組的主檔
  await assert.rejects(
    W.saveDraft(P('demo-009'), { master: master(withRow(SCHED, 'sched.bcg-1', { note: 'x' })), baseHash: contentVersion(SCHED) }),
    (e) => e.status === 403,
  );
  assert.deepEqual(branches(repo), []);
  // HTTP：格式不對、與內容一起送 ⇒ 400；正常的照收
  const call = httpOf(api, 'demo-001');
  for (const body of [
    { master: { name: 'immunization-schedule', items: 'x', start: [] } },
    { master: { name: '../units', items: [], start: [] } },
    { master: master(SCHED), item: fileItem(JOB_REL) },
    { master: { name: 'immunization-schedule', items: Array.from({ length: 401 }, (_, i) => ({ id: `x${i}` })), start: [] } },
  ]) {
    const r = await call('POST', '/api/gateway/drafts', body);
    assert.equal(r.status, 400, JSON.stringify(body).slice(0, 80));
    assert.equal(r.body.error, 'bad_master');
  }
  const ok = await call('POST', '/api/gateway/drafts', { master: master(withRow(SCHED, 'sched.bcg-1', { note: 'HTTP' })), baseHash: contentVersion(SCHED) });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(row(ok.body.rows, 'sched.bcg-1').note, 'HTTP');
  const cur = await call('GET', `/api/gateway/current?contentId=${SCHED_ID}&type=master`);
  assert.equal(cur.status, 200);
  assert.equal(cur.body.open.id, ok.body.id);
  const pv = await call('GET', `/api/gateway/items/${ok.body.id}/preview`);
  assert.equal(pv.status, 200);
  assert.match(String(pv.body), /<table/);
  assert.match(String(pv.body), /卡介苗/);
});

// ───────────────────────── 閘道：職缺與採購 ─────────────────────────
test('閘道：職缺的甄選結果照個資規則擋（姓名、身分證字號、沒有下架日），錯誤歸在「甄選結果」並說白話', async () => {
  const { W, repo } = makeApi();
  const job = fileItem(JOB_REL);
  const base = { baseHash: contentVersion(job) };
  const reject = async (item, re) => {
    let err;
    await assert.rejects(W.saveDraft(P('demo-007'), { item, ...base }), (e) => {
      err = e;
      return e.status === 422;
    });
    assert.ok(
      err.fields.some((f) => f.field === 'result' && re.test(f.message)),
      err.fields.map((f) => `${f.field}：${f.message}`).join('\n'),
    );
    for (const f of err.fields) {
      assert.doesNotMatch(f.message, /must |instancePath/, f.message);
      assert.notEqual(f.label, 'result', '欄位名稱要是中文');
    }
    return err;
  };
  // 名單放姓名
  await reject({ ...job, result: { ...job.result, admitted: [{ seq: 1, candidateNo: '1150810-006', name: '王小明' }] } }, /個資閘門.*name 欄位/);
  // 報名編號欄位填了身分證字號
  await reject({ ...job, result: { ...job.result, admitted: [{ seq: 1, candidateNo: 'A123456789' }] } }, /個資閘門/);
  // 沒有下架日
  const { unpublishAt, ...noUnpub } = job.result;
  void unpublishAt;
  const e3 = await reject({ ...job, result: noUnpub }, /下架日/);
  assert.ok(e3.fields.some((f) => /「甄選結果」少了「下架日」/.test(f.message)));
  assert.deepEqual(branches(repo), [], '什麼都沒寫');
  // 合規的修改（只改備註）存得進去
  const s = await W.saveDraft(P('demo-007'), { item: { ...job, result: { ...job.result, note: `${job.result.note}（更正報到地點）` } }, ...base });
  assert.equal(s.status, 'draft');
  // 職缺與採購的跨欄位檢查也歸到欄位
  assert.deepEqual(plainError('award.date 2026-10-14 早於開標日 2026-10-23'), {
    field: 'award',
    label: '決標資訊',
    message: '「決標資訊的日期」2026-10-14 早於開標日 2026-10-23',
  });
  assert.equal(plainError('applyStart 2026-10-01 晚於 deadlineAt 2026-09-01').message, '「報名開始日」2026-10-01 晚於 截止日 2026-09-01');
  assert.equal(plainError('hiringUnit unit.x 不在 units 主檔').field, 'hiringUnit');
});

test('閘道：職缺送審（人事室）走一般車道、公關室核准；審核人看到逐欄逐筆的差異（異動紀錄、甄試日程）；別單位不能改', async () => {
  const { W, repo } = makeApi();
  const job = fileItem(JOB2_REL);
  const changed = {
    ...job,
    title: `${job.title}（延長報名）`,
    deadlineAt: '2026-10-30',
    amendments: [...(job.amendments ?? []), { date: TODAY, kind: 'extend', text: '報名截止延至 10 月 30 日。' }],
  };
  // 秘書室不能改人事室的職缺
  await assert.rejects(W.saveDraft(P('demo-008'), { item: changed, baseHash: contentVersion(job) }), (e) => e.status === 403);
  const s = await W.submit(P('demo-007'), { item: changed, baseHash: contentVersion(job) }, {});
  assert.equal(s.status, 'in_review');
  assert.equal(s.laneLabel, '一般車道');
  assert.ok(s.laneNotes.length);
  assert.equal(s.contentHash, contentVersion(changed));
  const d = await W.diff(P('demo-004'), s.id);
  const by = Object.fromEntries(d.changes.map((c) => [c.field, c]));
  assert.deepEqual(Object.keys(by).sort(), ['amendments', 'deadlineAt', 'title']);
  assert.equal(by.title.label, '標題');
  assert.equal(by.amendments.label, '異動紀錄');
  assert.equal(by.amendments.type, 'rows');
  assert.deepEqual(
    by.amendments.rows.map((r) => [r.kind, r.text]),
    [['added', `${TODAY} 展延：報名截止延至 10 月 30 日。`]],
  );
  assert.equal(by.deadlineAt.label, '截止日');
  assert.doesNotMatch(JSON.stringify(d), GIT_WORDS);
  assert.doesNotMatch(JSON.stringify(d), /\{"date"|\[object/);
  await assert.rejects(W.approve(P('demo-007'), { submissionId: s.id }, {}), (e) => e.status === 403);
  assert.equal((await W.approve(P('demo-004'), { submissionId: s.id }, {})).status, 'published');
  const m = JSON.parse(show(repo, 'main', JOB2_REL));
  assert.equal(m.deadlineAt, '2026-10-30');
  assert.equal(m.amendments.at(-1).kind, 'extend');
});

test('閘道：採購送審（秘書室）；審核人看到異動紀錄與決標資訊逐筆、逐欄；甄選結果的名單也逐筆', async () => {
  const { W, repo } = makeApi();
  const ten = fileItem(TEN_REL);
  const changed = {
    ...ten,
    amendments: [...ten.amendments, { date: TODAY, kind: 'correction', text: '更正履約期限。', refNo: '疾管秘字第 1150000123 號' }],
    award: { date: ten.openingAt, winner: '某某影音製作有限公司', amountNtd: 1880000 },
  };
  // 人事室不能改秘書室的標案
  await assert.rejects(W.saveDraft(P('demo-007'), { item: changed, baseHash: contentVersion(ten) }), (e) => e.status === 403);
  const s = await W.submit(P('demo-008'), { item: changed, baseHash: contentVersion(ten) }, {});
  const d = await W.diff(P('demo-004'), s.id);
  const by = Object.fromEntries(d.changes.map((c) => [c.field, c]));
  assert.deepEqual(Object.keys(by).sort(), ['amendments', 'award']);
  assert.equal(by.award.label, '決標資訊');
  assert.equal(by.award.type, 'rows');
  const awardText = by.award.rows.map((r) => r.text).join('\n');
  assert.match(awardText, /得標廠商.*某某影音製作有限公司/);
  assert.match(awardText, /決標日/);
  assert.match(by.amendments.rows[0].text, /更正：更正履約期限。（疾管秘字第 1150000123 號）/);
  // 送審的人（秘書室，有審核角色）不能自己核准
  await assert.rejects(W.approve(P('demo-008'), { submissionId: s.id }, {}), (e) => e.status === 403);
  assert.equal((await W.approve(P('demo-004'), { submissionId: s.id }, {})).status, 'published');
  assert.equal(JSON.parse(show(repo, 'main', TEN_REL)).award.winner, '某某影音製作有限公司');
  // 職缺的甄選名單：逐筆說新增、刪除哪一位（報名編號）
  const job = fileItem(JOB_REL);
  const s2 = await W.saveDraft(P('demo-007'), {
    item: { ...job, result: { ...job.result, waitlist: job.result.waitlist.slice(1) } },
    baseHash: contentVersion(job),
  });
  const d2 = await W.diff(P('demo-004'), s2.id);
  const res = d2.changes.find((c) => c.field === 'result');
  assert.equal(res.type, 'rows');
  assert.match(res.rows.map((r) => r.text).join('\n'), /1150810-002/);
});

test('閘道：編輯頁的連結依型別回到自己的編輯頁（職缺、採購、接種時程）', async () => {
  const { W, outbox } = makeApi();
  const job = fileItem(JOB2_REL);
  const s = await W.submit(P('demo-007'), { item: { ...job, summary: `${job.summary}（補充）` }, baseHash: contentVersion(job) }, {});
  await W.returnForChanges(P('demo-004'), { submissionId: s.id, comment: '請再確認。' }, {});
  assert.ok(outbox().some((m) => m.includes(`/admin/jobs/edit/?gw=${s.id}`)));
  const ten = fileItem(TEN_REL);
  const t = await W.submit(P('demo-008'), { item: { ...ten, summary: `${ten.summary}（補充）` }, baseHash: contentVersion(ten) }, {});
  await W.returnForChanges(P('demo-004'), { submissionId: t.id, comment: '請再確認。' }, {});
  assert.ok(outbox().some((m) => m.includes(`/admin/tenders/edit/?gw=${t.id}`)));
});

// ───────────────────────── 沒帶版本碼的存檔：預設照收、稽核記下；開關打開才拒絕 ─────────────────────────
test('沒帶版本碼：預設照舊接受、稽核記 baseHash: missing；GATEWAY_REQUIRE_BASE_HASH=1 時拒絕（428，白話），閘道自己的動作不受影響', async () => {
  assert.equal(configFromEnv({}).requireBaseHash, false, '預設不拒絕');
  assert.equal(configFromEnv({ GATEWAY_REQUIRE_BASE_HASH: '1' }).requireBaseHash, true);
  assert.equal(configFromEnv({ GATEWAY_REQUIRE_BASE_HASH: 'true' }).requireBaseHash, false, '只認 1（避免打錯字就整個鎖住）');
  const job = fileItem(JOB2_REL);
  {
    const { W, audit } = makeApi();
    const s = await W.saveDraft(P('demo-007'), { item: { ...job, summary: `${job.summary}（舊頁面）` } });
    assert.equal(s.status, 'draft');
    assert.equal(audit().find((a) => a.action === 'save-draft' && a.result === 'ok').baseHash, 'missing');
    const m = await W.saveDraft(P('demo-001'), { master: master(withRow(SCHED, 'sched.bcg-1', { note: '舊頁面' })) });
    assert.equal(m.status, 'draft');
    assert.equal(
      audit()
        .filter((a) => a.action === 'save-draft' && a.result === 'ok')
        .at(-1).baseHash,
      'missing',
    );
    const ok = await W.saveDraft(P('demo-007'), { item: { ...job, summary: `${job.summary}（新頁面）` }, submissionId: s.id, baseHash: s.contentHash });
    assert.equal(
      audit()
        .filter((a) => a.action === 'save-draft' && a.result === 'ok')
        .at(-1).baseHash,
      undefined,
      '有帶就不記',
    );
    void ok;
  }
  {
    const { W, api, repo } = makeApi({ requireBaseHash: true });
    for (const args of [
      [P('demo-007'), { item: { ...job, summary: '沒帶版本碼。' } }],
      [P('demo-001'), { master: master(withRow(SCHED, 'sched.bcg-1', { note: 'x' })) }],
    ]) {
      await assert.rejects(
        W.saveDraft(...args),
        (e) => e.status === 428 && e.code === 'version_required' && /重新整理頁面/.test(e.message) && !GIT_WORDS.test(e.message),
      );
      await assert.rejects(W.submit(...args, {}), (e) => e.status === 428);
    }
    assert.deepEqual(branches(repo), []);
    // 有帶就照常；送審件已在系統裡、「不用修改，再送出」不必帶
    const s = await W.saveDraft(P('demo-007'), { item: { ...job, summary: `${job.summary}（有帶）` }, baseHash: contentVersion(job) });
    assert.equal((await W.submit(P('demo-007'), { submissionId: s.id }, {})).status, 'in_review');
    // HTTP：格式不對的版本碼＝沒帶 ⇒ 428
    const r = await httpOf(api, 'demo-008')('POST', '/api/gateway/drafts', { item: { ...fileItem(TEN_REL), summary: 'x' }, baseHash: '<script>' });
    assert.equal(r.status, 428);
    assert.equal(r.body.error, 'version_required');
  }
});

// ───────────────────────── 慢性傳染病組的示範帳號 ─────────────────────────
test('示範帳號：慢性傳染病組有承辦人與科長（與急性傳染病組同一個配置），閘道的群組由同一份名單推出', async () => {
  const ed = acct('demo-009'),
    rv = acct('demo-010');
  assert.equal(ed.unit, 'unit.chronic-infectious');
  assert.deepEqual(ed.roles, ['editor']);
  assert.equal(rv.unit, 'unit.chronic-infectious');
  assert.deepEqual(rv.roles, ['editor', 'reviewer']);
  assert.deepEqual(
    DEMO_ACCOUNTS.filter((a) => a.unit === 'unit.acute-infectious').map((a) => a.roles),
    DEMO_ACCOUNTS.filter((a) => a.unit === 'unit.chronic-infectious').map((a) => a.roles),
  );
  assert.equal(new Set(DEMO_ACCOUNTS.map((a) => a.sub)).size, DEMO_ACCOUNTS.length);
  assert.ok(site.master.units.some((u) => u.id === 'unit.chronic-infectious'));
  assert.ok(canAccess(makeSession(ed), 'publish'));
  const pe = P('demo-009'),
    pr = P('demo-010');
  assert.deepEqual(pe.units, ['unit.chronic-infectious']);
  assert.ok(pr.roles.includes('審核'));
  // 承辦人存草稿、送審；不能自己核准；同組科長可以
  const { W, repo } = makeApi();
  const rel = 'content/faq/tb-cough-two-weeks.json';
  const faq = fileItem(rel);
  assert.equal(faq.owner, 'unit.chronic-infectious');
  const s = await W.submit(pe, { item: { ...faq, summary: `${faq.summary}` + '（慢性組更新）' }, baseHash: contentVersion(faq) }, {});
  assert.equal(s.status, 'in_review');
  await assert.rejects(W.approve(pe, { submissionId: s.id }, {}), (e) => e.status === 403);
  await assert.rejects(W.approve(P('demo-002'), { submissionId: s.id }, {}), (e) => e.status === 403, '急性組的科長不能核准慢性組的內容');
  const r = await W.approve(pr, { submissionId: s.id }, {});
  assert.ok(['published', 'in_review'].includes(r.status), r.status);
  if (r.status === 'in_review') assert.equal((await W.approve(P('demo-004'), { submissionId: s.id }, {})).status, 'published');
  assert.match(JSON.parse(show(repo, 'main', rel)).summary, /慢性組更新/);
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
async function loadPlaywright() {
  try {
    return (await import('playwright')).chromium;
  } catch {
    try {
      return (await import('/opt/node22/lib/node_modules/playwright/index.mjs')).chromium;
    } catch {
      return null;
    }
  }
}

/** 起一個真的閘道（scripts/serve.mjs）＋ Chromium；回傳工具，用完 close() */
async function startE2E(t, marker) {
  const js = path.join(DIST, `assets/js/admin/${marker.file}`);
  if (!fs.existsSync(js)) return t.skip('dist 尚未建置');
  if (!fs.readFileSync(js, 'utf8').includes(marker.global)) return t.skip('dist 是舊版（請重新建置）');
  const chromium = await loadPlaywright();
  if (!chromium) return t.skip('沒有 Playwright');
  if (!fs.existsSync(CHROME)) return t.skip('沒有 Chromium');
  const d = tmpDir('r53-e2e-');
  const repo = path.join(d, 'repo');
  const port = await freePort();
  const env = {
    ...distEnv(DIST),
    GATEWAY_REPO_DIR: repo,
    GATEWAY_SEED_DIR: makeSeed(),
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
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(`${base}/api/gateway/health`)).ok) break;
    } catch {
      /* 等伺服器 */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
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
    page.on('dialog', (dlg) => dlg.accept());
    page.on('console', (m) => {
      if (m.type() === 'error' && !/Failed to load resource|Blocked script execution in 'about:srcdoc'/.test(m.text())) errors.push(`${sub}: ${m.text()}`);
    });
    return page;
  }
  const ready = async (page) => {
    await page.waitForFunction((g) => !!window[g], marker.global, { timeout: 20000 });
    await page.waitForFunction(() => document.body.classList.contains('adm-gw') && document.querySelector('#gw-state')?.textContent, null, { timeout: 15000 });
    await page.waitForTimeout(400); // 開啟時的版本檢查跑完
  };
  const syncText = (page) => page.evaluate(() => document.querySelector('#gw-sync')?.textContent ?? '');
  const waitSync = (page, re) =>
    page.waitForFunction((src) => new RegExp(src).test(document.querySelector('#gw-sync')?.textContent ?? ''), re.source, { timeout: 20000 });
  const waitStatus = (page, re) =>
    page.waitForFunction(
      (src) => new RegExp(src).test(document.querySelector('#gw-status')?.textContent ?? '') && !document.querySelector('#gw-save').disabled,
      re.source,
      { timeout: 20000 },
    );
  const waitSubmitted = (page) => page.waitForFunction(() => /已送審/.test(document.querySelector('#gw-status')?.textContent ?? ''), null, { timeout: 20000 });
  const sidOf = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('cdc.admin.gwCurrent') ?? 'null')?.sid);
  const reload = (page) => page.click('#gw-sync button.adm-btn--sm:not(.adm-btn--ghost)');
  /** 審核人開啟審核頁、看差異、核准 */
  async function review(sub, sid, diffRe) {
    const pr = await as(sub);
    await pr.goto(`${base}/admin/review/?item=${sid}`);
    await pr.waitForFunction((src) => new RegExp(src).test(document.querySelector('#gw-diff')?.textContent ?? ''), diffRe.source, { timeout: 20000 });
    const text = await pr.textContent('#gw-diff');
    await pr.waitForFunction(() => !document.querySelector('#gw-approve')?.disabled, null, { timeout: 20000 });
    await pr.click('#gw-approve');
    await pr.waitForFunction(() => /已上線/.test(document.querySelector('#gw-act-msg')?.textContent ?? ''), null, { timeout: 20000 });
    await pr.context().close();
    return text;
  }
  const git = createLocalGit({ dir: repo });
  return {
    base,
    repo,
    git,
    errors,
    as,
    ready,
    syncText,
    waitSync,
    waitStatus,
    waitSubmitted,
    sidOf,
    reload,
    review,
    onBranch: (rel) => show(repo, lastBranch(repo), rel),
    async close() {
      await browser.close();
      srv.kill();
      if (stderr.trim() && process.env.DEBUG_E2E) console.error(stderr);
    },
  };
}

test(
  '端到端（職缺編輯頁＋真的閘道）：存草稿；別人先改了 ⇒ 409、載入最新版保留我的修改；送審、審核人看到逐欄差異、核准上線；?gateway=off 照舊只下載',
  { timeout: 180000 },
  async (t) => {
    const E = await startE2E(t, { file: 'jobs-edit.js', global: '__admJobs' });
    if (!E) return;
    try {
      const job = fileItem(JOB2_REL);
      const p = await E.as('demo-007');
      await p.goto(`${E.base}/admin/jobs/edit/?id=${JOB2}`);
      await E.ready(p);
      assert.equal(await E.syncText(p), '', '剛開啟、沒有別人在改：沒有提醒');
      assert.equal(await p.evaluate(() => window.__admJobs.getBaseHash()), versionOfText(readRel(JOB2_REL)));
      assert.equal(await p.isVisible('#gw-panel'), true);
      assert.equal(await p.isVisible('.adm-jf-steps'), false, '有閘道時不顯示「下載後開 PR」的步驟');
      // ① 改摘要、存草稿
      await p.fill('#jf-summary', `${job.summary}（人事室補充說明）`);
      await p.waitForFunction(() => /summary/.test(document.querySelector('#jf-changed')?.dataset.changed ?? ''), null, { timeout: 15000 });
      await p.click('#gw-save');
      await E.waitStatus(p, /已儲存草稿/);
      let f = JSON.parse(E.onBranch(JOB2_REL));
      assert.match(f.summary, /人事室補充說明/);
      assert.equal(f.title, job.title);
      // ② 資訊室直接改了 main 上的工作地點（送審件開始之後）；我再改標題存檔 ⇒ 系統把網站上的更新併進來（不同欄位，不衝突）
      //    但這一頁開啟的是舊版本 ⇒ 先擋下（409），載入最新版：工作地點是別人的、標題與摘要是我的
      await E.git.commit({
        branch: 'main',
        files: [{ path: JOB2_REL, content: `${JSON.stringify({ ...job, workplace: `${job.workplace}（資訊室更正）` }, null, 2)}\n` }],
        message: '資訊室直接更新\n',
        author: SERVICE_IDENTITY,
      });
      // 另一位同事在同一個送審件裡又存了一版（改了薪資）
      const sid = await E.sidOf(p);
      const p2 = await E.as('demo-007');
      await p2.goto(`${E.base}/admin/jobs/edit/?gw=${sid}`);
      await p2.waitForFunction(() => window.__admJobs?.source === 'gateway', null, { timeout: 20000 });
      await E.ready(p2);
      await p2.fill('#jf-salary', '依公費醫師待遇標準支給（同事更正）');
      await p2.waitForTimeout(300);
      await p2.click('#gw-save');
      await E.waitStatus(p2, /已儲存草稿/);
      await p2.context().close();
      await p.fill('#jf-title', `${job.title}（第二次公告）`);
      await p.waitForTimeout(300);
      await p.click('#gw-save');
      await E.waitSync(p, /還沒有存|又有人存過|已經更新/);
      assert.doesNotMatch(await E.syncText(p), GIT_WORDS);
      assert.doesNotMatch(E.onBranch(JOB2_REL), /第二次公告/, '被擋時什麼都沒寫');
      await E.reload(p);
      await E.waitSync(p, /已載入最新版/);
      assert.match(await E.syncText(p), /你的修改已重新套用：.*標題/);
      assert.equal(await p.inputValue('#jf-title'), `${job.title}（第二次公告）`);
      assert.match(await p.inputValue('#jf-summary'), /人事室補充說明/);
      assert.equal(await p.inputValue('#jf-salary'), '依公費醫師待遇標準支給（同事更正）');
      assert.match(await p.inputValue('#jf-workplace'), /資訊室更正/);
      await p.click('#gw-save');
      await E.waitStatus(p, /已儲存草稿/);
      f = JSON.parse(E.onBranch(JOB2_REL));
      assert.match(f.title, /第二次公告/);
      assert.match(f.summary, /人事室補充說明/);
      assert.match(f.salaryNote, /同事更正/);
      assert.match(f.workplace, /資訊室更正/);
      // ③ 送審 → 公關室看到逐欄差異 → 核准上線
      await p.click('#gw-submit');
      await E.waitSubmitted(p);
      const diffText = await E.review('demo-004', sid, /標題/);
      assert.match(diffText, /摘要/);
      assert.match(diffText, /薪資待遇/);
      assert.doesNotMatch(diffText, /workplace|salaryNote|\{"/);
      const m = JSON.parse(show(E.repo, 'main', JOB2_REL));
      assert.match(m.title, /第二次公告/);
      assert.match(m.workplace, /資訊室更正/);
      // ④ 沒有閘道（?gateway=off）：面板不出現，下載步驟照舊
      const off = await E.as('demo-007');
      await off.goto(`${E.base}/admin/jobs/edit/?id=${JOB}&gateway=off`);
      await off.waitForFunction(() => !!window.__admJobs, null, { timeout: 20000 });
      await off.waitForTimeout(500);
      assert.equal(await off.isVisible('#gw-panel'), false);
      assert.equal(await off.isVisible('.adm-jf-steps'), true);
      assert.equal(await off.isVisible('#jf-dl'), true);
      assert.match(await off.textContent('#jf-out'), new RegExp(JOB.replace(/\./g, '\\.')));
      await off.context().close();
      assert.deepEqual(E.errors, []);
    } finally {
      await E.close();
    }
  },
);

test(
  '端到端（採購編輯頁＋真的閘道）：開啟後別人先上線 ⇒ 存檔被擋、載入最新版保留我的修改（含我加的異動紀錄）；送審、審核人看到異動紀錄逐筆、核准',
  { timeout: 180000 },
  async (t) => {
    const E = await startE2E(t, { file: 'tenders-edit.js', global: '__admTenders' });
    if (!E) return;
    try {
      const ten = fileItem(TEN_REL);
      const p = await E.as('demo-008');
      await p.goto(`${E.base}/admin/tenders/edit/?id=${TEN}`);
      await E.ready(p);
      assert.equal(await p.evaluate(() => window.__admTenders.getBaseHash()), versionOfText(readRel(TEN_REL)));
      // 我：加一筆異動紀錄（只寫說明的更正）、改聯絡窗口
      await p.fill('#tf-contact', '秘書室 王小姐 (02)2395-9825 #1234');
      await p.fill('#tf-am-text', '更正聯絡窗口分機。');
      await p.click('#tf-am-add');
      await p.waitForTimeout(300);
      // 別人：從網站版本改了採購範圍，送審、核准上線（我開啟之後）
      const q = await E.as('demo-008');
      await q.goto(`${E.base}/admin/tenders/edit/?id=${TEN}`);
      await E.ready(q);
      await q.fill('#tf-terms', [...(ten.specialTerms ?? []), '得標廠商應於簽約後 7 日內提出工作計畫。'].join('\n'));
      await q.waitForTimeout(300);
      await q.click('#gw-submit');
      await E.waitSubmitted(q);
      const sidQ = await E.sidOf(q);
      await q.context().close();
      await E.review('demo-004', sidQ, /特別條款/);
      // 我存檔 ⇒ 被擋（網站上已更新），什麼都沒寫
      await p.click('#gw-save');
      await E.waitSync(p, /已經更新/);
      assert.match(await E.syncText(p), /劉○君/);
      for (const b of branches(E.repo)) assert.doesNotMatch(show(E.repo, b, TEN_REL), /#1234/, '我的舊版沒有寫進系統');
      // 載入最新版：特別條款是別人的；我的聯絡窗口與異動紀錄都還在，異動紀錄仍是「本次新增」（可以移除）
      await E.reload(p);
      await E.waitSync(p, /已載入最新版/);
      assert.match(await p.inputValue('#tf-terms'), /7 日內提出工作計畫/);
      assert.equal(await p.inputValue('#tf-contact'), '秘書室 王小姐 (02)2395-9825 #1234');
      assert.equal(await p.locator('#tf-amends li.is-new').count(), 1);
      assert.match(await p.textContent('#tf-amends li.is-new'), /更正聯絡窗口分機/);
      assert.equal(await p.evaluate(() => window.__admTenders.getBaseHash()), versionOfText(show(E.repo, 'main', TEN_REL)));
      await p.click('#gw-submit');
      await E.waitSubmitted(p);
      const sid = await E.sidOf(p);
      const diffText = await E.review('demo-004', sid, /異動紀錄/);
      assert.match(diffText, /更正：更正聯絡窗口分機。/);
      assert.match(diffText, /聯絡窗口/);
      assert.doesNotMatch(diffText, /特別條款/, '別人已上線的修改不算這一件改的');
      const m = JSON.parse(show(E.repo, 'main', TEN_REL));
      assert.ok(m.specialTerms.some((s) => /7 日內/.test(s)));
      assert.equal(m.contact, '秘書室 王小姐 (02)2395-9825 #1234');
      assert.equal(m.amendments.at(-1).text, '更正聯絡窗口分機。');
      assert.equal(m.amendments.length, ten.amendments.length + 1);
      assert.deepEqual(E.errors, []);
    } finally {
      await E.close();
    }
  },
);

test(
  '端到端（接種時程編輯頁＋真的閘道）：存草稿；別人同時改了同一筆同一欄 ⇒ 409、載入最新版保留我其他的修改；送審、審核人看到逐筆差異、核准；網站上的主檔兩邊的修改都在',
  { timeout: 180000 },
  async (t) => {
    const E = await startE2E(t, { file: 'vaxschedule-edit.js', global: '__admVx' });
    if (!E) return;
    try {
      const p = await E.as('demo-001');
      await p.goto(`${E.base}/admin/vaccines/schedule/?id=sched.bcg-1`);
      await E.ready(p);
      assert.equal(await E.syncText(p), '');
      assert.equal(await p.evaluate(() => window.__admVx.source), 'site');
      // ① 改卡介苗的備註、存草稿：只寫那一行
      await p.fill('#vx-note', '卡介苗備註（A 改）');
      await p.waitForTimeout(300);
      await p.click('#gw-save');
      await E.waitStatus(p, /已儲存草稿/);
      let f = JSON.parse(E.onBranch(SCHED_REL));
      assert.equal(row(f, 'sched.bcg-1').note, '卡介苗備註（A 改）');
      assert.equal(E.onBranch(SCHED_REL), schedJson(withRow(SCHED, 'sched.bcg-1', { note: '卡介苗備註（A 改）' })));
      const sid = await E.sidOf(p);
      // ② 我接著改 HPV 的年齡寫法與卡介苗的備註；同時資訊室在網站上改了卡介苗備註（同一欄）與 MMR 的備註（別筆）
      await p.evaluate(() => window.__admVx.select(window.__admVx.items.findIndex((i) => i.id === 'sched.hpv')));
      await p.fill('#vx-ageLabel', '國一女生、男生（A 改）');
      await p.evaluate(() => window.__admVx.select(window.__admVx.items.findIndex((i) => i.id === 'sched.bcg-1')));
      await p.fill('#vx-note', '卡介苗備註（A 第二次改）');
      await p.waitForTimeout(300);
      await E.git.commit({
        branch: 'main',
        files: [
          {
            path: SCHED_REL,
            content: schedJson(withRow(withRow(SCHED, 'sched.bcg-1', { note: '卡介苗備註（資訊室改）' }), 'sched.mmr-1', { note: 'MMR 備註（資訊室改）' })),
          },
        ],
        message: '資訊室直接更新\n',
        author: SERVICE_IDENTITY,
      });
      await p.click('#gw-save');
      await E.waitSync(p, /卡介苗/);
      assert.match(await E.syncText(p), /已經有人改過|已經更新/);
      assert.doesNotMatch(await E.syncText(p), GIT_WORDS);
      assert.equal(row(JSON.parse(E.onBranch(SCHED_REL)), 'sched.hpv').ageLabel, row(SCHED, 'sched.hpv').ageLabel, '衝突時什麼都沒寫');
      // 載入最新版：卡介苗備註先用網站上的、列出我的值；HPV 我的修改還在；MMR 是資訊室的
      await E.reload(p);
      await E.waitSync(p, /已載入最新版/);
      const merged = await E.syncText(p);
      assert.match(merged, /兩邊都改了/);
      assert.match(merged, /卡介苗備註（A 第二次改）/);
      const st = await p.evaluate(() => ({ items: window.__admVx.items, out: window.__admVx.exported() }));
      assert.equal(row(st.out, 'sched.bcg-1').note, '卡介苗備註（資訊室改）');
      assert.equal(row(st.out, 'sched.hpv').ageLabel, '國一女生、男生（A 改）');
      assert.equal(row(st.out, 'sched.mmr-1').note, 'MMR 備註（資訊室改）');
      assert.equal(await p.inputValue('#vx-note'), '卡介苗備註（資訊室改）', '目前這一筆的表單也換成最新版');
      // 我決定：卡介苗備註用兩邊合併的寫法，再送審
      await p.fill('#vx-note', '卡介苗備註（資訊室改；A 補充）');
      await p.waitForTimeout(300);
      await p.click('#gw-submit');
      await E.waitSubmitted(p);
      assert.equal(await E.sidOf(p), sid, '同一個送審件');
      f = JSON.parse(E.onBranch(SCHED_REL));
      assert.equal(row(f, 'sched.bcg-1').note, '卡介苗備註（資訊室改；A 補充）');
      assert.equal(row(f, 'sched.mmr-1').note, 'MMR 備註（資訊室改）');
      assert.equal(row(f, 'sched.hpv').ageLabel, '國一女生、男生（A 改）');
      // ③ 同組科長看到逐筆差異（主檔修改的說明、改了哪一筆哪一欄）並核准
      const diffText = await E.review('demo-002', sid, /sched\.hpv/);
      assert.match(diffText, /主檔/);
      assert.match(diffText, /年齡（人看的寫法）/);
      assert.match(diffText, /卡介苗/);
      assert.doesNotMatch(diffText, /MMR 備註（資訊室改）/, '資訊室已上線的修改不算這一件改的');
      const m = JSON.parse(show(E.repo, 'main', SCHED_REL));
      assert.equal(row(m, 'sched.bcg-1').note, '卡介苗備註（資訊室改；A 補充）');
      assert.equal(row(m, 'sched.mmr-1').note, 'MMR 備註（資訊室改）');
      assert.equal(row(m, 'sched.hpv').ageLabel, '國一女生、男生（A 改）');
      // ④ 沒有閘道：面板不出現，匯出照舊
      const off = await E.as('demo-001');
      await off.goto(`${E.base}/admin/vaccines/schedule/?gateway=off`);
      await off.waitForFunction(() => !!window.__admVx, null, { timeout: 20000 });
      await off.waitForTimeout(500);
      assert.equal(await off.isVisible('#gw-panel'), false);
      assert.equal(await off.isVisible('#vx-dl'), true);
      await off.context().close();
      assert.deepEqual(E.errors, []);
    } finally {
      await E.close();
    }
  },
);
