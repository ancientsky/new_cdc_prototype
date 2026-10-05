// 第八批（常見問答欄目）的問答專用工具：
//   faqItemsLoose   沒有手風琴 .panel 結構時，用「Q 開頭的標題／粗體段落」拆題
//   tasksFor        依問題（其次答案）的關鍵字給 tasks（規則檔 faqTasks）
//   datedDeadlines  答案裡的期限（「至 114 年 3 月 31 日止」「113 年度」）是否都已過
//   structuredFromText  問題在問「多久／幾天／幾歲／幾劑」時，從答案抽數字＋單位成 structured 候選（人確認後保留）
import { isEl, textOf, makeRoot } from './html.mjs';

const Q_LEAD = /^\s*(?:Q\s*\d*|問\s*\d*|問題\s*\d*)\s*[.、．:：]\s*/i;
const A_LEAD = /^\s*(?:A\s*\d*|答\s*\d*|答案\s*\d*|解答)\s*[.、．:：]\s*/i;
const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/** 節點是不是「一題的開頭」：h2–h4 以 Q/問 開頭或以問號結尾；或 p 以 Q/問 開頭（常是整段粗體） */
function isQuestionNode(n) {
  if (!isEl(n)) return false;
  const t = clean(textOf(n));
  if (!t) return false;
  if (/^h[2-4]$/.test(n.tag)) return Q_LEAD.test(t) || /[？?]$/.test(t);
  if (n.tag === 'p' || n.tag === 'div') return Q_LEAD.test(t) && t.length <= 120;
  return false;
}

/** 把答案第一個文字節點開頭的「A：」「答：」去掉（就地修改） */
function stripAnswerLead(nodes) {
  for (const n of nodes) {
    const first = firstText(n);
    if (!first) continue;
    if (A_LEAD.test(first.text)) first.text = first.text.replace(A_LEAD, '');
    return;
  }
}
function firstText(n) {
  if (!n) return null;
  if (n.t === 'text') return n.text.trim() ? n : null;
  for (const c of n.children ?? []) { const f = firstText(c); if (f) return f; }
  return null;
}

/**
 * 鬆散結構的問答頁 → [{ question, answerNode }]。
 * 以 isQuestionNode 命中的節點切段，段內其餘節點是答案；至少要有 2 題、且每題都有答案才採用（避免把一般內文的標題當成問題）。
 */
export function faqItemsLoose(body) {
  let cur = body;
  for (let i = 0; i < 4; i++) {
    const els = cur.children.filter((c) => isEl(c) || (c.t === 'text' && c.text.trim()));
    if (els.length === 1 && isEl(els[0]) && ['div', 'section', 'article'].includes(els[0].tag)) cur = els[0]; else break;
  }
  const groups = [];
  let g = null;
  for (const k of cur.children) {
    if (isQuestionNode(k)) { g = { question: clean(textOf(k)).replace(Q_LEAD, ''), nodes: [] }; groups.push(g); continue; }
    if (g) g.nodes.push(k);
  }
  const valid = groups.filter((x) => x.question && x.nodes.some((n) => clean(textOf(n))));
  if (valid.length < 2 || valid.length !== groups.length) return [];
  return valid.map((x) => { stripAnswerLead(x.nodes); return { question: x.question, answerNode: makeRoot(x.nodes) }; });
}

/** 依規則檔 faqTasks（[{ task, keys }]）給 tasks：先看問題，問題沒命中再看答案；都沒有回傳 [] */
export function tasksFor(rules, question, answer = '') {
  const table = rules.faqTasks ?? [];
  const hit = (text) => table.filter((r) => (r.keys ?? []).some((k) => String(text).includes(k))).map((r) => r.task);
  const byQ = hit(question);
  if (byQ.length) return [...new Set(byQ)].slice(0, 2);
  // 問題沒命中才看答案：答案什麼都會提到，所以取「命中次數最多」的一個（同分依規則檔順序）
  const count = (text, keys) => keys.reduce((a, k) => a + (String(text).split(k).length - 1), 0);
  const best = table.map((r) => ({ task: r.task, n: count(answer, r.keys ?? []) })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n)[0];
  return best ? [best.task] : [];
}

