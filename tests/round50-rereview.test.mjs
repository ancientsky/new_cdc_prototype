// 第五十輪：重新審閱（到期內容由權責單位確認仍正確，經審核核准後更新最後審閱日、回到 AI 白名單）。
//   問題（Yulun）：「目前 prototype 網站重新審閱的流程可以實際運作嗎？」——改之前：/admin/due/ 的按鈕只寫 localStorage；
//   閘道雖然在核准上線時會把 reviewedAt 改成今天，但沒有「內容不改、只確認」的動作（只能從上架頁重新匯出，表單會改到摘要、關鍵字、譯文狀態），
//   審核人與稽核也看不出這是重新審閱。這裡測新的 workflow.reReview／POST /api/gateway/rereview：
//   - 內容不改 → 送審 → 第二位、有權限的審核人核准 → main 上只有 reviewedAt 變成今天；稽核標明 rereview、contentChanged: false
//   - 四眼原則（送出的人不能核准）、角色、別單位審核人被擋、車道（一級內容加 OASIS 審核人；核准數照車道設定）
//   - 核准後的版本放回站台重算治理：不再逾期、回到 AI 白名單；BUILD_TODAY 凍結日期時 overdueAsOf 列出被藏起來的逾期
//   - 沒有閘道（GitHub Pages）時 /admin/due/ 維持示範按鈕，並明說它不會改變任何內容
//   端到端（有 dist 與 Chromium 才跑）：/admin/due/ 送出重新審閱 → /admin/review/ 核准 → /admin/due/ 顯示已重新審閱；?gateway=off 回到示範。
import { govern, distBasePath, distEnv } from './helpers.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { adGroupsOf, makeSession, DEMO_ACCOUNTS } from '../src/client/admin/auth-rules.js';
import { principalFrom, createHeaderAuth, normAccount } from '../scripts/lib/gateway/auth.mjs';
import { createValidator } from '../scripts/lib/gateway/validate-item.mjs';
import { createLocalGit } from '../scripts/lib/gateway/git-local.mjs';
import { createGatewayApi } from '../scripts/lib/gateway/index.mjs';
import { verifyAudit } from '../scripts/lib/gateway/store.mjs';
import { loadLanes, taipeiDate } from '../scripts/lib/lanes.mjs';
import { overdueAsOf } from '../scripts/lib/governance.mjs';
import { parseEml } from '../scripts/lib/mail-outbox.mjs';
import { makeCtx } from '../scripts/lib/pages.mjs';
import * as due from '../src/templates/admin/due.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmpDir = (p = 'rr-') => fs.mkdtempSync(path.join(os.tmpdir(), p));
const acct = (sub) => DEMO_ACCOUNTS.find((a) => a.sub === sub);
const P = (sub) => principalFrom({ account: normAccount(sub), name: acct(sub).name, email: `${sub}@cdc-prototype.invalid`, groups: adGroupsOf(acct(sub)) }, 'dev');
const GIT_WORDS = /分支|branch|commit|提交|合併|merge|pull request|\bPR\b|\bMR\b|GitLab|GitHub|\bgit\b/i;
const gitOut = (dir, args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
const NOW = Date.parse('2026-10-14T02:00:00Z'); // 臺北 2026-10-14 10:00
const TODAY = taipeiDate(NOW);
const validator = createValidator();

// 四筆逾期內容的「副本」：放進測試自己的版本庫，不動 content/ 裡的正本（重新審閱是權責單位的事）
const FILES = { 'disease.chikungunya': 'diseases/chikungunya.json', 'disease.japanese-encephalitis': 'diseases/japanese-encephalitis.json', 'faq.mpox-who-vaccine': 'faq/mpox-who-vaccine.json', 'faq.tb-cough-two-weeks': 'faq/tb-cough-two-weeks.json' };
const read = (id) => JSON.parse(fs.readFileSync(path.join(ROOT, 'content', FILES[id]), 'utf8'));
function seed() {
  const d = tmpDir('rr-seed-');
  for (const rel of Object.values(FILES)) { fs.mkdirSync(path.dirname(path.join(d, rel)), { recursive: true }); fs.copyFileSync(path.join(ROOT, 'content', rel), path.join(d, rel)); }
  return d;
}
function makeApi(over = {}) {
  const d = tmpDir();
  const api = createGatewayApi({
    stateFile: path.join(d, 'state.json'), auditFile: path.join(d, 'audit.jsonl'), outboxDir: path.join(d, 'outbox'),
    gitProvider: createLocalGit({ dir: path.join(d, 'repo'), seedDir: seed() }), validator, csrfSecret: 'test-secret', now: () => NOW, ...over,
  });
  return { api, repo: path.join(d, 'repo'), outbox: path.join(d, 'outbox') };
}
const mails = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.eml')).sort().map((f) => parseEml(fs.readFileSync(path.join(dir, f), 'utf8'))) : []);
const onMain = (repo, id) => JSON.parse(gitOut(repo, ['show', `main:content/${FILES[id]}`]));
const without = (o, ...keys) => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));

