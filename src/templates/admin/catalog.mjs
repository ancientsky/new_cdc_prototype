// /admin/catalog/ 資料目錄（規劃 7.2）：五類資產＋新聞稿＋影音；Owner／Steward、正本位置、更新頻率、授權、敏感等級、AI 白名單
import { html } from '../../../scripts/lib/render.mjs';
import { pageHead, adminMeta, catalogRows, unitOptions, wlCell, CATEGORY_LABEL, FREQ_LABEL, SENS_LABEL, TYPE_LABEL, NEWS_SUBTYPE_LABEL } from './_partials.mjs';
export { layout } from './_layout.mjs';

export function pages() { return [{ path: '/admin/catalog/', props: {}, noindex: true }]; }
export function meta() { return adminMeta('資料目錄', 'catalog', ['/assets/js/admin/catalog.js']); }

const tick = (ok, yes, no) => html`<span class="adm-tick ${ok ? 'adm-tick--ok' : 'adm-tick--no'}" role="img" aria-label="${ok ? yes : no}">${ok ? '✓' : '✗'}</span> ${ok ? yes : no}`;
/** 類型專屬欄：影音＝逐字稿／依據現行版；專區＝外部連結健康；公告＝截止日。 */
function specific(r) {
  if (r.media) return html`<div>${tick(r.media.hasTranscript, `有逐字稿（${r.media.transcriptChars} 字）`, '無逐字稿')}</div><div>${tick(r.media.basisCurrent, '依據現行版', r.media.outdated ? '依據版本過時' : '未填依據正本')}</div>`;
  if (r.linkHealth) {
    const h = r.linkHealth;
    return h.total ? html`<span class="adm-linkcounts" aria-label="外部連結 ${h.total} 條"><span class="adm-badge adm-badge--ok">ok ${h.ok}</span><span class="adm-badge ${h.broken ? 'adm-badge--bad' : 'adm-badge--gray'}">broken ${h.broken}</span><span class="adm-badge adm-badge--gray">unchecked ${h.unchecked}</span></span>` : html`<span class="adm-muted">無外部連結</span>`;
  }
  if (r.notice) return html`${NEWS_SUBTYPE_LABEL[r.newsType]}${r.notice.deadlineAt ? html`<div class="${r.notice.closed ? 'adm-red' : r.notice.closingSoon ? 'adm-yellow' : 'adm-muted'}">截止 ${r.notice.deadlineAt}${r.notice.closed ? '（已截止）' : ''}</div>` : ''}`;
  return html`<span class="adm-muted">—</span>`;
}

export function render(ctx) {
  const { site, url } = ctx;
  const rows = catalogRows(site).sort((a, b) => a.category.localeCompare(b.category) || a.id.localeCompare(b.id));
  return html`
${pageHead({ title: '資料目錄', what: '全站資產一張表（含新聞稿／公告、影音宣導素材、專區、申請服務、出版品、檢驗項目、研究計畫）：每筆內容與資料集都有識別碼、Owner／Steward、唯一正本位置、更新頻率、授權、敏感等級，以及 AI 白名單是否生效（不生效會列出原因）。', flow: '目錄本身就是開放資料：/v1/catalog.json 與 /v1/datasets.json（建置時由 content/ 產生）。新增資產＝在 content/ 加檔並開 PR，不另設目錄系統。' })}
<section class="adm-card">
  <div class="adm-filters">
    <div class="adm-field adm-field--grow"><label for="c-q">搜尋（名稱、識別碼、正本位置）</label><input type="search" id="c-q"></div>
    <div class="adm-field"><label for="c-cat">類別</label><select id="c-cat"><option value="">全部</option>${Object.entries(CATEGORY_LABEL).map(([k, v]) => html`<option value="${k}">${v}</option>`)}</select></div>
    <div class="adm-field"><label for="c-unit">Owner</label><select id="c-unit">${unitOptions(site, { all: true, selected: 'all' })}</select></div>
    <div class="adm-field"><label for="c-wl">AI 白名單</label><select id="c-wl"><option value="">全部</option><option value="1">生效</option><option value="0">不生效</option></select></div>
    <div class="adm-field"><label for="c-flag">警示</label><select id="c-flag"><option value="">全部</option><option value="overdue">更新／審閱逾期</option><option value="license">非標準授權</option></select></div>
    <button type="button" class="adm-btn adm-btn--ghost" id="c-csv">匯出 CSV</button>
    <span class="adm-count-note" id="c-count" aria-live="polite"></span>
  </div>
  <div class="adm-tablewrap" role="region" tabindex="0" aria-label="表格，可捲動"><table class="adm-table" id="c-table"><caption>目錄本身就是開放資料：<a href="${url('/v1/catalog.json', { noLang: true })}">/v1/catalog.json</a>、<a href="${url('/v1/datasets.json', { noLang: true })}">/v1/datasets.json</a>（OGDL-1.0）</caption>
    <thead><tr><th scope="col">識別碼</th><th scope="col">名稱</th><th scope="col">類別</th><th scope="col">Owner／Steward</th><th scope="col">正本位置</th><th scope="col">更新頻率／上次更新</th><th scope="col">型別專屬狀態</th><th scope="col">授權</th><th scope="col">敏感等級</th><th scope="col">AI 白名單</th></tr></thead>
    <tbody>${rows.map((r) => {
      const isDs = r.type === 'dataset';
      const late = isDs ? r.datasetOverdue : r.overdue;
      const freq = isDs ? `${FREQ_LABEL[r.updateFrequency] ?? r.updateFrequency ?? '—'}` : (r.reviewPeriodMonths ? `每 ${r.reviewPeriodMonths} 個月審閱` : '事件觸發');
      const last = isDs ? r.lastUpdated : r.reviewedAt;
      const canon = r.canonicalUrl ?? r.front;
      return html`<tr data-q="${`${r.id} ${r.title} ${canon ?? ''}`.toLowerCase()}" data-cat="${r.category}" data-owner="${r.owner}" data-wl="${r.wl ? 1 : 0}" data-late="${late ? 1 : 0}" data-lic="${r.licenseOk ? 0 : 1}">
        <td><code>${r.id}</code></td>
        <td>${r.title}<div class="adm-muted">${r.type === 'news' && r.newsType ? (NEWS_SUBTYPE_LABEL[r.newsType] ?? TYPE_LABEL[r.type]) : (TYPE_LABEL[r.type] ?? r.type)}${r.status !== 'published' ? ` · ${r.status}` : ''}</div></td>
        <td>${CATEGORY_LABEL[r.category] ?? r.category}</td>
        <td>${r.ownerName}${r.steward ? html`<div class="adm-muted">${r.steward}</div>` : ''}</td>
        <td>${canon ? (/^https?:/.test(canon) ? html`<a href="${canon}" rel="noopener">${canon.replace(/^https?:\/\//, '').slice(0, 46)}</a>` : html`<a href="${url(canon)}">${canon}</a>`) : html`<span class="adm-muted">—</span>`}</td>
        <td>${freq}<div class="${late ? 'adm-red' : 'adm-muted'}">${last ?? '—'}${late ? '（逾期）' : ''}</div></td>
        <td>${specific(r)}</td>
        <td>${r.licenseOk ? r.license : html`<span class="adm-yellow">${r.license}</span>`}</td>
        <td>${SENS_LABEL[r.sensitivity] ?? r.sensitivity}</td>
        <td>${wlCell(r)}</td></tr>`;
    })}</tbody></table></div>
</section>`;
}
