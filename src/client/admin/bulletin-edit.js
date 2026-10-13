// /admin/bulletin/edit/ 疫情報導文章上架：只做 DOM 綁定；組物件、切段、檢核都在 bulletin-edit-core.js（純函式，有測試）。
// 第三十五輪：服務單位清單與作者註記、DOI 建議、分類管理（主檔可加）、圖檔拖進來自動配到圖表並宣告 assets。
import { $, $$, esc, store, readEmbedded, copyText, downloadText, debounce } from './common.js';
import { initPagePreview } from './page-preview.js';
import { zipBlob } from './zip-store.js';
import { mdToHtml } from './md-convert.js';
import { sha256Hex } from './preprocess.js';
import { extractPdf } from './pdf-read.js';
import { manuscriptText, captionsByPage, linesFromItems, pageText, matchImages, describeExtraction } from './pdf-manuscript.js';
import { initPublishGateway } from './publish-gateway.js';
import {
  emptyState, stateFromArticle, applyManuscript, buildArticle, resolveIssue, problemsOf, hasErrors, suggestNextIssue, suggestArticleNo, sectionKeyFor, suggestDoi,
  tocPreviewRows, packageEntries, exportFilename, issueFilename, renderArticlePreview, renderTocPreview, TE_FIELD_MAP, assignFigureFiles, IMAGE_EXT_RE,
  categoriesChanged, suggestCategoryKey, sortCategories, CATEGORIES_FILE, DEFAULT_CATEGORIES,
} from './bulletin-edit-core.js';

const D = readEmbedded('adm-bulletin-data', { today: '', siteBase: '', issues: [], articles: [], units: [], diseases: [], categories: DEFAULT_CATEGORIES, pdfMaxBytes: 20 * 1048576, imageMaxBytes: 2 * 1048576 });
const KEY = 'cdc.admin.bulletin-edit';
const TODAY = D.today;
const unitName = (id) => D.units.find((u) => u.id === id)?.name ?? id;
const diseaseName = (id) => D.diseases.find((d) => d.id === id)?.name ?? id;
const md = (m) => mdToHtml(m, { marked: window.marked });
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml' };

let state = emptyState({ today: TODAY, categories: D.categories });
let base = null; // 修改中的既有文章
let pdf = null; // { name, bytes, sha256 }
const images = new Map(); // 檔名 → { bytes, url, mime, sha256, width, height }
let PV = null;

/* ───────── 簡單欄位 ───────── */
const SIMPLE = {
  issueId: '#te-issue', newVolume: '#te-vol', newIssue: '#te-iss', newDate: '#te-date', articleNo: '#te-no', articleType: '#te-type', pages: '#te-pages',
  title: '#te-title', titleEn: '#te-titleen', authors: '#te-authors', affiliations: '#te-affils', owner: '#te-owner', doi: '#te-doi', legacyDoiUrl: '#te-legacydoi', receivedAt: '#te-received', acceptedAt: '#te-accepted',
  keywords: '#te-keywords', keywordsEn: '#te-keywordsen', summary: '#te-summary',
  manuscript: '#te-manuscript', abstract: '#te-abstract', abstractEn: '#te-abstracten', known: '#te-known', added: '#te-added', implications: '#te-implications',
  references: '#te-refs', acknowledgements: '#te-ack', pdfUrl: '#te-pdfurl', note: '#te-note',
};
function renderTypeOptions(selected) {
  const sel = $('#te-type');
  sel.innerHTML = `<option value="">（請選分類）</option>${sortCategories(state.categories).filter((c) => !c.retiredAt || c.key === selected).map((c) => `<option value="${esc(c.key)}">${esc(c.label)}${c.retiredAt ? '（已停用）' : ''}</option>`).join('')}`;
  sel.value = selected ?? '';
  if (sel.value !== (selected ?? '')) sel.value = '';
}
function fill(st) {
  state = st;
  for (const [k, sel] of Object.entries(SIMPLE)) { const el = $(sel); if (el) el.value = st[k] ?? ''; }
  renderTypeOptions(st.articleType);
  $('#te-issue').value = st.issueMode === 'new' ? '__new' : (st.issueId || '__new');
  if ($('#te-issue').value !== (st.issueMode === 'new' ? '__new' : st.issueId)) $('#te-issue').value = '__new';
  $('#te-newissue').hidden = $('#te-issue').value !== '__new';
  $('#te-pick').value = base?.id ?? 'new';
  renderRows('sections'); renderRows('figures'); renderChips(); renderCats();
}
function read() {
  const st = { ...state };
  for (const [k, sel] of Object.entries(SIMPLE)) { const el = $(sel); if (el) st[k] = el.value; }
  st.issueMode = $('#te-issue').value === '__new' ? 'new' : 'existing';
  if (st.issueMode === 'new') st.issueId = '';
  st.sections = readRows('sections'); st.figures = readRows('figures'); st.categories = readCats();
  st.pdfFile = pdf?.name ?? '';
  state = st;
  return st;
}

