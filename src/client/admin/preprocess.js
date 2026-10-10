// 上架預處理（6.5）：純函式、不碰 DOM，瀏覽器與 Node 測試共用。
// 流程：實體抽取（比對主檔）→ 未對應詞 → 摘要 → 結構化欄位 → 一致性檢查 → 多語術語鎖定 → 匯出 content JSON。
// 全部是規則式（regex／字串比對），不呼叫模型；輸出一律「建議」，要人工確認。

export const TYPES = [
  { value: 'faq', label: 'Q&A' },
  { value: 'disease', label: '疾病頁' },
  { value: 'news', label: '新聞稿' },
  { value: 'letter', label: '致醫界通函' },
  { value: 'document', label: '文件新版' },
  { value: 'clarification', label: '澄清' },
  { value: 'vaccine', label: '疫苗頁' },
  // 第二輪新增（ARCHITECTURE §11）
  { value: 'media', label: '影音' },
  { value: 'topic', label: '專區' },
  { value: 'service', label: '申請服務' },
  { value: 'publication', label: '出版品' },
  { value: 'labtest', label: '檢驗項目' },
  { value: 'research', label: '研究計畫' },
];
/** 第七輪起人才招募／採購公告為獨立型別 job／tender（content/jobs、content/tenders；見 docs/guide-staff.md 16、17），示範表單不提供。舊的 recruit／procurement 分支保留以相容既有草稿。 */
export const schemaType = (t) => (t === 'recruit' || t === 'procurement' ? 'news' : t);
/** 建議放進 content/ 的哪個子目錄。 */
export const DIRS = {
  faq: 'faq', disease: 'diseases', news: 'news', letter: 'news', document: 'documents', clarification: 'clarifications', vaccine: 'vaccines',
  media: 'media', topic: 'topics', service: 'services', publication: 'publications', labtest: 'labtests', research: 'research', recruit: 'news', procurement: 'news',
};
/** 內文欄位在各型別的意義（標籤、placeholder、對應 schema 欄位）。 */
export const BODY_ROLE = {
  media: { label: '影片簡介（選填，供摘要與關鍵字抽取；逐字稿請貼在下方專屬欄位）', field: null },
  topic: { label: '專區簡介（introMarkdown）', field: 'introMarkdown' },
  service: { label: '服務簡介（introMarkdown）', field: 'introMarkdown' },
  publication: { label: '摘要（abstractMarkdown）', field: 'abstractMarkdown' },
  labtest: { label: '備註（notesMarkdown，選填）', field: 'notesMarkdown' },
  research: { label: '研究摘要（abstractMarkdown）', field: 'abstractMarkdown' },
  recruit: { label: '公告內文（bodyMarkdown）', field: 'bodyMarkdown' },
  procurement: { label: '公告內文（bodyMarkdown）', field: 'bodyMarkdown' },
};
export const BODY_OPTIONAL = new Set(['media', 'labtest']);
export const LANGS = [
  { code: 'zh-TW', label: '繁體中文' }, { code: 'en', label: 'English' }, { code: 'ja', label: '日本語' }, { code: 'tl', label: 'Tagalog' },
  { code: 'vi', label: 'Tiếng Việt' }, { code: 'id', label: 'Bahasa Indonesia' }, { code: 'th', label: 'ไทย' },
];
export const TASKS = [
  { key: 'symptoms', label: '有症狀怎麼辦' }, { key: 'vaccines', label: '疫苗與預防接種' }, { key: 'travel', label: '出國與入境' },
  { key: 'situation', label: '現在的疫情' }, { key: 'rumor', label: '謠言查證' }, { key: 'data', label: '開放資料與統計' },
];
export const REVIEW_PERIOD_DEFAULT = { disease: 12, vaccine: 6, faq: 6, news: 0, letter: 0, document: 12, clarification: 6, media: 12, topic: 6, service: 12, publication: 0, labtest: 12, research: 12, recruit: 0, procurement: 0 };
const SEVEN = ['zh-TW', 'en', 'ja', 'tl', 'vi', 'id', 'th'];
export const LANG_DEFAULT = {
  disease: SEVEN, vaccine: SEVEN, faq: SEVEN, clarification: SEVEN, letter: ['zh-TW', 'en'], news: ['zh-TW', 'en'], document: ['zh-TW', 'en'],
  media: ['zh-TW', 'en'], topic: ['zh-TW', 'en'], service: ['zh-TW', 'en'], publication: ['zh-TW'], labtest: ['zh-TW'], research: ['zh-TW'], recruit: ['zh-TW'], procurement: ['zh-TW'],
};
export const TIER1 = ['disease', 'vaccine', 'clarification', 'situation'];

export const defaultsFor = (type) => ({
  reviewPeriodMonths: REVIEW_PERIOD_DEFAULT[type] ?? 12,
  langs: [...(LANG_DEFAULT[type] ?? ['zh-TW', 'en'])],
});

// ---------- 文字正規化 ----------
const FW = '０１２３４５６７８９';
export function norm(s) {
  return String(s ?? '').replace(/[０-９]/g, (c) => String(FW.indexOf(c))).replace(/\r/g, '');
}
/** 數字區間寫法統一：「3 至 14」「3~14」「3－14」→「3–14」 */
export function normRange(s) {
  return String(s ?? '').replace(/\s+/g, '').replace(/(?:至|到|~|～|－|—|-)/g, '–');
}
const isHan = (ch) => /[一-鿿]/.test(ch);

// ---------- 詞庫 ----------
const termLang = (g, lang) => (lang === 'id' ? (g.id_ ?? g['id-ID'] ?? g.i18n?.id ?? '') : (g[lang] ?? ''));
export { termLang };

export function buildLexicon({ glossary = [], diseases = [], vaccines = [], countries = [] } = {}) {
  const entity = []; // disease / vaccine / country
  const terms = []; // glossary
  const add = (list, term, kind, id, label, alias) => { if (term && String(term).trim().length >= 2) list.push({ term: String(term).trim(), kind, id, label, alias }); };
  for (const d of diseases) { add(entity, d.name, 'disease', d.id, d.name, false); for (const a of d.aliases ?? []) add(entity, a, 'disease', d.id, d.name, true); add(entity, d.nameEn, 'disease', d.id, d.name, true); }
  for (const v of vaccines) { v.name ??= v.title; add(entity, v.name, 'vaccine', v.id, v.name, false); for (const a of v.aliases ?? []) add(entity, a, 'vaccine', v.id, v.name, true); add(entity, v.nameEn, 'vaccine', v.id, v.name, true); }
  for (const c of countries) { add(entity, c.name, 'country', c.iso2, c.name, false); add(entity, c.nameEn, 'country', c.iso2, c.name, true); }
  const deprecated = [];
  for (const g of glossary) {
    const label = g['zh-TW'];
    add(terms, label, 'term', g.id, label, false);
    for (const a of g.aliases ?? []) add(terms, a, 'term', g.id, label, true);
    add(terms, g.en, 'term', g.id, label, true);
    for (const dep of g.deprecated ?? []) deprecated.push({ term: dep, preferred: label, id: g.id });
  }
  const byLen = (a, b) => b.term.length - a.term.length;
  entity.sort(byLen); terms.sort(byLen);
  return { entity, terms, deprecated, glossary, known: [...entity, ...terms].map((e) => e.term.toLowerCase()) };
}

const isWordChar = (c) => /[a-z0-9]/i.test(c ?? '');
function scan(text, list) {
  const lower = text.toLowerCase();
  const covered = new Array(text.length).fill(false);
  const hits = [];
  for (const e of list) {
    const needle = e.term.toLowerCase();
    let from = 0, count = 0;
    for (;;) {
      const i = lower.indexOf(needle, from);
      if (i < 0) break;
      from = i + needle.length;
      const ascii = /^[\x00-\x7f]+$/.test(needle);
      if (ascii && (isWordChar(lower[i - 1]) || isWordChar(lower[i + needle.length]))) continue;
      if (covered.slice(i, i + needle.length).some(Boolean)) continue;
      for (let k = i; k < i + needle.length; k++) covered[k] = true;
      count++;
    }
    if (count) hits.push({ ...e, count });
  }
  return hits;
}

const TOPICS = [
  { label: '就醫時機', re: /就醫|回診|看診|儘速就診/ }, { label: '警示徵象', re: /警示徵象|危險徵兆/ }, { label: '潛伏期', re: /潛伏期/ },
  { label: '傳染途徑', re: /傳染途徑|傳播|叮咬|飛沫|接觸傳染/ }, { label: '預防', re: /預防|防蚊|清除積水|洗手|戴口罩/ }, { label: '通報', re: /通報/ },
  { label: '接種', re: /接種/ }, { label: '旅遊', re: /旅遊|出國|入境|流行地區/ }, { label: '治療', re: /治療|用藥|住院/ }, { label: '隔離', re: /隔離|居家休養/ },
];
const GENERIC = new Set(['重症', '輕症', '病症', '疾病', '傳染病', '病例', '病人', '病毒', '疫苗', '發熱', '高熱', '退熱', '發病', '生病', '患病', '染病', '致病', '疫病', '併發症', '後遺症', '症狀', '發炎', '炎症', '出現', '發燒', '醫師', '民眾', '患者', '感染', '建議', '應該', '可能', '通常', '如果', '包括', '提醒', '持續', '嚴重', '相關', '資訊', '使用', '地區', '流行', '時間', '情形', '情況', '以上', '以下', '之間', '醫院', '診所', '主動', '告知', '立即', '儘速', '期間', '風險', '高風險', '高風險期', '警示', '徵象']);
const LEAD_VERBS = ['感染', '罹患', '造成', '發生', '出現', '診斷', '治療', '預防', '傳播', '得到', '患有', '確診', '疑似', '爆發', '引起', '導致', '接種', '防治', '預防接種', '對於', '關於', '針對', '屬於', '稱為', '又稱', '俗稱', '例如', '包括'];
const STOP = new Set([...'的了是在有或及與和於應並之為以而者但時後前內至約等請可會將被把對由從就都也仍需要不無其該此這那我你他她它們已再更各每且因如若則即另'.split('')]);

function segments(text) {
  const segs = [];
  let cur = '';
  for (const ch of text) {
    if (isHan(ch) && !STOP.has(ch)) cur += ch; else { if (cur) segs.push(cur); cur = ''; }
  }
  if (cur) segs.push(cur);
  return segs;
}
const SUFFIX = /(病毒|疫苗|熱|病|症|炎)/g;

