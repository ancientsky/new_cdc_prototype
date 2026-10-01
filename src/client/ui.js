// 共用互動：身分切換、details 單開、回報表單（元件 6）、訂閱、語言切換保留路徑、Banner 輪播、
// 態勢標籤浮層（元件 8）、tab、篩選、導覽收合、目錄捲動標示。全部用事件委派，動態插入的內容（答案頁）也適用。
import './i18n.js';

const root = document.documentElement;
const CDC = (window.CDC = window.CDC || {});
CDC.base = root.dataset.base || '';
CDC.langPath = root.dataset.langPath || '';
CDC.url = (p, { noLang = false } = {}) => (/^https?:|^tel:|^mailto:/.test(p) ? p : `${CDC.base}${noLang ? '' : CDC.langPath}${p.startsWith('/') ? p : `/${p}`}`);
CDC.api = async (name) => (await fetch(`${CDC.base}/v1/${name}.json`)).json();

/* ───────── localStorage（任何情況都不能丟例外） ───────── */
export const store = {
  get(k, fallback = null) { try { const v = localStorage.getItem(k); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
  getRaw(k) { try { return localStorage.getItem(k); } catch { return null; } },
  setRaw(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};
CDC.store = store;
const T = (k, v) => (CDC.t ? CDC.t(k, v) : k);
const qsa = (sel, el = document) => [...el.querySelectorAll(sel)];

/* ───────── 身分（民眾／專業）切換 ───────── */
const params = new URLSearchParams(location.search);
function applyView(v) {
  root.dataset.view = v;
  qsa('[data-view-set][aria-pressed]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.viewSet === v)));
  // 專業層：來源卡預設展開
  qsa('.c-source-card').forEach((d) => { if (v === 'pro') d.open = true; else if (d.dataset.autoOpened) { d.open = false; } if (v === 'pro') d.dataset.autoOpened = '1'; else delete d.dataset.autoOpened; });
}
CDC.setView = (v, persist = true) => { if (persist) store.setRaw('cdc.view', v); applyView(v); };
const qv = params.get('view');
if (qv === 'pro' || qv === 'public') store.setRaw('cdc.view', qv);
applyView(store.getRaw('cdc.view') === 'pro' ? 'pro' : 'public');
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-view-set]');
  if (!el) return;
  CDC.setView(el.dataset.viewSet);
  if (el.tagName === 'BUTTON' || (el.getAttribute('href') || '').startsWith('?')) e.preventDefault();
});

/* ───────── 稽核編號與回報（元件 6） ───────── */
const rnd = () => Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => (b % 36).toString(36)).join('').toUpperCase();
const stamp = () => new Date().toISOString().slice(0, 10).replaceAll('-', '');
CDC.newAuditId = () => `A-${stamp()}-${rnd()}`;
CDC.reports = {
  list: () => store.get('cdc.reports', []),
  add(r) { const all = CDC.reports.list(); all.push(r); store.set('cdc.reports', all); return r; },
};
function boxOf(el) { return el.closest('[data-feedback]'); }
function ensureAudit(box) {
  if (!box.dataset.auditId) box.dataset.auditId = CDC.newAuditId();
  box.querySelectorAll('[data-audit-slot]').forEach((s) => { s.textContent = box.dataset.auditId; });
  return box.dataset.auditId;
}
function refreshHelpful() {
  const map = store.get('cdc.helpful', {});
  const total = Object.keys(map).length;
  qsa('[data-feedback]').forEach((box) => {
    const key = box.dataset.auditId || box.dataset.page || location.pathname;
    const btn = box.querySelector('[data-act="helpful"]');
    if (!btn) return;
    btn.setAttribute('aria-pressed', String(!!map[key]));
    const c = btn.querySelector('.c-feedback__count');
    if (c) c.textContent = total ? `(${total})` : '';
  });
}
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-feedback] [data-act="helpful"]');
  if (!btn) return;
  const box = boxOf(btn);
  const key = box.dataset.auditId || box.dataset.page || location.pathname;
  const map = store.get('cdc.helpful', {});
  if (map[key]) delete map[key]; else map[key] = new Date().toISOString();
  store.set('cdc.helpful', map);
  refreshHelpful();
});
document.addEventListener('submit', (e) => {
  const form = e.target.closest('[data-feedback-form]');
  if (!form) return;
  e.preventDefault();
  const box = boxOf(form);
  const text = form.querySelector('textarea')?.value.trim();
  if (!text) return;
  const auditId = ensureAudit(box);
  CDC.reports.add({ id: `R-${stamp()}-${rnd()}`, auditId, page: box.dataset.page || location.pathname, text, at: new Date().toISOString() });
  form.reset();
  const done = form.querySelector('.c-feedback__done');
  if (done) done.hidden = false;
  // 同一頁再回報時換新編號
  delete box.dataset.reported;
});

