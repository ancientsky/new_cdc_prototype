// 首頁：七語；Banner 做法 A（分割式）／B（情境式，pinned 疾病 peak 時自動切換）。
import { html, raw } from '../../../scripts/lib/render.mjs';
import { config } from '../../../site.config.mjs';
import { ldFor, askBox, sitCard, statusTag, taskCard, dated, L, hrefFor, unitName, diseaseName, sitField, publishedOf, byDateDesc, verdictPill, isExternal, link, langOk, imgSrc, mediaCard, topicCard, isMediaOutdated, isTopicEnded, HOME_NEWS_TYPES } from './_partials.mjs';

export function meta(ctx) {
  return { title: null, description: ctx.t('home.desc'), bodyClass: 'page-home', jsonLd: ldFor(ctx, null, null), item: null };
}

export function activeBanners(site) {
  return site.collections.banners
    .filter((b) => b.status === 'published' && b.startAt <= site.today && site.today <= b.endAt)
    .sort((a, b) => (a.priority ?? 9) - (b.priority ?? 9)).slice(0, 3);
}

const MIGRANT_LANGS = ['vi', 'id', 'th', 'tl'];

function promoArt() {
  return raw(`<svg viewBox="0 0 400 300" class="c-promo__svg" aria-hidden="true" focusable="false"><rect width="400" height="300" rx="14" fill="#e5efe9"/><circle cx="300" cy="90" r="64" fill="#cfe3d8"/><circle cx="90" cy="230" r="50" fill="#cfe3d8"/><g transform="translate(200 150) rotate(-35)"><rect x="-70" y="-14" width="120" height="28" rx="8" fill="#fff" stroke="#1b5e3f" stroke-width="5"/><rect x="-60" y="-8" width="64" height="16" rx="4" fill="#9cc7ae"/><rect x="50" y="-4" width="40" height="8" fill="#1b5e3f"/><rect x="-82" y="-24" width="12" height="48" rx="4" fill="#1b5e3f"/><rect x="-96" y="-8" width="16" height="16" rx="4" fill="#1b5e3f"/></g></svg>`);
}

function chips(ctx) {
  const { t, url } = ctx;
  return html`<div class="c-chips-wrap"><ul class="c-chips" aria-label="${t('home.chips.label')}">${[1, 2, 3, 4].map((n) => html`<li><a class="c-chip" href="${url('/ask/')}?q=${encodeURIComponent(t(`home.chip${n}`))}">${t(`home.chip${n}`)}</a></li>`)}</ul><p class="c-chips__note">${t('home.chips.multi')}</p></div>`;
}

function promoSlide(ctx, b, i, n) {
  const { t, url, fmtDate } = ctx;
  const cta = L(ctx, b, 'cta') ?? b.cta;
  const href = isExternal(cta.url) ? cta.url : url(cta.url);
  const head = L(ctx, b, 'headline') ?? b.title;
  const src = imgSrc(ctx, b.image);
  return html`<div class="c-carousel__slide" data-slide role="group" aria-roledescription="slide" aria-label="${i + 1} / ${n}" ${i ? raw('hidden') : ''}>
      <div class="c-promo__art">${src ? html`<img src="${src}" alt="${head}" width="400" height="300" loading="${i ? 'lazy' : 'eager'}">` : promoArt()}</div>
      <div class="c-promo__txt">
      <p class="c-promo__kicker">${t('home.promo')}</p>
      <h2 class="c-promo__title">${head}</h2>
      ${L(ctx, b, 'subline') ? html`<p class="c-promo__sub">${L(ctx, b, 'subline')}</p>` : ''}
      <p><a class="c-btn" href="${href}"${isExternal(cta.url) ? raw(' rel="noopener"') : ''}>${cta.label}${isExternal(cta.url) ? ' ↗' : ' →'}</a></p>
      <p class="c-promo__meta">${t('home.promo.meta', { owner: unitName(ctx, b.owner), from: fmtDate(b.startAt), to: fmtDate(b.endAt) })}</p>
      </div>
    </div>`;
}

