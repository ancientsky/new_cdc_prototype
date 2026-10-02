# 新官網原型 × 疫苗及流感藥劑地圖（vaxmap-next）整合方案

給同事（預防接種組、疫情中心、公關室、OASIS）與資訊室看。分四層，由「現在就能做」到「要一起治理」；最後一節是分階段時程。

- 本站（新官網原型）：<https://ancientsky.github.io/new_cdc_prototype/>
- vaxmap-next（改良版接種點地圖，**概念原型、非官方站**）：<https://ancientsky.github.io/vaxmap-next/>
- 設定位置：本站 `site.config.mjs` 的 `vaxmapUrl`、`vaxmapInfoUrl`；模板用 `src/templates/public/_partials.mjs` 的 `vaxmapLink()`／`vaxmapButton()`；答案引擎用 `src/client/answer/core.js` 的 `vaxmapHref()`（client 端無法 import site.config，網址寫死並加註，可用 `window.CDC.config` 覆寫）。

## 0. 為什麼要整合、原則是什麼

兩站解決不同的問題：本站回答「該不該打、誰有公費、要打幾劑」（內容有 Owner、審閱日、版本鏈）；vaxmap 回答「離我最近、今天有看診、有庫存的院所在哪」（每日兩次快照、地圖、八語）。

三條原則：

1. **本站不自己列院所。** 庫存每天變，列出來就是過期資訊。本站只負責把人帶到對的地方（深連結）、說清楚資料有多新。
2. **一個事實只存一份。** 疫苗名稱與公費對象的正本在本站 `content/master/vaccines.json`；院所與庫存的正本在 vaxmap 的 data 分支。兩邊互相引用，不複製。
3. **連過去的人不能迷路。** 按鈕一律標示「開新視窗 ↗」，語言互帶，vaxmap 有路回本站。

---

## 1. 連結層（現在就能做，第一階段已完成大半）

### 1.1 深連結規則

可分享網址的狀態全部放在 hash（`#` 後面），依 vaxmap `public/js/logic.js` 的 `encodeState`／`decodeState`：

```
https://ancientsky.github.io/vaxmap-next/#g=flu,covid&p=flu,pcv20&today=1&stock=1&city=臺北市&dist=大安區&q=關鍵字&id=院所id&map=lat,lng,z&lang=en
```

| 參數 | 值 | 備註 |
| --- | --- | --- |
| `g` | `flu` 流感疫苗、`covid` COVID-19 疫苗、`pcv` 肺炎鏈球菌疫苗、`antiviral` 流感抗病毒藥劑 | 可多選（逗號） |
| `p` | `flu`、`mod_adult`、`mod_child`、`novavax`、`pcv20`、`pcv21`、`antiviral` | 要鎖定到單一品項才用 |
| `today`、`stock` | `1` | 只看今日有看診、只看有庫存 |
| `city`、`dist` | 中文縣市、區（URL 編碼） | 沒有 `city` 時 `dist` 會被忽略 |
| `q`、`id`、`map` | 關鍵字（≤60 字）、院所 id、`緯度,經度,縮放` | 分享單一院所用 `id` |
| `lang` | `en` `ja` `ko` `id` `vi` `th` `tl`；繁中不寫 | 不認得的值被忽略 |
| 接種資訊專區 | `info.html#<錨點>&lang=<語系>`，錨點例：`where`、`coins`、`eligibility`、`precautions`、`faq`，或來源卡片 id | 見 vaxmap `docs/INFO_SCHEMA.md` |

不認得的參數值一律被 vaxmap 忽略，不會報錯；本站的 `vaxmapLink()` 也只輸出認得的群組與產品，不會產生壞網址。

**語言對應**：本站 `zh-TW`→不帶；`en`→`lang=en`；`ja`→`ja`；`vi`→`vi`；`id`→`id`；`th`→`th`；`tl`→`tl`。（vaxmap 另有 `ko`，本站沒有。）

**沒有地圖群組的疫苗**（MMR、HPV、B 肝、水痘、EV71、BCG、日本腦炎…）：vaxmap 目前沒有這些品項，連到 `info.html#where`（接種資訊專區：說明＋22 縣市衛生局連結），連結文字寫「接種資訊（vaxmap）」，不假裝地圖查得到。

### 1.2 本站所有接種點入口（已改）

