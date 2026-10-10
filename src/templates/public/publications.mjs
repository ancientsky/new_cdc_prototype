// /publications/、/publications/{id}/：出版品。依系列分組（疫情報導依卷期表格）；詳頁有完整書目、篇目列表、PDF 與引用格式。
import { html, raw } from '../../../scripts/lib/render.mjs';
import { md } from '../../../scripts/lib/markdown.mjs';
import { langAvailable } from '../../../scripts/lib/pages.mjs';
import { config } from '../../../site.config.mjs';
import {
  ldFor, breadcrumb, pageHead, provenance, alerts, pageData, scopeTags, feedback, translationBadge, hrefFor, isFallbackLink, L, unitName, publishedOf, slugOf,
  itemPath, extLink, imgSrc, diseaseHref, diseaseName, mdHeader, proScope, pill,
} from './_partials.mjs';

const trailOf = (ctx, p) => [{ label: ctx.t('publications.title'), href: '/publications/' }, { label: L(ctx, p, 'title') }];
const volIssue = (p) => [p.volume != null ? `${p.volume}` : '', p.issue != null ? `(${p.issue})` : ''].join('');

export function meta(ctx, props = {}) {
  if (props.item) { const p = props.item; return { title: L(ctx, p, 'title'), description: L(ctx, p, 'summary'), item: p, jsonLd: ldFor(ctx, p, trailOf(ctx, p)) }; }
  return { title: ctx.t('publications.title'), description: ctx.t('publications.lead'), jsonLd: ldFor(ctx, null, [{ label: ctx.t('publications.title') }]) };
}

function citation(ctx, p) {
  const owner = unitName(ctx, p.owner);
  const year = (p.publishedAt ?? '').slice(0, 4);
  const vi = volIssue(p);
  const ids = [p.isbn ? `ISBN ${p.isbn}` : '', p.issn ? `ISSN ${p.issn}` : '', p.gpn ? `GPN ${p.gpn}` : ''].filter(Boolean).join('；');
  return `${(p.authors?.length ? p.authors.join('、') : owner)}（${year}）。${L(ctx, p, 'title')}${p.series && p.series !== L(ctx, p, 'title') ? `。${p.series}` : ''}${vi ? `，${vi}` : ''}${p.pages ? `，${p.pages} 頁` : ''}。${owner}。${ids ? `${ids}。` : ''}${ctx.url(itemPath(p), { absolute: true, noLang: true })}`;
}

