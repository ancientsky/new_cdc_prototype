// /search/ 精選結果的建置端資料（第五十一輪，docs/ask-search-llm.md 第 16 節）：每種語言一份「疾病／疫苗名稱 → 一級頁面」對照，
// 寫進 /search/ 頁的 data-bestbets，由 src/client/search-bestbet.js 比對。不是程式碼，不計入 JS 預算；每種語言約 5–10 KB（HTML 內）。
//
// 名稱從哪裡來（同事不必另外維護一份清單）：
//   - 疾病主檔 content/master/diseases.json：name、nameEn、aliases，以及 i18n.<語言>.name／aliases（外語別名，例如越南文的 sốt xuất huyết）
//   - 疫苗主檔 content/master/vaccines.json：name、nameEn、aliases（同上可加 i18n.<語言>）
//   - 詞彙主檔 content/master/glossary.json：refs 指到疾病／疫苗的詞條，七語譯名、別名、舊名（deprecated）
//   - 疾病頁／疫苗頁本身：title、aliases、各語言 i18n.<語言>.title
// 哪些名稱算「這個語言的」：中文版收中文名稱與別名；外語版收該語言的譯名與別名。拉丁字母的名稱（英文名、HIV、COVID-19、Mpox）每種語言都收，
// 因為各語言使用者都可能直接打英文病名。
// 連到哪裡：該語言有這一頁（一級內容要 reviewed，pages.mjs 的 langAvailable）就連該語言頁；否則連中文正本，卡片標「此語言無此頁 · 顯示中文」，
// 與傳染病列表（diseases.mjs）的做法一致。
import { bbNorm } from '../../client/search-bestbet.js';
import { glossaryField, glossaryTermInfo } from '../../client/glossary-term.js';
import { langOk, itemPath } from './_partials.mjs';
import { reviewedText } from './_listing.mjs';

