// 疫情報導文章（第二十九輪，ARCHITECTURE §34；第三十五輪補作者註記、DOI、分類、稿件切段強化）：建置、治理與後台共用的純函式。不碰 DOM、不讀檔。
//   - 網址與卷期歸屬：articlePath()、issueSlugOf()、articlesOfIssue()、categoryPath()
//   - 作者註記：authorNotes()——多個服務單位用上標數字、通訊作者加星號（刊載格式），單位清單自動編號
//   - 引用格式：citationOf()（中文）／citationEnOf()；DOI：suggestDoi()、doiProblems()
//   - 分類：DEFAULT_CATEGORIES（與官網「疫情報導」左側分類一致）；正式清單在 content/master/bulletin-categories.json，後台可加
//   - 稿件切段：splitManuscript()——把整份 Word／PDF 貼上的純文字切成篇名、作者、單位、摘要、各段、圖表說明、參考文獻、DOI、日期、關鍵字
//   - 檢核：articleProblems()——後台右側與 scripts/lib/validate.mjs 用同一份，所以表單說「通過」，建置就一定通過
// 為什麼把這些放在 src/client/ 而不是 scripts/lib/：後台在瀏覽器裡要即時檢核，建置在 Node 裡要擋 PR；同一份程式兩邊 import，規則不會分叉（與 careers-rules.js 同一個做法）。

/* ───────── 分類 ───────── */
// 官網「疫情報導」左側的分類（2026-10 截圖）：原著文章、疫情調查、焦點特寫、國內外疫情焦點、疫調快報、生安專欄、疫苗專欄、重要疫訊。
// key 是網址與 JSON 用的英文代號，不要改；中英文標籤可改。正式清單讀 content/master/bulletin-categories.json，這裡是沒有主檔時的預設與測試用。
export const DEFAULT_CATEGORIES = [
  { key: 'original', label: '原著文章', labelEn: 'Original Article', order: 1 },
  { key: 'investigation', label: '疫情調查', labelEn: 'Outbreak Investigation', order: 2 },
  { key: 'feature', label: '焦點特寫', labelEn: 'Feature', order: 3 },
  { key: 'global-focus', label: '國內外疫情焦點', labelEn: 'Epidemic Focus', order: 4 },
  { key: 'rapid-report', label: '疫調快報', labelEn: 'Rapid Report', order: 5 },
  { key: 'biosafety', label: '生安專欄', labelEn: 'Biosafety Column', order: 6 },
  { key: 'vaccine', label: '疫苗專欄', labelEn: 'Vaccine Column', order: 7 },
  { key: 'notice', label: '重要疫訊', labelEn: 'Important Notice', order: 8 },
];
export const CATEGORY_KEY_RE = /^[a-z][a-z0-9-]{1,30}$/;
export const sortCategories = (cats) => [...(cats ?? [])].sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || String(a.key).localeCompare(String(b.key)));
export const categoryOf = (cats, key) => (cats ?? DEFAULT_CATEGORIES).find((c) => c.key === key) ?? null;
export const categoryLabel = (cats, key, lang = 'zh-TW') => { const c = categoryOf(cats, key); return c ? (lang === 'zh-TW' ? c.label : c.labelEn || c.label) : (key ?? ''); };
/** 分類列表頁：/publications/bulletin/{key}/；期刊總覽 /publications/bulletin/（卷期網址是 /publications/bulletin-42-19/，不會撞） */
export const BULLETIN_HOME = '/publications/bulletin/';
export const categoryPath = (key) => `${BULLETIN_HOME}${key}/`;
/** 分類主檔本身的問題（後台「分類管理」與建置共用） */
export function categoryProblems(cats) {
  const out = [];
  const keys = new Set(), labels = new Set();
  for (const c of cats ?? []) {
    if (!CATEGORY_KEY_RE.test(String(c.key ?? ''))) out.push(`分類代號「${c.key ?? ''}」要是小寫英文、數字與連字號（2～31 字），例：vaccine-column`);
    if (keys.has(c.key)) out.push(`分類代號 ${c.key} 重複`); keys.add(c.key);
    if (!String(c.label ?? '').trim()) out.push(`分類 ${c.key} 沒有中文名稱`);
    if (labels.has(c.label)) out.push(`分類名稱「${c.label}」重複`); labels.add(c.label);
  }
  if (!(cats ?? []).length) out.push('至少要有一個分類');
  return out;
}
// 舊版（第二十九輪）articleType 代號的對照，讓舊 JSON 不必手改也能建置
export const LEGACY_TYPE_MAP = { 'outbreak-report': 'investigation', surveillance: 'feature', review: 'feature', brief: 'rapid-report', erratum: 'notice', other: 'notice' };
export const normalizeCategory = (key) => LEGACY_TYPE_MAP[key] ?? key;
// 與第二十九輪相容的標籤表（後台與模板仍有引用）
export const ARTICLE_TYPES = Object.fromEntries(DEFAULT_CATEGORIES.map((c) => [c.key, c.label]));
export const ARTICLE_TYPES_EN = Object.fromEntries(DEFAULT_CATEGORIES.map((c) => [c.key, c.labelEn]));

/* ───────── 網址與卷期 ───────── */
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
 * 回傳 [{ no, title, authors:[string], pages, doi, article?:fullArticle, legacy?:bibEntry }]
 */
export function issueToc(issue, articles) {
  const full = articlesOfIssue(articles, issue.id);
  const byNo = new Map(full.map((a) => [a.articleNo, a]));
  const rows = full.map((a) => ({ no: a.articleNo, title: a.title, authors: (a.authors ?? []).map((x) => x.name), pages: a.pages ?? null, doi: a.doi ?? null, article: a }));
  (issue.articles ?? []).forEach((e, i) => {
    const no = i + 1;
    if (byNo.has(no)) return;
    rows.push({ no, title: e.title, authors: e.authors ?? [], pages: e.pages ?? null, doi: e.doi ?? null, legacy: e });
  });
  return rows.sort((a, b) => a.no - b.no);
}

/* ───────── 作者與服務單位的註記 ───────── */
/**
 * 刊載格式：姓名後面上標服務單位編號，通訊作者加 *；頁尾列出「1 單位甲 2 單位乙」與「*通訊作者：姓名（E-mail）」。
 * 資料怎麼放：article.affiliations[]＝{ no, name, nameEn }；author.affiliations＝[編號…]；舊資料只有 author.unit（字串）時自動依出現順序編號。
 * 回傳 { affiliations:[{no,name,nameEn}], authors:[{…author, nos:[…], sup:'1,2*'}], corresponding:[author], showSup:boolean }
 *   showSup：單位多於一個，或資料本來就用編號，才印上標；全部同一個單位時不印數字，只在頁尾列單位（與 MMWR 單一單位的寫法一致）。
 */
