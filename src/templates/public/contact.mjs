// /contact/：聯絡我們。三欄：1922 與聯絡資訊、各單位、署長信箱示範（分類→自動分流→信件預覽→mailto／複製）。
// 原型不寄信：mailto 使用示意信箱；正式環境接署內表單系統。本機記錄存 localStorage cdc.mailbox（不含 email）。
import { html, raw } from '../../../scripts/lib/render.mjs';
import { md } from '../../../scripts/lib/markdown.mjs';
import { config } from '../../../site.config.mjs';
import { ldFor, pageHead, L, unitName, unitLink, unitPath } from './_partials.mjs';

export const MAILBOX_ADDR = 'mailbox@example.cdc.gov.tw';
/** 分類 → 權責單位（正式環境由署內分文規則取代） */
export const MAIL_CATEGORIES = [
  { key: 'general', unit: 'unit.pr' },
  { key: 'acute', unit: 'unit.acute-infectious' },
  { key: 'chronic', unit: 'unit.chronic-infectious' },
  { key: 'vaccine', unit: 'unit.acute-infectious' },
  { key: 'quarantine', unit: 'unit.quarantine' },
  { key: 'infection-control', unit: 'unit.infection-control' },
  { key: 'lab', unit: 'unit.lab' },
  { key: 'data', unit: 'unit.epidemic-intelligence' },
  { key: 'website', unit: 'unit.it' },
  { key: 'ai-error', unit: 'unit.oasis' },
  { key: 'petition', unit: 'unit.secretariat' },
];

export function meta(ctx) {
  const item = ctx.site.byId.get('page.contact') ?? null;
  return { title: ctx.t('contact.title'), description: ctx.t('contact.lead'), item: null, jsonLd: ldFor(ctx, item, [{ label: ctx.t('contact.title') }]), scripts: [] };
}

function infoColumn(ctx) {
  const { site, t } = ctx;
  const p = site.byId.get('page.contact');
  const body = p ? (L(ctx, p, 'bodyMarkdown') ?? p.bodyMarkdown ?? '') : '';
  return html`<section class="c-contact__col" aria-labelledby="ct-1"><h2 id="ct-1">${t('contact.info')}</h2>
  <div class="c-callout c-callout--hotline"><p class="c-callout__big"><a href="tel:1922">1922</a></p><p>${t('contact.1922')}</p>
    <ul class="c-linklist"><li>${t('contact.toll')}：<a href="tel:0800001922">0800-001922</a></li><li>${t('contact.intl')}：<a href="tel:${config.hotlineIntl.replace(/[^+\d]/g, '')}">${config.hotlineIntl}</a></li></ul></div>
  ${body ? html`<div class="c-prose">${raw(md(body))}</div>` : ''}
  ${p ? html`<p class="c-about__prov muted">${t('prov.owner')}：${unitLink(ctx, p.owner)} · ${t('prov.reviewed')} ${ctx.fmtDate(p.reviewedAt)}</p>` : ''}
  <p class="muted">${t('contact.emergency')}</p>
  <h3 class="c-contact__sub">${t('contact.other')}</h3>
  <ul class="c-linklist"><li><a href="${ctx.url('/careers/')}">${t('careers.title')}</a> <span class="muted">${t('contact.careers.unit')}</span></li><li><a href="${ctx.url('/procurement/')}">${t('proc.title')}</a> <span class="muted">${t('contact.proc.unit')}</span></li></ul>
  <ul class="c-linklist"><li><a href="${ctx.url('/ask/')}">${t('ask.title')}</a></li><li><a href="${ctx.url('/factcheck/')}">${t('nav.factcheck')}</a></li><li><a href="${ctx.url('/faq/')}">${t('nav.faq')}</a></li></ul>
</section>`;
}

function unitsColumn(ctx) {
  const { site, t, lang } = ctx;
  const units = (site.master.units ?? []).filter((u) => u.kind !== 'committee');
  return html`<section class="c-contact__col" aria-labelledby="ct-2"><h2 id="ct-2">${t('contact.units')}</h2>
  <p class="muted">${t('contact.units.note')}</p>
  <div class="c-tablewrap"><table class="c-table c-table--units"><thead><tr><th scope="col">${t('contact.units.name')}</th><th scope="col">${t('contact.units.kind')}</th></tr></thead>
  <tbody>${units.map((u) => html`<tr><th scope="row"><a href="${ctx.url(unitPath(u))}">${lang === 'zh-TW' ? u.name : (u.nameEn ?? u.name)}</a>${lang === 'zh-TW' && u.nameEn ? html`<br><span class="muted" lang="en">${u.nameEn}</span>` : ''}</th><td>${t(`about.org.${u.kind}`)}</td></tr>`)}</tbody></table></div>
</section>`;
}

