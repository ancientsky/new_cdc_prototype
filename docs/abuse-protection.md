# 防自動化濫用：速率限制、Bot 防護、探測偵測與告警

> 第六十三輪（2026-10-25），回應 Issue #140「防 AI 自動化攻擊探測」。讀者：資訊室（WAF、收件系統、SOC）、維護本 repo 的同事。
> 相關：[deploy.md](deploy.md) §10.4（security.txt 與通報管道）、§11（電子報）、§13（個資表單）、§14（寫入閘道）、§31（速率限制設定）；[a11y.md](a11y.md)（WCAG 2.2 AA）。

## 1. 威脅：AI 代理便宜、平行、會串連

ARTEX 一類的 AI 自動化滲透工具是「多個 LLM 代理分工」：一個列舉網址與端點、一個讀回應猜後端技術、一個試已知漏洞、一個把小發現串成攻擊鏈。和傳統掃描器相比，差別不在單一技巧，而在：

- **便宜又不睡覺**：24 小時、平行地打，成本幾乎只有 API 費用；
- **會讀回應**：錯誤訊息裡的版本號、堆疊、檔案路徑、框架名稱，都會被拿去決定下一步；
- **會偽裝**：User-Agent 寫成一般瀏覽器、放慢速度避開門檻、換 IP；
- **會填表單**：讀得懂欄位標籤，蜜罐欄位單獨已擋不住。

所以防線要做到：**第一個 429 越早、越便宜越好；錯誤訊息不給線索；偵測規則看行為（爆量、特徵路徑），不只看 UA。**

## 2. 靜態網站本身暴露了什麼

幾乎沒有動態的東西。公開站是建置好的 HTML、JS、CSS 與 JSON 檔：`v1/*.json` 是**檔案**，不是 API，伺服器不跑程式、不查資料庫。所以：

- 靜態檔的速率限制、Bot 防護、DDoS 是 **CDN／WAF 的設定**，repo 裡沒有程式碼可寫，也不需要；
- 打到靜態站的探測（`/.env`、`/wp-login.php`…）一定是 404，本身沒有風險，但它是**有人在找弱點的證據**——要記錄、要告警（§5）；
- 真正要守的是下面幾支**動態端點**，以及「不應該從網際網路連得到」的後台與寫入閘道。

## 3. 動態端點一覽

| 端點 | 誰負責（正式環境） | 速率限制 | 反自動化 | 本體上限 | 錯誤回應 |
| --- | --- | --- | --- | --- | --- |
| 寫入閘道 `/api/gateway/*`（後台） | 資訊室（機關內網／VPN；不對外） | 每 IP 120／分（含 `/health`）；登入與認證失敗每 IP 10／分；每帳號寫入 60／分（本 repo 已實作，§31） | AD／SSO 登入＋同源檢查＋CSRF token；不需 CAPTCHA（不對外） | 512 KB；附件 24 MB；國際疫情匯入 2 MB | `{error, message}`；500 只回白話訊息 |
| 個資表單（線上報名、署長信箱） | 資訊室／人事室／秘書室的收件系統 | 每來源 5／分＋每 email 限流（要求，deploy.md §13.4） | **無障礙**的隱形挑戰或工作量證明（要求，§13.4） | 由收件系統定（建議沒有附件 ≤ 64 KB） | `{ok:false, message}`；429／413（§13.2） |
| 問答紀錄信標 `POST /api/ask-log` | 資訊室的收件端點 | 每 IP 30／分（模擬後端已實作） | 不需（匿名、只收白名單欄位、伺服器端再遮蔽） | 2 KB | `{error}` 代碼 |
| 國際疫情推送 `POST /api/intl-epidemic` | 資訊室（只給疫情中心系統） | 每 IP 30／分，**在權杖檢查之前**（已實作） | Bearer 權杖；建議來源 IP 允許清單 | 2 MB | `{error, message}` |
| 電子報 `/api/subscriptions*` | 公關室委外或資訊室的寄信服務 | 每 IP 5／分（模擬後端已實作；退訂不限）＋每信箱 10 分鐘 3 次 | 蜜罐＋確認信（double opt-in）；正式版建議加隱形挑戰 | 8 KB | `{error, retryAfter?}` |

