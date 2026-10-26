// 首頁：七語；Banner 做法 A（分割式）／B（情境式，pinned 疾病 peak 時自動切換）。
import { html, raw, makeUrl } from '../../../scripts/lib/render.mjs';
import { config } from '../../../site.config.mjs';
import { travelStats } from './travel.mjs';
import { interactivesAt, pickOnThisDay, interactivePath, interactiveSlug, EGG_DEFAULTS } from '../../../scripts/lib/interactives.mjs';
import { playCard, moduleLangOk } from './play.mjs';
import { ldFor, pill, askBox, sitCard, statusTag, taskCard, dated, unitName, diseaseName, sitField, publishedOf, byDateDesc, verdictPill, isExternal, link, langOk, imgSrc, mediaCard, topicCard, isMediaOutdated, isTopicEnded, HOME_NEWS_TYPES, titleLink, localText, langSpan, itemPath } from './_partials.mjs';

export function meta(ctx) {
  // 第六十二輪：首頁只在有「歷史上的今天」小卡或彩蛋時多載一支小腳本（依瀏覽器日期換條目、彩蛋觸發）；都關著時 HTML 與以前相同
  const extras = homeOtd(ctx) || homeEgg(ctx) ? ['/assets/js/interactives-home.js'] : [];
  return { title: null, description: ctx.t('home.desc'), bodyClass: 'page-home', jsonLd: ldFor(ctx, null, null), item: null, scripts: extras };
}

/* ───── 第六十二輪：互動模組（content/interactives/；開關、檔期、疫情緊急關閉都在 site.interactives） ───── */
/** 右側欄「歷史上的今天」小卡要用的模組（只在這個語言有文字時） */
export const homeOtd = (ctx) => interactivesAt(ctx.site, 'home-side').find((i) => i.kind === 'on-this-day' && moduleLangOk(i, ctx.lang)) ?? null;
/** 站名圖示彩蛋（只在首頁；外語首頁沒有譯文就沒有彩蛋） */
export const homeEgg = (ctx) => interactivesAt(ctx.site, 'brand').find((i) => i.kind === 'easter-egg' && moduleLangOk(i, ctx.lang)) ?? null;
/** 首頁最下方「互動與遊戲」的模組 */
export const homePlay = (ctx) => interactivesAt(ctx.site, 'home-bottom').filter((i) => moduleLangOk(i, ctx.lang));

/** 右側欄小卡：建置時先放 site.today 的條目（沒有 JS 也有內容）；interactives-home.js 再依瀏覽器日期從 /v1/interactives/<slug>.json 換成真正的「今天」 */
function otdCard(ctx, item) {
  const { t, url } = ctx;
  const mmdd = ctx.site.today.slice(5);
  const pick = pickOnThisDay(item.entries, mmdd);
  const li = (e) => html`<li class="c-otd__item${e.verified ? '' : ' c-otd__item--unverified'}"><b class="c-otd__year">${e.year}</b> <span class="c-otd__text">${e.text}</span>${e.verified ? '' : html` ${pill(t('otd.unverified'), 'warn')}`}${e.link ? html` <a class="c-otd__link" href="${url(e.link)}">${t('otd.more')} →</a>` : ''}</li>`;
  return html`<section class="c-otd c-otd--card" data-otd data-otd-src="${url(`/v1/interactives/${interactiveSlug(item)}.json`, { noLang: true })}" data-today="${mmdd}" aria-labelledby="otd-h">
    <h2 id="otd-h">${t('otd.title')}</h2>
    <p class="c-otd__near" data-otd-date${pick.exact ? raw(' hidden') : ''}>${pick.exact ? '' : t('otd.near', { date: pick.mmdd.replace('-', '/') })}</p>
    <ul class="c-otd__list" data-otd-pick>${pick.entries.map(li)}</ul>
    <a class="c-otd__all" href="${url(interactivePath(item))}">${t('otd.all')} →</a>
  </section>`;
}

