// /admin/publish/ 上架新內容＋預處理（規格 6.5、wireframe 第 5 頁）。互動邏輯在 src/client/admin/publish.js 與 preprocess.js。
import { html, raw } from '../../../scripts/lib/render.mjs';
import { config } from '../../../site.config.mjs';
import { pageHead, dataScript, adminMeta, unitOptions, DEFAULT_UNIT, LANGS } from './_partials.mjs';
import { TYPES as PP_TYPES, LANGS as PP_LANGS } from '../../client/admin/preprocess.js';
export { layout } from './_layout.mjs';

const TYPES = PP_TYPES.map((t) => [t.value, t.label]);
const CAPTION_LANGS = PP_LANGS;
const WHO = ['民眾', '醫療院所', '研究者', '地方衛生局', '學校與托育機構', '長照與安養機構', '出國旅客', '新聞媒體'].map((l) => [l, l]);
const LABS = [['cdc-lab', '疾管署實驗室'], ['certified-lab', '認可檢驗機構'], ['hospital-lab', '醫院檢驗室'], ['regional-lab', '區管中心實驗室']];
const TASKS = [['symptoms', '有症狀怎麼辦'], ['vaccines', '疫苗與預防接種'], ['travel', '出國與入境'], ['situation', '現在的疫情'], ['rumor', '謠言查證'], ['data', '開放資料與統計']];

export function pages() { return [{ path: '/admin/publish/', props: {}, noindex: true }]; }
export function meta() { return adminMeta('上架新內容', 'publish', ['/assets/js/admin/publish.js']); }

