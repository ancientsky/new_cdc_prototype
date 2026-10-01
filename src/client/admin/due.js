import { $, $$, store, followUnit, today, fmtDT } from './common.js';
const rows = $$('tbody tr[data-id]');
const marks = () => store.get('cdc.admin.reviewed', {}) ?? {};
function paintMarks() {
  const m = marks();
  for (const tr of rows) {
    const rec = m[tr.dataset.id]; const cell = $('[data-act]', tr);
    tr.classList.toggle('adm-row--done', !!rec);
    cell.innerHTML = rec
      ? `<span class="adm-badge adm-badge--ok">已標記審閱 ${rec.date}</span><div class="adm-muted">正式環境：更新 reviewedAt 欄位並送 PR</div><button type="button" class="adm-btn adm-btn--ghost adm-btn--sm" data-undo="${tr.dataset.id}">復原</button>`
      : `<button type="button" class="adm-btn adm-btn--ghost adm-btn--sm" data-mark="${tr.dataset.id}">標記已審閱（示範）</button>`;
  }
}
function apply() {
  const u = $('#d-unit').value, q = $('#d-q').value.trim().toLowerCase(), m = marks();
  let open = 0;
  for (const tr of rows) { const ok = (u === 'all' || tr.dataset.owner === u) && (!q || tr.dataset.q.includes(q)); tr.hidden = !ok; if (ok && !m[tr.dataset.id]) open++; }
  $$('[data-group]').forEach((g) => { const n = $$('tbody tr[data-id]', g).filter((t) => !t.hidden && !m[t.dataset.id]).length; $('[data-gcount]', g).textContent = n; });
  $('#d-note').textContent = `待審閱 ${open} 筆`;
}
document.addEventListener('click', (e) => {
  const mk = e.target.closest('[data-mark]'), un = e.target.closest('[data-undo]');
  if (!mk && !un) return;
  const m = marks();
  if (mk) m[mk.dataset.mark] = { date: today(), at: new Date().toISOString() }; else delete m[un.dataset.undo];
  store.set('cdc.admin.reviewed', m); paintMarks(); apply();
  document.dispatchEvent(new CustomEvent('adm:queue'));
});
paintMarks();
followUnit($('#d-unit'), apply);
$('#d-q').addEventListener('input', apply);
void fmtDT;
