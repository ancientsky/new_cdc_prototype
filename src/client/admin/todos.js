import { $, $$, store, followUnit } from './common.js';
const tabs = $$('[role="tab"]');
function select(k, focus) {
  tabs.forEach((t) => { const on = t.dataset.kind === k; t.setAttribute('aria-selected', on); t.tabIndex = on ? 0 : -1; if (on && focus) t.focus(); });
  $$('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== k; });
  try { history.replaceState(null, '', `#${k}`); } catch { /* ignore */ }
}
tabs.forEach((t, i) => {
  t.addEventListener('click', () => select(t.dataset.kind));
  t.addEventListener('keydown', (e) => {
    const n = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : null;
    if (n == null) return; e.preventDefault(); select(tabs[(n + tabs.length) % tabs.length].dataset.kind, true);
  });
});
const h = location.hash.slice(1); if (h && tabs.some((t) => t.dataset.kind === h)) select(h);

const done = () => store.get('cdc.admin.todoDone', {}) ?? {};
function apply() {
  const d = done(), u = $('#t-unit').value, hide = $('#t-hide-done').checked;
  let open = 0;
  for (const tr of $$('tbody tr[data-id]')) {
    const isDone = !!d[tr.dataset.id];
    $('input[data-done]', tr).checked = isDone;
    tr.classList.toggle('adm-row--done', isDone);
    const ok = (u === 'all' || tr.dataset.owner === u) && !(hide && isDone);
    tr.hidden = !ok; if (ok && !isDone) open++;
  }
  for (const t of tabs) {
    const k = t.dataset.kind, p = $(`[data-panel="${CSS.escape(k)}"]`);
    const rows = $$('tbody tr[data-id]', p);
    const n = rows.filter((r) => !r.hidden && !d[r.dataset.id]).length;
    $(`[data-kcount="${CSS.escape(k)}"]`).textContent = n;
    $('[data-empty]', p).hidden = rows.some((r) => !r.hidden);
  }
  $('#t-note').textContent = `未完成 ${open} 件`;
  const el = $('.adm-count[data-count="todos"]'); if (el) el.textContent = $$('tbody tr[data-id]').filter((r) => !d[r.dataset.id]).length;
}
document.addEventListener('change', (e) => {
  const c = e.target.closest('input[data-done]'); if (!c) return;
  const d = done(); if (c.checked) d[c.dataset.done] = new Date().toISOString(); else delete d[c.dataset.done];
  store.set('cdc.admin.todoDone', d); apply();
});
$('#t-hide-done').addEventListener('change', apply);
followUnit($('#t-unit'), apply);
