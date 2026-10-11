// 疫苗接種時程地圖（/vaccines/schedule/）：資料來自 site.master.immunizationSchedule ＋ site.master.vaccines。
// 畫面：年齡輸入 → 時程地圖（inline SVG，分段非線性橫軸、一列一疫苗、一筆時程一個標記；預設整張縮到版面寬度，不橫向捲動）→ 詳情卡（圖下）→ 同資料表格（無障礙與列印）。
// 第三十六輪：SVG 與表格改由 src/client/vaxschedule.js 的 renderMapSvg／renderTableHtml 產生，後台 /admin/vaccines/schedule/ 預覽用同一份函式，
// 所以同事改一筆主檔，地圖與表格一起變；下載 PNG／SVG／CSV 在瀏覽器端做，另有建置時產生的 /vaccines/schedule.csv。
// 建置時把精簡 JSON 內嵌在 <script type="application/json" id="vxs-data">，互動由 /assets/js/vaxschedule.js 處理；沒有 JS 時 SVG 與表格仍可看。
import { html, raw, jsonScript } from '../../../scripts/lib/render.mjs';
import { ldFor, pageHead, sectionHead, feedback, hrefFor, link, isExternal, vaxmapLinkForVaccine, VAXMAP_GROUP_OF, VAXMAP_INFO_LABEL, mdLine } from './_partials.mjs';
import { TABS, ageRangeLabel, rowsOf, renderMapSvg, renderTableHtml, FUNDED } from '../../client/vaxschedule.js';

const JS = ['/assets/js/vaxschedule.js'];

export function meta(ctx) {
  const t = ctx.t;
  return { title: t('vxs.title'), description: t('vxs.desc'), scripts: JS, jsonLd: ldFor(ctx, null, [{ label: t('nav.vaccines'), href: '/vaccines/' }, { label: t('vxs.title') }]) };
}

const schedOf = (site) => site.master.immunizationSchedule ?? [];
const nameOf = (ctx, m) => (ctx.lang === 'zh-TW' ? m.name : (m.nameEn ?? m.name));
const labelOf = (ctx, i) => (ctx.lang === 'zh-TW' ? i.label : (i.labelEn ?? i.label));

function pageOf(ctx, m) {
  return m.hasPage ? ctx.site.collections.vaccines.find((v) => v.id === m.id && v.status === 'published') : null;
}
/** 疫苗主檔順序；疫苗名稱連到疫苗頁（有的話） */
function rowsFor(ctx) {
  return rowsOf(schedOf(ctx.site), ctx.site.master.vaccines, { lang: ctx.lang, hrefOf: (m) => { const p = pageOf(ctx, m); return p ? hrefFor(ctx, p) : null; } });
}
function whereOf(ctx, m) {
  return { href: vaxmapLinkForVaccine(ctx, m), label: VAXMAP_GROUP_OF[m.id] ? ctx.t('vaccines.where.cta') : (VAXMAP_INFO_LABEL[ctx.lang] ?? VAXMAP_INFO_LABEL.en) };
}

/** 內嵌 JSON（精簡鍵名；字串一律由前端以 textContent 放入） */
function payload(ctx, rows) {
  const vaccines = {};
  for (const r of rows) {
    const m = ctx.site.master.vaccines.find((x) => x.id === r.id) ?? { id: r.id, name: r.id };
    const p = pageOf(ctx, m); const w = whereOf(ctx, m);
    vaccines[m.id] = { name: nameOf(ctx, m), href: p ? hrefFor(ctx, p) : null, where: w.href, whereLabel: w.label };
  }
  return {
    lang: ctx.lang,
    items: schedOf(ctx.site).map((i) => ({ id: i.id, v: i.vaccine, label: i.label, labelEn: i.labelEn ?? null, dose: i.dose ?? null, min: i.ageMinMonths, max: i.ageMaxMonths ?? null, ageMinMonths: i.ageMinMonths, ageMaxMonths: i.ageMaxMonths ?? null, age: i.ageLabel ?? null, stage: i.stage, funded: i.funded, group: i.group ?? null, interval: i.interval ?? null, recurring: i.recurring ?? null, startAt: i.startAt ?? null, endAt: i.endAt ?? null, note: i.note ?? null, src: i.source ? { title: i.source.title, url: link(ctx, i.source.url), ext: isExternal(i.source.url) } : null, ver: i.verified !== false })),
    vaccines,
  };
}

