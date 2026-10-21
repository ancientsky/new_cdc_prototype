// 第四十五輪：PDF 文字層 → 版面文字（給 bulletin-rules 的 splitManuscript 吃）、表格依座標還原成 Markdown 表格、圖說與抽出圖片的配對。
// 純函式、零依賴，Node 與瀏覽器都能跑。
// 為什麼要自己排版：pdf.js 的 getTextContent() 回傳的是「一塊一塊的字」與座標，沒有行的概念；splitManuscript 認的是
// pdftotext -layout 那種「一行一行、同一行的欄位用空白隔開」的文字（第三十五輪實測的就是它）。這裡照座標把字塊排回行，
// 字塊之間依間距補空白，頁與頁之間空一行，產出的文字就跟 pdftotext -layout 幾乎一樣，切段規則不用再改一套。
// 表格（第四十五輪補）：只有座標才分得出「哪些字在同一欄」，所以表格在這一層就還原成 Markdown 表格（「表 N」圖說之後、
// 連續多行且每行有兩個以上儲存格的區塊），splitManuscript 再把 | 開頭的行掛到那個表的 markdown。貼純文字時沒有座標，表格仍是文字。
import { cnToNum } from '../bulletin-rules.js';

// 每頁字塊上限與字塊內連續空白上限（2026-10-21 資安檢查：特製文字層可塞同列幾萬個字塊或幾萬個空白，讓後台頁面卡住好幾秒）。
// 疫情報導一頁通常幾百到兩三千個字塊、空白不會連續超過一行寬，上限遠高於真實稿件。
export const MAX_PAGE_ITEMS = 15000;
export const MAX_ITEM_SPACES = 40;
/** 字塊清單 → 去掉空字塊與座標不是數字的字塊、最多 MAX_PAGE_ITEMS 個、字塊內連續空白收斂到 MAX_ITEM_SPACES 個 */
export function capItems(items) {
  const out = [];
  for (const t of items ?? []) {
    if (!t || typeof t.str !== 'string' || t.str.trim() === '' || !Number.isFinite(t.x) || !Number.isFinite(t.y)) continue;
    out.push(t.str.length > MAX_ITEM_SPACES ? { ...t, str: t.str.replace(/\s{41,}/g, ' '.repeat(MAX_ITEM_SPACES)) } : t);
    if (out.length >= MAX_PAGE_ITEMS) break;
  }
  return out;
}

/**
 * 同一列裡疊在別的字塊「裡面」的字塊（隱藏層或重印的字，像 42(17) 把側標「疫情描述」疊在單位名上）丟掉，留比較寬的那個。
 * t 在 o 裡面＝o.x ≤ t.x + ¼ em 且 o 的右緣 ≥ t 的右緣 − ¼ em；o 要比 t 寬（同寬時留先出現的）。
 * 原本每個字塊跟同列每個字塊比（O(n²)，同列兩萬塊要三秒）；改成依「t.x + ¼ em」由小到大掃，把 x 已經夠小的字塊依
 * 「寬度由大到小、同寬先出現者優先」的名次放進樹狀陣列（存右緣最大值），查名次比 t 前面的字塊裡右緣最大的那個：O(n log n)，結果與原本相同。
 * @template {{ x: number, w?: number, h?: number, size?: number }} T
 * @param {T[]} items
 * @returns {T[]}
 */
export function dropOverlaid(items) {
  const n = items.length;
  const em4 = (t) => (t.size || t.h || 10) * 0.25;
  const w = (t) => t.w || 0;
  const idx = () => Array.from({ length: n }, (_, i) => i);
  const rankOf = new Int32Array(n);
  idx().sort((a, b) => w(items[b]) - w(items[a]) || a - b).forEach((k, r) => { rankOf[k] = r; });
  const byX = idx().sort((a, b) => items[a].x - items[b].x);
  const tree = new Float64Array(n + 1).fill(-Infinity);
  const keep = new Array(n).fill(true);
  let p = 0;
  for (const i of idx().sort((a, b) => items[a].x + em4(items[a]) - (items[b].x + em4(items[b])))) {
    const t = items[i];
    for (; p < n && items[byX[p]].x <= t.x + em4(t); p++) {
      const o = items[byX[p]];
      for (let r = rankOf[byX[p]] + 1; r <= n; r += r & -r) if (tree[r] < o.x + w(o)) tree[r] = o.x + w(o);
    }
    let right = -Infinity;
    for (let r = rankOf[i]; r > 0; r -= r & -r) if (tree[r] > right) right = tree[r];
    if (right >= t.x + w(t) - em4(t)) keep[i] = false;
  }
  return items.filter((_, i) => keep[i]);
}

