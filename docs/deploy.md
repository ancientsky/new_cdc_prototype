# 部署與維運

> 給誰看：資訊室、OASIS，以及要擴充內容型別或修改 schema 的工程同事。
> 需求：Node.js 22 以上（CI 使用 22；`.nvmrc`、`.node-version` 也是 22。pdfjs-dist 需要 `Promise.withResolvers`，Node 20 跑不了 PDF 閘道測試，見 Issue #105）。依賴只有 `ajv`、`ajv-formats`、`marked`。

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
| `PAGEFIND_VERIFY` | （開） | `off` 略過建置後的全文索引召回自我檢查（第四十輪，§12.5） |
| `PAGEFIND_RECALL_MIN` | `0.98` | 自我檢查的召回下限；低於它時 `--check`／CI 建置失敗（§12.5） |
| `ASK_DATA_BUDGET_KB` | `445` | 答案頁提問時下載的 JSON（gzip 估算）上限，超過建置失敗（第四十輪，§15） |
| `INTL_FEED_URL` | 空 | **只給 `npm run fetch`（CI 從 secrets 帶入）**：疫情中心國際疫情資料庫的匯出網址（交換格式 v1 或 CSV）；空＝維持現行官網 `TravelEpidemic/ExportJSON`。可能是內網位址：不寫進快照、不印進 log（第四十三輪，docs/intl-epidemic.md） |
| `INTL_FEED_TOKEN` | 空 | 兩個用途：(1) `npm run fetch`／`npm run intl:import <URL>` 拉取時當 `Authorization: Bearer`；(2) 閘道的推送端點 `POST /api/intl-epidemic` 驗證中心送來的 Bearer，沒設時端點回 503。CI 放 GitHub secrets（或 GitLab CI 的 masked variable），閘道放主機的祕密管理；拉與推建議用不同的值（正式上線時可拆成兩個變數） |

`--today=YYYY-MM-DD` 參數效果同 `BUILD_TODAY`。**所有連結都必須經 `ctx.url()`（伺服器端）或 `window.CDC.url()`（瀏覽器端）產生**，直接寫死 `/xxx` 會在子路徑部署時壞掉。

## 2. GitHub Pages 與 workflow

檔案：`.github/workflows/pages.yml`。

- **觸發：** push 到 `main`、**每 2 小時排程**（偶數整點 UTC；第九輪起，讓 `publishAt` 排程發布到點上線）、手動 `workflow_dispatch`（輸入 `refresh`，預設 true）。
- **build 工作：** checkout → Node 22 → `npm ci` → 還原 Chromium 快取（沒命中才下載一次；給 `content-pr.yml` 的程式 PR 用，§28.5）→ lint、format、typecheck → `npm test`（只驗 repo 內的內容與快照）→ **只在 02:00 UTC（台灣 10:00）那一次排程與手動執行（`refresh` 不是 false）時**跑 `npm run fetch`（失敗不中斷）並把快照 commit 回 `main` → 取出 `previews` 分支（PR 預覽，不存在就略過）→ `npm run build`（`BASE_PATH` 取自儲存庫名稱、`SITE_URL` 取自擁有者；建置把預覽複製到 `dist/preview/`）→ 上傳 `dist/`。
- **deploy 工作：** `actions/deploy-pages` 發布，網址 `https://ancientsky.github.io/new_cdc_prototype/`。
- **併發：** 同一時間只保留最新一次部署，舊的會被取消。

第一次啟用：儲存庫 Settings → Pages → Build and deployment → Source 選 **GitHub Actions**。workflow 內的 `configure-pages` 步驟帶 `enablement: true` 嘗試自動啟用，若權限不足仍須手動設定。

### 每日排程為什麼重要

逾期、資料集時效、排程發布這類「隨時間改變的狀態」只有重建才會更新。排程（每 2 小時）確保：內容到期當天頁首就出現黃色警示並退出白名單，`publishAt` 到點後最晚 2 小時內上線；旅遊疫情與資料目錄快照仍是一日一更（02:00 UTC 那一次）。若排程連續失敗，網站不會壞，但治理狀態會停在最後一次成功建置——資訊室請把 Actions 失敗通知（Watch → Custom → Workflows）設給值班信箱。

### PR 車道、預覽與自動合併（第九輪）

另有三個工作流程負責「內容 PR」（細節與設計理由見 [publishing-lanes.md](publishing-lanes.md)）：

| 檔案 | 觸發 | 做什麼 |
| --- | --- | --- |
| `.github/workflows/content-pr.yml` | `pull_request`（開啟／更新／重新開啟）、`pull_request_review`（提交審核） | 判定純內容或程式 PR（第五十六輪，§28）→ 測試（純內容 PR 只跑內容子集）→ `build --check` → `scripts/lane.mjs` 判定車道 → 以 `BASE_PATH=…/preview/pr-{N}` 建置預覽（程式 PR 的 axe 也掃這份）並推到 `previews` 分支 → PR 留言與 `lane:*` 標籤 → 快車道／緊急發布檢查全過即 squash 合併；一般車道有核准且檢查全過才合併 → 觸發 `pages.yml` |
| `.github/workflows/preview-cleanup.yml` | PR 關閉、每日 01:41 UTC、手動 | 刪除 `previews` 分支的 `pr-{N}/`；**沒有合併就關閉**的 PR 才重新部署（合併的 push 已經部署一次，見 2.1）。自動合併的 PR 不會觸發 `closed`，分支上的目錄由每日排程補清 |
| `.github/workflows/lane-sla.yml` | 每小時 | 開啟中的 PR 超過車道 SLA ⇒ 留言並加 `sla:breach` |

流程（一個內容 PR 從開啟到上線）：

```
PR 開啟／更新 ─▶ content-pr.yml
   git diff --name-only --no-renames origin/main...HEAD                  # 全在 content/、data/snapshots/ ⇒ 純內容 PR（§28）
   npm ci → 個資掃描 →（程式 PR）lint、format、typecheck、npm test ／（純內容 PR）npm run test:content
   → BUILD_TODAY=2026-10-01 node scripts/build.mjs --check
   → node scripts/lane.mjs --files-from=<上面的清單>                     # 車道、審核人、SLA（JSON）
   → 建置預覽（BASE_PATH=/new_cdc_prototype/preview/pr-N、LINK_CHECK=warn、PREVIEW_SCHEDULED=1；只建這一次）
   →（程式 PR）還原 Chromium 快取、playwright install、axe 掃同一份預覽 dist
   → 推到 previews 分支 pr-N/（孤兒快照提交、force-with-lease，失敗重試）
   → PR 留言（含 <!-- lane-bot -->，之後原地更新）＋ 標籤 lane:emergency｜lane:fast｜lane:standard
   → 快車道／緊急發布：檢查全過 ⇒ gh pr merge --squash --delete-branch --match-head-commit <檢查過的 head>
     一般車道：每位審核人最新一則審核為 APPROVED 且檢查全過 ⇒ 合併；否則留言「等待審核：需 N 位核准；SLA 至 …」
   → gh workflow run pages.yml --ref main -f refresh=false
審核人按 Approve ─▶ content-pr.yml（pull_request_review）重跑檢查 ⇒ 合併 ⇒ 觸發 pages.yml
pages.yml（push main／每 2 小時／手動）
   npm test →（02 UTC 排程或手動 refresh）npm run fetch ＋ 快照回寫 main
   → git fetch origin previews → 取出到 $RUNNER_TEMP/previews（PREVIEWS_DIR；分支不存在就略過；已合併／關閉的 pr-N/ 在這裡就丟掉）
   → npm run build（publishAt 未到的內容不輸出；連結檢查之後把 pr-N/ 複製到 dist/preview/）→ 上傳 dist/ → 部署
PR 關閉 ─▶ preview-cleanup.yml：刪 previews/pr-N/ →（只有沒合併就關閉的 PR）觸發 pages.yml；每日排程補清自動合併的 PR
每小時 ─▶ lane-sla.yml：lane:* 標籤＋PR 建立時間超過 SLA ⇒ 留言＋sla:breach（已有標籤就跳過）
```

### 2.1 為什麼同一個 PR 會在 Actions 看到好幾次執行（第三十八輪）

同事看 Actions 的「All workflows」頁，一個修正（例如 PR #65）會出現五、六列，問是不是重複做工。對照 PR #65 的實際紀錄，每一列各有用途，只有一列是真的重複：

| 順序 | 列上寫的 | 觸發原因 | 做了什麼 | 時間 |
| --- | --- | --- | --- | --- |
| 1 | Content PR lane … Pull request #65 opened | PR 開啟 | 全部檢查（測試、lint、治理閘門、無障礙、個資）＋建預覽、推 `previews` 分支、留言、貼標籤 | 約 4.5 分鐘 |
| 2 | Build and deploy … Manually run by github-actions | 第 1 列最後一步 `gh workflow run pages.yml` | 重新部署主站，讓 `/preview/pr-65/` 能打開（主站內容不變） | 約 2 分鐘 |
| 3 | Merge pull request #65 … pushed by ancientsky | 人工按下 Merge，`main` 有新 commit | 部署含這次修正的主站 | **被第 5 列取消**（跑了 24 秒） |
| 4 | Preview cleanup … Pull request #65 closed | PR 關閉事件 | 從 `previews` 分支刪掉 `pr-65/` | 18 秒 |
| 5 | Build and deploy … Manually run by github-actions | 第 4 列最後一步 `gh workflow run pages.yml` | 再部署一次主站，這次 `/preview/pr-65/` 不見了 | 約 2.5 分鐘 |

- 第 1、2 列是**預覽**：審核人要在 PR 合併前看到成品，所以 PR 一開就先建一次、部署一次。
- 第 3 與第 5 列才是真的重複：兩次都是部署同一個 commit，差別只在第 5 列少了 `pr-65/`。`pages.yml` 的 `concurrency: cancel-in-progress` 會把先跑的取消，所以**實際上網站只部署一次**，沒有壞處，但列表上多一列「取消」，看起來像出錯，也白白排了一次 runner。
- 為什麼以前要這樣：第 3 列開始時可能還沒等到第 4 列刪目錄就把 `previews` 分支取走了，若不再部署一次，`/preview/pr-65/` 會留到下一次排程。

第三十八輪的做法：把「這個 PR 還開著嗎」的判斷移到 `pages.yml` 取預覽的那一步（用 `gh pr view --json state` 問一次，已合併／關閉的 `pr-N/` 直接不放進 `dist/preview/`，查不到狀態就保留）。於是合併的 push 觸發的那一次部署就是最終版，`preview-cleanup.yml` 在 PR **是合併關閉**時不再觸發第二次部署（`github.event.pull_request.merged != true` 才觸發），只有「沒合併就關閉」的 PR 沒有 push、才由它觸發。附帶的好處：自動合併（機器人用 `GITHUB_TOKEN` 合併，GitHub 不發 `closed` 事件）的預覽，以前要等每日排程清理才消失，現在合併後的第一次部署就沒有了。

為什麼不乾脆拿掉其中一個工作流程：

- 檢查在 PR 上跑一次（第 1 列）、合併後在 `main` 上再跑一次（第 3／5 列的 `npm test`），**不是重複**。PR 上測的是分支當時的內容，合併後 `main` 是「分支＋別人後來合併的東西」，兩者可能不同；2026-10-11 PR #63 合併後主站建置 #189 就在 `main` 上失敗過一次（`tests/round28-newsletter.test.mjs` 啟動本機伺服器逾時，屬偶發），PR 上並沒有看到。
- 審核人按 Approve 會讓第 1 列整個重跑一次（`pull_request_review` 事件）：這是為了「核准＋檢查都過才合併」必須再確認一次檢查結果；若覺得太慢，可以把這一次改成只讀上一輪的結論，列在待辦。
- 每 2 小時的排程部署（偶數整點）與這些無關，是讓排程發布與逾期狀態跟著時間更新（見上一節）。

改完之後一個人工合併的 PR 應該看到四列：PR lane、預覽部署、合併部署、Preview cleanup（不再有「取消」那一列）。若之後又看到同一個 commit 連續兩次「Build and deploy」，先看第二次是誰觸發的（`Manually run by github-actions` 代表是其他工作流程用 `gh workflow run` 叫的），再對照這張表。

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

### 2.2 content-pr 的信任邊界：test／lane 兩個 job，與格式、型別檢查（第四十輪，#81、#82）

**問題**：拆分前 `content-pr.yml` 只有一個 `lane` job，同時有 `contents`、`pull-requests`、`issues`、`actions` 的寫入權限，又在同一個 job 裡 `npm ci`、`npm test`、`npm run build`。PR 的 `package.json` 腳本、相依套件的 `postinstall`、測試檔都在這個 job 裡執行，能讀到有寫入權的 `GITHUB_TOKEN`（可以推 `previews` 分支、合併自己的 PR、改標籤）。Dependabot 升版 PR 就是同 repo 分支，等於「相依套件被入侵」可以直接變成「對 repo 寫入」。

**做法**：

| job | 權限 | 做什麼 | 不做什麼 |
| --- | --- | --- | --- |
| `test` | `contents: read` | checkout（`persist-credentials: false`）、判定純內容／程式 PR（第五十六輪，§28）、`npm ci`、個資掃描、lint、`format:check`、`typecheck`、`npm test`（純內容 PR 改跑 `test:content`，程式檢查略過）、`build --check`、`scripts/lane.mjs`、預覽建置（只建一次）、a11y（掃預覽 dist）；最後把各步驟 outcome、`lane.json`、a11y 摘要（`lane-result` artifact）和預覽 dist（`preview-dist` artifact）上傳 | 沒有任何寫入；job 層級環境變數沒有權杖，只有「查作者 team」那一步（只跑 `gh`）帶 `GITHUB_TOKEN` |
| `lane` | `contents`／`pull-requests`／`issues`／`actions: write` | `actions/download-artifact` 下載、驗證、`gh` 留言與標籤、`git` 推 `previews` 分支、`gh pr merge`、`gh workflow run pages.yml` | **不 checkout、不 setup-node、不 `npm`、不 `node`、不執行 repo 內任何腳本** |

兩個 job 之間的規矩：

- **artifact 一律當不可信資料**。`lane` job 的「Validate results」先檢查：結果檔存在且是合法 JSON；每個步驟 outcome 只接受 `success|failure|skipped|cancelled`，其他值（含夾帶換行）一律變 `invalid`（`invalid` 不等於 `success`，所以擋合併）；車道、標籤、`autoMerge`、`requiredApprovals` 要符合固定格式；`lane.json` 的檔案清單必須涵蓋 PR 實際改到的每個檔（不能少報程式變更來走快車道；第五十六輪起清單改用檔案 API 取，含改名前的路徑）。第五十六輪起，「純內容 PR」與合併閘門 `GATE` 也在這一步由 lane job 自己判定，不採信 artifact（§28.3）。通過的值才寫進 `GITHUB_ENV`，所以 artifact 不可能夾帶額外的環境變數。驗證不過 ⇒ 留言「無法判定」、不合併、job 失敗。
- **PR 留言改用 `jq` 產生**（以前是 `node --input-type=module -e`）：`jq` 程式寫在 workflow 裡，不來自 artifact，也不是 repo 的檔案。Node 只能執行 repo 內容，而 `lane` job 沒有 checkout，要用就得 checkout，等於把 PR（或 main）的程式放進有寫入權的 job；`jq`／`bash` 是 runner 內建，沒有這個問題。若將來真的需要 Node（例如更複雜的留言），只能 checkout **main**（`ref: main`）而不是 PR，並且在這裡說明理由；測試 `tests/round40-ci-isolation.test.mjs` 目前會擋掉 `lane` job 裡任何 `node`／`npm`／`checkout`，要放寬得同時改測試。
- 預覽 dist 是 PR 建置出來的檔案，`lane` job 只複製進 `previews` 分支、不執行。這與拆分前相同：預覽內容本來就公開在 GitHub Pages，審核人看的就是 PR 作者能控制的輸出。
- `test` job 失敗（檢查沒過）時，`lane` job 仍然執行（`if: ${{ !cancelled() }}`），這樣 PR 留言和 `lane:*` 標籤照常更新；`test` 與 `lane` 最後都有「Fail when checks failed」步驟，所以 Actions 上兩個 job 都紅。`main` 規則集的必要狀態檢查請用 `test`（第六十輪，§29.1：`lane` job 自己呼叫 `gh pr merge` 時還在執行中，要求 `lane` 成功會把自己擋住）。
- ~~殘留風險：`lane.json` 是 `test` job 用 PR 的 `scripts/lane.mjs` 與 `lanes.json` 算的，惡意 PR 可以在 `test` job 裡偽造「快車道、自動合併」。~~ **第六十輪已補（Issue #125，§29.2）**：`lane` job 依 API 檔案清單核對——不是純內容、或改到 `content/governance/`、`content/master/` 的 PR，一律覆寫為一般車道、不自動合併、至少 1 位核准；artifact 說什麼都沒用。「改車道規則的 PR 走哪條路」的答案是：一般車道，由 OASIS 審。

**若未來要接受 fork 的 PR**：

- **不要改成 `pull_request_target`**。它在 base 分支的脈絡執行、預設帶寫入權杖；只要有一個步驟 checkout 或執行 PR 的程式碼，就是把寫入權杖交給 PR 作者（"pwn request"）。測試 `round40-ci-isolation` 會擋掉任何工作流程出現 `pull_request_target`。
- 現在的做法本來就能延伸到 fork：`test` job 跑 `pull_request`（fork 的 PR 只拿到唯讀權杖、拿不到 secrets），把結果交給另一個 job。標準寫法是第二個工作流程用 `workflow_run`（`workflows: [Content PR lane]`、`types: [completed]`）在 base 分支的脈絡執行，下載 `test` 的 artifact、驗證後留言與貼標籤；它同樣不 checkout、不執行 artifact 內容。fork 的 PR 要不要自動合併是另一個政策問題，建議一律走一般車道＋人審。
- 目前 `SAME_REPO` 檢查維持：fork 的 PR 只會跑 `test` job 並在 `lane` job 失敗時顯示結果，不推預覽、不留言、不合併。
- 任何時候都不要把 `secrets.*` 放進 `test` job，也不要讓 `test` job 的輸出（artifact、job outputs）未經驗證就變成命令列、檔案路徑或 `GITHUB_ENV`。

**`preview-cleanup.yml`**：權限原本掛在工作流程層級（`contents: write`、`actions: write`、`pull-requests: read`），之後新增的任何 job 都會自動繼承。現在工作流程層級是 `permissions: {}`，三項放進 `cleanup` job；這個 job 沒有 checkout，不會執行 repo 內的程式。三項都是必要的：推 `previews` 分支、觸發 `pages.yml`、排程掃描時用 `gh pr view` 查 PR 狀態。

**Actions 的 SHA**：新增 `actions/upload-artifact`（v4.6.2，2026-10-12 經 Dependabot 升至 v7.0.2）與 `actions/download-artifact`（v4.3.0，同日升至 v8.0.2），一樣固定 40 字元 commit SHA 並註解版本，Dependabot 會升版；SHA 已加進 `tests/lanes.test.mjs` 的釘死清單，升版 PR 要同步改那兩行（見 9.1）。

**本機沒辦法跑 Actions，所以怎麼驗證**：`tests/round40-ci-isolation.test.mjs` 對每個工作流程的每個 `run` 區塊跑 `bash -n`；把 `lane` job 的「Validate results」步驟用假的 `gh`、假的 `GITHUB_ENV` 真的跑一遍（正常結果、少報檔案、不明車道、夾帶換行的 outcome）；把留言的 `jq` 程式餵真實的 `lane.mjs` 輸出。**測不到的**：`upload-artifact`／`download-artifact` 的實際行為（路徑、隱藏檔、保留天數）、`GITHUB_ENV` 在 step 之間的傳遞、`if:` 運算式的求值、`needs`＋`!cancelled()` 的排程。第一個用這個流程的 PR 請看一次 Actions 紀錄與 PR 留言。

#### 格式與型別檢查（#82）

- `npm run format:check` 與 `npm run typecheck` 進 `content-pr.yml` 的 `test` job（與 lint 並列，各自 `continue-on-error`，不會讓後面的步驟不跑；結果進留言表格、`blocked` 判斷與失敗訊息），`pages.yml` 的「Lint」步驟也加上 `format:check`。以前 `format:check` 不在任何工作流程裡，main 上紅了好幾輪沒人發現。
- Prettier 仍然只強制用在 `.prettierignore` 放行清單的新檔，不會要求重排既有程式碼；新增檔案時記得把它加進放行清單。
- `tsconfig.json` 的 `checkJs` 改成 `false`：只檢查檔首有 `// @ts-check` 的檔。`checkJs: true` 會把被 import 的檔也一起檢查（例如 `stats.js` → `render.js` → `core.js`，十二萬位元組），無法逐檔擴大。型別只用 JSDoc 補，不改程式邏輯；`window.CDC` 這類全域的型別宣告在 `src/client/globals.d.ts`。
- 已納入：`src/client/answer/` 的 `inline.js`、`llm-key.js`、`stats.js`、`factcheck.js`（原本已納入的是 `scripts/lib/lanes.mjs`、`validate.mjs`、`gateway/*.mjs`）。
- **擴大順序**（由小到大、由少依賴到多依賴；每一步都是「加 `// @ts-check` → 加進 `tsconfig.json` 的 `include` → 修型別錯誤」，一次一個 PR）：
  1. `data.js`（9 KB，`stats.js`／`factcheck.js` 已經 import 它；只依賴 `window.CDC` 與 `fetch`）
  2. `judge.js`（11 KB）、`lexicon.js`（11 KB，大多是資料表）
  3. `text.js`（13 KB，純函式，`core.js` 的基礎）
  4. `ui.js`（15 KB，DOM 事件；要先處理 `HTMLElement` 的型別轉換）、`llm.js`（16 KB）
  5. `structured.js`（20 KB）
  6. `rules.js`（36 KB）、`render.js`（40 KB，與拒答／AI 標籤等區塊的修改衝突最多，放在引擎穩定之後）
  7. `core.js`（121 KB）最後；它現在被 `stats.js` 等 import 時不會被檢查（`checkJs: false`），但一進 `include` 會有上百個錯誤（`Property 'qWeights' does not exist on type 'any[]'` 之類，要先替資料結構補 `@typedef`），建議拆成多個 PR 或先拆檔。
  - 太大先不納入的理由：一次修上百個型別錯誤的 PR 無法審，而且和同時進行的功能 PR 衝突；逐檔納入每個 PR 都小、都能獨立回復。

#### 無障礙殘留項（#83）

見 [a11y.md](a11y.md) 第 4 節末的「第四十輪」表與第 5 節（`npm run a11y` 現在輸出 moderate／minor 警告數，PR 留言的「無障礙檢測」列會顯示「另有 N 項 … 警告，不擋合併」）。

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
11. **車道與其他登錄（第六十輪補記，Issue #127 新增 `theme` 時發現缺漏）**：`content/governance/lanes.json` 把型別放進一條車道（`validateLanes` 要求每個型別都有車道，`tests/lanes.test.mjs` 會擋）、`scripts/lib/lanes.mjs` 的 `DIR_TYPE` 加目錄 → 型別、`src/templates/admin/_partials.mjs` 的 `TYPE_LABEL`、`tests/helpers.mjs` 的 `COLLECTION_OF`。**沒有頁面的型別**（如 `banner`、`theme`，`pathOf` 回 `/`）另要加進 `emit-seo.mjs` 的 `NO_PAGE_TYPES`，並考慮是否排除在 `v1/catalog.json` 之外。

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
  - `npm run build`：最後會印「JS 壓縮」「JS 預算」「答案頁資料傳輸量」三行（公開頁 120 KB、含答案引擎的頁 240 KB，第三十四輪由 320 KB 下修；第四十輪起引擎頁分列「立即載入」與「提問後合計」，240 KB 套在合計上；資料傳輸量見 §15）；預算以**壓縮後**大小計，超過即失敗，可用 `JS_BUDGET_KB`／`ENGINE_JS_BUDGET_KB` 暫時調整。每季看一次最大值有沒有往上爬。壓縮用 esbuild（devDependency，`npm ci` 會裝）；`MINIFY=off` 可輸出未壓縮的 dist 方便除錯，此時預算只回報不擋（guide-staff §38、ARCHITECTURE 40）。

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

- 儲存庫分支保護：`main` 要求 PR、CI 綠燈才可合併；**核准人數由發布車道決定**（一般車道 1 位，快車道與緊急發布 0 位，見上方「PR 車道」注意事項，不要設原生的「需 N 位核准」）；`content/governance/` 目錄建議設 CODEOWNERS 為 OASIS，`content/situation/` 為疫情中心，避免跨單位誤改。**原型目前沒設**（2026-10-25 查：規則集 0 個），可匯入的規則集在 `.github/rulesets/main.json`，步驟與取捨見 §29.1（第六十輪，Issue #124）。
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
- **升 action 的 PR 會紅燈是預期的**：`tests/lanes.test.mjs` 寫死 `checkout`、`setup-node`、`deploy-pages`、`upload-artifact`、`download-artifact` 的 SHA（確保沒人偷偷換回可移動的 tag），`tests/round40-ci-isolation.test.mjs` 另外寫死 lane job 唯一允許的 `download-artifact` SHA（沒有版本註解，grep 版本號找不到它，要用 SHA 搜）。升版時先 `grep -rn 舊SHA tests/ docs/` 找出所有釘死處，再換成 PR 裡的新值；SHA 格式另由 `tests/round23-security.test.mjs` 檢查。
- **升 major 版要看什麼**：讀 release notes 的 breaking changes，跑 `npm test`、`node scripts/build.mjs --check`，再把升版前後的 `dist/` 逐檔比對（`diff -rq`），只剩時間戳差異才算安全。2026-10-10 升 `marked` 15→18 的差異只有 `&`→`&amp;` 與空白行。
- **2026-10-12 `upload-artifact` v4.6.2→v7.0.2、`download-artifact` v4.3.0→v8.0.2（PR #86）**：紅燈正是上面那條釘死清單，PR 的 lint／格式／型別／治理閘門／無障礙／預覽建置全綠，只有 `npm test` 的 `content-pr.yml` 測試不過。release notes 裡會影響我們的只有三點，都不用改 workflow：(1) 兩個 action 改用 Node 24 執行，GitHub 代管 runner 已支援，自架 runner 要 2.327.1 以上；(2) `download-artifact` v8 起 SHA256 比對不符預設直接失敗（之前只警告），對 lane job 反而更安全，因為它下載的 `lane.json` 就是合併決策的依據；(3) v7／v8 新增「不壓縮直接上傳單檔」選項（`archive: false`），我們沒用，維持預設打包。驗證方式：`git ls-remote https://github.com/actions/upload-artifact refs/tags/v7.0.2` 確認 SHA 與 PR 一致，再把 `tests/lanes.test.mjs` 的兩行換新。
- **已知的行為變化**：`actions/upload-pages-artifact` v4 起不打包點開頭的檔案與目錄（`.nojekyll`、`.well-known/`）。目前沒影響；`/.well-known/security.txt` 因此改為建置時同時輸出到根目錄 `/security.txt`（見 10.4）。
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

### 10.4 security.txt、DNSSEC、CAA 與相似網域監控（第六十輪，Issue #128）

