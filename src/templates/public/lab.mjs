// /lab/、/lab/{id}/：檢驗專區（專業內容）。檢驗項目表可依疾病、檢體、檢驗單位篩選；詳頁每個檢體一張卡，附送驗單、病例定義、生物安全等級與檢驗委託申請。
import { html, raw } from '../../../scripts/lib/render.mjs';
import { md } from '../../../scripts/lib/markdown.mjs';
import { langAvailable } from '../../../scripts/lib/pages.mjs';
import {
  ldFor, breadcrumb, pageHead, provenance, alerts, pageData, scopeTags, feedback, translationBadge, hrefFor, L, unitName, publishedOf, slugOf, itemPath,
  diseaseName, diseaseHref, isExternal, extLink, mdHeader, proScope, inlineAsk,
} from './_partials.mjs';

const INLINE = ['/assets/js/answer/inline.js'];
export const LAB_KEYS = ['cdc-lab', 'certified-lab', 'hospital-lab', 'regional-lab'];
const trailOf = (ctx, lt) => [{ label: ctx.t('lab.title'), href: '/lab/' }, { label: L(ctx, lt, 'title') }];

/** 文件參照 → 現行版文件或外部網址 */
export function resolveDoc(site, ref) {
  if (!ref) return null;
  if (isExternal(ref)) return { url: ref };
  const d = site.byId.get(ref);
  if (d?.type === 'document') return { doc: d.isCurrent ? d : (site.collections.documents.find((x) => x.family === d.family && x.isCurrent) ?? d) };
  const fam = site.collections.documents.find((x) => x.family === ref && x.isCurrent);
  return fam ? { doc: fam } : (d ? { doc: d } : null);
}

export function meta(ctx, props = {}) {
  if (props.item) { const l = props.item; return { title: L(ctx, l, 'title'), description: L(ctx, l, 'summary'), item: l, jsonLd: ldFor(ctx, l, trailOf(ctx, l)), scripts: INLINE }; }
  return { title: ctx.t('lab.title'), description: ctx.t('lab.lead'), jsonLd: ldFor(ctx, null, [{ label: ctx.t('lab.title') }]), scripts: INLINE };
}

const dName = (ctx, id) => diseaseName(ctx, ctx.site.diseaseMasterById.get(id)) || id;
const labUnits = (ctx, labs) => (labs ?? []).map((k) => ctx.t(`lab.unit.${k}`)).join('、');

function listPage(ctx) {
  const { site, t } = ctx;
  const items = publishedOf(site, 'labtests').sort((a, b) => dName(ctx, a.disease).localeCompare(dName(ctx, b.disease), 'zh-TW'));
  const rows = items.flatMap((lt) => lt.specimens.map((sp, i) => ({ lt, sp, i })));
  const diseases = [...new Set(items.map((x) => x.disease))];
  const specimens = [...new Set(rows.map((r) => r.sp.name))];
  const labs = LAB_KEYS.filter((k) => items.some((x) => x.labs?.includes(k)));
  const sel = (key, label, opts) => html`<label class="c-labfilter"><span>${label}</span><select class="c-input c-select" data-filter-select="lab-table" data-key="${key}"><option value="">${t('all')}</option>${opts.map(([v, text]) => html`<option value="${v}">${text}</option>`)}</select></label>`;
  return html`${pageHead(ctx, { trail: [{ label: t('lab.title') }], h1: t('lab.title'), lead: t('lab.lead'), tags: proScope(ctx), actions: html`<a class="c-btn c-btn--ghost c-btn--sm" href="${ctx.url('/apply/')}">${t('lab.request')}</a>` })}
${inlineAsk(ctx, { mode: 'pro', placeholder: t('lab.ask.ph'), label: t('lab.ask.t') })}
${rows.length ? html`<form class="c-labfilters" onsubmit="return false" role="search" aria-label="${t('lab.filter')}">
  ${sel('disease', t('lab.col.disease'), diseases.map((d) => [d, dName(ctx, d)]))}
  ${sel('specimen', t('lab.col.specimen'), specimens.map((s) => [s, s]))}
  ${sel('lab', t('lab.col.lab'), labs.map((k) => [k, t(`lab.unit.${k}`)]))}
  <span class="c-labfilters__n muted" role="status" data-filter-count="lab-table"></span>
</form>
<div class="c-labtable-wrap"><table class="c-labtable" id="lab-table">
  <thead><tr><th scope="col">${t('lab.col.disease')}</th><th scope="col">${t('lab.col.specimen')}</th><th scope="col">${t('lab.col.container')}</th><th scope="col">${t('lab.col.storage')}</th><th scope="col">${t('lab.col.within')}</th><th scope="col">${t('lab.col.lab')}</th><th scope="col">${t('lab.col.tat')}</th></tr></thead>
  <tbody>${rows.map(({ lt, sp }) => html`<tr data-disease="${lt.disease}" data-specimen="${sp.name}" data-lab="${(lt.labs ?? []).join(' ')}">
    <th scope="row" data-label="${t('lab.col.disease')}"><a href="${hrefFor(ctx, lt)}">${dName(ctx, lt.disease)}</a></th>
    <td data-label="${t('lab.col.specimen')}"><strong>${sp.name}</strong>${sp.timing ? html`<br><span class="muted">${sp.timing}</span>` : ''}</td>
    <td data-label="${t('lab.col.container')}">${sp.container}${sp.volume ? html`<br><span class="muted">${sp.volume}</span>` : ''}</td>
    <td data-label="${t('lab.col.storage')}">${sp.storage}<br><span class="muted">${sp.transport}</span></td>
    <td data-label="${t('lab.col.within')}">${lt.sendWithinHours ? t('lab.hours', { n: lt.sendWithinHours }) : '—'}</td>
    <td data-label="${t('lab.col.lab')}">${labUnits(ctx, lt.labs)}</td>
    <td data-label="${t('lab.col.tat')}">${sp.turnaroundDays != null ? t('lab.days', { n: sp.turnaroundDays }) : '—'}</td></tr>`)}</tbody></table></div>` : html`<p class="c-empty">${t('none')}</p>`}
<section class="c-block" aria-labelledby="lab-units"><h2 id="lab-units">${t('lab.units.t')}</h2>
  <dl class="c-deflist c-deflist--sm">${LAB_KEYS.map((k) => html`<div><dt>${t(`lab.unit.${k}`)}</dt><dd>${t(`lab.unit.${k}.d`)}</dd></div>`)}</dl>
  <p class="muted">${t('lab.units.note')}</p>
</section>
<section class="c-block" aria-labelledby="lab-link"><h2 id="lab-link">${t('lab.next')}</h2>
  <ul class="c-linklist c-linklist--inline"><li><a href="${ctx.url('/apply/')}">${t('lab.request')}</a></li><li><a href="${ctx.url('/report/')}">${t('report.title')}</a></li><li><a href="${ctx.url('/documents/')}">${t('nav.documents')}</a></li></ul>
</section>`;
}

