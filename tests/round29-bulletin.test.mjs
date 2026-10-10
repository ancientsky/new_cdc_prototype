// 第二十九輪：疫情報導——文章型別、MMWR 式文章頁與卷期目錄、上架後台（/admin/bulletin/edit/）。
// 規則（src/client/bulletin-rules.js）純函式、後台純函式（bulletin-edit-core.js）、建置輸出（頁面、API、索引、JSON-LD）、驗證閘門。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { govern, addItem, memWriter, config } from './helpers.mjs';
import { makeCtx } from '../scripts/lib/pages.mjs';
import { validateSite } from '../scripts/lib/validate.mjs';
import { buildSearchIndex } from '../scripts/lib/index-builder.mjs';
import { emitApi } from '../scripts/lib/emit-api.mjs';
import { emitSeo } from '../scripts/lib/emit-seo.mjs';
import { pathOf } from '../scripts/lib/governance.mjs';
import * as articles from '../src/templates/public/articles.mjs';
import * as publications from '../src/templates/public/publications.mjs';
import * as adminEdit from '../src/templates/admin/bulletin-edit.mjs';
import { splitManuscript, headingKeyOf, articleProblems, parsePages, pagesOverlap, issueToc, citationOf, citationEnOf, suggestNextIssue, articlePath } from '../src/client/bulletin-rules.js';
import { emptyState, stateFromArticle, buildArticle, resolveIssue, applyManuscript, problemsOf, suggestArticleNo, tocPreviewRows, packageEntries, parseAuthors, authorsText, renderArticlePreview, renderTocPreview, TE_FIELD_MAP, exportFilename } from '../src/client/admin/bulletin-edit-core.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const TODAY = '2026-10-10';
const site = govern(TODAY);
const ctx = (p = '/publications/bulletin-42-13/1/') => makeCtx(site, 'zh-TW', { path: p, alternates: ['zh-TW'] });
const A1 = site.byId.get('article.teb-42-13-1');
const ISSUE = site.byId.get('publication.bulletin-42-13');

/* ───────── 規則 ───────── */
test('headingKeyOf：認得慣用章節標題（含編號前綴與英文），長句與有句號的不算標題', () => {
  assert.equal(headingKeyOf('前言'), 'intro'); assert.equal(headingKeyOf('一、材料與方法'), 'methods'); assert.equal(headingKeyOf('1. 結果'), 'results');
  assert.equal(headingKeyOf('【討論】'), 'discussion'); assert.equal(headingKeyOf('Results'), 'results'); assert.equal(headingKeyOf('結論與建議'), 'conclusion'); assert.equal(headingKeyOf('參考文獻：'), 'references');
  assert.equal(headingKeyOf('本研究的結果顯示登革熱病例集中於南部。'), null); assert.equal(headingKeyOf('結果與其他縣市之比較分析以及限制'), null);
});

test('splitManuscript：整篇稿件切成摘要、各段、圖表說明、參考文獻；標題前的文字當摘要；重複標題不互撞', () => {
  const r = splitManuscript('這是摘要第一段。\n\n前言\n前言內容。\n\n材料與方法\n方法內容。\n圖 1 病例分布圖\n\n結果\n結果內容（表 1）。\n表 1 各組比較\n表 1 重複的說明\n\n討論\n討論內容。\n\n討論\n第二個討論。\n\n參考文獻\n1. 文獻一。\n[2] 文獻二。\n（3）文獻三。');
  assert.equal(r.abstract, '這是摘要第一段。');
  assert.deepEqual(r.sections.map((s) => s.key), ['intro', 'methods', 'results', 'discussion', 'discussion-2']);
  assert.equal(r.sections[1].markdown, '方法內容。');
  assert.deepEqual(r.figures, [{ kind: 'figure', no: 1, caption: '病例分布圖' }, { kind: 'table', no: 1, caption: '各組比較' }]);
  assert.deepEqual(r.references, ['文獻一。', '文獻二。', '文獻三。']);
  assert.deepEqual(r.unassigned, []);
  const r2 = splitManuscript('沒有任何標題的文字。');
  assert.equal(r2.sections.length, 0); assert.deepEqual(r2.unassigned, ['沒有任何標題的文字。']);
});

