// 國際旅遊疫情建議等級：fetch 聚合、等級標準化、快照分布、/travel/ 模板輸出。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { aggregateCountryLevels, normalizeLevel, normalizeTravelRow, toISODate, levelStats, LEVEL_TEXT, isStaleNotice, COVID_NOTICES_LIFTED_AT, assertPlausibleLevels, LEVEL_PLAUSIBLE_MAX } from '../scripts/fetch-data.mjs';
import { makeCtx } from '../scripts/lib/pages.mjs';
import * as travel from '../src/templates/public/travel.mjs';
import { t } from '../src/client/i18n.js';
import { govern } from './helpers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJSON = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const levels = readJSON('data/snapshots/country-epid-level.json');
const news = readJSON('data/snapshots/travel-epidemic.json');
const countries = readJSON('content/master/countries.json');
const str = (r) => String(r);

test('normalizeLevel：官方等級文字 → 0–3', () => {
  assert.equal(normalizeLevel('第一級：注意(Watch)'), 1);
  assert.equal(normalizeLevel('第二級:警示(Alert)'), 2);
  assert.equal(normalizeLevel('第三級：警告(Warning)'), 3);
  assert.equal(normalizeLevel('Level 2: Alert'), 2);
  assert.equal(normalizeLevel('Watch'), 1);
  assert.equal(normalizeLevel('無旅遊疫情建議'), 0);
  assert.equal(normalizeLevel(3), 3);
  assert.equal(normalizeLevel('2'), 2);
  assert.equal(normalizeLevel(''), null);
  assert.equal(normalizeLevel('不明'), null);
});

test('toISODate：斜線、民國年、時間戳', () => {
  assert.equal(toISODate('2025/8/5'), '2025-08-05');
  assert.equal(toISODate('114/08/12'), '2025-08-12');
  assert.equal(toISODate('2026-09-01T08:00:00+08:00'), '2026-09-01');
});

test('normalizeTravelRow：中文欄位對應並標準化等級', () => {
  const r = normalizeTravelRow({ '國家/地區': '沙烏地阿拉伯', 疾病: '中東呼吸症候群冠狀病毒感染症', 等級: '第二級:警示(Alert)', 發布日期: '2015/6/1', 英文國名: 'Saudi Arabia', ISO: 'sa' });
  assert.equal(r.Country, '沙烏地阿拉伯');
  assert.equal(r.CountryEn, 'Saudi Arabia');
  assert.equal(r.ISO2, 'SA');
  assert.equal(r.LevelCode, 2);
  assert.equal(r.Level, LEVEL_TEXT[2]);
  assert.equal(r.StartDate, '2015-06-01');
  const n = normalizeTravelRow({ 疾病: '登革熱', 國家: '越南', 地區: '東南亞', 摘要: '病例增加', 發布日: '2026/9/29' });
  assert.equal(n.Disease, '登革熱');
  assert.equal(n.Country, '越南');
  assert.equal(n.Region, '東南亞');
  assert.equal(n.Summary, '病例增加');
  assert.equal(n.StartDate, '2026-09-29');
});

test('aggregateCountryLevels：國家 × 疾病 → 每國一筆，Diseases[] 合併並補主檔無建議國', () => {
  const rows = [
    { '國家/地區': '中國大陸', 疾病: '屈公病', 等級: '第一級：注意(Watch)', 發布日期: '2025-07-01' },
    { '國家/地區': '中國大陸', 疾病: '屈公病', 等級: '第二級：警示(Alert)', 發布日期: '2025/8/12' },
    { '國家/地區': '中國大陸', 疾病: '新型A型流感', 等級: '第一級：注意(Watch)', 發布日期: '2024-01-10' },
    { '國家/地區': '日本', 疾病: '麻疹', 等級: '第一級：注意(Watch)', 發布日期: '2026-05-11', ISO: 'JP' },
  ];
  const out = aggregateCountryLevels(rows, { countries });
  assert.equal(out.length, countries.length, '涵蓋主檔全部國家');
  const cn = out.find((r) => r.ISO2 === 'CN');
  assert.equal(cn.LevelCode, 2);
  assert.equal(cn.Diseases.length, 2, '同病合併取最高等級');
  assert.deepEqual(cn.Diseases.map((d) => [d.Disease, d.LevelCode, d.StartDate]), [['屈公病', 2, '2025-08-12'], ['新型A型流感', 1, '2024-01-10']]);
  assert.equal(cn.Disease, '屈公病、新型A型流感');
  assert.equal(cn.StartDate, '2025-08-12');
  const kr = out.find((r) => r.ISO2 === 'KR');
  assert.equal(kr.LevelCode, 0);
  assert.equal(kr.Level, '無旅遊疫情建議');
  assert.deepEqual(kr.Diseases, []);
  for (const r of out) for (const k of ['ISO2', 'Country', 'Level', 'LevelCode', 'StartDate', 'Summary', 'Diseases']) assert.ok(k in r, `${r.ISO2} 缺 ${k}`);
});

