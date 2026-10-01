// 答案引擎的瀏覽器端資料載入：讀 v1/*.json（記憶體快取），組成 core.createEngine 的 deps。
// 答案頁、謠言查證、統計問答共用。
import { createEngine } from './core.js';

const root = document.documentElement;
export const BASE = (window.CDC && window.CDC.base) || root.dataset.base || '';
export const LANG = root.lang || 'zh-TW';
const LANG_PATH = (window.CDC && window.CDC.langPath) || root.dataset.langPath || '';

/** 站內路徑 → 加 basePath 與語言前綴；外部、tel:、mailto: 原樣 */
export function url(p, { noLang = false } = {}) {
  if (!p) return '#';
  if (/^(https?:|tel:|mailto:|#)/.test(p)) return p;
  if (window.CDC?.url) return window.CDC.url(p, { noLang });
  return `${BASE}${noLang ? '' : LANG_PATH}${p.startsWith('/') ? p : `/${p}`}`;
}

const cache = new Map();
/** 讀 v1 JSON，回傳 data（失敗回 fallback，不丟例外） */
export function v1(name, fallback = null) {
  if (!cache.has(name)) {
    cache.set(name, fetch(`${BASE}/v1/${name}.json`, { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${name} ${r.status}`))))
      .then((j) => (j && typeof j === 'object' && 'data' in j ? j.data : j))
      .catch((e) => { console.warn('[answer] 無法載入', name, e.message); return fallback; }));
  }
  return cache.get(name);
}

/**
 * 暫停狀態：發布的 v1/governance/ai-status.json ＋ 後台（/admin/ai-status/）示範用本機覆寫。
 * 覆寫 key 優先序：cdc.aiStatusOverride（E：{paused, reason, updatedAt, updatedBy}）→ cdc.aiStatus（相容）→ cdc.aiPause；可帶 until（ISO 或毫秒）自動失效。
 */
export function effectiveAiStatus(published) {
  const st = { ...(published ?? {}) };
  try {
    const raw = localStorage.getItem('cdc.aiStatusOverride') ?? localStorage.getItem('cdc.aiStatus') ?? localStorage.getItem('cdc.aiPause');
    if (raw) {
      const o = JSON.parse(raw);
      const until = o.until ? (typeof o.until === 'number' ? o.until : Date.parse(o.until)) : null;
      if (!until || until > Date.now()) { st.paused = !!o.paused; if (o.reason) st.reason = o.reason; st.localOverride = true; st.until = until; }
    }
  } catch { /* ignore */ }
  return st;
}

const enginePromise = new Map();
/** 建立引擎（view：public | pro）。 */
export function loadEngine(view = 'public') {
  if (enginePromise.has(view)) return enginePromise.get(view);
  const p = (async () => {
    const [index, indexPro, situation, clarifications, glossary, diseases, vaccines, countries, datasets, faq, units, aiStatus, travelAlerts, countryLevels] = await Promise.all([
      v1('search-index', []), view === 'pro' ? v1('search-index-pro', []) : Promise.resolve([]), v1('situation', null), v1('clarifications', []), v1('glossary', []),
      v1('diseases', []), v1('vaccines', []), v1('countries', []), v1('datasets', []), v1('faq', []), v1('units', []), v1('governance/ai-status', {}),
      v1('travel-alerts', []), v1('country-levels', []),
    ]);
    const deps = {
      index: index ?? [], indexPro: indexPro ?? [], situation,
      clarifications: (clarifications ?? []).map((c) => ({ ...c, url: c.path ?? `/factcheck/#${c.id}`, ownerName: c.governance?.ownerName ?? c.ownerName })),
      glossary: glossary ?? [],
      diseases: (diseases ?? []).map((d) => ({ ...d, hasPage: d.hasPage ?? !!d.page })),
      vaccines: (vaccines ?? []).map((v) => ({ id: v.id, slug: v.slug, name: v.title, title: v.title, nameEn: v.nameEn, aliases: v.aliases, diseases: v.diseases, whereUrl: v.whereUrl })),
      countries: countries ?? [],
      datasets: (datasets ?? []).filter((d) => d.series).map((d) => ({ ...d, ownerName: d.governance?.ownerName ?? d.ownerName })),
      faq: (faq ?? []).map((f) => ({ id: f.id, question: f.question, diseases: f.diseases, tasks: f.tasks, url: f.path, whitelist: f.governance?.whitelist !== false && !(f.governance?.stale?.length) })),
      units: units ?? [],
      aiStatus: effectiveAiStatus(aiStatus),
      travel: [...(Array.isArray(countryLevels) ? countryLevels : []), ...(Array.isArray(travelAlerts) ? travelAlerts : [])],
    };
    return { engine: createEngine(deps), deps };
  })();
  enginePromise.set(view, p);
  return p;
}

export function currentView() {
  const q = new URLSearchParams(location.search).get('view');
  if (q === 'pro' || q === 'public') return q;
  return root.dataset.view === 'pro' ? 'pro' : 'public';
}

/** 數字的來源卡、AI 標籤等共用的小工具 */
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let chartsMod = null;
/** 長條圖：優先用 C 的 /assets/js/charts.js，載入失敗用內建極簡 SVG */
export async function barChart(values, opts = {}) {
  if (chartsMod === null) chartsMod = await import(`${BASE}/assets/js/charts.js`).catch(() => false);
  if (chartsMod && chartsMod.barChartSvg) { try { return chartsMod.barChartSvg(values, opts); } catch { /* fall through */ } }
  const vals = values.map(Number); const max = Math.max(1, ...vals); const w = 320, h = 120, bw = w / vals.length;
  const bars = vals.map((v, i) => `<rect x="${i * bw + 4}" y="${h - 20 - (v / max) * (h - 36)}" width="${bw - 8}" height="${(v / max) * (h - 36)}" rx="2" fill="currentColor" opacity="${i === vals.length - 1 ? 1 : 0.5}"><title>${esc(opts.labels?.[i] ?? i + 1)}：${v}${esc(opts.unit ?? '')}</title></rect><text x="${i * bw + bw / 2}" y="${h - 4}" font-size="10" text-anchor="middle" fill="currentColor">${esc(opts.labels?.[i] ?? '')}</text>`).join('');
  return `<svg class="c-chart c-chart--bar c-chart--mini" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(opts.title ?? '')}：${esc(vals.map((v, i) => `${opts.labels?.[i] ?? i + 1} ${v}`).join('；'))}">${bars}</svg>`;
}

/**
 * 評估集 requires 判斷（瀏覽器版；與 eval/run-eval.mjs 的 contentExists 同規則）：
 * 'situation:<disease id>'、'travel:<ISO2>'、'dataset-series:<dataset id>'、內容 id 或前綴（含 document family）。
 * 用法（後台評估頁）：scoreEvalSet(engine, set, { exists: await evalExists() })
 */
export async function evalExists() {
  const [catalog, documents, situation, datasets, travelAlerts, countryLevels] = await Promise.all([
    v1('catalog', []), v1('documents', []), v1('situation', null), v1('datasets', []), v1('travel-alerts', []), v1('country-levels', []),
  ]);
  const ids = (catalog ?? []).map((c) => c.id);
  const families = new Set((documents ?? []).map((d) => d.family).filter(Boolean));
  const travel = [...(countryLevels ?? []), ...(travelAlerts ?? [])];
  return (ref) => {
    if (ref.startsWith('situation:')) return (situation?.items ?? []).some((i) => i.disease === ref.slice(10));
    if (ref.startsWith('travel:')) { const iso = ref.slice(7).toUpperCase(); return travel.some((t) => String(t.iso2 ?? t.ISO2 ?? t.countryCode ?? t.iso ?? t.code ?? '').toUpperCase() === iso); }
    if (ref.startsWith('dataset-series:')) return (datasets ?? []).some((d) => d.id === ref.slice(15) && d.series);
    return families.has(ref) || ids.some((id) => id === ref || id.startsWith(ref));
  };
}
