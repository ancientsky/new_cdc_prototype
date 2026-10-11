// 答案引擎：輸入防護、斷詞、數字與句切（純函式；Node 與瀏覽器共用）。第三十四輪自 core.js 拆出，ARCHITECTURE 第 40 章。

// ───────────────────────── 1. 輸入防護 ─────────────────────────

export const PII_RULES = [
  { kind: 'id', re: /(?<![A-Za-z0-9])[A-Z][1289]\d{8}(?!\d)/g, label: '[身分證]' },
  { kind: 'card', re: /(?<!\d)(?:\d{4}[- ]){3}\d{4}(?!\d)/g, label: '[卡號]' },
  { kind: 'nhi', re: /(?<!\d)\d{12}(?!\d)/g, label: '[健保卡號]' },
  { kind: 'mobile', re: /(?<!\d)(?:\+?886[-\s]?|0)9\d{2}[-\s]?\d{3}[-\s]?\d{3}(?!\d)/g, label: '[電話]' },
  { kind: 'phone', re: /(?<!\d)\(?0\d{1,2}\)?[-\s]?\d{3,4}[-\s]?\d{3,4}(?!\d)/g, label: '[電話]' },
  { kind: 'email', re: /[\w.+-]+@[\w-]+\.[\w.-]+/g, label: '[email]' },
  { kind: 'address', re: /[一-鿿]{1,6}[市縣][一-鿿]{1,6}[區鄉鎮市][一-鿿\d]{1,12}[路街道](?:[一二三四五六七八九十\d]+段)?(?:\d+巷)?(?:\d+弄)?\d+號(?:之\d+)?(?:\d+樓)?/g, label: '[地址]' },
  { kind: 'address', re: /[一-鿿\d]{1,12}[路街道](?:[一二三四五六七八九十\d]+段)?(?:\d+巷)?(?:\d+弄)?\d+號(?:之\d+)?(?:\d+樓)?/g, label: '[地址]' },
  { kind: 'name', re: /(我叫|我的名字(?:是|叫)|姓名[:：]?|my name is)\s*([一-鿿]{2,3}|[A-Z][a-z]+(?: [A-Z][a-z]+)?)/g, label: '$1[姓名]' },
];

/** 個資遮蔽（送模型或寫入稽核紀錄前一定先過這裡） */
export function maskPII(text) { return maskPIIDetailed(text).text; }

export function maskPIIDetailed(text) {
  let out = String(text ?? '');
  const hits = [];
  for (const r of PII_RULES) {
    out = out.replace(r.re, (...m) => { hits.push(r.kind); return r.label.includes('$1') ? r.label.replace('$1', m[1]) : r.label; });
  }
  return { text: out, hits: [...new Set(hits)] };
}

export const INJECTION_RULES = [
  // 第四十輪：「忘記打第二劑，要照醫師指示補打嗎」原本也中（忘記…指示中間可夾 10 字）；中間只容許 6 字以內，指的必須是「指示」本身
  { id: 'inj.ignore-zh', re: /(忽略|無視|忘記|不要理會|跳過)(掉)?.{0,2}(以上|之前|前面|上述|先前|所有|全部|原本|系統)?.{0,4}(的)?(指示|指令|規則|設定|限制|提示|要求)/ },
  { id: 'inj.ignore-en', re: /(ignore|disregard|forget)\s+(all\s+|any\s+)?(the\s+)?(previous|above|prior|earlier|your)?\s*(instructions|rules|prompts?|guidelines)/i },
  { id: 'inj.role-zh', re: /(你現在是|你現在扮演|從現在開始你是|假裝你是|扮演一個|你不再是|切換成.{0,6}模式)/ },
  { id: 'inj.role-en', re: /(you are now|act as (?:a|an|my)|pretend (?:to be|you are)|roleplay as|from now on,? you)/i },
  { id: 'inj.system-prompt', re: /(system\s*prompt|系統提示|系統指令|系統訊息|你的(提示詞|指令|設定)|initial instructions|developer message|<\/?\s*system\s*>|\[\s*system\s*\])/i },
  // 第四十輪（issue #70）：原本 `\bDAN\b` 加 /i，印尼文連接詞 dan（和）必中，首頁 /id/ 移工卡片的預設問題被當成注入拒答。
  // 「DAN」越獄只認大寫、而且要有上下文（DAN mode／act as DAN／DAN 模式／Do Anything Now）；單獨一個 DAN 不算。不分大小寫的片語留在 /i 那條。
  { id: 'inj.jailbreak', re: /(jailbreak|越獄|developer mode|開發者模式|do anything now|不受(任何)?限制|解除(所有)?限制|沒有任何限制)/i },
  { id: 'inj.jailbreak-dan', re: /(\bDAN\s*(?:[Mm]ode|MODE|[Pp]rompt|模式)|(?:[Aa]ct as|[Yy]ou are(?: now)?|[Pp]retend to be|[Bb]ecome|[Ee]nable|啟用|扮演|你是|變成)\s*(?:a\s+|the\s+)?DAN\b)/ },
  { id: 'inj.reveal', re: /(顯示|列出|輸出|告訴我|print|reveal|show).{0,8}(你的|your).{0,6}(提示|指令|規則|prompt|instructions|rules)/i },
];

