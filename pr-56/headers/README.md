# HTTP 安全標頭基準（自動產生）

建置日 2026-10-10；掃了 2664 頁，找到 10 段會執行的 inline script，CSP 的 `script-src` 已含其 sha256 雜湊。

## 怎麼套

| 環境 | 檔案 | 做法 |
| --- | --- | --- |
| nginx | `nginx.conf` | 在 `server {}` 內 `include /path/to/headers/nginx.conf;` |
| IIS | `web.config.headers.xml` | 把 `<httpProtocol>` 區塊合進站台 `web.config` 的 `<system.webServer>` |
| Netlify／Cloudflare Pages | `_headers` | 放到網站根目錄 |
| 其他 CDN | `headers.json` | 依表逐項設定 |

## 怎麼驗

部署後：`curl -sI https://<網域>/ | grep -iE 'content-security-policy|strict-transport|x-content-type|referrer-policy|permissions-policy'`，或用 https://securityheaders.com 。
瀏覽器 DevTools Console 若出現 `Refused to execute inline script`，代表有新的 inline script 沒進雜湊：重新建置、重新套本目錄的檔案即可（雜湊由建置掃描產生，不必手算）。

## 為什麼是這些值

- **CSP**：`default-src 'self'` 擋掉第三方腳本注入；inline script 用雜湊而不是 `'unsafe-inline'`；`'wasm-unsafe-eval'` 只為了全文搜尋（Pagefind）載入 WebAssembly，不開放 `eval()`；`frame-src` 只放疫苗地圖與 YouTube；`frame-ancestors 'self'` 防點擊劫持（現行官網是 `'self' *.cdc.gov.tw`，正式站換網域時依需要加子網域）；`connect-src` 多 `api.anthropic.com` 只因示範用 BYOK，正式站拿掉。
- **表單端點**（第三十輪）：`site.config.mjs` 的 `forms` 有設 post 端點時，該來源自動加進 `connect-src` 與 `form-action`（目前：無，全部表單為原型模擬）；個資表單系統換網域只要改設定重建。
- **HSTS** 一年含子網域；**nosniff**、**Referrer-Policy**、**Permissions-Policy** 為 OWASP Secure Headers 建議值。
- `style-src` 暫留 `'unsafe-inline'`：後台頁有少量 `style=""` 屬性；清掉後可改為 `'self'`。

## 雜湊首次出現頁面（除錯用）

- `'sha256-p5rAmtvaFNqn5qc5BKQjx1ph+itRW/4zVS+Xwuvucew='` ← 404.html
- `'sha256-6yctnoyIZjtZMDFyrBqkUA0M2WUaX+vg9uWGZ7u9ZqA='` ← 404.html
- `'sha256-e1uG94Iq45lN1B/Fkl7hV7SbzMpgvaNbcJSdI5x8aa0='` ← 404.html
- `'sha256-rQp4V1V7a9txrAZMmy8nF3b99eTeYScw0g1bvpYxNVY='` ← admin/import/index.html
- `'sha256-F55f8eDfkt0dmeP2PyrvD8sYxv7cqRkCcCrsPgSkjWI='` ← diseases/chikungunya/index.html
- `'sha256-tQYwR5VoNbhWTeY5vYc+k8jKYDP7hGXSGWtgLUl9xjQ='` ← en/legacy/index.html
- `'sha256-QAmLT4BQqbA3FJzsO8fm/Wzp90aaxAuMcvaE4NPMcIg='` ← en/pending/index.html
- `'sha256-+Ld0EbaxEGkXdPuOEcVakyv04txCizMak86upuaa9Yg='` ← en/pro/index.html
- `'sha256-JLWux06iTjsWwlLMjuohZSOhfeRppNcP2jpuaEMgT3E='` ← en/tasks/travel/index.html
- `'sha256-IAvs31ertpjo0iZNAxsFV0ksFUH1LueHHCg4l/x7iAY='` ← en/travel/index.html
