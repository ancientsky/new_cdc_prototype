// 常見問答：列表（依疾病／任務分組）與詳頁（FAQPage JSON-LD、結構化欄位、依據正本）。
import { html, raw } from '../../../scripts/lib/render.mjs';
import { md } from '../../../scripts/lib/markdown.mjs';
import { config } from '../../../site.config.mjs';
import { langAvailable } from '../../../scripts/lib/pages.mjs';
import { ldFor, breadcrumb, pageHead, provenance, alerts, pageData, scopeTags, feedback, translationBadge, askBox, hrefFor, isFallbackLink, L, publishedOf, slugOf, diseasePage, diseaseName, itemPath, sectionHead } from './_partials.mjs';

export function meta(ctx, props = {}) {
  if (props.item) { const f = props.item; return { title: L(ctx, f, 'question') ?? f.title, description: L(ctx, f, 'summary'), item: f, jsonLd: ldFor(ctx, f, [{ label: ctx.t('nav.faq'), href: '/faq/' }, { label: L(ctx, f, 'question') ?? f.title }]) }; }
  return { title: ctx.t('nav.faq'), description: ctx.t('faq.desc'), jsonLd: ldFor(ctx, null, [{ label: ctx.t('nav.faq') }]) };
}

function qLink(ctx, f) {
  const fb = isFallbackLink(ctx, f);
  return html`<li><a href="${hrefFor(ctx, f)}"${fb ? raw(' lang="zh-TW"') : ''}>${fb ? (f.question ?? f.title) : (L(ctx, f, 'question') ?? f.title)}</a></li>`;
}

function listPage(ctx) {
  const { site, t } = ctx;
  const faqs = publishedOf(site, 'faq');
  const byDisease = new Map();
  for (const f of faqs) for (const d of (f.diseases?.length ? f.diseases : ['other'])) { if (!byDisease.has(d)) byDisease.set(d, []); byDisease.get(d).push(f); }
  const byTask = config.tasks.map((task) => [task, faqs.filter((f) => f.tasks?.includes(task.key))]).filter(([, l]) => l.length);
  return html`${pageHead(ctx, { trail: [{ label: t('nav.faq') }], h1: t('nav.faq'), lead: t('faq.lead', { n: faqs.length }) })}
${askBox(ctx, { id: 'fq', size: 'md', placeholder: t('faq.ask.ph') })}
<div class="c-tabs" data-tabs>
  <div class="c-tabs__list" role="tablist" aria-label="${t('faq.by')}">
    <button type="button" role="tab" id="tab-fd" aria-controls="panel-fd" aria-selected="true" tabindex="0">${t('faq.by.disease')}</button>
    <button type="button" role="tab" id="tab-ft" aria-controls="panel-ft" aria-selected="false" tabindex="-1">${t('faq.by.task')}</button>
  </div>
  <div class="c-tabs__panel" role="tabpanel" id="panel-fd" aria-labelledby="tab-fd">
    ${[...byDisease.entries()].map(([d, list]) => { const dm = site.diseaseMasterById.get(d); const page = diseasePage(ctx, d); return html`<section class="c-dis-group"><h3>${page ? html`<a href="${hrefFor(ctx, page)}">${diseaseName(ctx, dm)}</a>` : (dm ? diseaseName(ctx, dm) : t('faq.other'))} <span class="muted">(${list.length})</span></h3><ul class="c-linklist c-linklist--q">${list.map((f) => qLink(ctx, f))}</ul></section>`; })}
  </div>
  <div class="c-tabs__panel" role="tabpanel" id="panel-ft" aria-labelledby="tab-ft" data-initial-hidden>
    ${byTask.map(([task, list]) => html`<section class="c-dis-group"><h3><a href="${ctx.url(`/tasks/${task.key}/`)}">${t(`task.${task.key}.label`)}</a> <span class="muted">(${list.length})</span></h3><ul class="c-linklist c-linklist--q">${list.map((f) => qLink(ctx, f))}</ul></section>`)}
  </div>
</div>
${faqs.length ? '' : html`<p class="c-empty">${t('none')}</p>`}`;
}

function resolveRef(site, ref) {
  const it = site.byId.get(ref);
  if (it?.type === 'document') return site.collections.documents.find((d) => d.family === it.family && d.isCurrent) ?? it;
  if (it) return it;
  return site.collections.documents.find((d) => d.family === ref && d.isCurrent) ?? null;
}

