// PDF 文字 → 機讀版（Markdown 分段＋頁碼）的純函式（第十九輪；docs/pdf-ingest.md）。
// 輸入：pdftotext（不加 -layout）輸出的純文字，或其他工具抽出的同樣格式文字。
// 為什麼不直接把整份 PDF 丟進索引：PDF 是「排版」格式，抽出的文字有頁碼、目錄點線、斷行、表格拆散成碎字，
// 直接切塊會讓答案引擎引用到「臺 南 市 (22760) 、 高 雄 市」這種句子；而且引用時無法告訴讀者「在第幾頁」。
// 這裡把文字整理成「章／節／附件」為單位的段落，每頁插入頁碼標記，表格頁與表單附件標出來交給人工處理。
// 沒有任何 import，Node 與瀏覽器都能用（後台預處理日後也可以直接呼叫）。

/** 頁碼標記：Markdown 內獨立一行 〔p.12〕；文件頁模板轉成 id="page-12" 錨點，索引時拿來標記每個段落的頁碼 */
export const PAGE_MARK_RE = /^〔p\.(\d+)〕$/;
export const pageMark = (n) => `〔p.${n}〕`;

const CN = '一二三四五六七八九十';
const CN_NUM = `[${CN}]+`;
export const CHAPTER_RE = new RegExp(`^第\\s*(${CN_NUM})\\s*章\\s*(.*)$`);
export const SECTION_RE = new RegExp(`^第\\s*(${CN_NUM})\\s*節\\s*(.*)$`);
export const ANNEX_RE = new RegExp(`^附件\\s*(${CN_NUM})\\s*[：:︰]?\\s*(.*)$`);
const LIST_START_RE = /^(?:[一二三四五六七八九十]+、|（[一二三四五六七八九十\d]+）|\([一二三四五六七八九十\d]+\)|\d+[.、)]|[①-⑳]|[•●■□◆○])/;
const SENT_END_RE = /[。！？；：」』）)】]$/;
const STANDALONE_HEAD_RE = /^(?:前\s*言|參考文獻|登革熱|屈公病)$/;
const TOC_LEADER_RE = /(?:…{3,}|\.{6,}|‧{4,})/;

/** 中文數字（一～九十九）→ 整數 */
export function cnToInt(s) {
  const str = String(s);
  if (/^\d+$/.test(str)) return Number(str);
  const v = (c) => CN.indexOf(c) + 1;
  if (str === '十') return 10;
  if (str.startsWith('十')) return 10 + v(str[1]);
  if (str.length === 2 && str[1] === '十') return v(str[0]) * 10;
  if (str.length === 3 && str[1] === '十') return v(str[0]) * 10 + v(str[2]);
  return v(str[0]);
}

/**
 * 依頁碼行切頁。pdftotext 的輸出在每頁頂端有一行只有頁碼（前一行為空白）；頁碼必須連續（1、2、3…）才算，
 * 避免把內文裡單獨一行的數字（表格儲存格）當成頁碼。第 1 頁之前的內容（封面、目錄）標為 front。
 */
export function splitPages(text) {
  const lines = String(text).replace(/\r/g, '').replace(/\f/g, '\n').replace(/ /g, ' ').split('\n');
  const pages = [{ page: 0, front: true, lines: [] }];
  let expect = 1;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    const prev = i ? lines[i - 1].trim() : '';
    // 前一行空白最常見；少數頁前一行是很短的標題殘行（例如「附件一」），也接受
    if (/^\d{1,3}$/.test(t) && Number(t) === expect && (prev === '' || prev.length <= 6)) {
      pages.push({ page: expect, front: false, lines: [] });
      expect++;
      continue;
    }
    pages[pages.length - 1].lines.push(lines[i]);
  }
  return pages;
}

/** 這一頁像表格嗎：非空白行多半很短、少有句末標點。表格抽成文字後欄位會拆散，不能直接當句子引用 */
export function isTableLike(lines) {
  const ls = lines.map((l) => l.trim()).filter(Boolean);
  if (ls.length < 15) return false;
  const short = ls.filter((l) => l.length <= 10).length;
  const ended = ls.filter((l) => SENT_END_RE.test(l)).length;
  return short / ls.length >= 0.5 && ended / ls.length < 0.2;
}