**共同的錯誤契約：** 錯誤本體只有 `error`（機器看的代碼）與 `message`（人看的白話）、必要時 `fields`／`retryAfter`。**不帶**堆疊、伺服器或框架版本、檔案路徑、SQL 訊息、內部主機名稱；`Server`、`X-Powered-By` 標頭拿掉或不含版本。未預期的錯誤一律 500＋通用訊息，細節只進伺服器 log。429 的訊息也不說門檻（不給調速度的線索）。`tests/round63-rate-limit.test.mjs` 驗閘道的 500 不洩漏路徑。

## 4. 誰擋什麼：程式裡做了什麼、WAF 與收件系統要做什麼

### 4.1 本原型已在程式裡做到（第六十三輪）

- `scripts/lib/rate-limit.mjs`：共用的限流（滑動記錄、記憶體有上限、不會被灌假 key 重設）與 `clientKey()`（只在連線來自信任的代理時採信 `X-Forwarded-For`）。
- 寫入閘道三個範圍的限流、`rate_limited` 稽核事件（deploy.md §31）。
- 電子報、問答紀錄、國際疫情推送三個模擬後端改用同一套，數字如上表。
- 前端：表單收到 429 顯示「送出太頻繁，請稍候再試」（`form.err.rate`），不當成一般失敗。
- 探測偵測：`scripts/analyze-404-log.mjs` 的「自動化探測跡象」一節，特徵清單在 `scripts/lib/probe-signatures.mjs`（§5）。

這些是**最後一道**。單機記憶體的計數擋不住分散在上千個 IP 的攻擊，也不該讓攻擊流量一路打到應用程式。

### 4.2 資訊室的 WAF 要做到（要求）

入口用 Azure Front Door Premium WAF 或 Taiwan North 的 Application Gateway WAF v2，**選哪一個是 Issue #130 待決的事，本文不決定**；兩者都要做到：

| 項目 | 要求 |
| --- | --- |
| 受管規則集 | 開啟（Front Door：Microsoft Default Rule Set 2.x；Application Gateway：OWASP CRS 3.2 以上或 DRS 2.x），**偵測模式試跑一至兩週**、排除誤判後改**防止模式** |
| Bot 防護 | 開啟 Bot Manager 規則集（已知惡意 Bot 封鎖、已知良性爬蟲放行）；注意 AI 代理多半被歸為「未知」，所以仍要靠下面的速率限制 |
| 速率限制規則 | 與應用程式同樣的數字，WAF 先擋：`/api/gateway/*` 每 IP 120／分、其中 `/login*` 每 IP 10／分；表單端點每 IP 5／分；`/api/ask-log`、`/api/intl-epidemic` 每 IP 30／分；靜態站整體每 IP 每分鐘數百次（例 600，依尖峰實測調整） |
| 不對外的路徑 | `/admin/`、`/api/gateway/` **在對外入口直接封鎖**（只允許機關內網或 VPN 網段）；推送端點只允許疫情中心系統的來源 IP |
| 地理封鎖 | **不需要**：疾管署服務的對象包含海外國人、旅客與移工，地理封鎖誤傷大、而攻擊者換個雲端區域就繞過 |
| 自訂規則 | 探測特徵（§5.1 清單）一律封鎖或 403；可疑 UA 只記錄不封鎖（開放資料使用者也用 curl、python） |
| 記錄 | WAF 與存取紀錄送 Log Analytics（保存依機關資安規定），接 SOC（Sentinel 或機關既有 SOC），§5 的告警規則在那裡跑 |
| 應用程式看到的 IP | WAF／代理要**覆寫或附加** `X-Forwarded-For`；應用程式端把 WAF 的位址設進 `GATEWAY_TRUSTED_PROXIES`（deploy.md §31.2） |

### 4.3 收件系統要做到（要求）

見 deploy.md §13.4：**無障礙**的反自動化（不得用圖形或扭曲文字 CAPTCHA，WCAG 2.2 的 3.3.8 不允許認知測驗；用隱形挑戰或工作量證明，並有替代管道）、每來源與每 email 限流、本體上限、**欄位白名單（未知欄位整筆拒絕）**、通用錯誤訊息、被擋請求的紀錄送 SOC。這些都不在本 repo 實作，是給資訊室驗收收件系統用的清單。

## 5. 偵測與告警

### 5.1 特徵清單是資料，放在 repo 裡

