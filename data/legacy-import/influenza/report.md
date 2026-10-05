# 舊站匯出轉換報告：influenza

> **模擬匯出**（開發環境連不到舊站，依移轉清單合成；正式匯出取代即可）。匯出日 2026-10-03；轉換時間 2026-10-05T02:30:00Z；規則檔 `content/migration/import/_import-rules.json`；移轉清單 `content/migration/influenza.json`（8 筆）。

## 批次摘要

| 項目 | 數字 |
| --- | --- |
| 舊頁數 | 31 |
| 產出草稿 | 32（Q&A 10、出版品 1、影音 1、文件 5、資料集 1、檢驗 1、頁面 4、專區 1、服務 2、新聞 3、致醫界通函 1、澄清稿 1、疾病頁 1） |
| 舊頁型別 | 併入疾病頁 9、Q&A 1、出版品 1、影音 1、文件 5、資料集 1、檢驗 1、頁面 2、清單頁 2、專區 1、服務 2、新聞 4、澄清稿 1 |
| 平均信心 | 0.93 |
| 需人工檢視（信心 < 0.6） | 0 |
| 既有內容已存在（供比對） | 25 |
| 附件與圖片 | 8（附件 5、內文圖片 2、資料檔 1；圖片待補 alt 2、PDF 無文字層 2） |
| 草稿 schema 驗證 | 32 / 32 通過 |
| 問題 | 錯誤 0、警告 13、提示 111 |
| 移轉清單對應 | 對上 8 / 8 筆；status 變化 0；note 更新 0；仍待移轉 2；與清單判定不同 0 |
| 模板推導項（清單只寫例外） | 18 項，對上 18；只列在 migration-patch.json 的 derivedItems，不寫回清單 |
| 清單沒有的舊頁 | 5（migration-patch.json 的 unmatchedPages 有建議的 pending 項目） |

處理原則：一級內容（疾病頁、指引、手冊）一律人工確認後才入庫；近年新聞信心 ≥ 0.8 可核對後自動上線；久遠與歷史版本封存；草稿放在本目錄，**不會**寫進 `content/`。

## 逐頁結果

