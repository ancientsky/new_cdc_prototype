// 第三十輪（#55）：表單直接送到機關的個資表單系統（site.config.mjs forms.*.endpoint；契約見 docs/deploy.md 第 13 節）。
// 資料不經過本網站、不存進瀏覽器、更不進 Git：本檔只做「整理欄位 → fetch POST → 顯示收件編號」。
//
// 契約（端點那一邊要做到）：
//   - 請求：POST endpoint，Accept: application/json。沒有附件 ⇒ Content-Type: application/json，本文
//     { form, submissionId, submittedAt, lang, page, ...extra, fields: { 欄位名: 值 } }；有附件 ⇒ multipart/form-data（同名欄位＋檔案，_meta 欄放上述 JSON）。
//   - submissionId（UUID）是冪等鍵：同一個 id 重送只能收一次（下面的「一般表單 POST 備援」可能讓同一筆送兩次）。
//   - 回應：2xx＋JSON { ok: true, receiptNo?: string, message?: string }；驗證失敗回 4xx＋{ ok:false, message }。
//   - CORS：允許本站來源、POST、Content-Type 標頭；不需要 cookie（credentials: 'omit'）。
// 備援：fetch 根本送不出去（網路錯誤、CORS 尚未設定、舊瀏覽器）⇒ 改用一般表單 POST（瀏覽器整頁送到端點，由端點回它自己的收件頁）。
//       端點回 4xx／5xx 不備援（那是端點明確拒絕，再送一次只會重複）。
import { t as i18nT } from './i18n.runtime.js';

const curLang = () => (typeof document !== 'undefined' && document.documentElement.lang) || 'zh-TW';
const T = (k, v) => i18nT(curLang(), k, v);
const uuid = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);

/** 表單欄位 → 純物件（同名多值變陣列；檔案只記檔名，檔案本身另走 multipart） */
export function fieldsOf(form) {
  const out = {}, files = [];
  for (const [k, v] of new FormData(form).entries()) {
    if (typeof v !== 'string') { if (v && v.name) files.push({ field: k, name: v.name, size: v.size }); continue; }
    if (k in out) out[k] = [].concat(out[k], v); else out[k] = v;
  }
  return { fields: out, files };
}

/**
 * 送出。回傳 { ok:true, receiptNo, message } ｜ { ok:false, error:'http', status, message } ｜ { ok:false, error:'network' }。
 * @param {string} endpoint
 * @param {HTMLFormElement | Record<string, unknown>} form 表單元素；或直接給欄位物件（測試、非表單來源）
 * @param {{ form: string, submissionId?: string, [k: string]: unknown }} meta
 */
export async function sendToEndpoint(endpoint, form, meta, { fetchFn = (...a) => globalThis.fetch(...a) } = {}) {
  const isForm = typeof form?.tagName === 'string';
  const { fields, files } = isForm ? fieldsOf(/** @type {HTMLFormElement} */ (form)) : { fields: form ?? {}, files: [] };
  const head = { submissionId: uuid(), submittedAt: new Date().toISOString(), lang: curLang(), page: typeof location !== 'undefined' ? location.pathname : '', ...meta };
  let body, headers = { Accept: 'application/json' };
  if (files.length) { body = new FormData(/** @type {HTMLFormElement} */ (form)); body.append('_meta', JSON.stringify(head)); }
  else { body = JSON.stringify({ ...head, fields }); headers = { ...headers, 'Content-Type': 'application/json' }; }
  let r;
  try { r = await fetchFn(endpoint, { method: 'POST', headers, body, credentials: 'omit', mode: 'cors' }); } catch { return { ok: false, error: 'network', submissionId: head.submissionId }; }
  let j = {};
  try { j = await r.json(); } catch { /* 非 JSON */ }
  if (r.ok && j?.ok !== false) return { ok: true, receiptNo: String(j?.receiptNo ?? ''), message: String(j?.message ?? ''), submissionId: head.submissionId };
  return { ok: false, error: 'http', status: r.status, message: String(j?.message ?? ''), submissionId: head.submissionId };
}

/** 備援：一般表單 POST（整頁送到端點）。submissionId 放隱藏欄，端點據以去重。 */
export function nativePost(form, endpoint, submissionId) {
  form.action = endpoint; form.method = 'post';
  if (form.querySelector('input[type=file]')) form.enctype = 'multipart/form-data';
  let h = form.querySelector('input[name=submissionId]');
  if (!h) { h = document.createElement('input'); h.type = 'hidden'; h.name = 'submissionId'; form.append(h); }
  h.value = submissionId;
  HTMLFormElement.prototype.submit.call(form); // 不觸發 submit 事件（避免再被攔一次）
}

/** 通用：form[data-form-post]（署長信箱 post 模式）。data-endpoint、data-form；狀態寫進 [data-fp-status]。 */
function init(form) {
  const status = form.querySelector('[data-fp-status]') ?? form.parentElement?.querySelector('[data-fp-status]');
  const btn = form.querySelector('button[type=submit]');
  const say = (k, v, bad = false) => { if (!status) return; status.textContent = T(k, v); status.dataset.state = bad ? 'error' : 'ok'; status.hidden = false; };
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!form.reportValidity()) return;
    if (btn) btn.disabled = true;
    say('form.sending');
    const r = await sendToEndpoint(form.dataset.endpoint, form, { form: form.dataset.form });
    if (btn) btn.disabled = false;
    if (r.ok) { form.reset(); say(r.receiptNo ? 'form.sent.no' : 'form.sent', { no: r.receiptNo }); status?.focus?.(); return; }
    if (r.error === 'network') { say('form.fallback'); nativePost(form, form.dataset.endpoint, r.submissionId); return; }
    say('form.err', { status: r.status, msg: r.message }, true); status?.focus?.();
  });
}

if (typeof document !== 'undefined') document.querySelectorAll('form[data-form-post]').forEach(init);
