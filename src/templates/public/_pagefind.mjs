// Pagefind 全文索引的「要收什麼、貼什麼標籤」（第二十八輪，ARCHITECTURE 31）。
//
// 為什麼用「正面表列」：Pagefind 的規則是「站內只要有一頁出現 data-pagefind-body，沒有這個屬性的頁就整頁不收」。
// 所以不是去列「不要收誰」（後台、預覽、404、舊站轉址頁、機讀版……每多一種就要記得排除一次），
// 而是只有明確標記的頁才收：layout 只在 pagefindFor() 回傳非 null 時才在 <main> 加 data-pagefind-body。
// 新增一種版面或工具頁預設不會進索引，漏標的後果是「搜不到」（可補），不是「把不該公開的東西索引出去」（難收回）。
//
// 篩選值（filter）一律用穩定代碼（disease、news、unit.acute-infectious、public、2026），不是各語言的顯示字：
// 網址 ?type=disease 在七種語言通用、可分享；顯示字由 /search/ 頁依該語言的 i18n 對照（data-types／data-units）。
import { html } from '../../../scripts/lib/render.mjs';

/** 內容型別 → 搜尋頁「內容類型」代碼。不在表內的型別不進索引（banner 沒有獨立頁、dataset 沒有詳情頁）。 */
export const PF_TYPES = [
  'disease', 'vaccine', 'news', 'letter', 'clarification', 'document', 'faq', 'service', 'publication', 'labtest',
  'research', 'media', 'topic', 'page', 'job', 'tender',
];
/** 不是內容項目、但要收進索引的頁（meta.pagefind = { type }）：旅遊目的地、詞彙頁 */
export const PF_EXTRA_TYPES = ['travel', 'glossary'];
export const PF_ALL_TYPES = [...PF_TYPES, ...PF_EXTRA_TYPES];

const AUDIENCES = new Set(['public', 'professional']);
const isDate = (s) => /^\d{4}-\d{2}-\d{2}/.test(String(s ?? ''));

/**
 * 這一頁在 Pagefind 的資料；null ＝ 不進索引。
 * @param {{ item?: any, noindex?: boolean, pagefind?: false | { type: string, date?: string, owner?: string, audience?: string[] } }} meta layout() 收到的 meta
 */
export function pagefindFor(meta) {
  const { item, noindex, pagefind } = meta ?? {};
  if (noindex || pagefind === false) return null; // 失效版文件、模擬報名頁、404、/ask/、/search/ 都是 noindex
  let type = pagefind?.type;
  if (!type && item?.type && PF_TYPES.includes(item.type)) type = item.type;
  if (!type || !PF_ALL_TYPES.includes(type)) return null;
  const src = { ...(item ?? {}), ...(pagefind ?? {}) };
  const audience = (Array.isArray(src.audience) ? src.audience : []).filter((a) => AUDIENCES.has(a));
  const date = isDate(src.publishedAt ?? src.date) ? String(src.publishedAt ?? src.date).slice(0, 10) : null;
  return { type, audience, owner: src.owner ?? null, date, year: date ? date.slice(0, 4) : null };
}

/**
 * <main> 的 data-pagefind-body 屬性字串（可直接接在 <main …> 後面）與主體尾端的隱藏標籤。
 * 篩選／排序／中繼資料用「空的 hidden 元素 ＋ key:value」寫法：不讓代碼混進正文被搜到，也不影響畫面與朗讀。
 * meta.unit／meta.kind 是該頁語言的顯示字，結果列直接用；filter 是代碼。
 */
export function pagefindMarks(ctx, pf, { unitName, title } = {}) {
  if (!pf) return { bodyAttr: '', tail: '', weigh: (b) => b };
  const { t } = ctx;
  const one = (kind, val) => html`<span hidden data-pagefind-${kind}="${val}"></span>`;
  const parts = [one('filter', `type:${pf.type}`)];
  for (const a of pf.audience) parts.push(one('filter', `audience:${a}`));
  if (pf.owner) parts.push(one('filter', `unit:${pf.owner}`));
  if (pf.year) parts.push(one('filter', `year:${pf.year}`));
  if (pf.date) { parts.push(one('sort', `date:${pf.date}`)); parts.push(one('meta', `date:${pf.date}`)); }
  // 標題明確指定：索引用的副本會在中文字之間補空白（見 scripts/lib/pagefind.mjs），不明指的話結果標題會變成「登 革 熱」
  if (title) parts.push(one('meta', `title:${title}`));
  parts.push(one('meta', `kind:${t(`search.type.${pf.type}`)}`));
  if (pf.owner && unitName) parts.push(one('meta', `unit:${unitName(pf.owner)}`));
  // 標題加權：模板各自寫 <h1>，不逐一去改；在 layout 統一對主體的第一個 <h1> 補 data-pagefind-weight。
  // 理由：Pagefind 預設所有字等權，「登革熱」在 231 個旅遊目的地頁也各出現幾次，不加權時疾病頁會被淹沒。
  const weigh = (body) => String(body).replace(/<h1(?=[\s>])/, '<h1 data-pagefind-weight="10"');
  return { bodyAttr: ' data-pagefind-body', tail: html`${parts}`, weigh };
}
