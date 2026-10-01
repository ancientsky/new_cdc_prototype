// 六任務入口頁：依內容 tasks 欄位聚合。
import { html, raw } from '../../../scripts/lib/render.mjs';
import { config } from '../../../site.config.mjs';
import { ldFor, pageHead, sectionHead, askBox, sitCard, hrefFor, isFallbackLink, L, publishedOf, byDateDesc, verdictPill, pill, feedback, dated, unitName } from './_partials.mjs';
import { asRows } from './travel.mjs';

export function meta(ctx, { task }) {
  return { title: ctx.t(`task.${task.key}.label`), description: ctx.t(`task.${task.key}.sub`).replaceAll(' · ', '、'), jsonLd: ldFor(ctx, null, [{ label: ctx.t(`task.${task.key}.label`) }]) };
}

const linkItem = (ctx, it, text) => html`<li><a href="${hrefFor(ctx, it)}"${isFallbackLink(ctx, it) ? raw(' lang="zh-TW"') : ''}>${text ?? L(ctx, it, 'title')}</a>${it.reviewedAt ? html` <span class="muted">${ctx.t('prov.reviewed')} ${ctx.fmtDate(it.reviewedAt)}</span>` : ''}</li>`;

export function render(ctx, { task }) {
  const { site, t, url } = ctx;
  const k = task.key;
  const has = (i) => i.status === 'published' && i.tasks?.includes(k);
  const diseases = site.collections.diseases.filter(has);
  const faqs = site.collections.faq.filter(has);
  const vaccines = site.collections.vaccines.filter(has);
  const news = site.collections.news.filter(has).sort(byDateDesc).slice(0, 6);
  const clars = site.collections.clarifications.filter(has).sort(byDateDesc);
  const datasets = site.collections.datasets.filter(has);
  const docs = site.collections.documents.filter((d) => d.isCurrent && has(d));
  const blocks = [];
  const sec = (id, title, list, render_) => (list.length ? html`<section class="c-taskblock" aria-labelledby="tb-${id}"><h2 id="tb-${id}">${title} <span class="muted">(${list.length})</span></h2><ul class="c-linklist">${list.map(render_)}</ul></section>` : '');
  blocks.push(sec('dis', t('nav.diseases'), diseases, (d) => linkItem(ctx, d)));
  blocks.push(sec('vac', t('nav.vaccines'), vaccines, (d) => linkItem(ctx, d)));
  blocks.push(sec('faq', t('nav.faq'), faqs, (f) => linkItem(ctx, f, L(ctx, f, 'question') ?? f.title)));
  blocks.push(sec('doc', t('nav.documents'), docs, (d) => linkItem(ctx, d)));
  blocks.push(sec('clar', t('nav.factcheck'), clars, (c) => html`<li>${verdictPill(ctx, c.verdict, { outdated: c.gov?.stale?.length > 0 })} <a href="${hrefFor(ctx, c)}">${L(ctx, c, 'title')}</a></li>`));
  blocks.push(sec('data', t('nav.data'), datasets, (d) => html`<li><a href="${url('/data/')}#${d.id}">${L(ctx, d, 'title')}</a> <span class="muted">${t('data.col.updated')} ${d.lastUpdated ? ctx.fmtDate(d.lastUpdated) : '—'}</span></li>`));
  blocks.push(news.length ? html`<section class="c-taskblock" aria-labelledby="tb-news"><h2 id="tb-news">${t('nav.news')}</h2><ul class="c-newslist">${news.map((n) => dated(ctx, n))}</ul></section>` : '');

  let hero = '';
  if (k === 'situation') {
    hero = html`<section aria-labelledby="ts-h">${sectionHead(ctx, { id: 'ts-h', title: t('home.situation'), more: `${t('home.situation.more')} →`, moreHref: url('/situation/'), note: t('home.situation.note', { date: ctx.fmtDate(site.situation.dataDate), source: site.situation.source }) })}<div class="c-sit-scroll"><div class="c-sit-grid">${site.situation.items.map((it) => sitCard(ctx, it))}</div></div></section>`;
  } else if (k === 'travel') {
    const rows = asRows(site.snapshots?.countryLevels).slice(0, 12);
    hero = html`<section aria-labelledby="tt-h">${sectionHead(ctx, { id: 'tt-h', title: t('travel.levels.t'), more: `${t('nav.travel')} →`, moreHref: url('/travel/') })}
      ${rows.length ? html`<div class="c-tablewrap"><table class="c-table"><thead><tr><th scope="col">${t('travel.col.country')}</th><th scope="col">${t('travel.col.disease')}</th><th scope="col">${t('travel.col.level')}</th></tr></thead><tbody>${rows.map((r) => html`<tr><th scope="row">${r.country ?? r.iso2}</th><td>${r.disease ?? '—'}</td><td>${r.code ? html`<span class="c-level c-level--${r.code}">${t(`travel.level.${r.code}`)}</span>` : (r.level ?? '—')}</td></tr>`)}</tbody></table></div>` : html`<p class="c-empty">${t('travel.empty')}</p>`}
      <p class="c-linkrow"><a class="c-btn" href="${url('/travel/')}">${t('travel.pick')} →</a></p></section>`;
  } else if (k === 'rumor') {
    hero = html`<section><a class="c-btn" href="${url('/factcheck/')}">${t('factcheck.submit')} →</a></section>`;
  } else if (k === 'data') {
    hero = html`<section><a class="c-btn" href="${url('/data/')}">${t('nav.data')} →</a></section>`;
  }
  return html`${pageHead(ctx, { trail: [{ label: t(`task.${k}.label`) }], h1: t(`task.${k}.label`), lead: t(`task.${k}.sub`).replaceAll(' · ', ' · ') })}
<section class="c-ask-inline" aria-label="${t('home.h1')}">${askBox(ctx, { id: 'tk', size: 'md', task: k, placeholder: t(`task.${k}.ph`) })}</section>
${hero}
<div class="c-taskgrid">${blocks}</div>
${feedback(ctx, { page: ctx.path })}`;
}

export function pages(site) {
  return (site.config.tasks ?? config.tasks).map((task) => ({ path: `/tasks/${task.key}/`, lang: '*', props: { task } }));
}
void unitName; void pill;
