// /topics/{slug}/：專區（取代現行小 Banner 連結列）。簡介、連結（外部標示、最後檢查日、失連警示）、相關內容；到期顯示「已結束」橫幅。
import { html, raw } from '../../../scripts/lib/render.mjs';
import { md } from '../../../scripts/lib/markdown.mjs';
import { langAvailable } from '../../../scripts/lib/pages.mjs';
import {
  ldFor, breadcrumb, provenance, alerts, alertBox, pageData, scopeTags, feedback, translationBadge, hrefFor, isFallbackLink, L, unitName, itemPath,
  isExternal, imgSrc, isTopicEnded, mediaCard, mdHeader,
} from './_partials.mjs';

const trailOf = (ctx, tp) => [{ label: ctx.t('topic.title'), href: '/services/' }, { label: L(ctx, tp, 'title') }];

export function meta(ctx, { item }) {
  return { title: L(ctx, item, 'title'), description: L(ctx, item, 'summary'), item, jsonLd: ldFor(ctx, item, trailOf(ctx, item)) };
}

const isExt = (l) => (typeof l.external === 'boolean' ? l.external : isExternal(l.href));

function linkRow(ctx, l) {
  const { t, fmtDate, url } = ctx;
  const ext = isExt(l);
  const broken = l.status === 'broken';
  const href = l.href.startsWith('/') ? url(l.href) : l.href;
  return html`<li class="c-toplink${broken ? ' c-toplink--broken' : ''}">
  <p class="c-toplink__t">${broken ? html`<span class="c-toplink__dead">${L(ctx, l, 'label')}</span>` : html`<a href="${href}"${ext ? raw(' rel="noopener"') : ''}>${L(ctx, l, 'label')}${ext ? html`<span aria-hidden="true"> ↗</span><span class="sr-only"> (${t('external')})</span>` : ''}</a>`}
    <span class="c-pill c-pill--${ext ? 'neutral' : 'ok'}">${ext ? t('topic.link.ext') : t('topic.link.int')}</span></p>
  ${l.note ? html`<p class="c-toplink__n">${L(ctx, l, 'note') ?? l.note}</p>` : ''}
  ${broken ? html`<p class="c-toplink__err" role="note"><strong>${t('topic.link.broken')}</strong></p>` : ''}
  ${l.lastCheckedAt ? html`<p class="c-toplink__chk muted">${t('topic.link.checked', { date: fmtDate(l.lastCheckedAt) })}${l.status === 'ok' ? ` · ${t('topic.link.ok')}` : ''}</p>` : ''}
</li>`;
}

/** 第二十八輪：分段本文（#s-{key}）。翻譯取 i18n[lang].blocks 同 key 的段落，沒有就用來源語言。 */
export function sectionOf(ctx, tp, sec) {
  const tr = ctx.lang === (tp.sourceLang ?? 'zh-TW') ? null : (tp.i18n?.[ctx.lang]?.blocks ?? []).find((x) => x.key === sec.key);
  return { ...sec, heading: tr?.heading ?? sec.heading, markdown: tr?.markdown ?? sec.markdown };
}
function sectionBlock(ctx, tp, sec0) {
  const sec = sectionOf(ctx, tp, sec0);
  const pro = sec.audience === 'professional';
  return html`<section class="c-block c-topic__sec${pro ? ' c-topic__sec--pro' : ''}" id="s-${sec.key}" aria-labelledby="s-${sec.key}-h">
  <h2 id="s-${sec.key}-h">${sec.heading}${pro ? html` <span class="c-pill c-pill--info">${ctx.t('topic.section.pro')}</span>` : ''}</h2>
  <div class="c-prose">${raw(md(sec.markdown))}</div>
</section>`;
}

