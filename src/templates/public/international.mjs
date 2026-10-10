// /international/：國際合作入口（ARCHITECTURE §14.4）。
// 英文為來源語言（topic.international-cooperation 的 sourceLang: 'en'），所以頁首顯示「語言權威性」提示（_international.mjs 的 authorityNote），
// 只在有譯文的語言輸出（zh-TW 與 en 一定有）。區塊：IHR 窗口卡、多邊與雙邊（雙邊 MOU 表格＋夥伴地圖）、訓練與申請、出版品、新聞、聯絡窗口。
// 夥伴地圖重用 _travel-map.mjs 的 worldMap，以 classOf／legend 自訂中性藍綠配色（不用 travel 等級色）。
// 對 W1 的資料一律容錯：缺 topic ⇒ 不輸出頁面；缺子頁／服務／表格 ⇒ 該區塊不出現；雙邊清單優先讀結構化欄位 page.partners，沒有就解析 bodyMarkdown 的第一個表格。
import { html, raw, esc } from '../../../scripts/lib/render.mjs';
import { md } from '../../../scripts/lib/markdown.mjs';
import { config } from '../../../site.config.mjs';
import { langAvailable } from '../../../scripts/lib/pages.mjs';
import * as TravelMap from './_travel-map.mjs';
import { ldFor, breadcrumb, provenance, alerts, pageData, scopeTags, feedback, hrefFor, isFallbackLink, L, unitName, publishedOf, byDateDesc, dated, langOk } from './_partials.mjs';
import { INTL_TOPIC_ID, intlTopic, intlSubPages, intlKeyOf, intlSubPath, authorityNote } from './_international.mjs';

void INTL_TOPIC_ID;

export function pages(site) {
  const tp = intlTopic(site);
  if (!tp) return [];
  const src = tp.sourceLang ?? 'zh-TW';
  return site.config.langs
    .filter((l) => l.code === 'zh-TW' || l.code === src || langAvailable(site, tp, l.code))
    .map((l) => ({ path: '/international/', lang: l.code, props: {}, md: l.code === 'zh-TW' || l.code === 'en' }));
}

export function meta(ctx) {
  const tp = intlTopic(ctx.site);
  const title = tp ? L(ctx, tp, 'title') : ctx.t('international.title');
  return { title, description: (tp && L(ctx, tp, 'summary')) || ctx.t('international.lead'), item: tp, jsonLd: ldFor(ctx, tp, [{ label: title }]) };
}

