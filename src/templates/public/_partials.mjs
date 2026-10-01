// 民眾端共用元件（partials）：12 個治理元件 + 常用區塊。底線開頭，不會被當成頁面。
// 其他 agent（D 答案頁、E、F）可直接 import；class 名稱是跨 agent 契約，請勿更動。
import { html, raw, esc } from '../../../scripts/lib/render.mjs';
import { config } from '../../../site.config.mjs';
import * as JL from '../../../scripts/lib/jsonld.mjs';

let _uid = 0;
export const uid = (p = 'u') => `${p}${++_uid}`;

/* ───────── 路徑與語言 ───────── */
export const slugOf = (item) => String(item.id).replace(/^[a-z]+\./, '');

export function itemPath(item) {
  switch (item.type) {
    case 'disease': return `/diseases/${item.slug}/`;
    case 'vaccine': return `/vaccines/${item.slug}/`;
    case 'faq': return `/faq/${slugOf(item)}/`;
    case 'news': case 'letter': return `/news/${slugOf(item)}/`;
    case 'document': return `/documents/${slugOf(item)}/`;
    case 'clarification': return `/factcheck/#${item.id}`;
    case 'dataset': return `/data/#${item.id}`;
    case 'page': return PAGE_PATHS[item.slug] ?? `/about/`;
    default: return '/';
  }
}
export const PAGE_PATHS = { 'ai-policy': '/policy/ai/', privacy: '/policy/privacy/', 'open-data': '/policy/open-data/', accessibility: '/accessibility/', about: '/about/' };

/** 內容在某語言是否有頁面（與 scripts/lib/pages.mjs 的 langAvailable 同規則；避免循環匯入） */
export function langOk(site, item, lang) {
  if (lang === 'zh-TW') return true;
  const st = item.languages?.[lang]?.status;
  if (!st || st === 'none' || st === 'pending') return false;
  if (site.config.tier1Types.includes(item.type)) return st === 'reviewed';
  return true;
}

/** 連到內容頁：該語言有頁面就用該語言，否則連中文正本 */
export function hrefFor(ctx, item) {
  const p = itemPath(item);
  return langOk(ctx.site, item, ctx.lang) ? ctx.url(p) : ctx.url(p, { noLang: true });
}
export const isFallbackLink = (ctx, item) => !langOk(ctx.site, item, ctx.lang);

/** 本地化欄位：i18n[lang][field] ?? item[field]（僅在該語言頁可用時才有意義） */
export function L(ctx, item, field) {
  if (ctx.lang === 'zh-TW') return item[field];
  return item.i18n?.[ctx.lang]?.[field] ?? item[field];
}
export const unitOf = (ctx, id) => ctx.site.unitById.get(id);
export function unitName(ctx, id) {
  const u = unitOf(ctx, id);
  if (!u) return id ?? '';
  return ctx.lang === 'zh-TW' ? u.name : (u.nameEn ?? u.name);
}
export function diseaseName(ctx, dm) {
  if (!dm) return '';
  if (ctx.lang === 'zh-TW') return dm.name;
  if (ctx.lang === 'en') return dm.nameEn ?? dm.name;
  const g = ctx.site.master.glossary.find((x) => x.refs?.includes(dm.id));
  return g?.[ctx.lang] ?? dm.nameEn ?? dm.name;
}
export const licenseLabel = (ctx, id) => ctx.site.config.licenses.labels[id] ?? id;
export const diseasePage = (ctx, diseaseId) => ctx.site.collections.diseases.find((d) => d.id === diseaseId && d.status === 'published');
export function diseaseHref(ctx, diseaseId) {
  const d = diseasePage(ctx, diseaseId);
  return d ? hrefFor(ctx, d) : null;
}
export const publishedOf = (site, key) => site.collections[key].filter((i) => i.status === 'published');
export const byDateDesc = (a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt));
export const sitField = (ctx, it, f) => (ctx.lang === 'zh-TW' ? it[f] : (it.i18n?.[ctx.lang]?.[f] ?? it.i18n?.en?.[f] ?? it[f]));
export const trendArrow = (trend) => (trend === 'up' ? '↑' : trend === 'down' ? '↓' : '→');
/** 外部或站內連結：/ 開頭走 ctx.url */
export const link = (ctx, u) => (u && u.startsWith('/') ? ctx.url(u) : u);
export const isExternal = (u) => /^https?:\/\//.test(u ?? '');

