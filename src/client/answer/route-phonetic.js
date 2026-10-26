// 第六十五輪：同音字、注音文、鍵盤沒切中文的亂碼（docs/ask-search-llm.md §19）。
//
// 為什麼要另外一層：第五十三輪的 nearMiss（lexicon.js）只認「字形錯一個字」，而台灣民眾用注音輸入法，錯字多半是**選錯同音字**
// （登格熱、腸病毐、麻診），或乾脆打注音（ㄉㄥ革熱、有ㄇ）、忘了切中文打出 2/ ek6bk4。這幾種都是「讀音對、字不對」，
// 所以改用讀音比對：問句和詞典名稱都轉成注音（不看聲調），讀音一樣、字不一樣的那一段，就是可能的錯字。
//
// 為什麼放在 route-*.js、讀音表再分一個檔：讀音表 5,419 字、壓縮後約 18 KB，大多數問題用不到。
//   - core.js 只在兩種情況才載入本檔：（1）問句裡有注音符號或像鍵盤亂碼；（2）照原字查無結果（no-match）。
//   - 讀音表 zhuyin-data.js 由本檔用 import() 載入（top-level await），不算進 js-budget 的「最大分支」；大小由 tests/round65-ask-weakspots.test.mjs 擋（≤ 20 KB gzip）。
//
// 護欄（認錯病名比查無更糟）：
//   - 只改成詞典裡的疾病、疫苗、詞彙主檔名稱（不改單位名）；一句只改一處，候選對到兩個不同的病就不改。
//   - 原文那一段若站上自己寫過（「結合」與「結核」同音，但「結合」是真的詞），不改。
//   - 一個字也沒對上的純讀音比對，名稱至少要三個字（ㄌㄧㄡ ㄍㄢ 兩個音節太容易撞到別的詞）。
//   - 畫面一律說「以下依『登革熱』回答（你輸入的是『登格熱』）」，不默默換字。
// 讀音表用 import()（字面字串）而不是靜態 import：js-budget 算「最大分支」時只算靜態 import，27 KB 的資料不該讓每一題深連結的上限跟著變大
const { default: RAW } = await import('./zhuyin-data.js');

const TONE_1 = /[ˊˇˋ˙]/;
const BOPO = /[ㄅ-ㄩ]/;
/** 讀音表：字 → Set(無聲調注音)；所有合法音節 */
const READ = new Map();
const SYLL = new Set();
for (const part of RAW.split('|')) {
  const [syl, chars] = part.split(':');
  SYLL.add(syl);
  for (const ch of chars) (READ.get(ch) ?? READ.set(ch, new Set()).get(ch)).add(syl);
}
const INITIALS = new Set('ㄅㄆㄇㄈㄉㄊㄋㄌㄍㄎㄏㄐㄑㄒㄓㄔㄕㄖㄗㄘㄙ');

/** 注音文的句尾與常用虛字：只在單獨一個聲母、前一個字不是注音時才換（「有ㄇ」「好ㄉ」），ㄇㄚ 這種完整音節不在這裡 */
const PARTICLE = { ㄇ: '嗎', ㄉ: '的', ㄅ: '吧', ㄋ: '呢', ㄌ: '了', ㄏ: '呵' };

// 大千式鍵盤（台灣注音輸入法預設）：沒切中文時，按「ㄉㄥ」打出來的是「2/」。數字 3467 是聲調、空白是一聲
const KEY = {
  1: 'ㄅ', q: 'ㄆ', a: 'ㄇ', z: 'ㄈ', 2: 'ㄉ', w: 'ㄊ', s: 'ㄋ', x: 'ㄌ', e: 'ㄍ', d: 'ㄎ', c: 'ㄏ', r: 'ㄐ', f: 'ㄑ', v: 'ㄒ',
  5: 'ㄓ', t: 'ㄔ', g: 'ㄕ', b: 'ㄖ', y: 'ㄗ', h: 'ㄘ', n: 'ㄙ', u: 'ㄧ', j: 'ㄨ', m: 'ㄩ', 8: 'ㄚ', i: 'ㄛ', k: 'ㄜ', ',': 'ㄝ',
  9: 'ㄞ', o: 'ㄟ', l: 'ㄠ', '.': 'ㄡ', 0: 'ㄢ', p: 'ㄣ', ';': 'ㄤ', '/': 'ㄥ', '-': 'ㄦ',
};
const KEY_TONE = { 6: 'ˊ', 3: 'ˇ', 4: 'ˋ', 7: '˙', ' ': '' };
/** 像鍵盤亂碼：只有大千鍵位會用到的字元，而且至少一個聲調數字（純英文單字不會有 3467） */
export const KEYBOARD_RE = /^(?=.*[3467])[a-z0-9,./; -]{3,40}$/;

/** 「2/ ek6bk4」→「ㄉㄥ ㄍㄜˊ ㄖㄜˋ」；任何一段不是合法音節就回傳 null（英文、網址、代碼都會在這裡被擋掉） */
export function decodeKeyboard(s) {
  const str = String(s ?? '').toLowerCase().trim() + ' ';
  if (!KEYBOARD_RE.test(str.trim())) return null;
  const out = []; let cur = '';
  for (const ch of str) {
    if (ch in KEY_TONE) { if (!cur) continue; if (!SYLL.has(cur)) return null; out.push(cur + KEY_TONE[ch]); cur = ''; continue; }
    const b = KEY[ch]; if (!b) return null;
    cur += b;
  }
  return out.length >= 2 ? out.join(' ') : null;
}

