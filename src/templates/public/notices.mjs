// /notices/：人才招募、採購公告、其他訊息、已截止。每則顯示字號、截止日倒數（7 日內黃、已截止灰）、報名／投標外部連結。
import { html, raw } from '../../../scripts/lib/render.mjs';
import { ldFor, pageHead, publishedOf, noticeRow, isClosed, isNotice, byDateDesc } from './_partials.mjs';

export function meta(ctx) { return { title: ctx.t('notices.title'), description: ctx.t('notices.lead'), jsonLd: ldFor(ctx, null, [{ label: ctx.t('notices.title') }]) }; }

export function render(ctx) {
  const { site, t } = ctx;
  const all = publishedOf(site, 'news').filter(isNotice);
  const open = all.filter((n) => !isClosed(site, n));
  const closed = all.filter((n) => isClosed(site, n)).sort((a, b) => String(b.deadlineAt).localeCompare(String(a.deadlineAt)));
  const sortOpen = (list) => list.sort((a, b) => (a.deadlineAt ?? '9999-12-31').localeCompare(b.deadlineAt ?? '9999-12-31') || byDateDesc(a, b));
  const tabs = [
    { id: 'recruit', label: t('news.type.recruit'), list: sortOpen(open.filter((n) => n.newsType === 'recruit')) },
    { id: 'procurement', label: t('news.type.procurement'), list: sortOpen(open.filter((n) => n.newsType === 'procurement')) },
    { id: 'other', label: t('notices.other'), list: open.filter((n) => n.newsType === 'other').sort(byDateDesc) },
    { id: 'closed', label: t('notices.closed'), list: closed },
  ];
  return html`${pageHead(ctx, { trail: [{ label: t('notices.title') }], h1: t('notices.title'), lead: t('notices.lead'), actions: html`<a class="c-btn c-btn--ghost c-btn--sm" href="${ctx.url('/news/')}">${t('nav.news')}</a>` })}
<div class="c-tabs" data-tabs>
  <div class="c-tabs__list" role="tablist" aria-label="${t('notices.title')}">${tabs.map((tb, i) => html`<button type="button" role="tab" id="tab-n-${tb.id}" aria-controls="panel-n-${tb.id}" aria-selected="${i === 0 ? 'true' : 'false'}" tabindex="${i === 0 ? '0' : '-1'}">${tb.label} <span class="c-tabs__n">${tb.list.length}</span></button>`)}</div>
  <div>${tabs.map((tb, i) => html`<div class="c-tabs__panel" role="tabpanel" id="panel-n-${tb.id}" aria-labelledby="tab-n-${tb.id}" ${i ? raw('data-initial-hidden') : ''}>
    <h2 class="c-tabs__print">${tb.label}</h2>
    ${tb.id === 'closed' ? html`<p class="muted">${t('notices.closed.note')}</p>` : ''}
    ${tb.list.length ? html`<ul class="c-noticelist">${tb.list.map((n) => noticeRow(ctx, n))}</ul>` : html`<p class="c-empty">${t('notices.empty')}</p>`}
  </div>`)}</div>
</div>
<p class="muted">${t('notices.rule')}</p>`;
}

export function pages() { return [{ path: '/notices/', lang: '*', props: {} }]; }
