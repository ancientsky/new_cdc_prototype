// 舊頁 HTML → 內容區抽取 → 圖片與連結改寫 → Markdown（用 md-convert.js 的 htmlToMd，與上架編輯器同一份轉換器）。
import { htmlToMd } from '../../../src/client/admin/md-convert.js';
import {
  parseHtml, firstOf, findAll, findFirst, removeNode, textOf, innerHtml, serialize, wordStats, cleanWordStyles, tableProblems, walkEls, isEl, makeRoot, plainText,
} from './html.mjs';

const DATE_RE = /(\d{4})\s*[/\-.年]\s*(\d{1,2})\s*[/\-.月]\s*(\d{1,2})/;
export function parseDate(text) {
  const m = DATE_RE.exec(String(text ?? ''));
  if (!m) return null;
  let [, y, mo, d] = m;
  mo = mo.padStart(2, '0'); d = d.padStart(2, '0');
  if (Number(mo) < 1 || Number(mo) > 12 || Number(d) < 1 || Number(d) > 31) return null;
  return `${y}-${mo}-${d}`;
}

/** 抽出內容區：回傳 { container, body, htmlTitle, updatedAt, breadcrumbs, word } */
export function extractPage(rules, html) {
  const ex = rules.extraction ?? {};
  const root = parseHtml(html);
  const container = firstOf(root, ex.contentSelectors ?? ['body']) ?? root;
  const titleEl = firstOf(container, ex.titleSelectors ?? ['h1']);
  const docTitle = findFirst(root, 'title');
  const htmlTitle = (titleEl ? textOf(titleEl) : docTitle ? textOf(docTitle).replace(/\s*[-｜|]\s*衛生福利部疾病管制署.*$/, '') : '').replace(/\s+/g, ' ').trim();
  const upEl = firstOf(container, ex.updatedSelectors ?? []);
  const updatedAt = upEl ? parseDate(textOf(upEl)) : null;
  const bcEl = findFirst(root, '.breadcrumb');
  const breadcrumbs = bcEl ? findAll(bcEl, 'li').map((li) => textOf(li).replace(/\s+/g, ' ').trim()).filter(Boolean) : [];
  const word = wordStats(container);
  cleanWordStyles(container);
  for (const sel of ex.removeSelectors ?? []) for (const el of findAll(container, sel)) removeNode(el);
  const body = firstOf(container, ex.bodySelectors ?? []) ?? container;
  return { root, container, body, htmlTitle, updatedAt, breadcrumbs, word };
}

const MEDIA_TAGS = new Set(['iframe', 'video', 'audio', 'object', 'embed']);

/**
 * 改寫節點內的圖片與連結（就地修改），回傳統計。
 * ctx.onImage({src, alt, title}) → { src, alt } | null；ctx.onLink(absUrl) → newHref | null；ctx.pageUrl；ctx.siteBase
 */
