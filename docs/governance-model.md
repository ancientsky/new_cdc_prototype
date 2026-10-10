# 資料治理模型

> 給誰看：資料治理委員會成員、OASIS、各組 Steward、資訊室。
> 實作位置：欄位定義在 `schemas/`，規則在 `scripts/lib/governance.mjs`，測試在 `tests/`。
> 核心原則：**人只填一次欄位，其餘狀態都是建置時由欄位推導出來的**；模板與前端不得自己重算治理邏輯。

## 1. 欄位定義

### 1.1 每筆內容共同欄位

| 欄位 | 誰填 | 說明 |
| --- | --- | --- |
| `id` | 承辦 | 穩定、可讀、全站唯一，例：`disease.dengue`、`doc.mmr-recommendation.2025-04-16`。對外引用以它為準，取代現行官網的加密 ID |
| `type` | 承辦 | `disease` `faq` `news` `letter` `clarification` `document` `vaccine` `dataset` `banner` `page`，以及第二輪起的 `media` `topic` `service` `publication` `labtest` `research`，第七輪的 `job` `tender` |
| `owner` | 承辦 | 權責單位 id，必須存在於 `content/master/units.json`；對內容正確性負責 |
| `publishedAt` / `reviewedAt` | 承辦 | 首次發布日／最後審閱日。**審閱日不是編輯日**，代表權責單位重新確認過內容仍正確 |
| `reviewPeriodMonths` | 承辦 | 審閱週期（月）。預設見 `master/review-periods.json`；0 代表事件觸發 |
| `status` | 承辦 | `draft` `review` `published` `archived` |
| `manualStatus` | 承辦（僅 `job`、`tender`） | 人工覆蓋階段：`job` 為 `cancelled`、`filled`；`tender` 為 `cancelled`、`failed`（流標）。**平常不填**；其餘階段一律由日期與 `result`／`award` 推導。與 `status`（發布狀態）無關 |
| `audience` | 承辦 | `public` `professional` 可複選 |
| `sensitivity` | 承辦 | `public` `professional` `internal`；只有 `public` 可進一般白名單 |
| `license` | 承辦 | 預設 `OGDL-1.0`；例外要寫 `licenseNote` |
| `languages` | 承辦 | 每語言狀態：`source` `reviewed` `machine` `pending` `none` |
| `sourceLang` | 承辦 | 選填，來源語言（七語之一，預設 `zh-TW`）。頂層欄位即為此語言文字，其他語言放 `i18n`；來源語言不是中文時，中文必須有譯文，見規則 18 |
| `basedOn` | 承辦 | 依據的正本 id，衍生內容必填 |
| `aiWhitelist.requested` | 承辦 | 申請進 AI 白名單；**是否生效由引擎算** |
| `summary` | 承辦 | ≤ 120 字，兼作 meta description |
| `assets[]` | 承辦 | 第八輪起，所有型別可用。內容所帶檔案（附件、內文圖片、資料檔）的宣告：`file`、`kind`、`label`、`alt`、`mime`、`bytes`、`sha256`、`machineReadable`、`accessibleAlt`、`license`、`source`…；檔案放 `content/assets/{id}/`，公開於 `/files/{id}/`。`mime`／`bytes`／`sha256`（及圖片寬高）可由 `npm run build -- --fix-assets` 補寫。規則 22–24，政策見 [assets-policy.md](assets-policy.md) |
| `publishAt` | 承辦（選填） | 第九輪起，所有型別可用。排程發布時間（`date-time` 須帶時區，例 `2026-10-05T09:00:00+08:00`，或只填日期＝當日 00:00 臺灣時間）。**未到點不渲染、不進索引／sitemap／API／RSS／`llms.txt`**，以建置當下的真實時間判斷（不受 `BUILD_TODAY` 影響）。規則 26 |
| `urgent` | 承辦（選填） | 第九輪起，**只有 `news`、`letter`、`clarification` 可用**（其他型別 schema 驗證失敗）。`true` ⇒ 走緊急發布車道。規則 25 |
| `postPublishReview` | 複核者（選填） | 第九輪起。`{ status: 'pending'｜'done', reviewedBy?, reviewedAt?, note? }`。快車道與緊急發布的內容上線後，`status` 不是 `done` ⇒ 待辦 `post-publish-review`。規則 26 |
| `conversion` | **匯入工具**（選填） | 第九輪起。由 `scripts/import-legacy.mjs` 自動轉換出的草稿帶：`{ mode: 'auto', confidence（0–1）, issues[], sourceUrl, convertedAt }`。人工確認後可移除或保留供稽核。規則 27 |
| `nextReviewAt` | **系統** | `reviewedAt` ＋ 週期；不要手填 |
| `sourceHash` | **系統** | 中文正本內容雜湊，用於判斷譯文是否過期 |
| `isCurrent`、`supersededBy` | **系統** | 文件版本鏈，依 `effectiveAt` 計算 |

`assets[]` 的細部欄位：`file`（檔名，必填、唯一）、`kind`（`attachment` 附件／`image` 內文圖片／`data` 資料檔）、`label`（附件、資料檔必填）、`alt`（圖片必填，≤ 150 字）、`mime`、`bytes`、`sha256`（建置核對）、`machineReadable`（PDF 是否有文字層）、`accessibleAlt`（可及性替代版檔名）、`version`、`effectiveAt`、`source`、`license`（圖片必填）。既有的 `attachments[]`、`pdfUrl`、`materials[]` 保留；網址以 `/files/{id}/` 開頭者必須在 `assets` 宣告。

