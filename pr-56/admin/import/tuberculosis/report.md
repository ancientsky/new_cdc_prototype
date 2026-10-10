# 舊站匯出轉換報告：tuberculosis

> **模擬匯出**（開發環境連不到舊站，依移轉清單合成；正式匯出取代即可）。匯出日 2026-10-03；轉換時間 2026-10-05T02:30:00Z；規則檔 `content/migration/import/_import-rules.json`；移轉清單 `content/migration/tuberculosis.json`（40 筆）。

## 批次摘要

| 項目 | 數字 |
| --- | --- |
| 舊頁數 | 40 |
| 產出草稿 | 40（Q&A 8、出版品 1、影音 2、文件 10、服務 4、檢驗 1、資料集 1、頁面 11、新聞 1、疾病頁 1） |
| 舊頁型別 | 併入疾病頁 6、Q&A 3、出版品 1、影音 2、文件 10、服務 4、檢驗 1、資料集 1、頁面 8、清單頁 3、新聞 1 |
| 平均信心 | 0.95 |
| 需人工檢視（信心 < 0.6） | 1 |
| 既有內容已存在（供比對） | 36 |
| 附件與圖片 | 19（附件 16、內文圖片 2、資料檔 1；圖片待補 alt 1、PDF 無文字層 5） |
| 草稿 schema 驗證 | 40 / 40 通過 |
| 問題 | 錯誤 1、警告 18、提示 92 |
| 移轉清單對應 | 對上 40 / 40 筆；status 變化 0；note 更新 0；仍待移轉 3；與清單判定不同 0 |
| 模板推導項（清單只寫例外） | 5 項，對上 0；只列在 migration-patch.json 的 derivedItems，不寫回清單 |

處理原則：一級內容（疾病頁、指引、手冊）一律人工確認後才入庫；近年新聞信心 ≥ 0.8 可核對後自動上線；久遠與歷史版本封存；草稿放在本目錄，**不會**寫進 `content/`。

## 逐頁結果

