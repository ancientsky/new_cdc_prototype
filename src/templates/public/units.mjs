// /about/units/{slug}/：單位介紹頁（第十八輪）。由 content/master/units.json 自動產生：簡介、主要業務、該單位在本站維護的內容、聯絡。
// 全站每個「權責單位」欄位（_partials.unitLink）都連到這裡，讀者點一下就知道這一頁是誰在維護、該單位還管哪些事。
// 只出 zh-TW 與 en（主檔只有中英文簡介）；其他語言的頁面以 hreflang 連到英文版。
import { html } from '../../../scripts/lib/render.mjs';
import { pageHead, feedback, breadcrumbLd, hrefFor, isFallbackLink, L, unitPath, UNIT_PAGE_LANGS, ownerStats, pill } from './_partials.mjs';

const CONTENT_TYPES = ['disease', 'vaccine', 'faq', 'news', 'letter', 'clarification', 'document', 'dataset', 'media', 'topic', 'service', 'publication', 'labtest', 'research', 'job', 'tender', 'banner', 'page'];
const MAX_PER_TYPE = 8;

const uName = (ctx, u) => (ctx.lang === 'zh-TW' ? u.name : (u.nameEn ?? u.name));
const uIntro = (ctx, u) => (ctx.lang === 'zh-TW' ? u.intro : (u.introEn ?? u.intro));

/** 該單位在本站維護的已發布內容，依型別分組（owner 或 hiringUnit 為該單位） */
export function unitContent(site, unitId) {
  const groups = new Map();
  for (const i of site.all ?? []) {
    if (i.status !== 'published') continue;
    if (i.owner !== unitId && i.hiringUnit !== unitId) continue;
    if (!groups.has(i.type)) groups.set(i.type, []);
    groups.get(i.type).push(i);
  }
  return CONTENT_TYPES.filter((t) => groups.has(t)).map((t) => ({ type: t, items: groups.get(t).sort((a, b) => String(b.reviewedAt ?? '').localeCompare(String(a.reviewedAt ?? ''))) }));
}

export function meta(ctx, { unit }) {
  const name = uName(ctx, unit);
  const trail = [{ label: ctx.t('footer.about'), href: '/about/' }, { label: ctx.t('unit.page.trail'), href: '/about/#org' }, { label: name }];
  return {
    title: name, description: uIntro(ctx, unit) ?? '', noindex: false,
    jsonLd: [{ '@context': 'https://schema.org', '@type': 'GovernmentOrganization', name: unit.name, alternateName: unit.nameEn, description: unit.intro, parentOrganization: { '@type': 'GovernmentOrganization', name: ctx.t('site.name') }, url: ctx.url(unitPath(unit), { absolute: true }) }, breadcrumbLd(ctx, trail)],
  };
}

