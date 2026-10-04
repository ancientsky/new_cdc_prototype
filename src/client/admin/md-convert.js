// 上架編輯器的轉換核心（第八輪 Y2）：純函式、零依賴、不碰 DOM，瀏覽器與 Node 測試共用。
//   htmlToMd(html)            所見即所得（或貼上的 Word／網頁 HTML）→ Markdown（支援子集見下）
//   mdToHtml(md, {marked})    Markdown → 白名單淨化後的 HTML（marked 由呼叫端傳入：瀏覽器用 /vendor/marked.min.js，Node 測試用 node_modules）
//   sanitizeHtml(html)        白名單淨化（自寫小型 HTML 解析器，不靠 DOMParser，所以 Node 也能跑）
// 支援子集：h1–h4（h5／h6 併入 h4）、p、strong／b、em／i、del／s、ul／ol（含巢狀、Word 清單）、a、img、
//          table（thead／tbody，對齊忽略）、blockquote、hr、br、code／pre。
// 一律清掉：span／font／style／class／id／on*、Word 的 mso 註解與條件註解、script／style／iframe 等。

// ───────────────────────── HTML 解析 ─────────────────────────
const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', ensp: '\u2002', emsp: '\u2003', thinsp: '\u2009', shy: '',
  mdash: '—', ndash: '–', hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', sbquo: '‚', bdquo: '„', bull: '•', middot: '·',
  copy: '©', reg: '®', trade: '™', times: '×', divide: '÷', deg: '°', plusmn: '±', laquo: '«', raquo: '»', sect: '§', para: '¶',
  euro: '€', yen: '¥', pound: '£', cent: '¢', frac12: '½', frac14: '¼', frac34: '¾', larr: '←', rarr: '→', uarr: '↑', darr: '↓', zwnj: '', zwj: '',
};
/** 解 HTML 實體（具名常用＋數字）。不認得的原樣保留。 */
export function decodeEntities(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, e) => {
    if (e[0] === '#') {
      const cp = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      if (!Number.isFinite(cp) || cp <= 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return '\ufffd';
      return String.fromCodePoint(cp);
    }
    const v = NAMED[e] ?? NAMED[e.toLowerCase()];
    return v === undefined ? m : v;
  });
}

const VOID = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'col', 'wbr', 'area', 'base', 'embed', 'param', 'source', 'track']);
const RAW = new Set(['script', 'style', 'textarea', 'title', 'xmp', 'noscript']);
/** 連內容一起丟掉的標籤（Word／網頁貼上常帶的雜物與危險標籤） */
const DROP = new Set(['script', 'style', 'head', 'title', 'meta', 'link', 'xml', 'noscript', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'template', 'svg', 'math', 'canvas', 'button', 'input', 'select', 'textarea', 'option', 'audio', 'video', 'form', 'base', 'param', 'source', 'track', 'xmp']);
const BLOCKISH = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'blockquote', 'pre', 'hr', 'dl', 'dt', 'dd', 'section', 'article', 'aside', 'header', 'footer', 'main', 'nav', 'address', 'figure', 'figcaption', 'fieldset', 'details', 'summary', 'center', 'body', 'html', 'caption']);
const MAX_DEPTH = 200;