export function render(ctx, { item: tp }) {
  const { site, t, fmtDate, lang } = ctx;
  const ended = isTopicEnded(site, tp);
  const rel = (tp.contentIds ?? []).map((id) => site.byId.get(id)).filter((x) => x && x.status === 'published');
  const relMedia = rel.filter((x) => x.type === 'media');
  const relOther = rel.filter((x) => x.type !== 'media');
  const img = imgSrc(ctx, tp.image);
  const langStatus = tp.languages?.[lang]?.status;
  const body = L(ctx, tp, 'introMarkdown') ?? tp.introMarkdown ?? '';
  return html`${breadcrumb(ctx, trailOf(ctx, tp))}
<article class="c-article c-topic${ended ? ' c-topic--ended' : ''}">
  <header class="c-pagehead"><div class="c-pagehead__main">
    <p class="c-article__meta"><span class="c-pill c-pill--info">${t(`topic.kind.${tp.kind ?? 'resource-hub'}`)}</span>${tp.startAt ? html` <span>${fmtDate(tp.startAt)}${tp.endAt ? ` – ${fmtDate(tp.endAt)}` : ` ${t('topic.ongoing')}`}</span>` : ''}</p>
    <h1>${L(ctx, tp, 'title')}</h1>
    <p class="lead">${L(ctx, tp, 'summary')}</p>
    ${ended && !tp.gov?.annotations?.some((a) => a.kind === 'ended') ? alertBox('ended', html`<strong class="c-alert__t">${t('topic.ended.t')}</strong> ${t('topic.ended', { date: fmtDate(tp.endAt) })}`, { role: 'status' }) : ''}
    ${scopeTags(ctx, tp, { region: false })}
    ${langStatus && lang !== 'zh-TW' ? html`<p>${translationBadge(ctx, langStatus === 'reviewed' ? 'reviewed' : 'machine')}</p>` : ''}
    ${alerts(ctx, tp)}
    ${provenance(ctx, tp, { showAi: true })}
  </div>${img ? html`<div class="c-topic__img"><img src="${img}" alt="" width="240" height="240" loading="eager"></div>` : ''}</header>
  <div class="c-cols c-cols--2">
    <div class="c-cols__main">
      ${body ? html`<div class="c-prose">${raw(md(body))}</div>` : ''}
      ${(tp.blocks ?? []).map((sec) => sectionBlock(ctx, tp, sec))}
      <section class="c-block" aria-labelledby="tl-h"><h2 id="tl-h">${t('topic.links')}</h2>
        <ul class="c-toplinks">${tp.links.map((l) => linkRow(ctx, l))}</ul>
        <p class="muted">${t('topic.links.note')}</p>
      </section>
      ${relMedia.length ? html`<section class="c-block" aria-labelledby="tm-h"><h2 id="tm-h">${t('home.media')}</h2><ul class="c-media-grid">${relMedia.map((m) => mediaCard(ctx, m))}</ul></section>` : ''}
      ${feedback(ctx, { page: ctx.path })}
    </div>
    <aside class="c-cols__side">
      <section class="c-aside-card"><h2>${t('topic.related')}</h2>
        ${relOther.length ? html`<ul class="c-linklist">${relOther.map((r) => html`<li><a href="${hrefFor(ctx, r)}"${isFallbackLink(ctx, r) ? raw(' lang="zh-TW"') : ''}>${L(ctx, r, 'title') ?? r.question}</a> <span class="c-pill c-pill--neutral">${t(`type.${r.type}`)}</span></li>`)}</ul>` : html`<p class="muted">${t('none')}</p>`}
      </section>
      ${pageData(ctx, tp, { schema: 'WebPage', api: '/v1/topics.json', mdPath: `${itemPath(tp).replace(/\/$/, '')}.md` })}
    </aside>
  </div>
</article>`;
}

export function markdown(ctx, { item: tp }) {
  const { site } = ctx;
  const lines = [`# ${L(ctx, tp, 'title')}`, '', ...mdHeader(ctx, tp, tp.endAt ? `專區期間：${tp.startAt ?? ''}～${tp.endAt}` : '')];
  if (isTopicEnded(site, tp)) lines.push(`> 本專區已於 ${tp.endAt} 結束，保留供查閱。`);
  lines.push('', L(ctx, tp, 'introMarkdown') ?? tp.introMarkdown ?? '');
  for (const sec0 of tp.blocks ?? []) { const sec = sectionOf(ctx, tp, sec0); lines.push('', `## ${sec.heading}${sec.audience === 'professional' ? `（${ctx.t('topic.section.pro')}）` : ''}`, '', sec.markdown); }
  lines.push('', '## 連結', '');
  for (const l of tp.links) lines.push(`- [${L(ctx, l, 'label')}](${l.href.startsWith('/') ? ctx.url(l.href, { absolute: true, noLang: true }) : l.href})${l.note ? `：${l.note}` : ''}${l.status === 'broken' ? '（連結失效，已通知權責單位）' : ''}${l.lastCheckedAt ? `（最後檢查 ${l.lastCheckedAt}）` : ''}`);
  const rel = (tp.contentIds ?? []).map((id) => site.byId.get(id)).filter(Boolean);
  if (rel.length) lines.push('', '## 相關內容', '', ...rel.map((r) => `- ${r.title ?? r.question}：${ctx.url(itemPath(r), { absolute: true, noLang: true })}`));
  return lines.join('\n') + '\n';
}

export function pages(site) {
  const out = [];
  for (const L_ of site.config.langs) for (const tp of site.collections.topics ?? []) if (tp.status === 'published' && langAvailable(site, tp, L_.code)) out.push({ path: `/topics/${tp.slug}/`, lang: L_.code, props: { item: tp }, md: true });
  return out;
}
void unitName;
