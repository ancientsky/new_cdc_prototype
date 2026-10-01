// 出國與入境：目的地查詢（國家下拉 + 等級表）與每國一頁。資料來自 site.snapshots（live 或快照），欄位名容錯。
import { html, raw } from '../../../scripts/lib/render.mjs';
import { config } from '../../../site.config.mjs';
import { ldFor, pageHead, sectionHead, askBox, sourceCard, hrefFor, L, diseasePage, publishedOf, feedback, pill } from './_partials.mjs';

export const TRAVEL_CLINIC_URL = `${config.legacyOrigin}/Category/List/`;

const KEYS = {
  country: ['Country', 'country', 'CountryName', 'CountryZh', 'country_name', 'Name', '國家', '國家名稱', '國家/地區'],
  countryEn: ['CountryEn', 'CountryEnglish', 'country_en', 'EnglishName', 'NameEn', 'EnName'],
  iso2: ['Iso2', 'ISO2', 'iso2', 'ISO', 'Iso', 'CountryCode', 'Code'],
  disease: ['Disease', 'disease', 'DiseaseName', '疾病', '疾病名稱'],
  level: ['Level', 'level', 'LevelName', 'AlertLevel', '等級', '警示等級'],
  levelCode: ['LevelCode', 'levelCode', 'Level_Code', 'LevelNo'],
  start: ['StartDate', 'startDate', 'Start', 'EffectiveDate', 'Date', 'PublishDate', 'ReleaseDate', '開始日期', '發布日期'],
  summary: ['Summary', 'summary', 'Content', 'Description', 'Memo', 'Remark', '摘要', '內容'],
};
const pick = (o, names) => { for (const k of names) if (o?.[k] != null && o[k] !== '') return o[k]; return null; };

/** 把一筆快照列正規化 */
export function normRow(r) {
  const levelText = pick(r, KEYS.level);
  let code = pick(r, KEYS.levelCode);
  if (code == null && levelText != null) { const m = String(levelText).match(/[1-3一二三]/); if (m) code = '一二三'.includes(m[0]) ? '一二三'.indexOf(m[0]) + 1 : Number(m[0]); }
  if (code == null && levelText != null) { const s = String(levelText).toLowerCase(); code = /watch|注意/.test(s) ? 1 : /alert|警示/.test(s) ? 2 : /warning|警告/.test(s) ? 3 : null; }
  return {
    country: pick(r, KEYS.country), countryEn: pick(r, KEYS.countryEn), iso2: (pick(r, KEYS.iso2) ?? '').toString().toUpperCase().slice(0, 2) || null,
    disease: pick(r, KEYS.disease), level: levelText, code: code != null ? Number(code) : null,
    start: pick(r, KEYS.start), summary: pick(r, KEYS.summary),
  };
}
export const asRows = (snap) => (Array.isArray(snap?.data) ? snap.data : Array.isArray(snap) ? snap : []).filter((x) => x && typeof x === 'object').map(normRow);

function rowsFor(site) {
  const rows = [...asRows(site.snapshots?.countryLevels), ...asRows(site.snapshots?.travelAlerts)];
  return rows.filter((r) => r.country || r.iso2);
}
function matchCountry(c, r) {
  const names = [c.name, c.nameEn].filter(Boolean).map((s) => s.toLowerCase());
  return (r.iso2 && r.iso2 === c.iso2) || (r.country && names.some((n) => String(r.country).toLowerCase().includes(n) || n.includes(String(r.country).toLowerCase()))) || (r.countryEn && names.includes(String(r.countryEn).toLowerCase()));
}
function maxLevel(rs) { const l = rs.map((r) => r.code).filter(Boolean); return l.length ? Math.max(...l) : null; }
const levelPill = (ctx, code) => (code ? html`<span class="c-level c-level--${code}">${ctx.t(`travel.level.${code}`)}</span>` : html`<span class="c-level c-level--0">${ctx.t('travel.level.0')}</span>`);
const cname = (ctx, c) => (ctx.lang === 'zh-TW' ? c.name : c.nameEn ?? c.name);

