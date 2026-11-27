// 第七十五輪：新版「網站無障礙規範」（115.11.30 施行）附件一檢測碼的建置期處理（docs/a11y.md 第 12 節）。
// 兩件事，都是 axe／Lighthouse 不檢查、但 Freego 檢測碼會判的：
//   1. HM1110103C（A）：字符圖案、表情符號要有 title。wrapEmoji() 把文字裡的表情符號包成 <span role="img" aria-label title>。
//   2. HM1240401C（A）：「連結前後尚有其他內容」的行內連結另需 title。inlineLinkTitles() 對沒有 title 的行內連結補「描述性」title：
//      「連結文字：上下文」，上下文是連結之前最近的標題（h1–h6），沒有就用頁面標題；外部網站加「（外部網站：host）」，
//      PDF／CSV／JSON 等下載檔加「下載 格式」。title 一定包含可見的連結文字（WCAG 2.5.3 名稱含標籤），且不會只等於連結文字。
//      業主決定採 A 案（全站行內連結自動補描述性 title），取捨寫在 docs/architecture-decisions.md 第 60 節。
// 本檔只在建置期（Node）使用，不進瀏覽器。檢查端是 scripts/a11y-tw.mjs（同一套定義：PICTO_RE、isInlineLink 的判斷）。
import { Parser } from 'htmlparser2';
import { esc } from './render.mjs';

/** 字符圖案／表情符號（與 scripts/a11y-tw.mjs 共用）：雜項符號與裝飾符號（U+2600–27BF）、表情符號（U+1F000–1FAFF）；含後接的變體選擇符、膚色與 ZWJ 組合 */
export const PICTO_CHAR = '[\\u{1F000}-\\u{1FAFF}\\u{2600}-\\u{27BF}]';
const PICTO_SEQ = `${PICTO_CHAR}(?:[\\u{FE0E}\\u{FE0F}\\u{1F3FB}-\\u{1F3FF}]|\\u{200D}${PICTO_CHAR})*`;
export const PICTO_RE = new RegExp(PICTO_CHAR, 'u');
const PICTO_RUN = new RegExp(`${PICTO_SEQ}(?:\\s*${PICTO_SEQ})*`, 'gu');

/**
 * 把「已跳脫的 HTML 文字片段」裡的表情符號包成 <span role="img" aria-label title>。
 * 只處理標籤之外的文字（不動屬性值）；已在 role="img"／aria-hidden 的 span 內的不重包。
 * @param {string} htmlStr
 * @param {string} label 替代文字（i18n 'a11y.emoji'，例如「圖示」）
 */
export function wrapEmoji(htmlStr, label) {
  const s = String(htmlStr ?? '');
  if (!PICTO_RE.test(s)) return s;
  const lab = esc(label);
  let depth = 0; // 在已標示的 span（role="img" 或 aria-hidden）裡面
  return s
    .split(/(<[^>]*>)/)
    .map((seg) => {
      if (seg.startsWith('<')) {
        if (/^<span\b[^>]*(?:role="img"|aria-hidden="true")/.test(seg)) depth++;
        else if (depth && /^<span\b/.test(seg)) depth++;
        else if (depth && /^<\/span>/.test(seg)) depth--;
        return seg;
      }
      return depth ? seg : seg.replace(PICTO_RUN, (m) => `<span role="img" aria-label="${lab}" title="${lab}">${m}</span>`);
    })
    .join('');
}

// ── 行內連結 ──
/** 算「行內內容」的元素：連結旁邊有這些元素且裡面有字，就算「連結前後尚有其他內容」。
 * 旁邊的其他連結只在「文字段落類」父元素（TEXT_PARENT）裡才算：<p>、<li>、<td> 裡兩個並排的連結是一段文字；
 * <div>、<nav> 裡一排並列的連結是選單或按鈕列，不算。 */
