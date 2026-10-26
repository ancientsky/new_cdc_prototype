// 互動與遊戲 /play/（第六十二輪）：content/interactives/ 的公開頁——/play/ 專頁列出開啟中的模組，每個有頁面的模組一頁 /play/<slug>/。
// 原則：
//   - 只渲染 site.interactives.list（開關開著、在檔期內、疫情不緊急）；/play/ 專頁永遠存在（頁尾有連結），沒有模組時說明「目前沒有開啟的互動」。
//   - 沒有 JS 也能讀：測驗題與模擬回合先輸出成 <details> 純文字版，play.js 載入後才換成一題一題的互動；歷史上的今天本來就是清單。
//   - 每題、每個選項都標「依據」連回疾病頁／Q&A；歷史條目有出處、未核對者標「待確認」。
//   - 模組頁目前只有中文（pages() 不給 lang），外語頁尾的連結由 makeUrl 退回中文正本。
import { html, raw, jsonScript } from '../../../scripts/lib/render.mjs';
import { ldFor, pageHead, unitName, pill, hrefFor } from './_partials.mjs';
import { KINDS, isQuizKind, hasPage, interactiveSlug, interactivePath, interactivesAt, liveQuestions, pickOnThisDay } from '../../../scripts/lib/interactives.mjs';

/** 模組在這個語言有沒有可顯示的文字（目前只有中文正本；有 i18n[lang].title 的語言也算） */
export const moduleLangOk = (item, lang) => lang === 'zh-TW' || !!item?.i18n?.[lang]?.title;

export function pages(site) {
  const list = (site.interactives?.list ?? []).filter((i) => hasPage(i) && (i.placements ?? []).includes('play-hub'));
  return [{ path: '/play/', props: {} }, ...list.map((i) => ({ path: interactivePath(i), props: { id: i.id } }))];
}

export function meta(ctx, props = {}) {
  const { t } = ctx;
  const item = props?.id ? ctx.site.byId.get(props.id) : null;
  if (!item) return { title: t('play.title'), description: t('play.desc'), bodyClass: 'page-play', jsonLd: ldFor(ctx, null, [{ label: t('play.title') }]), pagefind: { type: 'page', audience: ['public'] } };
  return { title: item.title, description: item.summary, bodyClass: 'page-play', scripts: ['/assets/js/play.js'], item, jsonLd: ldFor(ctx, item, [{ label: t('play.title'), href: '/play/' }, { label: item.title }]), pagefind: { type: 'page', audience: ['public'] } };
}

const KIND_ICON = { 'on-this-day': '📅', 'kids-quiz': '🧼', quiz: '🧠', 'policy-sim': '🗺️', 'easter-egg': '🥚' };

/** /play/ 與首頁「互動與遊戲」共用的卡 */
export function playCard(ctx, item) {
  const { t, url } = ctx;
  return html`<li class="c-playcard">
  <a class="c-playcard__a" href="${url(interactivePath(item))}">
    <span class="c-playcard__icon" aria-hidden="true">${KIND_ICON[item.kind] ?? '🎲'}</span>
    <span class="c-playcard__body"><strong class="c-playcard__t">${item.title}</strong><span class="c-playcard__s">${item.summary}</span>
    <span class="c-playcard__meta">${KINDS[item.kind]?.label ?? item.kind} · ${t('play.owner')}：${unitName(ctx, item.owner)}</span></span>
  </a>
</li>`;
}

const demoNote = (ctx, item) => (item.note && /示範/.test(item.note) ? html`<p class="c-play__demo">${pill(ctx.t('play.demo'), 'warn')} <span class="c-play__demo-note">${item.note}</span></p>` : '');
const basedOnLink = (ctx, id) => { const it = ctx.site.byId.get(id); return it ? html`<a class="c-play__based" href="${hrefFor(ctx, it)}">${ctx.t('play.basedOn')}：${it.title}</a>` : ''; };

