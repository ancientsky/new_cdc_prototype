// 出國與入境（第四輪「目的地決策」）：查目的地 → 近 30 天變化 → 世界地圖 → 全球背景提醒 → 針對性建議等級表 → 近 30 天國際重要疫情資訊；每國一頁（含旅程三階段）。
// 資料：site.snapshots.countryLevels（每國一筆、Diseases[]；Background:true＝全球背景提醒，不逐國列）、countryEvents（事件流，算近 30 天變化）、travelAlerts（近 30 天消息）。欄位名容錯，缺新欄位時退回既有行為。
// 針對性等級＝排除背景提醒後的最高等級；沒有針對性建議的國家頁面刻意保持平靜（綠勾＋一般預防措施）。契約見 ARCHITECTURE.md §12.2。
import { html, raw, jsonScript } from '../../../scripts/lib/render.mjs';
import { config } from '../../../site.config.mjs';
import * as JL from '../../../scripts/lib/jsonld.mjs';
import { ldFor, pageHead, sectionHead, askBox, hrefFor, L, diseasePage, publishedOf, feedback, pill } from './_partials.mjs';
import * as TravelMap from './_travel-map.mjs';

export const TRAVEL_CLINIC_URL = null; // 現行官網門診名單頁 ID 未確認；一律連站內 /apply/travel-clinic-appointment/
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

/** 把一筆快照列正規化（task.mjs 也用）。Background／Targeted* 為第四輪新欄位，缺則為 null／false。 */
export function normRow(r) {
  const levelText = pick(r, KEYS.level);
  const lc = pick(r, KEYS.levelCode);
  const code = lc != null ? levelCodeOf(lc) : levelCodeOf(levelText);
  const isoList = String(r?.ISO3166 ?? pick(r, KEYS.iso2) ?? '').toUpperCase().split(/[\s,、;]+/).filter((x) => /^[A-Z]{2}$/.test(x));
  return {
    country: pick(r, KEYS.country), countryEn: pick(r, KEYS.countryEn), iso2: (pick(r, KEYS.iso2) ?? '').toString().toUpperCase().slice(0, 2) || null, isoList,
    disease: pick(r, KEYS.disease), diseaseEn: pick(r, KEYS.diseaseEn), diseaseId: pick(r, KEYS.diseaseId), level: levelText, code,
    start: pick(r, KEYS.start) ? String(pick(r, KEYS.start)).slice(0, 10) : null, summary: pick(r, KEYS.summary), area: pick(r, KEYS.area),
    bg: r?.Background === true, targetedCode: r?.TargetedLevelCode != null ? levelCodeOf(r.TargetedLevelCode) : null,
    diseases: Array.isArray(r?.Diseases) ? r.Diseases.map(normRow) : null,
  };
}
export const asRows = (snap) => (Array.isArray(snap?.data) ? snap.data : Array.isArray(snap) ? snap : []).filter((x) => x && typeof x === 'object').map(normRow);

function matchCountry(c, r) {
  if (r.iso2) return r.iso2 === c.iso2;
  const rc = String(r.country ?? '').toLowerCase();
  return !!rc && [c.name, c.nameEn].filter(Boolean).some((n) => rc === n.toLowerCase() || rc.startsWith(n.toLowerCase()));
}
/** 國際重要疫情資訊（一則可涵蓋多國）：ISO3166 清單優先；沒有才比對國名 */
function newsMatches(c, r) {
  if (r.isoList?.length) return r.isoList.includes(c.iso2);
  const zh = String(r.country ?? '').split(/[,、]/).map((x) => x.trim());
  if (c.name && zh.includes(c.name)) return true;
  const en = String(r.countryEn ?? '').toLowerCase();
  return !!(c.nameEn && en && en.includes(c.nameEn.toLowerCase()));
}

const bgKey = (disease, code) => `${disease}|${code}`;
/** 全球背景提醒清單：優先用 meta.background；沒有就由 Diseases[].Background 旗標推得 */
function backgroundFromSnapshot(site, adv) {
  const metaList = site.snapshots?.countryLevels?.meta?.background;
  if (Array.isArray(metaList) && metaList.length) {
    return metaList.filter((b) => b?.Disease).map((b) => ({
      disease: b.Disease, diseaseEn: b.DiseaseEn ?? null, diseaseId: b.DiseaseId ?? null, code: levelCodeOf(b.LevelCode ?? b.Level) ?? 1,
      n: Number(b.countries) || 0, share: b.share ?? null, since: b.since ?? null, latest: b.latest ?? null, summary: b.Summary ?? null,
    })).sort((a, b) => b.n - a.n);
  }
  const g = new Map();
  for (const list of adv.values()) for (const e of list) {
    if (!e.bg) continue;
    const k = bgKey(e.disease, e.code);
    const x = g.get(k) ?? { disease: e.disease, diseaseEn: e.diseaseEn, diseaseId: e.diseaseId, code: e.code, n: 0, share: null, since: e.start, latest: e.start, summary: e.summary };
    x.n += 1; if (e.start && (!x.since || e.start < x.since)) x.since = e.start; if (e.start && (!x.latest || e.start > x.latest)) x.latest = e.start;
    g.set(k, x);
  }
  return [...g.values()].sort((a, b) => b.n - a.n);
}

/**
 * 全站旅遊資料模型（模板與首頁／任務頁共用）。
 *  adv：Map<iso2, entry[]>（含主檔所有國家＋快照裡主檔沒有的國家；entry 含 bg 旗標；只含 code ≥ 1）
 *  countries：主檔國家＋synthetic 國家（無頁面）；background：全球背景提醒清單
 */
