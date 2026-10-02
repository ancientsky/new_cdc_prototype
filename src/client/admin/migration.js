// /admin/migration/ 移轉進度：72＋ 份清單的摘要表——篩選（有頁／無頁／人工／推導／單位）、排序（預設待移轉最多）、搜尋、
// 展開單一清單看逐筆、匯出 CSV、對照檔預覽。篩選／排序／展開狀態記在 localStorage（cdc.admin.migration.v2）與網址 # 之後（可貼給同事；# 優先）。
import { $, $$, store, toCSV, downloadText, today } from './common.js';

const table = $('#mg-table');
function main() {
  const KEY = 'cdc.admin.migration.v2';
  const lists = $$('tbody.mg-list', table);
  const DEFAULT = { f: 'all', u: 'all', s: 'pending', q: '', open: [] };
  const FILTERS = ['all', 'has', 'no', 'curated', 'derived'];
  const SORTS = ['pending', 'pct', 'name', 'cat', 'total'];

  /* ───────── 狀態：URL hash 優先，其次 localStorage ───────── */
  function fromHash() {
    const h = location.hash.replace(/^#/, '');
    if (!h || !h.includes('=')) return null;
    const p = new URLSearchParams(h);
    return { f: p.get('f'), u: p.get('u'), s: p.get('s'), q: p.get('q'), open: p.get('open') ? p.get('open').split(',').filter(Boolean) : null };
  }
  function sanitize(o) {
    const st = { ...DEFAULT, ...Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => v != null)) };
    if (!FILTERS.includes(st.f)) st.f = DEFAULT.f;
    if (!SORTS.includes(st.s)) st.s = DEFAULT.s;
    st.q = String(st.q ?? '');
    st.u = String(st.u ?? 'all');
    st.open = Array.isArray(st.open) ? st.open.map(String) : [];
    return st;
  }
  let state = sanitize({ ...store.get(KEY, {}), ...Object.fromEntries(Object.entries(fromHash() ?? {}).filter(([, v]) => v != null)) });

  function save() {
    store.set(KEY, state);
    const p = new URLSearchParams();
    if (state.f !== DEFAULT.f) p.set('f', state.f);
    if (state.u !== DEFAULT.u) p.set('u', state.u);
    if (state.s !== DEFAULT.s) p.set('s', state.s);
    if (state.q) p.set('q', state.q);
    if (state.open.length) p.set('open', state.open.join(','));
    const h = p.toString();
    try { history.replaceState(null, '', `${location.pathname}${location.search}${h ? `#${h}` : ''}`); } catch { /* file:// 等 */ }
  }

  /* ───────── 篩選與排序 ───────── */
  const num = (el, k) => Number(el.dataset[k] ?? 0);
  const SORTERS = {
    pending: (a, b) => num(b, 'pending') - num(a, 'pending') || num(b, 'total') - num(a, 'total') || a.dataset.name.localeCompare(b.dataset.name, 'zh-Hant'),
    pct: (a, b) => num(a, 'pct') - num(b, 'pct') || num(b, 'pending') - num(a, 'pending'),
    name: (a, b) => a.dataset.name.localeCompare(b.dataset.name, 'zh-Hant'),
    cat: (a, b) => num(a, 'cat') - num(b, 'cat') || num(b, 'pending') - num(a, 'pending'),
    total: (a, b) => num(b, 'total') - num(a, 'total') || num(b, 'pending') - num(a, 'pending'),
  };
  function matches(el) {
    const d = el.dataset;
    if (state.f === 'has' && d.has !== '1') return false;
    if (state.f === 'no' && d.has !== '0') return false;
    if (state.f === 'curated' && d.mode !== 'curated') return false;
    if (state.f === 'derived' && d.mode !== 'derived') return false;
    if (state.u !== 'all' && d.owner !== state.u) return false;
    const q = state.q.trim().toLowerCase();
    return !q || d.q.includes(q);
  }
  function setExpanded(tb, open) {
    const btn = $('.mg-toggle', tb), ex = $('.mg-list__ex', tb);
    if (!btn || !ex) return;
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    $('.mg-toggle__ic', btn).textContent = open ? '▾' : '▸';
    ex.hidden = !open;
  }
  function render() {
    let n = 0;
    for (const tb of [...lists].sort(SORTERS[state.s])) table.appendChild(tb);
    for (const tb of lists) {
      const ok = matches(tb);
      tb.hidden = !ok;
      if (ok) n++;
      setExpanded(tb, ok && state.open.includes(tb.dataset.listRow));
    }
    $$('#mg-f [data-f]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.f === state.f)));
    $('#mg-unit').value = [...$('#mg-unit').options].some((o) => o.value === state.u) ? state.u : 'all';
    $('#mg-sort').value = state.s;
    if ($('#mg-q').value !== state.q) $('#mg-q').value = state.q;
    $('#mg-note').textContent = lists.length ? `${n} / ${lists.length} 份清單` : '';
  }
  const update = (patch) => { state = sanitize({ ...state, ...patch }); save(); render(); };

  $$('#mg-f [data-f]').forEach((b) => b.addEventListener('click', () => update({ f: b.dataset.f })));
  $('#mg-unit').addEventListener('change', (e) => update({ u: e.target.value }));
  $('#mg-sort').addEventListener('change', (e) => update({ s: e.target.value }));
  $('#mg-q').addEventListener('input', (e) => update({ q: e.target.value }));
  $$('.mg-toggle', table).forEach((b) => b.addEventListener('click', () => {
    const id = b.dataset.toggle;
    update({ open: state.open.includes(id) ? state.open.filter((x) => x !== id) : [...state.open, id] });
  }));
  $('#mg-expand')?.addEventListener('click', () => {
    const vis = lists.filter((tb) => !tb.hidden).map((tb) => tb.dataset.listRow);
    const allOpen = vis.every((id) => state.open.includes(id));
    update({ open: allOpen ? state.open.filter((id) => !vis.includes(id)) : [...new Set([...state.open, ...vis])] });
  });
  // 展開內：只看待移轉
  table.addEventListener('change', (e) => {
    const cb = e.target.closest('[data-only-pending]');
    if (!cb) return;
    $$('tbody tr[data-status]', cb.closest('.mg-list__ex')).forEach((tr) => { tr.hidden = cb.checked && tr.dataset.status !== 'pending'; });
  });
  window.addEventListener('hashchange', () => { const h = fromHash(); if (h) { state = sanitize({ ...state, ...Object.fromEntries(Object.entries(h).filter(([, v]) => v != null)) }); render(); } });

  /* ───────── 匯出 ───────── */
  $('#mg-csv')?.addEventListener('click', () => {
    const head = ['疾病', '法定類別', '疾病頁', '已移轉', '已併入', '待移轉', '完成度', '方式', '權責單位', '清單 id'];
    const data = lists.filter((tb) => !tb.hidden).map((tb) => {
      const td = $$('.mg-list__row > *', tb);
      return [$('.mg-toggle__t', tb).textContent.trim(), td[1].textContent.trim(), td[2].textContent.trim(), td[3].textContent.trim(), td[4].textContent.trim(), td[5].textContent.trim(), `${tb.dataset.pct}%`, td[7].textContent.trim(), td[8].textContent.trim(), tb.dataset.listRow];
    });
    downloadText(`cdc-migration-lists-${today()}.csv`, toCSV([head, ...data]), 'text/csv');
  });
  $('#mg-csv-items')?.addEventListener('click', () => {
    const head = ['清單', '舊標題', '舊網址', '狀態', '核對', '對應新頁', '權責單位'];
    const data = [];
    for (const tb of lists.filter((x) => !x.hidden && !$('.mg-list__ex', x).hidden)) {
      for (const tr of $$('.mg-items tbody tr', tb).filter((r) => !r.hidden)) {
        const td = $$('td', tr);
        data.push([$('.mg-toggle__t', tb).textContent.trim(), td[0].querySelector('strong').textContent, td[1].textContent.trim().replace(/\s+/g, ' '), td[2].textContent.trim(), td[3].textContent.trim(), td[4].textContent.trim().replace(/\s+/g, ' '), td[5].textContent.trim()]);
      }
    }
    if (!data.length) { $('#mg-note').textContent = '請先展開至少一份清單'; return; }
    downloadText(`cdc-migration-items-${today()}.csv`, toCSV([head, ...data]), 'text/csv');
  });

  render();
}
if (table) main();

$$('[data-preview]').forEach((b) => b.addEventListener('click', async () => {
  const pre = $('#mg-preview');
  pre.hidden = false;
  try {
    const r = await fetch(b.dataset.preview);
    if (!r.ok) throw new Error(String(r.status));
    pre.textContent = `${b.dataset.preview}\n${'─'.repeat(40)}\n${(await r.text()).split('\n').slice(0, 8).join('\n')}`;
  } catch { pre.textContent = `${b.dataset.preview}\n（尚未建置此檔，或在本機預覽時讀不到）`; }
}));

