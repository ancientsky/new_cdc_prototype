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

- **放哪裡**：每筆內容的檔案放 `content/assets/{content-id}/`（例：`content/assets/news.2026-09-21-flu-antiviral-revised/press-release.pdf`、`…/chart-ili.png`）。建置時原樣複製到 `dist/files/{content-id}/{filename}`，公開網址 `/files/{content-id}/{filename}`（不含語言前綴，七語共用）。檔名規則：小寫英數、連字號、底線與點；不可有空白與中文（validate 擋下，給出建議檔名）。
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