export function authorNotes(a) {
  const explicit = Array.isArray(a?.affiliations) && a.affiliations.length > 0;
  const affs = explicit ? a.affiliations.map((x, i) => ({ no: Number(x.no ?? i + 1), name: String(x.name ?? ''), nameEn: x.nameEn || undefined })) : [];
  const authors = (a?.authors ?? []).map((x) => {
    let nos = Array.isArray(x.affiliations) ? x.affiliations.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];
    if (!nos.length && x.unit) {
      let f = affs.find((y) => y.name === x.unit);
      if (!f) { f = { no: affs.length + 1, name: x.unit }; affs.push(f); }
      nos = [f.no];
    }
    nos = [...new Set(nos)].sort((p, q) => p - q);
    return { ...x, nos, sup: `${nos.join(',')}${x.corresponding ? '*' : ''}` };
  });
  affs.sort((p, q) => p.no - q.no);
  return { affiliations: affs, authors, corresponding: authors.filter((x) => x.corresponding), showSup: explicit || affs.length > 1 };
}
/** 作者的單位名稱（第一個；給索引、JSON-LD 用） */
export const unitOfAuthor = (a, x) => { const n = authorNotes(a); const au = n.authors.find((y) => y === x || (y.name === x.name && y.sup === (x.sup ?? y.sup))); const no = au?.nos?.[0]; return n.affiliations.find((f) => f.no === no)?.name ?? x.unit ?? ''; };

