// 國際重要疫情資訊匯入器（docs/intl-epidemic.md 第 4、5 節）：parse → validate → map → plan → apply。
// 三條路（CI 排程拉取 scripts/fetch-data.mjs、推送端點、後台貼上）與 CLI（scripts/intl-epidemic.mjs）都走這裡，
// 單則的規則在 src/client/intl-epidemic-rules.js（瀏覽器後台共用），這裡加上整批把關、個資掃描與寫檔。
//
// 輸出兩個檔（都在 data/snapshots/）：
//   travel-epidemic.json        現行清單。每列沿用既有欄位（Disease、Country、CountryEn、ISO2、StartDate、Summary、Url、headline、description、
//                               effective、expires…，既有消費者 travel.mjs／答案引擎／emit-api 不變），新增 id、status、areas[]、iso2s[]、body、
//                               diseaseId、provenance。meta 保留既有欄位（mode 仍是 'live'），另加 source、importedAt、producer、importMode（full｜delta）。
//   intl-epidemic-import.json   匯入紀錄：lastRun（這次收到／接受／退回／對不上／保留不動）＋ history（近 30 次摘要）。治理引擎據此產生待辦。
// 整批保留（held）時不覆寫快照、只寫紀錄；與上次完全相同（noop）且紀錄重點沒變時兩個檔都不寫（不產生 commit）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// ajv／ajv-formats 的 CJS 預設匯出（同 validate.mjs 的寫法）
import Ajv2020Module from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import * as R from '../../src/client/intl-epidemic-rules.js';
import { normalizeTravelRow } from './travel-normalize.mjs';
import { loadAllowlist, scanText } from './pii-scan.mjs';

/** @type {typeof import('ajv/dist/2020.js').default} */
// @ts-ignore CJS interop
const Ajv2020 = Ajv2020Module.default ?? Ajv2020Module;
/** @type {typeof import('ajv-formats').default} */
// @ts-ignore CJS interop
const addFormats = addFormatsModule.default ?? addFormatsModule;

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SNAPSHOT_FILE = 'travel-epidemic.json';
export const RECORD_FILE = 'intl-epidemic-import.json';
export const OFFICIAL_EXPORT_URL = 'https://www.cdc.gov.tw/TravelEpidemic/ExportJSON';
export const SOURCES = ['feed', 'official-export', 'manual', 'push'];
/** 退回比例超過這個值 ⇒ 整批保留 */
export const REJECT_HOLD_SHARE = 0.2;
/** full 模式會讓現行清單少掉這個比例以上 ⇒ 整批保留 */
export const SHRINK_HOLD_SHARE = 0.5;
export const HISTORY_MAX = 30;
const SNAPSHOT_REL = `data/snapshots/${SNAPSHOT_FILE}`;
const DEFAULT_LABEL = '國際重要疫情資訊（近 30 天）';

/** 台北時間的今天（YYYY-MM-DD） */
export const taipeiToday = (now = new Date()) => new Date(new Date(now).getTime() + 8 * 3600e3).toISOString().slice(0, 10);

const readJSON = (p, fallback = null) => {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return fallback;
  }
};
/** 疾病主檔與國家主檔（content/master/） */
export function loadMasters(root = ROOT) {
  return {
    diseases: readJSON(path.join(root, 'content', 'master', 'diseases.json'), []),
    countries: readJSON(path.join(root, 'content', 'master', 'countries.json'), []),
  };
}

/* ───────── parse ───────── */
/**
 * 任何一種輸入 → v1 feed。input：字串（JSON 或 CSV 原文）或已 parse 的物件。
 * 回傳的 feed 另帶 shape（v1｜legacy｜csv）；舊格式另帶 legacy（id → 原始列，讓快照列保留官網原欄位、資料本身不變）。
 * @param {string|object} input
 * @param {{ shape?: 'v1'|'legacy'|'csv' }} [opt]
 * @returns {{ version:string, producer?:string, generatedAt?:string, mode?:'full'|'delta', note?:string, items:object[], shape:string, legacy?:Map<string,object> }}
 */
