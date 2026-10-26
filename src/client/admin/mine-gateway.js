// /admin/mine/ 的「單位進行中的送審件」（第六十七輪，guide-staff §61、docs/deploy.md §33）。
// 有寫入閘道時才出現：列出自己單位的草稿／退回／審核中送審件，可依承辦人篩選；同事離職或調動時按「接手」把自己設為承辦人。
// 沒有閘道（GitHub Pages、?gateway=off）時這一塊不出現，頁面照舊只有單位內容清單。畫面文字一律走 textContent。
import { $ } from './common.js';
import { detectGateway, el, clear, fmtTime, errorText, STATUS_TONE } from './gateway-client.js';

const OPEN = ['draft', 'returned', 'in_review'];

(async function init() {
  const box = $('#gw-unit');
  if (!box) return;
  const gw = await detectGateway();
  if (!gw) return;
  box.hidden = false;
  const tbody = $('#gwu-rows'),
    sel = $('#gwu-editor'),
    count = $('#gwu-count'),
    msg = $('#gwu-msg');
  if (!gw.user) {
    count.textContent = errorText({ data: gw.error });
    return;
  }

  /** 承辦人選單：用全部進行中送審件的承辦人（沒交接出去的）建；保留目前選的 */
  function fillEditors(items) {
    const keep = sel.value;
    const seen = new Map();
    for (const it of items) for (const e of it.contacts ?? it.editors ?? []) seen.set(e.account, e.name);
    while (sel.options.length > 1) sel.remove(1);
    for (const [account, name] of [...seen].sort((a, b) => String(a[1]).localeCompare(String(b[1]), 'zh-Hant')))
      sel.append(el('option', { value: account, text: `${name}（${account}）` }));
    sel.value = seen.has(keep) ? keep : '';
  }

  async function load() {
    const all = await gw.get('/items?view=all');
    if (!all.ok) {
      count.textContent = errorText(all);
      return;
    }
    const open = all.data.items.filter((it) => OPEN.includes(it.status));
    fillEditors(open);
    let items = open;
    if (sel.value) {
      const r = await gw.get(`/items?view=all&editor=${encodeURIComponent(sel.value)}`);
      items = r.ok ? r.data.items.filter((it) => OPEN.includes(it.status)) : [];
    }
    clear(tbody);
    count.textContent = `進行中 ${items.length} 件`;
    for (const it of items) {
      const contacts = (it.contacts ?? []).map((e) => e.name).join('、') || '—';
      const before = (it.editors ?? []).filter((e) => e.handedOver).map((e) => e.name);
      const act = it.can?.handover
        ? el('button', { type: 'button', class: 'adm-btn adm-btn--sm', dataset: { sid: it.id }, 'aria-label': `接手「${it.title}」`, text: '接手' })
        : el('span', { class: 'adm-muted', text: (it.contacts ?? []).some((e) => e.account === gw.user.account) ? '你是承辦人' : '—' });
      tbody.append(
        el(
          'tr',
          {},
          el('td', {}, el('strong', { text: it.title }), el('div', { class: 'adm-muted', text: it.ownerName })),
          el('td', {}, el('span', { class: `adm-badge adm-badge--${STATUS_TONE[it.status] ?? 'gray'}`, text: it.statusLabel })),
          el('td', {}, contacts, before.length ? el('div', { class: 'adm-muted', text: `已交接：${before.join('、')}` }) : null),
          el('td', { text: fmtTime(it.updatedAt) }),
          el('td', {}, act),
        ),
      );
    }
  }

  sel.addEventListener('change', load);
  tbody.addEventListener('click', async (ev) => {
    const b = ev.target instanceof Element ? ev.target.closest('button[data-sid]') : null;
    if (!b) return;
    b.disabled = true;
    const r = await gw.post(`/items/${encodeURIComponent(b.dataset.sid)}/handover`, {});
    msg.textContent = r.ok ? `已接手「${r.data.title}」：之後的通知會寄給你。` : errorText(r);
    await load();
  });
  await load();
})();
