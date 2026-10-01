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
];
export const LANGS = [
  { code: 'zh-TW', label: '繁體中文' }, { code: 'en', label: 'English' }, { code: 'ja', label: '日本語' }, { code: 'tl', label: 'Tagalog' },
  { code: 'vi', label: 'Tiếng Việt' }, { code: 'id', label: 'Bahasa Indonesia' }, { code: 'th', label: 'ไทย' },
];
export const TASKS = [
  { key: 'symptoms', label: '有症狀怎麼辦' }, { key: 'vaccines', label: '疫苗與預防接種' }, { key: 'travel', label: '出國與入境' },
  { key: 'situation', label: '現在的疫情' }, { key: 'rumor', label: '謠言查證' }, { key: 'data', label: '開放資料與統計' },
];
export const REVIEW_PERIOD_DEFAULT = { disease: 12, vaccine: 6, faq: 6, news: 0, letter: 0, document: 12, clarification: 6 };
const SEVEN = ['zh-TW', 'en', 'ja', 'tl', 'vi', 'id', 'th'];
export const LANG_DEFAULT = { disease: SEVEN, vaccine: SEVEN, faq: SEVEN, clarification: SEVEN, letter: ['zh-TW', 'en'], news: ['zh-TW', 'en'], document: ['zh-TW', 'en'] };
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
    let m, prevEnd = -1;
    while ((m = SUFFIX.exec(seg))) {
      const end = m.index + m[1].length;
      if (m.index === prevEnd) continue; // 連續字尾（如「病症」）只取第一個
      prevEnd = end;
      let w = seg.slice(Math.max(0, m.index - 4), end);
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
  const diseaseIds = [...new Set([...(ctx.entities?.relatedDiseaseIds ?? ctx.entities?.diseaseIds ?? []), ...vaccineIds.flatMap((vid) => ctx.vaccinesMaster?.find((v) => v.id === vid)?.diseases ?? [])])];
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
  const myYears = [...text.matchAll(/(\d{4})\s*年(?:（含）|\(含\))?\s*(?:以後|之後|以前|之前)?\s*出生/g)].map((x) => x[1]);
  if (myYears.length) {
    const related = (ctx.documents ?? []).filter((d) => d.governance?.isCurrent !== false && ((d.diseases ?? []).some((x) => diseaseIds.includes(x)) || (d.vaccines ?? []).some((x) => vaccineIds.includes(x))));
    for (const d of related) {
      const docYears = new Set([...norm(`${d.machineReadableMarkdown ?? ''} ${d.summary ?? ''}`).matchAll(/(\d{4})\s*年(?:（含）|\(含\))?\s*(?:以後|之後|以前|之前)?\s*出生/g)].map((x) => x[1]));
      if (!docYears.size) continue;
      const bad = myYears.filter((y) => !docYears.has(y));
      if (bad.length) out.push({ level: 'error', title: '與現行版文件矛盾', message: `內文「${[...new Set(bad)].join('、')} 年（含）以後出生」與現行版《${d.title}》的「${[...docYears].join('、')} 年」不同 → 請改依現行版。` });
      else out.push({ level: 'ok', title: '出生年份一致', message: `「${[...new Set(myYears)].join('、')} 年」與現行版《${d.title}》一致。` });
    }
  }
  // 6. 停用詞
  for (const d of ctx.entities?.deprecated ?? []) out.push({ level: 'warn', title: '使用已停用的舊名', message: `內文含「${d.term}」（${d.count} 次）→ 請改用『${d.preferred}』。` });
  // 7. 反向稽核規則
  const scopeIds = new Set([...diseaseIds, ...(ctx.basedOn ?? []), ...vaccineIds]);
  for (const d of ctx.diseaseMaster ?? []) for (const rule of d.auditRules ?? []) {
    if (rule.scope?.length && !rule.scope.some((s) => scopeIds.has(s)) && !text.includes(d.name)) continue;
    try {
      const m = new RegExp(rule.pattern).exec(text);
      if (m) out.push({ level: 'error', title: '命中反向稽核規則', message: `內文出現「${m[0]}」：${rule.message}` });
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
    default: return `page.new-${h}`;
  }
}

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
    type: st.type,
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
  const typeNeed = { faq: ['question', 'answerMarkdown'], news: ['newsType', 'bodyMarkdown'], letter: ['newsType', 'bodyMarkdown'], clarification: ['claim', 'verdict', 'clarificationMarkdown', 'shareText'], document: ['family', 'docType', 'version', 'effectiveAt', 'machineReadableMarkdown'], disease: ['slug', 'nameEn', 'legalCategory', 'blocks', 'keyFacts'], vaccine: ['slug', 'nameEn', 'publicFunded', 'bodyMarkdown'] }[obj.type] ?? [];
  for (const k of typeNeed) if (obj[k] == null || obj[k] === '') miss.push(k);
  if (obj.summary && obj.summary.length > 120) miss.push('summary（建議 ≤ 120 字）');
  return miss;
}
