// 2026-10-21 資安檢查（上架小幫手擴充沿用 pdf-manuscript.js／bulletin-rules.js 時做的模糊測試）：特製 PDF 文字層會讓切段卡住好幾秒。
//   一、行內很長的連續空白：splitManuscript 的 /[ \t]+$/ 與 DOI 規則的 \s{2,}、linesFromItems 的 /\s+$/ 都是 O(n²)（5 萬個空白要 6 秒）。
//   二、同一列上萬個字塊：「疊在別的字塊裡面」的過濾是每塊跟同列每塊比（O(n²)，同列 2 萬塊約 3 秒）。
// 修法：字塊內與行內連續空白收斂到 40 個、每頁最多 15,000 個字塊、疊字過濾改成 O(n log n)。這裡斷言兩種輸入都在 1 秒內切完。
import test from 'node:test';
import assert from 'node:assert/strict';
import { capItems, dropOverlaid, linesFromItems, manuscriptText, MAX_ITEM_SPACES, MAX_PAGE_ITEMS } from '../src/client/admin/pdf-manuscript.js';
import { splitManuscript } from '../src/client/bulletin-rules.js';

const it = (str, x, y, w = str.length * 9) => ({ str, x, y, w, h: 10, size: 10 });
const timed = (f) => {
  const t0 = performance.now();
  const value = f();
  return { value, ms: performance.now() - t0 };
};

test('a + 50,000 個空白 + b：字塊與貼上的文字都在 1 秒內切完，空白收斂到 40 個', () => {
  const s = `a${' '.repeat(50000)}b`;
  const viaPdf = timed(() => splitManuscript(manuscriptText([{ items: [it(s, 100, 50, 300)] }])));
  assert.ok(viaPdf.ms < 1000, `PDF 字塊切段花了 ${viaPdf.ms.toFixed(0)} ms`);
  assert.match(JSON.stringify(viaPdf.value), new RegExp(`a {${MAX_ITEM_SPACES}}b`));
  const pasted = timed(() => splitManuscript(`DOI：10.1234/x\n${s}\n`));
  assert.ok(pasted.ms < 1000, `貼上文字切段花了 ${pasted.ms.toFixed(0)} ms`);
  assert.equal(pasted.value.meta.doi, '10.1234/x', '收斂空白不影響標籤欄位');
});

test('同列 20,000 個字塊：1 秒內切完；每頁只取前 15,000 個', () => {
  const items = Array.from({ length: 20000 }, (_, i) => it('字', i * 9, 50));
  const r = timed(() => splitManuscript(manuscriptText([{ items }])));
  assert.ok(r.ms < 1000, `同列字塊切段花了 ${r.ms.toFixed(0)} ms`);
  assert.equal(capItems(items).length, MAX_PAGE_ITEMS);
  assert.equal(linesFromItems(items)[0].text.length, MAX_PAGE_ITEMS);
  // 全部疊在同一個位置：也不能退化成 O(n²)，只留第一個
  const stacked = Array.from({ length: 20000 }, () => it('字', 100, 50));
  const s = timed(() => splitManuscript(manuscriptText([{ items: stacked }])));
  assert.ok(s.ms < 1000, `疊字切段花了 ${s.ms.toFixed(0)} ms`);
  assert.equal(linesFromItems(stacked)[0].text, '字');
});

test('dropOverlaid 與原本的兩兩比對結果相同', () => {
  const inside = (t, o) => o.x <= t.x + (t.size || t.h || 10) * 0.25 && o.x + (o.w || 0) >= t.x + (t.w || 0) - (t.size || t.h || 10) * 0.25;
  const naive = (arr) =>
    arr.filter((t, i) => !arr.some((o, k) => k !== i && inside(t, o) && ((o.w || 0) > (t.w || 0) || ((o.w || 0) === (t.w || 0) && k < i))));
  let seed = 7;
  const rnd = (n) => ((seed = (seed * 48271) % 2147483647), seed % n);
  for (let trial = 0; trial < 3000; trial++) {
    const row = Array.from({ length: 1 + rnd(12) }, () => ({
      str: 'x',
      x: rnd(40),
      w: [0, undefined, rnd(30), rnd(5)][rnd(4)],
      size: [10, 0, 8][rnd(3)],
      h: [undefined, 6, 12][rnd(3)],
    }));
    assert.deepEqual(dropOverlaid(row), naive(row), JSON.stringify(row));
  }
});
