// 第三十五輪：疫情報導——作者服務單位上標與通訊作者、DOI 與轉址、分類主檔與分類頁、圖片最省功上架。
// 規則純函式（bulletin-rules.js）、後台純函式（bulletin-edit-core.js）、建置輸出（頁面、API、轉址、JSON-LD）、真實文章 42(19) 通過檢查。
import test from 'node:test';
import assert from 'node:assert/strict';
import { govern, addItem, memWriter, mk } from './helpers.mjs';
import { makeCtx } from '../scripts/lib/pages.mjs';
import { validateSite } from '../scripts/lib/validate.mjs';
import { emitApi, doiRedirects, serverRedirects } from '../scripts/lib/emit-api.mjs';
import { md as renderMarkdown } from '../scripts/lib/markdown.mjs';
import * as articles from '../src/templates/public/articles.mjs';
import * as bulletin from '../src/templates/public/bulletin.mjs';
import * as adminEdit from '../src/templates/admin/bulletin-edit.mjs';
import {
  DEFAULT_CATEGORIES, categoryProblems, categoryLabel, categoryPath, normalizeCategory, sortCategories,
  authorNotes, citationEnOf, suggestDoi, doiProblems, doiPath, cnToNum, figRefRe, splitManuscript, articleProblems, headingKeyOf,
} from '../src/client/bulletin-rules.js';
import {
  parseAuthors, authorsText, parseAffiliations, affiliationsText, matchFigureFile, figureFileName, assignFigureFiles,
  emptyState, applyManuscript, resolveIssue, buildArticle, problemsOf, packageEntries, suggestCategoryKey, categoriesChanged, renderArticlePreview, TE_FIELD_MAP, stateFromArticle,
} from '../src/client/admin/bulletin-edit-core.js';
import { mdToHtml, supSub } from '../src/client/admin/md-convert.js';

const TODAY = '2026-10-11';
const site = govern(TODAY);
const ctx = (p, lang = 'zh-TW') => makeCtx(site, lang, { path: p, alternates: ['zh-TW', 'en'] });
const REAL = site.byId.get('article.teb-42-19-1');
const ISSUE19 = site.byId.get('publication.bulletin-42-19');
const CATS = site.master.bulletinCategories;

/** 模擬 pdftotext -layout 貼出來的稿件（虛構內容，版面照刊物：頁首卷期、分類、篇名、作者列、腳註式服務單位、頁尾「疫情報導 頁碼」、DOI、投稿／接受日期） */
const PDF_LIKE = `                                                             │疫情調查│

2026 年 10 月 20 日 第 42 卷 第 20 期
                                                       疫情調查
             2026 年某市登革熱群聚事件調查報告

        王大明 1*、李小華 1、陳美玲 2

摘要
  2026 年 7 月某市通報三例登革熱確定病例，經疫調確認為同一社區群聚。
本文整理調查過程與防治作為，供各縣市參考。

關鍵字：登革熱、群聚、疫情調查

事件源起
   2026 年 7 月 10 日疾管署接獲某市衛生局通報登革熱確定病例一例，隨後兩週
內同一里再通報兩例，三例活動範圍重疊，啟動群聚調查。
1
    衛生福利部疾病管制署南區管制中心            投稿日期：2026 年 08 月 01 日
2
    某市政府衛生局                              接受日期：2026 年 09 月 15 日
                 1*
    通訊作者：王大明                     DOI：10.6524/EB.202610_42(20).0003
    E-mail：test@cdc.gov.tw
疫情報導 201
2026 年 10 月 20 日 第 42 卷 第 20 期

感染源及接觸者調查
  三例個案均無出國史，住家相距 200 公尺內，病媒蚊指數偏高，防治作為時序
如圖一。
  圖一、2026 年某市登革熱群聚事件防治作為時序圖

疫情研判
  研判為本土群聚事件，感染源為社區內帶病毒病媒蚊。

討論及建議
  一、加強孳生源清除
  里內空屋積水容器多，建議由里長協同清除。
  二、提早通報
  臨床醫師對疑似病例應於 24 小時內通報。

參考文獻
1. 衛生福利部疾病管制署。登革熱防治工作指引。2026。
2.
   World Health Organization. Dengue guidelines for diagnosis, treatment, prevention and control.
   Geneva: WHO; 2009.
疫情報導 202
`;

