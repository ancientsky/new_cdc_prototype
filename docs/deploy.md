# 部署與維運

> 給誰看：資訊室、OASIS，以及要擴充內容型別或修改 schema 的工程同事。
> 需求：Node.js 20 以上（CI 使用 22）。依賴只有 `ajv`、`ajv-formats`、`marked`。

## 1. 本機預覽

```bash
npm ci                 # 依 package-lock.json 安裝
npm run build          # 輸出到 dist/
npm run dev            # 建置後啟動預覽伺服器（預設 http://localhost:4173/new_cdc_prototype/）
```

常用指令：

| 指令 | 作用 |
| --- | --- |
| `npm run fetch` | 抓官方資料到 `data/snapshots/`（抓不到沿用既有快照，不會失敗） |
| `npm run build` | 載入內容 → 驗證 → 治理 → 索引 → 評估 → 輸出 |
| `npm run build -- --fix-assets` | 先把 `content/assets/{id}/` 實際檔案的 `bytes`／`sha256`／`mime`／寬高補寫回內容 JSON（只改 `assets` 欄位），再照常建置。只想補寫不輸出：`node scripts/build.mjs --check --fix-assets`。檔案規則見 [assets-policy.md](assets-policy.md) |
| `npm run check` | 同上但**不輸出檔案**；用來在 PR 前快速驗證 |
| `npm test` | 跑 `tests/*.test.mjs`（治理規則測試） |
| `npm run eval` | 在 Node 跑評估集，印出各類別通過率 |
| `node scripts/serve.mjs 4144` | 指定連接埠預覽 `dist/` |

預覽網址含 basePath。想用根路徑預覽（`http://localhost:4173/`），建置時設空字串：

```bash
BASE_PATH='' npm run build && node scripts/serve.mjs
```

### 環境變數

| 變數 | 預設 | 說明 |
| --- | --- | --- |
| `BASE_PATH` | `/new_cdc_prototype` | 網站子路徑。GitHub Pages 專案頁是 `/<repo 名稱>`；自訂網域放根目錄就設空字串 |
| `SITE_URL` | `https://ancientsky.github.io` | 絕對網址的網域部分（canonical、sitemap、JSON-LD、API `meta.source`） |
| `DIST_DIR` | `dist` | 輸出資料夾。多人平行開發時各用各的，避免互相清掉 |
| `BUILD_TODAY` | 今天 | 以指定日期當「今天」重算逾期與白名單，用來模擬時間前進，例：`BUILD_TODAY=2027-08-01 npm run build` |

`--today=YYYY-MM-DD` 參數效果同 `BUILD_TODAY`。**所有連結都必須經 `ctx.url()`（伺服器端）或 `window.CDC.url()`（瀏覽器端）產生**，直接寫死 `/xxx` 會在子路徑部署時壞掉。

## 2. GitHub Pages 與 workflow

檔案：`.github/workflows/pages.yml`。

- **觸發：** push 到 `main`、**每 2 小時排程**（偶數整點 UTC；第九輪起，讓 `publishAt` 排程發布到點上線）、手動 `workflow_dispatch`（輸入 `refresh`，預設 true）。
- **build 工作：** checkout → Node 22 → `npm ci` → `npm test`（只驗 repo 內的內容與快照）→ **只在 02:00 UTC（台灣 10:00）那一次排程與手動執行（`refresh` 不是 false）時**跑 `npm run fetch`（失敗不中斷）並把快照 commit 回 `main` → 取出 `previews` 分支（PR 預覽，不存在就略過）→ `npm run build`（`BASE_PATH` 取自儲存庫名稱、`SITE_URL` 取自擁有者；建置把預覽複製到 `dist/preview/`）→ 上傳 `dist/`。
- **deploy 工作：** `actions/deploy-pages` 發布，網址 `https://ancientsky.github.io/new_cdc_prototype/`。
- **併發：** 同一時間只保留最新一次部署，舊的會被取消。

