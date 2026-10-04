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
import { applyPatch } from '../scripts/lib/legacy-import/migration.mjs';
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
  assert.ok(s.needsReview >= 2 && s.needsReview <= 8, `需人工檢視 ${s.needsReview}`);
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
      { key: 'ns1', oldTitle: 'NS1 抗原快篩試劑配置公告（致醫界通函）', oldUrl: 'https://www.cdc.gov.tw/Bulletin/Detail/{id}#ns1', oldType: 'news', verified: false, status: 'migrated', target: 'news.2026-09-15-letter-616-ns1' },
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
  assert.equal(by('02-ns1').outputs[0].id, 'news.2026-09-15-letter-616-ns1');
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

test('登革熱模擬匯出（模板驅動）：20 模板項＋8 例外＋近年新聞；HTML 像舊站；任何有疾病頁的疾病都能產', () => {
  const dir = tmp('dengue-exp');
  const r = generateDisease('disease.dengue', dir);
  assert.equal(r.template, 20); assert.equal(r.manual, 8); assert.ok(r.news >= 3 && r.news <= 5); assert.equal(r.pages, 20 + 8 + r.news);
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
  for (const f of ['01-intro.json', '10-qa-list.json', '26-dengue-guidance-v16-archive.json']) assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')), JSON.parse(fs.readFileSync(path.join(EXPORT_DENGUE, f), 'utf8')), f);
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
  fs.copyFileSync(path.join(CONTENT, 'migration/dengue.json'), mf);
  const out = path.join(dir, 'out');
  const { report, patch, drafts } = runImport({ exportDir: EXPORT_DENGUE, outDir: out, manifestPath: mf, slug: 'dengue', now: NOW });
  const s = report.summary;
  assert.equal(s.pages, 33); assert.equal(s.pagesWithoutOutput, 0); assert.equal(s.schemaInvalid, 0);
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
  assert.equal(patch.summary.derivedItems, 20); assert.ok(patch.summary.derivedMatched >= 18, `推導對上 ${patch.summary.derivedMatched}`);
  assert.ok(patch.summary.unmatchedPages >= 4);
  assert.ok(patch.unmatchedPages.every((u) => u.suggest.status === 'pending' && u.suggest.verified === false));
  // 近年新聞依標題對到既有新聞 id，標 existing（供比對），不錯配到清單的通函項目
  const press = report.pages.find((p) => p.key.includes('dengue-first-local'));
  assert.equal(press.manifestKey, null); assert.equal(press.outputs[0].id, 'news.2026-07-21-dengue-first-local'); assert.equal(press.existing, true);
  const ns1 = report.pages.find((p) => p.manifestKey === 'dengue-ns1-notice');
  assert.equal(ns1.kind, 'news'); assert.equal(ns1.outputs[0].id, 'news.2026-09-15-letter-616-ns1');
  // Q&A 每題對到既有 faq id
  const faqs = drafts.filter((d) => d.type === 'faq');
  assert.equal(faqs.length, 7); assert.ok(faqs.every((f) => /^faq\.(dengue-|travel-)/.test(f.id) && f.conversion.existing));
  // 新 id 的前綴是 dengue，不是 x
  assert.ok(!drafts.some((d) => /\.x-/.test(d.id)), '沒有 short 退成 x 的 id');
  assert.ok(s.avgConfidence >= 0.8 && s.needsReview <= 5);
  assert.deepEqual(JSON.parse(fs.readFileSync(mf, 'utf8')), readJSON(path.join(CONTENT, 'migration/dengue.json')), '沒加 --apply-migration 不改清單');
});

test('已提交的登革熱批次輸出（data/legacy-import/dengue）：33 頁、schema 全過、清單只多 note、verified 全是 false', () => {
  const r = JSON.parse(fs.readFileSync(path.join(COMMITTED_DENGUE, 'report.json'), 'utf8'));
  assert.equal(r.summary.pages, 33); assert.equal(r.summary.schemaInvalid, 0); assert.equal(r.migration.applied, true); assert.equal(r.manifest.extends, 'migration-template.disease');
  for (const d of r.drafts) assert.ok(fs.existsSync(path.join(COMMITTED_DENGUE, d.file)), d.file);
  const manifest = readJSON(path.join(CONTENT, 'migration/dengue.json'));
  assert.equal(manifest.items.length, 8, '推導項沒有被寫進清單');
  assert.ok(manifest.items.every((i) => i.verified === false));
  assert.ok(manifest.items.every((i) => /【匯入 /.test(i.note ?? '')), '每筆 note 有匯入標記');
  assert.ok(fs.existsSync(path.join(COMMITTED_DENGUE, 'report.md')) && fs.existsSync(path.join(COMMITTED_DENGUE, 'migration-patch.json')));
  assert.match(fs.readFileSync(path.join(COMMITTED_DENGUE, 'report.md'), 'utf8'), /模板推導項/);
});
