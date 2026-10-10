// 疫情報導（第二十九輪，ARCHITECTURE §34）：卷期頁與文章頁共用的片段。說明與理由見 docs/bulletin.md。
//
// 設計參考美國 CDC 的 MMWR：文章是閱讀單位，不是整本 PDF——
//   1. 每篇文章有自己的網址、全文 HTML、作者與單位、頁碼、引用格式；PDF 是「另存」而不是「唯一入口」。
//   2. 文章頁頂端先給摘要框與「重點」三句（已知／本文新增／對防疫實務的意義，仿 MMWR summary box），讀者 30 秒內知道要不要往下讀。
//   3. 正文直接攤開（前言、方法、結果、討論…），右側黏住的目錄跟著捲動；圖表有編號、說明與文字版（表格直接是 HTML 表格，可被搜尋與朗讀）。
//   4. 卷期頁是「本期目錄」：每篇的篇名、作者、摘要一句、全文與 PDF 連結；舊的只有書目的篇目照舊列出，標「僅書目」。
// 為什麼不沿用 _longdoc.mjs 的收合版面：期刊文章是 4～6 段、一次讀完的文件，收合反而多一次點擊；長文件版面是給上百頁的指引用的。
import { html, raw } from '../../../scripts/lib/render.mjs';
import { md } from '../../../scripts/lib/markdown.mjs';
import { assetUrl } from '../../../scripts/lib/assets.mjs';
import { articlesOfIssue, issueToc, citationOf, citationEnOf, ARTICLE_TYPES, ARTICLE_TYPES_EN } from '../../client/bulletin-rules.js';
import { L, hrefFor, isFallbackLink, pill, imgSrc } from './_partials.mjs';

export { articlesOfIssue, issueToc, citationOf, citationEnOf };

/** 文章所屬卷期（找不到＝null） */
export const issueOf = (site, a) => site.byId.get(a.issueId) ?? null;
/** 「第 42 卷第 13 期」 */
export const volIssueLabel = (ctx, issue) => (issue ? ctx.t('teb.volissue', { v: issue.volume ?? '—', n: issue.issue ?? '—' }) : '');
export const articleTypeLabel = (ctx, type) => (ctx.lang === 'zh-TW' ? ARTICLE_TYPES[type] : ARTICLE_TYPES_EN[type]) ?? ARTICLE_TYPES[type] ?? type ?? '';
/** PDF 連結：單篇優先，其次本期 */
export const pdfHref = (ctx, a, issue) => { const u = a.pdfUrl || issue?.pdfUrl; return u ? (/^https?:/.test(u) ? u : ctx.url(u, { noLang: true })) : null; };

/** 作者列：姓名（單位），通訊作者加星號 */
export function authorsHtml(ctx, a) {
  const { t } = ctx;
  return html`<p class="c-teb__authors"><span class="sr-only">${t('teb.authors')}：</span>${(a.authors ?? []).map((x, i) => html`<span class="c-teb__author">${x.name}${x.unit ? html`<span class="c-teb__unit">（${x.unit}）</span>` : ''}${x.corresponding ? html`<abbr class="c-teb__corr" title="${t('teb.corresponding')}">＊</abbr>` : ''}</span>${i < a.authors.length - 1 ? html`<span class="c-teb__sep" aria-hidden="true">、</span>` : ''}`)}</p>
  ${(a.authors ?? []).some((x) => x.corresponding) ? html`<p class="c-teb__corrnote muted">＊${t('teb.corresponding')}</p>` : ''}`;
}

/** 摘要框與重點三句 */
export function abstractHtml(ctx, a) {
  const { t } = ctx;
  const h = a.highlights;
  return html`${a.abstractMarkdown ? html`<section class="c-teb__abstract" id="abstract" aria-labelledby="abs-h"><h2 id="abs-h">${t('teb.abstract')}</h2><div class="c-prose">${raw(md(a.abstractMarkdown))}</div></section>` : ''}
${h && (h.known || h.added || h.implications) ? html`<aside class="c-teb__box" id="highlights" aria-labelledby="hl-h"><h2 id="hl-h">${t('teb.highlights')}</h2><dl>
  ${h.known ? html`<div><dt>${t('teb.known')}</dt><dd>${h.known}</dd></div>` : ''}
  ${h.added ? html`<div><dt>${t('teb.added')}</dt><dd>${h.added}</dd></div>` : ''}
  ${h.implications ? html`<div><dt>${t('teb.implications')}</dt><dd>${h.implications}</dd></div>` : ''}
</dl></aside>` : ''}`;
}

