#!/usr/bin/env node
// 404 log 分析（ARCHITECTURE 13.1）：讀伺服器 access log，抓 404 的路徑與次數，對照 legacy-map 與移轉清單分三類：
//   1. redirect  可直接 301：正規化後命中 v1/legacy-map.json（或移轉清單中無 {id} 佔位的舊網址）
//   2. missing   待補對照：符合舊站 URL 模式（移轉清單的 {id} 模式、或規劃文件 §1.2 的舊站路徑族）但沒有對照
//                ⇒ 產生可貼進 content/migration/*.json 的 items 草稿（status:'pending'、verified:false）
//   3. gone      真的不存在：其餘（含移轉清單標 dropped 者）⇒ 建議回 410
//
// 支援格式（自動判斷）：
//   - Nginx combined：  1.2.3.4 - - [02/Oct/2026:10:00:00 +0800] "GET /path?q HTTP/1.1" 404 512 "ref" "ua"
//   - IIS W3C extended：#Fields: date time ... cs-uri-stem cs-uri-query ... sc-status ...（依 #Fields 欄位順序解析）
//
// 用法（package.json 不另加 script）：
//   node scripts/analyze-404-log.mjs <access.log> [更多 log…]             # Markdown 報表輸出到 stdout
//   node scripts/analyze-404-log.mjs access.log --json                     # JSON 輸出
//   node scripts/analyze-404-log.mjs access.log --map dist/v1/legacy-map.json --migration content/migration
//   cat access.log | node scripts/analyze-404-log.mjs -                     # 從 stdin 讀
//   選項：--map <檔>（預設 dist/v1/legacy-map.json；不存在時由 content/ 即時建置對照）
//         --migration <目錄或檔>（預設 content/migration）
//         --min <n>（只列 404 次數 ≥ n 的路徑，預設 1）
//   範例：node scripts/analyze-404-log.mjs tests/fixtures/access-404.log
// 匯出（測試用）：parseLog、detectFormat、analyze、toMarkdown、loadMigrationLists、OLD_SITE_PATTERNS
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { legacyKey } from './lib/emit-api.mjs';
import { legacyPathOf } from './lib/governance.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LEGACY_ORIGIN = 'https://www.cdc.gov.tw';

