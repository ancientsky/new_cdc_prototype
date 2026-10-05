// /procurement/（採購公告列表）與 /procurement/{slug}/（標案詳情）。ARCHITECTURE 15.2。
// 分頁籤：招標中／已截止／已開標／已決標／流標（撤銷併入流標頁籤並加註）。
import { html, raw, daysBetween } from '../../../scripts/lib/render.mjs';
import { md } from '../../../scripts/lib/markdown.mjs';
import { langAvailable } from '../../../scripts/lib/pages.mjs';
import {
  ldFor, breadcrumb, pageHead, provenance, alerts, pageData, feedback, translationBadge, hrefFor, isFallbackLink, L, unitName, extLink, isExternal, pill, mdHeader,
} from './_partials.mjs';
import { tendersOf, allTenders, tenderPath, tenderStage, tenderTab, TENDER_TABS, stagePill, tenderCountdown, money } from './_careers.mjs';

const STYLES = ['/assets/styles/careers.css'];
const trailOf = (ctx, x) => [{ label: ctx.t('proc.title'), href: '/procurement/' }, { label: L(ctx, x, 'title') }];

export function meta(ctx, props = {}) {
  const { t } = ctx;
  if (props.item) { const x = props.item; return { title: L(ctx, x, 'title'), description: L(ctx, x, 'summary') ?? t('proc.lead'), item: x, styles: STYLES, jsonLd: ldFor(ctx, x, trailOf(ctx, x)) }; }
  return { title: t('proc.title'), description: t('proc.lead'), styles: STYLES, jsonLd: ldFor(ctx, null, [{ label: t('proc.title') }]) };
}

/* ── 公告異動（第十六輪；amendments[] 由 /admin/tenders/edit/ 追加） ── */
const AMEND_RECENT_DAYS = 14; // 最新一筆異動在 14 天內 ⇒ 頁首加提示
const AMEND_PILL_STAGES = ['open', 'closed', 'opened']; // 列表卡只在還沒結案的階段標「有異動」
/** 依日期倒序（同一天後加的在前） */
export const amendsOf = (x) => (x.amendments ?? []).map((a, i) => ({ a, i })).sort((p, q) => String(q.a.date).localeCompare(String(p.a.date)) || q.i - p.i).map((v) => v.a);
const amendPill = (ctx, kind) => pill(ctx.t(`proc.amend.kind.${kind}`), kind === 'cancel' ? 'warn' : kind === 'extend' ? 'info' : 'neutral');
function amendSection(ctx, x) {
  const list = amendsOf(x);
  if (!list.length) return '';
  const { t, fmtDate } = ctx;
  return html`<section class="c-block c-tamend" id="amendments" aria-labelledby="h-amend"><h2 id="h-amend">${t('proc.amend.title')}</h2>
  <p class="muted">${t('proc.amend.lead')}</p>
  <ol class="c-tamend-list">${list.map((a) => html`<li class="c-tamend-item" data-kind="${a.kind}"><p class="c-tamend-head">${amendPill(ctx, a.kind)} <time datetime="${a.date}">${fmtDate(a.date)}</time></p>
    <p class="c-tamend-text">${a.text}</p>${a.refNo ? html`<p class="c-tamend-ref muted">${t('proc.amend.ref')}：${a.refNo}</p>` : ''}</li>`)}</ol></section>`;
}
function amendRecent(ctx, x) {
  const last = amendsOf(x)[0];
  if (!last?.date) return '';
  const d = daysBetween(last.date, ctx.site.today);
  if (d < 0 || d > AMEND_RECENT_DAYS) return '';
  return html`<p class="c-alert c-alert--info c-tamend-recent" role="note">${ctx.t('proc.amend.recent', { date: ctx.fmtDate(last.date), text: last.text })} <a class="c-alert__go" href="#amendments">${ctx.t('proc.amend.see')} ↓</a></p>`;
}

const pccLink = (ctx, x) => (x.pccUrl ? extLink(ctx, x.pccUrl, ctx.t('proc.pcc')) : '');