/* ───────── 問題 1：作者服務單位與通訊作者 ───────── */
test('authorNotes：有 affiliations 就依編號上標；只有 unit 時自動編號；通訊作者加星號；單一單位不顯示上標', () => {
  const n = authorNotes({ affiliations: [{ no: 1, name: '北區管制中心', nameEn: 'Northern Regional Center' }, { no: 2, name: '急性組' }], authors: [{ name: '甲', affiliations: [1], corresponding: true }, { name: '乙', affiliations: [2, 1] }, { name: '丙', affiliations: [2] }] });
  assert.deepEqual(n.authors.map((a) => a.sup), ['1*', '1,2', '2']);
  assert.deepEqual(n.corresponding.map((a) => a.name), ['甲']);
  assert.equal(n.showSup, true); assert.equal(n.affiliations[0].nameEn, 'Northern Regional Center');
  const auto = authorNotes({ authors: [{ name: '甲', unit: 'A 單位' }, { name: '乙', unit: 'B 單位' }, { name: '丙', unit: 'A 單位' }] });
  assert.deepEqual(auto.affiliations.map((f) => [f.no, f.name]), [[1, 'A 單位'], [2, 'B 單位']]);
  assert.deepEqual(auto.authors.map((a) => a.sup), ['1', '2', '1']);
  const one = authorNotes({ authors: [{ name: '甲', unit: 'A 單位' }, { name: '乙', unit: 'A 單位' }] });
  assert.equal(one.showSup, false, '全部同一單位不用上標');
});

test('文章頁：作者上標連到服務單位清單、通訊作者星號與 E-mail；英文引用用 nameEn；Markdown 支援 ^上標^ 與 ~下標~', () => {
  const html = String(articles.render(ctx('/publications/bulletin-42-19/1/'), { item: REAL }));
  assert.match(html, /李泱<sup class="c-teb__sup">(?:<span class="sr-only">[^<]*<\/span>)?<a href="#aff-1">1<\/a>(?:<span class="sr-only">[^<]*<\/span>)?<\/sup><abbr class="c-teb__corr" title="通訊作者">\*<\/abbr>/);
  assert.match(html, /林稜<sup class="c-teb__sup">(?:<span class="sr-only">[^<]*<\/span>)?<a href="#aff-2">2<\/a>/);
  assert.match(html, /<ol class="c-teb__affils"/); assert.match(html, /id="aff-2"/);
  assert.match(html, /mailto:leon75@cdc.gov.tw/);
  assert.match(html, /急性(傳染病)?組/);
  assert.match(citationEnOf(REAL, ISSUE19), /^Yang Li, .*Taiwan Epidemiol Bull 2026;42\(19\):182-188\. doi:10\.6524/);
  assert.match(String(renderMarkdown('CO~2~ 與 10^6^ CFU')), /<sub>2<\/sub>.*<sup>6<\/sup>/);
  assert.equal(supSub('H~2~O 10^3^'), 'H<sub>2</sub>O 10<sup>3</sup>');
  assert.match(mdToHtml('速率 10^3^ 倍'), /<sup>3<\/sup>/);
});

test('後台作者格式：「姓名 | 單位編號 | * | E-mail | 英文名」與「編號 | 單位 | 英文」雙向轉換', () => {
  const list = parseAuthors('王大明 | 1 | * | test@cdc.gov.tw | Da-Ming Wang\n李小華 | 1,2\n陳美玲 | 某市衛生局');
  assert.deepEqual(list, [{ name: '王大明', affiliations: [1], corresponding: true, email: 'test@cdc.gov.tw', nameEn: 'Da-Ming Wang' }, { name: '李小華', affiliations: [1, 2] }, { name: '陳美玲', unit: '某市衛生局' }]);
  assert.equal(authorsText(list), '王大明 | 1 | * | test@cdc.gov.tw | Da-Ming Wang\n李小華 | 1,2\n陳美玲 | 某市衛生局');
  const affs = parseAffiliations('1 | 南區管制中心 | Southern Regional Center\n某市政府衛生局');
  assert.deepEqual(affs, [{ no: 1, name: '南區管制中心', nameEn: 'Southern Regional Center' }, { no: 2, name: '某市政府衛生局' }]);
  assert.equal(affiliationsText(affs), '1 | 南區管制中心 | Southern Regional Center\n2 | 某市政府衛生局');
  assert.equal(authorsText(stateFromArticle(REAL).authors ? REAL.authors : []).split('\n').length, 7);
});

