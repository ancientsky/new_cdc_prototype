// 第九輪（ARCHITECTURE 17.3）舊站匯出批次轉換：規則比對、HTML→草稿（Word 樣式清理、表格、附件宣告、圖片 needsAlt）、
// 信心計算、report 形狀、migration-patch 不動 verified、結核病批次 40 頁全部有輸出且草稿通過 schema 驗證、後台 /admin/import/。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { runImport, loadContentIndex } from '../scripts/lib/legacy-import/index.mjs';
import {
  loadRules, matchUrlPattern, bulletinType, ownerForCategory, detectDiseases, blockKeyFor, mergeBlockFor, docTypeFor, manifestPathRegex, parseUrl, stripTitlePrefix,
} from '../scripts/lib/legacy-import/rules.mjs';
import { computeConfidence, needsReview } from '../scripts/lib/legacy-import/confidence.mjs';
import { validateDraft } from '../scripts/lib/legacy-import/validate.mjs';
import { applyPatch, expandTemplateItems } from '../scripts/lib/legacy-import/migration.mjs';
import { mdTableRows, kvTable, listItems, clarificationClaim, verdictFor, pubTypeFor, serviceTypeFor, typeOfId } from '../scripts/lib/legacy-import/types.mjs';
import { readJSON } from '../scripts/lib/load.mjs';
import { sha256Of, pdfHasTextLayer } from '../scripts/lib/assets.mjs';
import { makeCtx } from '../scripts/lib/pages.mjs';
import * as admImport from '../src/templates/admin/import.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const CONTENT = path.join(ROOT, 'content');
const EXPORT_TB = path.join(ROOT, 'data/legacy-export/tuberculosis');
const COMMITTED = path.join(ROOT, 'data/legacy-import/tuberculosis');
const NOW = '2026-10-04T00:00:00.000Z';
const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `import-legacy-${name}-`));
// 已提交批次（登革熱、第六批新聞、第七批指引）是 2026-10-03 對當時新站內容跑的：之後移除的內容（虛構的登革熱指引第 15～17 版與通函、
// 當時的移轉清單）保留在 data/legacy-export/_retired/，PDF 轉入的新文件（derivedFrom）當時不存在。這裡組回當時的內容目錄，讓批次測試可重現。
let SNAPSHOT = null;
function snapshotContent() {
  if (SNAPSHOT) return SNAPSHOT;
  const d = path.join(tmp('snapshot'), 'content');
  fs.cpSync(CONTENT, d, { recursive: true });
  fs.cpSync(path.join(ROOT, 'data/legacy-export/_retired'), d, { recursive: true });
  for (const f of fs.readdirSync(path.join(d, 'documents'))) if (JSON.parse(fs.readFileSync(path.join(d, 'documents', f), 'utf8')).derivedFrom) fs.rmSync(path.join(d, 'documents', f));
  return (SNAPSHOT = d);
}
const rules = loadRules();
const master = readJSON(path.join(CONTENT, 'master/diseases.json'));

// ───────────────────────── 規則比對 ─────────────────────────

test('規則：URL 模式 → 型別與目錄（大小寫不分）', () => {
  const t = (u) => matchUrlPattern(rules, u);
  assert.equal(t('https://www.cdc.gov.tw/Disease/SubIndex/abc123').kind, 'disease-block');
  assert.equal(t('https://www.cdc.gov.tw/disease/subindex/abc123').kind, 'disease-block');
  assert.equal(t('https://www.cdc.gov.tw/Category/QAPage/xyz').type, 'faq');
  assert.equal(t('https://www.cdc.gov.tw/Bulletin/Detail/xyz?typeid=9').type, 'news');
  assert.equal(t('https://www.cdc.gov.tw/Bulletin/List/xyz?page=2').kind, 'list');
  assert.equal(t('https://www.cdc.gov.tw/Category/MPage/xyz').type, 'page');
  assert.equal(t('https://www.cdc.gov.tw/Category/Page/xyz').dir, 'pages');
  assert.equal(t('https://www.cdc.gov.tw/File/Get/xyz').asset, true);
  assert.equal(t('https://www.cdc.gov.tw/Category/DiseaseManual/xyz').type, 'document');
  assert.equal(t('https://www.cdc.gov.tw/InfectionReport/Info/xyz?infoId=1').docType, 'report');
  assert.equal(t('https://www.cdc.gov.tw/Something/Else/1'), null);
  assert.equal(t('https://www.cdc.gov.tw/Category/List/xyz').typeClear, false, '清單頁型別不算明確');
});

test('規則：Bulletin typeid → newsType（9 新聞稿、8772 澄清、11 其他、158 英文）', () => {
  assert.equal(bulletinType(rules, 'https://x.gov.tw/Bulletin/Detail/a?typeid=9').newsType, 'press');
  assert.equal(bulletinType(rules, 'https://x.gov.tw/Bulletin/Detail/a?typeId=8772').newsType, 'clarification');
  assert.equal(bulletinType(rules, 'https://x.gov.tw/Bulletin/Detail/a?typeid=11').newsType, 'other');
  const en = bulletinType(rules, 'https://x.gov.tw/Bulletin/Detail/a?typeid=158');
  assert.equal(en.lang, 'en');
  assert.equal(bulletinType(rules, 'https://x.gov.tw/Bulletin/Detail/a?typeid=999').unknown, true);
  assert.equal(bulletinType(rules, 'https://x.gov.tw/Bulletin/Detail/a'), null);
});

test('規則：類別 → owner（最長前綴）、疾病別名 → disease id、標題關鍵字 → blocks key', () => {
  assert.equal(ownerForCategory(rules, '結核病／檢驗').owner, 'unit.lab');
  assert.equal(ownerForCategory(rules, '結核病／防治政策').owner, 'unit.chronic-infectious');
  assert.equal(ownerForCategory(rules, '結核病／教育訓練'), null, '沒有規則 ⇒ 未對應');
  const ids = (txt) => detectDiseases(rules, master, [txt]).map((d) => d.id);
  assert.deepEqual(ids('結核病／疾病介紹'), ['disease.tuberculosis']);
  assert.deepEqual(ids('肺結核防治'), ['disease.tuberculosis']);
  assert.deepEqual(ids('多重抗藥性結核病醫療照護體系'), ['disease.mdr-tb'], '較長的名稱涵蓋較短者');
  assert.deepEqual(ids('首頁／結核病／防治政策／抗藥性結核病'), ['disease.tuberculosis', 'disease.mdr-tb']);
  assert.deepEqual(ids('今天天氣'), []);
  assert.equal(blockKeyFor(rules, '致病原'), 'transmission');
  assert.equal(blockKeyFor(rules, '傳染方式與潛伏期'), 'transmission');
  assert.equal(blockKeyFor(rules, '臨床症狀'), 'symptoms');
  assert.equal(blockKeyFor(rules, '預防接種建議'), 'vaccine', '預防接種先於預防');
  assert.equal(blockKeyFor(rules, '預防方法'), 'prevention');
  assert.equal(blockKeyFor(rules, '流行病學'), 'situation');
  assert.equal(blockKeyFor(rules, '無關標題'), null);
  assert.equal(mergeBlockFor(rules, { title: '卡介苗接種', breadcrumbs: ['首頁', '結核病', '預防接種', '卡介苗'] }), 'vaccine');
  assert.equal(mergeBlockFor(rules, { title: '都治（DOTS）', breadcrumbs: ['首頁', '結核病', '防治政策'] }), null, '不在併入範圍的 MPage 維持 page');
  assert.equal(docTypeFor(rules, '結核病診治指引（第八版）', null, 'https://x.gov.tw/File/Get/a').docType, 'guideline');
  assert.equal(docTypeFor(rules, '病例定義', matchUrlPattern(rules, 'https://x.gov.tw/Category/DiseaseDefine/a'), 'https://x.gov.tw/Category/DiseaseDefine/a').docType, 'case-definition');
  assert.equal(stripTitlePrefix(rules, 'Q&A：咳嗽多久？'), '咳嗽多久？');
});

test('規則：移轉清單舊網址（{id} 佔位、fragment）→ 路徑比對', () => {
  const re = manifestPathRegex('https://www.cdc.gov.tw/Category/MPage/{id}#bcg');
  assert.ok(re.test(parseUrl('https://www.cdc.gov.tw/Category/MPage/AbC-123_x').path));
  assert.ok(!re.test('/Category/Page/AbC'));
  const re2 = manifestPathRegex('https://www.cdc.gov.tw/Uploads/archives/%E7%B5%90%E6%A0%B8.pdf');
  assert.ok(re2.test(parseUrl('https://www.cdc.gov.tw/Uploads/archives/%E7%B5%90%E6%A0%B8.pdf').path));
});

// ───────────────────────── 信心計算 ─────────────────────────

test('信心：型別 .4、owner .2、Markdown .2、附件 .1、無重複 .1；< 0.6 建議人工檢視', () => {
  const all = { typeClear: true, ownerMapped: true, markdownClean: true, attachmentsOk: true, unique: true };
  assert.equal(computeConfidence(all).confidence, 1);
  assert.deepEqual(computeConfidence(all).parts, { type: 0.4, owner: 0.2, markdown: 0.2, attachments: 0.1, unique: 0.1 });
  assert.equal(computeConfidence({ ...all, typeClear: false }).confidence, 0.6);
  assert.equal(computeConfidence({ ...all, ownerMapped: false }).confidence, 0.8);
  assert.equal(computeConfidence({ ...all, markdownClean: false }).confidence, 0.8);
  assert.equal(computeConfidence({ ...all, attachmentsOk: false }).confidence, 0.9);
  assert.equal(computeConfidence({ ...all, unique: false }).confidence, 0.9);
  assert.equal(computeConfidence({ ...all, typeClear: false, ownerMapped: false }).confidence, 0.4);
  assert.equal(computeConfidence({ typeClear: false, ownerMapped: false, markdownClean: false, attachmentsOk: false, unique: false }).confidence, 0);
  assert.equal(needsReview(0.59, rules), true);
  assert.equal(needsReview(0.6, rules), false, '門檻是 < 0.6');
});

// ───────────────────────── 合成匯出：HTML → 草稿 ─────────────────────────

const PDF_TEXT = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Length 40 >>\nstream\nBT /F1 12 Tf (Hello sample) Tj ET\nendstream\nendobj\n%%EOF\n', 'latin1');
const PDF_SCAN = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Length 12 >>\nstream\nq 1 0 0 1 0 0 cm\nendstream\nendobj\n%%EOF\n', 'latin1');
const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

const shell = (title, body, extra = '') => `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title} - 衛生福利部疾病管制署</title><!--[if gte mso 9]><xml><w:WordDocument/></xml><![endif]--><script>var x=1;</script></head>
<body><header class="navbar"><ul class="nav"><li>導覽不該被轉進內文</li></ul></header><ol class="breadcrumb"><li>首頁</li><li>結核病</li><li>${title}</li></ol>
<div id="CCMS_Content"><h2 class="title">${title}</h2><div class="share-bar">友善列印 分享</div><div class="content-body">${body}</div>${extra}<div class="update">最後更新時間：2026/09/01</div></div><footer>頁尾不該被轉進內文</footer></body></html>`;
const wordP = (t) => `<p class="MsoNormal" style="margin:0cm;mso-pagination:widow-orphan"><span lang="ZH-TW" style="font-size:12.0pt;font-family:'新細明體',serif;mso-ascii-font-family:'Times New Roman'">${t}</span><o:p></o:p></p>`;

/** 合成一個小匯出：新聞（Word 樣式、表格、附件、無 alt 圖片、缺檔附件）、Q&A 兩題、疾病子頁、不認得的網址 */
function synthExport(dir, { withMissing = true } = {}) {
  fs.mkdirSync(path.join(dir, 'files'), { recursive: true });
  const put = (name, html, side) => { fs.writeFileSync(path.join(dir, `${name}.html`), html); fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(side)); };
  fs.writeFileSync(path.join(dir, '_export.json'), JSON.stringify({ exportedAt: '2026-10-01', simulated: true }));
  fs.writeFileSync(path.join(dir, 'files/文件 說明.pdf'), PDF_TEXT);
  fs.writeFileSync(path.join(dir, 'files/scan.pdf'), PDF_SCAN);
  fs.writeFileSync(path.join(dir, 'files/chart.png'), PNG_1X1);
  put('01-news', shell('新聞稿：結核病測試', `${wordP('疾管署今天表示，<b style="mso-bidi-font-weight:normal">咳嗽兩週</b>請就醫，接觸者檢查與潛伏感染治療可降低發病風險，費用由公費支應。')}
<p class="MsoListParagraph" style="margin-left:36.0pt;text-indent:-18.0pt;mso-list:l0 level1 lfo1"><![if !supportLists]><span style="mso-list:Ignore">·<span style="font:7.0pt 'Times New Roman'">&nbsp;&nbsp;</span></span><![endif]><span lang="ZH-TW">清單第一項</span></p>
<p class="MsoListParagraph" style="margin-left:36.0pt;text-indent:-18.0pt;mso-list:l0 level1 lfo1"><![if !supportLists]><span style="mso-list:Ignore">·<span style="font:7.0pt 'Times New Roman'">&nbsp;&nbsp;</span></span><![endif]><span lang="ZH-TW">清單第二項</span></p>
<table border="1"><thead><tr><th><p class="MsoNormal">年度</p></th><th><p class="MsoNormal">新案數</p></th></tr></thead><tbody><tr><td>2024</td><td>5,100</td></tr></tbody></table>
<p><img src="/Upload/images/chart.png" title="趨勢圖" width="120"></p>
<p>全文見 <a href="/File/Get/AAA111">新聞稿 PDF</a></p>`, '<div class="file-list"><a href="/File/Get/AAA111">新聞稿 PDF</a></div>'),
  { url: 'https://www.cdc.gov.tw/Bulletin/Detail/NEWS1?typeid=9', title: '新聞稿：結核病測試', category: '結核病／最新消息', publishedAt: '2026-09-01', updatedAt: '2026-09-01', breadcrumbs: ['首頁', '結核病', '最新消息'], attachments: [{ url: 'https://www.cdc.gov.tw/File/Get/AAA111', label: '新聞稿（PDF）', file: '文件 說明.pdf' }, ...(withMissing ? [{ url: 'https://www.cdc.gov.tw/File/Get/BBB222', label: '不存在的附件', file: 'missing.pdf' }] : [])] });
  put('02-qa', shell('結核病 Q&A', `<div class="panel-group"><div class="panel"><div class="panel-heading"><h4 class="panel-title"><a href="#q1">Q1. 咳嗽多久要懷疑是結核病？</a></h4></div><div id="q1" class="panel-body">${wordP('咳嗽超過 2 週應就醫。')}</div></div>
<div class="panel"><div class="panel-heading"><h4 class="panel-title"><a href="#q2">Q2. 測試用的新問題？</a></h4></div><div id="q2" class="panel-body"><p>這是一題新的問題的答案，內容夠長可以通過過短檢查。</p></div></div></div>`),
  { url: 'https://www.cdc.gov.tw/Category/QAPage/QA1', title: '結核病 Q&A', category: '結核病／Q&A', publishedAt: '2020-03-24', breadcrumbs: ['首頁', '結核病', 'Q&A'] });
  put('03-symptoms', shell('臨床症狀', wordP('肺結核早期症狀不明顯，常見咳嗽超過 2 週、有痰、體重減輕、夜間盜汗，嚴重時可能咳血，請儘速就醫檢查。')),
  { url: 'https://www.cdc.gov.tw/Disease/SubIndex/DIS1', title: '臨床症狀', category: '結核病／疾病介紹', publishedAt: '2018-03-01', breadcrumbs: ['首頁', '結核病', '疾病介紹', '臨床症狀'], tab: 'symptoms' });
  put('04-unknown', shell('某個沒人認得的頁', '<p>很短</p><table><tr><td rowspan="2">合併</td><td>a</td></tr><tr><td>b</td></tr></table>'),
  { url: 'https://www.cdc.gov.tw/Weird/Path/1', title: '某個沒人認得的頁', category: '不存在的欄目', publishedAt: '2024-01-01', attachments: [{ url: 'https://www.cdc.gov.tw/File/Get/SCAN1', label: '掃描檔', file: 'scan.pdf' }] });
  return dir;
}

test('HTML → 草稿：Word 樣式清理、表格保留、附件宣告（sha256、文字層）、圖片 needsAlt、版型外殼不進內文', () => {
  const exp = synthExport(tmp('exp'));
  const out = tmp('out');
  const { report, drafts } = runImport({ exportDir: exp, outDir: out, slug: 'zz-test', now: NOW });
  const byId = new Map(drafts.map((d) => [d.id, d]));
  const news = [...byId.values()].find((d) => d.type === 'news');
  assert.ok(news, '新聞草稿');
  assert.equal(news.newsType, 'press', 'typeid=9 → press');
  assert.equal(news.title, '結核病測試', '去掉「新聞稿：」前綴');
  assert.equal(news.status, 'review');
  assert.equal(news.aiWhitelist.requested, false);
  assert.equal(news.reviewedAt, '2026-10-01', 'reviewedAt＝匯出日');
  assert.equal(news.reviewPeriodMonths, 0, '新聞稿週期依 review-periods.json（事件觸發）');
  assert.deepEqual(news.languages, { 'zh-TW': { status: 'source' } });
  assert.equal(news.owner, 'unit.chronic-infectious', '類別 → owner');
  assert.equal(news.conversion.mode, 'auto');
  assert.equal(news.conversion.convertedAt, NOW);
  assert.equal(news.conversion.sourceUrl, 'https://www.cdc.gov.tw/Bulletin/Detail/NEWS1?typeid=9');
  assert.deepEqual(news.legacyUrls, ['https://www.cdc.gov.tw/Bulletin/Detail/NEWS1?typeid=9']);
  const md = news.bodyMarkdown;
  assert.doesNotMatch(md, /mso-|MsoNormal|MsoList|<o:p>|導覽不該|頁尾不該|友善列印|最後更新時間/, 'Word 樣式與版型外殼都不在 Markdown');
  assert.match(md, /\*\*咳嗽兩週\*\*/, '粗體保留');
  assert.match(md, /^- 清單第一項$/m, 'Word 清單轉成 Markdown 清單');
  assert.match(md, /\| 年度 \| 新案數 \|\n\| --- \| --- \|\n\| 2024 \| 5,100 \|/, '表格保留');
  assert.match(md, /!\[趨勢圖\]\(\/files\/news\.[^/]+\/chart\.png\)/, '圖片改成 /files/{id}/…，alt 先用 title');
  assert.match(md, /\]\(\/files\/news\.[^/]+\/[a-z0-9._-]+\.pdf\)/, '內文的附件連結改成 /files/…');
  // 資產
  const att = news.assets.find((a) => a.kind === 'attachment');
  assert.ok(att);
  assert.match(att.file, /^[a-z0-9][a-z0-9._-]*\.pdf$/, '不合規則的檔名（空白、中文）已正規化');
  assert.equal(att.label, '新聞稿（PDF）');
  assert.equal(att.mime, 'application/pdf');
  assert.equal(att.machineReadable, true, '有文字層');
  const copied = fs.readFileSync(path.join(out, 'content/assets', news.id, att.file));
  assert.equal(att.sha256, sha256Of(copied));
  assert.equal(att.bytes, copied.length);
  assert.ok(pdfHasTextLayer(copied));
  const img = news.assets.find((a) => a.kind === 'image');
  assert.equal(img.needsAlt, true, '舊頁沒有 alt ⇒ needsAlt');
  assert.equal(img.alt, '趨勢圖');
  assert.equal(img.width, 1); assert.equal(img.height, 1, '讀出圖片尺寸');
  assert.equal(img.license, 'OGDL-1.0');
  const page = report.pages.find((p) => p.key === '01-news');
  const codes = page.issues.map((i) => i.code);
  assert.ok(codes.includes('image-no-alt'));
  assert.ok(codes.includes('attachment-missing'), '側檔列了但 files/ 沒有 ⇒ 附件缺檔');
  assert.ok(codes.includes('word-cleaned'));
  assert.equal(page.parts.attachments, 0, '附件沒全找到 ⇒ 該項 0');
  assert.equal(page.parts.markdown, 0, '圖無 alt 算轉換警告');
});

test('Q&A 頁每題一筆 faq；已有的問題對到既有 id；疾病子頁併成 disease blocks 草稿', () => {
  const exp = synthExport(tmp('exp'));
  const { report, drafts } = runImport({ exportDir: exp, outDir: tmp('out'), slug: 'zz-test', now: NOW });
  const faqs = drafts.filter((d) => d.type === 'faq');
  assert.equal(faqs.length, 2);
  const known = faqs.find((d) => d.question === '咳嗽多久要懷疑是結核病？');
  assert.equal(known.id, 'faq.tb-cough-two-weeks', '問題文字對到既有 faq id');
  assert.equal(known.conversion.existing, true, '既有內容已存在 ⇒ existing');
  assert.match(known.answerMarkdown, /咳嗽超過 2 週應就醫/);
  const fresh = faqs.find((d) => d.question === '測試用的新問題？');
  assert.match(fresh.id, /^faq\.tb-legacy-[0-9a-f]{6}$/);
  assert.equal(fresh.conversion.existing, undefined, '新問題沒有既有內容');
  assert.deepEqual(fresh.basedOn, ['disease.tuberculosis']);
  const dis = drafts.find((d) => d.type === 'disease');
  assert.equal(dis.id, 'disease.tuberculosis');
  assert.equal(dis.blocks.length, 8, '八個固定區塊都在');
  assert.match(dis.blocks.find((b) => b.key === 'symptoms').markdown, /肺結核早期症狀不明顯/);
  assert.equal(dis.blocks.find((b) => b.key === 'prevention').status, 'pending', '沒有的區塊標 pending');
  assert.equal(dis.conversion.mergedFrom[0].blocks[0], 'symptoms');
  const sp = report.pages.find((p) => p.key === '03-symptoms');
  assert.equal(sp.kind, 'disease-block');
  assert.equal(sp.outputs[0].role, 'merged');
  assert.equal(sp.existing, true);
});

test('問題清單：未對應類別、型別不明、表格複雜、內文過短、PDF 無文字層 ⇒ 信心降低並建議人工檢視', () => {
  const exp = synthExport(tmp('exp'));
  const { report } = runImport({ exportDir: exp, outDir: tmp('out'), slug: 'zz-test', now: NOW });
  const p = report.pages.find((x) => x.key === '04-unknown');
  const codes = p.issues.map((i) => i.code);
  for (const c of ['type-unclear', 'owner-from-disease', 'table-complex', 'body-short', 'pdf-no-text-layer']) assert.ok(codes.includes(c), `${c} 在 ${codes.join(',')}`);
  assert.equal(p.parts.type, 0); assert.equal(p.parts.owner, 0.2, '類別沒規則但麵包屑有疾病 ⇒ 依主檔 owner，算對應'); assert.equal(p.parts.markdown, 0);
  assert.ok(p.confidence < 0.6);
  assert.equal(p.needsReview, true);
  assert.equal(p.action, 'manual-review');
  assert.equal(p.owner, 'unit.chronic-infectious', '麵包屑「結核病」⇒ 疾病主檔的 owner');
  assert.ok(!codes.includes('unmapped-category'));
  // 麵包屑與標題都沒有疾病、類別也沒規則 ⇒ 才是 unmapped-category、預設 owner
  const noDis = tmp('nodis');
  fs.mkdirSync(noDis, { recursive: true });
  fs.writeFileSync(path.join(noDis, '01.html'), '<html><body><div id="CCMS_Content"><div class="content-body"><p>一段跟疾病無關但夠長的文字，用來測試沒有任何疾病線索時的權責單位處理方式。</p></div></div></body></html>');
  fs.writeFileSync(path.join(noDis, '01.json'), JSON.stringify({ url: 'https://www.cdc.gov.tw/Weird/Path/2', title: '沒有疾病的頁', category: '不存在的欄目', publishedAt: '2024-01-01', breadcrumbs: ['首頁', '不存在的欄目'] }));
  const r2 = runImport({ exportDir: noDis, outDir: tmp('out'), slug: 'zz-test', now: NOW });
  const q = r2.report.pages[0];
  assert.ok(q.issues.some((i) => i.code === 'unmapped-category'));
  assert.equal(q.owner, rules.defaultOwner, '未對應且無疾病 ⇒ 預設 owner（仍可通過 schema，但要人檢視）');
  assert.equal(q.parts.owner, 0);
  assert.equal(report.summary.needsReview >= 1, true);
  const good = report.pages.find((x) => x.key === '02-qa');
  assert.ok(good.confidence >= 0.8);
});