/** 圖例用小色塊（與地圖標記同樣式） */
function swatch(kind, unverified = false) {
  return html`<svg class="vxs-sw" width="30" height="14" viewBox="0 0 30 14" aria-hidden="true" focusable="false"><g class="vxs-mk vxs-mk--${kind}${unverified ? ' is-unverified' : ''}"><rect class="vxs-shape" x="1" y="1" width="28" height="12" rx="6"/></g></svg>`;
}

export function render(ctx) {
  const { t, url } = ctx;
  const rows = rowsFor(ctx);
  const all = schedOf(ctx.site);
  const unverified = all.filter((i) => i.verified === false).length;
  const data = payload(ctx, rows);
  const sourceOf = (i) => (i.source?.url ? { href: link(ctx, i.source.url), ext: isExternal(i.source.url) } : null);
  return html`${pageHead(ctx, { trail: [{ label: t('nav.vaccines'), href: '/vaccines/' }, { label: t('vxs.title') }], h1: t('vxs.title'), lead: t('vxs.lead') })}
<div class="vxs" data-vxs>
${unverified ? html`<div class="c-warning vxs-notice" role="note"><strong>${t('vxs.unverified.badge')}</strong>：${t('vxs.unverified.note', { n: unverified })}</div>` : ''}
${ctx.lang === 'zh-TW' ? '' : html`<p class="muted vxs-zhonly">${t('vxs.zhonly')}</p>`}
<section aria-labelledby="vxs-age-h" class="vxs-age">${sectionHead(ctx, { id: 'vxs-age-h', title: t('vxs.age.t') })}
  <form class="vxs-form" data-vxs-form novalidate>
    <label>${t('vxs.age.years')}<input type="number" name="years" min="0" max="120" inputmode="numeric" autocomplete="off"></label>
    <label>${t('vxs.age.months')}<input type="number" name="months" min="0" max="11" inputmode="numeric" autocomplete="off"></label>
    <span class="vxs-or">${t('vxs.age.or')}</span>
    <label>${t('vxs.age.birthday')}<input type="date" name="birth" autocomplete="bday"></label>
    <button type="submit" class="c-btn">${t('vxs.age.go')}</button>
    <button type="button" class="c-btn c-btn--ghost" data-vxs-clear>${t('vxs.age.clear')}</button>
  </form>
  <p class="vxs-msg" data-vxs-msg role="alert"></p>
  <div class="vxs-result" data-vxs-result aria-live="polite" hidden></div>
</section>
<section aria-labelledby="vxs-map-h">${sectionHead(ctx, { id: 'vxs-map-h', title: t('vxs.map.t') })}
  <p class="muted">${t('vxs.map.hint')}</p>
  <div class="c-tabs__list vxs-tabs" role="tablist" aria-label="${t('vxs.tab.label')}">${TABS.map((tb, i) => html`<button type="button" role="tab" id="vxs-tab-${tb.id}" aria-controls="vxs-map" aria-selected="${i === 0 ? 'true' : 'false'}" tabindex="${i === 0 ? '0' : '-1'}" data-vxs-tab="${tb.id}">${t(`vxs.tab.${tb.id}`)}</button>`)}</div>
  <div class="vxs-bar">
    <ul class="vxs-legend" aria-label="${t('vxs.legend.t')}">${FUNDED.map((f) => html`<li>${swatch(f)} ${t(`vxs.funded.${f}`)}</li>`)}${unverified ? html`<li>${swatch('public', true)} ${t('vxs.legend.unverified')}</li>` : ''}</ul>
    <div class="vxs-tools vxs-jsonly" role="group" aria-label="${t('vxs.dl.t')}">
      <label class="vxs-zoom"><input type="checkbox" data-vxs-zoom> ${t('vxs.zoom')}</label>
      <span class="vxs-tools__t">${t('vxs.dl.t')}：</span>
      <button type="button" class="c-btn c-btn--ghost c-btn--sm" data-vxs-dl="png">PNG</button>
      <button type="button" class="c-btn c-btn--ghost c-btn--sm" data-vxs-dl="svg">SVG</button>
      <button type="button" class="c-btn c-btn--ghost c-btn--sm" data-vxs-dl="csv">CSV</button>
      <span class="vxs-tools__msg muted" data-vxs-dlmsg role="status" aria-live="polite"></span>
    </div>
  </div>
  <div class="vxs-scroll" id="vxs-map" role="region" tabindex="0" aria-labelledby="vxs-tab-all">${raw(renderMapSvg(rows, { t, lang: ctx.lang }))}</div>
  <p class="muted vxs-dlnote">${t('vxs.dl.note')} <a href="${url('/vaccines/schedule.csv', { noLang: true })}" download>CSV</a> · <a href="${url('/vaccines/schedule.md')}">${t('vxs.md')}</a> · <a href="${url('/v1/immunization-schedule.json', { noLang: true })}">${t('vxs.api')}</a></p>
  <aside class="vxs-detail" id="vxs-detail" aria-live="polite" aria-label="${t('vxs.detail.t')}"><p class="muted vxs-jsonly">${t('vxs.detail.hint')}</p></aside>
</section>
<section aria-labelledby="vxs-tb-h">${sectionHead(ctx, { id: 'vxs-tb-h', title: t('vxs.table.t'), note: t('vxs.table.note') })}
  <details class="vxs-tabledet" open><summary>${t('vxs.table.toggle', { n: all.length })}</summary>${raw(renderTableHtml(rows, { t, lang: ctx.lang, sourceOf, scrollLabel: t('a11y.scrollTable') }))}</details>
  <p class="muted"><a href="${url('/vaccines/schedule.md')}">${t('vxs.md')}</a> · <a href="${url('/v1/immunization-schedule.json', { noLang: true })}">${t('vxs.api')}</a> · <a href="${url('/vaccines/schedule.csv', { noLang: true })}" download>CSV</a>${ctx.lang === 'zh-TW' ? html` · <a href="${url('/admin/vaccines/schedule/', { noLang: true })}" rel="nofollow">${t('vxs.staff.edit')}</a>` : ''}</p>
</section>
<script type="application/json" id="vxs-data">${raw(jsonScript(data))}</script>
</div>
${feedback(ctx, { page: ctx.path })}`;
}