文件另有 `family`（版本家族）、`version`、`effectiveAt`、`supersedes`、`changes`、`machineReadableMarkdown`、`roles`；資料集另有 `canonicalUrl`（正本位置，唯一）、`updateFrequency`、`lastUpdated`。

### 1.2 引擎輸出（`item.gov`）

`nextReviewAt`、`daysToReview`、`overdue`、`superseded`、`stale[]`（依據正本已修訂的清單）、`annotations[]`（頁首警示）、`whitelist{requested, effective, reasons[]}`、`translationStale{}`、`reverseAuditHits[]`。全站層為 `site.gov`：KPI、待辦、白名單數、AI 暫停狀態。第八輪起每筆內容另有 `gov.assets`（該筆的附件、圖片、資料檔計數與位元組、缺可及性版本的檔、授權問題），全站層為 `site.gov.assets`（內容數、檔案數、總位元組、依 kind 分計、孤兒檔、缺可及性版本數、圖片授權待確認數；規則 22–24）。`job` 另有 `gov.jobStage`，`tender` 另有 `gov.tenderStage`（見規則 19、21）。第九輪起每筆內容另有 `gov.lane`／`gov.laneLabel`（`emergency`／`fast`／`standard`，規則 25）、`gov.scheduled`／`gov.publishScheduled`（`publishAt` 未到，規則 26）、`gov.postPublishReview`（快車道與緊急發布的上線後複核狀態與期限，規則 26）。

### 1.3 第二輪新增型別的專屬欄位

六種新型別都沿用 1.1 的共同欄位（權責、審閱、授權、`basedOn`…），再各加專屬欄位（完整定義見 `schemas/`）。

| 型別（路徑） | 必填專屬欄位 | 其他重要欄位 | 治理重點 |
| --- | --- | --- | --- |
| `media` 影音（`/media/{id}/`） | `mediaType`、`producedAt`、`transcriptMarkdown`；共同欄位的 `basedOn` 實務上必填 | `youtubeId`（可 null）、`basedOnVersionLabel`、`chapters[{t,label}]`、`captions[]`、`series`、`targetGroups` | 製作日早於依據正本現行版生效日 ⇒ 過時；逐字稿 ≥ 50 字；逐字稿進索引與反向稽核 |
| `topic` 專區（`/topics/{slug}/`） | `slug`、`links[{label,href}]` | `kind`、`introMarkdown`、`startAt`、`endAt`、`contentIds[]`；連結的 `external`、`status`、`lastCheckedAt` | `endAt` 過後自動退出首頁；外部連結每日檢查 |
| `service` 申請服務（`/apply/{slug}/`） | `slug`、`serviceType`、`whoCanApply[]`、`steps[{title,text,who,days}]` | `requiredDocuments[]`、`slaDays`、`fee`、`legalBasis[]`、`forms[]`、`applyUrl`、`contact`、`faq[]` | 步驟、應備文件、處理天數進問答索引；JSON-LD `GovernmentService` |
| `publication` 出版品（`/publications/{id}/`） | `series`、`pubType` | `volume`、`issue`、`edition`、`isbn`、`issn`、`gpn`、`articles[]`、`pdfUrl` | `reviewPeriodMonths: 0`（紀錄，不逾期）；RSS `feeds/publications.xml` |
| `labtest` 檢驗項目（`/lab/{id}/`） | `disease`、`specimens[{name,container,volume,storage,transport}]`、`labs[]` | `sendWithinHours`、`formDoc`、`caseDefinitionDoc`、`biosafetyLevel` | `sendWithinHours` 與主檔 `notifyWithinHours` 一致性；專業版索引以結構化句入索引 |
| `research` 研究計畫（`/research/{id}/`） | `year`、`projectStatus` | `fundingType`、`piUnit`（機構名，不放個人）、`reportDoc`、`datasets[]`、`irb`、`budgetNtd` | 專業版；`projectStatus` 流轉 planned → ongoing → completed → published |

`news` 型別的公告欄位：`deadlineAt`、`refNo`、`applyUrl`；`newsType` 有 `other`（其他訊息）。**第二輪曾以 `news` 的 `recruit`、`procurement` 承載人才招募與採購公告，第七輪已分家**，改為下列兩個獨立型別，`newsType` 不再有這兩個值（舊 `/news/{slug}/` 網址 301 到新路徑）。

### 1.4 第七輪新增型別：人才招募與採購公告

