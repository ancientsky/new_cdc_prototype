// 第四十三輪：每則國際重要疫情資訊頁 /travel/alerts/{id}/、/travel/ 與目的地頁列表連結、feeds/travel-alerts.xml（docs/intl-epidemic.md §4「前台」）。
// 快照尚未帶 id 等新欄位 ⇒ 這裡以合成快照（含 id／status／areas／body／provenance）驗證，並確認舊列（無 id）維持舊行為。
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeCtx, loadTemplates } from '../scripts/lib/pages.mjs';
import { buildFeeds, buildLlms, buildSitemaps, collectPages } from '../scripts/lib/emit-seo.mjs';
import { feedCatalog } from '../scripts/lib/feed-catalog.mjs';
import { alertOf, alertIdOf, ALERT_ID_RE } from '../scripts/lib/travel-alerts.mjs';
import * as alertTpl from '../src/templates/public/travel-alert.mjs';
import * as travel from '../src/templates/public/travel.mjs';
import { t } from '../src/client/i18n.js';
import { TOPIC_IDS } from '../src/client/subscribe-rules.js';
import { govern, config } from './helpers.mjs';

const ROWS = [
  {
    id: 'alertA-1',
    status: 'published',
    publishedAt: '2026-10-05T09:00:00+08:00',
    updatedAt: '2026-10-06T10:00:00+08:00',
    StartDate: '2026-10-05',
    Disease: '登革熱',
    diseaseId: 'disease.dengue',
    Country: '孟加拉,尚比亞',
    CountryEn: 'Bangladesh,Zambia',
    ISO2: 'BD',
    ISO3166: 'BD,ZM',
    headline: '孟加拉/尚比亞-登革熱（測試）',
    Summary: '孟加拉測試摘要第一段。尚比亞測試摘要第二段。',
    body: '孟加拉測試內文第一段。\r尚比亞測試內文第二段。',
    instruction: '提醒遵守當地的一般預防措施',
    areas: [
      { country: '孟加拉', countryEn: 'Bangladesh', iso2: 'BD', detail: '朗布爾專區' },
      { country: '尚比亞', countryEn: 'Zambia', iso2: 'ZM' },
      { country: '測試島', countryEn: 'Testland', iso2: 'ZZ' },
    ],
    iso2s: ['BD', 'ZM', 'ZZ'],
    Url: 'https://www.cdc.gov.tw/TravelEpidemic/Detail/x?epidemicId=alertA-1',
    provenance: { source: 'feed', producer: '疾管署疫情中心', importedAt: '2026-10-06T10:05:00+08:00', by: 'ci' },
  },
  {
    id: 'alertB-withdrawn',
    status: 'withdrawn',
    StartDate: '2026-10-04',
    Disease: '撤下測試病',
    Country: '孟加拉',
    ISO2: 'BD',
    headline: '撤下的測試則',
    body: '撤下的測試內文',
    areas: [{ country: '孟加拉', iso2: 'BD' }],
  },
  { id: 'bad id!', StartDate: '2026-10-03', Disease: '不合法id測試病', Country: '孟加拉', ISO2: 'BD', headline: '不合法 id', body: '不合法 id 內文' },
  {
    StartDate: '2026-10-02',
    Disease: '舊格式測試病',
    Country: '孟加拉',
    ISO2: 'BD',
    Summary: '舊格式列沒有 id',
    Url: 'https://www.cdc.gov.tw/TravelEpidemic/Detail/x?epidemicId=legacy-1',
  },
  {
    id: 'alertE_md',
    StartDate: '2026-08-20',
    publishedAt: '2026-08-20T08:00:00+08:00',
    Disease: '測試病',
    Country: '尚比亞',
    ISO2: 'ZM',
    headline: '尚比亞-測試病（Markdown）',
    body: '## 摘要\n\n**重點**：請注意。\n\n- 第一點\n- 第二點\n\n<script>alert(1)</script>',
    areas: [{ country: '尚比亞', countryEn: 'Zambia', iso2: 'ZM' }],
  },
];

