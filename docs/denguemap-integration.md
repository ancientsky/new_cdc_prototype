# 新官網原型 × 登革熱地圖（denguemap）整合方案

給資訊室（部署、CSP 與 HTTP 標頭、排程）與防疫醫師室（數字的意義、什麼時候不能引用）看；疫情中心、急性傳染病組、OASIS 參考。架構比照 [vaxmap-integration.md](vaxmap-integration.md)：分四層，由「現在就能做」到「要一起治理」，最後一節是分階段時程。

- 本站（新官網原型）：<https://ancientsky.github.io/new_cdc_prototype/>
- 登革熱地圖（疾管署 2015 年版登革熱地圖的現代化重製，**概念原型、非官方站**）：<https://ancientsky.github.io/denguemap/>；原始碼 `ancientsky/denguemap`，資料契約見該 repo 的 `docs/data-contract.md`
- 設定位置：本站 `site.config.mjs` 的 `denguemapUrl`、`denguemapDataUrl`、`denguemapRawDataUrl`、`denguemapMaxAgeHours`；模板用 `src/templates/public/_partials.mjs` 的 `denguemapLink()`／`denguemapButton()`，小卡與嵌入在 `src/templates/public/_denguemap.mjs`；快照與過期規則在 `scripts/lib/denguemap.mjs`；答案引擎用 `src/client/answer/structured.js` 的 `denguemapHref()`（client 端無法 import site.config，網址寫死並加註，可用 `window.CDC.config.denguemapUrl` 覆寫）。
- 測試：`tests/round57-denguemap.test.mjs`。

## 0. 為什麼要整合、原則是什麼

兩站解決不同的問題：本站回答「登革熱是什麼、怎麼預防、有症狀怎麼辦、誰要通報」（內容有 Owner、審閱日、版本鏈）；登革熱地圖回答「病例在哪裡、最近兩週有沒有聚集、我住的村里病媒蚊風險高不高、境外移入從哪些國家來」（每 3 小時自疾管署資料更新、地圖、中英文）。

四條原則：

1. **本站不自己畫病例地圖。** 病例點位、聚集範圍、村里病媒蚊指數每天在變，地圖的資料管線已經處理擷取、驗證與保留上一版；本站只負責把人帶到對的視圖（深連結）、在疾病頁放一張說清楚資料時間的小卡，以及在專區頁嵌入。
2. **一個事實只存一份。** 疾病知識的正本在本站 `content/diseases/dengue.json`；病例與病媒蚊資料的正本在地圖的 `public/data/`（Pages 發布）。本站只快照一個 1 KB 的摘要檔（`summary.json`）給小卡用，不複製病例資料。
3. **數字一定帶資料時間，資料不可信時寧可不顯示。** 小卡沿用 vaxmap 方案「超過門檻不顯示數字」的規則，另外尊重地圖自己的資料品質旗標（第 2.5 節）。
4. **連過去的人不能迷路。** 按鈕一律標示「開新視窗 ↗」（螢幕閱讀器文字＋`title`），語言互帶（地圖只有中、英）；嵌入只放在專區頁，不放在一般疾病頁。

---

## 1. 連結層（第一階段，已完成）

### 1.1 深連結規則

地圖用 hash 路由（`ancientsky/denguemap` 的 `src/lib/router.ts`、`src/lib/params.ts`）：

```
https://ancientsky.github.io/denguemap/#/<視圖>?<參數>
https://ancientsky.github.io/denguemap/#/map?county=64000&type=local
https://ancientsky.github.io/denguemap/?embed=1&theme=light&lang=zh#/vector     ← 嵌入模式
```

| 參數 | 值 | 適用視圖 | 備註 |
| --- | --- | --- | --- |
| 視圖（路徑） | `map` 病例地圖、`clusters` 聚集警示、`vector` 蚊媒地圖、`trends` 病例趨勢、`imported` 境外移入、`about` 資料說明 | — | 不認得的路徑回到 `map` |
| `county` | 內政部 5 碼縣市代碼（高雄市 `64000`、臺南市 `67000`、屏東縣 `10013`、臺北市 `63000`） | map、vector、trends | 不是 5 碼或不存在 ⇒ 忽略 |
| `type` | `local` 本土（預設）、`imported` 境外移入、`all` | map、trends | |
| `country` | ISO 3166-1 二碼**小寫**（`vn`、`id`、`ph`） | imported | 地圖沒有該國移入資料 ⇒ 忽略 |
| `year`、`from`、`to`、`mode`、`color`、`mv`、`ns1`、`week`、`gran`、`years`、`tab` | 見地圖 `params.ts` | 各視圖 | 本站目前不產生；需要時加進 `denguemapLink` 白名單 |
| `lang` | `en`；繁中不寫 | 全部 | 一般深連結放在 hash 的 query；地圖讀到後會從網址拿掉，之後以地圖內的切換為準 |
| `embed`、`theme`、`lang`（嵌入） | `embed=1`、`theme=light|dark`、`lang=zh|en` | 全部 | 放在 `?`（search），地圖也接受放在 hash query。嵌入時**一定帶 `lang`**：不帶的話地圖會依瀏覽器語言或之前存的偏好自己決定 |