| 型別（路徑） | 權責單位（固定） | 必填專屬欄位 | 其他重要欄位 | 治理重點 |
| --- | --- | --- | --- | --- |
| `job` 招募職缺（`/careers/{slug}/`） | `unit.personnel` 人事室 | `slug`（= id 去掉 `job.{日期}-`）、`title`、`hiringUnit`（用人單位）、`jobType`、`positions`、`workplace`、`salaryNote`、`qualifications[]`、`duties[]`、`requiredDocuments[]`、`applyStart`、`deadlineAt`、`applyMethod`、`contact` | `refNo`、`legacyIds`（舊 news id，產生 301）、`applyUrl`（外部報名系統；省略＝本站模擬報名）、`examPlan[{stage,date,note}]`、`resultPlannedAt`、`attachments[]`、`legacyUrls[]`、`manualStatus`、`manualStatusNote`、`result{publishedAt,refNo,admitted[],waitlist[],note}`、`waitlistUpdates[]` | 階段由日期與 `result` 推導；`result` 與 `waitlistUpdates` 的個資遮罩是建置閘門；AI 白名單排除名單 |
| `tender` 採購公告（`/procurement/{slug}/`） | `unit.secretariat` 秘書室 | `slug`、`title`、`requestingUnit`、`tenderNo`、`method`、`category`、`budgetNtd`、`announcedAt`、`deadlineAt`、`contact` | `openingAt`、`pccUrl`（政府電子採購網）、`awardRule`、`briefingAt`、`scope[]`、`specialTerms[]`、`contractPeriod`、`attachments[]`、`legacyIds`、`manualStatus`、`manualStatusNote`、`award{date,winner,amountNtd,note}` | 階段由日期與 `award` 推導；決標逾期待辦；正式公告以政府電子採購網為準 |

兩者都是事件型內容，`reviewPeriodMonths` 預設 0。人事室的單位 id 為 `unit.personnel`（Data Steward：人才招募、甄選結果）。個資處理原則見 [careers-privacy.md](careers-privacy.md)。

## 2. 規則（寫死在引擎，不靠人記）

1. **逾期**：今天 > `nextReviewAt` → 頁首黃色警示、退出白名單、開待辦。
2. **版本取代**：文件新版 `published` 且 `effectiveAt` 較新 → 舊版紅色警示、`noindex`、退出索引、`.md` 首行警示、`documents.json` 標 `isCurrent:false`、`redirects.json` 增 301。
3. **基於正本修訂**：`basedOn` 的正本 family 出現較新的生效版本，且本內容的審閱日早於新版生效日 → 頁首橘色加註、退出白名單、給 owner 7 日待辦。`reviewedAt` ≥ 新版生效日才解除。
4. **反向稽核**：`auditRules`（宣告在主檔或文件）以規則表達式掃全站文字（含各語言譯文）。例：MMR 主題不得再出現「1981 年（含）以後出生」。命中 → 待辦。失效版本本身不稽核。
5. **翻譯**：譯文 `sourceHash` ≠ 中文 `sourceHash` → 該語言標「中文已更新，譯文待複核」並開待辦。一級內容（疾病、疫苗、澄清、態勢）`machine` 不渲染該語言頁。
6. **資料集**：`lastUpdated` ＋ 更新頻率逾期 → 待辦；授權不在許可清單 → 待辦。
7. **AI 暫停**：`ai-status.paused === true` → 全站深色橫幅、答案頁退回傳統列表。
8. **發布閘門**：schema 或參照檢查失敗、評估集版本題未全對 → 建置失敗，不能發布。

第二輪新增規則（同樣由引擎在建置時計算）：

