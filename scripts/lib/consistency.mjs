// 第三十三輪：跨內容說法一致性檢查（ARCHITECTURE §39、決策紀錄 §26、guide-staff §37）。
//
// 問題：治理欄位（basedOn、版本鏈、反向稽核）只管得到「有宣告關係」的內容。兩個組室各自寫了同一題的 Q&A、
// 或去年的新聞稿與今年的疫苗頁講同一件事卻數字不同，彼此沒有 basedOn，舊規則抓不到；答案引擎可能同時引用兩句，
// 使用者看到「留觀 15 分鐘」又看到「留觀 30 分鐘」。
//
// 做法：在答案索引建好之後（索引裡的句子就是答案可能引用的句子），兩兩比對同一疾病（或同一疫苗）範圍內的句子，
// 用 core.js 的 conflictBetween()：字面高度相似、同單位的數字卻完全不同 ⇒ 「說法不一致候選」。
//   - 不自動判定誰對：寫成待辦給兩邊的權責單位（content-conflict），並在兩邊的答案單元標 conflicts[]，
//     答案端把權威較高者排前面、並在答案上方加註「站內兩處說法不同，已通知權責單位確認」。
//   - 權責單位判定後寫進 content/governance/consistency.json：
//       not-conflict ⇒ 從此不再提出（例：3HP 12 劑 vs 1HP 28 劑是兩種處方）；
//       confirmed＋prefer ⇒ 錯的那句從答案索引移除（頁面本身不動），開「待修正」待辦給該單位，直到內容改掉為止。
// 為什麼放在建置時而不是答案時即時比對：(1) 每一組候選都要有人負責判定，待辦只能在建置時產生；
// (2) 判定結果要可稽核、可回溯（進 Git）；(3) 答案端只讀結果，行為可重現、評估集可測。
// 比對與優先序只在建置時用，不放進 core.js（答案頁的 JS 預算，第二十六輪）；答案端只讀建置結果。
import { bigrams, numbersByUnit } from '../../src/client/answer/core.js';
import { addLateTodos, addDays } from './governance.mjs';

/** 相似度用的 bigram 集合（去數字，數字另外比） */
function contentBigrams(text) { return new Set(bigrams(String(text ?? '').replace(/\d+(?:\.\d+)?/g, ''))); }
export const CONSISTENCY = { minOverlap: 0.6, minLenRatio: 0.5, minBigrams: 6 };
/**
 * 兩句是否「講同一件事、同單位的數字卻完全不同」。回傳 { unit, a:[], b:[], overlap } 或 null。
 * 條件：bigram 重疊係數 ≥ minOverlap、長短比 ≥ minLenRatio（短句不拿去比長句）、某個共同單位的數值集合完全不相交。
 * 這是「候選」：同樣的字可能講不同對象（3HP 12 劑 vs 1HP 28 劑），所以由權責單位判定，答案端只加註、不刪句。
 */
export function conflictBetween(a, b, { minOverlap = CONSISTENCY.minOverlap, minLenRatio = CONSISTENCY.minLenRatio, minBigrams = CONSISTENCY.minBigrams } = {}) {
  const A = contentBigrams(a), B = contentBigrams(b);
  const lo = Math.min(A.size, B.size), hi = Math.max(A.size, B.size);
  if (lo < minBigrams || lo / hi < minLenRatio) return null;
  let n = 0; for (const x of A) if (B.has(x)) n++;
  const overlap = n / lo;
  if (overlap < minOverlap) return null;
  const na = numbersByUnit(a), nb = numbersByUnit(b);
  for (const [u, va] of na) {
    const vb = nb.get(u);
    if (vb && ![...va].some((x) => vb.has(x))) return { unit: u, a: [...va], b: [...vb], overlap: Math.round(overlap * 100) / 100 };
  }
  return null;
}
/**
 * 權威順序（數字越大越優先）。型別基準 × 是否為該疾病的權責單位 × 是否為歷史新聞稿。
 * 為什麼這樣排：正本文件（指引、建議）是政策本身；疾病頁、疫苗頁、Q&A 是權責單位依正本寫給民眾的版本；
 * 新聞稿與影音是某一天的宣導，最容易過時。同型別時「較新且對方之後沒再審閱」者優先（見 preferredOf）。
 */
