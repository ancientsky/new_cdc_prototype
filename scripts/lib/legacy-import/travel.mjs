// 第九批（國際旅遊與健康欄目）的轉換工具：
//   countryFor        資料產生頁（國際旅遊處方箋國家頁）→ 國家 ISO2：先看網址 query（iso／country／ISO2），再以國家主檔名稱比對標題與最後一層麵包屑（最長命中）
//   dynamicForm       查詢表單頁（<form>／<select> 有 ≥ 20 個選項、表單以外的文字很短）偵測；並把表單從內文移除（新站以功能取代，表單控制項不轉入）
//   vaccineCandidates h2–h4 小節標題提到、但疫苗主檔（含 content/vaccines/）沒有的疫苗名稱
//   referenceMd       資料產生頁的舊內文對照檔（reference/{pageKey}.md）內容
import { walkEls, textOf, removeNode, isEl } from './html.mjs';

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const norm = (s) => String(s ?? '').replace(/[\s　]/g, '').toLowerCase();
const escRe = (s) => String(s).replace(/[.*+?^$|()[\]\\{}]/g, '\\$&');

/**
 * 國家主檔（content/master/countries.json：[{ iso2, name, nameEn }]）→ 這頁對應的國家。
 * @returns {{ iso2, name, from: 'query'|'title'|'breadcrumb', hit } | null}
 */
export function countryFor(countries, { query, title = '', breadcrumbs = [] }) {
  const byIso = new Map((countries ?? []).map((c) => [String(c.iso2).toUpperCase(), c]));
  // 1. 網址 query：?iso=JP、?country=JP、?ISO2=JP（鍵名大小寫不分），值須是兩個英文字母且在主檔裡
  if (query) {
    for (const [k, v] of query.entries()) {
      if (!['iso', 'country', 'iso2'].includes(k.toLowerCase())) continue;
      const code = String(v ?? '').trim().toUpperCase();
      if (/^[A-Z]{2}$/.test(code) && byIso.has(code)) return { iso2: code, name: byIso.get(code).name, from: 'query', hit: `${k}=${v}` };
    }
  }
  // 2. 標題與最後一層麵包屑：中文名直接包含、英文名整字比對；最長命中優先（「多明尼加共和國」勝過「多明尼加」）
  const texts = [['title', title], ['breadcrumb', breadcrumbs.at(-1) ?? '']].filter(([, t]) => t);
  let best = null;
  for (const c of countries ?? []) {
    for (const n of [c.name, c.nameEn].filter(Boolean)) {
      const en = /^[\x20-\x7e]+$/.test(n);
      for (const [from, t] of texts) {
        const ok = en ? new RegExp(`(^|[^A-Za-z])${escRe(n)}(?![A-Za-z])`, 'i').test(t) : t.includes(n);
        if (ok && (!best || n.length > best.hit.length)) best = { iso2: String(c.iso2).toUpperCase(), name: c.name, from, hit: n };
      }
    }
  }
  return best;
}

const FORM_TAGS = new Set(['form', 'select']);
const CONTROL_TAGS = new Set(['form', 'select', 'option', 'optgroup', 'input', 'button', 'textarea', 'label', 'fieldset', 'legend']);

/** 節點樹中「表單以外」的文字（略過表單控制項） */
function textOutsideForms(n) {
  if (n.t === 'text') return n.text;
  if (isEl(n) && CONTROL_TAGS.has(n.tag)) return '';
  return (n.children ?? []).map(textOutsideForms).join('');
}

/**
 * 查詢表單頁偵測：內文有 <form> 或 <select>、選項（<option>）≥ minOptions、表單以外的文字 < maxChars。
 * 命中時就地把 <form>（含選項）以及表單外零散的 <select> 移除，回傳 { options, textChars }；沒命中回傳 null（不改動節點）。
 */
export function dynamicForm(body, { minOptions = 20, maxChars = 400 } = {}) {
  const els = [...walkEls(body)];
  const forms = els.filter((e) => FORM_TAGS.has(e.tag));
  if (!forms.length) return null;
  const options = els.filter((e) => e.tag === 'option').length;
  const textChars = clean(textOutsideForms(body)).replace(/\s/g, '').length;
  if (options < minOptions || textChars >= maxChars) return null;
  // 先移 <form>（裡面的 select／option／按鈕一起走），再移表單外的 select 與其他控制項
  for (const f of els.filter((e) => e.tag === 'form')) removeNode(f);
  for (const e of [...walkEls(body)].filter((x) => CONTROL_TAGS.has(x.tag))) removeNode(e);
  return { options, textChars };
}

// 通稱標題：不是某一種疫苗的名稱
const VACCINE_STOP = new Set(['建議疫苗', '其他建議疫苗', '疫苗', '預防接種']);
const GENERIC = /疫苗|建議|其他|接種|預防|相關|注意事項|須知|說明|資訊|介紹|及|與|和|、|：|:|（|）|\(|\)/g;

/**
 * h2–h4 小節標題裡的疫苗名稱，扣掉主檔已有的。
 * @param {object} body 抽出的內容區節點（轉 Markdown 前）
 * @param {string[]} known 疫苗主檔名稱＋別名＋content/vaccines/ 的標題
 * @returns {string[]} 主檔沒有的疫苗名稱（依出現順序、去重）
 */
export function vaccineCandidates(body, known = []) {
  const k = known.map(norm).filter(Boolean);
  const out = [];
  for (const el of walkEls(body)) {
    if (!/^h[2-4]$/.test(el.tag)) continue;
    const h = clean(textOf(el));
    if (!h.includes('疫苗')) continue;
    // 「黃熱病疫苗接種須知」→「黃熱病疫苗」：取到第一個「疫苗」為止
    const name = clean(/^(.*?疫苗)/.exec(h)?.[1] ?? h);
    const n = norm(name);
    if (VACCINE_STOP.has(n) || VACCINE_STOP.has(norm(h)) || n.length < 4) continue;
    if (n.replace(GENERIC, '').length < 2) continue; // 「疫苗接種建議」之類的通稱
    if (k.some((x) => x === n || x.includes(n) || n.includes(x))) continue;
    if (!out.includes(name)) out.push(name);
  }
  return out;
}

/** 資料產生頁的舊內文對照檔：小檔頭＋舊頁 Markdown，供承辦人比對新站產生頁是否漏了衛教文字 */
export function referenceMd({ title, url, iso2, newPath, markdown, exportedAt }) {
  return [
    `# ${title}`,
    '',
    `- 舊網址：${url}`,
    `- 國家：${iso2}`,
    `- 新站產生頁：${newPath}（由每日資料快照產生，不轉內文；舊網址 301 到這裡）`,
    `- 匯出日：${exportedAt}`,
    '',
    '> 這是舊頁內文的對照稿，**不是草稿**：請比對新站產生頁是否涵蓋舊頁的衛教文字，缺的請回饋到產生頁的模板或資料。',
    '',
    '---',
    '',
    String(markdown ?? '').trim(),
    '',
  ].join('\n');
}
