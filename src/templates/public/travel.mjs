// 出國與入境：仿官方「國際旅遊疫情建議等級表」——三級定義、目的地查詢、依等級／疾病分段的等級表、近 30 天國際重要疫情資訊；每國一頁。
// 資料：site.snapshots.countryLevels（每國一筆、Diseases[]；live 由 scripts/fetch-data.mjs 聚合成同形狀）與 travelAlerts（近 30 天消息）。欄位名容錯。
// 大多數國家不在等級表上（＝無旅遊疫情建議），頁面刻意保持短、平靜；無建議不做成標籤。
import { html, raw, jsonScript } from '../../../scripts/lib/render.mjs';
import { config } from '../../../site.config.mjs';
import * as JL from '../../../scripts/lib/jsonld.mjs';
import { ldFor, pageHead, sectionHead, askBox, hrefFor, L, diseasePage, publishedOf, feedback, pill } from './_partials.mjs';

export const TRAVEL_CLINIC_URL = `${config.legacyOrigin}/Category/List/`;
export const TRAVEL_LEVEL_PAGE = 'https://www.cdc.gov.tw/InternationalEpidemicLevel/Index/NlUwZUNvckRWQ09CbDJkRVFjaExjUT09';
const LEVEL_EN = { 1: 'Watch', 2: 'Alert', 3: 'Warning' };
const LEVEL_KEY = { 1: 'watch', 2: 'alert', 3: 'warning' };
const NEWS_MAX = 10;

const KEYS = {
  country: ['Country', 'country', 'CountryName', 'CountryZh', 'country_name', 'Name', '國家', '國家名稱', '國家/地區'],
  countryEn: ['CountryEn', 'CountryEnglish', 'country_en', 'EnglishName', 'NameEn', 'EnName', '英文國名'],
  iso2: ['Iso2', 'ISO2', 'iso2', 'ISO', 'Iso', 'CountryCode', 'Code'],
  disease: ['Disease', 'disease', 'DiseaseName', '疾病', '疾病名稱'],
  diseaseEn: ['DiseaseEn', 'disease_en'],
  diseaseId: ['DiseaseId', 'diseaseId'],
  level: ['Level', 'level', 'LevelName', 'AlertLevel', '等級', '警示等級'],
  levelCode: ['LevelCode', 'levelCode', 'Level_Code', 'LevelNo'],
  start: ['StartDate', 'startDate', 'Start', 'EffectiveDate', 'Date', 'PublishDate', 'ReleaseDate', '開始日期', '發布日期', '發布日'],
  summary: ['Summary', 'summary', 'Content', 'Description', 'Memo', 'Remark', '摘要', '內容'],
  area: ['Area', 'area', '區域說明'],
};
const pick = (o, names) => { for (const k of names) if (o?.[k] != null && o[k] !== '') return o[k]; return null; };

/** 等級文字／數字 → 0–3（0＝無建議；null＝不明） */
export function levelCodeOf(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v >= 0 && v <= 3 ? Math.trunc(v) : null;
  const s = String(v);
  if (/^[0-3]$/.test(s.trim())) return Number(s.trim());
  const m = s.match(/第\s*([一二三1-3])\s*級|level\s*([1-3])/i);
  if (m) { const x = m[1] ?? m[2]; return '一二三'.includes(x) ? '一二三'.indexOf(x) + 1 : Number(x); }
  if (/warning|警告/i.test(s)) return 3;
  if (/alert|警示/i.test(s)) return 2;
  if (/watch|注意/i.test(s)) return 1;
  if (/無旅遊疫情建議|^無|none/i.test(s)) return 0;
  return null;
}

/** 把一筆快照列正規化（task.mjs 也用） */
export function normRow(r) {
  const levelText = pick(r, KEYS.level);
  const lc = pick(r, KEYS.levelCode);
  const code = lc != null ? levelCodeOf(lc) : levelCodeOf(levelText);
  return {
    country: pick(r, KEYS.country), countryEn: pick(r, KEYS.countryEn), iso2: (pick(r, KEYS.iso2) ?? '').toString().toUpperCase().slice(0, 2) || null,
    disease: pick(r, KEYS.disease), diseaseEn: pick(r, KEYS.diseaseEn), diseaseId: pick(r, KEYS.diseaseId), level: levelText, code,
    start: pick(r, KEYS.start) ? String(pick(r, KEYS.start)).slice(0, 10) : null, summary: pick(r, KEYS.summary), area: pick(r, KEYS.area),
    diseases: Array.isArray(r?.Diseases) ? r.Diseases.map(normRow) : null,
  };
}
export const asRows = (snap) => (Array.isArray(snap?.data) ? snap.data : Array.isArray(snap) ? snap : []).filter((x) => x && typeof x === 'object').map(normRow);

