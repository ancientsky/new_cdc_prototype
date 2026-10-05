// 文件庫：列表（依 family 分組）與詳頁（版本鏈、異動對照、失效版警示 + noindex + canonical 指向現行版）。
import { html, raw } from '../../../scripts/lib/render.mjs';
import { md } from '../../../scripts/lib/markdown.mjs';
import { langAvailable } from '../../../scripts/lib/pages.mjs';
import { ldFor, breadcrumb, pageHead, sectionHead, provenance, alerts, alertBox, pageData, scopeTags, feedback, translationBadge, hrefFor, L, unitName, unitLink, slugOf, itemPath, pill, diseasePage, askBox } from './_partials.mjs';

export function familyOf(site, d) {
  const m = site.gov?.docsByFamily?.get(d.family);
  const list = m ?? site.collections.documents.filter((x) => x.family === d.family);
  return [...list].filter((x) => x.status !== 'draft').sort((a, b) => String(b.effectiveAt).localeCompare(String(a.effectiveAt)));
}
const currentOf = (site, d) => familyOf(site, d).find((x) => x.isCurrent) ?? d;
const ROLES = ['physician', 'nurse', 'infection-control', 'lab', 'local-health'];

export function meta(ctx, props = {}) {
  if (props.item) {
    const d = props.item;
    const cur = currentOf(ctx.site, d);
    const old = !d.isCurrent;
    return { title: `${L(ctx, d, 'title')}`, description: L(ctx, d, 'summary'), item: d, noindex: old, canonicalPath: old ? itemPath(cur) : null, jsonLd: ldFor(ctx, d, [{ label: ctx.t('nav.documents'), href: '/documents/' }, { label: L(ctx, d, 'title') }]) };
  }
  return { title: ctx.t('nav.documents'), description: ctx.t('documents.desc'), jsonLd: ldFor(ctx, null, [{ label: ctx.t('nav.documents') }]) };
}

function listPage(ctx) {
  const { site, t, fmtDate } = ctx;
  const docs = site.collections.documents.filter((d) => d.status === 'published' || d.status === 'archived');
  const families = [...new Set(docs.map((d) => d.family))];
  return html`${pageHead(ctx, { trail: [{ label: t('nav.documents') }], h1: t('nav.documents'), lead: t('documents.lead') })}
<p class="muted">${t('documents.note')}</p>
<div class="c-docfamilies">${families.map((fam) => {
    const vers = docs.filter((d) => d.family === fam).sort((a, b) => String(b.effectiveAt).localeCompare(String(a.effectiveAt)));
    const cur = vers.find((v) => v.isCurrent) ?? vers[0];
    return html`<section class="c-docfamily" aria-labelledby="f-${fam}">
      <h2 id="f-${fam}">${L(ctx, cur, 'title')}</h2>
      <p class="muted">${t(`documents.type.${cur.docType}`)} · ${unitLink(ctx, cur.owner)}</p>
      <ul class="c-versions">${vers.map((v) => html`<li class="${v.isCurrent ? 'is-current' : 'is-old'}">
        <a href="${hrefFor(ctx, v)}">${v.version}</a>
        <span class="muted">${t('prov.effective')} ${fmtDate(v.effectiveAt)}</span>
        ${v.isCurrent ? pill(t('prov.current'), 'ok') : pill(t('documents.expired'), 'neutral')}
        ${v.isCurrent ? html`<span class="c-pro-tag ${v.audience.includes('public') ? '' : 'is-pro'}">${v.audience.includes('public') ? '' : t('scope.pro')}</span>` : ''}
      </li>`)}</ul></section>`;
  })}</div>
${families.length ? '' : html`<p class="c-empty">${t('none')}</p>`}
<section class="c-ask-inline">${askBox(ctx, { id: 'dq2', size: 'md', placeholder: t('documents.ask.ph') })}</section>`;
}

