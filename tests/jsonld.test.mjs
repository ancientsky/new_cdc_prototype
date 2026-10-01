// JSON-LD（附錄 A）測試：各型別、cdc: 擴充、麵包屑、WebSite SearchAction、資料集 data.gov.tw 相容欄位、態勢層。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeUrl } from '../scripts/lib/render.mjs';
import { jsonLdFor, orgJsonLd, websiteJsonLd, breadcrumbJsonLd, situationJsonLd, travelJsonLd } from '../scripts/lib/jsonld.mjs';
import { govern, config } from './helpers.mjs';

const site = govern();
const ctx = (lang = 'zh-TW', path = '/') => ({ site, lang, url: makeUrl(lang), path, today: site.today });
const one = (id, lang) => jsonLdFor(ctx(lang), site.byId.get(id))[0];

test('型別對應：疾病 MedicalWebPage+MedicalCondition、Q&A FAQPage、新聞 NewsArticle、文件 DigitalDocument、資料集 Dataset、澄清 ClaimReview', () => {
  const d = one('disease.dengue');
  assert.equal(d['@type'], 'MedicalWebPage'); assert.equal(d.about['@type'], 'MedicalCondition');
  assert.deepEqual(d.about.code.map((c) => c.codeValue), ['A90', 'A91']);
  assert.equal(d.lastReviewed, site.byId.get('disease.dengue').reviewedAt);
  assert.equal(d.about['cdc:notifyWithinHours'], 24);
  assert.equal(one('faq.measles-mmr-adult-who')['@type'], 'FAQPage');
  assert.equal(one('faq.measles-mmr-adult-who').mainEntity[0].acceptedAnswer['@type'], 'Answer');
  const n = one('news.2025-01-09-mmr-adults-measles');
  assert.equal(n['@type'], 'NewsArticle'); assert.ok(n.correction?.length, '加註以 CorrectionComment 表示');
  const old = one('doc.mmr-recommendation.2019-05-14');
  assert.equal(old['@type'], 'DigitalDocument'); assert.equal(old['cdc:isCurrent'], false); assert.equal(old.expires, '2025-04-16');
  assert.equal(one('clar.2026-09-anti-epidemic-team-scam')['@type'], 'ClaimReview');
});

test('cdc: 治理擴充欄位（owner、reviewedAt、nextReviewAt、version、whitelist）與 @context', () => {
  const d = one('doc.mmr-recommendation.2025-04-16');
  for (const k of ['cdc:owner', 'cdc:reviewedAt', 'cdc:nextReviewAt', 'cdc:version', 'cdc:aiWhitelist', 'cdc:isCurrent', 'cdc:lifecycle']) assert.ok(k in d, k);
  assert.equal(d['cdc:owner'], '預防接種組');
  assert.equal(d['@context'][0], 'https://schema.org');
  assert.ok(d['@context'][1].cdc.endsWith('/developers/#vocab-'));
  assert.equal(d.license, 'https://data.gov.tw/license');
});

test('資料集：data.gov.tw 相容（identifier、keywords、spatialCoverage 臺灣、temporalCoverage、isAccessibleForFree）', () => {
  const ds = one('dataset.dengue-daily');
  assert.equal(ds['@type'], 'Dataset');
  assert.ok(ds.identifier.includes('dataset.dengue-daily'));
  assert.ok(ds.keywords.length);
  assert.equal(ds.spatialCoverage.name, '臺灣');
  const pts = site.byId.get('dataset.dengue-daily').series?.points ?? [];
  if (pts.length) assert.equal(ds.temporalCoverage, `${pts[0].t}/${pts.at(-1).t}`); else assert.ok(ds.temporalCoverage);
  assert.equal(ds.isAccessibleForFree, true);
  assert.ok(ds.distribution.length >= 1);
});

test('多語：英文頁取 i18n 標題、inLanguage 與網址帶語言前綴', () => {
  const d = one('doc.mmr-recommendation.2025-04-16', 'en');
  assert.equal(d.inLanguage, 'en'); assert.match(d.name, /^Current MMR/);
  assert.ok(d.url.includes(`${config.basePath}/en/documents/`));
});

test('GovernmentOrganization、WebSite＋SearchAction、BreadcrumbList、態勢層、旅遊', () => {
  const org = orgJsonLd(ctx());
  assert.equal(org['@type'], 'GovernmentOrganization'); assert.equal(org.telephone, '1922');
  const ws = websiteJsonLd(ctx());
  assert.equal(ws.potentialAction['@type'], 'SearchAction');
  assert.match(ws.potentialAction.target.urlTemplate, /\/ask\/\?q=\{search_term_string\}$/);
  const bc = breadcrumbJsonLd(ctx(), [{ name: '首頁', path: '/' }, { name: '疾病', path: '/diseases/' }, { name: '登革熱' }]);
  assert.equal(bc['@type'], 'BreadcrumbList'); assert.deepEqual(bc.itemListElement.map((x) => x.position), [1, 2, 3]);
  assert.equal(bc.itemListElement[1].item, `${config.siteUrl}${config.basePath}/diseases/`);
  const bc2 = breadcrumbJsonLd(ctx('en'), [{ label: 'Home', href: '/' }, { label: 'Diseases', href: '/diseases/' }]);
  assert.equal(bc2.itemListElement[1].name, 'Diseases'); assert.equal(bc2.itemListElement[1].item, `${config.siteUrl}${config.basePath}/en/diseases/`);
  const s = situationJsonLd(ctx(), site.situation);
  assert.equal(s['@type'], 'Dataset'); assert.equal(s['cdc:dataDate'], site.situation.dataDate);
  assert.equal(s['cdc:situation'].length, site.situation.items.length);
  const tv = travelJsonLd(ctx(), { iso2: 'JP', name: '日本', nameEn: 'Japan' }, [{ disease: 'disease.measles', level: 1 }]);
  assert.ok(tv.url.endsWith('/travel/JP/'));
});