/** 抽取實體與未對應詞。回傳 {mapped, unmapped, deprecated, diseaseIds, vaccineIds, countryIds} */
export function extractEntities(textRaw, lex) {
  const text = norm(textRaw);
  const eHits = scan(text, lex.entity);
  const tHits = scan(text, lex.terms);
  const mapped = [];
  const seen = new Set();
  const push = (m) => { const k = `${m.kind}:${m.id ?? m.label}`; if (seen.has(k)) return; seen.add(k); mapped.push(m); };
  for (const h of eHits) {
    const m = mapped.find((x) => x.kind === h.kind && x.id === h.id);
    if (m) { m.count += h.count; if (h.alias && !m.via.includes(h.term)) m.via.push(h.term); continue; }
    push({ kind: h.kind, id: h.id, label: h.label, count: h.count, via: h.alias ? [h.term] : [] });
  }
  const entityIds = new Set(mapped.map((m) => m.id));
  const entityLabels = new Set(mapped.map((m) => m.label));
  for (const h of tHits) {
    const g = lex.glossary.find((x) => x.id === h.id);
    if ((g?.refs ?? []).some((r) => entityIds.has(r)) || entityLabels.has(h.label)) continue; // 已由疾病／疫苗 chip 涵蓋
    const m = mapped.find((x) => x.kind === 'term' && x.id === h.id);
    if (m) { m.count += h.count; if (h.alias && !m.via.includes(h.term)) m.via.push(h.term); continue; }
    push({ kind: 'term', id: h.id, label: h.label, count: h.count, via: h.alias ? [h.term] : [], locked: !!g?.locked });
  }
  for (const t of TOPICS) if (t.re.test(text) && !mapped.some((m) => m.label === t.label)) push({ kind: 'topic', id: null, label: t.label, count: 1, via: [] });

  // 未對應詞
  const known = lex.known;
  const knownIn = (w) => known.some((k) => k.length >= 2 && (w.toLowerCase().includes(k) || k.includes(w.toLowerCase())));
  const topicWords = new Set(TOPICS.map((t) => t.label));
  const cands = new Map();
  const addCand = (w, reason, count) => {
    if (w.length < 2 || w.length > 6 || GENERIC.has(w) || topicWords.has(w) || knownIn(w)) return;
    const cur = cands.get(w);
    if (cur) { cur.reason = cur.reason.includes(reason) ? cur.reason : [...cur.reason, reason]; cur.count = Math.max(cur.count, count); } else cands.set(w, { term: w, reason: [reason], count });
  };
  const segs = segments(text);
  const countOf = (w) => { let n = 0, i = 0; while ((i = text.indexOf(w, i)) >= 0) { n++; i += w.length; } return n; };
  // (1) 帶「熱／病／症／炎／病毒／疫苗」結尾
  for (const seg of segs) {
    SUFFIX.lastIndex = 0;
    let m, prevEnd = 0, lastEnd = -1;
    while ((m = SUFFIX.exec(seg))) {
      const end = m.index + m[1].length;
      if (m.index === lastEnd) continue; // 連續字尾（如「病症」）只取第一個
      lastEnd = end;
      let w = seg.slice(Math.max(prevEnd, m.index - 4, 0), end);
      prevEnd = end;
      for (let guard = 0; guard < 3; guard++) { const lv = LEAD_VERBS.find((v) => w.startsWith(v) && w.length > v.length); if (!lv) break; w = w.slice(lv.length); }
      if (w.length >= 2) addCand(w, '帶疾病／病原／疫苗字尾', countOf(w));
    }
  }
  // (2) 連續 2–6 個漢字且出現 ≥ 2 次（取最長者）
  const freq = new Map();
  for (const seg of segs) for (let n = 2; n <= 6; n++) for (let i = 0; i + n <= seg.length; i++) { const w = seg.slice(i, i + n); if (!freq.has(w)) freq.set(w, countOf(w)); }
  const rep = [...freq].filter(([w, c]) => c >= 2 && (w.length >= 3 || c >= 3));
  for (const [w, c] of rep) {
    if (rep.some(([w2, c2]) => w2 !== w && w2.length > w.length && w2.includes(w) && c2 === c)) continue; // 只留最長
    if (LEAD_VERBS.some((v) => w.startsWith(v)) || /^[一二三四五六七八九十百]+/.test(w)) continue;
    addCand(w, `出現 ${c} 次`, c);
  }
  const unmapped = [...cands.values()].sort((a, b) => (b.reason.length - a.reason.length) || (b.count - a.count) || (b.term.length - a.term.length)).slice(0, 8);

  // 停用詞
  const dep = [];
  for (const d of lex.deprecated) if (text.includes(d.term)) dep.push({ ...d, count: countOf(d.term) });

  const diseaseIds = mapped.filter((m) => m.kind === 'disease').map((m) => m.id);
  const vaccineIds = mapped.filter((m) => m.kind === 'vaccine').map((m) => m.id);
  const countryIds = mapped.filter((m) => m.kind === 'country').map((m) => m.id);
  // 詞彙主檔 refs 也算關聯（例如文中只出現「MMR」→ vaccine.mmr）；供一致性檢查與匯出建議使用
  const refs = mapped.filter((m) => m.kind === 'term').flatMap((m) => lex.glossary.find((g) => g.id === m.id)?.refs ?? []);
  const relatedDiseaseIds = [...new Set([...diseaseIds, ...refs.filter((r) => r.startsWith('disease.'))])];
  const relatedVaccineIds = [...new Set([...vaccineIds, ...refs.filter((r) => r.startsWith('vaccine.'))])];
  return { mapped, unmapped, deprecated: dep, diseaseIds, vaccineIds, countryIds, relatedDiseaseIds, relatedVaccineIds };
}

