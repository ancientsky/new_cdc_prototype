// /careers/（人才招募列表）、/careers/{slug}/（職缺詳情）、/careers/{slug}/apply/（模擬線上報名；noindex）。ARCHITECTURE 15.2。
// 列表：開放中／即將開放／審查與甄試中／錄取結果／歷史 五個分頁籤；職類／地點／單位篩選由 careers-list.js 處理。
// 模擬報名：只在 open 且沒有外部 applyUrl 的職缺輸出完整表單（careers-apply.js；資料只存瀏覽器，不送出）；其他階段輸出「已截止／尚未開放」頁。
import { html, raw } from '../../../scripts/lib/render.mjs';
import { md } from '../../../scripts/lib/markdown.mjs';
import { langAvailable } from '../../../scripts/lib/pages.mjs';
import {
  ldFor, breadcrumb, pageHead, provenance, alerts, pageData, feedback, translationBadge, hrefFor, isFallbackLink, L, unitName, extLink, isExternal,
  pill, alertBox, mdHeader,
} from './_partials.mjs';
import {
  jobsOf, allJobs, jobPath, applyPath, applyOnSite, jobStage, jobTab, JOB_TABS, stagePill, jobCountdown, placeOf, safeName, jobSlug,
} from './_careers.mjs';

const STYLES = ['/assets/styles/careers.css'];
const LIST_JS = ['/assets/js/careers-list.js'];
const APPLY_JS = ['/assets/js/careers-apply.js'];
const trailOf = (ctx, j) => [{ label: ctx.t('careers.title'), href: '/careers/' }, { label: L(ctx, j, 'title') }];

export function meta(ctx, props = {}) {
  const { t } = ctx;
  if (props.apply) {
    const j = props.item;
    return { title: `${t('japply.title')}：${L(ctx, j, 'title')}`, description: t('japply.banner'), noindex: true, item: j, styles: STYLES, scripts: props.open ? APPLY_JS : [], jsonLd: [] };
  }
  if (props.item) {
    const j = props.item;
    return { title: L(ctx, j, 'title'), description: L(ctx, j, 'summary') ?? t('careers.lead'), item: j, styles: STYLES, jsonLd: ldFor(ctx, j, trailOf(ctx, j)) };
  }
  return { title: t('careers.title'), description: t('careers.lead'), styles: STYLES, scripts: LIST_JS, jsonLd: ldFor(ctx, null, [{ label: t('careers.title') }]) };
}

/* ───────── 共用：報名方式與按鈕 ───────── */
function applyButtons(ctx, j, stage, { size = 'lg' } = {}) {
  const { t, url } = ctx;
  if (stage !== 'open') return '';
  if (j.applyUrl) return html`<a class="c-btn c-btn--${size}" href="${j.applyUrl}" rel="noopener" data-job-apply="external">${t('job.apply.external')}<span aria-hidden="true"> ↗</span><span class="sr-only"> (${t('external')})</span></a>`;
  if (!applyOnSite(j)) return '';
  return html`<a class="c-btn c-btn--${size}" href="${url(applyPath(j))}" data-job-apply="sim">${t('job.apply.online')} →</a>`;
}

/* ───────── 列表 ───────── */
function jobCard(ctx, j, tab) {
  const { t, fmtDate, site } = ctx;
  const stage = jobStage(site, j);
  const fb = isFallbackLink(ctx, j);
  const place = placeOf(j.workplace);
  const showStage = tab !== 'open' && tab !== 'upcoming';
  return html`<li class="c-job" data-jobtype="${j.jobType ?? ''}" data-place="${place}" data-unit="${j.hiringUnit ?? ''}" data-stage="${stage}">
  <div class="c-job__main">
    <p class="c-job__meta">${j.jobType ? pill(L(ctx, j, 'jobType') ?? j.jobType, 'info') : ''}${showStage ? html` ${stagePill(ctx, stage)}` : ''}${j.applyUrl && stage === 'open' ? html` ${pill(t('job.method.external'), 'neutral')}` : ''}</p>
    <h3 class="c-job__t"><a href="${hrefFor(ctx, { ...j, type: 'job' })}"${fb ? raw(' lang="zh-TW"') : ''}>${fb ? j.title : L(ctx, j, 'title')}</a></h3>
    <dl class="c-job__facts">
      ${j.hiringUnit ? html`<div><dt>${t('job.unit')}</dt><dd>${unitName(ctx, j.hiringUnit)}</dd></div>` : ''}
      ${j.positions != null ? html`<div><dt>${t('job.positions')}</dt><dd>${t('job.positions.n', { n: j.positions })}</dd></div>` : ''}
      ${j.workplace ? html`<div><dt>${t('job.workplace')}</dt><dd>${j.workplace}</dd></div>` : ''}
      ${j.applyMethod ? html`<div><dt>${t('job.method')}</dt><dd>${t(`job.method.${j.applyMethod}`)}</dd></div>` : ''}
    </dl>
  </div>
  <div class="c-job__side">
    ${jobCountdown(ctx, j, stage)}
    ${stage === 'open' && j.deadlineAt ? html`<span class="c-job__date muted">${t('job.deadline')} <time datetime="${j.deadlineAt}">${fmtDate(j.deadlineAt)}</time></span>` : ''}
    ${stage === 'upcoming' && j.applyStart ? html`<span class="c-job__date muted">${t('job.applyStart')} <time datetime="${j.applyStart}">${fmtDate(j.applyStart)}</time></span>` : ''}
    ${stage === 'result' && j.result?.publishedAt ? html`<span class="c-job__date muted">${t('job.result.on')} <time datetime="${j.result.publishedAt}">${fmtDate(j.result.publishedAt)}</time></span>` : ''}
    ${stage === 'closed' || stage === 'screening' ? html`<span class="c-job__date muted">${j.resultPlannedAt ? t('job.result.planned', { date: fmtDate(j.resultPlannedAt) }) : t('job.result.tba')}</span>` : ''}
    ${applyButtons(ctx, j, stage, { size: 'sm' })}
  </div>
</li>`;
}

