# 舊站匯出轉換報告：enterovirus

> **模擬匯出**（開發環境連不到舊站，依移轉清單合成；正式匯出取代即可）。匯出日 2026-10-03；轉換時間 2026-10-05T02:30:00Z；規則檔 `content/migration/import/_import-rules.json`；移轉清單 `content/migration/enterovirus.json`（8 筆）。

## 批次摘要

| 項目 | 數字 |
| --- | --- |
| 舊頁數 | 31 |
| 產出草稿 | 27（Q&A 6、出版品 1、文件 4、資料集 1、檢驗 1、頁面 5、專區 1、服務 1、影音 1、新聞 4、致醫界通函 1、疾病頁 1） |
| 舊頁型別 | 併入疾病頁 10、Q&A 1、出版品 1、文件 4、資料集 1、檢驗 1、頁面 3、清單頁 2、專區 1、服務 1、影音 1、新聞 5 |
| 平均信心 | 0.94 |
| 需人工檢視（信心 < 0.6） | 0 |
| 既有內容已存在（供比對） | 24 |
| 附件與圖片 | 8（附件 5、內文圖片 2、資料檔 1；圖片待補 alt 2、PDF 無文字層 1） |
| 草稿 schema 驗證 | 27 / 27 通過 |
| 問題 | 錯誤 0、警告 11、提示 103 |
| 移轉清單對應 | 對上 8 / 8 筆；status 變化 0；note 更新 0；仍待移轉 1；與清單判定不同 0 |
| 模板推導項（清單只寫例外） | 18 項，對上 18；只列在 migration-patch.json 的 derivedItems，不寫回清單 |
| 清單沒有的舊頁 | 5（migration-patch.json 的 unmatchedPages 有建議的 pending 項目） |

處理原則：一級內容（疾病頁、指引、手冊）一律人工確認後才入庫；近年新聞信心 ≥ 0.8 可核對後自動上線；久遠與歷史版本封存；草稿放在本目錄，**不會**寫進 `content/`。

## 逐頁結果

