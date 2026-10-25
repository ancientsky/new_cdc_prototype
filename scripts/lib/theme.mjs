// @ts-check
// 第六十輪（Issue #127）：節慶主題（content/themes/<id>.json）——有日期、有權責的內容，不是程式變更。
//
// 契約（細節與理由見 ARCHITECTURE 63、docs/architecture-decisions.md §46、docs/guide-staff.md）：
//   - 生效區間＝[publishAt, unpublishAt)。兩者都以「真實現在時間」判斷（與排程發布同一套 publishAtMs／nowOf，不受 BUILD_TODAY 影響）；
//     只填日期＝當日 00:00 台灣時間。主站每 2 小時重建（pages.yml schedule），所以上架、下架最多晚 2 小時，不必有人去按。
//   - 只准改「裝飾層」：tokens 只能覆寫 THEME_TOKENS 列出的變數（頁首底色、頁首上緣飾條兩色）；裝飾圖只能放在 decoration.svg，
//     建置時轉成 --theme-decoration（CSS 背景圖，輔助科技本來就讀不到，不必 alt）。狀態色、文字色、焦點框一律不准動。
//   - 產生的 CSS 只有一條規則 :root[data-theme="<slug>"]{ 自訂屬性… }，沒有任何選擇器或屬性可以「順便」改到別的地方。
//   - 同一時間最多一個主題生效；兩個主題的生效區間重疊 ⇒ 建置失敗（validate）。
//   - 疫情中心在 content/situation/current.json 發布 alertLevel: "emergency" ⇒ 不套用任何主題（建置記錄原因）。
//     警戒等級一律由疫情中心人工發布，程式不推論（architecture-decisions §9）。
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './load.mjs';
import { publishAtMs, nowOf, taipeiTime } from './lanes.mjs';

/** 文字與背景的最低對比（WCAG 2.x 一般文字 AA） */
export const MIN_CONTRAST = 4.5;
/** 裝飾圖（SVG 原始碼）上限：50 KB */
export const DECORATION_MAX_BYTES = 50 * 1024;

/**
 * 可覆寫的裝飾 token（白名單）。kind=background：當作背景，要和 pairs 列的文字色逐一檢查對比 ≥ 4.5:1；
 * kind=decoration：純裝飾色（飾條），上面不放文字，不檢查對比。預設值寫在 src/styles/tokens.css（＝沒有主題時的外觀）。
 * 新增一個 token 前請先確認：它在 src/styles/ 裡只用在裝飾位置；若當背景，pairs 要列齊所有疊在上面的文字色。
 */
export const THEME_TOKENS = {
  '--theme-header-bg': { kind: 'background', label: '頁首底色（站名、英文副名疊在上面）', pairs: ['--ink', '--ink-3'] },
  '--theme-accent': { kind: 'decoration', label: '頁首上緣飾條（左端色）' },
  '--theme-accent-2': { kind: 'decoration', label: '頁首上緣飾條（右端色）' },
};
/** 由 decoration.svg 產生、不能在 tokens 直接填的 token */
export const DECORATION_TOKEN = '--theme-decoration';

const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

// ───────────────────────── 對比（WCAG 2.x 相對亮度） ─────────────────────────

/** '#abc'／'#aabbcc' → [r,g,b]（0–255）；不是 hex ⇒ null */
export function parseHex(hex) {
  const s = String(hex ?? '').trim();
  if (!HEX_RE.test(s)) return null;
  const h = s.length === 4 ? s.slice(1).split('').map((c) => c + c).join('') : s.slice(1);
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

/** 相對亮度（WCAG 2.x 定義：sRGB 線性化後 0.2126R + 0.7152G + 0.0722B） */
export function relativeLuminance(hex) {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb.map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** 對比值 (L1+0.05)/(L2+0.05)，1–21；任一色無法解析 ⇒ null */
export function contrastRatio(a, b) {
  const la = relativeLuminance(a), lb = relativeLuminance(b);
  if (la == null || lb == null) return null;
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

// ───────────────────────── 基礎 token（src/styles/tokens.css） ─────────────────────────

let baseCache = null;
/** 讀 tokens.css 的 `--name: value`（var(--x) 解一層）。對比檢查用它取文字色，不在這裡另抄一份色碼 */
export function baseTokens(file = path.join(ROOT, 'src/styles/tokens.css')) {
  if (baseCache && baseCache.file === file) return baseCache.map;
  const css = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const map = new Map();
  for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;}]+)/gi)) map.set(m[1], m[2].trim());
  for (const [k, v] of map) {
    const ref = /^var\((--[a-z0-9-]+)\)$/i.exec(v);
    if (ref && map.has(ref[1])) map.set(k, map.get(ref[1]));
  }
  baseCache = { file, map };
  return map;
}

