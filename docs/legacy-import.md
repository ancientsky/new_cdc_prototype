# 舊站匯出批次轉換

> 給誰看：資訊室（做匯出）、OASIS（維護規則、彙整報告）、各組 Steward（逐頁確認草稿）、公關室（近年新聞的抽樣檢視）。
> 依據：[ARCHITECTURE.md](../ARCHITECTURE.md) §17.3；規劃文件〈盤點、規格與路線圖〉§5.2、§7.4、§8.2。接續 [migration-playbook.md](migration-playbook.md)（舊網址怎麼對、怎麼轉址），本文處理的是**舊頁的內容本身怎麼進新站**。
> 一句話：**資訊室把舊站內容匯出成約定格式，`import-legacy` 一次轉成內容草稿與一份誠實的報告；機器做體力活並標出信心，人只看有疑慮的。**

目錄：0 為什麼需要・1 流程總覽・2 匯出格式規格・3 規則檔怎麼寫・4 怎麼跑・5 轉換做了什麼・6 信心分級與人工檢視・7 三級處理・8 PDF 不整批轉・9 報告怎麼看・10 結核病首批結果・10.1 登革熱第二批結果・11 正式批次的排程建議・12 限制

---

## 0. 為什麼需要

[migration-playbook.md](migration-playbook.md) 解決「舊網址不 404」，但每個舊網址背後都有一頁**內容**要嘛搬進新站、要嘛封存。舊站頁面是 CMS 版型外殼加 Word 貼上的內容：樣式殘留、表格壞掉、圖沒有替代文字、附件連結是加密 ID。手工複製貼上，既慢又容易漏；全自動轉換又會把問題原封不動帶進新站。

做法是折衷：

1. **機器做 80% 的體力活**：抽內容區、清 Word 樣式、轉 Markdown、搬附件並宣告 `assets`、判斷型別與權責單位、產生草稿；
2. **機器誠實標出信心**：每一頁有 0–1 的信心分數與問題清單；
3. **人只看有疑慮的**：信心低的逐頁看，信心高的新聞抽樣看；
4. **草稿不直接進 `content/`**：草稿一律 `status: review`，放在輸出目錄；人工確認後才走一般上架流程。

---

## 1. 流程總覽

| 步驟 | 誰 | 做什麼 | 產出 |
| --- | --- | --- | --- |
| 1 選一個欄目樹 | OASIS | 每批只做一個欄目樹（例如結核病專區），對照移轉清單（`content/migration/{slug}.json`） | 批次範圍 |
| 2 匯出 | 資訊室 | 從舊 CMS 資料庫匯出成第 2 節的格式 | 匯出目錄 |
| 3 調規則 | OASIS | 檢查／補充規則檔（類別→單位、疾病別名、標題關鍵字） | `_import-rules.json` |
| 4 跑轉換 | OASIS | `node scripts/import-legacy.mjs …`（第 4 節） | 草稿、`assets`、報告、移轉清單更新建議 |
| 5 看報告 | OASIS＋Steward | 第 9 節：先看摘要，再看信心低與錯誤的頁 | 處理清單 |
| 6 人工確認 | Steward（現行一級內容）、公關室（新聞） | 第 7 節三級處理 | 確認過的草稿 |
| 7 進 repo | Steward | 草稿搬進 `content/`、把 `status` 改為 `published`，走上架 PR（[guide-staff.md](guide-staff.md) 第 2 節；車道由型別決定） | 新頁上線 |
| 8 更新清單 | OASIS | 套用 `migration-patch.json`（`--apply-migration`），Steward 在 `/admin/migration/` 確認 `verified` | 移轉進度 |

---

## 2. 匯出格式規格

這是**我們定義**的格式；正式站由資訊室從 CMS 資料庫匯出成這個樣子。開發環境連不到舊站，原型的第一批是依既有內容反推的**模擬匯出**（`data/legacy-export/tuberculosis/`），明確標示為模擬，正式匯出取代即可。

### 2.1 目錄結構（兩種擇一）

**A. 每頁一檔（建議）**

```
{export-dir}/
  _export.json          選填：批次資訊
  001.html              一頁一檔，舊站頁面的完整 HTML（含版型外殼；轉換時只取內容區）
  001.json              同名側檔（必要）
  002.html
  002.json
  …
  files/                附件與內文圖片
    TB-guideline-2025.pdf
    chart-1.png
```

**B. 單一 `index.json`**：一個陣列，每筆＝側檔欄位 ＋ `html`（內嵌字串）或 `htmlFile`（相對路徑）。小批次或從資料庫直接匯出時方便。

### 2.2 側檔欄位（`{name}.json`）

| 欄位 | 型別 | 必填 | 說明 |
| --- | --- | --- | --- |
| `url` | string | ✓ | 舊頁完整網址（含 query，例：`https://www.cdc.gov.tw/Bulletin/Detail/{ID}?typeid=9`）。URL 模式比對、`legacyUrls`、移轉清單對應都靠它 |
| `title` | string | ✓ | 頁面標題（舊站顯示的標題） |
| `category` | string |  | 舊站所屬欄目，用「／」分層，例：`結核病／防治政策`。**類別→權責單位**對照靠它 |
| `publishedAt` | `YYYY-MM-DD` |  | 發布日；缺則暫用匯出日並記一則警告 |
| `updatedAt` | `YYYY-MM-DD` |  | 最後更新日；用來判斷「久遠內容」（超過 `archiveAfterYears` 年） |
| `breadcrumbs` | string[] |  | 麵包屑文字，由上而下；用來判斷疾病與類別 |
| `attachments` | `[{ url, label, file }]` |  | 頁面上的附件：`url` 是舊站附件網址（`/File/Get/{ID}`）、`label` 是顯示文字、`file` 是 `files/` 底下的檔名。**內文有檔案連結卻不在這裡，會記警告並不轉成附件** |
| `typeid` | string |  | 新聞類型代碼（也可寫在 `url` 的 `?typeid=`）：9＝新聞稿、8772＝澄清稿、11＝其他訊息、158＝英文新聞稿 |
| `tab` | string |  | 疾病頁子頁籤名稱（疾病介紹、預防接種…） |

`_export.json`（選填）：`{ "exportedAt": "2026-10-04", "simulated": true, "source": "…", "site": "https://www.cdc.gov.tw" }`。`exportedAt` 用來補缺漏的發布日；`simulated: true` 會讓報告標明這是模擬匯出。

### 2.3 匯出時的要求（給資訊室）

- **HTML 要完整**：不要預先去除樣式或版型外殼，規則檔會指定從哪個選擇器取內容區；去掉了反而認不出。
- **編碼 UTF-8**；附件與圖片原檔放 `files/`，檔名保留（轉換時會正規化成合法檔名）。
- **一個舊網址一頁**。分頁的清單頁、查詢頁不用匯出（匯出了也只會被標為「清單頁，通常不轉」）。
- **PDF 要匯出，但不期待整批轉換**（第 8 節）。
- 匯出時順便記錄**每頁的過去 12 個月瀏覽量**（另放一個對照檔即可，不在本格式內）：第 7 節的處理分級用得到。
- 匯出內容**不得含個資**（內部備註、後台操作者姓名、留言）；若舊頁本身含個資，先在匯出階段排除並通報。

---

## 3. 規則檔怎麼寫

規則是**資料不是程式**：`content/migration/import/_import-rules.json`（底線開頭、放在 `import/` 子目錄，不會被當成移轉清單）。正式批次先改這個檔再跑。主要區塊：

| 區塊 | 用途 | 例子 |
| --- | --- | --- |
| `extraction` | 怎麼從舊站版型取內容區：`contentSelectors`（依序嘗試）、`bodySelectors`、`titleSelectors`、`removeSelectors`（導覽、側欄、頁尾、麵包屑、分享列…一律不轉）、`faq`（Q&A 的選擇器）、`attachmentLinkPattern`（哪些連結算附件） | `"contentSelectors": ["#CCMS_Content", "div.cp", "main", "body"]` |
| `urlPatterns` | **URL 模式 → 型別與目錄**。第一個命中者生效，路徑大小寫不分 | `/Disease/SubIndex/` → 疾病頁區塊；`/Category/QAPage/` → faq（每題一筆）；`/Bulletin/Detail/` → news；`/Category/MPage\|Page/` → page 或併入疾病頁區塊；`/File/Get/` → 附件（asset） |
| `bulletinTypes` | `typeid` → `newsType` | `9` 新聞稿（press）、`8772` 澄清稿（clarification）、`11` 其他訊息（other）、`158` 英文新聞稿 |
| `categoryOwners` | **類別 → 權責單位**，最長前綴優先。可寫完整前綴（`結核病／檢驗`），也可寫不綁疾病的子類別（`／檢驗`、`／統計`、`／通報`），任何欄目樹都適用 | `結核病／檢驗` → `unit.lab`；`／統計資料` → `unit.epidemic-intelligence` |
| `ownerFallbackToDisease` | 類別沒對到規則時，用頁面認出的疾病在主檔的 `owner`（記 `owner-from-disease` 提示，算對應） | `true` |
| `defaultOwner` | 類別沒對到、也認不出疾病時的暫填單位（並記 `unmapped-category` 警告） | `unit.oasis` |
| `diseases` | **疾病別名與短碼**。候選以 `content/master/diseases.json` 全部疾病為底，這裡只補主檔沒有的舊站寫法與草稿 id 用的 `short`（沒寫就用主檔 id 去掉 `disease.`） | `disease.tuberculosis`（`tb`）：潛伏結核感染、LTBI…；`disease.dengue`：登革、DENV |
| `blockKeywords`／`blockHeadings` | **標題關鍵字 → 疾病頁區塊 key**，以及區塊標題 | 「致病原」「傳染方式」→ `transmission`；「症狀」→ `symptoms`；「預防接種」→ `vaccine` |
| `docTypeKeywords` | 標題關鍵字 → 文件類型 | 「病例定義」→ `case-definition`；「手冊」→ `manual` |
| `docTypeStrongKeywords` | 標題**強**關鍵字 → 文件類型，**優先於網址模式**（第十二批，規則檔第 11 版）。只放不會誤中的長詞 | 「核心教材」→ `curriculum`（蓋過 `/Category/DiseaseTeach/` 預設的 `guideline`） |
| `curriculum` | curriculum 草稿的預設欄位：`series`、`defaultRoles`（舊頁看不出對象時暫填，記 `fields-pending`） | `傳染病核心教材`；`physician`、`nurse`、`local-health` |
| `audience` | 型別 → 對象，專業類別 → 專業人員 | 「指引及手冊」「通報」「檢驗」→ `professional` |
| `dropRules` | 建議不轉換的條件（回 410） | 標題含「活動報名」且發布日早於 2021-01-01 |
| `thresholds` | `minBodyChars`（內文過短）、`reviewConfidence`（0.6）、`autoConfidence`（0.8）、`archiveAfterYears`（3）、`summaryChars`（120） | |
| `confidence` | 信心權重 | 型別 0.4、owner 0.2、Markdown 0.2、附件 0.1、無重複 0.1 |

**改規則的原則**：

- 跑完第一輪，先看報告裡的「未對應類別」「型別不明」「小節未歸入」：這些幾乎都是規則缺口，補規則比逐頁修草稿划算；
- 單一頁的特殊情況不要放規則，直接在草稿修；
- 規則檔改動要經 OASIS 審（它影響整批）；
- 疾病別名請以 `content/master/diseases.json` 為準，規則只補主檔沒有的舊站寫法。

---

第四批（規則檔 version 3）新增：

- `serviceRules`：標題關鍵字 → `service.serviceType`（`合約院所`／`院所查詢`／`責任醫院`／`醫院名單` → `clinic`，`群聚通報` → `notification`，`送驗申請` → `lab-request`…）。清單頁或欄目內頁命中就直接建 service。
- `bulletinTypes.8772.type: "clarification"`：澄清稿直接建成 clarification 型別。
- `audience.byType` 補六種結構化型別的預設讀者（labtest 專業、dataset 兩者、其餘民眾）。

第六批（規則檔 version 5）新增：

- `bulletinTypes.48`：致醫界通函（`newsType: letter`、`type: letter`）；`letterTitle`：標題「致醫界通函第 N 號」的正規式，typeid 不對時也能認出通函並抽 `letterNo`。
- `categoryOwners` 加「新聞與公告」「News」→ 公關室；「新聞與公告」帶 `preferDiseaseFor: ["letter"]`：通函的權責改取疾病主檔的業務組。
- `thresholds.sampleRate: 0.1`：二級（近年新聞 auto-ok）抽樣比例，報告附名單。
- `audience.byType.letter: ["professional"]`。

第七批（規則檔 version 6）新增：

- `historicalKeywords` 加「歷版」：舊站指引頁常把歷版放在「…／指引及手冊／歷版」子類別，麵包屑命中就建議封存。
- `categoryOwners` 加「感染管制」→ 感管組、「首頁／指引及手冊」→ OASIS（只對欄目總覽列表頁；各文件頁的麵包屑是「傳染病介紹／某疾病／指引及手冊」，權責仍依疾病主檔）。
- 沒有新的關鍵字規則——版次鏈、一頁多版、純 PDF 的判斷寫在轉換器（見 10.7），靠標題去版次比對與附件標籤，不靠規則檔。

第八批（規則檔 version 7）新增：

- `urlPatterns` 加 `qa-en`（`^/En/Category/QAPage/`，`lang: en`）：英文問答頁建成 `sourceLang: en` 的草稿並記 `needs-source-zh`（與第六批英文新聞稿同一套治理規則）。
- `faqTasks`：每題 `tasks` 的關鍵字表（`vaccines`／`travel`／`rumor`／`data`／`situation`／`symptoms` 各一組 keys，對應 `schemas/_common.json` 的枚舉）。先看題目，題目命中的都給（最多兩個）；題目沒命中才看答案，取命中次數最多的一個。改關鍵字不用改程式。
- `categoryOwners` 加「預防接種／常見問答」→ 急性組、「國際旅遊與健康」→ 檢疫組、「首頁／常見問答」→ OASIS（只對欄目總覽列表頁）。
- 期限已過、數字＋單位抽結構化候選、鬆散結構拆題的判斷寫在轉換器 `scripts/lib/legacy-import/qa.mjs`（見 10.8），不靠規則檔。

第十一批（規則檔 version 10）新增：

- `statScopes`（`["統計專區", "統計資料", "Data & Statistics"]`）：統計樹下、清單沒給型別的頁，由**內容形狀**決定 dataset 的種類——附件是一期一期的週報／速訊 ⇒ `document-library`（逐期列 `resources`）；內文是年×數值的表 ⇒ `structured-table`（抽成 `series`）；只是連到 nidss／開放平臺的入口 ⇒ 依站外網址對到既有 dataset。判斷寫在 `scripts/lib/legacy-import/statistics.mjs`（見 10.11）。
- `urlPatterns` 加 `category-list-en`（`^/En/Category/(List|Fpage|NewsPage)`，`kind: list`，`lang: en`）：英文站列表頁與中文列表一樣不轉（`skip-list`），清單以 `newPath` 指到 `/en/…`。
- `categoryOwners` 加「統計專區」「Data & Statistics」→ 疫情中心（`unit.epidemic-intelligence`）。

第十批（規則檔 version 9）新增：

- `materialScopes`（`["宣導素材", "多媒體"]`）與 `materialRules`：麵包屑在宣導素材／多媒體樹下、而清單或模板沒有給型別的頁，**由欄目位置與標題字樣決定型別**——海報／單張／摺頁／貼紙／懶人包／圖卡 → `publication`（pubType `poster`）、手冊 → `publication`（`manual`）、動畫 → `media`（`animation`）、廣播／Podcast → `media`（`podcast`）、短片 → `media`（`short`）、影片／多媒體／影音 → `media`（`video`）。先比標題，再由麵包屑最後一層往前比；命中記 `type-from-category`（見 10.10）。清單 `target`／模板 `mapTo` 給的型別永遠優先。
- `categoryOwners` 加「宣導素材」「多媒體」→ 公關室（`unit.pr`）；有疾病的素材頁仍以疾病主檔的權責單位為準（`ownerFallbackToDisease`）。
- `categoryOwners` 的「最長命中優先」修正（原本實際是「後面命中覆蓋前面」，見 10.10 第 7 點），規則可放任何位置；`preferDiseaseFor` 多認 `"material"`。
- 圖片承載內容、多語附件、素材依據已修訂、外部系統入口的判斷寫在轉換器 `scripts/lib/legacy-import/materials.mjs`，不靠規則檔。

第九批（規則檔 version 8）新增：

- `urlPatterns` 加 `travel-prescription`（`^/TravelEpidemic/Prescription/`，`kind: generated`，`newPath: /travel/{ISO2}/`）：**資料產生頁**——新站的目的地頁由每日快照自動產生，舊的國家頁不轉內文，只記對應路徑（見 10.9）。`kind: generated` 的模式都要帶 `newPath`，`{ISO2}` 由國家主檔填入。
- `mergeScopes` 加「旅遊醫學」：旅遊醫學樹底下以疾病為題的頁（瘧疾預防用藥）併入該疾病頁的區塊，與疾病介紹、預防接種樹同一套規則。
- `serviceRules`：clinic 加「旅遊醫學門診」、certificate 加「國際預防接種證明書」。
- `homeBatches`（`{ faq: "qa", news: "news", document: "guidelines" }`）：不綁疾病的主題頁在別的欄目匯出裡再出現時，依頁型決定它的「家」批次；家批已轉過同網址就 `skip-duplicate`（第八批只認疾病批為家）。目前只對 Q&A 頁啟用。
- 查詢表單、國家判斷、主檔沒有的疫苗的判斷寫在轉換器 `scripts/lib/legacy-import/travel.mjs`，不靠規則檔。