| # | 來源 | 型別 | 目標 | 信心 | 問題 | 建議動作 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 疾病介紹<br><sub>www.cdc.gov.tw/Disease/SubIndex/Iu9YFpq5oVR8kXQibQB-Lt</sub> | 併入疾病頁 → `disease.enterovirus`（併入：transmission） | `disease.enterovirus`（既有） | 1 | — | 併入疾病頁區塊（與既有內容逐段比對） |
| 2 | 致病原<br><sub>www.cdc.gov.tw/Disease/SubIndex/Iu9YFpq5oVR8kXQibQB-Lt</sub> | 併入疾病頁 → `disease.enterovirus`（併入：transmission） | `disease.enterovirus`（既有） | 1 | — | 併入疾病頁區塊（與既有內容逐段比對） |
| 3 | 流行病學<br><sub>www.cdc.gov.tw/Disease/SubIndex/Iu9YFpq5oVR8kXQibQB-Lt</sub> | 併入疾病頁 → `disease.enterovirus`（併入：situation） | `disease.enterovirus`（既有） | 0.8 | image-no-alt | 併入疾病頁區塊（與既有內容逐段比對） |
| 4 | 傳染方式<br><sub>www.cdc.gov.tw/Disease/SubIndex/Iu9YFpq5oVR8kXQibQB-Lt</sub> | 併入疾病頁 → `disease.enterovirus`（併入：transmission） | `disease.enterovirus`（既有） | 1 | — | 併入疾病頁區塊（與既有內容逐段比對） |
| 5 | 潛伏期<br><sub>www.cdc.gov.tw/Disease/SubIndex/Iu9YFpq5oVR8kXQibQB-Lt</sub> | 併入疾病頁 → `disease.enterovirus`（併入：transmission） | `disease.enterovirus`（既有） | 1 | — | 併入疾病頁區塊（與既有內容逐段比對） |
| 6 | 發病症狀<br><sub>www.cdc.gov.tw/Disease/SubIndex/Iu9YFpq5oVR8kXQibQB-Lt</sub> | 併入疾病頁 → `disease.enterovirus`（併入：symptoms） | `disease.enterovirus`（既有） | 1 | — | 併入疾病頁區塊（與既有內容逐段比對） |
| 7 | 預防方法<br><sub>www.cdc.gov.tw/Disease/SubIndex/Iu9YFpq5oVR8kXQibQB-Lt</sub> | 併入疾病頁 → `disease.enterovirus`（併入：prevention） | `disease.enterovirus`（既有） | 1 | — | 併入疾病頁區塊（與既有內容逐段比對） |
| 8 | 治療方法與就醫資訊<br><sub>www.cdc.gov.tw/Disease/SubIndex/Iu9YFpq5oVR8kXQibQB-Lt</sub> | 併入疾病頁 → `disease.enterovirus`（併入：treatment） | `disease.enterovirus`（既有） | 1 | — | 併入疾病頁區塊（與既有內容逐段比對） |
| 9 | 預防接種建議<br><sub>www.cdc.gov.tw/Category/MPage/bdPocx77c0cRnTw5pV_G4Y</sub> | 併入疾病頁 → `disease.enterovirus`（併入：vaccine） | `disease.enterovirus`（既有） | 1 | — | 併入疾病頁區塊（與既有內容逐段比對） |
| 10 | Q&A<br><sub>www.cdc.gov.tw/Category/QAPage/zID4oBmzvgDWu3fb9-fOlP</sub> | Q&A → `faq.enterovirus-childcare-disinfect`<br>`faq.enterovirus-class-suspension`<br>`faq.enterovirus-return-school`<br>`faq.ev-severe-signs`<br>`faq.ev-stay-home`<br>`faq.ev71-vaccine` | `disease.enterovirus`（既有） | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 11 | 衛教宣導：單張海報<br><sub>www.cdc.gov.tw/Category/List/56ss3snA1H2Mgxy9BNSOs3</sub> | 出版品 → `publication.enterovirus-materials-poster` | — | 0.8 | pdf-no-text-layer、image-no-alt | 核對後入庫（新站尚無對應內容） |
| 12 | 傳染病防治工作手冊（2026 年版）<br><sub>www.cdc.gov.tw/Category/DiseaseManual/6y1bSwV46VS9GwNJJXyRai</sub> | 文件 → `doc.enterovirus-manual.2026-01-01` | — | 1 | — | 核對後入庫（新站尚無對應內容） |
| 13 | 病例定義<br><sub>www.cdc.gov.tw/Category/DiseaseDefine/ahqwMH4BvVvYe2hgDtm53l</sub> | 文件 → `doc.enterovirus-case-definition.2017-04-01` | — | 0.8 | body-short | 核對後入庫（新站尚無對應內容） |
| 14 | 統計資料<br><sub>www.cdc.gov.tw/Category/List/Yb1FWIwSMecXeT6vLUmIMf</sub> | 資料集 → `dataset.ev-lab-types` | `dataset.ev-lab-types`（既有） | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 15 | 檢驗資訊<br><sub>www.cdc.gov.tw/Category/MPage/iudh9pwKq4SQ9Oqzy_UBOH</sub> | 檢驗 → `labtest.enterovirus` | `labtest.enterovirus`（既有） | 1 | fields-pending | 既有內容已存在，供比對，不建議覆蓋 |
| 16 | 通報定義與時限<br><sub>www.cdc.gov.tw/Category/MPage/Wo5A9PG4FAHfk5guqQMY4D</sub> | 頁面 → `page.enterovirus-notify` | — | 1 | — | 核對後入庫（新站尚無對應內容） |
| 17 | 新聞稿列表<br><sub>www.cdc.gov.tw/Bulletin/List/vEuUWp4k0BNJpajvJT8uC8</sub> | 清單頁 → `page.enterovirus-news-list` | `disease.enterovirus`（既有） | 0.6 | — | 清單頁，不轉換（新站由系統自動產生列表） |
| 18 | 相關連結<br><sub>www.cdc.gov.tw/Category/List/-Eb5hH3dNxaSbt0ybYI10D</sub> | 專區 → `topic.enterovirus-links` | — | 1 | — | 核對後入庫（新站尚無對應內容） |
| 19 | 腸病毒防治專區（首頁）<br><sub>www.cdc.gov.tw/Category/Page/6QsvXrxmvoS6chnGweHl7I</sub> | 頁面 → `page.enterovirus-ev-zone` | `disease.enterovirus`（既有） | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 20 | 教托育機構腸病毒防治指引<br><sub>www.cdc.gov.tw/File/Get/fkUlQvd40ukJzqzUefwg9A</sub> | 文件 → `doc.ev-childcare-guideline.2026-09-10` | `doc.ev-childcare-guideline.2026-09-10`（既有） | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 21 | 停課標準與疫情通報<br><sub>www.cdc.gov.tw/Category/MPage/qsqJZnirkyFTBcEqWteQUP</sub> | 頁面 → `page.enterovirus-ev-closure-reporting` | `doc.ev-childcare-guideline.2026-09-10`（既有） | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 22 | 腸病毒重症責任醫院名單與轉診<br><sub>www.cdc.gov.tw/Category/List/iyz5F1b33RPU4U1vHHhEDZ</sub> | 服務 → `service.enterovirus-ev-severe-referral` | — | 0.6 | fields-pending | 核對後入庫（新站尚無對應內容） |
| 23 | 腸病毒感染併發重症臨床處置建議<br><sub>www.cdc.gov.tw/File/Get/oHnPdrO-w-2YIcCWeYTP3G</sub> | 文件 → `doc.ev-severe-guideline.2026-03-15` | `doc.ev-severe-guideline.2026-03-15`（既有） | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 24 | 腸病毒 71 型疫苗專區<br><sub>www.cdc.gov.tw/Category/Page/R2F77pt9zJJc5cEQmtZvK5</sub> | 併入疾病頁 → `disease.enterovirus`（併入：vaccine） | `vaccine.ev71`（既有） | 1 | — | 併入疾病頁區塊（與既有內容逐段比對） |
| 25 | 影音：濕搓沖捧擦洗手五步驟動畫<br><sub>www.cdc.gov.tw/Category/List/JbY6pDjC4E4EqK3t6BqYbO</sub> | 影音 → `media.enterovirus-handwashing` | `media.enterovirus-handwashing`（既有） | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 26 | 歷年腸病毒宣導海報（2015–2020）<br><sub>www.cdc.gov.tw/Category/List/8IVdKC4pjZdeWmG6RDVZ3e</sub> | 清單頁 → `page.enterovirus-ev-old-posters` | — | 0.6 | — | 清單頁，不轉換（新站由系統自動產生列表） |
| 27 | 流感疫情持續上升，10 月 1 日公費疫苗開打，長者幼兒請優先接種<br><sub>www.cdc.gov.tw/Bulletin/Detail/kJcoSqz2YA_c0mIGh5-Ljw?typeid=9</sub> | 新聞 → `news.2026-09-29-ili-weekly` | — | 1 | not-in-manifest | 既有內容已存在，供比對，不建議覆蓋 |
| 28 | 國內腸病毒疫情持續，籲請家長及教托育機構提高警覺<br><sub>www.cdc.gov.tw/Bulletin/Detail/cIPa4RUZinjpiHBlwV9Gfp?typeid=9</sub> | 新聞 → `news.2026-09-22-enterovirus-alert` | — | 1 | not-in-manifest | 既有內容已存在，供比對，不建議覆蓋 |
| 29 | 腸病毒就診人次連續上升，近期社區以 EV71 為主，籲請提高警覺<br><sub>www.cdc.gov.tw/Bulletin/Detail/kuSB3T4l2c-Tg6jlKwK0B8?typeid=9</sub> | 新聞 → `news.2026-04-14-enterovirus-rising` | — | 1 | not-in-manifest | 既有內容已存在，供比對，不建議覆蓋 |
| 30 | 致醫界通函第 608 號：腸病毒感染併發重症臨床處置建議更新<br><sub>www.cdc.gov.tw/Bulletin/Detail/LDmeZqcbZuzmNJgOHhV9pm?typeid=11</sub> | 新聞 → `news.2026-03-15-letter-ev-guideline` | — | 1 | not-in-manifest | 既有內容已存在，供比對，不建議覆蓋 |
| 31 | 腸病毒進入流行期，籲請家長落實肥皂洗手並留意重症前兆<br><sub>www.cdc.gov.tw/Bulletin/Detail/u1nGI08LsIuXP_KlaNZZfl?typeid=9</sub> | 新聞 → `news.2025-05-06-enterovirus-season` | — | 1 | not-in-manifest | 既有內容已存在，供比對，不建議覆蓋 |