test('重新審閱（內容不改）：送出 → 審核中；四眼、角色、別單位擋得住；第二位審核人核准後 main 上只有最後審閱日變成今天', async () => {
  const { api, repo, outbox } = makeApi();
  const W = api.workflow;
  const id = 'disease.chikungunya';
  const original = read(id);
  assert.ok(original.reviewedAt < TODAY);
  // 別單位的承辦人、沒有編輯角色的人都不能送
  await assert.rejects(W.reReview(P('demo-008'), { contentId: id, type: 'disease' }), (e) => e.status === 403 && /權責單位是「急性傳染病組」/.test(e.message));
  await assert.rejects(W.reReview(P('demo-006'), { contentId: id, type: 'disease' }), (e) => e.status === 403 && /「編輯」角色/.test(e.message));
  // 林○慧（編輯＋審核）確認內容仍正確，送出
  const s = await W.reReview(P('demo-002'), { contentId: id, type: 'disease', note: '已對照現行防治工作手冊，內容仍正確。' }, { origin: 'http://localhost:4173', basePath: '' });
  assert.equal(s.status, 'in_review');
  assert.equal(s.kind, 'rereview'); assert.equal(s.kindLabel, '重新審閱');
  assert.equal(s.requiredApprovals, 1);
  assert.equal(s.history.at(-1).label, '送出重新審閱');
  assert.doesNotMatch(JSON.stringify(s), GIT_WORDS, '回應不帶 Git 用語');
  // 一級內容（疾病頁）：通知同單位審核人＋公關室＋OASIS（送出的人自己不通知）
  const sent = mails(outbox);
  assert.deepEqual(sent.map((m) => m.headers.to).sort(), ['<demo-004@cdc-prototype.invalid>', '<demo-005@cdc-prototype.invalid>']);
  for (const m of sent) {
    assert.match(m.headers.subject, /【請審核・重新審閱】屈公病/);
    assert.match(m.text, /確認這筆到期內容仍正確/);
    assert.doesNotMatch(`${m.headers.subject}\n${m.text}`, GIT_WORDS);
  }
  // 審核人看到的差異：沒有修改，並說明核准後會發生什麼
  const d = await W.diff(P('demo-005'), s.id);
  assert.deepEqual(d.changes, []);
  assert.equal(d.reReview.lastReviewedAt, original.reviewedAt);
  assert.match(d.reReview.text, /內容沒有修改/);
  assert.equal(d.reReview.note, '已對照現行防治工作手冊，內容仍正確。');
  assert.doesNotMatch(JSON.stringify(d), GIT_WORDS);
  // 審核佇列：同單位審核人與 OASIS 看得到；別單位看不到
  assert.ok(W.list(P('demo-005'), { view: 'queue' }).some((x) => x.id === s.id && x.kind === 'rereview'));
  assert.equal(W.list(P('demo-008'), { view: 'queue' }).length, 0);
  // 同一筆不能重複送
  await assert.rejects(W.reReview(P('demo-001'), { contentId: id, type: 'disease' }), (e) => e.status === 409 && /進行中的送審件/.test(e.message));
  // 四眼：送出的人（即使有審核角色）不能核准；別單位審核人不能核准
  await assert.rejects(W.approve(P('demo-002'), { submissionId: s.id }), (e) => e.status === 403 && /四眼原則/.test(e.message));
  await assert.rejects(W.approve(P('demo-008'), { submissionId: s.id }), (e) => e.status === 403 && /不屬於你的單位/.test(e.message));
  await assert.rejects(W.approve(P('demo-001'), { submissionId: s.id }), (e) => e.status === 403 && /「審核」或「管理」/.test(e.message));
  assert.equal(onMain(repo, id).reviewedAt, original.reviewedAt, '核准前 main 不變');
  // OASIS（一級內容的指定審核單位）核准
  const done = await W.approve(P('demo-005'), { submissionId: s.id }, { origin: 'http://localhost:4173', basePath: '' });
  assert.equal(done.status, 'published');
  assert.equal(done.reviewedAt, TODAY);
  assert.equal(done.history.at(-1).label, `已重新審閱，最後審閱日更新為 ${TODAY}`);
  const after = onMain(repo, id);
  assert.equal(after.reviewedAt, TODAY);
  assert.deepEqual(without(after, 'reviewedAt'), without(original, 'reviewedAt'), '除了最後審閱日，其他欄位（含發布日、白名單申請、譯文狀態）原封不動');
  assert.equal(gitOut(repo, ['diff', '--numstat', 'main~1', 'main']).trim(), `1\t1\tcontent/${FILES[id]}`, 'main 上只改一行');
  const msg = gitOut(repo, ['log', '-1', '--format=%B', 'main']);
  assert.match(msg, /Review-Kind: re-review \(reviewedAt 2025-07-28 -> 2026-10-14; content unchanged\)/);
  assert.match(msg, /Edited-by: 林○慧 \(AD: demo-002\)/);
  assert.match(msg, /Approved-by: 李○翰 \(AD: demo-005\)/);
  const approved = mails(outbox).find((m) => /已重新審閱/.test(m.headers.subject));
  assert.equal(approved.headers.to, '<demo-002@cdc-prototype.invalid>');
  assert.match(approved.text, new RegExp(`最後審閱日已更新為 ${TODAY}`));
  assert.match(approved.text, /\/admin\/due\//);
  // 稽核：送出那一筆是 rereview；核准上線那一筆標明 kind、前後審閱日、內容沒改；拒絕的動作也有紀錄
  const audit = api.audit.read();
  const rr = audit.find((e) => e.action === 'rereview' && e.result === 'ok');
  assert.equal(rr.kind, 'rereview'); assert.equal(rr.contentId, id); assert.equal(rr.noteChars, '已對照現行防治工作手冊，內容仍正確。'.length);
  const pub = audit.find((e) => e.action === 'publish');
  assert.deepEqual([pub.kind, pub.reviewedAtBefore, pub.reviewedAt, pub.contentChanged, pub.approvedBy], ['rereview', '2025-07-28', TODAY, false, ['demo-005']]);
  assert.ok(audit.some((e) => e.action === 'rereview' && e.result === 'denied'));
  assert.ok(audit.some((e) => e.action === 'approve' && e.result === 'denied'));
  assert.ok(!JSON.stringify(audit).includes('防治工作手冊'), '稽核不記說明本文，只記字數');
  assert.equal(verifyAudit(audit).ok, true);
});

test('重新審閱的車道：一般 Q&A 只通知公關室；一級內容加 OASIS；核准數照車道設定（設成 2 位時第一位核准不會上線）', async () => {
  const cfg = structuredClone(loadLanes());
  cfg.lanes.standard.requiredApprovals = 2;
  const { api, repo, outbox } = makeApi({ lanesCfg: cfg });
  const W = api.workflow;
  assert.deepEqual(W.laneFor(read('faq.mpox-who-vaccine'), P('demo-001')).reviewers, ['unit.pr']);
  assert.deepEqual(W.laneFor(read('disease.japanese-encephalitis'), P('demo-001')).reviewers.sort(), ['unit.oasis', 'unit.pr']);
  const s = await W.reReview(P('demo-001'), { contentId: 'faq.mpox-who-vaccine', type: 'faq' });
  assert.equal(s.requiredApprovals, 2);
  assert.deepEqual(mails(outbox).map((m) => m.headers.to).sort(), ['<demo-002@cdc-prototype.invalid>', '<demo-004@cdc-prototype.invalid>'], 'Q&A 不是一級內容：同單位審核人＋公關室，不通知 OASIS');
  const one = await W.approve(P('demo-002'), { submissionId: s.id });
  assert.equal(one.status, 'in_review');
  assert.equal(onMain(repo, 'faq.mpox-who-vaccine').reviewedAt, '2026-04-02', '只有一位核准：最後審閱日不變');
  await assert.rejects(W.approve(P('demo-002'), { submissionId: s.id }), (e) => e.status === 403 && /已經核准過/.test(e.message));
  const two = await W.approve(P('demo-004'), { submissionId: s.id });
  assert.equal(two.status, 'published');
  assert.equal(onMain(repo, 'faq.mpox-who-vaccine').reviewedAt, TODAY);
  // 一級內容：OASIS 收到通知
  const je = await W.reReview(P('demo-001'), { contentId: 'disease.japanese-encephalitis', type: 'disease' });
  assert.equal(je.laneLabel, '一般車道');
  assert.ok(mails(outbox).some((m) => m.headers.to === '<demo-005@cdc-prototype.invalid>' && /日本腦炎/.test(m.headers.subject)));
});

test('重新審閱：權責單位沒有示範帳號時（慢性傳染病組），只有跨單位角色能送與核准；退回後不改內容可以再送；改了內容也算重新審閱', async () => {
  const { api, repo } = makeApi();
  const W = api.workflow;
  const id = 'faq.tb-cough-two-weeks';
  await assert.rejects(W.reReview(P('demo-001'), { contentId: id, type: 'faq' }), (e) => e.status === 403 && /慢性傳染病組/.test(e.message));
  const s = await W.reReview(P('demo-004'), { contentId: id, type: 'faq' }); // 公關室總編輯（跨單位）
  const back = await W.returnForChanges(P('demo-005'), { submissionId: s.id, comment: '請確認最新版結核病診治指引的轉介條件。' });
  assert.equal(back.status, 'returned'); assert.equal(back.kind, 'rereview');
  assert.ok(api.audit.read().some((e) => e.action === 'return' && e.kind === 'rereview'));
  // 確認後不用改：直接再送（/admin/due/ 的「不用修改，再送出」）
  const again = await W.submit(P('demo-004'), { submissionId: s.id });
  assert.equal(again.status, 'in_review'); assert.equal(again.kind, 'rereview');
  await W.approve(P('demo-005'), { submissionId: s.id });
  assert.equal(onMain(repo, id).reviewedAt, TODAY);
  // 修改內容時勾「這也是重新審閱」：種類是 rereview，稽核記 contentChanged: true
  const edited = { ...read('faq.mpox-who-vaccine'), answerMarkdown: `${read('faq.mpox-who-vaccine').answerMarkdown}\n\n（重新審閱時補充：接種前請先確認接種點。）` };
  const s2 = await W.submit(P('demo-001'), { item: edited, reReview: true });
  assert.equal(s2.kind, 'rereview');
  const d2 = await W.diff(P('demo-002'), s2.id);
  assert.equal(d2.changes[0].field, 'answerMarkdown');
  assert.match(d2.reReview.text, /同時修改了 1 個欄位/);
  await W.approve(P('demo-002'), { submissionId: s2.id });
  const pub = api.audit.read().filter((e) => e.action === 'publish').at(-1);
  assert.equal(pub.kind, 'rereview'); assert.equal(pub.contentChanged, true);
  // 不存在、型別不對、未上線的內容
  await assert.rejects(W.reReview(P('demo-001'), { contentId: 'faq.no-such-item', type: 'faq' }), (e) => e.status === 404);
  await assert.rejects(W.reReview(P('demo-001'), { contentId: 'disease.chikungunya', type: 'faq' }), (e) => e.status === 404);
  await assert.rejects(W.reReview(P('demo-001'), { contentId: '../../etc', type: 'faq' }), (e) => e.status === 422);
  await assert.rejects(W.reReview(P('demo-001'), { contentId: 'disease.chikungunya', type: 'situation' }), (e) => e.status === 422);
});

test('HTTP：POST /api/gateway/rereview 要同源＋CSRF；回應不帶 Git 細節', async () => {
  const { api } = makeApi({ authAdapter: createHeaderAuth({ trustedProxies: ['127.0.0.1'] }) });
  const srv = http.createServer(async (rq, rs) => { const u = new URL(rq.url, 'http://x'); if (!(await api.handle(rq, rs, u.pathname, u.searchParams))) { rs.statusCode = 404; rs.end(); } });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const who = { 'X-Remote-User': 'CDC\\demo-001', 'X-Remote-Groups': 'CDC-WEB-acute-infectious-editor', 'X-Remote-Name': encodeURIComponent('王○安') };
  try {
    const { csrfToken } = await (await fetch(`${base}/api/gateway/session`, { headers: who })).json();
    const post = (body, headers = {}) => fetch(`${base}/api/gateway/rereview`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base, 'x-csrf-token': csrfToken, ...who, ...headers }, body: JSON.stringify(body) });
    assert.equal((await post({ contentId: 'disease.chikungunya', type: 'disease' }, { 'x-csrf-token': 'nope' })).status, 403);
    assert.equal((await post({ contentId: 'disease.chikungunya', type: 'disease' }, { origin: 'https://evil.example' })).status, 403);
    const ok = await post({ contentId: 'disease.chikungunya', type: 'disease' });
    assert.equal(ok.status, 200, await ok.clone().text());
    const body = await ok.text();
    assert.doesNotMatch(body, /cms\/|branch|reviewId|commit/);
    assert.doesNotMatch(body, GIT_WORDS);
    assert.equal(JSON.parse(body).kind, 'rereview');
    const busy = await post({ contentId: 'disease.chikungunya', type: 'disease' });
    assert.equal(busy.status, 409);
    assert.doesNotMatch((await busy.json()).message, GIT_WORDS);
  } finally { srv.close(); }
});