const sortFor = {
  open: (a, b) => String(a.deadlineAt ?? '9999').localeCompare(String(b.deadlineAt ?? '9999')),
  upcoming: (a, b) => String(a.applyStart ?? '9999').localeCompare(String(b.applyStart ?? '9999')),
  review: (a, b) => String(b.deadlineAt ?? '').localeCompare(String(a.deadlineAt ?? '')),
  result: (a, b) => String(b.result?.publishedAt ?? '').localeCompare(String(a.result?.publishedAt ?? '')),
  history: (a, b) => String(b.result?.publishedAt ?? b.deadlineAt ?? '').localeCompare(String(a.result?.publishedAt ?? a.deadlineAt ?? '')),
};

function filters(ctx, jobs) {
  const { t } = ctx;
  const types = [...new Set(jobs.map((j) => j.jobType).filter(Boolean))];
  const places = [...new Set(jobs.map((j) => placeOf(j.workplace)).filter(Boolean))];
  const units = [...new Set(jobs.map((j) => j.hiringUnit).filter(Boolean))];
  const sel = (id, key, label, opts) => html`<div class="c-field c-jobfilters__f"><label for="${id}">${label}</label>
    <select id="${id}" class="c-input c-select" data-job-filter="${key}"><option value="">${t('all')}</option>${opts.map(([v, l]) => html`<option value="${v}">${l}</option>`)}</select></div>`;
  return html`<form class="c-jobfilters" role="search" aria-label="${t('careers.filter')}" data-job-filters>
  ${sel('jf-type', 'jobtype', t('job.type'), types.map((x) => [x, x]))}
  ${sel('jf-place', 'place', t('job.workplace'), places.map((x) => [x, x]))}
  ${sel('jf-unit', 'unit', t('job.unit'), units.map((u) => [u, unitName(ctx, u)]))}
  <button type="button" class="c-btn c-btn--sm c-btn--ghost c-jobfilters__reset" data-job-reset hidden>${t('careers.filter.reset')}</button>
  <p class="c-jobfilters__note muted" role="status" aria-live="polite" data-job-filter-note></p>
</form>`;
}

function listPage(ctx) {
  const { site, t, url } = ctx;
  const jobs = jobsOf(site);
  const tabs = JOB_TABS.map((k) => ({ id: k, list: jobs.filter((j) => jobTab(site, j) === k).sort(sortFor[k]) }));
  const unit = site.unitById?.get('unit.personnel');
  return html`${pageHead(ctx, {
    trail: [{ label: t('careers.title') }], h1: t('careers.title'), lead: t('careers.lead'),
    actions: html`<a class="c-btn c-btn--ghost c-btn--sm" href="${url('/feeds/careers.xml', { noLang: true })}">RSS</a> <a class="c-btn c-btn--ghost c-btn--sm" href="${url('/v1/jobs.json', { noLang: true })}">JSON API</a>`,
  })}
${filters(ctx, jobs)}
<div class="c-tabs" data-tabs data-job-tabs>
  <div class="c-tabs__list" role="tablist" aria-label="${t('careers.title')}">${tabs.map((tb, i) => html`<button type="button" role="tab" id="tab-j-${tb.id}" aria-controls="panel-j-${tb.id}" aria-selected="${i === 0 ? 'true' : 'false'}" tabindex="${i === 0 ? '0' : '-1'}" data-job-tab="${tb.id}">${t(`careers.tab.${tb.id}`)} <span class="c-tabs__n" data-job-count="${tb.id}">${tb.list.length}</span></button>`)}</div>
  <div>${tabs.map((tb, i) => html`<div class="c-tabs__panel" role="tabpanel" id="panel-j-${tb.id}" aria-labelledby="tab-j-${tb.id}" data-job-panel="${tb.id}" ${i ? raw('data-initial-hidden') : ''}>
    <h2 class="c-tabs__print">${t(`careers.tab.${tb.id}`)}</h2>
    <p class="muted c-tabs__hint">${t(`careers.tab.${tb.id}.note`)}</p>
    ${tb.list.length ? html`<ul class="c-joblist">${tb.list.map((j) => jobCard(ctx, j, tb.id))}</ul>` : ''}
    <p class="c-empty" data-job-empty ${tb.list.length ? raw('hidden') : ''}>${t(`careers.empty.${tb.id}`)}</p>
  </div>`)}</div>
</div>
<section class="c-block c-careers__foot" aria-labelledby="cr-sub">
  <div class="c-cols2 c-careers__cols">
    <div class="c-aside-card"><h2 id="cr-sub">${t('careers.subscribe')}</h2>
      <p class="muted">${t('careers.subscribe.note')}</p>
      <p><a class="c-btn c-btn--sm c-btn--ghost" href="${url('/feeds/careers.xml', { noLang: true })}">${t('careers.subscribe.rss')}</a>
      <button type="button" class="c-btn c-btn--sm c-btn--ghost" data-subscribe="feed.careers" data-off="${t('pro.subscribe')}" data-on="${t('pro.subscribed')}" aria-pressed="false">${t('pro.subscribe')}</button></p></div>
    <div class="c-aside-card"><h2>${t('careers.contact')}</h2>
      <p>${unit ? (ctx.lang === 'zh-TW' ? unit.name : (unit.nameEn ?? unit.name)) : t('careers.contact.unit')}</p>
      <p class="muted">${t('careers.contact.note')}</p>
      <p><a href="${url('/contact/')}">${t('contact.title')} →</a></p></div>
    <div class="c-aside-card"><h2>${t('careers.privacy.t')}</h2><p class="muted">${t('careers.privacy')}</p>
      <p><a href="${url('/policy/privacy/')}">${t('footer.privacy')} →</a></p></div>
  </div>
</section>`;
}