function tenderCard(ctx, x) {
  const { t, fmtDate, site } = ctx;
  const stage = tenderStage(site, x);
  const fb = isFallbackLink(ctx, x);
  return html`<li class="c-job c-tender" data-stage="${stage}">
  <div class="c-job__main">
    <p class="c-job__meta">${x.method ? pill(x.method, 'info') : ''} ${x.category ? pill(x.category, 'neutral') : ''}${stage === 'cancelled' ? html` ${stagePill(ctx, stage, 'tender')}` : ''}${x.amendments?.length && AMEND_PILL_STAGES.includes(stage) ? html` ${pill(t('proc.amend.badge'), 'warn')}` : ''}</p>
    <h3 class="c-job__t"><a href="${hrefFor(ctx, { ...x, type: 'tender' })}"${fb ? raw(' lang="zh-TW"') : ''}>${fb ? x.title : L(ctx, x, 'title')}</a></h3>
    <dl class="c-job__facts">
      <div><dt>${t('proc.tenderNo')}</dt><dd>${x.tenderNo ?? '—'}</dd></div>
      <div><dt>${t('proc.budget')}</dt><dd>${money(x.budgetNtd)}</dd></div>
      ${x.requestingUnit ? html`<div><dt>${t('proc.unit')}</dt><dd>${unitName(ctx, x.requestingUnit)}</dd></div>` : ''}
      ${x.openingAt ? html`<div><dt>${t('proc.opening')}</dt><dd><time datetime="${x.openingAt}">${fmtDate(x.openingAt)}</time></dd></div>` : ''}
      ${x.award ? html`<div><dt>${t('proc.award.winner')}</dt><dd>${x.award.winner}</dd></div>` : ''}
    </dl>
  </div>
  <div class="c-job__side">
    ${tenderCountdown(ctx, x, stage)}
    <span class="c-job__date muted">${t('proc.deadline')} <time datetime="${x.deadlineAt}">${fmtDate(x.deadlineAt)}</time></span>
    ${pccLink(ctx, x)}
  </div>
</li>`;
}

const sortFor = {
  open: (a, b) => String(a.deadlineAt).localeCompare(String(b.deadlineAt)),
  closed: (a, b) => String(b.deadlineAt).localeCompare(String(a.deadlineAt)),
  opened: (a, b) => String(b.openingAt ?? b.deadlineAt).localeCompare(String(a.openingAt ?? a.deadlineAt)),
  awarded: (a, b) => String(b.award?.date ?? '').localeCompare(String(a.award?.date ?? '')),
  failed: (a, b) => String(b.deadlineAt).localeCompare(String(a.deadlineAt)),
};

function listPage(ctx) {
  const { site, t, url } = ctx;
  const items = tendersOf(site);
  const tabs = TENDER_TABS.map((k) => ({ id: k, list: items.filter((x) => tenderTab(site, x) === k).sort(sortFor[k]) }));
  return html`${pageHead(ctx, {
    trail: [{ label: t('proc.title') }], h1: t('proc.title'), lead: t('proc.lead'),
    actions: html`<a class="c-btn c-btn--ghost c-btn--sm" href="${url('/feeds/procurement.xml', { noLang: true })}">RSS</a> <a class="c-btn c-btn--ghost c-btn--sm" href="${url('/v1/tenders.json', { noLang: true })}">JSON API</a>`,
  })}
<div class="c-tabs" data-tabs>
  <div class="c-tabs__list" role="tablist" aria-label="${t('proc.title')}">${tabs.map((tb, i) => html`<button type="button" role="tab" id="tab-p-${tb.id}" aria-controls="panel-p-${tb.id}" aria-selected="${i === 0 ? 'true' : 'false'}" tabindex="${i === 0 ? '0' : '-1'}">${t(`proc.tab.${tb.id}`)} <span class="c-tabs__n">${tb.list.length}</span></button>`)}</div>
  <div>${tabs.map((tb, i) => html`<div class="c-tabs__panel" role="tabpanel" id="panel-p-${tb.id}" aria-labelledby="tab-p-${tb.id}" ${i ? raw('data-initial-hidden') : ''}>
    <h2 class="c-tabs__print">${t(`proc.tab.${tb.id}`)}</h2>
    <p class="muted c-tabs__hint">${t(`proc.tab.${tb.id}.note`)}</p>
    ${tb.list.length ? html`<ul class="c-joblist">${tb.list.map((x) => tenderCard(ctx, x))}</ul>` : html`<p class="c-empty">${t(`proc.empty.${tb.id}`)}</p>`}
  </div>`)}</div>
</div>
<section class="c-block c-careers__foot" aria-labelledby="pr-ct">
  <div class="c-cols2 c-careers__cols">
    <div class="c-aside-card"><h2 id="pr-ct">${t('proc.contact')}</h2><p>${unitName(ctx, 'unit.secretariat')}</p><p class="muted">${t('proc.contact.note')}</p><p><a href="${url('/contact/')}">${t('contact.title')} →</a></p></div>
    <div class="c-aside-card"><h2>${t('proc.pcc.t')}</h2><p class="muted">${t('proc.pcc.note')}</p><p><a href="https://web.pcc.gov.tw/" rel="noopener">${t('proc.pcc')} ↗</a></p></div>
    <div class="c-aside-card"><h2>${t('proc.subscribe')}</h2><p class="muted">${t('proc.subscribe.note')}</p><p><a class="c-btn c-btn--sm c-btn--ghost" href="${url('/feeds/procurement.xml', { noLang: true })}">${t('careers.subscribe.rss')}</a></p></div>
  </div>
</section>`;
}

