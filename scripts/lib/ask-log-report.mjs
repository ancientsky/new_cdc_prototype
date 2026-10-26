// 智慧問答查詢紀錄報表（第四十一輪；說明見 docs/ask-log.md）。
//
// 輸入：.local/ask-log/YYYY-MM-DD.ndjson（模擬後端 scripts/lib/ask-log-mock.mjs 寫的；正式端點匯出同格式即可）。
// 輸出：彙整後的報表物件（scripts/ask-log-report.mjs 寫成 .local/ask-log/report.json 並印出摘要；後台 /admin/ask-log/ 讀同一份）。
//
// 為什麼要「正規化」問句：同一個問題會有大小寫、全形半形、多餘空白、結尾問號的差別（COVID、covid、ｃｏｖｉｄ？），
// 不合併的話每種寫法各算一次，真正常見的問題反而排不上來。
//
// 為什麼有 k-匿名門檻（預設 K＝3）：問句是民眾自己打的字，就算遮過個資，少見的問句仍可能指認出個人
// （例如只有一個人會問的罕見狀況）。所以一個問句要「在 K 個不同日子被問過」或「被問過 K 次」才把文字列進報表；
// 低於門檻的只算進總數（hiddenQueries／hiddenEvents），不顯示文字。調整：--min=5。
//
// 為什麼報表要給「疑似同義詞候選」：答不出來最常見的原因是民眾用的詞不在詞彙主檔（covid 之於 COVID-19、新冠）。
// 這裡用便宜的字串規則（完全相同、前綴、後綴、包含、編輯距離）比對詞彙主檔、疾病與疫苗的名稱及別名，給同仁一個起點；
// 是否真的是同義詞由同仁判斷，報表不會自動改主檔。
//
// 選用的離線 LLM 輔助（尚未實作，見 docs/ask-log.md 第 9 節）：
//   llmPass 掛點——把「已過門檻、仍無候選」的問句與詞彙主檔摘要交給模型，請它提出「可能對應哪個正名」與理由，
//   結果只寫進報表的 llmSuggestions 欄位供同仁複核；不得自動寫入主檔、不得送出低於門檻的問句。
//   要實作時在 buildReport() 之後另寫一個步驟（例如 scripts/ask-log-llm.mjs），讀 report.json、寫回同一檔；本檔不呼叫任何網路服務。
import fs from 'node:fs';
import path from 'node:path';
import { CONTENT, ROOT, readJSON } from './load.mjs';

export const DEFAULT_DIR = path.join(ROOT, '.local', 'ask-log');
export const DEFAULT_MIN = 3;
export const UNANSWERED = ['no-match', 'no-source'];
const DAY_FILE = /^(\d{4}-\d{2}-\d{2})\.ndjson$/;

/** 問句正規化：NFKC（全形轉半形）、拉丁字母小寫、空白合併、去掉結尾標點 */
export function normalizeQuery(q) {
  return String(q ?? '')
    .normalize('NFKC')
    .replace(/[A-Z]+/g, (s) => s.toLowerCase())
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[\s?!.,;:，。？！、；：…~～]+$/u, '')
    .trim();
}

/** ISO 時間 → 臺灣日期（YYYY-MM-DD）；檔案依臺灣日期分天，同仁看報表也用臺灣日期 */
export function taipeiDate(iso) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  return new Date(t + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

/** 讀紀錄目錄裡的日檔（可限定 from／to 日期，含端點）。壞掉的行略過（不讓一行壞資料毀掉整份報表） */
export function readEvents(dir = DEFAULT_DIR, { from = '', to = '' } = {}) {
  if (!fs.existsSync(dir)) return { events: [], files: [] };
  const files = fs
    .readdirSync(dir)
    .filter((f) => DAY_FILE.test(f))
    .filter((f) => {
      const d = f.slice(0, 10);
      return (!from || d >= from) && (!to || d <= to);
    })
    .sort();
  const events = [];
  for (const f of files) {
    for (const line of fs.readFileSync(path.join(dir, f), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line);
        if (e && typeof e.q === 'string') events.push({ ...e, d: taipeiDate(e.t) || f.slice(0, 10) });
      } catch {
        /* 略過壞行 */
      }
    }
  }
  return { events, files };
}

