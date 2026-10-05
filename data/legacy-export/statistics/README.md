# 舊站匯出（模擬）：統計專區欄目（第十一批）

> **這是模擬匯出。** 開發環境連不到 www.cdc.gov.tw，這 15 頁由 `scripts/lib/legacy-import/sim-export-statistics.mjs` 合成：列表 2 頁（統計專區、英文 Data & Statistics）、外部系統入口 3 頁（傳染病統計資料查詢系統、疾管署資料開放平臺、防疫資料庫）、期刊頁 4 頁（疫情監測速訊、流感速訊、腸病毒疫情週報、COVID-19 週報）、統計表頁 3 頁（境外移入確定病例、常規疫苗接種完成率、法定傳染病死亡統計）、統計年報 1 頁，另**原樣複製**結核病批與登革熱批匯出的「統計資料」頁各 1 頁（共 2 頁，連同附件）。
>
> 統計專區根、英文 Data & Statistics、法定傳染病境外移入確定病例統計、防疫資料庫、疫情監測速訊的網址 ID 是**真實**的；其餘 ID、**所有統計數字**、站外連結皆為**示意**。**正式匯出取代整個目錄即可**，不需要改程式。

## 重新產生

```
node scripts/lib/legacy-import/sim-export-statistics.mjs data/legacy-export/statistics
```

## 轉換

```
node scripts/import-legacy.mjs data/legacy-export/statistics --out data/legacy-import/statistics --apply-migration
```

移轉清單：`content/migration/statistics.json`（欄目範圍，逐頁一筆共 14 筆；複製的 2 頁與結核病批、登革熱批是同一頁，不列入清單，轉換器會判定為「已在前批轉過」）。匯出格式見 `docs/legacy-import.md` 第 2 節。