function provCard(ctx) {
  const { site, t } = ctx;
  const metas = [['countryLevels', t('travel.src.levels')], ['travelAlerts', t('travel.src.alerts')]];
  return html`<details class="c-source-card" data-group="ondemand"><summary>${t('source.card')} · ${t('travel.src.t')}</summary><dl>
    ${metas.map(([k, label]) => { const m = site.snapshots?.[k]?.meta ?? {}; return html`<div><dt>${label}</dt><dd>${pill(m.mode === 'live' ? t('travel.mode.live') : m.mode === 'missing' ? t('travel.mode.missing') : t('travel.mode.snapshot'), m.mode === 'live' ? 'ok' : 'warn')} ${m.fetchedAt ? html`${t('travel.fetchedAt')} <time datetime="${m.fetchedAt}">${String(m.fetchedAt).slice(0, 10)}</time>` : t('travel.nofetch')} ${m.sourceUrl ? html`· <a href="${m.sourceUrl}" rel="noopener">${t('source.canonical')}</a>` : ''} ${m.count != null ? `· ${m.count}` : ''}</dd></div>`; })}
    <div><dt>${t('source.formats')}</dt><dd><a class="c-source-card__fmt" href="${ctx.url('/v1/country-levels.json', { noLang: true })}">JSON</a> <a class="c-source-card__fmt" href="${ctx.url('/v1/travel-alerts.json', { noLang: true })}">API</a></dd></div>
  </dl><p class="muted">${t('travel.src.note')}</p></details>`;
}

export function meta(ctx, props = {}) {
  const { t } = ctx;
  if (props.country) {
    const c = props.country;
    return { title: `${cname(ctx, c)} · ${t('nav.travel')}`, description: t('travel.country.desc', { name: cname(ctx, c) }), jsonLd: ldFor(ctx, null, [{ label: t('nav.travel'), href: '/travel/' }, { label: cname(ctx, c) }]) };
  }
  return { title: t('nav.travel'), description: t('travel.desc'), jsonLd: ldFor(ctx, null, [{ label: t('nav.travel') }]) };
}

function alertsTable(ctx, rows, { withCountry = true } = {}) {
  const { t, fmtDate } = ctx;
  if (!rows.length) return html`<p class="c-empty">${t('travel.empty')}</p>`;
  return html`<div class="c-tablewrap"><table class="c-table c-table--travel"><thead><tr>${withCountry ? html`<th scope="col">${t('travel.col.country')}</th>` : ''}<th scope="col">${t('travel.col.disease')}</th><th scope="col">${t('travel.col.level')}</th><th scope="col">${t('travel.col.start')}</th><th scope="col">${t('travel.col.summary')}</th></tr></thead><tbody>${rows.map((r) => html`<tr>${withCountry ? html`<th scope="row">${r.country ?? r.iso2}</th>` : ''}<td>${r.disease ?? '—'}</td><td>${levelPill(ctx, r.code)}${r.level && !/^[1-3]$/.test(String(r.level)) ? html` <span class="muted">${r.level}</span>` : ''}</td><td>${r.start ? fmtDate(String(r.start).slice(0, 10)) : '—'}</td><td>${r.summary ?? ''}</td></tr>`)}</tbody></table></div>`;
}

export function render(ctx, props = {}) {
  const { site, t, url } = ctx;
  const countries = site.master.countries ?? [];
  const rows = rowsFor(site);
  if (props.country) return renderCountry(ctx, props.country, rows);
  const lvlRows = rows.slice(0, 80);
  return html`${pageHead(ctx, { trail: [{ label: t('nav.travel') }], h1: t('nav.travel'), lead: t('travel.lead') })}
<section class="c-travelpick" aria-labelledby="tp-h">
  <h2 id="tp-h">${t('travel.pick')}</h2>
  <form class="c-travelpick__form" data-travel-form action="${url('/travel/')}" method="get">
    <label for="tp-country" class="sr-only">${t('travel.pick')}</label>
    <select id="tp-country" class="c-input c-select" data-travel-select>
      <option value="">${t('travel.select')}</option>
      ${countries.map((c) => html`<option value="${url(`/travel/${c.iso2}/`)}">${cname(ctx, c)}${ctx.lang !== 'zh-TW' ? '' : ` ${c.nameEn}`}</option>`)}
    </select>
    <button type="submit" class="c-btn">${t('travel.go')}</button>
  </form>
  <ul class="c-countrylist">${countries.map((c) => { const lv = maxLevel(rows.filter((r) => matchCountry(c, r))); return html`<li><a href="${url(`/travel/${c.iso2}/`)}">${cname(ctx, c)}</a> ${levelPill(ctx, lv)}</li>`; })}</ul>
</section>
<section aria-labelledby="tl-h">
  ${sectionHead(ctx, { id: 'tl-h', title: t('travel.levels.t'), note: t('travel.levels.sub') })}
  <ul class="c-legend">${[1, 2, 3].map((n) => html`<li>${levelPill(ctx, n)} ${t(`travel.level.${n}.d`)}</li>`)}</ul>
  ${alertsTable(ctx, lvlRows)}
</section>
<section class="c-ask-inline" aria-labelledby="ta-h"><h2 id="ta-h">${t('travel.ask')}</h2>${askBox(ctx, { id: 'tq', size: 'md', task: 'travel', placeholder: t('travel.ask.ph') })}</section>
${provCard(ctx)}
${feedback(ctx, { page: ctx.path })}`;
}

