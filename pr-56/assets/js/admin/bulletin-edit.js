// /admin/bulletin/edit/ 疫情報導文章上架：只做 DOM 綁定；組物件、切段、檢核都在 bulletin-edit-core.js（純函式，有測試）。
import { $, $$, esc, store, readEmbedded, copyText, downloadText, debounce } from './common.js';
import { initPagePreview } from './page-preview.js';
import { zipBlob } from './zip-store.js';
import { mdToHtml } from './md-convert.js';
import {
  emptyState, stateFromArticle, applyManuscript, buildArticle, resolveIssue, problemsOf, hasErrors, suggestNextIssue, suggestArticleNo, sectionKeyFor,
  tocPreviewRows, packageEntries, exportFilename, issueFilename, renderArticlePreview, renderTocPreview, TE_FIELD_MAP,
} from './bulletin-edit-core.js';

const D = readEmbedded('adm-bulletin-data', { today: '', siteBase: '', issues: [], articles: [], units: [], diseases: [], articleTypes: {}, pdfMaxBytes: 20 * 1048576 });
const KEY = 'cdc.admin.bulletin-edit';
const TODAY = D.today;
const unitName = (id) => D.units.find((u) => u.id === id)?.name ?? id;
const diseaseName = (id) => D.diseases.find((d) => d.id === id)?.name ?? id;
const md = (m) => mdToHtml(m, { marked: window.marked });

let state = emptyState({ today: TODAY });
let base = null; // 修改中的既有文章
let pdf = null; // { name, bytes }
let PV = null;

/* ───────── 簡單欄位 ───────── */
const SIMPLE = {
  issueId: '#te-issue', newVolume: '#te-vol', newIssue: '#te-iss', newDate: '#te-date', articleNo: '#te-no', articleType: '#te-type', pages: '#te-pages',
  title: '#te-title', titleEn: '#te-titleen', authors: '#te-authors', owner: '#te-owner', doi: '#te-doi', keywords: '#te-keywords', summary: '#te-summary',
  manuscript: '#te-manuscript', abstract: '#te-abstract', known: '#te-known', added: '#te-added', implications: '#te-implications',
  references: '#te-refs', acknowledgements: '#te-ack', pdfUrl: '#te-pdfurl', note: '#te-note',
};
function fill(st) {
  state = st;
  for (const [k, sel] of Object.entries(SIMPLE)) { const el = $(sel); if (el) el.value = st[k] ?? ''; }
  $('#te-issue').value = st.issueMode === 'new' ? '__new' : (st.issueId || '__new');
  if ($('#te-issue').value !== (st.issueMode === 'new' ? '__new' : st.issueId)) $('#te-issue').value = '__new';
  $('#te-newissue').hidden = $('#te-issue').value !== '__new';
  $('#te-pick').value = base?.id ?? 'new';
  renderRows('sections'); renderRows('figures'); renderChips();
}
function read() {
  const st = { ...state };
  for (const [k, sel] of Object.entries(SIMPLE)) { const el = $(sel); if (el) st[k] = el.value; }
  st.issueMode = $('#te-issue').value === '__new' ? 'new' : 'existing';
  if (st.issueMode === 'new') st.issueId = '';
  st.sections = readRows('sections'); st.figures = readRows('figures');
  st.pdfFile = pdf?.name ?? '';
  state = st;
  return st;
}

