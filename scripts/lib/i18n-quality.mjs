// 第四十輪（issue #72、#73）：多語頁面品質檢查，掃 dist 已輸出的 HTML（與連結檢查同一層級：看「使用者真的看到什麼」）。
//
// 為什麼掃 dist 而不是在模板裡檢查：鍵值外洩（term.influenza）與中文夾雜的來源五花八門——詞彙主檔、
// 疫情資料、新聞標題、原型橫幅——任何一個模板忘了走 helper 都會漏；只有對最終輸出做檢查，才能保證
// 「不管哪一條路徑產生，使用者都看不到」。模板端的 helper（glossaryTerm、zhOnlyTitle）負責修，這裡負責擋。
//
// 兩項檢查：
//   1. 鍵值外洩（error，建置失敗）：可見文字出現 /\bterm\.[a-z]/。這種字串對使用者毫無意義，一定是程式錯誤。
//   2. 中文比例（warn，不擋建置）：非 zh-TW、非 ja 頁的可見文字中 CJK 字元比例超過門檻就警告，建置摘要列最差 10 頁。
//      ja 天生使用漢字，不列入；zh-TW 是正本，不列入。
//      排除：<script>/<style>/<template>/<noscript>/<datalist>；任何帶 lang="zh…" 的元素整段（語言選單「繁體中文」、
//      「僅有中文」標記裡的中文標題、刻意保留的中文原文）；白名單詞（專有名詞）。
//      門檻：I18N_CJK_MAX（預設 0.15）；白名單：I18N_CJK_ALLOW（逗號分隔，附加在預設白名單後）；
//      I18N_CJK_CHECK=off 關閉；I18N_CJK_CHECK=error 改成擋建置（等數字壓下來後再開）。
import fs from 'node:fs';
import path from 'node:path';

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
// datalist 也略過：選項只是輸入提示（目的地查詢刻意放中英兩種國名，方便用中文打字找），不是頁面上的文字
const SKIP = new Set(['script', 'style', 'template', 'noscript', 'datalist']);
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

/** 預設白名單：專有名詞與機關名稱的中文寫法在外語頁出現是合理的（例如官方中文名稱並列）。 */
/**
 * 第四十八輪（#100）：高流量頁面的中文比例超標＝錯誤（擋建置），其餘仍是警告。
 * 為什麼用路徑白名單而不是全部改 error：全站外語頁仍有數十頁因內容尚未翻譯而超標（全部擋會讓每次內容更新都被卡住），
 * 但首頁與問答入口是外語使用者第一眼看到的頁面，這兩類不能被中文蓋掉。
 * 範圍：/<lang>/（首頁）、/<lang>/ask/（問答頁的靜態殼）。/<lang>/ask/?q=… 的答案由瀏覽器端產生，不在靜態 HTML 內，
 * 其字串由 tests/round48-ui.test.mjs 檢查 th／id／tl 的 ans.* 齊備。要加頁面：在這裡加一條，並先確認該頁已低於門檻。
 * 頁面路徑格式是 dist 內的相對路徑（以 / 開頭、含 index.html）。
 */
export const STRICT_CJK_PAGES = [/^\/(?:en|ja|tl|vi|id|th)\/index\.html$/, /^\/(?:en|ja|tl|vi|id|th)\/ask\/index\.html$/]; // 語言前綴與 site.config 的 languages 一致
export const isStrictCjkPage = (page) => STRICT_CJK_PAGES.some((re) => re.test(page));

export const DEFAULT_CJK_ALLOW = ['衛生福利部疾病管制署', '疾病管制署', '疾管署', '繁體中文', '中文'];

/**
 * 取出可見文字。excludeZh=true 時，帶 lang="zh…" 的元素（含子孫）不計入——它們已經明確標示為中文，
 * 螢幕閱讀器會切換語音，視覺上也通常配「僅有中文」標記，這是「誠實標示」而不是「夾雜」。
 * 簡易標記掃描器（不是完整 HTML parser）：本站 HTML 由自家模板產生、結構規整，夠用且零相依。
 */
