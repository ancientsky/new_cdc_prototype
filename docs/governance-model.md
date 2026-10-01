# 資料治理模型

> 給誰看：資料治理委員會成員、OASIS、各組 Steward、資訊室。
> 實作位置：欄位定義在 `schemas/`，規則在 `scripts/lib/governance.mjs`，測試在 `tests/`。
> 核心原則：**人只填一次欄位，其餘狀態都是建置時由欄位推導出來的**；模板與前端不得自己重算治理邏輯。

## 1. 欄位定義

### 1.1 每筆內容共同欄位

| 欄位 | 誰填 | 說明 |
| --- | --- | --- |
| `id` | 承辦 | 穩定、可讀、全站唯一，例：`disease.dengue`、`doc.mmr-recommendation.2025-04-16`。對外引用以它為準，取代現行官網的加密 ID |
| `type` | 承辦 | `disease` `faq` `news` `letter` `clarification` `document` `vaccine` `dataset` `banner` `page` |
| `owner` | 承辦 | 權責單位 id，必須存在於 `content/master/units.json`；對內容正確性負責 |
| `publishedAt` / `reviewedAt` | 承辦 | 首次發布日／最後審閱日。**審閱日不是編輯日**，代表權責單位重新確認過內容仍正確 |
| `reviewPeriodMonths` | 承辦 | 審閱週期（月）。預設見 `master/review-periods.json`；0 代表事件觸發 |
| `status` | 承辦 | `draft` `review` `published` `archived` |
| `audience` | 承辦 | `public` `professional` 可複選 |
| `sensitivity` | 承辦 | `public` `professional` `internal`；只有 `public` 可進一般白名單 |
| `license` | 承辦 | 預設 `OGDL-1.0`；例外要寫 `licenseNote` |
| `languages` | 承辦 | 每語言狀態：`source` `reviewed` `machine` `pending` `none` |
| `basedOn` | 承辦 | 依據的正本 id，衍生內容必填 |
| `aiWhitelist.requested` | 承辦 | 申請進 AI 白名單；**是否生效由引擎算** |
| `summary` | 承辦 | ≤ 120 字，兼作 meta description |
| `nextReviewAt` | **系統** | `reviewedAt` ＋ 週期；不要手填 |
| `sourceHash` | **系統** | 中文正本內容雜湊，用於判斷譯文是否過期 |
| `isCurrent`、`supersededBy` | **系統** | 文件版本鏈，依 `effectiveAt` 計算 |

文件另有 `family`（版本家族）、`version`、`effectiveAt`、`supersedes`、`changes`、`machineReadableMarkdown`、`roles`；資料集另有 `canonicalUrl`（正本位置，唯一）、`updateFrequency`、`lastUpdated`。

### 1.2 引擎輸出（`item.gov`）

`nextReviewAt`、`daysToReview`、`overdue`、`superseded`、`stale[]`（依據正本已修訂的清單）、`annotations[]`（頁首警示）、`whitelist{requested, effective, reasons[]}`、`translationStale{}`、`reverseAuditHits[]`。全站層為 `site.gov`：KPI、待辦、白名單數、AI 暫停狀態。

## 2. 規則（寫死在引擎，不靠人記）

1. **逾期**：今天 > `nextReviewAt` → 頁首黃色警示、退出白名單、開待辦。
2. **版本取代**：文件新版 `published` 且 `effectiveAt` 較新 → 舊版紅色警示、`noindex`、退出索引、`.md` 首行警示、`documents.json` 標 `isCurrent:false`、`redirects.json` 增 301。
3. **基於正本修訂**：`basedOn` 的正本 family 出現較新的生效版本，且本內容的審閱日早於新版生效日 → 頁首橘色加註、退出白名單、給 owner 7 日待辦。`reviewedAt` ≥ 新版生效日才解除。
4. **反向稽核**：`auditRules`（宣告在主檔或文件）以規則表達式掃全站文字（含各語言譯文）。例：MMR 主題不得再出現「1981 年（含）以後出生」。命中 → 待辦。失效版本本身不稽核。
5. **翻譯**：譯文 `sourceHash` ≠ 中文 `sourceHash` → 該語言標「中文已更新，譯文待複核」並開待辦。一級內容（疾病、疫苗、澄清、態勢）`machine` 不渲染該語言頁。
6. **資料集**：`lastUpdated` ＋ 更新頻率逾期 → 待辦；授權不在許可清單 → 待辦。
7. **AI 暫停**：`ai-status.paused === true` → 全站深色橫幅、答案頁退回傳統列表。
8. **發布閘門**：schema 或參照檢查失敗、評估集版本題未全對 → 建置失敗，不能發布。

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

## 5. 個資與對話紀錄

- **輸入防護**：身分證字號、電話、電子郵件、地址門牌在送到任何模型前先遮蔽；偵測到提示注入字樣時不執行。
- **原型不保存提問**：沒有後端，答案在瀏覽器內組出；回報寫在使用者自己的 localStorage（`cdc.reports`）。
- **BYOK**（自備金鑰）：金鑰只存在使用者瀏覽器，直接連供應商，不經本站；介面標示供應商與模型。
- **正式環境建議（待委員會議定）**：對話紀錄只留稽核編號、意圖、引用來源 id、是否拒答、回報狀態，不留原始輸入全文；保存期限與去識別化方式需符合個資法與機關規定；回報若含個資，先遮蔽再轉給 Steward。
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
