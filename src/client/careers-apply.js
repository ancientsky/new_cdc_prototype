// /careers/{slug}/apply/ 的「模擬線上報名」（ARCHITECTURE 15.2）。三步驟：基本資料 → 學經歷與應備文件（檔案只記檔名）→ 聲明與確認。
// 全部資料只存在這個瀏覽器的 localStorage（草稿 cdc.apply.draft.{slug}、收執 cdc.apply.receipts），不送出任何請求，也不讀取檔案內容。
// 純函式（makeApplyNo、buildIcs、validateField）與 DOM 無關，可在 Node 測試。
import { t as i18nT } from './i18n.runtime.js';

const DRAFT_KEY = (slug) => `cdc.apply.draft.${slug}`;
const RECEIPTS_KEY = 'cdc.apply.receipts';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 字元；去掉容易混淆的 I O 0 1
const MAX_FILE = 10 * 1024 * 1024;
const FILE_RE = /\.(pdf|jpe?g|png|docx|odt)$/i;

const curLang = () => (typeof document !== 'undefined' && document.documentElement.lang) || 'zh-TW';
const T = (k, v) => i18nT(curLang(), k, v);

/* ───────── 純函式 ───────── */
const pad = (n) => String(n).padStart(2, '0');
function randomBytes(n) {
  const a = new Uint8Array(n);
  (globalThis.crypto ?? { getRandomValues: (x) => x.map(() => Math.floor(Math.random() * 256)) }).getRandomValues(a);
  return a;
}
/** 報名編號：CDC-{yyyymmdd}-{6 碼}（英數、去掉易混淆字元） */
export function makeApplyNo(date = new Date(), rand = randomBytes) {
  const ymd = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
  const code = [...rand(6)].map((b) => ALPHABET[b % ALPHABET.length]).join('');
  return `CDC-${ymd}-${code}`;
}

const icsEsc = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
function fold(line) {
  const enc = new TextEncoder();
  let out = '', cur = '', bytes = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (bytes + b > 73) { out += `${cur}\r\n `; cur = ''; bytes = 1; }
    cur += ch; bytes += b;
  }
  return out + cur;
}
const ymd8 = (iso) => String(iso).replaceAll('-', '');
const nextDay = (iso) => { const [y, m, d] = iso.split('-').map(Number); const dt = new Date(Date.UTC(y, m - 1, d + 1)); return `${dt.getUTCFullYear()}${pad(dt.getUTCMonth() + 1)}${pad(dt.getUTCDate())}`; };
/** 甄試日行事曆（整天事件）。exams：[{ stage, date: 'YYYY-MM-DD', note }] */
export function buildIcs({ title, exams = [], no = '', now = new Date(), prodId = '-//Taiwan CDC prototype//careers simulation//ZH-TW' }) {
  const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:${prodId}`, 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  exams.filter((e) => e?.date).forEach((e, i) => {
    lines.push('BEGIN:VEVENT', `UID:${no || 'cdc-sim'}-${i + 1}@cdc-prototype.invalid`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${ymd8(e.date)}`, `DTEND;VALUE=DATE:${nextDay(e.date)}`,
      `SUMMARY:${icsEsc(`${title}｜${e.stage}`)}`, `DESCRIPTION:${icsEsc(`${e.note ? `${e.note}\n` : ''}原型示範：模擬報名產生的行事曆，非正式通知。${no ? `報名編號 ${no}` : ''}`)}`, 'END:VEVENT');
  });
  lines.push('END:VCALENDAR');
  return `${lines.map(fold).join('\r\n')}\r\n`;
}

/**
 * 單一欄位驗證。回傳 null（通過）或 { key, vars }（i18n key）。
 * name：欄位名；val：文字值／checkbox 布林／檔案 { name, size }（沒選為 null）；o：{ kind, required, label, today }
 */
export function validateField(name, val, o = {}) {
  const { kind = 'text', required = false, label = '', today = new Date().toISOString().slice(0, 10) } = o;
  if (kind === 'checkbox') return val ? null : { key: 'japply.err.check', vars: { label } };
  if (kind === 'file') {
    if (!val) return required ? { key: 'japply.err.file', vars: { label } } : null;
    if (!FILE_RE.test(val.name ?? '')) return { key: 'japply.err.filetype', vars: {} };
    if ((val.size ?? 0) > MAX_FILE) return { key: 'japply.err.filesize', vars: {} };
    return null;
  }
  const s = String(val ?? '').trim();
  if (!s) return required ? { key: kind === 'select' ? 'japply.err.pick' : 'japply.err.required', vars: { label } } : null;
  if (name === 'birth') {
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const d = m && new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    const valid = d && d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
    return valid && s <= today && +m[1] >= 1930 ? null : { key: 'japply.err.birth', vars: {} };
  }
  if (name === 'phone') return /^(09\d{8}|0\d{1,2}-?\d{6,8})$/.test(s.replace(/[\s()]/g, '')) ? null : { key: 'japply.err.phone', vars: {} };
  if (name === 'email') return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s) ? null : { key: 'japply.err.email', vars: {} };
  if (name === 'years') return /^\d{1,2}$/.test(s) && +s >= 0 && +s <= 50 ? null : { key: 'japply.err.years', vars: {} };
  return null;
}

