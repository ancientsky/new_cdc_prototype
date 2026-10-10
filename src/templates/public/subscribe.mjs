// /subscribe/（訂閱與通知；七語）——第二十八輪，Issue #38（電子報走哪個管道）。
// 三條管道：RSS（零個資，頁面列出「所有」現有頻道）、LINE 官方帳號、Email（雙重確認；原型為模擬後端）。
// 頻道清單從 emit-seo.mjs 的 buildFeeds() 實際輸出讀回（scripts/lib/feed-catalog.mjs），不手抄；Email 的主題勾選就是這些頻道。
// Email 表單與各畫面由 src/client/subscribe.js 驅動；沒有 JS 時整個 Email 區塊隱藏，改顯示 <noscript> 說明（RSS 與 LINE 不需要 JS）。
import { html, raw } from '../../../scripts/lib/render.mjs';
import { ldFor, pageHead, sectionHead } from './_partials.mjs';
import { feedCatalog } from '../../../scripts/lib/feed-catalog.mjs';
import { TOPIC_IDS, MAIL_LANGS } from '../../client/subscribe-rules.js';
// 第三十輪（#55）：site.config.mjs forms.newsletter 設了 post 端點 ⇒ subscribe.js 直接用 createHttpBackend({ base: 端點 })（同一份 /api/subscriptions* 契約），
// 不再偵測本機模擬後端；Email 區塊上方一律顯示收件單位與個資蒐集告知。
import { formOf, formNotice } from './_forms.mjs';

/**
 * 疾管署 LINE 官方帳號「疾管家」。
 * verified:false ＝ 帳號 ID 與加入連結取自公開報導（2018–2020 年的媒體與衛福部說明），開發環境連不到 www.cdc.gov.tw，尚未與公關室核對；
 * 頁面因此顯示「待確認」標記。公關室核對官網首頁公布的帳號後把 verified 改 true 並更新 content/migration/legacy-services.json 的 newsletter 項目。
 */
export const LINE_ACCOUNT = { name: '疾管家', id: '@taiwancdc', url: 'https://page.line.me/taiwancdc', verified: false };

export function pages() { return [{ path: '/subscribe/', lang: '*', props: {} }]; }

export function meta(ctx) {
  return {
    title: ctx.t('subscribe.title'), description: ctx.t('subscribe.desc'),
    styles: ['/assets/styles/careers.css', '/assets/styles/subscribe.css'], scripts: ['/assets/js/subscribe.js'],
    jsonLd: ldFor(ctx, null, [{ label: ctx.t('subscribe.title') }]),
  };
}

/** 頻道目錄與主題清單必須一致，否則建置失敗（新增頻道卻忘了加主題，Email 訂閱就少一個選項） */
export function checkTopics(site) {
  const ids = feedCatalog(site).map((f) => f.id);
  if (JSON.stringify(ids) !== JSON.stringify(TOPIC_IDS)) throw new Error(`[subscribe] TOPIC_IDS（src/client/subscribe-rules.js）與 RSS 頻道不一致：${TOPIC_IDS.join(',')} ≠ ${ids.join(',')}`);
  return ids;
}

function prefsFields(ctx, idp, { topics = ['news', 'situation'], frequency = 'instant', lang = 'zh-TW' } = {}) {
  const { t } = ctx;
  return html`<fieldset class="c-sub__set"><legend>${t('subscribe.f.topics')} <span class="c-req" aria-hidden="true">*</span><span class="sr-only"> (${t('subscribe.required')})</span></legend>
    <p class="c-field__hint" id="${idp}-topics-h">${t('subscribe.f.topics.hint')}</p>
    <div class="c-sub__grid">${TOPIC_IDS.map((id) => html`<label class="c-checkrow"><input type="checkbox" id="${idp}-topic-${id}" name="topics" value="${id}" ${topics.includes(id) ? raw('checked') : ''} aria-describedby="${idp}-topics-h"><span>${t(`subscribe.topic.${id}`)}</span></label>`)}</div>
    <p class="c-field__err" data-err="topics" hidden></p></fieldset>
  <fieldset class="c-sub__set"><legend>${t('subscribe.f.freq')}</legend>
    ${['instant', 'weekly'].map((f) => html`<label class="c-checkrow"><input type="radio" name="frequency" value="${f}" ${f === frequency ? raw('checked') : ''}><span>${t(`subscribe.f.freq.${f}`)}</span></label>`)}</fieldset>
  <fieldset class="c-sub__set"><legend>${t('subscribe.f.lang')}</legend>
    ${MAIL_LANGS.map((l) => html`<label class="c-checkrow"><input type="radio" name="lang" value="${l}" ${l === lang ? raw('checked') : ''}><span lang="${l}">${t(`subscribe.f.lang.${l}`)}</span></label>`)}</fieldset>`;
}

