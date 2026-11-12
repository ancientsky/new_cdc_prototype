// 疾病索引：有完整疾病頁／法定類別／傳播途徑／筆畫／注音 五種分類（tab；無 JS 時全部展開）。
// 第七十一輪（docs/architecture-ux-review.md 4.4、U4）：
// - 第一個 tab 改為「有完整疾病頁」：先列有頁的疾病（名稱、英文名、最後審閱日、目前疫情狀態），沒有頁的收進
//   <details>「其他法定傳染病（N）」。民眾查疾病的起點是「我聽過的那個病」，不是通報分類；有內容的放前面、沒內容的收合，不丟資訊也不誤導。
// - 專業版（html[data-view="pro"]）預設落在「法定類別」：tab 容器帶 data-tabs-pro="tab-law"，由 ui.js 依 id 切換，不寫死順序。
// - 每列整列是一個連結、最小高度 44 px（新版無障礙規範 2.5.8 建議值）：有頁連疾病頁，沒頁連「問問看」；
//   「尚無獨立頁面」改為列內小字，不再是膠囊＋另一個 3 個字寬的小連結（原本手機版有 63 個小於 44 px 的可點目標）。
import { html, raw } from '../../../scripts/lib/render.mjs';
import { langAvailable } from '../../../scripts/lib/pages.mjs';
import { ldFor, pageHead, diseaseName, hrefFor, isFallbackLink, translationBadge, sectionHead, askBox } from './_partials.mjs';

const ZHUYIN = ['ㄅ', 'ㄆ', 'ㄇ', 'ㄈ', 'ㄉ', 'ㄊ', 'ㄋ', 'ㄌ', 'ㄍ', 'ㄎ', 'ㄏ', 'ㄐ', 'ㄑ', 'ㄒ', 'ㄓ', 'ㄔ', 'ㄕ', 'ㄖ', 'ㄗ', 'ㄘ', 'ㄙ', 'ㄧ', 'ㄨ', 'ㄩ', 'ㄚ', 'ㄛ', 'ㄜ', 'ㄝ', 'ㄞ', 'ㄟ', 'ㄠ', 'ㄡ', 'ㄢ', 'ㄣ', 'ㄤ', 'ㄥ', 'ㄦ'];

export function meta(ctx) {
  return { title: ctx.t('nav.diseases'), description: ctx.t('diseases.desc'), jsonLd: ldFor(ctx, null, [{ label: ctx.t('nav.diseases') }]) };
}

const pageOf = (site, dm) => site.collections.diseases.find((d) => d.id === dm.id && d.status === 'published');

