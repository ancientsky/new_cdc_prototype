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
.github/workflows/pages.yml  建置＋部署；每日 03:00 UTC 排程重抓資料
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
| `/admin/situation/` | 態勢發布表單：四級狀態、依據門檻、資料日、下次審閱 → 預覽首頁卡 → 匯出 JSON |
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

`.github/workflows/pages.yml`：push main 與每日 03:00 UTC 觸發 → `npm ci` → `npm run fetch`（抓不到用快照）→ `npm test` → `npm run build`（含 `--check`）→ upload `dist/` → deploy-pages。basePath 由 `BASE_PATH` 環境變數決定（Pages 為 `/new_cdc_prototype`）。
