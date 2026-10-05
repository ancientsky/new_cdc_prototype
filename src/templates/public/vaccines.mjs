// 疫苗：索引（公費對象速查）與每種疫苗詳頁（公費對象表、時程、注意事項、接種地點）。
import { html, raw } from '../../../scripts/lib/render.mjs';
import { md } from '../../../scripts/lib/markdown.mjs';
import { langAvailable } from '../../../scripts/lib/pages.mjs';
import { ldFor, pageHead, breadcrumb, provenance, alerts, pageData, scopeTags, feedback, askBox, sectionHead, hrefFor, isFallbackLink, L, publishedOf, byDateDesc, dated, diseasePage, sourceCard, unitName, translationBadge, pill, itemPath, vaxmapButton, vaxmapLinkForVaccine, VAXMAP_GROUP_OF } from './_partials.mjs';
import { currentDoc } from './disease.mjs';

const trailOf = (ctx, item) => [{ label: ctx.t('nav.vaccines'), href: '/vaccines/' }, { label: L(ctx, item, 'title') }];

export function meta(ctx, props = {}) {
  if (props.item) return { title: L(ctx, props.item, 'title'), description: L(ctx, props.item, 'summary'), item: props.item, jsonLd: ldFor(ctx, props.item, trailOf(ctx, props.item)) };
  return { title: ctx.t('nav.vaccines'), description: ctx.t('vaccines.desc'), jsonLd: ldFor(ctx, null, [{ label: ctx.t('nav.vaccines') }]) };
}

function fundedTable(ctx, v) {
  const { t, fmtDate } = ctx;
  const f = v.publicFunded ?? [];
  if (!f.length) return html`<p class="muted">${t('vaccines.nofunded')}</p>`;
  return html`<div class="c-tablewrap"><table class="c-table"><caption class="sr-only">${t('vaccines.funded')}</caption><thead><tr><th scope="col">${t('vaccines.group')}</th><th scope="col">${t('vaccines.schedule')}</th><th scope="col">${t('vaccines.period')}</th><th scope="col">${t('vaccines.note')}</th></tr></thead><tbody>
    ${f.map((r) => html`<tr><th scope="row">${r.group}</th><td>${r.schedule}</td><td>${r.startAt ? html`${fmtDate(r.startAt)}${r.endAt ? ` – ${fmtDate(r.endAt)}` : ''}` : '—'}</td><td>${r.note ?? ''}</td></tr>`)}</tbody></table></div>`;
}