// ---------- 摘要 ----------
export function splitSentences(text) {
  return norm(text).replace(/\n+/g, '。').split(/(?<=[。！？!?；;])/).map((s) => s.trim()).filter((s) => s.length >= 4);
}
export function suggestSummary(text, entities, max = 120) {
  const sents = splitSentences(text.replace(/^#+\s*.*$/gm, ''));
  if (!sents.length) return '';
  const score = (s, i) => {
    const hits = entities?.mapped?.filter((m) => m.kind !== 'topic' && s.includes(m.label)).length ?? 0;
    const topics = TOPICS.filter((t) => t.re.test(s)).length;
    const digits = (s.match(/\d+/g) ?? []).length;
    const lenPenalty = s.length > max ? 2 : s.length < 15 ? 1.5 : 0;
    return hits * 1.5 + topics + Math.min(digits, 3) * 0.5 + (i === 0 ? 1 : 0) - lenPenalty;
  };
  let best = 0, bs = -Infinity;
  sents.forEach((s, i) => { const sc = score(s, i); if (sc > bs) { bs = sc; best = i; } });
  let out = sents[best];
  if (out.length < 50 && sents[best + 1] && (out + sents[best + 1]).length <= max) out += sents[best + 1];
  if (out.length > max) {
    const cut = out.slice(0, max - 1);
    const p = Math.max(cut.lastIndexOf('，'), cut.lastIndexOf('、'), cut.lastIndexOf('；'));
    out = `${p > 30 ? cut.slice(0, p) : cut}…`;
  }
  return out;
}

// ---------- 結構化欄位 ----------
const RANGE = '(\\d+(?:\\.\\d+)?)\\s*(?:至|到|~|～|－|—|–|-)\\s*(\\d+(?:\\.\\d+)?)';
export function extractStructured(textRaw) {
  const text = norm(textRaw);
  const out = [];
  const add = (key, label, value, evidence) => { if (!out.some((o) => o.key === key)) out.push({ key, label, value, evidence: evidence.trim().replace(/\s+/g, ' ') }); };
  let m;
  if ((m = new RegExp(`潛伏期[^。\\d]{0,8}${RANGE}\\s*(天|日)`).exec(text))) add('incubationDays', '潛伏期（天）', `${m[1]}–${m[2]}`, m[0]);
  else if ((m = new RegExp(`潛伏期[^。\\d]{0,8}${RANGE}\\s*(週|周)`).exec(text))) add('incubationWeeks', '潛伏期（週）', `${m[1]}–${m[2]}`, m[0]);
  else if ((m = /潛伏期[^。\d]{0,8}(\d+(?:\.\d+)?)\s*(天|日)/.exec(text))) add('incubationDays', '潛伏期（天）', m[1], m[0]);
  if ((m = /(\d+)\s*小時內\s*(?:就醫|回診|看診|就診|至醫院)/.exec(text))) add('seekCareWithinHours', '建議就醫時限（小時）', Number(m[1]), m[0]);
  if ((m = /(\d+)\s*(小時|日|天)內\s*(?:完成)?通報/.exec(text)) || (m = /通報時限[^\d。]{0,6}(\d+)\s*(小時|日|天)/.exec(text))) add('notifyWithinHours', '通報時限（小時）', m[2] === '小時' ? Number(m[1]) : Number(m[1]) * 24, m[0]);
  const births = [...text.matchAll(/(\d{4})\s*年(?:（含）|\(含\))?\s*(以後|之後|以前|之前)?\s*出生/g)];
  births.slice(0, 2).forEach((b, i) => add(i ? `birthYear${i + 1}` : 'birthYearFrom', '出生年份條件', Number(b[1]), b[0]));
  const years = [...new Set([...text.matchAll(/(?<![\d/-])(19[4-9]\d|20[0-4]\d)\s*年(?!\s*\d{1,2}\s*月)/g)].map((x) => x[1]))].filter((y) => !births.some((b) => b[1] === y));
  years.slice(0, 3).forEach((y, i) => add(i ? `year${i + 1}` : 'year', '年份', Number(y), `${y} 年`));
  const doses = [...new Set([...text.matchAll(/(?:第\s*)?(\d+)\s*劑/g)].map((x) => Number(x[1])).filter((n) => n > 0 && n < 10))];
  if (doses.length) add('doses', '劑數', doses.length === 1 ? doses[0] : doses.join('/'), `${doses.join('、')} 劑`);
  if ((m = /(\d{1,3})\s*歲\s*(以上|以下|以前|以後)?/.exec(text))) add('ageYears', '年齡', `${m[1]} 歲${m[2] ?? ''}`, m[0]);
  if ((m = /(\d{1,3})\s*個月/.exec(text))) add('ageMonths', '月齡', `${m[1]} 個月`, m[0]);
  if ((m = new RegExp(`${RANGE}\\s*週前`).exec(text))) add('leadTimeWeeks', '行前時間（週）', `${m[1]}–${m[2]}`, m[0]);
  return out;
}

// ---------- 一致性檢查 ----------
/**
 * ctx = { text, entities, structured:[{key,value}], diseaseMaster[], diseasePages:{id:page}, documents[], basedOn[], vaccinesMaster[], type }
 * 回傳 [{ level:'error'|'warn'|'ok'|'info', title, message }]
 */
export function consistencyChecks(ctx) {
  const out = [];
  const text = norm(ctx.text);
  const sv = Object.fromEntries((ctx.structured ?? []).map((s) => [s.key, s.value]));
  const vaccineIds = ctx.entities?.relatedVaccineIds ?? ctx.entities?.vaccineIds ?? [];
  // 依據正本（文件 id 或 family）所屬疾病也算關聯：影片逐字稿沒講「麻疹」二字，只要依據 MMR 建議，反向稽核規則照樣適用
  const basisDiseaseIds = (ctx.basedOn ?? []).flatMap((ref) => (ctx.documents ?? []).filter((d) => d.id === ref || d.family === ref).flatMap((d) => d.diseases ?? []));
  const diseaseIds = [...new Set([...(ctx.entities?.relatedDiseaseIds ?? ctx.entities?.diseaseIds ?? []), ...vaccineIds.flatMap((vid) => ctx.vaccinesMaster?.find((v) => v.id === vid)?.diseases ?? []), ...basisDiseaseIds])];
  // 影音：反向稽核與出生年份比對只掃逐字稿，並回報行號
  // 稽核前先去掉「（含）」：「1981 年（含）以後出生」與規則的「1981 年以後出生」是同一句話
  const scanText = (ctx.auditText != null ? norm(ctx.auditText) : text).replace(/[（(]含[）)]/g, '');
  const where = (idx) => (ctx.auditLabel ? `（${ctx.auditLabel}第 ${scanText.slice(0, idx).split('\n').length} 行）` : '');
  const primary = ctx.entities?.diseaseIds?.[0] ?? diseaseIds[0];
  const master = ctx.diseaseMaster?.find((d) => d.id === primary);
  const page = ctx.diseasePages?.[primary];
  const dname = master?.name ?? '';

  // 1. 依據正本已失效
  for (const ref of ctx.basedOn ?? []) {
    const docs = ctx.documents ?? [];
    const byId = docs.find((d) => d.id === ref);
    const family = byId?.family ?? (docs.some((d) => d.family === ref) ? ref : null);
    if (!family) continue;
    const versions = docs.filter((d) => d.family === family);
    const cur = versions.find((d) => d.governance?.isCurrent !== false && !d.governance?.supersededBy) ?? versions.sort((a, b) => b.effectiveAt.localeCompare(a.effectiveAt))[0];
    if (byId && byId.governance?.isCurrent === false && cur && cur.id !== byId.id) {
      out.push({ level: 'error', title: '依據的正本已失效', message: `依據的正本已失效：「${byId.title}」已由「${cur.title}」（${cur.version}，${cur.effectiveAt} 生效）取代，請改依 ${cur.version} 版（${cur.id}）。` });
    } else if (!byId && cur) {
      out.push({ level: 'ok', title: '依據正本', message: `依據文件 family「${family}」，系統自動指向現行版 ${cur.version}（${cur.effectiveAt} 生效）；正本修訂時會自動產生待辦。` });
    } else if (byId) out.push({ level: 'ok', title: '依據正本', message: `「${byId.title}」目前仍是現行版（${byId.version}）。` });
  }
  if (['faq', 'news', 'letter', 'clarification'].includes(ctx.type) && !(ctx.basedOn ?? []).length) {
    out.push({ level: 'warn', title: '未填依據正本', message: '此型別建議填「依據正本」：正本修訂時系統才能自動加註並產生待辦；若確實無正本請在送審時說明。' });
  }

  // 2. 潛伏期
  if (sv.incubationDays != null && (page?.incubation || page?.keyFacts?.incubation)) {
    const inc = page.incubation ?? {};
    const mine = normRange(String(sv.incubationDays));
    const [a, b] = mine.split('–').map(Number);
    const kf = page.keyFacts?.incubation ?? inc.text ?? '';
    const masterTxt = normRange(kf).replace(/天|日/g, '');
    const same = inc.min != null ? (a === inc.min && (b ?? a) === inc.max) : masterTxt.startsWith(mine);
    const phrase = `潛伏期 ${String(sv.incubationDays).replace('–', ' 至 ')} 天`;
    if (!same) out.push({ level: 'warn', title: '數字與主檔不同', message: `『${phrase}』與${dname}疾病介紹頁『${kf}』數字不同（主檔 ${inc.min ?? '?'}–${inc.max ?? '?'} 天）→ 請確認採用主檔用語。` });
    else if (kf && normRange(kf).replace(/天|日/g, '') !== mine) out.push({ level: 'warn', title: '寫法不同', message: `『${phrase}』與${dname}疾病介紹頁『${kf}』寫法不同 → 請確認採用主檔用語（疾病頁另有「通常」範圍）。` });
    else out.push({ level: 'ok', title: '潛伏期一致', message: `『${phrase}』與${dname}疾病介紹頁一致。` });
  }
  // 3. 通報時限
  if (sv.notifyWithinHours != null && master?.notifyWithinHours != null) {
    if (Number(sv.notifyWithinHours) !== Number(master.notifyWithinHours)) out.push({ level: 'warn', title: '通報時限與主檔不同', message: `內文通報時限 ${sv.notifyWithinHours} 小時，${dname}主檔為 ${master.notifyWithinHours} 小時 → 請確認。` });
    else out.push({ level: 'ok', title: '通報時限一致', message: `${sv.notifyWithinHours} 小時內通報，與${dname}主檔一致。` });
  }
  // 4. 就醫時限 vs 疾病頁「我該怎麼辦」
  if (sv.seekCareWithinHours != null && page?.blocks) {
    const pageText = page.blocks.map((b) => `${b.markdown ?? ''} ${(b.cards ?? []).map((c) => `${c.title} ${c.text}`).join(' ')}`).join(' ');
    const mm = [...norm(pageText).matchAll(/(\d+)\s*小時內\s*(?:就醫|回診|就診)/g)].map((x) => Number(x[1]));
    if (mm.length && !mm.includes(Number(sv.seekCareWithinHours))) out.push({ level: 'warn', title: '就醫時限與疾病頁不同', message: `內文「${sv.seekCareWithinHours} 小時內就醫」，${dname}疾病頁為「${[...new Set(mm)].join('／')} 小時內就醫」→ 請確認。` });
    else if (mm.length) out.push({ level: 'ok', title: '就醫時限一致', message: `${sv.seekCareWithinHours} 小時內就醫，與${dname}疾病頁一致。` });
  }
  // 5. 出生年份條件 vs 現行版文件
  const myYears = [...scanText.matchAll(/(\d{4})\s*年(?:（含）|\(含\))?\s*(?:以後|之後|以前|之前)?\s*出生/g)].map((x) => x[1]);
  if (myYears.length) {
    const related = (ctx.documents ?? []).filter((d) => d.governance?.isCurrent !== false && ((d.diseases ?? []).some((x) => diseaseIds.includes(x)) || (d.vaccines ?? []).some((x) => vaccineIds.includes(x))));
    for (const d of related) {
      const docYears = new Set([...norm(`${d.machineReadableMarkdown ?? ''} ${d.summary ?? ''}`).matchAll(/(\d{4})\s*年(?:（含）|\(含\))?\s*(?:以後|之後|以前|之前)?\s*出生/g)].map((x) => x[1]));
      if (!docYears.size) continue;
      const bad = myYears.filter((y) => !docYears.has(y));
      if (bad.length) out.push({ level: 'error', title: '與現行版文件矛盾', message: `${ctx.auditLabel ?? '內文'}「${[...new Set(bad)].join('、')} 年（含）以後出生」與現行版《${d.title}》的「${[...docYears].join('、')} 年」不同 → 請改依現行版。` });
      else out.push({ level: 'ok', title: '出生年份一致', message: `「${[...new Set(myYears)].join('、')} 年」與現行版《${d.title}》一致。` });
    }
  }
  // 6. 停用詞
  for (const d of ctx.entities?.deprecated ?? []) out.push({ level: 'warn', title: '使用已停用的舊名', message: `內文含「${d.term}」（${d.count} 次）→ 請改用『${d.preferred}』。` });
  // 7. 反向稽核規則
  const scopeIds = new Set([...diseaseIds, ...(ctx.basedOn ?? []), ...vaccineIds]);
  for (const d of ctx.diseaseMaster ?? []) for (const rule of d.auditRules ?? []) {
    if (rule.scope?.length && !rule.scope.some((s) => scopeIds.has(s)) && !scanText.includes(d.name)) continue;
    try {
      const m = new RegExp(rule.pattern).exec(scanText);
      if (m) out.push({ level: 'error', title: ctx.auditLabel ? '命中反向稽核規則（逐字稿）' : '命中反向稽核規則', message: `${ctx.auditLabel ?? '內文'}出現「${m[0]}」${where(m.index)}：${rule.message}` });
    } catch { /* 無效 regex 略過 */ }
  }
  return out;
}

// ---------- 多語：術語鎖定 ----------
export function lockedTerms(textRaw, glossary = []) {
  const text = norm(textRaw);
  const out = [];
  for (const g of glossary) {
    if (!g.locked) continue;
    const forms = [g['zh-TW'], ...(g.aliases ?? [])].filter(Boolean);
    const hit = forms.find((f) => text.includes(f));
    if (!hit) continue;
    out.push({ id: g.id, zh: g['zh-TW'], hit, tr: Object.fromEntries(SEVEN.filter((l) => l !== 'zh-TW').map((l) => [l, termLang(g, l)])) });
  }
  return out;
}
export const reviewRule = (type) => (TIER1.includes(type) ? '一級內容 · 簽約審核 · 必審' : '二級內容 · 先發布標示機器翻譯 · 每月抽審 10%');

// ---------- 第二輪：六種新型別的欄位解析與檢查 ----------
export const lines = (text) => String(text ?? '').replace(/\r/g, '').split('\n').map((l) => l.trim()).filter(Boolean);
const pipe = (line) => String(line).split(/[|｜]/).map((x) => x.trim());
const isExternal = (href) => /^https?:\/\//i.test(href);
const isHref = (href) => /^(https?:\/\/|\/|mailto:|tel:)/i.test(href);

/** 口語中文數字轉阿拉伯數字（逐字稿常寫「二十四小時」「十到十四天」），只轉後面緊接單位的數字，避免誤傷一般文字。 */
const CN = { 零: 0, 〇: 0, 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
function cnToInt(s) {
  if (!s) return null;
  if (!s.includes('十') && !s.includes('百')) { let n = 0; for (const ch of s) { if (!(ch in CN)) return null; n = n * 10 + CN[ch]; } return n; }
  let total = 0, rest = s;
  const h = rest.indexOf('百');
  if (h >= 0) { total += (h === 0 ? 1 : CN[rest[0]] ?? 0) * 100; rest = rest.slice(h + 1); }
  const t = rest.indexOf('十');
  if (t >= 0) { total += (t === 0 ? 1 : CN[rest[0]] ?? 0) * 10; rest = rest.slice(t + 1); }
  if (rest) total += CN[rest] ?? 0;
  return total;
}
export function spokenToDigits(text) {
  const UNIT = '(?:天|日|小時|週|周|年|歲|個月|劑)';
  const re = new RegExp(`([零〇一二兩三四五六七八九十百]+)(?=(?:至|到|~)?[零〇一二兩三四五六七八九十百]*\\s*${UNIT})`, 'g');
  return String(text ?? '').replace(re, (m) => { const n = cnToInt(m); return n == null ? m : String(n); });
}

/** YouTube 網址或 id → 11 碼 id；空字串回傳 ''；格式不符回傳 null。 */
export function youtubeIdFrom(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  const m = /(?:youtu\.be\/|[?&]v=|\/embed\/|\/shorts\/)([A-Za-z0-9_-]{11})/.exec(s);
  if (m) return m[1];
  return /^[A-Za-z0-9_-]{11}$/.test(s) ? s : null;
}

/** 章節：每行「秒數 標題」，秒數也接受 m:ss／h:mm:ss。 */
export function parseChapters(text) {
  const items = [], errors = [];
  lines(text).forEach((l, i) => {
    const m = /^(\d+(?::\d{1,2}){0,2})\s+(.+)$/.exec(norm(l));
    if (!m) { errors.push(`章節第 ${i + 1} 行格式應為「秒數 標題」：${l.slice(0, 30)}`); return; }
    const parts = m[1].split(':').map(Number);
    const t = parts.reduce((a, b) => a * 60 + b, 0);
    items.push({ t, label: m[2].trim() });
  });
  const sorted = items.every((c, i) => i === 0 || c.t > items[i - 1].t);
  if (items.length && !sorted) errors.push('章節秒數需由小到大排列、不可重複');
  return { items, errors };
}

/** 專區連結列：每行「標題 | 網址 | 備註(選填)」，網址 http(s) 自動判 external。 */
export function parseLinks(text) {
  const items = [], errors = [];
  lines(text).forEach((l, i) => {
    const [label, href, note] = pipe(l);
    if (!label || !href) { errors.push(`連結第 ${i + 1} 行需有「標題 | 網址」`); return; }
    if (!isHref(href)) { errors.push(`連結第 ${i + 1} 行網址需以 https:// 或 / 開頭：${href.slice(0, 30)}`); return; }
    const ext = isExternal(href);
    items.push({ label, href, external: ext, ...(note ? { note } : {}), ...(ext ? { status: 'unchecked' } : {}) });
  });
  return { items, errors };
}

/** 申請步驟：每行「標題 | 說明 | 誰 | 天」。 */
export function parseSteps(text) {
  const items = [], errors = [];
  lines(text).forEach((l, i) => {
    const [title, desc, who, days] = pipe(l);
    if (!title) { errors.push(`步驟第 ${i + 1} 行缺標題`); return; }
    const d = days != null && days !== '' ? Number(norm(days)) : null;
    if (days && !Number.isInteger(d)) { errors.push(`步驟第 ${i + 1} 行「天」需為整數：${days}`); return; }
    items.push({ title, ...(desc ? { text: desc } : {}), ...(who ? { who } : {}), ...(d != null ? { days: d } : {}) });
  });
  return { items, errors };
}

/** 檢體：每行「名稱 | 容器 | 量 | 保存 | 運送 | 時機 | 檢驗(以、分隔)」前五欄必填。 */
export function parseSpecimens(text) {
  const items = [], errors = [];
  lines(text).forEach((l, i) => {
    const [name, container, volume, storage, transport, timing, tests] = pipe(l);
    const miss = [['名稱', name], ['容器', container], ['量', volume], ['保存', storage], ['運送', transport]].filter(([, v]) => !v).map(([k]) => k);
    if (miss.length) { errors.push(`檢體第 ${i + 1} 行缺「${miss.join('、')}」（格式：名稱 | 容器 | 量 | 保存 | 運送 | 時機 | 檢驗）`); return; }
    const t = (tests ?? '').split(/[、,，/]/).map((x) => x.trim()).filter(Boolean);
    items.push({ name, ...(timing ? { timing } : {}), container, volume, storage, transport, ...(t.length ? { tests: t } : {}) });
  });
  return { items, errors };
}

/** 表單：每行「標題 | 網址 | 格式(選填)」。 */
export function parseForms(text) {
  const items = [], errors = [];
  lines(text).forEach((l, i) => {
    const [label, href, format] = pipe(l);
    if (!label || !href) { errors.push(`表單第 ${i + 1} 行需有「標題 | 網址」`); return; }
    items.push({ label, href, ...(format ? { format, machineReadable: /^(csv|json|xml|ods|odt|txt)$/i.test(format) } : {}) });
  });
  return { items, errors };
}

/** 篇目：每行「篇名 | 作者(以、分隔) | 頁碼」。 */
export function parseArticles(text) {
  const items = [], errors = [];
  lines(text).forEach((l, i) => {
    const [title, authors, pages] = pipe(l);
    if (!title) { errors.push(`篇目第 ${i + 1} 行缺篇名`); return; }
    const a = (authors ?? '').split(/[、,，]/).map((x) => x.trim()).filter(Boolean);
    items.push({ title, ...(a.length ? { authors: a } : {}), ...(pages ? { pages } : {}) });
  });
  return { items, errors };
}

/** 依據正本：回傳 { family, versions[], current }（refs 可為文件 id 或 family）。families 取自 publish.mjs 內嵌資料。 */
export function resolveBasis(refs = [], families = []) {
  const out = [];
  for (const ref of refs) {
    const fam = families.find((f) => f.family === ref || f.versions.some((v) => v.id === ref));
    if (!fam) continue;
    const used = fam.versions.find((v) => v.id === ref) ?? null;
    const current = fam.versions.find((v) => v.isCurrent) ?? fam.versions[0];
    out.push({ ref, family: fam.family, title: fam.title, used, current, url: current?.url ?? null });
  }
  return out;
}

/**
 * 影音專屬檢查（7.7）：依據正本必填、製作日 vs 現行版生效日（紅框）、版本標示、YouTube id、章節、逐字稿、字幕。
 * st = { transcript, producedAt, basedOn[], label, youtube(raw), chapters(text), captions[] }
 */
export function mediaChecks(st, families = []) {
  const out = [];
  const tr = String(st.transcript ?? '').trim();
  if (!tr) out.push({ level: 'error', title: '缺逐字稿', message: '影音一律須有逐字稿：它是 AI 唯一能引用的影片內容，也是反向稽核與無障礙的基礎。沒有逐字稿不得上架。' });
  else if (tr.length < 60) out.push({ level: 'warn', title: '逐字稿過短', message: `目前只有 ${tr.length} 字，請確認是完整逐字稿而非摘要。` });
  if (!(st.basedOn ?? []).length) out.push({ level: 'error', title: '缺依據正本', message: '影音必填「依據正本」：正本修訂時，系統才能自動把影片標為過時並產生待辦（7.7 第 4 點）。' });
  if (!st.producedAt) out.push({ level: 'error', title: '缺製作日期', message: '製作日期用來與依據正本現行版的生效日比對。' });
  for (const b of resolveBasis(st.basedOn, families)) {
    const cur = b.current;
    if (st.producedAt && cur?.effectiveAt && st.producedAt < cur.effectiveAt) {
      out.push({ level: 'error', title: '製作日早於依據正本現行版生效日', message: `製作日 ${st.producedAt} 早於《${b.title}》現行版 ${cur.version}（${cur.effectiveAt} 生效）。上架後系統會自動標「本影片依舊版製作」、退出 AI 白名單並產生待辦；建議先依現行版重製或改依現行版。` });
    } else if (st.producedAt && cur?.effectiveAt) {
      out.push({ level: 'ok', title: '製作日不早於現行版', message: `製作日 ${st.producedAt} ≥《${b.title}》現行版 ${cur.version} 生效日 ${cur.effectiveAt}。` });
    }
    if (b.used && cur && b.used.id !== cur.id) out.push({ level: 'warn', title: '依據的是舊版', message: `選到的 ${b.used.id}（${b.used.version}）已不是現行版；現行版為 ${cur.version}。建議改選 family「${b.family}」，系統會自動指向現行版。` });
    if (cur?.version && st.label && !st.label.includes(cur.version) && !String(st.label).includes(String(cur.version).replace(/\./g, ''))) {
      out.push({ level: 'warn', title: '版本標示與現行版不同', message: `畫面／說明欄標示「${st.label}」，依據正本現行版為 ${cur.version}；若影片確實依舊版製作，系統日後會加註「建議已修訂」。` });
    }
  }
  if (!String(st.label ?? '').trim()) out.push({ level: 'warn', title: '未填依據版本標示', message: '請填畫面與說明欄印出的版本，例如「114.04.16 建議」，之後才能產生說明欄第一行。' });
  const yt = youtubeIdFrom(st.youtube);
  if (yt === null) out.push({ level: 'warn', title: 'YouTube id 格式不符', message: '應為 11 碼英數、底線或連字號，或直接貼影片網址。' });
  else if (yt === '') out.push({ level: 'info', title: '未填 YouTube id', message: '前台將顯示示意海報與頻道連結（原型無法驗證影片存在）。' });
  const ch = parseChapters(st.chapters);
  for (const e of ch.errors) out.push({ level: 'warn', title: '章節格式', message: e });
  if (!(st.captions ?? []).length) out.push({ level: 'warn', title: '尚無字幕', message: '未勾選任何字幕語言：聽障與外語民眾無法使用；逐字稿可作為字幕檔來源。' });
  return out;
}

/** 影片說明欄第一行範本（7.7 第 4 點）：製作日期 · 依據版本 · 正本網址。 */
export const mediaDescriptionLine = ({ producedAt, label, url }) => {
  const l = String(label ?? '').trim().replace(/^依據?\s*/, '').replace(/\s*製作$/, '');
  return `製作日期 ${producedAt || '（未填）'} · 依據 ${l || '（未填版本）'} · 正本 ${url || '（未選正本）'}`;
};

/** 檢驗項目專屬檢查：送驗時限 vs 主檔通報時限；檢體列格式。 */
export function labtestChecks(st, diseaseMaster = []) {
  const out = [];
  const d = diseaseMaster.find((x) => x.id === st.disease);
  const sp = parseSpecimens(st.specimens);
  for (const e of sp.errors) out.push({ level: 'error', title: '檢體格式', message: e });
  if (!st.disease) out.push({ level: 'error', title: '未選疾病', message: '檢驗項目須對應傳染病主檔。' });
  const h = st.sendWithinHours === '' || st.sendWithinHours == null ? null : Number(st.sendWithinHours);
  if (h != null && d?.notifyWithinHours != null) {
    if (h > d.notifyWithinHours) out.push({ level: 'warn', title: '送驗時限超過通報時限', message: `送驗時限 ${h} 小時 > ${d.name}主檔通報時限 ${d.notifyWithinHours} 小時。若兩者本來就不同（例如通報 24 小時、檢體 48 小時內送達）請在備註說明；否則請修正。上架後引擎會做同樣的 labtest-inconsistent 檢查。` });
    else out.push({ level: 'ok', title: '送驗時限未超過通報時限', message: `送驗 ${h} 小時 ≤ ${d.name}通報 ${d.notifyWithinHours} 小時。` });
  }
  return out;
}

/** 其他新型別的格式提醒（非阻擋）。 */
export function miscChecks(type, st, today = '') {
  const out = [];
  if (type === 'topic') {
    const l = parseLinks(st.links);
    for (const e of l.errors) out.push({ level: 'error', title: '連結列格式', message: e });
    const ext = l.items.filter((x) => x.external).length;
    if (l.items.length) out.push({ level: 'info', title: '外部連結', message: `共 ${l.items.length} 條連結，其中 ${ext} 條判定為外部（https:// 開頭）。外部連結上架後由 CI 每日 HEAD 檢查，失效自動變待辦。` });
    if (st.startAt && st.endAt && st.endAt < st.startAt) out.push({ level: 'error', title: '起迄日顛倒', message: '結束日早於開始日。' });
    if (st.endAt && today && st.endAt < today) out.push({ level: 'warn', title: '結束日已過', message: '上架後會直接顯示「已結束」並退出首頁專區列。' });
  } else if (type === 'service') {
    const s = parseSteps(st.steps);
    for (const e of s.errors) out.push({ level: 'error', title: '步驟格式', message: e });
    for (const e of parseForms(st.forms).errors) out.push({ level: 'error', title: '表單格式', message: e });
    const sum = s.items.reduce((a, b) => a + (b.days ?? 0), 0);
    if (st.slaDays !== '' && st.slaDays != null && sum && sum > Number(st.slaDays)) out.push({ level: 'warn', title: '步驟天數合計超過承諾處理天數', message: `步驟天數合計 ${sum} 天，大於承諾處理天數 ${st.slaDays} 天。` });
  } else if (type === 'publication') {
    for (const e of parseArticles(st.articles).errors) out.push({ level: 'error', title: '篇目格式', message: e });
    const isbn = String(st.isbn ?? '').replace(/[-\s]/g, '');
    if (isbn && !/^(\d{9}[\dXx]|\d{13})$/.test(isbn)) out.push({ level: 'warn', title: 'ISBN 格式', message: 'ISBN 應為 10 或 13 碼。' });
    if (st.issn && !/^\d{4}-\d{3}[\dXx]$/.test(st.issn)) out.push({ level: 'warn', title: 'ISSN 格式', message: 'ISSN 應為 NNNN-NNNN。' });
    if (st.gpn && !/^\d{10}$/.test(String(st.gpn).replace(/[-\s]/g, ''))) out.push({ level: 'warn', title: 'GPN 格式', message: '政府出版品統一編號 GPN 為 10 碼數字。' });
    out.push({ level: 'info', title: '審閱週期', message: '出版品是紀錄，審閱週期預設 0（不逾期）；內容有誤以勘誤版次處理，不改原件。' });
  } else if (type === 'recruit' || type === 'procurement') {
    if (st.deadlineAt && today && st.deadlineAt < today) out.push({ level: 'warn', title: '截止日已過', message: '上架後會直接標為「已截止」並退出首頁與進行中列表（保留在「已截止」頁籤）。' });
    if (st.newsApplyUrl && !isExternal(st.newsApplyUrl)) out.push({ level: 'warn', title: '報名網址', message: '報名／投標網址應為 https:// 開頭的外部連結（政府電子採購網、人事行政總處）。' });
    out.push({ level: 'info', title: '截止後自動處理', message: '截止日一過，系統自動標「已截止」並退出首頁，無須人工下架；之後可在「公告管理」頁依建議封存。' });
  } else if (type === 'research') {
    if (st.year && (Number(st.year) < 1990 || Number(st.year) > 2100)) out.push({ level: 'warn', title: '年度', message: '年度請填西元年（例：2026）。' });
  }
  return out;
}

// ---------- 匯出 ----------
export function hash4(s) {
  let h = 2166136261;
  for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return h.toString(36).padStart(4, '0').slice(-4);
}
export function suggestId(type, { title = '', today = '', slug = '', family = '', version = '' } = {}) {
  const h = hash4(title || today);
  const d = today || '0000-00-00';
  switch (type) {
    case 'faq': return `faq.${slug ? `${slug}-` : ''}new-${h}`;
    case 'news': case 'letter': return `news.${d}-${type === 'letter' ? 'letter-' : ''}${slug ? `${slug}-` : ''}${h}`;
    case 'clarification': return `clar.${d.slice(0, 7)}-${h}`;
    case 'document': return `${family || 'doc.new-document'}.${(version && /^\d{4}-\d{2}-\d{2}$/.test(version) ? version : d)}`;
    case 'disease': return `disease.${slug || `new-${h}`}`;
    case 'vaccine': return `vaccine.${slug || `new-${h}`}`;
    case 'media': return `media.${slug ? `${slug}-` : ''}${d.slice(0, 7)}-${h}`;
    case 'topic': return `topic.new-${h}`;
    case 'service': return `service.new-${h}`;
    case 'publication': return `publication.${d.slice(0, 7)}-${h}`;
    case 'labtest': return `labtest.${slug ? `${slug}-` : ''}${h}`;
    case 'research': return `research.${d.slice(0, 4)}-${h}`;
    case 'recruit': return `news.${d}-recruit-${h}`;
    case 'procurement': return `news.${d}-procurement-${h}`;
    default: return `page.new-${h}`;
  }
}

/** content id → slug（schema 要求 ^[a-z0-9-]+$）：去掉型別前綴，其餘非法字元換成連字號。 */
export const slugOfId = (id) => String(id ?? '').replace(/^[a-z]+\./, '').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');

const DISEASE_BLOCKS = [
  ['what-to-do', '我該怎麼辦'], ['symptoms', '症狀與警示徵象'], ['transmission', '怎麼傳染'], ['prevention', '如何預防'],
  ['treatment', '診斷與治療'], ['vaccine', '疫苗'], ['situation', '目前疫情與統計'], ['faq', '常見問題'],
];

/**
 * state = { type, id, title, body, owner, steward, reviewPeriodMonths, audience[], tasks[], basedOn[], langs:{code:{on,reason}}, summary,
 *   keywords[], diseases[], vaccines[], countries[], structured:{}, extra:{...型別專屬}, today, submitted }
 */
export function buildExport(st) {
  const today = st.today;
  const langs = {};
  const tier1 = TIER1.includes(st.type);
  for (const l of LANGS) {
    const v = st.langs?.[l.code];
    if (l.code === 'zh-TW') langs[l.code] = { status: 'source' };
    else if (v?.on) langs[l.code] = { status: 'pending' };
    else langs[l.code] = { status: 'none', ...(v?.reason ? { note: `不提供：${v.reason}` } : {}) };
  }
  const audience = st.audience?.length ? st.audience : ['public'];
  const out = {
    id: st.id,
    type: schemaType(st.type),
    title: st.title,
    owner: st.owner,
    steward: st.steward || '承辦人',
    publishedAt: today,
    reviewedAt: today,
    reviewPeriodMonths: Number(st.reviewPeriodMonths ?? 12),
    status: st.submitted ? 'review' : 'draft',
    audience,
    tasks: st.tasks ?? [],
    sensitivity: audience.includes('public') ? 'public' : 'professional',
    license: 'OGDL-1.0',
    basedOn: st.basedOn ?? [],
    diseases: st.diseases ?? [],
    vaccines: st.vaccines ?? [],
    countries: st.countries ?? [],
    aiWhitelist: { requested: true },
    languages: langs,
    summary: (st.summary || '').slice(0, 400),
    keywords: st.keywords ?? [],
  };
  if (st.structured && Object.keys(st.structured).length) out.structured = st.structured;
  // 第九輪：排程發布與緊急發布（§17.1）。publishAt 以臺北時間輸入，輸出帶 +08:00；urgent 只在 true 時寫出。
  if (st.publishAt) out.publishAt = st.publishAt;
  if (st.urgent === true) out.urgent = true;
  const ex = st.extra ?? {};
  const intOrNull = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Math.trunc(Number(v)));
  const numOrStr = (v) => (v === '' || v == null ? null : /^\d+$/.test(String(v)) ? Number(v) : String(v));
  const put = (k, v) => { if (v != null && v !== '' && !(Array.isArray(v) && !v.length)) out[k] = v; };
  switch (st.type) {
    case 'faq': out.question = st.title; out.answerMarkdown = st.body; break;
    case 'news': out.newsType = 'press'; out.bodyMarkdown = st.body; break;
    case 'letter': out.type = 'letter'; out.newsType = 'letter'; out.bodyMarkdown = st.body; if (ex.letterNo) out.letterNo = /^\d+$/.test(ex.letterNo) ? Number(ex.letterNo) : ex.letterNo; break;
    case 'clarification': out.claim = ex.claim || st.title; out.verdict = ex.verdict || 'false'; out.clarificationMarkdown = st.body; out.shareText = (ex.shareText || st.summary || '').slice(0, 300); break;
    case 'document':
      out.family = ex.family || 'doc.new-document'; out.docType = ex.docType || 'recommendation'; out.version = ex.version || today; out.effectiveAt = ex.effectiveAt || today;
      out.supersedes = ex.supersedes || null; out.machineReadableMarkdown = st.body; break;
    case 'disease':
      out.slug = ex.slug || 'new-disease'; out.nameEn = ex.nameEn || 'New disease'; out.legalCategory = Number(ex.legalCategory || 4);
      out.keyFacts = { symptoms: '待補', transmission: '待補', prevention: '待補', ...(st.structured?.incubationDays ? { incubation: `${st.structured.incubationDays} 天` } : {}), ...(st.structured?.notifyWithinHours ? { notify: `${st.structured.notifyWithinHours} 小時內` } : {}) };
      if (st.structured?.notifyWithinHours) out.notifyWithinHours = Number(st.structured.notifyWithinHours);
      out.blocks = DISEASE_BLOCKS.map(([key, heading], i) => (i === 0 ? { key, heading, markdown: st.body } : { key, heading, markdown: '', status: 'pending' }));
      break;
    case 'vaccine':
      out.slug = ex.slug || 'new-vaccine'; out.nameEn = ex.nameEn || 'New vaccine'; out.publicFunded = [{ group: '待補', schedule: '待補' }]; out.bodyMarkdown = st.body; break;
    case 'media': {
      out.mediaType = ex.mediaType || 'video';
      const yt = youtubeIdFrom(ex.youtube);
      out.youtubeId = yt || null;
      out.producedAt = ex.producedAt || '';
      put('basedOnVersionLabel', ex.versionLabel);
      out.transcriptMarkdown = ex.transcript ?? '';
      put('chapters', parseChapters(ex.chapters).items);
      put('captions', ex.captions);
      break;
    }
    case 'topic':
      out.slug = slugOfId(st.id); put('kind', ex.topicKind); put('introMarkdown', st.body);
      put('startAt', ex.startAt); put('endAt', ex.endAt);
      out.links = parseLinks(ex.links).items;
      put('contentIds', ex.contentIds);
      break;
    case 'service':
      out.slug = slugOfId(st.id); out.serviceType = ex.serviceType || 'other'; out.whoCanApply = ex.who ?? []; put('introMarkdown', st.body);
      put('requiredDocuments', lines(ex.docs)); out.steps = parseSteps(ex.steps).items;
      put('slaDays', intOrNull(ex.slaDays)); put('fee', ex.fee); put('legalBasis', lines(ex.legal)); put('forms', parseForms(ex.forms).items);
      put('applyUrl', ex.applyUrl); put('contact', ex.contact);
      break;
    case 'publication':
      out.pubType = ex.pubType || 'bulletin'; out.series = ex.series ?? '';
      put('volume', numOrStr(ex.volume)); put('issue', numOrStr(ex.issue)); put('edition', ex.edition);
      put('isbn', ex.isbn); put('issn', ex.issn); put('gpn', ex.gpn); put('abstractMarkdown', st.body);
      put('articles', parseArticles(ex.articles).items);
      break;
    case 'labtest':
      out.disease = ex.labDisease ?? ''; out.specimens = parseSpecimens(ex.specimens).items; out.labs = ex.labs ?? [];
      put('sendWithinHours', intOrNull(ex.sendHours)); put('notesMarkdown', st.body);
      break;
    case 'research':
      out.year = intOrNull(ex.year) ?? 0; out.projectStatus = ex.projectStatus || 'ongoing';
      put('fundingType', ex.fundingType); put('projectNo', ex.projectNo); put('piUnit', ex.piUnit); put('abstractMarkdown', st.body);
      put('datasets', ex.datasets);
      break;
    case 'recruit': case 'procurement':
      out.newsType = st.type; out.bodyMarkdown = st.body; out.deadlineAt = ex.deadlineAt || '';
      put('refNo', ex.refNo); put('applyUrl', ex.newsApplyUrl);
      if (st.type === 'recruit') put('positions', intOrNull(ex.positions)); else put('budgetNtd', intOrNull(ex.budgetNtd));
      break;
    default: break;
  }
  void tier1;
  if (st.assets?.length) out.assets = st.assets;
  return out;
}

/** 簡易必填檢查（正式驗證在 CI 的 JSON Schema）。 */
export function requiredCheck(obj, ownerIds = [], opts = {}) {
  const miss = [];
  const need = ['id', 'type', 'title', 'owner', 'publishedAt', 'reviewedAt', 'reviewPeriodMonths', 'status', 'audience', 'sensitivity', 'license', 'languages', 'summary'];
  for (const k of need) if (obj[k] == null || obj[k] === '' || (Array.isArray(obj[k]) && !obj[k].length)) miss.push(k);
  if (!/^[a-z]+\.[a-z0-9][a-z0-9.-]*$/.test(obj.id ?? '')) miss.push('id（格式：小寫英數與連字號，如 faq.xxx）');
  if (ownerIds.length && !ownerIds.includes(obj.owner)) miss.push('owner（不在單位主檔）');
  const typeNeed = {
    faq: ['question', 'answerMarkdown'], news: ['newsType', 'bodyMarkdown'], letter: ['newsType', 'bodyMarkdown'], clarification: ['claim', 'verdict', 'clarificationMarkdown', 'shareText'],
    document: ['family', 'docType', 'version', 'effectiveAt', 'machineReadableMarkdown'], disease: ['slug', 'nameEn', 'legalCategory', 'blocks', 'keyFacts'], vaccine: ['slug', 'nameEn', 'publicFunded', 'bodyMarkdown'],
    media: ['mediaType', 'producedAt', 'transcriptMarkdown'], topic: ['slug', 'links'], service: ['slug', 'serviceType', 'whoCanApply', 'steps'], publication: ['series', 'pubType'],
    labtest: ['disease', 'specimens', 'labs'], research: ['year', 'projectStatus'],
  }[obj.type] ?? [];
  for (const k of typeNeed) if (obj[k] == null || obj[k] === '' || obj[k] === 0 || (Array.isArray(obj[k]) && !obj[k].length)) miss.push(k);
  // 型別附加規則
  if (obj.type === 'media') {
    if (!(obj.basedOn ?? []).length) miss.push('basedOn（影音必填依據正本）');
    if (obj.youtubeId === undefined) miss.push('youtubeId');
  }
  if (obj.type === 'news' && ['recruit', 'procurement'].includes(obj.newsType) && !obj.deadlineAt) miss.push('deadlineAt（截止日）');
  if (obj.type === 'labtest' && obj.disease && !/^disease\./.test(obj.disease)) miss.push('disease（須為 disease.*）');
  if ((obj.type === 'topic' || obj.type === 'service') && obj.slug && !/^[a-z0-9-]+$/.test(obj.slug)) miss.push('slug（小寫英數與連字號）');
  if (obj.summary && obj.summary.length > 120) miss.push('summary（建議 ≤ 120 字）');
  for (const i of assetIssues(obj, opts.limits)) if (i.level === 'error') miss.push(i.msg);
  return miss;
}

// ───────────────────────── 檔案資產（第八輪，ARCHITECTURE §16.1／16.2）─────────────────────────
// 契約由 Y1 的 schemas/_common.json（assets）與 scripts/lib/assets.mjs 擁有；這裡是「上架前預檢」的瀏覽器版：
// 規則與建置檢查對齊，讓同事在送 PR 之前就看到會被擋的項目。純函式，Node 測試共用。

const MB = 1024 * 1024;
export const ASSET_EXTENSIONS = ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'svg', 'csv', 'json', 'xlsx', 'docx', 'odt', 'md', 'ics'];
export const ASSET_DEFAULTS = { pdfBytes: 20 * MB, imageBytes: 2 * MB, dataBytes: 50 * MB, maxFiles: 30, extensions: ASSET_EXTENSIONS };
export const ASSET_KINDS = [['attachment', '附件（列在頁面附件區）'], ['image', '內文圖片'], ['data', '資料檔（CSV、JSON、XLSX）']];
export const ASSET_MIME = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml',
  csv: 'text/csv', json: 'application/json', md: 'text/markdown', ics: 'text/calendar',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  odt: 'application/vnd.oasis.opendocument.text',
};
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'svg']);
const DATA_EXT = new Set(['csv', 'json', 'xlsx']);
/** 內容檔名規則（與 §16.1 一致）：小寫英數、連字號、底線與點；不可有空白與中文。 */
export const ASSET_NAME_RE = /^[a-z0-9][a-z0-9._-]*$/;

