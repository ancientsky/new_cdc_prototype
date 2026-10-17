// 第五十七輪（docs/denguemap-integration.md 第 2 節）：登革熱地圖（ancientsky/denguemap）的 summary.json＋manifest.json 快照。
//
// 為什麼在建置時抓、不在瀏覽器抓：疾病頁的疫情小卡是建置時的 HTML（不需要 client JS、不加 connect-src），
// 資料時間、過期規則與「上游資料短缺」的判斷都在這裡一次做完，模板只讀結果。
//
// 流程（scripts/fetch-data.mjs 呼叫 importDenguemap）：
//   1. 先抓 Pages 版（config.denguemapDataUrl），失敗（連線、HTTP、超過大小上限、驗證不過）再抓 raw 版（config.denguemapRawDataUrl，同一份 git 檔）。
//      summary 與 manifest 一定取自同一個來源，兩者的 latestOnset 必須相同（避免拿到一新一舊）。
//   2. 嚴格驗證：計數必須是非負整數、日期必須是真實的 ISO 日期、縣市代碼 5 碼、鄉鎮代碼 8 碼且前 5 碼是縣市碼；未知欄位丟掉（白名單輸出）。
//   3. 全部失敗 ⇒ 保留既有快照（只記 lastLiveAttempt），exit 0，與其他官方資料來源同一規則。
//
// 過期規則（denguemapState，小卡用）：manifest.generatedAt 距建置時間超過 config.denguemapMaxAgeHours（48）、
// manifest 標記病例來源 stale／失敗、或有今年的 cases-shortfall 警示 ⇒ 不顯示數字，只顯示「資料更新中」＋連結。
import fs from 'node:fs';
import path from 'node:path';

export const SNAPSHOT_FILE = 'denguemap-summary.json';
export const LABEL = '登革熱地圖疫情摘要（summary.json＋manifest.json）';
/** 單檔大小上限：summary 現約 1.2 KB、manifest 約 2 KB；上限給成長空間，又擋得住被換成大檔 */
export const MAX_BYTES = { summary: 64 * 1024, manifest: 256 * 1024 };
export const MAX_TOP_TOWNS = 20;
export const MAX_WARNINGS = 200;
const TIMEOUT_MS = 20000;
const UA = 'cdc-ai-ready-prototype/0.2 (+github pages build)';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
export const COUNTY_RE = /^\d{5}$/;
export const TOWN_RE = /^\d{8}$/;
const SOURCE_KEY = /^[a-z0-9]{1,16}$/;
const WARN_CODE = /^[a-z0-9-]{1,40}$/;

/** 真實存在的日曆日期（2026-02-30 不算） */
export function isIsoDate(s) {
  if (typeof s !== 'string' || !ISO_DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
export function isIsoUtc(s) {
  return typeof s === 'string' && ISO_UTC.test(s) && isIsoDate(s.slice(0, 10)) && !Number.isNaN(Date.parse(s));
}
const nonNegInt = (v) => Number.isSafeInteger(v) && v >= 0;

/** { local, imported } 兩個非負整數；回傳正規化後的物件或 null */
function pair(v, where, errors) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) {
    errors.push(`${where} 不是物件`);
    return null;
  }
  if (!nonNegInt(v.local) || !nonNegInt(v.imported)) {
    errors.push(`${where} 的 local／imported 必須是非負整數`);
    return null;
  }
  return { local: v.local, imported: v.imported };
}

/**
 * 驗證 summary.json（docs/data-contract.md 的 summary 段）。回傳 { ok, errors, value }；value 只含契約欄位。
 */