/** 提示注入偵測：回傳 { detected, ruleId, match } */
export function detectInjection(text) {
  const s = String(text ?? '');
  for (const r of INJECTION_RULES) { const m = s.match(r.re); if (m) return { detected: true, ruleId: r.id, match: m[0] }; }
  return { detected: false, ruleId: null, match: null };
}

// ───────────────────────── 斷詞與數字 ─────────────────────────

export const CJK_CLASS = '\\u3400-\\u9fff\\uf900-\\ufaff';
export const TOKEN_RE = new RegExp(`([${CJK_CLASS}]+)|((?:(?![${CJK_CLASS}])[\\p{L}\\p{N}\\p{M}])+)`, 'gu');
export const THAI_RE = /^[฀-๿]+$/;
export const EN_STOP = new Set('a an the of to in on for and or is are was were be been do does did i me my you your we our it its this that these those what which who whom how when where why can could should would will shall may might must have has had with by at from as about if than then so not no yes there here any some please tell know want need get go going am im i\'m into out up'.split(' '));
export const VI_STOP = new Set('tôi bạn có không là và của cho với thì mà này đó những các một được khi nào gì ai'.split(' '));
// 查詢端的高頻功能 bigram（不影響文件端）
export const STOP_BIGRAMS = new Set(['什麼', '怎麼', '可以', '要不', '不要', '是不', '不是', '有沒', '沒有', '請問', '一下', '如果', '這個', '那個', '哪些', '是否', '會不', '不會', '應該', '我們', '你們', '他們', '我的', '我要', '我想', '想問', '問一', '知道', '告訴', '訴我', '的人', '了嗎', '是真', '真的', '的嗎', '嗎？', '一個', '多少', '還是', '或是', '還有', '到底', '需不', '不需', '能不', '不能', '這樣', '那樣', '怎樣', '如何', '哪裡', '為什', '的話', '現在', '目前', '最近', '要怎', '麼辦', '怎麼辦']);

