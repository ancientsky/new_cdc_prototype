// /admin/jobs/edit/ 人才招募上架與異動（人事室）：表單 → 即時預覽與檢核 → 匯出 job JSON → 開 PR（快車道）。
// 四個區塊：A 公告內容、B 時程異動（追加 amendments）、C 取消／補實（manualStatus）、D 甄選結果（result／waitlistUpdates）。
// 純函式在 src/client/admin/jobs-edit-core.js；個資檢核與 CI 共用 src/client/careers-rules.js。這個模板只輸出靜態骨架與資料島。
import { html } from '../../../scripts/lib/render.mjs';
import { JOB_STAGE_LABELS } from '../../../scripts/lib/governance.mjs';
import { pageHead, adminMeta, dataScript } from './_partials.mjs';
import { allJobs, jobStage } from '../public/_careers.mjs';
import { JOB_TYPES, EXAM_STAGES, APPLY_METHODS, AMEND_KINDS, MANUAL_STATUS, stripBuild } from '../../client/admin/jobs-edit-core.js';
export { layout } from './_layout.mjs';

export function pages() { return [{ path: '/admin/jobs/edit/', props: {}, noindex: true }]; }
export function meta() { return adminMeta('人才招募上架與異動', 'jobs', ['/assets/js/admin/jobs-edit.js']); }