test('核准後的版本放回站台重算：不再逾期、回到 AI 白名單；BUILD_TODAY 早於今天時 overdueAsOf 列出被藏起來的逾期', async () => {
  const { api, repo } = makeApi();
  const s = await api.workflow.reReview(P('demo-001'), { contentId: 'disease.chikungunya', type: 'disease' });
  await api.workflow.approve(P('demo-002'), { submissionId: s.id });
  const approved = onMain(repo, 'disease.chikungunya');
  // 以 content/ 的現況為基礎，只把這筆的審閱日固定成「逾期前」與「核准後」兩種情況（content/ 正本日後被單位更新也不影響測試）
  const before = govern(TODAY, (site) => { site.byId.get('disease.chikungunya').reviewedAt = '2025-07-28'; });
  const b = before.byId.get('disease.chikungunya').gov;
  assert.equal(b.overdue, true); assert.equal(b.whitelist.effective, false); assert.ok(b.whitelist.reasons.includes('overdue'));
  assert.ok(before.gov.todos.some((t) => t.id === 'overdue:disease.chikungunya'));
  const after = govern(TODAY, (site) => { site.byId.get('disease.chikungunya').reviewedAt = approved.reviewedAt; });
  const a = after.byId.get('disease.chikungunya').gov;
  assert.equal(a.overdue, false); assert.equal(a.nextReviewAt, '2027-10-14');
  assert.equal(a.whitelist.effective, true, `回到 AI 白名單（其他原因：${a.whitelist.reasons.join('、')}）`);
  assert.ok(!after.gov.todos.some((t) => t.id === 'overdue:disease.chikungunya'), '逾期待辦消失');
  // CI 的 BUILD_TODAY=2026-10-01：到期日在 10-01～10-13 的內容這次建置看不到逾期，overdueAsOf 把它們找出來
  const ci = govern('2026-10-01', (site) => { site.byId.get('faq.tb-cough-two-weeks').reviewedAt = '2026-04-01'; site.byId.get('faq.mpox-who-vaccine').reviewedAt = '2026-04-02'; });
  assert.equal(ci.byId.get('faq.mpox-who-vaccine').gov.overdue, false, 'BUILD_TODAY=2026-10-01 時 mpox Q&A 還沒逾期');
  const hidden = overdueAsOf(ci, '2026-10-14');
  for (const want of ['faq.tb-cough-two-weeks', 'faq.mpox-who-vaccine']) assert.ok(hidden.some((h) => h.id === want && h.whitelisted), want);
  for (const h of hidden) assert.ok(h.nextReviewAt >= '2026-10-01' && h.nextReviewAt < '2026-10-14', h.id);
  assert.ok(!hidden.some((h) => h.id === 'disease.chikungunya'), '在 BUILD_TODAY 已逾期的不重複列');
  assert.deepEqual(overdueAsOf(ci, '2026-10-01'), [], '同一天不列');
  assert.deepEqual(overdueAsOf(ci, '2026-09-01'), [], '比 BUILD_TODAY 早不列');
});

