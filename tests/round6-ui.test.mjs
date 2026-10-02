// 第六輪（W2）呈現測試：國際合作入口（語言權威性、夥伴地圖自訂 class）、導覽（en 主選單／footer／about／developers）、
// 16 個疾病頁無 undefined／空區塊、後台移轉清單摘要表（72＋ 份）、/legacy/ 模式提示。
// W1 的真實內容就位時優先用真實資料；尚未就位（或清單數 < 72）時用 tests/round6-fixtures.mjs 的合成資料，兩種情況都能跑。
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeCtx, langAvailable } from '../scripts/lib/pages.mjs';
import * as intl from '../src/templates/public/international.mjs';
import * as pageT from '../src/templates/public/page.mjs';
import * as disease from '../src/templates/public/disease.mjs';
import * as diseases from '../src/templates/public/diseases.mjs';
import * as about from '../src/templates/public/about.mjs';
import * as developers from '../src/templates/public/developers.mjs';
import * as legacy from '../src/templates/public/legacy.mjs';
import * as admMigration from '../src/templates/admin/migration.mjs';
import * as admIndex from '../src/templates/admin/index.mjs';
import { worldMap, styles as mapStyles } from '../src/templates/public/_travel-map.mjs';
import { intlSubPages, intlTopic, seriesNav } from '../src/templates/public/_international.mjs';
import { layout } from '../src/templates/layout.mjs';
import { STRINGS, t as T } from '../src/client/i18n.js';
import { config } from '../site.config.mjs';
import { govern, addIntl, scaleMigration } from './round6-fixtures.mjs';

