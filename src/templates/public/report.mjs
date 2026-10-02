// /report/：通報專區。法定傳染病通報時限表由主檔 master/diseases.json 自動推導（主檔改了表就改）；NIDRS 外部連結、流程、法規、表單。
import { html, raw } from '../../../scripts/lib/render.mjs';
import { ldFor, pageHead, hrefFor, L, publishedOf, diseaseName, diseasePage, extLink, proScope, askBox } from './_partials.mjs';
import { resolveDoc } from './lab.mjs';

export const NIDRS_URL = 'https://nidrs.cdc.gov.tw/';
export function meta(ctx) { return { title: ctx.t('report.title'), description: ctx.t('report.lead'), jsonLd: ldFor(ctx, null, [{ label: ctx.t('report.title') }]) }; }

/** 通報時限表：優先沿用治理引擎的 site.gov.notifyTable（由主檔算出，每列有 notifyLabel、path、labtestPath、caseDefinitionPath）；沒有時直接由主檔推導。 */
export function notifyTable(site) {
  const nt = site.gov?.notifyTable;
  const master = new Map(site.master.diseases.map((d) => [d.id, d]));
  if (Array.isArray(nt) && nt.length && nt[0]?.diseases) {
    return nt.map((g) => {
      const diseases = g.diseases.map((d) => ({ ...(master.get(d.id) ?? {}), ...d }));
      return { category: g.legalCategory ?? g.category, diseases, hours: [...new Set(diseases.map((d) => d.notifyWithinHours).filter((h) => h != null))].sort((a, b) => a - b) };
    });
  }
  const cats = new Map();
  for (const d of site.master.diseases) { if (!cats.has(d.legalCategory)) cats.set(d.legalCategory, []); cats.get(d.legalCategory).push(d); }
  return [...cats.entries()].sort((a, b) => a[0] - b[0]).map(([category, list]) => ({
    category,
    diseases: list.sort((a, b) => (a.zhuyin ?? a.name).localeCompare(b.zhuyin ?? b.name, 'zh-TW') || a.name.localeCompare(b.name, 'zh-TW')),
    hours: [...new Set(list.map((d) => d.notifyWithinHours).filter((h) => h != null))].sort((a, b) => a - b),
  }));
}

export function hoursText(ctx, h) {
  const { t } = ctx;
  if (h == null) return t('report.within.rule');
  if (h === 0) return t('report.within.imm');
  if (h % 168 === 0) return t('report.within.w', { n: h / 168 });
  return t('report.within.h', { n: h });
}

function steps(ctx) {
  const { t } = ctx;
  return html`<ol class="c-steps c-steps--compact">${[1, 2, 3, 4].map((n) => html`<li class="c-steps__item"><span class="c-steps__n" aria-hidden="true">${n}</span><div class="c-steps__body"><h3 class="c-steps__t"><span class="sr-only">${t('apply.step', { n })}：</span>${t(`report.flow.${n}.t`)}</h3><p>${t(`report.flow.${n}.d`)}</p></div></li>`)}</ol>`;
}

