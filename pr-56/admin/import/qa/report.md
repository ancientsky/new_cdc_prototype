# 舊站匯出轉換報告：qa

> **模擬匯出**（開發環境連不到舊站，依移轉清單合成；正式匯出取代即可）。匯出日 2026-10-03；轉換時間 2026-10-05T02:30:00Z；規則檔 `content/migration/import/_import-rules.json`；移轉清單 `content/migration/qa.json`（13 筆）。

## 批次摘要

| 項目 | 數字 |
| --- | --- |
| 舊頁數 | 15 |
| 產出草稿 | 34（Q&A 33、頁面 1） |
| 舊頁型別 | Q&A 14、清單頁 1 |
| 平均信心 | 0.95 |
| 需人工檢視（信心 < 0.6） | 0 |
| 既有內容已存在（供比對） | 10 |
| 附件與圖片 | 0（附件 0、內文圖片 0、資料檔 0；圖片待補 alt 0、PDF 無文字層 0） |
| 草稿 schema 驗證 | 34 / 34 通過 |
| 問題 | 錯誤 0、警告 6、提示 52 |
| 移轉清單對應 | 對上 13 / 13 筆；status 變化 0；note 更新 0；仍待移轉 6；與清單判定不同 0 |
| 清單沒有的舊頁 | 2（migration-patch.json 的 unmatchedPages 有建議的 pending 項目） |

處理原則：一級內容（疾病頁、指引、手冊）一律人工確認後才入庫；近年新聞信心 ≥ 0.8 可核對後自動上線；久遠與歷史版本封存；草稿放在本目錄，**不會**寫進 `content/`。

## 逐頁結果

