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

- **觸發：** push 到 `main`、每日 03:00 UTC（台灣 11:00）排程、手動 `workflow_dispatch`。
- **build 工作：** checkout → Node 22 → `npm ci` → `npm test`（只驗 repo 內的內容與快照）→ `npm run fetch`（失敗不中斷）→ `npm run build`（`BASE_PATH` 取自儲存庫名稱、`SITE_URL` 取自擁有者）→ 上傳 `dist/`。
- **deploy 工作：** `actions/deploy-pages` 發布，網址 `https://ancientsky.github.io/new_cdc_prototype/`。
- **併發：** 同一時間只保留最新一次部署，舊的會被取消。

第一次啟用：儲存庫 Settings → Pages → Build and deployment → Source 選 **GitHub Actions**。workflow 內的 `configure-pages` 步驟帶 `enablement: true` 嘗試自動啟用，若權限不足仍須手動設定。

### 每日排程為什麼重要

逾期、資料集時效這類「隨時間改變的狀態」只有重建才會更新。每日排程確保：內容到期當天（隔天建置後）頁首就出現黃色警示並退出白名單，旅遊疫情與資料目錄快照一日一更。若排程連續失敗，網站不會壞，但治理狀態會停在最後一次成功建置——資訊室請把 Actions 失敗通知（Watch → Custom → Workflows）設給值班信箱。

### 發布前的閘門

CI 任一項失敗即不部署：JSON Schema 與跨檔參照（`owner`、`basedOn`、`supersedes` 必須存在）、治理規則測試、**評估集版本題 100%**（`CI=true` 時，未全對會讓建置以非零狀態結束）。

### 疑難排解

| 現象 | 檢查 |
| --- | --- |
| 建置顯示「治理門檻未通過」 | 看錯誤清單，通常是缺必填欄位或 id 打錯；本機 `npm run check` 重現 |
| 部署後樣式全沒了 | `BASE_PATH` 與實際網址不一致 |
| 版本題未全對 | 看輸出的失敗題與原因，通常是舊版仍在白名單，或新版缺 `machineReadableMarkdown` |
| 旅遊疫情日期很舊 | 看 `data/snapshots/*.json` 的 `meta.mode` 與 `fetchedAt`，確認 `npm run fetch` 是否被來源擋下 |
| 等級表出現幾十個第二級國家、或 2020 年的 COVID 第三級 | 官方 `CountryEpidLevel/ExportJSON` 是「歷次警示的完整歷史」（只有生效日、沒有結束日）。fetch 把它當事件日誌處理：同國家×疾病×區域只看最新一則，最新為「解除」（`severity_level` = 解除）就不列；再排除明顯歷史紀錄（2023-05-01 前的 COVID、第三級逾 365 天），最後以合理性閘門（第三級 ≤5、第二級 ≤20、第一級 ≤60 國）把關；不過關就沿用人工校對快照，原因寫在 `meta.lastLiveAttempt`，CI log 另印「等級表診斷」行供對照官方欄位 |
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

- 儲存庫分支保護：`main` 要求 PR、至少一位複核者核准、CI 綠燈才可合併；`content/governance/` 目錄建議設 CODEOWNERS 為 OASIS，`content/situation/` 為疫情中心，避免跨單位誤改。
- 緊急暫停 AI 的 PR 可由資訊室與 OASIS 值班人直接合併，事後補審。
- 前端不放任何伺服器金鑰。BYOK 金鑰只存使用者瀏覽器。
- 所有 HTML 由 `html` 標籤模板輸出，插值預設跳脫，只有 `raw()` 包起來的才不跳脫；Markdown 經 `marked` 的安全設定處理。審查 PR 時，凡新增 `raw()` 呼叫都要特別看一眼。
- 依賴極少（三個套件），降低供應鏈風險；升級時看 `npm audit` 並跑完整測試。
