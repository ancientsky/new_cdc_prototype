// 第四十輪（Issue #79）：全文搜尋「頁面上確實有的詞必須搜得到」。
// 根因：Pagefind 建索引時整段丟掉 <label>（還有 <form>、<nav>、<footer>、<noscript>、<template>、<svg>）的內容；
// 申請頁的「應備文件」勾選清單是 <label> 包文字，所以「兒童健康手冊」「病歷摘要」在頁面上看得到、卻搜不到。
// 本檔分三層：(1) 純函式（不需要 dist）；(2) 用 Pagefind 的 Node API 對小型 fixture 真的建一份索引、在 Node 查詢（CI 一定跑）；
// (3) dist 存在時的整站抽樣與 Playwright 端到端（沒有 dist 或瀏覽器就 skip）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseQuery, shorterQueries, rankedSearch } from '../src/client/search-query.js';
import {
  spaceCjkInMain,
  searchableTexts,
  buildPagefindIndex,
  loadPagefindForNode,
  verifyPagefindRecall,
  waitForPagefindOutput,
} from '../scripts/lib/pagefind.mjs';
import { distBasePath } from './helpers.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DIST = process.env.DIST_DIR ? path.resolve(process.env.DIST_DIR) : path.join(ROOT, 'dist');
const hasIndex = fs.existsSync(path.join(DIST, 'pagefind/pagefind-entry.json'));

// ───────────────────────── (1) 純函式 ─────────────────────────
test('spaceCjkInMain：<form> 外的 <label> 在索引副本改成 <span>（屬性保留）；<form> 內的欄位名稱維持 <label>（讓 Pagefind 照舊丟掉）', () => {
  const src =
    '<main data-pagefind-body><ul class="c-checklist"><li><label class="c-checklist__row"><input type="checkbox"><span>預防接種紀錄（兒童健康手冊）</span></label></li></ul>' +
    '<form><label for="x">請描述問題</label><input id="x"></form></main>';
  const out = spaceCjkInMain(src);
  assert.ok(
    out.includes('<span data-pf-label class="c-checklist__row"><input type="checkbox"><span>預 防 接 種 紀 錄（兒 童 健 康 手 冊）</span></span>'),
    out,
  );
  assert.ok(out.includes('<form><label for="x">請 描 述 問 題</label>'), '表單內的 label 不改寫');
  assert.ok(!spaceCjkInMain('<main data-pagefind-body><p>a</p></main><label>登革熱</label>').includes('data-pf-label'), 'main 之外不動');
});

test('spaceCjkInMain：跨行內標籤（strong／a／code／abbr）的中文也補空白，不再黏成「內提」這種詞典外的詞', () => {
  const cases = [
    ['<p>自知道之日起<strong>2 年內</strong>提出</p>', '2 年 內</strong> 提 出'],
    ['<p>專案核准<a href="#">的疫苗</a>接種</p>', '核 准<a href="#"> 的 疫 苗</a> 接 種'],
    ['<p>請輸入<code>疾管家</code>帳號</p>', '輸 入<code> 疾 管 家</code> 帳 號'],
    ['<p>接種<abbr title="麻疹腮腺炎德國麻疹">麻腮德</abbr>疫苗</p>', '接 種<abbr title="麻疹腮腺炎德國麻疹"> 麻 腮 德</abbr> 疫 苗'],
  ];
  for (const [src, needle] of cases) {
    const out = spaceCjkInMain(`<main data-pagefind-body>${src}</main>`);
    assert.ok(out.includes(needle), `${src} → ${out}`);
  }
  // 中文後面接英文、數字或全形標點：不加（Pagefind 本來就在那裡斷詞；查詢端也把它們拆開）
  assert.ok(spaceCjkInMain('<main data-pagefind-body><p>紀錄（兒童）<b>MMR</b>疫苗</p></main>').includes('紀 錄（兒 童）<b>MMR</b>疫 苗'));
});

test('searchableTexts：只取 Pagefind 會收、本站有意讓人搜的文字（排除 form、nav、svg、script、data-pagefind-ignore 子樹）', () => {
  const html =
    '<main data-pagefind-body><nav><a>首頁</a></nav><h1>申請</h1><div data-pagefind-ignore><p>不要搜</p><div><p>內層</p></div></div>' +
    '<svg><text>圖表</text></svg><form><label>欄位</label></form><ul><li><label><input type="checkbox"><span>兒童健康手冊</span></label></li></ul><script>var a="程式"</script><br><img alt="x"><p>結尾</p></main>';
  assert.deepEqual(searchableTexts(html), ['申請', '兒童健康手冊', '結尾']);
  assert.deepEqual(searchableTexts('<main>沒有 body 標記</main>'), []);
});

