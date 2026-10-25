# 攻擊面縮小：正式部署產物、內部站、對外資產清冊

> 給誰看：資訊室（主機、CDN、DNS、憑證）、資安窗口、維護本 repo 的工程師。
> 來源：GitHub Issue #141「縮小可被自動盤點的攻擊面」（外部審查者 grokbot，2026-10，起因是 ARTEX AI 滲透工具的一連串事件）。第六十二輪實作。
> 相關：[deploy.md](deploy.md) §10（安全標頭）、§10.4（security.txt、DNSSEC、CAA）、§14.5（閘道網路）、§30（本輪的指令與環境變數）。

## 1. 為什麼：AI 代理先盤點，再挑目標

ARTEX 一類的 AI 滲透工具，第一步不是攻擊，是**盤點**：列出子網域、可連的端點、能下載的檔案，比對每個元件的版本，做成一張資產地圖，再挑最軟的目標。人工滲透測試以前也這樣做，差別在於現在盤點完全自動，而且會一直重跑。

所以防守要做的第一件事，是**讓那張地圖小一點**：

- 公開主機上**沒有**的東西，盤點工具就列不到。
- 盤點工具列得到的東西，我們自己要**先列一份**，而且比它更完整（它不知道的內網元件我們也要知道），定期比對。
- 回應標頭不要主動報出伺服器軟體和版本。

這三件事都不取代修補漏洞、存取控制、登入保護，但能讓「挑一個沒修的舊版本打」這一步變慢、變難。

## 2. 建置現在做什麼

規則都在 `scripts/lib/dist-profile.mjs`，建置（`scripts/build.mjs` 的最後一步）和獨立的稽核指令（`npm run audit:dist`）用同一份。

| 建置方式 | 後台頁、後台 JS、source map、標頭設定檔等 | PR 預覽 | 稽核 | 清冊 |
| --- | --- | --- | --- | --- |
| 原型（預設，`npm run build`） | 留在 `dist/`（示範站刻意公開，給同事和資訊室看） | 有設 `PREVIEWS_DIR` 就複製到 `dist/preview/` | `prototype` 規則：原型限定路徑記為「預期」，防禦性規則和副檔名白名單照擋（目前只警告） | `dist/headers/exposure.json` |
| 正式（`SITE_MODE=production npm run build`） | **搬到 `dist-internal/`**，公開樹不再有 | **不複製**（記一行 log） | 拆分後用 `public` 規則再稽核一次，**還有任何一個禁止檔就建置失敗** | `dist-internal/exposure.json` |

公開主機不得出現的路徑（`FORBIDDEN_PUBLIC`）：

| 規則 | 理由 | 正式建置怎麼處理 |
| --- | --- | --- |
| `admin/**` | 後台頁只給同事 | 搬到 `dist-internal/admin/` |
| `assets/js/admin/**` | 後台 JS 列出寫入閘道每個端點與參數 | 留在內部站的 `assets/`，公開樹刪除 |
| `vendor/**` | 後台專用第三方函式庫（marked、pdf.js），版本號可直接比對已知漏洞；公開頁不用 | 搬到內部站 |
| `**/*.map` | source map 含完整原始碼與註解 | 搬到內部站；公開 JS 結尾的 `//# sourceMappingURL=` 註解一併拿掉 |
| `headers/**` | 伺服器標頭設定檔是維運素材，不該當網頁提供 | 搬到 `dist-internal/headers/`（交給資訊室套到公開主機，見 §5） |
| `assets/js/globals.d.ts` | 開發用型別宣告 | 留在內部站，公開樹刪除 |
| `robots.production.txt` | 原型站對照用；正式站直接輸出成 `robots.txt` | 刪除 |
| `preview/**` | 未審核的內容與程式，而且每個預覽都是一整套含後台的站 | 刪除（根本不複製） |
| `.git*`、`.env*`、`node_modules/**`、`tests/**`、`docs/**`、`.local/**`、`*.bak`、`*.orig`、`*.swp`、`*.log`、`.DS_Store`、`Thumbs.db` | 防禦性：正常建置不會產生，出現就代表建置或部署流程出錯 | 任何建置方式都算錯 |

