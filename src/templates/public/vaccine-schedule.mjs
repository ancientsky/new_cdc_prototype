// 疫苗接種時程地圖（/vaccines/schedule/）：資料來自 site.master.immunizationSchedule（41 筆）＋ site.master.vaccines。
// 畫面：年齡輸入 → 時程地圖（inline SVG，分段非線性橫軸、一列一疫苗、一筆時程一個標記）→ 詳情卡 → 同資料表格（無障礙與列印）。
// 建置時把精簡 JSON 內嵌在 <script type="application/json" id="vxs-data">，互動由 /assets/js/vaxschedule.js 處理；
// 沒有 JS 時 SVG 與表格仍可看，標記是連到表格列（#sched.xxx）的連結。刻度與年齡文字函式與前端共用（src/client/vaxschedule.js）。
import { html, raw, jsonScript, esc } from '../../../scripts/lib/render.mjs';
import { ldFor, pageHead, sectionHead, feedback, hrefFor, link, isExternal, vaxmapLinkForVaccine, VAXMAP_GROUP_OF, VAXMAP_INFO_LABEL, mdLine } from './_partials.mjs';
import { xOf, PLOT_WIDTH, TICKS, TABS, formatAge, ageRangeLabel } from '../../client/vaxschedule.js';

const JS = ['/assets/js/vaxschedule.js'];
const LABEL_W = 170;
const AXIS_H = 34;
const LANE_H = 22;
const ROW_PAD = 10;
const FUNDED = ['public', 'conditional', 'self'];
const STAGES = ['infant', 'child', 'school', 'adult', 'pregnancy', 'older', 'risk'];

export function meta(ctx) {
  const t = ctx.t;
  return { title: t('vxs.title'), description: t('vxs.desc'), scripts: JS, jsonLd: ldFor(ctx, null, [{ label: t('nav.vaccines'), href: '/vaccines/' }, { label: t('vxs.title') }]) };
}

const schedOf = (site) => site.master.immunizationSchedule ?? [];
const nameOf = (ctx, m) => (ctx.lang === 'zh-TW' ? m.name : (m.nameEn ?? m.name));
const labelOf = (ctx, i) => (ctx.lang === 'zh-TW' ? i.label : (i.labelEn ?? i.label));
/** 內容文字目前只有中文：非 zh-TW 頁加 lang="zh-TW" 讓讀屏正確發音 */
const zhAttr = (ctx) => (ctx.lang === 'zh-TW' ? '' : raw(' lang="zh-TW"'));

/** 疫苗主檔順序；只列有時程項目的疫苗；每列的項目依年齡下限排序 */
function rowsOf(ctx) {
  const items = schedOf(ctx.site);
  const mv = ctx.site.master.vaccines;
  const rows = mv.map((m) => ({ m, items: items.filter((i) => i.vaccine === m.id).sort((a, b) => a.ageMinMonths - b.ageMinMonths) })).filter((r) => r.items.length);
  // 主檔沒有的疫苗 id（validate 會擋，這裡只是防呆）排最後
  for (const id of new Set(items.map((i) => i.vaccine))) if (!mv.some((m) => m.id === id)) rows.push({ m: { id, name: id, nameEn: id }, items: items.filter((i) => i.vaccine === id) });
  return rows;
}

/** 橫軸區間（px）；單一月齡畫成點（半徑 7，中心在該月中央），其餘畫橫條 */
function spanOf(i) {
  const max = i.ageMaxMonths;
  if (max === i.ageMinMonths) { const c = xOf(i.ageMinMonths + 0.5); return { x1: c - 8, x2: c + 8, point: true, c }; }
  const x1 = xOf(i.ageMinMonths); const x2 = Math.max(xOf((max ?? 960) + 1), x1 + 10);
  return { x1, x2, point: false, open: max == null };
}
/** 同列內重疊的標記分到不同水平帶（lane） */
function lanesOf(items) {
  const ends = []; const out = new Map();
  for (const i of items) {
    const s = spanOf(i); let l = ends.findIndex((e) => e + 3 <= s.x1);
    if (l < 0) { l = ends.length; ends.push(0); }
    ends[l] = s.x2; out.set(i.id, l);
  }
  return { lane: out, n: Math.max(1, ends.length) };
}