const LANGS = ['zh-TW', 'en', 'ja', 'tl', 'vi', 'id', 'th'];
const LATIN_NAME = /^[\p{Script=Latin}\p{N}\s\-‐'’.,()&+/:]+$/u;
const HAS_LETTER = /[\p{L}]/u;
/** 語言慣用的「病名前綴」：泰文「โรค」（疾病）、越南文「bệnh」。使用者常省略，所以去掉前綴的形式也收（「โรคหัด」→「หัด」） */
const PREFIX = { th: /^โรค(?=.{2,})/u, vi: /^bệnh\s+(?=.{2,})/iu };

/**
 * 一個名稱展開成可比對的形式：全名、括號外、括號內（「人類免疫缺乏病毒感染（愛滋）」→ 全名、人類免疫缺乏病毒感染、愛滋），
 * 再去掉語言慣用的病名前綴。回傳 [{ f: 正規化後的字串, inner: 是否為括號內的部分 }]（去重、至少 2 字、含字母）。
 * 括號內的部分是「次要」名稱：「Varicella (chickenpox) vaccine」的 chickenpox 指的是病不是疫苗，與疾病頁的正式別名衝突時讓給疾病頁（見 bestBetData）。
 */
export function nameFormsOf(name, lang = null) {
  const s = String(name ?? '').trim();
  if (!s) return [];
  const raw = [[s, false]];
  const inner = [...s.matchAll(/[（(]([^（）()]+)[）)]/g)].map((m) => m[1]);
  if (inner.length) raw.push([s.replace(/[（(][^（）()]+[）)]/g, ' '), false], ...inner.map((x) => [x, true]));
  const out = new Map();
  for (const [r0, isInner] of raw) {
    const r = r0.trim();
    const pre = PREFIX[lang];
    for (const x of pre && pre.test(r) ? [r, r.replace(pre, '')] : [r]) {
      const f = bbNorm(x);
      if (f.length >= 2 && HAS_LETTER.test(f) && !(out.get(f) === false)) out.set(f, isInner);
    }
  }
  return [...out].map(([f, inner]) => ({ f, inner }));
}
/** 只要字串（全站名稱表用） */
export const nameForms = (name, lang = null) => nameFormsOf(name, lang).map((x) => x.f);

const isLatinName = (s) => LATIN_NAME.test(String(s ?? '').trim());

/**
 * 全站「已知名稱」：每個名稱 → 它指的東西（疾病、疫苗、詞彙詞條、單位 id）。不分語言，用來判斷遮蔽（masks）：
 * 名稱 K 只出現在另一個指不同東西的名稱 M 裡面時，K 不算命中。
 * 回傳 { targets: Map<名稱, Set<id>>, vaccineDiseases: Map<疫苗 id, Set<疾病 id>> }
 */
export function nameUniverse(site) {
  const targets = new Map();
  const add = (name, id, lang) => {
    for (const f of nameForms(name, lang)) {
      if (!targets.has(f)) targets.set(f, new Set());
      targets.get(f).add(id);
    }
  };
  const m = site.master ?? {};
  const i18nNames = (x, id) => {
    for (const [l, v] of Object.entries(x.i18n ?? {})) for (const n of [v?.name, ...(v?.aliases ?? [])]) add(n, id, l);
  };
  for (const d of m.diseases ?? []) {
    for (const n of [d.name, d.nameEn, ...(d.aliases ?? [])]) add(n, d.id);
    i18nNames(d, d.id);
  }
  for (const v of m.vaccines ?? []) {
    for (const n of [v.name, v.nameEn, ...(v.aliases ?? [])]) add(n, v.id);
    i18nNames(v, v.id);
  }
  for (const g of m.glossary ?? []) {
    const id = (g.refs ?? []).find((r) => /^(disease|vaccine)\./.test(r)) ?? g.id;
    for (const n of [g['zh-TW'], ...(g.aliases ?? []), ...(g.deprecated ?? [])]) add(n, id);
    for (const l of LANGS.slice(1)) add(g[glossaryField(l)], id, l);
  }
  for (const item of [...(site.collections?.diseases ?? []), ...(site.collections?.vaccines ?? [])]) {
    for (const n of [item.title, ...(item.aliases ?? [])]) add(n, item.id);
    for (const [l, v] of Object.entries(item.i18n ?? {})) add(v?.title, item.id, l);
  }
  for (const u of m.units ?? []) {
    add(u.name, u.id);
    add(u.nameEn, u.id);
  }
  const vaccineDiseases = new Map((m.vaccines ?? []).map((v) => [v.id, new Set(v.diseases ?? [])]));
  return { targets, vaccineDiseases };
}

/** 這個語言、這個項目（疾病頁或疫苗頁）可以觸發精選結果的名稱（未正規化） */
function namesFor(site, item, lang) {
  const m = site.master ?? {};
  const master = (item.type === 'disease' ? m.diseases : m.vaccines)?.find((x) => x.id === item.id) ?? {};
  const glossary = (m.glossary ?? []).filter((g) => (g.refs ?? []).includes(item.id));
  const latin = [
    master.nameEn,
    ...(master.i18n?.en ? [master.i18n.en.name, ...(master.i18n.en.aliases ?? [])] : []),
    ...glossary.map((g) => g.en),
    item.i18n?.en?.title,
    ...[...(master.aliases ?? []), ...(item.aliases ?? []), ...glossary.flatMap((g) => [...(g.aliases ?? []), ...(g.deprecated ?? [])])].filter(isLatinName),
  ];
  if (lang === 'zh-TW') {
    return [
      master.name,
      ...(master.aliases ?? []),
      item.title,
      ...(item.aliases ?? []),
      ...glossary.flatMap((g) => [g['zh-TW'], ...(g.aliases ?? []), ...(g.deprecated ?? [])]),
      ...latin,
    ];
  }
  const own = master.i18n?.[lang] ?? {};
  return [own.name, ...(own.aliases ?? []), ...glossary.map((g) => g[glossaryField(lang)]), item.i18n?.[lang]?.title, ...latin];
}

const clip = (s, n = 200) => {
  const t = String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (t.length <= n) return t;
  // 太長時在句尾截（句號、問號）；找不到夠長的句子就在詞界截，不把英文單字切一半
  const head = t.slice(0, n);
  const end = Math.max(...['。', '. ', '！', '？', '! ', '? '].map((p) => head.lastIndexOf(p)));
  if (end >= n / 2) return head.slice(0, end + 1).trim();
  const sp = head.lastIndexOf(' ');
  return `${(sp >= n / 2 ? head.slice(0, sp) : head.slice(0, n - 1)).trim()}…`;
};

/**
 * /search/（該語言）的精選結果資料。回傳 { bets, keys, masks }（結構見 search-bestbet.js 的 matchBestBets）。
 * bets[i]：{ id, type, t 標題, u 網址, s 摘要（只有頁面語言版才給）, l 標題語言（與頁面語言不同時，例如 zh-TW）, a／al 頁面語言的名稱（退回中文頁時給讀者認得的名稱）}
 */
export function bestBetData(ctx) {
  const { site, lang } = ctx;
  const { targets, vaccineDiseases } = nameUniverse(site);
  const items = [...(site.collections?.diseases ?? []), ...(site.collections?.vaccines ?? [])].filter(
    (x) => x.status === 'published' && (x.type === 'disease' || x.type === 'vaccine'),
  );
  const bets = [];
  const keyBets = new Map(); // 名稱 → Map(bet 索引 → 強度：2 正式名稱或別名、1 只出現在括號內)
  for (const item of items) {
    const local = langOk(site, item, lang);
    const bet = { id: item.id, type: item.type };
    if (local) {
      bet.t = reviewedText(ctx, item, 'title').text;
      bet.u = ctx.url(itemPath(item));
      const s = reviewedText(ctx, item, 'summary');
      if (s.text && !s.shown) bet.s = clip(s.text);
    } else {
      bet.t = item.title;
      bet.u = ctx.url(itemPath(item), { noLang: true });
      bet.l = item.sourceLang ?? 'zh-TW';
      const g = (site.master?.glossary ?? []).find((x) => (x.refs ?? []).includes(item.id));
      const gi = glossaryTermInfo(g, lang);
      if (gi.text && gi.lang !== 'zh-TW') {
        bet.a = gi.text;
        if (gi.lang !== lang) bet.al = gi.lang;
      } else if (item.i18n?.en?.title) {
        bet.a = item.i18n.en.title;
        if (lang !== 'en') bet.al = 'en';
      }
    }
    const n = bets.push(bet) - 1;
    for (const name of namesFor(site, item, lang)) {
      for (const { f, inner } of nameFormsOf(name, lang)) {
        if (!keyBets.has(f)) keyBets.set(f, new Map());
        const m = keyBets.get(f);
        m.set(n, Math.max(m.get(n) ?? 0, inner ? 1 : 2));
      }
    }
  }
  // 同一個名稱指到兩頁時，只留「正式名稱或別名」那一方（chickenpox → 水痘疾病頁，不是「Varicella (chickenpox) vaccine」）；兩邊都正式就兩張卡都給
  for (const [k, m] of keyBets) {
    const top = Math.max(...m.values());
    keyBets.set(k, new Set([...m].filter(([, v]) => v === top).map(([i]) => i)));
  }
  // 遮蔽：更長、包含 K、而且指的不是同一個東西的已知名稱。疫苗名不遮它所預防的疾病（「A 型肝炎疫苗」仍是在講 A 肝，與 §37 相同）
  const masks = {};
  const all = [...targets.keys()];
  for (const [k, idx] of keyBets) {
    const mine = new Set([...idx].map((i) => bets[i].id));
    const latinEdges = /^[\p{Script=Latin}\p{N}]|[\p{Script=Latin}\p{N}]$/u.test(k);
    const ms = all.filter((m) => {
      if (m.length <= k.length || !m.includes(k)) return false;
      if (latinEdges && !new RegExp(`(?<![\\p{Script=Latin}\\p{N}])${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{Script=Latin}\\p{N}])`, 'u').test(m))
        return false;
      const ids = targets.get(m);
      if ([...ids].some((id) => mine.has(id))) return false;
      return ![...ids].every((id) => [...mine].some((d) => vaccineDiseases.get(id)?.has(d)));
    });
    if (ms.length) masks[k] = ms.sort();
  }
  const keys = [...keyBets].map(([k, s]) => [k, [...s].sort((a, b) => a - b)]).sort((a, b) => b[0].length - a[0].length || a[0].localeCompare(b[0]));
  return { bets, keys, masks };
}