本站的 `denguemapLink(ctx, { view, county, type, country, lang, embed, theme })` 只輸出白名單內的值（縣市碼 `/^\d{5}$/`、type 三選一且只在 map／trends、country 兩個小寫字母且只在 imported、theme 二選一），不會產生壞網址；地圖本身對不認得的值也是忽略、不報錯。

**語言對應**：本站 `zh-TW` → 不帶（嵌入時帶 `lang=zh`）；`en` → `lang=en`；`ja`、`tl`、`vi`、`id`、`th` → `lang=en`（地圖只有中、英，外語讀者多半讀得懂英文，勝過整頁中文；與本站「沒有譯文時先退英文」的清單規則一致）。

### 1.2 本站所有登革熱地圖入口（已改）

| 入口 | 位置 | 連到 |
| --- | --- | --- |
| 登革熱疾病頁「目前疫情與統計」的**疫情小卡**（第 3.1 節） | `/diseases/dengue/#situation`（繁中、英、越；登革熱頁只有這三語是已審譯文） | 按鈕「病例地圖」`#/map?type=local`、「聚集警示」`#/clusters`、「蚊媒地圖」`#/vector`；連結「登革熱地圖專區」→ `/topics/denguemap/` |
| 屈公病疾病頁「如何預防」 | `/diseases/chikungunya/#prevention` | 「看病媒蚊風險：蚊媒地圖」`#/vector`（同為埃及斑蚊、白線斑蚊；病例數是登革熱的，所以不放小卡） |
| 疫情態勢頁登革熱大卡 | `/situation/#d-dengue`（七語） | 「開啟登革熱地圖」`#/map?type=local` |
| 出國目的地頁（目的地有登革熱旅遊疫情建議者） | `/travel/{ISO2}/` 的「相關疾病」 | 「從{國名}移入的登革熱病例」`#/imported?country={iso2}` |
| **登革熱地圖專區**（第 3.2 節，嵌入地圖） | `/topics/denguemap/`、`/en/topics/denguemap/` | iframe 嵌入（病例地圖／聚集警示／蚊媒地圖／境外移入切換）＋「開啟登革熱地圖」 |
| 答案頁行動鈕（疫情態勢意圖，問的是登革熱） | `core.js` `actionsFor` 的 `situation` | 「看登革熱地圖」`#/map`（語言依答案語言） |
| 疾病頁與專區的 `.md` 機讀版 | `/diseases/dengue.md`、`/topics/denguemap.md` | 小卡數字（帶資料時間）或「資料更新中」＋深連結；專區列各視圖深連結 |
| 開發者入口、使用指南 | `/developers/#denguemap`、`/guide/#denguemap` | 深連結參數表、嵌入參數、`summary.json` 說明／範例按鈕 |
| 資料目錄 | `/data/#dataset.denguemap-summary`、`v1/datasets.json` | 第 2.3 節 |

哪些疾病有入口寫在 `_denguemap.mjs` 的 `DENGUEMAP_OF_DISEASE`（與 vaxmap 的 `VAXMAP_GROUP_OF` 同一作法；第二階段改成疾病主檔欄位，見第 5 節）。

尚未改、需要別的 Owner 處理：

- 首頁態勢卡（`home.mjs` 的 `sitCard`，首頁 Owner）：登革熱卡目前只連疾病頁；建議高峰期加「開啟登革熱地圖」，並在使用者選了縣市時帶 `county`。
- 主選單面板（`_nav-panels.mjs`）有每面板 9 個連結的上限與測試，這一輪不加；若要放，建議放在「傳染病 → 找法」欄、取代較少用的一項。
- 評估集（`content/governance/eval-set.json`，OASIS）：可加「現在登革熱嚴重嗎」期望行動鈕含 `denguemap` 的題目。
- 日本腦炎（三斑家蚊）不是地圖的病媒，不加入口。

### 1.3 登革熱地圖反向連結（請地圖維護者加）

- 「資料說明」頁與嵌入模式的「開啟完整地圖」旁加：`登革熱疾病介紹（新官網）` → 本站 `/diseases/dengue/`（英文 `/en/diseases/dengue/`）；`1922 防疫專線` → `tel:1922`。
- 疫調、孳生源清除等防治作為的說明一律連本站（`/diseases/dengue/#prevention`、專業版 `#pro-programs`），地圖不另寫一份。
- 語言互帶：地圖切到英文時，上述連結改連 `/en/…`。

---

## 2. 資料層

### 2.1 本站用到的地圖資料（契約摘要）

