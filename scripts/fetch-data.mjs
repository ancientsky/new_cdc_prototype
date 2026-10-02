#!/usr/bin/env node
// 從官方來源抓資料到 data/snapshots/，並把 CKAN 目錄同步回 content/datasets/*.json 的「資料欄位」。
// 抓不到（沙箱無法連外、官網暫時無回應）就保留既有快照，一律 exit 0，不讓建置失敗。
//
// 用法：
//   node scripts/fetch-data.mjs            抓取 → 寫回快照 → 同步資料目錄
//   node scripts/fetch-data.mjs --dry      只抓取與比對，不寫任何檔案（列出會變更的內容）
//   node scripts/fetch-data.mjs --no-sync  只更新快照，不動 content/datasets
//   node scripts/fetch-data.mjs --sync-only 不連網，用既有 ckan-packages.json 快照同步資料目錄
//   node scripts/fetch-data.mjs --check-links [--dry]
//        只做外部連結健康檢查（ARCHITECTURE 11.1）：topic.links[]、service.forms[]／applyUrl、news.applyUrl、media.videoUrl、
//        publication.pdfUrl、document.pdfUrl（legacyUrls 不檢）。HEAD（失敗再 GET）、timeout 10 秒、同站併發 ≤ 3、總數上限 300。
//        結果寫回：陣列元素（links[i]、forms[i]）寫在元素上的 lastCheckedAt／status；單一欄位寫在 item.linkChecks[field]。
//        佔位網址（/File/Get/placeholder-*、example.com…）略過、視為 unchecked。全部連不上（沙箱）⇒ 不改檔、exit 0。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXTERNAL_LINK_FIELDS } from './lib/governance.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SNAPSHOTS = path.join(ROOT, 'data', 'snapshots');
const DATASETS_DIR = path.join(ROOT, 'content', 'datasets');
const args = new Set(process.argv.slice(2));
const DRY = args.has('--dry');
const NO_SYNC = args.has('--no-sync');
const SYNC_ONLY = args.has('--sync-only');
const CHECK_LINKS = args.has('--check-links');
const UA = 'cdc-ai-ready-prototype/0.2 (+github pages build)';
const TIMEOUT_MS = 20000;
const log = (...m) => console.log('[fetch]', ...m);

// ── HTTP ─────────────────────────────────────────────
async function getJSON(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': UA, Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    return JSON.parse(text.replace(/^﻿/, ''));
  } finally { clearTimeout(timer); }
}

// ── 快照檔讀寫（保留 meta）─────────────────────────────
function readSnapshot(file) {
  try { return JSON.parse(fs.readFileSync(path.join(SNAPSHOTS, file), 'utf8')); } catch { return null; }
}
function writeSnapshot(file, meta, data) {
  const prev = readSnapshot(file)?.meta ?? {};
  const out = { meta: { ...prev, ...meta, mode: 'live', fetchedAt: new Date().toISOString(), count: Array.isArray(data) ? data.length : null }, data };
  delete out.meta.note; // live 資料不沿用快照的「示意」說明
  if (DRY) { log(`(dry) 不寫入 ${file}：${out.meta.count ?? '?'} 筆`); return; }
  fs.mkdirSync(SNAPSHOTS, { recursive: true });
  fs.writeFileSync(path.join(SNAPSHOTS, file), JSON.stringify(out, null, 2) + '\n');
  log(`✓ ${meta.label} ${out.meta.count ?? ''} 筆 → ${file}`);
}
function keepSnapshot(file, s, err) {
  const exists = fs.existsSync(path.join(SNAPSHOTS, file));
  log(`✗ ${s.label}（${err.message}）→ ${exists ? '沿用既有快照' : '建立空快照'}`);
  if (exists && !DRY) {
    // 保留 data；只在 meta 記錄這次 live 失敗／被拒的原因，後台「資料目錄」可顯示。
    const snap = readSnapshot(file);
    if (snap) {
      snap.meta = { ...snap.meta, lastLiveAttempt: { at: new Date().toISOString(), ok: false, reason: err.message, ...(err.stats ? { stats: err.stats } : {}) } };
      fs.writeFileSync(path.join(SNAPSHOTS, file), JSON.stringify(snap, null, 2) + '\n');
    }
  }
  if (!exists && !DRY) {
    fs.mkdirSync(SNAPSHOTS, { recursive: true });
    fs.writeFileSync(path.join(SNAPSHOTS, file), JSON.stringify({ meta: { mode: 'snapshot', fetchedAt: null, sourceUrl: s.url, label: s.label, note: '尚無快照；請在可連外環境執行 npm run fetch' }, data: [] }, null, 2) + '\n');
  }
}