## 需人工檢視（0 頁）

無。

## 併入疾病頁（10 頁）

- 「疾病介紹」→ `disease.enterovirus` 區塊 transmission（疾病頁既有內容已存在，供比對）
- 「致病原」→ `disease.enterovirus` 區塊 transmission（疾病頁既有內容已存在，供比對）
- 「流行病學」→ `disease.enterovirus` 區塊 situation（疾病頁既有內容已存在，供比對）
- 「傳染方式」→ `disease.enterovirus` 區塊 transmission（疾病頁既有內容已存在，供比對）
- 「潛伏期」→ `disease.enterovirus` 區塊 transmission（疾病頁既有內容已存在，供比對）
- 「發病症狀」→ `disease.enterovirus` 區塊 symptoms（疾病頁既有內容已存在，供比對）
- 「預防方法」→ `disease.enterovirus` 區塊 prevention（疾病頁既有內容已存在，供比對）
- 「治療方法與就醫資訊」→ `disease.enterovirus` 區塊 treatment（疾病頁既有內容已存在，供比對）
- 「預防接種建議」→ `disease.enterovirus` 區塊 vaccine（疾病頁既有內容已存在，供比對）
- 「腸病毒 71 型疫苗專區」→ `disease.enterovirus` 區塊 vaccine（疾病頁既有內容已存在，供比對）