const site = govern('2026-10-10', (s) => {
  s.snapshots = { ...s.snapshots, travelAlerts: { meta: { mode: 'live', dataDate: '2026-10-10', count: ROWS.length, windowDays: 30 }, data: ROWS } };
});
const LANGS = config.langs.map((l) => l.code);
const pageList = alertTpl.pages(site);
const propsOf = (id) => pageList.find((p) => p.path === `/travel/alerts/${id}/`).props;
const ctxOf = (lang, path) => makeCtx(site, lang, { path, alternates: LANGS });
const renderAlert = (lang, id) => String(alertTpl.render(ctxOf(lang, `/travel/alerts/${id}/`), propsOf(id)));
const base = config.basePath;

test('id 規則：只允許 [A-Za-z0-9_-]{1,64}', () => {
  assert.equal(alertIdOf({ id: 'lQu-5iNul8z5h5Up_56VCQ' }), 'lQu-5iNul8z5h5Up_56VCQ');
  for (const bad of ['bad id!', '../x', '', 'a'.repeat(65), 'x/y', 123, null]) assert.equal(alertIdOf({ id: bad }), null, String(bad));
  assert.ok(ALERT_ID_RE.test('a'.repeat(64)));
  assert.equal(alertOf({ Url: 'javascript:alert(1)' }).sourceUrl, null, '非 http(s) 原始網址不採用');
});

test('pages()：合法 id、未撤下的才產生頁（七語、附 .md）；withdrawn／不合法 id／無 id 不產生', () => {
  assert.deepEqual(pageList.map((p) => p.path).sort(), ['/travel/alerts/alertA-1/', '/travel/alerts/alertE_md/']);
  for (const p of pageList) {
    assert.equal(p.lang, '*');
    assert.equal(p.md, true);
  }
  assert.ok(!pageList.some((p) => p.path.includes('withdrawn')));
});

test('每則頁（zh-TW）：標題、發布／更新日、疾病頁、涉及國家連目的地頁、內文分段、建議、來源、當時資訊提示、相關', () => {
  const h = renderAlert('zh-TW', 'alertA-1');
  assert.match(h, /<h1>孟加拉\/尚比亞-登革熱（測試）<\/h1>/);
  assert.ok(h.includes('<time datetime="2026-10-05">') && h.includes('<time datetime="2026-10-06">'), '發布日與更新日');
  assert.ok(h.includes(`href="${base}/diseases/dengue/"`), '疾病連疾病頁');
  assert.ok(h.includes(`href="${base}/travel/BD/"`) && h.includes(`href="${base}/travel/ZM/"`), '涉及國家連目的地頁');
  assert.ok(h.includes('朗布爾專區'), 'detail 顯示');
  assert.match(h, /<span class="tv-chip">測試島<\/span>/, '主檔沒有的國家不連結');
  assert.ok(!h.includes('/travel/ZZ/'));
  assert.ok(h.includes('<p>孟加拉測試內文第一段。</p><p>尚比亞測試內文第二段。</p>'), '純文字換行段落化');
  assert.ok(h.includes('提醒遵守當地的一般預防措施'), '建議');
  assert.ok(h.includes(t('zh-TW', 'travel.alert.src.feed')) && h.includes('疾管署疫情中心'), '來源白話＋producer');
  assert.ok(h.includes('href="https://www.cdc.gov.tw/TravelEpidemic/Detail/x?epidemicId=alertA-1"'), '原始連結');
  assert.ok(h.includes('本則發布於 2026-10-05，內容為當時資訊'));
  assert.ok(h.includes(`${base}/apply/travel-clinic-appointment/`), '旅醫門診');
  assert.ok(h.includes('class="c-askbox'), '提問框');
  assert.ok(!/href="(null|undefined)?"/.test(h), '無空連結');
  assert.ok(!h.includes(t('zh-TW', 'travel.alert.zhonly')), '中文頁不顯示「僅有中文」');
});