/**
 * 限制值正規化：接受 window.CDC_ASSETS_LIMITS 或 site.config.assets 的各種寫法（bytes 或 MB；欄位別名），缺的用預設。
 * 回傳 { pdfBytes, imageBytes, dataBytes, maxFiles, extensions }。
 */
export function normalizeLimits(raw) {
  const d = ASSET_DEFAULTS;
  if (!raw || typeof raw !== 'object') return { ...d, extensions: [...d.extensions] };
  const num = (keys, dflt) => {
    for (const k of keys) {
      const parts = k.split('.');
      let v = raw; for (const q of parts) v = v?.[q];
      if (v == null || v === '' || Number.isNaN(Number(v))) continue;
      v = Number(v);
      if (/MB$|Mb$/.test(k)) return v * MB;
      return v > 0 && v < 100000 ? v * MB : v; // < 100000 視為 MB，其餘為 bytes
    }
    return dflt;
  };
  const exts = raw.extensions ?? raw.allowedExt ?? raw.allowedExtensions ?? raw.allowExtensions ?? raw.allowedExts;
  return {
    pdfBytes: num(['pdfBytes', 'pdfMaxBytes', 'maxPdfBytes', 'pdfMB', 'pdfMaxMB', 'maxBytes.pdf', 'maxBytes.attachment', 'pdf'], d.pdfBytes),
    imageBytes: num(['imageBytes', 'imageMaxBytes', 'maxImageBytes', 'imageMB', 'imageMaxMB', 'maxBytes.image', 'image'], d.imageBytes),
    dataBytes: num(['dataBytes', 'dataMaxBytes', 'maxDataBytes', 'dataMB', 'dataMaxMB', 'maxBytes.data', 'data'], d.dataBytes),
    maxFiles: Number(raw.maxFiles ?? raw.maxFilesPerContent ?? raw.maxPerContent ?? raw.maxCount ?? d.maxFiles) || d.maxFiles,
    extensions: (Array.isArray(exts) && exts.length ? exts : d.extensions).map((e) => String(e).replace(/^\./, '').toLowerCase()),
  };
}

