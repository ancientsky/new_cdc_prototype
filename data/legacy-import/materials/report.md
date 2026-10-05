# 舊站匯出轉換報告：materials

> **模擬匯出**（開發環境連不到舊站，依移轉清單合成；正式匯出取代即可）。匯出日 2026-10-03；轉換時間 2026-10-05T02:30:00Z；規則檔 `content/migration/import/_import-rules.json`；移轉清單 `content/migration/materials.json`（21 筆）。

## 批次摘要

| 項目 | 數字 |
| --- | --- |
| 舊頁數 | 24 |
| 產出草稿 | 21（影音 4、頁面 9、出版品 7、資料集 1） |
| 舊頁型別 | 影音 6、頁面 3、出版品 8、清單頁 6、資料集 1 |
| 平均信心 | 0.83 |
| 需人工檢視（信心 < 0.6） | 3 |
| 既有內容已存在（供比對） | 5 |
| 附件與圖片 | 35（附件 19、內文圖片 15、資料檔 1；圖片待補 alt 4、PDF 無文字層 0） |
| 草稿 schema 驗證 | 21 / 21 通過 |
| 問題 | 錯誤 0、警告 26、提示 75 |
| 移轉清單對應 | 對上 21 / 21 筆；status 變化 0；note 更新 0；仍待移轉 10；與清單判定不同 0 |
| 清單沒有的舊頁 | 3（migration-patch.json 的 unmatchedPages 有建議的 pending 項目） |

處理原則：一級內容（疾病頁、指引、手冊）一律人工確認後才入庫；近年新聞信心 ≥ 0.8 可核對後自動上線；久遠與歷史版本封存；草稿放在本目錄，**不會**寫進 `content/`。

## 逐頁結果