export function travelModel(site) {
  const masters = site.master.countries ?? [];
  const rows = asRows(site.snapshots?.countryLevels);
  const byIso = new Map(); const noIso = [];
  for (const r of rows) { if (r.iso2) { if (!byIso.has(r.iso2)) byIso.set(r.iso2, []); byIso.get(r.iso2).push(r); } else noIso.push(r); }
  const build = (rs) => {
    const list = [];
    for (const r of rs) for (const d of r.diseases ?? [r]) {
      if (!d.disease || !(d.code > 0)) continue;
      const key = `${d.disease}|${d.area ?? ''}`;
      const prev = list.find((x) => `${x.disease}|${x.area ?? ''}` === key);
      if (prev && (prev.code > d.code || (prev.code === d.code && String(prev.start ?? '') >= String(d.start ?? '')))) continue;
      if (prev) list.splice(list.indexOf(prev), 1);
      list.push({ disease: d.disease, diseaseEn: d.diseaseEn, diseaseId: d.diseaseId, code: d.code, start: d.start, summary: d.summary, area: d.area, bg: d.bg });
    }
    return list;
  };
  const adv = new Map(); const extras = [];
  for (const c of masters) adv.set(c.iso2, build([...(byIso.get(c.iso2) ?? []), ...noIso.filter((r) => matchCountry(c, r))]));
  for (const [iso, rs] of byIso) if (!adv.has(iso)) { adv.set(iso, build(rs)); extras.push({ iso2: iso, name: rs[0].country ?? iso, nameEn: rs[0].countryEn ?? null, region: null, synthetic: true }); }
  const background = backgroundFromSnapshot(site, adv);
  const metaKeys = new Set(background.map((b) => bgKey(b.disease, b.code)));
  for (const list of adv.values()) {
    for (const e of list) if (metaKeys.has(bgKey(e.disease, e.code))) e.bg = true;
    list.sort((a, b) => b.code - a.code || String(b.start ?? '').localeCompare(String(a.start ?? '')));
  }
  return { adv, countries: [...masters, ...extras], masters, extras, background };
}
/** 相容舊呼叫：每國建議清單（含背景項目，以 bg 旗標區分） */
export const advisoriesByCountry = (site) => travelModel(site).adv;
const targetedOf = (list) => (list ?? []).filter((e) => !e.bg);
const backgroundOf = (list) => (list ?? []).filter((e) => e.bg);
const maxLevel = (list) => (list?.length ? Math.max(...list.map((e) => e.code)) : 0);

const dayShift = (iso, days) => new Date(Date.parse(`${String(iso).slice(0, 10)}T00:00:00Z`) + days * 864e5).toISOString().slice(0, 10);
const CHANGE_KINDS = ['new', 'raised', 'lowered', 'lifted'];
/** 近 N 天變化（事件快照）。無事件快照：有 meta.changeSummary30 就只給數字；都沒有回 null。 */
export function changeData(site, today, { days = 30 } = {}) {
  const evs = site.snapshots?.countryEvents?.data;
  if (!Array.isArray(evs) || !evs.length) {
    const m = site.snapshots?.countryLevels?.meta?.changeSummary30;
    return m ? { counts: Object.fromEntries(CHANGE_KINDS.map((k) => [k, Number(m[k]) || 0])), list: [], summaryOnly: true } : null;
  }
  const from = today ? dayShift(today, -days) : null;
  const list = evs.filter((e) => e && CHANGE_KINDS.includes(e.kind) && e.Disease && (!from || String(e.date) >= from))
    .map((e) => ({ date: String(e.date).slice(0, 10), iso2: e.ISO2 ?? null, country: e.Country ?? null, countryEn: e.CountryEn ?? null, disease: e.Disease, diseaseEn: e.DiseaseEn ?? null, diseaseId: e.DiseaseId ?? null, area: e.Area ?? null, kind: e.kind, from: e.from ?? null, to: e.to ?? 0 }))
    .sort((a, b) => b.date.localeCompare(a.date) || b.to - a.to || String(a.iso2).localeCompare(String(b.iso2)));
  const counts = Object.fromEntries(CHANGE_KINDS.map((k) => [k, list.filter((e) => e.kind === k).length]));
  return { counts, list, summaryOnly: false };
}

/** 首頁／任務頁用的一組統計（針對性） */
export function travelStats(site, today) {
  const { adv } = travelModel(site);
  const st = { level1: 0, level2: 0, level3: 0, withAdv: 0, hasData: adv.size > 0 && [...adv.values()].some((l) => l.length) };
  for (const list of adv.values()) { const m = maxLevel(targetedOf(list)); if (m >= 1) { st[`level${m}`] += 1; st.withAdv += 1; } }
  st.change = changeData(site, today)?.counts ?? null;
  return st;
}

/** 近 30 天國際重要疫情資訊（依日期新到舊） */
export function recentNews(site, { days = 30 } = {}) {
  const rows = asRows(site.snapshots?.travelAlerts).filter((r) => r.disease && (r.country || r.iso2));
  const ref = site.snapshots?.travelAlerts?.meta?.dataDate ?? site.today;
  const from = ref ? dayShift(ref, -days) : null;
  return rows.filter((r) => !from || !r.start || r.start >= from).sort((a, b) => String(b.start ?? '').localeCompare(String(a.start ?? '')));
}

/** 疾病名稱 → 主檔（DiseaseId 優先；再完全相符；再包含）。比對時全形／半形斜線視為相同 */
const normName = (s) => String(s ?? '').toLowerCase().replace(/／/g, '/').replace(/\s+/g, '');
function diseaseMasterOf(site, e) {
  const ms = site.master.diseases ?? [];
  if (e.diseaseId) { const m = ms.find((d) => d.id === e.diseaseId); if (m) return m; }
  const name = normName(e.disease);
  if (!name) return null;
  const names = (d) => [d.name, d.nameEn, ...(d.aliases ?? [])].filter(Boolean).map(normName);
  return ms.find((d) => names(d).includes(name)) ?? ms.find((d) => names(d).some((n) => n.length >= 2 && name.includes(n))) ?? null;
}
const cname = (ctx, c) => (ctx.lang === 'zh-TW' ? c.name ?? c.nameEn : c.nameEn ?? c.name) ?? c.iso2;
const dname = (ctx, site, e) => { if (ctx.lang === 'zh-TW') return e.disease; const m = diseaseMasterOf(site, e); return e.diseaseEn ?? m?.nameEn ?? e.disease; };
const levelName = (ctx, n) => (ctx.lang === 'zh-TW' ? `${ctx.t(`travel.level.${n}`)}（${LEVEL_EN[n]}）` : ctx.t(`travel.level.${n}`));
const levelPill = (ctx, code) => html`<span class="c-level c-level--${code} tv-lv tv-lv--${LEVEL_KEY[code]}">${levelName(ctx, code)}</span>`;
const lvShort = (ctx, n) => (n >= 1 && n <= 3 ? ctx.t(`travel.lvs.${n}`) : '');
const svc = (site, slug) => (site.collections.services ?? []).find((s) => s.status === 'published' && (s.slug === slug || s.id === `service.${slug}`));
/** 把 i18n 字串裡的 {key} 換成 html 片段（連結等），其餘文字照常跳脫 */
const fill = (str, vars) => raw(String(str).split(/(\{\w+\})/).map((p) => { const m = p.match(/^\{(\w+)\}$/); return m && m[1] in vars ? html`${vars[m[1]]}`.s : html`${p}`.s; }).join(''));
const PH = (...keys) => Object.fromEntries(keys.map((k) => [k, `{${k}}`]));

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
  // 服務頁一律存在（content/services/travel-clinic-appointment.json）；若缺則連 /apply/ 總覽，避免輸出外部未確認連結。
  return s ? html`<a href="${hrefFor(ctx, s)}">${ctx.t('travel.clinic.cta')}</a>` : html`<a href="${ctx.url('/apply/')}">${ctx.t('travel.clinic.cta')}</a>`;
}

