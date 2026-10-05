# 舊站匯出轉換報告：chikungunya

> **模擬匯出**（開發環境連不到舊站，依移轉清單合成；正式匯出取代即可）。匯出日 2026-10-03；轉換時間 2026-10-05T02:30:00Z；規則檔 `content/migration/import/_import-rules.json`；移轉清單 `null`（0 筆）。

## 批次摘要

| 項目 | 數字 |
| --- | --- |
| 舊頁數 | 23 |
| 產出草稿 | 15（Q&A 1、出版品 1、影音 1、文件 3、資料集 1、檢驗 1、頁面 2、專區 1、致醫界通函 2、新聞 1、疾病頁 1） |
| 舊頁型別 | 併入疾病頁 9、Q&A 1、出版品 1、影音 1、文件 3、資料集 1、檢驗 1、頁面 1、清單頁 1、專區 1、新聞 3 |
| 平均信心 | 0.93 |
| 需人工檢視（信心 < 0.6） | 0 |
| 既有內容已存在（供比對） | 16 |
| 附件與圖片 | 6（附件 3、內文圖片 2、資料檔 1；圖片待補 alt 2、PDF 無文字層 1） |
| 草稿 schema 驗證 | 15 / 15 通過 |
| 問題 | 錯誤 0、警告 14、提示 79 |
| 移轉清單對應 | 對上 0 / 0 筆；status 變化 0（尚未套用）；note 更新 0；仍待移轉 0；與清單判定不同 0 |
| 模板推導項（清單只寫例外） | 20 項，對上 20；只列在 migration-patch.json 的 derivedItems，不寫回清單 |
| 清單沒有的舊頁 | 3（migration-patch.json 的 unmatchedPages 有建議的 pending 項目） |

處理原則：一級內容（疾病頁、指引、手冊）一律人工確認後才入庫；近年新聞信心 ≥ 0.8 可核對後自動上線；久遠與歷史版本封存；草稿放在本目錄，**不會**寫進 `content/`。

## 逐頁結果