// 第七十一輪：整列一個 <a class="c-dis__link">（最小高度 44 px）；有頁連疾病頁，沒頁連「問問看」，「尚無獨立頁面」是列內小字。
// featured：「有完整疾病頁」tab 的列，改顯示目前疫情狀態 sit（不可互動的標籤；浮層版 statusTag 有 role=button，不能放進連結裡），不顯示通報時限。
function row(ctx, dm, { featured = false, sit = null } = {}) {
  const { site, t, fmtDate } = ctx;
  const page = pageOf(site, dm);
  const name = diseaseName(ctx, dm);
  const text = [dm.name, dm.nameEn, ...(dm.aliases ?? [])].join(' ').toLowerCase();
  const fb = page && isFallbackLink(ctx, page);
  const href = page ? hrefFor(ctx, page) : `${ctx.url('/ask/')}?q=${encodeURIComponent(dm.name)}`;
  return html`<li class="c-dis" data-text="${text}"><a class="c-dis__link" href="${href}">
    <span class="c-dis__main"><span class="c-dis__name"${fb ? raw(' lang="zh-TW"') : ''}>${fb ? dm.name : name}</span>${fb ? html` ${translationBadge(ctx, 'none')}` : ''}${ctx.lang !== 'en' && dm.nameEn ? html` <span class="c-dis__en" lang="en">${dm.nameEn}</span>` : ''}</span>
    <span class="c-dis__meta">
      ${sit ? html`<span class="c-status-tag c-status-tag--${sit.status}"><span class="sr-only">${t('diseases.sit.sr')}</span>${t(`status.${sit.status}`)}</span>` : ''}
      ${dm.notifyWithinHours && !featured ? html`<span class="muted">${t('disease.notify.h', { h: dm.notifyWithinHours })}</span>` : ''}
      ${page ? html`<span class="muted">${t('prov.reviewed')} ${fmtDate(page.reviewedAt)}</span>` : html`<span class="c-dis__nopage">${t('diseases.nopage')} · ${t('diseases.askit')} →</span>`}</span>
  </a></li>`;
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
    { id: 'page', label: t('diseases.by.page') },
    { id: 'law', label: t('diseases.by.law'), groups: [...group(all, (d) => d.legalCategory).entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0]))).map(([k, v]) => [t('disease.cat', { n: k }), v]) },
    { id: 'route', label: t('diseases.by.route'), groups: [...group(all, (d) => (d.transmission?.length ? d.transmission : ['—'])).entries()].map(([k, v]) => [t(`transmission.${k}`) === `transmission.${k}` ? k : t(`transmission.${k}`), v]) },
    { id: 'stroke', label: t('diseases.by.stroke'), groups: [...group(all, (d) => d.strokes ?? '—').entries()].sort((a, b) => (Number(a[0]) || 99) - (Number(b[0]) || 99)).map(([k, v]) => [k === '—' ? '—' : t('diseases.strokes', { n: k }), v]) },
    { id: 'zhuyin', label: t('diseases.by.zhuyin'), groups: [...group(all, (d) => d.zhuyin ?? '—').entries()].sort((a, b) => (ZHUYIN.indexOf(a[0]) + 1 || 99) - (ZHUYIN.indexOf(b[0]) + 1 || 99)).map(([k, v]) => [k, v]) },
  ];
  const withPage = all.filter((d) => site.collections.diseases.some((p) => p.id === d.id && p.status === 'published' && langAvailable(site, p, ctx.lang))).length;
  // 第七十一輪：「有完整疾病頁」tab。目前有疫情狀態的排前面（依疫情發布的順序；正在流行的病最常被查），其餘依主檔順序。
  const sitItems = site.situation?.items ?? [];
  const sitOf = (dm) => sitItems.find((i) => i.disease === dm.id) ?? null;
  const rank = (dm) => { const k = sitItems.findIndex((i) => i.disease === dm.id); return k < 0 ? sitItems.length : k; };
  const featured = all.filter((d) => pageOf(site, d)).map((d, k) => [d, k]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([d]) => d);
  const others = all.filter((d) => !pageOf(site, d));
  const featuredPanel = html`<section class="c-dis-group" data-filter-group><ul class="c-dis-list">${featured.map((d) => row(ctx, d, { featured: true, sit: sitOf(d) }))}</ul></section>
      ${others.length ? html`<details class="c-dis-others" data-filter-group data-filter-open><summary>${t('diseases.others', { n: others.length })}</summary><p class="c-dis-others__note muted">${t('diseases.others.note')}</p><ul class="c-dis-list">${others.map((d) => row(ctx, d))}</ul></details>` : ''}`;
  return html`${pageHead(ctx, { trail: [{ label: t('nav.diseases') }], h1: t('nav.diseases'), lead: t('diseases.lead', { n: all.length, p: withPage }) })}
<div class="c-diseases">
  <div class="c-diseases__tools">
    <label class="sr-only" for="dis-filter">${t('diseases.filter')}</label>
    <input id="dis-filter" class="c-input" type="search" placeholder="${t('diseases.filter')}" data-filter-input="dis-lists" autocomplete="off">
    ${askBox(ctx, { id: 'dis-q', size: 'sm', placeholder: t('diseases.ask.ph'), btn: t('home.ask') })}
  </div>
  <div class="c-tabs" data-tabs data-tabs-pro="tab-law">
    <div class="c-tabs__list" role="tablist" aria-label="${t('diseases.by')}">${tabs.map((tb, i) => html`<button type="button" role="tab" id="tab-${tb.id}" aria-controls="panel-${tb.id}" aria-selected="${i === 0 ? 'true' : 'false'}" tabindex="${i === 0 ? '0' : '-1'}">${tb.label}</button>`)}</div>
    <div id="dis-lists">${tabs.map((tb, i) => html`<div class="c-tabs__panel" role="tabpanel" id="panel-${tb.id}" aria-labelledby="tab-${tb.id}" ${i ? raw('data-initial-hidden') : ''}>
      <h2 class="c-tabs__print">${tb.label}</h2>
      ${tb.groups ? tb.groups.map(([k, list]) => html`<section class="c-dis-group" data-filter-group><h2 class="c-dis-group__t">${k} <span class="muted">(${list.length})</span></h2><ul class="c-dis-list">${list.map((d) => row(ctx, d))}</ul></section>`) : featuredPanel}
    </div>`)}</div>
  </div>
</div>`;
}

export function pages() { return [{ path: '/diseases/', lang: '*', props: {} }]; }
void sectionHead;
