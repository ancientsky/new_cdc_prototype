// /about/：署介紹 hub。使命、組織架構圖（由 master/units.json 自動產生）、六區管制中心、沿革、署長、官網改版小組、聯絡。
import { html, raw } from '../../../scripts/lib/render.mjs';
import { md } from '../../../scripts/lib/markdown.mjs';
import { langAvailable } from '../../../scripts/lib/pages.mjs';
import * as JL from '../../../scripts/lib/jsonld.mjs';
import { ldFor, pageHead, translationBadge, feedback, L, unitLink, unitPath, ownerStats, hrefFor, PAGE_PATHS } from './_partials.mjs';
import { standalonePath, profileList, leadershipIndex } from './page.mjs';
import { OFFICIAL_ORG_PAGES } from './units.mjs';
import { intlTopic } from './_international.mjs';
import { pick, langAttr, shownNote } from './_listing.mjs';

export const ORG_GROUPS = ['office', 'division', 'center', 'regional', 'staff', 'committee'];
const SECTIONS = [
  { id: 'mission', page: 'page.mission' }, { id: 'org' }, { id: 'regional', page: 'page.regional-centers' },
  { id: 'history', page: 'page.history' }, { id: 'leadership', page: 'page.leadership' }, { id: 'director', page: 'page.director' }, { id: 'team', page: 'page.about' }, { id: 'international' }, { id: 'contact', page: 'page.contact' },
];

function aboutLd(ctx) {
  try { return typeof JL.aboutOrgJsonLd === 'function' ? [].concat(JL.aboutOrgJsonLd(ctx)) : []; } catch { return []; }
}

export function meta(ctx) {
  const item = ctx.site.byId.get('page.about') ?? null;
  return { title: ctx.t('about.title'), description: ctx.t('about.lead'), item, jsonLd: [...ldFor(ctx, item, [{ label: ctx.t('about.title') }]), ...aboutLd(ctx)] };
}

const pg = (site, id) => { const p = site.byId.get(id); return p && p.status === 'published' ? p : null; };

function provLine(ctx, p) {
  return html`<p class="c-about__prov muted">${ctx.t('prov.owner')}：${unitLink(ctx, p.owner)} · ${ctx.t('prov.reviewed')} ${ctx.fmtDate(p.reviewedAt)}</p>`;
}

/**
 * 第四十九輪：區塊的標題、摘要、本文各自依「頁面語言 → 英文 → 中文」取（pick），不再整段退回中文。
 * 為什麼：th／id／tl／vi 的 /about/ 原本把使命、沿革、署長職掌等中文本文整段印出（約 27–29% 漢字）；英文譯文已審核過，退英文比退中文對讀者有用，
 * 且包在 lang="en" 裡，螢幕閱讀器會切換語音。三者都沒有才是中文（加「僅有中文」標記與 lang="zh-TW"）。
 */
function pageSection(ctx, sec, { open = false, fallback = null } = {}) {
  const { site, t } = ctx;
  const p = pg(site, sec.page);
  if (!p) return fallback ? html`<section class="c-block" id="${sec.id}" aria-labelledby="h-${sec.id}"><h2 id="h-${sec.id}">${t(`about.s.${sec.id}`)}</h2>${fallback}</section>` : '';
  const sp = standalonePath(p);
  const title = pick(ctx, p, 'title');
  const summary = pick(ctx, p, 'summary');
  const body = pick(ctx, p, 'bodyMarkdown');
  const bodyText = body.text ?? '';
  return html`<section class="c-block" id="${sec.id}" aria-labelledby="h-${sec.id}"><h2 id="h-${sec.id}"${langAttr(ctx, title)}>${title.text ?? t(`about.s.${sec.id}`)}</h2>
  ${summary.text ? html`<p class="lead"${langAttr(ctx, summary)}>${summary.text}</p>` : ''}
  ${bodyText ? html`${shownNote(ctx, body)}${open ? html`<div class="c-prose"${langAttr(ctx, body)}>${raw(md(bodyText))}</div>` : html`<details class="c-source-card c-about__more"><summary>${t('about.expand')}</summary><div class="c-prose c-about__body"${langAttr(ctx, body)}>${raw(md(bodyText))}</div></details>`}` : ''}
  ${provLine(ctx, p)}
  ${sp ? html`<p><a href="${ctx.url(sp)}">${t('about.fullpage')} →</a></p>` : ''}
</section>`;
}

