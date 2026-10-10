// 全文搜尋頁 /search/（第二十八輪，Issue #38）：Pagefind 靜態全文索引的前端。
// 與 /ask/（智慧查詢）分工：/ask/ 給「整理好、附來源的一句答案」，/search/ 給「在所有頁面文字裡找關鍵字、可篩選、可依日期排序」。
// 版面骨架由伺服器端輸出（表單、篩選容器、狀態列、結果清單），src/client/search.js 才動態載入 Pagefind 並填入選項與結果。
// 篩選選項由 Pagefind 索引決定（只列該語言索引內真的有的值），所以這裡只輸出空的容器；單位代碼 → 顯示名稱的對照放 data-units。
import { html } from '../../../scripts/lib/render.mjs';
import { ldFor, pageHead, unitName } from './_partials.mjs';

export function pages() { return [{ path: '/search/', lang: '*', props: {}, noindex: true }]; }

export function meta(ctx) {
  return {
    title: ctx.t('search.title'), description: ctx.t('search.desc'), noindex: true, bodyClass: 'page-search',
    styles: ['/assets/styles/search.css'], scripts: ['/assets/js/search.js'],
    jsonLd: ldFor(ctx, null, [{ label: ctx.t('search.title') }]),
  };
}

export function render(ctx) {
  const { site, t, url, lang } = ctx;
  const units = Object.fromEntries((site.master.units ?? []).map((u) => [u.id, unitName(ctx, u.id)]));
  const note = lang === 'zh-TW' ? '' : html`<p class="muted c-search__langnote">${t('search.lang.note')} <a href="${url('/search/', { noLang: true })}" data-search-zh hreflang="zh-TW" lang="zh-TW">${t('search.lang.zh')}</a></p>`;
  return html`${pageHead(ctx, { trail: [{ label: t('search.title') }], h1: t('search.title'), lead: t('search.lead') })}
<div class="c-search" data-search data-units="${JSON.stringify(units)}">
  <form class="c-search__form" id="search-form" action="${url('/search/')}" method="get" role="search" aria-label="${t('search.title')}">
    <label class="c-search__label" for="search-q">${t('search.label')}</label>
    <div class="c-search__row">
      <input class="c-input c-search__q" id="search-q" name="q" type="search" autocomplete="off" enterkeyhint="search" placeholder="${t('search.ph')}">
      <button type="submit" class="c-btn c-search__go">${t('search.submit')}</button>
    </div>
    <details class="c-search__adv" id="search-adv">
      <summary>${t('search.filters')}</summary>
      <div class="c-search__filters">
        <fieldset class="c-search__fs" data-filter="type" hidden><legend>${t('search.f.type')}</legend><div class="c-search__opts" data-options></div></fieldset>
        <fieldset class="c-search__fs" data-filter="audience" hidden><legend>${t('search.f.audience')}</legend><div class="c-search__opts" data-options></div></fieldset>
        <div class="c-search__sel" data-filter-select="unit" hidden><label for="search-unit">${t('search.f.unit')}</label><select class="c-input" id="search-unit" name="unit"></select></div>
        <div class="c-search__sel" data-filter-select="year" hidden><label for="search-year">${t('search.f.year')}</label><select class="c-input" id="search-year" name="year"></select></div>
        <p class="c-search__current"><label><input type="checkbox" id="search-current" name="current" value="1"> ${t('search.f.current')}</label></p>
        <div class="c-search__sel"><label for="search-sort">${t('search.sort')}</label>
          <select class="c-input" id="search-sort" name="sort"><option value="">${t('search.sort.rel')}</option><option value="new">${t('search.sort.new')}</option><option value="old">${t('search.sort.old')}</option></select></div>
        <p class="c-search__clear"><button type="button" class="c-btn c-btn--ghost c-btn--sm" id="search-clear">${t('search.f.clear')}</button></p>
      </div>
    </details>
  </form>
  ${note}
  <p class="c-search__status" id="search-status" role="status" aria-live="polite">${t('search.status.idle')}</p>
  <noscript><p class="c-alert c-alert--overdue">${t('search.noscript')} <a href="${url('/diseases/')}">${t('nav.diseases')}</a> · <a href="${url('/sitemap-page/')}">${t('sitemap')}</a> · <a href="tel:1922">1922</a></p></noscript>
  <section aria-labelledby="search-results-h">
    <h2 class="sr-only" id="search-results-h">${t('search.results')}</h2>
    <ol class="c-search__results" id="search-results"></ol>
    <p class="c-search__morewrap"><button type="button" class="c-btn c-btn--ghost" id="search-more" hidden>${t('search.more')}</button></p>
    <div class="c-search__empty" id="search-empty" hidden>
      <p>${t('search.empty.tips')}</p>
      <p><a class="c-btn c-btn--ghost" href="${url('/ask/')}" data-search-ask>${t('search.empty.ask')}</a> <a class="c-btn c-btn--ghost" href="tel:1922">${t('hotline')}</a></p>
    </div>
  </section>
</div>`;
}