function rssSection(ctx, feeds) {
  const { t, fmtDate } = ctx;
  return html`<section class="c-sub__sec" id="rss" aria-labelledby="h-rss">
  ${sectionHead(ctx, { id: 'h-rss', title: t('subscribe.rss.h') })}
  <p>${t('subscribe.rss.what')}</p>
  <ol class="c-sub__steps">${[1, 2, 3].map((n) => html`<li>${t(`subscribe.rss.step${n}`)}</li>`)}</ol>
  <div class="c-tablewrap" role="region" tabindex="0" aria-label="${t('a11y.scrollTable')}"><table class="c-table c-sub__feeds">
    <caption class="sr-only">${t('subscribe.rss.caption')}</caption>
    <thead><tr><th scope="col">${t('subscribe.rss.col.feed')}</th><th scope="col">${t('subscribe.rss.col.what')}</th><th scope="col">${t('subscribe.rss.col.url')}</th></tr></thead>
    <tbody>${feeds.map((f) => {
      const latest = f.items[0]?.date;
      return html`<tr data-feed="${f.id}"><th scope="row">${t(`subscribe.topic.${f.id}`)}</th>
        <td><span lang="zh-TW">${f.description}</span><br><span class="muted">${t('subscribe.rss.count', { n: f.count })}${latest ? html` · ${t('subscribe.rss.latest')} <time datetime="${latest}">${fmtDate(latest)}</time>` : ''}</span></td>
        <td><a href="${f.url}" type="application/rss+xml"><code>${f.url}</code></a> <button type="button" class="c-btn c-btn--ghost c-btn--sm c-sub__copy" data-copy-text="${f.url}" data-done="${t('copied')}">${t('subscribe.rss.copy')}<span class="sr-only"> ${t(`subscribe.topic.${f.id}`)}</span></button></td></tr>`;
    })}</tbody></table></div>
  <p class="muted">${t('subscribe.rss.note')}</p>
</section>`;
}

function lineSection(ctx) {
  const { t } = ctx;
  const L = LINE_ACCOUNT;
  return html`<section class="c-sub__sec" id="line" aria-labelledby="h-line">
  ${sectionHead(ctx, { id: 'h-line', title: t('subscribe.line.h') })}
  <p>${t('subscribe.line.what')}</p>
  <dl class="c-deflist c-sub__line">
    <div><dt>${t('subscribe.line.name')}</dt><dd><span lang="zh-TW">${L.name}</span></dd></div>
    <div><dt>${t('subscribe.line.id')}</dt><dd><strong>${L.id}</strong>${L.verified ? '' : html` <span class="c-pill c-pill--warn" data-unverified>${t('subscribe.unverified')}</span>`}</dd></div>
  </dl>
  <p><a class="c-btn" href="${L.url}" rel="noopener">${t('subscribe.line.add')}<span aria-hidden="true"> ↗</span><span class="sr-only"> (${t('external')})</span></a></p>
  ${L.verified ? '' : html`<p class="c-alert c-alert--overdue" role="note" data-unverified-note>${t('subscribe.line.unverified')}</p>`}
  <p class="muted">${t('subscribe.line.warn')}</p>
</section>`;
}

