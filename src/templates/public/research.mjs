// /research/、/research/{id}/：研究計畫（專業內容）。年度、狀態篩選；詳頁含摘要、目標、執行單位、成果報告、資料集、IRB、相關出版品，研究資料申請連 /apply/。
import { html, raw } from '../../../scripts/lib/render.mjs';
import { md } from '../../../scripts/lib/markdown.mjs';
import { langAvailable } from '../../../scripts/lib/pages.mjs';
import {
  ldFor, breadcrumb, pageHead, provenance, alerts, pageData, scopeTags, feedback, translationBadge, hrefFor, isFallbackLink, L, unitName, unitLink, publishedOf, slugOf,
  itemPath, extLink, mdHeader, proScope, pill, diseaseName, diseaseHref,
} from './_partials.mjs';
import { resolveDoc } from './lab.mjs';

const STATUSES = ['planned', 'ongoing', 'completed', 'published'];
const trailOf = (ctx, r) => [{ label: ctx.t('research.title'), href: '/research/' }, { label: L(ctx, r, 'title') }];
const stKind = { planned: 'neutral', ongoing: 'info', completed: 'ok', published: 'ok' };

export function meta(ctx, props = {}) {
  if (props.item) { const r = props.item; return { title: L(ctx, r, 'title'), description: L(ctx, r, 'summary'), item: r, jsonLd: ldFor(ctx, r, trailOf(ctx, r)) }; }
  return { title: ctx.t('research.title'), description: ctx.t('research.lead'), jsonLd: ldFor(ctx, null, [{ label: ctx.t('research.title') }]) };
}

function listPage(ctx) {
  const { site, t } = ctx;
  const items = publishedOf(site, 'research').sort((a, b) => b.year - a.year || String(a.projectNo).localeCompare(String(b.projectNo)));
  const years = [...new Set(items.map((r) => String(r.year)))];
  const sts = STATUSES.filter((s) => items.some((r) => r.projectStatus === s));
  const bar = (key, label, opts) => html`<div class="c-filterbar" role="group" aria-label="${label}" data-filterbar="research-table" data-key="${key}"><span class="c-filterbar__label">${label}</span><button type="button" data-v="" aria-pressed="true">${t('all')}</button>${opts.map(([v, x]) => html`<button type="button" data-v="${v}" aria-pressed="false">${x}</button>`)}</div>`;
  return html`${pageHead(ctx, { trail: [{ label: t('research.title') }], h1: t('research.title'), lead: t('research.lead'), tags: proScope(ctx), actions: html`<a class="c-btn c-btn--ghost c-btn--sm" href="${ctx.url('/apply/')}">${t('research.request')}</a>` })}
${items.length ? html`<div class="c-filterbars">${bar('year', t('research.col.year'), years.map((y) => [y, y]))}${bar('status', t('research.col.status'), sts.map((s) => [s, t(`research.status.${s}`)]))}</div>
<div class="c-tablewrap" role="region" tabindex="0" aria-label="${t('a11y.scrollTable')}"><table class="c-table c-table--research" id="research-table"><thead><tr><th scope="col">${t('research.col.year')}</th><th scope="col">${t('research.col.title')}</th><th scope="col">${t('research.col.pi')}</th><th scope="col">${t('research.col.status')}</th><th scope="col">${t('research.col.output')}</th></tr></thead>
<tbody>${items.map((r) => html`<tr data-year="${r.year}" data-status="${r.projectStatus}"><td>${r.year}</td><th scope="row"><a href="${hrefFor(ctx, r)}"${isFallbackLink(ctx, r) ? raw(' lang="zh-TW"') : ''}>${L(ctx, r, 'title')}</a>${r.projectNo ? html`<br><span class="muted">${r.projectNo}</span>` : ''}</th><td>${r.piUnit ?? '—'}</td><td>${pill(t(`research.status.${r.projectStatus}`), stKind[r.projectStatus])}</td><td>${[r.reportDoc ? t('research.out.report') : '', r.datasets?.length ? t('research.out.data') : '', r.publications?.length ? t('research.out.pub') : ''].filter(Boolean).join('、') || '—'}</td></tr>`)}</tbody></table></div>` : html`<p class="c-empty">${t('none')}</p>`}
<p class="muted">${t('research.note')}</p>`;
}

