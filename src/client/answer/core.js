// 答案引擎核心（骨架版；Agent D 依 ARCHITECTURE.md 第 5 節補完）
// 純函式、不碰 DOM、Node 與瀏覽器共用。
// createEngine(deps).answer(query, {lang, view}) → AnswerResult
// AnswerResult = { intent, refused, refusal?, disease?, sentences:[{text, cite:[chunkId]}], sources:[chunk], situation?, actions:[], verdict?, auditId, mode }

export const REFUSAL_PATTERNS = [
  { re: /(我|小孩|孩子|媽媽|爸爸|家人).{0,12}(是不是|會不會|有沒有).{0,6}(得|感染|中)/, kind: 'personal-diagnosis' },
  { re: /(該|要|可以|能).{0,4}(吃|服用|用)(什麼|哪種|多少).{0,4}(藥|劑量)/, kind: 'medication' },
  { re: /(劑量|mg|毫克).{0,10}(吃|服)/, kind: 'medication' },
  { re: /(告|法律責任|賠償|提告|罰多少)/, kind: 'legal' },
  { re: /(未公布|還沒公布|內部|尚未發布).{0,6}(疫情|資料|數字)/, kind: 'unpublished' },
  { re: /(記者|採訪|媒體).{0,6}(詢問|聯絡|提問)/, kind: 'media' },
];

export function maskPII(text) {
  return String(text)
    .replace(/[A-Z][12]\d{8}/g, '[身分證]')
    .replace(/09\d{2}[-\s]?\d{3}[-\s]?\d{3}/g, '[電話]')
    .replace(/0\d{1,2}[-\s]?\d{6,8}/g, '[電話]')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]')
    .replace(/[一-鿿]{1,6}(市|縣)[一-鿿]{1,6}(區|鄉|鎮|市)[一-鿿]{1,8}(路|街|巷|弄)\d+(號|之\d+)?/g, '[地址]');
}

export function bigrams(s) {
  const t = String(s).toLowerCase().replace(/[\s\p{P}]+/gu, '');
  const out = [];
  for (let i = 0; i < t.length - 1; i++) out.push(t.slice(i, i + 2));
  if (t.length === 1) out.push(t);
  return out;
}

