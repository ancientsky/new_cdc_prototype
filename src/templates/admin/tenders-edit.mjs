// /admin/tenders/edit/ 採購公告上架與異動（秘書室）：新增標案、展延／改期、流標／取消、公告決標。
// 做法照 /admin/situation/：表單 → 即時預覽與檢核 → 匯出整份 tender JSON → 開 PR（快車道）。
// 檢核與階段推導在 src/client/admin/tenders-edit-core.js（純函式；階段用 careers-rules.js 的 tenderStageOf，與 CI 同一份）。
import { readFileSync } from 'node:fs';
import { html } from '../../../scripts/lib/render.mjs';
import { pageHead, adminMeta, dataScript } from './_partials.mjs';
import { allTenders } from '../public/_careers.mjs';
import { STAGE_LABEL, AMEND_KIND_LABEL, stripBuild } from '../../client/admin/tenders-edit-core.js';
export { layout } from './_layout.mjs';

export function pages() { return [{ path: '/admin/tenders/edit/', props: {}, noindex: true }]; }
export function meta() { return adminMeta('採購公告上架與異動', 'tenders', ['/assets/js/admin/tenders-edit.js']); }

const SCHEMA = JSON.parse(readFileSync(new URL('../../../schemas/tender.json', import.meta.url), 'utf8'));
export const ENUMS = { method: SCHEMA.properties.method.enum, category: SCHEMA.properties.category.enum, awardRule: SCHEMA.properties.awardRule.enum };

const field = (id, label, input, hint = '') => html`<div class="adm-field"><label for="${id}">${label}</label>${input}${hint ? html`<span class="adm-hint">${hint}</span>` : ''}</div>`;
const text = (id, ph = '') => html`<input type="text" id="${id}" placeholder="${ph}">`;
const date = (id) => html`<input type="date" id="${id}">`;
const sel = (id, list, empty = '') => html`<select id="${id}">${empty ? html`<option value="">${empty}</option>` : ''}${list.map((v) => html`<option value="${v}">${v}</option>`)}</select>`;
const area = (id, ph = '', rows = 3) => html`<textarea id="${id}" rows="${rows}" class="adm-tf-area" placeholder="${ph}"></textarea>`;