function matchCountry(c, r) {
  if (r.iso2) return r.iso2 === c.iso2;
  const rc = String(r.country ?? '').toLowerCase();
  return !!rc && [c.name, c.nameEn].filter(Boolean).some((n) => rc === n.toLowerCase() || rc.startsWith(n.toLowerCase()));
}

/**
 * 每國的建議清單：優先用每國一筆的 Diseases[]；若 live 資料仍是「國家 × 疾病」平面列，就地合併。
 * 回傳 Map<iso2, entry[]>，entry = { disease, diseaseEn, diseaseId, code, start, summary, area }（只含 code ≥ 1）。
 */
export function advisoriesByCountry(site) {
  const countries = site.master.countries ?? [];
  const rows = asRows(site.snapshots?.countryLevels);
  const out = new Map(countries.map((c) => [c.iso2, []]));
  for (const c of countries) {
    const list = out.get(c.iso2);
    for (const r of rows.filter((x) => matchCountry(c, x))) {
      const subs = r.diseases ?? [r];
      for (const d of subs) {
        if (!d.disease || !(d.code > 0)) continue;
        const prev = list.find((x) => x.disease === d.disease);
        if (prev && (prev.code > d.code || (prev.code === d.code && String(prev.start ?? '') >= String(d.start ?? '')))) continue;
        if (prev) list.splice(list.indexOf(prev), 1);
        list.push({ disease: d.disease, diseaseEn: d.diseaseEn, diseaseId: d.diseaseId, code: d.code, start: d.start, summary: d.summary, area: d.area });
      }
    }
    list.sort((a, b) => b.code - a.code || String(b.start ?? '').localeCompare(String(a.start ?? '')));
  }
  return out;
}
const maxLevel = (list) => (list?.length ? Math.max(...list.map((e) => e.code)) : 0);

/** 近 30 天國際重要疫情資訊（依日期新到舊） */
export function recentNews(site, { days = 30 } = {}) {
  const rows = asRows(site.snapshots?.travelAlerts).filter((r) => r.disease && (r.country || r.iso2));
  const ref = site.snapshots?.travelAlerts?.meta?.dataDate ?? site.today;
  const from = ref ? new Date(Date.parse(`${String(ref).slice(0, 10)}T00:00:00Z`) - days * 864e5).toISOString().slice(0, 10) : null;
  return rows.filter((r) => !from || !r.start || r.start >= from).sort((a, b) => String(b.start ?? '').localeCompare(String(a.start ?? '')));
}

/** 疾病名稱 → 主檔（DiseaseId 優先；再完全相符；再包含） */
function diseaseMasterOf(site, e) {
  const ms = site.master.diseases ?? [];
  if (e.diseaseId) { const m = ms.find((d) => d.id === e.diseaseId); if (m) return m; }
  const name = String(e.disease ?? '').toLowerCase();
  if (!name) return null;
  const names = (d) => [d.name, d.nameEn, ...(d.aliases ?? [])].filter(Boolean).map((n) => String(n).toLowerCase());
  return ms.find((d) => names(d).includes(name)) ?? ms.find((d) => names(d).some((n) => n.length >= 2 && name.includes(n))) ?? null;
}
const cname = (ctx, c) => (ctx.lang === 'zh-TW' ? c.name : c.nameEn ?? c.name);
const dname = (ctx, site, e) => { if (ctx.lang === 'zh-TW') return e.disease; const m = diseaseMasterOf(site, e); return e.diseaseEn ?? m?.nameEn ?? e.disease; };
const levelName = (ctx, n) => (ctx.lang === 'zh-TW' ? `${ctx.t(`travel.level.${n}`)}（${LEVEL_EN[n]}）` : ctx.t(`travel.level.${n}`));
const levelPill = (ctx, code) => html`<span class="c-level c-level--${code} tv-lv tv-lv--${LEVEL_KEY[code]}">${levelName(ctx, code)}</span>`;
const svc = (site, slug) => (site.collections.services ?? []).find((s) => s.status === 'published' && (s.slug === slug || s.id === `service.${slug}`));

/** 疾病 → 相關疫苗（主檔 vaccines；幼兒合併疫苗不列；黃熱病、小兒麻痺另以文字提示） */
function vaccinesFor(ctx, entries) {
  const { site, t, url } = ctx;
  const ids = new Set(entries.map((e) => diseaseMasterOf(site, e)?.id).filter(Boolean));
  const pages = publishedOf(site, 'vaccines');
  const out = [];
  for (const v of site.master.vaccines ?? []) {
    if (v.id === 'vaccine.dtap-hib-ipv' || !v.diseases?.some((d) => ids.has(d))) continue;
    const page = pages.find((p) => p.id === v.id);
    out.push(page ? html`<a href="${hrefFor(ctx, page)}">${L(ctx, page, 'title')}</a>` : html`<a href="${url('/vaccines/')}">${ctx.lang === 'zh-TW' ? v.name : v.nameEn ?? v.name}</a>`);
  }
  const cert = svc(site, 'international-vaccination-certificate');
  if (ids.has('disease.yellow-fever')) out.push(cert ? html`<a href="${hrefFor(ctx, cert)}">${t('travel.vax.yf')}</a>` : html`${t('travel.vax.yf')}`);
  if (ids.has('disease.polio-afp')) out.push(html`${t('travel.vax.polio')}`);
  return out;
}

