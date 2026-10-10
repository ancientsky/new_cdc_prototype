// 疾病頁：一分鐘重點、八區塊、三欄、三層露出、七語（缺的區塊 fallback 中文並標示）。
import { html, raw } from '../../../scripts/lib/render.mjs';
import { md } from '../../../scripts/lib/markdown.mjs';
import { langAvailable } from '../../../scripts/lib/pages.mjs';
import { barChartSvg } from '../../client/charts.js';
import {
  ldFor, breadcrumb, provenance, alerts, pageData, statusTag, scopeTags, viewToggle, feedback, askBox, translationBadge,
  numberSource, datasetSourceCard, hrefFor, isFallbackLink, L, unitName, publishedOf, byDateDesc, dated, itemPath, seriesOf, sitField, licenseLabel,
  isMediaOutdated, isTopicEnded, fmtDur, refItem, isExternal, legacyOf, extLink,
} from './_partials.mjs';
import { curricula, curriculumList } from './_curriculum.mjs';

const trailOf = (ctx, item) => [{ label: ctx.t('nav.diseases'), href: '/diseases/' }, { label: L(ctx, item, 'title') }];

export function meta(ctx, { item }) {
  return { title: L(ctx, item, 'title'), description: L(ctx, item, 'summary'), item, jsonLd: ldFor(ctx, item, trailOf(ctx, item)), noindex: false };
}

/** 區塊合併：中文為底，翻譯有的覆蓋；沒有翻譯的標 fallback */
export function mergedBlocks(ctx, item) {
  if (ctx.lang === 'zh-TW') return item.blocks.map((b) => ({ ...b, fallback: false }));
  const tr = item.i18n?.[ctx.lang];
  return item.blocks.map((b) => {
    const tb = tr?.blocks?.find((x) => x.key === b.key);
    const hasContent = !!(b.markdown || b.cards?.length || b.warning);
    if (!tb) return { ...b, fallback: hasContent };
    return { ...b, heading: tb.heading ?? b.heading, markdown: tb.markdown ?? (tb.cards ? '' : b.markdown), cards: tb.cards ?? b.cards, warning: tb.warning ?? b.warning, fallback: false };
  });
}
export function keyFactsOf(ctx, item) {
  return ctx.lang === 'zh-TW' ? item.keyFacts : { ...item.keyFacts, ...(item.i18n?.[ctx.lang]?.keyFacts ?? {}) };
}
const KF_ORDER = ['incubation', 'symptoms', 'transmission', 'prevention', 'notify'];

/** 以 family 或 id 解析現行版文件 */
export function currentDoc(site, ref) {
  const direct = site.byId.get(ref);
  if (direct?.type === 'document') return direct.isCurrent ? direct : (site.collections.documents.find((d) => d.family === direct.family && d.isCurrent) ?? null);
  return site.collections.documents.find((d) => d.family === ref && d.isCurrent) ?? null;
}
function docsFor(site, item) {
  const out = new Map();
  const refs = [...(item.relatedDocuments ?? []), item.professional?.caseDefinitionDoc, item.professional?.manualDoc].filter(Boolean);
  for (const r of refs) { const d = currentDoc(site, r); if (d) out.set(d.family, d); }
  for (const d of site.collections.documents) if (d.isCurrent && d.status === 'published' && d.diseases?.includes(item.id)) out.set(d.family, d);
  // 第二十八輪：核心教材另列「核心教材」區塊（pro-curriculum），不混在指引與手冊裡
  return [...out.values()].filter((d) => d.docType !== 'curriculum');
}
const stripLead = (title, text) => {
  if (title && text?.startsWith(title)) { const r = text.slice(title.length).replace(/^[，、,。;；:：\s]+/, ''); return r || text; }
  return text;
};