function timeline(ctx, x, stage) {
  const { t, fmtDate } = ctx;
  const steps = [
    { k: 'announce', date: x.announcedAt },
    { k: 'deadline', date: x.deadlineAt },
    { k: 'opening', date: x.openingAt },
    { k: 'award', date: x.award?.date },
  ];
  const cur = { open: 1, closed: 2, opened: 3, awarded: 3, failed: -1, cancelled: -1 }[stage] ?? -1;
  return html`<ol class="c-jtl c-jtl--4${stage === 'cancelled' || stage === 'failed' ? ' c-jtl--cancelled' : ''}" aria-label="${t('proc.timeline')}">${steps.map((s, i) => {
    const st = cur < 0 ? 'todo' : i < cur ? 'done' : i === cur ? 'current' : 'todo';
    return html`<li class="c-jtl__item is-${st}" ${st === 'current' ? raw('aria-current="step"') : ''} data-step="${s.k}"><span class="c-jtl__dot" aria-hidden="true">${st === 'done' ? '✓' : i + 1}</span>
      <span class="c-jtl__body"><strong class="c-jtl__t">${t(`proc.tl.${s.k}`)}</strong>${st === 'current' ? html`<span class="c-jtl__now">${t('job.tl.now')}</span>` : ''}
      <span class="c-jtl__d">${s.date ? html`<time datetime="${s.date}">${fmtDate(s.date)}</time>` : html`<span class="muted">${t('job.tl.tba')}</span>`}</span></span></li>`;
  })}</ol>`;
}

