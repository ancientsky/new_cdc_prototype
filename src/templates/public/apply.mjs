// /apply/、/apply/{slug}/：申請專區。列表依對象分組；詳頁為步驟式 checklist（編號、誰、幾天）、應備文件可勾選（存本機）、處理天數、費用、法源、表單。
import { html, raw } from '../../../scripts/lib/render.mjs';
import { md } from '../../../scripts/lib/markdown.mjs';
import { langAvailable } from '../../../scripts/lib/pages.mjs';
import {
  ldFor, breadcrumb, pageHead, provenance, alerts, pageData, scopeTags, feedback, translationBadge, hrefFor, isFallbackLink, L, unitName, publishedOf,
  itemPath, isExternal, extLink, mdHeader, pill, inlineAsk,
} from './_partials.mjs';

const INLINE = ['/assets/js/answer/inline.js'];
export const AUDIENCES = [
  { key: 'public', re: /民眾|public|individual|個人|旅客|citizen|traveler/i },
  { key: 'medical', re: /醫療|院所|醫院|診所|醫師|hospital|clinic|medical|provider/i },
  { key: 'researcher', re: /研究|學術|大學|research|academ/i },
  { key: 'local', re: /衛生局|衛生所|地方|local|health (unit|bureau)|municipal/i },
];
export function audiencesOf(sv) {
  const found = new Set();
  for (const w of sv.whoCanApply ?? []) for (const a of AUDIENCES) if (a.re.test(String(w))) found.add(a.key);
  return found.size ? [...found] : ['other'];
}

const trailOf = (ctx, sv) => [{ label: ctx.t('apply.title'), href: '/apply/' }, { label: L(ctx, sv, 'title') }];

export function meta(ctx, props = {}) {
  if (props.item) { const s = props.item; return { title: L(ctx, s, 'title'), description: L(ctx, s, 'summary'), item: s, jsonLd: ldFor(ctx, s, trailOf(ctx, s)), scripts: INLINE }; }
  return { title: ctx.t('apply.title'), description: ctx.t('apply.lead'), jsonLd: ldFor(ctx, null, [{ label: ctx.t('apply.title') }]), scripts: INLINE };
}

function listPage(ctx) {
  const { site, t } = ctx;
  const items = publishedOf(site, 'services');
  const order = [...AUDIENCES.map((a) => a.key), 'other'];
  const groups = order.map((k) => ({ k, list: items.filter((s) => audiencesOf(s).includes(k)) })).filter((g) => g.list.length);
  return html`${pageHead(ctx, { trail: [{ label: t('apply.title') }], h1: t('apply.title'), lead: t('apply.lead') })}
${inlineAsk(ctx, { mode: 'public', placeholder: t('apply.ask.ph'), label: t('apply.ask.t') })}
${groups.length ? html`<nav class="c-chips-wrap" aria-label="${t('apply.groups')}"><ul class="c-chips c-chips--wrap">${groups.map((g) => html`<li><a class="c-chip" href="#aud-${g.k}">${t(`apply.aud.${g.k}`)} (${g.list.length})</a></li>`)}</ul></nav>` : ''}
${groups.map((g) => html`<section class="c-block" id="aud-${g.k}" aria-labelledby="h-aud-${g.k}"><h2 id="h-aud-${g.k}">${t(`apply.aud.${g.k}`)}</h2>
  <ul class="c-svclist">${g.list.map((s) => html`<li class="c-svc">
    <h3 class="c-svc__t"><a href="${hrefFor(ctx, s)}"${isFallbackLink(ctx, s) ? raw(' lang="zh-TW"') : ''}>${L(ctx, s, 'title')}</a></h3>
    <p class="c-svc__s">${L(ctx, s, 'summary')}</p>
    <p class="c-svc__m">${pill(t(`apply.type.${s.serviceType}`), 'info')}${s.slaDays != null ? html` <span class="c-pill c-pill--neutral">${t('apply.sla', { n: s.slaDays })}</span>` : ''}${s.fee ? html` <span class="c-pill c-pill--neutral">${t('apply.fee')}：${s.fee}</span>` : ''}</p>
  </li>`)}</ul></section>`)}
${items.length ? '' : html`<p class="c-empty">${t('none')}</p>`}
<p class="muted">${t('apply.note')}</p>`;
}

