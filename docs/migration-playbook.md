# 舊站→新站內容移轉與網址轉址手冊

> 給誰看：資訊室（伺服器、CDN、DNS）、OASIS（清單與 KPI）、各組 Steward（逐筆確認舊頁對應）、公關室（對外說明與切換日溝通）。
> 依據：[ARCHITECTURE.md](../ARCHITECTURE.md) §13；規劃文件〈盤點、規格與路線圖〉§1.2（URL 模式）、§3.3（T1、T6）、§5.2、§7.4（上線前盤點）、§8.2（舊站轉址與封存）、附錄 H（robots 與 llms.txt）。

**一句話：新站上線後，每一個民眾、其他機關、搜尋引擎還記得的舊網址，都要在伺服器上收到一個「明確的答案」——301 到新頁、410 已移除，或在尚未移轉時由舊站唯讀提供。沒有第四種。**

目錄：0 摘要・1 為什麼會 404・2 轉址策略・3 對照表從哪來・4 搜尋引擎與 AI 搜尋・5 舊站保留與關閉・6 切換日 checklist・7 上線後監測・8 常見錯誤・9 範例：結核病專區・10 規模化：99 種疾病怎麼做・11 檔案與指令對照

---

## 0. 摘要：十條規則

1. 同網域換站，**舊網址 → 新網址用伺服器 301，逐筆對照**。不是全部轉首頁。
2. 一對一優先；多對一可以（用 `anchor` 對到新頁的段落）；**一對多不可**（一個舊網址只能有一個去處）。
3. 內容已刻意移除：回 **410**，不要留 404，也不要轉首頁。
4. 版本族穩定網址（`/documents/{family}/`）永遠指向現行版：用 **302**（因為目標會變）。
5. **不要鏈式轉址**：A→B→C 一律改成 A→C。HTTP→HTTPS、非 www→www 也不要多跳一次。
6. 大小寫、尾斜線先正規化再比對；識別型 query（`?epidemicId=`、`?infoId=`）要納入比對，分頁與追蹤參數（`?page=`、`utm_*`）忽略。
7. 舊附件 `/File/Get/{id}` 轉到**新的文件頁**（有版本、權責、審閱日），不直接轉到新 PDF。
8. 對照表來源只有一個：`content/migration/`（人工清單，加上由模板 `_disease-template.json` 推導出的各疾病清單）。由權責單位在後台**逐筆確認 `verified`**；`{id}` 佔位的項目不進伺服器檔。
9. 舊站不一次關：**唯讀保留 12 個月**，`showLegacyUntil` 與之一致；關閉的是「舊站本體與新頁上的揭露」，**301 不關**。
10. 上線後每週跑 `scripts/analyze-404-log.mjs`，把「待補對照」變成待辦。

---

## 1. 為什麼舊網址會 404，以及後果

新站的網址結構和舊站完全不同：舊站是 `/Disease/SubIndex/{22 字元加密 ID}`、`/Bulletin/Detail/{ID}?typeid=9`、`/File/Get/{ID}`，新站是可讀的 `/diseases/tuberculosis/`、`/news/{id}/`、`/documents/{id}/`（規劃文件 §1.2、§3.3 T6）。ID 是加密後的主鍵，**無法用規則推算**，所以不可能靠「改個前綴」自動對應，只能一筆一筆建對照表。

沒有對照表就上線，後果依序是：

| 誰受影響 | 發生什麼 | 為什麼嚴重 |
| --- | --- | --- |
| 搜尋引擎 | 舊網址累積的連結評價歸零；搜尋結果裡的舊網址點進去是 404；新網址要從頭累積 | 疾病頁、疫苗頁與新聞稿通常累積最多外部連結，流量損失會集中在民眾最常查的這些頁面 |
| 民眾 | 書籤、LINE 群組轉傳的連結、衛教單張上的短網址點開是 404 | 傳染病防治資訊的使用情境是「別人傳給我一個連結」，連結壞掉等於資訊斷線 |
| 其他機關與媒體 | 衛生局、學校、醫院、新聞報導、維基百科、公文附件中引用的連結失效 | 外部連結是搜尋評價的來源，也是機關公信力的一部分 |
| AI 搜尋與檢索系統 | 已收錄、已被引用的舊網址消失；答案引用來源變成死連結 | 規劃文件的目標是讓 AI 引用官方正本；引用到 404 比不引用更糟 |
| 內部 | 1922 話術、LINE 疾管家、衛教影片說明欄、PDF 內文裡寫死的舊網址全部失效 | 這些是機關自己的內容，沒人會主動通知你它壞了 |

**特別提醒：現行舊站 robots.txt 禁爬 `/File/` 與 `/Uploads/`（規劃文件 §3.3 T1）。** 爬蟲被擋就讀不到伺服器回的 301，這些附件網址即使你設了轉址，搜尋引擎也「看不到」。所以 robots 要在切換前先改（見 4.3）。這與 [architecture-decisions.md](architecture-decisions.md) 第 7 項「失效版本用 noindex 與 301，不用 robots.txt」是同一個道理。

---

## 2. 轉址策略

### 2.1 決策表

| 舊頁情況 | 做法 | HTTP | 清單 `status` |
| --- | --- | --- | --- |
| 舊頁整頁搬到新的一頁 | 一對一 | **301** → 新頁 | `migrated` |
| 舊頁內容併進新頁的一個段落（例如舊「症狀」子頁 → 疾病頁「症狀」區塊） | 多對一，帶 `anchor` | **301** → 新頁`#anchor` | `merged` |
| 舊頁內容刻意不再提供（過時、重複、已無業務需求） | 不轉址 | **410 Gone** | `dropped` |
| 舊頁已封存，保留供查閱（例如歷史版本） | 轉到封存頁（`target` 必填，頁面標示已封存） | **301** | `archived` |
| 新頁還沒做好 | 舊頁**繼續由舊站唯讀提供**，不轉址 | 200（舊站） | `pending`（會產生待辦） |
| 版本族穩定網址（新站自己的網址：`/documents/{family}/`） | 永遠指向現行版 | **302** | 由引擎自動產生 |
| 失效版文件的舊網址 | 轉到對應的文件頁；該頁有紅色失效橫條與現行版連結 | **301** | 由引擎自動產生 |

為什麼 301 而不是 302：301 告訴搜尋引擎「搬家了，請把評價轉過去，以後別再來問舊網址」。302 代表暫時，搜尋引擎會繼續保留舊網址。**只有目標會變動的網址（版本族）才用 302。**

### 2.2 一對一、多對一、一對多