function clinicLink(ctx) {
  const s = svc(ctx.site, 'travel-clinic-appointment');
  return s ? html`<a href="${hrefFor(ctx, s)}">${ctx.t('travel.clinic.cta')}</a>` : html`<a href="${TRAVEL_CLINIC_URL}" rel="noopener">${ctx.t('travel.clinic.cta')} ↗</a>`;
}

/** 結果卡：無建議＝綠勾＋一般預防措施；有建議＝逐項疾病、等級、發布日、建議、疾病頁、相關疫苗 */
export function resultCard(ctx, c, entries, { more = true, headingLevel = 3 } = {}) {
  const { site, t, url, fmtDate } = ctx;
  const H = (s) => raw(`<h${headingLevel} class="tv-card__t">${s}</h${headingLevel}>`);
  const name = cname(ctx, c);
  if (!entries.length) {
    return html`<div class="tv-card tv-card--none" data-level="0">
  ${H(html`<span class="tv-ok" aria-hidden="true">✓</span> ${t('travel.result.none.t')}${headingLevel === 3 ? html` <span class="tv-card__c">· ${name}</span>` : ''}`)}
  <p>${t('travel.result.none.d', { name })}</p>
  <ul class="tv-prec">${[1, 2, 3].map((i) => html`<li>${t(`travel.prec.${i}`)}</li>`)}</ul>
  <p class="tv-card__foot">${clinicLink(ctx)}${more ? html` · <a href="${url(`/travel/${c.iso2}/`)}">${t('travel.result.more', { name })}</a>` : ''}</p>
</div>`;
  }
  const top = maxLevel(entries);
  const zhAttr = ctx.lang === 'zh-TW' ? '' : raw(' lang="zh-TW"');
  return html`<div class="tv-card tv-card--${LEVEL_KEY[top]}" data-level="${top}">
  ${H(html`${t('travel.result.has.t', { name, n: entries.length })}`)}
  <ul class="tv-advs">${entries.map((e) => {
    const m = diseaseMasterOf(site, e); const page = m ? diseasePage(ctx, m.id) : null; const vax = vaccinesFor(ctx, [e]);
    return html`<li class="tv-adv">
    <p class="tv-adv__h">${levelPill(ctx, e.code)} <strong>${page ? html`<a href="${hrefFor(ctx, page)}">${dname(ctx, site, e)}</a>` : dname(ctx, site, e)}</strong>${e.area ? html` <span class="muted">（${e.area}）</span>` : ''}${e.start ? html` <span class="muted">${t('travel.result.issued')} <time datetime="${e.start}">${fmtDate(e.start)}</time></span>` : ''}</p>
    ${e.summary ? html`<p class="tv-adv__s"${zhAttr}>${e.summary}</p>` : ''}
    ${vax.length ? html`<p class="tv-adv__v muted">${t('travel.result.vax')}：${vax.map((v, i) => html`${i ? '、' : ''}${v}`)}</p>` : ''}
  </li>`;
  })}</ul>
  ${more ? html`<p class="tv-card__foot">${clinicLink(ctx)} · <a href="${url(`/travel/${c.iso2}/`)}">${t('travel.result.more', { name })}</a></p>` : ''}
</div>`;
}

function provCard(ctx) {
  const { site, t, url, fmtDate } = ctx;
  const metas = [['countryLevels', t('travel.src.levels')], ['travelAlerts', t('travel.src.alerts')]];
  const lv = site.snapshots?.countryLevels?.meta ?? {};
  const page = lv.sourcePage ?? TRAVEL_LEVEL_PAGE;
  return html`<details class="c-source-card" data-group="ondemand"><summary>${t('source.card')} · ${t('travel.src.t')}</summary><dl>
    ${metas.map(([k, label]) => { const m = site.snapshots?.[k]?.meta ?? {}; const dd = m.dataDate ?? (m.fetchedAt ? String(m.fetchedAt).slice(0, 10) : null); return html`<div><dt>${label}</dt><dd>${pill(m.mode === 'live' ? t('travel.mode.live') : m.mode === 'missing' ? t('travel.mode.missing') : t('travel.mode.snapshot'), m.mode === 'live' ? 'ok' : 'warn')} ${dd ? html`${t('travel.src.dataDate')} <time datetime="${dd}">${fmtDate(dd)}</time>` : t('travel.nofetch')}${m.sourceUrl ? html` · <a href="${m.sourceUrl}" rel="noopener">ExportJSON</a>` : ''}${m.count != null ? ` · ${m.count}` : ''}</dd></div>`; })}
    <div><dt>${t('travel.src.page')}</dt><dd><a href="${page}" rel="noopener">${t('travel.src.page')} ↗</a></dd></div>
    <div><dt>${t('source.formats')}</dt><dd><a class="c-source-card__fmt" href="${url('/v1/country-levels.json', { noLang: true })}">/v1/country-levels.json</a> <a class="c-source-card__fmt" href="${url('/v1/travel-alerts.json', { noLang: true })}">/v1/travel-alerts.json</a></dd></div>
  </dl><p class="muted">${t('travel.src.note')}${lv.mode !== 'live' && lv.note ? html` <span lang="zh-TW">${lv.note}</span>` : ''}</p></details>`;
}

