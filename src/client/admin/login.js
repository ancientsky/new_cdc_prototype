// /admin/login/：示範登入（第十八輪）。選示範帳號＝模擬機關 SSO 回傳身分；自訂身分給測試用。登入後導回 ?next=（限站內 /admin/ 路徑）。
import { $, $$, esc, url, base, readEmbedded, login, getSession, getAudit, store, fmtDT, unitLabel } from './common.js';
import { sessionProblem, roleLabels } from './auth-rules.js';

const accounts = readEmbedded('lg-accounts', []);
const unitNames = readEmbedded('lg-units', {});
const uName = (id) => unitNames[id] ?? unitLabel(id);
const params = new URLSearchParams(location.search);
/** 只接受站內後台路徑，避免開放式轉址（open redirect） */
function safeNext() {
  const n = params.get('next') ?? '';
  let p = n;
  try { if (/^https?:/i.test(n)) p = new URL(n).pathname; } catch { p = ''; }
  if (base && p.startsWith(base)) p = p.slice(base.length);
  return /^\/admin\/(?!login)/.test(p) ? p : '/admin/mine/';
}
const next = safeNext();
const note = $('#lg-next-note');
if (note && params.get('next')) note.textContent = `登入後回到 ${next}`;

// 已登入就直接進去（避免重複登入）
const cur = getSession();
if (cur && !sessionProblem(cur)) {
  const name = $('#adm-who-name'); if (name) name.textContent = `${cur.name} · 已登入`;
  const role = $('#adm-who-role'); if (role) role.textContent = `${uName(cur.unit)} · ${roleLabels(cur).join('、')}`;
  const box = document.createElement('p'); box.className = 'adm-login__already';
  box.innerHTML = `你已以 <strong>${esc(cur.name)}</strong> 登入。<a class="adm-btn adm-btn--ghost" href="${url(next)}">繼續到後台</a> <button type="button" class="adm-btn adm-btn--ghost" id="lg-switch">改用其他身分（先登出）</button>`;
  $('.adm-pagehead')?.after(box);
  $('#lg-switch')?.addEventListener('click', () => { import('./common.js').then((m) => m.logout('改用其他身分')); });
}

function go(s) {
  const btn = $('#lg-sso-btn');
  if (btn) { btn.disabled = true; btn.textContent = `已登入：${s.name}，前往後台…`; }
  setTimeout(() => { location.href = url(next); }, 250);
}

$('#lg-form')?.addEventListener('submit', (e) => {
  e.preventDefault();
  const sub = new FormData(e.target).get('acct');
  const acct = accounts.find((a) => a.sub === sub);
  if (!acct) return;
  const s = login(acct, 'sso-demo');
  if (s) go(s);
});
$('#lg-manual-form')?.addEventListener('submit', (e) => {
  e.preventDefault();
  const roles = $$('input[name="role"]:checked', e.target).map((i) => i.value);
  const s = login({ name: $('#lg-name').value, unit: $('#lg-unit').value, roles, title: '示範' }, 'manual-demo');
  if (!s) { alert('至少選一個角色'); return; }
  go(s);
});

// 稽核表
const KIND = { login: '登入', logout: '登出', denied: '拒絕存取', 'unit-switch': '切換視角', expired: '階段失效' };
function paintAudit() {
  const rows = getAudit().slice().reverse();
  const tb = $('#lg-audit-table tbody'); const empty = $('#lg-audit-empty');
  if (!tb) return;
  tb.innerHTML = rows.map((r) => `<tr><td>${esc(fmtDT(r.at))}</td><td>${esc(KIND[r.kind] ?? r.kind)}</td><td>${esc(r.name ?? '—')}</td><td>${esc(r.unit ? uName(r.unit) : '—')}</td><td>${esc(r.detail)}</td></tr>`).join('');
  if (empty) empty.hidden = rows.length > 0;
  $('#lg-audit-table').closest('.adm-tablewrap').hidden = rows.length === 0;
}
paintAudit();
document.addEventListener('adm:audit', paintAudit);
$('#lg-audit-clear')?.addEventListener('click', () => { if (confirm('清除本機稽核紀錄？（正式環境不允許使用者刪稽核）')) { store.del('cdc.admin.audit'); paintAudit(); } });
