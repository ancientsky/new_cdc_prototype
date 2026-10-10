# 疾管署 AI-ready 新官網原型 · 架構與約定

> 這份文件是人與 AI 協作者的共同契約。任何人（或 agent）動手前先讀完。
> 一句話：**內容與資料只存一份（`content/`），展示（HTML）、API（`v1/`）、機讀版（`.md`）、AI 檢索索引、治理儀表板全部是它的「消費者」，由 `npm run build` 一次算出來。**

對應規劃文件：《疾管署官網 AI 應用與資料治理導入：盤點、規格與路線圖》（2026-09-22）與 11 頁 wireframe。本原型把第一階段「打底」＋第二階段「重建」的規格做成可以動的東西，部署在 GitHub Pages（純靜態）。

---

## 0. 為什麼這樣設計（給同事看的三句話）

1. **治理不是另一個系統，是內容檔案裡的欄位。** 每筆內容必填 `owner`、`reviewedAt`、`reviewPeriodMonths`、`audience`、`status`、`basedOn`。缺一個，`npm run build` 直接失敗，上不了線。
2. **人只填一次，機器算其餘。** 下次審閱日、逾期、失效版本、衍生內容待辦、白名單資格、翻譯是否過期、KPI、季報，全部是建置時由欄位推導的，沒有人需要「記得去看」。
3. **AI 只轉述、不創作。** 預設答案引擎是「抽取式」：每一句話就是白名單內容裡的一句原文，附來源編號；可選接 LLM（BYOK）時，輸出每句必須對應到檢索片段，對不上就刪掉。

---

## 1. 目錄配置

```
ARCHITECTURE.md            本文件
README.md                  對外說明、怎麼跑、怎麼部署
site.config.mjs            站台設定：basePath、語言、網址、單位
schemas/                   JSON Schema（draft 2020-12）；content/ 每種型別一份
content/                   ★ 內容層與資料層的單一事實來源（人維護）
  master/                  主檔：diseases、vaccines、countries、units、glossary、review-periods
  diseases/<slug>.json     疾病頁（八個固定區塊）
  faq/<id>.json            Q&A
  news/<id>.json           新聞稿／致醫界通函／澄清稿（type 區分）
  documents/<id>.json      文件（手冊、指引、病例定義；版本鏈）
  clarifications/<id>.json 謠言查證用結構化澄清
  situation/current.json   疫情態勢層（疫情中心人工發布）
  situation/history/*.json 歷次發布
  vaccines/<id>.json       疫苗頁（公費對象、時程）
  datasets/<id>.json       資料目錄（含 CKAN 快照補上治理欄位）
  banners/*.json           首頁宣導 Banner（有上下架日、權責）
  governance/ai-status.json      AI 問答開關（暫停／運作）
  governance/whitelist.json      白名單政策（哪些型別可進、核准紀錄）
  governance/eval-set.json       評估集（含版本題、拒答題）
data/snapshots/            由 scripts/fetch-data.mjs 抓回的原始資料（CKAN、旅遊疫情、國家等級、nidss 匯出）；每檔有 provenance
scripts/
  fetch-data.mjs           從官方來源抓資料到 data/snapshots/（抓不到就用既有快照，不會失敗）
  build.mjs                建置總管：load → validate → govern → index → render → emit
  serve.mjs                本機預覽（static server，含 basePath）
  lib/load.mjs             讀 content/ → site.collections
  lib/validate.mjs         ajv 驗證 + 跨檔參照檢查（owner 存在、basedOn 存在…）
  lib/governance.mjs       ★ 治理引擎：生命週期、白名單、版本鏈、衍生待辦、反向稽核、翻譯過期、KPI
  lib/index-builder.mjs    把白名單內容切成「答案單元」→ v1/search-index.json
  lib/emit-api.mjs         v1/*.json、openapi.json、catalog.json
  lib/emit-seo.mjs         sitemap*.xml、robots.txt、llms.txt、每頁 .md、JSON-LD helper
  lib/render.mjs           html 標籤模板、esc、url()、t()（i18n）、日期格式
  lib/markdown.mjs         marked 包裝（安全設定）
src/
  templates/layout.mjs     共用版面（header/footer/三層露出/語言切換/身分切換）
  templates/public/*.mjs   民眾端頁面
  templates/pro/*.mjs      專業人員專區
  templates/admin/*.mjs    內容管理後台（原型：純前端，資料來自 v1/ 與 localStorage）
  styles/tokens.css        設計 token（顏色、字級、間距、狀態色）
  styles/base.css          reset、排版、無障礙
  styles/components.css    元件
  client/ui.js             共用互動（details、身分切換、語言、回報表單、稽核編號）
  client/i18n.js           七語 UI 字串
  client/charts.js         SVG 迷你圖（bar、sparkline）
  client/answer/*.js       ★ 答案引擎（意圖、檢索、拒答、組頁、來源、BYOK LLM、謠言、統計）
  client/admin/*.js        ★ 後台邏輯（上架預處理、複核、到期、待辦、開關、匯出）
eval/run-eval.mjs          在 Node 跑評估集（與瀏覽器共用答案引擎核心）
tests/*.test.mjs           node:test
docs/                      使用指南：民眾、專業人員、同事（Steward／公關室／資訊室）、治理 SOP
dist/                      建置輸出（git ignore；Pages 由 Actions 上傳）
.github/workflows/pages.yml  建置＋部署；每 2 小時建置、每日 02:00 UTC 排程重抓資料
```

---

## 2. 內容模型（content/）

### 2.1 所有內容共同欄位（`schemas/_common.json`）

| 欄位 | 型別 | 必填 | 說明 |
| --- | --- | --- | --- |
| `id` | string | ✓ | 穩定、可讀、全站唯一：`disease.dengue`、`faq.dengue-fever-when-to-see-doctor`、`news.2026-09-22-enterovirus`、`doc.mmr-recommendation`、`clar.2026-09-anti-epidemic-team-scam`。取代現行加密 ID 作為對外引用。 |
| `type` | enum | ✓ | `disease` `faq` `news` `letter`(致醫界通函) `clarification` `document` `vaccine` `dataset` `banner` `page` |
| `title` | string | ✓ | 中文標題（正本語言 zh-TW） |
| `owner` | string | ✓ | 權責單位 id，必須存在於 `master/units.json` |
| `steward` | string |  | 承辦人稱謂（原型用職稱，不放真名） |
| `publishedAt` | date | ✓ | 首次發布日 |
| `reviewedAt` | date | ✓ | 最後審閱日 |
| `reviewPeriodMonths` | int | ✓ | 審閱週期；預設值依型別見 `master/review-periods.json`（疾病 12、疫苗 6、旅遊 6、Q&A 6、新聞稿 0＝事件觸發） |
| `nextReviewAt` | date | 計算 | 不要手填；治理引擎算 `reviewedAt + reviewPeriodMonths` |
| `status` | enum | ✓ | `draft` `review` `published` `archived` |
| `audience` | string[] | ✓ | `public` `professional`（可複選） |
| `tasks` | string[] |  | 六任務入口：`symptoms` `vaccines` `travel` `situation` `rumor` `data` |
| `sensitivity` | enum | ✓ | `public` `professional` `internal`；只有 `public` 可進 AI 白名單 |
| `license` | string | ✓ | 預設 `OGDL-1.0`（政府資料開放授權條款第 1 版）；例外填理由 `licenseNote` |
| `basedOn` | string[] |  | 依據正本（其他內容 id）。新聞稿、Q&A、影片、衍生內容都要填；正本修訂時由此產生待辦 |
| `diseases` | string[] |  | 關聯疾病 id（`disease.*`） |
| `vaccines` | string[] |  | 關聯疫苗 id |
| `countries` | string[] |  | ISO 3166-1 alpha-2 |
| `aiWhitelist` | object |  | `{ "requested": true, "approvedBy": "unit.oasis", "approvedAt": "2026-09-01" }`；**實際生效與否由治理引擎算** |
| `languages` | object | ✓ | 每語言一筆：`{ "zh-TW": {"status":"source"}, "en": {"status":"reviewed","reviewedAt":"2026-09-10","reviewer":"內部英文審核人"}, "vi": {"status":"machine"} }`。status：`source` `reviewed` `machine` `pending` `none` |
| `i18n` | object |  | 翻譯本文：`{ "en": { "title": "...", "summary": "...", "blocks": [...] } }`；缺的欄位 fallback 中文並標示 |
| `sourceHash` | string | 計算 | 中文正本內容雜湊；翻譯檔記 `i18n.<lang>.sourceHash`，不同＝翻譯過期 |
| `summary` | string | ✓ | ≤ 120 字摘要（即 meta description） |
| `keywords` | string[] |  | 關鍵字（上架預處理產生，人確認） |
| `legacyUrls` | string[] |  | 現行官網對應網址（供 301 對照表與來源連結） |

### 2.2 型別專屬欄位

**disease**（`schemas/disease.json`）— 八個固定區塊，缺的區塊也要存在（`blocks[].markdown` 可為空並標 `"status":"pending"`）：

```json
{
  "slug": "dengue",
  "nameEn": "Dengue fever",
  "aliases": ["登革出血熱", "天狗熱", "斷骨熱"],
  "legalCategory": 2,
  "icd10": ["A90", "A91"],
  "notifyWithinHours": 24,
  "incubation": { "min": 3, "max": 14, "typicalMin": 4, "typicalMax": 7, "unit": "day" },
  "transmission": ["vector"],
  "keyFacts": { "symptoms": "...", "prevention": "...", "transmission": "..." },
  "blocks": [
    { "key": "what-to-do", "heading": "我該怎麼辦", "markdown": "..." , "cards": [ {"if":"...", "title":"...", "text":"..."} ] },
    { "key": "symptoms", "heading": "症狀與警示徵象", "markdown": "...", "warning": "..." },
    { "key": "transmission", "heading": "怎麼傳染", "markdown": "..." },
    { "key": "prevention", "heading": "如何預防", "markdown": "..." },
    { "key": "treatment", "heading": "診斷與治療", "markdown": "..." },
    { "key": "vaccine", "heading": "疫苗", "markdown": "..." },
    { "key": "situation", "heading": "目前疫情與統計", "datasets": ["dataset.dengue-daily"] },
    { "key": "faq", "heading": "常見問題" }
  ],
  "professional": { "caseDefinitionDoc": "doc.case-definition-dengue", "manualDoc": "doc.guidance-dengue", "specimen": "..." }
}
```

**faq**：`question`、`answerMarkdown`、`diseases`。
**news / letter / clarification**（放 `content/news/`）：`newsType`（`press` `letter` `clarification` `other`）、`bodyMarkdown`、`letterNo`（通函號）、`region`。
**document**：`docType`（`manual` `guideline` `case-definition` `form` `recommendation`）、`version`（如 `v17`、`114.04.16`）、`effectiveAt`、`supersedes`（前版 id）、`supersededBy`（計算，不手填）、`pdfUrl`（現行官網）、`machineReadableMarkdown`（機讀版本文）、`changes`（本版異動：`[{section, before, after}]`）、`isCurrent`（計算）。版本用**獨立內容檔**表示：`doc.mmr-recommendation.2019-05-14` 與 `doc.mmr-recommendation.2025-04-16`，共用 `family: "doc.mmr-recommendation"`。
**clarification**（`content/clarifications/`）：`claim`（網傳訊息）、`verdict`（`false` `partly-true` `outdated`）、`clarificationMarkdown`、`shareText`（可轉傳短訊）、`reportChannel`、`relatedNews`。
**vaccine**：`slug`、`nameEn`、`publicFunded: [{group, schedule, note}]`、`diseases`。
**dataset**：`ckanName`、`portalUrl`、`canonicalUrl`（正本位置，唯一）、`mirrors[]`、`updateFrequency`（`daily` `weekly` `monthly` `irregular`）、`lastUpdated`、`format[]`、`schemaUrl`、`unit`（Owner）、`resources[]`、`category`（五類資產：`open-dataset` `stats-system` `structured-table` `document-library` `content-page` `press` `media`）。
**banner**：`image`、`headline`、`subline`、`cta {label,url}`、`startAt`、`endAt`、`priority`。
**situation/current.json**：

```json
{
  "publishedAt": "2026-09-21", "publisher": "unit.epidemic-intelligence", "dataDate": "2026-09-21", "source": "nidss",
  "nextReviewAt": "2026-09-28",
  "items": [
    { "disease": "disease.influenza", "status": "peak", "trend": "up", "metricLabel": "近四週門急診類流感就診率", "metricValue": "12%", "deltaText": "持續上升", "weekly": [8.1, 9.0, 10.3, 12.0], "advice": "長者與幼兒儘速接種流感疫苗", "basis": "類流感門急診就診率連續 4 週上升且超過流行閾值", "dataset": "dataset.ili-weekly", "pinned": true }
  ]
}
```
`status` 四級固定：`stable` `rising` `peak` `declining`，**由疫情中心人工填寫**；模型不得產生。
`cardStyle`（選填）首頁卡樣版：`standard`（預設）`chart`（加近週趨勢線，需 `weekly` ≥ 2 筆，否則退回 standard）`advice`（建議為主句）`minimal`（只留一行指標）；由 `/admin/situation/` 疫情發布表單選擇，`sitCard()` 依此輸出 `c-sit-card--style-*`，四種樣版共用同一組欄位。

### 2.3 主檔（content/master/）

- `units.json`：`[{ "id":"unit.acute-infectious", "name":"急性傳染病組", "nameEn":"Division of Acute Infectious Diseases", "role":"owner" }]`；包含 OASIS、公關室、資訊室、疫情中心、各組、六區管中心。
- `diseases.json`：99 種法定傳染病主檔：`id, slug, name, nameEn, aliases[], legalCategory(1-5), icd10[], notifyWithinHours, pageId(有疾病頁才有), datasets[]`。
- `vaccines.json`、`countries.json`（ISO、中英名、旅遊等級快照連結）。
- `glossary.json`：七語詞彙主檔：`[{ "id":"term.mpox", "zh-TW":"M痘", "aliases":["猴痘","Mpox"], "en":"Mpox", "ja":"エムポックス", "tl":"Mpox", "vi":"Đậu mùa khỉ", "id":"Mpox", "th":"ฝีดาษลิง", "preferred": true, "locked": true, "refs":["disease.mpox"] }]`。`locked:true` 的詞在機器翻譯時不得自由翻譯。
- `review-periods.json`：型別 → 月數。

---

## 3. 治理引擎（scripts/lib/governance.mjs）要算出的東西

輸入 `site.collections`，輸出掛回每筆 `item.gov` 與 `site.gov`：

```ts
item.gov = {
  nextReviewAt: string,            // reviewedAt + reviewPeriodMonths（新聞稿 reviewPeriodMonths=0 → null）
  daysToReview: number|null,
  overdue: boolean,                // today > nextReviewAt
  superseded: boolean,             // document：有更新版 isCurrent
  supersededBy: string|null,
  isCurrent: boolean,              // document family 內 effectiveAt 最新且 published
  stale: { basedOn: string, revisedAt: string, currentId: string }[],  // 依據正本已修訂（正本 family 有新版 effectiveAt > 本內容 publishedAt）
  annotations: [ { kind: "superseded"|"overdue"|"based-on-revised"|"machine-translation"|"paused", text, href } ],
  whitelist: { requested, effective: boolean, reasons: string[] },      // 不生效時 reasons 列每一條：not-published / overdue / superseded / sensitivity / based-on-revised / not-requested / type-not-allowed
  translationStale: { [lang]: boolean },
  reverseAuditHits: [ { term, rule, snippet } ]   // 反向稽核命中（例如 MMR 主題出現「1981 年」）
}
site.gov = {
  today, kpi: { ...第 7.5 節每一列：{label, current, target1y, target3y, numerator, denominator, pct} },
  todos: [ { kind:"based-on-revised"|"overdue"|"translation-stale"|"license-missing"|"dataset-overdue"|"reverse-audit"|"superseded-still-linked", itemId, owner, dueAt, text } ],
  whitelistCount, totalPublished, pausedAI: boolean (from governance/ai-status.json)
}
```

規則（寫死在引擎，不靠人記）：

1. 逾期 ⇒ 退出白名單 + 頁首「狀況層」黃色警示。
2. 文件新版 `published` 且 `effectiveAt` 較新 ⇒ 舊版自動 `superseded`：頁首紅色警示、`<meta name="robots" content="noindex">`、`.md` 首行「本版已由 … 取代」、退出索引、`v1/documents.json` 內 `isCurrent:false`、`redirects.json` 增一筆 301 對照。
3. `basedOn` 指向的正本 family 有新版 ⇒ 本內容 `stale`：頁首自動加註「本新聞稿發布於…，相關建議已於…修訂，現行版請見…」；退出白名單直到 `reviewedAt` ≥ 新版 `effectiveAt`；產生待辦給 owner，期限 7 日。
4. 反向稽核：`master/diseases.json` 或 `documents` 可宣告 `auditRules: [{ "scope": ["disease.measles"], "pattern": "1981\\s*年", "message": "MMR 條件已於 2025-04-16 改為 1966 年" }]`；引擎掃所有內容文字（含 i18n），命中即待辦。
5. 翻譯：`i18n.<lang>.sourceHash !== item.sourceHash` ⇒ 該語言 `stale`，頁面標「中文已更新，譯文待複核」；一級內容（disease、vaccine、situation、clarification）`machine` 狀態不渲染該語言頁，改顯示英文或中文並說明。
6. 資料集：`lastUpdated + updateFrequency` 逾期 ⇒ 待辦；`license` 不在白名單（`OGDL-1.0`、`CC0-1.0`、`CC-BY-4.0`）⇒ 待辦。
7. AI 暫停：`governance/ai-status.json.paused === true` ⇒ 全站「狀況層」深色橫幅、答案頁退回傳統列表；後台可切換（原型以 localStorage 覆寫示範 15 分鐘切回）。

---

## 4. 建置輸出（dist/）

### 4.1 頁面路由（zh-TW 在根；其他語言 `/{lang}/...` 同結構）

