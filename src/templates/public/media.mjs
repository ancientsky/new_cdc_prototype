// /media/、/media/{id}/：影音宣導素材。點擊才載入 YouTube（youtube-nocookie）；逐字稿可搜尋、可複製；明列「依據正本」與版本。
import { html, raw } from '../../../scripts/lib/render.mjs';
import { md } from '../../../scripts/lib/markdown.mjs';
import { langAvailable } from '../../../scripts/lib/pages.mjs';
import { config } from '../../../site.config.mjs';
import {
  ldFor, breadcrumb, pageHead, provenance, alerts, alertBox, pageData, scopeTags, feedback, translationBadge, hrefFor, isFallbackLink, L, unitName,
  publishedOf, slugOf, diseasePage, diseaseName, itemPath, mediaCard, posterImg, fmtDur, isMediaOutdated, currentBasis, mdHeader, extLink,
} from './_partials.mjs';

const YT_RE = /^[A-Za-z0-9_-]{6,15}$/;
const trailOf = (ctx, m) => [{ label: ctx.t('media.title'), href: '/media/' }, { label: L(ctx, m, 'title') }];
const channelUrl = (site) => site.byId.get('dataset.youtube-channel')?.canonicalUrl ?? 'https://www.youtube.com/@TwCDC';
const langLabel = (code) => config.langs.find((l) => l.code === code)?.label ?? code;

export function meta(ctx, props = {}) {
  if (props.item) { const m = props.item; return { title: L(ctx, m, 'title'), description: L(ctx, m, 'summary'), item: m, jsonLd: ldFor(ctx, m, trailOf(ctx, m)), scripts: [] }; }
  return { title: ctx.t('media.title'), description: ctx.t('media.lead'), jsonLd: ldFor(ctx, null, [{ label: ctx.t('media.title') }]) };
}

/* ───────── 列表 ───────── */
function listPage(ctx) {
  const { site, t } = ctx;
  const items = publishedOf(site, 'media').sort((a, b) => String(b.producedAt ?? b.publishedAt).localeCompare(String(a.producedAt ?? a.publishedAt)));
  const uniq = (f) => [...new Set(items.flatMap((m) => m[f] ?? []))];
  const diseases = uniq('diseases');
  const tasks = uniq('tasks');
  const caps = uniq('captions');
  const outdatedN = items.filter((m) => isMediaOutdated(site, m)).length;
  const bar = (key, label, opts) => (opts.length > 0 ? html`<div class="c-filterbar" role="group" aria-label="${label}" data-filterbar="media-list" data-key="${key}">
    <span class="c-filterbar__label">${label}</span>
    <button type="button" data-v="" aria-pressed="true">${t('all')}</button>
    ${opts.map(([v, text]) => html`<button type="button" data-v="${v}" aria-pressed="false">${text}</button>`)}
  </div>` : '');
  return html`${pageHead(ctx, { trail: [{ label: t('media.title') }], h1: t('media.title'), lead: t('media.lead') })}
<div class="c-filterbars">
  ${bar('disease', t('media.filter.disease'), diseases.map((d) => [d, diseaseName(ctx, site.diseaseMasterById.get(d)) || d]))}
  ${bar('task', t('media.filter.task'), tasks.map((k) => [k, t(`task.${k}.label`)]))}
  ${bar('cap', t('media.filter.caption'), caps.map((c) => [c, langLabel(c)]))}
  ${outdatedN ? bar('outdated', t('media.filter.outdated'), [['0', t('media.filter.current')], ['1', t('media.outdated.tag')]]) : ''}
</div>
${items.length ? html`<ul class="c-media-grid" id="media-list" aria-live="polite">${items.map((m) => mediaCard(ctx, m))}</ul>` : html`<p class="c-empty">${t('none')}</p>`}
<p class="muted">${t('media.rule')}</p>
<p class="c-linkrow">${extLink(ctx, channelUrl(site), t('media.channel'))}</p>`;
}

