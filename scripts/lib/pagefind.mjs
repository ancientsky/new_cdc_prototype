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

/** <main data-pagefind-body>…</main> 內的文字節點：CJK 字元之間補一個空白；<script>／<style> 內容與標籤屬性不動 */
export function spaceCjkInMain(htmlText) {
  return htmlText.replace(/(<main\b[^>]*\bdata-pagefind-body\b[^>]*>)([\s\S]*?)(<\/main>)/, (_, open, inner, close) => {
    let skip = null; // 目前在 script／style 裡
    const out = inner.replace(/<[^>]*>|[^<]+/g, (tok) => {
      if (tok.startsWith('<')) {
        const m = tok.match(/^<(\/)?(script|style)\b/i);
        if (m) skip = m[1] ? null : m[2].toLowerCase();
        return tok;
      }
      return skip ? tok : tok.replace(BETWEEN_CJK, ' ');
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
  } finally {
    // writeFiles 回傳時 pagefind-entry.json 可能還沒寫完（實測立刻讀會得到空檔）；close() 會等 Pagefind 子行程結束，之後再讀才可靠
    await pagefind.close();
  }
  // Pagefind 預設會多輸出三套現成 UI 與標示用的 highlight 腳本（約 0.5 MB）。本站的 UI 是自刻的（src/client/search.js），不用就不部署：
  // 少一份「看起來能用、其實沒人維護」的程式，也避免它們被誤引用而繞過 JS 預算。
  for (const f of UNUSED_FILES) fs.rmSync(path.join(out, f), { force: true });
  const entry = JSON.parse(fs.readFileSync(path.join(out, 'pagefind-entry.json'), 'utf8'));
  return { skipped: false, pages, languages: Object.keys(entry.languages ?? {}).sort(), ms: Date.now() - t0, ...pagefindSize(dist) };
}
