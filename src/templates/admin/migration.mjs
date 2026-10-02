// /admin/migration/ 移轉進度（ARCHITECTURE §13.3、§14.4）：72＋ 份清單（每種傳染病一份；有疾病頁者多為推導、少數人工）的摘要表，
// 可依「待移轉最多」排序、依有頁／無頁／人工／推導／單位篩選；展開單一清單看逐筆對照；匯出對照。
// 資料：site.migration（W1 治理引擎）；沒有資料時顯示說明，不報錯。展開的逐筆表格在建置時就輸出（沒有 JS 也看得到：<noscript> 樣式讓它們全部顯示）。
import { html, raw } from '../../../scripts/lib/render.mjs';
import { pageHead, adminMeta, todoList } from './_partials.mjs';
import { migrationData, rowsOf, listStats, daysTo, MIG_STATUS, MIG_LABEL, MIG_BADGE, MIG_TYPE_LABEL, REQ_LABEL } from './_migration.mjs';
export { layout } from './_layout.mjs';

export function pages() { return [{ path: '/admin/migration/', props: {}, noindex: true }]; }
export function meta() { return adminMeta('移轉進度', 'migration', ['/assets/js/admin/migration.js']); }

const SEG = { migrated: 'ok', merged: 'info', archived: 'gray', pending: 'warn', dropped: 'dropped' };

/** 堆疊進度條：已移轉／併入／封存／不再提供／待確認，附文字替代 */
function stack(c, { cls = '' } = {}) {
  const seg = (k) => (c[k] ? html`<i class="adm-stack__${SEG[k]}" style="width:${(c[k] / c.total) * 100}%"></i>` : '');
  const alt = MIG_STATUS.map((k) => `${MIG_LABEL[k]} ${c[k]}`).join('，');
  return html`<div class="adm-stack${cls ? ` ${cls}` : ''}" role="img" aria-label="共 ${c.total} 筆：${alt}">${['migrated', 'merged', 'archived', 'dropped', 'pending'].map(seg)}</div>`;
}

const EXPORTS = [
  { path: '/redirects/nginx.map', label: 'nginx.map', note: 'Nginx map 指令；一行一筆 301' },
  { path: '/redirects/web.config.rewritemap.xml', label: 'web.config.rewritemap.xml', note: 'IIS URL Rewrite 的 rewriteMap' },
  { path: '/redirects/_redirects', label: '_redirects', note: 'Netlify／Cloudflare Pages：from to 301' },
  { path: '/v1/redirects.json', label: 'redirects.json', note: '全部轉址（含 kind: migration、verified）；其他格式都由它轉出' },
  { path: '/v1/legacy-map.json', label: 'legacy-map.json', note: '404 頁與 /legacy/ 查詢頁用的精簡對照' },
  { path: '/v1/migration/index.json', label: 'migration/index.json', note: '各清單摘要；每份清單的完整 JSON（含推導標記）在 v1/migration/{slug}.json，可下載後當作人工清單的起點' },
];

const catLabel = (n) => (n ? `第${n}類` : '—');

/** 一份清單展開後的逐筆表格（沿用第五輪的欄位；待確認排在最前） */
function itemsTable(ctx, r) {
  const { site, url } = ctx;
  const items = [...(r.list.items ?? [])].sort((a, b) => (a.status === 'pending' ? 0 : 1) - (b.status === 'pending' ? 0 : 1));
  const rows = rowsOf(site, r.list, items);
  return html`<div class="adm-tablewrap"><table class="adm-table mg-items" aria-label="${r.name}的逐筆對照"><caption>每列一個舊頁；狀態為待確認者排在最前面。</caption>
    <thead><tr><th scope="col">舊標題</th><th scope="col">舊網址</th><th scope="col">狀態</th><th scope="col">核對</th><th scope="col">對應新頁</th><th scope="col">權責單位</th><th scope="col">新增治理要求</th></tr></thead>
    <tbody>${rows.map((x) => html`<tr data-status="${x.status}" data-verified="${x.verified ? 1 : 0}">
      <td><strong>${x.oldTitle}</strong>${x.oldPath ? html`<div class="adm-muted">${x.oldPath}</div>` : ''}<div class="adm-muted">${MIG_TYPE_LABEL[x.oldType] ?? x.oldType}${x.note ? ` · ${x.note}` : ''}</div></td>
      <td>${x.oldUrl ? (x.placeholder ? html`<code>${x.oldUrl.replace(/^https?:\/\//, '')}</code><div class="adm-muted">網址待補（{id} 佔位）</div>` : html`<a href="${x.oldUrl}" rel="nofollow noopener" data-old>${x.oldUrl.replace(/^https?:\/\//, '')}</a>`) : '—'}</td>
      <td data-st><span class="adm-badge adm-badge--${MIG_BADGE[x.status]}">${MIG_LABEL[x.status]}</span></td>
      <td>${x.verified ? html`<span class="adm-badge adm-badge--ok">已核對</span>` : html`<span class="adm-badge adm-badge--gray">未核對</span>`}</td>
      <td>${x.target ? (x.targetFront ? html`<a href="${url(x.targetFront)}">${x.targetTitle ?? x.target}</a>` : (x.targetTitle ?? x.target)) : html`<span class="adm-muted">—</span>`}${x.target ? html`<div class="adm-muted"><code>${x.target}</code></div>` : ''}</td>
      <td>${x.ownerName}</td>
      <td class="adm-muted">${x.reqs.length ? x.reqs.map((k) => REQ_LABEL[k] ?? k).join('、') : '—'}</td></tr>`)}</tbody></table></div>`;
}