// ── 旅遊疫情：欄位名容錯（中英欄位），補上本站慣用欄位（原欄位保留）────
// 官方 CountryEpidLevel 匯出（近似）：國家/地區、疾病、等級（「第一級：注意(Watch)」）、發布日期、英文國名、ISO
// 官方 TravelEpidemic 匯出（近似）：疾病、國家、地區、摘要／內容、發布日
// 另容錯 CAP 樣式欄位（alert_disease、severity_level、areaDesc、ISO3166、effective、description…）。
export const LEVEL_TEXT = { 1: '第一級：注意(Watch)', 2: '第二級：警示(Alert)', 3: '第三級：警告(Warning)' };
export const LEVEL_NONE = '無旅遊疫情建議';
export const TRAVEL_LEVEL_PAGE = 'https://www.cdc.gov.tw/InternationalEpidemicLevel/Index/NlUwZUNvckRWQ09CbDJkRVFjaExjUT09';
export const LEVEL_DEFINITIONS = [
  { code: 1, key: 'watch', name: '第一級：注意', nameEn: 'Level 1: Watch', label: LEVEL_TEXT[1], description: '提醒遵守當地的一般預防措施', descriptionEn: 'Practise usual precautions', color: 'watch' },
  { code: 2, key: 'alert', name: '第二級：警示', nameEn: 'Level 2: Alert', label: LEVEL_TEXT[2], description: '對當地採取加強防護', descriptionEn: 'Practise enhanced precautions', color: 'alert' },
  { code: 3, key: 'warning', name: '第三級：警告', nameEn: 'Level 3: Warning', label: LEVEL_TEXT[3], description: '避免所有非必要旅遊', descriptionEn: 'Avoid all non-essential travel', color: 'warning' },
];
const pick = (o, keys) => { for (const k of keys) if (o?.[k] != null && o[k] !== '') return o[k]; return null; };
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
  if (m) { const x = m[1] ?? m[2] ?? m[3]; return '一二三'.includes(x) ? '一二三'.indexOf(x) + 1 : Number(x); }
  if (/warning|警告/i.test(s)) return 3;
  if (/alert|警示/i.test(s)) return 2;
  if (/watch|注意/i.test(s)) return 1;
  if (/^(無|none|解除|—|-)/i.test(s) || /無旅遊疫情建議/.test(s)) return 0;
  return null;
}
/** 日期容錯：2025/8/5、2025-08-05T…、民國 114/08/05 → 2025-08-05 */
export function toISODate(v) {
  if (v == null || v === '') return null;
  const m = String(v).trim().match(/^(\d{2,4})[/.\-年](\d{1,2})[/.\-月](\d{1,2})/);
  if (!m) return String(v).slice(0, 10);
  let y = Number(m[1]); if (y < 1911) y += 1911;
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
  const area = pick(r, TK.area); if (area != null) out.Area = area;
  if (out.DiseaseEn == null) delete out.DiseaseEn;
  return out;
}

const shortLevel = (code) => LEVEL_TEXT[code].replace(/\(.*\)$/, '');
/**
 * 依疾病的等級列（CountryEpidLevel 每列＝國家 × 疾病）→ 每國一筆，Diseases[] 合併（同病取最高等級、最新日期）。
 * countries（選填，master/countries.json）：補 ISO2／英文名／區域；並為主檔中沒有列在表上的國家補「無旅遊疫情建議」一筆，讓 live 與快照形狀一致。
 */
/**
 * 官方 ExportJSON 含歷史紀錄（例如 2020-03-21 全球第三級 COVID-19 警告從未在匯出檔中移除）。
 * 等級表只應呈現「現行」建議，規則：
 *   0. （aggregateCountryLevels）同國家×疾病×區域只看最新一則事件；最新為「解除」⇒ 不列。這是官方匯出檔表示解除的方式（severity_level = 解除）。
 *   1. 原始列若有結束日／解除日／狀態欄位且已結束 ⇒ 排除（欄位名容錯）。
 *   2. 嚴重特殊傳染性肺炎／COVID-19 的建議於 2023-05-01 全面解除（改列第四類） ⇒ 生效日早於該日者排除。
 *   3. 第三級超過 365 天未更新 ⇒ 視為歷史紀錄排除（第一、二級可長期存在，如沙烏地阿拉伯 MERS 第二級自 2015 年起，不排除）。
 */
