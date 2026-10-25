// /research-media/：「研究與媒體」身分入口（第六十一輪）。
// 起因：首頁身分切換的第三顆鈕「研究與媒體」原本直接連到 /developers/（API 與機讀版），同事反應那是給工程師看的，
// 記者與研究者點進去找不到新聞稿、《疫情報導》、資料下載。這一頁把三種人要的東西分三組放：給媒體、給研究者、資料與引用；
// 開發者入口退到本頁最後一行與頁尾「開放資料與開發者」欄（設計理由見 docs/navigation.md §7）。
// 內容全部由既有資料推導（新聞稿、《疫情報導》文章、資料集、單位主檔），不另維護一份清單；該語言沒有的項目由 ctx.url 退回中文正本。
import { html, raw } from '../../../scripts/lib/render.mjs';
import { ldFor, pageHead, sectionHead, hrefFor, L, isFallbackLink, publishedOf, byDateDesc, unitOf, unitLink, feedback } from './_partials.mjs';
import { issueOf, volIssueLabel } from './_bulletin.mjs';
import { intlTopic } from './_international.mjs';
import { BULLETIN_HOME } from '../../client/bulletin-rules.js';
import { kindOf } from './news.mjs';

export const PATH = '/research-media/';
const PRESS_MAX = 5;
const ARTICLE_MAX = 3;

export function pages() { return [{ path: PATH, lang: '*', props: {} }]; }

export function meta(ctx) {
  return { title: ctx.t('nav.research'), description: ctx.t('rm.lead'), jsonLd: ldFor(ctx, null, [{ label: ctx.t('nav.research') }]) };
}

/** 最新新聞稿（newsType=press；通函、澄清、公告不算），依發布日新到舊 */
export function latestPress(site, n = PRESS_MAX) {
  return publishedOf(site, 'news').filter((x) => kindOf(x) === 'press').sort(byDateDesc).slice(0, n);
}

/** 《疫情報導》最新文章：卷期發布日新到舊；沒有卷期的文章不列 */
export function latestArticles(site, n = ARTICLE_MAX) {
  const arts = (site.collections.articles ?? []).filter((a) => a.status === 'published' && site.byId.has(a.issueId));
  return arts.sort((a, b) => String(issueOf(site, b)?.publishedAt ?? '').localeCompare(String(issueOf(site, a)?.publishedAt ?? '')) || (a.articleNo ?? 0) - (b.articleNo ?? 0)).slice(0, n);
}

const row = (ctx, item, label, { date = null, sub = '' } = {}) => html`<li><a href="${hrefFor(ctx, item)}"${isFallbackLink(ctx, item) ? raw(' lang="zh-TW"') : ''}>${label}</a>${date ? html` <span class="muted"><time datetime="${date}">${ctx.fmtDate(date)}</time></span>` : ''}${sub ? html` <span class="muted">${sub}</span>` : ''}</li>`;

