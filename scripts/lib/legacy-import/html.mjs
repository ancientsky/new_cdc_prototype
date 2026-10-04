// 舊站 HTML 的樹狀操作：選擇器（#id、.class、tag、tag.class，逗號分隔）、序列化、Word 殘留統計。
// 解析器直接用上架編輯器的 md-convert.js（parseHtml），Node 與瀏覽器共用同一份，轉換行為一致。
import { parseHtml, decodeEntities } from '../../../src/client/admin/md-convert.js';

export { parseHtml, decodeEntities };

export const isEl = (n) => n && n.t === 'el';
export const textOf = (n) => (n.t === 'text' ? n.text : (n.children ?? []).map(textOf).join(''));
export const classesOf = (el) => String(el.attrs?.class ?? '').split(/\s+/).filter(Boolean);

/** 單一簡易選擇器是否命中元素 */
export function matchSimple(el, sel) {
  const m = /^([a-z][a-z0-9]*)?(?:#([\w-]+))?((?:\.[\w-]+)*)$/i.exec(sel.trim());
  if (!m || !isEl(el)) return false;
  const [, tag, id, cls] = m;
  if (tag && el.tag !== tag.toLowerCase()) return false;
  if (id && el.attrs?.id !== id) return false;
  if (cls) {
    const have = new Set(classesOf(el));
    for (const c of cls.split('.').filter(Boolean)) if (!have.has(c)) return false;
  }
  return true;
}
const selList = (sel) => (Array.isArray(sel) ? sel : String(sel).split(',')).map((s) => s.trim()).filter(Boolean);
export const matches = (el, sel) => selList(sel).some((s) => matchSimple(el, s));

/** 先序走訪所有元素 */
export function* walkEls(node) {
  for (const c of node.children ?? []) {
    if (!isEl(c)) continue;
    yield c;
    yield* walkEls(c);
  }
}
export const findAll = (root, sel) => [...walkEls(root)].filter((el) => matches(el, sel));
export const findFirst = (root, sel) => findAll(root, sel)[0] ?? null;
/** 依序嘗試每個選擇器，回傳第一個有命中的元素 */
export function firstOf(root, sels) {
  for (const s of selList(sels)) { const el = findFirst(root, s); if (el) return el; }
  return null;
}

export function removeNode(n) {
  const p = n.parent;
  if (!p) return;
  const i = p.children.indexOf(n);
  if (i >= 0) p.children.splice(i, 1);
}

const escText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s) => escText(s).replace(/"/g, '&quot;');
const VOID = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'col', 'wbr']);

/** 節點 → HTML 字串（給 htmlToMd 吃；script／style 內容不保留） */
export function serialize(n) {
  if (n.t === 'text') return escText(n.text);
  if (n.tag === 'script' || n.tag === 'style') return '';
  const attrs = Object.entries(n.attrs ?? {}).map(([k, v]) => ` ${k}="${escAttr(v)}"`).join('');
  if (VOID.has(n.tag)) return `<${n.tag}${attrs}>`;
  return `<${n.tag}${attrs}>${(n.children ?? []).map(serialize).join('')}</${n.tag}>`;
}
export const innerHtml = (n) => (n.children ?? []).map(serialize).join('');

/** 從節點的後代切一段（保留順序）成為新的 root，供分段轉換。 */
export function makeRoot(children) {
  const root = { t: 'el', tag: '#root', attrs: {}, children: [], parent: null };
  for (const c of children) { c.parent = root; root.children.push(c); }
  return root;
}

/** Word 貼上殘留統計：Mso* class、mso- 樣式、o:p 之類帶命名空間的標籤、lang 屬性 */
export function wordStats(root) {
  let elements = 0, namespaced = 0, classes = 0, styles = 0;
  for (const el of walkEls(root)) {
    let hit = false;
    if (/^mso/i.test(el.attrs?.class ?? '') || /\bMso[A-Z]/.test(el.attrs?.class ?? '')) { classes++; hit = true; }
    if (/mso-/i.test(el.attrs?.style ?? '')) { styles++; hit = true; }
    if (el.tag.includes(':')) { namespaced++; hit = true; }
    if (hit) elements++;
  }
  return { elements, namespaced, classes, styles };
}

/** 表格複雜度：rowspan／colspan、巢狀表格、無表頭 */
export function tableProblems(root) {
  const out = [];
  for (const t of findAll(root, 'table')) {
    const cells = findAll(t, 'td,th');
    const span = cells.filter((c) => Number(c.attrs?.rowspan ?? 1) > 1 || Number(c.attrs?.colspan ?? 1) > 1).length;
    const nested = findAll(t, 'table').length;
    if (span) out.push(`合併儲存格 ${span} 格`);
    if (nested) out.push('巢狀表格');
  }
  return out;
}

export const plainText = (md) => String(md ?? '')
  .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
  .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
  .replace(/^#{1,6}\s+/gm, '')
  .replace(/^\s*[-+*]\s+/gm, '')
  .replace(/^\s*\d+\.\s+/gm, '')
  .replace(/\|/g, ' ')
  .replace(/^-{3,}$/gm, '')
  .replace(/\\([\\`*[\]<>_~#-])/g, '$1')
  .replace(/[*_`~>]/g, '')
  .replace(/<br>/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();
