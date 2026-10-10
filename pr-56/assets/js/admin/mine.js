import { $, $$, esc, store, onUnit, getUnit, unitLabel, url, fmtDT } from './common.js';
const rows = $$('#m-table tbody tr');
function apply() {
  const u = getUnit(), q = $('#m-q').value.trim().toLowerCase(), st = $('#m-status').value;
  let n = 0;
  for (const tr of rows) {
    const ok = (u === 'all' || tr.dataset.owner === u) && (!q || tr.dataset.q.includes(q)) && (!st || (st === 'attn' ? tr.dataset.attn === '1' : tr.dataset.status === st));
    tr.hidden = !ok; if (ok) n++;
  }
  $('#m-count').textContent = `${n} 筆`; $('#m-empty').hidden = n > 0;
  $('#mine-unit').textContent = `· ${unitLabel()}`;
}
function paintLocal() {
  const d = store.get('cdc.admin.draft'), q = store.get('cdc.admin.queue', []) ?? [], acts = store.get('cdc.admin.reviewActions', {}) ?? {};
  const u = getUnit();
  const items = [];
  if (d && (d.title || d.body) && (u === 'all' || d.owner === u)) items.push(`<li><span class="adm-badge adm-badge--gray">本機草稿</span> <strong>${esc(d.title || '（未命名）')}</strong> <span class="adm-muted">儲存於 ${fmtDT(d.savedAt)}</span> <a href="${url('/admin/publish/')}">繼續編輯</a></li>`);
  for (const e of q) if (u === 'all' || e.owner === u) { const a = acts[e.id]; items.push(`<li><span class="adm-badge adm-badge--info">${a?.state === 'returned' ? '已被退回' : a?.state === 'published' ? '已發布（示範）' : '複核中'}</span> <strong>${esc(e.title)}</strong> <code>${esc(e.id)}</code> <a href="${url('/admin/review/')}">到複核區</a></li>`); }
  $('#mine-local').hidden = !items.length; $('#mine-local-list').innerHTML = items.join('');
}
$('#m-q').addEventListener('input', apply); $('#m-status').addEventListener('change', apply);
onUnit(() => { apply(); paintLocal(); });
