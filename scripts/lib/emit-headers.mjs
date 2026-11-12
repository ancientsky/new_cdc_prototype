// 第二十三輪（ARCHITECTURE 26.2）：HTTP 安全標頭基準，由建置輸出伺服器設定檔 → dist/headers/
//
// 為什麼在建置時產生：靜態站本身回不了標頭，標頭要由伺服器／CDN 加；但 CSP 的 inline script 雜湊只有建置端知道
//（每個版面模板都有一小段 inline script，例如 layout 的檢視模式切換）。把「掃 dist 裡所有會執行的 inline script → 算 sha256」
// 交給建置，資訊室部署時直接拿 dist/headers/ 的檔案套，就不會因為某一輪多了一段 inline script 而 CSP 擋掉功能。
//
// 輸出：
//   dist/headers/headers.json          — 標頭名稱 → 值、要拿掉的標頭、快取規則（第七十二輪）（機讀正本；CI 與測試讀這份）
//   dist/headers/nginx.conf            — nginx `add_header` 片段（include 進 server{}）
//   dist/headers/web.config.headers.xml — IIS <httpProtocol><customHeaders>
//   dist/headers/_headers              — Netlify／Cloudflare Pages 格式
//   dist/headers/README.md             — 怎麼套、怎麼驗、為什麼
//
// CSP 的來源白名單從程式碼事實推出：frame-src 只有 vaxmap、登革熱地圖（第五十七輪，專區頁嵌入）與 YouTube（影片用 youtube-nocookie 嵌入）；connect-src 多 api.anthropic.com
// 只因示範用 BYOK（正式站拿掉 BYOK 就拿掉）；img-src 允許 data:（favicon 與預覽佔位圖是 data URI）。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../../site.config.mjs';
import { formOrigins, askLogOrigins } from './forms.mjs';

// 第六十三輪（Issue #141）：要「拿掉」的指紋標頭。Server／X-Powered-By／X-AspNet-Version 等標頭說出伺服器軟體與版本，
// 自動盤點工具（ARTEX 一類）拿來直接比對已知漏洞清單。拿掉它們不會讓伺服器更安全（真正的防線是更新修補），
// 但會讓「先挑版本最舊的打」這一步變慢、變難。headers.json 的 remove 陣列是機讀正本；各格式的做法不同，見 render* 與 README。
export const REMOVE_HEADERS = ['Server', 'X-Powered-By', 'X-AspNet-Version', 'X-AspNetMvc-Version'];

// 第七十二輪（docs/performance-lighthouse.md）：快取規則（Cache-Control）。以前 dist/headers/ 只輸出安全標頭，快取建議散在 docs/deploy.md §12.2
//（只有 /pagefind/），其他路徑要資訊室自己想；Lighthouse 的 cache-insight 每頁都指出 /assets、/img 沒有快取策略。
// 規則放在這裡（機讀正本 headers.json 的 cache 區塊），nginx／_headers／IIS 片段由同一份產生，改規則只改這裡。
// 三類，依「內容變了，讀者多快要看到」分：
//   no-cache（預設）：HTML、v1 JSON、Pagefind 入口與執行檔——每次都問伺服器「有沒有變」，沒變回 304（ETag／Last-Modified），幾乎不花流量；
//                     緊急發布必須立刻看得到。GitHub Pages 目前固定 max-age=600（最多晚 10 分鐘），這裡比它更即時。
//   revalidate-hour：/assets/、/img/、/files/——檔名「不含內容雜湊」，ES module 的 import 路徑也沒有版本，所以不能 immutable：
//                     若快取一年，改版後舊 JS 會配新 HTML。給 1 小時＋stale-while-revalidate 1 天：同一小時內翻頁不再下載，
//                     超過一小時先用舊檔顯示、背景更新，最壞情況是改版後一小時內少數讀者看到前一版樣式。真正的解法是檔名含雜湊（見文件「之後再看」）。
//   immutable：Pagefind 的 index／fragment／filter 與 *.pf_meta——檔名就是內容雜湊，內容變檔名就變，可以快取一年。
/** @type {{ id: string, cacheControl: string, paths: string[], why: string }[]} */
export const CACHE_RULES = [
  {
    id: 'no-cache',
    cacheControl: 'no-cache',
    paths: ['/', '/**/', '/**/*.html', '/**/*.md', '/v1/**', '/pagefind/pagefind-entry.json', '/pagefind/pagefind.js', '/pagefind/pagefind-worker.js', '/pagefind/wasm.*.pagefind', '（其他未列路徑）'],
    why: '每次向伺服器驗證（ETag／Last-Modified，沒變回 304）：HTML、v1 資料與搜尋入口一改就要看得到，緊急發布不能被快取擋住。pagefind-entry.json 指向最新的雜湊索引檔，長快取會讓讀者一直搜舊索引。',
  },
  {
    id: 'revalidate-hour',
    cacheControl: 'public, max-age=3600, stale-while-revalidate=86400',
    paths: ['/assets/**', '/img/**', '/files/**'],
    why: '檔名不含內容雜湊、ES module 的 import 路徑也沒有版本，不能 immutable（否則改版後舊 JS 配新 HTML）；1 小時內翻頁免下載，過期後先用舊檔、背景更新。',
  },
  {
    id: 'immutable',
    cacheControl: 'public, max-age=31536000, immutable',
    paths: ['/pagefind/index/**', '/pagefind/fragment/**', '/pagefind/filter/**', '/pagefind/pagefind.*.pf_meta'],
    why: '檔名就是內容雜湊（Pagefind 產生），內容變檔名就變，快取一年也不會拿到舊內容。',
  },
];
const cacheOf = (id) => CACHE_RULES.find((r) => r.id === id).cacheControl;

