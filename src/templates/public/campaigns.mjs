// /campaigns/：宣導 Banner 總覽。這就是 Banner 的「資料目錄」：進行中／即將開始／已結束，每則都有權責、上下架日與關聯內容。
import { html, raw } from '../../../scripts/lib/render.mjs';
import { ldFor, pageHead, hrefFor, isFallbackLink, L, unitName, publishedOf, isExternal, imgSrc, itemPath, campaignState } from './_partials.mjs';

export function meta(ctx) {
  return { title: ctx.t('campaigns.title'), description: ctx.t('campaigns.lead'), jsonLd: ldFor(ctx, null, [{ label: ctx.t('campaigns.title') }]) };
}

const stateOf = campaignState;

function relatedOf(site, b) {
  const ids = [...(b.diseases ?? []), ...(b.vaccines ?? []), ...(b.related ?? []), ...(b.basedOn ?? [])];
  const out = [];
  for (const id of new Set(ids)) { const it = site.byId.get(id); if (it && it.status === 'published') out.push(it); }
  return out;
}

function card(ctx, b, state) {
  const { t, url, fmtDate, site } = ctx;
  const cta = L(ctx, b, 'cta') ?? b.cta;
  const href = isExternal(cta.url) ? cta.url : url(cta.url);
  const head = L(ctx, b, 'headline') ?? b.title;
  const src = imgSrc(ctx, b.image);
  const rel = relatedOf(site, b);
  const left = state === 'active' ? Math.round((new Date(`${b.endAt}T00:00:00Z`) - new Date(`${site.today}T00:00:00Z`)) / 86400000) : null;
  return html`<li class="c-campaign c-campaign--${state}" id="${b.id}">
  <div class="c-campaign__art">${src ? html`<img src="${src}" alt="" width="400" height="300" loading="lazy">` : raw('<svg viewBox="0 0 400 300" aria-hidden="true" focusable="false"><rect width="400" height="300" fill="#e5efe9"/><circle cx="300" cy="90" r="64" fill="#cfe3d8"/><circle cx="90" cy="230" r="50" fill="#cfe3d8"/></svg>')}</div>
  <div class="c-campaign__body">
    <h3 class="c-campaign__t">${head}</h3>
    ${L(ctx, b, 'subline') ? html`<p class="c-campaign__sub">${L(ctx, b, 'subline')}</p>` : ''}
    <dl class="c-campaign__meta">
      <div><dt>${t('prov.owner')}</dt><dd>${unitName(ctx, b.owner)}</dd></div>
      <div><dt>${t('campaigns.live')}</dt><dd><time datetime="${b.startAt}">${fmtDate(b.startAt)}</time> – <time datetime="${b.endAt}">${fmtDate(b.endAt)}</time>${left != null ? html` <span class="c-pill c-pill--${left <= 7 ? 'warn' : 'ok'}">${t('campaigns.daysleft', { n: left })}</span>` : ''}</dd></div>
      <div><dt>${t('prov.reviewed')}</dt><dd>${fmtDate(b.reviewedAt)}</dd></div>
      ${rel.length ? html`<div><dt>${t('campaigns.related')}</dt><dd>${rel.map((r, i) => html`${i ? '、' : ''}<a href="${hrefFor(ctx, r)}"${isFallbackLink(ctx, r) ? raw(' lang="zh-TW"') : ''}>${L(ctx, r, 'title')}</a>`)}</dd></div>` : ''}
    </dl>
    <p class="c-campaign__cta">${state === 'ended' ? html`<span class="c-pill c-pill--neutral">${t('campaigns.ended.tag')}</span> <span class="muted">${cta.label}</span>` : state === 'upcoming'
    ? html`<span class="c-pill c-pill--info">${t('campaigns.upcoming.tag', { date: fmtDate(b.startAt) })}</span> <span class="muted">${cta.label}</span>`
    : html`<a class="c-btn c-btn--sm" href="${href}"${isExternal(cta.url) ? raw(' rel="noopener"') : ''}>${cta.label}${isExternal(cta.url) ? ' ↗' : ' →'}</a>`}</p>
  </div>
</li>`;
}

export function render(ctx) {
  const { site, t } = ctx;
  const all = publishedOf(site, 'banners');
  const groups = { active: [], upcoming: [], ended: [] };
  for (const b of all) groups[stateOf(site, b)].push(b);
  groups.active.sort((a, b) => (a.priority ?? 9) - (b.priority ?? 9));
  groups.upcoming.sort((a, b) => a.startAt.localeCompare(b.startAt));
  groups.ended.sort((a, b) => b.endAt.localeCompare(a.endAt));
  const sec = (state) => html`<section class="c-block" aria-labelledby="camp-${state}"><h2 id="camp-${state}">${t(`campaigns.${state}`)} <span class="c-pill c-pill--neutral">${groups[state].length}</span></h2>
    ${groups[state].length ? html`<ul class="c-campaigns">${groups[state].map((b) => card(ctx, b, state))}</ul>` : html`<p class="c-empty">${t('none')}</p>`}</section>`;
  return html`${pageHead(ctx, { trail: [{ label: t('campaigns.title') }], h1: t('campaigns.title'), lead: t('campaigns.lead') })}
<aside class="c-note" aria-label="${t('campaigns.rule.t')}"><strong>${t('campaigns.rule.t')}</strong> ${t('campaigns.rule')}</aside>
${sec('active')}${sec('upcoming')}${sec('ended')}`;
}

export function pages() { return [{ path: '/campaigns/', lang: '*', props: {} }]; }
void itemPath;