/** 問句 → 讀音單位：[{ start, end, char?, syl?: Set, initial? }]。漢字查表；連續注音依最長合法音節切（聲調符號併到前一個音節）；
 *  單獨一個不成音節的聲母（登ㄍ熱的ㄍ）當「聲母萬用字」；空白與聲調不算單位，所以「ㄉㄥ ㄍㄜˊ ㄖㄜˋ」是連續三個單位 */
function units(q) {
  const out = []; let i = 0;
  while (i < q.length) {
    if (BOPO.test(q[i])) {
      let j = i; while (j < q.length && BOPO.test(q[j])) j++;
      for (let k = i; k < j;) {
        let len = Math.min(4, j - k);
        while (len > 1 && !SYLL.has(q.slice(k, k + len))) len--;
        const s = q.slice(k, k + len);
        out.push(SYLL.has(s) ? { start: k, end: k + len, syl: new Set([s]) } : INITIALS.has(s) ? { start: k, end: k + 1, initial: s } : { start: k, end: k + len });
        k += len;
      }
      while (j < q.length && TONE_1.test(q[j])) j++;
      out[out.length - 1].end = j;
      i = j; continue;
    }
    if (!/[\sˊˇˋ˙]/.test(q[i])) out.push({ start: i, end: i + 1, char: q[i], syl: READ.get(q[i]) });
    i++;
  }
  return out;
}

const matches = (u, ch) => {
  if (u.char === ch) return 'same';
  const want = READ.get(ch); if (!want) return null;
  if (u.initial) return [...want].some((s) => s.startsWith(u.initial)) ? 'initial' : null;
  if (u.syl && [...u.syl].some((s) => want.has(s))) return 'sound';
  return null;
};

export default function phonetic({ lex, seen }) {
  // 比對對象：全中文、兩字以上的疾病、疫苗、詞彙主檔名稱（不含單位：「疾管署」打錯不影響找答案）
  const targets = lex.names.filter((n) => /^[一-鿿]{2,}$/.test(n) && READ.has(n[0]) && lex.info(n)?.kind !== 'unit');

  /** 把注音文的單獨聲母換回虛字（「會傳染ㄇ」→「會傳染嗎」） */
  function particles(q) {
    return q.replace(/(?<![ㄅ-ㄩˊˇˋ˙])([ㄇㄉㄅㄋㄌㄏ])(?![ㄅ-ㄩˊˇˋ˙])/g, (m, c, at) => (at > 0 ? PARTICLE[c] : m));
  }

  /** 回傳 { text, fixes:[{ from, to, how }] } 或 null。how：homophone（同音字）／zhuyin（注音）／keyboard（鍵盤亂碼） */
  function fix(raw) {
    let text = String(raw ?? ''); const fixes = [];
    const kb = decodeKeyboard(text);
    if (kb) { fixes.push({ from: text, to: kb, how: 'keyboard' }); text = kb; }
    const u = units(text);
    const hits = [];
    for (const n of targets) {
      if (text.includes(n)) continue;
      for (let i = 0; i + n.length <= u.length; i++) {
        let same = 0, init = 0, ok = true;
        for (let k = 0; k < n.length && ok; k++) {
          const m = matches(u[i + k], n[k]);
          if (!m) ok = false; else if (m === 'same') same++; else if (m === 'initial') init++;
        }
        if (!ok || same === n.length || init > 1 || init === n.length) continue;
        if (!same && n.length < 3) continue;
        const from = text.slice(u[i].start, u[i + n.length - 1].end);
        if (!BOPO.test(from) && (lex.info(from) || seen?.(from))) continue; // 原文本身就是站上用過的詞（結合≠結核）
        hits.push({ from, to: n, canon: lex.info(n).canon, start: u[i].start, end: u[i + n.length - 1].end, how: BOPO.test(from) ? 'zhuyin' : 'homophone' });
      }
    }
    // 被更長的命中完全包住的短命中不算（「登革熱疫苗」命中時，「革熱」那類短名不另外算）
    const kept = hits.filter((h) => !hits.some((o) => o !== h && o.start <= h.start && o.end >= h.end && o.end - o.start > h.end - h.start));
    if (kept.length && kept.every((h) => h.canon === kept[0].canon)) {
      const h = kept.sort((a, b) => b.to.length - a.to.length)[0];
      text = text.slice(0, h.start) + h.to + text.slice(h.end);
      fixes.push({ from: h.from, to: h.to, how: h.how, canon: h.canon, kind: lex.info(h.to).kind });
    } else if (kb) return null; // 亂碼解得開、卻對不到任何名稱：照原字查，不拿一串注音去查
    const p = particles(text);
    if (p !== text) { fixes.push({ from: text, to: p, how: 'particle' }); text = p; }
    // 剩下還有注音符號（例如整句打注音、只對到其中一個名稱）就把注音拿掉，避免 bigram 用注音字元去比對
    if (BOPO.test(text)) text = text.replace(/[ㄅ-ㄩˊˇˋ˙]+/g, ' ').replace(/\s+/g, ' ').trim();
    const shown = fixes.filter((f) => f.how !== 'keyboard' && f.how !== 'particle');
    return shown.length || fixes.some((f) => f.how === 'particle') ? { text, fixes } : null;
  }

  return { fix };
}
