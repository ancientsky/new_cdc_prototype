// 答案引擎的瀏覽器端資料載入：讀 v1/*.json（記憶體快取），組成 core.createEngine 的 deps。
// 答案頁、謠言查證、統計問答共用。
//
// 第四十輪（Issue #80，/ask/ 手機 Lighthouse 61）：
//   - 引擎程式（core.js 與它的結構化、詞典模組，壓縮後約 90 KB）不再被靜態 import：loadEngine() 第一次被呼叫時才 import()。
//     （rules.js 的 isLowRelevance 畫面元件也要用，所以規則表仍在初始載入。）
//     答案頁沒有 ?q= 時，畫面只需要問題框；使用者聚焦或開始輸入時 ui.js 才呼叫 prefetchEngine()，送出前通常已經載好。
//   - 答案索引依語言分片：只下載「當頁語言＋中文正本」（引擎查不到該語言的審閱譯文會退回中文，所以中文片一定要有）；
//     專業版只下載專業索引（民眾索引只在專業索引讀不到時才補抓，core.js 的 poolFor 本來就是「有專業索引就只用專業索引」）。
//   - 後台的評估重跑要用全部語言（評估集有英文、越南文題），傳 { allLangs: true } 讀完整的 search-index.json。
import { ENGINE_PRIMARY as PRIMARY, ENGINE_SECONDARY as SECONDARY, indexShardNames } from './deps-manifest.js';

let corePromise = null;
const loadCore = () => (corePromise ??= import('./core.js').catch((e) => { corePromise = null; throw e; }));

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
 * 可選檔案（第二輪新增：services、notify-table、media、notices）：先查 v1/index.json 是否有列出，
 * 沒列出就不發 request（避免 404 噪音），列出但讀取失敗同樣回 fallback。
 */
let indexListing = null;
export async function v1Optional(name, fallback = null) {
  indexListing ??= v1('index', null).then((list) => (Array.isArray(list) ? new Set(list.map((x) => x.path)) : null));
  const paths = await indexListing;
  if (paths && !paths.has(`/v1/${name}.json`)) return fallback;
  return v1(name, fallback);
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

/** 答案索引：當頁語言＋中文的分片（allLangs ⇒ 完整檔）。分片讀不到（舊建置、離線快取）時退回完整檔，答案不會因此變成查無 */
export function indexShards(base, { allLangs = false, lang = LANG } = {}) {
  if (allLangs) return v1(base, []);
  return Promise.all(indexShardNames(base, lang).map((n) => v1(n, null))).then((parts) => (parts.some((x) => !Array.isArray(x)) ? v1(base, []) : parts.flat()));
}

const enginePromise = new Map();

// 引擎的資料分兩批（第四十輪，清單在 deps-manifest.js）：「主要」是任何問題都會用到的，「次要」只有特定意圖才用到。
// 兩批在真正提問時一樣要等齊（createEngine 需要完整 deps）；差別在「預取」：使用者剛聚焦問題框時先抓主要的，
// 次要的交給 requestIdleCallback，在瀏覽器空閒時才抓，不和使用者的打字、頁面其他工作搶主執行緒與頻寬。
const getSecondary = ([n, fb, optional]) => (optional ? v1Optional(n, fb) : v1(n, fb));
const indexesFor = (view, allLangs) => {
  const proIndex = view === 'pro' ? indexShards('search-index-pro', { allLangs }) : Promise.resolve([]);
  const pubIndex = view === 'pro' ? proIndex.then((x) => (x?.length ? [] : indexShards('search-index', { allLangs }))) : indexShards('search-index', { allLangs });
  return [pubIndex, proIndex];
};

/**
 * 建立引擎（view：public | pro）。opts.allLangs：讀全部語言的索引（後台評估用）。
 * 引擎程式與資料同時開始下載（import() 與 fetch 並行），不會先等程式再抓資料。
 */
export function loadEngine(view = 'public', { allLangs = false } = {}) {
  const key = `${view}:${allLangs ? '*' : LANG}`;
  if (enginePromise.has(key)) return enginePromise.get(key);
  const p = (async () => {
    const core = loadCore();
    const [[index, indexPro], primary, secondary] = await Promise.all([
      Promise.all(indexesFor(view, allLangs)),
      Promise.all(PRIMARY.map(([n, fb]) => v1(n, fb))),
      // 第二輪（可選，404 容錯）：申請服務（actions）、通報時限表（病例定義與檢驗連結）、影音（來源卡海報）；疫苗接種時程主檔（跨疫苗年齡查詢）
      Promise.all(SECONDARY.map(getSecondary)),
    ]);
    const [situation, clarifications, glossary, diseases, vaccines, countries, datasets, faq, units, aiStatus] = primary;
    const [travelAlerts, countryLevels, services, notifyTable, media, schedule] = secondary;
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
      services: (services ?? []).map((x) => ({ id: x.id, slug: x.slug, title: x.title, serviceType: x.serviceType, steps: x.steps, slaDays: x.slaDays, fee: x.fee, applyUrl: x.applyUrl, forms: x.forms ?? [] })),
      notifyTable,
      schedule: Array.isArray(schedule) ? schedule : [],
      media: (media ?? []).map((x) => ({ id: x.id, mediaType: x.mediaType, poster: x.poster, producedAt: x.producedAt, basedOnVersionLabel: x.basedOnVersionLabel, durationSeconds: x.durationSeconds })),
    };
    const { createEngine } = await core;
    return { engine: createEngine(deps), deps };
  })();
  enginePromise.set(key, p);
  p.catch(() => enginePromise.delete(key)); // 例如引擎程式下載失敗：下次提問重試，而不是永遠卡在同一個失敗
  return p;
}