export const COVID_NOTICES_LIFTED_AT = '2023-05-01';
export function isStaleNotice(d, raw = {}, today = new Date().toISOString().slice(0, 10)) {
  const end = pick(raw, ['EndDate', 'endDate', 'LiftDate', 'ExpireDate', 'expires', '結束日', '結束日期', '解除日', '解除日期', '迄日', '失效日']);
  const status = String(pick(raw, ['Status', 'status', 'IsActive', 'Active', 'IsCurrent', '狀態', '是否現行']) ?? '').toLowerCase();
  if (end && toISODate(end) && toISODate(end) <= today) return true;
  if (status && /(已解除|解除|結束|歷史|inactive|expired|lifted|false|0)$/.test(status) && !/current|active|現行|true|1$/.test(status)) return true;
  const date = toISODate(d.StartDate) ?? toISODate(raw.StartDate) ?? null;
  const name = String(d.Disease ?? '');
  if (/嚴重特殊傳染性肺炎|covid|新冠|sars-cov-2|武漢肺炎/i.test(name) && date && date < COVID_NOTICES_LIFTED_AT) return true;
  if (date) {
    const ageDays = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86400000);
    if (d.LevelCode >= 3 && ageDays > 365) return true;
  }
  return false;
}

export function aggregateCountryLevels(rows, { countries = [], today = new Date().toISOString().slice(0, 10) } = {}) {
  const master = Array.isArray(countries) ? countries : [];
  const findMaster = (r) => master.find((c) => (r.ISO2 && c.iso2 === r.ISO2) || (r.Country && (c.name === r.Country || String(r.Country).startsWith(c.name))) || (r.CountryEn && c.nameEn && c.nameEn.toLowerCase() === String(r.CountryEn).toLowerCase()));
  const groups = new Map();
  // 第一階段（事件日誌模式）：官方匯出檔每列是一則「警示事件」（第一／二／三級或「解除」，severity_level），同一國家×疾病×區域會有多則。
  // 現行建議＝該組合「最新一則」；最新一則為「解除」（LevelCode 0）⇒ 該建議已不存在。快照（每組合一筆）走同一路徑，結果不變。
  const latest = new Map();
  (rows ?? []).forEach((raw, idx) => {
    if (!raw || typeof raw !== 'object') return;
    const r = 'LevelCode' in raw && 'ISO2' in raw ? raw : normalizeTravelRow(raw);
    const m = findMaster(r);
    const iso = r.ISO2 ?? m?.iso2 ?? null;
    const key = iso ?? r.Country;
    if (!key) return;
    if (!groups.has(key)) groups.set(key, { ISO2: iso, Country: m?.name ?? r.Country ?? iso, CountryEn: r.CountryEn ?? m?.nameEn ?? null, Region: m?.region ?? r.Region ?? null, Url: r.Url ?? TRAVEL_LEVEL_PAGE, items: new Map() });
    const subs = Array.isArray(r.Diseases) ? r.Diseases.map((d) => ({ ...d, LevelCode: normalizeLevel(d.LevelCode ?? d.Level) })) : [r];
    for (const d of subs) {
      if (!d.Disease || d.LevelCode == null) continue;
      const k = `${key}\u0000${d.Disease}\u0000${d.Area ?? ''}`;
      const date = toISODate(d.StartDate) ?? '';
      const prev = latest.get(k);
      if (!prev || date > prev.date || (date === prev.date && idx > prev.idx)) latest.set(k, { raw, d, key, date, idx });
    }
  });
  // 第二階段：只保留現行（非解除、非歷史紀錄）；同國同病若有多個區域，取最高等級。
  for (const { raw, d, key, date } of latest.values()) {
    if (!(d.LevelCode > 0)) continue;
    if (isStaleNotice(d, raw.__raw ?? raw, today)) continue;
    const g = groups.get(key);
    const prev = g.items.get(d.Disease);
    if (prev && (prev.LevelCode > d.LevelCode || (prev.LevelCode === d.LevelCode && String(prev.StartDate ?? '') >= date))) continue;
    g.items.set(d.Disease, {
      Disease: d.Disease, ...(d.DiseaseEn ? { DiseaseEn: d.DiseaseEn } : {}), ...(d.DiseaseId ? { DiseaseId: d.DiseaseId } : {}),
      Level: LEVEL_TEXT[d.LevelCode], LevelCode: d.LevelCode, StartDate: date || null, ...(d.Area ? { Area: d.Area } : {}), Summary: d.Summary ?? null, Url: d.Url ?? g.Url,
    });
  }
  for (const c of master) if (![...groups.values()].some((g) => g.ISO2 === c.iso2)) groups.set(c.iso2, { ISO2: c.iso2, Country: c.name, CountryEn: c.nameEn ?? null, Region: c.region ?? null, Url: TRAVEL_LEVEL_PAGE, items: new Map() });
  const order = new Map(master.map((c, i) => [c.iso2, i]));
  const out = [...groups.values()].map((g) => {
    const Diseases = [...g.items.values()].sort((a, b) => b.LevelCode - a.LevelCode || String(b.StartDate ?? '').localeCompare(String(a.StartDate ?? '')));
    const top = Diseases.length ? Math.max(...Diseases.map((d) => d.LevelCode)) : 0;
    const names = Diseases.map((d) => d.Disease);
    let Summary;
    if (!Diseases.length) Summary = '目前無旅遊疫情建議，遵守一般預防措施即可（勤洗手、注意飲食衛生、出現症狀就醫並告知旅遊史）。';
    else {
      const byLv = [3, 2, 1].map((lv) => [lv, Diseases.filter((d) => d.LevelCode === lv).map((d) => d.Disease)]).filter(([, n]) => n.length);
      Summary = `${byLv.map(([lv, n]) => `${n.join('、')}為${shortLevel(lv)}`).join('；')}。${Diseases[0].Summary ?? ''}`.trim();
    }
    return {
      ISO2: g.ISO2, Country: g.Country, CountryEn: g.CountryEn, Region: g.Region,
      Level: top ? LEVEL_TEXT[top] : LEVEL_NONE, LevelCode: top,
      Disease: names.length ? names.join('、') : null, StartDate: Diseases.map((d) => d.StartDate).filter(Boolean).sort().at(-1) ?? null,
      Summary, Diseases, Url: g.Url,
    };
  });
  return out.sort((a, b) => (order.get(a.ISO2) ?? 999) - (order.get(b.ISO2) ?? 999));
}
/** 等級分布（給 meta.stats 與頁面摘要） */
/**
 * live 等級表合理性閘門：官方 CountryEpidLevel/ExportJSON 實為「歷次警示的完整歷史」（每列一則警示，只有生效日、沒有結束日），
 * 直接聚合會得到上百個第二級國家。現行官網頁面實際約：第三級 0–2、第二級 2–6、第一級 20–40。
 * 超出下列上限即視為 live 資料不可直接使用 → 沿用人工校對快照，並把原因寫進 meta.lastLiveAttempt。
 */
