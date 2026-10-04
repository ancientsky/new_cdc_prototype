// /notices/：公告專區（第七輪起只放「其他訊息」與已截止）。人才招募與採購公告已分家：頁首兩張入口卡連到 /careers/ 與 /procurement/。
import { html, raw } from '../../../scripts/lib/render.mjs';
import { ldFor, pageHead, publishedOf, noticeRow, isClosed, byDateDesc } from './_partials.mjs';
import { jobsOf, tendersOf, jobStage, tenderStage } from './_careers.mjs';

export function meta(ctx) { return { title: ctx.t('notices.title'), description: ctx.t('notices.lead'), styles: ['/assets/styles/careers.css'], jsonLd: ldFor(ctx, null, [{ label: ctx.t('notices.title') }]) }; }

export function render(ctx) {
  const { site, t } = ctx;
  // 招募／採購已移到 /careers/、/procurement/；舊的 recruit／procurement 新聞型別（若仍有）不再列在這裡
  const all = publishedOf(site, 'news').filter((n) => n.newsType === 'other');
  const open = all.filter((n) => !isClosed(site, n));
  const closed = all.filter((n) => isClosed(site, n)).sort((a, b) => String(b.deadlineAt).localeCompare(String(a.deadlineAt)));
  const sortOpen = (list) => list.sort((a, b) => (a.deadlineAt ?? '9999-12-31').localeCompare(b.deadlineAt ?? '9999-12-31') || byDateDesc(a, b));
  const tabs = [
    { id: 'other', label: t('notices.other'), list: sortOpen(open) },
    { id: 'closed', label: t('notices.closed'), list: closed },
  ];
  const nJobs = jobsOf(site).filter((j) => jobStage(site, j) === 'open').length;
  const nTenders = tendersOf(site).filter((x) => tenderStage(site, x) === 'open').length;
  const entry = (href, title, desc, n, nKey) => html`<li class="c-entrycard"><a class="c-entrycard__a" href="${ctx.url(href)}"><strong class="c-entrycard__t">${title} <span aria-hidden="true">→</span></strong><span class="c-entrycard__s">${desc}</span><span class="c-pill c-pill--${n ? 'ok' : 'neutral'}">${t(nKey, { n })}</span></a></li>`;
  return html`${pageHead(ctx, { trail: [{ label: t('notices.title') }], h1: t('notices.title'), lead: t('notices.lead'), actions: html`<a class="c-btn c-btn--ghost c-btn--sm" href="${ctx.url('/news/')}">${t('nav.news')}</a>` })}
<ul class="c-entrycards" aria-label="${t('notices.entry')}">${entry('/careers/', t('careers.title'), t('notices.entry.careers'), nJobs, 'notices.entry.open.jobs')}${entry('/procurement/', t('proc.title'), t('notices.entry.proc'), nTenders, 'notices.entry.open.tenders')}</ul>
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