| 入口 | 位置 | 連到 |
| --- | --- | --- |
| 流感疫苗頁「查詢接種地點」 | `/vaccines/influenza/` | `#g=flu`（＋`&lang=`） |
| 新冠疫苗頁 | `/vaccines/covid-19/` | `#g=covid` |
| 肺炎鏈球菌疫苗頁 | `/vaccines/pneumococcal/` | `#g=pcv` |
| MMR、HPV、B 肝、水痘、EV71 疫苗頁 | `/vaccines/{slug}/` | `info.html#where` |
| 流感宣導 Banner（首頁、宣導專區） | `content/banners/2026-flu-vaccine.json` 的 `cta.url` | 中文 `#g=flu`；英文 `#g=flu&lang=en` |
| 答案頁行動鈕「查附近接種點」 | `core.js` `actionsFor`（vaccine 意圖） | 依偵測到的疫苗：流感 `flu`、新冠 `covid`、肺鏈 `pcv`；其他疫苗 `info.html#where`；問句含抗病毒藥劑字眼 `antiviral`；語言依答案語言 |
| 答案頁行動鈕（疫情態勢意圖，流感） | 同上 | `#g=flu`、`#g=antiviral` |
| 疫苗頁來源卡、`.md` 機讀版「接種地點查詢」 | `vaccines.mjs` | 同上（依頁面語言） |
| 開發者入口、使用指南 | `/developers/#vaxmap`、`/guide/#find-site` | 深連結參數表／範例按鈕 |

尚未改、需要別的 Owner 處理：

- 態勢卡建議句「長者與幼兒儘速接種流感疫苗」（`content/situation`）目前沒有連結；建議第二階段加上「查附近接種點」並帶 `city`（見 3.4）。
- 評估集 `VA008`（`content/governance/eval-set.json`，OASIS／答案引擎 Owner）期望建議行動含 `antiflu`，連結改向後要改成 `vaxmap-next`。
- 旅遊醫學門診名單仍連疾管署官網，它不是 vaxmap 的品項。

### 1.3 vaxmap-next 反向連結（請 vaxmap 維護者加）

- 頁尾或「接種資訊」頁加三個連結，**都帶目前語言**：`疫苗與預防接種（新官網）` → 本站 `/vaccines/`（語言路徑：`/`、`/en/`、`/ja/`、`/vi/`、`/id/`、`/th/`、`/tl/`；本站沒有 ko，ko 使用者連 `/en/`）；`疾病百科` → `/diseases/`；`1922 防疫專線` → `tel:1922`。
- 地圖空結果、或使用者選了沒有庫存的品項時，顯示「公費對象與接種時程」→ 本站對應疫苗頁（用第 2 節的對照表決定連到哪一頁）。
- 語言切換互帶：本站切語言時，按鈕連結已依頁面語言重算；vaxmap 的語言切換（已有 `#lang=`）請同步更新上述連回本站的連結語言。

---

## 2. 資料層

### 2.1 疫苗主檔對照表

本站 `content/master/vaccines.json` 的 id 與 vaxmap `hospitals.json` 的 `groups`／`vaccines` id 對照（**目前寫在本站程式的 `VAXMAP_GROUP_OF` 與 core.js 的同名常數；第二階段改成主檔欄位**）：

| 本站主檔 id | vaxmap `group` | vaxmap 品項 id（`p=`） | 說明 |
| --- | --- | --- | --- |
| `vaccine.influenza` | `flu` | `flu` | 公費流感疫苗 |
| `vaccine.covid-19` | `covid` | `mod_adult`、`mod_child`、`novavax` | 三個品項分齡／廠牌，本站一頁 |
| `vaccine.pneumococcal` | `pcv` | `pcv20`、`pcv21` | 結合型肺炎鏈球菌疫苗 |
| （本站目前無「藥劑」主檔） | `antiviral` | `antiviral` | 流感抗病毒藥劑；建議本站主檔新增 `drug.influenza-antiviral` 並掛到 `disease.influenza`，才能有自己的公費使用對象頁 |
| `vaccine.mmr`、`hpv`、`hepatitis-b`、`varicella`、`ev71`、`bcg`、`je`、`dtap-hib-ipv`、`hepatitis-a`、`mpox`、`rabies` | 無 | 無 | vaxmap 沒有這些品項 → 連 `info.html#where` 或本站自己的頁 |