const EXEC_SCRIPT_RE = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;

/** 掃一段 HTML，回傳會被瀏覽器執行的 inline script 內容（排除 src=、ld+json、application/json、module 以外的資料型 type） */
export function inlineScripts(htmlText) {
  const out = [];
  for (const m of htmlText.matchAll(EXEC_SCRIPT_RE)) {
    const attrs = m[1] ?? '';
    if (/\bsrc\s*=/.test(attrs)) continue;
    const type = (attrs.match(/\btype\s*=\s*["']([^"']+)["']/i) ?? [])[1]?.toLowerCase();
    if (type && type !== 'module' && type !== 'text/javascript' && type !== 'application/javascript') continue; // ld+json、application/json 等資料不執行
    if (m[2].trim()) out.push(m[2]);
  }
  return out;
}

export const sha256 = (s) => `'sha256-${crypto.createHash('sha256').update(s, 'utf8').digest('base64')}'`;

function* walkHtml(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'preview') yield* walkHtml(p); } // PR 預覽是別的 commit 建的，不算進本版雜湊
    else if (e.name.endsWith('.html')) yield p;
  }
}

/** 掃整個 dist：回傳 { hashes:[...], count, pages } */
export function collectInlineHashes(dist) {
  const hashes = new Map(); // hash → 首次出現的頁面
  let pages = 0;
  for (const f of walkHtml(dist)) {
    pages++;
    const text = fs.readFileSync(f, 'utf8');
    for (const s of inlineScripts(text)) { const h = sha256(s); if (!hashes.has(h)) hashes.set(h, path.relative(dist, f)); }
  }
  return { hashes: [...hashes.keys()], firstSeen: Object.fromEntries(hashes), count: hashes.size, pages };
}

