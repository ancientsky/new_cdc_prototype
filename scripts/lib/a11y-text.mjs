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
        // start／end（含）是這段文字在原字串的位置（實體未解碼前），給 markFallbackLang 就地包 span 用
        if (last && last.type === 'text') {
          last.data += text;
          last.end = parser.endIndex;
        } else cur.children.push({ type: 'text', data: text, parent: cur, start: parser.startIndex, end: parser.endIndex });
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

// ── 不同語言的片段（HM2310200C，AA）──
// 第七十六輪：外語頁退回中文正本的片段要標 lang="zh-TW"（螢幕閱讀器才會切換中文語音；docs/a11y.md 第 12、13 節）。
// 第一層在模板：L()／localText() 知道「這一欄退回了來源語言」，模板把 lang 標在承載元素上（_partials.mjs 的 Lx／langOf／leadOf）。
// 這裡是第二層、整頁安全網：模板沒標到的中文片段（散在幾十個模板的單位名稱、表格儲存格、i18n 變數裡的中文值…）在輸出前補上。
// 規則：
//   - 外語頁（不含日文：日文本來就用漢字，分不出是不是中文正本）：「中文片段」＝從第一個漢字到最後一個漢字或全形標點，
//     中間只容許空白、數字、半形標點與全大寫縮寫（MMR、COVID-19、PDF）；遇到小寫英文字（頁面語言的句子）就斷開。標 lang="zh-TW"。
//   - 中文頁（反向，便宜的一半）：整段沒有漢字、且是連續 4 個以上英文字的文字（sourceLang:'en' 內容的標題、英文國名、外文文獻）標 lang="en"。
//     判準與 scripts/a11y-tw.mjs 的檢查相同；3 個字以下的專有名詞（WHO、Taiwan CDC）屬規範例外，不動。
//   - 只動標籤之外的文字；<head>（含 <title>）、script、style、template、code／pre 與已有 lang 的祖先都不動，屬性值不動。
//   - 片段就是承載元素的全部文字 ⇒ 把 lang 加在那個元素上（不改 DOM 結構，行內連結判斷與 CSS 選擇器都不受影響）；
//     否則就地包 <span lang>（<option>、<textarea> 與 SVG 裡不能放 span，那裡只在整段都是同一語言時加在元素上）。
const HAN = '[\\u3400-\\u9FFF\\uF900-\\uFAFF]';
const CJK_CORE = `(?:${HAN}|[\\u3000-\\u303F\\uFF00-\\uFFEF])`;
const CJK_GAP = '(?:[\\s\\d.,:;/+%()\\u2013\\u2014-]|[A-Z]{1,8}(?:-\\d+)?|&(?:amp|nbsp|#\\d+);)+';
const CJK_RUN = new RegExp(`${CJK_CORE}+(?:${CJK_GAP}${CJK_CORE}+)*\\)?`, 'gu');
const HAN_RE = new RegExp(HAN, 'u');
/** 與 scripts/a11y-tw.mjs 共用：中文頁上「一段英文」的判準（連續 4 個以上英文字） */
export const EN_WORDS_RE = /[A-Za-z][A-Za-z'’-]*(?:\s+[A-Za-z][A-Za-z'’-]*){3,}/;
const LANG_SKIP = new Set(['head', 'title', 'script', 'style', 'template', 'noscript', 'code', 'pre', 'kbd', 'samp', 'xmp']);
const NO_SPAN = new Set(['option', 'optgroup', 'select', 'textarea', 'svg', 'title', 'text', 'tspan', 'desc']);
const NO_ATTR = new Set(['#root', 'html', 'body', 'main', 'head']);
const balanced = (s) => (s.match(/\(/g) ?? []).length === (s.match(/\)/g) ?? []).length;

/**
 * 不同語言的片段補 lang（建置期安全網，pages.mjs 每頁輸出前套一次）。
 * @param {string} htmlStr 整頁 HTML
 * @param {{ pageLang: string }} o pageLang＝頁面語言
 * @returns {{ html: string, marked: number }} marked＝補了幾處（建置記錄用）
 */
export function markFallbackLang(htmlStr, { pageLang }) {
  const src = String(htmlStr);
  const zhPage = /^zh/i.test(pageLang ?? '');
  if (!pageLang || /^ja/i.test(pageLang) || (!zhPage && !HAN_RE.test(src))) return { html: src, marked: 0 };
  const lang = zhPage ? 'en' : 'zh-TW';
  /** 文字（原字串）裡要標的片段：[起點, 長度] */
  const runsOf = (raw, data) => {
    if (zhPage) {
      if (HAN_RE.test(data) || !EN_WORDS_RE.test(data)) return [];
      const lead = raw.length - raw.trimStart().length;
      return [[lead, raw.trim().length]];
    }
    if (!HAN_RE.test(data)) return [];
    return (
      [...raw.matchAll(CJK_RUN)]
        .filter((m) => HAN_RE.test(m[0]))
        // 片段裡有沒配對的「(」（「新通報（年） (人)」）才把後面緊接的「)」收進來
        .map((m) => [m.index, m[0].endsWith(')') && balanced(m[0].slice(0, -1)) ? m[0].length - 1 : m[0].length])
    );
  };
  const tree = parseTree(src);
  const inserts = [];
  const visit = (n, effLang, inSvgTree) => {
    for (const c of n.children) {
      if (c.type !== 'text') {
        if (LANG_SKIP.has(c.name) && !(inSvgTree && c.name === 'title')) continue;
        if (c.attribs['data-a11y-propernoun'] != null) continue; // 規範的專有名詞例外（scripts/a11y-tw.mjs 同樣略過）
        visit(c, c.attribs.lang ?? effLang, inSvgTree || c.name === 'svg');
        continue;
      }
      if (effLang !== pageLang || c.start == null) continue;
      const raw = src.slice(c.start, c.end + 1);
      const runs = runsOf(raw, c.data);
      if (!runs.length) continue;
      const whole = runs.length === 1 && raw.substr(runs[0][0], runs[0][1]) === raw.trim();
      const alone = n.children.every((x) => x === c || (x.type === 'text' && !x.data.trim()));
      if (whole && alone && !NO_ATTR.has(n.name) && n.attribs.lang == null) {
        const at = src[n.openEnd - 1] === '/' ? n.openEnd - 1 : n.openEnd;
        inserts.push([at, ` lang="${lang}"`]);
        continue;
      }
      if (inSvgTree || NO_SPAN.has(n.name)) continue;
      for (const [i, len] of runs) {
        inserts.push([c.start + i, `<span lang="${lang}">`]);
        inserts.push([c.start + i + len, '</span>']);
      }
    }
  };
  visit(tree, pageLang, false);
  if (!inserts.length) return { html: src, marked: 0 };
  let out = '';
  let last = 0;
  // sort 是穩定的：同一位置（前一段的 </span> 與下一段的 <span>）保留插入順序，不會巢狀
  for (const [at, s] of inserts.sort((a, b) => a[0] - b[0])) {
    out += src.slice(last, at) + s;
    last = at;
  }
  return { html: out + src.slice(last), marked: inserts.filter(([, s]) => s !== '</span>').length };
}
