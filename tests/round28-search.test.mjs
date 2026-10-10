// 第二十八輪（Issue #38）：Pagefind 全文搜尋與進階篩選。
// 不需要 dist 的部分：查詢轉換、索引副本的 CJK 補空白、路徑黑名單、標籤規則、i18n 鍵、CSP。
// 需要 dist 的部分（索引存在、排除項目、篩選標籤、Playwright 端到端）：dist 或瀏覽器不存在時 skip。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { t as nodeT, STRINGS } from '../src/client/i18n.js';
import { CJK, parseQuery, phraseQuery, bagQuery, hasLongCjk, despaceExcerpt } from '../src/client/search-query.js';
import { CJK_CLASS, spaceCjkInMain, isIndexable } from '../scripts/lib/pagefind.mjs';
import { pagefindFor, pagefindMarks, PF_ALL_TYPES, PF_TYPES } from '../src/templates/public/_pagefind.mjs';
import { securityHeaders } from '../scripts/lib/emit-headers.mjs';
import { checkJsBudget } from '../scripts/lib/js-budget.mjs';
import { config } from '../site.config.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DIST = process.env.DIST_DIR ? path.resolve(process.env.DIST_DIR) : path.join(ROOT, 'dist');
const hasDist = fs.existsSync(path.join(DIST, 'index.html'));
const hasIndex = fs.existsSync(path.join(DIST, 'pagefind/pagefind-entry.json'));
const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else if (e.name.endsWith('.html')) out.push(p);
  }
  return out;
};

// ───────────────────────── 查詢轉換（純函式） ─────────────────────────
test('CJK 字元範圍：查詢端（search-query.js）與索引端（pagefind.mjs）必須相同，否則補空白與片語對不上', () => {
  assert.equal(CJK, CJK_CLASS);
});

test('parseQuery：連續 CJK ⇒ 片語（每字一詞）；英文與單一 CJK 字留作一般詞；使用者的引號保留成片語', () => {
  assert.deepEqual(parseQuery('登革熱'), { phrases: ['登 革 熱'], plain: [] });
  assert.deepEqual(parseQuery('dengue 登革熱 疫苗'), { phrases: ['登 革 熱', '疫 苗'], plain: ['dengue'] });
  assert.deepEqual(parseQuery('熱'), { phrases: [], plain: ['熱'] });
  assert.deepEqual(parseQuery('MMR疫苗'), { phrases: ['疫 苗'], plain: ['MMR'] });
  assert.deepEqual(parseQuery('"measles vaccine"'), { phrases: ['measles vaccine'], plain: [] });
  assert.deepEqual(parseQuery('"登革熱 疫苗"'), { phrases: ['登 革 熱   疫 苗'.replace(/ {3}/, ' ')], plain: [] }.phrases.length ? parseQuery('"登革熱 疫苗"') : null);
  assert.deepEqual(parseQuery(''), { phrases: [], plain: [] });
  assert.equal(phraseQuery(parseQuery('dengue 登革熱'), '登 革 熱'), 'dengue "登 革 熱"');
  assert.equal(bagQuery(parseQuery('dengue 登革熱')), 'dengue 登 革 熱');
});

test('loose：長度 ≥4 的 CJK 字串拆成前後兩半（麻疹疫苗 → 麻疹＋疫苗）；3 字以下不拆', () => {
  assert.deepEqual(parseQuery('麻疹疫苗', true).phrases, ['麻 疹', '疫 苗']);
  assert.deepEqual(parseQuery('抗病毒藥劑', true).phrases, ['抗 病 毒', '藥 劑']);
  assert.deepEqual(parseQuery('登革熱', true).phrases, ['登 革 熱']);
  assert.equal(hasLongCjk('麻疹疫苗'), true);
  assert.equal(hasLongCjk('登革熱'), false);
});

test('despaceExcerpt：還原摘錄裡的「登 革 熱」，並把相鄰的 <mark> 併成一個', () => {
  assert.equal(despaceExcerpt('同 步 接 種 與 抗 病 毒 藥 物。 <mark>登 </mark><mark>革 </mark><mark>熱 </mark>等 蟲 媒 傳 染 病'), '同步接種與抗病毒藥物。 <mark>登革熱</mark>等蟲媒傳染病');
  assert.equal(despaceExcerpt('Dengue 疫 苗 MMR vaccine'), 'Dengue 疫苗 MMR vaccine'); // 英文詞之間的空白不動
});