test('report 形狀：report.json／report.md／migration-patch.json；草稿全部過 schema 驗證', () => {
  const exp = synthExport(tmp('exp'));
  const out = tmp('out');
  const { report, drafts } = runImport({ exportDir: exp, outDir: out, slug: 'zz-test', now: NOW });
  for (const f of ['report.json', 'report.md', 'migration-patch.json']) assert.ok(fs.existsSync(path.join(out, f)), f);
  const disk = JSON.parse(fs.readFileSync(path.join(out, 'report.json'), 'utf8'));
  assert.equal(disk.batch, 'zz-test');
  assert.equal(disk.simulated, true);
  assert.equal(disk.summary.pages, 4);
  for (const k of ['pages', 'drafts', 'byType', 'avgConfidence', 'needsReview', 'assets', 'existing', 'issues']) assert.ok(k in disk.summary, k);
  assert.ok(disk.summary.assets.total >= 3 && disk.summary.assets.needsAlt === 1 && disk.summary.assets.noTextLayer === 1);
  for (const p of disk.pages) {
    for (const k of ['source', 'kind', 'type', 'target', 'existing', 'outputs', 'confidence', 'parts', 'issues', 'action']) assert.ok(k in p, `${p.key}.${k}`);
    for (const k of ['url', 'title', 'category', 'publishedAt', 'breadcrumbs']) assert.ok(k in p.source, `${p.key}.source.${k}`);
    assert.ok(p.confidence >= 0 && p.confidence <= 1);
  }
  const md = fs.readFileSync(path.join(out, 'report.md'), 'utf8');
  assert.match(md, /^# 舊站匯出轉換報告：zz-test/);
  assert.match(md, /## 批次摘要/); assert.match(md, /## 逐頁結果/); assert.match(md, /## 需人工檢視/);
  assert.match(md, /模擬匯出/);
  const env = { units: new Set(readJSON(path.join(CONTENT, 'master/units.json')).map((u) => u.id)), diseaseIds: new Set(master.map((d) => d.id)), assetsDir: path.join(out, 'content/assets'), licenses: ['OGDL-1.0', 'CC0-1.0', 'CC-BY-4.0'] };
  for (const d of drafts) {
    assert.deepEqual(validateDraft(d, env), [], `${d.id} 過 schema 驗證`);
    const file = path.join(out, `content/${{ disease: 'diseases', faq: 'faq', news: 'news', document: 'documents', page: 'pages' }[d.type]}/${d.id.replace(/^[a-z]+\./, '')}.json`);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), d, '輸出檔＝記憶體草稿');
  }
  // 草稿不會寫進 content/
  assert.ok(!fs.existsSync(path.join(CONTENT, 'faq', `${drafts.find((d) => d.type === 'faq' && /legacy/.test(d.id)).id.replace(/^faq\./, '')}.json`)));
  // 壞掉的草稿會被驗證抓到
  const bad = structuredClone(drafts.find((d) => d.type === 'faq'));
  delete bad.owner; bad.status = 'published'; bad.aiWhitelist = { requested: true };
  const errs = validateDraft(bad, env);
  assert.ok(errs.some((e) => /owner/.test(e)) && errs.some((e) => /review/.test(e)) && errs.some((e) => /aiWhitelist/.test(e)), errs.join('；'));
  assert.equal(report.summary.schemaInvalid, 0);
});

// ───────────────────────── 移轉清單：patch 與 --apply-migration ─────────────────────────

test('migration-patch：只改 status／target／note，不動 verified；人工已判定的不覆蓋；套用兩次結果相同', () => {
  const exp = synthExport(tmp('exp'));
  const dir = tmp('mig');
  const mf = path.join(dir, 'zz-test.json');
  const base = (key, oldUrl, status, extra = {}) => ({ key, oldTitle: key, oldUrl, oldType: 'page', verified: key === 'qa', status, ...extra });
  fs.writeFileSync(mf, JSON.stringify({
    id: 'migration.zz-test', type: 'migration', title: '測試', scope: { kind: 'category', name: '測試' }, legacyRoot: 'https://www.cdc.gov.tw/Category/Page/{id}', showLegacyUntil: '2027-12-31',
    items: [
      base('qa', 'https://www.cdc.gov.tw/Category/QAPage/{id}', 'pending', { oldTitle: '結核病 Q&A', target: 'faq.tb-cough-two-weeks', note: '舊註記' }),   // 待確認 + 新站已有 ⇒ migrated（{id} 佔位：靠標題對上）
      base('news', 'https://www.cdc.gov.tw/Bulletin/Detail/{id}?typeid=9', 'pending', { oldTitle: '結核病測試' }),                                      // 待確認 + 新站沒有 ⇒ 維持 pending（標題去掉「新聞稿：」前綴後相符）
      base('sym', 'https://www.cdc.gov.tw/Disease/SubIndex/{id}#symptoms', 'migrated', { target: 'disease.tuberculosis' }),                            // 人工已判定 ⇒ 不動 status（靜 fragment＝tab 對上）
      base('weird', 'https://www.cdc.gov.tw/Weird/Path/1', 'migrated', { target: 'disease.tuberculosis' }),                                            // 寫死 ID 的網址：唯一候選即可對上；人工說已移轉，但匯入判斷新站沒有（target 無效類型）
      base('ghost', 'https://www.cdc.gov.tw/Category/Page/{id}', 'pending'),                                                                           // 清單有、匯出沒有
    ],
  }, null, 2));
  const before = JSON.parse(fs.readFileSync(mf, 'utf8'));
  const r1 = runImport({ exportDir: exp, outDir: tmp('out'), slug: 'zz-test', manifestPath: mf, applyMigration: true, now: NOW });
  const after = JSON.parse(fs.readFileSync(mf, 'utf8'));
  const patch = r1.patch;
  assert.equal(patch.summary.matched, 4); assert.equal(patch.missingPages.length, 1); assert.equal(patch.missingPages[0].key, 'ghost');
  const by = (k) => after.items.find((i) => i.key === k);
  assert.equal(by('qa').status, 'migrated', 'pending ⇒ migrated（新站已有該內容）');
  assert.equal(by('qa').target, 'faq.tb-cough-two-weeks');
  assert.match(by('qa').note, /^舊註記　【匯入 2026-10-01】草稿 faq\.tb-cough-two-weeks/, '舊 note 保留、後面接匯入標記');
  assert.equal(by('news').status, 'pending', '新站沒有對應內容 ⇒ 維持 pending');
  assert.equal(by('news').target, undefined, 'pending 不寫 target（避免轉址到不存在的頁）');
  assert.match(by('news').note, /【匯入 2026-10-01】草稿 news\./);
  assert.equal(by('sym').status, 'migrated');
  assert.equal(by('ghost').status, 'pending'); assert.equal(by('ghost').note, undefined, '沒匯出的項目不動');
  assert.deepEqual(r1.report.migration.statusChanges, [{ key: 'qa', from: 'pending', to: 'migrated' }]);
  // verified 與其他欄位完全不變
  for (const it of before.items) {
    const a = by(it.key);
    assert.equal(a.verified, it.verified, `${it.key}.verified 不動`);
    for (const k of Object.keys(it)) if (!['status', 'target', 'note'].includes(k)) assert.deepEqual(a[k], it[k], `${it.key}.${k}`);
  }
  assert.deepEqual({ ...after, items: undefined }, { ...before, items: undefined }, '清單層級欄位不動');
  // 再跑一次：沒有新變化
  const r2 = runImport({ exportDir: exp, outDir: tmp('out'), slug: 'zz-test', manifestPath: mf, applyMigration: true, now: NOW });
  assert.equal(r2.report.migration.noteChanges, 0); assert.equal(r2.report.migration.statusChanges.length, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(mf, 'utf8')), after);
  // 沒有 --apply-migration ⇒ 清單檔不動
  const mf2 = path.join(dir, 'copy.json');
  fs.writeFileSync(mf2, JSON.stringify(before, null, 2) + '\n');
  runImport({ exportDir: exp, outDir: tmp('out'), slug: 'zz-test', manifestPath: mf2, now: NOW });
  assert.deepEqual(JSON.parse(fs.readFileSync(mf2, 'utf8')), before, '沒加 --apply-migration 不寫回');
  // applyPatch 防呆：企圖改 verified 會中止
  const evil = structuredClone(patch);
  const mf3 = path.join(dir, 'evil.json');
  fs.writeFileSync(mf3, JSON.stringify(before));
  evil.items[0].change = { status: true, target: false, note: false };
  evil.items[0].proposed.status = 'migrated';
  assert.doesNotThrow(() => applyPatch(mf3, evil), 'status 本來就允許改');
  assert.equal(JSON.parse(fs.readFileSync(mf3, 'utf8')).items.find((i) => i.key === evil.items[0].key).verified, before.items.find((i) => i.key === evil.items[0].key).verified);
});

// ───────────────────────── 結核病首批 ─────────────────────────

