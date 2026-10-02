// /admin/ 治理儀表板（規劃 7.5 KPI、待辦、白名單、AI 狀態、態勢層延遲、各單位卡、季報匯出）
import { html } from '../../../scripts/lib/render.mjs';
import { migrationData } from './_migration.mjs';
import { pageHead, dataScript, adminMeta, KIND_LABEL, KIND_ORDER, todoList, sitGov, byOwnerRows, kpiProgress, fmtNum, noticeRows, mediaRows, linkRows, linkCounts } from './_partials.mjs';
export { layout } from './_layout.mjs';

export function pages() { return [{ path: '/admin/', props: {}, noindex: true }]; }
export function meta() { return adminMeta('治理儀表板', 'dashboard', ['/assets/js/admin/dashboard.js']); }

export function render(ctx) {
  const { site, url } = ctx;
  const todos = todoList(site);
  const sg = sitGov(site);
  const kpi = site.gov?.kpi ?? [];
  const owners = byOwnerRows(site).filter((o) => o.content > 0 || o.todos > 0);
  const overdueTodos = todos.filter((t) => t.overdue).length;
  const kinds = [...new Set([...KIND_ORDER.filter((k) => todos.some((t) => t.kind === k)), ...todos.map((t) => t.kind)])];
  const kindName = (k) => KIND_LABEL[k] ?? todos.find((t) => t.kind === k)?.kindLabel ?? k;
  const ai = site.governance.aiStatus;
  const reviewN = site.all.filter((i) => i.status === 'review').length;
  const wlPct = site.gov.totalPublished ? Math.round((site.gov.whitelistCount / site.gov.totalPublished) * 100) : 0;
  const tile = (label, value, note, tone = '') => html`<div class="adm-stat ${tone ? `adm-stat--${tone}` : ''}"><p class="adm-stat__label">${label}</p><p class="adm-stat__value">${value}</p><p class="adm-stat__note">${note}</p></div>`;
  // 第二輪：公告／影音／外部連結小卡（數字優先採引擎算好的 gov，否則由欄位推算）
  const notices = noticeRows(site);
  const nOpen = notices.filter((n) => n.open).length, nSoon = notices.filter((n) => n.closingSoon && !n.closed && n.status === 'published').length, nClosed = notices.filter((n) => n.closed && !n.archived).length;
  const media = mediaRows(site);
  const mTr = media.filter((m) => m.hasTranscript).length, mCur = media.filter((m) => m.basisCurrent).length;
  const lc = linkCounts(linkRows(site));
  const mg = migrationData(site);
  const extra = { notices: { open: nOpen, soon: nSoon, closedUnarchived: nClosed, total: notices.length }, media: { total: media.length, transcript: mTr, current: mCur }, links: lc };
  const data = {
    extra, today: site.today, kpi, todos: todos.map(({ id, kind, owner, ownerName, itemTitle, dueAt, overdue }) => ({ id, kind, owner, ownerName, itemTitle, dueAt, overdue })),
    kindNames: Object.fromEntries(kinds.map((k) => [k, kindName(k)])), owners, whitelist: { effective: site.gov.whitelistCount, published: site.gov.totalPublished },
    ai: { paused: !!ai.paused, reason: ai.reason ?? '', mode: ai.mode, updatedAt: ai.updatedAt }, situation: sg, review: reviewN,
    eval: site.evalReport ? { total: site.evalReport.total, passed: site.evalReport.passed, version: site.evalReport.byCategory?.version ?? null, metrics: site.evalReport.metrics ?? {} } : null,
  };
  return html`
${pageHead({ title: '治理儀表板', what: '署內治理的一頁總覽：品質指標、系統產生的待辦、AI 白名單、AI 開關、態勢層資料延遲與各單位現況。所有數字都是建置時由內容欄位算出，沒有人工填報。', flow: '每日排程建置 → 治理引擎重算 → 本頁與 /v1/governance/*.json 同步更新；季報由此匯出貼進資料治理會議資料。' })}
<div class="adm-grid adm-grid--4" style="margin-bottom:var(--sp-5)">
  ${tile('AI 白名單生效', html`${site.gov.whitelistCount}<small style="font-size:var(--fs-md)"> / ${site.gov.totalPublished}</small>`, `已發布內容的 ${wlPct}%；其餘為逾期、失效、依據已修訂或未申請`, 'info')}
  ${tile('系統待辦', todos.length, `${overdueTodos} 件已逾期；已在本機標完成者見下方`, overdueTodos ? 'bad' : todos.length ? 'warn' : 'ok')}
  ${tile('AI 問答狀態', html`<span id="dash-ai">${ai.paused ? '暫停中' : '運作中'}</span>`, html`<span id="dash-ai-note">${ai.paused ? `原因：${ai.reason || '—'}` : `模式：${ai.mode === 'llm' ? 'LLM' : '抽取式'}；前往「AI 開關」可暫停`}</span>`, ai.paused ? 'bad' : 'ok')}
  ${tile('態勢層資料日', sg.dataDate ?? '—', sg.lagDays != null ? `延遲 ${sg.lagDays} 日${sg.overdue ? `；已過下次審閱日 ${sg.nextReviewAt}` : `；下次審閱 ${sg.nextReviewAt ?? '—'}`}` : '尚無資料', sg.overdue || (sg.lagDays ?? 0) > 7 ? 'bad' : (sg.lagDays ?? 0) > 1 ? 'warn' : 'ok')}
</div>

<div class="adm-grid adm-grid--4" style="margin-bottom:var(--sp-5)" aria-label="公告、影音、外部連結與移轉進度">
  <section class="adm-minicard ${nClosed ? 'adm-minicard--warn' : 'adm-minicard--ok'}" aria-labelledby="mc-n"><h3 id="mc-n">公告 <a href="${url('/admin/notices/', { noLang: true })}">公告管理 →</a></h3>
    <dl><dt>進行中</dt><dd>${nOpen}</dd><dt>7 日內截止</dt><dd class="${nSoon ? 'adm-yellow' : ''}">${nSoon}</dd><dt>已截止未封存</dt><dd class="${nClosed ? 'adm-red' : ''}">${nClosed}</dd></dl>
    <p>人才招募、採購公告、其他訊息共 ${notices.length} 則；截止後系統自動標「已截止」並退出首頁。</p></section>
  <section class="adm-minicard ${media.length && (mTr < media.length || mCur < media.length) ? 'adm-minicard--warn' : 'adm-minicard--ok'}" aria-labelledby="mc-m"><h3 id="mc-m">影音 <a href="${url('/admin/media/', { noLang: true })}">影音管理 →</a></h3>
    <dl><dt>影片總數</dt><dd>${media.length}</dd><dt>有逐字稿</dt><dd class="${media.length && mTr < media.length ? 'adm-red' : ''}">${mTr} / ${media.length}</dd><dt>依據正本現行版</dt><dd class="${media.length && mCur < media.length ? 'adm-red' : ''}">${mCur} / ${media.length}</dd></dl>
    <p>逐字稿與依據正本是影音上架的必填欄位；正本修訂後過時的影片自動產生待辦。</p></section>
  <section class="adm-minicard ${lc.broken ? 'adm-minicard--bad' : lc.unchecked && lc.unchecked === lc.total ? 'adm-minicard--warn' : 'adm-minicard--ok'}" aria-labelledby="mc-l"><h3 id="mc-l">外部連結 <a href="${url('/admin/links/', { noLang: true })}">連結健康 →</a></h3>
    <dl><dt>ok</dt><dd>${lc.ok}</dd><dt>broken</dt><dd class="${lc.broken ? 'adm-red' : ''}">${lc.broken}</dd><dt>unchecked</dt><dd>${lc.unchecked}</dd></dl>
    <p>共 ${lc.total} 條；CI 每日 <code>npm run fetch -- --check-links</code>，失效自動變待辦。</p></section>
  <section class="adm-minicard ${mg.total.pending ? 'adm-minicard--warn' : mg.lists.length ? 'adm-minicard--ok' : ''}" aria-labelledby="mc-g" id="dash-migration"><h3 id="mc-g">移轉進度 <a href="${url('/admin/migration/', { noLang: true })}">逐筆對照 →</a></h3>
    ${mg.lists.length ? html`<dl><dt>整體進度</dt><dd>${mg.total.done} / ${mg.total.total} <span class="adm-muted">(${mg.donePct}%)</span></dd><dt>清單</dt><dd>${mg.summary.lists} 份 <span class="adm-muted">推導 ${mg.summary.derived}・人工 ${mg.summary.curated}</span></dd><dt>待移轉</dt><dd class="${mg.total.pending ? 'adm-yellow' : ''}">${mg.total.pending}</dd><dt>尚無疾病頁</dt><dd class="${mg.summary.noPage ? 'adm-yellow' : ''}">${mg.summary.noPage} 種</dd><dt>舊頁總數</dt><dd>${mg.total.total}</dd></dl>
    <div class="adm-stack adm-stack--card" role="img" aria-label="整體進度 ${mg.donePct}%，待移轉 ${mg.total.pending} 筆"><i class="adm-stack__ok" style="width:${mg.donePct}%"></i></div>
    <p>每種傳染病一份清單，標準子頁由模板推導；已移轉的舊網址由伺服器 301 與 404 頁自動導到新頁。</p>` : html`<p>尚未建立移轉清單（content/migration/）。建立後這裡顯示舊頁處理進度與待確認數。</p>`}</section>
</div>

<section class="adm-card" aria-labelledby="kpi-h"><h2 id="kpi-h">品質指標（規劃 7.5）</h2>
  <p class="adm-card__sub">目前值由引擎計算；條的深色刻度＝第一年目標。第一年／第三年目標為規劃文件設定值。</p>
  <div class="adm-tablewrap"><table class="adm-table"><caption>資料來源：/v1/governance/kpi.json（建置日 ${site.today}）</caption>
    <thead><tr><th scope="col">指標</th><th scope="col" class="num">目前</th><th scope="col" class="num">第一年目標</th><th scope="col" class="num">第三年目標</th><th scope="col">進度</th><th scope="col">說明</th></tr></thead>
    <tbody>${kpi.map((k) => {
      const pr = kpiProgress(k);
      const tone = k.status === 'ok' ? '' : k.status === 'warn' ? 'adm-bar--warn' : k.status === 'bad' ? 'adm-bar--bad' : '';
      const mark = k.target1y != null && k.target3y ? (k.direction === 'lower' ? null : Math.min(100, Math.round((k.target1y / k.target3y) * 100))) : null;
      return html`<tr><th scope="row" style="font-weight:600">${k.label}</th>
        <td class="num ${k.status === 'bad' ? 'adm-red' : ''}">${k.current == null ? html`<span class="adm-muted">${k.key === 'link-health' ? '尚未執行檢查' : '待量測'}</span>` : html`<strong>${fmtNum(k.current, k.unit)}</strong>${k.unit && k.unit !== '%' ? html` <span class="adm-muted">${k.unit}</span>` : ''}`}${k.numerator != null && k.denominator != null && k.unit === '%' ? html`<div class="adm-muted">${k.numerator}/${k.denominator}</div>` : ''}</td>
        <td class="num">${k.target1y == null ? '—' : `${k.direction === 'lower' ? '≤ ' : ''}${fmtNum(k.target1y, k.unit)}${k.unit && k.unit !== '%' ? ` ${k.unit}` : ''}`}</td>
        <td class="num">${k.target3y == null ? '—' : `${k.direction === 'lower' ? '≤ ' : ''}${fmtNum(k.target3y, k.unit)}${k.unit && k.unit !== '%' ? ` ${k.unit}` : ''}`}</td>
        <td>${pr == null ? html`<span class="adm-muted">—</span>` : html`<div class="adm-bar ${tone}" role="img" aria-label="進度 ${pr}%"><i style="width:${pr}%"></i>${mark != null && mark < 100 ? html`<b style="left:${mark}%"></b>` : ''}</div>`}</td>
        <td class="adm-muted">${k.note ?? ''}</td></tr>`;
    })}</tbody></table></div></section>

<div class="adm-split adm-split--even">
<section class="adm-card" aria-labelledby="td-h"><h2 id="td-h">待辦：依類型與單位</h2>
  <p class="adm-card__sub">待辦由引擎依欄位產生，不靠人記得。完成後（示範）只在本機標記，正式環境以 PR 更新欄位後待辦自然消失。 <span id="dash-done"></span></p>
  ${todos.length ? html`<div class="adm-tablewrap"><table class="adm-table"><thead><tr><th scope="col">單位</th>${kinds.map((k) => html`<th scope="col" class="num">${kindName(k)}</th>`)}<th scope="col" class="num">合計</th></tr></thead>
    <tbody>${[...new Set(todos.map((t) => t.owner))].map((o) => html`<tr><th scope="row" style="font-weight:600">${todos.find((t) => t.owner === o).ownerName}</th>${kinds.map((k) => { const n = todos.filter((t) => t.owner === o && t.kind === k).length; return html`<td class="num">${n || html`<span class="adm-muted">0</span>`}</td>`; })}<td class="num"><strong>${todos.filter((t) => t.owner === o).length}</strong></td></tr>`)}
    <tr><th scope="row">合計</th>${kinds.map((k) => html`<td class="num"><strong>${todos.filter((t) => t.kind === k).length}</strong></td>`)}<td class="num"><strong>${todos.length}</strong></td></tr></tbody></table></div>
    <p><a class="adm-btn adm-btn--ghost adm-btn--sm" href="${url('/admin/todos/', { noLang: true })}">處理待辦 →</a></p>` : html`<div class="adm-box adm-box--ok"><strong>目前沒有系統待辦</strong>所有內容都在審閱期內、沒有失效或依據已修訂。</div>`}
</section>
<section class="adm-card" aria-labelledby="u-h"><h2 id="u-h">各單位現況</h2>
  <p class="adm-card__sub">依權責單位聚合；目前身分的單位會標示。</p>
  <div class="adm-grid adm-grid--auto" id="unit-cards">${owners.map((o) => html`<article class="adm-unitcard" data-unit="${o.unit}"><h3>${o.name} <span class="adm-badge adm-badge--ok" hidden data-me>我的單位</span></h3>
    <dl><dt>內容</dt><dd>${o.content}</dd><dt>已發布</dt><dd>${o.published}</dd><dt>AI 白名單生效</dt><dd>${o.whitelist}</dd><dt>逾期未審</dt><dd class="${o.overdue ? 'adm-red' : ''}">${o.overdue}</dd><dt>30 日內到期</dt><dd>${o.dueSoon ?? 0}</dd><dt>依據已修訂</dt><dd class="${o.stale ? 'adm-red' : ''}">${o.stale}</dd><dt>待辦（逾期）</dt><dd class="${o.todosOverdue ? 'adm-red' : ''}">${o.todos}${o.todosOverdue ? ` (${o.todosOverdue})` : ''}</dd></dl></article>`)}</div>
</section>
</div>

<section class="adm-card" aria-labelledby="q-h"><h2 id="q-h">季報匯出</h2>
  <p class="adm-card__sub">產生 Markdown，直接貼進資料治理會議資料。內容是現在這個建置的數字（${site.today}）加上你本機的 AI 開關覆寫與待辦完成標記。</p>
  <div class="adm-actions" style="margin-top:0"><button type="button" class="adm-btn" id="q-gen">產生季報 Markdown</button><button type="button" class="adm-btn adm-btn--ghost" id="q-copy" disabled>複製</button><button type="button" class="adm-btn adm-btn--ghost" id="q-dl" disabled>下載 .md</button></div>
  <pre class="adm-pre" id="q-out" tabindex="0" hidden></pre>
</section>
${dataScript('adm-dash-data', data)}`;
}