const INLINE = new Set([
  'abbr',
  'b',
  'bdi',
  'bdo',
  'cite',
  'code',
  'data',
  'del',
  'dfn',
  'em',
  'i',
  'img',
  'ins',
  'kbd',
  'label',
  'mark',
  'output',
  'q',
  's',
  'samp',
  'small',
  'span',
  'strong',
  'sub',
  'sup',
  'time',
  'u',
  'var',
]);
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const HEADING = /^h[1-6]$/;
/** 下載檔副檔名 → 顯示用格式名 */
export const DOWNLOAD_EXT = /\.(pdf|csv|json|xml|odt|ods|odp|zip|txt|md)(?:[?#]|$)/i;
const ARROWS = /[\s→←↗↘›»·]+$|^[\s→←↗↘‹«·]+/g;
const norm = (s) =>
  String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim();
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * htmlparser2 解析成輕量樹（只留建置期判斷需要的欄位），標籤位置 start／openEnd 對應原字串，插入屬性時不必重新序列化。
 * @param {string} src
 */
export function parseTree(src) {
  const root = { name: '#root', attribs: {}, children: [], parent: null, start: 0, openEnd: 0 };
  let cur = root;
  const parser = new Parser(
    {
      onopentag(name, attribs) {
        const el = { name, attribs, children: [], parent: cur, start: parser.startIndex, openEnd: parser.endIndex };
        cur.children.push(el);
        if (!VOID.has(name)) cur = el;
      },
      onclosetag(name) {
        if (VOID.has(name)) return;
        // htmlparser2 會補隱含的結束標籤；往上找同名元素
        let n = cur;
        while (n && n !== root && n.name !== name) n = n.parent;
        if (n && n !== root) cur = n.parent;
      },
      ontext(text) {
        const last = cur.children[cur.children.length - 1];
        if (last && last.type === 'text') last.data += text;
        else cur.children.push({ type: 'text', data: text, parent: cur });
      },
    },
    { decodeEntities: true, lowerCaseTags: true, lowerCaseAttributeNames: true },
  );
  parser.write(src);
  parser.end();
  return root;
}

/** 元素的文字內容（img 用 alt；aria-hidden 的子樹不算） */
export function textOf(n) {
  if (n.type === 'text') return n.data;
  if (n.attribs?.['aria-hidden'] === 'true') return '';
  if (n.name === 'img') return n.attribs.alt ?? '';
  if (n.name === 'script' || n.name === 'style' || n.name === 'template') return '';
  // 相鄰的子元素（卡片裡的 <strong>標題</strong><span>說明</span>）之間補空白，免得英數字黏在一起（Taiwan129）；中日文不補
  let out = '';
  for (const c of n.children) {
    const s = textOf(c);
    if (out && s && c.type !== 'text' && /[A-Za-z0-9.,:;!?)]$/.test(out) && /^[A-Za-z0-9(]/.test(s)) out += ' ';
    out += s;
  }
  return out;
}
/** 連結的可見名稱：文字、圖片 alt；都沒有才看 aria-label */
export const linkText = (a) => norm(textOf(a)) || norm(a.attribs['aria-label']);

/**
 * 「連結前後尚有其他內容」（HM1240401C 後半句）：同一個父元素裡，連結以外還有非空白文字，或有字的行內元素。
 * 單獨佔一個區塊的連結（選單、卡片、按鈕列；<div>／<nav> 裡只和其他連結並列也算）不算；那是 AAA 的 HM3240900C，不在目標內。
 */
const TEXT_PARENT = new Set([
  'p',
  'li',
  'dd',
  'dt',
  'td',
  'th',
  'caption',
  'figcaption',
  'label',
  'small',
  'span',
  'strong',
  'em',
  'b',
  'i',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'address',
]);
export function isInlineLink(a) {
  const p = a.parent;
  if (!p || p.name === '#root') return false;
  const linkCounts = TEXT_PARENT.has(p.name);
  return p.children.some(
    (c) =>
      c !== a &&
      (c.type === 'text'
        ? c.data.trim() !== ''
        : (INLINE.has(c.name) || (linkCounts && c.name === 'a')) && c.attribs['aria-hidden'] !== 'true' && norm(textOf(c)) !== ''),
  );
}
const inSvg = (n) => {
  for (let p = n.parent; p; p = p.parent) if (p.name === 'svg') return true;
  return false;
};

/** 依文件順序走訪元素 */
export function* walk(n) {
  for (const c of n.children ?? []) {
    if (c.type === 'text') continue;
    yield c;
    yield* walk(c);
  }
}

/**
 * 行內連結的描述性 title。
 * contexts 依序是候選上下文（最近的標題、頁面標題…），取第一個非空、且不等於（也不被包含在）連結文字的。
 * @param {{ text: string, contexts: string[], href: string, siteHost?: string, t: (k: string, v?: object) => string }} o
 */
export function describeLink({ text, contexts, href, siteHost = '', t }) {
  const label = norm(text.replace(ARROWS, '')) || text;
  const ctxText = contexts.map((c) => clip(norm(String(c ?? '').replace(ARROWS, '')), 60)).find((c) => c && c !== label && !label.includes(c));
  let title = t('a11y.link.title', { text: label, context: ctxText || t('a11y.link.generic') });
  const ext = String(href).match(DOWNLOAD_EXT);
  if (ext) title = t('a11y.link.download', { fmt: ext[1].toUpperCase(), title });
  const host = /^(?:https?:)?\/\/([^/?#:]+)/i.exec(String(href))?.[1]?.toLowerCase();
  if (host && host !== siteHost) title = t('a11y.link.external', { title, host });
  return title;
}

/**
 * 對整頁 HTML 裡「沒有 title 的行內連結」補描述性 title（建置期安全網：pages.mjs 每頁輸出前套一次；Markdown 與模板已明確給 title 的不動）。
 * @param {string} htmlStr 整頁或片段
 * requireContext：找不到上下文（前面沒有標題、也沒給頁面標題）就先不補，留給整頁那一次（Markdown 片段用）。
 * @param {{ t: (k: string, v?: object) => string, pageTitle?: string, siteHost?: string, siteName?: string, requireContext?: boolean }} o
 * @returns {string}
 */
export function inlineLinkTitles(htmlStr, { t, pageTitle = '', siteHost = '', siteName = '', requireContext = false }) {
  const src = String(htmlStr);
  if (!src.includes('<a')) return src;
  const tree = parseTree(src);
  const inserts = [];
  let heading = '';
  let docTitle = pageTitle;
  for (const el of walk(tree)) {
    if (el.name === 'title' && !docTitle) docTitle = norm(textOf(el)).split(/\s+[|｜–-]\s+/)[0];
    if (HEADING.test(el.name)) {
      // 標題本身在走訪到它的子節點之前就記下：連結在標題裡時，上下文用的是更前面的標題（先存舊值）
      el._prevHeading = heading;
      heading = norm(textOf(el)) || heading;
    }
    if (el.name !== 'a' || el.attribs.href == null || el.attribs.title != null || inSvg(el)) continue;
    if (!isInlineLink(el)) continue;
    const text = linkText(el);
    if (!text) continue;
    let ctxHeading = heading;
    for (let p = el.parent; p; p = p.parent) if (HEADING.test(p.name)) ctxHeading = p._prevHeading;
    if (requireContext && !ctxHeading && !docTitle) continue;
    const title = describeLink({ text, contexts: [ctxHeading, docTitle, siteName], href: el.attribs.href, siteHost, t });
    // 插在開始標籤的 > 之前（htmlparser2 的 endIndex 指向 >）
    const at = src[el.openEnd - 1] === '/' ? el.openEnd - 1 : el.openEnd;
    inserts.push([at, ` title="${esc(title)}"`]);
  }
  if (!inserts.length) return src;
  let out = '';
  let last = 0;
  for (const [at, s] of inserts.sort((a, b) => a[0] - b[0])) {
    out += src.slice(last, at) + s;
    last = at;
  }
  return out + src.slice(last);
}
