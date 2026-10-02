// 出國與入境（第四輪）模板：查目的地、近 30 天變化、背景提醒列、針對性等級表、目的地頁（KR／CD／SA）、多語。
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeCtx } from '../scripts/lib/pages.mjs';
import * as travel from '../src/templates/public/travel.mjs';
import { t } from '../src/client/i18n.js';
import { govern } from './helpers.mjs';

const str = (r) => String(r);
const site = govern();
const country = (iso) => site.master.countries.find((c) => c.iso2 === iso);
const page = (lang, iso) => str(travel.render(makeCtx(site, lang, { path: iso ? `/travel/${iso}/` : '/travel/' }), iso ? { country: country(iso) } : {}));
const section = (html, startMarker, endMarker) => { const a = html.indexOf(startMarker); const b = html.indexOf(endMarker, a + 1); return html.slice(a, b < 0 ? undefined : b); };

test('/travel/：查目的地在最上，之後是近 30 天變化、背景提醒、針對性等級表', () => {
  const h = page('zh-TW');
  const order = ['id="tv-lookup"', 'id="tv-ch-h"', 'id="tv-bg-h"', 'id="tv-tb-h"', 'id="tv-nw-h"'].map((k) => h.indexOf(k));
  assert.ok(order.every((i) => i > 0), `缺區塊：${order}`);
  assert.deepEqual([...order].sort((a, b) => a - b), order, '區塊順序：查目的地 → 變化 → 背景提醒 → 等級表 → 疫情資訊');
  assert.match(h, /查目的地/);
  assert.match(h, /近 30 天變化/);
  assert.match(h, /tv-chg__n--lifted/, '四個數字含「解除」（綠色）');
  for (const k of ['新增', '調升', '調降', '解除']) assert.ok(h.includes(`<span>${k}</span>`), k);
  assert.match(h, /全球背景提醒/);
  assert.match(h, /新冠併發重症：第一級/);
  assert.match(h, /wm-fig|world|wm-svg/, '世界地圖已輸出');
  assert.ok(h.includes('title="自 '), '等級表 chip 帶「自 YYYY-MM-DD」');
});

test('/travel/：等級表只列針對性建議，背景疾病（新冠併發重症）不逐國列', () => {
  const h = page('zh-TW');
  const table = section(h, 'id="tv-tb-h"', 'id="tv-nw-h"');
  assert.ok(table.length > 1000);
  assert.ok(!table.includes('新冠併發重症'), '等級表不含背景疾病');
  assert.match(table, /伊波拉病毒感染/);
  assert.ok(!table.includes('href="null"'));
  const l1 = section(table, 'id="tv-b1"', '</section>');
  assert.ok(!l1.includes('新冠'), '第一級逐國列不含新冠');
});

