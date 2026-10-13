// 政策／靜態頁：content/pages/*.json（type page）。目錄尚無檔案時 pages() 回傳空陣列。
import { html, raw } from '../../../scripts/lib/render.mjs';
import { md } from '../../../scripts/lib/markdown.mjs';
import { langAvailable } from '../../../scripts/lib/pages.mjs';
import { ldFor, breadcrumb, provenance, alerts, pageData, feedback, translationBadge, L, PAGE_PATHS, itemPath, imgSrc } from './_partials.mjs';
import { isIntlPage, intlSubPath, intlTopic, seriesNav, seriesPager, authorityNote } from './_international.mjs';

/** 此頁的獨立路徑：既有政策頁走 PAGE_PATHS；slug 含 / 的頁（about/mission → /about/mission/）走 /{slug}/；/about/ 由 about.mjs 的 hub 輸出，其他無 / 的 slug 只內嵌在 hub 與聯絡頁。 */
export function standalonePath(item) {
  if (item.slug === 'about') return null;
  if (PAGE_PATHS[item.slug]) return PAGE_PATHS[item.slug];
  if (isIntlPage(item)) return intlSubPath(item); // 第六輪：國際合作子頁（slug 不含 / 時走 /international/{key}/）
  return String(item.slug ?? '').includes('/') ? `/${String(item.slug).replace(/^\/+|\/+$/g, '')}/` : null;
}

/** 第四十四輪（ARCHITECTURE 48）：首長簡介頁（content/pages/*.json 含 profile），依 profile.order 排序 */
export function leadershipProfiles(site) {
  return (site.collections.pages ?? []).filter((p) => p.profile && p.status === 'published').sort((a, b) => (a.profile.order ?? 99) - (b.profile.order ?? 99) || a.id.localeCompare(b.id));
}
export const leadershipIndex = (site) => (site.collections.pages ?? []).find((p) => p.profileIndex && p.status === 'published') ?? null;
export const PROFILE_PLACEHOLDER = '/img/leadership/placeholder.svg';
const pName = (ctx, pr) => (ctx.lang === 'zh-TW' ? pr.name : (pr.nameEn || pr.name));
const pRole = (ctx, pr) => (ctx.lang === 'zh-TW' ? pr.roleTitle : (pr.roleTitleEn || pr.roleTitle));
/** 頁首職稱列：「第 6 任署長」／「Director-General (6th)」 */
function roleLine(ctx, pr) {
  const role = pRole(ctx, pr);
  if (!pr.termNo) return role;
  return ctx.lang === 'zh-TW' ? `第 ${pr.termNo} 任${role}` : `${role} (${ordinal(pr.termNo)})`;
}
const ordinal = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
/** 照片：profile.photo → 第一個 image 資產 → 占位圖 */
function photoOf(ctx, item) {
  const pr = item.profile;
  if (pr.photo) return { src: imgSrc(ctx, pr.photo), alt: pr.photoAlt ?? pName(ctx, pr), placeholder: false };
  const img = (item.assets ?? []).find((a) => a.kind === 'image');
  if (img) return { src: imgSrc(ctx, `/files/${item.id}/${img.file}`), alt: img.alt ?? pr.photoAlt ?? pName(ctx, pr), placeholder: false };
  return { src: imgSrc(ctx, PROFILE_PLACEHOLDER), alt: '', placeholder: true };
}
function profileCard(ctx, p, { heading = 'h3' } = {}) {
  const pr = p.profile; const ph = photoOf(ctx, p); const H = heading;
  return html`<li class="c-profile-card${ph.placeholder ? ' c-profile-card--placeholder' : ''}">
  <a class="c-profile-card__link" href="${ctx.url(standalonePath(p))}">
    <img class="c-profile-card__photo" src="${ph.src}" alt="${ph.alt}" width="120" height="150" loading="lazy">
    <span class="c-profile-card__text"><span class="c-profile-card__role">${roleLine(ctx, pr)}</span><${H} class="c-profile-card__name">${pName(ctx, pr)}</${H}>
    ${ctx.lang === 'zh-TW' && pr.nameEn ? html`<span class="c-profile-card__en" lang="en">${pr.nameEn}</span>` : ''}
    ${pr.since ? html`<span class="c-profile-card__since muted">${ctx.t('profile.since')} ${pr.since}</span>` : ''}</span></a>
  ${p.verification?.status === 'pending' ? html`<span class="c-pill c-pill--warn c-profile-card__pill">${ctx.t('profile.unverified.badge')}</span>` : ''}
</li>`;
}
/** 總覽頁與關於頁共用的首長卡片列 */
export function profileList(ctx, { heading = 'h3' } = {}) {
  const list = leadershipProfiles(ctx.site);
  return list.length ? html`<ul class="c-profile-list">${list.map((p) => profileCard(ctx, p, { heading }))}</ul>` : html`<p class="muted">${ctx.t('profile.none')}</p>`;
}