/* ───────── 動態列：段落、圖表 ───────── */
const ROWS = {
  sections: {
    root: '#te-sections', list: () => state.sections,
    row: (x, i, all) => `<div class="adm-te-row" data-i="${i}"><div class="adm-te-row__head"><span class="adm-te-row__no">${i + 1}</span><input type="text" class="adm-input adm-te-row__h" data-k="heading" value="${esc(x.heading)}" placeholder="段落標題，例：材料與方法" aria-label="第 ${i + 1} 段標題"><label class="adm-te-row__lv"><input type="checkbox" data-k="level" ${x.level === 3 ? 'checked' : ''}> 小標（h3）</label><span class="adm-te-row__tools"><button type="button" class="adm-btn adm-btn--ghost adm-btn--sm" data-move="sections:${i}:-1" aria-label="第 ${i + 1} 段往上" ${i === 0 ? 'disabled' : ''}>↑</button><button type="button" class="adm-btn adm-btn--ghost adm-btn--sm" data-move="sections:${i}:1" aria-label="第 ${i + 1} 段往下" ${i === all.length - 1 ? 'disabled' : ''}>↓</button><button type="button" class="adm-btn adm-btn--ghost adm-btn--sm" data-del="sections:${i}" aria-label="刪除第 ${i + 1} 段">刪除</button></span></div><textarea class="adm-te-row__body" data-k="markdown" rows="6" aria-label="第 ${i + 1} 段內文（Markdown）" placeholder="內文（Markdown；^上標^、~下標~）">${esc(x.markdown)}</textarea><span class="adm-hint">key：<code>${esc(x.key || '（自動）')}</code>　${(x.markdown ?? '').length} 字</span></div>`,
    blank: () => ({ key: '', heading: '', markdown: '' }),
  },
  figures: {
    root: '#te-figures', list: () => state.figures,
    row: (f, i) => { const img = f.file ? images.get(f.file) : null; return `<div class="adm-te-row adm-te-fig" data-i="${i}"><div class="adm-te-row__head"><select class="adm-input" data-k="kind" aria-label="圖或表"><option value="figure" ${f.kind !== 'table' ? 'selected' : ''}>圖</option><option value="table" ${f.kind === 'table' ? 'selected' : ''}>表</option></select><input type="number" class="adm-input adm-te-fig__no" data-k="no" min="1" value="${esc(f.no)}" aria-label="編號"><input type="text" class="adm-input adm-te-row__h" data-k="caption" value="${esc(f.caption)}" placeholder="說明，例：各菜色罹病率與罹病率比" aria-label="圖表說明"><span class="adm-te-row__tools"><button type="button" class="adm-btn adm-btn--ghost adm-btn--sm" data-del="figures:${i}" aria-label="刪除這個圖表">刪除</button></span></div><div class="adm-te-fig__body">${img ? `<img class="adm-te-fig__thumb" src="${esc(img.url)}" alt="" width="120">` : ''}<div class="adm-grid adm-grid--2"><input type="text" class="adm-input" data-k="file" value="${esc(f.file)}" placeholder="圖檔名（拖圖進來會自動填，例：fig-1.png）" aria-label="圖檔名"><input type="text" class="adm-input" data-k="alt" value="${esc(f.alt)}" placeholder="圖的替代文字（一句話說圖在講什麼；有圖檔時必填）" aria-label="替代文字"></div>${img ? `<span class="adm-hint">${esc(f.file)} · ${img.width}×${img.height} · ${(img.bytes.length / 1024).toFixed(0)} KB</span>` : f.file && base?.assets?.some((x) => x.file === f.file) ? `<span class="adm-hint">沿用已上架的圖檔 ${esc(f.file)}</span>` : ''}</div><textarea class="adm-te-row__body" data-k="markdown" rows="3" aria-label="表格內容或圖的文字版（Markdown）" placeholder="表格內容（Markdown 表格）或圖的文字版數據（圖有圖檔時可留空）">${esc(f.markdown)}</textarea></div>`; },
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

/* ───────── 分類管理 ───────── */
function renderCats() {
  const cats = sortCategories(state.categories);
  $('#te-cats').innerHTML = cats.map((c, i) => `<tr data-i="${i}"><td><input type="text" class="adm-input adm-input--sm" data-ck="label" value="${esc(c.label)}" aria-label="分類 ${i + 1} 中文名稱"></td><td><input type="text" class="adm-input adm-input--sm" data-ck="labelEn" value="${esc(c.labelEn ?? '')}" aria-label="分類 ${i + 1} 英文名稱"></td><td><input type="text" class="adm-input adm-input--sm" data-ck="key" value="${esc(c.key)}" aria-label="分類 ${i + 1} 代號" ${D.categories.some((x) => x.key === c.key) ? 'readonly title="已上架的分類代號不可改（網址用）"' : ''}></td><td><input type="number" class="adm-input adm-input--sm adm-te-cat__order" data-ck="order" value="${esc(c.order ?? i + 1)}" aria-label="分類 ${i + 1} 順序"></td><td>${D.articles.filter((a) => a.articleType === c.key).length}</td><td>${D.categories.some((x) => x.key === c.key) ? `<label class="adm-hint"><input type="checkbox" data-ck="retired" ${c.retiredAt ? 'checked' : ''}> 停用</label>` : `<button type="button" class="adm-btn adm-btn--ghost adm-btn--sm" data-cat-del="${i}">刪除</button>`}</td></tr>`).join('');
  $('#te-cats-changed').hidden = !categoriesChanged(cats, D.categories);
}
function readCats() {
  const old = sortCategories(state.categories);
  return $$('#te-cats tr').map((tr, i) => {
    const c = { ...(old[i] ?? {}) };
    for (const el of $$('[data-ck]', tr)) {
      if (el.dataset.ck === 'retired') { if (el.checked) c.retiredAt ??= TODAY; else delete c.retiredAt; }
      else if (el.dataset.ck === 'order') c.order = Number(el.value) || i + 1;
      else c[el.dataset.ck] = el.value.trim();
    }
    return c;
  });
}
$('#te-cat-add').addEventListener('click', () => {
  read();
  const label = $('#te-cat-new').value.trim();
  if (!label) { $('#te-cat-msg').textContent = '先填新分類的中文名稱。'; return; }
  const labelEn = $('#te-cat-new-en').value.trim();
  const key = suggestCategoryKey(labelEn || label, state.categories.map((c) => c.key));
  state.categories.push({ key, label, labelEn, order: state.categories.length + 1 });
  $('#te-cat-new').value = ''; $('#te-cat-new-en').value = '';
  $('#te-cat-msg').textContent = `已加「${label}」（代號 ${key}）；上架包會多一個 ${CATEGORIES_FILE}，合併後前台就有這個分類的列表頁。`;
  renderCats(); renderTypeOptions(state.articleType); paint();
});
$('#te-cats').addEventListener('click', (e) => { const b = e.target.closest('[data-cat-del]'); if (!b) return; read(); state.categories.splice(Number(b.dataset.catDel), 1); renderCats(); renderTypeOptions(state.articleType); paint(); });
$('#te-cats').addEventListener('input', debounce(() => { read(); renderTypeOptions(state.articleType); paint(); }, 200));

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
const filesMeta = () => { const o = {}; for (const [f, m] of images) o[f] = { kind: 'image', mime: m.mime, bytes: m.bytes.length, sha256: m.sha256, width: m.width, height: m.height }; if (pdf) o[pdf.name] = { kind: 'attachment', mime: 'application/pdf', bytes: pdf.bytes.length, sha256: pdf.sha256 }; return o; };
const current = () => { read(); const issue = currentIssue(); return { issue, article: buildArticle(state, { today: TODAY, issue, base, files: filesMeta() }) }; };

function paneTab(id) {
  for (const t of $$('.adm-tabs--pane [role="tab"]')) { const on = t.id === `tt-${id}`; t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1; $(`#${t.getAttribute('aria-controls')}`).hidden = !on; }
}
$$('.adm-tabs--pane [role="tab"]').forEach((t) => t.addEventListener('click', () => paneTab(t.id.replace('tt-', ''))));

function paint() {
  const { issue, article } = current();
  const problems = problemsOf(article, { issue, articles: D.articles, selfId: base?.id ?? article.id, today: TODAY, categories: state.categories });
  const errs = problems.filter((p) => p.level === 'error'), warns = problems.filter((p) => p.level === 'warn');
  // 卷期提示
  $('#te-issue-hint').textContent = issue ? (issue._new ? `將新建 ${issue.id}（${issue.publishedAt} 出刊）` : `${issue.title}，本期已有 ${D.articles.filter((a) => a.issueId === issue.id).length} 篇全文${issue.articles?.length ? `、${issue.articles.length} 筆書目篇目` : ''}`) : '請選卷期，或填卷、期與出刊日建立新的一期。';
  $('#te-doi-hint').textContent = issue && article.articleNo ? `期刊慣例：${suggestDoi(issue, article.articleNo)}（按「建議 DOI」帶入；出版單位有給正式 DOI 就以它為準）` : '選了卷期與篇次後可按「建議 DOI」。';
  // 檢核頁籤
  $('#te-check').innerHTML = `${errs.length ? `<div class="adm-box adm-box--err" role="alert"><strong>會擋建置（${errs.length}）</strong><ul>${errs.map((p) => `<li>${esc(p.msg)}</li>`).join('')}</ul></div>` : '<div class="adm-box adm-box--ok"><strong>必要檢核全過</strong>可以匯出開 PR；CI 用的是同一份規則（bulletin-rules.js）。</div>'}${warns.length ? `<div class="adm-box adm-box--warn" role="status"><strong>建議補齊（${warns.length}）</strong><ul>${warns.map((p) => `<li>${esc(p.msg)}</li>`).join('')}</ul></div>` : ''}`;
  const badge = $('#tt-check-badge'); badge.hidden = !problems.length; badge.textContent = String(problems.length); badge.classList.toggle('adm-tabbadge--warn', errs.length > 0);
  // 目錄預覽、JSON
  $('#te-toc').innerHTML = renderTocPreview(tocPreviewRows(article, issue, D.articles), issue);
  $('#te-file').textContent = exportFilename(article);
  $('#te-file2').textContent = [issue?._new ? `　＋ ${issueFilename(issue)}` : '', categoriesChanged(state.categories, D.categories) ? `　＋ ${CATEGORIES_FILE}` : '', ...[...images.keys()].filter((f) => (article.figures ?? []).some((x) => x.file === f)).map((f) => `　＋ content/assets/${article.id}/${f}`)].join('');
  $('#te-out').textContent = JSON.stringify(article, null, 2);
  $('#te-zip').disabled = hasErrors(problems);
  $('#te-zip').title = hasErrors(problems) ? '先把「檢核」頁籤裡會擋建置的問題改掉' : '';
  PV?.repaintSoon();
  markDirty();
}

/* ───────── 預覽 ───────── */
PV = initPagePreview({
  root: $('#te-preview'), form: $('#te-form'), fieldMap: TE_FIELD_MAP,
  render: () => { const { issue, article } = current(); return renderArticlePreview(article, issue, { md, unitName, diseaseName, siteBase: D.siteBase, today: TODAY, categories: state.categories, imageUrl: (f) => images.get(f)?.url ?? null }); },
  getState: () => state, helpers: () => ({}),
  onFocusField: () => paneTab('prev'),
});

/* ───────── 事件 ───────── */
function load(id) {
  base = id && id !== 'new' ? D.articles.find((a) => a.id === id) ?? null : null;
  pdf = null; $('#te-pdf').value = ''; $('#te-pdf-hint').textContent = '';
  for (const m of images.values()) URL.revokeObjectURL(m.url); images.clear(); $('#te-figfiles').value = ''; $('#te-figfiles-msg').textContent = '';
  if (base) fill(stateFromArticle(base, { categories: D.categories }));
  else {
    const st = emptyState({ today: TODAY, categories: D.categories });
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
$('#te-doi-suggest').addEventListener('click', () => { read(); const issue = currentIssue(); const v = suggestDoi(issue, Number(state.articleNo)); if (!v) { $('#te-msg').textContent = '先選卷期（含出刊日）與篇次。'; return; } $('#te-doi').value = v; paint(); });
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
  const r = applyManuscript(state, text, { issues: D.issues });
  fill({ ...r.state, manuscript: state.manuscript });
  $('#te-split-msg').textContent = r.report.length ? `已帶入：${r.report.join('、')}。請逐段核對。` : '沒有認得的章節標題；請用 E 區逐段貼，或在稿件裡補「前言」「方法」等標題後再試。';
  const un = $('#te-unassigned'); un.hidden = !r.unassigned.length && !r.notes.length;
  un.innerHTML = `${r.notes.length ? `<ul class="adm-te-notes">${r.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}${r.unassigned.length ? `<strong>有 ${r.unassigned.length} 段放不進任何章節</strong>（通常是標題之前的文字、英文摘要頁的殘行或沒有標題的段落）；請手動複製到正確的欄位或忽略：<pre class="adm-te-un">${esc(r.unassigned.join('\n\n'))}</pre>` : ''}`;
  paint();
});
$('#te-clear-ms').addEventListener('click', () => { $('#te-manuscript').value = ''; $('#te-split-msg').textContent = ''; $('#te-unassigned').hidden = true; read(); });
/** 單篇 PDF 附件：檢查型別與大小、讀 bytes 與 sha256。回傳 null＝不收 */
async function setPdf(f, hintEl) {
  pdf = null;
  if (!f) return null;
  if (!/\.pdf$/i.test(f.name)) { hintEl.textContent = '只接受 PDF。'; return null; }
  if (f.size > D.pdfMaxBytes) { hintEl.textContent = `檔案 ${(f.size / 1048576).toFixed(1)} MB 超過上限 ${Math.round(D.pdfMaxBytes / 1048576)} MB。`; return null; }
  const bytes = new Uint8Array(await f.arrayBuffer());
  pdf = { name: f.name.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+/, '') || 'article.pdf', bytes, sha256: await sha256Hex(bytes) };
  hintEl.textContent = `將打包為 content/assets/{文章 id}/${pdf.name}（${(f.size / 1024).toFixed(0)} KB），並宣告進 assets[]。`;
  return pdf;
}
$('#te-pdf').addEventListener('change', async (e) => {
  const ok = await setPdf(e.target.files?.[0], $('#te-pdf-hint'));
  if (!ok) e.target.value = '';
  paint();
});

/* ───────── 第四十五輪：上傳 PDF 自動帶入（文字層 → 稿件欄 → 切段；內嵌圖片 → 圖檔） ───────── */
let pdfLeftovers = []; // 沒配到圖說的圖：[{ key, blob, width, height, page }]
function renderLeftovers() {
  const box = $('#te-pdf-extra');
  box.hidden = !pdfLeftovers.length;
  if (!pdfLeftovers.length) { box.innerHTML = ''; return; }
  const nextNo = () => Math.max(0, ...state.figures.filter((f) => f.kind === 'figure').map((f) => Number(f.no) || 0)) + 1;
  box.innerHTML = `<p class="adm-hint">PDF 裡還有這些圖沒有對到「圖 N」的圖說（可能是刊頭、或圖說不在同一頁）。要用的話按「當作圖 N」，會新增一列圖表並配上檔案；不要的就略過。</p><div class="adm-te-pdfextra">${pdfLeftovers.map((im, i) => `<figure><img src="${esc(im.url)}" alt="PDF 第 ${im.page} 頁抽出的圖，${im.width}×${im.height}"><figcaption>第 ${im.page} 頁 · ${im.width}×${im.height}<br><button type="button" class="adm-btn adm-btn--sm" data-use-img="${i}">當作圖 ${nextNo()}</button></figcaption></figure>`).join('')}</div>`;
}
$('#te-pdf-extra').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-use-img]'); if (!b) return;
  const im = pdfLeftovers[Number(b.dataset.useImg)]; if (!im) return;
  read();
  const no = Math.max(0, ...state.figures.filter((f) => f.kind === 'figure').map((f) => Number(f.no) || 0)) + 1;
  await addImageFiles([new File([im.blob], `圖${no}.png`, { type: 'image/png' })]);
  pdfLeftovers = pdfLeftovers.filter((x) => x !== im); URL.revokeObjectURL(im.url);
  renderLeftovers();
});
async function importPdf(f) {
  const msg = $('#te-pdfin-msg');
  const ok = await setPdf(f, $('#te-pdf-hint'));
  if (!ok) { msg.textContent = $('#te-pdf-hint').textContent; return; }
  msg.textContent = '讀取 PDF 文字層與圖片中…';
  let ex;
  try { ex = await extractPdf(pdf.bytes, { onProgress: (n, t) => { msg.textContent = `讀取 PDF 第 ${n}／${t} 頁…`; } }); } catch (err) {
    msg.textContent = err?.message === 'pdfjs-unavailable' ? '這個環境沒有部署 PDF 讀取元件（/vendor/pdfjs/），請把 PDF 文字全選複製貼到下面的稿件欄；PDF 本身已當作附件。' : `PDF 讀不出文字層（${err?.message ?? '未知錯誤'}）：可能是掃描檔或受保護的檔案，請貼文字；PDF 本身已當作附件。`;
    paint(); return;
  }
  const text = manuscriptText(ex.pages);
  if (!text.trim()) { msg.textContent = 'PDF 沒有文字層（掃描檔？）：請把文字貼到下面的稿件欄；PDF 本身已當作附件。'; paint(); return; }
  read();
  const st = { ...state, manuscript: text };
  const r = applyManuscript(st, text, { issues: D.issues });
  fill(r.state);
  $('#te-split-msg').textContent = `${r.report.length ? `已帶入：${r.report.join('、')}。` : '沒有認出任何段落。'}${r.notes?.length ? ` 注意：${r.notes.join('；')}` : ''} 請逐段核對。`;
  $('#te-unassigned').hidden = !r.unassigned.length;
  if (r.unassigned.length) $('#te-unassigned').innerHTML = `<strong>沒有歸到任何段落的文字（${r.unassigned.length} 段）</strong>：請貼到正確的段落，或刪掉。<ul>${r.unassigned.map((u) => `<li>${esc(u.slice(0, 200))}${u.length > 200 ? '…' : ''}</li>`).join('')}</ul>`;
  // 圖片：配圖說 → 當作「圖N.png」拖進來
  const captions = captionsByPage(ex.pages.map((p) => pageText(linesFromItems(p.items))));
  const { assigned, leftovers, skipped } = matchImages(ex.images, captions);
  const byKey = new Map(ex.images.map((im) => [im.key, im]));
  for (const im of pdfLeftovers) URL.revokeObjectURL(im.url);
  pdfLeftovers = leftovers.map((im) => ({ ...im, url: URL.createObjectURL(im.blob) }));
  if (assigned.length) await addImageFiles(assigned.map((a) => new File([byKey.get(a.key).blob], a.fileName, { type: 'image/png' })));
  renderLeftovers();
  msg.textContent = describeExtraction({ pages: ex.pages.length, chars: text.replace(/\s/g, '').length, assigned, leftovers, skipped, tables: r.state.figures.filter((f) => f.kind === 'table' && f.markdown).length });
  paint();
  $('#te-title')?.focus();
}
$('#te-pdfin').addEventListener('change', (e) => { const f = e.target.files?.[0]; if (f) importPdf(f); });
const pdfDrop = $('#te-pdfdrop');
pdfDrop.addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); pdfDrop.classList.add('is-drop'); } });
pdfDrop.addEventListener('dragleave', () => pdfDrop.classList.remove('is-drop'));
pdfDrop.addEventListener('drop', (e) => { const f = e.dataTransfer?.files?.[0]; if (!f) return; e.preventDefault(); pdfDrop.classList.remove('is-drop'); importPdf(f); });
/** 圖檔：讀 bytes、sha256、寬高 → 依檔名配到圖表（圖1.png／fig-2.png），認不出的依序補到沒有圖檔的圖 */
async function addImageFiles(fileList) {
  const files = [...(fileList ?? [])].filter((f) => IMAGE_EXT_RE.test(f.name));
  const tooBig = files.filter((f) => f.size > D.imageMaxBytes);
  const ok = files.filter((f) => f.size <= D.imageMaxBytes);
  read();
  const { figures, assigned } = assignFigureFiles(state.figures, ok);
  for (const f of ok) {
    const to = assigned.find((x) => x.from === f.name)?.to; if (!to) continue;
    const bytes = new Uint8Array(await f.arrayBuffer());
    const url = URL.createObjectURL(f);
    const dims = await new Promise((res) => { const im = new Image(); im.onload = () => res({ width: im.naturalWidth, height: im.naturalHeight }); im.onerror = () => res({}); im.src = url; });
    if (images.has(to)) URL.revokeObjectURL(images.get(to).url);
    images.set(to, { bytes, url, mime: MIME[to.split('.').pop()] ?? 'application/octet-stream', sha256: await sha256Hex(bytes), ...dims });
  }
  state.figures = figures;
  renderRows('figures');
  $('#te-figfiles-msg').innerHTML = `${assigned.length ? `已配對：${assigned.map((x) => `${esc(x.from)} → ${x.kind === 'table' ? '表' : '圖'} ${x.no}${x.created ? '（新增列）' : ''}`).join('、')}。請補每張圖的替代文字。` : ''}${tooBig.length ? ` <span class="adm-text-warn">${tooBig.map((f) => esc(f.name)).join('、')} 超過 ${Math.round(D.imageMaxBytes / 1048576)} MB，請先縮圖。</span>` : ''}${files.length ? '' : '沒有可用的圖檔（接受 png／jpg／webp／svg）。'}`;
  paint();
}
$('#te-figfiles').addEventListener('change', (e) => addImageFiles(e.target.files));
const drop = $('#te-f');
drop.addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); drop.classList.add('is-drop'); } });
drop.addEventListener('dragleave', () => drop.classList.remove('is-drop'));
drop.addEventListener('drop', (e) => { if (!e.dataTransfer?.files?.length) return; e.preventDefault(); drop.classList.remove('is-drop'); addImageFiles(e.dataTransfer.files); });
$('#te-zip').addEventListener('click', () => {
  const { issue, article } = current();
  const imgBytes = {}; for (const [f, m] of images) imgBytes[f] = m.bytes;
  const entries = packageEntries(article, issue, { pdf, images: imgBytes, categories: state.categories, categoriesOriginal: D.categories });
  const blob = zipBlob(entries);
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${article.id}.zip`; document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  $('#te-msg').textContent = `上架包含 ${entries.length} 個檔：${entries.map((x) => x.name).join('、')}。解壓到 repo 根目錄後開 PR。`;
});
$('#te-dl').addEventListener('click', () => { const { article } = current(); downloadText(exportFilename(article).split('/').pop(), `${JSON.stringify(article, null, 2)}\n`); });
$('#te-copy').addEventListener('click', (e) => copyText(`${$('#te-out').textContent}\n`, e.currentTarget));

/* ───────── 草稿 ───────── */
let saveTimer = 0;
function markDirty() { const s = $('#te-savestate'); s.dataset.state = 'dirty'; $('#te-savestate-text').textContent = '有未存的修改（自動儲存中…）'; clearTimeout(saveTimer); saveTimer = setTimeout(saveDraft, 1200); }
function saveDraft() { read(); store.set(KEY, { pick: base?.id ?? 'new', state, savedAt: new Date().toISOString() }); const s = $('#te-savestate'); s.dataset.state = 'saved'; $('#te-savestate-text').textContent = `草稿已存在這台電腦 ${new Date().toLocaleTimeString('zh-TW', { hour12: false })}（圖檔與 PDF 不會存，重開頁面要再拖一次）`; }
$('#te-save').addEventListener('click', () => { saveDraft(); $('#te-msg').textContent = '草稿已儲存。'; });
document.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveDraft(); } });
$('#te-reset').addEventListener('click', () => { store.del(KEY); load('new'); paint(); $('#te-msg').textContent = '已清空表單並刪除本機草稿。'; });
$('#te-sample').addEventListener('click', () => {
  load('new'); read();
  const st = { ...state, title: '', authors: '', pages: '', keywords: '',
    manuscript: '2026 年 10 月 6 日 第 42 卷 第 19 期\n疫情調查\n某縣市一起校園腸病毒群聚事件之調查（範例）\n王小明 1*、李小華 1、陳大同 2\n\n摘要\n2026 年 4 月某縣市一所國小通報 12 名學童出現手足口病症狀，衛生局與疫情中心共同調查。本文描述調查方法、結果與介入措施。（範例摘要）\n關鍵字：腸病毒、群聚、學校\n\n前言\n腸病毒感染在每年 4 至 6 月進入流行季，學校與托育機構是群聚最常見的場域。（範例）\n\n材料與方法\n病例定義為 4 月 X 日至 Y 日間出現手足口病或疱疹性咽峽炎症狀之學童；採咽喉拭子送驗。（範例）\n\n結果\n共 12 名病例，分布於 3 個班級；8 件檢體中 6 件檢出克沙奇 A6 型（表一）。流行曲線見圖一。（範例）\n\n圖一、病例發病日分布\n表一、檢體檢驗結果\n\n討論及建議\n班級間傳播與共用遊戲區有關；停課 7 天後無新病例。建議學校於流行季加強洗手與環境消毒。（範例）\n\n誌謝\n感謝該校與衛生局協助。（範例）\n\n參考文獻\n1. 衛生福利部疾病管制署。腸病毒防治工作指引。\n2. 範例文獻二。\n\n1 疾病管制署疫情中心\n2 某縣市政府衛生局\n通訊作者：王小明　E-mail：example@cdc.gov.tw\n投稿日期：2026 年 5 月 1 日　接受日期：2026 年 8 月 1 日\nDOI：10.6524/EB.202610_42(19).0009' };
  fill(st);
  $('#te-split').click();
  $('#te-msg').textContent = '已載入範例稿件並自動切段（篇名、作者、單位、DOI、日期、關鍵字都從稿件抓出）；這是示範資料，請勿直接匯出上架。';
});