function detail(ctx, sv) {
  const { t, lang, url } = ctx;
  const steps = sv.steps ?? [];
  const docs = sv.requiredDocuments ?? [];
  const totalDays = steps.reduce((n, s) => n + (Number(s.days) || 0), 0);
  const langStatus = sv.languages?.[lang]?.status;
  const body = L(ctx, sv, 'introMarkdown') ?? sv.introMarkdown ?? '';
  const related = { 'lab-request': ['/lab/', 'apply.rel.lab'], 'data-request': ['/data/', 'apply.rel.data'] }[sv.serviceType];
  return html`${breadcrumb(ctx, trailOf(ctx, sv))}
<article class="c-article c-service" data-service="${sv.id}">
  <header class="c-pagehead"><div class="c-pagehead__main">
    <p class="c-article__meta">${pill(t(`apply.type.${sv.serviceType}`), 'info')} <span>${t('apply.who')}：${(sv.whoCanApply ?? []).join('、')}</span></p>
    <h1>${L(ctx, sv, 'title')}</h1>
    <p class="lead">${L(ctx, sv, 'summary')}</p>
    ${scopeTags(ctx, sv, { region: false })}
    ${langStatus && lang !== 'zh-TW' ? html`<p>${translationBadge(ctx, langStatus === 'reviewed' ? 'reviewed' : 'machine')}</p>` : ''}
    ${alerts(ctx, sv)}${provenance(ctx, sv)}
  </div>${sv.applyUrl ? html`<div class="c-pagehead__actions">${isExternal(sv.applyUrl) ? html`<a class="c-btn" href="${sv.applyUrl}" rel="noopener">${t('apply.go')} ↗</a>` : html`<a class="c-btn" href="${url(sv.applyUrl)}">${t('apply.go')} →</a>`}</div>` : ''}</header>
  <div class="c-cols c-cols--2">
    <div class="c-cols__main">
      ${body ? html`<div class="c-prose">${raw(md(body))}</div>` : ''}
      <section class="c-block" id="steps" aria-labelledby="st-h"><h2 id="st-h">${t('apply.steps')}</h2>
        <ol class="c-steps">${steps.map((s, i) => html`<li class="c-steps__item" id="step-${i + 1}"><span class="c-steps__n" aria-hidden="true">${i + 1}</span><div class="c-steps__body"><h3 class="c-steps__t"><span class="sr-only">${t('apply.step', { n: i + 1 })}：</span>${s.title}</h3>${s.text ? html`<p>${s.text}</p>` : ''}<p class="c-steps__m">${s.who ? html`<span class="c-pill c-pill--neutral">${t('apply.step.who')}：${s.who}</span>` : ''}${s.days != null ? html` <span class="c-pill c-pill--info">${s.days ? t('apply.step.days', { n: s.days }) : t('apply.step.sameday')}</span>` : ''}</p></div></li>`)}</ol>
      </section>
      ${docs.length ? html`<section class="c-block" id="documents" aria-labelledby="doc-h"><h2 id="doc-h">${t('apply.docs')}</h2>
        <p class="muted">${t('apply.docs.note')} <span class="c-checklist__prog" data-check-prog role="status"></span></p>
        <ul class="c-checklist" data-checklist="${sv.id}">${docs.map((d, i) => html`<li><label class="c-checklist__row"><input type="checkbox" data-check="${i}"><span class="c-checklist__box" aria-hidden="true"></span><span class="c-checklist__t">${d}</span></label></li>`)}</ul>
        <button type="button" class="c-btn c-btn--sm c-btn--ghost" data-check-reset>${t('apply.docs.reset')}</button>
      </section>` : ''}
      ${sv.forms?.length ? html`<section class="c-block" aria-labelledby="fm-h"><h2 id="fm-h">${t('apply.forms')}</h2>
        <ul class="c-linklist">${sv.forms.map((f) => html`<li>${isExternal(f.href) ? extLink(ctx, f.href, f.label) : html`<a href="${url(f.href)}">${f.label}</a>`} ${f.format ? html`<span class="c-pill c-pill--neutral">${f.format}</span>` : ''} ${f.machineReadable ? pill(t('news.attach.mr'), 'ok') : ''}</li>`)}</ul></section>` : ''}
      ${sv.faq?.length ? html`<section class="c-block" id="faq" aria-labelledby="fq-h"><h2 id="fq-h">${t('apply.faq')}</h2>
        ${sv.faq.map((f) => html`<details class="c-faqd"><summary>${f.q}</summary><div class="c-prose">${raw(md(f.a))}</div></details>`)}</section>` : ''}
      ${feedback(ctx, { page: ctx.path })}
    </div>
    <aside class="c-cols__side">
      <section class="c-aside-card c-service__facts" id="sla"><h2>${t('apply.facts')}</h2>
        <dl class="c-deflist c-deflist--sm">
          <div><dt>${t('apply.who')}</dt><dd>${(sv.whoCanApply ?? []).join('、') || '—'}</dd></div>
          <div><dt>${t('apply.days')}</dt><dd>${sv.slaDays != null ? t('apply.sla', { n: sv.slaDays }) : (totalDays ? t('apply.sla', { n: totalDays }) : '—')}</dd></div>
          <div><dt>${t('apply.fee')}</dt><dd>${sv.fee ?? '—'}</dd></div>
          <div><dt>${t('prov.owner')}</dt><dd>${unitName(ctx, sv.owner)}</dd></div>
          ${sv.contact ? html`<div><dt>${t('apply.contact')}</dt><dd>${sv.contact}</dd></div>` : ''}
        </dl></section>
      ${sv.legalBasis?.length ? html`<section class="c-aside-card"><h2>${t('apply.legal')}</h2><ul class="c-linklist">${sv.legalBasis.map((l) => html`<li>${l}</li>`)}</ul></section>` : ''}
      ${related ? html`<section class="c-aside-card"><h2>${t('lab.next')}</h2><ul class="c-linklist"><li><a href="${url(related[0])}">${t(related[1])}</a></li></ul></section>` : ''}
      ${pageData(ctx, sv, { schema: 'GovernmentService', api: '/v1/services.json', mdPath: `${itemPath(sv).replace(/\/$/, '')}.md` })}
    </aside>
  </div>
</article>`;
}