第一次啟用：儲存庫 Settings → Pages → Build and deployment → Source 選 **GitHub Actions**。workflow 內的 `configure-pages` 步驟帶 `enablement: true` 嘗試自動啟用，若權限不足仍須手動設定。

### 每日排程為什麼重要

逾期、資料集時效、排程發布這類「隨時間改變的狀態」只有重建才會更新。排程（每 2 小時）確保：內容到期當天頁首就出現黃色警示並退出白名單，`publishAt` 到點後最晚 2 小時內上線；旅遊疫情與資料目錄快照仍是一日一更（02:00 UTC 那一次）。若排程連續失敗，網站不會壞，但治理狀態會停在最後一次成功建置——資訊室請把 Actions 失敗通知（Watch → Custom → Workflows）設給值班信箱。

### PR 車道、預覽與自動合併（第九輪）

另有三個工作流程負責「內容 PR」（細節與設計理由見 [publishing-lanes.md](publishing-lanes.md)）：

| 檔案 | 觸發 | 做什麼 |
| --- | --- | --- |
| `.github/workflows/content-pr.yml` | `pull_request`（開啟／更新／重新開啟）、`pull_request_review`（提交審核） | 測試 → `build --check` → `scripts/lane.mjs` 判定車道 → 以 `BASE_PATH=…/preview/pr-{N}` 建置預覽並推到 `previews` 分支 → PR 留言與 `lane:*` 標籤 → 快車道／緊急發布檢查全過即 squash 合併；一般車道有核准且檢查全過才合併 → 觸發 `pages.yml` |
| `.github/workflows/preview-cleanup.yml` | PR 關閉、每日 01:41 UTC、手動 | 刪除 `previews` 分支的 `pr-{N}/` 並重新部署（自動合併的 PR 不會觸發 `closed`，由每日排程補清） |
| `.github/workflows/lane-sla.yml` | 每小時 | 開啟中的 PR 超過車道 SLA ⇒ 留言並加 `sla:breach` |

流程（一個內容 PR 從開啟到上線）：

```
PR 開啟／更新 ─▶ content-pr.yml
   npm ci → npm test → BUILD_TODAY=2026-10-01 node scripts/build.mjs --check
   → node scripts/lane.mjs $(git diff --name-only origin/main...HEAD)      # 車道、審核人、SLA（JSON）
   → 建置預覽（BASE_PATH=/new_cdc_prototype/preview/pr-N、LINK_CHECK=warn、PREVIEW_SCHEDULED=1）
   → 推到 previews 分支 pr-N/（孤兒快照提交、force-with-lease，失敗重試）
   → PR 留言（含 <!-- lane-bot -->，之後原地更新）＋ 標籤 lane:emergency｜lane:fast｜lane:standard
   → 快車道／緊急發布：檢查全過 ⇒ gh pr merge --squash --delete-branch
     一般車道：每位審核人最新一則審核為 APPROVED 且檢查全過 ⇒ 合併；否則留言「等待審核：需 N 位核准；SLA 至 …」
   → gh workflow run pages.yml --ref main -f refresh=false
審核人按 Approve ─▶ content-pr.yml（pull_request_review）重跑檢查 ⇒ 合併 ⇒ 觸發 pages.yml
pages.yml（push main／每 2 小時／手動）
   npm test →（02 UTC 排程或手動 refresh）npm run fetch ＋ 快照回寫 main
   → git fetch origin previews → 取出到 $RUNNER_TEMP/previews（PREVIEWS_DIR；分支不存在就略過）
   → npm run build（publishAt 未到的內容不輸出；連結檢查之後把 pr-N/ 複製到 dist/preview/）→ 上傳 dist/ → 部署
PR 關閉 ─▶ preview-cleanup.yml：刪 previews/pr-N/ → 觸發 pages.yml（每日排程補清自動合併的 PR）
每小時 ─▶ lane-sla.yml：lane:* 標籤＋PR 建立時間超過 SLA ⇒ 留言＋sla:breach（已有標籤就跳過）
```