地圖的 `public/data/` 由 GitHub Actions 每 3 小時檢查一次、**有變動才 commit 與部署**；同一份檔案在 Pages（`https://ancientsky.github.io/denguemap/data/`）與 git（`https://raw.githubusercontent.com/ancientsky/denguemap/main/public/data/`）。本站只讀兩個小檔：

`summary.json`（約 1.2 KB）：

```jsonc
{
  "asOf": "2026-10-17",           // 產生日（臺灣日期）
  "latestOnset": "2026-10-14",    // 全部病例中最新的發病日
  "year": 2026,
  "ytd":    { "local": 14, "imported": 186 },   // 今年 1/1 起累計（依發病日）
  "last7":  { "local": 0,  "imported": 5 },
  "last14": { "local": 2,  "imported": 18 },
  "last30": { "local": 3,  "imported": 33 },
  "prevYtd":{ "local": 23, "imported": 175 },   // 去年同期（1/1 到去年同月同日）
  "byCounty": { "64000": { "local": 10, "imported": 32 } },   // 今年累計，內政部縣市碼
  "topTowns14": [["10013010", 2, 0]]            // 近 14 天 [鄉鎮碼, 本土, 境外]，依本土遞減，最多 20
}
```

`manifest.json`（約 2 KB；本站只取子集）：`generatedAt`（ISO UTC，地圖資料最後一次改變的時間）、`latestOnset`、`sources.{cases,imported,vector,clusters,notices,ns1,travel}.{ok,stale,fetchedAt}`、`warnings[]`（資料品質警示，例 `{ "code": "cases-shortfall", "year": 2023, "type": "local", "got": 951, "expected": 24794 }`）。

| `sources.*.ok` | `stale` | 意義 |
| --- | --- | --- |
| `true` | `false` | 這次抓取並驗證成功 |
| `false` | `true` | 這次失敗，地圖沿用上一版檔案（`fetchedAt` 是上一版的時間） |
| `false` | `false` | 從未成功抓過 |

**已知的上游問題**：疾管署登革熱地圖後端曾間歇回傳**截斷的歷史資料**（某些年份筆數只剩一小部分）。地圖的管線遇到筆數驟減時不覆寫、沿用上一版，並把來源標成 `stale`；若已提交的資料與固定的歷史基準（2026-10-16 觀測值）相比低於 80%，就在 `warnings` 產生 `cases-shortfall`（逐年、逐類型）或 `imported-shortfall`。本站的小卡必須尊重這兩個訊號（第 2.5 節）。

### 2.2 建置時快照（`scripts/fetch-data.mjs`）

- `node scripts/fetch-data.mjs --denguemap`（完整的 `npm run fetch` 也會做）：先抓 Pages 版，失敗（連不上、HTTP 錯誤、超過大小上限、驗證不過）再抓 raw 版；`summary` 與 `manifest` 一定取自同一個來源，且兩者的 `latestOnset` 必須相同（避免一新一舊）。
- **嚴格驗證**（`scripts/lib/denguemap.mjs`）：計數必須是非負整數；日期必須是真實存在的 ISO 日期、`generatedAt` 是 ISO UTC；縣市碼 `/^\d{5}$/`、鄉鎮碼 8 碼字串；近 7 ≤ 14 ≤ 30 天；各縣市合計不大於今年累計；`generatedAt` 不得晚於抓取時間；未知欄位丟掉（白名單輸出）。大小上限 summary 64 KB、manifest 256 KB，邊讀邊數，超過就中止。
- 全部失敗 ⇒ **保留既有快照**、只在檔內記 `lastLiveAttempt`（時間與原因），程式 exit 0，不擋建置（與其他官方資料來源同一規則）。從來沒有快照 ⇒ 寫一個 `mode: "missing"` 的空殼，小卡顯示「尚未取得」。
- 輸出 `data/snapshots/denguemap-summary.json`：

```jsonc
{ "schema": 1, "label": "登革熱地圖疫情摘要（summary.json＋manifest.json）", "mode": "live",
  "fetchedAt": "2026-10-17T02:42:20.781Z",
  "sourceUrl": "https://raw.githubusercontent.com/ancientsky/denguemap/main/public/data/summary.json",
  "manifest": { "schema": 1, "generatedAt": "2026-10-17T01:02:06Z", "latestOnset": "2026-10-14",
                "sources": { "cases": { "ok": true, "stale": false, "fetchedAt": "2026-10-17T01:02:06Z" } /* … */ },
                "warnings": [] },
  "summary": { /* 2.1 的 summary，驗證後的白名單欄位 */ } }
```

- 成功時同步資料目錄那一筆的 `lastUpdated`（`generatedAt` 的臺北日期）與 `provenance.fetchedAt`，只動這兩個欄位。
- 第一份快照（2026-10-17）是在開發環境經 raw 版取得（開發環境連不到 `*.github.io`，GitHub Actions 兩者都連得到）。

### 2.3 把 `summary.json` 登錄成資料目錄的一筆資產（已完成）

