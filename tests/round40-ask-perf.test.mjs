// 第四十輪（Issue #80）：智慧問答頁手機效能——名稱比對器預篩、索引依語言分片、引擎用到才載入、資料傳輸量門檻。
// 不需要 dist 的部分：名稱比對器與原本的正規式逐一比對（判定必須完全相同）、靜態 import 規則。
// 需要 dist 的部分：分片內容、JS 與資料預算、Playwright 端到端（沒有 dist 或瀏覽器就 skip）。
// TBT 量測很慢又受機器影響，預設不跑：ASK_PERF=1 node --test tests/round40-ask-perf.test.mjs（見 docs/deploy.md §15）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { matcherFor } from '../src/client/answer/lexicon.js';
import { ENGINE_PRIMARY, ENGINE_SECONDARY, indexShardNames } from '../src/client/answer/deps-manifest.js';
import { checkJsBudget, checkAskDataBudget, DEFAULT_ASK_DATA_KB, DEFAULT_ENGINE_KB } from '../scripts/lib/js-budget.mjs';
import { config } from '../site.config.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DIST = process.env.DIST_DIR ? path.resolve(process.env.DIST_DIR) : path.join(ROOT, 'dist');
const hasDist = fs.existsSync(path.join(DIST, 'ask/index.html'));
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

// ───────────────────────── 名稱比對器：預篩不改變任何判定 ─────────────────────────
test('matcherFor 預篩：對全部疾病／詞彙／疫苗／國家名稱 × 評估集全部問句，命中與否、命中位置都與原本的正規式相同', () => {
  const names = new Set();
  for (const d of readJson('content/master/diseases.json')) for (const n of [d.name, ...(d.aliases ?? []), d.nameEn]) names.add(n);
  for (const g of readJson('content/master/glossary.json'))
    for (const n of [g['zh-TW'], ...(g.aliases ?? []), ...(g.deprecated ?? []), g.en, g.ja, g.tl, g.vi, g.id_, g.th]) names.add(n);
  for (const v of readJson('content/master/vaccines.json'))
    for (const n of [v.name, v.title, ...(v.aliases ?? []), v.nameEn, v.slug?.toUpperCase()]) names.add(n);
  for (const c of readJson('content/master/countries.json')) for (const n of [c.name, c.nameEn, ...(c.aliases ?? [])]) names.add(n);
  const matchers = [...names].map((n) => matcherFor(n)).filter(Boolean);
  assert.ok(matchers.length > 1000, `名稱 ${matchers.length}`);
  const qs = readJson('content/governance/eval-set.json').questions.map((x) => x.q);
  // 大小寫、全形空白、名稱本身（含中英混排的空白變化）也要一致
  const subjects = [
    ...qs,
    ...qs.map((q) => q.toUpperCase()),
    'DENGUE FEVER 登革熱',
    'mmr疫苗',
    'MMR 疫苗',
    'A肝',
    'a 肝',
    'B型肝炎',
    'Sốt xuất huyết',
    'JAPAN 日本',
    '去 Japan 要打疫苗嗎',
    '',
  ];
  let hits = 0;
  for (const m of matchers) {
    const plain = new RegExp(m.pattern, m.flags);
    for (const s of [...subjects, ...[...names].slice(0, 200)]) {
      const a = s.match(m);
      const b = s.match(plain);
      assert.equal(!!a, !!b, `${m.pattern} × ${s}`);
      if (a) {
        hits++;
        assert.equal(a.index, b.index);
        assert.equal(a[0], b[0]);
      }
      assert.equal(m.test(s), plain.test(s));
    }
  }
  assert.ok(hits > 300, `命中次數 ${hits}（樣本要涵蓋「會中」的情況，不能只驗「不中」）`);
});

test('matcherFor：比對器在需要之前不建立 RegExp（預篩擋下的名稱永遠不編譯）', () => {
  const m = matcherFor('Dengue fever');
  assert.equal(m.rx, null);
  assert.equal(m.test('流感疫苗哪裡打'), false);
  assert.equal(m.rx, null, '問句不含必要子字串 ⇒ 不建立正規式');
  assert.equal(m.test('what is dengue fever'), true);
  assert.ok(m.rx instanceof RegExp);
});