function renderBlock(ctx, item, b, ctxData) {
  const { t, url, site } = ctx;
  const { sit, faqs, series } = ctxData;
  const body = [];
  if (b.cards?.length) {
    body.push(html`<div class="c-ifcards">${b.cards.map((c) => html`<div class="c-ifcard"><span class="c-ifcard__if">${t('disease.ifyou')}</span><strong class="c-ifcard__cond">${c.if}</strong><p class="c-ifcard__title">${c.title}</p><p class="c-ifcard__text">${stripLead(c.title, c.text)}</p></div>`)}</div>`);
  }
  if (b.markdown) body.push(raw(md(b.markdown)));
  if (b.warning) body.push(html`<div class="c-warning" role="note"><strong>${t('disease.warning.t')}</strong> ${b.warning}</div>`);
  if (b.key === 'situation') {
    const wk = sit?.weekly;
    const labels = sit?.weeklyLabels;
    const ds = (b.datasets ?? []).map((id) => site.byId.get(id)).filter(Boolean);
    const yr = seriesOf(ds[0]);
    if (wk?.length) {
      body.push(html`<figure class="c-chartbox"><figcaption>${t('disease.chart.title', { n: wk.length, label: sitField(ctx, sit, 'metricLabel') })}${sit.illustrative ? html` <span class="c-pill c-pill--neutral">${t('illustrative')}</span>` : ''}</figcaption>${raw(barChartSvg(wk, { labels, color: `var(--status-${sit.status})`, title: sitField(ctx, sit, 'metricLabel'), unit: '' }))}<p class="c-chartbox__src">${numberSource(ctx, { source: site.situation.source, dataDate: site.situation.dataDate, illustrative: sit.illustrative })} · ${t('disease.chart.daily')}</p></figure>`);
    } else if (yr) {
      body.push(html`<figure class="c-chartbox"><figcaption>${yr.label} (${yr.unit})</figcaption>${raw(barChartSvg(yr.points.map((p) => p.v), { labels: yr.points.map((p) => p.t), title: yr.label, unit: yr.unit }))}<p class="c-chartbox__src">${yr.note ?? ''}</p></figure>`);
    }
    body.push(html`<p class="c-linkrow"><a href="${url('/situation/')}">${t('disease.trend')} →</a>${ds[0] ? html` · <a href="${url('/data/')}#${ds[0].id}">${t('disease.dataset')}：${L(ctx, ds[0], 'title')}</a>` : ''}</p>`);
    for (const d of ds) body.push(datasetSourceCard(ctx, d));
    void series;
  }
  if (b.key === 'faq') {
    body.push(faqs.length ? html`<ul class="c-linklist">${faqs.map((f) => html`<li><a href="${hrefFor(ctx, f)}"${isFallbackLink(ctx, f) ? raw(' lang="zh-TW"') : ''}>${L(ctx, f, 'question') ?? f.title}</a></li>`)}</ul>` : html`<p class="muted">${t('disease.faq.none')}</p>`);
    body.push(html`<p class="c-linkrow"><a href="${url('/faq/')}">${t('faq.all')} →</a></p>`);
  }
  return html`<section class="c-block" id="${b.key}" aria-labelledby="h-${b.key}">
  <h2 id="h-${b.key}">${b.heading}${b.fallback ? html` ${translationBadge(ctx, 'none', { text: t('translation.block') })}` : ''}</h2>
  ${body}
</section>`;
}


/* ═════════════ 第五輪（V2）：專區導覽（sticky 子導覽，民眾／專業兩套）與專業版區塊 ═════════════ */
const PUB_ORDER = ['what-to-do', 'symptoms', 'transmission', 'prevention', 'treatment', 'vaccine', 'situation', 'faq'];

/** 文件版本鏈：每個 family 只取現行版，並找出同 family 的舊版 */
function docChain(site, d) {
  const olds = site.collections.documents
    .filter((x) => x.family && x.family === d.family && x.id !== d.id && x.status !== 'draft')
    .sort((a, b) => String(b.effectiveAt).localeCompare(String(a.effectiveAt)));
  return { doc: d, olds };
}

