// 首頁疫情卡四種樣版（cardStyle）：前台渲染、退回規則、schema、疫情發布表單的選擇器與預覽。
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeCtx } from '../scripts/lib/pages.mjs';
import { sitCard, CARD_STYLES, cardStyleOf } from '../src/templates/public/_partials.mjs';
import * as home from '../src/templates/public/home.mjs';
import * as adminSit from '../src/templates/admin/situation.mjs';
import { validateSite } from '../scripts/lib/validate.mjs';
import { govern } from './helpers.mjs';

const site = govern();
const ctx = (lang = 'zh-TW') => makeCtx(site, lang, { path: '/', alternates: ['zh-TW', 'en'] });
const flu = site.situation.items.find((i) => i.disease === 'disease.influenza');
const str = (r) => String(r);

test('四種樣版都有標籤與說明；沒填或填錯退回 standard', () => {
  assert.deepEqual(Object.keys(CARD_STYLES), ['standard', 'chart', 'advice', 'minimal']);
  for (const v of Object.values(CARD_STYLES)) assert.ok(v.label && v.desc);
  assert.equal(cardStyleOf({}), 'standard');
  assert.equal(cardStyleOf({ cardStyle: 'fancy' }), 'standard');
  assert.equal(cardStyleOf({ cardStyle: 'minimal' }), 'minimal');
});

test('standard：數字、指標、建議都在', () => {
  const h = str(sitCard(ctx(), { ...flu, cardStyle: 'standard' }));
  assert.match(h, /c-sit-card--style-standard/);
  for (const k of ['c-sit-card__metric', 'c-sit-card__desc', 'c-sit-card__advice', '12%', flu.advice]) assert.ok(h.includes(k), k);
  assert.ok(!h.includes('c-sit-card__spark'));
});

test('chart：多一條近週趨勢線與頭尾週標；沒有 weekly 時退回 standard', () => {
  const h = str(sitCard(ctx(), { ...flu, cardStyle: 'chart' }));
  assert.match(h, /c-sit-card--style-chart/);
  assert.match(h, /<figure class="c-sit-card__spark"><svg class="c-chart c-chart--spark"/);
  assert.match(h, /<span>W33<\/span><span>近 6 週<\/span><span>W38<\/span>/);
  assert.ok(h.includes(flu.advice));
  const en = str(sitCard(ctx('en'), { ...flu, cardStyle: 'chart' }));
  assert.match(en, /last 6 weeks/);
  const noWeekly = str(sitCard(ctx(), { ...flu, cardStyle: 'chart', weekly: undefined, weeklyLabels: undefined }));
  assert.match(noWeekly, /c-sit-card--style-standard/);
  assert.ok(!noWeekly.includes('c-sit-card__spark'));
});

test('advice：建議放最前面成為主句，數字退到一行小字', () => {
  const h = str(sitCard(ctx(), { ...flu, cardStyle: 'advice' }));
  assert.match(h, /c-sit-card--style-advice/);
  assert.ok(h.indexOf('c-sit-card__lead') < h.indexOf('c-sit-card__line'));
  assert.match(h, new RegExp(`<p class="c-sit-card__lead">${flu.advice}</p>`));
  assert.match(h, /<b class="c-sit-card__num">12%<\/b>/);
  assert.ok(!h.includes('c-sit-card__metric'));
});

test('minimal：只有疾病、狀態與一行指標；沒有建議', () => {
  const h = str(sitCard(ctx(), { ...flu, cardStyle: 'minimal' }));
  assert.match(h, /c-sit-card--style-minimal/);
  assert.match(h, /c-sit-card__line/);
  assert.ok(!h.includes(flu.advice));
  assert.ok(!h.includes('c-sit-card__advice'));
  assert.match(h, /<span class="sr-only">上升<\/span>/, '趨勢仍有讀屏文字');
});

test('首頁：釘選疾病各依 current.json 的 cardStyle 渲染（示範資料涵蓋四種）', () => {
  const h = str(home.render(ctx()));
  const styles = new Set([...h.matchAll(/c-sit-card--style-(\w+)/g)].map((m) => m[1]));
  for (const k of Object.keys(CARD_STYLES)) assert.ok(styles.has(k), `首頁缺 ${k}`);
});

test('schema：cardStyle 只接受四個值', () => {
  const bad = structuredClone(site);
  bad.situation.items[0].cardStyle = 'fancy';
  const errs = validateSite(bad).filter((e) => /cardStyle/.test(e));
  assert.ok(errs.length >= 1, '應擋下不合法的 cardStyle');
  assert.deepEqual(validateSite(site), [], '目前 current.json 應通過');
});

test('疫情發布表單：頁名已改、四個樣版單選、預覽與並排比較容器、現況表有樣版欄', () => {
  const h = str(adminSit.render(makeCtx(site, 'zh-TW', { path: '/admin/situation/', alternates: ['zh-TW'] })));
  assert.match(adminSit.meta().title, /^疫情發布/);
  assert.ok(!h.includes('態勢發布'));
  for (const k of Object.keys(CARD_STYLES)) assert.match(h, new RegExp(`name="s-style" value="${k}"`));
  for (const k of ['id="s-preview"', 'id="s-compare"', 'id="s-style-now"', '<th scope="col">樣版</th>']) assert.ok(h.includes(k), k);
  assert.match(h, /<td>趨勢圖<\/td>/);
});
