# 舊站匯出（模擬）：結核病專區

> **這是模擬匯出。** 開發環境連不到 www.cdc.gov.tw，所以這 40 頁是依 `content/migration/tuberculosis.json` 的 40 筆人工項目合成的：HTML 長得像舊站（Bootstrap 版型外殼、麵包屑、側欄、Word 貼上的 `span／mso` 樣式、表格、附件連結、圖片、Q&A 手風琴），內文文字反推自既有結核病內容，網址中的 ID、統計數字、醫院名單、PDF 內容都是示意。**正式匯出取代整個目錄即可**，不需要改程式。

## 重新產生

```
node scripts/lib/legacy-import/sim-export.mjs data/legacy-export/tuberculosis
```

## 匯出格式（資訊室從 CMS 資料庫匯出時照這個做）

每頁兩個檔，檔名相同：

| 檔案 | 內容 |
| --- | --- |
| `{name}.html` | 舊站頁面的完整 HTML（含版型外殼；轉換時只取內容區 `#CCMS_Content`，外殼規則見 `content/migration/import/_import-rules.json` 的 `extraction`） |
| `{name}.json` | 側檔，欄位如下 |
| `files/` | 附件與內文圖片，檔名對應側檔 `attachments[].file` 與 `<img src>` 的檔名 |
| `_export.json` | 選填：`exportedAt`（草稿的 reviewedAt）、`simulated`、`source`、`site` |

也可以只給一個 `index.json` 陣列，每筆＝側檔欄位加 `html`（內嵌字串）或 `htmlFile`（相對路徑）。

### 側檔欄位

| 欄位 | 型別 | 說明 |
| --- | --- | --- |
| `url` | string | 舊站完整網址（用來比對 URL 模式與移轉清單） |
| `title` | string | 頁面標題 |
| `category` | string | 欄目階層，以「／」分隔（例：`結核病／防治政策`），用來對應權責單位 |
| `publishedAt` | date | 首次發布日（YYYY-MM-DD） |
| `updatedAt` | date | 最後更新日 |
| `breadcrumbs` | string[] | 麵包屑（含「首頁」） |
| `attachments` | [{url,label,file}] | 附件：舊站檔案網址、顯示名稱、`files/` 內的檔名 |
| `typeid` | string | 選填：Bulletin 的 typeid（9 新聞稿、8772 澄清、11 其他、158 英文）；也可只寫在 `url` 的 query |
| `tab` | string | 選填：同一網址內的分頁錨點（疾病頁的 #symptoms 之類） |

## 轉換

```
node scripts/import-legacy.mjs data/legacy-export/tuberculosis --out data/legacy-import/tuberculosis --apply-migration
```

輸出在 `data/legacy-import/tuberculosis/`（草稿、assets、report.json、report.md、migration-patch.json），後台 `/admin/import/` 可看。
