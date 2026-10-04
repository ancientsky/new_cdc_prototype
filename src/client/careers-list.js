// /careers/ 列表的前端篩選：職類／地點／單位三個下拉，同時作用在五個分頁籤的職缺卡，並更新各分頁籤的計數與空狀態。
// 沒有 JS 時篩選列整個隱藏，列表仍完整可讀。
import './i18n.js';

const T = (k, v) => (window.CDC?.t ? window.CDC.t(k, v) : k);
const root = document.querySelector('[data-job-filters]');
if (root) {
  const selects = [...root.querySelectorAll('select[data-job-filter]')];
  const reset = root.querySelector('[data-job-reset]');
  const note = root.querySelector('[data-job-filter-note]');
  const cards = [...document.querySelectorAll('.c-job')];
  const apply = () => {
    const st = Object.fromEntries(selects.map((s) => [s.dataset.jobFilter, s.value]));
    const active = Object.values(st).some(Boolean);
    let shown = 0;
    cards.forEach((c) => {
      const hide = Object.entries(st).some(([k, v]) => v && c.dataset[k] !== v);
      c.hidden = hide;
      if (!hide) shown++;
    });
    document.querySelectorAll('[data-job-panel]').forEach((p) => {
      const id = p.dataset.jobPanel;
      const n = [...p.querySelectorAll('.c-job')].filter((c) => !c.hidden).length;
      const cnt = document.querySelector(`[data-job-count="${id}"]`);
      if (cnt) cnt.textContent = String(n);
      const empty = p.querySelector('[data-job-empty]');
      if (empty) empty.hidden = n > 0;
    });
    if (reset) reset.hidden = !active;
    if (note) note.textContent = active ? T('careers.filter.count', { n: shown, total: cards.length }) : '';
  };
  selects.forEach((s) => s.addEventListener('change', apply));
  root.addEventListener('submit', (e) => e.preventDefault());
  reset?.addEventListener('click', () => { selects.forEach((s) => { s.value = ''; }); apply(); selects[0]?.focus(); });
}