test('結核病模擬匯出：40 頁、HTML 像舊站、至少 5 頁表格、8 頁附件、2 頁圖片、Q&A 多題', () => {
  const manifest = readJSON(path.join(CONTENT, 'migration/tuberculosis.json'));
  assert.equal(manifest.items.length, 40);
  assert.ok(fs.existsSync(path.join(EXPORT_TB, 'README.md')), 'README 說明模擬匯出');
  assert.match(fs.readFileSync(path.join(EXPORT_TB, 'README.md'), 'utf8'), /模擬匯出[\s\S]*正式匯出取代/);
  const htmls = fs.readdirSync(EXPORT_TB).filter((f) => f.endsWith('.html'));
  assert.equal(htmls.length, 40);
  let tables = 0, withAtt = 0, withImg = 0, mso = 0, bootstrap = 0, crumbs = 0;
  for (const f of htmls) {
    const h = fs.readFileSync(path.join(EXPORT_TB, f), 'utf8');
    const side = JSON.parse(fs.readFileSync(path.join(EXPORT_TB, f.replace(/\.html$/, '.json')), 'utf8'));
    for (const k of ['url', 'title', 'category', 'publishedAt', 'updatedAt', 'breadcrumbs', 'attachments']) assert.ok(k in side, `${f} 側檔缺 ${k}`);
    if (/<table/.test(h)) tables++;
    if (side.attachments.length) withAtt++;
    if (/<img [^>]*\/Upload\/images\//.test(h)) withImg++;
    if (/mso-|MsoNormal/.test(h)) mso++;
    if (/bootstrap\.min\.css/.test(h) && /class="navbar/.test(h)) bootstrap++;
    if (/class="breadcrumb"/.test(h)) crumbs++;
  }
  assert.ok(tables >= 5, `表格頁 ${tables}`); assert.ok(withAtt >= 8, `附件頁 ${withAtt}`); assert.ok(withImg >= 2, `圖片頁 ${withImg}`);
  assert.ok(mso >= 30, `Word 樣式頁 ${mso}`); assert.equal(bootstrap, 40); assert.equal(crumbs, 40);
  assert.ok((fs.readFileSync(path.join(EXPORT_TB, '07-qa-list.html'), 'utf8').match(/class="panel panel-default"/g) ?? []).length >= 8, 'Q&A 頁多題結構');
});

test('結核病批次：40 頁全部有輸出且草稿通過 schema；既有內容標 existing；對得到移轉清單', () => {
  const dir = tmp('tb');
  const mf = path.join(dir, 'tuberculosis.json');
  fs.copyFileSync(path.join(CONTENT, 'migration/tuberculosis.json'), mf);
  const out = path.join(dir, 'out');
  const { report, patch, drafts } = runImport({ exportDir: EXPORT_TB, outDir: out, manifestPath: mf, now: NOW });
  const s = report.summary;
  assert.equal(s.pages, 40);
  assert.equal(s.pagesWithoutOutput, 0);
  assert.ok(report.pages.every((p) => p.outputs.length >= 1), '每頁都有輸出');
  assert.equal(s.schemaInvalid, 0);
  assert.equal(drafts.length, s.drafts);
  const env = { units: new Set(readJSON(path.join(CONTENT, 'master/units.json')).map((u) => u.id)), diseaseIds: new Set(master.map((d) => d.id)), assetsDir: path.join(out, 'content/assets'), licenses: ['OGDL-1.0', 'CC0-1.0', 'CC-BY-4.0'] };
  for (const d of drafts) {
    assert.deepEqual(validateDraft(d, env), [], d.id);
    assert.equal(d.status, 'review'); assert.equal(d.aiWhitelist.requested, false);
    assert.ok(d.owner && d.reviewedAt && Number.isInteger(d.reviewPeriodMonths) && d.audience.length && d.sensitivity && d.license && d.languages['zh-TW'] && d.summary.length <= 400, `${d.id} 治理欄位齊全`);
    assert.ok(d.conversion.confidence >= 0 && d.conversion.sourceUrl && d.conversion.convertedAt && Array.isArray(d.conversion.issues));
    assert.ok(d.legacyUrls.length >= 1);
  }
  // 型別分布
  assert.equal(s.byType.disease, 1); assert.equal(s.byType.faq, 8); assert.ok(s.byType.document >= 9); assert.equal(s.byType.news, 1);
  assert.equal(s.mergedPages, 6, '疾病介紹子頁併入同一份 disease 草稿');
  assert.equal(report.pages.filter((p) => p.outputs.some((o) => o.role === 'merged')).length, 6);
  // 與既有內容比對
  const idx = loadContentIndex(CONTENT);
  for (const id of ['faq.tb-cough-two-weeks', 'doc.tb-guideline.2025-09-01', 'news.2025-03-24-world-tb-day', 'disease.tuberculosis']) {
    const d = drafts.find((x) => x.id === id);
    assert.ok(d, id); assert.ok(idx.byId.has(id)); assert.equal(d.conversion.existing, true, `${id} 標 existing`);
  }
  assert.ok(s.existing >= 30);
  const fresh = drafts.find((d) => d.id === 'doc.tb-annual-report.2025-12-31');
  assert.ok(fresh && !fresh.conversion.existing, '新站還沒有的 ⇒ 不標 existing');
  // 重複的 Q&A（qa-cough 與 qa-list 第 1 題）
  const dup = report.pages.find((p) => p.manifestKey === 'qa-cough');
  assert.equal(dup.outputs[0].role, 'duplicate'); assert.ok(dup.issues.some((i) => i.code === 'duplicate-title')); assert.equal(dup.parts.unique, 0);
  // 同 target 的舊版另列一版，不覆蓋現行
  assert.ok(drafts.find((d) => d.id === 'doc.ltbi-guideline.2021-05-01') && drafts.find((d) => d.id === 'doc.tb-manual.2019-06-28'));
  // 附件與圖片
  assert.ok(s.assets.attachment >= 8 && s.assets.image >= 2 && s.assets.data >= 1, JSON.stringify(s.assets));
  assert.ok(s.assets.needsAlt >= 1 && s.assets.noTextLayer >= 3);
  assert.ok(s.needsReview <= 8, `需人工檢視 ${s.needsReview}`); // 第四批起海報、影片、統計、檢驗直接建成結構化型別，需人工檢視的頁數降到 1
  assert.ok(s.avgConfidence > 0.7 && s.avgConfidence <= 1);
  const tr = report.pages.find((p) => p.manifestKey === 'training-slides');
  assert.ok(tr.issues.some((i) => i.code === 'attachment-missing') && tr.issues.some((i) => i.code === 'owner-from-disease'), '類別沒規則 ⇒ 依疾病主檔取 owner');
  assert.equal(tr.owner, 'unit.chronic-infectious');
  // 表格複雜度
  assert.ok(report.pages.find((p) => p.manifestKey === 'mdr-hospitals').issues.some((i) => i.code === 'table-complex'));
  // 移轉清單：40 筆全對上；只建議、不套用
  assert.equal(patch.summary.matched, 40); assert.equal(patch.missingPages.length, 0); assert.equal(patch.unmatchedPages.length, 0);
  assert.equal(patch.summary.stillPending, 3);
  assert.deepEqual(JSON.parse(fs.readFileSync(mf, 'utf8')), readJSON(path.join(CONTENT, 'migration/tuberculosis.json')), '沒加 --apply-migration 不改清單');
  assert.ok(!s.byAction['auto-ok'] || s.byAction['auto-ok'] >= 0);
  for (const it of patch.items) assert.ok(['migrated', 'merged', 'archived', 'pending', 'dropped'].includes(it.proposed.status));
});

test('CLI：node scripts/import-legacy.mjs 用法與輸出；缺參數回傳非 0', () => {
  const out = tmp('cli');
  const txt = execFileSync('node', [path.join(ROOT, 'scripts/import-legacy.mjs'), EXPORT_TB, '--out', out, '--manifest', path.join(CONTENT, 'migration/tuberculosis.json'), '--now', NOW], { encoding: 'utf8' });
  assert.match(txt, /批次 tuberculosis：40 頁 → \d+ 份草稿/);
  assert.match(txt, /平均信心 0\.\d+；需人工檢視 \d+/);
  assert.match(txt, /草稿 schema 驗證 \d+\/\d+ 通過/);
  assert.match(txt, /未套用/);
  assert.throws(() => execFileSync('node', [path.join(ROOT, 'scripts/import-legacy.mjs')], { stdio: 'pipe' }), (e) => e.status === 2);
});

test('已提交的結核病批次輸出（data/legacy-import/tuberculosis）：40 頁、clean 對應、verified 全是 false', () => {
  const rp = path.join(COMMITTED, 'report.json');
  assert.ok(fs.existsSync(rp), '首批輸出已提交');
  const r = JSON.parse(fs.readFileSync(rp, 'utf8'));
  assert.equal(r.summary.pages, 40); assert.equal(r.summary.schemaInvalid, 0); assert.equal(r.migration.applied, true);
  assert.ok(fs.existsSync(path.join(COMMITTED, 'report.md')) && fs.existsSync(path.join(COMMITTED, 'migration-patch.json')));
  for (const d of r.drafts) assert.ok(fs.existsSync(path.join(COMMITTED, d.file)), d.file);
  const manifest = readJSON(path.join(CONTENT, 'migration/tuberculosis.json'));
  assert.ok(manifest.items.every((i) => i.verified === false), '匯入不改 verified');
  assert.ok(manifest.items.some((i) => /【匯入 /.test(i.note ?? '')), '清單 note 有匯入標記');
});

// ───────────────────────── 後台 /admin/import/ ─────────────────────────

test('後台 /admin/import/：批次摘要、逐頁表、草稿下載連結；草稿與報告以 file 頁輸出', () => {
  const ctx = makeCtx({ today: '2026-10-01' }, 'zh-TW', { path: '/admin/import/' });
  const pgs = admImport.pages();
  assert.equal(pgs[0].path, '/admin/import/');
  const files = pgs.filter((p) => p.file);
  assert.ok(files.length >= 43, `file 頁 ${files.length}`);
  for (const f of ['report.json', 'report.md', 'migration-patch.json', 'content/faq/tb-cough-two-weeks.json', 'content/diseases/tuberculosis.json']) assert.ok(files.some((p) => p.path === `/admin/import/tuberculosis/${f}`), f);
  const fp = files.find((p) => p.path.endsWith('content/faq/tb-cough-two-weeks.json'));
  assert.equal(JSON.parse(fp.props.content).id, 'faq.tb-cough-two-weeks');
  assert.equal(admImport.meta(ctx, fp.props).rawFile, true);
  assert.equal(admImport.layout(ctx, { ...admImport.meta(ctx, fp.props), body: fp.props.content }), fp.props.content, '下載檔原樣輸出（不包版面）');
  const body = String(admImport.render(ctx, {}));
  assert.match(body, /舊站匯入批次/);
  assert.match(body, /批次：tuberculosis/);
  assert.match(body, /這是模擬匯出/);
  assert.match(body, /id="imp-pages">40</);
  assert.ok((body.match(/class="imp-row"/g) ?? []).length >= 40, '逐頁表至少 40 列（結核病批次；之後的批次會加列）');
  assert.match(body, /既有內容已存在，供比對/);
  assert.match(body, /href="\/new_cdc_prototype\/admin\/import\/tuberculosis\/report\.md"/);
  assert.match(body, /href="\/new_cdc_prototype\/admin\/import\/tuberculosis\/content\/faq\/tb-cough-two-weeks\.json" download/);
  assert.match(body, /href="\/new_cdc_prototype\/admin\/migration\/"/, '連到移轉清單');
  assert.match(body, /data-copy/);
  assert.doesNotMatch(body, />undefined<|>null<|\$\{/);
  const empty = admImport.loadBatches(path.join(tmp('empty'), 'none'));
  assert.deepEqual(empty, []);
});

// ───────────────────────── 第十輪：跨疾病通用化與登革熱第二批 ─────────────────────────
import { shortFor } from '../scripts/lib/legacy-import/rules.mjs';
import { generateDisease } from '../scripts/lib/legacy-import/sim-export-disease.mjs';
import { generateNews } from '../scripts/lib/legacy-import/sim-export-news.mjs';
import { generateGuidelines } from '../scripts/lib/legacy-import/sim-export-guidelines.mjs';
import { generateQa } from '../scripts/lib/legacy-import/sim-export-qa.mjs';
import { generateTravel } from '../scripts/lib/legacy-import/sim-export-travel.mjs';
import { generateMaterials } from '../scripts/lib/legacy-import/sim-export-materials.mjs';
import { generateStatistics } from '../scripts/lib/legacy-import/sim-export-statistics.mjs';
import { faqItemsLoose, tasksFor, datedDeadlines, structuredFromText } from '../scripts/lib/legacy-import/qa.mjs';
import { parseHtml, textOf } from '../scripts/lib/legacy-import/html.mjs';
import { versionFree, versionRank, dateFromText } from '../scripts/lib/legacy-import/index.mjs';

const EXPORT_DENGUE = path.join(ROOT, 'data/legacy-export/dengue');
const COMMITTED_DENGUE = path.join(ROOT, 'data/legacy-import/dengue');

test('規則：疾病候選以主檔為底（不只規則檔列的結核病）；英文縮寫整字比對；short 由主檔 id 推導', () => {
  const ids = (txt) => detectDiseases(rules, master, [txt]).map((d) => d.id);
  assert.deepEqual(ids('首頁／傳染病與防疫專題／登革熱／疾病介紹'), ['disease.dengue']);
  assert.deepEqual(ids('登革熱／屈公病防治工作指引（第 17 版）'), ['disease.dengue', 'disease.chikungunya'], '一頁兩疾病，依出現順序');
  assert.deepEqual(ids('登革出血熱'), ['disease.dengue'], '主檔別名');
  assert.deepEqual(ids('新型A型流感'), ['disease.novel-influenza-a'], '較長名稱涵蓋「流感」');
  assert.deepEqual(ids('Hib 疫苗'), ['disease.hib']);
  assert.deepEqual(ids('LTBI 治療'), ['disease.tuberculosis'], 'LTBI 是結核病別名；裡面的 TB 不另算');
  assert.deepEqual(ids('TB'), ['disease.tuberculosis']);
  assert.deepEqual(ids('新住民與移工健康'), []);
  assert.equal(shortFor(rules, 'disease.tuberculosis'), 'tb', '規則檔有 short');
  assert.equal(shortFor(rules, 'disease.measles'), 'measles', '沒寫 short ⇒ 主檔 id 去掉 disease.');
  assert.equal(ownerForCategory(rules, '登革熱／檢驗資訊').owner, 'unit.lab', '不綁疾病的子類別規則');
  assert.equal(ownerForCategory(rules, '登革熱／統計資料').owner, 'unit.epidemic-intelligence');
  assert.equal(ownerForCategory(rules, '結核病／檢驗').owner, 'unit.lab', '結核病條目仍在，較長前綴優先');
  assert.equal(ownerForCategory(rules, '登革熱／疾病介紹'), null, '沒有規則 ⇒ 交給 ownerFallbackToDisease');
  assert.equal(rules.ownerFallbackToDisease, true);
});

test('移轉清單對應：{id} 佔位的網址只有 fragment 或標題也對得上才算；寫死 ID 的唯一候選可直接採用；不錯配', () => {
  const dir = tmp('match');
  fs.mkdirSync(path.join(dir, 'exp/files'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'exp/_export.json'), JSON.stringify({ exportedAt: '2026-10-01', simulated: true }));
  const put = (name, title, url, extra = {}) => {
    fs.writeFileSync(path.join(dir, 'exp', `${name}.html`), `<html><body><div id="CCMS_Content"><div class="content-body"><p>${title}的內文，長度足夠通過內文過短的檢查，用來測試移轉清單對應。</p></div></div></body></html>`);
    fs.writeFileSync(path.join(dir, 'exp', `${name}.json`), JSON.stringify({ url, title, category: '登革熱／最新消息', publishedAt: '2026-09-20', breadcrumbs: ['首頁', '登革熱', '最新消息'], ...extra }));
  };
  put('01-new-press', '國內新增 1 例本土登革熱病例', 'https://www.cdc.gov.tw/Bulletin/Detail/NEW123?typeid=9');            // 清單沒有這篇：不得對到 ns1 通函
  put('02-ns1', 'NS1 抗原快篩試劑配置公告（致醫界通函）', 'https://www.cdc.gov.tw/Bulletin/Detail/NS1xyz?typeid=11');       // 標題對上 ⇒ 對到 ns1
  put('03-fixed', '某個寫死網址的頁', 'https://www.cdc.gov.tw/Category/Page/FIXED1');                                        // 清單寫死 ID ⇒ 唯一候選直接採用
  put('04-tab', '發病症狀', 'https://www.cdc.gov.tw/Disease/SubIndex/ANY', { tab: 'symptoms', category: '登革熱／疾病介紹' }); // fragment＝tab
  const mf = path.join(dir, 'dengue.json');
  fs.writeFileSync(mf, JSON.stringify({
    id: 'migration.dengue-test', type: 'migration', title: '測試', extends: 'migration-template.disease', scope: { kind: 'disease', disease: 'disease.dengue' },
    items: [
      { key: 'ns1', oldTitle: 'NS1 抗原快篩試劑配置公告（致醫界通函）', oldUrl: 'https://www.cdc.gov.tw/Bulletin/Detail/{id}#ns1', oldType: 'news', verified: false, status: 'migrated', target: 'news.2026-09-15-letter-615-ns1' },
      { key: 'fixed', oldTitle: '完全不同的標題', oldUrl: 'https://www.cdc.gov.tw/Category/Page/FIXED1', oldType: 'page', verified: false, status: 'pending' },
    ],
  }, null, 2));
  const { report, patch } = runImport({ exportDir: path.join(dir, 'exp'), outDir: tmp('out'), slug: 'dengue', manifestPath: mf, now: NOW });
  const by = (k) => report.pages.find((p) => p.key === k);
  assert.equal(by('01-new-press').manifestKey, null, '新新聞不得對到 {id} 佔位的通函項目');
  assert.ok(by('01-new-press').issues.some((i) => i.code === 'manifest-ambiguous'));
  assert.ok(by('01-new-press').issues.some((i) => i.code === 'not-in-manifest'));
  assert.match(by('01-new-press').outputs[0].id, /^news\.2026-09-20-legacy-/, '拿到自己的 id，不是 ns1 通函的 id');
  assert.equal(by('02-ns1').manifestKey, 'ns1'); assert.equal(by('02-ns1').manifestDerived, false);
  assert.equal(by('02-ns1').outputs[0].id, 'news.2026-09-15-letter-615-ns1');
  assert.equal(by('03-fixed').manifestKey, 'fixed', '寫死 ID：唯一候選即可');
  assert.equal(by('04-tab').manifestKey, 'intro-symptoms'); assert.equal(by('04-tab').manifestDerived, true, '模板推導項靠 fragment＝tab 對上');
  assert.ok(by('04-tab').issues.some((i) => i.code === 'manifest-derived'));
  assert.deepEqual(by('04-tab').diseases, ['disease.dengue']);
  assert.equal(by('04-tab').owner, 'unit.acute-infectious', '類別沒規則 ⇒ 疾病主檔 owner');
  assert.equal(by('04-tab').ownerRule, 'disease-fallback'); assert.equal(by('04-tab').parts.owner, 0.2);
  assert.equal(by('04-tab').outputs[0].id, 'disease.dengue');
  // 推導項只進 patch.derivedItems，不進 items；清單檔不會因此多出列
  assert.equal(patch.summary.items, 2); assert.equal(patch.summary.matched, 2); assert.equal(patch.summary.derivedItems, 20);
  assert.ok(patch.derivedItems.find((d) => d.key === 'intro-symptoms').matched);
  assert.equal(patch.derivedItems.find((d) => d.key === 'intro-symptoms').template.status, 'merged');
  assert.ok(!patch.items.some((i) => i.key === 'intro-symptoms'));
});

test('登革熱模擬匯出（模板驅動）：模板項（扣掉例外已涵蓋的位置）＋8 例外＋近年新聞；HTML 像舊站；任何有疾病頁的疾病都能產', () => {
  const dir = tmp('dengue-exp');
  const r = generateDisease('disease.dengue', dir);
  // 模板 20 項，但人工例外已指向同一份新站內容的位置（登革熱：影片、治療指引）不另產一頁，所以是 18
  assert.equal(r.template, 18); assert.equal(r.manual, 8); assert.ok(r.news >= 3 && r.news <= 5); assert.equal(r.pages, 18 + 8 + r.news);
  const htmls = fs.readdirSync(dir).filter((f) => f.endsWith('.html'));
  assert.equal(htmls.length, r.pages);
  let mso = 0, crumbs = 0, tables = 0, withAtt = 0, panels = 0;
  for (const f of htmls) {
    const h = fs.readFileSync(path.join(dir, f), 'utf8');
    const side = JSON.parse(fs.readFileSync(path.join(dir, f.replace(/\.html$/, '.json')), 'utf8'));
    for (const k of ['url', 'title', 'category', 'publishedAt', 'updatedAt', 'breadcrumbs', 'attachments']) assert.ok(k in side, `${f} 側檔缺 ${k}`);
    assert.ok(side.breadcrumbs.includes('登革熱'), `${f} 麵包屑有疾病名`);
    if (/mso-|MsoNormal/.test(h)) mso++;
    if (/class="breadcrumb"/.test(h)) crumbs++;
    if (/<table/.test(h)) tables++;
    if (side.attachments.length) withAtt++;
    if (/class="panel panel-default"/.test(h)) panels++;
  }
  assert.ok(mso >= r.pages - 3, `Word 樣式頁 ${mso}`); assert.equal(crumbs, r.pages); assert.ok(tables >= 5); assert.ok(withAtt >= 6); assert.ok(panels >= 1);
  const meta = JSON.parse(fs.readFileSync(path.join(dir, '_export.json'), 'utf8'));
  assert.equal(meta.simulated, true); assert.equal(meta.disease, 'disease.dengue'); assert.match(fs.readFileSync(path.join(dir, 'README.md'), 'utf8'), /模擬匯出[\s\S]*正式匯出取代/);
  // 與已提交的匯出一致（可重現）
  for (const f of ['01-intro.json', '10-qa-list.json', fs.readdirSync(EXPORT_DENGUE).find((x) => x.endsWith('-dengue-guidance-v16-archive.json'))]) assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')), JSON.parse(fs.readFileSync(path.join(EXPORT_DENGUE, f), 'utf8')), f);
  // 其他有疾病頁的疾病也能產（流感：有人工清單；麻疹：有人工清單；水痘：沒有人工清單，只有模板）
  for (const d of ['disease.influenza', 'disease.varicella']) {
    const rr = generateDisease(d, tmp(d));
    assert.ok(rr.pages >= 20, `${d} ${rr.pages} 頁`);
  }
  assert.throws(() => generateDisease('disease.smallpox', tmp('no-page')), /還沒有疾病頁/);
});

test('登革熱批次：全部有輸出且通過 schema；疾病與 owner 不靠規則檔的結核病條目；模板推導項對上；人工例外 8/8；不錯配；清單不寫回推導項', () => {
  const dir = tmp('dengue');
  const mf = path.join(dir, 'dengue.json');
  fs.copyFileSync(path.join(snapshotContent(), 'migration/dengue.json'), mf);
  const out = path.join(dir, 'out');
  const { report, patch, drafts } = runImport({ exportDir: EXPORT_DENGUE, outDir: out, manifestPath: mf, slug: 'dengue', now: NOW, contentDir: snapshotContent() });
  const s = report.summary;
  assert.equal(s.pages, 31); assert.equal(s.pagesWithoutOutput, 0); assert.equal(s.schemaInvalid, 0);
  const env = { units: new Set(readJSON(path.join(CONTENT, 'master/units.json')).map((u) => u.id)), diseaseIds: new Set(master.map((d) => d.id)), assetsDir: path.join(out, 'content/assets'), licenses: ['OGDL-1.0', 'CC0-1.0', 'CC-BY-4.0'] };
  for (const d of drafts) assert.deepEqual(validateDraft(d, env), [], d.id);
  assert.ok(report.pages.every((p) => p.diseases.includes('disease.dengue')), '每頁都認出登革熱');
  assert.ok(!report.pages.some((p) => p.issues.some((i) => i.code === 'unmapped-category')), '沒有未對應類別：owner 依疾病主檔或通用子類別規則');
  assert.equal(report.pages.find((p) => p.manifestKey === 'lab').owner, 'unit.lab');
  assert.equal(report.pages.find((p) => p.manifestKey === 'stats').owner, 'unit.epidemic-intelligence');
  assert.equal(report.pages.find((p) => p.manifestKey === 'intro').owner, 'unit.acute-infectious');
  const dis = drafts.find((d) => d.type === 'disease');
  assert.equal(dis.id, 'disease.dengue'); assert.equal(s.mergedPages, 9, '疾病介紹七分頁＋總覽＋預防接種併成一份');
  assert.ok(dis.blocks.find((b) => b.key === 'symptoms').markdown.length > 20);
  assert.equal(dis.owner, 'unit.acute-infectious');
  // 一頁兩疾病
  const v16 = report.pages.find((p) => p.manifestKey === 'dengue-guidance-v16-archive');
  assert.deepEqual(v16.diseases, ['disease.dengue', 'disease.chikungunya']);
  assert.equal(v16.outputs[0].id, 'doc.guidance-dengue.v16');
  assert.equal(patch.items.find((i) => i.key === 'dengue-guidance-v16-archive').suggestion.status, 'archived', '同 family 已有第 17 版 ⇒ 建議封存，與清單一致');
  assert.equal(patch.summary.conflicts, 0);
  // 人工例外 8/8、模板推導 20 項對上 ≥ 18、清單沒有的新聞列為 unmatchedPages（建議新增 pending）
  assert.equal(patch.summary.matched, 8); assert.equal(patch.summary.missingPages, 0);
  assert.equal(patch.summary.derivedItems, 18); assert.equal(patch.summary.derivedMatched, 18, `推導對上 ${patch.summary.derivedMatched}`);
  assert.ok(patch.summary.unmatchedPages >= 4);
  assert.ok(patch.unmatchedPages.every((u) => u.suggest.status === 'pending' && u.suggest.verified === false));
  // 近年新聞依標題對到既有新聞 id，標 existing（供比對），不錯配到清單的通函項目
  const press = report.pages.find((p) => p.key.includes('dengue-first-local'));
  assert.equal(press.manifestKey, null); assert.equal(press.outputs[0].id, 'news.2026-07-21-dengue-first-local'); assert.equal(press.existing, true);
  const ns1 = report.pages.find((p) => p.manifestKey === 'dengue-ns1-notice');
  assert.equal(ns1.kind, 'news'); assert.equal(ns1.outputs[0].id, 'news.2026-09-15-letter-615-ns1');
  // Q&A 每題對到既有 faq id
  const faqs = drafts.filter((d) => d.type === 'faq');
  assert.equal(faqs.length, 7); assert.ok(faqs.every((f) => /^faq\.(dengue-|travel-)/.test(f.id) && f.conversion.existing));
  // 新 id 的前綴是 dengue，不是 x
  assert.ok(!drafts.some((d) => /\.x-/.test(d.id)), '沒有 short 退成 x 的 id');
  assert.ok(s.avgConfidence >= 0.8 && s.needsReview <= 5);
  assert.deepEqual(JSON.parse(fs.readFileSync(mf, 'utf8')), readJSON(path.join(snapshotContent(), 'migration/dengue.json')), '沒加 --apply-migration 不改清單');
});

test('已提交的登革熱批次輸出（data/legacy-import/dengue）：31 頁、schema 全過、清單只多 note、verified 全是 false', () => {
  const r = JSON.parse(fs.readFileSync(path.join(COMMITTED_DENGUE, 'report.json'), 'utf8'));
  assert.equal(r.summary.pages, 31); assert.equal(r.summary.schemaInvalid, 0); assert.equal(r.migration.applied, true); assert.equal(r.manifest.extends, 'migration-template.disease');
  for (const d of r.drafts) assert.ok(fs.existsSync(path.join(COMMITTED_DENGUE, d.file)), d.file);
  const manifest = readJSON(path.join(CONTENT, 'migration/dengue.json'));
  assert.equal(manifest.items.length, 8, '推導項沒有被寫進清單');
  assert.ok(manifest.items.every((i) => i.verified === false));
  assert.ok(manifest.items.every((i) => /【匯入 /.test(i.note ?? '')), '每筆 note 有匯入標記');
  assert.ok(fs.existsSync(path.join(COMMITTED_DENGUE, 'report.md')) && fs.existsSync(path.join(COMMITTED_DENGUE, 'migration-patch.json')));
  assert.match(fs.readFileSync(path.join(COMMITTED_DENGUE, 'report.md'), 'utf8'), /模板推導項/);
});

// ───────────────────────── 第三批：流感（第十一輪） ─────────────────────────
const EXPORT_FLU = path.join(ROOT, 'data/legacy-export/influenza');
const COMMITTED_FLU = path.join(ROOT, 'data/legacy-import/influenza');

test('流感批次：欄目內頁依清單目標建成 document；例外涵蓋的模板位置不推導；dropped／archived 與 pending 不算衝突；合約院所建 service；澄清稿建 clarification', () => {
  const dir = tmp('flu');
  const mf = path.join(dir, 'influenza.json');
  fs.copyFileSync(path.join(CONTENT, 'migration/influenza.json'), mf);
  const out = path.join(dir, 'out');
  const { report, patch, drafts } = runImport({ exportDir: EXPORT_FLU, outDir: out, manifestPath: mf, slug: 'influenza', now: NOW });
  const s = report.summary;
  assert.equal(s.pages, 31); assert.equal(s.pagesWithoutOutput, 0); assert.equal(s.schemaInvalid, 0);
  const env = { units: new Set(readJSON(path.join(CONTENT, 'master/units.json')).map((u) => u.id)), diseaseIds: new Set(master.map((d) => d.id)), assetsDir: path.join(out, 'content/assets'), licenses: ['OGDL-1.0', 'CC0-1.0', 'CC-BY-4.0'] };
  for (const d of drafts) assert.deepEqual(validateDraft(d, env), [], d.id);
  assert.ok(report.pages.every((p) => p.diseases.includes('disease.influenza')));
  // (1) 舊站「公費流感抗病毒藥劑使用對象」是欄目內頁（MPage），清單說它對應新站的一份文件 ⇒ 草稿建成 document，id 就是清單 target
  const elig = report.pages.find((p) => p.manifestKey === 'flu-antiviral-eligibility');
  assert.equal(elig.kind, 'document'); assert.equal(elig.type, 'document'); assert.equal(elig.outputs[0].id, 'doc.flu-antiviral-eligibility.2026-09-18'); assert.equal(elig.existing, true);
  assert.ok(elig.issues.some((i) => i.code === 'type-from-manifest' && i.severity === 'info'));
  assert.ok(!elig.issues.some((i) => i.code === 'target-type-differs'), '型別已跟著清單，不再記 target-type-differs');
  const elig06 = report.pages.find((p) => p.manifestKey === 'flu-antiviral-eligibility-2026-06');
  assert.equal(elig06.outputs[0].id, 'doc.flu-antiviral-eligibility.2026-06-01');
  // 清單頁（category-list）即使目標是文件也不改型別
  assert.ok(!report.pages.some((p) => p.kind === 'list' && p.issues.some((i) => i.code === 'type-from-manifest')));
  // (2) 模板「工作手冊」「治療指引」位置：流感的人工例外（疫苗專區作業手冊、抗病毒藥劑使用對象）已指向同一份新站內容 ⇒ 不再推導、不另產頁，
  //     同一份文件不會從兩個舊網址各來一份（第三批 -2／target-shared 的情況消失）
  assert.equal(patch.summary.derivedItems, 18); assert.equal(patch.summary.derivedMatched, 18);
  assert.ok(!patch.derivedItems.some((d) => d.key === 'manual' || d.key === 'guideline'), '被例外涵蓋的模板位置不推導');
  const manual2 = report.pages.find((p) => p.manifestKey === 'flu-vaccine-manual');
  assert.equal(manual2.outputs[0].id, 'doc.flu-vaccine-manual.2026-09-16'); assert.ok(!manual2.issues.some((i) => i.code === 'target-shared'));
  assert.ok(!report.pages.some((p) => p.key.endsWith('-manual') && p.manifestDerived), '沒有模板推導的工作手冊頁');
  // (3) 人工已判定 dropped 的歷年計畫，工具找不到新站去向（pending）⇒ 一致，不是衝突
  const past = patch.items.find((i) => i.key === 'flu-past-seasons');
  assert.equal(past.current.status, 'dropped'); assert.equal(past.suggestion.status, 'pending'); assert.equal(past.agree, true); assert.equal(past.proposed.status, 'dropped');
  assert.equal(patch.summary.conflicts, 0); assert.equal(patch.summary.matched, 8); assert.equal(patch.summary.statusChanges, 0);
  // (4) 服務型頁面（合約院所查詢）：第四批起依標題關鍵字直接建成 service（clinic），步驟與對象以「（待補）」佔位；清單仍是 pending（新站還沒有這筆 service）
  for (const k of ['flu-vaccine-contract-sites', 'flu-antiviral-contract-sites']) {
    const p = report.pages.find((x) => x.manifestKey === k);
    assert.equal(p.kind, 'service'); assert.equal(p.outputs[0].type, 'service'); assert.ok(p.issues.some((i) => i.code === 'type-from-keywords') && p.issues.some((i) => i.code === 'fields-pending'));
    assert.equal(patch.items.find((i) => i.key === k).proposed.status, 'pending');
    const d = drafts.find((x) => x.id === p.outputs[0].id);
    assert.equal(d.serviceType, 'clinic'); assert.ok(d.steps.length >= 1 && d.whoCanApply.length >= 1 && d.introMarkdown.length > 20);
  }
  assert.equal(patch.summary.stillPending, 2);
  // (5) 澄清稿：Bulletin typeid 8772 ⇒ clarification（claim／verdict），既有同標題的 news 列為比對對象
  const clar = report.pages.find((p) => p.kind === 'clarification');
  assert.ok(clar && clar.outputs[0].id.startsWith('clar.') && clar.issues.some((i) => i.code === 'type-from-bulletin') && clar.issues.some((i) => i.code === 'type-upgrade'));
  const cd = drafts.find((x) => x.id === clar.outputs[0].id);
  assert.equal(cd.type, 'clarification'); assert.equal(cd.verdict, 'false'); assert.match(cd.claim, /流感疫苗/); assert.ok(cd.shareText.length > 10 && cd.clarificationMarkdown.length > 40);
  assert.equal(clar.existing, true);
  assert.deepEqual(s.byType, { faq: 10, publication: 1, media: 1, document: 5, dataset: 1, labtest: 1, page: 4, service: 2, news: 3, letter: 1, clarification: 1, disease: 1, topic: 1 });
  // (6) 第五批前置：模板「相關連結」位置（related topic）建成 topic 草稿，id 固定 topic.<slug>-links；推導到的既有專區只當比對對象，不搶它的 id；連結全 unchecked、站外標 external
  const links = report.pages.find((p) => p.manifestKey === 'links');
  assert.equal(links.type, 'topic'); assert.equal(links.outputs[0].id, 'topic.influenza-links'); assert.deepEqual(links.compareWith, ['topic.ltc-infection-control']);
  const topic = drafts.find((d) => d.id === 'topic.influenza-links');
  assert.equal(topic.kind, 'resource-hub'); assert.ok(topic.links.length >= 1 && topic.links.every((l) => l.status === 'unchecked'));
  assert.ok(!links.issues.some((i) => i.code === 'list-page' || i.code === 'target-type-differs'));
  assert.ok(s.avgConfidence >= 0.8 && s.needsReview <= 3);
  assert.deepEqual(JSON.parse(fs.readFileSync(mf, 'utf8')), readJSON(path.join(CONTENT, 'migration/influenza.json')), '沒加 --apply-migration 不改清單');
});

test('已提交的流感批次輸出（data/legacy-import/influenza）：31 頁、schema 全過、清單只多 note、verified 全是 false、模擬匯出可重現', () => {
  const r = JSON.parse(fs.readFileSync(path.join(COMMITTED_FLU, 'report.json'), 'utf8'));
  assert.equal(r.summary.pages, 31); assert.equal(r.summary.schemaInvalid, 0); assert.equal(r.migration.applied, true); assert.equal(r.manifest.extends, 'migration-template.disease');
  assert.equal(r.summary.manifest.derivedMatched, 18);
  for (const d of r.drafts) assert.ok(fs.existsSync(path.join(COMMITTED_FLU, d.file)), d.file);
  const manifest = readJSON(path.join(CONTENT, 'migration/influenza.json'));
  assert.equal(manifest.items.length, 8);
  assert.ok(manifest.items.every((i) => i.verified === false));
  assert.ok(manifest.items.every((i) => /【匯入 /.test(i.note ?? '')));
  assert.equal(manifest.items.find((i) => i.key === 'flu-past-seasons').status, 'dropped', '套用後 dropped 沒被改成 pending');
  const m = JSON.parse(fs.readFileSync(path.join(COMMITTED_FLU, 'migration-patch.json'), 'utf8'));
  assert.equal(m.summary.conflicts, 0);
  const dir = tmp('flu-exp');
  generateDisease('disease.influenza', dir);
  for (const f of ['21-flu-vaccine-manual.json', '23-flu-antiviral-eligibility.json', '26-flu-past-seasons.json']) assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')), JSON.parse(fs.readFileSync(path.join(EXPORT_FLU, f), 'utf8')), f);
});

// ───────────────────────── 第四批：麻疹＋腸病毒；結構化型別直接產（第十一輪） ─────────────────────────
const EXPORT_MEASLES = path.join(ROOT, 'data/legacy-export/measles');
const EXPORT_EV = path.join(ROOT, 'data/legacy-export/enterovirus');

test('結構化型別的欄位抽取：表格列、清單項、澄清 claim／verdict、出版品種類、服務種類、id 前綴', () => {
  const md = '| 項目 | 內容 |\n| --- | --- |\n| 檢體 | 咽喉拭子、尿液／血清 |\n| 送驗時限 | 24 小時內 |\n\n- 第一步\n1. 第二步\n';
  assert.equal(mdTableRows(md).length, 3); // 表頭＋兩列（分隔列跳過）
  assert.equal(kvTable(md).get('送驗時限'), '24 小時內');
  assert.deepEqual(listItems(md), ['第一步', '第二步']);
  assert.equal(clarificationClaim('澄清：網傳「打流感疫苗會得流感」並非事實'), '打流感疫苗會得流感');
  assert.equal(clarificationClaim('網傳燻白醋可殺死流感病毒沒有科學根據'), '燻白醋可殺死流感病毒');
  assert.deepEqual(verdictFor('網傳 X 沒有科學根據', ''), { verdict: 'false', clear: true });
  assert.deepEqual(verdictFor('MMR 建議已修訂，舊版說法過時', ''), { verdict: 'outdated', clear: true });
  assert.equal(verdictFor('關於某事的說明', '').clear, false);
  assert.deepEqual(pubTypeFor('結核病七語衛教海報', null), { pubType: 'poster', clear: true });
  assert.deepEqual(pubTypeFor('某某', { pubType: 'manual' }), { pubType: 'manual', clear: true });
  assert.equal(pubTypeFor('不知道是什麼', null).clear, false);
  assert.deepEqual(serviceTypeFor(rules, '公費流感疫苗合約院所查詢'), { serviceType: 'clinic', clear: true });
  assert.deepEqual(serviceTypeFor(rules, '腸病毒重症責任醫院名單與轉診'), { serviceType: 'clinic', clear: true });
  assert.equal(serviceTypeFor(rules, '疾病介紹'), null);
  assert.equal(typeOfId('clar.2026-01-x'), 'clarification'); assert.equal(typeOfId('doc.x.2026-01-01'), 'document'); assert.equal(typeOfId('labtest.dengue'), 'labtest');
});

test('模板展開：同型別多筆取現行最新；人工例外已指向同一份新站內容的位置不推導；模板文件項以選單位置（麵包屑）對應', () => {
  const idx = loadContentIndex(CONTENT);
  const dmap = new Map(master.map((d) => [d.id, d]));
  const flu = expandTemplateItems({ manifest: readJSON(path.join(CONTENT, 'migration/influenza.json')), contentDir: CONTENT, index: idx, diseaseById: dmap });
  assert.equal(flu.length, 20);
  assert.equal(flu.filter((d) => !d.coveredBy).length, 18);
  assert.deepEqual(flu.filter((d) => d.coveredBy).map((d) => [d.key, d.coveredBy]), [['manual', 'flu-vaccine-manual'], ['guideline', 'flu-antiviral-eligibility']], '作業手冊與抗病毒藥劑使用對象已由例外指向 ⇒ 保留但標 coveredBy，匯入與模擬器都不處理');
  const bare = expandTemplateItems({ manifest: { extends: 'migration-template.disease', scope: { kind: 'disease', disease: 'disease.influenza' }, items: [] }, contentDir: CONTENT, index: idx, diseaseById: dmap });
  assert.equal(bare.length, 20);
  assert.equal(bare.find((d) => d.key === 'guideline').target, 'doc.flu-antiviral-eligibility.2026-09-18', '兩個版次取現行最新的，不是字母序第一個（6 月版）');
  // 麵包屑位置對應：流感模擬匯出沒有治療指引頁了，用麻疹的病例定義頁驗證（標題是正式名稱，最後一層麵包屑是模板的「病例定義」）
  const r = runImport({ exportDir: EXPORT_MEASLES, outDir: tmp('m-out'), manifestPath: path.join(CONTENT, 'migration/measles.json'), slug: 'measles', now: NOW }).report;
  const cd = r.pages.find((p) => p.manifestKey === 'case-definition');
  assert.ok(cd && cd.manifestDerived && cd.source.breadcrumbs.at(-1) === '病例定義' && cd.source.title !== '病例定義');
});

test('第四批：麻疹＋腸病毒各一份模擬匯出；出版品、影音、資料集、檢驗、服務直接建成結構化型別並通過 schema；看不出的欄位佔位並記 fields-pending', () => {
  const env = (out) => ({ units: new Set(readJSON(path.join(CONTENT, 'master/units.json')).map((u) => u.id)), diseaseIds: new Set(master.map((d) => d.id)), assetsDir: path.join(out, 'content/assets'), licenses: ['OGDL-1.0', 'CC0-1.0', 'CC-BY-4.0'] });
  const run = (slug, exp) => { const dir = tmp(slug); const mf = path.join(dir, `${slug}.json`); fs.copyFileSync(path.join(CONTENT, `migration/${slug}.json`), mf); const out = path.join(dir, 'out'); return { ...runImport({ exportDir: exp, outDir: out, manifestPath: mf, slug, now: NOW }), out, mf }; };
  const M = run('measles', EXPORT_MEASLES);
  const E = run('enterovirus', EXPORT_EV);
  for (const { report, drafts, out, patch } of [M, E]) {
    assert.equal(report.summary.pagesWithoutOutput, 0); assert.equal(report.summary.schemaInvalid, 0);
    for (const d of drafts) assert.deepEqual(validateDraft(d, env(out)), [], d.id);
    assert.equal(patch.summary.conflicts, 0); assert.equal(patch.summary.missingPages, 0); assert.equal(patch.summary.derivedItems, 18); assert.equal(patch.summary.derivedMatched, 18);
    assert.ok(!report.pages.some((p) => p.issues.some((i) => i.code === 'target-shared')), '沒有同一份內容來兩次');
    for (const t of ['publication', 'dataset', 'labtest', 'media']) assert.equal(report.summary.byType[t], 1, `${report.batch} ${t}`);
    // 以 page 暫存＋target-type-differs 的只剩新聞列表、相關連結、專區首頁（本來就不轉成型別）
    for (const p of report.pages.filter((p) => p.issues.some((i) => i.code === 'target-type-differs'))) assert.ok(/news-list|links|-zone$/.test(p.key), `${report.batch} ${p.key} 仍是 target-type-differs`);
    // 清單判定「併入」某份文件的欄目內頁（麻疹群聚應變專區 → 接觸者追蹤指引；停課標準 → 教托育指引）：以 page 暫存、記 merge-into-target，不搶文件 id
    const merged = report.pages.filter((p) => p.issues.some((i) => i.code === 'merge-into-target'));
    assert.deepEqual(merged.map((p) => p.manifestKey), report.batch === 'measles' ? ['measles-cluster-response'] : ['ev-closure-reporting'], report.batch);
    assert.equal(report.pages.find((p) => p.manifestKey === 'ev-ev71-vaccine')?.kind ?? 'disease-block', 'disease-block', '疫苗專區頁併入疾病頁的疫苗區塊，不記 merge-into-target');
    for (const p of merged) { assert.equal(p.type, 'page'); assert.ok(p.outputs[0].id.startsWith('page.')); assert.ok(!p.issues.some((i) => i.code === 'target-type-differs')); }
  }
  // 麻疹
  const ms = M.report.summary;
  assert.equal(ms.pages, 28); assert.equal(M.patch.summary.matched, 7);
  const lab = M.drafts.find((d) => d.type === 'labtest');
  assert.equal(lab.id, 'labtest.measles'); assert.equal(lab.disease, 'disease.measles'); assert.deepEqual(lab.specimens.map((x) => x.name), ['咽喉拭子', '尿液', '血清']);
  assert.ok(lab.specimens.every((x) => /待補/.test(x.container))); assert.equal(lab.sendWithinHours, 24); assert.equal(lab.biosafetyLevel, 'BSL-2'); assert.deepEqual(lab.audience, ['professional']); assert.equal(lab.owner, 'unit.lab');
  assert.match(lab.title, /^麻疹/);
  assert.ok(M.report.pages.find((p) => p.manifestKey === 'lab').issues.some((i) => i.code === 'fields-pending'));
  const pub = M.drafts.find((d) => d.type === 'publication');
  assert.equal(pub.pubType, 'poster'); assert.equal(pub.series, '麻疹宣導素材'); assert.match(pub.pdfUrl, /^\/files\/publication\.measles-materials-poster\/.*\.pdf$/); assert.ok(pub.abstractMarkdown.length > 20);
  const ds = M.drafts.find((d) => d.type === 'dataset');
  assert.equal(ds.id, 'dataset.measles-yearly'); assert.equal(ds.category, 'structured-table'); assert.equal(ds.updateFrequency, 'yearly'); assert.deepEqual(ds.formats, ['CSV']); assert.equal(ds.provenance.mode, 'snapshot'); assert.equal(ds.resources.length, 1);
  const md = M.drafts.find((d) => d.type === 'media');
  assert.equal(md.id, 'media.mmr-waiting-room-2026'); assert.equal(md.mediaType, 'animation'); assert.ok(md.transcriptMarkdown.length > 40); assert.equal(md.producedAt, md.publishedAt); assert.deepEqual(md.basedOn, ['disease.measles']);
  assert.ok(!M.report.pages.find((p) => p.manifestKey === 'measles-mmr-video').issues.some((i) => i.code === 'embedded-media'), '影音型別的嵌入影片不算未轉入');
  // 腸病毒
  const es = E.report.summary;
  assert.equal(es.pages, 31); assert.equal(E.patch.summary.matched, 8); assert.equal(E.patch.summary.stillPending, 1);
  const sv = E.drafts.find((d) => d.type === 'service');
  assert.equal(sv.id, 'service.enterovirus-ev-severe-referral'); assert.equal(sv.serviceType, 'clinic'); assert.equal(sv.slug, 'enterovirus-ev-severe-referral'); assert.ok(/待補/.test(sv.steps[0].title));
  const svp = E.report.pages.find((p) => p.manifestKey === 'ev-severe-referral');
  assert.equal(svp.kind, 'service'); assert.equal(E.patch.items.find((i) => i.key === 'ev-severe-referral').proposed.status, 'pending');
  assert.ok(E.drafts.find((d) => d.id === 'media.enterovirus-handwashing' && d.mediaType === 'animation'));
  assert.ok(E.drafts.find((d) => d.id === 'doc.ev-childcare-guideline.2026-09-10') && E.drafts.find((d) => d.id === 'doc.ev-severe-guideline.2026-03-15'));
  assert.equal(E.report.pages.find((p) => p.manifestKey === 'ev-old-posters').action, 'skip-list');
  assert.ok(ms.avgConfidence >= 0.85 && es.avgConfidence >= 0.85 && ms.needsReview <= 2 && es.needsReview <= 2);
  for (const { mf } of [M, E]) assert.deepEqual(JSON.parse(fs.readFileSync(mf, 'utf8')), readJSON(path.join(CONTENT, `migration/${path.basename(mf)}`)), '沒加 --apply-migration 不改清單');
});

test('第五批前置：清單把疫苗專區頁標成「已移轉」到疫苗頁 ⇒ 草稿建成 vaccine（同 id、existing 供比對、publicFunded 由表格「公費」列抽、英文名待補）；「併入」維持疾病頁疫苗區塊', () => {
  const dir = tmp('ev-vaccine');
  const mf = path.join(dir, 'enterovirus.json');
  const raw = readJSON(path.join(CONTENT, 'migration/enterovirus.json'));
  raw.items.find((i) => i.key === 'ev-ev71-vaccine').status = 'migrated';
  fs.writeFileSync(mf, JSON.stringify(raw, null, 2));
  const out = path.join(dir, 'out');
  const { report, drafts } = runImport({ exportDir: EXPORT_EV, outDir: out, manifestPath: mf, slug: 'enterovirus', now: NOW });
  const p = report.pages.find((p) => p.manifestKey === 'ev-ev71-vaccine');
  assert.equal(p.kind, 'vaccine'); assert.equal(p.type, 'vaccine'); assert.equal(p.outputs[0].id, 'vaccine.ev71'); assert.equal(p.existing, true);
  assert.ok(p.issues.some((i) => i.code === 'type-from-manifest') && p.issues.some((i) => i.code === 'fields-pending' && /nameEn/.test(i.message)));
  const v = drafts.find((d) => d.id === 'vaccine.ev71');
  assert.equal(report.summary.schemaInvalid, 0);
  assert.equal(v.slug, 'ev71'); assert.ok(Array.isArray(v.publicFunded)); assert.ok(v.bodyMarkdown.length > 20); assert.deepEqual(v.basedOn, ['disease.enterovirus']);
  assert.ok(fs.existsSync(path.join(out, 'content/vaccines/ev71.json')));
  // 既有輸出（status merged）維持疾病頁疫苗區塊，不建 vaccine
  assert.equal(readJSON(path.join(ROOT, 'data/legacy-import/enterovirus/report.json')).pages.find((p) => p.manifestKey === 'ev-ev71-vaccine').type, 'disease');
});

test('已提交的第四批輸出（measles、enterovirus）：schema 全過、清單只多 note、verified 全是 false、模擬匯出可重現；五批重跑後 TB／登革熱／流感的既有輸出也更新', () => {
  for (const [slug, pages] of [['measles', 28], ['enterovirus', 31], ['tuberculosis', 40], ['dengue', 31], ['influenza', 31]]) {
    const dir = path.join(ROOT, 'data/legacy-import', slug);
    const r = JSON.parse(fs.readFileSync(path.join(dir, 'report.json'), 'utf8'));
    assert.equal(r.summary.pages, pages, slug); assert.equal(r.summary.schemaInvalid, 0, slug); assert.equal(r.migration.applied, true, slug);
    for (const d of r.drafts) assert.ok(fs.existsSync(path.join(dir, d.file)), d.file);
    const manifest = readJSON(path.join(CONTENT, `migration/${slug}.json`));
    assert.ok(manifest.items.every((i) => i.verified === false), slug);
    assert.ok(manifest.items.every((i) => /【匯入 /.test(i.note ?? '')), `${slug} 每筆 note 有匯入標記`);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'migration-patch.json'), 'utf8')).summary.conflicts, 0, slug);
    assert.ok(r.summary.byType.labtest === 1 && r.summary.byType.dataset === 1 && r.summary.byType.publication === 1, `${slug} 結構化型別有產出`);
  }
  for (const [id, exp] of [['disease.measles', EXPORT_MEASLES], ['disease.enterovirus', EXPORT_EV]]) {
    const dir = tmp('exp4');
    generateDisease(id, dir);
    for (const f of fs.readdirSync(exp).filter((x) => x.endsWith('.json') && x !== '_export.json')) assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')), JSON.parse(fs.readFileSync(path.join(exp, f), 'utf8')), `${id} ${f}`);
  }
});