第五批（規則檔 version 4）新增：

- `audience.byType` 補 `topic`（民眾）與 `vaccine`（兩者）：相關連結頁直接建成 topic、清單標「已移轉」到疫苗頁的疫苗專區頁直接建成 vaccine（見 10.4）。沒有新的關鍵字規則——這兩種型別由模板 `mapTo` 與清單 `target` 決定，不靠標題猜。

## 4. 怎麼跑

```bash
node scripts/import-legacy.mjs <export-dir> --out <out-dir> [--apply-migration] [--rules <file>] [--manifest <file>] [--slug <name>] [--now <ISO>]
```

| 參數 | 說明 |
| --- | --- |
| `<export-dir>` | 匯出目錄（第 2 節） |
| `--out <out-dir>` | 輸出目錄。**不要指到 `content/`**：草稿會與既有內容重複 |
| `--apply-migration` | 把 `migration-patch.json` 實際寫回 `content/migration/{slug}.json`（**只改 `status`／`target`／`note`，不動 `verified`**）。不加＝只產生建議，不改清單 |
| `--rules <file>` | 指定規則檔；預設 `content/migration/import/_import-rules.json` |
| `--manifest <file>` | 對照的移轉清單；預設 `content/migration/{slug}.json`。**檔案不存在但主檔有這個疾病時，工具自動用「合成清單」**（`extends: migration-template.disease`、沒有人工例外）展開模板推導項來比對，報告的 `manifest.synthetic: true`、`file: null`；此時 `--apply-migration` 會拒絕（沒有檔可寫），要寫回請先把 `v1/migration/{slug}.json` 存成人工清單 |
| `--slug <name>` | 批次名稱（決定預設清單檔名）；預設為匯出目錄名，例：匯出目錄 `data/legacy-export/tuberculosis` ⇒ `tuberculosis` |
| `--now <ISO>` | 轉換時間（`convertedAt`）；預設現在。要產生可重現的輸出（測試、比對）時固定它 |
| `--content <dir>` | 以另一個 `content/` 目錄當既有內容與主檔（預設 repo 的 `content/`；測試用） |

輸出：

```
{out-dir}/
  content/{目錄}/{id}.json      內容草稿（status: review、帶 conversion）
  content/assets/{id}/…         附件與內文圖片（已複製、算 sha256、讀圖片尺寸，宣告在草稿的 assets）
  report.json                   機器可讀報告（後台 /admin/import/ 讀它）
  report.md                     給人看的報告（逐頁來源、型別、目標 id、信心、問題、建議動作）
  migration-patch.json          對應移轉清單 key 的 status／target 更新建議
```

可重複執行：規則改了就重跑，不必手動清理。有草稿未通過 schema 驗證時，指令以非零狀態結束，並在摘要印出數量。

---

## 5. 轉換做了什麼

1. **取內容區**：依 `extraction` 取內容區，丟掉導覽、側欄、頁尾、麵包屑、分享列。
2. **清 Word 樣式**：移除 `mso-*` 樣式、`Mso*` class、`o:p` 等命名空間標籤、空 `span`；統計清除量（報告記為 info）。
3. **HTML → Markdown**：用 `src/client/admin/md-convert.js`（與後台上架編輯器同一份轉換器，純函式、零依賴），所以「匯入的草稿」與「同事貼 Word 進編輯器」得到一樣的 Markdown。表格保留；複雜表格（合併儲存格、巢狀）無法轉成 Markdown 表格時記 `table-complex` 警告。
4. **型別與目標**：URL 模式決定型別；疾病頁子頁依標題關鍵字**併入**疾病頁對應區塊（八個固定區塊）；Q&A 頁依 `.panel` 結構**每題一筆**；Bulletin 依 `typeid` 決定 `newsType`；檔案說明頁建文件草稿。對得到既有新站內容者（移轉清單的 `target`，或 Q&A／新聞依標題對到既有 id），草稿標「既有內容已存在，供比對」（`conversion.existing`、`compareWith`）。
5. **權責單位與疾病**：標題與麵包屑→疾病 id（主檔全部疾病的名稱與別名，最長命中優先；一頁可有多個疾病，第一個是主要疾病；都認不出時依移轉清單的 `scope.disease`）；類別→單位，沒規則就用疾病主檔的 `owner`。
5a. **移轉清單對應**：清單網址多半是 `{id}` 佔位，會命中同一模式下的**所有**舊頁，所以只有 fragment（＝側檔 `tab`）或標題也對得上才算對應；寫死 ID 的網址只剩一個候選時才直接採用。對不上的記 `manifest-ambiguous`（提示）與 `not-in-manifest`（警告）。清單只寫例外（`extends: migration-template.disease`）時，標準子頁由模板依該疾病展開成**推導項**一起比對（記 `manifest-derived`）；推導項只進報告與 `migration-patch.json` 的 `derivedItems`，不會寫回清單。模板的**文件項**（工作手冊、病例定義、治療指引）標題是通稱，對不上正式名稱時改以**文件種類**對（舊頁是文件型、標題看得出種類、與推導項 `mapTo.docType` 相同；記 `manifest-derived`）。清單目標是文件而舊頁是欄目內頁時，草稿直接建成 document（記 `type-from-manifest`）。第四批起模板項改以**舊站選單位置**對：模板的 oldTitle（「治療指引」「工作手冊」）就是舊站選單的名稱，舊頁最後一層麵包屑相同即對應，文件正式名稱長怎樣都無妨；人工例外已指向同一份新站內容的模板位置**不再推導**（第五批起：仍列在展開結果但標 `coveredBy: <例外 key>`，匯入、模擬匯出與治理引擎 R15 三處都看同一個標記，報告 `manifest.derivedCovered` 列出被涵蓋的位置），同型別多筆時推導目標取**現行且最新**的一筆。
6. **圖片與附件**：內文圖片改成 `/files/{id}/…` 並宣告為 `kind: image`；alt 先用圖片的 `alt`／`title`／檔名，並標 **`needsAlt`**（圖片 alt 與授權是建置閘門，必須人工補，見 [assets-policy.md](assets-policy.md)）；側檔 `attachments` 宣告為 `kind: attachment`，PDF 以文字層偵測決定 `machineReadable`。
7. **治理欄位**：`status: 'review'`、`reviewedAt` ＝ 匯出日、`reviewPeriodMonths` 依型別預設、`legacyUrls`、`owner`、`audience`、`summary`（取前 120 字內的完整句）、`conversion`（`mode: 'auto'`、`confidence`、`issues[]`、`sourceUrl`、`convertedAt`）。
8. **驗證**：每份草稿跑一次 schema 驗證，未通過者在報告標 `schema-invalid`（error）。
9. **報告與移轉清單建議**：見第 9 節。

---

## 6. 信心分級與人工檢視原則

信心分數（0–1）由五項加總，權重在規則檔：

| 項目 | 權重 | 得分條件 |
| --- | --- | --- |
| 型別對應明確 | +0.4 | URL 模式命中、Bulletin typeid 已知、疾病頁子頁找得到疾病 |
| owner 對應 | +0.2 | 類別對得到單位（沒對到就用 `defaultOwner`，不得分） |
| Markdown 無轉換警告 | +0.2 | 沒有 Word 殘留未清、複雜表格、內嵌影音、被丟棄的內容、內文過短、圖片缺 alt／找不到檔、小節未歸入 |
| 附件全部找到 | +0.1 | 側檔列的附件都在 `files/`，且內文的檔案連結都在側檔裡 |
| 無重複 | +0.1 | 沒有重複標題或重複的目標 id |

| 分數 | 處理 |
| --- | --- |
| **< 0.6** | **一定人工逐頁檢視**，不可批次通過（`manual-review`） |
| 0.6–0.8 | 上架前人工確認（`review-before-publish`） |
| **≥ 0.8** 且無警告以上的問題、是新聞 | 可抽樣檢視後自動上線（`auto-ok`） |

信心是**機器對自己轉換品質的自評，不是內容正確性的保證**。即使 1.0，內容是否仍適用、數字是否仍正確，仍是權責單位的責任（上架後走一般的審閱週期與反向稽核）。

**人工檢視看什麼**（逐頁，約 3–5 分鐘）：

1. 標題與型別對不對（Q&A 有沒有被拆錯、疾病子頁有沒有併進正確區塊）；
2. 內文是否有遺漏（尤其表格、清單）、Word 殘留；
3. **圖片 alt**（`needsAlt` 的一定要補）、授權與來源；
4. 數字與規定是否仍是現行版（舊頁常有過時資訊，這是審閱而不是轉換）；
5. `owner`、`audience`、`basedOn`（新聞稿與衍生內容要補依據正本）；
6. `issues` 清單逐項處理或註明可忽略；
7. 確認後把 `status` 改為 `published`（若要上線），移除或保留 `conversion` 供稽核（治理規則 27）。

---

## 7. 三級處理

不是所有舊頁都值得同樣的力氣。依「現行有用程度」分三級（用過去 12 個月瀏覽量、最後更新日與內容性質判斷，由 OASIS 與 Steward 在第 5 步後決定）：

| 級別 | 內容 | 怎麼處理 | 報告中的對應動作 |
| --- | --- | --- | --- |
| **一級：現行一級內容** | 疾病介紹、疫苗與預防接種、現行指引與手冊、病例定義、Q&A、申請服務 | **人工逐頁確認**：不論信心分數，Steward 看過才能上線；走一般車道（需 1 位核准，疾病與疫苗為公關室＋OASIS）。內容要重新審閱、更新 `reviewedAt` | `manual-review`、`merge-into-disease`、`compare-existing`、`review-before-publish` |
| **二級：近年新聞與公告** | 近三年內的新聞稿、公告 | 信心 ≥ 0.8 的由公關室**抽樣檢視（建議 10%）**後，批次改為 `published` 開 PR，走快車道（CI 全過自動合併，上線後公關室複核）；信心較低的回到一級流程 | `auto-ok` |
| **三級：久遠封存** | 超過 `archiveAfterYears`（預設 3 年）的新聞、已結束的活動、歷史版本 | **不轉換上線**：以 `status: archived` 保留供查閱，或依移轉清單設 `archived`／`dropped`（410）；舊網址仍要有明確去處（[migration-playbook.md](migration-playbook.md) 2.1） | `archive`、`drop` |

另有三類不需轉換：**清單頁**（`skip-list`，新站的列表由系統依內容自動產生）、**別的批次已轉過的同一頁**（`skip-duplicate`：欄目匯出會把疾病專題的子頁再匯一次，草稿以疾病批為準；同批裡每一題都已由別頁轉出的 Q&A 頁也算，第八批）、**新站由資料自動產生的頁**（`skip-generated`：國際旅遊處方箋的國家頁對應 `/travel/{ISO2}/`，不轉內文、舊內文存 `reference/` 供比對、舊網址 301 到產生頁，第九批）與**檔案本身**（第 8 節）。

---

## 8. PDF 不整批轉

PDF 是**附件**，不是頁面。工具對 PDF 只做三件事：複製檔案、算 sha256／bytes／mime 並宣告 `assets`、偵測文字層決定 `machineReadable`。原因：

1. 把 PDF 轉成 Markdown 的品質不穩（版面、表格、掃描檔），整批轉等於大量低品質內容；
2. 舊站有大量歷史 PDF，大多不再被查詢；整批搬會把過時資訊一起帶進新站；
3. 現行有效、仍被引用的文件，應走文件型別的版本鏈（`machineReadableMarkdown` 才是機讀正本），由 Steward 挑選後逐份處理（[assets-policy.md](assets-policy.md) 第 4 節）。

沒有文字層的 PDF 在報告中計入 `noTextLayer`，上線後會開 `attachment-no-accessible-version` 待辦，請找回原始檔或另附文字版。舊附件網址 `/File/Get/{ID}` 在轉址上一律指向**新的文件頁**，不是直接指向 PDF（[migration-playbook.md](migration-playbook.md) 2.8）。

---

## 9. 報告怎麼看

打開 `report.md`（或後台 `/admin/import/`，它讀 `data/legacy-import/*/report.json`）。

**批次摘要**：頁數、產出的草稿數、型別分布、**平均信心**、**需人工檢視數**（信心 < 0.6）、附件數（附件／圖片／資料檔、缺 alt、無文字層）、問題統計（error／warn／info）、已有對應既有內容的頁數、移轉清單比對結果。

**逐頁表**：

| 欄位 | 說明 |
| --- | --- |
| 來源 | 舊頁網址與標題 |
| 型別／目標 | 轉成什麼型別、目標 id（既有內容已存在者標「既有內容已存在，供比對」） |
| 信心 | 0–1，< 0.6 標紅 |
| 問題 | 問題清單（code、嚴重度、說明） |
| 建議動作 | `manual-review` 人工檢視、`review-before-publish` 上架前確認、`compare-existing` 與既有內容比對、`merge-into-disease` 併入疾病頁區塊、`auto-ok` 抽樣後自動上線、`archive` 封存、`drop` 不轉換、`skip-list` 清單頁不轉、`skip-duplicate` 別批已轉過的同一頁不重複出草稿、`skip-generated` 新站由資料產生的頁不轉內文（301 到產生頁） |

**常見問題代碼**：

