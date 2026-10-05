// 第十一批（統計專區欄目）的轉換工具：
//   statScope        類別／麵包屑含規則檔 statScopes 字樣（統計專區、統計資料、Data & Statistics）⇒ 這頁是統計頁
//   periodicalIssues 附件 label／檔名是「期別」（YYYY 年第 N 週、第 N 週、YYYY 年 M 月、YYYY 年（報）、第 N 期）且 ≥ 3 個 ⇒ 期刊（週報、速訊、年報）
//                    期別不是版次：第 40 週不取代第 39 週，每期都是紀錄 ⇒ 建成一筆 dataset、逐期列 resources，不走第七批的文件版次鏈
//   tableSeries      內文第一個表格是時序（第一欄年／年月／年週、有全數字欄）⇒ dataset.series（統計問答用）
//   seriesGaps       時序缺期與重複（數值忽高忽低不是問題，不報）
//   statsStale       最新一點落後匯出日太多期 ⇒ 資料可能已停更，或開放平臺上有新版
//   systemEntryHosts 統計頁的外部系統入口（疾管署子網域系統也算外部，第十批 externalSystemPage 的統計版）
//   datasetByUrl     內文站外連結的 host 對上既有 dataset 的 canonicalUrl／portalUrl host ⇒ 這頁是該資料集的入口
import { mdTableRows, mdLinks, hostOf } from './types.mjs';
import { plainText } from './html.mjs';

const crumbsText = (category, breadcrumbs) => [category ?? '', ...(breadcrumbs ?? [])].join('／');
const pad = (n) => String(n).padStart(2, '0');
const strip = (s) => String(s ?? '').replace(/\*\*/g, '').trim();
/** 西元 4 位（19xx／20xx）或民國 2–3 位 → 西元年；其他 → null */
const westYear = (y) => {
  const n = Number(y);
  if (!Number.isFinite(n)) return null;
  if (/^\d{4}$/.test(String(y))) return n >= 1900 && n <= 2100 ? n : null;
  if (/^\d{2,3}$/.test(String(y))) return n >= 1 && n <= 189 ? n + 1911 : null;
  return null;
};

/** 類別或麵包屑含規則檔 statScopes 任一字樣 ⇒ 統計頁 */
export function statScope(rules, { category = '', breadcrumbs = [] } = {}) {
  const t = crumbsText(category, breadcrumbs);
  return (rules?.statScopes ?? []).some((s) => s && t.includes(s));
}