建議主檔新增選填欄位（schema 不破壞既有資料）：

```json
{ "id": "vaccine.covid-19", "vaxmap": { "group": "covid", "products": ["mod_adult", "mod_child", "novavax"] } }
```

### 2.2 共用 `vaccines.json`（本站為正本）

- 本站已輸出 `v1/vaccines.json`（疫苗頁：公費對象、時程）。建議 vaxmap 在建置時讀它，取得兩樣東西：**顯示名稱**（八語中本站有的語言）與**公費對象摘要**（例如品項卡片上的「65 歲以上公費」）。
- vaxmap 的品項名稱帶廠牌與型別（`Moderna LP.8.1(滿12歲以上)`），那是**院所庫存的單位**，不是疫苗主檔；兩者透過 2.1 的 `products` 對應，不要互相覆蓋。
- 契約：vaxmap 只讀、不改；本站改 id 或刪疫苗頁時，沿用現有的 `redirects.json` 與 `cdc:supersededBy` 機制通知；對照表出現沒有對應的 id 時，vaxmap 建置只警告、不失敗。
- 公費對象的正本只有本站一份。vaxmap 若自己寫了對象文字，下一次本站修訂就會不一致，這正是本站「反向稽核」要掃的事。

### 2.3 把 vaxmap 的 `hospitals.json` 登錄成資料目錄的一筆資產

本站資料目錄（`content/datasets/`）新增一筆，`v1/datasets.json` 與 `/data/` 頁就會列出，並受同一套時效告警（governance R6）：

```json
{
  "id": "dataset.vaccine-sites",
  "type": "dataset",
  "category": "vaccine",
  "title": "疫苗及流感藥劑接種點與庫存快照",
  "owner": "unit.vaccine",
  "license": "OGDL-1.0",
  "updateFrequency": "daily",
  "formats": ["JSON"],
  "canonicalUrl": "https://ancientsky.github.io/vaxmap-next/data/hospitals.json",
  "provenance": { "mode": "snapshot", "sourceUrl": "https://vaxmap.cdc.gov.tw/" },
  "lastUpdated": "<hospitals.json 的 meta.generatedAt 日期>",
  "summary": "全臺提供流感疫苗、COVID-19 疫苗、肺炎鏈球菌疫苗與流感抗病毒藥劑的院所：地址、電話、看診時段、有／無庫存。每日兩次快照。"
}
```

| 欄位 | 值 | 說明 |
| --- | --- | --- |
| Owner | `unit.vaccine`（預防接種組） | 資料內容的權責；技術維運是 vaxmap 維護者（原型階段）→ 日後資訊室 |
| 更新頻率 | 每日兩次 | 現有 `daily` 容許 2 天；vaxmap 的 `freshness.yml` 門檻是 **36 小時**，兩者要對齊（見下） |
| 授權 | 原型暫填 OGDL-1.0 | 資料源自 vaxmap.cdc.gov.tw 的公開資料，正式登錄前請預防接種組確認授權與是否可再散布 |
| 正本位置 | vaxmap 的 `data` 分支／Pages 發布的 `data/hospitals.json` | 本站不存副本，只存 metadata；`lastUpdated` 由排程讀 `meta.generatedAt` |
| 對外 API | `v1/vaccine-sites.json` | 第二階段先提供 metadata（筆數、縣市分布、資料時間）；第三階段才是完整查詢（見第 5 節） |

**時效告警對齊**：本站 `DATASET_FREQ_DAYS`（`scripts/lib/governance.mjs`）只有 `daily: 2`（天）。建議新增 `twice-daily: 1.5`（36 小時），或資料集欄位 `maxAgeHours`，並讓待辦文字寫小時。超過 36 小時未更新 → 產生待辦給預防接種組，與 vaxmap 每日 09:00 的 `freshness.yml` 失敗通知是**同一個門檻、兩邊各一道**：vaxmap 通知維護者「擷取壞了」，本站待辦通知 Owner「資料已不可信，請決定是否在疫苗頁加註」。

---

## 3. 呈現層

### 3.1 在疫苗頁嵌入「附近接種點」：三種作法

