// 新聞稿／致醫界通函／澄清：列表（類型與年份篩選）與詳頁（自動加註、附件、疫情宣告）。
import { html, raw } from '../../../scripts/lib/render.mjs';
import { md } from '../../../scripts/lib/markdown.mjs';
import { langAvailable } from '../../../scripts/lib/pages.mjs';
import { ldFor, breadcrumb, pageHead, sectionHead, provenance, alerts, pageData, scopeTags, feedback, translationBadge, statusTag, hrefFor, isFallbackLink, L, unitName, publishedOf, byDateDesc, slugOf, diseasePage, diseaseName, sitField, itemPath, pill } from './_partials.mjs';

export function kindOf(n) {
  if (n.type === 'clarification') return 'clarification';
  if (n.type === 'letter' || n.newsType === 'letter') return 'letter';
  if (n.newsType === 'press') return 'press';
  if (n.newsType === 'clarification') return 'clarification';
  return 'other';
}
const KINDS = ['press', 'letter', 'clarification', 'other'];

export function meta(ctx, props = {}) {
  if (props.item) { const n = props.item; return { title: L(ctx, n, 'title'), description: L(ctx, n, 'summary'), item: n, jsonLd: ldFor(ctx, n, [{ label: ctx.t('nav.news'), href: '/news/' }, { label: L(ctx, n, 'title') }]) }; }
  return { title: ctx.t('nav.news'), description: ctx.t('news.desc'), jsonLd: ldFor(ctx, null, [{ label: ctx.t('nav.news') }]) };
}

function listPage(ctx) {
  const { site, t, fmtDate } = ctx;
  const items = [...publishedOf(site, 'news'), ...publishedOf(site, 'clarifications')].sort(byDateDesc);
  const years = [...new Set(items.map((n) => n.publishedAt.slice(0, 4)))].sort().reverse();
  const count = (k) => items.filter((n) => kindOf(n) === k).length;
  return html`${pageHead(ctx, { trail: [{ label: t('nav.news') }], h1: t('nav.news'), lead: t('news.lead'), actions: html`<a class="c-btn c-btn--ghost c-btn--sm" href="${ctx.url('/news/feed.xml', { noLang: true })}">RSS</a> <a class="c-btn c-btn--ghost c-btn--sm" href="${ctx.url('/v1/news.json', { noLang: true })}">JSON API</a>` })}
<div class="c-filterbars">
  <div class="c-filterbar" role="group" aria-label="${t('news.filter.type')}" data-filterbar="news-list" data-key="kind">
    <button type="button" data-v="" aria-pressed="true">${t('all')} (${items.length})</button>
    ${KINDS.filter((k) => count(k)).map((k) => html`<button type="button" data-v="${k}" aria-pressed="false">${t(`news.type.${k}`)} (${count(k)})</button>`)}
  </div>
  <div class="c-filterbar" role="group" aria-label="${t('news.filter.year')}" data-filterbar="news-list" data-key="year">
    <button type="button" data-v="" aria-pressed="true">${t('news.filter.allyears')}</button>
    ${years.map((y) => html`<button type="button" data-v="${y}" aria-pressed="false">${y}</button>`)}
  </div>
</div>
<ul class="c-newsfull" id="news-list" aria-live="polite">${items.map((n) => {
    const fb = isFallbackLink(ctx, n);
    return html`<li data-kind="${kindOf(n)}" data-year="${n.publishedAt.slice(0, 4)}"><time datetime="${n.publishedAt}">${fmtDate(n.publishedAt)}</time><div><p class="c-newsfull__t">${pill(t(`news.type.${kindOf(n)}`), kindOf(n) === 'clarification' ? 'warn' : kindOf(n) === 'letter' ? 'info' : 'neutral')} <a href="${hrefFor(ctx, n)}"${fb ? raw(' lang="zh-TW"') : ''}>${fb ? n.title : L(ctx, n, 'title')}</a>${n.letterNo ? html` <span class="muted">${t('news.letterNo', { n: n.letterNo })}</span>` : ''}</p><p class="muted">${fb ? n.summary : L(ctx, n, 'summary')}</p></div></li>`;
  })}</ul>
${items.length ? '' : html`<p class="c-empty">${t('none')}</p>`}`;
}