test('articleProblems：作者引用不存在的單位編號是 error；通訊作者沒 E-mail 是 warn', () => {
  const base = { title: 'x', issueId: ISSUE19.id, articleNo: 5, pages: '300-301', articleType: 'investigation', abstractMarkdown: 'm', sections: [{ key: 'intro', heading: '前言', markdown: 'b' }], affiliations: [{ no: 1, name: 'A' }], authors: [{ name: '甲', affiliations: [1], corresponding: true }] };
  const msgs = (o) => articleProblems({ ...base, ...o }, { issue: ISSUE19, siblings: [REAL], categories: CATS });
  assert.equal(msgs({}).filter((p) => p.level === 'error').length, 0, JSON.stringify(msgs({})));
  assert.match(msgs({ authors: [{ name: '甲', affiliations: [3] }] }).filter((p) => p.level === 'error').map((p) => p.msg).join('|'), /單位/);
  assert.match(msgs({}).filter((p) => p.level === 'warn').map((p) => p.msg).join('|'), /E-mail|通訊/);
});

/* ───────── 問題 2：DOI ───────── */
test('DOI：依刊物慣例建議；格式錯是 error、重複是 error、卷期或篇次不符是 warn；站內解析路徑', () => {
  assert.equal(suggestDoi(ISSUE19, 1), '10.6524/EB.202610_42(19).0001');
  assert.equal(suggestDoi({ volume: 42, issue: 20, publishedAt: '2026-10-20' }, 12), '10.6524/EB.202610_42(20).0012');
  assert.equal(suggestDoi({ volume: 42 }, 1), '');
  const p = (doi, over = {}) => doiProblems({ doi, articleNo: 2, ...over }, { issue: ISSUE19, others: [REAL] });
  assert.equal(p('10.6524/EB.202610_42(19).0002').length, 0);
  assert.match(p('https://doi.org/10.6524/EB.202610_42(19).0002')[0].msg, /格式/); assert.equal(p('https://doi.org/x')[0].level, 'error');
  assert.equal(p(REAL.doi)[0].level, 'error'); assert.match(p(REAL.doi)[0].msg, /已被/);
  assert.match(p('10.6524/EB.202610_42(18).0002')[0].msg, /卷期/); assert.equal(p('10.6524/EB.202610_42(18).0002')[0].level, 'warn');
  assert.match(p('10.6524/EB.202610_42(19).0009')[0].msg, /篩次|篇次/);
  assert.match(p('10.1234/other.123')[0].msg, /慣用/);
  assert.equal(doiPath(REAL.doi), '/doi/10.6524/EB.202610_42(19).0001');
  assert.equal(p('')?.length, 0);
});

test('轉址：/doi/{DOI} → 文章頁（kind doi）；legacyDoiUrl（DOI 目前登記的舊站落地網址）→ 301 進伺服器對照檔；v1/doi.json 給登錄機構批次更新', () => {
  const r = doiRedirects(site);
  const mine = r.filter((x) => x.itemId === REAL.id);
  assert.deepEqual(mine.map((x) => [x.kind, x.from, x.to, x.status]), [
    ['doi', '/doi/10.6524/EB.202610_42(19).0001', '/publications/bulletin-42-19/1/', 301],
    ['legacy', 'https://www.cdc.gov.tw/EpidemicTheme/Index/2EvDNIFfEWyH8RlHAp1t8g', '/publications/bulletin-42-19/1/', 301],
  ]);
  const server = serverRedirects(r);
  assert.ok(server.entries.some((e) => e.to === '/publications/bulletin-42-19/1/' && /EpidemicTheme/.test(e.from)), '舊站落地網址進伺服器對照');
  assert.ok(server.entries.some((e) => e.from === '/doi/10.6524/EB.202610_42(19).0001'), 'DOI 解析路徑進伺服器對照');
  const mem = memWriter(); emitApi(site, mem.write);
  const doi = JSON.parse(mem.files.get('v1/doi.json'));
  const row = doi.data.find((x) => x.id === REAL.id);
  assert.equal(row.doiUrl, 'https://doi.org/10.6524/EB.202610_42(19).0001'); assert.equal(row.resolver, '/doi/10.6524/EB.202610_42(19).0001'); assert.match(row.url, /\/publications\/bulletin-42-19\/1\/$/); assert.match(row.legacyDoiUrl, /EpidemicTheme/);
  const redirects = JSON.parse(mem.files.get('v1/redirects.json'));
  assert.ok(redirects.data.some((x) => x.kind === 'doi' && x.itemId === REAL.id));
  const arts = JSON.parse(mem.files.get('v1/articles.json'));
  const me = arts.data.find((x) => x.id === REAL.id);
  assert.equal(me.doiUrl, row.doiUrl); assert.deepEqual(me.category, { key: 'investigation', label: '疫情調查', labelEn: 'Outbreak Investigation' }); assert.equal(me.affiliations.length, 2);
});