`content/datasets/denguemap-summary.json`，`v1/datasets.json` 與 `/data/` 頁會列出，並受同一套時效告警（governance R6）：

```json
{
  "id": "dataset.denguemap-summary",
  "type": "dataset",
  "category": "structured-table",
  "title": "登革熱地圖疫情摘要（summary.json）",
  "owner": "unit.epidemic-intelligence",
  "license": "OGDL-1.0",
  "updateFrequency": "daily",
  "formats": ["JSON"],
  "canonicalUrl": "https://ancientsky.github.io/denguemap/data/summary.json",
  "mirrors": ["https://raw.githubusercontent.com/ancientsky/denguemap/main/public/data/summary.json"],
  "provenance": { "mode": "snapshot", "sourceUrl": "https://cdcdengue.azurewebsites.net/", "fetchedAt": "2026-10-17" },
  "lastUpdated": "2026-10-17",
  "diseases": ["disease.dengue"]
}
```

| 欄位 | 值 | 說明 |
| --- | --- | --- |
| Owner | `unit.epidemic-intelligence`（疫情中心） | 病例統計的權責（與 `dataset.dengue-daily` 相同）；技術維運原型階段是地圖維護者 → 日後資訊室 |
| 更新頻率 | 每 3 小時檢查、有變動才更新 | 本站沒有「每 3 小時」的頻率值，對應最接近的 `daily`（容許 2 天），見 2.4 |
| 授權 | 原型暫填 OGDL-1.0 | 資料源自疾管署登革熱地圖後端；正式登錄前請疫情中心確認授權與是否可再散布 |
| 正本位置 | 地圖 Pages 發布的 `data/summary.json` | 本站只存 metadata 與一份建置用快照（`data/snapshots/`），不對外提供副本 |
| AI 白名單 | 不申請（`requested: false`） | 數字每 3 小時變，答案引擎只給深連結（1.2），不轉述數字 |

### 2.4 新鮮度門檻對齊

| 環節 | 頻率／門檻 | 誰被通知 |
| --- | --- | --- |
| 地圖資料管線 | 每 3 小時檢查；有變動才 commit；`generatedAt` 只在資料或旗標改變時前進（`asOf` 每天變，所以正常情況下至少每天前進一次） | 地圖維護者（Actions 失敗） |
| 本站 `pages.yml` | **每次建置前**（每 2 小時與每次合併）跑 `fetch-data.mjs --denguemap`，結果只用於這次建置、不 commit；02 UTC 的全量重抓會一起回寫快照到 main | — |
| 小卡 | `generatedAt` 距建置時間 > **48 小時**（`denguemapMaxAgeHours`）⇒ 不顯示數字 | 讀者看到「資料更新中」 |
| 資料目錄 R6 | `daily` 容許 **2 天**（`DATASET_FREQ_DAYS.daily`）⇒ 逾期待辦給疫情中心 | 疫情中心 |

小卡的 48 小時與資料目錄的 2 天是**同一個門檻、兩邊各一道**：小卡保護讀者（不顯示過期數字），待辦提醒 Owner（地圖或擷取壞了）。比 vaxmap 的 36 小時寬，是因為地圖資料「沒變就不前進」：平日沒有新病例時，`generatedAt` 可能接近一整天才前進一次。數字最多落後地圖約一個建置週期（2 小時）加地圖本身的 3 小時檢查間隔。

PR 預覽（`content-pr.yml`）不重抓，用已提交的快照；快照超過 48 小時的預覽會顯示「資料更新中」，屬預期。

### 2.5 小卡什麼時候不顯示數字（`denguemapState`）

| 條件 | 代碼 | 小卡顯示 |
| --- | --- | --- |
| 沒有快照，或快照沒有通過驗證 | `missing` | 「尚未取得登革熱地圖的資料」＋開地圖按鈕 |
| `manifest.generatedAt` 距建置時間超過 48 小時 | `too-old` | 「資料更新中，請開啟登革熱地圖查看」＋原因＋最後取得的資料時間 |
| `sources.cases.stale === true` 或 `ok === false` | `cases-stale` | 同上（原因：地圖的病例資料這次沒有更新成功） |
| `warnings` 有 `code: "cases-shortfall"` 且 `year` 等於 `summary.year`（今年） | `cases-shortfall` | 同上（原因：上游病例資料暫時不完整） |

舊年份的短缺警示**不影響**今年的數字，小卡照常顯示；但**去年**（`summary.year − 1`）某類型有 `cases-shortfall` 時，該類型的「{前一年} 年同期 N 例」改顯示「去年同期資料不完整」（警示沒寫 `type` ⇒ 本土、境外都換），不做會誤導的比較（與地圖自己標示資料品質的作法一致）。`imported-shortfall` 是 `imported.json`（境外移入地球的國別資料）的檢查，小卡的境外移入數來自病例檔，所以今年的 `imported-shortfall` 也**不影響**小卡。判斷用建置當下的真實時間（`site.now`，不受 `BUILD_TODAY` 影響）。

