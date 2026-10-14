// /admin/due/ 審閱到期：已逾期／30 日內／90 日內／其他；依單位篩選。
// 第五十輪：有寫入閘道（npm run dev、正式後台）時，每列是真的「送出重新審閱」（due.js；核准後最後審閱日更新、回到 AI 引用範圍）；
// 沒有閘道（GitHub Pages 靜態示範站）時維持「標記已審閱（示範）」，並明說它只記在這台電腦、不會改變任何內容（guide-staff §50）。
import { html } from '../../../scripts/lib/render.mjs';
import { pageHead, adminMeta, catalogRows, unitOptions, TYPE_LABEL, daysText } from './_partials.mjs';
export { layout } from './_layout.mjs';

export function pages() { return [{ path: '/admin/due/', props: {}, noindex: true }]; }
export function meta() { return adminMeta('審閱到期', 'due', ['/assets/js/admin/due.js']); }

const GROUPS = [
  { key: 'overdue', title: '已逾期', tone: 'bad', test: (d) => d < 0, hint: '已自動退出 AI 白名單並顯示警示' },
  { key: 'd30', title: '30 日內到期', tone: 'warn', test: (d) => d >= 0 && d <= 30, hint: '建議本月內完成審閱' },
  { key: 'd90', title: '90 日內到期', tone: 'info', test: (d) => d > 30 && d <= 90, hint: '' },
  { key: 'other', title: '其他（90 日後）', tone: 'gray', test: (d) => d > 90, hint: '' },
];

export function render(ctx) {
  const { site, url } = ctx;
  const rows = catalogRows(site).filter((r) => r.status === 'published' && r.nextReviewAt && !r.superseded).sort((a, b) => a.daysToReview - b.daysToReview);
  const eventN = site.all.filter((i) => i.status === 'published' && !i.gov?.nextReviewAt).length;
  return html`
${pageHead({ title: '審閱到期', what: '依「最後審閱日 + 審閱週期」算出的到期清單，分為已逾期、30 日內、90 日內與其他。這裡是待辦，不是監控。', flow: '承辦人確認內容仍正確後按「送出重新審閱」（要改內容就到上架頁修改後送審），審核人核准後最後審閱日更新為核准當天；網站下次更新時，到期與警示自動消失，內容回到 AI 引用範圍。' })}
<div class="adm-box adm-box--warn" id="d-demo" data-gw-hide><strong>這裡是示範站，按鈕不會讓內容回到 AI 白名單</strong>「標記已審閱（示範）」只記在這台電腦的瀏覽器，不會改變內容的最後審閱日，同事與 AI 都看不到。真正的重新審閱要在後台服務上做：本機用 <code>npm run dev</code> 開啟（會自動啟動後台服務），正式環境用機關的後台網址；同一頁的按鈕會變成「送出重新審閱」，經審核人核准後才生效。步驟見同仁操作手冊 §50（docs/guide-staff.md）。</div>
<p class="adm-count-note" id="d-gw" role="status" aria-live="polite" hidden></p>
<div class="adm-box adm-box--note"><strong>逾期不需要人工處理前台</strong>逾期內容已自動退出 AI 白名單並在前台顯示警示，不需人工處理；此頁是待辦，不是監控。另有 ${eventN} 筆事件觸發型內容（如新聞稿，審閱週期 0）不會出現在這裡，它們由「所依據正本修訂」自動產生待辦。</div>
<section class="adm-card"><div class="adm-filters">
  <div class="adm-field"><label for="d-unit">單位</label><select id="d-unit">${unitOptions(site, { all: true, selected: 'all' })}</select></div>
  <div class="adm-field adm-field--grow"><label for="d-q">搜尋</label><input type="search" id="d-q" placeholder="標題或識別碼"></div>
  <span class="adm-count-note" id="d-note" aria-live="polite"></span></div>
  ${GROUPS.map((g) => {
    const list = rows.filter((r) => g.test(r.daysToReview));
    return html`<div data-group="${g.key}"><h3 class="adm-group-title"><span class="adm-badge adm-badge--${g.tone}">${g.title}</span><span class="adm-count" data-gcount>${list.length}</span><span class="adm-muted">${g.hint}</span></h3>
    <div class="adm-tablewrap" role="region" tabindex="0" aria-label="表格，可捲動"><table class="adm-table"><thead><tr><th scope="col">內容</th><th scope="col">權責單位</th><th scope="col">最後審閱</th><th scope="col">到期日</th><th scope="col">週期</th><th scope="col">動作</th></tr></thead><tbody>
    ${list.length ? list.map((r) => html`<tr data-id="${r.id}" data-type="${r.type}" data-owner="${r.owner}" data-reviewed="${r.reviewedAt}" data-q="${`${r.id} ${r.title}`.toLowerCase()}">
      <td><span class="adm-title">${r.front ? html`<a href="${url(r.front)}">${r.title}</a>` : r.title}</span><div class="adm-muted"><code>${r.id}</code> · ${TYPE_LABEL[r.type] ?? r.type}</div></td>
      <td>${r.ownerName}</td><td>${r.reviewedAt}</td>
      <td><span class="${g.key === 'overdue' ? 'adm-red' : g.key === 'd30' ? 'adm-yellow' : ''}">${r.nextReviewAt}</span><div class="adm-muted">${daysText(r.daysToReview)}</div></td>
      <td>${r.reviewPeriodMonths} 個月</td>
      <td data-act><button type="button" class="adm-btn adm-btn--ghost adm-btn--sm" data-mark="${r.id}">標記已審閱（示範）</button></td></tr>`) : html`<tr><td colspan="6" class="adm-empty">沒有項目</td></tr>`}
    </tbody></table></div></div>`;
  })}
</section>`;
}
