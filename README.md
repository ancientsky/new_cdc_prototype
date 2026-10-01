# 疾管署 AI-ready 新官網原型

**一句話：內容與資料只存一份（`content/`），網頁、API、機讀版、AI 檢索索引與治理儀表板都是它的「消費者」，由 `npm run build` 一次算出來。**

- 線上網址：<https://ancientsky.github.io/new_cdc_prototype/>
- 對應規劃文件：《疾管署官網 AI 應用與資料治理導入：盤點、規格與路線圖》（2026-09-22）與 11 頁 wireframe
- 狀態：**原型**。架構與規則是真實結構，疫情數字、通函、核准紀錄等為示意資料（見下方〈資料來源與示意聲明〉）

| 首頁（流感高峰 → 情境式首屏） | 答案頁（每句附來源編號） |
| --- | --- |
| ![首頁](docs/screenshots/home.png) | ![答案頁](docs/screenshots/answer.png) |

| 疾病頁（八區塊＋一分鐘重點＋三層露出） | 失效版文件（自動警示、noindex、版本鏈） |
| --- | --- |
| ![登革熱](docs/screenshots/disease-dengue.png) | ![失效版](docs/screenshots/document-superseded.png) |

| 專業人員專區 | 後台：連動待辦（MMR 事件自動產生） |
| --- | --- |
| ![專業專區](docs/screenshots/pro.png) | ![連動待辦](docs/screenshots/admin-todos.png) |

更多：[治理儀表板](docs/screenshots/admin.png)、[手機首頁](docs/screenshots/home-mobile.png)、[越南文首頁](docs/screenshots/home-vi.png)。

## 這個原型示範什麼

1. **治理是欄位，不是另一個系統。** 每筆內容必填權責單位、最後審閱日、審閱週期、對象、狀態、授權。缺一個，建置失敗，上不了線。
2. **人只填一次，機器算其餘。** 下次審閱日、逾期、失效版本、衍生內容待辦、AI 白名單資格、翻譯是否過期、KPI、季報，全部由欄位在建置時推導。
3. **AI 只轉述、不創作。** 預設答案引擎是「抽取式」：每句話就是白名單內容的一句原文並附來源編號；可選接 LLM（自備金鑰），輸出每句必須對得到檢索片段，對不上就刪。

## 快速開始

需求：Node.js 20 以上。

```bash
npm ci            # 安裝依賴（只有 ajv、ajv-formats、marked）
npm run build     # 建置到 dist/
npm run dev       # 建置並啟動預覽 http://localhost:4173/new_cdc_prototype/
```

其他：`npm test`（治理規則測試）、`npm run check`（只驗證不輸出）、`npm run eval`（跑評估集）、`npm run fetch`（抓官方資料快照）。想用根路徑預覽：`BASE_PATH='' npm run build && node scripts/serve.mjs`。

詳見 [docs/deploy.md](docs/deploy.md)。

## 三種使用者入口

