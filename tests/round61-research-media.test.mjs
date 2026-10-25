// 第六十一輪：「研究與媒體」身分入口。原本首頁第三顆身分鈕直接連到 /developers/（API 文件），同事反應那不是記者與研究者要看的東西。
// 現在：/research-media/ 是七語的入口頁（給媒體／給研究者／資料與引用），身分鈕連到它；開發者入口退到本頁最後一張卡與頁尾，並在頁首加回連。
// 設計理由見 docs/navigation.md §7。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { govern, memWriter, config } from './helpers.mjs';
import { renderAllPages, makeCtx } from '../scripts/lib/pages.mjs';
import * as rm from '../src/templates/public/research-media.mjs';
import { STRINGS } from '../src/client/i18n.js';
import { slugOf } from '../src/templates/public/_partials.mjs';

const site = govern('2026-10-13');
const mem = memWriter();
await renderAllPages(site, mem.write);

const fileOf = (p) => [`${p}index.html`.replace(/^\//, ''), `${p}.html`.replace(/^\//, '')].find((x) => mem.files.has(x));
const page = (p) => { const k = fileOf(p); assert.ok(k, `找不到輸出頁 ${p}`); return mem.files.get(k); };
const audience = (h) => [...h.matchAll(/<a class="audience__btn"[^>]*>/g)].map((m) => m[0]);
const BASE = config.basePath;
const str = (r) => String(r);

test('七語都有 /research-media/，身分鈕第三顆連到它而不是 /developers/', () => {
  for (const L of config.langs) {
    const p = `${L.path}${rm.PATH}`;
    const h = page(p);
    const btns = audience(h);
    assert.equal(btns.length, 3, `${p} 身分鈕 3 顆`);
    assert.match(btns[2], new RegExp(`href="${BASE}${L.path}${rm.PATH}"`), `${p} 第三顆鈕連到研究與媒體`);
    assert.ok(!btns[2].includes('/developers/'), `${p} 第三顆鈕不再連到開發者入口`);
  }
});

test('/research-media/ 頁上只有「研究與媒體」鈕標 aria-current；首頁只有「民眾」；/pro/ 只有「醫事與防疫人員」', () => {
  const cur = (h) => audience(h).map((b) => /aria-current="page"/.test(b));
  assert.deepEqual(cur(page(rm.PATH)), [false, false, true]);
  assert.deepEqual(cur(page('/')), [true, false, false]);
  assert.deepEqual(cur(page('/pro/')), [false, true, false]);
});

test('入口頁三組都在：給媒體（新聞稿、公關室、聯絡、訂閱）、給研究者（疫情報導、出版品、研究計畫、申請）、資料與引用（資料、授權、開發者入口在最後）', () => {
  const h = page(rm.PATH);
  for (const id of ['rm-press', 'rm-research', 'rm-data']) assert.match(h, new RegExp(`id="${id}"`));
  for (const path of ['/news/', '/factcheck/', '/situation/', '/subscribe/', '/contact/', '/about/units/pr/', '/publications/bulletin/', '/publications/', '/research/', '/apply/', '/data/', '/policy/open-data/', '/glossary/', '/developers/']) {
    assert.ok(h.includes(`href="${BASE}${path}"`), `缺 ${path}`);
  }
  // 開發者入口是最後一張卡：它的連結位置在資料區塊內，且在授權連結之後
  assert.ok(h.lastIndexOf(`href="${BASE}/developers/"`) > h.indexOf(`href="${BASE}/policy/open-data/"`));
  // 最新新聞稿只取 press，不混通函與澄清，最多 5 筆，新到舊
  const press = rm.latestPress(site);
  assert.ok(press.length > 0 && press.length <= 5);
  assert.ok(press.every((n) => n.newsType === 'press'));
  for (let i = 1; i < press.length; i++) assert.ok(press[i - 1].publishedAt >= press[i].publishedAt);
  for (const n of press) assert.ok(h.includes(`/news/${slugOf(n)}/`), `頁上有新聞稿「${n.title}」`);
});

test('外語版：卡片標題是頁面語言，不夾未標示的中文；只有中文的內容連結標 lang="zh-TW"', () => {
  const h = page(`/en${rm.PATH}`);
  assert.match(h, /For the press/);
  assert.match(h, /For researchers/);
  assert.match(h, /Media contact/);
  // 標題區不該有中文字（新聞稿等內容連結的中文會帶 lang="zh-TW"）
  const main = h.slice(h.indexOf('<main'), h.indexOf('</main>'));
  const stripped = main.replace(/<[^>]*lang="zh-TW"[^>]*>[^<]*<\/[^>]+>/g, '').replace(/<script[\s\S]*?<\/script>/g, '');
  const headings = [...stripped.matchAll(/<h[123][^>]*>([^<]*)<\/h[123]>/g)].map((m) => m[1]);
  for (const t of headings) assert.ok(!/[一-鿿]/.test(t), `英文頁標題夾中文：${t}`);
});

test('開發者入口頁首有回到研究與媒體的連結；頁尾「開放資料與開發者」欄仍有開發者 API', () => {
  const dev = page('/developers/');
  assert.match(dev, /data-dev-backlink/);
  assert.ok(dev.includes(`href="${BASE}${rm.PATH}"`));
  const home = page('/');
  const footer = home.slice(home.indexOf('<footer'));
  assert.ok(footer.includes(`href="${BASE}/developers/"`), '頁尾仍連到開發者入口');
});

test('i18n：rm.* 七語齊全；網站導覽與 sitemap 路徑含 /research-media/', () => {
  const keys = Object.keys(STRINGS['zh-TW']).filter((k) => k.startsWith('rm.'));
  assert.ok(keys.length >= 20);
  for (const k of keys) for (const L of config.langs) assert.ok(STRINGS[L.code][k], `${L.code} 缺 ${k}`);
  assert.ok(page('/sitemap-page/').includes(`href="${BASE}${rm.PATH}"`));
  const seo = fs.readFileSync(new URL('../scripts/lib/emit-seo.mjs', import.meta.url), 'utf8');
  assert.match(seo, /'\/research-media\/'/);
});

test('模板直接渲染：meta 標題是「研究與媒體」，沒有 undefined／null', () => {
  const ctx = makeCtx(site, 'zh-TW', { path: rm.PATH });
  const h = str(rm.render(ctx));
  assert.equal(rm.meta(ctx).title, '研究與媒體');
  for (const re of [/href="undefined"/, /href="null"/, />undefined</, />null</]) assert.ok(!re.test(h));
});