/* ───────── details 單開（同一 data-group 內），含回報表單自動帶入編號 ───────── */
document.addEventListener('toggle', (e) => {
  const d = e.target;
  if (!(d instanceof HTMLDetailsElement)) return;
  if (d.open && d.classList.contains('c-feedback__report')) { const box = boxOf(d); if (box) ensureAudit(box); const done = d.querySelector('.c-feedback__done'); if (done) done.hidden = true; }
  const g = d.dataset.group;
  if (!g || !d.open) return;
  const pro = root.dataset.view === 'pro';
  const exempt = (el) => pro && el.classList.contains('c-source-card');
  if (exempt(d)) return;
  qsa(`details[data-group="${g}"][open]`).forEach((o) => { if (o !== d && !exempt(o) && !o.contains(d) && !d.contains(o)) o.open = false; });
}, true);

/* ───────── 訂閱與引用（專業層） ───────── */
function subs() { const v = store.get('cdc.subscriptions', []); return Array.isArray(v) ? v : []; }
function refreshSubs() {
  const s = subs();
  qsa('[data-subscribe]').forEach((b) => {
    const on = s.includes(b.dataset.subscribe);
    b.setAttribute('aria-pressed', String(on));
    b.textContent = on ? (b.dataset.on || T('pro.subscribed')) : (b.dataset.off || T('pro.subscribe'));
  });
}
CDC.subscriptions = { list: subs, refresh: refreshSubs };
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-subscribe]');
  if (!b) return;
  let s = subs();
  const id = b.dataset.subscribe;
  s = s.includes(id) ? s.filter((x) => x !== id) : [...s, id];
  store.set('cdc.subscriptions', s);
  refreshSubs();
});
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-cite]');
  if (!b) return;
  const text = `${b.dataset.citeTitle}. ${b.dataset.citeOwner}. ${T('prov.reviewed')} ${b.dataset.citeReviewed}. ${location.origin}${location.pathname}`;
  try { await navigator.clipboard.writeText(text); } catch { /* 無剪貼簿權限時略過 */ }
  const old = b.textContent; b.textContent = T('pro.cited'); setTimeout(() => { b.textContent = old; }, 1800);
});
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-copy-target]');
  if (!b) return;
  const el = document.getElementById(b.dataset.copyTarget);
  try { await navigator.clipboard.writeText(el?.innerText ?? ''); } catch { /* ignore */ }
  const old = b.textContent; b.textContent = b.dataset.done || T('copied'); setTimeout(() => { b.textContent = old; }, 1800);
});

/* ───────── 語言切換保留目前路徑（含 ?q= 與 #hash）；填入 ?q= ───────── */
qsa('.langs a[data-same="1"]').forEach((a) => { a.setAttribute('href', a.getAttribute('href') + location.search + location.hash); });
qsa('[data-fill-q]').forEach((i) => { const q = params.get('q'); if (q && !i.value) i.value = q; });
qsa('[data-fill-param]').forEach((i) => { const v = params.get(i.dataset.fillParam); if (v) i.value = v; });

/* ───────── Banner 輪播（不自動播放；可暫停／手動切換／鍵盤） ───────── */
qsa('[data-carousel]').forEach((car) => {
  const slides = qsa('[data-slide]', car);
  if (slides.length < 2) return;
  const ctl = car.querySelector('.c-carousel__ctl');
  if (ctl) ctl.hidden = false;
  const dots = qsa('[data-carousel-dot]', car);
  const cur = car.querySelector('[data-carousel-cur]');
  const play = car.querySelector('[data-carousel-play]');
  const live = car.querySelector('.c-carousel__slides');
  let i = 0, timer = null;
  const go = (n, focus = false) => {
    i = (n + slides.length) % slides.length;
    slides.forEach((s, k) => { s.hidden = k !== i; });
    dots.forEach((d, k) => d.setAttribute('aria-current', String(k === i)));
    if (cur) cur.textContent = String(i + 1);
    if (focus) slides[i].setAttribute('tabindex', '-1'), slides[i].focus({ preventScroll: true });
  };
  const stop = () => { clearInterval(timer); timer = null; if (play) { play.setAttribute('aria-pressed', 'false'); play.textContent = play.dataset.off; } if (live) live.setAttribute('aria-live', 'polite'); };
  const start = () => { timer = setInterval(() => go(i + 1), 7000); if (play) { play.setAttribute('aria-pressed', 'true'); play.textContent = play.dataset.on; } if (live) live.setAttribute('aria-live', 'off'); };
  car.querySelector('[data-carousel-prev]')?.addEventListener('click', () => go(i - 1));
  car.querySelector('[data-carousel-next]')?.addEventListener('click', () => go(i + 1));
  dots.forEach((d, k) => d.addEventListener('click', () => go(k)));
  if (play) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) play.hidden = true;
    play.addEventListener('click', () => (timer ? stop() : start()));
  }
  car.addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft') { go(i - 1); e.preventDefault(); } if (e.key === 'ArrowRight') { go(i + 1); e.preventDefault(); } if (e.key === ' ' && e.target === play) return; });
  car.addEventListener('focusin', () => { if (timer) stop(); });
  go(0);
});