export function stem(w) {
  if (/^\d+$/.test(w) || w.length <= 3) return w;
  if (w.endsWith('ies') && w.length > 4) return `${w.slice(0, -3)}y`;
  if (w.endsWith('ing') && w.length > 5) return w.slice(0, -3);
  if (w.endsWith('ed') && w.length > 4) return w.slice(0, -2);
  if (w.endsWith('es') && /(ches|shes|xes|ses)$/.test(w)) return w.slice(0, -2);
  if (w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us')) return w.slice(0, -1);
  return w;
}

/** 斷詞：中文字元 bigram（單字成段保留 unigram）＋ 拉丁／越南文詞（小寫、簡易詞幹）＋ 泰文 bigram ＋ 數字 */
export function tokenize(text, { query = false } = {}) {
  const out = [];
  const str = String(text ?? '').normalize('NFKC').toLowerCase();
  for (const m of str.matchAll(TOKEN_RE)) {
    if (m[1]) {
      const r = m[1];
      if (r.length === 1) { out.push(r); continue; }
      for (let i = 0; i < r.length - 1; i++) { const b = r.slice(i, i + 2); if (!(query && STOP_BIGRAMS.has(b))) out.push(b); }
    } else {
      const w = m[2];
      if (THAI_RE.test(w)) { for (let i = 0; i < w.length - 1; i++) out.push(w.slice(i, i + 2)); continue; }
      if (EN_STOP.has(w) || VI_STOP.has(w)) continue;
      if (w.length === 1 && !/\d/.test(w)) continue;
      out.push(stem(w));
    }
  }
  return out;
}

/** 字元 bigram（去空白與標點；相似度比對用） */
export function bigrams(s) {
  const t = String(s ?? '').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
  const out = [];
  for (let i = 0; i < t.length - 1; i++) out.push(t.slice(i, i + 2));
  if (t.length === 1) out.push(t);
  return out;
}

export const CN_DIGIT = { 零: 0, 〇: 0, 一: 1, 二: 2, 兩: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
export const CN_UNIT = { 十: 10, 百: 100, 千: 1000, 萬: 10000 };
export const EN_NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20 };

/** 中文數字 → 數字：五、十、十五、二十三、兩、一百零五；阿拉伯數字原樣 */
export function parseChineseNumber(s) {
  const str = String(s ?? '').trim();
  if (/^\d+(\.\d+)?$/.test(str)) return Number(str);
  if (EN_NUM[str.toLowerCase()] != null) return EN_NUM[str.toLowerCase()];
  if (str === '半') return 0.5;
  let total = 0, section = 0, cur = 0, seen = false;
  for (const ch of str) {
    if (ch in CN_DIGIT) { cur = CN_DIGIT[ch]; seen = true; }
    else if (ch === '萬') { total += (section + cur) * 10000; section = 0; cur = 0; seen = true; }
    else if (ch in CN_UNIT) { section += (cur || 1) * CN_UNIT[ch]; cur = 0; seen = true; }
    else return null;
  }
  return seen ? total + section + cur : null;
}

export const NUM_PAT = '(\\d+|[零〇一二兩两三四五六七八九十百]+|半)';
export const UNIT_MAP = { 年: 'year', 週: 'week', 周: 'week', 星期: 'week', 禮拜: 'week', 個月: 'month', 月: 'month', 天: 'day', 日: 'day' };
export const RANGE_RES = [
  new RegExp(`(?:近|最近|過去|前|這|近來)\\s*${NUM_PAT}\\s*(?:個)?\\s*(年|週|周|星期|禮拜|個月|月|天|日)`),
  new RegExp(`${NUM_PAT}\\s*(?:個)?\\s*(年|週|周|星期|個月|天)(?:來|以來|內|間)`),
];

/** 時間範圍解析：近五年、近三週、過去 10 年、這十年來、2019 到 2023 年、112 年（民國） */
export function parseTimeRange(q) {
  const s = String(q ?? '');
  const out = { n: null, unit: null, years: [], from: null, to: null, text: null };
  for (const re of RANGE_RES) {
    const m = s.match(re);
    if (m) {
      const n = parseChineseNumber(m[1]);
      if (n != null) {
        out.n = n; out.unit = UNIT_MAP[m[2]] ?? 'year'; out.text = m[0];
        if (n === 0.5 && out.unit === 'year') { out.n = 6; out.unit = 'month'; }
        break;
      }
    }
  }
  if (out.n == null) {
    const en = s.match(/(?:last|past|previous)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|twelve|fifteen|twenty)\s+(year|week|month|day)s?/i);
    if (en) { out.n = parseChineseNumber(en[1]); out.unit = en[2].toLowerCase(); out.text = en[0]; }
  }
  if (out.n == null) {
    const vi = s.match(/(\d+)\s+(năm|tuần|tháng|ngày)\s+(qua|gần đây)/i);
    if (vi) { out.n = Number(vi[1]); out.unit = { năm: 'year', tuần: 'week', tháng: 'month', ngày: 'day' }[vi[2].toLowerCase()]; out.text = vi[0]; }
  }
  const range = s.match(/(?<!\d)((?:19|20)\d{2})\s*(?:年)?\s*(?:到|至|~|～|-|–|—|to)\s*((?:19|20)\d{2})(?!\d)/);
  if (range) { out.from = Number(range[1]); out.to = Number(range[2]); }
  const rocRange = s.match(/(?<!\d)(1[01]\d)\s*(?:年)?\s*(?:到|至|~|～|-|–)\s*(1[01]\d)\s*年/);
  if (!range && rocRange) { out.from = Number(rocRange[1]) + 1911; out.to = Number(rocRange[2]) + 1911; }
  for (const m of s.matchAll(/(?<!\d)((?:19|20)\d{2})(?!\d)\s*(?:年(?!次))?/g)) out.years.push(Number(m[1]));
  for (const m of s.matchAll(/(?:民國\s*)?(?<!\d)(1[01]\d)\s*年(?!次)/g)) out.years.push(Number(m[1]) + 1911);
  out.years = [...new Set(out.years)];
  if (out.from == null && out.years.length >= 2 && /(到|至|~|～|–|—)/.test(s)) { out.from = Math.min(...out.years); out.to = Math.max(...out.years); }
  return out;
}

