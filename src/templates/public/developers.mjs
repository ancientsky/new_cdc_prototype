// 開發者入口 /developers/：API 文件、機讀版說明、cdc: 詞彙表、授權與引用規範、嵌入範例。
// 端點清單與 ARCHITECTURE.md 4.2 一致；範例回應取真實建置資料（slim 後的前兩筆）。
import { html, raw, esc } from '../../../scripts/lib/render.mjs';
import { siteOrigin } from '../../../site.config.mjs';
import { proStyles } from '../pro/_styles.mjs';
import { vaxmapLink, legacyKey, itemPath } from './_partials.mjs';

const ENDPOINTS = [
  { path: '/v1/diseases.json', desc: '傳染病主檔（法定類別、ICD-10、通報時限、別名）與是否已有疾病頁', pick: (s) => s.master.diseases },
  { path: '/v1/diseases/{slug}.json', example: '/v1/diseases/dengue.json', desc: '單一疾病頁結構化欄位：八個區塊、一分鐘重點、專業欄位與 gov 摘要', pick: (s) => s.collections.diseases[0] },
  { path: '/v1/vaccines.json', desc: '疫苗頁：公費對象、時程', pick: (s) => s.collections.vaccines },
  { path: '/v1/faq.json', desc: 'Q&A；每題含 reviewedAt、owner、白名單狀態', pick: (s) => s.collections.faq },
  { path: '/v1/news.json', desc: '近 200 則新聞稿、致醫界通函、澄清；含自動加註 annotations', pick: (s) => s.collections.news },
  { path: '/v1/documents.json', desc: '全部文件版本；isCurrent、supersedes、supersededBy、effectiveAt', pick: (s) => s.collections.documents },
  { path: '/v1/clarifications.json', desc: '謠言查證用結構化澄清（claim、verdict、可轉傳短訊）', pick: (s) => s.collections.clarifications },
  { path: '/v1/situation.json', desc: '疫情態勢層；items[]、publisher、dataDate；狀態由疫情中心人工發布', pick: (s) => ({ ...s.situation, history: undefined, items: s.situation.items }) },
  { path: '/v1/travel-alerts.json', desc: '旅遊疫情建議（每日排程抓取，附 provenance）', pick: (s) => s.snapshots.travelAlerts.data },
  { path: '/v1/country-levels.json', desc: '各國旅遊疫情建議等級', pick: (s) => s.snapshots.countryLevels.data },
  { path: '/v1/country-changes.json', desc: '旅遊疫情建議變化事件（近 400 天；kind：new 新增、raised 調升、lowered 調降、lifted 解除、renewed 重發）', pick: (s) => s.snapshots.countryEvents?.data ?? [] },
  { path: '/v1/country-background.json', desc: '全球背景提醒（同一疾病同一等級涵蓋 ≥ 50% 國家，如新冠併發重症第一級）；各國排序請用 TargetedLevelCode', pick: (s) => s.snapshots.countryLevels.meta?.background ?? [] },
  { path: '/v1/datasets.json', desc: '資料目錄（CKAN 快照＋治理欄位：正本位置、授權、更新頻率）', pick: (s) => s.collections.datasets },
  { path: '/v1/catalog.json', desc: '五類資產總目錄（id、type、owner、canonicalUrl、license、sensitivity、whitelist、reviewedAt）', pick: (s) => s.all.filter((i) => i.status === 'published').map((i) => ({ id: i.id, type: i.type, title: i.title, owner: i.owner, license: i.license, sensitivity: i.sensitivity, reviewedAt: i.reviewedAt, whitelist: i.gov?.whitelist?.effective })) },
  { path: '/v1/glossary.json', desc: '七語詞彙主檔；locked 的詞機器翻譯時不得自由翻譯', pick: (s) => s.master.glossary },
  { path: '/v1/search-index.json', desc: '答案單元（chunk）；只含白名單內容，AI 檢索用', pick: (s) => s.searchIndex?.public },
  { path: '/v1/governance/kpi.json', desc: '治理 KPI（規劃文件 7.5 每一列：目前值、一年與三年目標）', pick: (s) => s.gov.kpi },
  { path: '/v1/governance/todos.json', desc: '系統產生的待辦：正本修訂連動、逾期、翻譯過期、反向稽核、資料集時效', pick: (s) => s.gov.todos },
  { path: '/v1/governance/ai-status.json', desc: 'AI 問答開關（運作／暫停、原因、生效時間）', pick: (s) => s.governance.aiStatus },
  { path: '/v1/governance/eval-report.json', desc: '評估報告：六指標、各類別通過率、版本題結果（透明報告頁的資料來源）', pick: (s) => s.evalReport && { version: s.evalReport.version, total: s.evalReport.total, passed: s.evalReport.passed, byCategory: s.evalReport.byCategory, metrics: s.evalReport.metrics } },
  { path: '/v1/redirects.json', desc: '舊版文件與舊網址 → 正本的 301 對照表', pick: (s) => s.collections.documents.filter((d) => d.supersededBy).map((d) => ({ from: `/documents/${d.id.replace(/^doc\./, '')}/`, to: `/documents/${d.supersededBy.replace(/^doc\./, '')}/`, status: 301, legacy: d.legacyUrls ?? [] })) },
  { path: '/v1/legacy-map.json', plain: true, desc: '舊網址 → 新頁路徑的精簡對照（key 已正規化：小寫、無網域、無尾斜線、無 hash、去 page 參數）；給 404 頁與 /legacy/ 查詢頁用，也可直接匯入你的伺服器', pick: legacyMapOf },
  { path: '/openapi.json', desc: 'OpenAPI 3.1 描述檔（建置時由 scripts/lib/openapi.mjs 產生）', raw: true },
];