/** 標頭基準（值）。opts.hashes = inline script 雜湊；opts.vaxmapOrigin、opts.denguemapOrigin 可覆寫。 */
// 第五十七輪：frame-src 的地圖來源由 site.config 的 vaxmapUrl、denguemapUrl 推出並去重。原型兩張地圖與本站同在 ancientsky.github.io，
// 所以 frame-src 字串不變；正式站把地圖放到官方網域子路徑或專用網域時，改設定重建即可（docs/denguemap-integration.md 3.3）。
// 第三十輪（#55）：formOrigins＝site.config.mjs forms 裡生效中的 post 端點來源（機關個資表單系統）。只加進 connect-src（fetch 送出）與 form-action（不支援 fetch 時的一般表單 POST），其他指令不動。
// 第四十一輪：askLogOrigins＝site.config.mjs askLog 生效中的 post 端點來源（查詢紀錄收件系統）。fetch／sendBeacon 只受 connect-src 管，所以只加進 connect-src。
export function securityHeaders({ hashes = [], llmOrigin = 'https://api.anthropic.com', vaxmapOrigin = new URL(config.vaxmapUrl).origin, denguemapOrigin = new URL(config.denguemapUrl).origin, frameAncestors = "'self'", formOrigins: forms = formOrigins(config), askLogOrigins: askLog = askLogOrigins(config) } = {}) {
  const connect = [...new Set([...forms, ...askLog])];
  const frames = [...new Set([vaxmapOrigin, denguemapOrigin].filter(Boolean))];
  const csp = [
    "default-src 'self'",
    // 'wasm-unsafe-eval'（第二十八輪）：Pagefind 全文搜尋用 WebAssembly；它只允許編譯 .wasm，不允許 eval() 與 new Function()，所以不等於 'unsafe-eval'
    `script-src 'self' 'wasm-unsafe-eval' ${hashes.join(' ')}`.trim(),
    "style-src 'self' 'unsafe-inline'", // 後台少量 style="" 屬性；正式站可改成 nonce／class 後拿掉 'unsafe-inline'（README 有清單）
    "img-src 'self' data: https://i.ytimg.com",
    "font-src 'self'",
    `connect-src 'self' ${llmOrigin} ${connect.join(' ')}`.trim(),
    `frame-src ${frames.join(' ')} https://www.youtube-nocookie.com https://www.youtube.com`,
    `frame-ancestors ${frameAncestors}`,
    "object-src 'none'",
    "base-uri 'self'",
    `form-action 'self' ${forms.join(' ')}`.trim(),
    'upgrade-insecure-requests',
  ].join('; ');
  return {
    'Content-Security-Policy': csp,
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN', // 舊瀏覽器備援；新瀏覽器以 frame-ancestors 為準
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
  };
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

export function renderNginx(h, remove = REMOVE_HEADERS, { prefix = config.basePath } = {}) {
  const addLines = (indent) => Object.entries(h).map(([k, v]) => `${indent}add_header ${k} "${v.replace(/"/g, '\\"')}" always;`);
  const loc = (head, id) => [`location ${head} {`, ...addLines('  '), `  add_header Cache-Control "${cacheOf(id)}";`, '}'];
  return [
    '# 由 scripts/lib/emit-headers.mjs 自動產生（docs/deploy.md §10、§12.2）。請 include 在 server{} 這一層（第七十二輪起含 location 區塊，不能放進 location / {} 裡）；請勿手改，改程式重建。',
    '# 注意：nginx 的 add_header 有「子層一出現 add_header，就整組不繼承上層」的規則。所以下面每個快取用的 location 都把安全標頭再列一次——',
    '# 檔案是建置產生的，重複不會造成維護負擔；改用 include 共用片段則要寫死伺服器上的絕對路徑，搬目錄就壞，因此不用。',
    '# 你自己的 location 若有 add_header，同樣要把這些安全標頭補進去。',
    ...addLines(''),
    '',
    `# 第七十二輪：快取規則（headers.json 的 cache 區塊）。預設 no-cache：HTML、v1 JSON、Pagefind 入口每次驗證（沒變回 304），緊急發布立刻看得到。`,
    '# 為什麼不加 always：304／404 不需要快取標頭；安全標頭才需要 always（錯誤頁也要有 CSP）。',
    `add_header Cache-Control "${cacheOf('no-cache')}";`,
    '',
    '# /assets、/img、/files：檔名沒有內容雜湊，不能 immutable；1 小時＋背景更新 1 天。^~ 讓這些路徑不再比對 regex location。',
    ...['assets', 'img', 'files'].flatMap((d) => loc(`^~ ${prefix}/${d}/`, 'revalidate-hour')),
    '# Pagefind 雜湊檔：檔名即內容雜湊，可快取一年',
    ...['index', 'fragment', 'filter'].flatMap((d) => loc(`^~ ${prefix}/pagefind/${d}/`, 'immutable')),
    ...loc(`~ ^${prefix.replace(/[.]/g, '\\.')}/pagefind/pagefind\\.[^/]+\\.pf_meta$`, 'immutable'),
    '',
    `# 第六十三輪（Issue #141）：指紋標頭（${remove.join('、')}）。server_tokens off 只把 Server 的版本號拿掉，仍會送出「Server: nginx」。`,
    '# 完全拿掉 Server 需要 headers-more 模組：more_clear_headers Server;（放在 http{} 或 server{}）；',
    '# nginx 當反向代理時，上游（IIS、Node、應用伺服器）送來的標頭用 proxy_hide_header 擋掉。',
    'server_tokens off;',
    ...remove.filter((k) => k !== 'Server').map((k) => `proxy_hide_header ${k};`),
    `# more_clear_headers ${remove.join(' ')};`,
    '',
  ].join('\n');
}

export function renderWebConfig(h, remove = REMOVE_HEADERS) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!-- 由 scripts/lib/emit-headers.mjs 自動產生（docs/deploy.md §10）。放進 web.config 的 <system.webServer> 內；請勿手改。 -->',
    '<!-- 第六十三輪（Issue #141）：拿掉指紋標頭。X-Powered-By 由 customHeaders 的 remove 拿掉；Server 要 IIS 10（Windows Server 2016）以上的 removeServerHeader；',
    '     X-AspNet-Version 另在 <system.web><httpRuntime enableVersionHeader="false" /> 關閉，X-AspNetMvc-Version 在 Application_Start 設 MvcHandler.DisableMvcResponseHeader = true。 -->',
    '<configuration><system.webServer><httpProtocol><customHeaders>',
    ...remove.filter((k) => k !== 'Server').map((k) => `  <remove name="${esc(k)}" />`),
    ...Object.entries(h).map(([k, v]) => `  <remove name="${esc(k)}" /><add name="${esc(k)}" value="${esc(v)}" />`),
    '</customHeaders></httpProtocol>',
    '<security><requestFiltering removeServerHeader="true" /></security>',
    '</system.webServer></configuration>',
    '',
  ].join('\n');
}

