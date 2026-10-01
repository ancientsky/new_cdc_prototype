// 首頁（骨架版；Agent C 依 wireframe 第 1、2、8 頁補完）
import { html, raw } from '../../../scripts/lib/render.mjs';
import { config } from '../../../site.config.mjs';

export function meta(ctx) { return { title: null, description: `${ctx.t('site.name')}：一句話得到整理好的答案、現在的疫情、六任務入口。` }; }

export function render(ctx) {
  const { site, t, url, fmtDate } = ctx;
  const sit = site.situation;
  const news = [...site.collections.news].filter((n) => n.status === 'published').sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)).slice(0, 3);
  return html`
<section class="hero">
  <h1>${t('home.h1')}</h1>
  <form class="askbox" action="${url('/ask/')}" method="get" role="search">
    <label class="sr-only" for="q">${t('home.h1')}</label>
    <input id="q" name="q" type="search" placeholder="${t('home.placeholder')}" autocomplete="off">
    <button type="submit">${t('home.ask')}</button>
  </form>
</section>
<section class="situation" aria-labelledby="sit-h">
  <div class="section-head"><h2 id="sit-h">${t('home.situation')}</h2><span class="muted">${t('dataDate')} ${fmtDate(sit.dataDate)} · ${t('source')} ${sit.source} · 狀態由疫情中心依監測門檻發布</span><a class="more" href="${url('/situation/')}">看完整趨勢與地圖 →</a></div>
  <div class="cards cards--4">${sit.items.filter((i) => i.pinned).map((it) => {
    const d = site.diseaseMasterById.get(it.disease);
    return html`<article class="c-sit-card c-sit-card--${it.status}"><header><h3><a href="${url(`/diseases/${d.slug}/`)}">${d.name}</a></h3><span class="c-status-tag c-status-tag--${it.status}">${t(`status.${it.status}`)}</span></header><p class="c-sit-card__metric"><span aria-hidden="true">${it.trend === 'up' ? '↑' : it.trend === 'down' ? '↓' : '→'}</span> ${it.metricValue}</p><p class="muted">${it.metricLabel}${it.deltaText ? `，${it.deltaText}` : ''}</p><p>建議：${it.advice}</p></article>`;
  })}</div>
</section>
<section class="tasks" aria-labelledby="tasks-h"><h2 id="tasks-h">${t('home.tasks')}</h2>
  <div class="cards cards--3">${config.tasks.map((task) => html`<a class="c-task" href="${url(`/tasks/${task.key}/`)}"><strong>${task.label}</strong><span class="muted">${task.sub}</span></a>`)}</div>
</section>
<section class="news"><h2>${t('home.news')}</h2><ul class="newslist">${news.map((n) => html`<li><time datetime="${n.publishedAt}">${fmtDate(n.publishedAt)}</time> <a href="${url(`/news/${n.id.replace(/^news\./, '')}/`)}">${n.title}</a></li>`)}</ul></section>`;
}

export function pages() { return [{ path: '/', lang: '*', props: {} }]; }
