# 舊站匯出轉換報告：guidelines

> **模擬匯出**（開發環境連不到舊站，依移轉清單合成；正式匯出取代即可）。匯出日 2026-10-03；轉換時間 2026-10-05T02:30:00Z；規則檔 `content/migration/import/_import-rules.json`；移轉清單 `content/migration/guidelines.json`（26 筆）。

## 批次摘要

| 項目 | 數字 |
| --- | --- |
| 舊頁數 | 26 |
| 產出草稿 | 32（文件 31、頁面 1） |
| 舊頁型別 | 文件 25、清單頁 1 |
| 平均信心 | 0.97 |
| 需人工檢視（信心 < 0.6） | 0 |
| 既有內容已存在（供比對） | 21 |
| 附件與圖片 | 31（附件 31、內文圖片 0、資料檔 0；圖片待補 alt 0、PDF 無文字層 1） |
| 草稿 schema 驗證 | 32 / 32 通過 |
| 問題 | 錯誤 0、警告 5、提示 115 |
| 移轉清單對應 | 對上 26 / 26 筆；status 變化 0；note 更新 0；仍待移轉 4；與清單判定不同 0 |

處理原則：一級內容（疾病頁、指引、手冊）一律人工確認後才入庫；近年新聞信心 ≥ 0.8 可核對後自動上線；久遠與歷史版本封存；草稿放在本目錄，**不會**寫進 `content/`。

## 逐頁結果