/** ISO 週的週一（YYYY-MM-DD）：第 1 週＝含 1 月 4 日的那一週 */
export function isoWeekMonday(year, week) {
  const jan4 = Date.UTC(year, 0, 4);
  const dow = (new Date(jan4).getUTCDay() + 6) % 7; // 週一＝0
  const d = new Date(jan4 - dow * 86400000 + (week - 1) * 7 * 86400000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
// 期別寫法（先比長的：「2026 年第 33 週」含「2026 年」，所以週、月、期在年之前）
const PERIOD_RES = [
  ['week', /(?:民國\s*)?(\d{2,4})\s*年\s*第\s*(\d{1,2})\s*週/],
  ['week', /(\d{4})\s*[-_ ]?\s*W(\d{1,2})(?!\d)/i],
  ['week', /第\s*(\d{1,2})\s*週/, true],
  ['month', /(?:民國\s*)?(\d{2,4})\s*年\s*(\d{1,2})\s*月/],
  ['issue', /(?:(?:民國\s*)?(\d{2,4})\s*年\s*)?第\s*(\d{1,4})\s*期/],
  ['year', /(?:民國\s*)?(\d{2,4})\s*年(?:年?報|度)?(?![\d第])/],
];

/** 一個附件文字 → { granularity, year, no } | null */
function periodOf(text, defaultYear) {
  const t = String(text ?? '');
  for (const [g, re, noYear] of PERIOD_RES) {
    const m = re.exec(t);
    if (!m) continue;
    if (g === 'week' && noYear) return { granularity: 'week', year: defaultYear ?? null, no: Number(m[1]) };
    if (g === 'issue') return { granularity: 'issue', year: m[1] ? westYear(m[1]) : null, no: Number(m[2]) };
    const year = westYear(m[1]);
    if (year == null) continue;
    if (g === 'year') return { granularity: 'year', year, no: null };
    const no = Number(m[2]);
    if (g === 'week' && (no < 1 || no > 53)) continue;
    if (g === 'month' && (no < 1 || no > 12)) continue;
    return { granularity: g, year, no };
  }
  return null;
}

const periodDate = ({ granularity, year, no }) => {
  if (year == null) return null;
  if (granularity === 'week') return isoWeekMonday(year, no);
  if (granularity === 'month') return `${year}-${pad(no)}-01`;
  if (granularity === 'year') return `${year}-01-01`;
  return null;
};
/** 期別的顯示文字：2026 年第 40 週／2026 年 9 月／2025 年／第 12 期 */
export const periodLabel = ({ granularity, year, no }) => (granularity === 'week' ? `${year != null ? `${year} 年` : ''}第 ${no} 週`
  : granularity === 'month' ? `${year} 年 ${no} 月` : granularity === 'year' ? `${year} 年` : `${year != null ? `${year} 年` : ''}第 ${no} 期`);

/**
 * 附件是不是「一頁列很多期」的期刊：label 先、檔名其次比期別寫法；同一種期別 ≥ min（3）個 ⇒ 期刊。
 * 無年份的「第 N 週」用 opts.defaultYear（頁面更新日的年）；民國年轉西元。
 * granularity 'issue'（只有「第 N 期」、看不出日期）是規格以外的補充：date 為 null。
 * @returns {{ granularity: 'week'|'month'|'year'|'issue', issues: Array<{ label, file, year, no, date }>, latest } | null}（issues 依期別降冪）
 */
export function periodicalIssues(attachments = [], { defaultYear = null, min = 3 } = {}) {
  const found = [];
  for (const a of attachments ?? []) {
    const p = periodOf(a.label, defaultYear) ?? periodOf(a.file, defaultYear);
    if (p) found.push({ a, p });
  }
  const count = new Map();
  for (const { p } of found) count.set(p.granularity, (count.get(p.granularity) ?? 0) + 1);
  const [granularity, n] = [...count.entries()].sort((x, y) => y[1] - x[1])[0] ?? [];
  if (!granularity || n < min) return null;
  const issues = found.filter(({ p }) => p.granularity === granularity)
    .map(({ a, p }) => ({ label: String(a.label ?? '').trim() || a.file, file: a.file, year: p.year, no: p.no, date: periodDate(p) }))
    .sort((x, y) => ((y.year ?? 0) - (x.year ?? 0)) || ((y.no ?? 0) - (x.no ?? 0)));
  return { granularity, issues, latest: issues[0] };
}

/** 時間欄的一格 → { granularity, t } | null（西元／民國年、年月、年週） */
function timeOf(cell) {
  const c = strip(cell).replace(/\s+/g, ' ');
  let m = /^(?:民國\s*)?(\d{2,4})\s*年?$/.exec(c);
  if (m) { const y = westYear(m[1]); return y ? { granularity: 'year', t: String(y) } : null; }
  m = /^(?:民國\s*)?(\d{2,4})\s*(?:年\s*|[-/.])(\d{1,2})\s*月?$/.exec(c);
  if (m) { const y = westYear(m[1]); const mo = Number(m[2]); return y && mo >= 1 && mo <= 12 ? { granularity: 'month', t: `${y}-${pad(mo)}` } : null; }
  m = /^(?:民國\s*)?(\d{2,4})\s*(?:年\s*第?\s*|-?W)(\d{1,2})\s*週?$/i.exec(c);
  if (m) { const y = westYear(m[1]); const w = Number(m[2]); return y && w >= 1 && w <= 53 ? { granularity: 'week', t: `${y}-W${pad(w)}` } : null; }
  return null;
}
const NUM_RE = /^-?\d{1,3}(?:,\d{3})+(?:\.\d+)?\s*%?$|^-?\d+(?:\.\d+)?\s*%?$/;
const numOf = (cell) => Number(strip(cell).replace(/[,\s%]/g, ''));
const isTotal = (cell) => /合計|總計|小計|總和|^total$/i.test(strip(cell));

/** 欄名 → 單位：括號裡寫明的優先；%／率 ⇒ %；人（含「病例數」「人數」）⇒ 人；例 ⇒ 例；其他 ⇒ 件 */
export function unitOf(label) {
  const l = strip(label);
  const paren = /[（(]\s*([^）)]+?)\s*[）)]\s*$/.exec(l)?.[1];
  if (paren && /^(%|人|例|件|人次|劑|家|所)$/.test(paren)) return paren;
  if (/%|率/.test(l)) return '%';
  if (/人|病例數|個案數/.test(l)) return '人';
  if (/例/.test(l)) return '例';
  return '件';
}

/** Markdown 第一個表格的列（連續的 | 開頭行） */
function firstTable(md) {
  const lines = [];
  let started = false;
  for (const line of String(md ?? '').split('\n')) {
    if (line.trim().startsWith('|')) { started = true; lines.push(line); } else if (started) break;
  }
  return mdTableRows(lines.join('\n'));
}

/**
 * 內文第一個表格 → 時序：第一欄是時間（全部資料列都看得出年／年月／年週，合計列略過），值欄取第一個全是數字的欄。
 * 多個數值欄只取第一個，其他欄名寫在 note；< 3 點 ⇒ null。points 依時間升冪。
 * @returns {{ label, unit, granularity: 'year'|'month'|'week', points: Array<{ t, v }>, note: string } | null}
 */
export function tableSeries(markdown) {
  const rows = firstTable(markdown);
  if (rows.length < 4) return null;
  const head = rows[0].map(strip);
  const data = rows.slice(1).filter((r) => !isTotal(r[0] ?? ''));
  const times = data.map((r) => timeOf(r[0] ?? ''));
  if (times.some((x) => !x)) return null;
  const granularity = times[0].granularity;
  if (times.some((x) => x.granularity !== granularity)) return null;
  const numCols = [];
  for (let i = 1; i < head.length; i++) if (data.every((r) => NUM_RE.test(strip(r[i] ?? '')))) numCols.push(i);
  if (!numCols.length) return null;
  const vi = numCols[0];
  const points = data.map((r, k) => ({ t: times[k].t, v: numOf(r[vi]) })).sort((a, b) => a.t.localeCompare(b.t));
  if (points.length < 3) return null;
  const others = numCols.slice(1).map((i) => head[i]).filter(Boolean);
  return { label: head[vi] || '數值', unit: unitOf(head[vi]), granularity, points, note: others.length ? `另有欄位：${others.join('、')}` : '' };
}

const WEEK = 7 * 86400000;
const MON0 = Date.UTC(1969, 11, 29); // 1970 年第 1 週的週一：週序以它為 0，整數好比對
/** 時間鍵 → 期序（年＝年；月＝年×12＋月；週＝自 MON0 起的第幾週） */
const ordOf = (granularity, t) => {
  if (granularity === 'year') return Number(t);
  if (granularity === 'month') { const [y, m] = t.split('-').map(Number); return y * 12 + (m - 1); }
  if (granularity === 'week') { const [, y, w] = /^(\d{4})-W(\d{2})$/.exec(t) ?? []; return y ? Math.round((Date.parse(`${isoWeekMonday(Number(y), Number(w))}T00:00:00Z`) - MON0) / WEEK) : NaN; }
  return NaN;
};
const tOfOrd = (granularity, o) => {
  if (granularity === 'year') return String(o);
  if (granularity === 'month') return `${Math.floor(o / 12)}-${pad((o % 12) + 1)}`;
  const d = new Date(MON0 + o * WEEK);
  // 週一 → ISO 年週：週四所在的年就是 ISO 年
  const th = new Date(d.getTime() + 3 * 86400000);
  const y = th.getUTCFullYear();
  const w = Math.round((d.getTime() - Date.parse(`${isoWeekMonday(y, 1)}T00:00:00Z`)) / (7 * 86400000)) + 1;
  return `${y}-W${pad(w)}`;
};
const tText = (granularity, t) => (granularity === 'year' ? `${t} 年` : t);

/** 時序的缺期與重複（依時間排序後比對相鄰期）；值的升降不報 */
export function seriesGaps(series) {
  const g = series?.granularity;
  const pts = series?.points ?? [];
  if (!pts.length || !['year', 'month', 'week'].includes(g)) return [];
  const out = [];
  const count = new Map();
  for (const p of pts) count.set(p.t, (count.get(p.t) ?? 0) + 1);
  const ords = [...count.keys()].map((t) => ordOf(g, t)).filter(Number.isFinite).sort((a, b) => a - b);
  for (let i = 1; i < ords.length; i++) for (let o = ords[i - 1] + 1; o < ords[i]; o++) out.push(`缺 ${tText(g, tOfOrd(g, o))}`);
  for (const [t, n] of count) if (n > 1) out.push(`${tText(g, t)} 重複 ${n} 筆`);
  return out;
}

/**
 * 最新一點落後 now 太多期 ⇒ 過時：年 ⇒ 最新年 < now 年 − 1；月／週 ⇒ 落後超過 3 期。
 * @returns {{ latest: string, expected: string } | null}（expected＝至少該有的最新期）
 */
export function statsStale(series, now) {
  const g = series?.granularity;
  const pts = series?.points ?? [];
  if (!pts.length || !now) return null;
  const latest = [...pts].map((p) => p.t).sort().at(-1);
  const d = new Date(String(now).length === 10 ? `${now}T00:00:00Z` : now);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  let nowOrd, lag;
  if (g === 'year') { nowOrd = y; lag = 1; } else if (g === 'month') { nowOrd = y * 12 + d.getUTCMonth(); lag = 3; } else if (g === 'week') {
    const mon = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86400000);
    nowOrd = Math.round((Date.UTC(mon.getUTCFullYear(), mon.getUTCMonth(), mon.getUTCDate()) - MON0) / WEEK); lag = 3;
  } else return null;
  const expectedOrd = nowOrd - lag;
  return ordOf(g, latest) < expectedOrd ? { latest, expected: tOfOrd(g, expectedOrd) } : null;
}