/** 彩蛋：一個 hidden 的設定節點，interactives-home.js 讀它的 data 屬性；沒有 JS 就什麼都沒有（本來就是彩蛋） */
function eggNode(ctx, item) {
  const { t, url } = ctx;
  const e = item.egg;
  return html`<div data-egg hidden data-egg-triggers="${(e.triggers ?? []).join(',')}" data-egg-taps="${e.taps ?? EGG_DEFAULTS.taps}" data-egg-keys="${e.keys ?? EGG_DEFAULTS.keys}" data-egg-title="${e.title}" data-egg-text="${e.text}" data-egg-timer="${e.timerSeconds ?? ''}" data-egg-link="${e.link ? url(e.link) : ''}" data-egg-more="${t('egg.more')}" data-egg-close="${t('egg.close')}" data-egg-start="${t('egg.start')}" data-egg-done="${t('egg.done')}" data-egg-owner="${unitName(ctx, item.owner)}"></div>`;
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

/** 宣導插圖：16:9 大圖優先（imageWide），沒有就退回 4:3 image（object-fit: cover）。圖只當氛圍，字都在 HTML。 */
function promoImg(ctx, b, { eager = false } = {}) {
  const wide = imgSrc(ctx, b.imageWide);
  const src = wide ?? imgSrc(ctx, b.image);
  if (!src) return promoArt();
  // 第四十輪（#73）：與清單同一規則（localText）：本語言 → 英文 → 中文（標 lang）
  const alt = localText(ctx, b, b.imageAlt ? 'imageAlt' : 'headline');
  const altLang = alt.lang !== ctx.lang ? alt.lang : null;
  const [w, h] = wide ? [1200, 675] : [400, 300];
  return html`<img src="${src}" alt="${alt.text ?? b.title}"${altLang ? raw(` lang="${altLang}"`) : ''} width="${w}" height="${h}" ${eager ? raw('loading="eager" fetchpriority="high" decoding="async"') : raw('loading="lazy" decoding="async"')}>`;
}

function promoSlide(ctx, b, i, n, { eager = false } = {}) {
  const { t, url, fmtDate } = ctx;
  // 第四十輪（#73）：宣導文字沒有本語言譯文時退英文（lang="en"），都沒有才顯示中文並標 lang="zh-TW"；按鈕文字與連結跟著同一份譯文走
  const ctaR = localText(ctx, b, 'cta');
  const cta = ctaR.text ?? b.cta;
  const href = isExternal(cta.url) ? cta.url : url(cta.url);
  const head = localText(ctx, b, b.headline ? 'headline' : 'title');
  const sub = b.subline ? localText(ctx, b, 'subline') : null;
  return html`<div class="c-carousel__slide${i ? '' : ' is-active'}" data-slide role="group" aria-roledescription="slide" aria-label="${i + 1} / ${n}">
      <div class="c-promo__art">${promoImg(ctx, b, { eager: eager && i === 0 })}</div>
      <div class="c-promo__txt">
      <p class="c-promo__kicker">${t('home.promo')}</p>
      <h2 class="c-promo__title">${langSpan(ctx, head)}</h2>
      ${sub?.text ? html`<p class="c-promo__sub">${langSpan(ctx, sub)}</p>` : ''}
      <p class="c-promo__cta"><a class="c-btn" href="${href}"${isExternal(cta.url) ? raw(' rel="noopener"') : ''}>${langSpan(ctx, { text: cta.label, lang: ctaR.lang })}${isExternal(cta.url) ? ' ↗' : ' →'}</a></p>
      <p class="c-promo__meta">${t('home.promo.meta', { owner: unitName(ctx, b.owner), from: fmtDate(b.startAt), to: fmtDate(b.endAt) })}</p>
      </div>
    </div>`;
}

/** 本期宣導：card＝做法 A 右側大圖卡；row＝做法 B 退到態勢卡下方的橫卡（圖左 40%）。最多 3 則輪播（不自動播、暫停鈕、指示點、鍵盤）。
 *  兩版同頁輸出時 id 不可重複；本元件沒有 id。eager＝此版預設可見，首張圖 fetchpriority=high。 */
function promoCarousel(ctx, banners, { variant = 'card', eager = false } = {}) {
  const { t, url } = ctx;
  if (!banners.length) return '';
  const n = banners.length;
  const body = html`<div class="c-carousel" data-carousel aria-roledescription="carousel" aria-label="${t('home.promo')}">
    <div class="c-carousel__slides" aria-live="polite">${banners.map((b, i) => promoSlide(ctx, b, i, n, { eager }))}</div>
    <div class="c-promo__foot">
      <a class="c-promo__all" href="${url('/campaigns/')}">${t('home.promo.all')} →</a>
      ${n > 1 ? html`<div class="c-carousel__ctl" hidden>
      <button type="button" class="c-carousel__btn" data-carousel-prev aria-label="${t('banner.prev')}">‹</button>
      <span class="c-carousel__dots" role="group" aria-label="${t('banner.dots')}">${banners.map((b, i) => html`<button type="button" class="c-carousel__dot" data-carousel-dot="${i}" aria-label="${i + 1} / ${n}" ${i === 0 ? raw('aria-current="true"') : ''}></button>`)}</span>
      <button type="button" class="c-carousel__btn" data-carousel-next aria-label="${t('banner.next')}">›</button>
      <button type="button" class="c-carousel__play" data-carousel-play aria-pressed="false" data-on="${t('banner.autoOn')}" data-off="${t('banner.autoOff')}">${t('banner.autoOff')}</button>
      <span class="c-carousel__count" aria-hidden="true"><span data-carousel-cur>1</span>/${n}</span>
    </div>` : ''}
    </div>
  </div>`;
  if (variant === 'row') return html`<section class="c-promo c-promo--row" aria-label="${t('home.promo')}">${body}</section>`;
  return html`<aside class="c-promo c-promo--card" aria-label="${t('home.promo')}">${body}</aside>`;
}

function statusStrip(ctx, items) {
  const { site } = ctx;
  return html`<ul class="c-statusstrip" aria-label="${ctx.t('home.situation')}">${items.map((it) => html`<li><a href="${ctx.url('/situation/')}">${diseaseName(ctx, site.diseaseMasterById.get(it.disease))}</a> ${statusTag(ctx, it)}</li>`)}</ul>`;
}

function heroA(ctx, banners, pinned, { eager = false } = {}) {
  const { t } = ctx;
  return html`<section class="c-hero c-hero--split" aria-labelledby="hero-h">
  <div class="wrap c-hero__grid">
    <div class="c-hero__ask">
      <h1 id="hero-h">${t('home.h1')}</h1>
      ${askBox(ctx, { id: 'q' })}
      ${chips(ctx)}
      ${statusStrip(ctx, pinned)}
    </div>
    ${promoCarousel(ctx, banners, { variant: 'card', eager })}
  </div>
</section>`;
}

function heroB(ctx, peak, banners, { eager = false } = {}) {
  const { t, site, url } = ctx;
  const dm = site.diseaseMasterById.get(peak.disease);
  const name = diseaseName(ctx, dm);
  const b = banners[0];
  const cta = b ? (localText(ctx, b, 'cta').text ?? b.cta) : null;
  const art = b ? (imgSrc(ctx, b.imageWide) ?? imgSrc(ctx, b.image)) : null;
  return html`<section class="c-hero c-hero--situational c-hero--${peak.status}" aria-labelledby="hero-h-b">
  ${art ? html`<div class="c-hero__art" aria-hidden="true"><img src="${art}" alt="" width="1200" height="675" ${eager ? raw('loading="eager" fetchpriority="high" decoding="async"') : raw('loading="lazy" decoding="async"')}></div>` : ''}
  <div class="wrap c-hero__bgwrap">
    <div class="c-hero__panel">
      <p class="c-hero__pillrow">${statusTag(ctx, peak)}<span class="c-hero__sentence">${sitField(ctx, peak, 'metricLabel')} <b>${sitField(ctx, peak, 'metricValue')}</b>${sitField(ctx, peak, 'deltaText') ? `，${sitField(ctx, peak, 'deltaText')}` : ''}</span></p>
      <h1 id="hero-h-b">${t('home.peak.h1', { name, status: t(`status.${peak.status}`), advice: sitField(ctx, peak, 'advice') })}</h1>
      <p class="c-hero__prompt">${t('home.h1')}</p>
      ${askBox(ctx, { id: 'q-b', label: t('home.h1') })}
      ${chips(ctx)}
      <p class="c-hero__btns"><a class="c-btn" href="${url('/situation/')}">${t('home.peak.detail')}</a>${cta ? html`<a class="c-btn c-btn--ghost" href="${isExternal(cta.url) ? cta.url : url(cta.url)}"${isExternal(cta.url) ? raw(' rel="noopener"') : ''}>${cta.label}</a>` : html`<a class="c-btn c-btn--ghost" href="${url('/vaccines/')}">${t('nav.vaccines')}</a>`}</p>
    </div>
  </div>
</section>`;
}

const STATUS_RANK = { peak: 4, rising: 3, declining: 2, stable: 1 };
/** 做法 B 要有一個「主角疾病」：有高峰用高峰；沒有高峰時（僅供 ?hero=B 預覽）退而取最嚴重的釘選項目。 */
function heroBSubject(pinned) {
  return pinned.find((i) => i.status === 'peak') ?? [...pinned].sort((a, b) => (STATUS_RANK[b.status] ?? 0) - (STATUS_RANK[a.status] ?? 0))[0] ?? null;
}

/** 原型預覽列（topbar 下方、右對齊小灰字）：說明目前是哪一做法、可切換；`?hero=A|B` 由 ui.js 套用（不寫 localStorage）。 */
// 第四十輪（#73）：預覽列以前寫死中文、外語頁也照出（/en/ 首頁頂端一行「切換看做法 A」）。改成 i18n 字串；
// ui.js 切換後要改的那句（網址參數強制）用 data-forced 帶已翻譯的樣板，前端不必多載字串表。
function previewBar(ctx, auto) {
  const { t } = ctx;
  const other = auto === 'B' ? 'A' : 'B';
  const label = auto === 'B' ? t('home.preview.B') : t('home.preview.A');
  return html`<div class="c-promo__preview" data-hero-bar data-auto="${auto}" data-forced="${t('home.preview.forced', { x: '{x}' })}"><div class="wrap"><p>${t('home.preview.label')} <span data-hero-now>${label}</span> · <a data-hero-switch href="${ctx.url('/')}?hero=${other}" rel="nofollow">${t('home.preview.switch')} <span data-hero-other>${other}</span></a><span data-hero-reset hidden> · <a href="${ctx.url('/')}">${t('home.preview.reset')}</a></span></p></div></div>`;
}

/** 「來臺旅遊或居住」專區（content/topics/visiting-taiwan.json）；未發布就不分卡 */
export const visitingTopic = (site) => (site.collections.topics ?? []).find((x) => x.slug === 'visiting-taiwan' && x.status === 'published') ?? null;

/** 出國與入境：一張卡、兩個入口（出國 → /tasks/travel/；來台 → 來台專區）。來台專區沒有本語言版本時連英文版（它以英文為來源語言） */
function travelSplitCard(ctx, topic) {
  const { t, url } = ctx;
  const path = itemPath(topic);
  const has = langOk(ctx.site, topic, ctx.lang);
  const vHref = has ? url(path) : makeUrl('en')(path);
  return html`<div class="c-task c-task--split"><strong class="c-task__t">${t('task.travel.label')}</strong>
  <a class="c-task__half" href="${url('/tasks/travel/')}"><span class="c-task__h">${t('home.travel.out')}</span><span class="c-task__s">${t('task.travel.sub')}</span></a>
  <a class="c-task__half" href="${vHref}"${has ? '' : raw(' hreflang="en"')}><span class="c-task__h">${t('home.travel.in')}</span><span class="c-task__s">${t('home.travel.in.sub')}</span></a>
</div>`;
}

/**
 * 第四十輪（#74）：從「沒有本語言版本的頁」切語言過來時的提示（語言選單帶 ?from=…&alts=…，見 layout.mjs）。
 * 為什麼「建置時預留區塊＋前端只填網址」而不是全部交給前端：提示文字要七語，放前端就得把字串塞進 i18n.<lang>.js（每頁都載）；
 * 預先渲染成 hidden 區塊，文字在 HTML 裡、零額外字串，前端只驗證 from 是站內路徑、填 href、取消 hidden（十幾行）。
 * 沒有 JS 時區塊維持 hidden——讀者在語言選單上已看過「此頁僅有…」的標示，不會毫無預警。
 */
function fromHint(ctx) {
  const { t, lang } = ctx;
  const order = ['en', 'zh-TW', ...config.langs.map((l) => l.code).filter((c) => c !== 'en' && c !== 'zh-TW')].filter((c) => c !== lang);
  return html`<div class="wrap"><aside class="c-alert c-alert--info c-fromhint" data-from-hint hidden aria-label="${t('home.fromHint.label')}">
  <p><strong>${t('home.fromHint.t', { lang: t(`langname.${lang}`) })}</strong></p>
  <p class="c-fromhint__go">${order.map((c) => { const L = config.langs.find((x) => x.code === c); return html`<a class="c-btn c-btn--sm c-btn--ghost" data-from-alt="${c}" data-lang-path="${L.path}" hreflang="${c}" hidden>${t('home.fromHint.go', { lang: t(`langname.${c}`) })}</a> `; })}</p>
</aside></div>`;
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
  // 「出國與入境」任務卡副標：針對性統計（資料算得出來才換；缺資料退回原副標）
  const ts = travelStats(site, ctx.today);
  const travelSub = ts.hasData ? [t('home.travel.stat', { n: ts.withAdv }), ts.change?.lifted ? t('home.travel.lifted', { n: ts.change.lifted, days: ts.changeDays }) : ts.change?.new ? t('home.travel.new', { n: ts.change.new, days: ts.changeDays }) : null].filter(Boolean).join(' · ') : null;
  const travelCtx = travelSub ? { ...ctx, t: (k, v) => (k === 'task.travel.sub' ? travelSub : ctx.t(k, v)) } : ctx;
  // 第四十輪（#76）：外語首頁的「出國與入境」卡分成「出國」與「來台」兩個入口——外語讀者多半是來臺的人，
  // 以前這張卡只通到國人出國的目的地查詢。中文首頁維持原卡（中文讀者以出國為主，來台頁仍可從 /topics/ 與答案頁找到）。
  const visiting = visitingTopic(site);
  const tasks = config.tasks.map((task, i) => {
    if (migrant && i === config.tasks.length - 1) return taskCard(ctx, task, { foreign: true });
    if (task.key === 'travel' && visiting && lang !== 'zh-TW') return travelSplitCard(travelCtx, visiting);
    return taskCard(task.key === 'travel' ? travelCtx : ctx, task);
  });
  // 兩版（A／B）都輸出，隱藏非預設者；`?hero=A|B` 由 ui.js 切換。同一區塊出現兩次時 id 加後綴，隱藏版用 hidden（不進無障礙樹）。
  const auto = peak ? 'B' : 'A';
  const bSubject = peak ?? heroBSubject(pinned);
  const tasksSec = (suffix, cls = '') => html`<section class="c-tasks${cls}" aria-labelledby="tasks-h${suffix}"><h2 id="tasks-h${suffix}">${t('home.tasks')}</h2><div class="c-tasks__grid">${tasks}</div></section>`;
  const ver = (v, inner) => html`<div data-hero-ver="${v}" ${auto === v ? '' : raw('hidden')}>${inner}</div>`;
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
  // 第六十二輪：互動模組——右側欄「歷史上的今天」、最下方「互動與遊戲」（只在至少一個模組開啟時出現）、站名圖示彩蛋
  const otd = homeOtd(ctx);
  const egg = homeEgg(ctx);
  const play = homePlay(ctx);
  const playSec = play.length ? html`<section class="c-home__play" aria-labelledby="play-h">
    <div class="c-sechead"><h2 id="play-h">${t('play.title')}</h2><span class="c-sechead__note">${t('home.play.note')}</span><a class="c-sechead__more" href="${url('/play/')}">${t('home.play.all')} →</a></div>
    <ul class="c-playgrid">${play.map((i) => playCard(ctx, i))}</ul>
  </section>` : '';
  return html`${fromHint(ctx)}${previewBar(ctx, auto)}
${ver('A', heroA(ctx, banners, pinned, { eager: auto === 'A' }))}
${bSubject ? ver('B', heroB(ctx, bSubject, banners, { eager: auto === 'B' })) : ''}
<div class="wrap c-home">
  ${ver('A', tasksSec('', ' c-tasks--six'))}
  ${sitSec}
  ${bSubject ? ver('B', html`${promoCarousel(ctx, banners, { variant: 'row' })}${tasksSec('-b')}`) : ''}
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
        <ul class="c-clar__list">${clars.map((c) => html`<li>${verdictPill(ctx, c.verdict, { outdated: c.gov?.stale?.length > 0 })}${titleLink(ctx, c)}</li>`)}</ul>
        <a class="c-btn c-btn--ghost c-btn--block" href="${url('/factcheck/')}">${t('home.clar.cta')} →</a>
      </section>
      ${otd ? otdCard(ctx, otd) : ''}
    </aside>
  </div>
  ${mediaSec}
  ${topicsSec}
  ${playSec}
</div>${egg ? eggNode(ctx, egg) : ''}`;
}

export function pages() { return [{ path: '/', lang: '*', props: {} }]; }
void link; void langOk;