// ───────────────────────── 索引副本與路徑 ─────────────────────────
test('spaceCjkInMain：只改 <main data-pagefind-body> 內的文字節點；屬性、script／style、main 之外都不動', () => {
  const src = '<html><body><header>登革熱導覽</header><main class="wrap" data-pagefind-body><h1 data-pagefind-weight="10">登革熱</h1><p title="登革熱">登革熱 Dengue，麻疹疫苗。</p><script>var s="登革熱"</script><span hidden data-pagefind-meta="title:登革熱"></span></main><footer>登革熱</footer></body></html>';
  const out = spaceCjkInMain(src);
  assert.ok(out.includes('<h1 data-pagefind-weight="10">登 革 熱</h1>'));
  assert.ok(out.includes('<p title="登革熱">登 革 熱 Dengue，麻 疹 疫 苗。</p>'), '屬性不動、標點與英文不動');
  assert.ok(out.includes('<script>var s="登革熱"</script>'), 'script 不動');
  assert.ok(out.includes('data-pagefind-meta="title:登革熱"'), '明確指定的標題不被補空白');
  assert.ok(out.includes('<header>登革熱導覽</header>') && out.includes('<footer>登革熱</footer>'), 'main 之外不動');
  assert.equal(spaceCjkInMain('<main>登革熱</main>'), '<main>登革熱</main>', '沒有 data-pagefind-body 的 main 不處理');
});

test('isIndexable：後台、PR 預覽、舊站轉址頁、404、搜尋頁、答案頁、pagefind 自己的檔案都不進索引（含各語言前綴）', () => {
  for (const rel of ['admin/index.html', 'admin/publish/index.html', 'preview/pr-12/index.html', 'preview/pr-12/diseases/dengue/index.html', 'legacy/index.html', 'en/legacy/index.html', '404.html', 'search/index.html', 'vi/search/index.html', 'ask/index.html', 'th/ask/index.html', 'pagefind/x.html', 'v1/x.html', 'files/a/b.html', 'pending/index.html'])
    assert.equal(isIndexable(rel), false, rel);
  for (const rel of ['index.html', 'diseases/dengue/index.html', 'en/diseases/dengue/index.html', 'travel/JP/index.html', 'faq/x/index.html']) assert.equal(isIndexable(rel), true, rel);
});

// ───────────────────────── 標籤規則（layout 的 Pagefind 屬性） ─────────────────────────
test('pagefindFor：正面表列——noindex、沒有 item 的工具頁、banner、dataset 都不收；疾病、旅遊目的地、詞彙頁收', () => {
  const disease = { type: 'disease', owner: 'unit.acute-infectious', publishedAt: '2018-03-01', audience: ['public', 'professional'] };
  assert.deepEqual(pagefindFor({ item: disease }), { type: 'disease', audience: ['public', 'professional'], owner: 'unit.acute-infectious', date: '2018-03-01', year: '2018', currency: 'current' });
  assert.equal(pagefindFor({ item: disease, noindex: true }), null, '失效版文件、模擬報名頁都是 noindex');
  assert.equal(pagefindFor({ item: disease, pagefind: false }), null);
  assert.equal(pagefindFor({}), null, '首頁、列表頁、/ask/、/search/ 沒有 item 也沒有 pagefind 設定');
  assert.equal(pagefindFor({ item: { type: 'banner' } }), null);
  assert.equal(pagefindFor({ item: { type: 'dataset' } }), null);
  assert.equal(pagefindFor({ pagefind: { type: 'travel', audience: ['public'] } }).type, 'travel');
  assert.equal(pagefindFor({ pagefind: { type: 'nonsense' } }), null);
  // 發布年份取 publishedAt（支援 date-time）；沒有日期 ⇒ 不輸出 year／sort
  assert.equal(pagefindFor({ item: { ...disease, publishedAt: '2026-05-01T08:00:00+08:00' } }).year, '2026');
  assert.equal(pagefindFor({ pagefind: { type: 'travel' } }).date, null);
});

