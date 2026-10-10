// /admin/reports/ 回報：前台「回報錯誤」寫入 localStorage cdc.reports，這裡讀出、對應 Steward、標記處理
import { html } from '../../../scripts/lib/render.mjs';
import { pageHead, adminMeta, dataScript, catalogRows } from './_partials.mjs';
export { layout } from './_layout.mjs';

export function pages() { return [{ path: '/admin/reports/', props: {}, noindex: true }]; }
export function meta() { return adminMeta('回報', 'reports', ['/assets/js/admin/reports.js']); }

export function render(ctx) {
  const { site } = ctx;
  const pageMap = {};
  for (const r of catalogRows(site)) if (r.front && r.type !== 'dataset' && r.type !== 'clarification') pageMap[r.front] = { id: r.id, title: r.title, owner: r.owner, ownerName: r.ownerName, steward: r.steward };
  const unitName = (id) => site.unitById.get(id)?.name ?? id;
  const fixed = { '/ask/': 'unit.oasis', '/': 'unit.pr', '/situation/': 'unit.epidemic-intelligence', '/factcheck/': 'unit.pr', '/travel/': 'unit.quarantine', '/data/': 'unit.oasis', '/vaccines/': 'unit.acute-infectious', '/diseases/': 'unit.acute-infectious', '/news/': 'unit.pr', '/faq/': 'unit.acute-infectious', '/documents/': 'unit.acute-infectious' };
  for (const [p, o] of Object.entries(fixed)) pageMap[p] ??= { id: null, title: '（頁面層級）', owner: o, ownerName: unitName(o), steward: '' };
  for (const c of site.collections.clarifications) pageMap[`/factcheck/#${c.id}`] = { id: c.id, title: c.title, owner: c.owner, ownerName: unitName(c.owner), steward: c.steward ?? '' };
  return html`
${pageHead({ title: '回報', what: '民眾在前台答案頁或內容頁按「回報錯誤」的紀錄。系統由頁面路徑反查該內容的權責單位與承辦人（Steward），並附稽核編號，方便重現當時的答案。', flow: '正式環境：回報進工單／信箱路由到 Steward，修正內容走 PR，並把該題加進評估集。原型的回報只存在送出回報的那個瀏覽器（localStorage cdc.reports），所以這頁示範的是流程與欄位。' })}
<section class="adm-card" aria-labelledby="r-h"><h2 id="r-h">回報清單 <span class="adm-muted" id="r-unit"></span></h2>
  <div class="adm-filters"><div class="adm-field"><label for="r-state">狀態</label><select id="r-state"><option value="">全部</option><option value="open">待處理</option><option value="fixed">已修正</option></select></div>
    <div class="adm-field"><label for="r-scope">範圍</label><select id="r-scope"><option value="unit">我的單位</option><option value="all">全部單位</option></select></div>
    <button type="button" class="adm-btn adm-btn--ghost" id="r-csv">匯出 CSV</button><button type="button" class="adm-btn adm-btn--ghost" id="r-json">匯出 JSON</button><button type="button" class="adm-btn adm-btn--ghost" id="r-demo">加入 1 筆示範回報</button>
    <span class="adm-count-note" id="r-count" aria-live="polite"></span></div>
  <div class="adm-tablewrap" role="region" tabindex="0" aria-label="表格，可捲動"><table class="adm-table"><thead><tr><th scope="col">時間</th><th scope="col">稽核編號</th><th scope="col">頁面</th><th scope="col">問題／回報內容</th><th scope="col">對應 Steward</th><th scope="col">狀態</th></tr></thead><tbody id="r-body"></tbody></table></div>
  <p class="adm-empty" id="r-empty" hidden>目前這個瀏覽器沒有回報紀錄。到前台答案頁（/ask/）或內容頁按「回報錯誤」送出一筆，或按上方「加入 1 筆示範回報」。</p>
</section>
${dataScript('adm-report-data', { pages: pageMap, fallbackOwner: { owner: 'unit.oasis', ownerName: unitName('unit.oasis') } })}`;
}
