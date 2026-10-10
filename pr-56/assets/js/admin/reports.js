import { $, $$, esc, store, readEmbedded, onUnit, getUnit, unitLabel, normPath, toCSV, downloadText, fmtDT, url, today } from './common.js';
const D = readEmbedded('adm-report-data', { pages: {} });
const status = () => store.get('cdc.admin.reportStatus', {}) ?? {};
function reports() {
  const r = store.get('cdc.reports', []);
  return (Array.isArray(r) ? r : []).map((x, i) => ({ ...x, _id: x.id ?? `${x.auditId ?? 'r'}-${x.at ?? i}` })).sort((a, b) => String(b.at).localeCompare(String(a.at)));
}
function steward(page) {
  const full = String(page ?? '');
  const frag = full.includes('#') ? full.split('#')[1] : '';
  const p = normPath(full);
  if (frag && D.pages[`${p}#${frag}`]) return D.pages[`${p}#${frag}`];
  if (D.pages[p]) return D.pages[p];
  const key = Object.keys(D.pages).filter((k) => !k.includes('#') && k !== '/' && p.startsWith(k)).sort((a, b) => b.length - a.length)[0];
  return D.pages[key ?? ''] ?? { ...D.fallbackOwner, id: null, title: '（無法對應頁面，轉資料治理幕僚）', steward: '' };
}
function rows() {
  const st = status();
  return reports().map((r) => ({ ...r, st: st[r._id] ?? 'open', who: steward(r.page) }));
}
function render() {
  const f = $('#r-state').value, scope = $('#r-scope').value, u = getUnit();
  const list = rows().filter((r) => (!f || r.st === f) && (scope === 'all' || u === 'all' || r.who.owner === u));
  $('#r-unit').textContent = scope === 'all' || u === 'all' ? '· 全部單位' : `· ${unitLabel()}`;
  $('#r-count').textContent = `${list.length} 筆`;
  $('#r-empty').hidden = reports().length > 0;
  if (reports().length && !list.length) $('#r-count').textContent = '0 筆（篩選條件下沒有紀錄）';
  $('#r-body').innerHTML = list.map((r) => `<tr class="${r.st === 'fixed' ? 'adm-row--done' : ''}"><td>${fmtDT(r.at)}</td><td><code>${esc(r.auditId ?? '—')}</code></td>
    <td><a href="${esc(url(normPath(r.page)))}">${esc(normPath(r.page))}</a>${r.query ? `<div class="adm-muted">查詢：${esc(r.query)}</div>` : ''}</td>
    <td>${esc(r.text)}</td><td>${esc(r.who.ownerName)}${r.who.steward ? `<div class="adm-muted">${esc(r.who.steward)}</div>` : ''}${r.who.id ? `<div class="adm-muted"><code>${esc(r.who.id)}</code></div>` : ''}</td>
    <td><label class="adm-field" style="gap:0"><span class="sr-only">處理狀態</span><select data-st="${esc(r._id)}" class="adm-input"><option value="open" ${r.st === 'open' ? 'selected' : ''}>待處理</option><option value="fixed" ${r.st === 'fixed' ? 'selected' : ''}>已修正</option></select></label></td></tr>`).join('');
}
$('#r-body').addEventListener('change', (e) => { const s = e.target.closest('select[data-st]'); if (!s) return; const st = status(); st[s.dataset.st] = s.value; store.set('cdc.admin.reportStatus', st); render(); });
['#r-state', '#r-scope'].forEach((s) => $(s).addEventListener('change', render));
$('#r-csv').addEventListener('click', () => downloadText(`cdc-reports-${today()}.csv`, toCSV([['時間', '稽核編號', '頁面', '查詢', '內容', '承辦單位', '狀態'], ...rows().map((r) => [r.at, r.auditId, r.page, r.query ?? '', r.text, r.who.ownerName, r.st === 'fixed' ? '已修正' : '待處理'])]), 'text/csv'));
$('#r-json').addEventListener('click', () => downloadText(`cdc-reports-${today()}.json`, `${JSON.stringify(rows().map(({ _id, who, st, ...r }) => ({ ...r, owner: who.owner, status: st })), null, 2)}\n`));
$('#r-demo').addEventListener('click', () => {
  const cur = store.get('cdc.reports', []) ?? [];
  const d = today().replace(/-/g, '');
  cur.push({ id: `demo-${Date.now()}`, auditId: `A-${d}-DEMO`, page: '/diseases/dengue/', query: '登革熱發燒幾天要就醫', text: '（示範）答案提到 24 小時，但我看到的疾病頁寫法不同，請確認。', at: new Date().toISOString() });
  store.set('cdc.reports', cur); render();
});
window.addEventListener('storage', render);
onUnit(render);