/**
 * 一頁的字塊（pdf.js TextItem 經 pdf-read.js 轉成 { str, x, y, w, h, size }；y 以頁面「上緣」為 0，往下遞增）→ 行的清單
 * 規則：同一行＝基線 y 相差不到半個字高；同一行內依 x 排序；兩塊之間的間距超過 0.25 em 就補空白，超過 1 em 依距離補多個（模仿 -layout）。
 * 每行另帶 cells（依「超過 0.6 em 的空隙」切出的儲存格，表格還原用）。
 * @param {{ str: string, x: number, y: number, w: number, h: number, size?: number }[]} items
 * @returns {{ y: number, x: number, text: string, cells: { text: string, x0: number, x1: number }[] }[]}
 */
export function linesFromItems(items) {
  const rows = [];
  const sorted = capItems(items).sort((a, b) => a.y - b.y || a.x - b.x);
  // 字塊依 y 由小到大進來、列的 y 只會變大：y 已經比目前字塊小超過最大容差的列不可能再配到，從頭跳過（不然每頁上萬列時是 O(n²)）
  const maxTol = sorted.reduce((m, t) => Math.max(m, 2, (t.size || t.h || 10) * 0.5), 2);
  let live = 0;
  for (const t of sorted) {
    const size = t.size || t.h || 10;
    while (live < rows.length && rows[live].y < t.y - maxTol) live++;
    let row = null;
    for (let k = live; k < rows.length && !row; k++) if (Math.abs(rows[k].y - t.y) <= Math.max(2, size * 0.5)) row = rows[k];
    if (row) { row.items.push(t); row.y = (row.y * row.items.length + t.y) / (row.items.length + 1); } else rows.push({ y: t.y, items: [t] });
  }
  rows.sort((a, b) => a.y - b.y);
  return rows.map((r) => {
    const its = dropOverlaid(r.items).sort((a, b) => a.x - b.x);
    let text = '';
    let cursor = null;
    let latinEnd = false; // text 與最後一格都以上一個字塊結尾：看上一個字塊就好（對越拼越長的 text 跑 /…$/ 每次都要從頭掃）
    const cells = [];
    const pieces = []; // 每個字塊（表格還原時依欄位起點重新分格）
    for (const t of its) {
      const size = t.size || t.h || 10;
      const gap = cursor == null ? 0 : t.x - cursor;
      if (cursor != null) {
        if (gap > size * 1.0) text += ' '.repeat(Math.min(40, Math.max(2, Math.round(gap / (size * 0.5)))));
        else if (gap > size * 0.25 || (latinEnd && /^[A-Za-z0-9]/.test(t.str) && gap > size * 0.1)) text += ' ';
      }
      text += t.str;
      const x1 = t.x + (t.w || 0);
      const last = cells[cells.length - 1];
      const piece = { text: t.str, x0: t.x, x1, size, gap };
      if (last && gap <= size * 0.6) { last.text += (gap > size * 0.25 || (latinEnd && /^[A-Za-z0-9]/.test(t.str) && gap > size * 0.1) ? ' ' : '') + t.str; last.x1 = x1; last.items.push(piece); } else cells.push({ text: t.str, x0: t.x, x1, items: [piece] });
      pieces.push(piece);
      cursor = x1;
      latinEnd = /[A-Za-z0-9]$/.test(t.str);
    }
    for (const c of cells) c.text = c.text.trim();
    return { y: r.y, x: its[0].x, text: text.trimEnd(), cells: cells.filter((c) => c.text), items: pieces };
  });
}