function listPage(ctx) {
  const { site, t, fmtDate } = ctx;
  const items = publishedOf(site, 'publications');
  const bySeries = new Map();
  for (const p of items) { const k = p.series ?? '—'; if (!bySeries.has(k)) bySeries.set(k, []); bySeries.get(k).push(p); }
  const seriesList = [...bySeries.entries()].sort((a, b) => (b[1][0].pubType === 'bulletin') - (a[1][0].pubType === 'bulletin') || a[0].localeCompare(b[0], 'zh-TW'));
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const section = ([series, list], idx) => {
    const isBulletin = list.every((p) => p.pubType === 'bulletin' && (p.volume != null || p.issue != null));
    const id = `series-${idx}`;
    if (isBulletin) {
      const vols = new Map();
      for (const p of list) { const v = p.volume ?? '—'; if (!vols.has(v)) vols.set(v, []); vols.get(v).push(p); }
      const sorted = [...vols.entries()].sort((a, b) => num(b[0]) - num(a[0]));
      return html`<section class="c-block" id="${id}" aria-labelledby="h-${id}"><h2 id="h-${id}">${series} <span class="c-pill c-pill--neutral">${list.length}</span></h2>
        ${sorted.map(([v, ps]) => html`<h3 class="c-pubvol">${t('publications.volume', { n: v })}</h3>
        <div class="c-tablewrap" role="region" tabindex="0" aria-label="${t('a11y.scrollTable')}"><table class="c-table c-table--pub"><caption class="sr-only">${series} ${t('publications.volume', { n: v })}</caption><thead><tr><th scope="col">${t('publications.issue')}</th><th scope="col">${t('publications.date')}</th><th scope="col">${t('publications.articles')}</th><th scope="col">${t('publications.pdf')}</th></tr></thead>
        <tbody>${ps.sort((a, b) => num(b.issue) - num(a.issue)).map((p) => html`<tr><th scope="row"><a href="${hrefFor(ctx, p)}"${isFallbackLink(ctx, p) ? raw(' lang="zh-TW"') : ''}>${volIssue(p)}</a></th><td>${fmtDate(p.publishedAt)}</td><td>${p.articles?.length ?? '—'}</td><td>${p.pdfUrl ? extLink(ctx, /^https?:/.test(p.pdfUrl) ? p.pdfUrl : ctx.url(p.pdfUrl), 'PDF') : '—'}</td></tr>`)}</tbody></table></div>`)}
      </section>`;
    }
    return html`<section class="c-block" id="${id}" aria-labelledby="h-${id}"><h2 id="h-${id}">${series} <span class="c-pill c-pill--neutral">${list.length}</span></h2>
      <ul class="c-publist">${list.sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt))).map((p) => html`<li class="c-pub">
        <span class="c-pub__cover">${p.cover && imgSrc(ctx, p.cover) ? html`<img src="${imgSrc(ctx, p.cover)}" alt="" width="72" height="96" loading="lazy">` : raw('<svg viewBox="0 0 72 96" aria-hidden="true" focusable="false"><rect width="72" height="96" rx="4" fill="#e5efe9"/><rect x="10" y="14" width="40" height="6" fill="#1b5e3f"/><rect x="10" y="28" width="52" height="4" fill="#9cc7ae"/><rect x="10" y="38" width="46" height="4" fill="#9cc7ae"/></svg>')}</span>
        <span class="c-pub__body"><a class="c-pub__t" href="${hrefFor(ctx, p)}"${isFallbackLink(ctx, p) ? raw(' lang="zh-TW"') : ''}>${L(ctx, p, 'title')}</a>
        <span class="c-pub__m muted">${t(`publications.type.${p.pubType}`)} · ${fmtDate(p.publishedAt)}${p.edition ? ` · ${p.edition}` : ''}${p.gpn ? ` · GPN ${p.gpn}` : ''}</span></span></li>`)}</ul></section>`;
  };
  return html`${pageHead(ctx, { trail: [{ label: t('publications.title') }], h1: t('publications.title'), lead: t('publications.lead'), actions: html`<a class="c-btn c-btn--ghost c-btn--sm" href="${ctx.url('/feeds/publications.xml', { noLang: true })}">RSS</a>` })}
${seriesList.length > 1 ? html`<nav class="c-chips-wrap" aria-label="${t('publications.series')}"><ul class="c-chips c-chips--wrap">${seriesList.map(([s, l], i) => html`<li><a class="c-chip" href="#series-${i}">${s} (${l.length})</a></li>`)}</ul></nav>` : ''}
${seriesList.map(section)}
${items.length ? '' : html`<p class="c-empty">${t('none')}</p>`}`;
}