| # | 來源 | 型別 | 目標 | 信心 | 問題 | 建議動作 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 傳染病病例定義：登革熱（2026 年版）<br><sub>www.cdc.gov.tw/Category/MPage/tWFvK3bPGVcG4STNN7K0AJ</sub> | 文件 → `doc.case-definition-dengue.2026-01-01`<br>`doc.case-definition-dengue.2023-01-01` | `doc.case-definition-dengue.2026-01-01`（既有） | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 2 | 傳染病病例定義：麻疹<br><sub>www.cdc.gov.tw/Category/MPage/TFUycDkXCfricFUt5j-XxJ</sub> | 文件 → `doc.case-definition-measles.2024-01-01` | `doc.case-definition-measles.2024-01-01`（既有） | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 3 | 新冠疫苗接種建議（2026–2027 年度）<br><sub>www.cdc.gov.tw/Category/MPage/2G_kk9OEXNAmMOsndOv0Tc</sub> | 文件 → `doc.covid-vaccine-recommendation.2026-09-15`<br>`doc.covid-vaccine-recommendation.2025-09-15` | `doc.covid-vaccine-recommendation.2026-09-15`（既有） | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 4 | 人口密集機構感染管制措施指引<br><sub>www.cdc.gov.tw/Category/DiseaseTeach/nAusiBUYAdEsBLO31lifRN</sub> | 文件 → `doc.x-crowded-ic-guideline.2025-06-30` | — | 0.8 | body-short、pdf-only | 核對後入庫（新站尚無對應內容） |
| 5 | 登革熱社區防治工作指引：孳生源清除、病媒蚊監測與群聚應變<br><sub>www.cdc.gov.tw/Category/MPage/2hJk9W1XoDaTFEiv0r6x2o</sub> | 文件 → `doc.dengue-community-workplan.2026-09-10` | `doc.dengue-community-workplan.2026-09-10`（既有） | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 6 | 結核病都治（DOTS）計畫作業手冊<br><sub>www.cdc.gov.tw/Category/MPage/yNrS2lvYiqdFRi0xisvyGW</sub> | 文件 → `doc.dots-manual.2025-01-01` | `doc.dots-manual.2025-01-01`（既有） | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 7 | 教托育機構腸病毒防治指引<br><sub>www.cdc.gov.tw/Category/MPage/R-VAtCncWwVYC1rBBa5wpf</sub> | 文件 → `doc.ev-childcare-guideline.2026-09-10` | `doc.ev-childcare-guideline.2026-09-10`（既有） | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 8 | 腸病毒感染併發重症臨床處置建議<br><sub>www.cdc.gov.tw/Category/MPage/m70l0M3H8QLwZUchC8H0WU</sub> | 文件 → `doc.ev-severe-guideline.2026-03-15` | `doc.ev-severe-guideline.2026-03-15`（既有） | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 9 | 公費流感抗病毒藥劑使用對象（2026 年 9 月延長版：高傳播族群延至 10 月 31 日）<br><sub>www.cdc.gov.tw/Category/MPage/NbhcebQOefVm48u57Z4rVv</sub> | 文件 → `doc.flu-antiviral-eligibility.2026-09-18` | `doc.flu-antiviral-eligibility.2026-09-18`（既有） | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 10 | 公費流感抗病毒藥劑使用對象（全年適用條件）<br><sub>www.cdc.gov.tw/Category/MPage/XJrlXfbtWEd8E3uwbnfBg9</sub> | 文件 → `doc.flu-antiviral-eligibility.2026-06-01` | `doc.flu-antiviral-eligibility.2026-06-01`（既有） | 1 | — | 封存（歷史版本／久遠內容，舊版保留查閱） |
| 11 | 公費流感抗病毒藥劑使用對象（2026 年 8 月擴大版：高傳播族群，至 9 月 30 日）<br><sub>www.cdc.gov.tw/Category/MPage/utHsvgoFhtVwsL26JL-6TM</sub> | 文件 → `doc.flu-antiviral-eligibility.2026-08-24` | `doc.flu-antiviral-eligibility.2026-08-24`（既有） | 1 | — | 封存（歷史版本／久遠內容，舊版保留查閱） |
| 12 | 2026–2027 年度公費流感疫苗接種計畫作業手冊<br><sub>www.cdc.gov.tw/Category/MPage/CakZ4t4cZR0bYXTl_3xLDw</sub> | 文件 → `doc.flu-vaccine-manual.2026-09-16` | `doc.flu-vaccine-manual.2026-09-16`（既有） | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 13 | 2026–2027 年度公費流感疫苗接種計畫：實施對象與時程<br><sub>www.cdc.gov.tw/Category/MPage/PwkPHdhebK90v4YVz1uOnQ</sub> | 文件 → `doc.flu-vaccine-schedule.2026-09-15` | `doc.flu-vaccine-schedule.2026-09-15`（既有） | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 14 | 登革熱／屈公病防治工作指引（第 17 版）<br><sub>www.cdc.gov.tw/Category/MPage/QwHK502JzEL-7ojyp1B53w</sub> | 文件 → `doc.guidance-dengue.v17`<br>`doc.guidance-dengue.v15`<br>`doc.guidance-dengue.v16` | `doc.guidance-dengue.v17`（既有） | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 15 | H7N9 流感防治工作指引（2017 年版）<br><sub>www.cdc.gov.tw/Category/DiseaseTeach/avfKJ8q0g9hQK4hGSOyUO8</sub> | 文件 → `doc.influenza-h7n9-guideline-2017.2017-04-10` | — | 0.8 | pdf-no-text-layer、body-short、pdf-only | 封存（歷史版本／久遠內容，舊版保留查閱） |
| 16 | 醫療機構感染管制措施指引<br><sub>www.cdc.gov.tw/Category/MPage/4SSpeIQdau_eeWKfkHRO75</sub> | 文件 → `doc.infection-control-healthcare.2026-03-01` | `doc.infection-control-healthcare.2026-03-01`（既有） | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 17 | 潛伏結核感染診治指引<br><sub>www.cdc.gov.tw/Category/MPage/8YOZTBVwbu5t_YzrVuqna3</sub> | 文件 → `doc.ltbi-guideline.2024-01-01` | `doc.ltbi-guideline.2024-01-01`（既有） | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 18 | 麻疹接觸者追蹤作業指引<br><sub>www.cdc.gov.tw/Category/MPage/rE14k7WXGhTM9KpMCIkRiH</sub> | 文件 → `doc.measles-contact-tracing.2026-09-12` | `doc.measles-contact-tracing.2026-09-12`（既有） | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 19 | 國內現行 MMR 預防接種建議（114.04.16 版）<br><sub>www.cdc.gov.tw/Category/MPage/l3AcSii0GQ0DFTwJAZv75P</sub> | 文件 → `doc.mmr-recommendation.2025-04-16`<br>`doc.mmr-recommendation.2019-05-14` | `doc.mmr-recommendation.2025-04-16`（既有） | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 20 | 狂犬病防治工作手冊（113 年 12 月修訂版）<br><sub>www.cdc.gov.tw/Category/DiseaseManual/j0SEy06cs2n4zoOgnCWVUp</sub> | 文件 → `doc.rabies-6abd76.2024-12-20` | — | 1 | — | 核對後入庫（新站尚無對應內容） |
| 21 | 狂犬病防治工作手冊（108 年版）<br><sub>www.cdc.gov.tw/Category/DiseaseManual/HnntblEgm7Fz-c5-_K6dZg</sub> | 文件 → `doc.rabies-6abd76.2019-06-01` | — | 1 | — | 封存（歷史版本／久遠內容，舊版保留查閱） |
| 22 | 結核病病例定義與通報定義<br><sub>www.cdc.gov.tw/Category/MPage/dCCFFfTlJhVsO0kICYVjVK</sub> | 文件 → `doc.tb-case-definition.2024-01-01` | `doc.tb-case-definition.2024-01-01`（既有） | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 23 | 結核病接觸者檢查指引<br><sub>www.cdc.gov.tw/Category/MPage/ayyhfVi2o9zE_68-rGkqz2</sub> | 文件 → `doc.tb-contact-investigation.2025-01-01` | `doc.tb-contact-investigation.2025-01-01`（既有） | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 24 | 結核病診治指引（第八版）<br><sub>www.cdc.gov.tw/Category/MPage/LLQ48kI8Pnv_c6mNrfaHTT</sub> | 文件 → `doc.tb-guideline.2025-09-01`<br>`doc.tb-guideline.2022-03-01` | `doc.tb-guideline.2025-09-01`（既有） | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 25 | 結核病防治工作手冊<br><sub>www.cdc.gov.tw/Category/MPage/pzNsf4bKBooWZOAeKz6kOr</sub> | 文件 → `doc.tb-manual.2025-07-01` | `doc.tb-manual.2025-07-01`（既有） | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 26 | 防疫指引與手冊總覽<br><sub>www.cdc.gov.tw/Category/List/tW71wbu3bYJe5jK2HGn7P9</sub> | 清單頁 → `page.x-guidelines-list` | — | 0.6 | — | 清單頁，不轉換（新站由系統自動產生列表） |

## 需人工檢視（0 頁）

無。

## 併入疾病頁（0 頁）


## 二級抽樣檢視名單（近年新聞 auto-ok 0 頁，抽 10% ＝ 0 頁）

本批沒有可自動上線的近年新聞。

抽樣由網址雜湊排序決定，重跑不變；公關室看完名單沒有問題，整批 auto-ok 才改 `published` 開 PR（第 7 節二級）；發現率超過 10% 就暫停自動上線、回頭修規則。

## 附件與圖片需要處理的

- H7N9 流感防治工作指引（2017 年版）：PDF「h7n9-guideline-2017.pdf」沒有文字層（掃描檔），上架前須附同名 .md／.docx 可及性版本，或重做有文字層的 PDF

## 與移轉清單的差異

- 清單有、匯出沒有：無
- 匯出有、清單沒有：無
- 與清單判定不同（不覆蓋，人工決定）：無
- 套用規則：只改 status／target／newPath／note，不動 verified；僅「待確認(pending)且新站已有對應內容」的項目才改 status（人工已判定的項目不被覆蓋，差異列在 conflicts）。

