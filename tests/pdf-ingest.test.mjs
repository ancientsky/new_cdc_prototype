// 第十九輪：PDF → 機讀版（scripts/lib/pdf-text.mjs、scripts/pdf-to-md.mjs）→ 頁碼切塊索引 → 引用標頁碼（docs/pdf-ingest.md）。
// 實際樣本：2026 年 2 月版登革熱/屈公病防治工作指引（data/pdf-ingest/，Yulun 提供的抽出文字）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { govern } from './helpers.mjs';
import { makeCtx } from '../scripts/lib/pages.mjs';
import { buildSearchIndex } from '../scripts/lib/index-builder.mjs';
import * as P from '../scripts/lib/pdf-text.mjs';
import * as documents from '../src/templates/public/documents.mjs';
import { pdfHref } from '../src/client/answer/core.js';

const SRC = 'data/pdf-ingest/dengue-chik-guideline-2026-02.txt';
const DOC = 'content/documents/guidance-dengue.2026-02.json';
const ID = 'doc.guidance-dengue.2026-02';
const text = fs.readFileSync(SRC, 'utf8');
const { sections, report } = P.pdfTextToSections(text);
const byKey = new Map(sections.map((s) => [s.key, s]));

test('中文數字與頁碼切頁：114 頁；封面目錄是 page 0（front）', () => {
  assert.deepEqual(['一', '十', '十二', '二十', '二十三'].map(P.cnToInt), [1, 10, 12, 20, 23]);
  const pages = P.splitPages(text);
  assert.equal(pages[0].front, true);
  assert.equal(pages.filter((p) => !p.front).length, 114);
  assert.equal(report.pageCount, 114);
  // 換頁字元（pdftotext 預設輸出）不影響切頁
  assert.equal(P.splitPages('封面\f\n1\n第一頁內文\n\n2\n第二頁').filter((p) => !p.front).length, 2);
});

test('章節結構：章／節／附件各自成段，標題正確，附件標題取自目錄', () => {
  for (const k of ['preface', 'ch1-dengue-s1', 'ch1-chik-s1', 'ch2-s2', 'ch5-s1', 'ch6-s4', 'references', 'annex-1', 'annex-6', 'annex-12']) assert.ok(byKey.has(k), k);
  assert.equal(byKey.get('ch2-s2').heading, '第二章 病例與病媒監測 · 第二節 病例定義');
  assert.equal(byKey.get('annex-11').heading, '附件十一：執行傳染病防治法第三十八條之通知方式相關表單');
  assert.deepEqual(byKey.get('ch5-s1').pages, [55, 55]);
  assert.match(byKey.get('ch2-s2').markdown, /^一、臨床條件$/m, '短的清單標籤自成一段');
});

test('表格頁、數字表格、表單附件：標出來不入索引；參考文獻不入索引；文字型附件（農園指引）入索引', () => {
  assert.ok(report.tablePages.includes(9) && report.tablePages.includes(27));
  assert.deepEqual(report.inlineTablePages, [4, 5]);
  assert.match(byKey.get('ch1-dengue-s2').markdown, /PDF 第 4 頁有一張數字表格/);
  assert.doesNotMatch(byKey.get('ch1-dengue-s2').markdown, /18617 33443/, '表格數字不得混進內文');
  for (const k of ['annex-3', 'annex-7', 'annex-11']) { assert.equal(byKey.get(k).kind, 'form', k); assert.equal(byKey.get(k).index, false, k); }
  assert.equal(byKey.get('annex-2').kind, 'figure');
  assert.equal(byKey.get('references').index, false);
  assert.equal(byKey.get('annex-6').kind, 'text');
  assert.equal(byKey.get('annex-6').index, true);
});

test('跨頁的同一句接回上一頁（引用算起始頁），清單開頭不接', () => {
  assert.ok(report.joinedAcrossPages > 0);
  assert.match(byKey.get('ch6-s4').markdown, /研判必須進入公、私場所或運輸工具從事防疫工作。\n\n〔p\.69〕/);
});

test('splitByPage：依頁碼標記切塊，表格與表單說明不算內容', () => {
  const parts = P.splitByPage('〔p.3〕\n\n第一段。\n\n> 本頁（PDF 第 3 頁）為表格。\n\n〔p.4〕\n\n第二段。');
  assert.deepEqual(parts, [{ page: 3, text: '第一段。' }, { page: 4, text: '第二段。' }]);
});

