// 疫苗接種時程地圖（/vaccines/schedule/）：渲染、42 筆標記、頁籤、待確認徽章、.md 表格、入口連結，以及前端純函式（年齡解析、狀態判斷）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeCtx } from '../scripts/lib/pages.mjs';
import { layout } from '../src/templates/layout.mjs';
import * as sched from '../src/templates/public/vaccine-schedule.mjs';
import * as vaccines from '../src/templates/public/vaccines.mjs';
import * as task from '../src/templates/public/task.mjs';
import { STRINGS, t } from '../src/client/i18n.js';
import { byFunded, ageToMonths, monthsFromBirthday, parseAgeParam, formatAgeParam, parseHash, buildHash, statusFor, formatAge, ageRangeLabel, xOf, TABS, PLOT_WIDTH, END_MONTHS } from '../src/client/vaxschedule.js';
import { govern } from './helpers.mjs';

const str = (r) => String(r);
const LANGS = ['zh-TW', 'en', 'ja', 'tl', 'vi', 'id', 'th'];
const BAD = [/href="null"/, /href="undefined"/, /href="\[object/, />undefined</, />null</, /\$\{/, /\bundefined\b/, /\[object Object\]/];
const noBad = (h, label = '') => { for (const re of BAD) assert.ok(!re.test(h), `${label} 出現 ${re}`); };

const site = govern();
const ITEMS = site.master.immunizationSchedule;
const ctxOf = (lang = 'zh-TW', path = '/vaccines/schedule/') => makeCtx(site, lang, { path, alternates: LANGS });
const full = (lang) => { const ctx = ctxOf(lang); return str(layout(ctx, { ...sched.meta(ctx), body: sched.render(ctx) })); };
const body = (lang) => str(sched.render(ctxOf(lang)));
const mdOf = (lang) => sched.markdown(ctxOf(lang));

test('頁面登錄：/vaccines/schedule/，七語，有 .md', () => {
  const p = sched.pages(site);
  assert.deepEqual(p.map((x) => [x.path, x.lang, x.md]), [['/vaccines/schedule/', '*', true]]);
  assert.deepEqual(sched.meta(ctxOf()).scripts, ['/assets/js/vaxschedule.js']);
});

test('zh-TW：標題、說明、年齡表單、地圖、詳情區、表格，且不出壞字串', () => {
  const h = full('zh-TW');
  assert.match(h, /<h1>疫苗接種時程地圖<\/h1>/);
  for (const k of ['data-vxs-form', 'name="years"', 'name="months"', 'name="birth"', 'class="vxs-svg"', 'id="vxs-detail"', 'class="c-table vxs-table"', 'id="vxs-data"']) assert.ok(h.includes(k), k);
  assert.match(h, /<script type="application\/json" id="vxs-data">/);
  assert.match(h, /src="[^"]*\/assets\/js\/vaxschedule\.js"/);
  noBad(h, 'zh-TW');
});

test('七語都能渲染且不出壞字串；en 有英文標題與徽章', () => {
  for (const lang of LANGS) { const h = full(lang); assert.match(h, /class="vxs-svg"/, lang); noBad(h, lang); }
  const en = full('en');
  assert.match(en, /<h1>Vaccination schedule map<\/h1>/);
  assert.match(en, /Pending staff verification/);
  assert.match(en, /Publicly funded/);
  assert.match(en, /Schedule content .* Chinese only/);
  assert.doesNotMatch(full('zh-TW'), /Chinese only/);
});

test('每個語言的 vxs 字串 zh-TW／en 齊備、沒有空值', () => {
  const keys = Object.keys(STRINGS['zh-TW']).filter((k) => k.startsWith('vxs.'));
  assert.ok(keys.length > 60);
  for (const k of keys) { assert.ok(STRINGS['zh-TW'][k], `zh-TW ${k}`); assert.ok(STRINGS.en[k], `en ${k}`); }
});

test('42 筆時程各有一個標記（連到表格列錨點）與一列表格', () => {
  assert.equal(ITEMS.length, 42);
  for (const lang of ['zh-TW', 'en']) {
    const h = body(lang);
    const marks = [...h.matchAll(/<a class="vxs-mk [^"]*" href="#(sched\.[\w.-]+)" data-id="([^"]+)" data-stage="(\w+)"><title>([^<]+)<\/title>/g)];
    assert.equal(marks.length, 42, `${lang} 標記數`);
    assert.equal(new Set(marks.map((m) => m[1])).size, 42, '標記不重複');
    for (const it of ITEMS) {
      assert.ok(marks.some((m) => m[1] === it.id && m[2] === it.id && m[3] === it.stage), `${lang} 缺標記 ${it.id}`);
      assert.ok(h.includes(`<tr id="${it.id}" data-sched="${it.id}"`), `${lang} 表格缺列 ${it.id}`);
    }
    for (const m of marks) assert.ok(m[4].length > 3, '標記有 <title>');
  }
});

test('內嵌 JSON：42 筆、每筆疫苗都有 vaccines 項；站內來源網址已加 basePath／語言前綴', () => {
  const h = body('en');
  const json = JSON.parse(/<script type="application\/json" id="vxs-data">([\s\S]*?)<\/script>/.exec(h)[1]);
  assert.equal(json.items.length, 42);
  assert.equal(json.lang, 'en');
  for (const i of json.items) assert.ok(json.vaccines[i.v], i.v);
  assert.match(json.vaccines['vaccine.influenza'].href, /\/vaccines\/influenza\//);
  assert.equal(json.vaccines['vaccine.bcg'].href, null, '沒有頁面的疫苗不連');
  assert.match(json.vaccines['vaccine.mmr'].where, /^https?:\/\//);
  for (const i of json.items) if (i.src?.url && !/^https?:/.test(i.src.url)) assert.match(i.src.url, /^\/new_cdc_prototype\//, i.id);
});

test('SVG 結構：一列一疫苗（依主檔順序）、funded 三種樣式、verified=false 虛線外框、刻度', () => {
  const h = body('zh-TW');
  const rows = [...h.matchAll(/class="vxs-rl" id="vaccine=([^"]+)"/g)].map((m) => m[1]);
  const order = site.master.vaccines.map((v) => v.id).filter((id) => ITEMS.some((i) => i.vaccine === id));
  assert.deepEqual(rows, order);
  for (const f of ['public', 'conditional', 'self']) assert.ok(new RegExp(`<a class="vxs-mk vxs-mk--${f}`).test(h), f);
  const nUn = ITEMS.filter((i) => i.verified === false).length;
  assert.equal((h.match(/<a class="vxs-mk [^"]*is-unverified/g) ?? []).length, nUn);
  assert.match(h, /id="vxs-hatch"/);
  assert.match(h, /<text class="vxs-tick"[^>]*>12 月<\/text>/);
  assert.match(h, /<text class="vxs-tick"[^>]*>65 歲<\/text>/);
  assert.match(h, /aria-labelledby="vxs-svg-t"/);
});

test('階段頁籤：全部＋五段，共 6 個，預設選「全部」', () => {
  const h = body('zh-TW');
  assert.equal((h.match(/data-vxs-tab="/g) ?? []).length, 6);
  assert.deepEqual(TABS.map((x) => x.id), ['all', 'infant', 'school', 'adult', 'older', 'risk']);
  for (const k of ['全部', '嬰幼兒', '學齡前與學齡', '成人與孕婦', '長者', '特殊情況']) assert.ok(h.includes(`>${k}</button>`), k);
  assert.match(h, /id="vxs-tab-all" aria-controls="vxs-map" aria-selected="true"/);
  // 每筆時程都被某個頁籤涵蓋
  for (const it of ITEMS) assert.ok(TABS.some((tb) => tb.stages?.includes(it.stage)), it.stage);
});

test('verified=false：整體提示橫幅與表格徽章；全部已確認時不出現', () => {
  const h = body('zh-TW');
  assert.ok(ITEMS.some((i) => i.verified === false));
  assert.match(h, /class="c-warning vxs-notice"/);
  assert.ok((h.match(/c-pill--warn">待承辦人確認/g) ?? []).length >= ITEMS.filter((i) => i.verified === false).length);
  const saved = site.master.immunizationSchedule;
  site.master.immunizationSchedule = saved.map((i) => ({ ...i, verified: true }));
  try { const ok = body('zh-TW'); assert.doesNotMatch(ok, /vxs-notice/); assert.doesNotMatch(ok, /待承辦人確認/); } finally { site.master.immunizationSchedule = saved; }
});

test('表格：欄位、公費徽章、來源連結（站內不開新視窗、外站 rel=noopener）', () => {
  const h = body('zh-TW');
  const tb = h.slice(h.indexOf('<table class="c-table vxs-table">'), h.indexOf('</table>'));
  for (const c of ['疫苗', '劑次／項目', '建議年齡', '階段', '費用', '公費對象', '間隔', '備註', '來源']) assert.ok(tb.includes(`>${c}</th>`), c);
  assert.match(tb, /c-pill--ok">公費/);
  assert.match(tb, /c-pill--info">符合條件公費/);
  assert.match(tb, /c-pill--neutral">自費/);
  assert.match(tb, /href="https:\/\/[^"]+" target="_blank" rel="noopener"/);
  assert.match(tb, /<a href="\/new_cdc_prototype\/vaccines\/influenza\/">/);
  assert.match(h, /\/vaccines\/schedule\.md/);
});

test('.md 機讀版：標題、表格表頭、42 筆資料列、待確認提示', () => {
  for (const lang of ['zh-TW', 'en']) {
    const m = mdOf(lang);
    assert.match(m, /^# /);
    const lines = m.split('\n');
    const sep = lines.findIndex((l) => /^\| --- /.test(l));
    assert.ok(sep > 1, '有表格分隔列');
    const dataRows = lines.slice(sep + 1).filter((l) => l.startsWith('| '));
    assert.equal(dataRows.length, 42, lang);
    for (const it of ITEMS) assert.ok(m.includes(`| ${it.id} |`), `${lang} ${it.id}`);
    assert.match(m, /⚠/);
    assert.ok(!/undefined|null|\[object/.test(m));
  }
  assert.match(mdOf('zh-TW'), /待承辦人確認/);
});

test('入口：/vaccines/ 索引頂部卡、疫苗詳頁帶 #vaccine=、/tasks/vaccines/ 連結', () => {
  const idx = str(vaccines.render(ctxOf('zh-TW', '/vaccines/'), {}));
  assert.ok(idx.indexOf('vxs-entry') > 0 && idx.indexOf('vxs-entry') < idx.indexOf('id="vx-list"'), '卡在清單之前');
  assert.match(idx, /href="\/new_cdc_prototype\/vaccines\/schedule\/"/);
  const mmr = site.collections.vaccines.find((v) => v.id === 'vaccine.mmr');
  const det = str(vaccines.render(ctxOf('zh-TW', '/vaccines/mmr/'), { item: mmr }));
  assert.match(det, /href="\/new_cdc_prototype\/vaccines\/schedule\/#vaccine=vaccine\.mmr"/);
  const tk = task.pages(site).find((p) => p.props.task.key === 'vaccines');
  const th = str(task.render(ctxOf('zh-TW', '/tasks/vaccines/'), tk.props));
  assert.match(th, /href="\/new_cdc_prototype\/vaccines\/schedule\/"/);
  const other = str(task.render(ctxOf('zh-TW', '/tasks/travel/'), task.pages(site).find((p) => p.props.task.key === 'travel').props));
  assert.doesNotMatch(other, /vaccines\/schedule/);
});

/* ───────── 前端純函式 ───────── */
test('ageToMonths：歲＋月；空白視為 0；非法 ⇒ null', () => {
  assert.equal(ageToMonths(65, 0), 780);
  assert.equal(ageToMonths('1', ''), 12);
  assert.equal(ageToMonths('', '8'), 8);
  assert.equal(ageToMonths(0, 0), 0);
  assert.equal(ageToMonths('', ''), null);
  assert.equal(ageToMonths(-1, 0), null);
  assert.equal(ageToMonths('abc', 0), null);
  assert.equal(ageToMonths(121, 0), null);
  assert.equal(ageToMonths(2, 14), 38, '月超過 11 仍照算');
});

test('monthsFromBirthday：滿月計算；未來日期 ⇒ null', () => {
  assert.equal(monthsFromBirthday('2025-10-01', '2026-10-01'), 12);
  assert.equal(monthsFromBirthday('2025-10-02', '2026-10-01'), 11);
  assert.equal(monthsFromBirthday('2026-10-01', '2026-10-01'), 0);
  assert.equal(monthsFromBirthday('2026-10-02', '2026-10-01'), null);
  assert.equal(monthsFromBirthday('1961-03-15', '2026-10-01'), 65 * 12 + 6);
  assert.equal(monthsFromBirthday('bad', '2026-10-01'), null);
});

test('#age 參數與 hash：65／m12、vaccine、sched；往返一致', () => {
  assert.equal(parseAgeParam('65'), 780);
  assert.equal(parseAgeParam('m12'), 12);
  assert.equal(parseAgeParam('M6'), 6);
  assert.equal(parseAgeParam('0'), 0);
  for (const bad of ['', 'x', '-1', '999', 'm', 'm99999', '6.5', null, undefined]) assert.equal(parseAgeParam(bad), null, String(bad));
  assert.equal(formatAgeParam(780), '65');
  assert.equal(formatAgeParam(12), 'm12');
  assert.equal(formatAgeParam(18), 'm18');
  assert.equal(formatAgeParam(30), 'm30');
  assert.equal(formatAgeParam(24), '2');
  assert.deepEqual(parseHash('#age=65'), { months: 780, vaccine: null, sched: null });
  assert.deepEqual(parseHash('#age=m12'), { months: 12, vaccine: null, sched: null });
  assert.deepEqual(parseHash('#vaccine=vaccine.mmr'), { months: null, vaccine: 'vaccine.mmr', sched: null });
  assert.deepEqual(parseHash('#age=65&vaccine=vaccine.influenza&sched=sched.influenza-older'), { months: 780, vaccine: 'vaccine.influenza', sched: 'sched.influenza-older' });
  assert.deepEqual(parseHash('#sched.hpv'), { months: null, vaccine: null, sched: 'sched.hpv' });
  assert.deepEqual(parseHash(''), { months: null, vaccine: null, sched: null });
  assert.deepEqual(parseHash('#vaccine=<script>'), { months: null, vaccine: null, sched: null }, '不合法的 id 丟棄');
  assert.equal(buildHash({ months: 780 }), '#age=65');
  assert.equal(buildHash({ months: 12, vaccine: 'vaccine.mmr' }), '#age=m12&vaccine=vaccine.mmr');
  assert.equal(buildHash({}), '');
  for (const m of [0, 1, 12, 18, 24, 30, 36, 780, 1440]) assert.equal(parseHash(buildHash({ months: m })).months, m);
});

test('statusFor：due／soon／past／none 與邊界', () => {
  const hep = { ageMinMonths: 2, ageMaxMonths: 2 };
  assert.equal(statusFor(hep, 2), 'due');
  assert.equal(statusFor(hep, 3), 'past');
  assert.equal(statusFor(hep, 1), 'soon');
  assert.equal(statusFor(hep, 0), 'soon', '差 2 個月');
  const mmr2 = { ageMinMonths: 60, ageMaxMonths: 83 };
  assert.equal(statusFor(mmr2, 60), 'due');
  assert.equal(statusFor(mmr2, 83), 'due');
  assert.equal(statusFor(mmr2, 84), 'past');
  assert.equal(statusFor(mmr2, 54), 'soon', '剛好 6 個月內');
  assert.equal(statusFor(mmr2, 53), 'none', '超過 6 個月');
  const older = { ageMinMonths: 780, ageMaxMonths: null };
  assert.equal(statusFor(older, 779), 'soon');
  assert.equal(statusFor(older, 780), 'due');
  assert.equal(statusFor(older, 1200), 'due', '無上限永不 past');
  assert.equal(statusFor(older, 100), 'none');
  assert.equal(statusFor(older, null), 'none');
  assert.equal(statusFor(older, NaN), 'none');
  assert.equal(statusFor({ min: 12, max: 12 }, 12), 'due', '也接受內嵌 JSON 的 min／max');
});

test('statusFor 套真實資料：12 個月與 65 歲', () => {
  const due = (m) => ITEMS.filter((i) => statusFor(i, m) === 'due').map((i) => i.id);
  const d12 = due(12);
  for (const id of ['sched.mmr-1', 'sched.varicella-1', 'sched.hepatitis-a-1', 'sched.pcv-3', 'sched.influenza-child']) assert.ok(d12.includes(id), id);
  const d65 = due(780);
  for (const id of ['sched.influenza-older', 'sched.pcv-older', 'sched.covid-older']) assert.ok(d65.includes(id), id);
  assert.ok(!d65.includes('sched.mmr-1'));
  assert.equal(statusFor(ITEMS.find((i) => i.id === 'sched.hepatitis-b-1'), 12), 'past');
});

test('刻度與年齡文字：分段單調、端點、中英格式', () => {
  assert.equal(xOf(0), 0);
  assert.equal(xOf(END_MONTHS), PLOT_WIDTH);
  assert.equal(xOf(24), 480);
  assert.equal(xOf(5000), PLOT_WIDTH, '夾到邊界');
  let prev = -1; for (let m = 0; m <= END_MONTHS; m += 6) { const x = xOf(m); assert.ok(x > prev, `m=${m}`); prev = x; }
  assert.ok(xOf(1) - xOf(0) > 10, '0–24 月逐月：每月至少 10px');
  for (const [lang, a, b, c] of [['zh-TW', '出生', '18 個月', '6 歲 11 個月'], ['en', 'Birth', '18 months', '6 y 11 mo']]) {
    const T = (k, v) => t(lang, k, v);
    assert.equal(formatAge(0, T), a); assert.equal(formatAge(18, T), b); assert.equal(formatAge(83, T), c);
  }
  const T = (k, v) => t('zh-TW', k, v);
  assert.equal(formatAge(780, T), '65 歲');
  assert.equal(ageRangeLabel({ ageMinMonths: 780, ageMaxMonths: null }, T), '65 歲 以上');
  assert.equal(ageRangeLabel({ ageMinMonths: 12, ageMaxMonths: 12 }, T), '12 個月');
  assert.equal(ageRangeLabel({ ageMinMonths: 12, ageMaxMonths: 15 }, T), '12 個月 至 15 個月');
});

test('statusFor：孕婦與特殊情況不看年齡（situational）；其餘不受影響', () => {
  assert.equal(statusFor({ stage: 'pregnancy', ageMinMonths: 228, ageMaxMonths: null }, 300), 'situational');
  assert.equal(statusFor({ stage: 'risk', ageMinMonths: 0, ageMaxMonths: null }, 12), 'situational');
  assert.equal(statusFor({ stage: 'risk', ageMinMonths: 0, ageMaxMonths: null }, null), 'none');
  assert.equal(statusFor({ stage: 'older', ageMinMonths: 780, ageMaxMonths: null }, 780), 'due');
  for (const m of [12, 780]) for (const it of ITEMS.filter((i) => ['pregnancy', 'risk'].includes(i.stage))) assert.equal(statusFor(it, m), 'situational', it.id);
  assert.ok(STRINGS['zh-TW']['vxs.status.situational'] && STRINGS.en['vxs.status.situational.d']);
});

test('byFunded：65 歲時公費項目依年齡接近度排序，「流感 65 歲以上」在最前', () => {
  const m = 780;
  const due = ITEMS.filter((i) => statusFor(i, m) === 'due').sort((a, b) => byFunded(a, b, m));
  assert.equal(due[0].id, 'sched.influenza-older');
  const rank = { public: 0, conditional: 1, self: 2 };
  for (let k = 1; k < due.length; k++) assert.ok(rank[due[k - 1].funded] <= rank[due[k].funded], '公費先於條件、自費');
  const d12 = ITEMS.filter((i) => statusFor(i, 12) === 'due').sort((a, b) => byFunded(a, b, 12));
  assert.equal(d12[0].funded, 'public');
});
