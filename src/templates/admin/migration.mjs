// /admin/migration/ 移轉進度（ARCHITECTURE §13.3）：各清單進度、待辦連動、逐筆表格、匯出對照（三種伺服器格式＋redirects.json）。
// 資料：site.migration（V1 治理引擎）；沒有資料時顯示說明，不報錯。
import { html } from '../../../scripts/lib/render.mjs';
import { pageHead, adminMeta, unitOptions, todoList } from './_partials.mjs';
import { migrationData, listStats, daysTo, MIG_STATUS, MIG_LABEL, MIG_BADGE, MIG_TYPE_LABEL, REQ_LABEL } from './_migration.mjs';
export { layout } from './_layout.mjs';

export function pages() { return [{ path: '/admin/migration/', props: {}, noindex: true }]; }
export function meta() { return adminMeta('移轉進度', 'migration', ['/assets/js/admin/migration.js']); }

const SEG = { migrated: 'ok', merged: 'info', archived: 'gray', pending: 'warn', dropped: 'dropped' };

/** 堆疊進度條：已移轉／併入／封存／不再提供／待確認，附文字替代 */
function stack(c) {
  const seg = (k) => (c[k] ? html`<i class="adm-stack__${SEG[k]}" style="width:${(c[k] / c.total) * 100}%"></i>` : '');
  const alt = MIG_STATUS.map((k) => `${MIG_LABEL[k]} ${c[k]}`).join('，');
  return html`<div class="adm-stack" role="img" aria-label="共 ${c.total} 筆：${alt}">${['migrated', 'merged', 'archived', 'dropped', 'pending'].map(seg)}</div>`;
}

const EXPORTS = [
  { path: '/redirects/nginx.map', label: 'nginx.map', note: 'Nginx map 指令；一行一筆 301' },
  { path: '/redirects/web.config.rewritemap.xml', label: 'web.config.rewritemap.xml', note: 'IIS URL Rewrite 的 rewriteMap' },
  { path: '/redirects/_redirects', label: '_redirects', note: 'Netlify／Cloudflare Pages：from to 301' },
  { path: '/v1/redirects.json', label: 'redirects.json', note: '全部轉址（含 kind: migration、verified）；其他格式都由它轉出' },
  { path: '/v1/legacy-map.json', label: 'legacy-map.json', note: '404 頁與 /legacy/ 查詢頁用的精簡對照' },
];

