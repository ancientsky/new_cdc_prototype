# 智慧問答查詢紀錄（第四十一輪）

> 讀者：資訊室（部署與收件系統）、資料治理幕僚、各組室內容承辦。同仁操作版見《同仁手冊》第 42 節。
> 程式：`src/client/answer/log.js`（前端）、`scripts/lib/ask-log-mock.mjs`（模擬收件端）、`scripts/lib/ask-log-report.mjs`＋`scripts/ask-log-report.mjs`（報表）、`/admin/ask-log/`（後台頁）、`site.config.mjs` 的 `askLog`（設定）。測試：`tests/round41-ask-log.test.mjs`。

## 1. 為什麼要記

智慧問答（`/ask/`）的答案引擎整個在民眾的瀏覽器裡執行，網站沒有伺服器，所以**到第四十輪為止什麼都沒有記錄**：民眾問了什麼、哪些問題答不出來，我們完全不知道。最近兩個例子——有人問「covid」、有人問「做愛」——都是同仁碰巧自己試到才發現答不出來。

答不出來最常見的原因有兩種，兩種都要「先知道有人問」才能補：

| 原因 | 例子 | 怎麼補 |
| --- | --- | --- |
| 民眾用的詞不在詞彙主檔 | covid（主檔有 COVID-19、新冠） | 在 `content/master/glossary.json` 加別名 |
| 網站真的沒有這方面的內容 | 某個新興議題 | 權責單位新增 FAQ 或內容 |

所以這一輪做的事很單純：**每問一題送出一筆「已遮蔽個資」的紀錄，定期彙整成報表，列出常被問卻答不出來的問題，並自動猜可能的同義詞**，讓同仁有依據去補。

## 2. 記什麼、不記什麼

每一題送出一筆（同一題的 LLM 重組不另記），欄位固定如下，收件端只收這些欄位（白名單），其他一律丟掉：

| 欄位 | 內容 | 為什麼需要 |
| --- | --- | --- |
| `v` | 格式版本，固定 1 | 日後改格式時能分辨 |
| `q` | 問句，**已遮蔽個資**、空白合併、最多 200 字 | 報表的主角 |
| `lang`、`view` | 頁面語言、民眾版或專業版 | 分語言看哪裡缺譯文或缺詞 |
| `outcome` | `answered`／`low-relevance`／`stats`／`no-match`／`no-source`／`refused`／`paused` | 區分「答出來」與「答不出來」 |
| `refusalKind` | 拒答類型（no-match、privacy、harmful…） | 拒答是否合理 |
| `intent`、`disease` | 引擎判斷的意圖與疾病 | 判斷是詞彙還是規則問題 |
| `relevance` | 相關度（0–1，取到小數兩位） | 找「答了但可能答非所問」 |
| `top` | 最多 3 個被引用的內容 ID | 看哪些內容最常被用到 |
| `page` | 頁面路徑（**不含 `?q=` 與 `#`**） | 分辨 `/ask/` 與各語言版 |
| `t` | 時間，**只到分鐘**（收件端以自己的時鐘為準） | 依日期彙整 |
| `ev` | 建置日期（CI 建置時加 commit 前 7 碼） | 知道當時是哪一版詞彙與引擎 |

**不記**：IP 位址與任何由 IP 推得的資料（地區、網段）、cookie、使用者帳號或代號、Referer、User-Agent、完整網址、秒以下的時間、答案內容本身。收件端為了節流會在**記憶體裡**短暫用到 IP（每分鐘計數），**不寫進紀錄**。注意：瀏覽器送任何請求都會自動帶 User-Agent 與連線 IP，前端拿不掉——所以「不記」要由收件端負責（第 7 節）。

**不送的情況**：

- 瀏覽器開了「不要追蹤」（`navigator.doNotTrack === '1'`）或 Global Privacy Control（`navigator.globalPrivacyControl`）。
- 設定為 `off`、問句是空的。
- 設定為 `mock`（預設）但頁面不是由本機開發伺服器（`npm run dev`／`scripts/serve.mjs`，`localhost`）提供。判斷方式：`serve.mjs` 回應時會設一個標記 cookie `cdc_ask_log_mock=1`（只代表「這裡有模擬後端」，不含資料，送紀錄時也不會帶回去）；GitHub Pages、`npx serve` 這類純靜態伺服器沒有它，前端就不送，也不會打一個必定 404 的請求。也就是說，**GitHub Pages 上的公開原型站不會送出任何紀錄**：那裡沒有收件端，送出只會把民眾的問句交給託管平台。

