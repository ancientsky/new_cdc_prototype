// 第四十五輪：上傳 PDF 自動帶入（pdf.js 文字層 → 版面文字 → 切段；內嵌圖配圖說）、送審件帶附件與配套卷期走寫入閘道上線。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { linesFromItems, pageText, manuscriptText, captionsByPage, matchImages, describeExtraction } from '../src/client/admin/pdf-manuscript.js';
import { splitManuscript } from '../src/client/bulletin-rules.js';
import { emptyState, applyManuscript, resolveIssue, buildArticle } from '../src/client/admin/bulletin-edit-core.js';
import { createValidator } from '../scripts/lib/gateway/validate-item.mjs';
import { createLocalGit } from '../scripts/lib/gateway/git-local.mjs';
import { createGitLab } from '../scripts/lib/gateway/git-gitlab.mjs';
import { createGatewayApi, MAX_BODY, ITEM_WITH_FILES_MAX_BODY } from '../scripts/lib/gateway/index.mjs';
import { principalFrom, normAccount } from '../scripts/lib/gateway/auth.mjs';
import { adGroupsOf, DEMO_ACCOUNTS, makeSession } from '../src/client/admin/auth-rules.js';
import * as adminEdit from '../src/templates/admin/bulletin-edit.mjs';
import { makeCtx } from '../scripts/lib/pages.mjs';
import { govern } from './helpers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmpDir = (p = 'r36-') => fs.mkdtempSync(path.join(os.tmpdir(), p));
const acct = (sub) => DEMO_ACCOUNTS.find((a) => a.sub === sub);
const P = (sub) => principalFrom({ account: normAccount(sub), name: acct(sub).name, email: `${sub}@cdc-prototype.invalid`, groups: adGroupsOf(acct(sub)) }, 'dev');
const gitOut = (dir, args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
const gitBuf = (dir, args) => execFileSync('git', ['-C', dir, ...args]);
const REAL_PDF = path.join(ROOT, 'content/assets/article.teb-42-19-1/teb-42-19-1.pdf');
const REAL_PNG = path.join(ROOT, 'content/assets/article.teb-42-19-1/fig-1.png');

/* ───────── 版面文字 ───────── */
const it = (str, x, y, size = 10) => ({ str, x, y, w: str.length * size * 0.9, h: size, size });

test('linesFromItems：同基線的字塊排成一行、依 x 排序、間距補空白；不同行依 y 排序', () => {
  const lines = linesFromItems([it('第 42 卷', 300, 50), it('2026 年 10 月 6 日', 100, 50.3), it('疫情調查', 400, 80), it('篇名', 120, 110), it('A', 100, 140), it('B', 111, 140), it('李泱', 100, 170), it('1*', 121, 166, 6)]);
  assert.deepEqual(lines.map((l) => l.text.replace(/ {2,}/g, '  ')), ['2026 年 10 月 6 日  第 42 卷', '疫情調查', '篇名', 'A B', '李泱 1*']);
  assert.match(lines[0].text, / {4,}第 42 卷$/, '大間距補多個空白（模仿 -layout）');
  assert.equal(pageText(lines).split('\n')[1].startsWith('      '), true, '縮排依 x');
  assert.equal(manuscriptText([{ items: [] }, { items: [it('x', 0, 0)] }]), 'x');
});

test('captionsByPage 與 matchImages：圖說在第幾頁、太小與重複的圖略過、同頁或前一頁的圖配給圖說，其餘列為未配對', () => {
  const caps = captionsByPage([`刊頭\n圖 10 不算（太長）${'x'.repeat(170)}`, '措施如圖一。\n圖一、防治作為時序圖\n表 1 檢驗結果', '圖二：第二張']);
  assert.deepEqual(caps, [{ page: 2, kind: 'figure', no: 1, line: '圖一、防治作為時序圖' }, { page: 2, kind: 'table', no: 1, line: '表 1 檢驗結果' }, { page: 3, kind: 'figure', no: 2, line: '圖二：第二張' }]);
  const images = [
    { key: 'p1-0', page: 1, order: 0, width: 1491, height: 621, fingerprint: 'masthead' },
    { key: 'p1-1', page: 1, order: 1, width: 294, height: 74, fingerprint: 'logo' }, { key: 'p2-0', page: 2, order: 0, width: 294, height: 74, fingerprint: 'logo' },
    { key: 'p2-1', page: 2, order: 1, width: 1127, height: 531, fingerprint: 'fig' },
    { key: 'p2-2', page: 2, order: 2, width: 800, height: 400, fingerprint: 'fig2' },
  ];
  const r = matchImages(images, caps);
  assert.deepEqual(r.assigned.map((a) => [a.key, a.no, a.fileName]), [['p2-1', 1, '圖1.png'], ['p2-2', 2, '圖2.png']], '圖二在第 3 頁沒圖 → 用前一頁剩下的');
  assert.deepEqual(r.leftovers.map((x) => x.key), ['p1-0']);
  assert.deepEqual(r.skipped.map((x) => [x.key, x.why]), [['p1-1', 'small'], ['p2-0', 'small']]);
  assert.match(describeExtraction({ pages: 7, chars: 5000, ...r }), /7 頁.*2 張圖已配到圖說（圖 1、圖 2）.*1 張圖沒有對到圖說.*略過 2 張/);
  const r2 = matchImages([{ key: 'a', page: 1, order: 0, width: 300, height: 300, fingerprint: 'x' }, { key: 'b', page: 3, order: 0, width: 300, height: 300, fingerprint: 'x' }], [{ page: 1, kind: 'figure', no: 1 }]);
  assert.deepEqual(r2.assigned, []); assert.equal(r2.skipped[0].why, 'repeated');
});

/* ───────── 真實 PDF：pdf.js（Node 版）文字層 → 切段 ───────── */
test('真實 PDF 42(19)：pdf.js 文字層經 manuscriptText 後，splitManuscript 抓到篇名、7 位作者、2 個單位、DOI、日期、關鍵字、7 段、圖一、11 筆文獻、英文摘要', { skip: !fs.existsSync(REAL_PDF) }, async () => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(REAL_PDF)), isEvalSupported: false, disableFontFace: true, standardFontDataUrl: path.join(ROOT, 'node_modules/pdfjs-dist/standard_fonts/') });
  const doc = await task.promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n); const vp = page.getViewport({ scale: 1 }); const tc = await page.getTextContent();
    const items = [];
    for (const t of tc.items) { if (!('str' in t)) continue; const [a, b, , d, e, f] = t.transform; const size = Math.hypot(a, b) || Math.abs(d) || t.height || 10; items.push({ str: t.str, x: e, y: vp.height - f, w: t.width, h: t.height || size, size }); }
    pages.push({ items, width: vp.width, height: vp.height });
  }
  await task.destroy();
  assert.equal(pages.length, 7);
  const text = manuscriptText(pages);
  const r = splitManuscript(text);
  assert.equal(r.title, '2024 年嬰兒型肉毒桿菌中毒個案調查報告');
  assert.deepEqual(r.authors.map((a) => `${a.name}${a.affiliations.join(',')}${a.corresponding ? '*' : ''}`), ['李泱1*', '戴詩縈1', '顏佳瑩1', '林稜2', '張芳梓1', '黃志傑1', '巫坤彬1']);
  assert.equal(r.affiliations.length, 2); assert.equal(r.meta.doi, '10.6524/EB.202610_42(19).0001'); assert.equal(r.meta.receivedAt, '2025-05-14'); assert.equal(r.meta.acceptedAt, '2025-08-14');
  assert.deepEqual(r.meta.keywords, ['嬰兒型肉毒桿菌中毒', '便祕', '抗毒素治療', '疫情調查']); assert.equal(r.meta.category, 'investigation'); assert.equal(r.meta.volume, 42); assert.equal(r.meta.issue, 19);
  assert.deepEqual(r.sections.map((s) => s.heading), ['事件源起', '背景介紹', '個案報告', '感染源及接觸者調查', '檢體採集及檢驗結果', '疫情研判', '討論及建議']);
  assert.deepEqual(r.figures, [{ kind: 'figure', no: 1, caption: '2024年嬰兒型肉毒桿菌中毒個案臨床醫療及公衛防治作為時序圖' }]);
  assert.equal(r.references.length, 11); assert.ok(r.abstractEn.length > 500); assert.equal(r.meta.email, 'leon75@cdc.gov.tw');
  const caps = captionsByPage(pages.map((p) => pageText(linesFromItems(p.items))));
  assert.deepEqual(caps.map((c) => [c.page, c.kind, c.no]), [[2, 'figure', 1]]);
  // 套進後台表單 → 文章物件通過檢核（除了圖還沒檔案）
  const site = govern('2026-10-13');
  const a = applyManuscript(emptyState({ today: '2026-10-13', categories: site.master.bulletinCategories }), text, { issues: site.collections.publications });
  assert.equal(a.state.issueMode, 'existing'); assert.equal(a.state.issueId, 'publication.bulletin-42-19'); assert.equal(a.state.doi, '10.6524/EB.202610_42(19).0001');
});