export function parseFeed(input, { shape } = {}) {
  let data = input;
  const kind = shape ?? R.detectShape(input);
  if (typeof input === 'string' && kind !== 'csv') {
    try {
      data = JSON.parse(input.replace(/^﻿/, ''));
    } catch (e) {
      throw new Error(`看不懂這份資料：不是合法的 JSON（${e.message}）`);
    }
  }
  if (kind === 'csv') {
    if (typeof input !== 'string') throw new Error('CSV 要以文字傳入');
    return { version: R.FEED_VERSION, mode: 'full', items: R.fromCsvRows(R.parseCsv(input)), shape: 'csv' };
  }
  if (kind === 'legacy') {
    const rows = Array.isArray(data) ? data : (data?.data ?? data?.Data ?? data?.result ?? []);
    const items = R.fromLegacyRows(rows);
    const legacy = new Map();
    rows.filter((r) => r && typeof r === 'object').forEach((r, k) => legacy.set(items[k].id, r));
    return { version: R.FEED_VERSION, producer: '現行官網 TravelEpidemic/ExportJSON', mode: 'full', items, shape: 'legacy', legacy };
  }
  if (kind === 'v1') {
    if (Array.isArray(data)) return { version: R.FEED_VERSION, mode: 'full', items: data, shape: 'v1' };
    return { ...data, items: Array.isArray(data.items) ? data.items : [], shape: 'v1' };
  }
  throw new Error('看不懂這份資料的格式：請用交換格式 v1（{ version, items }）、CSV，或現行官網 ExportJSON 的每列格式');
}