export function validateSummary(s) {
  const errors = [];
  if (!s || typeof s !== 'object' || Array.isArray(s)) return { ok: false, errors: ['summary 不是物件'], value: null };
  if (!isIsoDate(s.asOf)) errors.push(`asOf 不是 ISO 日期：${String(s.asOf).slice(0, 40)}`);
  if (!isIsoDate(s.latestOnset)) errors.push(`latestOnset 不是 ISO 日期：${String(s.latestOnset).slice(0, 40)}`);
  if (isIsoDate(s.asOf) && isIsoDate(s.latestOnset) && s.latestOnset > s.asOf) errors.push(`latestOnset ${s.latestOnset} 晚於 asOf ${s.asOf}`);
  if (!Number.isSafeInteger(s.year) || s.year < 1998 || (isIsoDate(s.asOf) && s.year > Number(s.asOf.slice(0, 4)))) errors.push(`year 不合理：${s.year}`);
  const v = { asOf: s.asOf, latestOnset: s.latestOnset, year: s.year };
  for (const k of ['ytd', 'last7', 'last14', 'last30', 'prevYtd']) v[k] = pair(s[k], k, errors);
  if (v.last7 && v.last14 && v.last30) {
    for (const t of ['local', 'imported'])
      if (!(v.last7[t] <= v.last14[t] && v.last14[t] <= v.last30[t]))
        errors.push(`近 7／14／30 天的 ${t} 不是遞增：${v.last7[t]}／${v.last14[t]}／${v.last30[t]}`);
  }
  const bc = s.byCounty;
  v.byCounty = {};
  if (!bc || typeof bc !== 'object' || Array.isArray(bc)) errors.push('byCounty 不是物件');
  else {
    const keys = Object.keys(bc);
    if (keys.length > 30) errors.push(`byCounty 縣市數 ${keys.length} 超過 30`);
    for (const code of keys) {
      if (!COUNTY_RE.test(code)) {
        errors.push(`byCounty 代碼不是 5 碼：${code.slice(0, 20)}`);
        continue;
      }
      const p = pair(bc[code], `byCounty.${code}`, errors);
      if (p) v.byCounty[code] = p;
    }
    if (v.ytd)
      for (const t of ['local', 'imported']) {
        const sum = Object.values(v.byCounty).reduce((a, p) => a + p[t], 0);
        if (sum > v.ytd[t]) errors.push(`byCounty 的 ${t} 合計 ${sum} 大於今年累計 ${v.ytd[t]}`);
      }
  }
  v.topTowns14 = [];
  if (!Array.isArray(s.topTowns14)) errors.push('topTowns14 不是陣列');
  else {
    if (s.topTowns14.length > 50) errors.push(`topTowns14 有 ${s.topTowns14.length} 筆，超過 50`);
    for (const [i, r] of s.topTowns14.slice(0, 50).entries()) {
      if (!Array.isArray(r) || r.length !== 3 || !TOWN_RE.test(String(r[0])) || typeof r[0] !== 'string' || !nonNegInt(r[1]) || !nonNegInt(r[2])) {
        errors.push(`topTowns14[${i}] 形狀不對（[townCode(8 碼), local, imported]）`);
        continue;
      }
      if (v.last14 && (r[1] > v.last14.local || r[2] > v.last14.imported)) errors.push(`topTowns14[${i}] ${r[0]} 的病例數大於近 14 天全國數`);
      if (v.topTowns14.length < MAX_TOP_TOWNS) v.topTowns14.push([r[0], r[1], r[2]]);
    }
  }
  return { ok: errors.length === 0, errors, value: errors.length ? null : v };
}

/**
 * 驗證 manifest.json 並取子集：{ schema, generatedAt, latestOnset, sources:{ key:{ ok, stale, fetchedAt } }, warnings[] }。
 * sources.cases 必須存在（小卡的數字就是它）；其他來源有就留（最多 12 個）。
 */
export function validateManifest(m) {
  const errors = [];
  if (!m || typeof m !== 'object' || Array.isArray(m)) return { ok: false, errors: ['manifest 不是物件'], value: null };
  if (m.schema !== undefined && !Number.isSafeInteger(m.schema)) errors.push('schema 不是整數');
  if (!isIsoUtc(m.generatedAt)) errors.push(`generatedAt 不是 ISO UTC 時間：${String(m.generatedAt).slice(0, 40)}`);
  if (!isIsoDate(m.latestOnset)) errors.push(`latestOnset 不是 ISO 日期：${String(m.latestOnset).slice(0, 40)}`);
  const sources = {};
  const src = m.sources;
  if (!src || typeof src !== 'object' || Array.isArray(src)) errors.push('sources 不是物件');
  else {
    for (const [k, s] of Object.entries(src).slice(0, 12)) {
      if (!SOURCE_KEY.test(k)) {
        errors.push(`sources 鍵名不合法：${k.slice(0, 20)}`);
        continue;
      }
      if (!s || typeof s !== 'object' || typeof s.ok !== 'boolean' || typeof s.stale !== 'boolean') {
        errors.push(`sources.${k} 缺 ok／stale 布林值`);
        continue;
      }
      if (s.fetchedAt != null && !isIsoUtc(s.fetchedAt)) {
        errors.push(`sources.${k}.fetchedAt 不是 ISO UTC 時間`);
        continue;
      }
      sources[k] = { ok: s.ok, stale: s.stale, fetchedAt: s.fetchedAt ?? null };
    }
    if (!sources.cases) errors.push('sources.cases 不存在或不合法');
  }
  const warnings = [];
  if (!Array.isArray(m.warnings)) errors.push('warnings 不是陣列');
  else {
    if (m.warnings.length > MAX_WARNINGS) errors.push(`warnings 有 ${m.warnings.length} 筆，超過 ${MAX_WARNINGS}`);
    for (const [i, w] of m.warnings.slice(0, MAX_WARNINGS).entries()) {
      if (!w || typeof w !== 'object' || !WARN_CODE.test(String(w.code ?? ''))) {
        errors.push(`warnings[${i}] 缺合法的 code`);
        continue;
      }
      const o = { code: w.code };
      if (w.year !== undefined) {
        if (!Number.isSafeInteger(w.year) || w.year < 1990 || w.year > 2100) {
          errors.push(`warnings[${i}].year 不合理`);
          continue;
        }
        o.year = w.year;
      }
      if (w.type !== undefined) {
        if (w.type !== 'local' && w.type !== 'imported') {
          errors.push(`warnings[${i}].type 不合法`);
          continue;
        }
        o.type = w.type;
      }
      for (const k of ['got', 'expected'])
        if (w[k] !== undefined) {
          if (!nonNegInt(w[k])) {
            errors.push(`warnings[${i}].${k} 不是非負整數`);
            break;
          }
          o[k] = w[k];
        }
      if (Object.keys(o).length) warnings.push(o);
    }
  }
  const value = { schema: m.schema ?? null, generatedAt: m.generatedAt, latestOnset: m.latestOnset, sources, warnings };
  return { ok: errors.length === 0, errors, value: errors.length ? null : value };
}