export function meta(ctx, props = {}) {
  const { t } = ctx;
  const extra = {};
  if (props.country) {
    const c = props.country;
    const jl = ldFor(ctx, null, [{ label: t('nav.travel'), href: '/travel/' }, { label: cname(ctx, c) }]);
    try { if (typeof JL.travelJsonLd === 'function') jl.push(JL.travelJsonLd(ctx, c, (advisoriesByCountry(ctx.site).get(c.iso2) ?? []).map((e) => ({ disease: e.disease, level: e.code, levelLabel: ctx.t(`travel.level.${e.code}`), advice: e.summary, publishedAt: e.start ?? undefined })))); } catch { /* optional */ }
    return { ...extra, title: `${cname(ctx, c)} · ${t('nav.travel')}`, description: t('travel.country.desc', { name: cname(ctx, c) }), jsonLd: jl };
  }
  return { ...extra, title: t('nav.travel'), description: t('travel.desc'), jsonLd: ldFor(ctx, null, [{ label: t('nav.travel') }]) };
}

/* 本頁專用樣式（只用 tokens.css 變數＋三級色），範圍限定在 .tv */
const STYLES = raw(`<style>
.tv{--tv-watch:#b07800;--tv-watch-bg:var(--warn-bg);--tv-watch-ink:var(--warn);--tv-alert:#c4511a;--tv-alert-bg:var(--alert-revised-bg);--tv-alert-ink:var(--alert-revised);--tv-warning:#9b1c1c;--tv-warning-bg:var(--status-peak-bg);--tv-warning-ink:var(--alert-superseded)}
.tv section{margin-block:var(--sp-6)}
.tv h2{font-size:var(--fs-xl)}
.tv .tv-lv{white-space:normal}
.tv .tv-lv--watch{background:var(--tv-watch-bg);color:var(--tv-watch-ink)}
.tv .tv-lv--alert{background:var(--tv-alert-bg);color:var(--tv-alert-ink)}
.tv .tv-lv--warning{background:var(--tv-warning-bg);color:var(--tv-warning-ink)}
.tv-defs{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--sp-3)}
.tv-def{border:1px solid var(--line);border-left:6px solid var(--tv-watch);border-radius:var(--radius);padding:var(--sp-3) var(--sp-4);background:var(--white)}
.tv-def--alert{border-left-color:var(--tv-alert)} .tv-def--warning{border-left-color:var(--tv-warning)}
.tv-def__n{display:block;font-weight:700;font-size:var(--fs-md)} .tv-def--watch .tv-def__n{color:var(--tv-watch-ink)} .tv-def--alert .tv-def__n{color:var(--tv-alert-ink)} .tv-def--warning .tv-def__n{color:var(--tv-warning-ink)}
.tv-def__d{margin:4px 0 0;font-size:var(--fs-sm);color:var(--ink-2)}
.tv-none{margin:var(--sp-3) 0 0;color:var(--ink-3);font-size:var(--fs-sm)}
.tv-lookup__form{display:flex;gap:var(--sp-2);max-width:560px;flex-wrap:wrap}
.tv-lookup__form .c-input{flex:1 1 240px;width:auto;min-width:0}
.tv-lookup__msg{margin:var(--sp-2) 0 0;font-size:var(--fs-sm);color:var(--ink-2)}
.tv-result{margin-top:var(--sp-3)} .tv-result:empty{display:none}
.tv-card{border:1px solid var(--line);border-left:6px solid var(--tv-watch);border-radius:var(--radius);padding:var(--sp-4);background:var(--white);max-width:860px}
.tv-card--alert{border-left-color:var(--tv-alert)} .tv-card--warning{border-left-color:var(--tv-warning)}
.tv-card--none{border-left-color:var(--status-stable);background:var(--ok-bg)}
.tv-card__t{font-size:var(--fs-lg);margin:0 0 var(--sp-2)} .tv-card__c{font-weight:400;color:var(--ink-2)}
.tv-ok{display:inline-grid;place-items:center;width:1.5em;height:1.5em;border-radius:50%;background:var(--status-stable);color:#fff;font-size:.85em;margin-right:4px}
.tv-prec{margin:var(--sp-2) 0;padding-left:1.2em} .tv-prec li{margin:2px 0}
.tv-advs{list-style:none;margin:0;padding:0}
.tv-adv{padding:var(--sp-2) 0;border-bottom:1px solid var(--line-2)} .tv-adv:last-child{border-bottom:0}
.tv-adv__h{margin:0;display:flex;flex-wrap:wrap;gap:4px var(--sp-2);align-items:baseline}
.tv-adv__s{margin:4px 0 0} .tv-adv__v{margin:4px 0 0}
.tv-card__foot{margin:var(--sp-3) 0 0;font-size:var(--fs-sm)}
.tv-band{border:1px solid var(--line);border-top:5px solid var(--tv-watch);border-radius:var(--radius);background:var(--white);padding:var(--sp-3) var(--sp-4);margin:var(--sp-3) 0}
.tv-band--alert{border-top-color:var(--tv-alert)} .tv-band--warning{border-top-color:var(--tv-warning)}
.tv-band__h{display:flex;flex-wrap:wrap;gap:4px var(--sp-3);align-items:baseline;justify-content:space-between}
.tv-band__h h3{margin:0;font-size:var(--fs-lg)} .tv-band--watch h3{color:var(--tv-watch-ink)} .tv-band--alert h3{color:var(--tv-alert-ink)} .tv-band--warning h3{color:var(--tv-warning-ink)}
.tv-band__sum{font-size:var(--fs-sm);color:var(--ink-3)}
.tv-band__empty{margin:var(--sp-2) 0 0;color:var(--ink-3)}
.tv-rows{list-style:none;margin:var(--sp-2) 0 0;padding:0}
.tv-row{display:grid;grid-template-columns:minmax(9em,14em) minmax(0,1fr);gap:var(--sp-2) var(--sp-4);padding:var(--sp-2) 0;border-top:1px solid var(--line-2)}
.tv-row__d{font-weight:700}
.tv-chips{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:6px}
.tv-chip{display:inline-block;border:1px solid var(--line);border-radius:var(--radius-pill);padding:3px 12px;font-size:var(--fs-sm);background:var(--white);color:var(--ink);text-decoration:none;overflow-wrap:anywhere}
.tv-chip:hover{border-color:var(--green-700);background:var(--green-50);color:var(--green-900)}
.tv-chip small{color:var(--ink-3)}
.tv-others{margin-top:var(--sp-3);font-size:var(--fs-sm)} .tv-others summary{cursor:pointer;color:var(--green-700)}
.tv-others .tv-chips{margin-top:var(--sp-2)}
.tv-news{list-style:none;margin:0;padding:0;max-width:860px}
.tv-news li{display:grid;grid-template-columns:7.5em minmax(0,1fr);gap:2px var(--sp-3);padding:var(--sp-2) 0;border-bottom:1px solid var(--line-2)}
.tv-news time{color:var(--ink-3);font-size:var(--fs-sm)}
.tv-news__w{font-weight:700} .tv-news__s{margin:2px 0 0;color:var(--ink-2)}
.tv-newsmore summary{cursor:pointer;color:var(--green-700);margin-top:var(--sp-2)}
.tv-prep{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--sp-3)}
.tv-prep>div{border:1px solid var(--line);border-radius:var(--radius);padding:var(--sp-3) var(--sp-4);background:var(--white);min-width:0}
.tv-prep h3{font-size:var(--fs-md);margin:0 0 var(--sp-2)} .tv-prep+h3{margin-top:var(--sp-5)} .tv-prep ul{margin:0;padding-left:1.1em}
@media (max-width:720px){
  .tv-defs,.tv-prep{grid-template-columns:1fr}
  .tv-row{grid-template-columns:1fr;gap:4px}
  .tv-news li{grid-template-columns:1fr}
}
</style>`);