/** 本期宣導：card＝做法 A 右側卡；row＝做法 B 退到態勢卡下方的橫卡。最多 3 則輪播（不自動播、暫停鈕、指示點、鍵盤）。 */
function promoCarousel(ctx, banners, { variant = 'card' } = {}) {
  const { t, url } = ctx;
  if (!banners.length) return '';
  const n = banners.length;
  const body = html`<div class="c-carousel" data-carousel aria-roledescription="carousel" aria-label="${t('home.promo')}">
    <div class="c-carousel__slides" aria-live="polite">${banners.map((b, i) => promoSlide(ctx, b, i, n))}</div>
    ${n > 1 ? html`<div class="c-carousel__ctl" hidden>
      <button type="button" class="c-carousel__btn" data-carousel-prev aria-label="${t('banner.prev')}">‹</button>
      <span class="c-carousel__dots" role="group" aria-label="${t('banner.dots')}">${banners.map((b, i) => html`<button type="button" class="c-carousel__dot" data-carousel-dot="${i}" aria-label="${i + 1} / ${n}" ${i === 0 ? raw('aria-current="true"') : ''}></button>`)}</span>
      <button type="button" class="c-carousel__btn" data-carousel-next aria-label="${t('banner.next')}">›</button>
      <button type="button" class="c-carousel__play" data-carousel-play aria-pressed="false" data-on="${t('banner.autoOn')}" data-off="${t('banner.autoOff')}">${t('banner.autoOff')}</button>
      <span class="c-carousel__count" aria-hidden="true"><span data-carousel-cur>1</span>/${n}</span>
    </div>` : ''}
    <p class="c-promo__all"><a href="${url('/campaigns/')}">${t('home.promo.all')} →</a></p>
  </div>`;
  if (variant === 'row') return html`<section class="c-promo c-promo--row" aria-label="${t('home.promo')}">${body}</section>`;
  return html`<aside class="c-promo" aria-label="${t('home.promo')}">${body}</aside>`;
}

function statusStrip(ctx, items) {
  const { site } = ctx;
  return html`<ul class="c-statusstrip" aria-label="${ctx.t('home.situation')}">${items.map((it) => html`<li><a href="${ctx.url('/situation/')}">${diseaseName(ctx, site.diseaseMasterById.get(it.disease))}</a> ${statusTag(ctx, it)}</li>`)}</ul>`;
}

function heroA(ctx, banners, pinned) {
  const { t } = ctx;
  return html`<section class="c-hero c-hero--split" aria-labelledby="hero-h">
  <div class="wrap c-hero__grid">
    <div class="c-hero__ask">
      <h1 id="hero-h">${t('home.h1')}</h1>
      ${askBox(ctx, { id: 'q' })}
      ${chips(ctx)}
      ${statusStrip(ctx, pinned)}
    </div>
    ${promoCarousel(ctx, banners)}
  </div>
</section>`;
}

function heroB(ctx, peak, banners) {
  const { t, site, url } = ctx;
  const dm = site.diseaseMasterById.get(peak.disease);
  const name = diseaseName(ctx, dm);
  const b = banners[0];
  const cta = b ? (L(ctx, b, 'cta') ?? b.cta) : null;
  return html`<section class="c-hero c-hero--situational c-hero--${peak.status}" aria-labelledby="hero-h">
  <div class="wrap c-hero__bgwrap">
    <div class="c-hero__panel">
      <p class="c-hero__pillrow">${statusTag(ctx, peak)}<span class="c-hero__sentence">${sitField(ctx, peak, 'metricLabel')} <b>${sitField(ctx, peak, 'metricValue')}</b>${sitField(ctx, peak, 'deltaText') ? `，${sitField(ctx, peak, 'deltaText')}` : ''}</span></p>
      <h1 id="hero-h">${t('home.peak.h1', { name, status: t(`status.${peak.status}`), advice: sitField(ctx, peak, 'advice') })}</h1>
      <p class="c-hero__prompt">${t('home.h1')}</p>
      ${askBox(ctx, { id: 'q', label: t('home.h1') })}
      ${chips(ctx)}
      <p class="c-hero__btns"><a class="c-btn" href="${url('/situation/')}">${t('home.peak.detail')}</a>${cta ? html`<a class="c-btn c-btn--ghost" href="${isExternal(cta.url) ? cta.url : url(cta.url)}"${isExternal(cta.url) ? raw(' rel="noopener"') : ''}>${cta.label}</a>` : html`<a class="c-btn c-btn--ghost" href="${url('/vaccines/')}">${t('nav.vaccines')}</a>`}</p>
    </div>
  </div>
</section>`;
}

