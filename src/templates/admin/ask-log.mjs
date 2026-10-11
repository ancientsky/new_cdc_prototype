// /admin/ask-log/ 查詢紀錄報表（第四十一輪；說明見 docs/ask-log.md、同仁手冊第 42 節）。
//
// 這頁不在建置時放任何紀錄內容：民眾的問句不能進 Git，也不能進公開的 dist/。報表一律在瀏覽器執行時才取得——
//   開發伺服器（npm run dev）：讀 /api/dev/ask-log/report（只給本機連線）；
//   其他情況（GitHub Pages 原型站、正式站）：同仁用 npm run ask-log:report 或正式收件系統產生 report.json，在這頁「載入 report.json」開啟（只在瀏覽器記憶體，不上傳）。
import { html } from '../../../scripts/lib/render.mjs';
import { pageHead, adminMeta } from './_partials.mjs';
export { layout } from './_layout.mjs';

export function pages() {
  return [{ path: '/admin/ask-log/', props: {}, noindex: true }];
}
export function meta() {
  return adminMeta('查詢紀錄', 'ask-log', ['/assets/js/admin/ask-log.js'], '智慧問答哪些問題答不出來：查詢紀錄彙整報表與疑似同義詞候選');
}

export function render(ctx) {
  const { url } = ctx;
  return html` ${pageHead({
      title: '查詢紀錄：哪些問題答不出來',
      what: '彙整民眾在智慧問答（/ask/）問過的問題：哪些常被問卻查無或依據不足、哪些答了但相關度低、哪些最常被問。答不出來的問題附「疑似同義詞候選」，確認後可一鍵帶到詞彙主檔的新增表單。',
      flow: '前端只送出已遮蔽個資的問句與結果類型（不含 IP、cookie、使用者代號），收件系統再遮蔽一次、原始紀錄保存 90 天。報表只列出在 3 個不同日子出現或被問 3 次以上的問句（k-匿名），少見的問句只計數不顯示。',
    })}
    <div class="adm-box adm-box--info" role="note" id="al-source"><strong>報表來源</strong><span id="al-source-text">讀取中…</span></div>

    <section class="adm-card" aria-labelledby="al-load-h">
      <h2 id="al-load-h">載入報表</h2>
      <div class="adm-filters">
        <button type="button" class="adm-btn" id="al-reload">重新讀取開發伺服器報表</button>
        <div class="adm-field"><label for="al-file">或載入 report.json</label><input type="file" id="al-file" accept=".json,application/json" /></div>
        <div class="adm-field">
          <label for="al-min">門檻 K</label
          ><select id="al-min">
            <option value="">報表預設</option>
            <option value="2">2</option>
            <option value="3">3</option>
            <option value="5">5</option>
            <option value="10">10</option>
          </select>
        </div>
        <span class="adm-count-note" id="al-status" role="status" aria-live="polite"></span>
      </div>
      <p class="adm-hint">
        報表 JSON 由 <code>npm run ask-log:report</code> 產生在 <code>.local/ask-log/report.json</code>（正式環境由收件系統依 docs/ask-log.md
        的格式匯出）。載入的檔案只在這個分頁的記憶體裡，不會上傳。門檻 K 只對開發伺服器報表有效（檔案報表的門檻在產生時就決定了，這頁只能往上提高、不能降低）。
      </p>
    </section>

    <div class="adm-statrow" id="al-stats" hidden></div>

    <section class="adm-card" aria-labelledby="al-un-h">
      <h2 id="al-un-h">答不出來的問題 <span class="adm-muted">（查無／依據不足）</span></h2>
      <div class="adm-tablewrap" role="region" tabindex="0" aria-label="表格，可捲動">
        <table class="adm-table">
          <thead>
            <tr>
              <th scope="col">問句</th>
              <th scope="col">次數</th>
              <th scope="col">結果</th>
              <th scope="col">語言</th>
              <th scope="col">疑似同義詞候選</th>
              <th scope="col">處理</th>
            </tr>
          </thead>
          <tbody id="al-un"></tbody>
        </table>
      </div>
      <p class="adm-empty" id="al-un-empty">尚無資料。</p>
    </section>

    <section class="adm-card" aria-labelledby="al-low-h">
      <h2 id="al-low-h">答了但相關度低 <span class="adm-muted">（可能答非所問）</span></h2>
      <div class="adm-tablewrap" role="region" tabindex="0" aria-label="表格，可捲動">
        <table class="adm-table">
          <thead>
            <tr>
              <th scope="col">問句</th>
              <th scope="col">次數</th>
              <th scope="col">語言</th>
              <th scope="col">疑似同義詞候選</th>
              <th scope="col">處理</th>
            </tr>
          </thead>
          <tbody id="al-low"></tbody>
        </table>
      </div>
      <p class="adm-empty" id="al-low-empty">尚無資料。</p>
    </section>

    <section class="adm-card" aria-labelledby="al-ok-h">
      <h2 id="al-ok-h">最常被問、有答案的問題</h2>
      <div class="adm-tablewrap" role="region" tabindex="0" aria-label="表格，可捲動">
        <table class="adm-table">
          <thead>
            <tr>
              <th scope="col">問句</th>
              <th scope="col">次數</th>
              <th scope="col">語言</th>
              <th scope="col">最常引用的內容</th>
            </tr>
          </thead>
          <tbody id="al-ok"></tbody>
        </table>
      </div>
      <p class="adm-empty" id="al-ok-empty">尚無資料。</p>
    </section>

    <section class="adm-card" aria-labelledby="al-how-h">
      <h2 id="al-how-h">怎麼處理</h2>
      <ol>
        <li>
          候選看起來對（例：covid → 新冠併發重症／COVID-19）：按「加入詞彙主檔」，到
          <a href="${url('/admin/glossary/', { noLang: true })}">詞彙主檔</a> 的新增表單（已帶入正名與別名），確認後複製 JSON 開 PR。
        </li>
        <li>候選標「主檔已有」：詞已經在主檔，答不出來是內容不足或引擎規則問題，請轉資料治理幕僚（資訊室）看引擎與評估集。</li>
        <li>沒有候選：多半是網站沒有這方面的內容，或是不屬本署業務；由權責單位判斷要不要新增 FAQ。</li>
        <li>處理完請把這題加進評估集（<a href="${url('/admin/eval/', { noLang: true })}">評估</a>），避免日後退步。</li>
      </ol>
    </section>`;
}
