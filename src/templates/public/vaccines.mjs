// 疫苗：索引（公費對象速查）與每種疫苗詳頁（公費對象表、時程、注意事項、接種地點）。
import { html, raw } from '../../../scripts/lib/render.mjs';
import { md } from '../../../scripts/lib/markdown.mjs';
import { langAvailable } from '../../../scripts/lib/pages.mjs';
import { ldFor, pageHead, breadcrumb, provenance, alerts, pageData, scopeTags, feedback, askBox, sectionHead, hrefFor, isFallbackLink, L, publishedOf, byDateDesc, dated, diseasePage, sourceCard, unitName, translationBadge, pill, itemPath, vaxmapButton, vaxmapLinkForVaccine, VAXMAP_GROUP_OF, multilingualScheduleCard } from './_partials.mjs';
import { currentDoc } from './disease.mjs';
import { reviewedText, zhText } from './_listing.mjs';
import { langSpan } from './_partials.mjs';

const trailOf = (ctx, item) => [{ label: ctx.t('nav.vaccines'), href: '/vaccines/' }, { label: L(ctx, item, 'title') }];

export function meta(ctx, props = {}) {
  if (props.item) return { title: L(ctx, props.item, 'title'), description: L(ctx, props.item, 'summary'), item: props.item, jsonLd: ldFor(ctx, props.item, trailOf(ctx, props.item)) };
  return { title: ctx.t('nav.vaccines'), description: ctx.t('vaccines.desc'), jsonLd: ldFor(ctx, null, [{ label: ctx.t('nav.vaccines') }]) };
}

function fundedTable(ctx, v) {
  const { t, fmtDate } = ctx;
  const f = v.publicFunded ?? [];
  if (!f.length) return html`<p class="muted">${t('vaccines.nofunded')}</p>`;
  return html`<div class="c-tablewrap" role="region" tabindex="0" aria-label="${t('a11y.scrollTable')}"><table class="c-table"><caption class="sr-only">${t('vaccines.funded')}</caption><thead><tr><th scope="col">${t('vaccines.group')}</th><th scope="col">${t('vaccines.schedule')}</th><th scope="col">${t('vaccines.period')}</th><th scope="col">${t('vaccines.note')}</th></tr></thead><tbody>
    ${f.map((r) => html`<tr><th scope="row">${zhText(ctx, r.group)}</th><td>${zhText(ctx, r.schedule)}</td><td>${r.startAt ? html`${fmtDate(r.startAt)}${r.endAt ? ` – ${fmtDate(r.endAt)}` : ''}` : '—'}</td><td>${zhText(ctx, r.note ?? '')}</td></tr>`)}</tbody></table></div>`;
}

/**
 * 預防接種專區導覽（第三十六輪）：對應疾管署官網「預防接種」分類下不只是疫苗本身的內容——受害救濟、工作指引、疫苗基金、
 * 法規與委員會、接種單位、統計——每一塊指到新站已有或新建的入口。對照表與理由見 docs/immunization-ia.md。
 * 連結只指向站內既有路由或已登錄的內容（build 的站內連結檢查會擋掉不存在的）。
 */
const HUB_GROUPS = ['schedule', 'where', 'injury', 'fund', 'pro', 'law', 'stats'];

/**
 * 第四十七輪：專區導覽的連結抽成純資料，/vaccines/ 的 immunizationHub 與主選單「疫苗」小面板（_nav-panels.mjs）都從這裡取，兩邊同步。
 * 回傳 [{ group, key, href, label, ext, pending, fallback }]；找不到已發布內容的那一行就不輸出。fallback＝本語言沒有版本、連到中文頁（hub 照列，主選單面板不列）。
 */