/** 驗證一組（同一來源的）manifest＋summary，回傳快照物件；不合格丟出 Error（訊息列出前幾個問題） */
export function buildSnapshot({ manifest, summary, sourceUrl, fetchedAt }) {
  const vm = validateManifest(manifest);
  const vs = validateSummary(summary);
  const errors = [...vm.errors.map((e) => `manifest：${e}`), ...vs.errors.map((e) => `summary：${e}`)];
  if (!errors.length && vm.value.latestOnset !== vs.value.latestOnset)
    errors.push(`manifest 與 summary 的 latestOnset 不同（${vm.value.latestOnset}／${vs.value.latestOnset}），可能是一新一舊`);
  if (!errors.length && Date.parse(vm.value.generatedAt) > Date.parse(fetchedAt) + 3600e3)
    errors.push(`manifest.generatedAt ${vm.value.generatedAt} 晚於抓取時間 ${fetchedAt}`);
  if (errors.length) {
    const e = new Error(`驗證失敗：${errors.slice(0, 5).join('；')}${errors.length > 5 ? `…（共 ${errors.length} 項）` : ''}`);
    e.errors = errors;
    throw e;
  }
  return { schema: 1, label: LABEL, mode: 'live', fetchedAt, sourceUrl, manifest: vm.value, summary: vs.value };
}

