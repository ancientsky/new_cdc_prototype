// /admin/todos/ 連動待辦（規劃 7.7）：正本修訂、反向稽核、逾期、翻譯過期、資料集逾期、授權缺漏
import { html } from '../../../scripts/lib/render.mjs';
import { pageHead, adminMeta, unitOptions, KIND_LABEL, KIND_ORDER, todoList, frontPath, daysBetween, mediaRows } from './_partials.mjs';
export { layout } from './_layout.mjs';

export function pages() { return [{ path: '/admin/todos/', props: {}, noindex: true }]; }
export function meta() { return adminMeta('連動待辦', 'todos', ['/assets/js/admin/todos.js']); }

const MAIN_KINDS = ['based-on-revised', 'reverse-audit', 'overdue', 'translation-stale', 'dataset-overdue', 'license-missing', 'media-outdated', 'media-no-transcript', 'link-broken', 'labtest-inconsistent'];

function mmrCard(site, url) {
  const fam = 'doc.mmr-recommendation';
  const versions = site.collections.documents.filter((d) => d.family === fam);
  const oldDoc = versions.find((d) => d.gov?.superseded);
  const curDoc = versions.find((d) => d.gov?.isCurrent && !d.gov?.superseded);
  const news = site.all.find((i) => (i.basedOn ?? []).includes(fam) && i.type === 'news' && (i.gov?.stale?.length || i.gov?.predatesBasis));
  if (!oldDoc || !curDoc || !news) return null;
  const hits = news.gov.reverseAuditHits ?? [];
  const evalQs = (site.governance.evalSet?.questions ?? []).filter((q) => q.category === 'version');
  // 第 6 點：影音（讀 collections.media，沒有也不報錯）
  const famIds = new Set(versions.map((d) => d.id).concat(fam));
  const vids = mediaRows(site).filter((m) => m.basedOn.some((b) => famIds.has(b)));
  const oldVid = vids.filter((m) => m.outdated).sort((a, b) => String(a.producedAt).localeCompare(String(b.producedAt)))[0];
  const newVid = vids.filter((m) => !m.outdated && m.producedAt >= curDoc.effectiveAt).sort((a, b) => String(b.producedAt).localeCompare(String(a.producedAt)))[0];
  const ym = (d) => String(d ?? '').slice(0, 7);
  const vr = site.evalReport?.byCategory?.version;
  const mark = (ok) => html`<span class="${ok ? 'adm-green' : 'adm-red'}" aria-label="${ok ? '已自動完成' : '本次建置未見'}">${ok ? '✓' : '✗'}</span>`;
  const step = (ok, text, link) => html`<li>${mark(ok)} ${text}${link ? html` <a href="${link[1]}">${link[0]}</a>` : ''}</li>`;
  const oldWl = oldDoc.gov.whitelist.effective, newsWl = news.gov.whitelist.effective;
  return html`<section class="adm-card" aria-labelledby="mmr-h" style="border-left:6px solid var(--status-rising)"><h2 id="mmr-h">MMR 事件示範：正本修訂後，系統自動做了什麼</h2>
  <p>《${curDoc.title}》於 ${curDoc.effectiveAt}（114.04.16）修訂，成人評估對象由「1981 年」改為「1966 年（含）以後出生」。從建置那一刻起，<strong>下列事項全部由治理引擎自動完成，不需要任何人記得去做</strong>：</p>
  <ol class="adm-kv" style="list-style:none;padding:0">
    ${step(oldDoc.gov.superseded && oldDoc.gov.noindex !== false, html`舊版（${oldDoc.version}）自動 <code>noindex</code>、頁首紅色警示「已由新版取代」，並加入 301 對照。`, ['看舊版頁面', url(frontPath(oldDoc))])}
    ${step((news.gov.annotations ?? []).some((a) => a.kind === 'based-on-revised'), html`${news.publishedAt} 新聞稿頁首自動加註「所依據的建議已於 ${curDoc.effectiveAt} 修訂，現行版請見…」（內文不改）。`, ['看新聞稿頁面', url(frontPath(news))])}
    ${step(!oldWl && !newsWl, html`該新聞稿與舊版自動退出 AI 白名單：答案頁不會再引用它們。`, ['用 /ask/ 驗證', url('/ask/?q=' + encodeURIComponent('幾年次以後出生的成人需要評估接種 MMR？'))])}
    ${step(hits.length > 0, html`反向稽核掃全站文字，找出殘留的「${hits[0]?.term ?? '1981 年'}」${hits.length ? html`（${news.title.slice(0, 18)}…）` : ''}並產生待辦給承辦單位。`)}
    ${step(evalQs.length > 0, html`版本題已進評估集（${evalQs.length} 題，${vr ? `本次建置 ${vr.passed}/${vr.total} 通過` : '待評估'}）；版本題未 100% 通過，build 直接失敗，不能上線。`, ['看評估結果', url('/admin/eval/', { noLang: true })])}
    ${step(!!oldVid, html`${oldVid ? html`候診衛教影片《${oldVid.title}》（${ym(oldVid.producedAt)}，標示依 ${oldVid.label || '舊版'}）` : html`候診衛教影片（2025-01）`}自動標「影片過時」：影片頁加註「建議已於 ${curDoc.effectiveAt} 修訂」、退出 AI 白名單、產生「影音過時」待辦。${newVid ? html`${ym(newVid.producedAt)} 重製版《${newVid.title}》已依 ${curDoc.version}（${curDoc.effectiveAt}）製作，不再過時。` : html`2026-10 重製版依 ${curDoc.version} 製作後，待辦自動消失。`}${oldVid ? '' : '（本次建置尚未載入影音示範內容）'}`, oldVid ? ['看影音管理', url('/admin/media/', { noLang: true })] : null)}
  </ol>
  <p class="adm-muted">對照：現行版 <a href="${url(frontPath(curDoc))}">${curDoc.title}</a>；承辦單位只需要回應下方「依據正本已修訂」「反向稽核命中」兩張待辦（7 日內）。</p></section>`;
}

