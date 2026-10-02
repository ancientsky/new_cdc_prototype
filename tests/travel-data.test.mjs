// 旅遊疫情建議資料契約（ARCHITECTURE 12.1）：背景提醒分類、針對性等級、事件 kind 推法、變化摘要、國家主檔、API 輸出、答案引擎。
// 快照是真實官方資料（CI 每日覆寫），斷言盡量用相對條件；具名國家（KR、CD、VN）為 12.1 寫明的驗收案例。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  aggregateCountryLevels, classifyBackground, backgroundKeys, backgroundSummary, levelStats, eventKind, deriveEventKinds, buildEvents,
  deriveEventsFromLevels, changeSummary, attachRecentChanges, reaggregateSnapshots, BACKGROUND_SHARE, TARGETED_NONE, EVENT_KINDS, EVENTS_WINDOW_DAYS, LEVEL_TEXT,
} from '../scripts/fetch-data.mjs';
import { emitApi } from '../scripts/lib/emit-api.mjs';
import { createEngine } from '../src/client/answer/core.js';
import { govern, memWriter } from './helpers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJSON = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const levels = readJSON('data/snapshots/country-epid-level.json');
const events = readJSON('data/snapshots/country-epid-events.json');
const countries = readJSON('content/master/countries.json');
const REGIONS = ['中亞', '中南美', '中東', '北美', '南亞', '大洋洲', '東亞', '東南亞', '歐洲', '非洲'];
const row = (iso) => levels.data.find((r) => r.ISO2 === iso);
const shareOf = (disease, code) => levels.data.filter((r) => r.Diseases.some((d) => d.Disease === disease && d.LevelCode === code)).length / levels.data.length;

