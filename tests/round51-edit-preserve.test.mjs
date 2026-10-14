// 第五十一輪：修改已上架內容（/admin/publish/?edit=）以現行版為底、只改同事動過的欄位（docs/deploy.md §22）。
//
// 以前：表單匯出一份完整 JSON，再把「表單沒有」的欄位從現行版補回。表單有、卻只裝得下一部分的欄位（摘要、關鍵字、提供語言、
// 結構化欄位、申請對象、連結的各語言標題…）會被表單的版本蓋掉；editDiff 又剛好略過這幾欄，畫面還說「目前與現行版相同」。
// 這裡把頁面的流程（API 一筆 → 表單 → 預處理 → 匯出 → 併回）在 Node 裡照做一次，並以 Playwright 在真的頁面上再驗一次。
import { govern, distBasePath, distEnv } from './helpers.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as P from '../src/client/admin/preprocess.js';
import { fieldLabel, FIELD_LABELS } from '../src/client/admin/field-labels.js';
import { sourcePickOf } from '../src/client/source-pick.js';
import { apiItem } from '../scripts/lib/emit-api.mjs';
import { sourceHashOf } from '../scripts/lib/load.mjs';
import { fieldDiff } from '../scripts/lib/gateway/field-diff.mjs';
import { FIELD_LABELS as GW_LABELS } from '../scripts/lib/gateway/validate-item.mjs';
import { makeSession, DEMO_ACCOUNTS } from '../src/client/admin/auth-rules.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TODAY = '2026-10-14';
const site = govern(TODAY);
const raw = (rel) => fs.readFileSync(path.join(ROOT, 'content', rel), 'utf8');
const byFile = new Map(site.all.filter((i) => i.__file).map((i) => [i.__file.replace(/^content\//, ''), i]));
/** 頁面拿到的那一筆：v1 API 的形狀（疾病頁另有 master、related） */
const apiOf = (rel) => { const it = byFile.get(rel); assert.ok(it, `站台沒有 ${rel}`); const a = apiItem(it); return it.type === 'disease' ? { ...a, master: { id: it.id }, related: [] } : a; };
const FORM_TYPES = new Set(P.TYPES.map((t) => t.value));
/** 上架頁能修改的：已上架、且表單有這個型別（職缺、採購、資料集等有自己的編輯頁） */
const editable = (it) => it.status === 'published' && P.collectionOfId(it.id) && FORM_TYPES.has(P.itemToForm(it).type);
const without = (o, ...keys) => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));
const clone = (v) => JSON.parse(JSON.stringify(v));

// 預處理在頁面上會產生「系統建議」的摘要、關鍵字、結構化欄位——與現行版不同。以前就是這些值被寫回去。
// 這裡故意給一組跟現行版不同的建議值：沒改任何東西時，它們必須完全不影響輸出。
const AUTO = { summary: '系統自動擬的摘要。', keywords: ['自動詞'], diseases: [], vaccines: [], countries: ['EG'], structured: { ageMonths: '6 個月' } };
/** 照 publish.js 的 exportRaw 組 buildExport 的輸入 */
function exportOf(api, f, sel = AUTO, { submitted = false, assets = [] } = {}) {
  return P.buildExport({
    type: f.type, id: f.id, title: f.title, body: f.body, owner: f.owner, steward: api.steward ?? '某組承辦人', reviewPeriodMonths: f.period === '' ? 0 : f.period,
    audience: f.audience, tasks: f.tasks, basedOn: f.basedOn, langs: f.langs, summary: sel.summary, keywords: sel.keywords, diseases: sel.diseases, vaccines: sel.vaccines, countries: sel.countries,
    structured: sel.structured, extra: f.extra, today: TODAY, submitted, assets,
  });
}
/** 開啟修改 →（可選）改表單 → 存檔：回傳 { base, out, merged, live, api } */
function editFlow(rel, { form = (f) => f, sel = (s) => s, submitted = false, assets = [] } = {}) {
  const api = apiOf(rel);
  const f0 = P.itemToForm(api);
  const base = exportOf(api, f0, AUTO);
  const out = exportOf(api, form(clone(f0)), sel(clone(AUTO)), { submitted, assets });
  return { api, base, out, merged: P.mergeEdit(out, api, base), live: JSON.parse(raw(rel)) };
}
/** 現行版＋刻意更新的欄位（status、reviewedAt；位置不變） */
const expectSaved = (live, status = 'draft') => ({ ...live, status, reviewedAt: TODAY });

const SAMPLES = [
  'faq/tb-cough-two-weeks.json', // 英文已複核、各語言 i18n、structured、legacyUrls、AI 白名單已核准
  'faq/dengue-fever-when-to-see-doctor.json',
  'diseases/dengue.json',
  'news/2025-03-24-world-tb-day.json',
  'news/2026-09-30-system-maintenance.json', // newsType: other（表單只會產生 press）
  'services/case-data-request.json',
  'services/ltbi-treatment.json', // whoCanApply 是自由文字，表單的勾選框裝不下
  'vaccines/hepatitis-b.json',
  'documents/ev-severe-guideline.2026-03-15.json', // API 多了 isCurrent／supersededBy（計算欄位）
  'topics/visiting-taiwan.json', // 連結有各語言標題（i18n）
  'labtests/mpox.json',
  'publications/bulletin-42-19.json',
  'research/2024-prep-adherence-sti.json',
  'media/prep-intro.json',
  'pages/leadership-deputy-director-general-1.json',
];

test('API 的一筆拿掉 API 專用欄位後，與 content 檔逐位元組相同（鍵順序也同）——所有可修改的內容', () => {
  let n = 0;
  for (const [rel, it] of byFile) {
    if (!editable(it)) continue;
    const api = apiOf(rel);
    assert.equal(JSON.stringify(P.liveItem(api)), JSON.stringify(JSON.parse(raw(rel))), `${rel}：API 多了或少了 content 檔沒有的欄位（新的計算欄位請加進 API_ONLY_KEYS）`);
    n++;
  }
  assert.ok(n > 200, `只比對了 ${n} 筆`);
});

test('開啟修改、什麼都不改就存：與現行版逐位元組相同，只差 status 與 reviewedAt（各型別範例）', () => {
  for (const rel of SAMPLES) {
    const { merged, live } = editFlow(rel);
    assert.equal(JSON.stringify(merged, null, 2), JSON.stringify(expectSaved(live), null, 2), `${rel}：沒改卻有欄位變了`);
    assert.deepEqual(P.editDiff(merged, apiOf(rel)), [], `${rel}：editDiff 應為空`);
  }
  const { merged } = editFlow('faq/tb-cough-two-weeks.json', { submitted: true });
  assert.equal(merged.status, 'review');
});

test('開啟修改、什麼都不改就存：所有已上架內容都成立（不只範例）', () => {
  let n = 0;
  for (const [rel, it] of byFile) {
    if (!editable(it)) continue;
    const { merged, live } = editFlow(rel);
    assert.equal(JSON.stringify(merged), JSON.stringify(expectSaved(live)), rel);
    n++;
  }
  assert.ok(n > 200);
});

test('只改一個非正本欄位（任務入口、審閱週期、權責單位）：只有那一欄變', () => {
  const rel = 'faq/tb-cough-two-weeks.json';
  const tasks = editFlow(rel, { form: (f) => ({ ...f, tasks: [...f.tasks, 'prevention'] }) });
  assert.deepEqual(P.editDiff(tasks.merged, tasks.api), ['tasks']);
  assert.deepEqual(tasks.merged.tasks, [...tasks.live.tasks, 'prevention']);
  assert.equal(JSON.stringify(without(tasks.merged, 'tasks')), JSON.stringify(without(expectSaved(tasks.live), 'tasks')));
  const period = editFlow(rel, { form: (f) => ({ ...f, period: '12' }) });
  assert.deepEqual(P.editDiff(period.merged, period.api), ['reviewPeriodMonths']);
  assert.equal(period.merged.reviewPeriodMonths, 12);
  const owner = editFlow('services/case-data-request.json', { form: (f) => ({ ...f, owner: 'unit.acute-infectious' }) });
  assert.deepEqual(P.editDiff(owner.merged, owner.api), ['owner']);
});

test('改中文內文：只有內文變；語言、i18n、AI 白名單、舊站網址、structured、摘要、關鍵字原樣，既有譯文補上舊版 sourceHash（建置會顯示「譯文待複核」）', () => {
  const rel = 'faq/tb-cough-two-weeks.json';
  const { merged, live, api } = editFlow(rel, { form: (f) => ({ ...f, body: `${f.body}\n\n（示範：補一句。）` }) });
  assert.deepEqual(P.editDiff(merged, api), ['answerMarkdown', 'languages']);
  for (const k of ['i18n', 'aiWhitelist', 'legacyUrls', 'structured', 'summary', 'keywords', 'diseases', 'basedOn', 'publishedAt', 'license']) assert.deepEqual(merged[k], live[k], k);
  assert.equal(merged.languages.en.status, 'reviewed', '英文「已複核」不會變回「待翻譯」');
  assert.equal(merged.languages.en.reviewer, live.languages.en.reviewer);
  assert.equal(merged.languages.en.sourceHash, api.sourceHash, '補上的是現行版（舊版正本）的雜湊');
  assert.equal(merged.languages['zh-TW'].sourceHash, undefined, '正本自己不補');
  for (const l of ['ja', 'tl', 'vi', 'id', 'th']) assert.equal(merged.languages[l].status, 'machine');
  assert.notEqual(sourceHashOf(merged), api.sourceHash, '新正本的雜湊不同 ⇒ 治理規則 R5 判定譯文過期');
  // 只改非正本欄位時不補 sourceHash
  const t = editFlow(rel, { form: (f) => ({ ...f, tasks: ['prevention'] }) });
  assert.deepEqual(t.merged.languages, live.languages);
});

test('取消一個語言：只有那個語言改成「不提供」，其他語言的複核紀錄不動', () => {
  const rel = 'faq/tb-cough-two-weeks.json';
  const { merged, live, api } = editFlow(rel, { form: (f) => ({ ...f, langs: { ...f.langs, th: { on: false, reason: '示範' } } }) });
  assert.deepEqual(P.editDiff(merged, api), ['languages']);
  assert.deepEqual(merged.languages.th, { status: 'none', note: '不提供：示範' });
  assert.deepEqual(without(merged.languages, 'th'), without(live.languages, 'th'));
  assert.deepEqual(Object.keys(merged.languages), Object.keys(live.languages), '語言順序不變');
});

test('關鍵字、相關疾病：只套用同事新增或移除的那幾個，現行版其他的與順序不變', () => {
  const rel = 'faq/tb-cough-two-weeks.json';
  const add = editFlow(rel, { sel: (s) => ({ ...s, keywords: [...s.keywords, '潛伏結核'], diseases: ['disease.mdr-tb'] }) });
  assert.deepEqual(add.merged.keywords, [...add.live.keywords, '潛伏結核']);
  assert.deepEqual(add.merged.diseases, [...add.live.diseases, 'disease.mdr-tb']);
  assert.deepEqual(P.editDiff(add.merged, add.api), ['diseases', 'keywords']);
  // 建議清單裡也有、現行版也有的詞被取消 ⇒ 從現行版拿掉；其他照舊
  const base = { ...AUTO, keywords: ['結核病', '自動詞'] };
  const api = apiOf(rel), f0 = P.itemToForm(api);
  const merged = P.mergeEdit(exportOf(api, f0, { ...base, keywords: ['自動詞'] }), api, exportOf(api, f0, base));
  assert.deepEqual(merged.keywords, JSON.parse(raw(rel)).keywords.filter((k) => k !== '結核病'));
});

test('結構化欄位：取消系統建議的值，不會把現行版人工填的 structured 一起刪掉', () => {
  const rel = 'faq/tb-cough-two-weeks.json';
  const { merged, live } = editFlow(rel, { sel: (s) => ({ ...s, structured: {} }) });
  assert.deepEqual(merged.structured, live.structured);
  const add = editFlow(rel, { sel: (s) => ({ ...s, structured: { ...s.structured, incubationDays: 3 } }) });
  assert.deepEqual(add.merged.structured, { ...live.structured, incubationDays: 3 });
});

test('物件清單：改一條連結的標題，其他連結與各語言標題（i18n）保留；勾一個申請對象，自由文字的對象不消失', () => {
  const t = editFlow('topics/visiting-taiwan.json', { form: (f) => ({ ...f, extra: { ...f.extra, links: f.extra.links.replace(/^[^|\n]+/, '臺灣目前的疫情') } }) });
  const td = P.editDiff(t.merged, t.api);
  assert.ok(td.includes('links') && td.every((k) => ['links', 'languages'].includes(k)), td.join());
  assert.equal(t.merged.links[0].label, '臺灣目前的疫情');
  assert.deepEqual(t.merged.links[0].i18n, t.live.links[0].i18n, '第一條連結的各語言標題保留');
  assert.deepEqual(t.merged.links.slice(1), t.live.links.slice(1));
  const s = editFlow('services/ltbi-treatment.json', { form: (f) => ({ ...f, extra: { ...f.extra, who: [...f.extra.who, '研究者'] } }) });
  assert.deepEqual(s.merged.whoCanApply, [...s.live.whoCanApply, '研究者']);
  assert.deepEqual(P.editDiff(s.merged, s.api), ['whoCanApply']);
});

test('疾病頁：改一個區塊只換那個區塊；keyFacts、slug、法定類別、其他區塊原樣', () => {
  const rel = 'diseases/dengue.json';
  const live = JSON.parse(raw(rel));
  const first = live.blocks.find((b) => b.markdown);
  const { merged, api } = editFlow(rel, { form: (f) => ({ ...f, body: f.body.replace(`## ${first.heading}\n\n${first.markdown.trim()}`, `## ${first.heading}\n\n${first.markdown.trim()}\n\n新增一句。`) }) });
  assert.deepEqual(P.editDiff(merged, api).filter((k) => k !== 'languages'), ['blocks']);
  assert.ok(merged.blocks.find((b) => b.key === first.key).markdown.endsWith('新增一句。'));
  assert.deepEqual(merged.blocks.filter((b) => b.key !== first.key), live.blocks.filter((b) => b.key !== first.key));
  for (const k of ['keyFacts', 'slug', 'nameEn', 'legalCategory', 'summary', 'keywords', 'i18n']) assert.deepEqual(merged[k], live[k], k);
});

test('附件：新選的檔加在現行版附件後面；現行版附件不帶 API 的公開網址', () => {
  const rel = [...byFile.keys()].find((r) => byFile.get(r).assets?.length && editable(byFile.get(r)));
  assert.ok(rel, '找不到有附件的內容');
  const same = editFlow(rel);
  assert.deepEqual(same.merged.assets, same.live.assets);
  const add = { file: 'new-note.pdf', kind: 'attachment', title: '新附件', bytes: 10, sha256: 'a'.repeat(64), mime: 'application/pdf', license: 'OGDL-1.0' };
  const r = editFlow(rel, { assets: [add] });
  assert.deepEqual(r.merged.assets, [...r.live.assets, add]);
  assert.deepEqual(P.editDiff(r.merged, r.api), ['assets']);
});

test('mergeEdit 一定要有 base；sourcePickOf 與建置的 sourceHashOf 是同一份欄位', () => {
  const api = apiOf('faq/tb-cough-two-weeks.json');
  assert.throws(() => P.mergeEdit({}, api), /base/);
  assert.equal(sourceHashOf(api), api.sourceHash);
  const a = JSON.parse(raw('faq/tb-cough-two-weeks.json'));
  assert.equal(P.sourceChanged(a, { ...a }), false);
  assert.equal(P.sourceChanged(a, { ...a, tasks: [] }), false, 'tasks 不是正本文字');
  assert.equal(P.sourceChanged(a, { ...a, summary: 'x' }), true);
  assert.ok('answerMarkdown' in sourcePickOf(a));
});

// ───────── 改了什麼就要報什麼：editDiff 與審核人看到的 fieldDiff ─────────
const VARIANTS = {
  summary: (o) => { o.summary = `${o.summary}（改）`; },
  keywords: (o) => { o.keywords = [...o.keywords, '新增']; },
  structured: (o) => { o.structured = { ...o.structured, coughWeeks: 3 }; },
  languages: (o) => { o.languages.en = { status: 'pending' }; },
  i18n: (o) => { o.i18n.en.question = 'Changed?'; },
  aiWhitelist: (o) => { delete o.aiWhitelist.approvedBy; },
  legacyUrls: (o) => { o.legacyUrls = []; },
  verification: (o) => { o.verification = { status: 'needs-check' }; },
  reviewPeriodMonths: (o) => { o.reviewPeriodMonths = 12; },
  sensitivity: (o) => { o.sensitivity = 'professional'; },
  steward: (o) => { o.steward = '新的承辦窗口'; },
};

test('editDiff：每一種被改的欄位都會列出（以前略過摘要、關鍵字、語言、structured）；只是鍵順序不同不算修改', () => {
  const api = apiOf('faq/tb-cough-two-weeks.json');
  const live = P.liveItem(api);
  for (const [k, mut] of Object.entries(VARIANTS)) { const o = clone(live); mut(o); assert.deepEqual(P.editDiff(o, api), [k], k); }
  const all = clone(live); for (const mut of Object.values(VARIANTS)) mut(all);
  assert.deepEqual(P.editDiff(all, api), Object.keys(VARIANTS).sort());
  const reordered = Object.fromEntries(Object.entries(clone(live)).reverse());
  reordered.languages = Object.fromEntries(Object.entries(reordered.languages).reverse());
  assert.deepEqual(P.editDiff(reordered, api), []);
  assert.deepEqual(P.editDiff({ ...live, status: 'review', reviewedAt: TODAY }, api), [], 'EDIT_DERIVED 由畫面另外說明');
  assert.deepEqual(P.EDIT_DERIVED, ['status', 'reviewedAt']);
});

test('fieldDiff（審核人看到的）：每個不同的欄位都至少有一筆；語言的子欄位、區塊的其他設定也會報；鍵順序不算修改', () => {
  const before = JSON.parse(raw('faq/tb-cough-two-weeks.json'));
  for (const [k, mut] of Object.entries(VARIANTS)) {
    const after = clone(before); mut(after);
    const d = fieldDiff(before, after);
    assert.ok(d.changes.some((c) => c.field === k), `${k}：審核人看不到這個修改`);
  }
  const reordered = Object.fromEntries(Object.entries(clone(before)).reverse());
  assert.deepEqual(fieldDiff(before, reordered).changes, []);
  // 語言：狀態相同、只有複核紀錄不同
  const rv = clone(before); delete rv.languages.en.reviewer;
  const lc = fieldDiff(before, rv).changes.find((c) => c.field === 'languages');
  assert.ok(lc && /英文/.test(lc.summary) && /reviewer/.test(lc.summary), JSON.stringify(lc));
  // 語言：補上舊版 sourceHash（改了正本）
  const st = clone(before); st.languages.en.sourceHash = 'abc123abc123';
  assert.match(fieldDiff(before, st).changes.find((c) => c.field === 'languages').summary, /英文：正本已修改，已複核譯文標為待複核/);
  // 疾病頁區塊：內文相同，只拿掉 pending
  const dz = JSON.parse(raw('diseases/dengue.json'));
  const pend = dz.blocks.findIndex((b) => b.status === 'pending');
  if (pend >= 0) {
    const d2 = clone(dz); delete d2.blocks[pend].status;
    const bc = fieldDiff(dz, d2).changes.filter((c) => c.field === 'blocks');
    assert.equal(bc.length, 1); assert.match(bc[0].summary, /status/);
  }
  // 名稱：審核人與上架頁同一份
  assert.equal(GW_LABELS, FIELD_LABELS);
  assert.equal(fieldLabel('legacyUrls'), '舊站網址'); assert.equal(fieldLabel('someNewField'), 'someNewField');
});

test('上架頁：匯出以現行版為底；預處理結果以現行版帶入；「目前改動的欄位」不再略過任何欄位', () => {
  const js = fs.readFileSync(path.join(ROOT, 'src/client/admin/publish.js'), 'utf8');
  assert.match(js, /editing\.base = exportRaw\(\)/);
  assert.match(js, /P\.mergeEdit\(out, editing\.original, editing\.base \?\? out\)/);
  assert.match(js, /seedFromLive\(P\.liveItem\(item\)\)/);
  assert.match(js, /await runPreprocess\(\{ silent: true \}\)/, '要等預處理完才記 base');
  assert.doesNotMatch(js, /editDiff\([^)]*\)\.filter/, '不能再略過欄位');
  assert.match(js, /editOf: editing/, '修改中的草稿記得現行版');
  const pp = fs.readFileSync(path.join(ROOT, 'src/client/admin/preprocess.js'), 'utf8');
  assert.doesNotMatch(pp, /\['reviewedAt', 'status', 'steward', 'keywords', 'summary', 'languages', 'structured', 'sensitivity'\]\.includes/);
});

// ───────────────────────── 端到端（Playwright）：真的頁面、真的閘道 ─────────────────────────
const CHROME = process.env.CHROME_BIN || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const DIST = process.env.DIST_DIR ? path.resolve(process.env.DIST_DIR) : path.join(ROOT, 'dist');
const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
const gitOut = (dir, args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' });

test('端到端：/admin/publish/?edit= 不改就存草稿只差狀態與審閱日；改標題後只多標題、問題與譯文待複核；審核人看得到全部', { timeout: 180000 }, async (t) => {
  const pub = path.join(DIST, 'assets/js/admin/publish.js');
  if (!fs.existsSync(pub)) return t.skip('dist 尚未建置');
  if (!fs.readFileSync(pub, 'utf8').includes('editOf')) return t.skip('dist 是舊版（請重新建置）');
  let chromium;
  try { ({ chromium } = await import('playwright')); } catch { return t.skip('沒有 Playwright'); }
  if (!fs.existsSync(CHROME)) return t.skip('沒有 Chromium');
  const REL = 'faq/dengue-fever-when-to-see-doctor.json', ID = 'faq.dengue-fever-when-to-see-doctor';
  const live = JSON.parse(raw(REL));
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'r51-e2e-'));
  const seedDir = path.join(d, 'seed'); fs.mkdirSync(path.join(seedDir, 'faq'), { recursive: true }); fs.copyFileSync(path.join(ROOT, 'content', REL), path.join(seedDir, REL));
  const port = await freePort();
  const env = { ...distEnv(DIST), GATEWAY_REPO_DIR: path.join(d, 'repo'), GATEWAY_SEED_DIR: seedDir, GATEWAY_STATE_FILE: path.join(d, 'state.json'), GATEWAY_AUDIT_FILE: path.join(d, 'audit.jsonl'), OUTBOX_DIR: path.join(d, 'outbox'), SUBSCRIPTIONS_FILE: path.join(d, 'subs.json') };
  const srv = spawn(process.execPath, [path.join(ROOT, 'scripts/serve.mjs'), String(port)], { cwd: ROOT, stdio: ['ignore', 'ignore', 'pipe'], env });
  let stderr = ''; srv.stderr.on('data', (c) => { stderr += c; });
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const errors = [];
  const base = `http://localhost:${port}${distBasePath(DIST)}`;
  const repo = path.join(d, 'repo');
  const onBranch = () => { const br = gitOut(repo, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/cms/']).trim().split('\n').filter(Boolean); assert.equal(br.length, 1, `應只有一個送審分支：${br}`); return JSON.parse(gitOut(repo, ['show', `${br[0]}:content/${REL}`])); };
  try {
    for (let i = 0; i < 80; i++) { try { if ((await fetch(`${base}/api/gateway/health`)).ok) break; } catch { /* 等伺服器 */ } await new Promise((r) => setTimeout(r, 100)); }
    const ctx = await browser.newContext({ viewport: { width: 1360, height: 1000 } });
    await ctx.addInitScript(({ s }) => { try { if (!localStorage.getItem('cdc.admin.session')) localStorage.setItem('cdc.admin.session', JSON.stringify(s)); } catch { /* sandbox iframe */ } }, { s: makeSession(DEMO_ACCOUNTS.find((a) => a.sub === 'demo-001')) });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|Blocked script execution in 'about:srcdoc'/.test(m.text())) errors.push(m.text()); });
    await page.goto(`${base}/admin/publish/?edit=${ID}`);
    await page.waitForFunction(() => window.__admPublish?.editing?.base && /內容與現行版相同/.test(document.querySelector('#edit-diff')?.textContent ?? ''), null, { timeout: 20000 });
    await page.waitForFunction(() => document.body.classList.contains('adm-gw') && !document.querySelector('#gw-save')?.disabled, null, { timeout: 15000 });
    // 結果欄顯示的就是現行版的摘要與關鍵字
    assert.equal(await page.evaluate(() => window.__admPublish.state.sel.summary), live.summary);
    assert.deepEqual(new Set(await page.evaluate(() => window.__admPublish.exportObj().keywords)), new Set(live.keywords));

    // ① 不改就存草稿：分支上的檔與現行版只差 status、reviewedAt
    await page.click('#gw-save');
    await page.waitForFunction(() => /已儲存草稿/.test(document.querySelector('#gw-status')?.textContent ?? ''), null, { timeout: 15000 });
    const saved = onBranch();
    assert.equal(saved.status, 'draft');
    assert.equal(JSON.stringify(without(saved, 'status', 'reviewedAt'), null, 2), JSON.stringify(without(live, 'status', 'reviewedAt'), null, 2), '不改就存，其他欄位一個位元組都不能變');
    assert.deepEqual(Object.keys(saved), Object.keys(live), '鍵順序不變');
    assert.equal(saved.languages.en.status, 'reviewed');

    // ② 改標題：畫面列出標題、問題、提供語言；分支上只多這幾欄
    await page.fill('#f-title', `${live.title}（修訂）`);
    await page.waitForFunction(() => /標題/.test(document.querySelector('#edit-diff')?.textContent ?? '') && /提供語言/.test(document.querySelector('#edit-diff')?.textContent ?? ''), null, { timeout: 15000 });
    assert.deepEqual((await page.getAttribute('#edit-diff', 'data-changed')).split(' ').sort(), ['languages', 'question', 'title']);
    await page.click('#gw-submit');
    await page.waitForFunction(() => /已送審|已上線/.test(document.querySelector('#gw-status')?.textContent ?? ''), null, { timeout: 15000 });
    const sent = onBranch();
    const diffKeys = Object.keys({ ...live, ...sent }).filter((k) => !P.sameValue(live[k], sent[k])).sort();
    assert.deepEqual(diffKeys, ['languages', 'question', 'reviewedAt', 'status', 'title']);
    assert.equal(sent.languages.en.status, 'reviewed', '英文已複核不會變回待翻譯');
    assert.equal(sent.languages.en.sourceHash, sourceHashOf(live), '標上舊版正本的雜湊 ⇒ 建置顯示「中文已更新，譯文待複核」');
    for (const k of ['summary', 'keywords', 'structured', 'i18n', 'aiWhitelist', 'legacyUrls']) assert.deepEqual(sent[k], live[k], k);

    // ③ 審核人看到的差異：標題、問題、提供語言都在
    const sid = await page.evaluate(() => JSON.parse(localStorage.getItem('cdc.admin.gwCurrent') ?? 'null')?.sid);
    const diff = await page.evaluate(async (s) => { const m = await import(new URL('../../assets/js/admin/gateway-client.js', location.href).href); const gw = await m.detectGateway(); return (await gw.get(`/items/${s}/diff`)).data; }, sid);
    const fields = diff.changes.map((c) => c.field);
    for (const f of ['title', 'question', 'languages', 'reviewedAt']) assert.ok(fields.includes(f), `審核人看不到 ${f}：${fields}`);
    assert.match(diff.changes.find((c) => c.field === 'languages').summary, /英文：正本已修改/);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    srv.kill();
    if (stderr.trim() && process.env.DEBUG_E2E) console.error(stderr);
  }
});