`scripts/lib/probe-signatures.mjs` 的 `PROBE_SIGNATURES`（每筆 `{ id, re, label }`）：`.env`、`.git/`、`.svn/`、`wp-login.php`、`wp-admin`、`xmlrpc.php`、`phpmyadmin`、`.aws/credentials`、`server-status`、`actuator`、`cgi-bin/`、`vendor/phpunit`、目錄穿越（`../`、`..%2f`、`%2e%2e`）、`/etc/passwd`、`.DS_Store`、`web.config`、根目錄備份檔（`.bak`／`.sql`／`.zip`／`.tar.gz`）、`swagger`／`api-docs`（本站正式的 `/openapi.json` 除外）。`/admin/` 與 `/api/gateway/` 也在清單裡，但只在分析**對外入口**的 log 時算（`--public`）：內網 log 裡同事正常使用後台，不是攻擊。

`SUSPICIOUS_UAS`：`python-requests`、`aiohttp`、`Go-http-client`、`curl/`、`libwww`、`sqlmap`、`nikto`、`nuclei`、`zgrab`、`masscan`、`httpx`、`dirbuster`、`gobuster`、`ffuf`，以及空白 UA。**UA 是弱訊號**：AI 代理常直接用一般 HTTP 程式庫，也能把 UA 改成任何瀏覽器字串；而開放資料的正當使用者也用 curl 與 python。所以程式庫 UA 單獨不告警，明確的掃描器（sqlmap、nuclei…）才加重。**強訊號是爆量與特徵路徑。**

為什麼放 repo：SOC 的規則與開發者的工具要看**同一份清單**。改了網址結構的 PR 會碰到這份清單與它的測試（`tests/round63-probes.test.mjs`，含「本站正當路徑不得命中」）；下面的 KQL 路徑清單從這裡抄，改清單時一併改。

### 5.2 用 log 檢查：`analyze-404-log.mjs`

```sh
node scripts/analyze-404-log.mjs access.log --public            # Markdown：原本的 404 三分類＋「自動化探測跡象」
node scripts/analyze-404-log.mjs access.log --public --json     # JSON：多一個 probes
node scripts/analyze-404-log.mjs access.log --burst 20 --window 60 --trusted-proxy 10.0.0.0/8
```

支援 nginx combined（行尾可多一個 `"$http_x_forwarded_for"` 欄位）與 IIS W3C（`c-ip`，可加自訂欄位 `X-Forwarded-For`）。log 的來源 IP 若是 CDN／反向代理，用 `--trusted-proxy` 讓工具改看 `X-Forwarded-For` 的最後一個非代理位址（與應用程式同一條規則）。

每個來源的分數：60 秒內 404 達 30 次 +3、打到特徵路徑 +3、特徵路徑回 2xx 再 +3（建議**立即通報**）、不重複 404 路徑 ≥ 20 +2、401／403 ≥ 10 +1、掃描器 UA +3、程式庫或空白 UA +1；≥ 3 分列出。報表每列附建議：**封鎖**（WAF 封鎖該來源，先確認不是機關委託的弱點掃描）、**觀察**、或**立即通報資訊室**。夾具 `tests/fixtures/access-probe.log` 是範例（文件用 IP），正常民眾與 python 抓開放資料的都不會被列出。

### 5.3 三條告警規則（給 SOC／Log Analytics）

欄位名稱依診斷設定而不同（`AzureDiagnostics` 或資源專屬資料表）。下面以 Front Door 的 `AzureDiagnostics`（`Category == "FrontDoorAccessLog"`）與 Application Gateway 的 `AGWAccessLogs` 為例；**上線前請資訊室以實際的資料表結構校正欄位名，並先在偵測模式跑一週調門檻。**

**規則 1：同一來源 5 分鐘內大量 404（路徑列舉）。** 白話：一個 IP 在 5 分鐘內撞了 100 次以上 404，或撞了 50 個以上不同的不存在路徑 ⇒ 中度告警，自動在 WAF 加 24 小時速率限制，值班人員確認是不是已知掃描。

```kusto
AzureDiagnostics
| where Category == "FrontDoorAccessLog" and httpStatusCode_s == "404"
| summarize hits = count(), paths = dcount(requestUri_s), sample = take_any(requestUri_s), ua = take_any(userAgent_s)
    by clientIp_s, bin(TimeGenerated, 5m)
| where hits >= 100 or paths >= 50
| order by hits desc
```