// ── 背景提醒 ──
test('背景提醒：新冠併發重症第一級涵蓋 ≥ 50% ⇒ 全部標 Background；茲卡（約 4 成）不是背景', () => {
  assert.equal(BACKGROUND_SHARE, 0.5);
  const covid = shareOf('新冠併發重症', 1);
  assert.ok(covid >= BACKGROUND_SHARE, `新冠併發重症 share=${covid}`);
  for (const r of levels.data) for (const d of r.Diseases) if (d.Disease === '新冠併發重症' && d.LevelCode === 1) assert.equal(d.Background, true, `${r.ISO2 ?? r.Country}`);
  const zika = shareOf('茲卡病毒感染症', 1);
  assert.ok(zika > 0.2 && zika < BACKGROUND_SHARE, `茲卡 share=${zika}`);
  for (const r of levels.data) for (const d of r.Diseases) if (d.Disease === '茲卡病毒感染症') assert.ok(!('Background' in d), `${r.ISO2} 茲卡不應標背景`);
  // meta.background 與資料一致
  const bg = levels.meta.background;
  assert.ok(Array.isArray(bg) && bg.length >= 1);
  const c = bg.find((b) => b.Disease === '新冠併發重症');
  assert.equal(c.LevelCode, 1);
  assert.equal(c.Level, LEVEL_TEXT[1]);
  assert.equal(c.countries, levels.data.filter((r) => r.Diseases.some((d) => d.Disease === '新冠併發重症' && d.LevelCode === 1)).length);
  assert.ok(c.countries > levels.data.length / 2 && c.share >= 0.5 && c.share <= 1);
  assert.match(c.since, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(c.latest >= c.since);
  assert.ok(c.Summary);
  assert.ok(!bg.some((b) => b.Disease === '茲卡病毒感染症'));
  assert.deepEqual(bg, backgroundSummary(levels.data));
  assert.equal(levels.meta.backgroundRule.share, 0.5);
  assert.ok(levels.meta.backgroundRule.note);
});

test('背景提醒（合成）：門檻 50% 含等號；列數太少不判定；分類冪等', () => {
  const mk = (n, withX) => Array.from({ length: n }, (_, i) => ({ ISO2: `Q${String.fromCharCode(65 + (i % 26))}${i}`, Diseases: i < withX ? [{ Disease: 'X', LevelCode: 1, StartDate: '2024-01-01' }] : [] }));
  assert.ok(backgroundKeys(mk(40, 20)).has('X\u00001'), '20/40 = 50% ⇒ 背景');
  assert.ok(!backgroundKeys(mk(40, 19)).size, '19/40 < 50%');
  assert.ok(!backgroundKeys(mk(4, 4)).size, '少於 20 列不判定');
  const rows = classifyBackground(mk(40, 30));
  assert.equal(rows[0].Diseases[0].Background, true);
  assert.equal(rows[0].TargetedLevelCode, 0);
  assert.equal(rows[0].TargetedLevel, TARGETED_NONE);
  const again = classifyBackground(structuredClone(rows));
  assert.deepEqual(again, rows);
});

// ── 針對性等級 ──
test('Targeted*：KR 0（只有背景提醒）、CD 3（伊波拉）、VN 2；既有 LevelCode 不變', () => {
  const kr = row('KR');
  assert.ok(kr.LevelCode >= 1, 'KR 含背景提醒的等級仍 ≥ 1（API 相容）');
  assert.equal(kr.TargetedLevelCode, 0);
  assert.equal(kr.TargetedLevel, TARGETED_NONE);
  assert.equal(kr.TargetedDisease, null);
  assert.equal(kr.TargetedStartDate, null);
  const cd = row('CD');
  assert.equal(cd.TargetedLevelCode, 3);
  assert.equal(cd.TargetedLevel, LEVEL_TEXT[3]);
  assert.match(cd.TargetedDisease, /伊波拉/);
  assert.ok(!/新冠併發重症/.test(cd.TargetedDisease), 'TargetedDisease 不含背景提醒');
  const vn = row('VN');
  assert.equal(vn.TargetedLevelCode, 2);
  for (const r of levels.data) {
    const tg = r.Diseases.filter((d) => !d.Background);
    assert.equal(r.TargetedLevelCode, tg.length ? Math.max(...tg.map((d) => d.LevelCode)) : 0, r.ISO2 ?? r.Country);
    assert.ok(r.TargetedLevelCode <= r.LevelCode);
    assert.equal(r.TargetedStartDate, tg.map((d) => d.StartDate).sort().at(-1) ?? null);
  }
  const st = levelStats(levels.data).targeted;
  assert.deepEqual(levels.meta.stats.targeted, st);
  assert.equal(st.level3 + st.level2 + st.level1 + st.none, levels.data.length);
  assert.ok(st.none > levels.meta.stats.none, '排除背景後，無針對性建議的國家變多');
});

test('aggregateCountryLevels 輸出就帶 Background／Targeted*（live 與 --reaggregate 同一路徑）', () => {
  const out = aggregateCountryLevels(levels.data, { countries, today: levels.meta.dataDate });
  assert.deepEqual(out.map((r) => [r.ISO2, r.TargetedLevelCode]), levels.data.map((r) => [r.ISO2, r.TargetedLevelCode]));
});

// ── 事件 kind 推法 ──
test('eventKind：五種 kind', () => {
  assert.equal(eventKind(null, 1), 'new');
  assert.equal(eventKind(0, 2), 'new');
  assert.equal(eventKind(1, 3), 'raised');
  assert.equal(eventKind(3, 2), 'lowered');
  assert.equal(eventKind(2, 0), 'lifted');
  assert.equal(eventKind(null, 0), 'lifted');
  assert.equal(eventKind(2, 2), 'renewed');
});

test('deriveEventKinds／buildEvents：官方原始列（含「解除」）→ 依（ISO2, 疾病, 區域）推 from／to／kind，依日期降冪', () => {
  const raw = [
    { areaDesc: '日本', areaDesc_EN: 'Japan', ISO3166: 'JP', alert_disease: '麻疹', severity_level: '第一級:注意(Watch)', effective: '2026-03-01T00:00:00+08:00', instruction: '提醒遵守當地的一般預防措施' },
    { areaDesc: '日本', ISO3166: 'JP', alert_disease: '麻疹', severity_level: '第二級:警示(Alert)', effective: '2026-05-01T00:00:00+08:00' },
    { areaDesc: '日本', ISO3166: 'JP', alert_disease: '麻疹', severity_level: '第一級:注意(Watch)', effective: '2026-07-01T00:00:00+08:00' },
    { areaDesc: '日本', ISO3166: 'JP', alert_disease: '麻疹', severity_level: '第一級:注意(Watch)', effective: '2026-08-01T00:00:00+08:00' },
    { areaDesc: '日本', ISO3166: 'JP', alert_disease: '麻疹', severity_level: '解除', effective: '2026-09-20T00:00:00+08:00' },
    { areaDesc: '中國大陸', ISO3166: 'CN', alert_disease: '新型A型流感', severity_level: '第二級:警示(Alert)', effective: '2026-09-01T00:00:00+08:00', areaDetail: '北京市' },
    { areaDesc: '中國大陸', ISO3166: 'CN', alert_disease: '新型A型流感', severity_level: '第一級:注意(Watch)', effective: '2026-09-02T00:00:00+08:00', areaDetail: '廣東省' },
    { areaDesc: '巴西', ISO3166: 'BR', alert_disease: '屈公病', severity_level: '第三級:警告(Warning)', effective: '2020-01-01T00:00:00+08:00' },
  ];
  const ev = buildEvents(raw, { countries, asOf: '2026-10-01' });
  assert.ok(!ev.some((e) => e.ISO2 === 'BR'), `超過 ${EVENTS_WINDOW_DAYS} 天的事件不輸出`);
  for (let i = 1; i < ev.length; i++) assert.ok(ev[i - 1].date >= ev[i].date, '依日期降冪');
  const jp = ev.filter((e) => e.ISO2 === 'JP').reverse();
  assert.deepEqual(jp.map((e) => [e.date, e.kind, e.from, e.to]), [
    ['2026-03-01', 'new', null, 1], ['2026-05-01', 'raised', 1, 2], ['2026-07-01', 'lowered', 2, 1], ['2026-08-01', 'renewed', 1, 1], ['2026-09-20', 'lifted', 1, 0],
  ]);
  const lifted = jp.at(-1);
  assert.equal(lifted.LevelCode, 0);
  assert.equal(lifted.Level, '解除');
  assert.equal(lifted.Country, '日本');
  assert.equal(jp[0].CountryEn, 'Japan');
  assert.equal(jp[0].Summary, '提醒遵守當地的一般預防措施');
  // 不同區域各自成鏈：北京第二級、廣東第一級都是 new
  const cn = ev.filter((e) => e.ISO2 === 'CN');
  assert.deepEqual(cn.map((e) => [e.Area, e.kind]).sort(), [['北京市', 'new'], ['廣東省', 'new']]);
  for (const e of ev) for (const k of ['date', 'ISO2', 'Country', 'Disease', 'LevelCode', 'Level', 'Url', 'kind', 'to']) assert.ok(e[k] != null, `${k}`);
  // 冪等：已推過的事件再推一次結果相同
  assert.deepEqual(deriveEventKinds(ev), ev);
});

test('changeSummary：近 30 天各 kind 筆數（含 asOf 當天，不含未來）', () => {
  const ev = [
    { date: '2026-09-30', kind: 'lifted' }, { date: '2026-09-15', kind: 'new' }, { date: '2026-09-01', kind: 'raised' },
    { date: '2026-08-31', kind: 'lowered' }, { date: '2026-10-02', kind: 'new' }, { date: '2026-10-01', kind: 'renewed' },
  ];
  assert.deepEqual(changeSummary(ev, { asOf: '2026-10-01' }), { new: 1, raised: 1, lowered: 0, lifted: 1, renewed: 1 });
});

test('快照 meta.changeSummary30：五個非負整數，與事件快照一致', () => {
  const cs = levels.meta.changeSummary30;
  assert.deepEqual(Object.keys(cs).sort(), [...EVENT_KINDS].sort());
  for (const k of EVENT_KINDS) assert.ok(Number.isInteger(cs[k]) && cs[k] >= 0, k);
  assert.match(levels.meta.changeSummaryAsOf, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(cs, changeSummary(events.data, { asOf: levels.meta.changeSummaryAsOf }));
  assert.equal(levels.meta.changeSummaryMode, events.meta.mode);
});

test('事件快照：meta 形狀、kind 合法、日期降冪且在 windowDays 內', () => {
  const m = events.meta;
  assert.ok(['live', 'derived'].includes(m.mode), m.mode);
  assert.equal(m.windowDays, EVENTS_WINDOW_DAYS);
  assert.match(m.sourceUrl, /CountryEpidLevel/);
  assert.ok(m.note);
  assert.equal(m.count, events.data.length);
  const asOf = levels.meta.dataDate;
  const since = new Date(Date.parse(`${asOf}T00:00:00Z`) - m.windowDays * 864e5).toISOString().slice(0, 10);
  for (let i = 0; i < events.data.length; i++) {
    const e = events.data[i];
    assert.ok(EVENT_KINDS.includes(e.kind), e.kind);
    assert.ok(e.to >= 0 && e.to <= 3 && e.to === e.LevelCode);
    assert.ok(e.from === null || (e.from >= 0 && e.from <= 3));
    assert.equal(e.kind, eventKind(e.from, e.to));
    assert.ok(e.date >= since && e.date <= asOf, e.date);
    if (i) assert.ok(events.data[i - 1].date >= e.date);
    assert.ok('Area' in e);
  }
  if (m.mode === 'derived') assert.ok(events.data.every((e) => e.kind === 'new'), 'derived 只有 new');
});

test('RecentChanges：近 90 天事件掛在各國（答案引擎用），無變化的國家不帶此欄', () => {
  const rows = structuredClone(levels.data);
  attachRecentChanges(rows, events.data, { asOf: levels.meta.dataDate });
  assert.deepEqual(rows, levels.data);
  for (const r of levels.data) if (r.RecentChanges) {
    assert.ok(r.RecentChanges.length >= 1);
    for (const c of r.RecentChanges) assert.ok(c.date && c.Disease && EVENT_KINDS.includes(c.kind));
  }
});

test('--reaggregate：冪等、保留 mode／fetchedAt／dataDate；無事件快照時 derived 反推 new 事件', () => {
  const r = reaggregateSnapshots({ level: structuredClone(levels), events: structuredClone(events), countries, now: '2026-10-02T00:00:00.000Z' });
  assert.deepEqual(r.level.data, levels.data);
  for (const k of ['mode', 'fetchedAt', 'dataDate', 'sourceUrl', 'stats', 'background', 'changeSummary30']) assert.deepEqual(r.level.meta[k], levels.meta[k], k);
  const d = reaggregateSnapshots({ level: structuredClone(levels), events: null, countries, now: '2026-10-02T00:00:00.000Z' });
  assert.equal(d.events.meta.mode, 'derived');
  assert.equal(d.events.meta.windowDays, EVENTS_WINDOW_DAYS);
  assert.deepEqual(d.events.data, deriveEventsFromLevels(d.level.data, { asOf: levels.meta.dataDate }));
  const cd3 = d.events.data.find((e) => e.ISO2 === 'CD' && e.LevelCode === 3);
  assert.ok(cd3 && cd3.kind === 'new' && cd3.from === null && cd3.date === row('CD').TargetedStartDate);
  assert.equal(d.level.meta.mode, levels.meta.mode, 'reaggregate 不改 mode');
});

// ── 國家主檔 ──
test('countries.json：涵蓋官方資料全部 ISO2、ISO2 唯一、全部有十個區域之一；原 60 國在前', () => {
  const isos = countries.map((c) => c.iso2);
  assert.equal(new Set(isos).size, isos.length, 'ISO2 唯一');
  for (const c of countries) {
    assert.match(c.iso2, /^[A-Z]{2}$/);
    assert.ok(c.name && c.nameEn, c.iso2);
    assert.ok(REGIONS.includes(c.region), `${c.iso2} region=${c.region}`);
  }
  for (const r of levels.data) if (r.ISO2) assert.ok(isos.includes(r.ISO2), `主檔缺 ${r.ISO2}`);
  assert.ok(countries.length >= 200, `${countries.length}`);
  assert.deepEqual(isos.slice(0, 6), ['JP', 'KR', 'CN', 'HK', 'MO', 'MN']);
  assert.equal(isos.indexOf('ET'), 59, '原 60 國順序不變（最後一國衣索比亞）');
  for (const r of levels.data) if (r.ISO2) assert.equal(r.Region, countries.find((c) => c.iso2 === r.ISO2).region, `${r.ISO2} Region 取自主檔`);
});

// ── API ──
test('API：/v1/country-changes.json、/v1/country-background.json 輸出且列入端點清單', () => {
  const site = govern('2026-10-01');
  site.searchIndex = { public: [], pro: [] };
  const { files, write } = memWriter();
  emitApi(site, write);
  const json = (p) => JSON.parse(files.get(p));
  const ch = json('v1/country-changes.json');
  assert.deepEqual(ch.data, events.data);
  assert.deepEqual(ch.meta.changeSummary30, levels.meta.changeSummary30);
  assert.equal(ch.meta.provenance.mode, events.meta.mode);
  const bg = json('v1/country-background.json');
  assert.deepEqual(bg.data, levels.meta.background);
  assert.equal(bg.meta.backgroundRule.share, 0.5);
  const lv = json('v1/country-levels.json');
  assert.ok(lv.data.every((r) => 'TargetedLevelCode' in r));
  const idx = json('v1/index.json').data.map((e) => e.path);
  for (const p of ['/v1/country-changes.json', '/v1/country-background.json']) assert.ok(idx.includes(p), p);
  assert.ok(files.has('openapi.json') ? JSON.parse(files.get('openapi.json')).paths['/v1/country-changes.json'] : true);
});

// ── 答案引擎 ──
test('答案引擎：無針對性建議說「目前無針對性旅遊疫情建議」＋一句全球背景提醒；逐病清單不列背景提醒', () => {
  const e = createEngine({ countries, travel: levels.data, today: '2026-10-01' });
  const kr = e.answer('韓國現在有旅遊疫情建議嗎？');
  const kt = kr.sentences.map((s) => s.text).join('');
  assert.equal(kr.refused, false);
  assert.equal(kr.intent, 'travel');
  assert.match(kt, /韓國目前無針對性旅遊疫情建議，請遵守一般預防措施/);
  assert.match(kt, /全球背景提醒：新冠併發重症第一級/);
  assert.ok(kr.travel[0].entries.every((x) => !x.diseaseNames.includes('新冠併發重症')));
  const cd = e.answer('去剛果民主共和國安全嗎？');
  const ct = cd.sentences.map((s) => s.text).join('');
  assert.match(ct, /伊波拉/);
  assert.match(ct, /第三級/);
  assert.ok(!cd.travel[0].entries.some((x) => x.diseaseNames.includes('新冠併發重症')));
});

test('答案引擎：「最近哪些國家解除」由 RecentChanges 彙整；沒有也明說', () => {
  const base = structuredClone(levels.data);
  const jp = base.find((r) => r.ISO2 === 'JP');
  jp.RecentChanges = [{ date: '2026-09-20', Disease: '麻疹', kind: 'lifted', from: 1, to: 0 }];
  const e = createEngine({ countries, travel: base, today: '2026-10-01' });
  const r = e.answer('最近有哪些國家的旅遊疫情建議解除？');
  assert.equal(r.intent, 'travel');
  assert.equal(r.refused, false);
  const t = r.sentences.map((s) => s.text).join('');
  assert.match(t, /近 30 天解除旅遊疫情建議的有：日本（麻疹，2026-09-20）/);
  assert.ok(r.sources.some((s) => s.contentId === 'travel.changes' && s.url === '/travel/'));
  const none = createEngine({ countries, travel: levels.data.map(({ RecentChanges, ...x }) => x), today: '2026-10-01' }).answer('最近有哪些國家的旅遊疫情建議解除？');
  assert.match(none.sentences.map((s) => s.text).join(''), /沒有解除的旅遊疫情建議/);
});