/* ───────── 表格 ───────── */
const TABLE_CAP_RE = /^\s*(?:[（(]\s*續上頁\s*[）)]\s*)?(?:(表|Table)\s*(\d{1,2}|[一二三四五六七八九十]+)\s*[、.．:：,，\s]|(表|Table)\s*[、.．:：,，])/i; // 舊刊「表、病人特徵…」沒有編號
const CONT_NEXT_RE = /^[（(]\s*接下頁\s*[）)]$/;
const NOTE_RE = /^([a-z][.．:：]\s*|註\s*[\d一二三四五六七八九十]*\s*[：:.]?\s*|\*+\s*)\S/;
const NUMERIC_RE = /^[\d.,%()（）\-–—\s/]+$/;
const isCJK = (s) => /[一-鿿]/.test(s);
const joinCell = (a, b) => (!a ? b : !b ? a : (isCJK(a.slice(-1)) && isCJK(b[0]) ? a + b : `${a} ${b}`));

/**
 * 表格區塊的行 → Markdown 表格。做法（第四十六輪改成「儲存格為主、欄起點為輔」，因為 pdf.js 常把一格切成好幾個字塊，
 * 像「案 1」「2024/12/05：30 IU/L」，若每個字塊都當欄起點，欄位會被切碎）：
 *  - 單位是儲存格（字塊間距超過 0.6 em 才切開）；
 *  - 欄的起點：把儲存格左緣聚類（相差不到一個字高算同一群），至少兩行都從那裡起頭的才算一欄；另外，儲存格「內部」的字塊起點
 *    若有四成以上的行都在同一位置（像「33 (45.2) 24 (32.9)」這種只隔半個字的緊密數字欄），也算一欄，儲存格在那裡切開；
 *  - 每個字塊依「中心點落在哪一欄的範圍」歸欄（置中的表頭就會落在它蓋住的那一欄）；兩個相鄰的欄若沒有任何一行同時有字
 *    （表頭置中、數字靠右造成的「同一欄兩個起點」），併成一欄；寬到蓋住兩欄以上錨點的文字表頭另列為「表頭上層」；
 *  - 第一個「資料列」（第一欄有字、其餘有以數字起頭的格）之前的行都是表頭，逐欄合併（多行表頭、直排單字表頭）；
 *  - 資料列之間「只有列名」與「只有數值」的行是折行：同一段裡兩者都有就合成一列（列名直排置中、數值多行），只有數值就是上一列的續行（<br>）。
 * @param {{ text: string, cells: { text: string, x0: number, x1: number, items?: { text: string, x0: number, x1: number, size: number, gap?: number }[] }[] }[]} rows
 * @returns {{ markdown: string, spans: string[] } | null}
 */