/* ───────── 詳情：時間軸 ───────── */
function timeline(ctx, j, stage) {
  const { t, fmtDate } = ctx;
  const exams = (j.examPlan ?? []);
  const examDates = exams.filter((e) => e.date);
  const wl = j.waitlistUpdates ?? [];
  const lastWl = wl.map((w) => w.date).sort().pop();
  const validUntil = (j.result?.waitlist ?? []).map((w) => w.validUntil).filter(Boolean).sort().pop();
  const steps = [
    { k: 'announce', date: j.publishedAt ?? j.applyStart, sub: j.applyStart ? `${t('job.applyStart')} ${fmtDate(j.applyStart)}` : '' },
    { k: 'deadline', date: j.deadlineAt },
    { k: 'exam', date: examDates[0]?.date, list: exams },
    { k: 'result', date: j.result?.publishedAt ?? j.resultPlannedAt, planned: !j.result },
    { k: 'waitlist', date: lastWl, sub: validUntil ? t('job.waitlist.until', { date: fmtDate(validUntil) }) : '' },
  ];
  const cur = { upcoming: 0, open: 1, closed: 2, screening: 2, result: wl.length ? 4 : 3, filled: 5, cancelled: -1 }[stage] ?? -1;
  const stateOf = (i) => (stage === 'cancelled' ? 'todo' : i < cur ? 'done' : i === cur ? 'current' : 'todo');
  return html`<ol class="c-jtl${stage === 'cancelled' ? ' c-jtl--cancelled' : ''}" aria-label="${t('job.timeline')}">${steps.map((s, i) => {
    const st = stateOf(i);
    return html`<li class="c-jtl__item is-${st}" ${st === 'current' ? raw('aria-current="step"') : ''} data-step="${s.k}">
      <span class="c-jtl__dot" aria-hidden="true">${st === 'done' ? '✓' : i + 1}</span>
      <span class="c-jtl__body">
        <strong class="c-jtl__t">${t(`job.tl.${s.k}`)}</strong>
        ${st === 'current' ? html`<span class="c-jtl__now">${t('job.tl.now')}</span>` : ''}
        ${s.k === 'exam' && s.list?.length ? html`<span class="c-jtl__d">${s.list.map((e) => html`<span class="c-jtl__line">${e.stage}${e.date ? html` <time datetime="${e.date}">${fmtDate(e.date)}</time>` : html` <span class="muted">${t('job.tl.tba')}</span>`}</span>`)}</span>`
    : html`<span class="c-jtl__d">${s.date ? html`<time datetime="${s.date}">${fmtDate(s.date)}</time>${s.planned ? html` <span class="muted">${t('job.tl.planned')}</span>` : ''}` : html`<span class="muted">${t('job.tl.tba')}</span>`}${s.sub ? html`<span class="c-jtl__line muted">${s.sub}</span>` : ''}</span>`}
      </span></li>`;
  })}</ol>${stage === 'cancelled' ? alertBox('closed', html`<strong class="c-alert__t">${t('job.cancelled.t')}</strong> ${t('job.cancelled')}`, { role: 'status' }) : ''}`;
}

