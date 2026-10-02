// /admin/links/ 外部連結健康：全站外部連結、最後檢查日、狀態；失效自動變待辦（link-broken）
import { html } from '../../../scripts/lib/render.mjs';
import { pageHead, adminMeta, unitOptions, linkRows, linkCounts, TYPE_LABEL } from './_partials.mjs';
export { layout } from './_layout.mjs';

export function pages() { return [{ path: '/admin/links/', props: {}, noindex: true }]; }
export function meta() { return adminMeta('外部連結健康', 'links', ['/assets/js/admin/links.js']); }

const STATE = { ok: ['adm-badge--ok', 'ok 正常'], broken: ['adm-badge--bad', 'broken 失效'], unchecked: ['adm-badge--gray', 'unchecked 未檢查'] };

export function render(ctx) {
  const { site, url } = ctx;
  const rows = linkRows(site).sort((a, b) => (a.status === 'broken' ? 0 : a.status === 'unchecked' ? 1 : 2) - (b.status === 'broken' ? 0 : b.status === 'unchecked' ? 1 : 2) || a.itemId.localeCompare(b.itemId));
  const c = linkCounts(rows);
  const types = [...new Set(rows.map((r) => r.itemType))];
  return html`
${pageHead({
    title: '外部連結健康',
    what: '專區、申請服務、公告、出版品與影音所指向的外部網址一覽。政府網站最常見的失信，是「連過去是 404」；這裡讓每一條外部連結都有最後檢查日與狀態。',
    flow: '外部連結由 CI 每日 HEAD 檢查，結果寫回該連結的 status（ok／broken）與 lastCheckedAt；status: broken 觸發待辦 link-broken 給承辦單位，修正網址並合併後待辦自動消失。',
  })}
<div class="adm-box adm-box--note" role="note"><strong>怎麼檢查：<code>npm run fetch -- --check-links</code></strong>
  <ul style="margin:var(--sp-2) 0 0;padding-left:1.3em">
    <li>GitHub Actions 每日排程自動執行這個指令（與資料快照同一個工作），<strong>不需要人手動點</strong>。</li>
    <li>對每條 <code>https://</code> 外部連結送 HEAD 請求（失敗再試 GET）；回應 2xx／3xx 記 <code>ok</code>，4xx／5xx／逾時記 <code>broken</code>；尚未檢查過者為 <code>unchecked</code>。</li>
    <li>失效連結自動變成「連結失效」待辦（<a href="${url('/admin/todos/#tab-link-broken', { noLang: true })}">連動待辦</a>），期限 7 日；站內連結不在此檢查範圍，建置時由參照檢查保證。</li>
    <li>本頁在建置時讀取內容檔上的狀態；若有 <code>/v1/governance/links.json</code>，載入後會即時覆蓋狀態與檢查日。</li>
  </ul></div>
<div class="adm-statrow" style="margin-top:var(--sp-4)">
  <div class="adm-stat"><p class="adm-stat__label">外部連結</p><p class="adm-stat__value" id="l-total">${c.total}</p><p class="adm-stat__note">專區、服務、公告、出版品、影音</p></div>
  <div class="adm-stat adm-stat--ok"><p class="adm-stat__label">ok</p><p class="adm-stat__value" id="l-ok">${c.ok}</p><p class="adm-stat__note">最近一次檢查正常</p></div>
  <div class="adm-stat ${c.broken ? 'adm-stat--bad' : 'adm-stat--ok'}"><p class="adm-stat__label">broken</p><p class="adm-stat__value" id="l-broken">${c.broken}</p><p class="adm-stat__note">已產生待辦</p></div>
  <div class="adm-stat adm-stat--warn"><p class="adm-stat__label">unchecked</p><p class="adm-stat__value" id="l-unchecked">${c.unchecked}</p><p class="adm-stat__note">${c.total && c.ok + c.broken === 0 ? '尚未執行檢查' : '尚未檢查'}</p></div>
</div>
<section class="adm-card" aria-labelledby="l-h"><h2 id="l-h">全部外部連結</h2>
  <div class="adm-filters">
    <div class="adm-field adm-field--grow"><label for="l-q">搜尋（來源內容、標籤、網址）</label><input type="search" id="l-q"></div>
    <div class="adm-field"><label for="l-state">狀態</label><select id="l-state"><option value="">全部</option><option value="broken">broken</option><option value="unchecked">unchecked</option><option value="ok">ok</option></select></div>
    <div class="adm-field"><label for="l-type">來源型別</label><select id="l-type"><option value="">全部</option>${types.map((t) => html`<option value="${t}">${TYPE_LABEL[t] ?? t}</option>`)}</select></div>
    <div class="adm-field"><label for="l-unit">單位</label><select id="l-unit">${unitOptions(site, { all: true, selected: 'all' })}</select></div>
    <button type="button" class="adm-btn adm-btn--ghost" id="l-csv">匯出 CSV</button>
    <span class="adm-count-note" id="l-note" aria-live="polite"></span>
  </div>
  <div class="adm-tablewrap"><table class="adm-table" id="l-table"><caption>每列一條外部連結；來源內容可點進前台頁面。</caption>
    <thead><tr><th scope="col">來源內容</th><th scope="col">欄位</th><th scope="col">連結標籤</th><th scope="col">網址</th><th scope="col">最後檢查</th><th scope="col">狀態</th></tr></thead>
    <tbody>${rows.map((r) => html`<tr data-owner="${r.owner}" data-state="${r.status}" data-type="${r.itemType}" data-href="${r.href}" data-key="${r.itemId}|${r.field}" data-q="${`${r.itemId} ${r.itemTitle} ${r.label} ${r.href}`.toLowerCase()}">
      <td>${r.front ? html`<a href="${url(r.front)}">${r.itemTitle}</a>` : r.itemTitle}<div class="adm-muted"><code>${r.itemId}</code> · ${r.ownerName}</div></td>
      <td><code>${r.field}</code></td>
      <td>${r.label}</td>
      <td><a href="${r.href}" rel="noopener noreferrer">${r.href.replace(/^https?:\/\//, '').slice(0, 54)}</a></td>
      <td data-checked>${r.lastCheckedAt ?? html`<span class="adm-muted">未檢查</span>`}</td>
      <td data-status><span class="adm-badge ${STATE[r.status][0]}">${STATE[r.status][1]}</span></td></tr>`)}</tbody></table></div>
  <p class="adm-empty" ${rows.length ? 'hidden' : ''}>目前沒有外部連結（專區、申請服務、公告等內容載入後會列在這裡）。</p>
</section>`;
}
