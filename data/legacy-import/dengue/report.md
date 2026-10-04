# 舊站匯出轉換報告：dengue

> **模擬匯出**（開發環境連不到舊站，依移轉清單合成；正式匯出取代即可）。匯出日 2026-10-03；轉換時間 2026-10-04T22:30:00Z；規則檔 `content/migration/import/_import-rules.json`；移轉清單 `content/migration/dengue.json`（8 筆）。

## 批次摘要

| 項目 | 數字 |
| --- | --- |
| 舊頁數 | 33 |
| 產出草稿 | 31（Q&A 7、頁面 13、文件 4、新聞 6、疾病頁 1） |
| 舊頁型別 | 併入疾病頁 9、Q&A 1、清單頁 7、頁面 6、文件 4、新聞 6 |
| 平均信心 | 0.88 |
| 需人工檢視（信心 < 0.6） | 3 |
| 既有內容已存在（供比對） | 27 |
| 附件與圖片 | 10（附件 7、內文圖片 2、資料檔 1；圖片待補 alt 2、PDF 無文字層 2） |
| 草稿 schema 驗證 | 31 / 31 通過 |
| 問題 | 錯誤 0、警告 14、提示 101 |
| 移轉清單對應 | 對上 8 / 8 筆；status 變化 0；note 更新 8；仍待移轉 2；與清單判定不同 0 |
| 模板推導項（清單只寫例外） | 20 項，對上 19；只列在 migration-patch.json 的 derivedItems，不寫回清單 |
| 清單沒有的舊頁 | 6（migration-patch.json 的 unmatchedPages 有建議的 pending 項目） |

處理原則：一級內容（疾病頁、指引、手冊）一律人工確認後才入庫；近年新聞信心 ≥ 0.8 可核對後自動上線；久遠與歷史版本封存；草稿放在本目錄，**不會**寫進 `content/`。

## 逐頁結果

