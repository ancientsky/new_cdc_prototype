// 詞彙表 /glossary/（第二十五輪，Issue #38）：content/master/glossary.json 的公開版。
// 中文正名／English／說明，依英文字母分組；別名與舊稱（deprecated）也可被搜尋。
// 沒有 JS 時是完整清單；有 JS 時（src/client/glossary.js）才出現篩選框，輸入即時過濾並隱藏沒有符合項目的字母群。
import { html, raw } from '../../../scripts/lib/render.mjs';
import { ldFor, pageHead, diseasePage, hrefFor, L } from './_partials.mjs';
import { glossaryTermInfo } from '../../client/glossary-term.js';

export function pages() { return [{ path: '/glossary/', lang: '*', props: {} }]; }

export function meta(ctx) {
  return { title: ctx.t('glossary.title'), description: ctx.t('glossary.desc'), scripts: ['/assets/js/glossary.js'], pagefind: { type: 'glossary', audience: ['public', 'professional'] }, jsonLd: ldFor(ctx, null, [{ label: ctx.t('glossary.title') }]) };
}

/** 英文首字母分組：A–Z；數字、符號與沒有英文名者歸「#」 */
export function groupKey(g) {
  const c = String(g.en ?? g['zh-TW'] ?? '').trim().charAt(0).toUpperCase();
  return /[A-Z]/.test(c) ? c : '#';
}
export const sortKey = (g) => String(g.en ?? g['zh-TW']).toLowerCase();

export function groupGlossary(list) {
  const groups = new Map();
  for (const g of [...list].sort((a, b) => sortKey(a).localeCompare(sortKey(b), 'en'))) {
    const k = groupKey(g);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(g);
  }
  return [...groups.entries()].sort(([a], [b]) => (a === '#' ? 1 : b === '#' ? -1 : a.localeCompare(b)));
}

export function render(ctx) {
  const { site, t, url } = ctx;
  const list = site.master.glossary ?? [];
  const groups = groupGlossary(list);
  const DOMAIN = { disease: t('glossary.domain.disease'), vaccine: t('glossary.domain.vaccine'), org: t('glossary.domain.org'), procedure: t('glossary.domain.procedure'), place: t('glossary.domain.place'), general: t('glossary.domain.general') };
  const related = (g) => (g.refs ?? []).map((r) => { const d = String(r).startsWith('disease.') ? diseasePage(ctx, r) : null; return d ? html`<a href="${hrefFor(ctx, d)}">${L(ctx, d, 'title')}</a>` : ''; }).filter(Boolean);
  const zh = ctx.lang === 'zh-TW';
  const entry = (g) => {
    // 第四十輪（#72）：外語頁多列「本語言譯名」（走 glossaryTermInfo：id → id_、缺譯退英文；機器翻譯初稿加標記）
    const loc = !zh && ctx.lang !== 'en' ? glossaryTermInfo(g, ctx.lang) : null;
    const locShow = loc && loc.lang === ctx.lang && loc.text !== g.en;
    const names = [g['zh-TW'], g.en, locShow ? loc.text : null, ...(g.aliases ?? []), ...(g.deprecated ?? [])].filter(Boolean).join(' ').toLowerCase();
    const rel = related(g);
    // 定義、別名、舊名都是中文：外語頁標 lang="zh-TW"（誠實標示，螢幕閱讀器切中文語音；也不算「夾雜」）
    const zhAttr = zh ? '' : raw(' lang="zh-TW"');
    return html`<div class="c-glossary__row" data-q="${names}">
      <dt id="${g.id}"><span class="c-glossary__zh" lang="zh-TW">${g['zh-TW']}</span>${g.en ? html` <span class="c-glossary__en" lang="en">${g.en}</span>` : ''}${locShow ? html` <span class="c-glossary__loc" lang="${ctx.lang}">${loc.text}</span>${loc.machine ? html` <span class="c-tag">${t('i18n.machine.short')}</span>` : ''}` : ''}${g.locked ? html` <span class="c-tag">${t('glossary.locked')}</span>` : ''}</dt>
      <dd>${g.definition || g.note ? html`<p${zhAttr}>${g.definition ?? g.note}</p>` : ''}
        ${(g.aliases ?? []).length ? html`<p class="muted">${t('glossary.aliases')}：<span${zhAttr}>${g.aliases.join('、')}</span></p>` : ''}
        ${(g.deprecated ?? []).length ? html`<p class="muted">${t('glossary.deprecated')}：<span${zhAttr}>${g.deprecated.join('、')}</span></p>` : ''}
        <p class="muted">${DOMAIN[g.domain] ?? ''}${rel.length ? html` · ${rel}` : ''}</p></dd>
    </div>`;
  };
  return html`${pageHead(ctx, { trail: [{ label: t('glossary.title') }], h1: t('glossary.title'), lead: t('glossary.lead', { n: list.length }) })}
<div class="c-glossary">
  <form class="c-glossary__filter" data-glossary-filter role="search" hidden>
    <label for="glossary-q">${t('glossary.filter')}</label>
    <input type="search" id="glossary-q" autocomplete="off" placeholder="${t('glossary.filter.ph')}">
    <p class="muted" role="status" aria-live="polite" data-glossary-count></p>
  </form>
  <nav class="c-glossary__az" aria-label="${t('glossary.az')}"><ul class="c-linklist c-linklist--inline">${groups.map(([k]) => html`<li><a href="#g-${k === '#' ? 'num' : k}">${k}</a></li>`)}</ul></nav>
  ${groups.map(([k, items]) => html`<section class="c-glossary__group" data-glossary-group aria-labelledby="gh-${k === '#' ? 'num' : k}">
    <h2 id="g-${k === '#' ? 'num' : k}"><span id="gh-${k === '#' ? 'num' : k}">${k}</span></h2>
    <dl class="c-glossary__list">${items.map(entry)}</dl></section>`)}
  <p class="c-empty" data-glossary-empty hidden>${t('glossary.empty')}</p>
  <p class="muted">${t('glossary.source')} <a href="${url('/v1/glossary.json', { noLang: true })}">v1/glossary.json</a></p>
</div>`;
}
void raw;