/** 持續時間：「自 2015 年起 · 11 年」；超過 3 年另標長期建議 */
export function durationOf(ctx, start) {
  if (!start || !ctx.today) return null;
  const days = (Date.parse(`${String(ctx.today).slice(0, 10)}T00:00:00Z`) - Date.parse(`${String(start).slice(0, 10)}T00:00:00Z`)) / 864e5;
  if (!(days >= 0)) return null;
  const years = Math.floor(days / 365.25);
  const months = Math.floor(days / 30.44);
  const text = years >= 1 ? ctx.t('travel.dur.years', { year: String(start).slice(0, 4), n: years })
    : months >= 1 ? ctx.t('travel.dur.months', { n: months }) : ctx.t('travel.dur.new');
  return { text, long: days > 3 * 365.25 };
}

/** 一行淡字：背景提醒（只在結果卡末與目的地頁出現） */
function bgLine(ctx, items) {
  if (!items?.length) return '';
  const { site, t } = ctx;
  const list = items.map((e) => `${dname(ctx, site, e)}${e.code ? `（${lvShort(ctx, e.code)}）` : ''}`).join(ctx.lang === 'zh-TW' ? '、' : ', ');
  return html`<p class="tv-bgline">${t('travel.bg.line', { list })}</p>`;
}

/** 結果卡：無針對性建議＝綠勾＋一般預防措施；有＝逐項疾病、等級、發布日、持續時間、建議（背景提醒只在卡末一行淡字） */
export function resultCard(ctx, c, entries, { more = true, headingLevel = 3, vax = true, bg = null } = {}) {
  const { site, t, url, fmtDate } = ctx;
  const H = (s) => raw(`<h${headingLevel} class="tv-card__t">${s}</h${headingLevel}>`);
  const name = cname(ctx, c);
  const tg = targetedOf(entries);
  const bgItems = bg ?? backgroundOf(entries);
  const href = c.synthetic ? null : url(`/travel/${c.iso2}/`);
  if (!tg.length) {
    return html`<div class="tv-card tv-card--none" data-level="0">
  ${H(html`<span class="tv-ok" aria-hidden="true">✓</span> ${t('travel.result.none.t')}${headingLevel === 3 ? html` <span class="tv-card__c">· ${name}</span>` : ''}`)}
  <p>${t('travel.result.none.d', { name })}</p>
  <ul class="tv-prec">${[1, 2, 3].map((i) => html`<li>${t(`travel.prec.${i}`)}</li>`)}</ul>
  ${bgLine(ctx, bgItems)}
  ${more ? html`<p class="tv-card__foot">${clinicLink(ctx)}${href ? html` · <a href="${href}">${t('travel.result.more', { name })}</a>` : ''}</p>` : ''}
</div>`;
  }
  const top = maxLevel(tg);
  const zhAttr = ctx.lang === 'zh-TW' ? '' : raw(' lang="zh-TW"');
  return html`<div class="tv-card tv-card--${LEVEL_KEY[top]}" data-level="${top}">
  ${H(html`${t('travel.result.has.t', { name, n: tg.length })}`)}
  <ul class="tv-advs">${tg.map((e) => {
    const m = diseaseMasterOf(site, e); const page = m ? diseasePage(ctx, m.id) : null; const vs = vax ? vaccinesFor(ctx, [e]) : []; const du = durationOf(ctx, e.start);
    return html`<li class="tv-adv">
    <p class="tv-adv__h">${levelPill(ctx, e.code)} <strong>${page ? html`<a href="${hrefFor(ctx, page)}">${dname(ctx, site, e)}</a>` : dname(ctx, site, e)}</strong>${e.area ? html` <span class="muted">（${e.area}）</span>` : ''}${e.start ? html` <span class="muted">${t('travel.result.issued')} <time datetime="${e.start}">${fmtDate(e.start)}</time></span>` : ''}${du ? html` <span class="muted tv-adv__dur">${du.text}</span>` : ''}${du?.long ? html` <span class="tv-longterm" title="${t('travel.longterm.d')}">${t('travel.longterm')}</span>` : ''}</p>
    ${e.summary ? html`<p class="tv-adv__s"${zhAttr}>${e.summary}</p>` : ''}
    ${vs.length ? html`<p class="tv-adv__v muted">${t('travel.result.vax')}：${vs.map((v, i) => html`${i ? '、' : ''}${v}`)}</p>` : ''}
  </li>`;
  })}</ul>
  ${bgLine(ctx, bgItems)}
  ${more && href ? html`<p class="tv-card__foot">${clinicLink(ctx)} · <a href="${href}">${t('travel.result.more', { name })}</a></p>` : ''}
</div>`;
}

/* ───── 旅程三階段：純規則生成（疾病主檔 vaccines／transmission；缺才用疾病名關鍵字） ───── */
const ROUTE_ORDER = ['vector', 'resp', 'animal', 'food', 'fluid'];
const KEYWORD_ROUTES = [
  ['vector', /登革|屈公|茲卡|瘧疾|黃熱|西尼羅|日本腦炎|裂谷|恙蟲|斑疹|萊姆|dengue|chikungunya|zika|malaria|yellow fever/i],
  ['resp', /麻疹|流感|新冠|M痘|白喉|腮腺|百日咳|結核|腦脊髓膜|measles|influenza|covid|mpox|diphtheria/i],
  ['animal', /MERS|中東呼吸|新型A型流感|狂犬|漢他|立百|拉薩|mers|nipah|rabies/i],
  ['food', /霍亂|小兒麻痺|傷寒|痢疾|A型肝炎|E型肝炎|cholera|polio|typhoid/i],
  ['fluid', /伊波拉|馬堡|愛滋|B型肝炎|C型肝炎|ebola|marburg|hiv/i],
];
/** 傳播途徑 → 旅途中的防護類別（vector 蚊媒／resp 飛沫空氣／animal 動物／food 食水／fluid 體液接觸）；空集合＝無法判斷 */
export function routesOf(master, diseaseName) {
  const tr = new Set(master?.transmission ?? []);
  const out = new Set();
  if (tr.has('vector')) out.add('vector');
  if (tr.has('droplet') || tr.has('airborne')) out.add('resp');
  if (tr.has('zoonotic')) out.add('animal');
  if (tr.has('foodborne') || tr.has('waterborne')) out.add('food');
  if ((!tr.has('vector') && (tr.has('bloodborne') || tr.has('sexual'))) || (tr.has('contact') && !out.size)) out.add('fluid');
  if (!out.size) for (const [r, re] of KEYWORD_ROUTES) if (re.test(String(diseaseName ?? ''))) out.add(r);
  return out;
}

