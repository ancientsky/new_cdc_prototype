// /admin/vaccines/schedule/ 疫苗接種時程表編輯（第三十六輪）：急性傳染病組（預防接種）在這裡改主檔 content/master/immunization-schedule.json。
// 左：清單＋一筆的表單；右：時程地圖與表格的即時預覽（與前台同一份渲染函式），點圖上的標記就跳到那一筆；下：檢查、匯出、diff 摘要。
import { html } from '../../../scripts/lib/render.mjs';
import { pageHead, adminMeta, dataScript } from './_partials.mjs';
import { STRINGS } from '../../client/i18n.js';
import { TABS } from '../../client/vaxschedule.js';
export { layout } from './_layout.mjs';

export function pages() { return [{ path: '/admin/vaccines/schedule/', props: {}, noindex: true }]; }
export function meta() { return adminMeta('疫苗接種時程表', 'vaxschedule', ['/assets/js/admin/vaxschedule-edit.js']); }

const field = (f, label, input, hint = '') => html`<div class="adm-field"><label for="vx-${f}">${label}</label>${input}${hint ? html`<span class="adm-hint">${hint}</span>` : ''}</div>`;
const text = (f, ph = '', extra = '') => html`<input type="text" id="vx-${f}" data-f="${f}" placeholder="${ph}" ${extra}>`;
const num = (f, max) => html`<input type="number" id="vx-${f}" data-f="${f}" min="0" max="${max}" inputmode="numeric" class="adm-vx-num">`;

