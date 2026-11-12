# 內容 HTML 與連結安全：白名單淨化、連結協定兩道防線

> 給誰看：資訊室（維護建置程式與部署設定的同仁）、內容編輯與各組 Steward、審內容 PR 的複核者。
> 來源：第七十三輪資安稽核（前端 F-1、F-2、F-5；CI 稽核 F5、F6）。程式在 `scripts/lib/markdown.mjs`（淨化）、`scripts/lib/render.mjs`（`safeHref`）、`schemas/*.json`（網址欄位 pattern）、`scripts/lib/assets.mjs`（SVG 掃描）；回歸測試在 `tests/round73-content-sanitizer.test.mjs` 與 `tests/assets.test.mjs`。
> 相關文件：[assets-policy.md](assets-policy.md)（檔案資產與 SVG 規則）、[deploy.md](deploy.md)（安全標頭怎麼下發）。

## 一句話

**內容裡的 Markdown 與原始 HTML，建置時一律只留下「白名單」上的標籤、屬性與連結協定，其餘全部拿掉；網址欄位再由 schema 與模板各擋一次。這三層都是建置期的檢查，瀏覽器端還要靠 CSP 標頭補最後一道，而 GitHub Pages 送不出這個標頭。**

## 1. 淨化器允許什麼

Markdown 經 `marked` 轉成 HTML 後，`md()`／`mdInline()` 會交給 [sanitize-html](https://www.npmjs.com/package/sanitize-html)（只在建置時於 Node 端執行，不會打包進瀏覽器、後台或 `vendor/`）依下表過濾。設定集中在 `scripts/lib/markdown.mjs` 的 `SANITIZE_OPTIONS`。

| 類別 | 允許 |
| --- | --- |
| 區塊 | `p` `h2`–`h6` `ul` `ol` `li` `dl` `dt` `dd` `blockquote` `pre` `code` `hr` `br` `figure` `figcaption` `details` `summary` `div` |
| 表格 | `table` `caption` `thead` `tbody` `tfoot` `tr` `th` `td` |
| 行內 | `a` `img` `strong` `em` `b` `i` `del` `s` `sup` `sub` `abbr` `mark` `small` `span` |
| 所有標籤共用屬性 | `class` `id` `lang` `dir` `title` |
| 個別屬性 | `a`：`href` `hreflang` `rel`；`img`：`src` `alt` `width` `height` `loading` `decoding`；`th`／`td`：`colspan` `rowspan` `align`（`th` 另有 `scope`）；`ol`：`start` `reversed` `type`；`details`：`open` |
| 連結協定（`href`、`src`、`cite`） | `http:` `https:` `mailto:` `tel:`、相對路徑（`/…`、`./…`、`#…`、`?…`），以及協定相對 `//host/…`（瀏覽器視同 http(s)） |

處理方式：

- **不在清單上的標籤**：拿掉標籤、保留裡面的文字（例：`<font>重要</font>` 變成「重要」）。
- **連內容一起丟掉的標籤**：`script` `style` `iframe` `frame` `object` `embed` `template` `svg` `math` `noscript` `textarea` `select` `option` `title` 等。
- **不在清單上的屬性**一律拿掉，包括所有 `on*=` 事件屬性、`style`、`srcdoc`、`xlink:href`、`target`。
- **不合格的連結**：`href` 整個屬性拿掉，留下沒有連結的文字（`<a>點我</a>`）。判斷前會先解 HTML 實體，所以 `jav&#x61;script:`、`java&#x09;script:` 一樣擋得住。
- 淨化之後才補圖片的 `alt`／`width`／`height`（檔案資產登錄）、`loading="lazy"`、`decoding="async"`、`<pre tabindex="0">` 與站台 basePath。這些是建置程式加的，不受白名單影響。
- 輸出格式維持 marked 原本的寫法（`&quot;`、`&#39;`、`<br>`、`<img …>`），所以改版前後整站 HTML 與 `.md` 機讀版**逐位元相同**（第七十三輪以 `diff -r` 驗證：只有建置時間戳、schema 檔與前端 JS 改變）。

被擋掉的寫法舉例（全部收錄在回歸測試）：未閉合的 `<iframe srcdoc>`、`<base href>`、`<meta http-equiv="refresh">`、`<form action=外部>`、`<link rel=stylesheet>`、未閉合的 `<object>`／`<embed>`、`<svg><script>`、`<details ontoggle>`、`<math>` 內的 `xlink:href`、`<img onerror>`、`data:` 連結與圖片、`vbscript:`、拆字的 `<scr<script>ipt>`。

## 2. 教訓：為什麼白名單勝過正則黑名單

第七十三輪之前的淨化器是三條正則：「移除成對的 script／style／iframe／object／embed」「移除 `on*=`」「把字面上的 `javascript:` 換成 `#`」。稽核實測可以繞過：

1. **實體編碼**：正則比對的是原始字串，`jav&#x61;script:` 不含字面上的 `javascript:`，但瀏覽器解析屬性時會先解實體，結果還是 `javascript:`。
2. **不閉合**：`<iframe srcdoc="…">` 沒有 `</iframe>`，「成對才移除」的正則就比對不到，瀏覽器卻會照樣建立 iframe。
3. **沒列到的標籤**：`<base>` 可以把整頁相對連結改指向外站，`<meta http-equiv="refresh">` 可以強制轉址釣魚，黑名單裡根本沒有它們。

黑名單要求我們事先想到**所有**危險寫法；HTML 的解析規則（實體、大小寫、空白與控制字元、容錯修補、命名空間）遠比正則能描述的複雜，總會漏。白名單反過來：用真正的 HTML 解析器把文件拆成標籤與屬性，**只放行我們確認安全且內容真的用得到的**，新出現的攻擊寫法預設就被擋掉。代價是內容想用新標籤時要先來改清單（見第 5 節），這是刻意的。

同樣的原則也套用在 SVG 檔案掃描（`scripts/lib/assets.mjs` 的 `svgProblems`）：第七十三輪補上 `<foreignObject>`（可內嵌整段 HTML）、`href`／`xlink:href` 指向外部網址或 `data:`（`<use>`、`<image>` 載入外部文件）、`<style>` 內的 `@import` 與外部 `url(…)`（`url(#漸層)` 這種文件內參照仍可用），比對 `javascript:` 前也會先解實體。SVG 掃描目前仍是「偵測已知危險」，因為圖檔一律以 `<img>` 引用、瀏覽器不會執行其中的腳本；若日後要把 SVG 直接內嵌進頁面，應改為白名單淨化。

## 3. 連結協定的兩道防線：schema pattern＋safeHref

除了 Markdown 內文，很多連結來自結構化欄位，例如疾病頁的 `materials[].url`、資料集的 `resources[].url`、新聞附件、職缺聯絡、服務的 `href`、專區連結。這些值不經過 Markdown，而是由模板直接寫進 `href="…"`。

| 防線 | 在哪裡 | 做什麼 | 擋不住時 |
| --- | --- | --- | --- |
| 第一道：schema | `schemas/*.json` 網址欄位的 `"pattern": "^(https?://\|mailto:\|tel:\|/)"`（圖片欄位為 `"^(https?://\|/)"`） | `npm run check`／建置時驗證失敗，PR 進不來 | 新增欄位忘了加 pattern、或內容不經 schema（例如程式組出的網址） |
| 第二道：模板 | `scripts/lib/render.mjs` 的 `safeHref()`；`` html`` `` 樣板會把**緊接在** `href="`、`src="`（以及 `action`、`formaction`、`poster`、`cite`）之後的字串插值自動交給它 | 先解 HTML 實體、去掉控制字元與零寬字元，協定不是 http(s)／mailto／tel 就輸出 `#` | 值用 `raw()` 包起來（代表作者明確表示「這是可信的」），或不是用 `` html`` `` 產生的字串 |

兩道是互補的：schema 讓錯誤**在送審時就被看見**（編輯會收到明確的錯誤訊息），模板層則保證就算漏網，頁面上也不會出現能執行的連結。答案引擎（`src/client/answer/render.js` 的 `link()`）在瀏覽器端也做同樣的協定檢查。後台的 HTML→Markdown 轉換（`src/client/admin/md-convert.js` 的 `safeUrl()`）是同一套規則的第三個實作，三處修改時要一起改。

給內容編輯：網址欄位請一律填完整的 `https://…`，或站內路徑 `/…`；寄信用 `mailto:`、電話用 `tel:`。其他寫法（包括 `www.` 開頭、沒有協定的網址）建置會拒絕。

給工程同仁：模板裡若真的需要輸出 `data:` 之類的協定（例如站台自己的 favicon），請用 `raw(esc(常數))` 明確標示，並在旁邊註明理由；**不要**把內容欄位包進 `raw()`。

## 4. 仍然仰賴 CSP 標頭的部分

建置期的淨化只能處理「我們產生的 HTML」。下列風險要靠瀏覽器端的 Content-Security-Policy（`scripts/lib/emit-headers.mjs` 產生，輸出在 `dist/headers/`：`_headers`、`nginx.conf`、`web.config.headers.xml`）兜底：

- 前端程式（`src/client/**`）在瀏覽器裡用 `innerHTML` 組畫面時若有遺漏，CSP 的 `script-src 'self'`（不允許 inline 與 `eval`）讓注入的腳本跑不起來。
- `object-src 'none'`、`base-uri 'self'`、`frame-src`（只允許地圖與 YouTube）、`form-action` 讓 `<object>`、`<base>`、外部 iframe、外送表單即使出現也無效。
- 第三方相依（marked、sanitize-html 本身）若有未知漏洞，CSP 是最後一道。

**GitHub Pages 不能送自訂 HTTP 標頭**，所以原型站實際上沒有 CSP。這就是第七十三輪把淨化改成白名單的原因：在沒有 CSP 的環境，建置期淨化是唯一的防線。正式站上線前必須確認：

1. 由反向代理、CDN 或主機設定把 `dist/headers/` 的標頭真的送出去（部署方式見 [deploy.md](deploy.md)），並以瀏覽器開發者工具或 `curl -I` 檢查回應裡有 `Content-Security-Policy`。
2. `<meta http-equiv="Content-Security-Policy">` 只能當備援：它不支援 `frame-ancestors`，也無法在頁面開始解析前生效，不能取代標頭。
3. 地圖 iframe 的 `sandbox` 在同源下無隔離效果（稽核 F-4），要等地圖移到專用子網域後才真正生效。

## 5. 要新增允許的標籤或屬性時

1. **先確認真的需要**：能用 Markdown 寫的就不要用 HTML；能用既有標籤加 `class` 的就不要加新標籤。
2. **評估風險**：會載入外部資源（`iframe`、`video`、`audio`、`source`、`picture` 的 `srcset`）、會執行腳本或改變頁面行為（`form`、`input`、`button`、`base`、`meta`、`link`、`style`、`svg`、`math`）、或能放網址的屬性，都需要資訊室同意；影音請改用既有的媒體內容型別（`media`），不要在內文嵌 iframe。
3. **改設定**：在 `scripts/lib/markdown.mjs` 的 `SANITIZE_OPTIONS` 把標籤加進 `allowedTags`，屬性加進 `allowedAttributes`（指定標籤，不要加到 `'*'`）。會放網址的新屬性要同時加進 `allowedSchemesAppliedToAttributes`；如果這個屬性也會由模板輸出，請一併加進 `scripts/lib/render.mjs` 的 `URL_ATTR_END`。
4. **補測試**：在 `tests/round73-content-sanitizer.test.mjs` 加一個「合法用法會留下」與一個「危險變體會被拿掉」的案例。
5. **驗證輸出**：改版前後各建置一次（`BASE_PATH='' DIST_DIR=/tmp/x/dist-before node scripts/build.mjs`，改完再建 `dist-after`），以 `diff -r` 比對 HTML 與 `.md`，確認只多了你預期的標籤。
6. **更新本文件**第 1 節的表格。

新增網址欄位時：schema 加上 `"pattern": "^(https?://|mailto:|tel:|/)"`（只放圖片的欄位用 `"^(https?://|/)"`），模板一律透過 `` html`` `` 輸出、不要包 `raw()`，並在測試補一筆 `javascript:` 會被 schema 擋下的案例。