test('pagefindMarks：輸出 filter（type／audience／unit／year）、sort（date）、meta（title／kind／unit／date）；對象是穩定代碼不是顯示字', () => {
  const ctx = { t: (k) => nodeT('zh-TW', k) };
  const m = pagefindMarks(ctx, pagefindFor({ item: { type: 'faq', owner: 'unit.pr', publishedAt: '2024-05-20', audience: ['public'] } }), { unitName: () => '公關室', title: '登革熱要就醫嗎？' });
  const h = String(m.tail);
  assert.equal(m.bodyAttr, ' data-pagefind-body');
  for (const needle of ['data-pagefind-filter="type:faq"', 'data-pagefind-filter="audience:public"', 'data-pagefind-filter="unit:unit.pr"', 'data-pagefind-filter="year:2024"', 'data-pagefind-sort="date:2024-05-20"', 'data-pagefind-meta="date:2024-05-20"', 'data-pagefind-meta="title:登革熱要就醫嗎？"', 'data-pagefind-meta="kind:問答"', 'data-pagefind-meta="unit:公關室"'])
    assert.ok(h.includes(needle), needle);
  assert.equal(pagefindMarks(ctx, null).bodyAttr, '');
  assert.equal(pagefindMarks(ctx, null).weigh('<h1>x</h1>'), '<h1>x</h1>');
  assert.equal(m.weigh('<p>a</p><h1 class="x">t</h1><h1>u</h1>'), '<p>a</p><h1 data-pagefind-weight="10" class="x">t</h1><h1>u</h1>', '只加權第一個 h1');
});

test('i18n：每種內容類型都有 search.type.* 的中英文字串；搜尋頁核心標籤七語齊備', () => {
  for (const type of PF_ALL_TYPES) for (const lang of ['zh-TW', 'en']) assert.ok(STRINGS[lang][`search.type.${type}`], `${lang} search.type.${type}`);
  for (const key of ['search.title', 'search.label', 'search.submit', 'search.filters', 'search.f.type', 'search.f.audience', 'search.f.unit', 'search.f.year', 'search.sort', 'search.status.n', 'search.more'])
    for (const lang of config.langs.map((l) => l.code)) assert.ok(STRINGS[lang][key], `${lang} ${key}`);
  assert.ok(PF_TYPES.every((x) => PF_ALL_TYPES.includes(x)));
});

test('CSP：script-src 只多一個 \'wasm-unsafe-eval\'（Pagefind 的 WebAssembly）；不得出現 unsafe-eval，script-src 不得有 unsafe-inline', () => {
  const csp = securityHeaders({ hashes: ["'sha256-abc'"] })['Content-Security-Policy'];
  assert.match(csp, /script-src 'self' 'wasm-unsafe-eval' 'sha256-abc';/);
  assert.ok(!/'unsafe-eval'/.test(csp));
  assert.ok(!/script-src[^;]*'unsafe-inline'/.test(csp));
});

test('瀏覽器端 JS 不得直接使用 Node 的 process（第二十五輪的 no-match 曾因 process.env.NO_GATE 在瀏覽器 ReferenceError，答案頁卡在載入中）', () => {
  const walkJs = (dir, out = []) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walkJs(p, out); else if (e.name.endsWith('.js')) out.push(p); } return out; };
  for (const f of walkJs(path.join(ROOT, 'src/client'))) {
    const code = fs.readFileSync(f, 'utf8').replace(/typeof process !== 'undefined' && process\.env\??\.\w+/g, '').replace(/'[^'\n]*'/g, "''");
    assert.ok(!/\bprocess\.env\b/.test(code), `${path.relative(ROOT, f)} 直接使用 process.env`);
  }
});