- **一對一（優先）**：舊頁整頁有新頁對應。新頁標題最好和舊頁一致或更好，讓點進去的人不覺得被帶錯。
- **多對一（可以）**：舊站把一個主題拆成很多子頁籤（疾病介紹、症狀、傳染方式、預防…），新站是一頁八個區塊。每個舊子頁各自對到同一個新頁的不同段落，清單項目填 `target: 'disease.tuberculosis'` 與 `anchor: 'symptoms'`，轉址結果是 `/diseases/tuberculosis/#symptoms`。
  - **注意伺服器看不到 `#`**：URL 的 `#` 後面不會送到伺服器。若舊站子頁籤只是同一個 path 加不同 `#`（或純前端切換），伺服器端這幾筆其實是**同一個 from**，只能轉到新頁本身；錨點只在 `/legacy/` 查詢頁與清單說明裡生效。請 Steward 確認舊站每個子頁籤實際的網址是不同 path／query，還是同一頁，並在 `note` 寫明。
- **一對多（不可以）**：一個舊網址不能同時去兩個新頁。舊頁若同時涵蓋兩個主題，選**主要用途**那一個當 target，另一個在新頁上以「相關內容」連過去，並在 `note` 記下取捨。

### 2.3 已移除的內容回 410

`status: 'dropped'` 的舊頁，伺服器應回 **410 Gone**（比 404 更明確地告訴搜尋引擎「這頁是刻意拿掉的，請從索引移除」）。**不要把已移除的頁面轉到首頁或搜尋頁**——那會被搜尋引擎判為 soft 404，而且民眾會困惑。410 頁面本身可以顯示友善文字：這個頁面已不再提供，可以改用站內搜尋或撥 1922。

> 現況：原型輸出的三種伺服器檔**只含 301**。410 清單請從 `content/migration/*.json` 篩 `status: 'dropped'` 的項目另行產生（正式上線前待補，見 [plan-supplement.md](plan-supplement.md) 的「移轉清單」一項）。

### 2.4 版本族穩定網址用 302

`/documents/{family}/`（例如 `/documents/mmr-recommendation/`）永遠轉到該文件目前的現行版。現行版換了，這個網址指向的頁面跟著換，所以用 302。給外部機關、衛教單張、公文引用的就是這個穩定網址。已經在 `v1/redirects.json` 裡以 `kind: 'family-latest'` 輸出。

### 2.5 不要鏈式轉址

鏈式轉址（A→B→C）會浪費爬蟲預算、拖慢載入，也有搜尋引擎在跳數過多時放棄的風險。常見來源：

- 先轉到「新站第一版網址」，後來新站又改網址，沒重產對照表。**解法：對照表永遠由 `content/migration/` 重新產生，每次建置都是「舊網址→目前最終網址」。**
- HTTP→HTTPS 與 非 www→www 各跳一次。**解法：在同一條規則內一次轉到最終的網址。**
- 舊文件版本的舊網址 → 新版本的舊網址 → 現行版。**解法：引擎產生的 301 一律直接指向現行版。**

驗證方式（由資訊室在上線前跑）：

```bash
curl -sIL --max-redirs 5 'https://staging.example.gov.tw/Disease/SubIndex/<真實ID>' | grep -iE '^(HTTP|location)'
# 預期只看到一次 301 與一個 200；看到兩次以上 301/302 就是鏈式
```

### 2.6 大小寫與尾斜線

舊站是 ASP.NET MVC，路徑不分大小寫（`/disease/subindex/` 與 `/Disease/SubIndex/` 都會開）。民眾與其他網站的連結什麼寫法都有。因此：

- 比對時**路徑部分不分大小寫**，忽略尾斜線（`/Disease/SubIndex/x` 與 `/Disease/SubIndex/x/` 視為同一個）。`v1/legacy-map.json` 與 404 頁的查表就是這樣比對的（ARCHITECTURE §13.1）。
- **ID 本身是 base64url，理論上區分大小寫。** 建清單時請照官網原樣貼，不要自己轉大小寫；上線前由 OASIS 用清單檢查「兩筆舊網址只差在大小寫」的情形（極罕見，發現就人工確認）。
- 新站網址一律小寫、有尾斜線（`/diseases/tuberculosis/`）。轉到新站不一致的寫法（缺尾斜線）也是一跳多餘的轉址，目標欄位請寫 canonical 形式。

### 2.7 Query 參數

| 類型 | 例子 | 處理 |
| --- | --- | --- |
| 分頁、排序 | `/Bulletin/List/{ID}?page=3` | **忽略**。列表整體轉到新站的列表頁（例如 `/news/`），不保留頁碼 |
| 識別型（參數本身決定是哪一筆） | `/TravelEpidemic/Detail/{ID}?epidemicId=…`、`/InfectionReport/Info/{ID}?infoId=…`、`/Category/ListContent?uaid=…` | **納入比對**。伺服器要用「路徑＋該參數」當 key，否則所有 `epidemicId` 會被轉到同一頁 |
| 分類 | `/Bulletin/Detail/{ID}?typeid=9` | 這筆新聞稿由 ID 決定，`typeid` 只是分類脈絡，通常可忽略。若同一 ID 在不同 `typeid` 下是不同內容，再改為納入比對 |
| 追蹤參數 | `utm_*`、`fbclid`、`gclid` | 忽略；轉址後不要帶到新網址 |

nginx 的 `$uri` 不含 query；識別型參數要改用 `$request_uri` 或 `$arg_xxx` 組合 key。**實際產出檔的 key 長相以 `redirects/nginx.map` 為準，由資訊室在測試機用一份真實舊網址清單驗證。**

### 2.8 附件：`/File/Get/{id}` 轉到新文件頁

舊站手冊與指引是 PDF（`/File/Get/{ID}`、`/File/NewGet/{ID}`、舊 `/uploads/files/{yyyymm}/{GUID}.pdf`）。新站每份文件都有**文件頁**：版本、生效日、權責單位、審閱日、版本鏈、異動對照、機讀版，PDF 只是頁面上的一個下載連結。因此：

- 舊附件網址 → **301 到新的文件頁**（`/documents/{id}/`），不是直接轉到新 PDF 檔。民眾和 AI 一進來就看得到「這是第幾版、現行嗎、誰負責」。
- 指向舊版的附件：清單 `target` 優先填**該版本自己的文件頁**（頁面有紅色失效橫條，一鍵到現行版）。上線前以 `v1/redirects.json` 的 `to` 欄位抽驗，確認舊版 PDF 去的是預期的那一頁。
- 附件網址在舊站 robots 是被禁爬的（見第 1 節），一定要先放行才能讓搜尋引擎看到 301。規劃文件附錄 H 的做法是：現行檔放 `/File/Public/`，失效版放 `/File/Archive/` 並由伺服器回 `X-Robots-Tag: noindex`，`/Uploads/` 改由伺服器 301。