/* ───────── 麵包屑 ───────── */
export function breadcrumb(ctx, trail) {
  const { t, url } = ctx;
  const all = [{ label: t('nav.home'), href: '/' }, ...trail];
  return html`<nav class="c-breadcrumb" aria-label="${t('nav.breadcrumb')}"><ol>${all.map((c, i) => (i === all.length - 1 || !c.href
    ? html`<li aria-current="page">${c.label}</li>`
    : html`<li><a href="${url(c.href)}">${c.label}</a></li>`))}</ol></nav>`;
}
export function breadcrumbLd(ctx, trail) {
  const all = [{ label: ctx.t('nav.home'), href: '/' }, ...trail];
  if (typeof JL.breadcrumbJsonLd === 'function') { try { return JL.breadcrumbJsonLd(ctx, all); } catch { /* fallthrough */ } }
  return {
    '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: all.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: String(c.label), ...(c.href ? { item: `${config.siteUrl}${ctx.url(c.href)}` } : {}) })),
  };
}
/** meta.jsonLd 組裝：jsonLdFor + 麵包屑；用 try 保護 */
export function ldFor(ctx, item, trail) {
  const out = [];
  try { if (item && typeof JL.jsonLdFor === 'function') out.push(...[].concat(JL.jsonLdFor(ctx, item))); } catch { /* 不讓 JSON-LD 失敗拖垮頁面 */ }
  if (trail) out.push(breadcrumbLd(ctx, trail));
  return out;
}

/* ───────── 元件 1：內容來歷條 ───────── */
export function provenance(ctx, item, { showAi = true, extra = null } = {}) {
  const { t, fmtDate } = ctx;
  const g = item.gov ?? {};
  const ver = item.version;
  const sup = item.supersedes ? ctx.site.byId.get(item.supersedes) : null;
  const supBy = g.supersededBy ? ctx.site.byId.get(g.supersededBy) : null;
  return html`<div class="c-provenance">
  <p class="c-provenance__line">
    <span><span class="c-provenance__k">${t('prov.owner')}</span> ${unitName(ctx, item.owner)}</span>
    <span><span class="c-provenance__k">${t('prov.reviewed')}</span> <time datetime="${item.reviewedAt}">${fmtDate(item.reviewedAt)}</time></span>
    ${g.nextReviewAt ? html`<span><span class="c-provenance__k">${t('prov.next')}</span> <time datetime="${g.nextReviewAt}">${fmtDate(g.nextReviewAt)}</time></span>` : ''}
    ${showAi && g.whitelist?.effective ? html`<span class="c-provenance__ai">${t('prov.ai')}</span>` : ''}
  </p>
  <dl class="c-provenance__pro c-pro-only">
    ${ver ? html`<div><dt>${t('prov.version')}</dt><dd>${ver}${g.isCurrent === false ? ` · ${t('prov.superseded')}` : item.type === 'document' ? ` · ${t('prov.current')}` : ''}</dd></div>` : ''}
    ${item.effectiveAt ? html`<div><dt>${t('prov.effective')}</dt><dd>${fmtDate(item.effectiveAt)}</dd></div>` : ''}
    ${sup ? html`<div><dt>${t('prov.supersedes')}</dt><dd><a href="${hrefFor(ctx, sup)}">${sup.version ?? sup.title}</a></dd></div>` : ''}
    ${supBy ? html`<div><dt>${t('prov.supersededBy')}</dt><dd><a href="${hrefFor(ctx, supBy)}">${supBy.version ?? supBy.title}</a></dd></div>` : ''}
    <div><dt>${t('prov.next')}</dt><dd>${g.nextReviewAt ? fmtDate(g.nextReviewAt) : t('prov.event')}</dd></div>
    <div><dt>${t('prov.id')}</dt><dd><code>${item.id}</code></dd></div>
    <div><dt>${t('prov.license')}</dt><dd>${licenseLabel(ctx, item.license)}</dd></div>
    ${extra ?? ''}
  </dl>
  <p class="c-provenance__actions c-pro-only">
    <button type="button" class="c-btn c-btn--sm c-btn--ghost" data-cite data-cite-title="${L(ctx, item, 'title')}" data-cite-owner="${unitName(ctx, item.owner)}" data-cite-reviewed="${item.reviewedAt}">${t('pro.cite')}</button>
    ${item.type === 'document' && item.family ? html`<button type="button" class="c-btn c-btn--sm c-btn--ghost" data-subscribe="${item.family}" aria-pressed="false">${t('pro.subscribe')}</button>` : html`<button type="button" class="c-btn c-btn--sm c-btn--ghost" data-subscribe="${item.id}" aria-pressed="false">${t('pro.subscribe')}</button>`}
  </p>
</div>`;
}

