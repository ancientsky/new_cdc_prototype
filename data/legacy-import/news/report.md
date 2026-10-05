# 舊站匯出轉換報告：news

> **模擬匯出**（開發環境連不到舊站，依移轉清單合成；正式匯出取代即可）。匯出日 2026-10-03；轉換時間 2026-10-05T02:30:00Z；規則檔 `content/migration/import/_import-rules.json`；移轉清單 （未指定）。

## 批次摘要

| 項目 | 數字 |
| --- | --- |
| 舊頁數 | 60 |
| 產出草稿 | 60（新聞 45、致醫界通函 4、澄清稿 10、頁面 1） |
| 舊頁型別 | 新聞 49、澄清稿 10、清單頁 1 |
| 平均信心 | 0.97 |
| 需人工檢視（信心 < 0.6） | 0 |
| 既有內容已存在（供比對） | 45 |
| 附件與圖片 | 10（附件 10、內文圖片 0、資料檔 0；圖片待補 alt 0、PDF 無文字層 3） |
| 草稿 schema 驗證 | 60 / 60 通過 |
| 問題 | 錯誤 0、警告 12、提示 88 |

處理原則：一級內容（疾病頁、指引、手冊）一律人工確認後才入庫；近年新聞信心 ≥ 0.8 可核對後自動上線；久遠與歷史版本封存；草稿放在本目錄，**不會**寫進 `content/`。

## 逐頁結果

