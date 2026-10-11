// Pagefind 靜態全文索引（第二十八輪，ARCHITECTURE 31）：建置最後一步，掃 dist/**/*.html → dist/pagefind/。
//
// 為什麼放進 build.mjs 而不是另外一個 npm script / CI 步驟：
//   - pages.yml、content-pr.yml 的預覽與無障礙檢測都是呼叫 build.mjs；放在這裡，所有路徑自動都有索引，
//     沒有人需要記得「建置完還要再跑一次 pagefind」，也不會出現「站上有搜尋頁、卻沒有索引」的狀態。
//   - 索引吃的是 dist 的最終 HTML，必須在所有頁面寫完之後；而 PR 預覽（dist/preview/pr-N/）是別的 commit 建的，
//     各自已有自己的 pagefind/，所以本步驟一定要在「複製預覽」之前跑，主站索引才不會混進預覽頁。
//
// 收什麼頁由 HTML 決定（正面表列）：只有 <main data-pagefind-body> 的頁會進索引，見 src/templates/public/_pagefind.mjs。
// 這裡再加一道「路徑黑名單」當保險（isIndexable）：就算有人誤把 data-pagefind-body 加到後台或預覽的模板，也進不了索引。
//
// 中日文處理（關鍵）：Pagefind extended 對中文用內建詞典斷詞，但「登革熱」這類醫學專有名詞不在詞典裡，
// 同一個詞在不同句子裡被切成不同的詞，查詢端又沒有斷詞器 ⇒ 實測 72 頁含「登革熱」只搜得到 5 頁（召回 7%）。
// 做法：餵給 Pagefind 的是「CJK 字元之間補空白」的副本（只用於索引，dist 裡真正的 HTML 不動，讀屏不受影響），
// 每個字成為一個詞並保留位置；查詢端（src/client/search.js）把 CJK 連續字串轉成 "登 革 熱" 的精確片語查詢，
// 於是變成「字元級子字串搜尋」：召回與精準都是 100%，不依賴任何詞典。代價與限制見 ARCHITECTURE 31.4。
// 環境變數：PAGEFIND=off 略過（只想看版面、不需要搜尋時，建置快一些；/search/ 會顯示載入失敗訊息）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as pagefind from 'pagefind';

const UNUSED_FILES = ['pagefind-ui.js', 'pagefind-ui.css', 'pagefind-modular-ui.js', 'pagefind-modular-ui.css', 'pagefind-component-ui.js', 'pagefind-component-ui.css', 'pagefind-highlight.js'];

/** 假名、CJK 擴充 A、統一表意文字、相容表意文字。客戶端 search.js 用同一組範圍（兩邊必須一致，tests/round28-search.test.mjs 檢查） */
export const CJK_CLASS = '\\u3040-\\u30ff\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff';
const BETWEEN_CJK = new RegExp(`(?<=[${CJK_CLASS}])(?=[${CJK_CLASS}])`, 'g');

/** 不進索引的路徑（相對 dist，/ 分隔）。語言前綴一併處理。 */
const EXCLUDED = /^(?:(?:en|ja|tl|vi|id|th)\/)?(?:admin|preview|legacy|pagefind|assets|files|v1|headers|redirects|search|ask|pending)\//;
export function isIndexable(rel) {
  return rel.endsWith('.html') && rel !== '404.html' && !EXCLUDED.test(rel);
}

/**
 * <main data-pagefind-body>…</main> 內的文字節點：CJK 字元之間補一個空白；<script>／<style> 內容與標籤屬性不動。
 *
 * 第四十輪（Issue #79「兒童健康手冊」0 筆）再補兩件事，都只改「餵給 Pagefind 的副本」，dist 的 HTML 不動：
 *   1. Pagefind 建索引時整段丟掉 <label>、<form>、<nav>、<footer>、<noscript>、<template>、<svg> 的內容（實測，見 tests/round40-search-recall.test.mjs）。
 *      <form> 與 <nav> 本來就該丟（每頁的「回報問題」表單、麵包屑），但申請頁的「應備文件」勾選清單是 <label> 包文字——
 *      那是內容不是表單欄位名，被丟掉就是使用者看得到、卻搜不到。所以 <form> 外面的 <label> 在副本裡改成 <span>（屬性照留）；
 *      <form> 裡的 <label>（欄位名稱）維持被丟掉。
 *   2. 行內標籤兩側的中文（「<strong>2 年內</strong>提出」）原本只在同一個文字節點內補空白，跨標籤的「內提」黏成一個詞；
 *      Pagefind 目前剛好還找得到，但那是靠它內建斷詞的運氣。現在跨標籤也補，字元級片語不再依賴詞典。
 */
