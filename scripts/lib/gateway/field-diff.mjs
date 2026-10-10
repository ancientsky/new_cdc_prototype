// @ts-check
// 白話欄位差異（第三十輪）：審核人看到的不是 git diff，而是「摘要：第 2 句改了」這種句子，加上逐欄的改前／改後對照。
//
// 做法：逐欄比較「線上版」（main 上的檔）與「送審版」。
//   - 文字欄位切成句子（。！？；與換行），以最長共同子序列（LCS）對齊，連續的刪＋增配成「改了」；改了的句子再做字元層級對照，標出改動的字。
//   - 清單（關鍵字、對象…）說「新增／移除」哪些；日期、數字、選項說「由 A 改為 B」。
//   - 提供語言、內容區塊（blocks／sections）逐項說明；其他複雜欄位退回「已修改」並附前後內容。
// 回傳純資料（不含 HTML），由瀏覽器端以 textContent 組畫面，避免任何 HTML 注入。
import { labelOf } from './validate-item.mjs';

const IGNORE = new Set(['__file', 'sourceHash', 'gov', 'status']);
const ORDER = ['title', 'question', 'summary', 'answerMarkdown', 'bodyMarkdown', 'clarificationMarkdown', 'introMarkdown', 'abstractMarkdown', 'machineReadableMarkdown', 'blocks', 'sections', 'owner', 'audience', 'tasks', 'basedOn', 'keywords', 'languages', 'publishAt', 'urgent'];
const LANG = { 'zh-TW': '中文', en: '英文', ja: '日文', tl: '他加祿文', vi: '越南文', id: '印尼文', th: '泰文' };
const LSTAT = { source: '正本', reviewed: '已複核譯文', machine: '機器翻譯', pending: '待翻譯', none: '不提供' };

export function splitSentences(text) {
  return String(text ?? '').split(/(?<=[。！？!?；;])|\n+/).map((s) => s.trim()).filter(Boolean);
}

