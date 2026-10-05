# 舊站匯出轉換報告：travel

> **模擬匯出**（開發環境連不到舊站，依移轉清單合成；正式匯出取代即可）。匯出日 2026-10-03；轉換時間 2026-10-05T02:30:00Z；規則檔 `content/migration/import/_import-rules.json`；移轉清單 `content/migration/travel.json`（19 筆）。

## 批次摘要

| 項目 | 數字 |
| --- | --- |
| 舊頁數 | 20 |
| 產出草稿 | 13（頁面 8、服務 2、資料集 1、影音 1、疾病頁 1） |
| 舊頁型別 | 頁面 4、併入疾病頁 1、資料產生頁 6、服務 2、資料集 1、Q&A 1、清單頁 4、影音 1 |
| 平均信心 | 0.92 |
| 需人工檢視（信心 < 0.6） | 0 |
| 既有內容已存在（供比對） | 5 |
| 附件與圖片 | 1（附件 1、內文圖片 0、資料檔 0；圖片待補 alt 0、PDF 無文字層 0） |
| 草稿 schema 驗證 | 13 / 13 通過 |
| 問題 | 錯誤 0、警告 4、提示 35 |
| 移轉清單對應 | 對上 19 / 19 筆；status 變化 0；note 更新 0；仍待移轉 3；與清單判定不同 0 |
| 清單沒有的舊頁 | 1（migration-patch.json 的 unmatchedPages 有建議的 pending 項目） |

處理原則：一級內容（疾病頁、指引、手冊）一律人工確認後才入庫；近年新聞信心 ≥ 0.8 可核對後自動上線；久遠與歷史版本封存；草稿放在本目錄，**不會**寫進 `content/`。

## 逐頁結果

| # | 來源 | 型別 | 目標 | 信心 | 問題 | 建議動作 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 返國後注意事項<br><sub>www.cdc.gov.tw/Category/MPage/DryBWzb2sUmjb11OHdzvB1</sub> | 頁面 → `page.x-after-return` | — | 1 | — | 核對後入庫（新站尚無對應內容） |
| 2 | 出國前注意事項<br><sub>www.cdc.gov.tw/Category/MPage/dD0xcwJor_qG8nlP5UiL4g</sub> | 頁面 → `page.x-before-departure` | — | 1 | — | 核對後入庫（新站尚無對應內容） |
| 3 | 瘧疾預防用藥<br><sub>www.cdc.gov.tw/Category/MPage/45jPQ86Qzod4o4BHSGpy8-</sub> | 併入疾病頁 → `disease.malaria`（併入：prevention） | `disease.malaria`（既有） | 1 | — | 併入疾病頁區塊（與既有內容逐段比對） |
| 4 | 國際旅遊處方箋<br><sub>www.cdc.gov.tw/Category/MPage/9xkojqhoiGk3fT2ih3LhkK</sub> | 頁面 → `page.x-prescription-query` | — | 1 | dynamic-form | 核對後入庫（新站尚無對應內容） |
| 5 | 國際旅遊處方箋：巴西<br><sub>www.cdc.gov.tw/TravelEpidemic/Prescription/YZikHlPi2GkInV-mf0C0VR?iso=BR</sub> | 資料產生頁 → — | `/travel/BR/`（資料產生） | 1 | — | 新站由資料自動產生此頁，不轉內文（舊網址 301 到產生頁；舊內文存 reference/ 供比對） |
| 6 | 國際旅遊處方箋：印度<br><sub>www.cdc.gov.tw/TravelEpidemic/Prescription/YZikHlPi2GkInV-mf0C0VR?iso=IN</sub> | 資料產生頁 → — | `/travel/IN/`（資料產生） | 1 | — | 新站由資料自動產生此頁，不轉內文（舊網址 301 到產生頁；舊內文存 reference/ 供比對） |
| 7 | 國際旅遊處方箋：日本<br><sub>www.cdc.gov.tw/TravelEpidemic/Prescription/YZikHlPi2GkInV-mf0C0VR?iso=JP</sub> | 資料產生頁 → — | `/travel/JP/`（資料產生） | 1 | — | 新站由資料自動產生此頁，不轉內文（舊網址 301 到產生頁；舊內文存 reference/ 供比對） |
| 8 | 國際旅遊處方箋：肯亞<br><sub>www.cdc.gov.tw/TravelEpidemic/Prescription/YZikHlPi2GkInV-mf0C0VR?iso=KE</sub> | 資料產生頁 → — | `/travel/KE/`（資料產生） | 1 | — | 新站由資料自動產生此頁，不轉內文（舊網址 301 到產生頁；舊內文存 reference/ 供比對） |
| 9 | 國際旅遊處方箋：泰國<br><sub>www.cdc.gov.tw/TravelEpidemic/Prescription/YZikHlPi2GkInV-mf0C0VR?iso=TH</sub> | 資料產生頁 → — | `/travel/TH/`（資料產生） | 1 | — | 新站由資料自動產生此頁，不轉內文（舊網址 301 到產生頁；舊內文存 reference/ 供比對） |
| 10 | 國際旅遊處方箋：越南<br><sub>www.cdc.gov.tw/TravelEpidemic/Prescription/YZikHlPi2GkInV-mf0C0VR?iso=VN</sub> | 資料產生頁 → — | `/travel/VN/`（資料產生） | 1 | — | 新站由資料自動產生此頁，不轉內文（舊網址 301 到產生頁；舊內文存 reference/ 供比對） |
| 11 | 旅遊醫學門診<br><sub>www.cdc.gov.tw/Category/Page/ucmuQnzcJPue77qHt0IXeg</sub> | 服務 → `service.travel-clinic-appointment` | `service.travel-clinic-appointment`（既有） | 1 | fields-pending | 既有內容已存在，供比對，不建議覆蓋 |
| 12 | 國際旅遊疫情建議等級表<br><sub>www.cdc.gov.tw/Category/MPage/n-DGrcI1Yod3VzrY9JQHan</sub> | 資料集 → `dataset.travel-alert-levels` | `dataset.travel-alert-levels`（既有） | 1 | fields-pending | 既有內容已存在，供比對，不建議覆蓋 |
| 13 | 國際旅遊常見問答<br><sub>www.cdc.gov.tw/Category/QAPage/oDFvYopfPTouRB6a4gWcs5</sub> | Q&A → `faq.travel-clinic`（重複，未輸出）<br>`faq.travel-japan-measles`（重複，未輸出）<br>`faq.travel-malaria-prevention`（重複，未輸出）<br>`faq.travel-return-fever`（重複，未輸出）<br>`faq.yellow-fever-certificate`（重複，未輸出）<br>`faq.x-legacy-3456c6`（重複，未輸出） | — | 1 | — | 已在其他批次轉過（同網址），本批不重複出草稿 |
| 14 | 國際旅遊保健資訊<br><sub>www.cdc.gov.tw/Category/List/HJ0FrBEq15g18TFKowY7lg</sub> | 清單頁 → `page.x-travel-health-info-list` | — | 0.6 | — | 清單頁，不轉換（新站由系統自動產生列表） |
| 15 | 國際旅遊與健康<br><sub>www.cdc.gov.tw/Category/List/tRbpXpZM7EO3-dkc4RYZuQ</sub> | 清單頁 → `page.x-travel-list` | — | 0.6 | — | 清單頁，不轉換（新站由系統自動產生列表） |
| 16 | 旅遊醫學<br><sub>www.cdc.gov.tw/Category/List/3GJWZ0ETfmdGzIS7H0Jucg</sub> | 清單頁 → `page.x-travel-medicine-list` | — | 0.6 | — | 清單頁，不轉換（新站由系統自動產生列表） |
| 17 | 國際疫情訊息<br><sub>www.cdc.gov.tw/Bulletin/List/ZWd4Ziovle_L8qmx88_X46</sub> | 清單頁 → `page.x-travel-news-list` | — | 0.6 | — | 清單頁，不轉換（新站由系統自動產生列表） |
| 18 | 出國前 4 到 6 週，先到旅遊醫學門診（宣導影片）<br><sub>www.cdc.gov.tw/Category/MPage/Pn9O0INzKizskKf7qrqWMN</sub> | 影音 → `media.travel-clinic-before-departure` | `media.travel-clinic-before-departure`（既有） | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 19 | 國際預防接種及藥物<br><sub>www.cdc.gov.tw/Category/MPage/6786</sub> | 頁面 → `page.x-vaccines-medications` | — | 1 | — | 核對後入庫（新站尚無對應內容） |
| 20 | 國際預防接種證明書（黃皮書）申請<br><sub>www.cdc.gov.tw/Category/MPage/GFpHcjbt_Y7KsBbjE8Wx5U</sub> | 服務 → `service.international-vaccination-certificate` | `service.international-vaccination-certificate`（既有） | 1 | fields-pending | 既有內容已存在，供比對，不建議覆蓋 |