test('parseQuery 邊界：全形括號、頓號、句號、英數混排都會切斷片語；每段各自成為精確片語', () => {
  assert.deepEqual(parseQuery('預防接種紀錄（兒童健康手冊）').phrases, ['預 防 接 種 紀 錄', '兒 童 健 康 手 冊']);
  assert.deepEqual(parseQuery('發燒、頭痛、肌肉痛').phrases, ['發 燒', '頭 痛', '肌 肉 痛']);
  assert.deepEqual(parseQuery('MMR疫苗2劑'), { phrases: ['疫 苗'], plain: ['MMR', '2劑'] }, '單一中文字留在一般詞裡（與索引端「中文與英數之間不補空白」一致）');
  assert.deepEqual(parseQuery('第30條規定'), { phrases: ['條 規 定'], plain: ['第30'] });
  assert.deepEqual(parseQuery('健康手冊。').phrases, ['健 康 手 冊']);
});

test('shorterQueries：最長的中文字串逐步去掉前後的字；同長度保留後段（中心語）優先；最短到一半；引號內不縮', () => {
  const terms = shorterQueries('兒童健康手冊').map((c) => c.term);
  assert.deepEqual(terms.slice(0, 3), ['童健康手冊', '兒童健康手', '健康手冊']);
  assert.ok(terms.every((t) => t.length >= 3));
  const c = shorterQueries('dengue 登革熱疫苗 "麻疹疫苗接種"')[0];
  assert.deepEqual(c, { q: 'dengue 革熱疫苗 "麻疹疫苗接種"', term: '革熱疫苗', from: '登革熱疫苗' });
  assert.deepEqual(shorterQueries('流感'), [], '2 字以下不縮');
  assert.deepEqual(shorterQueries('"兒童健康手冊"'), [], '使用者加引號＝要求完全相同');
  assert.ok(shorterQueries('傳染病防治法施行細則').length <= 12);
});

// ───────────────────────── (2) 真的建一份小索引（Pagefind Node API） ─────────────────────────
const FIXTURE = {
  'apply/injury/index.html':
    '<h1>預防接種受害救濟</h1><ul class="c-checklist"><li><label class="c-checklist__row"><input type="checkbox"><span>預防接種紀錄（兒童健康手冊、接種證明或接種單位證明）</span></label></li>' +
    '<li><label><input type="checkbox"><span>受害人的病歷摘要、診斷證明</span></label></li></ul>' +
    '<form><label for="f">回報網頁錯字請填這裡</label><input id="f"></form>',
  'faq/inline/index.html':
    '<h1>期限</h1><p>自知道受害之日起<strong>2 年內</strong>提出；專案核准<a href="#">的國內疫苗</a>都適用。</p><p>請輸入<code>疾管家</code>帳號，接種<abbr title="x">麻腮德</abbr>疫苗。</p>',
  'faq/punct/index.html': '<h1>症狀</h1><p>發燒、頭痛、後眼窩痛（登革熱典型症狀），MMR疫苗與HPV疫苗。</p>',
};
const page = (body) =>
  `<!doctype html><html lang="zh-TW"><head><meta charset="utf-8"><title>t</title></head><body><header>站名</header><main data-pagefind-body>${body}</main></body></html>`;

async function fixtureIndex(tc) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r40-pf-'));
  for (const [rel, body] of Object.entries(FIXTURE)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), page(body));
  }
  try {
    await buildPagefindIndex(dir);
  } catch (e) {
    fs.rmSync(dir, { recursive: true, force: true });
    tc.skip(`Pagefind 無法執行：${e.message}`);
    return null;
  }
  return dir;
}
const urlsFor = async (pf, q) => Promise.all((await rankedSearch(pf, q, {}, false)).results.map(async (r) => (await r.data()).url));