/* 目的地查詢：前端顯示結果卡（不跳頁）；資料是本頁內嵌的小 JSON */
const LOOKUP_JS = raw(`<script>
(function(){var root=document.querySelector('[data-tv-lookup]');if(!root)return;
var data;try{data=JSON.parse(document.getElementById('tv-data').textContent)}catch(e){return}
var form=root.querySelector('form'),inp=root.querySelector('input'),out=root.querySelector('[data-tv-result]'),msg=root.querySelector('[data-tv-msg]');
function norm(s){return String(s||'').trim().toLowerCase().replace(/\\s+/g,' ')}
function find(q){q=norm(q);if(!q)return null;var hit=null;
data.c.forEach(function(c){if(hit)return;if(c.k.some(function(k){return k===q}))hit=c});
if(!hit)data.c.forEach(function(c){if(hit)return;if(c.k.some(function(k){return k.length>1&&(k.indexOf(q)===0||q.indexOf(k)===0)}))hit=c});
if(!hit&&q.length>1)data.c.forEach(function(c){if(hit)return;if(c.k.some(function(k){return k.indexOf(q)>=0}))hit=c});
return hit}
function show(){var c=find(inp.value);msg.textContent='';out.innerHTML='';
if(!c){if(norm(inp.value))msg.textContent=data.nf.replace('{q}',inp.value.trim());return}
var tpl=document.querySelector('[data-tv-card="'+c.i+'"]')||document.querySelector('[data-tv-card="none"]');
var node=tpl.cloneNode(true);node.hidden=false;node.removeAttribute('data-tv-card');
node.querySelectorAll('[data-tv-name]').forEach(function(el){el.textContent=c.n});
node.querySelectorAll('[data-tv-href]').forEach(function(el){el.setAttribute('href',c.h)});
out.appendChild(node);try{history.replaceState(null,'','#'+c.i)}catch(e){}}
form.addEventListener('submit',function(e){e.preventDefault();show()});
inp.addEventListener('change',show);
var h=(location.hash||'').slice(1).toUpperCase();if(/^[A-Z]{2}$/.test(h)){var c=data.c.filter(function(x){return x.i===h})[0];if(c){inp.value=c.n;show()}}
})();
</script>`);