function detail(ctx, r) {
  const { site, t, lang, url } = ctx;
  const report = resolveDoc(site, r.reportDoc);
  const dsets = (r.datasets ?? []).map((id) => site.byId.get(id)).filter(Boolean);
  const pubs = (r.publications ?? []).map((id) => site.byId.get(id)).filter(Boolean);
  const req = (site.collections.services ?? []).find((s) => s.status === 'published' && s.serviceType === 'data-request');
  const langStatus = r.languages?.[lang]?.status;
  const abs = L(ctx, r, 'abstractMarkdown') ?? r.abstractMarkdown;
  return html`${breadcrumb(ctx, trailOf(ctx, r))}
<article class="c-article c-research">
  <header class="c-pagehead"><div class="c-pagehead__main">
    <p class="c-article__meta">${proScope(ctx)} ${pill(t(`research.status.${r.projectStatus}`), stKind[r.projectStatus])} <span>${r.year}</span>${r.projectNo ? html` · <span>${r.projectNo}</span>` : ''}</p>
    <h1>${L(ctx, r, 'title')}</h1>
    <p class="lead">${L(ctx, r, 'summary')}</p>
    ${scopeTags(ctx, r, { region: false })}
    ${langStatus && lang !== 'zh-TW' ? html`<p>${translationBadge(ctx, langStatus === 'reviewed' ? 'reviewed' : 'machine')}</p>` : ''}
    ${alerts(ctx, r)}${provenance(ctx, r)}
  </div></header>
  <div class="c-cols c-cols--2">
    <div class="c-cols__main">
      ${abs ? html`<section class="c-block" aria-labelledby="ab-h"><h2 id="ab-h">${t('publications.abstract')}</h2><div class="c-prose">${raw(md(abs))}</div></section>` : ''}
      ${r.objectives?.length ? html`<section class="c-block" aria-labelledby="ob-h"><h2 id="ob-h">${t('research.objectives')}</h2><ol>${r.objectives.map((o) => html`<li>${o}</li>`)}</ol></section>` : ''}
      <section class="c-block" aria-labelledby="out-h"><h2 id="out-h">${t('research.outputs')}</h2>
        <dl class="c-deflist">
          <div><dt>${t('research.out.report')}</dt><dd>${report?.doc ? html`<a href="${hrefFor(ctx, report.doc)}">${report.doc.title}</a> <span class="muted">${report.doc.version ?? ''}</span>` : report?.url ? extLink(ctx, report.url, t('research.out.report')) : html`<span class="muted">${t('research.out.none')}</span>`}</dd></div>
          <div><dt>${t('research.out.data')}</dt><dd>${dsets.length ? dsets.map((d) => html`<a href="${url('/data/')}#${d.id}">${L(ctx, d, 'title')}</a> `) : html`<span class="muted">${t('research.out.none')}</span>`}</dd></div>
          <div><dt>${t('research.out.pub')}</dt><dd>${pubs.length ? html`<ul class="c-linklist">${pubs.map((p) => html`<li><a href="${hrefFor(ctx, p)}">${L(ctx, p, 'title')}</a></li>`)}</ul>` : html`<span class="muted">${t('research.out.none')}</span>`}</dd></div>
        </dl></section>
      ${feedback(ctx, { page: ctx.path })}
    </div>
    <aside class="c-cols__side">
      <section class="c-aside-card"><h2>${t('research.facts')}</h2><dl class="c-deflist c-deflist--sm">
        <div><dt>${t('research.col.pi')}</dt><dd>${r.piUnit ?? '—'}</dd></div>
        <div><dt>${t('prov.owner')}</dt><dd>${unitLink(ctx, r.owner)}</dd></div>
        ${r.fundingType ? html`<div><dt>${t('research.funding')}</dt><dd>${t(`research.funding.${r.fundingType}`)}</dd></div>` : ''}
        ${r.budgetNtd ? html`<div><dt>${t('notice.budget')}</dt><dd>NT$ ${Number(r.budgetNtd).toLocaleString('en-US')}</dd></div>` : ''}
        <div><dt>IRB</dt><dd>${r.irb?.required ? html`${t('research.irb.yes')}${r.irb.approvalNo ? html`<br>${r.irb.approvalNo}` : ''}${r.irb.committee ? html`<br><span class="muted">${r.irb.committee}</span>` : ''}` : t('research.irb.no')}</dd></div>
        ${r.diseases?.length ? html`<div><dt>${t('news.related')}</dt><dd>${r.diseases.map((d) => { const h = diseaseHref(ctx, d); const nm = diseaseName(ctx, site.diseaseMasterById.get(d)) || d; return h ? html`<a href="${h}">${nm}</a> ` : html`${nm} `; })}</dd></div>` : ''}
      </dl></section>
      <section class="c-aside-card"><h2>${t('research.request')}</h2><p class="muted">${t('research.request.note')}</p><a class="c-btn c-btn--sm" href="${req ? hrefFor(ctx, req) : url('/apply/')}">${t('research.request')} →</a></section>
      ${pageData(ctx, r, { schema: 'ResearchProject', api: '/v1/research.json', mdPath: `${itemPath(r).replace(/\/$/, '')}.md` })}
    </aside>
  </div>
</article>`;
}

export function render(ctx, props = {}) { return props.item ? detail(ctx, props.item) : listPage(ctx); }

export function markdown(ctx, { item: r }) {
  const lines = [`# ${L(ctx, r, 'title')}`, '', ...mdHeader(ctx, r, `年度：${r.year} · 狀態：${r.projectStatus}${r.projectNo ? ` · 計畫編號：${r.projectNo}` : ''}`), '', L(ctx, r, 'summary') ?? ''];
  if (r.piUnit) lines.push('', `執行單位：${r.piUnit}`);
  if (r.abstractMarkdown) lines.push('', '## 摘要', '', L(ctx, r, 'abstractMarkdown') ?? r.abstractMarkdown);
  if (r.objectives?.length) lines.push('', '## 研究目標', '', ...r.objectives.map((o, i) => `${i + 1}. ${o}`));
  if (r.irb?.required) lines.push('', `IRB：${r.irb.approvalNo ?? ''} ${r.irb.committee ?? ''}`.trim());
  return lines.join('\n') + '\n';
}

export function pages(site) {
  const out = [];
  for (const code of ['zh-TW', 'en']) out.push({ path: '/research/', lang: code, props: {} });
  for (const L_ of site.config.langs) for (const r of site.collections.research ?? []) if (r.status === 'published' && langAvailable(site, r, L_.code)) out.push({ path: `/research/${slugOf(r)}/`, lang: L_.code, props: { item: r }, md: true });
  return out;
}
void unitName;