function journey(ctx, c, tg) {
  const { site, t, url } = ctx;
  const sep = ctx.lang === 'zh-TW' ? '、' : ', ';
  const groups = new Map(ROUTE_ORDER.map((r) => [r, []]));
  const other = [];
  for (const e of tg) {
    const nm = dname(ctx, site, e);
    const rs = routesOf(diseaseMasterOf(site, e), e.disease);
    if (!rs.size) { if (!other.includes(nm)) other.push(nm); continue; }
    for (const r of rs) if (!groups.get(r).includes(nm)) groups.get(r).push(nm);
  }
  const vax = tg.length ? vaccinesFor(ctx, tg) : [];
  const cert = svc(site, 'international-vaccination-certificate');
  const lv3 = tg.some((e) => e.code === 3);
  const before = [
    lv3 ? html`<li class="tv-st__warn">${t('travel.j.b.l3')}</li>` : '',
    html`<li>${clinicLink(ctx)}</li>`,
    vax.length ? html`<li>${fill(t('travel.j.b.vax', PH('list')), { list: raw(vax.map((v, i) => `${i ? sep : ''}${v}`).join('')) })}</li>` : html`<li>${t('travel.vax.none')}</li>`,
    cert ? html`<li><a href="${hrefFor(ctx, cert)}">${t('travel.cert.t')}</a></li>` : '',
    tg.length ? html`<li>${t('travel.j.b.recheck')}</li>` : '',
  ];
  const during = [];
  for (const r of ROUTE_ORDER) if (groups.get(r).length) during.push(html`<li>${t(`travel.j.d.${r}`, { list: groups.get(r).join(sep) })}</li>`);
  if (other.length) during.push(html`<li>${t('travel.j.d.other', { list: other.join(sep) })}</li>`);
  if (!during.length) for (const i of [1, 2]) during.push(html`<li>${t(`travel.prec.${i}`)}</li>`);
  const after = [html`<li>${t('travel.j.a.1')}</li>`, html`<li>${t('travel.j.a.2')}</li>`];
  const stage = (n, key, items) => html`<li class="tv-st"><h3><span class="tv-st__n" aria-hidden="true">${n}</span> ${t(`travel.j.${key}`)}</h3><ul>${items}</ul></li>`;
  return html`<section aria-labelledby="tv-j-h">${sectionHead(ctx, { id: 'tv-j-h', title: t('travel.j.t') })}
  <ol class="tv-stages">${stage(1, 'before', before)}${stage(2, 'during', during)}${stage(3, 'after', after)}</ol>
</section>`;
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
    try { if (typeof JL.travelJsonLd === 'function') jl.push(JL.travelJsonLd(ctx, c, targetedOf(travelModel(ctx.site).adv.get(c.iso2)).map((e) => ({ disease: e.disease, level: e.code, levelLabel: ctx.t(`travel.level.${e.code}`), advice: e.summary, publishedAt: e.start ?? undefined })))); } catch { /* optional */ }
    return { ...extra, title: `${cname(ctx, c)} · ${t('nav.travel')}`, description: t('travel.country.desc', { name: cname(ctx, c) }), jsonLd: jl };
  }
  return { ...extra, title: t('nav.travel'), description: t('travel.desc'), jsonLd: ldFor(ctx, null, [{ label: t('nav.travel') }]) };
}

