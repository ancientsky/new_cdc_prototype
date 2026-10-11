// 第四十輪（Issue #71）：時程地圖「已過建議年齡」拆成「應已完成」與「已超過可接種年齡上限」、結果依費用排序與分小標、
// 「已接種」勾選（#done= 往返）、主檔 hardLimit* 新欄位的 schema 與跨欄位檢查、後台表單往返與 CSV 欄位。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Ajv2020Module from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import { makeCtx } from '../scripts/lib/pages.mjs';
import * as sched from '../src/templates/public/vaccine-schedule.mjs';
import * as adminVx from '../src/templates/admin/vaccine-schedule.mjs';
import { STRINGS, t as T } from '../src/client/i18n.js';
import { validateSite } from '../scripts/lib/validate.mjs';
import {
  statusFor,
  statusWithDone,
  hardLimitOf,
  hardLimitLabel,
  groupResults,
  fundedBuckets,
  publicElsewhere,
  byFunded,
  parseDone,
  formatDone,
  parseHash,
  buildHash,
  scheduleCsv,
  CSV_COLS,
  renderTableHtml,
  rowsOf,
  RESULT_ORDER,
  DONE_ELIGIBLE,
} from '../src/client/vaxschedule.js';
import { stateFromItem, buildItem, problemsOf, errorsOnly } from '../src/client/admin/vaxschedule-edit-core.js';
import { govern } from './helpers.mjs';

const site = govern('2026-10-11');
const ITEMS = site.master.immunizationSchedule;
const VAX = site.master.vaccines;
const byId = (id) => ITEMS.find((i) => i.id === id);
const zh = (k, v) => T('zh-TW', k, v);
const str = (r) => String(r);
const ORDER = ['zh-TW', 'en', 'ja', 'tl', 'vi', 'id', 'th'];

/* ───────── statusFor：四種情況 ───────── */
test('statusFor：建議區間內＝due、快到＝soon、過建議上限但無可接種上限＝completed-expected、滿可接種上限＝past-limit', () => {
  const hepB1 = { id: 'x', stage: 'infant', ageMinMonths: 0, ageMaxMonths: 0 };
  assert.equal(statusFor(hepB1, 0), 'due');
  assert.equal(statusFor(hepB1, 3), 'completed-expected', '沒有上限欄位 ⇒ 只能說應已完成，不得說超過上限');
  assert.equal(statusFor(hepB1, 600), 'completed-expected');
  const mmr2 = { stage: 'child', ageMinMonths: 60, ageMaxMonths: 83 };
  assert.equal(statusFor(mmr2, 56), 'soon');
  const rota = { stage: 'infant', ageMinMonths: 2, ageMaxMonths: 8, hardLimitMonths: 8 };
  assert.equal(statusFor(rota, 3), 'due');
  assert.equal(statusFor(rota, 7), 'due');
  assert.equal(statusFor(rota, 8), 'past-limit', '上限不含當月：滿 8 個月起不可接種');
  assert.equal(statusFor(rota, 30), 'past-limit');
  // 上限比建議區間晚：中間那段是「應已完成」，滿上限才是 past-limit
  const wide = { stage: 'infant', ageMinMonths: 2, ageMaxMonths: 4, hardLimitMonths: 10 };
  assert.equal(statusFor(wide, 5), 'completed-expected');
  assert.equal(statusFor(wide, 9), 'completed-expected');
  assert.equal(statusFor(wide, 10), 'past-limit');
  // 不變的部分
  assert.equal(statusFor(rota, null), 'none');
  assert.equal(statusFor({ stage: 'risk', ageMinMonths: 0, ageMaxMonths: null, hardLimitMonths: 5 }, 12), 'situational', '依情況的項目不看年齡');
  assert.equal(statusFor({ min: 2, max: 4, hard: 6 }, 6), 'past-limit', '也接受內嵌 JSON 的短鍵');
  assert.equal(hardLimitOf({}), null);
  assert.equal(hardLimitOf({ hardLimitMonths: 8 }), 8);
});

