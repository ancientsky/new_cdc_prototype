// /publications/bulletin/（《疫情報導》總覽）與 /publications/bulletin/{分類}/（分類列表）——第三十五輪，ARCHITECTURE §34.5。
// 官網「疫情報導」左側是「本刊物簡介、卷期、原著文章、疫情調查、焦點特寫…」；新站把這個導覽做成：總覽頁（簡介＋分類＋最新卷期）與每個分類一頁（文章依出刊日倒序，含摘要一句）。
// 分類清單來自 content/master/bulletin-categories.json（後台「分類管理」可加），不是寫死在模板裡。卷期網址是 /publications/bulletin-42-19/，與這裡的 /publications/bulletin/ 不會撞。
import { html } from '../../../scripts/lib/render.mjs';
import { ldFor, pageHead, hrefFor, L, isFallbackLink, feedback } from './_partials.mjs';
import { issueOf, volIssueLabel, categoryPill, categoryNavHtml, doiHtml, pdfHref } from './_bulletin.mjs';
import { BULLETIN_HOME, categoryPath, sortCategories, categoryLabel, authorNotes } from '../../client/bulletin-rules.js';

const live = (site) => (site.collections.articles ?? []).filter((a) => a.status === 'published' && site.byId.has(a.issueId));
const byDate = (site) => (a, b) => String(issueOf(site, b)?.publishedAt ?? '').localeCompare(String(issueOf(site, a)?.publishedAt ?? '')) || (a.articleNo ?? 0) - (b.articleNo ?? 0);

export function pages(site) {
  const out = [];
  const arts = live(site);
  for (const L_ of site.config.langs) {
    out.push({ path: BULLETIN_HOME, lang: L_.code, props: { kind: 'home' } });
    for (const c of sortCategories(site.master.bulletinCategories)) if (!c.retiredAt || arts.some((a) => a.articleType === c.key)) out.push({ path: categoryPath(c.key), lang: L_.code, props: { kind: 'category', category: c } });
  }
  return out;
}

export function meta(ctx, props = {}) {
  const { t } = ctx;
  if (props.kind === 'category') {
    const label = categoryLabel(ctx.site.master.bulletinCategories, props.category.key, ctx.lang);
    return { title: `${label} · ${t('teb.home')}`, description: props.category.description ?? t('teb.about'), jsonLd: ldFor(ctx, null, [{ label: t('publications.title'), href: '/publications/' }, { label: t('teb.home'), href: BULLETIN_HOME }, { label }]) };
  }
  return { title: t('teb.home'), description: t('teb.about'), jsonLd: ldFor(ctx, null, [{ label: t('publications.title'), href: '/publications/' }, { label: t('teb.home') }]) };
}

/** 一篇文章的列表卡：分類、卷期、篇名、作者、摘要一句、DOI */
function articleCard(ctx, a) {
  const { site, t, fmtDate } = ctx;
  const issue = issueOf(site, a);
  const n = authorNotes(a);
  const pdf = pdfHref(ctx, a, issue);
  return html`<li class="c-teb__card">
    <p class="c-teb__tocmeta muted">${categoryPill(ctx, a.articleType)} ${issue ? html`<a href="${hrefFor(ctx, issue)}">${volIssueLabel(ctx, issue)}</a> · <time datetime="${issue.publishedAt}">${fmtDate(issue.publishedAt)}</time>` : ''}${a.pages ? html` · ${t('teb.pages', { p: a.pages })}` : ''}</p>
    <p class="c-teb__toctitle"><a class="c-teb__toct" href="${hrefFor(ctx, a)}"${isFallbackLink(ctx, a) ? html` lang="zh-TW"` : ''}>${L(ctx, a, 'title')}</a></p>
    ${a.titleEn && ctx.lang === 'zh-TW' ? html`<p class="c-teb__tocen muted" lang="en">${a.titleEn}</p>` : ''}
    <p class="c-teb__tocauthors">${n.authors.map((x) => (ctx.lang !== 'zh-TW' && x.nameEn ? x.nameEn : x.name)).join(ctx.lang === 'zh-TW' ? '、' : ', ')}</p>
    <p class="c-teb__tocsum">${L(ctx, a, 'summary')}</p>
    <p class="c-teb__toclinks"><a class="c-btn c-btn--sm" href="${hrefFor(ctx, a)}">${t('teb.fulltext')}</a> ${pdf ? html`<a class="c-btn c-btn--ghost c-btn--sm" href="${pdf}" rel="noopener">${a.pdfUrl ? t('teb.pdf.article') : t('teb.pdf.issue')}</a>` : ''}${a.doi ? html` <span class="muted">DOI ${doiHtml(ctx, a.doi)}</span>` : ''}</p>
  </li>`;
}