/* ───────── validate ───────── */
let ajvCache = null;
function validators() {
  if (ajvCache) return ajvCache;
  const schema = JSON.parse(fs.readFileSync(path.join(ROOT, 'schemas', 'intl-epidemic-feed.json'), 'utf8'));
  const ajv = new Ajv2020({ allErrors: true, strict: false, allowUnionTypes: true });
  addFormats(ajv);
  ajv.addSchema(schema);
  ajvCache = {
    envelope: ajv.compile({ $ref: `${schema.$id}` }),
    item: ajv.compile({ $ref: `${schema.$id}#/$defs/item` }),
  };
  return ajvCache;
}
const pathToField = (p) =>
  String(p ?? '')
    .replace(/^\//, '')
    .split('/')
    .filter(Boolean)
    .reduce((s, seg) => (/^\d+$/.test(seg) ? `${s}[${seg}]` : s ? `${s}.${seg}` : seg), '');
/** ajv 錯誤 → 白話訊息 */
function ajvMessage(e) {
  let field = pathToField(e.instancePath);
  if (e.keyword === 'required') field = field ? `${field}.${e.params.missingProperty}` : e.params.missingProperty;
  const label = R.labelOf(field || 'item');
  const msg = {
    required: `缺少${label}`,
    maxLength: `${label}太長（上限 ${e.params.limit} 字）`,
    minLength: `${label}不能是空的`,
    pattern: `${label}格式不對`,
    enum: `${label}只能是 ${(e.params.allowedValues ?? []).map((v) => (v === null ? '空值' : v)).join('、')}`,
    const: `${label}只能是 ${JSON.stringify(e.params.allowedValue)}`,
    type: `${label}型別不對（應為 ${e.params.type}）`,
    minItems: `${label}至少要有 ${e.params.limit} 個`,
    anyOf: `${label}要有國家名稱（country）或 ISO 國碼（iso2）至少一個`,
  }[e.keyword];
  return msg ? { field: field || 'item', label, message: msg } : null;
}
const topOf = (f) => String(f).split(/[.[]/)[0];

/**
 * 驗證整份 feed：信封（ajv）＋每一則（ajv schema ＋ checkItem 白話規則 ＋ 個資掃描）。
 * @param {ReturnType<typeof parseFeed>} feed
 * @param {{ today?: string, diseases?: object[], countries?: object[], allowlist?: object }} [ctx]
 * @returns {{ envelopeErrors: {field,label,message}[], results: { index:number, id:string|null, item:object, errors:object[], warnings:object[], diseaseId:string|null, iso2s:string[], unmapped:object[], pii:boolean }[] }}
 */
export function validateFeed(feed, ctx = {}) {
  const v = validators();
  const env = { version: feed?.version, items: [] };
  for (const k of ['producer', 'generatedAt', 'mode', 'note']) if (feed?.[k] != null) env[k] = feed[k];
  const envelopeErrors = v.envelope(env) ? [] : (v.envelope.errors ?? []).map(ajvMessage).filter(Boolean);
  const allow = ctx.allowlist ?? { numbers: new Set(), domains: [], entries: [], errors: [] };
  const results = (feed?.items ?? []).map((item, index) => {
    const c = R.checkItem(item, ctx);
    const errors = [...c.errors];
    if (!v.item(item)) {
      const covered = new Set(errors.map((e) => topOf(e.field)));
      for (const e of (v.item.errors ?? []).map(ajvMessage).filter(Boolean)) {
        if (covered.has(topOf(e.field))) continue;
        covered.add(topOf(e.field));
        errors.push(e);
      }
    }
    // 個資（沿用 scripts/lib/pii-scan.mjs 的規則與白名單）
    let pii = false;
    if (item && typeof item === 'object') {
      const texts = [
        ['headline', item.headline],
        ['body', item.body],
        ['instruction', item.instruction],
        ['disease', item.disease],
        ...(Array.isArray(item.areas) ? item.areas.map((a, k) => [`areas[${k}]`, a?.detail]) : []),
      ];
      for (const [field, text] of texts) {
        if (typeof text !== 'string' || !text) continue;
        const hits = scanText(text, allow, SNAPSHOT_REL);
        if (!hits.length) continue;
        pii = true;
        errors.push({
          field,
          label: R.labelOf(field),
          message: `${R.labelOf(field)}疑似含個資（${hits.map((h) => `${h.label} ${h.masked}`).join('、')}）：國際疫情資訊不應出現個人資料，請刪除後再送`,
        });
      }
    }
    const id = typeof item?.id === 'string' && item.id.trim() ? item.id.trim() : null;
    return { index, id, item, errors, warnings: c.warnings, diseaseId: c.diseaseId, iso2s: c.iso2s, unmapped: c.unmapped, pii };
  });
  return { envelopeErrors, results };
}

/* ───────── plan ───────── */
const rowsOf = (current) => (Array.isArray(current) ? current : Array.isArray(current?.data) ? current.data : []).filter((r) => r && typeof r === 'object');
const rowId = (r) => (typeof r.id === 'string' && r.id ? r.id : R.legacyIdOf(r));
const rowSortKey = (r) => String(r.effective ?? r.sent ?? r.StartDate ?? '');
const dateOnly = (v) => R.dateOf(v);

/** v1 item → CAP 樣式原始列（與官網匯出同欄位名），再經 normalizeTravelRow 補上本站慣用欄位 */
function capRawOf(item) {
  const areas = item.areas ?? [];
  const join = (k, sep = ',') => (areas.map((a) => a?.[k] ?? '').some(Boolean) ? areas.map((a) => a?.[k] ?? '').join(sep) : null);
  return {
    sent: item.updatedAt ?? item.publishedAt ?? null,
    effective: item.publishedAt ?? null,
    expires: item.expiresAt ?? null,
    headline: item.headline ?? null,
    description: item.body ?? null,
    instruction: item.instruction ?? null,
    web: item.sourceUrl ?? null,
    alert_title: '國際重要疫情資訊',
    severity_level: item.severity ?? null,
    alert_disease: item.disease ?? null,
    ...(item.diseaseEn ? { alert_disease_EN: item.diseaseEn } : {}),
    areaDesc: join('country'),
    areaDesc_EN: join('countryEn'),
    ISO3166: join('iso2'),
    areaDetail: areas.some((a) => a?.detail)
      ? areas
          .filter((a) => a?.detail)
          .map((a) => (areas.length > 1 && a.country ? `${a.country}：${a.detail}` : a.detail))
          .join('；')
      : null,
  };
}

/** 一則 → 快照列 */
function toRow(item, check, { raw, provenance }) {
  const base = normalizeTravelRow(raw ? { ...raw } : capRawOf(item));
  for (const k of ['id', 'status', 'areas', 'iso2s', 'body', 'diseaseId', 'provenance', 'references']) delete base[k];
  return {
    ...base,
    id: check.id,
    status: item.status ?? 'published',
    areas: (item.areas ?? []).map((a) => ({ ...a })),
    iso2s: check.iso2s,
    body: item.body ?? null,
    diseaseId: check.diseaseId ?? null,
    ...(Array.isArray(item.references) && item.references.length ? { references: item.references } : {}),
    provenance: { ...provenance, hash: R.itemFingerprint(item) },
  };
}

/**
 * 依第 5 節規則算出這次匯入的結果（不寫檔）。
 * @param {{ current?: object|object[], feed: ReturnType<typeof parseFeed>, today?: string, mode?: 'full'|'delta',
 *           source?: 'feed'|'official-export'|'manual'|'push', producer?: string, by?: string|null, now?: string,
 *           diseases?: object[], countries?: object[], allowlist?: object }} opt
 * @returns {{ snapshotRows: object[], report: object, held: boolean, noop: boolean, mode: 'full'|'delta',
 *             changes: { new: string[], updated: string[], withdrawn: {id:string,reason:'withdrawn'|'expired'|'missing'}[], unchanged: string[] },
 *             source: string, producer: string|null, by: string|null, now: string, today: string }}
 */
export function planImport(opt) {
  const now = opt.now ?? new Date().toISOString();
  const today = opt.today ?? taipeiToday(now);
  const feed = opt.feed ?? { items: [] };
  const mode = opt.mode ?? feed.mode ?? 'full';
  const source = opt.source ?? (feed.shape === 'legacy' ? 'official-export' : 'manual');
  const producer = opt.producer ?? feed.producer ?? null;
  const by = opt.by ?? null;
  const masters =
    opt.diseases && opt.countries
      ? { diseases: opt.diseases, countries: opt.countries }
      : { ...loadMasters(), ...(opt.diseases ? { diseases: opt.diseases } : {}), ...(opt.countries ? { countries: opt.countries } : {}) };
  const allowlist = opt.allowlist ?? loadAllowlist(ROOT);
  const ctx = { today, diseases: masters.diseases, countries: masters.countries, allowlist };
  const currentRows = rowsOf(opt.current);
  const provenance = { source, producer, importedAt: now, by };

  const { envelopeErrors, results: all } = validateFeed(feed, ctx);
  const warnings = [];
  // 同一次 feed 內重複的 id：以最後一筆為準（記警告）
  const lastIndex = new Map();
  for (const r of all) if (r.id) lastIndex.set(r.id, r.index);
  const results = all.filter((r) => !r.id || lastIndex.get(r.id) === r.index);
  for (const r of all)
    if (r.id && lastIndex.get(r.id) !== r.index) warnings.push({ id: r.id, message: `識別碼 ${r.id} 在這批資料出現不只一次，以最後一筆為準` });

  const rejected = results.filter((r) => r.errors.length);
  const accepted = results.filter((r) => !r.errors.length);
  const curById = new Map(currentRows.map((r) => [rowId(r), r]));
  const seen = new Set(results.map((r) => r.id).filter(Boolean));
  const changes = { new: [], updated: [], withdrawn: [], unchanged: [] };
  let upgraded = 0;
  const nextById = new Map();

  // delta：沒送來的照舊；full：這批就是現行全部，沒送來的視為撤下（下面逐則加回）
  if (mode === 'delta') for (const [id, row] of curById) nextById.set(id, row);
  // 退回的那一則：網站保留上一版（不因新版有錯就把舊的拿掉）
  for (const r of rejected) if (r.id && curById.has(r.id)) nextById.set(r.id, curById.get(r.id));

  for (const r of accepted) {
    const item = r.item;
    const cur = curById.get(r.id);
    if ((item.status ?? 'published') === 'withdrawn') {
      if (cur) changes.withdrawn.push({ id: r.id, reason: 'withdrawn' });
      else warnings.push({ id: r.id, message: `撤下的識別碼 ${r.id} 不在現行清單，略過` });
      nextById.delete(r.id);
      continue;
    }
    if (item.expiresAt && dateOnly(item.expiresAt) && dateOnly(item.expiresAt) < today) {
      if (cur) changes.withdrawn.push({ id: r.id, reason: 'expired' });
      nextById.delete(r.id);
      continue;
    }
    const row = toRow(item, r, { raw: feed.legacy?.get(r.id), provenance });
    if (!cur) {
      changes.new.push(r.id);
      nextById.set(r.id, row);
      continue;
    }
    const curHash = cur.provenance?.hash ?? R.itemFingerprint(R.fromLegacyRows([cur])[0]);
    const sameMapping = (cur.diseaseId ?? null) === row.diseaseId && JSON.stringify(cur.iso2s ?? null) === JSON.stringify(row.iso2s);
    if (curHash === row.provenance.hash && sameMapping) {
      changes.unchanged.push(r.id);
      nextById.set(r.id, cur);
      continue;
    }
    if (curHash === row.provenance.hash && !cur.provenance) {
      changes.unchanged.push(r.id);
      upgraded++;
      nextById.set(r.id, row);
      continue;
    }
    changes.updated.push(r.id);
    nextById.set(r.id, row);
  }
  if (mode === 'full') for (const id of curById.keys()) if (!seen.has(id)) changes.withdrawn.push({ id, reason: 'missing' });

  // 依發布時間新到舊（同時間維持輸入順序）
  const order = new Map(results.map((r, k) => [r.id, k]));
  const nextRows = [...nextById.entries()]
    .map(([id, row], k) => ({ id, row, k: order.get(id) ?? results.length + k }))
    .sort((a, b) => rowSortKey(b.row).localeCompare(rowSortKey(a.row)) || a.k - b.k)
    .map((x) => x.row);

  // 整批保留的條件
  const heldReasons = [];
  const received = results.length;
  if (envelopeErrors.length) heldReasons.push(`整份資料的格式不對：${envelopeErrors.map((e) => e.message).join('；')}`);
  if (received && rejected.length / received > REJECT_HOLD_SHARE)
    heldReasons.push(`退回 ${rejected.length}／${received} 則（${Math.round((rejected.length / received) * 100)}%），超過 ${REJECT_HOLD_SHARE * 100}%`);
  if (mode === 'full' && received === 0) heldReasons.push('full 模式卻收到 0 則：可能是資料庫匯出失敗，網站先保留上一版');
  const removed = [...curById.keys()].filter((id) => !nextById.has(id)).length;
  if (mode === 'full' && currentRows.length && received > 0 && removed / currentRows.length >= SHRINK_HOLD_SHARE)
    heldReasons.push(`這批會讓現行清單從 ${currentRows.length} 則變成 ${nextRows.length} 則（少掉 ${removed} 則，一半以上）：請確認是否真的要撤下這麼多`);
  const held = heldReasons.length > 0;

  // 對不上主檔（彙整：同一個值列一次，附哪幾則）
  const unmappedMap = new Map();
  for (const r of accepted)
    for (const u of r.unmapped) {
      const key = `${u.kind}\u0000${u.value}`;
      if (!unmappedMap.has(key)) unmappedMap.set(key, { kind: u.kind, value: u.value, ids: [] });
      if (!unmappedMap.get(key).ids.includes(r.id)) unmappedMap.get(key).ids.push(r.id);
    }
  const short = (s, n = 60) => (typeof s === 'string' ? (s.length > n ? `${s.slice(0, n)}…` : s) : null);
  const noop = !held && !changes.new.length && !changes.updated.length && !changes.withdrawn.length && !upgraded;
  const report = {
    shape: feed.shape ?? null,
    mode,
    producer,
    generatedAt: feed.generatedAt ?? null,
    received,
    accepted: accepted.length,
    counts: {
      new: changes.new.length,
      updated: changes.updated.length,
      withdrawn: changes.withdrawn.length,
      unchanged: changes.unchanged.length,
      rejected: rejected.length,
      upgraded,
    },
    total: held ? currentRows.length : nextRows.length,
    held: held ? { reasons: heldReasons } : null,
    rejected: rejected.map((r) => ({
      id: r.id,
      index: r.index,
      headline: r.pii ? '（含疑似個資，標題不列出）' : short(r.item?.headline),
      errors: r.errors.map((e) => `${e.message}`),
    })),
    unmapped: [...unmappedMap.values()],
    withdrawn: changes.withdrawn,
    warnings: [
      ...warnings,
      ...accepted.flatMap((r) =>
        r.warnings.filter((w) => !['disease'].includes(w.field) && !/^areas\[/.test(w.field)).map((w) => ({ id: r.id, message: w.message })),
      ),
    ],
  };
  return { snapshotRows: held ? currentRows : nextRows, report, held, noop, mode, changes, source, producer, by, now, today };
}

/* ───────── apply ───────── */
const recordSignature = (run) =>
  JSON.stringify({
    held: run?.held ?? null,
    rejected: (run?.rejected ?? []).map((r) => [r.id, r.errors]),
    unmapped: (run?.unmapped ?? []).map((u) => [u.kind, u.value, u.ids]),
  });
const summaryOf = (run) => ({
  at: run.at,
  source: run.source,
  producer: run.producer,
  by: run.by ?? null,
  mode: run.mode,
  received: run.received,
  accepted: run.accepted,
  total: run.total,
  counts: run.counts,
  unmapped: run.unmapped.length,
  held: run.held ? run.held.reasons : null,
  wroteSnapshot: run.wroteSnapshot,
});

/**
 * 寫檔：travel-epidemic.json（held／noop 時不寫）與 intl-epidemic-import.json（lastRun ＋ history 近 30 次）。
 * @param {ReturnType<typeof planImport>} plan
 * @param {{ snapshotsDir?: string, now?: string, source?: string, producer?: string|null, by?: string|null, sourceUrl?: string|null, fetched?: boolean, dry?: boolean }} [opt]
 *        fetched：false＝資料不是這次從網路取得（讀本機檔），meta.fetchedAt 沿用上一版。
 *        sourceUrl：只在來源是公開網址時給（官網匯出）；INTL_FEED_URL 可能是內網位址或含權杖，不寫進公開快照。
 * @returns {{ wrote: string[], snapshot: {meta:object,data:object[]}|null, record: object, skipped: boolean }}
 */
export function applyImport(plan, opt = {}) {
  const dir = opt.snapshotsDir ?? path.join(ROOT, 'data', 'snapshots');
  const now = opt.now ?? plan.now ?? new Date().toISOString();
  const source = opt.source ?? plan.source;
  const producer = opt.producer ?? plan.producer ?? null;
  const by = opt.by ?? plan.by ?? null;
  const snapPath = path.join(dir, SNAPSHOT_FILE);
  const recPath = path.join(dir, RECORD_FILE);
  const prev = readJSON(snapPath, null);
  const prevRec = readJSON(recPath, null);
  const wrote = [];

  let snapshot = null;
  const writeSnap = !plan.held && !plan.noop;
  if (writeSnap) {
    const data = plan.snapshotRows;
    const meta = { ...(prev?.meta ?? {}) };
    delete meta.note;
    delete meta.lastLiveAttempt;
    Object.assign(meta, {
      mode: 'live',
      // fetchedAt＝最後一次從來源即時取得；從本機檔案匯入（後台貼上、CLI 讀檔）時沿用上一版
      fetchedAt: opt.fetched === false ? (meta.fetchedAt ?? now) : now,
      label: meta.label ?? DEFAULT_LABEL,
      count: data.length,
      dataDate:
        data
          .map((r) => r.StartDate)
          .filter(Boolean)
          .sort()
          .at(-1) ?? now.slice(0, 10),
      windowDays: meta.windowDays ?? 30,
      source,
      importedAt: now,
      producer,
      importMode: plan.mode,
    });
    if (source === 'official-export') meta.sourceUrl = opt.sourceUrl ?? meta.sourceUrl ?? OFFICIAL_EXPORT_URL;
    else if (opt.sourceUrl !== undefined) meta.sourceUrl = opt.sourceUrl;
    else delete meta.sourceUrl;
    snapshot = { meta, data };
  }

  const run = { at: now, source, by, ...plan.report, producer: producer ?? plan.report.producer, wroteSnapshot: writeSnap };
  const skip = plan.noop && prevRec?.lastRun && recordSignature(prevRec.lastRun) === recordSignature(run);
  const record = skip ? prevRec : { version: 1, lastRun: run, history: [summaryOf(run), ...(prevRec?.history ?? [])].slice(0, HISTORY_MAX) };
  if (!opt.dry) {
    fs.mkdirSync(dir, { recursive: true });
    if (snapshot) {
      fs.writeFileSync(snapPath, JSON.stringify(snapshot, null, 2) + '\n');
      wrote.push(snapPath);
    }
    if (!skip) {
      fs.writeFileSync(recPath, JSON.stringify(record, null, 2) + '\n');
      wrote.push(recPath);
    }
  }
  return { wrote, snapshot, record, skipped: skip };
}

/** 給 log／CLI：一行白話摘要 */
export function describePlan(plan) {
  const c = plan.report.counts;
  const head = plan.held ? '整批保留不動（快照不覆寫）' : plan.noop ? '與上次完全相同' : '可上架';
  const parts = [
    `收到 ${plan.report.received} 則`,
    `新增 ${c.new}`,
    `更新 ${c.updated}`,
    `撤下 ${c.withdrawn}`,
    `不變 ${c.unchanged}`,
    `退回 ${c.rejected}`,
    `對不上主檔 ${plan.report.unmapped.length} 項`,
  ];
  return `${head}：${parts.join('、')}；現行清單 ${plan.report.total} 則${plan.held ? `。原因：${plan.report.held.reasons.join('；')}` : ''}`;
}