/* ───────── 疫情狀態標籤浮層（元件 8；aria-describedby + 鍵盤） ───────── */
function closePops(except) { qsa('.c-status.is-open').forEach((s) => { if (s !== except) s.classList.remove('is-open'); }); }
document.addEventListener('click', (e) => {
  const tag = e.target.closest('.c-status-tag[aria-describedby]');
  if (tag) { const wrap = tag.closest('.c-status'); closePops(wrap); wrap.classList.toggle('is-open'); return; }
  if (!e.target.closest('.c-status__pop')) closePops();
});
document.addEventListener('keydown', (e) => {
  const tag = e.target.closest?.('.c-status-tag[aria-describedby]');
  if (tag && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); const wrap = tag.closest('.c-status'); closePops(wrap); wrap.classList.toggle('is-open'); }
  if (e.key === 'Escape') { closePops(); const a = document.activeElement; if (a?.classList?.contains('c-status-tag')) a.blur(); }
});

/* ───────── Tab（疾病索引、FAQ） ───────── */
qsa('[data-tabs]').forEach((box) => {
  const tabs = qsa('[role="tab"]', box);
  const panels = tabs.map((t) => document.getElementById(t.getAttribute('aria-controls')));
  const select = (n, focus = false) => {
    tabs.forEach((t, k) => { t.setAttribute('aria-selected', String(k === n)); t.tabIndex = k === n ? 0 : -1; });
    panels.forEach((p, k) => { if (p) p.hidden = k !== n; });
    if (focus) tabs[n].focus();
  };
  tabs.forEach((t, k) => {
    t.addEventListener('click', () => select(k));
    t.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') { select((k + 1) % tabs.length, true); e.preventDefault(); }
      if (e.key === 'ArrowLeft') { select((k - 1 + tabs.length) % tabs.length, true); e.preventDefault(); }
      if (e.key === 'Home') { select(0, true); e.preventDefault(); }
      if (e.key === 'End') { select(tabs.length - 1, true); e.preventDefault(); }
    });
  });
  select(0);
});

/* ───────── 篩選列（新聞、資料目錄）與文字篩選（疾病索引） ───────── */
const filterState = new Map();
function applyFilter(targetId) {
  const target = document.getElementById(targetId);
  if (!target) return;
  const st = filterState.get(targetId) || {};
  const rows = target.matches('table') ? qsa('tbody tr', target) : [...target.children];
  rows.forEach((r) => { r.hidden = Object.entries(st).some(([k, v]) => v && r.dataset[k] !== v); });
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('.c-filterbar button[data-v]');
  if (!b) return;
  const bar = b.closest('[data-filterbar]');
  const id = bar.dataset.filterbar;
  const st = filterState.get(id) || {};
  st[bar.dataset.key] = b.dataset.v;
  filterState.set(id, st);
  qsa('button[data-v]', bar).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  applyFilter(id);
});
qsa('input[data-filter-input]').forEach((inp) => {
  const target = document.getElementById(inp.dataset.filterInput);
  inp.addEventListener('input', () => {
    const q = inp.value.trim().toLowerCase();
    qsa('[data-text]', target).forEach((el) => { el.hidden = !!q && !el.dataset.text.includes(q); });
    qsa('[data-filter-group]', target).forEach((g) => { g.hidden = !!q && qsa('[data-text]', g).every((el) => el.hidden); });
    if (q) qsa('[data-tabs] [role="tabpanel"]', target.parentElement).forEach((p) => { p.hidden = false; });
  });
});

/* ───────── 旅遊目的地選擇 ───────── */
qsa('[data-travel-form]').forEach((f) => {
  const sel = f.querySelector('[data-travel-select]');
  sel?.addEventListener('change', () => { if (sel.value) location.href = sel.value; });
  f.addEventListener('submit', (e) => { e.preventDefault(); if (sel?.value) location.href = sel.value; });
});

/* ───────── 導覽收合、目錄捲動標示 ───────── */
const navBtn = document.querySelector('.c-nav__toggle');
navBtn?.addEventListener('click', () => {
  const nav = document.getElementById(navBtn.getAttribute('aria-controls'));
  const open = nav.classList.toggle('is-open');
  navBtn.setAttribute('aria-expanded', String(open));
});
const tocLinks = qsa('.c-toc a[href^="#"]');
if (tocLinks.length && 'IntersectionObserver' in window) {
  const map = new Map(tocLinks.map((a) => [a.getAttribute('href').slice(1), a]));
  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => { if (en.isIntersecting) { tocLinks.forEach((a) => a.classList.remove('is-active')); map.get(en.target.id)?.classList.add('is-active'); } });
  }, { rootMargin: '-10% 0px -75% 0px' });
  map.forEach((_, id) => { const s = document.getElementById(id); if (s) io.observe(s); });
}

refreshHelpful();
refreshSubs();
// 動態內容（答案頁）插入後，D 可呼叫 CDC.refresh() 重新同步狀態
CDC.refresh = () => { refreshHelpful(); refreshSubs(); applyView(root.dataset.view); };
