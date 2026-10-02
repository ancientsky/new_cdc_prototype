// /admin/notices/ 公告管理：分頁籤、篩選、「建議封存（示範）」（localStorage）、匯出 CSV／封存建議 JSON。
import { $, $$, store, followUnit, toCSV, downloadText, readEmbedded, today } from './common.js';

const D = readEmbedded('adm-notices-data', { rows: [] });
const KEY = 'cdc.admin.noticeArchived';
const rows = $$('tbody tr[data-id]');
const tabs = $$('[role="tab"]');

function select(k, focus) {
  tabs.forEach((t) => { const on = t.dataset.kind === k; t.setAttribute('aria-selected', on); t.tabIndex = on ? 0 : -1; if (on && focus) t.focus(); });
  $$('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== k; });
}
tabs.forEach((t, i) => {
  t.addEventListener('click', () => select(t.dataset.kind));
  t.addEventListener('keydown', (e) => {
    const n = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : null;
    if (n == null) return; e.preventDefault(); select(tabs[(n + tabs.length) % tabs.length].dataset.kind, true);
  });
});

const marks = () => store.get(KEY, {}) ?? {};
function paint() {
  const m = marks();
  const u = $('#n-unit').value, st = $('#n-state').value;
  let shown = 0, unarchived = 0;
  for (const tr of rows) {
    const d = tr.dataset, rec = m[d.id], cell = $('[data-act]', tr);
    if (d.closed === '1' && d.archived !== '1') {
      cell.innerHTML = rec
        ? `<span class="adm-badge adm-badge--ok">已標記封存（示範）</span><div class="adm-muted">正式環境：把 status 改成 archived 並開 PR</div><button type="button" class="adm-btn adm-btn--ghost adm-btn--sm" data-undo="${d.id}">復原</button>`
        : `<button type="button" class="adm-btn adm-btn--ghost adm-btn--sm" data-archive="${d.id}">建議封存（示範）</button>`;
      if (!rec) unarchived++;
    }
    tr.classList.toggle('adm-row--done', !!rec);
    const ok = (u === 'all' || d.owner === u)
      && (!st || (st === 'open' && d.open === '1') || (st === 'soon' && d.soon === '1') || (st === 'closed' && d.closed === '1') || (st === 'closed-un' && d.closed === '1' && d.archived !== '1' && !rec));
    tr.hidden = !ok; if (ok) shown++;
  }
  for (const t of tabs) {
    const p = $(`[data-panel="${CSS.escape(t.dataset.kind)}"]`);
    const list = $$('tbody tr[data-id]', p);
    $(`[data-kcount="${CSS.escape(t.dataset.kind)}"]`).textContent = list.filter((r) => !r.hidden).length;
    $('[data-empty]', p).hidden = list.some((r) => !r.hidden);
  }
  const un = $('#n-closed-un'); if (un) un.textContent = unarchived;
  $('#n-note').textContent = `顯示 ${shown} / ${rows.length} 則；本機已標記建議封存 ${Object.keys(m).length} 則`;
}
document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-archive]'), un = e.target.closest('[data-undo]');
  if (a) { const m = marks(); m[a.dataset.archive] = { at: new Date().toISOString() }; store.set(KEY, m); paint(); }
  if (un) { const m = marks(); delete m[un.dataset.undo]; store.set(KEY, m); paint(); }
});
$('#n-state').addEventListener('change', paint);
followUnit($('#n-unit'), paint);

$('#n-csv').addEventListener('click', () => {
  const label = { recruit: '人才招募', procurement: '採購公告', other: '其他訊息' };
  const head = ['識別碼', '類型', '標題', '字號', '截止日', '倒數（日）', '名額', '預算（元）', '報名網址', '狀態', '建議封存'];
  const m = marks();
  const data = D.rows.filter((r) => { const tr = rows.find((x) => x.dataset.id === r.id); return tr && !tr.hidden; })
    .map((r) => [r.id, label[r.newsType] ?? r.newsType, r.title, r.refNo, r.deadlineAt ?? '', r.days ?? '', r.positions ?? '', r.budgetNtd ?? '', r.applyUrl, r.closed ? '已截止' : r.status, m[r.id] ? '是（示範）' : '']);
  downloadText(`cdc-notices-${today()}.csv`, toCSV([head, ...data]), 'text/csv');
});
$('#n-json').addEventListener('click', () => {
  const m = marks();
  const list = D.rows.filter((r) => r.closed && r.status !== 'archived').map((r) => ({ id: r.id, title: r.title, deadlineAt: r.deadlineAt, suggest: { status: 'archived' }, markedInDemo: !!m[r.id] }));
  downloadText(`cdc-notices-archive-suggestions-${today()}.json`, `${JSON.stringify({ generatedAt: today(), note: '正式環境：逐筆把 content/news/<id>.json 的 status 改成 archived 後開 Pull Request。', items: list }, null, 2)}\n`);
});
paint();