### 2.9 原型和正式站的差別（重要）

原型部署在 GitHub Pages（純靜態），**靜態頁無法回 301**。所以原型的做法是：

- `404.html` 載入 `v1/legacy-map.json`，用 `location.pathname + search` 查對照，命中就顯示「舊網址已搬家，3 秒後帶你到新頁」並用 JavaScript 轉過去；
- `/legacy/` 查詢頁讓人貼舊網址查新頁。

這兩者是**示範與備援**。Pages 對不存在的路徑回的 HTTP 狀態仍是 **404**，搜尋引擎看到的是 404，不會轉移評價。**正式站必須在伺服器或 CDN 層回真正的 301**（依 [deploy.md](deploy.md) 第 7 節第 5 點）。JavaScript 轉址只留作最後一道人工兜底。

---

## 3. 轉址對照從哪來、誰維護

### 3.1 資料流

```
舊站盤點 → 建清單（content/migration/{slug}.json）→ 權責單位逐筆確認（verified: true）
       → npm run build 自動產生 → v1/redirects.json、v1/legacy-map.json、redirects/{nginx.map, web.config.rewritemap.xml, _redirects}
       → 資訊室匯入伺服器（301／410）
```

1. **盤點**（OASIS 牽頭，各組協助）：列出舊站某專區／欄目樹下所有頁面，含子頁籤、Q&A、列表、附件、外部連結。來源：舊站網站導覽、CMS 後台匯出、**過去 12 個月的 access log 與 Search Console 的熱門頁面**（有流量的舊網址一個都不能漏）。規劃文件 §7.4 第 4 點的「上線前一次性盤點」（保留、合併、封存的四因子判斷）就在這一步做，判斷結果寫成每筆的 `status`。
2. **建清單**：一個專區或欄目一份 `content/migration/{slug}.json`（結構見 ARCHITECTURE §13.1），逐筆填 `oldTitle`、`oldPath`、`oldUrl`、`oldType`、`status`、`target`、`anchor`、`note`、`newRequirements`。
3. **逐筆確認**：權責單位的 Steward 到 `/admin/migration/`，對每一筆確認「舊頁真的是這個網址、對應的新頁正確」後，把 `verified` 改為 `true`（匯出 JSON、開 PR）。**未確認（`verified: false`）的項目只在後台列出，不開待辦，但上線前必須清零。**
4. **建置輸出**：`npm run build` 把清單轉成 `v1/redirects.json`（`kind: 'migration'`）、`v1/legacy-map.json`（給 404 頁與 `/legacy/` 查詢用）與三種伺服器格式。
5. **伺服器匯入**：資訊室把產出檔放進伺服器設定，上線前在測試機驗證。

### 3.2 三種伺服器格式

| 檔案 | 用在 | 備註 |
| --- | --- | --- |
| `redirects/nginx.map` | Nginx（含多數 CDN 的 Nginx 層） | 例：`~^/Disease/SubIndex/xxx$ /diseases/tuberculosis/;` |
| `redirects/web.config.rewritemap.xml` | IIS rewriteMap（現行舊站為 ASP.NET MVC，最可能的情境） | 需另加一條 rule 引用此 map |
| `redirects/_redirects` | Netlify、Cloudflare Pages 等託管平台 | 格式 `from to 301`；注意平台對靜態轉址筆數有上限，請查所用平台文件 |

Nginx 接法示意（資訊室請在測試機驗證後使用）：

```nginx
# http 區塊
map $uri $cdc_redirect {
    default "";
    include /etc/nginx/redirects/nginx.map;     # 內容形如：~^/Disease/SubIndex/xxx$ /diseases/tuberculosis/;
}
# server 區塊
if ($cdc_redirect) { return 301 $cdc_redirect; }
```

IIS 接法示意：把產出的 `<rewriteMaps>` 併入 `web.config`，再加一條規則（`appendQueryString="false"`，避免舊 query 被帶到新網址）：

```xml
<rule name="CdcLegacyRedirect" stopProcessing="true">
  <match url=".*" />
  <conditions><add input="{CdcLegacy:{REQUEST_URI}}" pattern="(.+)" /></conditions>
  <action type="Redirect" url="{C:1}" redirectType="Permanent" appendQueryString="false" />
</rule>
```

> 提醒：**瀏覽器會永久快取 301**。第一次在正式環境啟用前，先在測試環境確認；若要保守，可先以 302 小範圍試跑，確認無誤再切 301。切換後發現某條 301 錯了，使用者端要很久才會清掉，所以預防比修補重要。

### 3.3 `{id}` 佔位不進伺服器檔

舊網址 ID 不確定的項目，清單保留 URL 模式、ID 以 `{id}` 佔位（例：`https://www.cdc.gov.tw/Disease/SubIndex/{id}`）。這類項目在 `redirects.json` 會標 `pattern: true`，**不會**進入三種伺服器檔，只出現在文件與後台。原因：把 `{id}` 當萬用字元寫進伺服器規則，會讓**所有** `/Disease/SubIndex/*` 都被轉到同一頁，後果見第 8 節。

> 這是原型的限制：開發環境連不到 `www.cdc.gov.tw`，結核病專區的舊 ID 無法取得。**正式移轉時，權責單位確認 `verified` 的同時，要把 `{id}` 換成真實 ID**；換完才會進伺服器檔。後台進度表上「`{id}` 佔位」的筆數要降到 0 才能切換。

### 3.4 誰維護什麼

| 工作 | 誰 | 在哪裡 |
| --- | --- | --- |
| 盤點舊頁、建清單、決定保留／合併／封存 | OASIS＋各組 Steward | `content/migration/{slug}.json` |
| 逐筆確認對應並改 `verified: true`、補真實 ID | 該專區權責單位 Steward | `/admin/migration/` → 匯出 JSON → PR |
| 新頁內容與治理欄位（`owner`、`reviewedAt`、`basedOn`…） | 權責單位 Steward | `content/` 各型別（見 [guide-staff.md](guide-staff.md) 第 2 節、第 15 節） |
| 把產出檔匯入伺服器、測試、回復 | 資訊室 | `redirects/*`、伺服器設定 |
| 看 404 報表、補對照 | OASIS 彙整，Steward 補 | 第 7 節 |
| 對外說明、通知其他機關與媒體 | 公關室 | 第 6 節 checklist |

---

## 4. 搜尋引擎與 AI 搜尋

### 4.1 sitemap.xml 只列新網址