// ───────────────────────── 引擎用到才載入（靜態 import 規則） ─────────────────────────
test('答案頁的初始模組（ui.js、render.js、data.js、inline.js）不靜態 import core.js；data.js 以 import() 載入', () => {
  const STATIC = /(?:^|[;\n}])\s*import\s*(?:[^'"()]*?\bfrom\s*)?['"](\.{1,2}\/[^'"]+)['"]/g;
  for (const f of ['ui.js', 'render.js', 'data.js', 'inline.js', 'factcheck.js', 'stats.js']) {
    const code = fs.readFileSync(path.join(ROOT, 'src/client/answer', f), 'utf8');
    const deps = [...code.matchAll(STATIC)].map((m) => m[1]);
    assert.ok(!deps.includes('./core.js'), `${f} 靜態 import core.js：${deps.join(', ')}`);
  }
  assert.match(fs.readFileSync(path.join(ROOT, 'src/client/answer/data.js'), 'utf8'), /import\('\.\/core\.js'\)/);
});

test('deps-manifest：主要＋次要清單與 data.js 讀的檔一致；分片名稱（中文頁只一片，外語頁加中文正本）', () => {
  const names = [...ENGINE_PRIMARY, ...ENGINE_SECONDARY].map(([n]) => n);
  assert.equal(new Set(names).size, names.length, '沒有重複');
  for (const n of ['faq', 'diseases', 'glossary', 'governance/ai-status', 'travel-alerts', 'country-levels']) assert.ok(names.includes(n), n);
  assert.deepEqual(indexShardNames('search-index', 'zh-TW'), ['search-index.zh-TW']);
  assert.deepEqual(indexShardNames('search-index-pro', 'vi'), ['search-index-pro.zh-TW', 'search-index-pro.vi']);
});

// ───────────────────────── dist：分片與預算 ─────────────────────────
test('dist：search-index 依語言分片——各片的聯集＝完整檔、每片只含該語言、精簡 JSON；完整檔保留並在 meta.shards 列出分片', (tc) => {
  if (!hasDist) return tc.skip('dist 尚未建置');
  for (const base of ['search-index', 'search-index-pro']) {
    const full = JSON.parse(fs.readFileSync(path.join(DIST, `v1/${base}.json`), 'utf8'));
    assert.deepEqual(Object.keys(full.meta.shards).sort(), config.langs.map((l) => l.code).sort());
    const ids = [];
    for (const { code } of config.langs) {
      const raw = fs.readFileSync(path.join(DIST, `v1/${base}.${code}.json`), 'utf8');
      assert.ok(!raw.includes('\n  '), `${base}.${code} 應為精簡 JSON`);
      const j = JSON.parse(raw);
      assert.equal(j.meta.lang, code);
      assert.equal(j.meta.shardOf, `/v1/${base}.json`);
      assert.ok(
        j.data.every((c) => (c.lang ?? 'zh-TW') === code),
        `${base}.${code} 混入其他語言`,
      );
      ids.push(...j.data.map((c) => c.id));
    }
    assert.deepEqual(ids.sort(), full.data.map((c) => c.id).sort(), `${base} 分片聯集與完整檔不同`);
  }
  const zh = fs.statSync(path.join(DIST, 'v1/search-index.zh-TW.json')).size;
  assert.ok(zh < fs.statSync(path.join(DIST, 'v1/search-index.json')).size * 0.7, '中文頁要下載的索引應明顯小於完整檔（實測約 61%：少了外語片段與縮排）');
});

test('dist：答案頁立即載入的 JS 不含引擎；提問後合計仍在 240 KB 引擎預算內；資料傳輸量在門檻內', (tc) => {
  if (!hasDist) return tc.skip('dist 尚未建置');
  const r = checkJsBudget(DIST, { basePath: config.basePath });
  const ask = r.rows.find((x) => x.page === 'ask/index.html');
  assert.ok(ask.engine, '答案頁仍歸在「含答案引擎的頁」');
  assert.ok(ask.total - ask.bytes > 60 * 1024, `引擎閉包（提問時才載入）約 ${(ask.total - ask.bytes) / 1024} KB`);
  assert.ok(ask.total <= DEFAULT_ENGINE_KB * 1024, `ask 合計 ${ask.total}`);
  const d = checkAskDataBudget(DIST, { langs: config.langs.map((l) => l.code) });
  assert.ok(d.ok, `資料 ${d.maxLang} ${d.max}`);
  assert.ok(d.max <= DEFAULT_ASK_DATA_KB * 1024);
  const zh = d.rows.find((x) => x.lang === 'zh-TW');
  assert.ok(
    zh.files.some(([n]) => n === 'search-index.zh-TW'),
    '算到中文分片',
  );
  assert.ok(!zh.files.some(([n]) => n === 'search-index'), '不算完整檔（前端不下載）');
});

// ───────────────────────── 端到端 ─────────────────────────
const PW = process.env.PW_MODULE || '/opt/node22/lib/node_modules/playwright/index.mjs';
const CHROME = process.env.CHROME_BIN || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml' };

