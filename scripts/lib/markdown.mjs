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

export function md(markdown) {
  if (!markdown) return '';
  const html = sanitize(marked.parse(cjkStrong(markdown)));
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