---

## 3. 呈現層

### 3.1 疾病頁的「疫情小卡」（已完成）

位置：登革熱疾病頁「目前疫情與統計」區塊，說明文字之後、近週趨勢圖之前（`disease.mjs` 的 `renderBlock`）。建置時的 HTML，**不需要 client JS、不加任何 CSP 來源**。

| 欄位 | 來源 | 給防疫醫師室的說明 |
| --- | --- | --- |
| {年} 年本土病例（{前一年} 年同期） | `ytd.local`、`prevYtd.local` | **依發病日**統計、今年 1/1 起；本土＝在臺灣境內感染。最近幾天的病例常在之後才研判確定，所以近期數字會往上補 |
| {年} 年境外移入病例（同期） | `ytd.imported`、`prevYtd.imported` | 在國外感染、入境後發病；境外移入被病媒蚊叮咬可能引發本土傳播 |
| 近 14 天本土／境外移入 | `last14` | 14 天＝登革熱潛伏期上限，與群聚事件定義的「同一村里 14 日內」一致 |
| 最新發病日 | `latestOnset` | 不是通報日或資料日 |
| 近 14 天有本土病例的鄉鎮市區 | `topTowns14` 中本土 > 0 的筆數 | **只列數量、不列名稱**：本站主檔沒有鄉鎮代碼表（第 5 節待決）；想看是哪裡，按「聚集警示」 |
| 資料時間（臺北時間，到分鐘） | `manifest.generatedAt` | 地圖資料最後一次改變的時間；來源卡另列「本站快照」時間 |
| 來源卡 | `sourceCard`：正本＝`summary.json`、資料日、Owner＝疫情中心、授權、`summary.json`／`manifest.json`／資料目錄連結；註記「來源：登革熱地圖（概念原型、非官方站）」 | 正式數字以疾管署公布為準 |

小卡下方三個按鈕（開新視窗）：病例地圖、聚集警示、蚊媒地圖，以及「登革熱地圖專區 →」。七語都有介面字（`src/client/i18n.js` 的 `ROWS_R57`；英文的單位刻意留空）；登革熱頁目前出繁中、英、越三語，日期依語言格式。

地圖上幾個容易誤讀的點（專區頁「怎麼讀這張地圖」已寫給民眾）：

- **點位是最小統計區的中心點**（數十到數百戶的小區塊），不是住址；地圖不含個案識別資料。
- **著色預設是「發病距今」**：發病 7 天內最醒目，因為病人在發病前一天到發病後約五天是病毒血症期，這段時間被病媒蚊叮咬，蚊子就可能帶病毒（8–12 天後具傳播力）；8–14、15–30、30 天以上依序淡化。另可切成「本土／境外」著色。
- 蚊媒地圖是村里近 5 週的布氏指數與誘卵桶、誘蚊桶陽性率，分低、注意、危險三級；只顯示 5 週內有調查的村里。

本站疫情態勢層的登革熱卡（`content/situation/current.json`）是疫情中心發布的**示意**數字，與小卡（地圖快照）不同源；兩者並列時以「示意」與「登革熱地圖快照」標籤區分。正式上線時態勢層應改讀同一份統計（第 5 節）。

### 3.2 iframe 嵌入：放在專區頁，不放在疾病頁（已完成）

vaxmap 方案 3.1 的結論同樣適用：一般疾病頁不嵌整張地圖（載入圖磚與地圖程式、鍵盤與捲動巢狀、手機體驗差）。所以建了**「登革熱地圖」專區**（`content/topics/denguemap.json`，`/topics/denguemap/`，中英；治理欄位齊全：Owner 疫情中心、審閱週期 6 個月、對象民眾＋專業、授權、語言狀態），疾病頁小卡以「登革熱地圖專區 →」連過去。

專區用新的選填欄位 `embed`（`schemas/topic.json`）：

```json
"embed": { "kind": "denguemap", "views": ["map", "clusters", "vector", "imported"], "card": true }
```

`kind` 只接受已登錄的值；**內容檔不寫網址**，網址與 CSP 都由 `site.config.mjs` 推出。`card: true` 在地圖下方再放一張小卡（給沒有 JS、或地圖載不出來的讀者）。

嵌入的標記（`_denguemap.mjs` 的 `denguemapEmbed`）：

```html
<nav aria-label="切換地圖" data-dm-tabs>
  <a href="…/denguemap/?embed=1&theme=light&lang=zh#/vector" target="denguemap-frame" data-dm-view="vector">蚊媒地圖</a> …
</nav>
<iframe name="denguemap-frame" src="…/denguemap/?embed=1&theme=light&lang=zh#/map"
        title="登革熱地圖：病例地圖（嵌入）" loading="lazy" referrerpolicy="no-referrer"
        allow="fullscreen" allowfullscreen
        sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-downloads"></iframe>
<noscript>互動地圖需要 JavaScript…</noscript>
<p>地圖沒有顯示？<a href="…/denguemap/#/map" target="_blank">開啟登革熱地圖 ↗</a></p>
```