/* ───────── 閘道：附件與配套卷期 ───────── */
function seed() {
  const d = tmpDir('r36-seed-');
  for (const sub of ['publications', 'articles']) fs.mkdirSync(path.join(d, sub), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'content/publications/bulletin-42-19.json'), path.join(d, 'publications', 'bulletin-42-19.json'));
  return d;
}
const validator = createValidator();
function makeApi(over = {}) {
  const d = tmpDir();
  const api = createGatewayApi({
    stateFile: path.join(d, 'state.json'), auditFile: path.join(d, 'audit.jsonl'), outboxDir: path.join(d, 'outbox'),
    gitProvider: createLocalGit({ dir: path.join(d, 'repo'), seedDir: seed() }), validator, csrfSecret: 'test-secret', ...over,
  });
  return { api, dir: d, repo: path.join(d, 'repo') };
}
/** 一篇疫情報導文章（新卷期 42(20)），圖與 PDF 用真實檔案 */
function articleWithFiles() {
  const png = fs.readFileSync(REAL_PNG); const pdf = fs.readFileSync(REAL_PDF);
  const site = govern('2026-10-13');
  const st = { ...emptyState({ today: '2026-10-13', categories: site.master.bulletinCategories }), issueMode: 'new', newVolume: '42', newIssue: '20', newDate: '2026-10-20', articleNo: '1', title: '閘道測試文章', articleType: 'investigation',
    owner: 'unit.acute-infectious', authors: '甲 | 1 | * | a@cdc.gov.tw', affiliations: '1 | 急性傳染病組', pages: '1-5', doi: '10.6524/EB.202610_42(20).0001', abstract: '摘要。', pdfFile: 'teb-42-20-1.pdf',
    sections: [{ key: 'origin', heading: '事件源起', markdown: '經過如圖一。' }], figures: [{ kind: 'figure', no: '1', caption: '時序圖', markdown: '', alt: '時序圖：通報到防治的日期', file: 'fig-1.png' }], diseases: ['disease.botulism'] };
  const issue = resolveIssue(st, site.collections.publications, { today: '2026-10-13' });
  const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
  const item = buildArticle(st, { today: '2026-10-13', issue, files: { 'fig-1.png': { bytes: png.length, sha256: sha(png), width: 1127, height: 531, mime: 'image/png' }, 'teb-42-20-1.pdf': { bytes: pdf.length, sha256: sha(pdf) } } });
  const { _new, ...issueJson } = issue; void _new;
  return { item, issueJson, files: { 'fig-1.png': png, 'teb-42-20-1.pdf': pdf }, png, pdf };
}