export function render(ctx) {
  const { site, url } = ctx;
  const todos = todoList(site);
  const kinds = [...MAIN_KINDS, ...KIND_ORDER.filter((k) => !MAIN_KINDS.includes(k) && todos.some((t) => t.kind === k)), ...[...new Set(todos.map((t) => t.kind))].filter((k) => !KIND_ORDER.includes(k))];
  const kindName = (k) => KIND_LABEL[k] ?? todos.find((t) => t.kind === k)?.kindLabel ?? k;
  const rowOf = (t) => {
    const it = site.byId.get(t.itemId);
    const href = t.href ?? (it ? frontPath(it) : null);
    const d = t.dueAt ? daysBetween(site.today, t.dueAt) : null;
    return html`<tr data-id="${t.id}" data-owner="${t.owner}" data-kind="${t.kind}">
      <td>${t.ownerName}</td>
      <td><span class="adm-title"><strong>${t.itemTitle}</strong></span><div class="adm-muted"><code>${t.itemId}</code></div><div>${t.text}</div></td>
      <td>${t.dueAt ?? '—'}</td>
      <td>${t.overdue ? html`<span class="adm-badge adm-badge--bad">逾期 ${d != null ? -d : ''} 日</span>` : d != null ? html`<span class="adm-badge adm-badge--${d <= 7 ? 'warn' : 'gray'}">${d} 日內</span>` : '—'}${t.severity === 'high' ? html` <span class="adm-badge adm-badge--revised">高</span>` : ''}</td>
      <td>${href ? html`<a href="${url(href)}">前往頁面</a>` : '—'}</td>
      <td><label class="adm-pill"><input type="checkbox" data-done="${t.id}"><span>完成（示範）</span></label></td></tr>`;
  };
  return html`
${pageHead({ title: '連動待辦', what: '系統依內容欄位自動產生的待辦：依據的正本改版、反向稽核命中舊說法、審閱逾期、譯文過期、資料集沒按頻率更新、授權標示不標準、影音依據的正本已修訂、影音沒有逐字稿、外部連結失效、檢驗項目時限與主檔不一致。每筆有承辦單位、期限與前往頁面。', flow: '待辦來自建置時的治理引擎（/v1/governance/todos.json）。承辦單位修正內容並開 PR，合併後重新建置，待辦自動消失；「完成（示範）」只在本機打勾。' })}
${mmrCard(site, url) ?? html`<div class="adm-box adm-box--info"><strong>MMR 事件示範</strong>本次建置的內容不含 MMR 正本修訂範例。</div>`}
<section class="adm-card" aria-labelledby="t-h"><h2 id="t-h">待辦清單</h2>
  <div class="adm-filters"><div class="adm-field"><label for="t-unit">單位</label><select id="t-unit">${unitOptions(site, { all: true, selected: 'all' })}</select></div>
    <label class="adm-pill" style="align-self:end"><input type="checkbox" id="t-hide-done"><span>隱藏已完成（示範）</span></label><span class="adm-count-note" id="t-note" aria-live="polite"></span></div>
  <div class="adm-tabs" role="tablist" aria-label="待辦類型">${kinds.map((k, i) => html`<button type="button" role="tab" id="tab-${k}" aria-controls="panel-${k}" aria-selected="${i === 0 ? 'true' : 'false'}" tabindex="${i === 0 ? '0' : '-1'}" data-kind="${k}">${kindName(k)}<span class="adm-count" data-kcount="${k}">${todos.filter((t) => t.kind === k).length}</span></button>`)}</div>
  ${kinds.map((k, i) => { const list = todos.filter((t) => t.kind === k); return html`<div role="tabpanel" id="panel-${k}" aria-labelledby="tab-${k}" data-panel="${k}" ${i === 0 ? '' : 'hidden'}>
    <div class="adm-tablewrap"><table class="adm-table"><thead><tr><th scope="col">單位</th><th scope="col">內容</th><th scope="col">期限</th><th scope="col">狀態</th><th scope="col">前往</th><th scope="col">處理</th></tr></thead><tbody>${list.map(rowOf)}</tbody></table></div>
    <p class="adm-empty" data-empty ${list.length ? 'hidden' : ''}>這一類目前沒有待辦。</p></div>`; })}
</section>`;
}