/** 詞彙表：詞彙主檔、疾病、疫苗的正名與各種寫法（別名、舊名、外文名）。root 可指向測試用的內容目錄 */
export function loadVocabulary(contentDir = CONTENT) {
  const read = (n) => readJSON(path.join(contentDir, 'master', `${n}.json`), []);
  const out = [];
  const add = (source, id, canon, forms) => {
    const list = [...new Set(forms.filter((x) => typeof x === 'string' && x.trim()))];
    if (canon && list.length) out.push({ source, id, canon, forms: list, norms: list.map(normalizeQuery) });
  };
  // 第六十五輪：folk（長輩說法、台語候選詞）也算已知寫法，不再列為同義詞候選
  for (const g of read('glossary'))
    add('glossary', g.id, g['zh-TW'], [
      g['zh-TW'],
      ...(g.aliases ?? []),
      ...(g.folk ?? []).map((f) => f.text),
      ...(g.deprecated ?? []),
      g.en,
      g.ja,
      g.tl,
      g.vi,
      g.id_,
      g.th,
    ]);
  for (const d of read('diseases')) add('disease', d.id, d.name, [d.name, d.nameEn, ...(d.aliases ?? []), ...Object.values(d.i18n ?? {}).map((x) => x?.name)]);
  for (const v of read('vaccines')) add('vaccine', v.id, v.name, [v.name, v.nameEn, ...(v.aliases ?? []), ...Object.values(v.i18n ?? {}).map((x) => x?.name)]);
  return out;
}

/** Levenshtein 編輯距離（超過 cap 就提早結束，回傳 cap+1） */
export function editDistance(a, b, cap = 3) {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, cur[j]);
    }
    if (best > cap) return cap + 1;
    prev = cur;
  }
  return prev[b.length];
}

const LATIN = /^[a-z0-9 .+-]+$/;
/** 比對時夠長才算數：拉丁字母至少 3 個字元（避免 "a"、"hi" 什麼都中），中日泰等至少 2 個字 */
const longEnough = (s) => (LATIN.test(s) ? s.replace(/[^a-z0-9]/g, '').length >= 3 : [...s].length >= 2);

/**
 * 疑似同義詞候選：q（已正規化）對詞彙表的每種寫法比對，回傳最多 max 個，依分數排序、同一正名只留一個。
 * how：exact（主檔已有這個寫法——答不出來是引擎或內容問題，不是詞彙問題）｜prefix｜suffix｜substring｜edit｜token（句中某個詞與主檔寫法相同）
 */
export function synonymCandidates(q, vocab, { max = 3 } = {}) {
  const nq = normalizeQuery(q)
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim(); // 去掉遮蔽標記（[電話] 等）
  if (!nq || !longEnough(nq)) return [];
  const whole = matchOne(nq, vocab);
  if (whole.size) return rank(whole, max);
  // 整句比不到時，改用句中的詞（拉丁字母詞、連續的中日泰文字）各比一次，分數打折：「covid 要打幾劑」→ covid → COVID-19
  const best = new Map();
  for (const tok of nq.split(/[^\p{L}\p{N}-]+|(?<=[a-z0-9])(?=[^a-z0-9 -])|(?<=[^a-z0-9 -])(?=[a-z0-9])/u)) {
    if (!tok || tok === nq || !longEnough(tok)) continue;
    for (const c of matchOne(tok, vocab).values()) {
      const s = { ...c, score: c.score - 15, token: tok, how: c.how === 'exact' ? 'token' : c.how };
      if (!best.has(c.canon) || s.score > best.get(c.canon).score) best.set(c.canon, s);
    }
  }
  return rank(best, max);
}
const rank = (m, max) => [...m.values()].sort((a, b) => b.score - a.score || a.canon.localeCompare(b.canon)).slice(0, max);

function matchOne(nq, vocab) {
  const best = new Map();
  for (const v of vocab) {
    v.norms.forEach((nf, i) => {
      if (!nf || !longEnough(nf)) return;
      let how = '';
      let score = 0;
      const diff = Math.abs(nf.length - nq.length);
      if (nf === nq) [how, score] = ['exact', 100];
      else if (nf.startsWith(nq) || nq.startsWith(nf)) [how, score] = ['prefix', 80 - diff];
      else if (nf.endsWith(nq) || nq.endsWith(nf)) [how, score] = ['suffix', 70 - diff];
      else if (nf.includes(nq) || nq.includes(nf)) [how, score] = ['substring', 60 - diff];
      else if (nq.length >= 4 && nf.length >= 4) {
        const d = editDistance(nq, nf, 2);
        if (d <= (Math.max(nq.length, nf.length) > 6 ? 2 : 1)) [how, score] = ['edit', 50 - d * 10];
      }
      if (!how) return;
      const prev = best.get(v.canon);
      if (!prev || score > prev.score) best.set(v.canon, { canon: v.canon, matched: v.forms[i], id: v.id, source: v.source, how, score });
    });
  }
  return best;
}