function lookupSection(ctx, adv) {
  const { site, t, url } = ctx;
  const countries = site.master.countries ?? [];
  const withAdv = countries.filter((c) => adv.get(c.iso2)?.length);
  const none = countries.filter((c) => !adv.get(c.iso2)?.length);
  const payload = {
    nf: t('travel.lookup.notfound', { q: '{q}' }),
    c: countries.map((c) => ({ i: c.iso2, n: cname(ctx, c), h: url(`/travel/${c.iso2}/`), k: [c.name, c.nameEn, c.iso2].filter(Boolean).map((s) => s.toLowerCase()) })),
  };
  // 無建議國家共用一張卡（名稱與連結由前端填入）
  const noneTpl = html`<div class="tv-card tv-card--none" data-level="0">
  <h3 class="tv-card__t"><span class="tv-ok" aria-hidden="true">✓</span> ${t('travel.result.none.t')} <span class="tv-card__c">· <span data-tv-name></span></span></h3>
  <p>${raw(String(t('travel.result.none.d', { name: '\u0000' })).split('\u0000').map((s) => html`${s}`.s).join('<span data-tv-name></span>'))}</p>
  <ul class="tv-prec">${[1, 2, 3].map((i) => html`<li>${t(`travel.prec.${i}`)}</li>`)}</ul>
  <p class="tv-card__foot">${clinicLink(ctx)} · <a data-tv-href href="${url('/travel/')}">${raw(String(t('travel.result.more', { name: '\u0000' })).split('\u0000').map((s) => html`${s}`.s).join('<span data-tv-name></span>'))}</a></p>
</div>`;
  return html`<section class="tv-lookup" aria-labelledby="tv-lk-h" data-tv-lookup>
  <h2 id="tv-lk-h">${t('travel.lookup.t')}</h2>
  <form class="tv-lookup__form" action="${url('/travel/')}" method="get" role="search">
    <label for="tv-q" class="sr-only">${t('travel.lookup.label')}</label>
    <input id="tv-q" class="c-input" type="search" list="tv-list" autocomplete="off" placeholder="${t('travel.lookup.ph')}" aria-describedby="tv-lk-msg">
    <datalist id="tv-list">${countries.map((c) => html`<option value="${cname(ctx, c)}">${ctx.lang === 'zh-TW' ? c.nameEn : c.name}</option>`)}</datalist>
    <button type="submit" class="c-btn">${t('travel.lookup.go')}</button>
  </form>
  <p class="tv-lookup__msg" id="tv-lk-msg" data-tv-msg role="status"></p>
  <div class="tv-result" data-tv-result aria-live="polite"></div>
  <div hidden>
    <div data-tv-card="none" hidden>${noneTpl}</div>
    ${withAdv.map((c) => html`<div data-tv-card="${c.iso2}" hidden>${resultCard(ctx, c, adv.get(c.iso2))}</div>`)}
  </div>
  <details class="tv-others"><summary>${t('travel.table.others', { n: none.length })}</summary>
    <ul class="tv-chips">${none.map((c) => html`<li><a class="tv-chip" href="${url(`/travel/${c.iso2}/`)}">${cname(ctx, c)}</a></li>`)}</ul>
  </details>
  <script type="application/json" id="tv-data">${raw(jsonScript(payload))}</script>
</section>`;
}

