// 第五十七輪（docs/denguemap-integration.md 第 3 節）：登革熱地圖的「疫情小卡」與嵌入區塊。
//
// 小卡是建置時的 HTML（不需要 client JS）：數字來自 data/snapshots/denguemap-summary.json（site.snapshots.denguemap），
// 要不要顯示數字由 scripts/lib/denguemap.mjs 的 denguemapState 決定（48 小時、病例來源 stale、今年有 cases-shortfall 警示 ⇒ 不顯示），
// 模板不自己重算治理邏輯。鄉鎮名稱：本站主檔沒有鄉鎮代碼表，所以不列鄉鎮名，只列「近 14 天有本土病例的鄉鎮市區數」並連到聚集警示。
//
// 嵌入區塊只放在專區頁（content/topics/denguemap.json 的 embed 欄位），不放在一般疾病頁（vaxmap 整合方案 3.1 的原則）。
// 切換視圖用 <a target="denguemap-frame">：沒有 JS 也能切；inline script 只負責更新 aria-current、iframe title 與「開新視窗」連結（CSP 以雜湊放行）。
import { html, raw } from '../../../scripts/lib/render.mjs';
import { denguemapState, taipeiMinute } from '../../../scripts/lib/denguemap.mjs';
import { denguemapLink, denguemapButton, sourceCard, unitName, hrefFor } from './_partials.mjs';

export const DENGUEMAP_OWNER = 'unit.epidemic-intelligence';
export const DENGUEMAP_TOPIC_ID = 'topic.denguemap';
const FRAME = 'denguemap-frame';
/**
 * 哪些疾病頁有登革熱地圖入口（與 vaxmap 的 VAXMAP_GROUP_OF 同一作法：先寫在程式，第二階段改成疾病主檔欄位）。
 *  card：疫情區塊最上方放疫情小卡（含病例地圖／聚集警示／蚊媒地圖按鈕）；vectorIn：在哪個區塊放「蚊媒地圖」按鈕。
 * 屈公病與登革熱同為埃及斑蚊、白線斑蚊傳播，病媒蚊風險地圖同樣適用；病例數是登革熱的，所以屈公病頁不放小卡。
 */
export const DENGUEMAP_OF_DISEASE = { 'disease.dengue': { card: true }, 'disease.chikungunya': { vectorIn: 'prevention' } };

/** 快照＋過期判斷（模板共用）；now 預設 site.now（建置的真實時間，不受 BUILD_TODAY 影響） */
export function denguemapCardData(site, { now = site.now ?? Date.now() } = {}) {
  const snap = site.snapshots?.denguemap ?? null;
  const st = denguemapState(snap, { now, maxAgeHours: site.config.denguemapMaxAgeHours ?? 48 });
  return { snap, ...st };
}

const topicOf = (site) => {
  const tp = site.byId?.get(DENGUEMAP_TOPIC_ID);
  return tp && tp.status === 'published' ? tp : null;
};

function stat(ctx, label, n, sub = '') {
  return html`<div class="c-dmcard__stat">
    <dt>${label}</dt>
    <dd>
      <b class="c-dmcard__n">${n.toLocaleString('en-US')}</b
      >${ctx.t('denguemap.unit') ? html` <span class="c-dmcard__u">${ctx.t('denguemap.unit')}</span>` : ''}${sub ? html`<span class="c-dmcard__sub">${sub}</span>` : ''}
    </dd>
  </div>`;
}

/**
 * 疫情小卡。opts.heading（h2／h3，預設 h3）、opts.topicLink（是否附「登革熱地圖專區」連結，預設 true）、opts.now（測試用）。
 * state ok ⇒ 數字＋資料時間＋來源卡；stale／missing ⇒「資料更新中」＋原因＋開地圖按鈕。
 */