function mailboxColumn(ctx) {
  const { site, t } = ctx;
  const p = site.byId.get('page.director-mailbox');
  const body = p ? (L(ctx, p, 'bodyMarkdown') ?? p.bodyMarkdown ?? '') : '';
  return html`<section class="c-contact__col c-mailbox" id="mailbox" aria-labelledby="ct-3" data-mailbox data-addr="${MAILBOX_ADDR}">
  <h2 id="ct-3">${t('contact.mailbox')} <span class="c-pill c-pill--warn">${t('contact.demo')}</span></h2>
  <p>${p ? L(ctx, p, 'summary') : t('contact.mailbox.lead')}</p>
  ${body ? html`<details class="c-source-card"><summary>${t('contact.mailbox.about')}</summary><div class="c-prose c-about__body">${raw(md(body))}</div></details>` : ''}
  <div class="c-alert c-alert--info" role="note"><strong class="c-alert__t">${t('contact.ai.t')}</strong> ${t('contact.ai')} <a href="${ctx.url('/ask/')}">${t('ask.title')} →</a></div>
  <form class="c-mailform" data-mailbox-form novalidate>
    <div class="c-field"><label for="mb-cat">${t('contact.f.cat')}</label>
      <select id="mb-cat" class="c-input c-select" name="category" required data-mb-cat><option value="">${t('contact.f.cat.ph')}</option>${MAIL_CATEGORIES.map((c) => html`<option value="${c.key}" data-unit="${unitName(ctx, c.unit)}" data-label="${t(`contact.cat.${c.key}`)}">${t(`contact.cat.${c.key}`)}</option>`)}</select>
      <p class="c-field__hint" role="status" aria-live="polite" data-mb-route data-empty="${t('contact.route.empty')}" data-tpl="${t('contact.route', { unit: '{unit}' })}">${t('contact.route.empty')}</p></div>
    <div class="c-field"><label for="mb-sub">${t('contact.f.subject')}</label><input id="mb-sub" class="c-input" name="subject" type="text" maxlength="80" required autocomplete="off"></div>
    <div class="c-field"><label for="mb-body">${t('contact.f.body')}</label><textarea id="mb-body" class="c-input c-textarea" name="body" rows="6" required></textarea>
      <p class="c-field__hint">${t('contact.f.body.hint')}</p></div>
    <div class="c-field"><label for="mb-mail">${t('contact.f.email')}</label><input id="mb-mail" class="c-input" name="email" type="email" autocomplete="email" aria-describedby="mb-mail-h">
      <p class="c-field__hint" id="mb-mail-h">${t('contact.f.email.hint')}</p></div>
    <div class="c-field c-field--check"><label class="c-checkrow"><input type="checkbox" name="consent" required><span>${t('contact.f.consent')}</span></label></div>
    <p class="c-mailform__err" role="alert" data-mb-err hidden>${t('contact.err')}</p>
    <p><button type="submit" class="c-btn">${t('contact.preview')}</button></p>
  </form>
  <noscript><p class="c-alert c-alert--overdue">${t('contact.noscript')}</p></noscript>
  <div class="c-mailpreview" data-mb-preview hidden aria-live="polite">
    <h3>${t('contact.pv.t')}</h3>
    <dl class="c-deflist c-deflist--sm"><div><dt>${t('contact.pv.to')}</dt><dd><code>${MAILBOX_ADDR}</code> <span class="muted">(${t('contact.demo')})</span></dd></div><div><dt>${t('contact.pv.route')}</dt><dd data-mb-pv-unit></dd></div><div><dt>${t('contact.pv.subject')}</dt><dd data-mb-pv-subject></dd></div></dl>
    <pre class="c-mailpreview__body" id="mb-pv-body" data-mb-pv-body tabindex="0"></pre>
    <p class="c-mailpreview__acts"><a class="c-btn" data-mb-mailto href="mailto:${MAILBOX_ADDR}">${t('contact.pv.mailto')}</a> <button type="button" class="c-btn c-btn--ghost" data-copy-target="mb-pv-body" data-done="${t('copied')}">${t('contact.pv.copy')}</button> <button type="button" class="c-btn c-btn--ghost" data-mb-edit>${t('contact.pv.edit')}</button></p>
    <p class="muted" role="status" data-mb-saved>${t('contact.pv.saved')}</p>
  </div>
  <details class="c-source-card" data-mb-log-wrap><summary>${t('contact.log')}</summary><div class="c-source-card__in"><ul class="c-linklist" data-mb-log></ul><p class="muted">${t('contact.log.note')}</p><button type="button" class="c-btn c-btn--sm c-btn--ghost" data-mb-clear>${t('contact.log.clear')}</button></div></details>
</section>`;
}

export function render(ctx) {
  const { t } = ctx;
  return html`${pageHead(ctx, { trail: [{ label: t('contact.title') }], h1: t('contact.title'), lead: t('contact.lead') })}
<div class="c-contact">${infoColumn(ctx)}${unitsColumn(ctx)}${mailboxColumn(ctx)}</div>`;
}

export function pages() { return [{ path: '/contact/', lang: '*', props: {} }]; }