| # | 來源 | 型別 | 目標 | 信心 | 問題 | 建議動作 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 疾病介紹<br><sub>www.cdc.gov.tw/Disease/SubIndex/5lgwbqCTQl_W6r-4Tpylxq</sub> | 併入疾病頁 → `disease.tuberculosis`（併入：transmission） | `disease.tuberculosis`（既有） | 1 | — | 併入疾病頁區塊（與既有內容逐段比對） |
| 2 | 流行病學<br><sub>www.cdc.gov.tw/Disease/SubIndex/5lgwbqCTQl_W6r-4Tpylxq</sub> | 併入疾病頁 → `disease.tuberculosis`（併入：situation） | `disease.tuberculosis`（既有） | 1 | — | 併入疾病頁區塊（與既有內容逐段比對） |
| 3 | 傳染方式與潛伏期<br><sub>www.cdc.gov.tw/Disease/SubIndex/5lgwbqCTQl_W6r-4Tpylxq</sub> | 併入疾病頁 → `disease.tuberculosis`（併入：transmission） | `disease.tuberculosis`（既有） | 1 | — | 併入疾病頁區塊（與既有內容逐段比對） |
| 4 | 臨床症狀<br><sub>www.cdc.gov.tw/Disease/SubIndex/5lgwbqCTQl_W6r-4Tpylxq</sub> | 併入疾病頁 → `disease.tuberculosis`（併入：symptoms） | `disease.tuberculosis`（既有） | 1 | — | 併入疾病頁區塊（與既有內容逐段比對） |
| 5 | 治療照護<br><sub>www.cdc.gov.tw/Disease/SubIndex/5lgwbqCTQl_W6r-4Tpylxq</sub> | 併入疾病頁 → `disease.tuberculosis`（併入：treatment） | `disease.tuberculosis`（既有） | 1 | — | 併入疾病頁區塊（與既有內容逐段比對） |
| 6 | 卡介苗接種<br><sub>www.cdc.gov.tw/Category/MPage/-yFBJL84K-ebVCy-5HNS32</sub> | 併入疾病頁 → `disease.tuberculosis`（併入：vaccine） | `disease.tuberculosis`（既有） | 1 | — | 併入疾病頁區塊（與既有內容逐段比對） |
| 7 | 結核病 Q&A<br><sub>www.cdc.gov.tw/Category/QAPage/ZW0TrgKarQJWRWZrMIWzeq</sub> | Q&A → `faq.tb-cough-two-weeks`<br>`faq.ltbi-treat-or-not`<br>`faq.tb-dots-what`<br>`faq.tb-contact-screening`<br>`faq.mdr-tb`<br>`faq.tb-treatment-cost`<br>`faq.tb-foreigner-health-check`<br>`faq.tb-contagious-after-treatment` | `disease.tuberculosis`（既有） | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 8 | Q&A：咳嗽多久要懷疑是結核病？<br><sub>www.cdc.gov.tw/Category/QAPage/O1wZbGi7vPb9z_a60WXUfb</sub> | Q&A → `faq.tb-cough-two-weeks`（重複，未輸出） | `faq.tb-cough-two-weeks`（既有） | 0.9 | duplicate-title | 既有內容已存在，供比對，不建議覆蓋 |
| 9 | Q&A：潛伏結核感染需要治療嗎？<br><sub>www.cdc.gov.tw/Category/QAPage/phF8VNqXQgWfNk3LB4BkIh</sub> | Q&A → `faq.ltbi-treat-or-not`（重複，未輸出） | `faq.ltbi-treat-or-not`（既有） | 0.9 | duplicate-title | 既有內容已存在，供比對，不建議覆蓋 |
| 10 | 宣導素材：咳嗽兩週要就醫（多國語言海報）<br><sub>www.cdc.gov.tw/Category/List/HFc75kGSabhKRWZ0sV_2Ii</sub> | 出版品 → `publication.poster-tb-seven-languages` | `publication.poster-tb-seven-languages`（既有） | 0.8 | image-no-alt、image-only、fields-pending | 既有內容已存在，供比對，不建議覆蓋 |
| 11 | 宣導素材：咳嗽兩週快去照胸部 X 光（影片）<br><sub>www.cdc.gov.tw/Category/MPage/dLJ7UFpx2F-K6hTsKuUoSK</sub> | 影音 → `media.tb-cough-two-weeks` | `media.tb-cough-two-weeks`（既有） | 1 | material-outdated | 既有內容已存在，供比對，不建議覆蓋 |
| 12 | 宣導素材：移工健康檢查（影片）<br><sub>www.cdc.gov.tw/Category/MPage/vONM9MVB6T0IMaoT_2kYS6</sub> | 影音 → `media.migrant-worker-health-check` | `media.migrant-worker-health-check`（既有） | 1 | material-outdated | 既有內容已存在，供比對，不建議覆蓋 |
| 13 | 結核病診治指引（第八版）<br><sub>www.cdc.gov.tw/File/Get/3mTpTQQFER94u5HtekRstw</sub> | 文件 → `doc.tb-guideline.2025-09-01` | `doc.tb-guideline.2025-09-01`（既有） | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 14 | 結核病診治指引（第七版）<br><sub>www.cdc.gov.tw/Uploads/archives/%E7%B5%90%E6%A0%B8%E7%97%85%E8%A8%BA%E6%B2%BB%E6%8C%87%E5%BC%95%E7%AC%AC%E4%B8%83%E7%89%88.pdf</sub> | 文件 → `doc.tb-guideline.2022-03-01` | `doc.tb-guideline.2022-03-01`（既有） | 1 | pdf-no-text-layer | 封存（歷史版本／久遠內容，舊版保留查閱） |
| 15 | 潛伏結核感染診治指引<br><sub>www.cdc.gov.tw/File/Get/Ig7qjx7eTWrpnMXjfJgp_g</sub> | 文件 → `doc.ltbi-guideline.2024-01-01` | `doc.ltbi-guideline.2024-01-01`（既有） | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 16 | 潛伏結核感染治療指引（舊版）<br><sub>www.cdc.gov.tw/Uploads/archives/%E6%BD%9B%E4%BC%8F%E7%B5%90%E6%A0%B8%E6%84%9F%E6%9F%93%E6%B2%BB%E7%99%82%E6%8C%87%E5%BC%95.pdf</sub> | 文件 → `doc.ltbi-guideline.2021-05-01` | `doc.ltbi-guideline.2024-01-01`（既有） | 1 | pdf-no-text-layer | 封存（歷史版本／久遠內容，舊版保留查閱） |
| 17 | 結核病接觸者檢查指引<br><sub>www.cdc.gov.tw/File/Get/HDxRqA-TWSdShJlGFue-UF</sub> | 文件 → `doc.tb-contact-investigation.2025-01-01` | `doc.tb-contact-investigation.2025-01-01`（既有） | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 18 | 都治計畫作業手冊<br><sub>www.cdc.gov.tw/File/Get/nXEWGwO9pZUFPxYvi2A3b1</sub> | 文件 → `doc.dots-manual.2025-01-01` | `doc.dots-manual.2025-01-01`（既有） | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 19 | 結核病防治工作手冊<br><sub>www.cdc.gov.tw/File/Get/IYwaS2qZ19saaWSRCrUUT8</sub> | 文件 → `doc.tb-manual.2025-07-01` | `doc.tb-manual.2025-07-01`（既有） | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 20 | 結核病防治工作手冊（2019 年版）<br><sub>www.cdc.gov.tw/Uploads/archives/%E7%B5%90%E6%A0%B8%E7%97%85%E9%98%B2%E6%B2%BB%E5%B7%A5%E4%BD%9C%E6%89%8B%E5%86%8A2019%E5%B9%B4%E7%89%88.pdf</sub> | 文件 → `doc.tb-manual.2019-06-28` | `doc.tb-manual.2025-07-01`（既有） | 1 | pdf-no-text-layer | 封存（歷史版本／久遠內容，舊版保留查閱） |
| 21 | 結核病病例定義<br><sub>www.cdc.gov.tw/Category/DiseaseDefine/u-4_D_c5j4hXi35nyiejt2</sub> | 文件 → `doc.tb-case-definition.2024-01-01` | `doc.tb-case-definition.2024-01-01`（既有） | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 22 | 通報方式與時限<br><sub>www.cdc.gov.tw/Category/MPage/_5VNYfUzdaN4SoFJHvW42f</sub> | 服務 → `service.notifiable-disease-report` | `service.notifiable-disease-report`（既有） | 1 | fields-pending | 既有內容已存在，供比對，不建議覆蓋 |
| 23 | 檢驗方法與送驗須知<br><sub>www.cdc.gov.tw/Category/MPage/pcLTri1XT4Q2NERg39nz5q</sub> | 檢驗 → `labtest.tuberculosis` | `labtest.tuberculosis`（既有） | 1 | fields-pending | 既有內容已存在，供比對，不建議覆蓋 |
| 24 | 統計資料<br><sub>www.cdc.gov.tw/Category/List/IR-4OsM3biF9t30fng00vq</sub> | 資料集 → `dataset.tb-new-cases` | `dataset.tb-new-cases`（既有） | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 25 | 結核病年報（歷年 PDF）<br><sub>www.cdc.gov.tw/InfectionReport/Info/lOWhr-dnr1fNWIqZk4Cs7-?infoId=xxTRr6Bf6B76t5rbVE96_K</sub> | 文件 → `doc.tb-annual-report.2025-12-31` | — | 1 | pdf-no-text-layer | 核對後入庫（新站尚無對應內容） |
| 26 | 都治（DOTS）<br><sub>www.cdc.gov.tw/Category/MPage/y1AAQLAWnwCkChJ47vLGQu</sub> | 頁面 → `page.tb-dots` | `topic.tb-prevention`（既有） | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 27 | 潛伏結核感染治療<br><sub>www.cdc.gov.tw/Category/MPage/SuRWu-xWEvR_vwhU83fFUs</sub> | 服務 → `service.ltbi-treatment` | `service.ltbi-treatment`（既有） | 1 | fields-pending | 既有內容已存在，供比對，不建議覆蓋 |
| 28 | 接觸者檢查<br><sub>www.cdc.gov.tw/Category/MPage/fUCzVjg4lAfhr5qje-Wbco</sub> | 頁面 → `page.tb-contact` | `faq.tb-contact-screening`（既有） | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 29 | 多重抗藥性結核病醫療照護體系<br><sub>www.cdc.gov.tw/Category/MPage/mdK6J8sUBWYkJgJXrH5hj2</sub> | 頁面 → `page.tb-mdr` | `topic.tb-prevention`（既有） | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 30 | 抗藥性結核病醫療照護團隊醫院名單<br><sub>www.cdc.gov.tw/Category/ListContent/KMmkJs7_fOvZYL0fDztyGW?uaid=gudmfQEkqWG4QWSZAdoP5Z</sub> | 服務 → `service.tb-mdr-hospitals` | — | 0.8 | table-complex、fields-pending | 核對後入庫（新站尚無對應內容） |
| 31 | 2035 消除結核計畫<br><sub>www.cdc.gov.tw/Category/MPage/8qbI2ymDafiYDFkyATCn3b</sub> | 頁面 → `page.tb-end-tb-2035` | `topic.tb-prevention`（既有） | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 32 | 高風險族群主動篩檢<br><sub>www.cdc.gov.tw/Category/MPage/QNBeCudZadf6-VS4ehcEWG</sub> | 頁面 → `page.tb-high-risk` | `topic.tb-prevention`（既有） | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 33 | 結核病醫療費用補助及隔離治療<br><sub>www.cdc.gov.tw/Category/MPage/RciPYzg3oErAFrFO2Edl3L</sub> | 服務 → `service.tb-treatment-subsidy` | `service.tb-treatment-subsidy`（既有） | 1 | fields-pending | 既有內容已存在，供比對，不建議覆蓋 |
| 34 | 外籍人士健康檢查（結核病）<br><sub>www.cdc.gov.tw/Category/MPage/814q4fuhEVCRH7GDoiAzke</sub> | 頁面 → `page.tb-foreigner` | `faq.tb-foreigner-health-check`（既有） | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 35 | 研究成果：移工結核病主動發現<br><sub>www.cdc.gov.tw/Category/ListContent/rTAhO0NMCur-GMHYSvii6e?uaid=W09HLe2JIEXHgC3OOrpAfv</sub> | 頁面 → `page.tb-research` | `research.2025-migrant-tb-active-case-finding`（既有） | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 36 | 結核病教育訓練教材（投影片）<br><sub>www.cdc.gov.tw/Category/List/IAhbEkxy103_prlTA55Skx</sub> | 清單頁 → `page.tb-training-slides` | — | 0.5 ⚠ | pdf-no-text-layer、attachment-missing | 人工檢視（信心低於門檻） |
| 37 | 相關連結<br><sub>www.cdc.gov.tw/Category/List/N7LF9kGyYxIzbeM88kVJXH</sub> | 清單頁 → `page.tb-links` | `topic.tb-prevention`（既有） | 0.6 | — | 清單頁，不轉換（新站由系統自動產生列表） |
| 38 | 結核病最新消息<br><sub>www.cdc.gov.tw/Bulletin/List/8RWYNAmObrDrqgCST1ai3c?page=1</sub> | 清單頁 → `page.tb-news-list` | `disease.tuberculosis`（既有） | 0.6 | — | 清單頁，不轉換（新站由系統自動產生列表） |
| 39 | 新聞稿：世界結核病日：咳嗽兩週請就醫，接觸者檢查與潛伏感染治療守護家人<br><sub>www.cdc.gov.tw/Bulletin/Detail/r-IuRzP7x9VBeDmGKGqejB?typeid=9</sub> | 新聞 → `news.2025-03-24-world-tb-day` | `news.2025-03-24-world-tb-day`（既有） | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 40 | 2019 世界結核病日健走活動報名<br><sub>www.cdc.gov.tw/Category/Page/QQKO4J2F-vQx1ycSsRZ0nI</sub> | 頁面 → `page.tb-event-2019` | — | 1 | — | 不轉換（久遠且已結束，建議 410） |