function detail(ctx, d) {
  const { site, t, fmtDate, lang, url } = ctx;
  const chain = familyOf(site, d);
  const cur = chain.find((x) => x.isCurrent) ?? d;
  const old = !d.isCurrent;
  const prev = d.supersedes ? site.byId.get(d.supersedes) : null;
  const dis = (d.diseases ?? []).map((x) => diseasePage(ctx, x)).filter(Boolean);
  const mdUrl = `${itemPath(d).replace(/\/$/, '')}.md`;
  const langStatus = d.languages?.[lang]?.status;
  const changes = d.changes ?? [];
  const sections = d.sections ?? [];
  return html`${breadcrumb(ctx, [{ label: t('nav.documents'), href: '/documents/' }, { label: L(ctx, d, 'title') }])}
<article class="c-article" data-family="${d.family}">
  ${old ? alertBox('superseded', html`<strong class="c-alert__t">${t('alert.superseded.t')}</strong> ${t('doc.superseded', { v: d.version, cur: cur.version, date: fmtDate(cur.effectiveAt) })} <a class="c-alert__go" href="${hrefFor(ctx, cur)}">${t('doc.gocurrent')} →</a>`) : ''}
  <header class="c-pagehead"><div class="c-pagehead__main">
    <p class="c-article__meta">${pill(t(`documents.type.${d.docType}`), 'info')} ${old ? pill(t('documents.expired'), 'neutral') : pill(t('prov.current'), 'ok')}</p>
    <h1>${L(ctx, d, 'title')}</h1>
    <p class="lead">${L(ctx, d, 'summary')}</p>
    <dl class="c-provfull">
      <div><dt>${t('prov.version')}</dt><dd>${d.version}</dd></div>
      <div><dt>${t('prov.effective')}</dt><dd>${fmtDate(d.effectiveAt)}</dd></div>
      <div><dt>${t('prov.supersedes')}</dt><dd>${prev ? html`<a href="${hrefFor(ctx, prev)}">${prev.version}</a>` : '—'}</dd></div>
      <div><dt>${t('prov.next')}</dt><dd>${d.gov?.nextReviewAt ? fmtDate(d.gov.nextReviewAt) : t('prov.event')}</dd></div>
      <div><dt>${t('prov.owner')}</dt><dd>${unitLink(ctx, d.owner)}</dd></div>
      <div><dt>${t('prov.reviewed')}</dt><dd>${fmtDate(d.reviewedAt)}</dd></div>
    </dl>
    ${scopeTags(ctx, d)}
    ${d.roles?.length ? html`<p class="c-roles"><span class="muted">${t('documents.roles')}</span> ${d.roles.map((r) => html`<span class="c-pill c-pill--info">${t(`role.${r}`)}</span> `)}</p>` : ''}
    ${langStatus && lang !== 'zh-TW' ? html`<p>${translationBadge(ctx, langStatus === 'reviewed' ? 'reviewed' : 'machine')}</p>` : ''}
    ${alerts(ctx, d, { skip: ['superseded'] })}
    ${provenance(ctx, d)}
    <p class="c-docactions">
      ${d.pdfUrl ? html`<a class="c-btn" href="${/^https?:/.test(d.pdfUrl) ? d.pdfUrl : url(d.pdfUrl)}" rel="noopener">${t('documents.pdf')} ↗</a>` : ''}
      <a class="c-btn c-btn--ghost" href="${url(mdUrl)}">${t('documents.md')}</a>
      ${old ? '' : html`<button type="button" class="c-btn c-btn--ghost" data-subscribe="${d.family}" aria-pressed="false" data-on="${t('pro.subscribed')}" data-off="${t('pro.subscribe')}">${t('pro.subscribe')}</button>`}
    </p>
  </div></header>
  <div class="c-cols c-cols--2">
    <div class="c-cols__main">
      ${changes.length ? html`<section class="c-block" id="changes"><h2>${t('documents.changes')}</h2><div class="c-tablewrap"><table class="c-table c-table--changes"><caption class="sr-only">${t('documents.changes')}</caption><thead><tr><th scope="col">${t('documents.section')}</th><th scope="col">${t('documents.before')}</th><th scope="col">${t('documents.after')}</th></tr></thead><tbody>
        ${changes.map((c) => html`<tr class="c-change c-change--${c.kind ?? 'changed'}"><th scope="row">${c.section} <span class="c-change__kind">${t(`documents.kind.${c.kind ?? 'changed'}`)}</span></th><td>${c.before ? html`<del>${c.before}</del>` : html`<span class="muted">—</span>`}</td><td>${c.after ? html`<ins>${c.after}</ins>` : html`<span class="muted">—</span>`}</td></tr>`)}</tbody></table></div></section>` : ''}
      ${sections.length ? sections.map((s) => html`<section class="c-block" id="s-${s.key}"><h2>${s.heading}</h2>${raw(md(s.markdown))}</section>`) : (d.machineReadableMarkdown ? html`<section class="c-block"><div class="c-prose">${raw(md(d.machineReadableMarkdown))}</div></section>` : '')}
      <section class="c-block" id="chain"><h2>${t('documents.chain')}</h2>
        <ol class="c-timeline c-timeline--chain">${chain.map((v) => html`<li class="${v.isCurrent ? 'is-current' : ''}${v.id === d.id ? ' is-here' : ''}"><time datetime="${v.effectiveAt}">${fmtDate(v.effectiveAt)}</time> <a href="${hrefFor(ctx, v)}">${v.version}</a> ${v.isCurrent ? pill(t('prov.current'), 'ok') : pill(t('documents.expired'), 'neutral')}${v.id === d.id ? html` <span class="muted">← ${t('documents.here')}</span>` : ''}${v.supersedes ? '' : html` <span class="muted">${t('documents.first')}</span>`}</li>`)}</ol>
      </section>
      ${feedback(ctx, { page: ctx.path })}
    </div>
    <aside class="c-cols__side">
      ${sections.length ? html`<nav class="c-aside-card c-toc" aria-label="${t('disease.toc')}"><h2>${t('disease.toc')}</h2><ol>${changes.length ? html`<li><a href="#changes">${t('documents.changes')}</a></li>` : ''}${sections.map((s) => html`<li><a href="#s-${s.key}">${s.heading}</a></li>`)}<li><a href="#chain">${t('documents.chain')}</a></li></ol></nav>` : ''}
      ${dis.length ? html`<section class="c-aside-card"><h2>${t('news.related')}</h2><ul class="c-linklist">${dis.map((x) => html`<li><a href="${hrefFor(ctx, x)}">${L(ctx, x, 'title')}</a></li>`)}</ul></section>` : ''}
      ${pageData(ctx, d, { schema: 'DigitalDocument', api: '/v1/documents.json', mdPath: mdUrl })}
    </aside>
  </div>
</article>`;
}