test('fixture：勾選清單（label）、全形括號與頓號旁、行內標籤兩側的字串都搜得到；表單欄位名稱刻意不收', async (tc) => {
  const dir = await fixtureIndex(tc);
  if (!dir) return;
  try {
    const pf = await loadPagefindForNode(path.join(dir, 'pagefind'));
    await pf.options({ baseUrl: '/' });
    const must = {
      '/apply/injury/': ['兒童健康手冊', '健康手冊', '病歷摘要', '接種單位證明', '受害救濟'],
      '/faq/inline/': ['年內提出', '核准的國內疫苗', '輸入疾管家帳號', '接種麻腮德疫苗'],
      '/faq/punct/': ['後眼窩痛', '登革熱典型症狀', '頭痛', 'MMR疫苗'],
    };
    for (const [url, qs] of Object.entries(must)) for (const q of qs) assert.ok((await urlsFor(pf, q)).includes(url), `${q} 應找到 ${url}`);
    assert.deepEqual(await urlsFor(pf, '回報網頁錯字'), [], '<form> 內的欄位名稱不進索引（每頁都有的回報表單，收了只是雜訊）');
    assert.deepEqual(await urlsFor(pf, '站名'), [], 'main 之外不收');
    await pf.destroy?.();
    // 建置用的自我檢查在 fixture 上也是 100%
    const v = await verifyPagefindRecall(dir, { pages: 10, perPage: 5 });
    assert.equal(v.recall, 1, JSON.stringify(v.misses));
    assert.ok(v.checked >= 10);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('對照組：同一份 HTML 不經 spaceCjkInMain 直接給 Pagefind，<label> 裡的字搜不到（記錄根因，Pagefind 改行為時這裡會提醒）', async (tc) => {
  const pagefind = await import('pagefind');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r40-raw-'));
  try {
    const { index, errors } = await pagefind.createIndex({});
    if (errors?.length || !index) return tc.skip(`Pagefind 無法執行：${errors}`);
    await index.addHTMLFile({ url: '/raw/', content: page('<p>前言</p><ul><li><label><input type="checkbox"><span>病歷摘要</span></label></li></ul>') });
    await index.writeFiles({ outputPath: path.join(dir, 'pagefind') });
    await waitForPagefindOutput(path.join(dir, 'pagefind')); // close() 直接結束子行程，不等它寫完
    await pagefind.close();
    const pf = await loadPagefindForNode(path.join(dir, 'pagefind'));
    const s = await pf.search('病歷摘要');
    const content = s.results.length ? (await s.results[0].data()).content : '';
    assert.ok(!content.includes('病歷摘要'), `Pagefind 預設丟掉 <label>：${content}`);
    await pf.destroy?.();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ───────────────────────── (3) 整站（dist 存在時） ─────────────────────────
test('dist：#79 的字串搜得到，整站抽樣召回 100%', async (tc) => {
  if (!hasIndex) return tc.skip('dist 尚未建置（或 PAGEFIND=off）');
  const pf = await loadPagefindForNode(path.join(DIST, 'pagefind'));
  await pf.options({ baseUrl: '/' });
  const urls = await urlsFor(pf, '兒童健康手冊');
  assert.ok(
    urls.some((u) => u.endsWith('/apply/vaccine-injury-compensation/')),
    urls.join(' '),
  );
  await pf.destroy?.();
  const v = await verifyPagefindRecall(DIST, { pages: 120, perPage: 3, seed: 79 });
  assert.equal(v.recall, 1, JSON.stringify(v.misses.slice(0, 10)));
});

const PW = process.env.PW_MODULE || '/opt/node22/lib/node_modules/playwright/index.mjs';
const CHROME = process.env.CHROME_BIN || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
};

async function withSearchPage(tc, url, fn) {
  if (!hasIndex) return tc.skip('dist 尚未建置（或 PAGEFIND=off）');
  if (!fs.existsSync(PW) || !fs.existsSync(CHROME)) return tc.skip('沒有 Playwright／Chromium');
  const { chromium } = await import(pathToFileURL(PW).href);
  const base = distBasePath(DIST); // 讀 dist 自己的 data-base（不跟呼叫端的 BASE_PATH；第四十九輪）
  const srv = http.createServer((req, res) => {
    let u = decodeURIComponent(req.url.split('?')[0]);
    if (base && u.startsWith(base)) u = u.slice(base.length) || '/';
    let f = path.join(DIST, u);
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
    if (!fs.existsSync(f)) {
      res.statusCode = 404;
      f = path.join(DIST, '404.html');
    }
    res.setHeader('Content-Type', MIME[path.extname(f)] ?? 'application/octet-stream');
    fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  try {
    const p = await browser.newPage();
    const errors = [];
    p.on('pageerror', (e) => errors.push(String(e)));
    await p.goto(`http://127.0.0.1:${srv.address().port}${base}${url}`);
    await fn(p, errors);
  } finally {
    await browser.close();
    srv.close();
  }
}

test('端到端：/search/?q=兒童健康手冊 找到預防接種受害救濟申請頁', async (tc) => {
  await withSearchPage(tc, `/search/?q=${encodeURIComponent('兒童健康手冊')}`, async (p, errors) => {
    await p.waitForFunction(() => /找到 \d+ 筆/.test(document.querySelector('#search-status')?.textContent ?? ''), null, { timeout: 20000 });
    const hrefs = await p.$$eval('#search-results li h3 a', (a) => a.map((x) => x.getAttribute('href')));
    assert.ok(
      hrefs.some((h) => h.endsWith('/apply/vaccine-injury-compensation/')),
      hrefs.join(' '),
    );
    assert.doesNotMatch(await p.textContent('#search-status'), /改以/, '完整字串就找得到，不該走退路');
    assert.deepEqual(errors, []);
  });
});

test('端到端：完整字串與拆半都查無時，退而搜較短的詞並明說（兒童健康手冊們 → 兒童健康手冊）', async (tc) => {
  await withSearchPage(tc, `/search/?q=${encodeURIComponent('兒童健康手冊們')}`, async (p, errors) => {
    await p.waitForFunction(() => /找到 \d+ 筆/.test(document.querySelector('#search-status')?.textContent ?? ''), null, { timeout: 20000 });
    assert.match(await p.textContent('#search-status'), /找不到「兒童健康手冊們」，改以「兒童健康手冊」搜尋。「兒童健康手冊」找到 \d+ 筆結果/);
    assert.equal(await p.inputValue('#search-q'), '兒童健康手冊們', '搜尋框保留使用者原本輸入的字');
    assert.deepEqual(errors, []);
  });
});