function detail(ctx, x) {
  const { t, fmtDate, url, lang, site } = ctx;
  const stage = tenderStage(site, x);
  const langStatus = x.languages?.[lang]?.status;
  const row = (k, v) => (v == null || v === '' ? '' : html`<tr><th scope="row">${k}</th><td>${v}</td></tr>`);
  return html`${breadcrumb(ctx, trailOf(ctx, x))}
<article class="c-article c-tender-detail" data-tender="${x.id}" data-stage="${stage}">
  <header class="c-pagehead"><div class="c-pagehead__main">
    <p class="c-article__meta">${stagePill(ctx, stage, 'tender')} ${x.method ? pill(x.method, 'info') : ''} <span>${t('proc.unit')}：${x.requestingUnit ? unitName(ctx, x.requestingUnit) : unitName(ctx, x.owner)}</span></p>
    <h1>${L(ctx, x, 'title')}</h1>
    ${L(ctx, x, 'summary') ? html`<p class="lead">${L(ctx, x, 'summary')}</p>` : ''}
    ${langStatus && lang !== 'zh-TW' ? html`<p>${translationBadge(ctx, langStatus === 'reviewed' ? 'reviewed' : 'machine')}</p>` : ''}
    ${alerts(ctx, x)}${amendRecent(ctx, x)}${provenance(ctx, x)}
  </div>${x.pccUrl ? html`<div class="c-pagehead__actions">${extLink(ctx, x.pccUrl, t('proc.pcc'), { cls: 'c-btn c-btn--ghost' })}</div>` : ''}</header>
  <div class="c-cols c-cols--2">
    <div class="c-cols__main">
      <section class="c-block" id="info" aria-labelledby="h-info"><h2 id="h-info">${t('proc.s.info')}</h2>
        <div class="c-tablewrap"><table class="c-table c-table--kv"><tbody>
          ${row(t('proc.tenderNo'), x.tenderNo)}${row(t('proc.method'), x.method)}${row(t('proc.category'), x.category)}${row(t('proc.budget'), x.budgetNtd != null ? money(x.budgetNtd) : '')}${row(t('proc.unit'), x.requestingUnit ? unitName(ctx, x.requestingUnit) : '')}
          ${row(t('proc.announced'), x.announcedAt ? html`<time datetime="${x.announcedAt}">${fmtDate(x.announcedAt)}</time>` : '')}${row(t('proc.deadline'), x.deadlineAt ? html`<time datetime="${x.deadlineAt}">${fmtDate(x.deadlineAt)}</time> ${tenderCountdown(ctx, x, stage)}` : '')}${row(t('proc.briefing'), x.briefingAt ? html`<time datetime="${x.briefingAt}">${fmtDate(x.briefingAt)}</time>` : '')}${row(t('proc.opening'), x.openingAt ? html`<time datetime="${x.openingAt}">${fmtDate(x.openingAt)}</time>` : '')}${row(t('proc.awardRule'), x.awardRule)}${row(t('proc.contract'), x.contractPeriod)}
          ${x.pccUrl ? row(t('proc.pcc'), extLink(ctx, x.pccUrl, x.pccUrl.replace(/^https?:\/\//, '').slice(0, 48))) : ''}
        </tbody></table></div></section>
      ${x.scope?.length ? html`<section class="c-block" id="scope" aria-labelledby="h-scope"><h2 id="h-scope">${t('proc.s.scope')}</h2><ul class="c-bullets">${x.scope.map((v) => html`<li>${v}</li>`)}</ul></section>` : ''}
      ${x.specialTerms?.length ? html`<section class="c-block" id="terms" aria-labelledby="h-terms"><h2 id="h-terms">${t('proc.s.terms')}</h2><ul class="c-bullets">${x.specialTerms.map((v) => html`<li>${v}</li>`)}</ul></section>` : ''}
      <section class="c-block" id="timeline" aria-labelledby="h-timeline"><h2 id="h-timeline">${t('proc.timeline')}</h2>${timeline(ctx, x, stage)}</section>
      ${amendSection(ctx, x)}
      ${x.bodyMarkdown ? html`<div class="c-prose">${raw(md(L(ctx, x, 'bodyMarkdown') ?? x.bodyMarkdown))}</div>` : ''}
      <section class="c-block" id="award" aria-labelledby="h-award"><h2 id="h-award">${t('proc.s.award')}</h2>
        ${x.award ? html`<div class="c-tablewrap"><table class="c-table c-table--kv"><tbody>
          ${row(t('proc.award.date'), html`<time datetime="${x.award.date}">${fmtDate(x.award.date)}</time>`)}${row(t('proc.award.winner'), x.award.winner)}${row(t('proc.award.amount'), x.award.amountNtd != null ? money(x.award.amountNtd) : '')}${row(t('job.col.note'), x.award.note)}</tbody></table></div>`
    : stage === 'failed' ? html`<p>${t('proc.failed.note')}</p>` : stage === 'cancelled' ? html`<p>${t('proc.cancelled.note')}</p>`
      : html`<p class="muted">${t('proc.award.pending')}</p>`}</section>
      ${x.attachments?.length ? html`<section class="c-block" id="attachments" aria-labelledby="h-att"><h2 id="h-att">${t('news.attach')}</h2><ul class="c-linklist">${x.attachments.map((a) => html`<li>${(isExternal(a.url) ? extLink(ctx, a.url, a.label) : html`<a href="${url(a.url)}">${a.label}</a>`)} ${a.machineReadable ? pill(t('news.attach.mr'), 'ok') : ''}</li>`)}</ul></section>` : ''}
      ${x.contact ? html`<section class="c-block" id="contact" aria-labelledby="h-contact"><h2 id="h-contact">${t('job.s.contact')}</h2><p>${x.contact}</p><p class="muted">${unitName(ctx, x.owner)}</p></section>` : ''}
      ${feedback(ctx, { page: ctx.path })}
    </div>
    <aside class="c-cols__side">
      <section class="c-aside-card"><h2>${t('proc.s.info')}</h2>
        <dl class="c-deflist c-deflist--sm"><div><dt>${t('proc.tenderNo')}</dt><dd>${x.tenderNo ?? '—'}</dd></div><div><dt>${t('proc.budget')}</dt><dd>${money(x.budgetNtd)}</dd></div>
        <div><dt>${t('proc.deadline')}</dt><dd>${x.deadlineAt ? html`<time datetime="${x.deadlineAt}">${fmtDate(x.deadlineAt)}</time>` : '—'}</dd></div></dl>
        ${x.pccUrl ? html`<p>${extLink(ctx, x.pccUrl, t('proc.pcc'), { cls: 'c-btn c-btn--block' })}</p>` : ''}
        <p><a href="${url('/procurement/')}">${t('proc.title')} →</a></p></section>
      ${pageData(ctx, x, { schema: 'GovernmentService', api: '/v1/tenders.json', mdPath: `${tenderPath(x).replace(/\/$/, '')}.md` })}
    </aside>
  </div>
</article>`;
}

