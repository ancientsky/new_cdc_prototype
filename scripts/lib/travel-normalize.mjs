// 旅遊疫情：官方匯出欄位名容錯（中英欄位、CAP 樣式欄位），補上本站慣用欄位（原欄位保留）。
// 第四十三輪自 scripts/fetch-data.mjs 移出（行為不變），讓國際疫情匯入器（scripts/lib/intl-epidemic.mjs）與 fetch-data 共用而不循環匯入。

export const LEVEL_TEXT = { 1: '第一級：注意(Watch)', 2: '第二級：警示(Alert)', 3: '第三級：警告(Warning)' };
export const LEVEL_NONE = '無旅遊疫情建議';
export const pick = (o, keys) => {
  for (const k of keys) if (o?.[k] != null && o[k] !== '') return o[k];
  return null;
};
const TK = {
  country: ['Country', '國家/地區', '國家／地區', '國家', '國家名稱', 'areaDesc', 'country', 'CountryName', 'CountryZh'],
  countryEn: ['CountryEn', '英文國名', '英文名稱', 'areaDesc_EN', 'country_en', 'CountryEnglish', 'EnglishName'],
  iso: ['ISO2', 'ISO', 'Iso2', 'iso2', 'ISO3166', 'CountryCode', '國家代碼'],
  disease: ['Disease', '疾病', '疾病名稱', 'alert_disease', 'disease', 'DiseaseName', 'headline'],
  diseaseEn: ['DiseaseEn', '疾病英文名稱', 'alert_disease_EN', 'DiseaseEnglish'],
  region: ['Region', '區域', '洲別', '地區', 'regionDesc', 'region'],
  level: ['Level', '等級', '旅遊疫情建議等級', '疫情等級', 'severity_level', 'level', 'LevelName', 'AlertLevel'],
  levelCode: ['LevelCode', 'levelCode', 'Level_Code', 'LevelNo'],
  start: ['StartDate', '發布日期', '發布日', '發佈日期', '日期', '調整日期', 'effective', 'Effective', 'sent', 'PublishDate', 'Date'],
  summary: ['Summary', '摘要', '內容', '建議', '說明', 'description', 'instruction', 'Content', 'summary'],
  area: ['Area', '區域說明', '省份', '疫區', 'areaDetail'],
  url: ['Url', '網址', '連結', 'web', 'url', 'link'],
};

/** 等級文字／數字 → 0–3（0＝無建議；null＝無法判讀）。例：「第一級：注意(Watch)」→ 1、「Level 2: Alert」→ 2、「無」→ 0 */
export function normalizeLevel(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v >= 0 && v <= 3 ? Math.trunc(v) : null;
  const s = String(v).trim();
  if (/^[0-3]$/.test(s)) return Number(s);
  const m = s.match(/第\s*([一二三1-3])\s*級|level\s*([1-3])|^([1-3])\b/i);
  if (m) {
    const x = m[1] ?? m[2] ?? m[3];
    return '一二三'.includes(x) ? '一二三'.indexOf(x) + 1 : Number(x);
  }
  if (/warning|警告/i.test(s)) return 3;
  if (/alert|警示/i.test(s)) return 2;
  if (/watch|注意/i.test(s)) return 1;
  if (/^(無|none|解除|—|-)/i.test(s) || /無旅遊疫情建議/.test(s)) return 0;
  return null;
}
/** 日期容錯：2025/8/5、2025-08-05T…、民國 114/08/05 → 2025-08-05 */
export function toISODate(v) {
  if (v == null || v === '') return null;
  const m = String(v)
    .trim()
    .match(/^(\d{2,4})[/.\-年](\d{1,2})[/.\-月](\d{1,2})/);
  if (!m) return String(v).slice(0, 10);
  let y = Number(m[1]);
  if (y < 1911) y += 1911;
  return `${y}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
}
export function normalizeTravelRow(r) {
  if (!r || typeof r !== 'object') return r;
  const levelRaw = pick(r, TK.level);
  let code = pick(r, TK.levelCode);
  code = code != null ? normalizeLevel(code) : normalizeLevel(levelRaw);
  const iso = pick(r, TK.iso);
  const start = pick(r, TK.start);
  const out = {
    ...r,
    Disease: pick(r, TK.disease),
    DiseaseEn: pick(r, TK.diseaseEn),
    Country: pick(r, TK.country),
    CountryEn: pick(r, TK.countryEn),
    ISO2: iso && /^[A-Za-z]{2}/.test(String(iso)) ? String(iso).toUpperCase().slice(0, 2) : null,
    Region: pick(r, TK.region),
    Level: code ? LEVEL_TEXT[code] : code === 0 ? LEVEL_NONE : levelRaw,
    LevelCode: code,
    StartDate: toISODate(start),
    Summary: pick(r, TK.summary),
    Url: pick(r, TK.url),
  };
  if (levelRaw != null && String(levelRaw) !== out.Level) out.LevelRaw = levelRaw;
  const area = pick(r, TK.area);
  if (area != null) out.Area = area;
  if (out.DiseaseEn == null) delete out.DiseaseEn;
  return out;
}