| # | 來源 | 型別 | 目標 | 信心 | 問題 | 建議動作 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 10 月 3 日晚間官網與傳染病通報系統例行維護<br><sub>www.cdc.gov.tw/Bulletin/Detail/DaoU2_VYCU97SjvAr1XKY_?typeid=11</sub> | 新聞 → `news.2026-09-30-system-maintenance` | — | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 2 | 流感疫情持續上升，10 月 1 日公費疫苗開打，長者幼兒請優先接種<br><sub>www.cdc.gov.tw/Bulletin/Detail/yhS71H6AwbqsE3nQogBZ8U?typeid=9</sub> | 新聞 → `news.2026-09-29-ili-weekly` | — | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 3 | 林森南路辦公區停車場施工，10 月 5 日至 11 月 30 日暫停開放<br><sub>www.cdc.gov.tw/Bulletin/Detail/CaPi1oYIuPIPMzZ3cd_67A?typeid=11</sub> | 新聞 → `news.2026-09-28-parking-construction` | — | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 4 | 署慶系列活動：防疫科學開放日 10 月 24 日登場<br><sub>www.cdc.gov.tw/Bulletin/Detail/NNo0rSkCihP4mgjpWQ3FDd?typeid=11</sub> | 新聞 → `news.2026-09-26-open-house` | — | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 5 | 疾管署公布第 38 週傳染病監測週報：類流感就診率續升，腸病毒疫情趨緩<br><sub>www.cdc.gov.tw/Bulletin/Detail/_1Whs2KInA7M1gXev3fuOr?typeid=9</sub> | 新聞 → `news.2026-09-24-legacy-f7b345` | — | 1 | — | 近年新聞，核對後可自動上線 |
| 6 | 國內腸病毒疫情持續，籲請家長及教托育機構提高警覺<br><sub>www.cdc.gov.tw/Bulletin/Detail/iu5ZQsbMqaS6hQvwC1hRAT?typeid=9</sub> | 新聞 → `news.2026-09-22-enterovirus-alert` | — | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 7 | 類流感進入高峰期，未滿 5 歲及 65 歲以上有症狀者可直接使用公費抗病毒藥劑免快篩<br><sub>www.cdc.gov.tw/Bulletin/Detail/YG8JykIhAUKYkuuwJx0xGS?typeid=9</sub> | 新聞 → `news.2026-09-21-flu-antiviral-revised` | — | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 8 | 2026–2027 年度公費流感疫苗 10 月 1 日開打，新冠疫苗同步提供<br><sub>www.cdc.gov.tw/Bulletin/Detail/lYMJFMdaheSyPHiJkkKugt?typeid=9</sub> | 新聞 → `news.2026-09-18-flu-vaccine-oct1` | — | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 9 | Taiwan CDC signs a public health cooperation MOU with a New Southbound partner<br><sub>www.cdc.gov.tw/Bulletin/Detail/ac1-BUx7wJb5j4GLZggaOv?typeid=9</sub> | 新聞 → `news.2026-09-15-international-health-mou` | — | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 10 | 致醫界通函第 616 號：登革熱 NS1 抗原快篩試劑配置更新<br><sub>www.cdc.gov.tw/Bulletin/Detail/biICsHiYf-BLRABlKsEYap?typeid=48</sub> | 新聞 → `news.2026-09-15-letter-616-ns1` | — | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 11 | 網傳「防疫國家隊」投資群組為詐騙<br><sub>www.cdc.gov.tw/Bulletin/Detail/7HBern14siglf3j_FN5W-i?typeid=8772</sub> | 澄清稿 → `clar.2026-09-anti-epidemic-team-scam` | — | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 12 | 登革熱防治：疾管署與高雄市政府聯合孳生源清除，呼籲民眾巡倒清刷<br><sub>www.cdc.gov.tw/Bulletin/Detail/tVOO6DTH_ehRSk8H6crMnS?typeid=9</sub> | 新聞 → `news.2026-09-12-legacy-16fe19` | — | 1 | — | 近年新聞，核對後可自動上線 |
| 13 | 澄清：網傳「打流感疫苗會得流感、長輩打完會死」並非事實<br><sub>www.cdc.gov.tw/Bulletin/Detail/ghycdDd__NUQxVqr1Scgoi?typeid=8772</sub> | 澄清稿 → `clar.2026-09-10-influenza-864a02` | `news.2026-09-10-clarify-flu-vaccine-death`（既有） | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 14 | 網傳「打流感疫苗會得流感、長輩打完會死」並非事實<br><sub>www.cdc.gov.tw/Bulletin/Detail/Dzynlz25x0lr3lnuqyz_ZL?typeid=8772</sub> | 澄清稿 → `clar.2026-09-flu-vaccine-causes-flu` | — | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 15 | 新冠疫情連續三週下降，10 月起新年度疫苗與流感疫苗同步開打<br><sub>www.cdc.gov.tw/Bulletin/Detail/aXeVzpSMDHPv5coJCwA9TH?typeid=9</sub> | 新聞 → `news.2026-09-01-covid-weekly` | — | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 16 | 疾管署提醒：開學季腸病毒傳播風險升高，落實洗手與生病不上學<br><sub>www.cdc.gov.tw/Bulletin/Detail/hXen_WGNxzD6BAZm3Q-6D-?typeid=9</sub> | 新聞 → `news.2026-08-28-legacy-d5275b` | — | 1 | — | 近年新聞，核對後可自動上線 |
| 17 | 非洲 M痘 clade I 疫情持續，前往當地請避免親密接觸與野生動物<br><sub>www.cdc.gov.tw/Bulletin/Detail/qu6QBO4Jen5iRNtc4VWZhv?typeid=9</sub> | 新聞 → `news.2026-08-25-mpox-clade-i` | — | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 18 | 都治 20 年：關懷員每日送藥到手，結核病完治率穩定提升<br><sub>www.cdc.gov.tw/Bulletin/Detail/4Qs5n5XsyAbuTPUUJoJ1XA?typeid=9</sub> | 新聞 → `news.2026-08-20-dots-outcomes` | — | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 19 | 南部登革熱本土疫情上升，籲請民眾配合孳生源清除與防治工作<br><sub>www.cdc.gov.tw/Bulletin/Detail/1VBVQuZiOzJEkifjLw-7gM?typeid=9</sub> | 新聞 → `news.2026-08-18-dengue-rising-south` | — | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 20 | International field epidemiology workshop opens in Taipei<br><sub>www.cdc.gov.tw/Bulletin/Detail/j6slN2h_XoK_nqIeC5ht4x?typeid=9</sub> | 新聞 → `news.2026-08-17-international-fetp-workshop` | — | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 21 | 麻疹境外移入病例新增 1 例，疾管署公布接觸者活動史並呼籲 1966 年後出生者評估接種 MMR<br><sub>www.cdc.gov.tw/Bulletin/Detail/aDxmeNfFzCZphM65ldsE8y?typeid=9</sub> | 新聞 → `news.2026-08-05-legacy-0e5573` | — | 0.8 | body-short | 核對後入庫（新站尚無對應內容） |
| 22 | 今年首例登革熱本土病例出現於高雄市，請民眾清除積水容器<br><sub>www.cdc.gov.tw/Bulletin/Detail/GEpsXBU9Dqh7eC0kYpES4g?typeid=9</sub> | 新聞 → `news.2026-07-21-dengue-first-local` | — | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 23 | 疾管署公布 2025 年結核病防治成果：新案數續降，都治完治率達 9 成<br><sub>www.cdc.gov.tw/Bulletin/Detail/Y-t1hTiNTbjjrqiAHUTzjm?typeid=9</sub> | 新聞 → `news.2026-07-10-legacy-2ed983` | — | 0.8 | body-short | 核對後入庫（新站尚無對應內容） |
| 24 | 致醫界通函第 612 號：登革熱／屈公病防治工作指引第 17 版自即日起適用<br><sub>www.cdc.gov.tw/Bulletin/Detail/vPGiv9yS8N4qipZSchUD_n?typeid=48</sub> | 新聞 → `news.2026-07-01-letter-dengue-guidance-v17` | — | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 25 | 夏季出國旅遊前請先查疫情：疾管署更新國際旅遊疫情建議等級<br><sub>www.cdc.gov.tw/Bulletin/Detail/Zg1sEf1_dN9UqgbyCyAdmD?typeid=9</sub> | 新聞 → `news.2026-06-20-legacy-02b775` | — | 1 | — | 近年新聞，核對後可自動上線 |
| 26 | 夏季流感疫情持續，公費抗病毒藥劑使用對象維持現行規定<br><sub>www.cdc.gov.tw/Bulletin/Detail/mDWl7IIU_wsF4S5AWAkkI_?typeid=9</sub> | 新聞 → `news.2026-06-03-flu-antiviral-summer` | — | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 27 | 暑假出國前請評估麻疹免疫力：1966 年（含）以後出生者出國前 2 至 4 週評估接種 MMR<br><sub>www.cdc.gov.tw/Bulletin/Detail/EOQ5VTspoKXsrS3jrB8tFv?typeid=9</sub> | 新聞 → `news.2026-06-02-measles-travel-mmr-1966` | — | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 28 | Taiwan CDC experts hold technical exchanges during the World Health Assembly week<br><sub>www.cdc.gov.tw/Bulletin/Detail/nzlD95UZ0xuu5PG-CvvCWD?typeid=9</sub> | 新聞 → `news.2026-05-22-international-wha-technical-exchange` | — | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 29 | 網傳「所有成人都要再補打一劑 MMR」部分正確<br><sub>www.cdc.gov.tw/Bulletin/Detail/vy2WAmm2rOtB8yrPEHV2HU?typeid=8772</sub> | 澄清稿 → `clar.2026-05-mmr-all-adults` | — | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 30 | 日本麻疹疫情升溫，列為第一級旅遊疫情建議；出國前請評估 MMR 接種<br><sub>www.cdc.gov.tw/Bulletin/Detail/uHkheEnk9OnK55D2DsatrZ?typeid=9</sub> | 新聞 → `news.2026-05-11-japan-measles-level1` | — | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 31 | 網傳「腸病毒只有小孩會得，大人不用擔心」部分正確<br><sub>www.cdc.gov.tw/Bulletin/Detail/6zjetJzWqW6DijXlzQOztD?typeid=8772</sub> | 澄清稿 → `clar.2026-04-enterovirus-only-kids` | — | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 32 | 腸病毒就診人次連續上升，近期社區以 EV71 為主，籲請提高警覺<br><sub>www.cdc.gov.tw/Bulletin/Detail/RhVyEWsJgTfNMJy5tBXSql?typeid=9</sub> | 新聞 → `news.2026-04-14-enterovirus-rising` | — | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 33 | 世界結核病日：邁向 2035 消除結核，接觸者與高風險族群公費檢驗潛伏感染<br><sub>www.cdc.gov.tw/Bulletin/Detail/Jiq_KGR34Qxvh8t2-byaEG?typeid=9</sub> | 新聞 → `news.2026-03-24-world-tb-day-end-tb-2035` | — | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 34 | 網傳「確診新冠要居家隔離 7 天，同住家人也要隔離」為舊規定<br><sub>www.cdc.gov.tw/Bulletin/Detail/odHqEUP-ot2eDzawy1NfoE?typeid=8772</sub> | 澄清稿 → `clar.2026-03-covid-isolation-7-days` | — | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 35 | 致醫界通函第 608 號：腸病毒感染併發重症臨床處置建議更新<br><sub>www.cdc.gov.tw/Bulletin/Detail/noOQoAefRFSOg4tS8GrJym?typeid=48</sub> | 新聞 → `news.2026-03-15-letter-ev-guideline` | — | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 36 | 流感疫情緩降，仍處流行期，請持續注意手部衛生與咳嗽禮節<br><sub>www.cdc.gov.tw/Bulletin/Detail/-zweEOnUpHiyAskD0pNoZo?typeid=9</sub> | 新聞 → `news.2026-02-24-flu-declining` | — | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 37 | 流感疫情處高峰，春節連假前請儘速接種疫苗並落實咳嗽禮節<br><sub>www.cdc.gov.tw/Bulletin/Detail/eiEtxrKNmuAax0vpnd5RYh?typeid=9</sub> | 新聞 → `news.2026-01-20-lunar-new-year-flu` | — | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 38 | 網傳「燻白醋、喝鹽水可以殺死流感病毒」沒有科學根據<br><sub>www.cdc.gov.tw/Bulletin/Detail/9kUSvU-rUr8mbe1nhEgGb5?typeid=8772</sub> | 澄清稿 → `clar.2026-01-vinegar-saltwater-flu` | — | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 39 | 世界愛滋日：定期篩檢、PrEP 與 U=U，一起終結愛滋<br><sub>www.cdc.gov.tw/Bulletin/Detail/QkgmjdEJPXh042-RQFE5a5?typeid=9</sub> | 新聞 → `news.2025-12-01-world-aids-day` | — | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 40 | 致醫界通函第 603 號：登革熱／屈公病防治工作指引第 16 版公布<br><sub>www.cdc.gov.tw/Bulletin/Detail/Zf9eK5LCN7oF44mSOfe290?typeid=48</sub> | 新聞 → `news.2025-11-11-letter-dengue-guidance-v16` | — | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 41 | 114 年度公費流感疫苗今日開打，長者與幼兒請儘早接種<br><sub>www.cdc.gov.tw/Bulletin/Detail/i7x67klq3R1Dc2w8czhbO9?typeid=9</sub> | 新聞 → `news.2025-10-01-flu-vaccine-start` | — | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 42 | 中國大陸廣東省屈公病疫情升溫，提升旅遊疫情建議至第二級<br><sub>www.cdc.gov.tw/Bulletin/Detail/B9VMZhQt--eUB_XTFlLKJ9?typeid=9</sub> | 新聞 → `news.2025-08-05-chikungunya-guangdong` | — | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 43 | 澄清：網傳「登革熱噴藥會毒死人、可拒絕開門」為錯誤訊息<br><sub>www.cdc.gov.tw/Bulletin/Detail/P4sMHvb5xxLR344ZUut7C7?typeid=8772</sub> | 澄清稿 → `clar.2025-07-15-dengue-c37363` | `news.2025-07-15-clarify-dengue-spray`（既有） | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 44 | 網傳「登革熱噴藥會毒死人、可以拒絕開門」為錯誤訊息<br><sub>www.cdc.gov.tw/Bulletin/Detail/R1SLggitkGi0NAuncajZAY?typeid=8772</sub> | 澄清稿 → `clar.2025-07-dengue-spraying-poison` | — | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 45 | 暑假出遊與大型活動將至，符合條件者請把握接種 2 劑 M痘疫苗<br><sub>www.cdc.gov.tw/Bulletin/Detail/u7IBk8OIPlknZdqVvmiG9F?typeid=9</sub> | 新聞 → `news.2025-06-10-mpox-summer` | — | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 46 | 腸病毒進入流行期，籲請家長落實肥皂洗手並留意重症前兆<br><sub>www.cdc.gov.tw/Bulletin/Detail/QVLO-jKZ2FARVb-bSfRPlv?typeid=9</sub> | 新聞 → `news.2025-05-06-enterovirus-season` | — | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 47 | 修訂國內 MMR 預防接種建議：成人評估對象擴大至 1966 年（含）以後出生者<br><sub>www.cdc.gov.tw/Bulletin/Detail/-HrKmE3J7qp6A-3--AMJmK?typeid=9</sub> | 新聞 → `news.2025-04-16-mmr-recommendation-revised` | — | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 48 | MMR recommendations revised: adults born in 1966 or later now eligible for assessment<br><sub>www.cdc.gov.tw/Bulletin/Detail/V9mW8f2b5lpfkdk4UEOkRX?typeid=158</sub> | 新聞 → `news.2025-04-16-legacy-9688a5` | — | 1 | needs-source-zh | 核對後入庫（新站尚無對應內容） |
| 49 | 網傳「MMR 只有 1981 年後出生的人要補打」<br><sub>www.cdc.gov.tw/Bulletin/Detail/SE0WiE8vVquCNdRJPzEQ_s?typeid=8772</sub> | 澄清稿 → `clar.2025-04-mmr-born-after-1981-only` | — | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 50 | 世界結核病日：咳嗽兩週請就醫，接觸者檢查與潛伏感染治療守護家人<br><sub>www.cdc.gov.tw/Bulletin/Detail/Cr2nMmu7Ur-AtBx5QH4CzW?typeid=9</sub> | 新聞 → `news.2025-03-24-world-tb-day` | — | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 51 | World TB Day: see a doctor if you have coughed for two weeks; contact screening and latent TB treatment protect families<br><sub>www.cdc.gov.tw/Bulletin/Detail/w943Hotl5t_Y2UM7cuysEG?typeid=158</sub> | 新聞 → `news.2025-03-24-legacy-1952ec` | — | 1 | needs-source-zh | 核對後入庫（新站尚無對應內容） |
| 52 | 春節後登革熱境外移入病例增加，出國返國請落實防蚊<br><sub>www.cdc.gov.tw/Bulletin/Detail/BMWpfFWHjg3XxCaFghvXti?typeid=9</sub> | 新聞 → `news.2025-02-18-dengue-imported-spring` | — | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 53 | 國內新增麻疹病例，1981 年以後出生之醫護與赴流行區成人建議優先自費接種 MMR<br><sub>www.cdc.gov.tw/Bulletin/Detail/sLyeBG6AVEXUuxt1roWj88?typeid=9</sub> | 新聞 → `news.2025-01-09-mmr-adults-measles` | — | 1 | — | 既有內容已存在，供比對，不建議覆蓋 |
| 54 | 111 年度公費流感疫苗 10 月 1 日起分階段開打<br><sub>www.cdc.gov.tw/Bulletin/Detail/JMEQfzC_ayKMkPQlHzdrf4?typeid=9</sub> | 新聞 → `news.2022-10-01-legacy-2c1060` | — | 1 | — | 封存（歷史版本／久遠內容，舊版保留查閱） |
| 55 | 世界結核病日：疾管署呼籲咳嗽超過兩週請就醫<br><sub>www.cdc.gov.tw/Bulletin/Detail/85P41soNOAfNT4nIWsiq_U?typeid=9</sub> | 新聞 → `news.2022-03-24-legacy-ec9134` | — | 0.8 | body-short | 封存（歷史版本／久遠內容，舊版保留查閱） |
| 56 | COVID-19 疫情說明記者會（第 120 場）<br><sub>www.cdc.gov.tw/Bulletin/Detail/Tf45xxeAuvD4SVFkuvIeXM?typeid=9</sub> | 新聞 → `news.2021-05-15-legacy-c0b55c` | — | 0.8 | body-short | 封存（歷史版本／久遠內容，舊版保留查閱） |
| 57 | 活動報名：2021 年世界結核病日健走活動開放報名<br><sub>www.cdc.gov.tw/Bulletin/Detail/dDR5JeIC7EKd_Hpr3MO0g6?typeid=11</sub> | 新聞 → `news.2020-12-15-legacy-5b26a4` | — | 0.8 | pdf-no-text-layer、body-short | 不轉換（久遠且已結束，建議 410） |
| 58 | COVID-19 疫情說明記者會（第 60 場）<br><sub>www.cdc.gov.tw/Bulletin/Detail/ZViXszMLWodRbAerhbHVjx?typeid=9</sub> | 新聞 → `news.2020-04-01-legacy-ecfead` | — | 0.8 | pdf-no-text-layer、body-short | 封存（歷史版本／久遠內容，舊版保留查閱） |
| 59 | 登革熱疫情趨緩，疾管署感謝地方政府與民眾共同努力<br><sub>www.cdc.gov.tw/Bulletin/Detail/9A_rA2MYBsfgm7CTYrG_qI?typeid=9</sub> | 新聞 → `news.2019-11-20-legacy-07f31c` | — | 0.8 | pdf-no-text-layer、body-short | 封存（歷史版本／久遠內容，舊版保留查閱） |
| 60 | 新聞稿<br><sub>www.cdc.gov.tw/Bulletin/List/k6bmONJQYkScCR2X4MU1XB?typeid=9</sub> | 清單頁 → `page.x-8d05d9` | — | 0.6 | — | 清單頁，不轉換（新站由系統自動產生列表） |