function detail(ctx, lt) {
  const { site, t, lang } = ctx;
  const dm = site.diseaseMasterById.get(lt.disease);
  const dh = diseaseHref(ctx, lt.disease);
  const cd = resolveDoc(site, lt.caseDefinitionDoc ?? diseaseByDoc(site, lt.disease));
  const form = resolveDoc(site, lt.formDoc);
  const req = (site.collections.services ?? []).find((s) => s.status === 'published' && s.serviceType === 'lab-request');
  const langStatus = lt.languages?.[lang]?.status;
  const notes = L(ctx, lt, 'notesMarkdown') ?? lt.notesMarkdown;
  const docLink = (r) => (r?.doc ? html`<a href="${hrefFor(ctx, r.doc)}">${r.doc.title}</a> <span class="muted">${r.doc.version ?? ''}</span>` : r?.url ? extLink(ctx, r.url, t('lab.form')) : '—');
  return html`${breadcrumb(ctx, trailOf(ctx, lt))}
<article class="c-article c-labtest">
  <header class="c-pagehead"><div class="c-pagehead__main">
    <p class="c-article__meta">${proScope(ctx)} <span>${labUnits(ctx, lt.labs)}</span></p>
    <h1>${L(ctx, lt, 'title')}</h1>
    <p class="lead">${L(ctx, lt, 'summary')}</p>
    ${scopeTags(ctx, lt, { region: false })}
    ${langStatus && lang !== 'zh-TW' ? html`<p>${translationBadge(ctx, langStatus === 'reviewed' ? 'reviewed' : 'machine')}</p>` : ''}
    ${alerts(ctx, lt)}${provenance(ctx, lt)}
  </div><div class="c-pagehead__actions"><a class="c-btn" href="${req ? hrefFor(ctx, req) : ctx.url('/apply/')}">${t('lab.request')} →</a></div></header>
  <div class="c-cols c-cols--2">
    <div class="c-cols__main">
      <section class="c-block" aria-labelledby="sp-h"><h2 id="sp-h">${t('lab.specimens')}</h2>
        <div class="c-labcards">${lt.specimens.map((sp, i) => html`<section class="c-labcard" id="sp-${i + 1}" aria-label="${sp.name}">
          <h3 class="c-labcard__t">${sp.name}${sp.timing ? html` <span class="c-pill c-pill--info">${sp.timing}</span>` : ''}</h3>
          <dl class="c-deflist c-deflist--sm">
            <div><dt>${t('lab.col.container')}</dt><dd>${sp.container}</dd></div>
            <div><dt>${t('lab.volume')}</dt><dd>${sp.volume}</dd></div>
            <div><dt>${t('lab.storage')}</dt><dd>${sp.storage}</dd></div>
            <div><dt>${t('lab.transport')}</dt><dd>${sp.transport}</dd></div>
            ${sp.tests?.length ? html`<div><dt>${t('lab.tests')}</dt><dd>${sp.tests.map((x) => html`<span class="c-pill c-pill--neutral">${x}</span> `)}</dd></div>` : ''}
            ${sp.turnaroundDays != null ? html`<div><dt>${t('lab.col.tat')}</dt><dd>${t('lab.days', { n: sp.turnaroundDays })}</dd></div>` : ''}
            ${sp.note ? html`<div><dt>${t('lab.note')}</dt><dd>${sp.note}</dd></div>` : ''}
          </dl></section>`)}</div>
      </section>
      ${notes ? html`<section class="c-block" id="notes" aria-labelledby="nt-h"><h2 id="nt-h">${t('lab.notes')}</h2><div class="c-prose">${raw(md(notes))}</div></section>` : ''}
      ${feedback(ctx, { page: ctx.path })}
    </div>
    <aside class="c-cols__side">
      <section class="c-aside-card"><h2>${t('lab.facts')}</h2><dl class="c-deflist c-deflist--sm">
        <div><dt>${t('lab.col.disease')}</dt><dd>${dh ? html`<a href="${dh}">${dName(ctx, lt.disease)}</a>` : dName(ctx, lt.disease)}</dd></div>
        ${lt.sendWithinHours ? html`<div><dt>${t('lab.col.within')}</dt><dd>${t('lab.hours', { n: lt.sendWithinHours })}</dd></div>` : ''}
        ${dm?.notifyWithinHours ? html`<div><dt>${t('report.col.within')}</dt><dd><a href="${ctx.url('/report/')}#category-${dm.legalCategory}">${t('lab.hours', { n: dm.notifyWithinHours })}</a></dd></div>` : ''}
        <div><dt>${t('lab.col.lab')}</dt><dd>${labUnits(ctx, lt.labs)}</dd></div>
        ${lt.biosafetyLevel ? html`<div><dt>${t('lab.bsl')}</dt><dd>${lt.biosafetyLevel}</dd></div>` : ''}
        ${form ? html`<div><dt>${t('lab.form')}</dt><dd>${docLink(form)}</dd></div>` : ''}
        ${cd ? html`<div><dt>${t('disease.casedef')}</dt><dd>${docLink(cd)}</dd></div>` : ''}
      </dl></section>
      <section class="c-aside-card"><h2>${t('lab.request')}</h2><p class="muted">${t('lab.request.note')}</p><a class="c-btn c-btn--sm" href="${req ? hrefFor(ctx, req) : ctx.url('/apply/')}">${t('lab.request')} →</a></section>
      ${pageData(ctx, lt, { schema: 'Dataset', api: '/v1/labtests.json', mdPath: `${itemPath(lt).replace(/\/$/, '')}.md` })}
    </aside>
  </div>
</article>`;
}