| 路徑 | 模板 | 說明 |
| --- | --- | --- |
| `/` | public/home | 問題框、現在的疫情、六任務、專業專區入口、最新消息、澄清 |
| `/ask/?q=` | public/ask | 搜尋即答案頁（client render） |
| `/situation/` | public/situation | 態勢層完整：趨勢圖、各疾病、發布依據、API |
| `/diseases/`、`/diseases/{slug}/` | public/diseases, disease | 索引（四種分類）與疾病頁（八區塊、一分鐘重點、三層露出） |
| `/vaccines/`、`/vaccines/{slug}/` | public/vaccines | 公費對象與時程 |
| `/travel/`、`/travel/{iso2}/` | public/travel | 目的地疫情等級（快照／每日抓） |
| `/factcheck/` | public/factcheck | 貼上訊息 → 判定 |
| `/data/` | public/data | 開放資料與統計：資料目錄、統計問答、API |
| `/news/`、`/news/{id}/` | public/news | 新聞稿、通函、澄清（含自動加註） |
| `/faq/`、`/faq/{id}/` | public/faq | |
| `/documents/`、`/documents/{id}/` | public/documents | 版本鏈、異動對照、機讀版、PDF 連結 |
| `/tasks/{task}/` | public/task | 六任務入口頁（內容依 `tasks` 欄位聚合） |
| `/pro/` | pro/home | 角色切換、訂閱、版本異動、常用作業 |
| `/developers/` | public/developers | API 文件（讀 openapi.json）、llms.txt、robots、機讀版說明 |
| `/policy/ai/`、`/policy/privacy/`、`/policy/open-data/`、`/accessibility/`、`/about/` | public/page | 政策頁 |
| `/transparency/` | public/transparency | 季度 AI 透明報告（由 eval 與回報算） |
| `/guide/` | public/guide | 怎麼用：民眾／專業／同事 |
| `/admin/*` | admin/* | 後台（見第 6 節） |
| `/404.html` | | |

每個內容頁同時輸出同名 `.md`（`/diseases/dengue.md`）：首段是治理資訊（權責、審閱日、版本、授權、正本 URL），再來是本文；失效或逾期在第一行警示。

### 4.2 API（`dist/v1/`）

所有檔案統一外殼：

```json
{ "meta": { "api": "v1", "generatedAt": "2026-10-01T03:00:00Z", "license": "OGDL-1.0", "source": "https://ancientsky.github.io/new_cdc_prototype/", "docs": ".../developers/" }, "data": ... }
```

| 檔案 | 內容 |
| --- | --- |
| `v1/diseases.json`、`v1/diseases/{slug}.json` | 主檔 + 疾病頁結構化欄位 + gov 摘要 |
| `v1/vaccines.json` | |
| `v1/faq.json` | 每題含 reviewedAt、owner、whitelist |
| `v1/news.json` | 近 200 則；含 `annotations` |
| `v1/documents.json` | 全部版本；`isCurrent`、`supersedes`、`supersededBy`、`effectiveAt` |
| `v1/clarifications.json` | |
| `v1/situation.json` | 態勢層；`items[]`、`publisher`、`dataDate` |
| `v1/travel-alerts.json`、`v1/country-levels.json` | 來自快照／live |
| `v1/datasets.json` | 資料目錄（CKAN 快照 + 治理欄位） |
| `v1/catalog.json` | 五類資產總目錄（每筆：id、type、owner、canonicalUrl、license、sensitivity、whitelist、reviewedAt） |
| `v1/glossary.json` | 七語詞彙 |
| `v1/search-index.json` | 答案單元（見 5.1） |
| `v1/governance/kpi.json`、`v1/governance/todos.json`、`v1/governance/ai-status.json`、`v1/governance/eval-report.json` | 治理 |
| `v1/redirects.json` | 舊版／舊網址 → 正本 |
| `openapi.json` | OpenAPI 3.1 |
| `sitemap.xml`（index）＋ `sitemap-diseases.xml` `sitemap-news.xml` `sitemap-documents.xml` `sitemap-{lang}.xml` | |
| `robots.txt`、`llms.txt`、`{lang}/llms.txt` | 依附錄 H |

### 4.3 每頁 `<head>`

canonical、hreflang × 7 + x-default、meta description（= summary）、og:*、JSON-LD（`MedicalCondition` / `FAQPage` / `NewsArticle` / `DigitalDocument` / `Dataset` / `GovernmentOrganization` + 自訂 `cdc:governance` 擴充：owner、reviewedAt、nextReviewAt、version、whitelist）、`<meta name="robots" content="noindex">`（失效版）、`<html lang data-base data-view>`。

---

## 5. 答案引擎（src/client/answer/）

### 5.1 答案單元（search-index 的 chunk）

```json
{ "id": "disease.dengue#symptoms#2", "contentId": "disease.dengue", "type": "disease", "lang": "zh-TW",
  "title": "登革熱 · 症狀與警示徵象", "text": "典型症狀為突發高燒…", "url": "/diseases/dengue/#symptoms",
  "owner": "unit.acute-infectious", "ownerName": "急性傳染病組", "reviewedAt": "2026-07-15", "nextReviewAt": "2027-07-15",
  "audience": ["public"], "tasks": ["symptoms"], "diseases": ["disease.dengue"], "vaccines": [], "countries": [],
  "version": null, "effectiveAt": null, "isCurrent": true, "whitelist": true, "terms": ["登革熱","dengue","警示徵象"], "sentences": ["…","…"] }
```
只有 `whitelist:true` 的才進索引；專業版索引另含 `audience: professional` 的文件（`v1/search-index-pro.json`）。

### 5.2 流程（必須全部實作）

1. **輸入防護**：個資遮蔽（身分證、電話、email、地址門牌）→ 遮蔽後才會送到任何模型；提示注入字樣偵測。
2. **意圖判斷**（規則 + 詞彙主檔）：`symptoms` `vaccine` `travel` `situation` `rumor` `professional` `stats` `unknown`。`?view=pro` 或身分＝專業 ⇒ 專業意圖優先。
3. **拒答邊界**：個人症狀判斷（「我是不是得了」「我該吃什麼藥」）、用藥劑量、法律責任、未發布疫情、媒體詢問 ⇒ 拒答卡（元件 5）：說明為什麼不能答、撥打 1922、相關官方頁面。
4. **檢索**：中文 bigram + 詞彙同義詞擴展（M痘＝猴痘）+ BM25；疾病／疫苗／國家實體加權；過濾白名單；專業模式只取 `isCurrent`。
5. **組頁**（依 6.3 表）：態勢卡（只讀 `v1/situation.json`，不生成數字）→ 答案句（每句附 [n]）→ 建議行動 → 來源卡（元件 9）→ 你可能也想知道。**抽取式**預設；**LLM 模式**（使用者在 `/ask/` 右上「進階」輸入自己的 Anthropic API key，存 localStorage，只在瀏覽器端直接呼叫，標示供應商與模型）時，系統提示只允許依片段作答並輸出 `{sentences:[{text, cite:[chunkId]}]}`，後檢：沒有 cite 或 cite 不在片段內的句子刪除；刪到剩 0 句 ⇒ 退回抽取式。
6. **統計問答**：比對資料目錄 + `data/snapshots` 內已結構化的時序（登革熱本土病例年統計、類流感就診率週統計…）→ 數字 + SVG 圖 + 正本連結；不推論、不預測；數字來源卡（Owner、資料日、授權、CSV/JSON/API）。
7. **謠言查證**：與 `v1/clarifications.json` 的 `claim` 比對（字元 n-gram 相似度）；`outdated` 判定來自治理引擎的 `stale`；輸出判定 + 澄清 + 可轉傳短訊 + 通報管道。
8. **多語**：UI 七語；回答優先取同語言 `reviewed` chunk，無則取中文 chunk 並標「自動翻譯（需 LLM 模式）／顯示中文原文」。
9. **稽核編號** `A-YYYYMMDD-XXXX`；回報表單自動帶入；回報寫 localStorage `cdc.reports`，後台「回報」頁讀出。
10. **暫停**：`ai-status.paused` ⇒ 答案頁改為傳統結果列表（標題、摘要、更新日）。

`src/client/answer/core.js` 必須是純函式、不碰 DOM、可被 `eval/run-eval.mjs` 在 Node 以同一份程式碼跑評估集。

---

## 6. 後台（/admin/，原型為純前端）

真實部署時「CMS」就是 Git：`content/` 改檔 → Pull Request → CI 驗證（schema、治理、評估集）→ 合併即發布。後台原型展示同一流程的操作面：

| 頁 | 功能 |
| --- | --- |
| `/admin/` | 治理儀表板：KPI 表（7.5 全列）、待辦、白名單數、暫停狀態 |
| `/admin/publish/` | 上架表單（wireframe 第 5 頁）：型別、標題、內文、權責、審閱週期、對象、任務、提供語言、依據正本 → **送出預處理**（瀏覽器內執行）：關鍵字與實體抽取（比對主檔，未對應者建議新增）、摘要與 meta、結構化欄位建議（潛伏期、通報時限、年份）、一致性檢查（與主檔／現行版數字矛盾）、多語初稿（鎖定詞彙；無 LLM 時以詞彙主檔替換 + 標示待產生）→ 顯示複核流程四步 → **匯出 content JSON**（可直接放進 `content/`） |
| `/admin/review/` | 複核區：示範佇列（含多語一級內容必審規則） |
| `/admin/due/` | 審閱到期：依 owner 分組、逾期紅、30 日內黃；一鍵「標記已審閱」示範（localStorage） |
| `/admin/todos/` | 正本修訂連動待辦（MMR 案例會自然出現在這）、反向稽核命中、翻譯過期、資料集逾期、授權缺漏 |
| `/admin/catalog/` | 資料目錄：五類資產、正本、授權、白名單狀態、篩選 |
| `/admin/glossary/` | 詞彙主檔七語、鎖定詞、同義詞 |
| `/admin/situation/` | 疫情發布表單：四級狀態、依據門檻、資料日、下次審閱 → 預覽首頁卡 → 匯出 JSON |
| `/admin/ai-status/` | 暫停／恢復開關、原因、生效時間；顯示前台效果 |
| `/admin/reports/` | 錯答回報清單（來自 localStorage）、對應 Steward |
| `/admin/eval/` | 在瀏覽器跑評估集，顯示六指標與版本題結果 |

---

## 7. 程式約定

- Node ≥ 20，ESM，零框架；依賴只有 `ajv`、`ajv-formats`、`marked`。
- 模板簽名：`export function render(ctx, props) : string`。`ctx = { site, lang, url(path), t(key, vars), today, view }`。`site = { config, collections: {diseases, faq, news, documents, clarifications, vaccines, datasets, banners, units, glossary, countries, master}, gov, situation, travel, searchIndex }`。
- HTML 由 `lib/render.mjs` 的 `html` 標籤模板產生；插值一律 `esc()`；只有 `raw()` 包起來的才不跳脫。
- 所有連結用 `ctx.url('/diseases/dengue/')` 取得（自動加 basePath 與語言前綴）；client 端用 `window.CDC.url()`（讀 `<html data-base>`）。
- CSS：只用 `tokens.css` 的變數；class 命名 `c-卡片名__元素 --修飾`；狀態色固定：`--status-stable`（綠）、`--status-rising`（琥珀）、`--status-peak`（紅）、`--status-declining`（藍）；治理層色：預設層灰小字、狀況層黃／紅、按需層 details。
- 無障礙：每頁一個 `<h1>`、`<main id="main">`、skip link、`details/summary` 做收合、所有互動可鍵盤操作、對比 ≥ 4.5:1、`aria-live` 給答案區。
- 不放真人姓名、不放真實電話以外的個資；疫情「數字」若非來自快照／live，一律標「示意」。
- 日期格式：資料 ISO `YYYY-MM-DD`；顯示依語言。
- 測試：`tests/` 用 `node:test`；治理規則每條至少一個測試；評估集版本題必須 100% 才能 build 成功（`--check`）。
- 檔案編碼 UTF-8、LF；JSON 兩格縮排。

---

## 8. 三層露出（前端治理資訊）實作對照

| 層 | 實作 |
| --- | --- |
| 預設層 | `c-provenance`（頁首一行：權責 · 最後審閱）、`c-ai-badge`、來源編號 `<sup class="c-cite">`、`c-feedback`（有幫助／回報錯誤） |
| 狀況層 | `c-alert--overdue`（黃）、`c-alert--superseded`（紅）、`c-alert--revised`（基於正本已修訂）、`c-banner--paused`（深色） |
| 按需層 | `<details class="c-source-card">`、`<details class="c-page-data">`（本頁的資料與授權：schema、API、.md、授權）、翻譯狀態 `c-translation-badge`、態勢標籤 `c-status-tag` 的 `aria-describedby` 浮層 |
| 專業層 | `html[data-view="pro"]`：來歷條展開完整（版次、生效日、取代關係、下次審閱日）、來源卡預設展開、「引用本頁」「訂閱異動」；由頂部切換或 `?view=pro`；記 localStorage `cdc.view` |

---

## 9. 部署

`.github/workflows/pages.yml`：push main、每 2 小時排程與手動觸發 → `npm ci` → `npm test` → `npm run fetch`（只在每日 02:00 UTC 那一次與手動；抓不到用快照）→ `npm run build`（含 `--check`）→ upload `dist/` → deploy-pages。basePath 由 `BASE_PATH` 環境變數決定（Pages 為 `/new_cdc_prototype`）。

---

## 10. 多人／多 agent 平行開發約定（重要）

- **模板自動登錄**：`scripts/lib/pages.mjs` 會掃描 `src/templates/{public,pro,admin}/*.mjs`（底線開頭的檔案除外）。每個模板模組匯出 `pages(site)` 宣告自己要輸出哪些路徑與語言，不需要改任何共用登錄檔。簽名見該檔案頂部註解。
- **後台自訂版面**：模組可匯出 `layout(ctx, pageProps)` 取代預設 layout（例如 `src/templates/admin/_layout.mjs` 由各後台頁 re-export）。
- **JSON-LD**：模板呼叫 `jsonLdFor(ctx, item)`（`scripts/lib/jsonld.mjs`），把結果放進 `meta()` 回傳的 `jsonLd` 陣列。
- **各自的輸出目錄**：平行建置時用 `DIST_DIR=/tmp/xxx node scripts/build.mjs`，避免互相刪掉 `dist/`。驗證用 `node scripts/build.mjs --check`（不輸出檔案）。
- **檔案所有權**（誰改哪裡，避免衝突）：
  - A 治理／API／SEO：`scripts/lib/governance.mjs`、`emit-api.mjs`、`emit-seo.mjs`、`jsonld.mjs`、`scripts/lib/openapi.mjs`、`tests/**`
  - B 內容語料：`content/**`、`data/snapshots/**`、`scripts/fetch-data.mjs`（不得改 `content/governance/eval-set.json`，那是 D 的）
  - C 民眾端：`src/templates/layout.mjs`、`src/templates/public/*`（developers、guide、transparency 除外）、`src/styles/{tokens,base,components}.css`、`src/client/{ui,i18n,charts}.js`
  - D 答案引擎：`src/client/answer/**`、`src/styles/answer.css`、`scripts/lib/index-builder.mjs`、`eval/**`、`content/governance/eval-set.json`
  - E 後台：`src/templates/admin/**`、`src/client/admin/**`、`src/styles/admin.css`
  - F 專業專區／開發者／指南：`src/templates/pro/**`、`src/templates/public/{developers,guide,transparency}.mjs`、`src/client/pro.js`、`docs/**`、`README.md`
- 要用到別人的東西而它還不存在：先寫最小 stub 在**自己的**檔案裡，或在 prompt 回報，不要去改別人的檔案。
- 不要 `git commit`／`git push`；由整合者統一提交。
- 中文正本文字請用台灣用語；不放真人姓名與個資。

---

## 11. 第二輪擴充（2026-10-02）：宣導視覺、影音、專區與機關型區塊

> 動機：現行官網首頁有大 Banner 輪播、YouTube 影片輪播、小 Banner 專區連結列，以及「人才招募、採購公告、資料申請、研究計畫、出版品、檢驗、通報、署長信箱、疾管署介紹」等機關型區塊。全部納入，但照同一套治理欄位，且**首屏仍以問題框與疫情狀態為先**。

### 11.1 新增內容型別（schemas/ 已就位；`content/` 子目錄：media、topics、services、publications、labtests、research）

| 型別 | 路徑 | 用途 | 治理重點 |
| --- | --- | --- | --- |
| `media` | `/media/{id}/` | 影片、動畫、Podcast | **必填 `basedOn` 與 `transcriptMarkdown`**；`producedAt` 早於正本現行版 `effectiveAt` ⇒ 自動加註「本影片依 {basedOnVersionLabel} 製作，建議已於 {revisedAt} 修訂」、退出白名單、待辦；逐字稿進索引（可引用到影片＋章節時間）與反向稽核 |
| `topic` | `/topics/{slug}/` | 專區／專題（防災須知、PrEP、匿名篩檢、抗生素抗藥性…）取代小 Banner 列 | `endAt` 到期自動從首頁列退場；`links[]` 外部連結由 `scripts/fetch-data.mjs --check-links` 在 CI 做 HEAD 檢查，`status: broken` ⇒ 待辦 `link-broken` |
| `service` | `/apply/{slug}/` | 申請／服務：個案資料申請、檢驗委託、接種證明（黃皮書）、疫苗基金捐款、旅遊醫學門診、研究資料申請… | 步驟、應備文件、處理天數、法源、表單；JSON-LD `GovernmentService` |
| `publication` | `/publications/{id}/` | 疫情報導（1985 起卷期）、年報、手冊、海報 | 書目（ISBN、GPN、版次）；`reviewPeriodMonths: 0`（出版品不逾期，是紀錄）；JSON-LD `PublicationIssue`／`Book`；RSS `feeds/publications.xml` |
| `labtest` | `/lab/{id}/` | 檢驗項目結構化表：疾病 × 檢體 × 容器 × 保存運送 × 時限 × 檢驗單位 | 專業版索引以「結構化句」入索引（「登革熱急性期血清：2–5 mL，發病 7 日內，4°C 冷藏 48 小時內送達」）；`sendWithinHours` 與主檔 `notifyWithinHours` 一致性檢查 |
| `research` | `/research/{id}/` | 研究計畫：年度、狀態、執行單位（機構名）、成果報告、資料集、IRB | 專業版；`projectStatus` 流轉；成果報告以 `document` 連結 |

`news` 型別新增欄位（人才招募 `recruit`、採購公告 `procurement`、其他 `other`）：`deadlineAt`、`refNo`、`applyUrl`、`positions`、`budgetNtd`。治理：`deadlineAt < today` ⇒ `gov.closed = true`、生命週期標籤「已截止」、退出首頁與 `/notices/` 進行中列表（保留在「已截止」頁籤），不產生待辦。

### 11.2 新頁面與擺放位置

| 路徑 | 內容 | 說明 |
| --- | --- | --- |
| `/`（調整） | 做法 A 右側「本期宣導」卡：主 Banner ＋ 最多 3 則輪播（不自動播、有暫停、鍵盤可操作、圖只當氛圍、文字全 HTML）；新聞下方新增「影音」三格（點擊才載入 YouTube，`youtube-nocookie`；無 id 顯示示意海報）；再下方「專區與資源」一列（`topic` 進行中者，最多 6 個）；頁尾上方「更多服務」小列（連 `/services/`） | 首屏規則不變：問題框與疫情狀態永遠在最前；流感高峰（做法 B）時宣導卡退到態勢卡下方 |
| `/campaigns/` | 全部宣導 Banner：進行中／即將開始／已結束，每則顯示權責單位、上下架日、CTA、關聯內容 | 治理可見：這就是 Banner 的「資料目錄」 |
| `/media/`、`/media/{id}/` | 影音庫（依疾病／任務／語言字幕篩選）；詳頁：點擊載入播放器、章節、逐字稿（可搜尋、可複製）、依據正本與版本標示、狀況層加註、相關頁面 | 7.7 第 4 點：畫面與說明欄標「依 … 版製作」；逐字稿是 AI 唯一可引用的影片內容 |
| `/topics/{slug}/` | 專區頁：簡介、連結（內部／外部標示、最後檢查日、失連警示）、相關內容 | |
| `/services/` | 「應用專區」八圖示入口（通報、檢驗、宣導素材、統計專區、申請、研究、出版品、疫苗基金）給專業與研究媒體；同一列也放在 `/pro/` | 民眾首頁只放「更多服務」一行，不放八圖示（先期構想：民眾腦中沒有應用專區） |
| `/apply/`、`/apply/{slug}/` | 申請專區：依對象（民眾／醫療院所／研究者／地方衛生局）分組；詳頁為步驟式 checklist | |
| `/publications/`、`/publications/{id}/` | 出版品：疫情報導依卷期瀏覽、年報、手冊、海報；書目完整；篇目列表 | |
| `/lab/`、`/lab/{id}/` | 檢驗專區（專業）：檢驗項目表（可依疾病、檢體、檢驗單位篩選）、認可檢驗機構說明、送驗單、檢驗委託 → `/apply/` | |
| `/report/` | 通報專區（專業）：**法定傳染病通報時限表由 `master/diseases.json` 自動產生**（類別、時限、病例定義連結、檢驗項目連結），通報系統（NIDRS）、流程、法規、表單；民眾：疑似群聚請撥 1922 | 零維護：主檔改了表就改 |
| `/research/`、`/research/{id}/` | 研究計畫：年度、狀態篩選；詳頁含成果報告、資料集、IRB、相關出版品；研究資料申請 → `/apply/` | |
| `/notices/`（頁籤：人才招募／採購公告／其他訊息／已截止）、`/news/{id}/` | 用 `news` 型別 `newsType` 區分；每則顯示截止日倒數、字號、報名／投標外部連結 | |
| `/about/`（擴充為 hub） | 署介紹：使命與法定職掌、**組織架構由 `master/units.json` 自動產生**（每單位：職掌、Steward、負責內容數、白名單數——來自 `site.gov.byOwner`）、六區管中心與轄區、歷史沿革、署長（職稱與職掌，不放真名）、聯絡資訊、官網改版小組（既有） | |
| `/contact/` | 署長信箱（原型：表單分類→自動對應權責單位→預覽信件→`mailto:` 或複製；明示個資處理與 1922 分流；回報 AI 錯答另走答案頁回報鍵）、1922、各單位聯絡 | 正式環境接署內表單系統 |

### 11.3 索引與答案引擎

- 民眾索引新增：`media`（逐字稿分章節切塊，`url` 帶 `#t=秒數`）、`topic`（簡介）、`service`（步驟每步一句、應備文件、處理天數）、`publication`（摘要）。
- 專業索引新增：`labtest`（每個檢體一塊，結構化句）、`research`（摘要）、`notice`（通函以外不入）。
- 意圖新增：`apply`（怎麼申請、要帶什麼、幾天）、`lab`（檢體、容器、送驗，專業）、`notify`（通報時限，可從主檔直接回答：「{疾病}為第{類}類法定傳染病，應於 {N} 小時內通報」—— 結構化回答，不走檢索）。
- 評估集新增 ≥ 25 題（apply 8、lab 6、notify 6、media 版本題 3、notice 2）。

### 11.4 後台

- 上架表單型別新增六種；影音型別強制 `basedOn` 與逐字稿欄位，預處理對逐字稿做反向稽核與數字一致性。
- 資料目錄五類資產補「新聞稿」「影音宣導素材」兩類（7.7 第 1 點）。
- 待辦新頁籤：`link-broken`、`media-outdated`。
- 儀表板新增：影音有逐字稿比例、影音依據正本現行比例、專區外部連結健康度、公告已截止未封存數。

### 11.5 所有權（第二輪）

- A2 治理／API／SEO：`scripts/lib/{governance,emit-api,emit-seo,jsonld,openapi}.mjs`、`scripts/fetch-data.mjs`（連結檢查）、`tests/**`
- B2 內容：`content/{media,topics,services,publications,labtests,research,news,pages,banners}/**`、`src/public/img/**`（SVG 示意圖）
- C2 民眾端／專業端模板：`src/templates/public/*`（含新頁）、`src/templates/pro/*`、`src/templates/layout.mjs`、`src/styles/*`（answer.css、admin.css 除外）、`src/client/{ui,i18n,charts,pro}.js`
- D2 引擎：`src/client/answer/**`、`src/styles/answer.css`、`scripts/lib/index-builder.mjs`、`eval/**`、`content/governance/eval-set.json`
- E2 後台與文件：`src/templates/admin/**`、`src/client/admin/**`、`src/styles/admin.css`、`docs/**`、`README.md`、`src/templates/public/guide.mjs`

## 12. 第四輪（2026-10-02）：國際旅遊疫情建議「目的地決策」改版

背景：官方 `CountryEpidLevel/ExportJSON` 是歷次警示**事件**（第一／二／三級或「解除」），不是現行表。`scripts/fetch-data.mjs` 以「每國×疾病×區域最新一則、解除即不列」聚合，CI 排程把快照 commit 回 `data/snapshots/`（repo 內的快照＝真實官方資料，`meta.mode: 'live'`）。實測 2026-10：第三級 1、第二級 29、第一級 215 國；第一級中 245 筆是 2023-11-01 全面重發的「新冠併發重症」，屬**背景提醒**而非針對性建議。

本輪四件事（先 2+3，再 1+4，全部實作）：
1. **目的地優先**：`/travel/` 的主角是「查目的地」，等級表退為索引；每個有 ISO2 的國家都有 `/travel/{ISO2}/`（主檔擴充至官方資料出現的全部國家）。
2. **背景提醒 vs 針對性建議**：同一疾病同一等級涵蓋 ≥ 50% 國家 ⇒ 背景提醒，表上不逐國列，改成一句「全球背景提醒」；各國的排序與卡片用「針對性等級」。
3. **變化而非狀態**：近 30／90 天的新增、調升、調降、解除（來自事件流），首頁與 `/travel/` 顯示「近 30 天：新增 n、調升 n、調降 n、解除 n」。
4. **世界地圖**：三級三色（第一級極淡）、無建議留白、點國家進目的地頁；鍵盤可達、有文字替代（等級表）。

### 12.1 資料契約（T1 擁有）

`data/snapshots/country-epid-level.json`（既有，增欄；舊欄位全部保留）：
```
data[] 每國一筆：
  ISO2, Country, CountryEn, Region, Url
  LevelCode / Level / Disease / StartDate / Summary   ← 既有：含背景提醒的最高等級（不改，API 相容）
  TargetedLevelCode (0–3) / TargetedLevel / TargetedDisease / TargetedStartDate  ← 新：排除背景提醒後的最高等級；排序、卡片、地圖、等級表一律用這組
  Diseases[]: { Disease, DiseaseEn?, DiseaseId?, Level, LevelCode, StartDate, Area?, Summary, Url, Background?: true }
meta 新增：
  background[]: { Disease, DiseaseId?, LevelCode, Level, countries: n, share: 0–1, since: 最早 StartDate, latest: 最新 StartDate, Summary }
  backgroundRule: { share: 0.5, note }
  stats: 既有 levelStats（含背景）+ targeted: { level3, level2, level1, none }
  changeSummary30: { new, raised, lowered, lifted, renewed }   ← 由事件快照推得；無事件快照時省略
```
`data/snapshots/country-epid-events.json`（新；CI 每日覆寫並 commit）：
```
meta: { mode: 'live'|'derived', fetchedAt, sourceUrl, windowDays: 400, note }
data[] 事件（slim，依 date 降冪）：
  { date: 'YYYY-MM-DD', ISO2, Country, CountryEn?, Disease, DiseaseId?, Area?: string|null,
    LevelCode: 0–3 (0＝解除), Level, Summary?, Url,
    kind: 'new'|'raised'|'lowered'|'lifted'|'renewed', from: 0–3|null, to: 0–3 }
```
`kind` 推法：同（ISO2, Disease, Area）依 date 排序，前一則等級 from → 本則 to：from null/0 且 to>0 ⇒ new；to>from ⇒ raised；0<to<from ⇒ lowered；to=0 ⇒ lifted；to=from ⇒ renewed。
離線時 `npm run fetch -- --reaggregate`：不連網，只用既有快照重算 meta.background、Targeted*、changeSummary30，並把事件快照以 `mode:'derived'`（從現況每筆建議反推一則 new 事件）補出來，讓模板與測試在任何環境都有資料。

`content/master/countries.json`：擴充為官方資料中所有有 ISO2 的國家／地區（≈231）＋原 60 國；欄位 `{ iso2, name, nameEn, region }`，region 用現有十個區域名；原 60 國順序與內容不變、排在前面。

API（`scripts/lib/emit-api.mjs`）：`/v1/country-levels.json` 原樣輸出 data（含新欄）；新增 `/v1/country-changes.json`（事件快照 data + meta）、`/v1/country-background.json`（meta.background）。`site.snapshots.countryEvents` 由 `load.mjs` 讀入。

答案引擎（`src/client/answer/core.js`）：`travelFor` 的逐病清單**排除** `Background: true`，另外加一句「全球背景提醒：{疾病} 第一級，遵守一般預防措施」；國家無針對性建議時說「目前無針對性旅遊疫情建議」。評估集新增 TR010–TR012（韓國無針對性建議、剛果第三級伊波拉、近期解除）。

### 12.2 呈現契約（T2 擁有：`travel.mjs`、`task.mjs`、`home.mjs`、`i18n.js`；T3 擁有：`_travel-map.mjs`）

`/travel/`（由上到下）：
1. 標題＋一句話；**查目的地**（既有 lookup，放最上、放大）。結果卡用 Targeted 等級；背景提醒只在卡末一行淡字。
2. **近 30 天變化**：四個數字（新增／調升／調降／解除）＋最多 10 則清單（日期、國家→連結、疾病、from→to），「解除」用安心的綠色；更多收合。
3. **世界地圖**：`worldMap(ctx, { byIso: Map<ISO2, {code, label}>, hrefFor })` 來自 `./_travel-map.mjs`（T3）；T2 只呼叫，不改其內容。地圖下方放三級圖例與「未上色＝目前無針對性建議」。
4. **全球背景提醒**一列（meta.background，每項一句：疾病、等級、自何時、涵蓋 n 國、建議）。
5. **針對性建議等級表**：既有三段式，但只列 `Background` 不為 true 的項目；每項 chip 加 title「自 YYYY-MM-DD」；段落摘要用 targeted 統計。
6. 近 30 天國際重要疫情資訊（既有）、提問框、來源卡（既有）。

`/travel/{ISO2}/`（目的地頁）：
1. 卡片：Targeted 最高等級（無則綠勾「目前無針對性旅遊疫情建議」）；逐病列：等級、發布日、**持續時間**（「自 2015 年起 · 11 年」；超過 3 年加「長期建議」標籤）、官方建議句、疾病頁連結。
2. **旅程三階段**（純規則生成，不手寫）：出發前（依疾病主檔的 vaccines → 疫苗與 2–4 週旅醫門診；無疫苗則衛教）、旅途中（依疾病傳播途徑：蚊媒→防蚊；飛沫→口罩洗手；動物→避免接觸；食水→飲食）、返國後（21 天內發燒／出疹就醫並告知旅遊史；1922）。傳播途徑以疾病主檔 `transmission`／`keywords` 判斷，缺則用一般預防措施。
3. 近 30 天與該國有關的國際重要疫情資訊（`travelAlerts` 的 areaDesc／areaDesc_EN 含該國名或 ISO2）。
4. 背景提醒一行淡字；相關疫苗、旅醫門診預約、國際預防接種證明（既有）。
5. 每頁 JSON-LD 與 `.md` 機讀版照既有做法。

`task.mjs`（出國與入境任務頁）：12 列表格換成「查目的地」＋近 30 天變化四數字。`home.mjs`：任務卡「出國與入境」副標顯示針對性統計一句（例：「29 國有針對性建議 · 近 30 天解除 12 筆」）。七語 i18n 全部補齊（`ROWS_TRAVEL`）。

### 12.3 地圖契約（T3 擁有）

- `scripts/gen-world-map.mjs`（開發期一次性，devDependencies：`world-atlas`、`topojson-client`、`d3-geo`、`i18n-iso-countries`）→ 產生 `src/data/world-paths.json`：`{ viewBox: '0 0 960 500', projection: 'naturalEarth1', paths: { ISO2: 'M…Z' } }`，110m 簡化，數值取整到 1 位小數，不含南極洲；檔案 ≤ 250 KB。產物 commit 進 repo，建置不需 devDeps。
- `src/templates/public/_travel-map.mjs`：`export function worldMap(ctx, { byIso, hrefFor, title })` 回傳 inline SVG：`<svg role="img" aria-labelledby>`；每國 `<a href=…><path class="wm wm--l{0-3}" data-iso><title>{國名}：{等級}</title></path></a>`（無頁面者不包 `<a>`）；三色沿用 travel 的 `--tv-watch/alert/warning`，第一級用 15% 透明度；無建議 `fill: var(--line-2)`；台灣 `fill: var(--ink-3)` 中性。hover／focus 加描邊；行動裝置寬度 100%、`aspect-ratio: 960/500`。CSS 放在同檔以 `<style>` 輸出一次（`styles` 匯出供 travel.mjs 併入）。
- `tests/travel-map.test.mjs`：paths ≥ 170 國；主檔 60 國全部有 path；輸出含 60 個 `<a href="/travel/…/">`；無 `href="null"`。

### 12.4 平行開發分工與邊界

- T1（資料／引擎／測試）：`scripts/fetch-data.mjs`、`scripts/lib/{load,emit-api}.mjs`、`src/client/answer/core.js`、`content/governance/eval-set.json`、`content/master/countries.json`、`data/snapshots/country-epid-events.json`、`data/snapshots/country-epid-level.json`（只透過 `--reaggregate` 產生）、`tests/travel.test.mjs`（修既有 5 個失敗測試＝改成對真實資料穩健）、`tests/travel-data.test.mjs`、`src/templates/public/developers.mjs`（只加 API 清單列）。
- T2（模板）：`src/templates/public/{travel,task,home}.mjs`、`src/client/i18n.js`（`ROWS_TRAVEL` 區塊）、`src/styles/*`（如需）、`docs/guide-public.md`、`tests/travel-ui.test.mjs`。對 T1 新欄位一律容錯（缺欄位時退回既有行為）。
- T3（地圖）：`scripts/gen-world-map.mjs`、`package.json` devDependencies、`src/data/world-paths.json`、`src/templates/public/_travel-map.mjs`、`tests/travel-map.test.mjs`、`docs/architecture-decisions.md`（新增 ADR）。**第一步**先建立 `_travel-map.mjs` 的空實作（回傳 ''）讓 T2 可以匯入。
- 共同：不切分支、不 commit；完成後回報變更檔案清單與驗證結果。`npm test` 與 `BUILD_TODAY=2026-10-01 LINK_CHECK=error npm run build` 必須全綠（`[links] error 0`）。

## 13. 第五輪（2026-10-02）：舊站內容移轉示範（結核病專區）、舊網址不 404、規劃回補

目的：讓同事看到「舊網站上架的內容不會不見、都會移轉，而且擺法更現代、有治理要求、看得到舊網址對應」；同時解決搜尋引擎還記得舊網址的問題。以結核病為第一個完整示範，做法要能套到其他 98 種疾病與所有欄目。

> 限制：開發環境連不到 www.cdc.gov.tw，舊站結核病專區的子頁清單依規劃文件 §1.2 的 URL 模式與對官網的既有認識重建；每筆舊頁在清單中標 `verified: false`，由權責單位在後台「移轉對照」逐筆確認後改 true。舊網址 ID 不確定者保留 URL 模式、ID 以 `{id}` 佔位（legacyUrls 不受佔位網址檢查）。

### 13.1 移轉清單（migration manifest）資料契約（V1 擁有）

`content/migration/{slug}.json`（type `migration`，schema `schemas/migration.json`，一份清單對應舊站的一個專區／欄目樹）：
```
{
  id: 'migration.tuberculosis', type: 'migration', title: '結核病專區（舊站）→ 新站',
  scope: { kind: 'disease', disease: 'disease.tuberculosis' },   // 或 { kind: 'category', name: '…' }
  owner, reviewedAt, reviewPeriodMonths, status, audience, sensitivity, license, languages, aiWhitelist  // 既有治理欄位照 _common
  legacyRoot: 'https://www.cdc.gov.tw/Disease/SubIndex/{id}',       // 舊專區入口
  showLegacyUntil: '2027-12-31',                                      // 新站頁面顯示「舊網址對應」的截止日（過期自動隱藏，不需人工）
  items: [{
    key: 'intro',                                  // 清單內唯一
    oldTitle: '疾病介紹',                           // 舊站標題
    oldPath: '疾病介紹',                            // 舊站麵包屑／階層（以「／」分隔）
    oldUrl: 'https://www.cdc.gov.tw/Disease/SubIndex/{id}#intro',
    oldType: 'page'|'qa'|'pdf'|'news-list'|'media'|'list'|'external',
    verified: false,
    status: 'migrated'|'merged'|'archived'|'pending'|'dropped',
    target: 'disease.tuberculosis'|'doc.tb-guideline'|…,           // 新站內容 id（migrated／merged 必填）
    anchor: 'symptoms',                            // 選填：新頁內錨點
    note: '併入疾病頁「症狀」區塊',                  // 給同事看的說明
    newRequirements: ['owner','reviewedAt','basedOn','machineReadable','languages']  // 這筆移轉後新增的治理要求（展示用）
  }]
}
```
治理引擎（governance.mjs）：
- `site.migration = { lists: [...], byTarget: Map<contentId, items[]>, stats: { migrated, merged, archived, pending, dropped, verified, total }, pending: items[] }`。
- `status: 'pending'` 且 owner 存在 ⇒ 待辦 `migration-pending`（中優先，說明：舊頁尚未移轉）；`verified: false` 不開待辦，只在後台列出。
- 以 `target` 反向建立 `item.gov.legacy = { urls: [...oldUrl], items: [...] }`，模板用它顯示「此頁取代舊網站的 N 個頁面」。`today > showLegacyUntil` ⇒ `gov.legacy.show = false`。
- validate：target 必須存在（pending／dropped 除外）；key 唯一；status enum。

轉址輸出（emit-api.mjs，沿用 `buildRedirects`）：
- `redirects.json` 新增 `kind: 'migration'` 項（from = oldUrl 去掉網域後的 path+query+hash 去 hash；to = target 路徑＋anchor），`verified` 一併輸出；`{id}` 佔位的 from 以 `pattern: true` 標示，不進伺服器對照檔，只進文件。
- 新增三種伺服器格式（純由 redirects.json 轉出，不含 pattern 項）：`redirects/nginx.map`（`~^/Disease/SubIndex/xxx$ /diseases/tuberculosis/;`）、`redirects/web.config.rewritemap.xml`（IIS rewriteMap）、`redirects/_redirects`（Netlify／Cloudflare Pages 格式 `from to 301`）。
- `v1/legacy-map.json`：精簡版 `{ "/Disease/SubIndex/xxx": "/diseases/tuberculosis/", … }` 給 404 頁與 `/legacy/` 查詢頁用（path 比對不含網域、不分大小寫、忽略尾斜線與 query 的 page 參數）。

`scripts/analyze-404-log.mjs`：讀伺服器 access log（Nginx combined 或 IIS W3C，自動判斷），抓 404 的路徑與次數，對照 legacy-map 與 migration 清單：已有對照 ⇒ 列「可直接 301」；符合舊站 URL 模式但無對照 ⇒ 列「待補對照」並產生可貼進 migration JSON 的 items 草稿；其餘列「真的不存在（建議 410）」。輸出 Markdown 報表到 stdout。附 `tests/fixtures/access-404.log` 範例。

### 13.2 結核病內容回補（V1 擁有）

依舊站結核病專區重建內容（全部走既有型別，不新增型別；每筆都要有完整治理欄位、`legacyUrls`、`basedOn` 視情況）：
- 疾病頁 `content/diseases/tuberculosis.json`：補齊 blocks（致病原、流行病學、潛伏期、傳染方式、症狀、預防、診斷治療、卡介苗、就醫與補助、統計），`professional` 補 `programs`（都治 DOTS、潛伏結核感染 LTBI、接觸者檢查、抗藥性結核病醫療照護體系、2035 消除結核、高風險族群篩檢：矯正機關／長照機構／移工／山地鄉）。
- 文件（版本鏈）：`doc.tb-guideline`（結核病診治指引，兩版：舊版 superseded＋現行版，含 changes）、`doc.ltbi-guideline`（潛伏結核感染診治指引）、`doc.tb-contact-investigation`（接觸者檢查指引）、`doc.dots-manual`（都治計畫作業手冊）、`doc.tb-case-definition`（病例定義／通報定義）。既有 `doc.tb-manual` 保留。
- Q&A：至少 8 題（咳嗽兩週、潛伏感染要不要治、都治是什麼、接觸者檢查、卡介苗、抗藥性、治療費用、外籍人士健檢）。
- 專區 `topic.tb-prevention`（結核病防治專區：給專業人員與衛生局的入口，sections 連到上述文件、檢驗、通報、統計、計畫）。
- 申請服務：`service.tb-treatment-subsidy`（結核病診治費用補助／隔離治療）、`service.ltbi-treatment`（潛伏結核感染治療）。
- 新聞：補 2 則（2035 消除結核計畫、都治成效）。影音、海報、資料集、檢驗、研究既有者補 `legacyUrls`。
- 全部以 `content/migration/tuberculosis.json` 列出舊頁與對應（約 30–40 筆，涵蓋：疾病介紹各子頁、Q&A、衛教素材、法規與指引各 PDF、統計、通報定義、檢驗、都治、LTBI、接觸者、MDR、2035、高風險族群、補助、外籍健檢、相關連結、新聞列表）。

### 13.3 呈現契約（V2 擁有）

- 疾病頁（`disease.mjs`）：新增「專區導覽」sticky 子導覽（民眾：怎麼辦／症狀／傳染／預防／治療／疫苗／統計／Q&A；專業：指引與手冊／通報與檢驗／防治計畫／補助與服務／統計／研究），專業版多出的區塊從 `professional.programs`、關聯文件、服務、檢驗、研究自動帶出；任何疾病都適用，沒有資料的區塊不出現。
- **舊網址對應（三層露出）**：預設層＝頁首治理列一句「本頁取代舊網站 N 個頁面」（`gov.legacy.show` 為 true 才出現）；按需層＝`<details>` 列每筆舊標題、舊網址（外連、`rel="nofollow"`）、狀態（已移轉／已併入／已封存／待確認）與移轉後新增的治理要求（chip）；專業層＝連到 `/legacy/?u=`。元件放 `_partials.mjs` 的 `legacyDisclosure(ctx, item)`，所有型別頁都可用（文件、Q&A、專區、服務頁也要掛）。
- `/legacy/`（新頁，七語）：貼舊網址或路徑 → 查 `v1/legacy-map.json` → 顯示新頁連結；查不到 → 顯示同站搜尋與 1922；頁面說明轉址政策（301、保留期、關閉日）。
- `notfound.mjs`（404）：載入 `v1/legacy-map.json`，用目前 `location.pathname + search` 查對照；命中 ⇒ 顯示「舊網址已搬家，3 秒後帶你到新頁」並 `location.replace`（`<noscript>` 顯示連結）；未命中 ⇒ 既有 404 內容＋`/legacy/` 入口＋站內搜尋帶入路徑關鍵字。
- 後台 `/admin/migration/`：各清單進度（已移轉／併入／封存／待確認／待核對 verified），待辦連動，逐筆表格（舊標題、舊網址、狀態、對應新頁、owner），匯出對照（連到 redirects 三格式）。`/admin/` 儀表板加一張「移轉進度」卡；待辦頁加 `migration-pending` 頁籤。
- 開發者頁列出新檔；i18n 七語；`tests/migration-ui.test.mjs`；截圖 `docs/screenshots/tb-hub.png`、`legacy-lookup.png`、`admin-migration.png`。

### 13.4 文件（V3 擁有）

- `docs/migration-playbook.md`：舊站→新站移轉手冊：同網域換站的 301 策略（path 對照、301 永久、410 已移除、302 僅限版本族穩定網址）、sitemap 與 Search Console（網址異動、重新提交、涵蓋範圍報表）、canonical／hreflang、舊站唯讀保留期與頁首告示、切換日 checklist、上線後監測（404 log → `analyze-404-log` → 待辦）、何時關閉舊網址對應（`showLegacyUntil`）、常見錯誤（鏈式轉址、轉到首頁、大小寫）。
- `docs/plan-supplement.md`：規劃文件（盤點／規格／路線圖、架構、藍圖、wireframe）**沒寫到、原型做了**的新作法回補，每項：做法、為何需要、對應規劃章節、原型位置、正式上線還缺什麼。至少涵蓋：官方等級表當事件日誌＋背景提醒＋合理性閘門、CI 每日快照 commit 回 repo、建置時全站連結檢查與 `/pending/`、外部連結健康、公告截止自動退場、影音過時規則、逐字稿反向稽核、三層露出的實作細節、BYOK LLM 後檢、評估集閘門、Banner A/B 預覽、vaxmap 整合、目的地決策式旅遊頁、世界地圖、移轉清單與 404 自動轉址、404 log 分析。
- `docs/roadmap-mapping.md`：「舊網址 301」改為已示範並補說明；新增「內容移轉清單」列。`docs/guide-staff.md` 新增「15. 舊站內容移轉 SOP」。README 加第五輪段落。

### 13.5 分工與邊界

- V1（內容／資料／引擎）：`content/**`（結核病相關新舊檔、`content/migration/`）、`schemas/migration.json`、`schemas/_common.json`（type enum 加 migration）、`scripts/lib/{load,validate,governance,emit-api,openapi}.mjs`、`scripts/analyze-404-log.mjs`、`tests/fixtures/`、`tests/migration.test.mjs`、評估集可加 2 題（結核病相關）。
- V2（模板）：`src/templates/public/{disease,notfound,legacy,developers}.mjs`、`src/templates/public/_partials.mjs`（只加 legacyDisclosure）、`src/templates/admin/{migration,index,todos}.mjs`、`src/client/i18n.js`、`src/styles/*`、`tests/migration-ui.test.mjs`、`docs/screenshots/`。對 V1 的 `site.migration`／`gov.legacy` 一律容錯（缺就不顯示）。
- V3（文件）：`docs/migration-playbook.md`、`docs/plan-supplement.md`、`docs/roadmap-mapping.md`、`docs/guide-staff.md`、`README.md`。
- 共同：不切分支、不 commit；`npm test` 與 `BUILD_TODAY=2026-10-01 LINK_CHECK=error npm run build` 全綠。

## 14. 第六輪（2026-10-02）：移轉做法套用到全部疾病、國際合作區塊

> 限制同 §13：連不到 www.cdc.gov.tw 與 /En。英文站「International Cooperation」的子頁依既有認識重建並標 `verified: false`。

### 14.1 移轉清單規模化：由模板推導，人工只寫例外（W1 擁有）

目標：99 種疾病不可能各寫一份 40 筆的清單。舊站每個疾病頁的子頁結構相同，所以：
- `content/migration/_disease-template.json`：舊站疾病頁的標準子頁樹（type `migration-template`）：疾病介紹（致病原、流行病學、傳染方式、潛伏期、發病症狀、預防方法、治療方法與就醫資訊）、預防接種建議、Q&A、衛教宣導（單張海報／影片）、法規與指引（工作手冊、病例定義、治療指引）、統計資料、檢驗資訊、通報定義、新聞稿列表、相關連結。每筆：`key, oldTitle, oldPath, oldUrlPattern（含 {id}）, oldType, mapTo`。
  `mapTo` 描述「新站哪裡有對應就算移轉」：`{ kind: 'disease-block', block: 'symptoms' }`｜`{ kind: 'related', type: 'faq'|'document'|'media'|'labtest'|'dataset'|'news'|'publication', docType?: 'manual'|'case-definition'|'guideline' }`｜`{ kind: 'master-field', field: 'notifyWithinHours' }`｜`{ kind: 'page', path: '/report/' }`。
- 治理引擎對**主檔每一種疾病**推導一份清單（`derived: true`）：有疾病頁且 mapTo 命中 ⇒ `merged`（block／master-field）或 `migrated`（related 命中，target 為該內容 id）；疾病頁存在但 mapTo 未命中 ⇒ `pending`；疾病頁不存在 ⇒ 整份清單 `status: 'no-page'`，所有項目 `pending`。
- `content/migration/{slug}.json`（人工清單，如結核病）存在時**覆蓋**推導結果：同 key 以人工為準，人工沒寫的 key 仍由模板補（這樣結核病清單也會自動補上模板有而人工沒列的項）。人工清單可用 `extends: 'migration-template.disease'` 明示。
- 待辦聚合：每份清單只開**一則** `migration-pending` 待辦（「{疾病}：N 個舊頁待移轉」），no-page 清單則為「{疾病}：疾病頁尚未建立，N 個舊頁待移轉」，優先度依法定類別（第一、二類高）；不再逐筆開。
- `site.migration.stats` 加 `lists, derived, curated, noPage`；`byDisease` Map。輸出 `v1/migration/index.json`（各清單摘要）、`v1/migration/{slug}.json`（完整清單，含 derived 標記），同事可下載成人工清單起點。
- redirects／legacy-map：推導清單的 oldUrlPattern 都是 `{id}` 佔位 ⇒ 全部 `pattern:true`，不進伺服器檔；`/legacy/` 的模式比對仍可用。
- 測試：72 種疾病都有清單；16 個有頁的疾病 stats 合理；結核病人工清單覆蓋模板；no-page 一則待辦；override 合併規則。

### 14.2 內容來源語言 `sourceLang`（W1 擁有）

國際合作區塊在舊站只有英文版，新站要讓英文是**來源語言**、中文是譯文，治理規則照常運作：
- `_common.json` 新增選填 `sourceLang`（enum 七語，預設 `zh-TW`）。規則：`languages[sourceLang].status === 'source'`；頂層欄位＝來源語言文字；其他語言放 `i18n.{lang}`，**包含 `i18n['zh-TW']`**（sourceLang ≠ zh-TW 時 zh-TW 必須有 i18n 且 `languages['zh-TW'].status` 為 reviewed／machine，不可 none：中文官網不能沒有中文）。
- `L(ctx, item, field)`（_partials）改為：`ctx.lang === (item.sourceLang ?? 'zh-TW')` ⇒ 頂層；否則 `i18n[ctx.lang]?.[field] ?? 頂層`。`langAvailable`：來源語言永遠可渲染；其他照既有規則。sourceHash／譯文過期：以來源語言頂層欄位計算（既有邏輯不變，只是語言標籤換）。index-builder／答案引擎：索引語言依 sourceLang（英文來源內容進英文索引，zh-TW 譯文進中文索引）。
- 頁面 `<html lang>`、hreflang、sitemap 既有機制不變。測試：sourceLang:'en' 內容在 /en/ 用頂層、在 zh-TW 用 i18n、缺 zh-TW i18n 建置失敗。

### 14.3 國際合作區塊內容（W1 擁有）

全部 `sourceLang: 'en'`，附 zh-TW reviewed 譯文（ja 可選）。owner 用既有單位 `unit.planning`（企劃組，國際合作為其業務；疾管署沒有獨立的國際合作組）（看 content/master/units 的格式）。
- `topic.international-cooperation`（International Cooperation 入口；sections 連下列各頁）。
- `page.*`（type page）：`ihr-focal-point`（IHR National Focal Point：24/7 窗口、事件通報、WHO 聯繫方式；基於 IHR 2005）、`multilateral`（WHA／WHO 技術會議、APEC Health Working Group、GHSA、全球疫情警報與反應網路）、`bilateral`（雙邊 MOU 與合作：美、日、歐盟、東南亞與新南向夥伴；表格：國家／機構、合作主題、簽署年、狀態）、`training`（Taiwan CDC 國際訓練：FETP、實驗室、都治／結核、登革熱防治工作坊；申請方式、年度場次）、`global-health-security`（抗藥性、疫苗、邊境檢疫合作）、`publications-en`（Taiwan Epidemiology Bulletin、英文年報：連既有 publication）。
- `news.*` 英文新聞 3 則（sourceLang en）：MOU 簽署、研習營開訓、WHA 技術會議參與。
- `service.international-training-application`（外國衛生人員申請訓練：步驟、表單、聯絡窗口）。
- 評估集 +3：英文題「How do I contact Taiwan's IHR focal point?」「How can foreign health officials apply for Taiwan CDC training?」與中文題「疾管署有哪些國際合作？」。
- migration 清單 `content/migration/international-cooperation.json`：舊英文站 /En 的 International Cooperation 子頁（約 10–12 筆，`legacyRoot: 'https://www.cdc.gov.tw/En/Category/List/{id}'`，`scope: { kind: 'category', name: 'International Cooperation', site: 'en' }`），全部 verified:false。

### 14.4 呈現（W2 擁有）

- `/international/`（lang:'*'，但只在有譯文的語言輸出；zh-TW 與 en 一定有）：英文為來源的設計：頁首顯示「本頁以英文為準，中文為譯文」（zh-TW）／「English is the authoritative version」（en）＝ 既有譯文狀態列的反向用法；區塊：IHR 窗口卡（電話／信箱／24 小時）、多邊與雙邊（雙邊 MOU 表格＋夥伴地圖：重用 `_travel-map.mjs`，加選填 `classOf(iso)`／`legend` 讓顏色與圖例可自訂，不用 travel 等級語意）、訓練與申請、出版品、英文新聞、聯絡窗口。子頁沿用 page 模板但加區塊導覽。
- 導覽：主選單不加（八項已滿）；放在「研究與媒體」入口頁與 footer 的「關於疾管署」群組，en 版主選單加 International Cooperation（英文站使用者習慣）；`/about/` 加連結。
- 疾病頁專區導覽套到全部疾病：用 16 個疾病頁與 3 個無頁疾病的連結全部跑過（測試），任何疾病都不可出現空白區塊或 `undefined`。
- 後台 `/admin/migration/`：72＋ 份清單：摘要表（疾病、法定類別、頁面有無、已移轉／併入／待移轉、進度條、人工／推導標記、下載 JSON）、依「待移轉最多」排序、篩選（有頁／無頁／人工／推導／單位）；單一清單展開逐筆。儀表板卡改顯示整體進度與 no-page 數。
- `/legacy/`：查不到確定對照時用模式比對提示「這是舊站疾病頁的『{oldTitle}』，新站對應 {疾病} 的 {區塊}」（patterns 已有 oldTitle／to）。
- i18n 七語；`tests/round6-ui.test.mjs`；截圖 `docs/screenshots/international.png`、`admin-migration-all.png`。

### 14.5 內容與文件（W3 擁有）

- 四個主要疾病內容回補（照結核病模式，規模較小）：`dengue`（防治計畫：孳生源清除、病媒監測、群聚應變；文件：登革熱防治工作指引）、`influenza`（流感疫苗接種計畫、抗病毒藥劑使用對象；既有抗病毒文件）、`measles`（接觸者追蹤、MMR；既有 MMR 文件）、`enterovirus`（重症前兆、停課標準、教托育機構指引）。每個：`professional.programs` 2–3 項、1 份新文件或補 legacyUrls、2–3 題 Q&A、`content/migration/{slug}.json` 人工清單只寫模板沒有的例外（5–8 筆，例如疾病特有專區頁），其餘交給推導。
- 文件：`docs/guide-staff.md` 第 15 節改為「推導清單 → 只寫例外」流程；`docs/governance-model.md` 加規則 17（推導移轉清單與聚合待辦）、18（sourceLang）；`docs/plan-supplement.md` 加 3 項（推導清單、sourceLang、國際合作雙語）；`docs/migration-playbook.md` 加「規模化：99 種疾病怎麼做」一節；README 第六輪段落。

### 14.6 分工與邊界

- W1：`schemas/{_common,migration,migration-template}.json`、`scripts/lib/{load,validate,governance,emit-api,openapi,index-builder,pages}.mjs`、`src/templates/public/_partials.mjs` 的 `L()` 與 `langAvailable`（只改這兩個函式）、`content/migration/_disease-template.json`、`content/migration/international-cooperation.json`、`content/topics/international-cooperation.json`、`content/pages/international-*.json`、`content/news/*international*`、`content/services/international-training-application.json`、`content/master/units.json`（加單位）、`content/governance/eval-set.json`、`src/client/answer/core.js`（若索引語言需要）、`tests/migration-scale.test.mjs`、`tests/sourcelang.test.mjs`。
- W2：`src/templates/public/{international,disease,legacy,about,developers}.mjs`、`src/templates/public/_travel-map.mjs`（加 classOf／legend 選項，相容既有呼叫）、`src/templates/layout.mjs`（en 主選單一項、footer 連結）、`src/templates/admin/{migration,_migration,index}.mjs`、`src/client/admin/migration.js`、`src/client/i18n.js`、`src/styles/*`、`tests/round6-ui.test.mjs`、截圖。
- W3：`content/diseases/{dengue,influenza,measles,enterovirus}.json`、其新文件／Q&A 檔、`content/migration/{dengue,influenza,measles,enterovirus}.json`、`docs/*.md`、`README.md`。
- 共同：不切分支、不 commit；`npm test` 與 `BUILD_TODAY=2026-10-01 LINK_CHECK=error npm run build` 全綠。W2 對 W1 的新欄位容錯；W3 的人工清單需符合 W1 的 schema（先讀 §14.1，schema 若尚未更新就先照 §13.1 寫，W1 會相容）。

## 15. 第七輪（2026-10-04）：人才招募（人事室）與採購公告（秘書室）分家；招募生命週期與模擬報名

> 限制同前：連不到 www.cdc.gov.tw，舊站「人才招募」「採購公告」欄目依既有認識重建，移轉清單全部 `verified:false`。

### 15.1 資料契約（X1 擁有）

單位：`content/master/units.json` 新增 `unit.personnel`（人事室，Personnel Office，kind office，stewardTitle「Data Steward（人才招募、甄選結果）」）。採購公告 owner 維持 `unit.secretariat`。

**`job`（招募職缺）** `schemas/job.json`，檔在 `content/jobs/`，id `job.{yyyy-mm-dd}-{slug}`，路徑 `/careers/{slug}/`：
```
title, owner: 'unit.personnel'（固定）, hiringUnit: unit id（用人單位）, jobType: enum[約聘人員, 約僱人員, 聘用研究員, 公費醫師, 技工工友駐衛警, 公務人員商調, 計畫助理, 臨時人員],
positions: int, workplace: string, salaryNote: string（薪點／薪資範圍，文字）, qualifications: string[], duties: string[], requiredDocuments: string[],
applyStart: date, deadlineAt: date, applyMethod: enum[online, email, mail, in-person], applyUrl?: url（外部報名系統；省略＝用本站 /careers/{slug}/apply/）,
examPlan: [{ stage: enum[書面審查, 筆試, 口試, 實作, 體能], date?: date, note?: string }], resultPlannedAt?: date,
contact: string, attachments?: [{ label, url, machineReadable? }], legacyUrls?: [],
manualStatus?: enum[cancelled, filled]（人工覆蓋；其餘階段一律由日期與 result 推導）,
result?: { publishedAt: date, refNo?: string, admitted: [{ seq: int, candidateNo: string, nameMasked: string }], waitlist: [{ rank: int, candidateNo: string, nameMasked: string, validUntil?: date }], note?: string, attachments?: [] },
waitlistUpdates?: [{ date, candidateNo, nameMasked, note }]（遞補公告）
```
治理：`gov.jobStage` = upcoming（today < applyStart）｜open（≤ deadlineAt）｜closed（過截止、examPlan 尚未開始）｜screening（examPlan 有已到期日期、無 result）｜result（有 result）｜filled／cancelled（manualStatus）。**個資**：validate 強制 `nameMasked` 必須含遮罩字（○／◯／〇／＊），且不得含 3 個以上連續中文字的完整姓名樣式；candidateNo 不得像身分證字號（`^[A-Z][12]\d{8}$` 擋下）。result 區塊 `sensitivity` 視為 public 但 AI 白名單**排除 result 與 waitlistUpdates**（答案引擎不得唸出名單，只能給連結）。待辦：`job-result-overdue`（today > resultPlannedAt + 7 且無 result，owner 人事室、抄 hiringUnit，中優先）、`job-waitlist-expiring`（備取 validUntil 14 天內，低）、`job-apply-url-dead`（applyUrl 外部連結失效，沿用外部連結健康）。已截止職缺自動退出首頁與開放中清單（沿用公告截止邏輯）；result 後 90 天自動移入「歷史」。

**`tender`（採購公告）** `schemas/tender.json`，檔在 `content/tenders/`，id `tender.{yyyy-mm-dd}-{slug}`，路徑 `/procurement/{slug}/`：
```
title, owner: 'unit.secretariat'（固定）, requestingUnit: unit id, tenderNo: string, method: enum[公開招標, 限制性招標, 公開取得報價或企劃書, 共同供應契約], budgetNtd: int, category: enum[財物, 勞務, 工程],
announcedAt, deadlineAt（投標截止）, openingAt?（開標）, pccUrl?: url（政府電子採購網）, attachments?, contact, legacyUrls?,
manualStatus?: enum[cancelled, failed（流標）], award?: { date, winner, amountNtd?, note? }
```
`gov.tenderStage` = open｜closed（過截止、未開標）｜opened（過 openingAt、無 award）｜awarded｜failed／cancelled。待辦 `tender-award-overdue`（openingAt + 30 天無 award 且非 failed／cancelled）。

既有 9 則 recruit／procurement 新聞 → 轉成 job／tender 檔（原 id 放進 `legacyIds` 以保留 301：`redirects.json` 加 `kind:'moved'`，舊 `/news/{slug}/` → 新路徑），`schemas/news.json` 的 newsType 移除 recruit／procurement。至少做到：職缺 8 筆涵蓋 upcoming、open（3，含 1 筆外部 applyUrl）、closed、screening、result（2，含備取與 1 筆遞補）、cancelled；採購 7 筆涵蓋 open、closed、opened、awarded（2）、failed。

輸出：`/v1/jobs.json`、`/v1/tenders.json`（含 stage）、RSS `feeds/careers.xml`、`feeds/procurement.xml`（錄取結果與決標各自是一筆 feed 項）、JSON-LD `JobPosting`（title、datePosted、validThrough、employmentType、hiringOrganization、jobLocation、applicantLocationRequirements 省略、baseSalary 以文字 description 代替）、tender 用 `GovernmentService`＋`Offer`（簡化）。sitemap 加入；`.md` 機讀版。答案引擎：意圖 `careers`（「疾管署有缺嗎」「怎麼報名」「截止日」）→ 結構化列開放中職缺與截止；問「誰錄取」→ 不唸名單，給結果頁連結並說明只公布報名編號與遮罩姓名；評估集 +3。移轉清單 `content/migration/careers.json`、`content/migration/procurement.json`（scope category，各 6–8 筆）。

### 15.2 呈現契約（X2 擁有）

- `/careers/`：頁首「加入疾管署」一句＋開放中職缺卡（倒數天數、職稱、用人單位、名額、地點、報名方式、線上報名按鈕）；篩選（職類／地點／單位）；分頁籤：開放中／即將開放／審查與甄試中／錄取結果／歷史；訂閱（RSS 連結＋既有訂閱頁）；人事室聯絡。
- `/careers/{slug}/`：**時間軸**（公告→報名截止→甄試→結果→遞補）標示目前階段；區塊：工作內容、資格條件、薪資待遇、應備文件、甄試方式與日期、報名方式（open 顯示大按鈕「線上報名」或外部連結；closed 顯示「已截止，結果預計 {date} 公布」）、聯絡、附件、舊網址揭露；有 result 時「甄選結果」區：正取／備取表（序號、報名編號、遮罩姓名、備取有效期）、遞補紀錄、報到須知、結果公告日；頁首 pill 顯示階段。
- `/careers/{slug}/apply/`（**模擬線上報名**，只在 open 且無外部 applyUrl 的職缺輸出；closed 輸出「已截止」頁）：明顯橫幅「原型示範：資料只存在你的瀏覽器，不會送出」；三步驟（基本資料與聯絡方式／學經歷與應備文件（檔案只列檔名不上傳）／聲明與個資告知事項同意→確認）；即時驗證與錯誤摘要、鍵盤可達、草稿存 localStorage、送出後產生報名編號 `CDC-{yyyymmdd}-{6 碼}`、顯示收執（可列印、可下載 JSON、可下載甄試日 .ics）、再次強調非正式。
- `/procurement/`：分頁籤 招標中／已截止／已開標／已決標／流標；卡片（案名、標案案號、採購方式、預算、投標截止、開標日、政府電子採購網外連）；`/procurement/{slug}/` 標案資訊表、時程、決標資訊、附件、聯絡、舊網址揭露。
- 導覽：footer「更多服務」把「人才招募與採購」拆成「人才招募」「採購公告」；`/notices/` 移除招募／採購頁籤改為兩張入口卡；`/about/`、`/contact/` 連結更新；首頁若有相關卡片同步。
- 後台 `/admin/jobs/`（人事室：職缺與階段、待辦、結果上架檢核：遮罩檢核結果、正取數 ≤ 名額、備取有效期）、`/admin/tenders/`（秘書室：標案與階段、決標逾期）；`/admin/` 儀表板各加一張卡；待辦頁加三個 kind 頁籤。
- i18n 七語（介面字串；職缺內容 zh-TW 為主，title／summary 可有 en）；`tests/round7-ui.test.mjs`；截圖 `docs/screenshots/careers.png`、`careers-job.png`、`careers-apply.png`、`procurement.png`。

### 15.3 文件（X3 擁有）

- `docs/guide-staff.md`：新增「16. 人才招募上架 SOP（人事室）」（公告→截止自動退場→甄試→結果上架（遮罩規則、報名編號）→遞補→歷史）與「17. 採購公告 SOP（秘書室）」（公告→截止→開標→決標／流標）；「找誰」表加兩列。
- `docs/governance-model.md` 規則 19（招募階段推導與待辦）、20（甄選結果個資遮罩為建置閘門、AI 白名單排除名單）、21（採購階段推導與決標逾期）。
- `docs/plan-supplement.md` +3；`docs/roadmap-mapping.md` 人才招募／採購列更新；`docs/migration-playbook.md` 加「欄目型（非疾病）清單：人才招募、採購」一小節；README 第七輪段落（含「模擬報名不送出任何資料」）。
- 新文件 `docs/careers-privacy.md`：招募資料的個資處理原則（正式站報名系統在站外或後端、本站只公布編號與遮罩姓名、保存期限、刪除）。

### 15.4 分工與邊界

- X1：`schemas/{job,tender,news,_common}.json`、`content/{jobs,tenders}/**`、刪除 9 則 recruit／procurement 新聞檔、`content/master/units.json`、`content/migration/{careers,procurement}.json`、`scripts/lib/{load,validate,governance,emit-api,emit-seo,jsonld,openapi,index-builder}.mjs`、`src/client/answer/core.js`、`content/governance/eval-set.json`、`tests/jobs.test.mjs`、既有測試若因新聞型別移除而失敗的修正。
- X2：`src/templates/public/{careers,procurement,notices,about,contact,home}.mjs`（careers、procurement 新；apply 子頁放在 careers.mjs 的 pages() 內）、`src/templates/layout.mjs`（footer）、`src/templates/admin/{jobs,tenders,index,todos}.mjs`、`src/client/{careers-apply.js}`（新，模擬報名）、`src/client/i18n.js`、`src/styles/*`、`tests/round7-ui.test.mjs`、截圖。對 X1 欄位容錯。
- X3：`docs/**`、`README.md`。
- 共同：不切分支、不 commit；`npm test` 與 `BUILD_TODAY=2026-10-01 LINK_CHECK=error npm run build` 全綠。

## 16. 第八輪（2026-10-04）：上架功能補完：所見即所得編輯、附件與圖片的放法

目的：同事上架時不必會 Markdown；附件（PDF、表單、圖檔）與內文圖片有明確的「放哪裡、怎麼命名、建置時檢查什麼」，而且多筆附件、內文夾圖都做得到。**正本仍是 Markdown＋JSON**（可 diff、可機讀、可給 AI），所見即所得只是輸入方式。

### 16.1 檔案資產（assets）資料契約（Y1 擁有）

- **放哪裡**：每筆內容的檔案放 `content/assets/{content-id}/`（例：`content/assets/news.2026-09-18-flu-antiviral-extended/press-release.pdf`、`…/chart-ili.png`）。建置時原樣複製到 `dist/files/{content-id}/{filename}`，公開網址 `/files/{content-id}/{filename}`（不含語言前綴，七語共用）。檔名規則：小寫英數、連字號、底線與點；不可有空白與中文（validate 擋下，給出建議檔名）。
- **內容宣告**（`_common.json` 新增，所有型別可用）：
  ```
  assets: [{
    file: 'press-release.pdf',           // content/assets/{id}/ 下的檔名（必填、唯一）
    kind: 'attachment' | 'image' | 'data',  // 附件（列在頁面附件區）／內文圖片（Markdown 引用）／資料檔（CSV、JSON）
    label: '新聞稿全文（PDF）',           // attachment／data 必填；image 可省略
    alt: '…',                              // image 必填（無障礙），≤ 150 字
    mime: 'application/pdf', bytes: 123456, sha256: '…',   // 建置時核對（缺則建置時自動補寫回 JSON？不：驗證失敗並印出正確值，由同事貼回；--fix-assets 旗標可自動補寫）
    machineReadable: true|false,           // attachment：PDF 是否有文字層／是否另附機讀版
    accessibleAlt: 'press-release.md' | null,  // attachment 為 PDF 且 machineReadable:false 時，建議附上同名 .md 或 .docx；缺 ⇒ 待辦 attachment-no-accessible-version
    version?: '114.04.16', effectiveAt?: date,  // 文件型附件可帶版次
    source?: '…', license?: 'OGDL-1.0'      // 圖片來源與授權（image 必填 license；非本署素材需 source）
  }]
  ```
  既有 `attachments[]`（news）、`pdfUrl`（document／publication）、`materials[]` 保留相容：若 `url` 以 `/files/{id}/` 開頭，必須在 `assets` 中宣告；外部網址照舊走外部連結檢查。
- **內文圖片**：Markdown `![替代文字](/files/{id}/chart.png)`；validate 檢查每個 `/files/` 引用都在 `assets` 宣告、kind 為 image、alt 非空（Markdown 的 alt 與 assets.alt 擇一非空即可，建置時以 assets.alt 補進 `<img alt>`）。渲染時 `md()` 把 `/files/` 路徑加上 basePath、加 `loading="lazy"`、`width/height`（若 assets 有 `width/height` 欄位）。
- **限制**（`site.config.mjs` → `assets`）：PDF ≤ 20 MB、圖片 ≤ 2 MB、資料檔 ≤ 50 MB；允許副檔名 pdf、png、jpg、jpeg、webp、svg、csv、json、xlsx、docx、odt、md、ics；一筆內容 ≤ 30 個檔。超限 ⇒ 驗證失敗。SVG 需不含 `<script>`／`on*=`（validate 掃描）。
- **建置檢查**（`scripts/lib/assets.mjs`，build 的 validate 階段呼叫）：檔案存在、sha256／bytes 相符（不符 ⇒ 建置失敗，訊息給出實際值）、副檔名與 mime 一致、檔名規則、孤兒檔（`content/assets/{id}/` 有檔卻未宣告 ⇒ 警告＋待辦 `asset-orphan`）、`content/assets/` 下的 id 必須存在。複製到 dist 時只複製有宣告的檔。`npm run build -- --fix-assets` 自動把 bytes／sha256／mime／width／height（PNG／JPEG 讀檔頭即可，不需外部套件）補寫回 JSON。
- **治理**：待辦 `attachment-no-accessible-version`（中）、`asset-orphan`（低）、`image-license-missing`（中）。版本鏈：文件新版的 PDF 放在新版內容的 assets，舊版照舊保留；`redirects.json` 不處理檔案（舊 PDF 直接以新版文件頁取代，見 migration-playbook 2.x）。連結檢查：`/files/` 視為站內連結、必須存在。API：`/v1/catalog.json` 每筆加 `assets` 摘要（file、kind、label、url、bytes、machineReadable）；`llms.txt` 不列檔案。
- **樣本**：至少 6 筆內容改用真實檔案（放進 repo，皆為本輪產生的示意檔，不抄外部）：1 則新聞稿附 PDF＋內文 1 張 PNG 圖表（用 Node 畫一個簡單 SVG 再轉？不能轉 PNG——直接用 SVG 當內文圖；另用 Node 零依賴產生一張小 PNG 作為範例也可）、1 份文件附 PDF（用 Node 零依賴寫出合法的單頁 PDF，含文字層）＋ `.md` 可及性版本、1 份出版品海報 PDF、1 個申請服務的表單 docx 替代為 `.md`＋ `.pdf`、1 筆資料集附 CSV（kind data）、1 則專區附圖片（含 source／license）。`scripts/gen-sample-assets.mjs` 產生這些檔（可重跑）。既有指向 `/pending/` 的附件至少改 3 筆。
- 測試 `tests/assets.test.mjs`：宣告缺檔／hash 不符／檔名不合法／SVG 含 script／圖片無 alt／PDF 無可及性版本 → 各自結果；複製到 dist；內文圖片渲染加 alt 與 lazy；catalog 含 assets。

### 16.2 上架編輯器（Y2 擁有）

後台 `/admin/publish/` 內文編輯改為三頁籤：**所見即所得**／**Markdown**／**預覽**（三者同一份資料，切換即時轉換）：
- 所見即所得：`contenteditable` 區＋工具列（標題 2／3、粗體、斜體、項目／編號清單、連結、表格 3×3、圖片、引用、分隔線、復原）；貼上 Word／網頁內容時清成支援子集（移除樣式、span、字型、顏色，保留段落、標題、清單、表格、連結、粗斜體）；HTML→Markdown 轉換用自寫轉換器（`src/client/admin/md-convert.js`，純函式，零依賴），Markdown→HTML 用 `src/public/vendor/marked.min.js`（從 node_modules 複製一份，附 LICENSE）＋白名單淨化。
- Markdown 頁籤：既有 textarea；預覽頁籤：用站上 `c-prose` 樣式渲染，圖片用 blob URL 預覽（檔案選了但還沒進 repo）。
- **附件與圖片面板**：拖放或選檔，多檔；每檔列：檔名（自動正規化成合法檔名並提示）、kind（附件／內文圖片／資料檔，依副檔名預設）、label、alt（圖片必填）、machineReadable、license／source（圖片）、大小與 mime 檢查（依 `site.config.assets` 限制）、Web Crypto 算 sha256、PDF 無文字層提示（無法在瀏覽器判斷 ⇒ 問同事勾選）；「插入圖片到內文」把 `![alt](/files/{id}/file)` 插到游標處；移除檔案時若內文仍引用 ⇒ 警告。
- **輸出**：既有「產生 JSON」改為「產生上架包」：下載 **ZIP（store-only，自寫 `src/client/admin/zip-store.js`，CRC32 自算）**，內含 `content/{dir}/{id}.json`（assets 欄位已填好）與 `content/assets/{id}/…` 原檔；畫面顯示「放哪裡」樹狀圖與 git／PR 指引；同時保留只下載 JSON。預檢清單增加資產項（缺 alt、超限、檔名、孤兒）。
- 樣式與無障礙：工具列按鈕有 aria-label 與鍵盤快捷鍵（Ctrl+B／I／K）；contenteditable 區有 `role="textbox" aria-multiline`；錯誤摘要沿用既有。
- 測試 `tests/admin-editor.test.mjs`：md-convert 雙向（標題、清單、表格、連結、圖片、粗斜體、巢狀清單、Word 貼上清理）、zip-store 產出可被 Node `zlib`／自寫解析讀回且 CRC 正確、檔名正規化、預檢規則；Playwright 跑一次完整流程（輸入→切頁籤→插圖→附件→下載 zip）並截圖 `docs/screenshots/admin-editor.png`、`admin-assets.png`。
- `src/templates/admin/publish.mjs` 的欄位說明更新：「內文（中文正本）」旁加「用哪一種方式都可以，存檔一律是 Markdown」。

### 16.3 文件（Y3 擁有）

- 新文件 `docs/assets-policy.md`：檔案放哪裡（路徑與網址）、命名、格式與大小、PDF 可及性（文字層、標籤、`.md` 替代）、圖片 alt／來源／授權、資料檔、版本與保存、刪除與下架（檔案不刪只下架：移到 `archived` 內容仍可存取）、病毒掃描與個資（正式站上傳前掃描、含個資的檔不得上架）、與 CKAN 的關係（資料檔同時登錄資料目錄）。
- `docs/guide-staff.md` 第 2 節上架 SOP 重寫：三種編輯方式、附件與圖片怎麼加、上架包怎麼交（PR 流程）、常見錯誤（檔名中文、圖沒 alt、PDF 沒文字層、hash 不符）。
- `docs/governance-model.md` 規則 22（檔案資產宣告與建置檢查）、23（圖片 alt 與授權為建置閘門）、24（PDF 可及性版本待辦）；`docs/plan-supplement.md` +2；README 第八輪段落與治理自動化清單。

### 16.4 分工與邊界

- Y1：`schemas/_common.json`（assets）、`site.config.mjs`（assets 限制）、`scripts/lib/{assets,validate,governance,markdown,emit-api,check-internal-links}.mjs`、`scripts/build.mjs`（呼叫與 --fix-assets）、`scripts/gen-sample-assets.mjs`、`content/assets/**`、樣本內容檔的 assets 欄位、`tests/assets.test.mjs`。
- Y2：`src/client/admin/{md-convert,zip-store,assets-panel,publish}.js`、`src/client/admin/preprocess.js`（資產預檢）、`src/templates/admin/publish.mjs`、`src/public/vendor/marked.min.js`（＋LICENSE）、`src/styles/admin.css`、`tests/admin-editor.test.mjs`、截圖。
- Y3：`docs/**`、`README.md`。
- 共同：不切分支、不 commit；`npm test` 與 `BUILD_TODAY=2026-10-01 LINK_CHECK=error npm run build` 全綠。

## 17. 第九輪（2026-10-04）：發布車道與自動合併、預覽網址、預定與緊急發布、舊站匯出批次轉換

目的：讓承辦人感受到的流程「跟舊後台一樣簡單、速度差不多」，但治理在背後自動發生；並示範舊站匯出一鍵轉成內容草稿。原型沒有後端，所以「送出」在原型裡是：上架包 ZIP → 開 PR；而 PR 之後的一切（分車道、檢查、合併、部署、預覽）在 GitHub Actions 上**真的會跑**。

### 17.1 發布車道（Z1 擁有）

`content/governance/lanes.json`：
```
{ lanes: {
    emergency: { label: '緊急發布', types: ['situation'], alsoWhen: { urgent: true },   // 任何型別標 urgent:true
                 autoMerge: true, requiredApprovals: 0, postPublishReviewHours: 24, slaMinutes: 10 },
    fast:      { label: '快車道', types: ['news','letter','clarification','job','tender','banner'],
                 autoMerge: true, requiredApprovals: 0, postPublishReviewHours: 24, slaMinutes: 180 },
    standard:  { label: '一般車道', types: ['disease','vaccine','document','faq','topic','service','page','publication','labtest','research','dataset','media','migration'],
                 autoMerge: false, requiredApprovals: 1, reviewers: ['unit.pr'], tier1Reviewers: ['unit.pr','unit.oasis'], slaWorkingDays: 2 } },
  rules: { translationsNeverBlock: true, machineTranslationAllowedFor: ['news','faq','topic','service'], ciIsTheReviewer: true } }
```
- `_common.json` 新增選填 `publishAt`（date-time 或 date；未到 ⇒ 不渲染、不進索引／sitemap／API／RSS，後台列「排程中」）、`urgent`（bool，只有 news／letter／clarification 可用）、`postPublishReview: { status: 'pending'|'done', reviewedBy?, reviewedAt? }`。
- 治理：`item.gov.lane`（依型別與 urgent）、`item.gov.scheduled`（publishAt > now）、待辦 `post-publish-review`（快車道／緊急發布已上線但尚未複核，owner unit.pr，期限 publishedAt + 24h，中優先；逾期升高）、`lane-sla-breach`（PR 開啟超過 SLA 仍未合併：由 CI 在 PR 上標籤與留言，不是建置待辦）。`scripts/lane.mjs <changed files…>`：由變更檔案推出車道與審核需求（多檔取最嚴格），輸出 JSON 給 CI 用。
- 時間基準：`BUILD_TODAY` 凍結只影響治理日期，`publishAt` 以真實現在時間（UTC）判斷，讓排程發布在原型上真的會到點上線。

### 17.2 CI：PR 車道、自動合併、預覽網址、排程（Z1 擁有）

- `.github/workflows/content-pr.yml`（`pull_request` 針對 `content/**`、`data/snapshots/**` 以外的路徑也可，但車道只看 content）：checkout → npm ci → `npm test` → `node scripts/build.mjs --check` → `node scripts/lane.mjs`（改動檔案由 `git diff --name-only origin/main...HEAD`）→ 以 `BASE_PATH=/new_cdc_prototype/preview/pr-{N}` 建置預覽 → 把 dist 推到 `previews` 分支的 `pr-{N}/` 目錄（孤兒分支、force 覆蓋該目錄）→ 觸發 `pages.yml` 的 `workflow_dispatch` 讓主站重新部署（主站建置時把 `previews` 分支內容複製到 `dist/preview/`）→ 在 PR 留言（或更新同一則留言）：車道、檢查結果摘要、預覽網址 `https://ancientsky.github.io/new_cdc_prototype/preview/pr-{N}/`、SLA 到期時間、需要誰審 → 加標籤 `lane:fast|standard|emergency`。
- 自動合併：車道 autoMerge 且全部檢查通過 ⇒ 同一工作流程直接 `gh pr merge --squash --delete-branch`（不用倉庫的 auto-merge 設定）；一般車道 ⇒ 檢查 `gh pr view --json reviews` 是否有核准（原型沒有 team，CODEOWNERS 以註解標示單位對應，核准人用倉庫擁有者示範），有核准且檢查通過才合併；否則留言說明還缺什麼。PR 開啟超過 SLA ⇒ `.github/workflows/lane-sla.yml`（每小時）留言並加 `sla:breach` 標籤。
- `.github/workflows/preview-cleanup.yml`：PR 關閉 ⇒ 刪 `previews/pr-{N}/`，再觸發主站部署。
- `pages.yml`：排程改為每 2 小時一次建置（讓 `publishAt` 到點上線），但 `npm run fetch` 與快照回寫只在每日 02:00 UTC 的那一次與手動執行時跑（用 `github.event.schedule` 判斷）；建置前 checkout `previews` 分支到 `dist/preview/`（不存在就略過）；`.nojekyll` 照舊。
- `.github/CODEOWNERS`：`content/diseases/** content/vaccines/** content/documents/** content/faq/**` → 公關室＋OASIS（註解寫單位，實際帳號用倉庫擁有者）；其餘目錄 → 各單位（註解）。
- 測試 `tests/lanes.test.mjs`：lane 推導（型別、urgent、多檔取最嚴）、publishAt 未到不渲染／不進 sitemap／API、post-publish-review 待辦、lanes.json schema。YAML 以 `node -e` 用簡單檢查（存在、含必要步驟名）測；**真正的端到端由整合者開一個測試 PR 驗證**。

### 17.3 舊站匯出批次轉換（Z2 擁有）

- `scripts/import-legacy.mjs <export-dir> --out <dir> [--apply-migration] [--rules content/migration/import/_import-rules.json]`：
  - 輸入：匯出目錄，每頁一個 `.html`＋同名 `.json` 側檔（url、title、category、publishedAt、updatedAt、breadcrumbs、attachments:[{url,label,file}]），或一個 `index.json` 陣列；附件檔放 `files/` 子目錄。這是我們定義的「匯出格式」，正式站由資訊室從 CMS 資料庫匯出成此格式（文件要寫清楚欄位）。
  - 規則 `content/migration/import/_import-rules.json`（底線開頭、放 `import/` 子目錄，才不會被當成移轉清單）：URL 模式 → 型別與目錄（`/Disease/SubIndex/` → disease blocks、`/Category/QAPage/` → faq（每題一筆）、`/Bulletin/Detail/` → news（typeid 9 press、8772 clarification、11 other）、`/Category/MPage|Page/` → page 或併入疾病 blocks、`/File/Get/` → asset）；類別 → owner 單位；疾病名 → disease id（用主檔別名比對）；標題關鍵字 → blocks key（致病原→intro、傳染方式→transmission…）。
  - 轉換：HTML → Markdown 用 `src/client/admin/md-convert.js`（純函式，Node 可直接 import）；清 Word 樣式；表格保留；圖片改成 `/files/{id}/…` 並宣告 assets（複製檔案、算 sha256、讀尺寸；alt 先用圖片的 title／alt／檔名，標 `needsAlt`）；PDF 附件宣告為 attachment（machineReadable 用 Y1 的 `pdfHasTextLayer` 偵測）。
  - 輸出：`{out}/content/{dir}/{id}.json` 草稿（`status: 'review'`、`conversion: { mode: 'auto', confidence: 0–1, issues: [...], sourceUrl, convertedAt }`、legacyUrls、assets、owner、reviewedAt=匯出日、reviewPeriodMonths 依型別預設）、`{out}/content/assets/{id}/…`、`{out}/report.json` 與 `{out}/report.md`（每頁：來源、型別、目標 id、信心、問題清單（表格複雜、圖無 alt、未對應類別、內文過短、重複標題）、建議動作）、`{out}/migration-patch.json`（對應移轉清單 key 的 status／target 更新；`--apply-migration` 才寫回 `content/migration/{slug}.json`，且只改 status／target／note，不動 verified）。
  - 信心計算：型別對應明確 +0.4、owner 對應 +0.2、Markdown 無轉換警告 +0.2、附件全部找到 +0.1、無重複 +0.1。< 0.6 ⇒ 建議人工檢視。
- **第一批實測：結核病 40 個舊頁**。開發環境連不到舊站，所以由 Z2 依 `content/migration/tuberculosis.json` 的 40 筆人工項目**合成一份模擬匯出** `data/legacy-export/tuberculosis/`（HTML 要像舊站：Bootstrap 版型、Word 貼上的 span／mso 樣式、表格、附件連結、麵包屑；內容用既有結核病內容反推，明確標示為模擬匯出，正式匯出取代即可）。跑 `import-legacy` → `data/legacy-import/tuberculosis/`（草稿、assets、report），**不要**把草稿放進 `content/`（會與既有結核病內容重複）；報告要能和既有內容對照（同 target 的草稿標「既有內容已存在，供比對」）。`--apply-migration` 對結核病清單實際套用一次（status 由 pending → migrated 的筆數要寫在回報）。
- **第二批：登革熱（連屈公病）33 個舊頁**（第十輪）。結核病首批之後把工具通用化：疾病候選改以主檔全部疾病為底（規則檔只補別名與 short）；類別沒規則時 owner 依疾病主檔（`ownerFallbackToDisease`），另加不綁疾病的「／檢驗」「／統計」「／通報」子類別規則；清單只寫例外（`extends` 模板）時，把 `_disease-template.json` 依該疾病展開成推導項一起比對（推導項只進報告與 `migration-patch.json` 的 `derivedItems`，不寫回清單）；`{id}` 佔位的清單網址只有 fragment 或標題也對得上才算對應（避免把新新聞對到清單裡別篇通函）；對到的文件若同 family 已有較新版次，建議 `archived`。模擬匯出改為**模板驅動**（`scripts/lib/legacy-import/sim-export-disease.mjs <disease.id>`）：任何有疾病頁的疾病都能產，`data/legacy-export/dengue/` → `data/legacy-import/dengue/`。
- **第三批：流感 33 個舊頁**（第十一輪，疫苗與服務型別最多的疾病）。三項轉換器修正：欄目內頁（MPage）而清單目標是 document 時草稿直接建成 document（`type-from-manifest`，不再暫存 page 記 `target-type-differs`）；模板文件項（工作手冊、病例定義、治療指引）標題對不上正式名稱時改以 `docType` 語意對，不改共用 `_disease-template.json`；清單 dropped／archived 而工具建議 pending 視為一致不列衝突。服務型查詢頁（合約院所）不轉、維持 pending，等 service 型別。每批新增的處理經驗與理由記在 `docs/legacy-import.md` 10.x；「Git＋CI 取代傳統後台」的比較表給資訊室看：`docs/git-as-cms.md`。
- **第四批：麻疹＋腸病毒**（第十一輪）。模板項改以舊站選單位置（最後一層麵包屑）對應，三批對不上的「治療指引」解決；人工例外已指向同一份新站內容的模板位置不再推導、模擬匯出不另產頁（五批重跑各少 2 頁，`target-shared` 歸零）；推導目標取現行最新。新增 `scripts/lib/legacy-import/types.mjs`：publication／media／dataset／labtest／service／clarification 直接產，抽不到的必填欄位以「（待補：…）」佔位並記 `fields-pending`；規則檔 version 3 加 `serviceRules`、澄清稿 `type: clarification`。清單判定「併入」文件／疫苗頁的欄目內頁以 page 暫存記 `merge-into-target`。結果見 `docs/legacy-import.md` 10.3。
- **第五批：其他第一、二類傳染病（狂犬病、瘧疾、A 型肝炎、德國麻疹、屈公病、M 痘）**（第十二輪）。沒有人工清單的疾病由轉換器自組「合成清單」展開模板推導項（報告 `manifest.synthetic`，`--apply-migration` 拒絕寫回）；「例外涵蓋就不推導」改為保留項目並標 `coveredBy`，匯入、模擬匯出、治理引擎 R15 三處同步；相關連結頁建成 `topic`（`topic.{slug}-links`，連結 `unchecked`），清單標「已移轉」到疫苗頁的疫苗專區頁建成 `vaccine`（`publicFunded` 由「公費」表格列抽）；規則檔 version 4。同輪新增後台「修改已上架內容」：公開頁頁尾「同事修改這頁」→ `/admin/publish/?edit={id}` 以 v1 API 現行版預填表單（疾病頁 blocks ↔ `## 區塊標題` 內文往返），匯出時 `mergeEdit` 帶回表單沒有的欄位、發布日不變，上架包覆寫同一檔，PR 只顯示實際改動（`docs/guide-staff.md` 2.10）。結果見 `docs/legacy-import.md` 10.4。
- **第六批：新聞與公告欄目**（第十二輪）。沒有移轉清單的批次：`sim-export-news.mjs` 把既有新聞／通函／澄清稿反推成 Bulletin 內頁並合成近年、久遠、英文稿與列表頁（60 頁）；報告以三級處理的建議動作決定去向，新增 `sampling`（auto-ok 依網址雜湊取 10%）與「二級抽樣檢視名單」段；致醫界通函（typeid 48 或標題正規式）建成 `letter`、`letterNo` 由標題抽、權責取疾病業務組（`categoryOwners.preferDiseaseFor`）；英文稿記 `needs-source-zh` 不自動上線；規則檔 version 5。結果見 `docs/legacy-import.md` 10.5。
- **第七批：指引與手冊欄目**（第十二輪）。一級內容、重點是版次鏈：`sim-export-guidelines.mjs` 把既有 27 份文件（19 個家族）反推成欄目內頁（內文是現行版、附件列表放歷版 PDF；流感抗病毒藥劑三版各一頁），另合成狂犬病手冊兩版、純 PDF 指引、歷版掃描檔與列表頁（26 頁 → 32 份草稿）；轉換器新增：去版次同名 ⇒ 同 family、依 `effectiveAt` 串 `supersedes`（舊版建議封存）、附件列表的歷版 PDF 拆成純 PDF 舊版草稿（沿用新站既有 id）、純 PDF 頁以（待補）佔位記 `pdf-only`、生效日優先從標題／內文抽（民國年換算）；移轉清單 `content/migration/guidelines.json`（欄目範圍）；規則檔 version 6。結果見 `docs/legacy-import.md` 10.7。
- **第八批：常見問答欄目**（第十二輪）。一級內容、每題一筆：`sim-export-qa.mjs` 把既有 57 題反推成 12 頁問答頁（疾病批還沒做的疾病、預防接種／旅遊／統計／謠言主題頁、鬆散排版、期限已過的年度 Q&A、英文頁、單題頁），另原樣複製疾病批匯出裡同網址的結核病、登革熱 Q&A 頁與列表頁（15 頁 → 34 份草稿）；轉換器新增 `qa.mjs`：同網址已在所屬疾病批轉過 ⇒ `converted-elsewhere`／`skip-duplicate`（讀 `data/legacy-import/*/report.json`，在清單比對前決定）、沒有 `.panel` 的頁依「Q 開頭標題／粗體段落」拆題（`faq-structure-loose`）、`tasks` 依規則檔 `faqTasks` 關鍵字給候選、答案期限都已過記 `answer-dated`、問「多久／幾劑」的題抽 `structured` 候選、一頁多題的清單項維持 pending（`one-to-many`）、英文問答頁 `qa-en` 建成 `sourceLang: en`；移轉清單 `content/migration/qa.json`（欄目範圍）；規則檔 version 7。結果見 `docs/legacy-import.md` 10.8。
- **第九批：國際旅遊與健康欄目**（第十二輪；兩個模型分工：一個寫模擬匯出與清單、一個改轉換器，以檔案為分工邊界）。這個欄目在新站多半是功能與資料：`sim-export-travel.mjs` 反推 19 頁（列表 4、國際旅遊處方箋查詢頁含 231 國下拉、國家結果頁 6、旅醫門診／黃皮書／國際預防接種及藥物／等級表／瘧疾用藥／宣導影片／行前返國 8）＋複製第八批的旅遊 Q&A 頁；轉換器新增 `travel.mjs`：URL 模式可標 `kind: generated` ＋ `newPath`（`/travel/{ISO2}/`），國家由 query／標題／麵包屑對國家主檔判出，不出草稿、舊內文存 `reference/{key}.md`、建議動作 `skip-generated`；查詢表單頁記 `dynamic-form` 並移除表單；小節提到主檔沒有的疫苗記 `vaccine-not-in-master`；`homeBatches` 讓不綁疾病的主題頁也有家批；`mergeScopes` 加旅遊醫學。**移轉清單新增 `newPath`**（新站路徑去處，與 `target` 二擇一）：schema、`v1/redirects.json`、三種伺服器轉址檔、legacy-map、404 分析、治理 R14／R15 都認得；轉換器對資料產生頁提議 `migrated` ＋ `newPath`；第七、八批的列表頁改用 `newPath`（不再 410）。規則檔 version 8。結果見 `docs/legacy-import.md` 10.9。
- **第十批：宣導素材欄目**（第十三輪；兩個模型分工：一個寫模擬匯出與清單、一個改轉換器，以檔案為分工邊界）。彙整型欄目：海報／單張／手冊 → `publication`、影片／動畫／廣播 → `media`、多語素材總表 → 既有 `dataset.health-education-materials`、列表 → `newPath`（`/publications/`、`/media/`）。`sim-export-materials.mjs` 反推 21 頁（列表 6、MPage 3、海報與單張 6、手冊 1、影音 4、社群入口 1）＋複製結核病批三頁宣導素材；轉換器新增 `materials.mjs`：規則檔 `materialScopes`／`materialRules` 讓**沒有清單型別的頁由欄目位置與標題字樣決定型別**（`type-from-category`）；圖片承載唯一資訊記 `image-only`（純文字版（待補）、alt 當候選）、同頁 ≥ 4 圖記 `image-gallery`；多語附件 → 一筆內容、`languages[lang]: pending`（`lang-variants`）；素材製作日早於該疾病現行指引記 `material-outdated` 並把指引填進 `basedOn`；外部系統入口記 `external-system`；跨批重複從 Q&A 擴到素材頁。規則檔 version 9。結果見 `docs/legacy-import.md` 10.10。
- **第十一批：統計資料欄目**（第十三輪；兩個模型分工，以檔案為分工邊界）。資料型欄目：入口頁／週報／統計表 → `dataset`、年報 → 既有 `publication`、列表 → `newPath`（`/data/`、`/en/data/`）。`sim-export-statistics.mjs` 反推 13 頁＋複製結核病、登革熱批的統計頁；轉換器新增 `statistics.mjs`：**期別不是版次**（附件 ≥ 3 期 ⇒ 一筆 `document-library` 資料集逐期列 `resources`，在版次鏈之前判掉，`periodical-issues`）；**表格抽時序**（年×數值表 ⇒ dataset `series`，民國轉西元，`series-extracted`／`series-gaps`／`stats-stale`）；**入口頁對資料集用網址**（站外 host 對 canonicalUrl／portalUrl ⇒ 既有 dataset id，`dataset-by-url`）；英文列表頁 URL 模式 `category-list-en`。規則檔 version 10。結果見 `docs/legacy-import.md` 10.11。
- 後台 `/admin/import/`：讀 `data/legacy-import/*/report.json`：批次摘要（頁數、型別分布、平均信心、需人工檢視數、附件數）、逐頁表（來源、型別、目標、信心、問題、動作）、下載草稿 JSON、對應移轉清單的連結；`/admin/` 加一張卡。
- 測試 `tests/import-legacy.test.mjs`：規則比對、HTML→草稿（含 Word 樣式清理、表格、附件宣告、圖片 needsAlt）、信心計算、report 形狀、migration-patch 不動 verified、結核病批次 40 頁全部有輸出且草稿通過 schema 驗證（用 validate 的單檔驗證）。

### 17.4 後台與文件（Z3 擁有）

- 後台 `/admin/publish/`：型別選定後顯示**車道徽章**與說明（「快車道：送出後約 3 分鐘上線，公關室 24 小時內複核」／「一般車道：需 1 位審核，SLA 2 個工作天」／「緊急發布：立即上線並通知複核」）；新增欄位 `publishAt`（排程發布）與 `urgent`（只有可用型別顯示）；「送出」按鈕：原型環境產生上架包後，顯示**模擬送出時間軸**（建立分支 → 開 PR → CI 檢查（列出會跑的檢查）→ 車道判定 → 自動合併或等待審核 → 部署 → 預覽網址格式），並附「正式環境這一步由系統代做，承辦人只按一次送出」。預檢加：urgent 只能用於允許型別、publishAt 必須晚於現在。
- `docs/publishing-lanes.md`（**建議書**，給主管與各單位）：問題陳述（舊後台直接上架 vs 新流程的抱怨點）、原則（流程看不見、CI 當審核者、分車道、多語不擋中文）、車道表（型別、是否自動合併、審核人、SLA、上線後複核）、時程（送出到上線 3 分鐘的拆解）、預覽網址、預定與緊急發布、上線後複核怎麼做、CODEOWNERS 與審核權限、SLA 逾期處理、試行計畫（兩單位、兩個月、量什麼）、溝通要點（按鍵數對照表：舊後台 vs 新流程）、風險與對策、附錄：GitHub 上實際跑的工作流程說明與原型驗證結果（整合者補數字）。
- `docs/legacy-import.md`：匯出格式規格（側檔欄位）、規則檔怎麼寫、信心分級與人工檢視原則、三級處理（現行一級內容人工確認／近年新聞自動上線／久遠封存）、PDF 不整批轉、報告怎麼看、結核病首批結果（整合者補數字）、正式批次的排程建議（每批一個欄目樹、對照移轉清單）。
- `docs/guide-staff.md`：第 2 節加「車道與送出」小節、排程與緊急發布操作；第 15 節加「用匯入工具產生草稿」步驟。`docs/governance-model.md` 規則 25（車道與自動合併）、26（排程發布與上線後複核）、27（自動轉換草稿的信心與人工檢視）。`docs/plan-supplement.md` +3；`docs/roadmap-mapping.md` 內容管理後台列更新；README 第九輪。

### 17.5 分工與邊界

- Z1：`content/governance/lanes.json`、`schemas/_common.json`（publishAt、urgent、postPublishReview）、`scripts/lib/{governance,lanes}.mjs`、`scripts/lane.mjs`、`scripts/build.mjs`（previews 複製、publishAt 過濾）、`scripts/lib/{emit-api,emit-seo,pages}.mjs`（排程中不輸出）、`.github/workflows/{content-pr,preview-cleanup,lane-sla,pages}.yml`、`.github/CODEOWNERS`、`tests/lanes.test.mjs`。
- Z2：`scripts/import-legacy.mjs`、`scripts/lib/legacy-import/**`、`content/migration/_import-rules.json`、`data/legacy-export/tuberculosis/**`、`data/legacy-import/**`、`content/migration/tuberculosis.json`（只透過 --apply-migration）、`src/templates/admin/import.mjs`、`src/templates/admin/index.mjs`（加卡）、`tests/import-legacy.test.mjs`、截圖 `docs/screenshots/admin-import.png`。
- Z3：`src/templates/admin/publish.mjs`、`src/client/admin/{publish,preprocess,editor}.js`（車道徽章、publishAt、urgent、模擬送出時間軸）、`src/styles/admin.css`、`docs/**`、`README.md`、截圖 `docs/screenshots/admin-lanes.png`。
- 共同：不切分支、不 commit；`npm test` 與 `BUILD_TODAY=2026-10-01 LINK_CHECK=error npm run build` 全綠。CI YAML 無法在本機跑，Z1 要用 `node -e` 讀 YAML 做基本檢查（不要新增 yaml 套件；用簡單字串檢查即可），整合者會開真實 PR 驗證。

---

## 18. 第十四輪（2026-10-05）：疫苗接種時程地圖與「幾歲能打哪些公費疫苗」

起因：答案引擎對「65 歲以上可以打哪些公費疫苗」只引用一種疫苗（新冠）的句子；「滿一歲的小孩要打什麼疫苗」答成孕婦 Tdap。問題不在檢索分數，而是**沒有一份把所有疫苗按年齡排好的資料**：公費對象散在 8 頁疫苗頁的 `publicFunded`，卡介苗、五合一、日本腦炎、A 肝連頁面都還沒有。所以這輪先補資料，再讓地圖與問答兩個消費者讀同一份。

### 18.1 資料契約：疫苗接種時程表（主檔）

`content/master/immunization-schedule.json`：一筆一個「劑次 × 對象」，schema `schemas/master.json#/$defs/scheduleItem`，`site.master.immunizationSchedule`，API `v1/immunization-schedule.json`。

| 欄位 | 說明 |
| --- | --- |
| `id` `sched.*`、`vaccine` `vaccine.*` | 疫苗必須在 `content/master/vaccines.json`（validate 檢查）；疫苗沒有頁面也可以列（卡介苗、五合一、四合一、輪狀、Tdap、帶狀疱疹已補進主檔，`hasPage: false`） |
| `ageMinMonths`／`ageMaxMonths` | 一律用**月**（成人＝歲 × 12；`null`＝不設上限），地圖與問答都用月齡比對，避免「6 個月」與「0.5 歲」兩種寫法 |
| `ageLabel`、`dose`、`interval`、`recurring: yearly`、`startAt`／`endAt` | 人看的寫法與年度計畫期間（流感、新冠每年 10 月 1 日起） |
| `stage` | 地圖分段：`infant`（0–2 歲）、`child`（學齡前）、`school`、`adult`、`pregnancy`、`older`（65+）、`risk`（暴露後、高風險） |
| `funded` | `public` 公費、`conditional` 符合身分條件才公費（`group` 寫條件）、`self` 自費（含「部分縣市補助」） |
| `source {title,url}` | 這筆數字從哪來（現行兒童預防接種時程表 11401 版、本站疫苗頁、政策新聞） |
| `verified` | **承辦人核對過才改 true**；false 時地圖標「待承辦人確認」、問答句尾加註。首版 42 筆全部 false |

為什麼是主檔而不是塞進疫苗頁：時程地圖要列「所有疫苗」，而疫苗頁只有一部分疫苗有；問答要跨疫苗彙整，不該靠 BM25 碰運氣撈到每一頁。疫苗頁的 `publicFunded` 仍是該頁的正本（句子抽取、來源卡），時程表則是「跨疫苗的索引」，兩邊同一件事以疫苗頁為準、時程表的 `source` 指回疫苗頁。

### 18.2 呈現：`/vaccines/schedule/`（時程地圖）

`src/templates/public/vaccine-schedule.mjs` ＋ `src/client/vaxschedule.js`：inline SVG，橫軸年齡分段非線性刻度（0–24 月逐月、2–6 歲、6–18 歲、19–49、50–64、65+），一列一疫苗、一筆一標記（點＝單一月齡、橫條＝區間；填色依 `funded`，`verified: false` 虛線框）；stage 頁籤；輸入年齡（`#age=65`、`#age=m12`）高亮「現在可打／即將／已過建議年齡」；點標記開詳情卡（劑次、對象、來源、疫苗頁、查附近接種點）。SVG 之外一定有同資料的表格（無障礙、列印、無 JS）；同頁 `.md` 機讀版。入口：`/vaccines/` 索引、各疫苗頁時程區（帶 `#vaccine=<id>`）、`/tasks/vaccines/`。

### 18.3 答案引擎：年齡／身分 → 跨疫苗彙整

`core.js`：問句解析出年齡或身分（N 歲／N 個月／新生兒／幼兒／國中／長者／孕婦…）、意圖是 vaccine、且沒有指定單一疫苗（或問「哪些疫苗」）⇒ 不走一般抽取式組句，改由時程表篩出符合月齡的項目，公費先、條件公費次、自費最後，**一疫苗一句**，每句引用該疫苗頁的 `pf-N` chunk；疫苗沒有頁面就引用時程表本身（來源「疫苗接種時程表」→ `/vaccines/schedule/#sched.id`）。行動鈕加「看完整疫苗時程地圖」帶 `#age=`。評估集 VA011–VA014。單一疫苗的問法（VA001–VA010）不變。

實作細節：`core.js` 匯出 `ageProfileOf(q)`（→ `{ minMonths, maxMonths, stages, groups, label }`；數字年齡優先於身分詞、「近 12 個月」「間隔 6 個月」不算年齡）、`matchSchedule`、`ageHashOf`；引擎多吃 `deps.schedule`（`engineFromSite` 傳 `site.master.immunizationSchedule`，瀏覽器端 `data.js` 以 `v1Optional('immunization-schedule')` 載入，沒有就退回一般檢索）；結果多 `result.schedule`／`result.ageProfile`。每句第一個引用是共用來源 `master.immunization-schedule`（type `schedule`，grounding 逐字比對組句來源），有頁面的疫苗再加該頁 `pf-N` 作第二引用；`verified: false` 的項目句尾加「（待確認）」。孕期與暴露後／高風險項目只在問句帶該身分時列；`group` 指名原住民或孕婦而問句沒有該身分時降為「符合條件者公費」。`render.js` 對 type `schedule` 的來源卡顯示「疫苗接種時程表（主檔）」與組句說明。

### 18.4 這輪順帶核對出的內容錯誤（已改）

- 肺炎鏈球菌疫苗頁與 Q&A「長輩的肺炎鏈球菌疫苗」仍寫「1 劑 PCV，間隔 1 年再 PPV23」；2026-01-15 起成人公費已改為 **1 劑 PCV20／PCV21**，對象加 19–64 歲高風險。已更新；Yulun 隨後提供疾管署正式頁（成人肺炎鏈球菌疫苗），依其內容補齊高風險對象定義、2026-08-10 起 PCV21、曾接種者的銜接規則（只打過 13／15 價或只打過 23 價者間隔 1 年再 1 劑；兩者都打過或已打 20／21 價者不需再打）。
- HPV 國一男生：補「自 113 學年度入學者起、2025 年 9 月開打」。
- A 型肝炎第 1 劑月齡在不同版本時程表寫法不一（12–15 個月 vs 18 個月），時程表 note 請承辦人以現行公告為準。

### 18.5 分工與邊界

兩個模型分工，以檔案為邊界：一個做答案引擎（`src/client/answer/{core,data}.js`、`eval/run-eval.mjs`、評估集、`tests/answer.test.mjs`），一個做地圖頁（`vaccine-schedule.mjs`、`vaxschedule.js`、i18n 新 key、components.css 新區塊、入口連結、`tests/vaccine-schedule-ui.test.mjs`）；整合者負責主檔、schema、載入、API、疫苗頁修正與文件。

## 19. 第十六輪（2026-10-05）：人才招募與採購公告的後台上架、異動與結果公告

### 19.1 資料契約

- `schemas/job.json`、`schemas/tender.json` 新增 `amendments[]`：`{ date, kind: extend | reschedule | correction | cancel | other, text(≤300), refNo? }`。異動是**追加**不是改寫：延長截止時 `deadlineAt` 改成新日期，同時 `amendments` 多一筆 kind `extend` 寫「由 A 展延至 B」。前台詳情頁「公告異動」區倒序列出；最新一筆在 14 天內則頁首提示；列表卡標「有異動」。RSS 不另發項目（階段變動已會反映）。
- 取消／補實（job `manualStatus: cancelled | filled`）與流標／廢標（tender `manualStatus: failed | cancelled`）由表單寫入，並自動追加 kind `cancel` 的異動紀錄；已取消不得有 `result`，已決標不得再填 `manualStatus`（既有 validate 規則）。
- 甄選結果 `result`、遞補 `waitlistUpdates` 與決標 `award` 的欄位不變；表單只是產生它們。

### 19.2 共用規則（瀏覽器與 CI 同一份）

`src/client/careers-rules.js`（純函式、無 import）：`maskedNameProblems`、`candidateNoProblems`、`jobPiiErrors`（原在 `scripts/lib/validate.mjs`）、`jobStageOf`、`tenderStageOf`（原在 `scripts/lib/governance.mjs`）。兩個建置腳本改為 import 並 re-export，既有測試不變；後台表單 import `../careers-rules.js` 做即時檢核與階段預覽。**原本**規則只在 Node 建置時跑，承辦人要送 PR 才知道名單遮罩有沒有過；**改成**表單輸入時就跑同一個函式；**為什麼比較好**：不會有「表單說可以、CI 說不行」兩套規則，也不必在瀏覽器端再抄一份。

### 19.3 後台頁

| 路徑 | 模板／腳本 | 內容 |
| --- | --- | --- |
| `/admin/jobs/edit/` | `src/templates/admin/jobs-edit.mjs`、`src/client/admin/jobs-edit.js`（DOM）、`jobs-edit-core.js`（純函式） | 選「新增」或既有職缺；A 公告內容、B 時程異動、C 取消／補實、D 甄選結果（正取、備取、遞補，即時個資檢核）；預覽階段與關鍵日期；匯出整份 job JSON 與檔名 |
| `/admin/tenders/edit/` | `tenders-edit.mjs`、`tenders-edit.js`、`tenders-edit-core.js` | 同上：A 公告內容、B 時程異動（投標截止、開標、說明會）、C 流標／取消、D 決標公告；匯出整份 tender JSON |

匯出後的流程與疫情發布相同：覆蓋或新增 `content/jobs/`、`content/tenders/` 的檔開 PR，依 `lanes` 走快車道；`/admin/publish/` 的型別說明改為指向這兩個表單。純函式拆在 `*-edit-core.js` 是為了測試（`tests/jobs-admin.test.mjs`、`tests/tenders-admin.test.mjs`）不必碰 DOM。

## 20. 第十七輪（2026-10-05）：頁尾分組（fat footer）、首頁「更多服務」去重、開發者入口導引卡移除

### 20.1 版面契約

- `src/templates/layout.mjs` 頁尾改為四個 `<nav class="site-footer__col" aria-labelledby="ft-*">`：`ft-svc`（服務，來源 `FOOT_SERVICES` 清單，不再含 `/contact/`）、`ft-about`（關於與政策：about、international（有該語才出現）、privacy、AI 聲明、accessibility、guide、sitemap-page）、`ft-dev`（開放資料與開發者：data、developers、open-data 授權、transparency、admin 示範）、`ft-contact`（聯絡：`tel:1922`、`tel:0800001922` 大字、專線說明、署長信箱、通報專區）。最後一列 `.site-footer__meta` 橫跨四欄放原型建置日。
- CSS：`.site-footer__in` 是 `grid` 四欄；`≤ 720px` 兩欄、`≤ 480px` 一欄（`src/styles/base.css`）。舊的 `.site-footer__svc*`、`.c-moreservices*` 規則刪除。
- 首頁 `home.mjs` 不再輸出「更多服務」區塊；`home.more` 字串保留給 `/sitemap-page/` 用。
- `developers.mjs` 不再輸出 `#intl-card` 導引卡；`tests/round6-ui.test.mjs` 改為斷言頁尾「關於與政策」欄含國際合作連結、開發者入口不含該卡。
- i18n 新鍵（七語）：`footer.group.about`、`footer.group.dev`、`footer.group.contact`、`footer.hotline.note`；`footer.services` 改為「服務」。

### 20.2 原本 → 改成 → 為什麼

| 原本 | 改成 | 為什麼比較好 |
|---|---|---|
| 首頁底部「更多服務」卡片列 + 頁尾同一排連結 | 只留頁尾，分組呈現 | 同一組連結出現兩次會讓人懷疑是不是漏了什麼；頁尾本來就是「捲到底的第二導覽」，首頁主線可以更短 |
| 頁尾單排連結 + 右側一小塊聯絡 | 四欄分組、每欄有標題與 `aria-labelledby` | 螢幕閱讀器可按區塊跳讀；搜尋引擎能讀到站點結構；1922 專線用大字獨立一欄，手機上一眼能撥 |
| 開發者入口頁首放「國際合作」導引卡 | 移除，國際合作留在主選單與頁尾 | 外國 API 使用者的需求由 `/en/developers/` 本身滿足；導引卡放在頁首反而像走錯頁 |

## 21. 第十八輪（2026-10-05）：後台登入與角色規則、權責單位介紹頁

### 21.1 後台登入契約

- **規則單一來源** `src/client/admin/auth-rules.js`（純函式，無 import）：`ROLES`（六角色）、`PAGE_RULES`（後台頁 key → 允許角色；沒列＝任何已登入角色）、`CROSS_UNIT_ROLES`（可切單位視角：chief-editor、governance、platform）、`DEMO_ACCOUNTS`（示範帳號，姓名遮罩）、`makeSession`／`sessionProblem`（8 小時到期、閒置 30 分鐘）、`canAccess`／`canActAsUnit`、`auditEntry`（事件：login、logout、denied、unit-switch、expired）。登入頁的「誰能進哪些頁」表、`common.js` 閘門、`tests/round18-ui.test.mjs` 都讀這一份；正式環境閘道應匯出同一份為設定。
- **閘門** 在 `src/client/admin/common.js` 模組開頭執行（所有後台頁第一個載入的 script）：讀 `cdc.admin.session` → 無效（無、過期、閒置、格式不符）→ `location.replace('/admin/login/?next=…')`；有效 → 更新 `lastSeen`，檢查 `canAccess(session, document.body.dataset.adminPage)`，不允許就 `#main.hidden = true`、在前面插入 `.adm-denied` 卡並寫 `audit('denied')`。**不動原本 DOM**，頁面自己的腳本才不會因找不到元素而連環錯。`gateOk` 在 `unitLabel` 定義之後才呼叫（TDZ）。
- **單位視角**：非跨單位角色的 `#adm-unit` 只留自己單位的 option、`aria-readonly="true"`；跨單位角色切換時寫 `audit('unit-switch')`。`getUnit()` 退路改為 session 的單位。
- **登入頁** `/admin/login/`（`adminKey: 'login'`，`PUBLIC_ADMIN_PAGES`）：layout 不出導覽列與登出鈕；`login.js` 的 `?next=` 只接受站內 `^/admin/(?!login)` 路徑（防開放式轉址）；已登入者看到「繼續到後台／改用其他身分」。
- **localStorage 新增** `cdc.admin.session`、`cdc.admin.audit`（append-only，最多 200 筆）。登出時清 session、寫 `logout`、導回登入頁。
- 既有端到端測試（`tests/admin-editor.test.mjs`）以 `addInitScript` 先種 `makeSession(DEMO_ACCOUNTS[0])`。

### 21.2 單位介紹頁與 `unitLink`

- `content/master/units.json` 新欄位（schema `schemas/master.json`）：`slug`、`intro`、`introEn`、`introVerified`、`duties[]`、`officialUrl`（null 待補）、`officialUrlVerified`。原型撰寫的簡介一律 `introVerified: false`，頁面顯示「尚待該單位確認」。
- `src/templates/public/units.mjs`：`pages()` 對每個單位出 zh-TW 與 en 兩頁（`UNIT_PAGE_LANGS`）＋ `.md`；`unitContent(site, unitId)` 列該單位 `owner` 或 `hiringUnit` 的已發布內容，依型別分組、每型最多 8 筆；JSON-LD `GovernmentOrganization`。
- `_partials.mjs`：`unitPath(u)` → `/about/units/{slug}/`；`unitLink(ctx, id)` 輸出 `<a class="c-unitlink">`，非中英語言連英文版並加 `hreflang="en"`，找不到單位退回純文字。**所有權責單位欄位（provenance、publisher 提示、公告 meta、申請／宣導／影音／研究／文件 dl、招募用人單位、關於與聯絡頁）一律用 `unitLink`，不要只放 `unitName`**；`unitName` 保留給屬性值、`.md` 與 JSON-LD。組織圖單位卡的名稱也連到單位頁；聯絡頁單位表改連單位頁（原本連 `/about/#u-*` 錨點）。
- 現行官網：`units.mjs` 的 `OFFICIAL_ORG_PAGES`（組織與職掌、另一頁單位介紹，Yulun 提供）。現行官網沒有各單位獨立網址，所有單位 `officialUrl` 指向組織與職掌頁、`officialUrlVerified: true`；單位頁側欄與 `/about/` 組織圖下方（`.c-org__official`）列出兩頁。`duties` 依處務規程，`dutiesSource` 註明出處。
- 主檔修正：`unit.preparedness` 名稱改為「新興傳染病整備組」；新增 `unit.ai-office`（AI 推動辦公室，任務編組，`publishes: false`）。**第十九輪更正**：AI推動辦公室與原型的 OASIS 是同一單位（Yulun 確認，2026-10-06）——`unit.ai-office` 已刪除，`unit.oasis` 改名「AI推動辦公室」、英文「Office of AI Strategy, Innovation, and Synergy (OASIS)」，id、slug、內容的 `owner` 都不變；文件與介面裡的「OASIS」是它的英文縮寫，照用。
- CSS：`.c-unitlink`、`.c-unitpage*`（`components.css`）；`.adm-login__*`、`.adm-who__*`、`.adm-denied`（`admin.css`）。

## 22. 第十九輪（2026-10-06）：PDF 機讀版、頁碼引用、AI推動辦公室更名

- `scripts/lib/pdf-text.mjs`（無 import，Node／瀏覽器共用）：`splitPages`（頁碼行須連續、前一行空白或 ≤6 字；`\f` 視同換行）、`isTableLike`（≥15 行且多為 ≤10 字短行）、`isNumericFragment`（≥20 個數字 token 且 >60%）、`joinLines`（去目錄點線、斷行接回、≤10 字清單標籤自成一段）、`tocAnnexTitles`、`pdfTextToSections` → `{ sections, report }`、`splitByPage`、`sectionsToMarkdown`。頁碼標記是 Markdown 內獨立一行 `〔p.N〕`（印刷頁碼）。跨頁同段：上一頁最後一段無句末標點且下一段不是清單開頭時接回，算起始頁。附件編號必須遞增（附件內引用「附件一」不算新附件）。
- `scripts/pdf-to-md.mjs`：輸入 PDF（`pdftotext -enc UTF-8`，不加 `-layout`）或 `.txt`，`--meta` 合併人工欄位，輸出 `sections`、`machineReadableMarkdown`、`pageCount`、`derivedFrom`。來源與 meta 放 `data/pdf-ingest/`（不進建置）。
- `schemas/document.json`：`sections[]` 加 `level`（2/3）、`pages`［起, 迄］、`kind`（text/form/figure）、`index`；新增 `derivedFrom`（`file`、`sha256`、`sourceKind`、`tool`、`extractedAt`、`reviewStatus` machine|reviewed、`reviewedBy`、`reviewedAt`、`pdfPageOffset`、`tablePages`、`inlineTablePages`、`excludedSections`、`redTextChanges`、`note`）。
- `index-builder.mjs` document：`index:false` 段落略過；含頁碼標記的段落經 `splitByPage` 每頁一塊，chunk id `{key}-p{N}`、url `#page-N`、欄位 `pdfPage`、`extraction { reviewStatus, pdfUrl, pageOffset }`；無頁碼標記的維持一段一塊，url 改為 `#s-{key}`（與 `documents.mjs` 的 id 一致）。
- `core.js`：`sourceOf` 帶 `pdfPage`、`extraction`；`citeLabelOf` 加「（第 N 頁）」；`retrieve` 對 `extraction.reviewStatus === 'machine'` 乘 0.7，`composeSentences` 減 0.6；`pdfHref(src)`（僅 `.pdf` 且 `pageOffset` 為整數時加 `#page=`）。`render.js` 來源卡加頁碼、文字來源、開啟 PDF。
- `governance.mjs`：白名單理由 `pdf-unreviewed`；待辦 `pdf-unreviewed`（30 天，列表格頁、紅字未擷取）。後台與透明度頁加標籤。
- `documents.mjs`：`pageAnchors()` 把 `〔p.N〕` 換成 `<p class="c-pagemark" id="page-N">`（同頁只給第一次 id）；`level: 3` 段落用 `h3`。CSS `.c-pagemark`、`.c-block--sub`。
- `sim-export-guidelines.mjs`：排除有 `derivedFrom` 的文件（不屬第七批舊站快照）。
- 主檔：`unit.oasis` 名稱「AI推動辦公室」、英文「Office of AI Strategy, Innovation, and Synergy (OASIS)」；刪除 `unit.ai-office`。
- 測試 `tests/pdf-ingest.test.mjs`：切頁、章節、表格與表單排除、跨頁接回、重跑轉換與已提交 JSON 一致、sha256、索引切塊與錨點、白名單與待辦、文件頁錨點、PDF 跳頁連結。評估集 `2026.10-r7` 新增 PDF001–004。

## 23. 第二十輪（2026-10-06）：真指引取代虛構版本鏈、_retired 快照

- 內容：`content/documents/guidance-dengue.2026-02.json`（family `doc.guidance-dengue`，由 `data/pdf-ingest/dengue-chik-guideline-2026-02.meta.json` 轉出）取代 `guidance-dengue.v15–v17`；移除 `news/2025-11-11-letter-dengue-guidance-v16.json`、`news/2026-07-01-letter-dengue-guidance-v17.json`。`basedOn`／`manualDoc` 用家族 id 的內容不需改。
- `data/legacy-export/_retired/{documents,news,migration}/`：已自 `content/` 移除、但模擬舊站快照（2026-10-03）當時存在的檔案與當時的移轉清單。`sim-export-disease／guidelines／news／qa.mjs` 讀 `content/`＋`_retired/`（依檔名排序、排除有 `derivedFrom` 的文件；疾病模擬優先用 `_retired/migration/{slug}.json`）。`tests/import-legacy.test.mjs` 的 `snapshotContent()` 組同樣的目錄傳給 `runImport({ contentDir })`。
- 移轉清單：`dengue.json` 的 `dengue-guidance-v16-archive` 改 `merged` → `doc.guidance-dengue.2026-02`；`guidelines.json` 的 `guidance-dengue` 目標改為新文件。
- 評估集 `2026.10-r8`：V010／V011／PR009 改引用 `doc.guidance-dengue.2026-02`。
- 文件：guide-staff 第 23 節（圖片與影片進智慧查詢），legacy-import 10.12。

## 24. 第二十一輪（2026-10-06）：長文件分章摺疊版面

- `src/templates/public/_longdoc.mjs`：`isLongDoc(sections)`（任一段有 `pages` 或 ≥12 段）；`groupSections(sections, { annexTitle })` → `[{ id, kind: chapter|annex|single, title, pages, intro, items: [{ s, part, short }] }]`（key `^ch\d+` 同章，key 等於章代號者為導言；`annex-*` 併一組；標題以 ` · ` 切段，三段式的中段為 `part`，最後一段為 `short`）；`outline(html)` 對 `md()` 輸出的頂層 `<p>/<ol>/<ul>` 加 `c-ol{0-4}`／`c-olc{n}`／`c-olh`（已有 class 的段落不動）；`longDocMain(ctx, sections, body)`、`longDocToc(ctx, sections, { before, after })`。
- `documents.mjs`：`long` 時主欄用 `longDocMain`（`body` 仍是 `md(pageAnchors(...))`，同一個 `seenPages`，錨點規則不變），側欄目錄移到最後並加 `c-cols__side--longdoc`（`align-self: stretch` 讓目錄黏住）。每節 `<details class="c-ldsec" id="s-{key}">`；章 `<section class="c-ldch" id="g-{id}">`；章節卡 `#ld-map`。
- `ui.js`：`openTo(hash, scroll)`（載入、`hashchange`、點同一錨點時：打開祖先 `details`，捲到目標，頁碼標記加 `is-hit`）；`[data-ld-toggle]` 全部展開／收合；`beforeprint` 展開、`afterprint` 還原；目錄捲動標示時把 `.c-toc--long` 內的目前項目捲進可見範圍。
- CSS（components.css 尾端）：`.c-ldmap*`、`.c-ldch*`、`.c-ldpart`、`.c-ldintro`、`.c-ldsec*`、`.c-longdoc .c-pagemark`（右浮動小標籤）、條列縮排、`.c-toc--long`（≤959px 隱藏）。
- i18n `ld.*`（zh-TW、en）。
- 測試 `tests/longdoc.test.mjs`：套用條件、分組（9 組、無掉段）、每段 id 與頁碼錨點唯一、索引每塊錨點都在頁面上、條列層級、ui.js 行為存在；`pdf-ingest.test.mjs` 文件頁斷言改為 `details`。

## 25. 第二十二輪（2026-10-09）：借 TinaCMS 的後台設計（右側即時預覽、點區塊跳欄位、群組摺疊、黏住的儲存列、前台編輯鈕）

- 不引入 TinaCMS（理由：docs/architecture-decisions.md §14）。只借四個設計：編輯時看得到頁面、點頁面區塊跳欄位、群組欄位摺疊且 summary 顯示值、存檔狀態永遠看得到。
- `src/client/admin/page-preview.js`：`renderPreviewHtml(f, h)` 純函式（f＝`readForm()` 結果，h＝`{ md, typeLabel, unitName, laneLabel, today, siteBase, basedTitle, langLabel, taskLabel, assets, summary }`），每個區塊 `.adm-pv__blk[data-field][role=button][tabindex=0]`；`FIELD_MAP[field] = { focus, within, label }`（focus＝點了要聚焦的選擇器，within＝反向亮起時「游標在這裡面」的選擇器）。`initPagePreview({ root, form, getState, helpers })` → `{ repaint, repaintSoon, focusField }`；`focusField` 會打開祖先 `<details>`、`scrollIntoView`、聚焦、在最近的 `.adm-field/.adm-fieldset/.adm-assets/.adm-editor/details` 上加 `adm-field--hit` 1.4 秒；`form` 的 `focusin` 把對應區塊加 `is-active`。
- 內文圖片：已選檔 → blob URL；`/files/…` 還沒選檔 → 1×1 SVG data URI 佔位（**不發網路請求**），repaint 後去掉 `src`、加 `adm-img-missing`（與編輯器一致）。
- `publish.mjs`：右欄 `.adm-result--sticky` 兩頁籤 `#pt-prev/#pp-prev`（`#page-preview`）、`#pt-res/#pp-res`（原 `#pre-result`、`#pre-sec` id 不變；新增 `#pre-stale` 黃框與 `#btn-rerun`、頁籤徽章 `#pt-res-badge`）。「提供語言」「發布時間」包進 `<details class="adm-group" id="g-langs|g-timing">`，summary 內 `#g-langs-sum/#g-timing-sum`；fieldset 加 `adm-fieldset--ingroup`、legend 改 `adm-sr-only`。動作列 `#pub-actions.adm-actions--sticky` 內 `#f-savestate[data-state=dirty|saved]`。內容 ID 與動作列不摺疊（Playwright 測試會直接 fill `#f-id`）。
- `publish.js`：`paintGroups()`（語言數、缺理由數、排程／緊急／立即；有錯自動 `open` 並標 `adm-red`）、`paintStale()`（`A.text !== analysisText(readForm())` ⇒ 顯示黃框、徽章「需重跑」）、`paneTab('prev'|'res')`（存 `cdc.admin.paneTab`；`runPreprocess` 非 silent 一律切到 `res`，silent 還原上次頁籤）、`paintSaveState()`／`markDirty()`、`pvHelpers()`；表單 `input/change`、編輯器與附件面板 `onChange`、`paintBased`、`applyTypeUI` 都會 `PV.repaintSoon()`（250 ms debounce）。`Ctrl/⌘+S` ＝ `saveDraft(true)`。`window.__admPublish` 多 `preview`、`paneTab`。
- 前台：`ui.js` `staffEditFab()`——有未過期的 `cdc.admin.session` 且頁面有 `.c-page-data__staff a` 時，在 `<body>` 末插入 `<a class="c-editfab">`，href 同頁尾連結；i18n `pagedata.editfab`、`pagedata.editfab.aria`（七語）。列印隱藏；≤600px 只顯示圖示。這只是捷徑，權限仍由後台頁與正式環境閘道判定。
- CSS：admin.css 尾端 `.adm-result--sticky`（≥1101px 黏住）、`.adm-tabs--pane`、`.adm-tabbadge*`、`.adm-stale`、`.adm-pv*`、`.adm-field--hit`、`.adm-group*`、`.adm-fieldset--ingroup`、`.adm-actions--sticky`（≤760px 改 static）、`.adm-savestate*`；components.css 尾端 `.c-editfab*`。
- 測試 `tests/round22-ui.test.mjs`（模板結構、純函式渲染與跳脫、FIELD_MAP 對得到頁面 id、七語字串）；`admin-editor.test.mjs` 端到端的頁籤計數改成只數 `.adm-tabs--editor`。

## 26. 第二十三輪（2026-10-10）：資安修正（原型模式、安全標頭、車道授權名單、BYOK、Actions）

### 26.1 站台模式（`config.mode`）
- `site.config.mjs`：`mode = process.env.SITE_MODE === 'production' ? 'production' : 'prototype'`，`isPrototype` getter，`officialUrl`。
- prototype：`layout()` 每頁 `<meta name="robots" content="noindex, nofollow">`（取代原本只有部分頁的 `noindex`）；`<body>` 內 skip-link 之後、topbar 之前輸出 `<div class="c-proto-banner" role="note" data-proto-banner>`（i18n `proto.banner.tag|text|cta`，七語）；`emitSeo` 寫 `robots.txt`＝`buildPrototypeRobots()`（`User-agent: *` / `Disallow: /`，不列 Sitemap）並把政策版寫到 `robots.production.txt`。sitemap、llms.txt、feeds 照常輸出（部署正式站時不必重建這些）。
- production：行為同第二十二輪以前。測試以 `config.isPrototype` 決定讀哪一份 robots。

### 26.2 安全標頭（`scripts/lib/emit-headers.mjs`）
- `emitHeaders(dist, write)` 在所有頁面與靜態資源寫出後執行：`collectInlineHashes(dist)` 掃 `**/*.html`（略過 `preview/`），`inlineScripts(html)` 只取會執行的 `<script>`（無 `src`；`type` 缺省、`module`、`text/javascript`、`application/javascript`），`sha256()` 回 `'sha256-<base64>'`。
- `securityHeaders({ hashes })` → 七個標頭；CSP：`default-src 'self'; script-src 'self' <hashes>; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://i.ytimg.com; font-src 'self'; connect-src 'self' https://api.anthropic.com; frame-src <vaxmap origin> https://www.youtube-nocookie.com https://www.youtube.com; frame-ancestors 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; upgrade-insecure-requests`。
- 輸出 `dist/headers/{headers.json,nginx.conf,web.config.headers.xml,_headers,README.md}`。建置 log 印雜湊段數，>40 段警告（代表有模板把每頁資料塞進 inline script；資料請放 `type="application/json"` 或 data 屬性）。
- 規則：新增 inline script 不必手動改 CSP，重建即可；新增第三方來源（iframe、API）要改 `securityHeaders()` 並在 deploy.md §10 說明。

