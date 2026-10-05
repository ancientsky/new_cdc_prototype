// /campaigns/：宣導 Banner 總覽。這就是 Banner 的「資料目錄」：進行中／即將開始／已結束，每則都有權責、上下架日與關聯內容。
import { html, raw } from '../../../scripts/lib/render.mjs';
import { ldFor, pageHead, hrefFor, isFallbackLink, L, unitName, unitLink, publishedOf, isExternal, imgSrc, itemPath, campaignState } from './_partials.mjs';

export function meta(ctx) {
  return { title: ctx.t('campaigns.title'), description: ctx.t('campaigns.lead'), jsonLd: ldFor(ctx, null, [{ label: ctx.t('campaigns.title') }]) };
}

const stateOf = campaignState;

function relatedOf(site, b) {
  const ids = [...(b.diseases ?? []), ...(b.vaccines ?? []), ...(b.related ?? []), ...(b.basedOn ?? [])];
  const out = [];
  for (const id of new Set(ids)) { const it = site.byId.get(id); if (it && it.status === 'published') out.push(it); }
  return out;
}

function card(ctx, b, state) {
  const { t, url, fmtDate, site } = ctx;
  const cta = L(ctx, b, 'cta') ?? b.cta;
  const href = isExternal(cta.url) ? cta.url : url(cta.url);
  const head = L(ctx, b, 'headline') ?? b.title;
  const src = imgSrc(ctx, b.image);
  const rel = relatedOf(site, b);
  const left = state === 'active' ? Math.round((new Date(`${b.endAt}T00:00:00Z`) - new Date(`${site.today}T00:00:00Z`)) / 86400000) : null;
  return html`<li class="c-campaign c-campaign--${state}" id="${b.id}">
  <div class="c-campaign__art">${src ? html`<img src="${src}" alt="" width="400" height="300" loading="lazy">` : raw('<svg viewBox="0 0 400 300" aria-hidden="true" focusable="false"><rect width="400" height="300" fill="#e5efe9"/><circle cx="300" cy="90" r="64" fill="#cfe3d8"/><circle cx="90" cy="230" r="50" fill="#cfe3d8"/></svg>')}</div>
  <div class="c-campaign__body">
    <h3 class="c-campaign__t">${head}</h3>
    ${L(ctx, b, 'subline') ? html`<p class="c-campaign__sub">${L(ctx, b, 'subline')}</p>` : ''}
    <dl class="c-campaign__meta">
      <div><dt>${t('prov.owner')}</dt><dd>${unitLink(ctx, b.owner)}</dd></div>
      <div><dt>${t('campaigns.live')}</dt><dd><time datetime="${b.startAt}">${fmtDate(b.startAt)}</time> – <time datetime="${b.endAt}">${fmtDate(b.endAt)}</time>${left != null ? html` <span class="c-pill c-pill--${left <= 7 ? 'warn' : 'ok'}">${t('campaigns.daysleft', { n: left })}</span>` : ''}</dd></div>
      <div><dt>${t('prov.reviewed')}</dt><dd>${fmtDate(b.reviewedAt)}</dd></div>
      ${rel.length ? html`<div><dt>${t('campaigns.related')}</dt><dd>${rel.map((r, i) => html`${i ? '、' : ''}<a href="${hrefFor(ctx, r)}"${isFallbackLink(ctx, r) ? raw(' lang="zh-TW"') : ''}>${L(ctx, r, 'title')}</a>`)}</dd></div>` : ''}
    </dl>
    <p class="c-campaign__cta">${state === 'ended' ? html`<span class="c-pill c-pill--neutral">${t('campaigns.ended.tag')}</span> <span class="muted">${cta.label}</span>` : state === 'upcoming'
    ? html`<span class="c-pill c-pill--info">${t('campaigns.upcoming.tag', { date: fmtDate(b.startAt) })}</span> <span class="muted">${cta.label}</span>`
    : html`<a class="c-btn c-btn--sm" href="${href}"${isExternal(cta.url) ? raw(' rel="noopener"') : ''}>${cta.label}${isExternal(cta.url) ? ' ↗' : ' →'}</a>`}</p>
  </div>
</li>`;
}


