# 國際疫情資訊自動上架：資料契約與流程（第四十三輪）

> 狀態：契約草案（2026-10-13）。疫情中心同事表示他們有自己維護的資料庫，問未來上架「國際重要疫情資訊」有沒有更聰明、更自動的方式。本文是設計與契約；實作位置見第 6 節，實作時學到的事見第 8 節。

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

> 推送端點、閘道端點、後台頁與共用上架流程由另一位同事與本文同時實作（標 ※），檔名以合併後為準。工程契約全文見 ARCHITECTURE §47。

| 元件 | 檔案 |
| --- | --- |
| 契約 schema | `schemas/intl-epidemic-feed.json` |
| 共用純規則（瀏覽器與 Node 共用：CSV 解析、舊格式轉換、形狀判斷、單則檢查、主檔對應、內容指紋、白話錯誤） | `src/client/intl-epidemic-rules.js` |
| 匯入器（parse／validate／plan／apply）＋ CLI | `scripts/lib/intl-epidemic.mjs`、`scripts/intl-epidemic.mjs`（`npm run intl:import -- <檔案或 URL> [--dry] [--mode full|delta]`） |
| 舊欄位正規化（自 fetch-data 移出，行為不變；匯入器與 fetch-data 共用） | `scripts/lib/travel-normalize.mjs` |
| 排程拉取 | `scripts/fetch-data.mjs` 的 `importTravelEpidemic()`（`INTL_FEED_URL` 有設就拉它，否則維持官網匯出；兩者都進匯入器）；`.github/workflows/pages.yml` 從 secrets 帶入 `INTL_FEED_URL`、`INTL_FEED_TOKEN` |
| 推送與後台共用的上架流程 ※ | `scripts/lib/intl-epidemic-publish.mjs`（`publishFeed()`：匯入 → 寫檔 → 用閘道的 git provider 提交兩個快照檔 → 稽核；`canImportIntl()` 權限） |
| 推送端點 ※ | `scripts/lib/intl-feed-api.mjs`（`POST /api/intl-epidemic`，Bearer `INTL_FEED_TOKEN`，≤ 2 MB，held 回 202） |
| 閘道端點 ※ | `scripts/lib/gateway/index.mjs`：`POST /api/gateway/intl-epidemic/import`（登入＋CSRF，dry 只回摘要）、`GET /api/gateway/intl-epidemic/status` |
| 後台 ※ | `/admin/intl-epidemic/`：匯入狀態、退回與對不上清單、現行清單、歷史、手動貼上／上傳／單則表單 → 預覽 → 送出（有閘道就提交，沒有就下載 JSON） |
| 匯入紀錄載入 | `scripts/lib/load.mjs`（`intl-epidemic-import.json` → `site.snapshots`） |
| 前台每則頁 | `src/templates/public/travel-alert.mjs`（`/travel/alerts/{id}/`） |
| 前台共用規則（模板與 RSS 共用，不 import 模板） | `scripts/lib/travel-alerts.mjs` |
| 列表與國家 chips | `src/templates/public/travel.mjs` |
| RSS、sitemap、llms.txt | `scripts/lib/emit-seo.mjs`（`feeds/travel-alerts.xml`）；訂閱主題 `src/client/subscribe-rules.js`、七語字串 `src/client/i18n.js` |
| JSON-LD | `scripts/lib/jsonld.mjs`（`SpecialAnnouncement`） |
| 待辦 | `scripts/lib/governance.mjs`：`intl-feed-held`、`intl-feed-unmapped`（owner `unit.epidemic-intelligence`；連結 `INTL_ADMIN_HREF`） |
| 範例 | `data/samples/intl-epidemic-feed.sample.json`、`.sample.csv`（示意資料，未驗證） |
| 測試 | `tests/intl-epidemic.test.mjs`（匯入器）、`tests/travel-alert-ui.test.mjs`（前台）；推送與閘道的測試 ※ 隨該分支加入 |

## 7. 要請疫情中心與資訊室回答的問題

1. 資料庫能否輸出第 3 節的 JSON 或 CSV？若只能輸出現有欄位，請提供一次匯出樣本，我們依 3.3 對應。
2. 每則有沒有穩定主鍵（更新時不變）？沒有的話，網站只能用「標題＋發布日」近似，更新會變成新增。
3. 「撤下」在資料庫裡怎麼表示（刪除？狀態欄？結束日？）——決定 `mode: full` 還是 `delta`。
4. 拉取端點要不要 token？放在哪個網段？CI（GitHub Actions 或機關 GitLab Runner）能不能連到？
5. 急件（等級調升、第三級警告）是否需要推送（C）？需要的話，中心系統能否在核定時呼叫一支 HTTPS webhook？
6. 疾病名稱是否能與本站疾病主檔對齊（或提供對照表）？國家是否有 ISO 3166-1 alpha-2？

## 8. 教訓（實作時學到的事）

每一條都寫「原本／改成／為什麼比較好」，給接手的資訊室同事看。

### 8.1 資料與契約

