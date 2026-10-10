// 共用版面：topbar／header／主選單／翻譯狀態列／頁尾／手機底部 tab。
// meta 介面：{ title, description, body, jsonLd[], noindex, bodyClass, scripts[], item, canonicalPath, hideTranslationBar }
import { html, raw, jsonScript } from '../../scripts/lib/render.mjs';
import { config } from '../../site.config.mjs';
import * as JL from '../../scripts/lib/jsonld.mjs';
import { pausedBanner, translationBadge, unitName } from './public/_partials.mjs';
import { pagefindFor, pagefindMarks } from './public/_pagefind.mjs';
import { intlTopic } from './public/_international.mjs';

// 介面（UI 字串）本身的翻譯審核狀態；內容頁則看 item.languages[lang]
const UI_TRANSLATION = { en: { status: 'reviewed', date: '2026-09-10' } };

const FAVICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%231b5e3f'/%3E%3Cpath d='M14 7h4v7h7v4h-7v7h-4v-7H7v-4h7z' fill='%23fff'/%3E%3C/svg%3E";

export const EARLY_JS = `try{var d=document.documentElement;d.classList.add('js');var v=new URLSearchParams(location.search).get('view')||localStorage.getItem('cdc.view');if(v==='pro')d.dataset.view='pro'}catch(e){document.documentElement.classList.add('js')}`;

// 頁尾分組（第十七輪 fat footer）：服務／關於與政策／開發者與開放資料／聯絡。民眾主選單不放機關型入口，全站地圖集中在頁尾；首頁不再另放「更多服務」。
const FOOT_SERVICES = [
  ['/publications/', 'more.publications'], ['/apply/', 'more.apply'], ['/lab/', 'more.lab'], ['/report/', 'more.report'], ['/research/', 'more.research'],
  ['/search/', 'footer.search'],
  ['/careers/', 'more.careers'], ['/procurement/', 'more.procurement'], ['/notices/', 'more.notices'], ['/media/', 'services.media'], ['/campaigns/', 'campaigns.title'], ['/services/', 'services.title'],
];

function translationBar(ctx, item, hide) {
  const { lang, t, fmtDate, site } = ctx;
  if (lang === 'zh-TW' || hide) return '';
  // 第六輪：內容的來源語言不是中文（如國際合作區塊以英文為準）。來源語言頁不是譯文，不顯示「已審核譯文」（頁內有語言權威性提示）；
  // 其他語言的譯文頁，「查看原文」要連到來源語言版而不是中文
  const srcLang = item?.sourceLang && item.sourceLang !== 'zh-TW' ? item.sourceLang : null;
  if (srcLang && lang === srcLang) return '';
  let status, date, stale = false;
  if (item?.languages) {
    const l = item.languages[lang];
    status = l?.status ?? 'none';
    date = l?.reviewedAt;
    stale = !!item.gov?.translationStale?.[lang];
  } else {
    const u = UI_TRANSLATION[lang];
    status = u?.status ?? 'machine';
    date = u?.date;
  }
  const kind = status === 'reviewed' ? 'reviewed' : status === 'machine' ? 'machine' : 'none';
  const origCode = srcLang && ctx.alternates?.includes(srcLang) ? srcLang : 'zh-TW';
  const origDef = config.langs.find((l) => l.code === origCode);
  const zhHref = ctx.alternates?.includes(origCode) ? (origCode === 'zh-TW' ? ctx.url(ctx.path ?? '/', { noLang: true }) : `${config.basePath}${origDef.path}${ctx.path ?? '/'}`) : ctx.url('/', { noLang: true });
  const origLabel = origCode === 'zh-TW' ? t('translation.original') : t('authority.view', { lang: t(`langname.${origCode}`) });
  const text = kind === 'reviewed' ? t('translation.bar.reviewed', { date: fmtDate(date) }) : kind === 'machine' ? t('translation.bar.machine') : t('translation.bar.none');
  void site;
  return html`<aside class="c-translation-bar c-translation-bar--${kind}" aria-label="${t('translation.label')}"><div class="wrap c-translation-bar__in">
  ${translationBadge(ctx, kind)}
  <span class="c-translation-bar__text">${text}${stale ? html` <b>${t('translation.stale')}</b>` : ''}</span>
  <a href="${zhHref}" hreflang="${origCode}" lang="${origCode}" class="c-translation-bar__orig">${origLabel}</a>
</div></aside>`;
}