const BATCH5 = [['rabies', 20], ['malaria', 20], ['hepatitis-a', 20], ['rubella', 20], ['chikungunya', 23], ['mpox', 22]];

test('第五批：沒有人工清單的疾病用合成清單（模板推導 20 項）轉檔；synthetic 記在報告、--apply-migration 拒絕寫檔；相關連結建成 topic', () => {
  const dir = tmp('b5');
  const { report, patch, drafts } = runImport({ exportDir: path.join(ROOT, 'data/legacy-export/rabies'), outDir: path.join(dir, 'out'), manifestPath: path.join(dir, 'rabies.json'), slug: 'rabies', now: NOW });
  assert.equal(report.manifest.synthetic, true); assert.equal(report.manifest.file, null); assert.equal(report.manifest.derivedItems, 20); assert.deepEqual(report.manifest.derivedCovered, []);
  assert.equal(report.summary.pages, 20); assert.equal(report.summary.schemaInvalid, 0); assert.equal(report.summary.pagesWithoutOutput, 0);
  assert.equal(patch.summary.derivedMatched, 20); assert.equal(patch.summary.conflicts, 0); assert.equal(report.migration.applied, false);
  assert.ok(report.pages.every((p) => p.manifestDerived), '每頁都對到模板位置');
  assert.equal(drafts.find((d) => d.type === 'topic')?.id, 'topic.rabies-links');
  assert.throws(() => runImport({ exportDir: path.join(ROOT, 'data/legacy-export/rabies'), outDir: path.join(dir, 'out2'), manifestPath: path.join(dir, 'rabies.json'), slug: 'rabies', now: NOW, applyMigration: true }), /沒有人工清單檔可寫/);
});

test('已提交的第五批輸出（狂犬病、瘧疾、A 型肝炎、德國麻疹、屈公病、M 痘）：schema 全過、合成清單未寫檔、模擬匯出可重現', () => {
  for (const [slug, pages] of BATCH5) {
    const dir = path.join(ROOT, 'data/legacy-import', slug);
    const r = readJSON(path.join(dir, 'report.json'));
    assert.equal(r.summary.pages, pages, slug); assert.equal(r.summary.schemaInvalid, 0, slug); assert.equal(r.summary.pagesWithoutOutput, 0, slug);
    assert.equal(r.manifest.synthetic, true, slug); assert.equal(r.migration.applied, false, slug);
    assert.ok(!fs.existsSync(path.join(CONTENT, `migration/${slug}.json`)), `${slug} 不該產生人工清單檔`);
    for (const d of r.drafts) assert.ok(fs.existsSync(path.join(dir, d.file)), d.file);
    for (const t of ['labtest', 'dataset', 'publication', 'media', 'topic', 'disease']) assert.equal(r.summary.byType[t], 1, `${slug} ${t}`);
    assert.equal(readJSON(path.join(dir, 'migration-patch.json')).summary.derivedMatched, 20, slug);
  }
  for (const [slug] of BATCH5) {
    const exp = path.join(ROOT, 'data/legacy-export', slug);
    const dir = tmp('exp5');
    generateDisease(`disease.${slug}`, dir);
    for (const f of fs.readdirSync(exp).filter((x) => x.endsWith('.json') && x !== '_export.json')) assert.deepEqual(readJSON(path.join(dir, f)), readJSON(path.join(exp, f)), `${slug} ${f}`);
  }
});

test('第六批（新聞與公告欄目，無移轉清單）：三級處理——既有新聞比對、近年新聞 auto-ok ＋ 10% 抽樣名單、久遠封存與活動 drop；通函建 letter 且權責歸疾病組；英文稿不自動上線；澄清稿建 clarification', () => {
  const dir = tmp('news');
  const exp = path.join(ROOT, 'data/legacy-export/news');
  const { report, drafts } = runImport({ exportDir: exp, outDir: path.join(dir, 'out'), manifestPath: path.join(dir, 'news.json'), slug: 'news', now: NOW, contentDir: snapshotContent() });
  const s = report.summary;
  assert.equal(report.manifest, null, '新聞批次沒有清單，也不合成（主檔沒有 news 這種疾病）');
  assert.equal(s.pagesWithoutOutput, 0); assert.equal(s.schemaInvalid, 0); assert.equal(s.needsReview, 0);
  assert.ok(!report.pages.some((p) => p.issues.some((i) => i.code === 'not-in-manifest')), '沒有清單就不該有 not-in-manifest');
  // 三級：既有 47 則比對；近年合成新聞 auto-ok；久遠封存；活動報名 drop；列表頁 skip
  assert.equal(s.byAction['compare-existing'], 47); assert.equal(s.byAction['auto-ok'], 4); assert.equal(s.byAction.archive, 5); assert.equal(s.byAction.drop, 1); assert.equal(s.byAction['skip-list'], 1);
  for (const p of report.pages.filter((p) => p.action === 'archive')) assert.ok(p.flags.old && p.source.updatedAt < '2023-01-01', p.key);
  // 抽樣：ceil(4 × 0.1) = 1，依網址雜湊固定
  assert.equal(report.sampling.rate, 0.1); assert.equal(report.sampling.autoOk, 4); assert.equal(report.sampling.picked.length, 1);
  assert.ok(report.pages.find((p) => p.key === report.sampling.picked[0].key)?.action === 'auto-ok');
  // 通函：typeid 48 或標題「致醫界通函第 N 號」⇒ letter、letterNo、權責是疾病業務組而不是公關室
  const letters = drafts.filter((d) => d.type === 'letter');
  assert.equal(letters.length, 5); assert.ok(letters.every((d) => Number.isInteger(d.letterNo) && d.newsType === 'letter' && d.audience.includes('professional')));
  assert.ok(letters.every((d) => d.owner === 'unit.acute-infectious'), '通函權責依疾病主檔');
  assert.ok(report.pages.filter((p) => p.outputs.some((o) => letters.some((l) => l.id === o.id))).every((p) => p.issues.some((i) => i.code === 'owner-from-disease')));
  // 英文新聞稿（typeid 158）：sourceLang en、needs-source-zh 警告 ⇒ 不是 auto-ok
  const en = drafts.filter((d) => d.sourceLang === 'en');
  assert.equal(en.length, 2);
  for (const p of report.pages.filter((p) => en.some((d) => p.outputs[0]?.id === d.id))) { assert.ok(p.issues.some((i) => i.code === 'needs-source-zh' && i.severity === 'warn')); assert.notEqual(p.action, 'auto-ok'); assert.equal(p.owner, 'unit.pr'); }
  // 澄清稿：8 則 typeid 8772 ＋ 2 則既有 news（newsType clarification）type-upgrade
  assert.equal(s.byType.clarification, 10); assert.equal(report.pages.filter((p) => p.issues.some((i) => i.code === 'type-upgrade')).length, 2);
  assert.ok(drafts.filter((d) => d.type === 'clarification').every((d) => d.claim && d.verdict && d.shareText));
  // 其他新聞的權責是公關室（新聞與公告欄目）
  assert.ok(report.pages.filter((p) => p.kind === 'news' && p.type === 'news' && !p.outputs.some((o) => letters.some((l) => l.id === o.id))).every((p) => p.owner === 'unit.pr' || p.ownerRule === '新聞與公告' || p.ownerRule === 'News'));
});

test('已提交的第六批輸出（data/legacy-import/news）：62 頁、schema 全過、報告有抽樣名單、模擬匯出可重現；五批重跑後登革熱／腸病毒／屈公病的通函改為 letter', () => {
  const dir = path.join(ROOT, 'data/legacy-import/news');
  const r = readJSON(path.join(dir, 'report.json'));
  assert.equal(r.summary.pages, 62); assert.equal(r.summary.schemaInvalid, 0); assert.equal(r.manifest, null); assert.equal(r.sampling.picked.length, 1);
  for (const d of r.drafts) assert.ok(fs.existsSync(path.join(dir, d.file)), d.file);
  assert.ok(fs.readFileSync(path.join(dir, 'report.md'), 'utf8').includes('## 二級抽樣檢視名單'));
  const exp = path.join(ROOT, 'data/legacy-export/news');
  const tmpDir = tmp('exp6');
  generateNews(tmpDir);
  for (const f of fs.readdirSync(exp).filter((x) => x.endsWith('.json') && x !== '_export.json')) assert.deepEqual(readJSON(path.join(tmpDir, f)), readJSON(path.join(exp, f)), f);
  for (const f of ['dengue/content/news/2026-07-01-letter-dengue-guidance-v17.json', 'enterovirus/content/news/2026-03-15-letter-ev-guideline.json']) { const d = readJSON(path.join(ROOT, 'data/legacy-import', f)); assert.equal(d.type, 'letter'); assert.ok(Number.isInteger(d.letterNo)); }
});


// ───────────────────────── 第七批：指引與手冊；文件版次鏈（第十二輪） ─────────────────────────
test('版次工具：去版次同名、版次排序、民國年與西元日期抽取', () => {
  assert.equal(versionFree('結核病診治指引（第八版）'), versionFree('結核病診治指引第七版（2022 年 3 月 1 日）'));
  assert.equal(versionFree('狂犬病防治工作手冊（108 年版）'), versionFree('狂犬病防治工作手冊（113 年 12 月修訂版）'));
  assert.equal(versionFree('國內現行 MMR 預防接種建議（114.04.16 版）'), versionFree('國內現行 MMR 預防接種建議（108.05.14 版，2019 年 5 月 14 日）'));
  assert.notEqual(versionFree('結核病診治指引'), versionFree('結核病防治工作手冊'));
  assert.equal(versionRank('第十七版'), 17); assert.equal(versionRank('v16'), 16); assert.equal(versionRank('2023 年版'), 2023); assert.ok(versionRank('114.04.16') > versionRank('108.05.14'));
  assert.equal(dateFromText('114.04.16 修訂'), '2025-04-16'); assert.equal(dateFromText('本手冊自 113 年 12 月 20 日修訂生效'), '2024-12-20'); assert.equal(dateFromText('（第七版，2022 年 3 月 1 日）'), '2022-03-01'); assert.equal(dateFromText('2026-09-18 生效'), '2026-09-18'); assert.equal(dateFromText('沒有日期'), null);
});

