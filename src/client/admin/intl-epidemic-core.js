// /admin/intl-epidemic/ 國際疫情匯入：純函式（不碰 DOM），瀏覽器、建置模板與測試共用。
// 單則檢查直接用 ../intl-epidemic-rules.js（與排程拉取、推送端點、CLI 同一份規則），所以預覽說「可上架」，匯入器就會接受；
// 整批把關（退回超過 20%、full 模式少掉一半、個資掃描）只在伺服器端，預覽表會提醒但不重算。
import * as R from '../intl-epidemic-rules.js';

export const SOURCE_LABEL = { push: '推送（疫情中心系統送來）', manual: '後台手動匯入', feed: '排程拉取', 'official-export': '排程拉取（現行官網匯出）' };
export const MODE_LABEL = { delta: '只更新這幾則（delta）', full: '這就是現行全部（full）' };
export const MODE_HELP = {
  delta: '只新增或更新清單裡的這幾則，其他現行資訊不動。值班補登、更正一則時用這個。',
  full: '這批就是目前所有該上架的資訊：現行清單有、這批沒有的，會被撤下。只在貼上資料庫完整匯出時用。',
};
export const UNMAPPED_KIND = { disease: '疾病', country: '國家／地區' };
export const SHAPE_LABEL = { v1: '交換格式 v1（JSON）', legacy: '現行官網匯出格式', csv: 'CSV' };

const s = (v) => String(v ?? '').trim();

/**
 * 貼上或上傳的文字 → 一批 v1 items。自動判斷 v1／CSV／現行官網匯出格式。
 * @param {string} text
 * @returns {{ shape: string, items: object[], mode: string|null, producer: string|null, error: string|null }}
 */
export function parseInput(text) {
  const t = String(text ?? '').replace(/^﻿/, '');
  const shape = R.detectShape(t);
  const out = { shape, items: [], mode: null, producer: null, error: null };
  try {
    if (shape === 'csv') out.items = R.fromCsvRows(R.parseCsv(t));
    else if (shape === 'legacy') {
      const d = JSON.parse(t);
      out.items = R.fromLegacyRows(Array.isArray(d) ? d : (d.data ?? d.Data ?? d.result ?? []));
    } else if (shape === 'v1') {
      const d = JSON.parse(t);
      out.items = Array.isArray(d) ? d : Array.isArray(d.items) ? d.items : [];
      if (!Array.isArray(d)) {
        out.mode = R.MODES.includes(d.mode) ? d.mode : null;
        out.producer = typeof d.producer === 'string' ? d.producer : null;
      }
    } else out.error = s(t) ? '看不懂這份資料：請貼交換格式 v1 的 JSON、CSV（第一列是欄名），或現行官網 ExportJSON 的內容' : '沒有內容';
  } catch (e) {
    out.error = `看不懂這份資料：${e.message}`;
  }
  return out;
}

/** <input type="datetime-local"> 的值（台北時間）→ ISO 8601（+08:00）；只有日期就原樣 */
export function taipeiIso(local) {
  const v = s(local);
  if (!v) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(:\d{2})?$/.exec(v);
  return m ? `${m[1]}T${m[2]}${m[3] ?? ':00'}+08:00` : v;
}

/** 沒填識別碼時自動產生：manual-YYYYMMDD-<標題＋發布時間的雜湊>（同一則重送會得到同一個 id，不會變成兩則） */
export function autoId(headline, publishedAt) {
  const d = (R.dateOf(publishedAt) ?? '').replace(/-/g, '') || 'undated';
  return `manual-${d}-${R.stableHash(`${s(headline)}|${s(publishedAt)}`).slice(0, 8)}`;
}

/** 「其他國家」欄：分號、逗號、頓號或換行分隔；兩個英文字母當 ISO 國碼，其他當國名 */
export function otherAreas(text) {
  return String(text ?? '')
    .split(/[;；,，、\n]+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => (/^[A-Za-z]{2}$/.test(x) ? { iso2: x.toUpperCase() } : { country: x }));
}

/**
 * 單則表單 → v1 item。
 * @param {{ id?: string, publishedAt?: string, expiresAt?: string, disease?: string, headline?: string, body?: string, instruction?: string,
 *           iso2s?: string[], otherCountries?: string, sourceUrl?: string, status?: string }} f
 * @param {{ countries?: object[] }} [ctx]
 */
export function itemFromForm(f, { countries = [] } = {}) {
  const publishedAt = taipeiIso(f.publishedAt);
  const headline = s(f.headline);
  const areas = [];
  const seen = new Set();
  for (const iso of f.iso2s ?? []) {
    const code = s(iso).toUpperCase();
    if (!code || seen.has(code)) continue;
    seen.add(code);
    const c = countries.find((x) => String(x.iso2 ?? '').toUpperCase() === code);
    areas.push({ ...(c?.name ? { country: c.name } : {}), ...(c?.nameEn ? { countryEn: c.nameEn } : {}), iso2: code });
  }
  for (const a of otherAreas(f.otherCountries)) {
    if (a.iso2 && seen.has(a.iso2)) continue;
    if (a.iso2) seen.add(a.iso2);
    areas.push(a);
  }
  const item = {
    id: s(f.id) || autoId(headline, publishedAt),
    status: f.status && R.STATUSES.includes(f.status) ? f.status : 'published',
    publishedAt,
    disease: s(f.disease),
    headline,
    body: String(f.body ?? '').trim(),
    areas,
  };
  if (s(f.expiresAt)) item.expiresAt = taipeiIso(f.expiresAt);
  if (s(f.instruction)) item.instruction = s(f.instruction);
  if (s(f.sourceUrl)) item.sourceUrl = s(f.sourceUrl);
  return item;
}

