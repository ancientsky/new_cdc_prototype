// @ts-check
// 主檔（一整份「一列一筆」的表，例：疫苗接種時程表）的三方合併與白話差異（第五十三輪，docs/deploy.md §25）。
// 編輯頁（「載入最新版」）與寫入閘道（存檔時合併到網站上的主檔、審核人看到的差異）共用這一支，所以兩邊判斷一樣。
//
// 為什麼以「列」為單位合併，而不是比整份主檔的版本碼：主檔是很多人共用的一張表。只比版本碼的話，
// 別人改了不相干的一列，你就存不進去；但兩人改的是不同列（或同一列的不同欄位）其實沒有衝突。
// 所以閘道把「開始時 → 你的版本」的差異（加了、改了、刪了哪幾列、哪幾欄）套到網站上現在的主檔：
//   - 只有一方改的列（或欄位）用那一方；兩方改成一樣照用。
//   - 同一列的同一個欄位兩邊改得不一樣、或一邊刪一邊改 ⇒ 衝突：先用網站上的，把你的值交給你自己決定（閘道回 409，不寫入）。
// 這和疫情報導分類主檔（bulletin-edit-core.js 的 mergeCategories，§24.7）同一個契約，只是多了「同一列不同欄位不算衝突」。
import { canon } from './preprocess.js';

const same = (a, b) => canon(a) === canon(b);
const isRow = (r) => r != null && typeof r === 'object' && !Array.isArray(r);
const byKey = (list, key) => new Map((Array.isArray(list) ? list : []).filter(isRow).map((r) => [String(r[key]), r]));

/**
 * 一列的欄位三方合併：s＝開始時、m＝我的、t＝網站上的。回傳 { row, fields }；fields＝兩邊改得不一樣的欄位（有就算衝突，row 用網站上的值）。
 * 鍵的順序跟網站上的一樣，我新加的欄位接在後面。
 */
function mergeRow(s, m, t) {
  const out = {};
  const fields = [];
  for (const k of [...Object.keys(t), ...Object.keys(m).filter((x) => !(x in t))]) {
    const sv = s[k],
      mv = m[k],
      tv = t[k];
    let v;
    if (same(mv, sv)) v = tv;
    else if (same(tv, sv) || same(mv, tv)) v = mv;
    else {
      v = tv;
      fields.push(k);
    }
    if (v !== undefined) out[k] = v;
  }
  return { row: out, fields };
}

/**
 * 主檔三方合併（以 key 欄位對應每一列）。
 * @param {any[]} start  開始改時的主檔（編輯頁載入時的，或送審件開始時的）
 * @param {any[]} mine   我的版本
 * @param {any[]} theirs 網站上現在的（或送審件裡現在的）
 * @param {{ key?: string, label?: (row: any) => string }} [o]
 * @returns {{ rows: any[], conflicts: { key: string, label: string, fields: string[], yours: any }[], mine: string[], theirs: string[] }}
 *   rows：合併結果（列的順序跟網站上的一樣；我新加的列放在它在我的版本裡的前一列後面）；mine／theirs：各自改了哪些列（key）
 */