export function visibleText(html, { excludeZh = false, skipCode = false } = {}) {
  const out = [];
  const stack = []; // { tag, hide }
  let hidden = 0;
  const re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w:-]*)([^>]*)>|([^<]+)/g;
  let m;
  while ((m = re.exec(html))) {
    if (m[4] != null) {
      if (!hidden) out.push(m[4]);
      continue;
    }
    if (!m[2]) continue; // 註解
    const tag = m[2].toLowerCase();
    if (m[1]) {
      // 結束標籤：往回找到同名的開始標籤（容忍沒關的 <p>／<li>）
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag === tag) {
          for (const s of stack.splice(i)) if (s.hide) hidden--;
          break;
        }
      }
      continue;
    }
    if (VOID.has(tag) || /\/\s*$/.test(m[3])) continue;
    // lang="ja" 也排除：語言選單的「日本語」是自稱名，與 zh 一樣是明確標示語言的文字
    const hide = SKIP.has(tag) || (skipCode && (tag === 'code' || tag === 'pre')) || (excludeZh && tag !== 'html' && /\slang\s*=\s*["']?(zh|ja)/i.test(m[3]));
    stack.push({ tag, hide });
    if (hide) hidden++;
    // script／style 內容不是 HTML，直接跳到結束標籤，避免把 "<" 當成標籤
    if (SKIP.has(tag)) {
      const end = html.toLowerCase().indexOf(`</${tag}`, re.lastIndex);
      re.lastIndex = end < 0 ? html.length : end;
    }
  }
  return out
    .join(' ')
    .replace(
      /&(#?\w+);/g,
      (s, k) =>
        ENT[k] ?? (k.startsWith('#x') ? String.fromCodePoint(parseInt(k.slice(2), 16)) : k.startsWith('#') ? String.fromCodePoint(Number(k.slice(1))) : s),
    )
    .replace(/\s+/g, ' ')
    .trim();
}

export const TERM_KEY_RE = /\bterm\.[a-z][\w-]*/g;

/** 可見文字中的詞彙鍵值（term.xxx）。回傳去重的命中清單。
 *  <code>／<pre> 不算：/developers/ 的 API 範例本來就要顯示 "id": "term.mpox" 這種識別碼，那是給工程師看的資料，不是外洩。 */
export function termKeyLeaks(html) {
  return [...new Set(visibleText(html, { skipCode: true }).match(TERM_KEY_RE) ?? [])];
}

const CJK_RE = /[㐀-鿿豈-﫿　-〿！-｠]/g;
const WORD_RE = /[\p{L}\p{N}]/gu;

/** CJK 字元比例：CJK 字元數／（字母與數字總數）。白名單詞先移除，不計入分子也不計入分母 */
export function cjkStats(html, { allow = DEFAULT_CJK_ALLOW } = {}) {
  let text = visibleText(html, { excludeZh: true });
  for (const w of [...allow].sort((a, b) => b.length - a.length)) if (w) text = text.split(w).join(' ');
  const cjk = (text.match(CJK_RE) ?? []).length;
  const total = (text.match(WORD_RE) ?? []).length + (text.match(/[　-〿！-｠]/g) ?? []).length;
  return { cjk, total, ratio: total ? cjk / total : 0, sample: [...new Set(text.match(/[㐀-鿿]{2,}[㐀-鿿，、：（）]{0,14}/g) ?? [])].slice(0, 3) };
}

function walkHtml(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (['assets', 'files', 'pagefind', 'preview', 'v1', 'admin', 'feeds'].includes(e.name)) continue;
      walkHtml(p, out);
    } else if (e.name.endsWith('.html')) out.push(p);
  }
  return out;
}

