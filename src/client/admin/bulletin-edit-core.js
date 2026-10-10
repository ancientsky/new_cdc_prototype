// /admin/bulletin/edit/ 疫情報導文章上架：純函式（不碰 DOM），瀏覽器與測試共用。
// 表單狀態（全部是字串、簡單陣列）→ article 物件（可直接存成 content/articles/{slug}.json）；新卷期時另產一個 publication 物件。
// 檢核直接用 ../bulletin-rules.js 的 articleProblems（與 CI 的 scripts/lib/validate.mjs 同一份），所以表單說「通過」，建置就一定通過。
//
// 為什麼以「一篇文章」為上架單位（第二十九輪，ARCHITECTURE §34）：
//   舊流程要承辦人手改卷期 JSON 的 articles[] 清單、另外上傳整本 PDF、再回去補頁碼，一期四篇就要改同一個檔四次，最容易打錯的是頁碼與順序。
//   現在一篇一檔：卷期頁由系統依 issueId 自動組目錄，篇次與頁碼重疊由檢核擋下，稿件貼上就自動切段，承辦人只確認不打字。
import { splitManuscript, articleProblems, hasErrors, suggestNextIssue, articlePath, issueSlugOf, citationOf, citationEnOf, ARTICLE_TYPES, SECTION_RULES, issueToc } from '../bulletin-rules.js';

export { splitManuscript, articleProblems, hasErrors, suggestNextIssue, articlePath, citationOf, citationEnOf, ARTICLE_TYPES, SECTION_RULES };