export const assetExt = (name) => { const m = /\.([A-Za-z0-9]+)$/.exec(String(name ?? '')); return m ? m[1].toLowerCase() : ''; };
export const assetKindFor = (name) => { const e = assetExt(name); return IMAGE_EXT.has(e) ? 'image' : DATA_EXT.has(e) ? 'data' : 'attachment'; };
export const assetMimeFor = (name) => ASSET_MIME[assetExt(name)] ?? '';
export const assetLimitFor = (kind, limits = ASSET_DEFAULTS) => (kind === 'image' ? limits.imageBytes : kind === 'data' ? limits.dataBytes : limits.pdfBytes);
export const fmtBytes = (n) => (n >= MB ? `${(n / MB).toFixed(n >= 10 * MB ? 0 : 1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);

/**
 * 檔名正規化：小寫、空白與不合法字元→連字號、去中文、連續符號合併、副檔名小寫。
 * taken：已用檔名（重複時加 -2、-3）。回傳 { name, changed, notes[] }。
 */
export function normalizeAssetName(original, taken = []) {
  const orig = String(original ?? '').replace(/^.*[\\/]/, '').trim();
  const dot = orig.lastIndexOf('.');
  const rawBase = dot > 0 ? orig.slice(0, dot) : orig;
  const ext = dot > 0 ? orig.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '') : '';
  const notes = [];
  if (/\s/.test(orig)) notes.push('檔名有空白，已改成連字號');
  if (/[⺀-鿿豈-﫿＀-￯　-〿]/.test(orig)) notes.push('檔名含中文（或全形字），已移除；建議自行取一個英文檔名，例如 press-release.pdf');
  if (/[A-Z]/.test(orig)) notes.push('已改為小寫');
  let base = rawBase.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9._-]+/g, '-').replace(/[-_.]*\.[-_.]*/g, '.').replace(/-{2,}/g, '-').replace(/_{2,}/g, '_').replace(/^[-_.]+|[-_.]+$/g, '');
  if (!base) { base = 'file'; if (!notes.length) notes.push('檔名無法使用，已改為 file'); }
  let name = ext ? `${base}.${ext}` : base;
  if (!notes.length && name !== orig) notes.push('檔名已正規化');
  const used = new Set(taken);
  if (used.has(name)) {
    let k = 2;
    while (used.has(ext ? `${base}-${k}.${ext}` : `${base}-${k}`)) k++;
    name = ext ? `${base}-${k}.${ext}` : `${base}-${k}`;
    notes.push('與已加入的檔名重複，已加上流水號');
  }
  return { name, changed: name !== orig, notes };
}

/** 取出一筆內容的所有 Markdown 內文（answerMarkdown、bodyMarkdown、blocks[].markdown…），預檢內文引用用。 */
export function bodyMarkdownOf(obj) {
  const out = [];
  const walk = (v, key) => {
    if (typeof v === 'string') { if (/Markdown$|^markdown$/.test(key ?? '')) out.push(v); }
    else if (Array.isArray(v)) v.forEach((x) => walk(x, key));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (k !== 'assets') walk(x, k);
  };
  walk(obj, '');
  return out.join('\n\n');
}

/** 內文中對 /files/{id}/{file} 的引用（Markdown 圖片、連結、HTML img） */
export function bodyFileRefs(md) {
  const out = [];
  const s = String(md ?? '');
  const re = /(!?)\[([^\]]*)\]\(\s*<?(\/files\/([^/\s)>]+)\/([^\s)>?#"']+))[^)]*\)|<img\b[^>]*?\bsrc=["']?(\/files\/([^/\s"'>]+)\/([^\s"'>?#]+))/gi;
  let m;
  const dec = (x) => { try { return decodeURIComponent(x); } catch { return x; } };
  while ((m = re.exec(s))) {
    if (m[3]) out.push({ id: dec(m[4]), file: dec(m[5]), image: m[1] === '!', alt: m[2] });
    else out.push({ id: dec(m[7]), file: dec(m[8]), image: true, alt: '' });
  }
  return out;
}

/**
 * 資產預檢（純函式）。obj 是將匯出的 content JSON（含 assets[] 與各 *Markdown 內文）。
 * 回傳 [{ level:'error'|'warn', code, file, msg }]。error 對應建置會失敗的項目，warn 對應待辦或建議。
 */
export function assetIssues(obj, limits = ASSET_DEFAULTS) {
  limits = { ...ASSET_DEFAULTS, ...(limits ?? {}) };
  const out = [];
  const assets = Array.isArray(obj?.assets) ? obj.assets : [];
  const md = bodyMarkdownOf(obj);
  const refs = bodyFileRefs(md);
  const myId = obj?.id ?? '';
  const add = (level, code, file, msg) => out.push({ level, code, file: file ?? null, msg });
  const by = new Map();
  if (assets.length > limits.maxFiles) add('error', 'too-many', null, `附件與圖片共 ${assets.length} 個，超過上限 ${limits.maxFiles} 個`);
  for (const a of assets) {
    const f = a.file ?? '';
    if (by.has(f)) add('error', 'duplicate', f, `檔名重複：${f}`);
    by.set(f, a);
  }
  for (const a of assets) {
    const f = a.file ?? '';
    const ext = assetExt(f);
    const tag = `檔案 ${f || '（未命名）'}`;
    if (!f) { add('error', 'name', null, '有檔案沒有檔名'); continue; }
    if (a.missing) add('error', 'missing-file', f, `${tag}：重新整理後需要重新選取檔案（瀏覽器不保存檔案內容）`);
    if (!ASSET_NAME_RE.test(f)) add('error', 'name', f, `${tag}：檔名不合法（只能小寫英數、連字號、底線與點，不可有空白與中文）；建議「${normalizeAssetName(f).name}」`);
    if (!limits.extensions.includes(ext)) add('error', 'ext', f, `${tag}：不允許的副檔名 .${ext || '（無）'}（允許：${limits.extensions.join('、')}）`);
    if (!['attachment', 'image', 'data'].includes(a.kind)) add('error', 'kind', f, `${tag}：種類須為附件、內文圖片或資料檔`);
    const exp = assetMimeFor(f);
    if (a.mime && exp && a.mime !== exp) add('error', 'mime', f, `${tag}：內容類型 ${a.mime} 與副檔名 .${ext} 不一致（應為 ${exp}）`);
    if (typeof a.bytes === 'number') {
      const lim = assetLimitFor(a.kind, limits);
      if (a.bytes > lim) add('error', 'size', f, `${tag}：${fmtBytes(a.bytes)} 超過${a.kind === 'image' ? '圖片' : a.kind === 'data' ? '資料檔' : '附件（PDF）'}上限 ${fmtBytes(lim)}`);
      if (a.bytes === 0) add('error', 'empty', f, `${tag}：檔案是空的`);
    }
    if (!a.missing && !a.sha256) add('warn', 'sha256', f, `${tag}：沒有 sha256（此瀏覽器不支援 Web Crypto？）；建置時請用 npm run build -- --fix-assets 補寫`);
    if (a.kind === 'image') {
      const alt = String(a.alt ?? '').trim();
      const refAlt = refs.filter((r) => r.file === f && r.id === myId).map((r) => r.alt.trim()).find(Boolean);
      if (!alt && !refAlt) add('error', 'alt', f, `${tag}：圖片缺替代文字（alt）`);
      else if (!alt) add('warn', 'alt-json', f, `${tag}：assets 的 alt 空白，目前只有內文的替代文字；請兩邊都填`);
      if (alt.length > 150) add('error', 'alt-long', f, `${tag}：alt 超過 150 字（${alt.length}）`);
      if (!String(a.license ?? '').trim()) add('error', 'license', f, `${tag}：圖片缺授權（license，例如 OGDL-1.0）`);
      else if (a.license !== 'OGDL-1.0' && !String(a.source ?? '').trim()) add('warn', 'source', f, `${tag}：非本署素材（授權 ${a.license}）請填來源（source）`);
      if (!refs.some((r) => r.file === f && r.id === myId)) add('warn', 'unreferenced', f, `${tag}：已宣告為內文圖片，但內文沒有引用（內文要有 ![替代文字](/files/${myId}/${f})）`);
    } else if (!String(a.label ?? '').trim()) {
      add('error', 'label', f, `${tag}：${a.kind === 'data' ? '資料檔' : '附件'}缺顯示名稱（label）`);
    }
    if (a.kind === 'attachment' && ext === 'pdf' && a.machineReadable === false) {
      const stem = f.replace(/\.[^.]+$/, '');
      const alt = a.accessibleAlt ? by.get(a.accessibleAlt) : [...by.values()].find((x) => /\.(md|docx|odt)$/.test(x.file ?? '') && String(x.file).replace(/\.[^.]+$/, '') === stem);
      if (!alt) add('warn', 'pdf-accessible', f, `${tag}：PDF 未勾「有文字層」且沒有 .md／.docx／.odt 替代版 → 建置會產生待辦「attachment-no-accessible-version」`);
    }
  }
  const seen = new Set();
  for (const r of refs) {
    const key = `${r.id}/${r.file}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (r.id !== myId) { add('error', 'foreign', r.file, `內文引用了其他內容的檔案 /files/${r.id}/${r.file}（每筆內容只能引用自己的 assets）`); continue; }
    const a = by.get(r.file);
    if (!a) add('error', 'undeclared', r.file, `內文引用 /files/${r.id}/${r.file}，但沒有在附件與圖片中宣告`);
    else if (r.image && a.kind !== 'image') add('error', 'not-image', r.file, `內文把 ${r.file} 當圖片引用，但它的種類是「${a.kind === 'data' ? '資料檔' : '附件'}」`);
  }
  return out;
}
/** 轉成預處理「一致性檢查」的 check 物件（只取 warn；error 走 requiredCheck 的必補清單） */
export function assetWarnings(obj, limits) {
  return assetIssues(obj, limits).filter((i) => i.level === 'warn').map((i) => ({ level: 'warn', title: '檔案資產', message: i.msg, code: `asset-${i.code}` }));
}

