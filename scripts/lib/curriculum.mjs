// 傳染病核心教材（第二十八輪；docs/pdf-ingest.md 第 9 節、ARCHITECTURE §33）：「重建版」來源檔 → 文件 JSON。
//
// 為什麼有這支：核心教材的 PDF 正本在開發環境拿不到（www.cdc.gov.tw 連不上）。我們不憑記憶寫教材內容，
// 而是把「找得到出處的句子」逐條寫進來源檔（data/curriculum/{slug}.source.json），每一句記它從哪裡來
// （站內已匯入的真指引第幾頁、站內內容 id、搜尋摘錄網址），找不到出處的地方一律寫「（待補：…）」。
// 這支純函式把來源檔排成與 PDF 轉檔（pdf-to-md.mjs）同一個形狀的文件 JSON：sections（章 ch{N}／節 ch{N}-s{M}）、
// machineReadableMarkdown、derivedFrom（sourceKind: reconstructed、reviewStatus: machine、sources[]）。
// 取得 PDF 正本後，改用 scripts/pdf-to-md.mjs 轉出同家族的正式版本，並「刪除」重建版（不要用 supersedes 串鏈：
// 重建版不是真的版次，留在版本鏈上會讓「前版／本版異動」誤導讀者；與第二十輪「示意內容不排版本鏈」同一個理由）。
//
// 沒有 import（瀏覽器、Node 共用；與 pdf-text.mjs 同一原則）。

/** 句末加出處：「…天。」→「…天（摘自 X 第 3 頁）。」；沒有句末標點就直接接在後面 */
export function withCite(text, cite) {
  const t = String(text ?? '').trim();
  if (!cite) return t;
  const m = /([。．.！？!?])$/.exec(t);
  return m ? `${t.slice(0, -1)}（${cite}）${m[1]}` : `${t}（${cite}）`;
}

/** 待補佔位：固定用全形括號「（待補：」開頭，index-builder 依此把它排除在答案單元之外 */
export const pendingLine = (text) => `（待補：${String(text).replace(/^（?待補[:：]?/, '').replace(/）$/, '')}）`;
export const PENDING_RE = /（待補[:：]/;

// 出處只寫代號（「出處 A，第 3 頁」），全名放文末的來源表。
// 為什麼不寫全名：句子會原樣進智慧查詢的答案單元，全名（例如「登革熱/屈公病防治工作指引 2026 年 2 月版」）
// 會讓「指引現行版是第幾版」這類問題誤撈到教材，把真正的指引擠掉（第二十八輪實測：版本題 V011 因此失敗）。
function citeOf(item, srcById) {
  const s = srcById.get(item.src);
  if (!s) throw new Error(`來源 ${item.src} 不在 sources`);
  return `出處 ${s.id}${item.at ? `，${item.at}` : ''}${s.kind === 'search-excerpt' ? '，搜尋摘錄未查證' : ''}`;
}

function bodyOf(part, srcById) {
  const lines = [];
  if (part.intro) lines.push(part.intro, '');
  for (const it of part.items ?? []) lines.push(`- ${withCite(it.text, citeOf(it, srcById))}`);
  if (part.items?.length) lines.push('');
  if (part.pending) lines.push(pendingLine(part.pending), '');
  if (part.see?.length) lines.push(`對照：${part.see.map((x) => `[${x.label}](${x.href})`).join('、')}`, '');
  return lines.join('\n').trim();
}

const indexable = (part) => (part.items?.length ?? 0) > 0 || !!part.intro;