| | A. iframe 嵌入 vaxmap | B. 本站 fetch `hospitals.json` 自己畫簡表 | C. vaxmap 提供 Web Component |
| --- | --- | --- | --- |
| 做法 | `<iframe src="…/vaxmap-next/#g=flu&city=…">` | 瀏覽器 fetch 後篩縣市、排序、列前 N 筆 | `<vaxmap-nearby group="flu" city="臺北市">`，vaxmap 發布 JS |
| 開發量 | 最小（半天） | 中（資料量、距離、時段邏輯要重做一份） | 中高（要 vaxmap 維護 API 與版本） |
| 一致性 | 最高（同一份畫面） | 最低（兩份邏輯，庫存／時段判斷容易不一致） | 高 |
| 資安 | 見下方 CSP；iframe 要 `sandbox`、`title`、`loading=lazy` | 要處理 CORS；資料 1.9 MB（gzip 約 340 KB），每頁都載不合理 | 第三方 JS 進本站頁面，要審 |
| 無障礙 | iframe 內鍵盤陷阱與捲動巢狀，手機體驗差 | 可完全符合本站規範 | 取決於實作 |
| 效能 | 載入整個地圖（圖磚、JS） | 若只要「縣市計數」可預先算成小檔 | 可按需載入 |
| 風險 | 分析與隱私邊界不清（定位權限需 `allow="geolocation"`） | 本站變成第二個資料消費者，要負責資料新鮮度 | 版本相容 |

**CSP `frame-ancestors` 注意（作法 A）**：vaxmap 的安全建議（`README.md` 的 IIS 標頭一節）要求伺服器層設 `Content-Security-Policy: frame-ancestors 'none'`（或 `X-Frame-Options: DENY`）防點擊劫持。要被本站嵌入，必須改為允許本站網域，例如 `frame-ancestors 'self' https://<新官網正式網域>`，**不要**用 `*`。另外：`<meta>` 形式的 CSP 無法宣告 `frame-ancestors`，所以目前 GitHub Pages 上的原型其實沒有這層保護（也就不擋嵌入）；vaxmap 自己頁面內的 `frame-src 'none'` 是限制「它嵌別人」，與被嵌入無關。本站這邊的 CSP 需加 `frame-src https://<vaxmap 網域>`。

**建議（先輕量）**：先做「**按鈕深連結＋本站顯示該縣市接種點數與資料時間**」，不嵌地圖：

1. 按鈕：已完成（第 1 節）。
2. 縣市計數與資料時間：請 vaxmap 在每次快照時順手產出一個小檔 `public/data/summary.json`（約 2 KB）：
   ```json
   { "generatedAt": "2026-10-02T03:28:24Z", "count": 4653,
     "byCity": { "臺北市": { "flu": 0, "covid": 0, "pcv": 0, "antiviral": 0 } },
     "inStockByCity": { "臺北市": { "flu": 0 } } }
   ```
   本站疫苗頁（或首頁流感區）在瀏覽器 fetch 這個小檔，顯示「臺北市目前有 N 家院所提供流感疫苗（資料時間 2026-10-02 11:28，每日更新兩次）」，旁邊就是帶 `city` 的按鈕。fetch 失敗或資料超過 36 小時 → 不顯示數字，只留按鈕（優雅降級）。
3. CORS 與快取：GitHub Pages 預設對靜態檔回 `Access-Control-Allow-Origin: *`，原型不用額外設定；上正式環境要在 `data/*.json` 明確設 `Access-Control-Allow-Origin: https://<新官網網域>`、`Cache-Control: max-age=300`（vaxmap README 已建議資料檔短快取 60–300 秒；太長會讓庫存過期）。
4. 注意快照內容：**2026-09-21 的快照流感疫苗只有 6 家院所有品項**（公費疫苗 10/1 才開打）。計數元件在流感開打前後數字落差很大，必須和資料時間一起顯示，不能單獨顯示數字。

之後若要更豐富（列出最近 5 家），選 **C（Web Component）** 優先於 B，因為只有 vaxmap 維護庫存與時段判斷邏輯；A 留給「專頁整頁嵌入」（例如活動專區），不放在疫苗頁。

### 3.2 態勢卡建議句帶縣市

態勢卡建議「長者與幼兒儘速接種流感疫苗」旁加按鈕「查附近接種點」→ `#g=flu&city=<縣市>`：

