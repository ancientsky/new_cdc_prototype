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
- 程式碼檢查（第二十六輪；失敗時怎麼看見 [guide-staff.md](guide-staff.md) 第 27 節）：
  - `npm run lint`：ESLint，PR 的 `content-pr.yml` 與 `pages.yml` 都會跑；0 errors 才算過（warnings 不擋，逐步清）。
  - `npm run typecheck`：`tsc` 型別檢查試點（`lanes.mjs`、`validate.mjs`）。
  - `npm run format:check`：Prettier，只強制新檔，不進 CI。
  - `npm run build`：最後會印「JS 預算」一行（公開頁 120 KB、含答案引擎的頁 320 KB）；超過即失敗，可用 `JS_BUDGET_KB`／`ENGINE_JS_BUDGET_KB` 暫時調整。每季看一次最大值有沒有往上爬。

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

### 9.1 Dependabot 升版 PR 怎麼處理（第二十七輪）

- **設定**：`.github/dependabot.yml` 每週一 09:00（台灣時間）檢查。Actions 升版合成一個 PR（`groups.actions`）；npm 的 minor／patch 合成一個（`groups.npm-minor-patch`），major 各自一個。
- **為什麼要分組**：同一個 workflow 裡 `checkout` 和 `setup-node` 是相鄰兩行。分開的 PR 各改一行，git 會把「相鄰行都被改」當成衝突，合了一個另一個就要重做。合成一個 PR 就沒有這個問題，CI 也只跑一次。
- **升 action 的 PR 會紅燈是預期的**：`tests/lanes.test.mjs` 寫死 `checkout`、`setup-node`、`deploy-pages` 的 SHA（確保沒人偷偷換回可移動的 tag）。升版時把測試檔裡的 SHA 和註解版本換成 PR 裡的新值即可；SHA 格式另由 `tests/round23-security.test.mjs` 檢查。
- **升 major 版要看什麼**：讀 release notes 的 breaking changes，跑 `npm test`、`node scripts/build.mjs --check`，再把升版前後的 `dist/` 逐檔比對（`diff -rq`），只剩時間戳差異才算安全。2026-10-10 升 `marked` 15→18 的差異只有 `&`→`&amp;` 與空白行。
- **已知的行為變化**：`actions/upload-pages-artifact` v4 起不打包點開頭的檔案與目錄（`.nojekyll`、`.well-known/`）。目前沒影響；若要上 `/.well-known/security.txt`，要改由正式站伺服器提供，或另找打包方式。
- **前端 `src/public/vendor/marked.min.js` 不跟著升**：它是後台貼上轉換用的獨立副本，Dependabot 看不到。要升時手動換檔並測後台「貼上 Word／網頁」轉換。

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
| `Content-Security-Policy` | `default-src 'self'; script-src 'self' 'wasm-unsafe-eval' 'sha256-…'（建置掃出的每段 inline script）; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://i.ytimg.com; font-src 'self'; connect-src 'self' https://api.anthropic.com; frame-src <疫苗地圖網域> https://www.youtube-nocookie.com https://www.youtube.com; frame-ancestors 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; upgrade-insecure-requests` | 第三方腳本注入、點擊劫持的主要防線。inline script 用雜湊而不是 `'unsafe-inline'`：雜湊由建置掃 `dist/**/*.html` 自動算，模板多一段 inline script 重建就會更新，不會漏。`connect-src` 的 `api.anthropic.com` 只因同事示範 BYOK，正式站拿掉。 `'wasm-unsafe-eval'` 是第二十八輪為 `/search/` 加的（見下）。 |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | 一年 HTTPS-only。確定全部子網域都走 HTTPS 再加 `preload`。 |
| `X-Content-Type-Options` | `nosniff` | 不讓瀏覽器猜 MIME（本站有 `.md`、`.json` 直出）。 |
| `X-Frame-Options` | `SAMEORIGIN` | 舊瀏覽器備援，新瀏覽器以 `frame-ancestors` 為準。現行官網是 `frame-ancestors 'self' *.cdc.gov.tw`，正式站若要給子網域嵌入在這裡加。 |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | 外連只送網域，不送完整網址（網址可能含查詢字串）。 |
| `Permissions-Policy` | 關閉 camera／microphone／geolocation／payment／usb／interest-cohort | 本站都不用。 |
| `Cross-Origin-Opener-Policy` | `same-origin` | 防跨來源視窗引用。 |

**`'wasm-unsafe-eval'`（第二十八輪，全文搜尋）**：Pagefind 在 Web Worker 內用 WebAssembly 搜尋，Chromium 系瀏覽器要求 CSP 明確允許 wasm 編譯，就是這個關鍵字。它**只放行 WebAssembly 編譯，不放行 JavaScript 的 `eval()`／`new Function()`**，所以跟 `'unsafe-eval'` 是兩回事，**不要**因為「搜尋壞了」就改成 `'unsafe-eval'` 或 `'unsafe-inline'`。Worker 腳本是同源的 `/pagefind/pagefind-worker.js`，用 `script-src 'self'` 就夠，不需要 `worker-src` 或 `blob:`。`tests/round23-security.test.mjs` 斷言有 `'wasm-unsafe-eval'`、沒有 `'unsafe-eval'`、`script-src` 沒有 `'unsafe-inline'`。若在某個瀏覽器發現搜尋無法啟動，先看 Console 的 CSP 訊息確認原因，不要先放寬。

