// /admin/publish/ 的「送審與上線」面板（第三十輪）：有寫入閘道時，「儲存草稿／送審」直接交給閘道；沒有閘道就不出現。
// 同事只看到狀態（草稿、審核中、退回、已核准、已上線）、退回意見與歷程；背後的版本紀錄由閘道處理。
// 所有畫面文字以 textContent 寫入（el()），不把任何使用者資料塞進 innerHTML。
import { $, $$, store } from './common.js';
import { detectGateway, el, clear, fmtTime, errorText, STATUS_TONE } from './gateway-client.js';

const CUR_KEY = 'cdc.admin.gwCurrent'; // { contentId, sid }：這台電腦上次處理的送審件
// 錯誤欄位 → 表單上的欄位（點錯誤訊息就跳過去）
const FIELD_INPUT = { title: '#f-title', question: '#f-title', id: '#f-id', owner: '#f-owner', reviewPeriodMonths: '#f-period', summary: '#sum', answerMarkdown: '#f-wys', bodyMarkdown: '#f-wys', clarificationMarkdown: '#f-wys', introMarkdown: '#f-wys', abstractMarkdown: '#f-wys', publishAt: '#f-publish-at', basedOn: '#f-based-q' };

/**
 * @param {{ exportObj: () => any, loadItem: (item: any) => Promise<void>|void, getContentId: () => string }} api
 */
export async function initPublishGateway(api) {
  const panel = $('#gw-panel');
  if (!panel) return null;
  const gw = await detectGateway();
  if (!gw) return null;
  document.body.classList.add('adm-gw');
  panel.hidden = false;
  const localSave = $('#btn-save');
  if (localSave) { localSave.textContent = '暫存在這台電腦'; localSave.title = 'Ctrl+S：只存在這台電腦的瀏覽器，同事看不到'; }
  const stateEl = $('#gw-state'), statusEl = $('#gw-status'), errBox = $('#gw-errors'), notes = $('#gw-notes'), hist = $('#gw-history'), approvals = $('#gw-approvals');
  const btnSave = $('#gw-save'), btnSubmit = $('#gw-submit');
  let current = null;

  if (!gw.user) {
    stateEl.textContent = '無法使用';
    statusEl.textContent = errorText({ data: gw.error });
    if (gw.error?.loginUrl) statusEl.append(' ', el('a', { href: `${gw.error.loginUrl}?next=${encodeURIComponent(location.pathname.replace(/^.*?(\/admin\/)/, '$1'))}`, text: '用機關帳號登入' }));
    btnSave.disabled = true; btnSubmit.disabled = true;
    return gw;
  }

  function say(text, tone = '') { statusEl.textContent = text; statusEl.className = tone ? `adm-${tone}` : 'adm-muted'; }
  function paint() {
    const st = current?.status ?? null;
    stateEl.textContent = current ? current.statusLabel : '尚未送審';
    stateEl.className = `adm-badge adm-badge--${STATUS_TONE[st] ?? 'gray'}`;
    approvals.textContent = current && st === 'in_review' ? `需要 ${current.requiredApprovals} 位審核，已核准 ${current.approvals.length} 位` : current?.scheduledFor && st === 'approved' ? `排程 ${current.scheduledFor} 上線` : '';
    const locked = st === 'in_review';
    btnSave.disabled = locked; btnSubmit.disabled = locked;
    btnSubmit.textContent = st === 'returned' ? '修改完成，再送審' : '送審';
    // 退回意見（最新在前）
    clear(notes);
    const returns = (current?.comments ?? []).filter((c) => c.kind === 'return');
    if (returns.length && ['returned', 'draft'].includes(st)) {
      const last = returns[returns.length - 1];
      notes.append(el('div', { class: 'adm-box adm-box--warn' }, el('strong', { text: `${last.name} 退回修改（${fmtTime(last.at)}）` }), el('p', { class: 'gw-comment', text: last.text })));
    }
    clear(hist);
    for (const h of [...(current?.history ?? [])].reverse()) hist.append(el('li', {}, el('span', { text: `${fmtTime(h.at)}　${h.label}` }), el('span', { class: 'adm-muted', text: `　${h.name}` })));
    $('#gw-history-wrap').hidden = !current?.history?.length;
  }
  function showErrors(fields) {
    clear(errBox);
    errBox.hidden = !fields?.length;
    if (!fields?.length) return;
    const list = el('ul', {});
    for (const f of fields) {
      const target = FIELD_INPUT[f.field];
      list.append(el('li', {}, target ? el('button', { type: 'button', class: 'adm-linkbtn', dataset: { target }, text: f.message }) : f.message));
    }
    errBox.append(el('strong', { text: '還需要修正這些地方（點一下就跳到該欄位）' }), list);
  }
  errBox.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-target]');
    if (!b) return;
    if (b.dataset.target === '#sum') $('#pt-res')?.click();
    const t = $(b.dataset.target);
    t?.closest('details')?.setAttribute('open', '');
    t?.focus();
  });
  function remember() { if (current) store.set(CUR_KEY, { contentId: current.contentId, sid: current.id }); }

  async function refresh() {
    const qs = new URLSearchParams(location.search);
    const sid = qs.get('gw');
    if (sid && /^gw-\d{8}-[0-9a-f]{6}$/.test(sid) && !current) {
      const [d, c] = await Promise.all([gw.get(`/items/${sid}`), gw.get(`/items/${sid}/content`)]);
      if (d.ok) {
        current = d.data;
        if (c.ok && c.data?.item) await api.loadItem(c.data.item);
        remember(); paint();
        say(current.status === 'returned' ? '這筆內容被退回了，請依意見修改後再送審。' : `已開啟送審中的內容（${current.statusLabel}）。`);
        return;
      }
      say(errorText(d), 'red');
    }
    const cid = api.getContentId();
    if (!cid) { current = null; paint(); return; }
    const r = await gw.get(`/items?view=mine&contentId=${encodeURIComponent(cid)}`);
    if (r.ok) { current = r.data.items[0] ?? null; if (current) remember(); paint(); }
  }

  async function act(kind) {
    const item = api.exportObj();
    const body = { item, ...(current && ['draft', 'returned'].includes(current.status) && current.contentId === item.id ? { submissionId: current.id } : {}) };
    btnSave.disabled = true; btnSubmit.disabled = true;
    say(kind === 'save' ? '檢查並儲存中…' : '檢查並送審中…');
    const r = await gw.post(kind === 'save' ? '/drafts' : '/submit', body);
    if (r.ok) {
      current = r.data; remember(); showErrors([]); paint();
      say(kind === 'save' ? `已儲存草稿（${fmtTime(current.updatedAt)}）。同單位的同事也看得到這一版。` : current.status === 'published' ? '已上線。' : `已送審，已通知審核人。需要 ${current.requiredApprovals} 位核准。`, 'green');
    } else {
      paint();
      showErrors(r.data?.fields ?? []);
      say(errorText(r), 'red');
      if (r.data?.fields?.length) errBox.focus();
    }
  }
  btnSave.addEventListener('click', () => act('save'));
  btnSubmit.addEventListener('click', () => act('submit'));
  $('#f-id')?.addEventListener('change', () => { current = null; refresh(); });
  $$('#btn-clear').forEach((b) => b.addEventListener('click', () => { current = null; paint(); }));
  await refresh();
  return gw;
}
