// @ts-check
// 頁內問題框委派（ARCHITECTURE.md 11.2／11.3）：/report/、/lab/、/apply/ 等頁若放了問題框
// （#ask-inline 或任何帶 data-ask-inline 的 form），送出 → 導向 /ask/?q=…（專業頁加 &view=pro）。
// 不載入答案引擎，只做導頁；ui.js 也會 import 這支（/ask/ 頁上的同型問題框一樣能用）。
//
// 標記方式（C2 模板）：
//   <form id="ask-inline" data-ask-inline="pro"> <input name="q"> </form>
//   data-ask-inline="pro" | "public" | ""（空值：/lab/、/report/ 頁或 html[data-view=pro] 時自動用專業模式）
//   也可在 form 內放 <input type="hidden" name="view" value="pro">。

const root = document.documentElement;

/** @param {string} q @param {boolean} pro */
function askUrl(q, pro) {
  const sp = new URLSearchParams();
  sp.set('q', q);
  if (pro) sp.set('view', 'pro');
  const path = window.CDC?.url ? window.CDC.url('/ask/') : `${root.dataset.base || ''}${root.dataset.langPath || ''}/ask/`;
  return `${path}?${sp.toString()}`;
}

/** @param {HTMLElement} form */
function wantsPro(form) {
  const v = form.dataset.askInline ?? form.dataset.view ?? '';
  if (v === 'pro') return true;
  if (v === 'public') return false;
  const hidden = /** @type {HTMLInputElement | null} */ (form.querySelector('input[name="view"]'))?.value;
  if (hidden) return hidden === 'pro';
  return root.dataset.view === 'pro' || /\/(lab|report)\//.test(location.pathname);
}

/** @param {Document} [doc] */
export function wireInlineAsk(doc = document) {
  // 已掛過就不再掛第二次（旗標掛在 document 上，型別宣告裡沒有這個欄位，所以轉 any）
  const flagged = /** @type {any} */ (doc);
  if (flagged.__cdcInlineAsk) return;
  flagged.__cdcInlineAsk = true;
  doc.addEventListener('submit', (e) => {
    const form = /** @type {HTMLFormElement | null | undefined} */ (/** @type {Element} */ (e.target).closest?.('form[data-ask-inline], form#ask-inline'));
    if (!form) return;
    // /ask/ 頁本身的主問題框由 ui.js 處理
    if (form.id === 'ask-form') return;
    const input = /** @type {HTMLInputElement | HTMLTextAreaElement | null} */ (form.querySelector('input[name="q"], input[type="search"], textarea[name="q"]'));
    const q = String(input?.value ?? '').trim();
    e.preventDefault();
    if (!q) { input?.focus(); return; }
    location.assign(askUrl(q, wantsPro(form)));
  });
  // 範例問題按鈕：<button data-ask-inline-q="登革熱檢體容器">
  doc.addEventListener('click', (e) => {
    const b = /** @type {HTMLElement | null | undefined} */ (/** @type {Element} */ (e.target).closest?.('[data-ask-inline-q]'));
    if (!b) return;
    e.preventDefault();
    const form = /** @type {HTMLFormElement | null} */ (b.closest('form[data-ask-inline], form#ask-inline'));
    location.assign(askUrl(b.dataset.askInlineQ, form ? wantsPro(form) : /\/(lab|report)\//.test(location.pathname)));
  });
}

wireInlineAsk();