// ───────────────────────── 裝飾圖 ─────────────────────────

/** 裝飾 SVG 的問題（字串陣列）。只收純向量圖：不准腳本、事件屬性、外部參照、內嵌 HTML，也不准動畫 */
export function svgProblems(svg) {
  const out = [];
  const s = String(svg ?? '');
  const bytes = Buffer.byteLength(s, 'utf8');
  if (bytes > DECORATION_MAX_BYTES) out.push(`decoration.svg ${(bytes / 1024).toFixed(1)} KB，超過 ${DECORATION_MAX_BYTES / 1024} KB 上限（請簡化路徑或改用較小的圖）`);
  if (!/^\s*<svg[\s>]/i.test(s) || !/<\/svg>\s*$/i.test(s)) out.push('decoration.svg 必須是一段完整的 <svg>…</svg>');
  if (!/\sxmlns="http:\/\/www\.w3\.org\/2000\/svg"/.test(s)) out.push('decoration.svg 缺 xmlns="http://www.w3.org/2000/svg"（當 CSS 背景圖時沒有它瀏覽器不顯示）');
  if (/<script|<foreignObject|<iframe|<image\b|<use\b/i.test(s)) out.push('decoration.svg 不得含 script、foreignObject、iframe、image、use');
  if (/\son[a-z]+\s*=/i.test(s)) out.push('decoration.svg 不得含事件屬性（on…=）');
  if (/(?:xlink:)?href\s*=\s*["'](?!#)/i.test(s) || /url\(\s*['"]?(?!#)/i.test(s) || /@import/i.test(s)) out.push('decoration.svg 不得參照外部資源（href／url() 只能指向同一張圖內的 #id）');
  // 背景圖裡的 SMIL 動畫不受 prefers-reduced-motion 管（tokens.css 的全站關動畫規則只管 CSS 動畫），所以一律不收
  if (/<animate|<set\b|@keyframes|animation\s*:/i.test(s)) out.push('decoration.svg 不得含動畫（<animate>／<set>／@keyframes）：背景圖的動畫無法依 prefers-reduced-motion 關掉');
  return out;
}

/** SVG → CSS url("data:…")。encodeURIComponent 會編掉 " ' 以外的危險字元；再把 ' ( ) 也編掉，值不可能跳出 url("…") */
export const svgDataUrl = (svg) => `url("data:image/svg+xml,${encodeURIComponent(String(svg).trim()).replace(/'/g, '%27').replace(/\(/g, '%28').replace(/\)/g, '%29')}")`;

// ───────────────────────── 驗證 ─────────────────────────

/** 主題 id → data-theme／檔名用的 slug：theme.halloween-2026 → halloween-2026 */
export const themeSlug = (item) => String(item?.id ?? '').replace(/^theme\./, '');
/** 生效區間（毫秒）；欄位缺或無效 ⇒ null */
export function windowOf(item) {
  const from = publishAtMs(item?.publishAt), to = publishAtMs(item?.unpublishAt);
  return from == null || to == null ? null : { from, to };
}

/**
 * 單一主題的問題（schema 以外：白名單、色碼、對比、裝飾圖、區間先後）。
 * @param {any} item @param {{ base?: Map<string,string> }} [o]
 */
export function themeProblems(item, { base = baseTokens() } = {}) {
  const out = [];
  const tokens = item?.tokens ?? {};
  for (const [k, v] of Object.entries(tokens)) {
    if (k === DECORATION_TOKEN) { out.push(`tokens.${k} 不能直接填：裝飾圖請放 decoration.svg（建置時才轉成 ${k}）`); continue; }
    const def = THEME_TOKENS[k];
    if (!def) { out.push(`tokens.${k} 不在可覆寫清單（只准 ${Object.keys(THEME_TOKENS).join('、')}；狀態色、文字色、焦點框不能由主題改）`); continue; }
    if (!HEX_RE.test(String(v))) { out.push(`tokens.${k} 必須是 #rgb 或 #rrggbb 色碼（收到 ${JSON.stringify(v)}）`); continue; }
    if (def.kind === 'background') {
      for (const fgName of def.pairs ?? []) {
        const fg = base.get(fgName);
        const r = contrastRatio(String(v), fg);
        if (r == null) out.push(`tokens.${k}：無法取得 ${fgName} 的色碼（src/styles/tokens.css），不能確認對比`);
        else if (r < MIN_CONTRAST) out.push(`tokens.${k} ${v} 與文字色 ${fgName}（${fg}）對比 ${r.toFixed(2)}:1，低於 ${MIN_CONTRAST}:1`);
      }
    }
  }
  if (item?.decoration?.svg != null) out.push(...svgProblems(item.decoration.svg));
  const w = windowOf(item);
  if (!w) out.push('publishAt 與 unpublishAt 都必填且要是有效日期');
  else if (w.to <= w.from) out.push(`unpublishAt（${item.unpublishAt}）必須晚於 publishAt（${item.publishAt}）`);
  return out;
}

/** 已發布主題中，生效區間互相重疊的組合 → [[a, b], …] */
export function overlappingThemes(themes) {
  const list = (themes ?? []).filter((t) => t.status === 'published').map((t) => ({ t, w: windowOf(t) })).filter((x) => x.w && x.w.to > x.w.from);
  const out = [];
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i], b = list[j];
    if (a.w.from < b.w.to && b.w.from < a.w.to) out.push([a.t, b.t]);
  }
  return out;
}