function pageOf(ctx, m) {
  return m.hasPage ? ctx.site.collections.vaccines.find((v) => v.id === m.id && v.status === 'published') : null;
}

function whereOf(ctx, m) {
  return { href: vaxmapLinkForVaccine(ctx, m), label: VAXMAP_GROUP_OF[m.id] ? ctx.t('vaccines.where.cta') : (VAXMAP_INFO_LABEL[ctx.lang] ?? VAXMAP_INFO_LABEL.en) };
}

/** 內嵌 JSON（精簡鍵名；字串一律由前端以 textContent 放入） */
function payload(ctx, rows) {
  const vaccines = {};
  for (const { m } of rows) {
    const p = pageOf(ctx, m); const w = whereOf(ctx, m);
    vaccines[m.id] = { name: nameOf(ctx, m), href: p ? hrefFor(ctx, p) : null, where: w.href, whereLabel: w.label };
  }
  return {
    lang: ctx.lang,
    items: schedOf(ctx.site).map((i) => ({ id: i.id, v: i.vaccine, label: i.label, labelEn: i.labelEn ?? null, dose: i.dose ?? null, min: i.ageMinMonths, max: i.ageMaxMonths ?? null, ageMinMonths: i.ageMinMonths, ageMaxMonths: i.ageMaxMonths ?? null, age: i.ageLabel ?? null, stage: i.stage, funded: i.funded, group: i.group ?? null, interval: i.interval ?? null, recurring: i.recurring ?? null, startAt: i.startAt ?? null, endAt: i.endAt ?? null, note: i.note ?? null, src: i.source ? { title: i.source.title, url: link(ctx, i.source.url), ext: isExternal(i.source.url) } : null, ver: i.verified !== false })),
    vaccines,
  };
}

function svgMap(ctx, rows) {
  const { t } = ctx;
  let y = AXIS_H; let ri = 0;
  const parts = rows.map(({ m, items }) => {
    const { lane, n } = lanesOf(items);
    const h = n * LANE_H + ROW_PAD;
    const page = pageOf(ctx, m);
    const nm = nameOf(ctx, m).replace(/ vaccine$/i, '');
    const label = page ? html`<a href="${hrefFor(ctx, page)}"><text x="8" y="${h / 2 + 4}" class="vxs-rtext">${nm}</text></a>` : html`<text x="8" y="${h / 2 + 4}" class="vxs-rtext">${nm}</text>`;
    const marks = items.map((i) => {
      const s = spanOf(i); const cy = ROW_PAD / 2 + lane.get(i.id) * LANE_H + LANE_H / 2;
      const verified = i.verified !== false;
      const ttl = [labelOf(ctx, i), ageRangeLabel(i, t), t(`vxs.funded.${i.funded}`), verified ? '' : t('vxs.unverified.badge')].filter(Boolean).join(' · ');
      const shape = s.point ? html`<circle class="vxs-shape" cx="${s.c}" cy="${cy}" r="7"/>` : html`<rect class="vxs-shape" x="${s.x1}" y="${cy - 7}" width="${s.x2 - s.x1}" height="14" rx="7"/>${s.open ? html`<path class="vxs-arrow" d="M${s.x2 - 9} ${cy - 4}l5 4l-5 4"/>` : ''}`;
      return html`<a class="vxs-mk vxs-mk--${i.funded}${verified ? '' : ' is-unverified'}" href="#${i.id}" data-id="${i.id}" data-stage="${i.stage}"><title>${ttl}</title>${shape}</a>`;
    });
    const out = {
      label: html`<g class="vxs-rl" id="vaccine=${m.id}" data-row="${ri}" data-vaccine="${m.id}" transform="translate(0 ${y})"><rect class="vxs-rowbg" x="0" y="0" width="${LABEL_W}" height="${h}"/>${label}</g>`,
      plot: html`<g class="vxs-rp" data-row="${ri}" data-vaccine="${m.id}" data-h="${h}" transform="translate(0 ${y})"><rect class="vxs-rowbg" x="0" y="0" width="${PLOT_WIDTH}" height="${h}"/>${marks}</g>`,
    };
    y += h; ri++;
    return out;
  });
  const total = y + 4;
  const ticks = TICKS.map(([mo, kind, n]) => { const x = xOf(mo); return html`<line class="vxs-grid" x1="${x}" x2="${x}" y1="${AXIS_H - 6}" y2="2400"/><text class="vxs-tick" x="${x}" y="${AXIS_H - 12}" text-anchor="middle">${t(kind === 'm' ? 'vxs.tick.m' : 'vxs.tick.y', { n })}</text>`; });
  return html`<svg class="vxs-svg" data-label-w="${LABEL_W}" data-axis-h="${AXIS_H}" viewBox="0 0 ${LABEL_W + PLOT_WIDTH} ${total}" width="${LABEL_W + PLOT_WIDTH}" height="${total}" role="group" aria-labelledby="vxs-svg-t" aria-describedby="vxs-svg-d" focusable="false">
<title id="vxs-svg-t">${t('vxs.map.t')}</title><desc id="vxs-svg-d">${t('vxs.map.desc')}</desc>
<defs><pattern id="vxs-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" class="vxs-hatch-bg"/><line x1="0" y1="0" x2="0" y2="6" class="vxs-hatch-ln"/></pattern>
<clipPath id="vxs-clip"><rect x="${LABEL_W}" y="0" width="${PLOT_WIDTH}" height="${total}"/></clipPath></defs>
<g clip-path="url(#vxs-clip)"><g class="vxs-plot" transform="translate(${LABEL_W} 0)">${ticks}
<g class="vxs-cursor" hidden><line x1="0" x2="0" y1="${AXIS_H - 4}" y2="2400"/><text x="0" y="10" text-anchor="middle"></text></g>
${parts.map((p) => p.plot)}</g></g>
${parts.map((p) => p.label)}
<rect class="vxs-axisbg" x="0" y="0" width="${LABEL_W}" height="${AXIS_H}"/><text class="vxs-axislabel" x="8" y="${AXIS_H - 12}">${t('vxs.axis')}</text>
</svg>`;
}