const TAG_RE = /<(\/?)([a-zA-Z][^\s/>]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/y;
const ATTR_RE = /([^\s=/"'<>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

function parseAttrs(s) {
  const attrs = {};
  ATTR_RE.lastIndex = 0;
  let m;
  while ((m = ATTR_RE.exec(s))) {
    const k = m[1].toLowerCase();
    if (k in attrs) continue;
    attrs[k] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return attrs;
}

/** 解析成簡單樹：{t:'el',tag,attrs,children,parent} | {t:'text',text}。容錯：不成對標籤、Word 條件註解、未封閉的 p／li／td。 */
export function parseHtml(src) {
  src = String(src ?? '');
  const root = { t: 'el', tag: '#root', attrs: {}, children: [], parent: null };
  const stack = [root];
  const top = () => stack[stack.length - 1];
  const addText = (s) => {
    if (!s) return;
    const p = top();
    const last = p.children[p.children.length - 1];
    if (last && last.t === 'text') last.text += s; else p.children.push({ t: 'text', text: s, parent: p });
  };
  /** 由堆疊頂往下找 tag，遇到 barrier 停；找到就回傳其索引 */
  const findOpen = (tags, barriers) => {
    for (let i = stack.length - 1; i > 0; i--) {
      const tg = stack[i].tag;
      if (tags.has(tg)) return i;
      if (barriers.has(tg)) return -1;
    }
    return -1;
  };
  const SET = (...a) => new Set(a);
  const INLINE_TAIL = (i) => { for (let k = stack.length - 1; k > i; k--) if (BLOCKISH.has(stack[k].tag)) return false; return true; };
  const autoClose = (tag) => {
    let i = -1;
    if (tag === 'li') i = findOpen(SET('li'), SET('ul', 'ol', 'table', 'menu'));
    else if (tag === 'dt' || tag === 'dd') i = findOpen(SET('dt', 'dd'), SET('dl'));
    else if (tag === 'td' || tag === 'th') i = findOpen(SET('td', 'th'), SET('tr', 'table'));
    else if (tag === 'tr') i = findOpen(SET('tr'), SET('table', 'thead', 'tbody', 'tfoot'));
    else if (tag === 'thead' || tag === 'tbody' || tag === 'tfoot') i = findOpen(SET('thead', 'tbody', 'tfoot'), SET('table'));
    else if (BLOCKISH.has(tag) && !['td', 'th', 'tr', 'thead', 'tbody', 'tfoot', 'caption'].includes(tag)) {
      const j = findOpen(SET('p'), SET('td', 'th', 'li', 'table', 'blockquote', 'button'));
      if (j > 0 && INLINE_TAIL(j)) i = j;
    }
    if (i > 0) stack.length = i;
    // tr 開啟前若 td／th 還開著（<td>a<tr>）
    if ((tag === 'tr' || tag === 'thead' || tag === 'tbody' || tag === 'tfoot')) {
      const j = findOpen(SET('td', 'th'), SET('table'));
      if (j > 0) stack.length = j;
      const k = findOpen(SET('tr'), SET('table'));
      if (k > 0 && tag !== 'tr') stack.length = k;
    }
  };

  let i = 0;
  const n = src.length;
  while (i < n) {
    const lt = src.indexOf('<', i);
    if (lt < 0) { addText(decodeEntities(src.slice(i))); break; }
    if (lt > i) addText(decodeEntities(src.slice(i, lt)));
    if (src.startsWith('<!--', lt)) { const e = src.indexOf('-->', lt + 4); i = e < 0 ? n : e + 3; continue; }
    if (src[lt + 1] === '!' || src[lt + 1] === '?') { const e = src.indexOf('>', lt); i = e < 0 ? n : e + 1; continue; } // <!doctype>、<![if !supportLists]>、<?xml …?>
    TAG_RE.lastIndex = lt;
    const m = TAG_RE.exec(src);
    if (!m) { addText('<'); i = lt + 1; continue; }
    i = lt + m[0].length;
    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    if (closing) {
      for (let k = stack.length - 1; k > 0; k--) if (stack[k].tag === tag) { stack.length = k; break; }
      continue;
    }
    let attrSrc = m[3];
    const selfClosing = /\/\s*$/.test(attrSrc);
    if (selfClosing) attrSrc = attrSrc.replace(/\/\s*$/, '');
    autoClose(tag);
    const el = { t: 'el', tag, attrs: parseAttrs(attrSrc), children: [], parent: top() };
    top().children.push(el);
    if (RAW.has(tag) && !selfClosing) {
      const re = new RegExp(`</${tag.replace(/[^a-z0-9]/g, '')}[\\s>]`, 'i');
      const rest = src.slice(i);
      const mm = re.exec(rest);
      const body = mm ? rest.slice(0, mm.index) : rest;
      if (body) el.children.push({ t: 'text', text: body, parent: el });
      i += mm ? mm.index : rest.length;
      const e = src.indexOf('>', i);
      i = e < 0 ? n : e + 1;
      continue;
    }
    if (!VOID.has(tag) && !selfClosing && stack.length < MAX_DEPTH) stack.push(el);
  }
  return root;
}

const isEl = (n, ...tags) => n.t === 'el' && (!tags.length || tags.includes(n.tag));
const styleOf = (n) => String(n.attrs?.style ?? '').toLowerCase().replace(/\s+/g, '');
const textOf = (n) => (n.t === 'text' ? n.text : n.children.map(textOf).join(''));
const hasBlockDesc = (n) => n.t === 'el' && n.children.some((c) => c.t === 'el' && !DROP.has(c.tag) && (BLOCKISH.has(c.tag) || hasBlockDesc(c)));

// ───────────────────────── Word 清單 → ul／ol ─────────────────────────
function listInfo(p) {
  const st = styleOf(p);
  if (!/mso-list:/.test(st) || /mso-list:none/.test(st)) return null;
  const lv = /level(\d+)/.exec(st);
  return { level: lv ? Math.max(1, Math.min(8, Number(lv[1]))) : 1 };
}
/** 找出並移除 Word 的項目符號（<span style="mso-list:Ignore">·</span>），回傳符號文字 */
function takeBullet(p) {
  let marker = null;
  const walk = (node) => {
    for (let i = 0; i < node.children.length; i++) {
      const c = node.children[i];
      if (c.t !== 'el') continue;
      if (/mso-list:ignore/.test(styleOf(c))) { marker = textOf(c); node.children.splice(i, 1); return true; }
      if (walk(c)) return true;
    }
    return false;
  };
  walk(p);
  if (marker == null) {
    const first = p.children.find((c) => c.t === 'text' && c.text.trim());
    const m = first && /^[\s\u00a0]*([·•o§Ø\-–—▪◦]|\d+[.)]|[a-zA-Z][.)]|[ivxIVX]+[.)])[\s\u00a0]+/.exec(first.text);
    if (m) { marker = m[1]; first.text = first.text.slice(m[0].length); }
  }
  return marker ?? '';
}
function mkEl(tag, parent, attrs = {}) { return { t: 'el', tag, attrs, children: [], parent }; }
/** 把同層連續的 Word 清單段落改寫成巢狀 ul／ol（就地修改） */
function fixWordLists(node) {
  if (node.t !== 'el') return;
  const out = [];
  let run = null; // {lists:[{el,ordered}], }
  const close = () => { run = null; };
  for (const c of node.children) {
    const info = c.t === 'el' && (c.tag === 'p' || c.tag === 'div') ? listInfo(c) : null;
    if (!info) {
      if (c.t === 'text' && !c.text.trim() && run) continue; // 清單項目間的空白不打斷
      close(); out.push(c); continue;
    }
    const marker = takeBullet(c);
    const ordered = /^(\d+|[a-zA-Z]|[ivxIVX]+)[.)]$/.test(marker.trim());
    if (!run) { run = { lists: [] }; }
    const L = info.level;
    while (run.lists.length > L) run.lists.pop();
    while (run.lists.length < L) {
      const el = mkEl(ordered ? 'ol' : 'ul', null);
      if (run.lists.length === 0) { el.parent = node; out.push(el); } else {
        const parentList = run.lists[run.lists.length - 1].el;
        let li = parentList.children[parentList.children.length - 1];
        if (!li) { li = mkEl('li', parentList); parentList.children.push(li); }
        el.parent = li; li.children.push(el);
      }
      run.lists.push({ el, ordered });
    }
    // 同層種類改變（項目符號變編號）→ 另開一個清單
    if (run.lists[L - 1].ordered !== ordered) {
      const el = mkEl(ordered ? 'ol' : 'ul', node);
      if (L === 1) out.push(el); else { const pl = run.lists[L - 2].el; const li = pl.children[pl.children.length - 1]; el.parent = li; li.children.push(el); }
      run.lists[L - 1] = { el, ordered };
    }
    const target = run.lists[L - 1].el;
    const li = mkEl('li', target);
    li.children = c.children; li.children.forEach((x) => { x.parent = li; });
    target.children.push(li);
  }
  node.children = out;
  node.children.forEach(fixWordLists);
}