/* ───────── 解析工具（容錯） ───────── */
const stripMd = (s) => String(s ?? '').replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/<br\s*\/?>/gi, ' ').replace(/[*_`~]/g, '').replace(/\s+/g, ' ').trim();

/** Markdown 第一個表格 → { header: string[], rows: string[][] }；沒有表格回傳 null */
export function parseMdTable(src) {
  const lines = String(src ?? '').split('\n');
  for (let i = 0; i < lines.length - 1; i++) {
    if (!/^\s*\|.*\|\s*$/.test(lines[i]) || !/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1])) continue;
    const cut = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => stripMd(c));
    const header = cut(lines[i]);
    const rows = [];
    for (let j = i + 2; j < lines.length && /^\s*\|.*\|\s*$/.test(lines[j]); j++) rows.push(cut(lines[j]));
    return rows.length ? { header, rows } : null;
  }
  return null;
}

/** 國家名稱索引（英文名、中文名、少數別名）；以長度由長到短比對，避免 Guinea 吃掉 Papua New Guinea */
const ALIASES = [['USA', 'US'], ['U.S.', 'US'], ['United States of America', 'US'], ['Viet Nam', 'VN'], ['Republic of Korea', 'KR'], ['South Korea', 'KR'], ['Czechia', 'CZ'], ['Czech Republic', 'CZ'], ['Eswatini', 'SZ'], ['Swaziland', 'SZ'], ['UK', 'GB'], ['United Kingdom', 'GB'], ['Britain', 'GB'], ['美國', 'US'], ['韓國', 'KR'], ['英國', 'GB']];
const _idx = new WeakMap();
function countryIndex(site) {
  const key = site.master?.countries ?? site;
  if (_idx.has(key)) return _idx.get(key);
  const list = [...ALIASES];
  for (const c of site.master?.countries ?? []) { if (c.nameEn) list.push([c.nameEn, c.iso2]); if (c.name) list.push([c.name, c.iso2]); }
  const entries = list.filter(([n]) => n && String(n).length >= 2)
    .sort((a, b) => b[0].length - a[0].length)
    .map(([n, iso]) => {
      const ascii = /^[\x20-\x7e]+$/.test(n);
      const re = ascii ? new RegExp(`(?<![A-Za-z])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z])`, 'i') : null;
      return { n, iso, test: (s) => (re ? re.test(s) : s.includes(n)) };
    });
  _idx.set(key, entries);
  return entries;
}
/** 從一段文字找出所有國家（不重複；已被較長名稱吃掉的片段不再比對） */
export function isosIn(site, text) {
  let rest = String(text ?? '');
  const found = [];
  for (const e of countryIndex(site)) {
    if (!e.test(rest)) continue;
    if (!found.includes(e.iso)) found.push(e.iso);
    rest = rest.replace(new RegExp(e.n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), ' ');
  }
  return found;
}

const LAPSED = /expired|ended|terminated|lapsed|inactive|paused|suspended|屆期|過期|終止|暫停|失效|已結束/i;
const PLANNED = /negotiat|discuss|planned|planning|draft|pending|proposed|in progress|洽簽|規劃|協商|草擬|洽談|擬/i;
/** 狀態文字 → 地圖 class：c1 合作中、c2 洽簽／規劃中、c3 已屆期或暫停 */
export const statusClass = (s) => (LAPSED.test(String(s ?? '')) ? 'wm--c3' : PLANNED.test(String(s ?? '')) ? 'wm--c2' : 'wm--c1');
const CLS_ORDER = ['wm--c1', 'wm--c2', 'wm--c3'];

/**
 * 雙邊合作清單 → { header, rows: [{ cells, isos, cls }] } 或 null。
 * 優先讀結構化欄位 page.partners（[{ iso2|iso, name|partner|agency, topic|topics, year|signedYear, status }]），否則解析本語言（再退到來源語言）bodyMarkdown 的第一個表格。
 * 國家代碼來自：結構化 iso2，或本語言／來源語言／中文版同一列第一欄的國家名稱。
 */
export function bilateralData(ctx, page) {
  if (!page) return null;
  const { site, t } = ctx;
  const structured = L(ctx, page, 'partners') ?? page.partners ?? page.mous ?? page.agreements;
  if (Array.isArray(structured) && structured.length) {
    const rows = structured.map((p) => {
      const iso = String(p.iso2 ?? p.iso ?? p.country ?? '').toUpperCase();
      const name = p.name ?? p.partner ?? p.agency ?? p.country ?? iso;
      const topic = Array.isArray(p.topics ?? p.topic) ? (p.topics ?? p.topic).join(ctx.lang === 'zh-TW' ? '；' : '; ') : (p.topics ?? p.topic ?? '');
      const year = p.year ?? p.signedYear ?? '';
      const status = p.status ?? '';
      return { cells: [name, topic, String(year || '—'), status || '—'], isos: /^[A-Z]{2}$/.test(iso) ? [iso] : isosIn(site, name), cls: statusClass(status) };
    });
    return { header: [t('international.bi.partner'), t('international.bi.topic'), t('international.bi.year'), t('international.bi.status')], rows };
  }
  const own = parseMdTable(L(ctx, page, 'bodyMarkdown') ?? page.bodyMarkdown);
  const src = parseMdTable(page.bodyMarkdown);
  const zh = parseMdTable(page.i18n?.['zh-TW']?.bodyMarkdown ?? (page.sourceLang ? null : page.bodyMarkdown));
  const main = own ?? src;
  if (!main) return null;
  const rows = main.rows.map((cells, i) => {
    const probe = [cells[0], src?.rows?.[i]?.[0], zh?.rows?.[i]?.[0]].filter(Boolean).join(' | ');
    const status = cells[cells.length - 1] ?? '';
    const statusSrc = src?.rows?.[i]?.[src.rows[i].length - 1] ?? '';
    return { cells, isos: isosIn(site, probe), cls: statusClass(`${status} ${statusSrc}`) };
  });
  return { header: main.header, rows };
}

/** 夥伴地圖的 classOf／labelOf／legend（只列實際用到的顏色） */
function mapOptions(ctx, data) {
  const { t } = ctx;
  const byIso = new Map();
  for (const r of data.rows) for (const iso of r.isos) {
    const prev = byIso.get(iso);
    // 同一國多筆：合作中 > 洽簽中 > 已屆期
    if (!prev || CLS_ORDER.indexOf(r.cls) < CLS_ORDER.indexOf(prev.cls)) byIso.set(iso, { cls: r.cls, row: r });
  }
  const used = new Set([...byIso.values()].map((v) => v.cls));
  const LEG = { 'wm--c1': 'international.map.legend.active', 'wm--c2': 'international.map.legend.planned', 'wm--c3': 'international.map.legend.lapsed' };
  const legend = [...CLS_ORDER.filter((c) => used.has(c)).map((c) => ({ cls: c, label: t(LEG[c]) })), { cls: 'wm--none', label: t('international.map.legend.none') }];
  return {
    isoCount: byIso.size,
    classOf: (iso) => byIso.get(iso)?.cls ?? null,
    labelOf: (iso) => { const r = byIso.get(iso)?.row; return r ? [r.cells[0], r.cells[2], r.cells[r.cells.length - 1]].filter(Boolean).join(' · ') : null; },
    legend,
  };
}

/** IHR 窗口：結構化欄位優先（contactInfo／contacts），否則從本語言內文抓電話、信箱與 24 小時字樣 */
export function ihrContacts(ctx, page) {
  if (!page) return { phones: [], emails: [], always: false };
  const { t } = ctx;
  const info = page.contactInfo ?? page.contacts ?? {};
  const body = `${L(ctx, page, 'bodyMarkdown') ?? ''}\n${page.bodyMarkdown ?? ''}\n${L(ctx, page, 'summary') ?? ''}`;
  const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
  const phones = new Map(), emails = new Map();
  const addPhone = (s, label = null, minDigits = 8) => { const d = String(s).replace(/\D/g, ''); if (d.length >= minDigits && !phones.has(d)) phones.set(d, { num: norm(s), label }); };
  // 結構化欄位優先並帶說明文字：hotline＝國內專線（1922）、phone＝國外撥打、switchboard＝總機（上班時間）
  for (const v of [].concat(info.hotline ?? [])) if (typeof v === 'string') addPhone(v, t('international.contact.hotline'), 3);
  for (const k of ['phone', 'tel', 'telephone']) for (const v of [].concat(info[k] ?? [])) if (typeof v === 'string') addPhone(v, t('international.contact.hotline.intl'));
  for (const v of [].concat(info.switchboard ?? [])) if (typeof v === 'string') addPhone(v, t('international.ihr.switchboard'));
  for (const k of ['email', 'mail']) for (const v of [].concat(info[k] ?? [])) if (typeof v === 'string' && v.includes('@')) emails.set(v.toLowerCase(), v);
  for (const m of body.matchAll(/\+\d{1,3}[\s-]?\(?\d{1,4}\)?[\d\s-]{5,}\d/g)) addPhone(m[0]);
  for (const m of body.matchAll(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g)) emails.set(m[0].toLowerCase(), m[0]);
  const always = info.hours247 === true || /\b24\s*(?:\/\s*7|hours?)\b|24\s*小時|全年無休|24-hour/i.test(body);
  return { phones: [...phones.values()].slice(0, 4), emails: [...emails.values()].slice(0, 3), always };
}

/** 內文中以粗體開頭的條列 → 重點（多邊合作的機構／機制） */
export function bulletHighlights(src, max = 8) {
  const out = [];
  for (const line of String(src ?? '').split('\n')) {
    const m = /^\s*[-*]\s+\*\*(.+?)\*\*\s*[:：—–-]*\s*(.*)$/.exec(line);
    if (!m) continue;
    const rest = stripMd(m[2]);
    out.push({ lead: stripMd(m[1]), rest: rest.length > 140 ? `${rest.slice(0, 139)}…` : rest });
    if (out.length >= max) break;
  }
  return out;
}

const pageOf = (subs, key) => subs.find((p) => intlKeyOf(p) === key) ?? null;
const telHref = (s) => `tel:${String(s).replace(/[^\d+]/g, '')}`;

function trainingService(site) {
  return site.byId.get('service.international-training-application')
    ?? (site.collections.services ?? []).find((s) => s.status === 'published' && /international-training/.test(s.id)) ?? null;
}

function englishPublications(ctx) {
  const { site, lang } = ctx;
  const ok = (p) => p.languages?.en?.status === 'reviewed' || p.sourceLang === 'en' || p.languages?.en?.status === 'source';
  return publishedOf(site, 'publications').filter(ok).sort(byDateDesc).slice(0, 6).map((p) => ({ p, href: hrefFor(ctx, p), fb: isFallbackLink(ctx, p) })).map((x) => ({ ...x, lang }));
}

function intlNews(ctx, tp) {
  const { site } = ctx;
  const ids = new Set(tp.contentIds ?? []);
  return publishedOf(site, 'news').filter((n) => n.sourceLang === 'en' || ids.has(n.id) || /international/i.test(n.id)).sort(byDateDesc).slice(0, 6);
}

export function render(ctx) {
  const { site, t, lang, url } = ctx;
  const tp = intlTopic(site);
  const subs = intlSubPages(site);
  const P = (k) => pageOf(subs, k);
  const ihr = P('ihr-focal-point'), multi = P('multilateral'), bi = P('bilateral'), tr = P('training'), pubsPage = P('publications-en'), ghs = P('global-health-security');
  const more = (p) => (p ? html`<p class="c-intl__more"><a href="${hrefOf(ctx, p)}">${t('international.more')} →</a></p>` : '');
  const title = L(ctx, tp, 'title') ?? t('international.title');
  const contacts = ihrContacts(ctx, ihr);
  const bilateral = bilateralData(ctx, bi);
  const mapOpts = bilateral ? mapOptions(ctx, bilateral) : null;
  const highlights = multi ? bulletHighlights(L(ctx, multi, 'bodyMarkdown') ?? multi.bodyMarkdown) : [];
  const sv = trainingService(site);
  const svSteps = sv ? (L(ctx, sv, 'steps') ?? sv.steps ?? []) : [];
  const svWho = sv ? (L(ctx, sv, 'whoCanApply') ?? sv.whoCanApply ?? []) : [];
  const pubs = englishPublications(ctx);
  const news = intlNews(ctx, tp);
  const hasPartners = !!(multi || bilateral || ghs);
  const hasTraining = !!(tr || sv);
  const hasPubs = !!(pubs.length || pubsPage);
  const toc = [
    ihr && ['ihr', t('international.sec.ihr')],
    hasPartners && ['partners', t('international.sec.partners')],
    hasTraining && ['training', t('international.sec.training')],
    hasPubs && ['pubs', t('international.sec.pubs')],
    ['news', t('international.sec.news')],
    ['contact', t('international.sec.contact')],
  ].filter(Boolean);
  const owner = tp.owner ? unitName(ctx, tp.owner) : '';

  return html`${breadcrumb(ctx, [{ label: title }])}
