// /admin/publish/ 上架新內容＋預處理（規格 6.5、wireframe 第 5 頁）。互動邏輯在 src/client/admin/publish.js 與 preprocess.js。
import { html, raw } from '../../../scripts/lib/render.mjs';
import { pageHead, dataScript, adminMeta, unitOptions, DEFAULT_UNIT, LANGS } from './_partials.mjs';
export { layout } from './_layout.mjs';

const TYPES = [['faq', 'Q&A'], ['disease', '疾病頁'], ['news', '新聞稿'], ['letter', '致醫界通函'], ['document', '文件新版'], ['clarification', '澄清'], ['vaccine', '疫苗頁']];
const TASKS = [['symptoms', '有症狀怎麼辦'], ['vaccines', '疫苗與預防接種'], ['travel', '出國與入境'], ['situation', '現在的疫情'], ['rumor', '謠言查證'], ['data', '開放資料與統計']];

export function pages() { return [{ path: '/admin/publish/', props: {}, noindex: true }]; }
export function meta() { return adminMeta('上架新內容', 'publish', ['/assets/js/admin/publish.js']); }

export function render(ctx) {
  const { site } = ctx;
  const docs = site.collections.documents;
  const families = [...new Set(docs.map((d) => d.family))].map((f) => {
    const vs = docs.filter((d) => d.family === f).sort((a, b) => b.effectiveAt.localeCompare(a.effectiveAt));
    return { family: f, title: vs[0].title.replace(/（.*版）$/, ''), versions: vs.map((v) => ({ id: v.id, version: v.version, effectiveAt: v.effectiveAt, isCurrent: !!v.gov?.isCurrent, title: v.title })) };
  });
  const data = {
    today: site.today,
    units: site.master.units.map((u) => ({ id: u.id, name: u.name })),
    reviewPeriods: site.master.reviewPeriods,
    vaccinesMaster: site.master.vaccines,
    diseaseMaster: site.master.diseases.map((d) => ({ id: d.id, slug: d.slug, name: d.name, nameEn: d.nameEn, legalCategory: d.legalCategory })),
    catalog: site.all.map((i) => ({ id: i.id, type: i.type, title: i.title, owner: i.owner })),
    families,
  };
  return html`
${pageHead({
    title: '上架新內容：預處理與送複核',
    what: '承辦人貼上中文正本，系統在瀏覽器內做「上架預處理」：抽關鍵字與實體、擬摘要、抽結構化欄位、檢查與主檔／現行版的一致性、列出多語術語鎖定。結果全部是建議，需人工確認後才送複核。',
    flow: '承辦人在此產出符合 schemas/ 的 content JSON → 放進 content/ 並開 Pull Request → CI 驗證 schema、治理規則與評估集 → 公關室內容審核、多語審核 → 合併即發布七語頁面、索引與 API。',
  })}
<div class="adm-split">
  <section class="adm-card" aria-labelledby="pub-h">
    <h2 id="pub-h" data-pub-title>上架：疾病 Q&amp;A</h2>
    <form id="pub-form" class="adm-form" novalidate autocomplete="off">
      <div class="adm-field"><label for="f-type">型別</label>
        <select id="f-type" name="type">${TYPES.map(([v, l]) => html`<option value="${v}">${l}</option>`)}</select></div>
      <div class="adm-field"><label for="f-title">標題</label><input type="text" id="f-title" name="title" placeholder="例：登革熱發燒後幾天內要就醫？"></div>
      <div class="adm-field"><label for="f-body">內文（中文正本）</label><textarea id="f-body" name="body" placeholder="貼上 Markdown 或純文字"></textarea>
        <span class="adm-counter" id="f-body-count" aria-live="off">0 字</span></div>
      <div class="adm-row">
        <div class="adm-field" style="flex:1 1 200px"><label for="f-owner">權責單位</label><select id="f-owner" name="owner">${unitOptions(site, { all: false, selected: DEFAULT_UNIT })}</select></div>
        <div class="adm-field" style="flex:0 1 150px"><label for="f-period">審閱週期（月）</label><input type="number" id="f-period" name="period" min="0" max="60" value="6"><span class="adm-hint" id="f-period-hint">依型別預設；0＝事件觸發</span></div>
      </div>
      <fieldset class="adm-fieldset"><legend>對象</legend>
        <div class="adm-pills" id="f-audience"><label class="adm-pill"><input type="checkbox" name="audience" value="public" checked><span>民眾</span></label><label class="adm-pill"><input type="checkbox" name="audience" value="professional"><span>專業人員</span></label></div></fieldset>
      <fieldset class="adm-fieldset"><legend>任務入口（可複選）</legend>
        <div class="adm-pills" id="f-tasks">${TASKS.map(([v, l]) => html`<label class="adm-pill"><input type="checkbox" name="tasks" value="${v}"><span>${l}</span></label>`)}</div></fieldset>
      <div class="adm-field"><label for="f-based-q">依據正本（搜尋現有內容 id 或文件 family，可多個）</label>
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