export function renderNetlify(h, remove = REMOVE_HEADERS, { prefix = config.basePath } = {}) {
  return [
    '# 由 scripts/lib/emit-headers.mjs 自動產生（Netlify／Cloudflare Pages 格式）',
    `# 第六十三輪（Issue #141）：_headers 只能「加」標頭，不能拿掉 ${remove.join('、')}；這兩個平台本身不送 X-Powered-By，Server 由平台決定。`,
    '# 要拿掉請在前面的 CDN 設定（例如 Azure Front Door 規則引擎「刪除回應標頭」，見 README.md）。',
    '/*',
    ...Object.entries(h).map(([k, v]) => `  ${k}: ${v}`),
    '',
    '# 第七十二輪：快取規則（headers.json 的 cache 區塊）。只列「跟平台預設不同」的路徑：兩個平台對其他路徑的預設都是每次驗證',
    '# （等於 no-cache），正好是 HTML、v1 JSON、Pagefind 入口要的。不另寫 no-cache 規則，是因為同一個標頭被多條規則命中時，',
    '# 平台會把值用逗號合併（例如「no-cache, public, max-age=31536000」），所以下面的路徑彼此不重疊。部署後請用 README.md 的 curl 驗證。',
    ...['assets', 'img', 'files'].flatMap((d) => [`${prefix}/${d}/*`, `  Cache-Control: ${cacheOf('revalidate-hour')}`]),
    ...['index/*', 'fragment/*', 'filter/*', '*.pf_meta'].flatMap((d) => [`${prefix}/pagefind/${d}`, `  Cache-Control: ${cacheOf('immutable')}`]),
    '',
  ].join('\n');
}