test('isStaleNotice：官方匯出檔的歷史紀錄（COVID 2020、逾期第三級、已解除）被排除；第一、二級長期建議保留', () => {
  const today = '2026-10-01';
  assert.equal(COVID_NOTICES_LIFTED_AT, '2023-05-01');
  assert.equal(isStaleNotice({ Disease: '嚴重特殊傳染性肺炎', LevelCode: 3, StartDate: '2020-03-21' }, {}, today), true);
  assert.equal(isStaleNotice({ Disease: 'COVID-19', LevelCode: 1, StartDate: '2022-12-01' }, {}, today), true);
  assert.equal(isStaleNotice({ Disease: '麻疹', LevelCode: 3, StartDate: '2024-01-01' }, {}, today), true);
  assert.equal(isStaleNotice({ Disease: '中東呼吸症候群冠狀病毒感染症', LevelCode: 2, StartDate: '2015-06-01' }, {}, today), false, '第二級可長期存在（沙國 MERS）');
  assert.equal(isStaleNotice({ Disease: '麻疹', LevelCode: 2, StartDate: '2025-06-01' }, {}, today), false);
  assert.equal(isStaleNotice({ Disease: '登革熱', LevelCode: 1, StartDate: '2019-08-01' }, {}, today), false, '第一級可長期存在');
  assert.equal(isStaleNotice({ Disease: '麻疹', LevelCode: 1, StartDate: '2026-01-01' }, { EndDate: '2026-05-01' }, today), true);
  assert.equal(isStaleNotice({ Disease: '麻疹', LevelCode: 1, StartDate: '2026-01-01' }, { 狀態: '已解除' }, today), true);
  assert.equal(isStaleNotice({ Disease: '麻疹', LevelCode: 1, StartDate: '2026-01-01' }, { Status: 'Active' }, today), false);
});

test('aggregateCountryLevels（live 形狀）：韓國 2020 年 COVID 第三級不再出現，僅留現行第一級', () => {
  const rows = [
    { Country: '韓國', ISO2: 'KR', Disease: '嚴重特殊傳染性肺炎', Level: '第三級：警告(Warning)', StartDate: '2020/03/21' },
    { Country: '韓國', ISO2: 'KR', Disease: '麻疹', Level: '第一級：注意(Watch)', StartDate: '2026/07/01' },
  ];
  const out = aggregateCountryLevels(rows, { today: '2026-10-01' });
  const kr = out.find((c) => c.ISO2 === 'KR');
  assert.equal(kr.LevelCode, 1);
  assert.deepEqual(kr.Diseases.map((d) => d.Disease), ['麻疹']);
});

test('aggregateCountryLevels（事件日誌）：同國同病最新一則為「解除」⇒ 不列；最新為較低等級 ⇒ 以最新為準', () => {
  const rows = [
    { areaDesc: '日本', ISO3166: 'JP', alert_disease: '麻疹', severity_level: '第一級:注意(Watch)', effective: '2024-03-01T00:00:00+08:00' },
    { areaDesc: '日本', ISO3166: 'JP', alert_disease: '麻疹', severity_level: '解除', effective: '2024-09-01T00:00:00+08:00' },
    { areaDesc: '日本', ISO3166: 'JP', alert_disease: '麻疹', severity_level: '第一級:注意(Watch)', effective: '2026-05-11T00:00:00+08:00' },
    { areaDesc: '巴西', ISO3166: 'BR', alert_disease: '屈公病', severity_level: '第三級:警告(Warning)', effective: '2023-09-06T00:00:00+08:00' },
    { areaDesc: '巴西', ISO3166: 'BR', alert_disease: '屈公病', severity_level: '解除', effective: '2024-03-01T00:00:00+08:00' },
    { areaDesc: '帛琉', ISO3166: 'PW', alert_disease: '新冠併發重症', severity_level: '第三級:警告(Warning)', effective: '2022-01-25T00:00:00+08:00' },
    { areaDesc: '帛琉', ISO3166: 'PW', alert_disease: '新冠併發重症', severity_level: '第二級:警示(Alert)', effective: '2022-06-01T00:00:00+08:00' },
    { areaDesc: '沙烏地阿拉伯', ISO3166: 'SA', alert_disease: '中東呼吸症候群冠狀病毒感染症', severity_level: '第二級:警示(Alert)', effective: '2015-06-09T00:00:00+08:00' },
  ];
  const out = aggregateCountryLevels(rows, { today: '2026-10-01' });
  const by = (iso) => out.find((c) => c.ISO2 === iso);
  assert.equal(by('JP').LevelCode, 1, '解除後再發布 ⇒ 現行第一級');
  assert.equal(by('JP').Diseases[0].StartDate, '2026-05-11');
  assert.equal(by('BR').LevelCode, 0, '最新為解除 ⇒ 無建議');
  assert.equal(by('PW').LevelCode, 0, '最新為 2022 年 COVID 第二級 ⇒ 2023-05-01 前的 COVID 建議視為歷史');
  assert.equal(by('SA').LevelCode, 2, '長期第二級（無解除）保留');
});

