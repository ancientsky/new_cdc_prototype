// /admin/situation/ 態勢發布（規劃 6.4）：疫情中心人工發布四級狀態；預覽首頁卡；匯出 situation/current.json
import { html } from '../../../scripts/lib/render.mjs';
import { pageHead, adminMeta, dataScript, sitGov, unitOptions } from './_partials.mjs';
export { layout } from './_layout.mjs';

export function pages() { return [{ path: '/admin/situation/', props: {}, noindex: true }]; }
export function meta() { return adminMeta('態勢發布', 'situation', ['/assets/js/admin/situation.js']); }

const STATUS = { stable: '平穩', rising: '上升', peak: '高峰', declining: '下降' };
const TREND = { up: '上升 ↑', flat: '持平 →', down: '下降 ↓' };

export function render(ctx) {
  const { site, url } = ctx;
  const sit = site.situation;
  const sg = sitGov(site);
  const dn = (id) => site.diseaseMasterById.get(id)?.name ?? id;
  const hist = (sit.history ?? []).slice().sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''));
  const { history, ...current } = sit;
  const data = {
    today: site.today, current: Object.fromEntries(Object.entries(current).filter(([k]) => k !== '__file')),
    diseases: site.master.diseases.map((d) => ({ id: d.id, name: d.name, slug: d.slug })), units: site.master.units.filter((u) => u.publishes !== false).map((u) => ({ id: u.id, name: u.name })),
  };
  return html`
${pageHead({ title: '態勢發布', what: '疫情中心在這裡發布首頁的「現在的疫情」：每種疾病四級狀態、趨勢、指標、近週數字與一句話建議。狀態由疫情中心依既有監測門檻判定，不由模型推論；表單即時預覽首頁卡片。', flow: '填寫 → 匯出 situation/current.json（舊檔自動進 situation/history/）→ 疫情中心開 PR → CI 驗證 schema 與主檔 → 核定後合併即發布首頁、/situation/ 與 /v1/situation.json。' })}
<div class="adm-box ${sg.overdue ? 'adm-box--err' : 'adm-box--note'}"><strong>目前發布：${sg.publishedAt ?? '—'}（資料日 ${sg.dataDate ?? '—'}，距今 ${sg.lagDays ?? '—'} 日）</strong>下次審閱日 ${sg.nextReviewAt ?? '—'}${sg.overdue ? '，已逾期：前台態勢層會顯示「最後更新」警示，並已產生待辦給疫情中心。' : '。'}</div>
<div class="adm-split">
<section class="adm-card" aria-labelledby="sf-h"><h2 id="sf-h">發布表單</h2>
  <form id="s-form" class="adm-form" novalidate>
    <div class="adm-field"><label for="s-disease">疾病</label><select id="s-disease"></select><span class="adm-hint">選到已在目前發布清單中的疾病＝更新該筆；否則新增一筆。</span></div>
    <fieldset class="adm-fieldset"><legend>狀態（四級）</legend>
      <div class="adm-pills" role="radiogroup" aria-label="狀態">${Object.entries(STATUS).map(([k, v], i) => html`<label class="adm-pill"><input type="radio" name="s-status" value="${k}" ${i === 1 ? 'checked' : ''}><span>${v}</span></label>`)}</div>
      <p class="adm-hint">由疫情中心依既有監測門檻判定，不由模型推論。</p></fieldset>
    <div class="adm-field"><label for="s-trend">趨勢</label><select id="s-trend">${Object.entries(TREND).map(([k, v]) => html`<option value="${k}">${v}</option>`)}</select></div>
    <div class="adm-grid adm-grid--2"><div class="adm-field"><label for="s-mlabel">指標名稱</label><input type="text" id="s-mlabel" placeholder="本週新增本土病例"></div>
      <div class="adm-field"><label for="s-mvalue">指標值</label><input type="text" id="s-mvalue" placeholder="本土 23 例"></div></div>
    <div class="adm-field"><label for="s-delta">變化說明（選填）</label><input type="text" id="s-delta" placeholder="連續四週增加"></div>
    <div class="adm-field"><label for="s-weekly">近週數字（逗號分隔，舊→新）</label><input type="text" id="s-weekly" placeholder="4, 6, 9, 12, 17, 23"></div>
    <div class="adm-field"><label for="s-advice">一句話建議</label><input type="text" id="s-advice" maxlength="80"></div>
    <div class="adm-field"><label for="s-basis">依據門檻</label><input type="text" id="s-basis" placeholder="本土病例連續 4 週增加"><span class="adm-hint">寫疫情中心既有監測用語，會顯示在 /situation/ 的「發布依據」。</span></div>
    <div class="adm-grid adm-grid--3"><div class="adm-field"><label for="s-data">資料日</label><input type="date" id="s-data"></div>
      <div class="adm-field"><label for="s-next">下次審閱</label><input type="date" id="s-next"></div>
      <div class="adm-field"><label for="s-approver">核定人（職稱）</label><input type="text" id="s-approver" placeholder="疫情中心狀態發布負責人"></div></div>
    <label class="adm-pill" style="width:fit-content"><input type="checkbox" id="s-illu" checked><span>數字為示意（原型）</span></label>
    <div class="adm-actions"><button type="button" class="adm-btn" id="s-save">儲存表單（本機）</button><button type="button" class="adm-btn adm-btn--ghost" id="s-reset">以目前發布值重填</button></div>
    <p class="adm-muted" id="s-msg" role="status" aria-live="polite"></p>
  </form></section>
<div>
<section class="adm-card" aria-labelledby="sp-h"><h2 id="sp-h">首頁卡預覽</h2><div class="adm-preview" id="s-preview" aria-live="polite"></div>
  <div id="s-warn"></div></section>
<section class="adm-card" aria-labelledby="se-h"><h2 id="se-h">匯出</h2>
  <fieldset class="adm-fieldset"><legend>內容範圍</legend><div class="adm-pills"><label class="adm-pill"><input type="radio" name="s-scope" value="full" checked><span>整份 situation/current.json</span></label><label class="adm-pill"><input type="radio" name="s-scope" value="item"><span>僅本筆 item 片段</span></label></div></fieldset>
  <pre class="adm-pre" id="s-out" tabindex="0" style="margin-top:var(--sp-3)">{ }</pre>
  <div class="adm-actions"><button type="button" class="adm-btn" id="s-copy">複製</button><button type="button" class="adm-btn adm-btn--ghost" id="s-dl">下載 .json</button></div>
  <p class="adm-muted">正式環境：此檔取代 content/situation/current.json，舊檔移入 situation/history/ 後開 Pull Request。</p></section>
</div></div>

<section class="adm-card" aria-labelledby="sc-h"><h2 id="sc-h">目前 current.json</h2>
  <p class="adm-card__sub">發布者：${site.unitById.get(sit.publisher)?.name ?? sit.publisher}；核定：${sit.approvedBy ?? '—'}；來源：${sit.source}${sit.note ? ` · ${sit.note}` : ''}</p>
  <div class="adm-tablewrap"><table class="adm-table"><thead><tr><th scope="col">疾病</th><th scope="col">狀態</th><th scope="col">趨勢</th><th scope="col">指標</th><th scope="col">近週</th><th scope="col">建議</th><th scope="col">依據門檻</th></tr></thead>
  <tbody>${sit.items.map((it) => html`<tr><td><strong>${dn(it.disease)}</strong>${it.pinned ? html` <span class="adm-badge adm-badge--gray">首頁</span>` : ''}${it.illustrative ? html` <span class="adm-badge adm-badge--warn">示意</span>` : ''}</td>
    <td><span class="c-status-tag c-status-tag--${it.status}">${STATUS[it.status]}</span></td><td>${TREND[it.trend]}</td><td>${it.metricLabel}<div><strong>${it.metricValue}</strong>${it.deltaText ? ` · ${it.deltaText}` : ''}</div></td>
    <td>${(it.weekly ?? []).join('、')}</td><td>${it.advice}</td><td class="adm-muted">${it.basis}</td></tr>`)}</tbody></table></div>
  <h3>歷次發布</h3>
  ${hist.length ? html`<div class="adm-tablewrap"><table class="adm-table"><thead><tr><th scope="col">發布日</th><th scope="col">資料日</th><th scope="col">筆數</th><th scope="col">檔案</th></tr></thead><tbody>${hist.map((h) => html`<tr><td>${h.publishedAt}</td><td>${h.dataDate}</td><td>${(h.items ?? []).length}</td><td><code>${h.__file ?? ''}</code></td></tr>`)}</tbody></table></div>` : html`<p class="adm-muted">尚無歷次發布紀錄（content/situation/history/ 為空）。上一份正式檔案會在下次發布時移入。</p>`}
  <p class="adm-muted">前台：<a href="${url('/situation/')}">/situation/</a> · API：<a href="${url('/v1/situation.json', { noLang: true })}">/v1/situation.json</a></p></section>
${dataScript('adm-sit-data', data)}`;
}