`previews` 分支：第一次有 PR 預覽時由 `content-pr.yml` 自動建立（孤兒分支，不含 main 的歷史），只放 `pr-N/` 目錄、`README.md` 與 `.nojekyll`；不要手動合併進 `main`。主站部署時把它整包放到 `/preview/`，`robots.txt` 以 `Disallow: /new_cdc_prototype/preview/` 排除。

排程發布與時間：`publishAt` 以建置當下的真實時間（UTC）判斷，`BUILD_TODAY` 只影響治理日期；要重現某個時間點的輸出，用 `BUILD_NOW=2026-10-05T01:00:00Z npm run build`。

倉庫需要的設定（一次）：

- Settings → Actions → General → Workflow permissions 選 **Read and write permissions**，並勾選 **Allow GitHub Actions to create and approve pull requests**（留言、標籤、合併、`gh workflow run` 用的都是 `GITHUB_TOKEN`；各工作流程已宣告所需 `permissions`）。
- 標籤 `lane:emergency`、`lane:fast`、`lane:standard`、`sla:breach` 不必先建，工作流程第一次用到時自動 `gh label create`。
- 一般車道的核准：GitHub 不允許 PR 作者核准自己的 PR。原型只有一個帳號，測一般車道的自動合併時，PR 要由另一個帳號開，或由擁有者手動合併。
- 分叉（fork）來的 PR 拿不到寫入權杖：只跑測試與車道判定，不推預覽、不留言、不合併。

注意事項：

- **`GITHUB_TOKEN` 做的事不會再觸發其他工作流程**（GitHub 規則）：所以 `content-pr.yml` 合併後自己用 `gh workflow run pages.yml` 觸發部署。
- **分支保護與自動合併互相牴觸**：若 `main` 設了原生的「合併前需 N 位核准」，快車道的自動合併會失敗。原型沒有設；正式環境請改用「必要狀態檢查＋禁止直接 push」，把「需要核准幾位」交給車道機器人判斷，或用規則集（ruleset）讓合併機器人帳號繞過並留紀錄。
- **預覽目錄是公開的**：`previews` 分支與 `…/preview/pr-{N}/` 在 GitHub Pages 上任何人都打得開（只靠主站 `robots.txt` 擋爬蟲，不是存取控制；預覽以 `PREVIEW_SCHEDULED=1` 建置，排程中、禁發的內容在預覽裡看得到）。正式環境的預覽必須放內網或加存取控制。
- `previews` 分支只保留一個快照提交（孤兒提交），每次推送覆蓋自己的 `pr-{N}/`；大小過大時調整預覽輸出（例如略過 `/v1/` 與 `/files/` 之外的大型資料）。
- 預覽用 `BUILD_TODAY=2026-10-01` 建置（與主站一致）；連結檢查在預覽為 `warn`，主站仍是 `error` 閘門。

### 發布前的閘門

CI 任一項失敗即不部署：JSON Schema 與跨檔參照（`owner`、`basedOn`、`supersedes` 必須存在）、治理規則測試、**評估集版本題 100%**（`CI=true` 時，未全對會讓建置以非零狀態結束）。

### 疑難排解

| 現象 | 檢查 |
| --- | --- |
| 建置顯示「治理門檻未通過」 | 看錯誤清單，通常是缺必填欄位或 id 打錯；本機 `npm run check` 重現 |
| 部署後樣式全沒了 | `BASE_PATH` 與實際網址不一致 |
| 版本題未全對 | 看輸出的失敗題與原因，通常是舊版仍在白名單，或新版缺 `machineReadableMarkdown` |
| 旅遊疫情日期很舊 | 看 `data/snapshots/*.json` 的 `meta.mode` 與 `fetchedAt`，確認 `npm run fetch` 是否被來源擋下 |
| 等級表出現幾十個第二級國家、或 2020 年的 COVID 第三級 | 官方 `CountryEpidLevel/ExportJSON` 是「歷次警示的完整歷史」（只有生效日、沒有結束日）。fetch 把它當事件日誌處理：同國家×疾病×區域只看最新一則，最新為「解除」（`severity_level` = 解除）就不列；再排除明顯歷史紀錄（2023-05-01 前的 COVID、第三級逾 365 天），最後以合理性閘門（第三級 ≤5、第二級 ≤60、第一級 ≤250 國；只擋解除事件沒處理好的病態分布）把關；不過關就沿用人工校對快照，原因寫在 `meta.lastLiveAttempt`，CI log 另印「等級表診斷」行供對照官方欄位 |
| Pages 404 | 確認 Source 已設為 GitHub Actions，且 `.nojekyll` 有輸出 |