export function render(ctx) {
  const { site, t, url, fmtDate, lang } = ctx;
  const sit = site.situation;
  const pinned = sit.items.filter((i) => i.pinned);
  const peak = pinned.find((i) => i.status === 'peak');
  const banners = activeBanners(site);
  const news = publishedOf(site, 'news').filter((n) => HOME_NEWS_TYPES.includes(n.newsType)).sort(byDateDesc).slice(0, 4);
  const clars = publishedOf(site, 'clarifications').sort(byDateDesc).slice(0, 2);
  const migrant = MIGRANT_LANGS.includes(lang);
  const tasks = config.tasks.map((task, i) => (migrant && i === config.tasks.length - 1 ? taskCard(ctx, task, { foreign: true }) : taskCard(ctx, task)));
  const tasksSec = html`<section class="c-tasks" aria-labelledby="tasks-h"><h2 id="tasks-h">${t('home.tasks')}</h2><div class="c-tasks__grid">${tasks}</div></section>`;
  const sitSec = html`<section class="c-situation" aria-labelledby="sit-h">
    <div class="c-sechead"><h2 id="sit-h">${t('home.situation')}</h2><span class="c-sechead__note">${t('home.situation.note', { date: fmtDate(sit.dataDate), source: sit.source })}</span><a class="c-sechead__more" href="${url('/situation/')}">${t('home.situation.more')} →</a></div>
    <div class="c-sit-scroll"><div class="c-sit-grid">${pinned.map((it) => sitCard(ctx, it))}</div></div>
  </section>`;
  // 影音：最新 3 則（過時者排後）；專區：進行中最多 6 個；兩者都只取 published
  const media = publishedOf(site, 'media')
    .sort((a, b) => Number(isMediaOutdated(site, a)) - Number(isMediaOutdated(site, b)) || String(b.producedAt ?? b.publishedAt).localeCompare(String(a.producedAt ?? a.publishedAt)))
    .slice(0, 3);
  const topics = publishedOf(site, 'topics')
    .filter((x) => !isTopicEnded(site, x) && (!x.startAt || x.startAt <= site.today))
    .sort((a, b) => (a.priority ?? 9) - (b.priority ?? 9) || String(b.publishedAt).localeCompare(String(a.publishedAt))).slice(0, 6);
  const mediaSec = media.length ? html`<section class="c-home__media" aria-labelledby="media-h">
    <div class="c-sechead"><h2 id="media-h">${t('home.media')}</h2><span class="c-sechead__note">${t('home.media.note')}</span><a class="c-sechead__more" href="${url('/media/')}">${t('home.media.all')} →</a></div>
    <ul class="c-media-grid">${media.map((m) => mediaCard(ctx, m))}</ul>
  </section>` : '';
  const topicsSec = topics.length ? html`<section class="c-home__topics" aria-labelledby="topics-h">
    <div class="c-sechead"><h2 id="topics-h">${t('home.topics')}</h2><span class="c-sechead__note">${t('home.topics.note')}</span></div>
    <ul class="c-topicrow">${topics.map((x) => topicCard(ctx, x))}</ul>
  </section>` : '';
  const more = [['/apply/', 'more.apply'], ['/publications/', 'more.publications'], ['/lab/', 'more.lab'], ['/report/', 'more.report'], ['/research/', 'more.research'], ['/notices/', 'more.notices'], ['/contact/', 'more.mailbox'], ['/about/', 'more.about']];
  const moreSec = html`<nav class="c-moreservices" aria-labelledby="more-h"><h2 id="more-h">${t('home.more')}</h2><ul>${more.map(([p, k]) => html`<li><a href="${url(p)}">${t(k)}</a></li>`)}<li><a href="${url('/services/')}">${t('home.more.all')} →</a></li></ul></nav>`;
  return html`${peak ? heroB(ctx, peak, banners) : heroA(ctx, banners, pinned)}
<div class="wrap c-home">
  ${peak ? '' : tasksSec}
  ${sitSec}
  ${peak ? promoCarousel(ctx, banners, { variant: 'row' }) : ''}
  ${peak ? tasksSec : ''}
  <div class="c-home__cols">
    <div class="c-home__main">
      <section class="c-prozone" aria-labelledby="pro-h"><div><h2 id="pro-h">${t('home.pro')}</h2><p>${t('home.pro.sub')}</p></div><a class="c-btn c-btn--navy" href="${url('/pro/')}?view=pro" data-view-set="pro">${t('home.enter')}</a></section>
      <section class="c-news" aria-labelledby="news-h">
        <div class="c-sechead"><h2 id="news-h">${t('home.news')}</h2><a class="c-sechead__more" href="${url('/news/')}">${t('home.news.all')} →</a> <a class="c-sechead__more" href="${url('/feeds/news.xml', { noLang: true })}">RSS</a></div>
        <ul class="c-newslist">${news.map((n) => dated(ctx, n, { type: n.newsType === 'letter' }))}</ul>
      </section>
    </div>
    <aside class="c-home__side">
      <section class="c-clar" aria-labelledby="clar-h"><h2 id="clar-h">${t('home.clar')}</h2>
        <ul class="c-clar__list">${clars.map((c) => html`<li>${verdictPill(ctx, c.verdict, { outdated: c.gov?.stale?.length > 0 })}<a href="${hrefFor(ctx, c)}">${L(ctx, c, 'title')}</a></li>`)}</ul>
        <a class="c-btn c-btn--ghost c-btn--block" href="${url('/factcheck/')}">${t('home.clar.cta')} →</a>
      </section>
    </aside>
  </div>
  ${mediaSec}
  ${topicsSec}
  ${moreSec}
</div>`;
}

export function pages() { return [{ path: '/', lang: '*', props: {} }]; }
void link; void langOk;