export function render(ctx) {
  const { site, url } = ctx;
  const m = migrationData(site);
  const t = m.total;
  const todos = todoList(site).filter((x) => x.kind === 'migration-pending');
  const tile = (label, value, note, tone = '') => html`<div class="adm-stat ${tone ? `adm-stat--${tone}` : ''}"><p class="adm-stat__label">${label}</p><p class="adm-stat__value">${value}</p><p class="adm-stat__note">${note}</p></div>`;
  const head = pageHead({
    title: '移轉進度（舊站 → 新站）',
    what: '舊官網每一個頁面（含 Q&A、PDF、統計、新聞列表）都登錄在「移轉清單」：它搬到哪一頁、現在什麼狀態、誰負責、移轉後新增了哪些治理要求。清單同時是舊網址 301 對照的唯一來源。',
    flow: '承辦單位在 content/migration/*.json 逐筆確認（verified: true）並改狀態，開 PR；合併後重新建置，本頁數字、新頁面上的「取代舊網站 N 個頁面」、404 自動轉址與伺服器對照檔同步更新。',
  });
  if (!m.lists.length) {
    return html`${head}<div class="adm-box adm-box--info" role="note"><strong>本次建置沒有移轉清單</strong>清單放在 <code>content/migration/</code>（ARCHITECTURE §13.1）；載入後本頁會列出各專區的進度與逐筆對照。</div>
<section class="adm-card" aria-labelledby="mg-ex"><h2 id="mg-ex">匯出對照</h2>
  <ul class="adm-kv" style="list-style:none;padding:0">${EXPORTS.map((e) => html`<li><a href="${url(e.path, { noLang: true })}"><code>${e.label}</code></a> <span class="adm-muted">${e.note}</span></li>`)}</ul></section>`;
  }
  const owners = [...new Set(m.rows.map((r) => r.owner))].filter(Boolean);
  return html`${head}
<div class="adm-statrow" style="grid-template-columns:repeat(auto-fit,minmax(145px,1fr))" aria-label="移轉進度總覽">
  ${tile('舊頁總數', html`<span id="mg-total">${t.total}</span>`, `${m.lists.length} 份清單`, 'info')}
  ${tile('已移轉', t.migrated, '一對一搬到新頁', 'ok')}
  ${tile('已併入', t.merged, '併入新頁的某個區塊', 'ok')}
  ${tile('已封存', t.archived, '保留為封存內容', '')}
  ${tile('待確認', html`<span id="mg-pending">${t.pending}</span>`, t.pending ? '尚未決定去向，已產生待辦' : '全部已有去向', t.pending ? 'warn' : 'ok')}
  ${tile('不再提供', t.dropped, '回應 410，不轉到無關頁面', '')}
  ${tile('已核對網址', html`${t.verified}<small style="font-size:var(--fs-md)"> / ${t.total}</small>`, `${m.verifiedPct}% 經權責單位逐筆確認；其餘舊網址由重建而來`, t.verified < t.total ? 'warn' : 'ok')}
</div>

<section class="adm-card" aria-labelledby="mg-prog"><h2 id="mg-prog">各清單進度</h2>
  <p class="adm-card__sub">整體處理完成 <strong>${m.donePct}%</strong>（已移轉、併入、封存、不再提供都算已有去向；待確認不算）。條由左至右：已移轉、已併入、已封存、不再提供、待確認。</p>
  <div class="adm-grid adm-grid--auto" style="grid-template-columns:repeat(auto-fill,minmax(360px,1fr))">${m.lists.map((l) => {
    const c = listStats(l);
    const left = daysTo(site.today, l.showLegacyUntil);
    return html`<article class="adm-unitcard" data-list="${l.id}"><h3>${l.title}</h3>
      ${stack(c)}
      <dl><dt>舊頁</dt><dd>${c.total}</dd><dt>已移轉／併入</dt><dd>${c.migrated} / ${c.merged}</dd><dt>已封存／不再提供</dt><dd>${c.archived} / ${c.dropped}</dd><dt>待確認</dt><dd class="${c.pending ? 'adm-yellow' : ''}">${c.pending}</dd><dt>已核對網址</dt><dd class="${c.verified < c.total ? 'adm-red' : ''}">${c.verified} / ${c.total}</dd>
      <dt>新頁揭露至</dt><dd>${l.showLegacyUntil ?? '—'}${left != null ? html`<span class="adm-muted"> ${left >= 0 ? `（${left} 日）` : '（已隱藏）'}</span>` : ''}</dd></dl>
      <p class="adm-muted">${l.legacyRoot ? html`舊專區入口 <code>${String(l.legacyRoot).replace(/^https?:\/\//, '')}</code>` : ''}</p></article>`;
  })}</div>
</section>

<section class="adm-card" aria-labelledby="mg-todo"><h2 id="mg-todo">待辦連動</h2>
  ${todos.length ? html`<p>有 <strong>${todos.length}</strong> 筆「舊頁待移轉」待辦（狀態為待確認且有權責單位，中優先）。逐筆決定去向並改狀態後，下次建置待辦自動消失。</p>
    <ul>${todos.slice(0, 6).map((x) => html`<li>${x.ownerName}：${x.itemTitle}${x.dueAt ? html` <span class="adm-muted">期限 ${x.dueAt}</span>` : ''}</li>`)}</ul>`
    : html`<div class="adm-box adm-box--ok"><strong>目前沒有「舊頁待移轉」待辦</strong>${t.pending ? '待確認的項目還沒有指定權責單位，所以沒有產生待辦。' : '所有舊頁都已有去向。'}</div>`}
  <p><a class="adm-btn adm-btn--ghost adm-btn--sm" href="${url('/admin/todos/#migration-pending', { noLang: true })}">到連動待辦處理 →</a></p>
</section>

<section class="adm-card" aria-labelledby="mg-tbl"><h2 id="mg-tbl">逐筆對照</h2>
  <div class="adm-filters">
    <div class="adm-field adm-field--grow"><label for="mg-q">搜尋（舊標題、舊網址、新頁）</label><input type="search" id="mg-q"></div>
    <div class="adm-field"><label for="mg-st">狀態</label><select id="mg-st"><option value="">全部</option>${MIG_STATUS.map((k) => html`<option value="${k}">${MIG_LABEL[k]}</option>`)}</select></div>
    <div class="adm-field"><label for="mg-vf">網址核對</label><select id="mg-vf"><option value="">全部</option><option value="1">已核對</option><option value="0">未核對</option></select></div>
    <div class="adm-field"><label for="mg-list">清單</label><select id="mg-list"><option value="">全部</option>${m.lists.map((l) => html`<option value="${l.id}">${l.title}</option>`)}</select></div>
    <div class="adm-field"><label for="mg-unit">單位</label><select id="mg-unit">${unitOptions(site, { all: true, selected: 'all' })}</select></div>
    <button type="button" class="adm-btn adm-btn--ghost" id="mg-csv">匯出 CSV</button>
    <span class="adm-count-note" id="mg-note" aria-live="polite"></span>
  </div>
  <div class="adm-tablewrap"><table class="adm-table" id="mg-table"><caption>每列一個舊頁；狀態為待確認者排在最前面。</caption>
    <thead><tr><th scope="col">舊標題</th><th scope="col">舊網址</th><th scope="col">狀態</th><th scope="col">核對</th><th scope="col">對應新頁</th><th scope="col">權責單位</th><th scope="col">新增治理要求</th></tr></thead>
    <tbody>${[...m.rows].sort((a, b) => (a.status === 'pending' ? 0 : 1) - (b.status === 'pending' ? 0 : 1)).map((r) => html`<tr data-status="${r.status}" data-verified="${r.verified ? 1 : 0}" data-list="${r.listId}" data-owner="${r.owner ?? ''}" data-q="${`${r.oldTitle} ${r.oldPath} ${r.oldUrl} ${r.targetTitle ?? ''} ${r.target ?? ''}`.toLowerCase()}">
      <td><strong>${r.oldTitle}</strong>${r.oldPath ? html`<div class="adm-muted">${r.oldPath}</div>` : ''}<div class="adm-muted">${MIG_TYPE_LABEL[r.oldType] ?? r.oldType}${r.note ? ` · ${r.note}` : ''}</div></td>
      <td>${r.oldUrl ? (r.placeholder ? html`<code>${r.oldUrl.replace(/^https?:\/\//, '')}</code><div class="adm-muted">網址待補（{id} 佔位）</div>` : html`<a href="${r.oldUrl}" rel="nofollow noopener" data-old>${r.oldUrl.replace(/^https?:\/\//, '')}</a>`) : '—'}</td>
      <td data-st><span class="adm-badge adm-badge--${MIG_BADGE[r.status]}">${MIG_LABEL[r.status]}</span></td>
      <td>${r.verified ? html`<span class="adm-badge adm-badge--ok">已核對</span>` : html`<span class="adm-badge adm-badge--gray">未核對</span>`}</td>
      <td>${r.target ? (r.targetFront ? html`<a href="${url(r.targetFront)}">${r.targetTitle ?? r.target}</a>` : (r.targetTitle ?? r.target)) : html`<span class="adm-muted">—</span>`}${r.target ? html`<div class="adm-muted"><code>${r.target}</code></div>` : ''}</td>
      <td>${r.ownerName}</td>
      <td>${r.reqs.length ? r.reqs.map((k) => html`<span class="adm-chip adm-chip--plain">${REQ_LABEL[k] ?? k}</span> `) : html`<span class="adm-muted">—</span>`}</td></tr>`)}</tbody></table></div>
</section>

<section class="adm-card" aria-labelledby="mg-ex"><h2 id="mg-ex">匯出對照</h2>
  <p class="adm-card__sub">都是建置時由移轉清單轉出的靜態檔，只含網址完整、已有去向的項目；貼進署內伺服器即是 301。待確認或網址仍是佔位的不輸出。</p>
  <ul class="adm-kv" style="list-style:none;padding:0">${EXPORTS.map((e) => html`<li><a href="${url(e.path, { noLang: true })}" data-export="${url(e.path, { noLang: true })}"><code>${e.label}</code></a> <span class="adm-muted">${e.note}</span> <button type="button" class="adm-btn adm-btn--ghost adm-btn--sm" data-preview="${url(e.path, { noLang: true })}">預覽前 8 行</button></li>`)}</ul>
  <pre class="adm-pre" id="mg-preview" tabindex="0" hidden></pre>
  <p class="adm-muted">舊網址進站後的行為與保留期說明見前台 <a href="${url('/legacy/', { noLang: true })}">舊網址查詢頁</a>；404 log 分析用 <code>node scripts/analyze-404-log.mjs &lt;access.log&gt;</code>，找出還沒有對照的舊網址。</p>
</section>`;
}