const figLabel = (ctx, f) => ctx.t(f.kind === 'table' ? 'teb.table' : 'teb.figure', { n: f.no });
const figId = (f) => `${f.kind}-${f.no}`;
/** 一個圖或表：編號＋說明；有圖檔就放圖（文字版收合），表格或沒有圖檔就直接渲染 Markdown（HTML 表格可搜尋、可朗讀） */
export function figureHtml(ctx, a, f) {
  const { t } = ctx;
  const src = f.file ? imgSrc(ctx, assetUrl(a, f.file)) : null;
  const body = f.markdown ? html`<div class="c-prose c-teb__figbody">${raw(md(f.markdown))}</div>` : '';
  return html`<figure class="c-teb__fig c-teb__fig--${f.kind}" id="${figId(f)}">
  <figcaption><strong>${figLabel(ctx, f)}</strong> ${f.caption}</figcaption>
  ${src ? html`<img src="${src}" alt="${f.alt ?? ''}" loading="lazy">${body ? html`<details class="c-teb__textver"><summary>${t('teb.textver')}</summary>${body}</details>` : ''}` : body || (f.alt ? html`<p class="c-teb__figalt muted">${f.alt}</p>` : '')}
</figure>`;
}

/** 每個圖表放在「第一次提到它」的段落之後；沒被提到的放在最後一段之後 */
export function placeFigures(a) {
  const secs = a.sections ?? [];
  const placed = new Map(); // section key → figures[]
  const rest = [];
  for (const f of a.figures ?? []) {
    const re = new RegExp(`${f.kind === 'table' ? '表' : '圖'}\\s*${f.no}(?!\\d)`);
    const hit = secs.find((s) => re.test(s.markdown ?? ''));
    if (hit) { if (!placed.has(hit.key)) placed.set(hit.key, []); placed.get(hit.key).push(f); } else rest.push(f);
  }
  return { placed, rest };
}

/** 正文：各段＋就地插入的圖表＋誌謝＋參考文獻 */
export function bodyHtml(ctx, a) {
  const { t } = ctx;
  const { placed, rest } = placeFigures(a);
  const secs = a.sections ?? [];
  return html`${secs.map((s) => html`<section class="c-block c-teb__sec${s.level === 3 ? ' c-block--sub' : ''}" id="s-${s.key}">${s.level === 3 ? html`<h3>${s.heading}</h3>` : html`<h2>${s.heading}</h2>`}<div class="c-prose">${raw(md(s.markdown ?? ''))}</div>${(placed.get(s.key) ?? []).map((f) => figureHtml(ctx, a, f))}</section>`)}
${rest.length ? html`<section class="c-block" id="figures"><h2>${t('teb.figures')}</h2>${rest.map((f) => figureHtml(ctx, a, f))}</section>` : ''}
${a.acknowledgementsMarkdown ? html`<section class="c-block c-teb__ack" id="acknowledgements"><h2>${t('teb.ack')}</h2><div class="c-prose">${raw(md(a.acknowledgementsMarkdown))}</div></section>` : ''}
${a.references?.length ? html`<section class="c-block c-teb__refs" id="references"><h2>${t('teb.references')}</h2><ol>${a.references.map((r, i) => html`<li id="ref-${i + 1}">${r}</li>`)}</ol></section>` : ''}`;
}

/** 引用本文：中英兩種格式，各有複製鈕 */
export function citeHtml(ctx, a, issue) {
  const { t } = ctx;
  const zh = citationOf(a, issue), en = citationEnOf(a, issue);
  const row = (label, text) => html`<div class="c-teb__cite"><dt>${label}</dt><dd><code>${text}</code> <button type="button" class="c-btn c-btn--ghost c-btn--sm" data-copy-text="${text}" data-done="${t('copied')}">${t('teb.copy')}</button></dd></div>`;
  return html`<section class="c-block" id="cite" aria-labelledby="cite-h"><h2 id="cite-h">${t('teb.cite')}</h2><dl class="c-teb__cites">${row(t('teb.cite.zh'), zh)}${row(t('teb.cite.en'), en)}</dl></section>`;
}

/** 文章頁右側目錄：摘要、重點、各段、圖表、誌謝、參考文獻、引用 */
export function articleToc(ctx, a) {
  const { t } = ctx;
  const { rest } = placeFigures(a);
  const items = [
    a.abstractMarkdown ? ['#abstract', t('teb.abstract')] : null,
    a.highlights ? ['#highlights', t('teb.highlights')] : null,
    ...(a.sections ?? []).map((s) => [`#s-${s.key}`, s.heading, s.level === 3]),
    rest.length ? ['#figures', t('teb.figures')] : null,
    a.acknowledgementsMarkdown ? ['#acknowledgements', t('teb.ack')] : null,
    a.references?.length ? ['#references', t('teb.references')] : null,
    ['#cite', t('teb.cite')],
  ].filter(Boolean);
  return html`<nav class="c-aside-card c-toc c-toc--teb" aria-label="${t('disease.toc')}"><h2>${t('disease.toc')}</h2><ol>${items.map(([href, label, sub]) => html`<li${sub ? raw(' class="c-toc__sub"') : ''}><a href="${href}">${label}</a></li>`)}</ol>
  ${(a.figures ?? []).length ? html`<p class="c-toc__figs"><span class="muted">${t('teb.figures')}：</span>${(a.figures ?? []).map((f) => html`<a href="#${figId(f)}">${figLabel(ctx, f)}</a> `)}</p>` : ''}</nav>`;
}