export function denguemapCard(ctx, { heading = 'h3', topicLink = true, now } = {}) {
  const { site, t, url } = ctx;
  const d = denguemapCardData(site, now === undefined ? {} : { now });
  const H = heading === 'h2' ? 'h2' : 'h3';
  const tp = topicLink ? topicOf(site) : null;
  const topicA = tp ? html`<a href="${hrefFor(ctx, tp)}">${t('denguemap.topic')} →</a>` : '';
  const head = html`<header class="c-dmcard__head"><${raw(H)} id="dmcard-h" class="c-dmcard__t">${t('denguemap.card.t')}</${raw(H)}><span class="c-pill c-pill--info">${t('denguemap.card.badge')}</span></header>`;
  const lastTime = d.snap?.manifest?.generatedAt ? taipeiMinute(d.snap.manifest.generatedAt) : '';
  if (d.state !== 'ok') {
    const why =
      d.state === 'missing'
        ? [t('denguemap.stale.why.missing')]
        : d.reasons.map((r) => t(`denguemap.stale.why.${r}`, { h: site.config.denguemapMaxAgeHours ?? 48 }));
    return html`<section
      class="c-dmcard c-dmcard--stale"
      id="denguemap-card"
      aria-labelledby="dmcard-h"
      data-denguemap-state="${d.state}"
      data-denguemap-reasons="${d.reasons.join(' ')}"
    >
      ${head}
      <p class="c-dmcard__stale" role="status"><strong>${t('denguemap.stale')}</strong></p>
      <ul class="c-dmcard__why muted">
        ${why.map((w) => html`<li>${w}</li>`)}${lastTime ? html`<li>${t('denguemap.stale.last', { time: lastTime })}${t('denguemap.tpe')}</li>` : ''}
      </ul>
      <p class="c-linkrow c-dmcard__links">${denguemapButton(ctx, { view: 'map', label: t('denguemap.open') })} ${topicA}</p>
    </section>`;
  }
  const s = d.snap.summary,
    m = d.snap.manifest;
  const towns = s.topTowns14.filter((r) => r[1] > 0).length;
  const prev = (type) =>
    d.prevIncomplete?.[type] ? t('denguemap.prev.incomplete') : t('denguemap.prev', { year: s.year - 1, n: s.prevYtd[type].toLocaleString('en-US') });
  const owner = unitName(ctx, DENGUEMAP_OWNER);
  const note = html`${t('source')}${ctx.lang === 'zh-TW' ? '：' : ': '}${t('denguemap.source.name')} · ${t('denguemap.datatime')}
  ${lastTime}${t('denguemap.tpe')} · ${t('denguemap.latest')} ${ctx.fmtDate(s.latestOnset)} ·
  ${t('denguemap.snapshot.at', { time: taipeiMinute(d.snap.fetchedAt) })}`;
  const ds = site.byId?.get('dataset.denguemap-summary');
  const links = [
    { label: 'summary.json', href: site.config.denguemapDataUrl + 'summary.json' },
    { label: 'manifest.json', href: site.config.denguemapDataUrl + 'manifest.json' },
    ...(ds ? [{ label: t('disease.dataset'), href: `${url('/data/')}#${ds.id}` }] : []),
  ];
  return html`<section class="c-dmcard" id="denguemap-card" aria-labelledby="dmcard-h" data-denguemap-state="ok">
    ${head}
    <dl class="c-dmcard__stats">
      ${stat(ctx, t('denguemap.ytd.local', { year: s.year }), s.ytd.local, prev('local'))}
      ${stat(ctx, t('denguemap.ytd.imported', { year: s.year }), s.ytd.imported, prev('imported'))} ${stat(ctx, t('denguemap.d14.local'), s.last14.local)}
      ${stat(ctx, t('denguemap.d14.imported'), s.last14.imported)}
    </dl>
    <p class="c-dmcard__meta">
      <span><b>${t('denguemap.latest')}</b> <time datetime="${s.latestOnset}">${ctx.fmtDate(s.latestOnset)}</time></span>
      <span><b>${t('denguemap.towns14')}</b> ${towns}</span>
      <span><b>${t('denguemap.datatime')}</b> <time datetime="${m.generatedAt}">${lastTime}</time>${t('denguemap.tpe')}</span>
    </p>
    <p class="c-dmcard__note muted">${t('denguemap.note')}</p>
    <p class="c-linkrow c-dmcard__links">
      ${denguemapButton(ctx, { view: 'map', type: 'local', label: t('denguemap.view.map') })}
      ${denguemapButton(ctx, { view: 'clusters', label: t('denguemap.view.clusters'), cls: 'c-btn c-btn--ghost' })}
      ${denguemapButton(ctx, { view: 'vector', label: t('denguemap.view.vector'), cls: 'c-btn c-btn--ghost' })} ${topicA}
    </p>
    ${sourceCard(ctx, { canonicalUrl: site.config.denguemapDataUrl + 'summary.json', dataDate: lastTime.slice(0, 10), owner, license: ds?.license ?? 'OGDL-1.0', links, note })}
  </section>`;
}