test('assertPlausibleLevels：快照通過；上百個第二級國家（歷史警示直接聚合）被拒，錯誤附 stats', () => {
  assert.ok(assertPlausibleLevels(levels.data).level1 >= 0);
  const many = Array.from({ length: LEVEL_PLAUSIBLE_MAX.level2 + 1 }, (_, i) => ({ ISO2: `X${i}`, LevelCode: 2, Diseases: [{ Disease: '茲卡病毒感染症', LevelCode: 2 }] }));
  assert.throws(() => assertPlausibleLevels(many), (e) => e.code === 'IMPLAUSIBLE_LEVELS' && e.stats.level2 === many.length);
});

test('aggregateCountryLevels 對快照是冪等的（live 與快照形狀一致）', () => {
  assert.deepEqual(aggregateCountryLevels(levels.data, { countries }), levels.data);
});

test('快照：等級分布在合理性閘門內（第三級 ≤5、第二級 ≤60、第一級 ≤250），meta.stats 一致', () => {
  const s = levelStats(levels.data);
  assert.ok(s.level3 <= LEVEL_PLAUSIBLE_MAX.level3, `level3=${s.level3}`);
  assert.ok(s.level2 <= LEVEL_PLAUSIBLE_MAX.level2 && s.level2 >= 1, `level2=${s.level2}`);
  assert.ok(s.level1 <= LEVEL_PLAUSIBLE_MAX.level1 && s.level1 >= 1, `level1=${s.level1}`);
  assert.deepEqual(levels.meta.stats, s);
  const iso = new Set(levels.data.map((r) => r.ISO2));
  for (const c of countries) assert.ok(iso.has(c.iso2), `快照缺 ${c.iso2}`);
  for (const r of levels.data) {
    if (r.LevelCode === 0) { assert.equal(r.Level, '無旅遊疫情建議'); assert.deepEqual(r.Diseases, []); }
    for (const d of r.Diseases) { assert.ok(d.StartDate && d.Summary && d.Url, `${r.ISO2} ${d.Disease}`); assert.equal(normalizeLevel(d.Level), d.LevelCode); }
  }
  assert.equal(levels.data.find((r) => r.ISO2 === 'SA').LevelCode, 2);
  assert.ok(levels.data.find((r) => r.ISO2 === 'JP').Diseases.some((d) => d.Disease === '麻疹'), '評估集 TR009 需要日本麻疹');
});