`style-src` 暫留 `'unsafe-inline'`：後台頁有少量 `style=""` 屬性（清單在 `dist/headers/README.md`）。清掉後改成 `'self'`。

### 10.2 部署與驗證

1. nginx：`include /srv/site/headers/nginx.conf;` 放在 `server {}`。注意 nginx 的 `add_header` 在子 `location` 另有 `add_header` 時會**整組不繼承**，統一放同一層。
2. IIS：把 `web.config.headers.xml` 的 `<httpProtocol>` 合進 `<system.webServer>`。
3. CDN：依 `headers.json` 逐項設定。
4. 驗證：`curl -sI https://<網域>/ | grep -iE 'content-security|strict-transport|x-content-type|referrer|permissions'`，或 https://securityheaders.com 。瀏覽器 Console 出現 `Refused to execute inline script` ⇒ 標頭沒跟著新版重佈；重新套 `dist/headers/`。
5. 建議在資安檢測清單加一項：「正式站回應標頭與 `dist/headers/headers.json` 一致」。

### 10.3 GitHub Pages 的限制

GitHub Pages 不能自訂回應標頭，所以原型站只有 `<meta name="robots">` 與 `robots.txt`，沒有 CSP／HSTS；這也是原型模式用 meta 擋索引、不用 `X-Robots-Tag` 的原因。`dist/headers/` 要到機關自己的主機或 CDN 才生效。


## 11. 電子報寄信服務（第二十八輪）

原型的 Email 訂閱（`/subscribe/`）後面是模擬；正式站要換成真的寄信服務。**前端、驗證規則、信件內容與狀態機都不必改**，只實作下面的端點契約並接上寄信。背景與理由見 [architecture-decisions.md 第 19 節](architecture-decisions.md)、[ARCHITECTURE 第 30 章](../ARCHITECTURE.md)。

### 11.1 端點契約（與 `scripts/lib/subscribe-mock.mjs` 一致，測試 `tests/round28-newsletter.test.mjs` 可當驗收清單）

| 端點 | 說明 |
| --- | --- |
| `GET /api/health` → `{ok:true, service:'cdc-prototype-subscriptions'}` | 前端偵測用。正式版可保留同樣的 `service` 值，或在 `src/client/subscribe.js` 的 `HEALTH_SERVICE` 改成新值並同步後端 |
| `POST /api/subscriptions` | `{email, topics[], frequency, lang, consent:true}` → `202 {status:'pending'}`。**一律回 202**（含已訂閱者），驗證失敗 `400 {error:'invalid', fields}`，過頻 `429`＋`Retry-After`。寄確認信（48 小時有效）；已確認者只寄「管理／退訂」信、不改設定 |
| `GET /api/subscriptions/confirm?token=` | 冪等；成功 `200 {status:'confirmed', manageToken}` 並寄歡迎信；逾期 `410 {error:'expired'}`；未知 `404` |
| `GET /api/subscriptions/status?token=` | token＝manageToken，回遮罩信箱與偏好 |
| `POST /api/subscriptions/update` | `{token, topics[], frequency, lang}`；不可改信箱 |
| `POST /api/subscriptions/unsubscribe` | token 可在 JSON、form 或網址 `?token=`；**必須接受 RFC 8058 一鍵退訂**（`Content-Type: application/x-www-form-urlencoded`、本體 `List-Unsubscribe=One-Click`、不需 Cookie／登入、不需同源 `Origin`）；冪等；只保留「信箱＋已退訂」 |
| `POST /api/subscriptions/manage-link` | `{email}`；一律 `202` |

主題 id 只有 `news`、`documents`、`situation`、`publications`、`notices`、`careers`、`procurement`（＝RSS 頻道，見 `src/client/subscribe-rules.js` 的 `TOPIC_IDS`，測試保證與 `feeds/*.xml` 一致）。

**正式版與模擬版的差異，必須處理：** token 只存雜湊（模擬為了好看明碼存檔）、token 有過期與輪替（`manageToken` 可考慮定期換新並在信中帶新連結）、資料庫與備份、節流改在 WAF／閘道也做一層（模擬的是單機記憶體）、`Origin` 檢查以正式網域為準、`PUBLIC_ORIGIN` 固定（不要信任 `Host`）、每封寄出的信留紀錄（誰、何時、哪種信）供客服追查「我沒收到」。

### 11.2 寄件網域與郵件規範（資訊室）