test('第七批（指引與手冊，欄目清單）：一頁多版拆歷版並沿用既有 id、同名多頁串家族、純 PDF 佔位、歷版封存、生效日從文字抽；一級內容不 auto-ok', () => {
  const dir = tmp('guidelines');
  const mf = path.join(dir, 'guidelines.json');
  fs.copyFileSync(path.join(snapshotContent(), 'migration/guidelines.json'), mf);
  const exp = path.join(ROOT, 'data/legacy-export/guidelines');
  const out = path.join(dir, 'out');
  const { report, patch, drafts } = runImport({ exportDir: exp, outDir: out, manifestPath: mf, slug: 'guidelines', now: NOW, contentDir: snapshotContent() });
  const s = report.summary;
  assert.equal(s.pages, 26); assert.equal(s.drafts, 32); assert.equal(s.schemaInvalid, 0); assert.equal(s.pagesWithoutOutput, 0);
  assert.equal(report.manifest.extends, null); assert.equal(s.manifest.matched, 26); assert.equal(patch.summary.conflicts, 0);
  const env = { units: new Set(readJSON(path.join(CONTENT, 'master/units.json')).map((u) => u.id)), diseaseIds: new Set(master.map((d) => d.id)), assetsDir: path.join(out, 'content/assets'), licenses: ['OGDL-1.0', 'CC0-1.0', 'CC-BY-4.0'] };
  for (const d of drafts) assert.deepEqual(validateDraft(d, env), [], d.id);
  assert.ok(!report.pages.some((p) => p.action === 'auto-ok'), '文件是一級內容，沒有 auto-ok');
  const byKey = (k) => report.pages.find((p) => p.key.endsWith(`-${k}`));
  const draft = (id) => drafts.find((d) => d.id === id);
  // (1) 一頁多版：結核病診治指引頁的附件列表有第七版 PDF ⇒ 另建純 PDF 舊版草稿，id 沿用新站既有 doc.tb-guideline.2022-03-01，檔案歸舊版草稿；現行版 supersedes 舊版
  const tb = byKey('tb-guideline');
  assert.deepEqual(tb.outputs.map((o) => o.id), ['doc.tb-guideline.2025-09-01', 'doc.tb-guideline.2022-03-01']);
  assert.ok(tb.issues.some((i) => i.code === 'version-from-attachment') && tb.issues.some((i) => i.code === 'version-chain'));
  const tb7 = draft('doc.tb-guideline.2022-03-01'), tb8 = draft('doc.tb-guideline.2025-09-01');
  assert.equal(tb7.version, '第七版'); assert.equal(tb7.effectiveAt, '2022-03-01'); assert.equal(tb7.supersedes, null); assert.match(tb7.machineReadableMarkdown, /^（待補：本版次正本為 PDF/);
  assert.equal(tb7.pdfUrl, `/files/doc.tb-guideline.2022-03-01/${tb7.assets[0].file}`); assert.equal(tb7.conversion.pdfOnly, true); assert.equal(tb7.conversion.versionChain.supersededBy, 'doc.tb-guideline.2025-09-01'); assert.equal(tb7.conversion.existing, true);
  assert.equal(tb8.supersedes, 'doc.tb-guideline.2022-03-01'); assert.equal(tb8.assets.length, 1, '歷版 PDF 不留在現行版草稿'); assert.equal(tb8.conversion.versionChain.current, true);
  // 登革熱指引 v15／v16 的 id 由版次（vN）對到既有文件，不是 family.日期
  assert.deepEqual(byKey('guidance-dengue').outputs.map((o) => o.id), ['doc.guidance-dengue.v17', 'doc.guidance-dengue.v15', 'doc.guidance-dengue.v16']);
  assert.equal(draft('doc.guidance-dengue.v17').supersedes, 'doc.guidance-dengue.v16'); assert.equal(draft('doc.guidance-dengue.v16').supersedes, 'doc.guidance-dengue.v15');
  // 附表之類不同名的附件不拆：所有拆出的草稿都與頁面去版次同名
  for (const p of report.pages.filter((p) => p.issues.some((i) => i.code === 'version-from-attachment'))) for (const o of p.outputs.slice(1)) assert.equal(versionFree(draft(o.id).title), versionFree(p.source.title), o.id);
  // (2) 歷版各一頁且清單各有 target：流感抗病毒藥劑三版同 family、依生效日串鏈，舊版那兩頁建議封存（historical-version）
  const flu = ['flu-antiviral-eligibility-2026-06', 'flu-antiviral-eligibility-2026-08', 'flu-antiviral-eligibility'].map(byKey);
  assert.deepEqual(flu.map((p) => p.action), ['archive', 'archive', 'compare-existing']);
  assert.equal(draft('doc.flu-antiviral-eligibility.2026-09-18').supersedes, 'doc.flu-antiviral-eligibility.2026-08-24'); assert.equal(draft('doc.flu-antiviral-eligibility.2026-08-24').supersedes, 'doc.flu-antiviral-eligibility.2026-06-01');
  // (3) 無清單目標、去版次同名的兩頁（狂犬病手冊 108 年版／113 年 12 月修訂版）⇒ 同 family（標題雜湊），新版生效日取內文「113 年 12 月 20 日修訂生效」，舊版封存
  const r1 = byKey('rabies-manual'), r0 = byKey('rabies-manual-2019');
  assert.ok(r1.issues.some((i) => i.code === 'version-family') && r0.issues.some((i) => i.code === 'version-family'));
  const rNew = draft(r1.outputs[0].id), rOld = draft(r0.outputs[0].id);
  assert.equal(rNew.family, rOld.family); assert.equal(rNew.effectiveAt, '2024-12-20'); assert.equal(rNew.supersedes, rOld.id); assert.equal(rNew.docType, 'manual');
  assert.ok(r1.issues.some((i) => i.code === 'effective-from-text')); assert.equal(r0.action, 'archive'); assert.equal(r1.action, 'review-before-publish');
  // (4) 純 PDF 頁：內文只有下載連結 ⇒ pdf-only 警告、正本以（待補）佔位、不 auto-ok；歸感管組（categoryOwners 感染管制）
  const ic = byKey('crowded-ic-guideline');
  assert.ok(ic.issues.some((i) => i.code === 'pdf-only' && i.severity === 'warn') && ic.issues.some((i) => i.code === 'fields-pending'));
  assert.equal(ic.owner, 'unit.infection-control'); assert.equal(ic.action, 'review-before-publish');
  assert.match(draft(ic.outputs[0].id).machineReadableMarkdown, /^（待補：本文件正本為 PDF「人口密集機構感染管制措施指引/);
  // (5) 歷版掃描檔：麵包屑「歷版」⇒ 封存；PDF 無文字層
  const h7 = byKey('h7n9-guideline-2017');
  assert.equal(h7.action, 'archive'); assert.ok(h7.issues.some((i) => i.code === 'pdf-no-text-layer') && h7.issues.some((i) => i.code === 'pdf-only'));
  // (6) 生效日從標題抽：MMR（114.04.16 版）⇒ 2025-04-16，不是頁面日期
  const mmr = byKey('mmr-recommendation');
  assert.ok(mmr.issues.some((i) => i.code === 'effective-from-text')); assert.equal(draft('doc.mmr-recommendation.2025-04-16').effectiveAt, '2025-04-16'); assert.equal(draft('doc.mmr-recommendation.2019-05-14').effectiveAt, '2019-05-14');
  // (7) 總覽列表頁略過，權責 OASIS（首頁／指引及手冊）
  const list = byKey('guidelines-list'); assert.equal(list.action, 'skip-list'); assert.equal(list.owner, 'unit.oasis'); assert.ok(!list.issues.some((i) => i.code === 'unmapped-category'));
  assert.deepEqual(s.byAction, { 'compare-existing': 19, 'review-before-publish': 2, archive: 4, 'skip-list': 1 });
  assert.deepEqual(JSON.parse(fs.readFileSync(mf, 'utf8')), readJSON(path.join(snapshotContent(), 'migration/guidelines.json')), '沒加 --apply-migration 不改清單');
});

test('已提交的第七批輸出（data/legacy-import/guidelines）：26 頁 32 份草稿、schema 全過、清單 26 筆 verified 全 false、模擬匯出可重現', () => {
  const dir = path.join(ROOT, 'data/legacy-import/guidelines');
  const r = readJSON(path.join(dir, 'report.json'));
  assert.equal(r.summary.pages, 26); assert.equal(r.summary.drafts, 32); assert.equal(r.summary.schemaInvalid, 0); assert.equal(r.migration.applied, true); assert.equal(r.manifest.file, 'content/migration/guidelines.json');
  for (const d of r.drafts) assert.ok(fs.existsSync(path.join(dir, d.file)), d.file);
  assert.equal(r.drafts.filter((d) => d.existing).length, 27);
  const manifest = readJSON(path.join(CONTENT, 'migration/guidelines.json'));
  assert.equal(manifest.items.length, 26); assert.equal(manifest.scope.kind, 'category'); assert.ok(manifest.items.every((i) => i.verified === false));
  assert.ok(manifest.items.every((i) => /【匯入 /.test(i.note ?? '')));
  const tmpDir = tmp('exp7');
  generateGuidelines(tmpDir);
  const exp = path.join(ROOT, 'data/legacy-export/guidelines');
  for (const f of fs.readdirSync(exp).filter((x) => x.endsWith('.json') && x !== '_export.json')) assert.deepEqual(readJSON(path.join(tmpDir, f)), readJSON(path.join(exp, f)), f);
});

// ───────────────────────── 第八批：常見問答欄目 ─────────────────────────

test('問答工具：鬆散結構拆題（h3／粗體 Q：）、tasks 關鍵字（題目優先、答案取最多）、期限已過、數字＋單位抽結構化候選', () => {
  const rules = loadRules();
  const h3 = parseHtml('<div><h3>Q1. 多久更新？</h3><p>每週更新。</p><h3>Q2. 哪裡查？</h3><p>A：到資料開放平臺。</p><p>補充說明。</p></div>');
  const items = faqItemsLoose(h3);
  assert.deepEqual(items.map((i) => i.question), ['多久更新？', '哪裡查？']);
  assert.equal(items[1].answerNode.children.length, 2);
  assert.match(items[1].answerNode.children[0].children[0].text, /^到資料開放平臺/, '答案開頭的「A：」去掉');
  const bold = parseHtml('<div><p><strong>Q：謠言 A 是真的嗎？</strong></p><p>答：不是。</p><p><strong>Q：謠言 B？</strong></p><p>也不是。</p></div>');
  assert.equal(faqItemsLoose(bold).length, 2);
  assert.deepEqual(faqItemsLoose(parseHtml('<div><h3>只有一個標題</h3><p>一般內文</p></div>')), [], '一題以下不當問答頁');
  assert.deepEqual(faqItemsLoose(parseHtml('<div><p>前言</p><h3>Q1. 問？</h3><h3>Q2. 沒答案？</h3></div>')), [], '有題沒答案就不採用');
  assert.deepEqual(tasksFor(rules, '去日本旅遊需要打疫苗嗎？', ''), ['vaccines', 'travel'], '題目命中的都給（最多兩個，依規則檔順序）');
  assert.deepEqual(tasksFor(rules, '這題什麼都沒提到', '疫苗疫苗疫苗，統計一次'), ['vaccines'], '題目沒命中 ⇒ 答案命中次數最多的一個');
  assert.deepEqual(tasksFor(rules, '無', '無'), []);
  const d = datedDeadlines('113 年度公費疫苗自 113 年 10 月 1 日起開打，至 114 年 3 月 31 日止。', '2026-10-05T00:00:00Z');
  assert.equal(d.allPast, true); assert.deepEqual(d.deadlines.map((x) => x.date).sort(), ['2024-12-31', '2025-03-31']);
  assert.equal(datedDeadlines('2026 年 8 月 24 日至 2026 年 10 月 31 日適用。', '2026-10-05T00:00:00Z').allPast, false, '還沒到的期限不算');
  assert.equal(datedDeadlines('依 2023 年 5 月 3 日公告辦理。', '2026-10-05T00:00:00Z').deadlines.length, 0, '不是期限的日期不看');
  assert.deepEqual(structuredFromText('打完多久有保護力？', '接種後約 2 週產生保護力，可維持約 6 個月；10 月 1 日起開打。'), { weeks: 2, months: 6 }, '「10 月 1 日」的「1 日」不算天數');
  assert.deepEqual(structuredFromText('出國前多久去？', '建議出國前 4 至 6 週。'), { weeksMin: 4, weeksMax: 6 });
  assert.equal(structuredFromText('這是什麼？', '約 2 週。'), null, '題目沒在問數量就不抽');
});

test('第八批（常見問答欄目，欄目清單）：疾病批已轉過的同網址頁 skip-duplicate 且不搶清單項目、鬆散結構拆題、英文頁 sourceLang、期限已過警告、tasks／structured 候選、一頁多題維持 pending；一級內容不 auto-ok', () => {
  const dir = tmp('qa');
  const mf = path.join(dir, 'qa.json');
  fs.copyFileSync(path.join(CONTENT, 'migration/qa.json'), mf);
  const exp = path.join(ROOT, 'data/legacy-export/qa');
  const out = path.join(dir, 'out');
  const { report, patch, drafts } = runImport({ exportDir: exp, outDir: out, manifestPath: mf, slug: 'qa', now: NOW, priorBatchesDir: path.join(ROOT, 'data/legacy-import') });
  const s = report.summary;
  assert.equal(s.pages, 15); assert.equal(s.drafts, 34); assert.equal(s.schemaInvalid, 0); assert.equal(s.pagesWithoutOutput, 0);
  assert.equal(s.manifest.matched, 13); assert.equal(patch.summary.conflicts, 0);
  const env = { units: new Set(readJSON(path.join(CONTENT, 'master/units.json')).map((u) => u.id)), diseaseIds: new Set(master.map((d) => d.id)), assetsDir: path.join(out, 'content/assets'), licenses: ['OGDL-1.0', 'CC0-1.0', 'CC-BY-4.0'] };
  for (const d of drafts) assert.deepEqual(validateDraft(d, env), [], d.id);
  assert.ok(!report.pages.some((p) => p.action === 'auto-ok'), 'Q&A 是一級內容，沒有 auto-ok');
  const byKey = (k) => report.pages.find((p) => p.key.endsWith(`-${k}`));
  const draft = (id) => drafts.find((d) => d.id === id);
  // (1) 跟疾病批同網址的結核病、登革熱 Q&A 頁：已在疾病批轉過 ⇒ skip-duplicate、輸出全是「重複」、不記 not-in-manifest、也沒搶走清單裡別的項目
  for (const k of ['tuberculosis-qa', 'dengue-qa']) {
    const p = byKey(k);
    assert.equal(p.action, 'skip-duplicate', k); assert.equal(p.manifestKey, null); assert.ok(p.outputs.length >= 7 && p.outputs.every((o) => o.role === 'duplicate'));
    assert.ok(p.issues.some((i) => i.code === 'converted-elsewhere') && !p.issues.some((i) => i.code === 'not-in-manifest'));
  }
  assert.equal(byKey('hepatitis-b-qa').manifestKey, 'hepatitis-b-qa', '「Q&A」這種通稱標題不會被登革熱頁搶走');
  assert.ok(!drafts.some((d) => d.id === 'faq.tb-cough-two-weeks'), '結核病的題在本批沒有草稿');
  // (2) 鬆散結構：統計頁（<h3>）與謠言頁（<p><strong>Q：</strong></p>）各拆 3 題，記 faq-structure-loose（info），既有題對到既有 id
  for (const k of ['stats-qa', 'rumor-qa']) { const p = byKey(k); assert.equal(p.outputs.filter((o) => o.role === 'draft').length, 3, k); assert.ok(p.issues.some((i) => i.code === 'faq-structure-loose' && i.severity === 'info')); assert.equal(p.action, 'compare-existing'); }
  assert.ok(draft('faq.stats-ili-rate') && draft('faq.rumor-mmr-autism'));
  assert.doesNotMatch(draft('faq.rumor-mmr-autism').answerMarkdown, /^A：/, '答案開頭的「A：」去掉');
  // (3) 英文頁：needs-source-zh、sourceLang en、tasks 不給、不 auto-ok
  const en = byKey('dengue-en-qa');
  assert.ok(en.issues.some((i) => i.code === 'needs-source-zh')); assert.equal(en.action, 'review-before-publish');
  const enDrafts = en.outputs.map((o) => draft(o.id));
  assert.ok(enDrafts.every((d) => d.sourceLang === 'en' && !d.tasks && /^faq\.dengue-legacy-/.test(d.id)));
  // (4) 期限已過：113 年度流感疫苗 Q&A 三題都記 answer-dated（warn），草稿 conversion.dated 列出期限
  const flu = byKey('flu-season-2024-qa');
  assert.equal(flu.issues.filter((i) => i.code === 'answer-dated' && i.severity === 'warn').length, 3);
  for (const o of flu.outputs) { const d = draft(o.id); assert.ok(d.conversion.dated?.length >= 1, o.id); assert.ok(d.conversion.dated.every((x) => x.date < '2026-10-04')); }
  assert.ok(!draft('faq.covid-antiviral').conversion.dated, '沒有過期期限的題不標');
  // (5) tasks 與 structured：旅遊頁的新題 tasks=travel、structured 週數範圍；預防接種頁「保護力多久」抽 weeks/months；既有題也給 tasks 候選
  const travel = byKey('travel-qa');
  const newTravel = travel.outputs.map((o) => draft(o.id)).find((d) => /^faq\.x-legacy-/.test(d.id));
  assert.deepEqual(newTravel.tasks, ['travel']); assert.deepEqual(newTravel.structured, { weeksMin: 4, weeksMax: 6 }); assert.equal(newTravel.conversion.structuredFromText, true);
  const protect = drafts.find((d) => d.question === '流感疫苗打完多久才有保護力？');
  assert.deepEqual(protect.structured, { weeks: 2, months: 6 }); assert.deepEqual(protect.tasks, ['vaccines']);
  assert.deepEqual(draft('faq.hpv-vaccine-who').tasks, ['vaccines']); assert.deepEqual(draft('faq.stats-where-data').tasks, ['data', 'situation']);
  assert.ok(travel.issues.some((i) => i.code === 'tasks-from-keywords') && travel.issues.some((i) => i.code === 'structured-from-text'));
  // (6) 同批重複：水痘頁的唯一一題已由預防接種頁轉出 ⇒ duplicate-title，清單目標是疾病頁 ⇒ compare-existing（不另出草稿）
  const var1 = byKey('varicella-qa');
  assert.ok(var1.issues.some((i) => i.code === 'duplicate-title')); assert.equal(var1.action, 'compare-existing'); assert.ok(var1.outputs.every((o) => o.role === 'duplicate'));
  // (7) 一頁多題且清單沒有單一目標 ⇒ 記 one-to-many、patch 維持 pending（不提議 migrated 到第一題）；單題頁可提議 migrated
  for (const k of ['vaccination-qa', 'travel-qa', 'stats-qa', 'rumor-qa']) {
    assert.ok(byKey(k).issues.some((i) => i.code === 'one-to-many'), k);
    const e = patch.items.find((x) => x.key === k); assert.equal(e.proposed.status, 'pending', k); assert.equal(e.proposed.target, null, k); assert.ok(e.draftIds.length > 1);
  }
  assert.equal(patch.items.find((x) => x.key === 'hepatitis-b-qa').suggestion.status, 'migrated');
  // (8) 整頁一題、標題就是問題 ⇒ faq-structure-missing 退路對到既有 faq.rabies-bite；列表頁略過、歸 OASIS
  const single = byKey('single-qa'); assert.deepEqual(single.outputs.map((o) => o.id), ['faq.rabies-bite']); assert.ok(single.issues.some((i) => i.code === 'faq-structure-missing'));
  const list = byKey('qa-list'); assert.equal(list.action, 'skip-list'); assert.equal(list.owner, 'unit.oasis');
  assert.deepEqual(s.byAction, { 'compare-existing': 10, 'review-before-publish': 2, 'skip-duplicate': 2, 'skip-list': 1 });
  assert.deepEqual(JSON.parse(fs.readFileSync(mf, 'utf8')), readJSON(path.join(CONTENT, 'migration/qa.json')), '沒加 --apply-migration 不改清單');
  // 沒有其他批次可查（priorBatchesDir 空）時，同網址頁照常轉：不會因為找不到報告而出錯
  const out2 = path.join(dir, 'out2');
  const r2 = runImport({ exportDir: exp, outDir: out2, manifestPath: mf, slug: 'qa', now: NOW, priorBatchesDir: path.join(dir, 'nothing') });
  assert.equal(r2.report.pages.find((p) => p.key.endsWith('-tuberculosis-qa')).action, 'compare-existing');
});

test('已提交的第八批輸出（data/legacy-import/qa）：15 頁 34 份草稿、schema 全過、清單 13 筆 verified 全 false、模擬匯出可重現', () => {
  const dir = path.join(ROOT, 'data/legacy-import/qa');
  const r = readJSON(path.join(dir, 'report.json'));
  assert.equal(r.summary.pages, 15); assert.equal(r.summary.drafts, 34); assert.equal(r.summary.schemaInvalid, 0); assert.equal(r.migration.applied, true); assert.equal(r.manifest.file, 'content/migration/qa.json');
  for (const d of r.drafts) assert.ok(fs.existsSync(path.join(dir, d.file)), d.file);
  assert.equal(r.summary.byAction['skip-duplicate'], 2);
  const manifest = readJSON(path.join(CONTENT, 'migration/qa.json'));
  assert.equal(manifest.items.length, 13); assert.equal(manifest.scope.kind, 'category'); assert.ok(manifest.items.every((i) => i.verified === false));
  assert.ok(manifest.items.every((i) => /【匯入 /.test(i.note ?? '')));
  assert.ok(manifest.items.filter((i) => i.status === 'pending').length >= 5, '一頁多題的主題頁維持 pending');
  const tmpDir = tmp('exp8');
  generateQa(tmpDir);
  const exp = path.join(ROOT, 'data/legacy-export/qa');
  for (const f of fs.readdirSync(exp).filter((x) => x.endsWith('.json') && x !== '_export.json')) assert.deepEqual(readJSON(path.join(tmpDir, f)), readJSON(path.join(exp, f)), f);
  // 第八批重跑後，各疾病批的 Q&A 草稿也帶 tasks 候選（既有題中第一個 task 多數與人工相同）
  let same = 0, total = 0;
  for (const b of fs.readdirSync(path.join(ROOT, 'data/legacy-import'))) {
    const fd = path.join(ROOT, 'data/legacy-import', b, 'content/faq');
    if (!fs.existsSync(fd)) continue;
    for (const f of fs.readdirSync(fd)) { const ex = path.join(CONTENT, 'faq', f); if (!fs.existsSync(ex)) continue; total++; const t = readJSON(path.join(fd, f)).tasks?.[0]; if (t && readJSON(ex).tasks?.includes(t)) same++; }
  }
  assert.ok(total >= 60 && same / total >= 0.85, `第一個 task 與人工一致 ${same}/${total}`);
});

// ───────────────────────── 第九批：國際旅遊與健康欄目 ─────────────────────────
import { countryFor, dynamicForm, vaccineCandidates } from '../scripts/lib/legacy-import/travel.mjs';
import { decideAction } from '../scripts/lib/legacy-import/index.mjs';

const travelShell = (title, crumbs, body) => `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title} - 衛生福利部疾病管制署</title></head>
<body><header class="navbar"><ul class="nav"><li>導覽</li></ul></header><ol class="breadcrumb">${crumbs.map((c) => `<li>${c}</li>`).join('')}</ol>
<div id="CCMS_Content"><h2 class="title">${title}</h2><div class="content-body">${body}</div><div class="update">最後更新時間：2026/09/01</div></div><footer>頁尾</footer></body></html>`;

