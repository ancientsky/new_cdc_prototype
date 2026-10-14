// @ts-check
// 內容的「版本碼」（第五十二輪，docs/deploy.md §23）：同事開啟一筆內容時記下它的版本碼，存檔時一起送給寫入閘道；
// 閘道拿現在的版本算一次，不同就表示「你開啟之後，別人已經改過」，這一版先不存（409 stale），請同事載入最新版再改。
//
// 為什麼不直接比檔案文字：同一份內容從 API 拿到的（多了網址、計算欄位、鍵的順序可能不同）與檔案上的不會逐字相同。
// 這裡的做法是：先拿掉 API 才有的欄位（preprocess.js 的 liveItem，與修改頁「以現行版為底」同一份規則），
// 再拿掉每次存檔本來就會改的欄位（狀態、最後審閱日），物件鍵排序後算雜湊。所以：
//   - 鍵的順序不同、API 與檔案的形狀不同 ⇒ 同一個版本碼（不會誤判）；
//   - 只差狀態或最後審閱日 ⇒ 同一個版本碼（存檔本來就會改這兩欄；例如別人送出重新審閱、核准後只動了審閱日，不算衝突）；
//   - 其他任何欄位不同（含表單沒有的欄位，如譯文、白名單）⇒ 不同的版本碼。
// 雜湊用純 JavaScript（兩個種子的 cyrb53，共 106 位元）：不是安全用途，只要「不同內容幾乎不可能同碼」；
// 不用 crypto.subtle，是因為機關內網的後台不一定是 https（subtle 只在安全來源可用），閘道與瀏覽器要算出同一個值。
import { liveItem, canon } from './preprocess.js';

/** 還沒有這筆內容（新內容）的版本碼 */
export const NEW_VERSION = 'new';
/** 每次存檔本來就會改的欄位：不算進版本碼（preprocess.js 的 EDIT_DERIVED） */
const IGNORE = new Set(['status', 'reviewedAt']);

/**
 * cyrb53（公有領域的 53 位元字串雜湊）
 * @param {string} str
 * @param {number} seed
 */
function cyrb53(str, seed) {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

/**
 * 一筆內容（API 的一筆、檔案的 JSON、表單的匯出都可以）→ 版本碼。null／undefined ⇒ NEW_VERSION。
 * @param {any} item
 * @returns {string}
 */
export function contentVersion(item) {
  if (item == null) return NEW_VERSION;
  const live = liveItem(item);
  const o = {};
  for (const [k, v] of Object.entries(live ?? {})) if (!IGNORE.has(k)) o[k] = v;
  const text = canon(o);
  return `v1-${cyrb53(text, 0)}${cyrb53(text, 0x9e3779b9)}`;
}

/**
 * 檔案文字 → 版本碼（閘道用）。沒有這個檔 ⇒ NEW_VERSION；不是合法 JSON ⇒ 以文字本身算（一定與任何正常版本不同）。
 * @param {string|null|undefined} raw
 */
export function versionOfText(raw) {
  if (raw == null) return NEW_VERSION;
  try {
    return contentVersion(JSON.parse(String(raw)));
  } catch {
    return `v1-raw-${cyrb53(String(raw), 7)}`;
  }
}