/** 圖例用小色塊（與地圖標記同樣式） */
function swatch(kind, unverified = false) {
  return html`<svg class="vxs-sw" width="30" height="14" viewBox="0 0 30 14" aria-hidden="true" focusable="false"><g class="vxs-mk vxs-mk--${kind}${unverified ? ' is-unverified' : ''}"><rect class="vxs-shape" x="1" y="1" width="28" height="12" rx="6"/></g></svg>`;
}

function table(ctx, rows) {
  const { t } = ctx; const z = zhAttr(ctx);
  const cols = ['vaccine', 'dose', 'age', 'stage', 'funded', 'group', 'interval', 'note', 'source'];
  return html`<div class="c-tablewrap" role="region" tabindex="0" aria-label="${t('a11y.scrollTable')}"><table class="c-table vxs-table"><caption class="sr-only">${t('vxs.table.t')}</caption><thead><tr>${cols.map((c) => html`<th scope="col">${t(`vxs.col.${c}`)}</th>`)}<th scope="col" class="vxs-jsonly">${t('vxs.col.status')}</th></tr></thead><tbody>
${rows.flatMap(({ m, items }) => items.map((i) => html`<tr id="${i.id}" data-sched="${i.id}" data-vaccine="${m.id}">
<th scope="row">${nameOf(ctx, m)}</th><td${z}>${i.dose ?? labelOf(ctx, i)}</td><td>${ctx.lang === 'zh-TW' ? i.ageLabel : ageRangeLabel(i, t)}</td><td>${t(`vxs.stage.${i.stage}`)}</td>
<td><span class="c-pill c-pill--${i.funded === 'public' ? 'ok' : i.funded === 'conditional' ? 'info' : 'neutral'}">${t(`vxs.funded.${i.funded}`)}</span>${i.verified === false ? html` <span class="c-pill c-pill--warn">${t('vxs.unverified.badge')}</span>` : ''}</td>
<td${z}>${i.group ?? ''}</td><td${z}>${i.interval ?? ''}${i.recurring === 'yearly' ? ` ${t('vxs.recurring.yearly')}` : ''}</td><td${z}>${i.note ?? ''}${i.startAt ? html` ${t('vxs.col.period')}：${i.startAt}${i.endAt ? ` – ${i.endAt}` : ''}` : ''}</td>
<td>${i.source?.url ? html`<a href="${link(ctx, i.source.url)}"${isExternal(i.source.url) ? raw(' target="_blank" rel="noopener"') : ''}${z}>${i.source.title}</a>` : ''}</td><td class="vxs-jsonly" data-vxs-st></td></tr>`))}
</tbody></table></div>`;
}