export function tableToMarkdown(rows) {
  const multi = rows.filter((r) => r.cells.length >= 2);
  if (multi.length < 2) return null;
  const cellItems = (c) => (c.items?.length ? c.items : [{ text: c.text, x0: c.x0, x1: c.x1, size: 10, gap: 0 }]);
  const everyItem = rows.flatMap((r) => r.cells.flatMap(cellItems));
  const tol = Math.max(4, everyItem.reduce((a, p) => a + (p.size || 10), 0) / Math.max(1, everyItem.length));
  // 欄起點：儲存格左緣（至少兩行）或儲存格內緊密字塊的左緣（至少四成的行，且至少三行）
  const starts = [];
  rows.forEach((r, ri) => r.cells.forEach((c) => {
    const its = cellItems(c);
    starts.push({ x: its[0].x0, ri, kind: 'cell' });
    for (let k = 1; k < its.length; k++) if ((its[k].gap ?? (its[k].x0 - its[k - 1].x1)) >= (its[k].size || 10) * 0.25) starts.push({ x: its[k].x0, ri, kind: 'item' });
  }));
  starts.sort((a, b) => a.x - b.x);
  const clusters = [];
  for (const st of starts) {
    const c = clusters[clusters.length - 1];
    if (c && st.x - c.max <= tol) { c.max = st.x; c[st.kind].add(st.ri); c.sum += st.x; c.n++; } else clusters.push({ min: st.x, max: st.x, cell: new Set(), item: new Set(), sum: 0, n: 0 }), clusters[clusters.length - 1][st.kind].add(st.ri), (clusters[clusters.length - 1].sum += st.x), clusters[clusters.length - 1].n++;
  }
  const need = Math.max(3, Math.ceil(rows.length * 0.4));
  let cols = clusters.filter((c) => c.cell.size >= 2 || c.item.size >= need).map((c) => ({ start: c.min, anchors: [c.sum / c.n] }));
  if (cols.length < 2) return null;
  // 每行拆成字塊群：儲存格在「欄起點」處切開，其餘字塊留在原格
  const piecesOf = (r) => {
    const out = [];
    for (const c of r.cells) {
      const its = cellItems(c);
      let cur = null;
      for (let k = 0; k < its.length; k++) {
        const p = its[k];
        const atCol = k > 0 && (p.gap ?? (p.x0 - its[k - 1].x1)) >= (p.size || 10) * 0.25 && cols.some((col) => Math.abs(col.start - p.x0) <= tol / 2);
        const sp = (p.gap ?? 0) > (p.size || 10) * 0.25 || (cur && /[A-Za-z0-9]$/.test(cur.text) && /^[A-Za-z0-9]/.test(p.text) && (p.gap ?? 0) > (p.size || 10) * 0.1);
        if (cur && !atCol) { cur.text += (sp ? ' ' : '') + p.text; cur.x1 = p.x1; } else { cur = { text: p.text, x0: p.x0, x1: p.x1 }; out.push(cur); }
      }
    }
    return out.map((p) => ({ ...p, text: p.text.trim() })).filter((p) => p.text);
  };
  const rowPieces = rows.map(piecesOf);
  // 歸欄：左緣剛好在某欄起點上（靠左對齊的文字）就是那一欄；否則看中心點落在哪一欄的範圍（置中的表頭、靠右的數字）
  const colOf = (p) => {
    const left = cols.findIndex((c) => Math.abs(c.start - p.x0) <= tol / 2);
    if (left >= 0) return left;
    const mid = (p.x0 + p.x1) / 2; let k = 0; for (let i = 1; i < cols.length; i++) if (mid >= cols[i].start - tol / 2) k = i; return k;
  };
  const build = (withSpans) => {
    const spans = [];
    const grid = rowPieces.map((ps, ri) => {
      const g = new Array(cols.length).fill('');
      for (const p of ps) {
        if (withSpans && rows[ri].cells.length < cols.length && !NUMERIC_RE.test(p.text)) {
          const hit = cols.filter((c) => c.anchors.some((a) => a >= p.x0 - tol / 2 && a <= p.x1 - tol / 2)).length;
          if (hit >= 2) { spans.push(p.text); continue; }
        }
        const i = colOf(p);
        g[i] = joinCell(g[i], p.text);
      }
      return g;
    });
    return { grid, spans };
  };
  // 併欄：相鄰兩欄沒有任何一行同時有字 → 同一欄（表頭置中、數字靠右的兩個起點）
  for (;;) {
    const { grid } = build(false);
    const i = cols.findIndex((c, k) => k + 1 < cols.length && !grid.some((g) => g[k] && g[k + 1]));
    if (i < 0) break;
    cols.splice(i, 2, { start: cols[i].start, anchors: [...cols[i].anchors, ...cols[i + 1].anchors] });
  }
  if (cols.length < 2) return null;
  const { grid, spans } = build(true);
  const n = cols.length;
  const numeric = (v) => /\d/.test(v) && (NUMERIC_RE.test(v) || /^\d/.test(v));
  const isData = (g) => g[0] && g.filter(Boolean).length >= 2 && g.slice(1).some(numeric);
  let firstData = grid.findIndex(isData);
  const hasData = firstData >= 0;
  if (!hasData) firstData = Math.min(1, grid.length);
  const header = new Array(n).fill('');
  grid.slice(0, firstData).forEach((g) => g.forEach((v, i) => { header[i] = joinCell(header[i], v); }));
  const body = [];
  const addBr = (row, g) => g.forEach((v, k) => { if (k > 0 && v) row[k] = row[k] ? `${row[k]}<br>${v}` : v; });
  // 折行：同一段（兩個完整列之間）裡「只有列名」的行依 y 距離歸給最近的「只有數值」的行（列名直排置中在數值上下兩行時最常見）；
  // 沒有列名可歸的數值行是上一列的續行；沒有數值的列名行就照列印出（分組列）
  let block = [];
  const flush = () => {
    if (!block.length) return;
    const yOf = (b) => rows[b.ri]?.y ?? b.ri;
    const vals = block.filter((b) => b.g.slice(1).some(Boolean));
    const labels = block.filter((b) => b.g[0] && b.g.slice(1).every((v) => !v));
    if (!vals.length) { body.push(...labels.map((b) => [...b.g])); block = []; return; }
    const owner = new Map(vals.map((v) => [v, []]));
    for (const L of labels) {
      let best = null;
      for (const v of vals) { const d = Math.abs(yOf(v) - yOf(L)); if (!best || d < best.d) best = { v, d }; }
      owner.get(best.v).push(L);
    }
    for (const v of vals) {
      const mine = owner.get(v);
      if (mine.length) { const row = new Array(n).fill(''); row[0] = mine.map((b) => b.g[0]).reduce(joinCell, ''); addBr(row, v.g); body.push(row); continue; }
      const prev = body[body.length - 1];
      if (prev) addBr(prev, v.g); else body.push([...v.g]);
    }
    block = [];
  };
  grid.slice(firstData).forEach((g, k) => {
    const ri = firstData + k;
    if (g[0] && g.slice(1).some(Boolean)) { flush(); body.push([...g]); } else if (g.some(Boolean)) block.push({ g, ri });
  });
  flush();
  const esc = (v) => String(v ?? '').replace(/\|/g, '\\|');
  const line = (g) => `| ${g.map(esc).join(' | ')} |`;
  const head = header.some(Boolean) ? header : body.shift() ?? header;
  // 沒有任何資料列、而且儲存格多半是單一個字（直排表頭）：這是跨頁表格在前一頁只剩表頭的殘段，內容由「(續上頁)」那段提供
  const cellsAll = grid.flat().filter(Boolean);
  if (!body.length || (!hasData && cellsAll.filter((v) => v.length === 1).length * 2 >= cellsAll.length)) return { markdown: '', spans: [], hasData };
  const md = [line(head), `| ${cols.map(() => '---').join(' | ')} |`, ...body.map(line)].join('\n');
  return { markdown: md, spans: [...new Set(spans)], hasData };
}