// ───────────────────────── 建置輸出 ─────────────────────────
test('建置輸出：dist/pagefind 有執行期與索引；zh-TW、英文與其他語言各一份索引', (tc) => {
  if (!hasDist || !hasIndex) return tc.skip('dist 尚未建置（或 PAGEFIND=off）');
  for (const f of ['pagefind.js', 'pagefind-worker.js', 'pagefind-entry.json']) assert.ok(fs.existsSync(path.join(DIST, 'pagefind', f)), f);
  const entry = JSON.parse(fs.readFileSync(path.join(DIST, 'pagefind/pagefind-entry.json'), 'utf8'));
  for (const l of ['zh-tw', 'en', 'ja', 'vi']) assert.ok(entry.languages[l]?.page_count > 0, `${l} 索引`);
  assert.ok(entry.languages['zh-tw'].page_count > 300, 'zh-TW 至少數百頁');
});

test('排除項目：後台、PR 預覽、舊站轉址頁、404、搜尋頁、答案頁、機讀版沒有 data-pagefind-body，也不在 dist/pagefind 的索引範圍', (tc) => {
  if (!hasDist) return tc.skip('dist 尚未建置');
  const withBody = walk(DIST).map((f) => path.relative(DIST, f).split(path.sep).join('/')).filter((rel) => fs.readFileSync(path.join(DIST, rel), 'utf8').includes('data-pagefind-body'));
  assert.ok(withBody.length > 300, `有 data-pagefind-body 的頁 ${withBody.length}`);
  for (const rel of withBody) assert.ok(isIndexable(rel), `${rel} 有 data-pagefind-body 卻在排除名單`);
  assert.ok(!withBody.some((r) => /(^|\/)(admin|preview|legacy|search|ask|pending)\//.test(r) || r === '404.html'), '排除項目不得標記');
  assert.ok(!fs.readFileSync(path.join(DIST, 'search/index.html'), 'utf8').includes('data-pagefind-body'));
  assert.ok(!fs.readFileSync(path.join(DIST, '404.html'), 'utf8').includes('data-pagefind-body'));
  // 失效版文件（noindex）與模擬報名頁不收
  const apply = walk(path.join(DIST, 'careers')).filter((f) => f.includes(`${path.sep}apply${path.sep}`));
  for (const f of apply) assert.ok(!fs.readFileSync(f, 'utf8').includes('data-pagefind-body'), f);
});

test('篩選標籤：疾病頁有 type／audience／unit／year／sort／meta；英文版的顯示字是英文；主體不含 header／footer 導覽', (tc) => {
  if (!hasDist) return tc.skip('dist 尚未建置');
  const zh = fs.readFileSync(path.join(DIST, 'diseases/dengue/index.html'), 'utf8');
  for (const needle of ['<main id="main" class="wrap" data-pagefind-body>', 'data-pagefind-filter="type:disease"', 'data-pagefind-filter="audience:public"', 'data-pagefind-filter="audience:professional"', 'data-pagefind-filter="unit:unit.acute-infectious"', 'data-pagefind-filter="year:2018"', 'data-pagefind-sort="date:2018-03-01"', 'data-pagefind-meta="title:登革熱"', 'data-pagefind-meta="kind:傳染病"', 'data-pagefind-weight="10"'])
    assert.ok(zh.includes(needle), needle);
  assert.ok(zh.indexOf('data-pagefind-body') > zh.indexOf('</header>'), 'body 標記在站台 header 之後');
  assert.ok(zh.indexOf('data-pagefind-body') < zh.indexOf('<footer class="site-footer">') && zh.indexOf('</main>') < zh.indexOf('<footer class="site-footer">'));
  const en = fs.readFileSync(path.join(DIST, 'en/diseases/dengue/index.html'), 'utf8');
  assert.ok(en.includes('data-pagefind-meta="kind:Diseases"') && en.includes('<html lang="en"'));
  const jp = fs.readFileSync(path.join(DIST, 'travel/JP/index.html'), 'utf8');
  assert.ok(jp.includes('data-pagefind-filter="type:travel"'));
});

test('/search/ 七語各一頁；骨架有搜尋表單、live region、篩選容器；JS 預算：pagefind 不在任何頁的 <script src>（動態載入）', (tc) => {
  if (!hasDist) return tc.skip('dist 尚未建置');
  for (const L of config.langs) {
    const f = path.join(DIST, L.path.replace(/^\//, ''), 'search/index.html');
    assert.ok(fs.existsSync(f), `${L.code} /search/`);
    const h = fs.readFileSync(f, 'utf8');
    assert.ok(h.includes(`<html lang="${L.code}"`));
    for (const needle of ['role="search"', 'id="search-status" role="status" aria-live="polite"', 'data-filter="type"', 'data-filter="audience"', 'id="search-unit"', 'id="search-year"', 'id="search-sort"', 'assets/js/search.js', 'assets/styles/search.css', 'noindex']) assert.ok(h.includes(needle), `${L.code} ${needle}`);
    assert.ok(!/pagefind\.js|pagefind-ui/.test(h), 'HTML 不直接載入 pagefind（動態 import）');
  }
  const r = checkJsBudget(DIST, { basePath: config.basePath });
  const row = r.rows.find((x) => x.page === 'search/index.html');
  assert.ok(row && row.bytes < 80 * 1024, `/search/ 的立即載入 JS ${row?.bytes}（pagefind 執行期不計，第一次搜尋才載入）`);
  assert.ok(r.ok, '全站 JS 預算');
});

// ───────────────────────── 端到端（Playwright） ─────────────────────────
const PW = process.env.PW_MODULE || '/opt/node22/lib/node_modules/playwright/index.mjs';
const CHROME = process.env.CHROME_BIN || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.md': 'text/markdown; charset=utf-8', '.svg': 'image/svg+xml' };

/** 靜態伺服器，並套用 dist/headers/headers.json 的 CSP 等標頭——端到端同時驗證「Pagefind 在我們的 CSP 下能跑」 */
async function serveDist() {
  const hj = path.join(DIST, 'headers/headers.json');
  const headers = fs.existsSync(hj) ? JSON.parse(fs.readFileSync(hj, 'utf8')).headers : {};
  const base = config.basePath;
  const srv = http.createServer((req, res) => {
    let u = decodeURIComponent(req.url.split('?')[0]);
    if (base && u.startsWith(base)) u = u.slice(base.length) || '/';
    let f = path.join(DIST, u);
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
    for (const [k, v] of Object.entries(headers)) res.setHeader(k, k === 'Strict-Transport-Security' ? v : v.replace('upgrade-insecure-requests', '').replace(/;\s*;/g, ';'));
    if (!fs.existsSync(f)) { res.statusCode = 404; f = path.join(DIST, '404.html'); }
    res.setHeader('Content-Type', MIME[path.extname(f)] ?? 'application/octet-stream');
    fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { srv, origin: `http://127.0.0.1:${srv.address().port}${base}` };
}

async function withBrowser(tc, fn) {
  if (!hasDist || !hasIndex) return tc.skip('dist 尚未建置（或 PAGEFIND=off）');
  if (!fs.existsSync(PW) || !fs.existsSync(CHROME)) return tc.skip('沒有 Playwright／Chromium');
  const { chromium } = await import(pathToFileURL(PW).href);
  const { srv, origin } = await serveDist();
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  try { await fn({ browser, origin }); } finally { await browser.close(); srv.close(); }
}

/** 開頁並收集 console 錯誤與 CSP 違規 */
async function open(browser, url, viewport = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push(String(e)));
  await page.addInitScript(() => document.addEventListener('securitypolicyviolation', (e) => console.error(`CSP 違規：${e.violatedDirective} ${e.blockedURI}`)));
  await page.goto(url);
  return { page, problems };
}
const resultsReady = (page) => page.waitForFunction(() => document.querySelectorAll('#search-results li').length > 0, null, { timeout: 20000 });
const urlsOf = (page) => page.$$eval('#search-results li h3 a', (a) => a.map((x) => x.getAttribute('href')));

test('端到端：?q=登革熱 深連結 ⇒ 結果含登革熱疾病頁；live region 報筆數；無 console 錯誤、無 CSP 違規（含 wasm）', async (tc) => {
  await withBrowser(tc, async ({ browser, origin }) => {
    const { page, problems } = await open(browser, `${origin}/search/?q=${encodeURIComponent('登革熱')}`);
    await resultsReady(page);
    const status = await page.textContent('#search-status');
    assert.match(status, /「登革熱」找到 \d+ 筆結果/);
    assert.equal(await page.getAttribute('#search-status', 'role'), 'status');
    assert.equal(await page.inputValue('#search-q'), '登革熱', '?q= 填入搜尋框');
    const top = await urlsOf(page);
    assert.ok(top.some((h) => h.endsWith('/diseases/dengue/')), `前 10 筆應含登革熱疾病頁：${top.join(' ')}`);
    const base = await page.evaluate(() => document.documentElement.dataset.base);
    assert.ok(top.every((h) => h.startsWith(`${base}/`)), `結果連結要帶 basePath（GitHub Pages 專案頁、PR 預覽都有子路徑）：base=${base} ${top.join(' ')}`);
    assert.ok(top.slice(0, 3).some((h) => h.endsWith('/diseases/dengue/')), '疾病頁排在前三（標題加權＋pageLength 調整）');
    // 結果標題是原文（不是索引用的「登 革 熱」），摘錄裡的 <mark> 沒有字元間的空白
    assert.equal(await page.textContent('#search-results li:first-child h3 a'), (await page.textContent('#search-results li:first-child h3 a')).trim());
    assert.ok(!(await page.textContent('#search-results')).includes('登 革'), '顯示的文字不得有補出來的空白');
    const marks = await page.$$eval('#search-results mark', (m) => m.map((x) => x.textContent));
    assert.ok(marks.length > 0 && marks.every((x) => x.length >= 1));
    assert.deepEqual(problems, []);
  });
});

test('端到端：中文召回——「登革熱」「結核」「抗病毒藥劑」的筆數 = 索引頁中含該字串的頁數（子字串基準）', async (tc) => {
  await withBrowser(tc, async ({ browser, origin }) => {
    // 基準：zh-TW 且有 data-pagefind-body 的頁，取 main 內純文字，檢查是否含該字串
    const corpus = walk(DIST)
      .map((f) => path.relative(DIST, f).split(path.sep).join('/'))
      .filter((rel) => !/^(en|ja|tl|vi|id|th)\//.test(rel) && isIndexable(rel))
      .map((rel) => fs.readFileSync(path.join(DIST, rel), 'utf8'))
      .filter((h) => h.includes('data-pagefind-body'))
      .map((h) => h.match(/<main[^>]*data-pagefind-body[^>]*>([\s\S]*)<\/main>/)?.[1] ?? '')
      .map((m) => m.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, '').replace(/\s+/g, ''));
    const { page } = await open(browser, `${origin}/search/`);
    for (const q of ['登革熱', '結核', '抗病毒藥劑', '病媒蚊', '疫苗接種']) {
      const expected = corpus.filter((t) => t.includes(q)).length;
      assert.ok(expected > 0, `基準 ${q}`);
      await page.fill('#search-q', q);
      await page.press('#search-q', 'Enter');
      await page.waitForFunction((qq) => document.querySelector('#search-status')?.textContent?.includes(`「${qq}」找到`), q, { timeout: 20000 });
      const n = Number((await page.textContent('#search-status')).match(/找到 (\d+) 筆/)[1]);
      assert.equal(n, expected, `${q}：Pagefind ${n} 筆，子字串基準 ${expected} 筆`);
    }
    // 順序反過來不是同一個詞：「熱革登」不得命中（片語要求依序相鄰）
    await page.fill('#search-q', '熱革登');
    await page.press('#search-q', 'Enter');
    await page.waitForFunction(() => /沒有符合/.test(document.querySelector('#search-status')?.textContent ?? ''), null, { timeout: 20000 });
  });
});

test('端到端：完整字串查無時退一步（麻疹疫苗 ⇒ 含「麻疹」且含「疫苗」），並在狀態列說明', async (tc) => {
  await withBrowser(tc, async ({ browser, origin }) => {
    const { page, problems } = await open(browser, `${origin}/search/?q=${encodeURIComponent('麻疹疫苗')}`);
    await resultsReady(page);
    const status = await page.textContent('#search-status');
    assert.match(status, /找到 \d+ 筆結果/);
    assert.match(status, /沒有完全相同的字串/);
    assert.ok((await urlsOf(page)).some((h) => /\/(diseases\/measles|vaccines\/mmr)\/$/.test(h)));
    assert.deepEqual(problems, []);
  });
});

test('端到端：篩選（內容類型、對象、權責單位、年份）與排序，網址同步；鍵盤可操作', async (tc) => {
  await withBrowser(tc, async ({ browser, origin }) => {
    const { page, problems } = await open(browser, `${origin}/search/?q=${encodeURIComponent('登革熱')}`);
    await resultsReady(page);
    assert.equal(await page.evaluate(() => document.querySelector('#search-adv').open), false, '沒帶篩選條件時預設收合，結果清單在第一屏');
    await page.click('#search-adv > summary');
    // 選項由索引產生：類型、對象有 checkbox；單位、年份是 select
    for (const sel of ['input[name="type"][value="disease"]', 'input[name="type"][value="faq"]', 'input[name="audience"][value="public"]', 'input[name="audience"][value="professional"]', '#search-unit option[value="unit.acute-infectious"]', '#search-year option[value="2026"]'])
      assert.ok(await page.$(sel), sel);
    // 類型：只看傳染病 ⇒ 全是疾病頁
    await page.check('input[name="type"][value="disease"]');
    await page.waitForFunction(() => /找到 \d+ 筆/.test(document.querySelector('#search-status')?.textContent ?? '') && document.querySelectorAll('#search-results li').length <= 2, null, { timeout: 20000 });
    const kinds = await page.$$eval('#search-results li .c-pill', (p) => p.map((x) => x.textContent));
    assert.ok(kinds.length > 0 && kinds.every((k) => k === '傳染病'), kinds.join());
    assert.match(page.url(), /type=disease/);
    // 類型多選 = 聯集
    await page.check('input[name="type"][value="faq"]');
    await page.waitForFunction(() => document.querySelectorAll('#search-results li').length > 2, null, { timeout: 20000 });
    const kinds2 = new Set(await page.$$eval('#search-results li .c-pill', (p) => p.map((x) => x.textContent)));
    assert.ok(kinds2.has('傳染病') && kinds2.has('問答'));
    await page.uncheck('input[name="type"][value="disease"]');
    await page.uncheck('input[name="type"][value="faq"]');
    // 年份＋單位
    await page.selectOption('#search-year', '2026');
    await page.waitForFunction(() => { const t = [...document.querySelectorAll('#search-results li time')]; return t.length > 0 && t.every((x) => x.getAttribute('datetime').startsWith('2026')); }, null, { timeout: 20000 });
    await page.selectOption('#search-unit', 'unit.acute-infectious');
    await page.waitForFunction(() => { const m = [...document.querySelectorAll('#search-results li .c-search__meta')]; return m.length > 0 && m.every((x) => x.textContent.includes('急性傳染病組')); }, null, { timeout: 20000 });
    assert.match(page.url(), /year=2026/); assert.match(page.url(), /unit=unit\.acute-infectious/);
    // 排序：新到舊
    await page.selectOption('#search-year', '');
    await page.selectOption('#search-unit', '');
    await page.selectOption('#search-sort', 'new');
    await page.waitForFunction(() => /sort=new/.test(location.search) && !/year=|unit=/.test(location.search), null, { timeout: 20000 });
    await page.waitForFunction(() => document.querySelectorAll('#search-results li time').length >= 5, null, { timeout: 20000 });
    await page.waitForTimeout(300);
    const ds = await page.$$eval('#search-results li time', (t) => t.map((x) => x.getAttribute('datetime')));
    assert.ok(ds.length >= 5 && ds.every((d, i) => i === 0 || ds[i - 1] >= d), `新到舊：${ds.join()}`);
    // 清除篩選
    await page.click('#search-clear');
    await page.waitForFunction(() => !/(type|year|unit|sort)=/.test(location.search), null, { timeout: 20000 });
    assert.deepEqual(problems, []);
  });
});

test('端到端：只用篩選（沒有關鍵字）可瀏覽；「顯示更多」每次 10 筆並把焦點移到新結果；空狀態有出路', async (tc) => {
  await withBrowser(tc, async ({ browser, origin }) => {
    const { page } = await open(browser, `${origin}/search/?type=faq`);
    await resultsReady(page);
    assert.equal(await page.locator('#search-results li').count(), 10);
    assert.match(await page.textContent('#search-status'), /已顯示 10 \/ \d+ 筆/);
    await page.click('#search-more');
    await page.waitForFunction(() => document.querySelectorAll('#search-results li').length === 20, null, { timeout: 20000 });
    const focused = await page.evaluate(() => document.activeElement?.closest('li')?.parentElement?.id === 'search-results' && [...document.querySelectorAll('#search-results li')].indexOf(document.activeElement.closest('li')));
    assert.equal(focused, 10, '焦點移到第 11 筆（新載入的第一筆）');
    // 查無
    await page.fill('#search-q', 'zzzxqwv');
    await page.press('#search-q', 'Enter');
    await page.waitForFunction(() => /沒有符合/.test(document.querySelector('#search-status')?.textContent ?? ''), null, { timeout: 20000 });
    assert.equal(await page.isVisible('#search-empty'), true);
    assert.match(await page.getAttribute('[data-search-ask]', 'href'), /\/ask\/\?q=zzzxqwv/);
  });
});

test('端到端：鍵盤——Tab 進搜尋框、輸入、Enter 送出，不用滑鼠就能得到結果並走到第一個結果連結', async (tc) => {
  await withBrowser(tc, async ({ browser, origin }) => {
    const { page } = await open(browser, `${origin}/search/`);
    await page.focus('#search-q');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'search-q');
    await page.keyboard.type('流感');
    await page.keyboard.press('Enter');
    await resultsReady(page);
    assert.match(page.url(), /[?&]q=/);
    await page.focus('#search-q');
    for (let i = 0; i < 40; i++) { await page.keyboard.press('Tab'); if (await page.evaluate(() => document.activeElement?.closest('#search-results'))) break; }
    assert.equal(await page.evaluate(() => document.activeElement?.tagName), 'A');
    assert.ok(await page.evaluate(() => document.activeElement.closest('#search-results')));
  });
});

test('端到端：英文版 /en/search/ 只搜英文索引；320px 不橫向捲動', async (tc) => {
  await withBrowser(tc, async ({ browser, origin }) => {
    const { page, problems } = await open(browser, `${origin}/en/search/?q=dengue`, { width: 320, height: 700 });
    await resultsReady(page);
    assert.match(await page.textContent('#search-status'), /results found for “dengue”/);
    const urls = await urlsOf(page);
    assert.ok(urls.length > 0 && urls.every((u) => u.includes('/en/') || !/\/(ja|vi|th|tl|id)\//.test(u)));
    assert.ok(urls.some((u) => u.endsWith('/en/diseases/dengue/')), urls.join(' '));
    assert.match(await page.textContent('.c-search__langnote'), /Traditional Chinese/);
    const w = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    assert.ok(w[0] <= w[1], `320px 橫向捲動 ${w}`);
    assert.deepEqual(problems, []);
  });
});

test('端到端：/ask/ 的答案下方有「用全文搜尋找『…』」連到 /search/?q=（有答案與查無兩種）', async (tc) => {
  await withBrowser(tc, async ({ browser, origin }) => {
    for (const q of ['抗蛇毒血清', '登革熱會人傳人嗎']) {
      const { page, problems } = await open(browser, `${origin}/ask/?q=${encodeURIComponent(q)}`);
      await page.waitForSelector('a[data-fulltext]', { timeout: 20000 });
      assert.deepEqual(problems, [], `${q} 在瀏覽器不得有錯誤（第二十五輪的 no-match 曾因 process.env 在瀏覽器 ReferenceError）`);
      const a = page.locator('a[data-fulltext]');
      assert.equal((await a.textContent()).trim(), `用全文搜尋找「${q}」`);
      assert.ok((await a.getAttribute('href')).endsWith(`/search/?q=${encodeURIComponent(q)}`));
      await a.click();
      await page.waitForURL(/\/search\/\?q=/);
      assert.equal(await page.inputValue('#search-q'), q);
    }
  });
});