export const LEVEL_PLAUSIBLE_MAX = { level3: 5, level2: 20, level1: 60 };
export function assertPlausibleLevels(countryRows, max = LEVEL_PLAUSIBLE_MAX) {
  const st = levelStats(countryRows);
  const bad = Object.entries(max).filter(([k, v]) => st[k] > v);
  if (bad.length) {
    const err = new Error(`live 等級分布不合理（第三級 ${st.level3}、第二級 ${st.level2}、第一級 ${st.level1} 國；上限 ${max.level3}/${max.level2}/${max.level1}）→ 官方匯出檔為歷史警示清單，需結束日或解除紀錄才能判定現行建議`);
    err.stats = st; err.code = 'IMPLAUSIBLE_LEVELS';
    throw err;
  }
  return st;
}
export function levelStats(countryRows) {
  const rows = countryRows ?? [];
  return { level3: rows.filter((r) => r.LevelCode === 3).length, level2: rows.filter((r) => r.LevelCode === 2).length, level1: rows.filter((r) => r.LevelCode === 1).length, none: rows.filter((r) => !r.LevelCode).length, entries: rows.reduce((n, r) => n + (r.Diseases?.length ?? 0), 0) };
}
const asArray = (j) => (Array.isArray(j) ? j : Array.isArray(j?.data) ? j.data : Array.isArray(j?.result) ? j.result : Array.isArray(j?.Data) ? j.Data : []);
const readMasterCountries = () => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'master', 'countries.json'), 'utf8')); } catch { return []; } };

