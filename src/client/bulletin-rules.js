// 疫情報導文章（第二十九輪，ARCHITECTURE §34）：建置、治理與後台共用的純函式。不碰 DOM、不讀檔。
//   - 網址與卷期歸屬：articlePath()、issueSlugOf()、articlesOfIssue()
//   - 引用格式：citationOf()（中文）／citationEnOf()
//   - 稿件切段：splitManuscript()——把整份 Word 貼上的純文字切成摘要、前言、方法、結果、討論、參考文獻、圖表說明
//   - 檢核：articleProblems()——後台右側與 scripts/lib/validate.mjs 用同一份，所以表單說「通過」，建置就一定通過
// 為什麼把這些放在 src/client/ 而不是 scripts/lib/：後台在瀏覽器裡要即時檢核，建置在 Node 裡要擋 PR；同一份程式兩邊 import，規則不會分叉（與 careers-rules.js 同一個做法）。

export const ARTICLE_TYPES = {
  original: '原著文章', 'outbreak-report': '疫情調查報告', surveillance: '監測報告', review: '綜論', brief: '短訊', erratum: '更正', other: '其他',
};
export const ARTICLE_TYPES_EN = {
  original: 'Original Article', 'outbreak-report': 'Outbreak Report', surveillance: 'Surveillance Report', review: 'Review', brief: 'Brief Report', erratum: 'Erratum', other: 'Other',
};

/** 卷期 id → 網址片段（publication.bulletin-42-13 → bulletin-42-13） */
export const issueSlugOf = (issueId) => String(issueId ?? '').replace(/^publication\./, '');
/** 文章網址：/publications/{卷期}/{篇次}/（巢在卷期頁底下，麵包屑與相對連結自然成立） */
export const articlePath = (a) => `/publications/${issueSlugOf(a.issueId)}/${a.articleNo}/`;

/** 某一期的全文文章（published／archived），依篇次排序 */
export function articlesOfIssue(articles, issueId, { statuses = ['published', 'archived'] } = {}) {
  return (articles ?? []).filter((a) => a.issueId === issueId && statuses.includes(a.status)).sort((a, b) => (a.articleNo ?? 0) - (b.articleNo ?? 0));
}

/**
 * 卷期的目錄列：全文文章優先；舊式只有 articles[]（書目）的篇目，沒有被同篇次全文取代的照舊列出。
 * 回傳 [{ no, title, authors:[string], pages, article?:fullArticle, legacy?:bibEntry }]
 */
export function issueToc(issue, articles) {
  const full = articlesOfIssue(articles, issue.id);
  const byNo = new Map(full.map((a) => [a.articleNo, a]));
  const rows = full.map((a) => ({ no: a.articleNo, title: a.title, authors: (a.authors ?? []).map((x) => x.name), pages: a.pages ?? null, article: a }));
  (issue.articles ?? []).forEach((e, i) => {
    const no = i + 1;
    if (byNo.has(no)) return;
    rows.push({ no, title: e.title, authors: e.authors ?? [], pages: e.pages ?? null, legacy: e });
  });
  return rows.sort((a, b) => a.no - b.no);
}

const yearOf = (iso) => String(iso ?? '').slice(0, 4);
const authorsZh = (a) => (a.authors ?? []).map((x) => x.name).join('、');
/** 中文引用格式（仿疫情報導刊載格式）：作者。篇名。疫情報導 2026；42：1-8。 */
export function citationOf(a, issue) {
  const vol = issue?.volume != null ? `${issue.volume}` : '';
  const no = issue?.issue != null ? `（${issue.issue}）` : '';
  const pages = a.pages ? `：${a.pages}` : '';
  return `${authorsZh(a)}。${a.title}。${issue?.series ?? '疫情報導'} ${yearOf(issue?.publishedAt ?? a.publishedAt)}；${vol}${no}${pages}。${a.doi ? ` doi:${a.doi}` : ''}`.trim();
}
/** 英文引用格式：Authors. Title. Taiwan Epidemiol Bull 2026;42(13):1-8. */
export function citationEnOf(a, issue) {
  const authors = (a.authors ?? []).map((x) => x.name).join(', ');
  const title = a.titleEn || a.title;
  const vol = issue?.volume != null ? `${issue.volume}` : '';
  const no = issue?.issue != null ? `(${issue.issue})` : '';
  const pages = a.pages ? `:${a.pages}` : '';
  return `${authors}. ${title}. Taiwan Epidemiol Bull ${yearOf(issue?.publishedAt ?? a.publishedAt)};${vol}${no}${pages}.${a.doi ? ` doi:${a.doi}` : ''}`;
}

/* ───────── 頁碼 ───────── */
export const PAGES_RE = /^\d+(-\d+)?$/;
export function parsePages(s) {
  const m = String(s ?? '').trim().match(/^(\d+)(?:\s*[-–—~]\s*(\d+))?$/);
  if (!m) return null;
  const a = Number(m[1]), b = m[2] != null ? Number(m[2]) : a;
  return b < a ? null : [a, b];
}
export const pagesOverlap = (p, q) => !!(p && q && p[0] <= q[1] && q[0] <= p[1]);