/**
 * 預覽表的每一列：單則檢查結果、對應到的疾病與國家。
 * @param {object[]} items
 * @param {{ today?: string, diseases?: object[], countries?: object[] }} ctx
 */
export function previewRows(items, ctx = {}) {
  const ids = new Map();
  for (const it of items) if (it && typeof it.id === 'string') ids.set(it.id, (ids.get(it.id) ?? 0) + 1);
  return items.map((it, index) => {
    const c = R.checkItem(it, ctx);
    const disease = (ctx.diseases ?? []).find((d) => d.id === c.diseaseId) ?? null;
    const areas = Array.isArray(it?.areas) ? it.areas : [];
    const countries = areas.map((a) => {
      const m = R.mapCountry(a, ctx.countries ?? []);
      const label = [a?.country ?? m?.name, a?.iso2 ?? m?.iso2].filter(Boolean).join(' ');
      return { label: label || '（空白）', mapped: !!m, global: !m && R.isGlobalArea(a) };
    });
    const warnings = c.warnings.map((w) => w.message);
    if (it?.id && ids.get(it.id) > 1) warnings.push(`識別碼 ${it.id} 在清單出現不只一次，送出時以最後一筆為準`);
    return {
      index,
      id: it?.id ?? null,
      status: it?.status ?? 'published',
      publishedAt: it?.publishedAt ?? null,
      headline: it?.headline ?? '',
      disease: it?.disease ?? '',
      diseaseName: disease?.name ?? null,
      countries,
      errors: c.errors.map((e) => e.message),
      warnings,
      bad: c.errors.length > 0,
    };
  });
}

/** 預覽摘要（給送出前的提示） */
export function previewSummary(rows) {
  const total = rows.length;
  const bad = rows.filter((r) => r.bad).length;
  const warned = rows.filter((r) => !r.bad && r.warnings.length).length;
  const ok = total - bad;
  const share = total ? bad / total : 0;
  const parts = [`共 ${total} 則`, `可上架 ${ok}`, `有錯會被退回 ${bad}`];
  if (warned) parts.push(`有提醒 ${warned}`);
  return {
    total,
    ok,
    bad,
    warned,
    // 與伺服器端同一個門檻（scripts/lib/intl-epidemic.mjs REJECT_HOLD_SHARE）：退回超過 20% 整批會被保留不動
    willHold: total > 0 && share > 0.2,
    text: parts.join('、'),
  };
}

/** 預覽清單 → 交換格式 v1（送出或下載用） */
export function buildFeed(items, { mode = 'delta', producer = '後台手動匯入', now = new Date().toISOString() } = {}) {
  return { version: R.FEED_VERSION, producer, generatedAt: now, mode, items };
}

/** 下載檔名 */
export const exportFilename = (today) => `intl-epidemic-${String(today ?? '').replace(/-/g, '') || 'feed'}.json`;

/** 伺服器回應（或試算）→ 一行白話 */
export function changesText(res) {
  const c = res?.changes ?? {};
  const parts = [`新增 ${c.new ?? 0}`, `更新 ${c.updated ?? 0}`, `撤下 ${c.withdrawn ?? 0}`, `不變 ${c.unchanged ?? 0}`];
  if (res?.rejected?.length) parts.push(`退回 ${res.rejected.length}`);
  if (res?.unmapped?.length) parts.push(`對不上主檔 ${res.unmapped.length} 項`);
  return parts.join('、');
}

/**
 * 匯入紀錄的 lastRun → 狀態框要顯示的東西（模板與瀏覽器共用）。
 * @returns {null|{ at: string, source: string, sourceLabel: string, producer: string|null, by: string|null, mode: string|null, stats: {label:string, value:number, tone:string}[], held: string[]|null, wroteSnapshot: boolean }}
 */
export function lastRunView(run) {
  if (!run) return null;
  const c = run.counts ?? {};
  const unmapped = Array.isArray(run.unmapped) ? run.unmapped.length : (run.unmapped ?? 0);
  return {
    at: run.at ?? '',
    source: run.source ?? '',
    sourceLabel: SOURCE_LABEL[run.source] ?? run.source ?? '—',
    producer: run.producer ?? null,
    by: run.by ?? null,
    mode: run.mode ? (MODE_LABEL[run.mode] ?? run.mode) : null,
    stats: [
      { label: '收到', value: run.received ?? 0, tone: 'info' },
      { label: '接受', value: run.accepted ?? 0, tone: 'ok' },
      { label: '退回', value: c.rejected ?? 0, tone: c.rejected ? 'bad' : 'ok' },
      { label: '對不上主檔', value: unmapped, tone: unmapped ? 'warn' : 'ok' },
      { label: '新增', value: c.new ?? 0, tone: 'info' },
      { label: '更新', value: c.updated ?? 0, tone: 'info' },
      { label: '撤下', value: c.withdrawn ?? 0, tone: c.withdrawn ? 'warn' : 'info' },
    ],
    held: run.held ? (Array.isArray(run.held) ? run.held : (run.held.reasons ?? [])) : null,
    wroteSnapshot: !!run.wroteSnapshot,
  };
}

/** 台北時間 YYYY-MM-DD HH:mm（建置與瀏覽器結果一致，不依賴執行環境時區） */
export function fmtTaipei(iso) {
  const t = Date.parse(String(iso ?? ''));
  if (!Number.isFinite(t)) return String(iso ?? '—');
  return new Date(t + 8 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
}