test('文章頁與 JSON-LD：DOI 顯示為 doi.org 連結並可複製；ScholarlyArticle 帶 identifier、articleSection、作者 affiliation 與 nameEn', () => {
  const c = ctx('/publications/bulletin-42-19/1/');
  const html = String(articles.render(c, { item: REAL }));
  assert.match(html, /href="https:\/\/doi\.org\/10\.6524\/EB\.202610_42\(19\)\.0001"/);
  assert.match(html, /c-teb__doi/);
  assert.match(html, /c-pill[^>]*>疫情調查</);
  assert.match(html, /<img[^>]*fig-1\.png/); assert.match(html, /alt="[^"]{10,}"/);
  const ld = JSON.stringify(articles.meta(c, { item: REAL }).jsonLd);
  assert.match(ld, /"ScholarlyArticle"/); assert.match(ld, /"articleSection":"疫情調查"/); assert.match(ld, /"propertyID":"DOI"/); assert.match(ld, /"alternateName":"Yang Li"/); assert.match(ld, /"affiliation"/);
  const md = articles.markdown(c, { item: REAL });
  assert.match(md, /DOI/); assert.match(md, /通訊作者/); assert.match(md, /服務單位|單位/);
});

/* ───────── 問題 3：分類 ───────── */
test('分類主檔：八個官網分類；categoryProblems 擋壞代號、重複、缺名稱；舊型別對到新分類；建置用 master 驗文章 articleType', () => {
  assert.deepEqual(sortCategories(CATS).map((c) => c.key), ['original', 'investigation', 'feature', 'global-focus', 'rapid-report', 'biosafety', 'vaccine', 'notice']);
  assert.deepEqual(DEFAULT_CATEGORIES.map((c) => c.label), ['原著文章', '疫情調查', '焦點特寫', '國內外疫情焦點', '疫調快報', '生安專欄', '疫苗專欄', '重要疫訊']);
  assert.equal(categoryProblems(CATS).length, 0);
  const bad = categoryProblems([{ key: 'Bad Key', label: 'x' }, { key: 'dup', label: 'a' }, { key: 'dup', label: 'b' }, { key: 'nolabel' }]);
  assert.ok(bad.some((p) => /代號「Bad Key」/.test(p))); assert.ok(bad.some((p) => /dup 重複/.test(p))); assert.ok(bad.some((p) => /沒有中文名稱/.test(p)));
  assert.equal(normalizeCategory('outbreak-report'), 'investigation'); assert.equal(normalizeCategory('investigation'), 'investigation');
  assert.equal(categoryLabel(CATS, 'vaccine', 'en'), 'Vaccine Column'); assert.equal(categoryLabel(CATS, 'nope'), 'nope');
  assert.equal(categoryPath('vaccine'), '/publications/bulletin/vaccine/');
  // 建置驗證：不存在的分類是錯誤
  const s2 = govern(TODAY, (s) => addItem(s, mk({ type: 'article', id: 'article.teb-42-13-9', articleType: 'nonsense' })));
  assert.ok(validateSite(s2).some((e) => /teb-42-13-9/.test(e) && /分類/.test(e)), validateSite(s2).filter((e) => /teb-42-13-9/.test(e)).join('\n'));
  const s3 = govern(TODAY, (s) => addItem(s, mk({ type: 'article', id: 'article.teb-42-13-9', articleType: 'vaccine' })));
  assert.deepEqual(validateSite(s3).filter((e) => /teb-42-13-9/.test(e)), []);
});

test('分類頁：總覽 /publications/bulletin/ 與每個分類一頁（七語）；分類導覽標示目前分類與篇數；真實文章列在疫情調查', () => {
  const pages = bulletin.pages(site);
  const zh = pages.filter((p) => p.lang === 'zh-TW');
  assert.equal(zh[0].path, '/publications/bulletin/');
  assert.deepEqual(zh.slice(1).map((p) => p.path), DEFAULT_CATEGORIES.map((c) => categoryPath(c.key)));
  assert.equal(pages.length, zh.length * site.config.langs.length);
  const home = String(bulletin.render(ctx('/publications/bulletin/'), { kind: 'home' }));
  assert.match(home, /2024 年嬰兒型肉毒桿菌中毒個案調查報告/); assert.match(home, /c-teb__cats/); assert.match(home, /href="[^"]*\/publications\/bulletin\/investigation\/"/);
  const inv = String(bulletin.render(ctx('/publications/bulletin/investigation/'), { kind: 'category', category: CATS.find((c) => c.key === 'investigation') }));
  assert.match(inv, /aria-current="page"/); assert.match(inv, /2024 年嬰兒型肉毒桿菌中毒個案調查報告/); assert.match(inv, /DOI/);
  const empty = String(bulletin.render(ctx('/publications/bulletin/biosafety/'), { kind: 'category', category: CATS.find((c) => c.key === 'biosafety') }));
  assert.match(empty, /c-empty/);
  const en = String(bulletin.render(ctx('/publications/bulletin/', 'en'), { kind: 'home' }));
  assert.match(en, /Taiwan Epidemiology Bulletin|Epidemiology Bulletin/); assert.match(en, /Outbreak Investigation/);
  const m = bulletin.meta(ctx('/publications/bulletin/investigation/'), { kind: 'category', category: CATS[1] });
  assert.match(m.title, /疫情調查/);
  const mem = memWriter(); emitApi(site, mem.write);
  const cats = JSON.parse(mem.files.get('v1/bulletin-categories.json'));
  assert.equal(cats.data.find((c) => c.key === 'investigation').count >= 1, true);
});

