// /admin/due/ 審閱到期。
// 第五十輪：兩種模式（偵測方式與 /admin/publish/ 相同：gateway-client.js 的 detectGateway）。
//   有寫入閘道（npm run dev、正式後台）：每列「送出重新審閱」＝ POST /api/gateway/rereview，內容不改、現行版原樣送審；
//     列上顯示這筆的送審狀態（審核中、退回、已重新審閱）。審核人在 /admin/review/ 核准後最後審閱日才更新。
//   沒有閘道（GitHub Pages 靜態示範站）：維持「標記已審閱（示範）」，只記在這台電腦（localStorage cdc.admin.reviewed），
//     頁首的提醒框（data-gw-hide）說明它不會改變任何內容，並指出真正的做法（guide-staff §50）。
// 畫面文字一律 textContent（el()），不把送審件資料塞進 innerHTML。
import { $, $$, store, followUnit, today, url } from './common.js';
import { detectGateway, el, clear, fmtTime, errorText, STATUS_TONE } from './gateway-client.js';

const rows = $$('tbody tr[data-id]');
const marks = () => store.get('cdc.admin.reviewed', {}) ?? {};
const titleOf = (tr) => $('.adm-title', tr)?.textContent.trim() ?? tr.dataset.id;
let gw = null; // 有閘道時的 client；null ＝ 示範模式
const subs = new Map(); // contentId → 這個人看得到的最新一筆送審件
const LINK_BTN = 'adm-btn adm-btn--ghost adm-btn--sm'; // 表格裡的連結做成小按鈕：點擊區至少 24×24（WCAG 2.5.8；axe target-size）

/** 建置之後才核准的重新審閱（或一般修改）：最後審閱日比頁面上的新 ⇒ 下次網站更新就離開清單 */
const freshlyReviewed = (tr) => { const s = subs.get(tr.dataset.id); return !!s && ['published', 'approved'].includes(s.status) && !!s.reviewedAt && s.reviewedAt > (tr.dataset.reviewed ?? ''); };
const isDone = (tr) => (gw ? freshlyReviewed(tr) : !!marks()[tr.dataset.id]);

function paintDemo(tr) {
  const rec = marks()[tr.dataset.id], cell = clear($('[data-act]', tr));
  tr.classList.toggle('adm-row--done', !!rec);
  if (rec) {
    cell.append(el('span', { class: 'adm-badge adm-badge--gray', text: `已標記（示範）${rec.date}` }), el('div', { class: 'adm-muted', text: '只記在這台電腦，最後審閱日沒有改變' }),
      el('button', { type: 'button', class: 'adm-btn adm-btn--ghost adm-btn--sm', dataset: { undo: tr.dataset.id }, text: '復原' }));
  } else cell.append(el('button', { type: 'button', class: 'adm-btn adm-btn--ghost adm-btn--sm', dataset: { mark: tr.dataset.id }, text: '標記已審閱（示範）' }));
}

function paintGw(tr) {
  const id = tr.dataset.id, s = subs.get(id), cell = clear($('[data-act]', tr));
  tr.classList.toggle('adm-row--done', freshlyReviewed(tr));
  if (freshlyReviewed(tr)) {
    cell.append(el('span', { class: 'adm-badge adm-badge--ok', text: `已重新審閱 ${s.reviewedAt}` }), el('div', { class: 'adm-muted', text: '網站下次更新後離開此清單、回到 AI 引用範圍' }));
    return;
  }
  if (s && ['draft', 'returned', 'in_review'].includes(s.status)) {
    const rr = s.kind === 'rereview';
    cell.append(el('span', { class: `adm-badge adm-badge--${STATUS_TONE[s.status] ?? 'gray'}`, text: s.status === 'in_review' ? '審核中' : s.statusLabel }),
      el('div', { class: 'adm-muted', text: s.status === 'in_review' ? `${rr ? '重新審閱，' : ''}已核准 ${s.approvals.length}／${s.requiredApprovals}` : rr ? '重新審閱' : '修改中' }));
    if (s.status === 'in_review' && s.can?.approve) cell.append(el('a', { class: LINK_BTN, href: url(`/admin/review/?item=${encodeURIComponent(s.id)}`), text: '去審核' }));
    if (s.status === 'returned') {
      const last = (s.comments ?? []).filter((c) => c.kind === 'return').at(-1);
      if (last) cell.append(el('p', { class: 'gw-comment', text: `${last.name}：${last.text}` }));
      if (s.can?.submit) cell.append(el('button', { type: 'button', class: 'adm-btn adm-btn--sm', dataset: { resubmit: s.id }, 'aria-label': `「${titleOf(tr)}」不用修改，再送出重新審閱`, text: '不用修改，再送出' }));
    }
    if (['draft', 'returned'].includes(s.status)) cell.append(el('div', {}, el('a', { class: LINK_BTN, href: url(`/admin/publish/?gw=${encodeURIComponent(s.id)}`), text: '開啟修改' })));
    return;
  }
  cell.append(el('button', { type: 'button', class: 'adm-btn adm-btn--sm', dataset: { rr: id }, 'aria-label': `「${titleOf(tr)}」內容仍正確，送出重新審閱`, disabled: !gw.user, text: '送出重新審閱' }),
    el('div', {}, el('a', { class: LINK_BTN, href: url(`/admin/publish/?edit=${encodeURIComponent(id)}`), 'aria-label': `修改「${titleOf(tr)}」的內容`, text: '要修改內容' })));
}