export function mergeRows(start, mine, theirs, { key = 'id', label = (r) => String(r?.label ?? r?.[key] ?? '') } = {}) {
  const S = byKey(start, key),
    M = byKey(mine, key),
    T = byKey(theirs, key);
  const pick = new Map();
  const conflicts = [],
    mineChanged = [],
    theirsChanged = [];
  for (const k of new Set([...T.keys(), ...M.keys(), ...S.keys()])) {
    const s0 = S.get(k),
      m = M.get(k),
      t = T.get(k);
    if (!same(s0, t)) theirsChanged.push(k);
    if (!same(s0, m)) mineChanged.push(k);
    let v;
    if (same(m, s0) || same(m, t)) v = t;
    else if (same(t, s0)) v = m;
    else if (s0 && m && t) {
      // 同一列兩邊都改了：逐欄合併，改的是不同欄位就不算衝突
      const r = mergeRow(s0, m, t);
      v = r.fields.length ? t : r.row;
      if (r.fields.length) conflicts.push({ key: k, label: label(m), fields: r.fields, yours: m });
    } else {
      // 兩邊都新增了同一個 key、或一邊刪一邊改：先用網站上的
      v = t;
      conflicts.push({ key: k, label: label(m ?? t ?? s0), fields: [], yours: m ?? null });
    }
    if (v) pick.set(k, v);
  }
  const out = [];
  const placed = new Set();
  for (const t of Array.isArray(theirs) ? theirs : []) {
    const k = String(t?.[key]);
    if (isRow(t) && pick.has(k) && !placed.has(k)) {
      out.push(pick.get(k));
      placed.add(k);
    }
  }
  // 我新加的列（網站上沒有）：放在它在我的版本裡、最近一個已放好的前一列後面
  const mineList = (Array.isArray(mine) ? mine : []).filter(isRow);
  mineList.forEach((r, i) => {
    const k = String(r[key]);
    if (placed.has(k) || !pick.has(k)) return;
    let at = -1;
    for (let j = i - 1; j >= 0 && at < 0; j--) at = out.findIndex((x) => String(x[key]) === String(mineList[j][key]));
    out.splice(at + 1, 0, pick.get(k));
    placed.add(k);
  });
  return { rows: out, conflicts, mine: mineChanged, theirs: theirsChanged };
}

/**
 * 主檔兩版之間改了什麼（給審核人與承辦人看的白話）：每一列一筆 { key, kind, label, fields[{ field, label, from, to }] }。
 * kind：added／removed／changed；只有順序不同時另回 { reordered: true }。
 * @param {any[]} before
 * @param {any[]} after
 * @param {{ key?: string, label?: (row: any) => string, fieldLabel?: (f: string) => string, show?: (f: string, v: any) => string }} [o]
 */
export function rowChanges(
  before,
  after,
  {
    key = 'id',
    label = (r) => String(r?.label ?? r?.[key] ?? ''),
    fieldLabel = (f) => f,
    show = (_f, v) => (v == null ? '（空白）' : typeof v === 'string' ? v : JSON.stringify(v)),
  } = {},
) {
  const B = byKey(before, key),
    A = byKey(after, key);
  const rows = [];
  for (const [k, a] of A) {
    const b = B.get(k);
    if (!b) {
      rows.push({
        key: k,
        kind: 'added',
        label: label(a),
        fields: Object.keys(a)
          .filter((f) => f !== key && a[f] !== undefined)
          .map((f) => ({ field: f, label: fieldLabel(f), from: null, to: show(f, a[f]) })),
      });
      continue;
    }
    if (same(a, b)) continue;
    const fields = [...new Set([...Object.keys(b), ...Object.keys(a)])]
      .filter((f) => !same(a[f], b[f]))
      .map((f) => ({ field: f, label: fieldLabel(f), from: b[f] === undefined ? null : show(f, b[f]), to: a[f] === undefined ? null : show(f, a[f]) }));
    rows.push({ key: k, kind: 'changed', label: label(a), fields });
  }
  for (const [k, b] of B) if (!A.has(k)) rows.push({ key: k, kind: 'removed', label: label(b), fields: [] });
  const order = (list) =>
    (Array.isArray(list) ? list : [])
      .filter(isRow)
      .map((r) => String(r[key]))
      .filter((k) => A.has(k) && B.has(k));
  return { rows, reordered: !rows.length && !same(order(before), order(after)) };
}

/** rowChanges 的一列 → 一句話（例：「修改「MMR 疫苗 第 1 劑」（sched.mmr-1）：備註由「…」改為「…」」） */
export function rowChangeText(r) {
  const head = `「${r.label}」（${r.key}）`;
  if (r.kind === 'added') return `新增一筆${head}`;
  if (r.kind === 'removed') return `刪除${head}`;
  return `修改${head}：${r.fields.map((f) => (f.from == null ? `${f.label}填寫為「${f.to}」` : f.to == null ? `${f.label}清空（原「${f.from}」）` : `${f.label}由「${f.from}」改為「${f.to}」`)).join('；')}`;
}