// 初始：?edit=article.… 優先，其次本機草稿，否則新增
const qid = new URLSearchParams(location.search).get('edit') ?? new URLSearchParams(location.search).get('id');
const draft = store.get(KEY, null);
if (qid && D.articles.some((a) => a.id === qid)) load(qid);
else if (draft?.state) { load(draft.pick); fill({ ...state, ...draft.state, categories: draft.state.categories ?? state.categories }); $('#te-msg').textContent = `已帶回 ${new Date(draft.savedAt).toLocaleString('zh-TW', { hour12: false })} 存的草稿。`; }
else load('new');
paint();

/* ───────── 第四十五輪：送審與上線（有寫入閘道時才出現；GitHub Pages 上仍用上架包） ───────── */
const b64 = (bytes) => { let out = ''; const CH = 0x8000; for (let i = 0; i < bytes.length; i += CH) out += String.fromCharCode.apply(null, bytes.subarray(i, i + CH)); return btoa(out); };
const GW_FIELDS = { title: '#te-title', issueId: '#te-issue', articleNo: '#te-no', articleType: '#te-type', pages: '#te-pages', authors: '#te-authors', affiliations: '#te-affils', doi: '#te-doi', keywords: '#te-keywords', abstractMarkdown: '#te-abstract', sections: '#te-sections', figures: '#te-figures', references: '#te-refs', assets: '#te-figfiles', owner: '#te-owner', diseases: '#te-dis-q', summary: '#te-summary', pdfUrl: '#te-pdfurl' };
initPublishGateway({
  exportObj: () => current().article,
  getContentId: () => { const { article } = current(); return /article\.teb-\d+-\d+-\d+$/.test(article.id) ? article.id : ''; },
  loadItem: (item) => { base = D.articles.find((a) => a.id === item.id) ?? item; fill(stateFromArticle(item, { categories: state.categories })); $('#te-editbox').hidden = false; $('#te-editbox').innerHTML = `<strong>送審中的版本</strong> <code>${esc(item.id)}</code>：已從系統帶回，附件（PDF、圖）留在系統裡，不必重傳。`; paint(); },
  exportExtra: () => {
    const { issue, article } = current();
    const companions = [];
    if (issue?._new) { const { _new, ...clean } = issue; void _new; companions.push(clean); }
    const files = [];
    if (pdf) files.push({ name: pdf.name, base64: b64(pdf.bytes) });
    for (const [name, m] of images) if ((article.figures ?? []).some((f) => f.file === name)) files.push({ name, base64: b64(m.bytes) });
    return { companions, files };
  },
  fieldInput: GW_FIELDS,
  onSaved: (sub) => { if (sub?.status === 'published') $('#te-msg').textContent = '文章已上線（含附件與卷期）。'; },
});
