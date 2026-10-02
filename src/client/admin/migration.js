// /admin/migration/ 移轉進度：逐筆表格篩選、匯出 CSV、對照檔預覽（讀取已建置的 redirects/ 檔案前 8 行）。
import { $, $$, toCSV, downloadText, today } from './common.js';

const rows = $$('#mg-table tbody tr');
function apply() {
  const q = $('#mg-q').value.trim().toLowerCase(), st = $('#mg-st').value, vf = $('#mg-vf').value, ls = $('#mg-list').value, u = $('#mg-unit').value;
  let n = 0;
  for (const tr of rows) {
    const d = tr.dataset;
    const ok = (!q || d.q.includes(q)) && (!st || d.status === st) && (!vf || d.verified === vf) && (!ls || d.list === ls) && (u === 'all' || d.owner === u);
    tr.hidden = !ok; if (ok) n++;
  }
  $('#mg-note').textContent = rows.length ? `${n} / ${rows.length} 筆` : '';
}
// 單位篩選預設「全部單位」：移轉清單依專區分屬各單位，總覽比跟隨示範身分更有用
['#mg-q', '#mg-st', '#mg-vf', '#mg-list', '#mg-unit'].forEach((s) => $(s)?.addEventListener('input', apply));
$('#mg-csv')?.addEventListener('click', () => {
  const head = ['舊標題', '舊網址', '狀態', '核對', '對應新頁', '權責單位'];
  const data = rows.filter((r) => !r.hidden).map((tr) => {
    const td = $$('td', tr);
    return [td[0].querySelector('strong').textContent, td[1].textContent.trim(), td[2].textContent.trim(), td[3].textContent.trim(), td[4].textContent.trim().replace(/\s+/g, ' '), td[5].textContent.trim()];
  });
  downloadText(`cdc-migration-${today()}.csv`, toCSV([head, ...data]), 'text/csv');
});
$$('[data-preview]').forEach((b) => b.addEventListener('click', async () => {
  const pre = $('#mg-preview');
  pre.hidden = false;
  try {
    const r = await fetch(b.dataset.preview);
    if (!r.ok) throw new Error(String(r.status));
    pre.textContent = `${b.dataset.preview}\n${'─'.repeat(40)}\n${(await r.text()).split('\n').slice(0, 8).join('\n')}`;
  } catch { pre.textContent = `${b.dataset.preview}\n（尚未建置此檔，或在本機預覽時讀不到）`; }
}));
apply();
