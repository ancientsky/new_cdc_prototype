// 答案引擎：跨語言關鍵詞、口語改寫、站內詞典邊界與內容狀態小工具。第三十四輪自 core.js 拆出，ARCHITECTURE 第 40 章。
import { tokenize } from './text.js';

// ───────────────────────── 輔助：實體、同義詞 ─────────────────────────

// 跨語言關鍵詞（非中文問句 → 中文檢索詞），只做檢索展開，不出現在答案中
export const CROSS_LANG = [
  [/\b(see a doctor|seek (medical )?care|doctor|clinic|hospital)\b|đi khám|bác sĩ/i, '就醫 看醫生'],
  [/\bfever\b|sốt/i, '發燒'], [/\brash\b|phát ban/i, '出疹 紅疹'], [/\bsymptoms?\b|triệu chứng|\bgejala\b|\bsintomas\b|อาการ|症状/i, '症狀 徵象'],
  [/\bwarning signs?\b|dấu hiệu cảnh báo/i, '警示徵象'], [/\bincubation\b|ủ bệnh/i, '潛伏期'],
  [/\bprevent\w*\b|phòng ngừa|phòng bệnh/i, '預防'], [/\btransmi\w*|spread\w*|lây/i, '傳染 傳播'],
  [/\bvaccin\w*|immuni[sz]\w*|vắc[\s-]?xin|tiêm/i, '疫苗 接種'], [/\btravel\w*|abroad|overseas|du lịch|nước ngoài/i, '出國 旅遊'],
  [/\bborn\b|sinh năm/i, '出生'], [/\badults?\b|người lớn/i, '成人'], [/\bchild(ren)?\b|kids?\b|trẻ em/i, '幼兒 兒童'],
  [/\bmosquito\w*|muỗi/i, '病媒蚊 防蚊'], [/\bstanding water|water containers?|nước đọng/i, '積水容器'],
  [/\bfree\b|publicly funded|miễn phí/i, '公費'], [/\bwho (can|should|is eligible)|eligib\w*|đối tượng/i, '對象'],
  [/\bhotline\b|đường dây nóng/i, '1922'], [/\bscam|lừa đảo/i, '詐騙'], [/\binvest\w*|đầu tư/i, '投資'],
  [/\bcases?\b|số ca/i, '病例'], [/\blocal\b|nội địa/i, '本土'], [/\bweeks?\b|tuần/i, '週'], [/\bdays?\b|ngày/i, '天'],
  [/\bhours?\b|giờ/i, '小時'], [/\bdengue\b|sốt xuất huyết/i, '登革熱'], [/\bmeasles\b|sởi/i, '麻疹'], [/\binfluenza|\bflu\b|cúm/i, '流感'],
  // 第四十輪（issue #75）：日、他加祿、印尼、泰文的常用詞（首頁預設問題用得到的才加）。第三欄 true＝「主題錨點」：
  // 問句有主題錨點時，回答的片段（前 3 塊）必須講到這個主題（外語片段要有原文詞、中文片段要有對應中文詞），否則不拿別的主題充數。
  [/ワクチン|予防接種|\bbakuna\b|\bmagpabakuna\b|\bvaksin\w*|\bimunisasi\b|วัคซีน/i, '疫苗 接種'], [/無料|\blibre(ng)?\b|\bgratis\b|ฟรี/i, '公費'],
  [/旅行|渡航|\bbiyahe\b|\bperjalanan\b|เดินทาง/i, '出國 旅遊'], [/準備|\bihahanda\b|\b(di)?siapkan\b|เตรียม|chuẩn bị|\bprepare\b/i, '準備 行前'],
  [/子ども|子供|\banak\b|\bbata\b|\bbé\b|ลูก|เด็ก/i, '幼兒 兒童'],
  [/\bmigrant workers?|\bforeign workers?|lao động (nước ngoài|nhập cư)|pekerja migran|tenaga kerja asing|manggagawang dayuhan|แรงงานต่างชาติ|แรงงานข้ามชาติ|外国人労働者/i, '移工 外籍', true],
  [/\bhealth (check|exam|screening)s?\b|\bmedical (check|exam)\w*|khám sức khỏe|pemeriksaan kesehatan|ตรวจสุขภาพ|健康診断/i, '健康檢查 健檢'],
  [/\bhealth insurance\b|bảo hiểm y tế|asuransi kesehatan|ประกันสุขภาพ|健康保険/i, '健保', true],
  // 來臺旅遊（入境）：站內目前沒有給來臺旅客的接種建議；錨點讓這類問句查無，而不是拿出國旅遊或流感疫苗的片段回答
  [/\b(?:visit(?:ing)?(?: or moving to)?|coming to|moving to|arriving in|travel(?:l)?ing to|travel to|holiday in|vacation in|trip to|touring)\s+taiwan\b/i, '來臺旅客 訪臺 來臺旅遊', true],
  // 第四十八輪（issue #101）：被動物咬傷（他加祿 nakagat、印尼 digigit、泰 ถูก…กัด、越 bị…cắn、日 噛まれ）與狗、貓。
  // 只是把外語詞對應到中文檢索詞；主題是否確認由中文錨點（core.js zhAnchors）與疾病實體判斷，不在這裡寫死答案
  [/\bbit(ten|es?)\b|\bscratch(ed)?\b|\b(na)?kagat\b|\bdigigit\b|\bgigitan\b|(ถูก|โดน).{0,8}กัด|bị .{0,10}cắn|噛まれ|かまれ/i, '咬傷 動物咬傷'],
  [/\bdogs?\b|\baso\b|\banjing\b|สุนัข|หมา|\bchó\b|犬/i, '狗'], [/\bcats?\b|\bpusa\b|\bkucing\b|แมว|\bmèo\b|猫/i, '貓'],
  [/\b(vaccination|immuni[sz]ation) records?\b|hồ sơ tiêm chủng|catatan imunisasi|record ng bakuna|ประวัติการฉีดวัคซีน|予防接種の記録|接種記録/i, '接種紀錄', true],
];
/** 第四十輪：問句命中的主題錨點：[{ re, zh[] }]（CROSS_LANG 第三欄為 true 者；中文問句另有 TOPIC_ZH） */
export function topicAnchorsOf(q) {
  const out = [];
  for (const [re, zh, anchor] of CROSS_LANG) if (anchor && re.test(q)) out.push({ re, zh: zh.split(' ') });
  return out;
}