/** LCS 對齊 → ops [{op:'eq'|'del'|'ins', a?, b?}] */
function align(A, B, eq = (x, y) => x === y) {
  const n = A.length, m = B.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = eq(A[i], B[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const ops = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (eq(A[i], B[j])) { ops.push({ op: 'eq', a: i++, b: j++ }); continue; }
    if (dp[i + 1][j] >= dp[i][j + 1]) ops.push({ op: 'del', a: i++ }); else ops.push({ op: 'ins', b: j++ });
  }
  while (i < n) ops.push({ op: 'del', a: i++ });
  while (j < m) ops.push({ op: 'ins', b: j++ });
  return ops;
}

/** 兩句之間的字元層級對照 → { before: [{t, ch}], after: [{t, ch}] }（ch=true 表示改動的字） */
export function charSegments(a, b) {
  const A = [...a], B = [...b];
  if (A.length * B.length > 160000) return { before: [{ t: a, ch: true }], after: [{ t: b, ch: true }] };
  const ops = align(A, B);
  const push = (arr, t, ch) => { const last = arr[arr.length - 1]; if (last && last.ch === ch) last.t += t; else arr.push({ t, ch }); };
  const before = [], after = [];
  for (const o of ops) {
    if (o.op === 'eq') { push(before, A[o.a], false); push(after, B[o.b], false); }
    else if (o.op === 'del') push(before, A[o.a], true);
    else push(after, B[o.b], true);
  }
  return { before, after };
}

/** 文字欄位的句子層級差異 */
export function textDiff(beforeText, afterText) {
  const A = splitSentences(beforeText), B = splitSentences(afterText);
  const ops = align(A, B);
  const before = A.map((t) => ({ t, mark: null, parts: null }));
  const after = B.map((t) => ({ t, mark: null, parts: null }));
  const notes = [];
  let k = 0;
  while (k < ops.length) {
    if (ops[k].op === 'eq') { k++; continue; }
    const dels = [], inss = [];
    while (k < ops.length && ops[k].op !== 'eq') { (ops[k].op === 'del' ? dels : inss).push(ops[k]); k++; }
    const pairs = Math.min(dels.length, inss.length);
    for (let p = 0; p < pairs; p++) {
      const { a } = dels[p], { b } = inss[p];
      const seg = charSegments(A[a], B[b]);
      before[a] = { t: A[a], mark: 'changed', parts: seg.before };
      after[b] = { t: B[b], mark: 'changed', parts: seg.after };
      notes.push({ kind: 'changed', n: b + 1 });
    }
    for (const d of dels.slice(pairs)) { before[d.a].mark = 'removed'; notes.push({ kind: 'removed', n: d.a + 1 }); }
    for (const i of inss.slice(pairs)) { after[i.b].mark = 'added'; notes.push({ kind: 'added', n: i.b + 1 }); }
  }
  const single = A.length <= 1 && B.length <= 1;
  const groups = { changed: [], added: [], removed: [] };
  for (const n of notes) groups[n.kind].push(n.n);
  const list = (ns) => (ns.length > 4 ? `${ns.slice(0, 4).join('、')} 等 ${ns.length} 句` : ns.join('、'));
  const summary = single ? (A.length && B.length ? '改了' : B.length ? '新填寫' : '清空了')
    : [groups.changed.length ? `第 ${list(groups.changed)} 句改了` : '', groups.added.length ? `新增第 ${list(groups.added)} 句` : '', groups.removed.length ? `刪除原第 ${list(groups.removed)} 句` : ''].filter(Boolean).join('；');
  return { summary: summary || '只改了空白或換行', before, after };
}

const isText = (v) => typeof v === 'string';
const show = (v, names) => (v == null || v === '' ? '（空白）' : typeof v === 'boolean' ? (v ? '是' : '否') : names?.[v] ?? String(v));

/**
 * @param {any} before 線上版（新內容時為 null）
 * @param {any} after  送審版
 * @param {{ unitNames?: Record<string,string> }} [opts]
 * @returns {{ isNew: boolean, changes: any[] }}
 */
export function fieldDiff(before, after, { unitNames = {} } = {}) {
  const isNew = !before;
  const b = before ?? {}, a = after ?? {};
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => !IGNORE.has(k) && !k.startsWith('__'));
  keys.sort((x, y) => (ORDER.indexOf(x) === -1 ? 99 : ORDER.indexOf(x)) - (ORDER.indexOf(y) === -1 ? 99 : ORDER.indexOf(y)));
  const changes = [];
  for (const field of keys) {
    const va = b[field], vb = a[field];
    if (JSON.stringify(va) === JSON.stringify(vb)) continue;
    const label = labelOf(field);
    if (isNew && (vb == null || vb === '' || (Array.isArray(vb) && !vb.length))) continue;
    if ((isText(va) || va == null) && (isText(vb) || vb == null) && (String(va ?? '').length > 30 || String(vb ?? '').length > 30 || /[。！？]/.test(`${va ?? ''}${vb ?? ''}`))) {
      const d = textDiff(va ?? '', vb ?? '');
      changes.push({ field, label, kind: va == null ? 'added' : vb == null ? 'removed' : 'changed', type: 'text', ...d });
      continue;
    }
    if (field === 'languages' && va && vb && typeof va === 'object') {
      const items = Object.keys({ ...va, ...vb }).filter((l) => va[l]?.status !== vb[l]?.status).map((l) => `${LANG[l] ?? l}：${LSTAT[va[l]?.status] ?? '（無）'} → ${LSTAT[vb[l]?.status] ?? '（無）'}`);
      if (items.length) changes.push({ field, label, kind: 'changed', type: 'list', summary: items.join('；'), items });
      continue;
    }
    if ((field === 'blocks' || field === 'sections') && (Array.isArray(va) || Array.isArray(vb))) {
      const mapOf = (arr) => new Map((arr ?? []).map((x, i) => [x.key ?? String(i), x]));
      const ma = mapOf(va), mb = mapOf(vb);
      for (const key of new Set([...mb.keys(), ...ma.keys()])) {
        const x = ma.get(key), y = mb.get(key);
        const tx = x?.markdown ?? '', ty = y?.markdown ?? '';
        if (tx === ty && x?.heading === y?.heading) continue;
        const d = textDiff(tx, ty);
        changes.push({ field, label: `${label}「${y?.heading ?? x?.heading ?? key}」`, kind: !x ? 'added' : !y ? 'removed' : 'changed', type: 'text', ...d });
      }
      continue;
    }
    if (Array.isArray(va) || Array.isArray(vb)) {
      const sa = (va ?? []).map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))), sb = (vb ?? []).map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x)));
      const added = sb.filter((x) => !sa.includes(x)).map((x) => show(x, unitNames)), removed = sa.filter((x) => !sb.includes(x)).map((x) => show(x, unitNames));
      const summary = [added.length ? `新增：${added.join('、')}` : '', removed.length ? `移除：${removed.join('、')}` : ''].filter(Boolean).join('；') || '順序調整';
      changes.push({ field, label, kind: va == null ? 'added' : 'changed', type: 'list', summary, items: [] });
      continue;
    }
    if ((va && typeof va === 'object') || (vb && typeof vb === 'object')) {
      const j = (v) => (v == null ? '（空白）' : JSON.stringify(v, null, 1).slice(0, 400));
      changes.push({ field, label, kind: va == null ? 'added' : vb == null ? 'removed' : 'changed', type: 'value', summary: va == null ? '新填寫' : '已修改', from: j(va), to: j(vb) });
      continue;
    }
    changes.push({ field, label, kind: va == null ? 'added' : vb == null ? 'removed' : 'changed', type: 'value', summary: va == null ? `填寫為「${show(vb, unitNames)}」` : `由「${show(va, unitNames)}」改為「${show(vb, unitNames)}」`, from: show(va, unitNames), to: show(vb, unitNames) });
  }
  return { isNew, changes };
}
