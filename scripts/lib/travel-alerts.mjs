// 國際重要疫情資訊（快照 data/snapshots/travel-epidemic.json）的「每則」純規則：站內頁、列表連結、RSS 共用（第四十三輪，docs/intl-epidemic.md §4）。
//
// 快照列沿用舊欄位（Disease、Country、ISO2、StartDate、Summary、Url、headline、description…），匯入器另加
// id、status、areas[]、iso2s[]、body、diseaseId、provenance。這裡對新欄位容錯：
//   - 有合法 id（[A-Za-z0-9_-]{1,64}）才有站內頁 /travel/alerts/{id}/；沒有或不合法 ⇒ 維持舊行為（列表不連站內頁）。
//   - status: 'withdrawn' 的列不產生頁、不進列表、不進 RSS。
// 不 import 任何模板：emit-seo.mjs（RSS／sitemap）與模板都用這一份，避免循環相依。

export const ALERT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
export const ALERT_WINDOW_DAYS = 30;

/** 合法 id 才回傳，否則 null（id 會進網址路徑，只允許安全字元） */
export function alertIdOf(row) {
  const id = row?.id;
  return typeof id === 'string' && ALERT_ID_RE.test(id) ? id : null;
}

export const alertPath = (id) => `/travel/alerts/${id}/`;

const str = (v) => (v == null || v === '' ? null : String(v));
const httpUrl = (v) => (typeof v === 'string' && /^https?:\/\/[^\s"<>]+$/i.test(v.trim()) ? v.trim() : null);
const dateOf = (v) => (v && /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? String(v).slice(0, 10) : null);
/** 文字正規化：\r\n／\r → \n，去頭尾空白 */
export const normText = (s) =>
  s == null
    ? null
    : String(s)
        .replace(/\r\n?/g, '\n')
        .replace(/[ \t　]+\n/g, '\n')
        .replace(/\n[ \t　]+/g, '\n')
        .trim() || null;

/** areas[]：{ country, countryEn, iso2, detail }；缺 areas 時不推（列表另有 ISO3166／Country 的舊邏輯） */
export function areasOf(row) {
  if (!Array.isArray(row?.areas)) return [];
  return row.areas
    .filter((a) => a && typeof a === 'object')
    .map((a) => ({
      country: str(a.country),
      countryEn: str(a.countryEn),
      iso2: /^[A-Za-z]{2}$/.test(String(a.iso2 ?? '')) ? String(a.iso2).toUpperCase() : null,
      detail: normText(a.detail),
    }))
    .filter((a) => a.country || a.countryEn || a.iso2);
}

/** 一則的正規化（新欄位優先，缺則退回舊欄位） */
export function alertOf(row) {
  const r = row ?? {};
  const prov = r.provenance && typeof r.provenance === 'object' ? r.provenance : null;
  const publishedAt = str(r.publishedAt ?? r.effective ?? r.sent ?? r.StartDate);
  const updatedAt = str(r.updatedAt);
  return {
    id: alertIdOf(r),
    status: ['published', 'updated', 'withdrawn'].includes(r.status) ? r.status : 'published',
    headline: normText(r.headline),
    body: normText(r.body ?? r.description ?? r.Summary),
    instruction: normText(r.instruction),
    publishedAt,
    published: dateOf(publishedAt) ?? dateOf(r.StartDate),
    updatedAt,
    updated: dateOf(updatedAt),
    disease: str(r.disease ?? r.Disease ?? r.alert_disease),
    diseaseEn: str(r.diseaseEn ?? r.DiseaseEn),
    diseaseId: str(r.diseaseId ?? r.DiseaseId),
    areas: areasOf(r),
    sourceUrl: httpUrl(r.sourceUrl) ?? httpUrl(r.Url) ?? httpUrl(r.web),
    references: (Array.isArray(r.references) ? r.references : [])
      .filter((x) => x && httpUrl(x.url))
      .map((x) => ({ title: str(x.title) ?? httpUrl(x.url), url: httpUrl(x.url) })),
    provenance: prov ? { source: str(prov.source), producer: str(prov.producer), importedAt: str(prov.importedAt) } : null,
  };
}

const rowsOf = (site) => {
  const snap = site?.snapshots?.travelAlerts;
  const data = Array.isArray(snap?.data) ? snap.data : Array.isArray(snap) ? snap : [];
  return data.filter((x) => x && typeof x === 'object');
};

/** 產生站內頁的則：合法 id、未撤下；同 id 取第一筆 */
export function alertPageRows(site) {
  const seen = new Set();
  const out = [];
  for (const r of rowsOf(site)) {
    const a = alertOf(r);
    if (!a.id || a.status === 'withdrawn' || seen.has(a.id)) continue;
    seen.add(a.id);
    out.push(a);
  }
  return out;
}

const dayShift = (iso, days) => new Date(Date.parse(`${String(iso).slice(0, 10)}T00:00:00Z`) + days * 864e5).toISOString().slice(0, 10);

/** 近 N 天（以快照 meta.dataDate 為準，沒有用 site.today）有站內頁的則，新到舊 */
export function recentAlertRows(site, { days = ALERT_WINDOW_DAYS } = {}) {
  const ref = site?.snapshots?.travelAlerts?.meta?.dataDate ?? site?.today;
  const from = ref ? dayShift(ref, -days) : null;
  return alertPageRows(site)
    .filter((a) => !from || !a.published || a.published >= from)
    .sort((a, b) => String(b.publishedAt ?? '').localeCompare(String(a.publishedAt ?? '')) || a.id.localeCompare(b.id));
}

/** 內文看起來是 Markdown（標題、清單、引用、連結、粗體） */
export const looksLikeMarkdown = (s) => /(^|\n)\s*(#{1,6}\s|[-*+]\s|\d+\.\s|>\s?)|\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*/.test(String(s ?? ''));

/** 純文字段落（空行或單一換行都視為分段；舊匯出以 \r 分段） */
export const paragraphsOf = (s) =>
  String(s ?? '')
    .split(/\n+/)
    .map((x) => x.trim())
    .filter(Boolean);

/** 摘要：純文字、壓成一行、最多 n 字（RSS description、meta description） */
export function excerptOf(s, n = 300) {
  const flat = String(s ?? '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const chars = [...flat];
  return chars.length > n ? `${chars.slice(0, n).join('')}…` : flat;
}