function hub(ctx) {
  const { t, site, url } = ctx;
  const list = interactivesAt(site, 'play-hub').filter((i) => hasPage(i) && moduleLangOk(i, ctx.lang));
  return html`${pageHead(ctx, { trail: [{ label: t('play.title') }], h1: t('play.title'), lead: t('play.lead') })}
${list.length ? html`<ul class="c-playgrid">${list.map((i) => playCard(ctx, i))}</ul>` : html`<p class="c-alert c-alert--info">目前沒有開啟中的互動模組。</p>`}
<p class="c-play__foot">互動模組是有權責、有開關的內容：每個模組由維護單位負責正確性，可在後台隨時關閉；疫情中心發布緊急警戒時全部自動隱藏。<a href="${url('/guide/')}">使用說明</a></p>`;
}

/* ───── 歷史上的今天 ───── */
const MMDD = (e) => `${String(e.month).padStart(2, '0')}-${String(e.day).padStart(2, '0')}`;
const entryLi = (ctx, e, { showDate = false } = {}) => html`<li class="c-otd__item${e.verified ? '' : ' c-otd__item--unverified'}" data-mmdd="${MMDD(e)}">
  ${showDate ? html`<span class="c-otd__date">${e.month} 月 ${e.day} 日</span>` : ''}<b class="c-otd__year">${e.year}</b>
  <span class="c-otd__text">${e.text}</span>${e.verified ? '' : html` ${pill(ctx.t('otd.unverified'), 'warn')}`}
  <small class="c-otd__src">${ctx.t('otd.source')}：${e.sourceUrl ? html`<a href="${e.sourceUrl}" rel="noopener">${e.source} ↗</a>` : e.source}${e.link ? html` · <a href="${ctx.url(e.link)}">${ctx.t('otd.more')} →</a>` : ''}</small>
</li>`;

function onThisDayPage(ctx, item) {
  const { t, site } = ctx;
  const mmdd = site.today.slice(5);
  const pick = pickOnThisDay(item.entries, mmdd);
  const byMonth = new Map();
  for (const e of [...item.entries].sort((a, b) => a.month - b.month || a.day - b.day || a.year - b.year)) { if (!byMonth.has(e.month)) byMonth.set(e.month, []); byMonth.get(e.month).push(e); }
  const unverified = item.entries.filter((e) => !e.verified).length;
  return html`<section class="c-otd c-otd--today" data-otd-today data-today="${mmdd}" aria-labelledby="otd-today-h">
  <h2 id="otd-today-h">${t('otd.title')}<span class="c-otd__todaydate" data-otd-date>${pick.exact ? '' : html` · ${t('otd.near', { date: pick.mmdd.replace('-', '/') })}`}</span></h2>
  <ul class="c-otd__list" data-otd-pick>${pick.entries.map((e) => entryLi(ctx, e, { showDate: !pick.exact }))}</ul>
</section>
${item.disclaimer ? html`<p class="c-play__disclaimer">${item.disclaimer}${unverified ? `（${unverified}／${item.entries.length} 條待確認）` : ''}</p>` : ''}
<nav class="c-otd__months" aria-label="月份"><ul>${[...byMonth.keys()].map((m) => html`<li><a href="#otd-m${m}">${m} 月</a></li>`)}</ul></nav>
${[...byMonth.entries()].map(([m, list]) => html`<section class="c-otd__month" aria-labelledby="otd-m${m}"><h2 id="otd-m${m}">${t('otd.month', { m })}</h2><ul class="c-otd__list">${list.map((e) => entryLi(ctx, e, { showDate: true }))}</ul></section>`)}`;
}