/**
 * 找出一頁裡的表格區塊：「表 N」圖說之後連續的多儲存格行（與其間的短折行、表下的 a. 註解），直到「(接下頁)」或一般正文。
 * @param {{ text: string, cells: { text: string, x0: number, x1: number }[] }[]} lines
 * @returns {{ start: number, end: number, caption: string, markdown: string, notes: string[], spans: string[] }[]}
 */
export function tablesFromLines(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (!TABLE_CAP_RE.test(lines[i].text)) continue;
    const rows = [];
    const notes = [];
    let continued = false;
    let j = i + 1;
    for (; j < lines.length; j++) {
      const L = lines[j];
      const t = L.text.trim();
      if (CONT_NEXT_RE.test(t)) { j++; continued = true; break; }
      if (rows.length && NOTE_RE.test(t) && L.cells.length <= 2) { notes.push(t); continue; }
      if (notes.length) break;
      if (TABLE_CAP_RE.test(t)) break;
      if (L.cells.length >= 2) { rows.push(L); continue; }
      const next = lines[j + 1];
      // 單一儲存格的短行：表頭上層、折行的列名或折行的儲存格（最多連續兩行），後面要接得回多儲存格的行
      if (L.cells.length === 1 && t.length <= 40 && next) {
        const n2 = lines[j + 2];
        const ok = (x) => x && (x.cells.length >= 2 || (rows.length > 0 && (NOTE_RE.test(x.text.trim()) || CONT_NEXT_RE.test(x.text.trim()))));
        if (ok(next) || (rows.length > 0 && next.cells.length === 1 && next.text.trim().length <= 40 && ok(n2))) { rows.push(L); continue; }
      }
      break;
    }
    const table = tableToMarkdown(rows);
    if (!table) continue;
    // 跨頁表格在前一頁只剩表頭（沒有任何資料列）：表格內容交給下一頁「(續上頁)」那段，這裡只留圖說
    const markdown = continued && !table.hasData ? '' : table.markdown;
    out.push({ start: i, end: j, caption: lines[i].text.trim(), markdown, notes, spans: markdown ? table.spans : [] });
    i = j - 1;
  }
  return out;
}