/* 本頁專用樣式（只用 tokens.css 變數＋三級色），範圍限定在 .tv */
const BASE_CSS = `
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
.tv-lookup--hero{background:var(--green-50);border:1px solid var(--green-100);border-radius:var(--radius-lg);padding:var(--sp-5)}
.tv-lookup--hero h2{font-size:var(--fs-2xl);margin:0 0 var(--sp-1)}
.tv-lookup__sub{margin:0 0 var(--sp-3);color:var(--ink-2)}
.tv-lookup--hero .tv-lookup__form{max-width:760px}
.tv-lookup--hero .c-input,.tv-quick .c-input{font-size:var(--fs-lg);min-height:52px}
.tv-lookup--hero .c-btn,.tv-quick .c-btn{min-height:52px;padding-inline:var(--sp-5)}
.tv-lookup__form,.tv-quick{display:flex;gap:var(--sp-2);max-width:560px;flex-wrap:wrap}
.tv-lookup__form .c-input,.tv-quick .c-input{flex:1 1 240px;width:auto;min-width:0}
.tv-quick{max-width:760px}
.tv-lookup__msg{margin:var(--sp-2) 0 0;font-size:var(--fs-sm);color:var(--ink-2);flex-basis:100%}
.tv-lookup__msg:empty{display:none}
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
.tv-longterm{display:inline-block;border:1px solid var(--line);border-radius:var(--radius-pill);padding:0 10px;font-size:var(--fs-xs);color:var(--ink-2);background:var(--neutral-bg)}
.tv-bgline{margin:var(--sp-3) 0 0;font-size:var(--fs-sm);color:var(--ink-3)}
.tv-card__foot{margin:var(--sp-3) 0 0;font-size:var(--fs-sm)}
.tv-chg__nums{list-style:none;margin:0 0 var(--sp-3);padding:0;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:var(--sp-3);max-width:860px}
.tv-chg__n{border:1px solid var(--line);border-radius:var(--radius);background:var(--white);padding:var(--sp-3) var(--sp-4);display:flex;flex-direction:column;gap:2px}
.tv-chg__n b{font-size:var(--fs-3xl);line-height:1.1;font-variant-numeric:tabular-nums}
.tv-chg__n span{font-size:var(--fs-sm);color:var(--ink-2)}
.tv-chg__n--new b{color:var(--ink)} .tv-chg__n--raised b{color:var(--status-peak)} .tv-chg__n--lowered b{color:var(--status-declining)}
.tv-chg__n--lifted{background:var(--ok-bg);border-color:var(--status-stable)} .tv-chg__n--lifted b{color:var(--status-stable)}
.tv-evs{list-style:none;margin:0;padding:0;max-width:860px}
.tv-evs li{display:grid;grid-template-columns:7.5em minmax(0,1fr);gap:2px var(--sp-3);padding:var(--sp-2) 0;border-bottom:1px solid var(--line-2)}
.tv-evnote{margin-top:var(--sp-3);font-size:var(--fs-sm)}
.tv-evs time{color:var(--ink-3);font-size:var(--fs-sm)}
.tv-ev__w{font-weight:700} .tv-ev__k{margin-left:var(--sp-2);font-size:var(--fs-sm);color:var(--ink-2)}
.tv-ev--lifted .tv-ev__k{color:var(--status-stable);font-weight:700}
.tv-ev--raised .tv-ev__k{color:var(--status-peak)} .tv-ev--lowered .tv-ev__k{color:var(--status-declining)}
.tv-evmore summary{cursor:pointer;color:var(--green-700);margin-top:var(--sp-2)}
.tv-bg{border:1px solid var(--line);border-radius:var(--radius);background:var(--paper);padding:var(--sp-3) var(--sp-4);max-width:860px}
.tv-bg h2{font-size:var(--fs-md);margin:0 0 var(--sp-2)}
.tv-bg ul{margin:0;padding-left:1.1em;color:var(--ink-2)} .tv-bg li{margin:2px 0}
.tv-bg p{margin:var(--sp-2) 0 0;font-size:var(--fs-sm);color:var(--ink-3)}
.tv-band{border:1px solid var(--line);border-top:5px solid var(--tv-watch);border-radius:var(--radius);background:var(--white);padding:var(--sp-3) var(--sp-4);margin:var(--sp-3) 0}
.tv-band--alert{border-top-color:var(--tv-alert)} .tv-band--warning{border-top-color:var(--tv-warning)}
.tv-band__h{display:flex;flex-wrap:wrap;gap:4px var(--sp-3);align-items:baseline;justify-content:space-between}
.tv-band__h h3{margin:0;font-size:var(--fs-lg)} .tv-band--watch h3{color:var(--tv-watch-ink)} .tv-band--alert h3{color:var(--tv-alert-ink)} .tv-band--warning h3{color:var(--tv-warning-ink)}
.tv-band__sum{font-size:var(--fs-sm);color:var(--ink-3)}
.tv-band__empty{margin:var(--sp-2) 0 0;color:var(--ink-3)}
.tv-band__more>summary{cursor:pointer;margin-top:var(--sp-2);color:var(--green-800);font-weight:600} .tv-band__more[open]>summary{margin-bottom:var(--sp-2)}
.tv-rows{list-style:none;margin:var(--sp-2) 0 0;padding:0}
.tv-row{display:grid;grid-template-columns:minmax(9em,14em) minmax(0,1fr);gap:var(--sp-2) var(--sp-4);padding:var(--sp-2) 0;border-top:1px solid var(--line-2)}
.tv-row__d{font-weight:700}
.tv-chips{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:6px}
.tv-chip{display:inline-block;border:1px solid var(--line);border-radius:var(--radius-pill);padding:3px 12px;font-size:var(--fs-sm);background:var(--white);color:var(--ink);text-decoration:none;overflow-wrap:anywhere}
a.tv-chip:hover{border-color:var(--green-700);background:var(--green-50);color:var(--green-900)}
.tv-chip small{color:var(--ink-3)}
.tv-others{margin-top:var(--sp-3);font-size:var(--fs-sm)} .tv-others summary{cursor:pointer;color:var(--green-700)}
.tv-others .tv-chips{margin-top:var(--sp-2)}
.tv-news{list-style:none;margin:0;padding:0;max-width:860px}
.tv-news li{display:grid;grid-template-columns:7.5em minmax(0,1fr);gap:2px var(--sp-3);padding:var(--sp-2) 0;border-bottom:1px solid var(--line-2)}
.tv-news time{color:var(--ink-3);font-size:var(--fs-sm)}
.tv-news__w{font-weight:700} .tv-news__s{margin:2px 0 0;color:var(--ink-2)}
.tv-newsmore summary{cursor:pointer;color:var(--green-700);margin-top:var(--sp-2)}
.tv-stages{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--sp-3)}
.tv-st{border:1px solid var(--line);border-radius:var(--radius);padding:var(--sp-3) var(--sp-4);background:var(--white);min-width:0}
.tv-st h3{font-size:var(--fs-md);margin:0 0 var(--sp-2);display:flex;align-items:center;gap:var(--sp-2)}
.tv-st__n{display:inline-grid;place-items:center;width:1.6em;height:1.6em;border-radius:50%;background:var(--green-700);color:#fff;font-size:.85em}
.tv-st ul{margin:0;padding-left:1.1em} .tv-st li{margin:4px 0}
.tv-st__warn{font-weight:700;color:var(--tv-warning-ink)}
.tv-rel{max-width:860px} .tv-rel ul{margin:0 0 var(--sp-3);padding-left:1.1em}
@media (max-width:720px){
  .tv-defs,.tv-stages{grid-template-columns:1fr}
  .tv-chg__nums{grid-template-columns:repeat(2,minmax(0,1fr))}
  .tv-row{grid-template-columns:1fr;gap:4px}
  .tv-news li,.tv-evs li{grid-template-columns:1fr}
  .tv-lookup--hero{padding:var(--sp-4)}
  .tv-lookup--hero h2{font-size:var(--fs-xl)}
}`;
/** 輸出本頁樣式；map＝併入 _travel-map.mjs 的 styles（若尚未匯出就略過） */
const styleTag = ({ map = false } = {}) => raw(`<style>${BASE_CSS}${map && typeof TravelMap.styles === 'string' ? `\n${TravelMap.styles}` : ''}\n</style>`);
export const travelStyles = styleTag();

/* 目的地查詢：前端顯示結果卡（不跳頁）；資料是本頁內嵌的小 JSON。也讀 ?q= 與 #ISO2。 */
const FIND_SRC = `function norm(s){return String(s||'').trim().toLowerCase().replace(/\\s+/g,' ')}
function find(data,q){q=norm(q);if(!q)return null;var hit=null;
data.c.forEach(function(c){if(hit)return;if(c.k.some(function(k){return k===q}))hit=c});
if(!hit)data.c.forEach(function(c){if(hit)return;if(c.k.some(function(k){return k.length>1&&(k.indexOf(q)===0||q.indexOf(k)===0)}))hit=c});
if(!hit&&q.length>1)data.c.forEach(function(c){if(hit)return;if(c.k.some(function(k){return k.indexOf(q)>=0}))hit=c});
return hit}`;
const LOOKUP_JS = raw(`<script>
(function(){var root=document.querySelector('[data-tv-lookup]');if(!root)return;
var data;try{data=JSON.parse(document.getElementById('tv-data').textContent)}catch(e){return}
var form=root.querySelector('form'),inp=root.querySelector('input'),out=root.querySelector('[data-tv-result]'),msg=root.querySelector('[data-tv-msg]');
${FIND_SRC}
function show(){var c=find(data,inp.value);msg.textContent='';out.innerHTML='';
if(!c){if(norm(inp.value))msg.textContent=data.nf.replace('{q}',inp.value.trim());return}
var tpl=document.querySelector('[data-tv-card="'+c.i+'"]')||document.querySelector('[data-tv-card="'+(c.b?'none-bg':'none')+'"]')||document.querySelector('[data-tv-card="none"]');
var node=tpl.cloneNode(true);node.hidden=false;node.removeAttribute('data-tv-card');
node.querySelectorAll('[data-tv-name]').forEach(function(el){el.textContent=c.n});
node.querySelectorAll('[data-tv-href]').forEach(function(el){el.setAttribute('href',c.h)});
out.appendChild(node);try{history.replaceState(null,'','#'+c.i)}catch(e){}}
form.addEventListener('submit',function(e){e.preventDefault();show()});
inp.addEventListener('change',show);
var h=(location.hash||'').slice(1).toUpperCase();if(/^[A-Z]{2}$/.test(h)){var c=data.c.filter(function(x){return x.i===h})[0];if(c){inp.value=c.n;show()}}
var m=location.search.match(/[?&]q=([^&]*)/);if(m&&!inp.value){try{inp.value=decodeURIComponent(m[1].replace(/\\+/g,' '))}catch(e){}if(inp.value)show()}
})();
</script>`);
/** 任務頁的小型查詢：找到就直接進該國目的地頁；找不到顯示提示；沒有 JS 時送出到 /travel/?q= */
const QUICK_JS = raw(`<script>
(function(){document.querySelectorAll('[data-tv-quick]').forEach(function(form){
var data;try{data=JSON.parse(form.querySelector('script[type="application/json"]').textContent)}catch(e){return}
var inp=form.querySelector('input'),msg=form.querySelector('[data-tv-qmsg]');
${FIND_SRC}
form.addEventListener('submit',function(e){var c=find(data,inp.value);if(c){e.preventDefault();location.href=c.h;return}
if(norm(inp.value)){e.preventDefault();msg.textContent=data.nf.replace('{q}',inp.value.trim())}});
inp.addEventListener('change',function(){var c=find(data,inp.value);if(c&&document.activeElement!==inp)location.href=c.h});
})})();
</script>`);

