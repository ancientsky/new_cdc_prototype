// 國際重要疫情資訊（docs/intl-epidemic.md）的共用純規則：瀏覽器與 Node 共用，沒有任何 import。
// 後台 /admin/intl-epidemic/ 貼上／上傳時在瀏覽器即時檢查；CI 排程、推送端點、CLI 匯入器（scripts/lib/intl-epidemic.mjs）跑的是同一份。
// 這裡只放「看一則資料就能判斷」的規則；整批的把關（退回比例、full 模式少掉一半、個資掃描）在 Node 端的匯入器。
//
// 契約三種輸入形狀（detectShape）：
//   v1      { version: '1', producer, generatedAt, mode, items: [...] }（schemas/intl-epidemic-feed.json）
//   legacy  現行官網 TravelEpidemic/ExportJSON 的每列（CAP 欄位：headline、description、effective、alert_disease、areaDesc、ISO3166、web…）
//   csv     與 v1 等價的 CSV（多國以 ; 分隔；欄名見 CSV_COLUMNS）

export const FEED_VERSION = '1';
export const STATUSES = ['published', 'updated', 'withdrawn'];
export const MODES = ['full', 'delta'];
export const LIMITS = { headline: 120, body: 8000, instruction: 2000, id: 80 };
export const ID_RE = /^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,79}$/;
export const ISO2_RE = /^[A-Z]{2}$/;
/** 日期或日期時間（ISO 8601）：2026-10-02、2026-10-02T07:48:32+08:00、2026-10-02T07:48Z */
export const DATETIME_RE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
export const CSV_COLUMNS = [
  'id',
  'status',
  'publishedAt',
  'updatedAt',
  'expiresAt',
  'disease',
  'diseaseEn',
  'headline',
  'body',
  'instruction',
  'countries',
  'countriesEn',
  'iso2s',
  'areaDetail',
  'severity',
  'sourceUrl',
];
/** 不是國家、也不該列成「對不上主檔」的地區字樣 */
export const GLOBAL_AREAS = ['全球', '全世界', '世界', '國際', 'global', 'worldwide', 'world'];

