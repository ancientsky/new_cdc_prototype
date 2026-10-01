// 頁面登錄表：決定哪些路徑要輸出、用哪個模板、哪些語言。
// 模板簽名：render(ctx, props) → Raw/string。ctx 由 makeCtx 建立。
import { config } from '../../site.config.mjs';
import { makeUrl, fmtDate } from './render.mjs';
import { t as i18nT } from '../../src/client/i18n.js';
import { layout } from '../../src/templates/layout.mjs';
import * as home from '../../src/templates/public/home.mjs';
import * as disease from '../../src/templates/public/disease.mjs';
import * as notfound from '../../src/templates/public/notfound.mjs';

export function makeCtx(site, lang, extra = {}) {
  const url = makeUrl(lang);
  return { site, lang, url, t: (key, vars) => i18nT(lang, key, vars), fmtDate: (d) => fmtDate(d, lang), today: site.today, view: 'public', ...extra };
}

/** 判斷某內容在某語言是否可渲染（一級內容需 reviewed；其他 reviewed/machine 皆可） */
export function langAvailable(site, item, lang) {
  if (lang === 'zh-TW') return true;
  const st = item.languages?.[lang]?.status;
  if (!st || st === 'none' || st === 'pending') return false;
  if (site.config.tier1Types.includes(item.type)) return st === 'reviewed';
  return true;
}

/** 回傳頁面清單：{ path, lang, template, props, alt: {lang: path} } */
export function pageList(site) {
  const pages = [];
  for (const L of config.langs) {
    const lang = L.code;
    pages.push({ path: '/', lang, template: home, props: {} });
    for (const d of site.collections.diseases) if (langAvailable(site, d, lang)) pages.push({ path: `/diseases/${d.slug}/`, lang, template: disease, props: { item: d }, md: true });
  }
  pages.push({ path: '/404.html', lang: 'zh-TW', template: notfound, props: {}, file: true });
  return pages;
}

export function renderAllPages(site, write) {
  const pages = pageList(site);
  const byPath = new Map();
  for (const p of pages) { if (!byPath.has(p.path)) byPath.set(p.path, {}); byPath.get(p.path)[p.lang] = true; }
  let n = 0;
  for (const p of pages) {
    const ctx = makeCtx(site, p.lang, { path: p.path, alternates: Object.keys(byPath.get(p.path)) });
    const body = p.template.render(ctx, p.props);
    const htmlOut = layout(ctx, { ...(p.template.meta?.(ctx, p.props) ?? {}), body });
    const langDef = config.langs.find((l) => l.code === p.lang);
    const out = p.file ? p.path.replace(/^\//, '') : `${langDef.path}${p.path}index.html`.replace(/^\//, '');
    write(out, String(htmlOut));
    n++;
    if (p.md && p.template.markdown) write(`${langDef.path}${p.path.replace(/\/$/, '')}.md`.replace(/^\//, ''), p.template.markdown(ctx, p.props));
  }
  return n;
}
