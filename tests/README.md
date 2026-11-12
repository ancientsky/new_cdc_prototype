# tests/ 測試檔對照

> 第七十一輪（2026-11-12）新增。`tests/` 目前有 108 個 `*.test.mjs`，其中 71 個以 `roundNN-` 開頭——檔名說的是「哪一輪寫的」，不是「測什麼」。這份對照表讓你從主題找到檔名。
> 每個檔只列一次，放在最主要的主題底下；跨主題的在「另見」註明。`roundNN-` 檔名後面寫的是該輪的主題（取自檔案第一行註解）。
> 子系統的規則在 ARCHITECTURE 哪一節、程式在哪，看 [ARCHITECTURE.md](../ARCHITECTURE.md) §0.5「現況地圖」。
> 全部跑：`npm test`；純內容 PR 只跑的子集：`npm run test:content`（清單在 `package.json`，說明見 docs/deploy.md §28）。

非測試檔：`helpers.mjs`（共用工具）、`pin-env.mjs`（`--import` 載入，固定環境變數）、`round6-fixtures.mjs`、`round7-fixtures.mjs`（假資料）、`fixtures/`。

## 治理與內容模型

| 檔名 | 測什麼 |
| --- | --- |
| `governance.test.mjs` | 治理規則 1–7 與規劃 7.4／7.5／7.7，每條至少一個測試 |
| `governance-r2.test.mjs` | 第二輪治理規則：公告截止、影音過時與逐字稿、專區到期、外部連結健康 |
| `units.test.mjs` | 單位主檔反映實際組織（預防接種屬急性傳染病組、署長室不上架等） |
| `sourcelang.test.mjs` | 內容來源語言 `sourceLang`（第六輪） |
| `round25-dates.test.mjs` | 第二十五輪：新聞稿相對日期規則（驗證警告／錯誤、答案單元加發布日） |
| `round33-consistency.test.mjs` | 第三十三輪：跨內容說法不一致、歷史新聞稿 |
| `round50-rereview.test.mjs` | 第五十輪：重新審閱（到期內容經確認後更新最後審閱日、回到白名單） |
| `round67-handover.test.mjs` | 第六十七輪：同事離職或調動時的交接、單位改組與裁撤（規則 30、31） |

## 舊站移轉

| 檔名 | 測什麼 |
| --- | --- |
| `migration.test.mjs` | 移轉清單 schema 與驗證、`gov.legacy`、待辦、redirects 與伺服器對照檔（第五輪） |
| `migration-scale.test.mjs` | 移轉清單規模化：主檔每種疾病推導一份、人工清單覆蓋同 key（第六輪） |
| `migration-ui.test.mjs` | 疾病頁專區導覽、舊網址揭露、`/legacy/`、404 自動轉址、後台移轉進度（第五輪） |
| `import-legacy.test.mjs` | 舊站匯出批次轉換：規則比對、HTML→草稿、附件宣告（第九輪） |

## 建置與輸出

| 檔名 | 測什麼 |
| --- | --- |
| `api.test.mjs` | `v1/*.json` 與 `openapi.json`：外殼、etag、必要檔案、redirects |
| `css-budget.test.mjs` | 第七十一輪：`components.css` 不超過 120 KB、斷點白名單、`font-size` 下限 13 px（有預算才會拆） |
| `emit-r2.test.mjs` | 第二輪輸出：新 API 端點、catalog、疾病 related、sitemap、feeds、llms.txt、JSON-LD |
| `jsonld.test.mjs` | JSON-LD 各型別、`cdc:` 擴充、麵包屑、SearchAction、資料集欄位 |
| `seo.test.mjs` | robots 三類 AI 爬蟲、sitemap 不含失效版、七語 llms.txt、feeds |
| `links.test.mjs` | 全站連結完整性、佔位網址政策、`/pending/`、404 模板 |
| `check-links.test.mjs` | `fetch-data.mjs --check-links` 外部連結檢查（注入 fetch，不連外） |
| `assets.test.mjs` | 檔案資產：宣告核對、`--fix-assets`、複製到 dist、內文圖片、治理待辦（第八輪） |
| `pdf-ingest.test.mjs` | PDF → 機讀版 → 頁碼切塊索引 → 引用標頁碼（第十九輪） |
| `round49-answer-slim.test.mjs` | 第四十九輪：答案引擎改讀 `v1/answer/*.json` 不含譯文的精簡副本 |

另見：`round26-i18n.test.mjs`（JS 預算）、`round34-engine-split.test.mjs`（建置時 JS 壓縮）、`round63-attack-surface.test.mjs`（產物白名單）。

