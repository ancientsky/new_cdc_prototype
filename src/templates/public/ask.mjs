// 答案頁殼：H1 隱藏、頂部窄 header 內嵌問題框；#answer / #answer-side 由 D 的 /assets/js/answer/ui.js 掛載。
import { html, raw } from '../../../scripts/lib/render.mjs';
import { config } from '../../../site.config.mjs';
import { breadcrumbLd } from './_partials.mjs';

export function meta(ctx) {
  return { title: ctx.t('ask.title'), description: ctx.t('ask.desc'), noindex: true, bodyClass: 'page-ask', styles: ['/assets/styles/answer.css'], scripts: ['/assets/js/answer/ui.js'], jsonLd: [breadcrumbLd(ctx, [{ label: ctx.t('ask.title') }])], hideTranslationBar: false };
}

export function render(ctx) {
  const { t, url, site } = ctx;
  const ai = site.config.ai ?? config.ai;
  const paused = site.gov?.pausedAI;
  return html`
<div class="c-askpage" data-paused="${paused ? '1' : '0'}">
  <header class="c-askpage__bar">
    <h1 class="sr-only">${t('ask.title')}</h1>
    <form class="c-askbox c-askbox--md" id="ask-form" action="${url('/ask/')}" method="get" role="search">
      <label class="sr-only" for="ask-q">${t('home.h1')}</label>
      <input id="ask-q" name="q" type="search" value="" data-fill-q placeholder="${t('home.placeholder')}" autocomplete="off" enterkeyhint="search">
      <input type="hidden" name="disease" value="" data-fill-param="disease">
      <button type="submit" class="c-askbox__btn">${t('home.ask')}</button>
    </form>
    <details id="ask-advanced" class="c-advanced" data-group="ondemand">
      <summary>${t('ask.advanced')}</summary>
      <div class="c-advanced__body">
        <p><label for="llm-key"><b>${t('ask.key.label')}</b></label><br>
          <input id="llm-key" type="password" autocomplete="off" spellcheck="false" placeholder="sk-ant-…" class="c-input"></p>
        <p class="muted">${t('ask.key.note')}</p>
        <dl class="c-deflist c-deflist--sm" id="ask-disclosure">
          <div><dt>${t('ask.mode')}</dt><dd>${ai.defaultMode === 'extractive' ? t('ask.mode.extractive') : t('ask.mode.llm')}</dd></div>
          <div><dt>${t('ask.provider')}</dt><dd>${ai.llmProvider} · <code>${ai.llmModel}</code></dd></div>
          <div><dt>${t('ask.disclosure')}</dt><dd>${ai.modelDisclosure}</dd></div>
        </dl>
      </div>
    </details>
  </header>

  <div class="c-askpage__grid">
    <div id="answer" class="c-answer" aria-live="polite" aria-busy="true">
      <div class="c-skeleton" aria-hidden="true"><span></span><span></span><span class="short"></span><span></span></div>
      <p class="sr-only">${t('ask.loading')}</p>
      <noscript><p class="c-alert c-alert--overdue">${t('ask.noscript')} <a href="${url('/diseases/')}">${t('nav.diseases')}</a> · <a href="${url('/faq/')}">${t('nav.faq')}</a> · <a href="tel:1922">1922</a></p></noscript>
    </div>
    <aside id="answer-side" class="c-answer-side" aria-label="${t('ask.side')}"></aside>
  </div>

  <section class="c-channels" aria-labelledby="channels-h">
    <h2 id="channels-h">${t('ask.channels.t')}</h2>
    <p class="muted">${t('ask.channels.sub')}</p>
    <div class="c-channels__grid">
      <div class="c-channel"><h3>${t('ask.channels.web')}</h3><p>${t('ask.channels.web.d')}</p></div>
      <div class="c-channel"><h3>${t('ask.channels.api')}</h3><p>${t('ask.channels.api.d')}</p><a href="${url('/developers/')}">${t('footer.api')} →</a></div>
      <div class="c-channel"><h3>${t('ask.channels.llm')}</h3><p>${t('ask.channels.llm.d')}</p><a href="${url('/llms.txt', { noLang: true })}">llms.txt</a> · <a href="${url('/policy/ai/')}">${t('footer.ai')}</a></div>
    </div>
  </section>
</div>`;
}

export function pages() { return [{ path: '/ask/', lang: '*', props: {}, noindex: true }]; }
void raw;