const bareHost = (href) => hostOf(href).replace(/^www\./, '');
const normU = (u) => String(u ?? '').replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/+$/, '').toLowerCase();

/**
 * 內文站外連結 → 既有資料集：連結 host（去 www）對上 dataset 的 canonicalUrl／portalUrl host。
 * 候選依連結順序、再依內容索引順序；canonicalUrl（或 portalUrl）與某個連結完全相等者優先，否則第一筆。
 * 另回 candidates（同 host 的候選數）與 ambiguous（取到的那筆是「同 host 多筆、又沒有完全相等」）：資料開放平臺首頁之類的入口頁
 * 會對到平臺上每一個資料集，主流程遇到 ambiguous 不據此改型別。
 * @param {Array<string|{href:string}>} links
 * @returns {{ id: string, host: string, exact: boolean, candidates: number, ambiguous: boolean } | null}
 */
export function datasetByUrl(links, contentIndex) {
  const byId = contentIndex?.byId ?? contentIndex;
  if (!byId?.entries) return null;
  const hrefs = (links ?? []).map((l) => (typeof l === 'string' ? l : l?.href)).filter((h) => /^https?:\/\//i.test(String(h ?? '')));
  const ds = [...byId.entries()].filter(([, x]) => x.type === 'dataset' && (x.canonicalUrl || x.portalUrl));
  const cands = [];
  for (const h of hrefs) {
    const host = bareHost(h);
    if (!host) continue;
    for (const [id, x] of ds) {
      if (![x.canonicalUrl, x.portalUrl].filter(Boolean).some((u) => bareHost(u) === host)) continue;
      if (cands.some((c) => c.id === id)) continue;
      cands.push({ id, host, exact: [x.canonicalUrl, x.portalUrl].filter(Boolean).some((u) => normU(u) === normU(h)) });
    }
  }
  if (!cands.length) return null;
  const pick = cands.find((c) => c.exact) ?? cands[0];
  const sameHost = cands.filter((c) => c.host === pick.host).length;
  return { id: pick.id, host: pick.host, exact: pick.exact, candidates: sameHost, ambiguous: !pick.exact && sameHost > 1 };
}

const SITE_HOST = /^(www\.)?cdc\.gov\.tw$/;
/**
 * 統計頁版的外部系統入口判斷：同第十批 externalSystemPage（字少、無舊站連結、有站外連結），
 * 但疾管署自己的子網域系統（nidss.cdc.gov.tw、data.cdc.gov.tw、antiflu.cdc.gov.tw…）算「外部系統」——第十批的 isCdcHost 把整個 cdc.gov.tw 都當站內，
 * 統計專區的入口頁幾乎都連到這些子網域，用第十批的判斷永遠不會命中。只有 www.cdc.gov.tw（舊站本身）與站內相對連結算站內。
 * @returns {string[]} 外部系統網域（依出現順序、去重）
 */
export function systemEntryHosts({ markdown = '', stat = {}, maxChars = 200 } = {}) {
  if (plainText(markdown).replace(/\s/g, '').length >= maxChars) return [];
  if ((stat.legacyLinks ?? 0) > 0) return [];
  const links = mdLinks(markdown);
  if (links.some((l) => l.href.startsWith('/') || SITE_HOST.test(hostOf(l.href)))) return [];
  const ext = links.filter((l) => /^https?:\/\//.test(l.href)).map((l) => hostOf(l.href)).filter((h) => h && !SITE_HOST.test(h));
  return [...new Set(ext)];
}