/* ───────── 動態列：段落、圖表 ───────── */
const ROWS = {
  sections: {
    root: '#te-sections', list: () => state.sections,
    row: (x, i, all) => `<div class="adm-te-row" data-i="${i}"><div class="adm-te-row__head"><span class="adm-te-row__no">${i + 1}</span><input type="text" class="adm-input adm-te-row__h" data-k="heading" value="${esc(x.heading)}" placeholder="段落標題，例：材料與方法" aria-label="第 ${i + 1} 段標題"><label class="adm-te-row__lv"><input type="checkbox" data-k="level" ${x.level === 3 ? 'checked' : ''}> 小標（h3）</label><span class="adm-te-row__tools"><button type="button" class="adm-btn adm-btn--ghost adm-btn--sm" data-move="sections:${i}:-1" aria-label="第 ${i + 1} 段往上" ${i === 0 ? 'disabled' : ''}>↑</button><button type="button" class="adm-btn adm-btn--ghost adm-btn--sm" data-move="sections:${i}:1" aria-label="第 ${i + 1} 段往下" ${i === all.length - 1 ? 'disabled' : ''}>↓</button><button type="button" class="adm-btn adm-btn--ghost adm-btn--sm" data-del="sections:${i}" aria-label="刪除第 ${i + 1} 段">刪除</button></span></div><textarea class="adm-te-row__body" data-k="markdown" rows="6" aria-label="第 ${i + 1} 段內文（Markdown）" placeholder="內文（Markdown）">${esc(x.markdown)}</textarea><span class="adm-hint">key：<code>${esc(x.key || '（自動）')}</code>　${(x.markdown ?? '').length} 字</span></div>`,
    blank: () => ({ key: '', heading: '', markdown: '' }),
  },
  figures: {
    root: '#te-figures', list: () => state.figures,
    row: (f, i) => `<div class="adm-te-row adm-te-fig" data-i="${i}"><div class="adm-te-row__head"><select class="adm-input" data-k="kind" aria-label="圖或表"><option value="figure" ${f.kind !== 'table' ? 'selected' : ''}>圖</option><option value="table" ${f.kind === 'table' ? 'selected' : ''}>表</option></select><input type="number" class="adm-input adm-te-fig__no" data-k="no" min="1" value="${esc(f.no)}" aria-label="編號"><input type="text" class="adm-input adm-te-row__h" data-k="caption" value="${esc(f.caption)}" placeholder="說明，例：各菜色罹病率與罹病率比" aria-label="圖表說明"><span class="adm-te-row__tools"><button type="button" class="adm-btn adm-btn--ghost adm-btn--sm" data-del="figures:${i}" aria-label="刪除這個圖表">刪除</button></span></div><div class="adm-grid adm-grid--2"><input type="text" class="adm-input" data-k="file" value="${esc(f.file)}" placeholder="圖檔名（選填，例：fig1.png）" aria-label="圖檔名"><input type="text" class="adm-input" data-k="alt" value="${esc(f.alt)}" placeholder="圖的替代文字（一句話說圖在講什麼）" aria-label="替代文字"></div><textarea class="adm-te-row__body" data-k="markdown" rows="4" aria-label="表格內容或圖的文字版（Markdown）" placeholder="表格內容（Markdown 表格）或圖的文字版數據">${esc(f.markdown)}</textarea></div>`,
    blank: (kind = 'figure') => ({ kind, no: String(state.figures.filter((f) => f.kind === kind).length + 1), caption: '', markdown: '', alt: '', file: '' }),
  },
};
function renderRows(kind) { const R = ROWS[kind]; const list = R.list(); $(R.root).innerHTML = list.length ? list.map((x, i) => R.row(x, i, list)).join('') : `<p class="adm-muted">${kind === 'sections' ? '還沒有段落。' : '沒有圖表。'}</p>`; }
function readRows(kind) {
  const old = ROWS[kind].list();
  return $$(`${ROWS[kind].root} .adm-te-row`).map((row, i) => {
    const o = { ...(old[i] ?? {}) };
    for (const el of $$('[data-k]', row)) { if (el.type === 'checkbox') o[el.dataset.k] = el.checked ? 3 : undefined; else o[el.dataset.k] = el.value; }
    if (kind === 'sections' && !o.key && o.heading) o.key = sectionKeyFor(o.heading, old.slice(0, i).map((y) => y.key).filter(Boolean));
    return o;
  });
}

/* ───────── 傳染病 chips ───────── */
function renderChips() {
  $('#te-dis-chips').innerHTML = state.diseases.map((d) => `<li class="adm-chip">${esc(diseaseName(d))} <button type="button" data-rm-dis="${esc(d)}" aria-label="移除 ${esc(diseaseName(d))}">×</button></li>`).join('');
}
const disQ = $('#te-dis-q'), disList = $('#te-dis-list');
disQ.addEventListener('input', () => {
  const q = disQ.value.trim().toLowerCase();
  const hits = q ? D.diseases.filter((d) => !state.diseases.includes(d.id) && (d.name.toLowerCase().includes(q) || d.id.includes(q))).slice(0, 8) : [];
  disList.innerHTML = hits.map((d) => `<li role="option" tabindex="-1" data-dis="${esc(d.id)}">${esc(d.name)} <code>${esc(d.id)}</code></li>`).join('');
  disList.hidden = !hits.length; disQ.setAttribute('aria-expanded', String(!!hits.length));
});
disList.addEventListener('click', (e) => { const li = e.target.closest('[data-dis]'); if (!li) return; read(); state.diseases.push(li.dataset.dis); disQ.value = ''; disList.hidden = true; renderChips(); paint(); });
$('#te-dis-chips').addEventListener('click', (e) => { const b = e.target.closest('[data-rm-dis]'); if (!b) return; read(); state.diseases = state.diseases.filter((d) => d !== b.dataset.rmDis); renderChips(); paint(); });