**(a) 新增 meta 欄位前，先找誰在讀同名欄位**
- 原本：想把這批 feed 是 full 還是 delta 記在快照的 `meta.mode`。
- 改成：記在 `meta.importMode`；`meta.mode` 維持 `live`／`snapshot`／`missing`。新增任何 meta 欄位前先 `grep -rn "meta.mode\|meta?.mode"` 找消費者。
- 為什麼比較好：`/travel/` 的資料來源區早就用 `meta.mode` 判斷顯示「即時」還是「快照」，所有快照共用這個意思。若寫成 `full`，前台會把每一份國際疫情快照都標成「快照（非即時）」，而且不會有任何測試失敗——是一個沉默的錯。

**(b) 真實匯出的欄位會缺，要從標題補**
- 原本：舊格式轉換時，疾病取 `alert_disease`、國家取 `areaDesc`，沒有就當缺必填退回。
- 改成：缺時從標題「國家-疾病」拆出來補（例「美國-環孢子蟲病」「全球-新型A型流感」）；「全球」「國際」這類字樣不當國家、也不列成對不上主檔。
- 為什麼比較好：官網匯出有不少列就是這樣，照規格退回會讓一批裡大量退回、超過 20% 門檻而整批保留，等於網站永遠更新不了。資料本來就有這個資訊，只是放在另一個欄位。

**(c) 比對主檔前先 NFKC**
- 原本：疾病、國家名稱直接和主檔名稱、別名逐字比對。
- 改成：比對前先做 NFKC 正規化（全形轉半形、康熙部首轉一般字），再小寫、統一斜線、去空白（`normName()`）。
- 為什麼比較好：官網內文混有康熙部首字（「⽐」「⾮」「⻑」，看起來和「比」「非」「長」一模一樣，但是不同的字碼），通常來自從 PDF 或 Word 複製。不正規化的話，「環孢⼦蟲病」永遠對不上主檔，同事看了也找不出哪裡不一樣。注意：快照與匯入紀錄保存的是原字，只有比對時正規化。

**(d) 改內容指紋演算法＝資料遷移**
- 原本：把 `itemFingerprint()` 當成內部實作，想改就改。
- 改成：改它要像改資料格式一樣寫遷移說明，並預告下一次匯入的效果。
- 為什麼比較好：「與上次相同」靠比對快照裡存的指紋。演算法一改，下一次匯入每一則都會被判成 `updated`：產生一個大 commit、匯入紀錄全是「更新」、RSS 的更新時間全部跳動，訂閱者會以為來了一大批新消息。事先說明可以選在離峰時間做，或同時重算快照裡的指紋。

**(e) full 模式下被退回的那則，不等於撤下**
- 原本：full 模式的規則是「這批沒有的 id 就撤下」，被退回的那則也算「沒有」。
- 改成：被退回的那則若原本已在清單上，保留上一版；只有通過檢查、明確 `withdrawn`、或根本沒出現在這批的 id 才撤下。
- 為什麼比較好：中心修改一則時打錯日期，不應該讓這則從網站消失——民眾看到舊版的正確資訊，比看到空白好；退回原因列在匯入紀錄與待辦，中心修正後下一次就會更新。

**(f) 秘密網址不進公開快照，也不進 CI log**
- 原本：其他快照都把來源網址記在 `meta.sourceUrl`，錯誤訊息也直接印網址。
- 改成：`INTL_FEED_URL` 不寫進快照（只有公開的官網匯出網址會寫），錯誤訊息裡出現的網址替換成 `(INTL_FEED_URL)`；CLI 讀 URL 失敗時也不印網址。
- 為什麼比較好：快照會隨網站公開（`/v1/travel-alerts.json`），GitHub Actions 的 log 也可能被看到。中心的匯出端點可能是內網位址或把 token 放在網址參數裡，一旦公開就是資安事件，而且無法收回。

### 8.2 網站與建置

**(g) 待辦連結不能指向還不存在的頁**
- 原本：待辦連結直接寫後台頁 `/admin/intl-epidemic/`。
- 改成：後台頁合併前先連 `/travel/`（`INTL_ADMIN_HREF`），後台頁合併時再改。
- 為什麼比較好：站內連結檢查在 CI 是 `LINK_CHECK=error`，連到不存在的頁會讓建置失敗。平行開發時，「先合併的那一半」不能依賴「還沒合併的那一半」，否則先合的那邊就紅了。

**(h) 現有快照有 7 個疾病名稱對不上主檔＝疫情中心第一批補別名工作**
- 原本：以為疾病主檔已經涵蓋國際疫情會出現的疾病。
- 改成：用匯入器重寫現有快照時，列出對不上的 7 個：沙門氏菌感染症、細菌性腸胃炎、呼吸道疾病、病毒性腸胃炎、發熱伴血小板減少綜合症、環孢子蟲病、亞洲長角血蜱正內羅病毒（ALTNV）感染。它們已經照常上架，並列成 `intl-feed-unmapped` 待辦。
- 為什麼比較好：不擋上架，所以民眾不受影響；但這幾則不會連到疾病頁，問答也無法把它們和疾病關聯。名單具體，中心可以逐一決定「加為既有疾病的別名」或「主檔新增一筆」，補完下一次匯入自動對上，不必改程式。

