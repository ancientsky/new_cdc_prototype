# 《疫情報導》重新設計：像 MMWR 一樣直接讀全文，也能下載 PDF（第二十九輪）

> 給出版單位（疫情中心）、資訊室與 OASIS。這份文件說明新站把《疫情報導》改成什麼樣、為什麼這樣改、上架流程怎麼變簡單、哪些是示範內容、正式上線前要補什麼。同事操作步驟在 [guide-staff.md §32](guide-staff.md#32-疫情報導文章怎麼上架第二十九輪)；程式契約在 ARCHITECTURE §34；決策理由在 architecture-decisions §21。

## 1. 現況與同事提出的問題

舊站的「疫情報導」頁（`/EpidemicTheme/Index/…`）是一個卷期清單：點進某一期看到篇名與摘要，全文要開整本 PDF。原型前幾輪照這個模型做了 `publication`（卷期＝一筆出版品，`articles[]` 是篇目清單），所以也只有「書目＋整本 PDF」。

同事反映兩件事：
1. **讀**：想像美國 CDC 的 MMWR（Morbidity and Mortality Weekly Report）一樣，點一篇就直接看全文 HTML，要 PDF 再下載。
2. **上架**：目前上架很麻煩。以舊模型來說，每加一篇要回頭改卷期 JSON 的 `articles[]`、對頁碼、調順序、再上傳整本 PDF；一期四篇就改同一個檔四次，最容易出錯的是頁碼與順序。

## 2. 我們向 MMWR 借了什麼、沒借什麼

MMWR 文章頁的幾個特徵（依公開的 MMWR 作者指引與網站版面整理；開發環境連不到 cdc.gov，未逐頁核對）：文章是閱讀單位；頁首是卷期、日期、作者與單位；正文前有 **summary box**（What is already known / What is added by this report / What are the implications for public health practice）；正文直接攤開，圖表就地編號；側欄有 PDF、引用格式、相關文章；每篇都有穩定網址與建議引用寫法。

| MMWR 的做法 | 新站怎麼做 | 為什麼 |
| --- | --- | --- |
| 一篇文章一個網址、全文 HTML | 新型別 `article`，網址 `/publications/{卷期}/{篇次}/`，`sections[]` 渲染成 HTML | 讀者、搜尋引擎、智慧查詢都能直接到「某篇的某一段」；PDF 變成另存，不是唯一入口 |
| summary box 三句話 | `highlights.known / added / implications`，文章頁「重點」框 | 讀者 30 秒內決定要不要往下讀；也是智慧查詢最好引用的一塊 |
| 摘要在正文之前 | `abstractMarkdown` → 頁首摘要框 | 同上 |
| 圖表編號、就地插入 | `figures[]`（圖或表、編號、說明、Markdown 表格或圖檔＋替代文字），放在正文第一次提到它的那段之後 | 表格直接是 HTML 表格：可搜尋、可朗讀、可複製；圖一定有文字版 |
| 建議引用格式 | 中、英兩種格式各一個複製鈕；`/v1/articles.json` 也帶 | 研究者與媒體引用時不必自己拼 |
| 整期目錄 | 卷期頁改成「本期目錄」：篇次、類型、頁碼、篇名、作者、摘要一句、全文與 PDF 鈕 | 一期的全貌一眼看完；舊式只有書目的篇目照舊列出並標「僅書目」 |
| 單篇 PDF | `pdfUrl`（單篇）→ 沒有時退回本期 PDF → 再沒有就提供「列印／另存 PDF」 | 不要求出版單位一定要拆 PDF；列印樣式是乾淨的文章版面，瀏覽器另存即可 |

**沒借的**：MMWR 的英文排版字型與欄寬（新站沿用自己的設計系統）；MMWR 的 Altmetric、社群分享（原型不接第三方）；MMWR 把每篇再轉成多種格式（RIS、BibTeX）——先給中英文引用字串，格式匯出可以之後加。

**為什麼不用第二十一輪的長文件收合版面**：那個版面是給上百頁的指引用的（章節卡＋每節收合）；期刊文章只有 4～6 段、一次讀完，收合反而多一次點擊。文章頁改用「正文攤開＋右側黏住的目錄」。

## 3. 資料模型：文章是一筆內容，卷期由文章組成

```
content/publications/bulletin-42-13.json   卷期（既有的 publication，pubType bulletin）
content/articles/teb-42-13-1.json          文章 1（type article，issueId 指向卷期，articleNo 1）
content/articles/teb-42-13-2.json          文章 2
content/assets/article.teb-42-13-1/x.pdf   單篇 PDF（選填）
```

- `article` 有完整的治理欄位（權責單位、審閱、AI 白名單、verification），所以每篇都能獨立複核、獨立標「待確認」、獨立進白名單。
- 卷期頁的目錄**在建置時**由 `issueId` 相同的文章算出來（`src/client/bulletin-rules.js` 的 `issueToc`）；卷期 JSON 裡舊的 `articles[]` 仍可用，沒被同篇次全文取代的篇目照舊列出。兩種模型並存，舊資料不必一次搬完。
- 建置閘門（`scripts/lib/validate.mjs`）擋：卷期不存在或不是 bulletin、同期篇次重複、頁碼與同期其他篇重疊、沒有正文、沒有作者。這些規則與後台共用同一份程式，所以後台說「通過」，CI 就一定通過。
- 文章同時進：智慧查詢索引（摘要、重點、每一段、每個圖表各一塊，引用連到 `#s-{key}`、`#table-1`）、Pagefind 全文搜尋、`/v1/articles.json`、出版品 RSS、sitemap、JSON-LD（`ScholarlyArticle` → `isPartOf` `PublicationIssue`）。

## 4. 上架流程怎麼變簡單

舊：承辦人要同時維護卷期 JSON 的篇目清單、頁碼、順序與整本 PDF。

新：`/admin/bulletin/edit/`，一篇一次。
1. 選卷期（或填卷、期、出刊日建新的一期；系統建議下一期號）。篇次自動帶「本期最大篇次＋1」。
2. 把整份稿件從 Word 貼進來，按「自動切段」。系統認得「摘要／前言／方法／結果／討論／結論／誌謝／參考文獻」（含「一、」「1.」「【】」等寫法），把「圖 1 …」「表 1 …」抽成圖表說明，參考文獻逐行去編號。切不出來的文字列在「放不進任何章節」讓人處理，**不猜**。
3. 核對作者（每行「姓名 | 單位 | *」）、頁碼、重點三句話、圖表內容；右側即時長出文章頁與本期目錄，點預覽區塊跳欄位（沿用第二十二輪的做法）。
4. 「檢核」頁籤全綠才能「產生上架包」：文章 JSON、（新卷期時）卷期 JSON、單篇 PDF。解壓到 repo 開 PR，走一般車道。
5. 前台文章頁頁尾「同事修改這頁」直接開回這個表單（`?edit=文章 id`），修改既有文章時表單沒有的欄位（languages、i18n…）原樣保留，PR 只多出真正改動的部分。

草稿自動存在這台電腦的瀏覽器（`cdc.admin.bulletin-edit`），Ctrl+S 立即存。

## 5. 示範內容與來源（請勿引用）

| 內容 | 來源 | 狀態 |
| --- | --- | --- |
| 卷期 42(2)，出刊日 2026-01-20，第 1 篇篇名「2024 年屏東縣某餐廳諾羅病毒食品中毒事件」 | 官網「疫情報導」列表頁的**搜尋摘要**（https://www.cdc.gov.tw/EpidemicTheme/Index/2EvDNIFfEWyH8RlHAp1t8g；開發環境連不到 cdc.gov.tw，未開啟原頁） | 卷期與篇名可對到官網；作者以單位代稱；內文、數字、圖表全是為了示範版面重寫的，`verification: pending` |
| 卷期 42(13) 第 1、2 篇（登革熱本土病例、EV-A71 監測） | 沿用前幾輪的示意卷期與篇名 | 全部虛構，`verification: pending` |
| 卷期 42(13) 第 3 篇 | 仍是舊式書目篇目 | 故意留著，示範「僅書目」並存 |
| 其他可查到的事實 | 電子報列表顯示 42(9) 出刊 2026-05-05、42(18) 出刊 2026-09-22；Airiti 期刊頁顯示系列自 1984-12-15 創刊、英文引用寫法 `Taiwan Epidemiol Bull` | 只在文件記錄，沒有寫進內容檔 |

ISSN `1680-5739` 是前幾輪的示意值，待出版單位確認。

## 6. 正式上線前要補的事（給疫情中心／資訊室）

1. **以真實文章取代示範**：每篇文章從後台重新上架（或請 OASIS 用 `scripts/pdf-to-md.mjs` 從單篇 PDF 轉出 `sections`），`verification` 改 `confirmed`。
2. **單篇 PDF**：出版單位若能提供單篇 PDF，放 `content/assets/article.{id}/`，文章頁的「下載 PDF」就變成單篇；提供不了也沒關係，退回本期 PDF 與列印版。
3. **歷年卷期**：舊站歷年各期可用舊站匯入批次（[legacy-import.md](legacy-import.md)）先建卷期與書目篇目，再逐篇補全文；不必一次補完。
4. **作者姓名**：示範用單位代稱；正式內容依刊載格式填真名與單位（出版品署名是公開資訊，不受個資遮罩規則限制）。
5. **引用格式**：目前中文格式是「作者。篇名。疫情報導 2026；42（13）：1-8。」，請出版單位確認期刊自己的規範，改 `src/client/bulletin-rules.js` 的 `citationOf` 一處即可。
6. **DOI**：若期刊有申請 DOI，填 `doi` 即會出現在頁首、引用與 JSON-LD。

## 7. 程式對照

| 檔案 | 用途 |
| --- | --- |
| `schemas/article.json` | 文章 schema |
| `src/client/bulletin-rules.js` | 網址、目錄組合、引用格式、稿件切段、檢核（建置與後台共用） |
| `src/templates/public/_bulletin.mjs`、`articles.mjs`、`publications.mjs` | 文章頁、卷期目錄頁 |
| `src/templates/admin/bulletin-edit.mjs`、`src/client/admin/bulletin-edit.js`、`bulletin-edit-core.js` | 上架後台（骨架、DOM、純函式） |
| `scripts/lib/{validate,index-builder,emit-api,emit-seo,jsonld,openapi}.mjs` | 閘門、索引、API、RSS／sitemap、JSON-LD、OpenAPI |
| `tests/round29-bulletin.test.mjs` | 12 項測試 |
