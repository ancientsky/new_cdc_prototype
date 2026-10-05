// 第十批（宣導素材欄目）的轉換工具：
//   materialScope      類別／麵包屑含規則檔 materialScopes 字樣（宣導素材、多媒體）⇒ 這頁是素材頁
//   materialKind       素材頁 → publication（pubType）或 media（mediaType）：標題先比 materialRules（第一條命中），沒有再由麵包屑最後一層往前比
//   imageOnly          圖片承載唯一資訊（有圖、內文純文字很短）：海報／單張要另有純文字版（可及性）
//   imageGallery       同頁多張圖（≥ 4）：建成一筆、多個 image 資產，不拆成 N 筆
//   imageOnlyAbstract  image-only 出版品的 abstractMarkdown：既有文字＋每張圖的 alt 條列＋（待補：海報文字版）
//   langVariants       附件 label／檔名 → 語言：一筆內容、多語檔案（languages 標 pending）
//   materialOutdated   素材發布時依據的文件版本之後被新版取代（舊版生效 ≤ 素材日 < 新版生效）⇒ 上線前請確認內容仍正確（治理 R9 影音過時的事前版）
//   externalSystemPage 舊頁主要連到外部系統（字少、無站內連結、有站外連結）⇒ 外部網域清單
import { plainText } from './html.mjs';
import { mdLinks, hostOf, isCdcHost } from './types.mjs';

const crumbsText = (category, breadcrumbs) => [category ?? '', ...(breadcrumbs ?? [])].join('／');

/** 類別或麵包屑含規則檔 materialScopes 任一字樣 ⇒ 素材頁 */
export function materialScope(rules, { category = '', breadcrumbs = [] } = {}) {
  const t = crumbsText(category, breadcrumbs);
  return (rules?.materialScopes ?? []).some((s) => s && t.includes(s));
}

const ruleHit = (rules, text) => {
  for (const r of rules?.materialRules ?? []) {
    const m = new RegExp(r.match, 'i').exec(String(text ?? ''));
    if (m) return { r, hit: m[0] };
  }
  return null;
};

/**
 * 素材頁的型別：只在類別／麵包屑含 materialScopes 字樣時生效。
 * 標題優先（第一條命中的 materialRules），標題沒命中再由麵包屑最後一層往前比（「多媒體／動畫」⇒ 動畫）。
 * @returns {{ type: 'publication'|'media', pubType?, mediaType?, via: 'title'|'breadcrumb', rule: string, hit: string } | null}
 */
export function materialKind(rules, { title = '', category = '', breadcrumbs = [] } = {}) {
  if (!materialScope(rules, { category, breadcrumbs })) return null;
  let found = ruleHit(rules, title);
  let via = 'title';
  if (!found) {
    via = 'breadcrumb';
    for (const c of [...(breadcrumbs ?? [])].reverse()) { found = ruleHit(rules, c); if (found) break; }
  }
  if (!found) return null;
  const { r, hit } = found;
  return { type: r.type, ...(r.pubType ? { pubType: r.pubType } : {}), ...(r.mediaType ? { mediaType: r.mediaType } : {}), via, rule: r.match, hit };
}

/** 圖片承載唯一資訊：images ≥ 1 且內文純文字 < minChars × 2（minBodyChars 40 ⇒ 80 字；圖片 alt 不算內文） */
export function imageOnly({ markdown = '', images = 0, minChars = 40 } = {}) {
  if (!(images >= 1)) return false;
  return plainText(markdown).replace(/\s/g, '').length < minChars * 2;
}

/** 同頁 ≥ 4 張圖 ⇒ 圖庫（回傳張數），否則 0 */
export function imageGallery(images, min = 4) {
  const n = Array.isArray(images) ? images.length : Number(images) || 0;
  return n >= min ? n : 0;
}

/** image-only 出版品的摘要：既有文字（不含圖片語法）＋每張圖的 alt 條列＋（待補）佔位 */
export function imageOnlyAbstract(markdown, imageAssets = []) {
  const text = String(markdown ?? '').replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\n{3,}/g, '\n\n').trim();
  const alts = imageAssets.map((a) => `- ${a.alt}${a.needsAlt ? '（舊頁沒有替代文字，待補 alt）' : ''}`);
  return [text, alts.length ? `圖片內容（替代文字）：\n\n${alts.join('\n')}` : '', '（待補：海報文字版）'].filter(Boolean).join('\n\n');
}

