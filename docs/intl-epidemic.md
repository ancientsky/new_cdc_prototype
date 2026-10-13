# 國際疫情資訊自動上架：資料契約與流程（第四十三輪）

> 狀態：契約草案（2026-10-13）。疫情中心同事表示他們有自己維護的資料庫，問未來上架「國際重要疫情資訊」有沒有更聰明、更自動的方式。本文是設計與契約；實作位置見第 6 節。

## 0. 給主管的三句話

1. 疫情中心**只在自己的資料庫填一次**；網站不再有人工抄寫、也不再另設一道人審，因為資料庫裡的那一筆已經是中心核定過的內容。
2. 網站和資料庫之間只約定**一份交換格式**（CAP 風格的 JSON，或等價的 CSV）；至於資料怎麼送來——每天排程去拉、中心系統發布時推過來、或值班同事在後台貼上——走的都是同一條驗證與上架流程。
3. 自動化的重點不是「免審」，而是**機器先把關**：格式、日期、國家與疾病對不上主檔、一次少掉一半資料……這些都會被擋下或列成待辦，疫情中心在後台一眼看得到。

## 1. 現況：網站今天怎麼拿到這批資料

新站的 `/travel/` 「近 30 天國際重要疫情資訊」與各國目的地頁，來自 `data/snapshots/travel-epidemic.json`；這份快照由 `scripts/fetch-data.mjs` 每天（CI 02 UTC）向**現行官網**的 `TravelEpidemic/ExportJSON` 拉取（ARCHITECTURE §12）。那個匯出檔的欄位（`sent`、`effective`、`expires`、`headline`、`description`、`alert_disease`、`areaDesc`、`ISO3166`、`web`…）其實就是 CAP（Common Alerting Protocol）的欄位名——它背後就是疫情中心的資料庫。

所以「未來怎麼上架」的答案不是另造一條路，而是：**把今天隱含在官網匯出檔裡的格式，寫成白紙黑字的契約，再讓資料能直接從疫情中心的資料庫送到新站**，不經過舊官網。

## 2. 四種做法的比較

| 做法 | 疫情中心要做什麼 | 延遲 | 風險 | 結論 |
| --- | --- | --- | --- | --- |
| A. 後台手動表單（承辦人再填一次） | 每則重打一次 | 看人 | 抄錯、漏登、兩邊不一致（兩個正本） | 只留作**備援**（系統斷線時貼上） |
| B. 排程拉取（網站 CI 每天／每小時向中心的匯出端點拉） | 提供一個匯出 URL（JSON 或 CSV）＋一組唯讀 token | 最多一個排程週期 | 端點暫時失效時要「保留舊資料、不要清空」 | **預設做法**：今天的流程只是把 URL 換掉 |
| C. 推送（中心系統核定時 POST 到網站閘道） | 系統多呼叫一支 webhook | 分鐘級 | 要開內網到閘道的通路、token 管理 | **加值選項**：等級調升這類急件需要時再開；同一份驗證 |
| D. 訂閱標準 feed（RSS／Atom／CAP XML） | 產出標準 feed | 同 B | RSS 會丟掉結構（ISO 國碼、疾病主檔對應）；CAP XML 結構夠但雙方都要寫 XML | 不另做：我們的 JSON 契約就是 CAP 欄位，將來要輸出 CAP XML 很便宜 |

**選定：一份契約（第 3 節）＋ B 為主、C 為輔、A 為備援**，三條路進同一個匯入器（第 4 節），同一套把關規則（第 5 節）。

為什麼不在網站端再加一道人審：資料庫裡的每一則已經由疫情中心依既有流程核定，網站再審一次等於「同一件事審兩次、而且第二次審的人比第一次更不懂」。網站該做的是機器把關＋事後可見（待辦與匯入紀錄），而不是重複審核。這與疫情發布（situation）走緊急車道、公關室事後複核的邏輯一致（docs/publishing-lanes.md）。

## 3. 交換格式（契約）

### 3.1 JSON（`schemas/intl-epidemic-feed.json`）

