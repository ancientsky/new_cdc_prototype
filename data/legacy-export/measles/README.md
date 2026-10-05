# 舊站匯出（模擬）：麻疹專區

> **這是模擬匯出。** 開發環境連不到 www.cdc.gov.tw，這 28 頁由 `scripts/lib/legacy-import/sim-export-disease.mjs` 依**標準疾病頁模板**（`content/migration/_disease-template.json`，18 項）＋**人工例外清單**（`content/migration/measles.json`，7 項）＋近三年新聞 3 篇合成：HTML 長得像舊站（Bootstrap 版型外殼、麵包屑、側欄、Word 貼上的 `span／mso` 樣式、表格、附件連結、圖片、Q&A 手風琴），內文反推自既有的麻疹內容，網址中的 ID、統計數字、PDF 內容都是示意。**正式匯出取代整個目錄即可**，不需要改程式。

與結核病首批（逐頁手寫規格）不同，這份是模板驅動的：任何有疾病頁的疾病都能用同一支程式產出。

## 重新產生

```
node scripts/lib/legacy-import/sim-export-disease.mjs disease.measles data/legacy-export/measles
```

## 匯出格式

與結核病批次相同，見 `data/legacy-export/tuberculosis/README.md` 與 `docs/legacy-import.md` 第 2 節。

## 轉換

```
node scripts/import-legacy.mjs data/legacy-export/measles --out data/legacy-import/measles --apply-migration
```
