// 第三十六輪：時程地圖共用渲染（建置＝後台預覽）、下載 CSV、後台 /admin/vaccines/schedule/ 純函式與模板、預防接種專區入口與新內容。
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeCtx } from '../scripts/lib/pages.mjs';
import * as sched from '../src/templates/public/vaccine-schedule.mjs';
import * as vaccines from '../src/templates/public/vaccines.mjs';
import * as adminVx from '../src/templates/admin/vaccine-schedule.mjs';
import { NAV } from '../src/templates/admin/_partials.mjs';
import { STRINGS, t as T } from '../src/client/i18n.js';
import { rowsOf, renderMapSvg, renderTableHtml, scheduleCsv, CSV_COLS, TICKS, xOf, END_MONTHS } from '../src/client/vaxschedule.js';
import { emptyState, stateFromItem, buildItem, problemsOf, problemsOfAll, errorsOnly, nextId, joinMonths, splitMonths, monthsText, sortedForExport, diffSummary } from '../src/client/admin/vaxschedule-edit-core.js';
import { govern } from './helpers.mjs';

const site = govern('2026-10-11');
const ITEMS = site.master.immunizationSchedule;
const VAX = site.master.vaccines;
const zh = (k, v) => T('zh-TW', k, v);
const ctxOf = (lang = 'zh-TW', path = '/vaccines/schedule/') => makeCtx(site, lang, { path, alternates: ['zh-TW', 'en'] });
const str = (r) => String(r);

/* ───────── 共用渲染 ───────── */
test('rowsOf：依疫苗主檔順序、只列有時程的疫苗、每列依年齡下限排序；主檔沒有的 id 排最後', () => {
  const rows = rowsOf(ITEMS, VAX);
  const order = VAX.map((v) => v.id).filter((id) => ITEMS.some((i) => i.vaccine === id));
  assert.deepEqual(rows.map((r) => r.id), order);
  for (const r of rows) for (let i = 1; i < r.items.length; i++) assert.ok(r.items[i].ageMinMonths >= r.items[i - 1].ageMinMonths, r.id);
  const extra = rowsOf([...ITEMS, { id: 'sched.x', vaccine: 'vaccine.nope', label: 'x', ageMinMonths: 0, stage: 'infant', funded: 'self' }], VAX);
  assert.equal(extra.at(-1).id, 'vaccine.nope');
  assert.equal(extra.at(-1).name, 'vaccine.nope');
});

