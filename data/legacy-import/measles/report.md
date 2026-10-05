# 舊站匯出轉換報告：measles

> **模擬匯出**（開發環境連不到舊站，依移轉清單合成；正式匯出取代即可）。匯出日 2026-10-03；轉換時間 2026-10-05T02:30:00Z；規則檔 `content/migration/import/_import-rules.json`；移轉清單 `content/migration/measles.json`（7 筆）。

## 批次摘要

| 項目 | 數字 |
| --- | --- |
| 舊頁數 | 28 |
| 產出草稿 | 29（Q&A 10、出版品 1、文件 4、資料集 1、檢驗 1、頁面 6、影音 1、新聞 4、疾病頁 1） |
| 舊頁型別 | 併入疾病頁 9、Q&A 1、出版品 1、文件 4、資料集 1、檢驗 1、頁面 3、清單頁 3、影音 1、新聞 4 |
| 平均信心 | 0.94 |
| 需人工檢視（信心 < 0.6） | 0 |
| 既有內容已存在（供比對） | 23 |
| 附件與圖片 | 9（附件 6、內文圖片 2、資料檔 1；圖片待補 alt 2、PDF 無文字層 2） |
| 草稿 schema 驗證 | 29 / 29 通過 |
| 問題 | 錯誤 0、警告 8、提示 84 |
| 移轉清單對應 | 對上 7 / 7 筆；status 變化 0；note 更新 7；仍待移轉 2；與清單判定不同 0 |
| 模板推導項（清單只寫例外） | 18 項，對上 18；只列在 migration-patch.json 的 derivedItems，不寫回清單 |
| 清單沒有的舊頁 | 3（migration-patch.json 的 unmatchedPages 有建議的 pending 項目） |

處理原則：一級內容（疾病頁、指引、手冊）一律人工確認後才入庫；近年新聞信心 ≥ 0.8 可核對後自動上線；久遠與歷史版本封存；草稿放在本目錄，**不會**寫進 `content/`。

## 逐頁結果

