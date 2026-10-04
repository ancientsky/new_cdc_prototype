// 與移轉清單（content/migration/{slug}.json）的對應：產生 migration-patch.json；--apply-migration 才寫回，且只改 status／target／note，不動 verified。
import fs from 'node:fs';

export const ACTION_LABEL = {
  'manual-review': '人工檢視（信心低於門檻）',
  'merge-into-disease': '併入疾病頁區塊（與既有內容逐段比對）',
  'compare-existing': '既有內容已存在，供比對，不建議覆蓋',
  archive: '封存（歷史版本／久遠內容，舊版保留查閱）',
  drop: '不轉換（久遠且已結束，建議 410）',
  'skip-list': '清單頁，不轉換（新站由系統自動產生列表）',
  'auto-ok': '近年新聞，核對後可自動上線',
  'review-before-publish': '核對後入庫（新站尚無對應內容）',
};

const klass = (s) => (s === 'migrated' || s === 'merged' ? 'done' : s);
const NOTE_RE = /\s*【匯入[^】]*】.*$/s;
export const ALLOWED_KEYS = new Set(['status', 'target', 'note']);

export function buildPatch({ manifest, prs, index, exportedAt, slug }) {
  const patch = {
    format: 'cdc-legacy-migration-patch/1', manifest: manifest?.data.id ?? null, batch: slug, exportedAt, applied: null,
    rule: '只改 status／target／note，不動 verified；僅「待確認(pending)且新站已有對應內容」的項目才改 status（人工已判定的項目不被覆蓋，差異列在 conflicts）。',
    items: [], missingPages: [], unmatchedPages: [], conflicts: [],
  };
  if (!manifest) { patch.summary = { items: 0, matched: 0, missingPages: 0, unmatchedPages: prs.length, agree: 0, conflicts: 0, statusChanges: 0, noteChanges: 0 }; patch.unmatchedPages = prs.map((p) => suggestItem(p)); return patch; }
  for (const it of manifest.data.items) {
    const pr = prs.find((p) => p.manifestKey === it.key);
    if (!pr) { patch.missingPages.push({ key: it.key, oldTitle: it.oldTitle, oldUrl: it.oldUrl, status: it.status }); continue; }
    const outs = pr.outputs.filter((o) => o.role !== 'duplicate');
    const dupOf = pr.outputs.filter((o) => o.role === 'duplicate').map((o) => o.id);
    const existOut = outs.find((o) => index.byId.has(o.id));
    const dest = pr.targetExists || !!existOut;
    let proposed;
    if (pr.flags.drop) proposed = 'dropped';
    else if (pr.flags.historical && dest) proposed = 'archived';
    else if (dest) proposed = pr.kind === 'disease-block' ? 'merged' : 'migrated';
    else proposed = 'pending';
    const proposedTarget = it.target ?? (dest ? existOut?.id ?? null : null);
    const ids = outs.map((o) => o.id);
    const marker = `【匯入 ${exportedAt}】${ids.length ? `草稿 ${[...new Set(ids)].join('、')}` : dupOf.length ? `與 ${[...new Set(dupOf)].join('、')} 重複，未另出草稿` : '無草稿'}（信心 ${pr.confidence}${pr.existing ? '；既有內容已存在，供比對' : ''}${pr.kind === 'disease-block' ? '；併入疾病頁' : ''}${pr.needsReview ? '；需人工檢視' : ''}）`;
    const base = String(it.note ?? '').replace(NOTE_RE, '').trim();
    const note = base ? `${base}　${marker}` : marker;
    const statusChange = it.status === 'pending' && proposed !== 'pending';
    const entry = {
      key: it.key, oldTitle: it.oldTitle, page: pr.key, current: { status: it.status, target: it.target ?? null, note: it.note ?? null },
      proposed: { status: statusChange ? proposed : it.status, target: statusChange && !it.target ? proposedTarget : it.target ?? null, note },
      suggestion: { status: proposed, target: proposedTarget }, draftIds: ids,
      agree: klass(proposed) === klass(it.status),
      change: { status: statusChange, target: statusChange && !it.target && !!proposedTarget, note: note !== (it.note ?? null) },
    };
    if (!entry.agree && !statusChange) patch.conflicts.push({ key: it.key, current: it.status, suggestion: proposed, reason: conflictReason(it, pr, proposed) });
    patch.items.push(entry);
  }
  patch.unmatchedPages = prs.filter((p) => !p.manifestKey).map(suggestItem);
  patch.summary = {
    items: manifest.data.items.length, matched: patch.items.length, missingPages: patch.missingPages.length, unmatchedPages: patch.unmatchedPages.length,
    agree: patch.items.filter((i) => i.agree).length, conflicts: patch.conflicts.length,
    statusChanges: patch.items.filter((i) => i.change.status).length, pendingToMigrated: patch.items.filter((i) => i.change.status && i.proposed.status === 'migrated').length,
    targetChanges: patch.items.filter((i) => i.change.target).length, noteChanges: patch.items.filter((i) => i.change.note).length,
    stillPending: patch.items.filter((i) => i.proposed.status === 'pending').length,
  };
  return patch;
}