export function render(ctx) {
  const { t, url } = ctx;
  const rows = rowsOf(ctx);
  const all = schedOf(ctx.site);
  const unverified = all.filter((i) => i.verified === false).length;
  const data = payload(ctx, rows);
  void STAGES;
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
  <ul class="vxs-legend" aria-label="${t('vxs.legend.t')}">${FUNDED.map((f) => html`<li>${swatch(f)} ${t(`vxs.funded.${f}`)}</li>`)}${unverified ? html`<li>${swatch('public', true)} ${t('vxs.legend.unverified')}</li>` : ''}</ul>
  <div class="vxs-grid2">
    <div class="vxs-scroll" id="vxs-map" role="region" tabindex="0" aria-labelledby="vxs-tab-all">${svgMap(ctx, rows)}</div>
    <aside class="vxs-detail" id="vxs-detail" aria-live="polite" aria-label="${t('vxs.detail.t')}"><p class="muted vxs-jsonly">${t('vxs.detail.hint')}</p></aside>
  </div>
</section>
<section aria-labelledby="vxs-tb-h">${sectionHead(ctx, { id: 'vxs-tb-h', title: t('vxs.table.t'), note: t('vxs.table.note') })}
  <details class="vxs-tabledet" open><summary>${t('vxs.table.toggle', { n: all.length })}</summary>${table(ctx, rows)}</details>
  <p class="muted"><a href="${url('/vaccines/schedule.md')}">${t('vxs.md')}</a> · <a href="${url('/v1/immunization-schedule.json', { noLang: true })}">${t('vxs.api')}</a></p>
</section>
<script type="application/json" id="vxs-data">${raw(jsonScript(data))}</script>
</div>
${feedback(ctx, { page: ctx.path })}`;
}

export function markdown(ctx) {
  const { t } = ctx;
  const rows = rowsOf(ctx);
  const cell = (s) => mdLine(s).replace(/\|/g, '／');
  const L = [`# ${t('vxs.title')}`, '', `> ${t('vxs.lead')}`, ''];
  const un = schedOf(ctx.site).filter((i) => i.verified === false).length;
  if (un) L.push(`> ⚠ ${t('vxs.unverified.badge')}：${t('vxs.unverified.note', { n: un })}`, '');
  L.push(`| ${['vaccine', 'dose', 'age', 'stage', 'funded', 'group', 'interval', 'note', 'source', 'id'].map((c) => t(`vxs.col.${c}`)).join(' | ')} |`, `| ${new Array(10).fill('---').join(' | ')} |`);
  for (const { m, items } of rows) for (const i of items) {
    const funded = t(`vxs.funded.${i.funded}`) + (i.verified === false ? `（${t('vxs.unverified.badge')}）` : '');
    const period = i.startAt ? `${t('vxs.col.period')} ${i.startAt}${i.endAt ? ` – ${i.endAt}` : ''}` : '';
    L.push(`| ${[nameOf(ctx, m), i.dose ?? labelOf(ctx, i), ctx.lang === 'zh-TW' ? i.ageLabel : ageRangeLabel(i, t), t(`vxs.stage.${i.stage}`), funded, i.group ?? '', `${i.interval ?? ''}${i.recurring === 'yearly' ? ` ${t('vxs.recurring.yearly')}` : ''}`, [i.note, period].filter(Boolean).join(' '), i.source?.url ? `[${i.source.title}](${isExternal(i.source.url) ? i.source.url : ctx.url(i.source.url)})` : '', i.id].map(cell).join(' | ')} |`);
  }
  L.push('', `${t('vxs.api')}：/v1/immunization-schedule.json`);
  return `${L.join('\n')}\n`;
}

export function pages() { return [{ path: '/vaccines/schedule/', lang: '*', props: {}, md: true }]; }
void esc; void formatAge;