function emailSection(ctx) {
  const { t, lang, url } = ctx;
  const mailLang = lang === 'en' ? 'en' : 'zh-TW';
  return html`<section class="c-sub__sec" id="email" aria-labelledby="h-email">
  ${sectionHead(ctx, { id: 'h-email', title: t('subscribe.email.h') })}
  <p>${t('subscribe.email.lead')}</p>
  ${formOf(ctx, 'newsletter').active === 'post' ? '' : html`<p class="muted">${t('subscribe.proto.note')}</p>`}
  ${formNotice(ctx, 'newsletter')}
  <noscript><p class="c-alert c-alert--info">${t('subscribe.noscript')}</p></noscript>
  ${formOf(ctx, 'newsletter').active === 'post'
    ? html`<div class="c-sub" data-sub-app data-backend="live" data-endpoint="${formOf(ctx, 'newsletter').endpoint}" hidden>`
    : raw('<div class="c-sub" data-sub-app data-backend="auto" hidden>')}
    <div class="c-demo-banner" role="note" data-demo-banner><span class="c-demo-banner__ic" aria-hidden="true">!</span><div><strong data-sub-banner-text>${t('subscribe.banner')}</strong> <span data-sub-backend-note>${t('subscribe.banner.sub')}</span></div></div>
    <p class="sr-only" role="status" aria-live="polite" data-sub-live></p>

    <div data-sub-view="form">
      <h3 data-sub-focus>${t('subscribe.form.h')}</h3>
      <div class="c-alert c-alert--overdue c-sub__errors" data-sub-errors role="alert" aria-live="assertive" hidden></div>
      <form class="c-sub__form" data-sub-form data-idp="sub" novalidate>
        <div class="c-field" data-field="email"><label for="sub-email">${t('subscribe.f.email')} <span class="c-req" aria-hidden="true">*</span><span class="sr-only"> (${t('subscribe.required')})</span></label>
          <input class="c-input" id="sub-email" name="email" type="email" required aria-required="true" autocomplete="email" inputmode="email" maxlength="254" aria-describedby="sub-email-h sub-email-e">
          <p class="c-field__hint" id="sub-email-h">${t('subscribe.f.email.hint')}</p><p class="c-field__err" id="sub-email-e" data-err="email" hidden></p></div>
        ${prefsFields(ctx, 'sub', { lang: mailLang })}
        <div class="c-sub__hp" aria-hidden="true"><label>Website <input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>
        <details class="c-source-card c-sub__privacy"><summary>${t('subscribe.privacy.t')}</summary><div class="c-prose"><ul>${[1, 2, 3, 4].map((n) => html`<li>${t(`subscribe.privacy.${n}`)}</li>`)}</ul></div></details>
        <div class="c-field c-field--check" data-field="consent"><label class="c-checkrow"><input type="checkbox" id="sub-consent" name="consent" required aria-required="true" aria-describedby="sub-consent-e"><span>${t('subscribe.f.consent')} <a href="${url('/policy/privacy/')}">${t('footer.privacy')}</a> <span class="c-req" aria-hidden="true">*</span><span class="sr-only"> (${t('subscribe.required')})</span></span></label>
          <p class="c-field__err" id="sub-consent-e" data-err="consent" hidden></p></div>
        <p><button type="submit" class="c-btn">${t('subscribe.submit')}</button> <button type="button" class="c-btn c-btn--ghost" data-sub-open-inbox hidden>${t('subscribe.inbox.open.btn')}</button></p>
      </form>
      <details class="c-source-card c-sub__lost"><summary>${t('subscribe.lost.h')}</summary><div class="c-prose">
        <p>${t('subscribe.lost.text')}</p>
        <form data-sub-lost-form novalidate><div class="c-field"><label for="sub-lost-email">${t('subscribe.f.email')}</label>
          <input class="c-input" id="sub-lost-email" name="email" type="email" autocomplete="email" maxlength="254" aria-describedby="sub-lost-e"><p class="c-field__err" id="sub-lost-e" data-sub-lost-err hidden></p></div>
          <button type="submit" class="c-btn c-btn--ghost">${t('subscribe.lost.btn')}</button></form></div></details>
    </div>

    <div data-sub-view="sent" hidden>
      <h3 data-sub-focus>${t('subscribe.sent.h')}</h3>
      <p data-sub-sent-text></p>
      <p class="muted" data-sub-sent-where></p>
      <div class="c-sub__inbox" data-sub-inbox hidden></div>
      <p><button type="button" class="c-btn c-btn--ghost" data-sub-back>${t('subscribe.back')}</button></p>
    </div>

    <div data-sub-view="result" hidden>
      <h3 data-sub-focus data-sub-result-title></h3>
      <p data-sub-result-text></p>
      <p data-sub-result-links></p>
    </div>

    <div data-sub-view="manage" hidden>
      <h3 data-sub-focus>${t('subscribe.manage.h')}</h3>
      <form class="c-sub__form" data-sub-manage-form data-idp="mg" novalidate>
        <div class="c-alert c-alert--overdue c-sub__errors" data-sub-manage-errors role="alert" aria-live="assertive" hidden></div>
        <dl class="c-deflist"><div><dt>${t('subscribe.f.email')}</dt><dd data-sub-manage-email></dd></div><div><dt>${t('subscribe.manage.status')}</dt><dd data-sub-manage-status></dd></div></dl>
        ${prefsFields(ctx, 'mg')}
        <p class="c-sub__acts"><button type="submit" class="c-btn" data-sub-act>${t('subscribe.manage.save')}</button> <button type="button" class="c-btn c-btn--ghost" data-sub-unsub data-sub-act>${t('subscribe.manage.unsub')}</button></p>
        <p role="status" aria-live="polite" data-sub-manage-msg></p>
      </form>
    </div>

    <div data-sub-view="unsub" hidden>
      <h3 data-sub-focus>${t('subscribe.unsub.h')}</h3>
      <p>${t('subscribe.unsub.text')} <strong data-sub-unsub-email></strong></p>
      <p><button type="button" class="c-btn" data-sub-unsub-go>${t('subscribe.unsub.go')}</button></p>
    </div>
  </div>
</section>`;
}

export function render(ctx) {
  const { site, t } = ctx;
  const feeds = feedCatalog(site);
  checkTopics(site);
  return html`${pageHead(ctx, { trail: [{ label: t('subscribe.title') }], h1: t('subscribe.title'), lead: t('subscribe.lead') })}
<div class="c-subscribe">
  <nav aria-label="${t('subscribe.toc')}"><ul class="c-linklist c-linklist--inline"><li><a href="#rss">${t('subscribe.ch.rss')}</a></li><li><a href="#line">${t('subscribe.ch.line')}</a></li><li><a href="#email">${t('subscribe.ch.email')}</a></li></ul></nav>
  ${rssSection(ctx, feeds)}
  ${lineSection(ctx)}
  ${emailSection(ctx)}
</div>`;
}
