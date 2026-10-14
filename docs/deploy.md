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
| `.github/workflows/preview-cleanup.yml` | PR 關閉、每日 01:41 UTC、手動 | 刪除 `previews` 分支的 `pr-{N}/`；**沒有合併就關閉**的 PR 才重新部署（合併的 push 已經部署一次，見 2.1）。自動合併的 PR 不會觸發 `closed`，分支上的目錄由每日排程補清 |
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
| `test` | `contents: read` | checkout（`persist-credentials: false`）、`npm ci`、個資掃描、lint、`format:check`、`typecheck`、`npm test`、`build --check`、a11y、`scripts/lane.mjs`、預覽建置；最後把各步驟 outcome、`lane.json`、a11y 摘要（`lane-result` artifact）和預覽 dist（`preview-dist` artifact）上傳 | 沒有任何寫入；job 層級環境變數沒有權杖，只有「查作者 team」那一步（只跑 `gh`）帶 `GITHUB_TOKEN` |
| `lane` | `contents`／`pull-requests`／`issues`／`actions: write` | `actions/download-artifact` 下載、驗證、`gh` 留言與標籤、`git` 推 `previews` 分支、`gh pr merge`、`gh workflow run pages.yml` | **不 checkout、不 setup-node、不 `npm`、不 `node`、不執行 repo 內任何腳本** |

兩個 job 之間的規矩：

- **artifact 一律當不可信資料**。`lane` job 的「Validate results」先檢查：結果檔存在且是合法 JSON；每個步驟 outcome 只接受 `success|failure|skipped|cancelled`，其他值（含夾帶換行）一律變 `invalid`（`invalid` 不等於 `success`，所以擋合併）；車道、標籤、`autoMerge`、`requiredApprovals` 要符合固定格式；`lane.json` 的檔案清單必須涵蓋 `gh pr diff --name-only` 查到的每個檔（不能少報程式變更來走快車道）。通過的值才寫進 `GITHUB_ENV`，所以 artifact 不可能夾帶額外的環境變數。驗證不過 ⇒ 留言「無法判定」、不合併、job 失敗。
- **PR 留言改用 `jq` 產生**（以前是 `node --input-type=module -e`）：`jq` 程式寫在 workflow 裡，不來自 artifact，也不是 repo 的檔案。Node 只能執行 repo 內容，而 `lane` job 沒有 checkout，要用就得 checkout，等於把 PR（或 main）的程式放進有寫入權的 job；`jq`／`bash` 是 runner 內建，沒有這個問題。若將來真的需要 Node（例如更複雜的留言），只能 checkout **main**（`ref: main`）而不是 PR，並且在這裡說明理由；測試 `tests/round40-ci-isolation.test.mjs` 目前會擋掉 `lane` job 裡任何 `node`／`npm`／`checkout`，要放寬得同時改測試。
- 預覽 dist 是 PR 建置出來的檔案，`lane` job 只複製進 `previews` 分支、不執行。這與拆分前相同：預覽內容本來就公開在 GitHub Pages，審核人看的就是 PR 作者能控制的輸出。
- `test` job 失敗（檢查沒過）時，`lane` job 仍然執行（`if: ${{ !cancelled() }}`），這樣 PR 留言和 `lane:*` 標籤照常更新；`test` 與 `lane` 最後都有「Fail when checks failed」步驟，所以 Actions 上兩個 job 都紅，`main` 的必要狀態檢查名稱仍是 `lane`（沒改名）。
- 殘留風險：`lane.json` 是 `test` job 用 PR 的 `scripts/lane.mjs` 與 `lanes.json` 算的，惡意 PR 可以在 `test` job 裡偽造「快車道、自動合併」。上面的檔案清單比對只擋「少報檔案」，擋不了「改規則本身」。真正的防線是分支保護（必要狀態檢查＋`CODEOWNERS` 審核）與 `allowedAuthors`；下一步可行的強化是讓 `test` job 另外取 `origin/main` 的 `scripts/lane.mjs`＋`lanes.json` 對 PR 的檔案清單重算一次，兩者不一致就降為一般車道（需要人審）。目前沒做，因為會讓「改車道規則的 PR」永遠被降級，需要先決定這種 PR 要走哪條路。

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
- **升 action 的 PR 會紅燈是預期的**：`tests/lanes.test.mjs` 寫死 `checkout`、`setup-node`、`deploy-pages`、`upload-artifact`、`download-artifact` 的 SHA（確保沒人偷偷換回可移動的 tag），`tests/round40-ci-isolation.test.mjs` 另外寫死 lane job 唯一允許的 `download-artifact` SHA（沒有版本註解，grep 版本號找不到它，要用 SHA 搜）。升版時先 `grep -rn 舊SHA tests/ docs/` 找出所有釘死處，再換成 PR 裡的新值；SHA 格式另由 `tests/round23-security.test.mjs` 檢查。
- **升 major 版要看什麼**：讀 release notes 的 breaking changes，跑 `npm test`、`node scripts/build.mjs --check`，再把升版前後的 `dist/` 逐檔比對（`diff -rq`），只剩時間戳差異才算安全。2026-10-10 升 `marked` 15→18 的差異只有 `&`→`&amp;` 與空白行。
- **2026-10-12 `upload-artifact` v4.6.2→v7.0.2、`download-artifact` v4.3.0→v8.0.2（PR #86）**：紅燈正是上面那條釘死清單，PR 的 lint／格式／型別／治理閘門／無障礙／預覽建置全綠，只有 `npm test` 的 `content-pr.yml` 測試不過。release notes 裡會影響我們的只有三點，都不用改 workflow：(1) 兩個 action 改用 Node 24 執行，GitHub 代管 runner 已支援，自架 runner 要 2.327.1 以上；(2) `download-artifact` v8 起 SHA256 比對不符預設直接失敗（之前只警告），對 lane job 反而更安全，因為它下載的 `lane.json` 就是合併決策的依據；(3) v7／v8 新增「不壓縮直接上傳單檔」選項（`archive: false`），我們沒用，維持預設打包。驗證方式：`git ls-remote https://github.com/actions/upload-artifact refs/tags/v7.0.2` 確認 SHA 與 PR 一致，再把 `tests/lanes.test.mjs` 的兩行換新。
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