## 3. 新增一種內容型別

以新增 `guideline`（診療指引摘要）為例，依序改：

1. **Schema**：新增 `schemas/guideline.json`，用 `allOf` 引用 `_common.json`，列出專屬必填欄位；在 `_common.json` 的 `type` enum 加入新型別。
2. **載入**：`scripts/lib/load.mjs` 的 `collections` 加 `guidelines: readDirJSON(path.join(CONTENT, 'guidelines'))`。
3. **驗證**：`scripts/lib/validate.mjs` 的 `typeToSchema` 加 `guideline: 'guideline.json'`；有跨檔參照就補檢查。
4. **審閱週期**：`content/master/review-periods.json` 加 `"guideline": 12`。
5. **白名單**：要讓 AI 引用，把型別加進 `content/governance/whitelist.json` 的 `allowedTypes`（公開）或 `allowedTypesPro`（專業），並經委員會核准。
6. **索引**：`scripts/lib/index-builder.mjs` 決定如何切成答案單元。
7. **API 與 SEO**：`scripts/lib/emit-api.mjs` 輸出 `v1/guidelines.json`（並更新 `openapi.mjs`）；`emit-seo.mjs` 把網址放進 sitemap。
8. **頁面**：在 `src/templates/public/` 新增 `guidelines.mjs`，匯出 `pages(site)`、`render`、`meta`、選用的 `markdown`。**不用改任何登錄檔**，`pages.mjs` 會自動掃描（底線開頭的檔名除外）。
9. **JSON-LD**：`scripts/lib/jsonld.mjs` 的 `jsonLdFor` 加對應 `@type`。
10. **測試**：`tests/` 補一個案例；`content/guidelines/` 放一筆範例，`npm run check` 通過。

## 4. 修改 schema

- **加選填欄位**：最安全，直接加到 schema，舊內容不受影響。
- **加必填欄位**：所有既有內容都要補，否則建置失敗；先用腳本批次補預設值，再收緊 schema。
- **改欄位名稱或型別**：屬於 API 破壞性變更。先新增新欄位、API 同時輸出兩者、公告至少 90 天，再移除舊欄位；必要時開 `v2`。
- **改 enum**：新增值要同步檢查模板（例如狀態標籤顏色、`i18n.js` 字串）。
- 改完一律跑 `npm run check` 與 `npm test`，並在 `docs/governance-model.md` 更新欄位表。

## 5. 新增語言

`site.config.mjs` 的 `langs` 加一筆（代碼、標籤、方向、路徑）；`src/client/i18n.js` 補 UI 字串；`content/master/glossary.json` 補詞彙；各內容的 `languages` 設定該語言狀態。沒有任何內容標記該語言為可渲染前，不會產生該語言頁。

## 6. 日常維運檢查

- 每日：Actions 排程是否綠燈。
- 每週：`/admin/` 儀表板待辦數是否收斂、KPI 有無下降。
- 每季：依賴更新（`npm outdated`）、安全性掃描、備援演練（確認任何一個 commit 都能在乾淨環境重建）。

## 7. 部署到其他環境

輸出的 `dist/` 是純靜態檔案，不依賴 GitHub。要搬到機關自己的主機或雲端物件儲存，只要在 CI 內改成：