export function render(ctx) {
  const { site, t, url, lang } = ctx;
  const table = notifyTable(site);
  const labByDisease = new Map();
  for (const lt of publishedOf(site, 'labtests')) { if (!labByDisease.has(lt.disease)) labByDisease.set(lt.disease, []); labByDisease.get(lt.disease).push(lt); }
  const notifServices = publishedOf(site, 'services').filter((s) => s.serviceType === 'notification');
  const total = table.reduce((n, g) => n + g.diseases.length, 0);
  return html`${pageHead(ctx, { trail: [{ label: t('report.title') }], h1: t('report.title'), lead: t('report.lead'), tags: proScope(ctx) })}
<section class="c-callout c-callout--hotline" aria-labelledby="rp-pub"><h2 id="rp-pub">${t('report.public.t')}</h2>
  <p>${t('report.public')} <a class="c-btn c-btn--sm c-callout__btn" href="tel:1922">1922</a></p></section>

<div class="c-grid2">
  <section class="c-aside-card c-nidrs" aria-labelledby="rp-nidrs"><h2 id="rp-nidrs">${t('report.nidrs.t')}</h2>
    <p>${t('report.nidrs')}</p>
    <p><a class="c-btn" href="${NIDRS_URL}" rel="noopener" target="_blank">${t('report.nidrs.go')} ↗</a></p>
    <p class="muted">${t('report.nidrs.note')}</p></section>
  <section class="c-aside-card" aria-labelledby="rp-ask"><h2 id="rp-ask">${t('report.ask.t')}</h2>
    <form class="c-askbox c-askbox--md" action="${url('/ask/')}" method="get" role="search"><input type="hidden" name="view" value="pro">
      <label class="sr-only" for="rp-q">${t('report.ask.t')}</label>
      <input id="rp-q" name="q" type="search" placeholder="${t('report.ask.ph')}" autocomplete="off"><button type="submit" class="c-askbox__btn">${t('home.ask')}</button></form>
    <p class="muted">${t('report.ask.note')}</p></section>
</div>

<section class="c-block" aria-labelledby="rp-flow"><h2 id="rp-flow">${t('report.flow.t')}</h2>${steps(ctx)}</section>

<section class="c-block" aria-labelledby="rp-table"><h2 id="rp-table">${t('report.table.t')}</h2>
  <p class="muted">${t('report.table.note', { n: total, date: site.today })}</p>
  <nav class="c-chips-wrap" aria-label="${t('report.table.t')}"><ul class="c-chips c-chips--wrap">${table.map((g) => html`<li><a class="c-chip" href="#category-${g.category}">${t('disease.cat', { n: g.category })} (${g.diseases.length})</a></li>`)}</ul></nav>
  ${table.map((g) => html`<section class="c-notifycat" id="category-${g.category}" aria-labelledby="h-category-${g.category}">
    <h3 id="h-category-${g.category}">${t('disease.cat', { n: g.category })} <span class="c-pill c-pill--info">${g.hours.length ? g.hours.map((h) => hoursText(ctx, h)).join(' / ') : t('report.within.rule')}</span></h3>
    <div class="c-tablewrap"><table class="c-table c-notifytable"><caption class="sr-only">${t('disease.cat', { n: g.category })}</caption>
      <thead><tr><th scope="col">${t('report.col.name')}</th><th scope="col">${t('report.col.en')}</th><th scope="col">${t('report.col.within')}</th><th scope="col">${t('report.col.page')}</th><th scope="col">${t('report.col.casedef')}</th><th scope="col">${t('report.col.lab')}</th></tr></thead>
      <tbody>${g.diseases.map((d) => {
    const page = diseasePage(ctx, d.id);
    const cd = page?.professional?.caseDefinitionDoc ? resolveDoc(site, page.professional.caseDefinitionDoc) : null;
    const labs = labByDisease.get(d.id) ?? [];
    return html`<tr id="n-${d.slug}"><th scope="row">${diseaseName(ctx, d)}</th><td lang="en">${d.nameEn}</td><td>${hoursText(ctx, d.notifyWithinHours)}</td>
      <td>${page ? html`<a href="${hrefFor(ctx, page)}">${t('report.col.page')} →</a>` : html`<span class="muted">—</span>`}</td>
      <td>${cd?.doc ? html`<a href="${hrefFor(ctx, cd.doc)}">${cd.doc.version ?? cd.doc.title}</a>` : html`<span class="muted">—</span>`}</td>
      <td>${labs.length ? labs.map((lt) => html`<a href="${hrefFor(ctx, lt)}">${t('report.col.lab')} →</a> `) : html`<span class="muted">—</span>`}</td></tr>`;
  })}</tbody></table></div></section>`)}
  <p class="muted">${t('report.table.src')}</p>
</section>

<div class="c-grid2">
  <section class="c-block" aria-labelledby="rp-law"><h2 id="rp-law">${t('report.law.t')}</h2>
    <ul class="c-linklist"><li>${t('report.law.1')}</li><li>${t('report.law.2')}</li><li>${extLink(ctx, 'https://law.moj.gov.tw/', t('report.law.db'))}</li></ul></section>
  <section class="c-block" aria-labelledby="rp-forms"><h2 id="rp-forms">${t('report.forms.t')}</h2>
    <ul class="c-linklist">${notifServices.map((s) => html`<li><a href="${hrefFor(ctx, s)}">${L(ctx, s, 'title')}</a></li>`)}<li><a href="${url('/documents/')}">${t('report.forms.docs')}</a></li><li><a href="${url('/lab/')}">${t('lab.title')}</a></li></ul></section>
</div>
`;
}

export function pages() { return ['zh-TW', 'en'].map((lang) => ({ path: '/report/', lang, props: {} })); }
void askBox;