### 26.3 車道授權名單（`lanes.json`、`scripts/lib/lanes.mjs`）
- `lanes.<lane>.allowedAuthors: string[]`（GitHub 帳號不分大小寫，或 `team:<org>/<slug>`）；`rules.urgentAllowedAuthors`。`validateLanes`：`autoMerge` 車道缺名單 ⇒ 錯誤。
- `authorAllowed(author, list, { teams })` → `{ allowed, reason }`。`laneForFiles(files, { author, teams, … })`：判定車道後，若該車道 `autoMerge`，作者不在名單（含未提供作者）⇒ `lane = 'standard'`、`reasons` 加「… ⇒ 降為一般車道（需人審）」；輸出多 `authorGate: { author, allowed, reason, requestedLane } | null`（非自動合併車道為 null）。`files[].lane` 維持檔案本身的分類。
- `scripts/lane.mjs --author= --teams=org/slug,…`；`content-pr.yml` 以 `github.event.pull_request.user.login` 傳入，並用 `gh api orgs/<owner>/teams/<slug>/memberships/<login>` 收集作者所屬 team（個人帳號 repo 查不到就留空）。PR 留言表多「作者授權」列。

### 26.4 BYOK（`src/client/answer/llm.js`、`ui.js`、`ask.mjs`）
- 金鑰與模型選擇存 `sessionStorage`（`cdc.llmKey`、`cdc.llmModel`）、LLM 開關 `cdc.llmEnabled` 亦在 sessionStorage；`purgeLegacyKey()` 載入時移除 localStorage 舊鍵。`staffSessionActive()` 讀 `localStorage.cdc.admin.session` 的 `exp`；`setupAdvanced()` 無工作階段 ⇒ 移除 `[data-llm-staff]` 區塊並清鍵；`llmEnabled()` 同時要求工作階段有效。
- `ask.mjs`：`#ask-advanced[data-llm-model][data-llm-models]`（來自 `config.ai.llmModel/llmModels`）、金鑰欄位包在 `<div data-llm-staff hidden>`；`llm.js` 的 `llmDefaultModel()/llmModels()` 讀 data 屬性，`LLM_DEFAULT_MODEL/LLM_MODELS` 僅為備援常數。後台 `publish.js` 多語初稿改讀 sessionStorage 鍵。