| 你是 | 從這裡開始 | 說明文件 |
| --- | --- | --- |
| 民眾 | [首頁](https://ancientsky.github.io/new_cdc_prototype/)：一句話提問、現在的疫情、六個任務、謠言查證 | [docs/guide-public.md](docs/guide-public.md) |
| 醫師、護理、感染管制、檢驗、地方衛生單位 | [專業人員專區](https://ancientsky.github.io/new_cdc_prototype/pro/)（或網址加 `?view=pro`）：版本異動對照、訂閱、專業問答、常用作業 | [docs/guide-professional.md](docs/guide-professional.md) |
| 同事（Steward、公關室、資訊室、OASIS、疫情中心） | [後台](https://ancientsky.github.io/new_cdc_prototype/admin/)：上架預處理、待辦、審閱到期、態勢發布、AI 開關、評估 | [docs/guide-staff.md](docs/guide-staff.md) |

另有給開發者與研究者的 [開發者入口](https://ancientsky.github.io/new_cdc_prototype/developers/)（API、OpenAPI、`llms.txt`、JSON-LD、`cdc:` 詞彙）、[AI 透明報告](https://ancientsky.github.io/new_cdc_prototype/transparency/)與[使用指南](https://ancientsky.github.io/new_cdc_prototype/guide/)。

## 治理自動化清單

以下全部由建置時的治理引擎（`scripts/lib/governance.mjs`）自動完成，不需要人記得去做：

- 下次審閱日計算；逾期 → 頁首黃色警示、退出 AI 白名單、開待辦
- 文件新版發布 → 舊版自動標失效（紅色警示、`noindex`、退出索引、301 對照）
- 依據的正本被修訂 → 衍生新聞稿與 Q&A 自動加註、退出白名單、給 owner 7 日待辦
- 反向稽核：宣告過的失效說法（如 MMR「1981 年」）掃全站命中即開待辦
- 譯文 `sourceHash` 對不上 → 標示「中文已更新，譯文待複核」；一級內容未審核不渲染該語言頁
- 資料集更新逾期與授權不合規 → 待辦
- AI 暫停開關 → 全站橫幅，答案頁退回傳統列表
- KPI 與季度 AI 透明報告每次建置重算
- 評估集閘門：版本題只要錯一題，建置失敗

## 目錄

```
ARCHITECTURE.md      架構與約定（人與 AI 協作者的共同契約，動手前先讀）
site.config.mjs      站台設定：basePath、語言、網址
schemas/             JSON Schema，content/ 每種型別一份
content/             ★ 內容與資料的單一事實來源（人維護）
data/snapshots/      每日抓回的官方資料快照
scripts/             build.mjs、serve.mjs、fetch-data.mjs、lib/（治理、API、SEO、渲染）
src/templates/       public／pro／admin 頁面模板（自動登錄）
src/client/          瀏覽器端：答案引擎、後台、專業專區互動
eval/                評估集執行（與瀏覽器共用答案引擎核心）
tests/               node:test 治理規則測試
docs/                使用說明與治理文件
.github/workflows/   GitHub Pages 建置與部署（含每日排程）
```

完整說明見 [ARCHITECTURE.md](ARCHITECTURE.md)。

## 資料來源與示意聲明

- **官方來源資料**：旅遊疫情、國家等級、CKAN 資料目錄由 `scripts/fetch-data.mjs` 抓取到 `data/snapshots/`，每檔記錄來源與時間；抓不到時沿用既有快照。
- **示意資料**：疫情態勢的狀態與數字（頁面標「示意」）、致醫界通函卡片、專區的「○○醫院」登入畫面、白名單核准日期、評估集題目與通過率。**不可當作真實疫情或機關決議引用。**
- **內容文字**：範例中的疾病、疫苗與 MMR 建議內容依公開資訊撰寫，用於示範版本鏈與連動；正式上線前須由權責單位逐字審閱。
- 本原型不放真人姓名與個資，承辦人以職稱表示。
- 本專案為概念驗證，與衛生福利部疾病管制署的現行官方網站無隸屬關係，內容不代表官方立場。

## 授權

網站內容與 API 資料預設採**政府資料開放授權條款第 1 版（OGDL-1.0）**，個別資料集另有標示（CC0-1.0、CC BY 4.0）。引用請附頁面網址與最後審閱日，格式見[開發者入口](https://ancientsky.github.io/new_cdc_prototype/developers/#license)。

## 文件

| 文件 | 內容 |
| --- | --- |
| [docs/guide-public.md](docs/guide-public.md) | 民眾使用說明（含七語與無障礙） |
| [docs/guide-professional.md](docs/guide-professional.md) | 公衛醫療人員使用說明（引用、訂閱、核對版本） |
| [docs/guide-staff.md](docs/guide-staff.md) | 同事操作手冊與各項 SOP |
| [docs/governance-model.md](docs/governance-model.md) | 資料治理模型：欄位、規則、KPI、白名單、授權、個資 |
| [docs/architecture-decisions.md](docs/architecture-decisions.md) | 為什麼這樣做；示意與真實的區分 |
| [docs/deploy.md](docs/deploy.md) | 部署與維運、新增內容型別、改 schema |
| [docs/roadmap-mapping.md](docs/roadmap-mapping.md) | 原型功能與三階段路線圖對照 |

## 貢獻方式

內容改動走 Pull Request：改 `content/` → CI 驗證（schema、治理規則、評估集）→ 複核者核准 → 合併即發布。程式改動請先讀 ARCHITECTURE.md 第 7、10 節的約定（連結一律用 `ctx.url()`、插值一律跳脫、治理邏輯只放在引擎）。