```jsonc
{
  "version": "1",
  "producer": "疾管署疫情中心 國際疫情資料庫",     // 誰產生的（自由文字）
  "generatedAt": "2026-10-13T08:00:00+08:00",      // 產生時間
  "mode": "full",                                   // full＝這是「現行全部」；delta＝只送有變動的
  "items": [
    {
      "id": "lQu-5iNul8z5h5Up_56VCQ",               // 中心資料庫的穩定主鍵（必填；同一則更新時 id 不變）
      "status": "published",                        // published｜updated｜withdrawn（撤下）；缺省＝published
      "publishedAt": "2026-10-02T07:48:32+08:00",   // 必填
      "updatedAt": "2026-10-02T07:48:32+08:00",     // 選填
      "expiresAt": "2027-01-02T07:48:32+08:00",     // 選填；過期即不再列入「近期」
      "disease": "炭疽病",                          // 必填（中文名；網站用疾病主檔名稱／別名對應）
      "diseaseEn": "Anthrax",                       // 選填
      "diseaseId": "disease.anthrax",               // 選填；中心若知道本站主檔 id 可直接給
      "headline": "孟加拉/尚比亞-炭疽病",            // 必填，≤ 120 字
      "body": "孟加拉西北部朗布爾專區……",            // 必填，純文字或 Markdown，≤ 8000 字
      "instruction": "提醒遵守當地的一般預防措施",   // 選填
      "areas": [                                    // 必填，至少一筆
        { "country": "孟加拉", "countryEn": "Bangladesh", "iso2": "BD", "detail": "朗布爾專區" },
        { "country": "尚比亞", "countryEn": "Zambia", "iso2": "ZM" }
      ],
      "severity": null,                             // 選填：1｜2｜3（與旅遊疫情建議等級同義）或 null
      "sourceUrl": "https://www.cdc.gov.tw/TravelEpidemic/Detail/...", // 選填：原始頁（舊站或中心系統）
      "references": [{ "title": "WHO DON", "url": "https://www.who.int/..." }], // 選填
      "lang": "zh-TW"                               // 選填，缺省 zh-TW
    }
  ]
}
```

- `iso2` 強烈建議提供（ISO 3166-1 alpha-2）；沒有時網站用 `country` 對國家主檔（`content/master/countries.json`）名稱對應，對不上就列待辦，不擋上架。
- `disease` 用疾病主檔（`content/master/diseases.json`）的名稱或別名對應；對不上也不擋上架，但該則不會有疾病頁連結，並列待辦。
- `mode: full` 時，快照裡有、feed 裡沒有的 id 視為已撤下（等同 `withdrawn`）；`delta` 時只動送來的 id。
- 同一次 feed 內重複的 id 以最後一筆為準（記警告）。

### 3.2 CSV（等價）

UTF-8（可含 BOM），第一列欄名；一則一列；多國以 `;` 分隔；欄名與 JSON 相同（`areas` 拆成 `countries`、`countriesEn`、`iso2s`、`areaDetail`）：

```
id,status,publishedAt,updatedAt,expiresAt,disease,diseaseEn,headline,body,instruction,countries,countriesEn,iso2s,areaDetail,severity,sourceUrl
```

### 3.3 舊格式（現行官網 ExportJSON／CAP 欄位）

匯入器也接受今天官網 `TravelEpidemic/ExportJSON` 的每列格式（`headline`、`description`、`effective`、`expires`、`alert_disease`、`areaDesc`、`areaDesc_EN`、`ISO3166`、`web`、`areaDetail`…）：`id` 取 `web` 網址的 `epidemicId` 參數，`areas` 由逗號分隔的 `areaDesc`／`ISO3166` 拆出。這讓「切換資料來源」不必一步到位：先接舊匯出，中心端準備好 v1 格式再換 URL。

## 4. 三條路，一個匯入器

```
疫情中心資料庫
   ├─ B 拉：CI 排程 npm run fetch（INTL_FEED_URL／INTL_FEED_TOKEN）──┐
   ├─ C 推：POST /api/intl-epidemic（Bearer INTL_FEED_TOKEN）──────┤
   └─ A 貼：/admin/intl-epidemic/ 上傳或貼上 JSON／CSV（登入、CSRF）──┤
                                                                    ▼
                              scripts/lib/intl-epidemic.mjs：parse → validate → map → plan → apply
                                                                    ▼
                 data/snapshots/travel-epidemic.json（現行清單，既有消費者不變：/travel/、目的地頁、問答、/v1/travel-alerts.json）
                 data/snapshots/intl-epidemic-import.json（匯入紀錄：這次收到／接受／退回／對不上／保留不動，近 30 次）
                                                                    ▼
                                    commit（B：CI bot；C／A：閘道服務帳號，提交訊息尾端記來源）→ 建置 → 上線
```

