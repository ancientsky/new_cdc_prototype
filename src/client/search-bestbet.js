// /search/ 的「精選結果」（第五十一輪，docs/ask-search-llm.md 第 16 節）：查詢點名一個疾病或疫苗（正名或別名）時，
// 把該主題的一級頁面放在 Pagefind 結果清單之上。純函式，Node（建置端產生資料、單元測試）與瀏覽器共用。
//
// 為什麼不再調 Pagefind 的權重：Pagefind 的分數對詞頻會飽和——英文搜「dengue」時十來頁短 FAQ／新聞都在 18.4–18.7 分，
// 2,700 字的疾病頁不論標題加權、pageLength 怎麼調都只差 1–2%，一個查詢調好了另一個又掉下去。
// 「這個詞就是某個疾病的名字」是確定的事實（疾病主檔、詞彙主檔、內容頁別名），不該交給相關度去猜。
//
// 比對規則（與答案引擎第三十一輪的詞典邊界同一個想法，ARCHITECTURE §37）：
//   1. 查詢與名稱都先 bbNorm()：全形轉半形、小寫、拉丁字母去聲調（越南文、印尼文使用者常不打聲調）、標點變空白、中泰文字旁的空白拿掉。
//   2. 名稱要「完整」出現在查詢裡：拉丁字母的名稱兩側不得緊鄰字母或數字（flu ≠ fluid）；中日泰文沒有空白，用子字串。
//   3. 名稱若只出現在另一個「指不同東西」的已知名稱裡面，不算（masks）：禽流感 裡的「流感」、avian influenza 裡的 influenza。
//      反方向本來就不會發生：只有名稱「被查詢包含」才算，所以「性病」不會命中「急性病毒性A型肝炎」。
//   4. 長的名稱先比、範圍不重疊（德國麻疹 → 德國麻疹，不會再另外算一個麻疹）。
//   5. 兩個字以下的拉丁縮寫（TB、JE）只在整個查詢就是它時才算，避免夾在句子裡誤中。

/** 不用空白分詞的文字：泰文、假名、CJK。這些字旁邊的空白在比對時拿掉（「MMR 疫苗」＝「MMR疫苗」） */
const TIGHT = '\\u0e00-\\u0e7f\\u3040-\\u30ff\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff';
const TIGHT_GAP = new RegExp(`\\s+(?=[${TIGHT}])|(?<=[${TIGHT}])\\s+`, 'g');
const PUNCT = /[\s\-‐‑–—_/\\.,;:!?'"’‘“”()[\]{}（）［］「」『』【】、，。；：！？・·]+/g;
const LATIN = /[\p{Script=Latin}\p{N}]/u;

/** 比對用的正規化（名稱與查詢都經過它；建置端用同一支函式產生鍵值） */
export function bbNorm(s) {
  return String(s ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .normalize('NFC')
    .replace(PUNCT, ' ')
    .replace(TIGHT_GAP, '')
    .trim();
}

const isLatinAt = (s, i) => i >= 0 && i < s.length && LATIN.test(s[i]);
/** 拉丁字母開頭／結尾的名稱：前一個／後一個字不得是字母或數字 */
const edgesOk = (s, i, j) => !(isLatinAt(s, i) && isLatinAt(s, i - 1)) && !(isLatinAt(s, j - 1) && isLatinAt(s, j));

function* occurrences(s, k) {
  for (let i = s.indexOf(k); i >= 0; i = s.indexOf(k, i + 1)) if (edgesOk(s, i, i + k.length)) yield i;
}

/**
 * 查詢 → 精選結果（bets 陣列裡的物件，依在查詢中出現的順序，最多 max 個）。
 * data：建置時產生（src/templates/public/_bestbet.mjs），{ bets: [...], keys: [[名稱, [bet 索引…]], …（長的在前）], masks: { 名稱: [遮蔽它的更長名稱…] } }。
 */
export function matchBestBets(q, data, { max = 3 } = {}) {
  const nq = bbNorm(q);
  if (!nq || !data?.keys?.length) return [];
  const taken = [];
  const hits = [];
  for (const [k, idx] of data.keys) {
    if (k.length <= 2 && LATIN.test(k[0]) && nq !== k) continue;
    for (const i of occurrences(nq, k)) {
      const j = i + k.length;
      if (taken.some(([s, e]) => i < e && j > s)) continue;
      const masked = (data.masks?.[k] ?? []).some((m) => {
        for (const s of occurrences(nq, m)) if (s <= i && s + m.length >= j) return true;
        return false;
      });
      if (masked) continue;
      taken.push([i, j]);
      hits.push({ i, idx });
      break;
    }
  }
  hits.sort((a, b) => a.i - b.i);
  const out = [];
  for (const h of hits) for (const n of h.idx) if (!out.includes(n) && data.bets[n]) out.push(n);
  return out.slice(0, max).map((n) => data.bets[n]);
}
