// 疾病索引：法定類別／傳播途徑／筆畫／注音 四種分類（tab；無 JS 時全部展開）。
import { html, raw } from '../../../scripts/lib/render.mjs';
import { langAvailable } from '../../../scripts/lib/pages.mjs';
import { ldFor, pageHead, diseaseName, hrefFor, isFallbackLink, translationBadge, sectionHead, askBox } from './_partials.mjs';

const ZHUYIN = ['ㄅ', 'ㄆ', 'ㄇ', 'ㄈ', 'ㄉ', 'ㄊ', 'ㄋ', 'ㄌ', 'ㄍ', 'ㄎ', 'ㄏ', 'ㄐ', 'ㄑ', 'ㄒ', 'ㄓ', 'ㄔ', 'ㄕ', 'ㄖ', 'ㄗ', 'ㄘ', 'ㄙ', 'ㄧ', 'ㄨ', 'ㄩ', 'ㄚ', 'ㄛ', 'ㄜ', 'ㄝ', 'ㄞ', 'ㄟ', 'ㄠ', 'ㄡ', 'ㄢ', 'ㄣ', 'ㄤ', 'ㄥ', 'ㄦ'];

export function meta(ctx) {
  return { title: ctx.t('nav.diseases'), description: ctx.t('diseases.desc'), jsonLd: ldFor(ctx, null, [{ label: ctx.t('nav.diseases') }]) };
}

function row(ctx, dm) {
  const { site, t, fmtDate } = ctx;
  const page = site.collections.diseases.find((d) => d.id === dm.id && d.status === 'published');
  const name = diseaseName(ctx, dm);
  const text = [dm.name, dm.nameEn, ...(dm.aliases ?? [])].join(' ').toLowerCase();
  let link;
  if (page) {
    const fb = isFallbackLink(ctx, page);
    link = html`<a class="c-dis__name" href="${hrefFor(ctx, page)}"${fb ? raw(' lang="zh-TW"') : ''}>${fb ? dm.name : name}</a>${fb ? html` ${translationBadge(ctx, 'none')}` : ''}`;
  } else {
    link = html`<span class="c-dis__name">${name}</span>`;
  }
  return html`<li class="c-dis" data-text="${text}">
    <div class="c-dis__main">${link}${ctx.lang !== 'en' && dm.nameEn ? html` <span class="c-dis__en" lang="en">${dm.nameEn}</span>` : ''}</div>
    <div class="c-dis__meta"><span class="c-scope-tag c-scope-tag--cat">${t('disease.cat', { n: dm.legalCategory })}</span>
      ${dm.notifyWithinHours ? html`<span class="muted">${t('disease.notify.h', { h: dm.notifyWithinHours })}</span>` : ''}
      ${page ? html`<span class="muted">${t('prov.reviewed')} ${fmtDate(page.reviewedAt)}</span>` : html`<span class="c-pill c-pill--neutral">${t('diseases.nopage')}</span> <a class="muted" href="${ctx.url('/ask/')}?q=${encodeURIComponent(dm.name)}">${t('diseases.askit')}</a>`}</div>
  </li>`;
}

function group(items, keyFn) {
  const m = new Map();
  for (const it of items) for (const k of [].concat(keyFn(it) ?? '—')) { if (!m.has(k)) m.set(k, []); m.get(k).push(it); }
  return m;
}

export function render(ctx) {
  const { site, t } = ctx;
  const all = site.master.diseases;
  const tabs = [
    { id: 'law', label: t('diseases.by.law'), groups: [...group(all, (d) => d.legalCategory).entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0]))).map(([k, v]) => [t('disease.cat', { n: k }), v]) },
    { id: 'route', label: t('diseases.by.route'), groups: [...group(all, (d) => (d.transmission?.length ? d.transmission : ['—'])).entries()].map(([k, v]) => [t(`transmission.${k}`) === `transmission.${k}` ? k : t(`transmission.${k}`), v]) },
    { id: 'stroke', label: t('diseases.by.stroke'), groups: [...group(all, (d) => d.strokes ?? '—').entries()].sort((a, b) => (Number(a[0]) || 99) - (Number(b[0]) || 99)).map(([k, v]) => [k === '—' ? '—' : t('diseases.strokes', { n: k }), v]) },
    { id: 'zhuyin', label: t('diseases.by.zhuyin'), groups: [...group(all, (d) => d.zhuyin ?? '—').entries()].sort((a, b) => (ZHUYIN.indexOf(a[0]) + 1 || 99) - (ZHUYIN.indexOf(b[0]) + 1 || 99)).map(([k, v]) => [k, v]) },
  ];
  const withPage = all.filter((d) => site.collections.diseases.some((p) => p.id === d.id && p.status === 'published' && langAvailable(site, p, ctx.lang))).length;
  return html`${pageHead(ctx, { trail: [{ label: t('nav.diseases') }], h1: t('nav.diseases'), lead: t('diseases.lead', { n: all.length, p: withPage }) })}
<div class="c-diseases">
  <div class="c-diseases__tools">
    <label class="sr-only" for="dis-filter">${t('diseases.filter')}</label>
    <input id="dis-filter" class="c-input" type="search" placeholder="${t('diseases.filter')}" data-filter-input="dis-lists" autocomplete="off">
    ${askBox(ctx, { id: 'dis-q', size: 'sm', placeholder: t('diseases.ask.ph'), btn: t('home.ask') })}
  </div>
  <div class="c-tabs" data-tabs>
    <div class="c-tabs__list" role="tablist" aria-label="${t('diseases.by')}">${tabs.map((tb, i) => html`<button type="button" role="tab" id="tab-${tb.id}" aria-controls="panel-${tb.id}" aria-selected="${i === 0 ? 'true' : 'false'}" tabindex="${i === 0 ? '0' : '-1'}">${tb.label}</button>`)}</div>
    <div id="dis-lists">${tabs.map((tb, i) => html`<div class="c-tabs__panel" role="tabpanel" id="panel-${tb.id}" aria-labelledby="tab-${tb.id}" ${i ? raw('data-initial-hidden') : ''}>
      <h2 class="c-tabs__print">${tb.label}</h2>
      ${tb.groups.map(([k, list]) => html`<section class="c-dis-group" data-filter-group><h3>${k} <span class="muted">(${list.length})</span></h3><ul class="c-dis-list">${list.map((d) => row(ctx, d))}</ul></section>`)}
    </div>`)}</div>
  </div>
</div>`;
}

export function pages() { return [{ path: '/diseases/', lang: '*', props: {} }]; }
void sectionHead;