| # | 來源 | 型別 | 目標 | 信心 | 問題 | 建議動作 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 疾病介紹<br><sub>www.cdc.gov.tw/Disease/SubIndex/ZUpcHZWi_S65WeehXQuC8v</sub> | 併入疾病頁 → `disease.measles`（併入：transmission） | `disease.measles`（既有） | 1 | — | 併入疾病頁區塊（與既有內容逐段比對） |
| 2 | 致病原<br><sub>www.cdc.gov.tw/Disease/SubIndex/ZUpcHZWi_S65WeehXQuC8v</sub> | 併入疾病頁 → `disease.measles`（併入：transmission） | `disease.measles`（既有） | 1 | — | 併入疾病頁區塊（與既有內容逐段比對） |
| 3 | 流行病學<br><sub>www.cdc.gov.tw/Disease/SubIndex/ZUpcHZWi_S65WeehXQuC8v</sub> | 併入疾病頁 → `disease.measles`（併入：situation） | `disease.measles`（既有） | 0.8 | image-no-alt | 併入疾病頁區塊（與既有內容逐段比對） |
| 4 | 傳染方式<br><sub>www.cdc.gov.tw/Disease/SubIndex/ZUpcHZWi_S65WeehXQuC8v</sub> | 併入疾病頁 → `disease.measles`（併入：transmission） | `disease.measles`（既有） | 1 | — | 併入疾病頁區塊（與既有內容逐段比對） |
| 5 | 潛伏期<br><sub>www.cdc.gov.tw/Disease/SubIndex/ZUpcHZWi_S65WeehXQuC8v</sub> | 併入疾病頁 → `disease.measles`（併入：transmission） | `disease.measles`（既有） | 1 | — | 併入疾病頁區塊（與既有內容逐段比對） |
| 6 | 發病症狀<br><sub>www.cdc.gov.tw/Disease/SubIndex/ZUpcHZWi_S65WeehXQuC8v</sub> | 併入疾病頁 → `disease.measles`（併入：symptoms） | `disease.measles`（既有） | 1 | — | 併入疾病頁區塊（與既有內容逐段比對） |
| 7 | 預防方法<br><sub>www.cdc.gov.tw/Disease/SubIndex/ZUpcHZWi_S65WeehXQuC8v</sub> | 併入疾病頁 → `disease.measles`（併入：prevention） | `disease.measles`（既有） | 1 | — | 併入疾病頁區塊（與既有內容逐段比對） |
| 8 | 治療方法與就醫資訊<br><sub>www.cdc.gov.tw/Disease/SubIndex/ZUpcHZWi_S65WeehXQuC8v</sub> | 併入疾病頁 → `disease.measles`（併入：treatment） | `disease.measles`（既有） | 1 | — | 併入疾病頁區塊（與既有內容逐段比對） |
| 9 | 預防接種建議<br><sub>www.cdc.gov.tw/Category/MPage/D7GS7y0HwfNsQP8xpY6sIX</sub> | 併入疾病頁 → `disease.measles`（併入：vaccine） | `disease.measles`（既有） | 1 | — | 併入疾病頁區塊（與既有內容逐段比對） |
| 10 | Q&A<br><sub>www.cdc.gov.tw/Category/QAPage/s5OaifVY2y_Oh-5Zt4ecui</sub> | Q&A → `faq.healthcare-workers-mmr`<br>`faq.measles-exposed-what-to-do`<br>`faq.measles-health-dept-call`<br>`faq.measles-mmr-adult-who`<br>`faq.measles-mmr-born-1970`<br>`faq.measles-mmr-check-record`<br>`faq.measles-symptoms`<br>`faq.rumor-mmr-autism`<br>`faq.travel-japan-measles`<br>`faq.travel-return-fever` | `disease.measles`（既有） | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 11 | 衛教宣導：單張海報<br><sub>www.cdc.gov.tw/Category/List/ndPddmtQlGVto1kLRIiu3S</sub> | 出版品 → `publication.measles-materials-poster` | — | 0.8 | pdf-no-text-layer、image-no-alt | 核對後入庫（新站尚無對應內容） |
| 12 | 傳染病防治工作手冊（2026 年版）<br><sub>www.cdc.gov.tw/Category/DiseaseManual/fKswAQpMktNyzXETPocXZ2</sub> | 文件 → `doc.measles-manual.2026-03-01` | — | 1 | — | 核對後入庫（新站尚無對應內容） |
| 13 | 傳染病病例定義：麻疹<br><sub>www.cdc.gov.tw/Category/DiseaseDefine/cMMH-s4zN4Dw12teXD11mn</sub> | 文件 → `doc.case-definition-measles.2024-01-01` | `doc.case-definition-measles.2024-01-01`（既有） | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 14 | 統計資料<br><sub>www.cdc.gov.tw/Category/List/SJd_VUKQ_blXx4LfMYrEyA</sub> | 資料集 → `dataset.measles-yearly` | `dataset.measles-yearly`（既有） | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 15 | 檢驗資訊<br><sub>www.cdc.gov.tw/Category/MPage/T6DUjtV8a7bam_ZzaJUVy3</sub> | 檢驗 → `labtest.measles` | `labtest.measles`（既有） | 1 | fields-pending | 既有內容已存在，供比對，不建議覆蓋 |
| 16 | 通報定義與時限<br><sub>www.cdc.gov.tw/Category/MPage/2PEnc-pO02tBW5wCu7txIi</sub> | 頁面 → `page.measles-notify` | — | 1 | — | 核對後入庫（新站尚無對應內容） |
| 17 | 新聞稿列表<br><sub>www.cdc.gov.tw/Bulletin/List/VGHfqWAr3L0AyabNY36p00</sub> | 清單頁 → `page.measles-news-list` | `disease.measles`（既有） | 0.6 | — | 清單頁，不轉換（新站由系統自動產生列表） |
| 18 | 相關連結<br><sub>www.cdc.gov.tw/Category/List/t0UFduaYLvcN0L199hzOhl</sub> | 清單頁 → `page.measles-links` | `topic.new-residents-migrant-health`（既有） | 0.6 | — | 清單頁，不轉換（新站由系統自動產生列表） |
| 19 | 麻疹及德國麻疹消除專區<br><sub>www.cdc.gov.tw/Category/Page/AeUKahagakiXHB2gVKjKC2</sub> | 頁面 → `page.measles-elimination-zone` | — | 1 | — | 核對後入庫（新站尚無對應內容） |
| 20 | 麻疹群聚事件應變專區<br><sub>www.cdc.gov.tw/Category/MPage/-_YEYLxc3bH82jAhp_t9c3</sub> | 頁面 → `page.measles-cluster-response` | `doc.measles-contact-tracing.2026-09-12`（既有） | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 21 | 麻疹接觸者追蹤作業指引<br><sub>www.cdc.gov.tw/File/Get/uTI-ThoSeLurTG6lnklL3e</sub> | 文件 → `doc.measles-contact-tracing.2026-09-12` | `doc.measles-contact-tracing.2026-09-12`（既有） | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 22 | 麻疹病例接觸者活動場所公告<br><sub>www.cdc.gov.tw/Bulletin/List/6BjM8s3a1iKGa6nJ9OjFfl?page=1</sub> | 清單頁 → `page.measles-exposure-notice` | — | 0.6 | — | 清單頁，不轉換（新站由系統自動產生列表） |
| 23 | 國內 MMR 預防接種建議（108.05.14 版）<br><sub>www.cdc.gov.tw/File/Get/cTCUM_BSq6o_O9hCLVtrfF</sub> | 文件 → `doc.mmr-recommendation.2019-05-14` | `doc.mmr-recommendation.2019-05-14`（既有） | 1 | pdf-no-text-layer | 既有內容已存在，供比對，不建議覆蓋 |
| 24 | 麻疹 MMR 疫苗候診衛教動畫<br><sub>www.cdc.gov.tw/Category/List/zqJsMSQMzdsSMSFci6k7Aj</sub> | 影音 → `media.mmr-waiting-room-2026` | `media.mmr-waiting-room-2026`（既有） | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 25 | 日本麻疹疫情旅遊提醒<br><sub>www.cdc.gov.tw/Bulletin/Detail/76xmEQXxa2oFlWbwwCd1lv?typeid=9</sub> | 新聞 → `news.2026-05-11-japan-measles-level1` | `news.2026-05-11-japan-measles-level1`（既有） | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 26 | 暑假出國前請評估麻疹免疫力：1966 年（含）以後出生者出國前 2 至 4 週評估接種 MMR<br><sub>www.cdc.gov.tw/Bulletin/Detail/gjtvo59pOflfbxnRphUP1p?typeid=9</sub> | 新聞 → `news.2026-06-02-measles-travel-mmr-1966` | — | 1 | not-in-manifest | 既有內容已存在，供比對，不建議覆蓋 |
| 27 | 修訂國內 MMR 預防接種建議：成人評估對象擴大至 1966 年（含）以後出生者<br><sub>www.cdc.gov.tw/Bulletin/Detail/98V23SiAAF1sIBqDHPE-Ov?typeid=9</sub> | 新聞 → `news.2025-04-16-mmr-recommendation-revised` | — | 1 | not-in-manifest | 既有內容已存在，供比對，不建議覆蓋 |
| 28 | 國內新增麻疹病例，1981 年以後出生之醫護與赴流行區成人建議優先自費接種 MMR<br><sub>www.cdc.gov.tw/Bulletin/Detail/jY8xIMIFeWec1yS8mXv11f?typeid=9</sub> | 新聞 → `news.2025-01-09-mmr-adults-measles` | — | 1 | not-in-manifest | 既有內容已存在，供比對，不建議覆蓋 |