const lastRaw = {};
export const SOURCES = [
  { file: 'travel-epidemic.json', url: 'https://www.cdc.gov.tw/TravelEpidemic/ExportJSON', label: '國際重要疫情資訊（近 30 天）', pick: (j) => asArray(j).map(normalizeTravelRow),
    meta: (data) => ({ sourcePage: TRAVEL_LEVEL_PAGE, dataDate: data.map((r) => r.StartDate).filter(Boolean).sort().at(-1) ?? new Date().toISOString().slice(0, 10) }) },
  { file: 'country-epid-level.json', url: 'https://www.cdc.gov.tw/CountryEpidLevel/ExportJSON', label: '國際旅遊疫情建議等級表',
    pick: (j) => {
      const rawRows = asArray(j); lastRaw.countryLevels = rawRows;
      const today = new Date().toISOString().slice(0, 10);
      const norm = rawRows.map((r) => ({ ...normalizeTravelRow(r), __raw: r }));
      const stale = norm.filter((r) => r.Disease && r.LevelCode > 0 && isStaleNotice(r, r.__raw, today));
      const data = aggregateCountryLevels(norm, { countries: readMasterCountries(), today });
      const st = levelStats(data);
      const byLv = (n) => st[`level${n}`];
      console.log(`[fetch]   等級表：原始 ${rawRows.length} 列，排除歷史紀錄 ${stale.length} 列${stale.length ? `（如 ${stale.slice(0, 3).map((r) => `${r.Country} ${r.Disease} L${r.LevelCode} ${r.StartDate ?? ''}`).join('；')}）` : ''}；聚合後 第三級 ${byLv(3)}、第二級 ${byLv(2)}、第一級 ${byLv(1)} 國；原始欄位：${Object.keys(rawRows[0] ?? {}).join(', ')}`);
      // 診斷（只印 log，不入檔）：了解官方匯出檔如何表示「解除」，以便日後正確判定現行建議
      const cnt = (arr) => { const m = new Map(); for (const v of arr) m.set(v, (m.get(v) ?? 0) + 1); return [...m.entries()].sort((a, b) => b[1] - a[1]); };
      const r0 = rawRows[0] ?? {};
      const titleKey = Object.keys(r0).find((k) => /title/i.test(k));
      const sevKey = Object.keys(r0).find((k) => /severity|level/i.test(k));
      const effKey = Object.keys(r0).find((k) => /effective|date|日/i.test(k));
      const titles = titleKey ? rawRows.map((r) => String(r[titleKey] ?? '')) : [];
      const lifted = titles.filter((t) => /解除|取消|降級|lift|remov/i.test(t));
      const effs = effKey ? rawRows.map((r) => toISODate(r[effKey])).filter(Boolean).sort() : [];
      console.log(`[fetch]   等級表診斷：${sevKey ?? '等級欄'} 值分布 ${JSON.stringify(cnt(rawRows.map((r) => String(r[sevKey] ?? ''))).slice(0, 8))}；生效日範圍 ${effs[0] ?? '?'} ～ ${effs.at(-1) ?? '?'}；標題含「解除／取消／降級」${lifted.length} 則${lifted.length ? `（如 ${lifted.slice(0, 3).map((t) => t.slice(0, 40)).join('｜')}）` : ''}`);
      // 現行（聚合後）各國最高等級與疾病，依等級分析：年份分布、疾病分布、有無 ISO 碼
      const cur = data.flatMap((c) => (c.Diseases ?? []).map((d) => ({ ...d, ISO2: c.ISO2, Country: c.Country })));
      for (const lv of [3, 2, 1]) {
        const xs = cur.filter((d) => d.LevelCode === lv);
        console.log(`[fetch]   等級表診斷 L${lv}：現行 ${xs.length} 筆；年份 ${JSON.stringify(cnt(xs.map((d) => String(d.StartDate ?? '').slice(0, 4))))}；疾病 ${JSON.stringify(cnt(xs.map((d) => d.Disease)).slice(0, 10))}`);
        if (lv <= 2) console.log(`[fetch]   等級表診斷 L${lv} 名單：${xs.map((d) => `${d.Country}/${d.Disease}/${d.StartDate}`).join('、').slice(0, 900)}`);
      }
      const liftedRows = norm.filter((r) => r.LevelCode === 0);
      console.log(`[fetch]   等級表診斷 解除：${liftedRows.length} 則；年份 ${JSON.stringify(cnt(liftedRows.map((r) => String(r.StartDate ?? '').slice(0, 4))))}；疾病 ${JSON.stringify(cnt(liftedRows.map((r) => r.Disease)).slice(0, 8))}；無 ISO 碼 ${liftedRows.filter((r) => !r.ISO2).length} 則（areaDesc 如 ${JSON.stringify(cnt(liftedRows.filter((r) => !r.ISO2).map((r) => r.Country)).slice(0, 5))}）`);
      const noIso = norm.filter((r) => !r.ISO2 && r.LevelCode > 0);
      console.log(`[fetch]   等級表診斷 無 ISO 碼警示：${noIso.length} 則；areaDesc ${JSON.stringify(cnt(noIso.map((r) => r.Country)).slice(0, 8))}；areaDetail 非空列 ${norm.filter((r) => r.Area).length}`);
      assertPlausibleLevels(data);
      return data;
    },
    meta: (data) => ({ sourcePage: TRAVEL_LEVEL_PAGE, levelDefinitions: LEVEL_DEFINITIONS, stats: levelStats(data), dataDate: new Date().toISOString().slice(0, 10),
      rawCount: lastRaw.countryLevels?.length ?? null, rawFields: Object.keys(lastRaw.countryLevels?.[0] ?? {}), rawSample: (lastRaw.countryLevels ?? []).slice(0, 3),
      filterNote: `已排除歷史紀錄：有結束日／已解除者、${COVID_NOTICES_LIFTED_AT} 前的 COVID-19 建議、第三級逾 365 天未更新者` }) },
];

