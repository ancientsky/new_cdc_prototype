import { $, $$, esc, store, readEmbedded, copyText, downloadText, addDays, daysBetween } from './common.js';
const D = readEmbedded('adm-sit-data', {});
const KEY = 'cdc.admin.situation';
const ST = { stable: '平穩', rising: '上升', peak: '高峰', declining: '下降' };
const items = D.current.items ?? [];
$('#s-disease').innerHTML = D.diseases.map((d) => `<option value="${esc(d.id)}">${esc(d.name)}${items.some((i) => i.disease === d.id) ? '（目前已發布）' : ''}</option>`).join('');

function fill(it) {
  $('#s-disease').value = it.disease ?? $('#s-disease').value;
  const r = $(`input[name="s-status"][value="${it.status ?? 'stable'}"]`); if (r) r.checked = true;
  $('#s-trend').value = it.trend ?? 'flat'; $('#s-mlabel').value = it.metricLabel ?? ''; $('#s-mvalue').value = it.metricValue ?? ''; $('#s-delta').value = it.deltaText ?? '';
  $('#s-weekly').value = (it.weekly ?? []).join(', '); $('#s-advice').value = it.advice ?? ''; $('#s-basis').value = it.basis ?? '';
  $('#s-illu').checked = it.illustrative !== false;
}
function header() {
  return { data: $('#s-data').value, next: $('#s-next').value, approver: $('#s-approver').value };
}
function read() {
  const weekly = $('#s-weekly').value.split(/[,，\s]+/).map((x) => x.trim()).filter(Boolean).map(Number);
  const mv = $('#s-mvalue').value.trim();
  const num = Number((mv.match(/-?\d+(?:\.\d+)?/) ?? [])[0]);
  const it = {
    disease: $('#s-disease').value, status: $('input[name="s-status"]:checked').value, trend: $('#s-trend').value,
    metricLabel: $('#s-mlabel').value.trim(), metricValue: mv, ...(Number.isFinite(num) ? { metricNumeric: num } : {}),
    ...($('#s-delta').value.trim() ? { deltaText: $('#s-delta').value.trim() } : {}),
    ...(weekly.length && weekly.every(Number.isFinite) ? { weekly } : {}), advice: $('#s-advice').value.trim(), basis: $('#s-basis').value.trim(),
  };
  const old = items.find((i) => i.disease === it.disease);
  if (old?.dataset) it.dataset = old.dataset;
  it.pinned = old?.pinned ?? true;
  if ($('#s-illu').checked) it.illustrative = true;
  return it;
}
function problems(it) {
  const w = [];
  if (!it.metricLabel) w.push('指標名稱未填'); if (!it.metricValue) w.push('指標值未填'); if (!it.advice) w.push('一句話建議未填'); if (!it.basis) w.push('依據門檻未填（沒有門檻依據不得發布狀態）');
  if (it.advice.length > 80) w.push('建議超過 80 字');
  if (!$('#s-data').value) w.push('資料日未填'); if (!$('#s-next').value) w.push('下次審閱日未填'); if (!$('#s-approver').value.trim()) w.push('核定人未填');
  if ($('#s-data').value && $('#s-data').value > D.today) w.push('資料日晚於今日');
  if ($('#s-data').value && daysBetween($('#s-data').value, D.today) > 7) w.push(`資料日距今 ${daysBetween($('#s-data').value, D.today)} 日，超過一週`);
  if ($('#s-next').value && $('#s-data').value && $('#s-next').value <= $('#s-data').value) w.push('下次審閱日需晚於資料日');
  return w;
}
function card(it) {
  const dname = D.diseases.find((d) => d.id === it.disease)?.name ?? it.disease;
  const arrow = it.trend === 'up' ? '↑' : it.trend === 'down' ? '↓' : '→';
  return `<article class="c-sit-card c-sit-card--${it.status}"><header><h3>${esc(dname)}</h3><span class="c-status-tag c-status-tag--${it.status}">${ST[it.status]}</span></header><p class="c-sit-card__metric"><span aria-hidden="true">${arrow}</span> ${esc(it.metricValue || '—')}</p><p class="muted">${esc(it.metricLabel || '（指標名稱）')}${it.deltaText ? `，${esc(it.deltaText)}` : ''}</p><p>建議：${esc(it.advice || '（一句話建議）')}</p>${it.illustrative ? '<p class="muted">示意數字</p>' : ''}</article>`;
}
function doc(it) {
  const h = header();
  const keep = items.filter((i) => i.disease !== it.disease);
  const merged = [...keep.map(({ ...x }) => x), it];
  return {
    publishedAt: D.today, publisher: D.current.publisher ?? 'unit.epidemic-intelligence', approvedBy: h.approver || '（待填）', dataDate: h.data || D.today,
    source: D.current.source ?? 'nidss', nextReviewAt: h.next || addDays(D.today, 7), ...(D.current.note ? { note: D.current.note } : {}), items: merged,
  };
}
function paint() {
  const it = read(), w = problems(it);
  $('#s-preview').innerHTML = card(it);
  $('#s-warn').innerHTML = w.length ? `<div class="adm-box adm-box--warn" role="status"><strong>發布前請補齊</strong>${w.map(esc).join('；')}</div>` : '<div class="adm-box adm-box--ok"><strong>必填已齊</strong>交由疫情中心核定後送 PR。</div>';
  const scope = $('input[name="s-scope"]:checked').value;
  $('#s-out').textContent = JSON.stringify(scope === 'item' ? it : doc(it), null, 2);
}
function save() { store.set(KEY, { ...read(), illustrative: $('#s-illu').checked, ...header(), savedAt: new Date().toISOString() }); $('#s-msg').textContent = '已儲存在本機瀏覽器。'; }
$('#s-form').addEventListener('input', () => { paint(); });
$('#s-form').addEventListener('change', (e) => {
  if (e.target.id === 's-disease') { const old = items.find((i) => i.disease === e.target.value); if (old) fill(old); else fill({ disease: e.target.value, status: 'stable', trend: 'flat' }); }
  paint();
});
$$('input[name="s-scope"]').forEach((r) => r.addEventListener('change', paint));
$('#s-save').addEventListener('click', save);
$('#s-reset').addEventListener('click', () => { const old = items.find((i) => i.disease === $('#s-disease').value); fill(old ?? { disease: $('#s-disease').value }); paint(); });
$('#s-copy').addEventListener('click', (e) => copyText(`${$('#s-out').textContent}\n`, e.currentTarget));
$('#s-dl').addEventListener('click', () => downloadText($('input[name="s-scope"]:checked').value === 'item' ? 'situation-item.json' : 'current.json', `${$('#s-out').textContent}\n`));
// 初始：還原本機表單，否則以第一筆釘選項目預填
const saved = store.get(KEY);
if (saved?.disease) { fill(saved); $('#s-data').value = saved.data ?? ''; $('#s-next').value = saved.next ?? ''; $('#s-approver').value = saved.approver ?? ''; }
else { fill(items.find((i) => i.pinned) ?? items[0] ?? {}); $('#s-data').value = D.today; $('#s-next').value = addDays(D.today, 7); $('#s-approver').value = D.current.approvedBy ?? ''; }
paint();
