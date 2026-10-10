// /subscribe/ 的 Email 訂閱（第二十八輪，Issue #38）。
//
// 結構：「畫面」只認一個 backend 介面，後面接哪一種實作由執行期偵測決定——
//   backend = {
//     kind: 'mock-browser' | 'mock-http',
//     subscribe({ email, topics, frequency, lang, consent, website }) → Result   // 寄確認信（雙重確認的第一步）
//     confirm(token)                → Result { status:'confirmed', manageToken, topics, frequency, lang }
//     status(manageToken)           → Result { status, email(遮罩), topics, frequency, lang }
//     update(manageToken, prefs)    → Result
//     unsubscribe(manageToken)      → Result { status:'unsubscribed' }
//     manageLink(email)             → Result   // 忘了管理連結：寄一封給已確認的信箱
//   }
//   Result = { ok:true, ...body } | { ok:false, error:'invalid'|'rate'|'expired'|'notfound'|'unsubscribed'|'full'|'network'|'server', fields?, retryAfter? }
// 兩種實作共用同一個狀態機（subscribe-service.js）與同一份驗證／信件內容（subscribe-rules.js）：
//   (a) createBrowserBackend：資料與「模擬收件匣」只存在這個瀏覽器的 localStorage，什麼都不送出（GitHub Pages 上就是這個）。
//   (b) createHttpBackend：呼叫 /api/subscriptions*（本機 node scripts/serve.mjs 的模擬後端，信件寫成 .eml）；正式寄信服務也走同一份契約。
// detectBackend()：先探 /api/health（1.5 秒內回得出 service 名稱才算），否則退回 (a)；網址加 ?backend=browser 可強制用 (a)。
// 安全：所有顯示一律用 textContent 與 DOM API 組畫面（不拼 HTML 字串）；token 只出現在信件連結與記憶體，讀完立刻從網址列移除。
import { t as i18nT } from './i18n.runtime.js';
import { TOPIC_IDS, composeMail, validateSubscription, validatePreferences, emailProblem, normalizeEmail } from './subscribe-rules.js';
import { createService, DEFAULT_LIMITS } from './subscribe-service.js';

const STORE_KEY = 'cdc.subscribe.mock.v1';
const HEALTH_SERVICE = 'cdc-prototype-subscriptions';
const INBOX_MAX = 20;

const curLang = () => (typeof document !== 'undefined' && document.documentElement.lang) || 'zh-TW';
const T = (k, v) => i18nT(curLang(), k, v);

/* ───────── 結果格式 ───────── */
export function toResult({ status, body = {} }) {
  if (status >= 200 && status < 300) return { ok: true, ...body };
  return { ok: false, error: body.error ?? 'server', status, fields: body.fields, retryAfter: body.retryAfter };
}

/* ───────── (a) 瀏覽器模擬後端 ───────── */
/** storage：{ getItem, setItem }（localStorage 或測試用假物件）；任何讀寫例外都吞掉，退回記憶體（私密模式、被封鎖時仍可示範一整輪） */
export function createBrowserBackend({ storage, linksFor, now = () => Date.now(), uuid = () => globalThis.crypto.randomUUID(), limits = DEFAULT_LIMITS }) {
  let mem = null;
  const read = () => {
    try { const d = JSON.parse(storage?.getItem(STORE_KEY) ?? 'null'); if (d && Array.isArray(d.subscriptions)) return { version: 1, inbox: [], ...d }; } catch { /* 損毀就重來 */ }
    return mem ?? { version: 1, subscriptions: [], inbox: [] };
  };
  const write = (d) => { mem = d; try { storage?.setItem(STORE_KEY, JSON.stringify(d)); } catch { /* 寫不進去就只留記憶體 */ } };
  const mail = (kind, sub) => {
    const links = linksFor(sub);
    const m = composeMail(kind, { lang: sub.lang, links, sub });
    const d = read();
    d.inbox.unshift({ id: uuid(), at: new Date(now()).toISOString(), kind, to: sub.email, subject: m.subject, text: m.text, links: { confirm: links.confirmUrl, manage: links.manageUrl, unsubscribe: links.unsubscribeUrl } });
    d.inbox = d.inbox.slice(0, INBOX_MAX);
    write(d);
  };
  // service 每次 load 的是最新資料；save 時要保留 inbox（service 只認 subscriptions）
  const svc = createService({ load: read, save: write, mail, now, uuid, limits });
  const wrap = (r) => Promise.resolve(toResult(r));
  return {
    kind: 'mock-browser',
    subscribe: (input) => wrap(svc.subscribe(input)),
    confirm: (token) => wrap(svc.confirm(token)),
    status: (token) => wrap(svc.status(token)),
    update: (token, prefs) => wrap(svc.update(token, prefs)),
    unsubscribe: (token) => wrap(svc.unsubscribe(token)),
    manageLink: (email) => wrap(svc.manageLink(email)),
    /** 模擬收件匣（只有這個實作有） */
    inbox: () => read().inbox,
    clearInbox: () => { const d = read(); d.inbox = []; write(d); },
  };
}