// ── CKAN：package_search 分頁抓全部 ────────────────────
const CKAN = { file: 'ckan-packages.json', base: 'https://data.cdc.gov.tw/api/3/action/package_search', label: 'CKAN 資料集目錄（package_search 精簡版）', rows: 100, maxPages: 50 };
const slimPackage = (p) => ({
  name: p.name, title: p.title, notes: p.notes ?? '', license_id: p.license_id ?? null, license_title: p.license_title ?? null,
  organization: { title: p.organization?.title ?? null }, metadata_modified: p.metadata_modified ?? null,
  resources: (p.resources ?? []).map((r) => ({ format: r.format ?? '', url: r.url ?? '', name: r.name ?? '' })),
});
async function fetchCkanAll() {
  const all = [];
  let total = Infinity;
  for (let page = 0, start = 0; start < total && page < CKAN.maxPages; page++, start += CKAN.rows) {
    const j = await getJSON(`${CKAN.base}?rows=${CKAN.rows}&start=${start}`);
    if (j?.success === false) throw new Error(`CKAN error ${JSON.stringify(j.error ?? {})}`);
    const res = j?.result ?? {};
    total = Number.isFinite(res.count) ? res.count : 0;
    const batch = res.results ?? [];
    all.push(...batch.map(slimPackage));
    if (!batch.length) break;
  }
  return all;
}

// ── 同步 CKAN → content/datasets（只動資料欄位，不碰治理欄位）──
// 允許更新：lastUpdated、formats、resources、license、provenance。其餘（owner、reviewedAt、aiWhitelist、licenseNote…）一律保留。
const STANDARD_LICENSES = ['OGDL-1.0', 'CC0-1.0', 'CC-BY-4.0'];
export function mapLicense(pkg) {
  const id = String(pkg.license_id ?? '').trim();
  const title = String(pkg.license_title ?? '').trim();
  const s = `${id} ${title}`.toLowerCase();
  if (!id && !title) return null;
  if (/cc-?zero|cc0/.test(s)) return 'CC0-1.0';
  if (/ogdl|政府資料開放授權|open government data/.test(s)) return 'OGDL-1.0';
  if (/^cc-by$|^cc-by-4\.0$/.test(id.toLowerCase()) || /cc-by 4\.0|姓名標示 4\.0/.test(s)) return 'CC-BY-4.0';
  if (/notspecified|未標示|not specified/.test(s)) return '未標示';
  return id || title;
}
export function syncDatasetsFromCkan(packages, { dry = false } = {}) {
  const byName = new Map(packages.map((p) => [p.name, p]));
  const changes = [];
  if (!fs.existsSync(DATASETS_DIR)) return changes;
  for (const f of fs.readdirSync(DATASETS_DIR).filter((x) => x.endsWith('.json')).sort()) {
    const file = path.join(DATASETS_DIR, f);
    const raw = fs.readFileSync(file, 'utf8');
    const ds = JSON.parse(raw);
    const pkg = ds.ckanName && byName.get(ds.ckanName);
    if (!pkg) continue;
    const next = { ...ds };
    const modified = pkg.metadata_modified ? String(pkg.metadata_modified).slice(0, 10) : null;
    if (modified && /^\d{4}-\d{2}-\d{2}$/.test(modified)) next.lastUpdated = modified;
    const res = (pkg.resources ?? []).filter((r) => r.url);
    if (res.length) {
      next.resources = res.map((r) => ({ name: r.name || `${ds.title}（${r.format || '檔案'}）`, format: String(r.format || '').toUpperCase(), url: r.url }));
      const fmts = [...new Set(res.map((r) => String(r.format || '').toUpperCase()).filter(Boolean))];
      if (fmts.length) next.formats = fmts;
    }
    const lic = mapLicense(pkg);
    if (lic && String(lic).toLowerCase() !== String(ds.license ?? '').toLowerCase()) next.license = lic;
    // 非標準授權且原本沒有說明 → 補 licenseNote，避免 schema 檢查失敗（治理引擎仍會產生授權待辦）
    if (lic && !STANDARD_LICENSES.includes(lic) && !next.licenseNote) next.licenseNote = `CKAN 標示授權「${pkg.license_title || lic}」，待權責單位確認`;
    const diff = ['lastUpdated', 'formats', 'resources', 'license'].filter((k) => JSON.stringify(ds[k]) !== JSON.stringify(next[k]));
    if (!diff.length) continue;
    next.provenance = { ...(ds.provenance ?? {}), fetchedAt: new Date().toISOString().slice(0, 10), mode: 'live', sourceUrl: `https://data.cdc.gov.tw/api/3/action/package_show?id=${ds.ckanName}` };
    changes.push({ file: f, fields: diff });
    if (!dry) fs.writeFileSync(file, JSON.stringify(next, null, 2) + '\n');
  }
  return changes;
}

