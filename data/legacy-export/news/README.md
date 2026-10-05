# 舊站匯出（模擬）：新聞與公告欄目（第六批）

> **這是模擬匯出。** 開發環境連不到 www.cdc.gov.tw，這 62 頁由 `scripts/lib/legacy-import/sim-export-news.mjs` 合成：既有 content/news（39 則）與 content/clarifications（8 則）反推成舊站 Bulletin 內頁（新聞稿 typeid 9、致醫界通函 48、澄清稿 8772、其他訊息 11），另合成新站沒有的近年新聞 6 則、超過三年的久遠新聞 6 則（含一則「活動報名」）、英文新聞稿 2 則（typeid 158）與一頁列表頁。網址中的 ID、PDF 內容都是示意。**正式匯出取代整個目錄即可**，不需要改程式。

這批**沒有移轉清單**：新聞不是一頁對一頁搬，而是依三級處理（docs/legacy-import.md 第 7 節）決定上線、封存或不轉；報告另附二級抽樣名單。

## 重新產生

```
node scripts/lib/legacy-import/sim-export-news.mjs data/legacy-export/news
```

## 轉換

```
node scripts/import-legacy.mjs data/legacy-export/news --out data/legacy-import/news --now 2026-10-05T02:30:00Z
```