test('沒有閘道（GitHub Pages）：/admin/due/ 維持示範按鈕，頁首明說不會改變內容並指出真正做法；有閘道時改用送出重新審閱', () => {
  const site = govern('2026-10-14');
  const h = String(due.render(makeCtx(site, 'zh-TW', { path: '/admin/due/', alternates: ['zh-TW'] })));
  const demoBox = /<div class="adm-box adm-box--warn" id="d-demo" data-gw-hide>([\s\S]*?)<\/div>/.exec(h);
  assert.ok(demoBox, '示範提醒框（有閘道時由 .adm-gw [data-gw-hide] 收起）');
  assert.match(demoBox[1], /不會讓內容回到 AI 白名單/);
  assert.match(demoBox[1], /npm run dev/);
  assert.match(demoBox[1], /§51/);
  assert.match(h, /data-mark="disease\.chikungunya"[^>]*>標記已審閱（示範）/);
  assert.match(h, /<tr data-id="disease\.chikungunya" data-type="disease" data-owner="unit\.acute-infectious" data-reviewed="\d{4}-\d{2}-\d{2}"/);
  assert.match(h, /id="d-gw" role="status" aria-live="polite" hidden/);
  const head = /<header class="adm-pagehead">([\s\S]*?)<\/header>/.exec(h)[1];
  assert.doesNotMatch(head, GIT_WORDS, '頁首說明不出現 Git 用語');
  // 前端：偵測閘道的方式與 /admin/publish/ 相同；有閘道送 /rereview，沒有閘道只寫這台電腦
  const js = fs.readFileSync(path.join(ROOT, 'src/client/admin/due.js'), 'utf8');
  assert.match(js, /import \{[^}]*detectGateway[^}]*\} from '\.\/gateway-client\.js'/);
  assert.match(js, /gw\.post\('\/rereview'/);
  assert.match(js, /'cdc\.admin\.reviewed'/);
  assert.match(js, /送出重新審閱/);
  assert.doesNotMatch(js.replace(/^\s*\/\/.*$/gm, ''), /innerHTML/, '畫面文字一律 textContent');
});