## 需人工檢視（0 頁）

無。

## 併入疾病頁（9 頁）

- 「疾病介紹」→ `disease.measles` 區塊 transmission（疾病頁既有內容已存在，供比對）
- 「致病原」→ `disease.measles` 區塊 transmission（疾病頁既有內容已存在，供比對）
- 「流行病學」→ `disease.measles` 區塊 situation（疾病頁既有內容已存在，供比對）
- 「傳染方式」→ `disease.measles` 區塊 transmission（疾病頁既有內容已存在，供比對）
- 「潛伏期」→ `disease.measles` 區塊 transmission（疾病頁既有內容已存在，供比對）
- 「發病症狀」→ `disease.measles` 區塊 symptoms（疾病頁既有內容已存在，供比對）
- 「預防方法」→ `disease.measles` 區塊 prevention（疾病頁既有內容已存在，供比對）
- 「治療方法與就醫資訊」→ `disease.measles` 區塊 treatment（疾病頁既有內容已存在，供比對）
- 「預防接種建議」→ `disease.measles` 區塊 vaccine（疾病頁既有內容已存在，供比對）

## 附件與圖片需要處理的

- 流行病學：圖片「measles-trend.png」舊頁沒有替代文字，暫用檔名「measles-trend」，請補 alt（needsAlt）
- 衛教宣導：單張海報：PDF「measles-poster-7lang.pdf」沒有文字層（掃描檔），上架前須附同名 .md／.docx 可及性版本，或重做有文字層的 PDF
- 衛教宣導：單張海報：圖片「measles-poster.png」舊頁沒有替代文字，暫用檔名「measles-poster」，請補 alt（needsAlt）
- 國內 MMR 預防接種建議（108.05.14 版）：PDF「mmr-recommendation.2019-05-14.pdf」沒有文字層（掃描檔），上架前須附同名 .md／.docx 可及性版本，或重做有文字層的 PDF

## 與移轉清單的差異

- 清單有、匯出沒有：無
- 匯出有、清單沒有：26-news-2026-06-02-measles-travel-mmr-1966、27-news-2025-04-16-mmr-recommendation-revised、28-news-2025-01-09-mmr-adults-measles
- 與清單判定不同（不覆蓋，人工決定）：無
- 套用規則：只改 status／target／note，不動 verified；僅「待確認(pending)且新站已有對應內容」的項目才改 status（人工已判定的項目不被覆蓋，差異列在 conflicts）。