function index(ctx) {
  const { site, t, url } = ctx;
  const pages_ = publishedOf(site, 'vaccines');
  const mv = site.master.vaccines;
  const rows = pages_.flatMap((v) => (v.publicFunded ?? []).map((r) => ({ v, r })));
  return html`${pageHead(ctx, { trail: [{ label: t('nav.vaccines') }], h1: t('nav.vaccines'), lead: t('vaccines.lead') })}
<section class="vxs-entry" aria-labelledby="vx-map"><div><h2 id="vx-map">${t('vxs.entry.t')}</h2><p>${t('vxs.entry.d')}</p></div><a class="c-btn" href="${url('/vaccines/schedule/')}">${t('vxs.entry.cta')} →</a></section>
<section aria-labelledby="vx-list">${sectionHead(ctx, { id: 'vx-list', title: t('vaccines.list') })}
  <div class="c-cards3">${mv.map((m) => {
    const page = pages_.find((v) => v.id === m.id);
    const name = ctx.lang === 'zh-TW' ? m.name : m.nameEn;
    const dis = (m.diseases ?? []).map((d) => diseasePage(ctx, d)).filter(Boolean);
    return html`<article class="c-card"><h3>${page ? html`<a href="${hrefFor(ctx, page)}">${L(ctx, page, 'title') ?? name}</a>` : name}</h3><p class="muted" lang="en">${m.nameEn}</p>
      ${page ? html`<p>${L(ctx, page, 'summary')}</p><p class="muted">${t('prov.reviewed')} ${ctx.fmtDate(page.reviewedAt)}</p>` : html`<p class="muted">${t('vaccines.nopage')}</p><a href="${url('/ask/')}?q=${encodeURIComponent(m.name)}">${t('diseases.askit')} →</a>`}
      ${dis.length ? html`<p class="c-linkrow">${dis.map((d) => html`<a href="${hrefFor(ctx, d)}">${L(ctx, d, 'title')}</a> `)}</p>` : ''}
      ${page && isFallbackLink(ctx, page) ? translationBadge(ctx, 'none') : ''}</article>`;
  })}</div></section>
${rows.length ? html`<section aria-labelledby="vx-funded">${sectionHead(ctx, { id: 'vx-funded', title: t('vaccines.funded.all') })}<div class="c-tablewrap"><table class="c-table"><thead><tr><th scope="col">${t('nav.vaccines')}</th><th scope="col">${t('vaccines.group')}</th><th scope="col">${t('vaccines.schedule')}</th><th scope="col">${t('vaccines.note')}</th></tr></thead><tbody>${rows.map(({ v, r }) => html`<tr><th scope="row"><a href="${hrefFor(ctx, v)}">${L(ctx, v, 'title')}</a></th><td>${r.group}</td><td>${r.schedule}</td><td>${r.note ?? ''}</td></tr>`)}</tbody></table></div></section>` : ''}
<section class="c-ask-inline">${askBox(ctx, { id: 'vq', size: 'md', task: 'vaccines', placeholder: t('vaccines.ask.ph') })}</section>
${feedback(ctx, { page: ctx.path })}`;
}

function detail(ctx, v) {
  const { site, t, url, fmtDate } = ctx;
  const dis = (v.diseases ?? []).map((d) => diseasePage(ctx, d)).filter(Boolean);
  const news = site.collections.news.filter((n) => n.status === 'published' && n.vaccines?.includes(v.id)).sort(byDateDesc).slice(0, 4);
  const docs = site.collections.documents.filter((d) => d.isCurrent && d.status === 'published' && d.vaccines?.includes(v.id));
  const title = L(ctx, v, 'title');
  const langStatus = v.languages?.[ctx.lang]?.status;
  return html`${breadcrumb(ctx, trailOf(ctx, v))}
<article class="c-vaccine">
  <header class="c-pagehead"><div class="c-pagehead__main">
    <h1>${title} <small class="c-disease__en" lang="en">${v.nameEn}</small></h1>
    <p class="lead">${L(ctx, v, 'summary')}</p>
    ${scopeTags(ctx, v)}
    ${langStatus && ctx.lang !== 'zh-TW' ? html`<p>${translationBadge(ctx, langStatus === 'reviewed' ? 'reviewed' : 'machine')}</p>` : ''}
    ${provenance(ctx, v)}${alerts(ctx, v)}
  </div></header>
  <div class="c-askband"><div class="c-askband__t">${t('vaccines.ask', { name: title })}</div>${askBox(ctx, { id: 'vq', size: 'md', vaccine: v.id, placeholder: t('vaccines.ask.ph') })}<p class="c-askband__note">${t('disease.ask.note')}</p></div>
  <div class="c-cols c-cols--2">
    <div class="c-cols__main">
      <section class="c-block" id="funded"><h2>${t('vaccines.funded')}</h2>${fundedTable(ctx, v)}${site.master.immunizationSchedule?.some((i) => i.vaccine === v.id) ? html`<p class="c-linkrow"><a href="${url('/vaccines/schedule/')}#vaccine=${v.id}">${t('vxs.link.map')} →</a></p>` : ''}</section>
      ${v.bodyMarkdown ? html`<section class="c-block" id="schedule"><h2>${t('vaccines.schedule.t')}</h2>${raw(md(L(ctx, v, 'bodyMarkdown')))}</section>` : ''}
      ${v.precautions ? html`<section class="c-block" id="precautions"><h2>${t('vaccines.precautions')}</h2><div class="c-warning">${raw(md(L(ctx, v, 'precautions')))}</div></section>` : ''}
      <section class="c-block" id="where"><h2>${t('vaccines.where')}</h2>
        <p>${t('vaccines.where.d')}</p>
        <p class="c-linkrow">${v.whereUrl ? (VAXMAP_GROUP_OF[v.id] ? vaxmapButton(ctx, { group: VAXMAP_GROUP_OF[v.id] }) : vaxmapButton(ctx, { info: true, anchor: 'where' })) : ''} <a class="c-btn c-btn--ghost" href="${url('/travel/')}">${t('travel.country.clinic')}</a></p>
        ${v.whereUrl ? sourceCard(ctx, { title: t('source.card'), canonicalUrl: vaxmapLinkForVaccine(ctx, v), owner: unitName(ctx, v.owner), license: v.license, dataDate: v.reviewedAt }) : ''}
      </section>
      ${feedback(ctx, { page: ctx.path })}
    </div>
    <aside class="c-cols__side">
      ${dis.length ? html`<section class="c-aside-card"><h2>${t('vaccines.diseases')}</h2><ul class="c-linklist">${dis.map((d) => html`<li><a href="${hrefFor(ctx, d)}">${L(ctx, d, 'title')}</a></li>`)}</ul></section>` : ''}
      <section class="c-aside-card"><h2>${t('disease.news')}</h2>${news.length ? html`<ul class="c-newslist c-newslist--tight">${news.map((n) => dated(ctx, n, { type: false }))}</ul>` : html`<p class="muted">${t('none')}</p>`}</section>
      ${docs.length ? html`<section class="c-aside-card"><h2>${t('disease.docs')}</h2><ul class="c-doclist">${docs.map((d) => html`<li><a href="${hrefFor(ctx, d)}">${L(ctx, d, 'title')}</a><br><span class="muted">${d.version} · ${fmtDate(d.effectiveAt)}</span></li>`)}</ul></section>` : ''}
      ${pageData(ctx, v, { schema: 'Drug', api: '/v1/vaccines.json', mdPath: `${itemPath(v).replace(/\/$/, '')}.md` })}
    </aside>
  </div>
</article>`;
}