/** 欄位 → 承辦人看得懂的名稱 */
export const FIELD_LABEL = {
  id: '識別碼（id）',
  status: '狀態',
  publishedAt: '發布時間',
  updatedAt: '更新時間',
  expiresAt: '下架時間',
  disease: '疾病',
  diseaseEn: '疾病英文名',
  diseaseId: '疾病主檔 id',
  headline: '標題',
  body: '內文',
  instruction: '建議措施',
  areas: '國家／地區',
  severity: '等級',
  sourceUrl: '原始網址',
  references: '參考資料',
  lang: '語言',
  item: '這一則',
};
export const labelOf = (field) => {
  const top = String(field ?? '').split(/[.[]/)[0];
  if (/^areas\[\d+\]/.test(String(field))) {
    const n = Number(String(field).match(/^areas\[(\d+)\]/)[1]) + 1;
    return `第 ${n} 個國家／地區`;
  }
  return FIELD_LABEL[top] ?? field;
};

const isBlank = (v) => v == null || (typeof v === 'string' && v.trim() === '');
const str = (v) => (isBlank(v) ? null : String(v).trim());

/* ───────── 雜湊（沒有 epidemicId 時的穩定 id） ───────── */
/** cyrb53：53 位元非加密雜湊，瀏覽器與 Node 結果相同 */
export function stableHash(s, seed = 0) {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/* ───────── 日期 ───────── */
/** 'YYYY-MM-DD'；民國年、斜線也容錯（2025/8/5、114/08/05）。無法判讀回 null */
export function dateOf(v) {
  const s = str(v);
  if (!s) return null;
  const m = s.match(/^(\d{2,4})[/.\-年](\d{1,2})[/.\-月](\d{1,2})/);
  if (!m) return null;
  let y = Number(m[1]);
  if (y < 1911) y += 1911;
  return `${y}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
}
/** 把容錯日期轉成契約格式：已是 ISO 就原樣；斜線／民國年轉成 YYYY-MM-DD */
function isoDateTime(v) {
  const s = str(v);
  if (!s) return null;
  if (DATETIME_RE.test(s)) return s;
  return dateOf(s) ?? s;
}

/* ───────── CSV ───────── */
/**
 * RFC 4180 CSV → 物件陣列（第一列為欄名）。UTF-8 BOM、CRLF／LF、雙引號（"" 跳脫）、引號內換行都支援；全空白列略過。
 * @param {string} text
 * @returns {Record<string, string>[]}
 */
export function parseCsv(text) {
  const s = String(text ?? '').replace(/^﻿/, '');
  const records = [];
  let row = [];
  let field = '';
  let quoted = false;
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"' && field === '') {
      quoted = true;
      i++;
      continue;
    }
    if (c === ',') {
      row.push(field);
      field = '';
      i++;
      continue;
    }
    if (c === '\r' || c === '\n') {
      row.push(field);
      records.push(row);
      row = [];
      field = '';
      i += c === '\r' && s[i + 1] === '\n' ? 2 : 1;
      continue;
    }
    field += c;
    i++;
  }
  if (field !== '' || row.length) {
    row.push(field);
    records.push(row);
  }
  const nonEmpty = records.filter((r) => r.some((x) => x.trim() !== ''));
  if (!nonEmpty.length) return [];
  const header = nonEmpty[0].map((h) => h.trim());
  return nonEmpty.slice(1).map((r) => Object.fromEntries(header.map((h, k) => [h, r[k] ?? '']).filter(([h]) => h)));
}

const splitList = (v) =>
  isBlank(v)
    ? []
    : String(v)
        .split(/[;；]/)
        .map((x) => x.trim());

/** 等級：1｜2｜3｜null（「第二級」「Level 2」「2」都可） */
export function severityOf(v) {
  if (isBlank(v)) return null;
  if (typeof v === 'number') return v;
  const s = String(v).trim();
  if (/^[123]$/.test(s)) return Number(s);
  const m = s.match(/第\s*([一二三123])\s*級|level\s*([123])/i);
  if (m) {
    const x = m[1] ?? m[2];
    return '一二三'.includes(x) ? '一二三'.indexOf(x) + 1 : Number(x);
  }
  return s; // 原樣回傳，讓檢查報「等級只能是 1、2、3」
}

/** CSV 列（parseCsv 的輸出）→ v1 items */
export function fromCsvRows(rows) {
  return (rows ?? []).map((r) => {
    const names = splitList(r.countries);
    const ens = splitList(r.countriesEn);
    const isos = splitList(r.iso2s);
    const details = splitList(r.areaDetail);
    const n = Math.max(names.length, ens.length, isos.length);
    const areas = [];
    for (let k = 0; k < n; k++) {
      const a = {};
      if (names[k]) a.country = names[k];
      if (ens[k]) a.countryEn = ens[k];
      if (isos[k]) a.iso2 = isos[k].toUpperCase();
      if (details[k]) a.detail = details[k];
      if (Object.keys(a).length) areas.push(a);
    }
    const item = {};
    for (const k of [
      'id',
      'status',
      'publishedAt',
      'updatedAt',
      'expiresAt',
      'disease',
      'diseaseEn',
      'diseaseId',
      'headline',
      'body',
      'instruction',
      'sourceUrl',
      'lang',
    ]) {
      const v = str(r[k]);
      if (v != null) item[k] = k === 'body' ? String(r[k]).replace(/\r\n?/g, '\n').trim() : v;
    }
    item.areas = areas;
    const sev = severityOf(r.severity);
    if (sev != null) item.severity = sev;
    return item;
  });
}

/* ───────── 舊格式（現行官網 ExportJSON／CAP 欄位） ───────── */
const pickRaw = (o, keys) => {
  for (const k of keys) if (!isBlank(o?.[k])) return o[k];
  return null;
};
/** web 網址的 epidemicId 參數（現行官網每則的穩定主鍵） */
export function epidemicIdOf(url) {
  const m = String(url ?? '').match(/[?&]epidemicId=([^&#]+)/i);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}
/** 「孟加拉/尚比亞-炭疽病」→ { areas: ['孟加拉','尚比亞'], disease: '炭疽病' }（沒有「-」回 null） */
export function splitHeadline(h) {
  const s = str(h);
  if (!s) return null;
  const at = s.search(/\s*[-－–—]\s*/);
  if (at <= 0) return null;
  const head = s.slice(0, at);
  const tail = s.slice(at).replace(/^\s*[-－–—]\s*/, '');
  return {
    areas: head
      .split(/[/／、,]/)
      .map((x) => x.trim())
      .filter(Boolean),
    disease: tail.trim() || null,
  };
}
/** 舊格式一列的 id：epidemicId；沒有就用「標題＋發布日」的穩定雜湊（更新標題會變成新的一則，見 docs 第 7 節問題 2） */
export function legacyIdOf(r) {
  const fromWeb = epidemicIdOf(pickRaw(r, ['web', 'Url', 'url', 'link']));
  if (fromWeb && ID_RE.test(fromWeb)) return fromWeb;
  const date = dateOf(pickRaw(r, ['effective', 'sent', 'StartDate', 'publishedAt'])) ?? '';
  return `h-${stableHash(`${str(pickRaw(r, ['headline', 'Disease', 'alert_disease'])) ?? ''}|${date}`)}`;
}
const cleanBody = (s) =>
  isBlank(s)
    ? null
    : String(s)
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .map((l) => l.trim())
        .filter((l, k, a) => l || (k > 0 && a[k - 1]))
        .join('\n')
        .trim() || null;

/** 舊格式列（官網 ExportJSON 原始列，或已經 normalizeTravelRow 過的快照列）→ v1 items */
export function fromLegacyRows(rows) {
  return (rows ?? [])
    .filter((r) => r && typeof r === 'object')
    .map((r) => {
      const headline = str(pickRaw(r, ['headline', 'alert_title']));
      const hl = splitHeadline(headline);
      // alert_disease 優先；官網缺 alert_disease 時取標題「國家-疾病」的疾病段（快照列的 Disease 在這種情況是整個標題，放最後）
      const disease = str(r.alert_disease) ?? hl?.disease ?? str(r.Disease) ?? headline;
      const names = String(pickRaw(r, ['areaDesc', 'Country']) ?? '')
        .split(/[,、，]/)
        .map((x) => x.trim())
        .filter(Boolean);
      const ens = String(pickRaw(r, ['areaDesc_EN', 'CountryEn']) ?? '')
        .split(/[,，]/)
        .map((x) => x.trim());
      const isos = String(pickRaw(r, ['ISO3166', 'ISO2']) ?? '')
        .split(/[,，\s]+/)
        .map((x) => x.trim().toUpperCase())
        .filter(Boolean);
      const n = Math.max(names.length, isos.length);
      let areas = [];
      for (let k = 0; k < n; k++) {
        const a = {};
        if (names[k]) a.country = names[k];
        if (ens[k]) a.countryEn = ens[k];
        if (isos[k]) a.iso2 = isos[k];
        if (Object.keys(a).length) areas.push(a);
      }
      if (!areas.length && hl?.areas?.length) areas = hl.areas.map((country) => ({ country }));
      const detail = str(r.areaDetail);
      if (detail && areas[0]) areas[0].detail = detail;
      const published = isoDateTime(pickRaw(r, ['effective', 'sent', 'StartDate']));
      const sent = isoDateTime(r.sent);
      const item = { id: legacyIdOf(r), status: 'published' };
      if (published) item.publishedAt = published;
      if (sent && published && sent !== published) item.updatedAt = sent;
      const exp = isoDateTime(r.expires);
      if (exp) item.expiresAt = exp;
      if (disease) item.disease = disease;
      const dEn = str(pickRaw(r, ['alert_disease_EN', 'DiseaseEn']));
      if (dEn) item.diseaseEn = dEn;
      if (headline) item.headline = headline;
      const body = cleanBody(pickRaw(r, ['description', 'Summary']));
      if (body) item.body = body;
      const ins = cleanBody(r.instruction);
      if (ins) item.instruction = ins;
      item.areas = areas;
      const sev = severityOf(r.severity_level);
      item.severity = typeof sev === 'number' ? sev : null;
      const web = str(pickRaw(r, ['web', 'Url']));
      if (web) item.sourceUrl = web;
      item.lang = 'zh-TW';
      return item;
    });
}

/* ───────── 形狀判斷 ───────── */
const LEGACY_KEYS = ['headline', 'description', 'effective', 'alert_disease', 'areaDesc', 'ISO3166', 'web', 'sent'];
/**
 * 判斷輸入形狀。字串：看起來像 JSON 就先 parse；否則當 CSV。
 * @returns {'v1'|'legacy'|'csv'|'unknown'}
 */
export function detectShape(input) {
  if (typeof input === 'string') {
    const t = input.replace(/^﻿/, '').trim();
    if (!t) return 'unknown';
    if (t[0] === '{' || t[0] === '[') {
      try {
        return detectShape(JSON.parse(t));
      } catch {
        return 'unknown';
      }
    }
    return /,/.test(t.split(/\r?\n/)[0]) ? 'csv' : 'unknown';
  }
  if (!input || typeof input !== 'object') return 'unknown';
  if (!Array.isArray(input) && Array.isArray(input.items) && (input.version != null || input.mode != null || input.producer != null)) return 'v1';
  const rows = Array.isArray(input)
    ? input
    : Array.isArray(input.data)
      ? input.data
      : Array.isArray(input.Data)
        ? input.Data
        : Array.isArray(input.result)
          ? input.result
          : null;
  if (rows) {
    const first = rows.find((x) => x && typeof x === 'object');
    if (!first) return 'legacy'; // 空陣列：當舊格式（0 則；full 模式會被整批保留）
    if (LEGACY_KEYS.filter((k) => k in first).length >= 2) return 'legacy';
    if ('publishedAt' in first && 'areas' in first) return 'v1';
  }
  if (Array.isArray(input.items)) return 'v1';
  return 'unknown';
}

/* ───────── 主檔對應 ───────── */
/** 比對用：NFKC（全形→半形、康熙部首→一般字）、小寫、全形斜線＝半形、去空白 */
export const normName = (s) =>
  String(s ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/／/g, '/')
    .replace(/\s+/g, '');

/**
 * 疾病名稱 → 疾病主檔（content/master/diseases.json）。先比名稱／英文名／別名完全相符，再比「包含」（與 /travel/ 的 diseaseMasterOf 一致）。
 * @returns {object|null}
 */
export function mapDisease(name, diseases) {
  const ms = Array.isArray(diseases) ? diseases : [];
  const n = normName(name);
  if (!n) return null;
  const names = (d) => [d.name, d.nameEn, ...(d.aliases ?? [])].filter(Boolean).map(normName);
  return ms.find((d) => names(d).includes(n)) ?? ms.find((d) => names(d).some((x) => x.length >= 2 && n.includes(x))) ?? null;
}

/**
 * 國家／地區 → 國家主檔（content/master/countries.json）。iso2 優先，再比中文名、英文名、別名。
 * @param {string|{country?:string,countryEn?:string,iso2?:string}} area
 * @returns {object|null}
 */
export function mapCountry(area, countries) {
  const cs = Array.isArray(countries) ? countries : [];
  const a = typeof area === 'string' ? { country: area } : (area ?? {});
  const iso = str(a.iso2)?.toUpperCase();
  if (iso) {
    const hit = cs.find((c) => String(c.iso2 ?? '').toUpperCase() === iso);
    if (hit) return hit;
  }
  for (const v of [a.country, a.countryEn]) {
    const n = normName(v);
    if (!n) continue;
    const hit = cs.find((c) => [c.name, c.nameEn, ...(c.aliases ?? [])].filter(Boolean).map(normName).includes(n));
    if (hit) return hit;
  }
  return null;
}
export const isGlobalArea = (a) => GLOBAL_AREAS.includes(normName(typeof a === 'string' ? a : (a?.country ?? a?.countryEn)));

/* ───────── 單則檢查 ───────── */
const isHttp = (u) => typeof u === 'string' && /^https?:\/\/[^\s]+$/i.test(u);

/**
 * 檢查一則（v1 item）。errors 有任何一筆＝這則退回；warnings／unmapped 不擋上架。
 * @param {object} item
 * @param {{ today?: string, diseases?: object[], countries?: object[] }} [ctx] today：YYYY-MM-DD（發布時間在明天以後就退回）
 * @returns {{ errors: {field:string,label:string,message:string}[], warnings: {field:string,label:string,message:string}[], diseaseId: string|null, iso2s: string[], unmapped: {kind:'disease'|'country',field:string,value:string}[] }}
 */
export function checkItem(item, ctx = {}) {
  const errors = [];
  const warnings = [];
  const unmapped = [];
  const err = (field, message) => errors.push({ field, label: labelOf(field), message });
  const warn = (field, message) => warnings.push({ field, label: labelOf(field), message });
  const out = { errors, warnings, diseaseId: null, iso2s: [], unmapped };
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    err('item', '這一則不是一筆資料（應為 { … } 物件）');
    return out;
  }

  const id = str(item.id);
  if (!id) err('id', '缺少識別碼（id）：請帶資料庫裡這一則的主鍵，更新同一則時 id 不能變');
  else if (!ID_RE.test(id)) err('id', `識別碼「${id.slice(0, 40)}」只能用英數字、底線、連字號與點，最長 ${LIMITS.id} 字`);
  const status = item.status ?? 'published';
  if (!STATUSES.includes(status)) err('status', `狀態只能是 published（上架）、updated（更新）或 withdrawn（撤下），收到「${status}」`);
  const withdrawn = status === 'withdrawn';

  const today = str(ctx.today);
  for (const f of ['publishedAt', 'updatedAt', 'expiresAt']) {
    const v = item[f];
    if (isBlank(v)) {
      if (f === 'publishedAt' && !withdrawn) err(f, '缺少發布時間（例：2026-10-02 或 2026-10-02T07:48:32+08:00）');
      continue;
    }
    if (typeof v !== 'string' || !DATETIME_RE.test(v.trim()) || !validDate(v)) {
      err(f, `${FIELD_LABEL[f]}「${String(v).slice(0, 30)}」看不懂，請用 2026-10-02 或 2026-10-02T07:48:32+08:00 的寫法`);
      continue;
    }
    if (f === 'publishedAt' && today && dateOf(v) > today && !withdrawn)
      err(f, `發布時間 ${dateOf(v)} 在明天以後（今天是 ${today}）：請確認日期沒有打錯；預約上架請到當天再送`);
  }
  if (
    !isBlank(item.expiresAt) &&
    !isBlank(item.publishedAt) &&
    dateOf(item.expiresAt) &&
    dateOf(item.publishedAt) &&
    dateOf(item.expiresAt) < dateOf(item.publishedAt)
  )
    err('expiresAt', `下架時間 ${dateOf(item.expiresAt)} 早於發布時間 ${dateOf(item.publishedAt)}`);
  if (!withdrawn && today && dateOf(item.expiresAt) && dateOf(item.expiresAt) < today)
    warn('expiresAt', `已過下架時間 ${dateOf(item.expiresAt)}，不會列在現行清單`);

  const textField = (f, max, required) => {
    const v = item[f];
    if (isBlank(v)) {
      if (required && !withdrawn) err(f, `缺少${FIELD_LABEL[f]}`);
      return;
    }
    if (typeof v !== 'string') {
      err(f, `${FIELD_LABEL[f]}應該是文字`);
      return;
    }
    if (max && v.length > max) err(f, `${FIELD_LABEL[f]}太長：${v.length} 字，上限 ${max} 字`);
  };
  textField('headline', LIMITS.headline, true);
  textField('body', LIMITS.body, true);
  textField('instruction', LIMITS.instruction, false);
  textField('disease', 200, true);
  textField('diseaseEn', 200, false);

  // 疾病主檔
  if (!withdrawn && !isBlank(item.disease)) {
    const ds = ctx.diseases ?? [];
    let m = null;
    if (!isBlank(item.diseaseId)) {
      m = ds.find((d) => d.id === item.diseaseId) ?? null;
      if (!m && ds.length) warn('diseaseId', `疾病主檔沒有 id「${item.diseaseId}」，改用疾病名稱對應`);
    }
    m ??= mapDisease(item.disease, ds) ?? (item.diseaseEn ? mapDisease(item.diseaseEn, ds) : null);
    if (m) out.diseaseId = m.id;
    else if (ds.length) {
      unmapped.push({ kind: 'disease', field: 'disease', value: String(item.disease) });
      warn('disease', `疾病「${item.disease}」對不上疾病主檔：仍會上架，但不會連到疾病頁；請在疾病主檔補別名，下次匯入會自動對上`);
    }
  }

  // 國家／地區
  const areas = item.areas;
  if (areas == null || (Array.isArray(areas) && !areas.length)) {
    if (!withdrawn) err('areas', '缺少國家／地區：至少要有一個（例：{ "country": "孟加拉", "iso2": "BD" }）');
  } else if (!Array.isArray(areas)) err('areas', '國家／地區應該是清單（陣列）');
  else {
    const iso2s = [];
    areas.forEach((a, k) => {
      const f = `areas[${k}]`;
      if (!a || typeof a !== 'object') {
        err(f, '格式不對，應為 { country, iso2 }');
        return;
      }
      if (isBlank(a.country) && isBlank(a.iso2)) {
        err(f, '要有國家名稱（country）或 ISO 國碼（iso2）至少一個');
        return;
      }
      const iso = str(a.iso2);
      if (iso && !ISO2_RE.test(iso)) {
        err(`${f}.iso2`, `ISO 國碼「${iso}」應為兩個大寫英文字母（ISO 3166-1 alpha-2，例：BD）`);
        return;
      }
      if (withdrawn) return;
      const cs = ctx.countries ?? [];
      const m = mapCountry(a, cs);
      if (m?.iso2) iso2s.push(String(m.iso2).toUpperCase());
      else if (iso) iso2s.push(iso);
      if (!m && cs.length && !isGlobalArea(a)) {
        const label = [a.country, iso].filter(Boolean).join(' ');
        unmapped.push({ kind: 'country', field: f, value: label });
        warn(
          f,
          iso
            ? `ISO 國碼 ${iso}（${a.country ?? '未附名稱'}）不在國家主檔：仍會上架，但不會連到目的地頁；請在國家主檔補上`
            : `國家「${a.country}」沒有 ISO 國碼、也對不上國家主檔：仍會上架，但不會連到目的地頁；請補 iso2 或在國家主檔補別名`,
        );
      }
    });
    out.iso2s = [...new Set(iso2s)];
  }

  if (item.severity != null && ![1, 2, 3].includes(item.severity))
    err('severity', `等級只能是 1、2、3（與旅遊疫情建議等級同義）或留空，收到「${item.severity}」`);
  if (!isBlank(item.sourceUrl) && !isHttp(item.sourceUrl)) err('sourceUrl', '原始網址要以 http:// 或 https:// 開頭');
  if (item.references != null) {
    if (!Array.isArray(item.references)) err('references', '參考資料應該是清單（[{ title, url }]）');
    else
      item.references.forEach((r, k) => {
        if (!r || !isHttp(r.url)) err(`references[${k}]`, `第 ${k + 1} 筆參考資料缺網址或網址不是 http(s)`);
      });
  }
  return out;
}
function validDate(v) {
  const d = dateOf(v);
  if (!d) return false;
  const t = Date.parse(`${d}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === d;
}

/** 一則的內容指紋（比對「與上次完全相同」用；不含 status（published／updated 只是標記）與匯入時間等 provenance） */
export function itemFingerprint(item) {
  const keys = [
    'id',
    'publishedAt',
    'updatedAt',
    'expiresAt',
    'disease',
    'diseaseEn',
    'diseaseId',
    'headline',
    'body',
    'instruction',
    'areas',
    'severity',
    'sourceUrl',
    'references',
    'lang',
  ];
  const canon = (v) =>
    Array.isArray(v)
      ? v.map(canon)
      : v && typeof v === 'object'
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [k, canon(v[k])]),
          )
        : v;
  const o = {};
  for (const k of keys) if (item?.[k] != null && !(k === 'lang' && item[k] === 'zh-TW')) o[k] = canon(item[k]);
  return stableHash(JSON.stringify(o));
}