const BUILD_KEYS = new Set(['gov', 'sourceHash']);
const s = (v) => String(v ?? '').trim();
export const linesOf = (text) => String(text ?? '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
/** 去掉建置欄位（gov、__file、sourceHash…） */
export function stripBuild(o) { return Object.fromEntries(Object.entries(o ?? {}).filter(([k]) => !k.startsWith('__') && !BUILD_KEYS.has(k))); }

/* ───────── 作者 ───────── */
/** 每行「姓名 | 服務單位 | *」（第三欄有 * 或「通訊」＝通訊作者）→ authors[] */
export function parseAuthors(text) {
  return linesOf(text).map((line) => {
    const [name = '', unit = '', flag = ''] = line.split('|').map((x) => x.trim());
    const a = { name };
    if (unit) a.unit = unit;
    if (/\*|通訊|corresponding/i.test(flag)) a.corresponding = true;
    return a;
  }).filter((a) => a.name);
}
export const authorsText = (list) => (list ?? []).map((a) => [a.name, a.unit ?? '', a.corresponding ? '*' : ''].join(' | ').replace(/( \| )+$/, '')).join('\n');

/* ───────── id 與檔名 ───────── */
/** 文章 id：article.teb-{卷}-{期}-{篇次}；卷期 id：publication.bulletin-{卷}-{期} */
export const issueIdOf = (volume, issue) => `publication.bulletin-${s(volume)}-${s(issue)}`;
export const articleIdOf = (volume, issue, no) => `article.teb-${s(volume)}-${s(issue)}-${s(no)}`;
export const exportFilename = (a) => `content/articles/${String(a.id ?? 'article.x').replace(/^article\./, '')}.json`;
export const issueFilename = (p) => `content/publications/${String(p.id ?? 'publication.x').replace(/^publication\./, '')}.json`;

/* ───────── 表單狀態 ───────── */
export function emptyState({ today = '', owner = 'unit.epidemic-intelligence' } = {}) {
  return {
    mode: 'new', // 'new' 或既有文章 id
    issueMode: 'existing', issueId: '', newVolume: '', newIssue: '', newDate: today, // 卷期
    articleNo: '', articleType: 'original', title: '', titleEn: '', authors: '', pages: '', doi: '', owner, diseases: [], keywords: '', summary: '',
    manuscript: '', abstract: '', known: '', added: '', implications: '',
    sections: [], // [{ key, heading, markdown }]
    figures: [], // [{ kind, no, caption, markdown, alt, file }]
    references: '', acknowledgements: '', pdfUrl: '', pdfFile: '', note: '',
  };
}
export function stateFromArticle(a) {
  const base = emptyState();
  return {
    ...base, mode: a.id, issueMode: 'existing', issueId: a.issueId ?? '',
    articleNo: a.articleNo != null ? String(a.articleNo) : '', articleType: a.articleType ?? 'original', title: a.title ?? '', titleEn: a.titleEn ?? '', authors: authorsText(a.authors),
    pages: a.pages ?? '', doi: a.doi ?? '', owner: a.owner ?? base.owner, diseases: [...(a.diseases ?? [])], keywords: (a.keywords ?? []).join('、'), summary: a.summary ?? '',
    abstract: a.abstractMarkdown ?? '', known: a.highlights?.known ?? '', added: a.highlights?.added ?? '', implications: a.highlights?.implications ?? '',
    sections: (a.sections ?? []).map((x) => ({ key: x.key, heading: x.heading, markdown: x.markdown, level: x.level })),
    figures: (a.figures ?? []).map((f) => ({ kind: f.kind, no: String(f.no), caption: f.caption ?? '', markdown: f.markdown ?? '', alt: f.alt ?? '', file: f.file ?? '' })),
    references: (a.references ?? []).join('\n'), acknowledgements: a.acknowledgementsMarkdown ?? '', pdfUrl: a.pdfUrl ?? '', note: a.note ?? '',
  };
}

/** 貼上的稿件 → 套進表單狀態（只填空的欄位，不覆蓋承辦人已經打的；回傳 { state, report } 讓畫面說明切了什麼） */
export function applyManuscript(state, text) {
  const r = splitManuscript(text);
  const st = { ...state, sections: [...state.sections], figures: [...state.figures] };
  const report = [];
  if (r.abstract && !s(st.abstract)) { st.abstract = r.abstract; report.push('摘要'); }
  if (r.sections.length) {
    const have = new Set(st.sections.map((x) => x.key));
    const add = r.sections.filter((x) => !have.has(x.key));
    st.sections = [...st.sections, ...add];
    report.push(`${add.length} 段正文（${add.map((x) => x.heading).join('、')}）`);
  }
  if (r.figures.length) {
    const have = new Set(st.figures.map((f) => `${f.kind}${f.no}`));
    const add = r.figures.filter((f) => !have.has(`${f.kind}${f.no}`)).map((f) => ({ kind: f.kind, no: String(f.no), caption: f.caption, markdown: '', alt: '', file: '' }));
    st.figures = [...st.figures, ...add];
    if (add.length) report.push(`${add.length} 個圖表說明`);
  }
  if (r.references.length && !s(st.references)) { st.references = r.references.join('\n'); report.push(`${r.references.length} 筆參考文獻`); }
  if (r.acknowledgements && !s(st.acknowledgements)) { st.acknowledgements = r.acknowledgements; report.push('誌謝'); }
  return { state: st, report, unassigned: r.unassigned };
}

/** 段落 key：依標題對慣用名稱，否則 sec-N */
export function sectionKeyFor(heading, existing = []) {
  const h = s(heading);
  const rule = SECTION_RULES.find((r) => r.re.test(h.replace(/[【\[（(】\]）)：:]/g, '')));
  let key = rule ? rule.key : `sec-${existing.length + 1}`;
  let n = 2; const base = key;
  while (existing.includes(key)) key = `${base}-${n++}`;
  return key;
}

/* ───────── 表單狀態 → 物件 ───────── */
/** 目前選到／要新建的卷期物件（既有：issues 裡那筆；新建：依表單產一個最小 publication） */
export function resolveIssue(state, issues = [], { today = '' } = {}) {
  if (state.issueMode === 'new') {
    const vol = s(state.newVolume), no = s(state.newIssue);
    if (!vol || !no) return null;
    const date = s(state.newDate) || today;
    return {
      id: issueIdOf(vol, no), type: 'publication', title: `疫情報導 第 ${vol} 卷第 ${no} 期`, owner: 'unit.epidemic-intelligence',
      publishedAt: date, reviewedAt: date, reviewPeriodMonths: 0, status: 'published', audience: ['professional', 'public'], tasks: ['data'], sensitivity: 'public', license: 'OGDL-1.0',
      diseases: [], aiWhitelist: { requested: true, approvedBy: 'unit.oasis', approvedAt: date },
      languages: { 'zh-TW': { status: 'source' }, en: { status: 'none' }, ja: { status: 'none' }, tl: { status: 'none' }, vi: { status: 'none' }, id: { status: 'none' }, th: { status: 'none' } },
      summary: `疫情報導第 ${vol} 卷第 ${no} 期（${date} 出刊）；各篇全文請見本期目錄。`, keywords: ['疫情報導', `第 ${vol} 卷`],
      pubType: 'bulletin', series: '疫情報導', seriesEn: 'Taiwan Epidemiology Bulletin', volume: Number(vol), issue: Number(no), issn: '1680-5739', authors: ['疾病管制署'],
      pdfUrl: `/pending/?ref=${issueIdOf(vol, no)}&doc=${encodeURIComponent(`疫情報導 第 ${vol} 卷第 ${no} 期（PDF）`)}`,
      note: '由疫情報導上架後台建立的卷期；ISSN 與 PDF 連結待出版單位確認', _new: true,
    };
  }
  return issues.find((p) => p.id === state.issueId) ?? null;
}

/**
 * 表單狀態 → 完整 article 物件。base：修改中的既有文章（表單沒有的欄位一律保留，如 languages、i18n、legacyIds）。
 * issue：resolveIssue() 的結果；today：建置日（publishedAt 新文章用卷期出刊日，沒有就今天）。
 */
export function buildArticle(state, { today = '', issue = null, base = null } = {}) {
  const old = base ? stripBuild(base) : {};
  const no = Number(s(state.articleNo));
  const issueId = issue?.id ?? s(state.issueId);
  const vol = issue?.volume ?? '', iss = issue?.issue ?? '';
  const id = base ? old.id : articleIdOf(vol, iss, Number.isInteger(no) && no > 0 ? no : 'x');
  const date = issue?.publishedAt ?? old.publishedAt ?? today;
  const highlights = {};
  for (const k of ['known', 'added', 'implications']) if (s(state[k])) highlights[k] = s(state[k]);
  const a = {
    ...old,
    id, type: 'article', title: s(state.title), owner: s(state.owner) || old.owner || 'unit.epidemic-intelligence',
    publishedAt: old.publishedAt ?? date, reviewedAt: today || date, reviewPeriodMonths: 0, status: old.status ?? 'published',
    audience: old.audience ?? ['professional', 'public'], tasks: old.tasks ?? ['data'], sensitivity: old.sensitivity ?? 'public', license: old.license ?? 'OGDL-1.0',
    diseases: [...(state.diseases ?? [])],
    aiWhitelist: old.aiWhitelist ?? { requested: true, approvedBy: 'unit.oasis', approvedAt: today || date },
    languages: old.languages ?? { 'zh-TW': { status: 'source' }, en: { status: 'none' }, ja: { status: 'none' }, tl: { status: 'none' }, vi: { status: 'none' }, id: { status: 'none' }, th: { status: 'none' } },
    summary: s(state.summary) || firstSentence(state.abstract) || s(state.title),
    keywords: linesOf(String(state.keywords ?? '').replace(/[、,，;；]/g, '\n')),
    issueId, articleNo: Number.isInteger(no) && no > 0 ? no : 0, articleType: state.articleType || 'original',
    authors: parseAuthors(state.authors),
    sections: (state.sections ?? []).map((x, i, arr) => ({ key: x.key || sectionKeyFor(x.heading, arr.slice(0, i).map((y) => y.key)), heading: s(x.heading), markdown: String(x.markdown ?? '').trim(), ...(x.level === 3 ? { level: 3 } : {}) })),
  };
  if (s(state.titleEn)) a.titleEn = s(state.titleEn); else delete a.titleEn;
  if (s(state.pages)) a.pages = s(state.pages).replace(/\s*[–—~]\s*/g, '-'); else delete a.pages;
  if (s(state.doi)) a.doi = s(state.doi); else delete a.doi;
  if (s(state.abstract)) a.abstractMarkdown = String(state.abstract).trim(); else delete a.abstractMarkdown;
  if (Object.keys(highlights).length) a.highlights = highlights; else delete a.highlights;
  const figs = (state.figures ?? []).filter((f) => s(f.caption) || s(f.markdown)).map((f) => { const o = { kind: f.kind === 'table' ? 'table' : 'figure', no: Number(s(f.no)) || 0, caption: s(f.caption) }; if (s(f.file)) o.file = s(f.file); if (s(f.alt)) o.alt = s(f.alt); if (s(f.markdown)) o.markdown = String(f.markdown).trim(); return o; });
  if (figs.length) a.figures = figs; else delete a.figures;
  const refs = linesOf(state.references);
  if (refs.length) a.references = refs; else delete a.references;
  if (s(state.acknowledgements)) a.acknowledgementsMarkdown = String(state.acknowledgements).trim(); else delete a.acknowledgementsMarkdown;
  const pdf = s(state.pdfFile) ? `/files/${id}/${s(state.pdfFile)}` : s(state.pdfUrl);
  if (pdf) a.pdfUrl = pdf; else delete a.pdfUrl;
  if (s(state.note)) a.note = s(state.note); else delete a.note;
  if (!a.diseases.length) delete a.diseases;
  return a;
}
const firstSentence = (md) => { const t = String(md ?? '').replace(/[#*_>`]/g, '').trim(); const m = t.match(/^[^。！？\n]+[。！？]?/); return m ? m[0].trim().slice(0, 160) : ''; };

/** 檢核：同一期的其他文章（排除自己）＋卷期存在。回傳 bulletin-rules 的問題清單，再加上表單層的補充 */
export function problemsOf(article, { issue = null, articles = [], selfId = null, today = '' } = {}) {
  const siblings = articles.filter((x) => x.id !== (selfId ?? article.id) && x.issueId === article.issueId && x.status !== 'draft');
  const out = articleProblems(article, { issue, siblings });
  if (issue?._new) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(issue.publishedAt ?? ''))) out.push({ level: 'error', field: 'issueId', msg: '新卷期要填出刊日' });
    else if (today && issue.publishedAt > today) out.push({ level: 'warn', field: 'issueId', msg: `出刊日 ${issue.publishedAt} 在今天之後：合併後會到那天才上線（排程發布）` });
  }
  if (!article.keywords?.length) out.push({ level: 'warn', field: 'keywords', msg: '沒有關鍵字：全文搜尋與智慧查詢少了比對依據' });
  if (article.summary && article.summary.length > 160) out.push({ level: 'warn', field: 'summary', msg: '摘要一句超過 160 字，目錄列會很長' });
  return out;
}

/** 建議篇次：本期已有文章的最大篇次＋1 */
export function suggestArticleNo(articles, issueId, issue = null) {
  const nos = articles.filter((a) => a.issueId === issueId).map((a) => a.articleNo ?? 0);
  const legacy = issue?.articles?.length ?? 0;
  return Math.max(0, legacy, ...nos) + 1;
}

/** 右側「本期目錄預覽」：把目前這篇併進既有目錄 */
export function tocPreviewRows(article, issue, articles) {
  if (!issue) return [];
  const others = articles.filter((a) => a.id !== article.id);
  return issueToc(issue, [...others, { ...article, status: 'published' }]).map((r) => ({ ...r, isCurrent: r.article?.id === article.id }));
}

/** 上架包清單：文章 JSON、（新卷期時）卷期 JSON、PDF 放 content/assets/{id}/ */
export function packageEntries(article, issue, pdf = null) {
  const out = [{ name: exportFilename(article), data: `${JSON.stringify(article, null, 2)}\n` }];
  if (issue?._new) { const { _new, ...clean } = issue; void _new; out.push({ name: issueFilename(clean), data: `${JSON.stringify(clean, null, 2)}\n` }); }
  if (pdf?.name) out.push({ name: `content/assets/${article.id}/${pdf.name}`, data: pdf.bytes });
  return out;
}

export const previewUrl = (article) => (article.issueId ? articlePath(article) : `/publications/${issueSlugOf('')}x/`);

/* ───────── 右側預覽（純函式；page-preview.js 的 initPagePreview 以 render 選項呼叫） ───────── */
const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const ph = (t) => `<span class="adm-pv__ph">${esc(t)}</span>`;
/** 預覽區塊 → 表單欄位（data-field → focus／within），給 initPagePreview 的 fieldMap */
export const TE_FIELD_MAP = {
  'te-issue': { focus: '#te-issue', within: '#te-a', label: '卷期與篇次' },
  'te-title': { focus: '#te-title', within: '#te-title, #te-titleen', label: '篇名' },
  'te-authors': { focus: '#te-authors', within: '#te-authors', label: '作者' },
  'te-abstract': { focus: '#te-abstract', within: '#te-abstract', label: '摘要' },
  'te-hl': { focus: '#te-known', within: '.adm-te-hl', label: '重點三句話' },
  'te-sections': { focus: '#te-sections textarea, #te-sections input', within: '#te-e', label: '正文段落' },
  'te-figures': { focus: '#te-figures input', within: '#te-f', label: '圖表' },
  'te-refs': { focus: '#te-refs', within: '#te-refs', label: '參考文獻' },
  'te-ack': { focus: '#te-ack', within: '#te-ack', label: '誌謝' },
  'te-pdf': { focus: '#te-pdf', within: '#te-pdf, #te-pdfurl', label: 'PDF' },
  'te-meta': { focus: '#te-owner', within: '#te-owner, #te-doi, #te-dis-q, #te-dis-chips, #te-keywords, #te-summary', label: '權責單位、傳染病與關鍵字' },
};
const blk = (field, inner, cls = '') => `<div class="adm-pv__blk ${cls}" data-field="${field}" tabindex="0" role="button" aria-label="編輯${esc(TE_FIELD_MAP[field]?.label ?? field)}（跳到左側欄位）" title="點一下跳到「${esc(TE_FIELD_MAP[field]?.label ?? field)}」">${inner}</div>`;
/**
 * 文章頁預覽。a：buildArticle() 的結果；issue：resolveIssue()；h：{ md(markdown)→html, unitName(id), diseaseName(id), siteBase, today }
 */
export function renderArticlePreview(a, issue, h = {}) {
  const md = h.md ?? ((m) => `<p>${esc(m)}</p>`);
  const vol = issue ? `疫情報導 第 ${esc(issue.volume)} 卷第 ${esc(issue.issue)} 期 · ${esc(issue.publishedAt)}` : ph('（尚未選卷期）');
  const authors = (a.authors ?? []).length ? a.authors.map((x) => `${esc(x.name)}${x.unit ? `<span class="muted">（${esc(x.unit)}）</span>` : ''}${x.corresponding ? '＊' : ''}`).join('、') : ph('（尚未填作者）');
  const hl = a.highlights;
  const figOf = (f) => `<figure class="adm-pv__fig" id="pv-${f.kind}-${f.no}"><figcaption><strong>${f.kind === 'table' ? '表' : '圖'} ${esc(f.no)}</strong> ${esc(f.caption)}</figcaption>${f.markdown ? `<div class="c-prose">${md(f.markdown)}</div>` : f.file ? `<p class="muted">圖檔 ${esc(f.file)}${f.alt ? ` · 替代文字：${esc(f.alt)}` : ''}</p>` : ''}</figure>`;
  const placed = new Map(); const rest = [];
  for (const f of a.figures ?? []) { const re = new RegExp(`${f.kind === 'table' ? '表' : '圖'}\\s*${f.no}(?!\\d)`); const hit = (a.sections ?? []).find((x) => re.test(x.markdown ?? '')); if (hit) { if (!placed.has(hit.key)) placed.set(hit.key, []); placed.get(hit.key).push(f); } else rest.push(f); }
  const secs = (a.sections ?? []).length ? a.sections.map((x) => `<section class="adm-pv__sec"><h2 class="adm-pv__h2">${esc(x.heading) || ph('（段落標題）')}</h2><div class="c-prose">${x.markdown ? md(x.markdown) : `<p>${ph('（內文）')}</p>`}</div>${(placed.get(x.key) ?? []).map(figOf).join('')}</section>`).join('') : `<p>${ph('（尚未有正文。把稿件貼進 C 區按「自動切段」，或在 E 區逐段加）')}</p>`;
  const pdf = a.pdfUrl || issue?.pdfUrl;
  return `
<div class="adm-pv adm-pv--teb" lang="zh-TW">
  <div class="adm-pv__chrome" aria-hidden="true"><span></span><span></span><span></span><span class="adm-pv__url">${esc(h.siteBase ?? '')}${esc(a.issueId ? articlePath(a) : '/publications/…/')}</span></div>
  <div class="adm-pv__page">
    ${blk('te-issue', `<p class="adm-pv__crumb">出版品 › ${vol} › 第 ${esc(a.articleNo || '?')} 篇</p><p class="adm-pv__prov"><span class="adm-badge adm-badge--info">${esc(ARTICLE_TYPES[a.articleType] ?? a.articleType)}</span>${a.pages ? ` 頁 ${esc(a.pages)}` : ` ${ph('（頁碼未填）')}`}${a.doi ? ` · DOI ${esc(a.doi)}` : ''}</p>`)}
    ${blk('te-title', `<h1 class="adm-pv__h1">${a.title ? esc(a.title) : ph('（尚未填篇名）')}</h1>${a.titleEn ? `<p class="adm-pv__titleen" lang="en">${esc(a.titleEn)}</p>` : ''}`)}
    ${blk('te-authors', `<p class="adm-pv__authors">${authors}</p>`)}
    ${blk('te-meta', `<p class="adm-pv__prov">權責單位：<strong>${esc(h.unitName?.(a.owner) ?? a.owner)}</strong> · 相關傳染病：${(a.diseases ?? []).length ? a.diseases.map((d) => `<span class="adm-pv__tag">${esc(h.diseaseName?.(d) ?? d)}</span>`).join('') : ph('（未選）')} · 關鍵字：${(a.keywords ?? []).length ? esc(a.keywords.join('、')) : ph('（無）')}</p>`)}
    <p class="adm-pv__actions"><span class="adm-btn adm-btn--sm">${pdf ? (a.pdfUrl ? '下載本篇 PDF' : '下載本期 PDF') : '列印／另存 PDF'}</span> <span class="adm-btn adm-btn--ghost adm-btn--sm">複製引用格式</span> <span class="adm-btn adm-btn--ghost adm-btn--sm">機讀版 .md</span></p>
    ${blk('te-abstract', `<div class="adm-pv__abstract"><h2 class="adm-pv__h2">摘要</h2>${a.abstractMarkdown ? `<div class="c-prose">${md(a.abstractMarkdown)}</div>` : `<p>${ph('（尚未填摘要）')}</p>`}</div>`)}
    ${blk('te-hl', `<div class="adm-pv__hl"><h2 class="adm-pv__h2">重點</h2><dl>${['known', 'added', 'implications'].map((k) => `<div><dt>${{ known: '已知', added: '本文新增', implications: '對防疫實務的意義' }[k]}</dt><dd>${hl?.[k] ? esc(hl[k]) : ph('（未填）')}</dd></div>`).join('')}</dl></div>`)}
    ${blk('te-sections', secs, 'adm-pv__blk--body')}
    ${rest.length ? blk('te-figures', `<h2 class="adm-pv__h2">圖表</h2>${rest.map(figOf).join('')}`) : ''}
    ${a.acknowledgementsMarkdown ? blk('te-ack', `<h2 class="adm-pv__h2">誌謝</h2><div class="c-prose">${md(a.acknowledgementsMarkdown)}</div>`) : ''}
    ${blk('te-refs', `<h2 class="adm-pv__h2">參考文獻</h2>${(a.references ?? []).length ? `<ol class="adm-pv__list">${a.references.map((r) => `<li>${esc(r)}</li>`).join('')}</ol>` : `<p>${ph('（尚未填參考文獻）')}</p>`}`)}
    ${blk('te-pdf', `<div class="adm-pv__foot"><p>引用：<code>${esc(citationOf(a, issue))}</code></p><p>PDF：${pdf ? `<code>${esc(pdf)}</code>` : ph('（無；文章頁提供列印版）')} · 內容 ID：<code>${esc(a.id)}</code> · 機讀版 <code>${esc(String(a.id).replace(/^article\./, ''))}.md</code></p></div>`)}
  </div>
</div>`;
}

/** 本期目錄預覽（純函式） */
export function renderTocPreview(rows, issue) {
  if (!issue) return `<p class="adm-muted">先選卷期，這裡才會有目錄。</p>`;
  return `<div class="adm-pv adm-pv--toc"><div class="adm-pv__page"><p class="adm-pv__crumb">出版品 › 疫情報導</p><h1 class="adm-pv__h1">疫情報導 第 ${esc(issue.volume)} 卷第 ${esc(issue.issue)} 期${issue._new ? ' <span class="adm-badge adm-badge--warn">新卷期</span>' : ''}</h1><p class="adm-pv__prov">出版日 ${esc(issue.publishedAt)}</p><h2 class="adm-pv__h2">本期目錄</h2><ol class="adm-pv__toc">${rows.map((r) => `<li class="${r.isCurrent ? 'is-current' : ''}"><span class="adm-pv__tocno">${r.no}</span><div><p class="adm-pv__toct">${r.isCurrent ? '<strong>' : ''}${esc(r.title) || ph('（篇名）')}${r.isCurrent ? '</strong> <span class="adm-badge adm-badge--info">這篇</span>' : ''}</p><p class="muted">${esc(r.authors.join('、'))}${r.pages ? ` · 頁 ${esc(r.pages)}` : ''}${r.legacy ? ' · <span class="adm-badge adm-badge--gray">僅書目</span>' : ' · 全文 HTML'}</p></div></li>`).join('')}</ol></div></div>`;
}
