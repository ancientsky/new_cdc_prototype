// /admin/notices/ 公告管理（ARCHITECTURE §11.1、§11.4）：人才招募、採購公告、其他訊息；截止倒數；已截止建議封存（示範）；匯出
import { html } from '../../../scripts/lib/render.mjs';
import { pageHead, dataScript, adminMeta, unitOptions, noticeRows, NEWS_SUBTYPE_LABEL } from './_partials.mjs';
export { layout } from './_layout.mjs';

export function pages() { return [{ path: '/admin/notices/', props: {}, noindex: true }]; }
export function meta() { return adminMeta('公告管理', 'notices', ['/assets/js/admin/notices.js']); }

const TABS = [['recruit', '人才招募'], ['procurement', '採購公告'], ['other', '其他訊息']];

function countdown(n) {
  if (n.days == null) return html`<span class="adm-muted">無截止日</span>`;
  if (n.closed) return html`<span class="adm-badge adm-badge--bad">已截止 ${-n.days} 日</span>`;
  if (n.days === 0) return html`<span class="adm-badge adm-badge--warn">今日截止</span>`;
  return html`<span class="adm-badge ${n.closingSoon ? 'adm-badge--warn' : 'adm-badge--ok'}">剩 ${n.days} 日</span>`;
}

export function render(ctx) {
  const { site, url } = ctx;
  const rows = noticeRows(site);
  const open = rows.filter((n) => n.open).length;
  const soon = rows.filter((n) => n.closingSoon && !n.closed && n.status === 'published').length;
  const closedUn = rows.filter((n) => n.closed && !n.archived).length;
  const data = { today: site.today, rows: rows.map(({ id, title, newsType, deadlineAt, refNo, applyUrl, positions, budgetNtd, status, closed, days, owner }) => ({ id, title, newsType, deadlineAt, refNo, applyUrl, positions, budgetNtd, status, closed, days, owner })) };
  return html`
${pageHead({
    title: '公告管理',
    what: '人才招募、採購公告與其他訊息的一頁總覽：每則的截止倒數、字號、名額或預算、報名網址。已截止而尚未封存的會被列出，建議封存。',
    flow: '公告就是 news 型別（newsType 為 recruit／procurement／other）。新增＝在 content/news/ 加檔並開 PR；封存＝把 status 改成 archived 再開 PR。截止當天不需要任何人動手。',
  })}
<div class="adm-box adm-box--note" role="note"><strong>截止後系統自動標「已截止」並退出首頁，無需人工</strong>
  公告有 <code>deadlineAt</code>：建置時若 <code>deadlineAt &lt; 今日</code>，引擎自動設 <code>gov.closed</code>、生命週期標籤顯示「已截止」、從首頁與 <code>/notices/</code> 進行中列表移除（保留在「已截止」頁籤），也<strong>不會</strong>產生待辦。下方「建議封存」只是年度清理：久遠的已截止公告改 <code>status: archived</code>，讓目錄更乾淨。</div>

<div class="adm-statrow" style="margin-top:var(--sp-4)">
  <div class="adm-stat adm-stat--info"><p class="adm-stat__label">進行中</p><p class="adm-stat__value">${open}</p><p class="adm-stat__note">已發布且未截止</p></div>
  <div class="adm-stat ${soon ? 'adm-stat--warn' : 'adm-stat--ok'}"><p class="adm-stat__label">7 日內截止</p><p class="adm-stat__value">${soon}</p><p class="adm-stat__note">首頁倒數提醒</p></div>
  <div class="adm-stat ${closedUn ? 'adm-stat--bad' : 'adm-stat--ok'}"><p class="adm-stat__label">已截止未封存</p><p class="adm-stat__value" id="n-closed-un">${closedUn}</p><p class="adm-stat__note">建議封存（示範）</p></div>
  <div class="adm-stat"><p class="adm-stat__label">合計</p><p class="adm-stat__value">${rows.length}</p><p class="adm-stat__note">三類公告</p></div>
</div>

<section class="adm-card" aria-labelledby="n-h"><h2 id="n-h">公告列表</h2>
  <div class="adm-filters">
    <div class="adm-field"><label for="n-unit">單位</label><select id="n-unit">${unitOptions(site, { all: true, selected: 'all' })}</select></div>
    <div class="adm-field"><label for="n-state">狀態</label><select id="n-state"><option value="">全部</option><option value="open">進行中</option><option value="soon">7 日內截止</option><option value="closed">已截止</option><option value="closed-un">已截止未封存</option></select></div>
    <a class="adm-btn adm-btn--ghost" href="${url('/admin/publish/?type=recruit', { noLang: true })}">新增人才招募</a>
    <a class="adm-btn adm-btn--ghost" href="${url('/admin/publish/?type=procurement', { noLang: true })}">新增採購公告</a>
    <button type="button" class="adm-btn adm-btn--ghost" id="n-csv">匯出 CSV</button>
    <button type="button" class="adm-btn adm-btn--ghost" id="n-json">匯出封存建議 JSON</button>
    <span class="adm-count-note" id="n-note" aria-live="polite"></span>
  </div>
  <div class="adm-tabs" role="tablist" aria-label="公告類型">${TABS.map(([k, l], i) => html`<button type="button" role="tab" id="ntab-${k}" aria-controls="npanel-${k}" aria-selected="${i === 0 ? 'true' : 'false'}" tabindex="${i === 0 ? '0' : '-1'}" data-kind="${k}">${l}<span class="adm-count" data-kcount="${k}">${rows.filter((r) => r.newsType === k).length}</span></button>`)}</div>
  ${TABS.map(([k, l], i) => { const list = rows.filter((r) => r.newsType === k); return html`<div role="tabpanel" id="npanel-${k}" aria-labelledby="ntab-${k}" data-panel="${k}" ${i === 0 ? '' : 'hidden'}>
    <div class="adm-tablewrap" role="region" tabindex="0" aria-label="表格，可捲動"><table class="adm-table"><caption>${NEWS_SUBTYPE_LABEL[k]}；前台頁面 <a href="${url('/notices/')}">/notices/</a></caption>
      <thead><tr><th scope="col">標題／字號</th><th scope="col">截止日</th><th scope="col">倒數</th><th scope="col">${k === 'procurement' ? '預算' : k === 'recruit' ? '名額' : '備註'}</th><th scope="col">報名／投標</th><th scope="col">狀態</th><th scope="col">處理</th></tr></thead>
      <tbody>${list.map((n) => html`<tr data-id="${n.id}" data-owner="${n.owner}" data-closed="${n.closed ? 1 : 0}" data-archived="${n.archived ? 1 : 0}" data-soon="${n.closingSoon && !n.closed ? 1 : 0}" data-open="${n.open ? 1 : 0}">
        <td>${n.front ? html`<a href="${url(n.front)}">${n.title}</a>` : n.title}<div class="adm-muted"><code>${n.id}</code>${n.refNo ? html` · ${n.refNo}` : ''}</div></td>
        <td>${n.deadlineAt ?? '—'}</td>
        <td>${countdown(n)}</td>
        <td>${k === 'procurement' ? (n.budgetNtd != null ? `NT$ ${n.budgetNtd.toLocaleString('en-US')}` : '—') : k === 'recruit' ? (n.positions != null ? `${n.positions} 名` : '—') : '—'}</td>
        <td>${n.applyUrl ? html`<a href="${n.applyUrl}" rel="noopener">${n.applyUrl.replace(/^https?:\/\//, '').slice(0, 36)}</a>` : html`<span class="adm-muted">—</span>`}</td>
        <td>${n.archived ? html`<span class="adm-badge adm-badge--gray">已封存</span>` : n.closed ? html`<span class="adm-badge adm-badge--bad">已截止</span>` : n.status === 'published' ? html`<span class="adm-badge adm-badge--ok">進行中</span>` : html`<span class="adm-badge adm-badge--info">${n.status}</span>`}</td>
        <td data-act>${n.closed && !n.archived ? html`<button type="button" class="adm-btn adm-btn--ghost adm-btn--sm" data-archive="${n.id}">建議封存（示範）</button>` : html`<span class="adm-muted">—</span>`}</td></tr>`)}</tbody></table></div>
    <p class="adm-empty" data-empty ${list.length ? 'hidden' : ''}>目前沒有「${l}」公告。</p></div>`; })}
</section>
${dataScript('adm-notices-data', data)}`;
}
