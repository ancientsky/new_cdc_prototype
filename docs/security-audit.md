# 全站安全稽核（第七十三輪，2026-11-12）

> 給誰看：資訊室（主機、反向代理、GitHub／GitLab 設定）、資安窗口、維護本 repo 的工程師、OASIS（AI推動辦公室）。
> 性質：**白箱稽核**。稽核者讀得到全部原始碼與文件，也在本機實際啟動網站與寫入閘道去打。這和外部滲透測試（黑箱）互補，不取代 [security-testing.md](security-testing.md) §3 的第三方滲透測試。
> 相關：[attack-surface.md](attack-surface.md)（暴露面）、[abuse-protection.md](abuse-protection.md)（限流）、[security-testing.md](security-testing.md)（滲透測試與 DAST）、[content-html-safety.md](content-html-safety.md)（本輪新增：內容 HTML 淨化）、[deploy.md](deploy.md) §9.3–9.4、§14.10、§35。

## 1. 結論先講

- **找到 1 個嚴重、4 個高、8 個中、約 20 個低與資訊級的問題。** 嚴重與高的 5 個都在本輪修掉，中的 8 個也全部修掉；低與資訊級的修掉大部分，其餘列在 §5 由負責人追蹤。
- **最嚴重的一個是本機預覽伺服器 `scripts/serve.mjs` 的路徑穿越**：一個 `..%2f` 就能讀到主機上任何檔案，包括 `/proc/self/environ` 裡的全部祕密（推送權杖、GitLab 權杖、CSRF 與工作階段金鑰）。它是「開發用」伺服器，但 deploy.md §14 把它列為閘道主機的候選，DAST 也拿它當掃描目標，所以當真的漏洞處理。
- **第二嚴重的是寫入閘道的跨單位接管**：任何單位的承辦人把別單位已上線的內容改成自己單位送審，再由自己單位的科長核准，就能覆寫別單位的頁面。四眼原則、角色、單位檢查都在，漏的是「送來的 `owner` 欄位被當成權威」。
- **基礎工程是紮實的**，這點要說清楚，否則清單看起來很嚇人：模板預設跳脫、CSP 用 hash 不用 `unsafe-inline`、CSRF 用 HMAC 綁帳號、Origin 與 Content-Type 檢查、JWT 拒絕 `none` 與對稱演算法、Google 登入有 PKCE 與 nonce、Actions 全部釘 SHA、fork PR 拿不到祕密、個資掃描、產物白名單。本輪找到的問題多半是「防線設計對了，某一處實作漏了一個案例」。
- **三件事要資訊室或擁有者在 GitHub／主機上動手，程式改不了**（§5）：把兩個部署祕密搬到只綁 main 的 Environment、規則集對程式路徑要求他人審核、檢討部署金鑰的規則集繞過。

## 2. 怎麼查的

| 面向 | 方法 | 範圍 |
| --- | --- | --- |
| 寫入閘道 | 人工讀 `scripts/lib/gateway/**` 全部程式；用兩個不同單位的示範帳號寫劇本直接呼叫工作流程；啟動 `serve.mjs` 以 curl 打 HTTP 層（CSRF、Origin、Host、Content-Type、方法） | 認人（dev／header／oidc／google）、JWT 驗章、工作流程授權、路徑組成、Git 寫入、通知、稽核鏈 |
| CI 與供應鏈 | 讀 5 個 workflow、規則集、Dependabot 設定、lane 邏輯；`git ls-remote` 核對 8 個 action 的釘定 SHA；`npm audit`；掃 lockfile 的來源與 install script；以 GitHub API 讀線上規則集 | fork／同 repo PR 的權限、expression injection、artifact 投毒、祕密暴露、自動合併車道能否被強迫 |
| 瀏覽器端 | 讀模板、渲染器、Markdown 淨化器、全部 `src/client/**`；實跑淨化器餵酬載；把酬載放進內容複本實際建站看 `dist/` | DOM XSS sink、淨化器繞過、open redirect、postMessage、iframe sandbox、CSP、BYOK 金鑰、模擬 SSO 工作階段、prototype pollution、ReDoS |
| 模擬後端與伺服器函式庫 | 讀 `serve.mjs` 與各 mock、限流、feed 解析、個資掃描、產物稽核；啟動伺服器用 curl 與 node 腳本重現每一項 | 路徑穿越、資源耗盡、Host 污染、IP 偽造、記錄注入、token 可預測性、CSV 公式注入、公開 JSON 內容 |