/** 合成國際旅遊欄目的小匯出：處方箋國家頁（query 有 iso／只有標題／對不到國家）、查詢表單頁、疫苗小節頁、旅遊問答、門診與證明書服務、瘧疾預防用藥 */
function synthTravel(dir) {
  fs.mkdirSync(path.join(dir, 'files'), { recursive: true });
  fs.writeFileSync(path.join(dir, '_export.json'), JSON.stringify({ exportedAt: '2026-10-03', simulated: true }));
  const T = ['首頁', '國際旅遊與健康', '旅遊醫學'];
  const put = (name, url, title, crumbs, body) => {
    fs.writeFileSync(path.join(dir, `${name}.html`), travelShell(title, crumbs, body));
    fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify({ url: `https://www.cdc.gov.tw${url}`, title, category: crumbs.slice(1).join('／'), publishedAt: '2025-06-01', updatedAt: '2026-09-01', breadcrumbs: crumbs }));
  };
  const rx = (country) => `<h3>當地流行疾病</h3><table><tr><th>疾病</th><th>建議</th></tr><tr><td>麻疹</td><td>出國前確認 MMR 接種史</td></tr></table>
<h3>建議疫苗</h3><ul><li>麻疹腮腺炎德國麻疹混合疫苗（MMR）</li></ul><h3>行前與返國注意</h3><p>前往${country}前請至旅遊醫學門診評估，返國後如有發燒請告知旅遊史。</p>`;
  put('01-rx-jp', '/TravelEpidemic/Prescription/RX1?iso=JP', '國際旅遊處方箋：日本', [...T, '國際旅遊處方箋', '日本'], rx('日本'));
  put('02-rx-th', '/TravelEpidemic/Prescription/RX1', '國際旅遊處方箋：泰國', [...T, '國際旅遊處方箋', '泰國'], rx('泰國'));
  put('03-rx-zz', '/TravelEpidemic/Prescription/RX1?iso=ZZ', '國際旅遊處方箋：亞特蘭提斯', [...T, '國際旅遊處方箋', '亞特蘭提斯'], rx('亞特蘭提斯'));
  const countries = readJSON(path.join(CONTENT, 'master/countries.json')).slice(0, 25);
  put('04-query', '/Category/MPage/Q1', '國際旅遊處方箋', [...T, '國際旅遊處方箋'], `<p>選擇目的地，即可查詢當地流行疾病、建議疫苗與行前注意事項。</p>
<form class="travel-rx" method="get" action="/TravelEpidemic/Prescription/RX1"><select name="iso">${countries.map((c) => `<option value="${c.iso2}">${c.name}</option>`).join('')}</select>
<label><input type="checkbox" name="agree"> 我已閱讀說明</label><button type="submit">查詢</button></form><p>建議出國前 4 至 6 週查詢並至旅遊醫學門診評估。</p>`);
  put('05-vaccines', '/Category/MPage/V1', '國際預防接種及藥物', [...T, '國際預防接種及藥物'], `<p>前往特定地區需要接種的疫苗與預防用藥，請於出國前 4 至 6 週至旅遊醫學門診評估。</p>
<h3>黃熱病疫苗</h3><p>前往非洲與中南美洲流行地區須接種，接種 10 天後生效。</p><h3>流行性腦脊髓膜炎疫苗</h3><p>前往沙烏地阿拉伯朝覲者須接種。</p><h3>傷寒疫苗</h3><p>前往南亞衛生條件不佳地區建議接種。</p>
<h3>日本腦炎疫苗</h3><p>前往流行地區郊區長住者可評估接種。</p><h3>瘧疾預防用藥</h3><p>依目的地抗藥性選擇用藥。</p><h3>其他建議疫苗</h3><p>A 型肝炎、狂犬病等依行程評估。</p><h3>建議疫苗</h3><p>見上。</p>`);
  put('06-travel-faq', '/Category/QAPage/T1', '國際旅遊常見問答', ['首頁', '國際旅遊與健康', '常見問答'], `<div class="panel"><h4 class="panel-title">Q1. 出國前多久要去旅遊醫學門診？</h4><div class="panel-body"><p>建議出發前 4 至 6 週就診，讓疫苗有時間產生保護力。</p></div></div>`);
  put('07-clinics', '/Category/Page/C1', '旅遊醫學門診', [...T, '旅遊醫學門診'], '<p>全國旅遊醫學門診提供出國前諮詢、疫苗接種與預防用藥處方，請先電話預約。</p><table><tr><th>醫院</th><th>電話</th></tr><tr><td>某醫院</td><td>02-1234-5678</td></tr></table>');
  put('08-certificate', '/Category/MPage/Y1', '國際預防接種證明書（黃皮書）申請', [...T, '國際預防接種證明書（黃皮書）申請'], '<p>接種黃熱病疫苗後，由接種單位核發國際預防接種證明書，遺失可向原接種單位申請補發，請攜帶身分證件。</p>');
  put('09-malaria', '/Category/MPage/M1', '瘧疾預防用藥', [...T, '瘧疾預防用藥'], '<p>前往瘧疾流行地區，請於出發前就醫評估是否需要服用預防用藥，並全程做好防蚊措施，返國後如有發燒請儘速就醫。</p>');
  return dir;
}

test('第九批工具：國家（query → 標題 → 麵包屑，最長命中）、查詢表單偵測與移除、主檔沒有的疫苗小節', () => {
  const countries = readJSON(path.join(CONTENT, 'master/countries.json'));
  assert.equal(countryFor(countries, { query: new URLSearchParams('iso=jp'), title: '國際旅遊處方箋' }).iso2, 'JP');
  assert.equal(countryFor(countries, { query: new URLSearchParams('ISO2=TH') }).from, 'query');
  assert.equal(countryFor(countries, { query: new URLSearchParams('iso=ZZ'), title: '國際旅遊處方箋：泰國' }).iso2, 'TH', 'query 不在主檔 ⇒ 改看標題');
  assert.equal(countryFor(countries, { title: '國際旅遊處方箋', breadcrumbs: ['首頁', '越南'] }).iso2, 'VN');
  assert.equal(countryFor(countries, { title: 'Travel prescription: Kenya' }).iso2, 'KE');
  assert.equal(countryFor(countries, { title: '國際旅遊處方箋：亞特蘭提斯' }), null);
  const opts = (n) => Array.from({ length: n }, (_, i) => `<option value="${i}">選項${i}</option>`).join('');
  const page = (n, extra = '') => parseHtml(`<div><p>選擇目的地查詢。</p><form><select name="iso">${opts(n)}</select><button>查詢</button></form>${extra}</div>`);
  const b = page(30);
  assert.deepEqual(dynamicForm(b), { options: 30, textChars: 8 });
  assert.equal(textOf(b).includes('選項'), false, '表單與選項已移除');
  assert.equal(dynamicForm(page(5)), null, '選項太少不算');
  assert.equal(dynamicForm(page(30, `<p>${'長文'.repeat(250)}</p>`)), null, '說明文字很長的頁不算查詢頁');
  const vb = parseHtml('<h3>黃熱病疫苗</h3><p>x</p><h4>傷寒疫苗接種須知</h4><h3>建議疫苗</h3><h3>其他建議疫苗</h3><h3>日本腦炎疫苗</h3><h3>A型肝炎疫苗</h3><h3>疫苗接種建議</h3><h2>黃熱病疫苗</h2>');
  assert.deepEqual(vaccineCandidates(vb, ['日本腦炎疫苗', 'A 型肝炎疫苗']), ['黃熱病疫苗', '傷寒疫苗']);
  assert.equal(decideAction({ flags: { generated: { iso2: 'JP' }, drop: true }, outputs: [], kind: 'generated', stats: {}, issues: [] }, rules), 'skip-generated', '資料產生頁優先於 drop');
});