- 新站 `sitemap.xml`（索引）與 `sitemap-*.xml` 由建置自動產生，只含 canonical 的新網址；失效版文件（`noindex`）不在其中。
- **不要把舊網址放進 sitemap。** 舊網址由 301 負責，不是由 sitemap。
- 上線當天在 Google Search Console 提交 `sitemap.xml`；Bing Webmaster Tools 同理。Bing 與部分搜尋引擎支援 IndexNow 通知協定，資訊室可評估，非必要。

### 4.2 Search Console 怎麼用

同網域換站（網域不變、只改路徑）**沒有也不需要「變更地址」工具**（那是換網域用的）；若上線同時換網域，才在舊網域的資源上用「變更地址」。同網域換站做這幾件事：

1. **切換前**：確認網域層級資源已驗證、記錄基準（過去 90 天點擊、曝光、前 500 個熱門舊網址）。
2. **切換當天**：提交新 `sitemap.xml`。
3. **切換後 1–2 週**：「網址檢查」抽查前 50 個熱門舊網址與其新網址，確認 Google 看到的是「網頁會重新導向」，且新頁的「使用者宣告的標準網址」與「Google 選擇的標準網址」一致。
4. **切換後每週**：看「網頁索引」報表：「找不到 (404)」、「網頁會重新導向」、「重複網頁，Google 選擇的標準網址與使用者不同」三類的數字，異常就回到第 7 節處理。
5. **不要用「移除網址」工具處理已搬家的舊網址**——它只是暫時隱藏，且會干擾 301 的處理；已搬家的頁面讓 301 自己處理，已刪除的頁面回 410。

### 4.3 舊站 robots：不要一次全禁，反而要先放行

- 現行舊站 robots 禁爬 `/File/`、`/Uploads/`（規劃文件 §3.3 T1）。**切換前 30 天先改**：依規劃文件附錄 H，改為不 Disallow、由伺服器處理 301／`X-Robots-Tag`，爬蟲才看得到轉址。
- **切換後也不要把舊站整站 `Disallow: /`。** 全禁的結果是爬蟲不再抓舊網址，看不到 301，已收錄的舊網址反而更久才會被取代。
- `robots.txt` 擋的是「抓取」不是「收錄」；要讓舊網址退出索引，靠的是爬蟲能讀到 301／410／`noindex`。

### 4.4 canonical、hreflang、結構化資料

- 新站每頁都有自我指向的絕對 canonical（`SITE_URL` + `BASE_PATH` 產生）、七語 hreflang 加 `x-default`。**301 的目標必須就是 canonical 網址**，不要轉到一個又 canonical 到別處的網址。
- 舊站英文區（`/En/...`）的頁面要在清單裡當獨立項目處理，轉到 `/en/...` 的對應頁；沒有英文版的轉到中文版並在 `note` 記錄。
- JSON-LD（`MedicalCondition`、`FAQPage`、`NewsArticle`、`DigitalDocument`…）的 `url` 一律用新 canonical；不要把舊網址放進 `sameAs`。上線後在 Search Console 看「增強功能」報表有無錯誤。

### 4.5 預期時程

搜尋引擎要重新爬完、重新索引、重新累積排名訊號，**預期 3–12 週**；網站愈大、愈多頁面愈久。這段期間流量波動是正常的。建議的警戒線：T+4 週自然搜尋點擊仍低於基準的 50%，或 T+12 週低於基準的 90%，就啟動排查（404 率、被 noindex 的目標、鏈式轉址、canonical 不一致）。數字是建議值，請 OASIS 在切換前與委員會確認。

### 4.6 Bing 與 AI 搜尋

- Bing（也是多數 AI 搜尋的資料來源之一）：Bing Webmaster Tools 提交 sitemap，看法同 Google。
- AI 搜尋與檢索型爬蟲（規劃文件附錄 H 的第二類）沒有「提交」機制，靠的是爬取到 301 與新頁。確保 robots 對這些爬蟲是允許的；新站 `llms.txt` 與 `.md` 機讀版只列新網址。
- 已被 AI 系統收錄的舊網址更新較慢，所以 301 要保留夠久（見第 5 節）。`llms.txt` 沒有被各家模型一定讀取的保證（規劃文件附錄 H），它的價值是把白名單與正本位置寫成對外清單。

---

## 5. 舊站保留期與關閉

### 5.1 三層保留，意義不同

| 層 | 內容 | 保留多久 | 關閉後 |
| --- | --- | --- | --- |
| **轉址層** | 伺服器上的 301／410 規則 | **長期保留**（搜尋引擎官方建議至少一年；機關建議常態保留，成本極低） | 不關。舊網域或舊路徑被連到，仍由伺服器 301 |
| **舊站本體** | 舊 CMS 唯讀運行：供尚未移轉（`pending`）的頁面、查證、回復使用 | **12 個月**（建議；與 `showLegacyUntil` 一致） | 下線；`pending` 項目此時必須已清零或已決定 `dropped` |
| **新頁上的舊網址揭露** | 疾病頁等顯示「本頁取代舊網站 N 個頁面」與對照明細 | 到 `showLegacyUntil` | **自動隱藏**，不需人工；`/legacy/` 查詢頁仍可查 |

### 5.2 舊站唯讀期怎麼運作

- 舊 CMS 關閉編輯功能（唯讀）；新內容只寫在新站（`content/`）。
- **已移轉（`migrated`／`merged`）的路徑**：由前端伺服器直接 301 到新站，民眾看不到舊站。
- **尚未移轉（`pending`）的路徑**：由前端伺服器轉送（反向代理）到唯讀舊站，頁首加告示「本站已搬家，3 秒後前往新站」（有對照者倒數後轉過去；無對照者只顯示告示與新站入口，不自動轉）。這與原型 404 頁的行為相同，只是改由舊站的版型實現。
- **回復計畫**：唯讀舊站在保留期內隨時可以把某些路徑的 301 拿掉、切回舊站，所以 T-0 當天不要回收舊站主機。

### 5.3 `showLegacyUntil`：建議值與關閉流程

- 建議值：**正式上線日 + 12 個月**，清單中每份 `showLegacyUntil` 填同一天，方便一次檢視。原型的結核病示範填 `2027-12-31`，只是示範，正式日期依實際上線日。
- 到期前 60 天：OASIS 跑 `/admin/migration/` 檢查是否還有 `pending`；公關室預告「舊網站將於 X 月 X 日關閉」。
- 到期當天：新頁的揭露自動隱藏（`gov.legacy.show = false`）；資訊室下線舊站本體。
- 到期後：**301／410 規則維持不動**。`content/migration/*.json` **不要刪除或改為 draft**——它是三種伺服器檔的來源；清單退場前先比對輸出，確認 301 條數沒有減少。

---

