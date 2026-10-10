// 第二十四輪：無障礙修正的結構斷言（不需瀏覽器；真正的 axe 掃描在 npm run a11y）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { govern, memWriter, config } from './helpers.mjs';
import { renderAllPages } from '../scripts/lib/pages.mjs';

const site = govern('2026-10-05');
const mem = memWriter();
await renderAllPages(site, mem.write);
const page = (p) => {
  const k = [`${p}index.html`.replace(/^\//, ''), `${p}.html`.replace(/^\//, '')].find((x) => mem.files.has(x));
  assert.ok(k, `找不到輸出頁 ${p}`);
  return mem.files.get(k);
};
const css = (f) => fs.readFileSync(new URL(`../src/styles/${f}`, import.meta.url), 'utf8');

test('#31 身分切換：兩個都是連結，沒有 aria-pressed，現在的身分用 aria-current', () => {
  for (const p of ['/', '/pro/']) {
    const h = page(p);
    const tags = [...h.matchAll(/<(a|button)\b[^>]*class="audience__btn"[^>]*>/g)].map((m) => m[0]);
    assert.ok(tags.length >= 3, p);
    for (const tg of tags) { assert.ok(tg.startsWith('<a '), `${p}：audience__btn 應為連結：${tg}`); assert.ok(!/aria-pressed/.test(tg), tg); }
    const cur = tags.filter((x) => /aria-current="page"/.test(x));
    assert.equal(cur.length, 1, p);
    assert.match(cur[0], p === '/' ? /data-view-set="public"/ : /data-view-set="pro"/);
  }
  const ui = fs.readFileSync(new URL('../src/client/ui.js', import.meta.url), 'utf8');
  assert.match(ui, /a\.audience__btn\[data-view-set\]/);
  assert.match(ui, /setAttribute\('aria-current', 'page'\)/);
});

test('#32 輪播圓點：點擊區 24px、間距 8px；/data/ 端點連結列至少 24px 高', () => {
  const c = css('components.css');
  assert.match(c, /\.c-carousel__dot\{[^}]*width:24px;height:24px/);
  assert.match(c, /\.c-carousel__dots\{[^}]*gap:8px/);
  assert.match(c, /\.c-carousel__dot::before\{[^}]*width:12px;height:12px/);
  assert.match(c, /\.c-v1list a\{[^}]*min-height:24px/);
});

test('#39 世界地圖 svg 用 role="group"（內有可聚焦連結，不可是 img）', () => {
  const h = page('/travel/');
  const svg = h.match(/<svg[^>]*class="wm-svg"[^>]*>/)?.[0];
  assert.ok(svg, '/travel/ 應有世界地圖');
  assert.match(svg, /role="group"/);
  assert.ok(!/role="img"/.test(svg));
});

test('#39 /travel/ 的搜尋表單：快速查（quickLookup）與主查詢各有不同的 aria-label，且頁面內不重複', () => {
  const h = page('/travel/');
  const labels = [...h.matchAll(/<form\b[^>]*role="search"[^>]*aria-label="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(labels.length >= 1, '主查詢表單要有 aria-label');
  assert.equal(new Set(labels).size, labels.length, `aria-label 不可重複：${labels}`);
  const src = fs.readFileSync(new URL('../src/templates/public/travel.mjs', import.meta.url), 'utf8');
  const keys = [...src.matchAll(/role="search" aria-label="\$\{t\('([^']+)'\)\}"/g)].map((m) => m[1]);
  assert.equal(keys.length, 2, 'travel.mjs 內兩個 role=search 都要有 aria-label');
  assert.notEqual(keys[0], keys[1]);
  // 任務頁（quickLookup）也能看到自己的名稱
  const task = [...mem.files].find(([k, v]) => k.endsWith('.html') && v.includes('data-tv-quick'));
  assert.ok(task && /role="search" aria-label="[^"]+" data-tv-quick/.test(task[1]));
});

test('#39 /pro/ 的 pf-pills：ul 不帶 role，group 角色放在外層 div', () => {
  const h = page('/pro/');
  const uls = [...h.matchAll(/<ul class="pf-pills"[^>]*>/g)].map((m) => m[0]);
  assert.ok(uls.length >= 2);
  for (const u of uls) assert.ok(!/role=/.test(u), u);
  assert.equal([...h.matchAll(/<div role="group" aria-label="[^"]+"><ul class="pf-pills">/g)].length, uls.length);
});

test('#39 可捲動區塊：.c-code、.c-tablewrap、.adm-tablewrap 都可聚焦並有名稱', () => {
  assert.match(page('/situation/'), /<pre class="c-code" role="region" tabindex="0" aria-label="[^"]+">/);
  assert.match(page('/vaccines/'), /<div class="c-tablewrap" role="region" tabindex="0" aria-label="[^"]+">/);
  assert.match(page('/admin/'), /<div class="adm-tablewrap" role="region" tabindex="0" aria-label="[^"]+">/);
  for (const [k, h] of mem.files) {
    if (!k.endsWith('.html')) continue;
    assert.ok(!/<div class="(?:c|adm)-tablewrap">/.test(h), `${k}：tablewrap 缺 tabindex`);
  }
});

test('#33 手機語言選單：<details> 內含七語，各用自己的語言標示；主選單面板底部也有語言列', () => {
  const h = page('/');
  const menu = h.match(/<details class="langmenu">[\s\S]*?<\/details>/)?.[0];
  assert.ok(menu, '應有 details.langmenu');
  assert.match(menu, /<summary class="langmenu__btn">🌐 語言／Language<\/summary>/);
  for (const L of config.langs) {
    assert.ok(menu.includes(`hreflang="${L.code}"`), L.code);
    assert.ok(menu.includes(`>${L.label}</a>`), L.label);
  }
  assert.equal(config.langs.length, 7);
  const navPanel = h.match(/<nav id="main-nav"[\s\S]*?<\/nav>/)[0];
  assert.equal([...navPanel.matchAll(/hreflang="/g)].length, 7);
  assert.match(css('base.css'), /\.langs--inline\{display:none\}/, '手機隱藏橫向捲動的語言列');
});

test('#39 landmark：工具連結在 nav 內，且全站只有一個 banner（header）', () => {
  const h = page('/');
  assert.match(h, /<nav class="topbar__links" aria-label="[^"]+">/);
  assert.equal([...h.matchAll(/<header class="site-header"/g)].length, 1);
});

test('#39 標題層級：/diseases/ /faq/ /ask/ 的第一個 h2 在任何 h3 之前（h1 後不跳級）', () => {
  for (const p of ['/diseases/', '/faq/', '/ask/']) {
    const h = page(p);
    const tags = [...h.matchAll(/<h([1-6])\b/g)].map((m) => Number(m[1]));
    const firstH3 = tags.indexOf(3);
    const firstH2 = tags.indexOf(2);
    assert.ok(firstH2 >= 0, `${p} 應有 h2`);
    assert.ok(firstH3 === -1 || firstH2 < firstH3, `${p}：h2 應先於 h3（${tags.join('')}）`);
    // 不可有「往下跳兩級」：h1→h3、h2→h4
    for (let i = 1; i < tags.length; i++) assert.ok(tags[i] - tags[i - 1] <= 1, `${p}：標題跳級 h${tags[i - 1]}→h${tags[i]}`);
  }
  assert.match(css('components.css'), /\.c-dis-group__t\{font-size:var\(--fs-lg\)/);
});

test('#30 a11y 腳本與 npm script 存在；CI 把它列入把關', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.scripts.a11y, 'node scripts/a11y.mjs');
  assert.ok(pkg.devDependencies['@axe-core/playwright'] && pkg.devDependencies.playwright);
  const wf = fs.readFileSync(new URL('../.github/workflows/content-pr.yml', import.meta.url), 'utf8');
  assert.match(wf, /id: a11y/);
  assert.match(wf, /steps\.a11y\.outcome != 'success'/);
});