export function render(ctx) {
  const { site, url } = ctx;
  const items = site.master.immunizationSchedule ?? [];
  const data = {
    today: site.today,
    items,
    vaccines: site.master.vaccines.map((m) => ({ id: m.id, name: m.name, nameEn: m.nameEn, hasPage: !!m.hasPage })),
    strings: Object.fromEntries(Object.entries(STRINGS['zh-TW']).filter(([k]) => k.startsWith('vxs.') || k === 'a11y.scrollTable')),
  };
  const un = items.filter((i) => i.verified === false).length;
  return html`
${pageHead({ title: '疫苗接種時程表', what: '改一筆，右邊的時程地圖與表格就一起變，因為前台的地圖、表格、問答「幾歲能打哪些公費疫苗」、開放資料 JSON／CSV 都讀同一份主檔。點地圖上的標記或表格的一列，就跳到那一筆的表單。', flow: '改完按「匯出 JSON」交資訊室取代 content/master/immunization-schedule.json，或複製「修訂摘要」貼進送審說明；CI 會跑和這裡同一套檢查（疫苗 id、年齡上下限、必填欄位），通過並核定後合併即同時更新地圖、表格、問答與 API。主檔尚未接寫入閘道（見 ARCHITECTURE §42）。' })}
<div class="adm-box ${un ? 'adm-box--warn' : 'adm-box--ok'}"><strong>目前上線版本：${items.length} 筆，${un} 筆待核對。</strong>${un ? '待核對的筆在前台顯示「待承辦人確認」；逐筆對照疾管署公告後勾「已核對」即可。' : '全部已核對。'}　改疫苗政策時，疫苗頁的「公費對象」表（正本）要一起改，見同事指南 §18。</div>
<div class="adm-split adm-vx-split">
<section class="adm-card" aria-labelledby="vxl-h">
  <h2 id="vxl-h">時程項目 <span class="adm-muted" id="vx-count"></span></h2>
  <ul class="adm-vx-list" id="vx-list"></ul>
  <div class="adm-actions"><button type="button" class="adm-btn adm-btn--sm" id="vx-add">＋ 新增一筆（複製目前這筆）</button><button type="button" class="adm-btn adm-btn--sm adm-btn--danger" id="vx-del">刪除這筆</button></div>
  <h2>這一筆</h2>
  <form id="vx-form" class="adm-form" novalidate>
    <div class="adm-grid adm-grid--2">
      ${field('vaccine', '疫苗', html`<select id="vx-vaccine" data-f="vaccine"></select>`, '不在清單的疫苗要先加進疫苗主檔')}
      ${field('id', '編號', text('id', 'sched.mmr-1'), '只在程式與網址用；新增時自動給')}
    </div>
    ${field('label', '項目名稱', text('label', 'MMR 疫苗 第 1 劑'))}
    <div class="adm-grid adm-grid--2">
      ${field('dose', '劑次', text('dose', '第 1 劑／每年 1 劑'), '表格「劑次／項目」欄顯示它')}
      ${field('labelEn', '英文名稱（選填）', text('labelEn', 'MMR dose 1'))}
    </div>
    <fieldset class="adm-fieldset"><legend>建議年齡（地圖用月齡畫；兩欄皆空＝0）</legend>
      <div class="adm-vx-age">
        <span>下限</span>${num('ageY', 120)}<span>歲</span>${num('ageM', 11)}<span>個月</span>
        <span class="adm-vx-sep">上限</span>${num('maxY', 120)}<span>歲</span>${num('maxM', 11)}<span>個月</span>
        <label class="adm-pill"><input type="checkbox" id="vx-noMax" data-f="noMax"><span>不設上限（例：65 歲以上）</span></label>
      </div>
      <p class="adm-hint" id="vx-agehint"></p>
      ${field('ageLabel', '年齡（人看的寫法）', text('ageLabel', '出生滿 12 個月'), '表格、詳情卡與問答直接顯示這句；地圖仍用上面的月齡')}
    </fieldset>
    <div class="adm-grid adm-grid--3">
      ${field('stage', '階段（地圖頁籤）', html`<select id="vx-stage" data-f="stage"></select>`)}
      ${field('funded', '費用', html`<select id="vx-funded" data-f="funded"></select>`)}
      <div class="adm-field"><label for="vx-recurring" class="adm-pill" style="margin-top:1.6em"><input type="checkbox" id="vx-recurring" data-f="recurring"><span>每年接種</span></label></div>
    </div>
    ${field('group', '公費對象（條件）', text('group', '65 歲以上、55–64 歲原住民…'), '「符合條件公費」一定要寫；問答會唸出來')}
    <div class="adm-grid adm-grid--2">
      ${field('interval', '間隔', text('interval', '與上一劑間隔至少 4 週'))}
      ${field('note', '備註', text('note', '部分縣市補助…'))}
    </div>
    <div class="adm-grid adm-grid--2">
      ${field('startAt', '生效日', html`<input type="date" id="vx-startAt" data-f="startAt">`, '政策改版日；與疫苗頁 publicFunded 的 startAt 填同一天')}
      ${field('endAt', '結束日', html`<input type="date" id="vx-endAt" data-f="endAt">`)}
    </div>
    <div class="adm-grid adm-grid--2">
      ${field('sourceTitle', '來源名稱', text('sourceTitle', '現行兒童預防接種時程表（11401 版，疾管署）'))}
      ${field('sourceUrl', '來源網址', text('sourceUrl', 'https://www.cdc.gov.tw/…', 'inputmode="url"'), '疾管署公告網址，或站內疫苗頁路徑')}
    </div>
    <label class="adm-pill adm-vx-verified"><input type="checkbox" id="vx-verified" data-f="verified"><span><b>已核對</b><small>我已逐字對照最新公告；未勾時前台標「待承辦人確認」</small></span></label>
    <div id="vx-check" aria-live="polite"></div>
    <div class="adm-actions adm-actions--sticky"><button type="button" class="adm-btn" id="vx-save">暫存在這台電腦</button><button type="button" class="adm-btn adm-btn--ghost" id="vx-verify">勾已核對並暫存</button><button type="button" class="adm-btn adm-btn--ghost" id="vx-reset">回到上線版本</button><span class="adm-actions__spacer"></span><span class="adm-muted" id="vx-msg" role="status" aria-live="polite"></span></div>
  </form>
</section>
<div>
<section class="adm-card" aria-labelledby="vxp-h"><h2 id="vxp-h">時程地圖預覽</h2><p class="adm-card__sub">與前台 <a href="${url('/vaccines/schedule/')}">/vaccines/schedule/</a> 同一份畫法；改欄位會立刻重畫。點標記＝編輯那一筆。</p>
  <div class="c-tabs__list vxs-tabs" role="tablist" aria-label="依年齡階段">${TABS.map((tb, i) => html`<button type="button" role="tab" aria-selected="${i === 0 ? 'true' : 'false'}" data-vx-tab="${tb.id}">${STRINGS['zh-TW'][`vxs.tab.${tb.id}`]}</button>`)}</div>
  <div class="vxs adm-vx-preview"><div class="vxs-scroll" id="vx-map"></div></div></section>
<section class="adm-card" aria-labelledby="vxt-h"><h2 id="vxt-h">時程表預覽</h2><p class="adm-card__sub">同一份資料的表格（前台地圖下方那張）。點一列＝編輯那一筆。</p><div class="vxs adm-vx-preview" id="vx-table"></div></section>
<section class="adm-card" aria-labelledby="vxe-h"><h2 id="vxe-h">匯出 <span id="vx-export-state" class="adm-badge adm-badge--gray"></span></h2>
  <p class="adm-card__sub" id="vx-diff"></p>
  <div class="adm-actions"><button type="button" class="adm-btn" id="vx-dl">匯出 JSON（交資訊室）</button><button type="button" class="adm-btn adm-btn--ghost" id="vx-copy">複製 JSON</button><button type="button" class="adm-btn adm-btn--ghost" id="vx-csv">下載 CSV</button><button type="button" class="adm-btn adm-btn--ghost" id="vx-copydiff">複製修訂摘要（送審說明用）</button></div>
  <details class="adm-details"><summary>看完整 JSON</summary><pre class="adm-pre" id="vx-out" tabindex="0">[ ]</pre></details>
  <p class="adm-muted">正式環境：此檔取代 <code>content/master/immunization-schedule.json</code>；CI 驗證（疫苗 id 要在疫苗主檔、年齡上限不小於下限、必填欄位）通過並核定後合併，地圖、表格、問答與 <a href="${url('/v1/immunization-schedule.json', { noLang: true })}">API</a>／<a href="${url('/vaccines/schedule.csv', { noLang: true })}">CSV</a> 同時更新。</p></section>
</div></div>
${dataScript('adm-vxs-data', data)}`;
}