1. 設定 `BASE_PATH`（根目錄部署就設空字串）與 `SITE_URL`（正式網域，例如機關官網網域）。
2. 執行 `npm ci && npm run build`。
3. 把 `dist/` 同步到網頁伺服器或 CDN 的來源儲存區。
4. 在伺服器設定：`.md`、`.json`、`.xml`、`.txt` 的 `Content-Type` 與 UTF-8 編碼；`404.html` 作為找不到頁面時的回應；為 `v1/*.json` 開啟 `ETag` 與 `Last-Modified`（API 文件承諾這兩項）。
5. 舊官網網址的 301：依 `v1/redirects.json` 與各內容的 `legacyUrls` 產生伺服器端導向規則。靜態頁面本身無法回 301，這一步必須在伺服器或 CDN 層完成。

換網域時要檢查的清單：canonical 與 hreflang、sitemap、`llms.txt`、JSON-LD 的 `url` 與 `cdc:` 命名空間網址、API `meta.source`——這些全部由 `SITE_URL` 與 `BASE_PATH` 產生，改環境變數後重建即可，不必改內容。

## 8. 備援與回復

- **回到某個時間點的網站：** checkout 該 commit，`npm ci && npm run build`。因為資料快照也在 Git 內，結果可重現。若要重現「當時的逾期狀態」，加上 `BUILD_TODAY`。
- **發布了錯誤內容：** 最快的方式是 `git revert` 該次合併並走緊急 PR；同時依[操作手冊](guide-staff.md)的暫停 SOP 先把 AI 問答關掉。
- **Actions 無法使用：** 在任何有 Node 的機器本機建置，把 `dist/` 手動上傳到備援主機。這也是每季備援演練要驗證的路徑。
- **外部資料來源中斷：** 不需處理。`npm run fetch` 失敗會沿用上一次快照，資料集頁面會顯示快照時間。

## 9. 權限與安全

- 儲存庫分支保護：`main` 要求 PR、CI 綠燈才可合併；**核准人數由發布車道決定**（一般車道 1 位，快車道與緊急發布 0 位，見上方「PR 車道」注意事項，不要設原生的「需 N 位核准」）；`content/governance/` 目錄建議設 CODEOWNERS 為 OASIS，`content/situation/` 為疫情中心，避免跨單位誤改。
- 緊急暫停 AI 的 PR 可由資訊室與 OASIS 值班人直接合併，事後補審。
- 前端不放任何伺服器金鑰。BYOK 只是同事示範功能（第二十三輪）：金鑰欄位只在有後台工作階段的瀏覽器出現，金鑰存 `sessionStorage`、關閉分頁即清除；正式站不提供民眾端 BYOK，生成式答案若要上線走機關後端代理。
- 快車道與緊急發布除了看內容型別，還看 PR 作者是否在 `lanes.json` 的 `allowedAuthors`（第二十三輪）；不在名單自動降為一般車道。名單變更本身走一般車道。
- GitHub Actions：第三方 action 一律固定 commit SHA（Dependabot 每週升版），工作流程層級只給 `contents: read`，寫入權限放在需要的 job。搬到機關 GitLab／GitHub Enterprise 時同樣套用。 下一步建議把 `content-pr.yml` 拆成兩個 job：「檢查」（測試、治理閘門、無障礙、lint；只需 `contents: read`）與「發布」（推預覽、留言、合併、觸發部署；才給寫入權限），讓分叉 PR 的檢查也在唯讀權杖下跑。
- 原型模式（預設）每頁 `noindex, nofollow`、`robots.txt` 全擋、頂端有「非官方原型」橫幅；正式站以 `SITE_MODE=production` 建置。
- 所有 HTML 由 `html` 標籤模板輸出，插值預設跳脫，只有 `raw()` 包起來的才不跳脫；Markdown 經 `marked` 的安全設定處理。審查 PR 時，凡新增 `raw()` 呼叫都要特別看一眼。
- 依賴極少（三個套件），降低供應鏈風險；升級時看 `npm audit` 並跑完整測試。