例外：`redirects/nginx.map` 是 nginx `map` 指令用的舊網址對照檔（公開，`openapi.json` 有寫），不是 source map。

另外有**副檔名白名單**（`PUBLIC_EXTENSIONS`：html、md、json、xml、txt、csv、ics、js、css、圖檔、內容附件、Pagefind 索引檔……）。不在白名單的副檔名，例如有人在 `src/public/` 放了 `.sql`、`.zip`、`.pem`，也算禁止檔。理由見 §8。

## 3. 什麼留在內部

| 元件 | 放哪裡 | 依據 |
| --- | --- | --- |
| 後台頁、後台 JS、source map、`vendor/` | `dist-internal/`，放在同事用的內部反向代理後面 | 本輪；`dist-internal/README.md` |
| 寫入閘道（`/api/gateway/*`） | 和後台同一台反向代理後面，閘道本身不對外開埠 | [deploy.md](deploy.md) §14、§14.5 |
| 國際疫情推送端點（`/api/intl-epidemic`） | 伺服器對伺服器；只開給推送方的來源 IP，或放在內網 | [intl-epidemic.md](intl-epidemic.md) |
| Git 平台（GHES 或自架 GitLab）、CI runner、管理介面 | 只在內網或 VPN | Issue #141 第 2 點；平台選擇尚未決定 |
| 個資表單系統（報名、署長信箱、電子報） | 機關的個資系統，不在本站；它的子網域也列進清冊 | [careers-privacy.md](careers-privacy.md)、deploy.md §13 |
| `/api/dev/*`（模擬信件匣、查詢紀錄報表） | 只存在本機開發伺服器，正式環境不得存在 | `scripts/serve.mjs` |

**尚未決定、本輪不決定的事：** 正式環境是否放 Azure（Issue #129）、Git 平台用 GHES 還是署內 GitLab（#130）、個資系統放哪裡（#132），要等 Yulun 與資訊室確認前提。不管最後怎麼決定，上面這張表的原則都一樣：**管理面（Git、CI、後台、閘道）不對網際網路開放**；決定之後只要把實際主機名稱填進 §4 的清冊。

**內部站怎麼接：** 兩種做法擇一（細節見 deploy.md §30）：

1. 內部站有自己的網域（例 `https://staff.<機關網域>`）：建置時設 `ADMIN_ORIGIN`，公開頁上所有後台連結（頁尾「同事修改這頁」、後台入口）都變成指向那個網域的絕對網址。
2. 不設 `ADMIN_ORIGIN`：同事用的反向代理把 `/admin/`、`/api/gateway/` 轉到內部站，其他路徑轉到公開站；從網際網路連公開站的 `/admin/` 會是 404。

## 4. 對外資產清冊（資訊室每月做）

AI 盤點工具用的公開來源，我們自己也查得到：DNS、憑證透明度紀錄（CT log）、搜尋引擎。清冊的目的是**我們先知道自己有什麼**，盤點工具找到的東西不該比我們的清單多。

### 4.1 建置端自動產生的部分

每次建置寫出 `exposure.json`（原型：`dist/headers/exposure.json`；正式：`dist-internal/exposure.json`），內容：

- 頁數、各頂層目錄的檔數與大小、`v1/` 底下所有 JSON 端點
- 後台頁路徑清單
- 動態端點與目前生效的模式：`/api/gateway/*`、`/api/intl-epidemic`、`/api/ask-log`（`askLog` 設定）、`/api/subscriptions*` 與各表單（`forms` 設定）、`/api/dev/*`
- 網站用到的外部來源（從 CSP 推出，每個來源寫明用途）：疫苗地圖與登革熱地圖的 iframe、YouTube、`api.anthropic.com`（BYOK 示範，正式站拿掉）、表單與查詢紀錄的正式端點（有設定時）

隨時可以對任何目錄重算：`node scripts/audit-dist.mjs <目錄> --json`。

### 4.2 清冊範本

建置端知道的列已填好；網域、IP、憑證要資訊室補上。