/**
 * 把面板的檔案清單轉成 content JSON 的 assets[]（欄位順序同 §16.1）。
 * 輸入每筆：{ file, kind, label, alt, mime, bytes, sha256, machineReadable, accessibleAlt, license, source, width, height }
 */
export function buildAssetsJson(list = []) {
  const keep = (v) => v != null && v !== '' && !(typeof v === 'number' && Number.isNaN(v));
  return list.map((a) => {
    const o = { file: a.file, kind: a.kind };
    if (keep(String(a.label ?? '').trim())) o.label = String(a.label).trim();
    if (a.kind === 'image' && keep(String(a.alt ?? '').trim())) o.alt = String(a.alt).trim();
    if (keep(a.mime)) o.mime = a.mime;
    if (keep(a.bytes)) o.bytes = a.bytes;
    if (keep(a.sha256)) o.sha256 = a.sha256;
    if (a.kind === 'attachment') {
      o.machineReadable = a.machineReadable !== false;
      if (assetExt(a.file) === 'pdf' && a.machineReadable === false && keep(a.accessibleAlt)) o.accessibleAlt = a.accessibleAlt;
    }
    if (a.kind === 'image') {
      if (keep(String(a.license ?? '').trim())) o.license = String(a.license).trim();
      if (keep(String(a.source ?? '').trim())) o.source = String(a.source).trim();
      if (keep(a.width)) o.width = a.width;
      if (keep(a.height)) o.height = a.height;
    }
    return o;
  });
}

/** 上架包內的放置路徑：{ json: 'content/news/2026-….json', assets: ['content/assets/<id>/<file>', …] }（供樹狀圖與 ZIP 共用） */
export function packagePaths(obj, uiType) {
  const rest = String(obj.id ?? '').replace(/^[a-z]+\./, '') || 'new';
  return {
    json: `content/${DIRS[uiType] ?? 'faq'}/${rest}.json`,
    assets: (obj.assets ?? []).map((a) => `content/assets/${obj.id}/${a.file}`),
  };
}

/** 上架包放置路徑 → 樹狀圖文字（├─ └─）。paths：packagePaths() 的結果。 */
export function renderTree(paths) {
  const root = {};
  for (const f of [paths.json, ...paths.assets]) {
    let n = root;
    const parts = f.split('/');
    parts.forEach((part, i) => { n = n[part] ??= i === parts.length - 1 ? null : {}; });
  }
  const mark = (name) => (name === paths.json.split('/').pop() ? '   ← content JSON' : '');
  const lines = ['（repo 根目錄）'];
  const walk = (node, prefix) => {
    const keys = Object.keys(node);
    keys.forEach((k, i) => {
      const last = i === keys.length - 1;
      lines.push(`${prefix}${last ? '└─ ' : '├─ '}${k}${node[k] ? '/' : mark(k)}`);
      if (node[k]) walk(node[k], prefix + (last ? '   ' : '│  '));
    });
  };
  walk(root, '');
  return lines.join('\n');
}