/** 斷行還原：PDF 每行固定寬度斷開，中文句子被切成好幾行。句末標點、空行、清單符號、標題才是真正的段落邊界 */
export function joinLines(lines) {
  const paras = [];
  let cur = '';
  const flush = () => { if (cur.trim()) paras.push(cur.trim()); cur = ''; };
  for (const raw of lines) {
    const l = raw.replace(/\s+$/, '').replace(/^\s+/, '');
    if (!l) { flush(); continue; }
    if (TOC_LEADER_RE.test(l)) { flush(); continue; } // 目錄點線
    const isHead = CHAPTER_RE.test(l) || SECTION_RE.test(l) || ANNEX_RE.test(l) || STANDALONE_HEAD_RE.test(l);
    if (isHead || LIST_START_RE.test(l)) flush();
    if (!cur) cur = l;
    else cur += (/[A-Za-z0-9]$/.test(cur) && /^[A-Za-z0-9]/.test(l) ? ' ' : '') + l;
    // 短的條列標籤（「一、臨床條件」）自成一段，不跟下一行的內文黏在一起
    if (isHead || SENT_END_RE.test(l) || (LIST_START_RE.test(l) && l.length <= 10)) flush();
  }
  flush();
  return paras;
}

const FORM_TITLE_RE = /(檢查表|統計表|紀錄表|記錄表|列管表|申請單|紀錄單|相關表單|計畫書（範例）|計畫（範例）|（範例）)/;
const FIGURE_TITLE_RE = /(地圖|流程圖|示意圖)$/;

/** 從封面目錄頁抓附件完整標題（內文的附件標題常被斷成兩三行，目錄裡的比較完整）：{ 1: '衛生福利部…作業', … } */
export function tocAnnexTitles(frontLines) {
  const out = {};
  const ls = frontLines.map((l) => l.trim()).filter(Boolean);
  const clean = (x) => x.replace(/[…‧.]{2,}.*$/, '').replace(/\s*\d+\s*$/, '').replace(/[.．]\s*$/, '').trim();
  for (let i = 0; i < ls.length; i++) {
    const m = ls[i].match(ANNEX_RE);
    if (!m) continue;
    let title = clean(m[2]);
    // 下一行是續行（不是另一個附件、也不是只有點線或頁碼）
    const nx = ls[i + 1] ?? '';
    if (!/[…]{3,}/.test(ls[i]) && nx && !ANNEX_RE.test(nx) && !/^\d+$/.test(nx)) title += clean(nx);
    out[cnToInt(m[1])] = title.replace(/\s+/g, ' ').replace(/附件單$/, '').trim();
  }
  return out;
}

/**
 * 主程式：文字 → { sections, report }。
 * sections: [{ key, heading, level, pages:[from,to], kind:'text'|'form'|'figure', index:boolean, markdown }]
 *   - key：preface、ch1、ch1-dengue-s2、ch2-s3、annex-6、references（同名自動加序號）
 *   - 附件若是表單、範例或地圖，kind=form/figure、index=false：本文只放標題與「請看 PDF 第 N 頁」，不進答案索引
 *   - 表格頁：該頁內容換成說明（請看 PDF 第 N 頁），列入 report.tablePages，等人工轉成 Markdown 表格
 */