/** 等級表：第三級 → 第一級分段；每段依疾病列國家／地區 chip */
function levelTable(ctx, adv) {
  const { site, t, url } = ctx;
  const countries = site.master.countries ?? [];
  const bands = [3, 2, 1].map((lv) => {
    const groups = new Map();
    for (const c of countries) for (const e of adv.get(c.iso2) ?? []) {
      if (e.code !== lv) continue;
      const k = e.disease;
      if (!groups.has(k)) groups.set(k, { e, items: [] });
      groups.get(k).items.push({ c, e });
    }
    const list = [...groups.values()].sort((a, b) => b.items.length - a.items.length || String(a.e.disease).localeCompare(String(b.e.disease), 'zh-Hant'));
    const nCountries = new Set(list.flatMap((g) => g.items.map((x) => x.c.iso2))).size;
    const nItems = list.reduce((n, g) => n + g.items.length, 0);
    return { lv, list, nCountries, nItems };
  });
  return html`<section aria-labelledby="tv-tb-h">
  ${sectionHead(ctx, { id: 'tv-tb-h', title: t('travel.table.t') })}
  <p class="muted">${t('travel.table.note')}</p>
  ${bands.map(({ lv, list, nCountries, nItems }) => html`<section class="tv-band tv-band--${LEVEL_KEY[lv]}" aria-labelledby="tv-b${lv}">
    <div class="tv-band__h"><h3 id="tv-b${lv}">${levelName(ctx, lv)}</h3><span class="tv-band__sum">${nItems ? t('travel.table.sum', { level: t(`travel.level.${lv}`), c: nCountries, n: nItems }) : ''}</span></div>
    ${list.length ? html`<ul class="tv-rows">${list.map((g) => {
      const m = diseaseMasterOf(site, g.e); const page = m ? diseasePage(ctx, m.id) : null;
      return html`<li class="tv-row"><div class="tv-row__d">${page ? html`<a href="${hrefFor(ctx, page)}">${dname(ctx, site, g.e)}</a>` : dname(ctx, site, g.e)}</div>
      <ul class="tv-chips">${g.items.map(({ c, e }) => html`<li><a class="tv-chip" href="${url(`/travel/${c.iso2}/`)}">${cname(ctx, c)}${e.area ? html` <small${ctx.lang === 'zh-TW' ? '' : raw(' lang="zh-TW"')}>${e.area}</small>` : ''}</a></li>`)}</ul></li>`;
    })}</ul>` : html`<p class="tv-band__empty">${t('travel.table.none')}</p>`}
  </section>`)}
</section>`;
}

function newsList(ctx, rows, { max = NEWS_MAX, withCountry = true } = {}) {
  const { site, t, fmtDate } = ctx;
  if (!rows.length) return html`<p class="muted">${t('travel.news.empty')}</p>`;
  const byIso = new Map((site.master.countries ?? []).map((c) => [c.iso2, c]));
  const zhAttr = ctx.lang === 'zh-TW' ? '' : raw(' lang="zh-TW"');
  const li = (r) => { const c = byIso.get(r.iso2); const who = c ? cname(ctx, c) : (r.country ?? r.iso2); return html`<li><time datetime="${r.start ?? ''}">${r.start ? fmtDate(r.start) : '—'}</time><div><span class="tv-news__w">${withCountry ? html`${c ? html`<a href="${ctx.url(`/travel/${c.iso2}/`)}">${who}</a>` : who} · ` : ''}${dname(ctx, site, r)}</span>${r.summary ? html`<p class="tv-news__s"${zhAttr}>${r.summary}</p>` : ''}</div></li>`; };
  const head = rows.slice(0, max); const rest = rows.slice(max);
  return html`<ol class="tv-news">${head.map(li)}</ol>${rest.length ? html`<details class="tv-newsmore"><summary>${t('travel.news.more', { n: rest.length })}</summary><ol class="tv-news">${rest.map(li)}</ol></details>` : ''}`;
}

function defsSection(ctx) {
  const { t } = ctx;
  return html`<section aria-labelledby="tv-df-h">
  <h2 id="tv-df-h" class="sr-only">${t('travel.def.t')}</h2>
  <ol class="tv-defs">${[1, 2, 3].map((n) => html`<li class="tv-def tv-def--${LEVEL_KEY[n]}"><span class="tv-def__n">${levelName(ctx, n)}</span><p class="tv-def__d">${t(`travel.level.${n}.d`)}</p></li>`)}</ol>
  <p class="tv-none">${t('travel.level.none.d')}</p>
</section>`;
}

export function render(ctx, props = {}) {
  const { site, t } = ctx;
  const adv = advisoriesByCountry(site);
  if (props.country) return renderCountry(ctx, props.country, adv);
  const news = recentNews(site);
  return html`${STYLES}<div class="tv">
${pageHead(ctx, { trail: [{ label: t('nav.travel') }], h1: t('nav.travel'), lead: t('travel.lead') })}
${defsSection(ctx)}
${lookupSection(ctx, adv)}
${levelTable(ctx, adv)}
<section aria-labelledby="tv-nw-h">
  ${sectionHead(ctx, { id: 'tv-nw-h', title: t('travel.news.t'), note: t('travel.news.note') })}
  ${newsList(ctx, news)}
</section>
<section class="c-ask-inline" aria-labelledby="ta-h"><h2 id="ta-h">${t('travel.ask')}</h2>${askBox(ctx, { id: 'tq', size: 'md', task: 'travel', placeholder: t('travel.ask.ph') })}</section>
${provCard(ctx)}
${feedback(ctx, { page: ctx.path })}
</div>${LOOKUP_JS}`;
}