- **切換視圖不需要 JS**：按鈕是 `<a target="denguemap-frame">`，直接把 iframe 導到另一個視圖；只有一個 iframe，不會同時載入三張地圖（隱藏的 iframe 不受 `loading=lazy` 延遲，所以不用「三個 iframe 輪流顯示」的作法）。一小段 inline script 只負責更新 `aria-current`、iframe `title` 與「開新視窗」連結的目標視圖；它由建置掃描、以 sha256 雜湊放進 CSP `script-src`（與其他頁面的 inline script 同一機制），不需要 `'unsafe-inline'`。
- `theme=light`：本站沒有深色模式，固定淺色，免得地圖依作業系統變成深色、和頁面不搭。`lang` 一定帶（繁中 `zh`、其他 `en`）。
- 高度：桌機 `clamp(420px, 72vh, 760px)`；手機 `min(78svh, 620px)`、最低 380 px，留出上方切換鈕與下方連結的空間。
- 鍵盤：iframe 前有「跳過嵌入的地圖」連結（聚焦時才出現），跳到下方的「開新視窗」連結；iframe 本身可以 Tab 進出，地圖不攔截 Tab。
- 載入失敗（地圖站掛掉、公司網路擋 github.io、開發環境）：iframe 留白，「地圖沒有顯示？開啟登革熱地圖 ↗」與下方小卡一直看得到。

### 3.3 嵌入模式、CSP 與 frame-ancestors

**地圖的嵌入模式**（另一個工作階段正在地圖 repo 實作，本站依其規格建置）：`?embed=1` 隱藏地圖的頁首與導覽、地圖啟用 MapLibre 的 **cooperativeGestures**（手機單指捲動頁面、兩指才移動地圖；桌機要按 Ctrl／⌘ 才縮放，避免讀者捲頁時被地圖「吃掉」捲動）、右上角顯示「開啟完整地圖 ↗」；嵌入模式**不讀也不寫**讀者存的語言與主題偏好（因為原型與本站同源，見下）。

**本站的 CSP（資訊室）**：`scripts/lib/emit-headers.mjs` 由 `site.config.mjs` 的 `vaxmapUrl`、`denguemapUrl` 推出 `frame-src` 的來源並去重。差異：

```diff
- frame-src ${vaxmapOrigin} https://www.youtube-nocookie.com https://www.youtube.com
+ frame-src ${[vaxmapOrigin, denguemapOrigin] 去重} https://www.youtube-nocookie.com https://www.youtube.com
```

原型兩張地圖都在 `https://ancientsky.github.io`，所以產生的標頭字串**沒有變**（`dist/headers/*` 與第二十三輪的基準相同）；正式站把 `denguemapUrl` 改成別的網域、重建，`frame-src`、`dist/headers/nginx.conf`、`web.config.headers.xml`、`_headers` 會自動帶上新來源，不必手改。`frame-ancestors 'self'`、`X-Frame-Options: SAMEORIGIN` 管的是「本站被誰嵌」，與此無關。本站的 `Permissions-Policy` 已關閉 `geolocation`、`camera` 等，地圖目前不用定位，嵌入不受影響；`allow="fullscreen"` 只開全螢幕。

**同源的影響（原型特有，請資訊室注意）**：GitHub Pages 上本站（`/new_cdc_prototype/`）、vaxmap（`/vaxmap-next/`）與登革熱地圖（`/denguemap/`）是**同一個 origin**。

- `sandbox` 五項各有用途：`allow-scripts`（地圖本身）、`allow-same-origin`（MapLibre 的 Web Worker 與 storage）、`allow-popups`＋`allow-popups-to-escape-sandbox`（「開啟完整地圖 ↗」開的新分頁不繼承沙箱）、`allow-downloads`（蚊媒地圖的危險級里別 CSV）。不給 `allow-forms`、`allow-top-navigation`。
- `allow-scripts allow-same-origin` 在同源時**沒有隔離效果**：嵌入的地圖可以讀寫父頁 DOM、共用 `localStorage`（地圖的鍵名有 `denguemap.` 前綴，本站與地圖目前不會互相覆蓋；嵌入模式也刻意不寫偏好）。瀏覽器 console 會出現「allow-scripts 與 allow-same-origin 並用可逃出沙箱」的提醒，屬預期。仍保留 `sandbox`，是為了換到不同網域後自動生效（擋表單送出、擋頂層導頁、限制彈窗）。
- 信任邊界因此是「`ancientsky.github.io` 底下所有 repo」——原型可以接受，正式站不行。
- GitHub Pages 不能設 HTTP 標頭，`<meta>` 形式的 CSP 又不能宣告 `frame-ancestors`，所以原型的地圖**任何網站都能嵌**；地圖沒有登入或會改變狀態的操作，點擊劫持風險低。
- 站內連結檢查（`check-internal-links.mjs`）的 `siblingUrls` 已加 `denguemapUrl`：`BASE_PATH=''` 建置時，`https://ancientsky.github.io/denguemap/…` 才不會被當成站內缺檔。