/** 第四十四輪：首長簡介區——卡片列（姓名、職稱、照片）＋連到總覽頁；沒有 page.leadership 就不出現 */
function leadershipSection(ctx) {
  const idx = leadershipIndex(ctx.site);
  if (!idx) return '';
  return html`<section class="c-block" id="leadership" aria-labelledby="h-leadership"><h2 id="h-leadership"${langAttr(ctx, pick(ctx, idx, 'title'))}>${pick(ctx, idx, 'title').text ?? ctx.t('about.s.leadership')}</h2>
  ${pick(ctx, idx, 'summary').text ? html`<p class="lead"${langAttr(ctx, pick(ctx, idx, 'summary'))}>${pick(ctx, idx, 'summary').text}</p>` : ''}
  ${profileList(ctx)}
  ${provLine(ctx, idx)}
  <p><a href="${ctx.url(standalonePath(idx))}">${ctx.t('about.fullpage')} →</a></p>
</section>`;
}

function unitCard(ctx, u) {
  const { t, lang } = ctx;
  const st = ownerStats(ctx.site, u.id);
  return html`<li class="c-org__unit c-org__unit--${u.kind}" id="${u.id.replace('unit.', 'u-')}">
  <strong class="c-org__name"><a href="${ctx.url(unitPath(u))}">${lang === 'zh-TW' ? u.name : (u.nameEn ?? u.name)}</a></strong>
  ${lang === 'zh-TW' && u.nameEn ? html`<span class="c-org__en" lang="en">${u.nameEn}</span>` : (lang !== 'zh-TW' ? html`<span class="c-org__en" lang="zh-TW">${u.name}</span>` : '')}
  ${u.stewardTitle ? html`<span class="c-org__steward">${t('about.org.steward')}：${lang === 'zh-TW' ? u.stewardTitle : (u.stewardTitleEn ?? u.stewardTitle)}</span>` : ''}
  <span class="c-org__counts"><span>${t('about.org.content')} <b>${st.content}</b></span><span>${t('about.org.wl')} <b>${st.whitelist}</b></span></span>
  ${st.latest ? html`<span class="c-org__latest">${t('about.org.latest')} ${ctx.fmtDate(st.latest)}</span>` : ''}
</li>`;
}

export function orgChart(ctx) {
  const { site, t } = ctx;
  const units = site.master.units ?? [];
  const root = units.find((u) => u.id === 'unit.director');
  const rest = units.filter((u) => u !== root);
  return html`<div class="c-org" role="group" aria-label="${t('about.s.org')}">
  ${root ? html`<ul class="c-org__root">${unitCard(ctx, root)}</ul>` : ''}
  <div class="c-org__groups">${ORG_GROUPS.map((k) => {
    const list = rest.filter((u) => u.kind === k);
    return list.length ? html`<section class="c-org__group c-org__group--${k}" aria-labelledby="org-${k}"><h3 id="org-${k}">${t(`about.org.${k}`)} <span class="c-pill c-pill--neutral">${list.length}</span></h3><ul class="c-org__units">${list.map((u) => unitCard(ctx, u))}</ul></section>` : '';
  })}</div>
  <p class="muted c-org__note">${t('about.org.note')}</p>
  <p class="c-org__official">${t('about.org.official')}${OFFICIAL_ORG_PAGES.map((p, i) => html`${i ? '、' : ''}<a href="${p.url}" rel="external noopener" lang="zh-TW">${t(`about.org.official.${p.key}`)}</a>`)}</p>
</div>`;
}