/** 舊網址對照（移轉清單中 status 為 migrated／merged、有 target 且網址無佔位者）：與建置輸出的 v1/legacy-map.json 同規則，供範例顯示用。 */
function legacyMapOf(site) {
  const out = {};
  for (const list of site.migration?.lists ?? []) for (const it of list.items ?? []) {
    if (!it?.oldUrl || /[{}]/.test(it.oldUrl) || !['migrated', 'merged'].includes(it.status)) continue;
    const tg = site.byId.get(it.target);
    const key = legacyKey(it.oldUrl);
    if (tg && key && !(key in out)) out[key] = itemPath(tg) + (it.anchor ? `#${it.anchor}` : '');
  }
  return Object.keys(out).length ? out : null;
}

const VOCAB = [
  ['cdc:id', 'string', '內容的穩定識別碼，全站唯一，例如 disease.dengue、doc.mmr-recommendation.2025-04-16。引用時以它為準，不要用會變動的網址或加密 ID。'],
  ['cdc:owner', 'string', '權責單位名稱（對應 content/master/units.json）。這個單位對內容正確性負責，錯誤回報會轉給它。'],
  ['cdc:reviewedAt', 'date (YYYY-MM-DD)', '最後審閱日。由權責單位確認內容仍然正確的日期，不是編輯日。引用時應一併附上。'],
  ['cdc:nextReviewAt', 'date | null', '下次審閱日，系統以 reviewedAt ＋ 審閱週期計算。事件觸發型內容（新聞稿、通函）為 null。'],
  ['cdc:version', 'string | null', '文件版次（例如 114.04.16 或 v17）。非文件類內容為 null。'],
  ['cdc:isCurrent', 'boolean', '是否為現行版。文件家族內生效日最新且已發布者為 true；false 代表已被取代，AI 不得引用。'],
  ['cdc:supersededBy', 'string | null', '取代本版的新版 id；現行版為 null。由系統依 effectiveAt 計算，不手填。'],
  ['cdc:aiWhitelist', 'boolean', '是否在 AI 白名單內（已發布、未逾期、未被取代、未落後於正本、敏感度為 public、型別獲准）。不是 true 的內容 AI 不會引用。'],
  ['cdc:license', 'string', '授權代碼：OGDL-1.0（政府資料開放授權條款第 1 版）、CC0-1.0、CC-BY-4.0。'],
  ['cdc:status', 'string', '生命週期狀態：draft、review、published、archived。'],
];