export const AUTHORITY_BY_TYPE = { document: 60, letter: 55, disease: 45, vaccine: 45, service: 45, labtest: 45, faq: 40, clarification: 35, topic: 30, news: 25, media: 20, publication: 15, article: 15, research: 10 };
export function authorityOf(c) {
  let a = AUTHORITY_BY_TYPE[c?.type] ?? 20;
  if (c?.responsible) a += 8; // 該疾病主檔的權責單位
  if (c?.historical) a -= 15; // 超過期限的新聞稿：當時的資訊
  if (c?.extraction?.reviewStatus === 'machine') a -= 5;
  return a;
}
const dateOf = (c) => c?.effectiveAt ?? c?.publishedAt ?? c?.reviewedAt ?? '';
/**
 * 兩個來源誰優先：回傳 { prefer: 'a'|'b', reason }。
 * 1) 一方發布在另一方「最後審閱日」之後 ⇒ 較新者可能代表政策已改、而另一方沒跟上 ⇒ 較新者優先（但歷史新聞稿不適用）；
 * 2) 否則權威順序高者優先；3) 再平手取較新。
 */
export function preferredOf(a, b) {
  const da = dateOf(a), db = dateOf(b);
  const newer = da > db ? 'a' : db > da ? 'b' : null;
  if (newer) {
    const N = newer === 'a' ? a : b, O = newer === 'a' ? b : a;
    if (!N.historical && (O.reviewedAt ?? '') < dateOf(N)) return { prefer: newer, reason: 'newer-than-other-review' };
  }
  const xa = authorityOf(a), xb = authorityOf(b);
  if (xa !== xb) return { prefer: xa > xb ? 'a' : 'b', reason: 'authority' };
  return { prefer: newer ?? 'a', reason: 'newer' };
}

const MAX_DF = 400; // 出現在太多句子的 bigram（「疫苗」「接種」）不拿來找候選，只拿來算相似度
const FIX_DAYS = 14;

const pairKey = (a, b) => [a, b].sort().join('|');