**規則 2：打到探測特徵路徑。** 白話：任何請求打到 §5.1 的特徵路徑 ⇒ 記錄並計數；**同一來源一小時內 3 次以上、或任何一次回 2xx** ⇒ 高度告警（回 2xx 代表可能真的有檔案外洩，立刻通報）。

```kusto
let sig = @"(?i)(/\.env|/\.git/|/\.svn/|wp-login\.php|/wp-(admin|content|includes)/|/xmlrpc\.php|/phpmyadmin|/\.aws/|/server-(status|info)|/actuator|/cgi-bin/|/vendor/phpunit/|\.\./|\.\.%2f|%2e%2e|etc/passwd|/\.DS_Store|/web\.config|^/[^/?]*\.(bak|sql|zip|tar\.gz|7z)|/swagger|/api-docs|/admin/|/api/gateway/)";
AzureDiagnostics
| where Category == "FrontDoorAccessLog" and requestUri_s matches regex sig
| extend ok = toint(httpStatusCode_s) between (200 .. 299)
| summarize hits = count(), exposed = countif(ok), paths = make_set(requestUri_s, 10) by clientIp_s, bin(TimeGenerated, 1h)
| where hits >= 3 or exposed > 0
```

（`requestUri_s` 若是完整網址，請先 `parse_url()` 取路徑再比對；`/admin/`、`/api/gateway/` 在對外入口本來就該被封鎖，命中代表封鎖規則失效或有人在試。）

**規則 3：寫入閘道的 401／403 爆量。** 白話：同一來源 5 分鐘內對 `/api/gateway/` 收到 20 次以上 401／403（猜 session、偽造代理標頭、CSRF 失敗）⇒ 高度告警；同時看閘道稽核的 `rate_limited`（`scope: auth`）與 `auth`（`untrusted_proxy`）事件。

```kusto
AGWAccessLogs
| where RequestUri startswith "/api/gateway/" and HttpStatus in (401, 403, 429)
| summarize denied = countif(HttpStatus in (401, 403)), limited = countif(HttpStatus == 429), paths = make_set(RequestUri, 10)
    by ClientIp, bin(TimeGenerated, 5m)
| where denied >= 20 or limited > 0
```

閘道的稽核檔（`GATEWAY_AUDIT_FILE`，JSON Lines、雜湊鏈）建議由資訊室以 Azure Monitor Agent 收進自訂資料表，`action in ("rate_limited", "auth", "csrf-origin", "csrf-token")` 且 `result == "denied"` 的事件直接進 SOC。

### 5.4 接到事件處理流程

- **外部通報**：研究者或民眾依 `security.txt`（deploy.md §10.4）的 `Contact` 通報；告警與外部通報進同一個事件單。
- **分級**：規則 2 的「回 2xx」與「對外連得到 `/admin/`、`/api/gateway/`」＝資安事件，依機關資安事件通報流程（A 級機關的通報時限）處理；規則 1、3 先由值班確認，查不到是授權掃描就在 WAF 封鎖並記錄。
- **回頭改 repo**：發現新的探測樣式 ⇒ 開 PR 加進 `probe-signatures.mjs`（附測試），SOC 的規則照著改；這樣下一次分析 log 與 SOC 看的是同一份。

## 6. 教訓

- **速率限制的 key 必須是攻擊者選不了的東西**：信任代理加上的 IP、已登入的帳號。直接信任請求自帶的 `X-Forwarded-For`，等於讓攻擊者自己挑 key；記憶體滿了就「整個清空」，等於讓攻擊者一鍵重設所有人的計數（本輪修掉的就是這兩件事）。
- **第一個 429 應該來自最便宜的那一層**：WAF 先擋，應用程式在讀本體、查表、寄信之前再擋一次；最後才是業務規則（每信箱 3 次）。
- **偵測規則屬於 repo，而且寫成資料**：SOC 與開發者讀同一份清單，改網址的人會看到它，測試會守住「本站正當路徑不被誤判」。
- **錯誤訊息是給人看的，不是給代理看的**：白話、通用、不帶版本與路徑；AI 代理最擅長的就是從錯誤訊息推下一步。