/** 縮減物件以便放進文件：保留純量、字串截斷、陣列取前兩筆、最多兩層。 */
function slim(v, depth = 0) {
  if (v == null || typeof v === 'number' || typeof v === 'boolean') return v;
  if (typeof v === 'string') return v.length > 56 ? `${v.slice(0, 55)}…` : v;
  if (Array.isArray(v)) return v.slice(0, 2).map((x) => slim(x, depth + 1));
  if (typeof v === 'object') {
    if (depth >= 2) return '…';
    const out = {};
    for (const [k, x] of Object.entries(v)) {
      if (['__file', 'gov', 'blocks', 'machineReadableMarkdown', 'sections', 'i18n', 'sentences', 'terms', 'bodyMarkdown', 'answerMarkdown', 'weekly', 'weeklyLabels', 'resources', 'series', 'history', 'languages', 'sourceHash'].includes(k)) continue;
      if (x === undefined) continue;
      out[k] = slim(x, depth + 1);
      if (Object.keys(out).length >= 12) { out['…'] = '其餘欄位省略'; break; }
    }
    return out;
  }
  return String(v);
}

function sampleJson(site, ep) {
  if (ep.raw) return null;
  let data;
  try { data = ep.pick(site); } catch { data = null; }
  if (data == null) return null;
  if (ep.plain) return JSON.stringify(slim(data), null, 2);
  const meta = { api: 'v1', generatedAt: `${site.today}T03:00:00Z`, license: 'OGDL-1.0', source: `${siteOrigin()}/`, docs: `${siteOrigin()}/developers/`, etag: '"…"', lastModified: `${site.today}T03:00:00Z` };
  return JSON.stringify({ meta, data: slim(data) }, null, 2);
}

export function pages() { return [{ path: '/developers/', lang: 'zh-TW' }]; }

export function meta(ctx) {
  return {
    title: '開發者入口 · API 與機讀版', description: '疾管署 AI-ready 新官網的 JSON API、OpenAPI、llms.txt、每頁 .md 機讀版、JSON-LD 與 cdc: 治理詞彙表；授權為政府資料開放授權條款第 1 版。',
    scripts: ['/assets/js/pro.js'],
  };
}