| # | 來源 | 型別 | 目標 | 信心 | 問題 | 建議動作 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 新冠併發重症 Q&A<br><sub>www.cdc.gov.tw/Category/QAPage/BvAeVrOkFy2tQv8lwkcQXM</sub> | Q&A → `faq.covid-antiviral`<br>`faq.covid-vaccine-who`<br>`faq.flu-covid-same-day` | `disease.covid-19`（既有） | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 2 | Dengue Fever FAQ<br><sub>www.cdc.gov.tw/En/Category/QAPage/MZc3ZyAJNuiEZUIBNEvj4Z</sub> | Q&A → `faq.dengue-legacy-4db8ab`<br>`faq.dengue-legacy-13c7cc`<br>`faq.dengue-legacy-c72cba` | — | 1 | needs-source-zh | 核對後入庫（新站尚無對應內容） |
| 3 | Q&A<br><sub>www.cdc.gov.tw/Category/QAPage/4kMzhnwTwPIrf_KETxhqzF</sub> | Q&A → `faq.dengue-community-mobilize`（重複，未輸出）<br>`faq.dengue-container-check`（重複，未輸出）<br>`faq.dengue-fever-when-to-see-doctor`（重複，未輸出）<br>`faq.dengue-imported-return`（重複，未輸出）<br>`faq.dengue-painkiller`（重複，未輸出）<br>`faq.dengue-spraying-refuse`（重複，未輸出）<br>`faq.travel-return-fever`（重複，未輸出） | — | 1 | — | 已在其他批次轉過（同網址），本批不重複出草稿 |
| 4 | 113 年度公費流感疫苗接種 Q&A<br><sub>www.cdc.gov.tw/Category/QAPage/zU9zOhcsoqjv8REH6XHH-Y</sub> | Q&A → `faq.influenza-legacy-286a86`<br>`faq.influenza-legacy-d3274b`<br>`faq.influenza-legacy-28a4c0` | — | 1 | answer-dated、answer-dated、answer-dated | 核對後入庫（新站尚無對應內容） |
| 5 | 急性病毒性B型肝炎 Q&A<br><sub>www.cdc.gov.tw/Category/QAPage/AOyssgHzaQZuuM8MdMmEDw</sub> | Q&A → `faq.hepb-newborn` | `faq.hepb-newborn`（既有） | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 6 | 人類免疫缺乏病毒感染 Q&A<br><sub>www.cdc.gov.tw/Category/QAPage/StC0qbIcZz2pDen8xIEI0x</sub> | Q&A → `faq.hiv-pep`<br>`faq.hiv-test-where` | `disease.hiv`（既有） | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 7 | 百日咳 Q&A<br><sub>www.cdc.gov.tw/Category/QAPage/brTyOBKZhav8nqkwfudS5x</sub> | Q&A → `faq.pregnant-tdap` | `disease.pertussis`（既有） | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 8 | 謠言澄清常見問答<br><sub>www.cdc.gov.tw/Category/QAPage/Y6mjmeVxUGO8zXmBiXV284</sub> | Q&A → `faq.rumor-mmr-autism`<br>`faq.rumor-sms-link`<br>`faq.x-legacy-74dfc3` | — | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 9 | 被狗、貓或野生動物咬傷該怎麼辦？<br><sub>www.cdc.gov.tw/Category/QAPage/OEo24-Y1ZChzoCUaupYf1K</sub> | Q&A → `faq.rabies-bite` | `faq.rabies-bite`（既有） | 0.8 | faq-structure-missing | 既有內容已存在，供比對，不建議覆蓋 |
| 10 | 統計資料常見問答<br><sub>www.cdc.gov.tw/Category/QAPage/4VcQG32UMghZ8yHk42hUVQ</sub> | Q&A → `faq.stats-ili-rate`<br>`faq.stats-where-data`<br>`faq.x-legacy-378f51` | — | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 11 | 國際旅遊常見問答<br><sub>www.cdc.gov.tw/Category/QAPage/oDFvYopfPTouRB6a4gWcs5</sub> | Q&A → `faq.travel-clinic`<br>`faq.travel-japan-measles`<br>`faq.travel-malaria-prevention`<br>`faq.travel-return-fever`<br>`faq.yellow-fever-certificate`<br>`faq.x-legacy-3456c6` | — | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 12 | 結核病 Q&A<br><sub>www.cdc.gov.tw/Category/QAPage/ZW0TrgKarQJWRWZrMIWzeq</sub> | Q&A → `faq.tb-cough-two-weeks`（重複，未輸出）<br>`faq.ltbi-treat-or-not`（重複，未輸出）<br>`faq.tb-dots-what`（重複，未輸出）<br>`faq.tb-contact-screening`（重複，未輸出）<br>`faq.mdr-tb`（重複，未輸出）<br>`faq.tb-treatment-cost`（重複，未輸出）<br>`faq.tb-foreigner-health-check`（重複，未輸出）<br>`faq.tb-contagious-after-treatment`（重複，未輸出） | — | 1 | — | 已在其他批次轉過（同網址），本批不重複出草稿 |
| 13 | 預防接種常見問答<br><sub>www.cdc.gov.tw/Category/QAPage/5CWvlVkPteCHZwIes6tUPQ</sub> | Q&A → `faq.hpv-vaccine-who`<br>`faq.pcv-elderly`<br>`faq.bcg-when`<br>`faq.flu-vaccine-every-year`<br>`faq.varicella-vaccine-doses`<br>`faq.x-legacy-fafc41`<br>`faq.x-legacy-be6f07` | — | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 14 | 水痘併發症 Q&A<br><sub>www.cdc.gov.tw/Category/QAPage/y8nJ_XO0gNtPWKylGVhLGv</sub> | Q&A → `faq.varicella-vaccine-doses`（重複，未輸出） | `disease.varicella`（既有） | 0.9 | duplicate-title | 既有內容已存在，供比對，不建議覆蓋 |
| 15 | 常見問答總覽<br><sub>www.cdc.gov.tw/Category/List/C9F0xuVE7Hy5VGtc-zHtDW</sub> | 清單頁 → `page.x-qa-list` | — | 0.6 | — | 清單頁，不轉換（新站由系統自動產生列表） |

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
- 匯出有、清單沒有：03-dengue-qa、12-tuberculosis-qa
- 與清單判定不同（不覆蓋，人工決定）：無
- 套用規則：只改 status／target／newPath／note，不動 verified；僅「待確認(pending)且新站已有對應內容」的項目才改 status（人工已判定的項目不被覆蓋，差異列在 conflicts）。