## 3. 為什麼用 fetch keepalive，而不是 sendBeacon

原本的構想是用 `navigator.sendBeacon`（瀏覽器專為「送了就走」設計的 API，頁面關掉也送得出去）。實作時改成 **`fetch(…, { keepalive: true, credentials: 'omit', referrerPolicy: 'no-referrer' })` 為主、sendBeacon 只當備援**，理由：

1. **sendBeacon 無法關掉 Referer。** 如果正式收件端與網站同網域（例如由反向代理掛在 `https://www.cdc.gov.tw/api/ask-log`），瀏覽器會把完整網址當 Referer 送出，而網址裡有 **未遮蔽的 `?q=` 原始問句**，會直接落進收件端的存取紀錄（access log）。fetch 可以指定 `referrerPolicy: 'no-referrer'`。
2. **sendBeacon 一定帶 cookie。** fetch 可以 `credentials: 'omit'`，收件端不會收到任何可識別使用者的 cookie。
3. `keepalive: true` 讓 fetch 跟 sendBeacon 一樣，在使用者馬上換頁或關掉分頁時仍會送達；我們是在答案畫完後才送，本來也不急。

備援規則：只有瀏覽器沒有 fetch 時才用 sendBeacon，而且**只用在跨網域端點**——跨網域時本站的 `Referrer-Policy: strict-origin-when-cross-origin` 只送出網域、不含問句。同網域又沒有 fetch 的極舊瀏覽器就不送。

其他細節：

- 送出的 Content-Type 是 `text/plain`（CORS「簡單請求」型別），跨網域端點不必處理預檢（OPTIONS）；收件端一律把本體當 JSON 解析。跨網域時 fetch 用 `mode: 'no-cors'`，前端讀不到回應，也不需要讀。
- `log.js` 是答案畫完後才用 `import()` 載入（約 1.9 KB），不在答案頁初始載入、也不在引擎的靜態 import 閉包裡，所以不吃引擎頁 240 KB 的 JS 預算（`scripts/lib/js-budget.mjs`）。`ui.js` 只多了一行掛點（約 0.2 KB）。
- 紀錄失敗一律靜默，絕不影響答案畫面。

## 4. 為什麼遮蔽兩次

- **第一次在前端**：答案引擎一收到問句就先過 `maskPIIDetailed`（`src/client/answer/text.js`：身分證、卡號、健保卡號、手機、市話、email、地址、「我叫…」姓名），結果的 `result.query` 就是遮蔽後的問句；`log.js` 送出前再用同一份規則遮一次（雙保險）。
- **第二次在收件端**：前端程式在民眾的瀏覽器裡，任何人都能繞過它直接 POST 任意內容。收件端必須**自己保證**「存下來的一定已遮蔽、一定只有白名單欄位、長度有上限」，不能信任前端。模擬後端（`scripts/lib/ask-log-mock.mjs`）重用同一份 `maskPII`，**正式收件端也必須套用同樣的遮蔽規則**（可直接移植 `PII_RULES` 的正規式）。

## 5. 報表與 k-匿名門檻

```
npm run ask-log:report                        # 讀 .local/ask-log/*.ndjson，寫 .local/ask-log/report.json 並印出摘要
npm run ask-log:report -- --min=5 --from=2026-10-01 --to=2026-10-31
npm run ask-log:report -- --dir=/path/to/export --out=/secure/place/report.json
```

報表做的事：

