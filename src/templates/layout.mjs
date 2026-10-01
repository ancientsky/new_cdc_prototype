// 共用版面：topbar／header／主選單／翻譯狀態列／頁尾／手機底部 tab。
// meta 介面：{ title, description, body, jsonLd[], noindex, bodyClass, scripts[], item, canonicalPath, hideTranslationBar }
import { html, raw, jsonScript } from '../../scripts/lib/render.mjs';
import { config } from '../../site.config.mjs';
import { orgJsonLd } from '../../scripts/lib/jsonld.mjs';
import { pausedBanner, translationBadge } from './public/_partials.mjs';

// 介面（UI 字串）本身的翻譯審核狀態；內容頁則看 item.languages[lang]
const UI_TRANSLATION = { en: { status: 'reviewed', date: '2026-09-10' } };

const FAVICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%231b5e3f'/%3E%3Cpath d='M14 7h4v7h7v4h-7v7h-4v-7H7v-4h7z' fill='%23fff'/%3E%3C/svg%3E";

const EARLY_JS = `try{var d=document.documentElement;d.classList.add('js');var v=new URLSearchParams(location.search).get('view')||localStorage.getItem('cdc.view');if(v==='pro')d.dataset.view='pro'}catch(e){document.documentElement.classList.add('js')}`;

function translationBar(ctx, item, hide) {
  const { lang, t, fmtDate, site } = ctx;
  if (lang === 'zh-TW' || hide) return '';
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
  const zhHref = ctx.alternates?.includes('zh-TW') ? ctx.url(ctx.path ?? '/', { noLang: true }) : ctx.url('/', { noLang: true });
  const text = kind === 'reviewed' ? t('translation.bar.reviewed', { date: fmtDate(date) }) : kind === 'machine' ? t('translation.bar.machine') : t('translation.bar.none');
  void site;
  return html`<aside class="c-translation-bar c-translation-bar--${kind}" aria-label="${t('translation.label')}"><div class="wrap c-translation-bar__in">
  ${translationBadge(ctx, kind)}
  <span class="c-translation-bar__text">${text}${stale ? html` <b>${t('translation.stale')}</b>` : ''}</span>
  <a href="${zhHref}" hreflang="zh-TW" lang="zh-TW" class="c-translation-bar__orig">${t('translation.original')}</a>
</div></aside>`;
}

const ICONS = {
  home: '<path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  ask: '<path d="M4 4h16v12H8l-4 4z"/>',
  chart: '<path d="M4 20V10m6 10V4m6 16v-7m4 7H2"/>',
  phone: '<path d="M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2z"/>',
};
const icon = (n) => raw(`<svg class="c-tabbar__ic" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n]}</svg>`);