function renderCountry(ctx, c, adv) {
  const { site, t, url } = ctx;
  const entries = adv.get(c.iso2) ?? [];
  const lv = maxLevel(entries);
  const news = recentNews(site).filter((r) => matchCountry(c, r));
  const head = pageHead(ctx, { trail: [{ label: t('nav.travel'), href: '/travel/' }, { label: cname(ctx, c) }], h1: t('travel.country.h1', { name: cname(ctx, c) }), lead: t('travel.country.lead', { region: c.region ?? '' }), tags: html`<p>${lv ? levelPill(ctx, lv) : html`<span class="muted">${t('travel.level.0')}</span>`} <span class="muted">${c.nameEn ?? ''} · ${c.iso2}</span></p>` });
  const cert = svc(site, 'international-vaccination-certificate');
  const newsBlock = news.length ? html`<section aria-labelledby="cn-h">${sectionHead(ctx, { id: 'cn-h', title: t('travel.country.news', { name: cname(ctx, c) }), note: t('travel.news.note') })}${newsList(ctx, news, { withCountry: false })}</section>` : '';
  if (!entries.length) {
    // 無建議：平靜、簡短
    return html`${STYLES}<div class="tv">${head}
<section aria-labelledby="cl-h"><h2 id="cl-h" class="sr-only">${t('travel.country.level')}</h2>${resultCard(ctx, c, [], { more: false, headingLevel: 2 })}</section>
${newsBlock}
<p class="muted">${t('travel.country.none.more')} <a href="${url('/travel/')}">${t('travel.table.t')}</a></p>
<section class="c-ask-inline">${askBox(ctx, { id: 'tcq', size: 'md', task: 'travel', placeholder: t('travel.country.ask', { name: cname(ctx, c) }) })}</section>
${provCard(ctx)}
${feedback(ctx, { page: ctx.path })}</div>`;
  }
  const related = new Map();
  for (const e of entries) { const m = diseaseMasterOf(site, e); if (m) related.set(m.id, m); }
  const relPages = [...related.values()].map((m) => ({ m, page: diseasePage(ctx, m.id) }));
  const vax = vaccinesFor(ctx, entries);
  const docs = site.collections.documents.filter((d) => d.isCurrent && (d.countries?.includes(c.iso2) || (d.tasks?.includes('travel') && d.diseases?.some((x) => related.has(x)))));
  return html`${STYLES}<div class="tv">${head}
<section aria-labelledby="cl-h"><h2 id="cl-h" class="sr-only">${t('travel.country.level')}</h2>${resultCard(ctx, c, entries, { more: false, headingLevel: 2 })}</section>
<section aria-labelledby="cr-h">${sectionHead(ctx, { id: 'cr-h', title: t('travel.country.prep') })}
  <div class="tv-prep">
    <div><h3>${t('travel.country.diseases')}</h3><ul>${relPages.map(({ m, page }) => html`<li>${page ? html`<a href="${hrefFor(ctx, page)}">${L(ctx, page, 'title')}</a>` : (ctx.lang === 'zh-TW' ? m.name : m.nameEn ?? m.name)}</li>`)}</ul></div>
    <div><h3>${t('travel.country.vaccines')}</h3>${vax.length ? html`<ul>${vax.map((v) => html`<li>${v}</li>`)}</ul>` : html`<p class="muted">${t('travel.vax.none')}</p>`}</div>
    <div><h3>${t('travel.country.clinic')}</h3><p>${t('travel.country.clinic.d')}</p><p>${clinicLink(ctx)}</p>${cert ? html`<p><a href="${hrefFor(ctx, cert)}">${t('travel.cert.t')}</a></p>` : ''}<p class="muted"><a href="${TRAVEL_CLINIC_URL}" rel="noopener">${t('travel.country.clinic.cta')} ↗</a></p></div>
  </div>
  ${docs.length ? html`<h3>${t('travel.country.docs')}</h3><ul class="c-linklist">${docs.map((d) => html`<li><a href="${hrefFor(ctx, d)}">${L(ctx, d, 'title')}</a> <span class="muted">${d.version}</span></li>`)}</ul>` : ''}
</section>
${newsBlock}
<section class="c-ask-inline">${askBox(ctx, { id: 'tcq', size: 'md', task: 'travel', placeholder: t('travel.country.ask', { name: cname(ctx, c) }) })}</section>
${provCard(ctx)}
${feedback(ctx, { page: ctx.path })}</div>`;
}

export function pages(site) {
  const out = [{ path: '/travel/', lang: '*', props: {} }];
  for (const c of site.master.countries ?? []) out.push({ path: `/travel/${c.iso2}/`, lang: '*', props: { country: c } });
  return out;
}
