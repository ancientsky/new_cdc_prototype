// /admin/bulletin/edit/ 疫情報導文章上架（第二十九輪，ARCHITECTURE §34；同事 SOP 見 docs/guide-staff.md §32）。
// 以「一篇文章」為單位：選卷期（或新建）→ 貼稿件自動切段 → 核對作者、頁碼、圖表 → 右側即時預覽文章頁與本期目錄 → 檢核全過才匯出。
// 純函式在 src/client/admin/bulletin-edit-core.js；檢核與 CI 共用 src/client/bulletin-rules.js。這個模板只輸出靜態骨架與資料島。
import { html } from '../../../scripts/lib/render.mjs';
import { config } from '../../../site.config.mjs';
import { pageHead, adminMeta, dataScript, unitOptions } from './_partials.mjs';
import { sortCategories } from '../../client/bulletin-rules.js';
import { stripBuild } from '../../client/admin/bulletin-edit-core.js';
import { normalizeLimits } from '../../client/admin/preprocess.js';
export { layout } from './_layout.mjs';

export function pages() { return [{ path: '/admin/bulletin/edit/', props: {}, noindex: true }]; }
export function meta() { return adminMeta('疫情報導文章上架', 'bulletin', ['/assets/js/admin/bulletin-edit.js']); }