// ── 外部連結健康檢查（--check-links）────────────────────
const CONTENT_DIR = path.join(ROOT, 'content');
/** 會被檢查的內容子目錄（型別由檔案內 type 決定，欄位定義與治理引擎共用 EXTERNAL_LINK_FIELDS） */
export const LINK_CHECK_DIRS = ['topics', 'services', 'news', 'media', 'publications', 'documents'];
export const LINK_CHECK = { timeoutMs: 10000, perHost: 3, maxUrls: 300 };
const PLACEHOLDER_PATTERNS = [/\/File\/Get\/placeholder-/i, /placeholder/i, /^https?:\/\/([^/]+\.)?example\.(com|org|net)(\/|$)/i, /^https?:\/\/[^/]+\.(invalid|test|example|localhost)(:\d+)?(\/|$)/i, /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i, /xxx|TODO/];
export const isPlaceholderUrl = (u) => PLACEHOLDER_PATTERNS.some((re) => re.test(String(u)));
const isHttpUrl = (u) => typeof u === 'string' && /^https?:\/\//i.test(u);

/** 一筆內容（原始 JSON）的外部連結目標：[{ url, field, list?, index? }] */
export function linkTargetsOf(item) {
  const out = [];
  for (const { field, list } of EXTERNAL_LINK_FIELDS[item?.type] ?? []) {
    if (list) (item[field] ?? []).forEach((l, index) => { if (l && isHttpUrl(l.href)) out.push({ url: l.href, field, list: true, index }); });
    else if (isHttpUrl(item[field])) out.push({ url: item[field], field });
  }
  return out;
}

/** 伺服器有回應但不代表連結失效（擋爬蟲、需登入、限流）：不寫回，下次再檢 */
const INDETERMINATE = new Set([401, 403, 429]);
/** 單一網址：HEAD → 失敗（例外或 ≥ 400）再 GET。
 *  回傳 { status: ok|broken|indeterminate, code, network, error }；代理拒絕（x-deny-reason）與連線失敗視為 network。 */
export async function checkUrl(url, { fetchImpl = fetch, timeoutMs = LINK_CHECK.timeoutMs } = {}) {
  const attempt = async (method) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, { method, redirect: 'follow', signal: ctrl.signal, headers: { 'User-Agent': UA, Accept: '*/*' } });
      try { await res.body?.cancel?.(); } catch { /* 忽略 */ }
      const deny = res.headers?.get?.('x-deny-reason');
      if (deny) return { error: `proxy:${deny}` }; // 沙箱代理拒絕 ≠ 連結失效
      return { code: res.status };
    } catch (e) { return { error: e?.name === 'AbortError' ? 'timeout' : (e?.cause?.code ?? e?.message ?? String(e)) }; } finally { clearTimeout(timer); }
  };
  const head = await attempt('HEAD');
  if (head.code && head.code < 400) return { status: 'ok', code: head.code, network: false };
  const get = await attempt('GET');
  const code = get.code ?? head.code;
  if (code) return { status: code < 400 ? 'ok' : INDETERMINATE.has(code) ? 'indeterminate' : 'broken', code, network: false };
  return { status: 'broken', code: null, network: true, error: get.error ?? head.error };
}

/** 依網域分組、每網域併發 ≤ perHost；回傳 Map(url → result) */
export async function runLinkChecks(urls, { fetchImpl = fetch, perHost = LINK_CHECK.perHost, timeoutMs = LINK_CHECK.timeoutMs } = {}) {
  const byHost = new Map();
  for (const u of urls) {
    let host; try { host = new URL(u).host; } catch { host = '?'; }
    if (!byHost.has(host)) byHost.set(host, []);
    byHost.get(host).push(u);
  }
  const results = new Map();
  await Promise.all([...byHost.values()].map(async (list) => {
    let i = 0;
    const worker = async () => { while (i < list.length) { const u = list[i++]; results.set(u, await checkUrl(u, { fetchImpl, timeoutMs })); } };
    await Promise.all(Array.from({ length: Math.min(perHost, list.length) }, worker));
  }));
  return results;
}

/** 把結果寫回一筆內容（只動 lastCheckedAt／status）；回傳是否有變更 */
export function applyLinkResults(item, results, today) {
  let changed = false;
  const set = (obj, status, checkedAt) => {
    if (obj.status !== status) { obj.status = status; changed = true; }
    if (checkedAt && obj.lastCheckedAt !== checkedAt) { obj.lastCheckedAt = checkedAt; changed = true; }
  };
  for (const t of linkTargetsOf(item)) {
    const placeholder = isPlaceholderUrl(t.url);
    const r = results.get(t.url);
    if (!placeholder && (!r || r.status === 'indeterminate')) continue; // 超過上限未檢查、或無法判定：保留原值
    if (t.list) {
      const obj = item[t.field][t.index];
      if (placeholder) { if (obj.status && obj.status !== 'unchecked') { obj.status = 'unchecked'; changed = true; } continue; }
      set(obj, r.status, today);
    } else {
      if (placeholder) {
        const cur = item.linkChecks?.[t.field];
        if (cur?.status && cur.status !== 'unchecked') { cur.status = 'unchecked'; changed = true; }
        continue;
      }
      item.linkChecks ??= {};
      item.linkChecks[t.field] ??= {};
      set(item.linkChecks[t.field], r.status, today);
    }
  }
  return changed;
}