const CHART_CAP_RE = /^\s*(圖|Figure|Fig\.)\s*(\d{1,2}|[一二三四五六七八九十]+)\s*[、.．:：,，\s]/i;
const AXIS_RE = /^[\d.,%\s\-–]+$/;
/**
 * 向量圖（Excel 圖表直接貼進 Word）的文字層會跟正文混在一起：座標軸刻度、圖例、資料標籤一行一行散在「圖 N」圖說上方。
 * 認法：圖說往上連續的短行（≤30 字）裡，有三行以上只有數字（刻度）→ 整段是圖內文字，略過並留一個標記行給 splitManuscript 提醒。
 * @param {{ text: string }[]} lines
 * @returns {{ skip: Set<number>, markerAt: Map<number, number> }}
 */
export function chartTextLines(lines) {
  const skip = new Set();
  const markerAt = new Map();
  lines.forEach((l, i) => {
    if (!CHART_CAP_RE.test(l.text)) return;
    let j = i - 1;
    const short = (l) => l.text.trim().replace(/\s{2,}/g, ' ').length <= 30; // 圖內文字同一行常有好幾塊（刻度＋圖例），只算字數不算版面空白
    while (j >= 0 && short(lines[j]) && !CHART_CAP_RE.test(lines[j].text) && !TABLE_CAP_RE.test(lines[j].text) && !skip.has(j)) j--;
    const block = lines.slice(j + 1, i);
    if (block.filter((x) => AXIS_RE.test(x.text.trim())).length < 3) return;
    for (let k = j + 1; k < i; k++) skip.add(k);
    markerAt.set(j + 1, block.length);
  });
  return { skip, markerAt };
}

/** 行 → 這一頁的文字；左側縮排依 x 補空白（splitManuscript 會自己 trim，縮排只是讓人讀稿件欄時看得出版面）；表格區塊改輸出 Markdown 表格 */
export function pageText(lines, { indentUnit = 6, tables = true } = {}) {
  const minX = Math.min(...lines.map((l) => l.x), Infinity);
  const indent = (l) => ' '.repeat(Number.isFinite(minX) ? Math.min(20, Math.round((l.x - minX) / indentUnit)) : 0);
  const blocks = tables ? tablesFromLines(lines) : [];
  const chart = chartTextLines(lines);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (chart.skip.has(i)) { if (chart.markerAt.has(i)) out.push(`〔圖內文字 ${chart.markerAt.get(i)} 行已略過〕`); continue; }
    const b = blocks.find((x) => x.start === i);
    if (b) {
      out.push(b.caption, ...(b.markdown ? b.markdown.split('\n') : []));
      if (b.spans.length) out.push(`（表頭上層：${b.spans.join('、')}）`);
      out.push(...b.notes);
      i = b.end - 1;
      continue;
    }
    out.push(`${indent(lines[i])}${lines[i].text}`);
  }
  return out.join('\n');
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
export function describeExtraction({ pages = 0, chars = 0, assigned = [], leftovers = [], skipped = [], tables = 0 } = {}) {
  const parts = [`讀到 ${pages} 頁、約 ${chars} 字`];
  if (tables) parts.push(`${tables} 個表格已還原成表格內容`);
  if (assigned.length) parts.push(`${assigned.length} 張圖已配到圖說（${assigned.map((a) => `圖 ${a.no}`).join('、')}）`);
  if (leftovers.length) parts.push(`另有 ${leftovers.length} 張圖沒有對到圖說（下方可指定）`);
  if (skipped.length) parts.push(`略過 ${skipped.length} 張小圖或重複的刊頭圖`);
  return `${parts.join('；')}。`;
}