每一項發現都**實際重現過**才列入；只讀程式推論、沒重現的，在表裡註明。原始碼與文件都在公開 repo，所以稽核沒有「攻擊者不知道路徑」這種假設。

## 3. 發現清單

嚴重度用 [security-testing.md](security-testing.md) §6 的四級。「狀態」欄：**已修**＝本輪 PR 改了程式並有回歸測試；**設定**＝要在 GitHub 或主機上動手；**追蹤**＝列入 §5 待辦；**接受**＝寫下理由不改。

### 3.1 嚴重

| # | 問題 | 位置 | 重現 | 修法 | 狀態 |
| --- | --- | --- | --- | --- | --- |
| S1 | **靜態檔伺服器路徑穿越。** 先 `decodeURIComponent` 再 `path.join(DIST, url)`，沒檢查結果還在 `dist/` 底下。URL 解析器不會把 `%2f` 當成斜線正規化，解碼之後它卻是斜線。 | `scripts/serve.mjs` | `curl --path-as-is http://host/..%2fpackage.json` → 200；`/..%2f..%2f..%2fproc%2fself%2fenviron` → 200，內容含 `INTL_FEED_TOKEN` 等環境變數 | 解碼後 `path.resolve`，要求結果等於 `dist/` 或在其底下；拒絕 `\0`；`realpath` 後再檢查一次（擋 symlink）；只允許 GET／HEAD | 已修（deploy.md §35） |

### 3.2 高

| # | 問題 | 位置 | 重現 | 修法 | 狀態 |
| --- | --- | --- | --- | --- | --- |
| H1 | **跨單位內容接管。** `writeVersion()` 用送來的 `item.owner` 判斷「這是不是你單位的內容」，沒比對 main 上現行版的 owner。 | `scripts/lib/gateway/workflow.mjs` | 慢性組承辦人把急性組的登革熱 Q&A 以 `owner: unit.chronic-infectious` 送審 → 一般車道 → 慢性組科長核准 → main 上的檔被覆寫（劇本見 `tests/round73-gateway-owner.test.mjs`） | 內容已在 main 上時，以 **main 上的 owner** 做授權；要把 owner 改到別單位，只有原單位的編輯或跨單位角色可以，而且記進歷程與稽核（`owner-change`）；審核人也要屬於原單位或車道審核單位 | 已修（deploy.md §14） |
| H2 | **Markdown 淨化器是正規表示式黑名單，可繞過。** `javascript:` 用 HTML 實體寫（`jav&#x61;script:`）比對不到；`<meta http-equiv=refresh>`、`<base>`、`<form action=外部>`、沒有閉合的 `<iframe srcdoc>` 都留在輸出裡。 | `scripts/lib/markdown.mjs` | `md('<a href="jav&#x61;script:alert(1)">x</a>')` 原樣輸出；放進疾病頁 `blocks[].markdown` 建站後連結可點 | 改用**白名單**淨化器（標籤、屬性、網址協定各一份白名單），黑名單只能擋想得到的寫法 | 已修（[content-html-safety.md](content-html-safety.md)） |
| H3 | **連結欄位沒有協定限制，模板直接輸出。** `materials[].url`、`resources[].url`、`document.url` 等 schema 只要求字串；模板 `href="${url}"` 只做 HTML 跳脫，不看協定。 | `schemas/*.json`、`src/templates/**` | 把 `materials[0].url` 設成 `javascript:…` 建站 → `dist/diseases/chikungunya/index.html` 出現可點的 `javascript:` 連結 | schema 加 `pattern`（建置期擋）＋模板層 `safeHref()`（輸出期擋），兩層 | 已修 |
| H4 | **`/api/dev/*` 永遠開著，「只限本機」在同機反向代理後面失效。** `/api/dev/outbox` 列出全部模擬信件，裡面有每位訂閱者的信箱與 confirm／manage token；`/api/dev/ask-log/report` 把 90 天日檔讀進記憶體。 | `scripts/serve.mjs`、`subscribe-mock.mjs`、`ask-log-mock.mjs` | 模擬「代理在同一台」（socket 是 127.0.0.1、帶 `X-Forwarded-For`）→ 兩個端點都 200 | 有任何正式環境跡象（`SITE_MODE=production`、`GATEWAY_TRUSTED_PROXIES`、`PUBLIC_ORIGIN`）就關；loopback 判斷加上「沒有代理標頭」；閘道的 `dev` 認人也一樣 | 已修（deploy.md §35） |
| H5 | **一個請求讓伺服器當掉。** `createReadStream` 沒掛 `error`，讀到 EIO／EACCES 或重建 dist 時的 ENOENT 競態，整個 process（含寫入閘道）結束。 | `scripts/serve.mjs` | 配合 S1 請求 `/proc/self/mem` → process 退出 | 掛 error handler 回 404／500 | 已修 |

