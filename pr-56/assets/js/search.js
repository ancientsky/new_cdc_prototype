// /search/ 全文搜尋前端（第二十八輪）：Pagefind JS API 的薄殼。
// 為什麼不用 Pagefind 內建 UI（pagefind-ui.js）：內建 UI 約 +100 KB 的每頁預算、篩選介面不適合「年份／權責單位」這種值很多的條件、
// 計數朗讀與 320px 排版都要另外驗；自刻只有約 8 KB，全部用原生 form 控制項（checkbox／select），鍵盤與讀屏行為由瀏覽器負責。
// 載入策略：本檔很小（隨 /search/ 頁載入）；pagefind.js（含 WebAssembly）與索引分片在第一次搜尋時才由 import() 動態抓取，
// 所以不計入 js-budget（budget 只沿靜態 import 追，見 scripts/lib/js-budget.mjs 檔頭）。
// 網址參數：q、type（逗號分隔）、audience（逗號分隔）、unit、year、sort（new|old|空＝相關度）；/ask/ 的「用全文搜尋找…」連到 ?q=。
import { rankedSearch, despaceExcerpt, hasLongCjk } from './search-query.js';

const root = typeof document !== 'undefined' ? document.querySelector('[data-search]') : null;
if (root) init();

function init() {
  const T = (k, v) => (window.CDC?.t ? window.CDC.t(k, v) : k);
  const html = document.documentElement;
  const BASE = html.dataset.base || '';
  const LANG_PATH = html.dataset.langPath || '';
  const PAGE = 10;
  // 內容類型的顯示順序（不在表內的值排最後）；顯示字用 search.type.<code>
  const TYPE_ORDER = ['disease', 'vaccine', 'faq', 'news', 'letter', 'clarification', 'document', 'service', 'publication', 'article', 'labtest', 'research', 'media', 'topic', 'travel', 'glossary', 'page', 'job', 'tender'];
  const AUD_ORDER = ['public', 'professional'];
  const UNITS = (() => { try { return JSON.parse(root.dataset.units || '{}'); } catch { return {}; } })();

  const form = root.querySelector('#search-form');
  const input = root.querySelector('#search-q');
  const adv = root.querySelector('#search-adv');
  const statusEl = root.querySelector('#search-status');
  const list = root.querySelector('#search-results');
  const moreBtn = root.querySelector('#search-more');
  const emptyEl = root.querySelector('#search-empty');
  const sortSel = root.querySelector('#search-sort');
  const unitSel = root.querySelector('#search-unit');
  const yearSel = root.querySelector('#search-year');
  const fsType = root.querySelector('[data-filter="type"]');
  const fsAud = root.querySelector('[data-filter="audience"]');

  let pfLoad = null;
  let optionsLoad = null;
  let runId = 0;
  let results = [];
  let shown = 0;
  let baseStatus = '';

  /* ───────── 狀態 ↔ 網址 ───────── */
  const csv = (s) => (s ? s.split(',').filter(Boolean) : []);
  function readUrl() {
    const p = new URLSearchParams(location.search);
    return { q: (p.get('q') ?? '').trim(), type: csv(p.get('type')), audience: csv(p.get('audience')), unit: p.get('unit') ?? '', year: p.get('year') ?? '', sort: ['new', 'old'].includes(p.get('sort')) ? p.get('sort') : '' };
  }
  function readForm() {
    const checked = (name) => [...root.querySelectorAll(`input[type=checkbox][name="${name}"]:checked`)].map((c) => c.value);
    return { q: input.value.trim(), type: checked('type'), audience: checked('audience'), unit: unitSel.value, year: yearSel.value, sort: sortSel.value };
  }
  function writeUrl(st, push) {
    const p = new URLSearchParams();
    if (st.q) p.set('q', st.q);
    if (st.type.length) p.set('type', st.type.join(','));
    if (st.audience.length) p.set('audience', st.audience.join(','));
    if (st.unit) p.set('unit', st.unit);
    if (st.year) p.set('year', st.year);
    if (st.sort) p.set('sort', st.sort);
    const qs = p.toString();
    const href = `${location.pathname}${qs ? `?${qs}` : ''}`;
    try { history[push ? 'pushState' : 'replaceState'](null, '', href); } catch { /* 預覽／sandbox 環境不能改網址就算了 */ }
    const ask = root.querySelector('[data-search-ask]');
    if (ask) ask.href = `${BASE}${LANG_PATH}/ask/${st.q ? `?q=${encodeURIComponent(st.q)}` : ''}`;
    const zh = root.querySelector('[data-search-zh]');
    if (zh) zh.href = `${BASE}/search/${qs ? `?${qs}` : ''}`;
  }
  function applyToForm(st) {
    input.value = st.q;
    for (const c of root.querySelectorAll('input[type=checkbox][name="type"]')) c.checked = st.type.includes(c.value);
    for (const c of root.querySelectorAll('input[type=checkbox][name="audience"]')) c.checked = st.audience.includes(c.value);
    unitSel.value = st.unit;
    yearSel.value = st.year;
    sortSel.value = st.sort;
  }
  const hasFilter = (st) => !!(st.type.length || st.audience.length || st.unit || st.year);

  /* ───────── Pagefind 載入（第一次搜尋才抓） ───────── */
  function load() {
    pfLoad ??= (async () => {
      const mod = await import(`${BASE}/pagefind/pagefind.js`);
      // 結果網址以 basePath 為根（GitHub Pages 專案頁、PR 預覽都有子路徑）；語言由 <html lang> 自動決定索引
      // ranking.pageLength 0.25（預設 0.75）：疾病頁是長頁，預設值會讓它輸給同主題的短 FAQ；調低後「登革熱」的疾病頁排進前三
      await mod.options({ baseUrl: `${BASE}/`, ranking: { pageLength: 0.25 } });
      return mod;
    })();
    pfLoad.catch(() => { pfLoad = null; }); // 失敗後允許下次重試
    return pfLoad;
  }
  /** 篩選選項只建一次（頁面一開就預載，讓使用者能「只用篩選瀏覽」；搜尋時若還沒好就等它） */
  function ensureOptions() {
    optionsLoad ??= load().then((p) => p.filters()).then((f) => { buildOptions(f); applyToForm(readUrl()); });
    optionsLoad.catch(() => { optionsLoad = null; });
    return optionsLoad;
  }

  /* ───────── 篩選選項（由該語言索引實際有的值產生） ───────── */
  const rank = (order, k) => { const i = order.indexOf(k); return i < 0 ? 99 : i; };
  const sortBy = (order) => (a, b) => rank(order, a) - rank(order, b) || a.localeCompare(b);
  function checkbox(name, value, label) {
    const l = document.createElement('label');
    l.className = 'c-search__opt';
    const c = document.createElement('input');
    c.type = 'checkbox'; c.name = name; c.value = value;
    const s = document.createElement('span');
    s.textContent = label;
    const n = document.createElement('span');
    n.className = 'c-search__n'; n.dataset.count = '';
    l.append(c, s, ' ', n);
    return l;
  }
  function buildOptions(filters) {
    const fill = (fs, name, values, order, labelOf) => {
      const keys = Object.keys(values ?? {}).sort(sortBy(order));
      if (!fs || !keys.length) return;
      fs.querySelector('[data-options]').replaceChildren(...keys.map((k) => checkbox(name, k, labelOf(k))));
      fs.hidden = false;
    };
    fill(fsType, 'type', filters.type, TYPE_ORDER, (k) => T(`search.type.${k}`));
    fill(fsAud, 'audience', filters.audience, AUD_ORDER, (k) => T(`search.aud.${k}`));
    const select = (sel, values, labelOf, cmp) => {
      const keys = Object.keys(values ?? {}).sort(cmp);
      if (!keys.length) return;
      const all = new Option(T('search.f.all'), '');
      sel.replaceChildren(all, ...keys.map((k) => new Option(labelOf(k), k)));
      sel.closest('[data-filter-select]').hidden = false;
    };
    select(unitSel, filters.unit, (k) => UNITS[k] ?? k, (a, b) => (UNITS[a] ?? a).localeCompare(UNITS[b] ?? b, html.lang));
    select(yearSel, filters.year, (k) => k, (a, b) => b.localeCompare(a));
  }
  /** 選項後面的 (n)：Pagefind 回的 filters 是「套用其他條件後各值還有幾筆」 */
  function showCounts(counts) {
    for (const [name, map] of Object.entries(counts ?? {})) {
      for (const c of root.querySelectorAll(`input[type=checkbox][name="${name}"]`)) {
        const n = c.parentElement.querySelector('[data-count]');
        if (n) n.textContent = `(${map[c.value] ?? 0})`;
      }
      const sel = name === 'unit' ? unitSel : name === 'year' ? yearSel : null;
      if (sel) for (const o of sel.options) if (o.value) o.textContent = `${name === 'unit' ? (UNITS[o.value] ?? o.value) : o.value} (${map[o.value] ?? 0})`;
    }
  }

  /* ───────── 結果列 ───────── */
  /** Pagefind 的 excerpt 只會有文字與 <mark>；仍然逐節點重建，不把索引裡的字串當 HTML 塞進頁面 */
  function excerptNodes(excerpt) {
    const doc = new DOMParser().parseFromString(`<body>${despaceExcerpt(excerpt)}</body>`, 'text/html');
    const out = [];
    for (const n of doc.body.childNodes) {
      if (n.nodeType === 1 && n.nodeName === 'MARK') { const m = document.createElement('mark'); m.textContent = n.textContent; out.push(m); } else out.push(document.createTextNode(n.textContent));
    }
    return out;
  }
  function item(d) {
    const li = document.createElement('li');
    li.className = 'c-search__item';
    const h = document.createElement('h3');
    h.className = 'c-search__title';
    const a = document.createElement('a');
    a.href = d.url;
    a.textContent = d.meta?.title || d.url;
    h.append(a);
    const meta = document.createElement('p');
    meta.className = 'c-search__meta';
    const kind = d.meta?.kind || (d.filters?.type?.[0] ? T(`search.type.${d.filters.type[0]}`) : '');
    if (kind) { const pill = document.createElement('span'); pill.className = 'c-pill c-pill--neutral'; pill.textContent = kind; meta.append(pill); }
    if (d.meta?.unit) meta.append(' ', Object.assign(document.createElement('span'), { textContent: `${T('search.meta.unit')}：${d.meta.unit}` }));
    if (d.meta?.date) { meta.append(' '); const tm = document.createElement('time'); tm.dateTime = d.meta.date; tm.textContent = d.meta.date; meta.append(tm); }
    const ex = document.createElement('p');
    ex.className = 'c-search__excerpt';
    ex.append(...excerptNodes(d.excerpt ?? ''));
    li.append(h, meta, ex);
    return li;
  }
  let busyRun = -1; // 正在載入下一批的是哪一輪搜尋（同一輪重複點「顯示更多」只處理一次；新的一輪不受舊的影響）
  async function renderMore(focusFirst) {
    // 競態：篩選連續變更時舊的一輪可能比新的一輪晚回來（要等每筆的 data()）；晚到的結果不能 append 到新的清單上（測試曾抓到 2018 年的頁混進「2026」篩選）
    const my = runId;
    if (busyRun === my) return;
    busyRun = my;
    const batch = results.slice(shown, shown + PAGE);
    let data;
    try { data = await Promise.all(batch.map((r) => r.data())); } finally { if (busyRun === my) busyRun = -1; }
    if (my !== runId) return;
    const els = data.map(item);
    list.append(...els);
    shown += batch.length;
    moreBtn.hidden = shown >= results.length;
    statusEl.textContent = results.length > PAGE ? `${baseStatus}　${T('search.status.shown', { a: shown, n: results.length })}` : baseStatus;
    if (focusFirst && els[0]) els[0].querySelector('a')?.focus();
  }

  /* ───────── 搜尋 ───────── */
  async function run(st) {
    const my = ++runId;
    list.replaceChildren();
    moreBtn.hidden = true;
    emptyEl.hidden = true;
    results = []; shown = 0;
    if (!st.q && !hasFilter(st)) { statusEl.textContent = T('search.status.idle'); return; }
    statusEl.textContent = T('search.status.loading');
    try {
      const p = await load();
      const filters = {};
      // 同一類別勾多個 ＝ 聯集（Pagefind 的陣列預設是「全部都要有」，所以明確寫 any）
      if (st.type.length) filters.type = { any: st.type };
      if (st.audience.length) filters.audience = { any: st.audience };
      if (st.unit) filters.unit = st.unit;
      if (st.year) filters.year = st.year;
      const opts = { filters };
      if (st.sort) opts.sort = { date: st.sort === 'new' ? 'desc' : 'asc' };
      await ensureOptions();
      let s = await rankedSearch(p, st.q, opts, false);
      let loose = false;
      if (!s.results.length && st.q && hasLongCjk(st.q)) {
        // 完整字串查無：退一步，把長字串拆成前後兩半（例「麻疹疫苗」→「麻疹」且「疫苗」）
        const s2 = await rankedSearch(p, st.q, opts, true);
        if (s2.results.length) { s = s2; loose = true; }
      }
      if (my !== runId) return;
      results = s.results;
      showCounts(s.filters);
      const n = results.length;
      if (!n) {
        statusEl.textContent = st.q ? T('search.status.none', { q: st.q }) : T('search.status.nofilter');
        emptyEl.hidden = false;
        return;
      }
      baseStatus = (st.q ? T('search.status.nq', { n, q: st.q }) : T('search.status.n', { n })) + (loose ? `　${T('search.status.loose')}` : '');
      await renderMore(false);
    } catch (e) {
      if (my !== runId) return;
      console.error('[search]', e);
      statusEl.textContent = T('search.status.err');
      emptyEl.hidden = false;
    }
  }

  /* ───────── 事件 ───────── */
  form.addEventListener('submit', (e) => { e.preventDefault(); const st = readForm(); writeUrl(st, true); run(st); });
  const onFilter = () => { const st = readForm(); writeUrl(st, false); run(st); };
  form.addEventListener('change', (e) => { if (e.target !== input) onFilter(); });
  root.querySelector('#search-clear').addEventListener('click', () => {
    const st = { ...readForm(), type: [], audience: [], unit: '', year: '', sort: '' };
    applyToForm(st); writeUrl(st, false); run(st);
    input.focus();
  });
  moreBtn.addEventListener('click', () => { renderMore(true).catch((e) => console.error('[search]', e)); });
  window.addEventListener('popstate', () => { const st = readUrl(); applyToForm(st); run(st); });

  // 第一次載入：網址參數 → 表單 → 搜尋。已帶篩選條件時展開進階篩選
  const first = readUrl();
  adv.open = hasFilter(first) || !!first.sort; // 預設收合：結果清單才在第一屏；帶篩選條件的網址才展開
  applyToForm(first);
  writeUrl(first, false);
  ensureOptions().catch(() => {}); // 沒有查詢也先建好篩選選項；失敗時 run() 會顯示錯誤
  run(first);
}