function detail(ctx, n) {
  const { site, t, fmtDate, lang } = ctx;
  const kind = kindOf(n);
  const body = L(ctx, n, 'bodyMarkdown') ?? n.bodyMarkdown;
  const diseases = (n.diseases ?? []).map((d) => ({ id: d, page: diseasePage(ctx, d), dm: site.diseaseMasterById.get(d) }));
  const decl = n.situationDeclaration;
  const sit = decl ? site.situation.items.find((i) => i.disease === decl.disease) : null;
  const dm = decl ? site.diseaseMasterById.get(decl.disease) : null;
  const langStatus = n.languages?.[lang]?.status;
  return html`${breadcrumb(ctx, [{ label: t('nav.news'), href: '/news/' }, { label: L(ctx, n, 'title') }])}
<article class="c-article">
  <header class="c-pagehead"><div class="c-pagehead__main">
    <p class="c-article__meta">${pill(t(`news.type.${kind}`), kind === 'letter' ? 'info' : 'neutral')} <time datetime="${n.publishedAt}">${t('news.published')} ${fmtDate(n.publishedAt)}</time> · ${t('news.unit')}：${unitName(ctx, n.owner)}${n.letterNo ? ` · ${t('news.letterNo', { n: n.letterNo })}` : ''}</p>
    <h1>${L(ctx, n, 'title')}</h1>
    <p class="lead">${L(ctx, n, 'summary')}</p>
    ${scopeTags(ctx, n)}
    ${langStatus && lang !== 'zh-TW' ? html`<p>${translationBadge(ctx, langStatus === 'reviewed' ? 'reviewed' : 'machine')}</p>` : ''}
    ${alerts(ctx, n)}
    ${provenance(ctx, n)}
  </div></header>
  <div class="c-cols c-cols--2">
    <div class="c-cols__main">
      <div class="c-prose">${raw(md(body))}</div>
      ${n.attachments?.length ? html`<section class="c-block"><h2>${t('news.attach')}</h2><ul class="c-linklist">${n.attachments.map((a) => html`<li><a href="${a.url}" rel="noopener">${a.label} ↗</a> ${a.machineReadable ? pill(t('news.attach.mr'), 'ok') : ''}</li>`)}</ul></section>` : ''}
      ${feedback(ctx, { page: ctx.path })}
    </div>
    <aside class="c-cols__side">
      ${decl ? html`<section class="c-aside-card c-decl"><h2>${t('news.decl')}</h2><p><b>${diseaseName(ctx, dm)}</b>：${decl.text}</p>
        ${sit ? html`<p class="muted">${t('news.decl.now')} ${statusTag(ctx, sit)} · ${sitField(ctx, sit, 'metricLabel')} ${sitField(ctx, sit, 'metricValue')}</p>` : ''}
        <a href="${ctx.url('/situation/')}">${t('home.situation.more')} →</a></section>` : ''}
      ${diseases.length ? html`<section class="c-aside-card"><h2>${t('news.related')}</h2><ul class="c-linklist">${diseases.map((d) => html`<li>${d.page ? html`<a href="${hrefFor(ctx, d.page)}">${L(ctx, d.page, 'title')}</a>` : diseaseName(ctx, d.dm)}</li>`)}</ul></section>` : ''}
      ${pageData(ctx, n, { schema: 'NewsArticle', api: '/v1/news.json', mdPath: `${itemPath(n).replace(/\/$/, '')}.md` })}
    </aside>
  </div>
</article>`;
}

export function render(ctx, props = {}) { return props.item ? detail(ctx, props.item) : listPage(ctx); }

export function markdown(ctx, { item: n }) {
  const lines = [`# ${L(ctx, n, 'title')}`, '', `> 發布日：${n.publishedAt} · 承辦單位：${unitName(ctx, n.owner)} · 最後審閱：${n.reviewedAt} · 授權：${n.license} · ID：${n.id}${n.letterNo ? ` · 通函號：${n.letterNo}` : ''}`];
  for (const a of n.gov?.annotations ?? []) lines.push(`> ⚠ ${a.text}`);
  lines.push('', L(ctx, n, 'bodyMarkdown') ?? n.bodyMarkdown ?? '');
  if (n.situationDeclaration) lines.push('', `## 疫情宣告`, '', `${n.situationDeclaration.disease}：${n.situationDeclaration.text}`);
  for (const a of n.attachments ?? []) lines.push('', `- 附件：[${a.label}](${a.url})`);
  return lines.join('\n') + '\n';
}

export function pages(site) {
  const out = [{ path: '/news/', lang: '*', props: {} }];
  for (const L_ of site.config.langs) for (const n of site.collections.news) if (n.status === 'published' && langAvailable(site, n, L_.code)) out.push({ path: `/news/${slugOf(n)}/`, lang: L_.code, props: { item: n }, md: true });
  return out;
}
void sectionHead;