/** 有大小上限的 GET：先看 Content-Length，再邊讀邊數，超過就中止（不把大檔整個讀進記憶體） */
export async function fetchTextCapped(url, maxBytes, { fetchImpl = fetch, timeoutMs = TIMEOUT_MS } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: ctrl.signal, headers: { 'User-Agent': UA, Accept: 'application/json' }, redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const len = Number(res.headers?.get?.('content-length') ?? NaN);
    if (Number.isFinite(len) && len > maxBytes) throw new Error(`檔案 ${len} bytes 超過上限 ${maxBytes}`);
    if (!res.body?.getReader) {
      const text = await res.text();
      if (Buffer.byteLength(text, 'utf8') > maxBytes) throw new Error(`檔案超過上限 ${maxBytes} bytes`);
      return text;
    }
    const reader = res.body.getReader();
    const chunks = [];
    let n = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      n += value.byteLength;
      if (n > maxBytes) {
        ctrl.abort();
        throw new Error(`檔案超過上限 ${maxBytes} bytes`);
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 依序嘗試每個資料目錄網址（結尾 /），各抓 manifest.json 與 summary.json、驗證、組快照；第一個成功的就回傳。
 * 全部失敗 ⇒ 丟出 Error，err.attempts＝[{ base, error }]。
 */
export async function fetchDenguemap({ bases, fetchImpl = fetch, now = () => new Date().toISOString(), timeoutMs = TIMEOUT_MS } = {}) {
  const attempts = [];
  for (const base of bases.filter(Boolean)) {
    try {
      const get = async (name) => {
        const text = await fetchTextCapped(`${base}${name}.json`, MAX_BYTES[name], { fetchImpl, timeoutMs });
        try {
          return JSON.parse(text.replace(/^﻿/, ''));
        } catch (e) {
          throw new Error(`${name}.json 不是 JSON（${e.message}）`);
        }
      };
      const [manifest, summary] = await Promise.all([get('manifest'), get('summary')]);
      return { snapshot: buildSnapshot({ manifest, summary, sourceUrl: `${base}summary.json`, fetchedAt: now() }), attempts };
    } catch (e) {
      attempts.push({ base, error: String(e?.name === 'AbortError' ? '逾時' : (e?.message ?? e)).slice(0, 300) });
    }
  }
  const err = new Error(attempts.map((a) => `${a.base}：${a.error}`).join('；') || '沒有可用的資料網址');
  err.attempts = attempts;
  throw err;
}

export function readSnapshot(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, SNAPSHOT_FILE), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * fetch-data 的進入點：成功 ⇒ 寫快照；失敗 ⇒ 保留既有快照、只記 lastLiveAttempt；從沒有快照 ⇒ 寫一個 mode:'missing' 的空殼。
 * 一律不丟例外（呼叫端 exit 0）。回傳 { ok, snapshot?, error? }。
 */
export async function importDenguemap({
  config,
  snapshotsDir,
  dry = false,
  fetchImpl = fetch,
  now = () => new Date().toISOString(),
  logger = console.log,
  timeoutMs = TIMEOUT_MS,
} = {}) {
  const bases = [config.denguemapDataUrl, config.denguemapRawDataUrl];
  const file = path.join(snapshotsDir, SNAPSHOT_FILE);
  try {
    const { snapshot, attempts } = await fetchDenguemap({ bases, fetchImpl, now, timeoutMs });
    for (const a of attempts) logger(`  ${a.base} 失敗（${a.error}），改用下一個來源`);
    const s = snapshot.summary;
    logger(
      `✓ ${LABEL}：${s.year} 年本土 ${s.ytd.local}、境外 ${s.ytd.imported}，最新發病日 ${s.latestOnset}，資料時間 ${snapshot.manifest.generatedAt}${snapshot.manifest.warnings.length ? `，警示 ${snapshot.manifest.warnings.length} 筆` : ''} ← ${snapshot.sourceUrl}`,
    );
    if (dry) {
      logger(`(dry) 不寫入 ${SNAPSHOT_FILE}`);
      return { ok: true, snapshot };
    }
    fs.mkdirSync(snapshotsDir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(snapshot, null, 2) + '\n');
    return { ok: true, snapshot };
  } catch (e) {
    const prev = readSnapshot(snapshotsDir);
    logger(`✗ ${LABEL}（${e.message}）→ ${prev ? '沿用既有快照' : '建立空快照'}`);
    if (!dry) {
      fs.mkdirSync(snapshotsDir, { recursive: true });
      const attempt = { at: now(), ok: false, reason: String(e.message).slice(0, 600) };
      const out = prev
        ? { ...prev, lastLiveAttempt: attempt }
        : {
            schema: 1,
            label: LABEL,
            mode: 'missing',
            fetchedAt: null,
            sourceUrl: null,
            manifest: null,
            summary: null,
            lastLiveAttempt: attempt,
            note: '尚無快照；請在可連外環境執行 npm run fetch',
          };
      fs.writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
    }
    return { ok: false, error: e.message };
  }
}

/**
 * 小卡要不要顯示數字。回傳 { state: 'ok'|'stale'|'missing', reasons: string[]（機讀代碼）, ageHours }。
 *  - missing：沒有快照、或快照沒有通過驗證的 manifest／summary
 *  - stale：generatedAt 距 now 超過 maxAgeHours；cases 來源 stale 或 ok:false；今年（summary.year）有 cases-shortfall 警示
 * 只讀快照本身，不讀時鐘：now（毫秒）由呼叫端給（建置用 site.now，測試可固定）。
 */
export function denguemapState(snap, { now, maxAgeHours = 48 } = {}) {
  if (!snap || !snap.manifest || !snap.summary) return { state: 'missing', reasons: ['no-snapshot'], ageHours: null };
  const vm = validateManifest(snap.manifest);
  const vs = validateSummary(snap.summary);
  if (!vm.ok || !vs.ok) return { state: 'missing', reasons: ['invalid-snapshot'], ageHours: null };
  const m = vm.value,
    s = vs.value;
  const reasons = [];
  const ageHours = (Number(now) - Date.parse(m.generatedAt)) / 3600e3;
  if (!(ageHours <= maxAgeHours)) reasons.push('too-old');
  const cases = m.sources.cases;
  if (cases.stale || !cases.ok) reasons.push('cases-stale');
  if (m.warnings.some((w) => w.code === 'cases-shortfall' && w.year === s.year)) reasons.push('cases-shortfall');
  return { state: reasons.length ? 'stale' : 'ok', reasons, ageHours: Math.round(ageHours * 10) / 10 };
}

/** ISO UTC → 臺北時間 'YYYY-MM-DD HH:mm'（資料時間顯示到分鐘；不依賴執行環境時區） */
export function taipeiMinute(iso) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  return new Date(t + 8 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
}