export function render(ctx, props = {}) { return props.item ? detail(ctx, props.item) : listPage(ctx); }

export function markdown(ctx, { item: x }) {
  const stage = tenderStage(ctx.site, x);
  const lines = [`# ${L(ctx, x, 'title')}`, '', ...mdHeader(ctx, x, `階段：${stage}`), '', L(ctx, x, 'summary') ?? ''];
  lines.push('', `- 標案案號：${x.tenderNo ?? ''}`, `- 採購方式：${x.method ?? ''}`, `- 標的分類：${x.category ?? ''}`, `- 預算：${money(x.budgetNtd)}`, `- 需求單位：${x.requestingUnit ? unitName(ctx, x.requestingUnit) : ''}`);
  lines.push(`- 公告日：${x.announcedAt ?? ''}`, `- 投標截止：${x.deadlineAt ?? ''}`, `- 開標：${x.openingAt ?? '—'}`);
  if (x.pccUrl) lines.push(`- 政府電子採購網：${x.pccUrl}`);
  if (x.award) lines.push('', '## 決標資訊', '', `- 決標日：${x.award.date}`, `- 得標廠商：${x.award.winner}`, ...(x.award.amountNtd != null ? [`- 決標金額：${money(x.award.amountNtd)}`] : []), ...(x.award.note ? [`- 備註：${x.award.note}`] : []));
  const am = amendsOf(x);
  if (am.length) lines.push('', '## 公告異動', '', ...am.map((a) => `- ${a.date}［${ctx.t(`proc.amend.kind.${a.kind}`)}］${a.text}${a.refNo ? `（${a.refNo}）` : ''}`));
  if (x.contact) lines.push('', '## 聯絡', '', x.contact);
  for (const a of x.attachments ?? []) lines.push('', `- 附件：[${a.label}](${a.url})`);
  return lines.join('\n') + '\n';
}

export function pages(site) {
  const out = [{ path: '/procurement/', lang: '*', props: {} }];
  for (const L_ of site.config.langs) for (const x of allTenders(site)) if (x.status === 'published' && langAvailable(site, { type: 'tender', ...x }, L_.code)) out.push({ path: tenderPath(x), lang: L_.code, props: { item: x }, md: true });
  return out;
}