function detail(ctx, f) {
  const { site, t, lang } = ctx;
  const q = L(ctx, f, 'question') ?? f.title;
  const a = L(ctx, f, 'answerMarkdown') ?? f.answerMarkdown;
  const based = (f.basedOn ?? []).map((r) => ({ ref: r, item: resolveRef(site, r) }));
  const dis = (f.diseases ?? []).map((d) => diseasePage(ctx, d)).filter(Boolean);
  const st = f.structured ? Object.entries(f.structured) : [];
  const langStatus = f.languages?.[lang]?.status;
  return html`${breadcrumb(ctx, [{ label: t('nav.faq'), href: '/faq/' }, { label: q }])}
<article class="c-article">
  <header class="c-pagehead"><div class="c-pagehead__main">
    <h1>${q}</h1>
    ${scopeTags(ctx, f)}
    ${langStatus && lang !== 'zh-TW' ? html`<p>${translationBadge(ctx, langStatus === 'reviewed' ? 'reviewed' : 'machine')}</p>` : ''}
    ${provenance(ctx, f)}${alerts(ctx, f)}
  </div></header>
  <div class="c-cols c-cols--2">
    <div class="c-cols__main">
      <div class="c-answerbox"><div class="c-prose">${raw(md(a))}</div></div>
      ${st.length ? html`<section class="c-block"><h2>${t('faq.structured')}</h2><dl class="c-deflist">${st.map(([k, v]) => html`<div><dt>${k}</dt><dd>${v}</dd></div>`)}</dl></section>` : ''}
      ${based.length ? html`<section class="c-block"><h2>${t('faq.basedOn')}</h2><ul class="c-linklist">${based.map(({ ref, item }) => html`<li>${item ? html`<a href="${hrefFor(ctx, item)}">${L(ctx, item, 'title')}</a> <span class="muted">${item.version ?? ''} ${item.reviewedAt ? `· ${t('prov.reviewed')} ${ctx.fmtDate(item.reviewedAt)}` : ''}</span>` : html`<code>${ref}</code>`}</li>`)}</ul></section>` : ''}
      ${feedback(ctx, { page: ctx.path })}
    </div>
    <aside class="c-cols__side">
      <section class="c-aside-card"><h2>${t('faq.askmore')}</h2>${askBox(ctx, { id: 'fq2', size: 'sm', disease: f.diseases?.[0] ?? null, placeholder: t('faq.ask.ph') })}</section>
      ${dis.length ? html`<section class="c-aside-card"><h2>${t('news.related')}</h2><ul class="c-linklist">${dis.map((d) => html`<li><a href="${hrefFor(ctx, d)}">${L(ctx, d, 'title')}</a></li>`)}</ul></section>` : ''}
      ${pageData(ctx, f, { schema: 'FAQPage', api: '/v1/faq.json', mdPath: `${itemPath(f).replace(/\/$/, '')}.md` })}
    </aside>
  </div>
</article>`;
}

export function render(ctx, props = {}) { return props.item ? detail(ctx, props.item) : listPage(ctx); }

export function markdown(ctx, { item: f }) {
  const lines = [`# ${L(ctx, f, 'question') ?? f.title}`, '', `> 權責單位：${ctx.site.unitById.get(f.owner)?.name ?? f.owner} · 最後審閱：${f.reviewedAt} · 下次審閱：${f.gov?.nextReviewAt ?? ''} · 授權：${f.license} · ID：${f.id}${f.basedOn?.length ? ` · 依據：${f.basedOn.join('、')}` : ''}`];
  for (const a of f.gov?.annotations ?? []) lines.push(`> ⚠ ${a.text}`);
  lines.push('', L(ctx, f, 'answerMarkdown') ?? f.answerMarkdown ?? '');
  if (f.structured) { lines.push('', '## 結構化欄位'); for (const [k, v] of Object.entries(f.structured)) lines.push(`- ${k}: ${v}`); }
  return lines.join('\n') + '\n';
}

export function pages(site) {
  const out = [{ path: '/faq/', lang: '*', props: {} }];
  for (const L_ of site.config.langs) for (const f of site.collections.faq) if (f.status === 'published' && langAvailable(site, f, L_.code)) out.push({ path: `/faq/${slugOf(f)}/`, lang: L_.code, props: { item: f }, md: true });
  return out;
}
void sectionHead;
