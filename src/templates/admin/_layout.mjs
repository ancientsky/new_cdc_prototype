// 後台專用版面（Agent E）：深綠頂欄「內容管理後台」＋導覽＋示範身分切換。全部 noindex。
import { html, raw } from '../../../scripts/lib/render.mjs';
import { config } from '../../../site.config.mjs';
import { NAV, counts, DEFAULT_UNIT } from './_partials.mjs';

export function layout(ctx, { title, description, body, scripts = [], adminKey = '', bodyClass = '' }) {
  const { site, url } = ctx;
  const c = counts(site);
  const unitName = site.unitById.get(DEFAULT_UNIT)?.name ?? '急性傳染病組';
  const isLogin = adminKey === 'login';
  return html`<!doctype html>
<html lang="zh-TW" dir="ltr" data-base="${config.basePath}" data-lang-path="" data-view="admin">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title || '內容管理後台'}</title>
<meta name="description" content="${description ?? ''}">
<meta name="robots" content="noindex,nofollow">
<link rel="icon" href="data:,">
<link rel="stylesheet" href="${url('/assets/styles/tokens.css', { noLang: true })}">
<link rel="stylesheet" href="${url('/assets/styles/base.css', { noLang: true })}">
<link rel="stylesheet" href="${url('/assets/styles/components.css', { noLang: true })}">
<link rel="stylesheet" href="${url('/assets/styles/admin.css', { noLang: true })}">
</head>
<body class="adm ${bodyClass}" data-today="${site.today}" data-admin-page="${adminKey}">
<a class="skip-link" href="#main">跳到主要內容</a>
<header class="adm-top"><div class="adm-top__in">
  <a class="adm-brand" href="${url('/admin/', { noLang: true })}"><strong>內容管理後台</strong><span>疾管署 AI-ready 新官網原型 · 示範</span></a>
  <div class="adm-who" id="adm-who">
    <span class="adm-who__id"><span class="adm-who__name" id="adm-who-name">${isLogin ? '尚未登入' : `${unitName} · 承辦人`}</span><span class="adm-who__role" id="adm-who-role"></span></span>
    ${isLogin ? '' : html`<label for="adm-unit"><span class="adm-who__lbl">單位視角</span>
      <select id="adm-unit" aria-describedby="adm-who-name">${site.master.units.filter((u) => u.publishes !== false).map((u) => html`<option value="${u.id}" ${u.id === DEFAULT_UNIT ? raw('selected') : ''}>${u.name}</option>`)}<option value="all">全部單位（總覽）</option></select>
    </label>
    <button type="button" class="adm-who__logout" id="adm-logout">登出</button>`}
  </div>
</div></header>
${isLogin ? '' : html`<nav class="adm-nav" aria-label="後台導覽"><ul>${NAV.map((n) => html`<li><a href="${url(n.href, { noLang: true })}" ${n.key === adminKey ? raw('aria-current="page"') : ''}>${n.label}${n.count && (c[n.count] > 0 || ['review', 'due', 'todos'].includes(n.count)) ? html`<span class="adm-count" data-count="${n.count}" aria-label="${c[n.count]} 項">${c[n.count]}</span>` : ''}</a></li>`)}</ul></nav>`}
<div class="adm-demo" role="note">示範原型：此後台不連接任何正式系統；登入與所有操作只存在你的瀏覽器（localStorage），正式環境以機關 SSO 登入、一律走 Git Pull Request。</div>
<main id="main" class="adm-main" tabindex="-1">${raw(String(body))}</main>
<footer class="adm-foot"><a href="${url('/', { noLang: true })}">回前台首頁</a><a href="${url('/v1/catalog.json', { noLang: true })}">目錄 API（/v1/catalog.json）</a><a href="${url('/guide/', { noLang: true })}">使用說明</a><span>建置日 ${site.today}</span></footer>
<script type="module" src="${url('/assets/js/admin/common.js', { noLang: true })}"></script>
${scripts.map((s) => html`<script type="module" src="${url(s, { noLang: true })}"></script>`)}
</body>
</html>`;
}