/* ───────── 目前物件與檢核 ───────── */
const currentIssue = () => resolveIssue(state, D.issues, { today: TODAY });
const current = () => { read(); const issue = currentIssue(); return { issue, article: buildArticle(state, { today: TODAY, issue, base }) }; };

function paneTab(id) {
  for (const t of $$('.adm-tabs--pane [role="tab"]')) { const on = t.id === `tt-${id}`; t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1; $(`#${t.getAttribute('aria-controls')}`).hidden = !on; }
}
$$('.adm-tabs--pane [role="tab"]').forEach((t) => t.addEventListener('click', () => paneTab(t.id.replace('tt-', ''))));

function paint() {
  const { issue, article } = current();
  const problems = problemsOf(article, { issue, articles: D.articles, selfId: base?.id ?? article.id, today: TODAY });
  const errs = problems.filter((p) => p.level === 'error'), warns = problems.filter((p) => p.level === 'warn');
  // 卷期提示
  $('#te-issue-hint').textContent = issue ? (issue._new ? `將新建 ${issue.id}（${issue.publishedAt} 出刊）` : `${issue.title}，本期已有 ${D.articles.filter((a) => a.issueId === issue.id).length} 篇全文${issue.articles?.length ? `、${issue.articles.length} 筆書目篇目` : ''}`) : '請選卷期，或填卷、期與出刊日建立新的一期。';
  // 檢核頁籤
  $('#te-check').innerHTML = `${errs.length ? `<div class="adm-box adm-box--err" role="alert"><strong>會擋建置（${errs.length}）</strong><ul>${errs.map((p) => `<li>${esc(p.msg)}</li>`).join('')}</ul></div>` : '<div class="adm-box adm-box--ok"><strong>必要檢核全過</strong>可以匯出開 PR；CI 用的是同一份規則（bulletin-rules.js）。</div>'}${warns.length ? `<div class="adm-box adm-box--warn" role="status"><strong>建議補齊（${warns.length}）</strong><ul>${warns.map((p) => `<li>${esc(p.msg)}</li>`).join('')}</ul></div>` : ''}`;
  const badge = $('#tt-check-badge'); badge.hidden = !problems.length; badge.textContent = String(problems.length); badge.classList.toggle('adm-tabbadge--warn', errs.length > 0);
  // 目錄預覽、JSON
  $('#te-toc').innerHTML = renderTocPreview(tocPreviewRows(article, issue, D.articles), issue);
  $('#te-file').textContent = exportFilename(article);
  $('#te-file2').textContent = issue?._new ? `　＋ ${issueFilename(issue)}` : '';
  $('#te-out').textContent = JSON.stringify(article, null, 2);
  $('#te-zip').disabled = hasErrors(problems);
  $('#te-zip').title = hasErrors(problems) ? '先把「檢核」頁籤裡會擋建置的問題改掉' : '';
  PV?.repaintSoon();
  markDirty();
}

/* ───────── 預覽 ───────── */
PV = initPagePreview({
  root: $('#te-preview'), form: $('#te-form'), fieldMap: TE_FIELD_MAP,
  render: () => { const { issue, article } = current(); return renderArticlePreview(article, issue, { md, unitName, diseaseName, siteBase: D.siteBase, today: TODAY }); },
  getState: () => state, helpers: () => ({}),
  onFocusField: () => paneTab('prev'),
});

