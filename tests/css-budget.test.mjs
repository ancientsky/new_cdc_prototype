// 第七十一輪（docs/architecture-ux-review.md 2.3、4.6、U6）：CSS 預算。
// 為什麼要有預算：JS 有預算（第三十四輪起）所以被拆了三次；CSS 沒有，components.css 就一路長到 117 KB、每頁都載。
// 「有預算才會拆」——先凍結現況，之後每一輪只能往下收，不能往上加：
//   1. components.css 不超過 120 KB；
//   2. @media (max-width: N) 的 N 只能用下面白名單裡的值（現況），收斂時從表上刪；
//   3. font-size 不得出現小於字級下限 --fs-xs（0.8125rem = 13 px）的硬編碼 rem／px 值；例外寫在白名單並說明理由。
// 本測試只看 src/styles/*.css；模板內嵌的 <style>（例如 travel.mjs、pro/_styles.mjs）由各自的模板測試管。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../scripts/lib/load.mjs';

const STYLES = path.join(ROOT, 'src/styles');
const files = fs.readdirSync(STYLES).filter((f) => f.endsWith('.css')).sort();
const read = (f) => fs.readFileSync(path.join(STYLES, f), 'utf8');

const COMPONENTS_MAX_BYTES = 120 * 1024; // 122880

// 斷點白名單（第七十一輪現況）。之後收斂時從這張表刪；新增斷點請先想能不能用表上的值。
// 640／720／760／900／959／1100 是主要斷點；380、480、520、600、860 各只有一兩處使用，是優先收斂的對象。
const BREAKPOINTS = new Set([380, 480, 520, 600, 640, 720, 760, 860, 900, 959, 1100]);

// 字級下限例外：純裝飾或 SVG 座標單位，不是一般閱讀文字。格式：'檔名|選擇器開頭|值'
const FONT_SIZE_ALLOW = new Map([
  // 疫苗接種時程地圖的 SVG 刻度與游標文字：SVG 使用者座標單位，刻度間距與標籤寬度依這個字級計算，改字級要連帶改版面（src/client/vaxschedule.js）
  ['components.css|.vxs-axislabel|12px', 'SVG 座標單位，版面依此計算'],
  ['components.css|.vxs-cursor|11px', 'SVG 游標月齡標記，隨滑鼠移動的暫時提示'],
]);
// 註：em 為相對單位（例如上標引用編號 .c-cite 的 .75em、.c-teb__sup 的 .7em、列印網址的 .8em），本測試不檢查；
// 上標引用編號是裝飾性的上標，可點區域另有 padding 補足。

const REM_MIN = 0.8125;
const PX_MIN = 13;

test('components.css 不超過 120 KB', () => {
  const bytes = fs.statSync(path.join(STYLES, 'components.css')).size;
  assert.ok(
    bytes <= COMPONENTS_MAX_BYTES,
    `src/styles/components.css 為 ${bytes} bytes，超過預算 ${COMPONENTS_MAX_BYTES} bytes（120 KB）。` +
      '它每一頁都會載入：新元件只給一個專區用時，另開 CSS 檔（例如 src/styles/careers.css），由該模板的 styles[] 帶入，不要放進 components.css；' +
      '或先刪掉沒用到的規則。不要調高預算。',
  );
});

test('@media (max-width: N) 只能用白名單斷點', () => {
  const bad = [];
  for (const f of files) {
    const css = read(f);
    // 容許 max-width:760px 與 max-width: 760px 兩種空白寫法
    for (const m of css.matchAll(/@media[^{]*?max-width\s*:\s*([\d.]+)px/g)) {
      const n = Number(m[1]);
      if (!BREAKPOINTS.has(n)) bad.push(`${f}：max-width ${n}px（第 ${css.slice(0, m.index).split('\n').length} 行）`);
    }
  }
  assert.deepEqual(bad, [], `出現白名單以外的斷點；請改用 ${[...BREAKPOINTS].join('、')} 其中之一：\n${bad.join('\n')}`);
});

test('font-size 不得硬編碼小於 --fs-xs（0.8125rem／13px）的值', () => {
  const bad = [];
  const used = new Set();
  for (const f of files) {
    const css = read(f).replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' ')); // 去掉註解但保留行號
    for (const m of css.matchAll(/([^{}]*)\{[^{}]*?font-size\s*:\s*([\d.]+)(rem|px)\b/g)) {
      const [, selRaw, num, unit] = m;
      const v = Number(num);
      if (unit === 'rem' ? v >= REM_MIN : v >= PX_MIN) continue;
      const sel = selRaw.trim().split(',')[0].trim().split(/\s+/)[0]; // 第一個選擇器的第一段，例如「.vxs-cursor text」→「.vxs-cursor」
      const key = `${f}|${sel}|${num}${unit}`;
      if (FONT_SIZE_ALLOW.has(key)) { used.add(key); continue; }
      bad.push(`${f}：${selRaw.trim().slice(-60)} font-size:${num}${unit}（第 ${css.slice(0, m.index).split('\n').length + selRaw.split('\n').length - 1} 行）`);
    }
  }
  assert.deepEqual(bad, [], `請改用 var(--fs-xs) 或更大的 token；確為裝飾用途才加進本檔的 FONT_SIZE_ALLOW 並寫理由：\n${bad.join('\n')}`);
  // 白名單不可留過期項目：規則改掉了就要從表上刪
  assert.deepEqual([...FONT_SIZE_ALLOW.keys()].filter((k) => !used.has(k)), [], '白名單有已不存在的項目，請刪除');
});

test('--fs-xs 是 0.8125rem（13 px）', () => {
  assert.match(read('tokens.css'), /--fs-xs:\s*\.8125rem;/);
});