## 需人工檢視（1 頁）

- **結核病教育訓練教材（投影片）**（信心 0.5）
  - 警告：PDF「tb-training-part1.pdf」沒有文字層（掃描檔），上架前須附同名 .md／.docx 可及性版本，或重做有文字層的 PDF
  - 錯誤：附件「tb-training-part2.pdf」在匯出的 files/ 找不到

## 併入疾病頁（6 頁）

- 「疾病介紹」→ `disease.tuberculosis` 區塊 transmission（疾病頁既有內容已存在，供比對）
- 「流行病學」→ `disease.tuberculosis` 區塊 situation（疾病頁既有內容已存在，供比對）
- 「傳染方式與潛伏期」→ `disease.tuberculosis` 區塊 transmission（疾病頁既有內容已存在，供比對）
- 「臨床症狀」→ `disease.tuberculosis` 區塊 symptoms（疾病頁既有內容已存在，供比對）
- 「治療照護」→ `disease.tuberculosis` 區塊 treatment（疾病頁既有內容已存在，供比對）
- 「卡介苗接種」→ `disease.tuberculosis` 區塊 vaccine（疾病頁既有內容已存在，供比對）

## 二級抽樣檢視名單（近年新聞 auto-ok 0 頁，抽 10% ＝ 0 頁）