/* ───────── 引用格式與 DOI ───────── */
const yearOf = (iso) => String(iso ?? '').slice(0, 4);
const authorsZh = (a) => (a.authors ?? []).map((x) => x.name).join('、');
/** 中文引用格式（仿疫情報導刊載格式）：作者。篇名。疫情報導 2026；42（19）：182-188。 doi:… */
export function citationOf(a, issue) {
  const vol = issue?.volume != null ? `${issue.volume}` : '';
  const no = issue?.issue != null ? `（${issue.issue}）` : '';
  const pages = a.pages ? `：${a.pages}` : '';
  return `${authorsZh(a)}。${a.title}。${issue?.series ?? '疫情報導'} ${yearOf(issue?.publishedAt ?? a.publishedAt)}；${vol}${no}${pages}。${a.doi ? ` doi:${a.doi}` : ''}`.trim();
}
/** 英文引用格式：Authors. Title. Taiwan Epidemiol Bull 2026;42(19):182-8. 作者有英文名就用英文名 */
export function citationEnOf(a, issue) {
  const authors = (a.authors ?? []).map((x) => x.nameEn || x.name).join(', ');
  const title = a.titleEn || a.title;
  const vol = issue?.volume != null ? `${issue.volume}` : '';
  const no = issue?.issue != null ? `(${issue.issue})` : '';
  const pages = a.pages ? `:${a.pages}` : '';
  return `${authors}. ${title}. Taiwan Epidemiol Bull ${yearOf(issue?.publishedAt ?? a.publishedAt)};${vol}${no}${pages}.${a.doi ? ` doi:${a.doi}` : ''}`;
}
/** 任何 DOI 的長相（10.前綴/後綴） */
export const DOI_RE = /^10\.\d{4,9}\/\S+$/;
/** 疫情報導的 DOI 慣例（從刊物實際 DOI 歸納：10.6524/EB.{出刊年月 YYYYMM}_{卷}({期}).{篇次 4 位}）；只用來「建議」與「提醒」，不強制 */
export const TEB_DOI_RE = /^10\.6524\/EB\.(\d{6})_(\d+)\((\d+)\)\.(\d{4})$/;
export function suggestDoi(issue, articleNo) {
  if (!issue || issue.volume == null || issue.issue == null || !/^\d{4}-\d{2}/.test(String(issue.publishedAt ?? ''))) return '';
  return `10.6524/EB.${String(issue.publishedAt).slice(0, 7).replace('-', '')}_${issue.volume}(${issue.issue}).${String(Number(articleNo) || 0).padStart(4, '0')}`;
}
/** DOI 的站內解析網址：/doi/10.6524/EB.202610_42(19).0001 → 301 到文章頁（正式站由伺服器對照檔轉址；DOI 本身永遠不變，只有落地網址改） */
export const doiPath = (doi) => `/doi/${String(doi ?? '').trim()}`;
export const doiUrl = (doi) => `https://doi.org/${String(doi ?? '').trim()}`;
/** DOI 的問題：格式、與卷期篇次不符、與其他文章重複 */
export function doiProblems(a, { issue = null, others = [] } = {}) {
  const out = [];
  const doi = String(a.doi ?? '').trim();
  if (!doi) return out;
  if (!DOI_RE.test(doi)) { out.push({ level: 'error', field: 'doi', msg: `DOI「${doi}」格式不對：要像 10.6524/EB.202610_42(19).0001，不要含 https://doi.org/` }); return out; }
  const dup = others.find((x) => String(x.doi ?? '').trim() === doi);
  if (dup) out.push({ level: 'error', field: 'doi', msg: `DOI ${doi} 已被「${dup.title}」使用` });
  const m = doi.match(TEB_DOI_RE);
  if (!m) out.push({ level: 'warn', field: 'doi', msg: `DOI 與期刊慣用寫法（${suggestDoi(issue, a.articleNo) || '10.6524/EB.YYYYMM_卷(期).篇次'}）不同；若出版單位有給正式 DOI 以它為準` });
  else if (issue && (Number(m[2]) !== Number(issue.volume) || Number(m[3]) !== Number(issue.issue))) out.push({ level: 'warn', field: 'doi', msg: `DOI 裡的卷期 ${m[2]}(${m[3]}) 與所屬卷期 ${issue.volume}(${issue.issue}) 不一致` });
  else if (Number.isInteger(a.articleNo) && Number(m[4]) !== a.articleNo) out.push({ level: 'warn', field: 'doi', msg: `DOI 末四碼 ${m[4]} 與篇次 ${a.articleNo} 不一致（刊物慣例是篇次）` });
  return out;
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

/* ───────── 中文數字（圖一、表二） ───────── */
const CN_DIGITS = { 零: 0, 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
/** 「十二」→ 12；「3」→ 3；認不得 → null */
export function cnToNum(s) {
  const t = String(s ?? '').trim();
  if (/^\d+$/.test(t)) return Number(t);
  if (!/^[零一二兩三四五六七八九十]+$/.test(t)) return null;
  if (t === '十') return 10;
  const [tens, ones] = t.includes('十') ? t.split('十') : ['', t];
  const ten = t.includes('十') ? (tens ? CN_DIGITS[tens] : 1) : 0;
  const one = ones ? CN_DIGITS[ones] : 0;
  if (ten == null || one == null) return null;
  return ten * 10 + one;
}
const CN_NUM_SRC = '[零一二兩三四五六七八九十]+';
/** 正文裡「圖 1」「圖一」「表1」的比對式（放圖表的位置、檢核「正文有沒有提到」都用這個） */
export function figRefRe(kind, no) {
  const n = Number(no);
  const cn = Object.entries(CN_DIGITS).find(([, v]) => v === n)?.[0];
  const alts = [String(n), ...(cn ? [cn] : []), ...(n > 10 && n < 20 ? [`十${Object.entries(CN_DIGITS).find(([, v]) => v === n - 10)?.[0]}`] : []), ...(n === 10 ? ['十'] : [])];
  const zh = kind === 'table' ? '表' : '圖';
  const en = kind === 'table' ? 'Table' : 'Fig(?:ure|\\.)?';
  return new RegExp(`(?:${zh}|${en})\\s*(?:${alts.join('|')})(?![\\d${CN_NUM_SRC.slice(1, -2)}])`, 'i');
}

/* ───────── 稿件切段 ───────── */
// 疫情報導文章的慣用標題。同一組的任何寫法都對到同一個 key，所以「材料與方法」「方法」「研究方法」都切成 methods。
// 第三十五輪補疫情調查報告常見的段名（事件源起、背景介紹、個案報告、感染源及接觸者調查、檢體採集及檢驗結果、疫情研判、防治措施、討論及建議）。
export const SECTION_RULES = [
  { key: 'abstract', heading: '摘要', re: /^(摘\s*要|中文摘要|abstract)$/i },
  { key: 'intro', heading: '前言', re: /^(前\s*言|引\s*言|緒\s*論|introduction)$/i },
  { key: 'background', heading: '背景', re: /^(背\s*景|背景介紹|背景說明|background)$/i },
  { key: 'origin', heading: '事件源起', re: /^(事件源起|事件緣起|事件概述|事件經過|疫情概述|案例源起)$/i },
  { key: 'case', heading: '個案報告', re: /^(個案報告|病例報告|個案描述|病例描述|個案介紹|case report)$/i },
  { key: 'methods', heading: '材料與方法', re: /^((材料|資料)(與|和|及)方法|方\s*法|研究方法|調查方法|materials?\s*(and|&)\s*methods?|methods?)$/i },
  { key: 'investigation', heading: '疫情調查', re: /^(疫情調查|感染源(及|與|和)接觸者調查|感染源調查|接觸者調查|流行病學調查|疫情調查(及|與)處理|epidemiolog(ical|y)\s*investigation)$/i },
  { key: 'lab', heading: '檢驗結果', re: /^(檢體採集(及|與|和)檢驗結果|檢驗結果|實驗室檢驗|檢體檢驗|實驗室檢驗結果|laboratory (results|findings|investigation))$/i },
  { key: 'results', heading: '結果', re: /^(結\s*果|調查結果|研究結果|results?)$/i },
  { key: 'assessment', heading: '疫情研判', re: /^(疫情研判|研\s*判|風險評估|risk assessment)$/i },
  { key: 'measures', heading: '防治措施', re: /^(防治措施|防疫措施|處置措施|介入措施|公衛處置|防治作為|control measures|public health (response|measures))$/i },
  { key: 'discussion', heading: '討論', re: /^(討\s*論|討論(及|與|和)建議|discussion)$/i },
  { key: 'conclusion', heading: '結論', re: /^(結\s*論|結論(及|與|和)建議|建\s*議|conclusions?|recommendations?)$/i },
  { key: 'acknowledgements', heading: '誌謝', re: /^(誌\s*謝|致\s*謝|acknowledg(e)?ments?)$/i },
  { key: 'references', heading: '參考文獻', re: /^(參考文獻|參考資料|references?)$/i },
];
const HEADING_MAX = 24;
const stripHeadingDeco = (line) => String(line ?? '').trim().replace(/^[【\[（(]\s*/, '').replace(/^([一二三四五六七八九十]+[、.．]|\d+[、.．)]|[IVX]+\.)\s*/i, '').replace(/[】\]）)：:]+$/g, '').trim();
/** 一行是不是章節標題：短、沒有句號、符合慣用標題（允許「一、前言」「1. 方法」「【結果】」等前綴） */
export function headingKeyOf(line) {
  const s = stripHeadingDeco(line);
  if (!s || s.length > HEADING_MAX || /[。；，]/.test(s)) return null;
  const r = SECTION_RULES.find((x) => x.re.test(s));
  return r ? r.key : null;
}
const FIG_RE = new RegExp(`^(圖|表|Figure|Table|Fig\\.)\\s*(\\d+|${CN_NUM_SRC})(?:[\\s.．、:：]+(.*)|(?![一-鿿])(.*))$`, 'i'); // 「圖二為…」這種句子不是圖說：中文數字後面要有「、」或空白才算
const REF_RE = /^\s*(?:\[(\d+)\]|(\d+)[.、．)]|（(\d+)）)\s*(.+)$/;
// 版面雜物（從 PDF 複製時會夾帶）：頁首「2026 年 10 月 6 日 第 42 卷 第 19 期」、頁尾「疫情報導 183」、側標「│疫情調查│」
const HEADER_RE = /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*第\s*(\d+)\s*卷\s*第\s*(\d+)\s*期/;
// 頁尾「疫情報導 183」：有些 PDF 的文字層少了「導」字（排版字型），所以「導」可有可無
const FOOTER_PAGE_RE = /疫情報導?\s+(\d{1,4})\s*$/;
const CONT_NEXT_RE = /^[（(]\s*接下頁\s*[）)]$/;
const CONT_PREV_RE = /^[（(]\s*續上頁\s*[）)]\s*/;
const TABLE_NOTE_RE = /^([a-z][.．:：]\s*|註\s*[\d一二三四五六七八九十]*\s*[：:.]?\s*|\*+\s*|（表頭上層：)\S/;
const SIDEBAR_RE = /^[│|｜][^\s|│｜]{1,12}[│|｜]$/; // 側標「│原著文章│」；Markdown 表格的「| a | b |」不算
const FOOTER_LEFT_RE = /^(\d{1,4})\s+疫情報導?(\s+\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日)?\s*$/; // 舊版左頁頁首「464 疫情報導 2014年11月25日」
const AFF_NAME_OK = (name) => ORG_WORD.test(name) && !/[。：:（(），、；,;]/.test(name) && !/\d{4}\s*[.．]/.test(name) && !/\s{2,}/.test(name) && (isLatin(name) ? name.length <= 90 && !/\. |\.$/.test(name) : name.length <= 45);
const PUBLISHER_RE = /^衛生福利部疾病管制署$/;
// 標籤型資訊（整行或行尾）：投稿／接受日期、DOI、通訊作者、E-mail、關鍵字
const META_RULES = [
  { key: 'receivedAt', re: /(投稿日期|收稿日期|Received)[：:]\s*(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/i, date: true },
  { key: 'acceptedAt', re: /(接受日期|接受刊登日期|Accepted)[：:]\s*(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/i, date: true },
  { key: 'receivedAt', re: /Received[：:]\s*([A-Za-z]{3,9})\.?\s+(\d{1,2}),\s*(\d{4})/i, enDate: true },
  { key: 'acceptedAt', re: /Accepted[：:]\s*([A-Za-z]{3,9})\.?\s+(\d{1,2}),\s*(\d{4})/i, enDate: true },
  { key: 'doi', re: /(?:^|\s{2,}|　)DOI[：:]\s*(10\.\d{4,9}\/[^\s，。]+)/i }, // 只認「DOI：」標籤在行首或欄位起點的；文獻裡的 doi:10.1038/… 不算
  { key: 'correspondingNameEn', re: /Corresponding author[：:]\s*([A-Za-z][A-Za-z.'\- ]+?)\s*[\d*]*$/i },
  { key: 'correspondingName', re: /通訊作者[：:]\s*([^\s，,;；（(]+)/ },
  { key: 'email', re: /E-?mail[：:]\s*([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/i },
  { key: 'keywords', re: /^關鍵字[：:]\s*(.+)$/, list: /[、，,;；]/ },
  { key: 'keywordsEn', re: /^Key\s*words?[：:]\s*(.+)$/i, list: /[,;；]/ },
];
const isLatin = (s) => { const t = String(s ?? '').replace(/[\s\d\p{P}]/gu, ''); return t.length > 0 && !/[一-鿿]/.test(t); };
const SENT_END = /[。！？；：）」』】]$|[.!?;:)\]]$/;
// 篇名可以用括號收尾（「…之調查（上）」「…（範例）」）：有成對括號、沒有句號就仍算篇名
const TITLE_PAREN_RE = /^[^。！？]*[（(][^（()）]{1,20}[）)]$/;
const LIST_START = /^([-*•]\s|\d+[.、．)]\s*|[一二三四五六七八九十]+[、.．]|（[一二三四五六七八九十\d]+）|\([a-z\d]+\))/i;
const SUBHEAD_RE = /^([一二三四五六七八九十]+[、.．]|\(?[一二三四五六七八九十]\)|（[一二三四五六七八九十]）)\s*([^\s，。；：]{1,14})$/;
const ORG_WORD = /(署|局|中心|組|室|科|處|院|系|所|部|大學|學校|醫院|衛生|Center|Centre|Division|Department|Institute|University|Hospital|Bureau|Ministry|School|College)/i;
// 作者列：「李泱 1*、戴詩縈 1、林稜 2」或「Yang Li1*, Shih-Yin Tai1」；每個人：姓名＋（上標編號，可多個）＋（*）
const AUTH_TOKEN_RE = /^([一-鿿·‧]{2,6}|[A-Za-z][A-Za-z.'\- ]{1,40}?)\s*([\d,，、.．\s]*)\s*(\*?)$/;
function parseAuthorLine(line) {
  // 「＊」（全形星號）與「1.2」（兩個單位用點隔開）是排版常見寫法，先正規化
  const s = String(line ?? '').trim().replace(/[＊﹡]/g, '*');
  if (!s || s.length > 240 || /[。；：]/.test(s)) return null;
  const parts = s.includes('、') ? s.split('、') : s.split(/,\s+(?=[A-Z一-鿿])|,(?=[A-Z一-鿿])/);
  const out = [];
  for (const p of parts) {
    const m = p.trim().match(AUTH_TOKEN_RE);
    if (!m) return null;
    const nos = m[2].split(/[,，、.．\s]+/).filter(Boolean).map(Number).filter((n) => Number.isInteger(n) && n > 0 && n < 30);
    out.push({ name: m[1].trim(), affiliations: nos, corresponding: m[3] === '*' });
  }
  const anyMark = out.some((x) => x.affiliations.length || x.corresponding);
  if (!out.length || (!anyMark && out.length < 2) || (!anyMark && out.some((x) => isLatin(x.name)))) return null;
  return out;
}
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const dateOf = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
/** 兩個鄰行能不能併成一段（PDF 複製時一段被切成多行）：上一行沒收尾、下一行不是清單／標題 */
function joinable(prev, next) {
  if (!prev || !next) return false;
  if (/^### /.test(prev) || SENT_END.test(prev) || LIST_START.test(next) || SUBHEAD_RE.test(next)) return false;
  return true;
}
const joinLines = (lines) => {
  const out = [];
  for (const l of lines) {
    if (l && out.length && out[out.length - 1] && joinable(out[out.length - 1], l)) {
      const p = out[out.length - 1];
      const needSpace = /[A-Za-z0-9)\]]$/.test(p) && /^[A-Za-z0-9(\[]/.test(l);
      out[out.length - 1] = p + (needSpace ? ' ' : '') + l;
    } else out.push(l);
  }
  return out;
};
const toMarkdown = (lines) => joinLines(lines.map((l) => (SUBHEAD_RE.test(l) ? `### ${l}` : l))).join('\n').replace(/\n{3,}/g, '\n\n').trim();

/**
 * 整份稿件（純文字，每段一行或空行分段）→
 * { title, abstract, abstractEn, sections[], references[], figures[], acknowledgements, unassigned[], authors[], affiliations[], meta, guessedHeadings[], report[] }
 * 做法：先挑掉從 PDF 複製會夾帶的頁首頁尾，再抓標籤型資訊（DOI、投稿／接受日期、通訊作者、E-mail、關鍵字），接著逐行掃：
 *   - 作者列（姓名＋上標編號＋*）與其上一行（篇名）；頁尾「1 單位甲」「2 單位乙」配成服務單位清單
 *   - 遇到慣用標題就開新段；短而沒有標點、前一段已收尾、下一行是正文的單行，當成「推測的標題」（列在 guessedHeadings 請人核對）
 *   - 「圖一、…」「表 1 …」單行當圖表說明抽出來；參考文獻每行一筆、去編號、折行併回
 *   - 第二個「Abstract」且內容是英文 → abstractEn；參考文獻之後的英文篇名與作者列 → titleEn／英文作者名
 * 不做猜測性的改寫：切不出來的文字一律留在 unassigned。
 */
export function splitManuscript(text, { categories = DEFAULT_CATEGORIES } = {}) {
  const out = { title: '', abstract: '', abstractEn: '', sections: [], references: [], figures: [], acknowledgements: '', unassigned: [], authors: [], affiliations: [], meta: {}, guessedHeadings: [], report: [] };
  const meta = out.meta;
  const pagesSeen = [];
  // NFC：PDF 文字層常用相容漢字（「劉」U+F9C7），不正規化就不在 [一-鿿] 範圍、作者列會認不出來
  const raw = String(text ?? '').normalize('NFC').replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/　/g, ' ').replace(/[ \t]+$/g, '').trim());
  // 1. 頁首頁尾與標籤型資訊
  const lines = [];
  for (let li = 0; li < raw.length; li++) {
    let line = raw[li];
    const h = line.match(HEADER_RE);
    if (h) { meta.date ??= dateOf(h[1], h[2], h[3]); meta.volume ??= Number(h[4]); meta.issue ??= Number(h[5]); line = line.replace(HEADER_RE, '').trim(); }
    const fp = line.match(FOOTER_PAGE_RE);
    if (fp) { pagesSeen.push(Number(fp[1])); line = line.replace(FOOTER_PAGE_RE, '').trim(); }
    const fl = line.match(FOOTER_LEFT_RE);
    if (fl) { pagesSeen.push(Number(fl[1])); line = ''; }
    if (line === '疫情報導') { for (let k = li + 1; k <= li + 2 && k < raw.length; k++) { if (/^\d{1,4}$/.test(raw[k])) { pagesSeen.push(Number(raw[k])); raw[k] = ''; break; } if (raw[k]) break; } line = ''; }
    if (!line || SIDEBAR_RE.test(line) || PUBLISHER_RE.test(line)) { lines.push(''); continue; }
    let consumedAll = false;
    for (const r of META_RULES) {
      const m = line.match(r.re);
      if (!m) continue;
      if (r.date) meta[r.key] ??= dateOf(m[2], m[3], m[4]);
      else if (r.enDate) { const mo = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()); if (mo >= 0) meta[r.key] ??= dateOf(m[3], mo + 1, m[2]); }
      else if (r.list) { let v = m[1]; const nx = raw[li + 1] ?? ''; if (nx && nx.length <= 40 && !/[：:。]/.test(nx) && !SENT_END.test(v) && !headingKeyOf(nx)) { v += (/[A-Za-z]$/.test(v) && /^[A-Za-z]/.test(nx) ? ' ' : '') + nx; raw[li + 1] = ''; } meta[r.key] ??= v.split(r.list).map((x) => x.trim()).filter(Boolean); }
      else if (r.key === 'doi') { if (meta.doi && meta.doi !== m[1]) (meta.doiConflicts ??= []).push(m[1]); meta.doi ??= m[1]; }
      else meta[r.key] ??= m[1];
      if (m.index === 0 && m[0].length >= line.length - 1) consumedAll = true; else line = line.replace(m[0], '').trim();
    }
    if (consumedAll) { lines.push(''); continue; }
    // 分類名在 PDF 刊頭常是「疫 情 調 查」這種加寬字距的排法，文字層會變成字與字之間有空白；比對時先把空白拿掉
    const squeezed = line.replace(/\s+/g, '');
    const cat = categories.find((c) => c.label === line || c.label === squeezed || c.labelEn?.toLowerCase() === line.toLowerCase());
    if (cat && !meta.category) { meta.category = cat.key; lines.push(''); continue; }
    lines.push(line);
  }
  if (pagesSeen.length) meta.pages = `${Math.min(...pagesSeen)}-${Math.max(...pagesSeen)}`;
  // 2. 服務單位：「1 單位甲」同行，或「1」「2」接著兩行單位名
  const affMap = new Map();
  // 單位列只會在篇首（第一個標題之前）或投稿日期／通訊作者／DOI 那幾行附近（中文頁尾、英文頁尾），參考文獻裡「2. 某某系統」不算
  const headingAt = lines.findIndex((l) => headingKeyOf(l));
  const metaAt = raw.map((l, i) => (/通訊作者|投稿日期|接受日期|E-?mail[：:]|Received[：:]|Accepted[：:]|DOI[：:]/i.test(l) ? i : -1)).filter((i) => i >= 0); // 看原始行（第 1 步已把這些標籤從 lines 拿掉）
  const affRegion = (i) => (headingAt < 0 || i < headingAt) || metaAt.some((k) => Math.abs(k - i) <= 4);
  const setAff = (no, name) => { const cur = affMap.get(no); if (!cur) affMap.set(no, { no, name }); else if (isLatin(name) && !cur.nameEn) cur.nameEn = name; else if (!isLatin(name) && isLatin(cur.name)) { cur.nameEn = cur.name; cur.name = name; } };
  const affIdx = new Set();
  for (let i = 0; i < lines.length; i++) {
    if (!affRegion(i)) continue;
    // 「1 單位甲」「1.單位甲」「1單位甲」（有些 PDF 的上標數字和單位名之間沒有空白）
    const m = lines[i].match(/^(\d)(?:\s*[.、]\s*|\s+|(?=[一-鿿A-Z]))(.{4,90})$/); // 沒有分隔符時，編號後面要直接接中文或大寫字母（「2020 年…」這種篇名不是）
    if (m && AFF_NAME_OK(m[2].trim())) { setAff(Number(m[1]), m[2].trim()); affIdx.add(i); continue; }
    if (/^\d$/.test(lines[i])) {
      const nums = [];
      let j = i;
      while (j < lines.length && (/^\d$/.test(lines[j]) || lines[j] === '')) { if (lines[j]) nums.push({ no: Number(lines[j]), idx: j }); j++; }
      let k = j; const names = [];
      while (k < lines.length && names.length < nums.length && (lines[k] === '' || AFF_NAME_OK(lines[k].replace(/^\d\s*[.、]?\s*/, '')))) { if (lines[k]) names.push({ name: lines[k].replace(/^\d\s*[.、]?\s*/, ''), idx: k }); k++; }
      if (nums.length && names.length === nums.length) { nums.forEach((n, x) => { setAff(n.no, names[x].name); affIdx.add(n.idx); affIdx.add(names[x].idx); }); i = k - 1; }
    }
    if (/^\d{1,2}\*$/.test(lines[i])) affIdx.add(i); // 「1*」：通訊作者註記的殘行
  }
  // 3. 作者列與篇名（第一個慣用標題之前）
  let authorIdx = -1;
  const titleIdx = new Set();
  const firstHeading = lines.findIndex((l) => headingKeyOf(l));
  for (let i = 0; i < (firstHeading < 0 ? lines.length : firstHeading); i++) {
    if (affIdx.has(i)) continue;
    // 作者列折成兩行（第一行以「、」或「,」收尾）：併起來再解析
    let au = parseAuthorLine(lines[i]);
    if (!au && /[、,，]$/.test(lines[i]) && lines[i + 1]) { au = parseAuthorLine(`${lines[i]}${lines[i + 1]}`); if (au) { lines[i] = `${lines[i]}${lines[i + 1]}`; lines[i + 1] = ''; } }
    if (au && !isLatin(au.map((x) => x.name).join(''))) { out.authors = au; authorIdx = i; break; }
  }
  if (authorIdx > 0) {
    // 舊版排版：上標數字另成一行放在作者列上方（「1  1  2  3」），數量對得上就照順序配給作者
    const sup = lines[authorIdx - 1]?.match(/^(\d{1,2}\*?)(\s+\d{1,2}\*?)+$/) ? lines[authorIdx - 1].trim().split(/\s+/) : null;
    if (sup && sup.length === out.authors.length && out.authors.every((a) => !a.affiliations.length)) { out.authors.forEach((a, k) => { a.affiliations = [Number(sup[k].replace('*', ''))]; if (sup[k].endsWith('*')) a.corresponding = true; }); titleIdx.add(authorIdx - 1); }
    // 篇名：作者列往上找，最多三行（篇名常折成兩行），短、沒有句號、中間不隔空行
    let i = authorIdx - 1;
    while (i >= 0 && (titleIdx.has(i) || affIdx.has(i) || !lines[i])) i--; // 篇名與作者列之間可能隔一個空行（分類名那行被拿掉後也會留空行）
    const parts = [];
    while (i >= 0 && lines[i] && !affIdx.has(i) && parts.length < 3 && lines[i].length <= 120 && (!SENT_END.test(lines[i]) || TITLE_PAREN_RE.test(lines[i])) && !HEADER_RE.test(lines[i])) { parts.unshift(lines[i]); titleIdx.add(i); i--; }
    if (parts.length) out.title = parts.join(parts.every((x) => !isLatin(x)) ? '' : ' ').replace(/\s{2,}/g, ' ');
  }
  const skip = new Set([...affIdx, ...titleIdx]); if (authorIdx >= 0) skip.add(authorIdx);
  // 3b. 整期合刊：第二個「摘要」之後是另一篇文章，切掉放到 unassigned 並提醒（單篇上傳才是正常用法）
  const absIdx = lines.map((l, i) => (/^摘\s*要$/.test(stripHeadingDeco(l)) ? i : -1)).filter((i) => i >= 0);
  if (absIdx.length >= 2) {
    // 第二篇的篇名、作者列（短行，中間可能隔空行）在「摘要」上方：一起切掉；碰到長的正文行或標題就停
    let cut = absIdx[1];
    for (let k = absIdx[1] - 1, n = 0; k >= 0 && n < 8; k--, n++) { const l = lines[k]; if (l && (l.length > 60 || headingKeyOf(l) || /[。．.]$/.test(l))) break; cut = k; }
    const rest = lines.slice(cut).filter((l, i) => !skip.has(cut + i) && l);
    lines.length = cut;
    out.unassigned.push(rest.join('\n'));
    out.report.push(`這份稿件有 ${absIdx.length} 個「摘要」，看起來是整期合刊（多篇文章）；只帶入第一篇，其餘放在「未歸類」。請改成單篇 PDF 再上傳`);
  }
  // 全部作者同一單位時，頁尾只有一行單位名（沒有編號）：當作單位 1、配給所有作者
  if (!affMap.size && out.authors.length && out.authors.every((a) => !a.affiliations.length)) {
    const metaIdx = metaAt.length ? metaAt[0] : lines.findIndex((l) => /通訊作者|投稿日期|E-?mail[：:]/i.test(l));
    const near = metaIdx >= 0 ? lines.slice(Math.max(0, metaIdx - 3), metaIdx + 3).find((l) => l && AFF_NAME_OK(l) && !/^\d/.test(l) && !PUBLISHER_RE.test(l)) : null;
    if (near) { setAff(1, near); out.authors.forEach((a) => { a.affiliations = [1]; }); const li = lines.indexOf(near); if (li >= 0) { lines[li] = ''; skip.add(li); } }
  }
  // 4. 逐行切段
  let cur = null; // { key, heading, lines, guessed }
  const pre = [];
  const stray = []; // 參考文獻段裡沒有編號、也接不上的行（通常是英文篇名與作者）
  let lastTable = null; // 剛剛切到的「表 N」，接下來的 | 行是它的內容
  const flush = () => {
    if (!cur) return;
    if (cur.key === 'references') {
      // 參考文獻：有編號的行開新筆（「1.」單獨一行也算），其餘行一律接在上一筆後面（期刊格式的文獻常在篇名「。」後折行）；
      // 段尾若有英文作者列（英文摘要頁），從它的前一行（英文篇名）起都不是文獻，交給 stray。
      const ls = cur.lines.filter(Boolean);
      let cut = ls.length;
      for (let i = 0; i < ls.length; i++) {
        const joined = /,$/.test(ls[i]) && ls[i + 1] ? `${ls[i]} ${ls[i + 1]}` : null;
        const au = parseAuthorLine(ls[i]) ?? (joined ? parseAuthorLine(joined) : null);
        if (au && isLatin(au.map((x) => x.name).join(''))) { cut = i; while (cut > 0 && i - cut < 3 && isLatin(ls[cut - 1]) && !REF_RE.test(ls[cut - 1]) && !/[.。;；]$/.test(ls[cut - 1])) cut--; break; }
      }
      const refs = [];
      let pendingNo = false;
      for (const l of ls.slice(0, cut)) {
        const m = l.match(REF_RE);
        if (/^\d{1,3}[.、．)]?$/.test(l)) { refs.push(''); pendingNo = true; continue; }
        if (m) { if (pendingNo && refs[refs.length - 1] === '') refs.pop(); refs.push(m[4].trim()); pendingNo = false; continue; }
        if (pendingNo && refs.length && refs[refs.length - 1] === '') { refs[refs.length - 1] = l; pendingNo = false; continue; }
        else if (refs.length) refs[refs.length - 1] += (/[A-Za-z0-9.,;:)\]]$/.test(refs[refs.length - 1]) && /^[A-Za-z0-9(\[]/.test(l) ? ' ' : '') + l;
        else stray.push(l);
      }
      stray.push(...ls.slice(cut));
      out.references.push(...refs.filter(Boolean));
    } else {
      const body = toMarkdown(cur.lines);
      if (cur.key === 'abstract') {
        if (!out.abstract) out.abstract = body;
        else if (isLatin(body.split(/\n{2,}/)[0])) { const paras = body.split(/\n{2,}/); const cut = paras.findIndex((p) => p.length < 80 && !/[.!?]$/.test(p)); out.abstractEn = (cut < 0 ? paras : paras.slice(0, cut)).join('\n\n'); if (cut >= 0) out.unassigned.push(paras.slice(cut).join('\n')); }
        else if (body) out.unassigned.push(body);
      }
      else if (cur.key === 'acknowledgements') out.acknowledgements = body;
      else if (body) out.sections.push({ key: cur.key, heading: cur.heading, markdown: body, ...(cur.guessed ? { guessed: true } : {}) });
    }
    cur = null;
  };
  const openSection = (key, heading, guessed = false) => {
    flush();
    const dup = out.sections.some((s) => s.key === key);
    const k = dup ? `${key}-${out.sections.filter((s) => s.key === key || s.key.startsWith(`${key}-`)).length + 1}` : key;
    cur = { key: k, heading, lines: [], guessed };
    if (guessed) out.guessedHeadings.push(heading);
  };
  const prevText = (i) => { for (let j = i - 1; j >= 0; j--) { if (skip.has(j)) continue; if (lines[j]) return lines[j]; return ''; } return ''; };
  const nextText = (i) => { for (let j = i + 1; j < lines.length; j++) { if (skip.has(j)) continue; if (lines[j]) return lines[j]; } return ''; };
  for (let i = 0; i < lines.length; i++) {
    if (skip.has(i)) continue;
    const line = lines[i];
    const key = headingKeyOf(line);
    if (key) { openSection(key, stripHeadingDeco(line)); continue; }
    if (!line) { (cur ? cur.lines : pre).push(''); continue; }
    // 表格內容（pdf-manuscript 依座標還原的 Markdown 表格與表下註解）：掛到剛剛那個「表 N」；「(接下頁)」丟掉、「(續上頁) 表 N」接回同一個表
    if (CONT_NEXT_RE.test(line)) continue;
    const chartMark = line.match(/^〔圖內文字\s*(\d+)\s*行已略過〕$/);
    if (chartMark) { if (!out.report.some((r) => r.startsWith('圖內的文字'))) out.report.push('圖內的文字（座標軸刻度、圖例、資料標籤）已略過，不會進正文；請確認圖檔有一併上傳'); continue; }
    if (lastTable) {
      // markdown ＝ 表格列 + 空行 + 註解；「(續上頁)」接回來的列要插在註解之前（不然表格會在註解處斷掉），重複的表頭列與註解不再加
      if (/^\|/.test(line)) {
        const [tbl = '', ...rest] = lastTable.markdown ? lastTable.markdown.split('\n\n') : [];
        const rows = tbl ? tbl.split('\n') : [];
        if (rows.length < 2 || !rows.slice(0, 2).includes(line)) rows.push(line); // 續頁重印的表頭列與分隔列不再加；內容一樣的資料列照加
        lastTable.markdown = [rows.join('\n'), ...rest].join('\n\n');
        continue;
      }
      if (lastTable.markdown && TABLE_NOTE_RE.test(line)) { if (!lastTable.markdown.split('\n').includes(line)) lastTable.markdown += `\n\n${line}`; continue; }
      lastTable = null;
    }
    const fig = line.replace(CONT_PREV_RE, '').match(FIG_RE);
    if (fig && cur?.key !== 'references' && line.length <= 160) {
      const no = cnToNum(fig[2]);
      if (no != null) {
        const kind = /^(表|Table)/i.test(fig[1]) ? 'table' : 'figure';
        const exists = out.figures.find((f) => f.kind === kind && f.no === no);
        if (exists) { if (kind === 'table') lastTable = exists; continue; }
        const f = { kind, no, caption: (fig[3] ?? fig[4] ?? '').trim() || line };
        out.figures.push(f);
        if (kind === 'table') lastTable = f;
        continue;
      }
    }
    // 推測的標題：2～16 字、無標點、不是清單或小標、前一段已收尾（或是第一行）、下一行是正文
    if (cur?.key !== 'references' && line.length >= 2 && line.length <= 16 && /[\u4e00-\u9fff]/.test(line) && !/[\p{P}\d]/u.test(line) && !/^(見|如|詳|註)/.test(line) && !SUBHEAD_RE.test(line)) {
      const p = prevText(i), n = nextText(i);
      if ((p === '' || SENT_END.test(p)) && n && n.length > 20 && !parseAuthorLine(n) && (cur || out.abstract || pre.some(Boolean))) { openSection(`sec-${out.sections.length + 1}`, line, true); continue; }
    }
    (cur ? cur.lines : pre).push(line);
  }
  flush();
  // 5. 標題之前的文字：還沒有摘要就當摘要；已有摘要就放到 unassigned 讓人決定
  const preText = toMarkdown(pre);
  if (preText) {
    if (!out.abstract && out.sections.length) out.abstract = preText;
    else if (!out.sections.length && !out.abstract && preText.length > 200) { out.sections.push({ key: 'body', heading: '正文', markdown: preText }); out.report.push('稿件沒有章節標題，整篇當作一段「正文」；摘要請自行填寫'); }
    else out.unassigned.push(preText);
  }
  if (!out.title && meta.category) { out.title = categoryLabel(categories, meta.category); out.report.push(`稿件裡找不到篇名（也沒有作者列），先以分類名「${out.title}」代入，請改成正式篇名`); }
  // 6. 參考文獻之後的英文篇名與作者
  for (let i = 0; i < stray.length; i++) {
    if (/,$/.test(stray[i]) && stray[i + 1] && parseAuthorLine(`${stray[i]} ${stray[i + 1]}`)) stray.splice(i, 2, `${stray[i]} ${stray[i + 1]}`);
    const au = parseAuthorLine(stray[i]);
    if (au && isLatin(au.map((x) => x.name).join(''))) {
      meta.authorsEn = au.map((x) => x.name);
      // 英文篇名常折成兩三行：往上收連續的英文短行（不是文獻、沒有句號）
      let from = i;
      while (from > 0 && i - from < 3 && isLatin(stray[from - 1]) && stray[from - 1].length <= 200 && !REF_RE.test(stray[from - 1]) && !/[.;]$/.test(stray[from - 1])) from--;
      if (from < i) { meta.titleEn = stray.slice(from, i).join(' ').replace(/\s+/g, ' '); stray.splice(from, i - from + 1); } else stray.splice(i, 1);
      break;
    }
  }
  if (stray.length) out.unassigned.push(stray.join('\n'));
  // 7. 整理
  out.affiliations = [...affMap.values()].sort((a, b) => a.no - b.no);
  if (meta.correspondingName) for (const a of out.authors) if (a.name === meta.correspondingName) a.corresponding = true;
  if (meta.email) { const c = out.authors.find((a) => a.corresponding); if (c) c.email = meta.email; }
  if (meta.authorsEn?.length === out.authors.length) out.authors.forEach((a, i) => { a.nameEn = meta.authorsEn[i]; });
  const seen = new Set();
  out.figures = out.figures.filter((f) => { const k = `${f.kind}${f.no}`; if (seen.has(k)) return false; seen.add(k); return true; }).sort((a, b) => a.kind.localeCompare(b.kind) || a.no - b.no);
  if (out.guessedHeadings.length) out.report.push(`依版面推測的標題（請核對）：${out.guessedHeadings.join('、')}`);
  if (meta.doiConflicts?.length) out.report.push(`稿件裡出現兩個不同的 DOI：${meta.doi} 與 ${meta.doiConflicts.join('、')}，已採第一個，請向出版單位確認`);
  if (meta.pages) out.report.push(`頁碼 ${meta.pages} 是從頁尾頁碼推得（含英文摘要頁），請核對`);
  return out;
}

/* ───────── 檢核（後台與建置共用）───────── */
/**
 * 一篇文章的問題清單。issue：所屬卷期（找不到＝null）；siblings：同一期的其他文章（不含自己）；others：全部其他文章（DOI 唯一用）；categories：分類主檔。
 * 回傳 [{ level:'error'|'warn', field, msg }]；error 會擋建置。
 */
export function articleProblems(a, { issue = null, siblings = [], others = null, categories = null } = {}) {
  const out = [];
  const err = (field, msg) => out.push({ level: 'error', field, msg });
  const warn = (field, msg) => out.push({ level: 'warn', field, msg });
  if (!a.issueId) err('issueId', '沒有指定所屬卷期');
  else if (!issue) err('issueId', `所屬卷期 ${a.issueId} 不存在（先建立卷期，或選既有卷期）`);
  else if (issue.pubType !== 'bulletin') err('issueId', `所屬卷期 ${a.issueId} 不是疫情報導（pubType bulletin）`);
  if (!Number.isInteger(a.articleNo) || a.articleNo < 1) err('articleNo', '篇次要是 1 起的整數');
  else if (siblings.some((s) => s.articleNo === a.articleNo)) err('articleNo', `本期已有第 ${a.articleNo} 篇（${siblings.find((s) => s.articleNo === a.articleNo)?.title ?? ''}）`);
  if (!String(a.title ?? '').trim()) err('title', '篇名必填');
  if (categories) {
    if (!a.articleType) warn('articleType', '沒有選分類：分類列表頁與目錄會少這篇');
    else if (!categoryOf(categories, normalizeCategory(a.articleType))) err('articleType', `分類「${a.articleType}」不在分類主檔（content/master/bulletin-categories.json）；可在後台「分類管理」新增`);
  }
  if (!(a.authors?.length) || a.authors.some((x) => !String(x.name ?? '').trim())) err('authors', '至少一位作者，且每位都要有姓名');
  else {
    const notes = authorNotes(a);
    if (!notes.affiliations.length) warn('authors', '沒有填任何作者的服務單位（刊載格式會印出單位）');
    const affNos = new Set(notes.affiliations.map((f) => f.no));
    for (const x of notes.authors) for (const n of x.nos) if (!affNos.has(n)) err('authors', `作者「${x.name}」的服務單位編號 ${n} 不在單位清單裡`);
    for (const f of notes.affiliations) if (!String(f.name ?? '').trim()) err('affiliations', `服務單位 ${f.no} 沒有名稱`);
    const unused = notes.affiliations.filter((f) => !notes.authors.some((x) => x.nos.includes(f.no)));
    if (unused.length) warn('affiliations', `服務單位 ${unused.map((f) => `${f.no} ${f.name}`).join('、')} 沒有任何作者引用`);
    if (!notes.corresponding.length) warn('authors', '沒有標通訊作者（刊載格式以 * 標示）');
    for (const c of notes.corresponding) if (c.email && !/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(c.email)) err('authors', `通訊作者「${c.name}」的 E-mail 格式不對`);
    for (const c of notes.corresponding) if (!c.email) warn('authors', `通訊作者「${c.name}」沒有 E-mail（刊載格式會在服務單位下方印出通訊作者 E-mail）`);
  }
  if (a.pages != null && a.pages !== '') {
    const p = parsePages(a.pages);
    if (!p) err('pages', '頁碼格式要像 1-8 或 12');
    else for (const s of siblings) { const q = parsePages(s.pages); if (pagesOverlap(p, q)) err('pages', `頁碼 ${a.pages} 與本期第 ${s.articleNo} 篇（${s.pages}）重疊`); }
  } else warn('pages', '沒有頁碼：引用格式會少掉頁碼，建議排版定稿後補上');
  out.push(...doiProblems(a, { issue, others: (others ?? siblings).filter((x) => x !== a && x.id !== a.id) }));
  if (!String(a.doi ?? '').trim()) warn('doi', `沒有 DOI：每篇疫情報導都有 DOI，後台「建議 DOI」會依卷期篇次產生 ${suggestDoi(issue, a.articleNo) || ''}`.trim());
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
  for (const f of a.figures ?? []) {
    if (!figRefRe(f.kind, f.no).test(body)) warn('figures', `正文沒有提到${f.kind === 'table' ? '表' : '圖'} ${f.no}`);
    if (f.kind === 'figure' && !f.file && !f.markdown) warn('figures', `圖 ${f.no} 沒有圖檔也沒有文字版：文章頁只會有說明文字`);
    if (f.file && !String(f.alt ?? '').trim()) err('figures', `${f.kind === 'table' ? '表' : '圖'} ${f.no} 有圖檔但沒有替代文字（無障礙必填）`);
    if (f.file && !(a.assets ?? []).some((x) => x.file === f.file)) err('figures', `圖檔 ${f.file} 沒有在 assets[] 宣告（後台拖圖進來會自動宣告；手改 JSON 請補 file／kind image／alt／license）`);
  }
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
