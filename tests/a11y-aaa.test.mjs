// 第七十六輪：本站選做的 WCAG AAA 項目（docs/a11y.md 第 13 節）。AA 仍是標章目標；這些是逐項宣告的加分項，每一項都要有自動檢查才不會悄悄退步。
//   2.4.13 焦點外觀：焦點框的兩個顏色，對每一個背景 token 至少有一色 ≥ 3:1；兩色之間 ≥ 9:1（技法 C40）
//   2.3.3 來自互動的動畫：全站 prefers-reduced-motion 規則存在；JS 的平滑捲動也看這個設定
//   2.5.5 目標尺寸：手機斷點有 44 px 的規則（實際量測在 npm run a11y 之外，見 docs/a11y.md §13.3）
//   3.1.4 縮寫：建置期 <abbr title> 只標主要內容段落裡第一次出現的縮寫，不碰標題、連結、code、屬性
//   2.4.8 目前位置：內容頁都有麵包屑（nav＋aria-current＋BreadcrumbList）
// 2.4.12 焦點完全不遮蔽由 npm run a11y 的焦點走查擋（要開瀏覽器，不在這裡）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../scripts/lib/load.mjs';
import { abbrTable, markAbbreviations, ABBR_EXTRA } from '../scripts/lib/abbr.mjs';
import { checkHtml } from '../scripts/a11y-tw.mjs';
import { inlineLinkTitles } from '../scripts/lib/a11y-text.mjs';
import { t as i18nT } from '../src/client/i18n.js';
import { govern } from './helpers.mjs';
import { makeCtx } from '../scripts/lib/pages.mjs';