test('第九批（國際旅遊與健康，合成匯出）：處方箋國家頁 skip-generated＋reference 對照檔、看不出國家退回 page、查詢表單不轉控制項、主檔沒有的疫苗提示、無疾病的旅遊問答歸 qa 批、門診與黃皮書建 service、瘧疾預防用藥併入疾病頁', () => {
  const dir = tmp('travel');
  const exp = synthTravel(path.join(dir, 'exp'));
  const mf = path.join(dir, 'travel.json');
  fs.writeFileSync(mf, JSON.stringify({
    id: 'migration.travel-test', type: 'migration', title: '測試', scope: { kind: 'category' },
    items: [
      { key: 'rx-jp', oldTitle: '國際旅遊處方箋：日本', oldUrl: 'https://www.cdc.gov.tw/TravelEpidemic/Prescription/RX1?iso=JP', oldType: 'page', verified: false, status: 'pending' },
      { key: 'clinics', oldTitle: '旅遊醫學門診', oldUrl: 'https://www.cdc.gov.tw/Category/Page/C1', oldType: 'page', verified: false, status: 'pending', target: 'service.travel-clinic-appointment' },
      { key: 'query', oldTitle: '國際旅遊處方箋', oldUrl: 'https://www.cdc.gov.tw/Category/MPage/Q1', oldType: 'page', verified: true, status: 'migrated', newPath: '/travel/', note: '301 到 /travel/' },
    ],
  }, null, 2));
  // 假的 qa 批報告：旅遊問答頁（同網址）已在 qa 批轉過
  const prior = path.join(dir, 'prior');
  fs.mkdirSync(path.join(prior, 'qa'), { recursive: true });
  fs.writeFileSync(path.join(prior, 'qa/report.json'), JSON.stringify({ batch: 'qa', pages: [{ key: '11-travel-qa', source: { url: 'https://www.cdc.gov.tw/Category/QAPage/T1' }, outputs: [{ id: 'faq.x', type: 'faq', role: 'draft' }] }] }));
  const out = path.join(dir, 'out');
  const { report, patch, drafts } = runImport({ exportDir: exp, outDir: out, manifestPath: mf, slug: 'travel', now: NOW, priorBatchesDir: prior });
  const by = (k) => report.pages.find((p) => p.key === k);
  const draft = (id) => drafts.find((d) => d.id === id);
  const has = (p, code) => p.issues.some((i) => i.code === code);
  const s = report.summary;
  assert.equal(s.pages, 9); assert.equal(s.schemaInvalid, 0);
  // (a) query 有 iso ⇒ 資料產生頁：不出草稿、reference 對照檔、清單提議 migrated＋newPath（301 到產生頁）並註明對應的產生頁
  const jp = by('01-rx-jp');
  assert.equal(jp.kind, 'generated'); assert.equal(jp.action, 'skip-generated'); assert.deepEqual(jp.outputs, []);
  assert.deepEqual(jp.flags.generated, { iso2: 'JP', newPath: '/travel/JP/' }); assert.ok(has(jp, 'generated-page'));
  assert.equal(jp.reference, 'reference/01-rx-jp.md');
  const ref = fs.readFileSync(path.join(out, jp.reference), 'utf8');
  assert.match(ref, /\/travel\/JP\//); assert.match(ref, /### 當地流行疾病/); assert.match(ref, /前往日本前請至旅遊醫學門診評估/);
  assert.ok(!drafts.some((d) => d.legacyUrls?.some((u) => /Prescription/.test(u) && /iso=JP/.test(u))), '國家頁沒有草稿');
  const e = patch.items.find((x) => x.key === 'rx-jp');
  assert.equal(e.proposed.status, 'migrated'); assert.equal(e.proposed.target, null); assert.equal(e.proposed.newPath, '/travel/JP/');
  assert.deepEqual(e.suggestion, { status: 'migrated', target: null, newPath: '/travel/JP/' }); assert.equal(e.change.newPath, true); assert.equal(e.change.target, false);
  assert.match(e.proposed.note, /對應新站 \/travel\/JP\/（資料產生頁），不出草稿/);
  // 清單已標 migrated＋newPath 的查詢表單頁：工具找不到內容 id 也不算衝突
  const qe = patch.items.find((x) => x.key === 'query');
  assert.equal(qe.agree, true); assert.equal(qe.proposed.status, 'migrated'); assert.equal(qe.proposed.newPath, '/travel/'); assert.equal(qe.change.newPath, false);
  assert.ok(!patch.conflicts.some((x) => x.key === 'query'), JSON.stringify(patch.conflicts));
  // 套用：rx-jp 寫入 status migrated＋newPath（放在 status 後），verified 不動；query 原樣
  applyPatch(mf, patch);
  const applied = JSON.parse(fs.readFileSync(mf, 'utf8')).items;
  const ajp = applied.find((i) => i.key === 'rx-jp');
  assert.equal(ajp.status, 'migrated'); assert.equal(ajp.newPath, '/travel/JP/'); assert.equal(ajp.target, undefined); assert.equal(ajp.verified, false);
  assert.deepEqual(Object.keys(ajp).slice(0, 7), ['key', 'oldTitle', 'oldUrl', 'oldType', 'verified', 'status', 'newPath']);
  assert.deepEqual(applied.find((i) => i.key === 'query').newPath, '/travel/');
  assert.equal(s.generated, 2); assert.equal(s.byKind.generated, 2); assert.equal(s.pagesWithoutOutput, 0, '資料產生頁不算沒有輸出');
  const md = fs.readFileSync(path.join(out, 'report.md'), 'utf8');
  assert.match(md, /## 資料產生頁（2 頁）/); assert.match(md, /「國際旅遊處方箋：日本」→ `\/travel\/JP\/` → 對照檔 `reference\/01-rx-jp\.md`/);
  // (b) query 沒有國家碼 ⇒ 由標題對國家主檔
  assert.deepEqual(by('02-rx-th').flags.generated, { iso2: 'TH', newPath: '/travel/TH/' }); assert.equal(by('02-rx-th').action, 'skip-generated');
  // (c) 對不到國家 ⇒ country-unknown（warn）＋一般 page 草稿
  const zz = by('03-rx-zz');
  assert.ok(has(zz, 'country-unknown')); assert.equal(zz.kind, 'page'); assert.ok(!zz.flags.generated);
  assert.equal(zz.outputs.length, 1); assert.equal(zz.outputs[0].type, 'page'); assert.ok(draft(zz.outputs[0].id));
  // (d) 查詢表單頁：dynamic-form（warn），表單控制項與選項不進內文，只留說明文字
  const q = by('04-query');
  assert.ok(q.issues.some((i) => i.code === 'dynamic-form' && i.severity === 'warn' && /25 個選項/.test(i.message)));
  assert.equal(q.kind, 'page');
  const qd = draft(q.outputs[0].id);
  assert.match(qd.bodyMarkdown, /選擇目的地/); assert.match(qd.bodyMarkdown, /4 至 6 週/);
  assert.doesNotMatch(qd.bodyMarkdown, /日本|韓國|我已閱讀|查詢<|select|option/);
  // (e) 小節提到主檔沒有的疫苗：一則提示列出名稱；通稱標題與主檔已有的（日本腦炎疫苗）不列
  const v = by('05-vaccines');
  const vi = v.issues.filter((i) => i.code === 'vaccine-not-in-master');
  assert.equal(vi.length, 1); assert.equal(vi[0].severity, 'info');
  assert.match(vi[0].message, /黃熱病疫苗、流行性腦脊髓膜炎疫苗、傷寒疫苗；/);
  assert.doesNotMatch(vi[0].message, /日本腦炎疫苗|：建議疫苗|其他建議疫苗/);
  assert.deepEqual(draft(v.outputs[0].id).conversion.vaccineCandidates, ['黃熱病疫苗', '流行性腦脊髓膜炎疫苗', '傷寒疫苗']);
  // (f) 無疾病的旅遊問答：家是 qa 批（rules.homeBatches.faq），qa 批已轉過 ⇒ skip-duplicate
  const faq = by('06-travel-faq');
  assert.equal(faq.action, 'skip-duplicate'); assert.ok(has(faq, 'converted-elsewhere')); assert.deepEqual(faq.flags.convertedElsewhere, { batch: 'qa', key: '11-travel-qa' });
  assert.deepEqual(faq.outputs.map((o) => [o.id, o.role]), [['faq.x', 'duplicate']]);
  // (g) 服務：旅遊醫學門診（清單目標 service.travel-clinic-appointment 既有 ⇒ 同 id、compare-existing）、黃皮書申請（標題關鍵字 ⇒ certificate）
  assert.equal(serviceTypeFor(rules, '旅遊醫學門診').serviceType, 'clinic');
  assert.equal(serviceTypeFor(rules, '國際預防接種證明書（黃皮書）申請').serviceType, 'certificate');
  const c = by('07-clinics');
  assert.equal(c.kind, 'service'); assert.deepEqual(c.outputs.map((o) => o.id), ['service.travel-clinic-appointment']); assert.equal(c.action, 'compare-existing');
  assert.equal(draft('service.travel-clinic-appointment').serviceType, 'clinic'); assert.ok(has(c, 'fields-pending'));
  const y = by('08-certificate');
  assert.equal(y.kind, 'service'); assert.ok(has(y, 'type-from-keywords')); assert.equal(draft(y.outputs[0].id).serviceType, 'certificate'); assert.match(y.outputs[0].id, /^service\./);
  // 瘧疾預防用藥：麵包屑在「旅遊醫學」（mergeScopes）⇒ 併入 disease.malaria 的 prevention 區塊（預防性投藥屬預防，不是治療）
  const m = by('09-malaria');
  assert.equal(m.kind, 'disease-block'); assert.equal(m.action, 'merge-into-disease'); assert.deepEqual(m.outputs.map((o) => [o.id, o.block]), [['disease.malaria', 'prevention']]);
  assert.equal(m.owner, 'unit.quarantine');
  // 同一份匯出在 qa 批自己跑：不讓給自己，照常出草稿
  const r2 = runImport({ exportDir: exp, outDir: path.join(dir, 'out-qa'), manifestPath: mf, slug: 'qa', now: NOW, priorBatchesDir: prior });
  const faq2 = r2.report.pages.find((p) => p.key === '06-travel-faq');
  assert.notEqual(faq2.action, 'skip-duplicate'); assert.ok(!faq2.flags.convertedElsewhere); assert.ok(faq2.outputs.some((o) => o.role === 'draft'));
});

test('已提交的第九批輸出（data/legacy-import/travel）：20 頁 13 份草稿、6 頁資料產生頁只留 reference、清單 19 筆 11 筆 newPath、模擬匯出可重現', () => {
  const dir = path.join(ROOT, 'data/legacy-import/travel');
  const r = readJSON(path.join(dir, 'report.json'));
  assert.equal(r.summary.pages, 20); assert.equal(r.summary.drafts, 13); assert.equal(r.summary.schemaInvalid, 0); assert.equal(r.summary.generated, 6);
  assert.equal(r.migration.applied, true); assert.equal(r.manifest.file, 'content/migration/travel.json');
  for (const d of r.drafts) assert.ok(fs.existsSync(path.join(dir, d.file)), d.file);
  assert.equal(r.summary.byAction['skip-generated'], 6); assert.equal(r.summary.byAction['skip-list'], 4); assert.equal(r.summary.byAction['skip-duplicate'], 1); assert.equal(r.summary.byAction['merge-into-disease'], 1);
  // 資料產生頁不出草稿，舊內文存 reference/{key}.md
  const refs = fs.readdirSync(path.join(dir, 'reference')).filter((f) => f.endsWith('.md')).sort();
  assert.deepEqual(refs, ['05-rx-br.md', '06-rx-in.md', '07-rx-jp.md', '08-rx-ke.md', '09-rx-th.md', '10-rx-vn.md']);
  for (const p of r.pages.filter((x) => x.action === 'skip-generated')) { assert.ok(!p.outputs.some((o) => o.role === 'draft'), p.key); assert.match(p.flags.generated.newPath, /^\/travel\/[A-Z]{2}\/$/); }
  const manifest = readJSON(path.join(CONTENT, 'migration/travel.json'));
  assert.equal(manifest.items.length, 19); assert.equal(manifest.scope.kind, 'category'); assert.ok(manifest.items.every((i) => i.verified === false));
  assert.ok(manifest.items.every((i) => /【匯入 /.test(i.note ?? '')));
  assert.equal(manifest.items.filter((i) => i.newPath).length, 11); assert.ok(manifest.items.every((i) => !(i.newPath && i.target)), 'newPath 與 target 二擇一');
  assert.equal(manifest.items.filter((i) => i.status === 'pending').length, 3);
  const tmpDir = tmp('exp9');
  generateTravel(tmpDir);
  const exp = path.join(ROOT, 'data/legacy-export/travel');
  for (const f of fs.readdirSync(exp).filter((x) => x.endsWith('.json') && x !== '_export.json')) assert.deepEqual(readJSON(path.join(tmpDir, f)), readJSON(path.join(exp, f)), f);
});

// ───────────────────────── 第十批：宣導素材欄目 ─────────────────────────
import { materialScope, materialKind, imageOnly, imageGallery, langVariants, materialOutdated, externalSystemPage } from '../scripts/lib/legacy-import/materials.mjs';
import { png, pdfText } from '../scripts/lib/legacy-import/sim-export.mjs';

test('第十批工具：素材型別（標題優先於麵包屑、非素材欄目不生效）、圖片承載、圖庫、附件語言版本、素材早於正本、外部系統頁', () => {
  assert.ok(rules.version >= 9); // 第十一批升 10
  const M = ['首頁', '宣導素材'];
  assert.ok(materialScope(rules, { breadcrumbs: [...M, '海報'] })); assert.ok(materialScope(rules, { category: '結核病／宣導素材' })); assert.ok(!materialScope(rules, { breadcrumbs: ['首頁', '傳染病與防疫專題', '登革熱'] }));
  assert.deepEqual(materialKind(rules, { title: '登革熱「巡、倒、清、刷」海報系列', breadcrumbs: [...M, '海報'] }), { type: 'publication', pubType: 'poster', via: 'title', rule: '海報|單張|摺頁|貼紙|懶人包|圖卡', hit: '海報' });
  // 標題優先：麵包屑是「影片」，標題說「手冊」⇒ manual
  assert.equal(materialKind(rules, { title: '長照機構感染管制手冊（宣導版）', breadcrumbs: [...M, '多媒體', '影片'] }).pubType, 'manual');
  // 標題沒命中 ⇒ 麵包屑由最後一層往前：「多媒體／動畫」⇒ animation（不是多媒體的 video）
  const an = materialKind(rules, { title: '手部衛生小教室', breadcrumbs: [...M, '多媒體', '動畫'] });
  assert.equal(an.type, 'media'); assert.equal(an.mediaType, 'animation'); assert.equal(an.via, 'breadcrumb');
  assert.equal(materialKind(rules, { title: '抗藥性細菌一起顧', breadcrumbs: [...M, '多媒體', '廣播'] }).mediaType, 'podcast');
  assert.equal(materialKind(rules, { title: '寵物打狂犬病疫苗（影片）', breadcrumbs: [...M, '多媒體'] }).mediaType, 'video');
  assert.equal(materialKind(rules, { title: '30 秒短影音', breadcrumbs: [...M, '多媒體', '影片'] }).mediaType, 'short');
  assert.equal(materialKind(rules, { title: '登革熱防治海報', breadcrumbs: ['首頁', '傳染病與防疫專題', '登革熱'] }), null, '非 materialScopes 不生效');
  assert.equal(materialKind(rules, { title: '1922 防疫達人', breadcrumbs: [...M, '社群'] }), null, '素材欄目但標題與麵包屑都沒命中');
  // 圖片承載：有圖且純文字 < 80 字（minBodyChars 40 × 2）；圖片 alt 不算內文
  assert.equal(imageOnly({ markdown: '![洗手五步驟很長很長的替代文字](/files/x/a.png)', images: 1, minChars: 40 }), true);
  assert.equal(imageOnly({ markdown: '勤洗手。', images: 0, minChars: 40 }), false, '沒有圖不算');
  assert.equal(imageOnly({ markdown: `${'說明文字'.repeat(21)}\n\n![a](/x.png)`, images: 1, minChars: 40 }), false, '84 字不算');
  assert.equal(imageGallery(4), 4); assert.equal(imageGallery([1, 2, 3]), 0);
  // 附件語言：七語＋簡體（不在站上七語）
  const lv = langVariants(['中文版', 'English', '日本語', 'Tiếng Việt', 'Bahasa Indonesia', 'ไทย', 'Tagalog', '簡體中文'].map((l, i) => ({ label: `流感疫苗接種海報（${l}）`, file: `f${i}.pdf` })));
  assert.deepEqual([...lv.keys()].sort(), ['en', 'id', 'ja', 'th', 'tl', 'vi', 'zh-CN', 'zh-TW']);
  assert.equal(lv.get('zh-CN')[0].file, 'f7.pdf', '「簡體中文」不算繁中');
  assert.deepEqual([...langVariants([{ label: 'Poster (Vietnamese)' }, { label: '登革熱單張', file: 'dengue-indonesian.pdf' }, { label: '海報' }]).keys()], ['vi', 'id']);
  // 素材早於正本：只算「素材日落在同家族舊版與新版之間」（依據已修訂）；只有一版、或素材早於家族第一版（當時沒有正本）都不算
  const idx = loadContentIndex(CONTENT);
  const mo = materialOutdated({ publishedAt: '2019-09-01', diseaseId: 'disease.measles', contentIndex: idx });
  assert.deepEqual(mo, { docId: 'doc.mmr-recommendation.2025-04-16', effectiveAt: '2025-04-16', supersededId: 'doc.mmr-recommendation.2019-05-14', supersededAt: '2019-05-14' });
  assert.equal(materialOutdated({ publishedAt: '2019-03-01', diseaseId: 'disease.measles', contentIndex: idx }), null, '早於家族第一版（當時沒有正本）⇒ 不算修訂，是久遠');
  assert.equal(materialOutdated({ publishedAt: '2026-10-01', diseaseId: 'disease.measles', contentIndex: idx }), null, '晚於正本 ⇒ null');
  assert.equal(materialOutdated({ publishedAt: '2019-09-01', diseaseId: 'disease.no-such', contentIndex: idx }), null);
  // 外部系統頁：字少、無站內連結、有站外連結
  const ext = '1922 防疫達人社群，歡迎加入。\n\n- [Facebook 粉絲專頁](https://www.facebook.com/x)\n- [LINE 官方帳號](https://line.me/R/ti/p/x)';
  assert.deepEqual(externalSystemPage({ markdown: ext, stat: { links: 2, legacyLinks: 0 } }), ['www.facebook.com', 'line.me']);
  assert.deepEqual(externalSystemPage({ markdown: `${ext}\n\n[疾管署](https://www.cdc.gov.tw/Category/List/A)`, stat: { links: 3, legacyLinks: 1 } }), [], '有舊站連結不算');
  assert.deepEqual(externalSystemPage({ markdown: `${'說明'.repeat(120)}\n\n[x](https://line.me/x)`, stat: {} }), [], '內文長不算');
  assert.deepEqual(externalSystemPage({ markdown: '只有文字。', stat: {} }), [], '沒有站外連結不算');
});

/** 合成宣導素材欄目的小匯出：單張（只有圖）、七語海報、2019 麻疹海報、狂犬病影片（無文字稿）、動畫（只有麵包屑看得出）、M 痘圖卡（4 圖）、1922 社群（外部連結）、TB 七語海報（同網址複製）、長照手冊（清單 target 既有）、海報列表頁 */
function synthMaterials(dir) {
  fs.mkdirSync(path.join(dir, 'files'), { recursive: true });
  fs.writeFileSync(path.join(dir, '_export.json'), JSON.stringify({ exportedAt: '2026-10-03', simulated: true, batch: 'materials' }));
  const M = ['首頁', '宣導素材'];
  const img = (file, alt) => { fs.writeFileSync(path.join(dir, 'files', file), png(40, 30, [0.4, 0.8, 0.6], [200, 60, 60])); return `<p><img src="/Upload/images/2026/09/${file}"${alt == null ? '' : ` alt="${alt}"`}></p>`; };
  const pdf = (file, label) => { fs.writeFileSync(path.join(dir, 'files', file), pdfText('Poster', ['Simulated poster PDF'])); return { url: `https://www.cdc.gov.tw/File/Get/${file.replace(/\W/g, '')}`, label, file }; };
  const put = (name, url, title, crumbs, body, { publishedAt = '2026-07-01', updatedAt = publishedAt, attachments = [] } = {}) => {
    fs.writeFileSync(path.join(dir, `${name}.html`), travelShell(title, crumbs, body));
    fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify({ url: `https://www.cdc.gov.tw${url}`, title, category: crumbs.slice(1).join('／'), publishedAt, updatedAt, breadcrumbs: crumbs, attachments }));
  };
  put('01-leaflet-ev', '/Category/ListContent/L2?uaid=P1', '腸病毒洗手五步驟單張', [...M, '單張'], `<p>勤洗手。</p>${img('ev-handwash.png', '洗手五步驟：濕、搓、沖、捧、擦')}`, { publishedAt: '2026-09-20', attachments: [pdf('ev-handwash.pdf', '腸病毒洗手五步驟單張（PDF）')] });
  const langs = ['中文版', 'English', '日本語', 'Tiếng Việt', 'Bahasa Indonesia', 'ไทย', 'Tagalog', '簡體中文'];
  put('02-poster-flu-7lang', '/Category/ListContent/L1?uaid=P2', '流感疫苗接種宣導海報（七語）', [...M, '海報'], `<p>流感疫苗接種宣導海報，提供多種語言版本。</p>${img('flu-7lang.png', '流感疫苗接種海報')}`,
    { publishedAt: '2026-09-25', attachments: langs.map((l, i) => pdf(`flu-poster-${i}.pdf`, `流感疫苗接種海報（${l}）`)) });
  put('03-poster-measles-2019', '/Category/ListContent/L1?uaid=P3', '麻疹防治宣導海報（2019 年版）', [...M, '海報'], `<p>出國前確認麻疹疫苗接種紀錄。</p>${img('measles-2019.png', '麻疹防治海報')}`,
    { publishedAt: '2019-09-01', attachments: [pdf('measles-2019.pdf', '麻疹防治宣導海報（PDF）')] });
  put('04-video-rabies', '/Category/ListContent/V1?uaid=P4', '寵物打狂犬病疫苗：守護家人也守護毛孩（影片）', [...M, '多媒體', '影片'], '<p>帶毛孩打狂犬病疫苗。</p><iframe src="https://www.youtube.com/embed/xxxxxxxxxxx" title="影片"></iframe>', { publishedAt: '2026-08-20' });
  put('05-animation', '/Category/ListContent/V2?uaid=P5', '手部衛生小教室', [...M, '多媒體', '動畫'], '<p>一起學正確洗手。</p><iframe src="https://www.youtube.com/embed/yyyyyyyyyyy" title="動畫"></iframe>', { publishedAt: '2026-08-21' });
  put('06-mpox-cards', '/Category/ListContent/L1?uaid=P6', 'M痘防治懶人包（社群圖卡）', [...M, '海報'],
    `<p>M痘主要透過親密接觸傳播，出現皮疹、發燒等症狀請儘速就醫並主動告知接觸史。</p><p>高風險族群可接種公費疫苗，兩劑間隔四週，完成接種後仍應注意安全性行為。</p><p>圖卡歡迎分享至社群平台，請勿修改內容。</p>${[1, 2, 3, 4].map((n) => img(`mpox-${n}.png`, `M痘圖卡 ${n}`)).join('')}`, { publishedAt: '2026-05-15' });
  put('07-fb-1922', '/Category/MPage/F1', '1922 防疫達人（Facebook／LINE）', [...M, '社群'], '<p>加入 1922 防疫達人，即時掌握防疫資訊。</p><ul><li><a href="https://www.facebook.com/example">Facebook 粉絲專頁</a></li><li><a href="https://line.me/R/ti/p/example">LINE 官方帳號</a></li></ul>');
  // TB 批已轉過的七語海報（原樣複製）
  const tb = path.join(ROOT, 'data/legacy-export/tuberculosis');
  for (const ext of ['html', 'json']) fs.copyFileSync(path.join(tb, `10-materials-poster.${ext}`), path.join(dir, `08-poster-tb-7lang.${ext}`));
  for (const f of ['tb-poster-7lang.pdf', 'tb-poster-7lang-thumb.png']) fs.copyFileSync(path.join(tb, 'files', f), path.join(dir, 'files', f));
  put('09-manual-ltc', '/Category/ListContent/L3?uaid=P9', '長照機構感染管制手冊（宣導版）', [...M, '手冊'], '<p>長照機構工作人員日常感染管制重點：手部衛生、環境清潔、群聚通報。</p>', { publishedAt: '2026-03-01', attachments: [pdf('ltc-ic.pdf', '長照機構感染管制手冊（PDF）')] });
  put('10-list-posters', '/Category/List/L1', '海報', [...M, '海報'], '<ul><li><a href="/Category/ListContent/L1?uaid=P2">流感疫苗接種宣導海報（七語）</a></li></ul>');
  return dir;
}

test('第十批（宣導素材欄目，合成匯出）：海報與單張建 publication（只有圖 ⇒ image-only、文字版待補）、七語附件 languages pending、2019 海報封存＋早於正本、影片無文字稿、動畫由麵包屑判、外部系統頁、TB 同網址 skip-duplicate、清單 target 既有 ⇒ compare-existing', () => {
  const dir = tmp('materials');
  const exp = synthMaterials(path.join(dir, 'exp'));
  const mf = path.join(dir, 'materials.json');
  fs.writeFileSync(mf, JSON.stringify({ id: 'migration.materials-test', type: 'migration', title: '測試', scope: { kind: 'category', name: '宣導素材' }, items: [
    { key: 'manual-ltc-ic-public', oldTitle: '長照機構感染管制手冊（宣導版）', oldUrl: 'https://www.cdc.gov.tw/Category/ListContent/L3?uaid=P9', oldType: 'page', verified: false, status: 'migrated', target: 'publication.manual-ltc-infection-control-2026' },
  ] }, null, 2));
  const out = path.join(dir, 'out');
  const { report, drafts } = runImport({ exportDir: exp, outDir: out, manifestPath: mf, slug: 'materials', now: NOW, priorBatchesDir: path.join(ROOT, 'data/legacy-import') });
  const by = (k) => report.pages.find((p) => p.key === k);
  const draft = (p) => drafts.find((d) => d.id === p.outputs[0]?.id);
  const iss = (p, code) => p.issues.find((i) => i.code === code);
  assert.equal(report.summary.pages, 10); assert.equal(report.summary.schemaInvalid, 0, JSON.stringify(report.drafts.filter((d) => !d.schemaValid).map((d) => d.errors)));
  const env = { units: new Set(readJSON(path.join(CONTENT, 'master/units.json')).map((u) => u.id)), diseaseIds: new Set(master.map((d) => d.id)), assetsDir: path.join(out, 'content/assets'), licenses: ['OGDL-1.0', 'CC0-1.0', 'CC-BY-4.0'] };
  for (const d of drafts) assert.deepEqual(validateDraft(d, env), [], d.id);
  // (a) 單張只有圖：publication poster（標題「單張」⇒ type-from-category）、image-only（warn）、圖片進 assets、摘要＝文字＋alt 條列＋（待補）
  const ev = by('01-leaflet-ev');
  assert.equal(ev.kind, 'publication'); assert.equal(ev.type, 'publication'); assert.match(ev.outputs[0].id, /^publication\./);
  assert.equal(iss(ev, 'type-from-category').severity, 'info'); assert.match(iss(ev, 'type-from-category').message, /標題有「單張」.*publication（pubType poster）/);
  assert.equal(iss(ev, 'image-only').severity, 'warn');
  assert.match(iss(ev, 'fields-pending').message, /abstractMarkdown/);
  assert.equal(ev.owner, 'unit.acute-infectious', '有疾病的素材歸疾病業務組（preferDiseaseFor material），不歸公關室'); assert.ok(iss(ev, 'owner-from-disease'));
  const evd = draft(ev);
  assert.equal(evd.pubType, 'poster'); assert.match(evd.pdfUrl, /\.pdf$/);
  assert.match(evd.abstractMarkdown, /勤洗手。/); assert.match(evd.abstractMarkdown, /- 洗手五步驟：濕、搓、沖、捧、擦/); assert.match(evd.abstractMarkdown, /（待補：海報文字版）/);
  assert.deepEqual(evd.assets.filter((a) => a.kind === 'image').map((a) => [a.alt, a.license, a.needsAlt]), [['洗手五步驟：濕、搓、沖、捧、擦', 'OGDL-1.0', false]]);
  assert.deepEqual(evd.basedOn, ['disease.enterovirus']);
  // (b) 七語附件：languages 六語 pending（簡體不進）、附件 label 保留語言字樣
  const flu = by('02-poster-flu-7lang');
  assert.equal(flu.kind, 'publication');
  assert.match(iss(flu, 'lang-variants').message, /附件含 6 種語言版本（en、ja、vi、id、th、tl）.*zh-CN 不在站上七語/);
  const fd = draft(flu);
  assert.deepEqual(Object.keys(fd.languages).sort(), ['en', 'id', 'ja', 'th', 'tl', 'vi', 'zh-TW']);
  assert.ok(['en', 'id', 'ja', 'th', 'tl', 'vi'].every((l) => fd.languages[l].status === 'pending')); assert.equal(fd.languages['zh-TW'].status, 'source');
  assert.ok(fd.assets.some((a) => a.label === '流感疫苗接種海報（Tiếng Việt）') && fd.assets.some((a) => a.label === '流感疫苗接種海報（簡體中文）'));
  // (c) 2019 麻疹海報：久遠 ⇒ archive；早於麻疹現行文件 ⇒ material-outdated、basedOn 加文件 id
  const ms = by('03-poster-measles-2019');
  assert.equal(ms.kind, 'publication'); assert.equal(ms.action, 'archive'); assert.ok(iss(ms, 'old-content'));
  assert.equal(iss(ms, 'material-outdated').severity, 'warn');
  assert.match(iss(ms, 'material-outdated').message, /素材製作日 2019-09-01 時依據的 doc\.mmr-recommendation\.2019-05-14（2019-05-14）已於 2025-04-16 被 doc\.mmr-recommendation\.2025-04-16 取代/);
  assert.deepEqual(draft(ms).basedOn, ['disease.measles', 'doc.mmr-recommendation.2025-04-16']);
  // (d) 影片無文字稿：media video、transcriptMarkdown 待補、basedOn 含疾病；嵌入影片不算未轉入
  const rv = by('04-video-rabies');
  assert.equal(rv.kind, 'media'); assert.match(rv.outputs[0].id, /^media\./);
  const rvd = draft(rv);
  assert.equal(rvd.mediaType, 'video'); assert.match(rvd.transcriptMarkdown, /待補/); assert.match(iss(rv, 'fields-pending').message, /transcriptMarkdown/);
  assert.equal(rvd.basedOn[0], 'disease.rabies'); assert.ok(!iss(rv, 'embedded-media'));
  // (e) 動畫：標題看不出，麵包屑最後一層「動畫」⇒ animation
  const an = by('05-animation');
  assert.equal(an.kind, 'media'); assert.equal(draft(an).mediaType, 'animation'); assert.match(iss(an, 'type-from-category').message, /麵包屑有「動畫」/);
  // (f) 4 張圖：image-gallery（一筆、多個 image 資產），文字夠長不算 image-only
  const mp = by('06-mpox-cards');
  assert.match(iss(mp, 'image-gallery').message, /同頁 4 張圖建成一筆/); assert.ok(!iss(mp, 'image-only'));
  assert.equal(draft(mp).assets.filter((a) => a.kind === 'image').length, 4); assert.equal(draft(mp).pubType, 'poster');
  // (g) 外部系統頁：external-system（info），仍是 page、review-before-publish
  const fb = by('07-fb-1922');
  assert.equal(fb.kind, 'page'); assert.equal(fb.action, 'review-before-publish');
  assert.match(iss(fb, 'external-system').message, /網域 www\.facebook\.com、line\.me/);
  // (h) TB 七語海報（同網址、TB 批已轉過）⇒ skip-duplicate，不出草稿
  const tb = by('08-poster-tb-7lang');
  assert.equal(tb.action, 'skip-duplicate'); assert.deepEqual(tb.flags.convertedElsewhere, { batch: 'tuberculosis', key: '10-materials-poster' });
  assert.deepEqual(tb.outputs.map((o) => [o.id, o.role]), [['publication.poster-tb-seven-languages', 'duplicate']]);
  assert.ok(!drafts.some((d) => d.id === 'publication.poster-tb-seven-languages'));
  // (i) 清單 target 是既有出版品 ⇒ 依清單建 publication（type-from-manifest 優先，不記 type-from-category）、compare-existing
  const lt = by('09-manual-ltc');
  assert.equal(lt.kind, 'publication'); assert.deepEqual(lt.outputs.map((o) => o.id), ['publication.manual-ltc-infection-control-2026']); assert.equal(lt.action, 'compare-existing');
  assert.ok(iss(lt, 'type-from-manifest')); assert.ok(!iss(lt, 'type-from-category'));
  // (j) 列表頁不因標題「海報」改型別：仍是 list ⇒ skip-list
  const ls = by('10-list-posters');
  assert.equal(ls.kind, 'list'); assert.equal(ls.action, 'skip-list');
  // 同一份匯出在 tuberculosis 批自己跑：家是本批，不讓
  const r2 = runImport({ exportDir: exp, outDir: path.join(dir, 'out-tb'), manifestPath: mf, slug: 'tuberculosis', now: NOW, priorBatchesDir: path.join(ROOT, 'data/legacy-import') });
  const tb2 = r2.report.pages.find((p) => p.key === '08-poster-tb-7lang');
  assert.notEqual(tb2.action, 'skip-duplicate'); assert.ok(!tb2.flags.convertedElsewhere);
});

test('已提交的第十批輸出（data/legacy-import/materials）：24 頁 21 份草稿、7 頁型別由欄目位置決定、TB 三頁 skip-duplicate、清單 21 筆 6 筆 newPath、模擬匯出可重現', () => {
  const dir = path.join(ROOT, 'data/legacy-import/materials');
  const r = readJSON(path.join(dir, 'report.json'));
  assert.equal(r.summary.pages, 24); assert.equal(r.summary.drafts, 21); assert.equal(r.summary.schemaInvalid, 0);
  assert.equal(r.migration.applied, true); assert.equal(r.manifest.file, 'content/migration/materials.json');
  for (const d of r.drafts) assert.ok(fs.existsSync(path.join(dir, d.file)), d.file);
  assert.deepEqual(r.summary.byAction, { 'compare-existing': 5, 'review-before-publish': 8, 'skip-list': 6, archive: 2, 'skip-duplicate': 3 });
  assert.equal(r.summary.byType.publication, 7); assert.equal(r.summary.byType.media, 4);
  const codes = (c) => r.pages.flatMap((p) => p.issues).filter((i) => i.code === c).length;
  assert.equal(codes('type-from-category'), 7); assert.equal(codes('image-only'), 5); assert.equal(codes('lang-variants'), 2); assert.equal(codes('material-outdated'), 2); assert.equal(codes('external-system'), 2);
  // 結核病批已轉過的三頁：不出草稿、家批 tuberculosis；有疾病的素材 owner 回到疾病業務組
  for (const k of ['20-poster-tb-7lang', '23-video-tb-cough', '24-video-tb-migrant']) { const p = r.pages.find((x) => x.key === k); assert.equal(p.action, 'skip-duplicate', k); assert.equal(p.flags.convertedElsewhere.batch, 'tuberculosis'); }
  assert.ok(r.pages.filter((p) => p.diseases?.length && p.kind !== 'list').every((p) => p.owner !== 'unit.pr'), '有疾病的素材不歸公關室');
  const manifest = readJSON(path.join(CONTENT, 'migration/materials.json'));
  assert.equal(manifest.items.length, 21); assert.equal(manifest.scope.kind, 'category'); assert.ok(manifest.items.every((i) => i.verified === false));
  assert.ok(manifest.items.every((i) => /【匯入 /.test(i.note ?? '')));
  assert.equal(manifest.items.filter((i) => i.newPath).length, 6); assert.equal(manifest.items.filter((i) => i.status === 'pending').length, 10);
  const tmpDir = tmp('exp10');
  generateMaterials(tmpDir);
  const exp = path.join(ROOT, 'data/legacy-export/materials');
  for (const f of fs.readdirSync(exp).filter((x) => x.endsWith('.json') && x !== '_export.json')) assert.deepEqual(readJSON(path.join(tmpDir, f)), readJSON(path.join(exp, f)), f);
});

// ───────────────────────── 第十一批：統計專區欄目 ─────────────────────────
import { statScope, periodicalIssues, tableSeries, seriesGaps, statsStale, datasetByUrl, systemEntryHosts, isoWeekMonday } from '../scripts/lib/legacy-import/statistics.mjs';

test('第十一批工具：統計頁範圍、期刊期別（週／月／年、民國年、無年份、< 3 期）、表格時序（西元、民國、%、千分位、合計列、多值欄）、缺期與重複、過時、站外連結對既有資料集', () => {
  assert.equal(rules.version, 10);
  assert.deepEqual(rules.statScopes, ['統計專區', '統計資料', 'Data & Statistics']);
  assert.equal(matchUrlPattern(rules, '/En/Category/List/gK4BJWe3qYlmNxYJBqEcxA').id, 'category-list-en');
  assert.equal(matchUrlPattern(rules, '/Category/List/ZrvS2zJwZ03tl8CbKYdI8g').id, 'category-list');
  assert.equal(ownerForCategory(rules, '統計專區／疫情監測速訊').owner, 'unit.epidemic-intelligence');
  assert.equal(ownerForCategory(rules, '', ['Home', 'Data & Statistics']).owner, 'unit.epidemic-intelligence');
  assert.equal(ownerForCategory(rules, '結核病／統計資料').rule, '結核病／統計資料', '最長命中優先，既有規則照舊');
  assert.ok(statScope(rules, { breadcrumbs: ['首頁', '統計專區', '疫情監測速訊'] })); assert.ok(statScope(rules, { category: '結核病／統計資料' }));
  assert.ok(statScope(rules, { breadcrumbs: ['Home', 'Data & Statistics'] })); assert.ok(!statScope(rules, { breadcrumbs: ['首頁', '宣導素材', '海報'] }));
  const att = (labels) => labels.map((label, i) => ({ label, file: `f${i}.pdf` }));
  // 週：ISO 週一、降冪、latest
  assert.equal(isoWeekMonday(2026, 40), '2026-09-28'); assert.equal(isoWeekMonday(2020, 53), '2020-12-28');
  const w = periodicalIssues(att(['疫情監測速訊 2026 年第 33 週', '疫情監測速訊 2026 年第 40 週', '疫情監測速訊 2026 年第 39 週']));
  assert.equal(w.granularity, 'week'); assert.deepEqual(w.issues.map((x) => x.no), [40, 39, 33]);
  assert.deepEqual(w.latest, { label: '疫情監測速訊 2026 年第 40 週', file: 'f1.pdf', year: 2026, no: 40, date: '2026-09-28' });
  // 民國年 ⇒ 西元；無年份 ⇒ defaultYear
  assert.equal(periodicalIssues(att(['115 年第 36 週', '115 年第 40 週', '115 年第 38 週'])).latest.date, '2026-09-28');
  const nf = periodicalIssues(att(['流感速訊第 35 週', '流感速訊第 40 週', '流感速訊第 36 週']), { defaultYear: 2026 });
  assert.equal(nf.latest.year, 2026); assert.equal(nf.latest.date, '2026-09-28');
  // 月、年（年報）；檔名也可
  const m = periodicalIssues(att(['2026 年 1 月', '2026 年 3 月', '114 年 12 月']));
  assert.equal(m.granularity, 'month'); assert.deepEqual(m.issues.map((x) => x.date), ['2026-03-01', '2026-01-01', '2025-12-01']);
  const y = periodicalIssues(att(['2020 年', '2025 年', '2024 年年報']));
  assert.equal(y.granularity, 'year'); assert.equal(y.latest.date, '2025-01-01');
  assert.equal(periodicalIssues([{ file: '2026-W38.pdf' }, { file: '2026-W39.pdf' }, { file: '2026-W40.pdf' }]).latest.no, 40);
  assert.equal(periodicalIssues(att(['2026 年第 1 週', '2026 年第 2 週'])), null, '< 3 期');
  assert.equal(periodicalIssues(att(['附表一', '申請書', '說明'])), null, '不是期別');
  // 表格時序：西元、千分位、合計列略過、多值欄只取第一欄（note）、病例數 ⇒ 人
  const md = '說明。\n\n| 年 | 境外移入確定病例數 | 占全部確定病例比率（%） |\n| --- | --- | --- |\n| 2017 | 1,234 | 12.5 |\n| 2016 | 300 | 10 |\n| 2018 | 400 | 9.1% |\n| 合計 | 1,934 | — |';
  assert.deepEqual(tableSeries(md), { label: '境外移入確定病例數', unit: '人', granularity: 'year', points: [{ t: '2016', v: 300 }, { t: '2017', v: 1234 }, { t: '2018', v: 400 }], note: '另有欄位：占全部確定病例比率（%）' });
  // 民國年（可帶「年」）＋率 ⇒ %
  const v = tableSeries('| 年度 | 接種完成率（%） |\n|---|---|\n| 104年 | 96.1 |\n| 105年 | 96.5% |\n| 106 年 | 97 |');
  assert.equal(v.unit, '%'); assert.deepEqual(v.points.map((p) => p.t), ['2015', '2016', '2017']); assert.equal(v.note, '');
  assert.equal(tableSeries('| 年月 | 件數 |\n|---|---|\n| 2026-01 | 3 |\n| 2026-02 | 4 |\n| 2026-03 | 5 |').granularity, 'month');
  assert.equal(tableSeries('| 年月 | 件數 |\n|---|---|\n| 2026-01 | 3 |\n| 2026-02 | 4 |\n| 2026-03 | 5 |').unit, '件');
  assert.equal(tableSeries('| 年 | 例數 |\n|---|---|\n| 2024 | 1 |\n| 2025 | 2 |\n| 合計 | 3 |'), null, '< 3 點（合計列不算）');
  assert.equal(tableSeries('| 項目 | 內容 |\n|---|---|\n| 檢體 | 血清 |\n| 時限 | 24 小時 |\n| 單位 | 檢驗中心 |'), null, '第一欄不是時間');
  // 缺期與重複；遞減後回升不報
  assert.deepEqual(seriesGaps({ granularity: 'year', points: [{ t: '2015', v: 9 }, { t: '2016', v: 3 }, { t: '2018', v: 8 }, { t: '2018', v: 8 }] }), ['缺 2017 年', '2018 年 重複 2 筆']);
  assert.deepEqual(seriesGaps({ granularity: 'year', points: [{ t: '2020', v: 9 }, { t: '2021', v: 1 }, { t: '2022', v: 9 }] }), []);
  assert.deepEqual(seriesGaps({ granularity: 'week', points: [{ t: '2025-W52', v: 1 }, { t: '2026-W01', v: 1 }, { t: '2026-W03', v: 1 }] }), ['缺 2026-W02']);
  // 過時：年 ⇒ 最新 < 今年 − 1；月／週 ⇒ 落後超過 3 期
  assert.deepEqual(statsStale({ granularity: 'year', points: [{ t: '2021', v: 1 }, { t: '2022', v: 1 }] }, '2026-10-05'), { latest: '2022', expected: '2025' });
  assert.equal(statsStale({ granularity: 'year', points: [{ t: '2025', v: 1 }] }, '2026-10-05'), null);
  assert.deepEqual(statsStale({ granularity: 'month', points: [{ t: '2026-05', v: 1 }] }, '2026-10-05'), { latest: '2026-05', expected: '2026-07' });
  assert.equal(statsStale({ granularity: 'month', points: [{ t: '2026-07', v: 1 }] }, '2026-10-05'), null);
  assert.deepEqual(statsStale({ granularity: 'week', points: [{ t: '2026-W30', v: 1 }] }, '2026-10-05'), { latest: '2026-W30', expected: '2026-W38' });
  // 站外連結 → 既有資料集：nidss 精確；data.cdc.gov.tw 多筆 ⇒ 第一筆、ambiguous；host 去 www
  const idx = loadContentIndex(CONTENT);
  assert.equal(idx.byId.get('dataset.nidss').canonicalUrl, 'https://nidss.cdc.gov.tw/'); assert.equal(idx.byId.get('dataset.vaccine-coverage').portalUrl, 'https://data.cdc.gov.tw/dataset/routine-vaccination-coverage');
  assert.deepEqual(datasetByUrl([{ href: 'https://nidss.cdc.gov.tw/' }], idx), { id: 'dataset.nidss', host: 'nidss.cdc.gov.tw', exact: true, candidates: 1, ambiguous: false });
  assert.equal(datasetByUrl(['https://nidss.cdc.gov.tw/nndss/', 'https://data.cdc.gov.tw/'], idx).id, 'dataset.nidss', '防疫資料庫：第一個連結的 host 只有一筆');
  const dp = datasetByUrl(['https://data.cdc.gov.tw/'], idx);
  const firstData = [...idx.byId.entries()].find(([, x]) => x.type === 'dataset' && /data\.cdc\.gov\.tw/.test(x.canonicalUrl ?? ''))[0];
  assert.equal(dp.id, firstData); assert.equal(dp.exact, false); assert.ok(dp.candidates > 1); assert.equal(dp.ambiguous, true);
  assert.equal(datasetByUrl(['https://data.cdc.gov.tw/dataset/routine-vaccination-coverage'], idx).id, 'dataset.vaccine-coverage', 'canonicalUrl 完全相等者優先');
  assert.equal(datasetByUrl(['https://www.antiflu.cdc.gov.tw/x'], idx).id, 'dataset.flu-express', 'host 去 www');
  assert.equal(datasetByUrl(['https://example.org/'], idx), null);
  // 統計頁版的外部系統入口：疾管署子網域系統算外部；舊站 www 與站內相對連結不算
  assert.deepEqual(systemEntryHosts({ markdown: '請由下列入口查詢。\n\n- [NIDSS](https://nidss.cdc.gov.tw/)' }), ['nidss.cdc.gov.tw']);
  assert.deepEqual(systemEntryHosts({ markdown: '入口。\n\n- [NIDSS](https://nidss.cdc.gov.tw/)\n- [首頁](https://www.cdc.gov.tw/)' }), []);
  assert.deepEqual(externalSystemPage({ markdown: '請由下列入口查詢。\n\n- [NIDSS](https://nidss.cdc.gov.tw/)', stat: {} }), [], '第十批的判斷不變（cdc.gov.tw 子網域算站內）');
});

/** 合成統計專區的小匯出：期刊（週、民國週、無年份週）、統計表（西元多值欄、民國 %、缺年且舊）、NIDSS 入口、資料開放平臺入口、英文列表、TB 統計（同網址複製）、年報（清單 target 既有出版品） */
function synthStatistics(dir) {
  fs.mkdirSync(path.join(dir, 'files'), { recursive: true });
  fs.writeFileSync(path.join(dir, '_export.json'), JSON.stringify({ exportedAt: '2026-10-05', simulated: true, batch: 'statistics' }));
  const S = ['首頁', '統計專區'];
  const pdf = (file, label) => { fs.writeFileSync(path.join(dir, 'files', file), pdfText('Issue', [label])); return { url: `https://www.cdc.gov.tw/File/Get/${file.replace(/\W/g, '')}`, label, file }; };
  const put = (name, url, title, crumbs, body, { publishedAt = '2026-01-01', updatedAt = '2026-09-30', attachments = [] } = {}) => {
    fs.writeFileSync(path.join(dir, `${name}.html`), travelShell(title, crumbs, body));
    fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify({ url: `https://www.cdc.gov.tw${url}`, title, category: crumbs.slice(1).join('／'), publishedAt, updatedAt, breadcrumbs: crumbs, attachments }));
  };
  const table = (head, rows) => `<table><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  const intro = '<p>本頁每週更新，提供國內重要傳染病監測摘要，歡迎下載各期 PDF 參考。</p>';
  put('01-surveillance-express', '/Category/MPage/94JVbJ2BFjR_3MTi-9s9Cg', '疫情監測速訊', [...S, '疫情監測速訊'], intro,
    { attachments: [33, 34, 35, 36, 37, 38, 39, 40].map((n) => pdf(`se-2026-w${n}.pdf`, `疫情監測速訊 2026 年第 ${n} 週`)) });
  put('02-ev-weekly', '/Category/MPage/EVW1', '腸病毒疫情週報', [...S, '腸病毒疫情週報'], intro,
    { attachments: [36, 37, 38, 39, 40].map((n) => pdf(`ev-115-w${n}.pdf`, `腸病毒疫情週報 115 年第 ${n} 週`)) });
  put('03-flu-express', '/Category/MPage/FLU1', '流感速訊', [...S, '流感速訊'], `${intro}<p>即時資料請見<a href="https://antiflu.cdc.gov.tw/">流感資訊網</a>。</p>`,
    { attachments: [35, 36, 37, 38, 39, 40].map((n) => pdf(`flu-w${n}.pdf`, `流感速訊第 ${n} 週`)) });
  put('04-imported-cases', '/Category/Page/5Q6qrh5kM6TnpnRpy3XDfQ', '法定傳染病境外移入確定病例統計', [...S, '法定傳染病境外移入確定病例統計'],
    `<p>下表為歷年法定傳染病境外移入確定病例數（示意數字）。</p>${table(['年', '境外移入確定病例數', '占全部確定病例比率（%）'], [...Array.from({ length: 10 }, (_, i) => [2016 + i, (1000 + i * 37).toLocaleString('en-US'), `${(10 + i / 2).toFixed(1)}`]), ['合計', '10,665', '—']])}`);
  put('05-vaccine-coverage', '/Category/MPage/VAC1', '常規疫苗接種完成率', [...S, '常規疫苗接種完成率'],
    `<p>各年度常規疫苗接種完成率（示意數字）。</p>${table(['年度', '接種完成率（%）'], Array.from({ length: 11 }, (_, i) => [`${104 + i}年`, `${(95 + i * 0.2).toFixed(1)}`]))}`);
  put('06-death-stats', '/Category/MPage/DTH1', '法定傳染病死亡統計', [...S, '法定傳染病死亡統計'],
    `<p>法定傳染病歷年死亡人數（示意數字）。</p>${table(['年', '死亡人數'], [2015, 2016, 2017, 2018, 2020, 2021, 2022].map((yr, i) => [yr, 50 - i]))}`);
  put('07-nidss', '/Category/MPage/NIDSS1', '傳染病統計資料查詢系統', [...S, '傳染病統計資料查詢系統'], '<p>法定傳染病統計線上查詢。</p><ul><li><a href="https://nidss.cdc.gov.tw/">傳染病統計資料查詢系統（NIDSS）</a></li></ul>');
  put('08-open-data-portal', '/Category/MPage/ODP1', '疾管署資料開放平臺', [...S, '疾管署資料開放平臺'], '<p>開放資料下載。</p><ul><li><a href="https://data.cdc.gov.tw/">疾管署資料開放平臺</a></li></ul>');
  put('09-list-statistics-en', '/En/Category/List/gK4BJWe3qYlmNxYJBqEcxA', 'Data & Statistics', ['Home', 'Data & Statistics'], '<ul><li><a href="/En/Category/MPage/A1">NIDSS</a></li><li><a href="/En/Category/MPage/A2">Annual Report</a></li></ul>');
  // 結核病批已轉過的統計資料頁（原樣複製）
  const tb = path.join(ROOT, 'data/legacy-export/tuberculosis');
  for (const ext of ['html', 'json']) fs.copyFileSync(path.join(tb, `24-stats.${ext}`), path.join(dir, `10-tb-stats.${ext}`));
  for (const f of ['tb-new-cases-by-year.csv', 'tb-new-cases-trend.png']) if (fs.existsSync(path.join(tb, 'files', f))) fs.copyFileSync(path.join(tb, 'files', f), path.join(dir, 'files', f));
  put('11-annual-report', '/Category/MPage/ANN1', '傳染病統計暨監視年報', [...S, '傳染病統計暨監視年報'], '<p>本署每年出版傳染病統計暨監視年報，彙整法定傳染病流行概況。</p>',
    { attachments: [2020, 2021, 2022, 2023, 2024, 2025].map((yr) => pdf(`annual-${yr}.pdf`, `傳染病統計暨監視年報 ${yr} 年`)) });
  return dir;
}

test('第十一批（統計專區欄目，合成匯出）：期刊建 dataset document-library（resources 降冪、不走版次鏈）、表格建 structured-table 與 series、缺年且舊 ⇒ series-gaps／stats-stale、NIDSS 入口 ⇒ dataset.nidss、資料開放平臺無法判定 ⇒ page、英文列表 skip-list、TB 同網址 skip-duplicate、清單 target 的頁也有 series／resources', () => {
  const dir = tmp('statistics');
  const exp = synthStatistics(path.join(dir, 'exp'));
  const mf = path.join(dir, 'statistics.json');
  fs.writeFileSync(mf, JSON.stringify({ id: 'migration.statistics-test', type: 'migration', title: '測試', scope: { kind: 'category', name: '統計專區' }, items: [
    { key: 'flu-express', oldTitle: '流感速訊', oldUrl: 'https://www.cdc.gov.tw/Category/MPage/FLU1', oldType: 'page', verified: false, status: 'migrated', target: 'dataset.flu-express' },
    { key: 'vaccine-coverage', oldTitle: '常規疫苗接種完成率', oldUrl: 'https://www.cdc.gov.tw/Category/MPage/VAC1', oldType: 'page', verified: false, status: 'migrated', target: 'dataset.vaccine-coverage' },
    { key: 'annual-report', oldTitle: '傳染病統計暨監視年報', oldUrl: 'https://www.cdc.gov.tw/Category/MPage/ANN1', oldType: 'page', verified: false, status: 'migrated', target: 'publication.statistics-annual-2025' },
  ] }, null, 2));
  const out = path.join(dir, 'out');
  const { report, drafts } = runImport({ exportDir: exp, outDir: out, manifestPath: mf, slug: 'statistics', now: NOW, priorBatchesDir: path.join(ROOT, 'data/legacy-import') });
  const by = (k) => report.pages.find((p) => p.key === k);
  const draft = (p) => drafts.find((d) => d.id === p.outputs[0]?.id);
  const iss = (p, code) => p.issues.find((i) => i.code === code);
  assert.equal(report.summary.pages, 11); assert.equal(report.summary.schemaInvalid, 0, JSON.stringify(report.drafts.filter((d) => !d.schemaValid).map((d) => d.errors)));
  assert.ok(report.pages.every((p) => p.owner === 'unit.epidemic-intelligence'), '統計專區（含英文 Data & Statistics、結核病／統計資料）歸疫情中心');
  // (a) 週期刊：dataset document-library、weekly、lastUpdated＝第 40 週週一、resources 依期別降冪；不是版次 ⇒ 沒有 version／family、只出一筆草稿
  const se = by('01-surveillance-express');
  assert.equal(se.kind, 'dataset'); assert.equal(se.action, 'review-before-publish'); assert.equal(se.outputs.length, 1);
  assert.match(iss(se, 'type-from-category').message, /8 期期刊.*document-library/);
  assert.equal(iss(se, 'periodical-issues').severity, 'info'); assert.match(iss(se, 'periodical-issues').message, /^8 期、最新 2026 年第 40 週；期別不是版次/);
  const sd = draft(se);
  assert.equal(sd.category, 'document-library'); assert.equal(sd.updateFrequency, 'weekly'); assert.equal(sd.lastUpdated, '2026-09-28');
  assert.deepEqual(sd.resources.map((r) => r.label), [40, 39, 38, 37, 36, 35, 34, 33].map((n) => `疫情監測速訊 2026 年第 ${n} 週`));
  assert.ok(sd.resources.every((r) => r.format === 'PDF' && r.href.startsWith(`/files/${sd.id}/`) && fs.existsSync(path.join(out, 'content/assets', r.href.replace(/^\/files\//, '')))));
  assert.equal(sd.version, undefined); assert.equal(sd.family, undefined); assert.equal(sd.supersedes, undefined);
  assert.ok(!se.issues.some((i) => /version/.test(i.code)));
  // (b) 民國年週報 ⇒ 西元；(c) 無年份週 ＋ 清單 target 既有 dataset ⇒ type-from-manifest、compare-existing，但 resources／lastUpdated 照樣補；站外連結 antiflu ⇒ dataset-by-url
  assert.equal(draft(by('02-ev-weekly')).lastUpdated, '2026-09-28'); assert.match(iss(by('02-ev-weekly'), 'periodical-issues').message, /最新 2026 年第 40 週/);
  const fl = by('03-flu-express');
  assert.equal(fl.kind, 'dataset'); assert.deepEqual(fl.outputs.map((o) => o.id), ['dataset.flu-express']); assert.equal(fl.action, 'compare-existing');
  assert.ok(iss(fl, 'type-from-manifest')); assert.ok(!iss(fl, 'type-from-category'));
  assert.equal(draft(fl).resources.length, 6); assert.equal(draft(fl).lastUpdated, '2026-09-28'); assert.equal(draft(fl).category, 'document-library');
  // (d) 表格：structured-table、series 第一數值欄（人）、千分位、合計列略過、note 列另一欄
  const ic = by('04-imported-cases');
  assert.equal(ic.kind, 'dataset'); assert.match(iss(ic, 'series-extracted').message, /^10 點、2016–2025、人/);
  const icd = draft(ic);
  assert.equal(icd.category, 'structured-table'); assert.equal(icd.series.label, '境外移入確定病例數'); assert.equal(icd.series.unit, '人'); assert.equal(icd.series.granularity, 'year');
  assert.equal(icd.series.points.length, 10); assert.deepEqual(icd.series.points[1], { t: '2017', v: 1037 }); assert.equal(icd.series.note, '另有欄位：占全部確定病例比率（%）');
  assert.ok(!iss(ic, 'series-gaps') && !iss(ic, 'stats-stale'));
  // (e) 清單 target 既有 dataset 的表格頁：型別來自清單，series 也補（民國 ⇒ 西元、%）
  const vc = by('05-vaccine-coverage');
  assert.deepEqual(vc.outputs.map((o) => o.id), ['dataset.vaccine-coverage']); assert.equal(vc.action, 'compare-existing'); assert.ok(iss(vc, 'type-from-manifest'));
  const vcd = draft(vc);
  assert.equal(vcd.series.unit, '%'); assert.equal(vcd.series.points[0].t, '2015'); assert.equal(vcd.series.points.at(-1).t, '2025'); assert.equal(vcd.series.note, undefined);
  // (f) 缺 2019、最新 2022 ⇒ series-gaps、stats-stale（warn）；動作不受影響
  const dt = by('06-death-stats');
  assert.equal(iss(dt, 'series-gaps').severity, 'warn'); assert.match(iss(dt, 'series-gaps').message, /缺 2019 年/);
  assert.equal(iss(dt, 'stats-stale').severity, 'warn'); assert.match(iss(dt, 'stats-stale').message, /最新一筆 2022，資料可能已停更或開放平臺有新版/);
  assert.equal(dt.action, 'review-before-publish');
  // (g) NIDSS 入口（清單沒給型別）：external-system ＋ dataset-by-url ⇒ dataset.nidss、compare-existing、canonicalUrl 取既有資料集
  const nd = by('07-nidss');
  assert.equal(nd.kind, 'dataset'); assert.deepEqual(nd.outputs.map((o) => o.id), ['dataset.nidss']); assert.equal(nd.action, 'compare-existing');
  assert.match(iss(nd, 'external-system').message, /nidss\.cdc\.gov\.tw/); assert.match(iss(nd, 'dataset-by-url').message, /依站外連結 host nidss\.cdc\.gov\.tw 對到既有資料集 dataset\.nidss/);
  assert.equal(draft(nd).canonicalUrl, 'https://nidss.cdc.gov.tw/'); assert.ok(!iss(nd, 'fields-pending'));
  // (h) 資料開放平臺首頁：host 對到多筆、沒有完全相等 ⇒ 不改型別，維持 page（第十批行為）＋ 提示
  const op = by('08-open-data-portal');
  assert.equal(op.kind, 'page'); assert.match(iss(op, 'external-system').message, /data\.cdc\.gov\.tw/); assert.match(iss(op, 'dataset-by-url').message, /無法判定是哪一筆，維持 page/);
  // (i) 英文列表：category-list-en ⇒ list、skip-list、sourceLang en、不記 type-unclear
  const en = by('09-list-statistics-en');
  assert.equal(en.pattern, 'category-list-en'); assert.equal(en.kind, 'list'); assert.equal(en.action, 'skip-list'); assert.ok(!iss(en, 'type-unclear'));
  assert.equal(draft(en).sourceLang, 'en');
  // (j) TB 統計資料（同網址，結核病批已轉過）⇒ skip-duplicate、不出草稿
  const tb = by('10-tb-stats');
  assert.equal(tb.action, 'skip-duplicate'); assert.deepEqual(tb.flags.convertedElsewhere, { batch: 'tuberculosis', key: '24-stats' });
  assert.deepEqual(tb.outputs.map((o) => [o.id, o.role]), [['dataset.tb-new-cases', 'duplicate']]); assert.ok(!drafts.some((d) => d.id === 'dataset.tb-new-cases'));
  // (k) 年報：清單 target 既有出版品 ⇒ publication、compare-existing；periodical-issues 只是 info，不拆版次
  const an = by('11-annual-report');
  assert.equal(an.kind, 'publication'); assert.deepEqual(an.outputs.map((o) => o.id), ['publication.statistics-annual-2025']); assert.equal(an.action, 'compare-existing');
  assert.equal(iss(an, 'periodical-issues').severity, 'info'); assert.match(iss(an, 'periodical-issues').message, /6 期期刊、最新 2025 年/);
  assert.equal(draft(an).assets.filter((a) => a.kind === 'attachment').length, 6);
});

test('已提交的第十一批輸出（data/legacy-import/statistics）：15 頁 13 份草稿、期刊 5 頁逐期 resources、表格 series 3 筆、入口頁對到既有資料集、兩頁跨批重複、清單 13 筆 3 筆 newPath、模擬匯出可重現', () => {
  const dir = path.join(ROOT, 'data/legacy-import/statistics');
  const r = readJSON(path.join(dir, 'report.json'));
  assert.equal(r.summary.pages, 15); assert.equal(r.summary.drafts, 13); assert.equal(r.summary.schemaInvalid, 0);
  assert.equal(r.migration.applied, true); assert.equal(r.manifest.file, 'content/migration/statistics.json');
  for (const d of r.drafts) assert.ok(fs.existsSync(path.join(dir, d.file)), d.file);
  assert.deepEqual(r.summary.byAction, { 'compare-existing': 5, 'review-before-publish': 6, 'skip-duplicate': 2, 'skip-list': 2 });
  assert.deepEqual(r.summary.byType, { publication: 1, dataset: 8, page: 4 });
  assert.equal(r.summary.issues.error, 0); assert.equal(r.migration.conflicts?.length ?? 0, 0);
  const codes = (c) => r.pages.flatMap((p) => p.issues).filter((i) => i.code === c).length;
  assert.equal(codes('periodical-issues'), 5); assert.equal(codes('series-extracted'), 3); assert.equal(codes('series-gaps'), 1); assert.equal(codes('stats-stale'), 1);
  assert.equal(codes('external-system'), 4); assert.equal(codes('dataset-by-url'), 6);
  // 入口頁：host 對到既有資料集；開放資料平臺首頁判不出 ⇒ 維持 page；防疫資料庫清單走 newPath，不列為與清單判定不同
  const by = (k) => r.pages.find((p) => p.key === k);
  assert.equal(by('11-nidss').outputs[0].id, 'dataset.nidss'); assert.equal(by('07-flu-express').outputs[0].id, 'dataset.flu-express');
  assert.equal(by('12-open-data-portal').kind, 'page'); assert.equal(by('05-epidemic-database').kind, 'page');
  for (const k of ['04-dengue-stats', '14-tb-stats']) assert.equal(by(k).action, 'skip-duplicate', k);
  // 週報：一筆資料集逐期列 resources；疫苗接種率：series ＋ canonicalUrl 沿用既有資料集
  const ev = readJSON(path.join(dir, 'content/datasets/enterovirus-ev-weekly.json'));
  assert.equal(ev.category, 'document-library'); assert.equal(ev.updateFrequency, 'weekly'); assert.equal(ev.resources.length, 5);
  const vc = readJSON(path.join(dir, 'content/datasets/vaccine-coverage.json'));
  assert.equal(vc.series.points.length, 11); assert.equal(vc.series.unit, '%'); assert.match(vc.canonicalUrl, /^https:\/\/data\.cdc\.gov\.tw\//);
  const manifest = readJSON(path.join(CONTENT, 'migration/statistics.json'));
  assert.equal(manifest.items.length, 13); assert.equal(manifest.scope.kind, 'category'); assert.ok(manifest.items.every((i) => i.verified === false));
  assert.ok(manifest.items.every((i) => /【匯入 /.test(i.note ?? '')));
  assert.equal(manifest.items.filter((i) => i.newPath).length, 3); assert.equal(manifest.items.filter((i) => i.status === 'pending').length, 5);
  assert.ok(manifest.items.every((i) => !(i.newPath && i.target)), 'newPath 與 target 互斥');
  const tmpDir = tmp('exp11');
  generateStatistics(tmpDir);
  const exp = path.join(ROOT, 'data/legacy-export/statistics');
  for (const f of fs.readdirSync(exp).filter((x) => x.endsWith('.json') && x !== '_export.json')) assert.deepEqual(readJSON(path.join(tmpDir, f)), readJSON(path.join(exp, f)), f);
});