- 縣市來源兩選一：使用者在選單選的縣市（記在 `localStorage`，只存縣市，不存座標）；或按「用我的位置」，由 vaxmap 自己處理定位（本站不取得座標）。
- 沒有縣市時照舊 `#g=flu`，vaxmap 會依自己的定位／預設顯示。
- 實作位置：`_partials.mjs` 的 `vaxmapLink(ctx, { group: 'flu', city })` 已支援 `city`／`dist`；缺的是首頁（`home.mjs`，別的 agent 負責）與 `ui.js` 的縣市選單。

### 3.3 同一個 AI 問答回答「附近哪裡可以打流感疫苗」

- 本站答案引擎**回答後給深連結，不自行列院所**：答案句講公費對象、時程（抽取式，每句附來源編號），行動鈕「查附近接種點」→ vaxmap（已完成，見 1.2）。
- 理由：庫存會變，答案頁的稽核紀錄、快取與翻譯都會把舊庫存固化；本站白名單裡的內容必須有審閱日，院所庫存沒有。
- 若問句帶縣市（「臺北市哪裡可以打流感疫苗」），第二階段由實體抽取帶出 `city=臺北市`。
- 若使用者問「有沒有庫存」「今天有沒有開」：回「庫存與看診時段以地圖為準，每日更新兩次，出發前請電話確認」並給 `&stock=1&today=1` 深連結。
- 抗病毒藥劑（「哪裡拿得到克流感」）：行動鈕導向 `#g=antiviral`；用藥對象與劑量仍遵守本站拒答邊界（個人用藥劑量不回答）。

---

## 4. 治理層

### 4.1 Owner／Steward

| 資產 | Owner（內容負責） | Steward／維運 |
| --- | --- | --- |
| 疫苗主檔、公費對象、時程（本站） | 預防接種組 | 預防接種組 Data Steward |
| 院所＋庫存快照（`dataset.vaccine-sites`） | 預防接種組 | 原型：vaxmap 維護者；正式：資訊室（擷取機器、排程、部署） |
| 接種資訊專區（`info.html`，源自疾管署「疫苗接種專區」頁面） | 預防接種組＋公關室 | OASIS（翻譯詞彙表）；翻譯為機器翻譯、需標示 |
| 兩站對照表、深連結規則 | OASIS | 資訊室（變更 URL 結構時通知） |

### 4.2 資料日顯示規則（與本站「數字的來源卡」一致）

- 凡出現院所數、庫存相關數字，**同時顯示資料時間**（`meta.generatedAt`，臺北時間到分鐘）與資料來源（預防接種組、vaxmap 快照）。
- 本站用既有的來源卡（`sourceCard`：權責單位、資料日、授權），資料日取 `generatedAt`，不取本站建置日。
- 資料超過 36 小時：不顯示數字，改顯示「資料更新中，請直接開啟地圖查看最新資料」。
- 資料日與「疫苗開打日」並列時避免誤導（例：開打日前庫存少是正常，不是缺貨）。

### 4.3 庫存免責文字統一

兩站用同一句，由本站 i18n 與 vaxmap `i18n/*.json` 共用同一個 key 內容：

> 庫存與看診時段為定時快照（每日兩次），僅顯示「有／無庫存」，不代表現場即時情形。出發前請先電話確認。

vaxmap 現有 `legend.note` 與「實際接種前務必先電洽院所」語意相同但字句不同，建議合併。

### 4.4 無障礙與多語

- 兩站都以 WCAG 2.1 AA 為目標；vaxmap 有 Playwright 與無障礙測試，本站有無障礙說明頁。深連結按鈕統一標示「開新視窗」：視覺箭頭 ↗＋螢幕閱讀器文字＋`title`（已在 `vaxmapButton()` 實作，七語）。
- 語言：vaxmap 八語（zh-Hant、en、ja、ko、id、vi、th、tl），本站七語（zh-TW、en、ja、tl、vi、id、th）。差一個：**ko**。處理：本站沒有 ko 頁，vaxmap 反向連結 ko 使用者到 `/en/`（見 1.3）；是否增設 ko 由預防接種組與公關室依僑外生人數決定。**tl 兩邊都有**。
- 翻譯狀態標示：本站分「已審核」與「機器翻譯 · 待審核」；vaxmap 的翻譯也是 AI 初稿（`draft`），建議使用同樣的兩段標示用語。
- 詞彙一致：疫苗與廠牌名稱以本站 `glossary.json`（locked 詞）為準，vaxmap 的 `translate-info.mjs` 詞彙表應由它輸出，避免「肺鏈」「肺炎鏈球菌疫苗」「PCV」各說各話。

