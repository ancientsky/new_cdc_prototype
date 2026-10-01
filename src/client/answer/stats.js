// 開放資料與統計頁（/data/）的統計問答：掛 #stats-form／#stats-q／#stats-result。
// 數字只來自資料目錄中的結構化時序（datasets[].series），附數字的來源卡；不推論、不預測。
import { loadEngine, esc, LANG } from './data.js';
import { L, statsBlock, refusalCard, disclosureRow, wireInteractions, ensureStyles } from './render.js';

ensureStyles();
const form = document.getElementById('stats-form');
const input = document.getElementById('stats-q') ?? form?.querySelector('input[name="q"]');
const out = document.getElementById('stats-result');
let current = null;

if (form && out) {
  out.classList.add('ask-page', 'c-stats-page');
  wireInteractions(out, () => current);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = input?.value.trim() ?? '';
    const sp = new URLSearchParams(location.search); if (q) sp.set('q', q); else sp.delete('q');
    history.replaceState(null, '', `${location.pathname}?${sp}`);
    ask(q);
  });
  document.querySelectorAll('[data-stats-chip]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); if (input) input.value = a.textContent.trim(); form.requestSubmit ? form.requestSubmit() : ask(a.textContent.trim()); }));
  const q = new URLSearchParams(location.search).get('q');
  if (q) { if (input) input.value = q; ask(q); }
}

async function ask(q) {
  if (!q) { out.innerHTML = ''; return; }
  out.setAttribute('aria-busy', 'true');
  out.innerHTML = '<div class="c-skeleton" aria-hidden="true"><span></span><span class="short"></span></div>';
  const { engine } = await loadEngine('public');
  const r = engine.answer(q, { lang: LANG, forceIntent: 'stats' });
  current = r;
  const parts = [];
  if (r.paused) parts.push(`<div class="c-banner--paused" role="status"><p>${esc(L('paused'))}</p></div>`);
  if (r.refused) parts.push(refusalCard(r));
  else if (r.stats) parts.push(await statsBlock(r));
  else parts.push(refusalCard({ ...r, refusal: { kind: 'no-data', title: '找不到對應的統計資料', text: '資料目錄中沒有可直接回答的統計序列。統計問答只回答已結構化的資料，不推論、不預測。', actions: [{ label: '看資料目錄', href: '/data/#catalog' }] } }));
  parts.push(disclosureRow(r));
  out.innerHTML = parts.join('\n');
  out.setAttribute('aria-busy', 'false');
}