**(i) 新增一個 RSS 頻道，不只改 emit-seo**
- 原本：以為加 `feeds/travel-alerts.xml` 只要改 `scripts/lib/emit-seo.mjs`。
- 改成：同時改 `src/client/subscribe-rules.js` 的 `TOPIC_IDS` 與 `TOPIC_NAMES`、七語 `subscribe.topic.travel-alerts` 字串、`tests/round28-newsletter.test.mjs` 的頻道數（7 → 8），以及 `llms.txt` 的 RSS 清單。
- 為什麼比較好：電子報訂閱頁的主題清單和 RSS 頻道是一一對應的，漏改一處，訂閱頁就少一個選項或出現沒翻譯的鍵值。把清單寫在這裡，下一個加頻道的人照著做。

**(j) 模板與建置共用的規則放 `scripts/lib` 純模組**
- 原本：每則頁的規則（哪些列出頁、近 30 天、摘要）寫在模板裡，emit-seo 從模板 import。
- 改成：抽到 `scripts/lib/travel-alerts.mjs`，不 import 任何模板；模板與 `emit-seo.mjs` 都從它 import。
- 為什麼比較好：模板會 import 共用元件，共用元件又會間接 import emit 系列，從模板 import 很容易形成循環相依，Node 在循環時會拿到尚未初始化的值，錯誤訊息很難看懂。純模組也讓「哪些列出頁」只有一份定義，頁面、sitemap、RSS 不會不一致。

**(k) Prettier 會改寫 `` html`…` `` 模板內的 HTML**
- 原本：測試用固定字串比對輸出的 HTML 片段（例如固定一個空白或換行）。
- 改成：比對時用 `\s+` 代表空白。
- 為什麼比較好：`npm run format` 會重排模板字串內的 HTML 縮排與換行，測試在格式化前後結果不同，造成「本機綠、格式化後紅」。用 `\s+` 讓測試只檢查內容，不檢查排版。

**(l) 列表計數測試被新加的 `<li>` 干擾**
- 原本：舊的 `/travel/` 測試用「`<li>` 的數量」確認近 30 天列表有幾則。
- 改成：國家 chips 的 `<li>` 加上專屬 class，和列表項目區分。
- 為什麼比較好：每則下面多了幾個國家 chip，`<li>` 總數變多，舊測試誤判。給元素明確的 class，比改測試去猜「哪些 `<li>` 是列表」穩定，以後再加別的清單也不會互相干擾。

### 8.3 推送端點與後台

**(m) `provenance.by` 會公開**
- 原本：想在快照每列的 `provenance` 記下承辦人姓名，方便後台顯示。
- 改成：快照只放帳號；姓名只寫在版本紀錄尾端（`Imported-by`、`Gateway-Actor`）與稽核紀錄。
- 為什麼比較好：快照每列會原樣輸出到 `/v1/travel-alerts.json`，任何人都看得到；版本紀錄與稽核只有資訊室看得到。公開資料裡能少一個人名就少一個。

**(n) 檢查「不得出現版本控制用語」時，先排除嵌入資料與選單**
- 原本：測試用 `\bMR\b` 之類的字詞掃整頁 HTML。
- 改成：只掃同事看得到的文字區塊，不掃 `dataScript` 注入的資料與下拉選單。
- 為什麼比較好：茅利塔尼亞的 ISO 國碼就是 `MR`，國家下拉選單一定會命中；測試該管的是文案，不是資料。

**(o) 規劃時讀的是本機的現行快照**
- 原本：`publishFeed` 直接讀 `data/snapshots/` 當作「現行清單」來算新增／更新／撤下。
- 改成（原型維持；正式環境要注意）：閘道與建置在同一台機器時沒問題；若兩者分開部署，閘道要先從版本庫讀目前的快照再規劃，否則會拿舊清單比對、把已撤下的當成新增。已列在 docs/deploy.md §14.8。
- 為什麼比較好：先把這個前提寫下來，比等正式環境出現「怎麼又新增了一批舊的」再追查省事。

**(p) 提前回應前先排空請求本體**
- 原本：權杖錯、Content-Type 不對時直接回 401／415，不讀本體。
- 改成：所有不讀本體就回應的錯誤先 `req.resume()`；超過 2 MB 時讀完丟棄再回 413。
- 為什麼比較好：與閘道 `readBody` 同一個教訓（ARCHITECTURE §36）：本體沒讀完就回應，keep-alive 連線會卡住，中心系統只看到「連線重設」而不是我們精心寫的白話錯誤。

**(q) 整批保留（held）也留一筆版本；完全相同的再送不留**
- 原本：held 時什麼都不寫，只回 202。
- 改成：held 時快照不動，但匯入紀錄仍更新並提交一筆版本，首行標明「整批保留」；內容與紀錄都與上次相同時（noop）兩個檔都不寫、不提交。
- 為什麼比較好：疫情中心的待辦需要有依據可查（哪一次、為什麼被保留）；而重複送同一份資料不該製造一串空版本。
