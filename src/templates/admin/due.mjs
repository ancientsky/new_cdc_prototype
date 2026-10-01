// /admin/due/ 審閱到期：已逾期／30 日內／90 日內／其他；依單位篩選；標記已審閱（示範）
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
${pageHead({ title: '審閱到期', what: '依「最後審閱日 + 審閱週期」算出的到期清單，分為已逾期、30 日內、90 日內與其他。這裡是待辦，不是監控。', flow: '承辦人審閱內容後，在內容檔更新 reviewedAt 欄位並開 PR；合併後建置重算，到期與警示自動消失。' })}
<div class="adm-box adm-box--note"><strong>逾期不需要人工處理前台</strong>逾期內容已自動退出 AI 白名單並在前台顯示警示，不需人工處理；此頁是待辦，不是監控。另有 ${eventN} 筆事件觸發型內容（如新聞稿，審閱週期 0）不會出現在這裡，它們由「所依據正本修訂」自動產生待辦。</div>
<section class="adm-card"><div class="adm-filters">
  <div class="adm-field"><label for="d-unit">單位</label><select id="d-unit">${unitOptions(site, { all: true, selected: 'all' })}</select></div>
  <div class="adm-field adm-field--grow"><label for="d-q">搜尋</label><input type="search" id="d-q" placeholder="標題或識別碼"></div>
  <span class="adm-count-note" id="d-note" aria-live="polite"></span></div>
  ${GROUPS.map((g) => {
    const list = rows.filter((r) => g.test(r.daysToReview));
    return html`<div data-group="${g.key}"><h3 class="adm-group-title"><span class="adm-badge adm-badge--${g.tone}">${g.title}</span><span class="adm-count" data-gcount>${list.length}</span><span class="adm-muted">${g.hint}</span></h3>
    <div class="adm-tablewrap"><table class="adm-table"><thead><tr><th scope="col">內容</th><th scope="col">權責單位</th><th scope="col">最後審閱</th><th scope="col">到期日</th><th scope="col">週期</th><th scope="col">動作</th></tr></thead><tbody>
    ${list.length ? list.map((r) => html`<tr data-id="${r.id}" data-owner="${r.owner}" data-q="${`${r.id} ${r.title}`.toLowerCase()}">
      <td><span class="adm-title">${r.front ? html`<a href="${url(r.front)}">${r.title}</a>` : r.title}</span><div class="adm-muted"><code>${r.id}</code> · ${TYPE_LABEL[r.type] ?? r.type}</div></td>
      <td>${r.ownerName}</td><td>${r.reviewedAt}</td>
      <td><span class="${g.key === 'overdue' ? 'adm-red' : g.key === 'd30' ? 'adm-yellow' : ''}">${r.nextReviewAt}</span><div class="adm-muted">${daysText(r.daysToReview)}</div></td>
      <td>${r.reviewPeriodMonths} 個月</td>
      <td data-act><button type="button" class="adm-btn adm-btn--ghost adm-btn--sm" data-mark="${r.id}">標記已審閱（示範）</button></td></tr>`) : html`<tr><td colspan="6" class="adm-empty">沒有項目</td></tr>`}
    </tbody></table></div></div>`;
  })}
</section>`;
}