/* ───────── 元件 2：逾期與失效警示（狀況層） ───────── */
export function alertBox(kind, content, { role = 'alert' } = {}) {
  return html`<div class="c-alert c-alert--${kind}" role="${role}">${content}</div>`;
}
export function alerts(ctx, item, { skip = [] } = {}) {
  const { t, site, fmtDate } = ctx;
  const g = item.gov;
  if (!g) return '';
  const zh = ctx.lang === 'zh-TW';
  const out = [];
  for (const a of g.annotations ?? []) {
    if (!['superseded', 'overdue', 'based-on-revised', 'scheduled', 'archived'].includes(a.kind) || skip.includes(a.kind)) continue;
    const cls = a.kind === 'scheduled' || a.kind === 'archived' ? 'info' : a.kind;
    let href = null;
    if (a.path) href = ctx.url(a.path);
    else if (a.targetId || a.href) { const tg = site.byId.get(a.targetId ?? a.href); if (tg) href = hrefFor(ctx, tg); }
    let text = a.text;
    if (!zh) {
      if (a.kind === 'superseded') text = t('alert.superseded', { v: item.version ?? '', date: fmtDate(site.byId.get(g.supersededBy)?.effectiveAt) });
      if (a.kind === 'overdue') text = t('alert.overdue', { date: fmtDate(g.nextReviewAt) });
      if (a.kind === 'based-on-revised') text = t('alert.revised', { pub: fmtDate(item.publishedAt), title: a.currentTitle ?? '', rev: fmtDate(a.revisedAt) });
    }
    out.push(alertBox(cls, html`<strong class="c-alert__t">${t(`alert.${cls}.t`)}</strong> ${text} ${href ? html`<a class="c-alert__go" href="${href}">${t('alert.go')} →</a>` : ''}`));
  }
  return out.length ? html`<div class="c-alerts">${out}</div>` : '';
}

/* ───────── 元件 3：本頁的資料（頁尾收合） ───────── */
export function pageData(ctx, item, { schema = 'WebPage', api = null, mdPath = null, extra = '' } = {}) {
  const { t, url } = ctx;
  const g = item.gov ?? {};
  return html`<details class="c-page-data" data-group="ondemand">
  <summary>${t('pagedata.title')}</summary>
  <ul>
    <li>${t('pagedata.schema')}：<code>schema.org/${schema}</code> · JSON-LD</li>
    ${api ? html`<li>${t('pagedata.api')}：<a href="${url(api, { noLang: true })}"><code>${api}</code></a></li>` : ''}
    ${mdPath ? html`<li>${t('pagedata.md')}：<a href="${url(mdPath)}"><code>${mdPath.split('/').filter(Boolean).pop()}</code></a></li>` : ''}
    <li>${t('pagedata.license')}：${licenseLabel(ctx, item.license)}（<code>${item.license}</code>）</li>
    <li>${g.whitelist?.effective ? t('pagedata.whitelist') : `${t('pagedata.notwhitelist')}${g.whitelist?.reasons?.length ? `（${g.whitelist.reasons.join('、')}）` : ''}`}</li>
    <li>ID：<code>${item.id}</code></li>
    ${extra}
    <li><a href="${url('/policy/ai/')}">${t('pagedata.report')}</a></li>
  </ul>
</details>`;
}

