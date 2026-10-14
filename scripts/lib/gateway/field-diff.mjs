// @ts-check
// 白話欄位差異（第三十輪）：審核人看到的不是 git diff，而是「摘要：第 2 句改了」這種句子，加上逐欄的改前／改後對照。
//
// 做法：逐欄比較「線上版」（main 上的檔）與「送審版」。
//   - 文字欄位切成句子（。！？；與換行），以最長共同子序列（LCS）對齊，連續的刪＋增配成「改了」；改了的句子再做字元層級對照，標出改動的字。
//   - 清單（關鍵字、對象…）說「新增／移除」哪些；日期、數字、選項說「由 A 改為 B」。
//   - 提供語言、內容區塊（blocks／sections）逐項說明；其他複雜欄位退回「已修改」並附前後內容。
//   - 第五十三輪（docs/deploy.md §25）：職缺、採購經閘道送審後，異動紀錄、甄試日程、正取／備取／遞補名單、附件、決標資訊、
//     甄選結果這類「物件清單」或「物件」逐筆說明（type: 'rows'：新增／刪除／修改哪一筆，每筆一句白話），不再只是「已修改」加一大段 JSON。
// 回傳純資料（不含 HTML），由瀏覽器端以 textContent 組畫面，避免任何 HTML 注入。
import { fieldLabel as labelOf } from '../../../src/client/admin/field-labels.js';

// 不比較的欄位：__file／gov 是建置在記憶體裡加的、sourceHash 每次建置重算（stableJson 也不寫進檔）；
// status 是送審流程本身（分支上一定是 draft／review，線上一定是 published），由送審狀態另外顯示。
// 第五十一輪：除此之外「所有」不同的欄位都要列出來——以前語言只比 status、區塊只比內文與標題，
// 其他子欄位（複核人、sourceHash、區塊的 warning…）改了審核人看不到，畫面還會說「沒有修改」。
const IGNORE = new Set(['__file', 'sourceHash', 'gov', 'status']);
/** 比較用的正規化 JSON：物件鍵排序（鍵的順序不算修改），陣列順序照舊 */
const canon = (v) => (Array.isArray(v) ? `[${v.map((x) => (x === undefined ? 'null' : canon(x))).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}` : v === undefined ? 'undefined' : JSON.stringify(v));
const same = (a, b) => canon(a) === canon(b);
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
const isPlainObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
const isObjList = (v) => v == null || (Array.isArray(v) && v.every(isPlainObj));

