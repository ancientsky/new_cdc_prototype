// /publications/{卷期}/{篇次}/：疫情報導文章全文頁（第二十九輪，ARCHITECTURE §34；版面理由見 _bulletin.mjs 與 docs/bulletin.md）。
import { html, raw } from '../../../scripts/lib/render.mjs';
import { langAvailable } from '../../../scripts/lib/pages.mjs';
import { ldFor, breadcrumb, provenance, alerts, pageData, scopeTags, feedback, translationBadge, hrefFor, L, slugOf, itemPath, pill, diseasePage } from './_partials.mjs';
import { issueOf, volIssueLabel, articleTypeLabel, pdfHref, authorsHtml, abstractHtml, bodyHtml, citeHtml, articleToc, issueTocHtml, prevNextHtml, otherIssuesHtml, citationOf, citationEnOf, placeFigures } from './_bulletin.mjs';
import { articlePath } from '../../client/bulletin-rules.js';

const trailOf = (ctx, a, issue) => [{ label: ctx.t('publications.title'), href: '/publications/' }, ...(issue ? [{ label: L(ctx, issue, 'title'), href: itemPath(issue) }] : []), { label: ctx.t('teb.article.n', { n: a.articleNo }) }];

export function meta(ctx, { item: a }) {
  const issue = issueOf(ctx.site, a);
  return { title: L(ctx, a, 'title'), description: L(ctx, a, 'summary'), item: a, bodyClass: 'is-teb', jsonLd: ldFor(ctx, a, trailOf(ctx, a, issue)) };
}

function detail(ctx, a) {
  const { site, t, lang, fmtDate, url } = ctx;
  const issue = issueOf(site, a);
  const langStatus = a.languages?.[lang]?.status;
  const pdf = pdfHref(ctx, a, issue);
  const mdUrl = `${itemPath(a).replace(/\/$/, '')}.md`;
  const dis = (a.diseases ?? []).map((x) => diseasePage(ctx, x)).filter(Boolean);
  return html`${breadcrumb(ctx, trailOf(ctx, a, issue))}
<article class="c-article c-teb" data-issue="${a.issueId}" data-article-no="${a.articleNo}">
  <header class="c-pagehead c-teb__head"><div class="c-pagehead__main">
    <p class="c-article__meta c-teb__meta">${pill(articleTypeLabel(ctx, a.articleType), 'info')} ${issue ? html`<a class="c-teb__issue" href="${hrefFor(ctx, issue)}">${issue.series} ${volIssueLabel(ctx, issue)}</a> · <time datetime="${issue.publishedAt}">${fmtDate(issue.publishedAt)}</time>` : ''}${a.pages ? html` · ${t('teb.pages', { p: a.pages })}` : ''}${a.doi ? html` · DOI <a href="https://doi.org/${a.doi}" rel="noopener">${a.doi}</a>` : ''}</p>
    <h1>${L(ctx, a, 'title')}</h1>
    ${a.titleEn && lang === 'zh-TW' ? html`<p class="c-teb__titleen" lang="en">${a.titleEn}</p>` : ''}
    ${authorsHtml(ctx, a)}
    ${a.receivedAt || a.acceptedAt ? html`<p class="c-teb__dates muted">${a.receivedAt ? `${t('teb.received')} ${fmtDate(a.receivedAt)}` : ''}${a.receivedAt && a.acceptedAt ? ' · ' : ''}${a.acceptedAt ? `${t('teb.accepted')} ${fmtDate(a.acceptedAt)}` : ''}</p>` : ''}
    ${scopeTags(ctx, a, { region: false })}
    ${langStatus && lang !== 'zh-TW' ? html`<p>${translationBadge(ctx, langStatus === 'reviewed' ? 'reviewed' : 'machine')}</p>` : ''}
    ${alerts(ctx, a)}${provenance(ctx, a)}
  </div><div class="c-pagehead__actions c-teb__actions">
    ${pdf ? html`<a class="c-btn" href="${pdf}" rel="noopener">${a.pdfUrl ? t('teb.pdf.article') : t('teb.pdf.issue')} ↗</a>` : ''}
    <button type="button" class="c-btn c-btn--ghost" data-print>${t('teb.print')}</button>
    <button type="button" class="c-btn c-btn--ghost" data-copy-text="${citationOf(a, issue)}" data-done="${t('copied')}">${t('publications.cite')}</button>
    <a class="c-btn c-btn--ghost" href="${url(mdUrl)}">${t('documents.md')}</a>
  </div></header>
  <div class="c-cols c-cols--2">
    <div class="c-cols__main c-teb__main">
      ${abstractHtml(ctx, a)}
      ${bodyHtml(ctx, a)}
      ${citeHtml(ctx, a, issue)}
      ${prevNextHtml(ctx, a, issue)}
      ${feedback(ctx, { page: ctx.path })}
    </div>
    <aside class="c-cols__side c-teb__side">
      ${articleToc(ctx, a)}
      ${issue ? html`<section class="c-aside-card c-teb__inissue"><h2>${t('teb.inissue')}</h2>${issueTocHtml(ctx, issue, { current: a, compact: true })}<p><a href="${hrefFor(ctx, issue)}">${t('teb.toc')} →</a>${pdf && issue.pdfUrl ? html` · <a href="${pdfHref(ctx, { pdfUrl: issue.pdfUrl }, null)}" rel="noopener">${t('teb.pdf.issue')}</a>` : ''}</p></section>` : ''}
      ${dis.length ? html`<section class="c-aside-card"><h2>${t('news.related')}</h2><ul class="c-linklist">${dis.map((x) => html`<li><a href="${hrefFor(ctx, x)}">${L(ctx, x, 'title')}</a></li>`)}</ul></section>` : ''}
      ${issue ? otherIssuesHtml(ctx, issue) : ''}
      ${pageData(ctx, a, { schema: 'ScholarlyArticle', api: '/v1/articles.json', mdPath: mdUrl, editPath: '/admin/bulletin/edit/' })}
    </aside>
  </div>
</article>`;
}

