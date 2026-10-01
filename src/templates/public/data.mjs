// 開放資料與統計：統計問答殼（D 的 stats.js）+ 資料目錄 + 開放資料與 API 卡。
import { html, raw } from '../../../scripts/lib/render.mjs';
import { config } from '../../../site.config.mjs';
import { ldFor, pageHead, sectionHead, unitName, licenseLabel, publishedOf, pill, L, feedback } from './_partials.mjs';

const CATS = ['open-dataset', 'stats-system', 'structured-table', 'document-library', 'content-page', 'press', 'media'];
const V1 = ['diseases', 'vaccines', 'faq', 'news', 'documents', 'clarifications', 'situation', 'travel-alerts', 'country-levels', 'datasets', 'catalog', 'glossary', 'search-index', 'redirects'];

export function meta(ctx) {
  return { title: ctx.t('nav.data'), description: ctx.t('data.desc'), styles: ['/assets/styles/answer.css'], scripts: ['/assets/js/answer/stats.js'], jsonLd: ldFor(ctx, null, [{ label: ctx.t('nav.data') }]) };
}

export function render(ctx) {
  const { site, t, url, fmtDate } = ctx;
  const ds = publishedOf(site, 'datasets');
  const cats = CATS.filter((c) => ds.some((d) => d.category === c));
  const origin = `${config.siteUrl}${config.basePath}`;
  return html`${pageHead(ctx, { trail: [{ label: t('nav.data') }], h1: t('data.h1'), lead: t('data.lead') })}
<section class="c-stats" aria-labelledby="st-h">
  <h2 id="st-h">${t('data.stats.t')}</h2>
  <p class="muted">${t('data.stats.d')}</p>
  <form id="stats-form" class="c-askbox c-askbox--md" action="${url('/data/')}" method="get" role="search">
    <label class="sr-only" for="stats-q">${t('data.stats.t')}</label>
    <input id="stats-q" name="q" type="search" placeholder="${t('data.stats.ph')}" autocomplete="off" data-fill-q>
    <button type="submit" class="c-askbox__btn">${t('data.stats.go')}</button>
  </form>
  <ul class="c-chips c-chips--wrap" aria-label="${t('home.chips.label')}">${[1, 2, 3].map((n) => html`<li><a class="c-chip" href="?q=${encodeURIComponent(t(`data.stats.chip${n}`))}" data-stats-chip>${t(`data.stats.chip${n}`)}</a></li>`)}</ul>
  <div id="stats-result" class="c-stats__result" aria-live="polite"></div>
  <noscript><p class="c-alert c-alert--overdue">${t('ask.noscript')}</p></noscript>
</section>

<section aria-labelledby="cat-h">
  ${sectionHead(ctx, { id: 'cat-h', title: t('data.catalog.t'), note: t('data.catalog.sub', { n: ds.length }) })}
  <div class="c-filterbar" role="group" aria-label="${t('data.catalog.cats')}" data-filterbar="catalog-table" data-key="cat">
    <button type="button" data-v="" aria-pressed="true">${t('all')} (${ds.length})</button>
    ${cats.map((c) => html`<button type="button" data-v="${c}" aria-pressed="false">${t(`data.cat.${c}`)} (${ds.filter((d) => d.category === c).length})</button>`)}
  </div>
  <div class="c-tablewrap"><table class="c-table c-table--catalog" id="catalog-table">
    <caption class="sr-only">${t('data.catalog.t')}</caption>
    <thead><tr><th scope="col">${t('data.col.name')}</th><th scope="col">${t('data.col.owner')}</th><th scope="col">${t('data.col.freq')}</th><th scope="col">${t('data.col.updated')}</th><th scope="col">${t('data.col.license')}</th><th scope="col">${t('data.col.wl')}</th><th scope="col">${t('data.col.canon')}</th></tr></thead>
    <tbody>${ds.map((d) => html`<tr id="${d.id}" data-cat="${d.category}">
      <th scope="row"><span class="c-catalog__name">${L(ctx, d, 'title')}</span><br><span class="muted">${t(`data.cat.${d.category}`)}${d.formats?.length ? ` · ${d.formats.join('/')}` : ''}</span>
        ${d.resources?.length ? html`<details class="c-catalog__res" data-group="catalog"><summary>${t('data.resources', { n: d.resources.length })}</summary><ul>${d.resources.map((r) => html`<li><a href="${r.url}" rel="noopener">${r.name ?? r.url}</a> ${r.format ? html`<code>${r.format}</code>` : ''}</li>`)}</ul></details>` : ''}
        ${L(ctx, d, 'summary') ? html`<details class="c-catalog__res" data-group="catalog"><summary>${t('data.summary')}</summary><p>${L(ctx, d, 'summary')}</p>${d.series?.note ? html`<p class="muted">${d.series.note}</p>` : ''}</details>` : ''}
      </th>
      <td>${unitName(ctx, d.owner)}</td>
      <td>${t(`freq.${d.updateFrequency}`)}${d.gov?.datasetOverdue ? html` ${pill(t('data.overdue'), 'warn')}` : ''}</td>
      <td>${d.lastUpdated ? fmtDate(d.lastUpdated) : '—'}</td>
      <td><span title="${licenseLabel(ctx, d.license)}">${d.license}</span></td>
      <td>${d.gov?.whitelist?.effective ? pill(t('data.wl.yes'), 'ok') : pill(t('data.wl.no'), 'neutral')}</td>
      <td><a href="${d.canonicalUrl}" rel="noopener">${t('data.open')} ↗</a>${d.provenance?.mode ? html`<br><span class="muted">${d.provenance.mode}${d.provenance.fetchedAt ? ` · ${String(d.provenance.fetchedAt).slice(0, 10)}` : ''}</span>` : ''}</td>
    </tr>`)}</tbody>
  </table></div>
  ${ds.length ? '' : html`<p class="c-empty">${t('none')}</p>`}
</section>

<section class="c-apicard" aria-labelledby="api-h">
  ${sectionHead(ctx, { id: 'api-h', title: t('data.api.t') })}
  <p>${t('data.api.d')}</p>
  <ul class="c-linklist c-linklist--inline">
    <li><a href="${url('/openapi.json', { noLang: true })}"><code>openapi.json</code></a></li>
    <li><a href="${url('/llms.txt', { noLang: true })}"><code>llms.txt</code></a></li>
    <li><a href="${url('/developers/')}">${t('footer.api')}</a></li>
    <li><a href="${config.openDataOrigin}" rel="noopener">data.cdc.gov.tw ↗</a></li>
  </ul>
  <details class="c-source-card" data-group="ondemand"><summary>${t('data.api.list')}</summary>
    <ul class="c-v1list">${V1.map((n) => html`<li><a href="${url(`/v1/${n}.json`, { noLang: true })}"><code>/v1/${n}.json</code></a></li>`)}</ul>
    <p class="muted">${t('data.api.base')}：<code>${origin}/v1/</code> · ${t('prov.license')}：OGDL-1.0</p>
  </details>
</section>
${feedback(ctx, { page: ctx.path })}`;
}

export function pages() { return [{ path: '/data/', lang: '*', props: {} }]; }
void raw;
