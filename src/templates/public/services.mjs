// /services/：應用專區（八圖示入口），給專業人員與研究／媒體；同一列元件放在 /pro/。民眾首頁只放「更多服務」一行文字連結。
import { html } from '../../../scripts/lib/render.mjs';
import { ldFor, pageHead, servicesGrid, publishedOf, topicCard, isTopicEnded } from './_partials.mjs';

export function meta(ctx) { return { title: ctx.t('services.title'), description: ctx.t('services.lead'), jsonLd: ldFor(ctx, null, [{ label: ctx.t('services.title') }]) }; }

export function render(ctx) {
  const { site, t, url } = ctx;
  const topics = publishedOf(site, 'topics');
  const live = topics.filter((x) => !isTopicEnded(site, x)).sort((a, b) => (a.priority ?? 9) - (b.priority ?? 9));
  const ended = topics.filter((x) => isTopicEnded(site, x));
  return html`${pageHead(ctx, { trail: [{ label: t('services.title') }], h1: t('services.title'), lead: t('services.lead') })}
${servicesGrid(ctx)}
<p class="muted c-services__note">${t('services.note')}</p>
<section class="c-block" aria-labelledby="svc-topics"><h2 id="svc-topics">${t('home.topics')}</h2>
  ${live.length ? html`<ul class="c-topicrow">${live.map((x) => topicCard(ctx, x))}</ul>` : html`<p class="c-empty">${t('none')}</p>`}
  ${ended.length ? html`<details class="c-source-card"><summary>${t('topic.endedlist', { n: ended.length })}</summary><ul class="c-topicrow">${ended.map((x) => topicCard(ctx, x))}</ul></details>` : ''}
</section>
<section class="c-block" aria-labelledby="svc-more"><h2 id="svc-more">${t('services.more')}</h2>
  <ul class="c-linklist c-linklist--inline"><li><a href="${url('/campaigns/')}">${t('campaigns.title')}</a></li><li><a href="${url('/notices/')}">${t('notices.title')}</a></li><li><a href="${url('/contact/')}">${t('contact.title')}</a></li><li><a href="${url('/about/')}">${t('footer.about')}</a></li><li><a href="${url('/developers/')}">${t('footer.api')}</a></li></ul>
</section>`;
}

export function pages() { return [{ path: '/services/', lang: '*', props: {} }]; }