// ───────────────────────── 現在套用哪一個 ─────────────────────────

/** 目前在生效區間內（published、publishAt ≤ now < unpublishAt） */
export function isThemeLive(item, now) {
  const w = windowOf(item);
  const t = nowOf(now);
  return !!w && item.status === 'published' && w.from <= t && t < w.to;
}

/**
 * 這次建置要套用的主題。site 用完整 site 或 publicView 都可以（排程中的主題 publicView 會藏起來，這裡從 fullSite 找）。
 * → { active: item|null, reason: 'active'|'none'|'emergency'|'overlap', live: item[], alertLevel, message }
 */
export function themeState(site, now = nowOf(site)) {
  const all = (site?.fullSite ?? site)?.collections?.themes ?? [];
  const live = all.filter((t) => isThemeLive(t, now));
  const alertLevel = site?.situation?.alertLevel ?? 'normal';
  const ids = live.map((t) => t.id).join('、');
  if (!live.length) return { active: null, reason: 'none', live, alertLevel, message: '節慶主題：目前沒有生效中的主題' };
  if (alertLevel === 'emergency') return { active: null, reason: 'emergency', live, alertLevel, message: `節慶主題：疫情中心發布 alertLevel=emergency（content/situation/current.json），不套用 ${ids}` };
  if (live.length > 1) return { active: null, reason: 'overlap', live, alertLevel, message: `節慶主題：同時有 ${live.length} 個主題生效（${ids}），不套用任何一個（validate 應已擋下）` };
  const t = live[0];
  return { active: t, reason: 'active', live, alertLevel, message: `節慶主題：套用 ${t.id}（至 ${taipeiTime(windowOf(t).to)} 台灣時間下架）` };
}

/** 生效主題的 CSS（只有一條 :root[data-theme] 規則、只有白名單內的自訂屬性） */
export function themeCss(item) {
  const slug = themeSlug(item);
  const decls = Object.entries(item.tokens ?? {}).filter(([k, v]) => THEME_TOKENS[k] && HEX_RE.test(String(v))).map(([k, v]) => `${k}:${String(v).toLowerCase()}`);
  if (item.decoration?.svg) decls.push(`${DECORATION_TOKEN}:${svgDataUrl(item.decoration.svg)}`);
  return `/* 節慶主題 ${item.id}（${item.__file ?? 'content/themes/'}；權責 ${item.owner}）：建置產生，請勿手改。只覆寫裝飾 token（scripts/lib/theme.mjs THEME_TOKENS） */\n:root[data-theme="${slug}"]{${decls.join(';')}}\n`;
}

/** 生效主題 CSS 的站內路徑（不含 basePath） */
export const themeCssPath = (item) => `/assets/styles/theme-${themeSlug(item)}.css`;
