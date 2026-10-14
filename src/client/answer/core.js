// 答案引擎核心：純函式、不碰 DOM、Node 與瀏覽器共用（eval/run-eval.mjs 以同一份程式跑評估集）。
//
// createEngine(deps).answer(query, { lang, view, disease }) → AnswerResult
//
// 流程（ARCHITECTURE.md 第 5.2 節）：
//   1 輸入防護：個資遮蔽 → 提示注入偵測
//   2 意圖判斷：可解釋規則集（INTENT_RULES，每條 id + 權重）
//   3 拒答邊界：REFUSAL_RULES（個人診斷、用藥劑量、法律、未發布、媒體、預測、注入、隱私…）
//   4 檢索：BM25（字元 bigram + 英文詞）＋ 詞彙主檔同義詞／別名／deprecated 展開 ＋ 詞典邊界（已知名詞只出現在別的更長名詞裡不算命中）＋ 實體加權 ＋ 任務加權；
//          民眾只取 whitelist、專業只取 isCurrent；輸出側再檢一次（失效版、逾期）並記 guards
//   5 組句（抽取式）：句子評分、去重、依意圖排序、每句 cite、completeness
//   6 統計問答：資料集 series（加總／最高／最低／平均），不推論不預測
//   7 謠言查證：bigram Jaccard ＋ 包含度比對澄清；outdated 來自治理引擎
//   8 多語：同語言 reviewed chunk 優先，否則中文 chunk ＋ translationNote
//   9 稽核編號 A-YYYYMMDD-XXXX、disclosure
//  10 暫停：aiStatus.paused → 傳統結果列表
//
// AnswerResult（主要欄位）
// { query, lang, view, intent, intentReasons[], intentScores{}, refused, refusal?{kind,ruleId,title,text,actions[],relatedDisease,related[]},
//   disease, diseases[], entities{diseases,vaccines,countries}, termNotes[], sentences[{text,cite[],n[],citeLabel?}],
//   sources[], situation?, stats?, verdict?, clarification?, shareText?, reportChannel?, actions[], related[], list?,
//   confidence, completeness{required,covered,missing,score}, guards[], translationNote?, paused?, auditId, mode, disclosure, retrieved[] }

// 第三十四輪（ARCHITECTURE 第 40 章）：規則表、斷詞、詞典、結構化資料拆到同目錄四個模組；本檔只留 createEngine。
// 下面的 re-export 讓既有呼叫端（render.js、llm.js、scripts/lib/*、tests）照舊從 core.js import，不必改。
import { CROSS_LANG, PARAPHRASE, annotationsOf, topicAnchorsOf, buildLexicon, isOutdated, latinStems, lc, matcherFor, ownerNameOf, tr, unwrap } from './lexicon.js';
import { ANTIVIRAL_RE, CAT_ZH, CLOSED_MARK, NOTICE_TYPES, SCHEDULE_VACCINE_RE, VAXMAP_GROUP_OF, VAXMAP_GROUP_OF_DISEASE, WHICH_VACCINE_RE, ageHashOf, ageProfileOf, hoursPhrase, matchSchedule, mmssOf, normTravel, normalizeNotifyTable, notifyHoursLabel, vaxmapHref } from './structured.js';
import { EN_STOP, VI_STOP, bigrams, detectInjection, maskPII, maskPIIDetailed, mdPlain, parseChineseNumber, parseTimeRange, rocDate, splitPlain, tokenize } from './text.js';
import { ADMIT_RE, CAREERS_DETAIL_RE, HISTORICAL_WEIGHT, LAB_PUBLIC_RE, MEDIA_CUE, NEWS_CUE, OPEN_CUE, PERSON, PROCUREMENT_CUE, PROCUREMENT_DETAIL_RE, PUB_CUE, QUERY_FACETS, QUERY_FUNC_RE, RECORD_RE, RECRUIT_CUE, REFUSAL_RULES, RELEVANCE, VAX_WHERE_RE, RESEARCH_CUE, TRAVEL_CHANGE_KINDS, TRAVEL_CHANGE_RE, classifyIntent, focusOf, isLowRelevance, refusalCopy, titleHits } from './rules.js';

// 第四十輪（issue #77）：補接種問句（漏打、錯過、延遲、忘了打、補打）。命中就不給年齡時程表，改由檢索找補接種 FAQ
// 第四十八輪（issue #94）：加「晚了兩個月才打」「延後接種」這類口語
export const CATCHUP_RE = /(漏打|漏接種|補打|補接種|錯過|延遲接種|晚打|晚了.{0,8}才打|延後(接種|打)|忘了打|忘記打|沒打到|重打|missed (?:a |the )?(?:dose|vaccin)|catch-?up)/i;

export { bigrams, detectInjection, maskPII, maskPIIDetailed, numbersByUnit, parseChineseNumber, parseTimeRange, pdfHref, rocDate, splitPlain, tokenize } from './text.js';
export { ADMIT_RE, INTENT_RULES, LAB_PRO_RE, LAB_PUBLIC_RE, PRO_SUB_INTENTS, REFUSAL_RULES, RELEVANCE, classifyIntent, isLowRelevance } from './rules.js';
export { CLOSED_MARK, NOTICE_TYPES, ageHashOf, ageProfileOf, matchSchedule, normalizeNotifyTable, notifyHoursLabel, vaxmapHref } from './structured.js';
export { buildLexicon } from './lexicon.js';
/** 相容舊名稱 */
export { REFUSAL_RULES as REFUSAL_PATTERNS } from './rules.js';


// ───────────────────────── createEngine ─────────────────────────