### 3.3 中

| # | 問題 | 位置 | 修法 | 狀態 |
| --- | --- | --- | --- | --- |
| M1 | **`ipMatcher` 接受 `/33` 以上。** JS 位移量取 mod 32，`/33` 變成信任 0.0.0.0–127.255.255.255。這份清單同時是閘道 `header` 認人模式「信任誰送來的身分標頭」的清單，打錯一個字等於認證被繞過。另外位元組 >255 不擋、IPv6 CIDR 默默變成精確比對。 | `scripts/lib/rate-limit.mjs` | 用 `net.isIP` 驗證，前綴超界、位元組超界、`0.0.0.0/0` 一律啟動失敗；支援 IPv6 CIDR；位址正規化 | 已修 |
| M2 | **`clientKey` 在整串 XFF 都是信任網段時取最左邊**，而最左邊是用戶端自己寫的。信任 `10.0.0.0/8` 這種寫法時，內網任何一台機器每個請求換一個 10.x 就能繞過限流，也能嫁禍同事的 IP。 | `scripts/lib/rate-limit.mjs` | 從右往左找第一個不信任的 hop；全部信任就用 socket 位址；解析不出來的 hop 就停 | 已修 |
| M3 | **Host 標頭污染。** 沒設 `PUBLIC_ORIGIN` 時，電子報確認信與閘道通知信的連結用請求的 Host。攻擊者可讓機關寄出帶釣魚網址的「官方信」，裡面是真的 token。 | `subscribe-mock.mjs`、`gateway/index.mjs` | 非 dev 模式沒設 `PUBLIC_ORIGIN` 就不啟動；dev 模式只接受 localhost 類 Host | 已修 |
| M4 | **國際疫情 feed 的額外欄位原樣進公開 JSON，也跳過個資掃描。** `areas[]`、`references[]` 整個物件複製，schema 沒有 `additionalProperties:false`。 | `scripts/lib/intl-epidemic.mjs`、`schemas/intl-epidemic-feed.json` | schema 關閉額外欄位；`toRow` 白名單複製；`references[].title` 也掃個資 | 已修 |
| M5 | **CSV 解析 O(欄×列) 沒有上限。** 131 KB 卡住事件迴圈 5 秒，2 MB 上限內可卡數小時，連帶卡住寫入閘道（需權杖或匯入權限）。 | `src/client/intl-epidemic-rules.js` | 欄數、列數、單欄長度上限；表頭只收已知欄名 | 已修 |
| M6 | **答案引擎幾個函式對特製長字串呈二次方成長**（32k 字約 6 秒）。正式路徑已先截到 500 字，但函式是匯出的，別的呼叫點沒截就會卡。 | `src/client/answer/text.js` | 函式入口統一加長度上限 | 已修 |
| M7 | **自動合併車道的作者名單目前只有 repo 擁有者**，`reviewerAccounts` 也全指向同一人。邏輯正確（名單外的人自動降為一般車道），但名單內的人送惡意內容 0 人審即上線，只靠 schema 與個資掃描把關。 | `content/governance/lanes.json` | 原型示範可接受；正式環境改成 `team:<AD 群組>`，並確實執行上線後複核。H2／H3 修掉後，「夾帶 HTML」這條路也關了 | 接受（原型）／設定（正式） |
| M8 | **同 repo 分支的 PR 跑的是自己分支上的 workflow，而且帶 repo 層級祕密。** 對 fork 沒事；對已有寫入權的帳號，可在分支裡改 workflow 把 `SNAPSHOT_DEPLOY_KEY`、`INTL_FEED_TOKEN` 印出來。`round40-ci-isolation` 的靜態檢查只對 main 上的 YAML 有效。 | `.github/workflows/pages.yml`、`content-pr.yml` | 用這兩個祕密的 job 宣告 `environment: production`，祕密搬到只允許 main 部署的 Environment（要在 GitHub 設定；deploy.md §9.3） | 程式已改，設定待擁有者 |