### 26.5 GitHub Actions
- 所有 `uses:` 釘 40 字元 commit SHA，行尾註解 `# vX.Y.Z`；`.github/dependabot.yml`（github-actions、npm 每週；第二十七輪加 `groups`：Actions 全部一組、npm minor／patch 一組，避免相鄰行升版 PR 互相衝突）。`tests/lanes.test.mjs` 寫死 checkout／setup-node／deploy-pages 的 SHA，升版時一併更新（deploy.md §9.1）。
- `content-pr.yml`、`pages.yml` 工作流程層級 `permissions: contents: read`；寫入權限在 job 層（`lane` job：contents/pull-requests/issues/actions write；`build` job：contents write；`deploy` job：pages/id-token write）。測試 `tests/round23-security.test.mjs` 檢查 SHA 格式、註解、層級。

## 27. 第二十四輪（2026-10-10）：無障礙修正與 CI 檢測閘門

**目標：** 新版網站無障礙規範 AA（WCAG 2.2 AA，2026-11-30 施行）；機器可判定的部分由 CI 把關，其餘列「待人工稽核」（[docs/a11y.md](docs/a11y.md)）。

### 27.1 檢測腳本與閘門政策

- `npm run a11y` ＝ `node scripts/a11y.mjs`。**不建置**，只讀 `dist/`（或 `DIST_DIR`），沒有就以 exit 2 與明確訊息結束；行程內自帶靜態伺服器（認得 `BASE_PATH`），建議建置時用 `BASE_PATH=''`。
- 以 Playwright 的 Chromium 對代表頁（`PAGES`：首頁、疾病頁、疾病列表、疫苗、旅遊、新聞、Q&A、智慧查詢、疫情、資料、專業版、後台首頁、後台上架、/en/、/vi/；dist 沒有的略過並列出）在 1280px 與 320px 各跑 `@axe-core/playwright`，標籤 `wcag2a, wcag2aa, wcag21aa, wcag22aa, best-practice`。
- **政策：** `serious`／`critical` 或 320px 出現橫向捲動（`scrollWidth > clientWidth`）→ exit 1；`moderate`／`minor` 只印警告。輸出 Markdown 摘要（`A11Y_REPORT`、`GITHUB_STEP_SUMMARY`）。
- 瀏覽器選擇順序：`CHROME_BIN` → `PLAYWRIGHT_BROWSERS_PATH`（預設 `/opt/pw-browsers`）下最新的 `chromium-*` → Playwright 內建。
- `content-pr.yml`：測試與治理閘門之後，`npx playwright install --with-deps chromium`、`BASE_PATH='' node scripts/build.mjs`（`DIST_DIR` 暫存目錄）、`npm run a11y`（`continue-on-error`，id `a11y`）。`decide` 步驟與最後的「Fail when checks failed」都要求 `steps.a11y.outcome == 'success'`；PR 留言表多一列「無障礙檢測（axe）」。

