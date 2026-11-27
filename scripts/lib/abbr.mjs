// 第七十六輪：WCAG 3.1.4 縮寫（AAA，本站選做；docs/a11y.md 第 13 節）。
// 建置時在每頁主要內容的段落文字裡，把「詞彙主檔（content/master/glossary.json）認得的縮寫」第一次出現處包成 <abbr title="全稱">。
// 不新增連結、不改可見文字；只動 <main> 裡段落類元素（p、li、td、dd…）的文字，標題、連結、按鈕、code／pre、SVG、屬性值都不動。
// 為什麼在建置期、而不是要求承辦同仁在內容裡手寫 <abbr>：縮寫散在幾百篇 Markdown 與 JSON，手寫一定漏；
// 全稱跟著詞彙主檔走，主檔改譯名，全站的 title 一起改。
// 與 HM1240401C（行內連結 title）的關係：只在「已經有字的文字節點」裡切出 <abbr>，父元素原本就有文字，
// 所以旁邊的連結算不算行內連結不會改變；pages.mjs 在補完連結 title 之後才跑這一步。
import { parseTree } from './a11y-text.mjs';
import { esc } from './render.mjs';
import { glossaryField } from '../../src/client/glossary-term.js';

/** 縮寫的樣子：大寫字母開頭、2–7 個大寫字母或數字，可帶 -數字（COVID-19）或前綴（RT-PCR） */
const ABBR = /^(?:[A-Z]{2,3}-)?[A-Z][A-Z0-9]{1,6}(?:-\d+)?$/;
/** 看起來像縮寫、其實是型別／品名／機關簡稱的詞（全稱沒有意義，或同一縮寫在站上指不同對象：CDC 可能是美國 CDC） */
const NOT_ABBR = new Set(['CDC', 'JYNNEOS', 'H5N1', 'H7N9', 'O157', 'NS1']);
/**
 * 詞彙主檔沒有、或主檔的譯名不是全稱的常見縮寫（只給中文與英文全稱；其他語言頁只用主檔裡該語言的譯名）。
 * 主檔的 term.mmr 是「MMR 疫苗」、term.covid-19 是「新冠併發重症」（疾病分類名稱），都不是縮寫的全稱，所以這裡覆寫。
 */
export const ABBR_EXTRA = {
  MMR: { 'zh-TW': '麻疹、腮腺炎、德國麻疹混合疫苗', en: 'measles, mumps and rubella vaccine' },
  'COVID-19': { 'zh-TW': '2019 冠狀病毒疾病', en: 'coronavirus disease 2019' },
  HPV: { 'zh-TW': '人類乳突病毒', en: 'human papillomavirus' },
  RSV: { 'zh-TW': '呼吸道融合病毒', en: 'respiratory syncytial virus' },
  PCR: { 'zh-TW': '聚合酶連鎖反應', en: 'polymerase chain reaction' },
  'RT-PCR': { 'zh-TW': '反轉錄聚合酶連鎖反應', en: 'reverse transcription polymerase chain reaction' },
  WHO: { 'zh-TW': '世界衛生組織', en: 'World Health Organization' },
};

const cache = new WeakMap();
/**
 * 某語言的縮寫表：{ 縮寫: 全稱 }。全稱取詞彙主檔該語言的譯名（去掉結尾的「（縮寫）」）；譯名本身含縮寫（「HIV infection」）就不算全稱、不標。
 * @param {object[]} glossary
 * @param {string} lang
 * @returns {Map<string, string>}
 */
export function abbrTable(glossary = [], lang = 'zh-TW') {
  let byLang = cache.get(glossary);
  if (!byLang) cache.set(glossary, (byLang = new Map()));
  if (byLang.has(lang)) return byLang.get(lang);
  const out = new Map();
  const put = (ab, full) => {
    const f = String(full ?? '')
      .replace(new RegExp(`\\s*[（(]${ab.replace(/[-]/g, '\\-')}[)）]\\s*$`), '')
      .trim();
    if (f && !f.includes(ab) && !out.has(ab)) out.set(ab, f);
  };
  for (const [ab, names] of Object.entries(ABBR_EXTRA)) if (names[lang]) put(ab, names[lang]);
  for (const g of glossary) {
    const name = g[glossaryField(lang)];
    if (typeof name !== 'string') continue;
    for (const ab of [g.en, ...(g.aliases ?? [])]) if (typeof ab === 'string' && ABBR.test(ab) && !NOT_ABBR.has(ab)) put(ab, name);
  }
  byLang.set(lang, out);
  return out;
}

const PROSE = new Set(['p', 'li', 'td', 'dd', 'dt', 'blockquote', 'figcaption', 'caption']);
const SKIP = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'a', 'abbr', 'button', 'label', 'summary', 'option', 'select', 'textarea', 'code', 'pre', 'kbd', 'samp', 'script', 'style', 'template', 'svg', 'nav', 'title', 'head', 'dfn']);

/**
 * 每頁主要內容裡，每個縮寫第一次出現處包 <abbr title="全稱">。
 * @param {string} htmlStr 整頁 HTML
 * @param {Map<string, string>} table abbrTable() 的結果
 * @returns {{ html: string, marked: number }}
 */
export function markAbbreviations(htmlStr, table) {
  const src = String(htmlStr);
  if (!table?.size) return { html: src, marked: 0 };
  const keys = [...table.keys()].filter((k) => src.includes(k)).sort((a, b) => b.length - a.length);
  if (!keys.length) return { html: src, marked: 0 };
  const re = new RegExp(`(?<![A-Za-z0-9-])(${keys.map((k) => k.replace(/-/g, '\\-')).join('|')})(?![A-Za-z0-9-])`, 'g');
  const tree = parseTree(src);
  const done = new Set();
  const inserts = [];
  const visit = (n, inMain, inProse) => {
    for (const c of n.children) {
      if (c.type === 'text') {
        if (!inMain || !inProse || c.start == null) continue;
        const raw = src.slice(c.start, c.end + 1);
        for (const m of raw.matchAll(re)) {
          if (done.has(m[1])) continue;
          done.add(m[1]);
          inserts.push([c.start + m.index, `<abbr title="${esc(table.get(m[1]))}">`], [c.start + m.index + m[1].length, '</abbr>']);
        }
        continue;
      }
      if (SKIP.has(c.name) || c.attribs['aria-hidden'] === 'true' || c.attribs.hidden != null) continue;
      visit(c, inMain || c.name === 'main', inProse || PROSE.has(c.name));
    }
  };
  visit(tree, false, false);
  if (!inserts.length) return { html: src, marked: 0 };
  let out = '';
  let last = 0;
  for (const [at, s] of inserts.sort((a, b) => a[0] - b[0])) {
    out += src.slice(last, at) + s;
    last = at;
  }
  return { html: out + src.slice(last), marked: inserts.length / 2 };
}