// 中文常見口語 → 正式用語（只做檢索展開）
export const PARAPHRASE = [
  [/人傳人/, '人直接傳給人 傳染 傳播'], [/怎麼傳染|如何傳染|怎麼傳播|傳染途徑/, '傳染 傳播 傳染途徑'], [/看醫生|看病|去醫院/, '就醫'],
  [/打針|打疫苗|施打/, '接種 疫苗'], [/危險徵兆|警訊|嚴重的徵兆|重症徵兆/, '警示徵象 重症前兆 危險徵兆'], [/警示徵象/, '警示徵象 重症前兆'],
  [/自己好|會好嗎|自癒/, '自行康復'], [/特效藥|吃藥會好/, '特效 抗病毒藥物 支持性療法'], [/打幾劑|幾劑/, '劑'], [/多久內|幾天內|幾小時內/, '小時內 天內'],
  [/開打|什麼時候打/, '接種 開始 起'], [/哪裡打|哪裡可以打|接種地點/, '接種地點 合約院所'],
  [/要驗什麼|驗什麼|怎麼驗|怎麼檢查|做什麼檢查|要檢查什麼|如何診斷|怎麼診斷/, '診斷 檢驗 治療'],
  [/怎麼申請|如何申請|申請流程|怎麼辦理/, '申請 步驟'], [/要帶什麼|準備什麼|帶哪些/, '應備文件 準備'],
  [/影片|宣導片|衛教片|動畫/, '影片 影音'], [/職缺|徵才|徵人/, '招募'], [/標案|招標|投標/, '採購'],
  // 第四十輪：「外籍勞工／外勞」與站內用語「移工」「外籍人士」；「漏打／錯過」與「補接種」；「哺乳／餵母乳」
  [/外籍勞工|外勞|外籍移工|外籍看護|外籍工作者/, '移工 外籍'], [/漏打|沒打到|忘了打|忘記打|錯過|延遲接種|晚打|來不及打|晚了.{0,8}才打|延後(接種|打)/, '補接種 補打 漏打'],
  // 第四十八輪（issue #94）：「打過什麼疫苗要去哪裡查」→ 接種紀錄（查的是紀錄，不是接種點）
  [/打過(什麼|哪些|幾劑)|接種過(什麼|哪些)|(疫苗|接種)(紀錄|記錄)/, '接種紀錄 預防接種紀錄'],
  [/哺乳|餵母乳|親餵|母乳/, '哺乳'], [/懷孕|孕期|妊娠|有孕/, '孕婦 懷孕'],
];