// 只有「行內」標籤兩側才算同一串文字；區塊標籤（p、li、h1…）Pagefind 本來就斷開，不必補
const INLINE = new Set(['a', 'abbr', 'b', 'bdi', 'bdo', 'cite', 'code', 'data', 'dfn', 'em', 'i', 'kbd', 'label', 'mark', 'q', 's', 'samp', 'small', 'span', 'strong', 'sub', 'sup', 'time', 'u', 'var', 'ruby', 'rb', 'rt', 'rp', 'wbr']);
const START_CJK = new RegExp(`^[${CJK_CLASS}]`);
const END_CJK = new RegExp(`[${CJK_CLASS}]$`);
export function spaceCjkInMain(htmlText) {
  return htmlText.replace(/(<main\b[^>]*\bdata-pagefind-body\b[^>]*>)([\s\S]*?)(<\/main>)/, (_, open, inner, close) => {
    let skip = null; // 目前在 script／style 裡
    let formDepth = 0;
    let relabel = false; // 目前這個 <label> 已改寫成 <span>
    let prevCjk = false; // 上一段文字以 CJK 字結尾（跨行內標籤補空白用）
    const out = inner.replace(/<[^>]*>|[^<]+/g, (tok) => {
      if (tok.startsWith('<')) {
        const m = tok.match(/^<(\/)?(script|style)\b/i);
        if (m) skip = m[1] ? null : m[2].toLowerCase();
        if (skip) return tok;
        if (!INLINE.has(tok.match(/^<\/?([a-zA-Z][\w-]*)/)?.[1]?.toLowerCase())) prevCjk = false;
        if (/^<form\b/i.test(tok)) formDepth++;
        else if (/^<\/form\s*>/i.test(tok)) formDepth = Math.max(0, formDepth - 1);
        else if (!formDepth && /^<label\b/i.test(tok)) {
          relabel = true;
          return tok.replace(/^<label\b/i, '<span data-pf-label');
        } else if (relabel && /^<\/label\s*>/i.test(tok)) {
          relabel = false;
          return '</span>';
        }
        return tok;
      }
      if (skip) return tok;
      let t = tok.replace(BETWEEN_CJK, ' ');
      if (prevCjk && START_CJK.test(t)) t = ` ${t}`;
      prevCjk = END_CJK.test(t);
      return t;
    });
    return open + out + close;
  });
}

function* walkHtml(dist, dir = dist) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    const rel = path.relative(dist, p).split(path.sep).join('/');
    if (e.isDirectory()) { if (!EXCLUDED.test(`${rel}/`)) yield* walkHtml(dist, p); } else if (isIndexable(rel)) yield [p, rel];
  }
}

/** dist/pagefind 內檔案數與位元組；pagefind.js＋wasm＋worker 是 /search/ 第一次搜尋時才抓的「執行期」，其餘是索引分片 */
export function pagefindSize(dist) {
  const dir = path.join(dist, 'pagefind');
  let files = 0, bytes = 0, runtime = 0;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      const sz = fs.statSync(p).size;
      files++; bytes += sz;
      if (/^(pagefind\.js|pagefind-entry\.json|pagefind-worker\.js|wasm\..*)$/.test(e.name) || e.name.endsWith('.pagefind')) runtime += sz;
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return { files, bytes, runtime };
}

/**
 * 等 Pagefind 把檔案寫完（第四十輪修正）。writeFiles 回傳時子行程可能還在寫（實測立刻讀 pagefind-entry.json 會得到空檔），
 * 而 pagefind.close() 是直接 kill 子行程、不等它寫完——第二十八輪的註解以為 close() 會等，其實不會；機器忙的時候
 * （CI、node --test 平行跑）曾抓到 WebAssembly 檔被截斷（"invalid gzip data"）。所以 close 之前先等：
 * pagefind-entry.json 讀得出來、而且整個輸出資料夾的檔案數與總位元組連續兩次（間隔 150 ms）不變；最多等 timeoutMs。
 */
export async function waitForPagefindOutput(out, { timeoutMs = 15000 } = {}) {
  const signature = () => {
    let files = 0;
    let bytes = 0;
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else {
          files++;
          bytes += fs.statSync(p).size;
        }
      }
    };
    if (fs.existsSync(out)) walk(out);
    return `${files}:${bytes}`;
  };
  const entryOk = () => {
    try {
      return !!JSON.parse(fs.readFileSync(path.join(out, 'pagefind-entry.json'), 'utf8')).languages;
    } catch {
      return false;
    }
  };
  const until = Date.now() + timeoutMs;
  let last = '';
  let stable = 0;
  while (Date.now() < until) {
    const sig = signature();
    stable = sig === last && entryOk() ? stable + 1 : 0;
    if (stable >= 2) return;
    last = sig;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`pagefind 輸出 ${timeoutMs} ms 內沒有寫完（${out}）`);
}

