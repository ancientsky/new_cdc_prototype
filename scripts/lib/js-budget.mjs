// 每頁 JS 位元組預算（第二十六輪，issue #34）。
// 做法：掃 dist 內每個 HTML 的 <script src>，沿著靜態 import 追下去，加總「原始位元組」（未壓縮）。
// 近似值，不含內嵌 <script>、CSS、圖片；目的是擋住「不小心把大檔加進每一頁」。
// 三種預算（皆可用環境變數調整，例：JS_BUDGET_KB=150 npm run build；要改預設值請改本檔常數並在 PR 說明理由）：
//   公開頁            JS_BUDGET_KB          預設 120 KB
//   載入答案引擎的頁   ENGINE_JS_BUDGET_KB   預設 240 KB（ask／data／factcheck）
//     第三十四輪（ARCHITECTURE 第 40 章）：core.js 拆成五個模組、生成式模式（llm.js）改成用到才載入、建置時逐檔壓縮（scripts/lib/minify.mjs），
//     引擎頁從 319 KB 降到約 208 KB，預算由 320 KB 降為 240 KB（留約 15% 餘裕擋「不小心變大」）。
//     為什麼還不能降到與公開頁相同的 120 KB：剩下的大宗是規則表、七語拒答文案與答案畫面的多語字串（是資料，不是可再壓的程式），
//     要再降得把這些依語言拆檔（同 i18n 的做法）或把引擎搬到伺服器端；做法與取捨見 ARCHITECTURE 40.4。
//   注意：計算的是「壓縮後、實際上線」的位元組；MINIFY=off 建置時 build.mjs 只回報不擋。
//   /admin/ 頁        ADMIN_JS_BUDGET_KB    預設 0 = 只回報不擋
//
// 第二十八輪：/search/（Pagefind 全文搜尋）怎麼算——「立即載入」的 JS 才算：search.js＋search-query.js（約 12 KB）＋ui.js＋i18n，與其他公開頁同一個 120 KB 預算。
// pagefind.js（約 45 KB）、pagefind-worker.js、WebAssembly 與索引分片是使用者第一次按搜尋時才由 import()／fetch 動態抓取，
// 而本掃描只沿「靜態 import」追（動態 import() 不會被 IMPORT_RE 抓到），所以 dist/pagefind/ 不計入——這是刻意的：
// 搜尋索引是資料不是每頁都要付的程式碼；它的成本改由 scripts/lib/pagefind.mjs 在建置 log 報告（執行期約 0.3 MB、第一次查詢實測約 0.33 MB），
// 並由 tests/round28-search.test.mjs 擋住「有人在 HTML 直接 <script src> pagefind」這種繞過預算的寫法。
//
// 第四十輪（Issue #80）：答案頁的引擎（answer/core.js 與它的模組）改成「使用者提問時才 import()」，所以：
//   - 「含答案引擎的頁」改以「載入 answer/data.js（引擎載入器）」判定；row.bytes 是立即載入的 JS，row.total 再加上提問時才載入的引擎閉包。
//     240 KB 的引擎頁預算套在 total 上——一題深連結（/ask/?q=…）的使用者兩份都要付，預算的意義不變，只是初始畫面輕了。
//   - 新增 checkAskDataBudget()：答案頁提問時要下載的 JSON（當頁語言＋中文的索引分片＋引擎資料，清單與前端共用 src/client/answer/deps-manifest.js），
//     以 gzip 後位元組估算傳輸量（GitHub Pages 與一般 CDN 對 JSON 都會 gzip；level 6 與它們的預設相近），超過 ASK_DATA_BUDGET_KB 建置失敗。
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { ENGINE_PRIMARY, ENGINE_SECONDARY, indexShardNames } from '../../src/client/answer/deps-manifest.js';

export const DEFAULT_PUBLIC_KB = 120;
export const DEFAULT_ENGINE_KB = 240;
/** 答案頁提問時下載的 JSON（gzip 後）：第四十輪實測最大是英文頁 387 KB（英文分片＋中文分片；zh-TW 350 KB），×1.15 ≈ 445 KB（見 docs/deploy.md §15） */
export const DEFAULT_ASK_DATA_KB = 445;
/** 專業版（search-index-pro＋同一組引擎資料）：第四十八輪實測 489 KB，×1.15 ≈ 563 KB，取 565（Issue #103；見 docs/deploy.md §15.3）。ASK_DATA_PRO_BUDGET_KB 可覆寫，0 ＝ 只回報 */
export const DEFAULT_ASK_DATA_PRO_KB = 565;
const SRC_RE = /<script\b[^>]*\bsrc="([^"]+\.js)"/g;
const IMPORT_RE = /(?:^|[;\n}])\s*(?:import|export)\s*(?:[^'"()]*?\bfrom\s*)?['"](\.{1,2}\/[^'"]+)['"]/g;

function walkHtml(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== 'preview') walkHtml(p, out);
    } else if (e.name.endsWith('.html')) out.push(p);
  }
  return out;
}

/** 入口檔與其靜態 import 閉包（絕對路徑集合） */
function closure(entry, cache) {
  if (cache.has(entry)) return cache.get(entry);
  const seen = new Set();
  const stack = [entry];
  while (stack.length) {
    const f = stack.pop();
    if (seen.has(f) || !fs.existsSync(f)) continue;
    seen.add(f);
    const code = fs.readFileSync(f, 'utf8');
    for (const m of code.matchAll(IMPORT_RE)) stack.push(path.resolve(path.dirname(f), m[1]));
  }
  cache.set(entry, seen);
  return seen;
}