- 快照每列沿用既有欄位（`Disease`、`Country`、`CountryEn`、`ISO2`、`StartDate`、`Summary`、`Url`、`headline`、`description`…），並**新增** `id`、`status`、`areas[]`、`iso2s[]`、`body`、`diseaseId`、`provenance: { source: 'feed'|'official-export'|'manual'|'push', producer, importedAt, by }`。舊欄位不改名，消費端缺新欄位時退回既有行為。
- 每則有自己的頁 `/travel/alerts/{id}/`（標題、內文、疾病頁與目的地頁連結、發布日、來源），`/travel/` 與目的地頁的列表連到站內頁，原始來源另列；`feeds/travel-alerts.xml` 供訂閱。

## 5. 把關規則（機器先看）

| 規則 | 結果 |
| --- | --- |
| 單則不符 schema（缺必填、日期格式錯、超長） | 該則退回（`rejected`，附白話原因），其他照常 |
| 退回超過 20%，或 `full` 模式收到 0 則，或 `full` 模式會讓現行清單少掉一半以上 | **整批保留不動**（`held`），快照不覆寫，待辦 `intl-feed-held` 給疫情中心 |
| `publishedAt` 在明天以後 | 退回 |
| 疾病對不上主檔／`iso2` 不在國家主檔 | 接受上架，待辦 `intl-feed-unmapped`（補主檔別名後下次匯入自動對上） |
| 內文疑似含個資（沿用 `scripts/lib/pii-scan.mjs` 規則） | 退回 |
| `withdrawn` 或 `full` 模式未再出現 | 從現行清單移除，保留在匯入紀錄 |
| 與上次完全相同 | `unchanged`，不產生 commit |

## 6. 實作位置

| 元件 | 檔案 |
| --- | --- |
| 契約 schema | `schemas/intl-epidemic-feed.json` |
| 共用純規則（瀏覽器與 Node 共用：CSV 解析、單則檢查、主檔對應、白話錯誤） | `src/client/intl-epidemic-rules.js` |
| 匯入器（parse／validate／map／plan／apply）＋ CLI | `scripts/lib/intl-epidemic.mjs`、`scripts/intl-epidemic.mjs`（`npm run intl:import -- <檔案或 URL> [--dry] [--mode full|delta]`） |
| 排程拉取 | `scripts/fetch-data.mjs`（`INTL_FEED_URL` 有設就拉它，否則維持官網匯出；兩者都進匯入器） |
| 推送端點 | `scripts/lib/intl-feed-api.mjs`（`POST /api/intl-epidemic`，Bearer `INTL_FEED_TOKEN`，≤ 2 MB） |
| 後台 | `/admin/intl-epidemic/`：匯入狀態、退回與對不上清單、現行清單、手動貼上／上傳／單則表單→預覽→送出（有閘道就提交，沒有就下載 JSON） |
| 前台 | `/travel/alerts/{id}/`、`/travel/` 列表連結、`feeds/travel-alerts.xml` |
| 待辦 | `scripts/lib/governance.mjs`：`intl-feed-held`、`intl-feed-unmapped`（owner `unit.epidemic-intelligence`） |
| 範例 | `data/samples/intl-epidemic-feed.sample.json`、`.sample.csv`（示意資料，未驗證） |
| 測試 | `tests/intl-epidemic*.test.mjs` |

## 7. 要請疫情中心與資訊室回答的問題

1. 資料庫能否輸出第 3 節的 JSON 或 CSV？若只能輸出現有欄位，請提供一次匯出樣本，我們依 3.3 對應。
2. 每則有沒有穩定主鍵（更新時不變）？沒有的話，網站只能用「標題＋發布日」近似，更新會變成新增。
3. 「撤下」在資料庫裡怎麼表示（刪除？狀態欄？結束日？）——決定 `mode: full` 還是 `delta`。
4. 拉取端點要不要 token？放在哪個網段？CI（GitHub Actions 或機關 GitLab Runner）能不能連到？
5. 急件（等級調升、第三級警告）是否需要推送（C）？需要的話，中心系統能否在核定時呼叫一支 HTTPS webhook？
6. 疾病名稱是否能與本站疾病主檔對齊（或提供對照表）？國家是否有 ISO 3166-1 alpha-2？