/** 第七十二輪：IIS 的快取設定片段（README 內嵌）。IIS 的 <clientCache> 不能依副檔名或萬用字元設，只能「整站一個預設、再用 <location path> 依資料夾覆寫」。 */
export function renderIisCache({ prefix = config.basePath } = {}) {
  const p = prefix.replace(/^\//, '');
  const at = (dir) => (p ? `${p}/${dir}` : dir);
  const loc = (dir, attrs) => `  <location path="${at(dir)}"><system.webServer><staticContent><clientCache ${attrs} /></staticContent></system.webServer></location>`;
  return [
    '<!-- 預設（HTML、v1、Pagefind 入口）：每次驗證。放進站台 web.config 的 <system.webServer> 內 -->',
    '<staticContent><clientCache cacheControlMode="DisableCache" /></staticContent>',
    '<!-- 下面的 <location> 放在 <configuration> 底下（與 <system.webServer> 同層） -->',
    ...['assets', 'img', 'files'].map((d) => loc(d, 'cacheControlMode="UseMaxAge" cacheControlMaxAge="01:00:00" cacheControlCustom="public, stale-while-revalidate=86400"')),
    ...['pagefind/index', 'pagefind/fragment', 'pagefind/filter'].map((d) => loc(d, 'cacheControlMode="UseMaxAge" cacheControlMaxAge="365.00:00:00" cacheControlCustom="public, immutable"')),
  ].join('\n');
}

export function renderReadme(h, info) {
  return `# HTTP 安全標頭基準（自動產生）

建置日 ${new Date().toISOString().slice(0, 10)}；掃了 ${info.pages} 頁，找到 ${info.count} 段會執行的 inline script，CSP 的 \`script-src\` 已含其 sha256 雜湊。

## 怎麼套

| 環境 | 檔案 | 做法 |
| --- | --- | --- |
| nginx | \`nginx.conf\` | 在 \`server {}\` 內 \`include /path/to/headers/nginx.conf;\` |
| IIS | \`web.config.headers.xml\` | 把 \`<httpProtocol>\` 區塊合進站台 \`web.config\` 的 \`<system.webServer>\` |
| Netlify／Cloudflare Pages | \`_headers\` | 放到網站根目錄 |
| 其他 CDN | \`headers.json\` | 依表逐項設定 |

## 怎麼驗

部署後：\`curl -sI https://<網域>/ | grep -iE 'content-security-policy|strict-transport|x-content-type|referrer-policy|permissions-policy'\`，或用 https://securityheaders.com 。
瀏覽器 DevTools Console 若出現 \`Refused to execute inline script\`，代表有新的 inline script 沒進雜湊：重新建置、重新套本目錄的檔案即可（雜湊由建置掃描產生，不必手算）。

## 為什麼是這些值

- **CSP**：\`default-src 'self'\` 擋掉第三方腳本注入；inline script 用雜湊而不是 \`'unsafe-inline'\`；\`'wasm-unsafe-eval'\` 只為了全文搜尋（Pagefind）載入 WebAssembly，不開放 \`eval()\`；\`frame-src\` 只放疫苗地圖、登革熱地圖與 YouTube（地圖來源由 \`site.config.mjs\` 的 \`vaxmapUrl\`、\`denguemapUrl\` 推出，目前：${[...new Set([config.vaxmapUrl, config.denguemapUrl].map((u) => new URL(u).origin))].join('、')}）；\`frame-ancestors 'self'\` 防點擊劫持（現行官網是 \`'self' *.cdc.gov.tw\`，正式站換網域時依需要加子網域）；\`connect-src\` 多 \`api.anthropic.com\` 只因示範用 BYOK，正式站拿掉。
- **表單端點**（第三十輪）：\`site.config.mjs\` 的 \`forms\` 有設 post 端點時，該來源自動加進 \`connect-src\` 與 \`form-action\`（目前：${formOrigins(config).join('、') || '無，全部表單為原型模擬'}）；個資表單系統換網域只要改設定重建。
- **查詢紀錄端點**（第四十一輪）：\`site.config.mjs\` 的 \`askLog\` 設為 post 時，該來源自動加進 \`connect-src\`（目前：${askLogOrigins(config).join('、') || '無，未啟用正式端點'}）；詳見 docs/ask-log.md。
- **HSTS** 一年含子網域；**nosniff**、**Referrer-Policy**、**Permissions-Policy** 為 OWASP Secure Headers 建議值。
- \`style-src\` 暫留 \`'unsafe-inline'\`：後台頁有少量 \`style=""\` 屬性；清掉後可改為 \`'self'\`。

## 拿掉指紋標頭（第六十三輪，Issue #141）

要拿掉：${REMOVE_HEADERS.map((k) => `\`${k}\``).join('、')}（\`headers.json\` 的 \`remove\` 陣列）。這些標頭說出伺服器軟體與版本，自動盤點工具用來比對已知漏洞。拿掉不能取代修補，但讓「挑最舊的版本打」變難。

| 環境 | 做法 |
| --- | --- |
| nginx | \`nginx.conf\` 已含 \`server_tokens off;\`（只拿掉版本號）；完全拿掉 \`Server\` 要 headers-more 模組 \`more_clear_headers Server;\`；當反向代理時用 \`proxy_hide_header X-Powered-By;\` 等擋掉上游送來的 |
| IIS | \`web.config.headers.xml\` 已含 \`<remove name="X-Powered-By" />\` 與 \`<security><requestFiltering removeServerHeader="true" /></security>\`（IIS 10 以上）；\`X-AspNet-Version\` 用 \`<httpRuntime enableVersionHeader="false" />\` 關 |
| Azure Front Door | 規則引擎（Rule set）新增規則：條件留空（全部請求）、動作「修改回應標頭」→ 運算子「刪除」，標頭名稱逐一填 ${REMOVE_HEADERS.join('、')}；套用到公開站的路由 |
| Netlify／Cloudflare Pages | \`_headers\` 只能加不能刪；平台本身不送 \`X-Powered-By\`，\`Server\` 由平台決定，若要拿掉需在前面的 CDN 處理 |
| 其他 CDN | 依 \`headers.json\` 的 \`remove\` 逐項設定「刪除回應標頭」 |

驗證：\`curl -sI https://<網域>/ | grep -iE '^(server|x-powered-by|x-aspnet)'\` 應該沒有輸出（或只剩不含版本的 \`Server\`）。

## 快取規則（第七十二輪，docs/performance-lighthouse.md）

機讀正本是 \`headers.json\` 的 \`cache\` 陣列；\`nginx.conf\`、\`_headers\` 已含對應規則，IIS 用下面的片段。表內路徑以網站根為準；產生的設定已加上 basePath 前綴（目前：\`${config.basePath || '（無）'}\`）。

| 規則 | \`Cache-Control\` | 路徑 | 為什麼 |
| --- | --- | --- | --- |
${CACHE_RULES.map((r) => `| ${r.id} | \`${r.cacheControl}\` | ${r.paths.map((x) => (x.startsWith('/') ? `\`${x}\`` : x)).join('、')} | ${r.why} |`).join('\n')}

- **為什麼 /assets 不設 immutable：** 檔名沒有內容雜湊（\`ui.js\` 改版後還叫 \`ui.js\`），而且 JS 檔彼此用 \`import './x.js'\` 互相引用，路徑也沒有版本。快取一年＝改版後讀者可能拿新 HTML 配舊 JS。正解是建置時把檔名改成含雜湊並改寫每個模組裡的 import 路徑；GitHub Pages 不吃自訂標頭，現在做也看不到效果，所以等正式主機（nginx／IIS／Azure）確定後再做（docs/architecture-decisions.md）。
- **nginx：** 請 \`include\` 在 \`server {}\` 這一層。\`add_header\` 在子 \`location\` 出現就不繼承上層，所以產生的每個 \`location\` 都重列了安全標頭；你自己的 \`location\` 若有 \`add_header\` 也要補。若站台已有同名的 \`location ^~ /assets/\`，\`nginx -t\` 會報重複，請合併。
- **Netlify／Cloudflare Pages：** 只列跟平台預設不同的路徑（平台預設本來就是每次驗證）；規則彼此不重疊，因為同一標頭被多條規則命中時值會被逗號合併。
- **IIS：** \`<clientCache>\` 不能依副檔名設，只能整站一個預設、再用 \`<location path>\` 依資料夾覆寫。\`pagefind.*.pf_meta\` 檔名每次建置都變、沒辦法用資料夾指定，所以落在預設（每次驗證，沒變回 304），只差一次往返：

\`\`\`xml
${renderIisCache()}
\`\`\`

驗證（每一類各挑一個檔）：

\`\`\`bash
for p in / /v1/index.json /assets/styles/base.css /pagefind/pagefind-entry.json; do echo "$p"; curl -sI "https://<網域>$p" | grep -i '^cache-control'; done
\`\`\`

## 雜湊首次出現頁面（除錯用）

${Object.entries(info.firstSeen).map(([h, f]) => `- \`${h}\` ← ${f}`).join('\n')}
`;
}

/** 掃 dist 並寫出 dist/headers/*；回傳 { headers, info } */
export function emitHeaders(dist, write) {
  const info = collectInlineHashes(dist);
  const headers = securityHeaders({ hashes: info.hashes });
  // 第六十三輪：remove 與 headers 同層（tests/round23-security.test.mjs 讀 j.headers[...]，形狀不變，只多一個鍵）；第七十二輪再多 cache（快取規則）
  write('headers/headers.json', JSON.stringify({ generatedAt: new Date().toISOString(), mode: config.mode, inlineScripts: info.count, headers, remove: REMOVE_HEADERS, cache: CACHE_RULES }, null, 2) + '\n');
  write('headers/nginx.conf', renderNginx(headers));
  write('headers/web.config.headers.xml', renderWebConfig(headers));
  write('headers/_headers', renderNetlify(headers));
  write('headers/README.md', renderReadme(headers, info));
  return { headers, info };
}
