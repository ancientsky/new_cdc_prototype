# 舊站匯出批次轉換

> 給誰看：資訊室（做匯出）、OASIS（維護規則、彙整報告）、各組 Steward（逐頁確認草稿）、公關室（近年新聞的抽樣檢視）。
> 依據：[ARCHITECTURE.md](../ARCHITECTURE.md) §17.3；規劃文件〈盤點、規格與路線圖〉§5.2、§7.4、§8.2。接續 [migration-playbook.md](migration-playbook.md)（舊網址怎麼對、怎麼轉址），本文處理的是**舊頁的內容本身怎麼進新站**。
> 一句話：**資訊室把舊站內容匯出成約定格式，`import-legacy` 一次轉成內容草稿與一份誠實的報告；機器做體力活並標出信心，人只看有疑慮的。**

目錄：0 為什麼需要・1 流程總覽・2 匯出格式規格・3 規則檔怎麼寫・4 怎麼跑・5 轉換做了什麼・6 信心分級與人工檢視・7 三級處理・8 PDF 不整批轉・9 報告怎麼看・10 結核病首批結果・11 正式批次的排程建議・12 限制

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
| `categoryOwners` | **類別 → 權責單位**，最長前綴優先 | `結核病／檢驗` → `unit.lab`；`結核病／防治政策` → `unit.chronic-infectious` |
| `defaultOwner` | 類別沒對到時的暫填單位（並記 `unmapped-category` 警告） | `unit.oasis` |
| `diseases` | **疾病名 → 疾病 id**，加上主檔別名 | `disease.tuberculosis`：結核病、肺結核、潛伏結核感染、LTBI… |
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
| `--manifest <file>` | 對照的移轉清單；預設 `content/migration/{slug}.json` |
| `--slug <name>` | 批次名稱（決定預設清單檔名）；預設為匯出目錄名，例：匯出目錄 `data/legacy-export/tuberculosis` ⇒ `tuberculosis` |
| `--now <ISO>` | 轉換時間（`convertedAt`）；預設現在。要產生可重現的輸出（測試、比對）時固定它 |

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
4. **型別與目標**：URL 模式決定型別；疾病頁子頁依標題關鍵字**併入**疾病頁對應區塊（八個固定區塊）；Q&A 頁依 `.panel` 結構**每題一筆**；Bulletin 依 `typeid` 決定 `newsType`；檔案說明頁建文件草稿。對得到既有新站內容者，草稿標「既有內容已存在，供比對」（`conversion.existing`、`compareWith`）。
5. **權責單位與疾病**：類別→單位；標題與麵包屑→疾病 id（用主檔別名比對）。
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
| `not-in-manifest` | warn | 移轉清單裡找不到這個舊頁 | 在清單新增一筆 pending 項目 |
| `old-content`／`historical-version` | info | 久遠內容／歷史版本 | 依第 7 節三級封存 |

**`migration-patch.json`**：把移轉清單對應項目的 `status`（`pending` → `migrated`／`merged`／`archived`／`dropped`）與 `target` 的更新建議列出來。加 `--apply-migration` 才寫回，**只改 `status`／`target`／`note`，不動 `verified`**：逐筆確認仍由權責單位在 `/admin/migration/` 完成，轉換成功不等於確認過。

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

## 11. 正式批次的排程建議

1. **一批一個欄目樹**，順序建議：**結核病（已示範）→ 其他第一、二類傳染病的疾病頁 → 新聞稿（近三年）→ 指引與手冊 → Q&A → 其他欄目**。每批對應一份移轉清單，批次結束時清單的 `pending` 應清零或決定 `dropped`。
2. **每批的節奏**（約 2–3 週）：匯出（資訊室，2–3 天）→ 規則調校與第一輪轉換（OASIS，2–3 天）→ 看報告、補規則、重跑（1–2 天）→ 人工確認（Steward，依量；建議每人每天不超過 10 頁）→ 上架 PR（走車道）→ 更新清單與確認 `verified`。
3. **先小後大**：每批先用 20–30 頁試跑，確認規則沒問題再跑全部。
4. **規則版本化**：規則檔的修改走 PR 並說明影響範圍；報告歸檔（`data/legacy-import/{slug}/`），作為品質稽核與回溯。
5. **抽樣稽核**：二級自動上線的新聞，每批抽 10% 由公關室檢視；若抽樣發現率超過 10%，暫停自動上線，回頭修規則。
6. **與轉址同步**：每批上線前確認該批舊網址的 301 已進伺服器轉址檔（[migration-playbook.md](migration-playbook.md) 第 6 節）。
7. **切換前**不要上線大量未審草稿：草稿一律 `review`，進 `content/` 並改 `published` 才會對外。

---

## 12. 限制

- **模擬匯出不等於真實舊站**：版型、Word 殘留的程度、表格複雜度、圖片與附件的命名，都以真實匯出為準；規則與信心門檻（0.6、0.8）要用真實樣本校準。
- **不處理的內容**：影音嵌入（記 `embedded-media` 警告，影片請走 `media` 型別人工建檔）、表單（動態頁面）、站外內容、內部系統頁。
- **不判斷內容是否過時**：轉換只確認「搬得對不對」，不確認「內容還對不對」。過時的規定、數字，要靠 Steward 審閱與治理引擎的反向稽核。
- **不處理個資**：匯出階段就要排除；若轉換後的草稿含個資，通報並從輸出刪除。
- **多對一與一對多**：疾病頁子頁併成同一份疾病頁草稿（多對一）；一個舊頁不會轉成多個頁面，Q&A 頁例外（每題一筆）。
- **英文與其他語言頁**：依 `bulletinTypes` 的 `lang` 標示以英文為來源語言（`sourceLang: en`），需補中文版（[governance-model.md](governance-model.md) 規則 18）；其他語言頁不在本工具範圍。
