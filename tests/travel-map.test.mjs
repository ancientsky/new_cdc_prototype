// 世界地圖：預先產生的 110m 路徑 JSON 與 worldMap() inline SVG 輸出。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { worldMap, styles } from '../src/templates/public/_travel-map.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WP = path.join(ROOT, 'src/data/world-paths.json');
const world = JSON.parse(fs.readFileSync(WP, 'utf8'));
const master = JSON.parse(fs.readFileSync(path.join(ROOT, 'content/master/countries.json'), 'utf8'));
// 主檔前 60 國是原始名單（T1 擴充後新增的國家排在後面）
const main60 = master.slice(0, 60);
const str = (r) => String(r);

// Natural Earth 110m 沒有這些微型國家／特別行政區的多邊形（面積小於簡化門檻），地圖上無法點選；
// 使用者改用「查目的地」搜尋或等級表進入其目的地頁。
const KNOWN_NO_POLYGON = new Set(['HK', 'MO', 'SG', 'MV']);

const ctx = { lang: 'zh-TW', site: { master: { countries: master } } };
const byIso = new Map([
  ['JP', { code: 1, label: '第一級：注意' }],
  ['VN', { code: 2, label: '第二級：警示' }],
  ['CD', { code: 3, label: '第三級：警告' }],
  ['KR', { code: 0, label: '目前無針對性建議' }],
  ['TW', { code: 2, label: '不應被上色' }],
]);
const hrefFor = (iso) => `/travel/${iso}/`;

test('world-paths.json：結構、國家數與大小', () => {
  assert.equal(world.viewBox, '0 0 960 500');
  assert.equal(world.projection, 'naturalEarth1');
  assert.ok(world.source && world.generatedAt);
  const isos = Object.keys(world.paths);
  assert.ok(isos.length >= 170, `只有 ${isos.length} 國`);
  for (const iso of isos) {
    assert.match(iso, /^[A-Z]{2}$/);
    assert.match(world.paths[iso], /^M[-\d.,MLZ]+$/, `${iso} 路徑格式異常`);
  }
  assert.ok(!('AQ' in world.paths), '不應含南極洲');
  assert.ok(fs.statSync(WP).size <= 250 * 1024, 'world-paths.json 超過 250 KB');
});

test('主檔 60 國除已知例外外全部有 path', () => {
  const missing = main60.filter((c) => !world.paths[c.iso2]).map((c) => c.iso2);
  const unexpected = missing.filter((i) => !KNOWN_NO_POLYGON.has(i));
  assert.deepEqual(unexpected, [], `主檔國家缺 path：${unexpected.join(',')}`);
  // 例外清單不可過期：列為例外的必須真的沒有 path，否則該從清單移除
  for (const i of KNOWN_NO_POLYGON) assert.ok(!world.paths[i], `${i} 已有 path，請從 KNOWN_NO_POLYGON 移除`);
});

test('worldMap：三級三色、等級 0、連結、台灣中性', () => {
  const out = str(worldMap(ctx, { byIso, hrefFor, title: '世界地圖' }));
  assert.match(out, /<svg[^>]*class="wm-svg"[^>]*viewBox="0 0 960 500"[^>]*role="group"[^>]*aria-labelledby="wm-title wm-desc"/);
  assert.match(out, /<title id="wm-title">世界地圖<\/title>/);
  assert.match(out, /<desc id="wm-desc">/);
  assert.match(out, /<figure class="wm-fig">/);
  assert.match(out, /<figcaption/);
  assert.match(out, /<path class="wm wm--l3" data-iso="CD"/);
  assert.match(out, /<path class="wm wm--l2" data-iso="VN"/);
  assert.match(out, /<path class="wm wm--l1" data-iso="JP"/);
  assert.match(out, /<path class="wm wm--l0" data-iso="KR"/);
  assert.ok(out.includes('<a href="/travel/CD/"'));
  assert.match(out, /<title>剛果民主共和國：第三級：警告<\/title>|<title>[^<]+：第三級：警告<\/title>/);
  assert.ok(!out.includes('href="null"'));
  assert.ok(!out.includes('undefined'));
  // 台灣：中性色、不包連結、不受 byIso 影響
  assert.match(out, /<path class="wm wm--tw" data-iso="TW"/);
  assert.ok(!out.includes('/travel/TW/'));
  assert.ok(!/<a [^>]*>(?:(?!<\/a>).)*data-iso="TW"/s.test(out), 'TW 不應被 <a> 包住');
});

test('worldMap：主檔 60 國每個有 path 的國家都包 <a>（TW 除外）', () => {
  const ok = main60.map((c) => c.iso2).filter((i) => world.paths[i] && i !== 'TW');
  const out = str(worldMap(ctx, { byIso: new Map(), hrefFor: (i) => (main60.some((c) => c.iso2 === i) ? `/travel/${i}/` : null) }));
  const anchors = [...out.matchAll(/<a href="(\/travel\/[A-Z]{2}\/)" class="wm-link"/g)].map((m) => m[1]);
  assert.equal(anchors.length, ok.length);
  for (const i of ok) assert.ok(anchors.includes(`/travel/${i}/`), `${i} 缺連結`);
  assert.ok(!out.includes('href="null"'));
});

test('worldMap：hrefFor 回傳 null／空字串不包 <a>；無參數也不報錯', () => {
  const out = str(worldMap(ctx, { byIso, hrefFor: (i) => (i === 'CD' ? '/travel/CD/' : i === 'JP' ? '' : null) }));
  assert.equal((out.match(/<a /g) ?? []).length, 1);
  assert.ok(!out.includes('href="null"') && !out.includes('href="undefined"'));
  const bare = str(worldMap({}));
  assert.match(bare, /<svg/);
  assert.equal((bare.match(/<a /g) ?? []).length, 0);
  assert.ok(!bare.includes('undefined'));
});

test('worldMap：跳脫、英文介面與圖例參數', () => {
  const out = str(worldMap({ lang: 'en', site: { master: { countries: master } } }, {
    byIso: new Map([['JP', { code: 1, label: 'Level <1>' }]]),
    title: 'A "map" & <b>',
    legend: { l1: 'L1', l2: 'L2', l3: 'L3', none: 'NONE' },
  }));
  assert.ok(out.includes('A &quot;map&quot; &amp; &lt;b&gt;'));
  assert.ok(out.includes('Japan：Level &lt;1&gt;'));
  assert.ok(!out.includes('Level <1>'));
  for (const s of ['L1', 'L2', 'L3', 'NONE']) assert.ok(out.includes(`</i>${s}</span>`), s);
  // 預設圖例含「未上色」說明
  assert.ok(str(worldMap(ctx)).includes('未上色＝目前無針對性建議'));
});

test('styles：字串、含關鍵規則、無 <style> 標籤', () => {
  assert.equal(typeof styles, 'string');
  assert.ok(!styles.includes('<style'));
  for (const s of ['.wm-svg', 'aspect-ratio:960/500', '.wm--l3', '.wm--l2', '.wm--l1', 'fill-opacity:.35', 'var(--line-2', '.wm--tw', 'var(--ink-3', 'focus-visible']) assert.ok(styles.includes(s), s);
});