/* ───────── 詳頁 ───────── */
function basisCard(ctx, m) {
  const { t, site, fmtDate } = ctx;
  const refs = (m.basedOn ?? []).map((id) => site.byId.get(id)).filter(Boolean);
  const cur = currentBasis(site, m);
  const outdated = isMediaOutdated(site, m);
  return html`<section class="c-basis${outdated ? ' c-basis--outdated' : ''}" aria-labelledby="basis-h">
  <h2 id="basis-h">${t('media.basis.t')}</h2>
  <dl class="c-deflist c-deflist--sm">
    ${m.basedOnVersionLabel ? html`<div><dt>${t('media.basis.made')}</dt><dd><strong>${t('media.basedOn.short', { v: m.basedOnVersionLabel })}</strong></dd></div>` : ''}
    <div><dt>${t('media.producedAt')}</dt><dd>${fmtDate(m.producedAt)}</dd></div>
    ${refs.map((r) => html`<div><dt>${t('media.basis.doc')}</dt><dd><a href="${hrefFor(ctx, r)}"${isFallbackLink(ctx, r) ? raw(' lang="zh-TW"') : ''}>${L(ctx, r, 'title')}</a>${r.version ? html` <span class="muted">${r.version}</span>` : ''}</dd></div>`)}
    ${cur ? html`<div><dt>${t('media.basis.current')}</dt><dd><a href="${hrefFor(ctx, cur)}">${cur.version ?? L(ctx, cur, 'title')}</a>${cur.effectiveAt ? html` <span class="muted">${t('prov.effective')} ${fmtDate(cur.effectiveAt)}</span>` : ''} ${outdated ? html`<span class="c-pill c-pill--warn">${t('media.outdated.tag')}</span>` : html`<span class="c-pill c-pill--ok">${t('media.basis.ok')}</span>`}</dd></div>` : ''}
  </dl>
  <p class="muted">${t('media.basis.note')}</p>
</section>`;
}

function player(ctx, m) {
  const { t, site } = ctx;
  const yt = m.youtubeId && YT_RE.test(m.youtubeId) ? m.youtubeId : null;
  const title = L(ctx, m, 'title');
  if (!yt) {
    return html`<div class="c-player c-player--demo" data-player>
  <div class="c-player__stage">${posterImg(ctx, m, { loading: 'eager' })}<span class="c-player__demo">${t('media.demo')}</span></div>
  <p class="c-player__note muted">${t('media.demo.note')} ${extLink(ctx, m.videoUrl || channelUrl(site), t('media.channel'))}</p>
</div>`;
  }
  return html`<div class="c-player" data-player data-yt="${yt}" data-title="${title}">
  <div class="c-player__stage" data-player-stage>${posterImg(ctx, m, { loading: 'eager' })}
    <button type="button" class="c-player__play" data-player-load aria-label="${t('media.play')}：${title}"><svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true" focusable="false"><path d="M8 5v14l11-7z" fill="currentColor"/></svg><span>${t('media.play')}</span></button>
  </div>
  <p class="c-player__note muted">${t('media.privacy')} <a href="https://www.youtube.com/watch?v=${yt}" rel="noopener">YouTube ↗</a></p>
</div>`;
}

function chapters(ctx, m) {
  const { t } = ctx;
  if (!m.chapters?.length) return '';
  return html`<section class="c-block" aria-labelledby="chap-h"><h2 id="chap-h">${t('media.chapters')}</h2>
  <ol class="c-chapters">${m.chapters.map((c) => html`<li><button type="button" class="c-chapters__btn" data-seek="${c.t}"><span class="c-chapters__t">${fmtDur(c.t)}</span> ${c.label}</button></li>`)}</ol>
  <p class="muted">${m.youtubeId ? t('media.chapters.note') : t('media.chapters.demo')}</p></section>`;
}

function transcript(ctx, m) {
  const { t } = ctx;
  const body = L(ctx, m, 'transcriptMarkdown') ?? m.transcriptMarkdown ?? '';
  return html`<section class="c-block" aria-labelledby="tr-h"><h2 id="tr-h">${t('media.transcript')}</h2>
  <details class="c-transcript" id="transcript" data-transcript>
    <summary>${t('media.transcript.open')}</summary>
    <div class="c-transcript__tools">
      <label class="sr-only" for="tr-q">${t('media.transcript.search')}</label>
      <input id="tr-q" class="c-input" type="search" placeholder="${t('media.transcript.search')}" data-transcript-search autocomplete="off">
      <span class="c-transcript__count muted" role="status" data-transcript-count></span>
      <button type="button" class="c-btn c-btn--sm c-btn--ghost" data-copy-target="transcript-body" data-done="${t('copied')}">${t('media.transcript.copy')}</button>
    </div>
    <div class="c-prose c-transcript__body" id="transcript-body">${raw(md(body))}</div>
  </details>
  <p class="muted">${t('media.transcript.note')}</p></section>`;
}