// ───────────────────────── 檔案內容檢查（面板與測試共用，純函式）─────────────────────────
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
/** SHA-256（Web Crypto）；不可用（非安全來源）時回傳空字串，預檢會提示。 */
export async function sha256Hex(blobOrBytes) {
  try {
    const buf = blobOrBytes instanceof Uint8Array ? blobOrBytes : await blobOrBytes.arrayBuffer();
    return hex(await crypto.subtle.digest('SHA-256', buf));
  } catch { return ''; }
}
/** SVG 內容掃描：<script>、on*= 事件屬性、javascript: 網址、foreignObject 一律拒收。回傳原因或空字串。 */
export function scanSvg(text) {
  const t = String(text);
  if (/<\s*script/i.test(t)) return 'SVG 內含 <script>';
  if (/[\s"'/]on[a-z]+\s*=/i.test(t)) return 'SVG 內含事件屬性（on…=）';
  if (/javascript\s*:/i.test(t)) return 'SVG 內含 javascript: 網址';
  if (/<\s*foreignObject/i.test(t)) return 'SVG 內含 foreignObject';
  return '';
}
/** 檔頭簽章與副檔名是否相符（只檢查有固定簽章的格式）。回傳錯誤說明或空字串。 */
export function sniffMismatch(ext, head) {
  const b = head;
  const at = (i, s) => [...s].every((c, k) => b[i + k] === c.charCodeAt(0));
  const is = {
    pdf: at(0, '%PDF'),
    png: b[0] === 0x89 && at(1, 'PNG'),
    jpg: b[0] === 0xff && b[1] === 0xd8, jpeg: b[0] === 0xff && b[1] === 0xd8,
    webp: at(0, 'RIFF') && at(8, 'WEBP'),
    xlsx: at(0, 'PK'), docx: at(0, 'PK'), odt: at(0, 'PK'),
  }[ext];
  return is === false ? `內容不是有效的 .${ext} 檔（檔頭簽章不符）` : '';
}
/** 讀 SVG 的 width／height（數字）或 viewBox */
export function svgSize(text) {
  const m = /<svg\b[^>]*>/i.exec(text)?.[0] ?? '';
  const num = (n) => { const v = new RegExp(`\\s${n}\\s*=\\s*["']?\\s*([\\d.]+)\\s*(?:px)?\\s*["']`, 'i').exec(m); return v ? Math.round(Number(v[1])) : 0; };
  let w = num('width'), h = num('height');
  const vb = /viewBox\s*=\s*["']\s*[-\d.]+[ ,]+[-\d.]+[ ,]+([\d.]+)[ ,]+([\d.]+)/i.exec(m);
  if ((!w || !h) && vb) { w = Math.round(Number(vb[1])); h = Math.round(Number(vb[2])); }
  return w && h ? { width: w, height: h } : {};
}


// ───────────────────────── 發布車道、排程與緊急發布、模擬送出（第九輪，ARCHITECTURE §17.1／17.4）─────────────────────────
// 契約由 Z1 的 content/governance/lanes.json 與 scripts/lib/lanes.mjs 擁有；這裡是瀏覽器端的「呈現」：
// 型別選定就顯示車道與一句說明、預檢 urgent／publishAt、並把送出之後 GitHub 上會發生的事畫成時間軸。
// 全部是展示，不呼叫任何 API。純函式，Node 測試共用。lanes.json 不存在或欄位缺漏時用下列預設值（與 §17.1 相同）。

/** 可標 urgent 的型別（§17.1：只有 news／letter／clarification）。 */
export const URGENT_TYPES = ['news', 'letter', 'clarification'];
export const LANE_DEFAULTS = {
  lanes: {
    emergency: { label: '緊急發布', types: ['situation'], alsoWhen: { urgent: true }, autoMerge: true, requiredApprovals: 0, postPublishReviewHours: 24, slaMinutes: 10 },
    fast: { label: '快車道', types: ['news', 'letter', 'clarification', 'job', 'tender', 'banner'], autoMerge: true, requiredApprovals: 0, postPublishReviewHours: 24, slaMinutes: 180 },
    standard: {
      label: '一般車道',
      types: ['disease', 'vaccine', 'document', 'faq', 'topic', 'service', 'page', 'publication', 'labtest', 'research', 'dataset', 'media', 'migration'],
      autoMerge: false, requiredApprovals: 1, reviewers: ['unit.pr'], tier1Reviewers: ['unit.pr', 'unit.oasis'], slaWorkingDays: 2,
    },
  },
  rules: { translationsNeverBlock: true, machineTranslationAllowedFor: ['news', 'faq', 'topic', 'service'], ciIsTheReviewer: true, urgentAllowedTypes: URGENT_TYPES },
};
export const LANE_ORDER = ['emergency', 'fast', 'standard'];
/** 預覽網址格式（§17.2）。 */
export const PREVIEW_BASE = 'https://ancientsky.github.io/new_cdc_prototype/preview';
/** CI 會跑的檢查（content-pr.yml）。 */
export const CI_CHECKS = [
  ['schema', 'schema 與跨檔參照', '欄位、owner、basedOn、publishAt／urgent 格式'],
  ['governance', '治理規則', 'npm test：逾期、版本鏈、白名單、反向稽核…'],
  ['eval', '評估集', '版本題必須全對'],
  ['assets', '檔案資產', '存在、sha256／bytes、格式與大小、圖片 alt 與授權'],
  ['links', '連結', '站內連結與 /files/ 引用都存在'],
];

/** 讀進來的 lanes.json（可能是 undefined、缺欄位）合併預設；回傳 { lanes, rules }，保證三條車道都在。 */
export function normalizeLanes(raw) {
  const out = { lanes: {}, rules: { ...LANE_DEFAULTS.rules, ...(raw && typeof raw === 'object' ? raw.rules : {}) } };
  for (const id of LANE_ORDER) {
    const d = LANE_DEFAULTS.lanes[id];
    const r = raw && typeof raw === 'object' && raw.lanes && typeof raw.lanes === 'object' ? raw.lanes[id] : null;
    out.lanes[id] = r && typeof r === 'object' ? { ...d, ...r, types: Array.isArray(r.types) ? r.types : d.types } : { ...d };
  }
  return out;
}
/** 某型別可否標 urgent。 */
export const urgentAllowed = (type, cfg = LANE_DEFAULTS) => (cfg?.rules?.urgentAllowedTypes ?? URGENT_TYPES).includes(schemaType(type));
/** 型別（與是否 urgent）→ 車道。回傳 { id, ...lane }。找不到型別的一律走一般車道（最嚴）。 */
export function laneOf(type, urgent = false, cfg = LANE_DEFAULTS) {
  const c = cfg?.lanes ? cfg : normalizeLanes(cfg);
  const t = schemaType(type);
  if (urgent && urgentAllowed(t, c)) return { id: 'emergency', ...c.lanes.emergency };
  for (const id of LANE_ORDER) if ((c.lanes[id].types ?? []).includes(t)) return { id, ...c.lanes[id] };
  return { id: 'standard', ...c.lanes.standard };
}
/** 審核人 id 清單：一般車道的一級內容（疾病、疫苗…）用 tier1Reviewers。 */
export function reviewersOf(lane, type) {
  if (lane.id !== 'standard') return [];
  return (TIER1.includes(schemaType(type)) ? lane.tier1Reviewers : lane.reviewers) ?? lane.reviewers ?? [];
}
const joinNames = (ids, names = {}) => ids.map((u) => names[u] ?? u).join('、') || '指定審核人';
const shortUnit = (n) => String(n ?? '').replace(/（.*）$/, '');
/** 車道一句說明（§17.4 的三句）。names：{unit id: 單位名}。 */
export function laneSentence(lane, type, names = {}) {
  const pr = shortUnit(names['unit.pr'] ?? '公關室');
  if (lane.id === 'emergency') return `緊急發布：立即上線並通知複核（${pr} ${lane.postPublishReviewHours ?? 24} 小時內複核，目標 ${lane.slaMinutes ?? 10} 分鐘內上線）`;
  if (lane.id === 'fast') return `快車道：送出後約 3 分鐘上線，${pr} ${lane.postPublishReviewHours ?? 24} 小時內複核`;
  const rv = reviewersOf(lane, type).map((u) => shortUnit(names[u] ?? u));
  const n = lane.requiredApprovals ?? 1;
  return `一般車道：需 ${n} 位審核（${rv.join('、')}），SLA ${lane.slaWorkingDays ?? 2} 個工作天`;
}

/** datetime-local（「2026-10-05T09:00」，臺北時間）→ ISO 8601 帶 +08:00；空字串或格式不符回 ''。 */
export function toPublishAtIso(local) {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::(\d{2}))?$/.exec(String(local ?? '').trim());
  return m ? `${m[1]}T${m[2]}:${m[3] ?? '00'}+08:00` : '';
}
/** 排程時間點 → 毫秒（nan 代表無效）。接受 ISO（帶偏移）、純日期（視為臺北當天 00:00）。 */
export function publishAtMs(v) {
  const s = String(v ?? '').trim();
  if (!s) return NaN;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return Date.parse(`${s}T00:00:00+08:00`);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(s)) return Date.parse(toPublishAtIso(s));
  return Date.parse(s);
}
/** 臺北時間顯示（YYYY-MM-DD HH:mm）。 */
export function fmtTaipei(ms) {
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms + 8 * 3600e3);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}
/**
 * 預檢：urgent 只能用於允許型別；publishAt 必須晚於現在（以真實現在時間判斷，與 BUILD_TODAY 無關）。
 * 回傳 [{ level:'error'|'warn'|'info', code, title, message }]。
 */
export function laneChecks({ type, urgent = false, publishAt = '' } = {}, nowMs = Date.now(), cfg = LANE_DEFAULTS) {
  const allowed = cfg?.rules?.urgentAllowedTypes ?? URGENT_TYPES;
  const out = [];
  if (urgent && !urgentAllowed(type, cfg)) out.push({ level: 'error', code: 'urgent-type', title: '緊急發布不能用於此型別', message: `「緊急發布」只能用於新聞稿、致醫界通函、澄清（${allowed.join('、')}）；其他型別請走一般車道，或改選允許的型別。` });
  if (publishAt) {
    const t = publishAtMs(publishAt);
    if (!Number.isFinite(t)) out.push({ level: 'error', code: 'publish-at-format', title: '排程發布時間格式不正確', message: '請用日期時間欄位選擇（臺北時間），或留空表示核准後立即上線。' });
    else if (t <= nowMs) out.push({ level: 'error', code: 'publish-at-past', title: '排程發布時間必須晚於現在', message: `你選的是 ${fmtTaipei(t)}（臺北時間），已經過了。要立即上線請清空這個欄位。` });
    else if (urgent) out.push({ level: 'warn', code: 'urgent-and-scheduled', title: '緊急發布與排程發布擇一', message: '緊急發布的意思是立即上線；同時排程沒有意義。請取消其中一項。' });
  }
  return out;
}

/**
 * 模擬送出時間軸（只是展示，不呼叫任何 API）。回傳 steps：
 *   { key, title, at（相對時間字串）, status:'ok'|'wait'|'fail'|'skip', detail[], system:'正式環境由系統代做…', checks? }
 * obj：exportObj() 的結果；opts：{ lanes, names, prNumber, miss:[CI 會擋下的項目], failures:{ schema:[], assets:[] }, nowMs }
 */