/* ───────── localStorage（任何情況都不能丟例外） ───────── */
const ls = {
  get(k, fb = null) { try { const v = localStorage.getItem(k); return v == null ? fb : JSON.parse(v); } catch { return fb; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

/* ───────── DOM ───────── */
function init(root) {
  const form = root.querySelector('[data-apply]');
  const slug = form.dataset.slug;
  const jobId = form.dataset.job;
  const jobTitle = form.dataset.title;
  const today = new Date().toISOString().slice(0, 10);
  const exams = JSON.parse(form.dataset.exams || '[]');
  const steps = [...form.querySelectorAll('[data-step]')];
  const inds = [...root.querySelectorAll('[data-step-ind]')];
  const errBox = form.querySelector('[data-apply-errors]');
  const msg = root.querySelector('[data-draft-msg]');
  const prev = form.querySelector('[data-apply-prev]'), next = form.querySelector('[data-apply-next]'), submit = form.querySelector('[data-apply-submit]');
  const receipt = root.querySelector('[data-apply-receipt]');
  let step = 1;
  let timer = null;

  const wrapOf = (el) => el.closest('[data-field]');
  const labelOf = (wrap) => {
    const l = wrap.querySelector('label');
    if (!l) return wrap.dataset.field;
    const c = l.cloneNode(true);
    c.querySelectorAll('.c-req,.sr-only,.c-opt,input,select,textarea').forEach((x) => x.remove());
    return c.textContent.replace(/\s+/g, ' ').trim();
  };
  const ctrlOf = (wrap) => wrap.querySelector('input,select,textarea');
  const fieldsOf = (n) => [...(steps[n - 1]?.querySelectorAll('[data-field]') ?? [])];
  const draftFiles = {}; // 草稿記錄的檔名（無法還原 file input）

  function valueOf(wrap) {
    const el = ctrlOf(wrap);
    if (el.type === 'checkbox') return el.checked;
    if (el.type === 'file') { const f = el.files?.[0]; return f ? { name: f.name, size: f.size } : (draftFiles[el.name] ? { name: draftFiles[el.name], size: 0 } : null); }
    return el.value;
  }
  function check(wrap) {
    const el = ctrlOf(wrap);
    const kind = el.type === 'checkbox' ? 'checkbox' : el.type === 'file' ? 'file' : el.tagName === 'SELECT' ? 'select' : 'text';
    const label = labelOf(wrap);
    return validateField(el.name, valueOf(wrap), { kind, required: el.required, label, today });
  }
  function mark(wrap, r) {
    const el = ctrlOf(wrap);
    const p = wrap.querySelector('[data-err]');
    if (r) { el.setAttribute('aria-invalid', 'true'); p.textContent = T(r.key, r.vars); p.hidden = false; } else { el.removeAttribute('aria-invalid'); p.textContent = ''; p.hidden = true; }
  }
  function renderSummary(list) {
    if (!list.length) { errBox.hidden = true; errBox.replaceChildren(); return; }
    const strong = document.createElement('strong');
    strong.className = 'c-alert__t';
    strong.textContent = T('japply.err.title', { n: list.length });
    const ul = document.createElement('ul');
    list.forEach(({ wrap, r }) => {
      const li = document.createElement('li'); const a = document.createElement('a');
      a.href = `#${ctrlOf(wrap).id}`; a.textContent = T(r.key, r.vars);
      a.addEventListener('click', (e) => { e.preventDefault(); ctrlOf(wrap).focus(); });
      li.append(a); ul.append(li);
    });
    errBox.replaceChildren(strong, ul);
    errBox.hidden = false;
  }
  /** 驗證某一步的所有欄位；有錯就顯示摘要並把焦點移到第一個錯誤。 */
  function validateStep(n, { focus = true } = {}) {
    const bad = [];
    fieldsOf(n).forEach((w) => { const r = check(w); mark(w, r); if (r) bad.push({ wrap: w, r }); });
    renderSummary(bad);
    if (bad.length && focus) ctrlOf(bad[0].wrap).focus();
    return bad.length === 0;
  }
  function refreshSummary() {
    const bad = fieldsOf(step).map((w) => ({ wrap: w, r: ctrlOf(w).getAttribute('aria-invalid') === 'true' ? check(w) : null })).filter((x) => x.r);
    if (!errBox.hidden) renderSummary(bad);
  }

  function pairs() {
    const out = [];
    [1, 2].forEach((n) => fieldsOf(n).forEach((w) => {
      const el = ctrlOf(w);
      let v;
      if (el.type === 'file') v = valueOf(w)?.name ?? '';
      else if (el.tagName === 'SELECT') v = el.selectedOptions[0]?.value ? el.selectedOptions[0].textContent : '';
      else v = el.value.trim();
      out.push([labelOf(w), v || T('japply.js.empty')]);
    }));
    return out;
  }
  function buildSummary() {
    const dl = form.querySelector('[data-apply-summary]');
    dl.replaceChildren();
    pairs().forEach(([k, v]) => {
      const d = document.createElement('div'); const dt = document.createElement('dt'); const dd = document.createElement('dd');
      dt.textContent = k; dd.textContent = v; d.append(dt, dd); dl.append(d);
    });
  }

  function showStep(n, { focus = true } = {}) {
    step = n;
    steps.forEach((s, i) => { s.hidden = i !== n - 1; });
    inds.forEach((li, i) => { li.classList.toggle('is-done', i < n - 1); if (i === n - 1) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current'); });
    prev.hidden = n === 1; next.hidden = n === 3; submit.hidden = n !== 3;
    if (n === 3) buildSummary();
    errBox.hidden = true; errBox.replaceChildren();
    if (focus) { const s = steps[n - 1]; s.tabIndex = -1; s.focus(); s.scrollIntoView?.({ block: 'start' }); }
    saveDraft(false);
  }

  /* 草稿 */
  const nowText = () => new Date().toLocaleTimeString(curLang(), { hour: '2-digit', minute: '2-digit' });
  function collect() {
    const values = {};
    form.querySelectorAll('input,select,textarea').forEach((el) => {
      if (el.type === 'file' || el.type === 'checkbox' || !el.name) return;
      values[el.name] = el.value;
    });
    const files = { ...draftFiles };
    form.querySelectorAll('input[type=file]').forEach((el) => { if (el.files?.[0]) files[el.name] = el.files[0].name; });
    return { step, values, files, savedAt: new Date().toISOString() };
  }
  function saveDraft(announce = true) {
    if (!receipt.hidden) return; // 已顯示收執：不再存草稿
    const d = collect();
    const hasData = Object.values(d.values).some((v) => String(v).trim()) || Object.keys(d.files).length;
    if (!hasData && step === 1) return;
    if (ls.set(DRAFT_KEY(slug), d) && announce) msg.textContent = T('japply.js.draftSaved', { time: nowText() });
  }
  function restoreDraft() {
    const d = ls.get(DRAFT_KEY(slug));
    if (!d?.values) return false;
    Object.entries(d.values).forEach(([k, v]) => { const el = form.elements[k]; if (el && el.type !== 'file') el.value = v; });
    Object.entries(d.files ?? {}).forEach(([k, name]) => { draftFiles[k] = name; fileHint(form.elements[k], name, true); });
    showStep(Math.min(3, Math.max(1, d.step || 1)), { focus: false });
    msg.textContent = T('japply.js.draftRestored', { time: new Date(d.savedAt).toLocaleString(curLang(), { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) });
    return true;
  }
  function fileHint(el, name, fromDraft = false) {
    const hint = wrapOf(el)?.querySelector('[data-doc-name]');
    if (hint) hint.textContent = name ? T(fromDraft ? 'japply.js.filedraft' : 'japply.js.filechosen', { name }) : T('japply.docs.none');
  }
  function clearDraft() {
    clearTimeout(timer);
    ls.del(DRAFT_KEY(slug));
    Object.keys(draftFiles).forEach((k) => delete draftFiles[k]);
    form.reset();
    form.querySelectorAll('[data-doc-name]').forEach((h) => { h.textContent = T('japply.docs.none'); });
    fieldsOf(1).concat(fieldsOf(2), fieldsOf(3)).forEach((w) => mark(w, null));
    showStep(1, { focus: false });
    msg.textContent = T('japply.js.cleared');
  }

  /* 收執 */
  function showReceipt(rec, { focus = true } = {}) {
    form.hidden = true;
    root.querySelector('[data-apply-steps]').hidden = true;
    receipt.hidden = false;
    receipt.querySelector('[data-r-no]').textContent = rec.no;
    const dl = receipt.querySelector('[data-r-dl]');
    dl.replaceChildren();
    [[T('japply.js.r.job'), rec.jobTitle], [T('japply.js.r.at'), new Date(rec.at).toLocaleString(curLang())], ...rec.fields].forEach(([k, v]) => {
      const d = document.createElement('div'); const dt = document.createElement('dt'); const dd = document.createElement('dd');
      dt.textContent = k; dd.textContent = v; d.append(dt, dd); dl.append(d);
    });
    receipt.dataset.no = rec.no;
    msg.textContent = '';
    if (focus) receipt.focus();
  }
  const download = (name, type, text) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const currentRec = () => (ls.get(RECEIPTS_KEY, []) ?? []).find((r) => r.no === receipt.dataset.no);

  function doSubmit() {
    for (const n of [1, 2, 3]) {
      if (!validateStep(n, { focus: false })) { showStep(n, { focus: false }); validateStep(n); return; }
    }
    const rec = { no: makeApplyNo(), jobId, slug, jobTitle, at: new Date().toISOString(), fields: pairs(), simulated: true };
    const all = (ls.get(RECEIPTS_KEY, []) ?? []).filter((r) => r.no !== rec.no);
    all.unshift(rec);
    ls.set(RECEIPTS_KEY, all.slice(0, 20));
    clearTimeout(timer);
    ls.del(DRAFT_KEY(slug));
    showReceipt(rec);
  }

  /* 事件 */
  next.addEventListener('click', () => { if (validateStep(step)) showStep(step + 1); });
  prev.addEventListener('click', () => showStep(step - 1));
  form.addEventListener('submit', (e) => { e.preventDefault(); if (step < 3) { if (validateStep(step)) showStep(step + 1); } else doSubmit(); });
  form.querySelector('[data-apply-clear]').addEventListener('click', () => { if (window.confirm(T('japply.js.confirmClear'))) clearDraft(); });
  form.addEventListener('input', (e) => {
    const w = wrapOf(e.target); if (!w) return;
    if (ctrlOf(w).getAttribute('aria-invalid') === 'true') { mark(w, check(w)); refreshSummary(); }
    clearTimeout(timer); timer = setTimeout(() => saveDraft(true), 400);
  });
  form.addEventListener('change', (e) => {
    const w = wrapOf(e.target); if (!w) return;
    const el = e.target;
    if (el.type === 'file') { delete draftFiles[el.name]; fileHint(el, el.files?.[0]?.name ?? ''); const r = check(w); mark(w, r); if (r) refreshSummary(); } // 只讀 name／size，不讀內容
    else if (ctrlOf(w).getAttribute('aria-invalid') === 'true') { mark(w, check(w)); refreshSummary(); }
    saveDraft(true);
  });
  form.addEventListener('focusout', (e) => { // 即時驗證：離開欄位時檢查（有輸入過或已出錯的欄位）
    const w = wrapOf(e.target); if (!w || !steps[step - 1].contains(w)) return;
    const el = ctrlOf(w);
    if (el.type === 'checkbox' || el.type === 'file') return;
    if (el.value.trim() || el.getAttribute('aria-invalid') === 'true') { mark(w, check(w)); refreshSummary(); }
  });
  receipt.querySelector('[data-r-print]').addEventListener('click', () => window.print());
  receipt.querySelector('[data-r-json]').addEventListener('click', () => {
    const rec = currentRec(); if (!rec) return;
    const body = { simulated: true, notice: T('japply.receipt.notofficial'), notice_detail: T('japply.receipt.notofficial.sub'), applicationNo: rec.no, job: { id: rec.jobId, title: rec.jobTitle }, submittedAt: rec.at, fields: rec.fields.map(([label, value]) => ({ label, value })) };
    download(`cdc-apply-${rec.no}.json`, 'application/json', `${JSON.stringify(body, null, 2)}\n`);
  });
  receipt.querySelector('[data-r-ics]').addEventListener('click', () => {
    const rec = currentRec(); if (!rec || !exams.length) return;
    download(`cdc-exam-${rec.no}.ics`, 'text/calendar', buildIcs({ title: jobTitle, exams, no: rec.no }));
  });
  receipt.querySelector('[data-r-again]').addEventListener('click', () => {
    receipt.hidden = true; form.hidden = false; root.querySelector('[data-apply-steps]').hidden = false;
    clearDraft(); msg.textContent = '';
    showStep(1);
  });

  /* 初始化：本職缺已有收執 → 直接顯示；否則還原草稿 */
  const mine = (ls.get(RECEIPTS_KEY, []) ?? []).find((r) => r.jobId === jobId);
  showStep(1, { focus: false });
  if (mine) { showReceipt(mine, { focus: false }); msg.textContent = T('japply.js.existing'); } else restoreDraft();
}

if (typeof document !== 'undefined') {
  const root = document.querySelector('[data-apply-root]');
  if (root && root.querySelector('[data-apply]')) init(root);
}