### 27.2 版面契約

- **身分切換**（`layout.mjs`）：`.audience` 內全是 `<a class="audience__btn" data-view-set>`，**不可**有 `aria-pressed`（ARIA 不允許用在連結）；目前身分用 `aria-current="page"`。`ui.js` `applyView()` 同步改寫 `aria-current`；「民眾」連結在非 `/pro/` 頁就地切換（`preventDefault`），在 `/pro/` 放行導覽回首頁。真正的 toggle button（`.c-viewtoggle`、篩選鈕等）仍用 `aria-pressed`。
- **手機語言選單**：`.topbar` 內三塊：`nav.langs.langs--inline`（桌機橫排）、`details.langmenu`（`summary.langmenu__btn` ＝ i18n `lang.menu`，內含 `nav.langmenu__list`）、`nav.topbar__links`（`aria-label` ＝ `nav.tools`）。≤720px 隱藏 `.langs--inline`、顯示 `.langmenu`；`#main-nav` 底部 `.c-nav__langs`（≤959px 顯示）重複同一組語言連結。語言連結一律 `a[data-lang-path]`，`ui.js` 以此選擇器補上 `location.search/hash`，不要改回 `.langs a`。
- **目標尺寸**：任何自訂的小型可點元件（圓點、圖示鈕）點擊區至少 24×24 px，間距至少 8px；視覺縮小用 `::before`，不要縮 button 本身。輪播圓點：`.c-carousel__dot` 24×24、`::before` 12px。
- **可捲動區塊**：`.c-code`、`.c-tablewrap`、`.adm-tablewrap` 一律輸出 `role="region" tabindex="0" aria-label`（i18n `a11y.scrollCode`／`a11y.scrollTable`；後台用中文固定字串）；Markdown 的 `<pre>` 由 `md()` 加 `tabindex="0"`。新增可橫向捲動的容器時同樣處理，否則 axe 的 `scrollable-region-focusable` 會擋。
- **含連結的 svg**（世界地圖）用 `role="group"` ＋ `aria-labelledby`，不可 `role="img"`（`nested-interactive`）。
- **群組標題**：`.c-dis-group__t`（h2，視覺 `--fs-lg`）；標題層級不跳級，視覺大小用 class，不靠換標籤。
- **`ul` 不加 `role="group"`**：群組語意放外層 `<div role="group" aria-label>`。
- **320px 不得橫向捲動**：格線 `minmax(N,1fr)` 要寫成 `minmax(min(N,100%),1fr)`。