/* ───────── 詳情：甄選結果 ───────── */
function resultBlock(ctx, j) {
  const r = j.result;
  if (!r) return '';
  const { t, fmtDate } = ctx;
  const admitted = [...(r.admitted ?? [])].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  const waitlist = [...(r.waitlist ?? [])].sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
  const updates = j.waitlistUpdates ?? [];
  const tbl = (cap, head, rows) => html`<div class="c-tablewrap"><table class="c-table c-table--result"><caption class="sr-only">${cap}</caption><thead><tr>${head.map((h) => html`<th scope="col">${h}</th>`)}</tr></thead><tbody>${rows}</tbody></table></div>`;
  return html`<section class="c-block c-jobresult" id="result" aria-labelledby="h-result"><h2 id="h-result">${t('job.s.result')}</h2>
  <p class="c-jobresult__meta"><span>${t('job.result.on')} <time datetime="${r.publishedAt}">${fmtDate(r.publishedAt)}</time></span>${r.refNo ? html` · <span>${t('notice.refNo')}：${r.refNo}</span>` : ''}</p>
  <div class="c-alert c-alert--info" role="note"><strong class="c-alert__t">${t('job.result.privacy.t')}</strong> ${t('job.result.privacy')}</div>
  <h3>${t('job.result.admitted')} <span class="c-pill c-pill--ok">${t('job.positions.n', { n: admitted.length })}</span></h3>
  ${admitted.length ? tbl(t('job.result.admitted'), [t('job.col.seq'), t('job.col.no'), t('job.col.name')], admitted.map((a) => html`<tr data-row="admitted"><td>${a.seq}</td><td><code>${a.candidateNo}</code></td><td class="c-masked">${safeName(a.nameMasked)}</td></tr>`)) : html`<p class="muted">${t('job.result.none')}</p>`}
  <h3>${t('job.result.waitlist')}</h3>
  ${waitlist.length ? tbl(t('job.result.waitlist'), [t('job.col.rank'), t('job.col.no'), t('job.col.name'), t('job.col.validUntil')], waitlist.map((a) => html`<tr data-row="waitlist"><td>${a.rank}</td><td><code>${a.candidateNo}</code></td><td class="c-masked">${safeName(a.nameMasked)}</td><td>${a.validUntil ? html`<time datetime="${a.validUntil}">${fmtDate(a.validUntil)}</time>` : '—'}</td></tr>`)) : html`<p class="muted">${t('job.result.none')}</p>`}
  ${updates.length ? html`<h3>${t('job.result.updates')}</h3>
  <ol class="c-linklist c-jobresult__updates">${[...updates].sort((a, b) => String(a.date).localeCompare(String(b.date))).map((u) => html`<li data-row="update"><time datetime="${u.date}">${fmtDate(u.date)}</time> · <code>${u.candidateNo}</code> <span class="c-masked">${safeName(u.nameMasked)}</span>${u.note ? html` — ${u.note}` : ''}</li>`)}</ol>` : ''}
  ${r.note ? html`<h3>${t('job.result.checkin')}</h3><div class="c-prose">${raw(md(r.note))}</div>` : ''}
  ${r.attachments?.length ? html`<ul class="c-linklist">${r.attachments.map((a) => html`<li>${extLink(ctx, isExternal(a.url) ? a.url : ctx.url(a.url), a.label)}</li>`)}</ul>` : ''}
</section>`;
}

function listBlock(title, id, items) {
  return items?.length ? html`<section class="c-block" id="${id}" aria-labelledby="h-${id}"><h2 id="h-${id}">${title}</h2><ul class="c-bullets">${items.map((x) => html`<li>${x}</li>`)}</ul></section>` : '';
}