**電子報**：沿用第 11 節的 `/api/subscriptions*` 契約，`endpoint` 是這些路徑的前綴（例：`https://mail.cdc.gov.tw/newsletter` ⇒ `https://mail.cdc.gov.tw/newsletter/api/subscriptions`），另需 CORS。

### 13.3 CSP

建置時自動把**生效中的 post 端點來源**加進 `connect-src`（fetch 送出）與 `form-action`（一般表單 POST），其他指令不動；`link` 模式只是超連結，不開 CSP。`dist/headers/README.md` 會列出目前加了哪些來源。收件系統換網域只要改設定重建、重新套 `dist/headers/`。

### 13.4 收件系統的要求

| 項目 | 要求 | 為什麼 |
| --- | --- | --- |
| 存取控管 | 以 AD 群組控管：例如「人事室報名承辦」只看報名、「秘書室信箱承辦」只看信箱、「公關室電子報」只看訂閱；系統管理者與資料讀者分開；每次查看與匯出留紀錄 | 個資只給需要的人看，出事查得到是誰 |
| 保存期限 | 報名資料依人事資料保存規定（甄選結束後多久刪除）；信箱來信依檔案法與陳情處理規定；訂閱者退訂後多久刪除。到期自動刪除並留紀錄，備份一併處理 | 頁面上的「保存期限」要寫得出具體數字 |
| 防濫用 | CAPTCHA 或等效機制（建議用無障礙、免圖形辨識的方案，例如隱形挑戰或工作量證明）；以 IP 與 email 做速率限制（例：同一來源每分鐘 5 次）；附件限制類型與大小並做病毒掃描 | 公開表單一定會被灌；附件是最常見的惡意程式入口 |
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
10. **推送 webhook 的來源 IP：** 中心系統呼叫 `POST /api/intl-epidemic` 時從哪個 IP 或網段出來？能否在反向代理或防火牆只允許這些來源（端點本身另有 Bearer 權杖、每 IP 每分鐘 10 次的限流、2 MB 上限）？這支端點要不要和後台放在同一個對外網址？

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
- 收件端必須：欄位白名單、伺服器端再遮蔽個資、不記 IP／User-Agent／Referer／cookie、每分鐘 60 筆節流、成功回 204、原始紀錄 90 天到期刪除。參考實作：`scripts/lib/ask-log-mock.mjs`。
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
- **職缺、採購、接種時程的編輯頁** 目前不經閘道，只產生上架包，不受這一輪影響。

### 23.6 沒帶版本碼：照舊接受，稽核記下

決定：**接受**，稽核紀錄記 `baseHash: "missing"`；沒帶版本碼時送審，仍會擋下 main 已變的情況（§23.4）。

為什麼不拒絕：

- 沒帶的剩兩種：已開著的舊版頁面、外部腳本（疫情報導編輯頁在第五十二輪合併後一律帶碼）。拒絕會讓這些頁面在上線當天不能存，而接受只是維持現在的行為，不會比以前更糟。
- GitHub Pages 示範站沒有閘道，什麼都不會送。上架包（ZIP）流程不經閘道，由資訊室開 PR；PR 的差異是跟當時的 main 比，別人的修改被改回去會出現在差異裡，要靠 PR 審查看出來。

疫情報導編輯頁已加上 `getBaseHash` 與 `reloadLatest`（§23.5）。職缺、採購、接種時程的編輯頁日後接上閘道時也要一樣加。都加完、舊版頁面也不再使用之後，閘道可以改成拒絕沒帶版本碼的寫入（需決策）。

### 23.7 已知限制與待決策

1. **「誰改的」只認得經過閘道上線的。** 資訊室直接改檔、譯者 PR、國際疫情匯入，訊息只會說「網站上的版本已經更新」，不會有名字。正式環境可以改從 GitLab 的提交紀錄找。
2. **衝突以整個欄位為單位。** 兩人改了同一欄的不同部分（例如 `languages` 的不同語言、疾病頁不同區塊）也算衝突，要承辦人手動再改一次。這是保守的取捨，寧可多問一次。
3. **一筆內容同時只有一件送審件。** 兩位同事要改同一頁，只能在同一件裡接力：存檔時以最後一版為底，兩人都列在承辦，審核人看到的是合併後的一件。不能各自開一件、各自審。
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
4. **匯出一定會把 `reviewedAt` 改成今天**，即使什麼都沒改（與 §22 相同）。職缺、採購走快車道，這個日期等於「承辦單位最後確認公告的日子」。
5. **表單會略過的列。** 例如附件行少了網址、沒有說明也沒有檔案的圖表列。現行版若有這種項目，而同事又改了那一欄，那一欄就以表單為準（這種項目會不見）。目前的內容沒有這種情形。
6. **同時修改。** 疫情報導編輯頁寫入閘道時有版本檢查（§23.5）。職缺、採購、接種時程仍是「匯出整份檔案、開 PR」，與 §22.6 第 1 點相同，載入之後 main 又變了的情況，要靠 PR 審查。草稿記下 base／orig 只保護「重新開草稿」這一種情況。
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