test('後台分類管理：新分類代號建議、改過才進上架包（content/master/bulletin-categories.json）、沒改不進', () => {
  assert.equal(suggestCategoryKey('Case Report', CATS.map((c) => c.key)), 'case-report');
  assert.equal(suggestCategoryKey('疫苗', ['a']), 'cat-2');
  assert.equal(suggestCategoryKey('Vaccine Column', ['vaccine-column']), 'vaccine-column-2');
  const cats2 = [...CATS, { key: 'case-report', label: '病例報告', labelEn: 'Case Report', order: 9 }];
  assert.equal(categoriesChanged(CATS, CATS), false); assert.equal(categoriesChanged(cats2, CATS), true);
  const st = { ...emptyState({ today: TODAY, categories: cats2 }), issueMode: 'existing', issueId: ISSUE19.id, articleNo: '2', title: '新分類文章', articleType: 'case-report', authors: '甲 | 乙單位', pages: '189-190', sections: [{ key: 'intro', heading: '前言', markdown: '內容' }] };
  const issue = resolveIssue(st, site.collections.publications);
  const a = buildArticle(st, { today: TODAY, issue });
  assert.equal(a.articleType, 'case-report');
  assert.ok(problemsOf(a, { issue, articles: site.collections.articles, today: TODAY, categories: CATS }).some((p) => p.level === 'error' && /分類/.test(p.msg)), '主檔沒有的分類是錯誤');
  assert.equal(problemsOf(a, { issue, articles: site.collections.articles, today: TODAY, categories: cats2 }).filter((p) => p.level === 'error').length, 0);
  const names = packageEntries(a, issue, { categories: cats2, categoriesOriginal: CATS }).map((e) => e.name);
  assert.deepEqual(names, ['content/articles/teb-42-19-2.json', 'content/master/bulletin-categories.json']);
  const master = JSON.parse(packageEntries(a, issue, { categories: cats2, categoriesOriginal: CATS })[1].data);
  assert.equal(master.at(-1).key, 'case-report'); assert.equal(categoryProblems(master).length, 0);
  assert.deepEqual(packageEntries(a, issue, { categories: CATS, categoriesOriginal: CATS }).map((e) => e.name), ['content/articles/teb-42-19-2.json']);
});

/* ───────── 問題 4：圖片 ───────── */
test('圖檔配對：檔名「圖1.png」「fig-2.jpg」「表一.png」認得編號；認不出的依序補；標準檔名 fig-N／table-N；正文「圖一」「圖 1」「Fig. 1」都算提到', () => {
  assert.deepEqual(matchFigureFile('圖1.png'), { kind: 'figure', no: 1 }); assert.deepEqual(matchFigureFile('Figure 2.JPG'), { kind: 'figure', no: 2 });
  assert.deepEqual(matchFigureFile('表一.png'), { kind: 'table', no: 1 }); assert.deepEqual(matchFigureFile('table-3.webp'), { kind: 'table', no: 3 }); assert.equal(matchFigureFile('IMG_0001.png'), null);
  assert.equal(figureFileName('figure', 1, '圖1.JPEG'), 'fig-1.jpg'); assert.equal(figureFileName('table', 2, 'x.PNG'), 'table-2.png');
  const { figures, assigned } = assignFigureFiles([{ kind: 'figure', no: '1', caption: 'a', file: '' }, { kind: 'figure', no: '2', caption: 'b', file: '' }], [{ name: '圖2.png' }, { name: 'IMG_0001.jpg' }, { name: '表1.png' }]);
  assert.deepEqual(figures.map((f) => [f.kind, f.no, f.file]), [['figure', '1', 'fig-1.jpg'], ['figure', '2', 'fig-2.png'], ['table', '1', 'table-1.png']]);
  assert.deepEqual(assigned.map((x) => [x.from, x.to, x.created]), [['圖2.png', 'fig-2.png', false], ['表1.png', 'table-1.png', true], ['IMG_0001.jpg', 'fig-1.jpg', false]]);
  assert.equal(cnToNum('一'), 1); assert.equal(cnToNum('十二'), 12); assert.equal(cnToNum('二十'), 20); assert.equal(cnToNum('3'), 3); assert.equal(cnToNum('甲'), null);
  const re = figRefRe('figure', 1);
  assert.ok(re.test('防治作為如圖一。')); assert.ok(re.test('見圖 1')); assert.ok(re.test('Fig. 1 shows')); assert.ok(!re.test('圖 10 顯示')); assert.ok(!re.test('圖十一'));
  assert.ok(figRefRe('table', 2).test('表二'));
});

