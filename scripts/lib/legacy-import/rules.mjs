// 規則比對：URL 模式 → 型別與目錄、類別 → owner、疾病別名 → disease id、標題關鍵字 → blocks key、Bulletin typeid → newsType。
// 規則本身是資料（content/migration/import/_import-rules.json），這裡只有比對邏輯。
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../load.mjs';

export const DEFAULT_RULES_PATH = path.join(ROOT, 'content/migration/import/_import-rules.json');

export function loadRules(file = DEFAULT_RULES_PATH) {
  const p = path.resolve(file);
  if (!fs.existsSync(p)) throw new Error(`找不到規則檔 ${file}`);
  const rules = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (!Array.isArray(rules.urlPatterns) || !rules.urlPatterns.length) throw new Error(`規則檔缺 urlPatterns：${file}`);
  rules.__file = path.relative(ROOT, p);
  return rules;
}

/** 網址 → { path, query(URLSearchParams), origin }；相對網址以 siteBase 補齊 */
export function parseUrl(u, base = 'https://www.cdc.gov.tw') {
  try {
    const url = new URL(u, base);
    return { origin: url.origin, path: decodeURIComponentSafe(url.pathname), rawPath: url.pathname, query: url.searchParams, search: url.search, hash: url.hash.replace(/^#/, '') };
  } catch {
    return { origin: '', path: String(u ?? ''), rawPath: String(u ?? ''), query: new URLSearchParams(), search: '', hash: '' };
  }
}
function decodeURIComponentSafe(s) { try { return decodeURIComponent(s); } catch { return s; } }

/** URL 模式比對：回傳第一個命中的 pattern 規則（或 null）。路徑大小寫不分（舊站大小寫不一）。 */
export function matchUrlPattern(rules, url) {
  const u = typeof url === 'string' ? parseUrl(url, rules.siteBase) : url;
  for (const p of rules.urlPatterns) if (new RegExp(p.match, 'i').test(u.path)) return p;
  return null;
}

/** Bulletin typeid → { newsType, label, lang?, hint? }；找不到回傳 null */
export function bulletinType(rules, url) {
  const u = typeof url === 'string' ? parseUrl(url, rules.siteBase) : url;
  const id = u.query.get('typeid') ?? u.query.get('typeId') ?? u.query.get('TypeId');
  if (id == null) return null;
  return rules.bulletinTypes?.[String(id)] ? { typeid: String(id), ...rules.bulletinTypes[String(id)] } : { typeid: String(id), unknown: true };
}

/** 類別（「結核病／防治政策」）→ owner；最長前綴優先。回傳 { owner, rule } 或 null */
export function ownerForCategory(rules, category, breadcrumbs = []) {
  const cats = [category, breadcrumbs.join('／')].filter(Boolean);
  let best = null;
  for (const r of rules.categoryOwners ?? []) {
    if (cats.some((c) => String(c).startsWith(r.match) || String(c).includes(r.match))) {
      // 第十批修正：best.rule 是字串，原本 best.rule.match.length 取到的是 String.prototype.match 的參數個數（恆為 1），語意變成「後面命中的覆蓋前面」；改回「最長命中優先」
      if (!best || r.match.length > best.rule.length) best = { owner: r.owner, rule: r.match };
    }
  }
  return best;
}

/** 疾病 id → 草稿 id 用的短碼：規則檔 short 優先，否則取主檔 id 去掉 disease. 前綴（disease.dengue → dengue） */
export function shortFor(rules, diseaseId) {
  const r = (rules.diseases ?? []).find((d) => d.id === diseaseId);
  return r?.short ?? String(diseaseId ?? '').replace(/^disease\./, '') ?? 'x';
}

/**
 * 在文字中找疾病：候選以主檔（content/master/diseases.json）每一種疾病為底，名稱＋主檔別名＋規則檔別名；最長命中優先。
 * 回傳 [{ id, hit }]（依出現順序、去重）。第九輪只認規則檔列的疾病，第十輪改成主檔全列，規則檔只補舊站寫法。
 */
export function detectDiseases(rules, masterDiseases, texts) {
  const byId = new Map();
  for (const m of masterDiseases ?? []) byId.set(m.id, { id: m.id, names: [m.name, ...(m.aliases ?? [])].filter(Boolean) });
  for (const d of rules.diseases ?? []) {
    const e = byId.get(d.id) ?? { id: d.id, names: [] };
    e.names = [...new Set([...e.names, ...(d.aliases ?? [])])];
    byId.set(d.id, e);
  }
  const entries = [...byId.values()];
  const found = [];
  for (const text of texts.filter(Boolean)) {
    const t = String(text);
    // 每個疾病取它最長的別名命中位置，再依位置排序；純英文縮寫（TB、Flu…）要整字命中，避免「LTBI」裡的 TB 之類的誤判
    const hits = [];
    for (const e of entries) {
      const names = [...e.names].sort((a, b) => b.length - a.length);
      const n = names.find((x) => x && (/^[A-Za-z0-9 .-]+$/.test(x) ? new RegExp(`(^|[^A-Za-z0-9])${x.replace(/[.*+?^$|()[\]\\]/g, '\\$&')}(?![A-Za-z0-9])`, 'i').test(t) : t.includes(x)));
      if (n) { const at = /^[A-Za-z0-9 .-]+$/.test(n) ? t.search(new RegExp(n.replace(/[.*+?^$|()[\]\\]/g, '\\$&'), 'i')) : t.indexOf(n); hits.push({ id: e.id, hit: n, at, len: n.length }); }
    }
    // 較長名稱涵蓋較短者（「多重抗藥性結核病」涵蓋「結核病」）：同一位置範圍內只留較長的
    hits.sort((a, b) => a.at - b.at || b.len - a.len);
    const covered = (h) => hits.some((g) => g !== h && g.len > h.len && g.at <= h.at && g.at + g.len >= h.at + h.len);
    for (const h of hits) if (!covered(h) && !found.some((f) => f.id === h.id)) found.push(h);
  }
  return found;
}

/** 標題（或小節標題）關鍵字 → disease block key；回傳 key 或 null。依規則陣列順序比對（先列者優先）。 */
export function blockKeyFor(rules, title) {
  const t = String(title ?? '');
  for (const r of rules.blockKeywords ?? []) if (r.keys.some((k) => t.includes(k))) return r.block;
  return null;
}

/** MPage／Page 是否應併入疾病頁區塊：麵包屑／類別含 mergeScopes 之一，且標題能對到區塊 */
export function mergeBlockFor(rules, { title, breadcrumbs = [], category = '' }) {
  const scope = (rules.mergeScopes ?? []).some((s) => breadcrumbs.some((b) => b.includes(s)) || category.includes(s));
  if (!scope) return null;
  return blockKeyFor(rules, title) ?? blockKeyFor(rules, breadcrumbs[breadcrumbs.length - 1]);
}

export function docTypeFor(rules, title, pattern, url) {
  if (pattern?.docType) return { docType: pattern.docType, clear: true };
  if (pattern?.docTypeByPath) {
    const u = typeof url === 'string' ? parseUrl(url, rules.siteBase) : url;
    for (const [k, v] of Object.entries(pattern.docTypeByPath)) if (new RegExp(`/${k}/`, 'i').test(u.path)) return { docType: v, clear: true };
  }
  for (const r of rules.docTypeKeywords ?? []) if (r.keys.some((k) => String(title).includes(k))) return { docType: r.docType, clear: true };
  return { docType: 'guideline', clear: false };
}

export function stripTitlePrefix(rules, title) {
  let t = String(title ?? '').trim();
  for (const p of rules.titlePrefixes ?? []) if (t.startsWith(p)) { t = t.slice(p.length).trim(); break; }
  return t;
}

export const normTitle = (s) => String(s ?? '').replace(/[\s\u3000？?！!。．.：:、，,（）()「」『』"'“”]/g, '').replace(/^Q\d+[.、．:：]?/i, '').toLowerCase();

/** 舊網址（含 {id}、{infoId}、{uaid} 佔位）→ 比對用的 RegExp（比對 path，不含 fragment；query 另外比） */
export function manifestPathRegex(oldUrl) {
  const noHash = String(oldUrl).split('#')[0];
  const u = parseUrl(noHash.replace(/\{[a-z]+\}/gi, 'PLACEHOLDERX'));
  const esc = (s) => s.replace(/[.*+?^$|()[\]\\]/g, '\\$&').replace(/PLACEHOLDERX/g, '[^/?#]+');
  return new RegExp(`^${esc(u.path)}/?$`, 'i');
}

export function ageYears(from, to) {
  if (!from || !to) return null;
  return (new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / (365.25 * 86400000);
}
