// 謠言查證頁（/factcheck/）：掛 #factcheck-form／#factcheck-input／#factcheck-result。
// 與答案頁同一份 core：強制謠言意圖（貼上的是網傳訊息本身），只比對官方澄清，不自行判定真偽。
import { loadEngine, esc, LANG } from './data.js';
import { L, verdictBlock, refusalCard, disclosureRow, sourceList, wireInteractions, ensureStyles } from './render.js';

ensureStyles();
const input = document.getElementById('factcheck-input');
const out = document.getElementById('factcheck-result');
const form = document.getElementById('factcheck-form') ?? input?.closest('form');
let current = null;

if (input && out) {
  out.classList.add('ask-page', 'c-factcheck-page');
  wireInteractions(out, () => current);
  form?.addEventListener('submit', (e) => { e.preventDefault(); check(input.value); });
  const q = new URLSearchParams(location.search).get('q');
  if (q) { input.value = q; check(q); }
}

async function check(text) {
  const q = String(text ?? '').trim();
  if (!q) { out.innerHTML = `<p class="muted">${esc(L('empty'))}</p>`; return; }
  out.setAttribute('aria-busy', 'true');
  out.innerHTML = '<div class="c-skeleton" aria-hidden="true"><span></span><span class="short"></span></div>';
  const { engine } = await loadEngine('public');
  const r = engine.answer(q, { lang: LANG, forceIntent: 'rumor' });
  current = r;
  const parts = [];
  if (r.paused) parts.push(`<div class="c-banner--paused" role="status"><p>${esc(L('paused'))}</p></div>`);
  if (r.refused) {
    if (r.verdict === 'unknown') parts.push(`<h2>${esc(L('verdictH'))} <span class="c-verdict c-verdict--unknown">${esc(L('verdict.unknown'))}</span></h2>`);
    parts.push(refusalCard(r));
  } else if (r.clarification) {
    parts.push(verdictBlock(r));
    parts.push(sourceList(r.sources));
  }
  parts.push(disclosureRow(r));
  out.innerHTML = parts.join('\n');
  out.setAttribute('aria-busy', 'false');
}