9. **公告截止**：`deadlineAt` < 今日 → `gov.closed`、生命週期「已截止」、退出首頁與進行中列表（保留在「已截止」頁籤）；**不退出白名單、不產生待辦**。7 日內截止 → `gov.closingSoon`。已截止超過 90 天仍上架 → 計入 KPI。
10. **影音過時**：`producedAt` 早於 `basedOn` 現行版 `effectiveAt` → 沿用規則 3（頁首加註「本影片依 {版本} 製作，建議已於 {日期} 修訂」、退出白名單），`gov.mediaOutdated`，待辦 `media-outdated`（高優先：更新說明欄、加資訊卡或下架）。
11. **影音逐字稿**：逐字稿少於 50 字 → 待辦 `media-no-transcript`（中優先）。逐字稿參與反向稽核與索引。
12. **專區到期**：`endAt` 過後 → `gov.ended`、標「已結束」，首頁專區列退場，不退白名單。
13. **外部連結健康**：專區連結、申請網址與表單、公告報名網址、影片網址、出版品 PDF 彙整為 `site.gov.externalLinks[]`；`fetch-data --check-links` 寫回 `status`／`lastCheckedAt`。`broken` → 待辦 `link-broken`；`unchecked` 不產生待辦。
14. **檢驗一致性**：`labtest.sendWithinHours` > 主檔 `notifyWithinHours` → 待辦 `labtest-inconsistent`（低優先）。
15. **通報時限表**：`/report/` 的法定傳染病通報時限表由 `master/diseases.json` 自動產生，主檔改了表就改，零維護。
16. **旅遊疫情建議（官方事件流）**：`CountryEpidLevel/ExportJSON` 每列是一則警示事件（含「解除」）。fetch 以每國×疾病×區域最新一則判定現行、解除即不列；同一疾病同一等級涵蓋 ≥ 50% 國家（且 ≥ 20 國）⇒ `Background: true`，表與地圖用排除背景後的「針對性等級」；事件寫入 `country-epid-events.json` 推出新增／調升／調降／解除；分布超出閘門（第三級 >5、第二級 >60、第一級 >250）⇒ 沿用人工校對快照並記錄 `meta.lastLiveAttempt`。全部不需人工。
17. **推導移轉清單與聚合待辦**：舊站每個疾病頁的子頁結構相同，`content/migration/_disease-template.json`（標準子頁樹，每筆含 `mapTo`：疾病頁區塊、主檔欄位、關聯內容或站內頁）由引擎對**主檔每一種疾病**推導一份移轉清單（`derived: true`）：疾病頁存在且 `mapTo` 命中 ⇒ `merged`（區塊、主檔欄位、站內頁）或 `migrated`（關聯內容，`target` 為該內容 id）；疾病頁存在但未命中 ⇒ `pending`；疾病頁不存在 ⇒ 整份清單 `status: no-page`，所有項目 `pending`。人工清單（`content/migration/{slug}.json`，可用 `extends: 'migration-template.disease'` 明示）**同 `key` 覆蓋推導結果**，人工沒寫的 `key` 仍由模板補。推導項一律 `verified: false`。人工例外已指向同一份新站內容（`target` 相同）的模板位置**保留但標 `coveredBy: <例外 key>`**，狀態跟例外走、`note` 寫明被誰涵蓋、不另計一筆待辦；舊站匯入工具（`expandTemplateItems`）與模擬匯出用同一條規則，三處推導項數一致。待辦**每份清單只開一則** `migration-pending`：「{疾病}：N 個舊頁待移轉」（`no-page` 為「{疾病}：疾病頁尚未建立，N 個舊頁待移轉」），不再逐筆開；優先度依法定類別（第一、二類高、第三類中、第四與五類低）。`{id}` 佔位的舊網址標 `pattern: true`，不進伺服器轉址檔。`site.migration.stats` 另計 `lists`、`derived`、`curated`、`noPage`，並輸出 `v1/migration/index.json` 與 `v1/migration/{slug}.json`。
18. **內容來源語言（`sourceLang`）**：內容可以以英文（或其他語言）為來源語言——例如只有英文版的「國際合作」區塊。規則：`languages[sourceLang].status` 必須為 `source`；頂層欄位是來源語言的文字，其他語言放 `i18n.{lang}`，**包含 `i18n['zh-TW']`**。`sourceLang` 不是 `zh-TW` 時，`i18n['zh-TW']` 必填，且 `languages['zh-TW'].status` 只能是 `reviewed` 或 `machine`，不可是 `none`（中文官網不能沒有中文）。來源語言的頁面永遠可渲染；`sourceHash` 以來源語言頂層欄位計算，譯文 `sourceHash` 不同即標過期（規則 5 照常，只是語言標籤換了）；頁首顯示「本頁以英文為準，中文為譯文」（反向的譯文狀態列）；搜尋與答案引擎的索引語言依 `sourceLang`（英文來源進英文索引，中文譯文進中文索引）。缺中文譯文時建置失敗。

第七輪新增規則（人才招募與採購公告）：

19. **招募階段由日期與結果推導（`gov.jobStage`）**：`job` 的階段不是人填的，是引擎每次建置依下列優先順序算出：`manualStatus`（`cancelled`／`filled`）＞ 有 `result`（`result`）＞ 今天 < `applyStart`（`upcoming`）＞ 今天 ≤ `deadlineAt`（`open`）＞ `examPlan` 有日期已到（`screening`）＞ 其餘（`closed`）。**唯一的人工覆蓋是 `manualStatus`**。不是 `upcoming`／`open` 者 `gov.closed = true`，自動退出首頁與開放中清單。頁籤 `gov.jobTab`：`open`（開放中）、`upcoming`（即將開放）、`review`（審查與甄試中：`closed`、`screening`）、`result`（錄取結果）、`history`（歷史：`result.publishedAt` 超過 90 日、或已取消、已補實）。三個待辦：
    - `job-result-overdue`：階段為 `closed`／`screening`，今天 > `resultPlannedAt` + 7 日且無 `result`（owner 人事室、抄送 `hiringUnit`，中優先）；沒填 `resultPlannedAt` 不開；
    - `job-waitlist-expiring`：階段為 `result`，備取 `validUntil` 在 14 日內且該備取尚未遞補（低優先）；
    - `job-apply-url-dead`：外部報名網址 `applyUrl` 失效（沿用規則 13 的外部連結健康，`broken` 才開，取代 `link-broken`）；階段為 `open`／`upcoming` 時為高優先、期限 1 日，其他階段為中優先。
    `unchecked` 不產生待辦。另有 validate 一致性檢查（失敗即建置失敗）：`slug` 與 id 一致且唯一、`hiringUnit` 存在、`applyStart` ≤ `deadlineAt`、`examPlan` 日期不早於 `deadlineAt`、`cancelled` 的職缺不得有 `result`、`legacyIds` 不得仍是現存 id。