test('buildArticle：圖檔自動宣告到 assets[]（image、alt、授權、尺寸）、PDF 當附件；上架包含圖檔；缺 alt 或沒宣告是 error', () => {
  const st = { ...emptyState({ today: TODAY }), issueMode: 'existing', issueId: ISSUE19.id, articleNo: '3', title: '有圖的文章', articleType: 'investigation', authors: '甲 | 乙單位 | *', pages: '191-195',
    pdfFile: 'teb-42-19-3.pdf', sections: [{ key: 'intro', heading: '事件源起', markdown: '防治作為如圖一。' }], figures: [{ kind: 'figure', no: '1', caption: '時序圖', markdown: '', alt: '時序圖：通報、採檢、確診到防治的日期', file: 'fig-1.png' }] };
  const issue = resolveIssue(st, site.collections.publications);
  const a = buildArticle(st, { today: TODAY, issue, files: { 'teb-42-19-3.pdf': { bytes: 1234, sha256: 'a'.repeat(64) }, 'fig-1.png': { bytes: 999, sha256: 'b'.repeat(64), width: 800, height: 400, mime: 'image/png' } } });
  const img = a.assets.find((x) => x.file === 'fig-1.png'); const pdf = a.assets.find((x) => x.file === 'teb-42-19-3.pdf');
  assert.equal(img.kind, 'image'); assert.equal(img.alt, '時序圖：通報、採檢、確診到防治的日期'); assert.equal(img.license, 'OGDL-1.0'); assert.equal(img.width, 800); assert.equal(img.sha256, 'b'.repeat(64));
  assert.equal(pdf.kind, 'attachment'); assert.equal(pdf.label, '本篇 PDF'); assert.match(a.pdfUrl, /\/files\/article\.teb-42-19-3\/teb-42-19-3\.pdf$/);
  assert.equal(problemsOf(a, { issue, articles: site.collections.articles, today: TODAY, categories: CATS }).filter((p) => p.level === 'error').length, 0);
  const names = packageEntries(a, issue, { pdf: { name: 'teb-42-19-3.pdf', bytes: new Uint8Array([1]) }, images: { 'fig-1.png': new Uint8Array([2]), 'unused.png': new Uint8Array([3]) } }).map((e) => e.name);
  assert.deepEqual(names, ['content/articles/teb-42-19-3.json', 'content/assets/article.teb-42-19-3/teb-42-19-3.pdf', 'content/assets/article.teb-42-19-3/fig-1.png'], '沒配到圖表的圖檔不進上架包');
  // 圖檔有宣告但沒 alt、或有 file 卻沒宣告 → error
  const noAlt = { ...a, figures: [{ ...a.figures[0], alt: '' }], assets: a.assets.map((x) => (x.kind === 'image' ? { ...x, alt: '' } : x)) };
  assert.ok(articleProblems(noAlt, { issue, categories: CATS }).some((p) => p.level === 'error' && /alt|替代文字/.test(p.msg)));
  const undeclared = { ...a, assets: a.assets.filter((x) => x.kind !== 'image') };
  assert.ok(articleProblems(undeclared, { issue, categories: CATS }).some((p) => p.level === 'error' && /assets|宣告/.test(p.msg)));
  const pv = renderArticlePreview(a, issue, { md: (m) => `<p>${m}</p>`, imageUrl: (f) => `blob:${f}` });
  assert.match(pv, /blob:fig-1\.png/); assert.match(pv, /data-field="te-doi"|te-doi/); assert.ok(TE_FIELD_MAP['te-doi']);
});