const css = (f) => fs.readFileSync(path.join(ROOT, 'src/styles', f), 'utf8');
const tokens = Object.fromEntries([...css('tokens.css').matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
const hex = (v) => {
  let h = String(v).trim().replace('#', '');
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  return /^[0-9a-f]{6}$/i.test(h) ? [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) : null;
};
const lum = (rgb) => {
  const [r, g, b] = rgb.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [x, y] = [lum(hex(a)), lum(hex(b))];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

// 焦點框會出現在上面的背景：頁面底色、卡片、淺色區塊、品牌綠、深色頁尾與橫幅、狀態色底
const BG_TOKENS = ['white', 'paper', 'green-50', 'green-100', 'blue-50', 'navy-100', 'line-2', 'green-600', 'green-700', 'green-800', 'green-900', 'navy-700', 'navy-900', 'ink', 'paused-bg', 'theme-header-bg'];
const BG_SUFFIX = /-bg$/;

test('2.4.13：焦點框兩色對每個背景 token 至少一色 ≥ 3:1，兩色之間 ≥ 9:1（C40）', () => {
  const outer = tokens['focus-color'];
  const inner = tokens['focus-inner'];
  assert.ok(hex(outer) && hex(inner), `tokens.css 要有 --focus-color 與 --focus-inner（實得 ${outer}、${inner}）`);
  assert.match(tokens.focus, /var\(--focus-color\)/, '--focus 要用 --focus-color，兩處不會各改各的');
  assert.match(tokens['focus-ring'], /var\(--focus-inner\)/);
  assert.ok(ratio(outer, inner) >= 9, `兩色對比 ${ratio(outer, inner).toFixed(2)}:1 < 9:1`);
  const bgs = [...BG_TOKENS, ...Object.keys(tokens).filter((k) => BG_SUFFIX.test(k))].filter((k) => hex(tokens[k]));
  assert.ok(bgs.length >= 20, `背景 token 太少（${bgs.length}），是不是 tokens.css 的格式變了`);
  const bad = bgs.filter((k) => Math.max(ratio(outer, tokens[k]), ratio(inner, tokens[k])) < 3);
  assert.deepEqual(bad, [], `焦點框在這些背景上兩色都不到 3:1：${bad.map((k) => `${k}(${tokens[k]})`).join('、')}`);
  // 全站預設焦點樣式真的用到內圈（不是只定義 token）
  assert.match(css('base.css'), /a:focus-visible,[^{]*\{[^}]*outline:var\(--focus\)[^}]*box-shadow:var\(--focus-ring\)/);
  // 不可以再出現 outline: 3px solid var(--focus) 這種把整個簡寫塞進顏色的寫法（第七十六輪修掉 answer.css 一處，整條宣告無效）
  for (const f of fs.readdirSync(path.join(ROOT, 'src/styles')).filter((x) => x.endsWith('.css')))
    assert.ok(!/outline:\s*\d+px\s+solid\s+var\(--focus\)/.test(css(f)), `${f}：outline 簡寫裡又包了 var(--focus)`);
});

test('2.3.3：全站 prefers-reduced-motion 規則關掉動畫、轉場與平滑捲動（含偽元素）；JS 的平滑捲動也看這個設定', () => {
  const m = css('tokens.css').match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([^{}]*)\{([^}]*)\}/);
  assert.ok(m, 'tokens.css 要有 @media (prefers-reduced-motion: reduce)');
  assert.match(m[1], /\*,\s*\*::before,\s*\*::after/);
  for (const p of ['animation: none !important', 'transition: none !important', 'scroll-behavior: auto !important']) assert.ok(m[2].includes(p), p);
  for (const f of ['ui.js', 'vaxschedule.js', 'play.js']) {
    const js = fs.readFileSync(path.join(ROOT, 'src/client', f), 'utf8');
    assert.ok(!/behavior:\s*'smooth'/.test(js), `${f}：scrollIntoView 寫死 behavior:'smooth'，要改用 scrollBehavior()`);
    assert.ok(!/\.animate\(/.test(js), `${f}：Web Animations API 不受 CSS 規則影響，要先查 prefers-reduced-motion`);
  }
});

test('2.5.5：手機斷點有 44 px（2.75rem）的目標尺寸規則，且只在手機斷點', () => {
  const base = css('base.css');
  const block = base.slice(base.indexOf('2.5.5 目標尺寸'));
  assert.match(block, /@media \(max-width:720px\)\{[\s\S]*min-height:2\.75rem;min-width:2\.75rem/);
  assert.ok(!/^[^@\s][^\n]*min-height:2\.75rem/m.test(block.split('@media (max-width:720px){')[0]), '44 px 規則不可寫在媒體查詢外面（桌機版面不動）');
});

test('3.1.4：縮寫表來自詞彙主檔＋少數補充；全稱不含縮寫本身', () => {
  const site = govern('2026-10-01');
  const zh = abbrTable(site.master.glossary, 'zh-TW');
  const en = abbrTable(site.master.glossary, 'en');
  for (const ab of ['MMR', 'HPV', 'RSV', 'COVID-19', 'PCR', 'BCG', 'TB', 'HIV']) assert.ok(zh.has(ab), `中文頁缺 ${ab}`);
  assert.equal(zh.get('TB'), '結核病');
  assert.equal(zh.get('MMR'), ABBR_EXTRA.MMR['zh-TW']);
  assert.equal(en.get('TB'), 'Tuberculosis', '英文全稱去掉結尾的「(TB)」');
  assert.ok(!en.has('HIV'), '英文譯名「HIV infection」含縮寫本身，不算全稱');
  assert.ok(!zh.has('CDC'), 'CDC 在站上可能指美國 CDC，不標');
  for (const [ab, full] of zh) assert.ok(!full.includes(ab), `${ab}：${full}`);
});

test('3.1.4：只標主要內容段落裡第一次出現的縮寫；標題、連結、code、屬性、頁首不動；行內連結 title 判斷不變', () => {
  const table = new Map([
    ['MMR', '麻疹、腮腺炎、德國麻疹混合疫苗'],
    ['PCR', '聚合酶連鎖反應'],
    ['RT-PCR', '反轉錄聚合酶連鎖反應'],
  ]);
  const page =
    '<!doctype html><html lang="zh-TW"><head><title>MMR 疫苗</title></head><body><header><p>MMR 公告</p></header><main>' +
    '<h1>MMR 疫苗</h1><p data-x="MMR">接種 <a href="/mmr/">MMR 說明</a> 前，先打 MMR 疫苗；再打一次 MMR。</p>' +
    '<ul><li>採檢做 RT-PCR，不是 PCR-like，也不是 PCR</li></ul><pre>MMR</pre><p><code>PCR</code></p></main></body></html>';
  const T = (k, v) => i18nT('zh-TW', k, v);
  const titled = inlineLinkTitles(page, { t: T, pageTitle: 'MMR 疫苗' });
  const { html: out, marked } = markAbbreviations(titled, table);
  assert.equal(marked, 3);
  assert.match(out, /先打 <abbr title="麻疹、腮腺炎、德國麻疹混合疫苗">MMR<\/abbr> 疫苗；再打一次 MMR。/, '第一次出現才標');
  assert.match(out, /<h1>MMR 疫苗<\/h1>/);
  assert.match(out, /<a href="\/mmr\/" title="[^"]*">MMR 說明<\/a>/);
  assert.match(out, /data-x="MMR"/);
  assert.match(out, /<header><p>MMR 公告<\/p><\/header>/, '主要內容以外不標');
  assert.match(out, /採檢做 <abbr title="反轉錄聚合酶連鎖反應">RT-PCR<\/abbr>，不是 PCR-like，也不是 <abbr title="聚合酶連鎖反應">PCR<\/abbr><\/li>/);
  assert.match(out, /<pre>MMR<\/pre><p><code>PCR<\/code><\/p>/);
  assert.deepEqual(
    checkHtml(out).map((f) => f.code),
    checkHtml(titled).map((f) => f.code),
    '包 abbr 前後檢測碼結果相同',
  );
});

test('2.4.8：沒有麵包屑的三個內容頁（使用指南、開發者入口、AI 透明報告）補上全站共用的麵包屑與 BreadcrumbList', async () => {
  const site = govern('2026-10-01');
  for (const [name, p] of [
    ['guide', '/guide/'],
    ['developers', '/developers/'],
    ['transparency', '/transparency/'],
  ]) {
    const mod = await import(`../src/templates/public/${name}.mjs`);
    const ctx = makeCtx(site, 'zh-TW', { path: p });
    const body = String(mod.render(ctx, {}));
    assert.match(body, /<nav class="c-breadcrumb" aria-label="麵包屑"><ol><li><a href="[^"]*\/">首頁<\/a><\/li>[\s\S]*?<li aria-current="page">/, name);
    const ld = [].concat(mod.meta(ctx).jsonLd ?? []);
    assert.ok(
      ld.some((x) => x['@type'] === 'BreadcrumbList'),
      `${name}：meta.jsonLd 要有 BreadcrumbList`,
    );
  }
});