function detail(ctx, m) {
  const { site, t, fmtDate, lang } = ctx;
  const diseases = (m.diseases ?? []).map((id) => ({ id, page: diseasePage(ctx, id), dm: site.diseaseMasterById.get(id) }));
  const outdated = isMediaOutdated(site, m);
  const hasAnn = m.gov?.annotations?.some((a) => a.kind === 'based-on-revised');
  const cur = currentBasis(site, m, true);
  const langStatus = m.languages?.[lang]?.status;
  const fallbackAlert = outdated && !hasAnn && cur
    ? alertBox('based-on-revised', html`<strong class="c-alert__t">${t('alert.based-on-revised.t')}</strong> ${t('media.outdated.alert', { v: m.basedOnVersionLabel ?? '', rev: fmtDate(cur.effectiveAt) })} <a class="c-alert__go" href="${hrefFor(ctx, cur)}">${t('alert.go')} →</a>`)
    : '';
  return html`${breadcrumb(ctx, trailOf(ctx, m))}
<article class="c-article c-media-detail">
  <header class="c-pagehead"><div class="c-pagehead__main">
    <p class="c-article__meta"><span class="c-pill c-pill--info">${t(`media.type.${m.mediaType}`)}</span>${m.durationSeconds ? html` <span>${t('media.duration')} ${fmtDur(m.durationSeconds)}</span>` : ''} · <span>${t('media.producedAt')} ${fmtDate(m.producedAt)}</span>${m.series ? html` · <span>${m.series}</span>` : ''}</p>
    <h1>${L(ctx, m, 'title')}</h1>
    <p class="lead">${L(ctx, m, 'summary')}</p>
    ${scopeTags(ctx, m, { region: false })}
    ${langStatus && lang !== 'zh-TW' ? html`<p>${translationBadge(ctx, langStatus === 'reviewed' ? 'reviewed' : 'machine')}</p>` : ''}
    ${alerts(ctx, m)}${fallbackAlert}
    ${provenance(ctx, m)}
  </div></header>
  <div class="c-cols c-cols--2">
    <div class="c-cols__main">
      ${player(ctx, m)}
      ${basisCard(ctx, m)}
      ${chapters(ctx, m)}
      ${transcript(ctx, m)}
      ${feedback(ctx, { page: ctx.path })}
    </div>
    <aside class="c-cols__side">
      ${diseases.length ? html`<section class="c-aside-card"><h2>${t('news.related')}</h2><ul class="c-linklist">${diseases.map((d) => html`<li>${d.page ? html`<a href="${hrefFor(ctx, d.page)}">${L(ctx, d.page, 'title')}</a>` : diseaseName(ctx, d.dm)}</li>`)}</ul></section>` : ''}
      <section class="c-aside-card"><h2>${t('media.info')}</h2><dl class="c-deflist c-deflist--sm">
        <div><dt>${t('prov.owner')}</dt><dd>${unitName(ctx, m.owner)}</dd></div>
        ${m.captions?.length ? html`<div><dt>${t('media.captions')}</dt><dd>${m.captions.map(langLabel).join('、')}</dd></div>` : ''}
        ${m.targetGroups?.length ? html`<div><dt>${t('media.target')}</dt><dd>${m.targetGroups.join('、')}</dd></div>` : ''}
        ${m.series ? html`<div><dt>${t('media.series')}</dt><dd>${m.series}</dd></div>` : ''}
      </dl></section>
      ${pageData(ctx, m, { schema: 'VideoObject', api: '/v1/media.json', mdPath: `${itemPath(m).replace(/\/$/, '')}.md` })}
    </aside>
  </div>
</article>`;
}

export function render(ctx, props = {}) { return props.item ? detail(ctx, props.item) : listPage(ctx); }

export function markdown(ctx, { item: m }) {
  const { site } = ctx;
  const lines = [`# ${L(ctx, m, 'title')}`, '', ...mdHeader(ctx, m, `製作日：${m.producedAt}${m.basedOnVersionLabel ? ` · 依 ${m.basedOnVersionLabel} 製作` : ''}`)];
  if (isMediaOutdated(site, m) && !m.gov?.annotations?.some((a) => a.kind === 'based-on-revised')) lines.push(`> ⚠ 本影片所依據的正本已修訂，內容可能與現行版不同。`);
  lines.push('', L(ctx, m, 'summary') ?? '');
  const refs = (m.basedOn ?? []).map((id) => site.byId.get(id)).filter(Boolean);
  if (refs.length) lines.push('', '## 依據正本', '', ...refs.map((r) => `- ${r.title}${r.version ? `（${r.version}）` : ''}：${ctx.url(itemPath(r), { absolute: true, noLang: true })}`));
  if (m.youtubeId) lines.push('', `影片：https://www.youtube.com/watch?v=${m.youtubeId}`);
  if (m.chapters?.length) lines.push('', '## 章節', '', ...m.chapters.map((c) => `- [${fmtDur(c.t)}] ${c.label}`));
  lines.push('', '## 逐字稿', '', L(ctx, m, 'transcriptMarkdown') ?? m.transcriptMarkdown ?? '');
  return lines.join('\n') + '\n';
}

export function pages(site) {
  const out = [{ path: '/media/', lang: '*', props: {} }];
  for (const L_ of site.config.langs) for (const m of site.collections.media ?? []) if (m.status === 'published' && langAvailable(site, m, L_.code)) out.push({ path: `/media/${slugOf(m)}/`, lang: L_.code, props: { item: m }, md: true });
  return out;
}
void unitName; void pageHead;