test('快照 meta：levelDefinitions、sourcePage、dataDate、provenance', () => {
  const m = levels.meta;
  assert.equal(m.mode, 'snapshot');
  assert.ok(m.note);
  assert.match(m.sourcePage, /InternationalEpidemicLevel/);
  assert.match(m.dataDate, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(m.levelDefinitions.map((d) => [d.code, d.color]), [[1, 'watch'], [2, 'alert'], [3, 'warning']]);
  for (const d of m.levelDefinitions) assert.ok(d.name && d.nameEn && d.description);
  assert.equal(m.levelDefinitions[2].description, '避免所有非必要旅遊');
});

test('國際重要疫情資訊：20–30 則、近 30 天、欄位齊全', () => {
  assert.ok(news.data.length >= 20 && news.data.length <= 30);
  const ref = Date.parse(`${news.meta.dataDate}T00:00:00Z`);
  for (const r of news.data) {
    for (const k of ['Disease', 'Country', 'ISO2', 'Region', 'StartDate', 'Summary', 'Level', 'LevelCode']) assert.ok(r[k] != null, `${r.ISO2} 缺 ${k}`);
    assert.ok(ref - Date.parse(`${r.StartDate}T00:00:00Z`) <= 30 * 864e5, r.StartDate);
    const lv = levels.data.find((x) => x.ISO2 === r.ISO2)?.Diseases.find((d) => d.Disease === r.Disease)?.LevelCode ?? 0;
    assert.equal(r.LevelCode, lv, `${r.ISO2} ${r.Disease} 等級應與等級表一致`);
  }
});

test('travel 模板：/travel/ 依等級分段、不列全部國家大表', async () => {
  const site = govern();
  const html = str(travel.render(makeCtx(site, 'zh-TW', { path: '/travel/' }), {}));
  assert.match(html, /出國前先看目的地有沒有旅遊疫情建議/);
  for (const k of ['第一級：注意（Watch）', '第二級：警示（Alert）', '第三級：警告（Warning）', '提醒遵守當地的一般預防措施', '避免所有非必要旅遊']) assert.ok(html.includes(k), k);
  assert.match(html, /目前無/, '第三級 0 筆顯示目前無');
  assert.match(html, /共 3 國 3 項/);
  assert.match(html, /國際重要疫情資訊（近 30 天）/);
  assert.ok(html.includes('href="/new_cdc_prototype/travel/SA/"') || html.includes('/travel/SA/'));
  assert.ok(!/c-table--travel|c-countrylist/.test(html), '不再輸出全國家大表');
  assert.ok(html.includes('/v1/country-levels.json') && html.includes('/v1/travel-alerts.json'));
  assert.ok(html.includes('InternationalEpidemicLevel'));
  const news10 = html.split('class="tv-news"')[1].split('</ol>')[0].match(/<li>/g).length;
  assert.equal(news10, 10, '近 30 天列表最多 10 則，其餘收在「更多」');
});

test('travel 模板：無建議國平靜、有建議國（SA、JP）列疾病等級', () => {
  const site = govern();
  const noneIso = levels.data.find((r) => r.LevelCode === 0 && site.master.countries.some((c) => c.iso2 === r.ISO2))?.ISO2;
  const sa = site.master.countries.find((c) => c.iso2 === 'SA');
  const jp = site.master.countries.find((c) => c.iso2 === 'JP');
  if (noneIso) {
    const kr = site.master.countries.find((c) => c.iso2 === noneIso);
    const k = str(travel.render(makeCtx(site, 'zh-TW', { path: `/travel/${noneIso}/` }), { country: kr }));
    assert.match(k, /目前無旅遊疫情建議/);
    assert.match(k, /勤洗手/);
    assert.match(k, /旅遊醫學門診/);
    assert.ok(!/tv-lv--/.test(k.split('tv-card')[1] ?? ''), '無建議不做等級標籤');
    assert.ok(!/行前準備/.test(k), '無建議頁保持簡短');
  }
  const s = str(travel.render(makeCtx(site, 'zh-TW', { path: '/travel/SA/' }), { country: sa }));
  assert.match(s, /第二級：警示/);
  assert.match(s, /中東呼吸症候群冠狀病毒感染症/);
  assert.match(s, /駱駝/);
  assert.match(s, /發布日/);
  assert.match(s, /international-vaccination-certificate/);
  const j = str(travel.render(makeCtx(site, 'zh-TW', { path: '/travel/JP/' }), { country: jp }));
  assert.match(j, /麻疹/);
  assert.match(j, /MMR/);
  const en = str(travel.render(makeCtx(site, 'en', { path: '/en/travel/' }), {}));
  assert.match(en, /Level 1: Watch/);
  assert.match(en, /Most countries have none at present/);
  assert.match(en, /Dengue/);
});

test('i18n：travel.* 三級名稱七語齊備', () => {
  for (const lang of ['zh-TW', 'en', 'ja', 'tl', 'vi', 'id', 'th']) {
    for (const k of ['travel.level.1', 'travel.level.2', 'travel.level.3', 'travel.level.1.d', 'travel.level.3.d', 'travel.result.none.t']) {
      assert.notEqual(t(lang, k), k, `${lang} ${k}`);
    }
  }
  assert.equal(t('zh-TW', 'travel.level.3.d'), '避免所有非必要旅遊');
});
