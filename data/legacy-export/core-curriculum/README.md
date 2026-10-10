# 舊站匯出（模擬）：傳染病核心教材（第十二批，第二十八輪）

> **這是模擬匯出，不是舊站資料。** 開發環境連不到 www.cdc.gov.tw，這 5 頁由 `scripts/lib/legacy-import/sim-export-curriculum.mjs` 合成。
> 頁面網址 ID、發布日（除另註者）與附件 PDF 內容都是示意；**正式匯出取代整個目錄即可**，不需要改程式。

## 每頁的依據（都未查證）

| 頁 | 標題 | 附件檔名 | 依據 |
| --- | --- | --- | --- |
| dengue | 登革熱核心教材 | 2025-04-登革熱防治核心教材.pdf | 搜尋摘錄：疾管署「重要指引及教材」頁（https://www.cdc.gov.tw/Category/MPage/O5l65bHP7CwFNJOsF7wXbA）列有「登革熱核心教材」，檔名 2025-04-登革熱防治核心教材.pdf、最後更新 2025/4/18；未能重現，待確認。 |
| measles | 麻疹核心教材 | 麻疹核心教材.pdf | 搜尋結果標題「麻疹核心教材.pdf」（https://www.cdc.gov.tw/File/Get/eH0KllYdi__tvUdV8al0lA）；版次、日期與頁面網址都看不到，所以側檔沒有發布日。 |
| novel-influenza-a | 新型A型流感核心教材 | 新型A型流感_核心教材-11401版.pdf | 搜尋摘錄出現檔名「新型A型流感_核心教材-11401版.pdf」（114 年 1 月版）；發布日 2025-01-15 是示意值。 |
| plague | 鼠疫核心教材 | 鼠疫核心教材_1140318.pdf | 搜尋摘錄出現檔名「鼠疫核心教材_1140318.pdf」；發布日取檔名上的民國 114 年 3 月 18 日。 |
| core-curriculum-list | 傳染病核心教材 | — | 舊站有「首頁／專業人員／傳染病核心教材」入口（content/migration/legacy-services.json）；實際是列表頁還是欄目頁（MPage）待資訊室確認，這裡以列表頁（/Category/List/）示意 |

## 重新產生

```
node scripts/lib/legacy-import/sim-export-curriculum.mjs data/legacy-export/core-curriculum
```

## 轉換

```
node scripts/import-legacy.mjs data/legacy-export/core-curriculum --out data/legacy-import/core-curriculum --now 2026-10-10T03:00:00Z --apply-migration
```

移轉清單：`content/migration/core-curriculum.json`。結果與教訓見 `docs/legacy-import.md` 第 10.13 節。