export function immunizationLinks(ctx) {
  const { site, t, url } = ctx;
  const col = (n) => site?.collections?.[n] ?? [];
  const svc = (slug) => col('services').find((s) => s.slug === slug && s.status === 'published');
  const top = (slug) => col('topics').find((s) => s.slug === slug && s.status === 'published');
  const pg = (slug) => col('pages').find((s) => s.slug === slug && s.status === 'published');
  const A = (group, key, item, label) => (item ? { group, key, href: hrefFor(ctx, item), label: label ?? L(ctx, item, 'title'), ext: false, pending: item.verification?.status === 'pending', fallback: isFallbackLink(ctx, item) } : null);
  const R = (group, key, path, label, ext = false) => ({ group, key, href: ext ? path : url(path, { noLang: path.startsWith('/v1/') }), label, ext, pending: false, fallback: false });
  const docs = col('documents').filter((d) => d.isCurrent && d.status === 'published' && (d.vaccines?.length || /預防接種|疫苗/.test(d.title))).length;
  return [
    R('schedule', 'schedule', '/vaccines/schedule/', t('vxs.entry.t')),
    R('schedule', 'bygroup', '/tasks/vaccines/', t('vaccines.hub.bygroup')),
    R('schedule', 'funded', '/vaccines/#vx-funded', t('vaccines.funded.all')),
    // 外部疫苗地圖網址在 site.config.vaxmapUrl；最小化的 site（單元測試）沒有設定就不輸出
    site?.config?.vaxmapUrl ? R('where', 'vaxmap', vaxmapLinkForVaccine(ctx, { id: 'vaccine.influenza' }), t('vaccines.where.cta'), true) : null,
    A('where', 'record', svc('vaccination-record-reissue')),
    R('where', 'clinic', '/travel/', t('travel.country.clinic')),
    A('injury', 'injury', svc('vaccine-injury-compensation')),
    A('injury', 'committee', pg('vaccines/committees'), t('vaccines.hub.committee')),
    A('fund', 'fund-topic', top('vaccine-fund-donation')),
    A('fund', 'fund-service', svc('vaccine-fund-donation')),
    R('pro', 'docs', '/documents/', `${t('vaccines.hub.docs')}${docs ? `（${docs}）` : ''}`),
    R('pro', 'pro', '/pro/', t('vaccines.hub.pro')),
    R('law', 'law', '/policy/legal/', t('vaccines.hub.law')),
    A('law', 'committees', pg('vaccines/committees')),
    R('stats', 'stats', '/data/', t('vaccines.hub.stats')),
    R('stats', 'api', '/v1/immunization-schedule.json', t('vxs.api')),
  ].filter(Boolean);
}

function immunizationHub(ctx) {
  const { t } = ctx;
  const links = immunizationLinks(ctx);
  const li = (l) => html`<li><a href="${l.href}"${l.ext ? raw(' target="_blank" rel="noopener"') : ''}>${l.label}${l.ext ? ' ↗' : ''}</a>${l.pending ? html` <span class="c-pill c-pill--warn">${t('vxs.unverified.badge')}</span>` : ''}</li>`;
  return html`<section class="c-hub vx-hub" aria-labelledby="vx-hub-h">${sectionHead(ctx, { id: 'vx-hub-h', title: t('vaccines.hub.t'), note: t('vaccines.hub.note') })}
  <div class="c-cards3 vx-hub__grid">${HUB_GROUPS.map((g) => html`<article class="c-card vx-hub__card"><h3>${t(`vaccines.hub.${g}`)}</h3><p class="muted">${t(`vaccines.hub.${g}.d`)}</p><ul class="c-linklist">${links.filter((l) => l.group === g).map(li)}</ul></article>`)}</div></section>`;
}