/* ───────── 第五十三輪：物件清單與一組欄位的白話說明（職缺、採購經閘道送審，審核人要看得懂「異動紀錄多一筆」「下架日改了」） ───────── */
const AMEND = { extend: '展延', reschedule: '改期', correction: '更正', cancel: '取消', other: '其他' };
/** 子欄位名稱（依所在欄位；_ 是通用的） */
const SUB = {
  result: { publishedAt: '公告日', unpublishAt: '下架日', refNo: '字號', externalUrl: '人事系統的結果連結', admitted: '正取名單', waitlist: '備取名單', note: '說明', attachments: '附件' },
  award: { date: '決標日', winner: '得標廠商', amountNtd: '決標金額', note: '說明' },
  aiWhitelist: { requested: '申請列入', approvedBy: '核准單位', approvedAt: '核准日' },
  postPublishReview: { status: '狀態', reviewer: '複核人', reviewedAt: '複核日', note: '說明' },
  _: { date: '日期', label: '標題', title: '標題', url: '網址', note: '說明', text: '說明', kind: '類型', stage: '階段', format: '格式', status: '狀態' },
};
const subLabel = (field, k) => SUB[field]?.[k] ?? SUB._[k] ?? labelOf(k);
const cut = (t, n = 160) => (t.length > n ? `${t.slice(0, n)}…` : t);
/** 清單裡的一項 → 一句話 */
function rowText(field, x, names) {
  if (!isPlainObj(x)) return show(x, names);
  if (field === 'amendments') return `${x.date ?? ''} ${AMEND[x.kind] ?? x.kind ?? ''}：${x.text ?? ''}${x.refNo ? `（${x.refNo}）` : ''}`.trim();
  if (field === 'examPlan') return `${x.stage ?? ''}：${x.date || '另行公告'}${x.note ? `（${x.note}）` : ''}`;
  if (field === 'admitted') return `正取第 ${x.seq ?? '?'} 名：${x.candidateNo ?? ''}`;
  if (field === 'waitlist') return `備取第 ${x.rank ?? '?'} 名：${x.candidateNo ?? ''}${x.validUntil ? `（有效至 ${x.validUntil}）` : ''}`;
  if (field === 'waitlistUpdates') return `${x.date ?? ''} 遞補：${x.candidateNo ?? ''}${x.note ? `（${x.note}）` : ''}`;
  if ((x.label || x.title) && x.url) return `${x.label ?? x.title}（${x.url}）`;
  const prim = Object.entries(x).filter(([, v]) => v == null || typeof v !== 'object').map(([k, v]) => `${subLabel(field, k)}：${show(v, names)}`);
  return cut(prim.length ? prim.join('；') : JSON.stringify(x));
}
/** 兩份物件清單 → [{ kind: added|removed|changed|order, text }]：一樣的不列；同位置的「刪一項＋加一項」配成「改了」 */
function listRows(field, a, b, names) {
  const ca = a.map(canon), cb = b.map(canon);
  const removed = a.filter((_, i) => !cb.includes(ca[i])), added = b.filter((_, i) => !ca.includes(cb[i]));
  const rows = [];
  const n = Math.min(removed.length, added.length);
  for (let i = 0; i < n; i++) rows.push({ kind: 'changed', text: `「${rowText(field, removed[i], names)}」改為「${rowText(field, added[i], names)}」` });
  for (const x of added.slice(n)) rows.push({ kind: 'added', text: rowText(field, x, names) });
  for (const x of removed.slice(n)) rows.push({ kind: 'removed', text: rowText(field, x, names) });
  if (!rows.length) rows.push({ kind: 'order', text: '順序調整' });
  return rows;
}
function rowsSummary(rows) {
  const c = (k) => rows.filter((r) => r.kind === k).length;
  return [c('added') ? `新增 ${c('added')} 項` : '', c('changed') ? `修改 ${c('changed')} 項` : '', c('removed') ? `移除 ${c('removed')} 項` : '', c('order') ? '順序調整' : ''].filter(Boolean).join('；');
}
/** 一組欄位 → 逐個子欄位說明（子欄位是清單時逐項） */
function objRows(field, a, b, names) {
  const rows = [];
  for (const k of [...new Set([...Object.keys(b), ...Object.keys(a)])]) {
    const x = a[k], y = b[k];
    if (same(x, y)) continue;
    const lab = subLabel(field, k);
    if (isObjList(x) && isObjList(y) && [...(x ?? []), ...(y ?? [])].length) {
      for (const r of listRows(k, x ?? [], y ?? [], names)) rows.push({ kind: r.kind, text: `${lab}：${r.kind === 'added' ? '新增 ' : r.kind === 'removed' ? '移除 ' : ''}${r.text}` });
      continue;
    }
    const sx = x == null ? null : cut(typeof x === 'object' ? JSON.stringify(x) : show(x, names));
    const sy = y == null ? null : cut(typeof y === 'object' ? JSON.stringify(y) : show(y, names));
    rows.push(sx == null ? { kind: 'added', text: `${lab}：填寫為「${sy}」` } : sy == null ? { kind: 'removed', text: `${lab}：刪除（原「${sx}」）` } : { kind: 'changed', text: `${lab}：由「${sx}」改為「${sy}」` });
  }
  return rows;
}
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
    if (same(va, vb)) continue;
    const n0 = changes.length;
    const label = labelOf(field);
    if (isNew && (vb == null || vb === '' || (Array.isArray(vb) && !vb.length))) continue;
    if ((isText(va) || va == null) && (isText(vb) || vb == null) && (String(va ?? '').length > 30 || String(vb ?? '').length > 30 || /[。！？]/.test(`${va ?? ''}${vb ?? ''}`))) {
      const d = textDiff(va ?? '', vb ?? '');
      changes.push({ field, label, kind: va == null ? 'added' : vb == null ? 'removed' : 'changed', type: 'text', ...d });
      continue;
    }
    if (field === 'languages' && va && vb && typeof va === 'object') {
      const items = [];
      for (const l of Object.keys({ ...va, ...vb })) {
        const x = va[l], y = vb[l];
        if (same(x, y)) continue;
        if (x?.status !== y?.status) { items.push(`${LANG[l] ?? l}：${LSTAT[x?.status] ?? '（無）'} → ${LSTAT[y?.status] ?? '（無）'}`); continue; }
        if (!x?.sourceHash && y?.sourceHash && same({ ...x, sourceHash: y.sourceHash }, y)) { items.push(`${LANG[l] ?? l}：正本已修改，${LSTAT[y.status] ?? y.status}標為待複核`); continue; }
        const subs = Object.keys({ ...x, ...y }).filter((k) => !same(x?.[k], y?.[k]));
        items.push(`${LANG[l] ?? l}（${LSTAT[y?.status] ?? y?.status ?? '（無）'}）：${subs.join('、')} 有變更`);
      }
      changes.push({ field, label, kind: 'changed', type: 'list', summary: items.join('；'), items });
      continue;
    }
    if ((field === 'blocks' || field === 'sections') && (Array.isArray(va) || Array.isArray(vb))) {
      const mapOf = (arr) => new Map((arr ?? []).map((x, i) => [x.key ?? String(i), x]));
      const ma = mapOf(va), mb = mapOf(vb);
      for (const key of new Set([...mb.keys(), ...ma.keys()])) {
        const x = ma.get(key), y = mb.get(key);
        const tx = x?.markdown ?? '', ty = y?.markdown ?? '';
        const blabel = `${label}「${y?.heading ?? x?.heading ?? key}」`;
        if (tx !== ty || x?.heading !== y?.heading) changes.push({ field, label: blabel, kind: !x ? 'added' : !y ? 'removed' : 'changed', type: 'text', ...textDiff(tx, ty) });
        else if (!same(x, y)) { // 內文相同，但區塊的其他設定（待補標記、警示、資料集…）改了
          const subs = Object.keys({ ...x, ...y }).filter((k) => !same(x?.[k], y?.[k]));
          const j = (v) => (v == null ? '（空白）' : JSON.stringify(v, null, 1).slice(0, 400));
          changes.push({ field, label: blabel, kind: 'changed', type: 'value', summary: `${subs.join('、')} 已修改`, from: j(Object.fromEntries(subs.map((k) => [k, x?.[k]]))), to: j(Object.fromEntries(subs.map((k) => [k, y?.[k]]))) });
        }
      }
      if (changes.length === n0) changes.push({ field, label, kind: 'changed', type: 'list', summary: '區塊順序調整', items: [] });
      continue;
    }
    // 第五十三輪：物件清單（異動紀錄、甄試日程、附件連結、遞補公告…）與一組欄位（甄選結果、決標資訊…）逐項說明，不再整段 JSON
    if (isObjList(va) && isObjList(vb) && [...(va ?? []), ...(vb ?? [])].length) {
      const rows = listRows(field, va ?? [], vb ?? [], unitNames);
      changes.push({ field, label, kind: va == null ? 'added' : vb == null ? 'removed' : 'changed', type: 'rows', summary: rowsSummary(rows), rows });
      continue;
    }
    if (isPlainObj(va ?? {}) && isPlainObj(vb ?? {}) && (isPlainObj(va) || isPlainObj(vb))) {
      const rows = objRows(field, va ?? {}, vb ?? {}, unitNames);
      if (rows.length) { changes.push({ field, label, kind: va == null ? 'added' : vb == null ? 'removed' : 'changed', type: 'rows', summary: va == null ? '新填寫' : vb == null ? '整組刪除' : `改了 ${rows.length} 項`, rows }); continue; }
    }
    if (Array.isArray(va) || Array.isArray(vb)) {
      const sa = (va ?? []).map((x) => (x && typeof x === 'object' ? canon(x) : String(x))), sb = (vb ?? []).map((x) => (x && typeof x === 'object' ? canon(x) : String(x)));
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
