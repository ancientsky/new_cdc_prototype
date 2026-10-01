// /admin/review/ 複核區：示範佇列（status=review 的內容＋本機送複核的草稿）
import { html } from '../../../scripts/lib/render.mjs';
import { pageHead, dataScript, adminMeta, catalogRows } from './_partials.mjs';
export { layout } from './_layout.mjs';

export function pages() { return [{ path: '/admin/review/', props: {}, noindex: true }]; }
export function meta() { return adminMeta('複核區', 'review', ['/assets/js/admin/review.js']); }

export function render(ctx) {
  const { site } = ctx;
  const items = catalogRows(site).filter((r) => r.status === 'review').map(({ id, type, title, owner, ownerName, languages, front }) => ({ id, type, title, owner, ownerName, languages, front }));
  const data = { items, today: site.today, demo: [
    { id: 'demo.faq-chikungunya-when-to-see-doctor', type: 'faq', title: '屈公病出現關節痛要不要就醫？（示意）', owner: 'unit.acute-infectious', ownerName: '急性傳染病組', languages: { 'zh-TW': 'source', en: 'pending', ja: 'pending', tl: 'pending', vi: 'pending', id: 'pending', th: 'pending' }, step: 2, demo: true },
    { id: 'demo.news-enterovirus-update', type: 'news', title: '腸病毒疫情提醒新聞稿（示意）', owner: 'unit.pr', ownerName: '公關室', languages: { 'zh-TW': 'source', en: 'machine' }, step: 3, demo: true },
  ] };
  return html`
${pageHead({ title: '複核區', what: '送出預處理的內容在這裡排隊走四步：承辦人確認 → 公關室內容審核 → 多語審核 → 發布。每筆顯示目前步驟與各語言狀態；按「通過」進下一步，按「退回」填原因。', flow: '正式環境的複核就是 Pull Request 審查：公關室以 PR review 核可內容，多語審核人核可 i18n 欄位，合併後 CI 自動發布七語頁面、索引與 API。這裡的通過／退回只存在你的瀏覽器。' })}
<div class="adm-box adm-box--note"><strong>多語複核規則</strong>一級內容（疾病、疫苗、澄清、態勢）：簽約審核、必審，未 reviewed 的語言頁不渲染。二級內容（Q&amp;A、新聞稿、通函等）：先發布並標示機器翻譯，每月抽審 10%。</div>
<section class="adm-card" aria-labelledby="rv-h"><h2 id="rv-h">複核佇列 <span class="adm-muted" id="rv-unit"></span></h2>
  <div class="adm-filters"><div class="adm-field"><label for="rv-state">顯示</label><select id="rv-state"><option value="open">待處理</option><option value="all">全部（含已通過、已退回）</option></select></div><span class="adm-count-note" id="rv-count" aria-live="polite"></span></div>
  <div class="adm-tablewrap"><table class="adm-table"><thead><tr><th scope="col">型別</th><th scope="col">標題</th><th scope="col">承辦單位</th><th scope="col">目前步驟</th><th scope="col">語言狀態</th><th scope="col">動作</th></tr></thead><tbody id="rv-body"></tbody></table></div>
  <p class="adm-empty" id="rv-empty" hidden>目前沒有待複核內容。到「上架新內容」送出預處理並按「確認並送複核」，就會出現在這裡。</p>
  <p class="adm-muted" id="rv-msg" role="status" aria-live="polite"></p>
</section>
${dataScript('adm-review-data', data)}`;
}