test('閘道工作流程：文章＋新卷期＋附件存草稿 → 送審 → 核准上線；附件逐位元進正式庫、卷期一起上線；附件內容與宣告不符會擋', async () => {
  const { api, repo } = makeApi();
  const W = api.workflow;
  const editor = P('demo-001'), reviewer = P('demo-002');
  const { item, issueJson, files, png, pdf } = articleWithFiles();
  // 沒帶卷期 → 擋（所屬卷期不存在）
  await assert.rejects(W.saveDraft(editor, { item, files }), (e) => e.status === 422 && e.fields.some((f) => /卷期/.test(f.message)), '新卷期沒一起送就擋');
  // 附件 sha256 不符 → 擋
  await assert.rejects(W.saveDraft(editor, { item, files: { ...files, 'fig-1.png': Buffer.concat([png, Buffer.from([0])]) }, companions: [issueJson] }), (e) => e.status === 422 && e.fields.some((f) => /sha256|bytes/.test(f.message)));
  // 附件沒上傳也沒在站上 → 擋
  await assert.rejects(W.saveDraft(editor, { item, files: { 'teb-42-20-1.pdf': pdf }, companions: [issueJson] }), (e) => e.status === 422 && e.fields.some((f) => /不存在/.test(f.message)));
  const s1 = await W.saveDraft(editor, { item, files, companions: [issueJson] });
  assert.equal(s1.status, 'draft'); assert.deepEqual(s1.files.sort(), ['fig-1.png', 'teb-42-20-1.pdf']); assert.deepEqual(s1.companions, [{ id: 'publication.bulletin-42-20', title: issueJson.title }]);
  const branch = gitOut(repo, ['branch', '--list', 'cms/*']).trim().replace(/^[* ]+/, '');
  assert.deepEqual(gitOut(repo, ['ls-tree', '-r', '--name-only', branch]).trim().split('\n').filter((f) => /42-20/.test(f)).sort(), ['content/articles/teb-42-20-1.json', 'content/assets/article.teb-42-20-1/fig-1.png', 'content/assets/article.teb-42-20-1/teb-42-20-1.pdf', 'content/publications/bulletin-42-20.json']);
  assert.ok(gitBuf(repo, ['cat-file', '-p', `${branch}:content/assets/article.teb-42-20-1/fig-1.png`]).equals(png), '圖檔逐位元相同');
  // 再存一版不重傳附件：仍通過（附件從分支讀回來檢查）
  const s2 = await W.saveDraft(editor, { item: { ...item, summary: '改了摘要一句' }, submissionId: s1.id, companions: [issueJson] });
  assert.equal(s2.status, 'draft'); assert.deepEqual(s2.files.sort(), ['fig-1.png', 'teb-42-20-1.pdf']);
  const s3 = await W.submit(editor, { submissionId: s1.id }, { origin: 'http://localhost:4173', basePath: '' });
  assert.equal(s3.status, 'in_review'); assert.equal(s3.companions.length, 1, '送審沿用配套卷期');
  const done = await W.approve(reviewer, { submissionId: s1.id, comment: '可' }, { origin: 'http://localhost:4173', basePath: '' });
  assert.equal(done.status, 'published');
  const main = gitOut(repo, ['ls-tree', '-r', '--name-only', 'main']).trim().split('\n');
  for (const f of ['content/articles/teb-42-20-1.json', 'content/assets/article.teb-42-20-1/fig-1.png', 'content/assets/article.teb-42-20-1/teb-42-20-1.pdf', 'content/publications/bulletin-42-20.json']) assert.ok(main.includes(f), `main 缺 ${f}`);
  assert.ok(gitBuf(repo, ['cat-file', '-p', 'main:content/assets/article.teb-42-20-1/teb-42-20-1.pdf']).equals(pdf));
  const published = JSON.parse(gitOut(repo, ['cat-file', '-p', 'main:content/articles/teb-42-20-1.json']));
  assert.equal(published.status, 'published'); assert.equal(published.assets.length, 2);
  const pubIssue = JSON.parse(gitOut(repo, ['cat-file', '-p', 'main:content/publications/bulletin-42-20.json']));
  assert.equal(pubIssue.status, 'published'); assert.equal(pubIssue.volume, 42);
  const log = gitOut(repo, ['log', '-1', '--format=%B', 'main']);
  assert.match(log, /Approved-by: /);
});