## 需人工檢視（0 頁）

無。

## 併入疾病頁（0 頁）


## 二級抽樣檢視名單（近年新聞 auto-ok 4 頁，抽 10% ＝ 1 頁）

- 夏季出國旅遊前請先查疫情：疾管署更新國際旅遊疫情建議等級 → `news.2026-06-20-legacy-02b775`（www.cdc.gov.tw/Bulletin/Detail/Zg1sEf1_dN9UqgbyCyAdmD?typeid=9）

抽樣由網址雜湊排序決定，重跑不變；公關室看完名單沒有問題，整批 auto-ok 才改 `published` 開 PR（第 7 節二級）；發現率超過 10% 就暫停自動上線、回頭修規則。

## 附件與圖片需要處理的

- 活動報名：2021 年世界結核病日健走活動開放報名：PDF「2020-12-15-old.pdf」沒有文字層（掃描檔），上架前須附同名 .md／.docx 可及性版本，或重做有文字層的 PDF
- COVID-19 疫情說明記者會（第 60 場）：PDF「2020-04-01-old.pdf」沒有文字層（掃描檔），上架前須附同名 .md／.docx 可及性版本，或重做有文字層的 PDF
- 登革熱疫情趨緩，疾管署感謝地方政府與民眾共同努力：PDF「2019-11-20-old.pdf」沒有文字層（掃描檔），上架前須附同名 .md／.docx 可及性版本，或重做有文字層的 PDF