export function createEngine(rawDeps = {}) {
  const deps = Object.fromEntries(Object.entries(rawDeps).map(([k, v]) => [k, unwrap(v)]));
  const {
    index = [], indexPro = [], situation = null, clarifications = [], glossary = [], diseases = [], vaccines = [], countries = [],
    datasets = [], faq = [], units = [], aiStatus = {}, today, random = Math.random, now = () => new Date(), travel = [],
    services = [], notifyTable = null, media = [], schedule = [],
  } = deps;
  // 疫苗接種時程主檔（site.master.immunizationSchedule／v1/immunization-schedule.json）：跨疫苗年齡查詢用
  const scheduleItems = Array.isArray(schedule) ? schedule : [];
  // 第二輪 deps：services（申請頁 actions）、notifyTable（通報時限表，補病例定義與檢驗連結）、media（影片海報等，可選）
  const serviceById = new Map((Array.isArray(services) ? services : []).map((x) => [x.id, x]));
  const mediaById = new Map((Array.isArray(media) ? media : []).map((x) => [x.id, x]));
  const notifyRows = normalizeNotifyTable(notifyTable);
  const travelItems = (Array.isArray(travel) ? travel : []).map(normTravel).filter((t) => t.iso2 || t.name);

  // 詞彙主檔：別名／deprecated／各語言 → 正名；正名 → 全部別名
  const termToCanon = new Map(); const canonToAll = new Map(); const deprecatedTo = new Map();
  for (const g of glossary) {
    const canon = g['zh-TW']; if (!canon) continue;
    const all = new Set([canon, ...(g.aliases ?? []), ...(g.deprecated ?? []), g.en, g.ja, g.tl, g.vi, g.id_, g.th].filter(Boolean));
    canonToAll.set(canon, { zh: new Set([canon, ...(g.aliases ?? []), ...(g.deprecated ?? []), g.en].filter(Boolean)), byLang: { en: g.en, ja: g.ja, tl: g.tl, vi: g.vi, id: g.id_, th: g.th } });
    for (const a of all) if (String(a).length >= 2) termToCanon.set(lc(a), canon);
    for (const d of g.deprecated ?? []) deprecatedTo.set(d, canon);
  }

  // 實體：疾病、疫苗、國家（名稱、別名、英文名；詞彙主檔 refs 也算）
  const entityMatchers = [];
  const addEntity = (kind, id, name) => { const re = matcherFor(name); if (re) entityMatchers.push({ kind, id, name: String(name), re }); };
  const diseaseById = new Map();
  for (const d of diseases) {
    diseaseById.set(d.id, d);
    for (const n of [d.name, ...(d.aliases ?? []), d.nameEn]) addEntity('disease', d.id, n);
  }
  for (const g of glossary) for (const ref of g.refs ?? []) {
    if (!String(ref).startsWith('disease.')) continue;
    for (const n of [g['zh-TW'], ...(g.aliases ?? []), ...(g.deprecated ?? []), g.en, g.vi, g.ja, g.th, g.id_, g.tl]) addEntity('disease', ref, n);
  }
  for (const v of vaccines) for (const n of [v.name, v.title, ...(v.aliases ?? []), v.nameEn, v.slug && v.slug.length <= 5 ? v.slug.toUpperCase() : null]) addEntity('vaccine', v.id, n);
  for (const c of countries) for (const n of [c.name, c.nameEn, ...(c.aliases ?? [])]) addEntity('country', c.iso2 ?? c.id, n);
  // 第四十一輪：COVID-19 → 詞幹 COVID 也當別名（先實體、後同義詞展開；實體那輪判定有歧義的詞幹，展開那輪也跳過。規則與「為什麼」見 lexicon.js latinStems）
  const knownNames = new Set([...termToCanon.keys(), ...entityMatchers.map((m) => lc(m.name))]);
  for (const [s, k] of latinStems(entityMatchers.map((m) => [m.name, `${m.kind}\t${m.id}`]), knownNames)) addEntity(...k.split('\t'), s);
  for (const [s, canon] of latinStems([...termToCanon], knownNames)) termToCanon.set(s, canon);
  entityMatchers.sort((a, b) => b.name.length - a.name.length);
  const termMatchers = [...termToCanon.entries()].map(([alias, canon]) => ({ alias, canon, re: matcherFor(alias) })).filter((x) => x.re).sort((a, b) => b.alias.length - a.alias.length);

  const lex = buildLexicon({ diseases, glossary, vaccines, units });
  const { phrasesIn: lexiconPhrasesIn, falseTokensFor, chunkHay } = lex;

  // 第四十八輪（issue #94）：中文主題錨點。內容的 keywords（index-builder 放進 chunk.terms）裡，只屬於少數幾則內容（≤ ANCHOR_MAX）、
  // 全站也只有這幾則提到的詞（呼吸道融合病毒、鼬獾、餵母乳、漏打）就是那個主題的「名字」：問句含這個詞時，
  // 那幾則內容是優先候選（檢索加權、不受「問 A 病不拿 B 病」排除、相關度斷詞以它為詞界、不改走年齡時程表）。
  // 為什麼不寫死問句→答案：錨點完全由內容的 keywords 推得，承辦人加一個關鍵字就生效；「預防」「症狀」這類到處都有的詞因為出現的內容太多，自動不算錨點。
  const ANCHOR_MAX = 3;
  const zhPub = index.filter((c) => (c.lang ?? 'zh-TW') === 'zh-TW' && c.whitelist !== false);
  const termIds = new Map();
  // 只收「答案單元」（FAQ、疾病頁、疫苗頁、申請服務、專區）的關鍵字：影片逐字稿、新聞、期刊的關鍵字不讓它們搶到優先
  for (const c of zhPub) if (/^(faq|disease|vaccine|service|topic)$/.test(c.type)) for (const t of c.terms ?? []) { const k = lc(t).trim(); if (k.length > 1 && !/^[\d\s]+$/.test(k)) (termIds.get(k) ?? termIds.set(k, new Set()).get(k)).add(c.contentId); }
  const hays = new WeakMap();
  const hayOf = (c) => { let h = hays.get(c); if (h == null) hays.set(c, (h = chunkHay(c))); return h; };
  function zhAnchors(q) {
    const lq = lc(q); const out = [];
    for (const [t, ids] of termIds) {
      if (ids.size > ANCHOR_MAX || !lq.includes(t) || !lex.wholeHit(lq, t)) continue;
      const seen = new Set(); for (const c of zhPub) if (hayOf(c).includes(t)) seen.add(c.contentId);
      if (seen.size <= ANCHOR_MAX) out.push({ t, ids });
    }
    return out.filter((a) => !out.some((b) => b.t.length > a.t.length && b.t.includes(a.t)));
  }

  function detectEntities(q) {
    const found = { diseases: [], vaccines: [], countries: [] };
    const taken = [];
    for (const m of entityMatchers) {
      const hit = q.match(m.re); if (!hit) continue;
      const start = hit.index, end = hit.index + hit[0].length;
      if (taken.some(([s, e]) => start < e && end > s && !(m.kind === 'vaccine'))) continue; // 疾病名不重疊計
      const list = found[`${m.kind === 'country' ? 'countrie' : m.kind}s`];
      if (!list.some((x) => x.id === m.id)) list.push({ id: m.id, name: m.name, pos: start });
      if (m.kind !== 'vaccine') taken.push([start, end]);
    }
    for (const k of Object.keys(found)) found[k].sort((a, b) => a.pos - b.pos);
    // 「流感疫苗」：疫苗實體也帶出對應疾病
    for (const v of found.vaccines) {
      const vac = vaccines.find((x) => x.id === v.id);
      for (const did of vac?.diseases ?? []) if (!found.diseases.some((x) => x.id === did)) found.diseases.push({ id: did, name: diseaseById.get(did)?.name ?? did, pos: v.pos });
    }
    return found;
  }
  function detectDisease(q) { const e = detectEntities(q); return diseaseById.get(e.diseases[0]?.id) ?? null; }

  /** 同義詞展開：回傳 { text, added[], notes[] }（notes：deprecated 詞的正名提示） */
  function expandQuery(q, lang = 'zh-TW') {
    const added = new Set(); const notes = [];
    for (const t of termMatchers) {
      if (!t.re.test(q)) continue;
      if (!lex.expandable(q, t.alias)) continue; // 第三十一輪：「急性傳染病組」裡的「性傳染病」不是在問性病
      const forms = canonToAll.get(t.canon);
      const wanted = forms ? [...forms.zh, ...(lang !== 'zh-TW' && forms.byLang[lang] ? [forms.byLang[lang]] : [])] : [t.canon];
      for (const a of wanted) if (!lc(q).includes(lc(a))) added.add(a);
      for (const [dep, canon] of deprecatedTo) if (lc(dep) === t.alias && !notes.some((n) => n.from === dep)) notes.push({ from: dep, to: canon });
    }
    for (const [re, zh] of PARAPHRASE) if (re.test(q)) for (const w of zh.split(' ')) if (!q.includes(w)) added.add(w);
    if (lang !== 'zh-TW' || !/[一-鿿]/.test(q)) for (const [re, zh] of CROSS_LANG) if (re.test(q)) for (const w of zh.split(' ')) added.add(w);
    return { text: [q, ...added].join(' '), added: [...added], notes };
  }

  // ── BM25 ──
  const bm25Cache = new Map();
  function bm25For(key, chunks) {
    if (bm25Cache.has(key)) return bm25Cache.get(key);
    const docs = chunks.map((c) => {
      const toks = [...tokenize(c.title), ...tokenize(c.title), ...tokenize(c.text), ...tokenize((c.terms ?? []).join(' '))];
      const tf = new Map(); for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1);
      return { c, tf, len: toks.length };
    });
    const df = new Map(); for (const d of docs) for (const t of d.tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
    const N = docs.length || 1;
    const avgdl = docs.reduce((s, d) => s + d.len, 0) / N || 1;
    const idf = (t) => { const n = df.get(t) ?? 0; return Math.log(1 + (N - n + 0.5) / (n + 0.5)); };
    const model = { docs, idf, avgdl, N, has: (t) => df.has(t) };
    bm25Cache.set(key, model);
    return model;
  }
  function bm25Score(model, d, qWeights, k1 = 1.5, b = 0.75) {
    let s = 0;
    for (const [t, w] of qWeights) {
      const f = d.tf.get(t); if (!f) continue;
      s += w * model.idf(t) * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.len) / model.avgdl)));
    }
    return s;
  }
  /** 實體名稱與其別名的 token（實體加權已處理，BM25 端降權，避免同病所有片段分數一樣高） */
  function entityTokens(entities) {
    const names = new Set();
    for (const d of entities?.diseases ?? []) {
      const dz = diseaseById.get(d.id);
      for (const n of [d.name, dz?.name, ...(dz?.aliases ?? []), dz?.nameEn]) if (n) names.add(n);
      for (const g of glossary) if ((g.refs ?? []).includes(d.id)) for (const n of [g['zh-TW'], ...(g.aliases ?? []), ...(g.deprecated ?? []), g.en]) if (n) names.add(n);
    }
    const span = [...(entities?.diseases ?? []), ...(entities?.vaccines ?? [])].filter((x) => !x.derived && !x.preset).map((x) => x.name);
    return { toks: new Set(tokenize([...names].join(' '))), spanToks: new Set(tokenize(span.join(' '))), names: new Set([...names].map(lc)) };
  }
  function queryWeights(q, expanded, ent = null) {
    const w = new Map();
    const et = ent?.toks ?? new Set();
    const st = ent?.spanToks ?? new Set();
    for (const t of tokenize(q, { query: true })) w.set(t, st.has(t) ? 0.25 : 1);
    for (const t of tokenize(expanded.added.join(' '), { query: true })) if (!w.has(t)) w.set(t, et.has(t) ? 0.1 : 0.7);
    return w;
  }

  const MACHINE_TEXT_WEIGHT = 0.7;
  // 第四十輪（issue #78）：影片逐字稿是旁白口語（「旁白：今年公費流感疫苗自 10 月 1 日起開打」），同一件事正本（FAQ、疫苗頁）多半寫得更完整；
  // 問句沒說要影片時，逐字稿片段（index-builder 標 role: 'narration'）降到 0.6（原本所有影片 0.85），只有正本沒講到時才會被引用。
  const NARRATION_WEIGHT = 0.6;
  // 第四十輪（issue #78）：澄清稿（clarification 型別與 newsType 'clarification' 的新聞稿）不是在問謠言時一律 0.5——
  // 澄清稿的用途是駁斥某則謠言，拿來回答一般問句（懷孕能不能打流感疫苗）容易答偏。
  const CLARIFICATION_WEIGHT = 0.5;
  /**
   * 第四十輪（issue #75）：抽取句的最低資訊量。句子太短（「They should check.」）脫離上下文就沒有意義，被抽出來會誤導。
   *   拉丁字母語言：至少 MIN_INFO.latinWords 個詞，且非功能詞（不在 EN_STOP／VI_STOP、長度 ≥ 3）至少 MIN_INFO.contentWords 個；
   *   中日文：去掉標點、空白後至少 MIN_INFO.cjkChars 個字；泰文（無空白）至少 MIN_INFO.thaiChars 個字。
   * 只用在檢索抽句（composeSentences）；結構化句（態勢、時程、旅遊等級、申請步驟）是欄位串接，不受此限。
   */
  const MIN_INFO = { latinWords: 4, contentWords: 2, cjkChars: 6, thaiChars: 10 };
  function informative(sen) {
    const t = String(sen ?? '').normalize('NFKC');
    if (/[\u3040-\u30ff\u3400-\u9fff]/.test(t)) return t.replace(/[\s\p{P}\p{S}]/gu, '').length >= MIN_INFO.cjkChars;
    if (/[\u0e00-\u0e7f]/.test(t)) return t.replace(/[\s\p{P}\p{S}]/gu, '').length >= MIN_INFO.thaiChars;
    const words = t.toLowerCase().match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? [];
    const content = words.filter((w) => (w.length >= 3 || /\d/.test(w)) && !EN_STOP.has(w) && !VI_STOP.has(w));
    return words.length >= MIN_INFO.latinWords && content.length >= MIN_INFO.contentWords;
  }
  const INTENT_TASK = { symptoms: 'symptoms', vaccine: 'vaccines', travel: 'travel', situation: 'situation', rumor: 'rumor', stats: 'data' };

  function poolFor(view, lang) {
    const base = view === 'pro' ? (indexPro.length ? indexPro : index) : index;
    const inLang = (c) => (c.lang ?? 'zh-TW') === lang;
    const allowed = base.filter((c) => (view === 'pro' ? c.isCurrent !== false : c.whitelist !== false));
    return { key: `${view}:${lang}`, chunks: allowed.filter(inLang) };
  }

  /**
   * 檢索：回傳 [{...chunk, _score}]（新物件，不改索引）。
   * opts：{ view, lang, k, intent, entities, presetDisease, guards }
   */
  function retrieve(q, opts = {}) {
    const { view = 'public', lang = 'zh-TW', k = 6, intent = 'unknown', guards = [], minRel = 0.3 } = opts;
    const entities = opts.entities ?? detectEntities(q);
    const expanded = opts.expanded ?? expandQuery(q, lang);
    const pool = poolFor(view, lang);
    if (!pool.chunks.length) return [];
    const model = bm25For(pool.key, pool.chunks);
    const ent = entityTokens(entities);
    const qw = queryWeights(q, expanded, ent);
    if (!qw.size) return [];
    const dIds = new Set(entities.diseases.map((d) => d.id)); if (opts.presetDisease) dIds.add(opts.presetDisease);
    const vIds = new Set(entities.vaccines.map((v) => v.id));
    const cIds = new Set(entities.countries.map((c) => c.id));
    const aIds = opts.anchorIds ?? new Set();
    const task = INTENT_TASK[intent];
    const qLower = lc(expanded.text);
    const wantOpen = OPEN_CUE.test(q);
    const noticeType = RECRUIT_CUE.test(q) && !PROCUREMENT_CUE.test(q) ? 'recruit' : PROCUREMENT_CUE.test(q) && !RECRUIT_CUE.test(q) ? 'procurement' : null;
    const labPublic = view !== 'pro' && LAB_PUBLIC_RE.test(q);
    const phrases = lexiconPhrasesIn(q);
    const boundaryPhrases = phrases.filter((p) => p.supers.length);
    const scored = [];
    for (const d of model.docs) {
      let s = bm25Score(model, d, qw);
      if (s <= 0) continue;
      const c = d.c;
      let falseToks = null;
      if (boundaryPhrases.length) {
        falseToks = falseTokensFor(c, boundaryPhrases);
        if (falseToks.size) {
          const qw2 = new Map([...qw].filter(([t]) => !falseToks.has(t)));
          s = bm25Score(model, d, qw2);
          if (s <= 0) { guards.push({ kind: 'boundary-dropped', id: c.id }); continue; }
        }
      }
      for (const t of c.terms ?? []) if (t && String(t).length >= 2 && !ent.names.has(lc(t)) && qLower.includes(lc(t))) s += 0.6;
      const anc = aIds.has(c.contentId);
      if (dIds.size) {
        if ((c.diseases ?? []).some((x) => dIds.has(x))) s = s * 1.6 + 2;
        // 問的是 A 病，不拿 B 病的內容回答。第四十八輪例外：主題錨點命中、且題目沒點名任何疾病的 FAQ（「懷孕或哺乳期間可以打疫苗嗎」標了流感只因內文舉例）
        //（題目點名疾病的 FAQ 仍排除：「腸病毒停課標準」不拿來回答「流感停課」）
        else if ((c.diseases ?? []).length && !(anc && c.type === 'faq' && !detectEntities(c.question ?? c.title).diseases.length)) continue;
        else s *= 0.6;
      }
      if (anc) s = s * 1.5 + 3;
      if (vIds.size && (c.vaccines ?? []).some((x) => vIds.has(x))) s = s * 1.3 + 1;
      if (cIds.size) {
        if ((c.countries ?? []).some((x) => cIds.has(x))) s = s * 1.3 + 1;
        else if ((c.countries ?? []).length) continue; // 問泰國，不拿日本的內容回答
      }
      if (task && (c.tasks ?? []).includes(task)) s *= 1.15;
      if (view === 'pro' && (c.type === 'document' || c.type === 'letter')) s *= 1.3;
      // 第十九輪：PDF 機器轉出、尚未校對的段落排在已審內容之後（只有它講到時才會被引用；來源卡另標「以 PDF 為準」）
      if (c.extraction?.reviewStatus === 'machine') s *= MACHINE_TEXT_WEIGHT;
      if (intent !== 'rumor' && (c.type === 'clarification' || c.newsType === 'clarification')) s *= CLARIFICATION_WEIGHT;
      // 第二輪：意圖 → 型別加權；問句線索（影片、哪一期）→ 型別加權
      if ((intent === 'apply' || intent === 'notify') && c.type === 'service') s = s * 1.8 + 2;
      if (intent === 'lab' && c.type === 'labtest') s = s * 1.8 + 2;
      if (intent === 'notice') {
        if (NOTICE_TYPES.includes(c.newsType)) s = s * 2 + 2; else s *= 0.4;
        if (noticeType && NOTICE_TYPES.includes(c.newsType) && c.newsType !== noticeType) s *= 0.3; // 問職缺不拿標案
        if (NOTICE_TYPES.includes(c.newsType) && !closedNow(c)) s *= 1.2; // 進行中優先
        if (wantOpen && closedNow(c)) { guards.push({ kind: 'closed-dropped', id: c.id }); continue; }
      }
      // 第七輪：careers → 職缺、procurement → 標案；問「現在／開放」不拿已截止
      if (intent === 'careers' || intent === 'procurement') {
        const want = intent === 'careers' ? 'job' : 'tender';
        if (c.type === want) s = s * 2 + 2; else s *= 0.4;
        if (c.type === want && !closedNow(c)) s *= 1.2;
        if (wantOpen && c.type === want && closedNow(c)) { guards.push({ kind: 'closed-dropped', id: c.id }); continue; }
      }
      if (c.type === 'media') s = MEDIA_CUE.test(q) ? s * 1.6 + 1.5 : s * (c.role === 'narration' ? NARRATION_WEIGHT : 0.85);
      if (c.type === 'publication' && PUB_CUE.test(q)) s = s * 1.6 + 1.5;
      // 第三十三輪：歷史新聞稿降權（§39.4）
      if (c.historical && !NEWS_CUE.test(q)) s *= HISTORICAL_WEIGHT;
      if (c.type === 'research' && RESEARCH_CUE.test(q)) s = s * 1.6 + 1.5;
      if (labPublic && c.block === 'treatment') s = s * 1.5 + 1;
      scored.push({ ...c, _score: Math.round(s * 1000) / 1000, ...(falseToks?.size ? { _falseTokens: falseToks } : {}), ...(anc ? { _anchor: true } : {}) });
    }
    scored.sort((a, b) => b._score - a._score);
    const top = scored[0]?._score ?? 0;
    const out = [];
    for (const c of scored) {
      if (c._score < 1 || c._score < top * minRel) break;
      // 輸出側防護：失效版本、逾期內容不得被引用（索引已排除，這裡是第二道）
      if (c.isCurrent === false) { guards.push({ kind: 'superseded-dropped', id: c.id }); continue; }
      if (today && c.nextReviewAt && c.nextReviewAt < today) { guards.push({ kind: 'overdue-dropped', id: c.id }); continue; }
      out.push(c);
      if (out.length >= k) break;
    }
    out.qWeights = qw; out.model = model; out.phrases = phrases;
    return out;
  }

  /**
   * 相關度：{ relevance 0–1, coverage, top, matchedIdf, reason }。reason 非 null ⇒ 應拒答（no-match）。
   * 涵蓋率＝問句有效詞（功能詞已剔除、單字不計；不在語料的詞以最大 IDF 計，視為未命中）被前 3 個片段的「標題＋內文＋術語」涵蓋的 IDF 加權比例。
   */
  function relevanceOf(q, chunks, model, hasEntity = false, anchors = []) {
    const top = chunks[0]?._score ?? 0;
    // 第三十一輪：跨過詞界的假 bigram（「性病症狀」裡的「病症」）不列入涵蓋率分母——只保留「原句斷詞」與「詞典斷詞」都有的 token
    // 第四十八輪（issue #94）：主題錨點也當詞界（「被鼬獾咬」→「被 鼬獾 咬」，不再有「被鼬」「獾咬」兩個假詞拉低涵蓋率）
    const segToks = new Set(tokenize(lex.segment(anchors.reduce((x, a) => x.split(a.t).join(` ${a.t} `), lc(q))).replace(QUERY_FUNC_RE, ' '), { query: true }));
    const toks = [...new Set(tokenize(String(q).replace(QUERY_FUNC_RE, ' '), { query: true }))].filter((t) => (t.length >= 2 || /[a-z0-9]/.test(t)) && segToks.has(t));
    if (!chunks.length) return { relevance: 0, coverage: 0, top, matchedIdf: 0, reason: 'no-chunk', tokens: toks };
    const have = new Set(); for (const c of chunks.slice(0, 3)) for (const t of tokenize(`${c.title} ${c.text} ${(c.terms ?? []).join(' ')}`)) if (!c._falseTokens?.has(t)) have.add(t);
    // 第三十一輪：問句用的是別名（性病），片段用的是正名（性傳染病）⇒ 同義詞的任一形式出現就算涵蓋
    for (const p of chunks.phrases ?? []) if (p.forms.length && chunks.slice(0, 3).some((c) => { const h = chunkHay(c); return p.forms.some((f) => h.includes(f)); })) for (const t of p.tokens) have.add(t);
    let tot = 0, cov = 0, matchedIdf = 0;
    for (const t of toks) { const idf = model.idf(t); tot += idf; if (have.has(t)) { cov += idf; matchedIdf = Math.max(matchedIdf, idf); } }
    const coverage = tot ? cov / tot : 0;
    const relevance = Math.round(Math.max(0, Math.min(1, 0.65 * coverage + 0.35 * Math.min(1, top / 12))) * 100) / 100;
    // BM25 的 IDF 隨語料大小變動：索引遠小於正式站時（單元測試的迷你站台）按比例縮小絕對分數門檻
    const maxIdf = model.idf('\u0000'); // 不在語料的詞的 IDF ＝ 最大值
    const scale = Math.min(1, Math.log(1 + model.N) / Math.log(1 + RELEVANCE.refChunks));
    let reason = null;
    if (!toks.length) reason = 'no-terms';
    else if (top < RELEVANCE.hardMinTop * scale || (top < RELEVANCE.minTop * scale && coverage < RELEVANCE.highCoverage)) reason = 'low-score';
    else if (coverage < (hasEntity ? RELEVANCE.minCoverageEntity : RELEVANCE.minCoverage)) reason = 'low-coverage';
    else if (!hasEntity && matchedIdf / maxIdf < RELEVANCE.minMatchedIdf && coverage < RELEVANCE.genericMaxCoverage) reason = 'generic-only';
    return { relevance, coverage: Math.round(coverage * 100) / 100, top, matchedIdf: Math.round(matchedIdf * 100) / 100, reason, tokens: toks };
  }

  // ── 組句 ──
  const SLOT_CUES = {
    symptoms: [/(就醫|看醫生|回診|急診|立即|儘速|小時內|告知醫師|see a doctor|within 24 hours|seek)/i, /(症狀|發燒|出疹|紅疹|頭痛|嘔吐|腹痛|出血|嗜睡|徵象|symptom|fever|rash)/i],
    vaccine: [/(出生|歲|對象|成人|幼兒|長者|孕婦|醫護|族群|以上|以下|不具.{0,4}免疫|born|adults?|aged|eligible)/i, /(劑|週|個月|時程|間隔|接種第|前往|出國前|dose|weeks?)/i],
    travel: [/(等級|警示|注意|警告|第[一二三]級|level|alert|warning)/i, /(疫苗|接種|MMR|vaccin)/i, /(行前|出國前|返國|入境|旅遊史|回國)/],
    situation: [/(\d+(\.\d+)?\s*%|例|就診率|上升|下降|高峰|流行閾值|人次)/, /(建議|請|儘速|呼籲|提醒|注意)/],
    professional: [/(第\s*\d+\s*條|應於|通報|送驗|檢體|定義|時限|小時內)/, /(版|生效|修訂)/],
    apply: [/(第\s*\d+\s*步|步驟|申請對象|線上申請|填寫|送件|臨櫃)/, /(申請需準備|文件|證件|護照|身分證|表單)/, /(處理天數|\d+\s*天|費用|元|免費|法源)/],
    lab: [/(容器|管|mL|ml|毫升|保存|運送|°C|冷藏|冷凍)/, /(送驗時限|小時|週轉|檢驗單位|可做)/],
    notice: [/(截止|報名|投標)/, /(名額|預算|字號)/],
    careers: [/(報名期間|截止|名額)/, /(資格|工作內容|應備文件|甄試|薪資)/],
    procurement: [/(投標截止|開標|決標)/, /(案號|預算)/],
  };
  const REQUIRED_POINTS = {
    symptoms: [{ key: 'seek-care', label: '就醫時機', re: /(就醫|看醫生|回診|急診|立即|see a doctor|seek|119)/i }],
    vaccine: [{ key: 'who', label: '接種對象', re: /(出生|歲|對象|成人|幼兒|長者|族群|者|born|adults?|eligible|aged)/i }],
    travel: [{ key: 'before-travel', label: '行前準備', re: /(出國|行前|旅遊|返國|入境|前往|travel|before)/i }],
    situation: [{ key: 'status', label: '態勢狀態', re: /(態勢|高峰|上升|下降|平穩|流行|就診率|%)/ }],
    professional: [{ key: 'rule', label: '條文或時限', re: /(第\s*\d+\s*條|應於|小時|日內|定義|送驗|檢體|對象)/ }],
    apply: [{ key: 'how', label: '申請方式', re: /(第\s*\d+\s*步|申請|填寫|線上|送件|臨櫃|向)/ }],
    lab: [{ key: 'specimen', label: '檢體與容器', re: /(檢體|容器|血清|拭子|管|痰)/ }],
    notice: [{ key: 'deadline', label: '截止日', re: /截止/ }],
    careers: [{ key: 'job', label: '職缺資訊', re: /(報名期間|資格|工作內容|應備文件|甄試|薪資|名額)/ }],
    procurement: [{ key: 'tender', label: '標案資訊', re: /(案號|投標截止|標的|決標|預算)/ }],
  };
  // 第四十八輪（issue #96）：句首是連接詞／承上指稱詞（但、不過、因此、此時、其中…；However、But、Also…）＝依附上一句的句子
  const CONNECTIVE_RE = /^(但是?|不過|然而|另外|此外|因此|所以|此時|這時候?|其中)|^(however|but|also|therefore|thus|in this case)\b/i;
  const PERSONAL_ADVICE_RE = /(你應該(服用|吃|使用)|建議你(吃|服用|使用)|你可以(吃|服用).{0,6}藥|你(就是|應該是|可能是|一定是)(得了|感染)|you should take|you (definitely|probably) have)/i;

  function slotOf(intent, text) {
    const cues = SLOT_CUES[intent]; if (!cues) return 9;
    for (let i = 0; i < cues.length; i++) if (cues[i].test(text)) return i;
    return cues.length;
  }

  function composeSentences(q, chunks, intent, view, guards) {
    if (!chunks.length) return [];
    const model = chunks.model; const qw = chunks.qWeights;
    const qIdfSum = [...qw.entries()].filter(([t]) => model.has(t)).reduce((s, [t, w]) => s + w * model.idf(t), 0) || 1;
    const top = chunks[0]._score || 1;
    const neToks = [...qw.entries()].filter(([t, w]) => w >= 0.5 && model.has(t)).map(([t]) => t);
    const cands = [];
    // 問「在哪裡打」時，講接種地點的句子本身就是答案；它常常不含問句的詞（Government-funded vaccination … at health centres），
    // 下方「句子要命中問句詞」的篩選會把它擋掉 ⇒ 前 3 塊片段裡的地點句免篩（合併第四十輪各分支後補，FG001）
    const whereReq = requiredFor(intent, q).find((r) => r.key === 'where');
    chunks.forEach((c, ci) => {
      // 以「：」結尾的引言句與其後清單項目合併為一個單位（仍是原文連續片段）
      const units = [];
      const ss = c.sentences ?? [];
      // 第四十輪（issue #78）：noCite＝只供檢索、不可當答案句的句子索引（澄清稿裡轉述的謠言原文；index-builder 標記）
      const noCite = new Set(c.noCite ?? []);
      for (let i = 0; i < ss.length; i++) {
        let u = ss[i]; const from = i;
        if (/[：:]$/.test(u)) { let j = i + 1; while (j < ss.length && j <= i + 4 && (u.length + ss[j].length) <= 180) { u += ` ${ss[j]}`; j++; } i = j - 1; }
        let quoted = false; for (let x = from; x <= i; x++) if (noCite.has(x)) quoted = true;
        if (quoted) { guards.push({ kind: 'claim-dropped', id: c.id }); continue; }
        if (!informative(u)) { guards.push({ kind: 'uninformative-dropped', id: c.id, text: u.slice(0, 40) }); continue; }
        units.push({ u, from, to: i });
      }
      const titleToks = new Set(tokenize(c.title));
      let covTitle = 0; for (const [t, w] of qw) if (titleToks.has(t) && model.has(t)) covTitle += w * model.idf(t);
      covTitle /= qIdfSum;
      units.forEach(({ u: sen, from, to }, si) => {
        const toks = new Set(tokenize(sen));
        let cov = 0; for (const [t, w] of qw) if (toks.has(t)) cov += w * model.idf(t);
        cov /= qIdfSum;
        let s = 3 * cov + 0.8 * covTitle + 1.2 * (c._score / top);
        if (/\d/.test(sen)) s += 0.3;
        if (/(\d+\s*(小時|天|日|週|個月|歲|年|劑)|within|hours|days)/.test(sen)) s += 0.3;
        const slot = slotOf(intent, sen);
        if (slot === 0) s += 0.6; else if (slot === 1) s += 0.3;
        if (sen.length > (sen.includes('： ') ? 200 : 140)) s -= 0.6; else if (sen.length < 10) s -= 0.6;
        if (si === 0 && c.type === 'faq') s += 0.3;
        if (c._anchor) s += 0.8; // 第四十八輪（issue #94）：主題錨點命中的內容，句子也優先
        if (view === 'pro' && (c.type === 'document' || c.type === 'letter')) s += 0.5;
        if (c.extraction?.reviewStatus === 'machine') s -= 0.6; // 未校對的 PDF 文字：同樣講到時讓已審內容先
        const whereHit = !!whereReq && ci < 3 && whereReq.re.test(sen);
        if (whereHit) s += 0.6;
        if (cov <= 0.05 && covTitle < 0.3 && !(ci === 0 && si === 0) && !whereHit) return;
        // 問句除了病名還有其他關鍵詞時，句子（或其片段標題）至少要命中一個，避免「只因為同一種病」被選入
        if (neToks.length && !neToks.some((t) => toks.has(t) || titleToks.has(t)) && !(ci === 0 && si === 0) && !whereHit) return;
        cands.push({ text: sen, cite: [c.id], score: s, slot, chunk: c, from, to, dep: CONNECTIVE_RE.test(sen) });
      });
    });
    cands.sort((a, b) => b.score - a.score);
    const allCands = [...cands];
    const topCand = cands[0]?.score ?? 0;
    for (let i = cands.length - 1; i > 0; i--) if (cands[i].score < topCand * 0.45) cands.splice(i, 1);
    const max = view === 'pro' ? 4 : 3;
    const picked = [];
    // 數字不同的兩句不是同義句（例：不同公告的字號、名額），不合併引用
    const nums = (t) => (String(t).match(/\d+/g) ?? []).join(',');
    const similar = (a, b) => { if (nums(a) !== nums(b)) return 0; const A = new Set(bigrams(a)), B = new Set(bigrams(b)); let n = 0; for (const x of A) if (B.has(x)) n++; return n / Math.max(1, Math.min(A.size, B.size)); };
    // 多樣性：同一片段每多選一句，後續句子減分（避免整段只引一個來源）
    const perChunk = new Map();
    const queue = [...cands];
    const nextCand = () => {
      let bi = -1, bs = -Infinity;
      queue.forEach((c, i) => { const eff = c.score - 0.6 * (perChunk.get(c.chunk.id) ?? 0) - 0.4 * (perChunk.get(c.chunk.contentId) ?? 0); if (eff > bs) { bs = eff; bi = i; } });
      return bi < 0 ? null : queue.splice(bi, 1)[0];
    };
    for (let c = nextCand(); c; c = nextCand()) {
      if (PERSONAL_ADVICE_RE.test(c.text)) { guards.push({ kind: 'medical-advice-dropped', text: c.text.slice(0, 40) }); continue; }
      // 第四十八輪（issue #96）：以連接詞開頭的句子（但、不過、因此、此外…）離開上一句就不知道在說什麼。
      // 上一句（同片段、緊鄰）已選入 ⇒ 接在它後面（原文本來就連在一起，grounding 照樣比得到）；否則不選
      if (c.dep) {
        const prev = picked.find((p) => p.chunk === c.chunk && p.to === c.from - 1);
        if (prev) { prev.text += ` ${c.text}`; prev.to = c.to; } else guards.push({ kind: 'dangling-connective-dropped', id: c.chunk.id, text: c.text.slice(0, 40) });
        continue;
      }
      const dup = picked.find((p) => similar(p.text, c.text) > 0.7);
      if (dup) {
        // 專業模式：同義句以正本文件原文為準、文件引用排第一
        if (view === 'pro' && c.chunk.type === 'document' && dup.chunk.type !== 'document') { dup.text = c.text; dup.chunk = c.chunk; dup.cite = [c.cite[0], ...dup.cite.filter((x) => x !== c.cite[0])].slice(0, 2); continue; }
        if (!dup.cite.includes(c.cite[0]) && dup.cite.length < 2) dup.cite.push(c.cite[0]);
        continue;
      }
      picked.push({ ...c, cite: [...c.cite] });
      perChunk.set(c.chunk.id, (perChunk.get(c.chunk.id) ?? 0) + 1);
      perChunk.set(c.chunk.contentId, (perChunk.get(c.chunk.contentId) ?? 0) + 1);
      if (picked.length >= max) break;
    }
    // completeness：意圖必要要點（＋問句線索要點）缺漏時，從候選補入
    const req = requiredFor(intent, q);
    for (const r of req) {
      if (picked.some((p) => r.re.test(p.text))) continue;
      const add = allCands.find((c) => !c.dep && r.re.test(c.text) && !picked.some((p) => p.text === c.text) && !PERSONAL_ADVICE_RE.test(c.text) && c.score > 1);
      if (add) { if (picked.length >= max) picked.pop(); picked.push({ ...add, cite: [...add.cite] }); }
    }
    // 問地點時，講地點的句子排第一（它才是答案；其餘是補充）
    const where = req.find((r) => r.key === 'where');
    if (where) for (const p of picked) if (where.re.test(p.text)) p.slot = -1;
    // 第四十八輪（issue #94）：主題錨點命中的內容排在其他句子前面（「五合一晚了兩個月才打」先答補接種 FAQ，再補五合一時程）
    const rank = (p) => (p.chunk?._anchor ? Math.min(p.slot, -0.5) : p.slot);
    picked.sort((a, b) => rank(a) - rank(b) || b.score - a.score);
    return picked;
  }

  const QUERY_POINTS = [
    { cue: /(預防|防範|怎麼避免|如何避免|防治)/, key: 'prevention', label: '預防作法', re: /(預防|防蚊|長袖|清除|積水|巡、倒|洗手|口罩|接種|避免)/ },
    { cue: /(怎麼辦|該怎麼做|如何處理|要注意什麼)/, key: 'action', label: '該怎麼做', re: /(就醫|撥打|立即|請|應|建議)/ },
    { cue: /(多久|幾天|幾小時|何時|什麼時候)/, key: 'time', label: '時間', re: /\d|[一二三四五六七八九十]+\s*(天|週|小時|個月|日)/ },
    { cue: /(要帶|準備什麼|準備哪些|應備|文件|證件)/, key: 'documents', label: '應備文件', re: /(準備|文件|證|表|護照)/, intents: ['apply'] },
    { cue: /(費用|多少錢|收費|免費|規費)/, key: 'fee', label: '費用', re: /(元|費|免費)/, intents: ['apply'] },
    { cue: /(誰能|誰可以|哪些人|資格|對象)/, key: 'who', label: '申請對象', re: /(對象|資格|醫師|醫療院所|民眾|研究|機關|衛生局|者)/, intents: ['apply'] },
    { cue: /(溫度|保存|冷藏|冷凍)/, key: 'storage', label: '保存條件', re: /(保存|°C|冷藏|冷凍|室溫)/, intents: ['lab'] },
    // 第四十輪（issue #75）：「去哪裡打疫苗／Where can I get a flu vaccine?」答案要有地點句（衛生所、合約院所、clinic…），沒有就從候選補入
    { cue: VAX_WHERE_RE, key: 'where', label: '接種地點', re: /(衛生所|合約(醫療)?院所|醫療院所|診所|學校|校園|clinic|health (centre|center|station)|hospital|school|trạm y tế|phòng khám|puskesmas|klinik|สถานีอนามัย|โรงพยาบาล)/i, intents: ['vaccine'] },
  ];
  function requiredFor(intent, q) {
    const out = [...(REQUIRED_POINTS[intent] ?? [])];
    for (const p of QUERY_POINTS) if (p.cue.test(q) && (!p.intents || p.intents.includes(intent)) && !out.some((x) => x.key === p.key)) out.push(p);
    return out;
  }
  function completenessOf(intent, sentences, extra = {}) {
    const req = requiredFor(intent, extra.q ?? '');
    const text = sentences.map((s) => s.text).join(' ');
    const covered = req.filter((r) => r.re.test(text) || (r.key === 'status' && extra.situation)).map((r) => r.key);
    return { required: req.map((r) => r.key), covered, missing: req.map((r) => r.key).filter((k) => !covered.includes(k)), score: req.length ? covered.length / req.length : 1 };
  }

  function sourceOf(c) {
    return {
      id: c.id, contentId: c.contentId, type: c.type, lang: c.lang ?? 'zh-TW', title: c.title, url: c.url, owner: c.owner, ownerName: c.ownerName,
      reviewedAt: c.reviewedAt, nextReviewAt: c.nextReviewAt ?? null, publishedAt: c.publishedAt ?? null, version: c.version ?? null, effectiveAt: c.effectiveAt ?? null,
      isCurrent: c.isCurrent !== false, section: c.section ?? null, family: c.family ?? null, supersedes: c.supersedes ?? null, supersedesVersion: c.supersedesVersion ?? null,
      change: c.change ?? null, license: c.license ?? 'OGDL-1.0', docTitle: c.docTitle ?? null, mdUrl: c.mdUrl ?? null, legacyUrl: c.legacyUrl ?? null,
      pdfPage: c.pdfPage ?? null, extraction: c.extraction ?? null, verification: c.verification ?? null,
      historical: !!c.historical,
      ...typeExtras(c),
    };
  }
  /** 來源卡的型別專屬欄位（media 時間戳、service 步驟數與天數、labtest 檢體表、公告截止） */
  function typeExtras(c) {
    switch (c.type) {
      case 'media': {
        const m = mediaById.get(c.contentId);
        return { mediaType: c.mediaType ?? m?.mediaType ?? 'video', chapter: c.chapter ?? null, t: c.t ?? 0, timeLabel: mmssOf(c.t ?? 0), poster: c.poster ?? m?.poster ?? null, producedAt: c.producedAt ?? m?.producedAt ?? null, basedOnVersionLabel: c.basedOnVersionLabel ?? m?.basedOnVersionLabel ?? null, durationSeconds: c.durationSeconds ?? m?.durationSeconds ?? null };
      }
      case 'service': {
        const sv = serviceById.get(c.contentId);
        return { serviceType: c.serviceType ?? sv?.serviceType ?? null, slug: c.slug ?? sv?.slug ?? null, stepsCount: c.stepsCount ?? sv?.steps?.length ?? null, slaDays: c.slaDays ?? sv?.slaDays ?? null, fee: c.fee ?? sv?.fee ?? null, applyUrl: c.applyUrl ?? sv?.applyUrl ?? null, forms: c.forms ?? sv?.forms ?? [] };
      }
      case 'labtest': return { specimen: c.specimen ?? null, sendWithinHours: c.sendWithinHours ?? null, labs: c.labs ?? [] };
      case 'publication': return { series: c.series ?? null, volume: c.volume ?? null, issue: c.issue ?? null, article: c.article ?? null, cover: c.cover ?? null };
      case 'research': return { year: c.year ?? null, projectStatus: c.projectStatus ?? null, piUnit: c.piUnit ?? null };
      case 'topic': return { links: c.links ?? null };
      case 'job': return { jobStage: jobStageNow(c), hiringUnitName: c.hiringUnitName ?? null, positions: c.positions ?? null, applyStart: c.applyStart ?? null, deadlineAt: c.deadlineAt ?? null, applyHref: c.applyHref ?? null, applyExternal: !!c.applyExternal, hasResult: !!c.hasResult, resultUrl: c.resultUrl ?? null, closed: closedNow(c) };
      case 'tender': return { tenderStage: tenderStageNow(c), tenderNo: c.tenderNo ?? null, requestingUnitName: c.requestingUnitName ?? null, deadlineAt: c.deadlineAt ?? null, openingAt: c.openingAt ?? null, budgetNtd: c.budgetNtd ?? null, pccUrl: c.pccUrl ?? null, closed: closedNow(c) };
      default:
        if (NOTICE_TYPES.includes(c.newsType)) return { newsType: c.newsType, closed: closedNow(c), deadlineAt: c.deadlineAt ?? null, refNo: c.refNo ?? null, applyUrl: c.applyUrl ?? null };
        return {};
    }
  }
  /** 公告是否已截止（建置時標記，或以引擎 today 再算一次） */
  function closedNow(c) {
    if (c.type === 'job') return !['open', 'upcoming'].includes(jobStageNow(c));
    if (c.type === 'tender') return tenderStageNow(c) !== 'open';
    return !!(c.closed || (c.deadlineAt && today && c.deadlineAt < today));
  }
  /** 第七輪：職缺／標案階段以引擎 today 再算一次（索引建置日可能較舊）；與治理引擎 jobStageOf／tenderStageOf 同規則 */
  function todayRt() { return today ?? now().toISOString().slice(0, 10); }
  function jobStageNow(c) {
    if (c.manualStatus) return c.manualStatus;
    if (c.hasResult) return 'result';
    const T = todayRt();
    if (c.applyStart && T < c.applyStart) return 'upcoming';
    if (!c.deadlineAt || T <= c.deadlineAt) return 'open';
    return c.jobStage === 'screening' ? 'screening' : 'closed';
  }
  function tenderStageNow(c) {
    if (c.manualStatus) return c.manualStatus;
    if (c.awarded) return 'awarded';
    const T = todayRt();
    if (!c.deadlineAt || T <= c.deadlineAt) return 'open';
    if (c.openingAt && T >= c.openingAt) return 'opened';
    return 'closed';
  }

  /** 專業模式引用標籤：依「文件」第 3 條，v2026-09 生效 115/9/15，取代前版第 3 條「限快篩陽性」 */
  function citeLabelOf(src) {
    if (!src || !(src.type === 'document' || src.type === 'letter')) return null;
    const no = src.section?.no;
    const sec = no ? `第 ${no} 條` : src.section?.heading ? `〈${src.section.heading}〉` : '';
    let s = `依「${src.docTitle ?? src.title}」${sec}${src.pdfPage ? `（第 ${src.pdfPage} 頁）` : ''}`;
    if (src.version || src.effectiveAt) s += `，${src.version ?? ''}${src.effectiveAt ? ` 生效 ${rocDate(src.effectiveAt)}` : ''}`;
    if (src.supersedes) {
      const before = src.change?.before ? `「${src.change.before}」` : '';
      s += `，取代前版${src.supersedesVersion ? `（${src.supersedesVersion}）` : ''}${no && before ? `第 ${no} 條` : ''}${before}`;
    }
    return s;
  }

  const PENDING_MARK = { 'zh-TW': '（待確認）', en: ' (pending verification)' };
  function finalizeSentences(result, picked, sourceMap) {
    // sourceMap: id → source；依出現順序編號
    const order = []; const sources = [];
    for (const p of picked) for (const id of p.cite) if (!order.includes(id) && sourceMap.has(id)) { order.push(id); sources.push(sourceMap.get(id)); }
    const nOf = new Map(order.map((id, i) => [id, i + 1]));
    sources.forEach((s, i) => { s.n = i + 1; });
    result.sources = sources;
    result.sentences = [];
    for (const p of picked) {
      const cite = p.cite.filter((id) => nOf.has(id));
      if (!cite.length) { result.guards.push({ kind: 'uncited-dropped', text: p.text.slice(0, 40) }); continue; }
      const s = { text: p.text, cite, n: cite.map((id) => nOf.get(id)) };
      // 第四十八輪（issue #93）：引用的內容 verification 為 pending ⇒ 句尾加與時程表相同的「（待確認）」（英文等譯文片段用英文字樣），
      // 民眾不必點開來源卡才知道這句尚待權責單位確認；s.pending 讓 grounding 檢核比對前先去掉字樣
      const pend = cite.map((id) => sourceMap.get(id)).find((x) => x?.verification === 'pending');
      if (pend) { const m = PENDING_MARK[pend.lang] ?? PENDING_MARK.en; if (!s.text.endsWith(m) && !s.text.endsWith(PENDING_MARK['zh-TW'])) { s.text += m; s.pending = m; } }
      for (const k of ['closed', 'scheduleIds', 'href']) if (p[k] && p[k].length !== 0) s[k] = p[k];
      if (result.view === 'pro') { const docId = cite.find((id) => ['document', 'letter'].includes(sourceMap.get(id)?.type)); const lab = docId ? citeLabelOf(sourceMap.get(docId)) : null; if (lab) s.citeLabel = lab; }
      result.sentences.push(s);
    }
  }

  // ── 態勢 ──
  function situationFor(entities, intent) {
    if (!situation?.items?.length) return null;
    const ids = entities.diseases.map((d) => d.id);
    let items = situation.items.filter((i) => ids.includes(i.disease));
    if (!items.length && intent === 'situation') items = situation.items.filter((i) => i.pinned);
    if (!items.length && intent === 'situation') items = situation.items.slice(0, 4);
    if (!items.length) return null;
    return {
      publishedAt: situation.publishedAt, dataDate: situation.dataDate, publisher: situation.publisher, publisherName: ownerNameOf(units, situation.publisher), publisherNameEn: units.find((u) => u.id === situation.publisher)?.nameEn ?? null,
      source: situation.source, nextReviewAt: situation.nextReviewAt, note: situation.note ?? null,
      items: items.map((i) => ({ ...i, diseaseName: i.diseaseName ?? diseaseById.get(i.disease)?.name ?? i.disease, diseaseNameEn: diseaseById.get(i.disease)?.nameEn ?? null, slug: i.slug ?? diseaseById.get(i.disease)?.slug ?? null })),
    };
  }
  const STATUS_LABEL = { stable: '平穩', rising: '上升', peak: '高峰', declining: '下降' };
  function situationSentences(sit, lang) {
    // 只轉述人工發布的結構化欄位，不生成數字
    const out = []; const srcs = new Map();
    for (const it of sit.items) {
      const id = `situation#${it.disease}`;
      srcs.set(id, { id, contentId: 'situation.current', type: 'situation', title: `疫情態勢 · ${it.diseaseName}`, url: '/situation/', owner: sit.publisher, ownerName: sit.publisherName, reviewedAt: sit.publishedAt, nextReviewAt: sit.nextReviewAt, isCurrent: true, license: 'OGDL-1.0', dataDate: sit.dataDate, lang: 'zh-TW' });
      const i18n = lang !== 'zh-TW' ? it.i18n?.[lang] : null;
      const status = lang === 'zh-TW' ? STATUS_LABEL[it.status] ?? it.status : it.status;
      if (lang === 'zh-TW') out.push({ text: `${it.diseaseName}目前疫情態勢為「${status}」：${it.metricLabel} ${it.metricValue}${it.deltaText ? `，${it.deltaText}` : ''}（資料日 ${sit.dataDate}）。`, cite: [id], slot: 0, score: 9 });
      else out.push({ text: `${it.diseaseNameEn ?? it.diseaseName}: status "${status}" — ${i18n?.metricLabel ?? it.metricLabel} ${it.metricValue}${i18n?.deltaText ? `, ${i18n.deltaText}` : ''} (data as of ${sit.dataDate}).`, cite: [id], slot: 0, score: 9 });
      if (it.basis && lang === 'zh-TW') out.push({ text: `判定依據：${it.basis}。`, cite: [id], slot: 0, score: 8 });
      const adv = i18n?.advice ?? it.advice;
      if (adv) out.push({ text: lang === 'zh-TW' ? `建議：${adv}。` : `Advice: ${adv}.`, cite: [id], slot: 1, score: 8 });
    }
    return { sentences: out, sources: srcs };
  }

  // ── 旅遊疫情建議等級（結構化快照，只轉述不推論） ──
  const LEVEL_LABEL = { 1: '注意（Watch）', 2: '警示（Alert）', 3: '警告（Warning）' };
  const LEVEL_ZH = { 1: '一', 2: '二', 3: '三' };
  function travelFor(entities) {
    // 等級一律以「依國家彙整」的等級表（country-epid-level，Diseases[]）為準；近 30 天消息只當新聞，不拿來推等級。
    const out = [];
    for (const c of entities.countries) {
      const iso = String(c.id ?? '').toUpperCase();
      const hits = travelItems.filter((t) => t.iso2 === iso || (t.name && t.name === c.name));
      const table = hits.filter((h) => h.aggregate);
      const news = hits.filter((h) => !h.aggregate);
      if (!hits.length) continue;
      let entries; let background = [];
      if (table.length) {
        const row = table[0];
        // 背景提醒（ARCHITECTURE 12.1：同病同級涵蓋 ≥ 50% 國家，如新冠併發重症第一級）不逐病列，另成一句全球背景提醒
        const details = row.details ?? [];
        background = details.filter((d) => d.background).map((d) => ({ level: d.level, levelLabel: d.levelLabel, disease: d.disease, date: d.date }));
        entries = details.filter((d) => !d.background).map((d) => ({ level: d.level, levelLabel: d.levelLabel, diseaseNames: [d.disease].filter(Boolean), date: d.date, advice: d.advice ?? null, area: d.area ?? null }));
        if (!entries.length) entries = [{ level: 0, levelLabel: row.targetedLevelLabel ?? '無針對性旅遊疫情建議', diseaseNames: [], date: row.date, advice: null, none: true, targeted: true }];
      } else {
        entries = news.map((h) => ({ level: h.level, levelLabel: h.levelLabel, diseaseNames: h.diseaseNames, date: h.date, advice: h.advice }));
      }
      out.push({ iso2: iso, name: (table[0] ?? news[0]).name ?? c.name, entries, background, news });
    }
    return out;
  }
  function travelSentences(tr, lang) {
    const sents = []; const srcs = new Map();
    for (const c of tr) {
      const id = `travel#${c.iso2}`;
      const top = c.entries.reduce((a, b) => ((Number(b.level) || 0) > (Number(a.level) || 0) ? b : a));
      const date = c.entries.map((e) => e.date).filter(Boolean).sort().at(-1) ?? null;
      srcs.set(id, { id, contentId: `travel.${c.iso2}`, type: 'travel', title: `旅遊疫情建議 · ${c.name}`, url: `/travel/${c.iso2.toUpperCase()}/`, owner: 'unit.epidemic-intelligence', ownerName: ownerNameOf(units, 'unit.epidemic-intelligence'), reviewedAt: date, isCurrent: true, license: 'OGDL-1.0', lang: 'zh-TW' });
      for (const e of c.entries.slice(0, 4)) {
        if (e.none || !(Number(e.level) > 0)) {
          sents.push({ text: lang === 'zh-TW' ? `${c.name}目前無針對性旅遊疫情建議，請遵守一般預防措施（勤洗手、防蚊、注意飲食衛生）。` : `${c.name}: no targeted travel health notice at present; follow general precautions.`, cite: [id], slot: 0, score: 9 });
          continue;
        }
        const lvl = e.levelLabel ? `「${e.levelLabel}」` : e.level != null ? `第 ${e.level} 級${LEVEL_LABEL[e.level] ? `「${LEVEL_LABEL[e.level]}」` : ''}` : '';
        const dz = e.diseaseNames.join('、') + (e.area ? `，${e.area}` : '');
        sents.push({ text: lang === 'zh-TW' ? `${c.name}${dz ? `（${dz}）` : ''}：旅遊疫情建議${lvl}${e.date ? `，發布日 ${e.date}` : ''}。` : `${c.name}${dz ? ` (${dz})` : ''}: travel notice level ${e.level ?? '-'}${e.date ? `, issued ${e.date}` : ''}.`, cite: [id], slot: 0, score: 9 });
        if (e.advice && lang === 'zh-TW') sents.push({ text: e.advice, cite: [id], slot: 0, score: 8 });
      }
      void top;
    }
    // 全球背景提醒：各國共通，只說一次（放在逐國句之後；answer() 會保留這一句）
    const bg = new Map();
    for (const c of tr) for (const b of c.background ?? []) if (!bg.has(`${b.disease}|${b.level}`)) bg.set(`${b.disease}|${b.level}`, b);
    if (bg.size && tr[0]) {
      const id = `travel#${tr[0].iso2}`;
      const list = [...bg.values()];
      sents.push({
        background: true, cite: [id], slot: 0, score: 7,
        text: lang === 'zh-TW'
          ? `全球背景提醒：${list.map((b) => `${b.disease}第${LEVEL_ZH[b.level] ?? b.level}級${LEVEL_LABEL[b.level] ? `「${LEVEL_LABEL[b.level]}」` : ''}${b.date ? `（${b.date} 起，多數國家皆列）` : ''}`).join('、')}，遵守一般預防措施即可。`
          : `Global background notice: ${list.map((b) => `${b.disease} level ${b.level}`).join(', ')} applies to most countries; follow usual precautions.`,
      });
    }
    return { sentences: sents, sources: srcs };
  }

  // ── 旅遊疫情建議的變化（近 30 天新增／調升／調降／解除；資料為等級表各國 RecentChanges） ──
  const KIND_ZH = { new: '新增', raised: '調升', lowered: '調降', lifted: '解除', renewed: '重新發布' };
  const KIND_EN = { new: 'new', raised: 'raised', lowered: 'lowered', lifted: 'lifted', renewed: 'renewed' };
  function travelChanges(q, lang, days = 30) {
    if (!TRAVEL_CHANGE_RE.test(q)) return null;
    const rows = travelItems.filter((t) => t.aggregate);
    // 新格式等級表（有 Targeted*）一律附事件快照推得的 RecentChanges（無變化的國家不帶此欄）；舊快照沒有變化資料 ⇒ 不回答
    if (!rows.length || !rows.some((r) => Array.isArray(r.recentChanges) || r.targetedLevel != null)) return null;
    const asOf = today ?? now().toISOString().slice(0, 10);
    const since = new Date(Date.parse(`${asOf}T00:00:00Z`) - days * 864e5).toISOString().slice(0, 10);
    const all = rows.flatMap((r) => (r.recentChanges ?? []).map((c) => ({ ...c, iso2: r.iso2, name: r.name }))).filter((e) => e.date <= asOf).sort((a, b) => b.date.localeCompare(a.date));
    const recent = all.filter((e) => e.date >= since);
    const asked = Object.entries(TRAVEL_CHANGE_KINDS).filter(([, re]) => re.test(q)).map(([k]) => k);
    const kinds = asked.length ? asked : ['lifted', 'raised', 'lowered', 'new'];
    const id = 'travel#changes';
    const src = { id, contentId: 'travel.changes', type: 'travel', title: '旅遊疫情建議 · 近期變化', url: '/travel/', owner: 'unit.epidemic-intelligence', ownerName: ownerNameOf(units, 'unit.epidemic-intelligence'), reviewedAt: all[0]?.date ?? null, isCurrent: true, license: 'OGDL-1.0', lang: 'zh-TW' };
    const zh = lang === 'zh-TW';
    const fmt = (e) => `${e.name}${e.Disease ? `（${e.Disease}${e.Area ? `，${e.Area}` : ''}，${e.date}）` : `（${e.date}）`}`;
    const sents = [];
    for (const k of kinds) {
      const hits = recent.filter((e) => e.kind === k);
      if (hits.length) sents.push({ text: zh ? `近 ${days} 天${KIND_ZH[k]}旅遊疫情建議的有：${hits.slice(0, 8).map(fmt).join('、')}${hits.length > 8 ? ` 等 ${hits.length} 則` : ''}。` : `Travel notices ${KIND_EN[k]} in the last ${days} days: ${hits.slice(0, 8).map((e) => `${e.name} (${e.Disease}, ${e.date})`).join('; ')}.`, cite: [id], slot: 0, score: 9 });
      else if (asked.length) {
        const older = all.filter((e) => e.kind === k);
        sents.push({ text: zh ? `近 ${days} 天（${since} 起）沒有${KIND_ZH[k]}的旅遊疫情建議${older.length ? `；較早一則為${fmt(older[0])}` : ''}。` : `No travel notices ${KIND_EN[k]} in the last ${days} days (since ${since}).`, cite: [id], slot: 0, score: 9 });
      }
    }
    const n = (k) => recent.filter((e) => e.kind === k).length;
    sents.push({ text: zh ? `近 ${days} 天變化：新增 ${n('new')}、調升 ${n('raised')}、調降 ${n('lowered')}、解除 ${n('lifted')}；各國現行等級請查目的地。` : `Last ${days} days: ${n('new')} new, ${n('raised')} raised, ${n('lowered')} lowered, ${n('lifted')} lifted.`, cite: [id], slot: 0, score: 8 });
    return { sentences: sents, sources: new Map([[id, src]]) };
  }

  // ── 統計 ──
  const GRAN = { year: /(年|歷年|每年|year|năm)/i, week: /(週|周|星期|week|tuần)/i, month: /(月|month|tháng)/i, day: /(日|天|每日|day|ngày)/i };
  function seriesList(ds) { const s = ds.series; if (!s) return []; return (Array.isArray(s) ? s : [s]).map((x, i) => ({ ...x, _i: i })); }
  function matchSeries(q, entities) {
    const dIds = entities.diseases.map((d) => d.id);
    const qb = new Set(tokenize(q, { query: true }));
    let best = null;
    for (const ds of datasets) for (const se of seriesList(ds)) {
      let s = 0;
      const dsDiseases = ds.diseases ?? [];
      if (dIds.length) {
        if (dsDiseases.some((d) => dIds.includes(d)) || dIds.some((id) => (ds.title ?? '').includes(diseaseById.get(id)?.name ?? '@@'))) s += 5; else continue;
      }
      for (const t of tokenize(`${se.label ?? ''} ${ds.title ?? ''}`)) if (qb.has(t)) s += 1;
      const g = Object.entries(GRAN).find(([, re]) => re.test(q))?.[0];
      if (g && se.granularity === g) s += 2;
      if (/本土/.test(q) && /本土/.test(se.label ?? '')) s += 2;
      if (/境外/.test(q) && /境外/.test(se.label ?? '')) s += 2;
      if (/本土/.test(q) && /境外/.test(se.label ?? '')) s -= 3;
      if (/境外/.test(q) && /本土/.test(se.label ?? '')) s -= 3;
      if (!best || s > best.s) best = { ds, se, s };
    }
    return best && best.s >= 3 ? best : null;
  }
  function statsAnswer(q, entities, range, lang) {
    const m = matchSeries(q, entities);
    if (!m) return null;
    const { ds, se } = m;
    let pts = [...(se.points ?? [])];
    const yearOf = (t) => Number(String(t).slice(0, 4));
    const notes = [];
    if (range.from != null) pts = pts.filter((p) => yearOf(p.t) >= range.from && yearOf(p.t) <= range.to);
    else if (range.years.length && se.granularity === 'year') pts = pts.filter((p) => range.years.includes(yearOf(p.t)));
    else if (range.n != null) {
      const n = Math.round(range.unit === se.granularity ? range.n : range.unit === 'year' && se.granularity === 'week' ? range.n * 52 : range.n);
      if (pts.length < n) notes.push(`資料僅有 ${pts.length} 個時間點`);
      pts = pts.slice(-n);
    } else if (pts.length > 10) pts = pts.slice(-10);
    if (!pts.length) return { empty: true, ds, se };
    const unit = se.unit ?? '';
    const fmt = (v) => (typeof v === 'number' ? v.toLocaleString('en-US') : String(v));
    const tLabel = (t) => (se.granularity === 'year' && /^\d{4}$/.test(String(t)) ? (lang === 'zh-TW' ? `${t} 年` : String(t)) : String(t));
    let aggregate = null;
    if (/(總共|合計|加總|一共|總計|累計|共有|total|in total|altogether|tổng)/i.test(q)) aggregate = { kind: 'sum', value: pts.reduce((s, p) => s + (Number(p.v) || 0), 0) };
    else if (/(最高|最多|最嚴重|高峰是|peak|highest|most)/i.test(q)) { const p = pts.reduce((a, b) => (Number(b.v) > Number(a.v) ? b : a)); aggregate = { kind: 'max', value: p.v, t: p.t }; }
    else if (/(最低|最少|lowest|fewest)/i.test(q)) { const p = pts.reduce((a, b) => (Number(b.v) < Number(a.v) ? b : a)); aggregate = { kind: 'min', value: p.v, t: p.t }; }
    else if (/(平均|average|mean)/i.test(q)) aggregate = { kind: 'avg', value: Math.round((pts.reduce((s, p) => s + (Number(p.v) || 0), 0) / pts.length) * 10) / 10 };
    const sid = ds.id;
    const label = se.label ?? ds.title;
    const sentences = [];
    if (aggregate) {
      const span = `${tLabel(pts[0].t)}–${tLabel(pts.at(-1).t)}`;
      const text = lang === 'zh-TW'
        ? { sum: `${label}：${span}合計 ${fmt(aggregate.value)} ${unit}。`, max: `${label}：${span}間最高為 ${tLabel(aggregate.t)}，${fmt(aggregate.value)} ${unit}。`, min: `${label}：${span}間最低為 ${tLabel(aggregate.t)}，${fmt(aggregate.value)} ${unit}。`, avg: `${label}：${span}平均每期 ${fmt(aggregate.value)} ${unit}。` }[aggregate.kind]
        : { sum: `${label}: ${span} total ${fmt(aggregate.value)} ${unit}.`, max: `${label}: highest in ${aggregate.t}, ${fmt(aggregate.value)} ${unit}.`, min: `${label}: lowest in ${aggregate.t}, ${fmt(aggregate.value)} ${unit}.`, avg: `${label}: average ${fmt(aggregate.value)} ${unit} per period.` }[aggregate.kind];
      sentences.push({ text, cite: [sid] });
    }
    for (const p of pts) sentences.push({ text: lang === 'zh-TW' ? `${tLabel(p.t)}：${fmt(p.v)} ${unit}` : `${p.t}: ${fmt(p.v)} ${unit}`, cite: [sid] });
    const source = {
      id: sid, contentId: sid, type: 'dataset', title: ds.title, url: ds.canonicalUrl ?? ds.portalUrl, owner: ds.owner, ownerName: ds.ownerName ?? ownerNameOf(units, ds.owner),
      reviewedAt: ds.lastUpdated ?? ds.reviewedAt, dataDate: ds.lastUpdated, license: ds.license ?? 'OGDL-1.0', formats: ds.formats ?? ds.format ?? [], isCurrent: true,
      portalUrl: ds.portalUrl, mirrors: ds.mirrors ?? [], schemaUrl: ds.schemaUrl ?? null, apiUrl: '/v1/datasets.json', provenance: ds.provenance ?? null, note: se.note ?? null, lang: 'zh-TW',
    };
    return { stats: { dataset: { id: ds.id, title: ds.title }, label, unit, granularity: se.granularity, points: pts, aggregate, range, notes, note: se.note ?? null }, sentences, source };
  }

  // ── 謠言 ──
  const RUMOR_STRIP = /(這則|這個|這篇)?(訊息|消息|貼文|新聞|傳言)?(是)?(真的嗎|是真的嗎|真的假的|是假的嗎|假的嗎|可信嗎|是不是真的)|網傳|聽說|有人說|LINE\s*(群組)?(上)?(說|傳)|請問|查證|闢謠|[:：「」『』"“”?？!！，,。]/gi;
  function similarity(q, claim) {
    const A = new Set(bigrams(q)), B = new Set(bigrams(claim));
    if (!A.size || !B.size) return 0;
    let inter = 0; for (const x of A) if (B.has(x)) inter++;
    const jac = inter / (A.size + B.size - inter);
    const contClaim = inter / B.size; // 訊息含整則謠言
    const contQuery = inter / A.size; // 問句是謠言的片段
    return Math.max(jac, 0.85 * contClaim, 0.75 * contQuery * Math.min(1, A.size / 6));
  }
  // 第四十輪：只問「這是真的嗎」、沒附訊息內容（首頁預設問題就是這樣）。拉丁字母語言的字元雙字很容易跟任何一則英文謠言撞到 0.4 以上，
  // 不能拿相似度判斷 ⇒ 直接回「目前沒有對應的官方澄清」並引導到澄清專區貼上訊息。七語的「光問句」寫法列在這裡。
  const RUMOR_ASK_ONLY = /^\s*((這則|這個|這篇)?(訊息|消息|貼文|新聞|傳言)?(是)?(真的嗎|是真的嗎|真的假的|是假的嗎|可信嗎)|is (?:this|that|it) (?:message |news |post |claim |text )?true|このメッセージは本当ですか|totoo ba(?: ang)?(?: mensaheng| balitang)?(?: ito| iyan)?|apakah (?:pesan|berita|kabar) ini benar|tin nhắn này có thật không|ข้อความนี้จริงหรือไม่|ข้อความนี้จริงไหม)\s*[?？!！。.]*\s*$/i;
  function factCheck(q, result) {
    const LL = result.lang;
    const qs = q.replace(RUMOR_STRIP, ' ');
    let best = null, bestScore = 0, bestClaim = null;
    if (RUMOR_ASK_ONLY.test(q)) {
      result.verdict = 'unknown'; result.guards.push({ kind: 'rumor-no-message' });
      return setRefusal(result, 'no-clarification', 'ref.no-clarification.empty', [{ label: tr(LL, '到澄清專區貼上訊息', 'Paste the message on the fact-check page'), href: '/factcheck/', kind: 'link' }, { label: tr(LL, '撥打 1922 詢問', 'Call 1922'), href: 'tel:1922', kind: 'hotline' }]);
    }
    for (const c of clarifications) {
      // 不在白名單的澄清只在「已過時」時使用（治理引擎判定依據已修訂，需告知民眾已過時）
      const wl = c.gov?.whitelist?.effective ?? c.governance?.whitelist;
      if (wl === false && !isOutdated(c)) continue;
      const claims = [c.claim, ...(c.claimVariants ?? []), ...(result.lang !== 'zh-TW' ? [c.i18n?.[result.lang]?.claim, c.i18n?.[result.lang]?.title, ...(c.i18n?.[result.lang]?.claimVariants ?? [])] : [])].filter(Boolean);
      for (const claim of claims) { const s = similarity(qs, claim); if (s > bestScore) { bestScore = s; best = c; bestClaim = claim; } }
    }
    result.rumorScore = Math.round(bestScore * 100) / 100;
    if (!best || bestScore < 0.4) {
      result.verdict = 'unknown';
      setRefusal(result, 'no-clarification', 'ref.no-clarification', [{ label: tr(LL, '撥打 1922 詢問', 'Call 1922'), href: 'tel:1922', kind: 'hotline' }, { label: tr(LL, '詐騙請撥 165', 'Scams: call 165'), href: 'tel:165', kind: 'hotline' }, { label: tr(LL, '到澄清專區', 'Fact-check page'), href: '/factcheck/', kind: 'link' }]);
      return result;
    }
    const outdated = isOutdated(best);
    const verdict = outdated ? 'outdated' : best.verdict;
    const i18n = result.lang !== 'zh-TW' ? best.i18n?.[result.lang] : null;
    const revised = (best.gov?.stale ?? best.governance?.stale ?? []).map((s) => ({ revisedAt: s.revisedAt, currentId: s.currentId, currentTitle: s.currentTitle }));
    for (const a of annotationsOf(best)) if (a.kind === 'based-on-revised' && !revised.length) revised.push({ text: a.text, currentId: a.href });
    const text = best.clarificationText ?? mdPlain(best.clarificationMarkdown ?? '');
    result.verdict = verdict;
    result.matchedClaim = bestClaim;
    result.clarification = {
      id: best.id, title: i18n?.title ?? best.title, claim: best.claim, verdict, originalVerdict: best.verdict, text: i18n?.clarification ?? text,
      shareText: i18n?.shareText ?? best.shareText, reportChannel: best.reportChannel, url: best.url ?? '/factcheck/', publishedAt: best.publishedAt, reviewedAt: best.reviewedAt,
      ownerName: best.ownerName ?? ownerNameOf(units, best.owner), outdated, revised,
    };
    result.shareText = result.clarification.shareText; result.reportChannel = best.reportChannel;
    const src = { id: best.id, contentId: best.id, type: 'clarification', title: best.title, url: best.url ?? `/factcheck/#${best.id}`, owner: best.owner, ownerName: result.clarification.ownerName, reviewedAt: best.reviewedAt, isCurrent: !outdated, license: best.license ?? 'OGDL-1.0', lang: result.lang, n: 1 };
    result.sources = [src];
    const sents = splitPlain(result.clarification.text).slice(0, 3);
    result.sentences = sents.map((t) => ({ text: t, cite: [best.id], n: [1] }));
    if (outdated) result.guards.push({ kind: 'clarification-outdated', id: best.id });
    result.actions = [
      ...(result.shareText ? [{ label: tr(LL, '複製可轉傳短訊', 'Copy shareable message'), kind: 'copy', value: result.shareText }] : []),
      ...(best.reportChannel ? [{ label: tr(LL, `通報：${best.reportChannel}`, `Report: ${best.reportChannel}`), kind: 'info' }] : []),
      { label: tr(LL, '撥打 1922', 'Call 1922'), href: 'tel:1922', kind: 'hotline' },
    ];
    return result;
  }

  // ── 通報時限（結構化回答，不走檢索）：只讀傳染病主檔＋通報時限表 ──
  const NOTIFY_HOW_RE = /(怎麼|如何|流程|方式|哪裡|向誰|找誰|群聚)/;
  const NOTIFY_PERSONAL_RE = new RegExp(`${PERSON}.{0,10}(得了|得到|感染|確診|疑似|好像得|可能得)`);
  function masterSource(d, row, cat) {
    return {
      id: `master.diseases#${d ? d.id : `category-${cat}`}`, contentId: 'master.diseases', type: 'master', lang: 'zh-TW',
      title: '傳染病主檔 · 傳染病防治法公告', subject: d ? d.name : `第${CAT_ZH[cat] ?? cat}類法定傳染病`, basis: '傳染病防治法公告',
      url: `/report/#category-${cat}`, owner: d?.owner ?? 'unit.epidemic-intelligence', ownerName: ownerNameOf(units, d?.owner ?? 'unit.epidemic-intelligence'),
      reviewedAt: null, nextReviewAt: null, isCurrent: true, license: 'OGDL-1.0', mdUrl: null,
      legalCategory: cat, notifyWithinHours: d?.notifyWithinHours ?? null, hoursLabel: d ? notifyHoursLabel(d.notifyWithinHours) : null,
      caseDefinitionUrl: row?.caseDefinitionPath ?? null, labtestUrl: row?.labtestPath ?? null, diseaseUrl: row?.path ?? (d && (d.hasPage || d.page) ? `/diseases/${d.slug}/` : null),
    };
  }
  function notifyAnswer(q, result, entities) {
    const LL = result.lang;
    const picked = []; const sources = []; const items = [];
    const ds = entities.diseases.filter((x) => !x.derived).map((x) => diseaseById.get(x.id)).filter((d) => d && d.legalCategory != null && d.notifyWithinHours != null);
    if (entities.diseases.some((x) => !x.derived) && !ds.length) return null; // 問的是非法定傳染病：交給檢索
    // 沒有疾病、問的是「怎麼通報／群聚通報流程」而非時限或類別 ⇒ 交給檢索（申請服務：群聚通報、法定傳染病通報）
    if (!ds.length && NOTIFY_HOW_RE.test(q) && !/(第\s*[一二三四五1-5]\s*類|幾類|哪一?類|時限|多久|幾小時|幾天)/.test(q)) return null;
    if (ds.length) {
      for (const d of ds.slice(0, 3)) {
        const cat = d.legalCategory; const row = notifyRows.get(d.id) ?? null;
        const src = masterSource(d, row, cat);
        const text = LL === 'zh-TW'
          ? `${d.name}${d.nameEn ? `（${d.nameEn}）` : ''}為第${CAT_ZH[cat] ?? cat}類法定傳染病，應於${hoursPhrase(d.notifyWithinHours)}通報。`
          : `${d.nameEn ?? d.name} is a Category ${cat} notifiable disease and must be reported within ${d.notifyWithinHours} hours.`;
        picked.push({ text, cite: [src.id] }); sources.push(src);
        items.push({ id: d.id, name: d.name, nameEn: d.nameEn ?? null, legalCategory: cat, categoryLabel: `第${CAT_ZH[cat] ?? cat}類`, notifyWithinHours: d.notifyWithinHours, hoursLabel: notifyHoursLabel(d.notifyWithinHours),
          caseDefinitionUrl: src.caseDefinitionUrl, labtestUrl: src.labtestUrl, diseaseUrl: src.diseaseUrl, reportUrl: src.url });
      }
    } else {
      const m = q.match(/第\s*([一二三四五1-5])\s*類/);
      const want = m ? (Number(m[1]) || parseChineseNumber(m[1])) : null;
      const byCat = new Map();
      for (const d of diseases) if (d.legalCategory != null && d.notifyWithinHours != null) { if (!byCat.has(d.legalCategory)) byCat.set(d.legalCategory, []); byCat.get(d.legalCategory).push(d); }
      const cats = [...byCat.keys()].sort((a, b) => a - b).filter((c) => want == null || c === want);
      if (!cats.length) return null;
      for (const cat of cats) {
        const list = byCat.get(cat);
        const counts = new Map(); for (const d of list) counts.set(d.notifyWithinHours, (counts.get(d.notifyWithinHours) ?? 0) + 1);
        const [h0] = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
        const examples = list.filter((d) => d.notifyWithinHours === h0).slice(0, 3).map((d) => d.name).join('、');
        const others = [...counts.keys()].filter((h) => h !== h0).sort((a, b) => a - b).map((h) => {
          const names = list.filter((d) => d.notifyWithinHours === h).map((d) => d.name);
          return `${names.length <= 3 ? names.join('、') : `${names.slice(0, 3).join('、')}等 ${names.length} 種`}應於${hoursPhrase(h)}通報`;
        });
        const src = masterSource(null, null, cat);
        const text = `第${CAT_ZH[cat] ?? cat}類法定傳染病（主檔共 ${list.length} 種，如${examples}）${others.length ? '多數' : ''}應於${hoursPhrase(h0)}通報${others.length ? `；其中${others.join('，')}` : ''}。`;
        picked.push({ text, cite: [src.id] }); sources.push(src);
        items.push({ id: null, name: `第${CAT_ZH[cat] ?? cat}類法定傳染病`, legalCategory: cat, categoryLabel: `第${CAT_ZH[cat] ?? cat}類`, notifyWithinHours: h0, hoursLabel: notifyHoursLabel(h0), count: list.length, reportUrl: src.url });
      }
    }
    const sourceMap = new Map(sources.map((x) => [x.id, x]));
    finalizeSentences(result, picked, sourceMap);
    // 結構化片段也放進 retrieved，讓 grounding 檢核可逐句比對
    result.retrieved = sources.map((x) => { const sents = picked.filter((p) => p.cite[0] === x.id).map((p) => p.text); return { id: x.id, contentId: x.contentId, type: 'master', title: x.title, url: x.url, sentences: sents, text: sents.join(' ') }; });
    const personal = NOTIFY_PERSONAL_RE.test(q);
    result.notify = {
      items, structured: true, source: 'master.diseases', basis: '傳染病防治法公告', personal,
      note: result.view === 'pro' ? null : tr(LL, '法定傳染病由診治醫師依規定通報；民眾發現疑似病例或群聚，請撥打 1922 防疫專線。', 'Notifiable diseases are reported by the attending physician. If you suspect a case or cluster, call the 1922 hotline.'),
    };
    result.confidence = 0.95;
    result.completeness = { required: ['category', 'hours'], covered: ['category', 'hours'], missing: [], score: 1 };
    const a = [];
    if (personal || result.view !== 'pro') a.push({ label: tr(LL, '撥打 1922', 'Call 1922'), href: 'tel:1922', kind: 'hotline' });
    const it = items[0];
    a.push({ label: tr(LL, '前往通報專區', 'Reporting'), href: it?.reportUrl ?? '/report/', kind: 'link' });
    if (it?.caseDefinitionUrl) a.push({ label: tr(LL, `${it.name}病例定義`, `Case definition: ${it.nameEn ?? it.name}`), href: it.caseDefinitionUrl, kind: 'link' });
    if (it?.labtestUrl) a.push({ label: tr(LL, `${it.name}檢驗項目`, `Lab tests: ${it.nameEn ?? it.name}`), href: it.labtestUrl, kind: 'link' });
    if (it?.diseaseUrl && a.length < 4) a.push({ label: tr(LL, `看${it.name}完整頁面`, `${it.nameEn ?? it.name}: full page`), href: it.diseaseUrl, kind: 'link' });
    if (!a.some((x) => x.href === 'tel:1922')) a.push({ label: tr(LL, '撥打 1922', 'Call 1922'), href: 'tel:1922', kind: 'hotline' });
    result.actions = a.slice(0, 4);
    result.related = relatedQuestions(result);
    return result;
  }

  // ── 跨疫苗彙整（結構化回答，不走檢索）：疫苗接種時程主檔 × 年齡／身分 ──
  // 句子由時程主檔欄位串接（dose、ageLabel、startAt、group），引用第一順位是「疫苗接種時程表」（grounding 比對對象），
  // 疫苗有頁面時第二順位引用該頁的接種對象片段（pf-N，依 group／年齡數字對應；找不到用 #v），讓使用者可點進疫苗頁。
  // verified=false：在句尾加「（待確認）」而不是只記 guards——時程數字直接出現在民眾看到的答案裡，
  // 承辦人尚未確認的數字應與時程地圖頁一樣明示；確認後（verified=true）字樣自動消失。
  const SCHED_ID = 'master.immunization-schedule';
  const SCHED_OWNER = 'unit.acute-infectious';
  function vaccineNameOf(vid, it) {
    const v = vaccines.find((x) => x.id === vid);
    if (v?.name || v?.title) return v.name ?? v.title;
    const m = String(it?.label ?? '').match(/^(.*?(?:疫苗|卡介苗))/);
    return m ? m[1].replace(/\s+$/, '') : (it?.label ?? vid);
  }
  function startPhrase(it, T) {
    if (!it.startAt) return '';
    const s = Date.parse(it.startAt), t = Date.parse(T);
    if (!Number.isFinite(s) || !Number.isFinite(t)) return '';
    // 只標示一年內（或尚未開始）的開打日；多年前開始的常規項目不再提起
    if (t - s > 365 * 86400000) return '';
    const [y, mo, d] = it.startAt.split('-').map(Number);
    return `${y} 年 ${mo} 月 ${d} 日起`;
  }
  function schedulePageChunk(vid, it, pool) {
    const pfs = pool.filter((c) => c.contentId === vid && /#pf-\d+$/.test(c.id));
    const want = new Set(bigrams(`${it.group ?? ''}${it.ageLabel ?? ''}${it.dose ?? ''}`.replace(/\s+/g, '')));
    const nums = (s) => new Set(String(s ?? '').match(/\d+/g) ?? []);
    const itNums = nums(`${it.group ?? ''} ${it.ageLabel ?? ''}`);
    let best = null, bestScore = 0;
    for (const c of pfs) {
      const have = new Set(bigrams(String(c.text ?? '').replace(/\s+/g, '')));
      let n = 0; for (const b of want) if (have.has(b)) n++;
      let s = n / Math.max(1, want.size);
      if (c.group && it.group && c.group === it.group) s += 1;
      const cNums = nums(c.group ?? c.text);
      if (itNums.size && [...itNums].every((x) => cNums.has(x))) s += 0.3;
      if (s > bestScore) { best = c; bestScore = s; }
    }
    if (best && bestScore >= 0.2) return best;
    return pool.find((c) => c.id === `${vid}#v`) ?? null;
  }
  function scheduleAnswer(q, result, entities, profile) {
    if (!scheduleItems.length) return null;
    const LL = result.lang;
    const T = todayRt();
    const matched = matchSchedule(scheduleItems, profile, { today: T });
    const pool = poolFor('public', 'zh-TW').chunks;
    const P = profile.label || tr('zh-TW', '此年齡', '');
    const unv = (its) => (its.some((i) => i.verified === false) ? '（待確認）' : '');
    const uniq = (xs) => [...new Set(xs.filter(Boolean))];
    // 一疫苗一組：第一個項目的 effFunded 即該疫苗的最佳公費等級（matchSchedule 已依 funded 排序）
    const groups = new Map();
    for (const it of matched) {
      if (!groups.has(it.vaccine)) groups.set(it.vaccine, { vid: it.vaccine, funded: it.effFunded, items: [] });
      const g = groups.get(it.vaccine);
      if (it.effFunded === g.funded) g.items.push(it);
    }
    const all = [...groups.values()];
    const pub = all.filter((g) => g.funded === 'public');
    const cond = all.filter((g) => g.funded === 'conditional');
    const self = all.filter((g) => g.funded === 'self');
    const picked = []; const pages = new Map();
    const pushFor = (g, text) => {
      const page = schedulePageChunk(g.vid, g.items[0], pool);
      if (page) pages.set(page.id, page);
      picked.push({ text, cite: [SCHED_ID, ...(page ? [page.id] : [])], scheduleIds: g.items.map((i) => i.id), href: page ? null : `/vaccines/schedule/#${g.items[0].id}` });
    };
    const details = (it) => [it.dose, it.ageLabel, startPhrase(it, T)].filter(Boolean).join('，');
    // 第三十七輪：8 → 12。「2 歲前」整段有 10 種公費疫苗，原本只列 8 種、A 肝與日本腦炎被收進「另有 2 種」，家長看不到完整清單
    const PUB_MAX = 12;
    for (const g of pub.slice(0, PUB_MAX)) pushFor(g, `${P}公費疫苗：${vaccineNameOf(g.vid, g.items[0])}（${g.items.map(details).join('；')}）${unv(g.items)}。`);
    if (pub.length > PUB_MAX) picked.push({ text: `另有 ${pub.length - PUB_MAX} 種公費疫苗，請看完整疫苗時程地圖。`, cite: [SCHED_ID] });
    if (!pub.length) {
      // 沒有任何公費項目：明說，並提示下一次公費接種的時間點（只看不限身分的常規公費項目）
      const nextPub = profile.maxMonths == null ? [] : scheduleItems
        .filter((i) => i.funded === 'public' && !['pregnancy', 'risk'].includes(i.stage) && !/(原住民|孕婦)/.test(i.group ?? '') && (i.ageMinMonths ?? 0) > profile.maxMonths && !(i.endAt && i.endAt < T))
        .sort((a, b) => a.ageMinMonths - b.ageMinMonths);
      const nexts = nextPub.filter((i) => i.ageMinMonths === nextPub[0]?.ageMinMonths);
      const nextTxt = nexts.length ? `；下一次公費接種為${nexts[0].ageLabel}（${uniq(nexts.map((i) => vaccineNameOf(i.vaccine, i))).join('、')}）` : '';
      picked.push({ text: `${P}目前沒有常規公費疫苗${nextTxt}${unv(nexts)}。`, cite: [SCHED_ID], scheduleIds: nexts.map((i) => i.id) });
    }
    for (const g of cond.slice(0, 3)) pushFor(g, `符合條件者公費：${vaccineNameOf(g.vid, g.items[0])}（${uniq(g.items.map((i) => i.group || i.ageLabel)).join('；')}；${g.items[0].dose}）${unv(g.items)}。`);
    if (self.length) {
      const list = self.slice(0, 4).map((g) => `${vaccineNameOf(g.vid, g.items[0])}（${[g.items[0].dose, g.items[0].ageLabel].filter(Boolean).join('，')}）`);
      const its = self.slice(0, 4).flatMap((g) => g.items);
      picked.push({ text: `自費可考慮：${list.join('、')}${unv(its)}。`, cite: [SCHED_ID], scheduleIds: its.map((i) => i.id) });
    }
    const schedSrc = {
      id: SCHED_ID, contentId: SCHED_ID, type: 'schedule', lang: 'zh-TW', title: '疫苗接種時程表', subject: P, url: '/vaccines/schedule/',
      owner: SCHED_OWNER, ownerName: units.find((u) => u.id === SCHED_OWNER)?.name ?? '急性傳染病組', reviewedAt: null, nextReviewAt: null, publishedAt: null,
      isCurrent: true, license: 'OGDL-1.0', mdUrl: null, basis: '疫苗接種時程主檔', verified: matched.every((i) => i.verified !== false),
    };
    const sourceMap = new Map([[SCHED_ID, schedSrc], ...[...pages.values()].map((c) => [c.id, sourceOf(c)])]);
    finalizeSentences(result, picked, sourceMap);
    // 結構化句放進 retrieved（第一順位引用），grounding 檢核可逐句比對；疫苗頁片段一併列出
    const texts = picked.map((p) => p.text);
    result.retrieved = [{ id: SCHED_ID, contentId: SCHED_ID, type: 'schedule', title: schedSrc.title, url: schedSrc.url, sentences: texts, text: texts.join(' ') }, ...pages.values()];
    result.schedule = {
      structured: true, source: SCHED_ID, profile, ageHash: ageHashOf(profile),
      items: matched.map((i) => ({ id: i.id, vaccine: i.vaccine, label: i.label, funded: i.effFunded, verified: i.verified !== false })),
      unverified: matched.filter((i) => i.verified === false).length,
    };
    if (LL !== 'zh-TW') result.translationNote = 'showing-source'; // 時程主檔只有中文正本
    result.confidence = 0.9;
    // 接種對象＝問句的年齡／身分本身（結構化比對），與通報時限回答相同視為完整
    result.completeness = { required: ['who'], covered: ['who'], missing: [], score: 1 };
    result.actions = actionsFor(result, entities, null);
    result.related = relatedQuestions(result);
    return result;
  }

  // ── 第七輪：人才招募／採購公告（結構化回答：只讀索引中職缺／標案的結構化句與欄位，不走全文檢索） ──
  // 個資：職缺 chunk 不含 result／waitlistUpdates（index-builder 排除），問「誰錄取」只引用「甄選結果已於…公告，名單只公布報名編號」句並給結果頁連結。
  function overviewChunks(type, view) {
    const seen = new Set();
    return poolFor(view, 'zh-TW').chunks.filter((c) => c.type === type && c.block === 'overview' && !seen.has(c.contentId) && seen.add(c.contentId));
  }
  function structuredFinish(result, picked, chunks, extra) {
    const sourceMap = new Map(chunks.map((c) => [c.id, sourceOf(c)]));
    // （已截止）只標在報名期間／投標截止句，避免「已決標（已截止）」之類的重複標示
    const marked = picked.map((p) => (extra.markClosed && closedNow(p.chunk) && /(報名期間|投標截止日)/.test(p.text) && !p.text.includes('已截止') ? { ...p, text: `${p.text}${CLOSED_MARK}`, closed: true } : p));
    finalizeSentences(result, marked, sourceMap);
    result.retrieved = chunks;
    if (result.lang !== 'zh-TW') result.translationNote = 'showing-source'; // 職缺與標案內容只有中文正本
    result.confidence = 0.9;
    result.completeness = { required: extra.required ?? ['deadline'], covered: extra.required ?? ['deadline'], missing: [], score: 1 };
    result.actions = actionsFor(result, result.entities ?? { diseases: [], vaccines: [], countries: [] }, null);
    if (extra.actions) result.actions = [...extra.actions, ...result.actions.filter((x) => !extra.actions.some((y) => y.href === x.href))].slice(0, 4);
    result.related = [];
    return result;
  }
  const pickSent = (c, re) => (c.sentences ?? []).find((x) => re.test(x));
  /**
   * 職缺／標案問句的「主題詞」：去掉意圖線索、泛用詞與功能詞後剩下的中文／英數詞（≥ 2 字）。
   * 有主題詞，但同型別的所有片段都沒有出現其中任何一個雙字片段 ⇒ true（查無）。沒有主題詞（「現在有哪些標案」）⇒ false。
   */
  const NOTICE_GENERIC_RE = /(疾管署|疾病管制署|本署|機關|單位|時候|日期|何時|公告|公開|招標|採購|標案|投標|決標|開標|案號|預算|廠商|招募|徵才|徵人|職缺|約聘|約僱|甄選|甄試|工作機會|缺額|招考|人員|報名|截止|資格|條件|薪資|薪水|待遇|文件|規格|標的|有哪些|有沒有|現在|目前|最近|最新|近期|正在|進行中|開放|還有|還能|可以|一覽|列表|清單|查詢|資訊|相關|關於|所有|全部)/g;
  function noticeTopicMiss(q, type, view) {
    const residual = String(q).normalize('NFKC').toLowerCase().replace(NOTICE_GENERIC_RE, ' ').replace(QUERY_FUNC_RE, ' ').replace(OPEN_CUE, ' ').replace(ADMIT_RE, ' ').replace(CAREERS_DETAIL_RE, ' ').replace(PROCUREMENT_DETAIL_RE, ' ').replace(/\d+/g, ' ');
    const terms = tokenize(residual, { query: true }).filter((t) => t.length >= 2 || /[a-z]/.test(t));
    if (!terms.length) return false;
    const chunks = poolFor(view, 'zh-TW').chunks.filter((c) => c.type === type);
    if (!chunks.length) return false;
    const hay = lc(chunks.map((c) => `${c.title} ${(c.focusTerms ?? []).join(' ')} ${c.text}`).join(' '));
    return !terms.some((t) => hay.includes(t));
  }
  function careersAnswer(q, result, view) {
    const LL = result.lang;
    const all = overviewChunks('job', view);
    const focus = all.filter((c) => focusOf(q, c));
    result.focusIds = focus.map((c) => c.contentId);
    // 用人單位、職類只當篩選條件（仍只列開放中）
    const byCat = all.filter((c) => (c.hiringUnitName && q.includes(c.hiringUnitName)) || (c.jobType && q.includes(c.jobType)));
    const careersLink = { label: tr(LL, '看全部職缺', 'All vacancies'), href: '/careers/', kind: 'link' };
    // 問錄取結果：不唸名單，給結果頁連結
    if (ADMIT_RE.test(q)) {
      let pool = (focus.length ? focus : all).filter((c) => c.hasResult || c.resultPlannedAt);
      if (!focus.length) pool = pool.filter((c) => c.hasResult);
      pool.sort((a, b) => (b.hasResult - a.hasResult) || (a.archivedStage - b.archivedStage) || String(b.resultPublishedAt ?? b.resultPlannedAt ?? '').localeCompare(String(a.resultPublishedAt ?? a.resultPlannedAt ?? '')));
      pool = pool.slice(0, 3);
      if (!pool.length) return setRefusal(result, 'no-job-result', 'ref.no-job-result', [careersLink]);
      const picked = pool.map((c) => ({ text: pickSent(c, /甄選結果(已於|預計)/), cite: [c.id], chunk: c, slot: 0, score: 9 })).filter((p) => p.text);
      const items = pool.map((c) => ({ id: c.contentId, title: c.title, url: c.url, resultUrl: c.resultUrl, resultPublishedAt: c.resultPublishedAt ?? null, resultPlannedAt: c.resultPlannedAt ?? null, stage: jobStageNow(c) }));
      result.careers = { mode: 'admitted', structured: true, privacy: true, items, note: tr(LL, '甄選結果只在職缺頁公布報名編號（不公布姓名），答案不唸出名單；請以報名編號自行核對。', 'Results list only application numbers (no names) on the vacancy page; this answer does not read out the list.') };
      const acts = items.filter((x) => x.resultUrl).slice(0, 2).map((x) => ({ label: tr(LL, `看「${x.title}」甄選結果`, 'See selection result'), href: x.resultUrl, kind: 'link' }));
      result.guards.push({ kind: 'admitted-list-withheld', ids: items.map((x) => x.id) });
      return structuredFinish(result, picked, pool, { required: ['result-link'], actions: [...acts, careersLink], markClosed: false });
    }
    // 指名職缺並問薪資：職缺概要句＋薪資句
    if (focus.length && /(薪水|薪資|待遇|薪點|月薪|多少錢|起薪)/.test(q)) {
      const pickedS = [];
      for (const c of focus.slice(0, 3)) for (const t of [pickSent(c, /用人，職類為/), pickSent(c, /薪資待遇/)]) if (t) pickedS.push({ text: t, cite: [c.id], chunk: c, slot: 0, score: 9 });
      result.careers = { mode: 'focus', structured: true, items: focus.slice(0, 3).map((c) => ({ id: c.contentId, title: c.title, url: c.url, stage: jobStageNow(c) })) };
      return structuredFinish(result, pickedS, focus.slice(0, 3), { required: ['salary'], markClosed: true });
    }
    if (CAREERS_DETAIL_RE.test(q)) return null; // 資格、薪資、應備文件…：走檢索組句
    const openOf = (arr) => arr.filter((c) => jobStageNow(c) === 'open');
    let list = focus.length ? focus : openOf(byCat).length ? openOf(byCat) : openOf(all);
    if (!focus.length && byCat.length && !openOf(byCat).length && list.length) result.guards.push({ kind: 'category-no-open', fallback: 'all-open' });
    if (!list.length) {
      result.careers = { mode: 'list', structured: true, items: [], upcoming: all.filter((c) => jobStageNow(c) === 'upcoming').map((c) => ({ id: c.contentId, title: c.title, url: c.url, applyStart: c.applyStart, deadlineAt: c.deadlineAt })) };
      return setRefusal(result, 'no-open-job', 'ref.no-open-job', [careersLink]);
    }
    list = [...list].sort((a, b) => String(a.deadlineAt).localeCompare(String(b.deadlineAt)) || a.contentId.localeCompare(b.contentId)).slice(0, 5);
    const picked = [];
    for (const c of list) {
      const s1 = pickSent(c, /用人，職類為/); const s2 = pickSent(c, /報名期間/);
      for (const t of [s1, s2]) if (t) picked.push({ text: t, cite: [c.id], chunk: c, slot: 0, score: 9 });
      if (focus.length && !['open', 'upcoming'].includes(jobStageNow(c))) { const s3 = pickSent(c, /甄選結果(已於|預計)|已停止甄選|已補實/); if (s3) picked.push({ text: s3, cite: [c.id], chunk: c, slot: 0, score: 9 }); }
    }
    result.careers = { mode: focus.length ? 'focus' : 'list', structured: true, items: list.map((c) => ({ id: c.contentId, title: c.title, hiringUnitName: c.hiringUnitName, positions: c.positions, applyStart: c.applyStart, deadlineAt: c.deadlineAt,
      daysLeft: c.deadlineAt ? Math.round((Date.parse(c.deadlineAt) - Date.parse(todayRt())) / 864e5) : null, url: c.url, applyHref: c.applyHref ?? null, applyExternal: !!c.applyExternal, stage: jobStageNow(c) })) };
    return structuredFinish(result, picked, list, { required: ['deadline'], markClosed: true });
  }
  function procurementAnswer(q, result, view) {
    const LL = result.lang;
    const all = overviewChunks('tender', view);
    const focus = all.filter((c) => focusOf(q, c));
    result.focusIds = focus.map((c) => c.contentId);
    const listLink = { label: tr(LL, '看全部採購公告', 'All procurement notices'), href: '/procurement/', kind: 'link' };
    if (PROCUREMENT_DETAIL_RE.test(q)) return null;
    const wantAward = /(決標|得標|流標|廢標)/.test(q) && !focus.length;
    let list = focus.length ? focus : wantAward ? all.filter((c) => ['awarded', 'failed', 'cancelled'].includes(tenderStageNow(c))) : all.filter((c) => tenderStageNow(c) === 'open');
    if (!list.length) return setRefusal(result, 'no-open-tender', 'ref.no-open-tender', [listLink]);
    list = [...list].sort((a, b) => (wantAward ? String(b.awardDate ?? b.deadlineAt).localeCompare(String(a.awardDate ?? a.deadlineAt)) : String(a.deadlineAt).localeCompare(String(b.deadlineAt))) || a.contentId.localeCompare(b.contentId)).slice(0, 5);
    const picked = [];
    for (const c of list) {
      const sents = wantAward ? [pickSent(c, /已於 .* 決標|流標|已取消/), pickSent(c, /案號/)] : [pickSent(c, /案號/), pickSent(c, /投標截止日/), ...(focus.length ? [pickSent(c, /已於 .* 決標|流標|已取消/)] : [])];
      for (const t of sents) if (t) picked.push({ text: t, cite: [c.id], chunk: c, slot: 0, score: 9 });
    }
    result.procurement = { mode: focus.length ? 'focus' : wantAward ? 'award' : 'list', structured: true, items: list.map((c) => ({ id: c.contentId, title: c.title, tenderNo: c.tenderNo, requestingUnitName: c.requestingUnitName, budgetNtd: c.budgetNtd, deadlineAt: c.deadlineAt, openingAt: c.openingAt, url: c.url, pccUrl: c.pccUrl ?? null, stage: tenderStageNow(c) })) };
    return structuredFinish(result, picked, list, { required: ['deadline'], markClosed: !wantAward });
  }

  // ── 拒答 ──
  function noMatchActions(LL) {
    return [
      { label: tr(LL, '撥打 1922', 'Call 1922'), href: 'tel:1922', kind: 'hotline' },
      { label: tr(LL, '傳染病與防疫主題', 'Diseases index'), href: '/diseases/', kind: 'link' },
      { label: tr(LL, '網站導覽', 'Site map'), href: '/sitemap-page/', kind: 'link' },
    ];
  }
  function setRefusal(result, kind, ruleId, actions = null) {
    const LL = result.lang;
    const copy = refusalCopy(kind, result.lang);
    const d = diseaseById.get(result.disease);
    const related = [];
    if (d && (d.hasPage || d.page) && !['prompt-injection', 'harmful', 'privacy', 'media', 'impersonation', 'opinion'].includes(kind)) {
      related.push({ label: tr(LL, `${d.name}：症狀與警示徵象`, `${d.nameEn ?? d.name}: symptoms and warning signs`), href: `/diseases/${d.slug}/#symptoms` });
      related.push({ label: tr(LL, `${d.name}：我該怎麼辦`, `${d.nameEn ?? d.name}: what to do`), href: `/diseases/${d.slug}/#what-to-do` });
    }
    const baseActions = {
      emergency: [{ label: tr(LL, '撥打 119', 'Call 119'), href: 'tel:119', kind: 'hotline' }, { label: tr(LL, '撥打 1922', 'Call 1922'), href: 'tel:1922', kind: 'hotline' }],
      media: [{ label: tr(LL, '聯絡公關室', 'Public Relations Office'), href: '/about/#pr', kind: 'link' }],
      forecast: [{ label: tr(LL, '看疫情態勢', 'Current situation'), href: '/situation/', kind: 'link' }, { label: tr(LL, '看開放資料與統計', 'Open data & statistics'), href: '/data/', kind: 'link' }],
      'prompt-injection': [{ label: tr(LL, '重新提問', 'Ask again'), href: '/ask/', kind: 'link' }],
      impersonation: [{ label: tr(LL, '看最新新聞稿', 'Latest press releases'), href: '/news/', kind: 'link' }],
      opinion: [{ label: tr(LL, '民意信箱', 'Public opinion mailbox'), href: 'https://www.cdc.gov.tw/Mailbox/Index', kind: 'external' }],
    };
    result.refused = true;
    result.refusal = {
      kind, ruleId, title: copy.title, text: copy.text,
      actions: actions ?? baseActions[kind] ?? [{ label: tr(LL, '撥打 1922', 'Call 1922'), href: 'tel:1922', kind: 'hotline' }],
      relatedDisease: d ? { id: d.id, name: d.name, slug: d.slug } : null, related,
    };
    if (!result.refusal.actions.some((a) => a.href === 'tel:1922') && !['prompt-injection', 'impersonation', 'no-open-job', 'no-job-result', 'no-open-tender'].includes(kind)) result.refusal.actions.push({ label: tr(LL, '撥打 1922', 'Call 1922'), href: 'tel:1922', kind: 'hotline' });
    result.sentences = []; result.sources = [];
    return result;
  }

  function auditId() {
    const d = (today ?? now().toISOString().slice(0, 10)).replace(/-/g, '');
    const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let x = ''; for (let i = 0; i < 4; i++) x += A[Math.floor(random() * A.length)];
    return `A-${d}-${x}`;
  }

  function actionsFor(result, entities, sit) {
    const LL = result.lang;
    const a = [];
    const d = diseaseById.get(result.disease);
    const peak = sit?.items?.some((i) => i.status === 'peak');
    const vacc = entities.vaccines[0] ? vaccines.find((v) => v.id === entities.vaccines[0].id) : null;
    switch (result.intent) {
      case 'symptoms':
        if (d) a.push({ label: tr(LL, `看${d.name}警示徵象`, `Warning signs of ${d.nameEn ?? d.name}`), href: `/diseases/${d.slug}/#symptoms`, kind: 'link' });
        a.push({ label: tr(LL, '撥打 1922', 'Call 1922'), href: 'tel:1922', kind: 'hotline' });
        break;
      case 'vaccine':
        if (ANTIVIRAL_RE.test(result.query ?? '')) a.push({ label: tr(LL, '查附近有流感抗病毒藥劑的院所', 'Find clinics with flu antivirals'), href: vaxmapHref('antiviral', LL), kind: 'external' });
        else if (vacc && !VAXMAP_GROUP_OF[vacc.id]) a.push({ label: tr(LL, '接種資訊（vaxmap）', 'Vaccination info (vaxmap)'), href: vaxmapHref(null, LL, { info: true, anchor: 'where' }), kind: 'external' });
        else a.push({ label: tr(LL, '查附近接種點', 'Find a vaccination site'), href: vaxmapHref(VAXMAP_GROUP_OF[vacc?.id] ?? VAXMAP_GROUP_OF_DISEASE[result.disease] ?? null, LL), kind: 'external' });
        // 第四十輪：問「去哪裡打」⇒ 接種點連結是答案本身，固定排第一（疫苗頁有 whereUrl 時用 whereUrl；高峰期的 1922 排在它後面）
        if (result.whereAsk) {
          const i = a.findIndex((x) => x.kind === 'external');
          if (i >= 0) { const [w] = a.splice(i, 1); if (vacc?.whereUrl && !VAXMAP_GROUP_OF[vacc.id]) w.href = vacc.whereUrl; a.unshift({ ...w, where: true }); }
        }
        // 問句帶年齡／身分：接在「查附近接種點」之後，開啟疫苗接種時程地圖並帶入年齡（#age=65、#age=m12）
        if (result.ageProfile) { const h = ageHashOf(result.ageProfile); a.push({ label: tr(LL, '看完整疫苗時程地圖', 'See the full immunization schedule'), href: `/vaccines/schedule/${h ? `#age=${h}` : ''}`, kind: 'link' }); }
        if (vacc?.slug && vacc.hasPage !== false) a.push({ label: tr(LL, `看${vacc.name ?? vacc.title}公費對象`, `Who is eligible: ${vacc.nameEn ?? vacc.name ?? vacc.title}`), href: `/vaccines/${vacc.slug}/`, kind: 'link' });
        else a.push({ label: tr(LL, '看疫苗與預防接種', 'Vaccines & immunization'), href: '/tasks/vaccines/', kind: 'link' });
        break;
      case 'travel': {
        const c = entities.countries[0];
        a.push({ label: c ? tr(LL, `查${c.name}疫情等級`, `Travel notice: ${c.name}`) : tr(LL, '查目的地疫情等級', 'Destination travel notice'), href: c ? `/travel/${String(c.id).toUpperCase()}/` : '/travel/', kind: 'link' });
        a.push({ label: tr(LL, '找旅遊醫學門診', 'Find a travel medicine clinic'), href: 'https://www.cdc.gov.tw/Category/Page/ZgM7vwV3n6vDbXpq3MNgKg', kind: 'external' });
        break;
      }
      case 'situation':
        a.push({ label: tr(LL, '看完整趨勢', 'See full trend'), href: '/situation/', kind: 'link' });
        if (sit?.items?.some((i) => i.disease === 'disease.influenza')) {
          a.push({ label: tr(LL, '查附近流感疫苗接種點', 'Find a flu vaccination site'), href: vaxmapHref('flu', LL), kind: 'external' });
          a.push({ label: tr(LL, '查附近有抗病毒藥劑的院所', 'Find clinics with flu antivirals'), href: vaxmapHref('antiviral', LL), kind: 'external' });
          a.push({ label: tr(LL, '公費抗病毒藥劑使用對象', 'Who gets publicly funded antivirals'), href: '/diseases/influenza/#treatment', kind: 'link' });
        }
        break;
      case 'professional':
        if (d) a.push({ label: tr(LL, `${d.name}病例定義與通報`, `${d.nameEn ?? d.name}: case definition & reporting`), href: `/pro/diseases/${d.slug}/`, kind: 'link' });
        a.push({ label: tr(LL, '文件版本異動', 'Document version changes'), href: '/documents/', kind: 'link' });
        break;
      case 'notify': // 「怎麼通報」走檢索（群聚通報、法定傳染病通報服務）時
      case 'apply': {
        if (result.intent === 'notify') a.push({ label: tr(LL, '前往通報專區', 'Reporting'), href: '/report/', kind: 'link' });
        const svcSrc = (result.sources ?? []).find((s) => s.type === 'service');
        const sv = svcSrc ? serviceById.get(svcSrc.contentId) : null;
        const slug = svcSrc?.slug ?? sv?.slug ?? null;
        const forms = (svcSrc?.forms?.length ? svcSrc.forms : sv?.forms) ?? [];
        const applyUrl = svcSrc?.applyUrl ?? sv?.applyUrl ?? null;
        if (svcSrc) a.push({ label: tr(LL, '前往申請頁', 'Go to application page'), href: slug ? `/apply/${slug}/` : String(svcSrc.url).replace(/#.*$/, ''), kind: 'link' });
        if (forms[0]?.href) a.push({ label: tr(LL, '下載表單', 'Download form'), href: forms[0].href, kind: /^https?:/.test(forms[0].href) ? 'external' : 'link', format: forms[0].format ?? null });
        if (applyUrl) a.push({ label: tr(LL, '線上申請', 'Apply online'), href: applyUrl, kind: /^https?:/.test(applyUrl) ? 'external' : 'link' });
        if (!svcSrc) a.push({ label: tr(LL, '看全部申請項目', 'All applications & services'), href: '/apply/', kind: 'link' });
        break;
      }
      case 'lab': {
        const lt = (result.sources ?? []).find((s) => s.type === 'labtest');
        if (lt) a.push({ label: tr(LL, `看${lt.title.split(' · ')[0]}`, 'See lab test details'), href: String(lt.url).replace(/#.*$/, ''), kind: 'link' });
        if (result.view !== 'pro') a.push({ label: tr(LL, '以專業模式查詢', 'Ask in professional mode'), href: `/ask/?q=${encodeURIComponent(result.query)}&view=pro`, kind: 'link' });
        a.push({ label: tr(LL, '檢驗專區', 'Laboratory testing'), href: '/lab/', kind: 'link' });
        a.push({ label: tr(LL, '檢驗委託申請', 'Request lab testing'), href: '/apply/', kind: 'link' });
        break;
      }
      case 'notice': {
        const open = (result.sources ?? []).find((s) => NOTICE_TYPES.includes(s.newsType) && !s.closed && s.applyUrl);
        a.push({ label: tr(LL, '看全部公告', 'All notices'), href: '/notices/', kind: 'link' });
        if (open) a.push({ label: tr(LL, open.newsType === 'procurement' ? '前往投標網站' : '前往報名網站', 'Apply / bid'), href: open.applyUrl, kind: /^https?:/.test(open.applyUrl) ? 'external' : 'link' });
        break;
      }
      case 'careers': {
        const jobSrc = (result.sources ?? []).find((s) => s.type === 'job');
        if (jobSrc?.jobStage === 'open' && jobSrc.applyHref) a.push({ label: tr(LL, jobSrc.applyExternal ? '前往報名網站' : '線上報名', 'Apply'), href: jobSrc.applyHref, kind: /^https?:/.test(jobSrc.applyHref) ? 'external' : 'link' });
        if (jobSrc) a.push({ label: tr(LL, '看職缺詳情', 'Vacancy details'), href: String(jobSrc.url).replace(/#.*$/, ''), kind: 'link' });
        a.push({ label: tr(LL, '看全部職缺', 'All vacancies'), href: '/careers/', kind: 'link' });
        return a.slice(0, 4); // 招募問題不附 1922
      }
      case 'procurement': {
        const tSrc = (result.sources ?? []).find((s) => s.type === 'tender');
        if (tSrc) a.push({ label: tr(LL, '看標案詳情', 'Tender details'), href: String(tSrc.url).replace(/#.*$/, ''), kind: 'link' });
        if (tSrc?.pccUrl && tSrc.tenderStage === 'open') a.push({ label: tr(LL, '政府電子採購網', 'Government e-Procurement System'), href: tSrc.pccUrl, kind: 'external' });
        a.push({ label: tr(LL, '看全部採購公告', 'All procurement notices'), href: '/procurement/', kind: 'link' });
        return a.slice(0, 4);
      }
      case 'stats':
        if (result.stats) a.push({ label: tr(LL, '下載資料集', 'Download dataset'), href: result.sources[0]?.url, kind: 'external' });
        a.push({ label: tr(LL, '開放資料與統計', 'Open data & statistics'), href: '/data/', kind: 'link' });
        break;
      default:
        if (d) a.push({ label: tr(LL, `看${d.name}完整頁面`, `${d.nameEn ?? d.name}: full page`), href: `/diseases/${d.slug}/`, kind: 'link' });
    }
    if ((peak || result.intent === 'symptoms') && !a[0]?.where) { if (!a.some((x) => x.href === 'tel:1922')) a.unshift({ label: tr(LL, '撥打 1922', 'Call 1922'), href: 'tel:1922', kind: 'hotline' }); }
    else if (!a.some((x) => x.href === 'tel:1922')) a.push({ label: tr(LL, '撥打 1922', 'Call 1922'), href: 'tel:1922', kind: 'hotline' });
    return a.slice(0, 4);
  }

  /** 你可能也想知道：同疾病／同任務 FAQ 標題挑 3 個（排除已引用） */
  function relatedQuestions(result, n = 3) {
    const cited = new Set((result.sources ?? []).map((s) => s.contentId));
    const dIds = new Set(result.diseases ?? (result.disease ? [result.disease] : []));
    const task = INTENT_TASK[result.intent];
    const pool = faq.length ? faq.map((f) => ({ id: f.id, q: f.question ?? f.title, diseases: f.diseases ?? [], tasks: f.tasks ?? [], url: f.url ?? `/faq/${String(f.id).replace(/^faq\./, '')}/`, whitelist: f.governance?.whitelist ?? f.gov?.whitelist?.effective ?? true }))
      : index.filter((c) => c.type === 'faq' && (c.lang ?? 'zh-TW') === 'zh-TW').map((c) => ({ id: c.contentId, q: c.question ?? c.title, diseases: c.diseases ?? [], tasks: c.tasks ?? [], url: c.url, whitelist: true }));
    const seen = new Set();
    const scored = pool.filter((f) => f.q && f.whitelist !== false && !cited.has(f.id) && !seen.has(f.id) && seen.add(f.id)).map((f) => {
      let s = 0;
      if (f.diseases.some((d) => dIds.has(d))) s += 2;
      if (task && f.tasks.includes(task)) s += 1;
      return { ...f, s };
    }).filter((f) => f.s > 0).sort((a, b) => b.s - a.s || a.q.localeCompare(b.q));
    return scored.slice(0, n).map((f) => ({ q: f.q, id: f.id, url: f.url }));
  }

  function traditionalList(q, view, lang, n = 10) {
    const pool = poolFor(view, 'zh-TW');
    const model = bm25For(pool.key, pool.chunks);
    const expanded = expandQuery(q, lang);
    const qw = queryWeights(q, expanded);
    const all = model.docs.map((d) => ({ c: d.c, s: bm25Score(model, d, qw) })).sort((a, b) => b.s - a.s);
    const topS = all[0]?.s ?? 0;
    const scored = all.filter((x) => x.s > 0.5 && x.s >= topS * 0.25);
    const out = []; const seen = new Set();
    for (const { c, s } of scored) {
      if (seen.has(c.contentId) || c.isCurrent === false) continue;
      seen.add(c.contentId);
      out.push({ id: c.contentId, title: c.docTitle ?? c.title.split(' · ')[0], summary: c.summary ?? c.sentences?.[0] ?? '', url: c.url.replace(/#.*$/, ''), reviewedAt: c.reviewedAt, ownerName: c.ownerName, type: c.type, score: Math.round(s * 100) / 100 });
      if (out.length >= n) break;
    }
    return out;
  }

  /**
   * 申請「怎麼辦」：以最相關申請服務的步驟塊為主體（每步一句，依序），再補應備文件、（問到時）天數／費用。
   * 句子仍逐字出自索引片段；步驟塊不在檢索結果時從同一索引池取出並列入 retrieved。
   */
  const APPLY_HOW = /(怎麼|如何|流程|步驟|程序|方式|怎樣|去哪|哪裡)/;
  // 第四十輪（issue #78）：強制套用某服務的步驟前，先確認這個服務真的是問句在問的東西——服務標題或關鍵字要有問句詞
  // （去掉「申請、辦理、流程」這類每個服務都有的泛用詞），且服務片段分數不低於最佳片段的 SERVICE_MIN_RATIO。否則「外籍勞工健康檢查與健保怎麼辦理」會被套上結核病補助的步驟、
  // 「兒童健康手冊在哪裡」會被套上預防接種受害救濟的步驟；不符時退回一般組句（仍偏好服務片段）。
  const SERVICE_MIN_RATIO = 0.6;
  const SERVICE_GENERIC_TOKENS = new Set(['申請', '辦理', '流程', '步驟', '方式', '程序', '表單', '補發', '證明']);
  function serviceMatches(q, c) {
    const qt = tokenize(String(q).replace(QUERY_FUNC_RE, ' '), { query: true }).filter((t) => !SERVICE_GENERIC_TOKENS.has(t));
    // 標題命中 1 個詞即可；只靠關鍵字（含建置時自動加入的單位名「健康服務中心」）要命中 2 個以上，避免一個泛用詞就套上步驟
    const title = new Set(tokenize(c.title)); const terms = new Set(tokenize((c.terms ?? []).join(' ')));
    return qt.some((t) => title.has(t)) || new Set(qt.filter((t) => terms.has(t))).size >= 2;
  }
  function applyCompose(q, chunks, picked, view, sourceMap, result) {
    const top = chunks.find((c) => c.type === 'service');
    if (!top || !APPLY_HOW.test(q)) return picked;
    // 服務片段的分數遠低於最佳片段（已含 apply 意圖對服務的加權仍落後）＝站內有更切題的非服務內容
    if (!(top._anchor || serviceMatches(q, top)) || (top._score ?? 0) < (chunks[0]._score ?? 0) * SERVICE_MIN_RATIO) { result.guards.push({ kind: 'apply-steps-skipped', id: top.id, reason: 'service-not-asked' }); return picked; }
    const pool = poolFor(view, 'zh-TW').chunks;
    const get = (key) => chunks.find((c) => c.id === `${top.contentId}#${key}`) ?? pool.find((c) => c.id === `${top.contentId}#${key}`);
    const steps = get('steps');
    if (!steps) return picked;
    const use = (c) => { if (!sourceMap.has(c.id)) { sourceMap.set(c.id, sourceOf(c)); result.retrieved = [...(result.retrieved ?? []), c]; } return c; };
    const out = steps.sentences.slice(0, 5).map((t, i) => ({ text: t, cite: [use(steps).id], slot: 0, score: 9 - i * 0.01, chunk: steps }));
    const docs = get('documents');
    if (docs && !/(幾天|多久|費用|多少錢)/.test(q)) out.push({ text: docs.sentences[0], cite: [use(docs).id], slot: 1, score: 8, chunk: docs });
    const sla = get('sla');
    if (sla && /(幾天|多久|費用|多少錢|收費|免費)/.test(q)) for (const t of sla.sentences.filter((x) => /(天|費)/.test(x)).slice(0, 2)) out.push({ text: t, cite: [use(sla).id], slot: 1, score: 8, chunk: sla });
    result.guards.push({ kind: 'apply-steps', id: steps.id });
    return out.slice(0, 7);
  }

  /**
   * 公告列表：沒問細節（資格、名額、預算…）時，每則公告取一句「截止日」結構化句；進行中在前（依截止日），已截止在後。
   */
  const NOTICE_DETAIL = /(資格|條件|名額|預算|金額|字號|案號|待遇|薪|工作內容|地點|怎麼報名|如何報名|怎麼投標)/;
  function noticeCompose(q, chunks, picked) {
    if (NOTICE_DETAIL.test(q)) return picked;
    const ns = chunks.filter((c) => NOTICE_TYPES.includes(c.newsType) && c.deadlineAt);
    if (!ns.length) return picked;
    ns.sort((a, b) => (closedNow(a) - closedNow(b)) || (closedNow(a) ? b.deadlineAt.localeCompare(a.deadlineAt) : a.deadlineAt.localeCompare(b.deadlineAt)));
    const out = [];
    for (const c of ns.slice(0, 4)) {
      const t = (c.sentences ?? []).find((x) => x.includes(c.deadlineAt));
      if (t) out.push({ text: t, cite: [c.id], slot: 0, score: 9, chunk: c });
    }
    return out.length ? out : picked;
  }

  /**
   * 公告句後處理：
   *  - notice 意圖：每則被引用的公告至少帶出一句截止日句（索引建置時產生的結構化句）；
   *  - 任何意圖：出自已截止公告的句子加「（已截止）」（以引擎 today 再算一次，避免索引過期）。
   */
  function markNotices(picked, result) {
    const out = [...picked];
    if (result.intent === 'notice') {
      const seen = new Set();
      for (const p of picked) {
        const c = p.chunk; if (!c || !NOTICE_TYPES.includes(c.newsType) || seen.has(c.id)) continue;
        seen.add(c.id);
        if (!c.deadlineAt || out.some((x) => x.chunk?.id === c.id && x.text.includes(c.deadlineAt))) continue;
        const ds = (c.sentences ?? []).find((x) => x.includes(c.deadlineAt));
        if (ds) out.splice(out.indexOf(p), 0, { ...p, text: ds, cite: [c.id], slot: 0, score: p.score + 1 });
      }
    }
    return out.map((p) => {
      const c = p.chunk;
      if (c && (NOTICE_TYPES.includes(c.newsType) || ((c.type === 'job' || c.type === 'tender') && /(報名期間|投標截止日)/.test(p.text))) && closedNow(c)) {
        if (!p.text.includes('已截止')) return { ...p, text: `${p.text}${CLOSED_MARK}`, closed: true };
        return { ...p, closed: true };
      }
      return p;
    });
  }

  // ───────────── answer ─────────────
  /** §39.4：句子命中建置時標的 chunk.conflicts ⇒ result.conflicts、兩句都在時優先者排前；不刪句 */
  function noteConflicts(picked, result) {
    const at = (arr, x) => arr.findIndex((q) => q.chunk?.contentId === x.contentId && q.text === x.sentence);
    const notes = new Map();
    for (const p of picked) for (const x of p.chunk?.conflicts ?? []) {
      if (x.sentence !== p.text || notes.has(x.id)) continue;
      const [prefer, other] = x.prefer === 'self' ? [x.self, x.other] : [x.other, x.self];
      notes.set(x.id, { id: x.id, unit: x.unit, prefer, other, bothShown: at(picked, x.other) >= 0 });
    }
    if (!notes.size) return picked;
    result.conflicts = [...notes.values()];
    const out = [...picked];
    for (const n of result.conflicts) {
      result.guards.push({ kind: 'conflict-noted', id: n.id, unit: n.unit });
      const wi = at(out, n.prefer), li = at(out, n.other);
      if (li >= 0 && wi > li) out.splice(li, 0, ...out.splice(wi, 1));
    }
    return out;
  }

  function answer(rawQuery, opts = {}) {
    const { lang = 'zh-TW', view = 'public', disease: presetDisease = null, mode, forceIntent = null } = opts;
    const LL = lang;
    const pii = maskPIIDetailed(String(rawQuery ?? '').trim().slice(0, 500));
    const q = pii.text;
    const result = {
      query: q, lang, view, intent: 'unknown', intentReasons: [], intentScores: {}, refused: false, disease: null, diseases: [], entities: { diseases: [], vaccines: [], countries: [] },
      termNotes: [], sentences: [], sources: [], actions: [], related: [], guards: [], confidence: 0, relevance: null, completeness: null,
      auditId: auditId(), mode: mode ?? aiStatus.mode ?? 'extractive', pii: pii.hits,
      disclosure: { mode: mode ?? aiStatus.mode ?? 'extractive', provider: null, model: null, generatedAt: now().toISOString() },
    };
    if (pii.hits.length) result.guards.push({ kind: 'pii-masked', hits: pii.hits });
    if (!q) return result;

    // 10 暫停
    if (aiStatus.paused) {
      result.paused = true; result.intent = 'paused'; result.pausedReason = aiStatus.reason ?? '';
      result.list = traditionalList(q, view, lang, 10);
      return result;
    }

    // 1 注入偵測
    const inj = detectInjection(q);
    if (inj.detected) { result.injection = inj; result.guards.push({ kind: 'prompt-injection', ruleId: inj.ruleId }); }

    // 實體與時間
    const entities = detectEntities(q);
    if (presetDisease && diseaseById.has(presetDisease) && !entities.diseases.some((d) => d.id === presetDisease)) entities.diseases.push({ id: presetDisease, name: diseaseById.get(presetDisease).name, pos: 999, preset: true });
    result.entities = entities;
    result.diseases = entities.diseases.map((d) => d.id);
    result.disease = entities.diseases.find((d) => !d.preset && !d.derived)?.id ?? entities.diseases.find((d) => !d.derived)?.id ?? null;
    // 出國：目的地旅遊疫情建議列出的疾病，也作為檢索實體（問泰國 → 帶出登革熱的預防內容）
    if (entities.countries.length && !entities.diseases.length) {
      for (const c of travelFor(entities)) for (const e of c.entries) for (const dn of e.diseaseNames) {
        for (const d of detectEntities(dn).diseases) if (!entities.diseases.some((x) => x.id === d.id)) entities.diseases.push({ ...d, pos: 900, derived: true });
      }
    }
    const range = parseTimeRange(q);
    const hasRange = range.n != null || range.from != null || (range.years.length > 0 && !/(出生|年次|以後|以前|之後|之前|born|sinh năm|sinh)/i.test(q));
    result.timeRange = hasRange ? range : null;

    // 2 意圖
    const ci = classifyIntent(q, { view, hasTimeRange: hasRange, hasDisease: !!result.disease, hasCountry: entities.countries.length > 0 });
    result.intent = ci.intent; result.intentReasons = ci.reasons; result.intentScores = ci.scores;
    if (forceIntent) { result.intent = forceIntent; result.intentReasons.push(`forced.${forceIntent}`); }
    if (VAX_WHERE_RE.test(q) && !RECORD_RE.test(q)) result.whereAsk = true;
    // 第七輪：問句指名某職缺／標案並問細節（「防疫醫師的資格」「官網改版標案的規格」）⇒ careers／procurement
    if (!forceIntent && !['careers', 'procurement', 'rumor', 'stats', 'notify'].includes(result.intent)) {
      if (CAREERS_DETAIL_RE.test(q) && overviewChunks('job', view).some((c) => titleHits(q, c.title) >= 3 || (c.focusTerms ?? []).some((k) => q.includes(k)))) { result.intent = 'careers'; result.intentReasons.push('car.title-match'); }
      else if (PROCUREMENT_DETAIL_RE.test(q) && overviewChunks('tender', view).some((c) => focusOf(q, c))) { result.intent = 'procurement'; result.intentReasons.push('prc.title-match'); }
    }

    // 3 拒答（謠言查證頁貼上的是網傳訊息本身：只套用注入、危害、隱私、冒名規則）
    const RUMOR_RULE_KINDS = new Set(['prompt-injection', 'harmful', 'privacy', 'impersonation']);
    for (const r of REFUSAL_RULES) {
      if (forceIntent === 'rumor' && !RUMOR_RULE_KINDS.has(r.kind)) continue;
      const hit = r.test ? r.test(q) : r.re.test(q);
      if (hit) { result.intentReasons.push(r.id); return setRefusal(result, r.kind, r.id); }
    }

    const expanded = expandQuery(q, lang);
    result.termNotes = expanded.notes;

    // 7 謠言
    if (result.intent === 'rumor') return factCheck(q, result);

    // 6 統計
    if (result.intent === 'stats') {
      const st = statsAnswer(q, entities, range, lang);
      if (st && !st.empty) {
        result.stats = st.stats; result.sources = [{ ...st.source, n: 1 }];
        result.sentences = st.sentences.map((s) => ({ ...s, n: [1] }));
        result.confidence = 0.9; result.completeness = { required: ['number'], covered: ['number'], missing: [], score: 1 };
        result.actions = actionsFor(result, entities, null);
        result.related = relatedQuestions(result);
        return result;
      }
      if (st?.empty) return setRefusal(result, 'no-data', 'ref.no-data', [{ label: tr(LL, '開放資料與統計', 'Open data & statistics'), href: '/data/', kind: 'link' }]);
    }

    // 檢驗（民眾模式）：檢驗項目表只在專業索引 ⇒ 導向專業模式／檢驗專區／疾病頁診斷與治療，不拿民眾片段硬湊
    if (result.intent === 'lab' && view !== 'pro') {
      const dz = diseaseById.get(result.disease);
      const acts = [
        { label: tr(LL, '以專業模式查詢', 'Ask in professional mode'), href: `/ask/?q=${encodeURIComponent(q)}&view=pro`, kind: 'link' },
        { label: tr(LL, '檢驗專區', 'Laboratory testing'), href: dz ? `/lab/${dz.slug}/` : '/lab/', kind: 'link' },
        ...(dz && (dz.hasPage || dz.page) ? [{ label: tr(LL, `看${dz.name}診斷與治療`, `${dz.nameEn ?? dz.name}: diagnosis & treatment`), href: `/diseases/${dz.slug}/#treatment`, kind: 'link' }] : []),
      ];
      return setRefusal(result, 'pro-only', 'ref.lab-pro-only', acts);
    }

    // 通報時限：主檔結構化回答（不走檢索）
    if (result.intent === 'notify') {
      const na = notifyAnswer(q, result, entities);
      if (na) return na;
    }

    // 第七輪：人才招募／採購公告（結構化列表、「誰錄取」只給結果頁連結）；細節問句才走檢索
    // 第二十五輪：問句有主題詞（透析膜）卻沒有任何職缺／標案的標題或內文提到 ⇒ 查無，不列不相關的清單
    if ((result.intent === 'careers' || result.intent === 'procurement') && noticeTopicMiss(q, result.intent === 'careers' ? 'job' : 'tender', view)) {
      result.relevance = 0; result.guards.push({ kind: 'no-match', reason: 'notice-topic' });
      const href = result.intent === 'careers' ? '/careers/' : '/procurement/';
      return setRefusal(result, 'no-match', 'ref.no-match.notice', [...noMatchActions(LL).slice(0, 1), { label: tr(LL, result.intent === 'careers' ? '看全部職缺' : '看全部採購公告', result.intent === 'careers' ? 'All vacancies' : 'All procurement notices'), href, kind: 'link' }]);
    }
    if (result.intent === 'careers') { const ca = careersAnswer(q, result, view); if (ca) return ca; }
    if (result.intent === 'procurement') { const pa = procurementAnswer(q, result, view); if (pa) return pa; }

    // 跨疫苗彙整：問句帶年齡／身分，且沒有指定單一疫苗（或明問「哪些／什麼疫苗」）⇒ 疫苗接種時程主檔結構化回答
    const profile = ageProfileOf(q);
    if (profile) result.ageProfile = profile;
    if (profile && !forceIntent && result.intent === 'unknown' && SCHEDULE_VACCINE_RE.test(q)) { result.intent = 'vaccine'; result.intentReasons.push('vac.age-profile'); }
    // 第三十七輪：醫事人員檢視會把疫苗問句改判成 professional（pro.view），年齡＋「哪些疫苗」卻沒有任何專業詞時，仍是在問時程 ⇒ 一樣走時程主檔
    if (profile && !forceIntent && view === 'pro' && result.intent === 'professional' && WHICH_VACCINE_RE.test(q) && (result.intentScores.vaccine ?? 0) > 0
      && !result.intentReasons.some((r) => r.startsWith('pro.') && !['pro.view', 'pro.view-override'].includes(r))) { result.intent = 'vaccine'; result.intentReasons.push('vac.age-profile-pro'); }
    // 第四十輪（issue #77）：「漏打／錯過／補打」問的是補接種原則，不是年齡時程表；整張時程表會蓋掉真正的答案（補接種 FAQ） ⇒ 不走時程主檔
    const catchUp = CATCHUP_RE.test(q);
    if (catchUp) result.intentReasons.push('vac.catch-up');
    // 第四十八輪（issue #94）：中文主題錨點。中文問句看原句＋口語改寫（晚了兩個月才打 → 漏打），外語問句看跨語言對應出來的中文詞（nakagat → 動物咬傷）；
    // 不看詞彙主檔同義詞展開（MMR → 麻疹腮腺炎德國麻疹混合疫苗是實體，已由疾病／疫苗實體處理）。問句點名了某個主題（新生兒＋呼吸道融合病毒）⇒ 那則內容才是答案，不改走年齡時程表
    const crossZh = expanded.added.filter((w) => /[\u3400-\u9fff]/.test(w)).join(' ');
    const viaRules = (rules) => rules.filter(([re]) => re.test(q)).map((r) => r[1]).join(' ');
    const zhA = zhAnchors(lang === 'zh-TW' ? `${q} ${viaRules(PARAPHRASE)}` : viaRules(CROSS_LANG));
    const anchorIds = new Set(zhA.flatMap((a) => [...a.ids]));
    if (zhA.length) result.guards.push({ kind: 'topic-anchor', terms: zhA.map((a) => a.t) });
    if (profile && result.intent === 'vaccine' && !catchUp && !zhA.length && !ANTIVIRAL_RE.test(q) && (!entities.vaccines.length || WHICH_VACCINE_RE.test(q))) {
      const sa = scheduleAnswer(q, result, entities, profile);
      if (sa) return sa;
    }

    // 4 檢索（同語言 reviewed 優先，否則中文）
    const k = view === 'pro' ? 10 : 8;
    const hasEntity = !!(entities.diseases.length || entities.vaccines.length || entities.countries.length);
    // 第四十輪（issue #75）：外語問句「先對應到主題，再檢索」。疾病／疫苗／國家由詞彙主檔對應到 ID（detectEntities，檢索時已用 ID 篩片段）；
    // 其他主題（移工、健保、接種紀錄）由 CROSS_LANG 的主題錨點對應到中文詞。回答的前 3 塊片段至少要講到其中一個錨點，否則不拿別的主題充數
    //（「移工的健檢與健保」站內只有健檢、沒有健保 ⇒ 仍回答健檢那一半，與中文問句同樣處理）。
    const anchors = lang !== 'zh-TW' ? topicAnchorsOf(q) : [];
    // 錨點強度：前 3 塊有一塊「標題」講到錨點＝2（這塊就是在講這個主題）；只在內文順帶提到＝1；都沒有＝0
    const hit = (a, t, zh) => (zh ? a.zh.some((w) => t.includes(w)) : a.re.test(t));
    const anchorStrength = (cs, zh) => Math.max(0, ...cs.slice(0, 3).map((c) => Math.max(0, ...anchors.map((a) => (hit(a, c.title ?? '', zh) ? 2 : hit(a, c.text ?? '', zh) ? 1 : 0)))));
    const anchorOk = (cs, zh) => !anchors.length || anchorStrength(cs, zh) > 0;
    let chunks = [];
    let zhChunks = null;
    let topicConfirmed = false;
    const zhRetrieve = () => (zhChunks ??= retrieve(q, { view, lang: 'zh-TW', k, intent: result.intent, entities, expanded, presetDisease, guards: result.guards, anchorIds }));
    if (lang !== 'zh-TW') {
      chunks = retrieve(q, { view, lang, k, intent: result.intent, entities, expanded, presetDisease, guards: result.guards, anchorIds });
      if (chunks.length && chunks[0]._score < 2.5) chunks = [];
      // 主題已確認：問句有錨點，且同語言前 3 塊有一塊「標題」就在講這個主題（英文來源的來臺專區）。
      // 這時相關度偏低只代表問句用詞（what should I do／precautions）和片段不同，不是主題不對 ⇒ 不因相關度門檻丟掉（下方的查無門檻同理）
      topicConfirmed = anchors.length > 0 && chunks.length > 0 && anchorStrength(chunks, false) === 2;
      // 同語言片段沒講到主題錨點（越南文問移工健檢，越南文語料只有麻疹），或過不了相關度門檻 ⇒ 改用中文原文
      // 第四十八輪（issue #101）：同語言片段的相關度低到會被判「外語低相關查無」時，也改試中文原文（泰文問登革熱症狀，泰文語料只有一則登革熱謠言澄清）
      const sl = chunks.length && !topicConfirmed && relevanceOf(q, chunks, chunks.model, hasEntity);
      if (chunks.length && (!anchorOk(chunks, false) || (sl && (sl.reason || sl.relevance < RELEVANCE.lowBelow)))) { result.guards.push({ kind: 'same-lang-dropped', lang }); chunks = []; }
      // 同語言片段只是「順帶提到」主題（英文 MOU 新聞稿提到 migrant worker health），中文有一塊標題就在講這個主題 ⇒ 用中文原文
      if (chunks.length && anchors.length && anchorStrength(zhRetrieve(), true) > anchorStrength(chunks, false)) { result.guards.push({ kind: 'same-lang-weaker-topic', lang }); chunks = []; }
    }
    if (!chunks.length) {
      chunks = zhRetrieve();
      if (lang !== 'zh-TW' && chunks.length) result.translationNote = 'showing-source';
      if (lang !== 'zh-TW' && chunks.length && !anchorOk(chunks, true)) { result.guards.push({ kind: 'topic-anchor-miss', anchors: anchors.map((a) => a.zh[0]) }); const none = []; none.qWeights = chunks.qWeights; none.model = chunks.model; chunks = none; }
      // 第四十八輪（issue #101）：外語問句改用中文原文時，主題已確認＝問句點名的疾病（詞彙主檔各語言名稱對應出來的）就是最佳片段的疾病，
      // 或中文錨點（被狗咬 → 動物咬傷）命中前 3 塊。這時相關度偏低只是外語與中文用詞對不上，照樣以中文原文回答並附 translationSource 說明
      const d0 = entities.diseases.find((d) => !d.derived)?.id;
      topicConfirmed = lang !== 'zh-TW' && chunks.length > 0 && !!d0 && (chunks[0].diseases ?? []).includes(d0);
    }
    // 第四十八輪（issue #94／#101）：前 3 塊有主題錨點命中的內容（被鼬獾咬、晚了兩個月才打 → 漏打、外語「被狗咬」→ 動物咬傷）＝主題已確認，
    // 不因問句口語、字面涵蓋率低而判查無
    if (chunks.slice(0, 3).some((c) => anchorIds.has(c.contentId))) topicConfirmed = true;
    // 沒有疾病實體時：以最相關片段的疾病為主，不混入其他疾病的片段
    // 第四十八輪（issue #94）：問句有主題錨點時，以錨點命中的片段的疾病為主（「被鼬獾咬不用打疫苗嗎」是狂犬病，不是分數最高的孕婦接種 FAQ 的流感）
    const lead = chunks.find((c) => anchorIds.has(c.contentId) && c.diseases?.length) ?? chunks[0];
    if (!entities.diseases.length && lead && (lead.diseases ?? []).length && !['situation', 'stats', 'rumor'].includes(result.intent)) {
      const dom = new Set(lead.diseases);
      const kept = chunks.filter((c) => !(c.diseases ?? []).length || c.diseases.some((d) => dom.has(d)));
      kept.qWeights = chunks.qWeights; kept.model = chunks.model;
      chunks = kept;
      result.guards.push({ kind: 'dominant-disease', diseases: [...dom] });
    }
    // 第二輪：意圖對應型別有夠相關的片段時，優先只用該型別（apply → service、lab → labtest、notice → 公告）
    //   問句線索：「影片」→ media、「哪一期」→ publication
    const PREFER = { apply: (c) => c.type === 'service', lab: (c) => c.type === 'labtest', notice: (c) => NOTICE_TYPES.includes(c.newsType), notify: (c) => c.type === 'service', careers: (c) => c.type === 'job', procurement: (c) => c.type === 'tender' };
    const preferFn = PREFER[result.intent] ?? (MEDIA_CUE.test(q) ? (c) => c.type === 'media' : RESEARCH_CUE.test(q) ? (c) => c.type === 'research' : PUB_CUE.test(q) ? (c) => c.type === 'publication' : null);
    if (preferFn && chunks.length) {
      const pref = chunks.filter(preferFn);
      if (pref.length && pref[0]._score >= chunks[0]._score * 0.5) {
        // 使用者明說要影片／期刊 ⇒ 只用該型別；意圖推得的偏好 ⇒ 仍保留分數更高的其他片段
        const byCue = !PREFER[result.intent];
        // 「最新的影片」：依製作日排序加權（只轉述欄位，不推論）
        if (byCue && /(最新|新版|重製|最近)/.test(q) && pref[0].type === 'media') {
          const newest = pref.map((c) => c.producedAt ?? '').sort().at(-1);
          for (const c of pref) if (c.producedAt === newest) c._score = Math.round(c._score * 1.3 * 1000) / 1000;
          pref.sort((a, b) => b._score - a._score);
        }
        const kept = [...pref, ...(byCue ? [] : chunks.filter((c) => !preferFn(c) && c._score >= pref[0]._score))].slice(0, k);
        kept.sort((a, b) => b._score - a._score);
        kept.qWeights = chunks.qWeights; kept.model = chunks.model;
        if (kept.length < chunks.length) result.guards.push({ kind: 'prefer-type', intent: result.intent, type: pref[0].type, dropped: chunks.length - kept.length });
        chunks = kept;
      }
    }
    // 第七輪：問句指名某一則職缺／標案 ⇒ 只用那幾則的片段
    if ((result.intent === 'careers' || result.intent === 'procurement') && result.focusIds?.length) {
      const kept = chunks.filter((c) => result.focusIds.includes(c.contentId));
      if (kept.length) { kept.qWeights = chunks.qWeights; kept.model = chunks.model; if (kept.length < chunks.length) result.guards.push({ kind: 'focus', ids: result.focusIds, dropped: chunks.length - kept.length }); chunks = kept; }
    }
    // 第四十八輪（issue #95）：問句點名某支疫苗（皮蛇疫苗＝帶狀疱疹疫苗），同一疾病另有別支疫苗（水痘疫苗）時，
    // 不拿別支疫苗的內容回答（片段標了別支疫苗、或內文寫到別支疫苗名稱而沒寫到這一支）；剩下的片段都沒講到這支疫苗 ⇒
    // 說「本站尚無○○疫苗專頁」並連到時程表上這支疫苗的那一列，而不是答成別的疫苗。這支疫苗日後有頁面，它的片段自然會被留下來回答
    for (const ev of entities.vaccines) {
      const V = vaccines.find((x) => x.id === ev.id); if (!V) continue;
      const sib = vaccines.filter((x) => x.id !== V.id && (x.diseases ?? []).some((d) => (V.diseases ?? []).includes(d)));
      if (!sib.length) continue;
      const says = (c, v) => (c.vaccines ?? []).includes(v.id) || [v.name, v.title, ...(v.aliases ?? [])].some((n) => n && hayOf(c).replace(/\s+/g, '').includes(lc(n).replace(/\s+/g, '')));
      const kept = chunks.filter((c) => says(c, V) || !sib.some((x) => says(c, x)));
      if (!kept.some((c) => says(c, V))) {
        const row = scheduleItems.find((i) => i.vaccine === V.id);
        result.relevance = 0; result.guards.push({ kind: 'no-match', reason: 'vaccine-no-page', vaccine: V.id });
        setRefusal(result, 'no-match', 'ref.no-match.vaccine', row ? [{ label: tr(LL, `看時程表的${V.name}`, `${V.nameEn ?? V.name} in the immunization schedule`), href: `/vaccines/schedule/#${row.id}`, kind: 'link' }] : null);
        result.refusal.text = tr(LL, `本站尚無${V.name}專頁，請撥 1922 或洽衛生所。`, `This site has no page on the ${V.nameEn ?? V.name} yet. Please call the 1922 hotline or ask your local health centre.`);
        return result;
      }
      if (kept.length < chunks.length) { result.guards.push({ kind: 'sibling-vaccine-dropped', vaccine: V.id, dropped: chunks.length - kept.length }); kept.qWeights = chunks.qWeights; kept.model = chunks.model; chunks = kept; }
    }
    result.retrieved = chunks;

    // 公告意圖但檢索不到任何公告（全部截止、或尚未進白名單）⇒ 不拿無關片段硬湊，導向公告頁
    if (result.intent === 'notice' && !chunks.some((c) => NOTICE_TYPES.includes(c.newsType))) {
      result.list = traditionalList(q, view, lang, 5);
      return setRefusal(result, 'no-source', 'ref.no-notice', [{ label: tr(LL, '看全部公告', 'All notices'), href: '/notices/', kind: 'link' }, { label: tr(LL, '撥打 1922', 'Call 1922'), href: 'tel:1922', kind: 'hotline' }]);
    }

    // 職缺／採購細節問句檢索不到對應型別 ⇒ 導向列表頁，不拿無關片段硬湊
    if ((result.intent === 'careers' && !chunks.some((c) => c.type === 'job')) || (result.intent === 'procurement' && !chunks.some((c) => c.type === 'tender'))) {
      const href = result.intent === 'careers' ? '/careers/' : '/procurement/';
      return setRefusal(result, 'no-source', `ref.no-${result.intent}`, [{ label: tr(LL, result.intent === 'careers' ? '看全部職缺' : '看全部採購公告', result.intent === 'careers' ? 'All vacancies' : 'All procurement notices'), href, kind: 'link' }]);
    }

    // 第二十五輪：相關度閘門。態勢／旅遊有結構化資料可答時不套用（它們不靠檢索片段）
    // 第四十輪：外語問句改用中文片段回答時，問句原文的詞在中文語料裡本來就找不到；相關度改用「對應出來的中文詞」計算。
    // 對應不出任何中文詞 ＝ 引擎根本不知道在問什麼主題 ⇒ 查無，不拿碰巧撞到的片段回答。
    const relQ = result.translationNote === 'showing-source' ? crossZh : q;
    const structuredOk = (result.intent === 'situation' && situationFor(entities, result.intent)) || (result.intent === 'travel' && (entities.countries.length || TRAVEL_CHANGE_RE.test(q)));
    if (result.translationNote === 'showing-source' && !crossZh.trim() && !structuredOk) {
      result.relevance = 0; result.guards.push({ kind: 'no-match', reason: 'no-cross-terms' });
      return setRefusal(result, 'no-match', 'ref.no-match', noMatchActions(LL));
    }
    if (chunks.length && chunks.model) {
      const rel = relevanceOf(relQ || q, chunks, chunks.model, hasEntity, zhA);
      result.relevance = rel.relevance; result.relevanceInfo = { coverage: rel.coverage, top: rel.top, matchedIdf: rel.matchedIdf, reason: rel.reason };
      const structured = structuredOk;
      // 第四十輪：結構化資料（態勢卡、旅遊等級）可答、但檢索片段過不了門檻 ⇒ 只回結構化答案，不附不相關的片段
      //（泰文問「現在流感嚴重嗎」附上白醋燻蒸的澄清稿就是這樣來的）
      if (rel.reason && structured) { result.guards.push({ kind: 'low-relevance-chunks-dropped', reason: rel.reason }); const none = []; none.qWeights = chunks.qWeights; none.model = chunks.model; chunks = none; result.retrieved = chunks; }
      // 第四十輪（issue #75）：外語問句的相關度低於 lowBelow ⇒ 查無，不再「自評相關程度較低卻照樣列片段」。
      // 中文讀者看得懂原文、可以自己判斷片段切不切題；外語讀者拿到的常是中文原文或只有部分譯文，低相關片段只會誤導。
      // 例外：問句有主題錨點，且同語言片段的「標題」就在講這個主題（錨點強度 2，例如英文來源的來臺專區）⇒ 主題已確認，
      // 相關度偏低只是問句用詞與片段不同（precautions vs. quarantine／mosquito），不算查無（合併第四十輪 i18n 來臺專區後補）
      if (topicConfirmed && rel.reason) { result.guards.push({ kind: 'topic-confirmed-gate-skipped', reason: rel.reason }); rel.reason = null; }
      if (!rel.reason && !structured && lang !== 'zh-TW' && rel.relevance < RELEVANCE.lowBelow && !topicConfirmed) rel.reason = 'low-relevance-foreign';
      if (rel.reason && !structured && !(typeof process !== 'undefined' && process.env?.NO_GATE)) { // 瀏覽器沒有 process 物件，直接讀會 ReferenceError、no-match 的答案頁就卡在載入中（第二十八輪修正）
        result.guards.push({ kind: 'no-match', reason: rel.reason, relevance: rel.relevance });
        // 相關度太低時連關鍵字清單也不附（附了又是「抗蛇毒血清 → 登革熱傳染途徑」那種不相關頁面）
        result.list = rel.relevance >= 0.4 ? traditionalList(q, view, lang, 8) : [];
        return setRefusal(result, 'no-match', 'ref.no-match', noMatchActions(LL));
      }
    }

    // 態勢（只讀結構化欄位）
    const sit = (result.intent === 'situation' || (result.disease && ['symptoms', 'vaccine', 'unknown'].includes(result.intent))) ? situationFor(entities, result.intent) : null;
    if (sit) { result.situation = sit; result.peak = sit.items.some((i) => i.status === 'peak'); }

    // 信心：查詢詞被最佳片段涵蓋的比例 ＋ 實體吻合
    if (chunks.length) {
      const qw = chunks.qWeights; const model = chunks.model;
      const topToks = new Set(tokenize(`${chunks[0].title} ${chunks[0].text}`));
      let cov = 0, tot = 0; for (const [t, w] of qw) { if (!model.has(t)) continue; const idf = model.idf(t) * w; tot += idf; if (topToks.has(t)) cov += idf; }
      const ent = result.disease ? ((chunks[0].diseases ?? []).includes(result.disease) ? 1 : 0) : 0.5;
      result.confidence = Math.round(Math.min(1, 0.6 * (cov / (tot || 1)) + 0.25 * ent + 0.15 * Math.min(1, chunks[0]._score / 12)) * 100) / 100;
    }

    // 5 組句
    const sourceMap = new Map(chunks.map((c) => [c.id, sourceOf(c)]));
    let picked = composeSentences(q, chunks, result.intent, view, result.guards);
    if (result.intent === 'apply' || result.intent === 'notify') picked = applyCompose(q, chunks, picked, view, sourceMap, result);
    if (result.intent === 'notice') { picked = noticeCompose(q, chunks, picked); if (picked.length) result.confidence = Math.max(result.confidence, 0.6); }
    // 問「去哪裡打疫苗」時不插態勢句（高峰期的英文問句曾整段答成疫情狀態 peak）；真的組不出句子才用態勢句
    if (sit && (result.intent === 'situation' || (!picked.length && sit.items.length) || (result.peak && picked.length < 3 && !result.whereAsk))) {
      const ss = situationSentences(sit, lang);
      for (const [id, s] of ss.sources) sourceMap.set(id, s);
      picked = [...ss.sentences.slice(0, Math.max(2, 4 - picked.length)), ...picked].slice(0, view === 'pro' ? 5 : 4);
      result.confidence = Math.max(result.confidence, 0.8);
    }

    if (result.intent === 'travel' && entities.countries.length) {
      const tr = travelFor(entities);
      if (tr.length) {
        result.travel = tr;
        const ts = travelSentences(tr, lang);
        for (const [id, src] of ts.sources) sourceMap.set(id, src);
        // 全球背景提醒：目的地沒有針對性建議時緊接在「目前無針對性建議」之後；有針對性建議時排在最後（有空位才出現）
        const bgS = ts.sentences.filter((x) => x.background);
        const main = ts.sentences.filter((x) => !x.background).slice(0, 2);
        const noneOnly = tr.every((c) => c.entries.every((e) => e.none));
        picked = (noneOnly ? [...main, ...bgS, ...picked] : [...main, ...picked, ...bgS]).slice(0, 4);
        result.confidence = Math.max(result.confidence, 0.7);
      }
    } else if (result.intent === 'travel') {
      const ch = travelChanges(q, lang);
      if (ch?.sentences.length) {
        result.travelChanges = true;
        for (const [id, src] of ch.sources) sourceMap.set(id, src);
        picked = [...ch.sentences.slice(0, 3), ...picked].slice(0, 4);
        result.confidence = Math.max(result.confidence, 0.7);
      }
    }

    // 不確定 → 退回傳統列表
    let lowConf = result.confidence < 0.35 || !picked.length;
    if (!picked.length) {
      result.list = traditionalList(q, view, lang, 8);
      // 第二十五輪：檢索完全沒有片段 ⇒ 站內沒有這個主題（no-match）；有片段卻組不出句子才是依據不足（no-source）
      if (!chunks.length && !entities.diseases.length) { result.relevance = 0; return setRefusal(result, 'no-match', 'ref.no-match', noMatchActions(LL)); }
      return setRefusal(result, 'no-source', 'ref.no-source', actionsFor(result, entities, sit));
    }
    const sitOnly = picked.length && picked.every((p) => p.cite.every((id) => id.startsWith('situation#')));
    if (lowConf && !sitOnly && !(sit && result.intent === 'situation') && !result.travel && !result.travelChanges) {
      result.list = traditionalList(q, view, lang, 8);
      if (result.confidence < 0.3) return setRefusal(result, 'no-source', 'ref.low-confidence', actionsFor(result, entities, sit));
    }
    if (result.intent === 'unknown' && lowConf) {
      result.list = traditionalList(q, view, lang, 8);
      result.fallbackList = true;
    }
    picked = noteConflicts(picked, result);
    picked = markNotices(picked, result);
    finalizeSentences(result, picked, sourceMap);
    if (!result.sentences.length) return setRefusal(result, 'no-source', 'ref.no-source');
    // 第四十八輪（issue #102）：相關度偏低時再看答案本身——第一句出自的是同一疾病（問句點名的，或沒點名時的主導疾病）的 FAQ／片段，
    // 而且題目、標題或第一句與問句在問同一面向（QUERY_FACETS：費用、就醫、疫苗…）⇒ 切題，不標「相關程度較低」。改的是判斷，不是調低門檻
    const c0 = picked[0]?.chunk;
    const d1 = result.disease ?? chunks[0]?.diseases?.[0];
    if (isLowRelevance(result) && c0 && (c0.type === 'faq' ? !d1 || (c0.diseases ?? []).includes(d1) : (c0.diseases ?? []).includes(d1))
      && QUERY_FACETS.some((re) => re.test(q) && re.test(`${c0.question ?? c0.title} ${picked[0].text}`))) { result.topicMatch = c0.type === 'faq' ? 'faq' : 'disease'; result.guards.push({ kind: 'topic-match', id: c0.id }); }
    result.completeness = completenessOf(result.intent, result.sentences, { situation: !!sit, q });
    result.actions = actionsFor(result, entities, sit);
    // 民眾問「要驗什麼」：導向疾病頁「診斷與治療」區塊（檢驗細節屬專業內容）
    const dz = diseaseById.get(result.disease);
    if (view !== 'pro' && dz && (dz.hasPage || dz.page) && LAB_PUBLIC_RE.test(q)) {
      result.labRedirect = true;
      result.actions = [{ label: tr(LL, `看${dz.name}診斷與治療`, `${dz.nameEn ?? dz.name}: diagnosis & treatment`), href: `/diseases/${dz.slug}/#treatment`, kind: 'link' }, ...result.actions.filter((x) => !x.href?.endsWith('#treatment'))].slice(0, 4);
    }
    // 影片逐字稿引用揭露
    if (result.sources.some((x) => x.type === 'media')) { result.disclosure.transcript = true; result.disclosure.note = tr(LL, '引用自官方影片逐字稿', 'Quoted from official video transcripts'); }
    if (result.sources.some((x) => x.closed)) result.hasClosedNotice = true;
    result.related = relatedQuestions(result);
    return result;
  }

  return {
    answer, retrieve, detectEntities, detectDisease, expandQuery, relatedQuestions, traditionalList,
    classifyIntent: (q, o) => classifyIntent(q, o), maskPII, detectInjection, statsAnswer, situationFor, citeLabelOf, notifyRows,
    get diseaseById() { return diseaseById; },
  };
}