test('頁碼：解析、重疊；articleProblems 擋卷期不存在、篇次重複、頁碼重疊、缺正文', () => {
  assert.deepEqual(parsePages('1-8'), [1, 8]); assert.deepEqual(parsePages('12'), [12, 12]); assert.equal(parsePages('8-1'), null); assert.equal(parsePages('a'), null);
  assert.equal(pagesOverlap([1, 8], [8, 12]), true); assert.equal(pagesOverlap([1, 8], [9, 12]), false);
  const base = { title: 'x', issueId: ISSUE.id, articleNo: 3, authors: [{ name: 'a', unit: 'u' }], pages: '17-24', abstractMarkdown: 'm', sections: [{ key: 'intro', heading: '前言', markdown: 'b' }] };
  assert.equal(articleProblems(base, { issue: ISSUE, siblings: [A1] }).filter((p) => p.level === 'error').length, 0);
  const msgs = (o, extra = {}) => articleProblems({ ...base, ...o }, { issue: ISSUE, siblings: [A1], ...extra }).filter((p) => p.level === 'error').map((p) => p.msg).join('|');
  assert.match(msgs({}, { issue: null }), /不存在/);
  assert.match(msgs({}, { issue: { ...ISSUE, pubType: 'manual' } }), /不是疫情報導/);
  assert.match(msgs({ articleNo: 1 }), /已有第 1 篇/);
  assert.match(msgs({ pages: '5-9' }), /重疊/);
  assert.match(msgs({ sections: [] }), /至少要有一段正文/);
  assert.match(msgs({ authors: [] }), /至少一位作者/);
  assert.match(articleProblems({ ...base, pages: '' }, { issue: ISSUE }).map((p) => p.msg).join('|'), /沒有頁碼/);
});

test('issueToc：全文文章取代同篇次的書目篇目，其餘書目篇目照舊列出並標 legacy；引用格式中英文；下一期建議', () => {
  const rows = issueToc(ISSUE, site.collections.articles);
  assert.deepEqual(rows.map((r) => [r.no, !!r.article, !!r.legacy]), [[1, true, false], [2, true, false], [3, false, true]]);
  assert.equal(citationOf(A1, ISSUE), '高屏區管制中心防疫團隊、某市政府衛生局。2026 年首例本土登革熱病例疫情調查與社區防治。疫情報導 2026；42（13）：1-8。');
  assert.equal(citationEnOf(A1, ISSUE), 'Investigation and community control of the first indigenous dengue case of 2026'.length > 0 && citationEnOf(A1, ISSUE).startsWith('高屏區管制中心防疫團隊, 某市政府衛生局. Investigation') ? citationEnOf(A1, ISSUE) : 'x');
  assert.match(citationEnOf(A1, ISSUE), /Taiwan Epidemiol Bull 2026;42\(13\):1-8\.$/);
  assert.deepEqual(suggestNextIssue(site.collections.publications, '2026-10-10'), { volume: 42, issue: 19 });
  assert.deepEqual(suggestNextIssue(site.collections.publications, '2027-01-05'), { volume: 43, issue: 1 });
  assert.equal(articlePath(A1), '/publications/bulletin-42-13/1/');
});

/* ───────── 建置閘門與輸出 ───────── */
test('驗證閘門：示範文章通過；同期篇次重複、頁碼重疊、卷期不是 bulletin 的文章擋建置', () => {
  assert.deepEqual(validateSite(site).filter((e) => /疫情報導/.test(e)), []);
  const bad = govern(TODAY, (s) => {
    addItem(s, { ...structuredClone(A1), id: 'article.teb-42-13-9', __file: undefined, articleNo: 1, pages: '2-3' });
    addItem(s, { ...structuredClone(A1), id: 'article.teb-x', issueId: 'publication.annual-report-2025', articleNo: 1, pages: '' });
  });
  const errs = validateSite(bad).filter((e) => /疫情報導/.test(e));
  assert.ok(errs.some((e) => /已有第 1 篇/.test(e)), errs.join('\n'));
  assert.ok(errs.some((e) => /重疊/.test(e)));
  assert.ok(errs.some((e) => /不是疫情報導/.test(e)));
});

