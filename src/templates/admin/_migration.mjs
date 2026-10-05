// 後台「移轉進度」共用取值（底線開頭＝不會被當成頁面）。
// 資料來自 V1 治理引擎的 site.migration = { lists, byTarget, stats, pending }；缺資料一律回傳空結構，不報錯。
import { frontPath } from './_partials.mjs';

export const MIG_STATUS = ['migrated', 'merged', 'archived', 'pending', 'dropped'];
export const MIG_LABEL = { migrated: '已移轉', merged: '已併入', archived: '已封存', pending: '待確認', dropped: '不再提供' };
export const MIG_BADGE = { migrated: 'ok', merged: 'info', archived: 'gray', pending: 'warn', dropped: 'gray' };
export const MIG_TYPE_LABEL = { page: '頁面', qa: 'Q&A', pdf: 'PDF', 'news-list': '新聞列表', media: '影音', list: '列表', external: '外部連結' };
export const REQ_LABEL = { owner: '權責單位', reviewedAt: '審閱日', reviewPeriod: '審閱週期', aiWhitelist: 'AI 白名單', languages: '多語', structuredData: '結構化資料', basedOn: '依據標示', license: '授權標示', machineReadable: '機讀版', accessibility: '無障礙', versionChain: '版本鏈', linkCheck: '連結檢查' };
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

/** 一份清單的摘要列（疾病、法定類別、頁面有無、人工／推導、下載路徑）；W1 規模化新增的欄位缺時由 scope／主檔推得 */
export function listSummary(site, list) {
  const c = listStats(list);
  const diseaseId = list.disease ?? (list.scope?.kind === 'disease' ? list.scope.disease : null) ?? null;
  const dm = diseaseId ? site.diseaseMasterById?.get(diseaseId) ?? null : null;
  const page = diseaseId ? (site.collections?.diseases ?? []).find((d) => d.id === diseaseId && d.status === 'published') ?? null : null;
  const hasPage = typeof list.hasPage === 'boolean' ? list.hasPage : list.status === 'no-page' ? false : diseaseId ? !!page : null;
  const slug = list.slug ?? dm?.slug ?? String(list.id ?? '').replace(/^migration\./, '');
  const owner = list.owner ?? dm?.owner ?? page?.owner ?? null;
  const name = dm?.name ?? list.scope?.name ?? String(list.title ?? slug).replace(/[（(].*$/, '').replace(/專區.*$/, '') ?? slug;
  const cat = list.legalCategory ?? dm?.legalCategory ?? null;
  const done = c.done;
  return {
    id: list.id, title: list.title ?? name, name: name || slug, nameEn: dm?.nameEn ?? '', slug, diseaseId, kind: diseaseId ? 'disease' : 'category',
    legalCategory: cat, hasPage, derived: list.derived === true, owner, ownerName: site.unitById?.get(owner)?.name ?? owner ?? '—',
    c, donePct: c.total ? Math.round((done / c.total) * 100) : 0, front: page ? frontPath(page) : null,
    download: `/v1/migration/${slug}.json`, legacyRoot: list.legacyRoot ?? null, showLegacyUntil: list.showLegacyUntil ?? null, list,
  };
}

/** 一份清單的逐筆列（status 保證在 MIG_STATUS 內；target 解析出標題與前台路徑） */
export function rowsOf(site, list, items = list.items ?? []) {
  const rows = [];
  for (const it of items) {
    const tg = (it.toId ?? it.target) ? site.byId.get(it.toId ?? it.target) : null;
    const owner = it.owner ?? tg?.owner ?? list.owner;
    const front = tg ? frontPath(tg) : it.newPath ?? null; // newPath：系統產生頁／功能頁路徑（非內容 id）
    rows.push({
      listId: list.id, listTitle: list.title, key: it.key, oldTitle: it.oldTitle ?? it.key, oldPath: it.oldPath ?? '', oldUrl: it.oldUrl ?? '', oldType: it.oldType ?? 'page',
      status: MIG_STATUS.includes(it.status) ? it.status : 'pending', verified: it.verified === true, target: it.target ?? null, newPath: it.newPath ?? null, targetTitle: tg?.title ?? null,
      targetFront: front ? `${front}${it.anchor ? `#${it.anchor}` : ''}` : null, anchor: it.anchor ?? '', owner, ownerName: site.unitById.get(owner)?.name ?? owner ?? '—',
      note: it.note ?? '', reqs: it.newRequirements ?? [], placeholder: hasPh(it.oldUrl),
    });
  }
  return rows;
}

/** 全部清單的逐筆列與總計；listRows＝每份清單一列的摘要（預設依待移轉由多到少） */
export function migrationData(site) {
  const lists = (site.migration?.lists ?? []).filter(Boolean);
  const rows = lists.flatMap((list) => rowsOf(site, list));
  const total = { total: rows.length, migrated: 0, merged: 0, archived: 0, pending: 0, dropped: 0, verified: 0 };
  for (const r of rows) { total[r.status]++; if (r.verified) total.verified++; }
  total.done = total.migrated + total.merged + total.archived + total.dropped;
  const pct = (n, d = total.total) => (d ? Math.round((n / d) * 100) : 0);
  const listRows = lists.map((l) => listSummary(site, l)).sort((a, b) => b.c.pending - a.c.pending || b.c.total - a.c.total || a.name.localeCompare(b.name, 'zh-Hant'));
  const summary = {
    lists: lists.length,
    derived: listRows.filter((r) => r.derived).length, curated: listRows.filter((r) => !r.derived).length,
    noPage: listRows.filter((r) => r.hasPage === false).length, hasPage: listRows.filter((r) => r.hasPage === true).length,
  };
  return { lists, rows, listRows, summary, total, pct, donePct: pct(total.done), verifiedPct: pct(total.verified) };
}
