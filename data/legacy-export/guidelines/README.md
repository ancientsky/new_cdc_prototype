# 舊站匯出（模擬）：指引及手冊欄目（第七批）

> **這是模擬匯出。** 開發環境連不到 www.cdc.gov.tw，這 26 頁由 `scripts/lib/legacy-import/sim-export-guidelines.mjs` 合成：既有 content/documents 依文件家族反推成舊站欄目內頁 21 頁（頁面內文是現行版，歷版 6 份放在同頁的附件列表、標籤帶版次與日期；流感抗病毒藥劑的三個版次各自一頁），另合成新站沒有的 4 頁（狂犬病手冊兩版各一頁、純 PDF 的感染管制指引、歷版掃描檔）與一頁總覽列表。網址中的 ID、PDF 內容都是示意。**正式匯出取代整個目錄即可**，不需要改程式。

## 重新產生

```
node scripts/lib/legacy-import/sim-export-guidelines.mjs data/legacy-export/guidelines
```

## 轉換

```
node scripts/import-legacy.mjs data/legacy-export/guidelines --out data/legacy-import/guidelines --apply-migration
```

移轉清單：`content/migration/guidelines.json`（欄目範圍，逐份文件家族一筆；歷版與合成頁另列）。匯出格式見 `docs/legacy-import.md` 第 2 節。