const paint = () => { for (const tr of rows) (gw ? paintGw : paintDemo)(tr); };
function apply() {
  const u = $('#d-unit').value, q = $('#d-q').value.trim().toLowerCase();
  let open = 0;
  for (const tr of rows) { const ok = (u === 'all' || tr.dataset.owner === u) && (!q || tr.dataset.q.includes(q)); tr.hidden = !ok; if (ok && !isDone(tr)) open++; }
  $$('[data-group]').forEach((g) => { const n = $$('tbody tr[data-id]', g).filter((t) => !t.hidden && !isDone(t)).length; $('[data-gcount]', g).textContent = n; });
  $('#d-note').textContent = `待審閱 ${open} 筆`;
}
function say(text, tone = '') { const p = $('#d-gw'); p.hidden = false; p.textContent = text; p.className = `adm-count-note${tone ? ` adm-${tone}` : ''}`; }

async function loadSubs() {
  const r = await gw.get('/items?view=all');
  if (!r.ok) { say(errorText(r), 'red'); return; }
  subs.clear();
  for (const s of r.data.items) if (!subs.has(s.contentId)) subs.set(s.contentId, s); // 已依更新時間新到舊排序
}

document.addEventListener('click', async (e) => {
  const mk = e.target.closest('[data-mark]'), un = e.target.closest('[data-undo]'), rr = e.target.closest('[data-rr]'), rs = e.target.closest('[data-resubmit]');
  if (!gw && (mk || un)) {
    const m = marks();
    if (mk) m[mk.dataset.mark] = { date: today(), at: new Date().toISOString() }; else delete m[un.dataset.undo];
    store.set('cdc.admin.reviewed', m); paint(); apply();
    document.dispatchEvent(new CustomEvent('adm:queue'));
    return;
  }
  if (!gw?.user || (!rr && !rs)) return;
  const btn = rr ?? rs, tr = btn.closest('tr[data-id]');
  btn.disabled = true;
  say(`送出「${titleOf(tr)}」中…`);
  const r = rr ? await gw.post('/rereview', { contentId: tr.dataset.id, type: tr.dataset.type }) : await gw.post('/submit', { submissionId: rs.dataset.resubmit });
  if (!r.ok) { btn.disabled = false; say(errorText(r), 'red'); return; }
  subs.set(tr.dataset.id, r.data);
  paintGw(tr); apply();
  say(r.data.status === 'published' ? `「${r.data.title}」已重新審閱。` : `已送出「${r.data.title}」重新審閱（${fmtTime(r.data.submittedAt)}），已通知審核人；需要 ${r.data.requiredApprovals} 位核准，核准後最後審閱日才會更新。`, 'green');
});

paint();
followUnit($('#d-unit'), apply);
$('#d-q').addEventListener('input', apply);

gw = await detectGateway();
if (gw) {
  document.body.classList.add('adm-gw');
  if (!gw.user) {
    say(`無法使用後台服務：${errorText({ data: gw.error })}`, 'red');
    if (gw.error?.loginUrl) $('#d-gw').append(' ', el('a', { href: `${gw.error.loginUrl}?next=${encodeURIComponent('/admin/due/')}`, text: '用機關帳號登入' }));
  } else {
    await loadSubs();
    say(`${gw.user.name}：內容仍正確就按「送出重新審閱」；要改內容請按「要修改內容」。審核人核准後最後審閱日才會更新。`);
  }
  paint(); apply();
}
