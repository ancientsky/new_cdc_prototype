// 後台共用：單位切換、localStorage、v1 讀取、匯出工具。所有後台頁都載入（layout 在每頁加入）。
// localStorage key 一覽：
//   cdc.admin.unit          示範身分（單位 id 或 'all'）
//   cdc.admin.draft         上架表單草稿
//   cdc.admin.queue         已送複核的草稿佇列
//   cdc.admin.reviewActions 複核區「通過／退回」紀錄
//   cdc.admin.reviewed      審閱到期「標記已審閱（示範）」紀錄
//   cdc.admin.todoDone      連動待辦「完成（示範）」紀錄
//   cdc.admin.reportStatus  回報處理狀態
//   cdc.admin.situation     態勢發布表單草稿
//   cdc.aiStatusOverride    AI 暫停覆寫（答案頁讀取）{paused, reason, updatedAt, updatedBy}
//   cdc.reports             前台回報（唯讀）
//   cdc.llmKey              BYOK（唯讀；有才會呼叫 LLM 多語初稿）

const root = document.documentElement;
export const base = (window.CDC && window.CDC.base) ?? root.dataset.base ?? '';
export const url = (p) => (/^https?:|^tel:|^mailto:/.test(p) ? p : `${base}${p.startsWith('/') ? p : `/${p}`}`);
export const $ = (sel, el = document) => el.querySelector(sel);
export const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
export const today = () => document.body.dataset.today || new Date().toISOString().slice(0, 10);

export function esc(v) {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ---------- localStorage（包 try/catch，失敗退回記憶體）----------
const mem = new Map();
export const store = {
  get(key, fallback = null) {
    try { const v = localStorage.getItem(key); if (v == null) return mem.has(key) ? mem.get(key) : fallback; return JSON.parse(v); } catch { return mem.has(key) ? mem.get(key) : fallback; }
  },
  set(key, val) { mem.set(key, val); try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* 私密模式等：只存記憶體 */ } },
  del(key) { mem.delete(key); try { localStorage.removeItem(key); } catch { /* ignore */ } },
  raw(key) { try { return localStorage.getItem(key); } catch { return null; } },
};

// ---------- 資料 ----------
const cache = new Map();
/** 讀 /v1/<name>.json，回傳 .data；失敗回傳 fallback。 */
export async function v1(name, fallback = null) {
  if (cache.has(name)) return cache.get(name);
  const p = (async () => {
    try {
      const res = await fetch(url(`/v1/${name}.json`));
      if (!res.ok) throw new Error(res.status);
      const j = await res.json();
      return j && 'data' in j ? j.data : j;
    } catch { return fallback; }
  })();
  cache.set(name, p);
  return p;
}
export function readEmbedded(id, fallback = null) {
  try { const el = document.getElementById(id); return el ? JSON.parse(el.textContent) : fallback; } catch { return fallback; }
}

// ---------- 單位（示範身分）----------
const unitSel = $('#adm-unit');
const whoName = $('#adm-who-name');
const savedUnit = store.get('cdc.admin.unit');
if (unitSel && savedUnit && [...unitSel.options].some((o) => o.value === savedUnit)) unitSel.value = savedUnit;
export const getUnit = () => unitSel?.value || 'unit.acute-infectious';
export const unitLabel = (id = getUnit()) => (id === 'all' ? '全部單位' : unitSel?.querySelector(`option[value="${CSS.escape(id)}"]`)?.textContent ?? id);
function paintWho() { if (whoName) whoName.textContent = getUnit() === 'all' ? '全部單位 · 資料治理幕僚' : `${unitLabel()} · 承辦人`; }
paintWho();
unitSel?.addEventListener('change', () => { store.set('cdc.admin.unit', getUnit()); paintWho(); document.dispatchEvent(new CustomEvent('adm:unit', { detail: getUnit() })); });
/** 註冊單位變更回呼；立即呼叫一次。 */
export function onUnit(cb) { cb(getUnit()); document.addEventListener('adm:unit', () => cb(getUnit())); }
/** 讓某個「單位篩選下拉」跟著右上身分走（使用者仍可手動改成「全部」）。 */
export function followUnit(select, cb) {
  const apply = () => { const u = getUnit(); if ([...select.options].some((o) => o.value === u)) select.value = u; cb?.(); };
  apply();
  document.addEventListener('adm:unit', apply);
  select.addEventListener('change', () => cb?.());
}

// ---------- 小工具 ----------
export function downloadText(filename, text, mime = 'application/json') {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
}
export async function copyText(text, btn) {
  let ok = false;
  try { await navigator.clipboard.writeText(text); ok = true; } catch {
    const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select();
    try { ok = document.execCommand('copy'); } catch { ok = false; } ta.remove();
  }
  if (btn) { const old = btn.dataset.label ?? btn.textContent; btn.dataset.label = old; btn.textContent = ok ? '已複製' : '複製失敗，請手動選取'; setTimeout(() => { btn.textContent = old; }, 1600); }
  return ok;
}
export function toCSV(rows) {
  const q = (v) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return `﻿${rows.map((r) => r.map(q).join(',')).join('\r\n')}\r\n`;
}
export const daysBetween = (a, b) => Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000);
export const addDays = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const debounce = (fn, ms = 200) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
export const fmtDT = (iso) => { try { return new Date(iso).toLocaleString('zh-TW', { hour12: false }); } catch { return iso; } };

/** 前台路徑（去 basePath／語言前綴／query／hash，補尾斜線）。 */
export function normPath(p) {
  let s = String(p ?? '').split('#')[0].split('?')[0];
  try { if (/^https?:/.test(s)) s = new URL(s).pathname; } catch { /* ignore */ }
  if (base && s.startsWith(base)) s = s.slice(base.length);
  s = s.replace(/^\/(en|ja|tl|vi|id|th)(?=\/|$)/, '');
  if (!s.startsWith('/')) s = `/${s}`;
  if (!/\.[a-z0-9]+$/i.test(s) && !s.endsWith('/')) s += '/';
  return s;
}

// ---------- 導覽徽章（本機草稿也算）----------
function paintBadges() {
  const queue = store.get('cdc.admin.queue', []) ?? [];
  const actions = store.get('cdc.admin.reviewActions', {}) ?? {};
  const pendingLocal = queue.filter((q) => !actions[q.id] || actions[q.id].state === 'pending').length;
  const reviewEl = $('.adm-count[data-count="review"]');
  if (reviewEl) { const n = Number(reviewEl.dataset.server ?? reviewEl.textContent) || 0; reviewEl.dataset.server = n; reviewEl.textContent = n + pendingLocal; }
}
paintBadges();
document.addEventListener('adm:queue', paintBadges);
