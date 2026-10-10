// /glossary/ 的前端篩選（漸進增強）：沒有 JS 時整份詞彙表照常顯示，篩選框維持 hidden。
// 搜尋範圍：中文正名、英文、別名、舊稱（伺服器端已把它們放進每列的 data-q，小寫）。
import './i18n.js';

const T = (k, v) => (window.CDC?.t ? window.CDC.t(k, v) : k);
const form = document.querySelector('[data-glossary-filter]');
if (form) {
  form.hidden = false;
  const input = form.querySelector('input');
  const note = form.querySelector('[data-glossary-count]');
  const rows = [...document.querySelectorAll('.c-glossary__row')];
  const groups = [...document.querySelectorAll('[data-glossary-group]')];
  const empty = document.querySelector('[data-glossary-empty]');
  const apply = () => {
    const q = input.value.normalize('NFKC').trim().toLowerCase();
    let shown = 0;
    for (const r of rows) {
      const hit = !q || (r.dataset.q ?? '').includes(q);
      r.hidden = !hit;
      if (hit) shown++;
    }
    for (const g of groups) g.hidden = ![...g.querySelectorAll('.c-glossary__row')].some((r) => !r.hidden);
    if (empty) empty.hidden = shown > 0;
    if (note) note.textContent = q ? T('glossary.count', { n: shown, total: rows.length }) : '';
  };
  input.addEventListener('input', apply);
  form.addEventListener('submit', (e) => { e.preventDefault(); apply(); });
}