| # | 來源 | 型別 | 目標 | 信心 | 問題 | 建議動作 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 疾病介紹<br><sub>www.cdc.gov.tw/Disease/SubIndex/WYbKe3aE7LiY5gb-eA8PBw</sub> | 併入疾病頁 → `disease.dengue`（併入：transmission） | `disease.dengue`（既有） | 1 | — | 併入疾病頁區塊（與既有內容逐段比對） |
| 2 | 致病原<br><sub>www.cdc.gov.tw/Disease/SubIndex/WYbKe3aE7LiY5gb-eA8PBw</sub> | 併入疾病頁 → `disease.dengue`（併入：transmission） | `disease.dengue`（既有） | 1 | — | 併入疾病頁區塊（與既有內容逐段比對） |
| 3 | 流行病學<br><sub>www.cdc.gov.tw/Disease/SubIndex/WYbKe3aE7LiY5gb-eA8PBw</sub> | 併入疾病頁 → `disease.dengue`（併入：situation） | `disease.dengue`（既有） | 0.8 | image-no-alt | 併入疾病頁區塊（與既有內容逐段比對） |
| 4 | 傳染方式<br><sub>www.cdc.gov.tw/Disease/SubIndex/WYbKe3aE7LiY5gb-eA8PBw</sub> | 併入疾病頁 → `disease.dengue`（併入：transmission） | `disease.dengue`（既有） | 1 | — | 併入疾病頁區塊（與既有內容逐段比對） |
| 5 | 潛伏期<br><sub>www.cdc.gov.tw/Disease/SubIndex/WYbKe3aE7LiY5gb-eA8PBw</sub> | 併入疾病頁 → `disease.dengue`（併入：transmission） | `disease.dengue`（既有） | 1 | — | 併入疾病頁區塊（與既有內容逐段比對） |
| 6 | 發病症狀<br><sub>www.cdc.gov.tw/Disease/SubIndex/WYbKe3aE7LiY5gb-eA8PBw</sub> | 併入疾病頁 → `disease.dengue`（併入：symptoms） | `disease.dengue`（既有） | 1 | — | 併入疾病頁區塊（與既有內容逐段比對） |
| 7 | 預防方法<br><sub>www.cdc.gov.tw/Disease/SubIndex/WYbKe3aE7LiY5gb-eA8PBw</sub> | 併入疾病頁 → `disease.dengue`（併入：prevention） | `disease.dengue`（既有） | 1 | — | 併入疾病頁區塊（與既有內容逐段比對） |
| 8 | 治療方法與就醫資訊<br><sub>www.cdc.gov.tw/Disease/SubIndex/WYbKe3aE7LiY5gb-eA8PBw</sub> | 併入疾病頁 → `disease.dengue`（併入：treatment） | `disease.dengue`（既有） | 1 | — | 併入疾病頁區塊（與既有內容逐段比對） |
| 9 | 預防接種建議<br><sub>www.cdc.gov.tw/Category/MPage/w0zYM6B9tfqAm2A5O7xXt5</sub> | 併入疾病頁 → `disease.dengue`（併入：vaccine） | `disease.dengue`（既有） | 0.8 | body-short | 併入疾病頁區塊（與既有內容逐段比對） |
| 10 | Q&A<br><sub>www.cdc.gov.tw/Category/QAPage/4kMzhnwTwPIrf_KETxhqzF</sub> | Q&A → `faq.dengue-community-mobilize`<br>`faq.dengue-container-check`<br>`faq.dengue-fever-when-to-see-doctor`<br>`faq.dengue-imported-return`<br>`faq.dengue-painkiller`<br>`faq.dengue-spraying-refuse`<br>`faq.travel-return-fever` | `disease.dengue`（既有） | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 11 | 衛教宣導：單張海報<br><sub>www.cdc.gov.tw/Category/List/LUpyIsMuAB-KVgWh8d78i-</sub> | 清單頁 → `page.dengue-materials-poster` | — | 0.4 ⚠ | pdf-no-text-layer、image-no-alt | 人工檢視（信心低於門檻） |
| 12 | 衛教宣導：影片<br><sub>www.cdc.gov.tw/Category/MPage/CLbo-hZJ7DMhVXD7dzOVGd</sub> | 頁面 → `page.dengue-materials-video` | `media.dengue-village-chief`（既有） | 0.8 | embedded-media | 既有內容已存在，供比對，不建議覆蓋 |
| 13 | 傳染病防治工作手冊（2026 年版）<br><sub>www.cdc.gov.tw/Category/DiseaseManual/QfdYJUGw2n5jaHqO-cy_Ce</sub> | 文件 → `doc.dengue-manual.2026-03-01` | — | 1 | — | 核對後入庫（新站尚無對應內容） |
| 14 | 傳染病病例定義：登革熱（2026 年版）<br><sub>www.cdc.gov.tw/Category/DiseaseDefine/q7EpU6zgW8ZaV760caAnem</sub> | 文件 → `doc.case-definition-dengue.2023-01-01` | `doc.case-definition-dengue.2023-01-01`（既有） | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 15 | 登革熱社區防治工作指引：孳生源清除、病媒蚊監測與群聚應變<br><sub>www.cdc.gov.tw/File/Get/SSH7ZzPb8Df0AsqCjVeXnt</sub> | 文件 → `doc.dengue-d7bdfa.2026-09-10` | — | 1 | not-in-manifest | 核對後入庫（新站尚無對應內容） |
| 16 | 統計資料<br><sub>www.cdc.gov.tw/Category/List/24UnSJ76XgcjnNUGy3DMcd</sub> | 清單頁 → `page.dengue-stats` | `dataset.dengue-daily`（既有） | 0.6 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 17 | 檢驗資訊<br><sub>www.cdc.gov.tw/Category/MPage/nBSoKp75tD_JsUcg-PolJx</sub> | 頁面 → `page.dengue-lab` | `labtest.dengue`（既有） | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 18 | 通報定義與時限<br><sub>www.cdc.gov.tw/Category/MPage/Pf3UBeMVfwJ2iKzOXg70zj</sub> | 頁面 → `page.dengue-notify` | — | 1 | — | 核對後入庫（新站尚無對應內容） |
| 19 | 新聞稿列表<br><sub>www.cdc.gov.tw/Bulletin/List/Ec6GP0RNpHHLRvO7x-1nRT</sub> | 清單頁 → `page.dengue-news-list` | `disease.dengue`（既有） | 0.6 | — | 清單頁，不轉換（新站由系統自動產生列表） |
| 20 | 相關連結<br><sub>www.cdc.gov.tw/Category/List/0Pl9_aCavv9CeM29DdTD7G</sub> | 清單頁 → `page.dengue-links` | `topic.disaster-evacuation`（既有） | 0.6 | — | 清單頁，不轉換（新站由系統自動產生列表） |
| 21 | 登革熱防治專區（首頁）<br><sub>www.cdc.gov.tw/Category/Page/IUXWpR9CZiGGA6OjQiiKOc</sub> | 頁面 → `page.dengue-zone` | `disease.dengue`（既有） | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 22 | 病媒蚊密度調查結果<br><sub>www.cdc.gov.tw/Category/List/3ZwNd9eoMVqqi7PDTlqIyw</sub> | 清單頁 → `page.dengue-vector-density` | — | 0.6 | — | 清單頁，不轉換（新站由系統自動產生列表） |
| 23 | 孳生源清除與社區動員（巡倒清刷）<br><sub>www.cdc.gov.tw/Category/MPage/rLPU3Gwbwg97BZ_2MG5efk</sub> | 頁面 → `page.dengue-source-reduction` | `doc.dengue-community-workplan.2026-09-10`（既有） | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 24 | 群聚事件應變與緊急防治<br><sub>www.cdc.gov.tw/Category/MPage/j_J4tv6ANjXOs3PJQTPe8z</sub> | 頁面 → `page.dengue-cluster-response` | `doc.dengue-community-workplan.2026-09-10`（既有） | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 25 | NS1 抗原快篩試劑配置公告（致醫界通函）<br><sub>www.cdc.gov.tw/Bulletin/Detail/UTWPs0f26dqP75NLaqYOpg?typeid=11</sub> | 新聞 → `news.2026-09-15-letter-616-ns1` | `news.2026-09-15-letter-616-ns1`（既有） | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 26 | 登革熱／屈公病防治工作指引（第 16 版）<br><sub>www.cdc.gov.tw/File/Get/eisdR8ngYeiulZ08rD9J9A</sub> | 文件 → `doc.guidance-dengue.v16` | `doc.guidance-dengue.v16`（既有） | 1 | pdf-no-text-layer | 既有內容已存在，供比對，不建議覆蓋 |
| 27 | 影音：里長帶頭巡倒清刷<br><sub>www.cdc.gov.tw/Category/List/wcABV3owliF5_29uKba1VA</sub> | 清單頁 → `page.dengue-village-chief-video` | `media.dengue-village-chief`（既有） | 0.4 ⚠ | embedded-media | 清單頁，不轉換（新站由系統自動產生列表） |
| 28 | 外籍勞工登革熱防治宣導（多語單張）<br><sub>www.cdc.gov.tw/Category/List/yNCv7fIZytqR8M72_3DGXS</sub> | 清單頁 → `page.dengue-migrant-worker-materials` | — | 0.4 ⚠ | embedded-media | 清單頁，不轉換（新站由系統自動產生列表） |
| 29 | 流感疫情持續上升，10 月 1 日公費疫苗開打，長者幼兒請優先接種<br><sub>www.cdc.gov.tw/Bulletin/Detail/j9AyvNwbg3RF2utKUq6c6I?typeid=9</sub> | 新聞 → `news.2026-09-29-ili-weekly` | — | 1 | not-in-manifest | 既有內容已存在，供比對，不建議覆蓋 |
| 30 | 南部登革熱本土疫情上升，籲請民眾配合孳生源清除與防治工作<br><sub>www.cdc.gov.tw/Bulletin/Detail/x14hC_-aNBFlGE_fgPYXtG?typeid=9</sub> | 新聞 → `news.2026-08-18-dengue-rising-south` | — | 1 | not-in-manifest | 既有內容已存在，供比對，不建議覆蓋 |
| 31 | 今年首例登革熱本土病例出現於高雄市，請民眾清除積水容器<br><sub>www.cdc.gov.tw/Bulletin/Detail/9EfoEs8AvQebnkHbh47GM3?typeid=9</sub> | 新聞 → `news.2026-07-21-dengue-first-local` | — | 1 | not-in-manifest | 既有內容已存在，供比對，不建議覆蓋 |
| 32 | 致醫界通函第 612 號：登革熱／屈公病防治工作指引第 17 版自即日起適用<br><sub>www.cdc.gov.tw/Bulletin/Detail/Ztstqjy7MJdl7pkQSReHpB?typeid=11</sub> | 新聞 → `news.2026-07-01-letter-dengue-guidance-v17` | — | 1 | not-in-manifest | 既有內容已存在，供比對，不建議覆蓋 |
| 33 | 致醫界通函第 603 號：登革熱／屈公病防治工作指引第 16 版公布<br><sub>www.cdc.gov.tw/Bulletin/Detail/C3M3v5QNkdLxk3VSZVzpzv?typeid=11</sub> | 新聞 → `news.2025-11-11-letter-dengue-guidance-v16` | — | 1 | not-in-manifest | 既有內容已存在，供比對，不建議覆蓋 |