## 答案引擎（智慧問答）

| 檔名 | 測什麼 |
| --- | --- |
| `answer.test.mjs` | 個資遮蔽、注入偵測、中文數字、同義詞展開、拒答、統計加總、謠言比對、失效版不被引用 |
| `round25-answer.test.mjs` | 第二十五輪：「查無」相關度門檻 |
| `round31-boundary.test.mjs` | 第三十一輪：詞典邊界（「性病」不再命中「急性病毒性A型肝炎」） |
| `round34-engine-split.test.mjs` | 第三十四輪：引擎拆檔、生成式模式用到才載入、建置時 JS 壓縮 |
| `round37-age-before.test.mjs` | 第三十七輪：「2 歲前要打哪些疫苗」年齡解析 |
| `round40-ask-perf.test.mjs` | 第四十輪：智慧問答頁手機效能（預篩、索引分片、引擎延後載入） |
| `round40-engine.test.mjs` | 第四十輪：服務意圖、逐字稿旁白、謠言原文不引用、最低資訊量、外語先對應主題 |
| `round40-injection-multilingual.test.mjs` | 第四十輪：印尼文「dan」不再被判成提示注入 |
| `round40-newparent-faq.test.mjs` | 第四十輪：新手爸媽 4 則 FAQ 答得到 |
| `round40-no-answer.test.mjs` | 第四十輪：查無或拒答時不掛「AI 整理」與模型標示 |
| `round40-presets.test.mjs` | 第四十輪：首頁與語言頁預設問句都答得出來 |
| `round41-ask-log.test.mjs` | 第四十一輪：智慧問答查詢紀錄 |
| `round41-synonyms.test.mjs` | 第四十一輪：民眾用語與官方用語的橋 |
| `round48-engine.test.mjs` | 第四十八輪：待確認標示、民眾說法、指名疫苗、連接詞句、外語退回中文 |
| `round49-challenge.test.mjs` | 第四十九輪：換句話說挑戰集與不擋建置的執行器 |
| `round49-engine.test.mjs` | 第四十九輪：回答分支用到才載入、四個答錯題 |
| `round49-pro-delta.test.mjs` | 第四十九輪：專業版索引差異分片 |
| `round50-engine.test.mjs` | 第五十輪：疾病頁用藥段落算數、申請服務開放民眾版 |
| `round52-engine.test.mjs` | 第五十二輪：依挑戰集失敗類型補換句話說能力 |
| `round53-engine.test.mjs` | 第五十三輪：依挑戰集失敗類型修引擎、屈公病與日本腦炎 |
| `round53-holdout2.test.mjs` | 第五十三輪：封存盲測題組 holdout v2 |
| `round65-ask-weakspots.test.mjs` | 第六十五輪：四個弱項（錯字、長輩說法、情境題、外語）的補法 |
| `round66-ask-when.test.mjs` | 第六十六輪：「什麼時候」是疑問詞 |

另見：`round48-ask-i18n.test.mjs`（答案頁多語）。

## 全文搜尋

| 檔名 | 測什麼 |
| --- | --- |
| `round28-search.test.mjs` | 第二十八輪：Pagefind 全文搜尋與進階篩選 |
| `round40-search-recall.test.mjs` | 第四十輪：頁面上確實有的詞必須搜得到 |
| `round51-search-bestbet.test.mjs` | 第五十一輪：全文搜尋的精選結果 |

## 多語

| 檔名 | 測什麼 |
| --- | --- |
| `round26-i18n.test.mjs` | 第二十六輪：介面字串依語言拆檔、JS 預算 |
| `round40-i18n.test.mjs` | 第四十輪：多語（issue #72、#73、#74、#76） |
| `round48-ask-i18n.test.mjs` | 第四十八輪：答案頁的多語字串、單位名稱、外部連結提示、疫情態勢卡 |
| `round49-i18n.test.mjs` | 第四十九輪：外語頁中文夾雜的結構性修正 |

另見：`sourcelang.test.mjs`（內容來源語言）、`round40-injection-multilingual.test.mjs`。

## 後台

| 檔名 | 測什麼 |
| --- | --- |
| `admin-editor.test.mjs` | 上架編輯器與附件、圖片面板（第八輪） |
| `admin-edit.test.mjs` | 修改已上架內容的純函式：API 一筆 → 表單 → 匯出 → 併回現行版（第十二輪） |
| `round18-ui.test.mjs` | 第十八輪：後台登入與角色規則、權責單位可點 |
| `round22-ui.test.mjs` | 第二十二輪：借 TinaCMS 的後台設計（即時預覽、群組摺疊、黏住的儲存列） |
| `round51-edit-preserve.test.mjs` | 第五十一輪：修改已上架內容以現行版為底、只改動過的欄位 |
| `round52-editors-preserve.test.mjs` | 第五十二輪：疫情報導、職缺、採購、接種時程編輯頁也以現行版為底 |