/* ───────── 稿件切段 ───────── */
// 疫情報導文章的慣用標題。同一組的任何寫法都對到同一個 key，所以「材料與方法」「方法」「研究方法」都切成 methods。
export const SECTION_RULES = [
  { key: 'abstract', heading: '摘要', re: /^(摘\s*要|中文摘要|abstract)$/i },
  { key: 'intro', heading: '前言', re: /^(前\s*言|背\s*景|引\s*言|緒\s*論|introduction|background)$/i },
  { key: 'methods', heading: '材料與方法', re: /^((材料|資料)(與|和|及)方法|方\s*法|研究方法|調查方法|materials?\s*(and|&)\s*methods?|methods?)$/i },
  { key: 'results', heading: '結果', re: /^(結\s*果|調查結果|研究結果|results?)$/i },
  { key: 'discussion', heading: '討論', re: /^(討\s*論|discussion)$/i },
  { key: 'conclusion', heading: '結論', re: /^(結\s*論|結論與建議|建\s*議|conclusions?)$/i },
  { key: 'acknowledgements', heading: '誌謝', re: /^(誌\s*謝|致\s*謝|acknowledg(e)?ments?)$/i },
  { key: 'references', heading: '參考文獻', re: /^(參考文獻|參考資料|references?)$/i },
];
const HEADING_MAX = 24;
/** 一行是不是章節標題：短、沒有句號、符合慣用標題（允許「一、前言」「1. 方法」「【結果】」等前綴） */
export function headingKeyOf(line) {
  const s = String(line ?? '').trim().replace(/^[【\[（(]\s*/, '').replace(/^([一二三四五六七八九十]+[、.．]|\d+[、.．)]|[IVX]+\.)\s*/i, '').replace(/[】\]）)：:]+$/g, '').trim();
  if (!s || s.length > HEADING_MAX || /[。；，]/.test(s)) return null;
  const r = SECTION_RULES.find((x) => x.re.test(s));
  return r ? r.key : null;
}
const FIG_RE = /^(圖|表|Figure|Table|Fig\.)\s*(\d+)[\s.．、:：]*(.*)$/i;
const REF_RE = /^\s*(?:\[(\d+)\]|(\d+)[.、．)]|（(\d+)）)\s*(.+)$/;

/**
 * 整份稿件（純文字，每段一行或空行分段）→ { abstract, sections[], references[], figures[], acknowledgements, unassigned[] }
 * 做法：逐行掃，遇到慣用標題就開新段；標題之前的文字若還沒有任何段，當成摘要（作者常把摘要放最前面且不寫「摘要」兩字）。
 * 「圖 1 …」「表 1 …」開頭的單行當圖表說明抽出來（放進 figures，不留在正文）；參考文獻段每行一筆、去掉前面的編號。
 * 不做任何猜測性的改寫：切不出來的文字一律留在 unassigned，請承辦人手動放。
 */
export function splitManuscript(text) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/　/g, ' ').trim());
  const out = { abstract: '', sections: [], references: [], figures: [], acknowledgements: '', unassigned: [] };
  let cur = null; // { key, heading, lines }
  const pre = [];
  const flush = () => {
    if (!cur) return;
    const body = cur.lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    if (cur.key === 'abstract') out.abstract = body;
    else if (cur.key === 'references') out.references = cur.lines.filter(Boolean).map((l) => l.replace(REF_RE, '$4').trim()).filter(Boolean);
    else if (cur.key === 'acknowledgements') out.acknowledgements = body;
    else if (body) out.sections.push({ key: cur.key, heading: cur.heading, markdown: body });
    cur = null;
  };
  for (const line of lines) {
    const key = headingKeyOf(line);
    if (key) {
      flush();
      const rule = SECTION_RULES.find((r) => r.key === key);
      const dup = out.sections.some((s) => s.key === key);
      cur = { key: dup ? `${key}-${out.sections.filter((s) => s.key.startsWith(key)).length + 1}` : key, heading: rule.heading, lines: [] };
      continue;
    }
    const fig = line.match(FIG_RE);
    if (fig && cur?.key !== 'references' && line.length <= 160) {
      out.figures.push({ kind: /^(表|Table)/i.test(fig[1]) ? 'table' : 'figure', no: Number(fig[2]), caption: fig[3].trim() || line });
      continue;
    }
    (cur ? cur.lines : pre).push(line);
  }
  flush();
  const preText = pre.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (preText) {
    // 標題之前的文字：還沒有摘要就當摘要；已有摘要就放到 unassigned 讓人決定
    if (!out.abstract && out.sections.length) out.abstract = preText; else out.unassigned.push(preText);
  }
  // 圖表依類型與編號排序、去重（同號只留第一筆）
  const seen = new Set();
  out.figures = out.figures.filter((f) => { const k = `${f.kind}${f.no}`; if (seen.has(k)) return false; seen.add(k); return true; }).sort((a, b) => a.kind.localeCompare(b.kind) || a.no - b.no);
  return out;
}