export function render(ctx) {
  const { site, url } = ctx;
  const jobs = allJobs(site).slice().sort((a, b) => String(b.publishedAt ?? '').localeCompare(String(a.publishedAt ?? '')));
  const data = {
    today: site.today,
    jobs: jobs.map((j) => ({ ...stripBuild(j), stage: jobStage(site, j) })),
    units: site.master.units.map((u) => ({ id: u.id, name: u.name })),
    jobTypes: JOB_TYPES, examStages: EXAM_STAGES, stages: JOB_STAGE_LABELS, amendKinds: AMEND_KINDS,
  };
  const field = (id, label, input, hint = '', wide = false) => html`<div class="adm-field${wide ? ' adm-jf-wide' : ''}"><label for="${id}">${label}</label>${input}${hint ? html`<span class="adm-hint">${hint}</span>` : ''}</div>`;
  const text = (id, label, { hint = '', ph = '', max = '' } = {}) => field(id, label, html`<input type="text" id="${id}" placeholder="${ph}" ${max ? html`maxlength="${max}"` : ''}>`, hint);
  const date = (id, label, hint = '') => field(id, label, html`<input type="date" id="${id}">`, hint);
  const area = (id, label, hint, ph = '') => field(id, label, html`<textarea id="${id}" rows="4" placeholder="${ph}"></textarea>`, hint);
  return html`
${pageHead({
    title: '人才招募上架與異動',
    what: '人事室在這裡上架新職缺、延長報名或改甄試日、取消或標示已補實，以及公告錄取名單（正取、備取、遞補）。每次輸入都即時預覽前台階段與日期，並用與建置相同的規則檢核；遮罩姓名或報名編號不合格的列會標紅。',
    flow: '填表 → 右側檢核全過 → 匯出 JSON，新增或覆蓋 content/jobs/ 下的同名檔 → 開 Pull Request。職缺走快車道：CI 通過即自動合併上線（約 3 分鐘），上線後 24 小時內完成上線後複核（待辦給公關室，副本人事室）。',
  })}
<div class="adm-box adm-box--note" role="note"><strong>異動會留下紀錄</strong>改報名或甄試日期、取消、補實時，表單會在 <code>amendments</code> 追加一筆「異動紀錄」（日期、類型、給民眾看的一句話、字號），前台職缺頁的「公告異動」區依日期倒序列出，民眾看得到歷程。日期改了卻沒加紀錄，右側會提醒。</div>
<p><a class="adm-btn adm-btn--ghost adm-btn--sm" href="${url('/admin/jobs/', { noLang: true })}">← 回人才招募管理</a></p>
<div class="adm-split adm-jf">
<section class="adm-card" aria-labelledby="jf-h"><h2 id="jf-h">上架與異動表單</h2>
  <form id="jf-form" class="adm-form" novalidate>
    <div class="adm-field"><label for="jf-pick">要處理的職缺</label><select id="jf-pick"><option value="new">＋ 新增職缺</option>${jobs.map((j) => html`<option value="${j.id}">${j.title}（${JOB_STAGE_LABELS[jobStage(site, j)] ?? jobStage(site, j)}）</option>`)}</select>
      <span class="adm-hint">選既有職缺＝帶入全部欄位（id 與 slug 鎖定不可改）；選「新增職缺」＝空白表單，公告日為今天（${site.today}）。</span></div>

    <fieldset class="adm-fieldset adm-jf-sec" id="jf-a"><legend>A 公告內容</legend>
      <div class="adm-jf-stack">
        ${text('jf-title', '職缺名稱（title）', { ph: '例：疫情中心徵求計畫助理 2 名' })}
        ${field('jf-summary', '摘要（summary，一兩句話）', html`<textarea id="jf-summary" rows="2" maxlength="200"></textarea>`)}
      </div>
      <div class="adm-grid adm-grid--2 adm-jf-grid">
        ${field('jf-slug', '網址代稱（slug）', html`<input type="text" id="jf-slug" placeholder="例：research-assistant-epi" pattern="[a-z0-9][a-z0-9-]*" autocomplete="off" spellcheck="false">`, '小寫英文、數字與連字號；前台網址 /careers/{slug}/。新增時必填，建立後不可改。')}
        ${text('jf-refno', '公告字號（選填）', { ph: '疾管人字第 1150100000 號' })}
        ${field('jf-unit', '用人單位', html`<select id="jf-unit"><option value="">請選擇</option>${site.master.units.map((u) => html`<option value="${u.id}">${u.name}</option>`)}</select>`)}
        ${field('jf-type', '職類', html`<select id="jf-type"><option value="">請選擇</option>${JOB_TYPES.map((t) => html`<option value="${t}">${t}</option>`)}</select>`)}
        ${field('jf-positions', '名額', html`<input type="number" id="jf-positions" min="1" step="1" inputmode="numeric">`, '正取人數上限；正取超過名額會被擋下。')}
        ${text('jf-workplace', '工作地點', { ph: '縣市開頭，例：臺北市中正區林森南路 6 號' })}
      </div>
      ${text('jf-salary', '薪資待遇（文字）', { ph: '比照…薪點起敘（依學經歷核定）' })}
      ${area('jf-qual', '資格條件', '每行一項。')}
      ${area('jf-duties', '工作內容', '每行一項。')}
      ${area('jf-docs', '應備文件', '每行一項；只列名稱，報名者的檔案絕不放進 repo。')}
      <div class="adm-grid adm-grid--2 adm-jf-grid">
        ${date('jf-start', '報名開始日')}
        ${date('jf-deadline', '報名截止日', '當日仍可報名，隔日自動轉「已截止」。')}
        ${field('jf-method', '報名方式', html`<select id="jf-method">${Object.entries(APPLY_METHODS).map(([k, v]) => html`<option value="${k}">${v}</option>`)}</select>`)}
        ${text('jf-applyurl', '外部報名網址（選填）', { ph: 'https://…', hint: '留空＝本站（模擬）報名頁；正式站請填外部報名系統。' })}
      </div>
      <div class="adm-field"><span class="adm-label" id="jf-exam-l">甄試方式與日期</span>
        <div class="adm-tablewrap" role="region" tabindex="0" aria-label="表格，可捲動"><table class="adm-table adm-jf-rows" aria-labelledby="jf-exam-l"><thead><tr><th scope="col">階段</th><th scope="col">日期</th><th scope="col">備註</th><th scope="col"><span class="sr-only">刪除</span></th></tr></thead><tbody id="jf-exam"></tbody></table></div>
        <p><button type="button" class="adm-btn adm-btn--ghost adm-btn--sm" id="jf-exam-add">＋ 加一個階段</button></p>
        <span class="adm-hint">甄試日期不得早於報名截止日；日期未定可留空（前台顯示「日期另行公告」）。</span></div>
      <div class="adm-grid adm-grid--2 adm-jf-grid">
        ${date('jf-resultplan', '結果預計公布日', '超過此日 7 天仍無結果，會產生待辦。')}
        ${text('jf-contact', '聯絡窗口', { ph: '人事室（02）2395-9825 轉分機', hint: '單位與總機轉分機；不放承辦人姓名。' })}
      </div>
      ${area('jf-att', '附件（選填）', '每行一筆：標題 | 網址 | 格式，例：甄選簡章（PDF） | /pending/?ref=…&doc=甄選簡章 | pdf')}
    </fieldset>

    <fieldset class="adm-fieldset adm-jf-sec" id="jf-b"><legend>B 時程異動（延長報名、改甄試日、改結果公布日）</legend>
      <p class="adm-hint" id="jf-b-hint">先在 A 區改日期，這裡會列出新舊對照；再寫一句給民眾看的說明，按「加入異動紀錄」。類型自動判定：截止日變晚＝展延，其他日期變動＝改期，日期都沒變只有說明＝更正。</p>
      <div id="jf-b-diff" aria-live="polite"></div>
      <div class="adm-grid adm-grid--2 adm-jf-grid">
        ${text('jf-am-text', '異動說明（給民眾看的一句話）', { max: '300', ph: '留空＝用上面的新舊日期對照文字' })}
        ${text('jf-am-ref', '異動公告字號（選填）', { ph: '疾管人字第 1150100000 號' })}
      </div>
      <p><button type="button" class="adm-btn adm-btn--sm" id="jf-am-add">加入異動紀錄</button> <span class="adm-muted" id="jf-am-msg" role="status" aria-live="polite"></span></p>
      <div class="adm-field"><span class="adm-label" id="jf-am-l">異動紀錄（amendments，依加入順序；前台依日期新到舊顯示）</span>
        <div class="adm-tablewrap" role="region" tabindex="0" aria-label="表格，可捲動"><table class="adm-table adm-jf-rows" aria-labelledby="jf-am-l"><thead><tr><th scope="col">日期</th><th scope="col">類型</th><th scope="col">說明</th><th scope="col">字號</th><th scope="col"><span class="sr-only">刪除</span></th></tr></thead><tbody id="jf-am-list"></tbody></table></div>
        <span class="adm-hint">已上線的紀錄請不要刪除；寫錯就加一筆「更正」。</span></div>
    </fieldset>

    <fieldset class="adm-fieldset adm-jf-sec" id="jf-c"><legend>C 取消／補實</legend>
      <div class="adm-pills adm-pills--col" role="radiogroup" aria-label="人工覆蓋狀態">${Object.entries(MANUAL_STATUS).map(([k, v]) => html`<label class="adm-pill"><input type="radio" name="jf-ms" value="${k}" ${k === '' ? 'checked' : ''}><span>${v}</span></label>`)}</div>
      ${text('jf-ms-note', '理由（manualStatusNote）', { ph: '例：因員額調整停止甄選' })}
      <p class="adm-hint">選「停止甄選」或「已補實」時，會自動追加一筆「取消」異動紀錄（文字可在 B 區表格內修改）。已停止甄選的職缺不得有甄選結果。</p>
    </fieldset>

    <fieldset class="adm-fieldset adm-jf-sec" id="jf-d"><legend>D 甄選結果（錄取名單）</legend>
      <label class="adm-pill" style="width:fit-content"><input type="checkbox" id="jf-has-result"><span>公告甄選結果</span></label>
      <div id="jf-result" hidden>
        <div class="adm-grid adm-grid--2 adm-jf-grid">
          ${date('jf-r-date', '結果公告日')}
          ${text('jf-r-ref', '結果公告字號（選填）')}
        </div>
        <div class="adm-box adm-box--note" role="note"><strong>只公布報名編號與遮罩姓名</strong>姓名只留姓與最後一字，中間以 ○ 遮罩（例：王○明、林○）；報名編號不得是身分證字號。檢核規則與建置完全相同。</div>
        <div class="adm-field"><span class="adm-label" id="jf-adm-l">正取</span>
          <div class="adm-tablewrap" role="region" tabindex="0" aria-label="表格，可捲動"><table class="adm-table adm-jf-rows" aria-labelledby="jf-adm-l"><thead><tr><th scope="col">序號</th><th scope="col">報名編號</th><th scope="col">遮罩姓名</th><th scope="col"><span class="sr-only">刪除</span></th></tr></thead><tbody id="jf-admitted"></tbody></table></div>
          <p><button type="button" class="adm-btn adm-btn--ghost adm-btn--sm" id="jf-admitted-add">＋ 正取一列</button> <span class="adm-muted" id="jf-cap" aria-live="polite"></span></p></div>
        <div class="adm-field"><span class="adm-label" id="jf-wl-l">備取</span>
          <div class="adm-tablewrap" role="region" tabindex="0" aria-label="表格，可捲動"><table class="adm-table adm-jf-rows" aria-labelledby="jf-wl-l"><thead><tr><th scope="col">順位</th><th scope="col">報名編號</th><th scope="col">遮罩姓名</th><th scope="col">有效至</th><th scope="col"><span class="sr-only">刪除</span></th></tr></thead><tbody id="jf-waitlist"></tbody></table></div>
          <p><button type="button" class="adm-btn adm-btn--ghost adm-btn--sm" id="jf-waitlist-add">＋ 備取一列</button></p></div>
        ${area('jf-r-note', '報到須知（選填）', '不得含姓名或身分證字號。')}
        <div class="adm-field"><span class="adm-label" id="jf-wlu-l">遞補公告（waitlistUpdates）</span>
          <div class="adm-tablewrap" role="region" tabindex="0" aria-label="表格，可捲動"><table class="adm-table adm-jf-rows" aria-labelledby="jf-wlu-l"><thead><tr><th scope="col">日期</th><th scope="col">報名編號</th><th scope="col">遮罩姓名</th><th scope="col">說明</th><th scope="col"><span class="sr-only">刪除</span></th></tr></thead><tbody id="jf-wlu"></tbody></table></div>
          <p><button type="button" class="adm-btn adm-btn--ghost adm-btn--sm" id="jf-wlu-add">＋ 新增遞補公告</button></p>
          <span class="adm-hint">正取放棄時加一筆；不要改動原有正取名單，以保留公告歷程。</span></div>
        <div id="jf-pii" aria-live="polite"></div>
      </div>
    </fieldset>

    <div class="adm-actions"><button type="button" class="adm-btn" id="jf-save">儲存草稿（本機）</button><button type="button" class="adm-btn adm-btn--ghost" id="jf-reset">放棄草稿、重新帶入</button></div>
    <p class="adm-muted" id="jf-msg" role="status" aria-live="polite"></p>
  </form></section>
<div class="adm-jf-aside">
<section class="adm-card" aria-labelledby="jp-h"><h2 id="jp-h">預覽與檢核</h2>
  <div id="jf-preview" aria-live="polite"></div>
  <div id="jf-warn"></div></section>
<section class="adm-card" aria-labelledby="je-h"><h2 id="je-h">匯出</h2>
  <p>存成：<code id="jf-file">content/jobs/…</code></p>
  <pre class="adm-pre" id="jf-out" tabindex="0">{ }</pre>
  <div class="adm-actions"><button type="button" class="adm-btn" id="jf-copy">複製</button><button type="button" class="adm-btn adm-btn--ghost" id="jf-dl">下載 .json</button></div>
  <ol class="adm-jf-steps">
    <li>新增職缺：把下載的檔案放到 <code>content/jobs/</code>（檔名照上面）；既有職缺：整份覆蓋同名檔。</li>
    <li>開 Pull Request。職缺走<strong>快車道</strong>：CI（schema、日期先後、個資閘門）全過就自動合併，約 3 分鐘上線。</li>
    <li>上線後 24 小時內完成上線後複核（<code>post-publish-review</code> 待辦給公關室，副本人事室）；小錯直接再改一版。</li>
  </ol>
  <p class="adm-muted">草稿只存在這台電腦的瀏覽器（localStorage <code>cdc.admin.jobs-edit</code>），不會送出任何資料。</p></section>
</div></div>
${dataScript('adm-jobs-data', data)}`;
}