**正式環境的兩種部署（建議 B）**：

| | A. 官方網域子路徑 `https://www.cdc.gov.tw/denguemap/` | B. 專用網域 `https://denguemap.cdc.gov.tw/`（或 `dengue.cdc.gov.tw`） |
| --- | --- | --- |
| 本站設定 | `denguemapUrl` 改為子路徑；`frame-src` 與 `'self'` 同源 | `denguemapUrl` 改為專用網域；`frame-src` 自動加入該來源 |
| 隔離 | 與 A 相同的同源問題（但同一個部署者、同一套程式審查） | `sandbox` 真正生效：地圖拿不到本站 DOM、cookie 與 storage |
| 地圖端標頭（資訊室設定） | `Content-Security-Policy: frame-ancestors 'self'` | `Content-Security-Policy: frame-ancestors 'self' https://www.cdc.gov.tw`（列出新官網正式網域，**不要用 `*`**）；不要再設 `X-Frame-Options: DENY`（會蓋掉允許清單）；資料檔 `data/*.json` 設 `Cache-Control: max-age=300` |
| 本站 fetch 快照 | 同網域 | `fetch-data` 是建置機器在抓，不需要 CORS；若日後改成瀏覽器端讀，再設 `Access-Control-Allow-Origin: https://www.cdc.gov.tw` |
| 適合 | 資訊室同時維運兩站、程式一起審 | 地圖由不同團隊或廠商維護（建議） |

### 3.4 手機體驗

- 疾病頁不嵌地圖，只有小卡＋按鈕（開新視窗，地圖在自己的分頁全螢幕操作）。
- 專區頁的嵌入：cooperativeGestures（單指捲頁）、地圖高度約 3/4 螢幕、切換鈕 44 px 高、下方「開新視窗」連結與操作提示一直可見；建議手機讀者直接開新視窗看完整地圖。
- 小卡在 640 px 以下改兩欄、大數字縮小。

### 3.5 為什麼現在不做 Web Component

vaxmap 方案在「列出最近 5 家院所」時建議 Web Component；登革熱這邊**目前不需要**：

1. 本站要的是「幾個數字＋資料時間」，建置時快照就夠，零 client JS、零 CSP 變更；Web Component 要把第三方 JS 放進本站每個疾病頁，資安審查與效能預算（公開頁 JS ≤ 120 KB）都要重算。
2. 地圖的互動（MapLibre、底圖圖磚、ECharts）很重，拆成元件等於把整個地圖搬進本站頁面；iframe 反而是最乾淨的邊界，換網域後還有 `sandbox` 隔離。
3. 版本相容：元件要地圖維護者承諾 API 與發版節奏，原型階段沒有這個治理能力。

等到需要「本頁內依讀者縣市即時顯示近 14 天病例」這類互動、而且地圖已移到官方網域時，再評估元件（第 5 節第三階段）。

---

## 4. 治理層

### 4.1 Owner／Steward

| 資產 | Owner（內容負責） | Steward／維運 |
| --- | --- | --- |
| 登革熱疾病頁（本站） | 急性傳染病組 | 急性傳染病組承辦人 |
| 病例資料、疫情摘要（`dataset.denguemap-summary`）、小卡的數字 | **疫情中心** | 原型：地圖維護者（擷取、驗證、部署）；正式：資訊室（擷取機器、排程、告警） |
| 蚊媒資料（村里病媒蚊調查、危險級里別） | **急性傳染病組**（病媒防治）＋地方衛生局（調查） | 同上 |
| 境外移入國別、國際疫情新聞 | 疫情中心（國際疫情）、檢疫組（旅遊疫情建議） | 同上 |
| 登革熱地圖專區（`topic.denguemap`） | 疫情中心 | 疫情中心承辦人（待指派）；英文為機器翻譯、待審 |
| 地圖程式與嵌入模式 | 原型：地圖維護者 | 正式：**資訊室**（部署、CSP、`frame-ancestors`、憑證） |
| 深連結規則、`DENGUEMAP_OF_DISEASE`、本文件 | OASIS | 資訊室（地圖改 URL 結構時通知） |

### 4.2 資料時間顯示規則（與本站「數字的來源卡」一致）