function renderProfile(ctx, item, trail) {
  const { t } = ctx;
  const pr = item.profile; const ph = photoOf(ctx, item);
  const body = L(ctx, item, 'bodyMarkdown') ?? item.bodyMarkdown ?? '';
  const langStatus = item.languages?.[ctx.lang]?.status;
  const others = leadershipProfiles(ctx.site).filter((p) => p.id !== item.id);
  const idx = leadershipIndex(ctx.site);
  const src = (item.verification?.sources ?? []).find((s) => s.official) ?? null;
  return html`${breadcrumb(ctx, trail)}
<article class="c-article c-article--page c-profile">
  <header class="c-pagehead c-profile__head">
    <figure class="c-profile__figure${ph.placeholder ? ' c-profile__figure--placeholder' : ''}"><img class="c-profile__photo" src="${ph.src}" alt="${ph.alt}" width="240" height="300">${ph.placeholder ? html`<figcaption class="muted">${t('profile.photo.pending')}</figcaption>` : ''}</figure>
    <div class="c-pagehead__main">
      <p class="c-profile__role">${roleLine(ctx, pr)}</p>
      <h1 class="c-profile__name">${pName(ctx, pr)}</h1>
      ${ctx.lang === 'zh-TW' && pr.nameEn ? html`<p class="c-profile__en" lang="en">${pr.nameEn}${pr.roleTitleEn ? ` · ${pr.roleTitleEn}` : ''}</p>` : (ctx.lang !== 'zh-TW' ? html`<p class="c-profile__en" lang="zh-TW">${pr.name} · ${pr.roleTitle}</p>` : '')}
      ${pr.since ? html`<p class="c-profile__since">${t('profile.since')} <time datetime="${pr.since}">${pr.since}</time></p>` : ''}
      ${langStatus && ctx.lang !== 'zh-TW' ? html`<p>${translationBadge(ctx, langStatus === 'reviewed' ? 'reviewed' : 'machine')}</p>` : ''}
      ${provenance(ctx, item, { showAi: false })}${alerts(ctx, item)}
    </div>
  </header>
  <div class="c-prose c-prose--page c-profile__body">${raw(md(body))}</div>
  <p class="muted c-profile__scope">${t('profile.scope')}${src ? html` <a href="${src.url}" rel="external noopener" lang="zh-TW">${t('profile.official')}</a>` : ''}</p>
  ${others.length ? html`<nav class="c-block c-profile__others" aria-labelledby="h-others"><h2 id="h-others">${t('profile.others')}</h2><ul class="c-profile-list c-profile-list--compact">${others.map((p) => profileCard(ctx, p, { heading: 'span' }))}</ul>${idx ? html`<p><a href="${ctx.url(standalonePath(idx))}">← ${L(ctx, idx, 'title')}</a></p>` : ''}</nav>` : ''}
  ${feedback(ctx, { page: ctx.path })}
  ${pageData(ctx, item, { schema: 'ProfilePage', mdPath: `${standalonePath(item)}`.replace(/\/$/, '') + '.md' })}
</article>`;
}

export function meta(ctx, { item }) {
  const title = item.profile ? `${roleLine(ctx, item.profile)} ${pName(ctx, item.profile)}` : L(ctx, item, 'title');
  const ld = ldFor(ctx, item, [{ label: title }]);
  if (item.profile) {
    const pr = item.profile;
    ld.push({ '@context': 'https://schema.org', '@type': 'ProfilePage', name: title, mainEntity: { '@type': 'Person', name: pr.name, alternateName: pr.nameEn, jobTitle: ctx.lang === 'zh-TW' ? pr.roleTitle : (pr.roleTitleEn ?? pr.roleTitle), worksFor: { '@type': 'GovernmentOrganization', name: ctx.t('site.name') } } });
  }
  return { title, description: L(ctx, item, 'summary'), item, jsonLd: ld };
}