const inc = (o, k, n = 1) => {
  o[k ?? 'unknown'] = (o[k ?? 'unknown'] ?? 0) + n;
  return o;
};

/**
 * 彙整：events → 報表物件。
 * opts.minCount＝k-匿名門檻（不同日子數 ≥ K 或次數 ≥ K 才列出文字）；opts.vocab＝loadVocabulary()；opts.limit＝每張表最多幾列。
 */
export function buildReport(events, { minCount = DEFAULT_MIN, vocab = [], limit = 100, now = new Date(), files = [] } = {}) {
  const K = Math.max(1, Math.floor(Number(minCount) || DEFAULT_MIN));
  const byOutcome = {};
  const byLang = {};
  const byDay = {};
  const byRefusalKind = {};
  const groups = new Map();
  for (const e of events) {
    const key = normalizeQuery(e.q);
    if (!key) continue;
    inc(byOutcome, e.outcome);
    inc(byLang, e.lang);
    inc(byDay, e.d);
    if (e.outcome === 'refused') inc(byRefusalKind, e.refusalKind);
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { key, count: 0, days: new Set(), outcomes: {}, langs: {}, variants: {}, intents: {}, top: {}, lastSeen: '' }));
    g.count++;
    g.days.add(e.d);
    inc(g.outcomes, e.outcome);
    inc(g.langs, e.lang);
    inc(g.variants, e.q);
    if (e.intent) inc(g.intents, e.intent);
    for (const id of e.top ?? []) inc(g.top, id);
    if (String(e.t ?? '') > g.lastSeen) g.lastSeen = String(e.t);
  }
  const visible = [];
  let hiddenQueries = 0;
  let hiddenEvents = 0;
  for (const g of groups.values()) {
    if (g.days.size >= K || g.count >= K) visible.push(g);
    else {
      hiddenQueries++;
      hiddenEvents += g.count;
    }
  }
  const topKey = (o) => Object.entries(o).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? '';
  const row = (g) => ({
    q: topKey(g.variants), // 最常見的原始寫法（已遮蔽），比正規化後的小寫字串好讀
    norm: g.key,
    count: g.count,
    days: g.days.size,
    outcomes: g.outcomes,
    langs: g.langs,
    intent: topKey(g.intents) || null,
    lastSeen: g.lastSeen,
  });
  const n = (g, keys) => keys.reduce((s, k) => s + (g.outcomes[k] ?? 0), 0);
  const sortBy = (keys) => (a, b) => n(b, keys) - n(a, keys) || b.count - a.count || a.key.localeCompare(b.key);
  const unanswered = visible
    .filter((g) => n(g, UNANSWERED) > 0)
    .sort(sortBy(UNANSWERED))
    .slice(0, limit)
    .map((g) => ({ ...row(g), unanswered: n(g, UNANSWERED), candidates: synonymCandidates(g.key, vocab) }));
  const lowRelevance = visible
    .filter((g) => n(g, ['low-relevance']) > 0)
    .sort(sortBy(['low-relevance']))
    .slice(0, limit)
    .map((g) => ({ ...row(g), lowRelevance: n(g, ['low-relevance']), candidates: synonymCandidates(g.key, vocab) }));
  const answered = visible
    .filter((g) => n(g, ['answered', 'stats']) > 0)
    .sort(sortBy(['answered', 'stats']))
    .slice(0, limit)
    .map((g) => ({
      ...row(g),
      answered: n(g, ['answered', 'stats']),
      top: Object.keys(g.top)
        .sort((a, b) => g.top[b] - g.top[a])
        .slice(0, 3),
    }));
  const days = Object.keys(byDay)
    .filter((d) => d && d !== 'unknown')
    .sort();
  return {
    v: 1,
    generatedAt: now.toISOString(),
    minCount: K,
    range: { from: days[0] ?? null, to: days.at(-1) ?? null, days: days.length },
    files,
    totals: {
      events: events.length,
      distinctQueries: groups.size,
      listedQueries: visible.length,
      hiddenQueries,
      hiddenEvents,
      byOutcome,
      byLang,
      byDay,
      byRefusalKind,
    },
    unanswered,
    lowRelevance,
    answered,
    // 離線 LLM 輔助的掛點（尚未實作；見本檔開頭與 docs/ask-log.md 第 9 節）
    llmPass: { status: 'not-implemented', doc: 'docs/ask-log.md 第 9 節' },
  };
}

