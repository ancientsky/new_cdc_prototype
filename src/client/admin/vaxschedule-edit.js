// /admin/vaccines/schedule/ 疫苗接種時程表編輯（第三十六輪）：左邊改一筆，右邊時程地圖與表格同時重畫（同一份 renderMapSvg／renderTableHtml，和前台一模一樣）。
// 點預覽圖上的標記＝跳到那一筆的表單（借 TinaCMS 的 click-to-field，第二十二輪）。整份改完匯出 immunization-schedule.json 交資訊室，或複製 diff 摘要貼進送審說明。
// 文字一律 textContent／esc()；只在這台瀏覽器暫存（localStorage），不會自己寫進主檔。
import { $, $$, esc, store, readEmbedded, copyText, downloadText } from './common.js';
import { rowsOf, renderMapSvg, renderTableHtml, scheduleCsv, TABS } from '../vaxschedule.js';
import { emptyState, stateFromItem, buildItem, problemsOf, problemsOfAll, errorsOnly, nextId, monthsText, sortedForExport, diffSummary, mergeSchedule, STAGE_LABEL, FUNDED_LABEL, FIELD_LABEL, joinMonths } from './vaxschedule-edit-core.js';

const D = readEmbedded('adm-vxs-data', { items: [], vaccines: [], strings: {} });
const KEY = 'cdc.admin.vaxschedule';
const T = (k, v = {}) => String(D.strings[k] ?? k).replace(/\{(\w+)\}/g, (_, x) => v[x] ?? '');
const vaccineIds = D.vaccines.map((v) => v.id);
const vname = (id) => D.vaccines.find((v) => v.id === id)?.name ?? id;

/* 狀態：整份主檔（工作副本）＋目前編輯的 index */
let items = (store.get(KEY)?.items ?? D.items).map((i) => ({ ...i }));
// 第五十二輪（docs/deploy.md §24）：開始編輯時的現行版。匯出＝mergeSchedule(工作副本, 現行版, orig)：只套用改過的筆與欄位，順序與沒動的筆原樣。
// 存在這台電腦的草稿一併記下 orig，之後 main 上被別人改的筆不會被草稿蓋回去（舊草稿沒有 orig 就用現行版）。
let orig = store.get(KEY)?.orig ?? D.items;
/** 匯出的主檔（下載、複製、修訂摘要、畫面上的 JSON 都用這一份） */
const exported = () => mergeSchedule(items, D.items, orig);
let cur = 0;
let tab = 'all';
let form = stateFromItem(items[0] ?? emptyState());

/* ── 表單 ── */
const F = {}; // field → element
$$('[data-f]').forEach((el) => { F[el.dataset.f] = el; });
F.vaccine.innerHTML = D.vaccines.map((v) => `<option value="${esc(v.id)}">${esc(v.name)}${v.hasPage ? '' : '（無疫苗頁）'}</option>`).join('');
F.stage.innerHTML = Object.entries(STAGE_LABEL).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
F.funded.innerHTML = Object.entries(FUNDED_LABEL).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
function fill(s) {
  for (const [k, el] of Object.entries(F)) {
    if (el.type === 'checkbox') el.checked = !!s[k]; else el.value = s[k] ?? '';
  }
  toggleMax();
}
function read() {
  const s = {};
  for (const [k, el] of Object.entries(F)) s[k] = el.type === 'checkbox' ? el.checked : el.value;
  return s;
}
function toggleMax() { const off = F.noMax.checked; F.maxY.disabled = off; F.maxM.disabled = off; }

/* ── 清單（左欄）── */
function paintList() {
  const ul = $('#vx-list'); ul.textContent = '';
  const rows = rowsOf(items, D.vaccines);
  const all = problemsOfAll(items, vaccineIds);
  rows.forEach((r) => {
    const h = document.createElement('li'); h.className = 'adm-vx-grp'; h.textContent = r.name; ul.appendChild(h);
    r.items.forEach((i) => {
      const idx = items.indexOf(i);
      const li = document.createElement('li');
      const b = document.createElement('button'); b.type = 'button'; b.className = `adm-vx-item${idx === cur ? ' is-cur' : ''}`; b.dataset.idx = idx;
      const bad = all.some((p) => p.index === idx);
      b.textContent = `${i.dose ?? i.label}　${i.ageLabel ?? ''}`;
      const tag = document.createElement('span'); tag.className = `adm-badge adm-badge--${bad ? 'bad' : i.verified === false ? 'warn' : 'ok'}`; tag.textContent = bad ? '有錯' : i.verified === false ? '待核對' : '已核對';
      b.appendChild(tag); li.appendChild(b); ul.appendChild(li);
    });
  });
  $('#vx-count').textContent = `${items.length} 筆，${items.filter((i) => i.verified === false).length} 筆待核對，${all.length} 個錯誤`;
}
function select(idx) {
  commitForm();
  cur = Math.max(0, Math.min(items.length - 1, idx));
  form = stateFromItem(items[cur] ?? emptyState());
  fill(form);
  paintAll();
  F.label.focus();
}
/** 把表單寫回工作副本（即時：每次 input 都做，所以預覽永遠是「現在的樣子」） */
function commitForm() {
  if (!items.length) return;
  form = read();
  items[cur] = buildItem(form);
}