/** 頁面語言：看 <html lang="…">（比路徑可靠：/en/ 以外的語言前綴由 site.config 決定） */
const pageLang = (html) => html.match(/<html[^>]*\slang="([^"]+)"/)?.[1] ?? 'zh-TW';

/**
 * 掃整個 dist。回傳 { termLeaks: [{page, keys}], cjk: { threshold, checked, over: [{page, lang, ratio, cjk, total, sample}], worst, byLang } }
 * opts.threshold、opts.allow 可覆寫；預設讀環境變數。
 */
export function checkI18nQuality(distDir, opts = {}) {
  const threshold = opts.threshold ?? Number(process.env.I18N_CJK_MAX ?? 0.15);
  const allow = opts.allow ?? [
    ...DEFAULT_CJK_ALLOW,
    ...String(process.env.I18N_CJK_ALLOW ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  ];
  const termLeaks = [];
  const rows = [];
  for (const file of walkHtml(distDir)) {
    const html = fs.readFileSync(file, 'utf8');
    const page = '/' + path.relative(distDir, file).split(path.sep).join('/');
    const keys = termKeyLeaks(html);
    if (keys.length) termLeaks.push({ page, keys });
    const lang = pageLang(html);
    if (lang === 'zh-TW' || lang.startsWith('ja')) continue;
    const s = cjkStats(html, { allow });
    rows.push({ page, lang, ...s });
  }
  rows.sort((a, b) => b.ratio - a.ratio);
  const byLang = {};
  for (const r of rows) {
    const b = (byLang[r.lang] ??= { pages: 0, over: 0, cjk: 0, total: 0 });
    b.pages++;
    b.cjk += r.cjk;
    b.total += r.total;
    if (r.ratio > threshold) b.over++;
  }
  const over = rows.filter((r) => r.ratio > threshold);
  return {
    termLeaks,
    cjk: { threshold, checked: rows.length, over, strictOver: over.filter((r) => isStrictCjkPage(r.page)), worst: rows.slice(0, 10), byLang },
  };
}

/** 建置摘要（給 build.mjs 用）。回傳是否要讓建置失敗 */
export function summarizeI18nQuality(rep, { log = console.log, mode = process.env.I18N_CJK_CHECK ?? 'warn' } = {}) {
  const pct = (x) => `${(x * 100).toFixed(1)}%`;
  const c = rep.cjk;
  if (mode !== 'off')
    log(
      `[i18n] 外語頁 ${c.checked} 頁；中文比例門檻 ${pct(c.threshold)}，超過 ${c.over.length} 頁（${Object.entries(c.byLang)
        .map(([l, b]) => `${l} ${b.over}/${b.pages}`)
        .join('、')}）`,
    );
  if (mode !== 'off' && c.worst.length) {
    log('[i18n] 中文比例最高的 10 頁：');
    for (const r of c.worst)
      log(`  ${r.ratio > c.threshold ? '⚠' : '·'} ${pct(r.ratio)} ${r.page}（${r.cjk}/${r.total}）${r.sample.length ? `例：${r.sample.join('｜')}` : ''}`);
  }
  if (rep.termLeaks.length) {
    log(`[i18n] ❌ ${rep.termLeaks.length} 頁的可見文字出現詞彙鍵值（term.*）：`);
    for (const r of rep.termLeaks.slice(0, 20)) log(`  ✗ ${r.page}：${r.keys.join('、')}`);
  }
  const strictOver = mode === 'off' ? [] : (c.strictOver ?? []);
  if (strictOver.length) {
    log(`[i18n] ❌ 高流量頁面（首頁、問答頁）中文比例超過 ${pct(c.threshold)}：`);
    for (const r of strictOver) log(`  ✗ ${pct(r.ratio)} ${r.page}（${r.cjk}/${r.total}）${r.sample.length ? `例：${r.sample.join('｜')}` : ''}`);
  }
  const cjkFail = strictOver.length > 0 || (mode === 'error' && c.over.length > 0);
  return { fail: rep.termLeaks.length > 0 || cjkFail };
}