/** 一次做完：讀目錄、載詞彙、彙整 */
export function reportFromDir(dir = DEFAULT_DIR, { minCount = DEFAULT_MIN, from = '', to = '', contentDir = CONTENT, limit = 100, now = new Date() } = {}) {
  const { events, files } = readEvents(dir, { from, to });
  return buildReport(events, { minCount, vocab: loadVocabulary(contentDir), limit, now, files });
}

const OUTCOME_LABEL = {
  answered: '有答案',
  'low-relevance': '低相關',
  stats: '統計',
  'no-match': '查無',
  'no-source': '依據不足',
  refused: '拒答',
  paused: '暫停',
  unknown: '未知',
};
export const outcomeLabel = (k) => OUTCOME_LABEL[k] ?? k;

/** 主控台摘要（同仁直接看終端機用） */
export function formatReport(r, { rows = 20 } = {}) {
  const L = [];
  const pct = (x) => (r.totals.events ? `${Math.round((x / r.totals.events) * 1000) / 10}%` : '0%');
  L.push(`智慧問答查詢紀錄報表（${r.range.from ?? '—'} ～ ${r.range.to ?? '—'}，${r.range.days} 天，${r.totals.events} 筆）`);
  L.push(
    `k-匿名門檻：問句要在 ${r.minCount} 個不同日子出現或被問 ${r.minCount} 次以上才列出文字；未達門檻 ${r.totals.hiddenQueries} 種問句（${r.totals.hiddenEvents} 筆）只計數不顯示。`,
  );
  L.push('');
  L.push(
    '結果分布：' +
      Object.entries(r.totals.byOutcome)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${outcomeLabel(k)} ${v}（${pct(v)}）`)
        .join('、'),
  );
  L.push(
    '語言分布：' +
      Object.entries(r.totals.byLang)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k} ${v}`)
        .join('、'),
  );
  if (Object.keys(r.totals.byRefusalKind).length)
    L.push(
      '其他拒答類型：' +
        Object.entries(r.totals.byRefusalKind)
          .sort((a, b) => b[1] - a[1])
          .map(([k, v]) => `${k} ${v}`)
          .join('、'),
    );
  L.push('');
  L.push(`答不出來的問題（查無／依據不足），前 ${Math.min(rows, r.unanswered.length)} 名：`);
  if (!r.unanswered.length) L.push('  （沒有達到門檻的問句）');
  for (const u of r.unanswered.slice(0, rows)) {
    const c = u.candidates[0];
    L.push(`  ${String(u.unanswered).padStart(4)} 次 · ${u.days} 天 · ${u.q}${c ? `　→ 疑似同義詞候選：${c.canon}（${c.matched}，${c.how}）` : ''}`);
  }
  if (r.lowRelevance.length) {
    L.push('');
    L.push(`答了但相關度低（可能答非所問），前 ${Math.min(rows, r.lowRelevance.length)} 名：`);
    for (const u of r.lowRelevance.slice(0, rows)) L.push(`  ${String(u.lowRelevance).padStart(4)} 次 · ${u.q}`);
  }
  L.push('');
  L.push(`常見且有答案的問題，前 ${Math.min(rows, r.answered.length)} 名：`);
  for (const a of r.answered.slice(0, rows)) L.push(`  ${String(a.answered).padStart(4)} 次 · ${a.q}${a.top.length ? `（${a.top.join('、')}）` : ''}`);
  const cands = r.unanswered.filter((u) => u.candidates.length);
  if (cands.length) {
    L.push('');
    L.push('疑似同義詞候選（請人工確認後到 /admin/glossary/ 新增別名，或開 PR 改 content/master/glossary.json）：');
    for (const u of cands.slice(0, rows)) L.push(`  「${u.q}」 → ${u.candidates.map((c) => `${c.canon}〔${c.source} ${c.id}，${c.how}〕`).join('；')}`);
  }
  return L.join('\n');
}