| code | 嚴重度 | 意思 | 怎麼辦 |
| --- | --- | --- | --- |
| `unmapped-category` | warn | 類別沒對到權責單位，暫填預設單位 | 補規則檔 `categoryOwners` 後重跑 |
| `type-unclear` | warn | URL 模式或疾病找不到，暫以 `page` 處理 | 補規則，或人工指定型別 |
| `table-complex` | warn | 表格太複雜（合併儲存格），Markdown 表格會失真 | 人工重做表格 |
| `word-residue` | warn | Word 殘留樣式沒清乾淨 | 人工檢視 |
| `image-no-alt`／`needsAlt` | warn | 圖片缺替代文字 | **人工補 alt**（建置閘門） |
| `image-missing` | error | 圖片檔在匯出裡找不到 | 請資訊室補匯出 |
| `unlisted-file-link` | warn | 內文有檔案連結但不在側檔 `attachments` | 補匯出或人工宣告附件 |
| `body-short` | warn | 內文過短（`minBodyChars`） | 多半是目錄頁或空頁，評估是否轉 |
| `duplicate-title` | warn | 標題或目標與其他頁重複 | 合併或擇一 |
| `section-unassigned` | warn | 疾病子頁的小節標題對不到區塊 | 補 `blockKeywords` 或人工歸類（內容保留在草稿 `conversion.unassigned`） |
| `faq-structure-missing` | warn | Q&A 頁找不到 `.panel` 結構 | 補選擇器或人工拆題 |
| `schema-invalid` | error | 草稿未通過 schema | 看訊息修欄位 |
| `not-in-manifest` | warn | 移轉清單（含模板推導項）裡找不到這個舊頁 | 在清單新增一筆 pending 項目（`migration-patch.json` 的 `unmatchedPages` 有建議稿） |
| `manifest-ambiguous` | info | 網址符合清單某些 `{id}` 佔位項目的模式，但標題與分頁都對不上，不視為對應 | 多半是清單沒有的頁（例如新新聞）；若其實是同一頁，把清單 `oldTitle` 改成舊頁真正的標題 |
| `manifest-derived` | info | 對到的是模板推導的標準子頁，不是人工清單項 | 不用處理；結果見 `migration-patch.json` 的 `derivedItems` |
| `owner-from-disease` | info | 類別沒有規則，權責單位依疾病主檔 | 確認即可；想固定就補 `categoryOwners` |
| `disease-from-manifest` | info | 麵包屑與標題看不出疾病，依清單 `scope.disease` | 確認疾病對不對 |
| `type-from-manifest` | info | 清單目標或模板推導項說新站是 document／publication／media／dataset／labtest／service／clarification／topic／vaccine，草稿直接建成該型別（有 target 就用 target id；topic 例外，固定 `topic.{slug}-links`，推導到的既有專區只列 `compareWith`） | 確認結構化欄位；不用再手動改型別 |
| `type-from-bulletin` | info | 公告類別（typeid 8772）是澄清稿，草稿建成 clarification | 確認 claim 與 verdict |
| `type-from-keywords` | info | 標題像查詢／申辦服務（合約院所、責任醫院名單…），草稿建成 service | 補申辦步驟；名單類資料改掛 dataset |
| `type-upgrade` | info | 既有內容以 news 存放同一則澄清，新草稿是 clarification 型別 | 比對後擇一保留 |
| `fields-pending` | warn | 結構化型別的必填欄位從舊頁看不出來，以「（待補：…）」佔位（檢體容器、送驗時限、申辦步驟、文字稿…） | 權責單位補欄位後才可上架 |
| `field-guessed` | info | 欄位是推斷的（出版品種類、服務種類、更新頻率、verdict、labs） | 看一眼對不對 |
| `merge-into-target` | info | 清單判定這頁「併入」某份文件或疫苗頁，草稿以 page 暫存、不搶目標 id | 人工把內容併進目標後刪草稿 |
| `old-content`／`historical-version` | info | 久遠內容／歷史版本 | 依第 7 節三級封存 |
| `needs-source-zh` | warn | Bulletin typeid 是英文稿（`lang: en`），新站以中文為正本 | 補中文版後再上線；不列入 auto-ok（第六批） |
| `version-family` | info | 去掉版次後與其他頁同名，視為同一文件家族（family 依標題，不依網址） | 確認是同一份文件的不同版次；不是就改標題或清單 target（第七批） |
| `version-chain` | info | 同家族多個版次已依生效日串成鏈，本版為現行版（草稿 `supersedes` 指向前一版） | 看一眼順序；生效日錯的補 `version-date-unknown` 的日期 |
| `version-from-attachment` | info | 附件列表裡標了別的版次的 PDF，另建同家族的純 PDF 舊版草稿（不轉內文） | 舊版只搬檔；新站已有同版次就沿用其 id 供比對 |
| `version-date-unknown` | warn | 附件標籤看得出版次、看不出日期，生效日暫用頁面日期 | 人工補日期，版次鏈才排得對 |
| `pdf-only` | warn | 舊頁只有下載連結，正本是 PDF；`machineReadableMarkdown` 以（待補）佔位 | 權責單位提供文字版（assets-policy 第 4 節）或確認僅以附件提供；PDF 不整批轉（第 8 節） |
| `effective-from-text` | info | 生效日取自標題（「2025 年 9 月版」「114.04.16」）或內文「…年…月…日修訂／生效」，不是舊頁發布日 | 確認日期；民國年已換算 |
| `converted-elsewhere` | info | 同網址的頁已在它所屬疾病的批次轉過（欄目匯出再匯一次），本批不重複出草稿、不參與清單比對 | 內容若有更新，到疾病批重跑（第八批） |
| `faq-structure-loose` | info | Q&A 頁沒有 `.panel`，依「Q 開頭的標題／粗體段落」拆題 | 核對題目與答案切分（第八批） |
| `one-to-many` | info | 一頁多題、清單沒有單一目標：status 維持 pending | 決定併入疾病頁（merged）或各題獨立（第八批） |
| `tasks-from-keywords`／`tasks-unknown` | info | 每題 `tasks` 依題目關鍵字給（`faqTasks`）／沒命中留空 | 確認或補 tasks；常錯就補關鍵字（第八批） |
| `answer-dated` | warn | 答案裡寫的期限（「至 114 年 3 月 31 日止」「113 年度」）都已過 | 確認是否已有新年度版本或應封存（第八批） |
| `structured-from-text` | info | 題目在問「多久／幾劑／幾歲」，答案的數字＋單位抽成 `structured` 候選 | 確認後保留或刪除欄位（第八批） |
| `generated-page` | info | 這頁對應新站由資料產生的頁（`/travel/{ISO2}/`），不出草稿；舊內文存 `reference/{key}.md` | 清單填 `newPath`、舊網址 301；比對舊衛教文字是否有新站快照沒有的資訊（第九批） |
| `country-unknown` | warn | 資料產生頁但從網址、標題、麵包屑判不出國家 | 人工指定國家或補主檔名稱（第九批） |
| `dynamic-form` | warn | 舊頁是查詢表單（下拉 N 個選項、說明文字很短），新站以功能取代；表單控制項不轉入內文 | 清單以 `newPath` 填新站功能頁（第九批） |
| `vaccine-not-in-master` | info | 小節標題提到疫苗主檔沒有的疫苗（黃熱病、流腦、傷寒） | 新增 vaccine 主檔與疫苗頁後，把小節改建成 vaccine（第九批） |
| `type-from-category` | info | 宣導素材／多媒體樹下的頁，型別由欄目位置與標題字樣決定（海報→publication poster、影片→media video…），不是清單給的 | 確認型別對；清單補 `target` 後下次重跑會改走 `type-from-manifest`（第十批） |
| `image-only` | warn | 圖片承載唯一資訊：內文幾乎只有圖（海報、單張），文字不足 80 字 | 補純文字版（`abstractMarkdown` 的（待補）佔位）與每張圖的 alt；這是可及性要求，不是選項（第十批） |
| `image-gallery` | info | 同頁 ≥ 4 張圖，建成一筆內容、多個 image 資產，不拆成多筆 | 確認每張圖的 alt；系列海報就是一筆出版品（第十批） |
| `lang-variants` | info | 附件含多語版本（英、日、越、印、泰、菲），一筆內容、多語檔案；`languages[lang]` 標 `pending` | 補 i18n 標題與摘要後把 `pending` 改成 `reviewed`／`machine`；簡體中文不在站上七語，只記在 note（第十批） |
| `material-outdated` | warn | 素材發布時依據的文件版本之後被新版取代（同家族：舊版生效 ≤ 素材日 < 新版生效） | 上線前確認內容仍正確；治理 R9「影音依據已修訂」的事前版，上線後由治理引擎接手（第十批） |
| `external-system` | info | 舊頁主要是連到外部系統（數位學習平台、社群）的入口，內文很短 | 新站以入口連結呈現（`/services/`）或清單決定 `dropped`；不需要一頁內容（第十批） |
| `periodical-issues` | info | 附件是一期一期的週報／月報／年報（≥ 3 期）；期別不是版次，建成一筆 dataset（`document-library`）逐期列 `resources`，`lastUpdated` 取最新一期 | 確認期別日期；不要走文件版次鏈（第十一批） |
| `series-extracted` | info | 內文的年×數值表抽成 dataset `series`（統計問答用）：點數、年份範圍、單位；民國年已轉西元 | 核對數字與單位；多個數值欄只取第一個，其餘在 note（第十一批） |
| `series-gaps` | warn | 抽出的時序缺期或同期重複 | 補缺期或在 note 說明（例如該年無資料）（第十一批） |
| `stats-stale` | warn | 時序最新一點比現在舊兩期以上（年：少於去年） | 確認是否停更；開放平臺若有新版，canonicalUrl 改指過去（第十一批） |
| `dataset-by-url` | info | 入口頁的站外連結 host 對到既有 dataset 的 canonicalUrl／portalUrl，草稿直接用該 dataset id（既有 ⇒ 比對） | 確認對的是同一個系統；host 多筆命中取 canonicalUrl 完全相等者（第十一批） |

**`migration-patch.json`**：把移轉清單對應項目的 `status`（`pending` → `migrated`／`merged`／`archived`／`dropped`）與 `target` 的更新建議列出來（對到的文件若同 family 已有較新版次，建議 `archived`）。加 `--apply-migration` 才寫回，**只改 `status`／`target`／`note`，不動 `verified`**：逐筆確認仍由權責單位在 `/admin/migration/` 完成，轉換成功不等於確認過。另有三個只供參考的區塊：`derivedItems`（模板推導項的對應結果）、`unmatchedPages`（匯出有、清單沒有的頁，附建議的 pending 項目）、`conflicts`（工具判定與人工清單不同，人工優先）。

---

## 10. 結核病首批結果

> 開發環境連不到舊站，首批依 `content/migration/tuberculosis.json` 的 40 筆人工項目，**合成一份模擬匯出**（`data/legacy-export/tuberculosis/`）：HTML 做成舊站樣子（Bootstrap 版型、Word 貼上的 span／mso 樣式、表格、附件連結、麵包屑），內容由既有結核病內容反推，`_export.json` 標 `simulated: true`。正式匯出取代即可。模擬匯出的版型比真實舊站乾淨可預期，**因此首批的信心分數會比真實批次樂觀**。

輸出在 `data/legacy-import/tuberculosis/`（**不放進 `content/`**，會與既有結核病內容重複）；報告把同目標的草稿標「既有內容已存在，供比對」。

> 以下是撰稿當下（2026-10-04）的一次執行結果；**最終數字以 `data/legacy-import/tuberculosis/report.md` 為準，整合者定稿時回頭校對**。

| 項目 | 數字 |
| --- | --- |
| 匯出頁數 | 40（對應移轉清單 40 筆，全部對上） |
| 產出草稿數 | 40：Q&A 8、頁面 20、文件 10、新聞 1、疾病頁 1（疾病子頁 6 頁併成 1 份疾病頁草稿） |
| 舊頁型別 | 併入疾病頁 6、Q&A 3（拆成 8 題）、清單頁 5、頁面 15、文件 10、新聞 1 |
| 平均信心 | 0.91 |
| 需人工檢視（信心 < 0.6） | 3（多國語言海報頁、教育訓練教材投影片、相關連結清單頁） |
| 既有內容已存在（供比對） | 36（結核病專區第五輪已建好，所以多數草稿用於**比對**，不建議覆蓋） |
| 附件與圖片 | 19：附件 16、內文圖片 2、資料檔 1；圖片待補 alt 1；PDF 無文字層 5 |
| 草稿 schema 驗證 | 40 / 40 通過 |
| 問題 | 錯誤 1（附件找不到檔）、警告 14、提示 79 |
| 常見問題（前三名） | Word 殘留已清除（38 頁，提示）、新站內容型別與草稿暫存型別不同（17，提示）、PDF 無文字層（5，警告） |
| 建議動作分布 | 併入疾病頁 6、與既有內容比對 24、人工檢視 2、封存 3、上架前確認 2、清單頁不轉 2、不轉換（410）1 |
| `--apply-migration` | 對上 40/40、判定與清單一致 40、`pending` → 已移轉 **0 筆**（第五輪清單已把可對應的項目標為已移轉／已併入；仍待移轉 3 筆）；實際只在 `note` 補上「【匯入 日期】草稿 id（信心…）」註記，`status`／`target`／`verified` 都沒動 |

**怎麼解讀**：

- 平均信心 0.91 偏高，一部分是因為**模擬匯出的版型乾淨、可預期**；真實舊站的 Word 殘留、表格與圖片通常更糟，預期信心會明顯低於此數。
- 36 份草稿「既有內容已存在」：這批的價值不在「生出新頁」，而是**驗證流程**——規則能否把 40 個舊頁各自對到正確的型別與目標、報告能否把需要人看的頁挑出來。
- `pending` → 已移轉為 0 不是工具失效：結核病清單在第五輪就是人工逐筆對好的，工具的判定與清單一致（40/40）。對**還沒有人工清單**的欄目，這個數字才會大幅變動。
- 規則缺口：「未對應類別」3 頁（`結核病／教育訓練`、`結核病／相關連結`、`結核病／活動訊息`，規則檔 `categoryOwners` 沒有這些子類別，暫填預設單位），補規則重跑即可；`target-type-differs`（17）表示草稿暫存為 `page`，而新站對應的是影音、出版品、服務等其他型別，人工比對後應建正確型別而不是用草稿。

---

### 10.1 登革熱第二批結果

> 以下數字是第二批當時的結果。第四批把五批全部用新轉換器重跑（模板位置被例外涵蓋的不再另產頁、結構化型別直接產），**現在的** `data/legacy-import/dengue/report.md` 是 31 頁、海報／影音／統計／檢驗已是 publication／media／dataset／labtest 草稿。

> 第二批的目的：把工具從「結核病專用」變成「任何疾病都能跑」。模擬匯出改為**模板驅動**（`node scripts/lib/legacy-import/sim-export-disease.mjs disease.dengue`），依標準疾病頁模板 20 項＋登革熱人工例外清單 8 項＋近三年新聞 5 篇合成 33 頁，內容反推自既有登革熱內容（疾病頁、Q&A、文件、新聞、影音、檢驗、資料集）。輸出在 `data/legacy-import/dengue/`，草稿同樣不進 `content/`。**最終數字以 `data/legacy-import/dengue/report.md` 為準。**

| 項目 | 數字 |
| --- | --- |
| 匯出頁數 | 33（模板 20、人工例外 8、近年新聞 5） |
| 產出草稿數 | 31：Q&A 7、頁面 13、文件 4、新聞 6、疾病頁 1（疾病介紹八頁＋預防接種併成 1 份） |
| 平均信心 | 0.88 |
| 需人工檢視（信心 < 0.6） | 3（海報清單頁、影片清單頁、外籍勞工多語宣導頁：都是清單型頁面帶嵌入媒體或掃描 PDF） |
| 既有內容已存在（供比對） | 27 |
| 附件與圖片 | 10：附件 7、內文圖片 2、資料檔 1；圖片待補 alt 2、PDF 無文字層 2 |
| 草稿 schema 驗證 | 31 / 31 通過 |
| 未對應類別 | **0**（結核病首批 3）：登革熱一條類別規則都沒寫，owner 全靠疾病主檔與「／檢驗」「／統計」通用規則 |
| 人工例外清單 | 對上 8 / 8；與清單判定不同 0（第 16 版指引因同 family 已有第 17 版，工具也建議封存） |
| 模板推導項 | 20 項對上 19（「治療指引」模板項與舊頁標題「登革熱／屈公病防治工作指引」對不上，列為清單沒有的頁） |
| 清單沒有的舊頁 | 6（5 篇近年新聞與 1 份指引）：`unmatchedPages` 有建議的 pending 項目；新聞依標題對到既有新聞 id，標 existing |
| `--apply-migration` | `pending` → 已移轉 0 筆（2 筆 pending 的新站內容確實還沒有）；只在 8 筆 `note` 加匯入標記 |

**第二批驗證了什麼**：

- 探針階段踩到的**錯配**（新新聞被對到清單裡的致醫界通函、第 17 版指引被對到已封存的第 16 版）已不會發生：`{id}` 佔位的清單項要標題或分頁也對得上才算。
- 疾病辨識與權責單位不再綁結核病：登革熱頁全部認出 `disease.dengue`，一頁兩疾病（登革熱／屈公病指引）兩個都認出；檢驗頁歸檢驗中心、統計頁歸疫情中心、其餘歸急性傳染病組。
- 模板推導讓「只寫例外」的清單也能對照：19 個標準子頁對上，報告與補丁分開列，不會把推導項寫進人工清單。
- 仍是**模擬匯出**：信心偏高的原因與首批相同，真實批次會更低。

---

### 10.2 流感第三批結果

> 以下數字是第三批當時的結果；第四批重跑後 `data/legacy-import/influenza/report.md` 是 31 頁（作業手冊與治療指引位置不再另產）、合約院所查詢已是 service 草稿、澄清稿已是 clarification 草稿，見 10.3。

> 第三批的目的：拿**疫苗與服務型別最多**的疾病，看工具在「舊頁型別 ≠ 新站型別」時怎麼辦。模擬匯出同樣模板驅動（`node scripts/lib/legacy-import/sim-export-disease.mjs disease.influenza data/legacy-export/influenza`）：模板 20 項＋流感人工例外 8 項（疫苗專區、接種計畫、作業手冊、合約院所查詢、抗病毒藥劑使用對象兩個版次、歷年計畫）＋近三年新聞 5 篇，共 33 頁。輸出在 `data/legacy-import/influenza/`，草稿不進 `content/`。**最終數字以 `data/legacy-import/influenza/report.md` 為準。**

| 項目 | 數字 |
| --- | --- |
| 匯出頁數 | 33（模板 20、人工例外 8、近年新聞 5） |
| 產出草稿數 | 34：Q&A 10、頁面 11、文件 7、新聞 5、疾病頁 1（疾病介紹八頁＋預防接種併成 1 份） |
| 平均信心 | 0.89 |
| 需人工檢視（信心 < 0.6） | 1（海報清單頁：掃描 PDF 無文字層＋圖片缺 alt） |
| 既有內容已存在（供比對） | 26 |
| 附件與圖片 | 10：附件 7、內文圖片 2、資料檔 1；圖片待補 alt 2、PDF 無文字層 2 |
| 草稿 schema 驗證 | 34 / 34 通過 |
| 未對應類別 | 0 |
| 人工例外清單 | 對上 8 / 8；**與清單判定不同 0**（修正前 1：見下） |
| 模板推導項 | 20 項對上 19（修正前 18：「工作手冊」靠文件種類對上；「治療指引」仍對不上，同第二批） |
| 清單沒有的舊頁 | 6（5 篇近年新聞＋1 份工作指引） |
| `--apply-migration` | `pending` → 已移轉 0 筆；只在 8 筆 `note` 加匯入標記；2 筆合約院所查詢維持 pending |

**第三批新增的處理經驗（每一項都寫「原本怎樣 → 改成怎樣 → 為什麼比較好」）**：

1. **草稿型別跟著清單目標走（`type-from-manifest`）。**
   原本：舊頁的型別只看網址模式。「公費流感抗病毒藥劑使用對象」在舊站是欄目內頁（`/Category/MPage/…`），所以草稿暫存成 `page`，再記一條 `target-type-differs` 提示「新站對應的其實是文件」，兩個版次都如此。
   改成：舊頁是欄目內頁、而移轉清單說它對應新站的一份 **document** 時，草稿直接建成 document，id 就是清單的 target（`doc.flu-antiviral-eligibility.2026-09-18`、`…2026-06-01`），只記一條提示。清單頁（連結集合）不適用，仍不轉。
   為什麼比較好：清單是人工逐筆確認過的判定，比網址模式可靠；草稿型別對了，報告才能把它和既有文件**逐欄比對**（版次、生效日、取代關係），人工不必再把 page 草稿手動改建成 document。第二批 8 條 `target-type-differs` 提示有 2 條就是這種情況，第三批降到 0 條需要人工改型別的文件。

