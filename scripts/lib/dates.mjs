// 日期輸出的單一出口（第二十五輪，Issue #37）。
//
// 內容檔的 publishedAt／reviewedAt 多半只有日期（YYYY-MM-DD），但 JSON-LD 的 datePublished／dateModified 與 RSS 的 pubDate
// 被外部系統（監測、聚合、搜尋引擎）當成「時間點」讀：沒有時區的日期會被各家解成不同的當日，甚至因為時差變成前一天。
// 所以輸出時一律補成台灣時間 `YYYY-MM-DDT00:00:00+08:00`；內容檔若已經是帶時區的 date-time 就原樣保留（不改寫 328 個內容檔）。
// 所有 datePublished／dateModified／pubDate 都經過這裡，不要在別處自己拼字串。

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME_TZ = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

/** 'YYYY-MM-DD' → 'YYYY-MM-DDT00:00:00+08:00'；已帶時區的 date-time 原樣；空值回 undefined；其他格式取前 10 碼當日期處理 */
export function toIsoDateTimeTW(value) {
  if (value == null || value === '') return undefined;
  const s = String(value).trim();
  if (DATE_ONLY.test(s)) return `${s}T00:00:00+08:00`;
  if (DATE_TIME_TZ.test(s)) return s;
  const head = s.slice(0, 10);
  return DATE_ONLY.test(head) ? `${head}T00:00:00+08:00` : undefined;
}

/** RSS 2.0 的 pubDate／lastBuildDate（RFC 822，UTC 表示）；日期只有日的當作台灣當日 00:00 */
export function toRfc822(value) {
  const iso = toIsoDateTimeTW(value);
  return iso ? new Date(iso).toUTCString() : new Date(NaN).toUTCString();
}

// ───────────────────────── 相對日期（第二十五輪，Issue #37） ─────────────────────────
// 新聞稿標題與首段寫「今（21）日」「今年」「上週」，離開當天就沒有意義。外部系統（監測、聚合、答案單元的引用）
// 讀到時不知道是哪一天，曾把 2023 年的衛福部登革熱新聞稿當成「今天」的新聞。規則：相對日期必須與絕對日期寫在同一句。
export const RELATIVE_DATE_RE = /今[（(]\d+[）)]日|今日|今天|昨[（(]\d+[）)]日|昨日|昨天|今年|去年|上週|上周|本週|本周|明[（(]\d+[）)]日|明日/;
/** 絕對日期：西元 YYYY 年 M 月 D 日、YYYY-MM-DD、YYYY 年第 N 週、或單獨的「YYYY 年」（給「今年」「去年」用；「114 年度」這類民國年度不算） */
export const ABSOLUTE_DATE_RE = /\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日|\d{4}-\d{2}-\d{2}|\d{4}\s*年\s*第\s*\d+\s*週|\d{4}\s*年(?!度)/;
export const hasRelativeDate = (s) => RELATIVE_DATE_RE.test(String(s ?? '')) && !ABSOLUTE_DATE_RE.test(String(s ?? ''));

/**
 * 答案單元用：句子仍含相對日期（且同句沒有絕對日期）⇒ 前面加「〔YYYY-MM-DD 發布〕」，讓單獨被引用的句子也知道是哪一天的「今日」。
 * 沒有 publishedAt 或句子本來就沒有相對日期則原樣回傳。
 */
export function tagRelativeDate(sentence, publishedAt) {
  const d = String(publishedAt ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return sentence;
  if (!hasRelativeDate(sentence) || String(sentence).startsWith('〔')) return sentence;
  return `〔${d} 發布〕${sentence}`;
}
