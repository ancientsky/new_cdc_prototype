# 舊站匯出轉換報告：rabies

> **模擬匯出**（開發環境連不到舊站，依移轉清單合成；正式匯出取代即可）。匯出日 2026-10-03；轉換時間 2026-10-05T02:30:00Z；規則檔 `content/migration/import/_import-rules.json`；移轉清單 `null`（0 筆）。

## 批次摘要

| 項目 | 數字 |
| --- | --- |
| 舊頁數 | 20 |
| 產出草稿 | 12（Q&A 1、出版品 1、影音 1、文件 3、資料集 1、檢驗 1、頁面 2、專區 1、疾病頁 1） |
| 舊頁型別 | 併入疾病頁 9、Q&A 1、出版品 1、影音 1、文件 3、資料集 1、檢驗 1、頁面 1、清單頁 1、專區 1 |
| 平均信心 | 0.91 |
| 需人工檢視（信心 < 0.6） | 1 |
| 既有內容已存在（供比對） | 12 |
| 附件與圖片 | 5（附件 2、內文圖片 2、資料檔 1；圖片待補 alt 2、PDF 無文字層 1） |
| 草稿 schema 驗證 | 12 / 12 通過 |
| 問題 | 錯誤 0、警告 11、提示 71 |
| 移轉清單對應 | 對上 0 / 0 筆；status 變化 0（尚未套用）；note 更新 0；仍待移轉 0；與清單判定不同 0 |
| 模板推導項（清單只寫例外） | 20 項，對上 20；只列在 migration-patch.json 的 derivedItems，不寫回清單 |

處理原則：一級內容（疾病頁、指引、手冊）一律人工確認後才入庫；近年新聞信心 ≥ 0.8 可核對後自動上線；久遠與歷史版本封存；草稿放在本目錄，**不會**寫進 `content/`。

## 逐頁結果

| # | 來源 | 型別 | 目標 | 信心 | 問題 | 建議動作 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 疾病介紹<br><sub>www.cdc.gov.tw/Disease/SubIndex/1WOARA7Niw2jAcrCXFxPYp</sub> | 併入疾病頁 → `disease.rabies`（併入：transmission） | `disease.rabies`（既有） | 1 | — | 併入疾病頁區塊（與既有內容逐段比對） |
| 2 | 致病原<br><sub>www.cdc.gov.tw/Disease/SubIndex/1WOARA7Niw2jAcrCXFxPYp</sub> | 併入疾病頁 → `disease.rabies`（併入：transmission） | `disease.rabies`（既有） | 1 | — | 併入疾病頁區塊（與既有內容逐段比對） |
| 3 | 流行病學<br><sub>www.cdc.gov.tw/Disease/SubIndex/1WOARA7Niw2jAcrCXFxPYp</sub> | 併入疾病頁 → `disease.rabies`（併入：situation） | `disease.rabies`（既有） | 0.8 | image-no-alt | 併入疾病頁區塊（與既有內容逐段比對） |
| 4 | 傳染方式<br><sub>www.cdc.gov.tw/Disease/SubIndex/1WOARA7Niw2jAcrCXFxPYp</sub> | 併入疾病頁 → `disease.rabies`（併入：transmission） | `disease.rabies`（既有） | 1 | — | 併入疾病頁區塊（與既有內容逐段比對） |
| 5 | 潛伏期<br><sub>www.cdc.gov.tw/Disease/SubIndex/1WOARA7Niw2jAcrCXFxPYp</sub> | 併入疾病頁 → `disease.rabies`（併入：transmission） | `disease.rabies`（既有） | 1 | — | 併入疾病頁區塊（與既有內容逐段比對） |
| 6 | 發病症狀<br><sub>www.cdc.gov.tw/Disease/SubIndex/1WOARA7Niw2jAcrCXFxPYp</sub> | 併入疾病頁 → `disease.rabies`（併入：symptoms） | `disease.rabies`（既有） | 1 | — | 併入疾病頁區塊（與既有內容逐段比對） |
| 7 | 預防方法<br><sub>www.cdc.gov.tw/Disease/SubIndex/1WOARA7Niw2jAcrCXFxPYp</sub> | 併入疾病頁 → `disease.rabies`（併入：prevention） | `disease.rabies`（既有） | 1 | — | 併入疾病頁區塊（與既有內容逐段比對） |
| 8 | 治療方法與就醫資訊<br><sub>www.cdc.gov.tw/Disease/SubIndex/1WOARA7Niw2jAcrCXFxPYp</sub> | 併入疾病頁 → `disease.rabies`（併入：treatment） | `disease.rabies`（既有） | 1 | — | 併入疾病頁區塊（與既有內容逐段比對） |
| 9 | 預防接種建議<br><sub>www.cdc.gov.tw/Category/MPage/7xGZ1yWADA2Frj42YM8bP8</sub> | 併入疾病頁 → `disease.rabies`（併入：vaccine） | `disease.rabies`（既有） | 1 | — | 併入疾病頁區塊（與既有內容逐段比對） |
| 10 | Q&A<br><sub>www.cdc.gov.tw/Category/QAPage/w8q-t_VbPbc0A648Kg2DkC</sub> | Q&A → `faq.rabies-bite` | `disease.rabies`（既有） | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 11 | 衛教宣導：單張海報<br><sub>www.cdc.gov.tw/Category/List/4XOwdLkEbrWrk5MZBY1NGU</sub> | 出版品 → `publication.rabies-materials-poster` | — | 0.8 | pdf-no-text-layer、image-no-alt | 核對後入庫（新站尚無對應內容） |
| 12 | 衛教宣導：影片<br><sub>www.cdc.gov.tw/Category/MPage/Ga8GXmJt2e0UBq72vLbBt6</sub> | 影音 → `media.rabies-materials-video` | — | 0.8 | body-short、fields-pending | 核對後入庫（新站尚無對應內容） |
| 13 | 工作手冊<br><sub>www.cdc.gov.tw/Category/DiseaseManual/PHehARd5qkKkaldTIw_CKy</sub> | 文件 → `doc.rabies-manual.2018-03-01` | — | 0.8 | body-short、pdf-only | 核對後入庫（新站尚無對應內容） |
| 14 | 病例定義<br><sub>www.cdc.gov.tw/Category/DiseaseDefine/DmJ-Re-45K2m78dCYJ0VE6</sub> | 文件 → `doc.rabies-case-definition.2018-03-01` | — | 0.8 | body-short | 核對後入庫（新站尚無對應內容） |
| 15 | 治療指引<br><sub>www.cdc.gov.tw/File/Get/6P5d2dExL6xcmi3lQeV6R8</sub> | 文件 → `doc.rabies-guideline.2018-03-01` | — | 0.8 | body-short | 核對後入庫（新站尚無對應內容） |
| 16 | 統計資料<br><sub>www.cdc.gov.tw/Category/List/ZYlSirRYJ8qRQ7dA_3syDw</sub> | 資料集 → `dataset.rabies-stats` | — | 1 | — | 核對後入庫（新站尚無對應內容） |
| 17 | 檢驗資訊<br><sub>www.cdc.gov.tw/Category/MPage/7bZg2Omh3ulQEzDuIbDKFg</sub> | 檢驗 → `labtest.rabies` | `labtest.rabies`（既有） | 1 | fields-pending | 既有內容已存在，供比對，不建議覆蓋 |
| 18 | 通報定義與時限<br><sub>www.cdc.gov.tw/Category/MPage/lsHOyWnCEBzwCCoOkSkjOq</sub> | 頁面 → `page.rabies-notify` | — | 1 | — | 核對後入庫（新站尚無對應內容） |
| 19 | 新聞稿列表<br><sub>www.cdc.gov.tw/Bulletin/List/609-Ro3O2eNLWoX5fnx1qJ</sub> | 清單頁 → `page.rabies-news-list` | `disease.rabies`（既有） | 0.4 ⚠ | body-short | 清單頁，不轉換（新站由系統自動產生列表） |
| 20 | 相關連結<br><sub>www.cdc.gov.tw/Category/List/CsSoETep7fWSX94ljz7pFq</sub> | 專區 → `topic.rabies-links` | — | 1 | — | 核對後入庫（新站尚無對應內容） |