export function lc(s) { return String(s ?? '').toLowerCase(); }
/** 介面字（建議行動標籤）：中文以外一律英文 */
export function tr(lang, zh, en) { return lang === 'zh-TW' ? zh : en; }


export function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
export function isLatin(s) { return /^[\x00-\x7fÀ-ɏḀ-ỿ\s.\-']+$/.test(s); }
/**
 * 第三十一輪：詞典邊界。檢索用的是字元 bigram，所以「性病」會打中「急性病毒性A型肝炎」、「性傳染病」會打中「慢性傳染病組」。
 * 中文沒有空白可當詞界，但站上有詞典（疾病名、別名、詞彙主檔、疫苗、單位）：
 * 已知名詞 P 若在一段文字裡只出現在另一個「指不同東西」的更長已知名詞 L 裡面，就不算出現。
 * 同一個東西的長短形式（愛滋／愛滋病）不互相遮蔽。索引端（index-builder 的 glossaryHits）與查詢端（retrieve／relevanceOf）共用。
 */
export function buildLexicon({ diseases = [], glossary = [], vaccines = [], units = [] } = {}) {
  const lexicon = new Map(); // 小寫名稱 → { canon, kind }；kind：disease／vaccine／unit／term
  const termCanon = new Map(); // 小寫名稱 → 詞彙主檔正名（同義形式查詢用）
  const canonForms = new Map(); // 正名 → 所有中文形式（小寫）
  const addLex = (name, canon, kind) => { const n = lc(String(name ?? '').trim()); if (n.length >= 2 && /[一-鿿]/.test(n) && !lexicon.has(n)) lexicon.set(n, { canon, kind }); };
  for (const d of diseases) for (const n of [d.name, ...(d.aliases ?? [])]) addLex(n, d.id, 'disease');
  for (const g of glossary) {
    const canon = (g.refs ?? []).find((r) => String(r).startsWith('disease.')) ?? g.id ?? g['zh-TW'];
    const forms = [g['zh-TW'], ...(g.aliases ?? []), ...(g.deprecated ?? [])].filter(Boolean);
    for (const n of forms) { addLex(n, canon, g.domain === 'vaccine' ? 'vaccine' : g.domain === 'org' ? 'unit' : String(canon).startsWith('disease.') ? 'disease' : 'term'); if (g['zh-TW']) termCanon.set(lc(n), g['zh-TW']); }
    if (g['zh-TW']) canonForms.set(g['zh-TW'], new Set(forms.map(lc)));
  }
  for (const v of vaccines) for (const n of [v.name, v.title, ...(v.aliases ?? [])]) addLex(n, v.id, 'vaccine');
  for (const u of Array.isArray(units) ? units : []) addLex(u.name, u.id, 'unit');
  const names = [...lexicon.keys()].sort((a, b) => b.length - a.length);
  // 「遮蔽」關係：更長的名詞 L 指的是別的東西（不同疾病、單位、一般名詞）才會遮住 P；疫苗名不遮它所對應的疾病（新冠疫苗、B型肝炎疫苗仍是在講那個病）
  const masks = (L, P) => { const a = lexicon.get(L), b = lexicon.get(P); return a.canon !== b.canon && a.kind !== 'vaccine'; };
  const superOf = new Map(); // 名稱 → 包含它、且會遮蔽它的更長名稱
  for (const n of names) { const sup = names.filter((m) => m.length > n.length && m.includes(n) && masks(m, n)); if (sup.length) superOf.set(n, sup); }
  const positions = (h, w) => { const out = []; for (let i = h.indexOf(w); i >= 0; i = h.indexOf(w, i + 1)) out.push(i); return out; };
  /** 文字 hay（小寫）裡，name 是否有至少一次「不是躲在別的更長名詞裡」的出現 */
  function wholeHit(hay, name) {
    const n = lc(name); const pos = positions(hay, n);
    if (!pos.length) return false;
    const sup = superOf.get(n); if (!sup) return true;
    const covered = []; for (const L of sup) for (const i of positions(hay, L)) covered.push([i, i + L.length]);
    return pos.some((i) => !covered.some(([s, e]) => i >= s && i + n.length <= e));
  }
  /** 問句裡的已知名詞（取最長、不重疊）：[{ name, canon, supers, forms, tokens }] */
  function phrasesIn(q) {
    const lq = lc(q); const out = []; const taken = [];
    for (const n of names) {
      const free = positions(lq, n).filter((i) => !taken.some(([s, e]) => i < e && i + n.length > s));
      if (!free.length) continue;
      taken.push([free[0], free[0] + n.length]);
      const forms = canonForms.get(termCanon.get(n));
      out.push({ name: n, canon: lexicon.get(n).canon, supers: superOf.get(n) ?? [], forms: forms ? [...forms].filter((f) => f !== n) : [], tokens: tokenize(n) });
    }
    return out;
  }
  const chunkHay = (c) => lc(`${c.title ?? ''} ${c.text ?? ''} ${(c.terms ?? []).join(' ')}`);
  /**
   * 片段裡只躲在「別的更長名詞」裡的問句名詞（含它的同義形式，例如問「性病」展開的「性傳染病」）→ 它的 token 不算命中。
   * 只拿掉片段其他地方沒再出現的 token（把遮蔽它的長名詞挖掉後重新斷詞比對），不會誤傷片段裡本來就有的詞。回傳 Set；空 Set＝沒有。
   */
  function falseTokensFor(c, phrases) {
    const out = new Set(); let hay = null;
    for (const p of phrases) {
      if ((c.diseases ?? []).includes(p.canon) || (c.vaccines ?? []).includes(p.canon)) continue; // 片段本來就標了這個疾病／疫苗
      for (const w of [p.name, ...p.forms]) {
        const sup = superOf.get(w); if (!sup) continue;
        hay ??= chunkHay(c);
        if (!hay.includes(w) || wholeHit(hay, w)) continue;
        let masked = hay; for (const L of sup) masked = masked.split(L).join(' ');
        const rest = new Set(tokenize(masked));
        for (const t of tokenize(w)) if (!rest.has(t)) out.add(t);
      }
    }
    return out;
  }
  /** 問句裡的別名可不可以拿來做同義詞展開：躲在「別的疾病／單位」名稱裡的不行（急性傳染病組 ≠ 性傳染病）；疫苗名不遮蔽，所以 B型肝炎疫苗 → B型肝炎 照常展開 */
  function expandable(q, alias) {
    const lq = lc(q); const n = lc(alias); const pos = positions(lq, n);
    if (!pos.length) return true; // 非中文別名走原本的字界正則
    const sup = superOf.get(n); if (!sup) return true;
    const covered = []; for (const L of sup) for (const i of positions(lq, L)) covered.push([i, i + L.length]);
    return pos.some((i) => !covered.some(([s, e]) => i >= s && i + n.length <= e));
  }
  /** 詞典斷詞：在問句裡的已知名詞前後補空白，bigram 就不會跨過詞界（「性病症狀」→「性病 症狀」，不再產生「病症」這個假詞） */
  function segment(q) {
    const str = String(q ?? ''); const lq = lc(str); const cuts = new Set(); const taken = [];
    for (const n of names) for (const i of positions(lq, n)) { if (taken.some(([s, e]) => i < e && i + n.length > s)) continue; taken.push([i, i + n.length]); cuts.add(i); cuts.add(i + n.length); }
    if (!cuts.size) return str;
    let out = ''; for (let i = 0; i < str.length; i++) { if (cuts.has(i)) out += ' '; out += str[i]; }
    return out.replace(/\s+/g, ' ').trim();
  }
  return { names, wholeHit, phrasesIn, falseTokensFor, expandable, segment, chunkHay, size: lexicon.size };
}

// 第四十輪（Issue #80）：名稱比對器加「必要子字串」預篩。
// 量測：/ask/?q=登革熱 在 4 倍 CPU 降速的手機上 TBT 4.6 秒，其中約 3.6 秒是 detectEntities／expandQuery 對 1,260 個疾病／國家名稱
// （一半是帶 \p{L} 與 iu 旗標的拉丁名稱）逐一執行正規式——V8 的正規式是「第一次執行時才編譯」，而且單位元組（英文）與雙位元組（中文）
// 字串各編一次、跑過一次後再升級成機器碼再編一次；問一題就把上千個正規式各編譯兩三次，而真正會命中的只有兩三個。
// 做法：每個名稱算出一段「任何命中都一定包含」的字面子字串（名稱裡最長、不含可省略空白的那段，轉小寫），
// 問句（轉小寫）不含這段就直接判定不命中、不執行也不編譯正規式。判定結果與原本完全相同（只是提早說「不會中」），
// 引擎邏輯與規則表都沒有改；tests/round40-ask-perf.test.mjs 用評估集全部問句比對新舊結果一致。
// 為什麼放在 matcherFor 而不是改 core.js 的迴圈：所有用名稱比對器的地方（實體、同義詞展開）一次受益，呼叫端不用改。
let lastSubject = null;
let lastLower = '';
const lowerOf = (s) => {
  if (s !== lastSubject) { lastSubject = s; lastLower = s.toLowerCase(); }
  return lastLower;
};
// 連 RegExp 物件本身也等到第一次需要才建：帶 \p{L} 與 iu 旗標的正規式「建立」就要展開大小寫等價的 Unicode 字元集，
// 上千個名稱光建立就約 150 ms（Node 實測；手機 4 倍降速約 0.6 秒），而多數名稱一輩子不會被預篩放行。
// 呼叫端只用 re.test(s) 與 s.match(re)（後者透過 Symbol.match 呼叫這裡），行為與 RegExp 相同。
class NameMatcher {
  constructor(pattern, flags, needle) {
    this.pattern = pattern;
    this.flags = flags;
    this.needle = needle || null;
    this.rx = null;
  }
  get re() { return (this.rx ??= new RegExp(this.pattern, this.flags)); }
  get source() { return this.re.source; }
  exec(s) {
    if (this.needle && !lowerOf(String(s)).includes(this.needle)) return null;
    return this.re.exec(s);
  }
  test(s) { return this.exec(s) !== null; }
  [Symbol.match](s) { return this.exec(String(s)); }
  toString() { return String(this.re); }
}
/** 名稱切成「中間不會插入 \s*」的字面片段，取最長的一段（小寫）當必要子字串 */
function needleOf(chars, splitAt) {
  let best = ''; let cur = '';
  chars.forEach((ch, i) => {
    if (ch === ' ' || (i > 0 && splitAt(chars[i - 1], ch))) { if (cur.length > best.length) best = cur; cur = ''; }
    if (ch !== ' ') cur += ch;
  });
  if (cur.length > best.length) best = cur;
  const low = best.toLowerCase();
  // 只有「轉小寫」與正規式 i 旗標的大小寫規則一致時才預篩（ASCII、中日文、拉丁擴充字母）；其他字元保守地不預篩
  return /^[\x21-\x7eÀ-ɏḀ-ỿ぀-ヿ㐀-䶿一-鿿豈-﫿]+$/.test(low) ? low : null;
}
const ALNUM = /[A-Za-z0-9]/;

export function matcherFor(name) {
  if (!name) return null;
  const n = String(name).trim();
  if (n.length < 2 && !/[一-鿿]/.test(n)) return null;
  if (isLatin(n)) return new NameMatcher(`(?<![\\p{L}\\p{N}])${escapeRe(n).replace(/\\s+/g, '\\s*')}(?![\\p{L}\\p{N}])`, 'iu', needleOf([...n.replace(/\s+/g, ' ')], () => false));
  // 中英混排名稱（A 肝、MMR 疫苗、B 型肝炎）：空白可有可無
  let pat = '';
  const chars = [...n.replace(/\s+/g, ' ')];
  const transition = (prev, ch) => prev !== ' ' && ch !== ' ' && ALNUM.test(prev) !== ALNUM.test(ch);
  chars.forEach((ch, i) => {
    if (ch === ' ') { pat += '\\s*'; return; }
    const prev = chars[i - 1];
    if (prev && transition(prev, ch)) pat += '\\s*';
    pat += escapeRe(ch);
  });
  return new NameMatcher(pat, 'i', needleOf(chars, transition));
}

/**
 * 第四十一輪：拉丁名「≥4 個字母-數字」（COVID-19）的字母詞幹（COVID）也當別名。
 * 為什麼：拉丁名稱是整字比對（matcherFor 前後不能接字母數字），民眾打「covid」不會命中「COVID-19」，整題就查無；
 * 但「H5N1」「EV71」這類沒有連字號、或字母不到 4 個的代號，砍掉數字會變成別的東西（H、EV），所以不套用。
 * 歧義檢查：詞幹本來就是某個已知名稱（known）就不動（同一個東西＝資料已有；別的東西＝不能搶）；
 * 兩個不同對象（key）推出同一個詞幹也都不加，寧可查無也不答錯，並把它記進 known，讓下一次呼叫（同義詞展開）也跳過。
 * pairs：[[名稱, key]]；回傳 [[詞幹(小寫), key]]。
 */
export function latinStems(pairs, known) {
  const out = new Map();
  const own = new Map();
  for (const [n, k] of pairs) (own.get(k) ?? own.set(k, new Set()).get(k)).add(lc(n).trim());
  for (const [n, k] of pairs) {
    const cands = [lc(/^([a-z]{4,})-\d+[a-z0-9]*$/i.exec(String(n ?? '').trim())?.[1])];
    // 第四十八輪（issue #101）：三個字以上的拉丁名稱，頭或尾那個字「本身就是同一對象的另一個名稱」時，去掉它的短稱也當別名。
    // 例：印尼文詞彙主檔寫「Demam berdarah dengue」，民眾只打「demam berdarah」；尾字 dengue 已是登革熱的別名，去掉它不會變成別的東西。
    // 越南文「Sốt xuất huyết Dengue」→「sốt xuất huyết」同理。歧義檢查與上面的詞幹相同（已知名稱不動、兩個對象推出同一短稱都不加）
    const w = lc(n).trim().split(/\s+/);
    if (w.length > 2 && isLatin(n)) for (const [cut, rest] of [[w.at(-1), w.slice(0, -1)], [w[0], w.slice(1)]]) if (own.get(k).has(cut)) cands.push(rest.join(' '));
    for (const s of cands) if (s && !known.has(s)) out.set(s, out.has(s) && out.get(s) !== k ? null : k);
  }
  for (const [s, k] of out) if (k === null) known.add(s); // 記下有歧義的詞幹：下一輪（同義詞展開）也不加
  return [...out].filter(([, k]) => k !== null);
}

export function ownerNameOf(units, id) { return units.find((u) => u.id === id)?.name ?? id ?? ''; }
export function unwrap(v) { return v && typeof v === 'object' && !Array.isArray(v) && 'data' in v && 'meta' in v ? v.data : v; }

export function annotationsOf(item) { return item?.gov?.annotations ?? item?.governance?.annotations ?? item?.annotations ?? []; }
export function isOutdated(item) {
  if (item?.verdict === 'outdated') return true;
  if (item?.gov?.stale?.length) return true;
  if (item?.governance?.stale?.length) return true;
  return annotationsOf(item).some((a) => a.kind === 'based-on-revised' || a.kind === 'superseded');
}