### 27.3 測試

`tests/round24-a11y.test.mjs`：對渲染後的 HTML 做結構斷言（無 `aria-pressed` 的 `a.audience__btn`、圓點 CSS 24px、`wm-svg` role、兩個搜尋表單 aria-label 不重複、`pf-pills` 無 role、`.c-code` tabindex、七語語言選單、標題不跳級、CI 步驟存在）。不需瀏覽器；真正的 axe 掃描由 `npm run a11y` 負責。

### 27.4 延後

依 `Accept-Language` 自動提示切換語言：未做（原型並非每頁都有七語，容易導到不存在的頁；也牽涉記住選擇的 cookie 告知）。

## 28. 第二十五輪（2026-10-10）：智慧查詢相關度門檻、相對日期檢查、制度性頁面、雙語詞彙頁

對應外部審查 Issue #25（查無仍給答案）、#37（相對日期）、#27（缺制度性頁面）、#38（缺舊站服務）、#40（隱私權頁與原型不符）。

### 28.1 相關度門檻與 `no-match`（`src/client/answer/core.js`）

**問題：** BM25 只要問句有任何一個雙字片段出現在語料，就會給分數；`retrieve` 只比較「相對最高分」（`minRel`）與下限 1 分，沒有「絕對夠不夠相關」的判斷。於是「抗蛇毒血清」因為「毒血」撞到登革熱的「病毒血症期」、「量子電腦是什麼」因為「是什麼」撞到「巡倒清刷是什麼」而被回答。

**做法：** `answer()` 檢索並套用型別偏好後，在組句前呼叫 `relevanceOf(q, chunks, model, hasEntity)`，回傳 `{ relevance, coverage, top, matchedIdf, reason }`。常數集中在匯出的 `RELEVANCE`：

| 常數 | 值 | 意義 |
| --- | --- | --- |
| `minCoverage` | 0.28 | 問句有效詞（IDF 加權）被前 3 個片段的標題＋內文＋術語涵蓋的比例下限。沒有認出病名／疫苗／國家的問句用這個 |
| `minCoverageEntity` | 0 | 問句已認出病名／疫苗／國家時略過涵蓋率與泛用詞檢查：檢索本身已限定在該實體（「登革熱會人傳人嗎」「Bệnh ho gà có triệu chứng gì」涵蓋率只有 0.27、0 卻是好答案），只保留分數下限 |
| `minTop` / `hardMinTop` | 8 / 3 | 最佳片段 BM25 分數下限；涵蓋率 ≥ `highCoverage`（0.85）時放寬到只看 `hardMinTop`（「口罩要戴嗎」分數低但詞全中） |
| `minMatchedIdf` + `genericMaxCoverage` | 0.3 / 0.5 | 命中的詞中最稀有者的 IDF（相對語料最大 IDF）過低，且涵蓋率 < 0.5 ⇒ 只命中泛用詞 ⇒ 拒答 |
| `refChunks` | 500 | BM25 的 IDF 隨語料大小變動，索引小於此值（單元測試的迷你站台）時，絕對分數門檻按 `ln(1+N)/ln(1+500)` 縮小；正式語料（約 700 塊）不縮 |
| `lowBelow` | 0.6 | `relevance` 高於拒答線但低於此值 ⇒ UI 顯示「與你的問題相關程度較低」 |

