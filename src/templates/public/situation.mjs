// 完整態勢層：各疾病大卡 + 近週圖、狀態定義表、嵌入／API、歷次發布。
import { html, raw } from '../../../scripts/lib/render.mjs';
import { config } from '../../../site.config.mjs';
import * as JL from '../../../scripts/lib/jsonld.mjs';
import { barChartSvg, sparklineSvg } from '../../client/charts.js';
import { ldFor, pageHead, statusTag, diseaseHref, diseaseName, sitField, unitName, sourceCard, numberSource, trendArrow, sectionHead, feedback, datasetSourceCard } from './_partials.mjs';

const STATUSES = ['stable', 'rising', 'peak', 'declining'];

export function meta(ctx) {
  const trail = [{ label: ctx.t('nav.situation') }];
  const jl = ldFor(ctx, null, trail);
  try { if (typeof JL.situationJsonLd === 'function') jl.push(...[].concat(JL.situationJsonLd(ctx))); } catch { /* optional */ }
  return { title: ctx.t('nav.situation'), description: ctx.t('situation.desc'), jsonLd: jl };
}

export function render(ctx) {
  const { site, t, url, fmtDate, lang } = ctx;
  const sit = site.situation;
  const origin = `${config.siteUrl}${config.basePath}`;
  const items = sit.items;
  const history = [...(sit.history ?? [])].sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)));
  const apiUrl = `${origin}/v1/situation.json`;
  return html`${pageHead(ctx, {
    trail: [{ label: t('nav.situation') }],
    h1: t('nav.situation'),
    lead: t('situation.lead'),
  })}
<div class="c-statusmeta">
  <span><b>${t('dataDate')}</b> ${fmtDate(sit.dataDate)}</span>
  <span><b>${t('status.pop.publisher')}</b> ${unitName(ctx, sit.publisher)}</span>
  <span><b>${t('status.pop.effective')}</b> ${fmtDate(sit.publishedAt)}</span>
  <span><b>${t('prov.next')}</b> ${fmtDate(sit.nextReviewAt)}</span>
  <span>${numberSource(ctx, { source: sit.source })}</span>
</div>
${sit.note ? html`<p class="c-alert c-alert--overdue" role="note">${sit.note}</p>` : ''}

<section aria-labelledby="sit-all">
  ${sectionHead(ctx, { id: 'sit-all', title: t('situation.all') })}
  <div class="c-sitbig">${items.map((it) => {
    const dm = site.diseaseMasterById.get(it.disease);
    const href = diseaseHref(ctx, it.disease);
    const ds = it.dataset ? site.byId.get(it.dataset) : null;
    return html`<article class="c-sitbig__card c-sit-card c-sit-card--${it.status}" id="d-${dm?.slug ?? it.disease}">
      <header class="c-sit-card__head"><h3>${href ? html`<a href="${href}">${diseaseName(ctx, dm)}</a>` : diseaseName(ctx, dm)}</h3>${statusTag(ctx, it)}</header>
      <div class="c-sitbig__body">
        <div class="c-sitbig__facts">
          <p class="c-sit-card__metric"><span class="c-sit-card__arrow c-sit-card__arrow--${it.trend}" aria-hidden="true">${trendArrow(it.trend)}</span><span class="c-sit-card__num">${sitField(ctx, it, 'metricValue')}</span>${it.illustrative ? html`<span class="c-sit-card__demo">${t('illustrative')}</span>` : ''}</p>
          <p class="c-sit-card__desc">${sitField(ctx, it, 'metricLabel')}${sitField(ctx, it, 'deltaText') ? html`<br><span class="c-sit-card__delta">${sitField(ctx, it, 'deltaText')}</span>` : ''}</p>
          <p class="c-sit-card__advice"><b>${t('sit.advice')}</b>${sitField(ctx, it, 'advice')}</p>
          <p class="muted"><b>${t('status.pop.basis')}</b> ${it.basis}</p>
          <p class="c-linkrow">${href ? html`<a href="${href}">${t('situation.page')} →</a>` : ''}${ds ? html` ${href ? '· ' : ''}<a href="${url('/data/')}#${ds.id}">${t('disease.dataset')}</a>` : ''}</p>
        </div>
        <figure class="c-sitbig__chart">${it.weekly?.length ? raw(barChartSvg(it.weekly, { labels: it.weeklyLabels, color: `var(--status-${it.status})`, width: 420, height: 170, title: `${diseaseName(ctx, dm)} · ${sitField(ctx, it, 'metricLabel')}` })) : ''}<figcaption class="muted">${t('situation.weekly', { n: it.weekly?.length ?? 0 })}${it.illustrative ? ` · ${t('illustrative')}` : ''} ${it.weekly?.length > 1 ? raw(sparklineSvg(it.weekly, { color: `var(--status-${it.status})`, width: 80, height: 22, title: '' })) : ''}</figcaption></figure>
      </div>
      ${ds ? datasetSourceCard(ctx, ds) : ''}
    </article>`;
  })}</div>
</section>

<section aria-labelledby="sit-def">
  ${sectionHead(ctx, { id: 'sit-def', title: t('situation.def.t'), note: t('situation.def.sub') })}
  <div class="c-tablewrap" role="region" tabindex="0" aria-label="${t('a11y.scrollTable')}"><table class="c-table">
    <caption class="sr-only">${t('situation.def.t')}</caption>
    <thead><tr><th scope="col">${t('situation.def.level')}</th><th scope="col">${t('situation.def.meaning')}</th><th scope="col">${t('situation.def.basis')}</th></tr></thead>
    <tbody>${STATUSES.map((s) => html`<tr><th scope="row"><span class="c-status-tag c-status-tag--${s}">${t(`status.${s}`)}</span></th><td>${t(`status.def.${s}`)}</td><td>${t(`status.basis.${s}`)}</td></tr>`)}</tbody>
  </table></div>
  <dl class="c-deflist c-deflist--row">
    <div><dt>${t('status.pop.publisher')}</dt><dd>${unitName(ctx, sit.publisher)}${sit.approvedBy ? ` · ${sit.approvedBy}` : ''}</dd></div>
    <div><dt>${t('prov.next')}</dt><dd>${fmtDate(sit.nextReviewAt)}</dd></div>
    <div><dt>${t('situation.rule')}</dt><dd>${t('situation.rule.d')}</dd></div>
  </dl>
</section>

<section aria-labelledby="sit-api">
  ${sectionHead(ctx, { id: 'sit-api', title: t('situation.api.t') })}
  <p>${t('situation.api.d')}</p>
  <pre class="c-code" role="region" tabindex="0" aria-label="${t('a11y.scrollCode')}"><code>curl ${apiUrl}

fetch('${apiUrl}')
  .then(r =&gt; r.json())
  .then(({ meta, data }) =&gt; console.log(data.items.filter(i =&gt; i.pinned)))</code></pre>
  <p class="c-linkrow"><a href="${url('/v1/situation.json', { noLang: true })}"><code>/v1/situation.json</code></a> · <a href="${url('/developers/')}">${t('footer.api')}</a></p>
  ${sourceCard(ctx, { title: t('source.card'), canonicalUrl: apiUrl, dataDate: sit.dataDate, owner: unitName(ctx, sit.publisher), license: 'OGDL-1.0', links: [{ label: 'JSON', href: url('/v1/situation.json', { noLang: true }) }, { label: 'API', href: url('/openapi.json', { noLang: true }) }] })}
</section>

<section aria-labelledby="sit-hist">
  ${sectionHead(ctx, { id: 'sit-hist', title: t('situation.history') })}
  <ul class="c-timeline">
    <li><time datetime="${sit.publishedAt}">${fmtDate(sit.publishedAt)}</time> <span class="c-pill c-pill--ok">${t('prov.current')}</span> ${items.map((i) => html`<span class="c-status-tag c-status-tag--${i.status}">${diseaseName(ctx, site.diseaseMasterById.get(i.disease))} ${t(`status.${i.status}`)}</span> `)}</li>
    ${history.map((h) => html`<li><time datetime="${h.publishedAt}">${fmtDate(h.publishedAt)}</time> ${(h.items ?? []).map((i) => html`<span class="c-status-tag c-status-tag--${i.status}">${diseaseName(ctx, site.diseaseMasterById.get(i.disease))} ${t(`status.${i.status}`)}</span> `)}${h.note ? html`<span class="muted">${h.note}</span>` : ''}</li>`)}
  </ul>
  ${history.length ? '' : html`<p class="muted">${t('situation.history.none')}</p>`}
</section>
${feedback(ctx, { page: ctx.path })}`;
}

export function pages() { return [{ path: '/situation/', lang: '*', props: {} }]; }