/** 本期目錄（卷期頁與文章頁側欄共用）。compact：側欄用，只列篇名 */
export function issueTocHtml(ctx, issue, { current = null, compact = false } = {}) {
  const { site, t, fmtDate } = ctx;
  const rows = issueToc(issue, site.collections.articles ?? []);
  if (!rows.length) return '';
  const item = (r) => {
    const a = r.article;
    const title = a ? html`<a class="c-teb__toct" href="${hrefFor(ctx, a)}"${isFallbackLink(ctx, a) ? raw(' lang="zh-TW"') : ''}${current && a.id === current.id ? raw(' aria-current="page"') : ''}>${L(ctx, a, 'title')}</a>` : html`<span class="c-teb__toct">${r.title}</span>`;
    if (compact) return html`<li class="${current && a?.id === current.id ? 'is-current' : ''}"><span class="c-teb__tocno">${r.no}</span> ${title}</li>`;
    const pdf = a ? pdfHref(ctx, a, issue) : null;
    return html`<li class="c-teb__tocitem" id="art-${r.no}">
      <span class="c-teb__tocno" aria-hidden="true">${r.no}</span>
      <div class="c-teb__tocbody">
        <p class="c-teb__tocmeta muted">${a ? html`${pill(articleTypeLabel(ctx, a.articleType), 'info')} ` : ''}${r.pages ? t('teb.pages', { p: r.pages }) : ''}${a?.diseases?.length ? html` · ${a.diseases.map((d) => site.diseaseMasterById.get(d)?.name ?? d).join('、')}` : ''}</p>
        <p class="c-teb__toctitle">${title}</p>
        ${a?.titleEn ? html`<p class="c-teb__tocen muted" lang="en">${a.titleEn}</p>` : ''}
        <p class="c-teb__tocauthors">${r.authors.join('、')}</p>
        ${a ? html`<p class="c-teb__tocsum">${L(ctx, a, 'summary')}</p>` : ''}
        <p class="c-teb__toclinks">${a ? html`<a class="c-btn c-btn--sm" href="${hrefFor(ctx, a)}">${t('teb.fulltext')}</a> ${pdf ? html`<a class="c-btn c-btn--ghost c-btn--sm" href="${pdf}" rel="noopener">${a.pdfUrl ? t('teb.pdf.article') : t('teb.pdf.issue')}</a>` : ''}` : html`<span class="c-pill c-pill--neutral">${t('teb.bibonly')}</span>${r.legacy?.doi ? html` · DOI <a href="https://doi.org/${r.legacy.doi}" rel="noopener">${r.legacy.doi}</a>` : ''}`}</p>
      </div></li>`;
  };
  return html`<ol class="c-teb__toc${compact ? ' c-teb__toc--compact' : ''}" aria-label="${t('teb.toc')}">${rows.map(item)}</ol>${compact ? '' : html`<p class="muted c-teb__tocdate">${t('publications.date')}：${fmtDate(issue.publishedAt)}</p>`}`;
}

/** 上一篇／下一篇（同一期的全文文章） */
export function prevNextHtml(ctx, a, issue) {
  const { site, t } = ctx;
  const list = articlesOfIssue(site.collections.articles ?? [], issue?.id);
  const i = list.findIndex((x) => x.id === a.id);
  const prev = i > 0 ? list[i - 1] : null, next = i >= 0 && i < list.length - 1 ? list[i + 1] : null;
  if (!prev && !next) return '';
  return html`<nav class="c-teb__prevnext" aria-label="${t('teb.inissue')}">${prev ? html`<a class="c-teb__prev" href="${hrefFor(ctx, prev)}"><span class="muted">← ${t('teb.prev')}</span><span>${L(ctx, prev, 'title')}</span></a>` : html`<span></span>`}${next ? html`<a class="c-teb__next" href="${hrefFor(ctx, next)}"><span class="muted">${t('teb.next')} →</span><span>${L(ctx, next, 'title')}</span></a>` : ''}</nav>`;
}

/** 同系列其他卷期（最近 6 期，含目前） */
export function otherIssuesHtml(ctx, issue) {
  const { site, t } = ctx;
  const num = (v) => Number(v) || 0;
  const list = (site.collections.publications ?? []).filter((p) => p.status === 'published' && p.pubType === 'bulletin' && p.series === issue.series).sort((a, b) => num(b.volume) - num(a.volume) || num(b.issue) - num(a.issue));
  const i = list.findIndex((p) => p.id === issue.id);
  const win = list.slice(Math.max(0, i - 2), Math.max(0, i - 2) + 6);
  if (win.length <= 1) return '';
  return html`<section class="c-aside-card"><h2>${t('teb.issues')}</h2><ul class="c-linklist">${win.map((p) => html`<li${p.id === issue.id ? raw(' aria-current="true"') : ''}>${p.id === issue.id ? html`<strong>${volIssueLabel(ctx, p)}</strong>` : html`<a href="${hrefFor(ctx, p)}">${volIssueLabel(ctx, p)}</a>`} <span class="muted">${ctx.fmtDate(p.publishedAt)}</span></li>`)}</ul><p><a href="${ctx.url('/publications/')}#series-0">${t('publications.title')} →</a></p></section>`;
}
