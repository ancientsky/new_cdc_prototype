// 網站導覽：列出所有路由（給人看的 sitemap）。
import { html } from '../../../scripts/lib/render.mjs';
import { config } from '../../../site.config.mjs';
import { ldFor, pageHead, publishedOf, PAGE_PATHS, slugOf } from './_partials.mjs';
import { listEntry, entryLink, splitByLang } from './_listing.mjs';

export function meta(ctx) { return { title: ctx.t('sitemap'), description: ctx.t('sitemap.desc'), jsonLd: ldFor(ctx, null, [{ label: ctx.t('sitemap') }]) }; }

export function render(ctx) {
  const { site, t, url } = ctx;
  const li = (href, text, sub = '') => html`<li><a href="${href}">${text}</a>${sub ? html` <span class="muted">${sub}</span>` : ''}</li>`;
  const group = (title, items) => (items.length ? html`<section class="c-sitemap__g"><h2>${title}</h2><ul class="c-linklist">${items}</ul></section>` : '');
  // 第四十九輪：內容類的組（疾病、新聞、FAQ…）依「頁面語言／英文有標題」與「只有中文」分開列。
  // 為什麼：外語網站導覽原本把數百筆中文標題當成頁面語言印出（th 約 37% 漢字）；現在有譯文的用譯文（沒有就英文，並連到英文頁），
  // 只有中文的收進摺疊區，區塊標 lang="zh-TW"，讀者知道點進去是中文、螢幕閱讀器也會切換語音。zh-TW 頁全部照舊直接列。
  const contentGroup = (title, items, { field = 'title', fallbackField = null, sub = () => '' } = {}) => {
    const entries = items.map((it) => listEntry(ctx, it, { field, fallbackField }));
    const { native, zhOnly } = splitByLang(ctx, entries);
    const row = (e) => { const s = sub(e.item, e); return html`<li>${entryLink(ctx, e)}${s ? html` <span class="muted">${s}</span>` : ''}</li>`; };
    if (!entries.length) return '';
    return html`<section class="c-sitemap__g"><h2>${title}</h2>${native.length ? html`<ul class="c-linklist">${native.map(row)}</ul>` : ''}${zhOnly.length
      ? html`<details class="c-sitemap__zh"><summary>${t('sitemap.zhonly', { n: zhOnly.length })}</summary><ul class="c-linklist" lang="zh-TW">${zhOnly.map(row)}</ul></details>` : ''}</section>`;
  };
  const docs = site.collections.documents.filter((d) => d.status === 'published');
  return html`${pageHead(ctx, { trail: [{ label: t('sitemap') }], h1: t('sitemap'), lead: t('sitemap.lead') })}
<div class="c-sitemap">
  ${group(t('sitemap.main'), [
    li(url('/'), t('tab.home')), li(url('/ask/'), t('ask.title')), li(url('/search/'), t('search.title')), li(url('/situation/'), t('nav.situation')), li(url('/diseases/'), t('nav.diseases')), li(url('/vaccines/'), t('nav.vaccines')),
    li(url('/travel/'), t('nav.travel')), li(url('/factcheck/'), t('nav.factcheck')), li(url('/data/'), t('nav.data')), li(url('/news/'), t('nav.news')), li(url('/faq/'), t('nav.faq')), li(url('/documents/'), t('nav.documents')),
  ])}
  ${group(t('home.tasks'), config.tasks.map((k) => li(url(`/tasks/${k.key}/`), t(`task.${k.key}.label`))))}
  ${contentGroup(t('nav.diseases'), publishedOf(site, 'diseases'), { sub: (d, e) => (d.nameEn && d.nameEn !== e.r.text ? d.nameEn : '') })}
  ${contentGroup(t('nav.vaccines'), publishedOf(site, 'vaccines'))}
  ${group(t('nav.travel'), (site.master.countries ?? []).map((c) => li(url(`/travel/${c.iso2}/`), ctx.lang === 'zh-TW' ? c.name : c.nameEn, c.iso2)))}
  ${contentGroup(t('nav.news'), publishedOf(site, 'news'), { sub: (n) => n.publishedAt })}
  ${contentGroup(t('nav.faq'), publishedOf(site, 'faq'), { field: 'question', fallbackField: 'title' })}
  ${contentGroup(t('nav.documents'), docs, { sub: (d) => `${d.version}${d.isCurrent ? '' : ` · ${t('documents.expired')}`}` })}
  ${group(t('home.more'), [
    li(url('/services/'), t('services.title')), li(url('/apply/'), t('apply.title')), li(url('/publications/'), t('publications.title')), li(url('/lab/'), t('lab.title')), li(url('/report/'), t('report.title')),
    li(url('/research/'), t('research.title')), li(url('/glossary/'), t('glossary.title')), li(url('/subscribe/'), t('subscribe.title')), li(url('/careers/'), t('careers.title')), li(url('/procurement/'), t('proc.title')), li(url('/notices/'), t('notices.title')), li(url('/media/'), t('media.title')), li(url('/campaigns/'), t('campaigns.title')), li(url('/contact/'), t('contact.title')), li(url('/about/'), t('footer.about')),
  ])}
  ${contentGroup(t('home.media'), publishedOf(site, 'media'), { sub: (d) => d.basedOnVersionLabel ?? '' })}
  ${contentGroup(t('home.topics'), publishedOf(site, 'topics'))}
  ${contentGroup(t('apply.title'), publishedOf(site, 'services'))}
  ${contentGroup(t('publications.title'), publishedOf(site, 'publications'))}
  ${contentGroup(t('lab.title'), publishedOf(site, 'labtests'))}
  ${contentGroup(t('research.title'), publishedOf(site, 'research'), { sub: (d) => String(d.year) })}
  ${group(t('sitemap.policy'), [
    ...Object.entries(PAGE_PATHS).filter(([slug]) => slug !== 'about').map(([slug, p]) => li(url(p), t(`page.${slug}`))), li(url('/transparency/'), t('footer.transparency')), li(url('/guide/'), t('footer.guide')),
  ])}
  ${group(t('sitemap.pro'), [li(url('/pro/'), t('nav.pro')), li(url('/research-media/'), t('nav.research')), li(url('/developers/'), t('footer.api')), li(url('/openapi.json', { noLang: true }), 'openapi.json'), li(url('/llms.txt', { noLang: true }), 'llms.txt'), li(url('/admin/', { noLang: true }), t('footer.admin'))])}
</div>`;
}

export function pages() { return [{ path: '/sitemap-page/', lang: '*', props: {} }]; }
void slugOf;