function detail(ctx, j) {
  const { t, fmtDate, url, lang, site } = ctx;
  const stage = jobStage(site, j);
  const langStatus = j.languages?.[lang]?.status;
  const exams = j.examPlan ?? [];
  const howBody = (() => {
    if (stage === 'open') {
      return html`<div class="c-howto">
        <p>${t('job.method')}：<strong>${t(`job.method.${j.applyMethod ?? 'online'}`)}</strong>${j.deadlineAt ? html` · ${t('job.deadline')} <time datetime="${j.deadlineAt}">${fmtDate(j.deadlineAt)}</time> ${jobCountdown(ctx, j, stage)}` : ''}</p>
        ${applyButtons(ctx, j, stage) ? html`<p>${applyButtons(ctx, j, stage)}</p>` : ''}
        <p class="muted">${j.applyUrl ? t('job.apply.external.note') : applyOnSite(j) ? t('job.apply.sim.note') : t('job.apply.offline.note', { how: t(`job.method.${j.applyMethod}`) })}</p></div>`;
    }
    if (stage === 'upcoming') return html`<p>${t('job.apply.upcoming', { date: fmtDate(j.applyStart) })}</p>`;
    if (stage === 'closed' || stage === 'screening') return html`<p class="c-howto__closed">${j.resultPlannedAt ? t('job.apply.closed', { date: fmtDate(j.resultPlannedAt) }) : t('job.apply.closed.tba')}</p>${j.deadlineAt ? html`<p class="muted">${t('job.deadline')} <time datetime="${j.deadlineAt}">${fmtDate(j.deadlineAt)}</time></p>` : ''}`;
    if (stage === 'result') return html`<p>${t('job.apply.resulted', { date: fmtDate(j.result?.publishedAt) })} <a href="#result">${t('job.s.result')} →</a></p>`;
    if (stage === 'filled') return html`<p>${t('job.apply.filled')}</p>`;
    return html`<p>${t('job.cancelled')}</p>`;
  })();
  return html`${breadcrumb(ctx, trailOf(ctx, j))}
<article class="c-article c-job-detail" data-job="${j.id}" data-stage="${stage}">
  <header class="c-pagehead"><div class="c-pagehead__main">
    <p class="c-article__meta">${stagePill(ctx, stage)} ${j.jobType ? pill(L(ctx, j, 'jobType') ?? j.jobType, 'info') : ''} <span>${t('job.unit')}：${j.hiringUnit ? unitName(ctx, j.hiringUnit) : unitName(ctx, j.owner)}</span></p>
    <h1>${L(ctx, j, 'title')}</h1>
    ${L(ctx, j, 'summary') ? html`<p class="lead">${L(ctx, j, 'summary')}</p>` : ''}
    ${langStatus && lang !== 'zh-TW' ? html`<p>${translationBadge(ctx, langStatus === 'reviewed' ? 'reviewed' : 'machine')}</p>` : ''}
    ${alerts(ctx, j, { skip: ['closed'] })}${provenance(ctx, j)}
  </div></header>
  <div class="c-cols c-cols--2">
    <div class="c-cols__main">
      <section class="c-block" id="timeline" aria-labelledby="h-timeline"><h2 id="h-timeline">${t('job.timeline')}</h2>${timeline(ctx, j, stage)}</section>
      ${resultBlock(ctx, j)}
      <section class="c-block c-howto-sec" id="how" aria-labelledby="h-how"><h2 id="h-how">${t('job.s.how')}</h2>${howBody}</section>
      ${listBlock(t('job.s.duties'), 'duties', j.duties)}
      ${listBlock(t('job.s.qual'), 'qualifications', j.qualifications)}
      ${j.salaryNote ? html`<section class="c-block" id="salary" aria-labelledby="h-salary"><h2 id="h-salary">${t('job.s.salary')}</h2><p>${j.salaryNote}</p></section>` : ''}
      ${listBlock(t('job.s.docs'), 'documents', j.requiredDocuments)}
      ${exams.length ? html`<section class="c-block" id="exam" aria-labelledby="h-exam"><h2 id="h-exam">${t('job.s.exam')}</h2>
        <div class="c-tablewrap"><table class="c-table"><thead><tr><th scope="col">${t('job.col.stage')}</th><th scope="col">${t('job.col.date')}</th><th scope="col">${t('job.col.note')}</th></tr></thead>
        <tbody>${exams.map((e) => html`<tr><th scope="row">${e.stage}</th><td>${e.date ? html`<time datetime="${e.date}">${fmtDate(e.date)}</time>` : t('job.tl.tba')}</td><td>${e.note ?? ''}</td></tr>`)}</tbody></table></div></section>` : ''}
      ${j.attachments?.length ? html`<section class="c-block" id="attachments" aria-labelledby="h-att"><h2 id="h-att">${t('news.attach')}</h2><ul class="c-linklist">${j.attachments.map((a) => html`<li>${(isExternal(a.url) ? extLink(ctx, a.url, a.label) : html`<a href="${url(a.url)}">${a.label}</a>`)} ${a.machineReadable ? pill(t('news.attach.mr'), 'ok') : ''}</li>`)}</ul></section>` : ''}
      ${j.contact ? html`<section class="c-block" id="contact" aria-labelledby="h-contact"><h2 id="h-contact">${t('job.s.contact')}</h2><p>${j.contact}</p><p class="muted">${unitName(ctx, j.owner)}</p></section>` : ''}
      ${feedback(ctx, { page: ctx.path })}
    </div>
    <aside class="c-cols__side">
      <section class="c-aside-card c-jobfacts"><h2>${t('job.facts')}</h2>
        <dl class="c-deflist c-deflist--sm">
          ${j.hiringUnit ? html`<div><dt>${t('job.unit')}</dt><dd>${unitName(ctx, j.hiringUnit)}</dd></div>` : ''}
          ${j.jobType ? html`<div><dt>${t('job.type')}</dt><dd>${L(ctx, j, 'jobType') ?? j.jobType}</dd></div>` : ''}
          ${j.positions != null ? html`<div><dt>${t('job.positions')}</dt><dd>${t('job.positions.n', { n: j.positions })}</dd></div>` : ''}
          ${j.workplace ? html`<div><dt>${t('job.workplace')}</dt><dd>${j.workplace}</dd></div>` : ''}
          ${j.applyStart ? html`<div><dt>${t('job.applyStart')}</dt><dd><time datetime="${j.applyStart}">${fmtDate(j.applyStart)}</time></dd></div>` : ''}
          ${j.deadlineAt ? html`<div><dt>${t('job.deadline')}</dt><dd><time datetime="${j.deadlineAt}">${fmtDate(j.deadlineAt)}</time> ${jobCountdown(ctx, j, stage)}</dd></div>` : ''}
          ${j.applyMethod ? html`<div><dt>${t('job.method')}</dt><dd>${t(`job.method.${j.applyMethod}`)}</dd></div>` : ''}
        </dl>
        ${stage === 'open' && applyButtons(ctx, j, stage) ? html`<p>${applyButtons(ctx, j, stage, { size: 'block' })}</p>` : ''}
        <p><a href="${url('/careers/')}">${t('careers.title')} →</a></p></section>
      ${pageData(ctx, j, { schema: 'JobPosting', api: '/v1/jobs.json', mdPath: `${jobPath(j).replace(/\/$/, '')}.md` })}
    </aside>
  </div>
</article>`;
}

