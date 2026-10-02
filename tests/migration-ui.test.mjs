// 第五輪（V2）呈現測試：疾病頁專區導覽、舊網址揭露（三層）、/legacy/ 七語、404 自動轉址、後台移轉進度。
// 以「事後注入」的合成 site.migration／gov.legacy 驗證（不依賴 V1 的內容筆數）；V1 資料已就位時另跑一組真實資料的健全性檢查。
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeCtx } from '../scripts/lib/pages.mjs';
import * as disease from '../src/templates/public/disease.mjs';
import * as documents from '../src/templates/public/documents.mjs';
import * as legacy from '../src/templates/public/legacy.mjs';
import * as notfound from '../src/templates/public/notfound.mjs';
import * as developers from '../src/templates/public/developers.mjs';
import * as admMigration from '../src/templates/admin/migration.mjs';
import * as admIndex from '../src/templates/admin/index.mjs';
import * as admTodos from '../src/templates/admin/todos.mjs';
import { legacyKeys, LEGACY_LOOKUP_JS, legacyDisclosure } from '../src/templates/public/_partials.mjs';
import { STRINGS } from '../src/client/i18n.js';
import { config } from '../site.config.mjs';
import { govern } from './helpers.mjs';

const str = (r) => String(r);
const LANGS = ['zh-TW', 'en', 'ja', 'tl', 'vi', 'id', 'th'];
const BAD = [/href="null"/, /href="undefined"/, /href="\[object/, />undefined</, />null</, /\$\{/];
const noBad = (h, label = '') => { for (const re of BAD) assert.ok(!re.test(h), `${label} 出現 ${re}`); };

/** 合成移轉清單：1 份清單、5 筆（涵蓋五種狀態、含 {id} 佔位網址、未核對） */
function fakeMigration(site, targetId = 'disease.dengue') {
  const tg = site.byId.get(targetId);
  const items = [
    { key: 'intro', oldTitle: '疾病介紹', oldPath: '登革熱／疾病介紹', oldUrl: 'https://www.cdc.gov.tw/Disease/SubIndex/AbC123#intro', oldType: 'page', verified: true, status: 'migrated', target: targetId, anchor: 'symptoms', note: '併入疾病頁「症狀」區塊', newRequirements: ['owner', 'reviewedAt', 'machineReadable', 'custom-req'] },
    { key: 'qa', oldTitle: '常見問答', oldPath: '登革熱／Q&A', oldUrl: 'https://www.cdc.gov.tw/Category/Page/QA999?page=3', oldType: 'qa', verified: false, status: 'merged', target: targetId, note: '', newRequirements: [] },
    { key: 'old-poster', oldTitle: '舊海報', oldPath: '登革熱／衛教', oldUrl: 'https://www.cdc.gov.tw/Disease/SubIndex/{id}#poster', oldType: 'media', verified: false, status: 'archived', target: targetId },
    { key: 'todo', oldTitle: '待決定的頁', oldPath: '登革熱／其他', oldUrl: 'https://www.cdc.gov.tw/Category/Page/TODO1', oldType: 'page', verified: false, status: 'pending' },
    { key: 'gone', oldTitle: '已停止的服務', oldPath: '登革熱／其他', oldUrl: 'https://www.cdc.gov.tw/Category/Page/GONE1', oldType: 'page', verified: true, status: 'dropped' },
  ];
  const list = { id: 'migration.test', type: 'migration', title: '登革熱專區（舊站）→ 新站', owner: tg.owner, scope: { kind: 'disease', disease: targetId }, legacyRoot: 'https://www.cdc.gov.tw/Disease/SubIndex/{id}', showLegacyUntil: '2027-12-31', items };
  site.migration = {
    lists: [list], byTarget: new Map([[targetId, items.filter((i) => i.target)]]),
    stats: { migrated: 1, merged: 1, archived: 1, pending: 1, dropped: 1, verified: 2, total: 5 }, pending: items.filter((i) => i.status === 'pending'),
  };
  tg.gov = { ...tg.gov, legacy: { urls: items.filter((i) => i.target).map((i) => i.oldUrl), items: items.filter((i) => i.target), show: true } };
  return site;
}

const base = govern();
const dengue = () => base.byId.get('disease.dengue');
const dctx = (site, lang = 'zh-TW', view = 'public') => makeCtx(site, lang, { path: '/diseases/dengue/', view });

/* ───────── 專區導覽 ───────── */
test('疾病頁：專區導覽 sticky 子導覽，民眾／專業兩套，連到存在的區塊 id', () => {
  const site = govern();
  const h = str(disease.render(dctx(site), { item: site.byId.get('disease.dengue') }));
  assert.match(h, /<nav class="c-hubnav" aria-label="專區導覽"/);
  const pub = h.match(/<ul class="c-hubnav__list c-public-only">([\s\S]*?)<\/ul>/)?.[1] ?? '';
  const pro = h.match(/<ul class="c-hubnav__list c-pro-only">([\s\S]*?)<\/ul>/)?.[1] ?? '';
  assert.ok(pub.includes('href="#symptoms"') && pub.includes('>症狀<') && pub.includes('>預防<'), '民眾版：症狀、預防');
  assert.ok(pro.includes('>指引與手冊<') && pro.includes('>通報與檢驗<'), '專業版：指引與手冊、通報與檢驗');
  for (const m of [...pub.matchAll(/href="#([\w-]+)"/g), ...pro.matchAll(/href="#([\w-]+)"/g)]) assert.ok(h.includes(`id="${m[1]}"`), `導覽連到不存在的 #${m[1]}`);
  assert.ok(!pub.includes('pro-'), '民眾版導覽不含專業區塊');
  noBad(h, 'disease');
});

test('疾病頁：專業版區塊——文件版本鏈顯示現行版＋「有 N 個舊版」', () => {
  const site = govern();
  const h = str(disease.render(dctx(site), { item: site.byId.get('disease.dengue') }));
  const docs = h.slice(h.indexOf('id="pro-docs"'), h.indexOf('id="pro-report"'));
  assert.match(docs, /現行版/);
  assert.match(docs, /有 \d+ 個舊版/, '同 family 有舊版時顯示「有 N 個舊版」');
  assert.match(docs, /已被取代/);
});

test('疾病頁：沒有資料的專業區塊不出現（導覽與內文一致）', () => {
  const site = govern();
  const d = site.byId.get('disease.dengue');
  const h = str(disease.render(dctx(site), { item: d }));
  if (!d.professional?.programs?.length) { assert.ok(!h.includes('id="pro-programs"')); assert.ok(!h.includes('href="#pro-programs"')); }
  // 注入一個無任何關聯資料的疾病
  const bare = { ...d, id: 'disease.bare-test', slug: 'bare-test', relatedDocuments: [], professional: {}, notifyWithinHours: undefined, incubation: undefined, icd10: [] };
  const hb = str(disease.render(dctx(site), { item: bare }));
  for (const k of ['pro-docs', 'pro-programs', 'pro-services', 'pro-research']) assert.ok(!hb.includes(`id="${k}"`), `${k} 不該出現`);
});

test('疾病頁：professional.programs 渲染成防治計畫卡（容錯：缺欄位不報錯）', () => {
  const site = govern();
  const d = { ...site.byId.get('disease.dengue') };
  d.professional = { ...d.professional, programs: [
    { key: 'dots', title: '都治計畫 DOTS', summaryMarkdown: '**每次服藥**都有人親眼看見。', documents: ['doc.mmr-recommendation', 'doc.not-exist'], services: ['service.not-exist'], links: [{ label: '外站', href: 'https://example.gov.tw/x' }, { label: '站內', href: '/faq/' }] },
    { title: '只有標題' },
  ] };
  const h = str(disease.render(dctx(site), { item: d }));
  assert.match(h, /id="program-dots"/);
  assert.match(h, /href="#pro-programs"/);
  assert.match(h, /<strong>每次服藥<\/strong>/);
  assert.match(h, /id="program-p2"/);
  noBad(h, 'programs');
});

/* ───────── 舊網址揭露 ───────── */
test('舊網址揭露：預設一句、details 列每筆（外連 nofollow、狀態、治理要求 chip）、專業層連 /legacy/?u=', () => {
  const site = fakeMigration(govern());
  const h = str(disease.render(dctx(site), { item: site.byId.get('disease.dengue') }));
  assert.match(h, /<p class="c-legacy__line"><span[^>]*>↪<\/span> 本頁取代舊網站的 3 個頁面<\/p>/);
  assert.match(h, /<details class="c-legacy__more"/);
  assert.match(h, /疾病介紹/);
  assert.match(h, /rel="nofollow noopener"/);
  assert.match(h, /href="https:\/\/www\.cdc\.gov\.tw\/Disease\/SubIndex\/AbC123#intro"/);
  assert.match(h, /已移轉/); assert.match(h, /已併入/); assert.match(h, /已封存/);
  assert.match(h, /對照待權責單位核對/, '未核對標示');
  assert.match(h, /c-chip c-chip--req">權責單位</);
  assert.match(h, /c-chip c-chip--req">custom-req</, '未知要求 key 原樣顯示');
  assert.match(h, /class="c-pro-only"> · <a href="\/new_cdc_prototype\/legacy\/\?u=https%3A%2F%2Fwww\.cdc\.gov\.tw%2FDisease%2FSubIndex%2FAbC123%23intro"/);
  assert.ok(!h.includes('SubIndex/{id}#poster"'), '{id} 佔位網址不做成連結');
  assert.match(h, /<code>www\.cdc\.gov\.tw\/Disease\/SubIndex\/\{id\}#poster<\/code>/);
  assert.match(h, /此對照顯示至 2027年12月31日|此對照顯示至 2027/);
  noBad(h.replace(/\{id\}/g, ''), 'legacy');
});

test('舊網址揭露：gov.legacy.show 為 false、無資料、items 為空 ⇒ 完全不輸出', () => {
  const site = fakeMigration(govern());
  const d = site.byId.get('disease.dengue');
  d.gov.legacy.show = false;
  assert.ok(!str(disease.render(dctx(site), { item: d })).includes('c-legacy'));
  d.gov.legacy = { urls: [], items: [], show: true };
  assert.ok(!str(disease.render(dctx(site), { item: d })).includes('c-legacy'));
  delete d.gov.legacy;
  assert.ok(!str(disease.render(dctx(site), { item: d })).includes('c-legacy'));
  assert.equal(str(legacyDisclosure(dctx(site), { gov: {} })), '');
  assert.equal(str(legacyDisclosure(dctx(site), {})), '');
});

test('舊網址揭露：所有型別頁經 provenance 共用元件自動帶出（以文件頁為例）', () => {
  const site = govern();
  const doc = site.collections.documents.find((x) => x.isCurrent && x.status === 'published');
  doc.gov = { ...doc.gov, legacy: { urls: ['https://www.cdc.gov.tw/Uploads/x.pdf'], show: true, items: [{ key: 'pdf', oldTitle: '舊版 PDF', oldUrl: 'https://www.cdc.gov.tw/Uploads/x.pdf', oldType: 'pdf', status: 'migrated', verified: true, target: doc.id }] } };
  const h = str(documents.render(makeCtx(site, 'zh-TW', { path: '/documents/x/' }), { item: doc }));
  assert.match(h, /本頁取代舊網站的 1 個頁面/);
  assert.match(h, /舊版 PDF/);
});

test('舊網址揭露：七語都有句子與狀態字', () => {
  const site = fakeMigration(govern());
  for (const lang of LANGS) {
    const h = str(legacyDisclosure(dctx(site, lang), site.byId.get('disease.dengue')));
    assert.ok(h.includes(STRINGS[lang]['legacy.line'].replace('{n}', '3')), lang);
    assert.ok(h.includes(STRINGS[lang]['legacy.status.migrated']), lang);
  }
});

/* ───────── 正規化與查詢 ───────── */
test('legacyKeys：小寫、無網域、無尾斜線、無 hash、去 page 參數，其餘 query 保留', () => {
  assert.equal(legacyKeys('https://www.cdc.gov.tw/Disease/SubIndex/AbC123/?page=3#top')[0], '/disease/subindex/abc123');
  assert.equal(legacyKeys('www.cdc.gov.tw/Disease/SubIndex/AbC123')[0], '/disease/subindex/abc123');
  assert.equal(legacyKeys('Disease/SubIndex/AbC123')[0], '/disease/subindex/abc123');
  assert.equal(legacyKeys('/Category/Page/X?id=5&PAGE=2')[0], '/category/page/x?id=5');
  assert.ok(legacyKeys('/a?b=2&a=1').includes('/a?a=1&b=2'), '含 query 排序版');
  assert.ok(legacyKeys('/a?utm=1').includes('/a'), '含只含路徑版');
  assert.deepEqual(legacyKeys(''), []);
});

test('瀏覽器端查詢程式（toString 嵌入）：與建置端同規則、命中與未命中', () => {
  const f = new Function(`${LEGACY_LOOKUP_JS}; return { legacyIndex, legacyFind, legacyWord };`)();
  const idx = f.legacyIndex({ '/disease/subindex/abc123': '/diseases/tuberculosis/', '/category/page/qa999': '/faq/x/' });
  assert.deepEqual(f.legacyFind(idx, 'https://WWW.cdc.gov.tw/Disease/SubIndex/ABC123/?page=2#a'), { key: '/disease/subindex/abc123', to: '/diseases/tuberculosis/' });
  assert.equal(f.legacyFind(idx, '/Disease/SubIndex/ABC123?utm=1&foo=2').to, '/diseases/tuberculosis/', '多餘 query 退回只比路徑');
  assert.equal(f.legacyFind(idx, '/nothing/here'), null);
  assert.equal(f.legacyWord('/Disease/SubIndex/Some-Thing.aspx'), 'some thing');
});

/* ───────── /legacy/ ───────── */
test('/legacy/ 七語可渲染：表單、結果區、政策、狀態表；showLegacyUntil 日期出現在政策', () => {
  const site = fakeMigration(govern());
  for (const lang of LANGS) {
    const h = str(legacy.render(makeCtx(site, lang, { path: '/legacy/' })));
    assert.ok(h.includes(`<h1>${STRINGS[lang]['legacy.title']}</h1>`), `${lang} h1`);
    assert.ok(h.includes(`placeholder="${STRINGS[lang]['legacy.ph']}"`), `${lang} placeholder`);
    assert.ok(h.includes(STRINGS[lang]['legacy.policy.t']), `${lang} 政策標題`);
    assert.ok(h.includes('id="lg-data"') && h.includes('data-lg-form') && h.includes('id="lg-res"'));
    assert.ok(/2027|2570/.test(h.slice(h.indexOf('lg-policy'), h.indexOf('lg-data'))), `${lang} 政策含關閉日`);
    noBad(h, `legacy ${lang}`);
    const m = legacy.meta(makeCtx(site, lang));
    assert.equal(m.noindex, true);
  }
  const zh = str(legacy.render(makeCtx(site, 'zh-TW', { path: '/legacy/' })));
  assert.match(zh, /301/); assert.match(zh, /410/); assert.match(zh, /showLegacyUntil/);
  assert.match(zh, /\/new_cdc_prototype\/v1\/legacy-map\.json/);
  const data = JSON.parse(zh.match(/<script type="application\/json" id="lg-data">([\s\S]*?)<\/script>/)[1].replace(/\\u003c/g, '<'));
  assert.equal(data.items['/disease/subindex/abc123'].s, 'migrated');
  assert.equal(data.items['/category/page/qa999'].v, false, '正規化後 page 參數被去掉');
  assert.equal(data.items['/category/page/todo1'].g, null);
  assert.ok(!Object.keys(data.items).some((k) => k.includes('{id}')), '佔位網址不進查詢表');
  assert.equal(data.pats.length, 1, '{id} 佔位網址改以 URL 模式＋片段比對');
  assert.equal(data.pats[0].re, '^/disease/subindex/[^/?]+$');
  assert.equal(data.pats[0].h, 'poster');
  assert.ok(new RegExp(data.pats[0].re).test('/disease/subindex/zz9'));
  assert.equal(data.targets['disease.dengue'].href, '/new_cdc_prototype/diseases/dengue/');
});

test('/legacy/ 沒有移轉清單時仍可渲染（只靠 legacy-map）', () => {
  const site = govern();
  delete site.migration;
  const h = str(legacy.render(makeCtx(site, 'en', { path: '/legacy/' })));
  assert.match(h, /Old address finder/);
  assert.ok(!h.includes('lg-cov'));
  noBad(h, 'legacy empty');
});

/* ───────── 404 ───────── */
test('404：載入 legacy-map（含 basePath）、倒數轉址腳本、noscript 連 /legacy/、未命中帶入搜尋', () => {
  const site = govern();
  const h = str(notfound.render(makeCtx(site, 'zh-TW', { path: '/404.html' })));
  assert.match(h, /"legacyMap":"\/new_cdc_prototype\/v1\/legacy-map\.json"/);
  assert.match(h, /location\.replace\(dest\)/);
  assert.match(h, /clearInterval/, '可取消倒數');
  assert.match(h, /data-nf-moved/);
  assert.match(h, /舊網址已搬家/);
  assert.match(h, /3 秒後帶你到新頁/);
  assert.match(h, /立即前往新頁/);
  assert.match(h, /<noscript>[\s\S]*?<\/noscript>/);
  const ns = h.match(/<noscript>([\s\S]*?)<\/noscript>/)[1];
  assert.ok(ns.includes('如果頁面沒有自動跳轉'));
  assert.ok(h.includes(`href="/new_cdc_prototype/legacy/"`));
  assert.match(h, /data-nf-search-link/);
  assert.match(h, /function legacyFind/);
  assert.match(h, /你可能在找/, '既有的相似路徑建議仍在');
  assert.ok(!h.includes('href="legacy/') && !h.includes('href="./'), '404 的連結不可用相對路徑');
  noBad(h, '404');
});

/* ───────── 後台 ───────── */
const admCtx = (site, path) => makeCtx(site, 'zh-TW', { path });

test('後台 /admin/migration/：進度數字、各清單進度、逐筆表格、匯出連結', () => {
  const site = fakeMigration(govern());
  const body = str(admMigration.render(admCtx(site, '/admin/migration/')));
  const page = str(admMigration.layout(admCtx(site, '/admin/migration/'), { ...admMigration.meta(), body }));
  assert.match(page, /移轉進度（舊站 → 新站）/);
  assert.match(page, /id="mg-total">5</);
  assert.match(page, /id="mg-pending">1</);
  assert.match(page, /整體處理完成 <strong>80%<\/strong>/, '5 筆中 4 筆有去向');
  assert.match(page, /已核對網址/);
  assert.match(page, /2 \/ 5/);
  assert.match(page, /role="img" aria-label="共 5 筆：/);
  assert.equal((page.match(/<tr data-status=/g) ?? []).length, 5, '逐筆表格 5 列');
  assert.ok(page.indexOf('data-status="pending"') < page.indexOf('data-status="migrated"'), '待確認排在最前');
  for (const f of ['/redirects/nginx.map', '/redirects/web.config.rewritemap.xml', '/redirects/_redirects', '/v1/redirects.json', '/v1/legacy-map.json']) assert.ok(page.includes(`href="/new_cdc_prototype${f}"`), f);
  assert.match(page, /href="\/new_cdc_prototype\/admin\/todos\/#migration-pending"/);
  assert.match(page, /href="\/new_cdc_prototype\/diseases\/dengue\/#symptoms"/, '對應新頁連結含錨點');
  assert.match(page, /\/assets\/js\/admin\/migration\.js/);
  assert.match(page, /data-admin-page="migration"/);
  assert.match(page, /href="\/new_cdc_prototype\/admin\/migration\/"/, '後台導覽有「移轉進度」');
  noBad(page.replace(/\{id\}/g, ''), 'admin migration');
});

test('後台 /admin/migration/：沒有移轉清單也能渲染（說明＋匯出連結）', () => {
  const site = govern();
  delete site.migration;
  const body = str(admMigration.render(admCtx(site, '/admin/migration/')));
  assert.match(body, /本次建置沒有移轉清單/);
  assert.match(body, /nginx\.map/);
  noBad(body, 'admin migration empty');
});

test('後台儀表板：有「移轉進度」卡（數字）；無清單時也能渲染', () => {
  const site = fakeMigration(govern());
  const h = str(admIndex.render(admCtx(site, '/admin/')));
  assert.match(h, /id="dash-migration"/);
  assert.match(h, /移轉進度 <a href="\/new_cdc_prototype\/admin\/migration\/"/);
  assert.match(h, /<dt>舊頁總數<\/dt><dd>5<\/dd>/);
  noBad(h, 'admin index');
  delete site.migration;
  assert.match(str(admIndex.render(admCtx(site, '/admin/'))), /尚未建立移轉清單/);
});

test('待辦頁：有 migration-pending 頁籤；待辦列連到移轉進度', () => {
  const site = govern();
  site.gov.todos = [...site.gov.todos, { kind: 'migration-pending', itemId: 'migration.test', owner: 'unit.acute-infectious', text: '舊頁「待決定的頁」尚未移轉。', dueAt: '2026-10-15', severity: 'medium' }];
  const h = str(admTodos.render(admCtx(site, '/admin/todos/')));
  assert.match(h, /id="tab-migration-pending"/);
  assert.match(h, /舊頁待移轉<span class="adm-count" data-kcount="migration-pending">\d+</);
  assert.match(h, /data-panel="migration-pending"[\s\S]*?前往移轉進度/);
  noBad(h, 'admin todos');
});

/* ───────── 開發者頁、i18n ───────── */
test('開發者頁列出 legacy-map.json 與 redirects/ 三檔；有移轉清單時範例回應取自真實對照', () => {
  const site = govern();
  const h = str(developers.render(makeCtx(site, 'zh-TW', { path: '/developers/' })));
  assert.match(h, /<code>\/v1\/legacy-map\.json<\/code>/);
  assert.match(h, /\/redirects\/nginx\.map/);
  assert.match(h, /\/redirects\/web\.config\.rewritemap\.xml/);
  assert.match(h, /\/redirects\/_redirects/);
  if (site.migration?.lists?.length) {
    const sec = h.slice(h.indexOf('<code>/v1/legacy-map.json</code>'), h.indexOf('id="openapi"'));
    assert.match(sec, /&quot;data&quot;: \{/, '範例含 data 對照');
  }
});

test('i18n：本輪新增的介面字七語齊備（長說明文字允許只有 zh-TW／en）', () => {
  const keys = Object.keys(STRINGS['zh-TW']).filter((k) => /^(hub\.|legacy\.|404\.(moved|legacy|search|noscript))/.test(k));
  assert.ok(keys.length >= 80, `新增 key 數 ${keys.length}`);
  const twoLang = /^hub\.pro\.(docs\.lead|docs\.none|report\.lead|programs\.(lead|docs|services|links)|services\.lead|stats\.(lead|situation|updated)|research\.(lead|year))$/;
  for (const k of keys) {
    for (const lang of twoLang.test(k) ? ['zh-TW', 'en'] : LANGS) assert.ok(STRINGS[lang][k], `${lang} 缺 ${k}`);
  }
  for (const lang of LANGS) for (const k of ['legacy.line', 'legacy.miss.search', '404.moved.d']) assert.match(STRINGS[lang][k], /\{(n|q)\}/, `${lang} ${k} 少了佔位`);
});

/* ───────── 真實資料（V1 已就位時） ───────── */
test('真實資料：site.migration／gov.legacy 存在時，疾病頁、/legacy/、後台頁都不出現壞連結', { skip: !govern().migration?.lists?.length }, () => {
  const site = govern();
  assert.ok(site.migration.stats.total > 0);
  const targets = [...site.migration.byTarget.keys()].map((id) => site.byId.get(id)).filter((i) => i?.type === 'disease');
  for (const d of targets) {
    const h = str(disease.render(dctx(site), { item: d }));
    if (d.gov?.legacy?.show) assert.match(h, /本頁取代舊網站的 \d+ 個頁面/);
    noBad(h.replace(/\{id\}/g, ''), d.id);
  }
  for (const lang of LANGS) noBad(str(legacy.render(makeCtx(site, lang, { path: '/legacy/' }))), `legacy ${lang}`);
  const adm = str(admMigration.render(admCtx(site, '/admin/migration/')));
  assert.match(adm, new RegExp(`id="mg-total">${site.migration.stats.total}<`), '後台總數與引擎 stats 一致');
  assert.equal(config.basePath, '/new_cdc_prototype');
});