export function render(ctx) {
  const { site, url } = ctx;
  const issues = (site.collections.publications ?? []).filter((p) => p.pubType === 'bulletin').sort((a, b) => Number(b.volume) - Number(a.volume) || Number(b.issue) - Number(a.issue));
  const articles = (site.collections.articles ?? []).map(stripBuild);
  const LIM = normalizeLimits(config.assets);
  const data = {
    today: site.today, siteBase: config.basePath,
    issues: issues.map((p) => ({ id: p.id, title: p.title, volume: p.volume, issue: p.issue, publishedAt: p.publishedAt, pubType: p.pubType, series: p.series, issn: p.issn ?? null, pdfUrl: p.pdfUrl ?? null, articles: p.articles ?? [] })),
    articles, units: site.master.units.filter((u) => u.publishes !== false).map((u) => ({ id: u.id, name: u.name })),
    diseases: site.master.diseases.map((d) => ({ id: d.id, name: d.name })), categories: sortCategories(site.master.bulletinCategories), pdfMaxBytes: LIM.pdfBytes, imageMaxBytes: LIM.imageBytes ?? 2 * 1048576,
  };
  const field = (id, label, input, hint = '', wide = false) => html`<div class="adm-field${wide ? ' adm-field--wide' : ''}"><label for="${id}">${label}</label>${input}${hint ? html`<span class="adm-hint">${hint}</span>` : ''}</div>`;
  const text = (id, label, { hint = '', ph = '', wide = false } = {}) => field(id, label, html`<input type="text" id="${id}" placeholder="${ph}" autocomplete="off">`, hint, wide);
  const area = (id, label, { hint = '', ph = '', rows = 4, wide = true } = {}) => field(id, label, html`<textarea id="${id}" rows="${rows}" placeholder="${ph}"></textarea>`, hint, wide);
  return html`
${pageHead({
    title: '疫情報導文章上架',
    what: '一篇文章一次上架：把稿件整篇貼進來（Word 或 PDF 複製都可以），系統抓出篇名、作者與服務單位、DOI、投稿／接受日期、關鍵字，切出摘要、各段、圖表說明與參考文獻；把圖檔拖進來就依檔名配到圖一、圖二；核對作者註記、頁碼與圖表後匯出。右側一邊打一邊長出上線後的文章頁與本期目錄，點預覽任一區塊就跳到左側欄位。',
    flow: '貼稿件 → 拖圖 → 右側檢核全過 → 「產生上架包」（文章 JSON；新卷期多一個卷期 JSON；新分類多一個分類主檔；PDF 與圖檔放 content/assets/{文章 id}/）→ 開 Pull Request → CI 以同一份規則驗證 → 合併即上線：文章頁、卷期目錄、分類頁、搜尋索引、API、RSS、DOI 轉址同步更新。',
  })}
<div class="adm-box adm-box--note" role="note"><strong>為什麼不用改卷期的篇目清單了</strong>以前每加一篇都要回去改卷期 JSON 的 <code>articles[]</code>、補頁碼、調順序，一期四篇就改同一個檔四次。現在每篇文章自己有 <code>issueId</code> 與 <code>articleNo</code>，卷期頁的「本期目錄」是建置時算出來的；舊的只有書目清單的期數照常顯示，兩種並存。</div>
<div class="adm-split adm-te">
<section class="adm-card" aria-labelledby="te-h"><h2 id="te-h">文章表單</h2>
  <div class="adm-box adm-box--info" id="te-editbox" role="note" hidden></div>
  <form id="te-form" class="adm-form" novalidate autocomplete="off">
    <div class="adm-field"><label for="te-pick">要處理的文章</label><select id="te-pick"><option value="new">＋ 新增文章</option>${articles.filter((a) => a.status !== 'draft').map((a) => html`<option value="${a.id}">${a.title}（${issues.find((p) => p.id === a.issueId)?.title ?? a.issueId} 第 ${a.articleNo} 篇）</option>`)}</select>
      <span class="adm-hint">選既有文章＝帶入全部欄位修改（id 鎖定）；「新增文章」＝空白表單。前台文章頁頁尾的「同事修改這頁」會直接開到這裡。</span></div>

    <fieldset class="adm-fieldset adm-te-sec" id="te-a"><legend>A 所屬卷期與篇次</legend>
      <div class="adm-grid adm-grid--2">
        <div class="adm-field"><label for="te-issue">卷期</label><select id="te-issue"><option value="__new">＋ 建立新的一期</option>${issues.map((p) => html`<option value="${p.id}">${p.title}（${p.publishedAt}）</option>`)}</select><span class="adm-hint" id="te-issue-hint"></span></div>
        <div class="adm-field"><label for="te-no">本期第幾篇（articleNo）</label><input type="number" id="te-no" min="1" step="1" inputmode="numeric"><span class="adm-hint">自動帶本期最大篇次＋1；同期不可重複，決定目錄順序與網址。</span></div>
      </div>
      <div class="adm-grid adm-grid--3" id="te-newissue" hidden>
        ${field('te-vol', '卷', html`<input type="number" id="te-vol" min="1" step="1" inputmode="numeric">`)}
        ${field('te-iss', '期', html`<input type="number" id="te-iss" min="1" step="1" inputmode="numeric">`)}
        ${field('te-date', '出刊日', html`<input type="date" id="te-date">`, '填未來日期＝到那天才上線。')}
      </div>
      <div class="adm-grid adm-grid--2">
        ${field('te-type', '文章分類', html`<select id="te-type"></select>`, '與官網左側分類一致（原著文章、疫情調查、焦點特寫…）；要加新分類到 H 區。')}
        ${text('te-pages', '本期頁碼', { ph: '例：1-8', hint: '與同期其他篇重疊會擋下；排版定稿前可留空。' })}
      </div>
    </fieldset>

    <fieldset class="adm-fieldset adm-te-sec" id="te-b"><legend>B 篇名與作者</legend>
      ${text('te-title', '篇名（中文）', { ph: '例：2026 年首例本土登革熱病例疫情調查與社區防治', wide: true })}
      ${text('te-titleen', '篇名（英文，選填）', { ph: 'Investigation of …', wide: true })}
      ${area('te-authors', '作者（每行「姓名 | 單位編號 | * | E-mail | 英文姓名」）', { rows: 4, ph: '李泱 | 1 | * | leon75@cdc.gov.tw | Yang Li\n戴詩縈 | 1 | | | Shih-Yin Tai\n林稜 | 2 | | | Leng Lin', hint: '第二欄填服務單位編號（多個用逗號：1,2），文章頁會印成上標 李泱¹*；只有一個單位時也可以直接填單位名稱。* 表示通訊作者（頁尾印「*通訊作者：姓名（E-mail）」）。稿件貼進 C 區自動切段時，這兩欄會從作者列與頁尾註記抓出來。' })}
      ${area('te-affils', '作者服務單位（每行「編號 | 中文名稱 | 英文名稱」）', { rows: 3, ph: '1 | 衛生福利部疾病管制署北區管制中心 | Northern Regional Center, Taiwan CDC\n2 | 衛生福利部疾病管制署急性傳染病組', hint: '文章頁作者列底下的單位清單；編號對應上面作者的第二欄。' })}
      <div class="adm-grid adm-grid--2">
        ${field('te-owner', '權責單位（治理用）', html`<select id="te-owner">${unitOptions(site, { all: false, selected: 'unit.epidemic-intelligence' })}</select>`, '負責複核與事件觸發審閱的署內單位。')}
        <div class="adm-field"><label for="te-doi">DOI</label><div class="adm-inline"><input type="text" id="te-doi" placeholder="10.6524/EB.202610_42(19).0001" autocomplete="off"><button type="button" class="adm-btn adm-btn--ghost adm-btn--sm" id="te-doi-suggest">建議 DOI</button></div><span class="adm-hint" id="te-doi-hint"></span></div>
      </div>
      <div class="adm-grid adm-grid--3">
        ${field('te-received', '投稿日期', html`<input type="date" id="te-received">`)}
        ${field('te-accepted', '接受日期', html`<input type="date" id="te-accepted">`)}
        ${text('te-legacydoi', 'DOI 目前登記的落地網址（舊站文章頁，移轉用）', { ph: 'https://www.cdc.gov.tw/EpidemicTheme/…', hint: '有填就會進 301 對照與 /v1/doi.json，供登錄機構批次更新。' })}
      </div>
      <div class="adm-field adm-field--wide"><label for="te-dis-q">相關傳染病（搜尋主檔）</label><input type="search" id="te-dis-q" role="combobox" aria-expanded="false" aria-controls="te-dis-list" aria-autocomplete="list" placeholder="輸入疾病名稱，例：登革熱"><ul class="adm-search-results" id="te-dis-list" role="listbox" hidden></ul><ul class="adm-chips" id="te-dis-chips" aria-label="已選傳染病"></ul><span class="adm-hint">讓文章出現在疾病頁的「相關出版品」，也讓智慧查詢對得到。</span></div>
      <div class="adm-grid adm-grid--2">
        ${text('te-keywords', '關鍵字（以「、」分隔）', { ph: '登革熱、本土病例、疫情調查' })}
        ${text('te-keywordsen', '英文關鍵字（逗號分隔）', { ph: 'Dengue, Outbreak investigation' })}
      </div>
      ${area('te-summary', '摘要一句（目錄列與搜尋結果用，≤ 160 字）', { rows: 2, hint: '留空＝自動取摘要第一句。' })}
    </fieldset>

    <fieldset class="adm-fieldset adm-te-sec" id="te-c"><legend>C 稿件：整篇貼進來，系統切段</legend>
      ${area('te-manuscript', '稿件全文（從 Word 或 PDF 全選複製貼上）', { rows: 8, wide: true, ph: '2026 年 10 月 6 日 第 42 卷 第 19 期\n疫情調查\n篇名\n作者甲 1*、作者乙 2\n\n摘要\n…\n關鍵字：…\n\n事件源起\n…\n\n圖一、○○○時序圖\n\n討論及建議\n…\n\n參考文獻\n1. …\n\n1 單位甲\n2 單位乙\n通訊作者：作者甲　E-mail：…\n投稿日期：…　接受日期：…\nDOI：10.6524/…', hint: '系統會抓：頁首的卷期與出刊日、分類標籤、篇名、作者列（姓名＋上標編號＋*）、頁尾的服務單位、通訊作者與 E-mail、投稿／接受日期、DOI、關鍵字；切出摘要、各段（認得「事件源起、背景、個案報告、疫情調查、檢驗結果、疫情研判、討論及建議」等疫情調查報告的段名，不認得但看起來像標題的會列出請你核對）、「圖一」「表 1」圖表說明、參考文獻（折行自動併回）、英文篇名與摘要。從 PDF 複製時夾帶的頁首頁尾會自動剔除。只填還沒填的欄位，不會蓋掉你已經改過的內容。' })}
      <p class="adm-actions"><button type="button" class="adm-btn" id="te-split">自動切段</button><button type="button" class="adm-btn adm-btn--ghost" id="te-clear-ms">清空稿件欄</button><span class="adm-muted" id="te-split-msg" role="status" aria-live="polite"></span></p>
      <div id="te-unassigned" class="adm-box adm-box--warn" role="status" hidden></div>
    </fieldset>

    <fieldset class="adm-fieldset adm-te-sec" id="te-d"><legend>D 摘要與重點</legend>
      ${area('te-abstract', '摘要', { rows: 5, hint: '文章頁頂端的摘要框；智慧查詢優先引用這一塊。' })}
      ${area('te-abstracten', '英文摘要（選填）', { rows: 3, hint: '英文版文章頁與英文摘要頁用。' })}
      <div class="adm-te-hl" role="group" aria-labelledby="te-hl-l"><p class="adm-label" id="te-hl-l">重點三句話（仿 MMWR summary box，每句一兩行）</p>
        ${area('te-known', '已知', { rows: 2, hint: '這個主題以前就知道什麼。' })}
        ${area('te-added', '本文新增', { rows: 2, hint: '這篇多告訴讀者什麼。' })}
        ${area('te-implications', '對防疫實務的意義', { rows: 2, hint: '衛生單位、醫療院所或民眾該怎麼做。' })}
      </div>
    </fieldset>

    <fieldset class="adm-fieldset adm-te-sec" id="te-e"><legend>E 正文段落</legend>
      <p class="adm-hint">每段一個標題（前言、材料與方法、結果、討論、結論…），內文用 Markdown（### 可做小標、表格直接貼 Markdown 表格）。順序就是文章頁的順序。</p>
      <div id="te-sections" class="adm-te-rows"></div>
      <p><button type="button" class="adm-btn adm-btn--ghost adm-btn--sm" id="te-sec-add">＋ 加一段</button></p>
    </fieldset>

    <fieldset class="adm-fieldset adm-te-sec" id="te-f"><legend>F 圖表</legend>
      <p class="adm-hint">每個圖或表要有編號與說明；表格把內容貼成 Markdown 表格（文章頁直接是 HTML 表格，可搜尋、可朗讀）。圖：<strong>把圖檔拖到這個區塊</strong>（或用下面的選檔），檔名有「圖1」「fig-2」就配到對應的圖，認不出的依序補到還沒有圖檔的圖；系統會改成標準檔名（fig-1.png）、算 sha256 與寬高、宣告進 assets[]，並連同 JSON 打進上架包。最省事的做法：從 Word 或 PDF 把圖另存成 PNG（或截圖），檔名取「圖1.png」「圖2.png」，一次全選拖進來。系統會把圖表放在正文第一次提到它的那一段後面（「圖一」「圖 1」都認得）。</p>
      <div class="adm-field adm-field--wide"><label for="te-figfiles">圖檔（可多選；png／jpg／webp／svg）</label><input type="file" id="te-figfiles" multiple accept=".png,.jpg,.jpeg,.webp,.svg,image/*"><span class="adm-hint" id="te-figfiles-msg" role="status" aria-live="polite"></span></div>
      <div id="te-figures" class="adm-te-rows"></div>
      <p><button type="button" class="adm-btn adm-btn--ghost adm-btn--sm" id="te-fig-add">＋ 加一個圖</button> <button type="button" class="adm-btn adm-btn--ghost adm-btn--sm" id="te-tab-add">＋ 加一個表</button></p>
    </fieldset>

    <fieldset class="adm-fieldset adm-te-sec" id="te-g"><legend>G 參考文獻、誌謝、PDF</legend>
      ${area('te-refs', '參考文獻（每行一筆，不用編號）', { rows: 4 })}
      ${area('te-ack', '誌謝（選填）', { rows: 2 })}
      <div class="adm-grid adm-grid--2">
        <div class="adm-field"><label for="te-pdf">單篇 PDF（選填）</label><input type="file" id="te-pdf" accept=".pdf,application/pdf"><span class="adm-hint" id="te-pdf-hint">只在你的瀏覽器記憶體；按「產生上架包」才會連同 JSON 打包。沒有單篇 PDF 時文章頁提供本期 PDF 與列印版。</span></div>
        ${text('te-pdfurl', '或填 PDF 網址', { ph: 'https://… 或 /files/…' })}
      </div>
      ${text('te-note', '備註（給同事看，前台不顯示）', { wide: true })}
    </fieldset>

    <fieldset class="adm-fieldset adm-te-sec" id="te-hcats"><legend>H 文章分類管理</legend>
      <p class="adm-hint">分類清單存在 <code>content/master/bulletin-categories.json</code>，前台的《疫情報導》總覽與分類列表頁、目錄的分類膠囊、API 都讀這個檔。在這裡加一個分類，上架包就會多一份改好的主檔，合併後前台自動多一個分類頁；代號（網址用）由英文名產生，建立後不要改。已上架的分類不能刪，只能「停用」（舊文章照常顯示，新文章不可選）。</p>
      <div class="adm-tablewrap" role="region" tabindex="0" aria-label="分類表格，可捲動"><table class="adm-table adm-te-cats"><thead><tr><th scope="col">中文名稱</th><th scope="col">英文名稱</th><th scope="col">代號</th><th scope="col">順序</th><th scope="col">篇數</th><th scope="col"><span class="adm-sr-only">動作</span></th></tr></thead><tbody id="te-cats"></tbody></table></div>
      <div class="adm-inline"><input type="text" id="te-cat-new" class="adm-input" placeholder="新分類中文名稱，例：檢驗專欄" aria-label="新分類中文名稱"><input type="text" id="te-cat-new-en" class="adm-input" placeholder="英文名稱，例：Laboratory Column" aria-label="新分類英文名稱"><button type="button" class="adm-btn adm-btn--ghost adm-btn--sm" id="te-cat-add">＋ 新增分類</button></div>
      <p class="adm-muted" id="te-cat-msg" role="status" aria-live="polite"></p>
      <div class="adm-box adm-box--info" id="te-cats-changed" role="note" hidden>分類主檔有改動：上架包會多一個 <code>content/master/bulletin-categories.json</code>。</div>
    </fieldset>

    <div class="adm-actions adm-actions--sticky" id="te-actions">
      <button type="button" class="adm-btn" id="te-zip">產生上架包</button>
      <button type="button" class="adm-btn adm-btn--ghost" id="te-dl">下載 JSON</button>
      <button type="button" class="adm-btn adm-btn--ghost" id="te-copy">複製 JSON</button>
      <button type="button" class="adm-btn adm-btn--ghost" id="te-save" title="Ctrl+S">儲存草稿</button>
      <button type="button" class="adm-btn adm-btn--ghost" id="te-sample">載入範例</button>
      <button type="button" class="adm-btn adm-btn--ghost" id="te-reset">清空表單</button>
      <span class="adm-actions__spacer"></span>
      <span class="adm-savestate" id="te-savestate" aria-live="polite"><span class="adm-savestate__dot" aria-hidden="true"></span><span id="te-savestate-text">草稿會自動存在這台電腦</span></span>
    </div>
    <p class="adm-muted" id="te-msg" role="status" aria-live="polite"></p>
  </form>
</section>

<section class="adm-result adm-result--sticky" aria-label="右側面板：預覽與檢核">
  <div class="adm-tabs adm-tabs--pane" role="tablist" aria-label="右側面板">
    <button type="button" role="tab" id="tt-prev" aria-controls="tp-prev" aria-selected="true">文章頁預覽</button>
    <button type="button" role="tab" id="tt-toc" aria-controls="tp-toc" aria-selected="false" tabindex="-1">本期目錄</button>
    <button type="button" role="tab" id="tt-check" aria-controls="tp-check" aria-selected="false" tabindex="-1">檢核 <span class="adm-tabbadge" id="tt-check-badge" hidden></span></button>
    <button type="button" role="tab" id="tt-json" aria-controls="tp-json" aria-selected="false" tabindex="-1">JSON</button>
  </div>
  <div role="tabpanel" id="tp-prev" aria-labelledby="tt-prev" class="adm-result__body adm-result__body--pv">
    <p class="adm-hint adm-pv__help">上線後文章頁的即時預覽。<strong>點預覽裡任一區塊，就跳到左側對應欄位</strong>；游標在哪個欄位，對應區塊會亮起。只是示意版面，正式樣式以建置結果為準。</p>
    <div id="te-preview" tabindex="-1" aria-live="off"></div>
  </div>
  <div role="tabpanel" id="tp-toc" aria-labelledby="tt-toc" class="adm-result__body" hidden>
    <p class="adm-hint">這一期上線後的「本期目錄」：你的這篇會依篇次插進去（粗體）。「僅書目」是舊式只有篇目清單的篇目。</p>
    <div id="te-toc"></div>
  </div>
  <div role="tabpanel" id="tp-check" aria-labelledby="tt-check" class="adm-result__body" hidden>
    <div id="te-check"></div>
  </div>
  <div role="tabpanel" id="tp-json" aria-labelledby="tt-json" class="adm-result__body" hidden>
    <p class="adm-hint">檔名：<code id="te-file"></code><span id="te-file2"></span></p>
    <pre class="adm-pre" id="te-out" tabindex="0" aria-label="匯出 JSON"></pre>
  </div>
</section>
</div>
${dataScript('adm-bulletin-data', data)}
<script src="${url('/vendor/marked.min.js', { noLang: true })}" defer></script>`;
}