test('已提交的文件 JSON 與重新轉換一致（防止手改機讀版卻沒改來源），雜湊對得上來源檔', () => {
  const doc = JSON.parse(fs.readFileSync(DOC, 'utf8'));
  assert.deepEqual(doc.sections, sections);
  assert.equal(doc.machineReadableMarkdown, P.sectionsToMarkdown(doc.title, sections));
  assert.equal(doc.derivedFrom.sha256, crypto.createHash('sha256').update(fs.readFileSync(SRC)).digest('hex'));
  assert.equal(doc.derivedFrom.reviewStatus, 'machine');
  assert.equal(doc.derivedFrom.redTextChanges, 'not-captured');
});

const site = govern('2026-10-06');
site.searchIndex = buildSearchIndex(site);
const chunks = site.searchIndex.pro.filter((c) => c.contentId === ID);

test('索引：每頁一塊、連到 #page-N、帶 pdfPage 與未校對標記；表單與參考文獻不入索引；民眾版不收', () => {
  assert.ok(chunks.length > 60, `chunks=${chunks.length}`);
  const c55 = chunks.find((c) => c.id === `${ID}#ch5-s1-p55`);
  assert.ok(c55);
  assert.equal(c55.pdfPage, 55);
  assert.match(c55.url, /#page-55$/);
  assert.equal(c55.extraction.reviewStatus, 'machine');
  assert.ok(!chunks.some((c) => /#(annex-(3|7|11)|references)/.test(c.id)));
  assert.ok(!site.searchIndex.public.some((c) => c.contentId === ID));
  // 沒有頁碼標記的舊文件：一段一塊，網址錨點與文件頁的 id="s-…" 一致
  const v17 = site.searchIndex.pro.find((c) => c.contentId === 'doc.case-definition-dengue.2026-01-01');
  assert.match(v17.url, /#s-[a-z]/);
  assert.equal(v17.pdfPage, undefined);
});

test('治理：未校對的 PDF 機讀版不進 AI 白名單，並產生「PDF 機讀版待校對」待辦（列出表格頁）', () => {
  const d = site.byId.get(ID);
  assert.equal(d.gov.whitelist.effective, false);
  assert.ok(d.gov.whitelist.reasons.includes('pdf-unreviewed'));
  const todo = site.gov.todos.find((t) => t.id === `pdf-unreviewed:${ID}`);
  assert.ok(todo);
  assert.match(todo.text, /第 4、5、9、/);
  assert.match(todo.text, /reviewed/);
  // 改成 reviewed 之後就沒有這條理由
  const s2 = govern('2026-10-06', (s) => { s.byId.get(ID).derivedFrom.reviewStatus = 'reviewed'; });
  assert.ok(!s2.byId.get(ID).gov.whitelist.reasons.includes('pdf-unreviewed'));
});

test('文件頁：頁碼標記變成 #page-N 錨點（每頁只有一個 id），小節用 h3', () => {
  const d = site.byId.get(ID);
  const html = String(documents.render(makeCtx(site, 'zh-TW', { path: '/documents/x/' }), { item: d }));
  assert.equal((html.match(/id="page-55"/g) ?? []).length, 1);
  assert.equal((html.match(/id="page-4"/g) ?? []).length, 1, 'p.4 跨兩節，只給第一次');
  assert.match(html, /<h3>第五章 群聚疫情防治措施 · 第一節 病例群聚定義<\/h3>/);
  assert.doesNotMatch(html, /〔p\.\d+〕/);
});

test('來源卡：頁碼、未校對提醒；PDF 連結只有在知道偏移量時才跳頁', () => {
  const src = { id: `${ID}#ch5-s1-p55`, type: 'document', title: 't', docTitle: '指引', url: '/documents/x/#page-55', pdfPage: 55, version: '2026 年 2 月版', extraction: { reviewStatus: 'machine', pdfUrl: '/files/x/guide.pdf', pageOffset: null } };
  // render.js 需要瀏覽器 DOM：只檢查來源卡有讀這兩個欄位
  const render = fs.readFileSync('src/client/answer/render.js', 'utf8');
  assert.match(render, /if \(src\.pdfPage\) add\(L\('pdfPage'\)/);
  assert.match(render, /extractionMachine: '由 PDF 機器轉出，尚未人工校對/);
  assert.equal(pdfHref(src), '/files/x/guide.pdf');
  assert.equal(pdfHref({ ...src, extraction: { ...src.extraction, pageOffset: 4 } }), '/files/x/guide.pdf#page=59');
  assert.equal(pdfHref({ ...src, extraction: { ...src.extraction, pdfUrl: '/pending/?ref=x', pageOffset: 4 } }), '/pending/?ref=x');
});
