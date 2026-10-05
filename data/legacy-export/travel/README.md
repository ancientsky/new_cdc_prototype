# 舊站匯出（模擬）：國際旅遊與健康欄目（第九批）

> **這是模擬匯出。** 開發環境連不到 www.cdc.gov.tw，這 20 頁由 `scripts/lib/legacy-import/sim-export-travel.mjs` 合成：欄目列表 4 頁、動態查詢頁「國際旅遊處方箋」（<form>＋231 國下拉選單）、6 個國家結果頁（同一路徑、僅 `?iso=` 不同）、旅遊醫學門診／國際預防接種及藥物／出國前與返國後注意事項／黃皮書申請（含 PDF 附件）／疫情建議等級表／瘧疾預防用藥／宣導影片等內容頁，另**原樣複製**Q&A 批匯出的「國際旅遊常見問答」1 頁（`travel-faq`）。
>
> 欄目總覽、旅遊醫學、國際旅遊保健資訊、旅遊醫學門診、國際預防接種及藥物、出國前注意事項的網址 ID 是真實的；其餘 ID、醫院名單、電話、等級表數字皆為**示意**。`/TravelEpidemic/Prescription/` 是**推測的網址模式**，正式匯出以真實網址為準。**正式匯出取代整個目錄即可**，不需要改程式。

## 重新產生

```
node scripts/lib/legacy-import/sim-export-travel.mjs data/legacy-export/travel
```

## 轉換

```
node scripts/import-legacy.mjs data/legacy-export/travel --out data/legacy-import/travel --apply-migration
```

移轉清單：`content/migration/travel.json`（欄目範圍，逐頁一筆）。`travel-faq` 與 Q&A 批是同一頁（同網址），不列入清單，轉換器會判定為「已在 qa 批轉過」。匯出格式見 `docs/legacy-import.md` 第 2 節。