/** requestIdleCallback（不支援時用 setTimeout 退而求其次，例如舊版 Safari） */
export function whenIdle(fn, timeout = 3000) {
  if (typeof requestIdleCallback === 'function') requestIdleCallback(() => fn(), { timeout });
  else setTimeout(fn, 200);
}

let prefetched = false;
/**
 * 預取（不等結果、不丟錯）：使用者聚焦問題框、開始輸入或按下送出鈕時呼叫，多次呼叫只做一次。
 * 只下載（引擎程式＋主要資料立刻抓、次要資料等空閒），不建引擎、不回答——createEngine 是一段約 0.2 秒（手機 4 倍降速約 0.8 秒）的長工作，
 * 放在使用者打字的當下會讓輸入卡頓；等真正送出時才建，資料已在記憶體快取裡。
 */
export function prefetchEngine(view = 'public') {
  if (prefetched) return;
  prefetched = true;
  loadCore().catch(() => {});
  for (const p of indexesFor(view, false)) p.catch(() => {});
  for (const [n, fb] of PRIMARY) v1(n, fb);
  whenIdle(() => { for (const s of SECONDARY) getSecondary(s); });
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
  const [catalog, documents, situation, datasets, travelAlerts, countryLevels, notices] = await Promise.all([
    v1('catalog', []), v1('documents', []), v1('situation', null), v1('datasets', []), v1('travel-alerts', []), v1('country-levels', []), v1Optional('notices', []),
  ]);
  const ids = (catalog ?? []).map((c) => c.id);
  const families = new Set((documents ?? []).map((d) => d.family).filter(Boolean));
  const travel = [...(countryLevels ?? []), ...(travelAlerts ?? [])];
  return (ref) => {
    if (ref.startsWith('situation:')) return (situation?.items ?? []).some((i) => i.disease === ref.slice(10));
    if (ref.startsWith('travel:')) { const iso = ref.slice(7).toUpperCase(); return travel.some((t) => String(t.iso2 ?? t.ISO2 ?? t.countryCode ?? t.iso ?? t.code ?? '').toUpperCase() === iso); }
    if (ref.startsWith('dataset-series:')) return (datasets ?? []).some((d) => d.id === ref.slice(15) && d.series);
    if (ref.startsWith('newsType:')) { const [, t, open] = ref.split(':'); return (notices ?? []).some((n) => n.newsType === t && (n.governance?.whitelist ?? n.gov?.whitelist?.effective ?? true) !== false && (!open || !n.closed)); }
    return families.has(ref) || ids.some((id) => id === ref || id.startsWith(ref));
  };
}
