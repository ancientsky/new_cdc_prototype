// 共用版面（骨架版；Agent C 補完 header/footer 細節、三層露出、語言切換、身分切換、Banner 暫停橫幅）
import { html, raw, jsonScript } from '../../scripts/lib/render.mjs';
import { config } from '../../site.config.mjs';

export function layout(ctx, { title, description, body, jsonLd = [], noindex = false, bodyClass = '', scripts = [], item = null }) {
  const { site, lang, url, t } = ctx;
  const langDef = config.langs.find((l) => l.code === lang);
  const fullTitle = title ? `${title} · ${t('site.short')}` : t('site.name');
  const alternates = (ctx.alternates ?? ['zh-TW']).map((code) => {
    const L = config.langs.find((l) => l.code === code);
    return html`<link rel="alternate" hreflang="${code}" href="${config.siteUrl}${config.basePath}${L.path}${ctx.path ?? '/'}">`;
  });
  const paused = site.gov.pausedAI;
  return html`<!doctype html>
<html lang="${lang}" dir="${langDef?.dir ?? 'ltr'}" data-base="${config.basePath}" data-lang-path="${langDef?.path ?? ''}" data-view="public">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${fullTitle}</title>
<meta name="description" content="${description ?? ''}">
<link rel="canonical" href="${config.siteUrl}${url(ctx.path ?? '/')}">
${alternates}
<link rel="alternate" hreflang="x-default" href="${config.siteUrl}${config.basePath}${ctx.path ?? '/'}">
${noindex ? raw('<meta name="robots" content="noindex">') : ''}
<meta property="og:title" content="${fullTitle}"><meta property="og:description" content="${description ?? ''}"><meta property="og:type" content="website"><meta property="og:site_name" content="${t('site.name')}">
<link rel="stylesheet" href="${url('/assets/styles/tokens.css', { noLang: true })}">
<link rel="stylesheet" href="${url('/assets/styles/base.css', { noLang: true })}">
<link rel="stylesheet" href="${url('/assets/styles/components.css', { noLang: true })}">
${jsonLd.map((j) => raw(`<script type="application/ld+json">${jsonScript(j)}</script>`))}
</head>
<body class="${bodyClass}">
<a class="skip-link" href="#main">${t('skip')}</a>
<div class="topbar"><div class="wrap topbar__in">
  <nav class="langs" aria-label="語言">${config.langs.map((L) => html`<a href="${config.basePath}${L.path}${ctx.path && ctx.alternates?.includes(L.code) ? ctx.path : '/'}" ${L.code === lang ? raw('aria-current="true"') : ''} lang="${L.code}">${L.label}</a>`)}</nav>
  <div class="topbar__links"><a href="${url('/accessibility/')}">${t('a11y')}</a><a href="${url('/sitemap-page/')}">${t('sitemap')}</a><a class="hotline" href="tel:1922">${t('hotline')}</a></div>
</div></div>
<header class="site-header"><div class="wrap site-header__in">
  <a class="brand" href="${url('/')}"><span class="brand__mark" aria-hidden="true"></span><span class="brand__name">${t('site.name')}</span></a>
  <div class="audience" role="group" aria-label="身分">
    <button type="button" class="audience__btn" data-view="public" aria-pressed="true">${t('nav.public')}</button>
    <a class="audience__btn" href="${url('/pro/')}" data-view="pro">${t('nav.pro')}</a>
    <a class="audience__btn" href="${url('/data/')}">${t('nav.research')}</a>
  </div>
</div></header>
${paused ? html`<div class="c-banner--paused" role="status"><div class="wrap">${t('alert.paused')} <a href="${url('/policy/ai/')}">說明</a></div></div>` : ''}
<main id="main" class="wrap">${raw(String(body))}</main>
<footer class="site-footer"><div class="wrap site-footer__in">
  <nav aria-label="footer"><a href="${url('/about/')}">${t('footer.about')}</a><a href="${url('/policy/privacy/')}">${t('footer.privacy')}</a><a href="${url('/policy/ai/')}">${t('footer.ai')}</a><a href="${url('/policy/open-data/')}">${t('footer.license')}</a><a href="${url('/developers/')}">${t('footer.api')}</a><a href="${url('/accessibility/')}">${t('footer.a11y')}</a><a href="${url('/guide/')}">使用說明</a><a href="${url('/admin/', { noLang: true })}">內容管理後台（示範）</a></nav>
  <div class="site-footer__meta">1922 · 0800-001922 · 原型建置日 ${site.today}</div>
</div></footer>
<script type="module" src="${url('/assets/js/ui.js', { noLang: true })}"></script>
${scripts.map((s) => html`<script type="module" src="${url(s, { noLang: true })}"></script>`)}
</body>
</html>`;
}