// 語言判斷：先比簡體（「簡體中文」也含「中文」）再比繁中；站上七語以外的語言（zh-CN）只記在 note
const LANG_RULES = [
  ['zh-CN', /簡體|简体/i],
  ['en', /英文|English/i],
  ['ja', /日文|日本語/i],
  ['vi', /越南|Tiếng Việt|Vietnamese/i],
  ['id', /印尼|Bahasa Indonesia|Indonesian/i],
  ['th', /泰文|泰語|ไทย|Thai/i],
  ['tl', /菲律賓|Tagalog|Filipino/i],
  ['zh-TW', /中文|繁中|繁體/i],
];
export const SITE_LANGS = new Set(['zh-TW', 'en', 'ja', 'tl', 'vi', 'id', 'th']);

/** 附件 → Map(lang → attachment[])：依 label，其次檔名；看不出語言的附件不列 */
export function langVariants(attachments = []) {
  const map = new Map();
  for (const a of attachments ?? []) {
    const texts = [a.label, a.file].filter(Boolean);
    const lang = LANG_RULES.find(([, re]) => texts.some((t) => re.test(String(t))))?.[0];
    if (!lang) continue;
    if (!map.has(lang)) map.set(lang, []);
    map.get(lang).push(a);
  }
  return map;
}

/**
 * 素材是否早於依據正本（治理 R9「依據已修訂」的事前版）：
 * 同疾病的已發布文件依家族（family）分版次；素材發布日落在某家族「舊版生效 ≤ 素材日 < 新版生效」之間 ⇒ 素材是依舊版做的、正本已修訂
 * ⇒ { docId（現行最新版）, effectiveAt, supersededId（素材當時的版本）, supersededAt }；多個家族命中取現行版最新者。
 * 只有一版的文件、或素材日早於家族第一版（當時沒有正本可依）都不算——那是「久遠」（old-content），不是「依據已修訂」。
 */
export function materialOutdated({ publishedAt, diseaseId, contentIndex } = {}) {
  if (!publishedAt || !diseaseId) return null;
  const byId = contentIndex?.byId ?? contentIndex;
  if (!byId?.entries) return null;
  const fams = new Map();
  for (const [id, x] of byId.entries()) {
    if (x.type !== 'document' || x.status !== 'published' || !(x.diseases ?? []).includes(diseaseId) || !x.effectiveAt) continue;
    const f = x.family ?? id;
    if (!fams.has(f)) fams.set(f, []);
    fams.get(f).push({ id, effectiveAt: String(x.effectiveAt) });
  }
  const at = String(publishedAt);
  let best = null;
  for (const vs of fams.values()) {
    vs.sort((a, b) => a.effectiveAt.localeCompare(b.effectiveAt) || a.id.localeCompare(b.id));
    const then = [...vs].reverse().find((v) => v.effectiveAt <= at);
    const latest = vs.at(-1);
    if (!then || latest.effectiveAt <= at) continue;
    const cand = { docId: latest.id, effectiveAt: latest.effectiveAt, supersededId: then.id, supersededAt: then.effectiveAt };
    if (!best || cand.effectiveAt > best.effectiveAt || (cand.effectiveAt === best.effectiveAt && cand.docId < best.docId)) best = cand;
  }
  return best;
}

/**
 * 外部系統入口頁：內文純文字 < maxChars、站內／舊站連結 0、站外連結 ≥ 1 ⇒ 站外網域清單（依出現順序、去重）；不是就回空陣列。
 * stat 是 rewriteBody 的統計（links、legacyLinks、fileLinks）。
 */
export function externalSystemPage({ markdown = '', stat = {}, maxChars = 200 } = {}) {
  if (plainText(markdown).replace(/\s/g, '').length >= maxChars) return [];
  if ((stat.legacyLinks ?? 0) > 0) return [];
  const links = mdLinks(markdown);
  if (links.some((l) => l.href.startsWith('/') || isCdcHost(l.href))) return [];
  const ext = links.filter((l) => /^https?:\/\//.test(l.href) && !isCdcHost(l.href)).map((l) => hostOf(l.href)).filter(Boolean);
  return [...new Set(ext)];
}
