// 政策／靜態頁：content/pages/*.json（type page）。目錄尚無檔案時 pages() 回傳空陣列。
import { html, raw } from '../../../scripts/lib/render.mjs';
import { md } from '../../../scripts/lib/markdown.mjs';
import { langAvailable } from '../../../scripts/lib/pages.mjs';
import { ldFor, breadcrumb, provenance, alerts, pageData, feedback, translationBadge, scopeTags, L, PAGE_PATHS } from './_partials.mjs';

export function meta(ctx, { item }) {
  return { title: L(ctx, item, 'title'), description: L(ctx, item, 'summary'), item, jsonLd: ldFor(ctx, item, [{ label: L(ctx, item, 'title') }]) };
}

export function render(ctx, { item }) {
  const { t, lang } = ctx;
  const body = L(ctx, item, 'bodyMarkdown') ?? item.bodyMarkdown ?? '';
  const langStatus = item.languages?.[lang]?.status;
  return html`${breadcrumb(ctx, [{ label: L(ctx, item, 'title') }])}
<article class="c-article c-article--page">
  <header class="c-pagehead"><div class="c-pagehead__main"><h1>${L(ctx, item, 'title')}</h1>
    ${L(ctx, item, 'summary') ? html`<p class="lead">${L(ctx, item, 'summary')}</p>` : ''}
    ${langStatus && lang !== 'zh-TW' ? html`<p>${translationBadge(ctx, langStatus === 'reviewed' ? 'reviewed' : 'machine')}</p>` : ''}
    ${provenance(ctx, item, { showAi: false })}${alerts(ctx, item)}</div></header>
  <div class="c-prose c-prose--page">${raw(md(body))}</div>
  ${feedback(ctx, { page: ctx.path })}
  ${pageData(ctx, item, { schema: 'WebPage', mdPath: `${PAGE_PATHS[item.slug] ?? '/'}`.replace(/\/$/, '') + '.md' })}
</article>`;
}

export function markdown(ctx, { item }) {
  const lines = [`# ${L(ctx, item, 'title')}`, '', `> 權責單位：${ctx.site.unitById.get(item.owner)?.name ?? item.owner} · 最後審閱：${item.reviewedAt} · 下次審閱：${item.gov?.nextReviewAt ?? ''} · 授權：${item.license} · ID：${item.id}`];
  for (const a of item.gov?.annotations ?? []) lines.push(`> ⚠ ${a.text}`);
  lines.push('', L(ctx, item, 'bodyMarkdown') ?? item.bodyMarkdown ?? '');
  return lines.join('\n') + '\n';
}

export function pages(site) {
  const out = [];
  for (const p of site.collections.pages ?? []) {
    const path = PAGE_PATHS[p.slug];
    if (!path || p.status !== 'published') continue;
    for (const L_ of site.config.langs) if (langAvailable(site, p, L_.code)) out.push({ path, lang: L_.code, props: { item: p }, md: true });
  }
  return out;
}