## 10. 安全標頭基準（第二十三輪）

靜態站本身回不了標頭，`Content-Security-Policy`、`Strict-Transport-Security` 等要由伺服器或 CDN 加。**建置會把要加的標頭直接輸出成設定檔**，放在 `dist/headers/`：

| 檔案 | 用途 |
| --- | --- |
| `headers.json` | 標頭名稱 → 值（機讀正本；CI 與測試讀這份） |
| `nginx.conf` | `add_header … always;` 片段，在 `server {}` 內 `include` |
| `web.config.headers.xml` | IIS `<httpProtocol><customHeaders>` 區塊，合進站台 `web.config` |
| `_headers` | Netlify／Cloudflare Pages 格式 |
| `README.md` | 怎麼套、怎麼驗、每個值的理由、各 inline script 雜湊首次出現的頁面 |

### 10.1 值是什麼、為什麼

| 標頭 | 值 | 為什麼 |
| --- | --- | --- |
| `Content-Security-Policy` | `default-src 'self'; script-src 'self' 'sha256-…'（建置掃出的每段 inline script）; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://i.ytimg.com; font-src 'self'; connect-src 'self' https://api.anthropic.com; frame-src <疫苗地圖網域> https://www.youtube-nocookie.com https://www.youtube.com; frame-ancestors 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; upgrade-insecure-requests` | 第三方腳本注入、點擊劫持的主要防線。inline script 用雜湊而不是 `'unsafe-inline'`：雜湊由建置掃 `dist/**/*.html` 自動算，模板多一段 inline script 重建就會更新，不會漏。`connect-src` 的 `api.anthropic.com` 只因同事示範 BYOK，正式站拿掉。 |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | 一年 HTTPS-only。確定全部子網域都走 HTTPS 再加 `preload`。 |
| `X-Content-Type-Options` | `nosniff` | 不讓瀏覽器猜 MIME（本站有 `.md`、`.json` 直出）。 |
| `X-Frame-Options` | `SAMEORIGIN` | 舊瀏覽器備援，新瀏覽器以 `frame-ancestors` 為準。現行官網是 `frame-ancestors 'self' *.cdc.gov.tw`，正式站若要給子網域嵌入在這裡加。 |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | 外連只送網域，不送完整網址（網址可能含查詢字串）。 |
| `Permissions-Policy` | 關閉 camera／microphone／geolocation／payment／usb／interest-cohort | 本站都不用。 |
| `Cross-Origin-Opener-Policy` | `same-origin` | 防跨來源視窗引用。 |

`style-src` 暫留 `'unsafe-inline'`：後台頁有少量 `style=""` 屬性（清單在 `dist/headers/README.md`）。清掉後改成 `'self'`。

### 10.2 部署與驗證

1. nginx：`include /srv/site/headers/nginx.conf;` 放在 `server {}`。注意 nginx 的 `add_header` 在子 `location` 另有 `add_header` 時會**整組不繼承**，統一放同一層。
2. IIS：把 `web.config.headers.xml` 的 `<httpProtocol>` 合進 `<system.webServer>`。
3. CDN：依 `headers.json` 逐項設定。
4. 驗證：`curl -sI https://<網域>/ | grep -iE 'content-security|strict-transport|x-content-type|referrer|permissions'`，或 https://securityheaders.com 。瀏覽器 Console 出現 `Refused to execute inline script` ⇒ 標頭沒跟著新版重佈；重新套 `dist/headers/`。
5. 建議在資安檢測清單加一項：「正式站回應標頭與 `dist/headers/headers.json` 一致」。

### 10.3 GitHub Pages 的限制

GitHub Pages 不能自訂回應標頭，所以原型站只有 `<meta name="robots">` 與 `robots.txt`，沒有 CSP／HSTS；這也是原型模式用 meta 擋索引、不用 `X-Robots-Tag` 的原因。`dist/headers/` 要到機關自己的主機或 CDN 才生效。