## 需人工檢視（0 頁）

無。

## 併入疾病頁（1 頁）

- 「瘧疾預防用藥」→ `disease.malaria` 區塊 prevention（疾病頁既有內容已存在，供比對）

## 資料產生頁（6 頁）

新站這些頁由每日資料快照自動產生，不轉內文、不出草稿；舊網址 301 到產生頁。舊內文存在對照檔，請比對產生頁有沒有漏掉衛教文字。

- 「國際旅遊處方箋：巴西」→ `/travel/BR/` → 對照檔 `reference/05-rx-br.md`
- 「國際旅遊處方箋：印度」→ `/travel/IN/` → 對照檔 `reference/06-rx-in.md`
- 「國際旅遊處方箋：日本」→ `/travel/JP/` → 對照檔 `reference/07-rx-jp.md`
- 「國際旅遊處方箋：肯亞」→ `/travel/KE/` → 對照檔 `reference/08-rx-ke.md`
- 「國際旅遊處方箋：泰國」→ `/travel/TH/` → 對照檔 `reference/09-rx-th.md`
- 「國際旅遊處方箋：越南」→ `/travel/VN/` → 對照檔 `reference/10-rx-vn.md`

## 二級抽樣檢視名單（近年新聞 auto-ok 0 頁，抽 10% ＝ 0 頁）

本批沒有可自動上線的近年新聞。

抽樣由網址雜湊排序決定，重跑不變；公關室看完名單沒有問題，整批 auto-ok 才改 `published` 開 PR（第 7 節二級）；發現率超過 10% 就暫停自動上線、回頭修規則。

## 附件與圖片需要處理的

無。

## 與移轉清單的差異

- 清單有、匯出沒有：無
- 匯出有、清單沒有：13-travel-faq
- 與清單判定不同（不覆蓋，人工決定）：無
- 套用規則：只改 status／target／newPath／note，不動 verified；僅「待確認(pending)且新站已有對應內容」的項目才改 status（人工已判定的項目不被覆蓋，差異列在 conflicts）。