## 與移轉清單的差異

- 清單有、匯出沒有：無
- 匯出有、清單沒有：001-2026-09-30-system-maintenance、002-2026-09-29-ili-weekly、003-2026-09-28-parking-construction、004-2026-09-26-open-house、005-2026-09-24-synth、006-2026-09-22-enterovirus-alert、007-2026-09-21-flu-antiviral-revised、008-2026-09-18-flu-vaccine-oct1、009-2026-09-15-international-health-mou、010-2026-09-15-letter-616-ns1、011-2026-09-anti-epidemic-team-scam、012-2026-09-12-synth、013-2026-09-10-clarify-flu-vaccine-death、014-2026-09-flu-vaccine-causes-flu、015-2026-09-01-covid-weekly、016-2026-08-28-synth、017-2026-08-25-mpox-clade-i、018-2026-08-20-dots-outcomes、019-2026-08-18-dengue-rising-south、020-2026-08-17-international-fetp-workshop、021-2026-08-05-synth、022-2026-07-21-dengue-first-local、023-2026-07-10-synth、024-2026-07-01-letter-dengue-guidance-v17、025-2026-06-20-synth、026-2026-06-03-flu-antiviral-summer、027-2026-06-02-measles-travel-mmr-1966、028-2026-05-22-international-wha-technical-exchange、029-2026-05-mmr-all-adults、030-2026-05-11-japan-measles-level1、031-2026-04-enterovirus-only-kids、032-2026-04-14-enterovirus-rising、033-2026-03-24-world-tb-day-end-tb-2035、034-2026-03-covid-isolation-7-days、035-2026-03-15-letter-ev-guideline、036-2026-02-24-flu-declining、037-2026-01-20-lunar-new-year-flu、038-2026-01-vinegar-saltwater-flu、039-2025-12-01-world-aids-day、040-2025-11-11-letter-dengue-guidance-v16、041-2025-10-01-flu-vaccine-start、042-2025-08-05-chikungunya-guangdong、043-2025-07-15-clarify-dengue-spray、044-2025-07-dengue-spraying-poison、045-2025-06-10-mpox-summer、046-2025-05-06-enterovirus-season、047-2025-04-16-mmr-recommendation-revised、048-en-2025-04-16-mmr-recommendation-revised、049-2025-04-mmr-born-after-1981-only、050-2025-03-24-world-tb-day、051-en-2025-03-24-world-tb-day、052-2025-02-18-dengue-imported-spring、053-2025-01-09-mmr-adults-measles、054-2022-10-01-old、055-2022-03-24-old、056-2021-05-15-old、057-2020-12-15-old、058-2020-04-01-old、059-2019-11-20-old、060-news-list
- 與清單判定不同（不覆蓋，人工決定）：無
- 套用規則：只改 status／target／note，不動 verified；僅「待確認(pending)且新站已有對應內容」的項目才改 status（人工已判定的項目不被覆蓋，差異列在 conflicts）。