test('內文含 Markdown ⇒ 經 md() 淨化（保留粗體與清單、去掉 script）', () => {
  const h = renderAlert('zh-TW', 'alertE_md');
  assert.match(h, /<strong>重點<\/strong>/);
  assert.match(h, /<li>第一點<\/li>/);
  assert.ok(!/<script>alert/.test(h), 'script 被淨化');
});

test('七語骨架：介面字用各語言，內文保留中文並標 lang="zh-TW"＋「此則僅有中文」', () => {
  for (const lang of LANGS) {
    const h = renderAlert(lang, 'alertA-1');
    for (const k of ['travel.alert.body', 'travel.alert.source', 'travel.alert.related', 'travel.alert.areas', 'travel.alert.published'])
      assert.ok(h.includes(t(lang, k)), `${lang} ${k}`);
    assert.ok(h.includes('孟加拉測試內文第一段'), `${lang} 內文`);
    assert.ok(!/href="(null|undefined)?"/.test(h), lang);
    if (lang === 'zh-TW') continue;
    assert.notEqual(t(lang, 'travel.alert.body'), t('zh-TW', 'travel.alert.body'), `${lang} 有翻譯`);
    assert.ok(h.includes(t(lang, 'travel.alert.zhonly')), `${lang} 僅有中文提示`);
    assert.match(h, /class="ta-body"\s+lang="zh-TW"/);
    assert.ok(h.includes(`${base}${config.langs.find((l) => l.code === lang).path}/travel/BD/`), `${lang} 目的地頁連本語言`);
  }
  const en = renderAlert('en', 'alertA-1');
  assert.match(en, /<h1>Dengue[^<]*: Bangladesh, Zambia, Testland<\/h1>/);
});