/**
 * 建索引。回傳 { skipped, pages, languages, ms, files, bytes, runtime }。
 * 失敗（Pagefind 回 errors、或沒有任何頁被收）一律丟錯：沒有索引的 /search/ 是壞掉的功能，不能靜靜地上線。
 */
export async function buildPagefindIndex(dist, { log = () => {} } = {}) {
  if (process.env.PAGEFIND === 'off') { log('PAGEFIND=off，略過全文索引'); return { skipped: true }; }
  const t0 = Date.now();
  const out = path.join(dist, 'pagefind');
  fs.rmSync(out, { recursive: true, force: true });
  const created = await pagefind.createIndex({ verbose: false });
  if (created.errors?.length) throw new Error(`pagefind createIndex：${created.errors.join('；')}`);
  const index = created.index;
  let pages = 0;
  try {
    for (const [file, rel] of walkHtml(dist)) {
      const raw = fs.readFileSync(file, 'utf8');
      if (!raw.includes('data-pagefind-body')) continue;
      const url = `/${rel.replace(/(?:^|\/)index\.html$/, '/').replace(/^\/\//, '/')}`;
      const r = await index.addHTMLFile({ url, content: spaceCjkInMain(raw) });
      if (r.errors?.length) throw new Error(`pagefind addHTMLFile ${rel}：${r.errors.join('；')}`);
      pages++;
    }
    if (!pages) throw new Error('pagefind 沒有收到任何頁面（layout 的 data-pagefind-body 是否被拿掉？）');
    const wrote = await index.writeFiles({ outputPath: out });
    if (wrote.errors?.length) throw new Error(`pagefind writeFiles：${wrote.errors.join('；')}`);
    await waitForPagefindOutput(out);
  } finally {
    await pagefind.close();
  }
  // Pagefind 預設會多輸出三套現成 UI 與標示用的 highlight 腳本（約 0.5 MB）。本站的 UI 是自刻的（src/client/search.js），不用就不部署：
  // 少一份「看起來能用、其實沒人維護」的程式，也避免它們被誤引用而繞過 JS 預算。
  for (const f of UNUSED_FILES) fs.rmSync(path.join(out, f), { force: true });
  const entry = JSON.parse(fs.readFileSync(path.join(out, 'pagefind-entry.json'), 'utf8'));
  return { skipped: false, pages, languages: Object.keys(entry.languages ?? {}).sort(), ms: Date.now() - t0, ...pagefindSize(dist) };
}

/* ───────────────────────── 第四十輪（Issue #79）：建置後自我檢查「頁面上有的詞必須搜得到」 ───────────────────────── */

/**
 * 在 Node 裡載入 dist/pagefind/pagefind.js 做查詢（與瀏覽器同一支程式、同一份索引；不需要瀏覽器）。
 * pagefind.js 用 fetch 讀索引分片；Node 的 fetch 不收 file: 網址，所以這裡只替 file: 網址補一層讀檔，其餘照舊交給原本的 fetch。
 * Node 沒有 <html lang>，Pagefind 會選「頁數最多的語言」＝ zh-tw（本站最大宗；verifyPagefindRecall 只抽 zh-TW 頁）。
 * 每次呼叫都帶不同的查詢字串重新 import：pagefind.js 的狀態是模組層級的，換一份索引（測試的 fixture）時不能沿用舊的。
 */
export async function loadPagefindForNode(pagefindDir) {
  if (!globalThis.__pfFileFetch) {
    const orig = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const u = String(input?.url ?? input);
      if (u.startsWith('file:')) return new Response(fs.readFileSync(fileURLToPath(u)));
      return orig(input, init);
    };
    globalThis.__pfFileFetch = true;
  }
  return import(`${pathToFileURL(path.join(pagefindDir, 'pagefind.js')).href}?v=${Date.now()}-${Math.random()}`);
}

// Pagefind 整段不收的元素（實測，見 tests/round40-search-recall.test.mjs）。<label> 已在 spaceCjkInMain 改寫成 <span>，只剩 <form> 裡的會被丟。
const PF_DROPPED = new Set(['script', 'style', 'noscript', 'template', 'svg', 'nav', 'form', 'footer']);
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