export function pdfTextToSections(text, { subparts = ['登革熱', '屈公病'], subpartSlugs = { 登革熱: 'dengue', 屈公病: 'chik' } } = {}) {
  const pages = splitPages(text);
  const annexTitles = tocAnnexTitles(pages[0]?.lines ?? []);
  let annexNo = 0;
  const sections = [];
  const report = { pageCount: pages.filter((p) => !p.front).length, tablePages: [], inlineTablePages: [], formSections: [], figureSections: [], warnings: [], headings: 0, joinedAcrossPages: 0 };
  const keys = new Set();
  let chapter = null, subpart = null, cur = null;
  const uniq = (k) => { let key = k, n = 2; while (keys.has(key)) key = `${k}-${n++}`; keys.add(key); return key; };
  const open = (key, heading, level, page, kind = 'text') => {
    if (cur) sections.push(cur);
    cur = { key: uniq(key), heading, level, pages: [page, page], kind, index: kind === 'text', body: [], lastMark: null };
    report.headings++;
  };
  const openAnnex = (m, page) => {
    chapter = 'annex';
    annexNo = cnToInt(m[1]);
    const title = annexTitles[annexNo] || m[2].trim();
    const kind = FORM_TITLE_RE.test(title) ? 'form' : FIGURE_TITLE_RE.test(title) ? 'figure' : 'text';
    open(`annex-${annexNo}`, `附件${m[1]}${title ? `：${title}` : ''}`, 2, page, kind);
    cur.titleFromToc = !!annexTitles[annexNo];
    if (kind === 'form') report.formSections.push(cur.key);
    if (kind === 'figure') report.figureSections.push(cur.key);
    mark(page);
  };
  const mark = (page) => { if (cur && cur.lastMark !== page) { cur.body.push(pageMark(page)); cur.lastMark = page; } if (cur) cur.pages[1] = page; };

  for (const pg of pages) {
    if (pg.front) continue; // 封面與目錄：目錄由章節結構重建，不抽文字
    const table = isTableLike(pg.lines);
    if (table) {
      // 表格頁的第一個標題列（附件開頭常是表單）仍要開新段落
      const head = pg.lines.map((l) => l.trim()).find((l) => ANNEX_RE.test(l));
      if (head && (chapter === 'refs' || chapter === 'annex')) openAnnex(head.match(ANNEX_RE), pg.page);
      report.tablePages.push(pg.page);
      if (!cur) open('preface', '前言', 2, pg.page);
      mark(pg.page);
      cur.body.push(`> 本頁（PDF 第 ${pg.page} 頁）為表格。機器抽出的文字無法保留欄位，未納入智慧查詢；請看 PDF 原頁，或由權責單位轉成表格後再上架。`);
      continue;
    }
    for (const para of joinLines(pg.lines)) {
      const p = para.replace(/\s{2,}/g, ' ');
      let m;
      if (/^前\s*言$/.test(p)) { chapter = null; subpart = null; open('preface', '前言', 2, pg.page); mark(pg.page); continue; }
      if (/^參考文獻$/.test(p)) { chapter = 'refs'; open('references', '參考文獻', 2, pg.page, 'refs'); cur.index = false; mark(pg.page); continue; }
      if ((m = p.match(CHAPTER_RE))) { chapter = cnToInt(m[1]); subpart = null; open(`ch${chapter}`, `第${m[1]}章 ${m[2].trim()}`.trim(), 2, pg.page); mark(pg.page); continue; }
      if (chapter && subparts.includes(p)) { subpart = p; open(`ch${chapter}-${subpartSlugs[p] ?? 'part'}`, `${cur?.heading?.split(' · ')[0] ?? ''} · ${p}`.replace(/^ · /, ''), 2, pg.page); mark(pg.page); continue; }
      if ((m = p.match(SECTION_RE)) && typeof chapter === 'number') {
        const ch = sections.concat(cur ? [cur] : []).reverse().find((s) => s.key === `ch${chapter}`)?.heading ?? `第${chapter}章`;
        open(`ch${chapter}${subpart ? `-${subpartSlugs[subpart] ?? 'part'}` : ''}-s${cnToInt(m[1])}`, `${ch}${subpart ? ` · ${subpart}` : ''} · 第${m[1]}節 ${m[2].trim()}`, 3, pg.page); mark(pg.page); continue;
      }
      // 附件編號必須遞增：附件內文引用「附件一：…」不是新附件
      if ((m = p.match(ANNEX_RE)) && (chapter === 'refs' || chapter === 'annex') && cnToInt(m[1]) > annexNo) { openAnnex(m, pg.page); continue; }
      if (!cur) open('preface', '前言', 2, pg.page);
      mark(pg.page);
      if (cur.kind === 'form' || cur.kind === 'figure') { if (!cur.formNoted) { cur.body.push(`> 此附件為${cur.kind === 'form' ? '表單或範例' : '圖'}，請看 PDF 第 ${pg.page} 頁起。表單不納入智慧查詢（欄位名稱不是可引用的規定）。`); cur.formNoted = true; } continue; }
      if (isNumericFragment(p)) {
        if (cur.lastTableNote !== pg.page) { cur.body.push(`> PDF 第 ${pg.page} 頁有一張數字表格，機器抽出的數字無法對回欄位，未納入智慧查詢；請看 PDF 原頁。`); cur.lastTableNote = pg.page; }
        if (!report.inlineTablePages.includes(pg.page)) report.inlineTablePages.push(pg.page);
        continue;
      }
      // 跨頁的同一段：上一頁最後一段沒有句末標點、這一頁第一段不是清單開頭 → 接回上一段（引用時算在起始頁）
      const b = cur.body;
      if (b.length >= 2 && PAGE_MARK_RE.test(b[b.length - 1]) && !PAGE_MARK_RE.test(b[b.length - 2]) && !/^>/.test(b[b.length - 2])
        && !SENT_END_RE.test(b[b.length - 2]) && !LIST_START_RE.test(p) && b[b.length - 2].length > 10) {
        b[b.length - 2] += p;
        report.joinedAcrossPages++;
        continue;
      }
      cur.body.push(p);
    }
  }
  if (cur) sections.push(cur);
  // 附件標題可能只有「附件一」一行，標題在下一段：補上
  for (const s of sections) if (!s.titleFromToc && /^附件[一二三四五六七八九十]+$/.test(s.heading) && s.body.length) {
    const firstText = s.body.find((b) => !PAGE_MARK_RE.test(b));
    if (firstText && firstText.length <= 60) { s.heading = `${s.heading}：${firstText}`; s.body.splice(s.body.indexOf(firstText), 1); }
  }
  const out = sections.map((s) => ({ key: s.key, heading: s.heading, level: s.level, pages: s.pages, kind: s.kind === 'refs' ? 'text' : s.kind, index: s.index, markdown: s.body.join('\n\n') }))
    .filter((s) => s.markdown.replace(/〔p\.\d+〕/g, '').trim());
  for (const s of out) if (s.index && s.markdown.length > 12000) report.warnings.push(`${s.key} 超過 12000 字，建議再細分`);
  if (report.tablePages.length) report.warnings.push(`表格頁 ${report.tablePages.length} 頁未納入索引：${report.tablePages.join('、')}`);
  return { sections: out, report };
}