| 資產 | 類型 | 用途 | 對外？ | IP／託管 | 憑證簽發者 | 憑證到期 | 負責人 | 上次核對 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `www.cdc.gov.tw`（正式站網域，待定） | 網域 | 公開站 | 是 | （待填） | （待填） | （待填） | 資訊室 | |
| （內部站網域，`ADMIN_ORIGIN`） | 子網域 | 後台頁＋寫入閘道 | **否**（內網／VPN） | （待填） | | | 資訊室 | |
| （Git 平台，#130 決定後） | 子網域 | GHES 或 GitLab | **否** | | | | 資訊室 | |
| （CI runner） | 主機 | 建置 | **否** | | | | 資訊室 | |
| （個資表單系統，#132 決定後） | 子網域 | 報名、署長信箱、電子報 | 是（表單） | | | | 資訊室、人事室 | |
| `data.cdc.gov.tw` | 子網域 | 開放資料（既有） | 是 | | | | | |
| `ancientsky.github.io/vaxmap-next/` | 外部 | 疫苗及流感藥劑地圖（iframe） | 是 | GitHub Pages | | | OASIS | |
| `ancientsky.github.io/denguemap/` | 外部 | 登革熱地圖（iframe） | 是 | GitHub Pages | | | OASIS | |
| `www.youtube-nocookie.com`、`www.youtube.com`、`i.ytimg.com` | 外部 | 影片嵌入與縮圖 | 是 | 第三方 | | | | |
| `api.anthropic.com` | 外部 | BYOK 示範，正式站拿掉 | 是 | 第三方 | | | OASIS | |
| `ancientsky.github.io/new_cdc_prototype/` | 外部 | **非正式**：本原型示範站 | 是 | GitHub Pages | | | OASIS | |

原型站 `ancientsky.github.io` 不是機關網域，但它會出現在搜尋結果和他人的盤點裡，所以**列進清冊、標「非正式」**，正式站上線後決定保留或下架（頁首已有「非官方原型」橫幅）。

### 4.3 每月比對程序

1. **重算建置端清冊**：拿最新的 `exposure.json`，看外部來源和端點有沒有多出來（新加的 iframe、表單端點）。
2. **匯出 DNS 區域檔**（zone export），列出所有 A／AAAA／CNAME 紀錄，和清冊逐列比對。
3. **查憑證透明度紀錄**：例如 crt.sh 查 `%.cdc.gov.tw`（`https://crt.sh/?q=%25.cdc.gov.tw`），列出近期簽發過憑證的所有主機名稱。CT log 是公開的，盤點工具一定會查；這裡出現、清冊沒有的主機名稱，就是要追的。
4. **處理差異**：
   - 清冊沒有、DNS 有 ⇒ 找負責人，補進清冊或移除。
   - **懸空的 CNAME**（指向已刪除的雲端資源、已停用的 GitHub Pages、舊的 CDN 端點）⇒ **立刻刪除**。別人可以註冊同名資源，接管這個子網域（subdomain takeover），用機關網域發仿冒頁面。
   - 舊的測試子網域（`test.`、`dev.`、`staging.`、`uat.`）⇒ 不再用就刪；還要用就移到內網，不留在公開 DNS。
   - 憑證 30 天內到期 ⇒ 排更新。
5. **記錄**：在清冊「上次核對」欄填日期，差異與處理方式留紀錄。

和 deploy.md §10.4 的相似網域監控（typosquat、punycode）是同一套 CT log 訂閱，可以一起做。

## 5. 指紋標頭

建置輸出的 `headers/` 現在多一份「要拿掉的標頭」：`Server`、`X-Powered-By`、`X-AspNet-Version`、`X-AspNetMvc-Version`（`headers.json` 的 `remove` 陣列）。

| 環境 | 做法（檔案已含，或 README 有寫） |
| --- | --- |
| nginx | `server_tokens off;`（只拿掉版本號）；完全拿掉 `Server` 要 headers-more 模組的 `more_clear_headers Server;`；當反向代理時用 `proxy_hide_header` 擋掉上游送來的 |
| IIS | `<remove name="X-Powered-By" />`、`<security><requestFiltering removeServerHeader="true" /></security>`（IIS 10 以上）；`X-AspNet-Version` 用 `<httpRuntime enableVersionHeader="false" />` 關 |
| Azure Front Door | 規則引擎新增規則，動作「修改回應標頭」，運算子「刪除」，逐一填上述標頭 |
| Netlify／Cloudflare Pages | `_headers` 只能加不能刪；平台本身不送 `X-Powered-By` |