本批沒有可自動上線的近年新聞。

抽樣由網址雜湊排序決定，重跑不變；公關室看完名單沒有問題，整批 auto-ok 才改 `published` 開 PR（第 7 節二級）；發現率超過 10% 就暫停自動上線、回頭修規則。

## 附件與圖片需要處理的

- 宣導素材：咳嗽兩週要就醫（多國語言海報）：圖片「tb-poster-7lang-thumb.png」舊頁沒有替代文字，暫用圖片標題「結核病七語衛教海報縮圖」，請補 alt（needsAlt）
- 結核病診治指引（第七版）：PDF「結核病診治指引第七版.pdf」沒有文字層（掃描檔），上架前須附同名 .md／.docx 可及性版本，或重做有文字層的 PDF
- 潛伏結核感染治療指引（舊版）：PDF「潛伏結核感染治療指引.pdf」沒有文字層（掃描檔），上架前須附同名 .md／.docx 可及性版本，或重做有文字層的 PDF
- 結核病防治工作手冊（2019 年版）：PDF「結核病防治工作手冊2019年版.pdf」沒有文字層（掃描檔），上架前須附同名 .md／.docx 可及性版本，或重做有文字層的 PDF
- 結核病年報（歷年 PDF）：PDF「tb-annual-report-2024.pdf」沒有文字層（掃描檔），上架前須附同名 .md／.docx 可及性版本，或重做有文字層的 PDF
- 結核病教育訓練教材（投影片）：PDF「tb-training-part1.pdf」沒有文字層（掃描檔），上架前須附同名 .md／.docx 可及性版本，或重做有文字層的 PDF
- 結核病教育訓練教材（投影片）：附件「tb-training-part2.pdf」在匯出的 files/ 找不到

## 與移轉清單的差異

- 清單有、匯出沒有：無
- 匯出有、清單沒有：無
- 與清單判定不同（不覆蓋，人工決定）：無
- 套用規則：只改 status／target／newPath／note，不動 verified；僅「待確認(pending)且新站已有對應內容」的項目才改 status（人工已判定的項目不被覆蓋，差異列在 conflicts）。