| # | 來源 | 型別 | 目標 | 信心 | 問題 | 建議動作 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 濕搓沖捧擦：腸病毒洗手五步驟動畫<br><sub>www.cdc.gov.tw/Category/ListContent/VujZUu3PXzEl4PjbFhh5D8?uaid=2J2WLQQVD-Okme7i011Cw5</sub> | 影音 → `media.enterovirus-handwashing` | `media.enterovirus-handwashing`（既有） | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 2 | 防疫衛教宣導之商業媒體運用情形一覽表<br><sub>www.cdc.gov.tw/Category/MPage/-2qVuGOsbhtkGWlpYw1scA</sub> | 頁面 → `page.x-commercial-media-table` | — | 1 | — | 核對後入庫（新站尚無對應內容） |
| 3 | 數位學習課程<br><sub>www.cdc.gov.tw/Category/MPage/1ptYuzMUqvZ6J2QOzSLk6A</sub> | 頁面 → `page.x-e-learning` | — | 1 | — | 核對後入庫（新站尚無對應內容） |
| 4 | 1922 防疫達人（Facebook／LINE）<br><sub>www.cdc.gov.tw/Category/ListContent/T4NQf3E9zQFFjYKNWGBgTK?uaid=THu-Ah2wZaY7MEXWOAcXcp</sub> | 頁面 → `page.x-fb-1922` | — | 1 | — | 核對後入庫（新站尚無對應內容） |
| 5 | M痘防治懶人包（社群圖卡）<br><sub>www.cdc.gov.tw/Category/ListContent/YV1yFFBI_B1Rhm6XDQvlgy?uaid=9brwAIb5B5QVwyszmo6TZh</sub> | 出版品 → `publication.mpox-infographic-mpox` | — | 1 | fields-pending | 核對後入庫（新站尚無對應內容） |
| 6 | 腸病毒洗手五步驟單張<br><sub>www.cdc.gov.tw/Category/ListContent/Z5jlKeN6dG0jpwhf4TO0JV?uaid=RCqem2td9FR_uO2EXyBUul</sub> | 出版品 → `publication.enterovirus-leaflet-ev-handwashing` | — | 0.8 | image-no-alt、body-short、image-only、fields-pending | 核對後入庫（新站尚無對應內容） |
| 7 | 單張<br><sub>www.cdc.gov.tw/Category/List/Z5jlKeN6dG0jpwhf4TO0JV</sub> | 清單頁 → `page.x-list-leaflets` | — | 0.4 ⚠ | body-short | 清單頁，不轉換（新站由系統自動產生列表） |
| 8 | 手冊<br><sub>www.cdc.gov.tw/Category/List/DG4AoD4j09j2qW_YhrYAZ2</sub> | 清單頁 → `page.x-list-manuals` | — | 0.4 ⚠ | body-short | 清單頁，不轉換（新站由系統自動產生列表） |
| 9 | 宣導素材<br><sub>www.cdc.gov.tw/Category/List/VOFCg57Yk3iO3I_WxoXOIA</sub> | 清單頁 → `page.x-list-materials` | — | 0.6 | — | 清單頁，不轉換（新站由系統自動產生列表） |
| 10 | 多媒體<br><sub>www.cdc.gov.tw/Category/ListMovie/slfvh8DLgS6fkbLiuN-WHg</sub> | 清單頁 → `page.x-list-multimedia` | — | 0.6 | — | 清單頁，不轉換（新站由系統自動產生列表） |
| 11 | 海報<br><sub>www.cdc.gov.tw/Category/List/YV1yFFBI_B1Rhm6XDQvlgy</sub> | 清單頁 → `page.x-list-posters` | — | 0.6 | — | 清單頁，不轉換（新站由系統自動產生列表） |
| 12 | 影片<br><sub>www.cdc.gov.tw/Category/ListMovie/DWSgB84e8MEvXgBqiQmR6A</sub> | 清單頁 → `page.x-list-videos` | — | 0.4 ⚠ | body-short | 清單頁，不轉換（新站由系統自動產生列表） |
| 13 | 長照機構感染管制手冊（宣導版）<br><sub>www.cdc.gov.tw/Category/ListContent/DG4AoD4j09j2qW_YhrYAZ2?uaid=JaTSqWyasrqZpL-tvXo9BS</sub> | 出版品 → `publication.manual-ltc-infection-control-2026` | `publication.manual-ltc-infection-control-2026`（既有） | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 14 | 多國語言衛教素材<br><sub>www.cdc.gov.tw/Category/MPage/Y_AH_Ka7q03cfN15CyI-nQ</sub> | 資料集 → `dataset.health-education-materials` | `dataset.health-education-materials`（既有） | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 15 | Podcast｜抗生素不是萬靈丹：談抗藥性與防疫一體<br><sub>www.cdc.gov.tw/Category/ListContent/VujZUu3PXzEl4PjbFhh5D8?uaid=GEJHb3XRbbo3EPVrBVucx2</sub> | 影音 → `media.amr-one-health-podcast` | `media.amr-one-health-podcast`（既有） | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 16 | 防疫新生活運動海報（COVID-19）<br><sub>www.cdc.gov.tw/Category/ListContent/YV1yFFBI_B1Rhm6XDQvlgy?uaid=jqYodXZl8Ti6hySLNXVlBs</sub> | 出版品 → `publication.covid-19-poster-covid-new-life-2021` | — | 1 | image-only、fields-pending | 封存（歷史版本／久遠內容，舊版保留查閱） |
| 17 | 登革熱「巡、倒、清、刷」海報系列<br><sub>www.cdc.gov.tw/Category/ListContent/YV1yFFBI_B1Rhm6XDQvlgy?uaid=OW0GWvcK_N7x2_x6CcO_sV</sub> | 出版品 → `publication.dengue-poster-dengue-patrol-series` | — | 0.8 | image-no-alt、image-no-alt、image-no-alt、body-short、image-only、fields-pending | 核對後入庫（新站尚無對應內容） |
| 18 | 流感疫苗接種宣導海報（七語）<br><sub>www.cdc.gov.tw/Category/ListContent/YV1yFFBI_B1Rhm6XDQvlgy?uaid=-XlC5SdLwgyfRsnIbvDA-R</sub> | 出版品 → `publication.influenza-poster-flu-vaccine-7lang` | — | 0.8 | body-short、image-only、material-outdated、fields-pending | 核對後入庫（新站尚無對應內容） |
| 19 | 麻疹防治宣導海報（2019 年版）<br><sub>www.cdc.gov.tw/Category/ListContent/YV1yFFBI_B1Rhm6XDQvlgy?uaid=RYSFjWglrrDCumRjbTT1_t</sub> | 出版品 → `publication.measles-poster-measles-2019` | — | 0.8 | body-short、image-only、material-outdated、fields-pending | 封存（歷史版本／久遠內容，舊版保留查閱） |
| 20 | 宣導素材：咳嗽兩週要就醫（多國語言海報）<br><sub>www.cdc.gov.tw/Category/List/HFc75kGSabhKRWZ0sV_2Ii</sub> | 出版品 → `publication.poster-tb-seven-languages`（重複，未輸出） | — | 1 | — | 已在其他批次轉過（同網址），本批不重複出草稿 |
| 21 | 里長帶頭巡倒清刷：社區防登革熱篇<br><sub>www.cdc.gov.tw/Category/ListContent/44k4KHKf48A57gNpJRnnj3?uaid=VQRmxBAVBgtS5ytV4SMyZ0</sub> | 影音 → `media.dengue-village-chief` | `media.dengue-village-chief`（既有） | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 22 | 寵物打狂犬病疫苗：守護家人也守護毛孩（影片）<br><sub>www.cdc.gov.tw/Category/ListContent/44k4KHKf48A57gNpJRnnj3?uaid=laU0p6BaBsID7VGsQ3zBHj</sub> | 影音 → `media.rabies-video-rabies-pets` | — | 0.8 | body-short、fields-pending | 核對後入庫（新站尚無對應內容） |
| 23 | 宣導素材：咳嗽兩週快去照胸部 X 光（影片）<br><sub>www.cdc.gov.tw/Category/MPage/dLJ7UFpx2F-K6hTsKuUoSK</sub> | 影音 → `media.tb-cough-two-weeks`（重複，未輸出） | — | 1 | — | 已在其他批次轉過（同網址），本批不重複出草稿 |
| 24 | 宣導素材：移工健康檢查（影片）<br><sub>www.cdc.gov.tw/Category/MPage/vONM9MVB6T0IMaoT_2kYS6</sub> | 影音 → `media.migrant-worker-health-check`（重複，未輸出） | — | 1 | — | 已在其他批次轉過（同網址），本批不重複出草稿 |

