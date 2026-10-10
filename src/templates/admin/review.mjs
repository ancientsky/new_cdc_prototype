// /admin/review/ 複核區：示範佇列（status=review 的內容＋本機送複核的草稿）
// 第三十輪：有寫入閘道時（review-gateway.js 偵測），改顯示「線上審核」（#gw-review／#gw-detail），本機示範佇列與正式環境說明（data-gw-hide）收起。
import { html } from '../../../scripts/lib/render.mjs';
import { pageHead, dataScript, adminMeta, catalogRows } from './_partials.mjs';
export { layout } from './_layout.mjs';

export function pages() { return [{ path: '/admin/review/', props: {}, noindex: true }]; }
export function meta() { return adminMeta('複核區', 'review', ['/assets/js/admin/review.js', '/assets/js/admin/review-gateway.js']); }

export function render(ctx) {
  const { site } = ctx;
  const items = catalogRows(site).filter((r) => r.status === 'review').map(({ id, type, title, owner, ownerName, languages, front }) => ({ id, type, title, owner, ownerName, languages, front }));
  const data = { items, today: site.today, demo: [
    { id: 'demo.faq-chikungunya-when-to-see-doctor', type: 'faq', title: '屈公病出現關節痛要不要就醫？（示意）', owner: 'unit.acute-infectious', ownerName: '急性傳染病組', languages: { 'zh-TW': 'source', en: 'pending', ja: 'pending', tl: 'pending', vi: 'pending', id: 'pending', th: 'pending' }, step: 2, demo: true },
    { id: 'demo.news-enterovirus-update', type: 'news', title: '腸病毒疫情提醒新聞稿（示意）', owner: 'unit.pr', ownerName: '公關室', languages: { 'zh-TW': 'source', en: 'machine' }, step: 3, demo: true },
  ] };
  return html`
${pageHead({ title: '複核區', what: '送出預處理的內容在這裡排隊走四步：承辦人確認 → 公關室內容審核 → 多語審核 → 發布。每筆顯示目前步驟與各語言狀態；按「通過」進下一步，按「退回」填原因。', flow: '正式環境的複核就是 Pull Request 審查：公關室以 PR review 核可內容，多語審核人核可 i18n 欄位，合併後 CI 自動發布七語頁面、索引與 API。這裡的通過／退回只存在你的瀏覽器。' })}
<section class="adm-card" id="gw-review" aria-labelledby="gw-rv-h" hidden>
  <h2 id="gw-rv-h">待審核 <span class="adm-muted" id="gw-rv-who"></span></h2>
  <p class="adm-hint">承辦人按「送審」的內容會出現在這裡。點「審核」看改了什麼與預覽，再按「核准上線」或「退回修改」。你編輯過的內容不能自己審核（四眼原則）。</p>
  <p class="adm-count-note" id="gw-rv-count" role="status" aria-live="polite"></p>
  <div class="adm-tablewrap" role="region" tabindex="0" aria-label="待審核清單，可捲動"><table class="adm-table"><thead><tr><th scope="col">型別</th><th scope="col">標題</th><th scope="col">權責單位</th><th scope="col">承辦</th><th scope="col">送審時間</th><th scope="col">狀態</th><th scope="col">動作</th></tr></thead><tbody id="gw-queue"></tbody></table></div>
  <p class="adm-empty" id="gw-empty" hidden>目前沒有待審核的內容。</p>
</section>
<section class="adm-card" id="gw-detail" aria-labelledby="gw-d-h" hidden>
  <h2 id="gw-d-h" tabindex="-1">審核：<span id="gw-d-title"></span></h2>
  <dl class="gw-meta" id="gw-d-meta"></dl>
  <h3>改了什麼</h3>
  <div id="gw-diff"></div>
  <h3>預覽</h3>
  <button type="button" class="adm-btn adm-btn--ghost" id="gw-preview-btn" aria-expanded="false" aria-controls="gw-preview-wrap">顯示送審版預覽</button>
  <div id="gw-preview-wrap" hidden></div>
  <div class="adm-field" style="margin-top:var(--sp-4)"><label for="gw-comment">意見（退回修改時必填）</label><textarea id="gw-comment" maxlength="2000" rows="3" aria-describedby="gw-comment-hint"></textarea><span class="adm-hint" id="gw-comment-hint">寫清楚要改哪裡；承辦人會收到 Email 與 Teams 通知。</span></div>
  <div class="adm-actions"><button type="button" class="adm-btn" id="gw-approve">核准上線</button><button type="button" class="adm-btn adm-btn--danger" id="gw-return">退回修改</button></div>
  <p class="adm-muted" id="gw-why"></p>
  <p class="adm-muted" id="gw-act-msg" role="status" aria-live="polite"></p>
</section>
<div class="adm-box adm-box--note"><strong>多語複核規則</strong>一級內容（疾病、疫苗、澄清、態勢）：簽約審核、必審，未 reviewed 的語言頁不渲染。二級內容（Q&amp;A、新聞稿、通函等）：先發布並標示機器翻譯，每月抽審 10%。</div>
<section class="adm-card" aria-labelledby="rv-h" data-gw-hide><h2 id="rv-h">複核佇列 <span class="adm-muted" id="rv-unit"></span></h2>
  <div class="adm-filters"><div class="adm-field"><label for="rv-state">顯示</label><select id="rv-state"><option value="open">待處理</option><option value="all">全部（含已通過、已退回）</option></select></div><span class="adm-count-note" id="rv-count" aria-live="polite"></span></div>
  <div class="adm-tablewrap" role="region" tabindex="0" aria-label="表格，可捲動"><table class="adm-table"><thead><tr><th scope="col">型別</th><th scope="col">標題</th><th scope="col">承辦單位</th><th scope="col">目前步驟</th><th scope="col">語言狀態</th><th scope="col">動作</th></tr></thead><tbody id="rv-body"></tbody></table></div>
  <p class="adm-empty" id="rv-empty" hidden>目前沒有待複核內容。到「上架新內容」送出預處理並按「確認並送複核」，就會出現在這裡。</p>
  <p class="adm-muted" id="rv-msg" role="status" aria-live="polite"></p>
</section>
${dataScript('adm-review-data', data)}`;
}