## 6. 切換日 checklist

「怎麼確認」欄一律是可以實際做的檢查。

| 時點 | 工作 | 誰 | 怎麼確認 |
| --- | --- | --- | --- |
| **T-30** | 清單盤點完成；所有舊頁都有 `status` | OASIS、Steward | `/admin/migration/` 無「未分類」；有流量的前 500 舊網址 100% 在清單內 |
| T-30 | 權責單位逐筆確認，`verified` 目標 100%，`{id}` 佔位歸零 | Steward | 後台進度表「待核對」與「`{id}` 佔位」均為 0 |
| T-30 | 舊站 robots 先放行 `/File/`、`/Uploads/`（附錄 H） | 資訊室 | 瀏覽舊站 `robots.txt`，兩條 Disallow 已移除 |
| T-30 | 記錄基準：90 天搜尋點擊、熱門頁、現行 404 率；log 保留設定 ≥ 90 天且去識別 | 資訊室、OASIS | 基準值存檔（Search Console 匯出＋log 統計） |
| T-30 | 舊站頁首告示「新官網將於 X 月 X 日上線」；驗證 Search Console 與 Bing 資源 | 公關室、資訊室 | 抽 5 個舊頁看得到告示 |
| **T-7** | 舊站內容凍結：新內容只寫新站 | 公關室、Steward | 通知發出；舊站編輯權限關閉 |
| T-7 | 本機以正式環境變數建置並檢查：`BUILD_TODAY=<切換日> LINK_CHECK=error npm run build`、`npm test` 全綠 | 資訊室 | `[links] error 0` |
| T-7 | 三種伺服器檔在測試機匯入；以真實舊網址清單批次驗證 | 資訊室 | 全部 301 一次到位、無鏈式（2.5 的 curl 檢查）、無 5xx |
| T-7 | 回復計畫書面確認；CDN 快取與 TTL 設定 | 資訊室 | 有人演練過「撤掉某條規則」要多久生效 |
| **T-0** | 依序：部署新站 → 啟用轉址規則 → 提交 sitemap → 抽驗 → 舊站轉唯讀 → 通知 | 資訊室、公關室 | 抽驗 20 個舊網址（含附件、英文、含 query）都到正確的新頁；隨意輸入一個不存在的網址，確實回 404 |
| T-0 | 通知 1922、LINE 疾管家、衛生局、媒體與引用機關 | 公關室 | 通知名單回報 |
| **T+1** | 看前一日 log：404 前 50 名；5xx；轉址迴圈 | 資訊室、OASIS | 跑 `analyze-404-log`（第 7 節）；報表已轉成待辦 |
| T+1 | Search Console「網址檢查」抽測熱門頁 | OASIS | 顯示重新導向且 canonical 一致 |
| **T+30** | 第一次檢討：KPI、`pending` 剩餘、待補對照；決定每個 `pending` 的期限 | 委員會幕僚 | 第 7.4 節 KPI 表；會議紀錄 |
| T+90 | 搜尋流量回復檢查；清理 `dropped` 的 410 名單 | OASIS | Search Console 與基準比較 |
| T+12 個月 | 舊站本體下線、`showLegacyUntil` 到期、揭露自動隱藏 | 資訊室、OASIS | 後台 `pending` 為 0；301 條數未減少 |

---

## 7. 上線後監測

### 7.1 取得 log

資訊室每天（至少上線前 3 個月）把前端伺服器的 access log 留存，格式 Nginx combined 或 IIS W3C 均可。**log 含 IP，須依機關規定去識別或限制存取**；分析只需要路徑、狀態碼、次數，可先過濾再交給 OASIS：例如只保留狀態碼 404 的行。

### 7.2 跑分析

```bash
node scripts/analyze-404-log.mjs access.log \
  --map dist/v1/legacy-map.json \
  --migration content/migration > 404-report.md
```

腳本自動判斷 log 格式，抓出 404 的路徑與次數，對照 `v1/legacy-map.json`（已部署的對照）與 `content/migration/`（清單），輸出 Markdown 報表三類：

| 輸出分類 | 意思 | 怎麼處理 | 誰 |
| --- | --- | --- | --- |
| **可直接 301** | 這個舊網址在對照裡**已經有**，但伺服器沒回 301（可能是新對照還沒部署、比對規則不一致，或大小寫、尾斜線、query 的差異） | 查伺服器為何沒命中：先確認最新 `redirects/*` 已部署；再用 2.6、2.7 的規則檢查比對方式 | 資訊室 |
| **待補對照** | 符合舊站 URL 模式（例如 `/Disease/SubIndex/…`），但清單沒有它。報表附一段可貼進 migration JSON 的 `items` 草稿 | 把草稿貼進對應的 `content/migration/{slug}.json`（草稿 `verified: false`），Steward 確認 `target` 後改 `true`，開 PR；下一次部署生效 | Steward（OASIS 彙整分派） |
| **真的不存在（建議 410）** | 不符合任何舊站模式，也沒有對照：多半是爬蟲亂掃、打錯字、已刪除很久的頁面 | 次數高的（例如一週超過 20 次）先確認不是漏盤的舊頁；確認後加進 410 名單；其餘不處理 | OASIS |

### 7.3 多久跑一次、怎麼變成待辦

| 期間 | 頻率 | 做法 |
| --- | --- | --- |
| T+1 ~ T+14 | 每日 | OASIS 跑報表，「待補對照」當天分派 |
| T+15 ~ T+90 | 每週一 | 同上，併入週一的 `/admin/todos/` 檢視 |
| T+91 之後 | 每月 | 到 `showLegacyUntil` 前一個月再恢復每週 |

「待補對照」變成待辦的實際方式：OASIS 把報表中同一專區的草稿整理成一個 PR（開給該專區 Steward 覆核）。這條 PR 合併前，清單上 `verified: false` 的項目**不開待辦**；`status: 'pending'` 且 `owner` 存在的項目，引擎會自動開 `migration-pending` 待辦（中優先），出現在 `/admin/todos/`。

### 7.4 KPI

| 指標 | 怎麼算 | 建議目標（需委員會核定） |
| --- | --- | --- |
| **404 率** | 404 回應數 ÷ HTML 頁面請求數（排除爬蟲亂掃的前幾名後另列） | T+30 ≤ 1%；T+90 ≤ 0.5% |
| **舊網址轉址命中率** | 被 301 命中的舊網址請求 ÷（301 命中 + 符合舊站 URL 模式的 404） | T+7 ≥ 95%；T+30 ≥ 99% |
| **搜尋流量回復** | 自然搜尋點擊（Search Console）÷ 切換前 90 天同期基準 | T+4 週 ≥ 50%；T+12 週 ≥ 90% |
| 清單確認率 | `verified: true` ÷ 總筆數（後台進度表） | T-7 前 100% |
| 待補對照存量 | 報表「待補對照」未處理筆數 | 每週遞減；T+90 為 0 |
| `pending` 剩餘 | `migration-pending` 待辦數 | 到 `showLegacyUntil` 前為 0 |

