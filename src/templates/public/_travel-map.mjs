// 世界地圖（國際旅遊疫情建議）：inline SVG，路徑來自預先產生的 src/data/world-paths.json（scripts/gen-world-map.mjs）。
// 底線開頭，不會被當成頁面。契約見 ARCHITECTURE.md §12.3。
// 所有字串由呼叫端傳入（i18n.js 不是本檔的檔案），皆有 zh-TW／英文預設值。
import fs from 'node:fs';
import { html, raw, esc } from '../../../scripts/lib/render.mjs';

const WORLD = JSON.parse(fs.readFileSync(new URL('../../data/world-paths.json', import.meta.url), 'utf8'));

/** 供測試與其他模板取用（唯讀） */
export const WORLD_PATHS = WORLD.paths;
export const WORLD_VIEWBOX = WORLD.viewBox;

const TW = 'TW';

const DEFAULTS = {
  'zh-TW': {
    title: '世界旅遊疫情建議地圖',
    desc: '依各國「針對性」旅遊疫情建議等級上色的世界地圖，顏色越深等級越高；點選國家可前往該國的目的地頁。完整資料見下方等級表。',
    legend: { l1: '第一級：注意', l2: '第二級：警示', l3: '第三級：警告', none: '未上色＝目前無針對性建議' },
    none: '目前無針對性建議',
  },
  en: {
    title: 'World map of travel health notices',
    desc: 'World map coloured by each country\'s targeted travel health notice level; darker means a higher level. Select a country to open its destination page. The full data is in the table below.',
    legend: { l1: 'Level 1: Watch', l2: 'Level 2: Alert', l3: 'Level 3: Warning', none: 'Uncoloured = no targeted notice at present' },
    none: 'No targeted notice at present',
  },
};

function countryName(ctx, iso, nameIdx) {
  const c = nameIdx.get(iso);
  if (!c) return iso;
  return ctx?.lang === 'zh-TW' || !ctx?.lang ? (c.name ?? c.nameEn ?? iso) : (c.nameEn ?? c.name ?? iso);
}

/**
 * @param {object} ctx  模板 ctx（只用 ctx.lang、ctx.site.master.countries；皆可缺）
 * @param {object} [opts]
 * @param {Map<string,{code:number,label?:string}>} [opts.byIso]  ISO2 → 針對性等級（code 0–3；label 為等級名，用於 <title>）
 * @param {(iso2:string)=>string|null|undefined} [opts.hrefFor]  回傳網址則包 <a>；null／undefined／空字串＝不包
 * @param {string} [opts.title]  SVG <title>（無障礙名稱）
 * @param {string} [opts.desc]   SVG <desc>（無障礙描述）
 * @param {{l1?:string,l2?:string,l3?:string,none?:string}} [opts.legend]  圖例文字
 */
export function worldMap(ctx, { byIso, hrefFor, title, desc, legend } = {}) {
  const D = DEFAULTS[ctx?.lang === 'zh-TW' || !ctx?.lang ? 'zh-TW' : 'en'];
  const lg = { ...D.legend, ...(legend ?? {}) };
  const nameIdx = new Map((ctx?.site?.master?.countries ?? []).map((c) => [c.iso2, c]));
  const levels = byIso instanceof Map ? byIso : new Map(Object.entries(byIso ?? {}));

  const items = Object.keys(WORLD.paths).map((iso) => {
    const raw0 = levels.get(iso);
    const code = Number.isInteger(raw0?.code) && raw0.code >= 1 && raw0.code <= 3 ? raw0.code : 0;
    return { iso, code, label: raw0?.label || D.none };
  });
  // 繪製順序：無建議 → 第一級 → 第二級 → 第三級 → 台灣，讓有顏色的國家描邊時蓋在鄰國之上
  items.sort((a, b) => (a.iso === TW) - (b.iso === TW) || a.code - b.code || a.iso.localeCompare(b.iso));

  const shapes = items.map(({ iso, code, label }) => {
    const nm = countryName(ctx, iso, nameIdx);
    const isTw = iso === TW;
    const cls = isTw ? 'wm wm--tw' : `wm wm--l${code}`;
    const href = isTw ? null : hrefFor?.(iso);
    const p = html`<path class="${cls}" data-iso="${iso}" d="${WORLD.paths[iso]}"><title>${isTw ? nm : `${nm}：${label}`}</title></path>`;
    return href ? html`<a href="${href}" class="wm-link" aria-label="${isTw ? nm : `${nm}：${label}`}">${p}</a>` : p;
  });

  return html`<figure class="wm-fig">
  <svg class="wm-svg" viewBox="${WORLD.viewBox}" role="img" aria-labelledby="wm-title wm-desc" focusable="false">
    <title id="wm-title">${title || D.title}</title>
    <desc id="wm-desc">${desc || D.desc}</desc>
    ${raw(shapes.map(String).join(''))}
  </svg>
  <figcaption class="wm-legend">
    <span class="wm-key"><i class="wm-sw wm-sw--l3"></i>${lg.l3}</span>
    <span class="wm-key"><i class="wm-sw wm-sw--l2"></i>${lg.l2}</span>
    <span class="wm-key"><i class="wm-sw wm-sw--l1"></i>${lg.l1}</span>
    <span class="wm-key"><i class="wm-sw wm-sw--l0"></i>${lg.none}</span>
  </figcaption>
</figure>`;
}

/** CSS 字串（不含 <style> 標籤），由 travel.mjs 併入。顏色變數有 fallback，單獨使用也能正確顯示。 */
export const styles = `
.wm-fig{margin:var(--sp-3,12px) 0;padding:0}
.wm-svg{width:100%;height:auto;aspect-ratio:960/500;display:block}
.wm{stroke:var(--white,#fff);stroke-width:.5;stroke-linejoin:round;fill:var(--line-2,#eceef1)}
.wm--l1{fill:var(--tv-watch,#b07800);fill-opacity:.35}
.wm--l2{fill:var(--tv-alert,#c4511a)}
.wm--l3{fill:var(--tv-warning,#9b1c1c)}
.wm--tw{fill:var(--ink-3,#5b636c)}
.wm-link{cursor:pointer;outline:none}
.wm-link:hover .wm,.wm-link:focus-visible .wm{stroke:var(--ink,#1b1f23);stroke-width:1.5}
.wm-legend{display:flex;flex-wrap:wrap;gap:6px 18px;margin-top:var(--sp-2,8px);font-size:var(--fs-sm,.875rem);color:var(--ink-2,#444b53)}
.wm-key{display:inline-flex;align-items:center;gap:6px}
.wm-sw{display:inline-block;width:14px;height:14px;border-radius:3px;border:1px solid var(--line,#d9dde2)}
.wm-sw--l1{background:var(--tv-watch,#b07800);opacity:.35}
.wm-sw--l2{background:var(--tv-alert,#c4511a)}
.wm-sw--l3{background:var(--tv-warning,#9b1c1c)}
.wm-sw--l0{background:var(--line-2,#eceef1)}
@media (forced-colors:active){.wm{stroke:CanvasText}.wm--l1,.wm--l2,.wm--l3{fill:Highlight}}
`.trim();