| # | 來源 | 型別 | 目標 | 信心 | 問題 | 建議動作 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 疾病介紹<br><sub>www.cdc.gov.tw/Disease/SubIndex/onsQVJBHAI493DBVEgcN_0</sub> | 併入疾病頁 → `disease.influenza`（併入：transmission） | `disease.influenza`（既有） | 1 | — | 併入疾病頁區塊（與既有內容逐段比對） |
| 2 | 致病原<br><sub>www.cdc.gov.tw/Disease/SubIndex/onsQVJBHAI493DBVEgcN_0</sub> | 併入疾病頁 → `disease.influenza`（併入：transmission） | `disease.influenza`（既有） | 1 | — | 併入疾病頁區塊（與既有內容逐段比對） |
| 3 | 流行病學<br><sub>www.cdc.gov.tw/Disease/SubIndex/onsQVJBHAI493DBVEgcN_0</sub> | 併入疾病頁 → `disease.influenza`（併入：situation） | `disease.influenza`（既有） | 0.8 | image-no-alt | 併入疾病頁區塊（與既有內容逐段比對） |
| 4 | 傳染方式<br><sub>www.cdc.gov.tw/Disease/SubIndex/onsQVJBHAI493DBVEgcN_0</sub> | 併入疾病頁 → `disease.influenza`（併入：transmission） | `disease.influenza`（既有） | 1 | — | 併入疾病頁區塊（與既有內容逐段比對） |
| 5 | 潛伏期<br><sub>www.cdc.gov.tw/Disease/SubIndex/onsQVJBHAI493DBVEgcN_0</sub> | 併入疾病頁 → `disease.influenza`（併入：transmission） | `disease.influenza`（既有） | 1 | — | 併入疾病頁區塊（與既有內容逐段比對） |
| 6 | 發病症狀<br><sub>www.cdc.gov.tw/Disease/SubIndex/onsQVJBHAI493DBVEgcN_0</sub> | 併入疾病頁 → `disease.influenza`（併入：symptoms） | `disease.influenza`（既有） | 1 | — | 併入疾病頁區塊（與既有內容逐段比對） |
| 7 | 預防方法<br><sub>www.cdc.gov.tw/Disease/SubIndex/onsQVJBHAI493DBVEgcN_0</sub> | 併入疾病頁 → `disease.influenza`（併入：prevention） | `disease.influenza`（既有） | 1 | — | 併入疾病頁區塊（與既有內容逐段比對） |
| 8 | 治療方法與就醫資訊<br><sub>www.cdc.gov.tw/Disease/SubIndex/onsQVJBHAI493DBVEgcN_0</sub> | 併入疾病頁 → `disease.influenza`（併入：treatment） | `disease.influenza`（既有） | 1 | — | 併入疾病頁區塊（與既有內容逐段比對） |
| 9 | 預防接種建議<br><sub>www.cdc.gov.tw/Category/MPage/L-P0gM1I3qTWG35LXVu7xA</sub> | 併入疾病頁 → `disease.influenza`（併入：vaccine） | `disease.influenza`（既有） | 1 | — | 併入疾病頁區塊（與既有內容逐段比對） |
| 10 | Q&A<br><sub>www.cdc.gov.tw/Category/QAPage/Zfg30duS6fEOkNhHjVRix8</sub> | Q&A → `faq.flu-antiviral-65-no-test`<br>`faq.flu-covid-same-day`<br>`faq.flu-danger-signs`<br>`faq.flu-vaccine-every-year`<br>`faq.flu-vaccine-who`<br>`faq.flu-vs-cold`<br>`faq.influenza-antiviral-who`<br>`faq.influenza-severe-what`<br>`faq.influenza-vaccine-where`<br>`faq.stats-ili-rate` | `disease.influenza`（既有） | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 11 | 衛教宣導：單張海報<br><sub>www.cdc.gov.tw/Category/List/Dseef2nyUuF_ufJ_-HsVuH</sub> | 出版品 → `publication.influenza-materials-poster` | — | 0.8 | pdf-no-text-layer、image-no-alt | 核對後入庫（新站尚無對應內容） |
| 12 | 衛教宣導：影片<br><sub>www.cdc.gov.tw/Category/MPage/Z9lGEBVEdvHjmkowXcJ_b1</sub> | 影音 → `media.ltc-flu-vaccine` | `media.ltc-flu-vaccine`（既有） | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 13 | 病例定義<br><sub>www.cdc.gov.tw/Category/DiseaseDefine/YblgPS6l9Yb4mfUYx6mCKZ</sub> | 文件 → `doc.influenza-case-definition.2017-10-01` | — | 0.8 | body-short | 核對後入庫（新站尚無對應內容） |
| 14 | 統計資料<br><sub>www.cdc.gov.tw/Category/List/14Z7BcTsilzv0ni-tFHF80</sub> | 資料集 → `dataset.flu-severe` | `dataset.flu-severe`（既有） | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 15 | 檢驗資訊<br><sub>www.cdc.gov.tw/Category/MPage/BXQ_3PvoU6VyCBHauEQKa6</sub> | 檢驗 → `labtest.influenza` | `labtest.influenza`（既有） | 1 | fields-pending | 既有內容已存在，供比對，不建議覆蓋 |
| 16 | 通報定義與時限<br><sub>www.cdc.gov.tw/Category/MPage/gvY0i6-FEYc2VKEyu5ZRTR</sub> | 頁面 → `page.influenza-notify` | — | 1 | — | 核對後入庫（新站尚無對應內容） |
| 17 | 新聞稿列表<br><sub>www.cdc.gov.tw/Bulletin/List/bIp1EzRH4-l_1Wf3-Xbhgv</sub> | 清單頁 → `page.influenza-news-list` | `disease.influenza`（既有） | 0.6 | — | 清單頁，不轉換（新站由系統自動產生列表） |
| 18 | 相關連結<br><sub>www.cdc.gov.tw/Category/List/6TFWM0mSjy0cOE0UG2TWhz</sub> | 專區 → `topic.influenza-links` | `topic.ltc-infection-control`（既有） | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 19 | 流感疫苗專區（首頁）<br><sub>www.cdc.gov.tw/Category/Page/-CgApFZQk-AhWIGG2NnkmA</sub> | 頁面 → `page.influenza-flu-vaccine-zone` | `disease.influenza`（既有） | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 20 | 公費流感疫苗接種計畫：實施對象與時程<br><sub>www.cdc.gov.tw/File/Get/TRISN3J9An-J4lAzbB1EFN</sub> | 文件 → `doc.flu-vaccine-schedule.2026-09-15` | `doc.flu-vaccine-schedule.2026-09-15`（既有） | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 21 | 公費流感疫苗接種計畫作業手冊<br><sub>www.cdc.gov.tw/File/Get/k6H6568EM4MUyLmxDp6yVF</sub> | 文件 → `doc.flu-vaccine-manual.2026-09-16` | `doc.flu-vaccine-manual.2026-09-16`（既有） | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 22 | 公費流感疫苗合約院所查詢<br><sub>www.cdc.gov.tw/Category/List/4RgtNMNbqmGxb90C5PCRNH</sub> | 服務 → `service.influenza-flu-vaccine-contract-sites` | — | 0.6 | fields-pending | 核對後入庫（新站尚無對應內容） |
| 23 | 公費流感抗病毒藥劑使用對象<br><sub>www.cdc.gov.tw/Category/Page/DcQhnxOUXS4BnGFxCjEXLb</sub> | 文件 → `doc.flu-antiviral-eligibility.2026-09-18` | `doc.flu-antiviral-eligibility.2026-09-18`（既有） | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 24 | 公費流感抗病毒藥劑使用對象（全年適用條件）<br><sub>www.cdc.gov.tw/Category/Page/Tsy161Va94LybxcU8KHFRV</sub> | 文件 → `doc.flu-antiviral-eligibility.2026-06-01` | `doc.flu-antiviral-eligibility.2026-06-01`（既有） | 1 | pdf-no-text-layer | 封存（歷史版本／久遠內容，舊版保留查閱） |
| 25 | 公費抗病毒藥劑合約院所與藥局<br><sub>www.cdc.gov.tw/Category/List/Cf1DIbpAUq0ymjkxv1xC7U</sub> | 服務 → `service.influenza-flu-antiviral-contract-sites` | — | 0.6 | fields-pending | 核對後入庫（新站尚無對應內容） |
| 26 | 歷年流感疫苗接種計畫（2020–2024 年度）<br><sub>www.cdc.gov.tw/Category/List/ewfWns-6XlMWzGdtpDFLK1</sub> | 清單頁 → `page.influenza-flu-past-seasons` | — | 0.6 | — | 清單頁，不轉換（新站由系統自動產生列表） |
| 27 | 流感疫情持續上升，10 月 1 日公費疫苗開打，長者幼兒請優先接種<br><sub>www.cdc.gov.tw/Bulletin/Detail/8lZ1ophntJAgEqI_IgPLNQ?typeid=9</sub> | 新聞 → `news.2026-09-29-ili-weekly` | — | 1 | not-in-manifest | 既有內容已存在，供比對，不建議覆蓋 |
| 28 | 流感疫情進入流行期且持續上升，疾管署延長擴大公費流感抗病毒藥劑使用條件至 10 月 31 日<br><sub>www.cdc.gov.tw/Bulletin/Detail/O_J0ATTIK9MciVwL4-h6Jg?typeid=9</sub> | 新聞 → `news.2026-09-18-flu-antiviral-extended` | — | 1 | not-in-manifest | 既有內容已存在，供比對，不建議覆蓋 |
| 29 | 2026–2027 年度公費流感疫苗 10 月 1 日開打，新冠疫苗同步提供<br><sub>www.cdc.gov.tw/Bulletin/Detail/YhMh5ap_Ft8C_2_Gy5z5J9?typeid=9</sub> | 新聞 → `news.2026-09-18-flu-vaccine-oct1` | — | 1 | not-in-manifest | 既有內容已存在，供比對，不建議覆蓋 |
| 30 | 致醫界通函第 616 號：延長擴大公費流感抗病毒藥劑使用對象「有類流感症狀，且具下列身分之流感高傳播族群」之適用期限至 10 月 31 日<br><sub>www.cdc.gov.tw/Bulletin/Detail/B5hGsAn-lgn3yZOUXOX8Oh?typeid=11</sub> | 新聞 → `news.2026-09-18-letter-616-flu-antiviral-extended` | — | 1 | not-in-manifest | 既有內容已存在，供比對，不建議覆蓋 |
| 31 | 澄清：網傳「打流感疫苗會得流感、長輩打完會死」並非事實<br><sub>www.cdc.gov.tw/Bulletin/Detail/e_1DvbI5FdTnW6hLu35VWK?typeid=8772</sub> | 澄清稿 → `clar.2026-09-10-influenza-324aad` | `news.2026-09-10-clarify-flu-vaccine-death`（既有） | 1 | not-in-manifest | 既有內容已存在，供比對，不建議覆蓋 |