**為什麼要做：** 資安研究者或民眾發現漏洞、仿冒網站時，需要一個固定、機器可讀的地方知道「該通報給誰」。[RFC 9116](https://www.rfc-editor.org/rfc/rfc9116) 的 `security.txt` 就是這個約定；防詐騙上，網域本身的防護（DNSSEC、CAA）與仿冒網域監控也同樣重要。公民面的說明在 `/about/official-site/`（辨識官方網站與通報仿冒網站）。

**建置輸出什麼、在哪裡：** `scripts/lib/emit-seo.mjs` 的 `buildSecurityTxt()` 在每次建置寫出兩份**內容相同**的純文字檔（UTF-8、LF）：

| 路徑 | 說明 |
| --- | --- |
| `dist/.well-known/security.txt` | RFC 9116 的標準位置 |
| `dist/security.txt` | RFC 允許的根目錄備援位置 |

**為什麼兩份：** GitHub Pages 用的 `upload-pages-artifact` v4 起不打包點開頭的目錄（見 9.1），`.well-known/` 會被丟掉，原型站上只有根目錄那份可用。正式站（自有主機或 CDN）兩份都會被提供，檢測工具讀標準位置。

欄位：`Contact`（見下）、`Expires`（建置時間＋90 天，ISO 8601、結尾 Z；站台每 2 小時重建，所以永遠不會過期，若部署停擺超過 90 天才會失效，這也是想要的警示）、`Policy`（`/policy/security/` 的絕對網址）、`Preferred-Languages: zh-TW, en`、`Canonical`（標準位置網址）。**不簽章**：PGP 簽章在 RFC 中是選用；簽章要有人管金鑰與到期，原型階段不值得，正式站若資安規範要求再加。

**上線前資訊室要做的事：**

1. **填 `security.contact`**（`site.config.mjs`，`mailto:資安通報信箱` 或 https 網址）。目前是 `null`，security.txt 的 `Contact` 退回聯絡頁 `/contact/` 的絕對網址，這只是占位；`/about/official-site/` 內文的「（待資訊室填入）」也要同步改成實際信箱。
2. **在網域啟用 DNSSEC**：防止 DNS 回應被竄改而把民眾導到仿冒主機（向網域註冊管理單位或 DNS 代管方啟用並確認 DS 紀錄）。
3. **發布 CAA 紀錄**：只允許機關實際使用的憑證機構簽發憑證，降低有人為本站網域偽造憑證的風險。
4. **監控相似網域**：定期查 `cdc.gov.tw` 的錯字網域（typosquat）、同形字與 punycode（`xn--`）網域，可用憑證透明度紀錄（CT log）的訂閱或網域監控服務；並事先講好**下架流程**（向註冊商、主機商、`165` 與 TWCERT/CC 通報的窗口與格式）。
5. **`Expires` 保持新鮮**：重建就會更新，不需手動改；但若正式站的建置排程停了，要有告警。
6. **驗證：** `curl -s https://<網域>/.well-known/security.txt` 與 `curl -s https://<網域>/security.txt`，確認兩份都回 200、`Content-Type: text/plain`，且 `Contact`、`Expires` 為預期值。

### 10.5 指紋標頭（第六十二輪，Issue #141）

`Server`、`X-Powered-By`、`X-AspNet-Version`、`X-AspNetMvc-Version` 會說出伺服器軟體與版本，自動盤點工具拿來比對已知漏洞。`dist/headers/headers.json` 多了 `remove` 陣列（和 `headers` 同一層，`headers` 的形狀不變）；`nginx.conf` 有 `server_tokens off;` 與 `proxy_hide_header`（完全拿掉 `Server` 要 headers-more 的 `more_clear_headers`），`web.config.headers.xml` 有 `<remove name="X-Powered-By" />` 與 `removeServerHeader="true"`，`_headers` 格式不能刪標頭（只有註解）。Azure Front Door 的做法寫在 `dist/headers/README.md`。完整說明見 [attack-surface.md](attack-surface.md) §5 與本文件 §30。


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
| `429 Too Many Requests`（第六十二輪） | 任何端點過頻：`{error:'rate', retryAfter, message}`＋`Retry-After`（秒）＋`Cache-Control: no-store`。模擬後端：每來源 IP 每 60 秒 5 次，**在讀本體之前**判斷；`GET /api/health` 與退訂不限（一鍵退訂由信箱業者的伺服器代送，許多人共用少數 IP）。狀態機另有每信箱 10 分鐘 3 次、每 IP 10 分鐘 10 次。前端依 `rate`＋`retryAfter` 顯示「請 N 秒後再試」 |
| `413 Payload Too Large` | 本體 > 8 KB：`{error:'too_large'}`。本體有上限才擋得住「一次塞很大的請求」耗資源 |
| 錯誤本體（第六十二輪） | 一律只有 `error`（代碼）＋必要時 `message`（白話）／`fields`／`retryAfter`：**不帶堆疊、伺服器版本、檔案路徑、SQL 或框架錯誤**；`Server`／`X-Powered-By` 標頭拿掉或改成不含版本。未預期錯誤回 `500 {error:'server'}`，細節只進伺服器 log。見 [abuse-protection.md](abuse-protection.md) |

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

### 12.5 召回自我檢查（第四十輪，Issue #79）

建好索引後，`build.mjs` 會從 `dist` 抽 80 個中文頁、每頁抽 2 段 4–8 字的連續中文（只從使用者看得到、且本站有意讓人搜的文字抽：排除 `<form>`、`<nav>`、`<svg>`、`data-pagefind-ignore`），用與 `/search/` 相同的查詢轉換在 **Node 裡**直接查剛建好的索引（`scripts/lib/pagefind.mjs` 的 `verifyPagefindRecall`，不需要瀏覽器，約 3 秒），來源頁必須在結果中。建置摘要印一行：

```
全文索引自我檢查：抽 80 頁 160 個 4–8 字中文字串，召回 100.0%（160/160）
```

- 抽樣用固定種子：同一份內容每次抽到同一批字串，數字可以前後比較；內容一變就換一批，長期下來涵蓋全站。
- 有漏會列出「頁面上有、卻搜不到：/apply/…「兒童健康手冊」」（警告）；召回低於 `PAGEFIND_RECALL_MIN`（預設 0.98）時 `--check`／CI 建置失敗。
- 為什麼需要它：#79 的漏收不是某個詞的問題，而是 Pagefind 整段丟掉 `<label>` 的內容（勾選清單用 `<label>` 包文字）。這類問題換一個元件就會再出現，只有對整站真實輸出抽樣才抓得到。修法與根因見 docs/ask-search-llm.md 第四十輪。

## 13. 個資表單系統與表單端點（第三十輪）

網站是公開、靜態的；**報名表、署長信箱、電子報訂閱的資料不進網站、不進 Git**。正式站由機關的個資表單系統收件，網站只設定「送到哪裡」。原型預設全部是模擬（`mock`）。理由見 [architecture-decisions.md](architecture-decisions.md) §22，程式契約見 ARCHITECTURE 第 35.3 節。

### 13.1 設定（建置時）

| 表單 | 設定 `site.config.mjs` | 環境變數 | 模式 |
| --- | --- | --- | --- |
| 線上報名 | `forms.careersApply` | `FORM_CAREERS_APPLY_ENDPOINT`、`FORM_CAREERS_APPLY_MODE` | `mock`｜`post` |
| 署長信箱 | `forms.directorMailbox` | `FORM_DIRECTOR_MAILBOX_ENDPOINT`、`_MODE`、`FORM_DIRECTOR_MAILBOX_PETITION_URL` | `mock`｜`post`｜`link`（建議） |
| 電子報 | `forms.newsletter` | `FORM_NEWSLETTER_ENDPOINT`、`FORM_NEWSLETTER_MODE` | `mock`｜`post` |

- 只給 `ENDPOINT`、不給 `MODE` ⇒ 自動為 `post`。端點必須是 `https://`（本機測試可用 `http://localhost`）。設定矛盾（`post` 沒端點、`link` 沒陳情系統網址、有端點卻設 `mock`）會讓建置失敗，不會默默退回模擬。
- 例：`FORM_DIRECTOR_MAILBOX_MODE=link FORM_DIRECTOR_MAILBOX_PETITION_URL=https://（陳情系統） npm run build`。
- 設定後頁面的變化：報名頁送到端點並顯示收件編號（不再顯示「模擬」）；署長信箱 `post` 送到端點、`link` 只顯示「前往陳情系統」按鈕；訂閱頁直接用端點，不再探測本機模擬後端。每個表單上方都有收件單位與個資蒐集告知。

### 13.2 端點契約（收件系統要做到）

**線上報名、署長信箱**（`src/client/form-post.js`）：

| 項目 | 內容 |
| --- | --- |
| 方法 | `POST {endpoint}`，`Accept: application/json` |
| 本文（沒有附件） | `Content-Type: application/json`：`{ form, submissionId, submittedAt, lang, page, fields: { 欄位名: 值 } }`，報名另有 `jobId`、`jobTitle`。`form` 為 `careers-apply` 或 `director-mailbox` |
| 本文（有附件） | `multipart/form-data`：表單原欄位與檔案，另有 `_meta` 欄位放上面的 JSON |
| 成功 | `2xx` ＋ `{ ok: true, receiptNo?: string, message?: string }`；`receiptNo` 會顯示給使用者 |
| 驗證失敗 | `4xx` ＋ `{ ok: false, message }`；頁面顯示訊息、保留填寫內容，**不會自動重送** |
| 去重 | `submissionId`（UUID）是冪等鍵，同一 id 只能收一次——瀏覽器送不出 fetch（網路錯誤、CORS 尚未設定）時會改用一般表單 POST 帶同一個 id 再送 |
| 一般表單 POST | 欄位同上加 `submissionId`；端點回自己的 HTML 收件頁（沒有 JS 的瀏覽器也走這條） |
| CORS | 允許本站來源、`POST`、`Content-Type` 標頭；不需要 cookie（前端 `credentials: 'omit'`） |
| 過頻（第六十二輪） | `429 Too Many Requests`＋`Retry-After`（秒）＋`{ ok: false, message }`；頁面顯示專用訊息「送出太頻繁，請稍候再試」（`form.err.rate`），保留填寫內容、不自動重送。門檻見 13.4 |
| 本體太大 | `413 Payload Too Large`＋`{ ok: false, message }`；上限由收件系統定（建議沒有附件 ≤ 64 KB、附件依表單規定），超過就不讀完、不存 |
| 錯誤本體 | 只有 `ok:false` 與白話 `message`（可加代碼）：**不帶堆疊、版本、內部路徑、資料庫訊息**；5xx 一律通用訊息，細節只進收件系統自己的 log（且不含個資，見 13.4） |

**電子報**：沿用第 11 節的 `/api/subscriptions*` 契約，`endpoint` 是這些路徑的前綴（例：`https://mail.cdc.gov.tw/newsletter` ⇒ `https://mail.cdc.gov.tw/newsletter/api/subscriptions`），另需 CORS。

### 13.3 CSP

建置時自動把**生效中的 post 端點來源**加進 `connect-src`（fetch 送出）與 `form-action`（一般表單 POST），其他指令不動；`link` 模式只是超連結，不開 CSP。`dist/headers/README.md` 會列出目前加了哪些來源。收件系統換網域只要改設定重建、重新套 `dist/headers/`。

### 13.4 收件系統的要求

| 項目 | 要求 | 為什麼 |
| --- | --- | --- |
| 存取控管 | 以 AD 群組控管：例如「人事室報名承辦」只看報名、「秘書室信箱承辦」只看信箱、「公關室電子報」只看訂閱；系統管理者與資料讀者分開；每次查看與匯出留紀錄 | 個資只給需要的人看，出事查得到是誰 |
| 保存期限 | 報名資料依人事資料保存規定（甄選結束後多久刪除）；信箱來信依檔案法與陳情處理規定；訂閱者退訂後多久刪除。到期自動刪除並留紀錄，備份一併處理 | 頁面上的「保存期限」要寫得出具體數字 |
| 防濫用：反自動化 | 必須有 CAPTCHA 或等效機制，而且**必須無障礙**：不得用圖形辨識、扭曲文字、聲音辨識這類要使用者「解題」的 CAPTCHA（本站目標 WCAG 2.2 AA，見 [a11y.md](a11y.md)；2.2 新增的 3.3.8「無障礙驗證」不允許認知測驗）。可用：隱形挑戰（瀏覽器端自動完成、不需互動）、工作量證明（PoW，瀏覽器算幾百毫秒）、蜜罐欄位＋最短填寫時間；挑戰失敗時要有替代管道（電話 1922、臨櫃）。驗證結果由**收件系統在伺服器端**檢查，不能只靠前端 | 公開表單一定會被灌；AI 代理會讀表單、自動填寫，蜜罐單獨已不夠 |
| 防濫用：速率限制 | 以來源 IP **與** email（或身分欄位）各自限流，例：同一來源每分鐘 5 次（與本原型模擬後端的數字一致，`scripts/lib/subscribe-mock.mjs`）；超過回 `429`＋`Retry-After`（13.2）。來源 IP 只採信自己代理（WAF／反向代理）加上的 `X-Forwarded-For` 最後一段，**不可直接信任請求自帶的標頭**（攻擊者會自己填） | key 若是攻擊者能選的東西，限流形同虛設 |
| 防濫用：本體與欄位 | 限制本體大小（13.2）；**欄位白名單**：只收該表單定義的欄位，未知欄位整筆拒絕（`400`）而不是默默存下；每欄檢查型別、長度、格式（email、電話、身分證檢查碼）；附件限制類型（以內容判斷，不只看副檔名）與大小並做病毒掃描 | 白名單擋住「多塞欄位探測後端行為」；附件是最常見的惡意程式入口 |
| 防濫用：錯誤與記錄 | 錯誤回應通用（13.2）；被擋的請求（429、反自動化失敗、白名單拒絕）留**不含個資**的紀錄（時間、來源 IP、端點、原因）並送資訊室的 Log Analytics／SOC，告警規則見 [abuse-protection.md](abuse-protection.md) §5 | 被擋的紀錄就是探測的證據 |
| 傳輸與儲存 | 全程 HTTPS；靜態加密；不把個資寫進系統日誌 | 日誌常被忽略，也常被大量存取 |
| 通知 | 收件後寄回執（含收件編號）；不在信裡重複敏感欄位 | 讓民眾知道送到了，又不擴大個資流動 |
| 事故 | 依機關個資事故通報流程 | — |

### 13.5 誰要確認什麼（上線前）

| 單位 | 要確認 |
| --- | --- |
| 資訊室 | 現有系統能不能直接用（人事報名系統、陳情系統、電子報服務）或要另建；部署位置（機關機房、政府雲、委外）；端點網址、CORS、CAPTCHA 與速率限制方案；AD 群組；建置時設定環境變數並重新套 CSP |
| 人事室 | 報名資料保存期限；報名系統能否提供結果查詢頁（`result.externalUrl`）；甄選結果下架期間（預設公告日＋3 個月，見 guide-staff §33）；個資告知事項正式文字 |
| 秘書室 | 署長信箱是否直接連既有陳情系統（建議）及其網址；若要表單 `post`，收件系統與保存期限 |
| 公關室 | 電子報寄信服務（第 11 節）與訂閱資料保存期限 |
| 個資窗口、法務 | 各表單的蒐集目的（特定目的代號）、告知事項文字（`form.notice.*` i18n 字串）、隱私權政策對應段落 |

### 13.6 個資掃描（CI 與建置）

`content/`、`data/snapshots/` 與會複製到網站的內容附件，PR 合併前（`content-pr.yml` 的「PII scan」步驟，只掃 PR 改到的檔）與建置時（全部）都會掃身分證／居留證號（檢查碼）、手機、個人信箱、名單語境姓名。白名單 `content/governance/pii-allowlist.json`（每筆要寫理由）。手動：`npm run pii`。**Git 歷史不會被掃、也不會被清**；若有個資誤入歷史，要不要改寫歷史（`git filter-repo`＋請 GitHub 清快取）由資訊室與個資窗口評估。

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
| `INTL_FEED_TOKEN` | 國際疫情推送端點 `POST /api/intl-epidemic` 的 Bearer 權杖（第四十三輪；發給疫情中心系統）。推送與後台匯入 `POST /api/gateway/intl-epidemic/import` 都用上面的 GitLab 服務帳號把 `data/snapshots/` 兩個檔直接提交到目標分支 | 空（推送端點回 503） |
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
8. **國際疫情資料庫的匯出端點（第四十三輪，docs/intl-epidemic.md §7）：**
   - 疫情中心的匯出端點放在哪個網段？CI（GitHub Actions 或機關 GitLab Runner）連得到嗎？連不到時，是把 Runner 放進同網段，還是由中心把匯出檔放到 CI 連得到的位置？
   - 端點要不要權杖？權杖由誰發、多久換一次、放在 CI 的哪個祕密設定（`INTL_FEED_URL`、`INTL_FEED_TOKEN`）？
9. **GitLab 保護分支：** 推送端點與後台匯入會由服務帳號把 `data/snapshots/travel-epidemic.json`、`intl-epidemic-import.json` **直接提交到目標分支**（不開合併請求）。保護分支是否允許這個服務帳號直接推送？若不允許，要改成「開合併請求＋CI 通過自動合併」（多幾分鐘延遲），或限定服務帳號只能改 `data/snapshots/` 底下（Premium 的 push rules／CODEOWNERS）。
10. **推送 webhook 的來源 IP：** 中心系統呼叫 `POST /api/intl-epidemic` 時從哪個 IP 或網段出來？能否在反向代理或防火牆只允許這些來源（端點本身另有 Bearer 權杖、每 IP 每分鐘 30 次的限流（第六十二輪由 10 調為 30，且在檢查權杖之前判斷，見 §31）、2 MB 上限）？這支端點要不要和後台放在同一個對外網址？

### 14.9 附件上限（第四十五輪）

疫情報導後台的「儲存草稿／送審」會把 PDF 與圖（base64）和文章一起送到 `/api/gateway/drafts`、`/submit`：整包上限 24 MB、附件合計 16 MB、最多 20 個檔；內容本身仍限 512 KB。反向代理的請求大小上限（nginx `client_max_body_size`、IIS `maxAllowedContentLength`）要 ≥ 24 MB，否則同事看到的是代理的 413 而不是閘道的中文訊息。閘道超限時會先把請求讀完再回 413（第三十輪的教訓，ARCHITECTURE §36）。

## 15. 智慧問答頁的效能預算（第四十輪，Issue #80）

`/ask/` 在手機 Lighthouse 只有 61 分（TBT 2.4 s、傳輸 553 KB）。根因、改法與前後數字見 docs/ask-search-llm.md 第四十輪；這裡只講建置閘門與怎麼量。

### 15.1 建置時擋什麼

| 項目 | 算法 | 門檻 |
| --- | --- | --- |
| 立即載入的 JS（每頁） | 沿 `<script src>` 與靜態 `import` 追，壓縮後原始位元組（`scripts/lib/js-budget.mjs`） | 公開頁 120 KB；答案頁（載入 `answer/data.js` 的頁）不另設，因為引擎已改成提問時才 `import()` |
| 答案頁提問後的 JS 合計 | 立即載入＋`answer/core.js` 的 import 閉包 | 240 KB（`ENGINE_JS_BUDGET_KB`） |
| 答案頁的資料傳輸量 | 每種語言：索引分片（中文＋當頁語言）＋引擎要讀的 JSON（清單在 `src/client/answer/deps-manifest.js`，與前端同一份）＋`v1/index.json`，逐檔 **gzip level 6** 後加總。不含答案出來後側欄才抓的疾病頁 JSON 與 `news.json`；專業版另算（15.3） | 445 KB（`ASK_DATA_BUDGET_KB`）：第四十輪實測最大是英文頁 387 KB（zh-TW 350 KB），×1.15 |

為什麼用 gzip 估算：GitHub Pages、nginx、IIS 對 JSON 預設都會壓縮，使用者實際付的是壓縮後的位元組；未壓縮大小（zh-TW 約 2.6 MB）會讓門檻失去意義。估算與 Chrome 實測（CDP `encodedDataLength`）相差在 5% 內。

### 15.2 TBT 怎麼量（建置時量不到，用 e2e）

TBT（主執行緒被長工作卡住的時間）要真的跑瀏覽器才量得到，所以不放進建置，寫成可選的量測：

```bash
BASE_PATH='' npm run build                        # 量測用根路徑的建置
node scripts/perf-ask.mjs                         # 印出三個情境的 TBT、傳輸量、答案出現時間（各跑 3 次取中位數）
PERF_RUNS=5 PERF_JSON=perf.json node scripts/perf-ask.mjs   # 多跑幾次、另存 JSON
ASK_PERF=1 node --test tests/round40-ask-perf.test.mjs      # 當成測試：TBT ≤ ASK_PERF_MAX_TBT_MS（預設 1500 ms）、傳輸 ≤ 600 KB、無 q 時不下載 JSON
```

- 設定模擬 Lighthouse 手機：412×823 視窗、4 倍 CPU 降速（CDP `Emulation.setCPUThrottlingRate`）、不降網速（網速只影響等待，不影響 TBT）。
- TBT 取自 Chrome trace：renderer 主執行緒上超過 50 ms 的頂層工作，每個減 50 ms 後加總；區間是「開頁到答案畫出來後 2.5 秒」，比 Lighthouse（只算到 TTI）嚴格，數字會偏高但穩定。
- 傳輸量是所有 response 的實際傳輸位元組；腳本內建的伺服器像 GitHub Pages 一樣 gzip 文字檔。
- 瀏覽器：預設用 `/opt/pw-browsers` 內最新的 `chromium-*`，可用 `CHROME_BIN` 指定；`playwright` 是 devDependency。
- 為什麼不放進 CI 的必要檢查：GitHub Actions 的機器忙閒差很多，TBT 會跳 ±30%，擋 PR 會誤殺；建議改版答案頁或引擎時本機跑一次，數字貼在 PR 說明。

## 16. 智慧問答查詢紀錄（第四十一輪）

智慧問答的引擎在瀏覽器裡執行，原本什麼都沒記，所以不知道哪些常見問題答不出來。第四十一輪加了「每題一筆已遮蔽個資的紀錄」＋彙整報表，完整說明（記什麼不記什麼、為什麼用 fetch keepalive、為什麼遮兩次、k-匿名、保存期限、收件端契約、資訊室確認清單）見 **[docs/ask-log.md](ask-log.md)**。部署相關重點：

| 環境變數 | 值 | 說明 |
| --- | --- | --- |
| `ASK_LOG_MODE` | `mock`（預設）／`post`／`off` | `mock` 只在本機開發伺服器（localhost）送到同源 `/api/ask-log` 模擬後端；GitHub Pages 原型站不送 |
| `ASK_LOG_ENDPOINT` | `https://…` | 正式收件端點；設了而沒設 mode 視為 `post` |
| `ASK_LOG_RETENTION_DAYS` | 正整數，預設 90 | 原始紀錄保存天數 |
| `ASK_LOG_DIR` | 目錄（只給 `scripts/serve.mjs`） | 模擬後端寫入位置，預設 `.local/ask-log/`（已在 `.gitignore`） |

- 設定矛盾（post 沒端點、端點不是 https、mock／off 卻有端點、保存天數不是正整數）**建置時報錯**，與第 13 節表單端點同一套規則（`scripts/lib/forms.mjs` 的 `askLogErrors`）。
- 生效中的 post 端點來源自動加進 CSP `connect-src`（只有這一項），重新套用 `dist/headers/`（第 10 節）。
- 收件端必須：欄位白名單、伺服器端再遮蔽個資、不記 IP／User-Agent／Referer／cookie、每來源每分鐘 30 筆節流（第六十二輪由 60 降為 30，見 §31）、成功回 204、原始紀錄 90 天到期刪除。參考實作：`scripts/lib/ask-log-mock.mjs`。
- 報表：`npm run ask-log:report`（讀 NDJSON 日檔，寫 `.local/ask-log/report.json`）；後台 `/admin/ask-log/` 可載入該檔。原始紀錄與報表都不得進 Git。

### 15.3 專業版資料預算與 `perf:ask`（第四十八輪，Issue #103）

**專業版資料預算：565 KB（`ASK_DATA_PRO_BUDGET_KB`，預設在 `scripts/lib/js-budget.mjs` 的 `DEFAULT_ASK_DATA_PRO_KB`）。** 以前專業版只回報，結果它已經長到 489 KB、超過民眾版的 445 KB 預算卻沒有任何東西會紅燈。現在建置會擋：算法與民眾版完全一樣（`search-index-pro.zh-TW` 加上引擎要讀的 JSON 加 `index`，逐檔 gzip level 6），門檻用同一條「實測 ×1.15」規則：489 × 1.15 ≈ 562，取整為 565。專業版比民眾版大是因為它的索引多了只給專業人員看的內容（`search-index-pro.zh-TW` gzip 後 273 KB，民眾版 151 KB），不是異常，所以預算獨立訂，而不是把 445 放寬。設 `ASK_DATA_PRO_BUDGET_KB=0` 可暫時只回報（不建議常態使用）。

設了 ×1.15 的餘裕之後，往後每增加約 15% 才會失敗；真的撞到時，先看錯誤訊息列出的最大三個檔，通常是索引分片，處理方式見 17 節。**不要**為了讓建置過關就直接調高數字而不寫原因；調高時在這裡補一行「日期、舊值、新值、為什麼」。

**`npm run perf:ask`：** 等於 `node scripts/perf-ask.mjs`（原本只能直接呼叫腳本）。可選門檻 `PERF_MAX_TBT_MS=…`：`/ask/?q=登革熱` 的 TBT 中位數超過就 exit 1，不設只回報。**刻意不放進 CI 必要檢查**，也不進 `content-pr.yml` 的 lane：這個量測要真的開 Chromium 並把 CPU 降速 4 倍，GitHub 代管 runner 的 CPU 忙閒差很多（同一份程式 TBT 可跳 ±30%），放進必要檢查會讓無關的 PR 隨機紅燈，大家學到的是「紅燈重跑就好」，真的退步時反而被忽略。建議的用法是：改答案頁或引擎的 PR 在本機跑一次，把數字貼在 PR 說明；要做成 CI，請另開手動觸發（`workflow_dispatch`）或夜間排程的獨立 workflow，並把 `PERF_MAX_TBT_MS` 設成實測中位數的 2 倍左右（見下表，約 1100 ms）。

2026-10-14 本機實測（`BASE_PATH='' BUILD_TODAY=2026-10-14 npm run build && npm run perf:ask`，每情境 3 次中位數，4 倍 CPU 降速、412×823）：

| 情境 | TBT | long task 合計 | 傳輸 | 請求數 | 答案出現 | LCP |
| --- | --- | --- | --- | --- | --- | --- |
| `/ask/`（無 q） | 140 ms | 198 ms（1 個） | 96.6 KB（JSON 0） | 16 | — | 292 ms |
| `/ask/?q=登革熱` | 532 ms | 732 ms（4 個） | 524 KB（JSON 384.4） | 40 | 1121 ms | 280 ms |
| `/en/ask/?q=dengue` | 296 ms | 496 ms（4 個） | 562.2 KB（JSON 423.5） | 41 | 857 ms | 160 ms |

建置時的資料傳輸量（gzip 估算）：zh-TW 366 KB、en 405 KB、專業版 489 KB。TBT 遠低於 `tests/round40-ask-perf.test.mjs` 的 1500 ms 上限；傳輸量中 JSON 占約 3/4，這就是 17 節討論分片的原因。

## 17. 設計備忘：答案資料依主題分片（依主題分片尚未實作；第四十九輪做了其中一項便宜做法，Issue #103）

> **第四十九輪狀態：** 本節「建議」第 3 點的兩個便宜做法——（b）專業版差異分片**已做**（見 20.2）；（a）次要 JSON 改成用到才抓**沒做成**，卡在引擎核心需要新增一個非同步鉤子（見 20.1）。依主題／疾病切分的完整分片仍不做，重新評估條件不變。

**問題。** 提問時瀏覽器要下載整份索引：中文分片 `v1/search-index.zh-TW.json`（原始 1.16 MB、gzip 151 KB；專業版 2.1 MB／273 KB），非中文頁再加當頁語言分片。使用者問登革熱，卻也下載了疫苗、就業、標案、新聞的段落。grokbot 建議只載入與問題相符的分片。

**現況。** `scripts/lib/index-builder.mjs` 的 `buildSearchIndex()` 產出一個陣列的 chunk（約 567 個，型別：disease 141、news 73、service 70、faq 63、media 45、vaccine 41、publication 37、article 27、topic 25、job 22、tender 16、clarification 7），每個 chunk 帶 `diseases`、`vaccines`、`countries`、`tasks`、`type`、`url`。`src/client/answer/deps-manifest.js` 的 `indexShardNames(base, lang)` 決定要抓哪些檔（中文＋當頁語言），`src/client/answer/data.js` 用 `Promise.all` 抓完後 `flat()`；`core.js` 把全部 chunk 建成一個 BM25 模型（`df`／`idf`／`avgdl` 都由全部 chunk 算）。

**可能的切法。**
1. 依「疾病錨點」切：每個 chunk 已有 `diseases[]`。建置時產出 `search-index.<lang>.d-<diseaseId>.json`（只放主要屬於該疾病的 chunk）＋ `search-index.<lang>.core.json`（沒有疾病的 chunk：服務、標案、徵才、文章、一般 FAQ）。另產一份很小的路由表 `search-index.<lang>.route.json`：詞（疾病名、別名、關鍵字）→ 分片，約數 KB。
2. 依 `type` 切：最簡單（新聞、標案、徵才、媒體與疾病內容分開），但一個問題的答案常跨 type（疾病＋疫苗＋FAQ），切完幾乎每題都要抓 2–3 片，省不了多少。
3. 兩者混合：疾病相關 type（disease、vaccine、faq、clarification）依疾病切，其餘 type 合成少數幾片。

**要付的代價。**
- **多一次往返：** 先抓路由表，才知道要抓哪片。目前引擎程式和資料是平行下載（`import()` 與 `fetch` 並行，見 `data.js` 開頭註解），路由表會變成串在中間的一關；手機 4G 一個往返約 100–300 ms，抵銷一部分省下的下載時間。可用 `prefetchEngine()` 時順便預抓路由表來減輕，但那只是搬位置。
- **跨主題問題要多片：** 「登革熱和日本腦炎疫苗差在哪」「出國前要打什麼」要同時抓好幾片，最壞情況比現在多出路由表與請求數的成本；路由辨識錯誤（別名沒收進路由表）還會直接少答，比慢更糟，因為使用者看到的是「查不到」而不是等待。
- **相關度閘門需要全域 IDF：** `core.js` 的 `relevance()` 用 `idf`、`maxIdf` 判斷「題目是否真的在語料裡」（`generic-only`、`no-match` 拒答）。分片後 `df`、`N` 只剩局部，同一個詞在小分片裡 IDF 會偏高，閘門門檻（`RELEVANCE`）整組失準，原本被擋掉的無關問題可能被放行，這是安全邊界，不是效能細節。解法是建置時把全域 `df` 表（詞→文件數，詞約 2–3 萬個，gzip 後仍有幾十 KB）另外輸出給閘門用，等於把省下的一部分又吐回去。
- **維運複雜度：** 分片數隨疾病數成長；`js-budget.mjs` 的 `checkAskDataBudget`、`deps-manifest.js`、離線快取、專業版（另一整套分片）、七種語言都要同步；測試要證明「分片後的答案與不分片完全相同」。

**估算。** 一般只問一種疾病時，中文頁約可省一半的索引下載（151 KB → 約 60–80 KB，視該疾病章節多寡），但引擎要讀的其他 JSON（`faq`、`travel-alerts`、`services`、`media`…合計約 190 KB）與 JS（約 100 KB）不會變，整頁傳輸從約 524 KB 降到 400 KB 上下，約 20–25%，TBT 幾乎不變（主要成本在建模型與檢索，不在下載）。

**建議：現在不做。**
1. 效益有限且集中在傳輸量，不在 TBT；目前 TBT 532 ms、遠低於 1500 ms 上限。
2. 風險集中在安全邊界（全域 IDF 與拒答閘門）和少答，需要完整的對照測試才敢上。
3. 比分片便宜、風險小的做法先做：（a）把引擎讀的次要 JSON（`travel-alerts`、`services`、`media`，合計約 75 KB）改成「答案類型需要才抓」；（b）專業版索引裡民眾版沒有的部分另成一個差異分片，專業版 = 民眾版分片 + 差異分片（可共用快取，專業版額外只下載約 120 KB）。這兩項都不動 BM25 與閘門。
4. 重新評估的條件：專業版或民眾版預算在六個月內被撞到兩次以上，或索引 gzip 超過 300 KB。屆時優先走方案 3，並先實作「建置時輸出全域 df 表」這個前置工作。

## 18. 連結檢查：同主機的別專案不算站內（第四十九輪）

**症狀。** 用 `BASE_PATH=''` 建置（本機預覽、量效能、無障礙檢測都這樣建），連結檢查報 3,332 個「站內」壞連結，全部指向 `/vaxmap-next/` 與 `/vaxmap-next/info.html`；用預設的 `/new_cdc_prototype` 建置則是 0 個。

**根因。** 我們的「疫苗及流感藥劑地圖」是另一個專案 `https://ancientsky.github.io/vaxmap-next/`（`site.config.mjs` 的 `vaxmapUrl`、`vaxmapInfoUrl`），和本站放在同一個 GitHub Pages 主機。連結檢查（`scripts/lib/check-internal-links.mjs`）用「站台網址 ＋ basePath」判斷一個絕對網址是不是站內：

| 建置 | 站台網址 ＋ basePath | `https://ancientsky.github.io/vaxmap-next/` |
| --- | --- | --- |
| 預設 | `https://ancientsky.github.io/new_cdc_prototype` | 不在底下 ⇒ 外部連結，只收進 `external-links.json` |
| `BASE_PATH=''` | `https://ancientsky.github.io`（整個主機） | 在底下 ⇒ 站內，去 `dist/vaxmap-next/` 找檔案，找不到 ⇒ error |

`BASE_PATH=''` 的本意是「本站放在網域根目錄」，但原型的網域其實是別人共用的 GitHub Pages 主機，根目錄底下還住著別的專案。

**規則（現在的）。** 一個絕對網址是站內，必須**同時**：（1）同 origin；（2）在「站台網址（含它自己的路徑）＋ basePath」底下；（3）不在「同主機別專案」的前綴底下。第 3 點由呼叫端用 `siblingUrls` 告知：`build.mjs` 傳 `[config.vaxmapUrl, config.vaxmapInfoUrl]`，檢查器取每個網址同主機的第一層路徑（`/vaxmap-next/`）當前綴，前綴底下的絕對網址一律當外部連結。注意是整個前綴不是逐一網址：`/vaxmap-next/` 底下以後新增的頁面不必再改設定；但 `/vaxmap-nextgen/` 這種只是字首相同的路徑不受影響（比對的是 `/vaxmap-next/` 或 `/vaxmap-next`）。

**為什麼不是別的做法。**
- 「`BASE_PATH=''` 時乾脆不檢查絕對網址」：會讓本站自己的絕對網址（canonical、sitemap、JSON-LD）壞了也看不出來，而這正是 `BASE_PATH=''` 建置還在檢查的東西。
- 「在檢查器裡寫死 `vaxmap-next`」：換網域或再多一個別專案（例如將來的資料入口）就要改檢查器。來源放在 `site.config.mjs`，檢查器只認 `siblingUrls`。
- 「`siteUrl` 帶路徑」（例如 `SITE_URL=https://ancientsky.github.io/new_cdc_prototype`、`BASE_PATH=''`）本來就正確：站內範圍就是那個路徑，別專案自然在範圍外，不必靠 `siblingUrls`；`siblingPrefixes()` 也不會把站台自己的子路徑誤當別專案。

**新增別專案時：** 把它的網址加進 `build.mjs` 的 `siblingUrls`（或從 `config` 取）。報告 `v1/governance/link-report.json` 的 `siblings` 欄位列出生效的前綴，建置時看得到。測試：`tests/links.test.mjs` 的「第四十九輪」那一則（同時證明舊行為會報 3 個錯，修正後只剩本站自己的壞連結）。

**驗證（2026-10-14）。** `BASE_PATH='' BUILD_TODAY=2026-10-14 npm run build`：站內 410,139 個全通、error 0（修正前同一份 dist 用舊邏輯重掃：3,332 個，全是 `/vaxmap-next/` 與 `/vaxmap-next/info.html`）；預設 basePath 的建置：同樣 3,290 頁、443,553 個連結、站內 410,139（通 410,139）、外部 14,933、error 0，加或不加 `siblingUrls` 的報告逐欄相同。

## 19. 測試與呼叫端的環境變數無關（第四十九輪）

**症狀。** `npm test` 全過，`BASE_PATH='' npm test` 約 24 個測試失敗（後台、`/legacy/`、`/international/`、`/vaccines/`、疫苗表……），訊息只有「The input did not match the regular expression /href="\/new_cdc_prototype\/admin\/…"/」，不容易聯想到環境變數。

**根因。** `site.config.mjs` 在**被 import 的當下**讀 `process.env.BASE_PATH`（還有 `SITE_URL`、`SITE_MODE`）。模板測試的期望值寫死預設的 `/new_cdc_prototype`，而被測的程式碼用 `config.basePath` 產生 HTML。呼叫端 shell 裡設過 `BASE_PATH=''`（為了量效能、跑 e2e 常常整個 session 都 export 著）就讓兩邊對不上。所以不是 24 個測試各自寫錯，是**測試的輸入有一部分來自呼叫端的環境**。

**做法。**
1. `tests/pin-env.mjs`：在任何人 import `site.config.mjs` 之前，把 `BASE_PATH`、`SITE_URL`、`SITE_MODE` 從 `process.env` 移除，設定檔就回到預設值；呼叫端原本的 `BASE_PATH` 留在 `CALLER_BASE_PATH`（只供偵錯）。
2. `package.json` 的 `test` 改成 `node --test --import ./tests/pin-env.mjs tests/*.test.mjs`：`--import` 保證它在每個測試檔的任何 import 之前執行。`tests/helpers.mjs` 的第一行也 import 它，所以 `node --test tests/某檔.test.mjs` 在「該檔先 import helpers」時也一樣；沒有先 import helpers 的檔（直接 `import '../site.config.mjs'` 的約 20 個）直接單檔執行時不受保護，要保證請用 `npm test` 或自己加 `--import ./tests/pin-env.mjs`。`TEST_KEEP_ENV=1` 可關閉釘選。
3. **需要 `BASE_PATH=''` 的 dist 的 e2e 測試不受影響，而且不再依賴呼叫端環境。** e2e 讀的是「別人先建好的 dist」，那份 dist 的 basePath 真相在 dist 自己：每頁 `<html data-base="…">`（前端 `data.js` 讀的同一個屬性）。`tests/helpers.mjs` 新增 `distBasePath(distDir)` 讀它、`distEnv(distDir)` 在啟動 `scripts/serve.mjs` 時明確帶 `BASE_PATH`。round26（i18n）、round28（search）、round30（gateway）、round34（engine-split）、round40（ask-perf、search-recall）、round47（nav-panels）與 admin-editor 的 e2e 都改用它。以前這些測試用 `config.basePath`，等於「呼叫端必須用跟建置 dist 時相同的 `BASE_PATH` 跑測試」，現在不用了：dist 用 `''` 或預設建的都能跑，測試的 shell 設什麼都無所謂。

**驗證（2026-10-14）。** `npm test` 與 `BASE_PATH='' npm test` 皆 961 個測試 0 失敗（dist 為 `BASE_PATH=''` 建置時 e2e 照跑；dist 為預設 basePath 建置時 e2e 也照跑）。`BASE_PATH='' npm test` 在改動前：952 個測試 24 個失敗。

**往後寫測試的規則。** 模板／渲染測試用 `config.basePath`（預設值）；讀 dist 的測試用 `distBasePath(DIST)`；需要子行程的 `BASE_PATH` 時用 `distEnv(DIST)`，不要依賴 `process.env.BASE_PATH`。

## 20. 答案資料載入（第四十九輪，Issue #103 的後續）

第 17 節建議先做兩個便宜做法再談分片。這輪的結果：

### 20.1 次要 JSON 改成用到才抓：**沒做成，需要引擎核心加一個非同步鉤子**

**要抓的是什麼。** `/ask/?q=登革熱` 提問時下載的 JSON 共 395 KB（傳輸量，含索引 153 KB）。其中「次要」（`deps-manifest.js` 的 `ENGINE_SECONDARY`）七個檔加 `v1/index.json` 合計約 106 KB gzip：`travel-alerts` 36.5、`services` 23.0、`media` 18.0、`country-levels` 16.4、`immunization-schedule` 4.0、`notify-table` 3.4、`vaccine-master` 1.1，`index` 4.3。它們只有旅遊、申請服務、通報時限、影音海報、接種時程這些意圖或來源卡才用到，登革熱症狀問題一個也沒用，約佔提問後 JSON 的四分之一。

**為什麼只改 `data.js` 做不到。**
1. `createEngine(deps)` 在**建立當下**就把次要資料吃掉：`serviceById`、`mediaById`、`notifyRows`、`travelItems` 都是建立時算好的 `Map`／陣列，`scheduleItems` 是建立時取走的參考（`core.js` 開頭）。引擎建好之後再補資料不會生效。
2. `engine.answer()` 是**同步**函式，所有呼叫端（`ui.js`、`factcheck.js`、`stats.js`、`admin/eval.js`、`judge.js`）都是 `const r = engine.answer(...)` 直接用。答案內容才知道要不要用次要資料，這時再去抓就是非同步，同步函式等不了。
3. 不能「在提問前先判斷需不需要」：次要資料的使用不只看意圖。`mediaById`／`serviceById` 在**任何**意圖下，只要檢索到影音或申請服務的片段，就會用來補來源卡（海報、時長、步驟數）；`travelItems` 在有國家實體時就用。用意圖或關鍵字預判，漏判就是答案或來源卡跟現在不一樣，違反「行為完全相同」。
4. 試過的繞法與為什麼放棄：（i）每題先 `answer()` 一次當探針，看結果有沒有用到次要資料再補抓、重建引擎——`createEngine` 手機 4 倍降速約 0.8 秒，罕見意圖的使用者要多付一次，而且探針是否「沒用到」得靠比對結果，容易漏；（ii）讓 `data.js` 回傳包裝過的 engine——`answer` 仍是同步，包裝也無法等待。

**需要的鉤子（給負責 `core.js` 的人）。** 最小改法兩部分：（一）`createEngine` 內五個次要結構改成可重建（`let`），並新增 `engine.supply({ services, media, notifyTable, travel, schedule })` 重新計算它們；（二）每個讀取點（`core.js` 的 `mediaById.get`／`serviceById.get`／`travelItems`／`notifyRows.get`／`scheduleItems`，約 10 處）在**資料尚未供應**時把名稱記進 `engine.missing`（`Set`），仍照現在的「空資料」邏輯回答。`ui.js` 的 `run()` 已是 `async`，只要 `result = engine.answer(...)` 之後 `if (engine.missing.size) { await loadSecondary([...engine.missing]); engine.supply(...); result = engine.answer(...) }`（`data.js` 負責 `loadSecondary`，用現成的 `v1()` 快取）。這樣重答只發生在罕見意圖，結果與一次載入完全相同，且有測試可證明（同一題在「全部先載」與「用到才載」兩條路徑答案逐位元相同，評估集 327 題都跑兩遍）。預估節省：一般症狀、疫苗以外的問題少下載約 100 KB（提問傳輸約 532 KB → 約 430 KB，約 19%），TBT 不變。另一個較小的好處：`prefetchEngine()` 不再在空閒時預抓這 100 KB。這個改動碰到 `core.js` 與 `ui.js`，所以留給負責它們的同事排進下一輪。

### 20.2 專業版索引改成「民眾版分片＋差異分片」：**已做，但專業版第一次載入的位元組沒有減少**

**做了什麼。** 專業版索引 ＝ 民眾版索引的全部片段 ＋ 專業獨有片段（中文：571 ＋ 340 ＝ 911 個片段；專業獨有的是文件庫 216、檢驗項目 53、服務 31、疾病頁專業重點 14、研究計畫 10、文章 9、通函 5、專區與刊物各 1）。建置現在另輸出 `v1/search-index-pro-delta.<lang>.json`（七種語言各一個），內容是 `{ v, base{count,first,last}, omit[], at[], chunks[] }`：`chunks` 是專業獨有的片段、`at` 是它們在合併後陣列的位置、`omit` 是民眾版有而專業版沒有的片段 id（目前恆為空，規則上允許，因為專業版資格比民眾版多了幾道檢查）、`base` 是民眾版分片的指紋。專業版頁面（`data.js` 的 `proIndexShards`）下載「民眾版分片＋差異分片」，在記憶體合回與原本的完整專業版分片**逐位元相同（含順序）**的陣列——順序必須相同，因為 BM25 同分時的名次取決於陣列順序。合併邏輯與格式只在 `src/client/answer/index-delta.js` 一份，建置與瀏覽器共用。

**安全網。**
- 建置時（`index-builder.mjs` 的 `buildProDeltaShards`）逐語言當場驗證「民眾版分片＋差異＝專業版分片」，不一致建置失敗。
- 前端遇到差異分片 404、格式版本不認得、或指紋與民眾版分片對不上（例如民眾版分片來自舊快取、差異分片是新的）時，**整個**退回完整專業版分片，不混用；該檔照舊輸出。
- 對外 API 不變：`v1/search-index.json`、`search-index-pro.json` 與各語言分片原樣輸出、內容不變（`openapi.json`、`/developers/` 有文件）。差異分片是新增端點，`openapi.json` 與 `v1/index.json`、`v1/search.json`（`proDeltaShards`）都列出，並註明一般 API 使用者請用完整檔。
- 管理後台的評估重跑（`allLangs`）仍讀完整檔。
- `index-delta.js` 只有專業版才動態載入，民眾版頁面的初始 JS 與提問後合計不多（`th/ask` 合計 238.4 → 238.6 KB，見下面的提醒）。

**量測（2026-10-14，`BASE_PATH='' BUILD_TODAY=2026-10-14 npm run build && node scripts/perf-ask.mjs`，每情境 3 次中位數，4 倍 CPU 降速）。** 專業版情境是這輪另外量的（`/ask/?view=pro&q=…`）：

| 情境 | 項目 | 之前 | 之後 |
| --- | --- | --- | --- |
| 建置「答案頁資料傳輸量」 | 專業版（gzip 估算） | 499 KB | 504 KB（+1%） |
| | 民眾版 zh-TW／en | 377／415 KB | 377／416 KB（`v1/index.json` 多列 7 個檔） |
| `/ask/?view=pro&q=登革熱` | 傳輸（JSON） | 652.5 KB（517.8） | 659 KB（523.2） |
| | TBT／答案出現 | 796 ms／1490 ms | 755 ms／1441 ms（同量級；單次量測的誤差約 ±15%） |
| `/en/ask/?view=pro&q=dengue` | 傳輸（JSON） | 690 KB（556.9） | 697 KB（562.9） |
| | TBT／答案出現 | 405 ms／1109 ms | 351 ms／1016 ms |
| `/ask/?q=登革熱`（民眾版） | 傳輸／TBT／答案出現 | 531.8 KB／629 ms／1307 ms | 532 KB／559 ms／1135 ms |
| `/en/ask/?q=dengue`（民眾版） | 傳輸／TBT／答案出現 | 569.2 KB／352 ms／1072 ms | 569.5 KB／334 ms／968 ms |

**誠實的結論：** 專業版**第一次**載入（快取是空的）的位元組沒有少，反而多了約 1%：民眾版分片 153 KB ＋ 差異分片 128 KB ＝ 281 KB，和原本的完整專業版分片 276 KB 差不多，因為專業獨有的片段（文件庫全文）本來就佔了那 128 KB，而分成兩個檔案壓縮失去了跨檔的重複字串（多約 5 KB）。所以 `DEFAULT_ASK_DATA_PRO_KB` **維持 565 KB**：新量測 504 KB × 1.15 ＝ 580 KB，沒有比 565 低，不調整（餘裕由 13% 降為 12%）。這個做法的實際價值在**快取共用**：同一位同事在民眾版與專業版之間切換、或先看過民眾版（常見，專業同事也會先用民眾版查），專業版只需要再下載約 128 KB 的差異分片，不是 276 KB；一個站內民眾版分片更新時，專業版的差異分片可以獨立重用（反之亦然）。要讓專業版第一次載入也變小，得減少專業獨有片段本身的大小（例如文件庫只索引章節標題與摘要、全文改成按需載入），那是內容與索引設計的取捨，不是分片格式能解的，不在這輪範圍。

**提醒（合併後更新）：** 寫這段時引擎 JS 是 238.6／240 KB；同一輪引擎分支把罕見意圖的答案組裝改成按需載入的 `route-*.js`（`docs/ask-search-llm.md` §14），合併後「提問後合計」最大降到 227.1 KB（`th/ask`），約有 13 KB 餘裕。調高預算仍要在 `js-budget.mjs` 補一行「日期、舊值、新值、為什麼」（見 15.3 的規則）。

**驗證。** `tests/round49-pro-delta.test.mjs`：純函式（順序、omit、內容不同、指紋不符、位置不合理）、dist 每語言合併結果與完整專業版分片逐位元相同、`data.js proIndexShards` 在假 `document`／`fetch` 下的合併結果與三種退回情境（404、版本不認得、民眾版分片舊快取）、完整檔與 `index.json`／openapi 仍在。評估集 `npm run eval`：326 通過、0 失敗、1 略過（與改動前相同；引擎輸入的陣列逐位元相同，答案不變）。

### 20.3 答案引擎改讀不含譯文的精簡副本（合併時發現、當輪修正）

**發生什麼事。** 這一輪外語分支替申請服務、影音、資料集補了七語機器翻譯草稿（`docs/i18n.md` §8），四個分支合併後重新建置，「答案頁資料傳輸量」從 zh-TW 377／en 415／專業版 499 KB 漲到 402／441／530 KB，en 只剩 4 KB 就碰到 445 KB 預算。原因是答案頁下載的 `v1/services.json`（gzip 23 → 40 KB）、`media.json`（18 → 24 KB）、`datasets.json`（11.8 → 13.3 KB）整份帶著譯文，而**答案引擎根本不讀這些譯文**：引擎用中文欄位組句與來源卡，`data.js` 的 `loadEngine` 對服務與影音只挑出 `id`、`title`、`steps`、`poster` 這類欄位；這三類內容的譯文只在各自的頁面顯示。

**怎麼修。** 建置另外輸出 `v1/answer/{services,media,datasets}.json`：內容與完整檔相同、順序相同，只去掉 `i18n` 與 `languages`。`deps-manifest.js` 改成讀這三份；`v1/index.json` 也列出它們（`services`、`media` 是可選檔，`data.js` 的 `v1Optional` 先查清單才下載）。完整的 `v1/services.json` 等**對外 API 不變**，仍含七語譯文。

**結果（`BASE_PATH='' BUILD_TODAY=2026-10-14 npm run build`）。** 答案頁資料傳輸量 zh-TW 372、en 411、專業版 499 KB，比這一輪開始前還少約 5 KB（譯文以外，`languages` 陣列本來就不需要）。gzip：services 39.7 → 20.0 KB、media 24.0 → 16.0 KB、datasets 12.7 → 10.0 KB。

**為什麼這樣比較好。**
- 對外 API 是給外部系統用的「完整資料」，答案頁是「只需要回答所需的欄位」。兩者的需求本來就不同，共用同一份檔案，任何一邊加欄位都會讓另一邊變重。這次是加譯文，下次可能是加圖片說明或附件清單。
- 另一種修法是把預算調高，但那只是把問題藏起來：民眾在手機上多下載 25 KB 卻什麼都沒得到。
- 還有一種修法是讓 `data.js` 只下載需要的欄位，但靜態網站沒有伺服器能挑欄位，只能預先輸出。

**防呆。** `tests/round49-answer-slim.test.mjs` 檢查：清單指向精簡副本、精簡副本＝完整檔去掉 `i18n`／`languages`（其他欄位與順序逐項相同，所以引擎拿到的資料不變、答案不變）、`index.json` 有列出、完整檔仍含譯文。評估集 392／392 通過。

**給之後的人。** 如果引擎哪一天真的需要某個欄位的譯文（例如外語答案要顯示服務名稱的譯名），請在 `emit-api.mjs` 的 `forAnswer` 只保留那個欄位的那一種用法，而不是改回讀完整檔；並重看建置輸出的「答案頁資料傳輸量」。

**第五十輪補充：FAQ、疫苗、澄清也改讀副本。** 第五十輪依 Yulun「先補譯」補了 417 筆機器初稿（FAQ 194、疾病頁 59、新聞 66、疫苗 43、澄清 25…）。只在 main 上加譯文的話，英文答案頁會漲到 475 KB（超過 445 KB 預算）。所以同一招延伸到 `v1/answer/{faq,vaccines,clarifications}.json`：FAQ 與疫苗在 `data.js` 只取引擎欄位，整份去掉譯文；**澄清**的譯文引擎真的會用（謠言查證分支顯示外語澄清），所以副本只留 `languages.<lang>.status` 為 `reviewed` 的語言——這同時修了一個政策漏洞：澄清是一級內容，機器初稿不得顯示，但原本謠言查證分支讀 `i18n[lang]` 時不看審閱狀態，補譯後機器初稿就會出現在答案裡。結果：補完 417 筆譯文後，答案頁資料量反而比第四十九輪還低（zh-TW 365、en 404、專業版 486 KB，其中 +6 KB 來自 5 個服務頁開放民眾版）。測試 `tests/round49-answer-slim.test.mjs` 加了澄清副本「只含 reviewed 語言」的檢查。

## 21. 重新審閱：閘道的規則，以及 BUILD_TODAY 會藏起逾期（第五十輪）

給資訊室。同事端的操作見 guide-staff §51。

### 21.1 問題與改之前的實測

內容逾期（`reviewedAt + reviewPeriodMonths` 早於建置日）時，治理規則 R1 會把它移出 AI 白名單，並在前台加註（`scripts/lib/governance.mjs`）。2026-10-14 有四筆逾期：

- `disease.chikungunya`（2025-07-28，12 個月）
- `disease.japanese-encephalitis`（2025-08-12，12 個月）
- `faq.mpox-who-vaccine`（2026-04-02，6 個月）
- `faq.tb-cough-two-weeks`（2026-04-01，6 個月）

要回到白名單，只需要權責單位重新審閱、把 `reviewedAt` 改成新日期。`reviewedAt` 不在 `sourceHashOf` 裡，所以譯文不會因此變成「待複核」。

改之前用閘道的測試骨架（`createGatewayApi`＋`createLocalGit`＋示範帳號）實測，結果如下：

| 環節 | 結果 |
| --- | --- |
| `/admin/due/` 的按鈕 | 只寫 `localStorage`（`cdc.admin.reviewed`），什麼都沒改 |
| 閘道：把 main 上的現行版**原樣**存草稿、送審 | 可以。分支上的檔案多了 `status: draft/review`，所以 `git-local` 的 `commit()` 不會回 `unchanged`，合併請求也不是空的 |
| 審核人看到的差異 | `changes: []`，畫面只寫「與網站上的版本相同，沒有修改」，看不出這是重新審閱 |
| 四眼原則、角色、別單位 | 都擋得住：送出的人不能核准；`demo-008` 回 403；`demo-001` 沒有審核角色 |
| 核准 | `publish()` 把 `reviewedAt` 改成當天並合併。main 上只差一行 |
| 稽核、提交訊息、通知 | 和一般修改完全一樣，**沒有任何地方標明這是重新審閱** |
| 同事實際能走的路 | 只有 `/admin/publish/?edit=` 重新匯出。表單會改掉 `summary`、`keywords`、`languages`（例如英文 `reviewed` 變回 `pending`）、`structured`，而且 `editDiff` 忽略這些欄位，畫面還會顯示「目前與現行版相同」（第五十一輪已修正，實測影響的欄位比這裡多，見 §22） |
| 慢性傳染病組（`faq.tb-cough-two-weeks`） | 沒有示範帳號，只有跨單位角色能送審與核准 |
| `npm run dev` 核准之後 | 結果在 `.local/gateway-repo` 的 main。建置讀的是工作目錄的 `content/`，兩邊不會同步，本機站台看不到結果 |
| CI | `BUILD_TODAY=2026-10-01`，所以 `faq.tb-cough-two-weeks`、`faq.mpox-who-vaccine` 在 CI 不算逾期（見 21.4） |

結論：後端規則本身可行，但缺一個「內容不改、只確認」的明確動作。實際能用的路徑又會順手改到其他欄位，審核人、稽核和本機站台也都看不出重新審閱這件事。

### 21.2 閘道的重新審閱契約

**端點：** `POST /api/gateway/rereview { contentId, type, note? }`。

- 同源、CSRF、JSON 的規則和其他寫入端點相同。
- `note` 最多 2000 字。稽核只記字數，不記本文。

**閘道怎麼處理（`workflow.reReview`）：**

1. 路徑只由 `type`＋`id` 推出（`contentPathOf`），從**目標分支（main）**讀現行版，不收前端送來的內容。這樣表單的副作用不會跟著進來。
2. 檢查內容必須是 `status: published`，型別與 id 也要和檔案一致。不符時回 404、409 或 422。
3. 權限和送審一樣：要有「編輯」角色，且內容屬於自己的單位（或是跨單位角色）。
4. 同一筆內容已有進行中的送審件時回 409。那一件核准時，`reviewedAt` 本來就會更新。
5. 接著和一般送審共用同一段程式（`enterReview`）：
   - 車道依 `lanes.json`，一級內容加 `tier1Reviewers`。
   - 核准人數依 `requiredApprovals`。
   - 送出的人會記成 editor，所以不能核准（四眼原則）。
   - 通知審核人。
6. 送審件帶 `kind: 'rereview'`。
   - 退回後再送審，種類沿用。
   - `/submit` 也接受 `reReview: true`，用在「修改到期內容時一併標為重新審閱」。

**核准上線（`publish()`）：**

- 寫入的內容和以前一樣：`status: published`、`reviewedAt: 今天（臺北）`。
- 提交訊息多一行 `Review-Kind: re-review (reviewedAt 舊 -> 新; content unchanged|changed)`。

**稽核：**

| 動作 | 記錄內容 |
| --- | --- |
| `rereview`（送出） | `kind: 'rereview'` |
| `approve`、`return` | 帶 `kind` |
| `publish` | `kind`、`reviewedAtBefore`、`reviewedAt`、`contentChanged`（比對時不看 status 與 reviewedAt） |

**同事看得到的文字：**

- 畫面、通知、API 回應都不出現 Git 用語（`tests/round50-rereview.test.mjs` 以 `GIT_WORDS` 檢查）。
- `GET /items/:id/diff` 多一個 `reReview: { lastReviewedAt, note, text }`，複核頁用它顯示「重新審閱：內容沒有修改，核准後最後審閱日由 … 更新為核准當天」。

**後台畫面：**

- `/admin/due/` 偵測閘道的方式和 `/admin/publish/` 相同（`detectGateway`）。
- 有閘道：每列是「送出重新審閱」，並顯示這筆的狀態（審核中、退回＋意見、已重新審閱）。
- 沒有閘道：維持示範按鈕，頁首的提醒框（`data-gw-hide`）說明它不會改變任何內容，並指向 guide-staff §51。

**GitLab：**

- 分支上的送審版和 main 只差 `status`，最後的合併提交只差 `reviewedAt`，所以合併請求一定有變更，不會是空的。
- 若開了「Pipelines must succeed」，同樣適用 §14.4 的待辦。

### 21.3 本機原型：核准結果怎麼回到站台

`npm run dev` 的閘道寫進 `.local/gateway-repo`（bare repo，第一次啟動時以當時的 `content/` 為種子），建置讀的是工作目錄。新增的 `npm run gateway:pull` 會比對「種子以來 main 上改過的 `content/` 檔」和工作目錄，列出不同的檔；加 `-- --write` 才寫入，之後執行 `npm run build`。

注意：如果種子是很久以前建的，工作目錄裡這些檔後來的修改會被 main 的版本蓋掉。所以預設只列出、不寫入。要重建種子，就刪掉 `.local/gateway-repo` 與 `.local/gateway-state.json`。

正式環境不需要這一步：GitLab CI 從 main 建置。

### 21.4 BUILD_TODAY 的取捨與建議

`content-pr.yml` 與 `pages.yml` 用 `BUILD_TODAY=2026-10-01` 凍結「今天」。

**好處：** 示範案例穩定，例如「逾期」「依據已修訂」「態勢資料日」的展示，以及測試的期望值，不會隨真實日期改變。

**代價：** 真實日期往後走時，CI 與 GitHub Pages 建出來的站，把已經逾期的內容當成未逾期，**仍然放在 AI 白名單**。CI 綠燈也看不出這件事。這次就是如此：`faq.tb-cough-two-weeks`（到期 2026-10-01）與 `faq.mpox-who-vaccine`（到期 2026-10-02），在 CI 與公開示範站上都還算「現行」。

**這一輪做的（不會破壞既有行為）：**

- 建置時，若 `BUILD_TODAY` 早於真實的臺北日期，就用 `overdueAsOf(site, 今天)`（`governance.mjs`）列出「以今天算已逾期、這次建置看不到」的內容，印出 `⚠ [審閱到期]` 警告。
- 在 GitHub Actions 中，另外輸出 `::warning` 註記，顯示在執行摘要上。
- 只警告，不讓建置失敗。

**建議（需要決策，這一輪沒改）：**

1. **對外的建置用真實日期：** 把 `pages.yml` 的 `BUILD_TODAY` 改成只在 repo variable 有設定時才帶入（`vars.BUILD_TODAY`，預設空值）。這樣公開示範站與正式站都依真實日期判斷逾期。
2. **測試與 PR 檢查繼續凍結日期：** 測試需要可重現的結果，治理案例的期望值也是依 2026-10-01 寫的。改成真實日期會讓測試隨日期失敗，而失敗的原因與 PR 無關。
3. **正式環境的 GitLab CI 一律用真實日期：** 不設 `BUILD_TODAY`，凍結日期只留給原型示範。

用真實日期的代價是：示範站上「逾期」的案例會隨時間變多（內容沒人維護就會這樣），某些展示截圖會和文件不一致。這正好反映內容的真實狀態，我們認為比顯示錯誤的「現行」好。

## 22. 修改已上架內容：以現行版為底，只改動過的欄位（第五十一輪）

給資訊室。同事端的說明見 guide-staff §53。

### 22.1 問題與實測

§21.1 已經發現 `/admin/publish/?edit={id}` 存檔時會改到表單沒有顯示的欄位。那一次是在瀏覽器外模擬的，這一輪改用真的頁面重測：

- 建置：`BASE_PATH='' BUILD_TODAY=2026-10-14 npm run build`。
- 用 Playwright 開 `/admin/publish/?edit={id}&gateway=off`，等預處理跑完，**什麼都不改**，取頁面的 `exportObj()`（下載 JSON、上架包、送審都用它）。
- 把結果與 `content/` 的原檔逐欄比較。

抽 13 種型別、33 筆（含通函、首長簡介），結果每一筆都有不該變的欄位：

| 欄位 | 幾筆被改 | 怎麼被改 |
| --- | --- | --- |
| `summary` | 33／33 | 換成預處理抽出的第一句，例如 `faq.tb-cough-two-weeks` 變成帶 `**` 的內文第一句 |
| `keywords` | 33／33 | 換成預處理的建議詞，人工挑的詞不見 |
| `sourceHash` | 33／33 | 建置算出來的雜湊被寫進檔案。閘道的 `stableJson` 會拿掉，但「下載 JSON／上架包」不會 |
| `languages` | 27／33 | 有提供的語言全部變成 `pending`。其中 20 筆的英文 `reviewed`（含 `reviewer`、`reviewedAt`）不見，機器翻譯也變成待翻譯 |
| `steward` | 21／33 | 原檔沒有的，被補上「某組承辦人」 |
| `structured` | 18／33 | 換成預處理抽出的數字，例如 `{coughWeeks: 2, treatmentMonthsMin: 6}` 變成 `{ageMonths: "6 個月"}` |
| `diseases`、`vaccines`、`countries` | 13／33 | 依預處理增減，例如登革熱因為「埃及斑蚊」被加上國家 `EG` |
| `sensitivity` | 5／33 | 文件、通函、檢驗項目由 `public` 變成 `professional` |
| `audience` 順序、`whoCanApply`、`links`、`forms`、`specimens`、`newsType` | 各 1～3 筆 | 申請對象的自由文字被清空、專區連結的各語言標題（`links[].i18n`）不見、`newsType: other` 變成 `press` |
| `isCurrent`、`supersededBy` | 文件 2／2 | API 的計算欄位被寫進檔案（schema 註明「計算欄位，不手填」） |

畫面上的「目前改動的欄位」也不可靠：

- 有 4 筆顯示「目前與現行版相同」，實際卻有 6～8 個欄位會變。例如 `disease.dengue` 會變 7 個。
- 其他幾筆列出的欄位（例如 `diseases`）和實際改動的不一致。原因是載入時沒有等預處理跑完就先算了一次差異。

### 22.2 根本原因

1. **契約錯了。** 舊的做法是「表單匯出一份完整 JSON，再把表單**沒有**的欄位從現行版補回來」（`mergeEdit`）。有些欄位表單有，但只裝得下一部分，例如：
   - 摘要、關鍵字：預處理的建議值。
   - 提供語言：只有「提供／不提供」一個勾選框。
   - 申請對象：固定選項的勾選框。
   - 連結：一行「標題 | 網址 | 備註」。

   這些欄位不會被補回，表單的版本就直接蓋掉現行版。
2. **把「新內容的建議」當成「現行版的值」。** 摘要、關鍵字、結構化欄位是預處理為**新內容**提出的建議。修改時卻直接拿來當成要存的值。
3. **差異檢查剛好略過這些欄位。** `editDiff` 寫死略過 `keywords`、`summary`、`languages`、`structured`、`sensitivity`、`steward`，所以畫面會說「相同」。API 才有的計算欄位（`sourceHash`、`isCurrent`、`supersededBy`）也沒有拿掉。
4. **測試沒有照頁面做。** 原本的 `tests/admin-edit.test.mjs` 把現行版的摘要、關鍵字直接傳進 `buildExport`。頁面上這兩個值是預處理算出來的，所以測試永遠看不到這個問題。
5. **載入時沒等預處理。** `startEdit` 沒有等 `runPreprocess` 跑完，畫面上的差異是用不完整的狀態算的。

### 22.3 修正：以現行版為底的三方合併

程式在 `src/client/admin/preprocess.js` 的 `liveItem`、`mergeEdit`、`editDiff`，以及 `publish.js` 的 `startEdit`、`exportObj`。

1. **現行版 = content 檔。** `liveItem(api)` 拿掉 `API_ONLY_KEYS` 的欄位與附件的公開網址：
   - API 才有：`url`、`path`、`md`、`governance`、`gov`、`master`、`related`。
   - 計算欄位：`sourceHash`、`isCurrent`、`supersededBy`。

   測試對所有上架頁可修改的已上架內容（兩百多筆）檢查：`liveItem(apiItem(x))` 與 content 檔**逐位元組相同**，鍵順序也相同。以後 API 多加計算欄位，這個測試會先擋下來。
2. **記下 base。** 頁面載入現行版時，先等預處理跑完，再把結果欄改成現行版的值（`seedFromLive`）：
   - 關鍵字：對得上的勾選，其餘放在「手動新增」。
   - 摘要：用現行版的摘要。
   - 結構化欄位：只勾跟現行版一樣的值。

   然後記下這時的匯出結果，叫做 `editing.base`，代表「表單剛帶入、還沒有人動過」。
3. **存檔時逐欄三方合併。** 用 `mergeEdit(current, original, base)` 逐欄比較 base 與目前的匯出（current）。兩者相同，就表示同事沒動，**保留現行版原樣**；現行版沒有這一欄，也不會多出來。不同時，依欄位的種類處理：

   | 欄位種類 | 怎麼套用 |
   | --- | --- |
   | 字串、數字清單（關鍵字、相關疾病、對象、申請對象…） | 只套用「新增哪些、移除哪些」，現行版其他項目與順序不變 |
   | 物件（`structured`…） | 逐鍵三方合併，表單沒有的鍵保留。取消系統建議的值時，不會連人工填的鍵一起刪掉 |
   | 物件清單（連結、步驟、表單、檢體…） | 和載入時相同的那幾項沿用現行版，保留表單沒有的子欄位，例如連結的各語言標題。筆數相同時逐項合併 |
   | `languages` | 一個語言一個語言比較，只換掉同事取消或新增的那個語言 |
   | `assets` | 表單只列這次新選的檔；同名就換掉，其餘現行版附件照舊 |
   | 疾病頁 `blocks` | 只換內文有改的區塊（沿用第十二輪的做法） |
   | `keyFacts`（疾病）、`publicFunded`（疫苗） | 表單只放佔位值，一律保留現行版 |

4. **明確會改的欄位（`EDIT_DERIVED`）**，畫面上會明列：
   - `status`：草稿是 `draft`，送審是 `review`。
   - `reviewedAt`：今天。閘道核准上線時，會再改成核准當天（§21.2）。
5. **有條件會改的欄位：譯文的 `sourceHash`。** 同事改到正本文字時，既有譯文其實是依舊版翻的。判斷用 `sourceChanged`，欄位清單和建置的 `sourceHashOf` 是同一份，都在 `src/client/source-pick.js`。處理方式：
   - 對 `reviewed` 或 `machine`、而且還沒有 `sourceHash` 的語言，補上舊版正本的雜湊（API 的 `sourceHash`）。
   - 治理規則 R5 就會判定「中文已更新，譯文待複核」。

   為什麼要補：沒有 `sourceHash` 的舊資料一律被當成最新。不補的話，改了中文，英文仍會標示為「已複核」。以前的做法是全部改成 `pending`，等於把已複核的譯文整份作廢。
6. **重新預處理不蓋掉同事的選擇。** 修改模式下按「送出預處理」：
   - 摘要保留，空的也不會自動填。要換成系統建議，按「重新擬摘要」，這就是同事明確接受建議的動作。
   - 已勾的詞照舊。
   - 內文改了而不再出現的關鍵字，移到「手動新增」，不會悄悄消失。
7. **草稿也記得現行版。** 存在這台電腦的草稿（`cdc.admin.draft`）多記 `editOf`（現行版＋base）。重新整理後，就不會被當成新內容整份覆寫。
8. **比較時不看鍵的順序。** 用 `canon`：物件鍵排序後比較，陣列順序仍算修改。

實測：同樣的 Playwright 腳本跑全部 274 筆已上架內容，不改就存時，每一筆都只差 `status` 與 `reviewedAt`，鍵順序不變，畫面都顯示「內容與現行版相同（儲存時只會更新：狀態、最後審閱日）」。

### 22.4 「目前改動的欄位」與審核人看到的差異

- **`editDiff`：** 與現行版逐欄比較，回傳**所有**不同的欄位。只排除 `EDIT_DERIVED`，畫面上另外寫「另外儲存時會更新：狀態、最後審閱日」。欄位顯示中文名與代碼，例如「提供語言（languages）」。不認得的欄位直接顯示代碼：寧可難看，也不能漏報。
- **閘道的 `fieldDiff`（`scripts/lib/gateway/field-diff.mjs`）：**
  - 比較時不看鍵的順序。
  - `languages` 狀態沒變、只有子欄位變時也會報，例如「英文：正本已修改，已複核譯文標為待複核」，或複核人被拿掉。
  - 疾病頁區塊內文沒變、只有其他設定變時也會報，例如拿掉 `pending`。
  - 每個不同的欄位至少產生一筆說明。
  - 仍不比較的只有 `status`（送審流程本身，由狀態另外顯示），以及從不寫進檔案的 `sourceHash`、`gov`、`__*`。
- **欄位名稱只有一份：** 移到 `src/client/admin/field-labels.js`。閘道的錯誤訊息、審核人的差異、上架頁共用。`validate-item.mjs` 只轉出 `FIELD_LABELS`，錯誤訊息的歸屬規則不變；差異顯示另外用 `fieldLabel`，多認得舊站網址、重點摘要等欄位。

### 22.5 為什麼「合併到現行版」才是對的契約

- **一個 content 檔有很多寫入者，表單只是其中之一。** 譯者寫 `i18n`、`languages[].reviewer`；治理幕僚寫 `aiWhitelist.approvedBy`；移轉工具寫 `legacyUrls`；連結檢查寫 `links[].lastCheckedAt`；確認狀態寫 `verification`。表單只認得其中一部分。寫入者如果重寫自己不負責的欄位，就會悄悄毀掉別人的工作，而且沒有人會發現，因為畫面說「沒有修改」。
- **審核人核准的是他看到的差異。** 四眼原則的前提是：看到的差異＝實際寫進去的內容。舊做法讓兩者不一致，核准就失去意義。
- **「不改 ⇒ 沒有差異」可以寫成測試。** 這一輪對所有可修改的已上架內容都驗證了這一點。以後表單或 schema 怎麼改，這條規則都會守住。
- **以後新增欄位不用動表單。** schema 加了新欄位（例如下一輪的某個治理欄位），修改頁不認得它，也會原樣保留。舊做法要記得把它加進「補回清單」，忘了就被清掉。
- **這就是 HTTP 的 PATCH 與 PUT 的差別。** 修改應該送「改了什麼」，不是「整份重寫」。

### 22.6 已知限制與待決策

1. **（第五十二輪已處理，見 §23）同時修改的覆寫。** 閘道收到的仍是一整份檔案。如果同事 A 載入後、存檔前，main 上的同一個檔被別人改了（例如 B 的修改先核准上線），A 送出的版本會把 B 的修改蓋回去。現在的合併只保護「表單沒動的欄位」不被表單蓋掉，不保護「載入之後 main 又變了」這種情況。

   第五十二輪照這裡的建議做了：前端存檔與送審時一併送出開啟時的版本碼，閘道在 `writeVersion` 比對，不同就回 409，請同事載入最新版（同事的修改會保留並重新套用）。同一個草稿兩人改、送審期間網站版本被別的管道更新，也一併處理。契約、理由與限制見 §23。
2. **（需決策）過期的已複核譯文仍會顯示。** 改了中文以後，英文會標為「中文已更新，譯文待複核」，但依現行的治理規則 R5 仍然**照常顯示**，只是加註。以前改中文會把譯文全部變成 `pending`，等於直接隱藏。如果一級內容（疾病、疫苗、Q&A）的過期譯文應該隱藏、只顯示中文，要改的是 R5，不是修改頁。
3. **表單刪不掉現行版的附件，也清不掉疾病頁某一個區塊的內文。** 這兩件事和以前一樣，請找資訊室直接改檔。
4. **從閘道開啟送審中的內容（`?gw=`）時，沒有 `sourceHash` 可以比對。** 這時拿到的是分支上的檔案，不是 API，所以不會補譯文的 `sourceHash`。第一次從 `?edit=` 修改時已經補過，一般不影響。
5. **新聞只能修改最近 200 則**（API 的限制，沒變）。
6. **其他編輯頁沒有在這一輪檢查。** 疫情報導、職缺、採購、接種時程各有自己的編輯頁與匯出函式。是否也有「整份重寫」的問題，要另外查。（第五十二輪已逐筆量過並修正，見 §24。）
7. **既有的上架頁端到端測試等於一直沒跑（合併時已修）。** `tests/admin-editor.test.mjs` 寫死了一個舊的 Playwright 路徑，所以一直略過。改用全域 Playwright 後發現兩件事：`scripts/serve.mjs` 預設會帶起閘道（第三十輪），有閘道時「產生上架包」那一段被隱藏，測試逾時；關掉閘道後，頁面探測 `/api/gateway/health` 得到的 `404` 又被當成主控台錯誤。現在測試的伺服器設 `GATEWAY=off`、頁面加 `?gateway=off`（不探測），34 項全過。教訓：「沒裝就略過」的測試要用和其他測試相同的預設路徑，否則它會安靜地失效好幾輪。

### 22.7 測試

`tests/round51-edit-preserve.test.mjs` 涵蓋以下項目：

- **API 與檔案一致：** 所有可修改內容的 API 形狀，拿掉 API 專用欄位後與檔案逐位元組相同。
- **不改就存：** 15 個各型別範例，以及全部已上架內容，結果都逐位元組相同，只差 `status`、`reviewedAt`。
- **只改一個欄位：**
  - 任務入口、審閱週期、權責單位：只有那一欄變。
  - 中文內文：只有內文與譯文的 `sourceHash` 變。`i18n`、`aiWhitelist`、`legacyUrls`、`structured`、摘要、關鍵字原樣，英文仍是 `reviewed`。
  - 取消一個語言：只動那個語言。
- **各種合併規則：** 關鍵字、相關疾病只套增減；取消系統建議的結構化欄位不刪人工的鍵；連結的各語言標題保留；自由文字的申請對象保留；疾病頁只換一個區塊；新附件接在後面。
- **差異一定報出來：** `editDiff` 與 `fieldDiff` 對每一種欄位的修改都會報；只是鍵的順序不同時不報。
- **端到端（Playwright＋真的閘道）：**
  1. 開 `faq.dengue-fever-when-to-see-doctor` 的修改頁，畫面顯示「內容與現行版相同」。
  2. 不改就存草稿：分支上的檔只差 `status`、`reviewedAt`，鍵順序不變。
  3. 改標題：畫面列出標題、問題、提供語言。送審後分支上只多這幾欄，英文仍是 `reviewed`，並帶舊版雜湊。
  4. 審核人的差異 API 列出標題、問題、提供語言、最後審閱日。

## 23. 同時修改：版本檢查（第五十二輪）

給資訊室。同事端（承辦人與審核的科長）的說明見 guide-staff §54。程式在 `scripts/lib/gateway/workflow.mjs`（`checkVersion`、`draftState`、`mergeFields`、`assertCurrent`）、`src/client/admin/content-version.js`（版本碼）、`publish-gateway.js`（提醒與「載入最新版」）、`publish.js` 與 `bulletin-edit.js`（各自的 `getBaseHash`、`reloadLatest`）、`review-gateway.js`（審核人看到的說明）。

### 23.1 問題與實測

Yulun 問：「萬一兩個同事同時提交，審查的科長會看到兩份嗎？他可以怎麼處理？」查下來分成兩半：

**科長不會看到兩份。** 閘道從第三十輪起規定一筆內容同一時間只有一個進行中的送審件（草稿、退回、審核中）。逐一確認的結果：

| 路徑 | 結果 |
| --- | --- |
| 上架頁存草稿／送審 | 只有一件。但**沒帶送審件編號時，閘道會自動接著寫進進行中的那一件**（見下方漏洞 2） |
| 審核中再存 | 409「審核中，審核結束前不能修改」 |
| 重新審閱（`/rereview`） | 已有進行中的送審件 ⇒ 409 busy |
| 疫情報導的配套內容（新卷期） | **原本沒算進去**：配套內容不算「進行中」，同一筆內容可以同時是 A 件的配套內容、又在 B 件裡當主內容改。這一輪補上 |

**但「只有一件」不等於「不會蓋掉別人」。** 閘道收到的是整份檔案（§22），有三個漏洞。用 `origin/main` 的程式在測試版本庫實跑（測試同 `tests/round52-concurrent-edit.test.mjs` 的情境）：

1. **開啟之後別人先上線。** A 在 T0 開啟 `?edit=X`；B 改標題、核准上線；A 依 T0 的版本改審閱週期、送審、核准。結果 main 上的標題**變回 B 改之前**，沒有任何錯誤或衝突。原因：A 的送審件是在 B 上線之後才從 main 開分支，Git 只看到「A 的分支把標題改回舊的」，這是一般修改，不是衝突。
2. **同一個草稿兩人改。** A 存了草稿（改摘要）；B 從網站版本開啟同一頁，改標題後存檔。兩次存檔進了同一件，分支上的摘要**變回 A 改之前**。原因同上：每次存檔都是整份檔案。
3. **送審期間網站版本被別的管道更新。** 一個 content 檔有很多寫入者（§22.5：譯者、治理幕僚、移轉工具、國際疫情匯入、資訊室直接改檔）。送審件開著的時候 main 上同一檔變了：
   - 改到相鄰的行 ⇒ 核准時合併衝突，舊訊息叫「承辦人重新開啟最新版」，但從送審件開啟（`?gw=`）拿到的還是舊版，再送一樣衝突。
   - 改到不相鄰的行 ⇒ Git 照行合併成功，結果沒有人看過；審核人看到的差異（跟 main 現況比）還會把別人的更新顯示成「這件改回去了」。

### 23.2 版本碼：存檔時告訴閘道「我是依哪一版改的」

`contentVersion(item)`（`src/client/admin/content-version.js`，瀏覽器與閘道共用同一支）：

1. 先用 `liveItem` 拿掉 API 才有的欄位（網址、`sourceHash`、`isCurrent` 等，與 §22.3 同一份清單）。
2. 再拿掉 `status`、`reviewedAt`（`EDIT_DERIVED`，每次存檔本來就會改）。
3. 物件鍵排序後（`canon`）算雜湊，結果像 `v1-0fd29a4038f6b60a7b4de0974960`。新內容（還沒有這個檔）是 `new`。

為什麼這樣設計：

- **鍵的順序、API 與檔案的形狀都不能影響。** 頁面拿到的是 API 的一筆，閘道讀的是檔案。測試對兩百筆已上架內容檢查 API 形狀與檔案算出同一個碼，否則每次存檔都會誤判。
- **只差狀態或最後審閱日不算衝突。** 存檔本來就會改這兩欄；例如別人的重新審閱核准後只動了最後審閱日，A 照存不會被擋（A 存的那一版本來就會把審閱日改成今天）。
- **其他任何欄位都算，包括表單沒有的。** 譯者改了 `languages[].reviewer`，表單看不到，但會被整份檔案蓋掉，所以一定要算進去。
- **雜湊用純 JavaScript（兩個種子的 cyrb53，共 106 位元）。** 不是安全用途，只要不同內容幾乎不可能同碼。不用 `crypto.subtle`，是因為機關內網的後台不一定是 https，而 subtle 只在安全來源可用。

### 23.3 閘道的契約

`POST /api/gateway/drafts`、`/submit` 多收 `baseHash`，回應多帶 `contentHash`（存好的這一版的碼，前端下次存檔帶回來）。

比對對象：

- **新送審件**（這筆內容沒有進行中的送審件）：比 main 上的檔。
- **既有送審件**：比它自己的分支。所以「同一草稿兩人改」也擋得住。
- **既有送審件、而且開始後 main 變了**：比「分支版本＋main 版本」兩段組成的碼（見 §23.4）。

不同 ⇒ **409，不寫入任何東西**。回應：

```json
{ "error": "stale", "message": "這頁在你開啟之後，網站上的版本已經更新（林○慧修改、張○玲核准，2026-10-14 15:15 上線），改了：標題、問題、提供語言。為了不蓋掉別人的修改，這一版還沒有存。請按「載入最新版」……",
  "stale": { "kind": "site", "contentHash": "v1-…", "by": [{ "name": "林○慧", "approvedBy": "張○玲", "atText": "2026-10-14 15:15", "fields": ["標題", "問題", "提供語言"] }], "fields": ["標題", "問題", "提供語言"] } }
```

| `kind` | 什麼情況 | 誰、改了什麼從哪裡來 |
| --- | --- | --- |
| `site` | 新送審件，main 在開啟後變了 | 閘道自己的上線紀錄（`sub.published`：上線前後的碼與改了哪些欄位）；從同事開啟時的碼往後找 |
| `exists`（`error` 也是 `exists`） | 以「新內容」存，但網站上已有同 ID | — |
| `open` | 已有進行中的送審件，同事開啟的卻是網站版本 | 送審件開始時的版本對分支現況做 `fieldDiff`；承辦人 |
| `draft` | 同一件裡，開啟之後又有人存過 | 每次存檔記一筆 `sub.versions`（碼、誰、何時、提交），從那一版對現況做 `fieldDiff` |
| `moved` | 送審件開始後 main 變了，同事還沒看過 | 同 `site` |
| `companion` | 配套內容網站上已有、內容又不同 | — |

訊息只用「網站上的版本、送審件、存了一版、上線」這些字，不出現 Git 用語（測試會檢查）。版本碼格式不對時當作沒帶。

`GET /api/gateway/items/:id/content` 改回 `{ item, contentHash, update? }`。另加 `GET /api/gateway/current?contentId=&type=&base=`，給修改頁開啟時用，回應包括：

- main 上的現行版 `item`：和 API 一樣附 `sourceHash`，`mergeEdit` 標「譯文待複核」要用。
- 版本碼。
- 進行中的送審件 `open`：狀態、承辦、它的版本碼。
- `base` 過期時的說明。

為什麼要有 `/current`：修改頁的內容來自網站的 API，網站更新要幾分鐘，剛核准上線的修改 API 可能還沒有。只靠存檔時才擋，同事會白改一場。

### 23.4 送審期間網站版本變了：不能核准，重新開啟時三方合併

送審件建立時記下開始版本 `sub.base = { version, commit }`（main 上的碼與提交）。

- **審核人看差異時**（`/diff`）：main 的碼已不是開始時的 ⇒ 差異改成跟「開始時的版本」比，所以審核人看到的是這件自己改的；另附 `outdated` 說明。審核頁顯示黃色說明、停用「核准上線」、預先填好退回意見。
- **核准時**（`approve`）：一開始就 `assertCurrent`，不符就回 409 `outdated`，核准不記，什麼都不寫。自動上線車道（`publish`）也檢查。配套內容在送審期間上線、而且內容不同，也算。
- **承辦人重新開啟時**（`?gw=` → `/items/:id/content`）：閘道以欄位為單位做三方合併（`mergeFields`）。三方是開始版本、送審件、main 現況：
  - 只有一方改的欄位，用那一方的。
  - 兩方改成一樣，照用。
  - 兩方改得不一樣算衝突。**先用 main 的**，不悄悄蓋掉已上線的更新；送審件原本的值放在 `update.conflicts[].yours`，畫面列出來讓承辦人自己決定。

  這時的版本碼是「分支版本＋main 版本」兩段。
- **承辦人帶這個碼存檔或送審時**：閘道知道他已看過 main 的更新，從 main **另開新分支**（`cms/<id>-<件>-v2`），寫入這一版與全部附件，關掉舊的審核，`sub.base` 換成現在的 main，歷程記「併入網站上的最新版本」。舊分支留著當紀錄。
- **「審閱到期」頁的「不用修改，再送出」**（`/submit` 不帶內容）：
  - 沒有衝突 ⇒ 閘道直接併入，然後送審。
  - 有衝突 ⇒ 409，請承辦人開啟修改頁自己決定。
- **沒帶版本碼的舊頁面送審時 main 已變**：409 `moved`，不進審核。否則會卡在審核人核准不了。

為什麼是「欄位為單位、衝突時先用網站上的」：

- Git 照行合併對 JSON 太細：相鄰的行就衝突，不相鄰的又合成一份沒人看過的內容。
- 欄位是同事與審核人認得的單位，`fieldDiff` 也是以欄位說明。
- 衝突時先保留已上線的版本，最壞情況是承辦人要再改一次，不會有已上線的修改無聲消失。

第五十二輪以前開始的送審件沒有 `sub.base`，上面的檢查都不會觸發，合併衝突時仍走舊路。這一輪補了一條出路：合併衝突時記一個「開始版本不明」，承辦人重新開啟時，與網站版本不同的欄位都列為兩邊都改了，由他確認。

### 23.5 前端

- **上架頁（`publish.js`）** 自己管版本碼（`getBaseHash`）：
  - `?edit=` 開啟：網站版本的碼。
  - `?gw=` 開啟：閘道給的碼。
  - 新內容：`new`。
  - 存好一版後：閘道回的碼。這個碼也記在這台電腦的草稿（`gwVersion`），重新整理後仍知道依哪一版改。
- **開啟時（`publish-gateway.js` 的 `checkCurrent`）**：
  - 已有進行中的送審件、這頁卻是網站版本 ⇒ 黃色提醒（狀態、承辦、最後更新）、「從那一件繼續」連結，並停用存檔鈕。
  - 網站有更新的版本 ⇒ 提醒並給「載入最新版」。
  - 新內容的 ID 網站上已有 ⇒ 提醒。
- **存檔被擋時** 出現兩個按鈕：
  - **載入最新版（保留我的修改）**：以開啟時的版本為準，找出「我改的欄位」與「別人改的欄位」。我改、別人沒改的，套到最新版上，表單顯示最新版加上我的修改，差異列只列我的。兩邊都改的，先顯示最新版，把我的值列出來。整份原本的內容另存在這台電腦（`cdc.admin.staleCopy`）。
  - **下載我這一版（JSON）**：任何情況都可以按。
- **疫情報導編輯頁**（`bulletin-edit.js`）共用 `publish-gateway.js`。第五十二輪合併後與上架頁一樣完整（以前只做到一半，見 §23.7 第 7 點）：
  - `getBaseHash`：
    - `?edit=` 或「選文章」開啟：網站版本的碼。由資料島的一筆還原舊分類代號後算，與 content 檔同碼，測試逐篇檢查。
    - `?gw=` 開啟：閘道給的碼。
    - 新文章：`new`。
    - 存好一版後：閘道回的碼（也記在本機草稿）。
  - 從網站版本開啟、這篇已有進行中的送審件 ⇒ 存檔鈕停用、給「從那一件繼續」。以前只提醒，照存會接著寫進那一件。
  - `reloadLatest`（「載入最新版（保留我的修改）」）：
    - 「我改的欄位」＝表單匯出跟 `editBase` 不同的欄位，與 `mergeFormEdit` 同一個判斷。所以表單沒有的欄位（例如提供語言）不會被當成我改的。
    - 先以最新版重新帶入表單、**重新記 `editBase`**，再把我的修改寫回表單。順序很重要：`editBase` 若還是舊版的，`mergeFormEdit` 會把「網站上的新版本」與「我的舊表單」之間的差異都當成我改的，等於把別人的修改改回去。
    - 這次拖進來的圖檔與 PDF 不算進 `editBase`，載入最新版後仍算我的修改。
  - 從送審件開啟時，閘道多送回送審件裡的配套內容（新卷期）與分類主檔，頁面帶回表單。以前重新開啟新卷期的文章，卷期欄會變空，再存就少了卷期。
  - 頁面「選文章」換了一篇 ⇒ 發 `adm:gw-target` 事件，送審面板重新檢查這篇的送審件與網站版本。
  - 本機草稿若是從送審件帶回的，重新整理後仍以送審件的版本為底（草稿多記 `gwLive`）。否則 `editBase` 是依送審件記的、現行版卻換成網站版本，送審件裡別人的修改會被當成「沒改」，掉回網站上的值。
- **職缺、採購、接種時程的編輯頁**（第五十三輪已接上，§25）：用同一支 `publish-gateway.js`，各自有 `getBaseHash` 與 `reloadLatest`。職缺、採購的版本碼由 content 檔算（已下架名單的職缺，資料島與檔案不同）；接種時程是主檔，送 `master: { name, items, start }`，以列合併（§25.2）。沒有閘道時照舊只產生 JSON／上架包。

### 23.6 沒帶版本碼：照舊接受，稽核記下

決定：**接受**，稽核紀錄記 `baseHash: "missing"`；沒帶版本碼時送審，仍會擋下 main 已變的情況（§23.4）。

為什麼不拒絕：

- 沒帶的剩兩種：已開著的舊版頁面、外部腳本（疫情報導編輯頁在第五十二輪合併後一律帶碼）。拒絕會讓這些頁面在上線當天不能存，而接受只是維持現在的行為，不會比以前更糟。
- GitHub Pages 示範站沒有閘道，什麼都不會送。上架包（ZIP）流程不經閘道，由資訊室開 PR；PR 的差異是跟當時的 main 比，別人的修改被改回去會出現在差異裡，要靠 PR 審查看出來。

疫情報導編輯頁已加上 `getBaseHash` 與 `reloadLatest`（§23.5）；職缺、採購、接種時程的編輯頁在第五十三輪接上閘道時也加了（§25），現在所有經閘道存檔的頁面都帶版本碼。閘道多了開關 `GATEWAY_REQUIRE_BASE_HASH=1`（預設不開，仍照收並記 `missing`），什麼時候打開見 §25.6。

### 23.7 已知限制與待決策

1. **「誰改的」只認得經過閘道上線的。** 資訊室直接改檔、譯者 PR、國際疫情匯入，訊息只會說「網站上的版本已經更新」，不會有名字。正式環境可以改從 GitLab 的提交紀錄找。
2. **衝突以整個欄位為單位。** 兩人改了同一欄的不同部分（例如 `languages` 的不同語言、疾病頁不同區塊）也算衝突，要承辦人手動再改一次。這是保守的取捨，寧可多問一次。職缺、採購也一樣（例如兩人各加一筆異動紀錄，異動紀錄是一整欄）。接種時程主檔（第五十三輪）細一層：以「一列的一個欄位」為單位，兩人改不同列、或同一列不同欄位都不算衝突（§25.2）。
3. **一筆內容同時只有一件送審件。** 兩位同事要改同一頁，只能在同一件裡接力：存檔時以最後一版為底，兩人都列在承辦，審核人看到的是合併後的一件。不能各自開一件、各自審。接種時程主檔也是整份只有一件（第五十三輪）：兩位同事改不同疫苗，也要在同一件裡接力。
4. **本機原型的版本庫只在第一次啟動時從 `content/` 建立。** 之後 `content/` 更新了（例如拉了新版程式），`.local/gateway-repo` 的 main 不會跟著變，修改頁開啟時會一直出現「網站上有更新的版本」，或存檔被擋。要重來，刪掉 `.local/gateway-repo` 與 `.local/gateway-state.json`。
5. **另開新分支後，舊分支不會刪。** 供應者介面沒有刪分支，舊的審核會關掉。資訊室可以定期清掉 `cms/*` 中已有 `-v2` 以後版本的舊分支。
6. **版本碼不是安全機制。** 它防的是同事不小心互相蓋掉，不防有人故意偽造。權限與四眼原則仍由閘道的角色檢查負責。
7. **疫情報導編輯頁（第五十二輪合併後已補上）。** 原本它沒有自己的版本碼：從網站版本開啟、而這篇已有進行中的送審件時，畫面只提醒，存檔鈕不停用，照樣存會接著寫進那一件。現在與上架頁相同（§23.5）。仍有的差別：
   - 「我改的欄位」以表單欄位為準。兩人改了同一篇的不同段落，段落是一整欄，仍算兩邊都改了（同第 2 點）。
   - 頁面上換一篇文章時，分類管理的修改會清掉（第五十二輪以前就是這樣）。

### 23.8 測試

`tests/round52-concurrent-edit.test.mjs`（疫情報導編輯頁與分類主檔在 `tests/round52-bulletin-gateway.test.mjs`，見 §24.7）：

- **版本碼：**
  - 鍵的順序、API 形狀（兩百筆已上架內容）、狀態與最後審閱日都不影響。
  - 其他欄位（含巢狀子欄位、表單沒有的欄位）一改就不同。
- **三方合併：** 只有一方改、兩方改成一樣、兩方都改（衝突時用網站上的）、一邊刪一邊改。
- **閘道：**
  - 開啟之後別人先上線 ⇒ 409 `site`，訊息有誰改、誰核准、改了哪些欄位，什麼都不寫；帶最新版的碼就存得進去，B 的修改還在。
  - 同一版本、鍵順序不同 ⇒ 照存；兩人同時以新內容存同一個 ID ⇒ 擋下。
  - 網站上已有同 ID ⇒ 409 `exists`。
  - 同一草稿兩人改 ⇒ 409 `draft`；載入最新版後存得進去，承辦列出兩位，審核人只看到一件。
  - 已有進行中的送審件 ⇒ 開啟時就看得到；存檔 ⇒ 409 `open`；審核中 ⇒ 409；重新審閱 ⇒ busy。
  - 沒帶版本碼 ⇒ 照舊接受，稽核記 `missing`。
  - 送審期間網站版本更新：
    - 差異只列這件自己改的，並附說明。
    - 核准 ⇒ 409 `outdated`，核准不記。
    - 退回後重新開啟是合併後的版本；用舊碼送 ⇒ 409 `moved`；用新碼送 ⇒ 上線，兩邊的修改都在。
  - 兩邊改到同一欄 ⇒ 先用網站上的，列出送審件的值；「不用修改，再送出」有衝突時擋下，沒衝突時直接併入。
  - 配套內容被別件帶著時，不能另外當主內容改。
  - HTTP：409 回應的 `stale` 不含 Git 用語；版本碼格式不對當沒帶；`/current`、`/items/:id/content` 的版本碼一致。
- **端到端（Playwright＋真的閘道，先 `BASE_PATH='' BUILD_TODAY=2026-10-14 npm run build`）：**
  1. A 開啟修改頁，B 改標題後由總編輯核准上線。
  2. 這時才開啟的人一開啟就看到「網站上有更新的版本」，可以載入最新版。
  3. A 改審閱週期後存檔被擋，畫面說明是誰改了什麼。按「載入最新版（保留我的修改）」後，標題是 B 的、審閱週期是 A 的，差異列只列審閱週期。存檔後 B 的修改還在。
  4. B 再從網站版本開啟：一開啟就提醒「已有進行中的送審件」，存檔鈕停用。
  5. B 按「從那一件繼續」。A 又存一版後，B 依舊版存被擋；B 載入最新版後存得進去，承辦列出兩位。
  6. 送審後譯者直接更新網站版本：審核頁顯示「還不能核准」、核准鈕停用、退回意見已預先填好。退回後 A 重新開啟看到「已併進這個送審件」，再送審、核准，main 上三個人的修改都在。

## 24. 其他四個編輯頁的修改檢查（第五十二輪）

給資訊室。同事端的說明見 guide-staff §55。

§22.6 第 6 點留了一件事：疫情報導、職缺、採購、接種時程四個編輯頁各有自己的匯出函式，沒有跟著 §22 改。這一輪用同樣的方法逐筆量過，四個都有「整份重寫」的問題，已全部改成 §22 的契約：**以現行版為底，只套用同事改過的欄位**。

### 24.1 量測方法與結果（改之前）

- 建置：`BASE_PATH='' BUILD_TODAY=2026-10-14 npm run build`；伺服器 `GATEWAY=off`，網址加 `?gateway=off`。
- 用 Playwright 開真的頁面，**每一筆既有內容都開**（沒有抽樣）：
  - 職缺 `/admin/jobs/edit/?id={id}`（11 筆）、採購 `/admin/tenders/edit/?id={id}`（8 筆）、疫情報導 `/admin/bulletin/edit/?edit={id}`（4 篇）。
  - 接種時程 `/admin/vaccines/schedule/`（一份主檔 42 筆）：載入後先取一次，再把左側清單每一筆都點過（每一筆都會經過表單一次）再取一次。
- **什麼都不改**，取「複製、下載、上架包、送審」實際用的那一份（`#jf-out`、`#tf-out`、`#te-out`、`#vx-out`；疫情報導送審用的 `exportObj` 與 `#te-out` 是同一個函式），與 `content/` 的原檔比較。

結果：沒有一筆逐位元組相同。

| 編輯頁 | 欄位 | 幾筆被改 | 怎麼被改 |
| --- | --- | --- | --- |
| 職缺 | `reviewedAt` | 11／11 | 改成今天（刻意的，見 24.3 第 6 點） |
| 職缺 | `aiWhitelist.approvedAt` | 11／11 | 公關室核准 AI 白名單的日子，被改成匯出當天 |
| 職缺 | 鍵的順序 | 9／11 | 依表單的順序重排，PR 看起來整檔都改了 |
| 職缺 | `result` | 1／11 | `job.2026-05-25-quarantine-officer-kaoping`：正取 4 位、備取 2 位、報到須知整段不見，還多寫一個 `admitted: []`（依規則代表「從缺」，意思完全不同） |
| 採購 | `reviewedAt` | 8／8 | 同職缺 |
| 採購 | `aiWhitelist.approvedAt` | 8／8 | 同職缺 |
| 採購 | 鍵的順序 | 8／8 | 同職缺 |
| 疫情報導 | `reviewedAt` | 4／4 | 同職缺 |
| 疫情報導 | `articleType` | 3／4 | 檔案裡的舊分類代號被換成新代號，例如 `outbreak-report` 變成 `investigation`、`surveillance` 變成 `feature` |
| 疫情報導 | `assets[].alt` | 1／1（有圖的那篇） | `article.teb-42-19-1` 圖檔宣告的替代文字被換成圖表的替代文字（長了好幾倍），子欄位順序也變了 |
| 疫情報導 | `diseases` | 1／4 | 空陣列被拿掉 |
| 疫情報導分類主檔 | 整個檔 | 加一個分類時 | `content/master/bulletin-categories.json` 原本一個分類一行（10 行），加一個分類就被改寫成每個鍵一行（58 行），值都一樣，但 PR 整檔都是差異 |
| 接種時程 | 筆的順序 | 42 筆整份 | 匯出依「疫苗主檔順序＋月齡」重新排序，與原檔順序不同 |
| 接種時程 | 鍵的順序 | 9／42 | 點過的筆經過表單重組，鍵的順序變了（例如 `sched.influenza-child`、`sched.covid-adult`、`sched.hpv`） |

畫面上的「改了什麼」也不可靠：

- **接種時程：** 載入後畫面寫「與目前上線版本相同」，實際匯出的檔案順序已經不同。只是逐筆點過、什麼都沒改，畫面變成「修改 9」。
- **疫情報導：** 修改模式的說明寫「匯出會保留表單沒有的欄位，PR 只會多出真正改動的部分」，4 篇都不成立。
- **職缺、採購：** 只有「日期異動」的對照（給異動紀錄用），沒有整體的「改了哪些欄位」，所以上面這些改動畫面上完全看不到。

### 24.2 根本原因

1. **和 §22 同一個契約錯誤。** 匯出函式（`buildJob`、`buildTender`、`buildArticle`）每次都重組一份完整物件。表單**沒有**的欄位會保留，但表單**有**的欄位一律用表單的值：
   - 表單強制的預設值：權責單位、對象、審閱週期、AI 白名單（核准日＝今天）。
   - 表單正規化過的值：分類代號、圖檔替代文字、空陣列。
   - 鍵的順序：照程式裡物件的寫法，不是照原檔。
2. **頁面拿到的「現行版」不是 content 檔。** 資料島來自建置時已經處理過的資料：
   - 載入時（`scripts/lib/load.mjs`）把文章的舊分類代號換成新代號。
   - 治理引擎在甄選結果的下架日之後，把名單從**記憶體中的**職缺拿掉（第三十輪，為了網站、API 不再輸出名單）。這個編輯頁本身就是公開的靜態頁，所以本來就不能放名單。

   以這份資料為底重組，等於把建置在記憶體裡做的事寫回檔案。
3. **接種時程的匯出會重新排序。** 排序本來是為了「diff 穩定」，但原檔不是這個順序，所以第一次匯出就整份重排。修訂摘要只比對每一筆的內容，不看順序，所以畫面說「相同」。
4. **分類主檔整份重寫**，而且輸出格式和原檔不同。

### 24.3 修正

程式在 `src/client/admin/edit-merge.js`（新檔）與四個編輯頁。`preprocess.js` 沒有改，只是 import 它的 `mergeEdit`、`mergeValue`、`sameValue`、`editDiff`。

1. **單筆的三個編輯頁（職缺、採購、疫情報導）改用 `mergeFormEdit(out, original, base)`。** 它直接呼叫 §22 的 `mergeEdit`，所以三方合併、「提供語言」逐語言比較、改到正本時替譯文補上舊版雜湊，都是同一份程式。只多兩條這三個表單特有的規則：
   - **改過的字串清單整欄用表單的版本。** 資格條件、工作內容、採購範圍、參考文獻、關鍵字……在這些表單是「每行一項」的完整清單，順序有意義。`mergeEdit` 對字串清單只套「新增、移除了哪些」，那是為了上架頁只顯示部分建議詞的關鍵字；用在這裡，改過的那一行會被搬到最後。
   - **附件逐筆比對。** 疫情報導的表單每次都依圖表重新產生整份 `assets[]`，`mergeEdit` 的規則卻是「表單只列這次新選的檔」。所以先挑出跟載入時不同的那幾筆，與現行版同名的那筆逐欄合併（保留子欄位順序與表單沒有的子欄位），再交給 `mergeEdit`。
2. **base 在表單帶入後、經過真的欄位再取。** 頁面在帶入現行版之後，立刻用頁面自己的 `read()` 匯出一次，記為 `editBase`。不直接用程式算，是因為下拉選單會吃掉不在選項裡的值（例如採購的需求單位只列 `publishes !== false` 的單位），這種差異是表單本來就裝不下的，不是同事改的。
3. **資料島補上「content 檔才有的資訊」**（另外放，不混進每一筆，因為既有測試規定資料島的每一筆不得帶建置欄位）：
   - `sourceHashes`：建置算的正本雜湊。改到中文正文時，用來把既有英譯標成「依舊版翻譯」（R5 會顯示「中文已更新，譯文待複核」）。職缺 11 筆、採購 8 筆都有英譯，其中 4 筆是已複核。
   - `legacyArticleTypes`（疫情報導）：content 檔裡的舊分類代號。模板直接讀 content 檔取得，頁面以它為現行版；沒改分類就原樣保留。
   - `resultTakenDown`（職缺）：已過下架日、但檔案仍留著名單的職缺。
4. **`buildJob`、`buildTender` 沿用既有的 `aiWhitelist`。** 新增時才用「今天」。否則存在這台電腦的草稿隔天再開，base 和目前的匯出就會因為日期不同，被當成同事改了 AI 白名單。
5. **本機草稿記下 base。** 職缺、採購、疫情報導的草稿多存 `editBase`，接種時程的草稿多存 `orig`（開始編輯時的現行版）。重新整理或隔天再開時，main 上已被別人改的欄位不會被草稿蓋回去。
6. **明確會改的欄位**（畫面明列）：
   - `reviewedAt`：今天（與 §22 的 `EDIT_DERIVED` 相同）。
   - `status`：職缺、採購一律 `published`，疫情報導沿用現行版。現有內容都是 `published`，所以實際上不會變；值不同時畫面會列出。
   - **已下架的甄選名單（職缺）：** 頁面沒有名單，所以匯出的檔案不含正取、備取與遞補名單，只留公告日、下架日、字號。這正是治理引擎提醒的「下架後請把名單從檔案刪除」。畫面明說：「甄選結果已於 … 下架：這一頁沒有名單……覆蓋原檔前請確認」。不再多寫 `admitted: []`。
7. **「改了哪些欄位」：** 職缺、採購在匯出區、疫情報導在修改說明框，用 `editDiff` 與現行版逐欄比較並列出全部不同的欄位（中文名＋代碼）。沒有不同時寫「內容與現行版相同（另外匯出時會更新：最後審閱日）」。
8. **接種時程改用 `mergeSchedule(工作副本, 現行版, orig)`**（`vaxschedule-edit-core.js`）。主檔是一張表，所以以 `id` 對應每一筆：
   - 順序沿用現行版。新增的一筆放在它在工作副本裡的前一筆後面（「新增一筆」本來就插在目前這筆之後）。
   - 沒動的筆（與載入時相同，或只是經過表單來回）原樣保留現行版的物件。
   - 改過的筆逐欄三方合併，base＝那一筆經過表單來回的樣子（`buildItem(stateFromItem(載入時))`）。
   - 刪除的筆拿掉。載入之後 main 才多出來的筆（別人加的）保留。

   下載、複製、修訂摘要、畫面上的 JSON 都用這一份。CSV 是給人看的，仍依疫苗與月齡排序。
9. **疫情報導分類主檔**（`categoriesJson(分類, 原檔)`）：沒改的分類沿用原檔的物件（表單沒有的鍵也保留），格式跟原檔一樣「一個分類一行」。加一個分類只多一行。

實測（同樣的 Playwright 腳本，全部重跑）：

| 編輯頁 | 不改就匯出 |
| --- | --- |
| 職缺 | 11／11 只差 `reviewedAt`；`job.2026-05-25-quarantine-officer-kaoping` 另外少了已下架的名單（畫面明說），其他一個位元組都不變 |
| 採購 | 8／8 只差 `reviewedAt` |
| 疫情報導 | 4／4 只差 `reviewedAt`（舊分類代號、圖檔替代文字、空陣列都原樣） |
| 接種時程 | 載入後、逐筆點過後，匯出都與原檔逐位元組相同，畫面都是「與目前上線版本相同」 |

只改一個欄位：

| 改什麼 | 檔案裡變的欄位 |
| --- | --- |
| 職缺標題（英文已複核） | `title`、`languages`（英文仍是已複核，加上舊版雜湊）、`reviewedAt` |
| 職缺資格條件中間一行 | `qualifications`（只有那一行，順序不變）、`languages`、`reviewedAt` |
| 職缺截止日、異動紀錄 | 只有那一欄＋`reviewedAt`（不是正文，英譯不動） |
| 採購預算、決標資訊 | 只有那一欄＋`reviewedAt` |
| 採購範圍一行 | `scope`、`languages`、`reviewedAt` |
| 疫情報導篇名、某一段正文、一筆參考文獻 | 只有那一欄＋`reviewedAt` |
| 疫情報導某張圖的替代文字 | `figures`、`assets`（只有那張圖的宣告的 `alt`）、`reviewedAt` |
| 接種時程某一筆的項目名稱 | 只有那一筆的 `label`，其他 41 筆與鍵順序不變 |

### 24.4 已知限制與待決策

1. **（需決策）圖的替代文字與附件宣告綁在一起。** `buildArticle` 的設計是「附件宣告的 `alt` 取自圖表」。所以同事改了圖的替代文字，那張圖的附件宣告也會跟著改，畫面會列出「圖表、附件與圖片」兩欄。`article.teb-42-19-1` 目前兩者本來就不同（宣告的較短）。如果兩者應該各自獨立，要改的是 `buildArticle`。
2. **（已處理，見 §24.7）從閘道送審疫情報導時，不會帶分類主檔。** 原本在頁面上新增分類後，「產生上架包」會多一個 `content/master/bulletin-categories.json`，送審卻只帶新卷期；閘道收到的文章用了網站上沒有的分類，檢查就擋下。
3. **已下架的名單無法保留。** 公開的靜態頁不能放名單，所以匯出一定不含名單。目前這正是治理要求的做法，畫面也會明說。如果某個職缺下架後仍要在檔案裡留著名單，只能請資訊室直接改檔。
4. **匯出一定會把 `reviewedAt` 改成今天**，即使什麼都沒改（與 §22 相同）。職缺、採購走快車道（經閘道送審時，不在授權名單內的承辦人改走一般車道，§25.1），這個日期等於「承辦單位最後確認公告的日子」。
5. **表單會略過的列。** 例如附件行少了網址、沒有說明也沒有檔案的圖表列。現行版若有這種項目，而同事又改了那一欄，那一欄就以表單為準（這種項目會不見）。目前的內容沒有這種情形。
6. **同時修改。** 疫情報導編輯頁寫入閘道時有版本檢查（§23.5）。**第五十三輪起職缺、採購、接種時程也接上閘道（§25）**：有閘道時存檔帶版本碼、被擋時可以載入最新版，接種時程以列合併。沒有閘道時（GitHub Pages 示範站、`?gateway=off`、上架包）仍是「匯出整份檔案、開 PR」，與 §22.6 第 1 點相同，載入之後 main 又變了的情況要靠 PR 審查；草稿記下 base／orig 只保護「重新開草稿」這一種情況。
7. **表單仍刪不掉現行版的附件**（與 §22.6 第 3 點相同）。

### 24.5 教訓

- **編輯頁的「現行版」必須是 content 檔。** 這一輪三種問題裡有兩種，是因為資料島來自建置在記憶體裡處理過的資料（正規化分類代號、撤下名單）。建置在記憶體裡做的事，修改時要嘛還原（分類代號），要嘛明說（名單）。測試現在會先檢查「資料島＝content 檔」，以後載入時多做一種正規化，這個測試會先擋下來。
- **每個有自己匯出函式的編輯頁，都要跑「不改就匯出」的檢查。** §22 只修了上架頁，另外四個頁面同樣的問題又存在了好幾輪。以後新增編輯頁，請把它加進 `tests/round52-editors-preserve.test.mjs` 的端到端測試。

### 24.6 測試

`tests/round52-editors-preserve.test.mjs`：

- **資料島＝content 檔：** 職缺（已下架的名單除外）、採購、疫情報導（還原舊分類代號後）、接種時程，都與檔案逐位元組相同。
- **不改就匯出（Node，照頁面流程）：** 全部職缺、採購、文章只差 `reviewedAt`；已下架名單的職缺另外只差名單。「改了哪些欄位」都是空的。
- **只改一個欄位：** 上面 24.3 表格裡的每一種，檔案只動那一欄（加上 `reviewedAt`，改到正文時加上 `languages`），鍵順序不變。表單強制的預設值（權責單位、對象、審閱週期）不會蓋掉現行版。
- **分類主檔：** 沒改＝原檔；加一個分類只多一行；改一個分類只有那一行變，表單沒有的鍵保留。
- **接種時程：** 不改、或每一筆都經過表單來回，匯出＝原檔；改一筆只動那一欄；新增、刪除的位置；載入後 main 上別人改的筆不會被草稿蓋回。
- **端到端（Playwright）：** 四個頁面開啟每一筆既有內容、不改就匯出，與原檔只差 `reviewedAt`，畫面寫「內容與現行版相同」；已下架名單的職缺畫面明說；改職缺標題、採購預算、文章篇名、時程項目名稱，只動那一欄，畫面列出的欄位與實際差異一致。

### 24.7 分類主檔經閘道送審（第五十二輪合併後）

§24.4 第 2 點的後續：疫情報導編輯頁的「分類管理」改過，送審時分類主檔跟文章一起送。程式在：

- `workflow.mjs`：`writeVersion` 的分類段、`catsMoved`、`extrasFor`。
- `validate-item.mjs`：`CATEGORIES_PATH`、`categories` 選項。
- `bulletin-edit-core.js`：`mergeCategories`、`categoryChanges`。

**契約。** `/drafts`、`/submit` 多收 `categories: { items, start }`：表單上的分類，與同事開始改時的分類（頁面載入時的主檔；從送審件開啟時是送審件開始時的主檔）。

- **只能跟疫情報導文章一起送**，其他型別 422。
- **路徑寫死**（`content/master/bulletin-categories.json`，定義在 `validate-item.mjs`）。不收也不看前端送的路徑，送了 `path` 也被忽略（測試會送）。其他主檔與治理設定仍不走閘道。
- **格式**：各最多 60 列、每列是物件，否則 400。
- **內容**：用建置同一套規則檢查（`master.json` 的 `bulletinCategory` 結構、`categoryProblems`），文章的「分類存在」也依合併後的主檔檢查。錯誤訊息像「第 9 個分類「壞的」的代號格式不對」，不出現 JSON 路徑。
- **已上架的分類不能刪，只能停用**：閘道自己擋（422），不靠頁面。舊文章還在用那個分類，刪了建置就會失敗；而閘道的檢查只回報這一篇與主檔本身的錯誤，看不到別篇因此出錯。
- **車道**：含分類主檔一律一般車道，與 CI 的 `classifyFile`「主檔變更需審核」相同，車道說明寫出原因。四眼原則不變：存過的人不能核准。
- **審核人看得到**：差異上方另列「核准後也會更新疫情報導的分類（所有文章共用）」與每一項修改（新增、停用、改了哪些欄位）。送審件資訊多一列「一起上線」，新卷期也列在這裡。

**為什麼以分類代號為單位合併，而不是比對整份主檔的版本碼。** 分類主檔是所有文章共用的一個檔。用版本碼的話，別人在另一篇加了一個不相干的分類，這一篇就存不進去，同事得載入最新版重來；但兩人各加一個分類其實沒有衝突。所以閘道把 `start → items` 的差異（我加、改、停用了哪些分類）套到網站上現在的主檔。這和 §22、§24「以現行版為底，只套用同事改過的」是同一個契約：

- 只有一方改的分類用那一方；兩方改成一樣照用。
- 兩方把同一個分類改得不一樣（含兩人用同一個代號加了不同的分類）⇒ 409 `stale`、`kind: categories`，什麼都不寫。回應附網站上的主檔與衝突的分類。
- 頁面按「載入最新版（保留我的修改）」：以網站上的主檔為新起點，重新套用我其他的修改；衝突的先用網站上的，列出我原本的值。
- 輸出用 `categoriesJson`：沒改的分類沿用網站上的物件與表單沒有的鍵，一個分類一行。

**送審期間網站上的主檔變了。** 兩邊都動了同一個檔的相鄰幾行，上線時就會卡住，所以比照 §23.4：

- 送審件記著開始時的提交（`sub.base.commit`）。網站上的主檔跟那時不同 ⇒ 核准回 409 `outdated`，審核頁說明、核准鈕停用。
- 承辦人重新開啟：閘道把網站上的更新併進來（`extrasFor`），起點換成網站上的。再存檔時，閘道從網站上的最新版另開新分支寫入（與 §23.4 同一條路）。
- 「不用修改，再送出」：沒有衝突就由閘道直接併入、另開新分支後送審。
- 這篇文章本身在網站上也更新了、承辦人卻還沒看過 ⇒ 閘道不會替他另開分支（會蓋掉那次更新），回 409 `moved`。
- 送審件裡已帶著分類主檔、這次存檔頁面沒送 ⇒ 沿用送審件裡的，不悄悄丟掉。頁面把分類改回原樣再送 ⇒ 主檔改回網站上的，送審件不再帶主檔。

**已知限制：**

1. 以「一個分類」為單位：同一個分類的中文名稱與英文名稱分別被兩人改，也算衝突（同 §23.7 第 2 點的保守取捨）。
2. 閘道的內容檢查用的是閘道主機上 `content/` 的站台資料（第三十輪起就是這樣）。網站上已上線、但閘道主機還沒更新的新分類，另一篇文章要用它而沒有一起送分類主檔時，會被檢查擋下。重新部署閘道，或在頁面上再送一次分類主檔即可。
3. 頁面的資料島（建置時的主檔）比網站上的舊時，合併仍以頁面載入時的為起點，不會蓋掉網站上較新的分類；但「分類管理」表格要等網站更新後才看得到那些新分類。

**測試**（`tests/round52-bulletin-gateway.test.mjs`）：

- 合併規則：兩人各加一個、只有一方改、兩方都改、同代號不同內容、表單沒有的鍵不算；給審核人的句子。
- 頁面的版本碼：每一篇文章的資料島（還原舊分類代號、附正本雜湊）與 content 檔同碼。
- 閘道：
  - 沒帶主檔就擋；帶了 ⇒ 固定路徑、只多一行、一般車道、四眼原則、核准後兩個檔都上線。
  - 兩篇各加一個分類 ⇒ 第二篇 `outdated`；重新開啟已併入，另開新分支後兩個都在。
  - 「不用修改，再送出」自動併入；同一分類衝突 ⇒ 409、不寫入。
  - 非文章 422、格式不對 400、內容錯誤說第幾個分類、刪除已上架的分類 422。
  - 重新開啟帶回新卷期與分類主檔；從網站版本開啟、已有進行中的送審件 ⇒ 409 `open`。
- 端到端（Playwright＋真的閘道，先 `BASE_PATH='' BUILD_TODAY=2026-10-14 npm run build`）：
  1. 開啟後別人改篇名並上線 ⇒ 存檔被擋，說明誰改、改了什麼。載入最新版後篇名是別人的、摘要是我的，「改動的欄位」只列摘要；存進去兩邊都在。
  2. 另一位從網站版本開啟 ⇒ 存檔鈕停用。按「從那一件繼續」後依舊版存被擋；載入最新版後「改動的欄位」只列他自己的。重新整理後仍以送審件為底。
  3. 新增分類並用在這篇、也改了一個既有分類的名稱，同時網站上另加一個分類、也改了同一個分類 ⇒ 送審被擋（分類衝突）。載入最新版後衝突的用網站上的；送審後兩個新分類都在。
  4. 審核頁列出分類的修改。退回後重新開啟，分類與這篇的分類都帶回表單；再送審、核准，網站上兩個檔都更新。

## 25. 職缺、採購、接種時程接上寫入服務（第五十三輪）

給資訊室。同事端的說明見 guide-staff §56。

第五十二輪以前，這三個編輯頁只能「下載 JSON（或匯出主檔）→ 交資訊室開 PR」，沒有閘道的存草稿、送審、退回、版本檢查（§23.5 最後一點、§24.4 第 6 點）。這一輪接上，**沿用同一支 `publish-gateway.js` 與同一份閘道契約**，沒有另做一套：

| 頁面 | 送到閘道的是 | 權責單位 | 版本碼 | 載入最新版 |
| --- | --- | --- | --- | --- |
| `/admin/jobs/edit/` | 一筆內容（`content/jobs/*.json`，型別 `job`） | 人事室 | 資料島的 `versions`（由檔案算） | `reloadLatest`（與疫情報導同一個做法） |
| `/admin/tenders/edit/` | 一筆內容（`content/tenders/*.json`，型別 `tender`） | 秘書室 | 資料島的 `versions`（由檔案算） | 同上；我加的異動紀錄仍標「本次新增」 |
| `/admin/vaccines/schedule/` | **主檔** `master: { name, items, start }` | 急性傳染病組 | `contentVersion(start)` | 以列合併（`master-merge.js` 的 `mergeRows`） |

沒有閘道時（GitHub Pages 示範站、`?gateway=off`）送審面板不出現，下載 JSON、匯出主檔、上架包流程完全照舊；有閘道時「下載後開 PR」的步驟說明會藏起來（`data-gw-hide`），改顯示一句「用送審與上線即可」。

程式：

- 頁面：`src/client/admin/jobs-edit.js`、`tenders-edit.js`、`vaxschedule-edit.js`（各自的 `getBaseHash`、`reloadLatest`、`initPublishGateway`）；共用面板 `src/templates/admin/_partials.mjs` 的 `gatewayPanel()`。
- 主檔合併與白話差異：`src/client/admin/master-merge.js`（頁面與閘道共用）、`vaxschedule-edit-core.js` 的 `scheduleDiffOptions`。
- 閘道：`scripts/lib/gateway/workflow.mjs`（`writeMaster`、`masterDraftState`、`publishMaster`、`currentMaster`、`masterDiff`）、`validate-item.mjs`（`MASTER_FILES`、`validateMaster`、`duplicateRows`、職缺／採購錯誤的白話）、`field-diff.mjs`（`type: 'rows'`）、`index.mjs`（`decodeMaster`、`GATEWAY_REQUIRE_BASE_HASH`）。
- 審核頁：`src/client/admin/review-gateway.js`。

### 25.1 職缺與採購：一般內容，個資規則由閘道照 CI 擋

職缺、採購本來就是 `content/` 下的一筆內容（`TYPE_DIR` 第三十輪就有 `job`、`tender`），所以走 `/drafts`、`/submit` 的 `item` 路徑，版本檢查、三方合併、`outdated` 都與 §23 相同。這一輪補的是：

- **頁面的版本碼由檔案算。** 甄選結果過了下架日，建置會在記憶體裡拿掉名單（`resultTakenDown`），所以資料島的那一筆跟檔案不同；若用資料島算碼，這些職缺每次存檔都會被誤判成「別人改過」。模板改由 `j.__file` 讀檔、`versionOfText` 算，放在資料島的 `versions`。從閘道帶回的一筆（送審件、網站最新版）也照建置的規則拿掉已下架的名單（`takeDown`），兩種開法的現行版一致；存檔後名單就從檔案刪除，與 §24.4 第 3 點相同，畫面會明說。
- **甄選結果的個資規則照 CI 同一份。** 閘道的檢查就是 `validateSite`（`careers-rules.js` 的 `jobPiiErrors`、`jobResultProblems`）：名單只能有序號與報名編號、不能有姓名或疑似身分證字號、要有下架日且在上下限內。這一輪只把錯誤訊息改成白話並歸到「甄選結果」欄位（點錯誤就跳到那一區），例如「「甄選結果」少了「下架日」，請補上」「個資閘門（甄選結果只公布報名編號，不公布姓名）：…有 name 欄位…」。職缺、採購的跨欄位檢查（`award.date 早於開標日`、`applyStart 晚於 deadlineAt` 等）也歸到欄位、欄位代碼換成中文。
- **審核人看得懂的差異。** 以前異動紀錄、甄試日程、名單、附件、決標資訊這類「物件清單」或「物件」在差異裡只顯示「已修改」加一大段 JSON。`field-diff.mjs` 新增 `type: 'rows'`：逐筆一句話，新增的標底線、刪除的標刪除線：異動紀錄「2026-10-14 展延：報名截止延至 10 月 30 日。」、甄選結果「備取名單：移除 備取第 1 名：1150810-002（有效至 2026-12-21）」、決標資訊「得標廠商：填寫為「…」」。欄位名稱用 `field-labels.js` 的同一份（職缺、採購的欄位名從 `edit-merge.js` 移過來共用）。
- **車道。** 職缺、採購在 `lanes.json` 是快車道，但自動合併只限 `allowedAuthors`；示範帳號不在名單內，所以經閘道一律走一般車道、需要 1 位核准（公關室或權責單位的審核人），車道說明寫出原因。正式環境把人事室、秘書室的承辦人帳號（或 team）加進 `allowedAuthors`，就會照快車道「檢查通過即上線、24 小時內上線後複核」。
- **退回與核准通知的連結** 依型別回到各自的編輯頁（`/admin/jobs/edit/?gw=…`、`/admin/tenders/edit/?gw=…`），不再一律回上架頁。

### 25.2 接種時程：主檔，以列合併

接種時程表是一整份陣列（`content/master/immunization-schedule.json`，42 筆），不是一筆內容。做法與疫情報導分類主檔（§24.7）同一個契約：

- **契約。** `/drafts`、`/submit` 收 `master: { name: 'immunization-schedule', items, start }`：`items` 是頁面的整份主檔（已以現行版為底，§24.3），`start` 是同事開始改時的主檔（頁面載入時的；從送審件開啟、或載入最新版之後，是那時的那一份）。`baseHash` 是 `contentVersion(start)`，閘道核對兩者一致（不一致 400 `bad_master`，避免頁面帶錯起點）。同一個請求不能同時帶 `item`（400）。
- **路徑與可送的主檔寫死**（`validate-item.mjs` 的 `MASTER_FILES`）。只有這一份，其他主檔（單位、疫苗、疾病）與治理設定仍不走閘道。不收也不看前端送的路徑；`name` 不在清單內 422；列數上限 400、每列要是物件，否則 400。
- **權限。** 主檔的權責單位是急性傳染病組（`MASTER_FILES.owner`），編輯角色要屬於這個單位才能存；審核是同組審核人或一般車道的審核單位。別組（含慢性傳染病組）403。
- **檢查。** `validateMaster` 把送來的整份換進站台資料、跑 `validateSite`，只留這個檔的錯誤，翻成「第 13 筆（MMR 疫苗 第 1 劑）［sched.mmr-1］：疫苗 vaccine.zzz 不在疫苗主檔」「「第 4 筆（卡介苗 1 劑）的階段」的選項不在允許的清單內」，不出現 JSON 路徑。**編號重複在合併前就擋**（`duplicateRows`）：合併以編號對應，重複的列會被吃掉，同事卻不知道。
- **合併。** `mergeRows(start, items, 網站上的主檔)`，以 `id` 對應每一列：
  - 只有一方改的列用那一方；兩方改成一樣照用。
  - **同一列兩邊都改了，再逐欄合併**：改的是不同欄位（我改備註、別人改年齡寫法）不算衝突。這比分類主檔細一層（§24.7 已知限制 1），因為時程表一列欄位多、常被不同人改不同欄。
  - 同一列同一欄改得不一樣、或一邊刪一邊改、兩人用同一個編號加了不同的列 ⇒ 409 `stale`、`kind: master`，什麼都不寫。回應附「網站上的（或送審件裡的）整份主檔」與衝突的列（我的值），頁面不必再抓。
  - 列的順序沿用網站上的；我新加的列放在它在我的版本裡前一列的後面。
  - 寫出用 `JSON.stringify(rows, null, 2)`，與原檔格式相同；沒改的列一個位元組都不變（測試逐行比對：改一個欄位，差異只有一刪一加）。提交訊息帶 `Master-File: immunization-schedule`。
- **車道。** 主檔變更一律一般車道（與 CI 的 `classifyFile`「主檔變更需審核」相同），車道說明寫「更新疫苗接種時程表（主檔）：主檔變更需審核，走一般車道」。
- **一份主檔同時只有一件送審件**（與 §23.7 第 3 點相同）。另一位依網站版本改、沒指定送審件 ⇒ 409 `open`（請從那一件繼續），不悄悄寫進那一件。
- **送審期間網站上的主檔變了**（資訊室直接改檔、別的管道）：比照 §23.4 與 §24.7。審核頁說明「還不能核准」、核准回 409 `outdated`；承辦人重新開啟時閘道把網站上的更新以列合併進來（`masterDraftState`），再存就從網站上的最新版另開新分支寫入；網站上的更新與送審件改到同一列同一欄、同事卻還沒看過合併後的版本 ⇒ 409 `moved`。
- **審核人看到的差異是逐筆、逐欄的白話**（`masterDiff`、`rowChanges`）：「修改「MMR 疫苗 第 1 劑」（sched.mmr-1）：建議年齡下限由「12 個月」改為「15 個月」；費用由「公費」改為「自費」」，月齡寫成幾歲幾個月、階段與費用寫中文、疫苗寫名稱。上方另有一框說明「這是主檔的修改」與核准後會一起變的頁面（時程地圖、表格、問答、開放資料）。預覽（`/items/:id/preview`）把主檔畫成表格。
- **上線。** 核准後與一般內容一樣合併到 main（`publishMaster`），稽核記 `contentId: master.immunization-schedule`。網站要等下次建置才更新地圖與表格（與其他內容相同）。

為什麼以「列」合併、而不是只比整份主檔的版本碼：時程表是很多人共用的一張表。只比版本碼的話，資訊室改了不相干的一列，承辦人就存不進去、得重來；但兩人改不同列其實沒有衝突。所以閘道把「開始時 → 我的版本」的差異套到網站上的主檔，只有真的改到同一格時才請人決定。版本碼仍要送：它讓閘道確認頁面的起點沒有被竄改或帶錯，也讓「網站上有更新的版本」「已有進行中的送審件」這些提醒在開啟時就出現。

頁面這邊（`vaxschedule-edit.js`）：

- `live`＝合併的底（網站上的，或送審件裡的），`orig`＝開始時的主檔，匯出仍是 `mergeSchedule(items, live, orig)`（§24.3）。
- 存好一版後，閘道回合併後的整份主檔（可能含別人同時改的其他列），頁面以它為新的起點（`live`、`orig`、工作副本都換掉，目前那一筆留在原處）。
- 「載入最新版（保留我的修改）」用同一支 `mergeRows`：我改的列與欄重新套到最新版上，衝突的先用最新版、列出我原本的那一列。
- 本機草稿從送審件帶回時記 `gwLive`，重新整理後仍以送審件的版本為底。

### 25.3 職缺、採購的「載入最新版」

與疫情報導編輯頁（§23.5）同一個做法：「我改的欄位」＝表單匯出跟 `editBase` 不同的欄位；「別人改的」＝最新版跟我開啟時的版本（`live`）不同的欄位。先以最新版重新帶入表單、重新記 `editBase`，再把我改、別人沒改的欄位寫回表單；兩邊都改的先用最新版，列出我的值。兩頁特有的：

- **異動紀錄。** 我已經按過「加入異動紀錄」（日期的比對基準移過）⇒ 載入最新版後沿用我的基準，不會再提醒「日期改了還沒記」。採購頁我加的、最新版還沒有的那幾筆仍標「本次新增」（可以移除），最新版已有的標「已公告」。
- **從送審件開啟（`?gw=`）** 時，送審中的一筆若不在資料島（例如新職缺），選單會多一個「（送審中）」選項。
- **新職缺、新標案**：版本碼是 `new`；網站上已有同 ID ⇒ 409 `exists`（§23.3）。

### 25.4 慢性傳染病組的示範帳號

`auth-rules.js` 的 `DEMO_ACCOUNTS` 多兩個：`demo-009` 周○廷（承辦人，`editor`）、`demo-010` 鄭○萱（科長，`editor`＋`reviewer`），與急性傳染病組的 `demo-001`／`demo-002` 同一個配置。登入頁、後台權限、閘道的開發用登入都從這份名單推出群組（`adGroupsOf`），不必另外設定。測試確認：承辦人能存草稿、送審，不能審自己的；同組科長能核准；急性組的科長不能核准慢性組的內容；慢性組不能改急性組的接種時程。

### 25.5 驗證過的錯誤訊息改善（所有型別）

`plainError` 這一輪順手修了兩處，所有型別都受益：

- 欄位裡面少了子欄位（AJV 的 `required` 在巢狀路徑）以前會變成「「seq」必填」並歸到不存在的欄位；現在歸在外層欄位，訊息像「「甄選結果（正取名單・第 1 項）」少了「報名編號」，請補上」。
- AJV 的 `propertyNames` 與 `not` 錯誤（以前原樣顯示英文 `must NOT be valid`）改成「有不允許的欄位」「有不允許的內容」。
- 欄位名稱改用顯示用的那一份（`fieldLabel`），職缺、採購的欄位不再顯示代碼。決定錯誤歸屬的仍是 `FIELD_LABELS`（加上職缺、採購跨欄位檢查的固定幾個欄位），不影響其他型別。

### 25.6 沒帶版本碼的寫入：設定開關（預設照收）

§23.6 決定「沒帶版本碼照舊接受、稽核記 `baseHash: missing`」。這一輪三個編輯頁也都帶碼了，閘道多一個開關，但**預設不變**：

| 設定 | 行為 |
| --- | --- |
| （預設）`GATEWAY_REQUIRE_BASE_HASH` 未設定 | 照收；稽核紀錄記 `baseHash: "missing"`（內容與主檔都一樣） |
| `GATEWAY_REQUIRE_BASE_HASH=1` | 沒帶（或格式不對、當成沒帶）的存草稿、送審回 **428 `version_required`**：「這個頁面沒有告訴系統你是依哪一版改的（可能是很久以前開啟的舊頁面），為了不蓋掉別人的修改，這一版還沒有存。你的修改仍在這台電腦上；請重新整理頁面後再存。」 |

只認 `1`（`true`、`yes` 都不算），避免打錯字就在上線當天鎖住所有存檔。不受影響的：送審件已在系統裡時的「不用修改，再送出」（閘道自己從送審件取內容）、重新審閱、閘道內部的合併。

**正式環境的建議：** 上線初期維持預設，觀察稽核紀錄裡 `baseHash: missing` 的來源。等以下三件事都成立，再設 `GATEWAY_REQUIRE_BASE_HASH=1`：

1. 稽核紀錄連續一段時間（建議兩週，涵蓋一次完整的發布週期）沒有 `missing`，或剩下的都已確認是誰、為什麼。
2. 舊版頁面已不在使用：前台與後台的靜態檔換版後，同事的瀏覽器分頁也會重新載入（後台的工作階段 8 小時、閒置 30 分鐘就要重登，所以通常一天內就換完）。
3. 外部腳本（若有直接呼叫 `/api/gateway/drafts` 的，例如批次匯入工具）都已改成帶版本碼。

為什麼要等：拒絕是「上線當天就可能讓舊頁面存不了」，而照收只是「維持以前的保護程度」，加上送審時仍會擋下 main 已變的情況（§23.4），不會比以前更糟。打開之後，沒帶碼的寫入連「悄悄接著寫進進行中的送審件」這種舊行為都不會發生。

### 25.7 已知限制與待決策

1. **（已決定，見 §26.1）職缺、採購的快車道名單。** 經閘道時，只有 `lanes.json` 的 `allowedAuthors` 內的帳號走快車道（檢查通過即上線）。目前名單只有一個測試帳號，所以人事室、秘書室實際上都走一般車道、要公關室或同單位審核人核准。要不要讓這兩個單位的承辦人自動上線、名單放誰，要由業務單位與公關室決定。
2. **主檔的衝突以「一列的一個欄位」為單位。** 同一筆的來源（`source`，標題＋網址）是一個欄位：一人改標題、一人改網址仍算衝突。
3. **只有接種時程這一份主檔能送。** 其他主檔仍由資訊室開 PR。要加新的主檔，在 `MASTER_FILES` 加一列（路徑、權責單位、編號欄位、`site.master` 的鍵、列數上限），頁面用 `exportMaster()` 接上，並補測試。
4. **審核人看不到地圖的預覽。** 預覽是一張表格；要看時程地圖的樣子，仍請承辦人截圖或在送審說明附上。
5. **已下架名單的職缺** 經閘道存檔後，檔案裡的名單就刪除了（與 §24.4 第 3 點相同，畫面會明說）。要保留名單只能請資訊室直接改檔。
6. **主檔的格式要與 `JSON.stringify(rows, null, 2)` 相同。** 目前的檔案是；如果日後有人手動把它改成別的縮排，第一次經閘道存檔時整份都會被重新排版（內容不變）。

### 25.8 測試

`tests/round53-editors-gateway.test.mjs`：

- **純函式：** `mergeRows`（不同列、同一列不同欄位、同一欄衝突、一邊刪一邊改、新增列的位置）；`rowChanges`／`rowChangeText`（月齡、階段、費用、疫苗名稱的白話；只換順序）。
- **版本碼：** 主檔整份算（列序算、鍵序不算）；三個編輯頁資料島的版本碼＝每一個 content 檔的版本碼（職缺已下架名單的那一筆，資料島本身不同碼，所以一定要由檔案算）；面板預設隱藏、「下載後開 PR」標了 `data-gw-hide`。
- **閘道（接種時程）：**
  - 固定路徑、只改一行、一般車道（主檔變更需審核）、逐筆差異、四眼原則、別組不能審、退回通知連回接種時程頁、重新開啟、核准上線。
  - 網站上別人改了其他列或同一列其他欄 ⇒ 照存、兩邊都在；同一列同一欄 ⇒ 409 `master`，附合併後的主檔與我的值，什麼都不寫；載入最新版後存得進去。
  - 已有送審件時依網站版本存 ⇒ 409 `open`；`/current` 的主檔、版本碼、進行中的送審件。
  - 送審期間網站上的主檔變了 ⇒ `outdated`、核准 409；重新開啟已併入，再送審核准後兩邊都在。
  - 檢查：疫苗不在主檔、選項不對、編號重複都說第幾筆；不開放的主檔 422、起點對不上 400、別組 403；HTTP 格式不對、與內容一起送、超過列數 400；預覽是表格。
- **閘道（職缺、採購）：** 個資規則（姓名、身分證字號、沒有下架日）擋下並歸到「甄選結果」；跨欄位檢查的白話；職缺與採購送審、一般車道、逐筆差異（異動紀錄、決標資訊、名單）、別單位 403、四眼原則；通知連結回各自的編輯頁。
- **沒帶版本碼：** 預設照收、稽核記 `missing`（內容與主檔）；開關打開 ⇒ 428（內容、主檔、HTTP 格式不對），「再送出」不受影響。
- **示範帳號：** 慢性傳染病組的承辦人與科長、群組、四眼原則。
- **端到端（Playwright＋真的閘道，先 `BASE_PATH='' BUILD_TODAY=2026-10-14 npm run build`）：**
  1. 職缺：開啟時版本碼＝檔案的碼；存草稿；資訊室在網站上改了工作地點、另一位同事從送審件改了薪資 ⇒ 我再存被擋；載入最新版後三個人的修改都在表單上；送審、公關室看到逐欄差異、核准，main 上都在；`?gateway=off` 面板不出現、下載照舊。
  2. 採購：我加了異動紀錄、改了聯絡窗口；別人改了特別條款並上線 ⇒ 我存檔被擋、說明是誰；載入最新版後特別條款是別人的、我的聯絡窗口與「本次新增」的異動紀錄都在；送審、審核人看到逐筆的異動紀錄（不含別人已上線的修改）、核准。
  3. 接種時程：存草稿只改一行；我又改了兩筆，同時資訊室在網站上改了同一筆同一欄與另一筆 ⇒ 存檔被擋；載入最新版後衝突的用網站上的、列出我的值，我其他的修改與資訊室的修改都在；決定後送審（同一件）、同組科長看到逐筆差異（不含資訊室的修改）、核准，main 上三處都在；`?gateway=off` 面板不出現。

## 26. Yulun 對三個待決事項的決定（第五十四輪，2026-10-15）

Yulun 對第五十三輪留下的三個問題（§25.7 第 1 點、§25.6、兩則逾期 Q&A）都回答「ok」。這一節寫每一項改了什麼、為什麼這樣改，以及資訊室要做什麼。取捨見 architecture-decisions §42；同事說明見 guide-staff §57。

### 26.1 人事室的職缺、秘書室的採購公告：承辦人送出即上線

**改了什麼：** `content/governance/lanes.json` 的快車道多一個 `allowedAuthorsByType`：

```json
"allowedAuthorsByType": {
  "job":    ["team:CDC-WEB-personnel-editor"],
  "tender": ["team:CDC-WEB-secretariat-editor"]
}
```

- 寫入閘道判斷車道時（`workflow.mjs` 的 `laneFor`），送審人不在整條車道的 `allowedAuthors` 裡，就再看這份：這筆內容的型別有自己的名單、送審人的 AD 群組在名單內 ⇒ 快車道，**檢查通過即上線**，不必等核准。
- 名單寫 `team:<AD 群組>`。群組就是登入時帶進來的 `CDC-WEB-<單位>-<角色>`（`auth-rules.js` 的 `adGroupName`；docs/admin-auth.md §7）。人事室的承辦人在 `CDC-WEB-personnel-editor`，秘書室在 `CDC-WEB-secretariat-editor`。正式環境不需要另外維護人名清單：人員異動由 AD 群組管理。
- CI（GitHub PR）用同一個函式 `laneAuthorGate`（`scripts/lib/lanes.mjs`），不過 CI 傳的是 GitHub team（`org/slug`），要讓 PR 也適用，就在名單加上 `team:<org>/<slug>`。

**沒有變的（Yulun 說的是「免審」，不是「免檢查」）：**

1. 機器檢查照擋：schema、日期先後、甄選結果只能公布報名編號且要有下架日（§25.1）。不合格回 422，什麼都不會上線。
2. 上線後公關室 24 小時內複核（快車道本來的規則，`postPublishReviewHours`），通知信主旨是「【上線後複核】…」。
3. 單位權限：人事室只能改人事室的職缺，秘書室只能改秘書室的標案（`editBlock`）。
4. 跨單位的人（公關室總編輯、OASIS 治理幕僚）改職缺或採購，不在這兩個群組裡 ⇒ 照舊一般車道、要另一人核准。

**為什麼不直接把兩個群組加進 `allowedAuthors`：** 那份名單對整條快車道有效（新聞稿、通函、澄清稿、宣導 Banner 也在快車道）。加進去等於讓人事室與秘書室的承辦人也能免審發新聞稿、澄清稿，超出 Yulun 決定的範圍。按型別授權，名單的效力剛好就是決定的範圍。

**「每個型別都要有」的規則：** 同一次變更（CI 的一個 PR）同時有職缺和新聞稿 ⇒ 新聞稿沒有型別名單 ⇒ 不算授權，整個 PR 走一般車道；理由會寫「型別授權只涵蓋 job、tender，這次還有 news」。閘道一次只送一筆內容，所以只有 CI 會遇到。

**設定檢查（`validateLanes`）：** 型別名單只能寫這條車道自己的型別（寫 `disease` 會被擋，否則等於用名單把一般車道的內容拉進快車道）、名單不能空、只能用在自動合併車道。CI 與 `scripts/lane.mjs` 都會跑；設定錯 CI 直接失敗。

**`GATEWAY_LANES_FILE`（新設定，選用）：** 閘道預設讀 `content/governance/lanes.json`（與 CI 同一份）。測試站或演練要用另一份車道設定（例如先關掉型別授權，演練審核流程）時，設這個環境變數指到另一個檔。檔案形狀不對（`validateLanes` 有錯）閘道**不啟動**：寧可起不來，也不要用一份壞掉的名單決定誰能免審上線。第五十三輪的端到端測試用它釘回當時的車道設定，繼續測送審與核准的流程。

### 26.2 兩則逾期 Q&A 也比照「假設已重新審閱」

「咳嗽多久要懷疑是結核病？」（`faq.tb-cough-two-weeks`，慢性傳染病組）與「M痘疫苗誰可以打公費？要打幾劑？」（`faq.mpox-who-vaccine`，急性傳染病組）比照第五十三輪屈公病、日本腦炎的做法（eval-challenge §12）：

- 只改最上層的 `reviewedAt`：2026-04-01、2026-04-02 → **2026-10-15**（決定當天，也是閘道核准重新審閱時會寫的日期）。下次審閱 2027-04-15（Q&A 是 6 個月週期）。
- 內容、譯文的狀態與譯文的審閱日都沒動：假設中文重審過，不等於英文譯文也重審過。
- 這**不是**權責組室實際審過。schema 沒有「假設審過」的欄位，所以記在提交訊息（`Review-Kind: assumed re-review by owner decision (Yulun, 2026-10-15)`）、本節與同事手冊；兩個組下次實際審閱照常走閘道。
- 對示範站的影響：示範站凍結在 `BUILD_TODAY=2026-10-01`，這兩則在那天本來就還沒逾期，所以示範站上看不出差別；以真實日期建置（正式站）時，它們不再因逾期退出 AI 回答。

### 26.3 何時要求所有存檔都帶版本碼：`npm run gateway:basehash`

Yulun 同意 §25.6 的建議：**稽核紀錄連續約兩週沒有漏帶版本碼，再設 `GATEWAY_REQUIRE_BASE_HASH=1`**。為了讓「連續兩週沒有漏帶」是一個能重跑、結果一致的判斷，而不是請同事自己翻 JSONL，這一輪加了就緒檢查：

```bash
npm run gateway:basehash                      # 讀 .local/gateway-audit.jsonl（或 GATEWAY_AUDIT_FILE），今天往回 14 天
node scripts/gateway-basehash.mjs --file=稽核紀錄.jsonl --days=14 --min-writes=20 --today=2026-10-29 --json
```

判斷「可以打開」要同時成立：

| 條件 | 為什麼 |
| --- | --- |
| 最近 14 天（台灣日期，含今天）沒有任何一次漏帶 | 漏帶 ＝ 稽核記 `baseHash: "missing"`，或開關打開後被擋的 428（`version_required`）。兩種都代表還有舊頁面或腳本沒帶碼 |
| 這 14 天裡至少有 `--min-writes` 次從頁面存檔（預設 1） | 沒人用的兩週證明不了什麼。正式環境建議設成平常兩週的存檔量的一半左右 |
| 稽核紀錄滿 14 天 | 剛上線的前兩週不算 |
| 稽核紀錄的雜湊鏈完整（`verifyAudit`） | 被改過或刪過的紀錄不能拿來下判斷 |

報告會列出漏帶的來源（帳號、單位、哪一筆內容、存草稿或送審、幾次、最後一次時間），資訊室據此去找是哪個舊頁面或外部腳本。結束碼 0 ＝ 可以打開、1 ＝ 還不行、2 ＝ 讀不到紀錄，可以放進每週排程寄給資訊室與 OASIS。

**稽核紀錄多一個欄位 `fromPage: true`：** 同事從頁面送來的存草稿、送審都會記；閘道自己組的寫入（「不用修改，再送出」、重新審閱）不記，因為它們本來就不需要版本碼。報告只算有 `fromPage` 或 `missing` 的那幾筆，所以分母是真的「從頁面存檔」的次數。

**原型的現況：** 原型沒有正式環境的稽核紀錄可以累積，所以開關仍是關的（預設）。正式上線後照上表判斷；打開的方式不變（§25.6）。

### 26.4 測試

`tests/round54-decisions.test.mjs`：

- 車道設定：型別授權只給兩個群組、整條快車道的名單沒變；`validateLanes` 擋下別的車道的型別、空名單、非自動合併車道；`laneAuthorGate` 逐型別判斷（人事室不能讓新聞稿或採購免審、混了新聞稿不行、兩個群組都在可以）；`laneForFiles` 與 CI 同一套。
- 閘道：人事室送職缺直接上線、寄出上線後複核通知；秘書室先存草稿再送也直接上線；甄選結果少了下架日照樣 422、別單位照樣 403；公關室總編輯改職缺仍要核准；兩個編輯頁的說明文字。
- 就緒檢查：漏帶、太短、沒人用、紀錄被改過四種「還不行」，各自說理由；閘道自己的再送出不算存檔；被擋的 428 算漏帶；命令列的結束碼。閘道寫的稽核紀錄 `fromPage` 的有無。`GATEWAY_LANES_FILE` 指到壞檔時閘道不啟動。
- 兩則 Q&A：以 2026-10-01 與 2026-10-15 建置都不逾期、在 AI 白名單、機器翻譯不進答案索引；譯文的審閱日與狀態沒動。

`tests/round53-editors-gateway.test.mjs` 測的是送審、看差異、核准的流程，改成釘回第五十三輪的車道設定（沒有型別授權；單元測試傳 `lanesCfg`，端到端用 `GATEWAY_LANES_FILE`），流程本身沒變。

**踩到的坑：** `tests/round50-rereview.test.mjs` 的端到端測試要在建置出來的「審閱到期」頁找一筆急性傳染病組的逾期內容來走一次重新審閱。第五十三、五十四輪把四筆逾期內容都假設重審之後，清單上原本的候選都不逾期了，測試會**靜靜地略過**（`skip`），CI 仍是綠的。這一輪補上仍逾期的「MMR 候診室影片」當候選。教訓：靠「站上剛好有某種狀態的真實內容」的端到端測試，內容一被處理就失效；跑完整測試時要看略過了幾項、為什麼略過，而不是只看有沒有失敗。

## 27. CI 與建置時間的成長（第五十五輪）

實測、推估與對策全文在 [ci-scaling.md](ci-scaling.md)。維運要記得的三件事：

1. **看 Actions 變慢時，先看是哪一步。** 每個 job 的每一步都有起訖時間（Actions API `jobs`），十天的紀錄顯示 checkout 一直 2–3 秒，長的是 `npm test` 與 axe。
2. **內容的閘門只有 `build --check` 的 4 秒；** PR 車道其餘 5 分鐘是程式品質檢查與三次建置。內容 PR 與程式 PR 分流是最便宜的加速（ci-scaling §6.1；第五十六輪已做，見 §28）。
3. **內容加倍時先超過的是 `ASK_DATA_BUDGET_KB`（§15.3），不是 CI。** 看到這個錯誤不要放寬預算，照 §17 分片或改伺服器端。

## 28. 第五十六輪：內容 PR 與程式 PR 分流、一個 PR 只建一次站、Chromium 快取、程式／文件的審核人

起因是 [ci-scaling.md](ci-scaling.md) §2.2 的實測：`content-pr.yml` 的 test job 約 5.7 分鐘，其中 axe 162 秒、三次建站（`--check` 4 秒、a11y 用 28 秒、預覽 29 秒）、`npm test` 79 秒、安裝 Chromium 16 秒，而真正把關內容的 `build --check` 只要 4 秒。一筆新聞稿的 PR 和一個改版型的 PR 跑一樣的東西，前者大部分是白等。本輪做 ci-scaling §6.1 的四項，外加修正 PR 留言的審核人。

### 28.1 分流：什麼叫「純內容 PR」

**規則**：相對 `origin/main`，這個 PR 改到的**每一個**檔都在 `content/` 或 `data/snapshots/` 底下（改名的檔，新舊兩個路徑都算）。只要有一個檔不是（`scripts/`、`src/`、`tests/`、`schemas/`、`docs/`、`.github/`、`package.json`、`package-lock.json`、`eval/`…），就是程式 PR，照舊全部檢查。沒有任何變更檔也當程式 PR。

| 步驟 | 純內容 PR | 程式 PR（含文件、設定） | 第五十五輪以前（所有 PR） |
| --- | --- | --- | --- |
| checkout、`npm ci` | 跑 | 跑 | 跑 |
| 個資掃描（變更檔） | 跑 | 跑 | 跑 |
| lint、format、typecheck | **略過** | 跑 | 跑 |
| `npm test`（全部，約 79 秒） | **略過** | 跑 | 跑 |
| `npm run test:content`（內容測試子集，約 20 秒） | **跑** | 不跑（已含在 `npm test`） | — |
| `build --check`（schema、治理、評估集版本題） | 跑 | 跑 | 跑 |
| `lane.mjs` | 跑 | 跑 | 跑 |
| 建站 | **一次**（預覽） | **一次**（預覽，axe 也掃這份） | 兩次（a11y 用 `BASE_PATH=''` 一份、預覽一份） |
| 安裝 Chromium | **略過** | 跑（先還原快取） | 跑（每次下載） |
| axe（24 頁 × 3 種視窗） | **略過** | 跑（掃預覽 dist） | 跑 |
| 上傳 artifact | 跑 | 跑 | 跑 |
| 審核人按 Approve 後重跑 | 不建站（預覽只在 `pull_request` 事件推） | 建站（給 axe） | 建兩次 |

**預期時間**（test job，以 10-15 run #77 的各步驟秒數推算，尚待第一個實際 PR 驗證）：

| | 以前 | 現在 |
| --- | --- | --- |
| 純內容 PR | 約 5.7 分鐘 | 約 1.3 分鐘：checkout＋`npm ci` 約 8 秒、個資 1 秒、`build --check` 4 秒、`test:content` 約 20 秒、預覽建置 29 秒、上傳 7 秒，加上 runner 啟動 |
| 程式 PR | 約 5.7 分鐘 | 約 5 分鐘：少一次建站（28 秒）；Chromium 命中快取後只剩 `--with-deps` 補系統套件（16 秒 → 約 5–10 秒）。axe 的 162 秒與 `npm test` 的 79 秒仍在，要再快得照 ci-scaling §6.2 |

PR 留言的表格多兩列：「變更範圍」（純內容／含程式或文件）與「內容測試（npm run test:content）」。純內容 PR 被略過的列顯示 **「⏭ 略過（純內容變更）」**，不是「❌ 失敗」；程式 PR 的內容測試列顯示「—（已含在 npm test）」。

### 28.2 為什麼略過是安全的

1. **純內容 PR 沒有改任何程式。** test job 執行的 `scripts/`、`src/`、`tests/`、`package.json` 與 `main`（合併基準）相同；lint、format、typecheck、`npm test` 檢查的是程式，對同一份程式重跑只會得到和 `main` 一樣的結果。內容本身的閘門（schema、跨檔參照、治理規則、評估集版本題、個資）都還在：`build --check`、個資掃描、`test:content`。
2. **axe 掃的是版型。** 純內容 PR 沒有改版型與樣式。內文的無障礙要求（圖片替代文字長度、檔案資產宣告）在 `build --check` 的資產規則裡。
3. **合併後 `main` 一定全跑。** `pages.yml` 在 push 到 `main` 時跑 lint、format、typecheck、完整 `npm test` 才建置部署，任何一項沒過就不部署。所以內容子集漏掉的東西，最晚在部署前被擋下（代價是 `main` 會紅，見 28.6）。

### 28.3 程式 PR 不能偽裝成純內容

「純內容」由 test job 算一次（決定跳過哪些步驟），lane job 再獨立算一次（決定能不能合併），**以 lane job 的為準**：

- **test job**（`Classify changes`）：在 `npm ci` 之前，只用 `git diff --name-only --no-renames origin/main...HEAD` 算。`--no-renames` 讓改名的新舊路徑都列出來（把 `scripts/lane.mjs` 改名成 `content/news/x.json` 會列出兩個路徑，其中一個在 `scripts/`）。同一份清單也交給 `lane.mjs`（`--files-from`），所以 `lane.json` 也列了改名前的路徑。
- **lane job**（`Validate results`）：不看 artifact 的 `scope`，自己用 `gh api repos/{repo}/pulls/{n}/files` 取 PR 的檔案清單（`filename` 加上改名前的 `previous_filename`），再判定一次。檔案 API 最多列 3000 個檔，列出的數量少於 `gh pr view --json changedFiles` 就整份不採用。以前比對用的 `gh pr diff --name-only` 只列改名後的路徑，而且 diff 太大時會失敗，這次一併換掉。
- **唯一的合併閘門 `GATE`** 也在這一步算：個資掃描、治理閘門一律要 `success`；lint、format、typecheck、`npm test`、axe 要 `success`，或「lane job 判定純內容**而且** outcome 是 `skipped`」，這時記成 `content-skip`；內容測試要 `success`，或完整 `npm test` 已 `success`（記成 `covered`）。`Decide merge` 與最後的 `Fail when checks failed` 只看 `GATE`。
- `content-skip`、`covered` 只能由這一步產生：artifact 的 outcome 先過列舉檢查（`success|failure|skipped|cancelled`），寫 `content-skip` 會變成 `invalid`。
- 驗證中途失敗時，`GITHUB_ENV` 一個值都不寫（先寫到暫存檔，全部通過才一次併入），後面的步驟看不到 `GATE`，一律不合併。
- **合併只合檢查過的 head**：`gh pr merge --match-head-commit`（`github.event.pull_request.head.sha`）。以前若作者在檢查跑完、合併之前又推一個 commit，合併的會是沒檢查過的新 head；現在 head 不符就不合併，新的推送會觸發新的一輪。分流之後這點更重要（純內容 PR 檢查完再補一個程式檔）。

`tests/round40-ci-isolation.test.mjs` 的 `#56` 測試把這些情境實跑一遍：純內容通過、內容測試沒跑、artifact 說純內容但實際改了 `scripts/`、改名、`.github/`／`package.json`／`contentx/` 這類邊界、artifact 直接寫 `content-skip`、檔案 API 列不完、`Decide merge` 只看 `GATE`。

### 28.4 內容測試子集 `npm run test:content`

`package.json` 的 `test:content`：只跑「驗證已提交內容」的測試檔（治理規則套在真實內容上、連結、資產、來源語言、SEO／JSON-LD／API 輸出、日期、個資、移轉清單、跨內容一致性、評估挑戰集格式、官方資料快照、車道設定）。本機 4 核約 22 秒（完整 `npm test` 本機約 104 秒）。

| 檔案 | 為什麼在內容子集 |
| --- | --- |
| `api.test.mjs` | v1 API 用真實內容輸出：外殼、etag、必要檔案 |
| `assets.test.mjs` | 檔案資產宣告核對、替代文字、複製到 dist |
| `governance.test.mjs`、`governance-r2.test.mjs` | 治理規則（白名單、逾期、版本鏈、公告截止…）套在 repo 內容上 |
| `intl-epidemic.test.mjs` | `data/snapshots/travel-epidemic.json` 的欄位與再匯入 noop |
| `jobs.test.mjs` | 職缺、採購（快車道內容）的 schema、階段分布、個資閘門 |
| `jsonld.test.mjs`、`seo.test.mjs` | JSON-LD、sitemap、robots、llms.txt、feeds |
| `lanes.test.mjs` | `content/governance/lanes.json` 的形狀與車道判定 |
| `links.test.mjs` | 站內連結完整性、佔位網址政策 |
| `migration.test.mjs`、`migration-scale.test.mjs` | `content/migration/` 移轉清單與 redirects |
| `round25-dates.test.mjs` | 新聞稿相對日期規則，既有內容全數通過 |
| `round30-pii.test.mjs` | 個資規則、實際內容零命中 |
| `round33-consistency.test.mjs` | 跨內容說法不一致的偵測與判定檔 |
| `round44-leadership.test.mjs` | 首長簡介內容與 schema |
| `round49-challenge.test.mjs` | `content/governance/eval-challenge.json` 的格式與引用 |
| `sourcelang.test.mjs` | 來源語言與譯文欄位 |
| `travel.test.mjs`、`travel-data.test.mjs` | 旅遊疫情快照的等級分布與資料契約 |
| `units.test.mjs` | 單位主檔 |

**加入規則**：

- 會因為「改了 `content/` 或 `data/snapshots/` 的某個檔」而失敗的測試才放進來；只測程式邏輯（合成資料、純函式）的不放。
- 不放啟動瀏覽器、HTTP 伺服器或寫入閘道的測試（`tests/round40-ci-isolation.test.mjs` 會檢查清單裡沒有 `playwright`、`chromium`、`createServer`、`serve.mjs`、`gateway`）。
- 整包要維持在 30 秒內（CI runner 4 核）。`round53-holdout2.test.mjs`（封存盲測題組的引用檢查，單檔約 18 秒，大半是跑執行器）因此沒有放進來，它由合併後 `main` 的完整測試把關。
- 新增時三個地方一起改：`package.json` 的 `test:content`、這張表、檔案本身（不用改工作流程）。測試會檢查清單裡的每個檔都出現在本節。

### 28.5 一個 PR 只建一次站、Chromium 快取

- **一次建站**：`scripts/a11y.mjs` 本來就讀 `BASE_PATH`，靜態伺服器把網址的前綴去掉再對到 `DIST_DIR`。所以 a11y 不必另建 `BASE_PATH=''` 的站，直接掃預覽 dist（`BASE_PATH=/<repo>/preview/pr-N`、`PREVIEW_SCHEDULED=1`）。差別只有預覽多了排程中的內容（多掃到的頁只會更嚴，不會漏），以及網址多一段前綴（掃的是和審核人、民眾實際看到相同路徑的版本）。本機以預覽參數建置後跑 `npm run a11y` 的結果見 28.7。
- **掃描本身的防呆**（`scripts/a11y.mjs`）：子路徑一旦設錯，伺服器會回 404 頁或缺 CSS 的頁面，axe 掃了也「通過」。所以主文件不是 2xx 時整個檢測失敗；同站資源（CSS、JS、索引、答案資料）回 404 列為阻擋，報告另有一張「同站資源 404」表。
- **Chromium 快取**：`actions/cache` v6.1.0（`55cc8345863c7cc4c66a329aec7e433d2d1c52a9`，以 `git ls-remote https://github.com/actions/cache refs/tags/v6.1.0` 核對；與其他 action 一樣固定 SHA、註解版本，SHA 已加進 `tests/lanes.test.mjs` 與 `#56` 測試）。路徑 `~/.cache/ms-playwright`，key 是 `playwright-chromium-<OS>-<package-lock.json 的 playwright-core 版本>`，升級 Playwright 就換 key。
  - **PR 只還原、不寫入**（`actions/cache/restore`）：test job 執行 PR 的程式碼，若它也能存快取，`npm ci` 的 `postinstall` 就有機會往快取目錄放東西。GitHub 的快取範圍本來就讓 PR 存的快取只有同一個 PR 讀得到，但只還原更單純。
  - **由 `pages.yml` 在 `main` 上存**：`npm ci` 之後還原，沒命中才 `npx playwright install chromium` 下載一次，job 成功時存檔。PR 讀得到 base 分支（`main`）的快取；`pages.yml` 每 2 小時排程都會還原一次，快取不會因 7 天沒用而被清掉。
  - 仍然跑 `npx playwright install --with-deps chromium`：有快取時只補系統套件，不再下載瀏覽器；快取沒命中也照常下載，不會失敗。
  - `pages.yml` 的 `npm test` 不受影響：端到端測試找的是 `/opt/pw-browsers` 與 `dist/`，CI 上本來就略過。

### 28.6 程式／文件 PR 的審核人：OASIS

以前 `lanes.json` 一般車道的 `reviewers` 只有 `unit.pr`，程式、文件的 PR 也走一般車道，留言就寫「審核人：公關室（@ancientsky）」。實際上程式、治理規則與文件是 OASIS（AI推動辦公室）在管。

- 一般車道新增 `codeReviewers: ["unit.oasis"]`（`validateLanes` 檢查只能放在一般車道、必須是非空字串陣列）。
- `laneForFiles`：只有程式／文件變更（`lane.mjs` 判定理由「程式／文件變更需審核」）⇒ 審核人只有 `codeReviewers`；同一個 PR 也改了內容 ⇒ 內容審核人（`reviewers`）與 `codeReviewers` 聯集，一級內容照舊再加 `tier1Reviewers`；純內容 PR 不變（一般車道仍是公關室）。`content/governance/`（治理設定）與 `content/master/`（主檔）在路徑上屬內容（CI 分流算純內容），但審核人同樣取 `codeReviewers`（`CODE_REVIEWER_REASONS`），與 CODEOWNERS 的註解一致；`data/snapshots/` 照舊是 `reviewers`。
- 原型的 `reviewerAccounts` 每個單位都對到 `ancientsky`，所以帳號不變，留言上的單位名稱從「公關室」變成「AI推動辦公室」（混合 PR 是「公關室、AI推動辦公室」）。正式環境把 `unit.oasis` 對到 OASIS 的 team 即可。
- 寫入閘道（`scripts/lib/gateway/workflow.mjs`）只處理內容，不受影響。

### 28.7 已知限制與驗證

- **純內容 PR 可能讓 `main` 變紅。** 完整測試裡有些檔斷言特定內容（例如答案引擎的題目、盲測題組的引用）；純內容 PR 改了那些內容，PR 上的子集不會發現，合併後 `pages.yml` 的 `npm test` 失敗、不部署，之後的程式 PR 也會紅，直到有人修。處理：看 `pages.yml` 失敗的測試檔，若它其實是在驗證內容，把它加進 `test:content`（28.4 的規則）。
- **內文造成的無障礙問題在純內容 PR 上不掃。** 例如內文標題跳級；`build --check` 擋得到替代文字，擋不到標題層級。這類問題會在下一個程式 PR 的 axe 被看到。
- **本機驗證（2026-10-15）**：以 CI 的預覽參數建置（`BASE_PATH=/new_cdc_prototype/preview/pr-999`、`PREVIEW_SCHEDULED=1`、`LINK_CHECK=warn`，本機 4 核 63 秒），再以相同 `BASE_PATH`、`DIST_DIR` 跑 `npm run a11y`：27 頁 × 3 種視窗共 81 次，阻擋 0、警告 0（約 226 秒），沒有任何頁被略過。故意把 `BASE_PATH` 設成空字串去掃同一份 dist ⇒ 檢測失敗（答案頁等不到內容逾時），不會假通過。電子報頁探測的 `/api/health` 在靜態主機本來就是 404（頁面退回模擬模式），不列入「同站資源 404」。`npm run test:content` 本機 4 核約 22 秒（21 個檔、248 個測試）。
- **本機沒辦法跑 Actions。** `if:` 運算式、`actions/cache` 的實際命中、`gh api --paginate` 的分頁都只能在第一個 PR 上確認。第一個純內容 PR 與第一個程式 PR 請各看一次 Actions 紀錄與 PR 留言（純內容 PR 應該看到「⏭ 略過（純內容變更）」與內容測試 ✅；程式 PR 的 `Restore Chromium cache` 在 `pages.yml` 跑過一次之後應該顯示 cache hit）。

## 29. 第六十輪（2026-10-25）：發布鏈的三道補強——規則集、車道核對、純內容合併不重跑程式測試

外部審查（grokbot 第四批，Issue #124、#125、#126）指出三件事：`main` 沒有分支保護，有寫入權的帳號直接 push 約 4 分鐘就上線；快車道的判定用的是 PR 自己的 `scripts/lane.mjs`＋`lanes.json`（§2.2 原本就承認的殘留風險）；純內容的合併在 `pages.yml` 又跑了一次 2 分 18 秒的完整程式測試。三件都成立，本節記做法與取捨。

### 29.1 `main` 規則集：只能經 PR 合併、合併前必過 `test`（Issue #124）

規則集（ruleset）是 GitHub 的設定，不在 repo 裡生效；repo 放一份可匯入的正本 `.github/rulesets/main.json`，讓「正式環境要設什麼」可版本控制、可審核。內容：

| 規則 | 設定 | 為什麼 |
| --- | --- | --- |
| 禁止刪除分支、禁止 force push | `deletion`、`non_fast_forward` | 歷史是稽核紀錄，不可改寫 |
| 必須經 PR 合併 | `pull_request`，`required_approving_review_count: 0` | 直接 push 不經車道、不經檢查。核准人數**不用原生的**：快車道與緊急發布是 0 位、一般車道 1 位，由 `lane` job 數核准（§2「分支保護與自動合併互相牴觸」） |
| 必要狀態檢查 | `test` | **不能用 `lane`**：`lane` job 自己呼叫 `gh pr merge` 時還在執行中，要求它成功就會把自己擋住。`test` 在 `lane` 之前完成，而且檢查沒過時它最後一步會失敗（§2.2） |
| 繞過名單 | 匯入檔**留空**；匯入後手動加 **Deploy keys** | 匯入時帶 GitHub Actions app（`Integration` 15368）會被拒「The ruleset you are importing contains an invalid actor」，介面的 Bypass list 也沒有 GitHub Actions 可選（2026-10-25 實測，Yulun）。`pages.yml` 的 02 UTC 排程要把官方資料快照 push 回 `main`，改用**部署金鑰**（見下方「回寫快照的部署金鑰」）。沒設也不會壞：push 被拒只警告，建置與部署照常，只是快照留在舊版 |

匯入：Settings → Rules → Rulesets → New ruleset 旁的「⋯」→ **Import a ruleset** → 選 `.github/rulesets/main.json` → Create（2026-10-25 已匯入）。匯入後先用 `gh api repos/<owner>/<repo>/rulesets` 確認數量不是 0，再開一個純內容 PR 看自動合併是否仍成功。

**回寫快照的部署金鑰（匯入後要做）**：規則集禁止直接 push 後，`pages.yml` 每天 02 UTC 把 `data/snapshots/` 回寫 `main` 的那一步會被拒，網站會一直用舊快照（旅遊疫情、國家等級、CKAN 目錄；登革熱地圖每次建置另抓，不受影響）。GitHub Actions 本身不能列入繞過名單，**部署金鑰可以**：

1. 本機產生一對金鑰：`ssh-keygen -t ed25519 -C snapshot-writer -f snapshot_key`，被問 passphrase 時按兩次 Enter（不要設密碼）。Windows PowerShell 不要寫 `-N ''`（會被傳成空參數，ssh-keygen 報 Too many arguments；2026-10-25 實測），要寫 `-N '""'` 或乾脆不帶。
2. Settings → Deploy keys → Add deploy key：貼 `snapshot_key.pub`，勾 **Allow write access**。
3. Settings → Secrets and variables → Actions → New repository secret：名稱 `SNAPSHOT_DEPLOY_KEY`，內容貼 `snapshot_key`（私鑰全文）。貼完把本機兩個檔刪掉。
4. Settings → Rules → Rulesets → 這個規則集 → **Bypass list** → Add bypass → **Deploy keys**。
5. 驗證：Actions → Build and deploy to GitHub Pages → Run workflow（`refresh` 保持 true），看「Commit refreshed snapshots」那一步印出「快照已以部署金鑰回寫 main」。
   回寫成功後，那個快照 commit 會再觸發一次 push 建置，而手動這一次會被它取消（`concurrency: pages`，後到的取消先到的）：Actions 頁上手動那次顯示「cancelled」是正常的，網站由後一次（標題「data: 官方資料快照更新」）部署。2026-10-25 第一次成功（commit 9735410，run #331 → #332）就是這樣。
   只有手動 Run workflow 或 02 UTC 排程會走到這一步；合併 PR 觸發的建置與 `content-pr.yml` 代發的建置（`refresh=false`）不重抓資料，這一步顯示 skipped、不印任何字，不是沒設好。

**2026-10-25 第一次驗證就紅（run #328）的教訓**：金鑰本身沒問題，倒在前一行 `git pull --rebase`：「cannot pull with rebase: You have unstaged changes」。原因是 `npm run fetch` 除了 `data/snapshots/` 也會改 `content/datasets/`（登革熱地圖摘要與 CKAN 目錄的 `lastUpdated`／`provenance`，第五十七輪加的），而提交那一步只 `git add data/snapshots`，剩下的變更讓 rebase 拒絕執行，整個 build job 紅掉、當次也沒部署。修法：`git add -A data/snapshots content/datasets` 一起提交（本來就是這次抓取的結果）、`git pull --rebase --autostash`（其他未預期變更先暫存）、rebase 失敗只警告不讓建置失敗。為什麼之前沒發現：規則集匯入前這一步也會失敗，但沒人看 02 UTC 排程的紀錄；回寫從來沒成功過（`git log --grep=官方資料快照更新` 是空的）。所以**任何「排程才會跑」的步驟都要在合併當天手動 Run workflow 跑一次**，不要等排程。

為什麼可以接受：這把金鑰只在 `pages.yml` 的 `build` job 用到，PR 的工作流程（`content-pr.yml`）拿不到 secrets 也不引用它（測試 `round60-ruleset` 擋）；私鑰寫到 `$RUNNER_TEMP`、推完就刪；它推的只有 `data/snapshots/` 與 `content/datasets/` 裡由抓取更新的欄位（機器抓的官方資料與資料目錄的更新日期），不是人寫的內容。換成機關 GitLab 時對應的是 project deploy key 或 project access token（§14.4）。

**原型期沒做、留給正式環境的**：

- **要求簽章 commit**：這個原型多數提交來自 Claude 的雲端工作階段，無法簽章（`git log --format=%G?` 的 `N`）；GitHub 網頁合併的提交由 GitHub 簽（`E`，本機沒有金鑰所以驗不了）。正式環境由同事與閘道服務帳號提交時再開，閘道的服務帳號要配 SSH 簽章金鑰。
- **要求 2FA**：GitHub 自 2023 年起對所有有貢獻的帳號強制 2FA，不必另設；機關 GitLab／GHES 對應的是 Entra ID／AD 的 MFA（§14.2）。
- **CODEOWNERS 審核**：`require_code_owner_review` 先關，因為原型的 CODEOWNERS 全是 `@ancientsky`（示範）；換成單位 team 後再開，而且只對一般車道有意義（快車道本來就不等人審）。

### 29.2 車道由 `lane` job 核對，不採信 PR 自己算的（Issue #125）

**問題**：`lane.json` 是 `test` job 用 PR 分支上的 `scripts/lane.mjs`、`scripts/lib/lanes.mjs`、`content/governance/lanes.json` 算的。惡意 PR 改一行規則（例如把 `scripts/` 判成快車道），artifact 就寫著「快車道、自動合併」，`lane` job 照單合併。§2.2 的檔案清單比對只擋「少報檔案」。

**做法**：`lane` job 的「Validate results」在驗完格式之後、寫進 `GITHUB_ENV` 之前，用它自己從 API 取的檔案清單（`real-files.txt`，含改名前路徑）再判一次：

- 不是純內容（§28.1 的定義：任何一個檔不在 `content/`、`data/snapshots/`），**或**改到 `content/governance/`（車道規則、白名單、評估集都在這裡）、`content/master/`（主檔）
- ⇒ `LANE=standard`、`LABEL=lane:standard`、`AUTO=false`、`NEED` 至少 1，並記 `DOWNGRADED=true`；artifact 原本要求更多核准（例如 3 位）就保留，不放寬。

「Decide merge」與 PR 留言只看這些環境變數，不再直接讀 `lane.json` 的 `autoMerge`／`requiredApprovals`／`label`；留言多一列「車道核對（API 檔案清單）」，被覆寫時寫出原因與原本的車道。

**為什麼不是「用 main 的 lane.mjs 重算」**：那要在 `test` job 另外 checkout `origin/main` 再跑一次 Node，或在 `lane` job 執行程式——後者違反 §2.2「有寫入權的 job 不執行 repo 內任何程式」。現在的規則只用 `grep`，判的是「這個 PR 碰得到規則嗎」：純內容 PR 動不到 `lane.mjs`、`lanes.mjs`、`.github/`，所以它的車道可以信；碰得到的一律要人審。這也回答了 §2.2 留下的問題：**改車道規則的 PR 走一般車道，由 OASIS（`codeReviewers`）審**，和 `lanes.mjs` 本來對 `content/governance/` 的判定一致，只是現在由不執行 PR 程式的 job 強制。

測試：`tests/round40-ci-isolation.test.mjs` 的 `#125` 兩題（實跑驗證步驟與留言的 jq）。

### 29.3 純內容合併：`pages.yml` 只跑內容測試就部署，完整測試平行跑（Issue #126）

**數字（2026-10-25 12:13 台北那次部署）**：push 到上線 4 分 2 秒，其中 Tests 2 分 18 秒、Build 45 秒、lint 11 秒。純內容的合併不會改程式，這 2 分半在 PR 階段（程式 PR）早跑過，或與內容無關。

**做法**（`pages.yml`）：

| job | 做什麼 | 什麼時候 |
| --- | --- | --- |
| `scope` | 不 checkout，用 compare API 比對 `github.event.before…sha` 的檔案清單，判定是否純內容（規則同 §28.1，改名兩個路徑都算）。排程、手動執行、新分支（before 全 0）、檔數 0 或達 API 上限 300、API 失敗 ⇒ 一律「程式變更」 | 每次 |
| `build` | 純內容 ⇒ 跳過 lint／格式／型別，測試改跑 `npm run test:content`（本機 4 核 24 秒，與 PR 階段同一套），然後建置、部署。程式變更 ⇒ 照舊全跑 | 每次 |
| `verify` | lint／格式／型別／完整 `npm test`，`contents: read`，不被 `deploy` 依賴 | 只在純內容時，與 `build` 平行 |

**取捨（請維護者知道）**：第五十六輪說純內容 PR 略過的程式測試「合併後 `main` 上全跑，失敗就不部署」（§28.7）。現在改成**先部署、同一次執行裡平行驗證**：`verify` 失敗時工作流程紅、GitHub 通知維護者，但內容已上線。接受的理由：

1. 真正擋壞內容的是 `build` 內的閘門——schema、跨檔參照、治理規則、評估集、連結檢查、全文索引召回——一個都沒少。
2. 完整測試裡會被內容弄紅的，是斷言特定內容的測試（§28.7 第一點）；那是測試該搬進 `test:content` 的訊號，不是內容壞了。
3. 緊急發布的 10 分鐘預算（`lanes.json` 的 `slaMinutes`）原本一半花在重複驗證。

`verify` 紅了怎麼辦：看失敗的測試檔。若它其實在驗內容，把它加進 `test:content`（§28.4）並修內容；若是真的程式問題，那和這次合併無關，開程式 PR 修。

**為什麼用 compare API 而不是 `git diff HEAD^`**：`actions/checkout` 預設 `fetch-depth: 1` 沒有 `HEAD^`；多個 commit 一次 push 時 `HEAD^` 也不是 push 前的 `main`。compare API 直接比 push 前後兩個 SHA，不用 checkout、不執行程式，和 `content-pr.yml` 的 `lane` job 同一個原則。

**量測**：`lane-sla.yml` 只量 PR 開啟到合併；「合併到上線」請在 Actions 看 `pages.yml` 的執行時間（純內容應為 Build 45 秒＋部署，不再有 2 分 18 秒的 Tests）。第一次純內容合併後請把實際數字補進 [ci-cd-overview.md](ci-cd-overview.md) §3。

## 30. 正式部署產物白名單、內部站與指紋標頭（第六十二輪，Issue #141）

**為什麼：** AI 滲透工具（ARTEX 一類）先盤點公開主機上的所有檔案與端點，再挑目標。原型的 `dist/` 什麼都放（後台頁、後台 JS、source map、標頭設定檔、PR 預覽），正式站的公開主機不該有這些。背景、規則表、對外資產清冊程序與「教訓」寫在 [attack-surface.md](attack-surface.md)；這一節只寫操作。

### 30.1 環境變數

| 變數 | 預設 | 作用 |
| --- | --- | --- |
| `SITE_MODE` | `prototype` | `production` ⇒ 不複製 PR 預覽、把只給同事的檔案搬到內部站目錄、用 `public` 規則稽核公開樹，有禁止檔就建置失敗 |
| `DIST_INTERNAL_DIR` | 與 `dist` 同層的 `dist-internal/` | 內部站產物放哪裡（每次建置先清空） |
| `ADMIN_ORIGIN` | 空字串 | 內部站網域（例 `https://staff.<機關網域>`，只寫網域，不帶路徑與結尾斜線；必須 https，本機可 `http://localhost`）。設定後公開頁所有 `/admin/…` 連結（頁尾「同事修改這頁」、後台入口、使用說明裡的後台連結）都改成 `ADMIN_ORIGIN` + basePath + 路徑的絕對網址；格式不對建置失敗 |

### 30.2 指令

```bash
# 正式建置：公開站 → dist/，內部站 → dist-internal/
SITE_MODE=production npm run build

# 稽核任何目錄（CD 管線、或資訊室對實際部署的目錄跑）：有禁止檔 exit 1
npm run audit:dist -- dist --profile public
node scripts/audit-dist.mjs /srv/www/cdc --json > exposure-now.json

# 原型站：後台等列為「預期」，只擋防禦性規則與副檔名白名單
npm run audit:dist -- dist --profile prototype
```

注意 `npm run` 要加 `--` 才會把 `--profile` 傳給指令（不加的話 npm 當成自己的參數吃掉）。`--profile` 預設就是 `public`。

### 30.3 `dist-internal/` 裡有什麼

| 路徑 | 內容 |
| --- | --- |
| `admin/` | 後台頁（從公開樹搬來） |
| `assets/` | 整份 CSS／JS 的副本，含 `assets/js/admin/`、`*.js.map`、`globals.d.ts`；JS 保留 `sourceMappingURL` 註解，方便除錯 |
| `v1/` | 機讀 API 的副本（後台頁會讀） |
| `vendor/` | 後台專用的 marked、pdf.js（從公開樹搬來，公開頁沒有用到） |
| `headers/` | 公開主機的標頭設定檔（§10）；放這裡是為了交接，**不是給內部站當網頁提供** |
| `exposure.json` | 對外資產清冊的機讀部分（拆分前的完整樣貌） |
| `README.md` | 怎麼放、路由、存取控制 |

公開樹的 JS 結尾 `//# sourceMappingURL=` 註解會被拿掉（map 已不在公開站）；`redirects/nginx.map` 是公開的舊網址對照，不受影響。

### 30.4 部署方式

- **公開站：** 部署 `dist/`。套 `dist-internal/headers/` 的標頭設定（§10、§10.5）。
- **內部站：** 部署 `dist-internal/`，和寫入閘道放在同一台同事用的反向代理後面（§14.5），只開內網或 VPN；雲端環境加 Entra ID 條件式存取。不對網際網路開放。
- **兩種接法擇一：**
  1. 設 `ADMIN_ORIGIN`：公開頁的後台連結直接指向內部站網域。連結檢查會把這些連結當外部連結（不檢查目標），這是預期的。
  2. 不設：同事用的反向代理把 `/admin/`、`/api/gateway/`（以及內部站需要的 `/assets/`、`/v1/`、`/vendor/`）轉到內部站，其他路徑轉到公開站。從網際網路直接連公開站的 `/admin/` 會是 404。
- 公開頁上「編輯這頁」浮動按鈕（`ui.js` 的 `staffEditFab`）看的是瀏覽器裡的後台登入狀態；內部站和公開站不同網域時，公開站讀不到那個狀態，按鈕就不會出現。頁尾「同事修改這頁」連結不受影響。

### 30.5 CI／CD

正式環境的部署管線在 `SITE_MODE=production npm run build` 之後加一步：

```bash
npm run audit:dist -- dist --profile public   # 結束碼非 0 ⇒ 不部署
```

建置本身已經檢查過一次；這一步是對「真的要上傳的那一包」再確認（有人在建置後補檔、或同步工具多帶東西時會擋下來）。

GitHub Pages 原型站照舊用原型模式建置（後台與 source map 是示範站刻意公開的），`dist/headers/exposure.json` 每次都會更新，資訊室可以直接看原型站有哪些資產。

### 30.6 測試

`tests/round62-attack-surface.test.mjs`：假 dist 的稽核（禁止檔帶規則與理由、原型規則把後台列為預期、防禦性規則先於預覽規則、副檔名白名單）、`splitForProduction`（公開樹乾淨、內部站齊全、`sourceMappingURL` 處理）、CLI 結束碼、`ADMIN_ORIGIN` 的連結、四種格式的指紋標頭。


## 31. 閘道與模擬後端的速率限制（第六十二輪，Issue #140）

**為什麼：** ARTEX 這類 AI 自動化滲透工具會 24 小時、平行地列舉端點並串連弱點，成本很低。第一個 `429` 要盡量早、盡量便宜地出現。正式環境的第一層是 WAF／CDN（[abuse-protection.md](abuse-protection.md) §4，資訊室的要求）；這裡是應用程式自己的最後一道，也是收件系統的參考行為。四個後端共用 `scripts/lib/rate-limit.mjs`（滑動記錄、記憶體有上限、**不會整個清空**——舊版三份各自的實作在 key 太多時整個清空，等於灌假 IP 就能重設所有人的計數）。

### 31.1 設定與預設值

| 後端 | 範圍（key） | 預設 | 設定 | 被擋時 |
| --- | --- | --- | --- | --- |
| 寫入閘道 `/api/gateway/*` | `ip`：每來源 IP，所有端點（含 `GET /health`） | 120 次／60 秒 | `GATEWAY_RATE_LIMIT` | `429 {error:'rate_limited', message:'操作太頻繁，請稍後再試'}` |
| 〃 | `auth`：每來源 IP，`/login`、`/login/callback`、`/logout` 與**認證失敗** | 10 次／60 秒 | 〃 | 〃 |
| 〃 | `write`：每帳號，所有 POST 寫入（在 CSRF 檢查與讀本體之前） | 60 次／60 秒 | 〃 | 〃 |
| 電子報模擬 `/api/subscriptions*` | 每來源 IP（health、退訂除外） | 5 次／60 秒 | `createSubscriptionApi({ httpRate })` | `429 {error:'rate', retryAfter, message}` |
| 問答紀錄信標 `POST /api/ask-log` | 每來源 IP | 30 次／60 秒（原 60） | `createAskLogApi({ rate })` | `429 {error:'rate', message}` |
| 國際疫情推送 `POST /api/intl-epidemic` | 每來源 IP，**在權杖檢查之前** | 30 次／60 秒（原 10） | `createIntlFeedApi({ rate })` | `429 {error:'rate', message}` |

全部附 `Retry-After`（秒，最舊那筆離開視窗的真實時間）與 `Cache-Control: no-store`，訊息不說門檻。被擋的請求**不讀本體**（只放掉），所以不花解析 24 MB 本體的成本。國際疫情推送原本 10 次是為了擋猜權杖；改到權杖檢查之前、並與其他端點同一套後，每分鐘最多試 30 次仍猜不到 32 位元組的隨機權杖，疫情中心系統偶爾補送也不會撞牆。

**`GATEWAY_RATE_LIMIT` 的寫法：**

- 不設或空白：上表預設。
- `off`：關閉（只給本機除錯；**正式環境不要關**）。
- 逐項覆寫：`GATEWAY_RATE_LIMIT=ip:240/60,auth:20/60,write:60/60`（`範圍:次數/秒數`，逗號分隔，沒寫的範圍用預設）。格式不對閘道**不啟動**，錯誤訊息會說哪一段不對——寧可起不來，也不要默默用錯的數字。

開發伺服器 `scripts/serve.mjs` 的三個模擬後端：`MOCK_RATE_LIMIT=off` 關閉（端到端測試由 `tests/helpers.mjs` 的 `distEnv()` 一併設 `GATEWAY_RATE_LIMIT=off` 與 `MOCK_RATE_LIMIT=off`：Playwright 一分鐘內點的次數遠超過真人）；試跑時放在反向代理後面，代理位址與閘道共用 `GATEWAY_TRUSTED_PROXIES`。

### 31.2 來源 IP：一定要設 `GATEWAY_TRUSTED_PROXIES`

限流的 key 必須是攻擊者選不了的東西。`X-Forwarded-For` 是請求自己帶的標頭，誰都能寫；所以只有 TCP 連線的對端在 `GATEWAY_TRUSTED_PROXIES`（逗號分隔，可用 CIDR，與 header 登入模式同一個設定）裡時，閘道才看 `X-Forwarded-For`，而且從右往左跳過信任的代理，取第一個不是代理的位址。

**部署陷阱：** 閘道放在反向代理（IIS ARR、nginx、Application Gateway）後面卻沒設 `GATEWAY_TRUSTED_PROXIES` ⇒ 所有人都是代理的那一個 IP，**全機關共用 120 次／分鐘**，上班尖峰就會互相擋。症狀：同事陸續看到「操作太頻繁」，稽核裡 `rate_limited` 的 `ip` 都是代理位址。修法：把代理的位址加進 `GATEWAY_TRUSTED_PROXIES`，並確認代理有**覆寫**（不是附加使用者送來的）或附加 `X-Forwarded-For`。

### 31.3 稽核事件

被擋時寫一筆 `rate_limited`（`result: 'denied'`，欄位 `ip`、`path`（最多 120 字）、`scope`：`ip`／`auth`／`write`；`write` 另有 `actor`）。**只在「開始被擋」那一次寫**（同一個 key 連續被拒只記第一筆，下次被放行後才會再記），不記本體、不記標頭——否則被灌的時候每個 429 都寫一筆，攻擊者就能拿稽核檔塞爆磁碟。同一個 IP 在一小時內反覆出現 `rate_limited`、或 `scope: auth` 出現，就是 [abuse-protection.md](abuse-protection.md) §5 告警規則 3 的訊號。

### 31.4 怎麼調

1. 先看稽核：`grep '"action":"rate_limited"' .local/gateway-audit.jsonl`（正式環境為 `GATEWAY_AUDIT_FILE`）。是同事被擋（`ip` 是機關內網、`scope: write`）還是外部來源？
2. 同事被擋 ⇒ 先確認 31.2 的代理設定；確定是正常大量作業（例如一次核准很多則）才把 `write` 調高，例：`write:120/60`。
3. 外部來源被擋 ⇒ 不要調高，改在 WAF 封鎖該來源（[abuse-protection.md](abuse-protection.md) §4）。
4. 健康檢查探針太密（每秒一次 ⇒ 60 次／分鐘）會吃掉 `ip` 額度：把探針間隔調到 10 秒以上，或探針走內網另一個來源 IP。

測試：`tests/round62-rate-limit.test.mjs`（限流數學、`clientKey` 的代理信任、閘道三個範圍與稽核、三個模擬後端的 429）。

## 32. 動態弱點掃描工作流程（第六十二輪，Issue #142）

背景與範圍見 [security-testing.md](security-testing.md)。這一節只寫操作。

**觸發**：`.github/workflows/dast.yml` 每週一 03:00（台灣時間，cron `0 19 * * 0`）自動跑；手動：Actions → DAST (OWASP ZAP baseline, weekly) → Run workflow，可調 `spider_minutes`（預設 5）。不擋合併、不擋部署，ZAP 步驟設 `continue-on-error: true`，且用 `-I` 讓警告不算失敗。

**產出**：job summary 直接貼 `report.md`；artifact `dast-report` 含 `report.html`、`report.json`、`report.md`，保留 30 天。

**怎麼讀**：PASS／WARN／FAIL 的意思與預期的 WARN（GitHub Pages 不能設 CSP／HSTS，標頭在 `dist/headers/` 供正式主機使用，見 §10.3）寫在 security-testing.md 第 4 節。掃描對象是靜態站加模擬後端，模擬後端的發現要對照 §11、§13 的接收系統契約再判斷。

**限制**：開發沙盒沒有 docker，第六十二輪沒有在本機實際執行 ZAP；第一次真正的執行是在 GitHub 上的排程或手動執行。

**釘映像檔 digest**：原型用 `ghcr.io/zaproxy/zaproxy:stable`（浮動標籤）。正式 CI 請改成 `ghcr.io/zaproxy/zaproxy@sha256:<digest>`，並定期更新，理由與釘 action SHA 相同（供應鏈）。

**搬到署內 CI（GitLab）**：用同樣的步驟——建置（`BASE_PATH=''`）、起 `scripts/serve.mjs`、跑 ZAP 容器、把三個報告檔存成 job artifact。runner 需要能執行容器；掃描目標限定為該 job 自己啟動的本機服務，不要指向正式或共用環境。