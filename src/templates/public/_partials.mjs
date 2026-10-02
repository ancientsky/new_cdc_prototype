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
    case 'page': return PAGE_PATHS[item.slug] ?? (String(item.slug ?? '').includes('/') ? `/${item.slug}/` : '/about/');
    case 'media': return `/media/${slugOf(item)}/`;
    case 'topic': return `/topics/${item.slug ?? slugOf(item)}/`;
    case 'service': return `/apply/${item.slug ?? slugOf(item)}/`;
    case 'publication': return `/publications/${slugOf(item)}/`;
    case 'labtest': return `/lab/${slugOf(item)}/`;
    case 'research': return `/research/${slugOf(item)}/`;
    case 'banner': return `/campaigns/#${item.id}`;
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
    if (!['superseded', 'overdue', 'based-on-revised', 'scheduled', 'archived', 'closed', 'ended'].includes(a.kind) || skip.includes(a.kind)) continue;
    const cls = a.kind === 'scheduled' || a.kind === 'archived' ? 'info' : a.kind;
    let href = null;
    if (a.path) href = ctx.url(a.path);
    else if (a.targetId || a.href) { const tg = site.byId.get(a.targetId ?? a.href); if (tg) href = hrefFor(ctx, tg); }
    let text = a.text;
    if (!zh) {
      if (a.kind === 'superseded') text = t('alert.superseded', { v: item.version ?? '', date: fmtDate(site.byId.get(g.supersededBy)?.effectiveAt) });
      if (a.kind === 'overdue') text = t('alert.overdue', { date: fmtDate(g.nextReviewAt) });
      if (a.kind === 'based-on-revised') text = t('alert.revised', { pub: fmtDate(item.publishedAt), title: a.currentTitle ?? '', rev: fmtDate(a.revisedAt) });
      if (a.kind === 'closed') text = t('notice.closed.msg', { date: fmtDate(a.deadlineAt ?? item.deadlineAt) });
      if (a.kind === 'ended') text = t('topic.ended', { date: fmtDate(a.endAt ?? item.endAt) });
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

/* ═════════════ 第二輪（C2）：影音、專區、申請、公告、機關型區塊共用元件 ═════════════ */

/** 圖片路徑 → 可用的 src（站內路徑走 basePath；外部網址原樣） */
export function imgSrc(ctx, p) {
  if (!p) return null;
  if (/^(https?:)?\/\//.test(p) || p.startsWith('data:')) return p;
  return ctx.url(p.startsWith('/') ? p : `/${p}`, { noLang: true });
}

/** 秒數 → m:ss / h:mm:ss */
export function fmtDur(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return `${h ? `${h}:` : ''}${mm}:${String(r).padStart(2, '0')}`;
}

const dayDiff = (a, b) => Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000);
/** 距離截止日剩幾天（負數＝已過） */
export const daysUntil = (today, iso) => (iso ? dayDiff(today, iso) : null);
/** 距截止日天數：治理引擎的 gov.daysToDeadline 優先 */
export const daysLeft = (site, n) => (typeof n.gov?.daysToDeadline === 'number' ? n.gov.daysToDeadline : daysUntil(site.today, n.deadlineAt));

/** 公告是否已截止：治理引擎的 gov.closed 優先，否則由欄位推算 */
export function isClosed(site, n) {
  if (n.gov && typeof n.gov.closed === 'boolean') return n.gov.closed;
  return !!n.deadlineAt && n.deadlineAt < site.today;
}
export function isClosingSoon(site, n) {
  if (isClosed(site, n)) return false;
  if (n.gov && typeof n.gov.closingSoon === 'boolean') return n.gov.closingSoon;
  const d = daysLeft(site, n);
  return d != null && d >= 0 && d <= 7;
}
export const NOTICE_TYPES = ['recruit', 'procurement', 'other'];
export const isNotice = (n) => NOTICE_TYPES.includes(n.newsType);
export const HOME_NEWS_TYPES = ['press', 'clarification', 'letter'];

/** 專區是否已結束 */
export function isTopicEnded(site, tp) {
  if (tp.gov && typeof tp.gov.ended === 'boolean') return tp.gov.ended;
  return !!tp.endAt && tp.endAt < site.today;
}

/** 影音是否依據已修訂的正本（過時）：gov.mediaOutdated 優先；否則由 basedOn 現行版 effectiveAt 與 producedAt 比對 */
export function isMediaOutdated(site, m) {
  if (m.gov && typeof m.gov.mediaOutdated === 'boolean') return m.gov.mediaOutdated;
  if (m.gov?.annotations?.some((a) => a.kind === 'based-on-revised')) return true;
  return !!currentBasis(site, m, true);
}
/** basedOn 的現行版；onlyNewer＝只回傳比 producedAt 更新的現行版 */
/** 參照（內容 id，或文件 family id）→ 內容項；family 取現行版 */
export function refItem(site, ref) {
  const d = site.byId.get(ref);
  if (d) return d;
  const docs = site.collections.documents ?? [];
  return docs.find((x) => x.family === ref && x.isCurrent && x.status === 'published') ?? docs.find((x) => x.family === ref) ?? null;
}
export function currentBasis(site, m, onlyNewer = false) {
  for (const ref of m.basedOn ?? []) {
    const d = refItem(site, ref);
    if (!d) continue;
    const cur = d.type === 'document'
      ? (d.isCurrent ? d : site.collections.documents.find((x) => x.family === d.family && x.isCurrent && x.status === 'published') ?? d)
      : d;
    if (!onlyNewer) return cur;
    if (cur?.effectiveAt && m.producedAt && cur.effectiveAt > m.producedAt) return cur;
  }
  return null;
}

/** 單位統計：相容 site.gov.byOwner 為陣列或物件；缺資料時自行由 site.all 計算 */
export function ownerStats(site, id) {
  const b = site.gov?.byOwner;
  let row = null;
  if (Array.isArray(b)) row = b.find((r) => (r.unit ?? r.id) === id);
  else if (b && typeof b === 'object') row = b[id];
  if (row) return { content: row.content ?? row.published ?? 0, whitelist: row.whitelist ?? 0, types: row.types ?? null, latest: row.latestReviewedAt ?? null };
  const own = (site.all ?? []).filter((i) => i.owner === id);
  return { content: own.length, whitelist: own.filter((i) => i.gov?.whitelist?.effective).length, types: null, latest: own.map((i) => i.reviewedAt).filter(Boolean).sort().pop() ?? null };
}

/* ───── 影音：海報（無圖時的示意海報）與卡片 ───── */
export function posterArt(label = '') {
  return raw(`<svg viewBox="0 0 320 180" class="c-media-card__svg" aria-hidden="true" focusable="false" preserveAspectRatio="xMidYMid slice"><rect width="320" height="180" fill="#e5efe9"/><circle cx="260" cy="40" r="56" fill="#cfe3d8"/><circle cx="50" cy="150" r="46" fill="#cfe3d8"/><circle cx="160" cy="90" r="26" fill="#1b5e3f"/><path d="M152 78l22 12-22 12z" fill="#fff"/>${label ? `<text x="160" y="160" text-anchor="middle" font-size="12" fill="#164d37">${esc(label)}</text>` : ''}</svg>`);
}
export function posterImg(ctx, m, { loading = 'lazy' } = {}) {
  const src = imgSrc(ctx, m.poster);
  return src ? html`<img class="c-media-card__img" src="${src}" alt="" width="320" height="180" loading="${loading}">` : posterArt();
}

/** 影音卡：海報 16:9、時長角標、過時標記、「依 … 製作」小字；整張卡可點（標題連結拉伸） */
export function mediaCard(ctx, m, { tag = 'li' } = {}) {
  const { t } = ctx;
  const outdated = isMediaOutdated(ctx.site, m);
  const fb = isFallbackLink(ctx, m);
  const open = tag === 'li' ? '<li' : '<div';
  const close = tag === 'li' ? '</li>' : '</div>';
  const diseases = (m.diseases ?? []).join(' ');
  return raw(`${open} class="c-media-card${outdated ? ' c-media-card--outdated' : ''}" data-disease="${esc(diseases)}" data-task="${esc((m.tasks ?? []).join(' '))}" data-cap="${esc((m.captions ?? []).join(' '))}" data-outdated="${outdated ? '1' : '0'}">${html`
  <div class="c-media-card__poster">${posterImg(ctx, m)}${m.durationSeconds ? html`<span class="c-media-card__dur"><span class="sr-only">${t('media.duration')} </span>${fmtDur(m.durationSeconds)}</span>` : ''}${outdated ? html`<span class="c-media-card__flag">${t('media.outdated.tag')}</span>` : ''}</div>
  <div class="c-media-card__body">
    <h3 class="c-media-card__t"><a href="${hrefFor(ctx, m)}"${fb ? raw(' lang="zh-TW"') : ''}>${fb ? m.title : L(ctx, m, 'title')}</a></h3>
    ${m.basedOnVersionLabel ? html`<p class="c-media-card__basis">${t('media.basedOn.short', { v: m.basedOnVersionLabel })}</p>` : ''}
  </div>`}${close}`);
}

/* ───── 服務：八圖示入口 ───── */
const SVC_ICONS = {
  report: '<path d="M3 10v4h3l5 4V6L6 10z"/><path d="M15 9a4 4 0 0 1 0 6M18 6a8 8 0 0 1 0 12"/>',
  lab: '<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3"/><path d="M7.5 15h9"/>',
  media: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 9l5 3-5 3z"/>',
  data: '<path d="M4 20V10m6 10V4m6 16v-7m4 7H2"/>',
  apply: '<path d="M6 3h8l5 5v13H6z"/><path d="M14 3v5h5M9 13h7M9 17h7"/>',
  research: '<circle cx="11" cy="11" r="6"/><path d="M16 16l5 5"/>',
  publications: '<path d="M4 5a2 2 0 0 1 2-2h13v15H6a2 2 0 0 0-2 2z"/><path d="M4 20a2 2 0 0 0 2 2h13M9 7h6"/>',
  fund: '<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/>',
};
export const svcIcon = (name, size = 28) => raw(`<svg class="c-services__ic" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${SVC_ICONS[name] ?? ''}</svg>`);

export const SERVICE_ITEMS = [
  { key: 'report', path: '/report/' }, { key: 'lab', path: '/lab/' }, { key: 'media', path: '/media/' }, { key: 'data', path: '/data/' },
  { key: 'apply', path: '/apply/' }, { key: 'research', path: '/research/' }, { key: 'publications', path: '/publications/' }, { key: 'fund', path: '/apply/' },
];
/** 「應用專區」八圖示（/services/ 與 /pro/ 共用） */
export function servicesGrid(ctx, { heading = null } = {}) {
  const { t, url, site } = ctx;
  const hasFund = (site.collections.services ?? []).some((s) => s.slug === 'vaccine-fund-donation' && s.status === 'published');
  return html`<nav class="c-services" aria-label="${heading ?? t('services.title')}"><ul class="c-services__grid">${SERVICE_ITEMS.map((s) => {
    const path = s.key === 'fund' && hasFund ? '/apply/vaccine-fund-donation/' : s.path;
    return html`<li><a class="c-services__item" href="${url(path)}">${svcIcon(s.key)}<span class="c-services__t">${t(`services.${s.key}`)}</span><span class="c-services__sub">${t(`services.${s.key}.sub`)}</span></a></li>`;
  })}</ul></nav>`;
}

/* ───── 公告列（人才招募／採購／其他） ───── */
export function deadlinePill(ctx, n) {
  const { t, site, fmtDate } = ctx;
  if (!n.deadlineAt) return html`<span class="c-pill c-pill--neutral">${t('notice.nodeadline')}</span>`;
  const closed = isClosed(site, n);
  const d = daysLeft(site, n);
  if (closed) return html`<span class="c-deadline c-deadline--closed">${t('notice.closed.on', { date: fmtDate(n.deadlineAt) })}</span>`;
  const soon = isClosingSoon(site, n);
  const txt = d === 0 ? t('notice.today') : t('notice.daysleft', { n: d });
  return html`<span class="c-deadline ${soon ? 'c-deadline--soon' : 'c-deadline--open'}">${txt}</span>`;
}
export function noticeRow(ctx, n) {
  const { t, fmtDate, site } = ctx;
  const closed = isClosed(site, n);
  const fb = isFallbackLink(ctx, n);
  const href = hrefFor(ctx, n);
  return html`<li class="c-notice${closed ? ' c-notice--closed' : ''}" data-type="${n.newsType}" data-state="${closed ? 'closed' : 'open'}">
  <div class="c-notice__main">
    <p class="c-notice__t"><span class="c-pill c-pill--${n.newsType === 'recruit' ? 'info' : n.newsType === 'procurement' ? 'warn' : 'neutral'}">${t(`news.type.${n.newsType}`)}</span> <a href="${href}"${fb ? raw(' lang="zh-TW"') : ''}>${fb ? n.title : L(ctx, n, 'title')}</a></p>
    <p class="c-notice__meta muted">${n.refNo ? html`${t('notice.refNo')}：${n.refNo} · ` : ''}${t('news.published')} ${fmtDate(n.publishedAt)} · ${unitName(ctx, n.owner)}${n.positions ? ` · ${t('notice.positions')}：${n.positions}` : ''}${n.budgetNtd ? ` · ${t('notice.budget')}：${Number(n.budgetNtd).toLocaleString('en-US')}` : ''}</p>
  </div>
  <div class="c-notice__side">${deadlinePill(ctx, n)}${n.applyUrl && !closed ? html`<a class="c-btn c-btn--sm c-btn--ghost" href="${n.applyUrl}" rel="noopener">${n.newsType === 'procurement' ? t('notice.bid') : t('notice.apply')} ↗</a>` : ''}</div>
</li>`;
}

/* ───── 專區卡 ───── */
export function topicCard(ctx, tp) {
  const { t } = ctx;
  const img = imgSrc(ctx, tp.image);
  const fb = isFallbackLink(ctx, tp);
  return html`<li class="c-topiccard">
  <a class="c-topiccard__a" href="${hrefFor(ctx, tp)}"${fb ? raw(' lang="zh-TW"') : ''}>
    <span class="c-topiccard__img">${img ? html`<img src="${img}" alt="" width="96" height="96" loading="lazy">` : raw('<svg viewBox="0 0 96 96" aria-hidden="true" focusable="false"><rect width="96" height="96" fill="#e5efe9"/><circle cx="48" cy="44" r="18" fill="#1b5e3f"/><path d="M40 44h16M48 36v16" stroke="#fff" stroke-width="5" stroke-linecap="round"/></svg>')}</span>
    <span class="c-topiccard__body"><strong class="c-topiccard__t">${fb ? tp.title : L(ctx, tp, 'title')}</strong><span class="c-topiccard__s">${fb ? tp.summary : L(ctx, tp, 'summary')}</span>${tp.endAt ? html`<span class="c-topiccard__until">${t('topic.until', { date: ctx.fmtDate(tp.endAt) })}</span>` : ''}</span>
  </a>
</li>`;
}

/* ───── 外部連結標記 ───── */
export function extLink(ctx, href, label, { cls = '' } = {}) {
  return html`<a${cls ? raw(` class="${cls}"`) : ''} href="${href}" rel="noopener">${label}<span aria-hidden="true"> ↗</span><span class="sr-only"> (${ctx.t('external')})</span></a>`;
}

/** 通用：把 markdown 變機讀 .md 的標頭引言列 */
export function mdHeader(ctx, item, extra = '') {
  const owner = unitName(ctx, item.owner);
  const lines = [`> 權責單位：${owner} · 最後審閱：${item.reviewedAt}${item.gov?.nextReviewAt ? ` · 下次審閱：${item.gov.nextReviewAt}` : ''} · 授權：${item.license} · ID：${item.id}${extra ? ` · ${extra}` : ''}`];
  for (const a of item.gov?.annotations ?? []) lines.push(`> ⚠ ${a.text}`);
  return lines;
}

/** 專業頁頂的 scope tag（「專業內容」） */
export function proScope(ctx) {
  return html`<span class="c-scope-tags"><span class="c-scope-tag c-scope-tag--pro">${ctx.t('scope.pro')}</span></span>`;
}

/** Banner 狀態：gov.campaignStatus 優先 */
export function campaignState(site, b) {
  if (b.gov?.campaignStatus) return b.gov.campaignStatus;
  if (b.endAt && b.endAt < site.today) return 'ended';
  if (b.startAt && b.startAt > site.today) return 'upcoming';
  return 'active';
}

/** 頁內問題框（D2 的 inline.js 接手送出：導向 /ask/，專業頁帶 view=pro）。每頁只能有一個 #ask-inline。 */
export function inlineAsk(ctx, { mode = 'public', placeholder = '', label = '', examples = [] } = {}) {
  const { t, url } = ctx;
  return html`<form id="ask-inline" class="c-askbox c-askbox--md c-askinline" data-ask-inline="${mode}" action="${url('/ask/')}" method="get" role="search">
  ${mode === 'pro' ? html`<input type="hidden" name="view" value="pro">` : ''}
  <label class="sr-only" for="ask-inline-q">${label || t('home.h1')}</label>
  <input id="ask-inline-q" name="q" type="search" placeholder="${placeholder}" autocomplete="off" enterkeyhint="search">
  <button type="submit" class="c-askbox__btn">${t('home.ask')}</button>
  ${examples.length ? html`<p class="c-askbox__note">${examples.map((q) => html`<button type="button" class="c-chip" data-ask-inline-q="${q}">${q}</button> `)}</p>` : ''}
</form>`;
}