async function withBrowser(tc, fn) {
  if (!hasDist) return tc.skip('dist 尚未建置');
  if (!fs.existsSync(PW) || !fs.existsSync(CHROME)) return tc.skip('沒有 Playwright／Chromium');
  const { chromium } = await import(pathToFileURL(PW).href);
  const base = config.basePath;
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
    await fn({ browser, origin: `http://127.0.0.1:${srv.address().port}${base}` });
  } finally {
    await browser.close();
    srv.close();
  }
}
const track = (page) => {
  const urls = [];
  page.on('request', (r) => urls.push(new URL(r.url()).pathname));
  return urls;
};
const answered = (page) =>
  page.waitForFunction(
    () => document.querySelector('#answer .c-answer__inner') && document.querySelector('#answer').getAttribute('aria-busy') === 'false',
    null,
    {
      timeout: 30000,
    },
  );

test('端到端：/ask/ 沒有 q 時不下載引擎與索引；聚焦問題框才開始預取；送出後有答案', async (tc) => {
  await withBrowser(tc, async ({ browser, origin }) => {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    const urls = track(page);
    await page.goto(`${origin}/ask/`, { waitUntil: 'load' });
    await page.waitForTimeout(800);
    assert.ok(!urls.some((u) => /\/v1\/search-index/.test(u)), `初始畫面不應下載索引：${urls.filter((u) => u.includes('/v1/')).join(' ')}`);
    assert.ok(!urls.some((u) => u.endsWith('/answer/core.js')), '初始畫面不應下載引擎程式');
    assert.ok(!urls.some((u) => u.includes('/v1/')), '初始畫面不應下載任何 v1 JSON');
    await page.focus('#ask-q');
    await page.waitForFunction(() => performance.getEntriesByType('resource').some((e) => e.name.includes('search-index.zh-TW')), null, { timeout: 10000 });
    assert.ok(
      urls.some((u) => u.endsWith('/answer/core.js')),
      '聚焦後預取引擎程式',
    );
    await page.fill('#ask-q', '登革熱');
    await page.press('#ask-q', 'Enter');
    await answered(page);
    assert.match(await page.textContent('#answer'), /登革熱/);
    assert.ok(!urls.some((u) => u === '/v1/search-index.json' || u.endsWith('/v1/search-index.json')), '不下載完整索引');
    assert.deepEqual(errors, []);
  });
});

test('端到端：/ask/?q=登革熱 有答案、只下載中文分片；/en/ask/?q=dengue 下載英文＋中文分片', async (tc) => {
  await withBrowser(tc, async ({ browser, origin }) => {
    for (const [p, want, not] of [
      [`/ask/?q=${encodeURIComponent('登革熱')}`, ['search-index.zh-TW.json'], ['search-index.en.json', 'search-index.json']],
      ['/en/ask/?q=dengue', ['search-index.zh-TW.json', 'search-index.en.json'], ['search-index.json', 'search-index.vi.json']],
    ]) {
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      const urls = track(page);
      await page.goto(`${origin}${p}`);
      await answered(page);
      assert.ok((await page.locator('#answer .c-answer__inner').count()) === 1);
      const files = urls.filter((u) => u.includes('/v1/search-index')).map((u) => u.split('/').pop());
      for (const w of want) assert.ok(files.includes(w), `${p} 應下載 ${w}：${files}`);
      for (const n of not) assert.ok(!files.includes(n), `${p} 不應下載 ${n}：${files}`);
      assert.deepEqual(errors, []);
      await page.close();
    }
  });
});

test('效能（ASK_PERF=1 才跑）：4 倍 CPU 降速、手機視窗，/ask/?q=登革熱 的 TBT 與傳輸量在門檻內', async (tc) => {
  if (process.env.ASK_PERF !== '1') return tc.skip('設 ASK_PERF=1 才量（需要 BASE_PATH= 的建置與 Chromium，約 1 分鐘）');
  if (!hasDist) return tc.skip('dist 尚未建置');
  const { runAll, SCENARIOS } = await import('../scripts/perf-ask.mjs');
  const rows = await runAll({ runs: Number(process.env.PERF_RUNS) || 3, scenarios: SCENARIOS, log: () => {} });
  const deep = rows.find((r) => r.name === '/ask/?q=登革熱');
  const idle = rows.find((r) => r.name === '/ask/（無 q）');
  const maxTbt = Number(process.env.ASK_PERF_MAX_TBT_MS) || 1500;
  assert.ok(deep.tbtMs <= maxTbt, `TBT ${deep.tbtMs} ms > ${maxTbt}`);
  assert.ok(deep.transferKB <= 600, `傳輸 ${deep.transferKB} KB`);
  assert.equal(idle.jsonKB, 0, '無 q 的初始畫面不下載 JSON');
});