test('真實主檔：0 歲 3 個月沒有任何 past-limit；只有輪狀病毒有可接種上限，且 9 個月時才是 past-limit', () => {
  const s3 = Object.fromEntries(ITEMS.map((i) => [i.id, statusFor(i, 3)]));
  for (const id of ['sched.hepatitis-b-1', 'sched.hepatitis-b-2', 'sched.dtap-hib-ipv-1', 'sched.pcv-1']) assert.equal(s3[id], 'completed-expected', id);
  assert.ok(!Object.values(s3).includes('past-limit'));
  assert.ok(!Object.values(s3).includes('past'), '舊狀態 past 已不存在');
  assert.deepEqual(
    ITEMS.filter((i) => i.hardLimitMonths != null).map((i) => i.id),
    ['sched.rotavirus'],
  );
  assert.equal(statusFor(byId('sched.rotavirus'), 9), 'past-limit');
  assert.equal(statusFor(byId('sched.ev71'), 72), 'completed-expected', 'EV71 沒有上限欄位 ⇒ 不宣稱上限');
  // 每一筆、每個月齡都不會在沒有上限欄位時出現 past-limit
  for (const i of ITEMS.filter((x) => x.hardLimitMonths == null)) for (let m = 0; m <= 1000; m += 7) assert.notEqual(statusFor(i, m), 'past-limit', i.id);
});

/* ───────── 已接種勾選 ───────── */
test('statusWithDone：可勾的狀態才會變 done；即將與依情況的項目勾了也不算', () => {
  const done = new Set(['sched.hepatitis-b-1', 'sched.dtap-hib-ipv-2', 'sched.rotavirus', 'sched.mpox']);
  assert.equal(statusWithDone(byId('sched.hepatitis-b-1'), 3, done), 'done');
  assert.equal(statusWithDone(byId('sched.rotavirus'), 3, done), 'done', '現在可打的也能勾');
  assert.equal(statusWithDone(byId('sched.rotavirus'), 9, done), 'done', '超過上限但已打完 ⇒ 已接種');
  assert.equal(statusWithDone(byId('sched.dtap-hib-ipv-2'), 3, done), 'soon', '未來的劑次勾了不算');
  assert.equal(statusWithDone(byId('sched.mpox'), 300, done), 'situational');
  assert.equal(statusWithDone(byId('sched.hepatitis-b-1'), 3, ['sched.hepatitis-b-1']), 'done', '也接受陣列');
  assert.equal(statusWithDone(byId('sched.hepatitis-b-1'), 3, null), 'completed-expected');
  assert.deepEqual(DONE_ELIGIBLE, ['due', 'completed-expected', 'past-limit']);
});

test('#done= 往返：parseDone／formatDone、buildHash／parseHash；排序穩定、去重、擋掉怪字元、與 #age= 並存', () => {
  assert.deepEqual(parseDone('pcv-1,hepatitis-b-1'), ['sched.pcv-1', 'sched.hepatitis-b-1']);
  assert.deepEqual(parseDone('sched.pcv-1, pcv-1,,'), ['sched.pcv-1'], '接受完整 id、去重、略過空白');
  assert.deepEqual(parseDone('pcv-1,<script>,a b'), ['sched.pcv-1'], '怪字元整個丟掉');
  assert.deepEqual(parseDone(null), []);
  assert.equal(formatDone(new Set(['sched.pcv-1', 'sched.hepatitis-b-1', 'sched.pcv-1'])), 'hepatitis-b-1,pcv-1');
  assert.equal(formatDone(['vaccine.x', 'sched.ok']), 'ok');
  const h = buildHash({ months: 3, vaccine: null, sched: 'sched.pcv-1', done: new Set(['sched.pcv-1', 'sched.hepatitis-b-1']) });
  assert.equal(h, '#age=m3&sched=sched.pcv-1&done=hepatitis-b-1,pcv-1');
  const back = parseHash(h);
  assert.equal(back.months, 3);
  assert.equal(back.sched, 'sched.pcv-1');
  assert.deepEqual(new Set(back.done), new Set(['sched.pcv-1', 'sched.hepatitis-b-1']));
  assert.equal(buildHash({ ...back, done: new Set(back.done) }), h, '解析再組回同一個網址');
  assert.equal(buildHash({ months: 3, done: new Set() }), '#age=m3', '沒勾就不帶 done=');
  assert.deepEqual(parseHash('#sched.pcv-1').done, [], '單獨錨點不帶勾選');
  assert.deepEqual(parseHash('#age=m3&done=pcv-1%2Chepatitis-b-1').done, ['sched.pcv-1', 'sched.hepatitis-b-1'], '逗號被編碼也能讀');
});