export function render(ctx) {
  const { site } = ctx;
  const docs = site.collections.documents;
  const families = [...new Set(docs.map((d) => d.family))].map((f) => {
    const vs = docs.filter((d) => d.family === f).sort((a, b) => b.effectiveAt.localeCompare(a.effectiveAt));
    return { family: f, title: vs[0].title.replace(/（.*版）$/, ''), versions: vs.map((v) => ({ id: v.id, version: v.version, effectiveAt: v.effectiveAt, isCurrent: !!v.gov?.isCurrent, title: v.title, url: `${config.siteUrl}${config.basePath}/documents/${String(v.id).replace(/^[a-z]+\./, '')}/` })) };
  });
  const data = {
    today: site.today,
    units: site.master.units.filter((u) => u.publishes !== false).map((u) => ({ id: u.id, name: u.name })),
    reviewPeriods: site.master.reviewPeriods,
    vaccinesMaster: site.master.vaccines,
    diseaseMaster: site.master.diseases.map((d) => ({ id: d.id, slug: d.slug, name: d.name, nameEn: d.nameEn, legalCategory: d.legalCategory, notifyWithinHours: d.notifyWithinHours ?? null })),
    catalog: site.all.map((i) => ({ id: i.id, type: i.type, title: i.title, owner: i.owner })),
    siteBase: `${config.siteUrl}${config.basePath}`,
    families,
  };
  return html`
${pageHead({
    title: '上架新內容：預處理與送複核',
    what: '承辦人貼上中文正本，系統在瀏覽器內做「上架預處理」：抽關鍵字與實體、擬摘要、抽結構化欄位、檢查與主檔／現行版的一致性、列出多語術語鎖定。結果全部是建議，需人工確認後才送複核。第二輪新增八種型別：影音（必填依據正本與逐字稿，對逐字稿做反向稽核）、專區、申請服務、出版品、檢驗項目、研究計畫、人才招募、採購公告。',
    flow: '承辦人在此產出符合 schemas/ 的 content JSON → 放進 content/ 並開 Pull Request → CI 驗證 schema、治理規則與評估集 → 公關室內容審核、多語審核 → 合併即發布七語頁面、索引與 API。',
  })}
<div class="adm-split">
  <section class="adm-card" aria-labelledby="pub-h">
    <h2 id="pub-h" data-pub-title>上架：疾病 Q&amp;A</h2>
    <form id="pub-form" class="adm-form" novalidate autocomplete="off">
      <div class="adm-field"><label for="f-type">型別</label>
        <select id="f-type" name="type">${TYPES.map(([v, l]) => html`<option value="${v}">${l}</option>`)}</select></div>
      <div class="adm-field"><label for="f-title">標題</label><input type="text" id="f-title" name="title" placeholder="例：登革熱發燒後幾天內要就醫？"></div>
      <div class="adm-field"><label for="f-body" id="f-body-label">內文（中文正本）</label><textarea id="f-body" name="body" placeholder="貼上 Markdown 或純文字"></textarea>
        <span class="adm-counter" id="f-body-count" aria-live="off">0 字</span></div>
      <div class="adm-row">
        <div class="adm-field" style="flex:1 1 200px"><label for="f-owner">權責單位</label><select id="f-owner" name="owner">${unitOptions(site, { all: false, selected: DEFAULT_UNIT })}</select></div>
        <div class="adm-field" style="flex:0 1 150px"><label for="f-period">審閱週期（月）</label><input type="number" id="f-period" name="period" min="0" max="60" value="6"><span class="adm-hint" id="f-period-hint">依型別預設；0＝事件觸發</span></div>
      </div>
      <fieldset class="adm-fieldset"><legend>對象</legend>
        <div class="adm-pills" id="f-audience"><label class="adm-pill"><input type="checkbox" name="audience" value="public" checked><span>民眾</span></label><label class="adm-pill"><input type="checkbox" name="audience" value="professional"><span>專業人員</span></label></div></fieldset>
      <fieldset class="adm-fieldset"><legend>任務入口（可複選）</legend>
        <div class="adm-pills" id="f-tasks">${TASKS.map(([v, l]) => html`<label class="adm-pill"><input type="checkbox" name="tasks" value="${v}"><span>${l}</span></label>`)}</div></fieldset>
      <div class="adm-field"><label for="f-based-q">依據正本（搜尋現有內容 id 或文件 family，可多個）<span class="adm-req" id="f-based-req" hidden> · 此型別必填</span></label>
        <input type="search" id="f-based-q" role="combobox" aria-expanded="false" aria-controls="f-based-list" aria-autocomplete="list" placeholder="輸入 id、標題或 family，例：mmr">
        <ul class="adm-search-results" id="f-based-list" role="listbox" hidden></ul>
        <ul class="adm-chips" id="f-based-chips" aria-label="已選依據正本"></ul>
        <span class="adm-hint">新聞稿、Q&amp;A、影片、衍生內容都要填；正本修訂時由此產生待辦並自動加註。</span></div>
      <fieldset class="adm-fieldset" id="f-extra" hidden><legend>型別專屬欄位</legend>
        <div class="adm-grid adm-grid--2">
          <div class="adm-field" data-for="document"><label for="x-family">文件 family</label><input type="text" id="x-family" list="x-family-list" placeholder="doc.mmr-recommendation"><datalist id="x-family-list">${families.map((f) => html`<option value="${f.family}">${f.title}</option>`)}</datalist></div>
          <div class="adm-field" data-for="document"><label for="x-doctype">文件類型</label><select id="x-doctype">${[['recommendation', '建議／指引'], ['guideline', '指引'], ['manual', '手冊'], ['case-definition', '病例定義'], ['form', '表單']].map(([v, l]) => html`<option value="${v}">${l}</option>`)}</select></div>
          <div class="adm-field" data-for="document"><label for="x-version">版次</label><input type="text" id="x-version" placeholder="114.04.16"></div>
          <div class="adm-field" data-for="document"><label for="x-effective">生效日</label><input type="date" id="x-effective"></div>
          <div class="adm-field" data-for="document"><label for="x-supersedes">取代哪一版</label><select id="x-supersedes"><option value="">（無，首版）</option></select><span class="adm-hint">新版 published 後，舊版由引擎自動標示失效、noindex、退出 AI 白名單。</span></div>
          <div class="adm-field" data-for="letter"><label for="x-letterno">通函號</label><input type="text" id="x-letterno" placeholder="例：560"></div>
          <div class="adm-field" data-for="clarification"><label for="x-claim">網傳訊息原文（去個資）</label><input type="text" id="x-claim"></div>
          <div class="adm-field" data-for="clarification"><label for="x-verdict">查證結果</label><select id="x-verdict">${[['false', '不實'], ['partly-true', '部分屬實'], ['outdated', '已過時'], ['true', '屬實']].map(([v, l]) => html`<option value="${v}">${l}</option>`)}</select></div>
          <div class="adm-field" data-for="clarification"><label for="x-share">可轉傳短訊（≤ 300 字）</label><input type="text" id="x-share" maxlength="300"></div>
          <div class="adm-field" data-for="disease"><label for="x-disease">對應傳染病主檔</label><select id="x-disease"><option value="">（請選擇）</option>${site.master.diseases.map((d) => html`<option value="${d.id}">${d.name}（${d.id}）</option>`)}</select></div>
          <div class="adm-field" data-for="vaccine"><label for="x-vaccine">對應疫苗主檔</label><select id="x-vaccine"><option value="">（請選擇）</option>${site.master.vaccines.map((v) => html`<option value="${v.id}">${v.name}（${v.id}）</option>`)}</select></div>
          <div class="adm-field" data-for="media"><label for="x-mediatype">影音類型</label><select id="x-mediatype">${[['video', '影片'], ['animation', '動畫'], ['podcast', 'Podcast'], ['short', '短影音']].map(([v, l]) => html`<option value="${v}">${l}</option>`)}</select></div>
          <div class="adm-field" data-for="media"><label for="x-ytid">YouTube id 或網址（可空）</label><input type="text" id="x-ytid" placeholder="例：dQw4w9WgXcQ"><span class="adm-hint">空白＝前台顯示示意海報；貼完整網址會自動取 id。</span></div>
          <div class="adm-field" data-for="media"><label for="x-produced">製作日期（必填）</label><input type="date" id="x-produced"><span class="adm-hint">與依據正本現行版的生效日比對；早於生效日＝紅框。</span></div>
          <div class="adm-field" data-for="media"><label for="x-vlabel">依據版本標示</label><input type="text" id="x-vlabel" placeholder="例：114.04.16 建議"><span class="adm-hint">畫面與說明欄印出的「依 … 版製作」。</span></div>
          <div class="adm-field adm-field--wide" data-for="media"><label for="x-chapters">章節（每行「秒數 標題」，也可寫 1:30）</label><textarea id="x-chapters" class="adm-ta-sm" placeholder="0 開場&#10;45 誰需要評估接種&#10;130 怎麼接種"></textarea></div>
          <div class="adm-field adm-field--wide" data-for="media"><label for="x-transcript">逐字稿（必填，進索引與反向稽核）</label><textarea id="x-transcript" placeholder="貼上完整逐字稿，每行一段。系統會對逐字稿做實體抽取、反向稽核、數字一致性。"></textarea><span class="adm-counter" id="x-transcript-count" aria-live="off">0 字</span></div>
          <fieldset class="adm-fieldset adm-field--wide" data-for="media"><legend>字幕語言（有字幕者勾選）</legend><div class="adm-pills" id="x-captions">${CAPTION_LANGS.map((l) => html`<label class="adm-pill"><input type="checkbox" name="captions" value="${l.code}"><span>${l.label}</span></label>`)}</div></fieldset>

          <div class="adm-field" data-for="topic"><label for="x-topickind">專區類型</label><select id="x-topickind">${[['campaign', '宣導專題'], ['resource-hub', '資源彙整'], ['program', '計畫方案'], ['emergency', '緊急防災']].map(([v, l]) => html`<option value="${v}">${l}</option>`)}</select></div>
          <div class="adm-field" data-for="topic"><label for="x-startat">開始日</label><input type="date" id="x-startat"></div>
          <div class="adm-field" data-for="topic"><label for="x-endat">結束日（可空）</label><input type="date" id="x-endat"><span class="adm-hint">有填則到期自動從首頁專區列退場。</span></div>
          <div class="adm-field adm-field--wide" data-for="topic"><label for="x-links">連結列（每行「標題 | 網址 | 備註(選填)」）</label><textarea id="x-links" class="adm-ta-sm" placeholder="防災避難須知 | https://example.gov.tw/shelter&#10;疾病介紹 | /diseases/dengue/"></textarea><span class="adm-hint">https:// 開頭自動判為外部連結，由 CI 每日檢查；/ 開頭為站內。</span></div>
          <div class="adm-field adm-field--wide" data-for="topic"><label for="x-content-q">相關內容（搜尋站內 id 或標題）</label><input type="search" id="x-content-q" role="combobox" aria-expanded="false" aria-controls="x-content-list" aria-autocomplete="list" placeholder="例：dengue"><ul class="adm-search-results" id="x-content-list" role="listbox" hidden></ul><ul class="adm-chips" id="x-content-chips" aria-label="已選相關內容"></ul></div>

          <div class="adm-field" data-for="service"><label for="x-servicetype">服務類型</label><select id="x-servicetype">${[['data-request', '資料申請'], ['lab-request', '檢驗委託'], ['certificate', '證明文件'], ['donation', '捐款'], ['clinic', '門診'], ['notification', '通報'], ['license', '許可'], ['other', '其他']].map(([v, l]) => html`<option value="${v}">${l}</option>`)}</select></div>
          <fieldset class="adm-fieldset" data-for="service"><legend>對象（可複選）</legend><div class="adm-pills" id="x-who">${WHO.map(([v, l]) => html`<label class="adm-pill"><input type="checkbox" name="who" value="${v}"><span>${l}</span></label>`)}</div></fieldset>
          <div class="adm-field adm-field--wide" data-for="service"><label for="x-steps">步驟（每行「標題 | 說明 | 誰 | 天」，天為整數）</label><textarea id="x-steps" class="adm-ta-sm" placeholder="填寫申請書 | 下載表單並填寫 | 申請人 | 1&#10;審查 | 資料治理小組審查 | 承辦單位 | 7"></textarea></div>
          <div class="adm-field adm-field--wide" data-for="service"><label for="x-docs">應備文件（每行一項）</label><textarea id="x-docs" class="adm-ta-sm"></textarea></div>
          <div class="adm-field" data-for="service"><label for="x-sla">承諾處理天數</label><input type="number" id="x-sla" min="0"></div>
          <div class="adm-field" data-for="service"><label for="x-fee">費用</label><input type="text" id="x-fee" placeholder="例：免費"></div>
          <div class="adm-field adm-field--wide" data-for="service"><label for="x-legal">法源（每行一項）</label><textarea id="x-legal" class="adm-ta-sm" placeholder="傳染病防治法第 9 條"></textarea></div>
          <div class="adm-field adm-field--wide" data-for="service"><label for="x-forms">表單（每行「標題 | 網址 | 格式」）</label><textarea id="x-forms" class="adm-ta-sm" placeholder="資料申請書 | https://example.gov.tw/form.odt | odt"></textarea></div>
          <div class="adm-field" data-for="service"><label for="x-applyurl">線上申請網址（可空）</label><input type="text" id="x-applyurl"></div>
          <div class="adm-field" data-for="service"><label for="x-contact">聯絡窗口</label><input type="text" id="x-contact" placeholder="例：1922 或單位信箱"></div>

          <div class="adm-field" data-for="publication"><label for="x-pubtype">出版品類型</label><select id="x-pubtype">${[['bulletin', '疫情報導'], ['annual-report', '年報'], ['manual', '手冊'], ['poster', '海報'], ['book', '專書'], ['multimedia', '多媒體'], ['statistics', '統計']].map(([v, l]) => html`<option value="${v}">${l}</option>`)}</select></div>
          <div class="adm-field" data-for="publication"><label for="x-series">系列（必填）</label><input type="text" id="x-series" placeholder="例：疫情報導"></div>
          <div class="adm-field" data-for="publication"><label for="x-volume">卷</label><input type="text" id="x-volume"></div>
          <div class="adm-field" data-for="publication"><label for="x-issue">期</label><input type="text" id="x-issue"></div>
          <div class="adm-field" data-for="publication"><label for="x-edition">版次</label><input type="text" id="x-edition" placeholder="例：初版"></div>
          <div class="adm-field" data-for="publication"><label for="x-isbn">ISBN</label><input type="text" id="x-isbn"></div>
          <div class="adm-field" data-for="publication"><label for="x-issn">ISSN</label><input type="text" id="x-issn" placeholder="NNNN-NNNN"></div>
          <div class="adm-field" data-for="publication"><label for="x-gpn">GPN</label><input type="text" id="x-gpn" placeholder="10 碼"></div>
          <div class="adm-field adm-field--wide" data-for="publication"><label for="x-articles">篇目（每行「篇名 | 作者(、分隔) | 頁碼」）</label><textarea id="x-articles" class="adm-ta-sm"></textarea></div>

          <div class="adm-field" data-for="labtest"><label for="x-labdisease">疾病（傳染病主檔）</label><select id="x-labdisease"><option value="">（請選擇）</option>${site.master.diseases.map((d) => html`<option value="${d.id}">${d.name}（${d.id}）</option>`)}</select></div>
          <div class="adm-field" data-for="labtest"><label for="x-sendhours">送驗時限（小時）</label><input type="number" id="x-sendhours" min="0"><span class="adm-hint" id="x-sendhours-hint">超過主檔通報時限時會警告。</span></div>
          <fieldset class="adm-fieldset adm-field--wide" data-for="labtest"><legend>檢驗單位（至少一個）</legend><div class="adm-pills" id="x-labs">${LABS.map(([v, l]) => html`<label class="adm-pill"><input type="checkbox" name="labs" value="${v}"><span>${l}</span></label>`)}</div></fieldset>
          <div class="adm-field adm-field--wide" data-for="labtest"><label for="x-specimens">檢體（每行「名稱 | 容器 | 量 | 保存 | 運送 | 時機 | 檢驗」，前五欄必填，檢驗以「、」分隔）</label><textarea id="x-specimens" placeholder="急性期血清 | 血清分離管 | 2–5 mL | 4°C 冷藏 | 48 小時內冷藏送達 | 發病 7 日內 | NS1 抗原、RT-PCR"></textarea></div>

          <div class="adm-field" data-for="research"><label for="x-year">年度（西元）</label><input type="number" id="x-year" min="1990" max="2100" placeholder="2026"></div>
          <div class="adm-field" data-for="research"><label for="x-projstatus">計畫狀態</label><select id="x-projstatus">${[['planned', '規劃中'], ['ongoing', '進行中'], ['completed', '已完成'], ['published', '已發表']].map(([v, l]) => html`<option value="${v}">${l}</option>`)}</select></div>
          <div class="adm-field" data-for="research"><label for="x-funding">經費類型</label><select id="x-funding"><option value="">（不填）</option>${[['commissioned', '委託'], ['in-house', '自行研究'], ['collaborative', '合作'], ['international', '國際']].map(([v, l]) => html`<option value="${v}">${l}</option>`)}</select></div>
          <div class="adm-field" data-for="research"><label for="x-projno">計畫編號</label><input type="text" id="x-projno"></div>
          <div class="adm-field adm-field--wide" data-for="research"><label for="x-piunit">執行機構（機構名稱，不放個人姓名）</label><input type="text" id="x-piunit" placeholder="例：國立臺灣大學公共衛生學院"></div>
          <div class="adm-field adm-field--wide" data-for="research"><label for="x-ds-q">資料集（搜尋 dataset id）</label><input type="search" id="x-ds-q" role="combobox" aria-expanded="false" aria-controls="x-ds-list" aria-autocomplete="list" placeholder="例：dengue"><ul class="adm-search-results" id="x-ds-list" role="listbox" hidden></ul><ul class="adm-chips" id="x-ds-chips" aria-label="已選資料集"></ul></div>

          <div class="adm-field" data-for="recruit procurement"><label for="x-deadline">截止日（必填）</label><input type="date" id="x-deadline"><span class="adm-hint">截止後系統自動標「已截止」並退出首頁，無須人工。</span></div>
          <div class="adm-field" data-for="recruit procurement"><label for="x-refno">字號／案號</label><input type="text" id="x-refno" placeholder="例：疾管人字第 1150000000 號"></div>
          <div class="adm-field" data-for="recruit procurement"><label for="x-napply">報名／投標網址</label><input type="text" id="x-napply" placeholder="https://…"></div>
          <div class="adm-field" data-for="recruit"><label for="x-positions">名額</label><input type="number" id="x-positions" min="0"></div>
          <div class="adm-field" data-for="procurement"><label for="x-budget">預算（新臺幣元）</label><input type="number" id="x-budget" min="0"></div>
        </div></fieldset>
      <fieldset class="adm-fieldset"><legend>提供語言</legend>
        <div class="adm-langs" id="f-langs">${LANGS.map((l) => html`<div class="adm-lang"><label><input type="checkbox" name="lang" value="${l.code}" ${l.code === 'zh-TW' ? raw('checked disabled') : ''}> ${l.label}${l.code === 'zh-TW' ? '（正本）' : ''}</label>${l.code === 'zh-TW' ? '' : html`<input type="text" data-reason="${l.code}" hidden placeholder="取消理由（必填）" aria-label="${l.label} 取消提供的理由">`}</div>`)}</div>
        <span class="adm-hint" id="f-langs-hint">依型別預設勾選；取消勾選須填理由。</span></fieldset>
      <div class="adm-field"><label for="f-id">內容 ID（自動產生，可修改）</label><input type="text" id="f-id" placeholder="faq.xxx"></div>
      <div class="adm-actions">
        <button type="submit" class="adm-btn" id="btn-submit">送出預處理</button>
        <button type="button" class="adm-btn adm-btn--ghost" id="btn-save">儲存草稿</button>
        <button type="button" class="adm-btn adm-btn--ghost" id="btn-sample">載入範例</button>
        <button type="button" class="adm-btn adm-btn--ghost" id="btn-clear">清空表單</button>
      </div>
      <p class="adm-muted" id="f-status" role="status" aria-live="polite"></p>
    </form>
  </section>

  <section class="adm-result" aria-labelledby="pre-h">
    <div class="adm-result__head"><h2 id="pre-h" style="margin:0;font-size:var(--fs-md)">自動預處理結果 · <span id="pre-sec">尚未送出</span> · 全部需人工確認</h2></div>
    <div class="adm-result__body" id="pre-result" tabindex="-1" aria-live="polite" aria-busy="false">
      <p class="adm-muted">在左側填寫內文後按「送出預處理」。預處理在你的瀏覽器內執行，不會把內文送到任何伺服器；只有啟用 LLM 模式（BYOK）的多語初稿才會呼叫你自己的 API key。</p>
    </div>
  </section>
</div>
${dataScript('adm-publish-data', data)}`;
}