export function render(ctx, { unit: u }) {
  const { t, url, site, fmtDate } = ctx;
  const st = ownerStats(site, u.id);
  const groups = unitContent(site, u.id);
  const trail = [{ label: t('footer.about'), href: '/about/' }, { label: t('unit.page.trail'), href: '/about/#org' }, { label: uName(ctx, u) }];
  const tags = html`${pill(t(`about.org.${u.kind}`), 'neutral')}${u.publishes === false ? pill(t('about.org.note').split('：')[0], 'neutral') : ''}`;
  return html`${pageHead(ctx, { trail, h1: uName(ctx, u), lead: ctx.lang === 'zh-TW' && u.nameEn ? html`<span lang="en">${u.nameEn}</span>` : (ctx.lang !== 'zh-TW' ? html`<span lang="zh-TW">${u.name}</span>` : ''), tags })}
<div class="c-unitpage">
<article class="c-unitpage__main">
  <section class="c-block" id="intro" aria-labelledby="h-intro"><h2 id="h-intro">${t('unit.page.intro')}</h2>
    <p>${uIntro(ctx, u) ?? ''}</p>
    ${u.introVerified === false ? html`<p class="c-unitpage__unverified muted">${t('unit.page.unverified')}</p>` : ''}
  </section>
  ${u.duties?.length ? html`<section class="c-block" id="duties" aria-labelledby="h-duties"><h2 id="h-duties">${t('unit.page.duties')}</h2><ul class="c-unitpage__duties">${u.duties.map((d) => html`<li>${d}</li>`)}</ul></section>` : ''}
  <section class="c-block" id="content" aria-labelledby="h-content"><h2 id="h-content">${t('unit.page.content')}</h2>
    ${groups.length ? html`<p class="muted">${t('unit.page.stats', { content: st.content, wl: st.whitelist, latest: st.latest ? fmtDate(st.latest) : '—' })}</p>
    ${groups.map((g) => html`<h3>${t(`type.${g.type}`)} <span class="c-pill c-pill--neutral">${g.items.length}</span></h3>
      <ul class="c-linklist">${g.items.slice(0, MAX_PER_TYPE).map((i) => html`<li><a href="${hrefFor(ctx, i)}"${isFallbackLink(ctx, i) ? html` hreflang="zh-TW"` : ''}>${L(ctx, i, 'title') ?? i.title}</a>${i.reviewedAt ? html` <span class="muted">· ${t('prov.reviewed')} ${fmtDate(i.reviewedAt)}</span>` : ''}</li>`)}
      ${g.items.length > MAX_PER_TYPE ? html`<li class="muted">${t('unit.page.more', { n: g.items.length - MAX_PER_TYPE })}</li>` : ''}</ul>`)}` : html`<p class="muted">${t('unit.page.nocontent')}</p>`}
  </section>
</article>
<aside class="c-unitpage__aside">
  <section class="c-aside-card"><h2>${t('unit.page.kind')}</h2>
    <dl class="c-kv"><div><dt>${t('unit.page.kind')}</dt><dd>${t(`about.org.${u.kind}`)}</dd></div>
    ${u.stewardTitle ? html`<div><dt>${t('unit.page.steward')}</dt><dd>${u.stewardTitle}</dd></div>` : ''}
    <div><dt>ID</dt><dd><code>${u.id}</code></dd></div></dl></section>
  <section class="c-aside-card"><h2>${t('unit.page.official')}</h2>
    ${u.officialUrl ? html`<p><a href="${u.officialUrl}" rel="external noopener">${u.officialUrl}</a>${u.officialUrlVerified === false ? html` <span class="c-pill c-pill--warn">unverified</span>` : ''}</p>` : html`<p class="muted">${t('unit.page.official.pending')}</p>`}</section>
  <section class="c-aside-card"><h2>${t('unit.page.contact')}</h2><p>${t('unit.page.contact.text')}</p><p><a class="c-btn c-btn--sm c-btn--ghost" href="${url('/contact/')}">${t('contact.title')} →</a></p></section>
  <p><a href="${url('/about/')}#${u.id.replace('unit.', 'u-')}">← ${t('unit.page.back')}</a></p>
</aside>
</div>
${feedback(ctx, { page: ctx.path })}`;
}

export function markdown(ctx, { unit: u }) {
  const st = ownerStats(ctx.site, u.id);
  const lines = [`# ${u.name}${u.nameEn ? `（${u.nameEn}）` : ''}`, '', `> ID：${u.id} · 類別：${ctx.t(`about.org.${u.kind}`)}${u.stewardTitle ? ` · Steward：${u.stewardTitle}` : ''} · 負責內容 ${st.content} 項、白名單 ${st.whitelist} 項`, ''];
  if (u.intro) lines.push(u.intro, '');
  if (u.introVerified === false) lines.push('> 簡介為原型撰寫，尚待該單位確認。', '');
  if (u.duties?.length) lines.push('## 主要業務', '', ...u.duties.map((d) => `- ${d}`), '');
  const groups = unitContent(ctx.site, u.id);
  if (groups.length) { lines.push('## 在本網站負責維護的內容', ''); for (const g of groups) lines.push(`### ${ctx.t(`type.${g.type}`)}（${g.items.length}）`, '', ...g.items.map((i) => `- ${i.title}（${i.id}）`), ''); }
  lines.push('## 官網介紹頁', '', u.officialUrl ? `${u.officialUrl}${u.officialUrlVerified === false ? '（未驗證）' : ''}` : '待權責單位補上（原型開發環境無法連到 cdc.gov.tw 確認）。', '');
  return lines.join('\n');
}

export function pages(site) {
  const out = [];
  for (const u of site.master.units ?? []) for (const lang of UNIT_PAGE_LANGS) out.push({ path: unitPath(u), lang, props: { unit: u }, md: true });
  return out;
}
