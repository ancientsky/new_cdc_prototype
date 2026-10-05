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

另有兩類不需轉換：**清單頁**（`skip-list`，新站的列表由系統依內容自動產生）與**檔案本身**（第 8 節）。

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
| 建議動作 | `manual-review` 人工檢視、`review-before-publish` 上架前確認、`compare-existing` 與既有內容比對、`merge-into-disease` 併入疾病頁區塊、`auto-ok` 抽樣後自動上線、`archive` 封存、`drop` 不轉換、`skip-list` 清單頁不轉 |

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
   改成：舊頁是欄目內頁、而移轉清單說它對應新站的一份 **document** 時，草稿直接建成 document，id 就是清單的 target（`doc.flu-antiviral-eligibility.2026-09-21`、`…2026-06-01`），只記一條提示。清單頁（連結集合）不適用，仍不轉。
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

> 第六批換一種形狀的批次：新聞不是「一頁對一頁」搬，沒有移轉清單，靠第 7 節的三級處理決定每頁的去向。模擬匯出 `scripts/lib/legacy-import/sim-export-news.mjs` 把既有 37 則新聞／通函與 8 則澄清稿反推成舊站 Bulletin 內頁，另合成新站沒有的近年新聞 6 則、超過三年的久遠新聞 6 則（含一則「活動報名」）、英文新聞稿 2 則（typeid 158）與一頁列表頁，共 60 頁 → `data/legacy-import/news/`。

| 項目 | 結果 |
| --- | --- |
| 匯出頁數／草稿 | 60 / 60（新聞 45、**致醫界通函 4**、澄清稿 10、頁面 1） |
| 建議動作 | 比對既有 45、**auto-ok 4**、上線前檢視 4（英文稿 2、內文太短 2）、**封存 5、drop 1**、略過列表頁 1 |
| 二級抽樣名單 | auto-ok 4 × 10% ＝ 1 頁（依網址雜湊固定，重跑不變） |
| 平均信心／需人工檢視 | 0.97／0 |
| 草稿 schema 驗證 | 60 / 60 |
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

## 11. 正式批次的排程建議

1. **一批一個欄目樹**，順序建議：**結核病（已示範）→ 登革熱（第二批，已示範）→ 流感（第三批，已示範）→ 麻疹＋腸病毒（第四批，已示範）→ 其他第一、二類傳染病的疾病頁（第五批：狂犬病、瘧疾、A 型肝炎、德國麻疹、屈公病、M 痘，已示範；其餘第一、二類疾病待建疾病頁後同法處理）→ 新聞稿（近三年；第六批，已示範，無清單、三級處理＋抽樣）→ 指引與手冊 → Q&A → 其他欄目**。每批對應一份移轉清單，批次結束時清單的 `pending` 應清零或決定 `dropped`。有疾病頁的疾病都能先用 `sim-export-disease.mjs` 產模擬匯出演練規則，再等正式匯出。
2. **每批的節奏**（約 2–3 週）：匯出（資訊室，2–3 天）→ 規則調校與第一輪轉換（OASIS，2–3 天）→ 看報告、補規則、重跑（1–2 天）→ 人工確認（Steward，依量；建議每人每天不超過 10 頁）→ 上架 PR（走車道）→ 更新清單與確認 `verified`。
3. **先小後大**：每批先用 20–30 頁試跑，確認規則沒問題再跑全部。
4. **規則版本化**：規則檔的修改走 PR 並說明影響範圍；報告歸檔（`data/legacy-import/{slug}/`），作為品質稽核與回溯。
5. **抽樣稽核**：二級自動上線的新聞，每批抽 10% 由公關室檢視；若抽樣發現率超過 10%，暫停自動上線，回頭修規則。
6. **與轉址同步**：每批上線前確認該批舊網址的 301 已進伺服器轉址檔（[migration-playbook.md](migration-playbook.md) 第 6 節）。
7. **切換前**不要上線大量未審草稿：草稿一律 `review`，進 `content/` 並改 `published` 才會對外。

---

## 12. 限制

- **模擬匯出不等於真實舊站**：版型、Word 殘留的程度、表格複雜度、圖片與附件的命名，都以真實匯出為準；規則與信心門檻（0.6、0.8）要用真實樣本校準。
- **不處理的內容**：影音嵌入（記 `embedded-media` 警告，影片請走 `media` 型別人工建檔）、表單（動態頁面）、站外內容、內部系統頁。英文站（`/En/…`）還沒有 URL 模式，會記 `type-unclear`。
- **結構化型別的欄位是佔位，不是答案**：第四批起 publication／media／dataset／labtest／service／clarification 都直接產，但舊頁看不出來的必填欄位（檢體容器與保存、申辦步驟、影片文字稿、資料集更新頻率）以「（待補：…）」填入並記 `fields-pending`，這些草稿**過 schema 不等於可上架**，要由權責單位補齊。還不直接產的：topic（相關連結頁留 list）、vaccine（疫苗專區頁併入疾病頁疫苗區塊或以 page 暫存）、research、banner、job、tender。
- **不判斷內容是否過時**：轉換只確認「搬得對不對」，不確認「內容還對不對」。過時的規定、數字，要靠 Steward 審閱與治理引擎的反向稽核。
- **不處理個資**：匯出階段就要排除；若轉換後的草稿含個資，通報並從輸出刪除。
- **多對一與一對多**：疾病頁子頁併成同一份疾病頁草稿（多對一）；一個舊頁不會轉成多個頁面，Q&A 頁例外（每題一筆）。
- **英文與其他語言頁**：依 `bulletinTypes` 的 `lang` 標示以英文為來源語言（`sourceLang: en`），需補中文版（[governance-model.md](governance-model.md) 規則 18）；其他語言頁不在本工具範圍。
