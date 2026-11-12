import { config } from '../../site.config.mjs';
import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';
import { esc } from './render.mjs';

marked.setOptions({ gfm: true, breaks: false });

// 第七十三輪（資安稽核 F-1／F5）：淨化改為「白名單」解析器（sanitize-html，建置期 Node 端專用，不進瀏覽器）。
// 舊版是正則黑名單，已實測被繞過：HTML 實體夾帶的 javascript:（jav&#x61;script:）、未閉合的 <iframe srcdoc>、
// <base>／<meta http-equiv=refresh>／<form>／<link>／<object>／<embed> 都會原樣留在頁面。黑名單無法窮舉，白名單只放行已知安全的部分。
// 允許清單依實際內容盤點（content/**、cjkStrong／supSub 與 marked 的 GFM 輸出）；要新增標籤或屬性請看 docs/content-html-safety.md。
export const SANITIZE_OPTIONS = Object.freeze({
  allowedTags: [
    'p', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'blockquote', 'pre', 'code', 'hr', 'br',
    'a', 'img', 'figure', 'figcaption', 'table', 'caption', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
    'strong', 'em', 'b', 'i', 'del', 's', 'sup', 'sub', 'abbr', 'mark', 'small', 'details', 'summary', 'span', 'div',
  ],
  allowedAttributes: {
    '*': ['class', 'id', 'lang', 'dir', 'title'],
    a: ['href', 'hreflang', 'rel'],
    img: ['src', 'alt', 'width', 'height', 'loading', 'decoding'],
    th: ['colspan', 'rowspan', 'align', 'scope'],
    td: ['colspan', 'rowspan', 'align'],
    ol: ['start', 'reversed', 'type'],
    details: ['open'],
  },
  // 連結與圖片只准 http(s)／mailto／tel 與相對路徑（含 //host 協定相對＝http(s)）；屬性值先解實體再比對，所以 jav&#x61;script: 也擋得住
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedSchemesAppliedToAttributes: ['href', 'src', 'cite'],
  allowProtocolRelative: true,
  allowedEmptyAttributes: ['alt', 'open', 'reversed'],
  // 不在清單的標籤：拿掉標籤、保留文字；下列標籤連內容一起丟（腳本、樣式、內嵌文件、SVG／MathML 子樹）
  disallowedTagsMode: 'discard',
  nonTextTags: ['script', 'style', 'textarea', 'option', 'select', 'noscript', 'iframe', 'frame', 'frameset', 'object', 'embed', 'template', 'svg', 'math', 'title', 'xmp', 'noembed', 'noframes'],
  // marked 會把文字裡的 " ' 寫成 &quot; &#39;，sanitize-html 不會；補回來讓輸出與改版前逐位元相同
  textFilter: (t) => t.replace(/"/g, '&quot;').replace(/'/g, '&#39;'),
});

/** 白名單淨化 marked 的輸出（md／mdInline 共用）。空元素維持 marked 的 <br>／<hr>／<img …> 寫法（不加 " /"）。 */
export function sanitize(htmlStr) {
  return sanitizeHtml(String(htmlStr), SANITIZE_OPTIONS).replace(/<(br|hr|img)\b([^>]*?) \/>/g, '<$1$2>');
}

// CommonMark 的強調規則在中日韓文裡常失效（「常見**咳嗽**、」兩側都是非空白字元，** 既是左側也是右側分隔符，無法開啟），
// 先把 **粗體** 轉成 <strong>，再交給 marked；行內 code 區塊不處理。
export function cjkStrong(src) {
  return String(src).split(/(`[^`\n]*`)/).map((seg, i) => (i % 2 ? seg : supSub(seg.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>')))).join('');
}
// 第三十五輪：上標與下標。Markdown 沒有標準寫法，採 Pandoc 慣例：^上標^、~下標~（兩端不可有空白，所以「~~刪除線~~」不受影響）。
// 用途：疫情報導正文裡的註記（如「資料來源^1^」）、化學式（CO~2~）；作者的服務單位上標不用這個，由 authorNotes() 產生。
export function supSub(seg) {
  return seg.replace(/\^([^\s^]{1,20})\^/g, '<sup>$1</sup>').replace(/(?<!~)~([^\s~]{1,20})~(?!~)/g, '<sub>$1</sub>');
}

// ── 第八輪（ARCHITECTURE 16.1）：內文圖片 ──
// 全站檔案資產登錄：'/files/{id}/{file}' → { alt, width, height, kind }。治理引擎（applyGovernance）每次建置設定一次，
// 所以模板不必改呼叫方式；md() 第二參數 { assets, id } 可覆寫（測試或單筆預覽用）。
let ASSET_REG = null;
export function setAssetRegistry(map) { ASSET_REG = map instanceof Map ? map : null; }
export function getAssetRegistry() { return ASSET_REG; }

const safeDecode = (s) => { try { return decodeURIComponent(s); } catch { return s; } };
const unescAttr = (s) => String(s).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

function assetMetaFor(src, opts) {
  const p = safeDecode(unescAttr(src).replace(/[?#].*$/, ''));
  const m = p.match(/^\/files\/([^/]+)\/([^/]+)$/);
  if (!m) return null;
  if (Array.isArray(opts?.assets) && (!opts.id || opts.id === m[1])) {
    const a = opts.assets.find((x) => x?.file === m[2]);
    if (a) return a;
  }
  return ASSET_REG?.get(p) ?? null;
}

/** <img>：/files/ 圖片以 assets.alt 補空白 alt、加 width／height（若有）；所有圖片加 loading="lazy" decoding="async" */
export function enhanceImages(htmlStr, opts = {}) {
  return htmlStr.replace(/<img\b([^>]*?)\s*\/?>/gi, (tag, attrs) => {
    let a = attrs;
    const src = a.match(/\ssrc\s*=\s*"([^"]*)"/i)?.[1] ?? '';
    const meta = src ? assetMetaFor(src, opts) : null;
    if (meta?.alt) {
      if (/\salt\s*=\s*""/i.test(a)) a = a.replace(/\salt\s*=\s*""/i, ` alt="${esc(meta.alt)}"`);
      else if (!/\salt\s*=/i.test(a)) a += ` alt="${esc(meta.alt)}"`;
    } else if (!/\salt\s*=/i.test(a)) a += ' alt=""';
    if (meta?.width && !/\swidth\s*=/i.test(a)) a += ` width="${Number(meta.width)}"`;
    if (meta?.height && !/\sheight\s*=/i.test(a)) a += ` height="${Number(meta.height)}"`;
    if (!/\sloading\s*=/i.test(a)) a += ' loading="lazy"';
    if (!/\sdecoding\s*=/i.test(a)) a += ' decoding="async"';
    return `<img${a}>`;
  });
}

/**
 * Markdown → HTML（淨化、站內路徑加 basePath；/files/ 路徑也加 basePath、不加語言前綴）。
 * @param {string} markdown
 * @param {{ assets?: object[], id?: string }} [opts] 選填：該筆內容的 assets（不給則查全站登錄）
 */
export function md(markdown, opts = {}) {
  if (!markdown) return '';
  // 無障礙：程式碼區塊可能橫向溢出，鍵盤使用者要能 Tab 進去捲動（WCAG 2.1.1；axe scrollable-region-focusable）
  const html = enhanceImages(sanitize(marked.parse(cjkStrong(markdown))), opts).replace(/<pre>/g, '<pre tabindex="0">');
  return config.basePath ? html.replace(/(\s(?:href|src)=")\/(?!\/)/g, `$1${config.basePath}/`) : html;
}

/** Markdown → 純文字（索引、摘要用） */
export function mdToText(markdown) {
  if (!markdown) return '';
  return String(markdown)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~|-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function mdInline(markdown) {
  if (!markdown) return '';
  return sanitize(marked.parseInline(cjkStrong(markdown)));
}

export { esc };