/* ───────── 事件 ───────── */
function load(id) {
  base = id && id !== 'new' ? D.articles.find((a) => a.id === id) ?? null : null;
  pdf = null; $('#te-pdf').value = '';
  if (base) fill(stateFromArticle(base));
  else {
    const st = emptyState({ today: TODAY });
    const latest = D.issues[0];
    if (latest) { st.issueMode = 'existing'; st.issueId = latest.id; st.articleNo = String(suggestArticleNo(D.articles, latest.id, latest)); }
    const nx = suggestNextIssue(D.issues, TODAY); st.newVolume = String(nx.volume); st.newIssue = String(nx.issue);
    fill(st);
  }
  $('#te-editbox').hidden = !base;
  if (base) $('#te-editbox').innerHTML = `<strong>修改已上架文章</strong> <code>${esc(base.id)}</code>（${esc(D.issues.find((p) => p.id === base.issueId)?.title ?? base.issueId)} 第 ${base.articleNo} 篇）。匯出會保留表單沒有的欄位（languages、i18n…），PR 只會多出真正改動的部分。`;
}
$('#te-pick').addEventListener('change', (e) => { load(e.target.value); paint(); });
$('#te-issue').addEventListener('change', () => {
  read();
  $('#te-newissue').hidden = $('#te-issue').value !== '__new';
  if (!base) { const issue = currentIssue(); if (issue && !issue._new) { state.articleNo = String(suggestArticleNo(D.articles, issue.id, issue)); $('#te-no').value = state.articleNo; } else if (issue?._new) { state.articleNo = '1'; $('#te-no').value = '1'; } }
  paint();
});
$('#te-form').addEventListener('input', debounce(paint, 150));
$('#te-form').addEventListener('change', (e) => { if (e.target.closest('#te-sections, #te-figures')) paint(); });
$('#te-form').addEventListener('click', (e) => {
  const del = e.target.closest('[data-del]'), mv = e.target.closest('[data-move]');
  if (del) { read(); const [kind, i] = del.dataset.del.split(':'); ROWS[kind].list().splice(Number(i), 1); renderRows(kind); paint(); }
  if (mv) { read(); const [kind, i, d] = mv.dataset.move.split(':'); const list = ROWS[kind].list(); const a = Number(i), b = a + Number(d); if (b < 0 || b >= list.length) return; [list[a], list[b]] = [list[b], list[a]]; renderRows(kind); paint(); $(`${ROWS[kind].root} .adm-te-row[data-i="${b}"] [data-k="heading"]`)?.focus(); }
});
$('#te-sec-add').addEventListener('click', () => { read(); state.sections.push(ROWS.sections.blank()); renderRows('sections'); paint(); $('#te-sections .adm-te-row:last-child [data-k="heading"]')?.focus(); });
$('#te-fig-add').addEventListener('click', () => { read(); state.figures.push(ROWS.figures.blank('figure')); renderRows('figures'); paint(); });
$('#te-tab-add').addEventListener('click', () => { read(); state.figures.push(ROWS.figures.blank('table')); renderRows('figures'); paint(); });
$('#te-split').addEventListener('click', () => {
  read();
  const text = state.manuscript;
  if (!text.trim()) { $('#te-split-msg').textContent = '稿件欄是空的。'; return; }
  const r = applyManuscript(state, text);
  fill({ ...r.state, manuscript: state.manuscript });
  $('#te-split-msg').textContent = r.report.length ? `已切出：${r.report.join('、')}。請逐段核對。` : '沒有認得的章節標題；請用 E 區逐段貼，或在稿件裡補「前言」「方法」等標題後再試。';
  const un = $('#te-unassigned'); un.hidden = !r.unassigned.length; un.innerHTML = r.unassigned.length ? `<strong>有 ${r.unassigned.length} 段放不進任何章節</strong>（通常是標題之前的文字或沒有標題的段落）；請手動複製到正確的欄位：<pre class="adm-te-un">${esc(r.unassigned.join('\n\n'))}</pre>` : '';
  paint();
});
$('#te-clear-ms').addEventListener('click', () => { $('#te-manuscript').value = ''; $('#te-split-msg').textContent = ''; $('#te-unassigned').hidden = true; read(); });
$('#te-pdf').addEventListener('change', async (e) => {
  const f = e.target.files?.[0]; pdf = null;
  if (!f) { paint(); return; }
  if (!/\.pdf$/i.test(f.name)) { $('#te-pdf-hint').textContent = '只接受 PDF。'; e.target.value = ''; paint(); return; }
  if (f.size > D.pdfMaxBytes) { $('#te-pdf-hint').textContent = `檔案 ${(f.size / 1048576).toFixed(1)} MB 超過上限 ${Math.round(D.pdfMaxBytes / 1048576)} MB。`; e.target.value = ''; paint(); return; }
  pdf = { name: f.name.replace(/\s+/g, '-'), bytes: new Uint8Array(await f.arrayBuffer()) };
  $('#te-pdf-hint').textContent = `將打包為 content/assets/{文章 id}/${pdf.name}（${(f.size / 1024).toFixed(0)} KB）。`;
  paint();
});
$('#te-zip').addEventListener('click', () => {
  const { issue, article } = current();
  const entries = packageEntries(article, issue, pdf);
  const blob = zipBlob(entries);
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${article.id}.zip`; document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  $('#te-msg').textContent = `上架包含 ${entries.length} 個檔：${entries.map((x) => x.name).join('、')}。解壓到 repo 根目錄後開 PR。`;
});
$('#te-dl').addEventListener('click', () => { const { article } = current(); downloadText(exportFilename(article).split('/').pop(), `${JSON.stringify(article, null, 2)}\n`); });
$('#te-copy').addEventListener('click', (e) => copyText(`${$('#te-out').textContent}\n`, e.currentTarget));

/* ───────── 草稿 ───────── */
let saveTimer = 0;
function markDirty() { const s = $('#te-savestate'); s.dataset.state = 'dirty'; $('#te-savestate-text').textContent = '有未存的修改（自動儲存中…）'; clearTimeout(saveTimer); saveTimer = setTimeout(saveDraft, 1200); }
function saveDraft() { read(); store.set(KEY, { pick: base?.id ?? 'new', state, savedAt: new Date().toISOString() }); const s = $('#te-savestate'); s.dataset.state = 'saved'; $('#te-savestate-text').textContent = `草稿已存在這台電腦 ${new Date().toLocaleTimeString('zh-TW', { hour12: false })}`; }
$('#te-save').addEventListener('click', () => { saveDraft(); $('#te-msg').textContent = '草稿已儲存。'; });
document.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveDraft(); } });
$('#te-reset').addEventListener('click', () => { store.del(KEY); load('new'); paint(); $('#te-msg').textContent = '已清空表單並刪除本機草稿。'; });
$('#te-sample').addEventListener('click', () => {
  load('new'); read();
  const st = { ...state, title: '某縣市一起校園腸病毒群聚事件之調查（範例）', titleEn: 'Investigation of an enterovirus cluster in a school (sample)', authors: '疫情中心防疫醫師 | 疫情中心 | *\n某縣市衛生局疾病管制科 | 地方衛生局', pages: '', keywords: '腸病毒、群聚、學校', articleType: 'outbreak-report',
    manuscript: '2026 年 4 月某縣市一所國小通報 12 名學童出現手足口病症狀，衛生局與疫情中心共同調查。本文描述調查方法、結果與介入措施。（範例摘要）\n\n前言\n腸病毒感染在每年 4 至 6 月進入流行季，學校與托育機構是群聚最常見的場域。（範例）\n\n材料與方法\n病例定義為 4 月 X 日至 Y 日間出現手足口病或疱疹性咽峽炎症狀之學童；採咽喉拭子送驗。（範例）\n\n結果\n共 12 名病例，分布於 3 個班級；8 件檢體中 6 件檢出克沙奇 A6 型（表 1）。流行曲線見圖 1。（範例）\n\n圖 1 病例發病日分布\n表 1 檢體檢驗結果\n\n討論\n班級間傳播與共用遊戲區有關；停課 7 天後無新病例。（範例）\n\n結論與建議\n建議學校於流行季加強洗手與環境消毒，並於單班 2 例以上時通報。（範例）\n\n參考文獻\n1. 衛生福利部疾病管制署。腸病毒防治工作指引。\n2. 範例文獻二。' };
  fill(st);
  $('#te-split').click();
  $('#te-msg').textContent = '已載入範例稿件並自動切段；這是示範資料，請勿直接匯出上架。';
});

// 初始：?edit=article.… 優先，其次本機草稿，否則新增
const qid = new URLSearchParams(location.search).get('edit') ?? new URLSearchParams(location.search).get('id');
const draft = store.get(KEY, null);
if (qid && D.articles.some((a) => a.id === qid)) load(qid);
else if (draft?.state) { load(draft.pick); fill({ ...state, ...draft.state }); $('#te-msg').textContent = `已帶回 ${new Date(draft.savedAt).toLocaleString('zh-TW', { hour12: false })} 存的草稿。`; }
else load('new');
paint();