- 問句先經 `QUERY_FUNC_RE` 去掉功能詞（的、嗎、怎麼、什麼、哪裡…）才斷詞，避免「苗哪」「裡打」這種跨功能詞的雜訊雙字把涵蓋率拉低；不在語料的詞以最大 IDF 計入分母（視為未命中）。
- `relevance = 0.65 × 涵蓋率 + 0.35 × min(1, top/12)`，四捨五入到兩位。`result.relevance` 一律是 0–1 數字或 `null`（統計、結構化流程沒有檢索片段）；`result.relevanceInfo` 帶 coverage、top、reason 供除錯與透明報告。
- **不套用門檻的情況**：態勢（`situation` 且有結構化態勢卡）與旅遊（有國家或旅遊建議變化問句）不靠檢索片段，由結構化資料回答。
- 拒答新種類 **`no-match`**（標題「站內查無直接答案」）：`REFUSAL_TEXT` 的 zh-TW 與 en；行動為撥打 1922、傳染病索引 `/diseases/`、網站導覽 `/sitemap-page/`（`noMatchActions()`）。檢索完全沒有片段（「股票怎麼買」「蛇咬怎麼辦」）以前是 `no-source`，現在在沒有疾病實體時也是 `no-match`；`no-source` 保留給「有片段但組不出句子／信心不足」。
- **公告類**：`careers`／`procurement` 意圖在列清單前呼叫 `noticeTopicMiss(q, type, view)`：去掉意圖線索、泛用詞、功能詞、細節詞後仍有 ≥ 2 字的主題詞（例：透析膜），且同型別所有片段的標題、`focusTerms`、內文都沒出現其中任何一個 ⇒ `no-match`（附 1922 與「看全部採購公告／職缺」）。沒有主題詞（「現在有哪些標案」）照常列出。
- `no-match` 時關鍵字清單 `result.list` 只在 `relevance ≥ 0.4` 才附（太低的清單就是另一種不相關頁面）。
- **評估集**（`content/governance/eval-set.json` r9）：新類別 `nomatch`（「站內沒有的主題」）NM001–NM005：抗蛇毒血清、量子電腦是什麼、採購 透析膜、股票怎麼買、蛇咬怎麼辦，皆期望 `refuse: true`、`refusalKind: 'no-match'`、答案含 1922。類別同步加進 `schemas/governance.json` enum、兩份 `judge.js` 的 `REFUSAL_CATEGORIES`、後台評估頁與透明報告的類別標籤。調門檻時 208 題要全過（`node scripts/build.mjs --check` 會跑）。
- **UI**（`render.js`、`ui.js`）：`isLowRelevance(result)`（定義在 core.js 以便 Node 測試）；偏低時答案標題的副標改為「以下是站內最接近的官方內容，不一定能直接回答你的問題…」並加一行「與你的問題相關程度較低」；「AI 整理」徽章保留（它是 AI 揭露，不是信心宣稱）。拒答卡下方，`no-match`／`no-source` 時的關鍵字清單標題為「相關頁面」。

### 28.2 相對日期規則（`scripts/lib/dates.mjs`、`validate.mjs`）

- `RELATIVE_DATE_RE`（今（N）日、今日、今天、昨…、今年、去年、上週、本週、明…）與 `ABSOLUTE_DATE_RE`（西元 YYYY 年 M 月 D 日、YYYY-MM-DD、YYYY 年第 N 週、單獨的「YYYY 年」；「114 年度」不算）。`hasRelativeDate(sentence)`＝有相對、沒有絕對。
- `relativeDateFindings(item)` 只看 `news`／`letter`／`clarification` 的標題、摘要、首段（跳過標題行），逐句檢查。**news／letter＝警告**（`contentWarnings(site)`，build 時印 `⚠ [內容]`，不擋）；**clarification（第一級）＝錯誤**（併入 `validateSite`，擋建置）。
- 答案單元（`index-builder.mjs`）：news／letter 段落與澄清稿內文，句子仍含相對日期且同句沒有絕對日期 ⇒ 前綴「〔YYYY-MM-DD 發布〕」（`tagRelativeDate`），單獨被引用時也知道是哪一天。
- 9 則既有新聞稿已改寫。模擬舊站匯出（`data/legacy-export/{news,dengue,influenza,measles,enterovirus}`）從內容重產，因為匯入測試要求匯出與內容一致；`data/legacy-import/` 的轉換草稿未重跑（內容是匯入當時的文字，下次批次重跑時才更新）。

### 28.3 日期輸出單一出口（`scripts/lib/dates.mjs`）

- `schemas/_common.json` 的 `publishedAt` 改 `anyOf [date, date-time]`；不改寫 300 多個內容檔。
- `toIsoDateTimeTW(v)`：`YYYY-MM-DD` ⇒ `YYYY-MM-DDT00:00:00+08:00`，已帶時區的 date-time 原樣，其他格式取前 10 碼。`toRfc822(v)` 用於 RSS。
- `jsonld.mjs` 所有 `datePublished`／`dateModified` 都經 `toIsoDateTimeTW`；`dateModified` 取 `reviewedAt ?? updatedAt`。`emit-seo.mjs` 的 `rfc822` 就是 `toRfc822`。**不要在別處自己拼日期字串。**
- 理由：沒有時區的日期被不同系統解成不同的「當天」；監測系統比對「今日」時尤其容易錯一天。

### 28.4 隱私權頁（`content/pages/privacy.json`）

頁首註明「以下為正式站規劃；原型未啟用網站分析工具，問答紀錄只存在你的瀏覽器」。GA 段落改 GA4（不記錄 IP；UA 的「IP 匿名化」已作廢）；AI 問答紀錄段落改為「原型不在伺服器保存、12 個月去識別保存是正式站規劃」；第四節註明進階 AI 模式（自備金鑰）是限內部人員的示範、金鑰只存在該次瀏覽器工作階段（sessionStorage，由另一個 PR 實作）。`reviewedAt` 2026-10-10。**政策文字必須與實際行為一致：之後原型若真的加了分析或伺服器紀錄，先改這頁再上線。**

### 28.5 制度性頁面與頁尾（Issue #27）

| 頁面 | 路徑 | 建議權責 | 重點 |
| --- | --- | --- | --- |
| 法令規章 `page.legal` | `/policy/legal/` | 企劃組 | 傳染病防治法 L0050001、施行細則 L0050003、預防接種受害救濟基金徵收及審議辦法 L0050008 連全國法規資料庫；其他子法連搜尋頁並標「待確認」 |
| 政府資訊公開 `page.foia` | `/policy/foia/` | 秘書室 | 政府資訊公開法第 7 條九項對照表；已有頁面者連結，行政指導、訴願與請願、補助、會議紀錄、契約本文標「待建置」與權責單位 |
| 資訊安全政策 `page.security-policy` | `/policy/security/` | 資訊室 | 一般機關 ISMS 架構的示意稿，頁首標「示意稿，待資訊室確認」，不宣稱任何驗證 |
| 著作權聲明 `page.copyright` | `/policy/copyright/` | 公關室 | 本署著作、OGDL 1.0、合理使用、引用方式 |

- 路由：`PAGE_PATHS`（`_partials.mjs`）與 `PAGE_SLUG_PATHS`（`governance.mjs`）兩處都要加（slug 不含 `/` 的頁預設不獨立成頁）；`emit-seo.mjs` 的 `STATIC_PATHS` 也加。網站導覽「政策與說明」由 `PAGE_PATHS` 自動帶出，需要 i18n 鍵 `page.{slug}`。
- 頁尾「關於與政策」欄（`layout.mjs`）加四個連結，i18n 鍵 `footer.legal`／`footer.foia`／`footer.security`／`footer.copyright`（七語齊備，`src/client/i18n.js`）。新頁的英文版是機器翻譯（`languages.en: machine`），尚未人工審。
- 移轉清單：`content/migration/institutional.json`（法令規章、政府資料公開對到 `page.legal`／`page.foia`，現行官網網址取自審查意見）；資訊安全政策與著作權聲明在舊站是頁尾連結，舊網址待承辦補。權責單位都是建議，待各單位確認。

### 28.6 詞彙頁 `/glossary/` 與舊站服務清單（Issue #38）

- `src/templates/public/glossary.mjs`（`pages()` 回 `lang: '*'`，七語各一頁）：詞彙主檔公開版，依英文首字母分組（非字母歸 `#`），每筆含中文正名、English、定義（`definition ?? note`；`definition` 為新增的選填欄位，目前 83 筆中只有 2 筆有 `note`，其餘待單位補）、別名、舊稱、領域、相關疾病頁。每列的 `data-q`（小寫的中文、英文、別名、舊稱）供篩選。
- `src/client/glossary.js`：有 JS 才把 `hidden` 的篩選框打開並即時過濾，同步隱藏沒有符合項目的字母群；沒有 JS 就是完整清單（漸進增強）。
- 連結：頁尾「開放資料與開發者」欄、網站導覽「更多服務」、`STATIC_PATHS`。
- `content/migration/legacy-services.json`：電子報（待決策：Email 訂閱需要後端或寄信服務，建議先 RSS＋LINE 官方帳號）、抗蛇毒血清資訊（必移轉：緊急就醫資訊，舊網址取自審查意見）、傳染病核心教材（必移轉）、進階搜尋（待決策：用 `/ask/` 答案頁加「相關頁面」清單，或另做 Pagefind；本輪不做 Pagefind）。

### 28.7 沒做、留給權責單位決定

電子報走哪個管道、進階搜尋走哪條路、抗蛇毒血清與核心教材的內容匯入、FOIA 頁中標「待建置」的項目、資訊安全政策正式文字、各頁權責單位確認、英文版人工審核、詞彙定義文字。

## 29. 第二十六輪（2026-10-10）：介面字串依語言拆檔與 JS 預算、Lint／型別檢查、CMS 路線決策紀錄

三個外部審查意見（issue #34 效能、#42 工程品質、#28 CMS 路線）的合約。為什麼這樣做：每頁多載 290 KB 的七語字串、沒有任何自動擋「寫壞但還能跑」的程式、編輯介面的長期路線沒有書面比較。

### 29.1 介面字串依語言拆檔（#34）

- **來源不變**：`src/client/i18n.js` 仍是唯一來源（七語一個檔，`t(lang, key, vars)`、`STRINGS` 照舊給 Node 模板與測試 import，API 零變動）。
- **建置時拆檔**：`scripts/lib/i18n-split.mjs` 在 `copyDir(src/client → dist/assets/js)` 之後，產出 `dist/assets/js/i18n.<lang>.js`（`zh-TW`、`en`、`ja`、`tl`、`vi`、`id`、`th` 七個），並**刪除** `dist/assets/js/i18n.js`——完整七語檔不再上線。
- **只收 client 會用到的 key**：掃描 `src/client/**/*.js`（不含 i18n 自己）：原始碼出現的完整 key，加上動態組字的前綴（`` `vxs.status.${s}` `` 產生前綴 `vxs.status.`，該前綴下所有 key 都收）。純伺服器端模板用的 key（佔大宗）不上線。**新增動態組 key 的寫法時，前綴必須以「xxx.」字面量出現在 client 原始碼**，否則該 key 在瀏覽器會顯示成 key 本身。
- **每個 key 只存已解析的一筆**：依 `t()` 的規則「該語言 → 英文 → 中文」在建置時算好，檔內沒有 fallback 邏輯。
- **模組格式**：`const S={…}; (window.CDC=window.CDC||{}).I18N={lang,S}; export default S;`
- **瀏覽器端 `t()`**：`src/client/i18n.runtime.js`（`ui.js`、`vaxschedule.js`、`careers-list.js`、`careers-apply.js` 改 import 它）。它讀 `window.CDC.I18N`，並提供 `window.CDC.t(key, vars)`；頁面語言與載入的語言檔不同時回傳 key 本身。Node 端 import 時不碰 `window`。
- **載入順序**：`src/templates/layout.mjs` 在 `ui.js` **之前**放 `<script type="module" src="…/assets/js/i18n.<lang>.js">`（module 依文件順序執行）。後台頁（`admin/_layout.mjs`）不載入 `ui.js`，也不用 i18n，所以不需要語言檔；沒有「admin 專用字串」要另拆。
- **大小**（原始位元組）：before：每頁 `ui.js` 28.8 KB ＋ 完整 `i18n.js` 290.99 KB（gzip 約 104 KB）＝ 約 320 KB；after：`i18n.zh-TW.js` 4.2 KB、en 4.3、ja 4.4、tl 4.4、id 4.3、vi 4.5、th 4.7 KB，首頁 JS 合計約 34 KB。

### 29.2 每頁 JS 預算（#34）

`scripts/lib/js-budget.mjs`，於 `scripts/build.mjs` 輸出資產後執行，超過即 `exit 1`。做法：掃 dist 每個 HTML 的 `<script src>`，沿靜態 `import` 追到底，加總原始位元組（不含內嵌 script、CSS、圖片）。

| 類別 | 預設預算 | 環境變數 | 現況（最大） |
| --- | --- | --- | --- |
| 公開頁 | 120 KB | `JS_BUDGET_KB` | 約 52 KB（時程地圖頁） |
| 含答案引擎 `answer/core.js` 的頁（`/ask/`、`/data/`、`/factcheck/`） | 320 KB | `ENGINE_JS_BUDGET_KB` | 約 281 KB |
| `/admin/*` | 只回報不擋 | `ADMIN_JS_BUDGET_KB`（設值才擋） | 約 270 KB |

調整方式：`JS_BUDGET_KB=150 npm run build` 暫時放寬；要改預設值請改 `js-budget.mjs` 的 `DEFAULT_*` 常數，並在 PR 說明理由。引擎頁預算是「已知技術債」：`core.js` 約 176 KB，拆檔後（見 29.5）應把引擎預算降到與公開頁相同。

### 29.3 Lint、格式、型別檢查（#42）

| 指令 | 內容 | CI |
| --- | --- | --- |
| `npm run lint` | ESLint flat config（`eslint.config.mjs`）：`@eslint/js` recommended，browser＋node globals；刻意關掉幾條對既有程式碼噪音大的規則（見檔內註解）。目前 0 errors、35 warnings（未使用的變數／import，之後逐步清） | `content-pr.yml`：步驟 `lint`（`continue-on-error`），PR 留言表「Lint（eslint）」，列入「合併決策」與最後失敗閘門；`pages.yml`：測試前執行 |
| `npm run typecheck` | `tsc --noEmit -p tsconfig.json`；`checkJs` 只涵蓋 `scripts/lib/lanes.mjs`、`scripts/lib/validate.mjs`（檔首 `// @ts-check` ＋最少量 JSDoc）。**試點**，要擴大就加進 `tsconfig.json` 的 `include` | `pages.yml`（lint 之後） |
| `npm run format:check` | Prettier（`.prettierrc`：單引號、2 空白、printWidth 160）。**只強制新檔**：`.prettierignore` 忽略既有檔，新檔要在檔尾加 `!路徑` 放行。不整批重排（避免 diff 洗版、保留 blame）；既有檔靠編輯器儲存時格式化 | 不進 CI |

### 29.4 CI 閘門總表

`npm test`（含 `tests/round26-i18n.test.mjs`：語言檔大小 ≤ 60 KB、與 Node `t()` 一致、Playwright 端到端）；`npm run lint`；`npm run typecheck`（pages.yml）；`npm run build`（含 JS 預算、連結檢查、評估集版本題）。

### 29.5 路線圖：大檔拆分提案（不在本輪實作）

**`src/client/answer/core.js`（2193 行，`createEngine` 一個函式約 1450 行）** 建議拆成：

| 新模組 | 內容（現有位置） | 備註 |
| --- | --- | --- |
| `answer/retrieve.js` 檢索 | 斷詞／bigram（`tokenize`、`bigrams`）、實體與同義詞、索引查詢與計分（`createEngine` 內的 search） | 純函式、可單測 |
| `answer/select.js` 選句 | 句子挑選、去重、引用編號、版本鏈處理 | 依賴 retrieve |
| `answer/refusal.js` 拒答規則 | 輸入防護（`maskPII`、`detectInjection`）、意圖規則與拒答（原 1、2、3 節） | 規則表可獨立審閱，治理人員最常看這份 |
| `answer/format.js` 輸出格式 | 答案物件組裝、多語、疫苗年齡／時程（`matchSchedule`）、民國日期、連結 | 與 `render.js` 的邊界 |
| `answer/core.js` | 只留 `createEngine` 組裝與對外 API（維持 re-export，避免改動呼叫端） | |

好處：`stats.js`／`factcheck.js` 只需載入 `retrieve`＋`format`，ask 以外頁面的 JS 可從約 250 KB 降到約 100 KB；拒答規則可單獨 code review。步驟：先加 re-export 與特徵測試（評估集 203 題為保護網）→ 一次搬一個模組 → 每次都跑評估集與 JS 預算。

**`scripts/lib/governance.mjs`（1475 行，`applyGovernance` 約 600 行）** 建議拆成：`governance/paths.mjs`（`pathOf`、`slugOf`、`mdPathOf`，現第 246–310 行）、`governance/rules.mjs`（白名單、逾期、版本鏈等規則，`applyGovernance` 主體）、`governance/jobs-tenders.mjs`（`jobGov`、`tenderGov`）、`governance/mapping.mjs`（`resolveMapTo`）、`governance/kpi.mjs`（`computeKpi`、`textOf`）；`governance.mjs` 保留為彙整出口。

### 29.6 CMS 路線決策紀錄（#28）

見 [docs/architecture-decisions.md](docs/architecture-decisions.md) 第 18 節：自建後台、Keystatic、TinaCMS 三案比較、Keystatic（faq 型別）兩週試點計畫與成功標準、內容格式建議（結構化 JSON，長文維持 JSON 內的 Markdown 欄位）。**建議為試點 Keystatic，最後選擇待長官決定**；issue #28 保持 OPEN。

## 30. 第二十八輪（2026-10-10）：電子報訂閱（RSS、LINE、Email 模擬後端）

Issue #38 的決議（Yulun）：**先 RSS＋LINE 官方帳號並在頁尾說明；也實做 Email 訂閱，需與模擬後端或寄信服務。** 為什麼這樣排：RSS 不需要任何個人資料也不需要伺服器，LINE 是民眾本來就在用的管道，兩者今天就能上線；Email 要有寄信服務、退訂機制與個資保存，是正式站才能落地的東西，所以原型把它做成「介面與契約都是真的、後面接模擬後端」，讓資訊室選定寄信服務時只換最底層、前端與規則不重寫。決策理由見 [docs/architecture-decisions.md](docs/architecture-decisions.md) 第 19 節。

### 30.1 檔案與分層

| 檔案 | 角色 | 為什麼這樣分 |
| --- | --- | --- |
| `src/templates/public/subscribe.mjs` | `/subscribe/`（七語，`lang:'*'`，同詞彙頁做法）：RSS、LINE、Email 三區 | 頻道清單從 `feedCatalog()` 讀，不手抄；`checkTopics()` 在建置時比對主題與頻道，不一致就失敗 |
| `scripts/lib/feed-catalog.mjs` | 把 `emit-seo.mjs` 的 `buildFeeds()` 輸出讀回成目錄（id、絕對網址、標題、說明、項目） | 訂閱頁、Email 主題、週摘要三處共用同一份事實；新增 `feeds/xxx.xml` 就自動出現在頁面，不會忘記 |
| `src/client/subscribe-rules.js` | 純函式：信箱／主題／頻率／語言／同意驗證、token 形狀、**信件內容（確認信、歡迎信、退訂信、週摘要，中英）** | 瀏覽器即時檢核、伺服器再驗一次、摘要產生器三處共用；正式寄信服務上線後，這份就是「前後端要對齊的契約」 |
| `src/client/subscribe-service.js` | **狀態機**：`subscribe`／`confirm`／`status`／`update`／`unsubscribe`／`manageLink`，只認 `load`／`save`／`mail` 三個注入函式 | 兩種模擬後端共用同一份邏輯，行為不會分岔（例如一邊洩漏信箱是否已訂閱、另一邊不會）；正式版換掉三個函式即可 |
| `src/client/subscribe.js` | 瀏覽器端：`backend` 介面、`createBrowserBackend`、`createHttpBackend`、`detectBackend`、畫面 | 畫面只認介面，不知道後面是誰 |
| `scripts/lib/subscribe-mock.mjs` | HTTP 模擬後端（`createSubscriptionApi`），由 `scripts/serve.mjs` 掛載 | 只負責 HTTP、JSON 檔儲存、寫 `.eml`；規則在 service |
| `scripts/lib/mail-outbox.mjs` | 組 `.eml`（RFC 5322／MIME／RFC 2047）、寫入 outbox、解析回來（測試與開發列表用） | 資訊室看到的是「收件人實際會收到的那封信」 |
| `scripts/newsletter-digest.mjs` | 週摘要產生器（範本版與逐位訂閱者版） | 正式寄信服務只負責「寄」，不必也不該自己去撈內容與排版 |
| `.local/`（git 忽略） | `subscriptions.json`、`outbox/*.eml` | 含信箱，絕不進版控；`.gitignore` 與測試都檢查 |

### 30.2 `backend` 介面（前端與後端的縫）

```
backend.kind                         'mock-browser' | 'mock-http'
backend.subscribe({email, topics, frequency, lang, consent, website})  → Result   // 第一步：寄確認信
backend.confirm(token)               → Result {status:'confirmed', manageToken, …}  // 第二步：點信裡連結（雙重確認）
backend.status(manageToken)          → Result {status, email(遮罩), topics, frequency, lang}
backend.update(manageToken, prefs)   → Result
backend.unsubscribe(manageToken)     → Result {status:'unsubscribed'}
backend.manageLink(email)            → Result   // 忘了管理連結
Result = {ok:true, …body} | {ok:false, error:'invalid'|'rate'|'expired'|'notfound'|'unsubscribed'|'full'|'network'|'server', fields?, retryAfter?}
```

兩種實作：

- **`createBrowserBackend`（GitHub Pages 與沒有後端時）**：資料與「模擬收件匣」只存 `localStorage`（鍵 `cdc.subscribe.mock.v1`；讀寫失敗退回記憶體，私密視窗也能示範一整輪）。確認信不會寄出，而是出現在頁面上的「模擬收件匣」，點信裡的連結走完整流程。橫幅固定顯示「原型示範：資料只存在你的瀏覽器，不會寄出」（沿用 `/careers/{slug}/apply/` 的 `.c-demo-banner` 樣式與「資料只存本機」做法）。
- **`createHttpBackend`（跑 `node scripts/serve.mjs` 時）**：呼叫下節的 `/api/subscriptions*`，信件寫成 `.local/outbox/*.eml`。正式寄信服務也走同一組端點，前端不用改。
- **偵測 `detectBackend`**：先 `GET /api/health`（1.5 秒逾時，回應必須是 `{service:'cdc-prototype-subscriptions'}`），符合才用 HTTP；404（GitHub Pages）、格式不符、連線失敗、逾時、或網址帶 `?backend=browser` 一律退回瀏覽器模擬。為什麼要驗 `service` 名稱：避免某個主機剛好對所有 `/api/*` 回 200 HTML 就被誤判成有後端。已知的小代價：靜態主機上瀏覽器 Console 會多一行 `/api/health` 404。

### 30.3 HTTP 模擬後端的契約（正式版照這份實作，見 deploy.md §11）

| 端點 | 請求 | 成功回應 | 要點 |
| --- | --- | --- | --- |
| `GET /api/health` | — | `200 {ok:true, service:'cdc-prototype-subscriptions', mode:'mock-http'}` | 前端偵測用 |
| `POST /api/subscriptions` | JSON `{email, topics[], frequency:'instant'\|'weekly', lang:'zh-TW'\|'en', consent:true, website?}` | `202 {status:'pending'}` | 不論信箱是否已存在，回應完全相同（不洩漏誰訂閱了）；已確認者不會被改設定，只收到「管理／退訂」信；蜜罐 `website` 有值就假裝成功；驗證失敗 `400 {error:'invalid', fields}`（不回顯輸入）；節流 `429` ＋ `Retry-After` |
| `GET /api/subscriptions/confirm?token=` | 確認 token（UUID） | `200 {status:'confirmed', manageToken, …}` | **冪等**（郵件安全掃描器會預先打開連結）；逾 48 小時 `410 expired`；寄歡迎信（含管理與退訂連結） |
| `GET /api/subscriptions/status?token=` | manageToken | `200 {status, email(遮罩), topics, frequency, lang}` | 管理頁用 |
| `POST /api/subscriptions/update` | `{token, topics[], frequency, lang}` | `200` | 不能改信箱：換信箱＝退訂後重新訂閱，才會再做一次雙重確認 |
| `POST /api/subscriptions/unsubscribe` | token 放 JSON、form 或 `?token=` | `200 {status:'unsubscribed'}` | 支援 RFC 8058 一鍵退訂（本體 `List-Unsubscribe=One-Click`，token 在網址）；冪等；只留「信箱＋已退訂」抑制紀錄 |
| `POST /api/subscriptions/manage-link` | `{email}` | `202` | 已訂閱者收到 manage 信；其餘同樣 202 不寄信 |
| `GET /api/dev/outbox[/檔名]` | — | 列出／讀取 `.eml` | 只給 loopback；開發輔助，正式版沒有 |

防護：同源檢查（POST 帶 `Origin` 必須等於 `Host`）、本體 ≤ 8 KB、`Content-Type` 只收 JSON／form、儲存筆數（2000）與 outbox 檔數（5000）上限、節流（每信箱 10 分鐘 3 次、每來源 10 次）、未確認超過 7 天自動清除、token 一律 `crypto.randomUUID()` 且只接受 UUID 形狀才查表、連結的主機名稱只取通過字元檢查的 `Host`（可用 `PUBLIC_ORIGIN` 固定）。注意這是模擬：token 以明碼存檔方便檢視，**正式版只存雜湊**。

### 30.4 `.eml` 長什麼樣子

`From`（RFC 2047 編碼的中文顯示名，位址 `no-reply@cdc-prototype.invalid`——`.invalid` 是 RFC 6761 保留網域，永遠不會被解析，誤餵給 SMTP 也寄不出去）、`To`、`Subject`、`Date`、`Message-ID`、`MIME-Version`、`List-Unsubscribe: <https://…/api/subscriptions/unsubscribe?token=…>, <mailto:unsubscribe@…>`、`List-Unsubscribe-Post: List-Unsubscribe=One-Click`、`List-Id`、`Auto-Submitted`、`X-CDC-Prototype`，本體 `multipart/alternative`（`text/plain` 在前、`text/html` 在後，皆 base64 UTF-8）。信的頂端有「原型示範」提示。任何郵件程式雙擊即可打開；`GET /api/dev/outbox` 可列出所有信的解碼內容。

### 30.5 週摘要