/** 防治計畫（容錯：V1 的 professional.programs 形狀以 { key, title, summaryMarkdown?, documents?, services?, links? } 為準） */
function programsOf(item) {
  const raw_ = item.professional?.programs;
  return (Array.isArray(raw_) ? raw_ : []).filter((p) => p && (p.title || p.key)).map((p, i) => ({ ...p, key: String(p.key ?? `p${i + 1}`).replace(/[^\w-]/g, '-') }));
}

function relatedOf(ctx, item, { sit, blocks, programs }) {
  const { site } = ctx;
  const id = item.id;
  const svcIds = new Set(programs.flatMap((p) => p.services ?? []));
  for (const tp of site.collections.topics ?? []) if (tp.status === 'published' && (tp.diseases?.includes(id) || tp.contentIds?.includes(id))) for (const c of tp.contentIds ?? []) if (site.byId.get(c)?.type === 'service') svcIds.add(c);
  const services = (site.collections.services ?? []).filter((x) => x.status === 'published' && (x.diseases?.includes(id) || svcIds.has(x.id)));
  const dsIds = new Set(blocks.flatMap((b) => b.datasets ?? []));
  const datasets = (site.collections.datasets ?? []).filter((x) => x.status === 'published' && (x.diseases?.includes(id) || dsIds.has(x.id)));
  const research = (site.collections.research ?? []).filter((x) => x.status === 'published' && x.diseases?.includes(id)).sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
  return { services, datasets, research, hasStats: !!sit || datasets.length > 0 };
}

/** 第六輪：沒有任何內容的區塊（只有標題、或沒有對應資料的 Q&A／統計）不輸出，導覽與內文一致 */
export const blockHasBody = (b, { sit = null, faqs = [] } = {}) => {
  if (b.key === 'faq') return faqs.length > 0;
  if (b.key === 'situation') return !!(sit || b.datasets?.length || b.markdown);
  return !!(b.markdown || b.cards?.length || b.warning);
};

const hubItem = (id, label) => html`<li><a href="${'#' + id}" data-hub="${id}">${label}</a></li>`;

function hubNav(ctx, { pub, pro }) {
  const { t } = ctx;
  if (!pub.length && !pro.length) return '';
  return html`<nav class="c-hubnav" aria-label="${t('hub.nav')}" data-hubnav>
  <div class="c-hubnav__in">
    ${pub.length ? html`<ul class="c-hubnav__list c-public-only">${pub.map((x) => hubItem(x.id, x.label))}</ul>` : ''}
    ${pro.length ? html`<ul class="c-hubnav__list c-pro-only">${pro.map((x) => hubItem(x.id, x.label))}</ul>` : ''}
    ${pro.length ? html`<a class="c-hubnav__sw c-public-only" href="?view=pro" data-view-set="pro">${t('view.pro')} →</a>` : ''}
  </div>
</nav>
${pro.length ? html`<p class="c-hubnav__also muted c-public-only"><b>${t('hub.pro.also')}</b>${pro.map((x) => x.label).join(' · ')}</p>` : ''}`;
}

const HUB_JS = `(function(){var nav=document.querySelector('[data-hubnav]');if(!nav||!('IntersectionObserver' in window))return;
var links=[].slice.call(nav.querySelectorAll('a[data-hub]'));var by={};links.forEach(function(a){(by[a.dataset.hub]=by[a.dataset.hub]||[]).push(a);});
var io=new IntersectionObserver(function(es){es.forEach(function(e){if(!e.isIntersecting)return;links.forEach(function(a){a.removeAttribute('aria-current');a.classList.remove('is-active');});(by[e.target.id]||[]).forEach(function(a){a.setAttribute('aria-current','location');a.classList.add('is-active');});});},{rootMargin:'-12% 0px -70% 0px'});
Object.keys(by).forEach(function(id){var el=document.getElementById(id);if(el)io.observe(el);});})();`;