/* ───────── 模擬線上報名 ───────── */
const EDU = ['phd', 'master', 'bachelor', 'college', 'highschool'];

function field(ctx, { id, label, type = 'text', required = false, hint = '', attrs = '', autocomplete = '' }) {
  return html`<div class="c-field" data-field="${id}"><label for="f-${id}">${label}${required ? html` <span class="c-req" aria-hidden="true">*</span><span class="sr-only"> (${ctx.t('japply.required')})</span>` : html` <span class="muted c-opt">(${ctx.t('japply.optional')})</span>`}</label>
  <input class="c-input" id="f-${id}" name="${id}" type="${type}" ${required ? raw('required aria-required="true"') : ''} ${autocomplete ? raw(`autocomplete="${autocomplete}"`) : ''} ${raw(attrs)} aria-describedby="${hint ? `h-${id} ` : ''}e-${id}">
  ${hint ? html`<p class="c-field__hint" id="h-${id}">${hint}</p>` : ''}<p class="c-field__err" id="e-${id}" data-err hidden></p></div>`;
}

function applyForm(ctx, j) {
  const { t, site } = ctx;
  const docs = j.requiredDocuments ?? [];
  const exams = (j.examPlan ?? []).filter((e) => e.date).map((e) => ({ stage: e.stage, date: e.date, note: e.note ?? '' }));
  const steps = [t('japply.step1'), t('japply.step2'), t('japply.step3')];
  return html`<div class="c-apply" data-apply-root>
  <div class="c-demo-banner" role="note" data-demo-banner><span class="c-demo-banner__ic" aria-hidden="true">!</span><div><strong>${t('japply.banner')}</strong> <span>${t('japply.banner.sub')}</span></div></div>
  <ol class="c-apply__steps" aria-label="${t('japply.steps')}" data-apply-steps>${steps.map((s, i) => html`<li data-step-ind="${i + 1}" ${i === 0 ? raw('aria-current="step"') : ''}><span class="c-apply__stepn" aria-hidden="true">${i + 1}</span><span>${s}</span></li>`)}</ol>
  <p class="c-apply__draftmsg muted" role="status" aria-live="polite" data-draft-msg></p>
  <form class="c-apply__form" data-apply data-job="${j.id}" data-slug="${jobSlug(j)}" data-title="${j.title}" data-today="${site.today}" data-exams="${JSON.stringify(exams)}" data-docs="${JSON.stringify(docs)}" novalidate>
    <div class="c-apply__errors c-alert c-alert--overdue" data-apply-errors tabindex="-1" role="alert" aria-live="assertive" hidden></div>
    <fieldset class="c-apply__step" data-step="1"><legend>${t('japply.step1')}</legend>
      <p class="muted">${t('japply.step1.note')}</p>
      ${field(ctx, { id: 'name', label: t('japply.f.name'), required: true, autocomplete: 'name', attrs: 'maxlength="40"' })}
      ${field(ctx, { id: 'birth', label: t('japply.f.birth'), type: 'date', required: true, autocomplete: 'bday', attrs: `max="${site.today}" min="1930-01-01"` })}
      ${field(ctx, { id: 'phone', label: t('japply.f.phone'), type: 'tel', required: true, autocomplete: 'tel', hint: t('japply.f.phone.hint'), attrs: 'inputmode="tel" maxlength="20"' })}
      ${field(ctx, { id: 'email', label: t('japply.f.email'), type: 'email', required: true, autocomplete: 'email', attrs: 'maxlength="80"' })}
      ${field(ctx, { id: 'address', label: t('japply.f.address'), autocomplete: 'street-address', attrs: 'maxlength="120"' })}
    </fieldset>
    <fieldset class="c-apply__step" data-step="2" hidden><legend>${t('japply.step2')}</legend>
      <div class="c-field" data-field="education"><label for="f-education">${t('japply.f.education')} <span class="c-req" aria-hidden="true">*</span><span class="sr-only"> (${t('japply.required')})</span></label>
        <select class="c-input c-select" id="f-education" name="education" required aria-required="true" aria-describedby="e-education"><option value="">${t('japply.f.select')}</option>${EDU.map((k) => html`<option value="${k}">${t(`japply.edu.${k}`)}</option>`)}</select><p class="c-field__err" id="e-education" data-err hidden></p></div>
      ${field(ctx, { id: 'school', label: t('japply.f.school'), required: true, attrs: 'maxlength="60"' })}
      ${field(ctx, { id: 'major', label: t('japply.f.major'), required: true, attrs: 'maxlength="60"' })}
      ${field(ctx, { id: 'years', label: t('japply.f.years'), type: 'number', required: true, attrs: 'min="0" max="50" step="1" inputmode="numeric"' })}
      <div class="c-field" data-field="experience"><label for="f-experience">${t('japply.f.experience')} <span class="muted c-opt">(${t('japply.optional')})</span></label>
        <textarea class="c-input c-textarea" id="f-experience" name="experience" rows="4" maxlength="500" aria-describedby="h-experience e-experience"></textarea><p class="c-field__hint" id="h-experience">${t('japply.f.experience.hint')}</p><p class="c-field__err" id="e-experience" data-err hidden></p></div>
      ${docs.length ? html`<div class="c-apply__docs"><h3>${t('japply.docs')}</h3><p class="muted">${t('japply.docs.note')}</p>
        ${docs.map((d, i) => html`<div class="c-field" data-field="doc-${i}" data-doc><label for="f-doc-${i}">${d} <span class="c-req" aria-hidden="true">*</span><span class="sr-only"> (${t('japply.required')})</span></label>
          <input class="c-input" id="f-doc-${i}" name="doc-${i}" type="file" accept=".pdf,.jpg,.jpeg,.png,.docx,.odt" required aria-required="true" aria-describedby="h-doc-${i} e-doc-${i}" data-doc-label="${d}">
          <p class="c-field__hint" id="h-doc-${i}" data-doc-name>${t('japply.docs.none')}</p><p class="c-field__err" id="e-doc-${i}" data-err hidden></p></div>`)}</div>` : ''}
    </fieldset>
    <fieldset class="c-apply__step" data-step="3" hidden><legend>${t('japply.step3')}</legend>
      <h3>${t('japply.confirm')}</h3>
      <dl class="c-deflist c-apply__summary" data-apply-summary aria-live="polite"></dl>
      <details class="c-source-card c-apply__notice" open><summary>${t('japply.privacy.t')}</summary><div class="c-prose"><p>${t('japply.privacy.1')}</p><ul><li>${t('japply.privacy.2')}</li><li>${t('japply.privacy.3')}</li><li>${t('japply.privacy.4')}</li></ul></div></details>
      <div class="c-field c-field--check" data-field="consent"><label class="c-checkrow"><input type="checkbox" id="f-consent" name="consent" required aria-required="true" aria-describedby="e-consent"><span>${t('japply.consent')} <span class="c-req" aria-hidden="true">*</span></span></label><p class="c-field__err" id="e-consent" data-err hidden></p></div>
      <div class="c-field c-field--check" data-field="declare"><label class="c-checkrow"><input type="checkbox" id="f-declare" name="declare" required aria-required="true" aria-describedby="e-declare"><span>${t('japply.declare')} <span class="c-req" aria-hidden="true">*</span></span></label><p class="c-field__err" id="e-declare" data-err hidden></p></div>
    </fieldset>
    <div class="c-apply__nav">
      <button type="button" class="c-btn c-btn--ghost" data-apply-prev hidden>${t('japply.prev')}</button>
      <button type="button" class="c-btn" data-apply-next>${t('japply.next')}</button>
      <button type="submit" class="c-btn" data-apply-submit hidden>${t('japply.submit')}</button>
      <button type="button" class="c-btn c-btn--ghost c-btn--sm c-apply__clear" data-apply-clear>${t('japply.clear')}</button>
    </div>
  </form>
  <section class="c-receipt" data-apply-receipt tabindex="-1" aria-labelledby="rc-h" hidden>
    <h2 id="rc-h">${t('japply.receipt.t')}</h2>
    <p class="c-receipt__lead">${t('japply.receipt.no')}</p>
    <p class="c-receipt__no" data-r-no aria-live="polite"></p>
    <dl class="c-deflist c-receipt__dl" data-r-dl></dl>
    <div class="c-demo-banner c-demo-banner--strong" role="note"><span class="c-demo-banner__ic" aria-hidden="true">!</span><div><strong>${t('japply.receipt.notofficial')}</strong> ${t('japply.receipt.notofficial.sub')}</div></div>
    <p class="c-receipt__acts"><button type="button" class="c-btn" data-r-print>${t('japply.receipt.print')}</button> <button type="button" class="c-btn c-btn--ghost" data-r-json>${t('japply.receipt.json')}</button> <button type="button" class="c-btn c-btn--ghost" data-r-ics ${exams.length ? '' : raw('disabled aria-disabled="true"')}>${t('japply.receipt.ics')}</button> <button type="button" class="c-btn c-btn--ghost c-btn--sm" data-r-again>${t('japply.receipt.again')}</button></p>
    ${exams.length ? '' : html`<p class="muted">${t('japply.receipt.ics.none')}</p>`}
  </section>
  <noscript><p class="c-alert c-alert--overdue">${t('japply.noscript')}</p></noscript>
</div>`;
}