export function render(ctx, { item }) {
  const { lang } = ctx;
  const body = L(ctx, item, 'bodyMarkdown') ?? item.bodyMarkdown ?? '';
  const langStatus = item.languages?.[lang]?.status;
  const intl = isIntlPage(item) ? intlTopic(ctx.site) : null;
  const idx = item.profile ? leadershipIndex(ctx.site) : null;
  const trail = item.profile ? [{ label: ctx.t('footer.about'), href: '/about/' }, ...(idx ? [{ label: L(ctx, idx, 'title'), href: standalonePath(idx) }] : []), { label: `${roleLine(ctx, item.profile)} ${pName(ctx, item.profile)}` }]
    : String(item.slug).startsWith('about/') ? [{ label: ctx.t('footer.about'), href: '/about/' }, { label: L(ctx, item, 'title') }]
    : intl ? [{ label: L(ctx, intl, 'title') ?? ctx.t('international.title'), href: '/international/' }, { label: L(ctx, item, 'title') }]
      : [{ label: L(ctx, item, 'title') }];
  if (item.profile) return renderProfile(ctx, item, trail);
  return html`${breadcrumb(ctx, trail)}
<article class="c-article c-article--page">
  <header class="c-pagehead"><div class="c-pagehead__main"><h1>${L(ctx, item, 'title')}</h1>
    ${L(ctx, item, 'summary') ? html`<p class="lead">${L(ctx, item, 'summary')}</p>` : ''}
    ${item.sourceLang && item.sourceLang !== 'zh-TW' ? authorityNote(ctx, item) : (langStatus && lang !== 'zh-TW' ? html`<p>${translationBadge(ctx, langStatus === 'reviewed' ? 'reviewed' : 'machine')}</p>` : '')}
    ${provenance(ctx, item, { showAi: false })}${alerts(ctx, item)}</div></header>
  ${intl ? seriesNav(ctx, item) : ''}
  <div class="c-prose c-prose--page">${raw(md(body))}</div>
  ${item.profileIndex ? html`<section class="c-block" id="leaders" aria-labelledby="h-leaders"><h2 id="h-leaders">${ctx.t('profile.index.h2')}</h2>${profileList(ctx)}<p class="muted c-profile__scope">${ctx.t('profile.scope')}</p></section>` : ''}
  ${intl ? seriesPager(ctx, item) : ''}
  ${feedback(ctx, { page: ctx.path })}
  ${pageData(ctx, item, { schema: 'WebPage', mdPath: `${standalonePath(item) ?? itemPath(item)}`.replace(/\/$/, '') + '.md' })}
</article>`;
}

export function markdown(ctx, { item }) {
  const lines = [`# ${L(ctx, item, 'title')}`, '', `> 權責單位：${ctx.site.unitById.get(item.owner)?.name ?? item.owner} · 最後審閱：${item.reviewedAt} · 下次審閱：${item.gov?.nextReviewAt ?? ''} · 授權：${item.license} · ID：${item.id}`];
  for (const a of item.gov?.annotations ?? []) lines.push(`> ⚠ ${a.text}`);
  if (item.profile) { const pr = item.profile; lines.push('', `**${roleLine(ctx, pr)}　${pName(ctx, pr)}**${pr.nameEn && ctx.lang === 'zh-TW' ? `（${pr.nameEn}）` : ''}${pr.since ? ` · ${ctx.t('profile.since')} ${pr.since}` : ''}`); }
  lines.push('', L(ctx, item, 'bodyMarkdown') ?? item.bodyMarkdown ?? '');
  if (item.profileIndex) { lines.push('', `## ${ctx.t('profile.index.h2')}`, ''); for (const p of leadershipProfiles(ctx.site)) lines.push(`- [${roleLine(ctx, p.profile)} ${pName(ctx, p.profile)}](${standalonePath(p)})`); }
  if (item.profile || item.profileIndex) lines.push('', `> ${ctx.t('profile.scope')}`);
  return lines.join('\n') + '\n';
}

export function pages(site) {
  const out = [];
  for (const p of site.collections.pages ?? []) {
    const path = standalonePath(p);
    if (!path || p.status !== 'published') continue;
    for (const L_ of site.config.langs) if (langAvailable(site, p, L_.code)) out.push({ path, lang: L_.code, props: { item: p }, md: true });
  }
  return out;
}