export function render(ctx, props = {}) { return props.item ? detail(ctx, props.item) : index(ctx); }

export function markdown(ctx, { item }) {
  const lines = [`# ${L(ctx, item, 'title')}（${item.nameEn}）`, '', `> 權責單位：${unitName(ctx, item.owner)} · 最後審閱：${item.reviewedAt} · 下次審閱：${item.gov?.nextReviewAt ?? ''} · 授權：${item.license} · ID：${item.id}`];
  for (const a of item.gov?.annotations ?? []) lines.push(`> ⚠ ${a.text}`);
  lines.push('', L(ctx, item, 'summary'), '', '## 公費對象');
  for (const r of item.publicFunded ?? []) lines.push(`- ${r.group}：${r.schedule}${r.note ? `（${r.note}）` : ''}`);
  if (item.bodyMarkdown) lines.push('', '## 時程', '', L(ctx, item, 'bodyMarkdown'));
  if (item.precautions) lines.push('', '## 注意事項', '', L(ctx, item, 'precautions'));
  if (item.whereUrl) lines.push('', `接種地點查詢（疫苗及流感藥劑地圖 vaxmap）：${vaxmapLinkForVaccine(ctx, item)}`);
  return lines.join('\n') + '\n';
}

export function pages(site) {
  const out = [{ path: '/vaccines/', lang: '*', props: {} }];
  for (const L_ of site.config.langs) for (const v of site.collections.vaccines) if (v.status === 'published' && langAvailable(site, v, L_.code)) out.push({ path: `/vaccines/${v.slug}/`, lang: L_.code, props: { item: v }, md: true });
  return out;
}
void currentDoc; void pill;