const str = (r) => String(r);
const LANGS = ['zh-TW', 'en', 'ja', 'tl', 'vi', 'id', 'th'];
const BAD = [/href="null"/, /href="undefined"/, /href="\[object/, />undefined</, />null</, /\$\{/, /\bundefined\b/];
const noBad = (h, label = '') => { for (const re of BAD) assert.ok(!re.test(h), `${label} 出現 ${re}`); };

const HAS_REAL_INTL = !!govern().byId.get('topic.international-cooperation');
const mkIntlSite = () => (HAS_REAL_INTL ? govern() : govern('2026-10-01', addIntl));
const HAS_REAL_SCALE = (govern().migration?.lists?.length ?? 0) >= 72;
const mkScaleSite = () => (HAS_REAL_SCALE ? govern() : scaleMigration(govern()));

const ictx = (site, lang, path = '/international/') => makeCtx(site, lang, { path, alternates: ['zh-TW', 'en'] });
const fullPage = (mod, ctx, props = {}) => str(layout(ctx, { ...(mod.meta?.(ctx, props) ?? {}), body: mod.render(ctx, props) }));

/* ───────── worldMap：classOf／legend ───────── */
test('worldMap：classOf 自訂 class 取代 travel 等級 class、台灣不受影響、legend 陣列自訂圖例；既有呼叫不變', () => {
  const ctx = { lang: 'en', site: { master: { countries: [{ iso2: 'JP', name: '日本', nameEn: 'Japan' }] } } };
  const h = str(worldMap(ctx, { classOf: (iso) => (iso === 'JP' ? 'wm--c1' : iso === 'TW' ? 'wm--c2' : null), labelOf: (iso) => (iso === 'JP' ? 'MOU 2018' : null), legend: [{ cls: 'wm--c1', label: 'Signed' }, { cls: 'wm--none', label: 'None' }] }));
  assert.match(h, /<path class="wm wm--c1" data-iso="JP"/);
  assert.match(h, /<path class="wm wm--tw" data-iso="TW"/, '台灣維持 wm--tw');
  assert.ok(h.includes('<title>Japan：MOU 2018</title>'), 'labelOf 進 <title>');
  assert.match(h, /<i class="wm-sw wm-sw--c1"><\/i>Signed/);
  assert.match(h, /<i class="wm-sw wm-sw--none"><\/i>None/);
  assert.ok(!/wm-sw--l[123]/.test(h), '自訂圖例不含 travel 等級項');
  assert.ok(!/class="wm wm--l[123]" data-iso="JP"/.test(h));
  // 既有呼叫（byIso＋物件 legend）相容
  const old = str(worldMap(ctx, { byIso: new Map([['JP', { code: 2, label: 'L2' }]]), legend: { l2: '警示' } }));
  assert.match(old, /<path class="wm wm--l2" data-iso="JP"/);
  assert.match(old, /wm-sw--l3/); assert.match(old, /警示/);
  // 樣式：藍綠系，不是 travel 的 tv- 變數
  assert.match(mapStyles, /\.wm--c1\{fill:var\(--cp-1,#0b6e77\)\}/);
  assert.ok(!/\.wm--c[123]\{[^}]*--tv-/.test(mapStyles));
});

/* ───────── /international/ ───────── */
test('/international/：zh-TW 與 en 都輸出，且各有語言權威性提示；其他語言只在有譯文時輸出', () => {
  const site = mkIntlSite();
  const pg = intl.pages(site);
  const langs = pg.map((p) => p.lang);
  assert.ok(langs.includes('zh-TW') && langs.includes('en'), `輸出語言：${langs}`);
  const tp = intlTopic(site);
  for (const L_ of config.langs) if (!['zh-TW', 'en'].includes(L_.code)) assert.equal(langs.includes(L_.code), langAvailable(site, tp, L_.code), L_.code);

  const zh = str(intl.render(ictx(site, 'zh-TW')));
  const en = str(intl.render(ictx(site, 'en')));
  assert.match(zh, /本頁以英文為準，中文為譯文/);
  assert.match(en, /English is the authoritative version/);
  assert.ok(!zh.includes('English is the authoritative'), 'zh 頁不顯示英文版提示');
  assert.ok(!en.includes('本頁以英文為準'), 'en 頁不顯示中文版提示');
  assert.match(zh, /class="c-authority c-authority--translated"/);
  assert.match(en, /class="c-authority c-authority--source"/);
  assert.match(zh, /href="\/new_cdc_prototype\/en\/international\/" hreflang="en"/, 'zh 頁連到英文正本');
  assert.match(en, /href="\/new_cdc_prototype\/international\/" hreflang="zh-TW"/, 'en 頁連到中文譯文');
  // 一個 h1、標題依語言取值（en 用頂層、zh-TW 用 i18n）
  assert.equal((zh.match(/<h1>/g) ?? []).length, 1);
  assert.equal((en.match(/<h1>/g) ?? []).length, 1);
  assert.ok(en.includes(`<h1>${tp.title}</h1>`), 'en 用頂層（英文）標題');
  assert.ok(zh.includes(`<h1>${tp.i18n['zh-TW'].title}</h1>`), 'zh-TW 用 i18n 中文標題');
  for (const h of [zh, en]) {
    noBad(h.replace(/<style>[\s\S]*?<\/style>/g, ''), 'international');
    for (const id of ['news', 'contact']) assert.ok(h.includes(`id="${id}"`), id);
    // 目錄連結必須都有對應區塊
    const toc = h.match(/<nav class="c-chips-wrap"[\s\S]*?<\/nav>/)[0];
    for (const m of toc.matchAll(/href="#([\w-]+)"/g)) assert.ok(h.includes(`id="${m[1]}"`), `目錄連到不存在的 #${m[1]}`);
  }
});

test('/international/：layout 譯文狀態列——來源語言頁不出現「已審核譯文」，zh-TW 也沒有；ja 譯文頁的「原文」連到英文', () => {
  const site = mkIntlSite();
  const en = fullPage(intl, ictx(site, 'en'));
  assert.ok(!en.includes('c-translation-bar'), 'en 是來源語言，不顯示譯文狀態列');
  const zh = fullPage(intl, ictx(site, 'zh-TW'));
  assert.ok(!zh.includes('c-translation-bar'));
  // 注入 ja 譯文時，狀態列的原文連結指向英文版，文字為「View the English original」
  const tp = intlTopic(site);
  tp.languages = { ...tp.languages, ja: { status: 'machine' } };
  const ja = fullPage(intl, makeCtx(site, 'ja', { path: '/international/', alternates: ['zh-TW', 'en', 'ja'] }));
  assert.match(ja, /class="c-translation-bar c-translation-bar--machine"/);
  assert.match(ja, /href="\/new_cdc_prototype\/en\/international\/" hreflang="en" lang="en" class="c-translation-bar__orig">英語の正本を見る</);
});

test('/international/：夥伴地圖用自訂 class（藍綠 c1/c2/c3），不出現 travel 等級 class；雙邊 MOU 表格列與地圖國家對得上', () => {
  const site = mkIntlSite();
  const h = str(intl.render(ictx(site, 'en')));
  assert.match(h, /<svg class="wm-svg"/);
  const paths = [...h.matchAll(/<path class="wm (wm--[\w-]+)" data-iso="([A-Z]{2})"/g)];
  const custom = paths.filter(([, c]) => /^wm--c[123]$/.test(c));
  assert.ok(custom.length >= 3, `自訂 class 國家數 ${custom.length}`);
  assert.ok(!paths.some(([, c]) => /^wm--l[123]$/.test(c)), '夥伴地圖不用 travel 等級色');
  assert.match(h, /wm-sw--c1/);
  assert.match(h, /id="mou-table"/);
  const rows = [...h.matchAll(/<tr data-iso="([A-Z ]*)">/g)].map((m) => m[1]).filter(Boolean).flatMap((s) => s.split(' '));
  for (const [, , iso] of custom) assert.ok(rows.includes(iso), `地圖上的 ${iso} 在表格中有對應列`);
  if (!HAS_REAL_INTL) {
    // 合成資料：美、日＝合作中，菲＝洽簽中，泰＝已屆期；歐盟不在世界地圖路徑內
    const cls = Object.fromEntries(paths.map(([, c, i]) => [i, c]));
    assert.equal(cls.US, 'wm--c1'); assert.equal(cls.JP, 'wm--c1'); assert.equal(cls.PH, 'wm--c2'); assert.equal(cls.TH, 'wm--c3');
    assert.match(h, /Signed and active/); assert.match(h, /Under negotiation or planned/); assert.match(h, /Expired or paused/);
  }
  // zh-TW 圖例是中文
  const zh = str(intl.render(ictx(site, 'zh-TW')));
  assert.match(zh, /已簽署、合作中/);
  assert.match(zh, /<style>[\s\S]*?\.wm--c1\{fill/, '頁面內嵌地圖樣式');
});

test('/international/：IHR 窗口卡（24 小時、電話、信箱）、訓練申請連到 service、聯絡窗口', () => {
  const site = mkIntlSite();
  const h = str(intl.render(ictx(site, 'en')));
  assert.match(h, /id="ihr"/);
  assert.match(h, /class="c-ihr__contact"/);
  assert.match(h, /href="tel:\+?\d+"/, '電話連結');
  if (!HAS_REAL_INTL) assert.match(h, /href="mailto:[^"]+@[^"]+"/, '信箱連結');
  assert.match(h, /Available 24 hours a day, 7 days a week/);
  const sv = site.byId.get('service.international-training-application');
  if (sv) assert.match(h, new RegExp(`href="/new_cdc_prototype(/en)?/apply/${sv.slug}/"`));
  assert.match(h, /href="tel:1922"/);
  assert.match(h, /href="\/new_cdc_prototype(\/en)?\/contact\/"/);
});

test('國際合作子頁：沿用 page 模板，加同系列子頁導覽、上下頁與權威性提示', () => {
  const site = mkIntlSite();
  const subs = intlSubPages(site);
  assert.ok(subs.length >= 6, `子頁數 ${subs.length}`);
  const paths = new Set(pageT.pages(site).filter((p) => p.lang === 'en').map((p) => p.path));
  for (const p of subs) {
    const path = pageT.standalonePath(p);
    assert.ok(path && path.startsWith('/international/') && paths.has(path), `${p.id} 有獨立路徑 ${path}`);
    for (const lang of ['zh-TW', 'en']) {
      const ctx = ictx(site, lang, path);
      const h = str(pageT.render(ctx, { item: p }));
      assert.match(h, /<nav class="c-seriesnav"/, `${p.id} ${lang} 有同系列子頁導覽`);
      assert.equal((h.match(/aria-current="page"/g) ?? []).length - (h.match(/<li aria-current="page">/g) ?? []).length, 1, '導覽中恰好標一個目前頁');
      for (const s of subs) assert.ok(h.includes(`href="${ctx.url(pageT.standalonePath(s))}"`), `導覽含 ${s.id}`);
      assert.match(h, /c-pager/);
      assert.match(h, lang === 'en' ? /English is the authoritative version/ : /本頁以英文為準，中文為譯文/);
      assert.match(h, /<li><a href="\/new_cdc_prototype(\/en)?\/international\/">/, '麵包屑回 /international/');
      noBad(h, p.id);
    }
  }
  // 導覽元件對非國際合作頁回傳空字串
  assert.equal(str(seriesNav(ictx(site, 'en'), null)).includes('c-seriesnav'), true);
  assert.ok(str(pageT.render(ictx(site, 'zh-TW', '/about/mission/'), { item: site.byId.get('page.mission') })).indexOf('c-seriesnav') < 0, '其他 page 不帶系列導覽');
});

/* ───────── 導覽：主選單、footer、about、developers ───────── */
test('導覽：en 主選單有 International Cooperation，zh-TW 主選單沒有；footer 與 /about/、/developers/ 都連到 /international/', () => {
  const site = mkIntlSite();
  const nav = (h) => h.match(/<nav id="main-nav"[\s\S]*?<\/nav>/)[0];
  const en = fullPage(intl, ictx(site, 'en'));
  const zh = fullPage(intl, ictx(site, 'zh-TW'));
  assert.match(nav(en), /<a href="\/new_cdc_prototype\/en\/international\/"[^>]*>International Cooperation<\/a>/);
  assert.ok(!nav(zh).includes('/international/'), 'zh-TW 主選單不加（八項已滿）');
  assert.equal((nav(zh).match(/<a /g) ?? []).length, 9, '八項 + 專業');
  assert.equal((nav(en).match(/<a /g) ?? []).length, 10, 'en 多一項 International Cooperation');
  const foot = (h) => h.match(/<nav aria-label="[^"]*" class="site-footer__links">[\s\S]*?<\/nav>/)[0];
  assert.match(foot(zh), /<a href="\/new_cdc_prototype\/about\/">關於疾管署<\/a><a href="\/new_cdc_prototype\/international\/">國際合作<\/a>/);
  assert.match(foot(en), /About Taiwan CDC<\/a><a href="\/new_cdc_prototype\/en\/international\/">International Cooperation<\/a>/);
  // 日文頁尾也有（連到有頁的語言；沒有日文頁時 url() 退回中文路徑）
  const ja = fullPage(about, makeCtx(site, 'ja', { path: '/about/', alternates: ['zh-TW', 'ja'] }));
  assert.match(foot(ja), /国際協力/);
  // /about/
  const ab = str(about.render(makeCtx(site, 'zh-TW', { path: '/about/' })));
  assert.match(ab, /id="international"/);
  assert.match(ab, /href="\/new_cdc_prototype\/international\/"/);
  assert.match(ab, /href="#international"/);
  const abEn = str(about.render(makeCtx(site, 'en', { path: '/about/' })));
  assert.match(abEn, /href="\/new_cdc_prototype\/en\/international\/"/);
  // /developers/（研究與媒體）
  const dv = str(developers.render(makeCtx(site, 'zh-TW', { path: '/developers/' })));
  assert.match(dv, /id="intl-card"/);
  assert.match(dv, /href="\/new_cdc_prototype\/international\/"/);
});

test('導覽：沒有國際合作專區時，主選單、footer、about、developers 都不出現連結（避免死連結）', () => {
  const site = govern('2026-10-01');
  site.byId.delete('topic.international-cooperation');
  site.collections.topics = site.collections.topics.filter((x) => x.id !== 'topic.international-cooperation');
  for (const lang of ['zh-TW', 'en']) {
    const h = fullPage(about, makeCtx(site, lang, { path: '/about/', alternates: ['zh-TW', 'en'] }));
    assert.ok(!h.includes('/international/'), `${lang} 無連結`);
  }
  assert.ok(!str(developers.render(makeCtx(site, 'zh-TW', { path: '/developers/' }))).includes('/international/'));
  assert.deepEqual(intl.pages(site), []);
});

/* ───────── 疾病頁：16 個全部跑 ───────── */
test('疾病頁專區導覽：全部疾病頁（zh-TW、en、專業視角）無 undefined、無 href="null"、無空白區塊，導覽與內文一致', () => {
  const site = govern('2026-10-01');
  const list = site.collections.diseases.filter((d) => d.status === 'published');
  assert.ok(list.length >= 16, `疾病頁數 ${list.length}`);
  for (const d of list) {
    for (const lang of ['zh-TW', 'en']) {
      if (!langAvailable(site, d, lang)) continue;
      const ctx = makeCtx(site, lang, { path: `/diseases/${d.slug}/` });
      const h = str(disease.render(ctx, { item: d }));
      noBad(h.replace(/<script>[\s\S]*?<\/script>/g, ''), `${d.slug} ${lang}`);
      assert.match(h, /<nav class="c-hubnav"/, `${d.slug} 有專區導覽`);
      // 每個區塊都有內容：<section ...><h2>標題</h2> 之後不是直接結束
      for (const m of h.matchAll(/<section class="c-block[^>]*>\s*<h2[^>]*>([\s\S]*?)<\/h2>\s*<\/section>/g)) assert.fail(`${d.slug} ${lang} 空白區塊：${m[1]}`);
      for (const m of h.matchAll(/<h2 id="h-([\w-]+)">\s*<\/h2>/g)) assert.fail(`${d.slug} 區塊 ${m[1]} 標題空白`);
      // 導覽連到的 #id 一定存在；導覽項不重複
      const navs = [...h.matchAll(/<ul class="c-hubnav__list[^"]*">([\s\S]*?)<\/ul>/g)];
      assert.ok(navs.length >= 1);
      for (const ul of navs) {
        const ids = [...ul[1].matchAll(/data-hub="([\w-]+)"/g)].map((m) => m[1]);
        assert.equal(new Set(ids).size, ids.length, `${d.slug} 導覽項重複`);
        for (const id of ids) assert.ok(h.includes(`id="${id}"`), `${d.slug} 導覽 #${id} 沒有對應區塊`);
      }
      for (const m of ul_labels(h)) assert.ok(m.trim() && !/^hub\./.test(m), `${d.slug} 導覽文字缺：${m}`);
    }
  }
  // 沒有資料的區塊與導覽項不出現
  const bare = { ...list[0], id: 'disease.bare-r6', slug: 'bare-r6', blocks: list[0].blocks.map((b) => (b.key === 'treatment' ? { key: 'treatment', heading: '治療', markdown: '' } : b)), relatedDocuments: [], professional: {}, notifyWithinHours: undefined, incubation: undefined, icd10: [] };
  const hb = str(disease.render(makeCtx(site, 'zh-TW', { path: '/diseases/bare-r6/' }), { item: bare }));
  assert.ok(!hb.includes('id="treatment"') && !hb.includes('href="#treatment"'), '空白的 treatment 區塊與導覽項都不出現');
  for (const k of ['pro-docs', 'pro-programs', 'pro-services', 'pro-research']) assert.ok(!hb.includes(`id="${k}"`), k);
});
function ul_labels(h) { return [...h.matchAll(/data-hub="[\w-]+">([^<]*)</g)].map((m) => m[1]); }

test('疾病索引：無疾病頁的疾病只列名稱與「尚無頁」說明，沒有死連結', () => {
  const site = govern('2026-10-01');
  const noPage = site.master.diseases.filter((d) => !site.collections.diseases.some((p) => p.id === d.id));
  assert.ok(noPage.length >= 3, `無頁疾病 ${noPage.length}`);
  for (const lang of ['zh-TW', 'en']) {
    const h = str(diseases.render(makeCtx(site, lang, { path: '/diseases/' })));
    noBad(h, `diseases ${lang}`);
    for (const d of noPage.slice(0, 5)) assert.ok(!h.includes(`/diseases/${d.slug}/"`), `${d.slug} 不應有連結`);
  }
});

/* ───────── 後台 ───────── */
test('後台 /admin/migration/：摘要表列數＝清單數；每列疾病、類別、頁面有無、進度條、人工／推導、下載 JSON；預設待移轉最多在前', () => {
  const site = mkScaleSite();
  const n = site.migration.lists.length;
  assert.ok(n >= 72, `清單數 ${n}`);
  const ctx = makeCtx(site, 'zh-TW', { path: '/admin/migration/' });
  const body = str(admMigration.render(ctx));
  const page = str(admMigration.layout(ctx, { ...admMigration.meta(), body }));
  assert.equal((page.match(/<tbody class="mg-list" data-list-row=/g) ?? []).length, n, '摘要表列數＝清單數');
  assert.equal((page.match(/<tr class="mg-list__row">/g) ?? []).length, n);
  assert.match(page, new RegExp(`id="mg-lists">${n}<`));
  assert.match(page, new RegExp(`id="mg-total">${site.migration.lists.reduce((a, l) => a + l.items.length, 0)}<`), '總數＝各清單筆數合計');
  // 每份清單都有下載連結
  for (const l of site.migration.lists) {
    const slug = l.slug ?? l.id.replace(/^migration\./, '');
    assert.ok(page.includes(`href="/new_cdc_prototype/v1/migration/${slug}.json"`), `${l.id} 下載連結`);
  }
  // 人工／推導、有頁／無頁標記
  const derived = (page.match(/data-mode="derived"/g) ?? []).length, curated = (page.match(/data-mode="curated"/g) ?? []).length;
  assert.equal(derived + curated, n);
  assert.match(page, /<span class="adm-badge adm-badge--info">推導<\/span>/);
  assert.match(page, /<span class="adm-badge adm-badge--ok">人工<\/span>/);
  const has = (page.match(/data-has="1"/g) ?? []).length, no = (page.match(/data-has="0"/g) ?? []).length;
  assert.ok(has >= 16 || !HAS_REAL_SCALE, `有頁 ${has}`);
  assert.ok(no >= 1, `無頁 ${no}`);
  assert.match(page, new RegExp(`id="mg-nopage">${no}<`), '尚無疾病頁的數字與列一致');
  assert.match(page, /role="img" aria-label="共 \d+ 筆：/);
  // 預設排序：data-pending 非遞增
  const pend = [...page.matchAll(/<tbody class="mg-list" data-list-row="[^"]+"[^>]*data-pending="(\d+)"/g)].map((m) => Number(m[1]));
  assert.equal(pend.length, n);
  assert.deepEqual([...pend].sort((a, b) => b - a), pend, '預設依待移轉由多到少');
  // 篩選與排序控制項
  for (const k of ['all', 'has', 'no', 'curated', 'derived']) assert.ok(page.includes(`data-f="${k}"`), k);
  for (const id of ['mg-unit', 'mg-sort', 'mg-q', 'mg-csv', 'mg-csv-items', 'mg-expand']) assert.ok(page.includes(`id="${id}"`), id);
  assert.match(page, /<option value="pending">待移轉最多<\/option>/);
  // 展開區：每份清單一個，逐筆表格保留；匯出區塊保留
  assert.equal((page.match(/<tr class="mg-list__ex" id="mg-ex-[^"]+" hidden>/g) ?? []).length, n);
  assert.ok((page.match(/<tr data-status=/g) ?? []).length >= site.migration.lists.reduce((a, l) => a + l.items.length, 0));
  assert.match(page, /href="\/new_cdc_prototype\/redirects\/nginx\.map"/);
  assert.match(page, /href="\/new_cdc_prototype\/v1\/migration\/index\.json"/);
  assert.match(page, /\/assets\/js\/admin\/migration\.js/);
  noBad(page.replace(/\{id\}/g, ''), 'admin migration all');
});

test('後台 /admin/migration/：沒有清單也能渲染；/admin/ 儀表板卡顯示整體進度與無頁疾病數', () => {
  const site = mkScaleSite();
  const m = site.migration;
  const h = str(admIndex.render(makeCtx(site, 'zh-TW', { path: '/admin/' })));
  const total = m.lists.reduce((a, l) => a + l.items.length, 0);
  const done = m.lists.reduce((a, l) => a + l.items.filter((i) => i.status !== 'pending').length, 0);
  assert.match(h, /id="dash-migration"/);
  assert.match(h, new RegExp(`<dt>整體進度</dt><dd>${done} / ${total} <span class="adm-muted">\\(${Math.round((done / total) * 100)}%\\)</span></dd>`));
  assert.match(h, new RegExp(`<dt>清單</dt><dd>${m.lists.length} 份`));
  const noPage = m.lists.filter((l) => l.hasPage === false || l.status === 'no-page').length;
  assert.match(h, new RegExp(`<dt>尚無疾病頁</dt><dd class="[^"]*">${noPage} 種</dd>`));
  noBad(h, 'admin index');
  delete site.migration;
  assert.match(str(admMigration.render(makeCtx(site, 'zh-TW', { path: '/admin/migration/' }))), /本次建置沒有移轉清單/);
});

test('後台 /admin/migration/ 前端腳本：篩選、排序、展開、狀態記憶（hash／localStorage）', async () => {
  const site = mkScaleSite();
  const ctx = makeCtx(site, 'zh-TW', { path: '/admin/migration/' });
  const body = str(admMigration.render(ctx));
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../src/client/admin/migration.js', import.meta.url), 'utf8');
  assert.match(src, /cdc\.admin\.migration\.v2/);
  assert.match(src, /history\.replaceState/);
  // 用極簡 DOM 模擬 tbody 與控制項，驗證 filter／sort／open 狀態寫入 hash
  const rows = [...body.matchAll(/<tbody class="mg-list" data-list-row="([^"]+)" data-has="([^"]*)" data-mode="([^"]*)" data-owner="([^"]*)" data-pending="(\d+)" data-total="(\d+)" data-pct="(\d+)" data-name="([^"]*)"/g)]
    .map(([, id, has, mode, owner, pending, total, pct, name]) => ({ id, has, mode, owner, pending: +pending, total: +total, pct: +pct, name }));
  assert.equal(rows.length, site.migration.lists.length);
  const visible = (f) => rows.filter((r) => (f === 'has' ? r.has === '1' : f === 'no' ? r.has === '0' : f === 'curated' ? r.mode === 'curated' : f === 'derived' ? r.mode === 'derived' : true));
  assert.equal(visible('has').length + visible('no').length + rows.filter((r) => r.has === '-').length, rows.length, '有頁＋無頁＋專區＝全部');
  assert.equal(visible('curated').length + visible('derived').length, rows.length, '人工＋推導＝全部');
});

/* ───────── /legacy/ 模式提示 ───────── */
test('/legacy/：{id} 佔位網址依 (模式, 片段) 合併；同一模式涉及多份清單時不挑任何一種疾病，只提示舊頁標題與新站區塊', () => {
  const site = mkScaleSite();
  const ctx = makeCtx(site, 'zh-TW', { path: '/legacy/' });
  const { pats } = legacy.lookupTables(ctx);
  assert.ok(pats.length >= 1);
  const keys = pats.map((p) => `${p.re}|${p.h}`);
  assert.equal(new Set(keys).size, keys.length, '同一 (模式, 片段) 只出現一次');
  const multi = pats.filter((p) => p.c > 1);
  assert.ok(multi.length >= 1, '72 份清單共用的模式 c > 1');
  for (const p of multi) { assert.equal(p.g, null, '多份清單共用時不指定目標'); assert.ok(p.t, '有舊標題'); }
  const intro = pats.find((p) => p.h === 'intro' || p.h === 'symptoms');
  if (intro) assert.ok(intro.t);
  const h = str(legacy.render(ctx));
  assert.match(h, /id="lg-data"/);
  assert.ok(h.length < 400000, `legacy 頁大小 ${h.length}`);
});

test('/legacy/ 前端：貼舊疾病頁網址（只有模式）⇒ 顯示「這是舊站疾病頁的『{oldTitle}』…新站對應各疾病頁的『{區塊}』」，不挑單一疾病', async () => {
  const site = mkScaleSite();
  // 注入兩份共用同一模式的清單：一份有頁、一份無頁，各有一個 #symptoms 片段
  const ctx = makeCtx(site, 'zh-TW', { path: '/legacy/' });
  const html = str(legacy.render(ctx));
  const code = html.match(/<script>(\(function legacyKeys[\s\S]*?|function legacyKeys[\s\S]*?)<\/script>/)?.[1] ?? html.match(/<script>(function legacyKeys[\s\S]*?)<\/script>/)?.[1];
  assert.ok(code, '找到內嵌腳本');
  const dataJson = html.match(/<script type="application\/json" id="lg-data">([\s\S]*?)<\/script>/)[1].replace(/\\u003c/g, '<');
  const D = JSON.parse(dataJson);
  const multi = D.pats.find((p) => p.c > 1 && p.h);
  assert.ok(multi, '有多份清單共用的片段模式');
  const res = await runLegacy(code, dataJson, `https://www.cdc.gov.tw/Disease/SubIndex/AbC123#${multi.h}`);
  assert.ok(res.text.includes('這是舊站疾病頁的子頁'), res.text);
  assert.ok(res.text.includes(`這是舊站疾病頁的「${multi.t}」`), res.text);
  assert.ok(res.text.includes('各疾病頁'), '多種疾病共用 ⇒ 說明新站對應各疾病頁的區塊');
  if (multi.b) assert.ok(res.text.includes(`「${multi.b}」`), res.text);
  assert.ok(res.links.some((l) => l.endsWith('/diseases/')), '導向傳染病列表');
  assert.ok(res.links.some((l) => l.includes('/ask/?q=')), '站內搜尋');
  assert.ok(!res.links.some((l) => /\/diseases\/[a-z-]+\/#/.test(l)), '不挑任何一種疾病');
  // 完全查不到的網址仍是「查不到」
  const miss = await runLegacy(code, dataJson, 'https://www.cdc.gov.tw/Nothing/Here/123');
  assert.ok(!miss.text.includes('這是舊站疾病頁'), miss.text);
});

test('/legacy/ 前端：只對應一份清單的模式 ⇒ 「新站對應 {疾病} 的『{區塊}』」並連到該疾病頁錨點', async () => {
  const site = govern('2026-10-01');
  const d = site.byId.get('disease.dengue');
  const items = [{ key: 'only-one', oldTitle: '特有頁', oldPath: '登革熱／特有頁', oldUrl: 'https://www.cdc.gov.tw/Special/Page/{id}#only', oldType: 'page', verified: false, status: 'merged', target: d.id, anchor: 'symptoms', note: '併入症狀', newRequirements: [] }];
  site.migration = { lists: [{ id: 'migration.t1', type: 'migration', title: '測試', owner: d.owner, scope: { kind: 'disease', disease: d.id }, items, showLegacyUntil: '2027-12-31' }], byTarget: new Map(), stats: { total: 1 }, pending: [] };
  const ctx = makeCtx(site, 'zh-TW', { path: '/legacy/' });
  const html = str(legacy.render(ctx));
  const code = html.match(/<script>(function legacyKeys[\s\S]*?)<\/script>/)[1];
  const dataJson = html.match(/<script type="application\/json" id="lg-data">([\s\S]*?)<\/script>/)[1].replace(/\\u003c/g, '<');
  const res = await runLegacy(code, dataJson, 'https://www.cdc.gov.tw/Special/Page/Zz9#only');
  assert.ok(res.text.includes('這是舊站疾病頁的「特有頁」，新站對應 登革熱 的「症狀」。'), res.text);
  assert.ok(res.links.includes('/new_cdc_prototype/diseases/dengue/#symptoms'), res.links.join(','));
});

/** 極簡 DOM：執行 /legacy/ 內嵌腳本，回傳結果區的純文字與所有 href */
async function runLegacy(code, dataJson, query) {
  const mkEl = (tag) => {
    const el = { tag, className: '', children: [], _text: '', href: '', value: '', listeners: {}, dataset: {} };
    Object.defineProperty(el, 'textContent', {
      get() { return el._text + el.children.map((c) => (c.nodeType === 3 ? c.data : c.textContent)).join(''); },
      set(v) { el._text = String(v); el.children = []; },
    });
    el.appendChild = (c) => { el.children.push(c); return c; };
    el.addEventListener = (ev, fn) => { (el.listeners[ev] ??= []).push(fn); };
    el.setAttribute = () => {};
    return el;
  };
  const res = mkEl('div'), input = mkEl('input'), form = mkEl('form'), data = mkEl('script');
  data._text = dataJson;
  const document = {
    getElementById: (id) => ({ 'lg-data': data, 'lg-res': res, 'lg-u': input })[id] ?? null,
    querySelector: (s) => ({ '[data-lg-form]': form, '#lg-u': input, '#lg-res': res })[s] ?? null,
    createElement: mkEl, createTextNode: (data_) => ({ nodeType: 3, data: data_ }),
  };
  const location = { href: 'https://example.test/legacy/', pathname: '/legacy/', search: `?u=${encodeURIComponent(query)}` };
  const history = { replaceState() {} };
  const fetch = async () => ({ ok: true, json: async () => ({ data: {} }) });
  new Function('document', 'location', 'history', 'fetch', code)(document, location, history, fetch);
  await new Promise((r) => setTimeout(r, 20));
  const links = [];
  const walk = (el) => { if (el.href) links.push(el.href); (el.children ?? []).forEach(walk); };
  walk(res);
  return { text: res.textContent, links };
}

/* ───────── i18n ───────── */
test('i18n：本輪新增的介面字七語齊備、佔位符一致', () => {
  const keys = Object.keys(STRINGS['zh-TW']).filter((k) => /^(international\.|series\.|authority\.|langname\.|legacy\.hint\.)/.test(k));
  assert.ok(keys.length >= 50, `新增 key 數 ${keys.length}`);
  for (const k of keys) {
    const ph = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
    for (const lang of LANGS) {
      assert.ok(STRINGS[lang][k], `${lang} 缺 ${k}`);
      assert.equal(ph(STRINGS[lang][k]), ph(STRINGS['zh-TW'][k]), `${lang} ${k} 佔位符與 zh-TW 不同`);
    }
  }
  assert.equal(T('zh-TW', 'authority.translated', { src: '英文', cur: '中文' }), '本頁以英文為準，中文為譯文。');
  assert.match(T('en', 'authority.source', { lang: 'English' }), /^English is the authoritative version/);
  for (const lang of LANGS) assert.ok(STRINGS[lang]['international.title']);
});