/* ───── 兒童衛教小測驗 ───── */
function quizPage(ctx, item) {
  const { t, site } = ctx;
  const qs = liveQuestions(site, item);
  const data = qs.map((q) => ({ q: q.q, choices: q.choices, answer: q.answer, explain: q.explain, emoji: q.emoji ?? '', basedOn: q.basedOn, basedOnTitle: site.byId.get(q.basedOn)?.title ?? '', basedOnHref: site.byId.get(q.basedOn) ? hrefFor(ctx, site.byId.get(q.basedOn)) : '' }));
  return html`<div class="c-quiz" data-quiz>
  ${raw(`<script type="application/json" data-quiz-data>${jsonScript(data)}</script>`)}
  <div class="c-quiz__stage" data-quiz-stage hidden></div>
  <div class="c-quiz__fallback" data-quiz-fallback>
    <p class="c-play__nojs">${t('play.nojs')}</p>
    <ol class="c-quiz__list">${qs.map((q, i) => html`<li><details class="c-quiz__q"><summary>${q.emoji ? `${q.emoji} ` : ''}${q.q}</summary>
      <ol class="c-quiz__choices" type="A">${q.choices.map((c, j) => html`<li${j === q.answer ? raw(' class="is-answer"') : ''}>${c}${j === q.answer ? ' ✓' : ''}</li>`)}</ol>
      <p class="c-quiz__explain">${q.explain}</p>${basedOnLink(ctx, q.basedOn)}</details></li>`)}</ol>
  </div>
</div>
${item.disclaimer ? html`<p class="c-play__disclaimer">${item.disclaimer}</p>` : ''}`;
}

/* ───── 防疫決策模擬 ───── */
function simPage(ctx, item) {
  const { t, site } = ctx;
  const sc = item.scenario;
  const ref = (id) => (id && site.byId.get(id) ? { title: site.byId.get(id).title, href: hrefFor(ctx, site.byId.get(id)) } : null);
  const data = { role: sc.role, intro: sc.intro, meters: sc.meters, endings: sc.endings, rounds: sc.rounds.map((r) => ({ title: r.title, prompt: r.prompt, options: r.options.map((o) => ({ label: o.label, effects: o.effects, feedback: o.feedback, basedOn: ref(o.basedOn) })) })) };
  const fmtEff = (eff) => Object.entries(eff ?? {}).map(([k, v]) => `${sc.meters.find((m) => m.key === k)?.label ?? k} ${v > 0 ? '+' : ''}${v}`).join('、');
  return html`<div class="c-sim" data-sim>
  ${raw(`<script type="application/json" data-sim-data>${jsonScript(data)}</script>`)}
  <p class="c-sim__role"><b>${sc.role}</b>　${sc.intro}</p>
  <div class="c-sim__stage" data-sim-stage hidden></div>
  <div class="c-sim__fallback" data-sim-fallback>
    <p class="c-play__nojs">${t('play.nojs')}</p>
    <p class="c-sim__meters-static">${t('sim.meters')}：${sc.meters.map((m) => `${m.label} ${m.start}`).join('、')}</p>
    ${sc.rounds.map((r) => html`<details class="c-sim__round"><summary>${r.title}</summary><p>${r.prompt}</p>
      <ul class="c-sim__opts">${r.options.map((o) => html`<li><b>${o.label}</b><br>${o.feedback}<br><small>${fmtEff(o.effects)}</small>${o.basedOn ? html`<br>${basedOnLink(ctx, o.basedOn)}` : ''}</li>`)}</ul></details>`)}
  </div>
</div>
${item.disclaimer ? html`<p class="c-play__disclaimer">${item.disclaimer}</p>` : ''}`;
}

export function render(ctx, props = {}) {
  const { t, site } = ctx;
  const item = props?.id ? site.byId.get(props.id) : null;
  if (!item) return hub(ctx);
  const body = item.kind === 'on-this-day' ? onThisDayPage(ctx, item) : isQuizKind(item.kind) ? quizPage(ctx, item) : item.kind === 'policy-sim' ? simPage(ctx, item) : '';
  return html`${pageHead(ctx, { trail: [{ label: t('play.title'), href: '/play/' }, { label: item.title }], h1: item.title, lead: item.summary, tags: html`<p class="c-play__tags">${pill(KINDS[item.kind]?.label ?? item.kind, 'info')} <span class="c-play__owner">${t('play.owner')}：${unitName(ctx, item.owner)}</span></p>` })}
${demoNote(ctx, item)}
<div class="c-play c-play--${item.kind}" data-play-kind="${item.kind}" data-play-id="${interactiveSlug(item)}">${body}</div>`;
}