function applyPage(ctx, j) {
  const { t, fmtDate, site, url } = ctx;
  const stage = jobStage(site, j);
  const open = stage === 'open' && applyOnSite(j);
  const trail = [{ label: t('careers.title'), href: '/careers/' }, { label: L(ctx, j, 'title'), href: jobPath(j) }, { label: t('japply.title') }];
  if (open) {
    return html`${breadcrumb(ctx, trail)}
<header class="c-pagehead"><div class="c-pagehead__main"><h1>${t('japply.title')}：${L(ctx, j, 'title')}</h1>
  <p class="lead">${j.hiringUnit ? unitName(ctx, j.hiringUnit) : ''}${j.deadlineAt ? html` · ${t('job.deadline')} <time datetime="${j.deadlineAt}">${fmtDate(j.deadlineAt)}</time> ${jobCountdown(ctx, j, stage)}` : ''}</p></div>
  <div class="c-pagehead__actions"><a class="c-btn c-btn--ghost c-btn--sm" href="${url(jobPath(j))}">${t('japply.back')}</a></div></header>
${applyForm(ctx, j)}`;
  }
  const upcoming = stage === 'upcoming';
  return html`${breadcrumb(ctx, trail)}
<header class="c-pagehead"><div class="c-pagehead__main"><h1>${t('japply.title')}：${L(ctx, j, 'title')}</h1></div></header>
<div class="c-demo-banner" role="note"><span class="c-demo-banner__ic" aria-hidden="true">!</span><div><strong>${t('japply.banner')}</strong></div></div>
${alertBox(upcoming ? 'info' : 'closed', html`<strong class="c-alert__t">${upcoming ? t('japply.upcoming.t') : t('japply.closed.t')}</strong> ${upcoming ? t('job.apply.upcoming', { date: fmtDate(j.applyStart) }) : (stage === 'closed' || stage === 'screening' ? (j.resultPlannedAt ? t('job.apply.closed', { date: fmtDate(j.resultPlannedAt) }) : t('job.apply.closed.tba')) : stage === 'result' ? t('job.apply.resulted', { date: fmtDate(j.result?.publishedAt) }) : stage === 'filled' ? t('job.apply.filled') : t('job.cancelled'))}`, { role: 'status' })}
<p><a class="c-btn" href="${url(jobPath(j))}">${t('japply.back')}</a> <a class="c-btn c-btn--ghost" href="${url('/careers/')}">${t('careers.title')}</a></p>`;
}