另見：`jobs-admin.test.mjs`、`tenders-admin.test.mjs`、`situation-card.test.mjs`（各專區的後台）。

## 寫入閘道與發布車道

| 檔名 | 測什麼 |
| --- | --- |
| `round30-gateway.test.mjs` | 第三十輪：寫入閘道（同事按按鈕，閘道代寫 Git） |
| `lanes.test.mjs` | 發布車道、排程發布、上線後複核待辦、CI 工作流程字串檢查（第九輪） |
| `admin-lanes.test.mjs` | 後台車道徽章、排程與緊急發布預檢、模擬送出時間軸（第九輪） |
| `round52-concurrent-edit.test.mjs` | 第五十二輪：同時修改不能悄悄蓋掉別人的修改（版本碼與 409） |
| `round53-editors-gateway.test.mjs` | 第五十三輪：職缺、採購、接種時程編輯頁接上寫入閘道 |
| `round54-decisions.test.mjs` | 第五十四輪：Yulun 對三個待決事項的決定（型別授權快車道、版本碼就緒檢查、兩則 Q&A 重審） |

另見：`round45-pdf-gateway.test.mjs`、`round52-bulletin-gateway.test.mjs`（疫情報導走閘道）、`intl-epidemic-api.test.mjs`（國際疫情匯入）、`round67-handover.test.mjs`（接手）。

## CI

| 檔名 | 測什麼 |
| --- | --- |
| `round40-ci-isolation.test.mjs` | 第四十輪：content-pr 拆 test／lane 兩個 job、格式與型別檢查進 CI；也檢查 `test:content` 清單 |
| `round60-ruleset.test.mjs` | 第六十輪：`main` 的規則集匯入檔 |

另見：`lanes.test.mjs`（工作流程字串檢查）。

## 資安與個資

| 檔名 | 測什麼 |
| --- | --- |
| `round23-security.test.mjs` | 第二十三輪：原型模式 noindex／橫幅、安全標頭產生器（CSP 雜湊）、快車道授權 |
| `round30-pii.test.mjs` | 第三十輪：個資不進 Git |
| `round60-security-txt.test.mjs` | 第六十輪：security.txt、`/about/official-site/` 與頁尾連結 |
| `round63-attack-surface.test.mjs` | 第六十三輪：部署產物白名單、內部站拆分、`ADMIN_ORIGIN`、指紋標頭 |
| `round63-rate-limit.test.mjs` | 第六十三輪：共用速率限制與四個後端的 429 |
| `round63-probes.test.mjs` | 第六十三輪：access log 的自動化探測偵測 |
| `pdf-split-perf.test.mjs` | 2026-10-21 資安檢查：特製 PDF 文字層讓切段變慢的模糊測試 |

## 無障礙、導覽與版面

| 檔名 | 測什麼 |
| --- | --- |
| `round24-a11y.test.mjs` | 第二十四輪：無障礙修正的結構斷言（真正的 axe 掃描在 `npm run a11y`） |
| `layout-shell.test.mjs` | 第七十一輪：兩個 skip link、原型橫幅凍結日期、預覽列預設隱藏、頁尾服務欄兩小組、無縮圖影音文字卡、儀表板凍結註記 |
| `round48-ui.test.mjs` | 第四十八輪：倒數由瀏覽器重算、窄螢幕與放大文字不橫向捲動、頁籤標題層級 |
| `round47-nav-panels.test.mjs` | 第四十七輪：主選單小型面板 |
| `round61-research-media.test.mjs` | 第六十一輪：「研究與媒體」身分入口 |
| `round6-ui.test.mjs` | 第六輪：國際合作入口、英文主選單與頁尾、16 個疾病頁無空區塊 |
| `round25-pages.test.mjs` | 第二十五輪：制度性頁面（法令規章、政府資訊公開、資安政策、著作權）與頁尾連結 |
| `longdoc.test.mjs` | 長文件分章摺疊閱讀版面（第二十一輪） |

## 各專區

### 疫情報導