| # | 來源 | 型別 | 目標 | 信心 | 問題 | 建議動作 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 疾病介紹<br><sub>www.cdc.gov.tw/Disease/SubIndex/GXrXiCys54g_QwXu-rFqo8</sub> | 併入疾病頁 → `disease.chikungunya`（併入：transmission） | `disease.chikungunya`（既有） | 1 | — | 併入疾病頁區塊（與既有內容逐段比對） |
| 2 | 致病原<br><sub>www.cdc.gov.tw/Disease/SubIndex/GXrXiCys54g_QwXu-rFqo8</sub> | 併入疾病頁 → `disease.chikungunya`（併入：transmission） | `disease.chikungunya`（既有） | 1 | — | 併入疾病頁區塊（與既有內容逐段比對） |
| 3 | 流行病學<br><sub>www.cdc.gov.tw/Disease/SubIndex/GXrXiCys54g_QwXu-rFqo8</sub> | 併入疾病頁 → `disease.chikungunya`（併入：situation） | `disease.chikungunya`（既有） | 0.8 | image-no-alt | 併入疾病頁區塊（與既有內容逐段比對） |
| 4 | 傳染方式<br><sub>www.cdc.gov.tw/Disease/SubIndex/GXrXiCys54g_QwXu-rFqo8</sub> | 併入疾病頁 → `disease.chikungunya`（併入：transmission） | `disease.chikungunya`（既有） | 1 | — | 併入疾病頁區塊（與既有內容逐段比對） |
| 5 | 潛伏期<br><sub>www.cdc.gov.tw/Disease/SubIndex/GXrXiCys54g_QwXu-rFqo8</sub> | 併入疾病頁 → `disease.chikungunya`（併入：transmission） | `disease.chikungunya`（既有） | 1 | — | 併入疾病頁區塊（與既有內容逐段比對） |
| 6 | 發病症狀<br><sub>www.cdc.gov.tw/Disease/SubIndex/GXrXiCys54g_QwXu-rFqo8</sub> | 併入疾病頁 → `disease.chikungunya`（併入：symptoms） | `disease.chikungunya`（既有） | 1 | — | 併入疾病頁區塊（與既有內容逐段比對） |
| 7 | 預防方法<br><sub>www.cdc.gov.tw/Disease/SubIndex/GXrXiCys54g_QwXu-rFqo8</sub> | 併入疾病頁 → `disease.chikungunya`（併入：prevention） | `disease.chikungunya`（既有） | 1 | — | 併入疾病頁區塊（與既有內容逐段比對） |
| 8 | 治療方法與就醫資訊<br><sub>www.cdc.gov.tw/Disease/SubIndex/GXrXiCys54g_QwXu-rFqo8</sub> | 併入疾病頁 → `disease.chikungunya`（併入：treatment） | `disease.chikungunya`（既有） | 1 | — | 併入疾病頁區塊（與既有內容逐段比對） |
| 9 | 預防接種建議<br><sub>www.cdc.gov.tw/Category/MPage/f3lnBSeXfnWRIWkD7OkmyZ</sub> | 併入疾病頁 → `disease.chikungunya`（併入：vaccine） | `disease.chikungunya`（既有） | 1 | — | 併入疾病頁區塊（與既有內容逐段比對） |
| 10 | Q&A<br><sub>www.cdc.gov.tw/Category/QAPage/3TeaG2bDJdZXc_HhjDLhUo</sub> | Q&A → `faq.chik-legacy-7f51c6` | `disease.chikungunya`（既有） | 0.8 | faq-structure-missing、body-short | 既有內容已存在，供比對，不建議覆蓋 |
| 11 | 衛教宣導：單張海報<br><sub>www.cdc.gov.tw/Category/List/leuu0ZjU3Srsg0t0YuLRVJ</sub> | 出版品 → `publication.chik-materials-poster` | — | 0.8 | pdf-no-text-layer、image-no-alt | 核對後入庫（新站尚無對應內容） |
| 12 | 衛教宣導：影片<br><sub>www.cdc.gov.tw/Category/MPage/lCdtrIiE2HSyGk8GmG8O-W</sub> | 影音 → `media.chik-materials-video` | — | 0.8 | body-short、fields-pending | 核對後入庫（新站尚無對應內容） |
| 13 | 工作手冊<br><sub>www.cdc.gov.tw/Category/DiseaseManual/pb07QlV5AvIkdHfObDvQIh</sub> | 文件 → `doc.chik-manual.2018-03-01` | — | 0.8 | body-short、pdf-only | 核對後入庫（新站尚無對應內容） |
| 14 | 病例定義<br><sub>www.cdc.gov.tw/Category/DiseaseDefine/ef7hGQOobBHCZRVY-d6-hF</sub> | 文件 → `doc.chik-case-definition.2018-03-01` | — | 0.8 | body-short | 核對後入庫（新站尚無對應內容） |
| 15 | 登革熱／屈公病防治工作指引（第 17 版）<br><sub>www.cdc.gov.tw/File/Get/hesqOx-ktN79jPvenM9EIq</sub> | 文件 → `doc.guidance-dengue.v17` | `doc.guidance-dengue.v17`（既有） | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 16 | 統計資料<br><sub>www.cdc.gov.tw/Category/List/iq84oKkMOnZY9lbV-HK_xI</sub> | 資料集 → `dataset.chik-stats` | — | 1 | — | 核對後入庫（新站尚無對應內容） |
| 17 | 檢驗資訊<br><sub>www.cdc.gov.tw/Category/MPage/SNIFy3ii3EO17akRXa1KbE</sub> | 檢驗 → `labtest.chikungunya` | `labtest.chikungunya`（既有） | 1 | fields-pending | 既有內容已存在，供比對，不建議覆蓋 |
| 18 | 通報定義與時限<br><sub>www.cdc.gov.tw/Category/MPage/E1s-zP475buQxqzTg9pPmU</sub> | 頁面 → `page.chik-notify` | — | 1 | — | 核對後入庫（新站尚無對應內容） |
| 19 | 新聞稿列表<br><sub>www.cdc.gov.tw/Bulletin/List/I8xFC9Fukg1T4AJCPH3HFL</sub> | 清單頁 → `page.chik-news-list` | `disease.chikungunya`（既有） | 0.6 | — | 清單頁，不轉換（新站由系統自動產生列表） |
| 20 | 相關連結<br><sub>www.cdc.gov.tw/Category/List/77RMMq7aYTKT4nKbxyWkQw</sub> | 專區 → `topic.chikungunya-links` | — | 1 | — | 核對後入庫（新站尚無對應內容） |
| 21 | 致醫界通函第 612 號：登革熱／屈公病防治工作指引第 17 版自即日起適用<br><sub>www.cdc.gov.tw/Bulletin/Detail/SN2-gQkNjgkOiuMiM4Yidk?typeid=11</sub> | 新聞 → `news.2026-07-01-letter-dengue-guidance-v17` | — | 1 | not-in-manifest | 既有內容已存在，供比對，不建議覆蓋 |
| 22 | 致醫界通函第 603 號：登革熱／屈公病防治工作指引第 16 版公布<br><sub>www.cdc.gov.tw/Bulletin/Detail/kxZkhD9I3KnyrtiysHBMJV?typeid=11</sub> | 新聞 → `news.2025-11-11-letter-dengue-guidance-v16` | — | 1 | not-in-manifest | 既有內容已存在，供比對，不建議覆蓋 |
| 23 | 中國大陸廣東省屈公病疫情升溫，提升旅遊疫情建議至第二級<br><sub>www.cdc.gov.tw/Bulletin/Detail/tew5ADmw9UfzE2Pae9PJyP?typeid=9</sub> | 新聞 → `news.2025-08-05-chikungunya-guangdong` | — | 1 | not-in-manifest | 既有內容已存在，供比對，不建議覆蓋 |