function proSection(ctx, id, titleKey, leadKey, body, { badge = false } = {}) {
  const { t } = ctx;
  return html`<section class="c-block c-hubsec" id="${id}" aria-labelledby="h-${id}"><h2 id="h-${id}">${t(titleKey)}${badge ? html` ${translationBadge(ctx, 'none', { text: t('scope.pro') })}` : ''}</h2>${leadKey ? html`<p class="muted c-hubsec__lead">${t(leadKey)}</p>` : ''}${body}</section>`;
}

function programCard(ctx, p) {
  const { t, site, url } = ctx;
  const docs = (p.documents ?? []).map((r) => currentDoc(site, r) ?? refItem(site, r)).filter(Boolean);
  const svcs = (p.services ?? []).map((r) => site.byId.get(r)).filter(Boolean);
  const links = (p.links ?? []).filter((l) => l && (l.href ?? l.url)).map((l) => ({ label: l.label ?? l.title ?? l.href ?? l.url, href: l.href ?? l.url }));
  const summary = p.summaryMarkdown ?? p.summary ?? p.description ?? '';
  return html`<article class="c-program" id="program-${p.key}">
  <h3>${p.title ?? p.key}</h3>
  ${summary ? raw(md(summary)) : ''}
  ${docs.length ? html`<p class="c-program__k">${t('hub.pro.programs.docs')}</p><ul class="c-linklist">${docs.map((d) => html`<li><a href="${hrefFor(ctx, d)}">${L(ctx, d, 'title')}</a>${d.version ? html` <span class="muted">${d.version}</span>` : ''}</li>`)}</ul>` : ''}
  ${svcs.length ? html`<p class="c-program__k">${t('hub.pro.programs.services')}</p><ul class="c-linklist">${svcs.map((x) => html`<li><a href="${hrefFor(ctx, x)}">${L(ctx, x, 'title')}</a></li>`)}</ul>` : ''}
  ${links.length ? html`<p class="c-program__k">${t('hub.pro.programs.links')}</p><ul class="c-linklist">${links.map((l) => html`<li>${isExternal(l.href) ? extLink(ctx, l.href, l.label) : html`<a href="${url(l.href)}">${l.label}</a>`}</li>`)}</ul>` : ''}
</article>`;
}