${bilateral && mapOpts?.isoCount ? raw(`<style>${TravelMap.styles}</style>`) : ''}
<article class="c-article c-intl" data-item="${tp.id}">
  <header class="c-pagehead"><div class="c-pagehead__main">
    <h1>${title}</h1>
    <p class="lead">${L(ctx, tp, 'summary') ?? t('international.lead')}</p>
    ${authorityNote(ctx, tp)}
    ${scopeTags(ctx, tp, { region: false })}
    ${alerts(ctx, tp)}
    ${provenance(ctx, tp, { showAi: true })}
  </div></header>
  ${L(ctx, tp, 'introMarkdown') ? html`<div class="c-prose c-intl__intro">${raw(md(L(ctx, tp, 'introMarkdown')))}</div>` : ''}
  <nav class="c-chips-wrap" aria-label="${t('international.toc')}"><ul class="c-chips c-chips--wrap">${toc.map(([id, label]) => html`<li><a class="c-chip" href="#${id}">${label}</a></li>`)}</ul></nav>

  ${ihr ? html`<section class="c-block" id="ihr" aria-labelledby="h-ihr"><h2 id="h-ihr">${t('international.sec.ihr')}</h2>
    <div class="c-ihr">
      <div class="c-ihr__main">
        <h3>${L(ctx, ihr, 'title')}</h3>
        ${L(ctx, ihr, 'summary') ? html`<p>${L(ctx, ihr, 'summary')}</p>` : ''}
        <p class="muted c-ihr__note">${t('international.ihr.note')}</p>
        ${more(ihr)}
      </div>
      <dl class="c-ihr__contact">
        ${contacts.always ? html`<div class="c-ihr__247"><dt>${t('international.ihr.hours')}</dt><dd><strong>${t('international.ihr.247')}</strong></dd></div>` : ''}
        ${contacts.phones.length ? html`<div><dt>${t('international.ihr.phone')}</dt><dd>${contacts.phones.map((p) => html`<span class="c-ihr__num">${p.label ? html`<span class="muted">${p.label}</span> ` : ''}<a href="${telHref(p.num)}">${p.num}</a></span>`)}</dd></div>` : ''}
        ${contacts.emails.length ? html`<div><dt>${t('international.ihr.email')}</dt><dd>${contacts.emails.map((e) => html`<a href="mailto:${e}">${e}</a>`)}</dd></div>` : ''}
        ${!contacts.always && !contacts.phones.length && !contacts.emails.length ? html`<div><dd class="muted">${t('international.ihr.none')}</dd></div>` : ''}
      </dl>
    </div></section>` : ''}

  ${hasPartners ? html`<section class="c-block" id="partners" aria-labelledby="h-partners"><h2 id="h-partners">${t('international.sec.partners')}</h2>
    ${multi ? html`<div class="c-intl__sub" id="multilateral"><h3>${t('international.sec.multi')}</h3>
      ${L(ctx, multi, 'summary') ? html`<p>${L(ctx, multi, 'summary')}</p>` : ''}
      ${highlights.length ? html`<ul class="c-intl__hl">${highlights.map((h) => html`<li><strong>${h.lead}</strong>${h.rest ? html`<span class="muted"> ${h.rest}</span>` : ''}</li>`)}</ul>` : ''}
      ${more(multi)}</div>` : ''}
    ${ghs ? html`<div class="c-intl__sub" id="ghs"><h3>${L(ctx, ghs, 'title')}</h3>${L(ctx, ghs, 'summary') ? html`<p>${L(ctx, ghs, 'summary')}</p>` : ''}${more(ghs)}</div>` : ''}
    ${bi ? html`<div class="c-intl__sub" id="bilateral"><h3>${t('international.sec.bi')}</h3>
      ${L(ctx, bi, 'summary') ? html`<p>${L(ctx, bi, 'summary')}</p>` : ''}
      ${bilateral && mapOpts?.isoCount ? html`<div class="c-intl__map">${TravelMap.worldMap(ctx, { title: t('international.map.title'), desc: t('international.map.desc'), classOf: mapOpts.classOf, labelOf: mapOpts.labelOf, legend: mapOpts.legend })}</div>` : ''}
      ${bilateral ? html`<div class="c-tablewrap" role="region" tabindex="0" aria-label="${t('a11y.scrollTable')}"><table class="c-table c-table--mou" id="mou-table"><caption class="sr-only">${t('international.bi.caption')}</caption>
        <thead><tr>${bilateral.header.map((h) => html`<th scope="col">${h}</th>`)}</tr></thead>
        <tbody>${bilateral.rows.map((r) => html`<tr data-iso="${r.isos.join(' ')}">${r.cells.map((c, i) => (i === 0 ? html`<th scope="row">${c}</th>` : html`<td>${c}</td>`))}</tr>`)}</tbody></table></div>` : ''}
      ${more(bi)}</div>` : ''}
  </section>` : ''}

  ${hasTraining ? html`<section class="c-block" id="training" aria-labelledby="h-training"><h2 id="h-training">${t('international.sec.training')}</h2>
    ${tr && L(ctx, tr, 'summary') ? html`<p>${L(ctx, tr, 'summary')}</p>` : ''}
    ${sv ? html`<div class="c-card c-intl__svc"><h3><a href="${hrefFor(ctx, sv)}"${isFallbackLink(ctx, sv) ? raw(' lang="zh-TW"') : ''}>${L(ctx, sv, 'title')}</a></h3>
      ${L(ctx, sv, 'summary') ? html`<p>${L(ctx, sv, 'summary')}</p>` : ''}
      <dl class="c-intl__facts">
        ${svWho.length ? html`<div><dt>${t('international.training.who')}</dt><dd>${svWho.join(' · ')}</dd></div>` : ''}
        ${svSteps.length ? html`<div><dt>${t('international.training.steps', { n: svSteps.length })}</dt><dd><ol class="c-intl__steps">${svSteps.slice(0, 5).map((s) => html`<li>${s.title ?? s}</li>`)}</ol></dd></div>` : ''}
        ${sv.slaDays ? html`<div><dt>SLA</dt><dd>${t('international.training.sla', { n: sv.slaDays })}</dd></div>` : ''}
      </dl>
      <p><a class="c-btn" href="${hrefFor(ctx, sv)}">${t('international.training.apply')} →</a></p></div>` : ''}
    ${more(tr)}</section>` : ''}

  ${hasPubs ? html`<section class="c-block" id="pubs" aria-labelledby="h-pubs"><h2 id="h-pubs">${t('international.sec.pubs')}</h2>
    ${pubsPage && L(ctx, pubsPage, 'summary') ? html`<p>${L(ctx, pubsPage, 'summary')}</p>` : ''}
    ${pubs.length ? html`<p class="muted">${t('international.pubs.lead')}</p><ul class="c-linklist">${pubs.map(({ p, href, fb }) => html`<li><a href="${href}"${fb ? raw(' lang="zh-TW"') : ''}>${L(ctx, p, 'title')}</a> <span class="muted">· ${ctx.fmtDate(p.publishedAt)}</span></li>`)}</ul>` : ''}
    <p class="c-linkrow"><a href="${url('/publications/')}">${t('international.pubs.all')} →</a>${pubsPage ? html` · <a href="${hrefOf(ctx, pubsPage)}">${t('international.more')} →</a>` : ''}</p></section>` : ''}

  <section class="c-block" id="news" aria-labelledby="h-news"><h2 id="h-news">${t('international.sec.news')}</h2>
    ${news.length ? html`<ul class="c-newslist">${news.map((n) => dated(ctx, n, { type: false }))}</ul>` : html`<p class="muted">${t('international.news.none')}</p>`}
    <p class="c-linkrow"><a href="${url('/news/')}">${t('home.news.all')} →</a></p></section>

  <section class="c-block" id="contact" aria-labelledby="h-contact"><h2 id="h-contact">${t('international.sec.contact')}</h2>
    <dl class="c-intl__facts c-intl__facts--contact">
      ${owner ? html`<div><dt>${t('international.contact.unit')}</dt><dd>${owner}</dd></div>` : ''}
      ${ihr && (contacts.phones.length || contacts.emails.length) ? html`<div><dt>${t('international.sec.ihr')}</dt><dd>${contacts.phones.map((p) => html`<a href="${telHref(p.num)}">${p.num}</a> `)}${contacts.emails.map((e) => html`<a href="mailto:${e}">${e}</a> `)}</dd></div>` : ''}
      ${sv?.contact ? html`<div><dt>${t('international.contact.service')}</dt><dd>${L(ctx, sv, 'contact') ?? sv.contact}</dd></div>` : ''}
      <div><dt>${t('international.contact.hotline')}</dt><dd><a href="tel:${config.hotline}">${config.hotline}</a></dd></div>
      <div><dt>${t('international.contact.hotline.intl')}</dt><dd><a href="${telHref(config.hotlineIntl)}">${config.hotlineIntl}</a></dd></div>
    </dl>
    <p><a class="c-btn c-btn--ghost c-btn--sm" href="${url('/contact/')}">${t('international.contact.page')} →</a></p></section>

  ${feedback(ctx, { page: ctx.path })}
  ${pageData(ctx, tp, { schema: 'WebPage', api: '/v1/topics.json', mdPath: '/international.md' })}
