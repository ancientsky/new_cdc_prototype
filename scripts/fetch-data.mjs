#!/usr/bin/env node
// 從官方來源抓資料到 data/snapshots/，並把 CKAN 目錄同步回 content/datasets/*.json 的「資料欄位」。
// 抓不到（沙箱無法連外、官網暫時無回應）就保留既有快照，一律 exit 0，不讓建置失敗。
//
// 用法：
//   node scripts/fetch-data.mjs            抓取 → 寫回快照 → 同步資料目錄
//   node scripts/fetch-data.mjs --dry      只抓取與比對，不寫任何檔案（列出會變更的內容）
//   node scripts/fetch-data.mjs --no-sync  只更新快照，不動 content/datasets
//   node scripts/fetch-data.mjs --sync-only 不連網，用既有 ckan-packages.json 快照同步資料目錄
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SNAPSHOTS = path.join(ROOT, 'data', 'snapshots');
const DATASETS_DIR = path.join(ROOT, 'content', 'datasets');
const args = new Set(process.argv.slice(2));
const DRY = args.has('--dry');
const NO_SYNC = args.has('--no-sync');
const SYNC_ONLY = args.has('--sync-only');
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
  if (!exists && !DRY) {
    fs.mkdirSync(SNAPSHOTS, { recursive: true });
    fs.writeFileSync(path.join(SNAPSHOTS, file), JSON.stringify({ meta: { mode: 'snapshot', fetchedAt: null, sourceUrl: s.url, label: s.label, note: '尚無快照；請在可連外環境執行 npm run fetch' }, data: [] }, null, 2) + '\n');
  }
}

// ── 旅遊疫情：欄位名容錯，補上本站慣用欄位（原欄位保留）────
const LEVEL_TEXT = { 1: '第一級：注意(Watch)', 2: '第二級：警示(Alert)', 3: '第三級：警告(Warning)' };
const pick = (o, keys) => { for (const k of keys) if (o?.[k] != null && o[k] !== '') return o[k]; return null; };
export function normalizeTravelRow(r) {
  if (!r || typeof r !== 'object') return r;
  const levelText = pick(r, ['Level', 'level', 'severity_level', 'LevelName', 'AlertLevel', '等級']);
  let code = pick(r, ['LevelCode', 'levelCode', 'Level_Code']);
  if (code == null && levelText != null) {
    const s = String(levelText);
    const m = s.match(/[1-3一二三]/);
    code = m ? ('一二三'.includes(m[0]) ? '一二三'.indexOf(m[0]) + 1 : Number(m[0])) : /watch|注意/i.test(s) ? 1 : /alert|警示/i.test(s) ? 2 : /warning|警告/i.test(s) ? 3 : null;
  }
  const iso = pick(r, ['ISO2', 'Iso2', 'iso2', 'ISO3166', 'CountryCode']);
  const start = pick(r, ['StartDate', 'effective', 'Effective', 'sent', 'PublishDate', 'Date']);
  return {
    ...r,
    Disease: r.Disease ?? pick(r, ['alert_disease', 'disease', 'DiseaseName', 'headline', '疾病']),
    Country: r.Country ?? pick(r, ['areaDesc', 'country', 'CountryName', '國家']),
    CountryEn: r.CountryEn ?? pick(r, ['areaDesc_EN', 'country_en', 'CountryEnglish']),
    ISO2: r.ISO2 ?? (iso ? String(iso).toUpperCase().slice(0, 2) : null),
    Region: r.Region ?? pick(r, ['regionDesc', 'region', '區域']),
    Level: levelText ?? (code ? LEVEL_TEXT[code] : null),
    LevelCode: code != null ? Number(code) : null,
    StartDate: start ? String(start).replace(/\//g, '-').slice(0, 10) : null,
    Summary: r.Summary ?? pick(r, ['description', 'instruction', 'Content', 'summary', '摘要']),
    Url: r.Url ?? pick(r, ['web', 'url', 'link']),
  };
}
const asArray = (j) => (Array.isArray(j) ? j : Array.isArray(j?.data) ? j.data : Array.isArray(j?.result) ? j.result : Array.isArray(j?.Data) ? j.Data : []);

const SOURCES = [
  { file: 'travel-epidemic.json', url: 'https://www.cdc.gov.tw/TravelEpidemic/ExportJSON', label: '國際重要疫情／旅遊疫情建議', pick: (j) => asArray(j).map(normalizeTravelRow) },
  { file: 'country-epid-level.json', url: 'https://www.cdc.gov.tw/CountryEpidLevel/ExportJSON', label: '各國旅遊疫情建議等級', pick: (j) => asArray(j).map(normalizeTravelRow) },
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

// ── 主流程 ────────────────────────────────────────────
async function main() {
  if (DRY) log('dry-run：只抓取與比對，不寫入檔案');
  let packages = null;
  if (!SYNC_ONLY) {
    for (const s of SOURCES) {
      try { writeSnapshot(s.file, { sourceUrl: s.url, label: s.label }, s.pick(await getJSON(s.url))); } catch (e) { keepSnapshot(s.file, s, e); }
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

main().catch((e) => { log(`未預期錯誤（${e.message}）→ 保留既有快照`); }).finally(() => { process.exitCode = 0; });