test('HTTP 層：/drafts 可帶 files（base64）與 companions；附件格式、數量、合計大小有上限；內容本身仍限 512 KB', async () => {
  const { api } = makeApi();
  const editor = P('demo-001');
  const h = (body, headers = {}) => {
    const chunks = [Buffer.from(JSON.stringify(body))];
    const req = Object.assign((async function* () { for (const c of chunks) yield c; })(), { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost:4173', host: 'localhost:4173', 'sec-fetch-site': 'same-origin', 'x-csrf-token': api.csrfFor(editor), [api.DEV_SESSION_HEADER]: Buffer.from(JSON.stringify(makeSession(acct('demo-001')))).toString('base64url'), ...headers }, socket: { remoteAddress: '127.0.0.1' } });
    return req;
  };
  const res = () => { const r = { headers: {}, statusCode: 0, body: '', setHeader(k, v) { r.headers[k] = v; }, end(b) { r.body = String(b ?? ''); } }; return r; };
  const post = async (sub, body) => { const r = res(); await api.handle(h(body), r, `/api/gateway${sub}`, new URLSearchParams()); return { status: r.statusCode, data: r.body ? JSON.parse(r.body) : null }; };
  const { item, issueJson, png, pdf } = articleWithFiles();
  const b64 = (b) => b.toString('base64');
  assert.ok(ITEM_WITH_FILES_MAX_BODY > MAX_BODY);
  const bad = await post('/drafts', { item, companions: [issueJson], files: [{ name: '../x.png', base64: b64(png) }] });
  assert.equal(bad.status, 400); assert.equal(bad.data.error, 'bad_files');
  const many = await post('/drafts', { item, companions: [issueJson], files: Array.from({ length: 21 }, (_, i) => ({ name: `f${i}.png`, base64: 'AA==' })) });
  assert.equal(many.status, 400);
  const big = await post('/drafts', { item, companions: [issueJson], files: [{ name: 'big.pdf', base64: b64(Buffer.alloc(17 * 1024 * 1024)) }] });
  assert.equal(big.status, 413);
  const fat = await post('/drafts', { item: { ...item, note: 'x'.repeat(600 * 1024) }, companions: [issueJson], files: [{ name: 'fig-1.png', base64: b64(png) }] });
  assert.equal(fat.status, 413, '內容本身仍限 512 KB'); assert.match(fat.data.message, /512 KB/);
  const comps = await post('/drafts', { item, companions: 'nope', files: [] });
  assert.equal(comps.status, 400); assert.equal(comps.data.error, 'bad_companions');
  const ok = await post('/drafts', { item, companions: [issueJson], files: [{ name: 'fig-1.png', base64: b64(png) }, { name: 'teb-42-20-1.pdf', base64: b64(pdf) }] });
  assert.equal(ok.status, 200, JSON.stringify(ok.data).slice(0, 300)); assert.equal(ok.data.status, 'draft'); assert.equal(ok.data.files.length, 2);
});

test('GitLab 供應者：附件（Buffer）以 base64 action 提交；readFile raw 回 Buffer', async () => {
  const calls = [];
  const fetchFn = async (u, init) => {
    calls.push({ u, init });
    if (init.method === 'HEAD') return { status: 404, headers: { get: () => '' } };
    if (/\/raw\?/.test(u)) return { status: 200, headers: { get: () => 'application/octet-stream' }, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer, text: async () => 'x' };
    return { status: 201, headers: { get: () => 'application/json' }, json: async () => ({ id: 'abc' }) };
  };
  const gl = createGitLab({ baseUrl: 'https://gitlab.example', project: 1, token: 't', fetchFn });
  const r = await gl.commit({ branch: 'b', files: [{ path: 'content/x.json', content: '{}' }, { path: 'content/assets/a/fig-1.png', content: Buffer.from([137, 80, 78, 71]) }], message: 'm' });
  assert.equal(r.sha, 'abc');
  const body = JSON.parse(calls.find((c) => /commits$/.test(c.u)).init.body);
  assert.deepEqual(body.actions.map((a) => [a.file_path, a.encoding]), [['content/x.json', 'text'], ['content/assets/a/fig-1.png', 'base64']]);
  assert.equal(body.actions[1].content, Buffer.from([137, 80, 78, 71]).toString('base64'));
  const buf = await gl.readFile('b', 'content/assets/a/fig-1.png', { raw: true });
  assert.ok(Buffer.isBuffer(buf)); assert.deepEqual([...buf], [1, 2, 3]);
});

test('後台模板：有「上傳 PDF 自動帶入」區與送審面板；vendor 有 pdf.js 與授權檔', () => {
  const site = govern('2026-10-13');
  const html = String(adminEdit.render(makeCtx(site, 'zh-TW', { path: '/admin/bulletin/edit/', alternates: ['zh-TW'] })));
  for (const id of ['te-pdfin', 'te-pdfdrop', 'te-pdfin-msg', 'te-pdf-extra', 'gw-panel', 'gw-save', 'gw-submit']) assert.ok(html.includes(`id="${id}"`), `缺 #${id}`);
  for (const f of ['pdf.min.js', 'pdf.worker.min.js', 'LICENSE.txt']) assert.ok(fs.existsSync(path.join(ROOT, 'src/public/vendor/pdfjs', f)), `vendor 缺 ${f}`);
  const src = fs.readFileSync(path.join(ROOT, 'src/client/admin/pdf-read.js'), 'utf8');
  assert.match(src, /import\(url\('\/vendor\/pdfjs\/pdf\.min\.js'/, '用到才載入');
  // vendor 用 legacy 版：一般版用了 Map.prototype.getOrInsertComputed 這類很新的語法，舊一點的瀏覽器會整個載不起來
  assert.ok(fs.readFileSync(path.join(ROOT, 'src/public/vendor/pdfjs/pdf.min.js'), 'utf8').includes('getOrInsertComputed:function'), 'vendor 應是 legacy 版（自帶 polyfill）');
  assert.match(src, /new Uint8Array\(bytes\)/, '交給 pdf.js 前先複製 bytes（它會轉移 ArrayBuffer）');
});