| 項目 | 要求 | 為什麼 |
| --- | --- | --- |
| SPF | 寄件網域的 SPF 授權寄信服務的出口 IP／include | 不通過容易被收件方當成偽造 |
| DKIM | 寄信服務以網域金鑰簽章（2048 bit），並定期換金鑰 | 證明信件沒被改、來自授權寄信者 |
| DMARC | 先 `p=none` 觀察報告一到兩個月，再 `quarantine`／`reject`；寄報告到機關信箱 | 防止他人冒用 `@gov.tw` 類網域寄釣魚信；Gmail／Yahoo 對大量寄件者已要求 |
| 寄件地址 | 專用子網域（如 `mail.` 開頭）、獨立於一般公務信箱 | 電子報若被檢舉，不會連累一般公文往來的信譽 |
| `List-Unsubscribe` ＋ `List-Unsubscribe-Post: List-Unsubscribe=One-Click` | **每一封**寄給訂閱者的信都要有（模擬版連確認信也有），網址為 HTTPS | RFC 2369／8058；Gmail、Yahoo 對每日大量寄件者的要求；信件頂部「退訂」按鈕就是它 |
| 信件本體退訂連結 | 同樣每封都有，且不需登入 | 法律與使用者預期；與標頭互為備援 |
| 多部份內容 | `text/plain`＋`text/html` | 純文字閱讀器、無障礙工具與部分收件方的垃圾信評分 |
| 退信（bounce）與投訴（complaint） | 寄信服務回報 webhook／報表 → 硬退信（信箱不存在）立即停寄並標記；投訴（按「檢舉垃圾信」）視同退訂；軟退信連續多次後停寄 | 持續寄給不存在的信箱會傷害網域信譽 |
| 退訂與抑制清單 | 退訂與硬退信者進抑制清單，**不論之後何人再用該信箱申請，都要再走一次雙重確認** | 防止被濫用於騷擾 |
| 寄送速率 | 暖機（新網域逐步提高量）；即時通知與週摘要錯開 | 新網域一次大量寄信容易被限流 |
| 測試 | 用 `.local/outbox/` 產生的 `.eml` 當樣本，丟進寄信服務的測試工具或 mail-tester 類工具檢查標頭與評分 | 原型的 `.eml` 就是依上表組出來的 |

### 11.3 個資與隱私

蒐集的欄位只有信箱、主題、頻率、語言、同意時間（見 `content/pages/privacy.json`）。正式上線前要定：保存期限（建議：已確認者在退訂後只留抑制紀錄；未確認者 7 天內刪除，與原型一致）、寄信服務商是否境內、委外個資保護約定與稽核方式、資料外洩通報流程。這些寫進隱私權政策的正式版文字，原型版已區分「正式站規劃」與「原型現況」。

### 11.4 CSP 與前端設定

寄信服務若與網站同源（反向代理 `/api/*`）則 CSP 不用改；若另一個網域，要在 `scripts/lib/emit-headers.mjs` 的 `securityHeaders()` 的 `connect-src` 加該來源，並在 §10.1 說明；`src/client/subscribe.js` 的 `createHttpBackend({ base })` 帶 API 根網址。`/api/dev/outbox` 與 `.local/` 是開發輔助，**正式環境不得啟用**（`createSubscriptionApi({ devOutbox:false })` 或根本不掛載 `subscribe-mock.mjs`）。

### 11.5 驗收

1. 依 §11.1 逐一以 `curl` 驗證狀態碼與「回應不洩漏」（已訂閱與未訂閱信箱的 `POST /api/subscriptions` 回應位元組相同）。
2. 寄一封確認信到 Gmail、Outlook、Yahoo 與一個機關信箱：看「顯示原始郵件」中 SPF／DKIM／DMARC 皆 pass，並在 Gmail 出現「退訂」按鈕、按下後 `POST /api/subscriptions/unsubscribe` 收到 `List-Unsubscribe=One-Click`。
3. 跑 `node scripts/newsletter-digest.mjs --today=<日期>`，把範本交給寄信服務，確認 `{{manage_url}}`、`{{unsubscribe_url}}` 被替換、沒有殘留的雙大括號。
4. 在 `/subscribe/` 走完：訂閱 → 收信 → 確認 → 管理 → 退訂 → 再訂閱，且 `npm run a11y` 對 `/subscribe/` 0 違規。

## 12. 全文搜尋索引（Pagefind，第二十八輪）