/* ───────── (b) HTTP 後端（模擬或正式） ───────── */
export function createHttpBackend({ base = '', fetchFn = (...a) => globalThis.fetch(...a), kind = 'mock-http' } = {}) {
  async function call(method, path, body) {
    try {
      const r = await fetchFn(`${base}${path}`, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
      let j = {};
      try { j = await r.json(); } catch { /* 非 JSON（例如 502 頁）→ 當 server 錯誤 */ }
      return toResult({ status: r.status, body: j });
    } catch { return { ok: false, error: 'network' }; }
  }
  const q = (k, v) => `?${k}=${encodeURIComponent(v)}`;
  return {
    kind,
    subscribe: (input) => call('POST', '/api/subscriptions', input),
    confirm: (token) => call('GET', `/api/subscriptions/confirm${q('token', token)}`),
    status: (token) => call('GET', `/api/subscriptions/status${q('token', token)}`),
    update: (token, prefs) => call('POST', '/api/subscriptions/update', { token, ...prefs }),
    unsubscribe: (token) => call('POST', '/api/subscriptions/unsubscribe', { token }),
    manageLink: (email) => call('POST', '/api/subscriptions/manage-link', { email }),
  };
}

/** 偵測：有 HTTP 模擬後端用 (b)，否則 (a)。force：'browser' 強制 (a)。 */
export async function detectBackend({ base = '', force = '', fetchFn = (...a) => globalThis.fetch(...a), timeoutMs = 1500, makeBrowser }) {
  if (force !== 'browser') {
    try {
      const ctl = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
      const r = await fetchFn(`${base}/api/health`, { cache: 'no-store', signal: ctl?.signal, credentials: 'same-origin' });
      if (timer) clearTimeout(timer);
      const j = r.ok ? await r.json() : null;
      if (j?.service === HEALTH_SERVICE) return createHttpBackend({ base, fetchFn });
    } catch { /* 沒有後端（GitHub Pages 等靜態主機）→ 瀏覽器模擬 */ }
  }
  return makeBrowser();
}

/* ───────── 畫面 ───────── */
const $ = (root, sel) => root.querySelector(sel);
const $$ = (root, sel) => [...root.querySelectorAll(sel)];

function init(root) {
  const base = document.documentElement.dataset.base ?? '';
  const pageUrl = (lang, q) => `${location.origin}${base}${lang === 'en' ? '/en' : ''}/subscribe/?${q}`;
  const linksFor = (sub) => ({
    confirmUrl: sub.confirmToken ? pageUrl(sub.lang, `confirm=${sub.confirmToken}`) : undefined,
    manageUrl: pageUrl(sub.lang, `manage=${sub.manageToken}`),
    unsubscribeUrl: pageUrl(sub.lang, `unsubscribe=${sub.manageToken}`),
    privacyUrl: `${location.origin}${base}${sub.lang === 'en' ? '/en' : ''}/policy/privacy/`,
  });

  const views = $$(root, '[data-sub-view]');
  const banner = $(root, '[data-sub-banner-text]');
  const note = $(root, '[data-sub-backend-note]');
  const form = $(root, '[data-sub-form]');
  const errBox = $(root, '[data-sub-errors]');
  const live = $(root, '[data-sub-live]');
  let backend = null;
  let manageToken = null;

  function show(name, { focus = true } = {}) {
    for (const v of views) v.hidden = v.dataset.subView !== name;
    const v = views.find((x) => x.dataset.subView === name);
    if (focus && v) { const h = $(v, '[data-sub-focus]') ?? v; h.tabIndex = -1; h.focus(); h.scrollIntoView?.({ block: 'start' }); }
  }
  const say = (msg) => { if (live) live.textContent = msg; };
  const setText = (el, s) => { if (el) el.textContent = s; };

  /* 錯誤 */
  const errText = (field, code, vars) => T(`subscribe.err.${field}.${code}`, vars);
  function clearErrors(f) {
    $$(f, '[data-err]').forEach((p) => { p.hidden = true; p.textContent = ''; });
    $$(f, '[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
    errBox.hidden = true; errBox.replaceChildren();
  }
  function showErrors(f, errors, { box = errBox } = {}) {
    clearErrors(f);
    const idp = f.dataset.idp ?? 'sub';
    const fieldId = { email: `${idp}-email`, topics: `${idp}-topic-${TOPIC_IDS[0]}`, consent: `${idp}-consent` };
    const list = [];
    for (const [field, code] of Object.entries(errors)) {
      const msg = errText(field, code);
      const p = $(f, `[data-err="${field}"]`);
      if (p) { p.textContent = msg; p.hidden = false; }
      const ctl = document.getElementById(fieldId[field] ?? '');
      if (ctl && f.contains(ctl)) ctl.setAttribute('aria-invalid', 'true');
      list.push({ id: fieldId[field], msg });
    }
    if (!list.length) return;
    const strong = document.createElement('strong');
    strong.className = 'c-alert__t';
    strong.textContent = T('subscribe.err.title', { n: list.length });
    const ul = document.createElement('ul');
    for (const { id, msg } of list) {
      const li = document.createElement('li'); const a = document.createElement('a');
      a.href = `#${id ?? ''}`; a.textContent = msg;
      a.addEventListener('click', (e) => { e.preventDefault(); document.getElementById(id)?.focus(); });
      li.append(a); ul.append(li);
    }
    box.replaceChildren(strong, ul);
    box.hidden = false;
    box.tabIndex = -1; box.focus();
  }
  const serverError = (r) => (r.error === 'rate' ? T('subscribe.err.rate', { n: r.retryAfter ?? 60 }) : T(`subscribe.err.${['network', 'expired', 'notfound', 'unsubscribed', 'full'].includes(r.error) ? r.error : 'server'}`));
  function showFormError(f, box, r) {
    clearErrors(f);
    const strong = document.createElement('strong');
    strong.className = 'c-alert__t';
    strong.textContent = serverError(r);
    box.replaceChildren(strong); box.hidden = false; box.tabIndex = -1; box.focus();
  }

  /* 表單讀寫 */
  const checked = (f, name) => $$(f, `input[name="${name}"]:checked`).map((x) => x.value);
  const readForm = (f) => ({
    email: f.elements.email?.value ?? '', topics: checked(f, 'topics'), frequency: checked(f, 'frequency')[0] ?? '', lang: checked(f, 'lang')[0] ?? '',
    consent: !!f.elements.consent?.checked, website: f.elements.website?.value ?? '',
  });
  function fillPrefs(f, p) {
    $$(f, 'input[name="topics"]').forEach((x) => { x.checked = p.topics.includes(x.value); });
    $$(f, 'input[name="frequency"]').forEach((x) => { x.checked = x.value === p.frequency; });
    $$(f, 'input[name="lang"]').forEach((x) => { x.checked = x.value === p.lang; });
  }
  const busy = (f, on) => $$(f, 'button[type=submit],button[data-sub-act]').forEach((b) => { b.disabled = on; });

  /* 模擬收件匣（只有瀏覽器模擬後端） */
  function renderInbox(box) {
    box.replaceChildren();
    const msgs = backend.kind === 'mock-browser' ? backend.inbox() : [];
    box.hidden = backend.kind !== 'mock-browser';
    if (box.hidden) return;
    const h = document.createElement('h3'); h.textContent = T('subscribe.inbox.h');
    const intro = document.createElement('p'); intro.className = 'muted'; intro.textContent = T('subscribe.inbox.note');
    box.append(h, intro);
    if (!msgs.length) { const p = document.createElement('p'); p.textContent = T('subscribe.inbox.empty'); box.append(p); return; }
    msgs.forEach((m, i) => {
      const d = document.createElement('details'); d.className = 'c-sub__mail'; d.open = i === 0;
      const s = document.createElement('summary'); s.textContent = m.subject;
      const meta = document.createElement('p'); meta.className = 'muted'; meta.textContent = `${T('subscribe.inbox.to')}: ${m.to} · ${new Date(m.at).toLocaleString(curLang())}`;
      const pre = document.createElement('pre'); pre.className = 'c-sub__mailtext'; pre.textContent = m.text;
      const acts = document.createElement('p'); acts.className = 'c-sub__mailacts';
      for (const [k, key] of [['confirm', 'subscribe.inbox.confirm'], ['manage', 'subscribe.inbox.manage'], ['unsubscribe', 'subscribe.inbox.unsub']]) {
        if (!m.links?.[k] || (k === 'confirm' && m.kind !== 'confirm') || (k !== 'confirm' && m.kind === 'confirm')) continue;
        const a = document.createElement('a'); a.className = 'c-btn c-btn--sm c-btn--ghost'; a.href = m.links[k]; a.textContent = T(key); acts.append(a, document.createTextNode(' '));
      }
      d.append(s, meta, pre, acts); box.append(d);
    });
    const clear = document.createElement('button'); clear.type = 'button'; clear.className = 'c-btn c-btn--ghost c-btn--sm'; clear.textContent = T('subscribe.inbox.clear');
    clear.addEventListener('click', () => { backend.clearInbox(); renderInbox(box); });
    box.append(clear);
  }

  function showSent(kindKey, email) {
    setText($(root, '[data-sub-sent-text]'), T(kindKey, { email: normalizeEmail(email) }));
    setText($(root, '[data-sub-sent-where]'), backend.kind === 'mock-http' ? T('subscribe.sent.where.http') : T('subscribe.sent.where.browser'));
    renderInbox($(root, '[data-sub-inbox]'));
    show('sent'); say(T(kindKey, { email: normalizeEmail(email) }));
  }

  function showResult(title, text, { links = [] } = {}) {
    setText($(root, '[data-sub-result-title]'), title);
    setText($(root, '[data-sub-result-text]'), text);
    const box = $(root, '[data-sub-result-links]'); box.replaceChildren();
    for (const [label, href] of links) { const a = document.createElement('a'); a.className = 'c-btn c-btn--ghost'; a.href = href; a.textContent = label; box.append(a, document.createTextNode(' ')); }
    show('result');
  }

  /* 事件 */
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = readForm(form);
    const v = validateSubscription(input);
    if (!v.ok) { showErrors(form, v.errors); return; }
    clearErrors(form); busy(form, true);
    const r = await backend.subscribe({ ...v.value, consent: true, website: input.website });
    busy(form, false);
    if (!r.ok) { if (r.error === 'invalid' && r.fields) showErrors(form, r.fields); else showFormError(form, errBox, r); return; }
    showSent('subscribe.sent.text', v.value.email);
  });
  form.elements.email?.addEventListener('blur', (ev) => {
    const val = ev.target.value;
    const p = $(form, '[data-err="email"]');
    if (!val.trim() && !ev.target.hasAttribute('aria-invalid')) return;
    const code = emailProblem(val);
    if (code) { ev.target.setAttribute('aria-invalid', 'true'); p.textContent = errText('email', code); p.hidden = false; } else { ev.target.removeAttribute('aria-invalid'); p.hidden = true; p.textContent = ''; }
  });

  const lost = $(root, '[data-sub-lost-form]');
  lost.addEventListener('submit', async (e) => {
    e.preventDefault();
    const box = $(lost, '[data-sub-lost-err]');
    const email = lost.elements.email.value;
    const code = emailProblem(email);
    if (code) { box.textContent = errText('email', code); box.hidden = false; lost.elements.email.setAttribute('aria-invalid', 'true'); lost.elements.email.focus(); return; }
    box.hidden = true; lost.elements.email.removeAttribute('aria-invalid'); busy(lost, true);
    const r = await backend.manageLink(email);
    busy(lost, false);
    if (!r.ok) { box.textContent = serverError(r); box.hidden = false; return; }
    showSent('subscribe.lost.sent', email);
  });

  $$(root, '[data-sub-back]').forEach((b) => b.addEventListener('click', () => { show('form'); }));
  $(root, '[data-sub-open-inbox]')?.addEventListener('click', () => showSent('subscribe.inbox.open', ''));

  /* 管理 */
  const mform = $(root, '[data-sub-manage-form]');
  const mbox = $(mform, '[data-sub-manage-errors]');
  const mmsg = $(mform, '[data-sub-manage-msg]');
  mform.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = readForm(mform);
    const v = validatePreferences(input);
    if (!v.ok) { showErrors(mform, v.errors, { box: mbox }); return; }
    clearErrors(mform); busy(mform, true);
    const r = await backend.update(manageToken, v.value);
    busy(mform, false);
    if (!r.ok) { showFormError(mform, mbox, r); return; }
    mmsg.textContent = T('subscribe.manage.saved'); say(T('subscribe.manage.saved'));
  });
  $(mform, '[data-sub-unsub]').addEventListener('click', async () => {
    busy(mform, true);
    const r = await backend.unsubscribe(manageToken);
    busy(mform, false);
    if (!r.ok) { showFormError(mform, mbox, r); return; }
    showResult(T('subscribe.unsub.done.h'), T('subscribe.unsub.done.text'), { links: [[T('subscribe.unsub.resub'), `${location.pathname}`]] });
  });
  const uview = $(root, '[data-sub-view="unsub"]');
  $(uview, '[data-sub-unsub-go]').addEventListener('click', async (ev) => {
    ev.target.disabled = true;
    const r = await backend.unsubscribe(manageToken);
    ev.target.disabled = false;
    if (!r.ok) { showResult(T('subscribe.fail.h'), serverError(r)); return; }
    showResult(T('subscribe.unsub.done.h'), T('subscribe.unsub.done.text'), { links: [[T('subscribe.unsub.resub'), `${location.pathname}`]] });
  });

  /* 由信件連結進來：?confirm= ?manage= ?unsubscribe=（處理完立刻把 token 從網址列拿掉） */
  async function route() {
    const p = new URLSearchParams(location.search);
    const clean = () => { try { history.replaceState(null, '', location.pathname); } catch { /* ignore */ } };
    if (p.has('confirm')) {
      const r = await backend.confirm(p.get('confirm')); clean();
      if (!r.ok) { showResult(T('subscribe.fail.h'), serverError(r), { links: [[T('subscribe.again'), location.pathname]] }); return; }
      manageToken = r.manageToken;
      showResult(T(r.already ? 'subscribe.confirm.already' : 'subscribe.confirm.h'), T('subscribe.confirm.text'), { links: [[T('subscribe.manage.go'), `${location.pathname}?manage=${r.manageToken}`]] });
      return;
    }
    if (p.has('manage') || p.has('unsubscribe')) {
      const unsub = p.has('unsubscribe');
      manageToken = p.get(unsub ? 'unsubscribe' : 'manage'); clean();
      const r = await backend.status(manageToken);
      if (!r.ok) { showResult(T('subscribe.fail.h'), serverError(r)); return; }
      if (r.status === 'unsubscribed') { showResult(T('subscribe.unsub.done.h'), T('subscribe.unsub.done.text'), { links: [[T('subscribe.unsub.resub'), location.pathname]] }); return; }
      if (unsub) { setText($(uview, '[data-sub-unsub-email]'), r.email); show('unsub'); return; }
      setText($(mform, '[data-sub-manage-email]'), r.email);
      setText($(mform, '[data-sub-manage-status]'), T(`subscribe.status.${r.status}`));
      fillPrefs(mform, r);
      show('manage');
    }
  }

  /* 開始：偵測後端 → 顯示對應橫幅 → 依網址決定畫面 */
  (async () => {
    const force = new URLSearchParams(location.search).get('backend') === 'browser' || root.dataset.backend === 'browser' ? 'browser' : '';
    backend = await detectBackend({ base, force, makeBrowser: () => createBrowserBackend({ storage: (() => { try { return localStorage; } catch { return null; } })(), linksFor }) });
    root.dataset.backendKind = backend.kind;
    setText(banner, T(backend.kind === 'mock-http' ? 'subscribe.banner.http' : 'subscribe.banner'));
    setText(note, T(backend.kind === 'mock-http' ? 'subscribe.banner.http.sub' : 'subscribe.banner.sub'));
    root.hidden = false;
    const openInbox = $(root, '[data-sub-open-inbox]');
    if (openInbox) openInbox.hidden = !(backend.kind === 'mock-browser' && backend.inbox().length);
    await route();
  })();
}

if (typeof document !== 'undefined') {
  const root = document.querySelector('[data-sub-app]');
  if (root) init(root);
}