export function createEngine(deps) {
  const { index = [], indexPro = [], situation, clarifications = [], glossary = [], diseases = [], datasets = [], aiStatus = {}, today } = deps;
  const termMap = new Map(); // alias → canonical zh
  for (const g of glossary) { termMap.set(g['zh-TW'], g['zh-TW']); for (const a of g.aliases ?? []) termMap.set(a, g['zh-TW']); if (g.en) termMap.set(g.en.toLowerCase(), g['zh-TW']); }
  const diseaseByName = new Map();
  for (const d of diseases) { diseaseByName.set(d.name, d); for (const a of d.aliases ?? []) diseaseByName.set(a, d); diseaseByName.set(d.nameEn.toLowerCase(), d); }

  function detectDisease(q) {
    const hits = [];
    for (const [name, d] of diseaseByName) if (name && q.toLowerCase().includes(name.toLowerCase())) hits.push({ d, len: name.length });
    hits.sort((a, b) => b.len - a.len);
    return hits[0]?.d ?? null;
  }
  function expandQuery(q) {
    let out = q;
    for (const [alias, canon] of termMap) if (alias && q.includes(alias) && alias !== canon) out += ` ${canon}`;
    return out;
  }
  function detectIntent(q, view) {
    if (view === 'pro' || /(通報|送驗|檢體|病例定義|通函|手冊|指引|版次|生效)/.test(q)) return 'professional';
    if (/(真的嗎|是真的|假的|謠言|網傳|這則|訊息|LINE 傳|查證)/.test(q)) return 'rumor';
    if (/(幾例|多少例|病例數|統計|近\s*\d+\s*年|趨勢|就診率|資料集)/.test(q)) return 'stats';
    if (/(嚴重嗎|流行|現在.*(疫情|嚴重)|高峰|多嚴重|疫情)/.test(q)) return 'situation';
    if (/(疫苗|接種|打.*(針|疫苗)|公費|預防針)/.test(q)) return 'vaccine';
    if (/(出國|去(日本|越南|泰國|印尼|菲律賓|美國|歐洲|非洲|中國|大陸|韓國)|旅遊|入境|回國|帶.*去)/.test(q)) return 'travel';
    if (/(發燒|咳嗽|紅疹|起疹|拉肚子|腹瀉|嘔吐|頭痛|症狀|怎麼辦|要不要看醫生|就醫)/.test(q)) return 'symptoms';
    return 'unknown';
  }
  function score(chunk, qBigrams, qLower, disease) {
    const text = (chunk.title + ' ' + chunk.text).toLowerCase();
    let s = 0;
    const tb = new Set(bigrams(text));
    for (const b of qBigrams) if (tb.has(b)) s += 1;
    for (const t of chunk.terms ?? []) if (t && qLower.includes(String(t).toLowerCase())) s += 3;
    if (disease && chunk.diseases?.includes(disease.id)) s += 6;
    if (disease && !chunk.diseases?.length) s -= 1;
    return s;
  }
  function pickSentences(chunks, qBigrams, max = 3) {
    const cands = [];
    for (const c of chunks) for (const sen of c.sentences) {
      const sb = new Set(bigrams(sen)); let s = 0; for (const b of qBigrams) if (sb.has(b)) s++;
      cands.push({ text: sen, cite: [c.id], score: s + (c._score ?? 0) / 10, chunk: c });
    }
    cands.sort((a, b) => b.score - a.score);
    const out = []; const seen = new Set();
    for (const c of cands) { if (seen.has(c.text)) continue; seen.add(c.text); out.push(c); if (out.length >= max) break; }
    return out;
  }
  function auditId() {
    const d = (today ?? new Date().toISOString().slice(0, 10)).replace(/-/g, '');
    return `A-${d}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  }

  function answer(rawQuery, { lang = 'zh-TW', view = 'public' } = {}) {
    const q = maskPII(String(rawQuery ?? '').trim());
    const result = { query: q, lang, view, intent: 'unknown', refused: false, sentences: [], sources: [], actions: [], auditId: auditId(), mode: aiStatus.mode ?? 'extractive' };
    if (!q) return result;
    if (aiStatus.paused) { result.paused = true; result.intent = 'paused'; result.list = retrieve(q, view, 10); return result; }
    const disease = detectDisease(q);
    result.disease = disease?.id ?? null;
    result.intent = detectIntent(q, view);
    for (const p of REFUSAL_PATTERNS) if (p.re.test(q)) {
      result.refused = true;
      result.refusal = { kind: p.kind, text: refusalText(p.kind), actions: [{ label: '撥打 1922', href: 'tel:1922' }, ...(disease ? [{ label: `查看${disease.name}警示徵象`, href: `/diseases/${disease.slug}/#symptoms` }] : [])] };
      return result;
    }
    if (result.intent === 'rumor') return factCheck(q, result);
    if (result.intent === 'stats') { const st = stats(q, disease); if (st) { Object.assign(result, st); return result; } }
    const chunks = retrieve(q, view, 6, disease);
    if (result.intent === 'situation' || disease) {
      const it = situation?.items?.find((i) => i.disease === disease?.id) ?? (result.intent === 'situation' && !disease ? situation?.items?.find((i) => i.pinned) : null);
      if (it) result.situation = { ...it, publishedAt: situation.publishedAt, dataDate: situation.dataDate, publisher: situation.publisher };
    }
    if (!chunks.length) { result.refused = true; result.refusal = { kind: 'no-source', text: '官方內容中沒有足以回答這個問題的依據，為避免錯答，我不替你判斷。', actions: [{ label: '撥打 1922', href: 'tel:1922' }] }; return result; }
    const sents = pickSentences(chunks, bigrams(expandQuery(q)), view === 'pro' ? 4 : 3);
    const usedIds = new Set(sents.flatMap((s) => s.cite));
    result.sources = chunks.filter((c) => usedIds.has(c.id));
    const idx = new Map(result.sources.map((c, i) => [c.id, i + 1]));
    result.sentences = sents.map((s) => ({ text: s.text, cite: s.cite, n: s.cite.map((id) => idx.get(id)) }));
    result.actions = actionsFor(result.intent, disease);
    return result;
  }
  function retrieve(q, view, k, disease = detectDisease(q)) {
    const pool = view === 'pro' ? indexPro.filter((c) => c.isCurrent) : index.filter((c) => c.whitelist);
    const qb = bigrams(expandQuery(q)); const ql = q.toLowerCase();
    return pool.map((c) => ({ ...c, _score: score(c, qb, ql, disease) })).filter((c) => c._score > 2).sort((a, b) => b._score - a._score).slice(0, k);
  }
  function factCheck(q, result) {
    const qb = new Set(bigrams(q));
    let best = null, bestScore = 0;
    for (const c of clarifications) {
      for (const claim of [c.claim, ...(c.claimVariants ?? [])]) {
        const cb = bigrams(claim); let s = 0; for (const b of cb) if (qb.has(b)) s++;
        const ratio = s / Math.max(1, cb.length);
        if (ratio > bestScore) { bestScore = ratio; best = c; }
      }
    }
    if (best && bestScore >= 0.25) { result.verdict = best.verdict; result.clarification = best; result.sentences = [{ text: best.shareText, cite: [best.id], n: [1] }]; result.sources = [{ id: best.id, contentId: best.id, title: best.title, url: best.url }]; }
    else { result.verdict = 'unknown'; result.refused = true; result.refusal = { kind: 'no-source', text: '目前沒有對應的官方澄清。請勿轉傳，可將訊息提供給 1922 或透過本頁回報。', actions: [{ label: '撥打 1922', href: 'tel:1922' }] }; }
    return result;
  }
  function stats(q, disease) {
    const ds = datasets.find((d) => (disease && d.title.includes(disease.name)) || (d.series?.label && q.includes(d.series.label.slice(0, 2))));
    if (!ds) return null;
    const m = q.match(/近\s*(\d+)\s*年/); const n = m ? Number(m[1]) : 5;
    const pts = ds.series.points.slice(-n);
    return { intent: 'stats', stats: { dataset: ds, points: pts }, sentences: pts.map((p) => ({ text: `${p.t}：${p.v.toLocaleString()} ${ds.series.unit}`, cite: [ds.id], n: [1] })), sources: [{ id: ds.id, contentId: ds.id, title: ds.title, url: ds.canonicalUrl, ownerName: ds.owner, reviewedAt: ds.lastUpdated }], actions: [{ label: '下載資料集', href: ds.canonicalUrl }] };
  }
  return { answer, retrieve, detectIntent, detectDisease, maskPII, expandQuery };
}

function refusalText(kind) {
  return {
    'personal-diagnosis': '你描述的是個人症狀，需要醫師評估。官方內容沒有足以判斷的依據，我不替你判斷。',
    medication: '用藥與劑量需由醫師或藥師依個人狀況決定，官方網站不提供個人用藥建議。',
    legal: '法律責任與賠償問題請洽主管機關或法律專業人員。',
    unpublished: '尚未發布的疫情資料不在回答範圍；請以新聞稿與疫情態勢層的正式發布為準。',
    media: '媒體詢問請聯絡公關室，本服務僅整理已公開內容。',
  }[kind] ?? '這個問題我不能替你判斷。';
}

function actionsFor(intent, disease) {
  const a = [];
  if (intent === 'vaccine') a.push({ label: '查附近接種點', href: 'https://antiflu.cdc.gov.tw/' });
  if (intent === 'symptoms' && disease) a.push({ label: `看${disease.name}警示徵象`, href: `/diseases/${disease.slug}/#symptoms` });
  if (intent === 'travel') a.push({ label: '查目的地疫情等級', href: '/travel/' });
  if (intent === 'situation') a.push({ label: '看完整趨勢', href: '/situation/' });
  a.push({ label: '撥打 1922', href: 'tel:1922' });
  return a;
}