### 4.5 共用設計 token

兩站視覺應該看得出是同一家，但不必逐像素相同。目前差異（vaxmap `public/css/app.css`、本站 `src/styles/tokens.css`）：

| 用途 | 本站 | vaxmap | 建議 |
| --- | --- | --- | --- |
| 主色 | `--green-700 #1b5e3f` 綠 | `--brand #0b5d57` 青綠 | 擇一為官方主色；vaxmap 對比 7.6:1 已達 AAA，改用本站綠亦可，但要重測地圖圖釘辨識度 |
| 頁面底色 | `--paper #f6f6f4`（暖白） | `--bg #eef2f1`（偏冷灰綠） | 統一為暖白或冷灰；兩站相連時底色跳動最明顯 |
| 文字 | `--ink #1b1f23` | `--text #17211e` | 差異小，統一 `#1b1f23` |
| 焦點環 | `3px solid #e8a400`（琥珀） | `--focus #1a56db`（藍） | 統一一種；建議本站琥珀（對淺深底皆明顯），vaxmap 地圖圖釘用藍，焦點環避開圖釘色 |
| 成功／有庫存 | `--ok #1b5e3f`／`#e3f3ea` | `--ok #16784a`／`#e1f3e8`、文字 `#0f5c38` | 統一用本站 `--ok` |
| 警示／無庫存 | `--warn #6f5400`／`#fff3cf` | `--warn-text #7a4300`／`#fff3d6`，標記 `#e8a317` | 統一用本站 `--warn`；圖釘填色另列 |
| 圓角 | `--radius 10px` | `--radius 14px` | 統一 10px（地圖浮層可維持較大圓角） |
| 字型 | system-ui＋Noto Sans TC… | Noto Sans TC＋系統字型，依語系調整（含 KR、Thai） | 以 vaxmap 的依語系順序為準，本站補 KR 不需要 |

作法：由本站 `tokens.css` 匯出 `v1/design-tokens.json`，vaxmap 建置時產生對應的 CSS 變數；地圖專用色（圖釘、群集）仍保留在 vaxmap。

---

## 5. 分階段

| 階段 | 內容 | 負責 | 驗收 |
| --- | --- | --- | --- |
| **第一階段：連結層＋資料目錄登錄** | 全站接種點入口改深連結（已完成）；vaxmap 加反向連結與語言互帶；`dataset.vaccine-sites` 登錄；`twice-daily`／36 小時門檻；免責文字統一 | 本站 Steward、vaxmap 維護者、預防接種組確認授權 | `grep antiflu.cdc.gov.tw\|vaxmap.cdc.gov.tw content src` 只剩資料來源用途；資料目錄看得到接種點資產；`VA008` 評估題更新 |
| **第二階段：主檔對齊與元件** | 主檔加 `vaxmap` 欄位；vaxmap 讀 `v1/vaccines.json`；`summary.json` 縣市計數＋資料時間；態勢卡帶縣市；設計 token 對齊；考慮 Web Component | OASIS、資訊室、vaxmap | 疫苗頁顯示「某縣市 N 家（資料時間）」；對照表無孤兒 id；token 差異表清零 |
| **第三階段：同一 API 閘道** | `api.cdc.gov.tw/v1/vaccine-sites`（查詢：`group`、`city`、`dist`、`stock`、`updatedAfter`；回傳含 `meta.dataDate`、授權、`owner`）；vaxmap 與本站都改讀它；擷取機器、排程、告警併入資訊室維運；`frame-ancestors` 白名單隨正式網域設定 | 資訊室、預防接種組 | 單一資料入口；兩站不再各自讀 `vaxmap.cdc.gov.tw`；時效告警在閘道層統一 |

### 風險與待決

- vaxmap 目前**不是官方站**，資料是從現站擷取的快照。正式導向前，要確認現站是否同意（請求量：一次完整擷取約 280 次請求）及授權。
- 兩站網域不同（原型為 github.io）：`localStorage`（縣市偏好）不跨站，縣市只能走 URL 參數。
- 本文件的網址、參數以 2026-10-02 的 vaxmap-next 為準；它的 `decodeState` 若新增參數，更新 1.1 的表與 `_partials.mjs` 的白名單即可。