const pad = (n) => String(n).padStart(2, '0');
const iso = (y, mo, d) => (y >= 1911 && y <= 2100 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31 ? `${y}-${pad(mo)}-${pad(d)}` : null);
const rocYear = (y) => (y < 1911 ? y + 1911 : y);

/**
 * 答案裡的「期限」：日期前面有「至／到／～」或後面有「止／截止／為止／前」，或「NNN 年度」。
 * 回傳 { deadlines: [{ text, date }], allPast: boolean }；沒有期限時 deadlines 為空、allPast=false。
 * 只看寫了年的日期（「至 10 月 31 日」沒有年，不判斷）。
 */
export function datedDeadlines(text, now) {
  const t = String(text ?? '');
  const today = String(now).slice(0, 10);
  const out = [];
  const DATE = /(?:民國\s*)?(\d{2,4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日|((?:19|20)\d{2})[-/.](\d{1,2})[-/.](\d{1,2})/g;
  let m;
  while ((m = DATE.exec(t))) {
    const date = m[1] ? iso(rocYear(+m[1]), +m[2], +m[3]) : iso(+m[4], +m[5], +m[6]);
    if (!date) continue;
    const before = t.slice(Math.max(0, m.index - 4), m.index);
    const after = t.slice(m.index + m[0].length, m.index + m[0].length + 4);
    if (/(至|到|迄|[~～–—-])\s*$/.test(before) || /^\s*(止|截止|為止|以前|之前|前)/.test(after)) out.push({ text: m[0].trim(), date });
  }
  const YEAR = /(\d{2,4})\s*年度/g;
  while ((m = YEAR.exec(t))) { const y = rocYear(+m[1]); if (y >= 1990 && y <= 2100) out.push({ text: m[0].trim(), date: `${y}-12-31` }); }
  const uniq = [...new Map(out.map((d) => [d.text, d])).values()];
  return { deadlines: uniq, allPast: uniq.length > 0 && uniq.every((d) => d.date < today) };
}

const ASK = /多久|幾天|幾週|幾周|幾個月|幾歲|幾劑|間隔|多少|什麼時候|何時|多長/;
const UNIT_KEY = { 小時: 'hours', 天: 'days', 日: 'days', 週: 'weeks', 周: 'weeks', 星期: 'weeks', 個月: 'months', 歲: 'ageYears', 劑: 'doses' };

/**
 * 問題在問數量／時間時，從答案抽「數字＋單位」成 structured 候選：{ weeks: 2, months: 6 } 或範圍 { weeksMin: 4, weeksMax: 6 }。
 * 每個單位只取第一個；日期（「10 月 1 日」的「1 日」）不算；問題沒在問數量就回傳 null。
 */
export function structuredFromText(question, answer) {
  if (!ASK.test(String(question ?? ''))) return null;
  const t = String(answer ?? '');
  const RE = /(?<!月\s{0,2})(?<![\d.])(\d+(?:\.\d+)?)\s*(?:(?:至|到|[~～–—-])\s*(\d+(?:\.\d+)?)\s*)?(小時|天|日|週|周|星期|個月|歲|劑)(?!\d)/g;
  const out = {};
  let m;
  while ((m = RE.exec(t))) {
    const key = UNIT_KEY[m[3]];
    if (!key || out[key] !== undefined || out[`${key}Min`] !== undefined) continue;
    if (m[2] !== undefined) { out[`${key}Min`] = Number(m[1]); out[`${key}Max`] = Number(m[2]); } else out[key] = Number(m[1]);
    if (Object.keys(out).length >= 4) break;
  }
  return Object.keys(out).length ? out : null;
}