test('/travel/：近 30 天事件清單最多 10 則，其餘收合；無事件資料時留一行提示', () => {
  const h = page('zh-TW');
  const shown = (section(h, 'class="tv-evs"', '</ol>').match(/<li class="tv-ev /g) ?? []).length;
  assert.ok(shown <= 10);
  const empty = govern('2026-10-01', (s) => {
    s.snapshots = { ...s.snapshots, countryEvents: undefined, countryLevels: { ...s.snapshots.countryLevels, meta: { ...s.snapshots.countryLevels.meta, changeSummary30: undefined } } };
  });
  const hh = str(travel.render(makeCtx(empty, 'zh-TW', { path: '/travel/' }), {}));
  assert.match(hh, /尚無變化資料/);
  assert.ok(!/class="tv-evs"/.test(hh));
});

test('changeData／travelStats：事件快照決定數字；缺快照退回', () => {
  const evs = [
    { date: '2026-09-20', ISO2: 'KR', Country: '韓國', Disease: '登革熱', kind: 'lifted', from: 2, to: 0 },
    { date: '2026-09-25', ISO2: 'JP', Country: '日本', Disease: '麻疹', kind: 'raised', from: 1, to: 2 },
    { date: '2026-01-01', ISO2: 'JP', Country: '日本', Disease: '麻疹', kind: 'new', from: null, to: 1 },
    { date: '2026-09-26', ISO2: 'JP', Country: '日本', Disease: '麻疹', kind: 'renewed', from: 2, to: 2 },
  ];
  const s = govern('2026-10-01', (x) => { x.snapshots = { ...x.snapshots, countryEvents: { meta: { mode: 'live' }, data: evs } }; });
  const cd = travel.changeData(s, '2026-10-01');
  assert.deepEqual(cd.counts, { new: 0, raised: 1, lowered: 0, lifted: 1 });
  assert.equal(cd.list[0].iso2, 'JP', '日期新到舊');
  const st = travel.travelStats(s, '2026-10-01');
  assert.ok(st.withAdv > 0 && st.change.lifted === 1);
  const none = govern('2026-10-01', (x) => { x.snapshots = { ...x.snapshots, countryEvents: undefined }; });
  const cd2 = travel.changeData(none, '2026-10-01');
  assert.ok(cd2 === null || cd2.summaryOnly);
});

test('KR 目的地頁：無針對性建議、平靜（綠勾，無等級標籤），結構與有建議頁相同', () => {
  const h = page('zh-TW', 'KR');
  assert.match(h, /目前無針對性旅遊疫情建議/);
  assert.match(h, /tv-card--none/);
  assert.match(h, /勤洗手/);
  assert.match(h, /旅程三階段/);
  for (const k of ['出發前', '旅途中', '返國後']) assert.ok(h.includes(k), k);
  assert.match(h, /21 天內/);
  assert.match(h, /1922/);
  assert.match(h, /tv-bgline/, '背景提醒只有一行淡字');
  assert.ok(!/tv-lv--/.test(h.split('tv-card')[1] ?? ''), '不做等級標籤');
  assert.ok(!h.includes('href="null"') && !h.includes('undefined'));
});

test('CD 目的地頁：第三級、伊波拉、持續時間、旅程三階段（依傳播途徑與疫苗）', () => {
  const h = page('zh-TW', 'CD');
  assert.match(h, /第三級：警告/);
  assert.match(h, /伊波拉病毒感染/);
  assert.match(h, /避免至當地所有非必要旅遊/);
  assert.match(h, /發布日/);
  assert.match(h, /自 \d{4}-\d{2}-\d{2} 起|自 \d{4} 年起/);
  for (const k of ['出發前', '旅途中', '返國後']) assert.ok(h.includes(k), k);
  assert.match(h, /避免接觸病人的血液、體液/, '伊波拉＝體液接觸');
  assert.match(h, /只喝瓶裝水或煮沸的水/, '霍亂／小兒麻痺＝食水');
  assert.match(h, /避免所有非必要旅遊/);
  assert.match(h, /international-vaccination-certificate/);
  assert.ok(!/href="(null|undefined)"/.test(h));
});

test('SA 目的地頁：MERS 超過 3 年標「長期建議」並含動物接觸提醒', () => {
  const h = page('zh-TW', 'SA');
  assert.match(h, /長期建議/);
  assert.match(h, /自 2022 年起|自 \d{4} 年起/);
  assert.match(h, /中東呼吸症候群冠狀病毒感染症/);
  assert.match(h, /不接觸、不餵食動物/);
});

test('routesOf：傳播途徑對照與關鍵字後備', () => {
  const m = (id) => site.master.diseases.find((d) => d.id === id);
  assert.deepEqual([...travel.routesOf(m('disease.dengue'), '登革熱')], ['vector']);
  assert.ok(travel.routesOf(m('disease.measles'), '麻疹').has('resp'));
  assert.ok(travel.routesOf(m('disease.mers'), '中東呼吸症候群冠狀病毒感染症').has('animal'));
  assert.ok(travel.routesOf(m('disease.cholera'), '霍亂').has('food'));
  assert.ok(travel.routesOf(m('disease.ebola'), '伊波拉').has('fluid'));
  assert.ok(travel.routesOf(null, '黃熱病').has('vector'), '無主檔時用疾病名關鍵字');
  assert.equal(travel.routesOf(null, '不明').size, 0);
});

test('多語：en 版可渲染（/travel/ 與目的地頁），七語新字串齊備', () => {
  const en = page('en');
  assert.match(en, /Changes in the last 30 days/);
  assert.match(en, /Global background reminder/);
  assert.match(en, /Check your destination/);
  const cd = page('en', 'CD');
  assert.match(cd, /Before you go/);
  assert.match(cd, /After you return/);
  assert.ok(!/href="(null|undefined)"/.test(en + cd));
  for (const lang of ['zh-TW', 'en', 'ja', 'tl', 'vi', 'id', 'th']) {
    for (const k of ['travel.chg.t', 'travel.chg.lifted', 'travel.bg.t', 'travel.longterm', 'travel.j.before', 'travel.j.d.vector', 'travel.j.a.1', 'travel.map.none', 'home.travel.stat', 'travel.dur.years']) {
      assert.notEqual(t(lang, k), k, `${lang} ${k}`);
    }
    assert.ok(page(lang).length > 10000, lang);
  }
});

test('缺資料容錯：沒有 Region／nameEn 的國家、沒有背景欄位也能渲染', () => {
  const s = govern('2026-10-01', (x) => { x.master.countries = [...x.master.countries, { iso2: 'ZZ', name: '測試國' }]; });
  const h = str(travel.render(makeCtx(s, 'zh-TW', { path: '/travel/ZZ/' }), { country: s.master.countries.at(-1) }));
  assert.match(h, /測試國/);
  assert.match(h, /目前無針對性旅遊疫情建議/);
  const en = str(travel.render(makeCtx(s, 'en', { path: '/en/travel/ZZ/' }), { country: s.master.countries.at(-1) }));
  assert.ok(!/undefined|href="null"/.test(en));
});

test('首頁任務卡副標與任務頁：針對性統計一句、查目的地入口', async () => {
  const home = await import('../src/templates/public/home.mjs');
  const h = str(home.render(makeCtx(site, 'zh-TW', { path: '/' }), {}));
  assert.match(h, /\d+ 國有針對性建議/);
  const task = await import('../src/templates/public/task.mjs');
  const tk = str(task.render(makeCtx(site, 'zh-TW', { path: '/tasks/travel/' }), { task: site.config.tasks.find((x) => x.key === 'travel') }));
  assert.match(tk, /data-tv-quick/);
  assert.match(tk, /近 30 天變化/);
  assert.ok(!/<table class="c-table">/.test(tk), '12 列表格已移除');
});