---

## 8. 常見錯誤

| 錯誤 | 後果 | 正確做法 |
| --- | --- | --- |
| 舊網址全部轉首頁 | 搜尋引擎判 soft 404、評價不轉移；民眾找不到原本要的頁面 | 逐筆對照；沒有對應的回 410 |
| 鏈式轉址（A→B→C） | 載入慢、爬蟲放棄、評價衰減 | 對照表每次重產，直接指最終網址；HTTP→HTTPS 與 www 合併成一跳 |
| 301 的目標被 `noindex` 或 canonical 到別處 | 搜尋引擎不採用該目標，等於沒轉 | 目標必須是現行、可索引的 canonical 頁；失效版另走版本鏈規則 |
| 把 `{id}` 佔位當萬用字元寫進伺服器 | 所有 `/Disease/SubIndex/*` 全轉到同一頁 | 佔位項目不進伺服器檔；補上真實 ID 後才輸出 |
| 路徑大小寫與尾斜線沒正規化 | 同一頁的另一種寫法 404 | 路徑不分大小寫、忽略尾斜線地比對；ID 照原樣 |
| 識別型 query 被忽略 | 所有 `?epidemicId=` 都轉到同一頁 | 識別型參數納入 key（2.7） |
| 分頁、追蹤參數被帶到新網址 | 新網址帶雜訊，canonical 不一致 | 轉址不帶舊 query（`appendQueryString="false"`） |
| 301/302 搞混 | 搜尋引擎持續保留舊網址，或把版本族網址永久綁死 | 搬家用 301；版本族穩定網址用 302 |
| 啟用前沒測，301 被瀏覽器永久快取 | 錯誤的轉址修不回來 | 先在測試機驗證，必要時先 302 試跑 |
| 舊站 robots 一次全禁（或附件路徑維持 Disallow） | 爬蟲看不到 301，舊網址更久才被取代 | 切換前放行；切換後不全禁（4.3） |
| sitemap 放了舊網址或會被轉址的網址 | 搜尋引擎收到互相矛盾的訊號 | sitemap 只列 canonical 新網址 |
| 只轉 HTML，忘了附件、RSS、圖片、英文區 | 附件與訂閱斷線（舊 RSS 只有 4 個頻道、guid 為時間戳，規劃文件 D5） | 清單涵蓋 `oldType: 'pdf'`、`'list'`、`/En/` 與 RSS 頻道；訂閱者另行通知 |
| 舊附件直接轉新 PDF | 看不到版本與治理資訊，AI 可能引用到舊版 | 轉到新文件頁（2.8） |
| 清單刪了或 `status` 改掉，以為揭露過期就可以 | 301 條數減少，舊網址又 404 | 關閉的是揭露，不是轉址；退場前比對輸出（5.3） |
| 上線後不看 log | 漏盤的舊頁一直 404，沒人知道 | 第 7 節的固定節奏 |
| 只在內網測，CDN／WAF 規則另有一套 | 正式環境行為不同 | 測試要走和正式相同的路徑（含 CDN） |

---

## 9. 範例：結核病專區走一遍

結核病是第一個完整示範（ARCHITECTURE §13.2）。同一套做法可以套到其他 98 種疾病與所有欄目（規模化的作法見第 10 節）。

> 限制：開發環境連不到 `www.cdc.gov.tw`，舊站子頁清單依規劃文件 §1.2 的 URL 模式重建，每筆標 `verified: false`，舊網址 ID 以 `{id}` 佔位。以下是**流程示範**，不是已確認的真實對照。

### 9.1 舊頁

舊站結核病專區入口為 `https://www.cdc.gov.tw/Disease/SubIndex/{id}`（疾病頁，子頁籤包含疾病介紹、疫情、指引教材、治療照護、宣導、研究出版、Q&A）。另有：

- 指引與手冊 PDF（`/File/Get/{id}`）：診治指引、潛伏結核感染診治指引、接觸者檢查指引、都治計畫作業手冊、通報定義
- Q&A（`/Category/QAPage/{id}`）、新聞稿列表（`/Bulletin/List/{id}?page=n`）、衛教素材、統計、檢驗、補助與高風險族群篩檢說明

### 9.2 清單

OASIS 與慢性傳染病組（`owner: unit.chronic-infectious`）建立 `content/migration/tuberculosis.json`，約 30–40 筆。節錄形狀如下（省略治理共同欄位與部分項目；欄位定義見 ARCHITECTURE §13.1，實際內容以該檔為準）：

```json
{
  "id": "migration.tuberculosis",
  "type": "migration",
  "owner": "unit.chronic-infectious",
  "scope": { "kind": "disease", "disease": "disease.tuberculosis" },
  "legacyRoot": "https://www.cdc.gov.tw/Disease/SubIndex/{id}",
  "showLegacyUntil": "2027-12-31",
  "items": [
    { "key": "intro", "oldTitle": "疾病介紹", "oldPath": "結核病／疾病介紹",
      "oldUrl": "https://www.cdc.gov.tw/Disease/SubIndex/{id}#intro", "oldType": "page", "verified": false,
      "status": "merged", "target": "disease.tuberculosis", "anchor": "symptoms",
      "note": "併入疾病頁「症狀」區塊", "newRequirements": ["owner", "reviewedAt", "languages"] },
    { "key": "guideline", "oldTitle": "結核病診治指引", "oldPath": "結核病／指引與手冊",
      "oldUrl": "https://www.cdc.gov.tw/File/Get/{id}", "oldType": "pdf", "verified": false,
      "status": "migrated", "target": "doc.tb-guideline",
      "note": "PDF 轉到文件頁（有版本鏈）", "newRequirements": ["owner", "reviewedAt", "basedOn", "machineReadable"] },
    { "key": "dots", "oldTitle": "都治計畫作業手冊", "oldPath": "結核病／指引與手冊",
      "oldUrl": "https://www.cdc.gov.tw/File/Get/{id}", "oldType": "pdf", "verified": false,
      "status": "migrated", "target": "doc.dots-manual", "newRequirements": ["owner", "reviewedAt", "machineReadable"] }
  ]
}
```

每一筆的 `status` 就是第 2 節決策表：疾病介紹各子頁是 `merged`（多對一，帶 `anchor`）；PDF 是 `migrated`（一對一，到文件頁）；過時的舊海報可以是 `dropped`；新頁還沒做好的是 `pending`。

