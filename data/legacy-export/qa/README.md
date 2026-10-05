# 舊站匯出（模擬）：常見問答（Q&A）欄目（第八批）

> **這是模擬匯出。** 開發環境連不到 www.cdc.gov.tw，這 15 頁由 `scripts/lib/legacy-import/sim-export-qa.mjs` 合成：既有 content/faq 依主題反推成問答頁 12 頁（疾病批還沒做的疾病專題、預防接種、旅遊、統計、謠言澄清；含新站沒有的題、沒有手風琴元件的鬆散排版、期限已過的年度 Q&A、英文頁、整頁一題的頁），另**原樣複製**疾病批匯出裡同網址的結核病、登革熱 Q&A 頁 2 頁（欄目匯出本來就會把疾病專題的 Q&A 再匯一次），與一頁總覽列表。網址中的 ID 都是示意。**正式匯出取代整個目錄即可**，不需要改程式。

## 重新產生

```
node scripts/lib/legacy-import/sim-export-qa.mjs data/legacy-export/qa
```

## 轉換

```
node scripts/import-legacy.mjs data/legacy-export/qa --out data/legacy-import/qa --apply-migration
```

移轉清單：`content/migration/qa.json`（欄目範圍，逐頁一筆；疾病批已處理的結核病、登革熱 Q&A 頁不列，由轉換器依同網址判定「已在疾病批轉過」）。匯出格式見 `docs/legacy-import.md` 第 2 節。