/** 西元 → 民國日期字串：2026-09-15 → 115/9/15 */
export function rocDate(iso) {
  if (!iso) return '';
  const [y, m, d] = String(iso).split('-').map(Number);
  if (!y) return String(iso);
  return `${y - 1911}/${m}/${d}`;
}


// §39.3：數字＋單位 → Map(單位 → Set(值))
export const CONSISTENCY_UNIT_RE = /(\d+(?:\.\d+)?)(?:\s*(?:至|到|～|~|–|—|-)\s*(\d+(?:\.\d+)?))?\s*(個月|小時|分鐘|天|日|週|周|月|年|歲|劑|次|%|％|公尺|度)/g;
export const CONSISTENCY_DATE_RE = /\d{2,4}\s*年\s*\d{1,2}\s*月(?:\s*\d{1,2}\s*日)?|\d{1,2}\s*月\s*\d{1,2}\s*日|\d{4}[-/]\d{1,2}(?:[-/]\d{1,2})?/g;
export const UNIT_CANON = { 周: '週', 日: '天', '％': '%' };
export function numbersByUnit(text) {
  const t = String(text ?? '').normalize('NFKC').replace(CONSISTENCY_DATE_RE, ' ');
  const m = new Map();
  for (const x of t.matchAll(CONSISTENCY_UNIT_RE)) {
    const u = UNIT_CANON[x[3]] ?? x[3];
    if (!m.has(u)) m.set(u, new Set());
    m.get(u).add(x[2] ? `${x[1]}-${x[2]}` : x[1]);
  }
  return m;
}

// ───────────────────────── 小工具 ─────────────────────────

export function mdPlain(md) {
  return String(md ?? '').replace(/```[\s\S]*?```/g, ' ').replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/^\s*#+\s*/gm, '').replace(/^\s*([-*+]|\d+\.)\s+/gm, '').replace(/[*_`~]+/g, '').replace(/[ \t]+/g, ' ').trim();
}

/** 句切（中英標點、換行）；索引建置與前端共用 */
/**
 * PDF 正本連結：真的 .pdf 檔且已知「封面目錄佔幾頁」（derivedFrom.pdfPageOffset）才加 #page=N，
 * 瀏覽器內建檢視器會跳到該頁。印刷頁碼 1 通常不是 PDF 第 1 頁，偏移量不明時寧可不跳頁，也不要跳錯頁。
 */
export function pdfHref(src) {
  const u = src.extraction?.pdfUrl;
  if (!u) return '';
  const off = src.extraction.pageOffset;
  return /\.pdf($|[?#])/i.test(u) && src.pdfPage && Number.isInteger(off) ? `${u.replace(/#.*$/, '')}#page=${src.pdfPage + off}` : u;
}

export function splitPlain(text) {
  return String(text ?? '')
    .split(/(?<=[。！？；])|(?<=[!?;])\s+|(?<=\.)\s+(?=[A-Z0-9(“"'])|\n+/)
    .map((s) => s.trim()).filter((s) => s.length >= 4 && /[\p{L}\p{N}]/u.test(s));
}