export function layout(ctx, { title, description, body, jsonLd = [], noindex = false, bodyClass = '', scripts = [], item = null, canonicalPath = null, hideTranslationBar = false }) {
  const { site, lang, url, t } = ctx;
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
    ld.push({ '@context': 'https://schema.org', '@type': 'WebSite', name: t('site.name'), url: `${origin}${langDef?.path ?? ''}/`, inLanguage: lang, potentialAction: { '@type': 'SearchAction', target: { '@type': 'EntryPoint', urlTemplate: `${config.siteUrl}${url('/ask/')}?q={search_term_string}` }, 'query-input': 'required name=search_term_string' } });
    try { ld.push(orgJsonLd(ctx)); } catch { /* jsonld.mjs 尚無 orgJsonLd */ }
  }
  const wide = /\bpage-wide\b|\bpage-home\b/.test(bodyClass);
  const navItems = [
    ['/diseases/', 'nav.diseases'], ['/vaccines/', 'nav.vaccines'], ['/travel/', 'nav.travel'], ['/situation/', 'nav.situation'],
    ['/factcheck/', 'nav.factcheck'], ['/data/', 'nav.data'], ['/news/', 'nav.news'], ['/faq/', 'nav.faq'],
  ];
  const langLinks = config.langs.map((L) => {
    const same = alts.includes(L.code);
    return html`<a href="${config.basePath}${L.path}${same ? path : '/'}" data-lang-path="${L.path}" data-same="${same ? '1' : '0'}" hreflang="${L.code}" lang="${L.code}" ${L.code === lang ? raw('aria-current="true"') : ''}>${L.label}</a>`;
  });
  return html`<!doctype html>
<html lang="${lang}" dir="${langDef?.dir ?? 'ltr'}" data-base="${config.basePath}" data-lang-path="${langDef?.path ?? ''}" data-view="public">
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
${noindex ? raw('<meta name="robots" content="noindex">') : ''}
<meta property="og:title" content="${fullTitle}"><meta property="og:description" content="${description ?? ''}"><meta property="og:type" content="website"><meta property="og:site_name" content="${t('site.name')}"><meta property="og:url" content="${canonical}"><meta property="og:locale" content="${lang.replace('-', '_')}">
<script>${raw(EARLY_JS)}</script>
<link rel="stylesheet" href="${url('/assets/styles/tokens.css', { noLang: true })}">
<link rel="stylesheet" href="${url('/assets/styles/base.css', { noLang: true })}">
<link rel="stylesheet" href="${url('/assets/styles/components.css', { noLang: true })}">
${ld.map((j) => raw(`<script type="application/ld+json">${jsonScript(j)}</script>`))}
</head>
<body class="${bodyClass}">
<a class="skip-link" href="#main">${t('skip')}</a>
<div class="topbar"><div class="wrap topbar__in">
  <nav class="langs" aria-label="${t('lang.label')}">${langLinks}</nav>
  <div class="topbar__links"><a href="${url('/accessibility/')}">${t('a11y')}</a><a href="${url('/sitemap-page/')}">${t('sitemap')}</a><a class="hotline" href="tel:1922">${t('hotline')}</a></div>
</div></div>
<header class="site-header"><div class="wrap site-header__in">
  <a class="brand" href="${url('/')}"><span class="brand__mark" aria-hidden="true"><svg viewBox="0 0 32 32" width="40" height="40"><rect width="32" height="32" rx="8" fill="currentColor"/><path d="M14 7h4v7h7v4h-7v7h-4v-7H7v-4h7z" fill="#fff"/></svg></span><span class="brand__text"><span class="brand__name">${t('site.name')}</span><span class="brand__sub">${lang === 'zh-TW' ? config.nameEn : t('site.parent')}</span></span></a>
  <div class="audience" role="group" aria-label="${t('nav.audience')}">
    <button type="button" class="audience__btn" data-view-set="public" aria-pressed="true">${t('nav.public')}</button>
    <a class="audience__btn" href="${url('/pro/')}?view=pro" data-view-set="pro" aria-pressed="false">${t('nav.pro')}</a>
    <a class="audience__btn" href="${url('/developers/')}">${t('nav.research')}</a>
  </div>
  <button type="button" class="c-nav__toggle" aria-expanded="false" aria-controls="main-nav">${t('nav.menu')}</button>
</div>
<nav id="main-nav" class="c-nav" aria-label="${t('nav.main')}"><div class="wrap c-nav__in">${navItems.map(([p, k]) => html`<a href="${url(p)}" ${path.startsWith(p) ? raw('aria-current="page"') : ''}>${t(k)}</a>`)}<a class="c-nav__pro c-pro-only" href="${url('/pro/')}">${t('nav.pro')}</a></div></nav>
</header>
${pausedBanner(ctx)}
<main id="main"${wide ? '' : raw(' class="wrap"')}>${raw(String(body))}</main>
${translationBar(ctx, item, hideTranslationBar)}
<footer class="site-footer"><div class="wrap site-footer__in">
  <nav aria-label="${t('footer.nav')}" class="site-footer__links"><a href="${url('/about/')}">${t('footer.about')}</a><a href="${url('/policy/privacy/')}">${t('footer.privacy')}</a><a href="${url('/policy/ai/')}">${t('footer.ai')}</a><a href="${url('/policy/open-data/')}">${t('footer.license')}</a><a href="${url('/developers/')}">${t('footer.api')}</a><a href="${url('/accessibility/')}">${t('footer.a11y')}</a></nav>
  <p class="site-footer__hot"><a href="tel:1922">1922</a> · <a href="tel:0800001922">0800-001922</a></p>
  <p class="site-footer__more"><a href="${url('/transparency/')}">${t('footer.transparency')}</a><a href="${url('/guide/')}">${t('footer.guide')}</a><a href="${url('/sitemap-page/')}">${t('sitemap')}</a><a href="${url('/admin/', { noLang: true })}">${t('footer.admin')}</a></p>
  <p class="site-footer__meta">${t('footer.proto', { date: site.today })}</p>
</div></footer>
<nav class="c-tabbar" aria-label="${t('nav.quick')}">
  <a href="${url('/')}" ${isHome ? raw('aria-current="page"') : ''}>${icon('home')}<span>${t('tab.home')}</span></a>
  <a href="${url('/ask/')}" ${path.startsWith('/ask/') ? raw('aria-current="page"') : ''}>${icon('ask')}<span>${t('tab.ask')}</span></a>
  <a href="${url('/situation/')}" ${path.startsWith('/situation/') ? raw('aria-current="page"') : ''}>${icon('chart')}<span>${t('tab.situation')}</span></a>
  <a href="tel:1922">${icon('phone')}<span>1922</span></a>
</nav>
<script type="module" src="${url('/assets/js/ui.js', { noLang: true })}"></script>
${scripts.map((s) => html`<script type="module" src="${url(s, { noLang: true })}"></script>`)}
</body>
</html>`;
}
