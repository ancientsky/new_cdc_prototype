// 第四十五輪：PDF 文字層 → 版面文字（給 bulletin-rules 的 splitManuscript 吃）、圖說與抽出圖片的配對。純函式、零依賴，Node 與瀏覽器都能跑。
// 為什麼要自己排版：pdf.js 的 getTextContent() 回傳的是「一塊一塊的字」與座標，沒有行的概念；splitManuscript 認的是
// pdftotext -layout 那種「一行一行、同一行的欄位用空白隔開」的文字（第三十五輪實測的就是它）。這裡照座標把字塊排回行，
// 字塊之間依間距補空白，頁與頁之間空一行，產出的文字就跟 pdftotext -layout 幾乎一樣，切段規則不用再改一套。
import { cnToNum } from '../bulletin-rules.js';

/**
 * 一頁的字塊（pdf.js TextItem 經 pdf-read.js 轉成 { str, x, y, w, h, size }；y 以頁面「上緣」為 0，往下遞增）→ 行的清單
 * 規則：同一行＝基線 y 相差不到半個字高；同一行內依 x 排序；兩塊之間的間距超過 0.25 em 就補空白，超過 1 em 依距離補多個（模仿 -layout）。
 * @param {{ str: string, x: number, y: number, w: number, h: number, size?: number }[]} items
 * @returns {{ y: number, x: number, text: string }[]}
 */
export function linesFromItems(items) {
  const rows = [];
  const sorted = [...(items ?? [])].filter((t) => t && typeof t.str === 'string' && t.str.trim() !== '').sort((a, b) => a.y - b.y || a.x - b.x);
  for (const t of sorted) {
    const size = t.size || t.h || 10;
    const row = rows.find((r) => Math.abs(r.y - t.y) <= Math.max(2, size * 0.5));
    if (row) { row.items.push(t); row.y = (row.y * row.items.length + t.y) / (row.items.length + 1); } else rows.push({ y: t.y, items: [t] });
  }
  rows.sort((a, b) => a.y - b.y);
  return rows.map((r) => {
    const its = r.items.sort((a, b) => a.x - b.x);
    let text = '';
    let cursor = null;
    for (const t of its) {
      const size = t.size || t.h || 10;
      if (cursor != null) {
        const gap = t.x - cursor;
        if (gap > size * 1.0) text += ' '.repeat(Math.min(40, Math.max(2, Math.round(gap / (size * 0.5)))));
        else if (gap > size * 0.25 || (/[A-Za-z0-9]$/.test(text) && /^[A-Za-z0-9]/.test(t.str) && gap > size * 0.1)) text += ' ';
      }
      text += t.str;
      cursor = t.x + (t.w || 0);
    }
    return { y: r.y, x: its[0].x, text: text.replace(/\s+$/, '') };
  });
}

/** 行 → 這一頁的文字；左側縮排依 x 補空白（splitManuscript 會自己 trim，縮排只是讓人讀稿件欄時看得出版面） */
export function pageText(lines, { indentUnit = 6 } = {}) {
  const minX = Math.min(...lines.map((l) => l.x), Infinity);
  return lines.map((l) => `${' '.repeat(Number.isFinite(minX) ? Math.min(20, Math.round((l.x - minX) / indentUnit)) : 0)}${l.text}`).join('\n');
}

/** 多頁 → 整份稿件文字（頁與頁之間空一行；splitManuscript 會去掉頁首頁尾） */
export function manuscriptText(pages) {
  return (pages ?? []).map((p) => pageText(linesFromItems(p.items))).filter((t) => t.trim()).join('\n\n');
}

const CAPTION_RE = /^\s*(圖|表|Fig(?:ure|\.)?|Table)\s*(\d{1,2}|[一二三四五六七八九十]+)\s*[、.．:：,，\s]/i;
/**
 * 每頁的圖說（「圖一、…」「表 1 …」獨立成行）→ [{ page, kind, no, line }]（page 從 1 起）
 * @param {string[]} pageTexts
 */
export function captionsByPage(pageTexts) {
  const out = [];
  pageTexts.forEach((text, i) => {
    for (const line of String(text ?? '').split('\n')) {
      const m = line.match(CAPTION_RE);
      if (!m) continue;
      const no = cnToNum(m[2]);
      if (no == null || line.trim().length > 160) continue;
      const kind = /^(表|table)/i.test(m[1]) ? 'table' : 'figure';
      if (!out.some((c) => c.kind === kind && c.no === no)) out.push({ page: i + 1, kind, no, line: line.trim() });
    }
  });
  return out;
}

/**
 * 抽出的圖片 → 哪些是正文的圖。規則：
 *  - 太小（寬 < minWidth 或高 < minHeight）的是刊頭小圖、符號，略過；
 *  - 同一張（同尺寸同指紋）出現在兩頁以上的是頁首／頁尾裝飾，略過；
 *  - 其餘依「出現在圖說同一頁（或前一頁）」配給圖說；一頁有多張就依出現順序配；配不到圖說的列在 leftovers 讓同事決定。
 * @param {{ key: string, page: number, order: number, width: number, height: number, fingerprint?: string }[]} images
 * @param {{ page: number, kind: string, no: number }[]} captions
 */
export function matchImages(images, captions, { minWidth = 150, minHeight = 80 } = {}) {
  const seen = new Map();
  for (const im of images ?? []) { const k = `${im.width}x${im.height}:${im.fingerprint ?? ''}`; seen.set(k, (seen.get(k) ?? 0) + 1); }
  const skipped = [];
  const pool = [];
  for (const im of images ?? []) {
    const k = `${im.width}x${im.height}:${im.fingerprint ?? ''}`;
    if (im.width < minWidth || im.height < minHeight) { skipped.push({ ...im, why: 'small' }); continue; }
    if ((seen.get(k) ?? 0) > 1) { skipped.push({ ...im, why: 'repeated' }); continue; }
    pool.push(im);
  }
  pool.sort((a, b) => a.page - b.page || a.order - b.order);
  const assigned = [];
  const used = new Set();
  // 只配「圖」；表格通常是文字，PDF 裡的表多半不是圖片
  for (const c of [...(captions ?? [])].filter((x) => x.kind === 'figure').sort((a, b) => a.page - b.page || a.no - b.no)) {
    const cand = pool.find((im) => !used.has(im.key) && im.page === c.page) ?? pool.find((im) => !used.has(im.key) && im.page === c.page - 1) ?? pool.find((im) => !used.has(im.key) && im.page === c.page + 1);
    if (!cand) continue;
    used.add(cand.key);
    assigned.push({ key: cand.key, kind: 'figure', no: c.no, page: cand.page, fileName: `圖${c.no}.png` });
  }
  const leftovers = pool.filter((im) => !used.has(im.key));
  return { assigned, leftovers, skipped };
}

/** 給人看的摘要（後台訊息列） */
export function describeExtraction({ pages = 0, chars = 0, assigned = [], leftovers = [], skipped = [] } = {}) {
  const parts = [`讀到 ${pages} 頁、約 ${chars} 字`];
  if (assigned.length) parts.push(`${assigned.length} 張圖已配到圖說（${assigned.map((a) => `圖 ${a.no}`).join('、')}）`);
  if (leftovers.length) parts.push(`另有 ${leftovers.length} 張圖沒有對到圖說（下方可指定）`);
  if (skipped.length) parts.push(`略過 ${skipped.length} 張小圖或重複的刊頭圖`);
  return `${parts.join('；')}。`;
}