## 需人工檢視（3 頁）

- **衛教宣導：單張海報**（信心 0.4）
  - 警告：PDF「dengue-poster-7lang.pdf」沒有文字層（掃描檔），上架前須附同名 .md／.docx 可及性版本，或重做有文字層的 PDF
  - 警告：圖片「dengue-poster.png」舊頁沒有替代文字，暫用檔名「dengue-poster」，請補 alt（needsAlt）
- **影音：里長帶頭巡倒清刷**（信心 0.4）
  - 警告：內文有嵌入媒體 1 個（iframe）未轉入；影音請另建 media 內容
- **外籍勞工登革熱防治宣導（多語單張）**（信心 0.4）
  - 警告：內文有嵌入媒體 1 個（iframe）未轉入；影音請另建 media 內容

## 併入疾病頁（9 頁）

- 「疾病介紹」→ `disease.dengue` 區塊 transmission（疾病頁既有內容已存在，供比對）
- 「致病原」→ `disease.dengue` 區塊 transmission（疾病頁既有內容已存在，供比對）
- 「流行病學」→ `disease.dengue` 區塊 situation（疾病頁既有內容已存在，供比對）
- 「傳染方式」→ `disease.dengue` 區塊 transmission（疾病頁既有內容已存在，供比對）
- 「潛伏期」→ `disease.dengue` 區塊 transmission（疾病頁既有內容已存在，供比對）
- 「發病症狀」→ `disease.dengue` 區塊 symptoms（疾病頁既有內容已存在，供比對）
- 「預防方法」→ `disease.dengue` 區塊 prevention（疾病頁既有內容已存在，供比對）
- 「治療方法與就醫資訊」→ `disease.dengue` 區塊 treatment（疾病頁既有內容已存在，供比對）
- 「預防接種建議」→ `disease.dengue` 區塊 vaccine（疾病頁既有內容已存在，供比對）