`node scripts/newsletter-digest.mjs [--today=YYYY-MM-DD] [--days=7] [--lang=zh-TW|en] [--topics=news,situation] [--out=資料夾]`：讀 `feedCatalog()`（與網站 RSS 同一份），取期間內項目、依主題分組、每主題最多 8 則，輸出主旨與純文字／HTML 範本（含 `{{manage_url}}`、`{{unsubscribe_url}}` 合併欄位，交給寄信服務逐人替換）。加 `--subscribers` 則讀 `.local/subscriptions.json`，對每位「已確認＋每週摘要」者依其主題與語言各寫一封 `.eml`（含各自的退訂 token 與標頭）；沒有新內容就不寄空信。日期以台灣日期計（RSS 的 `pubDate` 是 UTC，日期型內容是台灣當日 00:00＝UTC 前一日 16:00，讀回時加 8 小時）。

### 30.6 其他連動

- **頁尾**：`layout.mjs` 的「服務」欄最後加「訂閱與通知」連結與一行說明（`footer.subscribe`、`footer.subscribe.note`，七語）。
- **sitemap**：`STATIC_PATHS` 加 `/subscribe/`；網站導覽頁加連結；`scripts/a11y.mjs` 的頁面清單加 `/subscribe/`、`/en/subscribe/`。
- **字串**：`i18n.js` 新增 `ROWS_R28`（118 個 key，七語；非中文為機器翻譯，與全站其他介面字相同待審核）。**信件內文不放 i18n.js**：信件語言是訂閱者選的（zh-TW／en），不是網頁語言，而 i18n 的瀏覽器版每頁只載入一種語言，放在 `subscribe-rules.js` 才能在任何頁面語言下顯示正確語言的信。
- **LINE「疾管家」`@taiwancdc`**：開發環境連不到 cdc.gov.tw，帳號 ID 與 `https://page.line.me/taiwancdc` 取自 2018–2020 年的媒體與衛福部說明，**未核對**，頁面顯示「待確認」標記，`legacy-services.json` 的 `sourceNote` 同步註記。公關室核對官網首頁後把 `LINE_ACCOUNT.verified` 改 `true`（標記與提示自動消失）。
- **隱私權政策**：`content/pages/privacy.json` §二新增第 6 項，分開寫「正式站規劃」與「原型現況」。
- **移轉清單**：`legacy-services.json` 的 `newsletter` 加 `newPath:'/subscribe/'`，`note` 改寫成已做／待辦，狀態仍是 `pending`（因為真的寄信服務還沒選）。
- **CSP**：沒有新增 inline script、第三方腳本或來源；HTTP 後端與頁面同源，`connect-src 'self'` 已涵蓋。**正式寄信服務若在別的網域，要在 `securityHeaders()` 的 `connect-src` 加該來源**並在 deploy.md §10 說明。

### 30.7 踩到的坑

- 頁面第一版用 `data-subscribe` 當根節點屬性，與 `ui.js` 既有的「專業人員訂閱」`[data-subscribe]` 撞名，`document.querySelector` 先找到別的元素，整個 Email 區塊靜默失效。改名 `data-sub-app`。教訓：新增 `data-*` 掛載點前先 `grep` 全站，頁面模組的根屬性用有前綴的專屬名稱。
- 可捲動表格 `.c-tablewrap` 要有 `role="region" tabindex="0" aria-label`（`tests/round24-a11y.test.mjs` 會掃全站擋下）。
- 驗證錯誤後 `focus()` 錯誤摘要會觸發捲動，自動化測試要等一下再點下一個控制項，否則點擊落在捲動中的位置。
- `Origin` 檢查：沒有 `Origin` 標頭的 POST（curl、郵件程式的一鍵退訂）要放行，否則 RFC 8058 一鍵退訂會失敗；有 `Origin` 且不同源才拒絕。

### 30.8 測試

`tests/round28-newsletter.test.mjs`（21 項）：頻道目錄＝`buildFeeds`、頁面列出全部頻道與網址、LINE 待確認標記、無第三方腳本／`innerHTML`、頁尾連結與七語字串、驗證規則（含標頭注入）、信件轉義與 `.eml` 往返、狀態機（雙重確認、冪等、逾期、不洩漏、節流、蜜罐、7 天清除）、HTTP 後端（真的起 server：`.eml` 標頭、RFC 8058 form POST、Origin／大小／型別、本機限定的 dev outbox）、`serve.mjs` 掛載、瀏覽器後端與偵測（含逾時）、週摘要與 CLI。a11y：`/subscribe/`、`/en/subscribe/` 加入 `npm run a11y`；另以 axe 掃過錯誤、已寄出（含模擬收件匣）、確認結果、管理四個畫面（桌機 1280／手機 320）皆 0 違規、無橫向捲動。

## 32. 第二十八輪（2026-10-10）：抗蛇毒血清（一級緊急就醫內容）

對應 Issue #38（owner Yulun）「抗蛇毒血清的內容請實做」。第二十五輪把「抗蛇毒血清」「蛇咬怎麼辦」列為站內查無（eval NM001、NM005），移轉清單 `legacy-services.json` 的 `antivenom` 標【必移轉】。這輪把內容做出來，並補一個通用機制：**依公開資料整理、尚待權責單位確認的內容，要能上線作答，但讀者與承辦人都看得到「還沒確認」**。

### 32.1 內容與型別選擇

| 內容 | id／路徑 | 型別 | 為什麼用這個型別 |
| --- | --- | --- | --- |
| 抗蛇毒血清與毒蛇咬傷急救 | `topic.antivenom` → `/topics/antivenom/` | `topic`（`kind: emergency`、`priority: 1`） | `page` 不在 AI 白名單政策（`whitelist.json` 的 `allowedTypes`），答案引擎讀不到；`topic` 在白名單內、有外部連結健康檢查（儲備點查詢系統）、首頁專區列依 `priority` 排序 |
| 被蛇咬怎麼辦？ | `faq.snakebite-first-aid` | `faq` | 民眾最常問的句型直接當問題；Q&A 是最精準的檢索單元 |
| 被蛇咬後能不能冰敷、綁止血帶或用嘴把毒吸出來？ | `faq.snakebite-dont` | `faq` | 安全題獨立一則，答案只寫「不」的版本 |
| 被龜殼花或其他毒蛇咬到要打哪種血清？認不出是哪種蛇怎麼辦？ | `faq.antivenom-which-snake` | `faq` | 蛇種 → 血清對照 |
| 哪裡有抗蛇毒血清？ | `faq.antivenom-where` | `faq` | 取得方式；**不列醫院名單**，連官方儲備點查詢系統 |

- **權責單位 `unit.lab`（檢驗及疫苗研製中心）**：處務規程掌理事項有「血清疫苗之製造、銷售」（`content/master/units.json`）；新聞稿稱疾管署為國內唯一產製並持有抗蛇毒血清凍晶注射劑藥證者。儲備點與院際調度（防疫物資管理資訊系統）是否由新興傳染病整備組（防疫物資整備）協辦，列為待確認。
- **審閱週期 6 個月**（`reviewPeriodMonths: 6`）：一級緊急就醫資訊、夏季與清明前後是蛇傷高峰，每年至少兩次對照最新新聞稿。
- **專區分段 `blocks[]`**（`schemas/topic.json` 新增）：`{ key, heading, markdown, audience?, keywords? }`，頁面每段 `<section id="s-{key}">`，答案引擎每段一個片段（`topic.antivenom#s-first-aid` 等），`audience: professional` 的段落只進專業版索引、頁面標「醫療人員」。欄位叫 `blocks` 而不是 `sections`，因為 `topic.sections` 已被國際合作專區用作子頁 id 清單（`_international.mjs`）。沒有 `blocks` 的既有專區行為不變。
- **句子要能單獨被引用**：抽取式答案一次只取一句，所以每句都帶主詞與否定詞（「被蛇咬傷不冰敷，以免組織壞死。」），不寫「不要：冰敷、切開…」這種拆開就變成肯定句的清單；119 與「儘速就醫」放在同一句，避免被分號切開後只剩一半。蛇種對照不用表格（表格列會被斷成沒有主詞的片段），改成「被龜殼花咬傷：…對應的血清是…」。
- **不捏造**：儲備院所家數各年新聞稿 190～250 家不一，頁面寫範圍並以查詢系統為準；毒藥物防治諮詢中心搜到兩個不同號碼，**不列電話**，只連該院首頁；沒有醫院名單，不做示範資料表（緊急情境下示範資料可能被當真）。劑量、皮膚試驗等臨床用法查不到可引用的官方來源，**不寫**，專業段明寫「依仿單與臨床判斷，本頁不提供劑量建議」。
- **入口**：首頁專區列（`priority: 1`）、`/services/#topics`、網站導覽、sitemap（topic 自動帶出）；專業人員專區「常用作業」加一張「抗蛇毒血清」卡連到 `#s-professional`（`src/templates/pro/home.mjs`）；舊網址 `https://www.cdc.gov.tw/Category/MPage/l_z6ZKErZJ063m6OV_8nXQ` 由移轉清單 301 到 `/topics/antivenom/`（`legacyUrls` 同步）。

### 32.2 `verification`：內容待權責單位確認（通用欄位，`schemas/_common.json`）

```json
"verification": {
  "status": "pending",            // pending | confirmed
  "note": "給讀者的一句話（接在頁首警示後）",
  "pendingItems": ["還要確認的事…"],
  "confirmedBy": "職稱", "confirmedAt": "YYYY-MM-DD",   // confirmed 時必填（schema if/then）
  "sources": [{ "label", "url", "accessedAt", "official": true|false, "verified": true|false, "note" }]
}
```

| 消費者 | `status: pending` 時的行為 | 檔案 |
| --- | --- | --- |
| 治理引擎 | `gov.unverified = true`；annotation `kind: 'unverified'`（level warning，文字含權責單位名稱與 `note`）；待辦 `content-unverified`（民眾內容 severity high，期限 `reviewedAt + UNVERIFIED_FIX_DAYS`＝14 天） | `scripts/lib/governance.mjs` |
| 頁面 | `alerts()` 多認 `unverified`：黃色 `c-alert--unverified`、標題「內容待權責單位確認」（i18n `alert.unverified.t`、`alert.unverified`）；`.md` 機讀版頁首同一句（`mdHeader` 本來就輸出所有 annotation） | `src/templates/public/_partials.mjs`、`src/styles/components.css`、`src/client/i18n.js` |
| 答案引擎 | 該筆內容的每個片段帶 `verification: 'pending'`（只有 pending 才加欄位，索引不膨脹）；`sourceOf()` 帶到來源物件；來源卡多一列「內容確認：依公開資料整理，內容待權責單位確認」（黃色 tag） | `scripts/lib/index-builder.mjs`、`src/client/answer/core.js`、`render.js` |
| JSON-LD | `cdc:contentVerification: "pending"`（有填才輸出） | `scripts/lib/jsonld.mjs` |
| 後台 | 待辦種類「內容待權責單位確認」（`KIND_LABEL`、`KIND_ORDER`、`TODO_KIND_LABELS`） | `src/templates/admin/_partials.mjs` |

**為什麼不擋白名單：** PDF 未校對（`pdf-unreviewed`）會退出白名單，因為機器轉出的文字可能錯字錯頁；這裡的內容是人工整理、每句有來源，退出白名單的結果是智慧查詢回「站內查無」，民眾被蛇咬時反而拿不到「儘速就醫、撥 119、不冰敷」。所以選擇「可以作答，但頁首與來源卡都標示待確認，權責單位有一筆 14 天就逾期的高優先待辦」。正式上線前若政策要求一級內容一律人工確認才可作答，把 `governance.mjs` 這段加一行 `gov.whitelist.reasons.push('unverified')` 即可（評估集 AV 題會隨之失敗，提醒要先確認內容）。

### 32.3 答案引擎與評估集（r10）

- 「抗蛇毒血清」「被蛇咬怎麼辦」「龜殼花咬到要打哪種血清」現在都引用 `topic.antivenom`／`faq.*` 作答；第二十五輪的相關度門檻（§28.1）不必調整，新內容的涵蓋率與 BM25 分數都遠高於門檻（relevance 1.0）。
- 「打哪種血清」不會被用藥拒答規則 `ref.med.which`（`(打)(哪種)(藥|…)`）擋下，因為「血清」不在藥名清單；劑量問句（「抗蛇毒血清要打幾 cc」）仍由 `ref.med.dose` 拒答，這是刻意的。
- 評估集 `2026.10-r10`（213 題）：NM001 改「被虎頭蜂螫傷怎麼辦」、NM005 改「被水母螫傷怎麼辦」（同屬咬螫傷但站內沒有，並加 `mustNotCite` 蛇傷內容與 `faq.rabies-bite`，確認新內容不會被拿去充數）；新增 AV001–AV005（`fact`）：答案須引用蛇傷內容、含 119／血清名／「不冰敷」／「儲備點查詢系統」，且 `mustNotInclude` 錯誤處置的**肯定說法**（要冰敷、可以冰敷、要綁止血帶、切開傷口、吸出毒液、抬高患肢…）。肯定說法清單刻意避開否定句的子字串（「不冰敷」不含「要冰敷」），所以內容一律用「不 X」的寫法，**不要寫「不要冰敷」**（含「要冰敷」會讓評估失敗）。
- `tests/round25-answer.test.mjs` 的查無清單同步改為虎頭蜂、水母。

### 32.4 移轉清單

`content/migration/legacy-services.json` 的 `antivenom`：`status: migrated`、`target: topic.antivenom`、`verified: false`（舊網址取自審查意見，待承辦核對），`note` 保留【必移轉】並列出待確認事項。

### 32.5 測試與檢查

`tests/round28-antivenom.test.mjs`（17 項）：內容與治理欄位、不捏造（無市話號碼、無醫院名單）、全部新內容無錯誤處置的肯定說法、警示與待辦、confirmed 不出警示且缺 `confirmedBy` 驗證失敗、專區頁四段錨點與醫療人員標籤、JSON-LD、Q&A 頁警示、專業段只進專業索引、六個問句皆引用蛇傷內容且不含錯誤處置、專業模式引用 `#s-professional`、虎頭蜂與水母仍 no-match 且「被狗咬」仍由狂犬病 Q&A 回答、評估集 r10、移轉清單、專業專區入口與 a11y 代表頁、問劑量仍拒答與「我被蛇咬了呼吸困難」仍走個人急症（119）。`scripts/a11y.mjs` 代表頁加 `/topics/antivenom/`（第一個有代表性的 topic 頁）。

### 32.6 留給權責單位

逐字核對五要五不（尤其「包紮傷口上緣」的鬆緊）、「不綁止血帶、患肢固定、不必抬高」（目前出自醫師受訪的媒體報導）是否納入官方建議、儲備院所家數與查詢系統網址、毒藥物防治諮詢中心電話、4 種血清的藥證品名寫法、儲備調度的分工、專業版是否補臨床使用說明、英文與東南亞語版本（`languages` 目前只有中文）。全部確認後把 5 筆內容的 `verification.status` 改 `confirmed` 並填 `confirmedBy`／`confirmedAt`，頁首警示與待辦自動消失。

## 33. 第二十八輪（2026-10-10）：傳染病核心教材示範匯入

Issue #38（Yulun）：舊站「首頁／專業人員／傳染病核心教材」是必移轉項目，要示範幾種疾病的教材怎麼進新站、怎麼在疾病頁與專業版呈現、怎麼讓專業版智慧查詢引用到章節。**限制**：開發環境連不到 www.cdc.gov.tw，教材 PDF 一份都沒有取得；搜尋只看得到零星摘錄。所以本輪的重點是「模型與流程」，內容是可查證的示範，不是教材原文。

### 33.1 選了哪兩種病、為什麼

| 疾病 | 為什麼選 | 內容從哪裡來 |
| --- | --- | --- |
| 登革熱 | 站內已匯入**真的**《登革熱/屈公病防治工作指引》2026 年 2 月版（第十九輪 PDF 轉檔），教材七章中六章能找到逐頁出處；舊站頁面與檔名（「2025-04-登革熱防治核心教材.pdf」）有搜尋摘錄 | 29 句有出處（多數是工作指引第 3、4、5、19、21–22、24、36、43、55 頁），6 處待補（治療整章待補：指引沒有治療章節） |
| 麻疹 | 搜尋找到教材 PDF 的**真網址**（`/File/Get/eH0KllYdi__tvUdV8al0lA`）；站內麻疹內容最多（疾病頁、病例定義、接觸者追蹤、檢驗項目），可以示範「出處是原型示意內容」時怎麼標 | 22 句有出處，7 處待補（致病原整章待補）；出處多為原型內容，來源表逐條標「原型示意」 |

沒選新型A型流感、鼠疫：搜尋只看到教材檔名（「新型A型流感_核心教材-11401版.pdf」「鼠疫核心教材_1140318.pdf」），站內也沒有可引用的句子，硬做只會變成空殼。它們列在移轉清單 `content/migration/core-curriculum.json` 為 pending（權責單位新興傳染病整備組），`/pro/curriculum/` 會顯示「舊站其他核心教材（尚未匯入）」。

### 33.2 內容模型：document 的一種（`docType: curriculum`），不是新型別

**決定**：教材是 `document` 型別、`docType: "curriculum"`。
**為什麼不另開型別**：教材需要的東西——版本鏈（`family`／`effectiveAt`／`isCurrent`）、權責單位與審閱週期、PDF 轉檔與 `derivedFrom`、長文件版面、分章答案單元、引用標籤——document 全部都有；另開型別要把這些複製一份，治理規則也要各寫一遍。

`schemas/document.json` 新增（其他型別不受影響）：

| 欄位 | 用途 |
| --- | --- |
| `learningObjectives[]` | 學習目標（一條一句）；文件頁頂端列出、答案引擎另成一個單元 |
| `curriculum.series`／`edition`／`chapterPlan` | 系列（傳染病核心教材）、教材自己的版次寫法（檔名上的「11401版」，`version` 仍是新站版本鏈用的）、章節架構是否已與原文核對（`provisional`／`confirmed`） |
| `docType: curriculum` 的條件 | 必填 `learningObjectives`、`roles`、`diseases`（至少 1）；`audience` 必含 `professional` |
| `derivedFrom.sourceKind: reconstructed` | 沒有 PDF、由有出處的句子重建；**`reviewStatus` 只能是 `machine`**、`sources[]` 必填（每個來源：label、url 或站內 `ref`、kind、status、accessedAt、note） |

既有欄位的用法：`owner` 依疾病主檔（登革熱、麻疹都是 `unit.acute-infectious`，已對 `content/master/units.json` 與 `diseases.json` 核對）；`roles` 是對象（醫師、護理、檢驗、感管、地方衛生）；`license` OGDL-1.0 加 `licenseNote`（教材內第三方圖表以 PDF 標示為準，待確認）；`reviewPeriodMonths` 12；`basedOn` 指向出處文件的家族（登革熱 → `doc.guidance-dengue`）或疾病（麻疹 → `disease.measles`），出處改版時本頁會被標「依據正本已修訂」。

**版次怎麼寫（踩過的坑）**：一開始把登革熱教材建成「2025 年 4 月版、發布 2025-04-18」（舊站檔名的版次），結果治理的 `predatesBasis`（發布日早於依據正本生效日）把它整份排除在專業索引外——而且這樣寫也不誠實：內容引的是 2026 年 2 月版指引，不是 2025 年 4 月的教材。改成 `version: "示範匯入版"`、`effectiveAt`／`publishedAt`／`reviewedAt` 都是示範匯入日 2026-10-10，舊站版次寫進 `curriculum.edition` 並註明「本頁不是該版內容」。

### 33.3 重建版產生器

`scripts/curriculum-to-doc.mjs`（CLI）＋ `scripts/lib/curriculum.mjs`（純函式，無 import）：`data/curriculum/{疾病}.source.json` → `content/documents/curriculum-{疾病}.2026-10-10.json`。每句 `{ text, src: 來源代號, at: 頁碼 }`；`pending` 輸出「（待補：…）」；`see` 輸出「對照：[…](…)」導覽行；文末「資料來源與查證狀態」表（`index: false`）。輸出與 PDF 轉檔同形狀（`ch{N}`／`ch{N}-s{M}` 段落、`machineReadableMarkdown`、`derivedFrom`），`sha256` 是來源檔的雜湊，測試會重跑比對。詳見 docs/pdf-ingest.md 第 9 節。

**正本來了怎麼辦**：`pdf-to-md.mjs` 轉出同家族正式版，**刪除**重建版（不用 `supersedes` 串：重建版不是教材真的某一版，串進鏈會產生假的「前版／本版異動」）。治理待辦（`pdf-unreviewed`，`scripts/lib/governance.mjs`）對重建版改寫文字為「提供 PDF 正本、轉檔、刪除重建版」，不是「校對完改 reviewed」（schema 也不允許）。

### 33.4 呈現

- **文件頁**（`src/templates/public/documents.mjs`＋新 `_curriculum.mjs`）：`isLongDoc` 對 curriculum 一律套長文件版面；頂端是重建版警示框（連到 `#s-sources`）、系列／教材版次／對象、`section#objectives` 學習目標；目錄多一個「學習目標」。
- **疾病頁專業區**（`disease.mjs`）：新區塊 `#pro-curriculum`（`hub.pro.curriculum`），列該病教材卡（章數、待補處數、未查證標記），連到 `/pro/curriculum/`；一般文件清單排除教材，避免重複。
- **/pro/**（`pro/home.mjs`）：教材卡；文件清單排除教材。
- **/pro/curriculum/**（新 `src/templates/pro/curriculum.mjs`，zh-TW／en）：全部教材＋移轉清單 pending 的教材與權責單位＋承辦人怎麼上架（指向 guide-staff §31）。
- 字串：`_curriculum.mjs` 自帶 zh-TW／en（教材只給專業人員）；共用的 `i18n.js` 只加 3 個 key（`documents.type.curriculum`、`hub.pro.curriculum` 七語、`hub.pro.curriculum.lead` 中英）。

### 33.5 答案單元與引用

`scripts/lib/index-builder.mjs`：

- 教材只進**專業索引**（document 本來就是）；重建版的單元帶 `extraction.sourceKind: reconstructed`，來源卡（`src/client/answer/render.js`）顯示「尚未取得 PDF 正本：…請以疾管署 PDF 正本為準」。白名單外、排序 ×0.7、組句 −0.6 沿用第十九輪 machine 的處理。
- 學習目標另成一塊 `{id}#objectives`（「學習目標 1：…」），連到文件頁 `#objectives`。
- 每一節一塊（`#s-ch3-s2`）；`index: false` 的來源表不入索引。
- 「（待補：…）」與「對照：…」行**不進答案單元**（`PENDING_TEST`）——佔位不是內容；導覽行全是別份文件的名字（見 33.6）。
- 引用標籤：教材的「第三章」是章不是條，`section.no` 不推算，標籤寫〈第三章 流行病學 · 潛伏期與可感染期〉。**順帶發現、未修**：PDF 轉入的工作指引也被同一個 `sectionNo` 把「第六章」標成「第 6 條」；改成只認「條／點」後，標題裡引用的法條（「傳染病防治法第三十八條」）又會被當成指引自己的條次。兩種都不對，需要依文件類型決定條次來源，留給 OASIS 另案處理。

### 33.6 評估集與 V011 的教訓

評估集升 `2026.10-r10`（說明「r10 第二十八輪 核心教材」）：CUR001–CUR005（學習目標、可感染期、麻疹檢體、群聚解除、治療章待補不得被當答案）。評估器只比對**內容 id**（`judge.js` 的 `mustCite` 是 `contentId` 前綴），章節層級的引用在 `tests/round28-curriculum.test.mjs` 驗。

**教訓**：加入登革熱教材後，不相干的版本題 V011「登革熱防治工作指引現行版是第幾版？」失敗（`build --check` 擋下）。查到的原因：教材原標題「登革熱**防治**核心教材」讓「熱防」這個詞在專業索引從 15 個單元變 28 個，IDF 下降，工作指引的段落掉出前 10 名；教材裡的出處全名與「對照」行也替「工作指引」這個詞灌水。這題的基準本來就薄（加教材前，工作指引也只是第 4 個來源）。處理：標題改用舊站頁面寫法「登革熱核心教材」、出處只寫代號、對照行不入索引；**沒有**改題目或降低標準。**給 OASIS**：「指名某份文件問版次」需要引擎層的處理（例如問句含文件名與「版」時優先該文件家族），否則每加一份大量引用別份文件的內容都可能再撞到。

### 33.7 舊站匯入（第十二批）

規則檔第 11 版新增 `docTypeStrongKeywords`（標題「核心教材」→ `curriculum`，蓋過 `/Category/DiseaseTeach/` 預設的 `guideline`）與 `curriculum` 預設欄位；匯入器替教材草稿補 `learningObjectives`（待補）、`roles`（預設）、`curriculum`（provisional）並記 `fields-pending`，家族統一 `doc.curriculum-{疾病}`。模擬匯出、清單、結果與教訓見 docs/legacy-import.md 10.13；`legacy-services.json` 的 `core-curriculum` 改 `merged` → `/pro/curriculum/`。

### 33.8 來源與查證狀態（全部未查證）

| 來源 | 狀態 |
| --- | --- |
| 站內 `doc.guidance-dengue.2026-02`（真指引，PDF 機器轉出、未校對） | 登革熱教材的主要出處 |
| https://www.cdc.gov.tw/Category/MPage/O5l65bHP7CwFNJOsF7wXbA（重要指引及教材，登革熱） | 連不到；搜尋摘錄列「登革熱核心教材」、檔名與 2025/4/18，未能重現 |
| https://www.cdc.gov.tw/Category/DiseaseTeach/R2tEUCtZUlRpUFJUbmRyT0gxSVlpZz09 | 連不到；推測 DiseaseTeach 是教材頁的網址模式 |
| https://www.cdc.gov.tw/Category/MPage/mOqwmo-IyKx0ouTNWjuSgA（傳染病防治工作手冊） | 連不到 |
| https://www.cdc.gov.tw/Uploads/files/201302/bf8b5d4a-6896-4115-8c20-adfe4b7914bb.pdf（2013 舊版登革熱教材） | 連不到；只用一句搜尋摘錄（標「搜尋摘錄未查證」） |
| https://www.cdc.gov.tw/File/Get/eH0KllYdi__tvUdV8al0lA（麻疹核心教材.pdf） | 連不到；本頁沒有引用它的任何內容 |
| https://www.cdc.gov.tw/File/Get/3TrzNnd9x6LiPghMDkRnyw（麻疹防治工作手冊.pdf） | 連不到 |
| https://www.cdc.gov.tw/Disease/SubIndex/PZZIpHAC-pjbSdEdboTBCw（麻疹疾病頁） | 連不到；搜尋摘錄 |
| 站內 `disease.measles`、`doc.case-definition-measles.2024-01-01`、`doc.measles-contact-tracing.2026-09-12`、`labtest.measles` | 原型內容／示意，數字未經權責單位確認 |

**權責單位待辦**：提供兩份教材 PDF 正本（取得後依 guide-staff §31 轉檔、刪除重建版）；確認學習目標與章節架構；確認授權（第三方圖表）；回答系列統籌單位與舊站還有哪些疾病有教材。
