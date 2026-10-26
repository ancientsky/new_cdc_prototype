// 第六十六輪（2026-10-26）：Yulun 手機實測「什麼時候要戴保險套」拒答（站內查無直接答案）。
// 原因：問句端的功能詞只拿掉「什麼」，留下「時候」「麼時」當主題詞——它們在語料裡很少見（IDF 高），
// 把檢索拉去「30 日從什麼時候開始算」的資料申請 FAQ，涵蓋率 0.23 過不了門檻；「要戴保險套嗎」「何時要戴保險套」都答得出來。
// 修法：「什麼時候」整個視為疑問詞（text.js STOP_BIGRAMS 加「麼時」「時候」；rules.js QUERY_FUNC_RE 加「什麼時候｜時候」）。說明見 docs/ask-search-llm.md §20。
// 另：「進階」裡的揭露表在手機寬度把整塊撐出畫面（details 的 flex:0 0 auto ⇒ 寬度＝內容 max-content），components.css ≤720px 改佔滿一列。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../site.config.mjs';
import { loadSite } from '../scripts/lib/load.mjs';
import { applyGovernance } from '../scripts/lib/governance.mjs';
import { buildSearchIndex } from '../scripts/lib/index-builder.mjs';
import { applyConsistency } from '../scripts/lib/consistency.mjs';
import { tokenize } from '../src/client/answer/text.js';
import { QUERY_FUNC_RE } from '../src/client/answer/rules.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let SITE = null;
function site() {
  if (SITE) return SITE;
  SITE = loadSite(config);
  SITE.today = '2026-10-01';
  applyGovernance(SITE);
  SITE.searchIndex = buildSearchIndex(SITE);
  applyConsistency(SITE);
  return SITE;
}
let ENGINE = null;
async function engine() {
  if (ENGINE) return ENGINE;
  const { engineFromSite } = await import('../eval/run-eval.mjs');
  return (ENGINE = engineFromSite(site()));
}
const ask = async (q, opts = {}) => (await engine()).answer(q, { lang: 'zh-TW', view: 'public', ...opts });
const cited = (r) => (r.sources ?? []).map((s) => s.contentId ?? String(s.id).split('#')[0]);

test('「什麼時候」整個是疑問詞：問句端不留「時候」「麼時」；文件端照舊；「何時」「多久」這類會對到答案句的照留', () => {
  const q = tokenize('什麼時候要戴保險套', { query: true });
  assert.ok(!q.includes('時候') && !q.includes('麼時'), q.join(','));
  assert.ok(q.includes('保險') && q.includes('險套'));
  assert.ok(tokenize('30 日從什麼時候開始算？').includes('時候'), '文件端不動');
  assert.ok(tokenize('何時要戴保險套', { query: true }).includes('何時'));
  assert.ok(tokenize('隔離多久', { query: true }).includes('多久'));
  // 相關度分母也一樣：去功能詞後不剩「時候」
  assert.ok(!'什麼時候要戴保險套'.replace(QUERY_FUNC_RE, ' ').includes('時候'));
  assert.ok('生病的時候可以打疫苗嗎'.replace(QUERY_FUNC_RE, ' ').includes('生病'), '「的時候」拿掉後主題詞還在');
});

test('「什麼時候要戴保險套」答得出來：引性傳染病專區／愛滋，不拉到資料申請 FAQ', async () => {
  const r = await ask('什麼時候要戴保險套');
  assert.equal(r.refused, false, JSON.stringify(r.refusal));
  const ids = cited(r);
  assert.ok(ids.some((id) => ['topic.sti-resources', 'disease.hiv', 'media.hiv-anonymous-testing'].includes(id)), ids.join(','));
  assert.ok(!ids.includes('service.case-data-request') && !ids.includes('faq.hepb-newborn'), ids.join(','));
  assert.ok(r.sentences.some((s) => s.text.includes('保險套')), '答案句要講到保險套');
});

test('其他「什麼時候」問句不退步：流感疫苗開打、口罩、發燒就醫', async () => {
  const flu = await ask('什麼時候要打流感疫苗');
  assert.equal(flu.refused, false);
  assert.ok(cited(flu).some((id) => /influenza|flu/.test(id)), cited(flu).join(','));
  const mask = await ask('什麼時候要戴口罩');
  assert.equal(mask.refused, false);
  assert.ok(!cited(mask).includes('service.case-data-request'), cited(mask).join(','));
  const fever = await ask('發燒什麼時候要就醫');
  assert.equal(fever.refused, false);
  assert.ok(!cited(fever).includes('service.case-data-request'), cited(fever).join(','));
});

test('手機寬度：「進階」區塊佔滿一列、允許縮小，揭露表的長句換行而不是撐出畫面', () => {
  const css = read('src/styles/components.css');
  const mobile = css.slice(css.indexOf('@media (max-width:720px)'));
  assert.match(mobile, /\.c-advanced\{flex:1 1 100%;min-width:0;max-width:100%\}/);
  assert.match(mobile, /\.c-advanced__body\{position:static;width:auto;max-width:100%\}/);
  assert.match(css, /\.c-deflist dd\{[^}]*min-width:0;overflow-wrap:anywhere/);
});