/** 舊站 URL 模式（規劃文件 §1.2 由 URL 反推的內容模型）；命中但無對照 ⇒ 待補對照 */
export const OLD_SITE_PATTERNS = [
  { re: /^\/disease\/(?:index|subindex(?:\/[^/?]+)?)(?:\/|\?|$)/i, kind: 'disease', oldType: 'page', label: '疾病 Disease' },
  { re: /^\/category\/(?:list|page|mpage|qapage|newspage|fpage|listcontent|diseasemanual|diseasedefine|diseaseteach)(?:\/|\?|$)/i, kind: 'category', label: '欄目節點 Category' },
  { re: /^\/bulletin\/(?:list|detail)(?:\/|\?|$)/i, kind: 'bulletin', label: '新聞 Bulletin' },
  { re: /^\/file\/(?:get|newget)\//i, kind: 'file', oldType: 'pdf', label: '附件 File' },
  { re: /^\/uploads\/(?:files|archives)\//i, kind: 'upload', oldType: 'pdf', label: '舊附件 Uploads' },
  { re: /^\/infectionreport\/info(?:\/|\?|$)/i, kind: 'publication', oldType: 'pdf', label: '出版品 InfectionReport' },
  { re: /^\/(?:travelepidemic|countryepidlevel)(?:\/|\?|$)/i, kind: 'table', oldType: 'list', label: '結構化資料表' },
  { re: /^\/advocacy(?:\/|\?|$)/i, kind: 'advocacy', oldType: 'media', label: '宣導素材 Advocacy' },
  { re: /^\/en(?:\/|$)/i, kind: 'english', oldType: 'page', label: '英文網站 /En' },
];

const NGINX_RE = /^(\S+) \S+ \S+ \[([^\]]+)\] "(?:([A-Z]+) )?([^" ]*)(?: [^"]*)?" (\d{3}) (\S+)(?: "([^"]*)" "([^"]*)")?/;

/** 自動判斷 log 格式：'iis'｜'nginx'｜'unknown' */
export function detectFormat(text) {
  const head = String(text).split(/\r?\n/).slice(0, 50);
  if (head.some((l) => /^#(?:Software: Microsoft Internet Information Services|Fields:)/i.test(l))) return 'iis';
  if (head.some((l) => NGINX_RE.test(l))) return 'nginx';
  return 'unknown';
}

/** 解析 log → [{ path（含 query）, status, time, referer, ua, method }]（無法解析的行略過） */
export function parseLog(text) {
  const fmt = detectFormat(text);
  const out = [];
  const lines = String(text).split(/\r?\n/);
  if (fmt === 'iis') {
    let fields = null;
    for (const line of lines) {
      if (!line.trim()) continue;
      if (line.startsWith('#')) { const m = line.match(/^#Fields:\s*(.+)$/i); if (m) fields = m[1].trim().split(/\s+/); continue; }
      if (!fields) continue;
      const cols = line.trim().split(/\s+/);
      const get = (k) => { const i = fields.indexOf(k); return i < 0 ? null : cols[i] ?? null; };
      const stem = get('cs-uri-stem');
      if (!stem) continue;
      const q = get('cs-uri-query');
      const ref = get('cs(Referer)');
      out.push({ path: q && q !== '-' ? `${stem}?${q}` : stem, status: Number(get('sc-status')), time: [get('date'), get('time')].filter(Boolean).join('T') || null,
        method: get('cs-method'), referer: ref && ref !== '-' ? ref : null, ua: get('cs(User-Agent)') });
    }
  } else {
    for (const line of lines) {
      const m = NGINX_RE.exec(line);
      if (!m) continue;
      out.push({ path: m[4], status: Number(m[5]), time: m[2], method: m[3] ?? null, referer: m[7] && m[7] !== '-' ? m[7] : null, ua: m[8] ?? null });
    }
  }
  return { format: fmt, entries: out };
}

/** 讀移轉清單（目錄或單檔） */
export function loadMigrationLists(p) {
  if (!p || !fs.existsSync(p)) return [];
  const files = fs.statSync(p).isDirectory() ? fs.readdirSync(p).filter((f) => f.endsWith('.json')).sort().map((f) => path.join(p, f)) : [p];
  return files.map((f) => JSON.parse(fs.readFileSync(f, 'utf8')));
}

/** {id} 佔位的舊網址 → 比對用 RegExp（以正規化 key 比對） */
function patternRegex(fromPath) {
  const key = legacyKey(fromPath);
  const src = key.split(/\{[^}]*\}/).map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^/?#&]+');
  return new RegExp(`^${src}${key.includes('?') ? '(?:&.*)?' : '(?:\\?.*)?'}$`, 'i');
}

const slugFromPath = (p) => (legacyKey(p).replace(/^\//, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'root');
const oldTypeOf = (p, pat) => {
  if (/\.pdf(?:$|\?)/i.test(p)) return 'pdf';
  if (/\/qapage\//i.test(p)) return 'qa';
  if (/\/bulletin\/list\//i.test(p)) return 'news-list';
  if (/\/category\/list\//i.test(p)) return 'list';
  return pat?.oldType ?? 'page';
};

/**
 * 分析：entries（parseLog 結果）＋ legacy-map（{ key: to } 或 v1 外殼）＋ 移轉清單 → 三類報表。
 * @returns {{ total, notFound, unique, categories: { redirect, missing, gone }, drafts }}
 */
export function analyze(entries, { map = {}, migrationLists = [], min = 1 } = {}) {
  const lm = map && typeof map === 'object' && map.data && typeof map.data === 'object' && !Array.isArray(map.data) ? map.data : (map ?? {});
  const lookup = new Map(Object.entries(lm).map(([k, v]) => [legacyKey(k), v]));
  // 移轉清單：無佔位的舊網址直接加入對照（legacy-map 尚未重建時也能判斷）；有佔位者成為「模式」
  const patterns = [];
  const dropped = new Map();
  for (const list of migrationLists) for (const it of list.items ?? []) {
    const fromPath = legacyPathOf(it.oldUrl);
    const isPattern = /\{[^}]*\}/.test(fromPath);
    if (it.status === 'dropped') { if (!isPattern) dropped.set(legacyKey(fromPath), { listId: list.id, ...it }); continue; }
    if (isPattern) patterns.push({ re: patternRegex(fromPath), listId: list.id, key: it.key, oldTitle: it.oldTitle, target: it.target ?? null, status: it.status, from: fromPath });
  }
  const notFound = entries.filter((e) => e.status === 404);
  const agg = new Map();
  for (const e of notFound) {
    const key = legacyKey(e.path);
    if (!agg.has(key)) agg.set(key, { key, path: e.path, count: 0, first: e.time, last: e.time, referers: new Set() });
    const a = agg.get(key);
    a.count++; a.last = e.time ?? a.last;
    if (e.referer && a.referers.size < 3) a.referers.add(e.referer);
  }
  const rows = [...agg.values()].filter((a) => a.count >= min).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  const categories = { redirect: [], missing: [], gone: [] };
  for (const a of rows) {
    const row = { key: a.key, path: a.path, count: a.count, first: a.first ?? null, last: a.last ?? null, referers: [...a.referers] };
    if (lookup.has(a.key)) { categories.redirect.push({ ...row, to: lookup.get(a.key) }); continue; }
    if (dropped.has(a.key)) { const d = dropped.get(a.key); categories.gone.push({ ...row, reason: `移轉清單 ${d.listId}／${d.key} 標為不移轉（dropped）`, suggest: 410 }); continue; }
    const candidates = patterns.filter((p) => p.re.test(a.key)).map(({ re, ...p }) => p);
    const site = OLD_SITE_PATTERNS.find((p) => p.re.test(a.key));
    if (candidates.length || site) { categories.missing.push({ ...row, family: site?.label ?? null, oldType: oldTypeOf(a.path, site), candidates }); continue; }
    categories.gone.push({ ...row, reason: '不符合舊站 URL 模式，也無對照', suggest: 410 });
  }
  const drafts = categories.missing.map((m) => ({
    key: slugFromPath(m.path),
    oldTitle: '（待填：舊站標題）',
    oldPath: '（待填：舊站階層）',
    oldUrl: `${LEGACY_ORIGIN}${m.path.startsWith('/') ? '' : '/'}${m.path}`,
    oldType: m.oldType,
    verified: false,
    status: 'pending',
    note: `404 log 命中 ${m.count} 次（${m.first ?? '?'} ～ ${m.last ?? '?'}）${m.candidates.length ? `；可能對應：${[...new Set(m.candidates.map((c) => `${c.listId}／${c.key}（${c.oldTitle}${c.target ? ` → ${c.target}` : ''}）`))].slice(0, 3).join('、')}` : ''}；確認後填 target 並改 status`,
  }));
  return { total: entries.length, notFound: notFound.length, unique: rows.length, categories, drafts };
}

/** Markdown 報表 */
export function toMarkdown(report, { sources = [], format = null, mapSource = null } = {}) {
  const { categories: c } = report;
  const sum = (arr) => arr.reduce((n, x) => n + x.count, 0);
  const cell = (s) => String(s ?? '').replace(/\|/g, '\\|');
  const out = [];
  out.push('# 404 log 分析報表', '');
  out.push(`- 來源：${sources.length ? sources.map((s) => `\`${s}\``).join('、') : '（stdin）'}${format ? `（格式：${format}）` : ''}`);
  if (mapSource) out.push(`- 對照：${mapSource}`);
  out.push(`- 請求 ${report.total} 筆，其中 404 共 ${report.notFound} 筆、不重複路徑 ${report.unique} 個`, '');
  out.push('| 分類 | 路徑數 | 404 次數 | 建議 |', '| --- | ---: | ---: | --- |');
  out.push(`| 可直接 301 | ${c.redirect.length} | ${sum(c.redirect)} | 已有對照：確認伺服器已載入 redirects/ 對照檔（nginx.map／web.config／_redirects） |`);
  out.push(`| 待補對照 | ${c.missing.length} | ${sum(c.missing)} | 符合舊站 URL 模式：把下方草稿貼進 content/migration/*.json，填 target 後重建 |`);
  out.push(`| 真的不存在 | ${c.gone.length} | ${sum(c.gone)} | 建議回 410 Gone，讓搜尋引擎移除索引 |`, '');
  out.push('## 1. 可直接 301', '');
  if (c.redirect.length) { out.push('| 次數 | 舊路徑 | 新路徑 |', '| ---: | --- | --- |'); for (const r of c.redirect) out.push(`| ${r.count} | \`${cell(r.path)}\` | \`${cell(r.to)}\` |`); } else out.push('（無）');
  out.push('', '## 2. 待補對照（符合舊站 URL 模式但無對照）', '');
  if (c.missing.length) {
    out.push('| 次數 | 舊路徑 | 舊站路徑族 | 可能對應（移轉清單） |', '| ---: | --- | --- | --- |');
    for (const m of c.missing) out.push(`| ${m.count} | \`${cell(m.path)}\` | ${cell(m.family ?? '移轉清單模式')} | ${cell(m.candidates.map((x) => `${x.key}${x.target ? ` → ${x.target}` : ''}`).slice(0, 3).join('、') || '—')} |`);
    out.push('', '可貼進移轉清單 `items` 的草稿（status:pending、verified:false；確認舊站標題與新站 target 後改狀態）：', '', '```json', JSON.stringify(report.drafts, null, 2), '```');
  } else out.push('（無）');
  out.push('', '## 3. 真的不存在（建議 410）', '');
  if (c.gone.length) { out.push('| 次數 | 路徑 | 原因 |', '| ---: | --- | --- |'); for (const g of c.gone) out.push(`| ${g.count} | \`${cell(g.path)}\` | ${cell(g.reason)} |`); } else out.push('（無）');
  out.push('');
  return out.join('\n');
}

/** 沒有 dist/v1/legacy-map.json 時，由 content/ 即時建置對照（load → govern → buildRedirects） */
async function buildMapFromContent() {
  const { config } = await import('../site.config.mjs');
  const { loadSite } = await import('./lib/load.mjs');
  const { applyGovernance } = await import('./lib/governance.mjs');
  const { buildRedirects, buildLegacyMap } = await import('./lib/emit-api.mjs');
  const site = loadSite(config);
  site.today = new Date().toISOString().slice(0, 10);
  applyGovernance(site);
  return buildLegacyMap(site, buildRedirects(site)).map;
}

async function main(argv) {
  const files = [];
  const opts = { json: false, map: null, migration: path.join(ROOT, 'content/migration'), min: 1 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => (a.includes('=') ? a.split('=').slice(1).join('=') : argv[++i]);
    if (a === '--json') opts.json = true;
    else if (a.startsWith('--map')) opts.map = val();
    else if (a.startsWith('--migration')) opts.migration = val();
    else if (a.startsWith('--min')) opts.min = Number(val()) || 1;
    else if (a === '-h' || a === '--help') { console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n')); return; }
    else files.push(a);
  }
  if (!files.length) { console.error('用法：node scripts/analyze-404-log.mjs <access.log> [--json] [--map dist/v1/legacy-map.json] [--migration content/migration]'); process.exit(2); }
  const text = files.map((f) => (f === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(f, 'utf8'))).join('\n');
  const { format, entries } = parseLog(text);
  let map, mapSource;
  const mapPath = opts.map ?? path.join(ROOT, 'dist/v1/legacy-map.json');
  if (fs.existsSync(mapPath)) { map = JSON.parse(fs.readFileSync(mapPath, 'utf8')); mapSource = opts.map ?? path.relative(ROOT, mapPath); }
  else if (opts.map) { console.error(`找不到 ${opts.map}`); process.exit(2); }
  else { map = await buildMapFromContent(); mapSource = 'content/（即時建置；建議先 npm run build 再用 --map dist/v1/legacy-map.json）'; }
  const migrationLists = loadMigrationLists(opts.migration);
  const report = analyze(entries, { map, migrationLists, min: opts.min });
  if (opts.json) console.log(JSON.stringify({ format, sources: files, map: mapSource, ...report }, null, 2));
  else console.log(toMarkdown(report, { sources: files, format, mapSource }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((e) => { console.error(e); process.exit(1); });
}