20. **甄選結果只公布報名編號、到期下架，都是建置閘門；AI 不唸名單**（第三十輪 #55 修訂）：`result.admitted[]`、`result.waitlist[]`、`waitlistUpdates[]` 的每一筆**不得有任何姓名欄**（`nameMasked`、`name`、`姓名`…，連遮罩姓名也不行；schema 的 `propertyNames` 與 validate 雙重擋，錯誤訊息不回印姓名）；`result.unpublishAt`（下架日）必填：預設公告日＋3 個月、晚於最後一位備取有效期，至少 30 日、至多 12 個月；到期當天起治理引擎把名單從頁面、API、RSS、JSON-LD、`.md`、全文搜尋與答案索引拿掉，頁面改顯示「甄選結果已於 YYYY-MM-DD 下架」與人事室聯絡；下架前 14 日與下架後原始檔仍有名單各開一筆 `job-result-unpublish` 待辦。建議做法是 `result.externalUrl`（名單留在人事系統，本站只放連結，與名單擇一）。另外，`result.note` 與遞補 `note` 掃描身分證字號與遮罩姓名樣式；`candidateNo`（報名編號，3–24 個英數字與連字號）不得像身分證字號或居留證號（任何位置出現 `[A-Z][1289]\d{8}` 樣式都擋）；`result.note` 與遞補 `note` 同樣掃描身分證字號樣式；同一職缺報名編號不得重複；`admitted` 筆數不得超過 `positions`。**違反即建置失敗，不能發布，不是警告**；後台 `/admin/jobs/` 的「結果上架檢核」逐項顯示（`gov.resultCheck`）。AI 白名單：職缺與採購公告屬第四批核准範圍（民眾版），但**排除 `result` 與 `waitlistUpdates`**，不進答案索引與反向稽核文字：職缺公告內容（職稱、資格、日期、報名方式）可被引用，名單不可；答案引擎遇「誰錄取」類問題只回結果頁連結，並說明本站只公布報名編號、不公布姓名（評估集 NC003、NC006、NC007）。報名資料本身不進 repo、不進 Git，見 [careers-privacy.md](careers-privacy.md)；全庫另有個資掃描（`scripts/pii-scan.mjs`，PR 合併前與建置時都跑），見 ARCHITECTURE 第 35 節。
21. **採購階段推導與決標逾期（`gov.tenderStage`）**：優先順序：`manualStatus`（`failed` 流標、`cancelled` 取消）＞ 有 `award`（`awarded`）＞ 今天 ≤ `deadlineAt`（`open`）＞ 今天 ≥ `openingAt`（`opened`）＞ 其餘（`closed`）。頁籤：招標中、已截止、已開標、已決標、流標（取消併入流標頁籤）。待辦 `tender-award-overdue`：階段為 `opened`（已開標、無 `award`、非流標取消）且今天 > `openingAt` + 30 日（owner 秘書室、抄送 `requestingUnit`，中優先）；**沒填 `openingAt` 不會有這個待辦**。`pccUrl` 失效沿用規則 13。validate：`slug` 與 id 一致、`requestingUnit` 存在、`announcedAt` ≤ `deadlineAt` ≤ `openingAt` ≤ `award.date`，且已有 `award` 不得再填 `manualStatus`。**本站只做入口與狀態，正式公告以政府電子採購網為準。**

第八輪新增規則（檔案資產：附件、圖片、資料檔）：

22. **檔案資產宣告與建置檢查**：內容把檔案放在 `content/assets/{id}/`，並在 `assets[]` 逐一宣告；建置時由 `scripts/lib/assets.mjs`（validate 階段）檢查，**任一項不過即建置失敗**（孤兒檔除外）：（a）**存在**：宣告的檔案必須存在；`content/assets/` 底下的資料夾名稱必須是存在的內容 id；（b）**hash**：`sha256` 與 `bytes` 必須與實際檔案相符，不符時訊息同時印出宣告值與實際值，`npm run build -- --fix-assets` 可自動補寫 `bytes`／`sha256`／`mime`／寬高（讀檔頭）；（c）**大小**：PDF 與文件類（pdf、docx、odt、md、ics）≤ 20 MB、圖片 ≤ 2 MB、資料檔（csv、json、xlsx）≤ 50 MB，一筆內容 ≤ 30 個檔（設定在 `site.config.mjs` 的 `assets`：`maxBytes.{pdf,image,data}`、`allowedExt`、`maxFiles`、`altMaxLength`）；（d）**格式**：副檔名須在允許清單（pdf、png、jpg、jpeg、webp、svg、csv、json、xlsx、docx、odt、md、ics），且與 `mime` 一致；檔名只能小寫英數、連字號、底線與點，不可有空白與中文（失敗時給建議檔名）；SVG 不得含 `<script>` 與 `on*=`；（e）**內容與副檔名相符**：檔案內容須與副檔名一致，`.json` 須可解析，SVG 另掃 `javascript:` 連結與 `<!ENTITY>`；缺 `bytes`／`sha256`／`mime` 同樣建置失敗（訊息附實際值）；（f）**孤兒**：`content/assets/{id}/` 有檔但內容未宣告 ⇒ 警告，並開待辦 `asset-orphan`（低優先，期限 30 日，每筆內容只開一則），孤兒檔不複製到站台；（g）**引用**：Markdown 內文與既有欄位（`attachments[]`、`pdfUrl`、`materials[]`）中，網址以 `/files/{id}/` 開頭者必須在 `assets` 宣告，內文圖片引用的 kind 必須是 `image`；外部網址仍走規則 13 的外部連結健康（`/files/` 不列入外部連結檢查）。建置只把**有宣告**、且內容狀態為 `published` 或 `archived` 的檔案複製到 `dist/files/{id}/`；`width`／`height` 與實際不符、`machineReadable: true` 的 PDF 偵測不到文字層，只是警告；`/files/` 視為站內連結，由全站連結檢查保證存在；`/v1/catalog.json` 每筆帶 `assets` 摘要（`file`、`kind`、`label`、`url`、`bytes`、`mime`、`machineReadable`），其他 `/v1/` 內容回應的 `assets` 每筆另加絕對網址 `url`；`llms.txt` 不列檔案。檔案隨內容生命週期：內容 `archived` 後檔案仍可存取，不因下架而消失（見 [assets-policy.md](assets-policy.md) 第 9 節）。
23. **圖片 alt 與授權是建置閘門**：`kind: image` 的資產必須有 `alt`（≤ 150 字）與 `license`，缺任一項**建置失敗，不是警告**。內文 Markdown 的 `![替代文字](…)` 與 `assets.alt` 擇一非空即可，渲染時以 `assets.alt` 補進 `<img alt>`，並加 `loading="lazy"` 與 `width`／`height`（有值時）。`license` 不是 `OGDL-1.0` 的素材（外購、CC、第三方，即非本署自製）還必須有 `source`（原作者與出處），缺 `source`，或 `license` 不在許可清單（`OGDL-1.0`、`CC0-1.0`、`CC-BY-4.0`）⇒ 待辦 `image-license-missing`（中優先，期限 30 日，只對 `published` 且未被取代的內容開，owner 補來源與授權證明；清單外者沿用第 4 節，寫明限制並由 OASIS 確認）。
24. **PDF 無可及性版本 ⇒ 待辦 `attachment-no-accessible-version`**：`kind: attachment` 的 PDF，若 `machineReadable` 不是 `true`（填 `false` 或沒填；沒有文字層或不是標籤 PDF），且 `accessibleAlt` 沒有指向同一內容宣告過的 `.md`、`.docx` 或 `.odt` 替代版 ⇒ 開待辦（中優先，owner 為內容權責單位，期限 30 日；只對 `published` 且未被取代的內容開）：找回原始檔重新匯出，或另附文字版。`machineReadable` 是承辦人的聲明；建置只做簡易偵測（宣告 `true` 卻找不到文字層 ⇒ 警告，不擋建置），標籤與閱讀順序無法自動判斷，因此由複核者抽查。`accessibleAlt` 只能是 `.md`、`.docx`、`.odt`，並須指向同一內容已宣告的檔，否則 validate 失敗。這條規則補足 KPI「現行文件有機讀版」在**附件層級**的缺口：文件型別的 `machineReadableMarkdown` 仍是機讀版的正本，PDF 只是附件。

