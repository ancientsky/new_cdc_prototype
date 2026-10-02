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

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) main().catch((e) => { log(`未預期錯誤（${e.message}）→ 保留既有快照`); }).finally(() => { process.exitCode = 0; });
