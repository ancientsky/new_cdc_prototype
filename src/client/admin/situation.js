import { $, $$, esc, store, readEmbedded, copyText, downloadText, addDays, daysBetween } from './common.js';
import { sparklineSvg } from '../charts.js';
const D = readEmbedded('adm-sit-data', {});
const KEY = 'cdc.admin.situation';
const ST = { stable: '平穩', rising: '上升', peak: '高峰', declining: '下降' };
const STYLES = { standard: '標準', chart: '趨勢圖', advice: '行動優先', minimal: '精簡' };
const items = D.current.items ?? [];
$('#s-disease').innerHTML = D.diseases.map((d) => `<option value="${esc(d.id)}">${esc(d.name)}${items.some((i) => i.disease === d.id) ? '（目前已發布）' : ''}</option>`).join('');

function fill(it) {
  $('#s-disease').value = it.disease ?? $('#s-disease').value;
  const r = $(`input[name="s-status"][value="${it.status ?? 'stable'}"]`); if (r) r.checked = true;
  $('#s-trend').value = it.trend ?? 'flat'; $('#s-mlabel').value = it.metricLabel ?? ''; $('#s-mvalue').value = it.metricValue ?? ''; $('#s-delta').value = it.deltaText ?? '';
  $('#s-weekly').value = (it.weekly ?? []).join(', '); $('#s-advice').value = it.advice ?? ''; $('#s-basis').value = it.basis ?? '';
  $('#s-illu').checked = it.illustrative !== false;
  const st = $(`input[name="s-style"][value="${it.cardStyle in STYLES ? it.cardStyle : 'standard'}"]`); if (st) st.checked = true;
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
    cardStyle: $('input[name="s-style"]:checked')?.value ?? 'standard',
  };
  const old = items.find((i) => i.disease === it.disease);
  if (old?.dataset) it.dataset = old.dataset;
  if (old?.weeklyLabels && it.weekly && old.weeklyLabels.length === it.weekly.length) it.weeklyLabels = old.weeklyLabels;
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
/** 與前台 sitCard（src/templates/public/_partials.mjs）同結構的四種樣版；這裡只是預覽，正式渲染以建置為準。 */
function card(it, style = it.cardStyle) {
  const dname = D.diseases.find((d) => d.id === it.disease)?.name ?? it.disease;
  const arrow = it.trend === 'up' ? '↑' : it.trend === 'down' ? '↓' : '→';
  if (style === 'chart' && !(it.weekly?.length > 1)) style = 'standard';
  const head = `<header class="c-sit-card__head"><h3>${esc(dname)}</h3><span class="c-status-tag c-status-tag--${it.status}">${ST[it.status]}</span></header>`;
  const demo = it.illustrative ? '<span class="c-sit-card__demo">示意</span>' : '';
  const ar = `<span class="c-sit-card__arrow c-sit-card__arrow--${it.trend}" aria-hidden="true">${arrow}</span>`;
  const label = `${esc(it.metricLabel || '（指標名稱）')}${it.deltaText ? `，${esc(it.deltaText)}` : ''}`;
  const line = `<p class="c-sit-card__line">${ar}<b class="c-sit-card__num">${esc(it.metricValue || '—')}</b> <span>${label}</span>${demo}</p>`;
  const openTag = `<article class="c-sit-card c-sit-card--${it.status} c-sit-card--compact c-sit-card--style-${style}">`;
  if (style === 'minimal') return `${openTag}${head}${line}</article>`;
  if (style === 'advice') return `${openTag}${head}<p class="c-sit-card__lead">${esc(it.advice || '（一句話建議）')}</p>${line}</article>`;
  const metric = `<p class="c-sit-card__metric">${ar}<span class="c-sit-card__num">${esc(it.metricValue || '—')}</span>${demo}</p>`;
  const desc = `<p class="c-sit-card__desc">${esc(it.metricLabel || '（指標名稱）')}${it.deltaText ? `<br><span class="c-sit-card__delta">${esc(it.deltaText)}</span>` : ''}</p>`;
  const advice = `<p class="c-sit-card__advice"><b>建議：</b>${esc(it.advice || '（一句話建議）')}</p>`;
  const spark = style === 'chart' ? `<figure class="c-sit-card__spark">${sparklineSvg(it.weekly, { color: `var(--status-${it.status})`, width: 220, height: 44 })}<figcaption>${it.weeklyLabels?.length ? `<span>${esc(it.weeklyLabels[0])}</span><span>近 ${it.weekly.length} 週</span><span>${esc(it.weeklyLabels[it.weeklyLabels.length - 1])}</span>` : `近 ${it.weekly.length} 週`}</figcaption></figure>` : '';
  return `${openTag}${head}${metric}${spark}${desc}${advice}</article>`;
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
  $('#s-style-now').textContent = STYLES[it.cardStyle] ?? it.cardStyle;
  $('#s-compare').innerHTML = Object.entries(STYLES).map(([k, v]) => `<div class="adm-compare"><p class="adm-compare__t">${v}${k === 'chart' && !(it.weekly?.length > 1) ? '（沒有近週數字，會退回標準）' : ''}</p>${card(it, k)}</div>`).join('');
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