export function render(ctx, props = {}) { return detail(ctx, props.item); }

export function markdown(ctx, { item: a }) {
  const { site } = ctx;
  const issue = issueOf(site, a);
  const lines = [`# ${a.title}`];
  if (a.titleEn) lines.push('', `*${a.titleEn}*`);
  lines.push('', `> ${issue ? `${issue.series} 第 ${issue.volume} 卷第 ${issue.issue} 期（${issue.publishedAt}）` : ''}${a.pages ? ` · 頁 ${a.pages}` : ''} · ${a.articleType ? `${articleTypeLabel(ctx, a.articleType)} · ` : ''}ID：${a.id}${a.pdfUrl || issue?.pdfUrl ? ` · PDF：${a.pdfUrl || issue.pdfUrl}` : ''}`);
  lines.push(`> 作者：${(a.authors ?? []).map((x) => `${x.name}${x.unit ? `（${x.unit}）` : ''}${x.corresponding ? '＊' : ''}`).join('、')}`);
  for (const an of a.gov?.annotations ?? []) lines.push(`> ⚠ ${an.text}`);
  if (a.abstractMarkdown) lines.push('', '## 摘要', '', a.abstractMarkdown);
  const h = a.highlights;
  if (h && (h.known || h.added || h.implications)) lines.push('', '## 重點', '', ...[h.known ? `- 已知：${h.known}` : null, h.added ? `- 本文新增：${h.added}` : null, h.implications ? `- 對防疫實務的意義：${h.implications}` : null].filter(Boolean));
  const { placed, rest } = placeFigures(a);
  const fig = (f) => [`**${f.kind === 'table' ? '表' : '圖'} ${f.no}** ${f.caption}`, f.alt ? `（${f.alt}）` : null, f.markdown ?? null].filter(Boolean).join('\n\n');
  for (const s of a.sections ?? []) { lines.push('', `${s.level === 3 ? '###' : '##'} ${s.heading}`, '', s.markdown ?? ''); for (const f of placed.get(s.key) ?? []) lines.push('', fig(f)); }
  if (rest.length) lines.push('', '## 圖表', '', ...rest.map(fig));
  if (a.acknowledgementsMarkdown) lines.push('', '## 誌謝', '', a.acknowledgementsMarkdown);
  if (a.references?.length) lines.push('', '## 參考文獻', '', ...a.references.map((r, i) => `${i + 1}. ${r}`));
  lines.push('', '## 引用本文', '', `- ${citationOf(a, issue)}`, `- ${citationEnOf(a, issue)}`);
  return lines.join('\n') + '\n';
}

export function pages(site) {
  const out = [];
  for (const L_ of site.config.langs) for (const a of site.collections.articles ?? []) if ((a.status === 'published' || a.status === 'archived') && langAvailable(site, a, L_.code) && site.byId.has(a.issueId)) out.push({ path: articlePath(a), lang: L_.code, props: { item: a }, md: true });
  return out;
}
void slugOf; void raw; void citationEnOf;
