// 第三十七輪：「2 歲前要打哪些疫苗」答錯／查無（Yulun 2026-10-11）。
// 原因一：「N 歲前」被「單純 N 歲」規則吃掉，當成 2 歲那一年（24–35 個月）。
// 原因二：醫事人員檢視把疫苗問句改判 professional，年齡＋「哪些疫苗」沒走時程主檔，掉進全文檢索而查無或答成孕婦 Tdap。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../site.config.mjs';
import { loadSite } from '../scripts/lib/load.mjs';
import { applyGovernance } from '../scripts/lib/governance.mjs';
import { buildSearchIndex } from '../scripts/lib/index-builder.mjs';
import { applyConsistency } from '../scripts/lib/consistency.mjs';
import { engineFromSite } from '../eval/run-eval.mjs';
import { ageProfileOf, WHICH_VACCINE_RE } from '../src/client/answer/structured.js';

let ENGINE = null;
function engine() {
  if (ENGINE) return ENGINE;
  const site = loadSite(config); site.today = '2026-10-11';
  applyGovernance(site); site.searchIndex = buildSearchIndex(site); applyConsistency(site);
  ENGINE = engineFromSite(site);
  return ENGINE;
}

test('「N 歲前／以前／之前」＝出生到未滿 N 歲', () => {
  for (const q of ['2歲前要打哪些疫苗', '兩歲以前要打哪些疫苗', '寶寶 2 歲之前要打什麼']) {
    const p = ageProfileOf(q);
    assert.equal(p.minMonths, 0, q);
    assert.equal(p.maxMonths, 23, q);
    assert.equal(p.label, '2 歲前', q);
  }
  const m = ageProfileOf('6個月前要打哪些疫苗');
  assert.deepEqual([m.minMonths, m.maxMonths], [0, 5]);
});

test('原有寫法不受影響：2 歲、滿一歲、65 歲以上、未滿 5 歲、3 個月前打過', () => {
  assert.deepEqual([ageProfileOf('2歲要打哪些疫苗').minMonths, ageProfileOf('2歲要打哪些疫苗').maxMonths], [24, 35]);
  assert.equal(ageProfileOf('滿一歲的小孩要打什麼疫苗').minMonths, 12);
  assert.equal(ageProfileOf('65 歲以上可以打哪些公費疫苗').maxMonths, null);
  assert.equal(ageProfileOf('未滿5歲流感').maxMonths, 59);
  // 「3 個月前打過」是時間（3 個月以前），不是年齡上限
  assert.notEqual(ageProfileOf('3個月前打過五合一，現在要打什麼')?.label, '3 個月前');
});

test('「疫苗有哪些」也算問哪些疫苗', () => {
  assert.ok(WHICH_VACCINE_RE.test('寶寶2歲前要打的疫苗有哪些'));
  assert.ok(WHICH_VACCINE_RE.test('長者的公費疫苗是什麼'));
});

for (const view of ['public', 'pro']) {
  test(`「2歲前要打哪些疫苗」（${view}）由時程主檔列出 0–23 個月的公費疫苗，不截斷`, () => {
    const r = engine().answer('2歲前要打哪些疫苗', { view });
    assert.equal(r.intent, 'vaccine');
    assert.ok(r.schedule?.structured, '要走時程主檔');
    const txt = r.sentences.map((s) => s.text).join('\n');
    for (const v of ['B 型肝炎', '五合一', '肺炎鏈球菌', '卡介苗', 'MMR', '水痘', 'A 型肝炎', '日本腦炎']) assert.ok(txt.includes(v), `${view} 少了 ${v}`);
    assert.ok(!/另有 \d+ 種公費疫苗/.test(txt), '10 種公費疫苗應全列');
    assert.ok(!txt.includes('Tdap'));
  });
}

test('醫事人員檢視：帶專業詞的疫苗問句仍走專業檢索，不被時程攔走', () => {
  const r = engine().answer('65歲以上哪些疫苗的不良事件要通報', { view: 'pro' });
  assert.ok(!r.schedule?.structured);
});

test('頁籤列不會多出直向小捲軸（Yulun 2026-10-11：時程地圖標題右方的小捲軸）', async () => {
  const fs = await import('node:fs');
  const css = fs.readFileSync(new URL('../src/styles/components.css', import.meta.url), 'utf8');
  const list = css.match(/\.c-tabs__list\{display:flex[^}]*\}/)[0];
  const btn = css.match(/\.c-tabs__list button\{[^}]*\}/)[0];
  assert.match(list, /overflow-y:hidden/, 'overflow-x:auto 會讓 overflow-y 變 auto，要明寫 hidden');
  assert.doesNotMatch(btn, /margin-bottom:-/, '按鈕用負邊距壓線會超出列表高度');
});
