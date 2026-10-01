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

export function md(markdown) {
  if (!markdown) return '';
  return sanitize(marked.parse(String(markdown)));
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
  return sanitize(marked.parseInline(String(markdown)));
}

export { esc };
