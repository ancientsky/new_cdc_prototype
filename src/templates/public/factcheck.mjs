// 謠言查證：貼上訊息 → 判定（D 的 factcheck.js 掛到 #factcheck-result）；下方列出最近澄清（伺服器端 render）。
import { html, raw } from '../../../scripts/lib/render.mjs';
import { md } from '../../../scripts/lib/markdown.mjs';
import { ldFor, pageHead, sectionHead, verdictPill, provenance, alerts, hrefFor, L, publishedOf, byDateDesc, unitName, unitLink, isFallbackLink, translationBadge, langOk } from './_partials.mjs';

export function meta(ctx) {
  return { title: ctx.t('nav.factcheck'), description: ctx.t('factcheck.desc'), styles: ['/assets/styles/answer.css'], scripts: ['/assets/js/answer/factcheck.js'], jsonLd: ldFor(ctx, null, [{ label: ctx.t('nav.factcheck') }]) };
}

export function clarificationCard(ctx, c) {
  const { t, fmtDate } = ctx;
  const outdated = (c.gov?.stale?.length ?? 0) > 0;
  const fb = !langOk(ctx.site, c, ctx.lang);
  const body = fb ? c.clarificationMarkdown : L(ctx, c, 'clarificationMarkdown');
  const share = fb ? c.shareText : L(ctx, c, 'shareText');
  const title = fb ? c.title : L(ctx, c, 'title');
  return html`<article class="c-clarcard c-clarcard--${outdated ? 'outdated' : c.verdict}" id="${c.id}">
  <header class="c-clarcard__head">${verdictPill(ctx, c.verdict, { outdated })}<time datetime="${c.publishedAt}">${fmtDate(c.publishedAt)}</time>${c.channels?.length ? html`<span class="muted">${t('factcheck.channels')}：${c.channels.join('、')}</span>` : ''}${fb ? html` ${translationBadge(ctx, 'none')}` : ''}</header>
  <h3 ${fb ? raw('lang="zh-TW"') : ''}>${title}</h3>
  <p class="c-clarcard__claim"><b>${t('factcheck.claim')}</b> <span lang="zh-TW">${c.claim}</span></p>
  ${alerts(ctx, c)}
  <div class="c-clarcard__body" ${fb ? raw('lang="zh-TW"') : ''}>${raw(md(body))}</div>
  ${share ? html`<div class="c-share"><p class="c-share__t">${t('factcheck.share')}</p><p class="c-share__text" id="sh-${c.id}">${share}</p><button type="button" class="c-btn c-btn--sm c-btn--ghost" data-copy-target="sh-${c.id}" data-done="${t('copied')}">${t('copy')}</button></div>` : ''}
  <p class="muted">${t('factcheck.report')}：${c.reportChannel ?? '1922'} · ${t('prov.owner')} ${unitLink(ctx, c.owner)} · ${t('prov.reviewed')} ${fmtDate(c.reviewedAt)}</p>
</article>`;
}

export function render(ctx) {
  const { site, t, url } = ctx;
  const list = publishedOf(site, 'clarifications').sort(byDateDesc);
  return html`${pageHead(ctx, { trail: [{ label: t('nav.factcheck') }], h1: t('nav.factcheck'), lead: t('factcheck.lead') })}
<section class="c-factcheck" aria-labelledby="fc-h">
  <h2 id="fc-h">${t('factcheck.paste')}</h2>
  <form id="factcheck-form" class="c-factcheck__form" action="${url('/ask/')}" method="get">
    <label for="factcheck-input" class="sr-only">${t('factcheck.paste')}</label>
    <textarea id="factcheck-input" name="q" rows="5" class="c-input c-textarea" placeholder="${t('factcheck.ph')}" maxlength="2000"></textarea>
    <p class="muted">${t('factcheck.privacy')}</p>
    <button type="submit" class="c-btn" id="factcheck-submit">${t('factcheck.submit')}</button>
  </form>
  <div id="factcheck-result" class="c-factcheck__result" aria-live="polite"></div>
  <noscript><p class="c-alert c-alert--overdue">${t('ask.noscript')}</p></noscript>
</section>
<section aria-labelledby="fc-recent">
  ${sectionHead(ctx, { id: 'fc-recent', title: t('factcheck.recent') })}
  <ul class="c-legend">${['false', 'partly-true', 'outdated'].map((v) => html`<li>${verdictPill(ctx, v)} ${t(`verdict.${v}.d`)}</li>`)}</ul>
  <div class="c-clarlist">${list.length ? list.map((c) => clarificationCard(ctx, c)) : html`<p class="c-empty">${t('none')}</p>`}</div>
</section>`;
}

export function pages() { return [{ path: '/factcheck/', lang: '*', props: {} }]; }
void hrefFor; void provenance; void isFallbackLink;