export function render(ctx) {
  const { site, url } = ctx;
  const tenders = allTenders(site).map(stripBuild).sort((a, b) => String(b.announcedAt ?? '').localeCompare(String(a.announcedAt ?? '')));
  const units = site.master.units.filter((u) => u.publishes !== false).map((u) => ({ id: u.id, name: u.name }));
  const data = { today: site.today, tenders, units, enums: ENUMS, stages: STAGE_LABEL, amendKinds: AMEND_KIND_LABEL };
  return html`
${pageHead({
    title: '採購公告上架與異動',
    what: '秘書室在這裡上架新的採購公告，或對既有標案做四件事：改公告內容、展延投標截止／改開標日、標示流標或取消、公告決標。右側即時算出前台會顯示的階段，列出發布前要補齊的地方，並產生整份標案 JSON。',
    flow: '填寫 → 檢核全綠 → 匯出 JSON，新增或覆蓋 content/tenders/ 的檔案後開 PR → 快車道（CI 驗 schema、日期先後、個資樣式，通過即自動合併上線）→ 上線後公關室 24 小時內複核（待辦副本給秘書室），秘書室並與政府電子採購網的公告核對一致。',
  })}
<div class="adm-box adm-box--note"><strong>以政府電子採購網為準</strong>本站只彙整公告資訊；更正、展延、決標都要先在採購網公告，再回來這裡更新，上線後請核對兩邊日期與金額一致。</div>
<div class="adm-split">
<section class="adm-card" aria-labelledby="tf-h"><h2 id="tf-h">標案表單</h2>
  <form id="tf-form" class="adm-form" novalidate>
    <div class="adm-field"><label for="tf-pick">要做什麼</label><select id="tf-pick"><option value="">＋ 新增標案</option>${tenders.map((x) => html`<option value="${x.id}">${x.announcedAt ?? ''}｜${x.title}</option>`)}</select>
      <span class="adm-hint">選既有標案＝帶入全部欄位（id 與網址代稱鎖定），可展延、流標或公告決標。</span></div>

    <fieldset class="adm-fieldset adm-tf-sec" id="tf-sec-a"><legend>A 公告內容</legend>
      ${field('tf-title', '標案名稱', text('tf-title', '115 年度○○採購案'))}
      ${field('tf-summary', '摘要（一兩句，給民眾與 AI 摘要用）', area('tf-summary', '', 2))}
      ${field('tf-slug', '網址代稱（slug）', text('tf-slug', 'cold-chain-monitor'), html`小寫英文、數字、連字號。前台網址 /procurement/<b id="tf-slug-echo">slug</b>/；id＝tender.{公告日}-{slug}。<span id="tf-slug-lock" hidden>既有標案鎖定，不可改。</span>`)}
      <div class="adm-grid adm-grid--2">${field('tf-no', '標案案號', text('tf-no', 'CDC-115-XX-001'))}${field('tf-unit', '需求單位', html`<select id="tf-unit"><option value="">（請選擇）</option>${units.map((u) => html`<option value="${u.id}">${u.name}</option>`)}</select>`)}</div>
      <div class="adm-grid adm-grid--3">${field('tf-method', '採購方式', sel('tf-method', ENUMS.method, '（請選擇）'))}${field('tf-rule', '決標原則（選填）', sel('tf-rule', ENUMS.awardRule, '（未定）'))}${field('tf-cat', '標的分類', sel('tf-cat', ENUMS.category, '（請選擇）'))}</div>
      ${field('tf-budget', '預算金額（新臺幣元）', html`<input type="text" id="tf-budget" inputmode="numeric" placeholder="6500000">`, '只填數字；逗號會自動去掉。')}
      <div class="adm-grid adm-grid--2">${field('tf-announced', '公告日', date('tf-announced'))}${field('tf-deadline', '投標截止日', date('tf-deadline'))}${field('tf-opening', '開標日', date('tf-opening'))}${field('tf-briefing', '廠商說明會（選填）', date('tf-briefing'))}</div>
      ${field('tf-pcc', '政府電子採購網連結', text('tf-pcc', 'https://web.pcc.gov.tw/…'))}
      ${field('tf-scope', '採購範圍（每行一項）', area('tf-scope', '第 1 組：…'))}
      ${field('tf-terms', '特別條款（每行一項，選填）', area('tf-terms'))}
      ${field('tf-period', '履約期間（選填）', text('tf-period', '決標日起至 2027 年 6 月 30 日'))}
      ${field('tf-att', '附件（每行「標題 | 網址 | 格式」）', area('tf-att', '投標須知 | /files/tender.2026-09-22-x/notice.pdf | PDF', 2))}
      ${field('tf-contact', '聯絡窗口（單位與總機轉分機；不放承辦人姓名）', text('tf-contact', '疾管署秘書室：（02）2395-9825 轉分機'))}
    </fieldset>

    <fieldset class="adm-fieldset adm-tf-sec" id="tf-sec-b"><legend>B 時程異動（展延／改期／更正）</legend>
      <p class="adm-hint" id="tf-b-new">新增標案不需要異動紀錄；上線後要改日期，再選這筆標案回來這裡。</p>
      <div id="tf-b-body">
        <p class="adm-hint">在 A 區改投標截止日、開標日或說明會日期後，下面會列出新舊對照。填一句給廠商看的說明，按「加入異動紀錄」。只改錯字、沒改日期也可以加一筆（更正）。</p>
        <div id="tf-diff" class="adm-tf-diff" aria-live="polite"></div>
        ${field('tf-am-text', '異動說明（給廠商看的一句話）', text('tf-am-text', '投標截止日由 2026-10-15 展延至 2026-10-22'), '留白會依日期差異自動擬一句。')}
        ${field('tf-am-ref', '異動公告字號（選填）', text('tf-am-ref', '疾管秘字第 1150000000 號'))}
        <div class="adm-actions"><button type="button" class="adm-btn" id="tf-am-add">加入異動紀錄</button></div>
      </div>
      <h3 class="adm-tf-h3">異動紀錄</h3>
      <ol class="adm-tf-amends" id="tf-amends"></ol>
    </fieldset>

    <fieldset class="adm-fieldset adm-tf-sec" id="tf-sec-c"><legend>C 流標／取消</legend>
      <div class="adm-pills" role="radiogroup" aria-label="人工狀態">
        <label class="adm-pill"><input type="radio" name="tf-ms" value="" checked><span>維持自動（依日期推導）</span></label>
        <label class="adm-pill"><input type="radio" name="tf-ms" value="failed"><span>流標</span></label>
        <label class="adm-pill"><input type="radio" name="tf-ms" value="cancelled"><span>廢標／取消</span></label></div>
      ${field('tf-ms-note', '原因（會顯示在前台）', text('tf-ms-note', '截止時無廠商投標'))}
      ${field('tf-cancel-text', '自動加入的異動紀錄（可改）', text('tf-cancel-text'), '選了流標或取消，會自動在異動紀錄加一筆「流標／取消」；改回「維持自動」就移除。')}
    </fieldset>

    <fieldset class="adm-fieldset adm-tf-sec" id="tf-sec-d"><legend>D 決標公告</legend>
      <div class="adm-grid adm-grid--2">${field('tf-aw-date', '決標日', date('tf-aw-date'))}${field('tf-aw-amount', '決標金額（新臺幣元，選填）', html`<input type="text" id="tf-aw-amount" inputmode="numeric">`)}</div>
      ${field('tf-aw-winner', '得標廠商（法人名稱）', text('tf-aw-winner', '○○股份有限公司'), '只放公司或機關名稱；不放負責人姓名、身分證字號。')}
      ${field('tf-aw-note', '備註（選填）', text('tf-aw-note', '複數決標，三組分別決標'))}
      <div class="adm-actions"><button type="button" class="adm-btn adm-btn--ghost" id="tf-aw-clear">清除決標資訊</button></div>
    </fieldset>

    <div class="adm-actions"><button type="button" class="adm-btn" id="tf-save">儲存草稿（本機）</button><button type="button" class="adm-btn adm-btn--ghost" id="tf-reset">重新帶入（放棄修改）</button></div>
    <p class="adm-muted" id="tf-msg" role="status" aria-live="polite"></p>
  </form></section>
<div>
<section class="adm-card" aria-labelledby="tp-h"><h2 id="tp-h">預覽與檢核</h2>
  <div class="adm-tf-preview" id="tf-preview" aria-live="polite"></div>
  <div id="tf-warn"></div></section>
<section class="adm-card" aria-labelledby="te-h"><h2 id="te-h">匯出</h2>
  <p class="adm-card__sub">應存的檔名：<code id="tf-file">content/tenders/…</code></p>
  <pre class="adm-pre" id="tf-out" tabindex="0">{ }</pre>
  <div class="adm-actions"><button type="button" class="adm-btn" id="tf-copy">複製</button><button type="button" class="adm-btn adm-btn--ghost" id="tf-dl">下載 .json</button></div>
  <p class="adm-muted">正式環境：新增標案＝把這份存成上面的檔名；既有標案＝整檔覆蓋同名檔。開 Pull Request 後走快車道（CI 通過即自動合併上線），上線後公關室 24 小時內複核（待辦副本給秘書室），秘書室並與政府電子採購網核對日期、金額、得標廠商。</p>
  <p class="adm-muted">回 <a href="${url('/admin/tenders/', { noLang: true })}">採購公告管理</a> 看全部標案的階段與決標逾期待辦。</p></section>
</div></div>
${dataScript('adm-tenders-data', data)}`;
}
