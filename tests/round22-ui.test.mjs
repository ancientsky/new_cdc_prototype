// 第二十二輪：借 TinaCMS 的後台設計——右側即時頁面預覽（點區塊跳欄位）、欄位群組摺疊、黏住的儲存列、結果過期提示、前台「編輯這頁」浮動按鈕。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { govern } from './helpers.mjs';
import { makeCtx } from '../scripts/lib/pages.mjs';
import * as publish from '../src/templates/admin/publish.mjs';
import { renderPreviewHtml, FIELD_MAP } from '../src/client/admin/page-preview.js';
import { STRINGS } from '../src/client/i18n.js';

const site = govern('2026-10-09');
const ctx = makeCtx(site, 'zh-TW', { path: '/admin/publish/', alternates: ['zh-TW'] });
const page = String(publish.render(ctx));
const form = (over = {}) => ({ type: 'faq', title: '', body: '', owner: 'unit.acute-infectious', period: '6', audience: ['public'], tasks: [], basedOn: [], langs: { en: { on: true, reason: '' }, ja: { on: false, reason: '' } }, id: '', publishAtLocal: '', publishAt: null, urgent: false, extra: {}, ...over });
const helpers = { md: (m) => `<p>${m}</p>`, typeLabel: (t) => ({ faq: 'Q&A', media: '影音' }[t] ?? t), unitName: (id) => ({ 'unit.acute-infectious': '急性傳染病組' }[id] ?? id), laneLabel: '一般車道', today: '2026-10-09', langLabel: (c) => ({ 'zh-TW': '繁體中文', en: 'English', ja: '日本語' }[c] ?? c), assets: [] };

test('上架頁：右欄有「頁面預覽／預處理結果」兩頁籤，預處理結果的既有 id 都還在', () => {
  assert.match(page, /id="pt-prev"[^>]*aria-selected="true"/);
  assert.match(page, /id="pt-res"[^>]*aria-selected="false"/);
  for (const id of ['page-preview', 'pp-prev', 'pp-res', 'pre-result', 'pre-sec', 'pre-stale', 'btn-rerun', 'pt-res-badge']) assert.ok(page.includes(`id="${id}"`), `缺 #${id}`);
  assert.match(page, /class="adm-result adm-result--sticky"/);
  assert.equal((page.match(/class="adm-tabs adm-tabs--editor"/g) ?? []).length, 1, '內文編輯器的三個頁籤不受影響');
});

test('上架頁：提供語言與發布時間是可摺疊群組（summary 顯示目前值）；內容 ID 與動作列不摺疊', () => {
  assert.match(page, /<details class="adm-group" id="g-langs"><summary>.*id="g-langs-sum"/);
  assert.match(page, /<details class="adm-group" id="g-timing"><summary>.*id="g-timing-sum"/);
  assert.match(page, /id="f-timing"/); assert.match(page, /id="f-publish-at"/); assert.match(page, /id="f-langs"/);
  const idPos = page.indexOf('id="f-id"'), detailsEnd = page.lastIndexOf('</details>', page.indexOf('id="pub-actions"'));
  assert.ok(idPos > detailsEnd, '內容 ID 在群組之外');
  assert.match(page, /class="adm-actions adm-actions--sticky" id="pub-actions"/);
  assert.match(page, /id="f-savestate"/);
  assert.match(page, /id="btn-save" title="Ctrl\+S"/);
});