export function render(ctx, props = {}) { return props.item ? detail(ctx, props.item) : listPage(ctx); }

export function markdown(ctx, { item: d }) {
  const { site } = ctx;
  const cur = currentOf(site, d);
  const lines = [];
  if (!d.isCurrent) lines.push(`> 本版已由 ${cur.version}（${cur.effectiveAt} 生效）取代，請見 ${ctx.url(itemPath(cur), { absolute: true })}`, '');
  lines.push(`# ${L(ctx, d, 'title')}`, '', `> 權責單位：${unitName(ctx, d.owner)} · 版次：${d.version} · 生效日：${d.effectiveAt} · 最後審閱：${d.reviewedAt} · 下次審閱：${d.gov?.nextReviewAt ?? '事件觸發'} · 授權：${d.license} · ID：${d.id}${d.supersedes ? ` · 取代：${d.supersedes}` : ''}${d.pdfUrl ? ` · PDF：${d.pdfUrl}` : ''}`);
  for (const a of d.gov?.annotations ?? []) if (a.kind !== 'superseded') lines.push(`> ⚠ ${a.text}`);
  lines.push('', String(d.machineReadableMarkdown ?? '').replace(/^#\s+[^\n]*\n+/, ''));
  if (d.changes?.length) { lines.push('', '## 本版異動'); for (const c of d.changes) lines.push(`- ${c.section}（${c.kind ?? 'changed'}）：${c.before ? `「${c.before}」→ ` : ''}${c.after ?? '（刪除）'}`); }
  return lines.join('\n') + '\n';
}

export function pages(site) {
  const out = [{ path: '/documents/', lang: '*', props: {} }];
  for (const L_ of site.config.langs) for (const d of site.collections.documents) if ((d.status === 'published' || d.status === 'archived') && langAvailable(site, d, L_.code)) out.push({ path: `/documents/${slugOf(d)}/`, lang: L_.code, props: { item: d }, md: true, noindex: !d.isCurrent });
  return out;
}
void sectionHead; void ROLES;