function home(ctx) {
  const { site, t, fmtDate, url } = ctx;
  const arts = live(site).sort(byDate(site));
  const issues = (site.collections.publications ?? []).filter((p) => p.status === 'published' && p.pubType === 'bulletin').sort((a, b) => Number(b.volume) - Number(a.volume) || Number(b.issue) - Number(a.issue));
  const latest = issues.slice(0, 8);
  return html`${pageHead(ctx, { trail: [{ label: t('publications.title'), href: '/publications/' }, { label: t('teb.home') }], h1: t('teb.home'), lead: t('teb.about'), actions: html`${latest[0]?.pdfUrl ? html`<a class="c-btn c-btn--sm" href="${/^https?:/.test(latest[0].pdfUrl) ? latest[0].pdfUrl : url(latest[0].pdfUrl, { noLang: true })}" rel="noopener">${t('teb.pdf.latest')} ↗</a>` : ''}<a class="c-btn c-btn--ghost c-btn--sm" href="${url('/feeds/publications.xml', { noLang: true })}">RSS</a>` })}
<div class="c-cols c-cols--2">
  <div class="c-cols__main">
    <section class="c-block" id="latest" aria-labelledby="latest-h"><h2 id="latest-h">${t('teb.latest.articles')}</h2>
      ${arts.length ? html`<ol class="c-teb__toc c-teb__list">${arts.slice(0, 10).map((a) => articleCard(ctx, a))}</ol>` : html`<p class="c-empty">${t('none')}</p>`}
    </section>
    <section class="c-block" id="issues" aria-labelledby="issues-h"><h2 id="issues-h">${t('teb.issues')}</h2>
      <ul class="c-linklist">${latest.map((p) => html`<li><a href="${hrefFor(ctx, p)}">${volIssueLabel(ctx, p)}</a> <span class="muted">${fmtDate(p.publishedAt)}</span></li>`)}</ul>
      <p><a href="${url('/publications/')}#series-0">${t('teb.allissues')} →</a></p>
    </section>
    ${feedback(ctx, { page: ctx.path })}
  </div>
  <aside class="c-cols__side">
    <section class="c-aside-card"><h2>${t('teb.categories')}</h2>${categoryNavHtml(ctx)}</section>
    <section class="c-aside-card c-teb__masthead-card"><h2>${t('teb.masthead')}</h2><p class="muted">${t('teb.masthead.text')}</p></section>
    ${apiNote(ctx, '/v1/articles.json')}
  </aside>
</div>`;
}

function category(ctx, c) {
  const { site, t } = ctx;
  const label = categoryLabel(site.master.bulletinCategories, c.key, ctx.lang);
  const arts = live(site).filter((a) => a.articleType === c.key).sort(byDate(site));
  const years = new Map();
  for (const a of arts) { const y = String(issueOf(site, a)?.publishedAt ?? '').slice(0, 4) || '—'; if (!years.has(y)) years.set(y, []); years.get(y).push(a); }
  return html`${pageHead(ctx, { trail: [{ label: t('publications.title'), href: '/publications/' }, { label: t('teb.home'), href: BULLETIN_HOME }, { label }], h1: label, lead: c.description ?? '' })}
<div class="c-cols c-cols--2">
  <div class="c-cols__main">
    ${arts.length ? [...years.entries()].map(([y, list]) => html`<section class="c-block" id="y-${y}" aria-labelledby="y-${y}-h"><h2 id="y-${y}-h">${y} <span class="c-pill c-pill--neutral">${t('teb.count', { n: list.length })}</span></h2><ol class="c-teb__toc c-teb__list">${list.map((a) => articleCard(ctx, a))}</ol></section>`) : html`<p class="c-empty">${t('teb.category.empty')}</p>`}
    ${feedback(ctx, { page: ctx.path })}
  </div>
  <aside class="c-cols__side">
    <section class="c-aside-card"><h2>${t('teb.categories')}</h2>${categoryNavHtml(ctx, { current: c.key })}</section>
    ${apiNote(ctx, '/v1/bulletin-categories.json')}
  </aside>
</div>`;
}

function apiNote(ctx, api) {
  const { t, url } = ctx;
  return html`<p class="c-page-data muted">${t('pagedata.api')}：<a href="${url(api, { noLang: true })}"><code>${api}</code></a></p>`;
}

export function render(ctx, props = {}) { return props.kind === 'category' ? category(ctx, props.category) : home(ctx); }