### 3.4 低與資訊

| # | 問題 | 位置 | 狀態 |
| --- | --- | --- | --- |
| L1 | main 規則集 `required_approving_review_count: 0`、不要求 code owner；唯一必要檢查 `test` 由 PR 分支程式產生、也沒綁 integration id。有寫入權者可自審自併程式變更。「一般車道需 1 位核准」只有 lane bot 在執行，不是原生合併條件。 | 線上規則集、`.github/rulesets/main.json` | 設定（deploy.md §9.4：對程式路徑開 code owner review；`main.json` 的必要檢查已綁 Actions integration id，重新匯入才生效） |
| L2 | 線上規則集的繞過名單有「所有部署金鑰 always」；本地 `main.json` 是空的，兩邊不一致。配合 M8 構成「偷金鑰→繞過規則集寫 main」。 | 線上規則集 | 設定（確認只有一把寫入金鑰、定期輪替、評估改 GitHub App） |
| L3 | 確認 token 用過不失效、過期也不失效，而且每次都回 `manageToken`。轉寄過的確認信永遠能換到管理權。 | `src/client/subscribe-service.js` | 已修 |
| L4 | 限流在 IPv6 下幾乎無效（一個 /64 有 2⁶⁴ 個 key）；位址沒正規化；FIFO 淘汰可被灌 key 重設。 | `scripts/lib/rate-limit.mjs` | 部分已修（/64 為 key、正規化）；FIFO 淘汰策略未改，追蹤 |
| L5 | 電子報狀態機的每 IP 節流用原始 socket IP，代理後面全站共用 10 次／10 分鐘。 | `subscribe-mock.mjs` | 已修 |
| L6 | 推送端點每次 401 都寫稽核，可灌大稽核檔，與 deploy.md §31.3 原則不一致。 | `intl-feed-api.mjs` | 已修 |
| L7 | `INTL_FEED_TOKEN` 既是收推送的密碼也是拉 feed 時送出的 Bearer；CLI 對任何網址（含 http://）都附上；抓取沒有大小上限。 | `fetch-data.mjs`、`scripts/intl-epidemic.mjs` | 追蹤（拆成兩把；只對 `INTL_FEED_URL` 的 https 主機送權杖） |
| L8 | ask-log 的 `page` 欄位沒遮蔽個資、沒去控制字元。 | `ask-log-mock.mjs` | 已修 |
| L9 | `audit-dist` 漏網：規則區分大小寫（IIS／Azure Blob 不分）、`docs/**` 只比對根目錄、symlink 不檢查、inline source map 不檢查。 | `scripts/lib/dist-profile.mjs` | 已修 |
| L10 | CSV 匯出沒防公式注入（`=`、`+`、`-`、`@` 開頭）。 | `admin/common.js`、`vaxschedule.js` | 已修 |
| L11 | `v1/governance/whitelist.json` 等治理輸出用 `site.all`，draft／review 內容的 id、標題、owner 會出現在公開 JSON（目前 content/ 沒有草稿，尚未外洩）。 | `scripts/lib/emit-api.mjs` | 已修 |
| L12 | SVG 資產掃描漏 `<foreignObject>` 內嵌 XHTML、外部 `<use href>`。目前 SVG 都以 `<img>` 引用，腳本不執行。 | `scripts/lib/assets.mjs` | 已修 |
| L13 | 職缺報名表單草稿（含個資）存 localStorage，公用電腦會殘留。 | `src/client/careers-apply.js` | 已修（改 sessionStorage＋清除按鈕） |
| L14 | `npm audit`：正式相依 1 個 moderate（`fast-uri`，ajv 遞移；建置期用）；開發相依另 4 個（`minimatch` ReDoS，eslint 遞移）。皆建置鏈，不對外執行。 | `package-lock.json` | `fast-uri` 已修；eslint 等 Dependabot |
| L15 | 嵌入地圖 iframe 的 `sandbox` 在原型同源下等於沒有（程式註解已自承）；正式站地圖搬到專用子網域後才生效。 | `_denguemap.mjs` | 接受（原型）／追蹤（正式） |
| L16 | 模擬 SSO 工作階段存 localStorage，前端可偽造角色。**這是原型刻意的設計**：閘道 `dev` 認人只收本機連線（本輪再加上「沒有代理標頭」），GitHub Pages 沒有後端，偽造沒有寫入效果；正式環境必須 `GATEWAY_AUTH=header|oidc|google`。 | `src/client/admin/login.js` | 接受；deploy.md §14 已強調 |
| L17 | 閘道 CSRF token 是 HMAC(登入方式｜帳號)，沒有有效期、不綁工作階段：同一帳號的 token 永遠相同。有 Origin 檢查與 SameSite cookie 在前面，屬縱深防禦。 | `gateway/index.mjs` | 追蹤（綁工作階段或加時間片） |
| L18 | `dist/` 內有疑似真實的通訊作者 email（期刊慣例）與示意電話；`v1/units.json` 有同事姓名；`apiItem` 用 `...rest` 輸出全部欄位，未來新增的內部欄位會自動公開。 | `emit-api.mjs`、內容 | 追蹤（內容治理判斷；輸出改白名單） |
| L19 | `pii-scan.mjs` 的 GitHub Actions 註記沒跳脫 `file=`／`title=`；`analyze-404-log.mjs` 報表只跳脫 `\|`；`pdf-to-md.mjs` 路徑以 `-` 開頭會被當選項。 | 各腳本 | 追蹤（低風險） |
| L20 | `serve.mjs` 其他：每個靜態回應都帶 `cdc_ask_log_mock` cookie；basePath 前綴比對沒有邊界；監聽所有介面（`::`）；靜態回應沒有 `nosniff`。 | `scripts/serve.mjs` | 部分已修（只允許 GET／HEAD、basePath 邊界、`nosniff`）；監聽介面與 cookie 未改，追蹤（部署時以反向代理與防火牆限制） |