export function markdown(ctx) {
  const { t } = ctx;
  const rows = rowsFor(ctx);
  const cell = (s) => mdLine(s).replace(/\|/g, '／');
  const L = [`# ${t('vxs.title')}`, '', `> ${t('vxs.lead')}`, ''];
  const un = schedOf(ctx.site).filter((i) => i.verified === false).length;
  if (un) L.push(`> ⚠ ${t('vxs.unverified.badge')}：${t('vxs.unverified.note', { n: un })}`, '');
  L.push(`| ${['vaccine', 'dose', 'age', 'stage', 'funded', 'group', 'interval', 'note', 'source', 'id'].map((c) => t(`vxs.col.${c}`)).join(' | ')} |`, `| ${new Array(10).fill('---').join(' | ')} |`);
  for (const r of rows) for (const i of r.items) {
    const funded = t(`vxs.funded.${i.funded}`) + (i.verified === false ? `（${t('vxs.unverified.badge')}）` : '');
    const period = i.startAt ? `${t('vxs.col.period')} ${i.startAt}${i.endAt ? ` – ${i.endAt}` : ''}` : '';
    L.push(`| ${[r.name, i.dose ?? labelOf(ctx, i), ctx.lang === 'zh-TW' ? i.ageLabel : ageRangeLabel(i, t), t(`vxs.stage.${i.stage}`), funded, i.group ?? '', `${i.interval ?? ''}${i.recurring === 'yearly' ? ` ${t('vxs.recurring.yearly')}` : ''}`, [i.note, period].filter(Boolean).join(' '), i.source?.url ? `[${i.source.title}](${isExternal(i.source.url) ? i.source.url : ctx.url(i.source.url)})` : '', i.id].map(cell).join(' | ')} |`);
  }
  L.push('', `${t('vxs.api')}：/v1/immunization-schedule.json · CSV：/vaccines/schedule.csv`);
  return `${L.join('\n')}\n`;
}

export function pages() { return [{ path: '/vaccines/schedule/', lang: '*', props: {}, md: true }]; }
