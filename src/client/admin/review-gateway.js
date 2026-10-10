// /admin/review/ 的線上審核（第三十輪）：有寫入閘道時，審核人在這裡看佇列、白話差異、預覽，按「核准上線」或「退回修改」（意見必填）。
// 沒有閘道（GitHub Pages）就不出現，複核區維持原本的瀏覽器示範。畫面文字全部以 textContent 寫入。
import { $ } from './common.js';
import { detectGateway, el, clear, fmtTime, errorText, STATUS_TONE } from './gateway-client.js';

const TYPE = { disease: '疾病頁', faq: 'Q&A', news: '新聞稿', letter: '致醫界通函', clarification: '澄清', document: '文件', vaccine: '疫苗頁', media: '影音', topic: '專區', service: '申請服務', publication: '出版品', labtest: '檢驗項目', research: '研究計畫', job: '人才招募', tender: '採購公告', banner: '宣導 Banner', page: '一般頁', dataset: '資料集', article: '疫情報導文章' };

(async function init() {
  const box = $('#gw-review');
  if (!box) return;
  const gw = await detectGateway();
  if (!gw) return;
  document.body.classList.add('adm-gw');
  box.hidden = false;
  const tbody = $('#gw-queue'), count = $('#gw-rv-count'), empty = $('#gw-empty'), detail = $('#gw-detail'), msg = $('#gw-act-msg');
  if (!gw.user) {
    count.textContent = errorText({ data: gw.error });
    if (gw.error?.loginUrl) count.append(' ', el('a', { href: `${gw.error.loginUrl}?next=${encodeURIComponent('/admin/review/')}`, text: '用機關帳號登入' }));
    return;
  }
  $('#gw-rv-who').textContent = `${gw.user.name}（${gw.user.roles.join('、')}）`;
  let current = null;
  function closePreview() { const w = $('#gw-preview-wrap'); clear(w).hidden = true; $('#gw-preview-btn').setAttribute('aria-expanded', 'false'); $('#gw-preview-btn').textContent = '顯示送審版預覽'; }

  async function loadQueue() {
    const r = await gw.get('/items?view=queue');
    clear(tbody);
    if (!r.ok) { count.textContent = errorText(r); return; }
    const items = r.data.items;
    count.textContent = `待審核 ${items.length} 筆`;
    empty.hidden = items.length > 0;
    for (const it of items) {
      tbody.append(el('tr', { dataset: { sid: it.id } },
        el('td', { text: TYPE[it.type] ?? it.type }),
        el('td', {}, el('strong', { text: it.title }), el('div', { class: 'adm-muted', text: it.isNew ? '新內容' : '修改既有內容' })),
        el('td', { text: it.ownerName }),
        el('td', { text: it.editors.map((e) => e.name).join('、') }),
        el('td', { text: it.submittedAt ? fmtTime(it.submittedAt) : '—' }),
        el('td', {}, el('span', { class: `adm-badge adm-badge--${STATUS_TONE[it.status] ?? 'gray'}`, text: it.statusLabel }), el('div', { class: 'adm-muted', text: `已核准 ${it.approvals.length}／${it.requiredApprovals}` })),
        el('td', {}, el('button', { type: 'button', class: 'adm-btn adm-btn--sm', dataset: { sid: it.id }, 'aria-label': `審核「${it.title}」`, text: '審核' }))));
    }
  }

  function seg(parts, tag) { return (parts ?? []).map((p) => (p.ch ? el(tag, { text: p.t }) : document.createTextNode(p.t))); }
  function sentences(list, side) {
    const ol = el('ol', { class: 'gw-sents' });
    for (const s of list) {
      const li = el('li', { class: s.mark ? `gw-s--${s.mark}` : '' });
      if (s.mark === 'changed') li.append(el('span', { class: 'adm-sr-only', text: side === 'before' ? '（改前）' : '（改後）' }), ...seg(s.parts, side === 'before' ? 'del' : 'ins'));
      else if (s.mark === 'added') li.append(el('ins', { text: s.t }));
      else if (s.mark === 'removed') li.append(el('del', { text: s.t }));
      else li.append(s.t);
      ol.append(li);
    }
    return ol;
  }
  function renderDiff(d) {
    const wrap = clear($('#gw-diff'));
    if (d.note) { wrap.append(el('p', { class: 'adm-muted', text: d.note })); return; }
    if (d.isNew) wrap.append(el('p', { class: 'adm-box adm-box--info', text: '這是新內容，網站上還沒有這一筆；下面列出填寫的欄位。' }));
    if (!d.changes.length) { wrap.append(el('p', { class: 'adm-muted', text: '與網站上的版本相同，沒有修改。' })); return; }
    for (const c of d.changes) {
      const sec = el('section', { class: 'gw-change' }, el('h4', {}, el('span', { text: `${c.label}：` }), el('span', { class: 'gw-change__sum', text: c.summary })));
      if (c.type === 'text' && !d.isNew) {
        sec.append(el('div', { class: 'gw-cols' },
          el('div', {}, el('p', { class: 'gw-col__h', text: '網站上的版本' }), c.before.length ? sentences(c.before, 'before') : el('p', { class: 'adm-muted', text: '（空白）' })),
          el('div', {}, el('p', { class: 'gw-col__h', text: '送審的版本' }), c.after.length ? sentences(c.after, 'after') : el('p', { class: 'adm-muted', text: '（空白）' }))));
      } else if (c.type === 'text') sec.append(el('p', { class: 'gw-plain', text: c.after.map((s) => s.t).join('') }));
      else if (c.type === 'value' && c.from && c.to && c.from.length > 40) sec.append(el('div', { class: 'gw-cols' }, el('pre', { class: 'adm-pre', tabindex: '0', text: c.from }), el('pre', { class: 'adm-pre', tabindex: '0', text: c.to })));
      wrap.append(sec);
    }
  }

  async function open(sid) {
    msg.textContent = '';
    const [d, diff] = await Promise.all([gw.get(`/items/${sid}`), gw.get(`/items/${sid}/diff`)]);
    if (!d.ok) { msg.textContent = errorText(d); return; }
    current = d.data;
    detail.hidden = false;
    $('#gw-d-title').textContent = current.title;
    const meta = clear($('#gw-d-meta'));
    const row = (k, v) => meta.append(el('dt', { text: k }), el('dd', { text: v }));
    row('狀態', current.statusLabel);
    row('權責單位', current.ownerName);
    row('承辦', current.editors.map((e) => e.name).join('、'));
    row('送審時間', current.submittedAt ? fmtTime(current.submittedAt) : '—');
    row('需要審核', `${current.requiredApprovals} 位（已核准 ${current.approvals.length} 位${current.approvals.length ? `：${current.approvals.map((a) => a.name).join('、')}` : ''}）`);
    if (current.laneLabel) row('發布方式', [current.laneLabel, ...current.laneNotes].join('；'));
    if (current.scheduledFor) row('排程上線', current.scheduledFor);
    const prev = (current.comments ?? []).filter((c) => c.kind === 'return');
    if (prev.length) row('之前的退回意見', prev.map((c) => `${c.name}：${c.text}`).join('\n'));
    if (diff.ok) renderDiff(diff.data); else clear($('#gw-diff')).append(el('p', { class: 'adm-red', text: errorText(diff) }));
    closePreview();
    const can = current.can?.approve;
    $('#gw-approve').disabled = !can; $('#gw-return').disabled = !current.can?.return;
    $('#gw-why').textContent = can ? '' : current.why?.review ?? '';
    $('#gw-comment').value = '';
    $('#gw-d-h').focus();
  }

  async function act(kind) {
    if (!current) return;
    const comment = $('#gw-comment').value.trim();
    if (kind === 'return' && !comment) { msg.textContent = '請寫下退回原因，承辦人才知道要改什麼。'; msg.className = 'adm-red'; $('#gw-comment').focus(); return; }
    $('#gw-approve').disabled = true; $('#gw-return').disabled = true;
    msg.className = 'adm-muted'; msg.textContent = kind === 'return' ? '退回中…' : '核准中…';
    const r = await gw.post(`/items/${current.id}/${kind}`, { comment });
    if (!r.ok) { msg.className = 'adm-red'; msg.textContent = errorText(r); if (r.data?.fields?.some((f) => f.field === 'comment')) $('#gw-comment').focus(); $('#gw-approve').disabled = !current.can?.approve; $('#gw-return').disabled = !current.can?.return; return; }
    current = r.data;
    msg.className = 'adm-green';
    msg.textContent = kind === 'return' ? `已退回「${current.title}」，承辦人已收到通知。`
      : current.status === 'published' ? `已核准，「${current.title}」已上線，承辦人已收到通知。`
        : current.status === 'approved' ? `已核准，「${current.title}」將於 ${current.scheduledFor} 上線。`
          : `已核准（${current.approvals.length}／${current.requiredApprovals}），還需要 ${current.requiredApprovals - current.approvals.length} 位審核。`;
    $('#gw-d-meta dd').textContent = current.statusLabel;
    await loadQueue();
  }

  tbody.addEventListener('click', (e) => { const b = e.target.closest('button[data-sid]'); if (b) open(b.dataset.sid); });
  $('#gw-approve').addEventListener('click', () => act('approve'));
  $('#gw-return').addEventListener('click', () => act('return'));
  $('#gw-preview-btn').addEventListener('click', async () => {
    const wrap = $('#gw-preview-wrap');
    if (!wrap.hidden) { closePreview(); return; }
    const r = await gw.get(`/items/${current.id}/preview`);
    // 預覽頁由閘道以建置同一個淨化器產生，再放進無權限的 sandbox iframe（不執行任何腳本、與後台不同源、讀不到後台的登入資料）
    if (r.ok) {
      const frame = el('iframe', { id: 'gw-preview-frame', title: `「${current.title}」送審版預覽`, sandbox: '' });
      frame.srcdoc = String(r.data);
      clear(wrap).append(frame);
      wrap.hidden = false; $('#gw-preview-btn').setAttribute('aria-expanded', 'true'); $('#gw-preview-btn').textContent = '收起預覽';
    } else msg.textContent = errorText(r);
  });
  await loadQueue();
  const want = new URLSearchParams(location.search).get('item');
  if (want && /^gw-\d{8}-[0-9a-f]{6}$/.test(want)) await open(want);
})();