1. **正規化問句**：全形轉半形（NFKC）、拉丁字母轉小寫、空白合併、去掉結尾標點，所以「COVID？」「covid」「ｃｏｖｉｄ」算同一題。
2. **依結果分表**：答不出來（查無 `no-match`＋依據不足 `no-source`）、答了但相關度低、最常被問且有答案；另有依結果、語言、日期、拒答類型的總數。
3. **k-匿名門檻（預設 K＝3）**：一個問句要「在 K 個不同日子出現」**或**「被問過 K 次」才把文字列進報表；未達門檻的只計數（`hiddenQueries`／`hiddenEvents`），**文字完全不出現在報表裡**。理由：問句是民眾自己打的字，就算遮過個資，少見的問句（只有一個人會問的個人狀況）仍可能指認出個人；常見問句則沒有這個問題，也正是我們要補的。
4. **疑似同義詞候選**：把每個列出的答不出來問句，跟詞彙主檔（`glossary.json` 的正名、別名、舊名、七語譯名）、疾病（名稱、英文名、別名）、疫苗（名稱、英文名）比對，規則依序是：完全相同（標「主檔已有」）、前綴、後綴、包含、拼字相近（編輯距離 1–2，只比 4 字以上），整句比不到時再拿句中的詞（例如「covid 要打幾劑」裡的 covid）比對。例：`covid` → **新冠併發重症**（比到 `COVID-19`，前綴）。這是便宜的字串規則，只給起點，**是不是同義詞由同仁判斷**，報表不會改主檔。

報表 JSON 只能寫在 `.local/` 底下（或 repo 以外的位置），CLI 會拒絕寫到 repo 的其他地方。

## 6. 後台頁 `/admin/ask-log/`

- 開發伺服器（`npm run dev`）：頁面自動讀 `/api/dev/ask-log/report`（只接受本機連線；非本機回 403），可調門檻 K。
- GitHub Pages 原型站與正式站：網頁上**不提供**紀錄。同仁用 `npm run ask-log:report`（或正式收件系統依本文件格式匯出）產生 `report.json`，在頁面上按「載入 report.json」開啟。檔案只讀進該分頁的記憶體，不上傳、不存瀏覽器儲存空間。
- 建置時頁面**不嵌入**任何紀錄內容（`dist/` 是公開的）。
- 每列答不出來的問題有「加入詞彙主檔」按鈕：連到 `/admin/glossary/?alias=<問句>&canon=<候選正名>#new-term`，新增詞彙表單會預填正名與別名；候選正名已在主檔時會帶入那一條（ID、正名、原有別名＋新別名），下方檢查會提示「已存在」——意思是**修改主檔裡那一條**，不要新增重複詞條。照舊複製 JSON、開 PR、複核。

## 7. 正式收件端契約（資訊室）

前端不必改，只要在建置時設環境變數：

| 環境變數 | 值 | 說明 |
| --- | --- | --- |
| `ASK_LOG_MODE` | `mock`（預設）／`post`／`off` | 有設 `ASK_LOG_ENDPOINT` 而沒設 mode 時視為 `post` |
| `ASK_LOG_ENDPOINT` | `https://…` | 必須是 https；設定矛盾（post 沒端點、mock 或 off 卻有端點）建置時報錯，不默默退回 |
| `ASK_LOG_RETENTION_DAYS` | 正整數，預設 90 | 原始紀錄保存天數（模擬後端照做；正式端要自己照做） |

端點的來源（例如 `https://logs.cdc.gov.tw`）會**自動加進 CSP 的 `connect-src`**（`scripts/lib/emit-headers.mjs`），不加進其他指令；`dist/headers/` 重新產生後照 docs/deploy.md 第 10 節的方式套用。

**請求**：`POST <endpoint>`，`Content-Type: text/plain;charset=UTF-8`（也要接受 `application/json`），本體是一個 JSON 物件，欄位如第 2 節。不帶 cookie、不帶 Referer（同網域部署時也一樣）。

**收件端必須做的事**（模擬後端 `scripts/lib/ask-log-mock.mjs` 是可以直接對照的參考實作）：