export function submitTimeline(obj, opts = {}) {
  const cfg = opts.lanes?.lanes ? opts.lanes : normalizeLanes(opts.lanes);
  const names = opts.names ?? {};
  const n = opts.prNumber ?? 57;
  const type = obj.type;
  const urgent = obj.urgent === true;
  const lane = laneOf(type, urgent, cfg);
  const miss = opts.miss ?? [];
  const failed = miss.length > 0;
  const sys = '正式環境由系統代做，承辦人不用動手。';
  const tl = opts.typeLabel ?? obj.type;
  const slug = String(obj.id ?? 'new').replace(/[^a-z0-9.-]+/gi, '-');
  const publishMs = publishAtMs(obj.publishAt);
  const scheduled = Number.isFinite(publishMs) && publishMs > (opts.nowMs ?? Date.now());
  const reviewers = reviewersOf(lane, type).map((u) => shortUnit(names[u] ?? u));
  const previewUrl = `${PREVIEW_BASE}/pr-${n}/`;
  const steps = [];
  steps.push({ key: 'branch', title: '建立分支', at: 'T+0:05', status: 'ok', system: sys, detail: [`把上架包（${obj.assets?.length ? `${obj.assets.length + 1} 個檔案` : '1 個檔案'}）commit 到新分支 content/${slug}。`] });
  steps.push({ key: 'pr', title: '開 Pull Request', at: 'T+0:10', status: 'ok', system: sys, detail: [`標題「content: ${obj.id ?? ''} ${obj.title ?? ''}」；PR 編號由 GitHub 指派（這裡以 #${n} 示意）。`, 'CI 一啟動就在 PR 上留言並加標籤 lane:fast、lane:standard 或 lane:emergency。'] });
  const fails = opts.failures ?? {};
  steps.push({
    key: 'ci', title: 'CI 檢查', at: failed ? 'T+1:40（未通過）' : 'T+1:40', status: failed ? 'fail' : 'ok', system: sys,
    detail: failed ? [`有 ${miss.length} 項沒過，PR 會停在這裡，不會合併也不會上線；修好再推一次，CI 自動重跑。`] : ['五項檢查全過，PR 標示綠燈。'],
    checks: CI_CHECKS.map(([k, label, note]) => ({ key: k, label, note, ok: !(fails[k]?.length) })), issues: miss,
  });
  const skip = failed ? 'skip' : 'ok';
  const laneFacts = lane.id === 'standard'
    ? [`型別「${tl}」→ ${lane.label}：自動合併「否」，需 ${lane.requiredApprovals} 位核准（${reviewers.join('、')}），SLA ${lane.slaWorkingDays} 個工作天。`]
    : [`型別「${tl}」${lane.id === 'emergency' && urgent ? '，且標了 urgent' : ''} → ${lane.label}：自動合併「是」，核准 0 位，上線後 ${lane.postPublishReviewHours} 小時內複核，SLA ${lane.slaMinutes} 分鐘。`];
  steps.push({ key: 'lane', title: '車道判定', at: 'T+1:45', status: skip, lane: lane.id, system: sys, detail: [...laneFacts, `多語不擋中文：翻譯還沒審完的語言先不上線，不會卡住中文正本。`] });
  if (lane.id === 'standard') {
    steps.push({ key: 'merge', title: '等待審核', at: `最長 ${lane.slaWorkingDays} 個工作天`, status: failed ? 'skip' : 'wait', system: sys, detail: [`通知審核人：${reviewers.join('、')}（CODEOWNERS）。審核人看 PR 的內容 diff 與預覽網址，核准後才合併。`, 'CI 是第一位審核者：機器能判斷的都已經過了，人只看措辭與正確性。', `超過 SLA 沒人處理，系統會在 PR 留言並加 sla:breach 標籤。`] });
  } else {
    steps.push({ key: 'merge', title: '自動合併', at: 'T+1:50', status: skip, system: sys, detail: [`檢查全過，不需要人工核准，系統自動 squash 合併並刪除分支。`, `${lane.id === 'emergency' ? '緊急發布同時通知複核人。' : '上線後才複核：後台「連動待辦」出現 post-publish-review。'}`] });
  }
  const dep = [];
  if (scheduled) dep.push(`合併後不會立刻出現：排程 ${fmtTaipei(publishMs)}（臺北時間）到點後，下一次建置（每 2 小時一次）才上線。到點前網站、索引、sitemap、API、RSS 都看不到，狀態標為「排程中」。`);
  else dep.push(lane.id === 'standard' ? '核准並合併後，pages.yml 自動建置與部署，約 3 分鐘上線。' : '合併後 pages.yml 自動建置與部署，整段約 3 分鐘上線（T+3:20）。');
  steps.push({ key: 'deploy', title: '部署', at: scheduled ? '到點後最晚約 2 小時內' : lane.id === 'standard' ? '核准後約 3 分鐘' : 'T+3:20', status: failed ? 'skip' : lane.id === 'standard' || scheduled ? 'wait' : 'ok', system: sys, detail: dep });
  steps.push({ key: 'preview', title: '預覽網址', at: 'T+3:10 起可看', status: failed ? 'skip' : 'ok', system: sys, detail: [`格式：${PREVIEW_BASE}/pr-{N}/`, '預覽要等主站重新部署一次（開 PR 後約 3 分鐘）才打得開；審核人與你都用它檢查版面、連結、附件。PR 關閉後自動清除。'], previewUrl, previewN: n });
  if (lane.id !== 'standard') steps.push({ key: 'review', title: '上線後複核', at: `上線後 ${lane.postPublishReviewHours} 小時內`, status: 'wait', system: sys, detail: [`${names['unit.pr'] ?? '公關室'}收到待辦 post-publish-review（逾期會升高優先度）；複核有問題可直接改或下架，改動仍走車道。`] });
  return { lane, steps, scheduled, previewUrl };
}

// ---------- 修改已上架內容（第十二輪／第五批）：公開頁頁尾「同事修改這頁」→ /admin/publish/?edit={id} ----------
// 原則：表單仍是「產出一份完整 content JSON」，但修改時以 API 的現行版預填，匯出時把表單沒有的欄位（發布日、舊站網址、白名單核准、疾病頁 keyFacts…）
// 從現行版帶回，所以上架包覆寫同一個檔案時 PR 只會顯示真正改動的幾行；發布日不變、審閱日更新。
export const API_ONLY_KEYS = new Set(['url', 'path', 'md', 'governance', 'gov', '__file', 'master', 'related']);
const PREFIX_COLLECTION = { faq: 'faq', news: 'news', doc: 'documents', disease: 'diseases', clar: 'clarifications', vaccine: 'vaccines', topic: 'topics', service: 'services', publication: 'publications', labtest: 'labtests', dataset: 'datasets', media: 'media', research: 'research', job: 'jobs', tender: 'tenders' };
/** 內容 id → 要抓的 v1 集合名（diseases 另有每頁 JSON，由呼叫端依 slug 取） */
export const collectionOfId = (id) => PREFIX_COLLECTION[String(id ?? '').split('.')[0]] ?? null;

/** 疾病頁 blocks ↔ 一份內文（每區塊一個 `## 標題`），讓疾病頁也能在同一個內文欄修改 */
export const joinSections = (blocks) => (blocks ?? []).map((b) => `## ${b.heading}\n\n${(b.markdown ?? '').trim()}`.trimEnd()).join('\n\n') + (blocks?.length ? '\n' : '');
export function splitSections(md) {
  const m = new Map(); let cur = null; const buf = [];
  const flush = () => { if (cur != null) m.set(cur, buf.join('\n').trim()); buf.length = 0; };
  for (const line of String(md ?? '').replace(/\r/g, '').split('\n')) { const h = /^##\s+(.+?)\s*$/.exec(line); if (h) { flush(); cur = h[1]; } else buf.push(line); }
  flush();
  return m;
}

const pipeJoin = (rows, cols) => (rows ?? []).map((r) => cols.map((c) => { const v = c(r); return v == null ? '' : String(v); }).join(' | ').replace(/(?: \|\s*)+$/, '')).join('\n');
const s = (v) => (v == null ? '' : String(v));
/** API 的一筆內容 → writeForm 的形狀（與 SAMPLES 同格） */
export function itemToForm(item) {
  const nt = item.newsType;
  const type = item.type === 'letter' || (item.type === 'news' && nt === 'letter') ? 'letter' : item.type === 'news' && (nt === 'recruit' || nt === 'procurement') ? nt : item.type;
  const langs = {};
  for (const [c, v] of Object.entries(item.languages ?? {})) if (c !== 'zh-TW') langs[c] = { on: (v?.status ?? 'none') !== 'none', reason: s(v?.note).replace(/^不提供：/, '') };
  const role = BODY_ROLE[type]?.field;
  const body = type === 'faq' ? item.answerMarkdown : type === 'clarification' ? item.clarificationMarkdown : type === 'document' ? item.machineReadableMarkdown : type === 'disease' ? joinSections(item.blocks) : role ? item[role] : item.bodyMarkdown;
  const extra = {
    family: s(item.family), docType: s(item.docType), version: s(item.version), effectiveAt: s(item.effectiveAt), supersedes: s(item.supersedes),
    letterNo: s(item.letterNo), claim: s(item.claim), verdict: s(item.verdict), shareText: s(item.shareText),
    disease: type === 'disease' ? item.id : '', vaccine: type === 'vaccine' ? item.id : '',
    mediaType: s(item.mediaType), youtube: s(item.youtubeId), producedAt: s(item.producedAt), versionLabel: s(item.basedOnVersionLabel), chapters: (item.chapters ?? []).map((c) => `${c.t} ${c.label}`).join('\n'), transcript: s(item.transcriptMarkdown), captions: item.captions ?? [],
    topicKind: s(item.kind), startAt: s(item.startAt), endAt: s(item.endAt), links: pipeJoin(item.links, [(l) => l.label, (l) => l.href, (l) => l.note]), contentIds: item.contentIds ?? [],
    serviceType: s(item.serviceType), who: item.whoCanApply ?? [], steps: pipeJoin(item.steps, [(x) => x.title, (x) => x.text, (x) => x.who, (x) => x.days]), docs: (item.requiredDocuments ?? []).join('\n'), slaDays: s(item.slaDays), fee: s(item.fee), legal: (item.legalBasis ?? []).join('\n'),
    forms: pipeJoin(item.forms, [(f) => f.label, (f) => f.href, (f) => f.format]), applyUrl: type === 'service' ? s(item.applyUrl) : '', contact: s(item.contact),
    pubType: s(item.pubType), series: s(item.series), volume: s(item.volume), issue: s(item.issue), edition: s(item.edition), isbn: s(item.isbn), issn: s(item.issn), gpn: s(item.gpn), articles: pipeJoin(item.articles, [(a) => a.title, (a) => (a.authors ?? []).join('、'), (a) => a.pages]),
    labDisease: type === 'labtest' ? s(item.disease) : '', sendHours: s(item.sendWithinHours), labs: item.labs ?? [], specimens: pipeJoin(item.specimens, [(x) => x.name, (x) => x.container, (x) => x.volume, (x) => x.storage, (x) => x.transport, (x) => x.timing, (x) => (x.tests ?? []).join('、')]),
    year: s(item.year), projectStatus: s(item.projectStatus), fundingType: s(item.fundingType), projectNo: s(item.projectNo), piUnit: s(item.piUnit), datasets: item.datasets ?? [],
    deadlineAt: s(item.deadlineAt), refNo: s(item.refNo), newsApplyUrl: type === 'recruit' || type === 'procurement' ? s(item.applyUrl) : '', positions: s(item.positions), budgetNtd: s(item.budgetNtd),
  };
  return {
    type, id: item.id, idTouched: true, title: type === 'faq' ? item.question ?? item.title ?? '' : item.title ?? '', body: body ?? '',
    owner: item.owner, period: item.reviewPeriodMonths ?? '', audience: item.audience ?? ['public'], tasks: item.tasks ?? [], basedOn: item.basedOn ?? [], langs,
    publishAtLocal: '', urgent: false, extra,
  };
}

/** 表單匯出的 JSON ＋ 現行版 → 要寫回 repo 的 JSON（保留表單沒有的欄位；發布日不變） */
export function mergeEdit(out, original) {
  if (!original) return out;
  const o = { ...out };
  for (const [k, v] of Object.entries(original)) if (!API_ONLY_KEYS.has(k) && !(k in o)) o[k] = v;
  for (const k of ['vaccines', 'countries', 'diseases', 'basedOn', 'tasks', 'keywords']) if (Array.isArray(o[k]) && !o[k].length && !(k in original)) delete o[k]; // 表單固定輸出的空陣列，現行版沒有就不加
  if (original.publishedAt) o.publishedAt = original.publishedAt;
  if (original.aiWhitelist) o.aiWhitelist = original.aiWhitelist; // 修改不重新申請白名單；核准狀態由治理規則判定
  if (Array.isArray(original.assets) && !(out.assets?.length)) o.assets = original.assets.map(({ url, ...a }) => a); // 既有附件在 repo 裡，表單選不到檔，照舊宣告
  if (original.type === 'disease') {
    const sec = splitSections(out.blocks?.[0]?.markdown ?? '');
    o.blocks = (original.blocks ?? []).map((b) => { const md = sec.get(b.heading); if (!md || md === (b.markdown ?? '').trim()) return b; const { status, ...rest } = b; return { ...rest, markdown: md }; }); // 區塊其他欄位（warning、datasets…）原樣保留；填了內文的區塊去掉 pending
    o.slug = original.slug; o.nameEn = original.nameEn; o.legalCategory = original.legalCategory ?? o.legalCategory;
    if (original.keyFacts) o.keyFacts = original.keyFacts;
    if (original.notifyWithinHours != null) o.notifyWithinHours = original.notifyWithinHours;
  }
  if (original.type === 'vaccine') { o.slug = original.slug; o.nameEn = original.nameEn; if (Array.isArray(original.publicFunded)) o.publicFunded = original.publicFunded; }
  if (original.type === 'document' && !out.supersedes) o.supersedes = original.supersedes ?? null;
  return o;
}

/** 改了哪些欄位（給畫面與 PR 說明；Markdown 內文只報「內文」） */
export function editDiff(out, original) {
  if (!original) return [];
  const keys = new Set([...Object.keys(out), ...Object.keys(original).filter((k) => !API_ONLY_KEYS.has(k))]);
  const changed = [];
  for (const k of keys) {
    if (['reviewedAt', 'status', 'steward', 'keywords', 'summary', 'languages', 'structured', 'sensitivity'].includes(k)) continue;
    if (JSON.stringify(out[k] ?? null) !== JSON.stringify(original[k] ?? null)) changed.push(k);
  }
  return changed.sort();
}