test('勾選不寫進 localStorage：前端只透過網址 hash 保存（共用電腦不留下孩子的接種紀錄）', () => {
  const src = fs.readFileSync(new URL('../src/client/vaxschedule.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /(localStorage|sessionStorage)\s*[.[]/, '不呼叫瀏覽器儲存');
  assert.match(src, /state\.done = new Set\(\); setAge\(null\)/, '「清除」連勾選一起清');
});

/* ───────── 排序與分組 ───────── */
test('groupResults：0 歲 3 個月的結果——現在可打只有兩項自費、公費常規在應已完成與即將；各組依公費 → 條件公費 → 自費', () => {
  const g = groupResults(ITEMS, 3);
  assert.deepEqual(Object.keys(g), RESULT_ORDER);
  assert.deepEqual(new Set(g.due.map((i) => i.id)), new Set(['sched.rotavirus', 'sched.ev71']));
  assert.deepEqual(
    new Set(g['completed-expected'].map((i) => i.id)),
    new Set(['sched.hepatitis-b-1', 'sched.hepatitis-b-2', 'sched.dtap-hib-ipv-1', 'sched.pcv-1']),
  );
  assert.equal(g['past-limit'].length, 0);
  assert.deepEqual(publicElsewhere(g), ['completed-expected', 'soon'], '要提示公費常規在哪');
  const rank = { public: 0, conditional: 1, self: 2 };
  for (const s of RESULT_ORDER) for (let k = 1; k < g[s].length; k++) assert.ok(rank[g[s][k - 1].funded] <= rank[g[s][k].funded], `${s} 依費用排序`);
  for (const s of RESULT_ORDER)
    assert.deepEqual(
      g[s],
      [...g[s]].sort((a, b) => byFunded(a, b, 3)),
      `${s} 用 byFunded`,
    );
  const sit = fundedBuckets(g.situational);
  assert.deepEqual(
    sit.map((b) => b.funded),
    ['public', 'conditional', 'self'],
    '小標順序固定',
  );
  // 勾掉的移到「已接種」
  const d = groupResults(ITEMS, 3, new Set(['sched.hepatitis-b-1', 'sched.hepatitis-b-2']));
  assert.deepEqual(d.done.map((i) => i.id).sort(), ['sched.hepatitis-b-1', 'sched.hepatitis-b-2']);
  assert.equal(d['completed-expected'].length, 2);
});

test('publicElsewhere：現在可打有公費（或條件公費）時不提示；12 個月與 65 歲都不提示', () => {
  assert.deepEqual(publicElsewhere(groupResults(ITEMS, 12)), []);
  assert.deepEqual(publicElsewhere(groupResults(ITEMS, 780)), []);
  assert.deepEqual(publicElsewhere({ due: [{ funded: 'conditional' }], soon: [{ funded: 'public' }] }), []);
  assert.deepEqual(publicElsewhere({ due: [], soon: [{ funded: 'public' }], 'completed-expected': [] }), ['soon'], '現在可打是空的也提示');
  assert.deepEqual(publicElsewhere({ due: [{ funded: 'self' }], soon: [{ funded: 'self' }] }), [], '別組也沒有公費就不提示');
});

/* ───────── 主檔 schema 新欄位 ───────── */
const Ajv2020 = Ajv2020Module.default ?? Ajv2020Module;
const addFormats = addFormatsModule.default ?? addFormatsModule;
function scheduleValidator() {
  const ajv = new Ajv2020({ allErrors: true, strict: false, allowUnionTypes: true });
  addFormats(ajv);
  for (const f of fs.readdirSync(new URL('../schemas/', import.meta.url)))
    if (f.endsWith('.json')) ajv.addSchema(JSON.parse(fs.readFileSync(new URL(`../schemas/${f}`, import.meta.url), 'utf8')));
  return ajv.compile({ $ref: 'https://cdc-prototype/schemas/master.json#/$defs/scheduleItem' });
}
test('schema：hardLimit* 欄位——主檔通過；有上限必須有來源與核對旗標；只有來源沒有上限也擋；型別錯擋', () => {
  const v = scheduleValidator();
  for (const i of ITEMS) assert.ok(v(i), `${i.id} ${JSON.stringify(v.errors)}`);
  const base = { id: 'sched.t', vaccine: 'vaccine.rotavirus', label: 't', ageMinMonths: 2, ageMaxMonths: 8, stage: 'infant', funded: 'self' };
  const src = { title: '仿單', url: 'https://example.org' };
  assert.ok(v({ ...base, hardLimitMonths: 8, hardLimitSource: src, hardLimitVerified: false }));
  assert.ok(!v({ ...base, hardLimitMonths: 8 }), '沒有來源與核對旗標');
  assert.ok(!v({ ...base, hardLimitMonths: 8, hardLimitSource: src }), '沒有核對旗標');
  assert.ok(!v({ ...base, hardLimitSource: src }), '只有來源沒有上限');
  assert.ok(!v({ ...base, hardLimitNote: 'x' }), '只有依據沒有上限');
  assert.ok(!v({ ...base, hardLimitMonths: 7.5, hardLimitSource: src, hardLimitVerified: false }), '整數月');
  assert.ok(!v({ ...base, hardLimitMonths: 0, hardLimitSource: src, hardLimitVerified: false }), '至少 1');
  assert.ok(!v({ ...base, hardLimitMonths: 8, hardLimitSource: { title: 'x' }, hardLimitVerified: false }), '來源要有網址');
});

test('主檔輪狀病毒：上限標未核對、來源是官網時程表頁、整筆仍 verified:false；全部 42 筆維持待確認', () => {
  const r = byId('sched.rotavirus');
  assert.equal(r.hardLimitMonths, 8);
  assert.equal(r.hardLimitVerified, false);
  assert.equal(r.hardLimitSource.url, 'https://www.cdc.gov.tw/Category/Page/TxRW-x3WzvPhvEtxM628GA');
  assert.match(r.hardLimitNote, /請承辦人/);
  assert.equal(ITEMS.length, 42);
  assert.ok(ITEMS.every((i) => i.verified === false));
});

test('CI 跨欄位檢查（validate.mjs）與後台檢查同義：上限 ≤ 下限、上限 < 建議上限、缺來源都擋；目前主檔零錯誤', () => {
  const withRota = (patch) => ({
    ...site,
    master: { ...site.master, immunizationSchedule: ITEMS.map((i) => (i.id === 'sched.rotavirus' ? { ...i, ...patch } : i)) },
  });
  const errsOf = (s) => validateSite(s).filter((e) => /immunization-schedule/.test(e));
  assert.deepEqual(errsOf(site), []);
  assert.ok(errsOf(withRota({ hardLimitMonths: 2 })).some((e) => /hardLimitMonths 必須大於 ageMinMonths/.test(e)));
  assert.ok(errsOf(withRota({ hardLimitMonths: 6 })).some((e) => /hardLimitMonths 不得小於 ageMaxMonths/.test(e)));
  assert.ok(errsOf(withRota({ hardLimitSource: undefined })).length > 0, 'schema dependentRequired：沒有來源不得宣稱上限');
  // 後台
  const ids = VAX.map((x) => x.id);
  const f = (it) => errorsOnly(problemsOf(it, { vaccineIds: ids })).map((p) => p.field);
  const b = byId('sched.rotavirus');
  assert.deepEqual(f(b), []);
  assert.ok(f({ ...b, hardLimitMonths: 2 }).includes('hardLimitMonths'));
  assert.ok(f({ ...b, hardLimitMonths: 6 }).includes('hardLimitMonths'));
  assert.ok(f({ ...b, hardLimitSource: undefined }).includes('hardSourceTitle'), '沒有來源不得宣稱上限');
  assert.ok(problemsOf(b, { vaccineIds: ids }).some((p) => p.field === 'hardVerified' && p.level === 'warn'));
});

test('後台：stateFromItem → buildItem 保留四個 hardLimit 欄位；清空上限就四欄都不輸出；表單有對應欄位', () => {
  const r = byId('sched.rotavirus');
  const back = buildItem(stateFromItem(r));
  for (const k of ['hardLimitMonths', 'hardLimitNote', 'hardLimitSource', 'hardLimitVerified']) assert.deepEqual(back[k], r[k], k);
  assert.ok(Object.keys(back).indexOf('hardLimitMonths') === Object.keys(back).indexOf('ageMaxMonths') + 1, '欄位順序：緊接在 ageMaxMonths 後');
  const cleared = buildItem({ ...stateFromItem(r), hardY: '', hardM: '' });
  for (const k of ['hardLimitMonths', 'hardLimitNote', 'hardLimitSource', 'hardLimitVerified']) assert.ok(!(k in cleared), k);
  const h = str(adminVx.render(makeCtx(site, 'zh-TW', { path: '/admin/vaccines/schedule/', view: 'admin' })));
  for (const f of ['hardY', 'hardM', 'hardNote', 'hardSourceTitle', 'hardSourceUrl', 'hardVerified']) assert.ok(h.includes(`data-f="${f}"`), f);
  assert.match(h, /可接種年齡上限/);
});

/* ───────── 消費者：表格、CSV、內嵌 JSON、.md、i18n ───────── */
test('表格與 .md：只有輪狀病毒那列寫出可接種上限並標待確認；其他列沒有「上限」字樣', () => {
  const html = renderTableHtml(rowsOf(ITEMS, VAX), { t: zh });
  const rotaRow = /<tr id="sched\.rotavirus"[\s\S]*?<\/tr>/.exec(html)[0];
  assert.match(rotaRow, /可接種年齡上限：滿 8 個月起不可接種 <span class="c-pill c-pill--warn">待承辦人確認/);
  assert.equal((html.match(/可接種年齡上限/g) ?? []).length, 1);
  assert.equal(hardLimitLabel(byId('sched.hepatitis-b-1'), zh), '');
  const md = sched.markdown(makeCtx(site, 'zh-TW', { path: '/vaccines/schedule/', alternates: ['zh-TW', 'en'] }));
  assert.match(md, /可接種年齡上限：滿 8 個月起不可接種（待承辦人確認）/);
});

test('CSV：多四欄 hardLimit*；沒有上限的列四欄空白，輪狀病毒列有值且 hardLimitVerified=false', () => {
  for (const c of ['hardLimitMonths', 'hardLimitNote', 'hardLimitSourceUrl', 'hardLimitVerified']) assert.ok(CSV_COLS.includes(c), c);
  const lines = scheduleCsv(ITEMS).replace(/^﻿/, '').trim().split('\r\n');
  const head = lines[0].split(',');
  const col = (name) => head.indexOf(name);
  const rowOf = (id) => lines.find((l) => l.startsWith(`${id},`));
  const rota = rowOf('sched.rotavirus');
  assert.ok(rota.includes(',8,') && rota.includes('TxRW-x3WzvPhvEtxM628GA') && /,false,/.test(rota));
  const hep = rowOf('sched.hepatitis-b-2').split(',');
  for (const c of ['hardLimitMonths', 'hardLimitNote', 'hardLimitSourceUrl', 'hardLimitVerified']) assert.equal(hep[col(c)], '', c);
  assert.equal(
    scheduleCsv(ITEMS, (id) => id, zh)
      .replace(/^﻿/, '')
      .split('\r\n')[0]
      .split(',').length,
    CSV_COLS.length,
  );
});

test('建置頁內嵌 JSON：只有輪狀病毒帶 hardLimit*，其他項目不帶（沒有欄位＝不宣稱上限）', () => {
  const h = str(sched.render(makeCtx(site, 'zh-TW', { path: '/vaccines/schedule/', alternates: ['zh-TW', 'en'] })));
  const data = JSON.parse(/<script type="application\/json" id="vxs-data">([\s\S]*?)<\/script>/.exec(h)[1]);
  const withHard = data.items.filter((i) => 'hardLimitMonths' in i);
  assert.deepEqual(
    withHard.map((i) => i.id),
    ['sched.rotavirus'],
  );
  assert.equal(withHard[0].hardLimitVerified, false);
  assert.equal(withHard[0].hardLimitSource.ext, true);
});

test('i18n：新狀態與小標七語齊備；舊的 vxs.status.past 已移除；中文措辭保守（應已完成不說「不能打」）', () => {
  const keys = [
    'vxs.status.completed-expected',
    'vxs.status.completed-expected.d',
    'vxs.status.past-limit',
    'vxs.status.past-limit.d',
    'vxs.status.done',
    'vxs.status.done.d',
    'vxs.short.completed-expected',
    'vxs.short.soon',
    'vxs.res.funded.public',
    'vxs.res.funded.conditional',
    'vxs.res.funded.self',
    'vxs.res.publicElsewhere',
    'vxs.res.or',
    'vxs.done.label',
    'vxs.done.note',
    'vxs.hard.label',
    'vxs.hard.value',
    'vxs.hard.note',
    'vxs.hard.source',
  ];
  for (const lang of ORDER) for (const k of keys) assert.ok(STRINGS[lang][k], `${lang} ${k}`);
  for (const lang of ORDER) assert.ok(!STRINGS[lang]['vxs.status.past'], `${lang} 舊鍵`);
  assert.equal(STRINGS['zh-TW']['vxs.status.completed-expected'], '應已完成（若尚未接種請洽醫師安排補接種）');
  assert.equal(STRINGS['zh-TW']['vxs.status.past-limit'], '已超過可接種年齡上限');
  assert.equal(STRINGS['zh-TW']['vxs.res.funded.public'], '公費常規');
  assert.equal(STRINGS['zh-TW']['vxs.res.funded.self'], '自費（選擇性）');
  assert.doesNotMatch(STRINGS['zh-TW']['vxs.status.completed-expected.d'], /上限|不可|不能/);
  assert.match(zh('vxs.res.publicElsewhere', { where: '「應已完成」或「即將」' }), /公費常規項目在「應已完成」或「即將」/);
  assert.equal(zh('vxs.hard.value', { a: '8 個月' }), '滿 8 個月起不可接種');
});
