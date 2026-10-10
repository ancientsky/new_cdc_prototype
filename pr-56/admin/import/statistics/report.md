# 舊站匯出轉換報告：statistics

> **模擬匯出**（開發環境連不到舊站，依移轉清單合成；正式匯出取代即可）。匯出日 2026-10-03；轉換時間 2026-10-05T02:30:00Z；規則檔 `content/migration/import/_import-rules.json`；移轉清單 `content/migration/statistics.json`（13 筆）。

## 批次摘要

| 項目 | 數字 |
| --- | --- |
| 舊頁數 | 15 |
| 產出草稿 | 13（出版品 1、資料集 8、頁面 4） |
| 舊頁型別 | 出版品 1、資料集 10、頁面 2、清單頁 2 |
| 平均信心 | 0.95 |
| 需人工檢視（信心 < 0.6） | 0 |
| 既有內容已存在（供比對） | 5 |
| 附件與圖片 | 30（附件 29、內文圖片 0、資料檔 1；圖片待補 alt 0、PDF 無文字層 0） |
| 草稿 schema 驗證 | 13 / 13 通過 |
| 問題 | 錯誤 0、警告 5、提示 51 |
| 移轉清單對應 | 對上 13 / 13 筆；status 變化 0；note 更新 0；仍待移轉 5；與清單判定不同 0 |
| 清單沒有的舊頁 | 2（migration-patch.json 的 unmatchedPages 有建議的 pending 項目） |

處理原則：一級內容（疾病頁、指引、手冊）一律人工確認後才入庫；近年新聞信心 ≥ 0.8 可核對後自動上線；久遠與歷史版本封存；草稿放在本目錄，**不會**寫進 `content/`。

## 逐頁結果

| # | 來源 | 型別 | 目標 | 信心 | 問題 | 建議動作 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 傳染病統計暨監視年報<br><sub>www.cdc.gov.tw/Category/MPage/awMzKEQ9hVCtOWGFPHydj2</sub> | 出版品 → `publication.statistics-annual-2025` | `publication.statistics-annual-2025`（既有） | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 2 | COVID-19 週報<br><sub>www.cdc.gov.tw/Category/MPage/OyPQCu3iBWmljSol_qLalD</sub> | 資料集 → `dataset.covid-severe-weekly` | `dataset.covid-severe-weekly`（既有） | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 3 | 法定傳染病死亡統計<br><sub>www.cdc.gov.tw/Category/MPage/7QXqDvpfrx1OcONmVzC8Hi</sub> | 資料集 → `dataset.x-death-stats` | — | 1 | series-gaps、stats-stale、fields-pending | 核對後入庫（新站尚無對應內容） |
| 4 | 統計資料<br><sub>www.cdc.gov.tw/Category/List/24UnSJ76XgcjnNUGy3DMcd</sub> | 資料集 → `dataset.dengue-local-weekly`（重複，未輸出） | — | 1 | — | 已在其他批次轉過（同網址），本批不重複出草稿 |
| 5 | 防疫資料庫<br><sub>www.cdc.gov.tw/Category/MPage/i5N2W9G-FWJkh3agfLA-Kg</sub> | 頁面 → `page.x-epidemic-database` | — | 1 | — | 核對後入庫（新站尚無對應內容） |
| 6 | 腸病毒疫情週報<br><sub>www.cdc.gov.tw/Category/MPage/NYDMC1OCW393ioaTIE_-yc</sub> | 資料集 → `dataset.enterovirus-ev-weekly` | — | 1 | fields-pending | 核對後入庫（新站尚無對應內容） |
| 7 | 流感速訊<br><sub>www.cdc.gov.tw/Category/MPage/z6EmN04F9zPF9NDXivtXFB</sub> | 資料集 → `dataset.flu-express` | `dataset.flu-express`（既有） | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 8 | 法定傳染病境外移入確定病例統計<br><sub>www.cdc.gov.tw/Category/Page/5Q6qrh5kM6TnpnRpy3XDfQ</sub> | 資料集 → `dataset.x-imported-cases` | — | 1 | — | 核對後入庫（新站尚無對應內容） |
| 9 | 統計專區<br><sub>www.cdc.gov.tw/Category/List/ZrvS2zJwZ03tl8CbKYdI8g</sub> | 清單頁 → `page.x-list-statistics` | — | 0.6 | — | 清單頁，不轉換（新站由系統自動產生列表） |
| 10 | Data & Statistics<br><sub>www.cdc.gov.tw/En/Category/List/gK4BJWe3qYlmNxYJBqEcxA</sub> | 清單頁 → `page.x-list-statistics-en` | — | 0.6 | — | 清單頁，不轉換（新站由系統自動產生列表） |
| 11 | 傳染病統計資料查詢系統<br><sub>www.cdc.gov.tw/Category/MPage/LiNW6PIOJsKKTzV9OoRoSg</sub> | 資料集 → `dataset.nidss` | `dataset.nidss`（既有） | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 12 | 疾管署資料開放平臺<br><sub>www.cdc.gov.tw/Category/MPage/2okLkU-L0iWbjwLrj2BaP7</sub> | 頁面 → `page.x-open-data-portal` | — | 1 | — | 核對後入庫（新站尚無對應內容） |
| 13 | 疫情監測速訊<br><sub>www.cdc.gov.tw/Category/MPage/94JVbJ2BFjR_3MTi-9s9Cg</sub> | 資料集 → `dataset.x-surveillance-express` | — | 1 | fields-pending | 核對後入庫（新站尚無對應內容） |
| 14 | 統計資料<br><sub>www.cdc.gov.tw/Category/List/IR-4OsM3biF9t30fng00vq</sub> | 資料集 → `dataset.tb-new-cases`（重複，未輸出） | — | 1 | — | 已在其他批次轉過（同網址），本批不重複出草稿 |
| 15 | 常規疫苗接種完成率<br><sub>www.cdc.gov.tw/Category/MPage/Z3nsEXQ6Jne6A13aVu8Ra8</sub> | 資料集 → `dataset.vaccine-coverage` | `dataset.vaccine-coverage`（既有） | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |

## 需人工檢視（0 頁）

無。

## 併入疾病頁（0 頁）


## 二級抽樣檢視名單（近年新聞 auto-ok 0 頁，抽 10% ＝ 0 頁）

本批沒有可自動上線的近年新聞。

抽樣由網址雜湊排序決定，重跑不變；公關室看完名單沒有問題，整批 auto-ok 才改 `published` 開 PR（第 7 節二級）；發現率超過 10% 就暫停自動上線、回頭修規則。

## 附件與圖片需要處理的

無。

## 與移轉清單的差異

- 清單有、匯出沒有：無
- 匯出有、清單沒有：04-dengue-stats、14-tb-stats
- 與清單判定不同（不覆蓋，人工決定）：無
- 套用規則：只改 status／target／newPath／note，不動 verified；僅「待確認(pending)且新站已有對應內容」的項目才改 status（人工已判定的項目不被覆蓋，差異列在 conflicts）。