| 檔名 | 測什麼 |
| --- | --- |
| `round29-bulletin.test.mjs` | 第二十九輪：文章型別、MMWR 式文章頁與卷期目錄、上架後台 |
| `round35-bulletin.test.mjs` | 第三十五輪：作者上標與通訊作者、DOI 與轉址、分類主檔、圖片上架 |
| `round45-pdf-gateway.test.mjs` | 第四十五輪：上傳 PDF 自動帶入、送審件帶附件與配套卷期 |
| `round46-pdf-parse.test.mjs` | 第四十六輪：真實 PDF 解析修正、依座標還原表格 |
| `round52-bulletin-gateway.test.mjs` | 第五十二輪：疫情報導編輯頁的版本檢查、分類主檔經閘道送審 |

### 疫苗與接種時程

| 檔名 | 測什麼 |
| --- | --- |
| `vaccine-schedule-ui.test.mjs` | 疫苗接種時程地圖：渲染、標記、頁籤、待確認徽章、`.md` 表格 |
| `round36-vaxschedule.test.mjs` | 第三十六輪：時程地圖共用渲染、下載 CSV、後台時程編輯、預防接種專區 |
| `round40-vaxschedule.test.mjs` | 第四十輪：「已過建議年齡」拆成應已完成與已超過上限、依費用分組 |

### 出國與入境、國際疫情

| 檔名 | 測什麼 |
| --- | --- |
| `travel.test.mjs` | 旅遊疫情建議等級：抓取聚合、等級標準化、`/travel/` 模板 |
| `travel-data.test.mjs` | 旅遊疫情資料契約：背景提醒分類、針對性等級、變化摘要、國家主檔 |
| `travel-map.test.mjs` | 世界地圖：預先產生的 110m 路徑與 inline SVG |
| `travel-ui.test.mjs` | 出國與入境模板：查目的地、近 30 天變化、等級表、目的地頁（第四輪） |
| `travel-alert-ui.test.mjs` | 每則國際重要疫情資訊頁、列表連結、feed（第四十三輪） |
| `intl-epidemic.test.mjs` | 國際重要疫情資訊自動上架：交換格式、CSV 轉換、單則與整批把關（第四十三輪） |
| `intl-epidemic-api.test.mjs` | 國際疫情推送端點與閘道手動匯入（第四十三輪） |

### 人才招募與採購公告

| 檔名 | 測什麼 |
| --- | --- |
| `jobs.test.mjs` | 人才招募（人事室）與採購公告（秘書室）型別與治理（第七輪） |
| `round7-ui.test.mjs` | 第七輪：職缺列表與倒數、詳情時間軸、模擬報名、採購公告頁 |
| `jobs-admin.test.mjs` | 人才招募後台上架與異動表單（第十六輪） |
| `tenders-admin.test.mjs` | 採購公告上架與異動（第十六輪） |

### 其他專區與內容

| 檔名 | 測什麼 |
| --- | --- |
| `situation-card.test.mjs` | 首頁疫情卡四種樣版、退回規則、疫情發布表單的選擇器與預覽 |
| `round28-antivenom.test.mjs` | 第二十八輪：抗蛇毒血清（一級緊急就醫內容） |
| `round28-curriculum.test.mjs` | 第二十八輪：傳染病核心教材示範匯入 |
| `round28-newsletter.test.mjs` | 第二十八輪：電子報訂閱（`/subscribe/`、RSS 目錄、LINE 待確認） |
| `round44-leadership.test.mjs` | 第四十四輪：署長、副署長簡介 |
| `round57-denguemap.test.mjs` | 第五十七輪：登革熱地圖整合 |
| `round60-theme.test.mjs` | 第六十輪：節慶主題是有日期的內容 |
| `round62-interactives.test.mjs` | 第六十二輪：彩蛋與互動模組是有開關、有權責、有檔期的內容（含第六十四輪兩個模組） |

## 命名規則（第七十一輪起）

1. **新測試檔以主題命名**，例如 `css-budget.test.mjs`、`footer-groups.test.mjs`，不要再用 `roundNN-` 開頭。
2. **輪次寫在檔頭第一行註解**，格式比照既有檔案：`// 第七十一輪（YYYY-MM-DD）：這個檔測什麼（相關文件與節號）。`
3. **既有檔名不改**。理由：`package.json` 的 `test:content` 清單（純內容 PR 只跑的子集）直接列檔名，`round40-ci-isolation.test.mjs` 會檢查清單內的檔案存在；`.prettierignore` 的放行清單、ARCHITECTURE、deploy.md、guide-staff 與各 docs 也有幾十處以檔名引用。改名的收益只是可找性，這份對照表已經補上。
4. **新增測試檔時，在本表對應主題加一行**；屬於新主題就加一節。若該檔要進 `test:content`，同時改 `package.json` 與 docs/deploy.md §28。