export function render(ctx) {
  const { site, url } = ctx;
  const m = migrationData(site);
  const t = m.total;
  const todos = todoList(site).filter((x) => x.kind === 'migration-pending');
  const tile = (label, value, note, tone = '') => html`<div class="adm-stat ${tone ? `adm-stat--${tone}` : ''}"><p class="adm-stat__label">${label}</p><p class="adm-stat__value">${value}</p><p class="adm-stat__note">${note}</p></div>`;
  const head = pageHead({
    title: '移轉進度（舊站 → 新站）',
    what: '舊官網每一個頁面（含 Q&A、PDF、統計、新聞列表）都登錄在「移轉清單」：它搬到哪一頁、現在什麼狀態、誰負責、移轉後新增了哪些治理要求。每種傳染病一份清單：標準子頁由疾病頁模板自動推導，只有疾病特有的例外才需要人工清單；清單同時是舊網址 301 對照的唯一來源。',
    flow: '承辦單位在 content/migration/*.json 只寫例外（或下載推導清單當起點）、逐筆確認（verified: true）並改狀態，開 PR；合併後重新建置，本頁數字、新頁面上的「取代舊網站 N 個頁面」、404 自動轉址與伺服器對照檔同步更新。',
  });
  if (!m.lists.length) {
    return html`${head}<div class="adm-box adm-box--info" role="note"><strong>本次建置沒有移轉清單</strong>清單放在 <code>content/migration/</code>（ARCHITECTURE §13.1、§14.1）；載入後本頁會列出各疾病的進度與逐筆對照。</div>
<section class="adm-card" aria-labelledby="mg-ex"><h2 id="mg-ex">匯出對照</h2>
  <ul class="adm-kv" style="list-style:none;padding:0">${EXPORTS.map((e) => html`<li><a href="${url(e.path, { noLang: true })}"><code>${e.label}</code></a> <span class="adm-muted">${e.note}</span></li>`)}</ul></section>`;
  }
  const S = m.summary;
  // 單位選單：只列清單實際涉及的單位（含筆數）
  const owners = [...new Map(m.listRows.filter((r) => r.owner).map((r) => [r.owner, r.ownerName])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'zh-Hant'));
  const ownerN = (o) => m.listRows.filter((r) => r.owner === o).length;
  const noPagePending = m.listRows.filter((r) => r.hasPage === false).reduce((a, r) => a + r.c.pending, 0);
  return html`${head}
<div class="adm-statrow" style="grid-template-columns:repeat(auto-fit,minmax(145px,1fr))" aria-label="移轉進度總覽">
  ${tile('清單數', html`<span id="mg-lists">${S.lists}</span>`, `推導 ${S.derived} · 人工 ${S.curated}`, 'info')}
  ${tile('舊頁總數', html`<span id="mg-total">${t.total}</span>`, `${m.lists.length} 份清單合計`, 'info')}
  ${tile('已移轉', t.migrated, '一對一搬到新頁', 'ok')}
  ${tile('已併入', t.merged, '併入新頁的某個區塊', 'ok')}
  ${tile('已封存', t.archived, '保留為封存內容', '')}
  ${tile('待確認', html`<span id="mg-pending">${t.pending}</span>`, t.pending ? '尚未決定去向，已產生待辦' : '全部已有去向', t.pending ? 'warn' : 'ok')}
  ${tile('不再提供', t.dropped, '回應 410，不轉到無關頁面', '')}
  ${tile('尚無疾病頁', html`<span id="mg-nopage">${S.noPage}</span>`, S.noPage ? `${S.noPage} 種疾病的 ${noPagePending} 個舊頁待移轉` : '每種疾病都有頁', S.noPage ? 'warn' : 'ok')}
  ${tile('已核對網址', html`${t.verified}<small style="font-size:var(--fs-md)"> / ${t.total}</small>`, `${m.verifiedPct}% 經權責單位逐筆確認；其餘舊網址由重建而來`, t.verified < t.total ? 'warn' : 'ok')}
</div>

<section class="adm-card" aria-labelledby="mg-prog"><h2 id="mg-prog">整體進度</h2>
  <p class="adm-card__sub">整體處理完成 <strong>${m.donePct}%</strong>（已移轉、併入、封存、不再提供都算已有去向；待確認不算）。條由左至右：已移轉、已併入、已封存、不再提供、待確認。</p>
  ${stack(t, { cls: 'mg-stack--big' })}
</section>

<section class="adm-card" aria-labelledby="mg-sum"><h2 id="mg-sum">各疾病清單（${S.lists} 份）</h2>
  <p class="adm-card__sub">預設依「待移轉」由多到少排序，先處理缺口最大的。按「展開」看逐筆對照；篩選、排序與展開狀態會記在這個瀏覽器（也寫進網址的 # 之後，可以貼給同事）。</p>
  <div class="adm-filters mg-filters" role="group" aria-label="篩選與排序">
    <div class="adm-field adm-field--seg"><span class="adm-label" id="mg-f-l">顯示</span>
      <div class="adm-seg" role="radiogroup" aria-labelledby="mg-f-l" id="mg-f">
        ${[['all', '全部', S.lists], ['has', '有疾病頁', S.hasPage], ['no', '無疾病頁', S.noPage], ['curated', '人工', S.curated], ['derived', '推導', S.derived]].map(([k, label, n]) => html`<button type="button" class="adm-seg__b" role="radio" aria-checked="${k === 'all' ? 'true' : 'false'}" data-f="${k}">${label} <span class="adm-seg__n">${n}</span></button>`)}
      </div></div>
    <div class="adm-field"><label for="mg-unit">單位</label><select id="mg-unit"><option value="all">全部單位</option>${owners.map(([id, name]) => html`<option value="${id}">${name}（${ownerN(id)}）</option>`)}</select></div>
    <div class="adm-field"><label for="mg-sort">排序</label><select id="mg-sort">
      <option value="pending">待移轉最多</option><option value="pct">完成度最低</option><option value="name">疾病名稱</option><option value="cat">法定類別</option><option value="total">舊頁數</option></select></div>
    <div class="adm-field adm-field--grow"><label for="mg-q">搜尋疾病、單位</label><input type="search" id="mg-q" autocomplete="off"></div>
    <button type="button" class="adm-btn adm-btn--ghost" id="mg-csv">匯出摘要 CSV</button>
    <button type="button" class="adm-btn adm-btn--ghost" id="mg-csv-items">匯出已展開逐筆 CSV</button>
    <button type="button" class="adm-btn adm-btn--ghost adm-btn--sm" id="mg-expand">全部展開／收合</button>
    <span class="adm-count-note" id="mg-note" aria-live="polite"></span>
  </div>
  <div class="adm-tablewrap"><table class="adm-table mg-sum" id="mg-table"><caption>每列一份清單（每種傳染病一份）；「方式」：人工＝有人寫過的清單，推導＝由標準疾病頁模板自動產生。</caption>
    <thead><tr><th scope="col">疾病</th><th scope="col">法定類別</th><th scope="col">疾病頁</th><th scope="col" class="num">已移轉</th><th scope="col" class="num">已併入</th><th scope="col" class="num">待移轉</th><th scope="col">進度</th><th scope="col">方式</th><th scope="col">權責單位</th><th scope="col">下載</th></tr></thead>
    ${m.listRows.map((r, i) => html`<tbody class="mg-list" data-list-row="${r.id}" data-has="${r.hasPage == null ? '-' : r.hasPage ? '1' : '0'}" data-mode="${r.derived ? 'derived' : 'curated'}" data-owner="${r.owner ?? ''}" data-pending="${r.c.pending}" data-total="${r.c.total}" data-pct="${r.donePct}" data-name="${r.name}" data-cat="${r.legalCategory ?? 9}" data-order="${i}" data-q="${`${r.name} ${r.nameEn} ${r.slug} ${r.ownerName} ${r.id}`.toLowerCase()}">
      <tr class="mg-list__row">
        <th scope="row"><button type="button" class="mg-toggle" aria-expanded="false" aria-controls="mg-ex-${r.slug}" data-toggle="${r.id}"><span class="mg-toggle__ic" aria-hidden="true">▸</span><span class="mg-toggle__t">${r.name}</span><span class="sr-only">，展開逐筆對照</span></button>${r.nameEn ? html`<div class="adm-muted mg-en" lang="en">${r.nameEn}</div>` : ''}</th>
        <td>${catLabel(r.legalCategory)}</td>
        <td>${r.hasPage === true ? html`<a href="${url(r.front ?? '/diseases/', {})}" class="adm-badge adm-badge--ok">有頁</a>` : r.hasPage === false ? html`<span class="adm-badge adm-badge--warn">尚無</span>` : html`<span class="adm-badge adm-badge--gray">專區</span>`}</td>
        <td class="num">${r.c.migrated}</td><td class="num">${r.c.merged}</td><td class="num ${r.c.pending ? 'adm-yellow' : ''}"><strong>${r.c.pending}</strong></td>
        <td class="mg-prog">${stack(r.c, { cls: 'mg-stack--sm' })}<span class="adm-muted">${r.donePct}%</span></td>
        <td>${r.derived ? html`<span class="adm-badge adm-badge--info">推導</span>` : html`<span class="adm-badge adm-badge--ok">人工</span>`}</td>
        <td>${r.ownerName}</td>
        <td><a href="${url(r.download, { noLang: true })}" download data-dl="${r.slug}"><code>${r.slug}.json</code></a></td>
      </tr>
      <tr class="mg-list__ex" id="mg-ex-${r.slug}" hidden><td colspan="10">
        <div class="mg-ex__head">
          <p class="adm-muted">${r.legacyRoot ? html`舊專區入口 <code>${String(r.legacyRoot).replace(/^https?:\/\//, '')}</code> · ` : ''}新頁揭露至 ${r.showLegacyUntil ?? '—'}${(() => { const left = daysTo(site.today, r.showLegacyUntil); return left != null ? ` ${left >= 0 ? `（${left} 日）` : '（已隱藏）'}` : ''; })()} · 共 ${r.c.total} 筆，已核對網址 ${r.c.verified} / ${r.c.total}。${r.hasPage === false ? '這種疾病還沒有疾病頁，所有舊頁都待移轉；建立疾病頁後清單會自動重新推導。' : ''}</p>
          <label class="mg-ex__pend"><input type="checkbox" data-only-pending> 只看待移轉</label>
        </div>
        ${itemsTable(ctx, r)}
      </td></tr>
    </tbody>`)}
  </table></div>
  <noscript><style>.mg-list__ex[hidden]{display:table-row}</style></noscript>
</section>

<section class="adm-card" aria-labelledby="mg-todo"><h2 id="mg-todo">待辦連動</h2>
  ${todos.length ? html`<p>有 <strong>${todos.length}</strong> 則「舊頁待移轉」待辦（每份清單最多一則，依法定類別排優先度）。逐筆決定去向並改狀態後，下次建置待辦自動消失。</p>
    <ul>${todos.slice(0, 6).map((x) => html`<li>${x.ownerName}：${x.itemTitle}${x.dueAt ? html` <span class="adm-muted">期限 ${x.dueAt}</span>` : ''}</li>`)}</ul>`
    : html`<div class="adm-box adm-box--ok"><strong>目前沒有「舊頁待移轉」待辦</strong>${t.pending ? '待確認的項目還沒有指定權責單位，所以沒有產生待辦。' : '所有舊頁都已有去向。'}</div>`}
  <p><a class="adm-btn adm-btn--ghost adm-btn--sm" href="${url('/admin/todos/#migration-pending', { noLang: true })}">到連動待辦處理 →</a></p>
</section>

<section class="adm-card" aria-labelledby="mg-ex"><h2 id="mg-ex">匯出對照</h2>
  <p class="adm-card__sub">都是建置時由移轉清單轉出的靜態檔，只含網址完整、已有去向的項目；待確認或網址仍是佔位的不輸出（推導清單的舊網址都是 {id} 佔位，所以只出現在 /legacy/ 的模式比對與文件，不進伺服器檔）。</p>
  <ul class="adm-kv" style="list-style:none;padding:0">${EXPORTS.map((e) => html`<li><a href="${url(e.path, { noLang: true })}" data-export="${url(e.path, { noLang: true })}"><code>${e.label}</code></a> <span class="adm-muted">${e.note}</span> <button type="button" class="adm-btn adm-btn--ghost adm-btn--sm" data-preview="${url(e.path, { noLang: true })}">預覽前 8 行</button></li>`)}</ul>
  <pre class="adm-pre" id="mg-preview" tabindex="0" hidden></pre>
  <p class="adm-muted">舊網址進站後的行為與保留期說明見前台 <a href="${url('/legacy/', { noLang: true })}">舊網址查詢頁</a>；404 log 分析用 <code>node scripts/analyze-404-log.mjs &lt;access.log&gt;</code>，找出還沒有對照的舊網址。</p>
</section>`;
}

void raw;
void listStats;