- 凡出現病例數，**同時顯示資料時間**（`manifest.generatedAt`，臺北時間到分鐘）與**最新發病日**，並註明「依發病日統計」「來源：登革熱地圖（概念原型、非官方站）」「正式數字以疾管署公布為準」。
- 用既有的來源卡（`sourceCard`：正本、資料日、Owner、授權、取得方式），資料日取 `generatedAt` 的臺北日期，**不取本站建置日**；另註「本站快照」時間。
- 第 2.5 節任一條件成立：不顯示任何數字，改顯示「資料更新中，請開啟登革熱地圖查看」＋原因。
- 年份一律寫絕對年份（「2026 年本土病例」「2025 年同期」），不寫「今年」「去年」——小卡的文字可能被複製或被 AI 引用，離開當天就失去意義（本站相對日期規則，第二十五輪）。
- 不在答案引擎、新聞稿或態勢層轉述地圖數字；需要引用時引用疾管署正式統計，地圖只給深連結。

### 4.3 給防疫醫師室：引用前的檢查

1. 看小卡有沒有數字。沒有 ⇒ 地圖或上游正在出問題，請開地圖的「資料說明 → 資料品質」看警示。
2. 看「最新發病日」與「資料時間」差幾天：差距大表示最近沒有新病例，或後端資料延遲。
3. 近一週的本土數字會往上補（研判時間差）；比較去年同期時，兩邊都是「1/1 到同月同日」的發病數。
4. 2023–2025 年的歷史資料若有 `cases-shortfall` 警示，地圖的趨勢頁與歷年比較會偏低；小卡只用今年與去年同期：去年有短缺警示時，該類型的比較改顯示「去年同期資料不完整」，今年的數字照常。

### 4.4 無障礙與多語

- 按鈕統一標示「開新視窗」：視覺 ↗＋螢幕閱讀器文字＋`title`（`denguemapButton`，與 `vaxmapButton` 同一套七語文字）。
- iframe 有描述性 `title`（含目前視圖），切換時更新；跳過連結；沒有 JS 時有 `noscript` 說明；地圖載不出來時文字連結永遠可見。
- 地圖兩語、本站七語：外語頁一律帶 `lang=en`；小卡的介面字七語齊備（`ROWS_R57`）。
- 地圖本身的無障礙（地圖點位的替代表格、色盲可辨的著色）由地圖維護者處理；蚊媒地圖已有「危險級里別表」與 CSV 可作文字替代。

---

## 5. 分階段

| 階段 | 內容 | 負責 | 驗收 |
| --- | --- | --- | --- |
| **第一階段：連結＋小卡＋專區嵌入（本輪已完成）** | 深連結 `denguemapLink`；疾病頁小卡；屈公病、態勢頁、目的地頁、答案頁、開發者與指南入口；`dataset.denguemap-summary`；`fetch-data --denguemap` 每次建置前重抓；專區頁嵌入；CSP 由設定推出 | OASIS（本站）、地圖維護者（嵌入模式） | `npm test` 的 `round57-denguemap`；登革熱頁三語都有小卡；專區頁在可連 github.io 的環境能切換四個視圖 |
| **第二階段：主檔對齊與正式確認** | 疾病主檔加選填欄位 `denguemap: { card, views }` 取代 `DENGUEMAP_OF_DISEASE`；鄉鎮代碼主檔（內政部 8 碼，含中英名）或請地圖在 `summary.topTowns14` 附名稱，小卡列出前 3 個本土鄉鎮；疫情中心確認授權與 Owner；專區英文審稿；首頁態勢卡帶縣市；地圖反向連結（1.3） | 疫情中心、急性傳染病組、OASIS、地圖維護者 | 小卡顯示鄉鎮名；資料目錄授權確認；`topic.denguemap` 英文 `reviewed` |
| **第三階段：官方網域與同一資料閘道** | 地圖移到官方專用網域（3.3 B），設 `frame-ancestors`；擷取機器、排程、告警併入資訊室；態勢層與小卡改讀同一份疫情中心統計 API（`api.cdc.gov.tw/v1/dengue-summary`，含 `dataDate`、`owner`、資料品質旗標）；評估是否需要 Web Component | 資訊室、疫情中心 | 單一資料入口；本站不再讀 github.io；`frame-src` 只有官方網域 |

### 風險與待決

- 地圖目前**不是官方站**，資料是從疾管署登革熱地圖後端擷取的快照；正式導向前要確認後端同意被定時擷取（每 3 小時）與資料授權。
- 上游截斷資料的問題在後端，地圖只能偵測與保留上一版；若後端長期回傳不完整資料，小卡會長期停在「資料更新中」——這是設計上寧缺勿錯的結果，請疫情中心追後端。
- 原型同源（3.3）：嵌入的地圖等於有本站頁面的完整權限；正式站必須換網域或同團隊部署。
- 本站沒有 `twice-daily`／`hourly` 這類頻率值；若日後有更多「幾小時一次」的資料集，建議新增 `maxAgeHours` 欄位（vaxmap 方案 2.3 也提過），並讓 R6 待辦寫小時。
- 本文件的參數以 2026-10-17 的地圖（含正在實作的嵌入模式）為準；地圖 `params.ts` 新增參數時，更新 1.1 的表與 `_partials.mjs` 的白名單即可。
