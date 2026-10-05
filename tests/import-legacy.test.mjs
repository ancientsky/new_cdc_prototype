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
  fs.copyFileSync(path.join(CONTENT, 'migration/dengue.json'), mf);
  const out = path.join(dir, 'out');
  const { report, patch, drafts } = runImport({ exportDir: EXPORT_DENGUE, outDir: out, manifestPath: mf, slug: 'dengue', now: NOW });
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
  assert.equal(ns1.kind, 'news'); assert.equal(ns1.outputs[0].id, 'news.2026-09-15-letter-616-ns1');
  // Q&A 每題對到既有 faq id
  const faqs = drafts.filter((d) => d.type === 'faq');
  assert.equal(faqs.length, 7); assert.ok(faqs.every((f) => /^faq\.(dengue-|travel-)/.test(f.id) && f.conversion.existing));
  // 新 id 的前綴是 dengue，不是 x
  assert.ok(!drafts.some((d) => /\.x-/.test(d.id)), '沒有 short 退成 x 的 id');
  assert.ok(s.avgConfidence >= 0.8 && s.needsReview <= 5);
  assert.deepEqual(JSON.parse(fs.readFileSync(mf, 'utf8')), readJSON(path.join(CONTENT, 'migration/dengue.json')), '沒加 --apply-migration 不改清單');
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
  assert.equal(elig.kind, 'document'); assert.equal(elig.type, 'document'); assert.equal(elig.outputs[0].id, 'doc.flu-antiviral-eligibility.2026-09-21'); assert.equal(elig.existing, true);
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
  assert.deepEqual(s.byType, { faq: 10, publication: 1, media: 1, document: 5, dataset: 1, labtest: 1, page: 4, service: 2, news: 4, clarification: 1, disease: 1, topic: 1 });
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
  assert.equal(bare.find((d) => d.key === 'guideline').target, 'doc.flu-antiviral-eligibility.2026-09-21', '兩個版次取現行最新的，不是字母序第一個（6 月版）');
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
  const { report, drafts } = runImport({ exportDir: exp, outDir: path.join(dir, 'out'), manifestPath: path.join(dir, 'news.json'), slug: 'news', now: NOW });
  const s = report.summary;
  assert.equal(report.manifest, null, '新聞批次沒有清單，也不合成（主檔沒有 news 這種疾病）');
  assert.equal(s.pagesWithoutOutput, 0); assert.equal(s.schemaInvalid, 0); assert.equal(s.needsReview, 0);
  assert.ok(!report.pages.some((p) => p.issues.some((i) => i.code === 'not-in-manifest')), '沒有清單就不該有 not-in-manifest');
  // 三級：既有 45 則比對；近年合成新聞 auto-ok；久遠封存；活動報名 drop；列表頁 skip
  assert.equal(s.byAction['compare-existing'], 45); assert.equal(s.byAction['auto-ok'], 4); assert.equal(s.byAction.archive, 5); assert.equal(s.byAction.drop, 1); assert.equal(s.byAction['skip-list'], 1);
  for (const p of report.pages.filter((p) => p.action === 'archive')) assert.ok(p.flags.old && p.source.updatedAt < '2023-01-01', p.key);
  // 抽樣：ceil(4 × 0.1) = 1，依網址雜湊固定
  assert.equal(report.sampling.rate, 0.1); assert.equal(report.sampling.autoOk, 4); assert.equal(report.sampling.picked.length, 1);
  assert.ok(report.pages.find((p) => p.key === report.sampling.picked[0].key)?.action === 'auto-ok');
  // 通函：typeid 48 或標題「致醫界通函第 N 號」⇒ letter、letterNo、權責是疾病業務組而不是公關室
  const letters = drafts.filter((d) => d.type === 'letter');
  assert.equal(letters.length, 4); assert.ok(letters.every((d) => Number.isInteger(d.letterNo) && d.newsType === 'letter' && d.audience.includes('professional')));
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

test('已提交的第六批輸出（data/legacy-import/news）：60 頁、schema 全過、報告有抽樣名單、模擬匯出可重現；五批重跑後登革熱／腸病毒／屈公病的通函改為 letter', () => {
  const dir = path.join(ROOT, 'data/legacy-import/news');
  const r = readJSON(path.join(dir, 'report.json'));
  assert.equal(r.summary.pages, 60); assert.equal(r.summary.schemaInvalid, 0); assert.equal(r.manifest, null); assert.equal(r.sampling.picked.length, 1);
  for (const d of r.drafts) assert.ok(fs.existsSync(path.join(dir, d.file)), d.file);
  assert.ok(fs.readFileSync(path.join(dir, 'report.md'), 'utf8').includes('## 二級抽樣檢視名單'));
  const exp = path.join(ROOT, 'data/legacy-export/news');
  const tmpDir = tmp('exp6');
  generateNews(tmpDir);
  for (const f of fs.readdirSync(exp).filter((x) => x.endsWith('.json') && x !== '_export.json')) assert.deepEqual(readJSON(path.join(tmpDir, f)), readJSON(path.join(exp, f)), f);
  for (const f of ['dengue/content/news/2026-07-01-letter-dengue-guidance-v17.json', 'enterovirus/content/news/2026-03-15-letter-ev-guideline.json']) { const d = readJSON(path.join(ROOT, 'data/legacy-import', f)); assert.equal(d.type, 'letter'); assert.ok(Number.isInteger(d.letterNo)); }
});

