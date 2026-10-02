// 國際合作區塊共用元件（第六輪 W2；ARCHITECTURE §14.4）。底線開頭，不會被當成頁面。
// - 同系列子頁導覽 seriesNav／seriesPager：/international/ 底下 6 個 page 型子頁共用，依 topic.sections（沒有則 contentIds，再沒有則固定順序）帶出
// - 語言權威性提示 authorityNote：內容的來源語言（sourceLang）不是中文時，說明「本頁以英文為準，中文為譯文」；
//   即既有「譯文狀態列」的反向用法（來源語言頁不顯示「已審核譯文」，改顯示「以本語言為準」）
// 對 W1 的資料一律容錯：topic／頁面不存在就回傳空字串。
import { html, raw } from '../../../scripts/lib/render.mjs';
import { config } from '../../../site.config.mjs';
import { L, langOk, translationBadge } from './_partials.mjs';

export const INTL_TOPIC_ID = 'topic.international-cooperation';
/** 預設順序（也是沒有 topic.sections 時的順序） */
export const INTL_KEYS = ['ihr-focal-point', 'multilateral', 'bilateral', 'training', 'global-health-security', 'publications-en'];
const PREFIX = /^page\.international-/;

export const isIntlPage = (item) => item?.type === 'page' && PREFIX.test(String(item.id ?? ''));
export const intlKeyOf = (item) => String(item.id).replace(PREFIX, '');

export function intlTopic(site) {
  const tp = site?.byId?.get(INTL_TOPIC_ID);
  return tp && tp.status === 'published' ? tp : null;
}

/** topic.sections 可能是 id 字串、{ id|ref|page|contentId|target } 物件；容錯取出 id 列表 */
function sectionIds(tp) {
  const out = [];
  for (const s of [...(Array.isArray(tp?.sections) ? tp.sections : []), ...(tp?.contentIds ?? [])]) {
    const id = typeof s === 'string' ? s : (s?.page ?? s?.ref ?? s?.id ?? s?.contentId ?? s?.target ?? null);
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

/** 已發布的 6 個子頁（依 topic.sections 順序，其餘依預設順序補上） */
export function intlSubPages(site) {
  const pages = (site?.collections?.pages ?? []).filter((p) => isIntlPage(p) && p.status === 'published');
  if (!pages.length) return [];
  const tp = intlTopic(site);
  const order = sectionIds(tp);
  const rank = (p) => {
    const i = order.indexOf(p.id);
    const j = INTL_KEYS.indexOf(intlKeyOf(p));
    return i >= 0 ? i : 1000 + (j >= 0 ? j : 99);
  };
  return [...pages].sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id));
}

/** 子頁網址：slug 含 / 走 /{slug}/（與 page.mjs 的 standalonePath 同規則），否則 /international/{key}/ */
export function intlSubPath(item) {
  const slug = String(item.slug ?? '');
  return slug.includes('/') ? `/${slug.replace(/^\/+|\/+$/g, '')}/` : `/international/${intlKeyOf(item)}/`;
}

const hrefOf = (ctx, p) => (langOk(ctx.site, p, ctx.lang) ? ctx.url(intlSubPath(p)) : ctx.url(intlSubPath(p), { noLang: true }));

/** 同系列子頁導覽（水平 chip）。current＝目前的 page 項；hub＝true 時「總覽」標為目前頁 */
export function seriesNav(ctx, current, { hub = false } = {}) {
  const { site, t } = ctx;
  const subs = intlSubPages(site);
  const tp = intlTopic(site);
  if (!subs.length || !tp) return '';
  const hubLabel = L(ctx, tp, 'title') ?? t('international.title');
  return html`<nav class="c-seriesnav" aria-label="${t('series.nav')}">
  <p class="c-seriesnav__t">${t('series.nav')}</p>
  <ul class="c-seriesnav__list">
    <li><a href="${ctx.url('/international/')}"${hub ? raw(' aria-current="page"') : ''}>${hubLabel} <span class="muted">· ${t('series.overview')}</span></a></li>
    ${subs.map((p) => html`<li><a href="${hrefOf(ctx, p)}"${current?.id === p.id ? raw(' aria-current="page"') : ''}>${L(ctx, p, 'title')}</a></li>`)}
  </ul>
</nav>`;
}

/** 上一頁／下一頁（總覽 → 子頁 1 → … → 子頁 6） */
export function seriesPager(ctx, current) {
  const { site, t } = ctx;
  const subs = intlSubPages(site);
  const tp = intlTopic(site);
  const i = subs.findIndex((p) => p.id === current?.id);
  if (i < 0 || !tp) return '';
  const prev = i > 0 ? { href: hrefOf(ctx, subs[i - 1]), label: L(ctx, subs[i - 1], 'title') } : { href: ctx.url('/international/'), label: L(ctx, tp, 'title') ?? t('international.title') };
  const next = i < subs.length - 1 ? { href: hrefOf(ctx, subs[i + 1]), label: L(ctx, subs[i + 1], 'title') } : null;
  return html`<nav class="c-pager" aria-label="${t('series.nav')}">
  <a class="c-pager__a c-pager__a--prev" href="${prev.href}" rel="prev"><span class="c-pager__k">← ${t('series.prev')}</span><span class="c-pager__v">${prev.label}</span></a>
  ${next ? html`<a class="c-pager__a c-pager__a--next" href="${next.href}" rel="next"><span class="c-pager__k">${t('series.next')} →</span><span class="c-pager__v">${next.label}</span></a>` : ''}
</nav>`;
}

const langName = (ctx, code) => ctx.t(`langname.${code}`);
const hrefInLang = (ctx, code) => {
  const def = config.langs.find((l) => l.code === code);
  return `${config.basePath}${def?.path ?? ''}${ctx.path ?? '/'}`;
};

/**
 * 語言權威性提示。item.sourceLang 缺或為 zh-TW ⇒ 不輸出（照既有譯文狀態列的邏輯）。
 * - 在來源語言頁：「English is the authoritative version of this page.」＋連到中文譯文
 * - 在其他語言頁：「本頁以英文為準，中文為譯文。」＋譯文審核狀態＋連到英文正本
 */
export function authorityNote(ctx, item) {
  const src = item?.sourceLang;
  if (!src || src === 'zh-TW') return '';
  const { lang, t } = ctx;
  const alts = ctx.alternates ?? [];
  if (lang === src) {
    const zh = alts.includes('zh-TW');
    return html`<p class="c-authority c-authority--source" role="note" aria-label="${t('authority.label')}"><span class="c-translation-badge c-translation-badge--source">${t('authority.badge')}</span> <span class="c-authority__t">${t('authority.source', { lang: langName(ctx, src) })}</span>${zh ? html` <a href="${hrefInLang(ctx, 'zh-TW')}" hreflang="zh-TW" lang="zh-TW">${t('authority.translation', { lang: langName(ctx, 'zh-TW') })}</a>` : ''}</p>`;
  }
  const st = item.languages?.[lang]?.status;
  return html`<p class="c-authority c-authority--translated" role="note" aria-label="${t('authority.label')}"><span class="c-authority__t">${t('authority.translated', { src: langName(ctx, src), cur: langName(ctx, lang) })}</span>${st === 'reviewed' || st === 'machine' ? html` ${translationBadge(ctx, st)}` : ''}${alts.includes(src) ? html` <a href="${hrefInLang(ctx, src)}" hreflang="${src}" lang="${src}">${t('authority.view', { lang: langName(ctx, src) })}</a>` : ''}</p>`;
}