/* ───────── 元件 7：翻譯狀態標記 ───────── */
export function translationBadge(ctx, kind, { text = null } = {}) {
  const map = { reviewed: 'translation.reviewed', machine: 'translation.machine', none: 'translation.none' };
  const k = map[kind] ?? map.none;
  return html`<span class="c-translation-badge c-translation-badge--${kind in map ? kind : 'none'}">${text ?? ctx.t(k)}</span>`;
}

/* ───────── 元件 8：疫情狀態標籤（含浮層） ───────── */
export function statusTag(ctx, it, { label = null } = {}) {
  const { t, site, fmtDate } = ctx;
  const id = uid('stp-');
  const pub = site.situation.publisher;
  return html`<span class="c-status"><span class="c-status-tag c-status-tag--${it.status}" tabindex="0" role="button" aria-describedby="${id}"${label ? raw(` aria-label="${esc(label)}"`) : ''}>${t(`status.${it.status}`)}</span><span class="c-status__pop" id="${id}" role="tooltip">
  <span><b>${t('status.pop.publisher')}</b> ${unitName(ctx, pub)}</span>
  <span><b>${t('status.pop.effective')}</b> ${fmtDate(site.situation.publishedAt)}</span>
  <span><b>${t('status.pop.basis')}</b> ${it.basis}</span>
  <span class="c-status__pop-note">${t('status.pop.note')}</span></span></span>`;
}

/* ───────── 疫情態勢卡（首頁／態勢頁／任務頁共用） ───────── */
export function sitCard(ctx, it, { variant = 'compact' } = {}) {
  const { site, t } = ctx;
  const dm = site.diseaseMasterById.get(it.disease);
  const href = diseaseHref(ctx, it.disease);
  const name = diseaseName(ctx, dm) || it.disease;
  return html`<article class="c-sit-card c-sit-card--${it.status} c-sit-card--${variant}">
  <header class="c-sit-card__head"><h3>${href ? html`<a href="${href}">${name}</a>` : name}</h3>${statusTag(ctx, it)}</header>
  <p class="c-sit-card__metric"><span class="c-sit-card__arrow c-sit-card__arrow--${it.trend}" aria-hidden="true">${trendArrow(it.trend)}</span><span class="c-sit-card__num">${sitField(ctx, it, 'metricValue')}</span><span class="sr-only">${t(`trend.${it.trend}`)}</span>${it.illustrative ? html`<span class="c-sit-card__demo">${t('illustrative')}</span>` : ''}</p>
  <p class="c-sit-card__desc">${sitField(ctx, it, 'metricLabel')}${sitField(ctx, it, 'deltaText') ? html`<br><span class="c-sit-card__delta">${sitField(ctx, it, 'deltaText')}</span>` : ''}</p>
  <p class="c-sit-card__advice"><b>${t('sit.advice')}</b>${sitField(ctx, it, 'advice')}</p>
</article>`;
}

/* ───────── 元件 9：數字的來源卡 ───────── */
/** 行內：數字旁的小來源標籤 */
export function numberSource(ctx, { source, dataDate, href = null, illustrative = false }) {
  const { t, fmtDate } = ctx;
  return html`<span class="c-number-source">${illustrative ? html`<b>${t('illustrative')}</b> · ` : ''}${t('source')}：${href ? html`<a href="${href}">${source}</a>` : source}${dataDate ? html` · ${t('dataDate')} ${fmtDate(dataDate)}` : ''}</span>`;
}
/** 展開卡：正本、資料日、Owner、授權、CSV/JSON/API 連結 */
export function sourceCard(ctx, o) {
  const { t, fmtDate } = ctx;
  const { title = t('source.card'), canonicalUrl, dataDate, owner, license, links = [], note = '', open = false } = o;
  return html`<details class="c-source-card" data-group="ondemand" ${open ? raw('open') : ''}>
  <summary>${title}</summary>
  <dl>
    ${canonicalUrl ? html`<div><dt>${t('source.canonical')}</dt><dd><a href="${canonicalUrl}" rel="noopener">${canonicalUrl}</a></dd></div>` : ''}
    ${dataDate ? html`<div><dt>${t('dataDate')}</dt><dd>${fmtDate(dataDate)}</dd></div>` : ''}
    ${owner ? html`<div><dt>Owner</dt><dd>${owner}</dd></div>` : ''}
    ${license ? html`<div><dt>${t('prov.license')}</dt><dd>${licenseLabel(ctx, license)}</dd></div>` : ''}
    ${links.length ? html`<div><dt>${t('source.formats')}</dt><dd>${links.map((l) => html`<a class="c-source-card__fmt" href="${l.href}">${l.label}</a> `)}</dd></div>` : ''}
  </dl>
  ${note ? html`<p class="muted">${note}</p>` : ''}
</details>`;
}
/** 由 dataset 內容項產生來源卡 */
export function datasetSourceCard(ctx, ds, o = {}) {
  if (!ds) return '';
  const links = [];
  for (const f of ds.formats ?? []) links.push({ label: f, href: ds.canonicalUrl });
  links.push({ label: 'API', href: ctx.url('/v1/datasets.json', { noLang: true }) });
  return sourceCard(ctx, { title: `${ctx.t('source.card')} · ${L(ctx, ds, 'title')}`, canonicalUrl: ds.canonicalUrl, dataDate: ds.lastUpdated, owner: unitName(ctx, ds.owner), license: ds.license, links, note: ds.provenance ? `${ctx.t('source.mode')}：${ds.provenance.mode}${ds.provenance.fetchedAt ? ` · ${ds.provenance.fetchedAt}` : ''}` : '', ...o });
}

