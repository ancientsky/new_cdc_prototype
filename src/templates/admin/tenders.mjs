// /admin/tenders/ 採購公告管理（秘書室；ARCHITECTURE 15.2）：標案與階段、決標逾期。階段來自 item.gov.tenderStage。
import { html } from '../../../scripts/lib/render.mjs';
import { pageHead, adminMeta, tenderRows, todoList, daysBetween } from './_partials.mjs';
export { layout } from './_layout.mjs';

export function pages() { return [{ path: '/admin/tenders/', props: {}, noindex: true }]; }
export function meta() { return adminMeta('採購公告管理', 'tenders', []); }

const STAGE = { open: ['招標中', 'ok'], closed: ['已截止', 'gray'], opened: ['已開標', 'info'], awarded: ['已決標', 'ok'], failed: ['流標', 'warn'], cancelled: ['已撤銷', 'gray'] };
const badge = (stage) => { const [l, k] = STAGE[stage] ?? [stage, 'gray']; return html`<span class="adm-badge adm-badge--${k}">${l}</span>`; };

export function render(ctx) {
  const { site, url } = ctx;
  const rows = tenderRows(site);
  const todos = todoList(site).filter((t) => t.kind === 'tender-award-overdue');
  const n = (st) => rows.filter((r) => r.stage === st).length;
  const overdue = rows.filter((r) => r.awardOverdue);
  return html`
${pageHead({
    title: '採購公告管理',
    what: '秘書室的標案總覽：每件標案目前在哪個階段（招標中、已截止、已開標、已決標、流標）、預算、投標截止與開標日，以及決標逾期的提醒。',
    flow: '標案是 content/tenders/ 的 tender 檔；新增、開標、決標、流標都是改檔開 PR。階段由日期與 award／manualStatus 推導；開標日後 30 日仍沒有決標資訊（且非流標、撤銷）會自動產生待辦給秘書室。',
  })}
<div class="adm-statrow">
  <div class="adm-stat adm-stat--info"><p class="adm-stat__label">招標中</p><p class="adm-stat__value">${n('open')}</p><p class="adm-stat__note">投標截止前</p></div>
  <div class="adm-stat"><p class="adm-stat__label">已截止</p><p class="adm-stat__value">${n('closed')}</p><p class="adm-stat__note">等開標</p></div>
  <div class="adm-stat"><p class="adm-stat__label">已開標</p><p class="adm-stat__value">${n('opened')}</p><p class="adm-stat__note">等決標</p></div>
  <div class="adm-stat adm-stat--ok"><p class="adm-stat__label">已決標</p><p class="adm-stat__value">${n('awarded')}</p><p class="adm-stat__note">公布得標廠商</p></div>
  <div class="adm-stat"><p class="adm-stat__label">流標／撤銷</p><p class="adm-stat__value">${n('failed') + n('cancelled')}</p><p class="adm-stat__note">不產生決標待辦</p></div>
  <div class="adm-stat ${overdue.length ? 'adm-stat--bad' : 'adm-stat--ok'}"><p class="adm-stat__label">決標逾期</p><p class="adm-stat__value">${overdue.length}</p><p class="adm-stat__note">開標後 30 日無決標</p></div>
</div>

<section class="adm-card" aria-labelledby="p-h"><h2 id="p-h">標案與階段</h2>
  <p class="adm-card__sub">前台：<a href="${url('/procurement/')}">/procurement/</a>。正式投標一律在政府電子採購網，本站只彙整公告與決標資訊。</p>
  <div class="adm-tablewrap"><table class="adm-table"><caption>共 ${rows.length} 件標案（建置日 ${site.today}）</caption>
    <thead><tr><th scope="col">標案</th><th scope="col">階段</th><th scope="col">採購方式</th><th scope="col" class="num">預算（元）</th><th scope="col">投標截止</th><th scope="col">開標</th><th scope="col">決標</th><th scope="col">採購網</th></tr></thead>
    <tbody>${rows.map((r) => html`<tr data-id="${r.id}" data-stage="${r.stage}">
      <td><a href="${url(r.front)}">${r.title}</a><div class="adm-muted"><code>${r.id}</code> · ${r.tenderNo} · ${r.requestingName}</div></td>
      <td>${badge(r.stage)}${r.status !== 'published' ? html` <span class="adm-badge adm-badge--info">${r.status}</span>` : ''}</td>
      <td>${r.method}${r.category ? html`<div class="adm-muted">${r.category}</div>` : ''}</td>
      <td class="num">${r.budgetNtd != null ? r.budgetNtd.toLocaleString('en-US') : '—'}</td>
      <td>${r.deadlineAt ?? '—'}${r.stage === 'open' && r.daysLeft != null ? html` <span class="adm-badge adm-badge--${r.daysLeft <= 7 ? 'warn' : 'ok'}">${r.daysLeft === 0 ? '今日' : `剩 ${r.daysLeft} 日`}</span>` : ''}</td>
      <td>${r.openingAt ?? '—'}</td>
      <td>${r.awardAt ? html`${r.awardAt}<div class="adm-muted">${r.winner}</div>` : r.awardOverdue ? html`<span class="adm-badge adm-badge--bad">逾期 ${r.sinceOpen - 30} 日</span>` : '—'}</td>
      <td>${r.pccUrl ? html`<a href="${r.pccUrl}" rel="noopener">外連</a>` : html`<span class="adm-muted">—</span>`}</td></tr>`)}</tbody></table></div>
  ${rows.length ? '' : html`<p class="adm-empty">尚無標案資料。</p>`}
</section>

<section class="adm-card" aria-labelledby="t-h"><h2 id="t-h">決標逾期待辦（秘書室）</h2>
  <p class="adm-card__sub">開標日起 30 日仍無決標資訊，且標案不是流標或撤銷。完整清單見 <a href="${url('/admin/todos/', { noLang: true })}#tender-award-overdue">連動待辦</a>。</p>
  ${todos.length ? html`<div class="adm-tablewrap"><table class="adm-table"><thead><tr><th scope="col">標案</th><th scope="col">說明</th><th scope="col">期限</th></tr></thead>
    <tbody>${todos.map((t) => html`<tr><td>${t.itemTitle}<div class="adm-muted"><code>${t.itemId}</code></div></td><td>${t.text ?? ''}</td><td>${t.dueAt ?? '—'}${t.dueAt && t.dueAt < site.today ? html` <span class="adm-badge adm-badge--bad">逾期 ${-daysBetween(site.today, t.dueAt)} 日</span>` : ''}</td></tr>`)}</tbody></table></div>`
    : html`<div class="adm-box adm-box--ok"><strong>目前沒有決標逾期</strong>已開標的標案都在 30 日內，或已有決標資訊。</div>`}
</section>`;
}