第九輪新增規則（發布車道、排程與緊急發布、自動轉換草稿）：

25. **發布車道與自動合併（`content/governance/lanes.json`）**：內容依型別分三條車道，**由系統判定，承辦人不能自選**。`gov.lane`＝`laneOfItem`：`urgent: true` 且型別為 `news`／`letter`／`clarification` ⇒ `emergency`；否則依型別落在 `fast`（`news`、`letter`、`clarification`、`job`、`tender`、`banner`）或 `standard`（`disease`、`vaccine`、`document`、`faq`、`topic`、`service`、`page`、`publication`、`labtest`、`research`、`dataset`、`media`、`migration`）；未列入的型別一律一般車道。
    - `emergency`／`fast`：`autoMerge: true`、`requiredApprovals: 0`，CI 全過由工作流程自動 squash 合併；上線後 `postPublishReviewHours`（24 小時）內複核；SLA 分別為 10、180 分鐘。
    - `standard`：`autoMerge: false`、`requiredApprovals: 1`，審核人 `reviewers`（公關室），一級內容（疾病、疫苗，`site.config.tier1Types`）改用 `tier1Reviewers`（公關室＋OASIS）；SLA 2 個工作天。
    - **CI 是第一位審核者**（`rules.ciIsTheReviewer`）：自動合併的前提是 schema、治理規則、評估集、檔案資產、連結檢查全過；任一項失敗就不合併，與車道無關。**多語不擋中文**（`rules.translationsNeverBlock`）：機器翻譯只允許用於 `rules.machineTranslationAllowedFor`（`news`、`faq`、`topic`、`service`），一級內容的未審核語言仍不渲染，但不阻擋中文正本。
    - **一個 PR 含多種內容時取最嚴格的車道**（`standard` ＞ `fast` ＞ `emergency`）；`content/` 以外的變更（程式、文件、設定，包括 `content/governance/` 本身）一律一般車道。判定工具 `node scripts/lane.mjs <變更檔案…>`，CI 與本機同一份邏輯。
    - **`urgent` 只限三種型別**：其他型別標 `urgent: true` ⇒ schema 驗證失敗；後台預檢同樣擋下。緊急發布不跳過任何機器檢查，只省去人工核准的等待。
    - 調整車道＝改 `lanes.json`，須經資料治理委員會議定並走一般車道 PR；`lanes.json` 本身有形狀檢查（三條車道齊備、自動合併車道核准人數必為 0 且必須有上線後複核、一個型別只能歸屬一條車道、每個內容型別都有車道、`rules.urgentAllowedTypes` 必填）。PR 的 SLA 逾期由 CI 在 PR 上標 `sla:breach` 並留言，**不是**建置待辦。