## 需人工檢視（3 頁）

- **單張**（信心 0.4）
  - 警告：內文過短（10 字，低於 40）
- **手冊**（信心 0.4）
  - 警告：內文過短（15 字，低於 40）
- **影片**（信心 0.4）
  - 警告：內文過短（39 字，低於 40）

## 併入疾病頁（0 頁）


## 二級抽樣檢視名單（近年新聞 auto-ok 0 頁，抽 10% ＝ 0 頁）

本批沒有可自動上線的近年新聞。

抽樣由網址雜湊排序決定，重跑不變；公關室看完名單沒有問題，整批 auto-ok 才改 `published` 開 PR（第 7 節二級）；發現率超過 10% 就暫停自動上線、回頭修規則。

## 附件與圖片需要處理的

- 腸病毒洗手五步驟單張：圖片「ev-handwashing-steps.png」舊頁沒有替代文字，暫用檔名「ev-handwashing-steps」，請補 alt（needsAlt）
- 登革熱「巡、倒、清、刷」海報系列：圖片「dengue-patrol-4.png」舊頁沒有替代文字，暫用檔名「dengue-patrol-4」，請補 alt（needsAlt）
- 登革熱「巡、倒、清、刷」海報系列：圖片「dengue-patrol-5.png」舊頁沒有替代文字，暫用檔名「dengue-patrol-5」，請補 alt（needsAlt）
- 登革熱「巡、倒、清、刷」海報系列：圖片「dengue-patrol-6.png」舊頁沒有替代文字，暫用檔名「dengue-patrol-6」，請補 alt（needsAlt）

## 與移轉清單的差異

- 清單有、匯出沒有：無
- 匯出有、清單沒有：20-poster-tb-7lang、23-video-tb-cough、24-video-tb-migrant
- 與清單判定不同（不覆蓋，人工決定）：無
- 套用規則：只改 status／target／newPath／note，不動 verified；僅「待確認(pending)且新站已有對應內容」的項目才改 status（人工已判定的項目不被覆蓋，差異列在 conflicts）。