### 3.5 查過、沒問題（讓讀者知道覆蓋到哪）

- **閘道 HTTP 層**：POST 必須 `application/json`、`Origin` 必須與 Host 或 `PUBLIC_ORIGIN` 同源、`X-CSRF-Token` 以 `timingSafeEqual` 比對、本體上限 512 KB／24 MB、超限讀完再回 413（不中斷串流）、錯誤回應不帶堆疊與路徑、回應 `no-store`＋`nosniff`＋`default-src 'none'`。
- **JWT**：只收 RS256／PS256／ES256，拒絕 `none` 與 HS*；`kid` 不符重抓一次 JWKS；驗 `exp`、`nbf`、`iss`、`aud`。**Google 登入**：PKCE S256、state、nonce、`hd`、`email_verified`、網域比對、`next` 只允許 `/admin/` 底下、cookie `HttpOnly; SameSite=Lax; Secure`、HMAC 封裝。**header 模式**：只信任設定的代理 IP，其他來源帶身分標頭一律拒絕。
- **路徑組成**：內容檔路徑由 `type` 與 `id` 決定（`content/<dir>/<slug>.json`），附件路徑 `content/assets/<id>/<name>`，檔名正規表示式＋`assertContentPath` 雙重檢查；送審者**不能**寫 `.gitlab-ci.yml`、`.github/` 或任何 `content/` 以外的檔，所以「用 CMS 寫入 CI 設定檔取得執行權」這條路不通。
- **Git 寫入**：`update-ref` 帶舊值（並行寫入會失敗而不是覆蓋）；GitLab 供應者錯誤訊息不回到使用者（500 只回白話）。
- **稽核**：hash chain；只記帳號、姓名、單位、登入方式，不記 token 與內文。
- **CI**：fork PR 無提權路徑（`SAME_REPO` 判斷正確、沒有 `pull_request_target`／`workflow_run` checkout）；`test` job `contents: read`、`persist-credentials: false`；lane job 不 checkout、不跑 node，artifact 逐值列舉驗證，車道由 API 檔案清單重算（擋 `lane.json` 偽造與「連同 lanes.json 一起改」）；所有 `${{ github.event.* }}` 先進 `env` 再以 `"$VAR"` 引用；8 個 action 的 SHA 與 tag 一致；lockfile 169 套件全部官方 registry＋integrity，唯一 install script 是 esbuild（dev）。
- **瀏覽器端**：`html\`\`` 模板預設跳脫、`jsonScript()` 擋 `</script>`、所有 `innerHTML` 插值走 `esc()`、搜尋結果以 DOMParser 逐節點重建、沒有 `postMessage` 監聽、公開端沒有 `eval`／`document.write`、唯一的 `srcdoc` 是 `sandbox=''` 的送審預覽、BYOK 金鑰只在 sessionStorage、`v1/` 與 Pagefind 索引沒有未發布內容、prototype pollution 實測無法污染全域。
- **模擬後端**：權杖比對 `timingSafeEqual` 且不進 log、token 用 `randomUUID`、信件標頭 base64 編碼（無注入）、HTML 內文跳脫、非信任代理送的 XFF 正確忽略、JSON 深層巢狀與 `__proto__` 實測無事。