test('meta／JSON-LD／.md 機讀版', () => {
  const m = alertTpl.meta(ctxOf('zh-TW', '/travel/alerts/alertA-1/'), propsOf('alertA-1'));
  assert.ok(m.title.startsWith('孟加拉/尚比亞-登革熱（測試）'));
  const sa = m.jsonLd.find((x) => x['@type'] === 'SpecialAnnouncement');
  assert.ok(sa, 'SpecialAnnouncement');
  assert.equal(sa.identifier, 'alertA-1');
  assert.equal(sa.inLanguage, 'zh-TW');
  assert.equal(sa.datePosted, '2026-10-05T09:00:00+08:00');
  assert.deepEqual(
    sa.spatialCoverage.map((c) => c.identifier),
    ['BD', 'ZM', 'ZZ'],
  );
  assert.ok(m.jsonLd.some((x) => x['@type'] === 'BreadcrumbList'));
  const md = alertTpl.markdown(ctxOf('zh-TW', '/travel/alerts/alertA-1/'), propsOf('alertA-1'));
  assert.match(md, /^# 孟加拉\/尚比亞-登革熱（測試）/);
  assert.ok(md.includes('ID：alertA-1') && md.includes('孟加拉測試內文第一段') && md.includes('## 建議'));
  const mdEn = alertTpl.markdown(ctxOf('en', '/travel/alerts/alertA-1/'), propsOf('alertA-1'));
  assert.ok(mdEn.includes(t('en', 'travel.alert.zhonly')));
});

test('/travel/ 列表：有 id 連站內頁、原始網址改小字「原始來源」、有 areas 列 chips；舊列（無 id）不連站內頁；撤下的不列', () => {
  const h = String(travel.render(ctxOf('zh-TW', '/travel/'), {}));
  const i = h.indexOf('id="tv-nw-h"');
  const news = h.slice(i, h.indexOf('</section>', i));
  assert.ok(news.includes(`<a href="${base}/travel/alerts/alertA-1/">登革熱</a>`), '連站內頁');
  assert.match(news, /class="tv-chips tv-news__areas"/);
  assert.ok(news.includes('class="tv-news__src"') && news.includes('原始來源'));
  assert.ok(news.includes('舊格式測試病'), '舊列照列');
  assert.ok(news.includes('epidemicId=legacy-1'), '舊列保留原始連結');
  assert.ok(!news.includes('撤下測試病'), '撤下的不列');
  assert.ok(news.includes('不合法id測試病') && !news.includes('/travel/alerts/bad'), '不合法 id 照列但不連站內頁');
  assert.ok(!news.includes('alertE_md'), '超過 30 天的不在列表');
  assert.ok(!/href="(null|undefined)?"/.test(h));
});

test('目的地頁（BD）相關列表也連站內頁並列 chips', () => {
  const c = site.master.countries.find((x) => x.iso2 === 'BD');
  for (const lang of ['zh-TW', 'en']) {
    const h = String(travel.render(ctxOf(lang, '/travel/BD/'), { country: c }));
    const pre = config.langs.find((l) => l.code === lang).path;
    assert.ok(h.includes(`href="${base}${pre}/travel/alerts/alertA-1/"`), lang);
    assert.match(h, /tv-news__areas/);
    assert.ok(!h.includes('撤下測試病'));
  }
});

test('feeds/travel-alerts.xml：近 30 天、guid＝id、link＝站內頁、description＝內文；llms.txt 與 /subscribe/ 頻道目錄都有', () => {
  const xml = buildFeeds(site)['feeds/travel-alerts.xml'];
  assert.ok(xml.startsWith('<?xml') && xml.includes('<rss version="2.0"'));
  assert.ok(xml.includes('<guid isPermaLink="false">alertA-1</guid>'));
  assert.ok(xml.includes(`<link>${config.siteUrl}${base}/travel/alerts/alertA-1/</link>`));
  assert.ok(xml.includes('孟加拉測試內文第一段。 尚比亞測試內文第二段。'));
  assert.ok(!xml.includes('alertB-withdrawn') && !xml.includes('bad id') && !xml.includes('alertE_md'), '撤下、不合法 id、超過 30 天的不進 RSS');
  assert.ok(buildLlms(site, 'zh-TW').includes('/feeds/travel-alerts.xml'));
  assert.ok(feedCatalog(site).some((f) => f.id === 'travel-alerts' && f.count === 1));
  assert.ok(TOPIC_IDS.includes('travel-alerts'));
  for (const lang of LANGS) assert.notEqual(t(lang, 'subscribe.topic.travel-alerts'), 'subscribe.topic.travel-alerts', lang);
});

test('sitemap：推算與實際頁面清單都含每則頁（七語），不含撤下的', async () => {
  const derived = buildSitemaps(site);
  assert.ok(derived['sitemap-pages.xml'].includes('/travel/alerts/alertA-1/'));
  assert.ok(derived['sitemap-en.xml'].includes('/en/travel/alerts/alertA-1/'));
  assert.ok(!derived['sitemap-pages.xml'].includes('alertB-withdrawn'));
  const pages = await collectPages(site);
  const mine = pages.filter((p) => p.path === '/travel/alerts/alertA-1/');
  assert.equal(mine.length, LANGS.length);
  assert.equal(mine[0].lastmod, '2026-10-06');
  assert.ok((await loadTemplates()).some((m) => m.name === 'public/travel-alert.mjs'));
});

test('快照沒有新欄位（現況）時：不產生頁、列表不連站內頁、RSS 頻道仍存在但為空', () => {
  const old = govern('2026-10-10', (s) => {
    s.snapshots = { ...s.snapshots, travelAlerts: { meta: { mode: 'live', dataDate: '2026-10-10' }, data: [ROWS[3]] } };
  });
  assert.deepEqual(alertTpl.pages(old), []);
  const h = String(travel.render(makeCtx(old, 'zh-TW', { path: '/travel/' }), {}));
  assert.ok(!h.includes('/travel/alerts/'));
  assert.ok(h.includes('舊格式測試病'));
  const xml = buildFeeds(old)['feeds/travel-alerts.xml'];
  assert.ok(xml.includes('<channel>') && !xml.includes('<item>'));
});