// ───────────────────────── 端到端（Playwright）─────────────────────────
const CHROME = process.env.CHROME_BIN || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const DIST = process.env.DIST_DIR ? path.resolve(process.env.DIST_DIR) : path.join(ROOT, 'dist');
const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });

test('端到端：/admin/due/ 送出重新審閱 → /admin/review/ 另一位核准 → /admin/due/ 顯示已重新審閱；?gateway=off 是示範', { timeout: 180000 }, async (t) => {
  const duePage = path.join(DIST, 'admin/due/index.html');
  if (!fs.existsSync(duePage)) return t.skip('dist 尚未建置');
  if (!fs.readFileSync(duePage, 'utf8').includes('data-type="disease"')) return t.skip('dist 是舊版（請重新建置）');
  if (!fs.readFileSync(duePage, 'utf8').includes('data-id="disease.chikungunya"')) return t.skip('dist 的審閱到期清單沒有屈公病');
  let chromium;
  try { ({ chromium } = await import('playwright')); } catch { return t.skip('沒有 Playwright'); }
  if (!fs.existsSync(CHROME)) return t.skip('沒有 Chromium');
  const d = tmpDir('rr-e2e-');
  const port = await freePort();
  const env = { ...distEnv(DIST), GATEWAY_REPO_DIR: path.join(d, 'repo'), GATEWAY_SEED_DIR: seed(), GATEWAY_STATE_FILE: path.join(d, 'state.json'), GATEWAY_AUDIT_FILE: path.join(d, 'audit.jsonl'), OUTBOX_DIR: path.join(d, 'outbox'), SUBSCRIPTIONS_FILE: path.join(d, 'subs.json') };
  const srv = spawn(process.execPath, [path.join(ROOT, 'scripts/serve.mjs'), String(port)], { cwd: ROOT, stdio: ['ignore', 'ignore', 'pipe'], env });
  let stderr = ''; srv.stderr.on('data', (c) => { stderr += c; });
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const errors = [];
  const base = `http://localhost:${port}${distBasePath(DIST)}`;
  const repo = path.join(d, 'repo');
  const row = '#main tr[data-id="disease.chikungunya"]';
  try {
    for (let i = 0; i < 80; i++) { try { if ((await fetch(`${base}/api/gateway/health`)).ok) break; } catch { /* 等伺服器 */ } await new Promise((r) => setTimeout(r, 100)); }
    const as = async (sub) => {
      const ctx = await browser.newContext({ viewport: { width: 1360, height: 1000 } });
      await ctx.addInitScript(({ s }) => { try { if (!localStorage.getItem('cdc.admin.session')) localStorage.setItem('cdc.admin.session', JSON.stringify(s)); } catch { /* sandbox iframe */ } }, { s: makeSession(acct(sub)) });
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(`${sub}: ${e.message}`));
      page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|Blocked script execution in 'about:srcdoc'/.test(m.text())) errors.push(`${sub}: ${m.text()}`); });
      return page;
    };

    // ① 承辦人：審閱到期 → 送出重新審閱
    const ed = await as('demo-001');
    await ed.goto(`${base}/admin/due/`);
    await ed.waitForSelector(`${row} button[data-rr]`, { timeout: 15000 });
    assert.equal(await ed.isHidden('#d-demo'), true, '有閘道時示範提醒收起');
    await ed.click(`${row} button[data-rr]`);
    await ed.waitForFunction((sel) => /審核中/.test(document.querySelector(sel)?.textContent ?? ''), row, { timeout: 15000 });
    assert.match(await ed.locator('#d-gw').innerText(), /已送出「屈公病」重新審閱/);
    // 只看頁面自己寫給同事的字（狀態列、每列的動作欄、頁首）；內容 ID 本身（如 page.immunization-committees）不算
    const ownText = await ed.evaluate(() => [...document.querySelectorAll('#d-gw, [data-act], .adm-pagehead, .adm-group-title')].filter((n) => n.offsetParent !== null || n.id === 'd-gw').map((n) => n.innerText).join('\n'));
    assert.doesNotMatch(ownText, GIT_WORDS, `審閱到期頁不出現 Git 用語：${ownText.match(GIT_WORDS)?.[0]}`);
    const { AxeBuilder } = await import('@axe-core/playwright');
    const axe = await new AxeBuilder({ page: ed }).include('#main').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    assert.deepEqual(axe.violations.filter((v) => ['serious', 'critical'].includes(v.impact)).map((v) => `${v.id}: ${v.nodes[0]?.target}`), []);

    // ② 審核人：複核區看到「重新審閱」→ 核准
    const rv = await as('demo-002');
    await rv.goto(`${base}/admin/review/`);
    await rv.waitForSelector('#gw-queue button[data-sid]', { timeout: 15000 });
    assert.match(await rv.locator('#gw-queue').innerText(), /重新審閱/);
    await rv.click('#gw-queue button[data-sid]');
    await rv.waitForFunction(() => /內容沒有修改/.test(document.querySelector('#gw-diff')?.textContent ?? ''), null, { timeout: 15000 });
    assert.match(await rv.locator('#gw-d-meta').innerText(), /送審類型\s*重新審閱/);
    await rv.click('#gw-approve');
    await rv.waitForFunction(() => /最後審閱日已更新為/.test(document.querySelector('#gw-act-msg')?.textContent ?? ''), null, { timeout: 15000 });
    assert.doesNotMatch(await rv.evaluate(() => [...document.querySelectorAll('#gw-review, #gw-detail')].map((n) => n.innerText).join('\n')), GIT_WORDS);
    const today = taipeiDate(Date.now());
    assert.equal(JSON.parse(gitOut(repo, ['show', 'main:content/diseases/chikungunya.json'])).reviewedAt, today);

    // ③ 承辦人：同一頁顯示已重新審閱
    await ed.reload();
    await ed.waitForFunction((sel) => /已重新審閱/.test(document.querySelector(sel)?.textContent ?? ''), row, { timeout: 15000 });
    assert.match(await ed.locator(row).innerText(), new RegExp(`已重新審閱 ${today}`));

    // ④ 沒有閘道（GitHub Pages）：示範按鈕＋提醒框
    await ed.goto(`${base}/admin/due/?gateway=off`);
    await ed.waitForSelector(`${row} button[data-mark]`);
    await ed.waitForTimeout(300);
    assert.equal(await ed.isVisible('#d-demo'), true);
    assert.equal(await ed.evaluate(() => document.body.classList.contains('adm-gw')), false);
    await ed.click(`${row} button[data-mark]`);
    assert.match(await ed.locator(row).innerText(), /已標記（示範）[\s\S]*最後審閱日沒有改變/);
    assert.deepEqual(errors, [], errors.join('\n'));
  } finally {
    await browser.close();
    srv.kill();
    if (stderr.trim()) console.error(stderr);
  }
});