/** 檢查整個 dist。回傳 { ok, rows, public, admin } */
export function checkJsBudget(
  distDir,
  {
    basePath = '',
    publicKb = Number(process.env.JS_BUDGET_KB) || DEFAULT_PUBLIC_KB,
    adminKb = Number(process.env.ADMIN_JS_BUDGET_KB) || 0,
    engineKb = Number(process.env.ENGINE_JS_BUDGET_KB) || DEFAULT_ENGINE_KB,
  } = {},
) {
  const cache = new Map();
  const rows = [];
  for (const html of walkHtml(distDir)) {
    const rel = path.relative(distDir, html).split(path.sep).join('/');
    const text = fs.readFileSync(html, 'utf8');
    const files = new Set();
    for (const m of text.matchAll(SRC_RE)) {
      const src = basePath && m[1].startsWith(`${basePath}/`) ? m[1].slice(basePath.length) : m[1];
      if (!src.startsWith('/')) continue;
      for (const f of closure(path.join(distDir, src), cache)) files.add(f);
    }
    let bytes = 0;
    for (const f of files) bytes += fs.statSync(f).size;
    const engine = [...files].some((x) => x.endsWith(`${path.sep}answer${path.sep}core.js`) || x.endsWith(`${path.sep}answer${path.sep}data.js`));
    let total = bytes;
    if (engine) {
      const lazy = closure(path.join(distDir, 'assets/js/answer/core.js'), cache);
      for (const f of lazy) if (!files.has(f)) total += fs.statSync(f).size;
    }
    rows.push({ page: rel, bytes, total, admin: rel.startsWith('admin/'), engine });
  }
  const top = (list) => list.reduce((a, r) => (r.bytes > (a?.bytes ?? -1) ? r : a), null);
  const pub = rows.filter((r) => !r.admin && !r.engine);
  const eng = rows.filter((r) => !r.admin && r.engine);
  const adm = rows.filter((r) => r.admin);
  const tp = top(pub);
  const ta = top(adm);
  const te = eng.reduce((a, r) => (r.total > (a?.total ?? -1) ? r : a), null);
  const ti = top(eng);
  const over = [...pub.filter((r) => r.bytes > publicKb * 1024), ...eng.filter((r) => r.total > engineKb * 1024)];
  const overAdmin = adminKb ? adm.filter((r) => r.bytes > adminKb * 1024) : [];
  return {
    ok: over.length === 0 && overAdmin.length === 0,
    rows,
    // max／maxPage：提問後合計（引擎預算套在這裡）；initialMax：立即載入的部分（第四十輪起引擎不在其中）
    engine: { budgetKb: engineKb, count: eng.length, max: te?.total ?? 0, maxPage: te?.page ?? '', initialMax: ti?.bytes ?? 0, initialMaxPage: ti?.page ?? '' },
    public: { budgetKb: publicKb, count: pub.length, max: tp?.bytes ?? 0, maxPage: tp?.page ?? '', over },
    admin: { budgetKb: adminKb, count: adm.length, max: ta?.bytes ?? 0, maxPage: ta?.page ?? '', over: overAdmin },
  };
}

const gz = (f) => zlib.gzipSync(fs.readFileSync(f), { level: 6 }).length;

/**
 * 答案頁的資料傳輸量（第四十輪，Issue #80）：每種語言的 /ask/ 在提問時要下載的 JSON，gzip 後位元組加總。
 * 算法：索引分片（中文＋當頁語言）＋ deps-manifest 的主要與次要 JSON ＋ v1/index.json（可選檔的清單）；民眾版。
 * 不含：疾病頁 JSON 與 news.json（答案出來之後側欄才抓、且依問題而定）、專業版（另列 pro，第四十八輪起也有自己的預算 ASK_DATA_PRO_BUDGET_KB）。
 * 回傳 { ok, budgetKb, rows: [{ lang, bytes, raw, files }], max, maxLang, pro }。budgetKb 為 0 ＝ 只回報不擋。
 */
export function checkAskDataBudget(
  distDir,
  {
    langs = ['zh-TW'],
    budgetKb = Number(process.env.ASK_DATA_BUDGET_KB) || DEFAULT_ASK_DATA_KB,
    proBudgetKb = process.env.ASK_DATA_PRO_BUDGET_KB === undefined ? DEFAULT_ASK_DATA_PRO_KB : Number(process.env.ASK_DATA_PRO_BUDGET_KB) || 0,
  } = {},
) {
  const v1 = (n) => path.join(distDir, 'v1', `${n}.json`);
  const shared = [...ENGINE_PRIMARY, ...ENGINE_SECONDARY].map(([n]) => n).concat('index');
  const measure = (names) => {
    let bytes = 0;
    let raw = 0;
    const files = [];
    for (const n of names) {
      const f = v1(n);
      if (!fs.existsSync(f)) continue; // 可選檔不存在時前端也不會抓
      const b = gz(f);
      bytes += b;
      raw += fs.statSync(f).size;
      files.push([n, b]);
    }
    return { bytes, raw, files };
  };
  const rows = langs.map((lang) => ({ lang, ...measure([...indexShardNames('search-index', lang), ...shared]) }));
  const pro = measure([...indexShardNames('search-index-pro', 'zh-TW'), ...shared]);
  const top = rows.reduce((a, r) => (r.bytes > (a?.bytes ?? -1) ? r : a), null);
  const publicOk = !budgetKb || rows.every((r) => r.bytes <= budgetKb * 1024);
  const proOk = !proBudgetKb || pro.bytes <= proBudgetKb * 1024;
  return { ok: publicOk && proOk, publicOk, proOk, budgetKb, proBudgetKb, rows, max: top?.bytes ?? 0, maxLang: top?.lang ?? '', pro };
}