2. **模板文件項改用「文件種類」語意對，不改共用模板（`manifest-derived`）。**
   原本：模板裡的「工作手冊」「病例定義」「治療指引」是通稱，舊頁標題是正式名稱（「公費流感疫苗接種計畫作業手冊」），標題包含比對對不上，第二批就有一項、第三批兩項對不上而被列為「清單沒有的舊頁」。
   改成：舊頁是文件型、從標題看得出文件種類（既有的 `docTypeFor` 規則）、且與推導項的 `mapTo.docType` 相同，就算對上。「工作手冊」因此對上；「治療指引」（docType `guideline`）對不上是因為舊頁標題「…防治**工作**指引」被規則判為 manual 類，**留給 Yulun 決定**要改模板標題還是改規則。
   為什麼比較好：另一條路是把 `_disease-template.json` 的 oldTitle 改成各疾病的正式名稱，但模板是 99 種疾病共用的治理資產，為了匯入去改它會波及推導清單與 404 對照；用語意比對把差異留在匯入工具這一側，模板維持「通稱」。

3. **人工判定 dropped／archived、工具找不到去向 ⇒ 一致，不是衝突。**
   原本：`migration-patch.json` 把「工具建議 pending、清單寫 dropped」算成「與清單判定不同」，歷年接種計畫（2020–2024 年度）因此被列為衝突。
   改成：工具的 pending 意思是「新站沒有對應內容」，而人工的 dropped／archived 正是「決定不搬」，兩者相容；只有工具**找到了**對應（migrated／merged）而清單寫 dropped 才是真衝突。
   為什麼比較好：衝突欄位的用途是提醒人回頭看，把必然一致的情形算成衝突會讓人每批都白看一次，久了就不看了（第一批 40 筆、第二批 33 筆都沒有衝突，第三批唯一的 1 筆是假警報）。

4. **服務型頁面不轉，等 service 型別。**
   「公費流感疫苗合約院所查詢」「公費抗病毒藥劑合約院所與藥局」在舊站是查詢清單（動態頁），新站的對應是 `service` 型別（查詢工具＋資料集），不是一篇文章。工具把它們當清單頁（不轉、草稿只供比對連結），清單維持 pending。
   為什麼比較好：把查詢頁轉成靜態 page 會留下一份馬上過時的院所名單（第一批「結核病／相關連結」等清單頁也是同樣道理）；正確做法是由 OASIS 建 service 內容並掛資料集，再把清單標 migrated。這是「只產五種型別」限制（第 12 節）最常碰到的一種，優先補 service。

5. **同一份文件從兩個舊網址抵達。** 作業手冊同時出現在模板的「工作手冊」位置與疫苗專區的例外項，兩頁都對到 `doc.flu-vaccine-manual.2026-09-16`；工具讓第二份 id 加 `-2` 並記 `target-shared`，請人工刪一份。要讓它不再出現，可在流感清單加 `omit: ["manual"]` 宣告模板的「工作手冊」由例外項涵蓋（清單的例外機制本來就為此設計），這一批先不改清單，留在報告裡讓 Steward 看得到。

**第三批驗證了什麼**：疫苗、藥劑這類「同一主題多個版次」的文件能對到正確版次並建議封存舊版（6 月版 → archived，與清單一致）；疾病頁九個分頁併成一份；10 題 Q&A 全部對到既有 faq id；平均信心 0.89 仍是模擬匯出的樂觀值。

---

### 10.3 麻疹＋腸病毒第四批結果（結構化型別直接產）

> 第四批做三件事：把第三批留下的兩個決定做掉（「治療指引」怎麼對、要不要直接產 service 等型別，Yulun 2026-10-05 交由工具端決定並要求直接產），然後用麻疹與腸病毒兩個疾病各一份模擬匯出驗證。兩個疾病各跑一次（`sim-export-disease.mjs disease.measles` / `disease.enterovirus` → `data/legacy-import/measles/`、`data/legacy-import/enterovirus/`），同一個 PR 交付。**最終數字以兩個目錄的 `report.md` 為準。**

| 項目 | 麻疹 | 腸病毒 |
| --- | --- | --- |
| 匯出頁數 | 28（模板 18、人工例外 7、近年新聞 3） | 31（模板 18、人工例外 8、近年新聞 5） |
| 產出草稿數 | 29：Q&A 10、文件 4、頁面 6、新聞 4、**出版品 1、影音 1、資料集 1、檢驗 1**、疾病頁 1 | 27：Q&A 6、文件 4、頁面 6、新聞 5、**出版品 1、影音 1、資料集 1、檢驗 1、服務 1**、疾病頁 1 |
| 平均信心／需人工檢視 | 0.94／0 | 0.93／0 |
| 草稿 schema 驗證 | 29 / 29 | 27 / 27 |
| 人工例外清單 | 7 / 7，衝突 0 | 8 / 8，衝突 0 |
| 模板推導項 | 18 項對上 **18**（第二、三批是 19／20 對不上「治療指引」） | 18 項對上 18 |
| `--apply-migration` | 只在 7 筆 `note` 加匯入標記；2 筆 pending（消除專區、接觸者活動場所公告）新站確實還沒有 | 只在 8 筆 `note` 加匯入標記；1 筆 pending（重症責任醫院名單：已有 service 草稿，等補步驟） |
| 以 page 暫存且 `target-type-differs` 的 | 只剩新聞列表、相關連結（本來就不轉成型別） | 只剩新聞列表、專區首頁 |

**第四批新增的處理經驗（原本怎樣 → 改成怎樣 → 為什麼比較好）**：

1. **模板項改以「舊站選單位置」對應，不改模板、不改規則關鍵字。**
   原本：模板「治療指引」項對不上舊頁標題「公費流感抗病毒藥劑使用對象」或「登革熱／屈公病防治工作指引」，三批都留一項對不上；第三批試過用文件種類（docType）語意對，但標題看不出種類時仍失敗。
   改成：模板項的 oldTitle 其實是舊站**選單的名稱**，而匯出側檔的最後一層麵包屑就是這個選單位置；位置相同即對應（`byCrumb`），文件種類看不出來時也改從麵包屑推。
   為什麼比較好：比對的是「這頁在舊站的哪個位置」而不是「標題長得像不像」，正是模板想表達的意思；模板與規則檔都不用為個別疾病改字，99 種疾病同一套。三個候選方案裡（改模板標題、加 docType 關鍵字、位置對應），只有位置對應不會隨疾病增加而一直補字。

2. **人工例外已指向同一份新站內容的模板位置，不再推導、模擬匯出也不另產頁。**
   原本：第三批作業手冊從模板「工作手冊」位置和疫苗專區例外各來一頁，兩頁對到同一份文件，第二份 id 加 `-2` 記 `target-shared`，要人工刪一份；建議用 `omit` 一筆筆排除。
   改成：展開模板時，推導目標若已是某筆人工例外的 target，就視為該位置被例外涵蓋而跳過；模擬匯出用同一支展開函式決定要產哪些頁，因此五批重跑後每批少 2 頁（33 → 31），`target-shared` 歸零。
   為什麼比較好：不必每個疾病手寫 `omit`，而且規則只有一處（`expandTemplateItems`），轉換器與模擬匯出不會各說各話。真實舊站若真的在兩個位置掛同一份檔，轉換器仍會以 `target-shared` 標出來，沒有漏接。

3. **同型別多筆時，推導目標取「現行且最新」。**
   原本：取字母序第一筆，流感「治療指引」位置因此被對到已封存的 6 月版，再把 9 月版擠成 `-2`。
   改成：published 優先，再依生效日由新到舊。
   為什麼比較好：模板位置掛的一定是現行版，舊版由 `superseded`／`archived` 規則處理；這也和治理引擎「現行版唯一」的原則一致。

4. **六種結構化型別直接產，看不出的欄位以「（待補）」佔位並記 `fields-pending`。**
   原本：海報、影片、統計、檢驗、服務、澄清稿草稿以 page／news 暫存並記 `target-type-differs`（第一批 17 條、第二批 8 條），人工要重建成正確型別再逐欄補。
   改成：`types.mjs` 依型別抽欄位——出版品種類由標題關鍵字或模板 `pubType`；影片 id 從 YouTube 嵌入抓、文字稿取「影片文字稿」段；資料集的 canonicalUrl 取開放資料連結、更新頻率看「年度／每週」字眼、CSV 附件掛成 resources；檢驗的檢體名稱從「項目｜內容」表拆、送驗時限抓「N 小時」；服務的步驟取清單項、種類由 `serviceRules`；澄清的 claim 取引號內文字、verdict 看「不實／過時／部分正確」。抽不到的必填欄位填「（待補：原因）」並記 `fields-pending` 警告。
   為什麼比較好：草稿先過 schema、落在正確的目錄與型別，報告才能跟既有的 `labtest.measles`、`dataset.measles-yearly` **逐欄比對**；人工的工作從「重建一筆」變成「補幾個欄位」。佔位字串刻意寫明原因，上架前的治理檢查（`fields-pending` 警告、「（待補」字樣）會擋住沒補完的草稿。`target-type-differs` 從每批 8–17 條降到 2–3 條，剩下的都是本來就不轉成型別的清單頁與專區首頁。

5. **服務型頁面建 service，但名單不進內文。** 合約院所查詢、重症責任醫院名單依 `serviceRules` 建成 `service`（`serviceType: clinic`），步驟與適用對象佔位，並提示「名單屬時效資料，應掛 dataset 由系統更新」。為什麼：第三批已說明查詢頁轉成靜態文章會留下一份馬上過時的名單；建成 service 型別後，新站的查詢工具與資料集才有掛載點，清單也能從 pending 走到 migrated。

6. **澄清稿建 clarification，與既有 news 比對。** typeid 8772 的公告直接建成 clarification（`clar.` id），既有以 news 存放的同標題澄清列為比對對象並記 `type-upgrade`。為什麼：澄清稿的價值在 claim／verdict 可被 AI 問答與搜尋直接引用，留在 news 型別就只是文章。

7. **清單判定「併入」某份文件或疫苗頁的欄目內頁，以 page 暫存、不搶目標 id。** 麻疹群聚事件應變專區（併入接觸者追蹤指引）、腸病毒停課標準（併入教托育指引）記 `merge-into-target`；併入檢驗、資料集、服務等結構化型別則照目標型別建草稿供逐欄比對。為什麼：文件的 id 要留給文件本身那頁（PDF），否則兩頁搶同一個 id 又回到 `-2`；而結構化型別的「併入」其實就是「這頁就是那筆資料」，建同型別草稿才有比對價值。

**第四批驗證了什麼**：模板位置全部對上（18/18，兩個疾病都是）；五批重跑後沒有任何 `target-shared`、衝突 0、schema 全過；結核病首批也因此多出 service 4、labtest 1、dataset 1、publication 1、media 2 的草稿（需人工檢視從 3 降到 1）。

**第四批結束時還沒做的**（已在第五批做掉，見 10.4）：topic（相關連結）與 vaccine 專區頁仍以 page／疾病區塊處理；`expandTemplateItems` 的「例外涵蓋」規則只在匯入工具這一側，治理引擎 R15 尚未同步。仍然要靠人的：`fields-pending` 的欄位由權責單位補。

### 10.4 其他第一、二類傳染病第五批結果（沒有人工清單也能轉）

> 第五批先做掉第四批留下的兩件小事（專區／疫苗型別、R15 同步），再把主檔裡**有疾病頁但沒有人工移轉清單**的第一、二類傳染病一次轉完：狂犬病、瘧疾、A 型肝炎、德國麻疹、屈公病、M 痘六種（第一、二類共 26 種，有疾病頁的 8 種裡登革熱與麻疹已在前幾批）。六個疾病各一份模擬匯出（`sim-export-disease.mjs disease.<slug>`）、各一個輸出目錄 `data/legacy-import/<slug>/`，都**沒有加 `--apply-migration`**——因為沒有清單檔可寫。

| 項目 | 狂犬病 | 瘧疾 | A 型肝炎 | 德國麻疹 | 屈公病 | M 痘 |
| --- | --- | --- | --- | --- | --- | --- |
| 匯出頁數 | 20（模板 20） | 20 | 20 | 20 | 23（＋近年新聞 3） | 22（＋近年新聞 2） |
| 產出草稿數 | 12 | 13 | 12 | 12 | 15 | 14 |
| 其中結構化型別 | 出版品 1、影音 1、資料集 1、檢驗 1、**專區 1** | 同左 | 同左 | 同左 | 同左＋新聞 3 | 同左＋新聞 2 |
| 平均信心／需人工檢視 | 0.91／1 | 0.92／1 | 0.93／1 | 0.89／1 | 0.93／0 | 0.94／0 |
| 草稿 schema 驗證 | 全過 | 全過 | 全過 | 全過 | 全過 | 全過 |
| 清單 | 合成（`synthetic: true`），模板 20 項對上 20 | 同左 | 同左 | 同左 | 同左 | 同左 |
| 以 page 暫存且 `target-type-differs` 的 | 只剩新聞列表 | 同左 | 同左 | 同左 | 同左 | 同左 |

「需人工檢視 1」的四個疾病都是同一種情況：模板「宣導海報」位置的 PDF 沒有文字層（`pdf-no-text-layer`）拉低信心，不是轉錯。

**第五批新增的處理經驗（原本怎樣 → 改成怎樣 → 為什麼比較好）**：

1. **沒有人工清單的疾病用「合成清單」轉，不先補一個空清單檔。**
   原本：轉換器只有在 `content/migration/{slug}.json` 存在時才展開模板推導項；沒有清單檔的疾病所有頁都會記 `not-in-manifest`，要先手寫一個只有 `extends` 的空清單才轉得動。
   改成：清單檔不存在但主檔有這個疾病時，工具自己組一份合成清單（`extends: migration-template.disease`、`items: []`）展開 20 個推導項比對，報告標 `manifest.synthetic: true`；`--apply-migration` 對合成清單直接拒絕並說明原因。
   為什麼比較好：治理引擎 R15 本來就對主檔每一種疾病推導清單（`v1/migration/{slug}.json`），匯入工具跟它用同一條規則，99 種疾病不必各放一個空檔；而「拒絕寫回」讓人工清單只在真的有例外時才出現，維持「清單只寫例外」的原則。想寫回時，把 `v1/migration/{slug}.json` 存成人工清單再跑一次即可。

2. **「例外涵蓋就不推導」三處同步：保留項目、加 `coveredBy` 標記，而不是刪掉。**
   原本：第四批匯入工具在展開模板時直接**丟掉**被例外涵蓋的位置，治理引擎 R15 沒有這條規則，後台移轉頁與匯入報告的推導項數差 2（20 vs 18）。
   改成：`expandTemplateItems`（匯入）與 `composeDiseaseList`（R15）都把被涵蓋的位置**留著**並標 `coveredBy: <例外 key>`、狀態跟例外走、`note` 寫明被哪筆涵蓋；匯入與模擬匯出只處理沒有 `coveredBy` 的，報告另列 `manifest.derivedCovered`。
   為什麼比較好：兩邊項數一致（都是 20），後台看得到「這個位置為什麼不用做」，而不是憑空少兩筆；測試可以直接斷言被涵蓋的是哪兩個 key。刪掉是最省事的做法，但會讓清單的「涵蓋範圍」在不同畫面長得不一樣，同事會以為漏了。

3. **相關連結頁直接建 topic，連結全部 `unchecked`。**
   原本：模板「相關連結」位置（`mapTo: related topic`）以 page 暫存並記 `target-type-differs`，推導到的既有專區（例如登革熱 → 防災避難衛生須知）被當成目標。
   改成：建成 `topic` 草稿（`kind: resource-hub`、id 固定 `topic.{slug}-links`），Markdown 裡的連結進 `links[]`：站外標 `external: true`、還是 `www.cdc.gov.tw` 的加 note「舊站網址，尚未對應到新站路徑」、一律 `status: unchecked`；推導到的既有專區只列 `compareWith`，不搶它的 id。
   為什麼比較好：相關連結頁的價值是那串連結，而連結健康檢查（第 9 節 SOP、`/admin/links/`）只認 topic 的 `links[]`；以 page 暫存等於把連結埋在內文裡沒人檢查。不沿用推導目標 id 是因為「與此疾病相關的某個專區」不是「同一份內容」，直接覆寫會把防災專區改成登革熱連結頁。

4. **疫苗專區頁：清單說「已移轉」到疫苗頁才建 vaccine，說「併入」就維持疾病頁疫苗區塊。**
   原本：疫苗專區頁依標題關鍵字一律歸疾病頁 `vaccine` 區塊；腸病毒 71 型疫苗專區（清單 `merged` → `vaccine.ev71`）也是如此。
   改成：清單 `status: migrated` 且 `target` 是疫苗頁時，草稿建成 `vaccine`（同 id、`existing` 供比對）：`publicFunded` 由表格有「公費」字樣的列抽（對象＝第一欄、劑次＝第二欄），`nameEn` 待補；`merged` 不變。沒有清單目標時不靠關鍵字猜型別。
   為什麼比較好：第四批 Yulun 已決定 EV71 併入疾病頁，工具不該因為標題有「疫苗」就反過來建一頁；只有清單明說「這頁就是新站的疫苗頁」才建，判斷權留在清單。公費對象表是疫苗頁最有價值的結構化欄位，能抽就抽、抽不到就空陣列加 `fields-pending`，自費疫苗本來就該是空的。