/* ── 預覽（右欄）── */
const T2 = (k, v) => T(k, v);
function paintPreview() {
  const rows = rowsOf(items, D.vaccines);
  const stages = TABS.find((x) => x.id === tab)?.stages ?? null;
  const shown = stages ? rows.map((r) => ({ ...r, items: r.items.filter((i) => stages.includes(i.stage)) })).filter((r) => r.items.length) : rows;
  const map = $('#vx-map'); map.innerHTML = renderMapSvg(shown, { t: T2, lang: 'zh-TW' });
  const curId = items[cur]?.id;
  map.querySelectorAll('.vxs-mk').forEach((a) => a.classList.toggle('is-sel', a.dataset.id === curId));
  $('#vx-table').innerHTML = renderTableHtml(rows, { t: T2, lang: 'zh-TW', scrollLabel: '表格，可捲動' });
  $('#vx-table').querySelectorAll('tr[data-sched]').forEach((tr) => tr.classList.toggle('is-sel', tr.dataset.sched === curId));
  $$('[data-vx-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.vxTab === tab)));
}
function paintChecks() {
  const box = $('#vx-check'); box.textContent = '';
  if (!items.length) return;
  const it = items[cur];
  const ps = problemsOf(it, { others: items.filter((_, j) => j !== cur), vaccineIds });
  const errs = errorsOnly(ps); const warns = ps.filter((p) => p.level === 'warn');
  const mk = (cls, title, list) => {
    const d = document.createElement('div'); d.className = `adm-box ${cls}`;
    const s = document.createElement('strong'); s.textContent = title; d.appendChild(s);
    const ul = document.createElement('ul');
    list.forEach((p) => { const li = document.createElement('li'); const b = document.createElement('button'); b.type = 'button'; b.className = 'adm-linkbtn'; b.dataset.field = p.field; b.textContent = `${FIELD_LABEL[p.field] ?? p.field}：${p.message}`; li.appendChild(b); ul.appendChild(li); });
    d.appendChild(ul); box.appendChild(d);
  };
  if (errs.length) mk('adm-box--err', '這一筆還不能上線（CI 會擋）', errs);
  if (warns.length) mk('adm-box--warn', '建議補齊', warns);
  if (!errs.length && !warns.length) { const d = document.createElement('div'); d.className = 'adm-box adm-box--ok'; d.textContent = '這一筆沒有問題。'; box.appendChild(d); }
  const min = joinMonths(form.ageY, form.ageM); const max = form.noMax ? null : joinMonths(form.maxY, form.maxM);
  $('#vx-agehint').textContent = `地圖會畫在：${monthsText(Number.isFinite(min) ? min : null)}${form.noMax ? ' 以上' : max == null || max === min ? '（單一月齡，畫成一個點）' : ` 至 ${monthsText(max)}`}${Number.isFinite(joinMonths(form.hardY, form.hardM)) ? `；可接種上限：滿 ${monthsText(joinMonths(form.hardY, form.hardM))} 起不可接種` : '；沒有可接種上限（超過建議區間只會顯示「應已完成」）'}`;
}
function paintExport() {
  const out = exported();
  $('#vx-out').textContent = JSON.stringify(out, null, 2);
  const d = diffSummary(D.items, out);
  const all = problemsOfAll(out, vaccineIds);
  $('#vx-diff').textContent = d.dirty ? `與目前上線版本相比：新增 ${d.added.length}、刪除 ${d.removed.length}、修改 ${d.changed.length}${d.changed.length ? `（${d.changed.slice(0, 6).join('、')}${d.changed.length > 6 ? '…' : ''}）` : ''}` : '與目前上線版本相同。';
  const st = $('#vx-export-state');
  st.textContent = all.length ? `還有 ${all.length} 個錯誤，匯出的檔案會被 CI 擋下` : '檢查通過，可匯出交資訊室';
  st.className = `adm-badge adm-badge--${all.length ? 'bad' : 'ok'}`;
}
function paintAll() { paintList(); paintPreview(); paintChecks(); paintExport(); }

/* ── 事件 ── */
$('#vx-form').addEventListener('input', () => { commitForm(); paintAll(); });
// 只處理 input 事件就夠（select／checkbox 也會發 input）。change 事件不重畫：它在欄位失焦時才發，
// 若同事改完欄位直接去點預覽圖上的標記，失焦→重畫會把標記換成新元素，第一下點擊就落空（實測踩到）。
$('#vx-form').addEventListener('change', (e) => { if (e.target === F.noMax) toggleMax(); if (e.target === F.vaccine && !F.id.value) { F.id.value = nextId(F.vaccine.value, items.filter((_, j) => j !== cur)); commitForm(); paintAll(); } });
$('#vx-list').addEventListener('click', (e) => { const b = e.target.closest('[data-idx]'); if (b) select(Number(b.dataset.idx)); });
$('#vx-map').addEventListener('click', (e) => { const a = e.target.closest('.vxs-mk'); if (!a) return; e.preventDefault(); const idx = items.findIndex((i) => i.id === a.dataset.id); if (idx >= 0) select(idx); });
$('#vx-table').addEventListener('click', (e) => { const tr = e.target.closest('tr[data-sched]'); if (!tr || e.target.closest('a')) return; const idx = items.findIndex((i) => i.id === tr.dataset.sched); if (idx >= 0) select(idx); });
$('#vx-check').addEventListener('click', (e) => { const b = e.target.closest('[data-field]'); if (!b) return; const el = F[b.dataset.field] ?? F[b.dataset.field === 'ageMinMonths' ? 'ageY' : b.dataset.field === 'ageMaxMonths' ? 'maxY' : b.dataset.field === 'hardLimitMonths' ? 'hardY' : b.dataset.field]; el?.focus(); el?.closest('.adm-field')?.classList.add('adm-field--hit'); setTimeout(() => el?.closest('.adm-field')?.classList.remove('adm-field--hit'), 1500); });
$$('[data-vx-tab]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.vxTab; paintPreview(); }));
$('#vx-add').addEventListener('click', () => {
  commitForm();
  const v = items[cur]?.vaccine ?? D.vaccines[0]?.id ?? '';
  const base = items[cur] ? { ...items[cur] } : {};
  const it = { ...base, id: nextId(v, items), vaccine: v, label: `${vname(v)} 新項目`, dose: '', verified: false };
  items.splice(cur + 1, 0, it); cur += 1; form = stateFromItem(it); fill(form); paintAll(); F.label.focus(); F.label.select();
});
$('#vx-del').addEventListener('click', () => {
  if (!items.length) return;
  const it = items[cur];
  if (!confirm(`確定刪除「${it.label}」？匯出的主檔就不再有這一筆（地圖與問答都會少掉）。`)) return;
  items.splice(cur, 1); cur = Math.max(0, cur - 1); form = stateFromItem(items[cur] ?? emptyState()); fill(form); paintAll();
});
$('#vx-verify').addEventListener('click', () => { F.verified.checked = true; commitForm(); paintAll(); });
$('#vx-save').addEventListener('click', () => { commitForm(); store.set(KEY, { items, orig, savedAt: new Date().toISOString() }); $('#vx-msg').textContent = `已暫存在這台電腦（${new Date().toLocaleTimeString('zh-TW', { hour12: false })}）。同事看不到，匯出後才會送出。`; });
$('#vx-reset').addEventListener('click', () => { if (!confirm('放棄這台電腦上的修改，回到目前上線版本？')) return; store.del(KEY); items = D.items.map((i) => ({ ...i })); orig = D.items; cur = 0; form = stateFromItem(items[0] ?? emptyState()); fill(form); paintAll(); $('#vx-msg').textContent = '已回到目前上線版本。'; });
$('#vx-copy').addEventListener('click', (e) => copyText(`${$('#vx-out').textContent}\n`, e.currentTarget));
$('#vx-dl').addEventListener('click', () => downloadText('immunization-schedule.json', `${$('#vx-out').textContent}\n`));
$('#vx-csv').addEventListener('click', () => downloadText('immunization-schedule.csv', scheduleCsv(sortedForExport(exported(), vaccineIds), vname, T2), 'text/csv'));
$('#vx-copydiff').addEventListener('click', (e) => {
  const d = diffSummary(D.items, exported());
  const lines = ['疫苗接種時程表修訂（content/master/immunization-schedule.json）', d.added.length ? `新增：${d.added.join('、')}` : '', d.removed.length ? `刪除：${d.removed.join('、')}` : '', d.changed.length ? `修改：${d.changed.join('、')}` : '', '', '依據：（請填疾管署公告名稱與日期）', '同步改了疫苗頁 publicFunded：（有／無，哪些頁）'].filter((l, i) => l !== '' || i > 3);
  copyText(`${lines.join('\n')}\n`, e.currentTarget);
});
document.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); $('#vx-save').click(); } });

/* 初始：?id=sched.xxx 直接跳到那一筆（前台「同事修改這份時程」可帶） */
const want = new URLSearchParams(location.search).get('id');
const wi = want ? items.findIndex((i) => i.id === want) : -1;
cur = wi >= 0 ? wi : 0;
form = stateFromItem(items[cur] ?? emptyState()); fill(form); paintAll();
if (store.get(KEY)?.savedAt) $('#vx-msg').textContent = `已載入這台電腦上的暫存（${new Date(store.get(KEY).savedAt).toLocaleString('zh-TW', { hour12: false })}）；要放棄請按「回到上線版本」。`;