/** 第二十三輪：原型模式每頁頂端的「非官方原型」橫幅（SITE_MODE=production 不輸出）。role=region＋aria-label 成為具名地標（axe region 規則）；不可關閉，避免截圖被當成官網。 */
function protoBanner(ctx) {
  if (!config.isPrototype) return '';
  const { t } = ctx;
  return html`<div class="c-proto-banner" role="region" aria-label="${t('proto.banner.tag')}" data-proto-banner><div class="wrap c-proto-banner__in"><strong>${t('proto.banner.tag')}</strong> <span>${t('proto.banner.text')}</span> <a href="${config.officialUrl}" rel="external noopener">${t('proto.banner.cta')}</a></div></div>`;
}

const ICONS = {
  home: '<path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  ask: '<path d="M4 4h16v12H8l-4 4z"/>',
  chart: '<path d="M4 20V10m6 10V4m6 16v-7m4 7H2"/>',
  phone: '<path d="M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2z"/>',
};
const icon = (n) => raw(`<svg class="c-tabbar__ic" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n]}</svg>`);

export function layout(ctx, { styles = [], title, description, body, jsonLd = [], noindex = false, bodyClass = '', scripts = [], item = null, canonicalPath = null, hideTranslationBar = false, pagefind = undefined }) {
  const { site, lang, url, t } = ctx;
  // 第二十八輪：Pagefind 全文索引。只有 pagefindFor() 認得的頁才加 data-pagefind-body（正面表列，見 public/_pagefind.mjs）
  const pf = pagefindMarks(ctx, pagefindFor({ item, noindex, pagefind }), { unitName: (id) => unitName(ctx, id), title });
  const langDef = config.langs.find((l) => l.code === lang);
  const path = ctx.path ?? '/';
  const fullTitle = title ? `${title} · ${t('site.short')}` : t('site.name');
  const alts = ctx.alternates ?? ['zh-TW'];
  const origin = `${config.siteUrl}${config.basePath}`;
  const alternates = alts.map((code) => {
    const L = config.langs.find((l) => l.code === code);
    return html`<link rel="alternate" hreflang="${code}" href="${origin}${L.path}${path}">`;
  });
  const canonical = `${config.siteUrl}${url(canonicalPath ?? path)}`;
  const isHome = path === '/';
  const ld = [...jsonLd];
  if (isHome) {
    try { ld.push(JL.websiteJsonLd(ctx)); } catch { /* optional */ }
    try { ld.push(JL.orgJsonLd(ctx)); } catch { /* optional */ }
  }
  const forcePro = path.startsWith('/pro/');
  const wide = /\bpage-wide\b|\bpage-home\b/.test(bodyClass);
  const navItems = [
    ['/diseases/', 'nav.diseases'], ['/vaccines/', 'nav.vaccines'], ['/travel/', 'nav.travel'], ['/situation/', 'nav.situation'],
    ['/factcheck/', 'nav.factcheck'], ['/data/', 'nav.data'], ['/news/', 'nav.news'], ['/faq/', 'nav.faq'],
  ];
  // 第六輪：國際合作入口。zh-TW 主選單已滿（八項）不加；英文站使用者習慣在主選單找 International Cooperation，所以只有 en 多一項。其他語言放頁尾「關於疾管署」群組
  const hasIntl = !!intlTopic(site);
  if (hasIntl && lang === 'en') navItems.push(['/international/', 'international.title']);
  const langLinks = config.langs.map((L) => {
    const same = alts.includes(L.code);
    return html`<a href="${config.basePath}${L.path}${same ? path : '/'}" data-lang-path="${L.path}" data-same="${same ? '1' : '0'}" hreflang="${L.code}" lang="${L.code}" ${L.code === lang ? raw('aria-current="true"') : ''}>${L.label}</a>`;
  });
  return html`<!doctype html>
<html lang="${lang}" dir="${langDef?.dir ?? 'ltr'}" data-base="${config.basePath}" data-lang-path="${langDef?.path ?? ''}" data-view="${forcePro ? 'pro' : 'public'}"${forcePro ? raw(' data-force-view="pro"') : ''}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${fullTitle}</title>
<meta name="description" content="${description ?? ''}">
<meta name="theme-color" content="#1b5e3f">
<link rel="icon" href="${FAVICON}">
<link rel="canonical" href="${canonical}">
${alternates}
<link rel="alternate" hreflang="x-default" href="${origin}${path}">
${config.isPrototype ? raw('<meta name="robots" content="noindex, nofollow">') : noindex ? raw('<meta name="robots" content="noindex">') : ''}
<meta property="og:title" content="${fullTitle}"><meta property="og:description" content="${description ?? ''}"><meta property="og:type" content="website"><meta property="og:site_name" content="${t('site.name')}"><meta property="og:url" content="${canonical}"><meta property="og:locale" content="${lang.replace('-', '_')}">
<script>${raw(EARLY_JS)}</script>
<link rel="stylesheet" href="${url('/assets/styles/tokens.css', { noLang: true })}">
<link rel="stylesheet" href="${url('/assets/styles/base.css', { noLang: true })}">
<link rel="stylesheet" href="${url('/assets/styles/components.css', { noLang: true })}">
${(styles ?? []).map((s) => html`<link rel="stylesheet" href="${url(s, { noLang: true })}">`)}
${ld.map((j) => raw(`<script type="application/ld+json">${jsonScript(j)}</script>`))}
</head>
<body class="${bodyClass}">
<a class="skip-link" href="#main">${t('skip')}</a>
${protoBanner(ctx)}
<div class="topbar"><div class="wrap topbar__in">
  <nav class="langs langs--inline" aria-label="${t('lang.label')}">${langLinks}</nav>
  <details class="langmenu">
    <summary class="langmenu__btn">${t('lang.menu')}</summary>
    <nav class="langmenu__list" aria-label="${t('lang.label')}">${langLinks}</nav>
  </details>
  <nav class="topbar__links" aria-label="${t('nav.tools')}"><a href="${url('/accessibility/')}">${t('a11y')}</a><a href="${url('/sitemap-page/')}">${t('sitemap')}</a><a href="${url('/search/')}">${t('search.title')}</a><a class="hotline" href="tel:1922">${t('hotline')}</a></nav>
</div></div>
<header class="site-header"><div class="wrap site-header__in">
  <a class="brand" href="${url('/')}"><span class="brand__mark" aria-hidden="true"><svg viewBox="0 0 32 32" width="40" height="40"><rect width="32" height="32" rx="8" fill="currentColor"/><path d="M14 7h4v7h7v4h-7v7h-4v-7H7v-4h7z" fill="#fff"/></svg></span><span class="brand__text"><span class="brand__name">${t('site.name')}</span><span class="brand__sub">${lang === 'zh-TW' ? config.nameEn : t('site.parent')}</span></span></a>
  <div class="audience" role="group" aria-label="${t('nav.audience')}">
    <a class="audience__btn" href="${url('/')}?view=public" data-view-set="public" ${forcePro ? '' : raw('aria-current="page"')}>${t('nav.public')}</a>
    <a class="audience__btn" href="${url('/pro/')}?view=pro" data-view-set="pro" ${forcePro ? raw('aria-current="page"') : ''}>${t('nav.pro')}</a>
    <a class="audience__btn" href="${url('/developers/')}">${t('nav.research')}</a>
  </div>
  <button type="button" class="c-nav__toggle" aria-expanded="false" aria-controls="main-nav">${t('nav.menu')}</button>
</div>
<nav id="main-nav" class="c-nav" aria-label="${t('nav.main')}"><div class="wrap c-nav__in">${navItems.map(([p, k]) => html`<a href="${url(p)}" ${path.startsWith(p) ? raw('aria-current="page"') : ''}>${t(k)}</a>`)}<a class="c-nav__pro c-pro-only" href="${url('/pro/')}">${t('nav.pro')}</a></div>
  <div class="wrap c-nav__langs"><p class="c-nav__langs-t" id="nav-langs-t">${t('lang.menu')}</p><div class="c-nav__langs-l" role="group" aria-labelledby="nav-langs-t">${langLinks}</div></div></nav>
</header>
${pausedBanner(ctx)}
<main id="main"${wide ? '' : raw(' class="wrap"')}${raw(pf.bodyAttr)}>${raw(pf.weigh(body))}${pf.tail}</main>
${translationBar(ctx, item, hideTranslationBar)}
<footer class="site-footer"><div class="wrap site-footer__in">
  <nav class="site-footer__col" aria-labelledby="ft-svc"><h2 class="site-footer__t" id="ft-svc">${t('footer.services')}</h2><ul>${FOOT_SERVICES.map(([p, k]) => html`<li><a href="${url(p)}">${t(k)}</a></li>`)}</ul></nav>
  <nav class="site-footer__col" aria-labelledby="ft-about"><h2 class="site-footer__t" id="ft-about">${t('footer.group.about')}</h2><ul>
    <li><a href="${url('/about/')}">${t('footer.about')}</a></li>${hasIntl ? html`<li><a href="${url('/international/')}">${t('international.title')}</a></li>` : ''}
    <li><a href="${url('/policy/privacy/')}">${t('footer.privacy')}</a></li><li><a href="${url('/policy/ai/')}">${t('footer.ai')}</a></li><li><a href="${url('/accessibility/')}">${t('footer.a11y')}</a></li>
    <li><a href="${url('/policy/legal/')}">${t('footer.legal')}</a></li><li><a href="${url('/policy/foia/')}">${t('footer.foia')}</a></li><li><a href="${url('/policy/security/')}">${t('footer.security')}</a></li><li><a href="${url('/policy/copyright/')}">${t('footer.copyright')}</a></li>
    <li><a href="${url('/guide/')}">${t('footer.guide')}</a></li><li><a href="${url('/sitemap-page/')}">${t('sitemap')}</a></li></ul></nav>
  <nav class="site-footer__col" aria-labelledby="ft-dev"><h2 class="site-footer__t" id="ft-dev">${t('footer.group.dev')}</h2><ul>
    <li><a href="${url('/data/')}">${t('nav.data')}</a></li><li><a href="${url('/developers/')}">${t('footer.api')}</a></li><li><a href="${url('/policy/open-data/')}">${t('footer.license')}</a></li><li><a href="${url('/glossary/')}">${t('footer.glossary')}</a></li>
    <li><a href="${url('/transparency/')}">${t('footer.transparency')}</a></li><li><a href="${url('/admin/', { noLang: true })}">${t('footer.admin')}</a></li></ul></nav>
  <div class="site-footer__col site-footer__col--contact"><h2 class="site-footer__t" id="ft-contact">${t('footer.group.contact')}</h2>
    <p class="site-footer__hot"><a href="tel:1922">1922</a><a class="site-footer__hot2" href="tel:0800001922">0800-001922</a></p>
    <p class="site-footer__hotnote">${t('footer.hotline.note')}</p>
    <ul aria-labelledby="ft-contact"><li><a href="${url('/contact/')}">${t('more.mailbox')}</a></li><li><a href="${url('/report/')}">${t('more.report')}</a></li></ul></div>
  <p class="site-footer__meta">${t('footer.proto', { date: site.today })}</p>
</div></footer>
<nav class="c-tabbar" aria-label="${t('nav.quick')}">
  <a href="${url('/')}" ${isHome ? raw('aria-current="page"') : ''}>${icon('home')}<span>${t('tab.home')}</span></a>
  <a href="${url('/ask/')}" ${path.startsWith('/ask/') ? raw('aria-current="page"') : ''}>${icon('ask')}<span>${t('tab.ask')}</span></a>
  <a href="${url('/situation/')}" ${path.startsWith('/situation/') ? raw('aria-current="page"') : ''}>${icon('chart')}<span>${t('tab.situation')}</span></a>
  <a href="tel:1922">${icon('phone')}<span>1922</span></a>
</nav>
<script type="module" src="${url(`/assets/js/i18n.${lang}.js`, { noLang: true })}"></script>
<script type="module" src="${url('/assets/js/ui.js', { noLang: true })}"></script>
${scripts.map((s) => html`<script type="module" src="${url(s, { noLang: true })}"></script>`)}
</body>
</html>`;
}
