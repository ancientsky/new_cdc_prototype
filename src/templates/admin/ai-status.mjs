// /admin/ai-status/ AI 開關（規劃 6.1 第 5 點）：暫停／恢復、原因、操作單位；本機覆寫 cdc.aiStatusOverride
import { html } from '../../../scripts/lib/render.mjs';
import { pageHead, adminMeta, dataScript, unitOptions, DEFAULT_UNIT } from './_partials.mjs';
export { layout } from './_layout.mjs';

export function pages() { return [{ path: '/admin/ai-status/', props: {}, noindex: true }]; }
export function meta() { return adminMeta('AI 開關', 'ai-status', ['/assets/js/admin/ai-status.js']); }

export function render(ctx) {
  const { site, url } = ctx;
  const ai = site.governance.aiStatus;
  const SOP = [
    ['發現與通報', '承辦單位、公關室或民眾回報發現錯答（含稽核編號 A-…）；OASIS 值班確認是否為系統性問題。'],
    ['按下暫停', 'OASIS 或資訊室在本頁填寫原因與操作單位，按「暫停 AI 問答」。不需要簽核流程，暫停永遠比錯答便宜。'],
    ['全站切回傳統搜尋', '生效時間 ≤ 15 分鐘（原型即時）：答案頁改為傳統結果列表（標題、摘要、更新日），全站出現深色狀況橫幅，並保留 1922 電話。'],
    ['修正與回歸', '權責單位修內容或規則 → 把該題加進評估集 → 在「評估」頁確認六指標與版本題全數通過。'],
    ['恢復與揭露', '資料治理委員會核可後按「恢復」；事件與處置寫入季度 AI 透明報告。'],
  ];
  return html`
${pageHead({ title: 'AI 開關', what: '暫停或恢復全站 AI 問答。暫停時答案頁自動退回傳統搜尋結果列表，不影響其他頁面與資料 API。', flow: '正式環境：修改 content/governance/ai-status.json 並合併（緊急時由 OASIS／資訊室以最高優先權 PR 或部署參數切換，≤ 15 分鐘生效）。此頁的按鈕只寫入你的瀏覽器 cdc.aiStatusOverride，答案頁會讀它。' })}
<section class="adm-card" aria-labelledby="as-h"><h2 id="as-h">目前狀態</h2>
  <div class="adm-bigswitch" id="as-state"><div><p class="adm-bigswitch__state" id="as-label" role="status" aria-live="polite"></p><p class="adm-muted" id="as-detail" style="margin:0"></p></div></div>
  <div class="adm-grid adm-grid--2" style="margin-top:var(--sp-4)">
    <div class="adm-box adm-box--note" style="margin:0"><strong>建置版本（/v1/governance/ai-status.json）</strong>
      <span id="as-base">${ai.paused ? '暫停' : '運作'}；原因：${ai.reason || '—'}；更新：${ai.updatedAt ?? '—'}；操作：${site.unitById.get(ai.updatedBy)?.name ?? ai.updatedBy ?? '—'}；模式：${ai.mode ?? 'extractive'}</span></div>
    <div class="adm-box adm-box--info" style="margin:0" id="as-override"><strong>本機覆寫（cdc.aiStatusOverride）</strong><span id="as-override-text">無</span></div>
  </div>
</section>
<div class="adm-split adm-split--even">
<section class="adm-card" aria-labelledby="af-h"><h2 id="af-h">切換</h2>
  <form id="as-form" class="adm-form" novalidate>
    <div class="adm-field"><label for="as-reason">原因（暫停時必填）</label><input type="text" id="as-reason" placeholder="例：發現版本題錯答，稽核編號 A-20261001-XXXX"></div>
    <div class="adm-field"><label for="as-unit">操作單位</label><select id="as-unit">${unitOptions(site, { all: false, selected: 'unit.oasis' })}</select></div>
    <div class="adm-actions"><button type="button" class="adm-btn adm-btn--danger adm-btn--big" id="as-pause">暫停 AI 問答（切回傳統搜尋）</button><button type="button" class="adm-btn adm-btn--big" id="as-resume">恢復 AI 問答</button></div>
    <p class="adm-muted"><strong>生效時間 ≤ 15 分鐘（原型即時）。</strong>你的瀏覽器會立即套用；<a href="${url('/ask/?q=登革熱')}">開啟答案頁</a>可驗證。</p>
    <p class="adm-muted"><button type="button" class="adm-btn adm-btn--ghost adm-btn--sm" id="as-clear">清除本機覆寫（回到建置版本）</button></p>
    <div id="as-msg" role="alert" aria-live="assertive"></div>
  </form></section>
<section class="adm-card" aria-labelledby="ao-h"><h2 id="ao-h">輸出 ai-status.json（供 PR）</h2>
  <p class="adm-card__sub">正式環境：把這份內容貼進 content/governance/ai-status.json 並合併。</p>
  <pre class="adm-pre" id="as-out" tabindex="0">{ }</pre>
  <div class="adm-actions"><button type="button" class="adm-btn adm-btn--ghost" id="as-copy">複製</button><button type="button" class="adm-btn adm-btn--ghost" id="as-dl">下載 .json</button></div>
  <h3>覆寫格式（給答案頁讀取）</h3>
  <p class="adm-muted"><code>localStorage["cdc.aiStatusOverride"]</code> = <code>{"paused": boolean, "reason": string, "updatedAt": ISO 時間, "updatedBy": 單位 id}</code>。存在時優先於建置版本；清除則回到建置版本。</p></section>
</div>
<section class="adm-card" aria-labelledby="sop-h"><h2 id="sop-h">暫停 SOP（五步）</h2><ol class="adm-sop">${SOP.map(([a, b]) => html`<li><strong>${a}</strong>：${b}</li>`)}</ol>
  <h3>暫停後前台長這樣</h3><ul><li>答案頁 <code>/ask/</code>：不產生答案句，改列「標題、摘要、更新日」的傳統搜尋結果。</li><li>全站頁首：深色橫幅「AI 問答暫停中，已切回傳統搜尋」。</li><li>內容頁、資料 API、1922 專線資訊照常。</li></ul></section>
${dataScript('adm-ai-data', { base: ai, defaultUnit: DEFAULT_UNIT })}`;
}