function conflictReason(it, pr, proposed) {
  if (proposed === 'pending') return '新站尚無對應內容，但清單已標為已有去向（以清單為準）';
  if (proposed === 'dropped') return '匯入規則判定為久遠活動，清單未標不轉換';
  if (proposed === 'archived') return '匯入規則判定為歷史版本，清單狀態不同';
  return `匯入結果建議 ${proposed}，與清單 ${it.status} 不同（人工判定優先）`;
}

function suggestItem(p) {
  return {
    page: p.key, suggest: { key: `import-${p.key}`.replace(/[^a-z0-9-]/gi, '-').toLowerCase(), oldTitle: p.source.title, oldPath: p.source.breadcrumbs.filter((b) => b !== '首頁').join('／'), oldUrl: p.source.url, oldType: p.kind === 'faq' ? 'qa' : p.kind === 'list' ? 'list' : p.kind === 'document' ? 'pdf' : 'page', verified: false, status: 'pending', note: '匯入時清單沒有對應項目，請權責單位確認後加入' },
  };
}

/** 套用到清單檔：只改 status／target／note；寫回前驗證其他欄位（含 verified）完全沒變 */
export function applyPatch(manifestPath, patch) {
  const before = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const data = JSON.parse(JSON.stringify(before));
  const res = { statusChanges: [], targetChanges: [], noteChanges: 0 };
  for (const e of patch.items) {
    const it = data.items.find((x) => x.key === e.key);
    if (!it) continue;
    if (e.change.status) { res.statusChanges.push({ key: e.key, from: it.status, to: e.proposed.status }); it.status = e.proposed.status; }
    if (e.change.target) { res.targetChanges.push({ key: e.key, to: e.proposed.target }); it.target = e.proposed.target; }
    if (e.change.note) { it.note = e.proposed.note; res.noteChanges++; }
  }
  // 防呆：除了 items[].status／target／note，其餘不得有任何差異
  const strip = (d) => ({ ...d, items: d.items.map((i) => Object.fromEntries(Object.entries(i).filter(([k]) => !ALLOWED_KEYS.has(k)))) });
  if (JSON.stringify(strip(before)) !== JSON.stringify(strip(data))) throw new Error('migration apply 改到 status／target／note 以外的欄位，已中止');
  for (let i = 0; i < before.items.length; i++) if (before.items[i].verified !== data.items[i].verified) throw new Error('migration apply 不得改動 verified');
  fs.writeFileSync(manifestPath, `${JSON.stringify(data, null, 2)}\n`);
  return { statusChanges: res.statusChanges, targetChanges: res.targetChanges, noteChanges: res.noteChanges };
}