</article>`;
}

function hrefOf(ctx, p) { return langOk(ctx.site, p, ctx.lang) ? ctx.url(intlSubPath(p)) : ctx.url(intlSubPath(p), { noLang: true }); }

export function markdown(ctx) {
  const { site, t } = ctx;
  const tp = intlTopic(site);
  const subs = intlSubPages(site);
  const lines = [`# ${L(ctx, tp, 'title')}`, '', `> ${t('international.lead')}`, `> ID：${tp.id} · ${t('authority.source', { lang: ctx.t(`langname.${tp.sourceLang ?? 'zh-TW'}`) })}`, '', L(ctx, tp, 'summary') ?? '', ''];
  const bi = pageOf(subs, 'bilateral');
  const data = bilateralData(ctx, bi);
  if (subs.length) { lines.push(`## ${t('series.nav')}`, '', ...subs.map((p) => `- [${L(ctx, p, 'title')}](${ctx.url(intlSubPath(p), { absolute: true })})`), ''); }
  if (data) {
    lines.push(`## ${t('international.sec.bi')}`, '', `| ${data.header.join(' | ')} |`, `| ${data.header.map(() => '---').join(' | ')} |`, ...data.rows.map((r) => `| ${r.cells.map((c) => String(c).replace(/\|/g, '/')).join(' | ')} |`), '');
  }
  return lines.join('\n') + '\n';
}

void esc;