const countryKeys = (c) => [c.name, c.nameEn, c.iso2].filter(Boolean).map((s) => s.toLowerCase());
const lookupPayload = (ctx, countries, extra = () => ({})) => ({
  nf: ctx.t('travel.lookup.notfound', { q: '{q}' }),
  c: countries.map((c) => ({ i: c.iso2, n: cname(ctx, c), h: ctx.url(`/travel/${c.iso2}/`), k: countryKeys(c), ...extra(c) })),
});
const datalist = (ctx, id, countries) => html`<datalist id="${id}">${countries.map((c) => html`<option value="${cname(ctx, c)}">${ctx.lang === 'zh-TW' ? c.nameEn ?? '' : c.name ?? ''}</option>`)}</datalist>`;

/** 任務頁用：小型「查目的地」表單（直接進目的地頁） */
export function quickLookup(ctx, { id = 'tq' } = {}) {
  const { site, t, url } = ctx;
  const countries = site.master.countries ?? [];
  return html`<form class="tv-quick" action="${url('/travel/')}" method="get" role="search" data-tv-quick>
  <label for="${id}-q" class="sr-only">${t('travel.lookup.label')}</label>
  <input id="${id}-q" name="q" class="c-input" type="search" list="${id}-list" autocomplete="off" placeholder="${t('travel.lookup.ph')}">
  ${datalist(ctx, `${id}-list`, countries)}
  <button type="submit" class="c-btn">${t('travel.lookup.go')}</button>
  <p class="tv-lookup__msg" data-tv-qmsg role="status"></p>
  <script type="application/json">${raw(jsonScript(lookupPayload(ctx, countries)))}</script>
</form>${QUICK_JS}`;
}

function lookupSection(ctx, model) {
  const { t, url } = ctx;
  const { adv, masters: countries, background } = model;
  const withAdv = countries.filter((c) => targetedOf(adv.get(c.iso2)).length);
  const none = countries.filter((c) => !targetedOf(adv.get(c.iso2)).length);
  const payload = lookupPayload(ctx, countries, (c) => (!targetedOf(adv.get(c.iso2)).length && backgroundOf(adv.get(c.iso2)).length ? { b: 1 } : {}));
  // 無針對性建議的國家共用兩張卡（名稱與連結由前端填入）；none-bg＝該國另有全球背景提醒
  const noneTpl = (withBg) => html`<div class="tv-card tv-card--none" data-level="0">
  <h3 class="tv-card__t"><span class="tv-ok" aria-hidden="true">✓</span> ${t('travel.result.none.t')} <span class="tv-card__c">· <span data-tv-name></span></span></h3>
  <p>${raw(String(t('travel.result.none.d', { name: '\u0000' })).split('\u0000').map((s) => html`${s}`.s).join('<span data-tv-name></span>'))}</p>
  <ul class="tv-prec">${[1, 2, 3].map((i) => html`<li>${t(`travel.prec.${i}`)}</li>`)}</ul>
  ${withBg ? bgLine(ctx, background) : ''}
  <p class="tv-card__foot">${clinicLink(ctx)} · <a data-tv-href href="${url('/travel/')}">${raw(String(t('travel.result.more', { name: '\u0000' })).split('\u0000').map((s) => html`${s}`.s).join('<span data-tv-name></span>'))}</a></p>
</div>`;
  return html`<section class="tv-lookup tv-lookup--hero" id="tv-lookup" aria-labelledby="tv-lk-h" data-tv-lookup>
  <h2 id="tv-lk-h">${t('travel.lookup.t')}</h2>
  <p class="tv-lookup__sub">${t('travel.lookup.sub')}</p>
  <form class="tv-lookup__form" action="${url('/travel/')}" method="get" role="search">
    <label for="tv-q" class="sr-only">${t('travel.lookup.label')}</label>
    <input id="tv-q" class="c-input" type="search" list="tv-list" autocomplete="off" placeholder="${t('travel.lookup.ph')}" aria-describedby="tv-lk-msg">
    ${datalist(ctx, 'tv-list', countries)}
    <button type="submit" class="c-btn">${t('travel.lookup.go')}</button>
  </form>
  <p class="tv-lookup__msg" id="tv-lk-msg" data-tv-msg role="status"></p>
  <div class="tv-result" data-tv-result aria-live="polite"></div>
  <div hidden>
    <div data-tv-card="none" hidden>${noneTpl(false)}</div>
    <div data-tv-card="none-bg" hidden>${noneTpl(true)}</div>
    ${withAdv.map((c) => html`<div data-tv-card="${c.iso2}" hidden>${resultCard(ctx, c, adv.get(c.iso2))}</div>`)}
  </div>
  <details class="tv-others"><summary>${t('travel.table.others', { n: none.length })}</summary>
    <ul class="tv-chips">${none.map((c) => html`<li><a class="tv-chip" href="${url(`/travel/${c.iso2}/`)}">${cname(ctx, c)}</a></li>`)}</ul>
  </details>
  <script type="application/json" id="tv-data">${raw(jsonScript(payload))}</script>
</section>`;
}