## 需人工檢視（0 頁）

無。

## 併入疾病頁（9 頁）

- 「疾病介紹」→ `disease.chikungunya` 區塊 transmission（疾病頁既有內容已存在，供比對）
- 「致病原」→ `disease.chikungunya` 區塊 transmission（疾病頁既有內容已存在，供比對）
- 「流行病學」→ `disease.chikungunya` 區塊 situation（疾病頁既有內容已存在，供比對）
- 「傳染方式」→ `disease.chikungunya` 區塊 transmission（疾病頁既有內容已存在，供比對）
- 「潛伏期」→ `disease.chikungunya` 區塊 transmission（疾病頁既有內容已存在，供比對）
- 「發病症狀」→ `disease.chikungunya` 區塊 symptoms（疾病頁既有內容已存在，供比對）
- 「預防方法」→ `disease.chikungunya` 區塊 prevention（疾病頁既有內容已存在，供比對）
- 「治療方法與就醫資訊」→ `disease.chikungunya` 區塊 treatment（疾病頁既有內容已存在，供比對）
- 「預防接種建議」→ `disease.chikungunya` 區塊 vaccine（疾病頁既有內容已存在，供比對）

## 二級抽樣檢視名單（近年新聞 auto-ok 0 頁，抽 10% ＝ 0 頁）

本批沒有可自動上線的近年新聞。

抽樣由網址雜湊排序決定，重跑不變；公關室看完名單沒有問題，整批 auto-ok 才改 `published` 開 PR（第 7 節二級）；發現率超過 10% 就暫停自動上線、回頭修規則。

## 附件與圖片需要處理的

- 流行病學：圖片「chikungunya-trend.png」舊頁沒有替代文字，暫用檔名「chikungunya-trend」，請補 alt（needsAlt）
- 衛教宣導：單張海報：PDF「chikungunya-poster-7lang.pdf」沒有文字層（掃描檔），上架前須附同名 .md／.docx 可及性版本，或重做有文字層的 PDF
- 衛教宣導：單張海報：圖片「chikungunya-poster.png」舊頁沒有替代文字，暫用檔名「chikungunya-poster」，請補 alt（needsAlt）

## 與移轉清單的差異

- 清單有、匯出沒有：無
- 匯出有、清單沒有：21-news-2026-07-01-letter-dengue-guidance-v17、22-news-2025-11-11-letter-dengue-guidance-v16、23-news-2025-08-05-chikungunya-guangdong
- 與清單判定不同（不覆蓋，人工決定）：無
- 套用規則：只改 status／target／newPath／note，不動 verified；僅「待確認(pending)且新站已有對應內容」的項目才改 status（人工已判定的項目不被覆蓋，差異列在 conflicts）。