/** 首頁兩種 Banner 做法的縮版示意（建置時直接用 HTML/CSS 畫，圖用目前第一則宣導的 16:9 大圖）；點下去開真實首頁預覽。 */
function heroDemo(ctx) {
  const { site, url } = ctx;
  const first = site.collections.banners
    .filter((b) => b.status === 'published' && b.startAt <= site.today && site.today <= b.endAt)
    .sort((a, b) => (a.priority ?? 9) - (b.priority ?? 9))[0];
  const art = first ? imgSrc(ctx, first.imageWide ?? first.image) : null;
  const img = art ? html`<img src="${art}" alt="" width="1200" height="675" loading="lazy">` : '';
  const pos = (css) => raw(`style="${css}"`);
  const lines = (n) => raw('<i></i>'.repeat(n));
  const A = html`<a class="c-promo-demo__fig" href="${url('/')}?hero=A" aria-label="開啟首頁做法 A 預覽">
    <span class="c-promo-demo__bar"></span>
    <span class="c-promo-demo__ask" ${pos('left:4%;top:14%;width:42%;height:50%')}><i class="b"></i>${lines(1)}<i class="b" style="width:60%"></i></span>
    <span class="c-promo-demo__img" ${pos('left:51%;top:14%;width:45%;height:46%;border-radius:6px 6px 0 0')}>${img}</span>
    <span class="c-promo-demo__tx" ${pos('left:51%;top:60%;width:45%;height:30%')}><i class="h"></i>${lines(2)}</span>
    <span class="c-promo-demo__sit" ${pos('top:70%;height:20%;right:56%')}><b></b><b></b><b></b></span>
  </a>`;
  const B = html`<a class="c-promo-demo__fig" href="${url('/')}?hero=B" aria-label="開啟首頁做法 B 預覽">
    <span class="c-promo-demo__bar"></span>
    <span class="c-promo-demo__img" ${pos('left:34%;right:0;top:8%;height:46%;border-radius:0;opacity:.85')}>${img}</span>
    <span class="c-promo-demo__ask" ${pos('left:4%;top:12%;width:42%;height:38%;box-shadow:0 4px 10px rgba(0,0,0,.15)')}><i class="h" style="background:#b02a2a;width:50%"></i>${lines(1)}<i class="b"></i></span>
    <span class="c-promo-demo__sit" ${pos('top:58%;height:12%')}><b></b><b></b><b></b><b></b></span>
    <span class="c-promo-demo__tx" ${pos('left:4%;right:4%;top:73%;height:22%;border:1px solid var(--line);border-radius:6px;display:grid;grid-template-columns:2fr 3fr;overflow:hidden')}><span class="c-promo-demo__img" ${pos('position:static;border-radius:0')}>${img}</span><span><i class="h"></i>${lines(1)}</span></span>
  </a>`;
  return html`<section class="c-block" aria-labelledby="camp-demo"${ctx.lang === 'zh-TW' ? '' : raw(' lang="zh-TW"')}>
  <h2 id="camp-demo">首頁兩種做法的示意</h2>
  <p class="muted">同一批 Banner 在首頁有兩種擺法，依疫情狀態自動選用（原型預覽：首頁網址加 <code>?hero=A</code> 或 <code>?hero=B</code> 可強制切換）。圖只當氛圍，字都在 HTML，首屏永遠是問題框與疫情狀態。</p>
  <ul class="c-promo-demo">
    <li class="c-promo-demo__item">${A}<p class="c-promo-demo__t">做法 A · 分割式（非高峰）</p><p class="c-promo-demo__note">左：問題框；右：本期宣導大圖卡（16:9 滿卡寬），字在圖下方，最多 3 則輪播。<a href="${url('/')}?hero=A">看真實首頁 →</a></p></li>
    <li class="c-promo-demo__item">${B}<p class="c-promo-demo__t">做法 B · 情境式（疾病高峰自動切換）</p><p class="c-promo-demo__note">首屏白色面板講疫情與建議，右側用宣導大圖當氛圍；宣導卡退到疫情狀態卡下方（圖左 40％＋文字右）。<a href="${url('/')}?hero=B">看真實首頁 →</a></p></li>
  </ul>
</section>`;
}

export function render(ctx) {
  const { site, t } = ctx;
  const all = publishedOf(site, 'banners');
  const groups = { active: [], upcoming: [], ended: [] };
  for (const b of all) groups[stateOf(site, b)].push(b);
  groups.active.sort((a, b) => (a.priority ?? 9) - (b.priority ?? 9));
  groups.upcoming.sort((a, b) => a.startAt.localeCompare(b.startAt));
  groups.ended.sort((a, b) => b.endAt.localeCompare(a.endAt));
  const sec = (state) => html`<section class="c-block" aria-labelledby="camp-${state}"><h2 id="camp-${state}">${t(`campaigns.${state}`)} <span class="c-pill c-pill--neutral">${groups[state].length}</span></h2>
    ${groups[state].length ? html`<ul class="c-campaigns">${groups[state].map((b) => card(ctx, b, state))}</ul>` : html`<p class="c-empty">${t('none')}</p>`}</section>`;
  return html`${pageHead(ctx, { trail: [{ label: t('campaigns.title') }], h1: t('campaigns.title'), lead: t('campaigns.lead') })}
${heroDemo(ctx)}
<aside class="c-note" aria-label="${t('campaigns.rule.t')}"><strong>${t('campaigns.rule.t')}</strong> ${t('campaigns.rule')}</aside>
${sec('active')}${sec('upcoming')}${sec('ended')}`;
}

export function pages() { return [{ path: '/campaigns/', lang: '*', props: {} }]; }
void itemPath;