/** 嵌入地圖可切換的視圖（白名單；順序即按鈕順序） */
export const EMBED_VIEWS = ['map', 'clusters', 'vector', 'trends', 'imported'];

const EMBED_JS = `(function(){var nav=document.querySelector('[data-dm-tabs]');if(!nav)return;var f=document.getElementById('${FRAME}');var full=document.getElementById('dm-full');
nav.addEventListener('click',function(e){var a=e.target.closest('a[data-dm-view]');if(!a)return;[].forEach.call(nav.querySelectorAll('a[data-dm-view]'),function(x){x.removeAttribute('aria-current');});a.setAttribute('aria-current','true');if(f&&a.dataset.dmTitle)f.title=a.dataset.dmTitle;if(full&&a.dataset.dmFull)full.href=a.dataset.dmFull;});})();`;

/**
 * 嵌入區塊。opts: { views（EMBED_VIEWS 子集）, view（預設第一個）, heading }。
 * iframe：title、loading=lazy、referrerpolicy=no-referrer、allow=fullscreen、sandbox（allow-scripts：地圖本身；allow-same-origin：Web Worker 與 storage；
 *   allow-popups＋allow-popups-to-escape-sandbox：「開啟完整地圖 ↗」；allow-downloads：蚊媒地圖的 CSV）。
 *   注意：原型的地圖與本站同在 ancientsky.github.io（同源），allow-scripts＋allow-same-origin 等於沒有隔離；換到專用網域後 sandbox 才真正生效
 *   （docs/denguemap-integration.md §3.3）；
 * 高度由 CSS 依視窗決定（.c-dmembed__frame）。iframe 載不出來時，下方的「在新視窗開啟」連結一直看得到；沒有 JS 時另有 noscript 說明。
 */
export function denguemapEmbed(ctx, { views = ['map', 'vector', 'imported'], view, heading = '' } = {}) {
  const { t } = ctx;
  const vs = views.filter((v) => EMBED_VIEWS.includes(v));
  if (!vs.length) vs.push('map');
  const cur = vs.includes(view) ? view : vs[0];
  const label = (v) => t(`denguemap.view.${v}`);
  const src = (v) => denguemapLink(ctx, { view: v, embed: true, theme: 'light' });
  const full = (v) => denguemapLink(ctx, { view: v });
  const title = (v) => t('denguemap.embed.title', { view: label(v) });
  const nw = t('denguemap.newwin');
  return html`<section class="c-dmembed" id="denguemap-embed" aria-labelledby="dmembed-h">
      <h2 id="dmembed-h">${heading || t('denguemap.embed.h')}</h2>
      <a class="skip-link c-dmembed__skip" href="#dmembed-after">${t('denguemap.embed.skip')}</a>
      ${vs.length > 1 ? html`<nav class="c-dmembed__tabs" aria-label="${t('denguemap.embed.label')}" data-dm-tabs>${vs.map((v) => html`<a class="c-dmembed__tab" href="${src(v)}" target="${FRAME}" data-dm-view="${v}" data-dm-title="${title(v)}" data-dm-full="${full(v)}" ${v === cur ? raw(' aria-current="true"') : ''}>${label(v)}</a>`)}</nav>` : ''}
      <div class="c-dmembed__box">
        <iframe
          class="c-dmembed__frame"
          id="${FRAME}"
          name="${FRAME}"
          src="${src(cur)}"
          title="${title(cur)}"
          loading="lazy"
          referrerpolicy="no-referrer"
          allow="fullscreen"
          allowfullscreen
          sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-downloads"
        ></iframe>
      </div>
      <noscript><p class="c-dmembed__noscript" role="note">${t('denguemap.embed.noscript')}</p></noscript>
      <p class="c-dmembed__fallback" id="dmembed-after">
        ${t('denguemap.embed.fallback')}
        <a id="dm-full" href="${full(cur)}" target="_blank" rel="noopener" title="${nw}"
          >${t('denguemap.open')} ↗<span class="sr-only">${ctx.lang === 'zh-TW' ? `（${nw}）` : ` (${nw})`}</span></a
        >
      </p>
      <p class="c-dmembed__hint muted">${t('denguemap.embed.hint')} ${t('denguemap.embed.unofficial')}</p>
    </section>
    <script>
      ${raw(EMBED_JS)};
    </script>`;
}