/* ───────── 元件 10：暫停橫幅 ───────── */
export function pausedBanner(ctx) {
  const { t, url, site } = ctx;
  if (!site.gov?.pausedAI) return '';
  const st = site.governance?.aiStatus ?? {};
  return html`<div class="c-banner--paused" role="status"><div class="wrap c-banner--paused__in"><strong>${t('alert.paused.t')}</strong> <span>${t('alert.paused')}${st.reason ? ` ${st.reason}` : ''}</span> <a href="${url('/policy/ai/')}">${t('alert.paused.more')}</a></div></div>`;
}

/* ───────── 元件 11：對象與範圍標記 ───────── */
export function scopeTags(ctx, item, { region = true } = {}) {
  const { t } = ctx;
  const aud = item?.audience ?? ['public'];
  return html`<span class="c-scope-tags">${aud.includes('public') ? html`<span class="c-scope-tag c-scope-tag--public">${t('scope.public')}</span>` : ''}${aud.includes('professional') ? html`<span class="c-scope-tag c-scope-tag--pro">${t('scope.pro')}</span>` : ''}${region ? html`<span class="c-scope-tag c-scope-tag--region">${t('scope.region')}</span>` : ''}</span>`;
}
/** 民眾版／專業版切換（頁面右上） */
export function viewToggle(ctx) {
  const { t } = ctx;
  return html`<div class="c-viewtoggle" role="group" aria-label="${t('view.label')}"><button type="button" data-view-set="public" aria-pressed="true">${t('view.public')}</button><button type="button" data-view-set="pro" aria-pressed="false">${t('view.pro')}</button></div>`;
}

/* ───────── 元件 6：回報與稽核編號 ───────── */
export function feedback(ctx, { auditId = '', page = null, label = null } = {}) {
  const { t } = ctx;
  const fid = uid('fb-');
  return html`<div class="c-feedback" data-feedback data-audit-id="${auditId}" data-page="${page ?? ctx.path ?? ''}">
  <span class="c-feedback__meta">${label ?? t('feedback.q')}</span>
  <button type="button" class="c-feedback__btn" data-act="helpful" aria-pressed="false">${t('feedback.helpful')} <span class="c-feedback__count" aria-hidden="true"></span></button>
  <details class="c-feedback__report" data-group="ondemand">
    <summary>${t('feedback.report')}</summary>
    <form class="c-feedback__form" data-feedback-form>
      <label for="${fid}">${t('feedback.what')}</label>
      <textarea id="${fid}" name="text" rows="3" required></textarea>
      <p class="muted">${t('feedback.idnote')} <code data-audit-slot>${auditId || '—'}</code></p>
      <button type="submit" class="c-btn c-btn--sm">${t('feedback.send')}</button>
      <p class="c-feedback__done" role="status" hidden>${t('feedback.thanks')}</p>
    </form>
  </details>
  ${auditId ? html`<span class="c-feedback__id">${t('feedback.id')} <code>${auditId}</code></span>` : ''}
</div>`;
}