驗證：`curl -sI https://<網域>/ | grep -iE '^(server|x-powered-by|x-aspnet)'` 應該沒有輸出，或只剩不含版本號的 `Server`。

本機開發伺服器（`scripts/serve.mjs`，Node 的 `http` 模組）本來就不送 `Server` 和 `X-Powered-By`。

## 6. 原型刻意「不藏」的東西

本 repo 是開源的。**安全不能靠程式碼保密**：攻擊者讀得到 `scripts/`、`src/`、`docs/`，包括本文件。所以這一輪不做：

- **不混淆程式碼**，也不把 `docs/` 從 GitHub 拿掉。正式站拿掉 source map 是為了不讓「部署的主機」多一份可下載的資產，不是為了保密：原始碼在 GitHub 上本來就公開。
- **不隱藏架構**：閘道端點、後台頁的功能都寫在文件裡。防線是登入、角色、CSRF、稽核（deploy.md §14），不是「別人不知道路徑」。

真正要保密的東西不在 Git 裡：

- **金鑰、權杖、連線字串只放環境變數**（`INTL_FEED_TOKEN`、閘道的 OIDC 與 GitLab 權杖、表單端點等），repo 裡沒有、建置產物裡也沒有。
- **個資不進 Git**：報名、信箱來信、訂閱者資料在機關的個資系統（[careers-privacy.md](careers-privacy.md) 第 1 節）；`content/`、`data/snapshots/` 與附件每次建置都跑個資掃描（`npm run pii`），命中就建置失敗。
- 本機開發資料（`.local/`）在 `.gitignore`，部署產物稽核也會擋。

## 7. 誰做什麼

| 誰 | 做什麼 |
| --- | --- |
| 維護本 repo 的工程師 | 新增不該公開的產物時，同時在 `FORBIDDEN_PUBLIC` 加規則；新增公開檔的副檔名時，在 `PUBLIC_EXTENSIONS` 加並寫理由 |
| CD 管線 | 正式建置後跑 `npm run audit:dist -- dist --profile public`，結束碼不是 0 就不部署 |
| 資訊室 | 部署 `dist/` 到公開主機、`dist-internal/` 到內部站；套 `headers/`；每月做 §4.3 |
| 資安窗口 | 弱點掃描、滲透測試的範圍以清冊為準；發現清冊外的資產，回報資訊室補清冊 |

## 8. 教訓

**你部署的 dist，也是攻擊者盤點的 dist。在建置時用白名單擋，比上線後清理便宜。**

- **為什麼白名單比黑名單好：** 黑名單（`FORBIDDEN_PUBLIC`）只擋「我們想得到的壞東西」。明天有人放進一個 `.sql` 匯出檔、一個 `.zip` 備份、一把 `.pem` 金鑰，黑名單不會知道。白名單反過來問「這個檔我們說過可以公開嗎」，沒說過就擋，所以新的錯誤會變成建置失敗，而不是悄悄上線。代價是新增合法副檔名時要改一行並寫理由；這個代價是刻意的，因為它讓「公開什麼」成為一個要寫理由的決定。本輪兩個都用：黑名單給每條規則一個說得出口的理由（報錯時知道錯在哪），白名單兜住黑名單漏掉的。
- **為什麼要檢查產物，不檢查原始碼：** 原始碼乾淨不代表產物乾淨。複製步驟（`src/public/` 整包複製）、PR 預覽、壓縮器多產生的 source map、有人在主機上手動補的檔，都只會出現在產物裡。所以檢查跑在**建置的最後一步**（所有複製都做完之後），而且 `scripts/audit-dist.mjs` 可以對**實際部署的目錄**再跑一次。
- **為什麼要上線前做：** 檔案一旦放上公開主機，就可能已經被搜尋引擎、網頁存檔服務、盤點工具抓走。上線後刪掉，只是不再提供，不能讓已經被抓走的資料消失。