## 需人工檢視（1 頁）

- **新聞稿列表**（信心 0.4）
  - 警告：內文過短（0 字，低於 40）

## 併入疾病頁（9 頁）

- 「疾病介紹」→ `disease.rabies` 區塊 transmission（疾病頁既有內容已存在，供比對）
- 「致病原」→ `disease.rabies` 區塊 transmission（疾病頁既有內容已存在，供比對）
- 「流行病學」→ `disease.rabies` 區塊 situation（疾病頁既有內容已存在，供比對）
- 「傳染方式」→ `disease.rabies` 區塊 transmission（疾病頁既有內容已存在，供比對）
- 「潛伏期」→ `disease.rabies` 區塊 transmission（疾病頁既有內容已存在，供比對）
- 「發病症狀」→ `disease.rabies` 區塊 symptoms（疾病頁既有內容已存在，供比對）
- 「預防方法」→ `disease.rabies` 區塊 prevention（疾病頁既有內容已存在，供比對）
- 「治療方法與就醫資訊」→ `disease.rabies` 區塊 treatment（疾病頁既有內容已存在，供比對）
- 「預防接種建議」→ `disease.rabies` 區塊 vaccine（疾病頁既有內容已存在，供比對）

## 二級抽樣檢視名單（近年新聞 auto-ok 0 頁，抽 10% ＝ 0 頁）

本批沒有可自動上線的近年新聞。

抽樣由網址雜湊排序決定，重跑不變；公關室看完名單沒有問題，整批 auto-ok 才改 `published` 開 PR（第 7 節二級）；發現率超過 10% 就暫停自動上線、回頭修規則。

## 附件與圖片需要處理的

- 流行病學：圖片「rabies-trend.png」舊頁沒有替代文字，暫用檔名「rabies-trend」，請補 alt（needsAlt）
- 衛教宣導：單張海報：PDF「rabies-poster-7lang.pdf」沒有文字層（掃描檔），上架前須附同名 .md／.docx 可及性版本，或重做有文字層的 PDF
- 衛教宣導：單張海報：圖片「rabies-poster.png」舊頁沒有替代文字，暫用檔名「rabies-poster」，請補 alt（needsAlt）

## 與移轉清單的差異

- 清單有、匯出沒有：無
- 匯出有、清單沒有：無
- 與清單判定不同（不覆蓋，人工決定）：無
- 套用規則：只改 status／target／note，不動 verified；僅「待確認(pending)且新站已有對應內容」的項目才改 status（人工已判定的項目不被覆蓋，差異列在 conflicts）。