## 需人工檢視（0 頁）

無。

## 併入疾病頁（9 頁）

- 「疾病介紹」→ `disease.influenza` 區塊 transmission（疾病頁既有內容已存在，供比對）
- 「致病原」→ `disease.influenza` 區塊 transmission（疾病頁既有內容已存在，供比對）
- 「流行病學」→ `disease.influenza` 區塊 situation（疾病頁既有內容已存在，供比對）
- 「傳染方式」→ `disease.influenza` 區塊 transmission（疾病頁既有內容已存在，供比對）
- 「潛伏期」→ `disease.influenza` 區塊 transmission（疾病頁既有內容已存在，供比對）
- 「發病症狀」→ `disease.influenza` 區塊 symptoms（疾病頁既有內容已存在，供比對）
- 「預防方法」→ `disease.influenza` 區塊 prevention（疾病頁既有內容已存在，供比對）
- 「治療方法與就醫資訊」→ `disease.influenza` 區塊 treatment（疾病頁既有內容已存在，供比對）
- 「預防接種建議」→ `disease.influenza` 區塊 vaccine（疾病頁既有內容已存在，供比對）

## 二級抽樣檢視名單（近年新聞 auto-ok 0 頁，抽 10% ＝ 0 頁）

本批沒有可自動上線的近年新聞。