/** 主程序：掃 content/** → 檢查 → 寫回。fetchImpl／contentDir 可注入（測試用） */
export async function checkLinks({ contentDir = CONTENT_DIR, fetchImpl = fetch, dry = false, today = new Date().toISOString().slice(0, 10), maxUrls = LINK_CHECK.maxUrls, perHost = LINK_CHECK.perHost, timeoutMs = LINK_CHECK.timeoutMs, logger = log } = {}) {
  const files = [];
  for (const dir of LINK_CHECK_DIRS) {
    const d = path.join(contentDir, dir);
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d).filter((x) => x.endsWith('.json')).sort()) {
      const file = path.join(d, f);
      try { files.push({ file, item: JSON.parse(fs.readFileSync(file, 'utf8')) }); } catch (e) { logger(`✗ 無法解析 ${path.relative(contentDir, file)}：${e.message}`); }
    }
  }
  const all = [], placeholders = new Set();
  for (const { item } of files) for (const t of linkTargetsOf(item)) (isPlaceholderUrl(t.url) ? placeholders.add(t.url) : all.push(t.url));
  const unique = [...new Set(all)];
  const urls = unique.slice(0, maxUrls);
  const summary = { files: files.length, urls: unique.length, checked: urls.length, skippedOverLimit: unique.length - urls.length, placeholders: placeholders.size, ok: 0, broken: 0, indeterminate: 0, network: 0, offline: false, changedFiles: [] };
  logger(`外部連結：${unique.length} 個（檢查 ${urls.length}${summary.skippedOverLimit ? `，超過上限略過 ${summary.skippedOverLimit}` : ''}；佔位略過 ${placeholders.size}）`);
  if (!urls.length) { logger('沒有需要檢查的外部連結'); return summary; }
  const results = await runLinkChecks(urls, { fetchImpl, perHost, timeoutMs });
  for (const r of results.values()) { summary[r.status]++; if (r.network) summary.network++; }
  if (summary.ok === 0) { // 全部失敗（沙箱無法連外、代理拒絕）：不改檔
    summary.offline = true;
    logger(`無法連外，略過（${summary.network} 個連線失敗、${summary.indeterminate} 個無法判定、${summary.broken - summary.network} 個 HTTP 錯誤；不改任何內容檔）`);
    return summary;
  }
  for (const { file, item } of files) {
    if (!applyLinkResults(item, results, today)) continue;
    summary.changedFiles.push(path.relative(contentDir, file));
    if (!dry) fs.writeFileSync(file, JSON.stringify(item, null, 2) + '\n');
  }
  for (const [u, r] of results) if (r.status !== 'ok') logger(`  ${r.status === 'broken' ? '✗' : '?'} ${u}（${r.code ?? r.error}）`);
  logger(`正常 ${summary.ok}、失效 ${summary.broken}（其中連線失敗 ${summary.network}）、無法判定 ${summary.indeterminate}；更新 ${summary.changedFiles.length} 檔${dry ? '（dry，未寫入）' : ''}`);
  return summary;
}

// ── 主流程 ────────────────────────────────────────────
async function main() {
  if (CHECK_LINKS) { await checkLinks({ dry: DRY }); return; }
  if (DRY) log('dry-run：只抓取與比對，不寫入檔案');
  let packages = null;
  if (!SYNC_ONLY) {
    for (const s of SOURCES) {
      try { const data = s.pick(await getJSON(s.url)); writeSnapshot(s.file, { sourceUrl: s.url, label: s.label, ...(s.meta?.(data) ?? {}) }, data); } catch (e) { keepSnapshot(s.file, s, e); }
    }
    try {
      packages = await fetchCkanAll();
      if (!packages.length) throw new Error('CKAN 回傳 0 筆');
      writeSnapshot(CKAN.file, { sourceUrl: CKAN.base, label: CKAN.label }, packages);
    } catch (e) { keepSnapshot(CKAN.file, { url: CKAN.base, label: CKAN.label }, e); packages = null; }
  }
  if (NO_SYNC) return;
  if (!packages) {
    const snap = readSnapshot(CKAN.file);
    if (!SYNC_ONLY) { log('CKAN 未取得 live 資料 → 不同步資料目錄（避免以示意快照覆寫）'); return; }
    packages = snap?.data ?? [];
  }
  const changes = syncDatasetsFromCkan(packages, { dry: DRY });
  log(changes.length ? `資料目錄同步：${changes.length} 筆${DRY ? '（dry，未寫入）' : ''}` : '資料目錄同步：無變更');
  for (const c of changes) log(`  - ${c.file}：${c.fields.join('、')}`);
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) main().catch((e) => { log(`未預期錯誤（${e.message}）→ 保留既有快照`); }).finally(() => { process.exitCode = 0; });