function index(ctx) {
  const { site, t, url } = ctx;
  const pages_ = publishedOf(site, 'vaccines');
  const mv = site.master.vaccines;
  const rows = pages_.flatMap((v) => (v.publicFunded ?? []).map((r) => ({ v, r })));
  return html`${pageHead(ctx, { trail: [{ label: t('nav.vaccines') }], h1: t('nav.vaccines'), lead: t('vaccines.lead') })}
<section class="vxs-entry" aria-labelledby="vx-map"><div><h2 id="vx-map">${t('vxs.entry.t')}</h2><p>${t('vxs.entry.d')}</p></div><a class="c-btn" href="${url('/vaccines/schedule/')}">${t('vxs.entry.cta')} →</a></section>
${multilingualScheduleCard(ctx)}
${immunizationHub(ctx)}
<section aria-labelledby="vx-list">${sectionHead(ctx, { id: 'vx-list', title: t('vaccines.list') })}
  <div class="c-cards3">${mv.map((m) => {
    const page = pages_.find((v) => v.id === m.id);
    const name = ctx.lang === 'zh-TW' ? m.name : m.nameEn;
    const dis = (m.diseases ?? []).map((d) => diseasePage(ctx, d)).filter(Boolean);
    // 第四十九輪：一級內容只認 reviewed 的譯文；本語言沒有時卡片標題退英文名（nameEn），摘要退 reviewed 英文，再沒有才是中文並標 lang="zh-TW"
    const fb = page && isFallbackLink(ctx, page);
    const ti = page ? reviewedText(ctx, page, 'title') : null;
    const su = page ? reviewedText(ctx, page, 'summary') : null;
    const shownName = fb && ctx.lang !== 'zh-TW' && m.nameEn ? { text: m.nameEn, lang: 'en' } : { text: page ? (ti.text ?? name) : name, lang: page ? ti.lang : ctx.lang };
    return html`<article class="c-card"><h3>${page ? html`<a href="${hrefFor(ctx, page)}"${fb ? raw(` hreflang="${page.sourceLang ?? 'zh-TW'}"`) : ''}>${langSpan(ctx, shownName)}</a>` : name}</h3><p class="muted" lang="en">${m.nameEn}</p>
      ${page ? html`<p>${langSpan(ctx, su)}</p><p class="muted">${t('prov.reviewed')} ${ctx.fmtDate(page.reviewedAt)}</p>` : html`<p class="muted">${t('vaccines.nopage')}</p><a href="${url('/ask/')}?q=${encodeURIComponent(m.name)}">${t('diseases.askit')} →</a>`}
      ${dis.length ? html`<p class="c-linkrow">${dis.map((d) => html`<a href="${hrefFor(ctx, d)}">${L(ctx, d, 'title')}</a> `)}</p>` : ''}
      ${page && fb ? translationBadge(ctx, 'none') : ''}</article>`;
  })}</div></section>
${rows.length ? html`<section aria-labelledby="vx-funded">${sectionHead(ctx, { id: 'vx-funded', title: t('vaccines.funded.all') })}<div class="c-tablewrap" role="region" tabindex="0" aria-label="${t('a11y.scrollTable')}"><table class="c-table"><thead><tr><th scope="col">${t('nav.vaccines')}</th><th scope="col">${t('vaccines.group')}</th><th scope="col">${t('vaccines.schedule')}</th><th scope="col">${t('vaccines.note')}</th></tr></thead><tbody>${rows.filter(({ v }, i) => !(ctx.lang !== 'zh-TW' && isFallbackLink(ctx, v) && rows.findIndex((x) => x.v === v) !== i)).map(({ v, r }) => {
  // 第四十九輪：公費對象列是一級內容、只有中文；本語言沒有 reviewed 版本的疫苗，整列收成一格「僅有中文」連結，有版本的疫苗其中文儲存格標 lang="zh-TW"
  const fb = isFallbackLink(ctx, v);
  const ti = reviewedText(ctx, v, 'title');
  const nm = fb && ctx.lang !== 'zh-TW' ? { text: mv.find((m) => m.id === v.id)?.nameEn ?? ti.text, lang: mv.find((m) => m.id === v.id)?.nameEn ? 'en' : ti.lang } : ti;
  return fb && ctx.lang !== 'zh-TW'
    ? html`<tr><th scope="row"><a href="${hrefFor(ctx, v)}" hreflang="${v.sourceLang ?? 'zh-TW'}">${langSpan(ctx, nm)}</a></th><td colspan="3"><span class="c-zhonly">${t('i18n.zhOnly')}</span> <a href="${hrefFor(ctx, v)}" hreflang="${v.sourceLang ?? 'zh-TW'}">${t('i18n.zhOnly.go')}</a></td></tr>`
    : html`<tr><th scope="row"><a href="${hrefFor(ctx, v)}">${langSpan(ctx, ti)}</a></th><td>${zhText(ctx, r.group)}</td><td>${zhText(ctx, r.schedule)}</td><td>${zhText(ctx, r.note ?? '')}</td></tr>`;
})}</tbody></table></div></section>` : ''}
<section class="c-ask-inline">${askBox(ctx, { id: 'vq', size: 'md', task: 'vaccines', placeholder: t('vaccines.ask.ph') })}</section>
${feedback(ctx, { page: ctx.path })}`;
}