### 9.3 新頁

結核病的新內容全部走既有型別、每筆都有完整治理欄位：疾病頁 `content/diseases/tuberculosis.json`、文件版本鏈（`doc.tb-guideline`、`doc.ltbi-guideline`、`doc.tb-contact-investigation`、`doc.dots-manual`、`doc.tb-case-definition`）、Q&A、專區 `topic.tb-prevention`、申請服務（結核病診治費用補助、潛伏結核感染治療）、新聞。引擎從 `target` 反向建立 `gov.legacy`，所以新頁自己知道「我取代了舊站哪幾個頁面」。

### 9.4 轉址

建置後：

- `v1/redirects.json` 多一批 `kind: 'migration'`；`{id}` 佔位的項目標 `pattern: true`，只出現在文件與後台。
- 一旦 Steward 在後台把某筆換成真實 ID 並確認，該筆才進 `redirects/nginx.map`（或 IIS／`_redirects` 版本）。
- `v1/legacy-map.json` 讓 404 頁與 `/legacy/` 查得到。

### 9.5 揭露

結核病疾病頁頁首治理列有一句「本頁取代舊網站 N 個頁面」（`gov.legacy.show` 為 true 時出現）；展開 `<details>` 看到每筆舊標題、舊網址（外連）、狀態與「移轉後新增的治理要求」；專業人員可以點進 `/legacy/?u=` 查詢。這些顯示讓同事和民眾看到：**舊網站的內容沒有不見，而且現在有了權責單位、審閱日與依據正本**。

### 9.6 關閉

到 `showLegacyUntil`（示範為 2027-12-31，正式為上線日 + 12 個月）：

1. 上線前的檢查：後台結核病清單 `pending` 為 0、`verified` 100%、`{id}` 佔位為 0。
2. 到期當天：疾病頁的揭露自動隱藏，不需任何人操作。
3. 舊站結核病路徑的唯讀服務下線。
4. **301 不動**，`content/migration/tuberculosis.json` 繼續留在 repo。

---

## 10. 規模化：99 種疾病怎麼做

結核病一份清單 46 筆（其中人工寫的約 40 筆）。如果 99 種法定傳染病都這樣手寫，要寫近 4,000 筆，而且其中約 20 項是每個疾病一模一樣的標準子頁——這不是人力問題，是做法問題。第六輪把做法改成「**模板推導，人工只寫例外**」（ARCHITECTURE §14.1）。

### 10.1 為什麼可以推導

舊站每個疾病頁的結構相同：疾病介紹的各分頁（致病原、流行病學、傳染方式、潛伏期、發病症狀、預防方法、治療方法與就醫資訊）、預防接種建議、Q&A、衛教宣導（單張海報、影片）、法規與指引（工作手冊、病例定義、治療指引）、統計資料、檢驗資訊、通報定義、新聞稿列表、相關連結。舊網址模式也相同（`/Disease/SubIndex/{id}` 加分頁）。這個「標準子頁樹」寫成一份模板 `content/migration/_disease-template.json`，目前 20 項，由 OASIS 維護。

### 10.2 推導規則

每項模板有 `mapTo`，描述「新站哪裡有對應就算移轉」。引擎對主檔每一種疾病逐項判斷：

| 情況 | 推導結果 |
| --- | --- |
| 疾病頁存在，`mapTo` 指向疾病頁區塊、主檔欄位或站內固定頁，且命中 | `merged`（多對一併入） |
| 疾病頁存在，`mapTo` 指向關聯內容（Q&A、文件、影音、資料集、檢驗、新聞…）且該疾病有此類內容 | `migrated`（`target` 為該內容 id） |
| 疾病頁存在，但 `mapTo` 沒命中（例如沒有該疾病的衛教單張出版品） | `pending` |
| 疾病頁不存在 | 整份清單 `status: no-page`，所有項目 `pending` |

推導項一律 `verified: false`；舊網址一律是 `{id}` 佔位，所以全部標 `pattern: true`，**不進伺服器轉址檔**，只進文件、`/legacy/` 的模式比對與後台。

**覆蓋規則：** 人工清單（`content/migration/{slug}.json`）與模板同 `key` 時以人工為準；人工沒寫的 `key` 仍由模板補。人工清單用 `extends: 'migration-template.disease'` 明示。

### 10.3 人工只寫例外

四個疾病（登革熱、流感、麻疹、腸病毒）各寫 7–8 筆，內容都是模板沒有的：

| 類型 | 例子 |
| --- | --- |
| 疾病特有的專區頁 | 登革熱防治專區、流感疫苗專區、麻疹及德國麻疹消除專區、腸病毒防治專區 |
| 具名的專屬 PDF 與歷版 | 接觸者追蹤作業指引、教托育機構指引、歷版防治工作指引、舊版 MMR 建議 |
| 名單與事件型頁面（多半是 `pending`） | 病媒蚊密度調查、合約院所與藥局、重症責任醫院、接觸者活動場所公告 |
| 過時不移轉（`dropped`） | 歷年流感疫苗接種計畫、歷年腸病毒海報 |

目前原型：主檔 72 種，其中 16 種已有新站疾病頁、56 種尚無（`no-page`）；5 份人工清單（結核病與上述四種），其餘 67 份由模板推導。**5–8 筆是常態**；超過 15 筆代表模板缺了一種全部疾病都有的標準子頁，應改模板而不是每個疾病各寫一遍。

### 10.4 待辦聚合與優先度

每份清單只開**一則**待辦（「{疾病}：N 個舊頁待移轉」；`no-page` 為「{疾病}：疾病頁尚未建立，N 個舊頁待移轉」），不再逐筆開，否則 72 份清單會一次灌進上千則待辦，沒人看得完。優先度依法定類別：第一、二類高、第三類中、第四與五類低。同事處理的順序因此自然是：高優先度疾病的 `pending` → 補內容 → 下次建置自動轉為已移轉。

### 10.5 推導不等於可轉址

推導清單只回答「新站有沒有對應內容」，**不回答「舊網址是什麼」**——舊網址是加密 ID，推導只能用 `{id}` 佔位。要讓 301 真的生效，需要舊站的 ID 對照：

1. 請資訊室從舊站資料庫匯出 `id、標題、類型、所屬分類` 一張表（或由 sitemap 與 access log 還原）。
2. 以疾病名稱與分頁標題比對，批次把 `{id}` 換成真實 ID（腳本產生草稿，人看過）。
3. Steward 在後台逐筆確認後，該筆 `verified: true` 並進伺服器轉址檔。

