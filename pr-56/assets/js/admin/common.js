// 後台共用：單位切換、localStorage、v1 讀取、匯出工具。所有後台頁都載入（layout 在每頁加入）。
// localStorage key 一覽：
//   cdc.admin.session       登入工作階段（第十八輪；{sub,name,unit,roles,exp,lastSeen…}，見 auth-rules.js）
//   cdc.admin.audit         登入稽核（append-only，最多 200 筆）
//   cdc.admin.unit          單位視角（單位 id 或 'all'；只有跨單位角色能改）
//   cdc.admin.draft         上架表單草稿
//   cdc.admin.paneTab       上架頁右側頁籤（prev＝頁面預覽、res＝預處理結果；第二十二輪）
//   cdc.admin.queue         已送複核的草稿佇列
//   cdc.admin.reviewActions 複核區「通過／退回」紀錄
//   cdc.admin.reviewed      審閱到期「標記已審閱（示範）」紀錄
//   cdc.admin.todoDone      連動待辦「完成（示範）」紀錄
//   cdc.admin.reportStatus  回報處理狀態
//   cdc.admin.situation     疫情發布表單草稿
//   cdc.admin.jobs-edit     人才招募上架與異動表單草稿
//   cdc.admin.tenders-edit  採購公告上架與異動表單草稿
//   cdc.admin.bulletin-edit 疫情報導文章上架表單草稿（第二十九輪）
//   cdc.aiStatusOverride    AI 暫停覆寫（答案頁讀取）{paused, reason, updatedAt, updatedBy}
//   cdc.reports             前台回報（唯讀）
//   （sessionStorage）cdc.llmKey  BYOK（唯讀；有才會呼叫 LLM 多語初稿；第二十三輪起只在本分頁，關閉即清除）

import { sessionProblem, canAccess, canCrossUnit, roleLabels, auditEntry, makeSession } from './auth-rules.js';

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