export function render(ctx) {
  const { site, t, url, fmtDate } = ctx;
  const press = latestPress(site);
  const arts = latestArticles(site);
  const datasets = publishedOf(site, 'datasets');
  const pr = unitOf(ctx, 'unit.pr');
  const sit = site.situation;
  const hasIntl = !!intlTopic(site);
  const hasLeadership = (site.collections.pages ?? []).some((p) => p.profileIndex && p.status === 'published');
  const research = publishedOf(site, 'research');
  const publications = publishedOf(site, 'publications');

  return html`${pageHead(ctx, { trail: [{ label: t('nav.research') }], h1: t('nav.research'), lead: t('rm.lead') })}
<nav class="c-hubnav" aria-label="${t('rm.jump')}"><div class="c-hubnav__in"><a href="#rm-press">${t('rm.press')}</a><a href="#rm-research">${t('rm.research')}</a><a href="#rm-data">${t('rm.data')}</a></div></nav>

<section class="c-hub rm-hub" id="rm-press" aria-labelledby="rm-press-h">${sectionHead(ctx, { id: 'rm-press-h', title: t('rm.press'), note: t('rm.press.note') })}
  <div class="c-cards3">
    <article class="c-card vx-hub__card"><h3>${t('news.type.press')}</h3>
      ${press.length ? html`<ul class="c-linklist">${press.map((n) => row(ctx, n, L(ctx, n, 'title'), { date: n.publishedAt }))}</ul>` : html`<p class="muted">${t('none')}</p>`}
      <p><a href="${url('/news/')}">${t('home.news.all')} →</a> · <a href="${url('/factcheck/')}">${t('nav.factcheck')}</a></p></article>
    <article class="c-card vx-hub__card"><h3>${t('rm.situation')}</h3>
      <p class="muted">${sit?.dataDate ? t('rm.situation.d', { date: fmtDate(sit.dataDate) }) : t('rm.situation.d0')}</p>
      <ul class="c-linklist"><li><a href="${url('/situation/')}">${t('nav.situation')}</a></li><li><a href="${url('/travel/')}">${t('nav.travel')}</a></li><li><a href="${url('/subscribe/')}">${t('footer.subscribe')}</a> <span class="muted">${t('rm.subscribe.d')}</span></li></ul></article>
    <article class="c-card vx-hub__card"><h3>${t('rm.contact')}</h3>
      <p>${t('rm.contact.d')}</p>
      <ul class="c-linklist">
        ${pr ? html`<li>${unitLink(ctx, 'unit.pr')} <span class="muted">${t('rm.contact.pr')}</span></li>` : ''}
        <li><a href="${url('/contact/')}">${t('contact.title')}</a></li>
        ${hasLeadership ? html`<li><a href="${url('/about/leadership/')}">${t('footer.leadership')}</a></li>` : ''}
        <li><a href="tel:1922">1922</a> <span class="muted">${t('rm.contact.hotline')}</span></li></ul></article>
  </div>
</section>

<section class="c-hub rm-hub" id="rm-research" aria-labelledby="rm-research-h">${sectionHead(ctx, { id: 'rm-research-h', title: t('rm.research'), note: t('rm.research.note') })}
  <div class="c-cards3">
    <article class="c-card vx-hub__card"><h3>${t('teb.home')}</h3>
      <p class="muted">${t('rm.bulletin.d')}</p>
      ${arts.length ? html`<ul class="c-linklist">${arts.map((a) => { const issue = issueOf(site, a); return row(ctx, a, L(ctx, a, 'title'), { sub: issue ? volIssueLabel(ctx, issue) : '' }); })}</ul>` : ''}
      <p><a href="${url(BULLETIN_HOME)}">${t('teb.home')} →</a></p></article>
    <article class="c-card vx-hub__card"><h3>${t('publications.title')}</h3>
      <p class="muted">${t('rm.publications.d', { n: publications.length })}</p>
      <ul class="c-linklist"><li><a href="${url('/publications/')}">${t('publications.title')}</a></li><li><a href="${url('/documents/')}">${t('nav.documents')}</a></li>${hasIntl ? html`<li><a href="${url('/international/')}">${t('international.title')}</a></li>` : ''}</ul></article>
    <article class="c-card vx-hub__card"><h3>${t('research.title')}</h3>
      <p class="muted">${t('rm.research.d', { n: research.length })}</p>
      <ul class="c-linklist"><li><a href="${url('/research/')}">${t('research.title')}</a></li><li><a href="${url('/apply/')}">${t('rm.apply')}</a></li><li><a href="${url('/lab/')}">${t('lab.title')}</a></li></ul></article>
  </div>
</section>

<section class="c-hub rm-hub" id="rm-data" aria-labelledby="rm-data-h">${sectionHead(ctx, { id: 'rm-data-h', title: t('rm.data'), note: t('rm.data.note') })}
  <div class="c-cards3">
    <article class="c-card vx-hub__card"><h3>${t('nav.data')}</h3>
      <p class="muted">${t('rm.data.d', { n: datasets.length })}</p>
      <ul class="c-linklist"><li><a href="${url('/data/')}">${t('nav.data')}</a></li><li><a href="${url('/situation/')}">${t('nav.situation')}</a></li></ul></article>
    <article class="c-card vx-hub__card"><h3>${t('rm.cite')}</h3>
      <p>${t('rm.cite.d')}</p>
      <ul class="c-linklist"><li><a href="${url('/policy/open-data/')}">${t('footer.license')}</a></li><li><a href="${url('/glossary/')}">${t('glossary.title')}</a></li><li><a href="${url('/transparency/')}">${t('footer.transparency')}</a></li></ul></article>
    <article class="c-card vx-hub__card"><h3>${t('rm.dev')}</h3>
      <p class="muted">${t('rm.dev.d')}</p>
      <ul class="c-linklist"><li><a href="${url('/developers/')}">${t('footer.api')}</a></li><li><a href="${url('/openapi.json', { noLang: true })}">openapi.json</a></li></ul></article>
  </div>
</section>
${feedback(ctx, { page: ctx.path })}`;
}
