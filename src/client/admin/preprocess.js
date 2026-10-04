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
  return out;
}

/** 簡易必填檢查（正式驗證在 CI 的 JSON Schema）。 */
export function requiredCheck(obj, ownerIds = []) {
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
  return miss;
}