/* ───────── 拆稿：PDF 貼文 ───────── */
test('splitManuscript 吃 PDF 版面：去頁首頁尾、抓篇名／作者上標／服務單位／通訊作者／E-mail／DOI／投稿接受日期／關鍵字／分類／卷期；保留原段名；圖一；參考文獻編號獨立成行也接得起來', () => {
  const r = splitManuscript(PDF_LIKE, { categories: CATS });
  assert.equal(r.title, '2026 年某市登革熱群聚事件調查報告');
  assert.deepEqual(r.authors.map((a) => [a.name, a.affiliations, !!a.corresponding]), [['王大明', [1], true], ['李小華', [1], false], ['陳美玲', [2], false]]);
  assert.equal(r.authors[0].email, 'test@cdc.gov.tw');
  assert.deepEqual(r.affiliations.map((f) => [f.no, f.name]), [[1, '衛生福利部疾病管制署南區管制中心'], [2, '某市政府衛生局']]);
  assert.equal(r.meta.doi, '10.6524/EB.202610_42(20).0003'); assert.equal(r.meta.receivedAt, '2026-08-01'); assert.equal(r.meta.acceptedAt, '2026-09-15');
  assert.deepEqual(r.meta.keywords, ['登革熱', '群聚', '疫情調查']); assert.equal(r.meta.category, 'investigation');
  assert.equal(r.meta.volume, 42); assert.equal(r.meta.issue, 20); assert.equal(r.meta.date, '2026-10-20'); assert.equal(r.meta.pages, '201-202');
  assert.match(r.abstract, /^2026 年 7 月某市通報三例登革熱確定病例/); assert.doesNotMatch(r.abstract, /關鍵字/);
  assert.deepEqual(r.sections.map((s) => [s.key, s.heading]), [['origin', '事件源起'], ['investigation', '感染源及接觸者調查'], ['assessment', '疫情研判'], ['discussion', '討論及建議']]);
  const body = r.sections.map((s) => s.markdown).join('\n');
  assert.doesNotMatch(body, /疫情報導 20\d|第 42 卷 第 20 期|投稿日期|E-mail/); assert.match(body, /如圖一。/); assert.match(body, /### 一、加強孳生源清除/);
  assert.match(r.sections[0].markdown, /隨後兩週內同一里再通報兩例/, '折行接回同一句');
  assert.deepEqual(r.figures, [{ kind: 'figure', no: 1, caption: '2026 年某市登革熱群聚事件防治作為時序圖' }]);
  assert.deepEqual(r.references, ['衛生福利部疾病管制署。登革熱防治工作指引。2026。', 'World Health Organization. Dengue guidelines for diagnosis, treatment, prevention and control. Geneva: WHO; 2009.']);
  assert.deepEqual(r.unassigned, []);
  assert.equal(headingKeyOf('感染源及接觸者調查'), 'investigation'); assert.equal(headingKeyOf('疫情研判'), 'assessment'); assert.equal(headingKeyOf('討論及建議'), 'discussion');
});

test('applyManuscript 套 PDF 貼文：填齊作者、服務單位、DOI、日期、關鍵字、分類、頁碼，並選到／新建卷期；DOI 建議與抓到的一致', () => {
  const r = applyManuscript(emptyState({ today: TODAY, categories: CATS }), PDF_LIKE, { issues: site.collections.publications });
  const st = r.state;
  assert.equal(st.title, '2026 年某市登革熱群聚事件調查報告');
  assert.equal(st.authors, '王大明 | 1 | * | test@cdc.gov.tw\n李小華 | 1\n陳美玲 | 2');
  assert.equal(st.affiliations, '1 | 衛生福利部疾病管制署南區管制中心\n2 | 某市政府衛生局');
  assert.equal(st.doi, '10.6524/EB.202610_42(20).0003'); assert.equal(st.receivedAt, '2026-08-01'); assert.equal(st.acceptedAt, '2026-09-15');
  assert.equal(st.keywords, '登革熱、群聚、疫情調查'); assert.equal(st.articleType, 'investigation'); assert.equal(st.pages, '201-202');
  assert.equal(st.issueMode, 'new'); assert.equal(st.newVolume, '42'); assert.equal(st.newIssue, '20'); assert.equal(st.newDate, '2026-10-20');
  assert.deepEqual(r.issueHint, { volume: 42, issue: 20, date: '2026-10-20', existing: null });
  assert.ok(r.report.includes('3 位作者（含通訊作者）')); assert.ok(r.report.includes('2 個服務單位')); assert.ok(r.report.includes('DOI')); assert.ok(r.report.some((x) => /分類「疫情調查」/.test(x)));
  const issue = resolveIssue({ ...st, articleNo: '3' }, site.collections.publications, { today: TODAY });
  assert.equal(issue.id, 'publication.bulletin-42-20'); assert.equal(suggestDoi(issue, 3), st.doi);
  const a = buildArticle({ ...st, articleNo: '3' }, { today: TODAY, issue });
  assert.deepEqual(a.affiliations, [{ no: 1, name: '衛生福利部疾病管制署南區管制中心' }, { no: 2, name: '某市政府衛生局' }]);
  assert.deepEqual(a.authors[0], { name: '王大明', affiliations: [1], corresponding: true, email: 'test@cdc.gov.tw' });
  const probs = problemsOf(a, { issue, articles: site.collections.articles, today: TODAY, categories: CATS });
  assert.deepEqual(probs.filter((p) => p.level === 'error'), [], JSON.stringify(probs));
  assert.ok(probs.some((p) => p.level === 'warn' && /圖/.test(p.msg)), '圖一還沒有圖檔 → 提醒');
  // 既有卷期：頁首抓到 42(19) 就直接選到
  const r2 = applyManuscript(emptyState({ today: TODAY, categories: CATS }), PDF_LIKE.replace(/第 20 期/g, '第 19 期').replace('10 月 20 日', '10 月 6 日'), { issues: site.collections.publications });
  assert.equal(r2.state.issueMode, 'existing'); assert.equal(r2.state.issueId, 'publication.bulletin-42-19'); assert.equal(r2.issueHint.existing, 'publication.bulletin-42-19');
});

/* ───────── 真實文章 42(19) ───────── */
test('真實文章 42(19)：通過 schema 與跨檔檢查；七位作者兩個單位；DOI；圖一有 alt、檔案已宣告；PDF 附件；verification pending', () => {
  assert.ok(REAL && ISSUE19);
  assert.deepEqual(validateSite(site).filter((e) => /42-19/.test(e)), []);
  assert.equal(REAL.authors.length, 7); assert.equal(REAL.affiliations.length, 2); assert.equal(REAL.authors.filter((a) => a.corresponding).length, 1);
  assert.equal(REAL.doi, '10.6524/EB.202610_42(19).0001'); assert.equal(REAL.articleType, 'investigation'); assert.equal(REAL.pages, '182-188');
  assert.equal(REAL.figures.length, 1); assert.equal(REAL.figures[0].file, 'fig-1.png'); assert.ok(REAL.figures[0].alt.length > 10);
  assert.ok(REAL.assets.some((x) => x.file === 'fig-1.png' && x.kind === 'image' && x.width === 1127)); assert.ok(REAL.assets.some((x) => /\.pdf$/.test(x.file) && x.kind === 'attachment'));
  assert.equal(REAL.verification?.status, 'pending');
  const probs = articleProblems(REAL, { issue: ISSUE19, siblings: [], others: [], categories: CATS });
  assert.deepEqual(probs.filter((p) => p.level === 'error'), []);
  const html = String(articles.render(ctx('/publications/bulletin-42-19/1/'), { item: REAL }));
  for (const s of ['事件源起', '背景介紹', '個案報告', '感染源及接觸者調查', '檢體採集及檢驗結果', '疫情研判', '討論及建議']) assert.ok(html.includes(s), `缺段 ${s}`);
  assert.match(html, /c-teb__sup/); assert.match(html, /\/files\/article\.teb-42-19-1\/teb-42-19-1\.pdf/);
});

test('後台模板：資料島含分類主檔與圖檔上限；表單有服務單位、DOI 建議、投稿／接受日期、舊落地網址、圖檔上傳、分類管理區', () => {
  const html = String(adminEdit.render(makeCtx(site, 'zh-TW', { path: '/admin/bulletin/edit/', alternates: ['zh-TW'] })));
  for (const id of ['te-affils', 'te-doi', 'te-doi-suggest', 'te-received', 'te-accepted', 'te-legacydoi', 'te-keywordsen', 'te-abstracten', 'te-figfiles', 'te-cats', 'te-cat-add', 'te-cat-new', 'te-cat-new-en']) assert.ok(html.includes(`id="${id}"`), `缺 #${id}`);
  const data = JSON.parse(html.match(/<script type="application\/json" id="adm-bulletin-data">([\s\S]*?)<\/script>/)[1]);
  assert.equal(data.categories.length, 8); assert.ok(data.imageMaxBytes > 0);
  assert.match(html, /<div class="adm-tablewrap" role="region" tabindex="0"/);
});