export function rewriteBody(node, ctx) {
  const stat = { images: 0, links: 0, legacyLinks: 0, fileLinks: 0, unlistedFileLinks: [], media: [], missingImages: [] };
  for (const el of [...walkEls(node)]) {
    if (MEDIA_TAGS.has(el.tag)) { stat.media.push({ tag: el.tag, src: el.attrs?.src ?? el.attrs?.data ?? '' }); continue; }
    if (el.tag === 'img') {
      stat.images++;
      const r = ctx.onImage?.({ src: el.attrs.src ?? '', alt: el.attrs.alt ?? '', title: el.attrs.title ?? '' });
      if (r) { el.attrs.src = r.src; el.attrs.alt = r.alt; } else stat.missingImages.push(el.attrs.src ?? '');
      continue;
    }
    if (el.tag === 'a') {
      const href = String(el.attrs.href ?? '').trim();
      if (!href || href.startsWith('#') || /^(mailto|tel|javascript):/i.test(href)) continue;
      let abs;
      try { abs = new URL(href, ctx.pageUrl ?? ctx.siteBase); } catch { continue; }
      stat.links++;
      const mapped = ctx.onLink?.(abs);
      if (mapped) { el.attrs.href = mapped; stat.fileLinks++; continue; }
      if (mapped === '') { el.attrs.href = abs.href; stat.fileLinks++; continue; }
      if (abs.origin === new URL(ctx.siteBase).origin) {
        el.attrs.href = abs.href;
        stat.legacyLinks++;
        if (ctx.fileLinkRe && new RegExp(ctx.fileLinkRe, 'i').test(abs.pathname + abs.search)) stat.unlistedFileLinks.push(abs.href);
      } else {
        el.attrs.href = abs.href;
        if (ctx.fileLinkRe && /\.(pdf|docx?|odt|xlsx?|csv)(\?|#|$)/i.test(abs.pathname)) stat.unlistedFileLinks.push(abs.href);
      }
    }
  }
  return stat;
}

/** 節點陣列 → Markdown；回傳 { markdown, dropped } */
export function toMd(nodes) {
  const dropped = [];
  const html = nodes.map(serialize).join('');
  let markdown = htmlToMd(html, { dropped });
  // Word 表頭儲存格常整格粗體：Markdown 表頭本來就是粗體，去掉多餘的 **
  markdown = markdown.split('\n').map((l, i, arr) => (arr[i + 1] && /^\|(\s*:?-{3,}:?\s*\|)+\s*$/.test(arr[i + 1]) && l.startsWith('|') ? l.replace(/\*\*/g, '') : l)).join('\n');
  return { markdown, dropped };
}

/** 若內容區只有一個包裝 div，往下穿透到真正的內容 */
export function unwrap(body) {
  let cur = body;
  for (let i = 0; i < 4; i++) {
    const els = cur.children.filter((c) => isEl(c) || (c.t === 'text' && c.text.trim()));
    if (els.length === 1 && isEl(els[0]) && ['div', 'section', 'article'].includes(els[0].tag)) cur = els[0]; else break;
  }
  return cur;
}

/** 依最高層標題切小節：{ preamble: [nodes], sections: [{ heading, level, nodes }] } */
export function splitSections(body) {
  const cur = unwrap(body);
  const kids = cur.children;
  const lv = (n) => (isEl(n) && /^h[2-4]$/.test(n.tag) ? Number(n.tag[1]) : null);
  const levels = kids.map(lv).filter(Boolean);
  if (!levels.length) return { preamble: kids, sections: [] };
  const top = Math.min(...levels);
  const preamble = [];
  const sections = [];
  let curSec = null;
  for (const k of kids) {
    if (lv(k) === top) { curSec = { heading: textOf(k).replace(/\s+/g, ' ').trim(), level: top, nodes: [] }; sections.push(curSec); continue; }
    (curSec ? curSec.nodes : preamble).push(k);
  }
  return { preamble, sections };
}

/** Q&A 結構：手風琴 panel → [{ question, answerNode }]；抓不到時回傳空陣列 */
export function faqItems(rules, container) {
  const cfg = rules.extraction?.faq ?? { itemSelector: '.panel', questionSelector: '.panel-title', answerSelector: '.panel-body' };
  const out = [];
  for (const p of findAll(container, cfg.itemSelector)) {
    const q = findFirst(p, cfg.questionSelector);
    const a = findFirst(p, cfg.answerSelector);
    if (!q || !a) continue;
    const question = textOf(q).replace(/\s+/g, ' ').trim().replace(/^Q\s*\d+\s*[.、．:：]\s*/i, '');
    if (question) out.push({ question, answerNode: a });
  }
  return out;
}

/** 轉換結果的品質檢查：Word 殘留、複雜表格、過短、嵌入媒體、被丟掉的東西 */
export function bodyChecks({ markdown, dropped = [], tables = [], media = [], minChars = 40 }) {
  const issues = [];
  if (/mso-|MsoNormal|MsoList|<o:p>|&nbsp;/.test(markdown)) issues.push({ code: 'word-residue', severity: 'warn', message: 'Markdown 仍殘留 Word 樣式字串（mso-／MsoNormal／&nbsp;），請檢視' });
  if (tables.length) issues.push({ code: 'table-complex', severity: 'warn', message: `表格複雜（${[...new Set(tables)].join('、')}）：Markdown 表格不支援合併儲存格，已攤平，請人工檢視` });
  if (media.length) issues.push({ code: 'embedded-media', severity: 'warn', message: `內文有嵌入媒體 ${media.length} 個（${[...new Set(media.map((m) => m.tag))].join('、')}）未轉入；影音請另建 media 內容` });
  for (const d of dropped) issues.push({ code: 'content-dropped', severity: 'warn', message: d });
  if (plainText(markdown).length < minChars) issues.push({ code: 'body-short', severity: 'warn', message: `內文過短（${plainText(markdown).length} 字，低於 ${minChars}）` });
  return issues;
}

export { makeRoot, innerHtml, tableProblems };
