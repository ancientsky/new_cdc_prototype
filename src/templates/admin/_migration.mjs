// 後台「移轉進度」共用取值（底線開頭＝不會被當成頁面）。
// 資料來自 V1 治理引擎的 site.migration = { lists, byTarget, stats, pending }；缺資料一律回傳空結構，不報錯。
import { frontPath } from './_partials.mjs';

export const MIG_STATUS = ['migrated', 'merged', 'archived', 'pending', 'dropped'];
export const MIG_LABEL = { migrated: '已移轉', merged: '已併入', archived: '已封存', pending: '待確認', dropped: '不再提供' };
export const MIG_BADGE = { migrated: 'ok', merged: 'info', archived: 'gray', pending: 'warn', dropped: 'gray' };
export const MIG_TYPE_LABEL = { page: '頁面', qa: 'Q&A', pdf: 'PDF', 'news-list': '新聞列表', media: '影音', list: '列表', external: '外部連結' };
export const REQ_LABEL = { owner: '權責單位', reviewedAt: '審閱日', basedOn: '依據標示', machineReadable: '機讀版', languages: '多語' };
export const hasPh = (u) => /[{}]/.test(String(u ?? ''));

export const daysTo = (today, iso) => (iso ? Math.round((new Date(`${iso}T00:00:00Z`) - new Date(`${today}T00:00:00Z`)) / 86400000) : null);

/** 一份清單的數字（自己由 items 算，不依賴引擎的 stats 形狀） */
export function listStats(list) {
  const c = { total: 0, migrated: 0, merged: 0, archived: 0, pending: 0, dropped: 0, verified: 0 };
  for (const it of list.items ?? []) {
    c.total++;
    if (c[it.status] != null) c[it.status]++;
    if (it.verified === true) c.verified++;
  }
  c.done = c.migrated + c.merged + c.archived + c.dropped;
  return c;
}

/** 全部清單的逐筆列與總計 */
export function migrationData(site) {
  const lists = (site.migration?.lists ?? []).filter(Boolean);
  const rows = [];
  for (const list of lists) {
    for (const it of list.items ?? []) {
      const tg = it.target ? site.byId.get(it.target) : null;
      const owner = it.owner ?? tg?.owner ?? list.owner;
      const front = tg ? frontPath(tg) : null;
      rows.push({
        listId: list.id, listTitle: list.title, key: it.key, oldTitle: it.oldTitle ?? it.key, oldPath: it.oldPath ?? '', oldUrl: it.oldUrl ?? '', oldType: it.oldType ?? 'page',
        status: MIG_STATUS.includes(it.status) ? it.status : 'pending', verified: it.verified === true, target: it.target ?? null, targetTitle: tg?.title ?? null,
        targetFront: front ? `${front}${it.anchor ? `#${it.anchor}` : ''}` : null, anchor: it.anchor ?? '', owner, ownerName: site.unitById.get(owner)?.name ?? owner ?? '—',
        note: it.note ?? '', reqs: it.newRequirements ?? [], placeholder: hasPh(it.oldUrl),
      });
    }
  }
  const total = { total: rows.length, migrated: 0, merged: 0, archived: 0, pending: 0, dropped: 0, verified: 0 };
  for (const r of rows) { total[r.status]++; if (r.verified) total.verified++; }
  total.done = total.migrated + total.merged + total.archived + total.dropped;
  const pct = (n, d = total.total) => (d ? Math.round((n / d) * 100) : 0);
  return { lists, rows, total, pct, donePct: pct(total.done), verifiedPct: pct(total.verified) };
}
