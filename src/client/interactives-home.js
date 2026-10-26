// 首頁的互動模組（第六十二輪）：只在「歷史上的今天」小卡或彩蛋開啟時才載入（home.mjs meta）。
//   1. 歷史上的今天小卡：建置時放的是建置日的條目（示範站凍結在 BUILD_TODAY、主站每 2 小時重建），這裡依瀏覽器日期
//      從 /v1/interactives/<slug>.json 重挑；同一天就什麼都不做。抓不到就留建置版本。
//   2. 彩蛋：連點站名圖示 N 下（3 秒內）或在頁面上依序輸入指定按鍵（不在輸入框時）→ 開一個小對話框（可選倒數計時）。
//      文字全部來自內容 JSON（data 屬性），用 textContent 寫入；Esc／關閉鈕關閉；焦點進出都處理；沒有動畫。
const T = (k, v) => (window.CDC?.t ? window.CDC.t(k, v) : k);
const el = (tag, attrs = {}, ...children) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (v == null || v === false) continue; if (k === 'text') n.textContent = String(v); else if (k === 'class') n.className = v; else n.setAttribute(k, v === true ? '' : String(v)); }
  for (const c of children.flat()) if (c != null && c !== false) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return n;
};

/* ───── 歷史上的今天小卡 ───── */
async function initOtdCard(card) {
  const d = new Date();
  const mmdd = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (card.dataset.today === mmdd || !card.dataset.otdSrc) return;
  let data;
  try { const r = await fetch(card.dataset.otdSrc); if (!r.ok) return; data = await r.json(); } catch { return; }
  const entries = (data?.entries ?? []).slice().sort((a, b) => a.month - b.month || a.day - b.day || a.year - b.year);
  if (!entries.length) return;
  const key = (e) => `${String(e.month).padStart(2, '0')}-${String(e.day).padStart(2, '0')}`;
  let pick = entries.filter((e) => key(e) === mmdd), exact = true;
  if (!pick.length) { exact = false; const next = entries.find((e) => key(e) > mmdd) ?? entries[0]; pick = entries.filter((e) => key(e) === key(next)); }
  const list = card.querySelector('[data-otd-pick]');
  list.replaceChildren(...pick.map((e) => el('li', { class: `c-otd__item${e.verified ? '' : ' c-otd__item--unverified'}` },
    el('b', { class: 'c-otd__year', text: e.year }), ' ', el('span', { class: 'c-otd__text', text: e.text }),
    e.verified ? null : [' ', el('span', { class: 'c-pill c-pill--warn', text: T('otd.unverified') })],
    e.link ? [' ', el('a', { class: 'c-otd__link', href: (window.CDC?.url ? window.CDC.url(e.link) : e.link), text: `${T('otd.more')} →` })] : null)));
  const near = card.querySelector('[data-otd-date]');
  if (near) { near.hidden = exact; near.textContent = exact ? '' : T('otd.near', { date: key(pick[0]).replace('-', '/') }); }
  card.dataset.today = mmdd;
}

/* ───── 彩蛋 ───── */
function initEgg(cfg) {
  const d = cfg.dataset;
  const triggers = (d.eggTriggers ?? '').split(',').filter(Boolean);
  const taps = Math.max(3, Number(d.eggTaps) || 5);
  const keys = (d.eggKeys || '1922').toLowerCase();
  const timer = Number(d.eggTimer) || 0;
  let dialog = null, lastFocus = null, tick = null;
  const close = () => { if (!dialog) return; clearInterval(tick); tick = null; dialog.remove(); dialog = null; document.removeEventListener('keydown', onKey); lastFocus?.focus?.(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
  const open = () => {
    if (dialog) return;
    lastFocus = document.activeElement;
    const h = el('h2', { id: 'egg-h', class: 'c-egg__h', text: d.eggTitle || '' });
    const box = el('div', { class: 'c-egg__box', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'egg-h' }, h, el('p', { class: 'c-egg__text', text: d.eggText || '' }));
    if (timer) {
      const num = el('p', { class: 'c-egg__timer', role: 'timer', 'aria-live': 'off', text: T('egg.seconds', { n: timer }) });
      const status = el('p', { class: 'c-egg__status', role: 'status', 'aria-live': 'polite' });
      const start = el('button', { type: 'button', class: 'c-btn', text: d.eggStart || T('egg.start') });
      start.addEventListener('click', () => {
        let n = timer; start.disabled = true; status.textContent = ''; num.textContent = T('egg.seconds', { n });
        clearInterval(tick);
        tick = setInterval(() => { n--; num.textContent = T('egg.seconds', { n: Math.max(0, n) }); if (n <= 0) { clearInterval(tick); tick = null; status.textContent = d.eggDone || T('egg.done'); start.disabled = false; } }, 1000);
      });
      box.append(num, el('p', {}, start), status);
    }
    const foot = el('p', { class: 'c-egg__foot' });
    if (d.eggLink) foot.append(el('a', { href: d.eggLink, text: `${d.eggMore || T('egg.more')} →` }), ' ');
    const closeBtn = el('button', { type: 'button', class: 'c-btn c-btn--ghost c-btn--sm', text: d.eggClose || T('egg.close') });
    closeBtn.addEventListener('click', close);
    foot.append(closeBtn);
    box.append(foot, el('p', { class: 'c-egg__owner', text: d.eggOwner ? `${d.eggOwner}` : '' }));
    dialog = el('div', { class: 'c-egg', 'data-egg-dialog': true });
    dialog.addEventListener('click', (e) => { if (e.target === dialog) close(); });
    dialog.append(box);
    document.body.append(dialog);
    document.addEventListener('keydown', onKey);
    h.setAttribute('tabindex', '-1'); h.focus();
  };
  if (triggers.includes('brand-taps')) {
    const mark = document.querySelector('.brand__mark');
    let count = 0, first = 0;
    // 彩蛋只在首頁，站名連結本來就指向首頁：點圖示不重新載入（否則第 1 下就把計數歸零），改成捲到頂端；站名文字照常是連結
    mark?.addEventListener('click', (e) => {
      e.preventDefault();
      const now = Date.now();
      if (now - first > 3000) { count = 0; first = now; }
      count++;
      if (count >= taps) { count = 0; open(); } else if (count === 1) window.scrollTo({ top: 0 });
    });
  }
  if (triggers.includes('keys')) {
    let buf = '';
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return;
      const tgt = e.target;
      if (tgt instanceof HTMLElement && (tgt.closest('input, textarea, select, [contenteditable]'))) return;
      buf = (buf + e.key.toLowerCase()).slice(-keys.length);
      if (buf === keys) { buf = ''; open(); }
    });
  }
  window.__cdcEgg = { open, close }; // 供自動化測試
}

for (const card of document.querySelectorAll('[data-otd]')) initOtdCard(card);
const eggCfg = document.querySelector('[data-egg]');
if (eggCfg) initEgg(eggCfg);