5. **結核病首批不受影響的檢查。** 五種既有批次重跑後只有相關連結頁從 page 變 topic（各少一個 page 草稿、多一個 topic 草稿），清單 `note` 完全相同（重跑後 `content/migration/*.json` 無差異）。為什麼要特別看：這批改了模板展開的回傳形狀（多了 `coveredBy` 項），最容易在不相干的批次出現數字變化；測試把 TB／登革熱／流感／麻疹／腸病毒的頁數與型別分布都釘死。

**第五批驗證了什麼**：六個疾病 20 個模板位置全部對上、衝突 0、schema 全過、沒有寫回任何清單；R15 與匯入工具的推導項數一致。**還沒做的**：六個疾病的草稿全是「既有內容已存在，供比對」（主檔內容本來就有），正式匯出後才會出現真正的新內容；`fields-pending` 仍要權責單位補。


### 10.5 新聞與公告第六批結果（沒有清單，用三級處理）

> 第六批換一種形狀的批次：新聞不是「一頁對一頁」搬，沒有移轉清單，靠第 7 節的三級處理決定每頁的去向。模擬匯出 `scripts/lib/legacy-import/sim-export-news.mjs` 把既有 39 則新聞／通函與 8 則澄清稿反推成舊站 Bulletin 內頁，另合成新站沒有的近年新聞 6 則、超過三年的久遠新聞 6 則（含一則「活動報名」）、英文新聞稿 2 則（typeid 158）與一頁列表頁，共 60 頁 → `data/legacy-import/news/`。

| 項目 | 結果 |
| --- | --- |
| 匯出頁數／草稿 | 62 / 62（新聞 46、**致醫界通函 5**、澄清稿 10、頁面 1） |
| 建議動作 | 比對既有 47、**auto-ok 4**、上線前檢視 4（英文稿 2、內文太短 2）、**封存 5、drop 1**、略過列表頁 1 |
| 二級抽樣名單 | auto-ok 4 × 10% ＝ 1 頁（依網址雜湊固定，重跑不變） |
| 平均信心／需人工檢視 | 0.97／0 |
| 草稿 schema 驗證 | 62 / 62 |
| 移轉清單 | 無（也不合成：主檔沒有「news」這種疾病）；沒有任何 `not-in-manifest` |

**第六批新增的處理經驗（原本怎樣 → 改成怎樣 → 為什麼比較好）**：

1. **新聞批次不用移轉清單，報告直接給三級名單與抽樣名單。**
   原本：前五批每頁都要對到清單（或模板推導項），對不上就記 `not-in-manifest` 警告；新聞有上千則，清單寫不完也沒意義。
   改成：沒有清單檔、主檔也沒有對應疾病時，報告 `manifest: null`、不出 `not-in-manifest`；每頁的去向由建議動作決定（compare-existing／auto-ok／archive／drop／skip-list），報告新增 `sampling`（auto-ok 頁依網址雜湊排序取前 ceil(n × 0.1)）與 `report.md` 的「二級抽樣檢視名單」段。
   為什麼比較好：第 7 節本來就說近年新聞是「抽樣 10% 後整批上線」，報告直接產名單，公關室照單抽看，不必自己挑；雜湊排序讓抽樣可重現、可稽核（不是人挑順眼的）。舊網址的轉址仍由 `legacyUrls` 與 404 報表處理，不需要清單。

2. **致醫界通函建成 `letter`，權責歸疾病業務組，不歸新聞欄目的公關室。**
   原本：Bulletin 的通函 typeid 落在「其他訊息」，草稿是 `news`／`other`；欄目「新聞與公告」若對到公關室，通函也會掛公關室。
   改成：規則檔加 typeid 48（真實舊站通函類別）與標題正規式「致醫界通函第 N 號」，兩者任一命中就建 `letter` 並抽 `letterNo`；`categoryOwners` 的「新聞與公告」帶 `preferDiseaseFor: ["letter"]`，通函改取疾病主檔的業務組（記 `owner-from-disease`）。五批重跑後登革熱、腸病毒、屈公病批次裡的通函也跟著變成 `letter`。
   為什麼比較好：通函的讀者是醫療院所、內容是業務組的作業規定，治理引擎對 `letter` 有專屬規則（版本鏈加註、`effectiveAt`）；標題正規式是保險，因為真實匯出的 typeid 未必乾淨。

3. **英文新聞稿不走二級自動上線。**
   原本：typeid 158 的英文稿只標 `sourceLang: en`，信心夠就會被列為 auto-ok。
   改成：記 `needs-source-zh` 警告（治理規則 18：中文是正本），動作降為 review-before-publish。
   為什麼比較好：自動上線一則只有英文的「新聞稿」會變成沒有中文正本的孤兒頁，多語機制也接不上；留給人補中文版。

4. **既有澄清稿存成 news 的，報告列為 type-upgrade。** 兩則 `newsType: clarification` 的既有新聞對上 Bulletin 8772 的澄清稿，草稿建成 `clarification`（claim／verdict／shareText）並列既有 news 為比對對象；第四批已有這條規則，第六批是第一次整批驗證（10 則澄清稿 schema 全過）。

**第六批驗證了什麼**：三級處理全部走到（既有比對、auto-ok＋抽樣、封存、drop、略過列表頁）、通函與英文稿各有正確去向、schema 全過。**還沒做的**：真實匯出的新聞有上千則，`auto-ok` 的信心門檻（0.8）與抽樣率要用真實樣本校準；新聞內文裡指向舊站其他頁的連結，仍要靠轉址表（第 9 批前補齊）。

### 10.6 示意內容對齊真實規定：流感抗病毒藥劑版本鏈（2026-10-05 修正）