/** 近 30 天變化：四個數字（解除用綠色）＋最多 10 則清單 */
export function changeTiles(ctx, counts) {
  return html`<ul class="tv-chg__nums">${CHANGE_KINDS.map((k) => html`<li class="tv-chg__n tv-chg__n--${k}"><b>${counts?.[k] ?? 0}</b><span>${ctx.t(`travel.chg.${k}`)}</span></li>`)}</ul>`;
}
function eventItem(ctx, e, byIso) {
  const { site, t, fmtDate, url } = ctx;
  const c = byIso.get(e.iso2);
  const who = c ? cname(ctx, c) : ((ctx.lang === 'zh-TW' ? e.country : e.countryEn) ?? e.country ?? e.iso2 ?? '—');
  const d = t(`travel.chg.d.${e.kind}`, { from: lvShort(ctx, e.from), to: lvShort(ctx, e.to) });
  return html`<li class="tv-ev tv-ev--${e.kind}"><time datetime="${e.date}">${fmtDate(e.date)}</time><div><span class="tv-ev__w">${c ? html`<a href="${url(`/travel/${c.iso2}/`)}">${who}</a>` : who} · ${dname(ctx, site, e)}${e.area ? html` <span class="muted">（${e.area}）</span>` : ''}</span><span class="tv-ev__k">${d}</span></div></li>`;
}
function changeSection(ctx, model) {
  const { t } = ctx;
  const cd = changeData(ctx.site, ctx.today);
  const byIso = new Map(model.masters.map((c) => [c.iso2, c]));
  const head = sectionHead(ctx, { id: 'tv-ch-h', title: t('travel.chg.t'), note: t('travel.chg.note') });
  if (!cd) return html`<section aria-labelledby="tv-ch-h">${head}<p class="muted">${t('travel.chg.none')}</p></section>`;
  const first = cd.list.slice(0, NEWS_MAX); const rest = cd.list.slice(NEWS_MAX);
  const evMeta = ctx.site.snapshots?.countryEvents?.meta;
  return html`<section aria-labelledby="tv-ch-h">${head}
  ${changeTiles(ctx, cd.counts)}
  ${cd.summaryOnly ? '' : cd.list.length ? html`<ol class="tv-evs">${first.map((e) => eventItem(ctx, e, byIso))}</ol>${rest.length ? html`<details class="tv-evmore"><summary>${t('travel.chg.more', { n: rest.length })}</summary><ol class="tv-evs">${rest.map((e) => eventItem(ctx, e, byIso))}</ol></details>` : ''}` : html`<p class="muted">${t('travel.chg.empty')}</p>`}
  ${evMeta?.mode && evMeta.mode !== 'live' && evMeta.note ? html`<p class="muted tv-evnote" lang="zh-TW">${evMeta.note}</p>` : ''}
</section>`;
}

function mapSection(ctx, model) {
  const { t, url } = ctx;
  const byIso = new Map();
  for (const [iso, list] of model.adv) { const m = maxLevel(targetedOf(list)); if (m >= 1) byIso.set(iso, { code: m, label: levelName(ctx, m) }); }
  const hasPage = new Set(model.masters.map((c) => c.iso2));
  let svg = '';
  try {
    svg = TravelMap.worldMap?.(ctx, {
      byIso, hrefFor: (iso) => (hasPage.has(iso) ? url(`/travel/${iso}/`) : null), title: t('travel.map.title'), desc: t('travel.map.desc'),
      legend: { l1: levelName(ctx, 1), l2: levelName(ctx, 2), l3: levelName(ctx, 3), none: t('travel.map.none') },
    }) ?? '';
  } catch { svg = ''; }
  if (!String(svg)) return '';
  return html`<section aria-labelledby="tv-mp-h">${sectionHead(ctx, { id: 'tv-mp-h', title: t('travel.map.t'), note: t('travel.map.note') })}${svg}</section>`;
}

function backgroundSection(ctx, model) {
  const { site, t, fmtDate } = ctx;
  if (!model.background.length) return '';
  const zhAttr = ctx.lang === 'zh-TW' ? '' : raw(' lang="zh-TW"');
  return html`<section class="tv-bg" aria-labelledby="tv-bg-h"><h2 id="tv-bg-h">${t('travel.bg.t')}</h2>
  <ul>${model.background.map((b) => html`<li>${t('travel.bg.item', { disease: dname(ctx, site, b), level: lvShort(ctx, b.code), since: b.since ? fmtDate(b.since) : '—', n: b.n })}${b.summary ? html` <span${zhAttr}>${b.summary}</span>` : ''}</li>`)}</ul>
  <p>${t('travel.bg.d')}</p></section>`;
}