function diseaseByDoc(site, diseaseId) {
  return site.collections.diseases.find((d) => d.id === diseaseId)?.professional?.caseDefinitionDoc;
}

export function render(ctx, props = {}) { return props.item ? detail(ctx, props.item) : listPage(ctx); }

export function markdown(ctx, { item: lt }) {
  const { site } = ctx;
  const lines = [`# ${L(ctx, lt, 'title')}`, '', ...mdHeader(ctx, lt, `疾病：${lt.disease}${lt.sendWithinHours ? ` · 送驗時限：${lt.sendWithinHours} 小時` : ''}`), '', L(ctx, lt, 'summary') ?? '', '', `檢驗單位：${labUnits(ctx, lt.labs)}`];
  if (lt.biosafetyLevel) lines.push(`生物安全等級：${lt.biosafetyLevel}`);
  lines.push('', '## 檢體', '');
  for (const sp of lt.specimens) {
    lines.push(`### ${sp.name}`, '', `- ${lt.disease.replace('disease.', '')} ${sp.name}${sp.volume ? `：${sp.volume}` : ''}${sp.timing ? `，${sp.timing}` : ''}，${sp.container}，${sp.storage}，${sp.transport}${sp.turnaroundDays != null ? `；${sp.turnaroundDays} 日內出報告` : ''}`);
    if (sp.tests?.length) lines.push(`- 可做檢驗：${sp.tests.join('、')}`);
    if (sp.note) lines.push(`- 注意：${sp.note}`);
    lines.push('');
  }
  if (lt.notesMarkdown) lines.push('## 注意事項', '', L(ctx, lt, 'notesMarkdown') ?? lt.notesMarkdown);
  void site;
  return lines.join('\n') + '\n';
}

export function pages(site) {
  const out = [];
  for (const code of ['zh-TW', 'en']) out.push({ path: '/lab/', lang: code, props: {} });
  for (const L_ of site.config.langs) for (const lt of site.collections.labtests ?? []) if (lt.status === 'published' && langAvailable(site, lt, L_.code)) out.push({ path: `/lab/${slugOf(lt)}/`, lang: L_.code, props: { item: lt }, md: true });
  return out;
}
void unitName; void LAB_KEYS;