function detail(ctx, p) {
  const { site, t, lang, fmtDate } = ctx;
  const langStatus = p.languages?.[lang]?.status;
  const cite = citation(ctx, p);
  const rows = [
    [t('publications.series'), p.series], ['ISBN', p.isbn], ['ISSN', p.issn], ['GPN', p.gpn],
    [t('publications.edition'), p.edition], [t('publications.volume.k'), volIssue(p) || null], [t('publications.pages'), p.pages ? t('publications.pages.n', { n: p.pages }) : null],
    [t('publications.owner'), unitName(ctx, p.owner)], [t('publications.date'), fmtDate(p.publishedAt)], [t('publications.price'), p.price],
    [t('publications.authors'), p.authors?.length ? p.authors.join('、') : null],
  ].filter(([, v]) => v);
  const abs = L(ctx, p, 'abstractMarkdown') ?? p.abstractMarkdown;
  return html`${breadcrumb(ctx, trailOf(ctx, p))}
<article class="c-article c-publication">
  <header class="c-pagehead"><div class="c-pagehead__main">
    <p class="c-article__meta">${pill(t(`publications.type.${p.pubType}`), 'info')} <span>${p.series}${volIssue(p) ? ` ${volIssue(p)}` : ''}</span></p>
    <h1>${L(ctx, p, 'title')}</h1>
    <p class="lead">${L(ctx, p, 'summary')}</p>
    ${scopeTags(ctx, p, { region: false })}
    ${langStatus && lang !== 'zh-TW' ? html`<p>${translationBadge(ctx, langStatus === 'reviewed' ? 'reviewed' : 'machine')}</p>` : ''}
    ${alerts(ctx, p)}${provenance(ctx, p)}
  </div><div class="c-pagehead__actions">${p.pdfUrl ? html`<a class="c-btn" href="${/^https?:/.test(p.pdfUrl) ? p.pdfUrl : ctx.url(p.pdfUrl)}" rel="noopener">${t('publications.pdf.get')} ↗</a>` : ''}<button type="button" class="c-btn c-btn--ghost" data-copy-text="${cite}" data-done="${t('copied')}">${t('publications.cite')}</button></div></header>
  <div class="c-cols c-cols--2">
    <div class="c-cols__main">
      <section class="c-block" aria-labelledby="bib-h"><h2 id="bib-h">${t('publications.bib')}</h2>
        <div class="c-tablewrap" role="region" tabindex="0" aria-label="${t('a11y.scrollTable')}"><table class="c-table c-table--bib"><tbody>${rows.map(([k, v]) => html`<tr><th scope="row">${k}</th><td>${v}</td></tr>`)}</tbody></table></div>
        <p class="c-cite-text muted"><span class="sr-only">${t('publications.cite')}：</span><code>${cite}</code></p>
      </section>
      ${abs ? html`<section class="c-block" aria-labelledby="abs-h"><h2 id="abs-h">${t('publications.abstract')}</h2><div class="c-prose">${raw(md(abs))}</div></section>` : ''}
      ${p.articles?.length ? html`<section class="c-block" aria-labelledby="art-h"><h2 id="art-h">${t('publications.articles')}</h2>
        <ol class="c-articles">${p.articles.map((a, ai) => html`<li class="c-articles__i" id="art-${ai + 1}"><p class="c-articles__t">${a.title}</p>
          <p class="c-articles__m muted">${a.authors?.length ? `${a.authors.join('、')} · ` : ''}${a.pages ? t('publications.pp', { p: a.pages }) : ''}${a.doi ? html` · DOI <a href="https://doi.org/${a.doi}" rel="noopener">${a.doi}</a>` : ''}</p>
          ${a.abstract ? html`<p class="c-articles__a">${a.abstract}</p>` : ''}
          ${a.diseases?.length ? html`<p class="c-articles__d">${a.diseases.map((d) => { const h = diseaseHref(ctx, d); const nm = diseaseName(ctx, site.diseaseMasterById.get(d)) || d; return h ? html`<a class="c-pill c-pill--ok" href="${h}">${nm}</a> ` : html`<span class="c-pill c-pill--neutral">${nm}</span> `; })}</p>` : ''}</li>`)}</ol></section>` : ''}
      ${feedback(ctx, { page: ctx.path })}
    </div>
    <aside class="c-cols__side">
      ${p.cover && imgSrc(ctx, p.cover) ? html`<div class="c-aside-card"><img class="c-publication__cover" src="${imgSrc(ctx, p.cover)}" alt="" width="240" height="320" loading="lazy"></div>` : ''}
      ${p.pdfUrl ? html`<section class="c-aside-card"><h2>${t('publications.pdf')}</h2><p>${extLink(ctx, /^https?:/.test(p.pdfUrl) ? p.pdfUrl : ctx.url(p.pdfUrl), t('publications.pdf.get'))}</p></section>` : ''}
      ${pageData(ctx, p, { schema: p.pubType === 'bulletin' ? 'PublicationIssue' : 'Book', api: '/v1/publications.json', mdPath: `${itemPath(p).replace(/\/$/, '')}.md` })}
    </aside>
  </div>
</article>`;
}

export function render(ctx, props = {}) { return props.item ? detail(ctx, props.item) : listPage(ctx); }

export function markdown(ctx, { item: p }) {
  const lines = [`# ${L(ctx, p, 'title')}`, '', ...mdHeader(ctx, p, `系列：${p.series}${volIssue(p) ? ` ${volIssue(p)}` : ''}`), '', L(ctx, p, 'summary') ?? ''];
  lines.push('', '## 書目', '');
  for (const [k, v] of [['ISBN', p.isbn], ['ISSN', p.issn], ['GPN', p.gpn], ['版次', p.edition], ['頁數', p.pages], ['作者', p.authors?.join('、')], ['定價', p.price], ['PDF', p.pdfUrl]]) if (v) lines.push(`- ${k}：${v}`);
  lines.push(`- 建議引用：${citation(ctx, p)}`);
  if (p.abstractMarkdown) lines.push('', '## 摘要', '', L(ctx, p, 'abstractMarkdown') ?? p.abstractMarkdown);
  if (p.articles?.length) lines.push('', '## 篇目', '', ...p.articles.map((a, i) => `${i + 1}. ${a.title}${a.authors?.length ? `（${a.authors.join('、')}）` : ''}${a.pages ? ` p.${a.pages}` : ''}`));
  return lines.join('\n') + '\n';
}

export function pages(site) {
  const out = [{ path: '/publications/', lang: '*', props: {} }];
  for (const L_ of site.config.langs) for (const p of site.collections.publications ?? []) if (p.status === 'published' && langAvailable(site, p, L_.code)) out.push({ path: `/publications/${slugOf(p)}/`, lang: L_.code, props: { item: p }, md: true });
  return out;
}
void config; void proScope; void unitName;