/** 來源表（不入索引）：給權責單位查核每一條依據 */
export function sourcesMarkdown(sources) {
  const KIND = { 'official-page': '官網頁面', 'official-file': '官網檔案', 'search-excerpt': '搜尋摘錄', 'site-content': '本站內容', mirror: '轉載' };
  const STATUS = { unverified: '未查證', verified: '已查證', unreachable: '開發環境連不到，只看過搜尋摘錄' };
  const esc = (x) => String(x ?? '').replace(/\|/g, '｜');
  return [
    '| 代號 | 來源 | 類型 | 查證狀態 | 說明 |',
    '| --- | --- | --- | --- | --- |',
    ...sources.map((s) => `| ${esc(s.id)} | ${s.url ? `[${esc(s.label)}](${s.url})` : esc(s.label)}${s.ref ? `（${esc(s.ref)}）` : ''} | ${KIND[s.kind] ?? s.kind} | ${STATUS[s.status] ?? s.status}${s.accessedAt ? `（${s.accessedAt}）` : ''} | ${esc(s.note ?? '')} |`),
  ].join('\n');
}

/**
 * 來源檔 → 文件 JSON。
 * src = { meta: {…文件欄位}, derivedFrom?: { extractedAt, note }, sources: [{ id, label, short?, url?, ref?, kind, status, accessedAt?, note? }],
 *         chapters: [{ key: 'ch1', heading, intro?, items?, pending?, see?, sections?: [{ key, heading, intro?, items?, pending?, see? }] }] }
 * items = [{ text, src: 來源代號, at?: '第 3 頁' }]
 */
export function buildCurriculumDoc(src, { file, sha256, tool = 'scripts/curriculum-to-doc.mjs' }) {
  const srcById = new Map(src.sources.map((s) => [s.id, s]));
  const sections = [];
  for (const ch of src.chapters) {
    if (!/^ch\d+$/.test(ch.key)) throw new Error(`章 key 必須是 ch{N}：${ch.key}`);
    // 章本身沒有內文（只有節）就不出章段落；長文件版面會從節的標題取章名
    const chBody = bodyOf(ch, srcById);
    if (chBody || !ch.sections?.length) sections.push({ key: ch.key, heading: ch.heading, level: 2, markdown: chBody, index: indexable(ch) });
    for (const s of ch.sections ?? []) {
      if (!s.key.startsWith(`${ch.key}-`)) throw new Error(`節 key 必須以 ${ch.key}- 開頭：${s.key}`);
      sections.push({ key: s.key, heading: `${ch.heading} · ${s.heading}`, level: 3, markdown: bodyOf(s, srcById), index: indexable(s) });
    }
  }
  sections.push({ key: 'sources', heading: '資料來源與查證狀態', level: 2, markdown: sourcesMarkdown(src.sources), index: false });
  const meta = src.meta;
  const mrm = [
    `# ${meta.title}`, '',
    '## 學習目標', '', ...(meta.learningObjectives ?? []).map((o, i) => `${i + 1}. ${o}`), '',
    ...sections.flatMap((s) => [`${'#'.repeat(s.level)} ${s.heading}`, '', s.markdown, '']),
  ].join('\n');
  return {
    ...meta,
    sections,
    machineReadableMarkdown: mrm,
    derivedFrom: {
      file,
      sha256,
      sourceKind: 'reconstructed',
      tool,
      extractedAt: src.derivedFrom?.extractedAt,
      reviewStatus: 'machine',
      sources: src.sources.map(({ id, short, ...rest }) => ({ ...rest, label: `${id}｜${rest.label}` })),
      excludedSections: sections.filter((s) => s.index === false).map((s) => s.key),
      ...(src.derivedFrom?.note ? { note: src.derivedFrom.note } : {}),
    },
  };
}

/** 統計：給 CLI 與測試看「有出處的句子幾條、待補幾處」 */
export function curriculumStats(doc) {
  const secs = doc.sections ?? [];
  const items = secs.reduce((n, s) => n + (String(s.markdown).match(/^- /gm)?.length ?? 0), 0);
  const pending = secs.reduce((n, s) => n + (String(s.markdown).match(/（待補[:：]/g)?.length ?? 0), 0);
  return { chapters: new Set(secs.map((s) => /^ch\d+/.exec(s.key)?.[0]).filter(Boolean)).size, sections: secs.length, indexed: secs.filter((s) => s.index !== false).length, sourcedItems: items, pending };
}