## 4. 教訓（寫給下一個改這些程式的人）

1. **「只接受本機連線」不是認證。** 反向代理一放在同一台，所有連線都是本機。任何以 `remoteAddress` 判斷信任的地方（dev 認人、`/api/dev/*`），都要同時確認沒有代理標頭，而且要有一個正式環境必然會設的環境變數把它整個關掉。
2. **請求裡的欄位是資料，不是權威。** 閘道檢查了「送來的 owner 是不是你的單位」，正確的問題是「網站上**現在**這筆內容的 owner 是不是你的單位」。所有授權判斷都要以伺服器端已知的狀態為準，再拿請求裡的值去比對。
3. **黑名單淨化只能擋想得到的寫法。** 正規表示式比對 `javascript:` 擋不住 `jav&#x61;script:`，擋 `<iframe>…</iframe>` 擋不住沒閉合的 `<iframe>`。白名單（只放行知道安全的標籤、屬性、協定）在遇到沒想過的寫法時預設是「擋」，黑名單預設是「放」。同理也適用於 `audit-dist` 的副檔名白名單（attack-surface.md §8）。
4. **URL 解碼與路徑組合的順序決定了有沒有洞。** URL 解析器正規化 `..` 的時候，`%2f` 還不是斜線；`decodeURIComponent` 之後它就是了。凡是「解碼→組路徑」的地方，解碼後一定要再做一次「結果是否仍在允許的根目錄下」的檢查，而且用 `path.resolve` 加 `realpath`，不要用字串包含 `..` 來判斷。
5. **設定值也要驗證。** `10.0.0.1/33` 不是一個合法的 CIDR，程式卻默默接受並算出一個錯得離譜的遮罩；這份清單還決定誰能冒充任何人登入。啟動時驗證設定、不合法就不啟動，比「盡量解讀」安全。
6. **DAST 排程寫好不等於跑過。** 第六十三輪的 ZAP 工作流程到本輪都沒跑過一次；它的掃描對象正是有 S1 的 `serve.mjs`。工作流程合併當天就要手動跑一次（deploy.md §29.1 已有同樣的教訓）。
7. **白箱稽核要用「兩個帳號」的劇本。** 單一帳號的測試（能不能存、能不能核准）全部通過，跨單位接管還是存在。授權測試至少要有「另一個單位的人」這個角色。本輪的 `tests/round73-gateway-owner.test.mjs` 把這個劇本固定下來。