export function applyConsistency(site) {
  const si = site.searchIndex;
  const decisions = site.governance?.consistency?.decisions ?? [];
  const decided = new Map();
  for (const d of decisions) decided.set(`${pairKey(d.a, d.b)}|${d.unit ?? '*'}`, d);
  const decisionFor = (a, b, unit) => decided.get(`${pairKey(a, b)}|${unit}`) ?? decided.get(`${pairKey(a, b)}|*`) ?? null;

  // 1. 句子（中文、同一內容同一句只算一次；記下所有含這句的答案單元，民眾與專業索引都要標）
  const chunks = [...new Set([...(si?.public ?? []), ...(si?.pro ?? [])])].filter((c) => (c.lang ?? 'zh-TW') === 'zh-TW');
  const sents = []; const byKey = new Map();
  for (const c of chunks) {
    for (const text of c.sentences ?? []) {
      const k = `${c.contentId}\u0000${text}`;
      let e = byKey.get(k);
      if (!e) { e = { text, c, chunks: [] }; byKey.set(k, e); sents.push(e); }
      e.chunks.push(c);
    }
  }
  // 2. 倒排索引找候選
  const bg = (s) => { const t = String(s).replace(/[\d\s\p{P}\p{S}]+/gu, ''); const out = new Set(); for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2)); return out; };
  const grams = sents.map((e) => bg(e.text));
  const inv = new Map();
  grams.forEach((g, i) => { for (const t of g) { if (!inv.has(t)) inv.set(t, []); inv.get(t).push(i); } });
  const names = (site.master?.diseases ?? []).flatMap((d) => [d.name, ...(d.aliases ?? [])].filter((n) => n && n.length >= 2).map((n) => [n, d.id]));
  const mentioned = (s) => new Set(names.filter(([n]) => s.includes(n)).map(([, id]) => id));
  const sameScope = (a, b) => {
    const da = a.diseases ?? [], db = b.diseases ?? [];
    if (da.length && db.length) return da.some((d) => db.includes(d));
    const va = a.vaccines ?? [], vb = b.vaccines ?? [];
    return va.length > 0 && va.some((v) => vb.includes(v));
  };

  const found = new Map(); // pairKey|unit → record
  for (let i = 0; i < sents.length; i++) {
    const a = sents[i];
    if (grams[i].size < 6) continue;
    const seen = new Set();
    for (const t of grams[i]) {
      const list = inv.get(t);
      if (list.length > MAX_DF) continue;
      for (const j of list) {
        if (j <= i || seen.has(j)) continue;
        seen.add(j);
        const b = sents[j];
        if (a.c.contentId === b.c.contentId) continue;
        if (a.c.family && a.c.family === b.c.family) continue; // 同一份文件的新舊版由版本鏈處理
        if (!sameScope(a.c, b.c)) continue;
        const ma = mentioned(a.text), mb = mentioned(b.text);
        if (ma.size && mb.size && ![...ma].some((d) => mb.has(d))) continue; // 句子各自點名不同的病（麻疹 vs 德國麻疹）
        const hit = conflictBetween(a.text, b.text);
        if (!hit) continue;
        const key = `${pairKey(a.c.contentId, b.c.contentId)}|${hit.unit}`;
        if (found.has(key)) { found.get(key).sentences.push([a, b]); continue; }
        found.set(key, { a, b, hit, sentences: [[a, b]] });
      }
    }
  }

  // 3. 套用判定、標答案單元、開待辦
  const today = site.today;
  const list = []; const todos = []; let dismissed = 0;
  const side = (e) => ({ contentId: e.c.contentId, title: e.c.title, url: e.c.url, type: e.c.type, owner: e.c.owner, ownerName: e.c.ownerName, date: e.c.effectiveAt ?? e.c.publishedAt ?? e.c.reviewedAt ?? null, historical: !!e.c.historical, sentence: e.text });
  const removeSentence = (e) => { for (const c of e.chunks) { c.sentences = c.sentences.filter((s) => s !== e.text); c.text = c.sentences.join(' '); } };
  for (const [key, r] of found) {
    const { a, b, hit } = r;
    const d = decisionFor(a.c.contentId, b.c.contentId, hit.unit);
    if (d?.decision === 'not-conflict') { dismissed++; continue; }
    const auto = preferredOf(a.c, b.c);
    const confirmed = d?.decision === 'confirmed' && (d.prefer === a.c.contentId || d.prefer === b.c.contentId);
    const preferA = confirmed ? d.prefer === a.c.contentId : auto.prefer === 'a';
    const id = `conflict.${key.replace(/[^\w.|-]+/g, '').replace(/\|/g, '~')}`;
    const rec = {
      id, status: confirmed ? 'confirmed' : 'candidate', unit: hit.unit, overlap: hit.overlap,
      a: { ...side(a), values: hit.a }, b: { ...side(b), values: hit.b },
      prefer: preferA ? a.c.contentId : b.c.contentId, reason: confirmed ? 'decision' : auto.reason,
      decision: d ? { decidedBy: d.decidedBy ?? null, decidedAt: d.decidedAt ?? null, note: d.note ?? null } : null,
    };
    list.push(rec);
    const [win, lose] = preferA ? [a, b] : [b, a];
    const [winVals, loseVals] = preferA ? [hit.a, hit.b] : [hit.b, hit.a];
    if (confirmed) {
      // 已判定：錯的句子不再當答案（所有含這組數字的同對句子）；頁面本身由權責單位修正
      for (const [x, y] of r.sentences) removeSentence(x.c.contentId === lose.c.contentId ? x : y);
      todos.push({ id: `content-conflict-fix:${id}`, kind: 'content-conflict-fix', itemId: lose.c.contentId, itemType: lose.c.type, itemTitle: lose.c.title, owner: lose.c.owner, href: lose.c.url,
        dueAt: addDays(d.decidedAt ?? today, FIX_DAYS), severity: (lose.c.audience ?? []).includes('public') ? 'high' : 'medium',
        text: `已判定以「${win.c.title}」的 ${winVals.join('、')} ${hit.unit} 為準：請修正「${lose.c.title}」的「${lose.text.slice(0, 40)}」（${loseVals.join('、')} ${hit.unit}）。修正前這句不會出現在智慧問答。` });
      continue;
    }
    // 候選：兩邊都標，答案端加註並把優先者排前面
    for (const [me, other, mine, theirs, isWin] of [[a, b, hit.a, hit.b, preferA], [b, a, hit.b, hit.a, !preferA]]) {
      for (const c of me.chunks) {
        c.conflicts ??= [];
        c.conflicts.push({ id, sentence: me.text, unit: hit.unit, prefer: isWin ? 'self' : 'other', self: { ...side(me), values: mine }, other: { ...side(other), values: theirs } });
      }
    }
    for (const [me, other] of [[a, b], [b, a]]) {
      todos.push({ id: `content-conflict:${id}:${me.c.contentId}`, kind: 'content-conflict', itemId: me.c.contentId, itemType: me.c.type, itemTitle: me.c.title, owner: me.c.owner, href: me.c.url,
        dueAt: addDays(today, FIX_DAYS), severity: (me.c.audience ?? []).includes('public') ? 'high' : 'medium', conflictId: id,
        text: `「${me.c.title}」說「${me.text.slice(0, 40)}」，「${other.c.title}」（${other.c.ownerName ?? other.c.owner}）說「${other.text.slice(0, 40)}」：${hit.unit}數字不同。請兩單位確認哪個正確，結果寫進 content/governance/consistency.json（guide-staff §37）。` });
    }
  }
  // 移除句子後變空的答案單元
  if (si) for (const k of ['public', 'pro']) si[k] = si[k].filter((c) => (c.sentences ?? []).length);

  if (site.gov) {
    addLateTodos(site, todos);
    site.gov.consistency = {
      candidates: list.filter((x) => x.status === 'candidate').length,
      confirmed: list.filter((x) => x.status === 'confirmed').length,
      dismissed, sentencesCompared: sents.length, list,
    };
  }
  return list;
}