test('renderPreviewHtml：每個區塊都有 data-field 且對應到 FIELD_MAP；空值顯示佔位字、不顯示 undefined', () => {
  const html = renderPreviewHtml(form(), helpers);
  const fields = [...html.matchAll(/data-field="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(fields.length >= 10);
  for (const f of fields) assert.ok(FIELD_MAP[f], `預覽區塊 ${f} 沒有對應欄位`);
  for (const f of ['f-title', 'f-body', 'f-owner', 'f-based-q', 'f-langs', 'f-timing', 'f-id', 'asset-panel', 'f-audience', 'f-tasks', 'f-type']) assert.ok(fields.includes(f), `缺區塊 ${f}`);
  assert.doesNotMatch(html, /undefined|null/);
  assert.match(html, /尚未填標題/); assert.match(html, /尚未填內文/);
  assert.match(html, /急性傳染病組/); assert.match(html, /一般車道/);
  assert.match(html, /繁體中文.*English/); assert.match(html, /不提供：日本語/);
  assert.match(html, /核准後立即上線/); // 第三十輪：給同事看的字不用「合併」
  assert.match(html, /role="button"/); assert.match(html, /tabindex="0"/);
});

test('renderPreviewHtml：標題與內文會跳脫，不能注入 HTML；排程與緊急顯示在頁尾', () => {
  const html = renderPreviewHtml(form({ title: '<script>alert(1)</script>', body: '', id: '"><img src=x>', publishAtLocal: '2026-10-10T09:00' }), { ...helpers, md: undefined });
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img src=x>'));
  assert.match(html, /排程：2026-10-10 09:00/);
  assert.match(renderPreviewHtml(form({ urgent: true }), helpers), /緊急發布/);
});

test('renderPreviewHtml：型別專屬區塊（影音逐字稿、澄清查證結果、文件版次）', () => {
  assert.match(renderPreviewHtml(form({ type: 'media', extra: { chapters: '0 開場\n30 症狀', transcript: '' } }), helpers), /逐字稿必填/);
  assert.match(renderPreviewHtml(form({ type: 'media', basedOn: [] }), helpers), /影音必填依據正本/);
  assert.match(renderPreviewHtml(form({ type: 'clarification', extra: { claim: '喝漂白水可防疫', verdict: 'false' } }), helpers), /不實/);
  assert.match(renderPreviewHtml(form({ type: 'document', extra: { family: 'doc.x', version: '115.01.01' } }), helpers), /115\.01\.01/);
});

test('FIELD_MAP 指到的欄位在上架頁都存在', () => {
  for (const [field, m] of Object.entries(FIELD_MAP)) {
    const sels = `${m.focus},${m.within}`.split(',').map((s) => s.trim()).filter((s) => /^#[\w-]+$/.test(s));
    for (const s of sels) assert.ok(page.includes(`id="${s.slice(1)}"`), `${field}：頁面上沒有 ${s}`);
  }
});

test('publish.js 與 page-preview.js：預覽掛載、群組摘要、結果過期、Ctrl+S、未選檔圖片不發請求', () => {
  const js = fs.readFileSync(new URL('../src/client/admin/publish.js', import.meta.url), 'utf8');
  for (const s of ['initPagePreview(', 'paintGroups()', 'paintStale()', "paneTab('res')", "key.toLowerCase() === 's'", 'data:image/svg+xml', 'cdc.admin.paneTab']) assert.ok(js.includes(s), `publish.js 缺 ${s}`);
  const pv = fs.readFileSync(new URL('../src/client/admin/page-preview.js', import.meta.url), 'utf8');
  assert.ok(pv.includes("d.open = true"), '點預覽要打開摺疊群組');
  assert.ok(pv.includes("addEventListener('focusin'"), '反向亮起');
  assert.ok(pv.includes('adm-img-missing'));
});

test('前台「編輯這頁」浮動按鈕：只在有後台工作階段時由 ui.js 插入；七語字串齊全；樣式存在', () => {
  const ui = fs.readFileSync(new URL('../src/client/ui.js', import.meta.url), 'utf8');
  assert.ok(ui.includes("store.get('cdc.admin.session')"));
  assert.ok(ui.includes("'.c-page-data__staff a'"));
  assert.ok(ui.includes('c-editfab'));
  assert.match(ui, /typeof s\.exp !== 'number' \|\| Date\.now\(\) >= s\.exp/);
  const langs = Object.keys(STRINGS); assert.equal(langs.length, 7);
  for (const k of ['pagedata.editfab', 'pagedata.editfab.aria']) for (const l of langs) assert.ok(STRINGS[l][k], `${k} 缺 ${l}`);
  const css = fs.readFileSync(new URL('../src/styles/components.css', import.meta.url), 'utf8');
  assert.ok(css.includes('.c-editfab{position:fixed'));
  assert.ok(css.includes('@media print{.c-editfab{display:none}}'));
});