/** 針對性建議等級表：第三級 → 第一級分段；每段依疾病列國家／地區 chip（只列非背景項目；chip title＝自 YYYY-MM-DD） */
function levelTable(ctx, model) {
  const { site, t, url } = ctx;
  const bands = [3, 2, 1].map((lv) => {
    const groups = new Map();
    for (const c of model.countries) for (const e of targetedOf(model.adv.get(c.iso2))) {
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
  const chip = (c, e) => {
    const inner = html`${cname(ctx, c)}${e.area ? html` <small${ctx.lang === 'zh-TW' ? '' : raw(' lang="zh-TW"')}>${e.area}</small>` : ''}`;
    const title = e.start ? t('travel.table.since', { date: e.start }) : null;
    return c.synthetic ? html`<span class="tv-chip"${title ? raw(` title="${title}"`) : ''}>${inner}</span>` : html`<a class="tv-chip" href="${url(`/travel/${c.iso2}/`)}"${title ? raw(` title="${title}"`) : ''}>${inner}</a>`;
  };
  return html`<section aria-labelledby="tv-tb-h">
  ${sectionHead(ctx, { id: 'tv-tb-h', title: t('travel.table.t') })}
  <p class="muted">${t('travel.table.note')}</p>
  ${bands.map(({ lv, list, nCountries, nItems }) => html`<section class="tv-band tv-band--${LEVEL_KEY[lv]}" aria-labelledby="tv-b${lv}">
    <div class="tv-band__h"><h3 id="tv-b${lv}">${levelName(ctx, lv)}</h3><span class="tv-band__sum">${nItems ? t('travel.table.sum', { level: t(`travel.level.${lv}`), c: nCountries, n: nItems }) : ''}</span></div>
    ${list.length ? (() => {
      const rows = html`<ul class="tv-rows">${list.map((g) => {
        const m = diseaseMasterOf(site, g.e); const page = m ? diseasePage(ctx, m.id) : null;
        return html`<li class="tv-row"><div class="tv-row__d">${page ? html`<a href="${hrefFor(ctx, page)}">${dname(ctx, site, g.e)}</a>` : dname(ctx, site, g.e)}</div>
        <ul class="tv-chips">${g.items.map(({ c, e }) => html`<li>${chip(c, e)}</li>`)}</ul></li>`;
      })}</ul>`;
      // 第一級項目多（> 40）時預設收合：第一級是「注意」，不該把頁面撐成長表；第二、三級永遠展開。
      return lv === 1 && nItems > 40 ? html`<details class="tv-band__more"><summary>${t('travel.table.expand', { c: nCountries, n: nItems })}</summary>${rows}</details>` : rows;
    })() : html`<p class="tv-band__empty">${t('travel.table.none')}</p>`}
  </section>`)}
</section>`;
}

function newsList(ctx, rows, { max = NEWS_MAX, withCountry = true } = {}) {
  const { site, t, fmtDate } = ctx;
  if (!rows.length) return html`<p class="muted">${t('travel.news.empty')}</p>`;
  const byIso = new Map((site.master.countries ?? []).map((c) => [c.iso2, c]));
  const zhAttr = ctx.lang === 'zh-TW' ? '' : raw(' lang="zh-TW"');
  const whoOf = (r) => {
    const isos = r.isoList?.length ? r.isoList : r.iso2 ? [r.iso2] : [];
    const zhNames = String(r.country ?? '').split(/[,、]/).map((x) => x.trim());
    if (!isos.length) return r.country ?? '';
    return isos.map((iso, i) => { const c = byIso.get(iso); const nm = c ? cname(ctx, c) : (ctx.lang === 'zh-TW' && zhNames.length === isos.length ? zhNames[i] : iso); return c ? html`<a href="${ctx.url(`/travel/${c.iso2}/`)}">${nm}</a>` : html`${nm}`; }).map((x, i) => html`${i ? (ctx.lang === 'zh-TW' ? '、' : ', ') : ''}${x}`);
  };
  const li = (r) => html`<li><time datetime="${r.start ?? ''}">${r.start ? fmtDate(r.start) : '—'}</time><div><span class="tv-news__w">${withCountry ? html`${whoOf(r)} · ` : ''}${dname(ctx, site, r)}</span>${r.summary ? html`<p class="tv-news__s"${zhAttr}>${r.summary}</p>` : ''}</div></li>`;
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
  const model = travelModel(site);
  if (props.country) return renderCountry(ctx, props.country, model);
  const news = recentNews(site);
  return html`${styleTag({ map: true })}<div class="tv">
${pageHead(ctx, { trail: [{ label: t('nav.travel') }], h1: t('nav.travel'), lead: t('travel.lead') })}
${lookupSection(ctx, model)}
${changeSection(ctx, model)}
${mapSection(ctx, model)}
${backgroundSection(ctx, model)}
${defsSection(ctx)}
${levelTable(ctx, model)}
<section aria-labelledby="tv-nw-h">
  ${sectionHead(ctx, { id: 'tv-nw-h', title: t('travel.news.t'), note: t('travel.news.note') })}
  ${newsList(ctx, news)}
</section>
<section class="c-ask-inline" aria-labelledby="ta-h"><h2 id="ta-h">${t('travel.ask')}</h2>${askBox(ctx, { id: 'tq', size: 'md', task: 'travel', placeholder: t('travel.ask.ph') })}</section>
${provCard(ctx)}
${feedback(ctx, { page: ctx.path })}
</div>${LOOKUP_JS}`;
}

/** 目的地頁：同一套結構（卡片 → 旅程三階段 → 近 30 天疫情資訊 → 相關資料 → 提問），有無針對性建議只差內容多寡 */
function renderCountry(ctx, c, model) {
  const { site, t, url } = ctx;
  const all = model.adv.get(c.iso2) ?? [];
  const tg = targetedOf(all);
  const lv = maxLevel(tg);
  const news = recentNews(site).filter((r) => newsMatches(c, r));
  const name = cname(ctx, c);
  const head = pageHead(ctx, { trail: [{ label: t('nav.travel'), href: '/travel/' }, { label: name }], h1: t('travel.country.h1', { name }), lead: c.region ? t('travel.country.lead', { region: c.region }) : '', tags: html`<p>${lv ? levelPill(ctx, lv) : html`<span class="muted">${t('travel.level.0')}</span>`} <span class="muted">${c.nameEn ? `${c.nameEn} · ` : ''}${c.iso2}</span></p>` });
  const newsBlock = news.length ? html`<section aria-labelledby="cn-h">${sectionHead(ctx, { id: 'cn-h', title: t('travel.country.news', { name }), note: t('travel.news.note') })}${newsList(ctx, news, { withCountry: false })}</section>` : '';
  const related = new Map();
  for (const e of tg) { const m = diseaseMasterOf(site, e); if (m) related.set(m.id, m); }
  const relPages = [...related.values()].map((m) => ({ m, page: diseasePage(ctx, m.id) }));
  const docs = site.collections.documents.filter((d) => d.isCurrent && (d.countries?.includes(c.iso2) || (tg.length && d.tasks?.includes('travel') && d.diseases?.some((x) => related.has(x)))));
  const relBlock = relPages.length || docs.length ? html`<section class="tv-rel" aria-labelledby="cr-h">${sectionHead(ctx, { id: 'cr-h', title: t('travel.country.related') })}
  ${relPages.length ? html`<h3>${t('travel.country.diseases')}</h3><ul>${relPages.map(({ m, page }) => html`<li>${page ? html`<a href="${hrefFor(ctx, page)}">${L(ctx, page, 'title')}</a>` : (ctx.lang === 'zh-TW' ? m.name : m.nameEn ?? m.name)}</li>`)}</ul>` : ''}
  ${docs.length ? html`<h3>${t('travel.country.docs')}</h3><ul class="c-linklist">${docs.map((d) => html`<li><a href="${hrefFor(ctx, d)}">${L(ctx, d, 'title')}</a> <span class="muted">${d.version}</span></li>`)}</ul>` : ''}
</section>` : '';
  return html`${styleTag()}<div class="tv">${head}
<section aria-labelledby="cl-h"><h2 id="cl-h" class="sr-only">${t('travel.country.level')}</h2>${resultCard(ctx, c, all, { more: false, headingLevel: 2, vax: false, bg: backgroundOf(all).length ? backgroundOf(all) : null })}</section>
${journey(ctx, c, tg)}
${newsBlock}
${relBlock}
<p class="muted">${t('travel.country.none.more')} <a href="${url('/travel/')}">${t('travel.table.t')}</a></p>
<section class="c-ask-inline">${askBox(ctx, { id: 'tcq', size: 'md', task: 'travel', placeholder: t('travel.country.ask', { name }) })}</section>
${provCard(ctx)}
${feedback(ctx, { page: ctx.path })}</div>`;
}

export function pages(site) {
  const out = [{ path: '/travel/', lang: '*', props: {} }];
  for (const c of site.master.countries ?? []) out.push({ path: `/travel/${c.iso2}/`, lang: '*', props: { country: c } });
  return out;
}