1. 本體上限 2 KB（超過回 413）；只接受 `text/plain`、`application/json`（其他回 415）；不是 JSON 物件回 400。
2. **欄位白名單**：只留第 2 節的欄位，逐欄檢查型別、格式、長度，不合格設成 null；**未知欄位一律丟掉**。
3. **再遮蔽一次問句**（同 `PII_RULES`）、去控制字元、截 200 字；沒有問句回 400。
4. 時間用**收件端自己的時鐘**、只到分鐘，不採信前端的 `t`。
5. **不記錄** IP、User-Agent、Referer、cookie；伺服器或負載平衡器的存取紀錄對這個路徑也要關掉或去識別（至少不記 query string 與 IP）。
6. 節流：同一來源每分鐘 30 筆（第六十二輪由 60 降為 30，共用 `scripts/lib/rate-limit.mjs`；見 [abuse-protection.md](abuse-protection.md)），超過回 429 並附 `Retry-After`；IP 只在記憶體計數。
7. 成功回 **204**（無內容）。跨網域部署時回應可不帶 CORS 標頭（前端用 `no-cors`，不讀回應）。
8. **保存期限**：原始紀錄保存 90 天（`ASK_LOG_RETENTION_DAYS`），到期自動刪除；彙整後的報表（只含達門檻的問句與總數）可長期保留，作為補詞彙、補內容的依據。
9. 匯出格式：每天一個 `YYYY-MM-DD.ndjson`（臺灣日期），一行一筆 JSON；放進任一目錄後 `npm run ask-log:report -- --dir=<目錄>` 即可產生報表。

**儲存建議**：原始紀錄放在機關內部、有存取控制與稽核紀錄的儲存區（例如既有的日誌平台或物件儲存的私有 bucket），只有資料治理幕僚與資訊室可讀；報表 `report.json` 才交給各組室。**任何原始紀錄與報表都不得放進 Git**（本 repo 的 `.local/` 已在 `.gitignore`；`npm run pii` 個資掃描的範圍不變）。

## 8. 資訊室確認清單

- [ ] 收件端點的位置（自建小服務、既有日誌平台、或 API gateway＋物件儲存）與網域。
- [ ] 收件端照第 7 節實作白名單、再遮蔽、節流、204，並關掉該路徑的存取紀錄（或去掉 IP 與 query string）。
- [ ] 保存期限 90 天是否符合本署個資保護與檔案管理規定；到期刪除的機制。
- [ ] 誰能讀原始紀錄、誰能拿到報表；匯出到報表的流程（排程或手動，建議每月一次）。
- [ ] 隱私權政策頁（`/policy/privacy/`）加一段說明：智慧問答會記錄已去識別的問句，用於改善答題，尊重「不要追蹤」與 GPC。（待法務／秘書室確認文字，本輪未改頁面。）
- [ ] 建置時設 `ASK_LOG_MODE=post`、`ASK_LOG_ENDPOINT=https://…`，重新產生並套用 `dist/headers/`（CSP `connect-src`）。
- [ ] 正式上線前用瀏覽器 DevTools 確認：請求沒有 Cookie、沒有 Referer；開「不要追蹤」後不送。

## 9. 選用：離線 LLM 輔助（尚未實作）

`docs/ask-search-llm.md` 已建議：模型在本站的第一個離線用途，就是**從查無問句提出同義詞建議**。這裡預留了掛點，但這一輪不實作：

- 輸入：`report.json` 裡已過 k-匿名門檻、且字串規則找不到候選的問句（只用這些；**低於門檻的問句絕不送出**），加上詞彙主檔的正名與別名摘要。
- 輸出：每題「可能對應的正名」與一句理由，寫進報表的 `llmSuggestions` 欄位（報表目前有 `llmPass: { status: 'not-implemented' }` 標記位置）。
- 做法：另寫一支 `scripts/ask-log-llm.mjs`，讀 `report.json`、呼叫模型、寫回同一檔；`scripts/lib/ask-log-report.mjs` 本身不呼叫任何網路服務。
- **人工複核不變**：模型建議跟字串候選一樣只是起點，同仁確認後才開 PR 改主檔，照常走複核。

## 10. 同仁怎麼用報表補詞彙

1. 每月（或活動、疫情升溫後）由資料治理幕僚產生報表，放到後台 `/admin/ask-log/` 載入。
2. 看「答不出來的問題」：有候選、看起來是同義詞的，按「加入詞彙主檔」→ 確認 → 複製 JSON → 開 PR。
3. 候選標「主檔已有」：詞已在主檔卻答不出來，是內容不足或引擎規則的問題，轉資訊室看引擎與評估集。
4. 沒有候選：多半是網站沒有這方面內容，或不屬本署業務，由權責單位判斷要不要新增 FAQ。
5. 補完把該題加進評估集（`content/governance/eval-set.json` 或後台 `/admin/eval/`），避免日後退步。下一期報表看同一題是否從「答不出來」消失。