## 附件與圖片需要處理的

- 流行病學：圖片「dengue-trend.png」舊頁沒有替代文字，暫用檔名「dengue-trend」，請補 alt（needsAlt）
- 衛教宣導：單張海報：PDF「dengue-poster-7lang.pdf」沒有文字層（掃描檔），上架前須附同名 .md／.docx 可及性版本，或重做有文字層的 PDF
- 衛教宣導：單張海報：圖片「dengue-poster.png」舊頁沒有替代文字，暫用檔名「dengue-poster」，請補 alt（needsAlt）
- 登革熱／屈公病防治工作指引（第 16 版）：PDF「guidance-dengue.v16.pdf」沒有文字層（掃描檔），上架前須附同名 .md／.docx 可及性版本，或重做有文字層的 PDF

## 與移轉清單的差異

- 清單有、匯出沒有：無
- 匯出有、清單沒有：15-guideline、29-news-2026-09-29-ili-weekly、30-news-2026-08-18-dengue-rising-south、31-news-2026-07-21-dengue-first-local、32-news-2026-07-01-letter-dengue-guidance-v17、33-news-2025-11-11-letter-dengue-guidance-v16
- 與清單判定不同（不覆蓋，人工決定）：無
- 套用規則：只改 status／target／note，不動 verified；僅「待確認(pending)且新站已有對應內容」的項目才改 status（人工已判定的項目不被覆蓋，差異列在 conflicts）。