export function render(ctx, props = {}) { return props.item ? detail(ctx, props.item) : listPage(ctx); }

export function markdown(ctx, { item: sv }) {
  const lines = [`# ${L(ctx, sv, 'title')}`, '', ...mdHeader(ctx, sv, `類別：${sv.serviceType}`), '', L(ctx, sv, 'summary') ?? '', '', L(ctx, sv, 'introMarkdown') ?? sv.introMarkdown ?? ''];
  lines.push('', `- 誰可申請：${(sv.whoCanApply ?? []).join('、')}`);
  if (sv.slaDays != null) lines.push(`- 處理天數：${sv.slaDays} 個工作天`);
  if (sv.fee) lines.push(`- 費用：${sv.fee}`);
  if (sv.contact) lines.push(`- 聯絡：${sv.contact}`);
  if (sv.applyUrl) lines.push(`- 申請網址：${sv.applyUrl}`);
  lines.push('', '## 申請步驟', '', ...(sv.steps ?? []).map((s, i) => `${i + 1}. **${s.title}**${s.who ? `（${s.who}）` : ''}${s.days != null ? `（${s.days} 日）` : ''}${s.text ? `：${s.text}` : ''}`));
  if (sv.requiredDocuments?.length) lines.push('', '## 應備文件', '', ...sv.requiredDocuments.map((d) => `- [ ] ${d}`));
  if (sv.legalBasis?.length) lines.push('', '## 法源', '', ...sv.legalBasis.map((l) => `- ${l}`));
  if (sv.forms?.length) lines.push('', '## 表單', '', ...sv.forms.map((f) => `- [${f.label}](${f.href})${f.format ? `（${f.format}）` : ''}${f.machineReadable ? '（機讀）' : ''}`));
  if (sv.faq?.length) lines.push('', '## 常見問題', '', ...sv.faq.flatMap((f) => [`### ${f.q}`, '', f.a, '']));
  return lines.join('\n') + '\n';
}

export function pages(site) {
  const out = [{ path: '/apply/', lang: '*', props: {} }];
  for (const L_ of site.config.langs) for (const s of site.collections.services ?? []) if (s.status === 'published' && langAvailable(site, s, L_.code)) out.push({ path: `/apply/${s.slug}/`, lang: L_.code, props: { item: s }, md: true });
  return out;
}