function renderCountry(ctx, c, allRows) {
  const { site, t, url } = ctx;
  const rows = allRows.filter((r) => matchCountry(c, r));
  const lv = maxLevel(rows);
  const diseaseMaster = site.master.diseases;
  const related = new Map();
  for (const r of rows) {
    const dm = diseaseMaster.find((d) => r.disease && ([d.name, d.nameEn, ...(d.aliases ?? [])].some((n) => n && String(r.disease).toLowerCase().includes(String(n).toLowerCase()))));
    if (dm) related.set(dm.id, dm);
  }
  for (const it of site.collections.diseases.filter((d) => d.status === 'published' && d.tasks?.includes('travel'))) related.set(it.id, diseaseMaster.find((d) => d.id === it.id) ?? { id: it.id, name: it.title, nameEn: it.nameEn });
  const relPages = [...related.values()].map((d) => ({ dm: d, page: diseasePage(ctx, d.id) }));
  const vaccines = publishedOf(site, 'vaccines').filter((v) => v.diseases?.some((d) => related.has(d)));
  const masterVax = site.master.vaccines.filter((v) => v.diseases?.some((d) => related.has(d)) && !vaccines.some((x) => x.id === v.id));
  const docs = site.collections.documents.filter((d) => d.isCurrent && (d.countries?.includes(c.iso2) || (d.tasks?.includes('travel') && d.diseases?.some((x) => related.has(x)))));
  return html`${pageHead(ctx, { trail: [{ label: t('nav.travel'), href: '/travel/' }, { label: cname(ctx, c) }], h1: t('travel.country.h1', { name: cname(ctx, c) }), lead: t('travel.country.lead', { region: c.region ?? '' }), tags: html`<p>${levelPill(ctx, lv)} <span class="muted">${c.nameEn ?? ''} · ${c.iso2}</span></p>` })}
<section aria-labelledby="cl-h">${sectionHead(ctx, { id: 'cl-h', title: t('travel.country.level') })}
  ${alertsTable(ctx, rows, { withCountry: false })}
  ${rows.length ? '' : html`<p class="muted">${t('travel.country.none')}</p>`}
</section>
<section aria-labelledby="cr-h">${sectionHead(ctx, { id: 'cr-h', title: t('travel.country.prep') })}
  <div class="c-cols2">
    <div class="c-aside-card"><h3>${t('travel.country.diseases')}</h3>${relPages.length ? html`<ul class="c-linklist">${relPages.map(({ dm, page }) => html`<li>${page ? html`<a href="${hrefFor(ctx, page)}">${L(ctx, page, 'title')}</a>` : (dm.name ?? dm.id)}</li>`)}</ul>` : html`<p class="muted">${t('none')}</p>`}</div>
    <div class="c-aside-card"><h3>${t('travel.country.vaccines')}</h3>${vaccines.length || masterVax.length ? html`<ul class="c-linklist">${vaccines.map((v) => html`<li><a href="${hrefFor(ctx, v)}">${L(ctx, v, 'title')}</a></li>`)}${masterVax.map((v) => html`<li><a href="${url('/vaccines/')}">${ctx.lang === 'zh-TW' ? v.name : v.nameEn}</a></li>`)}</ul>` : html`<p class="muted">${t('none')}</p>`}</div>
    <div class="c-aside-card"><h3>${t('travel.country.clinic')}</h3><p>${t('travel.country.clinic.d')}</p><a class="c-btn c-btn--ghost" href="${TRAVEL_CLINIC_URL}" rel="noopener">${t('travel.country.clinic.cta')} ↗</a></div>
  </div>
  ${docs.length ? html`<h3>${t('travel.country.docs')}</h3><ul class="c-linklist">${docs.map((d) => html`<li><a href="${hrefFor(ctx, d)}">${L(ctx, d, 'title')}</a> <span class="muted">${d.version}</span></li>`)}</ul>` : ''}
</section>
<section class="c-ask-inline">${askBox(ctx, { id: 'tcq', size: 'md', task: 'travel', placeholder: t('travel.country.ask', { name: cname(ctx, c) }) })}</section>
${provCard(ctx)}
${feedback(ctx, { page: ctx.path })}`;
}

export function pages(site) {
  const out = [{ path: '/travel/', lang: '*', props: {} }];
  for (const c of site.master.countries ?? []) out.push({ path: `/travel/${c.iso2}/`, lang: '*', props: { country: c } });
  return out;
}
void raw; void sourceCard;