/**
 * <main data-pagefind-body> 裡「使用者看得到、而且本站有意讓人搜」的文字節點（純文字陣列）。
 * 排除 Pagefind 本來就不收的元素與 data-pagefind-ignore 的子樹——那是刻意的（表單欄位名、麵包屑、圖表），不算漏。
 */
export function searchableTexts(htmlText) {
  const inner = htmlText.match(/<main\b[^>]*\bdata-pagefind-body\b[^>]*>([\s\S]*?)<\/main>/)?.[1];
  if (inner == null) return [];
  const out = [];
  let skipTag = null;
  let depth = 0;
  for (const m of inner.matchAll(/<(\/)?([a-zA-Z][\w-]*)([^>]*)>|<[^>]*>|([^<]+)/g)) {
    if (m[4] != null) {
      if (!skipTag && m[4].trim()) out.push(m[4]);
      continue;
    }
    if (!m[2]) continue; // 註解、<!doctype> 之類
    const [, closing, rawName, attrs] = m;
    const name = rawName.toLowerCase();
    const selfClosing = VOID.has(name) || /\/\s*$/.test(attrs);
    if (skipTag) {
      if (name === skipTag && !selfClosing) depth += closing ? -1 : 1;
      if (depth === 0) skipTag = null;
      continue;
    }
    if (closing || selfClosing) continue;
    if (PF_DROPPED.has(name) || /\bdata-pagefind-ignore\b/.test(attrs)) {
      skipTag = name;
      depth = 1;
    }
  }
  return out;
}

/** 可重現的亂數（mulberry32）：同一份內容每次建置抽到同一批字串，數字可以前後比較 */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 召回自我檢查：從 dist 抽 pages 個 zh-TW 頁，每頁從看得到的文字裡抽 perPage 個 4–8 字的連續中文，
 * 用與 /search/ 相同的查詢轉換（rankedSearch，完整字串、不走退路）在剛建好的索引裡查，來源頁必須在結果中。
 * 回傳 { checked, hit, recall, misses: [{ page, q }], pages }。
 * 為什麼在建置時做、不只寫成瀏覽器測試：#79 的漏收是「某種 HTML 寫法」（<label>）造成的，換一個模板或元件就可能再發生；
 * 只有對整站真實輸出抽樣，才抓得到沒人想到要寫測試的那種頁。用 Node 查詢、不需要瀏覽器，CI 每次建置都跑得起來（約數秒）。
 */
export async function verifyPagefindRecall(dist, { pages = 80, perPage = 2, seed = 40, minLen = 4, maxLen = 8 } = {}) {
  const { rankedSearch } = await import('../../src/client/search-query.js');
  const run = new RegExp(`[${CJK_CLASS}]{${minLen},}`, 'g');
  const candidates = [];
  for (const [file, rel] of walkHtml(dist)) {
    if (/^(?:en|ja|tl|vi|id|th)\//.test(rel)) continue;
    const raw = fs.readFileSync(file, 'utf8');
    if (!raw.includes('data-pagefind-body')) continue;
    const runs = searchableTexts(raw).flatMap((t) => t.match(run) ?? []);
    if (runs.length) candidates.push({ url: `/${rel.replace(/(?:^|\/)index\.html$/, '/').replace(/^\/\//, '/')}`, runs });
  }
  candidates.sort((a, b) => a.url.localeCompare(b.url));
  const rand = rng(seed);
  const picked = [];
  const pool = [...candidates];
  while (picked.length < pages && pool.length) picked.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
  const pf = await loadPagefindForNode(path.join(dist, 'pagefind'));
  await pf.options({ baseUrl: '/' });
  const urlOf = new Map(); // Pagefind 結果 id → 網址（data() 會讀分片，同一頁只讀一次）
  const misses = [];
  let checked = 0;
  for (const c of picked) {
    for (let k = 0; k < perPage; k++) {
      const r0 = c.runs[Math.floor(rand() * c.runs.length)];
      const len = Math.min(r0.length, minLen + Math.floor(rand() * (maxLen - minLen + 1)));
      const off = Math.floor(rand() * (r0.length - len + 1));
      const q = r0.slice(off, off + len);
      checked++;
      const { results } = await rankedSearch(pf, q, {}, false);
      let found = false;
      for (const r of results) {
        if (!urlOf.has(r.id)) urlOf.set(r.id, (await r.data()).url);
        if (urlOf.get(r.id) === c.url) {
          found = true;
          break;
        }
      }
      if (!found) misses.push({ page: c.url, q });
    }
  }
  await pf.destroy?.();
  return { checked, hit: checked - misses.length, recall: checked ? (checked - misses.length) / checked : 1, misses, pages: picked.length };
}