## 5. 待辦與負責人

| 事項 | 誰 | 依據 |
| --- | --- | --- |
| 建 GitHub Environment「production」，部署分支限 `main`，把 `SNAPSHOT_DEPLOY_KEY`、`INTL_FEED_TOKEN` 從 repo secrets 搬進去（程式已宣告 `environment: production`） | 擁有者 | M8，deploy.md §9.3 |
| 規則集：程式路徑（`.github/`、`scripts/`、`src/`、`content/governance/`、`content/master/`）要求 code owner 審核；`required_status_checks` 綁 Actions integration | 擁有者 | L1 |
| 確認只有一把寫入部署金鑰、排定輪替；評估改 GitHub App 取代「所有部署金鑰 always 繞過」 | 擁有者、資訊室 | L2 |
| 到 Actions 手動跑一次 DAST，把預期的 WARN 整理成基準線 | 資訊室／OASIS | security-testing.md §4 |
| 正式環境：`GATEWAY_AUTH` 非 dev、`PUBLIC_ORIGIN` 必設、`GATEWAY_TRUSTED_PROXIES` 只列代理本身的 /32、`HOST=127.0.0.1` 或內網位址、CSP 等標頭由反向代理套用（GitHub Pages 送不出標頭） | 資訊室 | deploy.md §14、§35 |
| `INTL_FEED_TOKEN` 拆成收／拉兩把 | OASIS | L7 |
| CSRF token 綁工作階段 | OASIS | L17 |
| 公開 JSON 的輸出欄位改白名單；同事姓名與通訊作者 email 由內容治理判斷 | OASIS、公關室 | L18 |
| 正式站地圖搬到專用子網域後重評 iframe sandbox | OASIS | L15 |
| 第三方黑箱滲透測試（上線前） | 資訊室 | security-testing.md §3 |

## 6. 本輪改了什麼

- 程式：`scripts/serve.mjs`（靜態檔服務抽成 `scripts/lib/static-serve.mjs`）、`scripts/lib/rate-limit.mjs`、`scripts/lib/gateway/{auth,index,workflow}.mjs`、`scripts/lib/markdown.mjs`、`scripts/lib/render.mjs`、`scripts/lib/{intl-epidemic,emit-api,dist-profile,assets,subscribe-mock,ask-log-mock,intl-feed-api}.mjs`、`schemas/*.json`、`src/templates/**`、`src/client/{answer/text,intl-epidemic-rules,subscribe-service,careers-apply,vaxschedule}.js`、`src/client/admin/common.js`、`.github/workflows/pages.yml`。
- 測試：`tests/round73-server-hardening.test.mjs`、`tests/round73-gateway-owner.test.mjs`、`tests/round73-content-sanitizer.test.mjs`，以及既有測試檔的補充。
- 文件：本文件、[content-html-safety.md](content-html-safety.md)、deploy.md §9.3、§9.4、§14.10、§35、abuse-protection.md、attack-surface.md §2、assets-policy.md、security-testing.md §2、README 第七十三輪、ARCHITECTURE §73、architecture-decisions §57。
- 修補時的取捨：配套內容（例：疫情中心的卷期與各組文章一起送）本來就可以屬於別單位，所以 H1 的規則只對「網站上已有的內容」生效；網站上已有的配套內容必須與 main 完全相同（版本碼含 owner），拿它改不了權責單位。feed 多出未知欄位時整則退回並點名欄位，不是默默丟掉：疫情中心的系統若有送額外欄位會被擋下，要先對齊 schema。
- 相依：新增一個建置期的 HTML 白名單淨化器（見 content-html-safety.md 的版本與理由）；`npm audit fix` 修 `fast-uri`。