export function render(ctx, { item }) {
  const { site, t, url, fmtDate, lang } = ctx;
  const sit = site.situation.items.find((i) => i.disease === item.id);
  const blocks = mergedBlocks(ctx, item);
  const kf = keyFactsOf(ctx, item);
  const faqs = publishedOf(site, 'faq').filter((f) => f.diseases?.includes(item.id));
  const news = [...site.collections.news].filter((n) => n.status === 'published' && n.diseases?.includes(item.id)).sort(byDateDesc).slice(0, 3);
  const docs = docsFor(site, item);
  const pro = item.professional ?? {};
  const title = L(ctx, item, 'title');
  const catLabel = t('disease.cat', { n: item.legalCategory });
  const langStatus = item.languages?.[lang]?.status;
  const labtests = publishedOf(site, 'labtests').filter((l) => l.disease === item.id);
  const media = publishedOf(site, 'media').filter((m) => m.diseases?.includes(item.id))
    .sort((a, b) => Number(isMediaOutdated(site, a)) - Number(isMediaOutdated(site, b)) || String(b.producedAt ?? b.publishedAt).localeCompare(String(a.producedAt ?? a.publishedAt))).slice(0, 3);
  const topics = publishedOf(site, 'topics').filter((tp) => (tp.diseases?.includes(item.id) || tp.contentIds?.includes(item.id)) && !isTopicEnded(site, tp)).slice(0, 3);
  const hasReport = !!(pro.specimen || pro.notifyNote || pro.caseDefinitionDoc || pro.manualDoc || labtests.length || item.notifyWithinHours);
  const programs = programsOf(item);
  const rel = relatedOf(ctx, item, { sit, blocks, programs });
  const chains = docs.map((d) => docChain(site, d));
  const currs = curricula(site, { disease: item.id });
  const hubPub = PUB_ORDER.map((k) => blocks.find((b) => b.key === k)).filter(Boolean).filter((b) => {
    if (b.key === 'faq') return faqs.length > 0;
    if (b.key === 'situation') return !!(sit || b.datasets?.length || b.markdown);
    return !!(b.markdown || b.cards?.length || b.warning);
  }).map((b) => ({ id: b.key, label: t(`hub.pub.${b.key}`) }));
  const hubPro = [
    chains.length && { id: 'pro-docs', label: t('hub.pro.docs') },
    currs.length && { id: 'pro-curriculum', label: t('hub.pro.curriculum') },
    hasReport && { id: 'pro-report', label: t('hub.pro.report') },
    programs.length && { id: 'pro-programs', label: t('hub.pro.programs') },
    rel.services.length && { id: 'pro-services', label: t('hub.pro.services') },
    rel.hasStats && { id: 'pro-stats', label: t('hub.pro.stats') },
    rel.research.length && { id: 'pro-research', label: t('hub.pro.research') },
  ].filter(Boolean);
  const hasPro = hubPro.length > 0;
  const vaccines = site.collections.vaccines.filter((v) => v.status === 'published' && v.diseases?.includes(item.id));
  return html`
${breadcrumb(ctx, trailOf(ctx, item))}
<article class="c-disease" data-item="${item.id}">
  <header class="c-disease__head">
    <div class="c-disease__headmain">
      <div class="c-disease__topline">
        ${sit ? html`<p class="c-statusline">${statusTag(ctx, sit)}<span class="c-statusline__t">${t('disease.now')}：<b>${t(`status.${sit.status}`)}</b></span> <span class="c-statusline__m">${sitField(ctx, sit, 'metricValue')}</span> <span class="muted">${t('dataDate')} ${fmtDate(site.situation.dataDate)}</span> <a href="${url('/situation/')}">${t('disease.trend')} →</a></p>` : ''}
        ${viewToggle(ctx)}
      </div>
      <h1>${title}${lang !== 'en' ? html` <small class="c-disease__en" lang="en">${item.nameEn}</small>` : ''} <span class="c-scope-tag c-scope-tag--cat">${catLabel}</span></h1>
      <p class="lead">${L(ctx, item, 'summary')}</p>
      ${scopeTags(ctx, item)}
      ${langStatus && lang !== 'zh-TW' ? html`<p>${translationBadge(ctx, langStatus === 'reviewed' ? 'reviewed' : 'machine')}</p>` : ''}
      ${provenance(ctx, item)}
      ${alerts(ctx, item)}
    </div>
    <aside class="c-onemin" aria-labelledby="onemin-h">
      <h2 id="onemin-h">${t('disease.onemin')}</h2>
      <dl>${KF_ORDER.filter((k) => kf?.[k]).map((k) => html`<div><dt>${t(`kf.${k}`)}</dt><dd>${kf[k]}</dd></div>`)}</dl>
      <p class="c-onemin__src">${t('disease.onemin.src', { id: item.id })}</p>
    </aside>
  </header>

  <section class="c-askband" aria-label="${t('disease.ask', { name: title })}">
    <div class="c-askband__t">${t('disease.ask', { name: title })}</div>
    ${askBox(ctx, { id: 'dq', size: 'md', disease: item.id, placeholder: t('disease.ask.ph', { name: title }), btn: t('home.ask'), label: t('disease.ask', { name: title }) })}
    <p class="c-askband__note">${t('disease.ask.note')}</p>
  </section>

  ${hubNav(ctx, { pub: hubPub, pro: hubPro })}

  <div class="c-cols c-cols--2">
    <div class="c-cols__main">
      ${blocks.filter((b) => blockHasBody(b, { sit, faqs })).map((b) => renderBlock(ctx, item, b, { sit, faqs }))}
      ${hasPro ? html`<div class="c-hubpro c-pro-only" id="professional">
        ${chains.length ? proSection(ctx, 'pro-docs', 'hub.pro.docs', 'hub.pro.docs.lead', html`<ul class="c-hubdocs">${chains.map(({ doc: d, olds }) => html`<li class="c-hubdoc">
          <p class="c-hubdoc__t"><a href="${hrefFor(ctx, d)}"${isFallbackLink(ctx, d) ? raw(' lang="zh-TW"') : ''}>${L(ctx, d, 'title')}</a> <span class="c-pill c-pill--ok">${t('prov.current')}</span></p>
          <p class="muted">${d.version ? `${d.version} · ` : ''}${t('prov.effective')} ${fmtDate(d.effectiveAt)}${d.summary ? html` · ${L(ctx, d, 'summary')}` : ''}</p>
          ${olds.length ? html`<details class="c-hubdoc__old" data-group="ondemand"><summary>${t('hub.pro.docs.old', { n: olds.length })}</summary><ul class="c-linklist">${olds.map((o) => html`<li><a href="${hrefFor(ctx, o)}"${isFallbackLink(ctx, o) ? raw(' lang="zh-TW"') : ''}>${L(ctx, o, 'title')}</a> <span class="muted">${o.version ?? ''} · ${t('prov.effective')} ${fmtDate(o.effectiveAt)}</span> <span class="c-pill c-pill--neutral">${t('prov.superseded')}</span></li>`)}</ul></details>` : ''}
        </li>`)}</ul>`) : ''}
        ${currs.length ? proSection(ctx, 'pro-curriculum', 'hub.pro.curriculum', 'hub.pro.curriculum.lead', html`${curriculumList(ctx, currs)}<p class="c-linkrow"><a href="${url('/pro/curriculum/', { noLang: !['zh-TW', 'en'].includes(lang) })}">${t('hub.pro.curriculum')} →</a></p>`) : ''}
        ${hasReport ? proSection(ctx, 'pro-report', 'hub.pro.report', 'hub.pro.report.lead', html`<dl class="c-deflist">
          <div><dt>${t('kf.notify')}</dt><dd>${pro.notifyNote ?? (item.notifyWithinHours ? t('disease.notify.h', { h: item.notifyWithinHours }) : '')}${item.legalCategory ? html` · <a href="${url('/report/')}#category-${item.legalCategory}">${t('disease.pro.notifytable')} →</a>` : ''}</dd></div>
          ${labtests.length ? html`<div><dt>${t('disease.pro.lab')}</dt><dd>${labtests.map((l) => html`<a href="${hrefFor(ctx, l)}">${L(ctx, l, 'title')}</a> `)}<a href="${url('/lab/')}">${t('lab.title')} →</a></dd></div>` : ''}
          ${pro.specimen ? html`<div><dt>${t('disease.specimen')}</dt><dd>${pro.specimen}</dd></div>` : ''}
          ${pro.caseDefinitionDoc ? html`<div><dt>${t('disease.casedef')}</dt><dd>${docLink(ctx, pro.caseDefinitionDoc)}</dd></div>` : ''}
          ${pro.manualDoc ? html`<div><dt>${t('disease.manual')}</dt><dd>${docLink(ctx, pro.manualDoc)}</dd></div>` : ''}
          ${item.incubation?.text ? html`<div><dt>${t('kf.incubation')}</dt><dd>${item.incubation.text}</dd></div>` : ''}
          ${item.icd10?.length ? html`<div><dt>ICD-10</dt><dd>${item.icd10.join('、')}</dd></div>` : ''}
        </dl>`, { badge: true }) : ''}
        ${programs.length ? proSection(ctx, 'pro-programs', 'hub.pro.programs', 'hub.pro.programs.lead', html`<div class="c-programs">${programs.map((pg) => programCard(ctx, pg))}</div>`) : ''}
        ${rel.services.length ? proSection(ctx, 'pro-services', 'hub.pro.services', 'hub.pro.services.lead', html`<ul class="c-linklist c-hubsvc">${rel.services.map((x) => html`<li><a href="${hrefFor(ctx, x)}"${isFallbackLink(ctx, x) ? raw(' lang="zh-TW"') : ''}>${L(ctx, x, 'title')}</a>${x.summary ? html`<br><span class="muted">${L(ctx, x, 'summary')}</span>` : ''}</li>`)}</ul>`) : ''}
        ${rel.hasStats ? proSection(ctx, 'pro-stats', 'hub.pro.stats', 'hub.pro.stats.lead', html`<ul class="c-linklist">
          ${sit ? html`<li><a href="${url('/situation/')}">${t('hub.pro.stats.situation')}</a> <span class="muted">${sitField(ctx, sit, 'metricValue')} · ${t('dataDate')} ${fmtDate(site.situation.dataDate)}</span></li>` : ''}
          ${rel.datasets.map((ds) => html`<li><a href="${url('/data/')}#${ds.id}">${L(ctx, ds, 'title')}</a>${ds.lastUpdated ? html` <span class="muted">${t('hub.pro.stats.updated', { date: fmtDate(ds.lastUpdated) })}</span>` : ''}</li>`)}</ul>`) : ''}
        ${rel.research.length ? proSection(ctx, 'pro-research', 'hub.pro.research', 'hub.pro.research.lead', html`<ul class="c-linklist">${rel.research.map((r) => html`<li><a href="${hrefFor(ctx, r)}"${isFallbackLink(ctx, r) ? raw(' lang="zh-TW"') : ''}>${L(ctx, r, 'title')}</a> <span class="muted">${r.year ? `${t('hub.pro.research.year', { year: r.year })} · ` : ''}${unitName(ctx, r.owner)}</span></li>`)}</ul>`) : ''}
      </div>` : ''}
      ${feedback(ctx, { page: ctx.path })}
    </div>

    <aside class="c-cols__side" aria-label="${t('disease.related')}">
      <section class="c-aside-card"><h2>${t('disease.news')}</h2>
        ${news.length ? html`<ul class="c-newslist c-newslist--tight">${news.map((n) => dated(ctx, n, { type: false }))}</ul>` : html`<p class="muted">${t('none')}</p>`}
        <a href="${url('/news/')}">${t('home.news.all')} →</a></section>
      <section class="c-aside-card"><h2>${t('disease.docs')}</h2>
        ${docs.length ? html`<ul class="c-doclist">${docs.map((d) => html`<li class="${d.audience.includes('public') ? '' : 'c-pro-only'}"><a href="${hrefFor(ctx, d)}"${isFallbackLink(ctx, d) ? raw(' lang="zh-TW"') : ''}>${L(ctx, d, 'title')}</a><br><span class="muted">${d.version} · ${t('prov.effective')} ${fmtDate(d.effectiveAt)} · <span class="c-pill c-pill--ok">${t('prov.current')}</span></span></li>`)}</ul>` : html`<p class="muted">${t('none')}</p>`}
        <p class="muted">${t('disease.docs.note')}</p></section>
      ${vaccines.length ? html`<section class="c-aside-card"><h2>${t('nav.vaccines')}</h2><ul class="c-linklist">${vaccines.map((v) => html`<li><a href="${hrefFor(ctx, v)}">${L(ctx, v, 'title')}</a></li>`)}</ul></section>` : ''}
      <section class="c-aside-card"><h2>${t('disease.materials')}</h2>
        ${item.materials?.length ? html`<ul class="c-linklist">${item.materials.map((m) => html`<li><a href="${m.url}" rel="noopener">${m.label} ↗</a></li>`)}</ul>` : (media.length || topics.length ? '' : html`<p class="muted">${t('none')}</p>`)}
        ${media.length ? html`<ul class="c-linklist c-matmedia" aria-label="${t('home.media')}">${media.map((m) => html`<li><a href="${hrefFor(ctx, m)}"${isFallbackLink(ctx, m) ? raw(' lang="zh-TW"') : ''}>${L(ctx, m, 'title')}</a> <span class="muted">${m.durationSeconds ? fmtDur(m.durationSeconds) : ''}</span>${isMediaOutdated(site, m) ? html` <span class="c-pill c-pill--warn">${t('media.outdated.tag')}</span>` : ''}${m.basedOnVersionLabel ? html`<br><span class="muted">${t('media.basedOn.short', { v: m.basedOnVersionLabel })}</span>` : ''}</li>`)}</ul>
        <a href="${url('/media/')}">${t('home.media.all')} →</a>` : ''}
        ${topics.length ? html`<p class="c-matmedia__h"><b>${t('home.topics')}</b></p><ul class="c-linklist">${topics.map((tp) => html`<li><a href="${hrefFor(ctx, tp)}"${isFallbackLink(ctx, tp) ? raw(' lang="zh-TW"') : ''}>${L(ctx, tp, 'title')}</a></li>`)}</ul>` : ''}</section>
      ${pageData(ctx, item, { schema: 'MedicalCondition', api: `/v1/diseases/${item.slug}.json`, mdPath: `/diseases/${item.slug}.md` })}
    </aside>
  </div>
</article>
<script>${raw(HUB_JS)}</script>`;
}

