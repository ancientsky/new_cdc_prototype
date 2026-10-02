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
if (root.dataset.forceView) store.setRaw('cdc.view', root.dataset.forceView);
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
const tokens = (v) => String(v ?? '').split(/\s+/).filter(Boolean);
function applyFilter(targetId) {
  const target = document.getElementById(targetId);
  if (!target) return;
  const st = filterState.get(targetId) || {};
  const rows = target.matches('table') ? qsa('tbody tr', target) : [...target.children];
  rows.forEach((r) => { r.hidden = Object.entries(st).some(([k, v]) => v && !tokens(r.dataset[k]).includes(v)); });
  const n = rows.filter((r) => !r.hidden).length;
  qsa(`[data-filter-count="${targetId}"]`).forEach((c) => { c.textContent = Object.values(st).some(Boolean) ? T('filter.count', { n, total: rows.length }) : ''; });
  // 篩選後沒有任何結果時，顯示 target 後面的空狀態（若有）
  const empty = document.querySelector(`[data-filter-empty="${targetId}"]`);
  if (empty) empty.hidden = n > 0;
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
document.addEventListener('change', (e) => {
  const sel = e.target.closest('select[data-filter-select]');
  if (!sel) return;
  const id = sel.dataset.filterSelect;
  const st = filterState.get(id) || {};
  st[sel.dataset.key] = sel.value;
  filterState.set(id, st);
  applyFilter(id);
});
qsa('input[data-filter-input]').forEach((inp) => {
  const target = document.getElementById(inp.dataset.filterInput);
  inp.addEventListener('input', () => {
    const q = inp.value.trim().toLowerCase();
    qsa('[data-text]', target).forEach((el) => { el.hidden = !!q && !el.dataset.text.includes(q); });
    qsa('[data-filter-group]', target).forEach((g) => { g.hidden = !!q && qsa('[data-text]', g).every((el) => el.hidden); });
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

/* ═════════ 第二輪：影音播放器、逐字稿、複製、勾選清單、署長信箱 ═════════ */
const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
async function copyText(text, btn) {
  try { await navigator.clipboard.writeText(text); } catch {
    const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.append(ta); ta.select();
    try { document.execCommand('copy'); } catch { /* ignore */ } ta.remove();
  }
  if (btn) { const old = btn.textContent; btn.textContent = btn.dataset.done || T('copied'); setTimeout(() => { btn.textContent = old; }, 1800); }
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-copy-text]');
  if (b) copyText(b.dataset.copyText, b);
});

/* 影片：點擊才載入 youtube-nocookie；章節可跳轉（尚未載入就從該秒開始載入）；無 id 的示意影片只提示並展開逐字稿 */
function loadPlayer(box, start = 0) {
  const id = box.dataset.yt;
  if (!id) return false;
  const stage = box.querySelector('[data-player-stage]');
  const q = new URLSearchParams({ autoplay: '1', rel: '0', ...(start ? { start: String(Math.floor(start)) } : {}) });
  const src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?${q}`;
  let ifr = box.querySelector('iframe');
  if (!ifr) {
    ifr = document.createElement('iframe');
    ifr.className = 'c-player__frame';
    ifr.title = box.dataset.title || 'YouTube';
    ifr.allow = 'accelerometer; autoplay; encrypted-media; picture-in-picture; fullscreen';
    ifr.allowFullscreen = true;
    ifr.referrerPolicy = 'strict-origin-when-cross-origin';
    ifr.setAttribute('loading', 'lazy');
    stage.replaceChildren(ifr);
  }
  ifr.src = src;
  stage.classList.add('is-playing');
  return true;
}
document.addEventListener('click', (e) => {
  const load = e.target.closest('[data-player-load]');
  if (load) { const bx = load.closest('[data-player]'); loadPlayer(bx, Number(bx.dataset.startAt) || 0); return; }
  const seek = e.target.closest('[data-seek]');
  if (!seek) return;
  const box = document.querySelector('[data-player]');
  const t0 = Number(seek.dataset.seek) || 0;
  if (box && loadPlayer(box, t0)) { box.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
  // 示意影片：展開逐字稿
  const tr = document.getElementById('transcript');
  if (tr) { tr.open = true; tr.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
});
/* #t=秒（答案頁引用連結）：捲到對應章節、標示，並讓播放器之後從該秒開始 */
function applyHashTime() {
  const m = location.hash.match(/^#t=(\d+)/);
  if (!m) return;
  const sec = Number(m[1]);
  const box = document.querySelector('[data-player]');
  if (box?.dataset.yt) box.dataset.startAt = String(sec);
  const chapters = qsa('.c-chapters li[id^="ch-"]');
  let hit = null;
  chapters.forEach((li) => { if (Number(li.id.slice(3)) <= sec) hit = li; li.classList.remove('is-current'); });
  if (hit) { hit.classList.add('is-current'); hit.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
  else document.getElementById('transcript')?.setAttribute('open', '');
}
applyHashTime();
window.addEventListener('hashchange', applyHashTime);

/* 逐字稿搜尋與高亮（只處理文字節點，不破壞結構） */
qsa('[data-transcript]').forEach((wrap) => {
  const input = wrap.querySelector('[data-transcript-search]');
  const body = wrap.querySelector('#transcript-body');
  const count = wrap.querySelector('[data-transcript-count]');
  if (!input || !body) return;
  const clear = () => { qsa('mark.c-hit', body).forEach((m) => { m.replaceWith(document.createTextNode(m.textContent)); }); body.normalize(); };
  const run = () => {
    clear();
    const q = input.value.trim();
    if (!q) { count.textContent = ''; return; }
    const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
    let n = 0;
    nodes.forEach((node) => {
      const text = node.nodeValue; re.lastIndex = 0;
      if (!re.test(text)) return;
      re.lastIndex = 0;
      const frag = document.createDocumentFragment(); let last = 0, m;
      while ((m = re.exec(text))) { frag.append(text.slice(last, m.index)); const mk = document.createElement('mark'); mk.className = 'c-hit'; mk.textContent = m[0]; frag.append(mk); last = m.index + m[0].length; n++; if (m[0].length === 0) re.lastIndex++; }
      frag.append(text.slice(last)); node.replaceWith(frag);
    });
    count.textContent = n ? T('media.transcript.hits', { n }) : T('media.transcript.nohit');
    const first = body.querySelector('mark.c-hit'); if (first) first.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };
  let tm = null;
  input.addEventListener('input', () => { clearTimeout(tm); tm = setTimeout(run, 150); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); run(); } });
  wrap.addEventListener('toggle', () => { if (!wrap.open) { input.value = ''; clear(); count.textContent = ''; } });
});

/* 應備文件勾選清單：存 localStorage cdc.checklist = { [serviceId]: [index…] }（無痕模式時只在本頁有效） */
qsa('[data-checklist]').forEach((list) => {
  const id = list.dataset.checklist;
  const boxes = qsa('input[data-check]', list);
  const prog = list.parentElement.querySelector('[data-check-prog]');
  const all = () => store.get('cdc.checklist', {});
  const render = () => {
    const done = boxes.filter((b) => b.checked).length;
    if (prog) prog.textContent = T('apply.docs.prog', { done, total: boxes.length });
  };
  const saved = new Set(all()[id] ?? []);
  boxes.forEach((b) => { b.checked = saved.has(Number(b.dataset.check)); });
  const save = () => { const m = all(); m[id] = boxes.filter((b) => b.checked).map((b) => Number(b.dataset.check)); store.set('cdc.checklist', m); render(); };
  boxes.forEach((b) => b.addEventListener('change', save));
  list.parentElement.querySelector('[data-check-reset]')?.addEventListener('click', () => { boxes.forEach((b) => { b.checked = false; }); save(); });
  render();
});

/* 署長信箱（示範）：分類 → 顯示分流單位；送出 → 信件預覽、mailto、複製；本機記錄 cdc.mailbox（不含 email） */
qsa('[data-mailbox]').forEach((root) => {
  const form = root.querySelector('[data-mailbox-form]');
  const cat = root.querySelector('[data-mb-cat]');
  const route = root.querySelector('[data-mb-route]');
  const err = root.querySelector('[data-mb-err]');
  const pv = root.querySelector('[data-mb-preview]');
  const addr = root.dataset.addr;
  const optOf = () => cat.selectedOptions[0];
  const setRoute = () => {
    const o = optOf();
    route.textContent = o && o.value ? route.dataset.tpl.replace('{unit}', o.dataset.unit) : route.dataset.empty;
  };
  cat.addEventListener('change', setRoute);
  const logList = root.querySelector('[data-mb-log]');
  const renderLog = () => {
    const rows = store.get('cdc.mailbox', []);
    logList.innerHTML = rows.length ? rows.slice().reverse().map((r) => `<li><time>${esc(r.at.slice(0, 16).replace('T', ' '))}</time> · ${esc(r.categoryLabel)} → ${esc(r.unit)}<br><strong>${esc(r.subject)}</strong></li>`).join('') : `<li class="muted">${esc(T('none'))}</li>`;
  };
  renderLog();
  root.querySelector('[data-mb-clear]')?.addEventListener('click', () => { store.set('cdc.mailbox', []); renderLog(); });
  root.querySelector('[data-mb-edit]')?.addEventListener('click', () => { pv.hidden = true; form.hidden = false; form.querySelector('input,select,textarea')?.focus(); });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const o = optOf();
    const subject = String(fd.get('subject') || '').trim();
    const body = String(fd.get('body') || '').trim();
    const email = String(fd.get('email') || '').trim();
    const okEmail = !email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    if (!o?.value || !subject || !body || !fd.get('consent') || !okEmail) { err.hidden = false; (!o?.value ? cat : !subject ? form.subject : !body ? form.body : !okEmail ? form.email : form.consent).focus(); return; }
    err.hidden = true;
    const unit = o.dataset.unit, label = o.dataset.label;
    const subj = `[${T('contact.mail.prefix')}][${label}] ${subject}`;
    const text = `${T('contact.pv.to')}: ${addr}\n${T('contact.pv.route')}: ${unit}\n${T('contact.pv.subject')}: ${subj}\n${email ? `${T('contact.f.email')}: ${email}\n` : ''}\n${body}\n\n--\n${T('contact.mail.foot')}`;
    root.querySelector('[data-mb-pv-unit]').textContent = unit;
    root.querySelector('[data-mb-pv-subject]').textContent = subj;
    root.querySelector('[data-mb-pv-body]').textContent = text;
    root.querySelector('[data-mb-mailto]').href = `mailto:${addr}?subject=${encodeURIComponent(subj)}&body=${encodeURIComponent(`${body}\n\n${email ? `${T('contact.f.email')}: ${email}\n` : ''}-- ${T('contact.mail.foot')}`)}`;
    const rows = store.get('cdc.mailbox', []);
    rows.push({ at: new Date().toISOString(), category: o.value, categoryLabel: label, unit, subject, body });
    const saved = store.set('cdc.mailbox', rows.slice(-20));
    root.querySelector('[data-mb-saved]').hidden = !saved;
    renderLog();
    form.hidden = true; pv.hidden = false; pv.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    root.querySelector('[data-mb-mailto]').focus();
  });
});