// ---------- 登入工作階段與單位視角（第十八輪）----------
// 流程：每個後台頁載入 → 讀 cdc.admin.session → 無效就導到 /admin/login/?next=… → 有效就檢查這頁的角色規則 → 不允許就把主內容換成「沒有權限」卡並寫稽核。
// 這是前端示範；正式環境由閘道／後端在回應前就擋下（docs/admin-auth.md §4），前端只是把結果顯示出來。
const PAGE_KEY = document.body.dataset.adminPage || '';
const SESSION_KEY = 'cdc.admin.session';
const AUDIT_KEY = 'cdc.admin.audit';
const AUDIT_MAX = 200;
export function audit(kind, s = getSession(), detail = '') {
  const list = store.get(AUDIT_KEY, []) ?? [];
  list.push(auditEntry(kind, s, detail));
  store.set(AUDIT_KEY, list.slice(-AUDIT_MAX));
  document.dispatchEvent(new CustomEvent('adm:audit'));
}
export const getAudit = () => store.get(AUDIT_KEY, []) ?? [];
export const getSession = () => store.get(SESSION_KEY, null);
export function setSession(s) { if (s) store.set(SESSION_KEY, s); else store.del(SESSION_KEY); }
export const loginUrl = (next = `${location.pathname}${location.search}`) => url(`/admin/login/?next=${encodeURIComponent(next)}`);
export function login(account, method = 'sso-demo') {
  const s = makeSession(account, { method });
  if (!s) return null;
  setSession(s); store.set('cdc.admin.unit', s.unit); audit('login', s, method === 'sso-demo' ? '機關 SSO（模擬）' : '自訂示範身分');
  return s;
}
export function logout(reason = '使用者登出') {
  const s = getSession();
  if (s) audit('logout', s, reason);
  setSession(null);
  location.href = loginUrl('/admin/');
}
/** 進頁檢查：回傳 true 表示可以繼續載入這頁的腳本 */
function gate() {
  if (PAGE_KEY === 'login') return true;
  const s = getSession();
  const problem = sessionProblem(s);
  if (problem) {
    if (s && problem !== 'none') { audit('expired', s, problem === 'idle' ? '閒置逾時' : problem === 'expired' ? '工作階段到期' : '工作階段格式不符'); setSession(null); }
    location.replace(loginUrl());
    return false;
  }
  s.lastSeen = Date.now(); setSession(s);
  if (!canAccess(s, PAGE_KEY)) {
    audit('denied', s, `頁面 ${PAGE_KEY}`);
    const main = $('#main');
    if (main) {
      // 不動原本的主內容 DOM（只隱藏），頁面自己的腳本才不會因為找不到元素而報錯；正式環境根本不會回傳這頁的內容
      main.hidden = true;
      const card = document.createElement('section'); card.className = 'adm-main adm-denied-wrap';
      card.innerHTML = `<section class="adm-card adm-denied" aria-labelledby="dn-h"><h2 id="dn-h">這一頁不在你的角色權限內</h2><p>你目前的角色：<strong>${esc(roleLabels(s).join('、'))}</strong>（${esc(unitLabel(s.unit))}）。這頁需要其他角色才能進入；若業務上需要，請由單位主管向資訊室申請調整 AD 群組，不是在後台自己改。</p><p>這次嘗試已寫入稽核紀錄。<a class="adm-btn adm-btn--ghost" href="${url('/admin/mine/')}">回我的內容</a></p></section>`;
      main.before(card);
    }
    document.body.dataset.denied = '1';
    return false;
  }
  return true;
}
const unitSel = $('#adm-unit');
const whoName = $('#adm-who-name');
const whoRole = $('#adm-who-role');
const savedUnit = store.get('cdc.admin.unit');
function restrictUnits() {
  if (!unitSel) return;
  const s = getSession();
  if (!s) return;
  if (!canCrossUnit(s)) {
    for (const o of [...unitSel.options]) { o.disabled = o.value !== s.unit; o.hidden = o.value !== s.unit; }
    unitSel.value = s.unit; unitSel.setAttribute('aria-readonly', 'true'); unitSel.title = '你的角色只能看自己的單位；跨單位視角限總編輯、治理幕僚與平台管理';
    store.set('cdc.admin.unit', s.unit);
  } else if (savedUnit && [...unitSel.options].some((o) => o.value === savedUnit)) unitSel.value = savedUnit;
}
export const getUnit = () => unitSel?.value || getSession()?.unit || 'unit.acute-infectious';
export const unitLabel = (id = getUnit()) => (id === 'all' ? '全部單位' : unitSel?.querySelector(`option[value="${CSS.escape(id)}"]`)?.textContent ?? id);
/** 進頁檢查結果（在 unitLabel 定義之後才呼叫，gate 內會用到它） */
export const gateOk = gate();
restrictUnits();
function paintWho() {
  const s = getSession();
  if (whoName) whoName.textContent = s ? `${s.name}${s.title ? ` · ${s.title}` : ''}` : (PAGE_KEY === 'login' ? '尚未登入' : (getUnit() === 'all' ? '全部單位 · 資料治理幕僚' : `${unitLabel()} · 承辦人`));
  if (whoRole) whoRole.textContent = s ? `${unitLabel(s.unit)} · ${roleLabels(s).join('、')}${getUnit() !== s.unit ? `（視角：${unitLabel()}）` : ''}` : '';
}
paintWho();
unitSel?.addEventListener('change', () => {
  const s = getSession();
  if (s && !canCrossUnit(s) && unitSel.value !== s.unit) { unitSel.value = s.unit; return; }
  store.set('cdc.admin.unit', getUnit()); paintWho();
  if (s && getUnit() !== s.unit) audit('unit-switch', s, `切換視角到 ${unitLabel()}`);
  document.dispatchEvent(new CustomEvent('adm:unit', { detail: getUnit() }));
});
$('#adm-logout')?.addEventListener('click', () => logout());
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