export function render(ctx, props = {}) {
  if (props.apply) return applyPage(ctx, props.item);
  return props.item ? detail(ctx, props.item) : listPage(ctx);
}

export function markdown(ctx, { item: j }) {
  const { site } = ctx;
  const stage = jobStage(site, j);
  const lines = [`# ${L(ctx, j, 'title')}`, '', ...mdHeader(ctx, j, `階段：${stage}`), '', L(ctx, j, 'summary') ?? ''];
  lines.push('', `- 用人單位：${j.hiringUnit ? unitName(ctx, j.hiringUnit) : ''}`, `- 職類：${j.jobType ?? ''}`, `- 名額：${j.positions ?? ''}`, `- 工作地點：${j.workplace ?? ''}`);
  lines.push(`- 報名期間：${j.applyStart ?? '—'} ～ ${j.deadlineAt ?? '—'}`, `- 報名方式：${j.applyMethod ?? ''}${j.applyUrl ? `（${j.applyUrl}）` : ''}`);
  if (j.salaryNote) lines.push(`- 薪資待遇：${j.salaryNote}`);
  if (j.duties?.length) lines.push('', '## 工作內容', '', ...j.duties.map((x) => `- ${x}`));
  if (j.qualifications?.length) lines.push('', '## 資格條件', '', ...j.qualifications.map((x) => `- ${x}`));
  if (j.requiredDocuments?.length) lines.push('', '## 應備文件', '', ...j.requiredDocuments.map((x) => `- ${x}`));
  if (j.examPlan?.length) lines.push('', '## 甄試方式與日期', '', ...j.examPlan.map((e) => `- ${e.stage}：${e.date ?? '另行通知'}${e.note ? `（${e.note}）` : ''}`));
  if (j.result) {
    lines.push('', `## 甄選結果（${j.result.publishedAt}）`, '', '> 只公布報名編號與遮罩姓名。', '', '### 正取', '', ...(j.result.admitted ?? []).map((a) => `- ${a.seq}. ${a.candidateNo} ${safeName(a.nameMasked)}`));
    lines.push('', '### 備取', '', ...(j.result.waitlist ?? []).map((a) => `- ${a.rank}. ${a.candidateNo} ${safeName(a.nameMasked)}${a.validUntil ? `（有效至 ${a.validUntil}）` : ''}`));
    if (j.waitlistUpdates?.length) lines.push('', '### 遞補紀錄', '', ...j.waitlistUpdates.map((u) => `- ${u.date}：${u.candidateNo} ${safeName(u.nameMasked)}${u.note ? ` — ${u.note}` : ''}`));
  }
  if (j.contact) lines.push('', `## 聯絡`, '', j.contact);
  for (const a of j.attachments ?? []) lines.push('', `- 附件：[${a.label}](${a.url})`);
  return lines.join('\n') + '\n';
}

export function pages(site) {
  const out = [{ path: '/careers/', lang: '*', props: {} }];
  for (const L_ of site.config.langs) {
    for (const j of allJobs(site)) {
      if (j.status !== 'published' || !langAvailable(site, { type: 'job', ...j }, L_.code)) continue;
      out.push({ path: jobPath(j), lang: L_.code, props: { item: j }, md: true });
      // 沒有外部報名網址的職缺才有站內（模擬）報名頁；非 open 階段輸出「已截止／尚未開放」頁。一律 noindex
      if (applyOnSite(j)) out.push({ path: applyPath(j), lang: L_.code, props: { item: j, apply: true, open: jobStage(site, j) === 'open' }, noindex: true });
    }
  }
  return out;
}