test('renderMapSvg：字串版與建置頁的 SVG 一致（42 標記、列 id、刻度）；注入字元被跳脫', () => {
  const rows = rowsOf(ITEMS, VAX);
  const svg = renderMapSvg(rows, { t: zh });
  assert.equal((svg.match(/<a class="vxs-mk /g) ?? []).length, 42);
  assert.ok(svg.includes(`viewBox="0 0 ${150 + xOf(END_MONTHS)} `));
  assert.match(svg, /<text class="vxs-tick" x="2" y="22" text-anchor="start">0 月<\/text>/, '首刻度靠左');
  assert.match(svg, /text-anchor="end">80 歲<\/text>/, '末刻度靠右');
  assert.ok(!/text-anchor="middle">(3|8|10) 歲</.test(svg), '學齡段刻度已精簡，避免重疊');
  const page = str(sched.render(ctxOf()));
  assert.ok(page.includes(svg.slice(svg.indexOf('<defs>'), svg.indexOf('</defs>'))), '建置頁內嵌同一份 SVG');
  const evil = renderMapSvg([{ id: 'vaccine.x', name: '<img onerror=1>', href: '"><script>', items: [{ id: 'sched.x', vaccine: 'vaccine.x', label: '</title><script>', ageMinMonths: 0, ageMaxMonths: 0, stage: 'infant', funded: 'self' }] }], { t: zh });
  assert.ok(!evil.includes('<img onerror') && !evil.includes('<script>') && !evil.includes('"><script>'));
  assert.ok(evil.includes('&lt;img onerror=1&gt;'));
});

test('renderTableHtml：42 列、費用徽章、待確認徽章、來源 sourceOf 決定連結；非中文加 lang="zh-TW"', () => {
  const rows = rowsOf(ITEMS, VAX, { lang: 'en' });
  const h = renderTableHtml(rows, { t: (k, v) => T('en', k, v), lang: 'en', sourceOf: (i) => (i.source ? { href: `/x${i.source.url}`, ext: false } : null), scrollLabel: 'scroll' });
  assert.equal((h.match(/<tr id="sched\./g) ?? []).length, 42);
  assert.match(h, /c-pill--ok">Publicly funded/);
  assert.match(h, /c-pill--warn">Pending staff verification/);
  assert.match(h, /<a href="\/xhttps:\/\/[^"]+" lang="zh-TW">/);
  assert.doesNotMatch(h, /target="_blank"/);
  const zhH = renderTableHtml(rowsOf(ITEMS, VAX), { t: zh });
  assert.match(zhH, /target="_blank" rel="noopener"/);
  assert.doesNotMatch(zhH, /lang="zh-TW"/);
});

test('scheduleCsv：BOM、表頭、42 列、逗號與引號跳脫、verified 字串、空上限為空白', () => {
  const csv = scheduleCsv(ITEMS, (id) => VAX.find((v) => v.id === id)?.name ?? id, zh);
  assert.ok(csv.startsWith('﻿'));
  const lines = csv.replace(/^﻿/, '').split('\r\n').filter(Boolean);
  assert.equal(lines.length, 43);
  assert.equal(lines[0].split(',').length, CSV_COLS.length);
  assert.match(lines[0], /^編號,vaccine id,疫苗,劑次／項目/);
  const quoted = scheduleCsv([{ id: 'sched.q', vaccine: 'v', label: 'a,b', note: 'say "hi"', ageMinMonths: 0, ageMaxMonths: null, stage: 'infant', funded: 'self', verified: false }], () => 'V');
  assert.match(quoted, /"a,b"/); assert.match(quoted, /"say ""hi"""/); assert.match(quoted, /,0,,,,,,infant,/, '空上限與第四十輪四個 hardLimit 欄位皆空白'); assert.match(quoted, /,false\r\n$/);
  const plain = scheduleCsv(ITEMS);
  assert.equal(plain.replace(/^﻿/, '').split('\r\n')[0], CSV_COLS.join(','));
});

/* ───────── 前台頁 ───────── */
test('時程地圖頁：下載工具列、放大檢視、CSV 連結、詳情卡在圖下、後台連結只在中文頁', () => {
  const h = str(sched.render(ctxOf()));
  for (const k of ['data-vxs-dl="png"', 'data-vxs-dl="svg"', 'data-vxs-dl="csv"', 'data-vxs-zoom', '/vaccines/schedule.csv', 'class="vxs-bar"']) assert.ok(h.includes(k), k);
  assert.ok(h.indexOf('id="vxs-map"') < h.indexOf('id="vxs-detail"') && h.indexOf('id="vxs-detail"') < h.indexOf('id="vxs-tb-h"'), '詳情卡在地圖之後、表格之前');
  assert.doesNotMatch(h, /vxs-grid2/);
  assert.match(h, /href="\/new_cdc_prototype\/admin\/vaccines\/schedule\/" rel="nofollow">同事修改這份時程/);
  const en = str(sched.render(ctxOf('en')));
  assert.doesNotMatch(en, /admin\/vaccines\/schedule/);
  assert.match(en, /Download this chart/);
  assert.match(sched.markdown(ctxOf()), /vaccines\/schedule\.csv/);
  for (const k of ['vxs.dl.t', 'vxs.dl.stamp', 'vxs.zoom', 'vxs.file', 'vxs.staff.edit', 'vaccines.hub.t', 'vaccines.hub.injury', 'vaccines.hub.law.d']) { assert.ok(STRINGS['zh-TW'][k], k); assert.ok(STRINGS.en[k], `en ${k}`); }
});

test('刻度：每個刻度月齡在 0–END 內、遞增；xOf 單調', () => {
  let last = -1;
  for (const [mo] of TICKS) { assert.ok(mo >= 0 && mo <= END_MONTHS); assert.ok(mo > last); assert.ok(xOf(mo) >= xOf(last < 0 ? 0 : last)); last = mo; }
});

/* ───────── 後台純函式 ───────── */
test('月齡換算：splitMonths／joinMonths／monthsText', () => {
  assert.deepEqual(splitMonths(780), { y: '65', m: '0' });
  assert.deepEqual(splitMonths(15), { y: '1', m: '3' });
  assert.deepEqual(splitMonths(null), { y: '', m: '' });
  assert.equal(joinMonths('65', ''), 780); assert.equal(joinMonths('', '15'), 15); assert.equal(joinMonths('', ''), null); assert.ok(Number.isNaN(joinMonths('x', '')));
  assert.equal(monthsText(0), '出生'); assert.equal(monthsText(15), '15 個月'); assert.equal(monthsText(60), '5 歲'); assert.equal(monthsText(83), '6 歲 11 個月');
});

test('stateFromItem → buildItem 往返：42 筆都等於原資料（欄位順序不計）', () => {
  for (const i of ITEMS) {
    const back = buildItem(stateFromItem(i));
    const norm = (o) => JSON.stringify(Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined).sort()));
    assert.equal(norm(back), norm({ ...i, verified: i.verified !== false }), i.id);
  }
});

test('buildItem：空值不輸出、不設上限 ⇒ null、單一月齡 ⇒ 上限＝下限、每年接種 ⇒ recurring', () => {
  const s = { ...emptyState('vaccine.mmr'), id: 'sched.mmr-9', label: 'MMR', ageY: '1', ageM: '', noMax: true, recurring: true, sourceTitle: '', sourceUrl: '' };
  const it = buildItem(s);
  assert.deepEqual(it, { id: 'sched.mmr-9', vaccine: 'vaccine.mmr', label: 'MMR', ageMinMonths: 12, ageMaxMonths: null, stage: 'infant', funded: 'public', recurring: 'yearly', verified: false });
  assert.equal(buildItem({ ...s, noMax: false, maxY: '', maxM: '' }).ageMaxMonths, 12);
});

test('problemsOf：與 CI 同義的錯誤與警告；problemsOfAll 抓跨筆重複', () => {
  const ids = VAX.map((v) => v.id);
  const ok = problemsOf(ITEMS[0], { others: ITEMS.slice(1), vaccineIds: ids });
  assert.deepEqual(errorsOnly(ok), []);
  assert.ok(ok.some((p) => p.field === 'verified' && p.level === 'warn'));
  const bad = problemsOf({ id: 'Sched.X', vaccine: 'vaccine.nope', label: '', ageMinMonths: 24, ageMaxMonths: 12, stage: 'x', funded: 'conditional', startAt: '2026/1/1', source: { title: 'a', url: 'ftp://x' } }, { vaccineIds: ids });
  const fields = errorsOnly(bad).map((p) => p.field);
  for (const f of ['id', 'vaccine', 'label', 'ageMaxMonths', 'stage', 'group', 'startAt', 'sourceUrl']) assert.ok(fields.includes(f), f);
  const dup = problemsOfAll([ITEMS[0], { ...ITEMS[1], id: ITEMS[0].id }], ids);
  assert.ok(dup.some((p) => p.field === 'id' && /已有另一筆/.test(p.message)));
  assert.equal(problemsOfAll(ITEMS, ids).length, 0, '目前主檔零錯誤');
});

test('nextId／sortedForExport／diffSummary', () => {
  assert.equal(nextId('vaccine.hpv', ITEMS), 'sched.hpv-1', 'sched.hpv 已存在但 -1 沒有');
  assert.equal(nextId('vaccine.mmr', ITEMS), 'sched.mmr-3', 'mmr-1、mmr-2、mmr-adult 已有');
  assert.equal(nextId('', []), 'sched.new-1');
  const shuffled = [...ITEMS].reverse();
  assert.deepEqual(sortedForExport(shuffled, VAX.map((v) => v.id)).map((i) => i.id), rowsOf(ITEMS, VAX).flatMap((r) => r.items.map((i) => i.id)));
  const d = diffSummary(ITEMS, [...ITEMS.slice(1).map((i, k) => (k === 0 ? { ...i, verified: true } : i)), { ...ITEMS[0], id: 'sched.new' }]);
  assert.deepEqual(d, { added: ['sched.new'], removed: [ITEMS[0].id], changed: [ITEMS[1].id], dirty: true });
  assert.equal(diffSummary(ITEMS, ITEMS).dirty, false);
});

/* ───────── 後台模板 ───────── */
test('後台 /admin/vaccines/schedule/：登錄、導覽、表單欄位、內嵌資料含 42 筆與 vxs 字串', () => {
  assert.deepEqual(adminVx.pages().map((p) => p.path), ['/admin/vaccines/schedule/']);
  assert.ok(NAV.some((n) => n.key === 'vaxschedule' && n.href === '/admin/vaccines/schedule/'));
  assert.equal(adminVx.meta().adminKey, 'vaxschedule');
  const ctx = makeCtx(site, 'zh-TW', { path: '/admin/vaccines/schedule/', view: 'admin' });
  const h = str(adminVx.render(ctx));
  for (const f of ['vaccine', 'id', 'label', 'dose', 'ageY', 'ageM', 'maxY', 'maxM', 'noMax', 'ageLabel', 'stage', 'funded', 'recurring', 'group', 'interval', 'note', 'startAt', 'endAt', 'sourceTitle', 'sourceUrl', 'verified']) assert.ok(h.includes(`data-f="${f}"`), f);
  for (const id of ['vx-list', 'vx-map', 'vx-table', 'vx-check', 'vx-out', 'vx-dl', 'vx-csv', 'vx-copydiff', 'vx-add', 'vx-del']) assert.ok(h.includes(`id="${id}"`), id);
  const json = JSON.parse(/<script type="application\/json" id="adm-vxs-data">([\s\S]*?)<\/script>/.exec(h)[1]);
  assert.equal(json.items.length, 42);
  assert.equal(json.vaccines.length, VAX.length);
  assert.equal(json.strings['vxs.funded.public'], '公費');
  assert.ok(!/<\/script>/.test(JSON.stringify(json)), '內嵌 JSON 不含 </script>');
  assert.equal((h.match(/data-vx-tab="/g) ?? []).length, 6);
});

/* ───────── 預防接種專區 ───────── */
test('/vaccines/ 預防接種專區：七格、新內容連結與待確認徽章、/v1 連結無語言前綴', () => {
  const h = str(vaccines.render(makeCtx(site, 'zh-TW', { path: '/vaccines/', alternates: ['zh-TW', 'en'] }), {}));
  assert.match(h, /id="vx-hub-h"[^>]*>預防接種專區/);
  assert.equal((h.match(/class="c-card vx-hub__card"/g) ?? []).length, 7);
  for (const k of ['/new_cdc_prototype/apply/vaccine-injury-compensation/', '/new_cdc_prototype/vaccines/committees/', '/new_cdc_prototype/topics/vaccine-fund-donation/', '/new_cdc_prototype/apply/vaccination-record-reissue/', '/new_cdc_prototype/policy/legal/', '/new_cdc_prototype/documents/', '/new_cdc_prototype/data/', '/new_cdc_prototype/v1/immunization-schedule.json']) assert.ok(h.includes(`href="${k}"`), k);
  assert.ok(h.indexOf('vxs-entry') < h.indexOf('vx-hub-h') && h.indexOf('vx-hub-h') < h.indexOf('id="vx-list"'), '專區在地圖入口卡之後、疫苗清單之前');
  const hub = h.slice(h.indexOf('vx-hub-h'), h.indexOf('id="vx-list"'));
  assert.ok((hub.match(/c-pill--warn">待承辦人確認/g) ?? []).length >= 2, '新頁標待確認');
  const en = str(vaccines.render(makeCtx(site, 'en', { path: '/vaccines/', alternates: ['zh-TW', 'en'] }), {}));
  assert.match(en, /Immunization programme/);
  assert.match(en, /href="\/new_cdc_prototype\/v1\/immunization-schedule\.json"/);
  assert.doesNotMatch(en, /\/en\/v1\//);
});

test('新內容：受害救濟服務頁與法規委員會頁存在、verification pending、路徑正確', () => {
  const svc = site.collections.services.find((s) => s.id === 'service.vaccine-injury-compensation');
  assert.ok(svc && svc.status === 'published' && svc.verification?.status === 'pending');
  assert.ok(svc.verification.pendingItems.length >= 4 && svc.verification.sources.every((s) => s.verified === false));
  assert.equal(svc.gov?.unverified, true);
  const pg = site.collections.pages.find((p) => p.id === 'page.immunization-committees');
  assert.ok(pg && pg.slug === 'vaccines/committees' && pg.verification?.status === 'pending');
  assert.match(pg.bodyMarkdown, /\/apply\/vaccine-injury-compensation\//);
});