/* ───────── 問題框 ───────── */
export function askBox(ctx, { id = uid('q-'), placeholder = null, disease = null, vaccine = null, task = null, size = 'lg', note = null, value = '', btn = null, label = null } = {}) {
  const { t, url } = ctx;
  return html`<form class="c-askbox c-askbox--${size}" action="${url('/ask/')}" method="get" role="search">
  <label class="sr-only" for="${id}">${label ?? t('home.h1')}</label>
  <input id="${id}" name="q" type="search" value="${value}" placeholder="${placeholder ?? t('home.placeholder')}" autocomplete="off" enterkeyhint="search">
  ${disease ? html`<input type="hidden" name="disease" value="${disease}">` : ''}
  ${vaccine ? html`<input type="hidden" name="vaccine" value="${vaccine}">` : ''}
  ${task ? html`<input type="hidden" name="task" value="${task}">` : ''}
  <button type="submit" class="c-askbox__btn">${btn ?? t('home.ask')}</button>
  ${note ? html`<p class="c-askbox__note">${note}</p>` : ''}
</form>`;
}

/* ───────── 判定與其他小元件 ───────── */
export function verdictPill(ctx, verdict, { outdated = false } = {}) {
  const v = outdated ? 'outdated' : verdict;
  return html`<span class="c-verdict c-verdict--${v}">${ctx.t(`verdict.${v}`)}</span>`;
}
export function pill(text, kind = 'neutral') { return html`<span class="c-pill c-pill--${kind}">${text}</span>`; }

export function taskCard(ctx, task, { foreign = false } = {}) {
  const { t, url } = ctx;
  if (foreign) {
    const subs = t('home.foreign.sub').split(' · ');
    return html`<a class="c-task c-task--foreign" href="${url('/ask/')}?q=${encodeURIComponent(t('home.foreign.q'))}"><strong class="c-task__t">${t('home.foreign.label')}</strong><span class="c-task__zh">${t('home.foreign.zh')}</span><ul class="c-task__subs">${subs.map((s) => html`<li>${s}</li>`)}</ul></a>`;
  }
  const subs = t(`task.${task.key}.sub`).split(' · ');
  return html`<a class="c-task" href="${url(`/tasks/${task.key}/`)}"><strong class="c-task__t">${t(`task.${task.key}.label`)}</strong><ul class="c-task__subs">${subs.map((s) => html`<li>${s}</li>`)}</ul></a>`;
}

/** 單一分頁頂部：H1 + 說明 + 範圍標記 */
export function pageHead(ctx, { trail = [], h1, lead = '', tags = '', actions = '' }) {
  return html`${trail.length ? breadcrumb(ctx, trail) : ''}
<header class="c-pagehead"><div class="c-pagehead__main"><h1>${h1}</h1>${lead ? html`<p class="lead">${lead}</p>` : ''}${tags}</div>${actions ? html`<div class="c-pagehead__actions">${actions}</div>` : ''}</header>`;
}

export function sectionHead(ctx, { id, title, more = null, moreHref = null, note = null }) {
  return html`<div class="c-sechead"><h2 id="${id}">${title}</h2>${note ? html`<span class="c-sechead__note">${note}</span>` : ''}${more ? html`<a class="c-sechead__more" href="${moreHref}">${more}</a>` : ''}</div>`;
}

/** 通用清單項：標題 + 日期 */
export function dated(ctx, item, { type = true } = {}) {
  const href = hrefFor(ctx, item);
  const fb = isFallbackLink(ctx, item);
  return html`<li><time datetime="${item.publishedAt}">${ctx.fmtDate(item.publishedAt)}</time> ${type && item.newsType ? html`<span class="c-pill c-pill--neutral">${ctx.t(`news.type.${item.newsType}`)}</span> ` : ''}<a href="${href}"${fb ? raw(' lang="zh-TW"') : ''}>${L(ctx, item, 'title')}</a></li>`;
}

/** 資料集序列 → 圖（SVG 字串由呼叫端用 charts.js 產） */
export function seriesOf(ds) { return ds?.series?.points?.length ? ds.series : null; }

export function mdLine(s) { return String(s ?? '').replace(/\n+/g, ' '); }