function detail(ctx, v) {
  const { site, t, url, fmtDate } = ctx;
  const dis = (v.diseases ?? []).map((d) => diseasePage(ctx, d)).filter(Boolean);
  const news = site.collections.news.filter((n) => n.status === 'published' && n.vaccines?.includes(v.id)).sort(byDateDesc).slice(0, 4);
  const docs = site.collections.documents.filter((d) => d.isCurrent && d.status === 'published' && d.vaccines?.includes(v.id));
  const title = L(ctx, v, 'title');
  const langStatus = v.languages?.[ctx.lang]?.status;
  return html`${breadcrumb(ctx, trailOf(ctx, v))}
<article class="c-vaccine">
  <header class="c-pagehead"><div class="c-pagehead__main">
    <h1>${title} <small class="c-disease__en" lang="en">${v.nameEn}</small></h1>
    <p class="lead">${L(ctx, v, 'summary')}</p>
    ${scopeTags(ctx, v)}
    ${langStatus && ctx.lang !== 'zh-TW' ? html`<p>${translationBadge(ctx, langStatus === 'reviewed' ? 'reviewed' : 'machine')}</p>` : ''}
    ${provenance(ctx, v)}${alerts(ctx, v)}
  </div></header>
  <div class="c-askband"><div class="c-askband__t">${t('vaccines.ask', { name: title })}</div>${askBox(ctx, { id: 'vq', size: 'md', vaccine: v.id, placeholder: t('vaccines.ask.ph') })}<p class="c-askband__note">${t('disease.ask.note')}</p></div>
  <div class="c-cols c-cols--2">
    <div class="c-cols__main">
      <section class="c-block" id="funded"><h2>${t('vaccines.funded')}</h2>${fundedTable(ctx, v)}${site.master.immunizationSchedule?.some((i) => i.vaccine === v.id) ? html`<p class="c-linkrow"><a href="${url('/vaccines/schedule/')}#vaccine=${v.id}">${t('vxs.link.map')} →</a></p>` : ''}</section>
      ${v.bodyMarkdown ? html`<section class="c-block" id="schedule"><h2>${t('vaccines.schedule.t')}</h2>${raw(md(L(ctx, v, 'bodyMarkdown')))}</section>` : ''}
      ${v.precautions ? html`<section class="c-block" id="precautions"><h2>${t('vaccines.precautions')}</h2><div class="c-warning">${raw(md(L(ctx, v, 'precautions')))}</div></section>` : ''}
      <section class="c-block" id="where"><h2>${t('vaccines.where')}</h2>
        <p>${t('vaccines.where.d')}</p>
        <p class="c-linkrow">${v.whereUrl ? (VAXMAP_GROUP_OF[v.id] ? vaxmapButton(ctx, { group: VAXMAP_GROUP_OF[v.id] }) : vaxmapButton(ctx, { info: true, anchor: 'where' })) : ''} <a class="c-btn c-btn--ghost" href="${url('/travel/')}">${t('travel.country.clinic')}</a></p>
        ${v.whereUrl ? sourceCard(ctx, { title: t('source.card'), canonicalUrl: vaxmapLinkForVaccine(ctx, v), owner: unitName(ctx, v.owner), license: v.license, dataDate: v.reviewedAt }) : ''}
      </section>
      ${feedback(ctx, { page: ctx.path })}
    </div>
    <aside class="c-cols__side">
      ${dis.length ? html`<section class="c-aside-card"><h2>${t('vaccines.diseases')}</h2><ul class="c-linklist">${dis.map((d) => html`<li><a href="${hrefFor(ctx, d)}">${L(ctx, d, 'title')}</a></li>`)}</ul></section>` : ''}
      <section class="c-aside-card"><h2>${t('disease.news')}</h2>${news.length ? html`<ul class="c-newslist c-newslist--tight">${news.map((n) => dated(ctx, n, { type: false }))}</ul>` : html`<p class="muted">${t('none')}</p>`}</section>
      ${docs.length ? html`<section class="c-aside-card"><h2>${t('disease.docs')}</h2><ul class="c-doclist">${docs.map((d) => html`<li><a href="${hrefFor(ctx, d)}">${L(ctx, d, 'title')}</a><br><span class="muted">${d.version} · ${fmtDate(d.effectiveAt)}</span></li>`)}</ul></section>` : ''}
      ${pageData(ctx, v, { schema: 'Drug', api: '/v1/vaccines.json', mdPath: `${itemPath(v).replace(/\/$/, '')}.md` })}
    </aside>
  </div>
</article>`;
}

export function render(ctx, props = {}) { return props.item ? detail(ctx, props.item) : index(ctx); }

export function markdown(ctx, { item }) {
  const lines = [`# ${L(ctx, item, 'title')}（${item.nameEn}）`, '', `> 權責單位：${unitName(ctx, item.owner)} · 最後審閱：${item.reviewedAt} · 下次審閱：${item.gov?.nextReviewAt ?? ''} · 授權：${item.license} · ID：${item.id}`];
  for (const a of item.gov?.annotations ?? []) lines.push(`> ⚠ ${a.text}`);
  lines.push('', L(ctx, item, 'summary'), '', '## 公費對象');
  for (const r of item.publicFunded ?? []) lines.push(`- ${r.group}：${r.schedule}${r.note ? `（${r.note}）` : ''}`);
  if (item.bodyMarkdown) lines.push('', '## 時程', '', L(ctx, item, 'bodyMarkdown'));
  if (item.precautions) lines.push('', '## 注意事項', '', L(ctx, item, 'precautions'));
  if (item.whereUrl) lines.push('', `接種地點查詢（疫苗及流感藥劑地圖 vaxmap）：${vaxmapLinkForVaccine(ctx, item)}`);
  return lines.join('\n') + '\n';
}

export function pages(site) {
  const out = [{ path: '/vaccines/', lang: '*', props: {} }];
  for (const L_ of site.config.langs) for (const v of site.collections.vaccines) if (v.status === 'published' && langAvailable(site, v, L_.code)) out.push({ path: `/vaccines/${v.slug}/`, lang: L_.code, props: { item: v }, md: true });
  return out;
}
void currentDoc; void pill;