在 ID 補齊之前，推導清單的價值是：（a）讓全部門看到每個疾病的進度；（b）讓 `/legacy/` 與 404 頁至少能以模式提示「這是舊站疾病頁的『發病症狀』，新站對應某疾病的『症狀』區塊」；（c）上線後 404 log 分析可以把符合模式的路徑歸為「待補對照」。

### 10.6 推進順序與 KPI

1. **第一批：高優先度**（第一、二類與流量大的第三類疾病）：先確認疾病頁存在，再清 `pending`。
2. **第二批：`no-page` 的疾病**：先建疾病頁（八個區塊可部分 `pending`），推導項目就會陸續命中；沒有流量且無需求者，由權責單位決定整頁 `dropped`（寫人工清單，回 410）。
3. **例外**：每個有疾病特有專區的疾病，由 Steward 補人工清單。
4. **確認**：Steward 逐筆 `verified`，目標在切換日前達 100%，且 `{id}` 佔位為 0。

KPI（後台 `/admin/migration/`）：整體已移轉＋已併入比例、`pending` 筆數、`no-page` 份數、`verified` 比例、人工與推導清單份數。

### 10.7 常見陷阱

- **把推導的「已併入」當成已確認。** 推導只看新站有沒有對應內容，不看內容夠不夠。最後把關是 Steward 的逐筆確認。
- **在人工清單重寫標準子頁。** 浪費，而且之後模板調整時人工項會蓋掉新規則。只寫例外。
- **例外 key 撞到模板 key。** 例外請加疾病前綴（`dengue-zone`），否則會無意間覆蓋模板項。
- **document 的 `target` 寫版本族 id。** 要寫含版本的完整 id。
- **`no-page` 清單被忽略。** 56 份 `no-page` 的待辦優先度低不等於可以不做：舊網址若沒人處理，上線後就是 404。

### 10.8 欄目型（非疾病）清單：人才招募、採購

不是所有舊站內容都長得像疾病頁。人才招募與採購公告是**欄目型**：沒有「標準子頁樹」可以套模板，所以走人工清單，`scope.kind` 為 `category`（與國際合作區塊同類）。第七輪有兩份：

| 清單 | 檔案 | 舊站範圍 | 新站去處 |
| --- | --- | --- | --- |
| 人才招募 | `content/migration/careers.json` | 舊站「人才招募」列表與各則公告頁（含歷次錄取名單頁） | 每則公告 → `job.{日期}-{slug}`（`/careers/{slug}/`）；列表頁 → `/careers/` |
| 採購公告 | `content/migration/procurement.json` | 舊站「採購公告」列表與各則公告頁（含決標公告） | 每則公告 → `tender.{日期}-{slug}`（`/procurement/{slug}/`）；列表頁 → `/procurement/` |

做法與疾病清單相同，但有幾點不同：

1. **一份清單 6–8 筆是示範規模；正式做法是「列表頁一筆＋歷年公告逐則」。** 歷年公告很多、流量集中在近一年，可依規劃 §7.4 四因子判斷：近兩年的逐則 `migrated`，更早的整批列為 `archived`（對到「歷史」頁籤）或 `dropped`（回 410）。**不要把全部舊公告轉到 `/careers/` 首頁**（soft 404）。
2. **舊的錄取名單頁要特別處理。** 舊站若公布了完整姓名，**不得原樣搬到新站**：新站只公布報名編號與遮罩姓名（[careers-privacy.md](careers-privacy.md)），建置閘門會擋未遮罩的結果。逐則判斷：已超過保存期限者 `dropped`；仍需保留者依遮罩規則重做 `result`。舊 PDF 附件的 `target` 不要指向含完整姓名的檔案。
3. **舊新聞稿式網址已有 301。** 第二輪時招募與採購公告是 `news`（`/news/{slug}/`）；第七輪搬到新路徑後，原 id 保留在 `legacyIds`，`redirects.json` 以 `kind: 'moved'` 把舊 `/news/{slug}/` 301 到新路徑，不需要人工再寫。
4. **`pending` 的處理與疾病清單一樣**：新頁還沒建的項目會產生 `migration-pending` 待辦（每份清單一則），權責單位分別是人事室與秘書室。
5. **採購公告的舊網址以採購網為準**：舊站的採購公告頁若本來就是採購網的轉述，`oldType` 填 `external`、`target` 指向對應的 `tender`，由秘書室確認 `pccUrl`。
6. 所有項目 `verified: false`，由人事室、秘書室的 Steward 在 `/admin/migration/` 逐筆確認（做法同 [guide-staff.md](guide-staff.md) 15.8），`{id}` 佔位者補成真實 ID 後才進伺服器轉址檔。

同樣適用於其他欄目：新聞稿、出版品、影音、宣導、法規等欄目型內容，都用 `scope.kind: 'category'` 人工清單；本節的 1–2 點（只做近期逐則、敏感頁面別原樣搬）是欄目型清單的共同做法。

---

## 11. 檔案與指令對照

| 項目 | 位置 |
| --- | --- |
| 移轉清單（人維護，只寫例外） | `content/migration/{slug}.json`（schema：`schemas/migration.json`） |
| 欄目型清單：人才招募、採購（人工） | `content/migration/careers.json`、`content/migration/procurement.json`（見 10.8） |
| 標準子頁模板（OASIS 維護） | `content/migration/_disease-template.json`（schema：`schemas/migration-template.json`） |
| 各疾病清單（推導＋人工，可下載當起點） | `dist/v1/migration/index.json`、`dist/v1/migration/{slug}.json` |
| 轉址對照（機器產生） | `dist/v1/redirects.json`、`dist/v1/legacy-map.json` |
| 伺服器格式 | `dist/redirects/nginx.map`、`dist/redirects/web.config.rewritemap.xml`、`dist/redirects/_redirects` |
| 後台進度 | `/admin/migration/`（儀表板「移轉進度」卡、待辦頁 `migration-pending` 頁籤） |
| 舊網址查詢 | `/legacy/`、404 頁（`notfound.mjs`） |
| 404 log 分析 | `scripts/analyze-404-log.mjs`（範例 log：`tests/fixtures/access-404.log`） |
| 全站連結檢查 | `BUILD_TODAY=<日期> LINK_CHECK=error npm run build` |
| 到期設定 | 清單內 `showLegacyUntil` |

相關文件：[guide-staff.md](guide-staff.md) 第 15 節（同事的操作 SOP）、[plan-supplement.md](plan-supplement.md)（這套做法對規劃文件的補充）、[deploy.md](deploy.md) 第 7 節（部署到正式環境與 301 設定）、[architecture-decisions.md](architecture-decisions.md) 第 7 項（為何不用 robots.txt）。