export function render(ctx) {
  const { site, url, fmtDate } = ctx;
  const origin = siteOrigin();
  const abs = (p) => `${origin}${p}`;
  const doc = site.collections.documents.find((d) => d.isCurrent) ?? null;
  const docSlug = doc ? doc.id.replace(/^doc\./, '') : 'mmr-recommendation.2025-04-16';
  const dis = site.collections.diseases[0];
  const citeExample = doc
    ? `衛生福利部疾病管制署（${doc.reviewedAt} 審閱）。${doc.title}。${abs(`/documents/${docSlug}/`)}（${doc.version}，生效 ${doc.effectiveAt}）`
    : '衛生福利部疾病管制署（2026-04-10 審閱）。國內現行 MMR 預防接種建議。' + abs('/documents/mmr-recommendation.2025-04-16/') + '（114.04.16，生效 2025-04-16）';
  const jsonLdExample = JSON.stringify({
    '@context': ['https://schema.org', { cdc: `${origin}/developers/#vocab` }],
    '@type': 'MedicalCondition', name: dis?.title ?? '登革熱', url: abs(`/diseases/${dis?.slug ?? 'dengue'}/`), inLanguage: 'zh-TW',
    dateModified: dis?.reviewedAt ?? '2026-07-15', license: 'OGDL-1.0',
    'cdc:id': dis?.id ?? 'disease.dengue', 'cdc:owner': site.unitById.get(dis?.owner)?.name ?? '急性傳染病組',
    'cdc:reviewedAt': dis?.reviewedAt ?? '2026-07-15', 'cdc:nextReviewAt': dis?.gov?.nextReviewAt ?? '2027-07-15',
    'cdc:version': null, 'cdc:isCurrent': true, 'cdc:supersededBy': null, 'cdc:aiWhitelist': dis?.gov?.whitelist?.effective ?? true, 'cdc:license': 'OGDL-1.0',
  }, null, 2);
  const fetchExample = `// 讀取疫情態勢，不需金鑰
const res = await fetch('${abs('/v1/situation.json')}');
const { meta, data } = await res.json();
console.log(meta.license, data.dataDate, data.publisher);
for (const it of data.items) console.log(it.diseaseName, it.status, it.metricValue);`;
  const iframeExample = `<iframe src="${abs('/situation/')}" title="疾管署現在的疫情" width="100%" height="520" loading="lazy" referrerpolicy="no-referrer"></iframe>
<p>資料來源：衛生福利部疾病管制署，政府資料開放授權條款第 1 版。</p>`;
  const curl = `curl -s ${abs('/v1/documents.json')} | jq '.data[] | select(.isCurrent) | {id, version, effectiveAt, supersedes}'`;
  const redirects = (() => { try { return JSON.stringify({ meta: { api: 'v1', license: 'OGDL-1.0' }, data: slim(ENDPOINTS.find((e) => e.path === '/v1/redirects.json').pick(site)) }, null, 2); } catch { return ''; } })();

  return html`${proStyles}
<div class="pf" id="top">
  <h1>開發者入口</h1>
  <p class="lead">內容只存一份；網頁、API、機讀版、AI 索引都是它的消費者。這裡說明怎麼取用、怎麼引用，以及每個欄位的意思。</p>
  <nav aria-label="本頁目錄"><ul class="pf-pills">
    ${[['quick', '快速開始'], ['meta', 'meta 外殼'], ['endpoints', '端點'], ['openapi', 'OpenAPI'], ['limits', '限流與金鑰'], ['events', '變更事件'], ['machine', '機讀版'], ['vocab', 'cdc: 詞彙表'], ['license', '授權與引用'], ['embed', '嵌入範例'], ['vaxmap', '相關服務：接種點地圖'], ['redirects', '舊網址對照']].map(([id, label]) => html`<li><a class="pf-btn" href="#${id}">${label}</a></li>`)}
  </ul></nav>

  <section id="quick" aria-labelledby="quick-h">
    <h2 id="quick-h">快速開始</h2>
    <p>所有端點都是靜態 JSON，直接 GET 即可；原型部署在 GitHub Pages，免註冊、免金鑰。</p>
    <pre><code>${curl}</code></pre>
    <p>Base URL：<code>${origin}/v1/</code>。完整描述檔：<a href="${url('/openapi.json', { noLang: true })}">openapi.json</a>。</p>
  </section>

  <section id="meta" aria-labelledby="meta-h">
    <h2 id="meta-h">meta 外殼</h2>
    <p>每個 <code>v1/*.json</code> 都長一樣：<code>{ "meta": {…}, "data": … }</code>。</p>
    <div class="pf-table-wrap"><table class="pf-table"><thead><tr><th>欄位</th><th>意思</th></tr></thead><tbody>
      <tr><th scope="row"><code>meta.api</code></th><td>API 版本，目前 <code>v1</code>。破壞性變更會開 <code>v2</code>，v1 至少並行一年。</td></tr>
      <tr><th scope="row"><code>meta.generatedAt</code></th><td>這份檔案的產生時間（UTC）。每日排程重建，所以最久不超過一天。</td></tr>
      <tr><th scope="row"><code>meta.license</code></th><td>授權代碼，預設 <code>OGDL-1.0</code>；個別資料集例外時在 data 內另有 <code>license</code>。</td></tr>
      <tr><th scope="row"><code>meta.etag</code></th><td>內容雜湊。內容沒變就不變，可做條件式請求（<code>If-None-Match</code>）。</td></tr>
      <tr><th scope="row"><code>meta.lastModified</code></th><td>資料內容最後變動時間，不等於產生時間。</td></tr>
      <tr><th scope="row"><code>meta.source</code>、<code>meta.docs</code></th><td>正本網站與本文件的網址。</td></tr>
    </tbody></table></div>
    <p class="muted">原型現況：<code>generatedAt</code>、<code>license</code>、<code>source</code>、<code>docs</code> 已輸出；<code>etag</code>、<code>lastModified</code> 隨 API 輸出模組補齊（GitHub Pages 也會在 HTTP 標頭送出 ETag 與 Last-Modified）。下方範例的時間為建置日 ${fmtDate(site.today)}，屬示意。</p>
  </section>

  <section id="endpoints" aria-labelledby="ep-h">
    <h2 id="ep-h">端點與範例回應</h2>
    <p>展開每個端點可看到說明與真實建置資料的前兩筆（欄位已縮減，長文字截斷）。</p>
    ${ENDPOINTS.map((ep) => {
      const sample = sampleJson(site, ep);
      const link = ep.example ?? ep.path;
      return html`<details class="pf-ep"><summary><span class="pf-get">GET</span> <code>${ep.path}</code> <span class="muted">${ep.desc}</span></summary><div>
        <p><a href="${url(link, { noLang: true })}">開啟 ${link}</a></p>
        ${sample ? html`<pre><code>${sample}</code></pre>` : html`<p class="muted">${ep.raw ? 'OpenAPI 3.1 JSON，欄位定義請直接開啟。' : '建置時依內容產生；目前沒有可顯示的範例資料。'}</p>`}
      </div></details>`;
    })}
  </section>

  <section id="openapi" aria-labelledby="oa-h">
    <h2 id="oa-h">OpenAPI</h2>
    <p>建置時由 <code>scripts/lib/openapi.mjs</code> 依同一份端點清單產生 <a href="${url('/openapi.json', { noLang: true })}"><code>/openapi.json</code></a>，可直接匯入 Swagger UI、Postman 或程式碼產生器。下表是瀏覽器即時讀取該檔的結果，用來確認上方清單與描述檔一致。</p>
    <div data-openapi><p class="muted">讀取中…（需要 JavaScript）</p></div>
  </section>

  <section id="limits" aria-labelledby="lim-h">
    <h2 id="lim-h">限流與金鑰</h2>
    <dl class="pf-dl">
      <dt>原型</dt><dd>免金鑰、免註冊。靜態檔案由 GitHub Pages 與 CDN 提供，沒有應用層限流；請善意使用，建議快取並以 <code>ETag</code> 做條件式請求，輪詢間隔不低於 1 小時（資料每日重建一次）。</dd>
      <dt>正式環境（規劃）</dt><dd>匿名存取維持開放；大量取用者可申請 API 金鑰（<code>X-API-Key</code>），用於聯絡與通知破壞性變更，而不是設門檻。超量時回 <code>429</code> 並附 <code>Retry-After</code>。</dd>
      <dt>穩定性承諾</dt><dd>已發布欄位不改名、不改型別；新增欄位視為相容變更。計畫下架的端點至少提前 90 天在此頁與變更 feed 公告。</dd>
    </dl>
  </section>

  <section id="events" aria-labelledby="ev-h">
    <h2 id="ev-h">變更事件</h2>
    <p>不想輪詢整份 JSON，可以訂閱變更。</p>
    <ul>
      <li><strong>RSS / Atom</strong>：<a href="${url('/feeds/documents.xml', { noLang: true })}"><code>/feeds/documents.xml</code></a>。文件新版發布、現行版異動、舊版失效各產生一則，內容含 id、版次、生效日、取代關係與異動摘要。</li>
      <li><strong>Webhook（規劃，第二階段）</strong>：訂閱者登錄回呼網址後，在文件新版發布、AI 暫停／恢復、態勢發布時收到下列 JSON。原型尚未提供，格式如下供介接預先設計。</li>
    </ul>
    <pre><code>${JSON.stringify({ event: 'document.published', occurredAt: `${site.today}T01:00:00Z`, id: doc?.id ?? 'doc.mmr-recommendation.2025-04-16', version: doc?.version ?? '114.04.16', effectiveAt: doc?.effectiveAt ?? '2025-04-16', supersedes: doc?.supersedes ?? 'doc.mmr-recommendation.2019-05-14', url: abs(`/documents/${docSlug}/`) }, null, 2)}</code></pre>
  </section>

  <section id="machine" aria-labelledby="mr-h">
    <h2 id="mr-h">機讀版：llms.txt、robots.txt、.md、JSON-LD</h2>
    <dl class="pf-dl">
      <dt><a href="${url('/llms.txt', { noLang: true })}"><code>/llms.txt</code></a></dt><dd>給 AI 系統的入口：列出可引用的正本內容與資料出口。各語言有 <code>/{lang}/llms.txt</code>。引用時請附頁面網址與「最後審閱日」。</dd>
      <dt><a href="${url('/robots.txt', { noLang: true })}"><code>/robots.txt</code></a></dt><dd>只擋 <code>/ask/</code> 與 <code>/admin/</code>（動態查詢結果與後台）。失效版本<strong>不靠 robots 隱藏</strong>：爬蟲被擋就看不到頁面上的 noindex，改用頁面層級的 <code>&lt;meta name="robots" content="noindex"&gt;</code> 並以 301 導向現行版。</dd>
      <dt><code>.md</code> 機讀版</dt><dd>每個內容頁都有同名 <code>.md</code>，例如 <a href="${url(`/diseases/${dis?.slug ?? 'dengue'}.md`)}"><code>/diseases/${dis?.slug ?? 'dengue'}.md</code></a>。第一段是治理資訊（權責、審閱日、版本、授權、正本網址），之後是本文；失效或逾期時第一行就是警示。</dd>
      <dt>JSON-LD</dt><dd>每頁 <code>&lt;head&gt;</code> 內嵌 schema.org 結構（MedicalCondition、FAQPage、NewsArticle、DigitalDocument、Dataset、GovernmentOrganization），並加上自訂 <code>cdc:</code> 治理欄位，詞彙見下節。</dd>
      <dt>sitemap</dt><dd><a href="${url('/sitemap.xml', { noLang: true })}"><code>/sitemap.xml</code></a> 為索引，另依型別與語言分檔；失效版本不在其中。</dd>
    </dl>
    <p>疾病頁 JSON-LD 範例（節錄）：</p>
    <pre><code>${jsonLdExample}</code></pre>
  </section>

  <section id="vocab" aria-labelledby="vocab-h">
    <h2 id="vocab-h">cdc: 自訂詞彙表</h2>
    <p>命名空間 <code>cdc:</code> ＝ <code>${origin}/developers/#vocab</code>。這些欄位由治理引擎在建置時計算，頁面與 API 一致。</p>
    <div class="pf-table-wrap"><table class="pf-table"><thead><tr><th scope="col">詞彙</th><th scope="col">型別</th><th scope="col">定義</th></tr></thead><tbody>
      ${VOCAB.map(([term, type, def]) => html`<tr id="${term.replace(':', '-')}"><th scope="row"><code>${term}</code></th><td>${type}</td><td>${def}</td></tr>`)}
    </tbody></table></div>
  </section>

  <section id="license" aria-labelledby="lic-h">
    <h2 id="lic-h">授權與引用規範</h2>
    <p>預設授權為<strong>政府資料開放授權條款第 1 版（OGDL-1.0）</strong>：可自由重製、散布、修改、商業利用，但須標示來源。個別資料集若為 CC0-1.0 或 CC BY 4.0，會在該筆的 <code>license</code> 欄位寫明。政策頁：<a href="${url('/policy/open-data/')}">開放資料授權</a>。</p>
    <h3>引用格式</h3>
    <p>請附上<strong>網址</strong>與<strong>最後審閱日</strong>；文件類再附版次與生效日。專業模式頁面的「引用本頁」按鈕會自動產生：</p>
    <pre><code id="cite-example">${citeExample}</code></pre>
    <p><button type="button" class="pf-btn" data-copy-from="#cite-example">複製範例</button></p>
    <p>AI 系統引用時，請同時帶出 <code>cdc:reviewedAt</code> 與 <code>cdc:isCurrent</code>；若 <code>isCurrent</code> 為 <code>false</code>，應改引 <code>cdc:supersededBy</code> 指向的新版。</p>
  </section>

  <section id="embed" aria-labelledby="emb-h">
    <h2 id="emb-h">嵌入「現在的疫情」</h2>
    <h3>iframe</h3>
    <pre><code>${iframeExample}</code></pre>
    <h3>fetch</h3>
    <pre><code>${fetchExample}</code></pre>
    <p><button type="button" class="pf-btn pf-btn--primary" data-embed-run>執行上面的 fetch 看結果</button></p>
    <div class="pf-tiles" data-embed-demo aria-live="polite"></div>
    <p class="muted">態勢「狀態」四級（平穩、上升、高峰、下降）由疫情中心人工發布，嵌入時請原樣顯示並標示資料日與發布單位，不要自行推算。</p>
  </section>

  <section id="vaxmap" aria-labelledby="vx-h">
    <h2 id="vx-h">相關服務：疫苗及流感藥劑地圖（vaxmap-next）</h2>
    <p>「哪裡可以打疫苗、哪裡有流感抗病毒藥劑」由獨立的改良版地圖網站提供：<a href="${vaxmapLink(ctx, { lang: null })}" target="_blank" rel="noopener">${vaxmapLink(ctx, { lang: null })}</a>（開新視窗）。本站不自行列出院所，因為庫存每天變動；請用深連結導向它。可分享網址的狀態全部放在 hash（<code>#</code> 後面），不需要金鑰：</p>
    <div class="pf-table-wrap"><table class="pf-table"><thead><tr><th scope="col">參數</th><th scope="col">值</th><th scope="col">範例</th></tr></thead><tbody>
      <tr><th scope="row"><code>g</code></th><td>群組，可多選（逗號）：<code>flu</code> 流感疫苗、<code>covid</code> COVID-19 疫苗、<code>pcv</code> 肺炎鏈球菌疫苗、<code>antiviral</code> 流感抗病毒藥劑</td><td><code>#g=flu,covid</code></td></tr>
      <tr><th scope="row"><code>p</code></th><td>產品：<code>flu</code>、<code>mod_adult</code>、<code>mod_child</code>、<code>novavax</code>、<code>pcv20</code>、<code>pcv21</code>、<code>antiviral</code></td><td><code>#g=pcv&amp;p=pcv20</code></td></tr>
      <tr><th scope="row"><code>today</code>、<code>stock</code></th><td><code>1</code>：只看今日有看診、只看有庫存</td><td><code>#g=flu&amp;today=1&amp;stock=1</code></td></tr>
      <tr><th scope="row"><code>city</code>、<code>dist</code></th><td>縣市、鄉鎮市區（中文，須 URL 編碼；先有 city 才認 dist）</td><td><code>#g=flu&amp;city=臺北市&amp;dist=大安區</code></td></tr>
      <tr><th scope="row"><code>q</code>、<code>id</code>、<code>map</code></th><td>關鍵字（最長 60 字）、院所 id、地圖視野 <code>緯度,經度,縮放</code></td><td><code>#id=2050&amp;map=22.65,120.29,15</code></td></tr>
      <tr><th scope="row"><code>lang</code></th><td><code>en</code>、<code>ja</code>、<code>ko</code>、<code>id</code>、<code>vi</code>、<code>th</code>、<code>tl</code>；繁中不寫。本站語言碼與它相同（本站沒有 ko）</td><td><code>#g=flu&amp;lang=en</code></td></tr>
      <tr><th scope="row">接種資訊專區</th><td><code>info.html#&lt;錨點&gt;&amp;lang=…</code>；錨點如 <code>where</code>、<code>coins</code>、<code>eligibility</code></td><td><code>info.html#where&amp;lang=vi</code></td></tr>
    </tbody></table></div>
    <pre><code>${vaxmapLink(ctx, { group: 'flu', city: '臺北市' })}
${vaxmapLink(ctx, { group: 'antiviral', lang: 'en' })}
${vaxmapLink(ctx, { info: true, anchor: 'where', lang: 'vi' })}</code></pre>
    <p class="muted">不認得的參數值會被忽略，不會報錯。資料為每日兩次的快照，頁面會顯示資料時間；整合方案（連結、資料、呈現、治理四層）見 <code>docs/vaxmap-integration.md</code>。</p>
  </section>

  <section id="redirects" aria-labelledby="red-h">
    <h2 id="red-h">舊網址對照</h2>
    <p><a href="${url('/v1/redirects.json', { noLang: true })}"><code>/v1/redirects.json</code></a> 列出舊版文件與現行官網網址對應的正本，各筆 <code>status</code> 為 301。網站搬遷後用它更新書籤、文獻與連結。</p>
    ${redirects ? html`<pre><code>${redirects}</code></pre>` : ''}
    <h3 id="legacy-map">舊官網網址對照（內容移轉）</h3>
    <p>舊官網（www.cdc.gov.tw）上架的內容會依<strong>移轉清單</strong>逐筆對應到新頁。對照結果有四種輸出，都在建置時由同一份清單產生，不需手動維護：</p>
    <div class="pf-table-wrap"><table class="pf-table"><thead><tr><th scope="col">檔案</th><th scope="col">用途</th></tr></thead><tbody>
      <tr><th scope="row"><a href="${url('/v1/legacy-map.json', { noLang: true })}"><code>/v1/legacy-map.json</code></a></th><td>精簡對照 <code>{ "/disease/subindex/…": "/diseases/tuberculosis/" }</code>。key 已正規化（小寫、無網域、無尾斜線、無 hash、去掉 <code>page</code> 參數）。404 頁與 <a href="${url('/legacy/', { noLang: true })}">/legacy/ 查詢頁</a>即用它。</td></tr>
      <tr><th scope="row"><a href="${url('/redirects/nginx.map', { noLang: true })}"><code>/redirects/nginx.map</code></a></th><td>Nginx <code>map</code> 指令用，一行一筆：<code>~^/Disease/SubIndex/xxx$ /diseases/tuberculosis/;</code>。</td></tr>
      <tr><th scope="row"><a href="${url('/redirects/web.config.rewritemap.xml', { noLang: true })}"><code>/redirects/web.config.rewritemap.xml</code></a></th><td>IIS URL Rewrite 的 <code>rewriteMap</code>，貼進 <code>web.config</code>；署內現行官網若為 IIS 可直接用。</td></tr>
      <tr><th scope="row"><a href="${url('/redirects/_redirects', { noLang: true })}"><code>/redirects/_redirects</code></a></th><td>Netlify／Cloudflare Pages 格式：<code>from to 301</code>。</td></tr>
    </tbody></table></div>
    <p class="muted">三個 <code>redirects/</code> 檔都只收「已移轉、已併入」且網址完整的項目，狀態為待確認或網址仍是 <code>{id}</code> 佔位的不會輸出（寧可不轉，也不轉錯）。<code>/v1/redirects.json</code> 另含 <code>kind: "migration"</code> 項與每筆的 <code>verified</code> 欄位。政策與關閉日見 <a href="${url('/legacy/', { noLang: true })}">舊網址查詢頁</a>下方說明。</p>
  </section>

  <p class="muted"><a href="#top">回到頁首</a> · <a href="${url('/guide/')}">使用指南</a> · <a href="${url('/transparency/')}">AI 透明報告</a></p>
</div>`;
}