/* ───────── 檢核（後台與建置共用）───────── */
/**
 * 一篇文章的問題清單。issue：所屬卷期（找不到＝null）；siblings：同一期的其他文章（不含自己）。
 * 回傳 [{ level:'error'|'warn', field, msg }]；error 會擋建置。
 */
export function articleProblems(a, { issue = null, siblings = [] } = {}) {
  const out = [];
  const err = (field, msg) => out.push({ level: 'error', field, msg });
  const warn = (field, msg) => out.push({ level: 'warn', field, msg });
  if (!a.issueId) err('issueId', '沒有指定所屬卷期');
  else if (!issue) err('issueId', `所屬卷期 ${a.issueId} 不存在（先建立卷期，或選既有卷期）`);
  else if (issue.pubType !== 'bulletin') err('issueId', `所屬卷期 ${a.issueId} 不是疫情報導（pubType bulletin）`);
  if (!Number.isInteger(a.articleNo) || a.articleNo < 1) err('articleNo', '篇次要是 1 起的整數');
  else if (siblings.some((s) => s.articleNo === a.articleNo)) err('articleNo', `本期已有第 ${a.articleNo} 篇（${siblings.find((s) => s.articleNo === a.articleNo)?.title ?? ''}）`);
  if (!String(a.title ?? '').trim()) err('title', '篇名必填');
  if (!(a.authors?.length) || a.authors.some((x) => !String(x.name ?? '').trim())) err('authors', '至少一位作者，且每位都要有姓名');
  else if (!a.authors.some((x) => String(x.unit ?? '').trim())) warn('authors', '沒有填任何作者的服務單位（刊載格式會印出單位）');
  if (a.pages != null && a.pages !== '') {
    const p = parsePages(a.pages);
    if (!p) err('pages', '頁碼格式要像 1-8 或 12');
    else for (const s of siblings) { const q = parsePages(s.pages); if (pagesOverlap(p, q)) err('pages', `頁碼 ${a.pages} 與本期第 ${s.articleNo} 篇（${s.pages}）重疊`); }
  } else warn('pages', '沒有頁碼：引用格式會少掉頁碼，建議排版定稿後補上');
  if (!String(a.abstractMarkdown ?? '').trim()) warn('abstractMarkdown', '沒有摘要：文章頁頂端的摘要框會是空的，智慧查詢也少一塊可引用的內容');
  if (!(a.sections?.length)) err('sections', '至少要有一段正文');
  else {
    const keys = new Set();
    for (const s of a.sections) {
      if (!String(s.heading ?? '').trim()) err('sections', '有段落沒有標題');
      if (!String(s.markdown ?? '').trim()) err('sections', `段落「${s.heading ?? ''}」沒有內文`);
      if (keys.has(s.key)) err('sections', `段落 key 重複：${s.key}`); keys.add(s.key);
    }
  }
  const nos = new Map();
  for (const f of a.figures ?? []) { const k = `${f.kind}${f.no}`; if (nos.has(k)) err('figures', `${f.kind === 'table' ? '表' : '圖'} ${f.no} 重複`); nos.set(k, 1); }
  const body = [a.abstractMarkdown, ...(a.sections ?? []).map((s) => s.markdown)].join('\n');
  for (const f of a.figures ?? []) { const label = `${f.kind === 'table' ? '表' : '圖'}\\s*${f.no}`; if (!new RegExp(label).test(body)) warn('figures', `正文沒有提到${f.kind === 'table' ? '表' : '圖'} ${f.no}`); }
  if (!a.pdfUrl && !issue?.pdfUrl) warn('pdfUrl', '單篇與本期都沒有 PDF：文章頁會提供列印版代替');
  if (a.highlights && ['known', 'added', 'implications'].some((k) => !String(a.highlights[k] ?? '').trim())) warn('highlights', '重點三句話有缺：已知／本文新增／對防疫實務的意義建議三句都填');
  return out;
}
export const hasErrors = (problems) => problems.some((p) => p.level === 'error');

/** 下一期的建議卷期（同卷下一期；跨年＝新卷第 1 期） */
export function suggestNextIssue(issues, today = '') {
  const bulletins = (issues ?? []).filter((p) => p.pubType === 'bulletin' && p.volume != null && p.issue != null);
  if (!bulletins.length) return { volume: 1, issue: 1 };
  const latest = bulletins.sort((a, b) => Number(b.volume) - Number(a.volume) || Number(b.issue) - Number(a.issue))[0];
  const latestYear = String(latest.publishedAt ?? '').slice(0, 4);
  const thisYear = String(today ?? '').slice(0, 4);
  if (thisYear && latestYear && thisYear > latestYear) return { volume: Number(latest.volume) + 1, issue: 1 };
  return { volume: Number(latest.volume), issue: Number(latest.issue) + 1 };
}
