// /search/ 的查詢轉換（純函式，Node 與瀏覽器共用；tests/round28-search.test.mjs 直接 import 測）。
//
// 背景（ARCHITECTURE 31.4）：Pagefind extended 對中文用內建詞典斷詞，「登革熱」這類醫學名詞不在詞典裡、
// 同一個詞在不同句子被切得不一樣，查詢端又沒有斷詞器 ⇒ 實測 72 頁含「登革熱」只搜得到 5 頁。
// 所以索引端（scripts/lib/pagefind.mjs）把 CJK 字元之間補空白，讓每個字成為一個詞並保留位置；
// 查詢端把連續的 CJK 字串轉成精確片語 "登 革 熱"（Pagefind 要求這幾個詞依序相鄰）＝ 字元級子字串搜尋，不依賴任何詞典。
//
// Pagefind 的兩個限制決定了這裡的做法：
//   1. 一個查詢字串只能有「一個」片語（"a b" "c d" 會回 0 筆）⇒ 多個片語拆成多次查詢，取 id 交集。
//   2. 片語查詢不計相關度（每筆分數都是 1，結果只剩網址排序）⇒ 另跑一次「去掉引號」的同一串字（每個字都出現；有標題加權、詞頻），
//      順序用它，集合用片語。
// CJK 字元範圍必須與索引端 scripts/lib/pagefind.mjs 的 CJK_CLASS 相同（測試比對）。
export const CJK = '\\u3040-\\u30ff\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff';
const CJK_RUN = new RegExp(`[${CJK}]{2,}`, 'g');
const CJK_MARK_JOIN = new RegExp(`([${CJK}])</mark>\\s<mark>(?=[${CJK}])`, 'g');
const CJK_GAP = new RegExp(`([${CJK}])(</mark>)?\\s(<mark>)?(?=[${CJK}])`, 'g');
const spaced = (s) => [...s].join(' ');

/**
 * 使用者輸入 → { phrases, plain }。
 * phrases：每個連續 2 字以上的 CJK 字串（已補空白，如「登 革 熱」），以及使用者自己用引號框起來的片語；
 * plain：其餘一般詞（英文、數字、單一 CJK 字）。
 * loose：長度 ≥4 的 CJK 字串拆成前後兩半各成一個片語（兩半都要出現即可），給「完整字串查無」時的退路。
 */
export function parseQuery(q, loose = false) {
  const phrases = [];
  const plain = [];
  String(q ?? '').split('"').forEach((part, i) => {
    if (i % 2) { const t = part.replace(CJK_RUN, spaced).trim(); if (t) phrases.push(t); return; }
    const rest = part.replace(CJK_RUN, (m) => {
      if (loose && m.length >= 4) { const h = Math.ceil(m.length / 2); phrases.push(spaced(m.slice(0, h)), spaced(m.slice(h))); } else phrases.push(spaced(m));
      return ' ';
    });
    plain.push(...rest.split(/\s+/).filter(Boolean));
  });
  return { phrases, plain };
}
/** 單一片語的 Pagefind 查詢字串（一般詞照帶，讓每次查詢都帶上全部條件） */
export const phraseQuery = ({ plain }, phrase) => [...plain, `"${phrase}"`].join(' ');
/** 排序用：去掉引號，等於「每個字都出現」，由 Pagefind 計相關度 */
export const bagQuery = ({ plain, phrases }) => [...plain, ...phrases].join(' ');
/** 有沒有長度 ≥4 的 CJK 字串（才值得走 loose 退路） */
export const hasLongCjk = (q) => new RegExp(`[${CJK}]{4,}`).test(q ?? '');

/**
 * 第四十輪（Issue #79）：完整字串與 loose 都查無時的最後退路——把問句裡最長的 CJK 字串逐步去掉前後的字。
 * 回傳候選 [{ q, term, from }]（q 是整串新查詢、term 是縮短後的字串、from 是原字串），依序試、第一個有結果的就用，
 * 畫面提示「找不到「兒童健康手冊」，改以「健康手冊」搜尋」。
 * 順序：長的先（越長越接近原意）；同長度時「保留後段」優先——中文名詞的中心語在後面（兒童健康「手冊」、麻疹「疫苗」），
 * 去掉前面的修飾語比去掉後面的中心語更接近使用者要找的東西。
 * 最短縮到原長度的一半（且至少 2 字），候選最多 max 個：避免「傳染病防治法施行細則」縮成「施行」這種已經不是原意的詞。
 * 使用者自己加引號的片語不縮（那是明確要求「完全相同」）。
 */
export function shorterQueries(q, { max = 12 } = {}) {
  const parts = String(q ?? '').split('"');
  let best = null; // { part, m, index }
  parts.forEach((part, i) => {
    if (i % 2) return;
    for (const m of part.matchAll(CJK_RUN)) if (m[0].length >= 3 && (!best || m[0].length > best.m.length)) best = { part: i, m: m[0], index: m.index };
  });
  if (!best) return [];
  const { m } = best;
  const n = m.length;
  const out = [];
  for (let L = n - 1; L >= Math.max(2, Math.ceil(n / 2)) && out.length < max; L--) {
    for (let off = n - L; off >= 0 && out.length < max; off--) {
      const term = m.slice(off, off + L);
      const p = [...parts];
      p[best.part] = p[best.part].slice(0, best.index) + term + p[best.part].slice(best.index + n);
      out.push({ q: p.join('"'), term, from: m });
    }
  }
  return out;
}

/**
 * 搜尋＋排序：`pf` 是 Pagefind 模組。回傳 { results, filters }，results 是 Pagefind 的結果物件陣列。
 * 沒有片語（純英文／單字）時就是一次普通查詢；有片語時：每個片語各查一次取交集，順序用 bagQuery（或依日期排序時用查詢本身的順序）。
 */
export async function rankedSearch(pf, q, opts, loose = false) {
  if (!q) return pf.search(null, opts);
  const pq = parseQuery(q, loose);
  if (!pq.phrases.length) return pf.search(pq.plain.join(' '), opts);
  const runs = [];
  for (const ph of pq.phrases) runs.push(await pf.search(phraseQuery(pq, ph), opts));
  let keep = new Set(runs[0].results.map((r) => r.id));
  for (const r of runs.slice(1)) { const ids = new Set(r.results.map((x) => x.id)); keep = new Set([...keep].filter((id) => ids.has(id))); }
  const filters = runs.length === 1 ? runs[0].filters : null; // 多片語時各選項的筆數無法由單次查詢得出，不顯示
  if (keep.size < 2) return { results: runs[0].results.filter((r) => keep.has(r.id)), filters };
  const base = opts.sort ? runs[0] : await pf.search(bagQuery(pq), opts);
  const ordered = base.results.filter((r) => keep.has(r.id));
  return { results: ordered.length === keep.size ? ordered : runs[0].results.filter((r) => keep.has(r.id)), filters };
}

/** 摘錄還原：索引內容是「登 革 熱」，顯示時把 CJK 字之間的空白拿掉，相鄰的 <mark> 併成一個 */
export function despaceExcerpt(excerpt) {
  return String(excerpt ?? '')
    .replace(/\s+<\/mark>/g, '</mark> ') // Pagefind 把空白算進 <mark> 內（「<mark>登 </mark>」），先把空白挪到標籤外
    .replace(CJK_MARK_JOIN, '$1') // 相鄰兩個標記中間只隔空白就併成一個
    .replace(CJK_GAP, '$1$2$3');
}