> 這不是一個批次，是一次內容修正留下的經驗。第三輪為了示範「文件版本鏈」寫了一條虛構的規定（6 月版「未滿 5 歲及 65 歲以上經快篩陽性」→ 9 月版「65 歲以上免快篩、未滿 5 歲仍需快篩」）。同事對照疾管署[致醫界通函第 616 號](https://www.cdc.gov.tw/Bulletin/Detail/3OyyJUUS0GduEm9t52Fnow?typeid=48)發現不符：真實規定是**全年適用對象（含未滿 5 歲及 65 歲以上）經醫師評估一律不需快篩**，2026-08-24 起另擴大 7 類高傳播族群、通函 616 號把期限延到 10-31。這條錯誤不是舊站匯入來的，是示意內容；流感第三批的模擬匯出又從示意內容反推，所以錯誤一路被「搬」進匯入報告。

**改了什麼**：版本鏈改成三版（全年適用版 `…2026-06-01` → 8 月擴大版 `…2026-08-24` → 9 月延長版 `…2026-09-18`，後者依據通函 616 號），新聞稿改成真實的 8/24 擴大與 9/18 延長兩則，另建通函 616 號（`letter`）；Q&A、疾病頁區塊摘要、主檔反向稽核訊息、評估集題目、示意 PDF 一併對齊。原本示意的「致醫界通函第 616 號：登革熱 NS1 試劑配置」與真實號次相撞，改為第 615 號並在摘要標「示意通函，號次非真實」。

**處理經驗（原本怎樣 → 改成怎樣 → 為什麼比較好）**：

1. **示意的法規文字要能對到真實來源，對不到的就標示。**
   原本：示意內容只在 `note` 寫「條文依公開文件架構改寫」，沒有說哪一段是真、哪一段是編的；編出來的規定被 Q&A、新聞、疾病頁、評估集引用後，看起來像真的。
   改成：規定類文件的 `legacyUrls` 放真實來源網址（一覽表頁、新聞稿、通函），`note` 寫明依據哪幾份來源改寫、哪個欄位（版次日期）是原型整理日；確定是虛構的（示意通函號次）在摘要直接標「示意、非真實」。
   為什麼比較好：治理引擎的「仍連結失效版本」與「正本修訂連動」都靠 id／網址比對，示意內容有真實來源可查，Steward 審閱時能一眼分辨要核對什麼；上線前把示意內容換成正式內容時，也知道該換哪些段。

2. **模擬匯出會把示意內容的錯誤「洗」成匯入結果，報告要能回溯來源。**
   原本：流感批次的匯入報告寫「既有內容已存在，供比對」，看不出草稿的內文其實是從新站示意內容反推的。
   改成：模擬匯出的 README 與報告來源欄已註明「內文反推自既有內容，不是舊站真實資料」；修正時先改 `content/`，再重跑模擬匯出與三個受影響批次（流感、登革熱、新聞），用 `--now` 固定時間讓差異只剩內容。
   為什麼比較好：真實匯出時不會有這個問題（內文來自舊站），但原型階段任何「匯入報告說對得上」都要先問一句「對的是真的舊站，還是示意內容」；重跑時固定時間戳，PR 的差異才看得出哪些是內容修正、哪些是噪音。

3. **一個真實號次只能有一份內容。** 原本示意通函隨手取了 616 號，和真實通函撞號；改成示意號次避開已知真實號次並標示，真實通函用真實號次與真實網址。治理引擎與專業首頁都用號次顯示通函，撞號會讓讀者對錯文件。

### 10.7 指引與手冊第七批結果（文件版次鏈）

> 第七批是**一級內容**（現行指引與手冊），不論信心分數都要 Steward 逐頁確認，所以這批的重點不是自動上線，而是**把版次關係搬對**：舊站一份指引常是一頁（內文是現行版、附件列表放歷版 PDF），或歷版各自一頁；新站則是 document 型別一版一筆、以 `family`／`supersedes` 串鏈。模擬匯出 `scripts/lib/legacy-import/sim-export-guidelines.mjs` 把既有 27 份文件（19 個家族）反推成欄目內頁 21 頁（歷版 6 份放同頁附件；流感抗病毒藥劑三版各一頁），另合成 4 頁新站沒有的（狂犬病手冊兩版、純 PDF 的感染管制指引、歷版掃描檔）與 1 頁總覽列表。移轉清單 `content/migration/guidelines.json`（欄目範圍）逐家族一筆，26 筆。

| 項目 | 結果 |
| --- | --- |
| 匯出頁數／草稿 | 26 / 32（文件 31、頁面 1；多出的 6 份是從附件拆出的歷版） |
| 建議動作 | 比對既有 19、上線前檢視 2（純 PDF 新文件、狂犬病新版）、**封存 4**（流感兩歷版、狂犬病舊版、H7N9 掃描檔）、略過列表頁 1 |
| 既有內容可比對 | 27 / 32（含 6 份歷版：id 沿用新站已有的 `doc.tb-guideline.2022-03-01`、`doc.guidance-dengue.v15` 等） |
| 平均信心／需人工檢視 | 0.97／0（但一級內容全部人工確認） |
| 草稿 schema 驗證 | 32 / 32 |
| 移轉清單 | 26 筆對上 26，無衝突；仍待移轉 4（狂犬病兩版、感管指引、H7N9） |
| 問題 | warn 5：`pdf-only` 2、`body-short` 2、`pdf-no-text-layer` 1；錯誤 0 |

**第七批新增的處理經驗（原本怎樣 → 改成怎樣 → 為什麼比較好）**：

1. **去掉版次後同名的頁，視為同一文件家族，版次鏈依生效日自動串。**
   原本：文件草稿的 `family` 由清單 target 或**舊網址雜湊**決定，同一份指引的兩個版次各自一頁時會變成兩個家族，新站看不出誰取代誰。
   改成：標題去掉「第 N 版」「vN」「2023 年版」「114.04.16」「（113 年 12 月修訂版）」等版次字樣後正規化（`versionFree`），同一批裡同名的頁共用一個 family（`doc.{疾病}-{標題雜湊}`）；第一階段結束後，同家族依 `effectiveAt`（再依版次數字）排序，新版 `supersedes` 前一版，舊版那頁記 `historical-version` 並建議封存。有清單 target 的頁則沿用既有文件的 `family`（例如 `doc.guidance-dengue.v17` 的 family 不是去掉日期就有）。
   為什麼比較好：治理引擎 R2 的「現行版／失效版」就是靠 `family` 與 `effectiveAt`；轉換時就串好，上架後舊版自動加失效警示、AI 不會引到舊版，不必人工補 `supersedes`。只在「同名多頁」時改用標題雜湊，單一版次的頁仍用原本的網址雜湊，前六批的輸出不受影響。

2. **一頁多版：附件列表裡標了別的版次的 PDF，拆成同家族的純 PDF 舊版草稿。**
   原本：整頁的附件都掛在現行版草稿底下，歷版 PDF 混在現行版的 `assets`，新站沒有歷版的獨立頁。
   改成：附件標籤同時滿足「頁面版次已知」「標籤版次不同」「去版次後與頁面同名」三個條件才算另一版次（附表、申請書等不同名附件不拆）；每個拆出的版次建一份只搬 PDF、`machineReadableMarkdown` 以（待補）佔位的草稿，生效日從標籤的日期抽（民國年換算），檔案移到該草稿自己的 `assets`；新站已有同家族、同生效日或同版次的文件就沿用它的 id（供比對），沒有就 `family.生效日`。
   為什麼比較好：舊版只是「保留查閱」，不值得轉內文（第 8 節 PDF 不整批轉），但要有自己的一筆才能進版次鏈、掛失效警示、讓舊附件網址 301 到正確版次；三個條件缺一就不拆，是為了避免把附表拆成假版次。

3. **純 PDF 頁：內文只有下載連結時，正本以（待補）佔位、不整批轉 PDF。**
   原本：內文太短只記 `body-short`，草稿的 `machineReadableMarkdown` 是空的或一句「請下載附件」，過 schema 但上架等於沒有機讀正本。
   改成：內文（去空白）少於 `minBodyChars` 且有 PDF 附件 ⇒ 記 `pdf-only`（warn）與 `fields-pending`，正本欄位寫明「正本為 PDF『…』，上架前請權責單位提供文字版」；建議動作仍是上線前檢視。
   為什麼比較好：文件型別的機讀正本是 `machineReadableMarkdown`，不是 PDF（assets-policy 第 4 節）；把「這份只有 PDF」寫成待辦，Steward 一眼看出哪些要補文字版，而不是上線後才被 `attachment-no-accessible-version` 待辦抓到。

4. **生效日優先從標題與內文抽，不用舊頁發布日。**
   原本：`effectiveAt` 一律用側檔的 `publishedAt`，但指引頁常在修訂後更新頁面（頁面日期晚於生效日），或頁面日期是第一版上線日。
   改成：標題的完整日期（「114.04.16 版」）優先；標題只有年月（「113 年 12 月修訂版」）時以內文開頭的完整日期「…年…月…日修訂／生效／公告」為準；都沒有才用發布日；民國年、`114.04.16`、`2022-03-01` 都認得；取自文字時記 `effective-from-text`（26 頁中 8 頁）。
   為什麼比較好：版次鏈排序與 R2 的現行版判定都看 `effectiveAt`，用錯日期會讓新版排在舊版前面；標題與內文寫的日期才是文件的生效日。

**第七批驗證了什麼**：一頁多版、歷版各一頁、清單 target 同家族三種版次來源都能串成正確的鏈（結核病診治指引 7→8、登革熱指引 v15→v16→v17、流感抗病毒藥劑三版、狂犬病手冊兩版）；純 PDF 與掃描檔有明確去向；一級內容全部走人工確認。**還沒做的**：真實舊站的附件標籤寫法五花八門（「最新版」「修正版」「附件 1」），版次字樣的正規式要用真實樣本補；`docType: form`（表單）目前只靠標題關鍵字，矩陣網址（DiseaseManual／Teach）會蓋過它。

### 10.8 常見問答第八批結果（每題一筆、跨批重複、tasks 與期限）

> 第八批是**一級內容**（Q&A），不論信心分數都要 Steward 逐題確認。Q&A 在前七批已經處理過一部分：每個疾病專題樹底下的 Q&A 頁，在該疾病的批次就拆題轉成 `faq` 了。第八批要處理的是**欄目本身**：舊站「常見問答」欄目會把所有問答頁再列一次（含疾病專題那些頁），加上不綁單一疾病的主題頁（預防接種、旅遊、統計、謠言澄清）、疾病批還沒做的疾病（新冠併發重症、B 型肝炎、HIV、百日咳、水痘）、年度 Q&A、英文頁。模擬匯出 `scripts/lib/legacy-import/sim-export-qa.mjs` 由既有 57 題反推成 12 頁（約 33 題；含 6 題新站沒有的題、兩頁沒有手風琴元件的鬆散排版、一頁期限已過的 113 年度流感疫苗 Q&A、一頁英文、一頁整頁一題），另**原樣複製**疾病批匯出裡同網址的結核病、登革熱 Q&A 頁 2 頁，與 1 頁總覽列表。移轉清單 `content/migration/qa.json`（欄目範圍）13 筆；結核病、登革熱那兩頁不列，由轉換器判定。

| 項目 | 結果 |
| --- | --- |
| 匯出頁數／草稿 | 15 / 34（Q&A 33 題、頁面 1） |
| 建議動作 | 比對既有 10、上線前檢視 2（英文頁、113 年度流感疫苗 Q&A）、**別批已轉過 2**（結核病、登革熱 Q&A 頁，`skip-duplicate`）、略過列表頁 1 |
| 既有內容可比對 | 22 / 34 題對到既有 faq id |
| 平均信心／需人工檢視 | 0.95／0（但一級內容全部人工確認） |
| 草稿 schema 驗證 | 34 / 34 |
| 移轉清單 | 13 筆對上 13，無衝突；建議 status 變化 1（B 肝單題頁 pending→migrated）；一頁多題的主題頁 6 筆維持 pending |
| 問題 | warn 6：`answer-dated` 3、`needs-source-zh` 1、`duplicate-title` 1、`faq-structure-missing` 1；錯誤 0 |
| tasks 候選 | 33 題中 30 題有 tasks；全部 13 批的既有 67 題裡，第一個 task 與人工相同 60 題（90%），完全相同 46 題（多半是少了第二個 task） |
| structured 候選 | 8 題（問「多久／幾劑／幾歲」的題） |

**第八批新增的處理經驗（原本怎樣 → 改成怎樣 → 為什麼比較好）**：

1. **同一頁出現在兩批（疾病批與欄目批）：以疾病批為準，欄目批不重複出草稿，也不參與清單比對。**
   原本：每批各自轉，同網址的結核病 Q&A 頁在結核病批與常見問答批各出一套草稿；更糟的是欄目批裡沒列在清單的「Q&A」頁，會以寬鬆的標題比對搶走別的清單項目（登革熱的「Q&A」頁搶走了「B 型肝炎 Q&A」那筆）。
   改成：轉換器讀同一個輸出根目錄（`data/legacy-import/`）下其他批次的 `report.json`，Q&A 頁若同網址已在**它所屬疾病**的批次轉過（網址去協定、小寫比對；疾病由麵包屑與標題判，所屬批次＝疾病主檔的 slug），就記 `converted-elsewhere`、輸出列成「重複，未另出草稿」、建議動作 `skip-duplicate`，而且在清單比對之前就決定，不會搶清單項目。沒有別批報告時（例如測試或第一次跑）照常轉。
   為什麼比較好：疾病專題的子頁「家」在疾病批（清單、權責、疾病頁連結都在那裡），欄目批只是再看到一次；兩批都出草稿，Steward 會審兩次、而且兩套草稿可能不一樣。只認「所屬疾病的批次」而不是「任何批次」，是為了避免重跑順序造成互相略過（疾病批不會因為欄目批先跑過就略過自己的頁）。目前只對 Q&A 頁啟用；新聞欄目與疾病專題的新聞頁也有同樣的重疊，等第六批重跑時再開。

2. **沒有手風琴元件的問答頁，依「Q 開頭的標題／粗體段落」拆題。**
   原本：Q&A 頁只認 `.panel／.panel-title／.panel-body`，編輯手排的頁（`<h3>Q1. …</h3>` 加段落、或 Word 貼上的「Q：／A：」粗體段落）整頁當一題、記 `faq-structure-missing`。
   改成：抓不到 `.panel` 時，先用 `faqItemsLoose`：h2–h4 以「Q／問」開頭或以問號結尾、或 p 以「Q／問」開頭（120 字內）的節點算一題的開頭，到下一題之前的節點是答案，答案第一段開頭的「A：」「答：」去掉；至少 2 題、每題都有答案才採用，否則退回整頁一題。採用時記 `faq-structure-loose`（info）。
   為什麼比較好：舊站的問答頁不只一種版型，真實匯出一定會遇到手排的頁；把「拆對了但要人看一眼」（info）和「拆不出來」（warn）分開，Steward 才知道哪些頁要重新切題。門檻（至少 2 題、都有答案）是為了不把一般內文的小標誤當成問題。

3. **每題的 `tasks` 用關鍵字給候選，而不是留空。**
   原本：轉出的 `faq` 草稿沒有 `tasks`，新站的「我想…」入口（症狀、疫苗、旅遊、謠言、統計）要人工逐題補。
   改成：規則檔 `faqTasks` 列各 task 的關鍵字；先看題目（命中的都給、最多兩個），題目沒命中再看答案（取命中次數最多的一個），都沒有就留空並記 `tasks-unknown`；報告記 `tasks-from-keywords` 列出每題給了什麼。
   為什麼比較好：題目是人寫給民眾看的，關鍵字很穩定（「疫苗」「出國」「是真的嗎」）；用既有 67 題對照，第一個 task 90% 與人工相同，錯的多是少了第二個 task。「答案只取一個」是因為答案什麼都會提到（幾乎每題都提到就醫），全給會變成雜訊。這是候選，不是答案：Steward 看一眼比從零填快。

4. **答案寫的期限都已過，就警告。**
   原本：第 12 節說轉換「不判斷內容是否過時」，年度 Q&A（「113 年度公費流感疫苗什麼時候開打？」）會以高信心轉出，上線後才被審閱週期抓到。
   改成：答案裡的日期若前面有「至／到／～」或後面有「止／截止／前」，或寫了「NNN 年度」，視為期限；所有期限都早於轉換日（`--now`）就記 `answer-dated`（warn），草稿 `conversion.dated` 列出期限。只看寫了年的日期、只看期限語境，「依 2023 年 5 月 3 日公告辦理」這種不算。
   為什麼比較好：這是機械式可判的「過時」，不是內容判斷；年度 Q&A 幾乎每年都有一份，舊的該由新年度版取代或封存，轉換時就標出來，省掉上線再下架。第 12 節的限制改成「唯一例外是期限已過」。

5. **問「多久／幾天／幾歲／幾劑」的題，從答案抽數字＋單位成 `structured` 候選。**
   原本：`faq.structured`（schema 說明本來就是「上架預處理抽出的結構化欄位，人確認後保留」）全靠人工填，轉出的草稿一律沒有。
   改成：題目命中「多久／幾天／幾週／幾個月／幾歲／幾劑／間隔／什麼時候」時，答案裡的「2 週」「4 至 6 週」「65 歲」「3 劑」抽成 `{ weeks: 2 }`、`{ weeksMin: 4, weeksMax: 6 }`、`{ ageYears: 65 }`、`{ doses: 3 }`；每個單位只取第一個、最多 4 個欄位；日期的「10 月 1 日」不算天數。記 `structured-from-text`（info）、`conversion.structuredFromText: true`。
   為什麼比較好：這些數字正是 AI 問答最常答錯的（「多久」「幾劑」），有結構化欄位就能比對答案；但抽取一定有誤判（「約 2 週」是保護力產生時間還是觀察期，要看上下文），所以放在 `structured`（人確認後保留）並明確標示來源，不當成已確認的事實。

6. **一頁多題的 Q&A 頁，清單不提議 `migrated` 到第一題。**
   原本：`migration-patch.json` 看到「新站已有對應內容」就提議 `pending → migrated`、目標填第一份有既有內容的草稿；預防接種常見問答一頁 7 題，會被提議「已移轉到 `faq.hpv-vaccine-who`」。
   改成：Q&A 頁有多份草稿且清單沒指定目標時，提議維持 `pending`，報告記 `one-to-many`；註記仍列出全部草稿 id。單題頁（B 肝）照常提議 `migrated`。
   為什麼比較好：移轉清單的 `target` 是舊網址 301 的去處，一頁多題沒有單一去處，要由人決定併入哪個疾病頁（`merged`）或轉到新站依 `tasks` 篩選的 Q&A 列表；自動填第一題會讓舊網址轉到一個不相干的單題。

7. **英文問答頁與第六批英文新聞稿同一套規則。**
   原本：`/En/…` 沒有 URL 模式，英文問答頁記 `type-unclear` 以 page 暫存。
   改成：`urlPatterns.qa-en`（`lang: en`）建成 `faq`、`sourceLang: en`、記 `needs-source-zh`，不給 tasks 與 structured（關鍵字是中文的），建議動作上線前檢視。
   為什麼比較好：新站以中文為正本、英文掛在中文題的 `i18n.en`（治理規則 18）；英文頁的正確去處是「找到對應中文題、把英文答案掛上去」，草稿先建成 faq 讓 Steward 有東西比對（3 題中 2 題新站已有中文題與英文翻譯）。

**第八批驗證了什麼**：跨批重複（兩頁、15 題）全部略過且不影響清單比對；兩種鬆散排版各拆對 3 題；年度 Q&A 三題全部標出過期；tasks 候選九成對；`structured` 候選 8 題可供確認；一級內容全部走人工確認。**還沒做的**：跨批重複只對 Q&A 啟用（新聞欄目與疾病專題的新聞頁重疊待第六批重跑時開）；同批重複以檔名順序決定「誰先轉出」（水痘頁的題被排在前面的預防接種頁先轉出），理想是疾病專題頁優先；關鍵字表要用真實題目校準；`structured` 的鍵名（`weeks`、`ageYears`…）與既有人工填的欄位（`intervalWeeksMin`、`minAgeMonths`）還沒統一。

### 10.9 國際旅遊與健康第九批結果（資料產生頁、新站路徑去處）

> 第九批換第三種形狀：這個欄目在新站**大部分不是內容，是功能與資料**。舊站「國際旅遊處方箋」讓民眾選國家看當地疫情、建議疫苗（246 個國家／地區各一頁），新站對應的是 `/travel/{ISO2}/` 目的地頁——由每日抓的旅遊疫情等級快照與疾病主檔**自動產生**（ARCHITECTURE 12），沒有任何一筆內容可以當清單的 `target`。旅遊醫學門診、黃皮書在新站已是 `service`，等級表已是 `dataset`，宣導影片已是 `media`。模擬匯出 `scripts/lib/legacy-import/sim-export-travel.mjs` 反推 19 頁（列表 4、查詢頁 1（含 231 國下拉）、國家結果頁 6、內容頁 8），另原樣複製第八批的「國際旅遊常見問答」頁 1 頁。移轉清單 `content/migration/travel.json`（欄目範圍）19 筆。這批由兩個模型分工：一個寫模擬匯出與清單，一個改轉換器；分工的邊界是「檔案」——各自只碰自己的檔，共用的是這份規格。

| 項目 | 結果 |
| --- | --- |
| 匯出頁數／草稿 | 20 / 13（頁面 8、服務 2、資料集 1、影音 1、併入疾病頁 1；資料產生頁 6 頁不出草稿） |
| 建議動作 | **資料產生頁 6**（`skip-generated`，國家結果頁 → `/travel/{ISO2}/`）、略過列表頁 4、比對既有 4（旅醫門診、黃皮書 service、等級表 dataset、影片 media）、上線前檢視 4（查詢頁、行前、返國、國際預防接種及藥物）、併入疾病頁 1（瘧疾用藥 → `prevention`）、別批已轉過 1（旅遊 Q&A，家批 `qa`） |
| 既有內容可比對 | 5 / 13（既有 service 2、dataset 1、media 1、disease 1） |
| 平均信心／需人工檢視 | 0.92／0（列表頁 0.6） |
| 草稿 schema 驗證 | 13 / 13 |
| 移轉清單 | 19 筆對上 19，無衝突；11 筆以 `newPath` 指到新站路徑（`/travel/`、`/travel/{ISO2}/`、`/news/`），仍待移轉 3（行前、返國、國際預防接種及藥物） |
| 問題 | warn 4：`dynamic-form` 1、`fields-pending` 3（兩個 service 的申辦步驟與資料集欄位佔位）；info 35（含 `generated-page` 6、`vaccine-not-in-master` 1、`converted-elsewhere` 1）；錯誤 0 |

**第九批新增的處理經驗（原本怎樣 → 改成怎樣 → 為什麼比較好）**：

1. **新站由資料產生的頁，不轉內文，記對應路徑。**
   原本：每個舊頁都要轉成一份草稿；國家頁會變成 246 份 `page` 草稿，內容卻是新站每天從官方資料自動產生的東西，一上線就過時，還會跟目的地頁重複。
   改成：規則檔的 URL 模式可以標 `kind: generated` 並帶 `newPath`（`/travel/{ISO2}/`）；轉換器從網址 query（`?iso=JP`）、標題或麵包屑用國家主檔判出 ISO2，記 `generated-page`，**不出草稿**，建議動作 `skip-generated`，舊頁轉成的 Markdown 存在 `reference/{key}.md` 供承辦人比對（舊衛教文字裡有沒有新站快照沒有的資訊，例如黃皮書入境要求）；判不出國家才退回一般 page 草稿並記 `country-unknown`。
   為什麼比較好：資料驅動的頁只有一個正本——資料；把資料另抄一份成內容，等於製造第二個會過時的來源。清單記下「這頁對應 `/travel/JP/`」就足以讓舊網址 301、讓承辦人知道去處；對照檔保留舊內文的價值而不污染新站。

2. **移轉清單的去處可以是「新站路徑」，不只「內容 id」。**
   原本：清單項目的 `status: migrated` 必填 `target`（內容 id），對應到系統產生的頁或功能（`/travel/`、`/travel/JP/`、`/documents/`、`/faq/`）只能寫 `dropped` 加註解；而 `dropped` 在三種伺服器轉址檔是 **410**，欄目根頁「國際旅遊與健康」這種大家都收藏的網址會回「已移除」。
   改成：清單項目新增 `newPath`（新站路徑），`migrated`／`merged` 二擇一填 `target` 或 `newPath`；轉址檔、`v1/redirects.json`、`legacy-map.json`、404 分析都把 `newPath` 當 301 去處；轉換器的 `migration-patch.json` 對資料產生頁提議 `migrated` ＋ `newPath`，`--apply-migration` 會寫回。第七批、第八批的列表頁一併改成 `newPath`（`/documents/`、`/faq/`），不再 410。
   為什麼比較好：`dropped`＝刻意移除，列表頁與功能頁不是被移除、是搬到系統產生的頁；用對的狀態，搜尋引擎與民眾都得到正確答案。這條在測試裡被抓到：三種對照檔的測試原本假設「沒有真實網址的 dropped 項」，第九批第一次出現就讓它失敗，正好逼出這個設計缺口。

3. **查詢表單頁只轉說明文字，表單不進內文。**
   原本：「國際旅遊處方箋」查詢頁的 231 個 `<option>` 會被當成內文轉成一長串國名，信心照樣很高。
   改成：內文有 `<form>`／`<select>` 且選項 ≥ 20、表單以外的文字很短 ⇒ 記 `dynamic-form`（warn），表單控制項從 Markdown 移除，只留說明文字；去處由清單的 `newPath` 指到新站的功能頁（`/travel/` 查目的地）。
   為什麼比較好：表單是功能，不是內容；新站已有「查目的地」。把 231 國名轉進內文不但沒用，還會讓全文搜尋與 AI 問答被雜訊干擾。

4. **不綁疾病的主題頁也有「家」批次。**
   原本：第八批的跨批重複只認「所屬疾病的批次」為家，不綁疾病的頁（旅遊 Q&A）在常見問答批與國際旅遊批各轉一次。
   改成：規則檔 `homeBatches` 依頁型指定家批（Q&A → `qa`、新聞 → `news`、文件 → `guidelines`）；沒有疾病時用它判斷，本批永遠不讓給自己。目前只對 Q&A 啟用。
   為什麼比較好：欄目之間本來就會互相引用同一頁；誰是「家」要有明確規則，否則重跑順序會決定結果。

5. **小節提到主檔沒有的疫苗，點名出來。**
   原本：「國際預防接種及藥物」頁的黃熱病、流行性腦脊髓膜炎、傷寒疫苗小節整頁轉成 `page`，沒人知道這些疫苗在新站沒有頁。
   改成：掃 h2–h4 小節標題裡的疫苗名稱，比對疫苗主檔（含 `content/vaccines/`），沒有的記 `vaccine-not-in-master`（info）並列在草稿的 `conversion.vaccineCandidates`；通稱（「建議疫苗」「其他建議疫苗」）不算。
   為什麼比較好：疫苗是一級內容、有自己的型別與治理（公費／自費、接種時程）；旅遊疫苗若只藏在一頁內文裡，答案引擎與疫苗專區都找不到。先點名、再由檢疫組決定建主檔，比上線後才發現少了黃熱病疫苗頁好。

6. **旅遊醫學樹底下以疾病為題的頁，併入疾病頁。**
   原本：`mergeScopes` 只有「疾病介紹」「預防接種」，「瘧疾預防用藥」在旅遊醫學樹下會變成獨立 `page`。
   改成：`mergeScopes` 加「旅遊醫學」，標題有疾病名且小節對到區塊關鍵字就併入（瘧疾 → `prevention`：出國前服藥是化學預防，對象是尚未感染的旅客）。
   為什麼比較好：瘧疾頁才是民眾與 AI 找「瘧疾預防用藥」的地方；同一主題散在兩頁會互相過時。

**第九批驗證了什麼**：資料產生頁六頁全部判出國家、不出草稿、清單提議 `migrated` ＋ `newPath`；查詢頁的表單被移除；旅醫門診與黃皮書對到既有 service、等級表對到 dataset、影片對到 media；瘧疾用藥併入瘧疾頁；旅遊 Q&A 頁判為第八批已轉過；三種轉址檔不再把欄目根頁寫成 410。**還沒做的**：`/TravelEpidemic/Prescription/` 是推測的網址模式，正式匯出以真實為準；黃熱病、流腦、傷寒疫苗要先建主檔；「出國前／返國後注意事項」兩頁的文字與新站目的地頁「旅程三階段」的規則文字重疊，要由檢疫組決定建 topic 或併入模板文字；`homeBatches` 對新聞、文件尚未啟用。

### 10.10 宣導素材第十批結果（型別由欄目位置決定、圖片承載內容、多語附件）

> 第十批是**彙整型欄目**：舊站「宣導素材」把各疾病的海報、單張、手冊、影片、動畫、廣播收在一棵樹下，再加多國語言衛教素材、數位學習課程、商業媒體運用一覽表、1922 防疫達人社群入口。新站沒有「宣導素材」這種型別：海報／單張／手冊是 `publication`，影片／動畫／廣播是 `media`，多語素材總表是既有的 `dataset.health-education-materials`，列表由系統產生。所以這批的問題不是「轉成什麼」，而是**沒有清單告訴你型別時，怎麼從欄目位置判出型別**；以及素材特有的三件事：文字在圖裡、同一份素材有七種語言檔、素材比依據的指引舊。模擬匯出 `scripts/lib/legacy-import/sim-export-materials.mjs` 反推 21 頁（列表 6、多國語言衛教素材／商業媒體一覽表／數位學習 3、海報與單張 6、手冊 1、影片／動畫／廣播 4、社群入口 1），另原樣複製結核病批的三頁宣導素材（同網址，測跨批重複）。移轉清單 `content/migration/materials.json`（欄目範圍）21 筆。仍由兩個模型分工：一個寫模擬匯出與清單，一個改轉換器，各自只碰自己的檔。

| 項目 | 結果 |
| --- | --- |
| 匯出頁數／草稿 | 24 / 21（出版品 7、影音 4、資料集 1、頁面 9（含列表頁 6）；結核病批已轉過的 3 頁不出草稿） |
| 建議動作 | 上線前檢視 8（海報與單張 4、懶人包 1、狂犬病影片 1、商業媒體一覽表、數位學習、1922 社群 3 頁的 page）、比對既有 5（三支影音、長照手冊 publication、多語素材總表 dataset）、略過列表頁 6、**別批已轉過 3**（結核病批的七語海報與兩支影片，`skip-duplicate`）、久遠封存 2（2019 麻疹海報、2021 防疫新生活海報） |
| 既有內容可比對 | 5 / 21（既有 media 3、publication 1、dataset 1） |
| 平均信心／需人工檢視 | 0.83／3（都是內文只有連結的列表頁 0.4） |
| 草稿 schema 驗證 | 21 / 21 |
| 移轉清單 | 21 筆對上 21，無衝突；6 筆列表頁以 `newPath` 指到 `/publications/`、`/media/`；仍待移轉 10（新海報與單張 4、懶人包、狂犬病影片、商業媒體一覽表、數位學習、1922 社群、兩張久遠海報由權責單位決定封存或 dropped） |
| 問題 | warn 27：`image-only` 5、`fields-pending` 8（文字版、文字稿、資料集欄位佔位）、`image-no-alt` 4、`body-short` 8、`material-outdated` 2（流感海報早於 2026-09-15 版抗病毒藥劑規定、2019 麻疹海報早於 2025 版 MMR 建議）；info 75（含 `type-from-category` 7、`owner-from-disease` 9、`lang-variants` 2、`image-gallery` 2、`external-system` 2、`converted-elsewhere` 3）；錯誤 0 |

**第十批新增的處理經驗（原本怎樣 → 改成怎樣 → 為什麼比較好）**：

1. **沒有清單型別時，由欄目位置與標題字樣決定型別。**
   原本：結構化型別（publication、media…）只能由清單 `target` 或模板 `mapTo` 給（第四批 `type-from-manifest`）；宣導素材欄目大多數頁沒有既有內容可當 `target`，會全部變成 `page` 草稿，上線後再由人改型別。
   改成：規則檔 `materialScopes` ＋ `materialRules`：在宣導素材／多媒體樹下，標題或麵包屑有「海報／單張／懶人包」就是 `publication`（poster）、「手冊」是 manual、「影片」「動畫」「廣播」是 `media`（video／animation／podcast）；記 `type-from-category`。清單給的型別永遠優先，所以結核病批那三頁的判定不變。
   為什麼比較好：欄目位置是舊站編輯當年做的分類，是現成的、可靠的訊號；用它比用標題猜或等人工改省一輪。規則寫在規則檔而不是程式裡，公關室看得懂也改得動。

2. **圖片承載唯一資訊的頁，標出來、佔位、不假裝轉好了。**
   原本：海報頁的內文只有一張圖和一句「請見附件」，轉成 Markdown 後幾乎是空的，信心卻可能很高（型別對、owner 對、附件都在）。
   改成：內文有圖、純文字不到 80 字 ⇒ `image-only`（warn）；`abstractMarkdown` 放既有文字、每張圖的 alt 條列與「（待補：海報文字版）」，記 `fields-pending`；舊頁沒有 alt 的圖另記 `image-no-alt`。同頁 ≥ 4 張圖記 `image-gallery`，建成一筆、多個 image 資產，不拆成多筆。
   為什麼比較好：新站的規則是「圖片不承載唯一資訊」（可及性，ARCHITECTURE 7.7）：海報的文字必須另有純文字版，AI 問答也只能引用文字。轉換器不做 OCR（圖裡的字不可靠，也不是正本），只能把缺口標出來，讓製作單位從設計稿提供文字；warn 會把信心壓下來，這些頁本來就該由人看。

3. **同一份素材的七語檔案是一筆內容，不是七筆。**
   原本：附件只是附件；七個 PDF 的語言差異只在 label 裡，`languages` 一律只有 zh-TW。
   改成：由附件 label／檔名判語言（英、日、越、印、泰、菲、中），非中文的語言在草稿 `languages[lang]` 標 `pending`，記 `lang-variants`；簡體中文不在站上七語，只記 note。
   為什麼比較好：多語狀態是治理欄位（14.2）：`pending` 讓多語稽核看得到「檔有了、標題與摘要還沒翻」，也讓 `/media/`、`/publications/` 的語言篩選有東西可篩；拆成七筆會讓同一張海報在新站出現七次。

4. **素材比依據的指引舊，先標。**
   原本：轉換只確認「搬得對不對」（第 12 節）；影音過時要等上線後治理引擎 R9 才會發現。
   改成：同疾病的已發布文件依家族分版次；素材發布日落在「舊版生效 ≤ 素材日 < 新版生效」之間 ⇒ 素材是依舊版做的、正本已修訂 ⇒ `material-outdated`（warn，訊息寫出當時依據的版本與取代它的版本），草稿 `basedOn` 填疾病頁＋現行新版。只有一版的文件、或素材早於家族第一版（當時沒有正本可依）都不算——那是「久遠」（`old-content`），不是「依據已修訂」。
   為什麼比較好：第一版寫成「早於同疾病任何文件的最新生效日」，結果近年的素材幾乎全部中（流感 2026-09-01 的海報也中），warn 太多等於沒有 warn；改成「當時依據的版本後來被取代」才是 R9 的語意，一條規則在上線前擋，比上線後再退白名單便宜。這仍然是機械式判斷（日期比較），不是判斷內容對不對。

5. **外部系統的入口頁不是內容。**
   原本：數位學習課程、1922 防疫達人這類頁只有幾句話和兩個站外連結，會轉成 `page` 草稿，上線後是一頁幾乎空白的內容。
   改成：純文字 < 200 字、沒有站內連結、有站外連結 ⇒ `external-system`（info）列出網域；仍出 page 草稿但建議在 `/services/` 放入口或清單決定 `dropped`。
   為什麼比較好：入口是導覽，不是內容；標出來讓公關室一次決定放哪裡，而不是每頁各自審。

6. **跨批重複從 Q&A 擴到素材頁。**
   原本：`converted-elsewhere` 只對 Q&A 頁啟用（第八、九批）。
   改成：materialRules 命中且有疾病的素材頁也算：家批＝疾病批；結核病批已轉過的三頁宣導素材在這批判為 `skip-duplicate`。
   為什麼比較好：彙整型欄目本來就是別處內容的再列一次；疾病批的草稿才是正本，這批只該補疾病批沒有的頁（跨疾病的多語總表、手冊、社群入口）。

7. **放規則時發現：權責單位的「最長命中優先」從來沒有生效。**
   原本：`ownerForCategory` 比較的是 `best.rule.match.length`，`best.rule` 是字串，`.match` 是 `String.prototype.match`，`.length` 恆為 1，所以實際語意是「後面命中的規則覆蓋前面」；結核病的「通報定義」頁因此被排在後面的「結核病／通報」搶走，owner 變成疫情中心，與既有 `doc.tb-case-definition` 的慢性組不一致。
   改成：比較 `best.rule.length`（最長命中優先，規則檔的註解本來就這麼寫）；新加的「宣導素材」「多媒體」規則因此可以放在任何位置。另加 `preferDiseaseFor: ["material"]`：欄目歸公關室，但有疾病的素材權責回到疾病業務組（與第六批致醫界通函同一機制）。
   為什麼比較好：靠「規則順序」才對的規則檔，下一個人加一條就壞；最長命中讓「結核病／宣導素材」永遠贏「宣導素材」，不必記順序。這個 bug 是第十批加規則時第一次被踩到——回歸比對 409 頁只改了那一頁的 owner，而且改對了。

**第十批驗證了什麼**：七頁沒有清單型別的素材全部由欄目位置判出 publication／media（海報、單張、懶人包、手冊 → poster／manual；影片、動畫、廣播 → video／animation／podcast）；五頁只有圖的海報與單張記 `image-only`、文字版佔位；七語流感海報一筆內容、六語 `pending`；兩筆素材早於依據正本（且正本確實修訂過）；結核病批的三頁判為已轉過；兩頁外部入口標出網域；有疾病的素材 owner 全部回到疾病業務組。重跑前九批 409 頁，kind／action／outputs 全部不變，只多出新 issue 與一頁 owner 修正（見第 7 點）。**還沒做的**：`/Category/ListContent/{id}?uaid=` 是推測的素材內頁網址模式，正式匯出以真實為準；圖裡的文字沒有 OCR，純文字版要由製作單位提供；多語附件只標 `pending`，i18n 標題與摘要要人翻；商業媒體運用一覽表留 `page`（是否建成 dataset 由公關室決定）；久遠海報（2019 麻疹、2021 防疫新生活）建議封存，清單狀態由權責單位決定。

### 10.11 統計資料第十一批結果（期刊逐期、表格抽時序、入口頁對資料集）

> 第十一批是**資料型欄目**：舊站「統計專區」底下幾乎沒有「內容」，只有三種東西——連到外部系統的入口（傳染病統計資料查詢系統、開放資料平臺、防疫資料庫）、一頁列很多期 PDF 的週報／速訊／年報、幾張年×數值的統計表。新站這些全部是 `dataset`（資料目錄五類資產），統計表還要變成 `series` 才能給統計問答用；統計年報是既有 `publication`；列表頁是 `/data/`。所以這批的問題是**沒有清單型別時，怎麼從內容形狀判出 dataset 的種類**，以及兩個以前沒碰過的形狀：「期別」（不是版次）和「表格裡的時序」。模擬匯出 `scripts/lib/legacy-import/sim-export-statistics.mjs` 反推 13 頁（列表 2（含英文站）、入口 3、期刊 4、統計表 3、年報 1；缺期與停更的缺陷樣本都在裡面），另原樣複製結核病批與登革熱批的「統計資料」頁（同網址，測跨批重複）。移轉清單 `content/migration/statistics.json`（欄目範圍）13 筆。仍由兩個模型分工，各自只碰自己的檔。

| 項目 | 結果 |
| --- | --- |
| 匯出頁數／草稿 | 15 頁 → 13 份草稿（資料集 8、頁面 4、出版品 1）；2 頁是結核病批與登革熱批同網址的統計頁，`skip-duplicate` 不重複出 |
| 建議動作 | compare-existing 5、review-before-publish 6、skip-list 2、skip-duplicate 2 |
| 既有內容可比對 | 5（`dataset.nidss`、`dataset.flu-express`、`dataset.covid-severe-weekly`、`dataset.vaccine-coverage`、`publication.statistics-annual-2025`） |
| 平均信心／需人工檢視 | 0.95／0（兩頁列表頁 0.6，其餘 1） |
| 草稿 schema 驗證 | 13／13 通過 |
| 移轉清單 | 對上 13／13；status 變化 0、與清單判定不同 0；仍待移轉 5（開放資料平臺入口、疫情監測速訊、腸病毒週報、境外移入統計、死亡統計）；清單沒有的舊頁 2（就是上面兩頁重複頁） |
| 問題 | 錯誤 0、警告 5（`series-gaps` 1、`stats-stale` 1、`fields-pending` 3）、提示 51（`periodical-issues` 5、`series-extracted` 3、`dataset-by-url` 6、`external-system` 4、`type-from-category` 4…） |

**第十一批新增的處理經驗（原本怎樣 → 改成怎樣 → 為什麼比較好）**：

1. **期別不是版次：週報頁建成一筆資料集，逐期列檔。**
   原本：第七批的文件版次鏈會把附件標籤裡的「2026 年」「第 N」當版次，一頁八期的「疫情監測速訊」會變成一份現行版加七份「失效版本」草稿；或者沒有清單型別時變成一頁 `page`，八個 PDF 只是附件。
   改成：附件 label／檔名 ≥ 3 個符合期別寫法（YYYY 年第 N 週、第 N 期、YYYY 年 M 月、YYYY 年；民國年轉西元）⇒ `periodical-issues`，建成一筆 `dataset`（`document-library`），每期一筆 `resources`（降冪）、`updateFrequency` 由期別粒度、`lastUpdated` 取最新一期；**在版次鏈之前判掉**。
   為什麼比較好：第 40 週不會「取代」第 39 週——每期都是紀錄，不是文件的新版本；用版次鏈會把歷史期數標成「失效」，搜尋與 AI 問答就找不到舊期。一筆資料集加逐期資源，正好是資料目錄「文件庫」這一類的定義。

2. **表格裡的年×數值，抽成 `series`。**
   原本：統計表轉成 Markdown 表格就結束；統計問答只認 `data/snapshots` 與人工填的 `series`，舊站幾十張統計表一張都用不到。
   改成：第一欄是年（西元或民國）／年月／年週、有一欄全是數字 ⇒ `series`（`label`、`unit`（%／人／例）、`granularity`、`points[{t,v}]`），記 `series-extracted`；合計列略過；多個數值欄只取第一個、其餘寫在 `note`；缺期或重複 ⇒ `series-gaps`（warn）；最新一點比現在舊兩期以上 ⇒ `stats-stale`（warn）。
   為什麼比較好：表格是給人看的，`series` 是給機器算的——同一份數字兩種形狀，統計問答才能回答「2024 年境外移入幾例」並附正本連結。缺期與過時的檢查是機械式的（日期比較），不判斷數字對不對，但能在上線前把「這張表三年沒更新」點出來。

3. **入口頁對資料集，用網址對、不用標題對。**
   原本：「傳染病統計資料查詢系統」「防疫資料庫」這類頁只有幾句話和一個站外連結，第十批會記 `external-system` 然後留成 `page`；要靠清單人工填 target。
   改成：站外連結的 host 對到既有 dataset 的 `canonicalUrl`／`portalUrl` host ⇒ 草稿直接用該 dataset id（既有 ⇒ `compare-existing`），記 `dataset-by-url`；多筆命中取 canonicalUrl 完全相等者。開放資料平臺首頁對到幾十筆 open-dataset，取不到唯一 ⇒ 清單決定 `newPath: /data/`。
   為什麼比較好：入口頁的「身分」就是它連到哪裡；標題會改、網址不會。資料目錄本來就以 canonicalUrl 為正本位置（唯一），拿它當鍵是順理成章的。

4. **英文站的列表頁也不轉。**
   原本：`/En/Category/List/…` 沒有 URL 模式，會記 `type-unclear`、變成 `page` 草稿。
   改成：`category-list-en` 模式（`kind: list`、`lang: en`）⇒ `skip-list`，草稿帶 `sourceLang: en`；清單 `newPath` 指到 `/en/data/`。
   為什麼比較好：新站七語的列表都由系統產生；英文列表跟中文列表是同一件事，差在路徑前綴。

5. **幾個入口頁連到同一個系統：資料集只留一筆，其餘入口頁走 `newPath`。**
   原本：「傳染病統計資料查詢系統」和「防疫資料庫」清單都填 `target: dataset.nidss`，第二頁會被判 `target-shared`、另出一筆 `dataset.x-nidss-…`，新站多一筆重複資料集。
   改成：防疫資料庫是入口頁（同時連統計查詢系統與開放資料平臺），清單改成 `status: migrated` ＋ `newPath: /data/`、不填 target；轉換器把 `external-system` 記到 `pr.flags.externalSystem`，清單填了 `newPath` 的入口頁視為與工具判定一致（跟清單頁、資料產生頁、查詢表單同一條規則），不再列「與清單判定不同」。
   為什麼比較好：一個系統在資料目錄只該有一筆；入口頁的去處是「資料目錄」這個頁面，不是某一筆資料集。這跟第九批列表頁用 `newPath` 的道理一樣：新站沒有對應「內容」、但有對應「去處」時，清單寫去處。

6. **清單指到既有資料集時，`canonicalUrl` 沿用既有那筆。**
   原本：「常規疫苗接種完成率」頁只放 PDF、沒有開放資料連結，草稿 `canonicalUrl` 留「（待補）」，雖然清單早已指到 `dataset.vaccine-coverage`。
   改成：草稿 id 就是既有 dataset、且 `canonicalUrl` 待補 ⇒ 沿用既有那筆的 `canonicalUrl`／`portalUrl`，記 `dataset-by-url`「沿用既有資料集（清單 target 指定）」。
   為什麼比較好：既有內容已經寫了正本位置，草稿再要人補一次是重複工；`compare-existing` 的比對也才看得到真正差的欄位（數字、期數），不是被「（待補）」干擾。

7. **疾管署子網域也算「外部系統」，但只在統計頁。**
   原本：第十批 `externalSystemPage` 把所有 `*.cdc.gov.tw` 當站內，所以「傳染病統計資料查詢系統」（nidss.cdc.gov.tw）會被當成一般內頁。
   改成：統計頁用 `systemEntryHosts`：只有 `www.cdc.gov.tw` 與相對路徑算站內，`nidss.`／`data.`／`antiflu.` 等子網域算系統入口；宣導素材頁維持原判，第十批輸出一字不變。
   為什麼比較好：舊站的「統計專區」本來就是一堆系統的門口；把子網域當站內會讓這些頁全部變成空 `page`。限定在統計頁是因為素材頁連到 `*.cdc.gov.tw` 多半是連到別的素材頁，兩種欄目的「站內」意思不同。

**順帶的改變**：前十批已經轉成 `dataset` 的疾病統計頁（登革熱本土週報、麻疹年統計、各疾病 `*-stats`…共 13 筆）這次重跑都多了 `series`（表格裡的年×病例數），`series-extracted` 提示各一則；kind／action／owner／輸出 id 全部不變（433 頁回歸 0 差異）。

**第十一批驗證了什麼**：期刊頁與版次鏈的先後順序（年報是 publication，期別只記提示不拆鏈；週報／速訊建一筆 dataset 逐期列）；表格抽 `series` 含民國年、合計列、多數值欄；缺期（死亡統計缺 2019、COVID 週報缺 W39 只記在提示）與停更（死亡統計到 2022 ⇒ `stats-stale`）；入口頁用 host 對到 `dataset.nidss`／`dataset.flu-express`、開放資料平臺首頁 19 筆命中判不出 ⇒ 維持 page；英文列表頁 `skip-list` ＋ `sourceLang: en`；兩頁跨批重複頁不重出；前十批 433 頁 kind／action／owner／輸出不變。**還沒做的**：PDF 裡的統計表不抽（正本是開放資料）；`series` 只取第一個數值欄，多指標的表要人工拆成多筆 dataset 或多個 series；期別的日期是依期號推的（ISO 週一），正式匯出若附件有發布日就用發布日；開放資料平臺首頁對不到唯一資料集，入口頁一律走清單 `newPath`。


### 10.12 正式內容移除後，歷史批次怎麼保持可重現（第二十輪）

> 起因：Yulun 決定以真的 2026 年 2 月版登革熱/屈公病防治工作指引取代原型虛構的第 15～17 版。虛構文件與宣布它們的兩則通函從 `content/` 移除後，登革熱批次、第六批新聞、第七批指引的模擬匯出與匯入測試全部對不上，因為模擬匯出與比對都讀「現在的」`content/`。

- **做法**：被移除、但 2026-10-03 匯出當時存在的檔案，連同當時的移轉清單，放進 `data/legacy-export/_retired/`（目錄結構同 `content/`）。模擬匯出（`sim-export-disease／guidelines／news／qa.mjs`）讀「`content/`＋`_retired/`，依檔名排序，排除有 `derivedFrom` 的 PDF 轉入文件」；批次測試用同樣方式組一份快照內容目錄傳給 `runImport({ contentDir })`。已提交的匯出、草稿與報告一個字都不用改。
- **為什麼比較好**：另外兩種做法都不好——(1) 留著虛構文件不刪，會讓正式內容裡有兩份同名、互相矛盾的指引，答案引擎會答錯；(2) 重跑所有歷史批次，會把「當時轉換器怎麼判斷」的紀錄改掉，測試也失去意義。歷史批次是**對某一天的內容跑的**，就應該讀那一天的內容；`_retired/` 把「那一天」明確保存下來，而且一看就知道哪些東西已經不在正式站。
- **正式環境的對應**：真實的舊站匯出是一次性的檔案，不會隨新站內容變；這個問題只發生在原型「從新站內容反推舊站」的模擬上。

### 10.13 傳染病核心教材第十二批結果（第二十八輪，Issue #38）

> **這批是示範。** 開發環境連不到 www.cdc.gov.tw，教材 PDF 一份都沒拿到。模擬匯出 `scripts/lib/legacy-import/sim-export-curriculum.mjs`（`_export.json` 標 `simulated: true`，README 逐頁寫依據）合成 5 頁：列表頁 1 頁（`/Category/List/`）＋登革熱、麻疹、新型A型流感、鼠疫的教材頁各 1 頁（`/Category/DiseaseTeach/`，內文只有 PDF 下載連結）。教材名稱與附件檔名取自公開搜尋摘錄（未查證）；頁面網址 ID 是示意值，唯一寫死的是搜尋結果出現過的麻疹教材 PDF 網址 `https://www.cdc.gov.tw/File/Get/eH0KllYdi__tvUdV8al0lA`。移轉清單 `content/migration/core-curriculum.json` 5 筆，全部 `verified: false`。
>
> 重跑：`node scripts/lib/legacy-import/sim-export-curriculum.mjs` → `node scripts/import-legacy.mjs data/legacy-export/core-curriculum --out data/legacy-import/core-curriculum --now 2026-10-10T03:00:00Z --apply-migration`。

| 項目 | 結果 |
| --- | --- |
| 匯出頁數／草稿 | 5 / 5（文件 4，全是 `docType: curriculum`；頁面 1 是列表頁的比對用草稿） |
| 建議動作 | 比對既有 2（登革熱、麻疹 → 新站已有的示範匯入版）、上線前檢視 2（新型A型流感、鼠疫）、略過列表頁 1 |
| 平均信心／需人工檢視 | 0.72／1（列表頁，內文過短） |
| 草稿 schema 驗證 | 5 / 5 |
| 移轉清單 | 5 筆對上 5，無衝突；套用後只改 note（5 筆）；仍待移轉 2（新型A型流感、鼠疫，權責單位新興傳染病整備組） |
| 問題 | 錯誤 0；warn 14（`fields-pending` 4、`pdf-only` 4、`body-short` 5、`date-missing` 1）；info 21（含 `doctype-from-title` 4） |

**第十二批新增的處理經驗（原本怎樣 → 改成怎樣 → 為什麼比較好）**：

1. **標題寫明「核心教材」時，文件種類以標題為準，蓋過網址模式。**
   原本：`disease-docs` 模式把 `/Category/DiseaseTeach/` 一律判成 `guideline`（第七批的假設：Teach＝指引）。但搜尋到的舊站結構顯示 DiseaseTeach 底下放的是各疾病的**核心教材**，與 DiseaseDefine（病例定義）、DiseaseManual（工作手冊）並列；教材若被判成指引，會跟現行指引搶「現行版」、被答案引擎當成規定引用。
   改成：規則檔第 11 版新增 `docTypeStrongKeywords`（目前只有「核心教材」→ `curriculum`），在 `docTypeFor` 裡**先於**網址模式比對；命中且與網址模式判斷不同時記 `doctype-from-title`（info），把「原本會判成什麼」寫出來給 Steward 看。
   為什麼比較好：網址是**容器**（同一個欄目可以放不同種文件），標題才是**這份東西自己說自己是什麼**。強關鍵字只放不會誤中的長詞，所以第七批的 DiseaseTeach 頁（「人口密集機構感染管制措施指引」）仍是 `guideline`，前十一批的輸出一個字都沒變（10.7 節「矩陣網址會蓋過標題」的問題，對教材這一類已解決；`form` 仍未處理）。

2. **schema 要的教學欄位，舊頁看不出來就佔位，不替權責單位編。**
   原本：`curriculum` 必填 `learningObjectives`、`roles`、`diseases`，舊頁只有一個下載連結，什麼都看不出來。
   改成：草稿的 `learningObjectives` 寫「（待補：學習目標，請依教材 PDF 填寫）」、`roles` 暫填規則檔的 `curriculum.defaultRoles`、`curriculum.chapterPlan: provisional`，並記 `fields-pending`（warn）；認不出疾病時記 `curriculum-no-disease`（error，schema 也會擋）。
   為什麼比較好：草稿能過 schema、進後台檢視，但每個猜的欄位都有一條看得到的待辦。學習目標是教材的核心，寧可空著也不能由轉換器寫一份「看起來很像」的。

3. **教材家族一律叫 `doc.curriculum-{疾病}`。**
   原本：沒有清單 target 的文件，家族由網址雜湊或清單 key 決定（新型A型流感會變成 `doc.novel-influenza-a-novel-influenza-a`）。
   改成：`curriculum` 一病一個家族 `doc.curriculum-{short}`，與新站已有的 `doc.curriculum-dengue`、`doc.curriculum-measles` 同一套命名。
   為什麼比較好：之後拿到 PDF 正本轉檔時，新版落在同一個家族，版次鏈與「現行版」判定自然接上；同事看 id 就知道是哪一種病的教材。

4. **轉換器只搬「舊頁有的東西」；示範內容是另一支工具做的，而且會被刪掉。**
   這批的草稿 `machineReadableMarkdown` 都是 pdf-only 佔位——正本在 PDF，第 8 節「PDF 不整批轉」照舊。新站上看得到的兩份教材（`doc.curriculum-dengue.2026-10-10`、`doc.curriculum-measles.2026-10-10`）是 `scripts/curriculum-to-doc.mjs` 從 `data/curriculum/*.source.json` 產生的**重建版**：每句都有出處（多數是站內已匯入的 2026 年 2 月版登革熱工作指引第幾頁），找不到出處的地方寫（待補），`derivedFrom.sourceKind: reconstructed`、`reviewStatus: machine`（不進白名單、來源卡標「尚未取得 PDF 正本」）。
   拿到 PDF 正本之後：用 `scripts/pdf-to-md.mjs` 轉出同家族的正式版本，**刪除**重建版，不要用 `supersedes` 串在後面。
   為什麼刪而不是取代：重建版不是教材真的某一版；串進版本鏈，文件頁會出現「前版」與「本版異動」，讀者會以為教材改過。第二十輪用真的 2026 年 2 月版工作指引取代虛構的第 15～17 版時也是把虛構版本移出 `content/`，而不是串在真版本前面（10.12 節），同一個理由。

5. **加一份專業內容，可能讓不相干的版本題失敗：每次都要跑 `node scripts/build.mjs --check`。**
   實測：加入登革熱教材後，版本題 V011「登革熱防治工作指引現行版是第幾版？」不再引用工作指引。原因不是教材被引用，而是 BM25 的統計變了——教材原標題「登革熱**防治**核心教材」的 13 個答案單元都帶「熱防」這個詞，讓它在專業索引裡從 15 個單元變成 28 個，這個詞的權重下降，工作指引的附件段落掉出前 10 名。這題本來就很勉強（加教材前，工作指引也只是第 4 個來源）。
   改成：標題用舊站頁面上的寫法「登革熱核心教材」（檔名「…登革熱防治核心教材.pdf」記在 `curriculum.edition`）；出處只寫代號（「出處 A，第 3 頁」），全名放文末來源表（不入索引）；「對照：…」導覽行不進答案單元。評估集回到 213/213。
   為什麼比較好：教材裡大量重複別份文件的全名，等於替那份文件的名字「灌水」，問那份文件的題目反而撈到教材。**沒做的**：引擎對「指名某份文件問版次」的題目沒有特別處理，V011 仍然靠 BM25 的相對分數；正式導入真教材（文字量大很多）前，OASIS 應該補這個機制，而不是一直調內容。

6. **看不到日期就不編日期。** 麻疹教材只知道 PDF 網址，頁面日期不明，側檔就不給 `publishedAt`；轉換器記 `date-missing` 並暫用匯出日，Steward 會看到。新型A型流感的「11401版」只出現在附件檔名，`version` 暫填發布日（`version-unknown`）；檔名寫進 `curriculum.edition`（待確認）。

**還沒做的（給資訊室與權責單位）**：真實匯出（哪些疾病有教材、列表頁是 `/Category/List/` 還是欄目頁 MPage、各頁實際 ID）；各教材的 PDF 正本；教材的版次寫法（「11401版」「1140318」）要不要另寫規則轉成 `version`；整套「傳染病核心教材」系列的統籌單位（legacy-services 暫列預防醫學辦公室）。

## 11. 正式批次的排程建議

1. **一批一個欄目樹**，順序建議：**結核病（已示範）→ 登革熱（第二批，已示範）→ 流感（第三批，已示範）→ 麻疹＋腸病毒（第四批，已示範）→ 其他第一、二類傳染病的疾病頁（第五批：狂犬病、瘧疾、A 型肝炎、德國麻疹、屈公病、M 痘，已示範；其餘第一、二類疾病待建疾病頁後同法處理）→ 新聞稿（近三年；第六批，已示範，無清單、三級處理＋抽樣）→ 指引與手冊（第七批，已示範，版次鏈）→ 常見問答（第八批，已示範，每題一筆＋跨批重複判定）→ 國際旅遊與健康（第九批，已示範，資料產生頁＋ `newPath`）→ 宣導素材（第十批，已示範，型別由欄目位置決定＋圖片承載內容＋多語附件）→ 統計資料（第十一批，已示範，期刊逐期＋表格抽時序＋入口頁對資料集）→ 傳染病核心教材（第十二批，已示範，標題強關鍵字＋教學欄位佔位）→ 其他欄目**。每批對應一份移轉清單，批次結束時清單的 `pending` 應清零或決定 `dropped`。有疾病頁的疾病都能先用 `sim-export-disease.mjs` 產模擬匯出演練規則，再等正式匯出。
2. **每批的節奏**（約 2–3 週）：匯出（資訊室，2–3 天）→ 規則調校與第一輪轉換（OASIS，2–3 天）→ 看報告、補規則、重跑（1–2 天）→ 人工確認（Steward，依量；建議每人每天不超過 10 頁）→ 上架 PR（走車道）→ 更新清單與確認 `verified`。
3. **先小後大**：每批先用 20–30 頁試跑，確認規則沒問題再跑全部。
4. **規則版本化**：規則檔的修改走 PR 並說明影響範圍；報告歸檔（`data/legacy-import/{slug}/`），作為品質稽核與回溯。
5. **抽樣稽核**：二級自動上線的新聞，每批抽 10% 由公關室檢視；若抽樣發現率超過 10%，暫停自動上線，回頭修規則。
6. **與轉址同步**：每批上線前確認該批舊網址的 301 已進伺服器轉址檔（[migration-playbook.md](migration-playbook.md) 第 6 節）。
7. **切換前**不要上線大量未審草稿：草稿一律 `review`，進 `content/` 並改 `published` 才會對外。

---

## 12. 限制

- **模擬匯出不等於真實舊站**：版型、Word 殘留的程度、表格複雜度、圖片與附件的命名，都以真實匯出為準；規則與信心門檻（0.6、0.8）要用真實樣本校準。
- **不處理的內容**：影音嵌入（記 `embedded-media` 警告，影片請走 `media` 型別人工建檔；第十批起宣導素材樹下的影片頁直接建成 `media` 草稿，但文字稿仍是（待補））、表單（動態頁面：第九批起會認出查詢表單並記 `dynamic-form`，但只轉說明文字，功能由新站取代）、站外內容、內部系統頁。英文站（`/En/…`）目前只有問答頁有 URL 模式（`qa-en`，第八批）與新聞稿（typeid 158），其他英文頁會記 `type-unclear`。
- **結構化型別的欄位是佔位，不是答案**：第四批起 publication／media／dataset／labtest／service／clarification 都直接產，但舊頁看不出來的必填欄位（檢體容器與保存、申辦步驟、影片文字稿、資料集更新頻率）以「（待補：…）」填入並記 `fields-pending`，這些草稿**過 schema 不等於可上架**，要由權責單位補齊。還不直接產的：topic（相關連結頁留 list）、vaccine（疫苗專區頁併入疾病頁疫苗區塊或以 page 暫存）、research、banner、job、tender。
- **不判斷內容是否過時**：轉換只確認「搬得對不對」，不確認「內容還對不對」。例外只有機械式可判的「答案寫的期限都已過」（`answer-dated`，第八批）、「素材製作日早於依據正本現行版」（`material-outdated`，第十批）與「統計時序最新一點比現在舊兩期以上」（`stats-stale`，第十一批），其餘過時的規定、數字，要靠 Steward 審閱與治理引擎的反向稽核。
- **不讀 PDF 裡的數字**：週報、年報的 PDF 只列成 `resources`，表格數字只從 HTML 表抽成 `series`；PDF 內的統計表要靠正本（開放資料）而不是轉換器。
- **不讀圖**：海報、單張的文字在圖裡，轉換器不做 OCR；只記 `image-only`、把 alt 當候選、以（待補）佔位。純文字版要由製作單位從原始設計稿提供，不是從圖片反推。
- **不處理個資**：匯出階段就要排除；若轉換後的草稿含個資，通報並從輸出刪除。
- **多對一與一對多**：疾病頁子頁併成同一份疾病頁草稿（多對一）；一個舊頁不會轉成多個頁面，Q&A 頁例外（每題一筆）。
- **英文與其他語言頁**：依 `bulletinTypes` 的 `lang` 標示以英文為來源語言（`sourceLang: en`），需補中文版（[governance-model.md](governance-model.md) 規則 18）；其他語言頁不在本工具範圍。