// ───────────────────────── 網址 ─────────────────────────
/** 安全網址：允許 http(s)、mailto、tel、站內路徑、錨點、相對路徑；其餘（javascript:、data:、vbscript: …）一律不通過。 */
export function safeUrl(u) {
  const raw = decodeEntities(String(u ?? '')).trim();
  const probe = raw.replace(/[\u0000-\u0020\u007f-\u009f\u200b-\u200f\u2028\u2029\ufeff]/g, '');
  if (!probe) return '';
  const sch = /^([a-z][a-z0-9+.-]*):/i.exec(probe);
  if (sch) return /^(https?|mailto|tel)$/i.test(sch[1]) ? raw : '';
  return raw;
}
const encUrl = (u) => String(u).replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/[<>]/g, (c) => encodeURIComponent(c));

// ───────────────────────── HTML → Markdown ─────────────────────────
function escText(t, cell) {
  let s = t.replace(/[\\`*[\]<]/g, '\\$&')
    .replace(/(^|[^\p{L}\p{N}])_|_(?=[^\p{L}\p{N}]|$)/gu, (m) => m.replace('_', '\\_'))
    .replace(/&(?=#?[a-z0-9]+;)/gi, '&amp;')
    .replace(/~~/g, '\\~\\~');
  if (cell) s = s.replace(/\|/g, '\\|');
  return s;
}
/** 段落行首若長得像 Markdown 區塊語法就跳脫（# 標題、- + 清單、1. 編號、> 引用、--- 分隔、``` 圍欄） */
function escLineStarts(s) {
  return s.split('\n').map((l) => l
    .replace(/^(#{1,6})(?=\s|$)/, '\\$1')
    .replace(/^([-+])(?=\s|$)/, '\\$1')
    .replace(/^(\d+)([.)])(?=\s|$)/, '$1\\$2')
    .replace(/^>/, '\\>')
    .replace(/^(={2,}|-{3,}|_{3,})\s*$/, '\\$1')
    .replace(/^(`{3,}|~{3,})/, '\\$1')).join('\n');
}

const bodyStyleBold = (st) => /(?:^|[;\s])font-weight:\s*(bold|bolder|[6-9]00)\b/.test(st);
const bodyStyleItalic = (st) => /font-style:italic/.test(st);
const bodyStyleStrike = (st) => /text-decoration[a-z-]*:[^;]*line-through/.test(st);

function wrapMark(mark, inner) {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner);
  return m[2] ? `${m[1]}${mark}${m[2]}${mark}${m[3]}` : inner;
}
function codeSpan(text) {
  const t = text.replace(/\n+/g, ' ');
  if (!t.trim()) return '';
  const runs = t.match(/`+/g) ?? [];
  const n = runs.reduce((a, r) => Math.max(a, r.length), 0);
  const fence = '`'.repeat(n + 1);
  const pad = /^`|`$/.test(t) ? ' ' : '';
  return `${fence}${pad}${t}${pad}${fence}`;
}

function inline(nodes, ctx) {
  let out = '';
  for (const n of nodes) out += inlineNode(n, ctx);
  return out;
}
function inlineNode(n, ctx) {
  if (n.t === 'text') return escText(n.text.replace(/[\s\u00a0]+/g, ' '), ctx.cell);
  const tag = n.tag;
  if (DROP.has(tag)) return '';
  const st = styleOf(n);
  if (/mso-list:ignore/.test(st) || /display:none/.test(st) || /mso-hide:all/.test(st)) return '';
  const kids = (c = ctx) => inline(n.children, c);
  switch (tag) {
    case 'br': return ctx.cell ? '<br>' : '\\\n';
    case 'img': {
      let src = n.attrs['data-md-src'] || n.attrs.src || '';
      src = safeUrl(src);
      if (!src || /^(blob|data|file|cid):/i.test(src)) { ctx.dropped?.push(`圖片「${n.attrs.alt || n.attrs.src?.slice(0, 40) || ''}」不是已上傳的檔案，未轉入內文`); return ''; }
      const alt = String(n.attrs.alt ?? '').replace(/[\r\n]+/g, ' ').replace(/[\\[\]]/g, '\\$&').trim();
      return `![${alt}](${encUrl(src)})`;
    }
    case 'strong': case 'b': {
      if (tag === 'b' && /(?:^|[;\s])font-weight:\s*(normal|400)\b/.test(st)) return kids(); // 不把 mso-bidi-font-weight:normal 誤判成非粗體
      if (ctx.strong) return kids();
      return wrapMark('**', kids({ ...ctx, strong: true }));
    }
    case 'em': case 'i': case 'cite': case 'dfn': case 'var': {
      if (ctx.em) return kids();
      return wrapMark('*', kids({ ...ctx, em: true }));
    }
    case 'del': case 's': case 'strike': {
      if (ctx.del) return kids();
      return wrapMark('~~', kids({ ...ctx, del: true }));
    }
    case 'code': case 'kbd': case 'samp': case 'tt': return codeSpan(textOf(n));
    case 'a': {
      const href = safeUrl(n.attrs.href ?? '');
      const inner = kids();
      if (!href || /^javascript:/i.test(href)) return inner;
      if (!inner.trim()) return `<${encUrl(href)}>`;
      return `[${inner.replace(/\n/g, ' ')}](${encUrl(href)})`;
    }
    default: {
      // span／font／u／sup／sub／mark…：以 style 判斷粗斜體（Google Docs、網頁常見），其餘穿透
      let inner;
      const bold = bodyStyleBold(st) && !ctx.strong, ital = bodyStyleItalic(st) && !ctx.em, strike = bodyStyleStrike(st) && !ctx.del && tag !== 'u';
      const c2 = { ...ctx, ...(bold ? { strong: true } : {}), ...(ital ? { em: true } : {}), ...(strike ? { del: true } : {}) };
      inner = kids(c2);
      if (strike) inner = wrapMark('~~', inner);
      if (ital) inner = wrapMark('*', inner);
      if (bold) inner = wrapMark('**', inner);
      return inner;
    }
  }
}
/** 整理一個段落：收斂空白、去每行頭尾空白、去尾端換行、跳脫行首 */
function tidyInline(s) {
  return escLineStarts(s.replace(/ {2,}/g, ' ').split('\n').map((l) => l.replace(/^ +/, '').replace(/ +$/, '')).join('\n').replace(/^(\\?\n)+|(\\?\n)+$/g, '').replace(/(\\\n){2,}/g, '\\\n').replace(/\\$/g, (m, off, str) => (str[off - 1] === '\\' ? m : '')).trim());
}

function rawText(n) {
  if (n.t === 'text') return n.text;
  if (n.tag === 'br') return '\n';
  const inner = n.children.map(rawText).join('');
  return BLOCKISH.has(n.tag) && n.tag !== 'pre' ? `${inner}\n` : inner;
}

function listMd(node, ctx, depth) {
  const ordered = node.tag === 'ol';
  let num = ordered ? Math.max(0, parseInt(node.attrs.start ?? '1', 10) || 1) : 0;
  const items = [];
  for (const li of node.children) {
    if (li.t === 'text') continue;
    if (li.tag !== 'li') { // 不合法的巢狀（<ul><ul>…）→ 視為上一項的子清單
      if ((li.tag === 'ul' || li.tag === 'ol') && items.length) items[items.length - 1].push(listMd(li, ctx, depth + 1));
      continue;
    }
    const marker = ordered ? `${num++}. ` : '- ';
    const pad = ' '.repeat(marker.length);
    const parts = blockParts(li.children, { ...ctx, inList: true }, depth + 1); // [{kind,s}]
    let body = '';
    parts.forEach((p, k) => {
      if (k === 0) body = p.s;
      else body += (p.kind === 'list' && parts[k - 1].kind !== 'list') ? `\n${p.s}` : `\n\n${p.s}`;
    });
    if (!body.trim()) body = '';
    const lines = body.split('\n').map((l, k) => (k === 0 ? l : (l ? pad + l : l)));
    items.push([`${marker}${lines.join('\n')}`.replace(/\s+$/, '')]);
  }
  return items.map((a) => a.join('\n')).join('\n');
}

function cellMd(cell, ctx) {
  // 儲存格內容壓成單行：區塊之間用 <br>
  const parts = blockParts(cell.children, { ...ctx, cell: true }, 0).map((p) => p.s.replace(/\n+/g, '<br>'));
  return parts.join('<br>').replace(/(<br>)+$/g, '').replace(/^(<br>)+/g, '').replace(/(\\<br>|\\\n)/g, '<br>');
}
function tableMd(table, ctx) {
  const rows = [];
  const collect = (node) => {
    for (const c of node.children) {
      if (c.t !== 'el' || DROP.has(c.tag)) continue;
      if (c.tag === 'tr') {
        const cells = c.children.filter((x) => x.t === 'el' && (x.tag === 'td' || x.tag === 'th'));
        if (!cells.length) continue;
        rows.push(cells.map((x) => cellMd(x, ctx)));
      } else if (c.tag === 'thead' || c.tag === 'tbody' || c.tag === 'tfoot') collect(c);
      else if (c.tag === 'caption') continue;
      else if (hasBlockDesc(c)) collect(c);
    }
  };
  collect(table);
  if (!rows.length) return '';
  const cols = Math.max(...rows.map((r) => r.length));
  const pad = (r) => [...r, ...Array(cols - r.length).fill('')];
  const line = (r) => `| ${pad(r).map((x) => x || ' ').join(' | ')} |`;
  const out = [line(rows[0]), `| ${Array(cols).fill('---').join(' | ')} |`, ...rows.slice(1).map(line)];
  return out.join('\n');
}

/** 把一串子節點轉成區塊清單 [{kind:'text'|'list'|'other', s}] */
function blockParts(nodes, ctx, depth) {
  const parts = [];
  let run = [];
  const flush = () => {
    if (!run.length) return;
    const s = tidyInline(inline(run, ctx));
    run = [];
    if (s) parts.push({ kind: 'text', s });
  };
  const walk = (list) => {
    for (const n of list) {
      if (n.t === 'text') { run.push(n); continue; }
      if (DROP.has(n.tag)) continue;
      const st = styleOf(n);
      if (/display:none|mso-hide:all/.test(st)) continue;
      const tag = n.tag;
      if (/^h[1-6]$/.test(tag)) {
        flush();
        const lv = Math.min(4, Number(tag[1]));
        const s = tidyInline(inline(n.children, { ...ctx, strong: true })).replace(/\\\n/g, ' ');
        if (s) parts.push({ kind: 'other', s: ctx.cell || ctx.inList ? s : `${'#'.repeat(lv)} ${s}` });
      } else if (tag === 'ul' || tag === 'ol') {
        flush();
        const s = listMd(n, ctx, depth);
        if (s) parts.push({ kind: 'list', s });
      } else if (tag === 'table') {
        flush();
        if (ctx.cell) { const t = textOf(n).replace(/\s+/g, ' ').trim(); if (t) parts.push({ kind: 'text', s: escText(t, true) }); }
        else { const s = tableMd(n, ctx); if (s) parts.push({ kind: 'other', s }); }
      } else if (tag === 'blockquote') {
        flush();
        const inner = blockParts(n.children, { ...ctx, inQuote: true }, depth).map((p) => p.s).join('\n\n');
        if (inner.trim()) parts.push({ kind: 'other', s: inner.split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n') });
      } else if (tag === 'pre') {
        flush();
        const code = n.children.find((c) => c.t === 'el' && c.tag === 'code');
        const lang = (/language-([\w-]+)/.exec(code?.attrs.class ?? n.attrs.class ?? '') ?? [])[1] ?? '';
        const txt = rawText(n).replace(/\r/g, '').replace(/^\n/, '').replace(/\n+$/, '');
        if (txt.trim()) {
          const runs = txt.match(/`{3,}/g) ?? [];
          const f = '`'.repeat(Math.max(3, ...runs.map((r) => r.length + 1)));
          parts.push({ kind: 'other', s: `${f}${lang}\n${txt}\n${f}` });
        }
      } else if (tag === 'hr') {
        flush(); parts.push({ kind: 'other', s: '---' });
      } else if (tag === 'p' || tag === 'div' || tag === 'li' || tag === 'dt' || tag === 'dd' || tag === 'figcaption' || tag === 'caption' || tag === 'summary' || tag === 'address') {
        // Word 清單段落在 fixWordLists 已改寫；這裡處理一般段落。含區塊子孫的 div 穿透。
        if (hasBlockDesc(n)) { flush(); walk(n.children); flush(); } else { flush(); run = n.children.slice(); flush(); }
      } else if (BLOCKISH.has(tag) || (!['br', 'img'].includes(tag) && hasBlockDesc(n))) {
        flush(); walk(n.children); flush();
      } else {
        run.push(n);
      }
    }
  };
  walk(nodes);
  flush();
  return parts;
}

/**
 * HTML → Markdown。
 * opts.dropped：陣列，收集「沒轉進去」的東西（例如貼上的 data:／file: 圖片）供 UI 提示。
 */
export function htmlToMd(html, opts = {}) {
  const root = parseHtml(html);
  fixWordLists(root);
  const parts = blockParts(root.children, { dropped: opts.dropped }, 0);
  let out = '';
  parts.forEach((p, k) => { out += (k ? '\n\n' : '') + p.s; });
  return out.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
}

// ───────────────────────── 白名單淨化＋Markdown → HTML ─────────────────────────
const ALIAS = { b: 'strong', i: 'em', strike: 's', s: 'del', h5: 'h4', h6: 'h4' };
const ALLOW = new Set(['h1', 'h2', 'h3', 'h4', 'p', 'br', 'hr', 'strong', 'em', 'del', 'code', 'pre', 'blockquote', 'ul', 'ol', 'li', 'a', 'img', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'sup', 'sub']);
const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s) => escHtml(s).replace(/"/g, '&quot;');

function serialize(node, opts) {
  if (node.t === 'text') return escHtml(node.text);
  let tag = node.tag;
  if (DROP.has(tag)) return '';
  tag = ALIAS[tag] ?? tag;
  const kids = () => node.children.map((c) => serialize(c, opts)).join('');
  if (!ALLOW.has(tag)) return kids();
  const a = node.attrs;
  let attrs = '';
  if (tag === 'a') {
    const href = safeUrl(a.href ?? '');
    if (!href) return kids();
    const h = opts.href ? opts.href(href) : href;
    attrs = ` href="${escAttr(h)}"`;
    if (a.title) attrs += ` title="${escAttr(a.title)}"`;
  } else if (tag === 'img') {
    const src = safeUrl(a.src ?? '');
    if (!src) return '';
    let finalSrc = src, orig = null;
    if (opts.imgSrc) { const r = opts.imgSrc(src); if (r) { finalSrc = r.src; orig = r.orig ?? src; } }
    attrs = ` src="${escAttr(finalSrc)}" alt="${escAttr(a.alt ?? '')}"`;
    if (orig) attrs += ` data-md-src="${escAttr(orig)}"`;
    if (a.title) attrs += ` title="${escAttr(a.title)}"`;
    if (/^\d{1,5}$/.test(a.width ?? '')) attrs += ` width="${a.width}"`;
    if (/^\d{1,5}$/.test(a.height ?? '')) attrs += ` height="${a.height}"`;
    return `<img${attrs}>`;
  } else if (tag === 'ol' && /^\d{1,6}$/.test(a.start ?? '') && a.start !== '1') attrs = ` start="${a.start}"`;
  else if (tag === 'code' && /^language-[\w-]+$/.test(a.class ?? '')) attrs = ` class="${a.class}"`;
  if (tag === 'br' || tag === 'hr') return `<${tag}>`;
  return `<${tag}${attrs}>${kids()}</${tag}>`;
}
/**
 * 白名單淨化：只留支援子集的標籤與安全屬性；script／style／iframe 連內容丟掉，未知標籤只留文字，
 * on*／style／class／javascript:／data: 一律移除。
 * opts.imgSrc(src) → {src, orig}｜null：預覽時把 /files/… 換成 blob URL（原路徑存 data-md-src，轉回 Markdown 時還原）。
 * opts.href(href)：改寫連結（例如加 basePath）。
 */
export function sanitizeHtml(html, opts = {}) {
  const root = parseHtml(html);
  return root.children.map((c) => serialize(c, opts)).join('');
}

/** 與站上 scripts/lib/markdown.mjs 相同的 CJK 粗體修正：`常見**咳嗽**、` 兩側都是非空白字元時 CommonMark 不開啟強調。 */
export function cjkStrong(src) {
  return String(src).split(/(`[^`\n]*`)/).map((seg, i) => (i % 2 ? seg : seg.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>'))).join('');
}

/**
 * Markdown → 淨化 HTML。marked 由呼叫端提供（需有 parse(src, opts)）。
 * 沒有 marked 時退回極簡實作（段落＋跳脫），確保 vendor 檔載入失敗時編輯器仍可用。
 */
export function mdToHtml(md, opts = {}) {
  const src = String(md ?? '');
  const marked = opts.marked;
  let raw;
  if (marked && typeof marked.parse === 'function') raw = marked.parse(cjkStrong(src), { gfm: true, breaks: false, async: false });
  else raw = src.split(/\n{2,}/).filter((p) => p.trim()).map((p) => `<p>${escHtml(p).replace(/\n/g, '<br>')}</p>`).join('\n');
  return sanitizeHtml(raw, opts);
}

/** 純文字（無 HTML）貼上：看起來像 Markdown 就當 Markdown，否則空行分段、單換行變 <br>。 */
export function plainTextToHtml(text, opts = {}) {
  const t = String(text ?? '').replace(/\r\n?/g, '\n');
  if (/^(#{1,6} |[-*+] |\d+[.)] |> |\|.*\||```)/m.test(t)) return mdToHtml(t, opts);
  return t.split(/\n{2,}/).filter((p) => p.trim()).map((p) => `<p>${escHtml(p.trim()).replace(/\n/g, '<br>')}</p>`).join('');
}

/** 內文中所有 Markdown 圖片／連結／HTML img 對 /files/ 的引用（供預覽換 blob、預檢比對）。 */
export function fileRefs(md) {
  const out = [];
  const s = String(md ?? '');
  const re = /(!?)\[([^\]]*)\]\(\s*<?(\/files\/([^/\s)>]+)\/([^\s)>?#]+))[^)]*\)|<img\b[^>]*?\bsrc=["']?(\/files\/([^/\s"'>]+)\/([^\s"'>?#]+))/gi;
  let m;
  while ((m = re.exec(s))) {
    if (m[3]) out.push({ path: m[3], id: decodeURIComponent(m[4]), file: decodeURIComponent(m[5]), image: m[1] === '!', alt: m[2] });
    else out.push({ path: m[6], id: decodeURIComponent(m[7]), file: decodeURIComponent(m[8]), image: true, alt: '' });
  }
  return out;
}