抽樣由網址雜湊排序決定，重跑不變；公關室看完名單沒有問題，整批 auto-ok 才改 `published` 開 PR（第 7 節二級）；發現率超過 10% 就暫停自動上線、回頭修規則。

## 附件與圖片需要處理的

- 流行病學：圖片「influenza-trend.png」舊頁沒有替代文字，暫用檔名「influenza-trend」，請補 alt（needsAlt）
- 衛教宣導：單張海報：PDF「influenza-poster-7lang.pdf」沒有文字層（掃描檔），上架前須附同名 .md／.docx 可及性版本，或重做有文字層的 PDF
- 衛教宣導：單張海報：圖片「influenza-poster.png」舊頁沒有替代文字，暫用檔名「influenza-poster」，請補 alt（needsAlt）
- 公費流感抗病毒藥劑使用對象（全年適用條件）：PDF「flu-antiviral-eligibility.2026-06-01.pdf」沒有文字層（掃描檔），上架前須附同名 .md／.docx 可及性版本，或重做有文字層的 PDF

## 與移轉清單的差異

- 清單有、匯出沒有：無
- 匯出有、清單沒有：27-news-2026-09-29-ili-weekly、28-news-2026-09-18-flu-antiviral-extended、29-news-2026-09-18-flu-vaccine-oct1、30-news-2026-09-18-letter-616-flu-antiviral-extended、31-news-2026-09-10-clarify-flu-vaccine-death
- 與清單判定不同（不覆蓋，人工決定）：無
- 套用規則：只改 status／target／note，不動 verified；僅「待確認(pending)且新站已有對應內容」的項目才改 status（人工已判定的項目不被覆蓋，差異列在 conflicts）。