## 二級抽樣檢視名單（近年新聞 auto-ok 0 頁，抽 10% ＝ 0 頁）

本批沒有可自動上線的近年新聞。

抽樣由網址雜湊排序決定，重跑不變；公關室看完名單沒有問題，整批 auto-ok 才改 `published` 開 PR（第 7 節二級）；發現率超過 10% 就暫停自動上線、回頭修規則。

## 附件與圖片需要處理的

- 流行病學：圖片「enterovirus-trend.png」舊頁沒有替代文字，暫用檔名「enterovirus-trend」，請補 alt（needsAlt）
- 衛教宣導：單張海報：PDF「enterovirus-poster-7lang.pdf」沒有文字層（掃描檔），上架前須附同名 .md／.docx 可及性版本，或重做有文字層的 PDF
- 衛教宣導：單張海報：圖片「enterovirus-poster.png」舊頁沒有替代文字，暫用檔名「enterovirus-poster」，請補 alt（needsAlt）

## 與移轉清單的差異

- 清單有、匯出沒有：無
- 匯出有、清單沒有：27-news-2026-09-29-ili-weekly、28-news-2026-09-22-enterovirus-alert、29-news-2026-04-14-enterovirus-rising、30-news-2026-03-15-letter-ev-guideline、31-news-2025-05-06-enterovirus-season
- 與清單判定不同（不覆蓋，人工決定）：無
- 套用規則：只改 status／target／newPath／note，不動 verified；僅「待確認(pending)且新站已有對應內容」的項目才改 status（人工已判定的項目不被覆蓋，差異列在 conflicts）。

