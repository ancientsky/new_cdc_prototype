// 網站導覽：列出所有路由（給人看的 sitemap）。
import { html } from '../../../scripts/lib/render.mjs';
import { config } from '../../../site.config.mjs';
import { ldFor, pageHead, hrefFor, L, publishedOf, PAGE_PATHS, slugOf } from './_partials.mjs';

export function meta(ctx) { return { title: ctx.t('sitemap'), description: ctx.t('sitemap.desc'), jsonLd: ldFor(ctx, null, [{ label: ctx.t('sitemap') }]) }; }

export function render(ctx) {
  const { site, t, url } = ctx;
  const li = (href, text, sub = '') => html`<li><a href="${href}">${text}</a>${sub ? html` <span class="muted">${sub}</span>` : ''}</li>`;
  const group = (title, items) => (items.length ? html`<section class="c-sitemap__g"><h2>${title}</h2><ul class="c-linklist">${items}</ul></section>` : '');
  const docs = site.collections.documents.filter((d) => d.status === 'published');
  return html`${pageHead(ctx, { trail: [{ label: t('sitemap') }], h1: t('sitemap'), lead: t('sitemap.lead') })}
<div class="c-sitemap">
  ${group(t('sitemap.main'), [
    li(url('/'), t('tab.home')), li(url('/ask/'), t('ask.title')), li(url('/situation/'), t('nav.situation')), li(url('/diseases/'), t('nav.diseases')), li(url('/vaccines/'), t('nav.vaccines')),
    li(url('/travel/'), t('nav.travel')), li(url('/factcheck/'), t('nav.factcheck')), li(url('/data/'), t('nav.data')), li(url('/news/'), t('nav.news')), li(url('/faq/'), t('nav.faq')), li(url('/documents/'), t('nav.documents')),
  ])}
  ${group(t('home.tasks'), config.tasks.map((k) => li(url(`/tasks/${k.key}/`), t(`task.${k.key}.label`))))}
  ${group(t('nav.diseases'), publishedOf(site, 'diseases').map((d) => li(hrefFor(ctx, d), L(ctx, d, 'title'), d.nameEn)))}
  ${group(t('nav.vaccines'), publishedOf(site, 'vaccines').map((d) => li(hrefFor(ctx, d), L(ctx, d, 'title'))))}
  ${group(t('nav.travel'), (site.master.countries ?? []).map((c) => li(url(`/travel/${c.iso2}/`), ctx.lang === 'zh-TW' ? c.name : c.nameEn, c.iso2)))}
  ${group(t('nav.news'), publishedOf(site, 'news').map((n) => li(hrefFor(ctx, n), L(ctx, n, 'title'), n.publishedAt)))}
  ${group(t('nav.faq'), publishedOf(site, 'faq').map((f) => li(hrefFor(ctx, f), L(ctx, f, 'question') ?? f.title)))}
  ${group(t('nav.documents'), docs.map((d) => li(hrefFor(ctx, d), L(ctx, d, 'title'), `${d.version}${d.isCurrent ? '' : ` · ${t('documents.expired')}`}`)))}
  ${group(t('home.more'), [
    li(url('/services/'), t('services.title')), li(url('/apply/'), t('apply.title')), li(url('/publications/'), t('publications.title')), li(url('/lab/'), t('lab.title')), li(url('/report/'), t('report.title')),
    li(url('/research/'), t('research.title')), li(url('/careers/'), t('careers.title')), li(url('/procurement/'), t('proc.title')), li(url('/notices/'), t('notices.title')), li(url('/media/'), t('media.title')), li(url('/campaigns/'), t('campaigns.title')), li(url('/contact/'), t('contact.title')), li(url('/about/'), t('footer.about')),
  ])}
  ${group(t('home.media'), publishedOf(site, 'media').map((d) => li(hrefFor(ctx, d), L(ctx, d, 'title'), d.basedOnVersionLabel ?? '')))}
  ${group(t('home.topics'), publishedOf(site, 'topics').map((d) => li(hrefFor(ctx, d), L(ctx, d, 'title'))))}
  ${group(t('apply.title'), publishedOf(site, 'services').map((d) => li(hrefFor(ctx, d), L(ctx, d, 'title'))))}
  ${group(t('publications.title'), publishedOf(site, 'publications').map((d) => li(hrefFor(ctx, d), L(ctx, d, 'title'))))}
  ${group(t('lab.title'), publishedOf(site, 'labtests').map((d) => li(hrefFor(ctx, d), L(ctx, d, 'title'))))}
  ${group(t('research.title'), publishedOf(site, 'research').map((d) => li(hrefFor(ctx, d), L(ctx, d, 'title'), String(d.year))))}
  ${group(t('sitemap.policy'), [
    ...Object.entries(PAGE_PATHS).filter(([slug]) => slug !== 'about').map(([slug, p]) => li(url(p), t(`page.${slug}`))), li(url('/transparency/'), t('footer.transparency')), li(url('/guide/'), t('footer.guide')),
  ])}
  ${group(t('sitemap.pro'), [li(url('/pro/'), t('nav.pro')), li(url('/developers/'), t('footer.api')), li(url('/openapi.json', { noLang: true }), 'openapi.json'), li(url('/llms.txt', { noLang: true }), 'llms.txt'), li(url('/admin/', { noLang: true }), t('footer.admin'))])}
</div>`;
}

export function pages() { return [{ path: '/sitemap-page/', lang: '*', props: {} }]; }
void slugOf;