26. **排程發布與上線後複核**：（a）**排程**：`publishAt` 晚於建置當下真實時間 ⇒ `gov.scheduled`、`gov.publishScheduled`，生命週期「排程中」、`noindex`、退出 AI 白名單（原因 `scheduled`）、不計入已發布數；**不渲染、不進搜尋索引、sitemap、API、RSS、`llms.txt`，檔案資產也不複製**。主站每 2 小時重建一次，所以實際上線時間最多比 `publishAt` 晚 2 小時；`BUILD_TODAY` 只凍結治理日期，不影響排程判斷。（b）**上線後複核**：快車道與緊急發布的內容已上線（非排程中）且 `postPublishReview.status` 不是 `done` ⇒ 待辦 `post-publish-review`：owner 公關室（`lanes.json` 的 `postPublishReviewer`）、抄送原權責單位，期限＝上線時間（`publishAt`，否則 `publishedAt` 當天 00:00 臺灣時間）＋ 24 小時，中優先，**超過期限升為高優先並標逾期**；複核完成時在內容加 `postPublishReview: { status: 'done', reviewedBy, reviewedAt }`。`lanes.json` 的 `rules.postPublishReviewSince` 之前發布、且沒有宣告 `postPublishReview` 的舊內容不追溯。一般車道內容不開此待辦（已事先審核）。
27. **自動轉換草稿的信心與人工檢視**：舊站匯出經 `scripts/import-legacy.mjs` 批次轉換出的草稿，一律 `status: 'review'`（不是 `published`），並帶 `conversion: { mode: 'auto', confidence, issues[], sourceUrl, convertedAt }`。**信心分數**由規則檔（`content/migration/import/_import-rules.json`）的權重計算：型別對應明確 +0.4、owner 對應 +0.2、Markdown 無轉換警告 +0.2、附件全部找到 +0.1、無重複 +0.1，滿分 1.0；**低於 0.6（`thresholds.reviewConfidence`）⇒ 一定要人工逐頁檢視**，不可批次通過；0.8 以上（`autoConfidence`）可抽樣檢視。草稿**不直接放進 `content/`**：由權責單位人工確認後，以一般上架流程（走該型別的車道）進入 repo。內文過短（`minBodyChars`）、圖片缺 alt（標 `needsAlt`）、表格複雜、未對應類別、重複標題都記入 `issues`，並反映在信心分數與報告的「建議動作」。PDF 不整批轉換（只宣告為附件，`machineReadable` 由偵測決定）。`--apply-migration` 只改移轉清單的 `status`／`target`／`note`，**不動 `verified`**（逐筆確認仍是權責單位的事，見 [guide-staff.md](guide-staff.md) 第 15 節）。細節見 [legacy-import.md](legacy-import.md)。

## 3. 白名單政策

「白名單」＝ AI 問答允許引用的內容集合。它不是人工清單，而是**同時滿足**以下條件的內容：

- 型別在核准範圍內：第一批（公開）為 Q&A、疾病介紹、新聞稿、澄清、疫苗頁、資料目錄；第二批（文件庫、致醫界通函）僅供專業版。
- `status` = `published`，且 `aiWhitelist.requested` = true。
- 敏感度為 `public`（專業版型別例外，但僅供專業模式）。
- 未逾期、未被取代、未落後於所依據的正本、未被反向稽核命中。

不符合時，引擎在 `whitelist.reasons` 逐條列出原因：`not-requested` `not-published` `sensitivity` `type-not-allowed` `overdue` `superseded` `based-on-revised` `reverse-audit`。這份原因分布公開在透明報告。

**擴大白名單的流程：** OASIS 提案 → 評估集新增對應題型並達六項指標門檻 → 資料治理委員會決議 → 修改 `content/governance/whitelist.json`（核准人與日期入檔）。未達門檻不得擴大。

## 4. 授權政策

- 預設授權：**政府資料開放授權條款第 1 版（OGDL-1.0）**。
- 許可清單：`OGDL-1.0`、`CC0-1.0`、`CC-BY-4.0`。清單外的值引擎會開 `license-missing` 待辦。
- 第三方素材（照片、圖表、外部資料）若無法適用上述授權，必須在 `licenseNote` 寫明來源與限制，並由 OASIS 確認是否可進 API。
- 所有 API 回應外殼都帶 `meta.license`；引用時須標示來源（網址與最後審閱日）。
- **圖片與檔案的授權**：圖片 `license` 為必填、非本署素材須有 `source`（規則 23）；授權欄位與內容授權分開記，同一頁可以內文是 OGDL、某張外購圖是別的授權。細節見 [assets-policy.md](assets-policy.md) 第 5 節。

## 5. 個資與對話紀錄

