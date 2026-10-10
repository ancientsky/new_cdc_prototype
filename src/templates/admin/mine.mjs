// /admin/mine/ 我的內容：依示範身分（單位）列出該單位內容、生命週期與白名單狀態
import { html } from '../../../scripts/lib/render.mjs';
import { pageHead, adminMeta, catalogRows, lifecycleBadges, wlCell, TYPE_LABEL, STATUS_LABEL, daysText } from './_partials.mjs';
export { layout } from './_layout.mjs';

export function pages() { return [{ path: '/admin/mine/', props: {}, noindex: true }]; }
export function meta() { return adminMeta('我的內容', 'mine', ['/assets/js/admin/mine.js']); }

export function render(ctx) {
  const { site, url } = ctx;
  const rows = catalogRows(site).sort((a, b) => (a.daysToReview ?? 99999) - (b.daysToReview ?? 99999));
  return html`
${pageHead({ title: '我的內容', what: '右上切換單位後，這裡列出該單位承辦的全部內容：生命週期（草稿／複核中／已發布／逾期／已失效）、下次審閱日與 AI 白名單狀態。有紅黃標籤的就是需要你處理的。', flow: '內容檔 content/*.json 的 owner 欄位 → 治理引擎算出 item.gov → 本頁；修改內容走 Pull Request，不在後台直接改。' })}
<section class="adm-card" id="mine-local" aria-labelledby="ml-h" hidden><h2 id="ml-h">我的草稿與已送複核（本機）</h2><ul id="mine-local-list" class="adm-kv"></ul></section>
<section class="adm-card" aria-labelledby="m-h"><h2 id="m-h">單位內容 <span class="adm-muted" id="mine-unit"></span></h2>
  <div class="adm-filters">
    <div class="adm-field adm-field--grow"><label for="m-q">搜尋（標題或識別碼）</label><input type="search" id="m-q"></div>
    <div class="adm-field"><label for="m-status">狀態</label><select id="m-status"><option value="">全部</option>${Object.entries(STATUS_LABEL).map(([k, v]) => html`<option value="${k}">${v}</option>`)}<option value="attn">需處理（逾期／失效／依據已修訂／稽核）</option></select></div>
    <span class="adm-count-note" id="m-count" aria-live="polite"></span>
  </div>
  <div class="adm-tablewrap" role="region" tabindex="0" aria-label="表格，可捲動"><table class="adm-table" id="m-table"><thead><tr><th scope="col">識別碼</th><th scope="col">型別</th><th scope="col">標題</th><th scope="col">生命週期</th><th scope="col">下次審閱</th><th scope="col">AI 白名單</th></tr></thead>
  <tbody>${rows.map((r) => html`<tr data-owner="${r.owner}" data-status="${r.status}" data-attn="${r.overdue || r.superseded || r.stale || r.audit ? 1 : 0}" data-q="${`${r.id} ${r.title}`.toLowerCase()}">
    <td><code>${r.id}</code></td><td>${TYPE_LABEL[r.type] ?? r.type}</td>
    <td>${r.front ? html`<a href="${url(r.front)}">${r.title}</a>` : r.title}</td>
    <td>${lifecycleBadges(r)}</td>
    <td>${r.nextReviewAt ? html`${r.nextReviewAt}<div class="${r.overdue ? 'adm-red' : r.daysToReview != null && r.daysToReview <= 30 ? 'adm-yellow' : 'adm-muted'}">${daysText(r.daysToReview)}</div>` : html`<span class="adm-muted">事件觸發</span>`}</td>
    <td>${wlCell(r)}</td></tr>`)}</tbody></table></div>
  <p class="adm-empty" id="m-empty" hidden>此單位目前沒有符合條件的內容。</p>
</section>`;
}
