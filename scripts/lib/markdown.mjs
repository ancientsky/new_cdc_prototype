import { config } from '../../site.config.mjs';
import { marked } from 'marked';
import { esc } from './render.mjs';

marked.setOptions({ gfm: true, breaks: false });

// 極簡白名單淨化：內容來自 repo（受審核），但仍移除 script/style/on* 與 javascript: 連結。
function sanitize(htmlStr) {
  return htmlStr
    .replace(/<\s*(script|style|iframe|object|embed)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*(["']?)\s*javascript:[^"'\s>]*\2/gi, '$1="#"');
}

// CommonMark 的強調規則在中日韓文裡常失效（「常見**咳嗽**、」兩側都是非空白字元，** 既是左側也是右側分隔符，無法開啟），
// 先把 **粗體** 轉成 <strong>，再交給 marked；行內 code 區塊不處理。
export function cjkStrong(src) {
  return String(src).split(/(`[^`\n]*`)/).map((seg, i) => (i % 2 ? seg : seg.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>'))).join('');
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