`/search/`（七種語言各一頁）用 [Pagefind](https://pagefind.app/) 在瀏覽器端搜尋建置時產生的靜態索引。**沒有後端、沒有搜尋服務要維運**；索引就是 `dist/pagefind/` 底下的一堆靜態檔。設計理由見 ARCHITECTURE.md 第 31 節與 docs/architecture-decisions.md 第 20 節，這裡只講部署。

### 12.1 索引在 CI 哪裡產生

索引由 `scripts/build.mjs` 在輸出 HTML 之後直接產生（`scripts/lib/pagefind.mjs`，約 18–20 秒，3102 輸出頁中的 2330 頁進索引）。**沒有獨立的 workflow 步驟**，因為每一種建置都已經跑 `build.mjs`：

| 場合 | 有索引嗎 |
| --- | --- |
| `pages.yml` 的 `npm run build`（正式發布到 Pages） | 有。索引失敗或收不到任何頁會 `exit 1`，不會發布沒有索引的 `/search/` |
| `content-pr.yml` 的 a11y 建置（`DIST_DIR=…/a11y-dist`） | 有（axe 要掃 `/search/` 的結果列） |
| `content-pr.yml` 的預覽站建置（發到 `previews` 分支） | 有，PR 預覽站 `/pr-N/search/` 搜得到該 PR 的內容 |
| `node scripts/build.mjs --check`（治理閘門） | **沒有**（在輸出前就結束，不付 20 秒） |
| 本機 `npm run build` | 有；只想看版面可加 `PAGEFIND=off` 跳過 |

部署到其他環境（nginx／IIS／CDN）：整個 `dist/` 照搬，`dist/pagefind/` 一起；**不需要在伺服器上安裝 Node 或 Pagefind**。建置機需要 `npm ci`（`pagefind` 是 devDependency，內含各平台的原生二進位，`npm ci` 會依平台自動選；建置機若是離線環境，要先準備好 npm 鏡像）。

### 12.2 快取標頭

`dist/pagefind/` 的檔案分兩類：

| 檔案 | 檔名 | 建議 `Cache-Control` |
| --- | --- | --- |
| `index/*.pf_index`、`fragment/*.pf_fragment`、`filter/*.pf_filter`、`pagefind.<語言>_<雜湊>.pf_meta` | 含內容雜湊，內容變檔名就變 | `public, max-age=31536000, immutable` |
| `pagefind.js`、`pagefind-worker.js`、`pagefind-entry.json`、`wasm.*.pagefind` | 固定檔名 | 短快取或每次驗證（如 `max-age=300` 或 `no-cache`）；`pagefind-entry.json` 是入口，指向最新的雜湊檔，**不能被長快取**，否則使用者會一直拿到舊索引 |

這些快取標頭**不在** `dist/headers/` 輸出內（目前只輸出安全標頭）；要靠伺服器／CDN 設定，例如 nginx：

```
location ^~ /pagefind/ { add_header Cache-Control "no-cache"; }
location ~ ^/pagefind/(index|fragment|filter)/ { add_header Cache-Control "public, max-age=31536000, immutable"; }
location ~ ^/pagefind/pagefind\..*\.pf_meta$ { add_header Cache-Control "public, max-age=31536000, immutable"; }
```

（注意 10.2 的提醒：子 `location` 若有自己的 `add_header`，上層的安全標頭不會繼承，要在同一層一起放。）GitHub Pages 無法自訂標頭，預設 10 分鐘快取，直接可用。

### 12.3 MIME 與壓縮

- 索引檔副檔名是 Pagefind 自訂的（`.pf_index`、`.pf_meta`、`.pf_fragment`、`.pf_filter`、`.pagefind`）。伺服器不認得時會回 `application/octet-stream`，**搜尋照常運作**，不需要特別設定 MIME。
- `index/`、`fragment/`、`filter/`、`*.pf_meta` 的內容本身就是 gzip 位元組（開頭 `1f 8b`，Pagefind 自己壓好的），伺服器端再壓縮幾乎沒有收益（可以關掉省 CPU）；`pagefind.js`、`pagefind-worker.js` 與 `wasm.*.pagefind` 可照一般 JS／二進位壓縮。實測使用者單次搜尋下載約 180–270 KB（gzip 後），都在第一次搜尋時才載入。
- 要用的 CSP 變更見 10.1（`'wasm-unsafe-eval'`）。

### 12.4 疑難排解

| 現象 | 原因與處理 |
| --- | --- |
| `/search/` 顯示「全文搜尋無法載入，請稍後再試，或改用智慧查詢。」 | 看瀏覽器 Console／Network：`/pagefind/pagefind.js` 404 ⇒ 部署時漏了 `dist/pagefind/`；`Refused to compile or instantiate WebAssembly` ⇒ CSP 沒有 `'wasm-unsafe-eval'`（標頭沒隨新版重佈，見 10.2 第 4 點） |
| 搜尋得到舊內容 | `pagefind-entry.json` 被長快取，改成 `no-cache`（11.2） |
| PR 預覽站搜不到 | 預覽站的 `BASE_PATH` 是 `/pr-N/`，索引內網址已帶前綴（由 e2e 測過）；若仍錯，確認預覽是用新版 `build.mjs` 建的 |
| 想排除某頁不被搜到 | 該頁設 `noindex`；或在 `src/templates/public/_pagefind.mjs` 的 `pagefindFor()` 調整規則。見 docs/guide-staff.md 第 29 節 |
| 想暫時關掉索引 | `PAGEFIND=off npm run build`（`/search/` 頁仍在，但會無法載入索引；僅限本機看版面用） |

## 14. 寫入閘道、AD 登入與自架 GitLab（第三十輪）

給資訊室。**一句話：** 同事在後台按「儲存草稿／送審／退回修改／核准上線」，一支小的 Node 服務（寫入閘道，`/api/gateway/`）確認身分與角色、驗證內容，再用一個服務帳號寫進機關自架 GitLab。同事不需要 GitLab 帳號。

- 為什麼這樣設計：見 architecture-decisions §23。
- 程式契約：見 ARCHITECTURE §36。
- 同事怎麼操作：見 guide-staff §34。

```
同事瀏覽器 ──443──▶ 反向代理（IIS／nginx／Keycloak 前的 oauth2-proxy）──▶ 閘道（Node 22，只聽內網或本機）
                     │ 負責登入（三選一，見 14.3）                         │
                     └ /admin/* 靜態頁                                      ├──443──▶ 自架 GitLab（REST v4，服務帳號 token）
                                                                            ├─ .local/gateway-state.json、gateway-audit.jsonl
                                                                            └─ .local/outbox/（Email .eml、Teams 卡片 JSON）
GitLab main 更新 ──▶ GitLab CI 建置 dist/ ──▶ 對外網站（本文件 §1～§12 的部署方式不變）
```

### 14.1 閘道本身

- **程式與執行：**
  - 程式在 `scripts/lib/gateway/`，只用 Node 內建模組，沒有新的 npm 相依。
  - 原型由 `scripts/serve.mjs` 掛載，同時送後台靜態頁；本機用 `npm run dev`，`GATEWAY=off` 可關閉。
  - 正式環境可以同一支程式放在反向代理後面，以 systemd 或 Windows 服務常駐。
  - `serve.mjs` 原本是開發用伺服器，上線前請資訊室確認日誌輪替與重啟策略。
- **沒有資料庫：**
  - 狀態是一個 JSON 檔。
  - 稽核是只增不改的 JSONL，每筆帶前一筆的雜湊，竄改或刪行都驗得出來（`verifyAudit`）。
  - 狀態檔遺失時，GitLab 上的分支與合併請求仍在，可以人工收尾。
- **環境變數：** 祕密只從環境變數或祕密管理來，不進設定檔、不進 Git。

| 變數 | 用途 | 預設 |
| --- | --- | --- |
| `GATEWAY_AUTH` | `header`／`oidc`／`google`／`dev` | `dev`（只接受本機連線，**正式環境不可用**） |
| `GATEWAY_GIT` | `gitlab`／`local` | `local`（`.local/gateway-repo/`） |
| `GITLAB_URL`、`GITLAB_PROJECT`、`GITLAB_TOKEN`、`GITLAB_TARGET_BRANCH` | GitLab 位址、專案（數字 id 或 `group/project`）、服務帳號 token、目標分支 | 目標分支 `main` |
| `PUBLIC_ORIGIN` | 後台對外網址，例如 `https://cms.cdc.gov.tw`。用來判斷同源，也用在通知信的連結。**反向代理會改寫 Host 時一定要設** | 空（改用 Host 標頭） |
| `GATEWAY_CSRF_SECRET` | CSRF token 的簽章金鑰（≥ 32 位元組亂數） | 每次啟動隨機產生，重啟後同事要重新整理頁面 |
| `GATEWAY_SESSION_SECRET` | Google 模式工作階段 cookie 的簽章金鑰 | 每次啟動隨機產生，重啟後要重新登入 |
| `GATEWAY_STATE_FILE`、`GATEWAY_AUDIT_FILE`、`OUTBOX_DIR` | 狀態、稽核、寄件匣位置 | `.local/` 底下 |
| `GATEWAY_SEED_DIR`、`GATEWAY_REPO_DIR` | 只用在 `local` 模式 | |
| 各登入方式的變數 | 見 14.3 | |

- **閘道已經做的安全措施：**
  - 寫入要同源（Origin、Sec-Fetch-Site），並帶 CSRF token（依身分簽章）。
  - 只收 `application/json`，本文上限 512 KB。
  - 回應一律 `no-store`、`nosniff`、`default-src 'none'`。
  - 檔名只由驗證過的型別＋id 推出，只能寫 `content/` 底下。
  - 每個動作（含被拒絕的）都寫進稽核。

### 14.2 AD 群組（三條登入路徑共用）

閘道只問兩件事：**是誰**、**在哪些 AD 群組**。群組命名沿用 [admin-auth.md](admin-auth.md) 的 `CDC-WEB-<單位>-<角色>`，例如 `CDC-WEB-acute-infectious-editor`、`CDC-WEB-pr-chief-editor`、`CDC-WEB-oasis-governance`。單位代碼是 `content/master/units.json` 的 id 去掉 `unit.`；`DOMAIN\` 前綴與大小寫都不影響。

| AD 群組的角色 | 後台顯示 | 能做 |
| --- | --- | --- |
| `editor`、`situation-publisher` | 編輯 | 儲存草稿、送審 |
| `reviewer`、`chief-editor`、`governance` | 審核 | 加上核准、退回（自己編過的不行） |
| `platform` | 管理 | 同審核；跨單位 |

不是 `CDC-WEB-` 開頭的群組一律忽略；沒有任何這類群組的帳號，進後台會看到「沒有網站內容的角色」。

### 14.3 三條登入路徑

#### 路徑 A：Keycloak＋LDAP 聯合 AD（可加 Kerberos）

1. **Keycloak realm 與 AD 聯合：**
   - 建一個 realm（例如 `cdc`）。
   - 在 User Federation 加 LDAP：連線用 `ldaps://` 連 AD，Edit mode 設 `READ_ONLY`，Users DN 指到人員 OU。
   - 加 `group-ldap-mapper`，只同步 `CN=CDC-WEB-*` 群組。
2. **Client 與 token 內容：**
   - 建 confidential client `cdc-web-gateway`。
   - 加 Group Membership mapper：claim 名 `groups`，**關掉 Full group path**（閘道也會去掉開頭的 `/`）。
   - 加 Audience mapper，讓 access token 的 `aud` 含 `cdc-web-gateway`。Keycloak 預設的 `aud` 是 `account`，不加會被閘道拒絕。
3. **（選用）Kerberos 免輸入密碼：**
   - 在 LDAP provider 開 Kerberos。
   - 為 Keycloak 主機註冊 SPN `HTTP/<keycloak 主機 FQDN>` 並匯出 keytab。
   - 用 GPO 把 Keycloak 網址加入瀏覽器的近端內部網路區域。
4. **前端代理：** 閘道**只驗 token，不負責轉址登入**。前面要有一層 OIDC 代理（例如 oauth2-proxy），以 `--pass-access-token` 把 token 放進 `X-Forwarded-Access-Token`；或在 `Authorization: Bearer` 標頭帶 token。
5. **閘道設定：**
   - `GATEWAY_AUTH=oidc`
   - `OIDC_ISSUER=https://<keycloak>/realms/cdc`
   - `OIDC_AUDIENCE=cdc-web-gateway`
   - `OIDC_JWKS_URI=https://<keycloak>/realms/cdc/protocol/openid-connect/certs`
   - 選用：`OIDC_USER_CLAIM`（預設 `preferred_username`）、`OIDC_GROUPS_CLAIM`（預設 `groups`）、`OIDC_NAME_CLAIM`（預設 `name`）。
   - 驗章演算法只接受 RS256／PS256／ES256；換金鑰時閘道會自動重抓 JWKS。

#### 路徑 B：IIS 反向代理＋Windows 驗證（信任標頭）

1. **IIS 站台與轉送：**
   - 開 Windows 驗證（Negotiate／Kerberos 優先），關閉匿名驗證。
   - 用 ARR＋URL Rewrite 把 `/api/gateway/` 轉給閘道（`http://127.0.0.1:<port>`）。
2. **身分標頭：** 由代理設定以下標頭，每次都要**覆寫**，不能沿用瀏覽器送來的值：
   - `X-Remote-User`：取自 `{LOGON_USER}`，例如 `CDC\wang`。
   - `X-Remote-Groups`：逗號分隔的 `CDC-WEB-*` 群組。
   - `X-Remote-Name`：顯示名稱，UTF-8 百分比編碼。
   - `X-Remote-Email`：選用。
3. **群組怎麼送（要注意）：** URL Rewrite 的伺服器變數拿得到帳號，**拿不到群組清單**。要用以下其中一種：
   - 寫一小段 IIS 模組或 ASP.NET Core（例如 YARP）中介層，從 Windows 權杖讀群組、只留 `CDC-WEB-*`，再寫進標頭。
   - 由閘道自己查 LDAP：轉接器已留 `groupLookup` 介面，但**這一輪沒有實作 LDAP 查詢**。

   不論哪種，代理都必須**清掉**瀏覽器送來的 `X-Remote-Groups`，否則同事可以自己宣稱任何群組。
4. **閘道設定：**
   - `GATEWAY_AUTH=header`
   - `GATEWAY_TRUSTED_PROXIES=<IIS 的 IP 或 CIDR>`：閘道只信這些來源送來的身分標頭，其他來源帶這些標頭一律回 401 並寫稽核。
   - 閘道只聽本機或內網。
   - 標頭名稱可用 `GATEWAY_USER_HEADER`、`GATEWAY_GROUPS_HEADER`、`GATEWAY_NAME_HEADER`、`GATEWAY_EMAIL_HEADER` 改。
5. **Host 標頭：** ARR 預設不保留 Host，所以要設 `PUBLIC_ORIGIN`，或在 ARR 開 `preserveHostHeader`。

#### 路徑 C：Google Workspace

1. **建立 OAuth client（由機關 Workspace 的管理員帳號操作）：**
   - 在 Google Cloud 建一個專案。
   - OAuth 同意畫面設為 **內部（Internal）**：只有機關網域帳號能登入，外部帳號在 Google 端就被擋。
   - 建 OAuth client，類型選「網頁應用程式」，重新導向 URI 設 `https://<後台網址>/api/gateway/login/callback`。
2. **閘道設定：**
   - `GATEWAY_AUTH=google`
   - `GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`
   - `GOOGLE_DOMAIN=<機關網域>`
   - `GOOGLE_REDIRECT_URI`（同上）
   - `GATEWAY_SESSION_SECRET`
3. **閘道怎麼驗證：**
   - 登入走授權碼＋PKCE（S256），state 與 nonce 放在 10 分鐘的簽章 cookie。
   - id_token 要同時通過：iss、aud、exp、nonce、`email_verified: true`、`hd`＝機關網域、email 結尾也是 `@機關網域`。`hd` 在某些帳號不存在，只看一項不夠。
   - **前端送來的 email 一律不信**，身分只來自 Google 簽章的 id_token。
   - 登入後發 HttpOnly、Secure、SameSite=Lax 的簽章 cookie，效期 8 小時，每 15 分鐘重查一次群組。
4. **角色從哪來：** Google 的 id_token **沒有群組**，兩種來源可以並用（先查 a，查不到再看 b）：

   **(a) Google 群組鏡像 AD 群組（建議）**
   - 群組 email 用 `cdc-web-<單位>-<角色>@<網域>`，閘道會換算成 `CDC-WEB-<單位>-<角色>`。最好由 GCDS（Google Cloud Directory Sync）從 AD 同步，人事改 AD 就生效。
   - 讀取方式：建一個服務帳號，開全網域委派，只給 scope `https://www.googleapis.com/auth/admin.directory.group.readonly`。
   - `GOOGLE_ADMIN_SUBJECT` 設一位只有「群組讀取」權限的管理員帳號。
   - 金鑰檔路徑給 `GOOGLE_SA_KEY_FILE`，放在祕密管理，不進 Git。
   - 閘道呼叫的是 Admin SDK Directory API `groups.list?userKey=`。Cloud Identity Groups API 也可以，但這一輪沒有實作。

   **(b) 對照檔（試點或沒有 GCDS 時）**
   - `GOOGLE_ROLE_MAP_FILE` 指向一個 JSON：`{ "wang@<網域>": ["CDC-WEB-acute-infectious-editor"] }`。
   - 由資訊室維護；人員異動要記得改，否則會有權限落差。
5. **連外：** 同事瀏覽器要連得到 `accounts.google.com`。閘道主機要能連出到：
   - `oauth2.googleapis.com`
   - `www.googleapis.com`（JWKS）
   - `admin.googleapis.com`（只有用群組鏡像時）

#### 三條路徑比較與建議

| | A. Keycloak＋LDAP | B. IIS＋Windows 驗證 | C. Google Workspace |
| --- | --- | --- | --- |
| 建置工作量 | 中高（多養一個 Keycloak＋資料庫） | 中（IIS 設定＋一段送群組的中介層） | **低**（開一個 OAuth client） |
| 真正單一簽入 | 是（加 Kerberos 免輸入） | 是（網域電腦免輸入） | 是（Google 帳號） |
| 多因子驗證 | Keycloak 可設 OTP／WebAuthn | 依 Windows 登入，另要處理 | 2 步驟驗證（需確認是否強制） |
| 需要連到外部網際網路 | 否 | 否 | **是**（Google） |
| 群組來源 | AD（LDAP） | AD（Windows 權杖） | Google 群組（GCDS 同步）或對照檔 |
| 資安政策疑慮 | 低 | 低 | 外部雲端 IdP 管內部後台；AD 與 Workspace 不同步時，離職停權有落差 |

**建議：**
- **試點先用 C**：Workspace 已在用、已有 2 步驟驗證，資訊室工作最少。
- **正式環境**：資安政策允許後台用雲端 IdP，就沿用 C；不允許就用 A。Keycloak 可以同時接 AD 與 Google（Google 當外部 IdP），試點期的群組設計原樣搬過去。
- **B 適合**已經有 IIS、不想多養服務的情況。

三條路閘道都已實作，選哪一條只是設定，不必改程式。

### 14.4 自架 GitLab 設定

- **登入：** GitLab 本身用 LDAP（`gitlab.rb` 的 `gitlab_rails['ldap_servers']`）接 AD，給資訊室、需要查紀錄的審核者使用。**一般同事不需要 GitLab 帳號。**
- **服務帳號：**
  - 建一個專用帳號，例如 `web-gateway` bot 使用者，或使用 Project Access Token。
  - token scope 只給 `api`（建分支、提交、合併請求、合併都需要），不要給 `sudo` 或 `admin_mode`。
  - 角色給 **Developer**。
  - token 有效期最長一年，放在祕密管理，到期前換發，並寫進交接清單。
- **保護 `main`：**
  - Allowed to push：**No one**。
  - Allowed to merge：Developers + Maintainers。
  - 一般人的角色給 Reporter 以下，這樣只有服務帳號（與資訊室 Maintainer）合併得了。
  - 不要開 Force push。
- **合併方式：** 用 Merge commit，閘道會寫 `Approved-by:` trailer 到合併訊息。合併後自動刪除來源分支。
- **GitLab 上的核准只是鏡像：**
  - 所有動作都是同一個服務帳號，真正的核准人記在合併訊息的 `Approved-by:`、合併請求留言與閘道稽核。
  - 第二位核准時 GitLab 回 401（已核准過），閘道會略過，不當失敗。
  - 不需要買 Premium 的核准規則；四眼原則由閘道強制。
- **CI（待辦）：**
  - 目前的檢查在 GitHub Actions（`content-pr.yml`、`pages.yml`），要移植成 `.gitlab-ci.yml`：合併請求跑 `node scripts/build.mjs --check`、測試與無障礙掃描；`main` 跑建置與部署。
  - 若開「Pipelines must succeed」，閘道目前的「立即合併」會被 GitLab 拒絕，要改成「流水線成功後合併」（`merge_when_pipeline_succeeds`），這一輪沒做。
- **標籤：** 先建 `網站內容::審核中`、`網站內容::退回`、`網站內容::已核准`（scoped labels 需要 Premium；Free 版照樣可用，只是不會互斥）。

### 14.5 網路

| 從 | 到 | 埠 | 用途 |
| --- | --- | --- | --- |
| 同事瀏覽器 | 反向代理 | 443 | 後台頁與 `/api/gateway/` |
| 反向代理 | 閘道 | 本機或內網埠 | 只允許代理主機 |
| 閘道 | GitLab | 443 | REST v4 |
| Keycloak（路徑 A） | AD 網域控制站 | 636（LDAPS）、88（Kerberos） | 帳號與群組 |
| 同事瀏覽器、閘道（路徑 C） | Google（見 14.3） | 443 | 登入、JWKS、群組 |
| 閘道 | SMTP、Teams webhook | 25／587、443 | **尚未實作**：目前寫到 `.local/outbox/`，接郵件服務時沿用 §11 的寄信介面 |

建議閘道和 GitLab 放在同一個內網區段，閘道不對外直接開埠。

### 14.6 稽核與備份

- 稽核 `gateway-audit.jsonl` 每筆都有 `seq`、時間、帳號、姓名、單位、角色、登入方式、動作、結果、前一筆雜湊；不記 token 與內容本文。
  - 建議每日送到集中式日誌，保存一年以上，政風室可調閱。
  - 檔案本身只增不改。
- 誰改了什麼、誰核准，同時寫在 GitLab 的提交訊息（`Edited-by:`、`Approved-by:`、`Gateway-Submission:`），兩邊可以互相核對。
- 備份：`gateway-state.json` 與稽核檔納入主機備份；GitLab 依既有備份。

### 14.7 上線前驗收清單

1. `GET /api/gateway/health` 回 `{ ok: true, auth: '<選定的模式>' }`。
2. 一位只有 `editor` 群組的同事：能存草稿、送審，**看不到**核准按鈕。
3. 同單位另一位 `reviewer`：在複核區看到那一筆，能退回（沒寫意見會被擋）；承辦人收到通知，修改後再送審。
4. 審核人按核准上線：GitLab `main` 多一個合併提交，作者是服務帳號，訊息有 `Edited-by:` 與 `Approved-by:`；GitLab CI 建置後網站更新。
5. 承辦人兼審核人：對自己編過的內容按核准，會被擋（四眼原則）。
6. 別的單位的審核人：看不到這一筆。
7. 偽造測試：從非代理主機直接打閘道並帶 `X-Remote-User`，回 401（路徑 B）；從別的網站送 POST，回 403。
8. 稽核檔：上述每一步都有紀錄，`verifyAudit` 驗證通過。

### 14.8 資訊室要回答的問題

1. **登入路徑：** 機關有沒有 AD FS 或 Microsoft Entra ID？有的話也可以當 OIDC 來源（走路徑 A 的 `oidc` 轉接器，`groups` claim 設法同上）。
2. **能不能自架 Keycloak？** 包含資料庫、憑證、升級與值班。不行的話，能不能用既有 IIS 做路徑 B，並寫那一段送群組的中介層？
3. **Google Workspace：**
   - 有沒有用 GCDS 從 AD 同步帳號與群組？
   - Workspace 管理員能不能建立「內部」OAuth client 與唯讀服務帳號（全網域委派）？
   - 2 步驟驗證是否已對全機關**強制**？
   - 資安政策是否允許後台以外部雲端 IdP 登入？
4. **主機位置：** 閘道放哪裡（和 GitLab 同一區段？DMZ 還是內網？），同事從哪些網段連後台，在家能否透過 VPN 使用？
5. **GitLab：**
   - 版本、Free 或 Premium？
   - 服務帳號用 bot 使用者還是 Project Access Token？
   - token 換發由誰負責？
   - 要不要開「Pipelines must succeed」（會影響 14.4 的待辦）？
6. **通知：** 通知要接哪個 SMTP 或 Teams webhook？是否允許閘道主機連出到 Teams？
7. **稽核：** 稽核檔要送到哪一套集中式日誌，保存多久？
