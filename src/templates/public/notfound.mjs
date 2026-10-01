import { html } from '../../../scripts/lib/render.mjs';
export function meta() { return { title: '找不到頁面', description: '找不到頁面', noindex: true }; }
export function render(ctx) {
  return html`<section class="notfound"><h1>找不到這一頁</h1><p>這個網址可能已被新版取代或移除。你可以：</p><ul><li><a href="${ctx.url('/')}">回首頁</a>，直接用一句話問</li><li>查看 <a href="${ctx.url('/v1/redirects.json', { noLang: true })}">舊版對照表</a></li><li>撥打 1922</li></ul></section>`;
}

export function pages() { return [{ path: '/404.html', file: true, noindex: true, props: {} }]; }
