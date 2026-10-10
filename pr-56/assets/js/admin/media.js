// /admin/media/ 影音管理：篩選、產生 YouTube 說明欄第一行（7.7 第 4 點）。
import { $, $$, followUnit, readEmbedded, copyText } from './common.js';
import { mediaDescriptionLine } from './preprocess.js';

const D = readEmbedded('adm-media-data', {});
const rows = $$('#m-table tbody tr[data-id]');

function apply() {
  const q = $('#m-q').value.trim().toLowerCase(), u = $('#m-unit').value, f = $('#m-flag').value;
  let n = 0;
  for (const tr of rows) {
    const d = tr.dataset;
    const ok = (!q || d.q.includes(q)) && (u === 'all' || d.owner === u) && (!f || d[f] === '1');
    tr.hidden = !ok; if (ok) n++;
  }
  $('#m-note').textContent = rows.length ? `${n} / ${rows.length} 支` : '';
}
$('#m-q').addEventListener('input', apply);
$('#m-flag').addEventListener('change', apply);
followUnit($('#m-unit'), apply);

let current = '';
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-desc]');
  if (!b) return;
  const m = D[b.dataset.desc];
  if (!m) return;
  const lines = [mediaDescriptionLine({ producedAt: m.producedAt, label: m.label, url: m.url })];
  if (m.outdated) lines.push('', `※ 本影片製作後，所依據的建議已於 ${m.curEffectiveAt} 修訂（現行版 ${m.curVersion}）。請以正本為準：${m.url ?? ''}`);
  current = lines.join('\n');
  $('#desc-title').textContent = `YouTube 說明欄文字：${m.title}`;
  $('#desc-out').textContent = current;
  $('#desc-box').hidden = false;
  $('#desc-out').focus();
});
$('#desc-copy').addEventListener('click', (e) => copyText(current, e.currentTarget));
apply();
