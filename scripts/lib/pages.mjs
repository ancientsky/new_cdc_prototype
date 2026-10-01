// 頁面登錄：自動掃描 src/templates/{public,pro,admin}/*.mjs。
// 每個模板模組可匯出：
//   pages(site)              → [{ path, lang?, props, md?: boolean, noindex?: boolean, file?: boolean }]
//   render(ctx, props)       → Raw|string（主體）
//   meta?(ctx, props)        → { title, description, jsonLd, noindex, bodyClass, scripts, item }
//   markdown?(ctx, props)    → string（同頁 .md 機讀版；md:true 才會輸出）
//   layout?                  → 若模組要用自己的 layout（後台），匯出 layout(ctx, pageProps)
// path 以 '/' 開頭、資料夾型路徑以 '/' 結尾；lang 省略＝只出 zh-TW；lang:'*'＝全部語言（模板自行處理可用性）。
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { config } from '../../site.config.mjs';
import { makeUrl, fmtDate } from './render.mjs';
import { t as i18nT } from '../../src/client/i18n.js';
import { layout as defaultLayout } from '../../src/templates/layout.mjs';
import { ROOT } from './load.mjs';

const TEMPLATE_DIRS = ['public', 'pro', 'admin'].map((d) => path.join(ROOT, 'src/templates', d));

export async function loadTemplates() {
  const mods = [];
  for (const dir of TEMPLATE_DIRS) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.mjs') && !x.startsWith('_')).sort()) {
      const mod = await import(pathToFileURL(path.join(dir, f)).href);
      mods.push({ name: `${path.basename(dir)}/${f}`, mod });
    }
  }
  return mods;
}

export function makeCtx(site, lang, extra = {}) {
  const url = makeUrl(lang);
  return { site, lang, url, t: (key, vars) => i18nT(lang, key, vars), fmtDate: (d) => fmtDate(d, lang), today: site.today, view: 'public', ...extra };
}

/** 某內容在某語言是否可渲染：一級內容需 reviewed；其他 reviewed/machine 皆可。 */
export function langAvailable(site, item, lang) {
  if (lang === 'zh-TW') return true;
  const st = item.languages?.[lang]?.status;
  if (!st || st === 'none' || st === 'pending') return false;
  if (site.config.tier1Types.includes(item.type)) return st === 'reviewed';
  return true;
}

export async function renderAllPages(site, write) {
  const mods = await loadTemplates();
  const pages = [];
  for (const { name, mod } of mods) {
    if (typeof mod.pages !== 'function') continue;
    for (const p of mod.pages(site)) {
      const langs = p.lang === '*' ? config.langs.map((l) => l.code) : [p.lang ?? 'zh-TW'];
      for (const lang of langs) pages.push({ ...p, lang, mod, name });
    }
  }
  const byPath = new Map();
  for (const p of pages) { if (!byPath.has(p.path)) byPath.set(p.path, new Set()); byPath.get(p.path).add(p.lang); }
  let n = 0;
  const seen = new Set();
  for (const p of pages) {
    const langDef = config.langs.find((l) => l.code === p.lang);
    const outKey = `${langDef.path}${p.path}`;
    if (seen.has(outKey)) { console.warn(`[pages] 重複路徑略過：${outKey}（${p.name}）`); continue; }
    seen.add(outKey);
    const ctx = makeCtx(site, p.lang, { path: p.path, alternates: [...byPath.get(p.path)], view: p.view ?? 'public' });
    const body = p.mod.render(ctx, p.props ?? {});
    const meta = p.mod.meta?.(ctx, p.props ?? {}) ?? {};
    const lay = p.mod.layout ?? defaultLayout;
    const htmlOut = lay(ctx, { ...meta, noindex: p.noindex ?? meta.noindex, body });
    const out = p.file ? p.path.replace(/^\//, '') : `${langDef.path}${p.path}index.html`.replace(/^\//, '');
    write(out, String(htmlOut));
    n++;
    if (p.md && p.mod.markdown) write(`${langDef.path}${p.path.replace(/\/$/, '')}.md`.replace(/^\//, ''), p.mod.markdown(ctx, p.props ?? {}));
  }
  return n;
}
