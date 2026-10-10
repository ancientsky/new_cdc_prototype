// 第二十三輪（ARCHITECTURE 26.2）：HTTP 安全標頭基準，由建置輸出伺服器設定檔 → dist/headers/
//
// 為什麼在建置時產生：靜態站本身回不了標頭，標頭要由伺服器／CDN 加；但 CSP 的 inline script 雜湊只有建置端知道
//（每個版面模板都有一小段 inline script，例如 layout 的檢視模式切換）。把「掃 dist 裡所有會執行的 inline script → 算 sha256」
// 交給建置，資訊室部署時直接拿 dist/headers/ 的檔案套，就不會因為某一輪多了一段 inline script 而 CSP 擋掉功能。
//
// 輸出：
//   dist/headers/headers.json          — 標頭名稱 → 值（機讀正本；CI 與測試讀這份）
//   dist/headers/nginx.conf            — nginx `add_header` 片段（include 進 server{}）
//   dist/headers/web.config.headers.xml — IIS <httpProtocol><customHeaders>
//   dist/headers/_headers              — Netlify／Cloudflare Pages 格式
//   dist/headers/README.md             — 怎麼套、怎麼驗、為什麼
//
// CSP 的來源白名單從程式碼事實推出：frame-src 只有 vaxmap 與 YouTube（影片用 youtube-nocookie 嵌入）；connect-src 多 api.anthropic.com
// 只因示範用 BYOK（正式站拿掉 BYOK 就拿掉）；img-src 允許 data:（favicon 與預覽佔位圖是 data URI）。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../../site.config.mjs';

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

/** 標頭基準（值）。opts.hashes = inline script 雜湊；opts.vaxmapOrigin、opts.extraFrame 可覆寫。 */
export function securityHeaders({ hashes = [], llmOrigin = 'https://api.anthropic.com', vaxmapOrigin = new URL(config.vaxmapUrl).origin, frameAncestors = "'self'" } = {}) {
  const csp = [
    "default-src 'self'",
    `script-src 'self' ${hashes.join(' ')}`.trim(),
    "style-src 'self' 'unsafe-inline'", // 後台少量 style="" 屬性；正式站可改成 nonce／class 後拿掉 'unsafe-inline'（README 有清單）
    "img-src 'self' data: https://i.ytimg.com",
    "font-src 'self'",
    `connect-src 'self' ${llmOrigin}`.trim(),
    `frame-src ${vaxmapOrigin} https://www.youtube-nocookie.com https://www.youtube.com`,
    `frame-ancestors ${frameAncestors}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
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

export function renderNginx(h) {
  return [
    '# 由 scripts/lib/emit-headers.mjs 自動產生（docs/deploy.md §10）。include 進 server{} 或 location / {}；請勿手改，改程式重建。',
    '# 注意：nginx 的 add_header 在子 location 另有 add_header 時會整組不繼承，請統一放在同一層。',
    ...Object.entries(h).map(([k, v]) => `add_header ${k} "${v.replace(/"/g, '\\"')}" always;`),
    '',
  ].join('\n');
}

export function renderWebConfig(h) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!-- 由 scripts/lib/emit-headers.mjs 自動產生（docs/deploy.md §10）。放進 web.config 的 <system.webServer> 內；請勿手改。 -->',
    '<configuration><system.webServer><httpProtocol><customHeaders>',
    ...Object.entries(h).map(([k, v]) => `  <remove name="${esc(k)}" /><add name="${esc(k)}" value="${esc(v)}" />`),
    '</customHeaders></httpProtocol></system.webServer></configuration>',
    '',
  ].join('\n');
}

export function renderNetlify(h) {
  return ['# 由 scripts/lib/emit-headers.mjs 自動產生（Netlify／Cloudflare Pages 格式）', '/*', ...Object.entries(h).map(([k, v]) => `  ${k}: ${v}`), ''].join('\n');
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

- **CSP**：\`default-src 'self'\` 擋掉第三方腳本注入；inline script 用雜湊而不是 \`'unsafe-inline'\`；\`frame-src\` 只放疫苗地圖與 YouTube；\`frame-ancestors 'self'\` 防點擊劫持（現行官網是 \`'self' *.cdc.gov.tw\`，正式站換網域時依需要加子網域）；\`connect-src\` 多 \`api.anthropic.com\` 只因示範用 BYOK，正式站拿掉。
- **HSTS** 一年含子網域；**nosniff**、**Referrer-Policy**、**Permissions-Policy** 為 OWASP Secure Headers 建議值。
- \`style-src\` 暫留 \`'unsafe-inline'\`：後台頁有少量 \`style=""\` 屬性；清掉後可改為 \`'self'\`。

## 雜湊首次出現頁面（除錯用）

${Object.entries(info.firstSeen).map(([h, f]) => `- \`${h}\` ← ${f}`).join('\n')}
`;
}

/** 掃 dist 並寫出 dist/headers/*；回傳 { headers, info } */
export function emitHeaders(dist, write) {
  const info = collectInlineHashes(dist);
  const headers = securityHeaders({ hashes: info.hashes });
  write('headers/headers.json', JSON.stringify({ generatedAt: new Date().toISOString(), mode: config.mode, inlineScripts: info.count, headers }, null, 2) + '\n');
  write('headers/nginx.conf', renderNginx(headers));
  write('headers/web.config.headers.xml', renderWebConfig(headers));
  write('headers/_headers', renderNetlify(headers));
  write('headers/README.md', renderReadme(headers, info));
  return { headers, info };
}