export function render(ctx) {
  const { site, t, url, lang } = ctx;
  const about = site.byId.get('page.about');
  const regionalFallback = html`<ul class="c-linklist c-linklist--inline">${(site.master.units ?? []).filter((u) => u.kind === 'regional').map((u) => html`<li>${lang === 'zh-TW' ? u.name : (u.nameEn ?? u.name)}</li>`)}</ul>`;
  const langStatus = about?.languages?.[lang]?.status;
  const intl = intlTopic(site);
  return html`${pageHead(ctx, { trail: [{ label: t('about.title') }], h1: t('about.title'), lead: t('about.lead') })}
${langStatus && lang !== 'zh-TW' ? html`<p>${translationBadge(ctx, langStatus === 'reviewed' ? 'reviewed' : 'machine')}</p>` : ''}
<nav class="c-chips-wrap" aria-label="${t('about.toc')}"><ul class="c-chips c-chips--wrap">${SECTIONS.filter((s) => s.id !== 'international' || intl).map((s) => html`<li><a class="c-chip" href="#${s.id}">${s.id === 'international' ? t('international.title') : t(`about.s.${s.id}`)}</a></li>`)}</ul></nav>
${pageSection(ctx, SECTIONS[0], { open: true, fallback: html`<p>${t('about.mission.fallback')}</p>` })}
<section class="c-block" id="org" aria-labelledby="h-org"><h2 id="h-org">${t('about.s.org')}</h2><p class="muted">${t('about.org.lead')}</p>${orgChart(ctx)}</section>
${pageSection(ctx, SECTIONS[2], { fallback: regionalFallback })}
${pageSection(ctx, SECTIONS[3])}
${leadershipSection(ctx)}
${pageSection(ctx, SECTIONS[5])}
${about ? pageSection(ctx, SECTIONS[6], { open: true }) : ''}
${intl ? html`<section class="c-block" id="international" aria-labelledby="h-international"><h2 id="h-international">${t('international.title')}</h2>
  <p${langAttr(ctx, pick(ctx, intl, 'summary'))}>${pick(ctx, intl, 'summary').text ?? t('international.lead')}</p>
  <p><a class="c-btn c-btn--ghost c-btn--sm" href="${url('/international/')}">${t('international.title')} →</a></p></section>` : ''}
<section class="c-block" id="contact" aria-labelledby="h-contact"><h2 id="h-contact">${t('about.s.contact')}</h2>
  <p>${t('about.contact')} <a class="c-btn c-btn--sm" href="${url('/contact/')}">${t('contact.title')} →</a></p>
  <ul class="c-linklist c-linklist--inline"><li><a href="${url('/careers/')}">${t('careers.title')}</a></li><li><a href="${url('/procurement/')}">${t('proc.title')}</a></li><li><a href="${url('/policy/privacy/')}">${t('footer.privacy')}</a></li><li><a href="${url('/policy/ai/')}">${t('footer.ai')}</a></li><li><a href="${url('/policy/open-data/')}">${t('footer.license')}</a></li><li><a href="${url('/accessibility/')}">${t('footer.a11y')}</a></li></ul></section>
${feedback(ctx, { page: ctx.path })}`;
}

export function markdown(ctx) {
  const { site } = ctx;
  const lines = [`# ${ctx.t('about.title')}`, '', `> ${ctx.t('about.lead')}`];
  for (const s of SECTIONS) {
    const p = s.page ? pg(site, s.page) : null;
    if (p) lines.push('', `## ${L(ctx, p, 'title')}`, '', L(ctx, p, 'bodyMarkdown') ?? p.bodyMarkdown ?? '');
    if (s.id === 'org') {
      lines.push('', `## ${ctx.t('about.s.org')}`, '');
      for (const k of ORG_GROUPS) {
        const list = (site.master.units ?? []).filter((u) => u.kind === k);
        if (!list.length) continue;
        lines.push(`### ${ctx.t(`about.org.${k}`)}`, '', ...list.map((u) => { const st = ownerStats(site, u.id); return `- ${u.name}（${u.nameEn ?? ''}）${u.stewardTitle ? `：${u.stewardTitle}` : ''}；負責內容 ${st.content} 項、白名單 ${st.whitelist} 項`; }), '');
      }
    }
  }
  return lines.join('\n') + '\n';
}

export function pages(site) {
  return site.config.langs.map((l) => ({ path: '/about/', lang: l.code, props: {}, md: l.code === 'zh-TW' || l.code === 'en' }));
}
void langAvailable; void hrefFor; void PAGE_PATHS;
