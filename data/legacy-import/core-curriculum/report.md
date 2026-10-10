# 舊站匯出轉換報告：core-curriculum

> **模擬匯出**（開發環境連不到舊站，依移轉清單合成；正式匯出取代即可）。匯出日 2026-10-10；轉換時間 2026-10-10T03:00:00Z；規則檔 `content/migration/import/_import-rules.json`；移轉清單 `content/migration/core-curriculum.json`（5 筆）。

## 批次摘要

| 項目 | 數字 |
| --- | --- |
| 舊頁數 | 5 |
| 產出草稿 | 5（文件 4、頁面 1） |
| 舊頁型別 | 文件 4、清單頁 1 |
| 平均信心 | 0.72 |
| 需人工檢視（信心 < 0.6） | 1 |
| 既有內容已存在（供比對） | 2 |
| 附件與圖片 | 4（附件 4、內文圖片 0、資料檔 0；圖片待補 alt 0、PDF 無文字層 0） |
| 草稿 schema 驗證 | 5 / 5 通過 |
| 問題 | 錯誤 0、警告 14、提示 21 |
| 移轉清單對應 | 對上 5 / 5 筆；status 變化 0；note 更新 5；仍待移轉 2；與清單判定不同 0 |

處理原則：一級內容（疾病頁、指引、手冊）一律人工確認後才入庫；近年新聞信心 ≥ 0.8 可核對後自動上線；久遠與歷史版本封存；草稿放在本目錄，**不會**寫進 `content/`。

## 逐頁結果

| # | 來源 | 型別 | 目標 | 信心 | 問題 | 建議動作 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 登革熱核心教材<br><sub>www.cdc.gov.tw/Category/DiseaseTeach/VfpjOuRgDbAh6fzpmiZuVO</sub> | 文件 → `doc.curriculum-dengue.2026-10-10` | `doc.curriculum-dengue.2026-10-10`（既有） | 0.8 | fields-pending、body-short、pdf-only | 既有內容已存在，供比對，不建議覆蓋 |
| 2 | 麻疹核心教材<br><sub>www.cdc.gov.tw/Category/DiseaseTeach/T9FhoMUb6iFhUy1QUsJrFy</sub> | 文件 → `doc.curriculum-measles.2026-10-10` | `doc.curriculum-measles.2026-10-10`（既有） | 0.8 | date-missing、fields-pending、body-short、pdf-only | 既有內容已存在，供比對，不建議覆蓋 |
| 3 | 新型A型流感核心教材<br><sub>www.cdc.gov.tw/Category/DiseaseTeach/b3svOY0jxlOxkEKfknvwED</sub> | 文件 → `doc.curriculum-novel-influenza-a.2025-01-15` | — | 0.8 | fields-pending、body-short、pdf-only | 核對後入庫（新站尚無對應內容） |
| 4 | 鼠疫核心教材<br><sub>www.cdc.gov.tw/Category/DiseaseTeach/xeRIJXoPAmAxHAV71GUim1</sub> | 文件 → `doc.curriculum-plague.2025-03-18` | — | 0.8 | fields-pending、body-short、pdf-only | 核對後入庫（新站尚無對應內容） |
| 5 | 傳染病核心教材<br><sub>www.cdc.gov.tw/Category/List/PM9-kmbijh-Ftkeb_TIF06</sub> | 清單頁 → `page.x-core-curriculum-list` | — | 0.4 ⚠ | body-short | 清單頁，不轉換（新站由系統自動產生列表） |

## 需人工檢視（1 頁）

- **傳染病核心教材**（信心 0.4）
  - 警告：內文過短（32 字，低於 40）

## 併入疾病頁（0 頁）


## 二級抽樣檢視名單（近年新聞 auto-ok 0 頁，抽 10% ＝ 0 頁）

本批沒有可自動上線的近年新聞。

抽樣由網址雜湊排序決定，重跑不變；公關室看完名單沒有問題，整批 auto-ok 才改 `published` 開 PR（第 7 節二級）；發現率超過 10% 就暫停自動上線、回頭修規則。

## 附件與圖片需要處理的

無。

## 與移轉清單的差異

- 清單有、匯出沒有：無
- 匯出有、清單沒有：無
- 與清單判定不同（不覆蓋，人工決定）：無
- 套用規則：只改 status／target／newPath／note，不動 verified；僅「待確認(pending)且新站已有對應內容」的項目才改 status（人工已判定的項目不被覆蓋，差異列在 conflicts）。

