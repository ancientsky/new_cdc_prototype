// 每頁 JS 位元組預算（第二十六輪，issue #34）。
// 做法：掃 dist 內每個 HTML 的 <script src>，沿著靜態 import 追下去，加總「原始位元組」（未壓縮）。
// 近似值，不含內嵌 <script>、CSS、圖片；目的是擋住「不小心把大檔加進每一頁」。
// 三種預算（皆可用環境變數調整，例：JS_BUDGET_KB=150 npm run build；要改預設值請改本檔常數並在 PR 說明理由）：
//   公開頁            JS_BUDGET_KB          預設 120 KB
//   載入答案引擎的頁   ENGINE_JS_BUDGET_KB   預設 320 KB（ask／data／factcheck；answer/core.js 約 176 KB 是已知技術債，
//                                             拆檔路線圖見 ARCHITECTURE 第 29 章，拆完後把這個預算降到與公開頁相同）
//   /admin/ 頁        ADMIN_JS_BUDGET_KB    預設 0 = 只回報不擋
//
// 第二十八輪：/search/（Pagefind 全文搜尋）怎麼算——「立即載入」的 JS 才算：search.js＋search-query.js（約 12 KB）＋ui.js＋i18n，與其他公開頁同一個 120 KB 預算。
// pagefind.js（約 45 KB）、pagefind-worker.js、WebAssembly 與索引分片是使用者第一次按搜尋時才由 import()／fetch 動態抓取，
// 而本掃描只沿「靜態 import」追（動態 import() 不會被 IMPORT_RE 抓到），所以 dist/pagefind/ 不計入——這是刻意的：
// 搜尋索引是資料不是每頁都要付的程式碼；它的成本改由 scripts/lib/pagefind.mjs 在建置 log 報告（執行期約 0.3 MB、第一次查詢實測約 0.33 MB），
// 並由 tests/round28-search.test.mjs 擋住「有人在 HTML 直接 <script src> pagefind」這種繞過預算的寫法。
import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_PUBLIC_KB = 120;
export const DEFAULT_ENGINE_KB = 320;
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
    const engine = [...files].some((x) => x.endsWith(`${path.sep}answer${path.sep}core.js`));
    rows.push({ page: rel, bytes, admin: rel.startsWith('admin/'), engine });
  }
  const top = (list) => list.reduce((a, r) => (r.bytes > (a?.bytes ?? -1) ? r : a), null);
  const pub = rows.filter((r) => !r.admin && !r.engine);
  const eng = rows.filter((r) => !r.admin && r.engine);
  const adm = rows.filter((r) => r.admin);
  const tp = top(pub);
  const ta = top(adm);
  const te = top(eng);
  const over = [...pub.filter((r) => r.bytes > publicKb * 1024), ...eng.filter((r) => r.bytes > engineKb * 1024)];
  const overAdmin = adminKb ? adm.filter((r) => r.bytes > adminKb * 1024) : [];
  return {
    ok: over.length === 0 && overAdmin.length === 0,
    rows,
    engine: { budgetKb: engineKb, count: eng.length, max: te?.bytes ?? 0, maxPage: te?.page ?? '' },
    public: { budgetKb: publicKb, count: pub.length, max: tp?.bytes ?? 0, maxPage: tp?.page ?? '', over },
    admin: { budgetKb: adminKb, count: adm.length, max: ta?.bytes ?? 0, maxPage: ta?.page ?? '', over: overAdmin },
  };
}