test('文章頁：麵包屑到卷期、摘要框、重點三句、各段 #s-{key}、圖表就地插入且有 id、參考文獻、引用兩種格式、列印鈕、上一篇下一篇、後台修改連結指到疫情報導表單', () => {
  const html = String(articles.render(ctx(), { item: A1 }));
  assert.match(html, /href="[^"]*\/publications\/bulletin-42-13\/"[^>]*>疫情報導 第 42 卷第 13 期</);
  assert.match(html, /id="abstract"/); assert.match(html, /id="highlights"/); assert.match(html, /<dt>已知<\/dt>/); assert.match(html, /<dt>對防疫實務的意義<\/dt>/);
  for (const s of A1.sections) assert.match(html, new RegExp(`id="s-${s.key}"`));
  // 表 1 在「結果」段裡（第一次提到的段落），且是 HTML 表格
  const res = html.slice(html.indexOf('id="s-results"'), html.indexOf('id="s-discussion"'));
  assert.match(res, /<figure class="c-teb__fig c-teb__fig--table" id="table-1">/); assert.match(res, /<table>/);
  assert.match(html, /id="references"/); assert.match(html, /id="ref-2"/);
  assert.match(html, /id="cite"/); assert.match(html, /Taiwan Epidemiol Bull 2026;42\(13\):1-8/);
  assert.match(html, /data-print/); assert.match(html, /下載本期 PDF/);
  assert.match(html, /c-teb__next/); assert.doesNotMatch(html, /c-teb__prev"/);
  assert.match(html, /\/admin\/bulletin\/edit\/\?edit=article\.teb-42-13-1/);
  assert.match(html, /c-toc--teb/);
  const md = articles.markdown(ctx(), { item: A1 });
  assert.match(md, /^# 2026 年首例本土登革熱病例疫情調查與社區防治/); assert.match(md, /## 摘要/); assert.match(md, /- 已知：/); assert.match(md, /\*\*表 1\*\*/); assert.match(md, /## 引用本文/);
});

test('卷期頁（bulletin）：本期目錄列全文文章（連結、全文 HTML 鈕）與僅書目篇目；其他卷期；非 bulletin 出版品維持原版面', () => {
  const html = String(publications.render(ctx('/publications/bulletin-42-13/'), { item: ISSUE }));
  assert.match(html, /id="toc"/); assert.match(html, /本期目錄/);
  assert.match(html, /href="[^"]*\/publications\/bulletin-42-13\/1\/"[^>]*>2026 年首例本土登革熱病例疫情調查與社區防治</);
  assert.equal((html.match(/全文 HTML<\/a>/g) ?? []).length, 2);
  assert.match(html, /僅書目/); assert.match(html, /長照機構新冠群聚事件之感染管制介入評估/);
  assert.match(html, /其他卷期/); assert.match(html, /第 42 卷第 2 期/);
  const manual = site.collections.publications.find((p) => p.pubType === 'manual');
  const h2 = String(publications.render(ctx('/publications/x/'), { item: manual }));
  assert.doesNotMatch(h2, /本期目錄/); assert.match(h2, /書目資料/);
  const list = String(publications.render(ctx('/publications/'), {}));
  assert.match(list, /<th scope="col">全文 HTML<\/th>/);
  const pages = articles.pages(site);
  assert.ok(pages.some((p) => p.path === '/publications/bulletin-42-13/1/' && p.lang === 'zh-TW' && p.md));
  assert.ok(!pages.some((p) => p.lang === 'en'), '英文版 none ⇒ 不出英文頁');
});

test('索引：文章的摘要、重點、各段、圖表各一塊，網址連到 #s-{key}／#table-1；型別 article 進民眾與專業索引', () => {
  const idx = buildSearchIndex(site);
  const chunks = idx.pro.filter((c) => c.contentId === A1.id);
  const keys = chunks.map((c) => c.id.split('#')[1]);
  for (const k of ['abstract', 'highlights', 's-intro', 's-results', 'table-1']) assert.ok(keys.includes(k), `缺 ${k}：${keys.join(',')}`);
  assert.equal(chunks.find((c) => c.id.endsWith('#s-results')).url, '/publications/bulletin-42-13/1/#s-results');
  assert.equal(chunks[0].volume, 42); assert.equal(chunks[0].articleNo, 1);
  assert.ok(idx.public.some((c) => c.type === 'article'));
});

test('API／SEO／JSON-LD：v1/articles.json 帶卷期與引用格式；RSS 與 sitemap 含文章；ScholarlyArticle isPartOf PublicationIssue', () => {
  const { files, write } = memWriter();
  emitApi(site, write);
  const api = JSON.parse(files.get('v1/articles.json'));
  const a = api.data.find((x) => x.id === A1.id);
  assert.equal(a.issue.volume, 42); assert.match(a.citation, /疫情報導 2026；42（13）：1-8/); assert.equal(a.sections.length, 5);
  emitSeo(site, write);
  assert.match(files.get('feeds/publications.xml'), /2026 年首例本土登革熱病例疫情調查與社區防治（疫情報導 第 42 卷第 13 期）/);
  const sm = [...files.keys()].filter((k) => /^sitemap.*\.xml$/.test(k)).map((k) => files.get(k)).join('');
  assert.match(sm, /\/publications\/bulletin-42-13\/1\//);
  assert.equal(pathOf(A1), '/publications/bulletin-42-13/1/');
  const html = String(articles.render(ctx(), { item: A1 }));
  const m = articles.meta(ctx(), { item: A1 });
  const ld = JSON.stringify(m.jsonLd);
  assert.match(ld, /"@type":"ScholarlyArticle"/); assert.match(ld, /"PublicationIssue"/); assert.match(ld, /"issueNumber":13/); assert.match(ld, /"affiliation"/);
  void html;
});

/* ───────── 後台 ───────── */
test('後台純函式：稿件套進表單只補空欄；buildArticle 產出通過 schema 與跨檔檢查；修改既有文章來回不掉欄位', () => {
  let st = emptyState({ today: TODAY });
  st = { ...st, issueMode: 'existing', issueId: ISSUE.id, articleNo: '4', title: '測試文章', authors: '王小明 | 疫情中心 | *\n李小華 | 高屏區管制中心', pages: '25-30', keywords: '測試、登革熱', diseases: ['disease.dengue'] };
  const r = applyManuscript(st, '摘要文字。\n\n前言\n前言內容。\n\n方法\n方法內容。\n\n結果\n結果內容。\n圖 1 圖說\n\n參考文獻\n1. 文獻');
  assert.deepEqual(r.report, ['摘要', '3 段正文（前言、材料與方法、結果）', '1 個圖表說明', '1 筆參考文獻']);
  st = r.state;
  const r2 = applyManuscript({ ...st, abstract: '已經手打的摘要' }, '別的摘要。\n\n前言\n另一個前言');
  assert.equal(r2.state.abstract, '已經手打的摘要'); assert.equal(r2.state.sections.length, 3, '同 key 段落不重複加');
  const issue = resolveIssue(st, site.collections.publications);
  const a = buildArticle(st, { today: TODAY, issue });
  assert.equal(a.id, 'article.teb-42-13-4'); assert.equal(a.publishedAt, ISSUE.publishedAt); assert.deepEqual(a.authors, [{ name: '王小明', unit: '疫情中心', corresponding: true }, { name: '李小華', unit: '高屏區管制中心' }]);
  assert.deepEqual(a.keywords, ['測試', '登革熱']); assert.equal(a.summary, '摘要文字。'); assert.equal(a.figures[0].no, 1);
  const probs = problemsOf(a, { issue, articles: site.collections.articles, today: TODAY });
  assert.equal(probs.filter((p) => p.level === 'error').length, 0, JSON.stringify(probs));
  const s2 = govern(TODAY, (s) => addItem(s, structuredClone(a)));
  assert.deepEqual(validateSite(s2).filter((e) => /teb-42-13-4/.test(e)), []);
  assert.equal(exportFilename(a), 'content/articles/teb-42-13-4.json');
  // 修改既有：來回不掉欄位
  const back = buildArticle(stateFromArticle(A1), { today: TODAY, issue: ISSUE, base: A1 });
  const { reviewedAt: _r, sourceHash: _h, gov: _g, __file: _f, ...orig } = A1; const { reviewedAt: _r2, ...got } = back; void _r; void _h; void _g; void _f; void _r2;
  assert.deepEqual(got, orig);
  assert.equal(authorsText(A1.authors), '高屏區管制中心防疫團隊 | 高屏區管制中心 | *\n某市政府衛生局 | 地方衛生局');
  assert.deepEqual(parseAuthors('甲 | 單位 | 通訊\n乙'), [{ name: '甲', unit: '單位', corresponding: true }, { name: '乙' }]);
});

test('後台純函式：新卷期產出卷期 JSON 並進上架包；篇次建議；目錄預覽把這篇插進去；預覽區塊都對得到欄位', () => {
  const st = { ...emptyState({ today: TODAY }), issueMode: 'new', newVolume: '42', newIssue: '19', newDate: '2026-10-07', articleNo: '1', title: '新的一篇', authors: '甲 | 乙單位', sections: [{ key: 'intro', heading: '前言', markdown: '內容' }] };
  const issue = resolveIssue(st, site.collections.publications, { today: TODAY });
  assert.equal(issue.id, 'publication.bulletin-42-19'); assert.equal(issue._new, true); assert.equal(issue.volume, 42);
  const a = buildArticle(st, { today: TODAY, issue });
  assert.equal(a.id, 'article.teb-42-19-1'); assert.equal(a.publishedAt, '2026-10-07');
  const entries = packageEntries(a, issue, { name: 'teb-42-19-1.pdf', bytes: new Uint8Array([1, 2]) });
  assert.deepEqual(entries.map((e) => e.name), ['content/articles/teb-42-19-1.json', 'content/publications/bulletin-42-19.json', 'content/assets/article.teb-42-19-1/teb-42-19-1.pdf']);
  const issueJson = JSON.parse(entries[1].data); assert.ok(!('_new' in issueJson)); assert.equal(issueJson.pubType, 'bulletin');
  const s2 = govern(TODAY, (s) => { addItem(s, issueJson); addItem(s, structuredClone(a)); });
  assert.deepEqual(validateSite(s2).filter((e) => /42-19/.test(e)), []);
  assert.equal(suggestArticleNo(site.collections.articles, ISSUE.id, ISSUE), 4, '書目篇目 3 筆、全文 2 篇 ⇒ 下一篇 4');
  const rows = tocPreviewRows({ ...a, issueId: ISSUE.id, articleNo: 4 }, ISSUE, site.collections.articles);
  assert.deepEqual(rows.map((r) => [r.no, r.isCurrent]), [[1, false], [2, false], [3, false], [4, true]]);
  const pv = renderArticlePreview(a, issue, { md: (m) => `<p>${m}</p>` });
  const fields = [...pv.matchAll(/data-field="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(fields.length >= 8);
  for (const f of fields) assert.ok(TE_FIELD_MAP[f], `預覽區塊 ${f} 沒有對應欄位`);
  assert.match(pv, /新的一篇/); assert.doesNotMatch(pv, /undefined/);
  assert.match(renderTocPreview(rows, ISSUE), /這篇/);
});

test('後台模板：表單骨架、右側四個頁籤、資料島含卷期與既有文章；後台導覽有「疫情報導」', () => {
  const html = String(adminEdit.render(makeCtx(site, 'zh-TW', { path: '/admin/bulletin/edit/', alternates: ['zh-TW'] })));
  for (const id of ['te-pick', 'te-issue', 'te-no', 'te-manuscript', 'te-split', 'te-abstract', 'te-known', 'te-sections', 'te-figures', 'te-refs', 'te-pdf', 'te-zip', 'te-preview', 'te-toc', 'te-check', 'te-out', 'te-actions']) assert.ok(html.includes(`id="${id}"`), `缺 #${id}`);
  assert.match(html, /id="tt-prev"[^>]*aria-selected="true"/);
  assert.match(html, /class="adm-actions adm-actions--sticky" id="te-actions"/);
  const data = JSON.parse(html.match(/<script type="application\/json" id="adm-bulletin-data">([\s\S]*?)<\/script>/)[1]);
  assert.ok(data.issues.some((p) => p.id === ISSUE.id)); assert.ok(data.articles.some((a) => a.id === A1.id)); assert.ok(!data.articles[0].gov);
  assert.equal(adminEdit.pages()[0].path, '/admin/bulletin/edit/');
  const partials = fs.readFileSync(path.join(ROOT, 'src/templates/admin/_partials.mjs'), 'utf8');
  assert.match(partials, /\/admin\/bulletin\/edit\/'/);
  void config;
});
