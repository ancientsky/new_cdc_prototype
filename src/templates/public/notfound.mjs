import { html } from '../../../scripts/lib/render.mjs';
import { askBox } from './_partials.mjs';

export function meta(ctx) { return { title: ctx.t('404.title'), description: ctx.t('404.title'), noindex: true }; }

export function render(ctx) {
  const { t, url } = ctx;
  return html`<section class="c-notfound">
  <p class="c-notfound__code" aria-hidden="true">404</p>
  <h1>${t('404.title')}</h1>
  <p class="lead">${t('404.lead')}</p>
  ${askBox(ctx, { id: 'nq', size: 'md' })}
  <ul class="c-linklist c-notfound__links">
    <li><a href="${url('/')}">${t('404.home')}</a></li>
    <li><a href="${url('/diseases/')}">${t('nav.diseases')}</a> · <a href="${url('/news/')}">${t('nav.news')}</a> · <a href="${url('/sitemap-page/')}">${t('sitemap')}</a></li>
    <li><a href="${url('/v1/redirects.json', { noLang: true })}">${t('404.redirects')}</a></li>
    <li><a href="tel:1922">${t('404.call')}</a></li>
  </ul>
</section>`;
}

export function pages() { return [{ path: '/404.html', file: true, noindex: true, props: {} }]; }
