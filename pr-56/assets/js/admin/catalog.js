import { $, $$, followUnit, toCSV, downloadText, today } from './common.js';
const rows = $$('#c-table tbody tr');
function apply() {
  const q = $('#c-q').value.trim().toLowerCase(), cat = $('#c-cat').value, u = $('#c-unit').value, wl = $('#c-wl').value, fl = $('#c-flag').value;
  let n = 0;
  for (const tr of rows) {
    const d = tr.dataset;
    const ok = (!q || d.q.includes(q)) && (!cat || d.cat === cat) && (u === 'all' || d.owner === u) && (!wl || d.wl === wl) && (!fl || (fl === 'overdue' ? d.late === '1' : d.lic === '1'));
    tr.hidden = !ok; if (ok) n++;
  }
  $('#c-count').textContent = `${n} / ${rows.length} 筆`;
}
['#c-q', '#c-cat', '#c-wl', '#c-flag'].forEach((s) => $(s).addEventListener('input', apply));
followUnit($('#c-unit'), apply);
$('#c-csv').addEventListener('click', () => {
  const head = $$('#c-table thead th').map((th) => th.textContent.trim());
  const data = rows.filter((r) => !r.hidden).map((tr) => $$('td', tr).map((td) => td.innerText.replace(/\s*\n\s*/g, ' ').trim()));
  downloadText(`cdc-catalog-${today()}.csv`, toCSV([head, ...data]), 'text/csv');
});