/** 頁中間夾的表格（例如表 1-1 的逐年病例數）：抽出來是一長串數字，沒有欄名可對，不能引用 */
export function isNumericFragment(p) {
  const tok = String(p).split(/\s+/).filter(Boolean);
  const num = tok.filter((x) => /^[\d.,%*\-–]+$/.test(x)).length;
  return num >= 20 && num / tok.length > 0.6;
}

/** 一段 Markdown 依頁碼標記切開：[{ page, text }]（索引用：每段落帶頁碼） */
export function splitByPage(markdown, firstPage = null) {
  const out = [];
  let page = firstPage, buf = [];
  const flush = () => { if (buf.length) out.push({ page, text: buf.join('\n\n') }); buf = []; };
  for (const block of String(markdown ?? '').split(/\n\s*\n/)) {
    const m = block.trim().match(PAGE_MARK_RE);
    if (m) { flush(); page = Number(m[1]); continue; }
    if (/^>\s*(本頁（PDF 第|此附件為|PDF 第 \d+ 頁有一張)/.test(block.trim())) continue; // 表格頁、表單說明不是內容
    buf.push(block);
  }
  flush();
  return out;
}

/** 整份機讀版（.md 下載與 machineReadableMarkdown 欄位） */
export function sectionsToMarkdown(title, sections) {
  return [`# ${title}`, '', ...sections.flatMap((s) => [`${'#'.repeat(s.level ?? 2)} ${s.heading}`, '', s.markdown, ''])].join('\n');
}