- **輸入防護**：身分證字號、電話、電子郵件、地址門牌在送到任何模型前先遮蔽；偵測到提示注入字樣時不執行。
- **原型不保存提問**：沒有後端，答案在瀏覽器內組出；回報寫在使用者自己的 localStorage（`cdc.reports`）。
- **BYOK**（自備金鑰）：金鑰只存在使用者瀏覽器，直接連供應商，不經本站；介面標示供應商與模型。
- **正式環境建議（待委員會議定）**：對話紀錄只留稽核編號、意圖、引用來源 id、是否拒答、回報狀態，不留原始輸入全文；保存期限與去識別化方式需符合個資法與機關規定；回報若含個資，先遮蔽再轉給 Steward。
- **人才招募**：報名資料不進 repo、不進 Git；本站只公布報名編號（不公布姓名）、到期下架，由建置閘門強制（規則 20）；模擬報名資料只存使用者自己的瀏覽器；設了表單端點後直接送到報名系統（[deploy.md](deploy.md) 第 13 節）。原則、保存期限與刪除見 [careers-privacy.md](careers-privacy.md)。
- **檔案中的個資**：含個資的檔案（附件、圖片、資料檔）不得上架；PDF 塗黑不等於刪除，圖片要移除 EXIF。正式站上傳前須經病毒掃描並留日誌；第三十輪起建置與 PR 都會跑**個資掃描**（身分證／居留證檢查碼、手機、個人信箱、名單語境姓名；PDF 只掃未壓縮的文字層、圖片不做 OCR），病毒偵測仍靠流程把關。要刪檔的理由與流程見 [assets-policy.md](assets-policy.md) 第 9、10 節。
- 內容與範例一律不放真人姓名，承辦人以職稱表示。

## 6. KPI（每次建置重算，`/v1/governance/kpi.json`）

| KPI | 一年目標 | 三年目標 |
| --- | --- | --- |
| 對外內容頁有更新日與權責單位 | 100% | 100% |
| 開放資料集授權標示一致 | 100% | 100% |
| 資料集在更新頻率內更新 | 90% | 98% |
| 現行文件有機讀版 | 100% | 100% |
| 英文版與中文同步（疾病頁） | 91% | 100% |
| 一級內容七語涵蓋 | 50% | 100% |
| 資料出口有 OpenAPI 文件 | 100% | 100% |
| 已修訂正本仍有未加註衍生內容 | 0 件 | 0 件 |
| 失效版本仍在搜尋結果 | 0 件 | 0 件（引擎保證） |
| 影音有逐字稿比例（`media-transcript`） | 100% | 100% |
| 影音依據正本為現行版比例（`media-current-basis`） | 100% | 100% |
| 外部連結已檢查且正常比例（`link-health`；尚未執行檢查時顯示「尚未執行檢查」） | 95% | 99% |
| 已截止超過 90 天仍上架的公告（`notices-closed-unarchived`） | 0 件 | 0 件 |
| AI 白名單生效內容數 | 追蹤 | 追蹤 |

KPI 目標值是原型設定，正式數字由委員會核定。

## 7. 委員會決議事項（原型的假設，需正式議決）

下列是原型為了能運作而**採用的假設**，並非已通過的決議。上線前應由資料治理委員會逐項確認，確認後將核准人與日期寫入 `content/governance/whitelist.json` 或本文件：

1. 內容必填欄位清單，以及「缺欄位不得發布」的原則。
2. 各型別預設審閱週期（疾病 12、疫苗 6、Q&A 6、文件 12、新聞稿與通函事件觸發）。
3. 白名單分兩批，第二批僅供專業版。
4. 預設授權為 OGDL-1.0，例外須登記。
5. 態勢四級狀態由疫情中心人工發布，模型不得產生。
6. AI 暫停權限與 15 分鐘處置目標。
7. 版本題全對才上線；AI 引用失效版本列為嚴重缺陷。
8. 對話紀錄的保存範圍與期限。
9. 每季公開 AI 透明報告。
10. 正本修訂後衍生內容的 7 日處理期限。

## 8. 範例：一筆內容的一生

以「登革熱：發燒幾天內要就醫？」這則 Q&A 為例，看欄位與規則怎麼串起來。

1. **上架（2026-03-10）**：急性傳染病組 Steward 填 `owner: unit.acute-infectious`、`reviewedAt: 2026-03-10`、`reviewPeriodMonths: 6`、`basedOn: ["disease.dengue"]`、`aiWhitelist.requested: true`。引擎算出 `nextReviewAt = 2026-09-10`，白名單資格成立。
2. **日常**：頁首顯示「權責單位 · 最後審閱」；AI 答案引用它時，來源卡帶出同樣兩項資訊。
3. **疾病頁修訂（2026-06）**：登革熱疾病頁（它是這則 Q&A 的正本）改了就醫建議並更新審閱日。因為 Q&A 的 `basedOn` 指向疾病頁，引擎偵測到正本較新，且 Q&A 的審閱日早於修訂日——但疾病頁不是「文件」型別，不走版本鏈規則；Q&A 的承辦人會在審閱到期清單上看到它，審閱時與疾病頁對一次。（若正本是文件型別，則會自動加註並開 7 日待辦，見操作手冊第 3 節。）
4. **逾期（2026-09-11 起）**：若沒人在 9 月 10 日前審閱，建置後頁首出現黃色警示，這則 Q&A 退出白名單，AI 不再引用它，改引用仍有效的疾病頁；待辦出現在 owner 的清單與 `/v1/governance/todos.json`。
5. **審閱（任何時候）**：Steward 確認內容正確，把 `reviewedAt` 改為當天。下次建置後警示消失，`nextReviewAt` 往後推 6 個月，白名單資格恢復。
6. **不再需要**：`status` 改 `archived`，退出索引與白名單，頁面可保留供查閱。

整個過程中，沒有任何人需要「記得去檢查哪些內容快過期」——那是引擎的工作。人的工作是審閱時真的去確認內容是對的。