function docLink(ctx, ref) {
  const d = currentDoc(ctx.site, ref);
  return d ? html`<a href="${hrefFor(ctx, d)}">${d.title}</a> <span class="muted">${d.version}</span>` : html`<span class="muted">${ref}</span>`;
}

export function markdown(ctx, { item }) {
  const { site, lang } = ctx;
  const owner = unitName(ctx, item.owner);
  const kf = keyFactsOf(ctx, item);
  const blocks = mergedBlocks(ctx, item);
  const lines = [`# ${L(ctx, item, 'title')}（${item.nameEn}）`, '',
    `> 權責單位：${owner} · 最後審閱：${item.reviewedAt} · 下次審閱：${item.gov.nextReviewAt} · 授權：${item.license} · ID：${item.id} · 語言：${lang} · 正本：${ctx.url(itemPath(item), { absolute: true, noLang: true })}`];
  for (const a of item.gov.annotations) lines.push(`> ⚠ ${a.text}`);
  const lg = legacyOf(item);
  if (lg) lines.push(`> 取代舊網站 ${lg.items.length} 個頁面：${lg.items.map((x) => x.oldTitle ?? x.oldUrl).slice(0, 8).join('、')}${lg.items.length > 8 ? '…' : ''}（對照：/v1/legacy-map.json）`);
  if (lang !== 'zh-TW') lines.push(`> 翻譯狀態：${item.languages?.[lang]?.status ?? 'none'}`);
  lines.push('', L(ctx, item, 'summary'), '', '## 一分鐘重點', ...Object.entries(kf).map(([k, v]) => `- ${k}: ${v}`));
  for (const b of blocks) {
    lines.push('', `## ${b.heading}`, '');
    if (b.fallback) lines.push('> 此區塊尚無譯文，顯示中文。', '');
    if (b.cards) for (const c of b.cards) lines.push(`- 如果你${c.if}：${c.text}`);
    if (b.markdown) lines.push(b.markdown);
    if (b.warning) lines.push('', `**警示徵象：**${b.warning}`);
  }
  void site; void licenseLabel;
  return lines.join('\n') + '\n';
}

export function pages(site) {
  const out = [];
  for (const L_ of site.config.langs) for (const d of site.collections.diseases) if (d.status === 'published' && langAvailable(site, d, L_.code)) out.push({ path: `/diseases/${d.slug}/`, lang: L_.code, props: { item: d }, md: true });
  return out;
}
