// 答案引擎核心：純函式、不碰 DOM、Node 與瀏覽器共用（eval/run-eval.mjs 以同一份程式跑評估集）。
//
// createEngine(deps).answer(query, { lang, view, disease }) → AnswerResult
//
// 流程（ARCHITECTURE.md 第 5.2 節）：
//   1 輸入防護：個資遮蔽 → 提示注入偵測
//   2 意圖判斷：可解釋規則集（INTENT_RULES，每條 id + 權重）
//   3 拒答邊界：REFUSAL_RULES（個人診斷、用藥劑量、法律、未發布、媒體、預測、注入、隱私…）
//   4 檢索：BM25（字元 bigram + 英文詞）＋ 詞彙主檔同義詞／別名／deprecated 展開 ＋ 實體加權 ＋ 任務加權；
//          民眾只取 whitelist、專業只取 isCurrent；輸出側再檢一次（失效版、逾期）並記 guards
//   5 組句（抽取式）：句子評分、去重、依意圖排序、每句 cite、completeness
//   6 統計問答：資料集 series（加總／最高／最低／平均），不推論不預測
//   7 謠言查證：bigram Jaccard ＋ 包含度比對澄清；outdated 來自治理引擎
//   8 多語：同語言 reviewed chunk 優先，否則中文 chunk ＋ translationNote
//   9 稽核編號 A-YYYYMMDD-XXXX、disclosure
//  10 暫停：aiStatus.paused → 傳統結果列表
//
// AnswerResult（主要欄位）
// { query, lang, view, intent, intentReasons[], intentScores{}, refused, refusal?{kind,ruleId,title,text,actions[],relatedDisease,related[]},
//   disease, diseases[], entities{diseases,vaccines,countries}, termNotes[], sentences[{text,cite[],n[],citeLabel?}],
//   sources[], situation?, stats?, verdict?, clarification?, shareText?, reportChannel?, actions[], related[], list?,
//   confidence, completeness{required,covered,missing,score}, guards[], translationNote?, paused?, auditId, mode, disclosure, retrieved[] }

// ───────────────────────── 1. 輸入防護 ─────────────────────────

const PII_RULES = [
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

const INJECTION_RULES = [
  { id: 'inj.ignore-zh', re: /(忽略|無視|忘記|不要理會|跳過)(掉)?.{0,6}(以上|之前|前面|上述|先前|所有|全部|原本|系統)?.{0,4}(的)?(指示|指令|規則|設定|限制|提示|要求)/ },
  { id: 'inj.ignore-en', re: /(ignore|disregard|forget)\s+(all\s+|any\s+)?(the\s+)?(previous|above|prior|earlier|your)?\s*(instructions|rules|prompts?|guidelines)/i },
  { id: 'inj.role-zh', re: /(你現在是|你現在扮演|從現在開始你是|假裝你是|扮演一個|你不再是|切換成.{0,6}模式)/ },
  { id: 'inj.role-en', re: /(you are now|act as (?:a|an|my)|pretend (?:to be|you are)|roleplay as|from now on,? you)/i },
  { id: 'inj.system-prompt', re: /(system\s*prompt|系統提示|系統指令|系統訊息|你的(提示詞|指令|設定)|initial instructions|developer message|<\/?\s*system\s*>|\[\s*system\s*\])/i },
  { id: 'inj.jailbreak', re: /(jailbreak|越獄|DAN 模式|\bDAN\b|developer mode|開發者模式|不受(任何)?限制|解除(所有)?限制|沒有任何限制)/i },
  { id: 'inj.reveal', re: /(顯示|列出|輸出|告訴我|print|reveal|show).{0,8}(你的|your).{0,6}(提示|指令|規則|prompt|instructions|rules)/i },
];

/** 提示注入偵測：回傳 { detected, ruleId, match } */
export function detectInjection(text) {
  const s = String(text ?? '');
  for (const r of INJECTION_RULES) { const m = s.match(r.re); if (m) return { detected: true, ruleId: r.id, match: m[0] }; }
  return { detected: false, ruleId: null, match: null };
}

// ───────────────────────── 斷詞與數字 ─────────────────────────

const CJK_CLASS = '\\u3400-\\u9fff\\uf900-\\ufaff';
const TOKEN_RE = new RegExp(`([${CJK_CLASS}]+)|((?:(?![${CJK_CLASS}])[\\p{L}\\p{N}\\p{M}])+)`, 'gu');
const THAI_RE = /^[฀-๿]+$/;
const EN_STOP = new Set('a an the of to in on for and or is are was were be been do does did i me my you your we our it its this that these those what which who whom how when where why can could should would will shall may might must have has had with by at from as about if than then so not no yes there here any some please tell know want need get go going am im i\'m into out up'.split(' '));
const VI_STOP = new Set('tôi bạn có không là và của cho với thì mà này đó những các một được khi nào gì ai'.split(' '));
// 查詢端的高頻功能 bigram（不影響文件端）
const STOP_BIGRAMS = new Set(['什麼', '怎麼', '可以', '要不', '不要', '是不', '不是', '有沒', '沒有', '請問', '一下', '如果', '這個', '那個', '哪些', '是否', '會不', '不會', '應該', '我們', '你們', '他們', '我的', '我要', '我想', '想問', '問一', '知道', '告訴', '訴我', '的人', '了嗎', '是真', '真的', '的嗎', '嗎？', '一個', '多少', '還是', '或是', '還有', '到底', '需不', '不需', '能不', '不能', '這樣', '那樣', '怎樣', '如何', '哪裡', '為什', '的話', '現在', '目前', '最近', '要怎', '麼辦', '怎麼辦']);

function stem(w) {
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

const CN_DIGIT = { 零: 0, 〇: 0, 一: 1, 二: 2, 兩: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const CN_UNIT = { 十: 10, 百: 100, 千: 1000, 萬: 10000 };
const EN_NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20 };

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

const NUM_PAT = '(\\d+|[零〇一二兩两三四五六七八九十百]+|半)';
const UNIT_MAP = { 年: 'year', 週: 'week', 周: 'week', 星期: 'week', 禮拜: 'week', 個月: 'month', 月: 'month', 天: 'day', 日: 'day' };
const RANGE_RES = [
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

// ───────────────────────── 2. 意圖規則 ─────────────────────────

const PRO_TERMS = '通報|送驗|檢體|採檢|容器|運送|時限|病例定義|通函|致醫界|手冊|指引|工作手冊|防治手冊|第\\s*[\\d一二三四五六七八九十]+\\s*條|條文|條次|版次|新版|舊版|前版|改版|修訂|生效|快篩陽性|抗病毒藥劑使用對象|使用對象|疑似病例|確定病例|可能病例|檢驗|實驗室|ICD|隔離治療|接觸者|匡列|疫調|疫情調查|醫事人員|醫療院所|感染管制|感控|法定傳染病|傳染病類別|第[一二三四五]類|報告時限';

/**
 * 可解釋意圖規則。每條：{ id, intent, weight, re, note }。命中加權，最高分者為意圖；分數 < 2 → unknown。
 * view==='pro' 另加 pro.view 規則。
 */
export const INTENT_RULES = [
  // 症狀
  { id: 'sym.symptom-words', intent: 'symptoms', weight: 2, re: /(發燒|發熱|咳嗽|紅疹|起疹|出疹|疹子|拉肚子|腹瀉|嘔吐|頭痛|喉嚨痛|流鼻水|肌肉痠痛|關節痛|後眼窩痛|全身痠痛|倦怠|嗜睡|抽搐|呼吸急促|水泡|口腔潰瘍|黃疸|血便)/, note: '症狀詞' },
  { id: 'sym.symptom-generic', intent: 'symptoms', weight: 2, re: /(症狀|徵象|徵兆|前兆|不舒服|病徵)/, note: '症狀泛稱' },
  { id: 'sym.seek-care', intent: 'symptoms', weight: 3, re: /(要不要看醫生|該不該就醫|何時就醫|什麼時候.{0,4}就醫|幾天內.{0,6}就醫|就醫|看醫生|看診|掛號|急診|回診)/, note: '就醫時機' },
  { id: 'sym.what-to-do', intent: 'symptoms', weight: 1, re: /(怎麼辦|該怎麼做|如何處理)/, note: '求助語' },
  { id: 'sym.en', intent: 'symptoms', weight: 3, re: /\b(fever|symptoms?|rash|cough|diarrh?ea|vomit\w*|headache|see a doctor|seek (medical )?care|hospital|clinic)\b/i, note: 'English symptom words' },
  { id: 'sym.vi', intent: 'symptoms', weight: 3, re: /(sốt|triệu chứng|phát ban|ho\b|tiêu chảy|nôn|đi khám|bác sĩ)/i, note: 'Vietnamese symptom words' },
  // 疫苗
  { id: 'vac.vaccine-words', intent: 'vaccine', weight: 3, re: /(疫苗|接種|預防針|施打|追加劑|打針|打一劑|劑次)/, note: '疫苗詞' },
  { id: 'vac.public-funded', intent: 'vaccine', weight: 2, re: /(公費|自費|接種對象|接種時程|接種點|合約院所|幾歲.{0,4}打)/, note: '公費／時程' },
  { id: 'vac.named', intent: 'vaccine', weight: 2, re: /(\bMMR\b|麻疹腮腺炎德國麻疹|\bBCG\b|卡介苗|\bHPV\b|\bEV71\b|\bDTaP\b|五合一|水痘疫苗|肺炎鏈球菌疫苗)/i, note: '疫苗名稱' },
  { id: 'vac.en', intent: 'vaccine', weight: 3, re: /\b(vaccin\w*|immuni[sz]\w*|shots?|jab|booster)\b/i, note: 'English vaccine words' },
  { id: 'vac.vi', intent: 'vaccine', weight: 3, re: /(vắc[\s-]?xin|vaccine|tiêm chủng|tiêm phòng|chích ngừa)/i, note: 'Vietnamese vaccine words' },
  // 出國
  { id: 'trv.travel-words', intent: 'travel', weight: 3, re: /(出國|出境|旅遊|旅行|入境|回國|返國|返台|國外|行前|旅遊醫學|海外|轉機|自由行|跟團|遊學|出差)/, note: '旅遊詞' },
  { id: 'trv.go-to-country', intent: 'travel', weight: 2, re: /(去|到|前往|飛)(日本|韓國|越南|泰國|印尼|菲律賓|馬來西亞|新加坡|柬埔寨|緬甸|印度|中國|大陸|香港|澳門|美國|加拿大|歐洲|英國|法國|德國|非洲|中東|澳洲|紐西蘭|巴西|南美)/, note: '前往某國' },
  { id: 'trv.level', intent: 'travel', weight: 2, re: /(旅遊疫情建議|旅遊警示|疫情等級|第[一二三]級|注意\(Watch\)|警示\(Alert\)|警告\(Warning\))/i, note: '旅遊等級' },
  { id: 'trv.en', intent: 'travel', weight: 3, re: /\b(travel\w*|trip|abroad|overseas|going to|flight|destination)\b/i, note: 'English travel words' },
  { id: 'trv.vi', intent: 'travel', weight: 3, re: /(du lịch|đi nước ngoài|xuất cảnh|nhập cảnh|về nước)/i, note: 'Vietnamese travel words' },
  // 疫情
  { id: 'sit.now', intent: 'situation', weight: 3, re: /(現在|目前|最近|本週|這週|這陣子|近期|今年).{0,8}(疫情|流行|嚴重|很多人|多嗎|狀況|情況|高峰|就診率)/, note: '現況詢問' },
  { id: 'sit.severity', intent: 'situation', weight: 3, re: /(嚴重嗎|多嚴重|很嚴重|高峰期?|流行期|大流行|疫情|爆發|升溫|延燒|好多人得)/, note: '嚴重程度' },
  { id: 'sit.en', intent: 'situation', weight: 3, re: /\b(outbreak|situation|how bad|epidemic|is .{0,20} (spreading|serious|bad) (now|right now))\b/i, note: 'English situation words' },
  { id: 'sit.vi', intent: 'situation', weight: 3, re: /(tình hình dịch|dịch bệnh hiện nay|đang bùng phát)/i, note: 'Vietnamese situation words' },
  // 謠言
  { id: 'rum.ask-true', intent: 'rumor', weight: 5, re: /(是真的嗎|真的嗎|是假的|假的嗎|真的假的|是不是真的|可信嗎|謠言|網傳|傳言|聽說|闢謠|查證|假訊息|假新聞|詐騙|這則|這篇|這個訊息|訊息說|LINE\s*(上|群組)?(說|傳)|群組(說|傳)|轉傳|長輩圖|有人說)/i, note: '查證語' },
  { id: 'rum.en', intent: 'rumor', weight: 5, re: /\b(is it true|is this true|rumou?r|fake news|hoax|scam|fact[- ]check|i heard that)\b/i, note: 'English rumor words' },
  { id: 'rum.vi', intent: 'rumor', weight: 5, re: /(có thật không|tin đồn|tin giả|lừa đảo)/i, note: 'Vietnamese rumor words' },
  // 專業
  { id: 'pro.terms', intent: 'professional', weight: 3, re: new RegExp(`(${PRO_TERMS})`, 'i'), note: '專業詞（通報、送驗、檢體、病例定義、條次、版次、生效…）' },
  { id: 'pro.en', intent: 'professional', weight: 3, re: /\b(case definition|specimen|notification|reporting timeline|guideline version|clinical guidance)\b/i, note: 'English professional words' },
  // 統計
  { id: 'sta.count', intent: 'stats', weight: 3, re: /(幾例|多少例|多少人(?!.{0,4}(可以|能|要|需要))|病例數|個案數|確診數|人數|統計|數據|趨勢|就診率|發生率|死亡數|資料集|總共|合計|加總|累計|最高|最低|最多|最少|平均|歷年|每年|逐年|哪一年|哪年)/, note: '統計詞' },
  { id: 'sta.en', intent: 'stats', weight: 3, re: /\b(how many|number of cases|statistics|stats|case counts?|trend|data ?set)\b/i, note: 'English stats words' },
  { id: 'sta.vi', intent: 'stats', weight: 3, re: /(bao nhiêu ca|số ca|thống kê)/i, note: 'Vietnamese stats words' },
];

const INTENT_PRIORITY = ['rumor', 'stats', 'professional', 'situation', 'travel', 'vaccine', 'symptoms'];

/** 意圖判斷：回傳 { intent, reasons[], scores{} } */
export function classifyIntent(q, { view = 'public', hasTimeRange = false, hasDisease = false } = {}) {
  const scores = {}; const reasons = [];
  for (const r of INTENT_RULES) {
    if (r.re.test(q)) { scores[r.intent] = (scores[r.intent] ?? 0) + r.weight; reasons.push(r.id); }
  }
  if (hasTimeRange) { scores.stats = (scores.stats ?? 0) + 3; reasons.push('sta.time-range'); }
  if (view === 'pro') { scores.professional = (scores.professional ?? 0) + 4; reasons.push('pro.view'); }
  // 「現在疫情」與統計詞同時出現且沒有時間範圍 → 疫情優先（態勢卡回答）
  if (scores.situation && scores.stats && !hasTimeRange && /(現在|目前|最近|本週|這週|嚴重嗎)/.test(q)) { scores.stats -= 2; reasons.push('sit.over-stats'); }
  let best = 'unknown', bestScore = 0;
  for (const intent of INTENT_PRIORITY) { const s = scores[intent] ?? 0; if (s > bestScore) { best = intent; bestScore = s; } }
  if (bestScore < 2) { best = 'unknown'; if (hasDisease) reasons.push('unk.disease-only'); }
  // 專業模式：除謠言、統計、疫情外，一律以專業意圖回答（引用條次與版次，不白話化）
  if (view === 'pro' && !['rumor', 'stats', 'situation', 'professional'].includes(best)) { best = 'professional'; reasons.push('pro.view-override'); }
  return { intent: best, reasons, scores };
}

// ───────────────────────── 3. 拒答規則 ─────────────────────────

const PERSON = '(我|我的|本人|小孩|孩子|小朋友|兒子|女兒|寶寶|嬰兒|媽媽|爸爸|阿公|阿嬤|爺爺|奶奶|家人|老公|老婆|先生|太太|男友|女友|朋友|同事|室友|鄰居|學生)';
const DRUGS = '(普拿疼|乙醯胺酚|阿斯匹靈|布洛芬|ibuprofen|克流感|tamiflu|瑞樂沙|速克流|抗生素|退燒藥|止痛藥|消炎藥|類固醇|伊維菌素|奎寧|抗病毒藥)';

/**
 * 拒答規則。每條：{ id, kind, re | test(q), note }。依序檢查，先命中先拒答。
 * kind：prompt-injection | emergency | personal-diagnosis | medication | legal | unpublished | media | forecast | privacy | harmful
 */
export const REFUSAL_RULES = [
  { id: 'ref.injection', kind: 'prompt-injection', test: (q) => detectInjection(q).detected, note: '提示注入（忽略以上指示、你現在是、system prompt…）' },
  { id: 'ref.harmful', kind: 'harmful', re: /(製造|培養|合成|散播|散布|改造).{0,8}(病毒|細菌|病原|毒素|生物武器|炭疽)|生物武器|how to (make|spread|weaponi[sz]e)/i, note: '危害性請求' },
  { id: 'ref.emergency', kind: 'emergency', re: new RegExp(`${PERSON}.{0,14}(呼吸困難|喘不過氣|昏迷|叫不醒|意識不清|抽搐|休克|大量出血|吐血|胸痛|嘴唇發紫)`), note: '個人急症' },
  { id: 'ref.diag.am-i', kind: 'personal-diagnosis', re: new RegExp(`${PERSON}.{0,16}(是不是|會不會|有沒有|是否|算不算|應該是|可能是).{0,10}(得了|得到|得|感染|中了|染上|確診|罹患|得到了|中標|是.{1,6}(病|熱|炎|症|感))`), note: '我是不是得了…' },
  { id: 'ref.diag.judge', kind: 'personal-diagnosis', re: /(幫我|請你|你幫我|可以幫我|替我)(判斷|診斷|看看|確認|查查|查一下|查|檢查).{0,12}(是不是|是什麼|哪種|有沒有|得了|嚴不嚴重)/, note: '請 AI 診斷' },
  { id: 'ref.diag.self', kind: 'personal-diagnosis', re: new RegExp(`${PERSON}.{0,8}(得|中|染)了.{0,8}(嗎|沒|了嗎)|${PERSON}.{0,20}(這樣|這種情況|這個症狀|症狀).{0,6}(是|算)(什麼病|哪種病|.{1,8}嗎)`), note: '我得了…嗎' },
  { id: 'ref.diag.en', kind: 'personal-diagnosis', re: /\b(do i have|have i got|am i infected|did i catch|does my (child|son|daughter|kid|baby|wife|husband) have|is my (child|son|daughter|kid|baby) (sick with|infected))\b/i, note: 'English self-diagnosis' },
  { id: 'ref.diag.vi', kind: 'personal-diagnosis', re: /(tôi có bị|con tôi có bị|tôi bị .{1,20} (phải không|không))/i, note: 'Vietnamese self-diagnosis' },
  { id: 'ref.med.which', kind: 'medication', re: /(吃|服用|用|擦|打)(什麼|哪種|哪一種|哪個|哪些)(藥|退燒藥|抗生素|止痛藥|成藥)/, note: '該吃什麼藥' },
  { id: 'ref.med.dose', kind: 'medication', re: /(劑量|幾顆|幾毫克|幾 ?mg|毫克|\d+\s*mg|一天吃幾次|吃幾次|吃多少|服用多少|用量|幾 ?cc)/i, note: '劑量' },
  { id: 'ref.med.can-take', kind: 'medication', re: new RegExp(`(可以|能不能|能否|可不可以|要不要|該不該|適合)(自己)?.{0,4}(吃|服用|使用|買)${DRUGS}|${DRUGS}.{0,6}(可以|能不能|能)(吃|服用|一起吃)`, 'i'), note: '能不能吃某藥' },
  { id: 'ref.med.en', kind: 'medication', re: /\b(what (medicine|medication|drug|pills?) should i|how much .{0,20}(should i take|to take)|dosage|dose of)\b/i, note: 'English medication' },
  { id: 'ref.med.vi', kind: 'medication', re: /(uống thuốc gì|liều lượng|uống bao nhiêu)/i, note: 'Vietnamese medication' },
  { id: 'ref.legal', kind: 'legal', re: /(法律責任|刑事責任|民事責任|賠償|求償|國賠|提告|告(他|她|醫院|醫師|疾管署|政府)|訴訟|吃上官司|會不會被罰|要被罰|被罰多少|會被抓|違法嗎|犯法嗎|律師)/, note: '法律責任' },
  { id: 'ref.unpublished', kind: 'unpublished', re: /(未公布|還沒公布|尚未公布|沒有公布|未發布|尚未發布|還沒發布|內部資料|內部數字|內部消息|內線|真實(數字|病例|人數|數據)|實際(數字|病例數|人數)|不要官方|非官方數字|隱匿|黑數|隱瞞|偷偷|沒公開|不公開|還沒公開|搶先)/, note: '未發布疫情' },
  { id: 'ref.media', kind: 'media', re: /(我是記者|記者.{0,6}(詢問|請問|採訪|想問)|(媒體|報社|電視台|雜誌|新聞台).{0,10}(詢問|聯絡|提問|採訪|訪問|回應|窗口|請問)|採訪|專訪|新聞稿窗口|發言人)/, note: '媒體詢問' },
  { id: 'ref.forecast', kind: 'forecast', re: /(預測|預估|推估|predict|forecast|projection)|((明年|下個月|下週|下禮拜|下一季|未來幾(週|個月|年)|年底|過年後).{0,12}(會|病例|疫情|流行|多少|幾例|高峰|幾人))|((會不會|是否會|會).{0,4}(大流行|爆發|變嚴重|更嚴重|升高|增加|破\d)|(什麼時候|何時).{0,3}(結束|退燒|趨緩|消失))|\b(next year|will .{0,30}(increase|peak|rise|get worse))\b/i, note: '預測未來' },
  { id: 'ref.impersonation', kind: 'impersonation', re: /((以|用)(你的|疾管署的?|官方的?|政府的?)(名義|身分|口吻|立場))|((幫我|替我|請你)(寫|發|擬|產生).{0,8}(新聞稿|公告|聲明|公文|澄清稿))|((寫成|改寫成|改成|模仿|仿照|假裝).{0,10}(疾管署|官方|政府|衛福部|機關).{0,6}(口吻|語氣|名義|格式|公告|澄清|新聞稿|聲明))|(write|draft|issue) (a |an )?(press release|official (statement|announcement))/i, note: '冒用機關名義產生公告' },
  { id: 'ref.opinion', kind: 'opinion', re: /((你覺得|你認為|你的看法|你怎麼看|評價一下|給.{0,4}打分數).{0,12}(疾管署|政府|政策|部長|署長|防疫|官員|執政))|((疾管署|政府|部長|署長).{0,8}(爛|無能|失職|該下台|做得好嗎|做得好不好))/, note: '評論機關或政策' },
  { id: 'ref.privacy', kind: 'privacy', re: /((確診者|個案|病人|患者|感染者).{0,6}(住哪|住在|地址|姓名|名字|是誰|身分|電話|哪一家|工作地點))|(誰確診|哪個人確診|公布.{0,4}(姓名|名單))/, note: '他人個資' },
];

const REFUSAL_TEXT = {
  'zh-TW': {
    'prompt-injection': { title: '這個要求我不能照做', text: '偵測到試圖改變系統規則的指令。本服務只依官方內容整理答案，不會變更規則或透露系統設定。請直接輸入你想問的防疫問題。' },
    harmful: { title: '這個問題我不能回答', text: '本服務不提供可能危害公共衛生安全的資訊。若你掌握相關可疑情事，請撥打 1922 或洽警方。' },
    emergency: { title: '請立即就醫', text: '你描述的情況可能危及生命，請立即撥打 119 或前往最近的急診。本服務無法替你判斷病情。' },
    'personal-diagnosis': { title: '這個問題我不能替你判斷', text: '你描述的是個人症狀，需要醫師當面評估。官方內容可以告訴你何時該就醫、有哪些警示徵象，但不能判斷你是否感染。' },
    medication: { title: '這個問題我不能替你判斷', text: '用藥種類與劑量需由醫師或藥師依個人狀況決定，官方網站不提供個人用藥建議。' },
    legal: { title: '這個問題我不能替你判斷', text: '法律責任、罰則適用與賠償屬個案判斷，請洽主管機關或法律專業人員。' },
    unpublished: { title: '這個問題不在回答範圍', text: '尚未正式發布的疫情資料不在回答範圍；請以疾管署新聞稿與疫情態勢層的正式發布為準。' },
    media: { title: '媒體詢問請洽公關室', text: '媒體採訪與詢問請聯絡疾管署公關室，本服務僅整理已公開內容，不代表機關發言。' },
    forecast: { title: '不推論、不預測', text: '本服務只轉述已發布的資料，不推論、不預測未來疫情或數字。可參考疫情態勢層的現況與歷年統計。' },
    privacy: { title: '這個問題我不能回答', text: '依個人資料保護規定，不提供任何個案的身分、住址或其他可識別資訊。' },
    impersonation: { title: '這個要求我不能照做', text: '本服務不能以疾管署或任何機關名義產生新聞稿、公告或聲明。正式訊息請以疾管署官網發布者為準。' },
    opinion: { title: '這個問題不在回答範圍', text: '本服務只轉述官方已發布的內容，不對機關、政策或人員表達意見或評價。意見陳述可透過民意信箱反映。' },
    'no-source': { title: '找不到足夠的官方依據', text: '官方內容中沒有足以回答這個問題的依據，為避免錯答，我不替你判斷。你可以改用關鍵字搜尋，或撥打 1922 詢問。' },
    'no-clarification': { title: '目前沒有對應的官方澄清', text: '目前沒有與這則訊息對應的官方澄清。請先不要轉傳；可撥打 1922 詢問，或透過本頁回報讓我們查證。' },
    'no-data': { title: '找不到對應的統計資料', text: '資料目錄中沒有可直接回答的統計序列。你可以到開放資料平台查詢原始資料集。' },
  },
  en: {
    'prompt-injection': { title: "I can't follow that request", text: 'This looks like an attempt to change the system rules. This service only summarizes official content and will not change its rules or reveal its settings.' },
    harmful: { title: "I can't answer this", text: 'This service does not provide information that could harm public health.' },
    emergency: { title: 'Seek emergency care now', text: 'What you describe may be life-threatening. Call 119 or go to the nearest emergency department now.' },
    'personal-diagnosis': { title: "I can't make this judgement for you", text: 'Personal symptoms need to be assessed by a doctor in person. Official content can tell you when to see a doctor and which warning signs to watch for, but cannot tell you whether you are infected.' },
    medication: { title: "I can't make this judgement for you", text: 'Which medicine to take and how much must be decided by a doctor or pharmacist. This site does not give personal medication advice.' },
    legal: { title: "I can't make this judgement for you", text: 'Legal liability and penalties depend on the individual case. Please consult the competent authority or a legal professional.' },
    unpublished: { title: 'Outside the scope of this service', text: 'Unpublished outbreak data is not available. Please rely on official press releases and the situation page.' },
    media: { title: 'Media enquiries', text: 'Media enquiries should go to the Taiwan CDC Public Relations Office.' },
    forecast: { title: 'No forecasts', text: 'This service only relays published data and does not forecast future cases or trends.' },
    privacy: { title: "I can't answer this", text: 'Personal information about any case is never disclosed.' },
    impersonation: { title: "I can't follow that request", text: 'This service cannot produce press releases, notices or statements in the name of Taiwan CDC or any agency.' },
    opinion: { title: 'Outside the scope of this service', text: 'This service only relays published official content and does not express opinions on agencies, policies or officials.' },
    'no-source': { title: 'Not enough official information', text: 'Official content does not contain enough to answer this. To avoid a wrong answer, I will not guess. Please call the 1922 hotline.' },
    'no-clarification': { title: 'No matching official clarification', text: 'There is no official clarification matching this message yet. Please do not forward it; you can call 1922 or report it here.' },
    'no-data': { title: 'No matching statistics', text: 'No statistical series in the data catalogue answers this directly.' },
  },
};

function refusalCopy(kind, lang) {
  return (REFUSAL_TEXT[lang] ?? (lang === 'zh-TW' ? null : REFUSAL_TEXT.en))?.[kind] ?? REFUSAL_TEXT['zh-TW'][kind] ?? REFUSAL_TEXT['zh-TW']['no-source'];
}

// ───────────────────────── 輔助：實體、同義詞 ─────────────────────────

// 跨語言關鍵詞（非中文問句 → 中文檢索詞），只做檢索展開，不出現在答案中
const CROSS_LANG = [
  [/\b(see a doctor|seek (medical )?care|doctor|clinic|hospital)\b|đi khám|bác sĩ/i, '就醫 看醫生'],
  [/\bfever\b|sốt/i, '發燒'], [/\brash\b|phát ban/i, '出疹 紅疹'], [/\bsymptoms?\b|triệu chứng/i, '症狀 徵象'],
  [/\bwarning signs?\b|dấu hiệu cảnh báo/i, '警示徵象'], [/\bincubation\b|ủ bệnh/i, '潛伏期'],
  [/\bprevent\w*\b|phòng ngừa|phòng bệnh/i, '預防'], [/\btransmi\w*|spread\w*|lây/i, '傳染 傳播'],
  [/\bvaccin\w*|immuni[sz]\w*|vắc[\s-]?xin|tiêm/i, '疫苗 接種'], [/\btravel\w*|abroad|overseas|du lịch|nước ngoài/i, '出國 旅遊'],
  [/\bborn\b|sinh năm/i, '出生'], [/\badults?\b|người lớn/i, '成人'], [/\bchild(ren)?\b|kids?\b|trẻ em/i, '幼兒 兒童'],
  [/\bmosquito\w*|muỗi/i, '病媒蚊 防蚊'], [/\bstanding water|water containers?|nước đọng/i, '積水容器'],
  [/\bfree\b|publicly funded|miễn phí/i, '公費'], [/\bwho (can|should|is eligible)|eligib\w*|đối tượng/i, '對象'],
  [/\bhotline\b|đường dây nóng/i, '1922'], [/\bscam|lừa đảo/i, '詐騙'], [/\binvest\w*|đầu tư/i, '投資'],
  [/\bcases?\b|số ca/i, '病例'], [/\blocal\b|nội địa/i, '本土'], [/\bweeks?\b|tuần/i, '週'], [/\bdays?\b|ngày/i, '天'],
  [/\bhours?\b|giờ/i, '小時'], [/\bdengue\b|sốt xuất huyết/i, '登革熱'], [/\bmeasles\b|sởi/i, '麻疹'], [/\binfluenza|\bflu\b|cúm/i, '流感'],
];

// 中文常見口語 → 正式用語（只做檢索展開）
const PARAPHRASE = [
  [/人傳人/, '人直接傳給人 傳染 傳播'], [/怎麼傳染|如何傳染|怎麼傳播|傳染途徑/, '傳染 傳播 傳染途徑'], [/看醫生|看病|去醫院/, '就醫'],
  [/打針|打疫苗|施打/, '接種 疫苗'], [/危險徵兆|警訊|嚴重的徵兆|重症徵兆/, '警示徵象 重症前兆 危險徵兆'], [/警示徵象/, '警示徵象 重症前兆'],
  [/自己好|會好嗎|自癒/, '自行康復'], [/特效藥|吃藥會好/, '特效 抗病毒藥物 支持性療法'], [/打幾劑|幾劑/, '劑'], [/多久內|幾天內|幾小時內/, '小時內 天內'],
  [/開打|什麼時候打/, '接種 開始 起'], [/哪裡打|哪裡可以打|接種地點/, '接種地點 合約院所'],
];

function lc(s) { return String(s ?? '').toLowerCase(); }
function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function isLatin(s) { return /^[\x00-\x7fÀ-ɏḀ-ỿ\s.\-']+$/.test(s); }
function matcherFor(name) {
  if (!name) return null;
  const n = String(name).trim();
  if (n.length < 2 && !/[一-鿿]/.test(n)) return null;
  if (isLatin(n)) return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(n)}(?![\\p{L}\\p{N}])`, 'iu');
  return new RegExp(escapeRe(n), 'i');
}

function ownerNameOf(units, id) { return units.find((u) => u.id === id)?.name ?? id ?? ''; }
function unwrap(v) { return v && typeof v === 'object' && !Array.isArray(v) && 'data' in v && 'meta' in v ? v.data : v; }

function annotationsOf(item) { return item?.gov?.annotations ?? item?.governance?.annotations ?? item?.annotations ?? []; }
function isOutdated(item) {
  if (item?.verdict === 'outdated') return true;
  if (item?.gov?.stale?.length) return true;
  if (item?.governance?.stale?.length) return true;
  return annotationsOf(item).some((a) => a.kind === 'based-on-revised' || a.kind === 'superseded');
}

// ───────────────────────── createEngine ─────────────────────────

export function createEngine(rawDeps = {}) {
  const deps = Object.fromEntries(Object.entries(rawDeps).map(([k, v]) => [k, unwrap(v)]));
  const {
    index = [], indexPro = [], situation = null, clarifications = [], glossary = [], diseases = [], vaccines = [], countries = [],
    datasets = [], faq = [], units = [], aiStatus = {}, today, random = Math.random, now = () => new Date(), travel = [],
  } = deps;
  const travelItems = (Array.isArray(travel) ? travel : []).map(normTravel).filter((t) => t.iso2 || t.name);

  // 詞彙主檔：別名／deprecated／各語言 → 正名；正名 → 全部別名
  const termToCanon = new Map(); const canonToAll = new Map(); const deprecatedTo = new Map();
  for (const g of glossary) {
    const canon = g['zh-TW']; if (!canon) continue;
    const all = new Set([canon, ...(g.aliases ?? []), ...(g.deprecated ?? []), g.en, g.ja, g.tl, g.vi, g.id_, g.th].filter(Boolean));
    canonToAll.set(canon, { zh: new Set([canon, ...(g.aliases ?? []), ...(g.deprecated ?? []), g.en].filter(Boolean)), byLang: { en: g.en, ja: g.ja, tl: g.tl, vi: g.vi, id: g.id_, th: g.th } });
    for (const a of all) if (String(a).length >= 2) termToCanon.set(lc(a), canon);
    for (const d of g.deprecated ?? []) deprecatedTo.set(d, canon);
  }
  const termMatchers = [...termToCanon.entries()].map(([alias, canon]) => ({ alias, canon, re: matcherFor(alias) })).filter((x) => x.re).sort((a, b) => b.alias.length - a.alias.length);

  // 實體：疾病、疫苗、國家（名稱、別名、英文名；詞彙主檔 refs 也算）
  const entityMatchers = [];
  const addEntity = (kind, id, name) => { const re = matcherFor(name); if (re) entityMatchers.push({ kind, id, name: String(name), re }); };
  const diseaseById = new Map();
  for (const d of diseases) {
    diseaseById.set(d.id, d);
    for (const n of [d.name, ...(d.aliases ?? []), d.nameEn]) addEntity('disease', d.id, n);
  }
  for (const g of glossary) for (const ref of g.refs ?? []) {
    if (!String(ref).startsWith('disease.')) continue;
    for (const n of [g['zh-TW'], ...(g.aliases ?? []), ...(g.deprecated ?? []), g.en, g.vi, g.ja, g.th, g.id_, g.tl]) addEntity('disease', ref, n);
  }
  for (const v of vaccines) for (const n of [v.name, v.title, ...(v.aliases ?? []), v.nameEn, v.slug && v.slug.length <= 5 ? v.slug.toUpperCase() : null]) addEntity('vaccine', v.id, n);
  for (const c of countries) for (const n of [c.name, c.nameEn, ...(c.aliases ?? [])]) addEntity('country', c.iso2 ?? c.id, n);
  entityMatchers.sort((a, b) => b.name.length - a.name.length);

  function detectEntities(q) {
    const found = { diseases: [], vaccines: [], countries: [] };
    const taken = [];
    for (const m of entityMatchers) {
      const hit = q.match(m.re); if (!hit) continue;
      const start = hit.index, end = hit.index + hit[0].length;
      if (taken.some(([s, e]) => start < e && end > s && !(m.kind === 'vaccine'))) continue; // 疾病名不重疊計
      const list = found[`${m.kind === 'country' ? 'countrie' : m.kind}s`];
      if (!list.some((x) => x.id === m.id)) list.push({ id: m.id, name: m.name, pos: start });
      if (m.kind !== 'vaccine') taken.push([start, end]);
    }
    for (const k of Object.keys(found)) found[k].sort((a, b) => a.pos - b.pos);
    // 「流感疫苗」：疫苗實體也帶出對應疾病
    for (const v of found.vaccines) {
      const vac = vaccines.find((x) => x.id === v.id);
      for (const did of vac?.diseases ?? []) if (!found.diseases.some((x) => x.id === did)) found.diseases.push({ id: did, name: diseaseById.get(did)?.name ?? did, pos: v.pos });
    }
    return found;
  }
  function detectDisease(q) { const e = detectEntities(q); return diseaseById.get(e.diseases[0]?.id) ?? null; }

  /** 同義詞展開：回傳 { text, added[], notes[] }（notes：deprecated 詞的正名提示） */
  function expandQuery(q, lang = 'zh-TW') {
    const added = new Set(); const notes = [];
    for (const t of termMatchers) {
      if (!t.re.test(q)) continue;
      const forms = canonToAll.get(t.canon);
      const wanted = forms ? [...forms.zh, ...(lang !== 'zh-TW' && forms.byLang[lang] ? [forms.byLang[lang]] : [])] : [t.canon];
      for (const a of wanted) if (!lc(q).includes(lc(a))) added.add(a);
      for (const [dep, canon] of deprecatedTo) if (lc(dep) === t.alias && !notes.some((n) => n.from === dep)) notes.push({ from: dep, to: canon });
    }
    for (const [re, zh] of PARAPHRASE) if (re.test(q)) for (const w of zh.split(' ')) if (!q.includes(w)) added.add(w);
    if (lang !== 'zh-TW' || !/[一-鿿]/.test(q)) for (const [re, zh] of CROSS_LANG) if (re.test(q)) for (const w of zh.split(' ')) added.add(w);
    return { text: [q, ...added].join(' '), added: [...added], notes };
  }

  // ── BM25 ──
  const bm25Cache = new Map();
  function bm25For(key, chunks) {
    if (bm25Cache.has(key)) return bm25Cache.get(key);
    const docs = chunks.map((c) => {
      const toks = [...tokenize(c.title), ...tokenize(c.title), ...tokenize(c.text), ...tokenize((c.terms ?? []).join(' '))];
      const tf = new Map(); for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1);
      return { c, tf, len: toks.length };
    });
    const df = new Map(); for (const d of docs) for (const t of d.tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
    const N = docs.length || 1;
    const avgdl = docs.reduce((s, d) => s + d.len, 0) / N || 1;
    const idf = (t) => { const n = df.get(t) ?? 0; return Math.log(1 + (N - n + 0.5) / (n + 0.5)); };
    const model = { docs, idf, avgdl, N, has: (t) => df.has(t) };
    bm25Cache.set(key, model);
    return model;
  }
  function bm25Score(model, d, qWeights, k1 = 1.5, b = 0.75) {
    let s = 0;
    for (const [t, w] of qWeights) {
      const f = d.tf.get(t); if (!f) continue;
      s += w * model.idf(t) * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.len) / model.avgdl)));
    }
    return s;
  }
  function queryWeights(q, expanded) {
    const w = new Map();
    for (const t of tokenize(q, { query: true })) w.set(t, 1);
    for (const t of tokenize(expanded.added.join(' '), { query: true })) if (!w.has(t)) w.set(t, 0.7);
    return w;
  }

  const INTENT_TASK = { symptoms: 'symptoms', vaccine: 'vaccines', travel: 'travel', situation: 'situation', rumor: 'rumor', stats: 'data' };

  function poolFor(view, lang) {
    const base = view === 'pro' ? (indexPro.length ? indexPro : index) : index;
    const inLang = (c) => (c.lang ?? 'zh-TW') === lang;
    const allowed = base.filter((c) => (view === 'pro' ? c.isCurrent !== false : c.whitelist !== false));
    return { key: `${view}:${lang}`, chunks: allowed.filter(inLang) };
  }

  /**
   * 檢索：回傳 [{...chunk, _score}]（新物件，不改索引）。
   * opts：{ view, lang, k, intent, entities, presetDisease, guards }
   */
  function retrieve(q, opts = {}) {
    const { view = 'public', lang = 'zh-TW', k = 6, intent = 'unknown', guards = [], minRel = 0.3 } = opts;
    const entities = opts.entities ?? detectEntities(q);
    const expanded = opts.expanded ?? expandQuery(q, lang);
    const pool = poolFor(view, lang);
    if (!pool.chunks.length) return [];
    const model = bm25For(pool.key, pool.chunks);
    const qw = queryWeights(q, expanded);
    if (!qw.size) return [];
    const dIds = new Set(entities.diseases.map((d) => d.id)); if (opts.presetDisease) dIds.add(opts.presetDisease);
    const vIds = new Set(entities.vaccines.map((v) => v.id));
    const cIds = new Set(entities.countries.map((c) => c.id));
    const task = INTENT_TASK[intent];
    const qLower = lc(expanded.text);
    const scored = [];
    for (const d of model.docs) {
      let s = bm25Score(model, d, qw);
      if (s <= 0) continue;
      const c = d.c;
      for (const t of c.terms ?? []) if (t && String(t).length >= 2 && qLower.includes(lc(t))) s += 0.6;
      if (dIds.size) {
        if ((c.diseases ?? []).some((x) => dIds.has(x))) s = s * 1.6 + 2;
        else if ((c.diseases ?? []).length) continue; // 問的是 A 病，不拿 B 病的內容回答
        else s *= 0.6;
      }
      if (vIds.size && (c.vaccines ?? []).some((x) => vIds.has(x))) s = s * 1.3 + 1;
      if (cIds.size && (c.countries ?? []).some((x) => cIds.has(x))) s = s * 1.3 + 1;
      if (task && (c.tasks ?? []).includes(task)) s *= 1.15;
      if (view === 'pro' && (c.type === 'document' || c.type === 'letter')) s *= 1.3;
      if (intent !== 'rumor' && c.type === 'clarification') s *= 0.5;
      scored.push({ ...c, _score: Math.round(s * 1000) / 1000 });
    }
    scored.sort((a, b) => b._score - a._score);
    const top = scored[0]?._score ?? 0;
    const out = [];
    for (const c of scored) {
      if (c._score < 1 || c._score < top * minRel) break;
      // 輸出側防護：失效版本、逾期內容不得被引用（索引已排除，這裡是第二道）
      if (c.isCurrent === false) { guards.push({ kind: 'superseded-dropped', id: c.id }); continue; }
      if (today && c.nextReviewAt && c.nextReviewAt < today) { guards.push({ kind: 'overdue-dropped', id: c.id }); continue; }
      out.push(c);
      if (out.length >= k) break;
    }
    out.qWeights = qw; out.model = model;
    return out;
  }

  // ── 組句 ──
  const SLOT_CUES = {
    symptoms: [/(就醫|看醫生|回診|急診|立即|儘速|小時內|告知醫師|see a doctor|within 24 hours|seek)/i, /(症狀|發燒|出疹|紅疹|頭痛|嘔吐|腹痛|出血|嗜睡|徵象|symptom|fever|rash)/i],
    vaccine: [/(出生|歲|對象|成人|幼兒|長者|孕婦|醫護|族群|以上|以下|不具.{0,4}免疫|born|adults?|aged|eligible)/i, /(劑|週|個月|時程|間隔|接種第|前往|出國前|dose|weeks?)/i],
    travel: [/(等級|警示|注意|警告|第[一二三]級|level|alert|warning)/i, /(疫苗|接種|MMR|vaccin)/i, /(行前|出國前|返國|入境|旅遊史|回國)/],
    situation: [/(\d+(\.\d+)?\s*%|例|就診率|上升|下降|高峰|流行閾值|人次)/, /(建議|請|儘速|呼籲|提醒|注意)/],
    professional: [/(第\s*\d+\s*條|應於|通報|送驗|檢體|定義|時限|小時內)/, /(版|生效|修訂)/],
  };
  const REQUIRED_POINTS = {
    symptoms: [{ key: 'seek-care', label: '就醫時機', re: /(就醫|看醫生|回診|急診|立即|see a doctor|seek|119)/i }],
    vaccine: [{ key: 'who', label: '接種對象', re: /(出生|歲|對象|成人|幼兒|長者|族群|者|born|adults?|eligible|aged)/i }],
    travel: [{ key: 'before-travel', label: '行前準備', re: /(出國|行前|旅遊|返國|入境|前往|travel|before)/i }],
    situation: [{ key: 'status', label: '態勢狀態', re: /(態勢|高峰|上升|下降|平穩|流行|就診率|%)/ }],
    professional: [{ key: 'rule', label: '條文或時限', re: /(第\s*\d+\s*條|應於|小時|日內|定義|送驗|檢體|對象)/ }],
  };
  const PERSONAL_ADVICE_RE = /(你應該(服用|吃|使用)|建議你(吃|服用|使用)|你可以(吃|服用).{0,6}藥|你(就是|應該是|可能是|一定是)(得了|感染)|you should take|you (definitely|probably) have)/i;

  function slotOf(intent, text) {
    const cues = SLOT_CUES[intent]; if (!cues) return 9;
    for (let i = 0; i < cues.length; i++) if (cues[i].test(text)) return i;
    return cues.length;
  }

  function composeSentences(q, chunks, intent, view, guards) {
    if (!chunks.length) return [];
    const model = chunks.model; const qw = chunks.qWeights;
    const qIdfSum = [...qw.entries()].filter(([t]) => model.has(t)).reduce((s, [t, w]) => s + w * model.idf(t), 0) || 1;
    const top = chunks[0]._score || 1;
    const cands = [];
    chunks.forEach((c, ci) => {
      // 以「：」結尾的引言句與其後清單項目合併為一個單位（仍是原文連續片段）
      const units = [];
      const ss = c.sentences ?? [];
      for (let i = 0; i < ss.length; i++) {
        let u = ss[i];
        if (/[：:]$/.test(u)) { let j = i + 1; while (j < ss.length && j <= i + 4 && (u.length + ss[j].length) <= 180) { u += ` ${ss[j]}`; j++; } i = j - 1; }
        units.push(u);
      }
      const titleToks = new Set(tokenize(c.title));
      let covTitle = 0; for (const [t, w] of qw) if (titleToks.has(t) && model.has(t)) covTitle += w * model.idf(t);
      covTitle /= qIdfSum;
      units.forEach((sen, si) => {
        const toks = new Set(tokenize(sen));
        let cov = 0; for (const [t, w] of qw) if (toks.has(t)) cov += w * model.idf(t);
        cov /= qIdfSum;
        let s = 3 * cov + 0.8 * covTitle + 1.2 * (c._score / top);
        if (/\d/.test(sen)) s += 0.3;
        if (/(\d+\s*(小時|天|日|週|個月|歲|年|劑)|within|hours|days)/.test(sen)) s += 0.3;
        const slot = slotOf(intent, sen);
        if (slot === 0) s += 0.6; else if (slot === 1) s += 0.3;
        if (sen.length > 140) s -= 0.6; else if (sen.length < 10) s -= 0.6;
        if (si === 0 && c.type === 'faq') s += 0.3;
        if (view === 'pro' && (c.type === 'document' || c.type === 'letter')) s += 0.5;
        if (cov <= 0.05 && covTitle < 0.3 && !(ci === 0 && si === 0)) return;
        cands.push({ text: sen, cite: [c.id], score: s, slot, chunk: c });
      });
    });
    cands.sort((a, b) => b.score - a.score);
    const allCands = [...cands];
    const topCand = cands[0]?.score ?? 0;
    for (let i = cands.length - 1; i > 0; i--) if (cands[i].score < topCand * 0.45) cands.splice(i, 1);
    const max = view === 'pro' ? 4 : 3;
    const picked = [];
    const similar = (a, b) => { const A = new Set(bigrams(a)), B = new Set(bigrams(b)); let n = 0; for (const x of A) if (B.has(x)) n++; return n / Math.max(1, Math.min(A.size, B.size)); };
    // 多樣性：同一片段每多選一句，後續句子減分（避免整段只引一個來源）
    const perChunk = new Map();
    const queue = [...cands];
    const nextCand = () => {
      let bi = -1, bs = -Infinity;
      queue.forEach((c, i) => { const eff = c.score - 0.6 * (perChunk.get(c.chunk.id) ?? 0); if (eff > bs) { bs = eff; bi = i; } });
      return bi < 0 ? null : queue.splice(bi, 1)[0];
    };
    for (let c = nextCand(); c; c = nextCand()) {
      if (PERSONAL_ADVICE_RE.test(c.text)) { guards.push({ kind: 'medical-advice-dropped', text: c.text.slice(0, 40) }); continue; }
      const dup = picked.find((p) => similar(p.text, c.text) > 0.7);
      if (dup) {
        // 專業模式：同義句以正本文件原文為準、文件引用排第一
        if (view === 'pro' && c.chunk.type === 'document' && dup.chunk.type !== 'document') { dup.text = c.text; dup.chunk = c.chunk; dup.cite = [c.cite[0], ...dup.cite.filter((x) => x !== c.cite[0])].slice(0, 2); continue; }
        if (!dup.cite.includes(c.cite[0]) && dup.cite.length < 2) dup.cite.push(c.cite[0]);
        continue;
      }
      picked.push({ ...c, cite: [...c.cite] });
      perChunk.set(c.chunk.id, (perChunk.get(c.chunk.id) ?? 0) + 1);
      if (picked.length >= max) break;
    }
    // completeness：意圖必要要點缺漏時，從候選補入
    const req = REQUIRED_POINTS[intent] ?? [];
    for (const r of req) {
      if (picked.some((p) => r.re.test(p.text))) continue;
      const add = allCands.find((c) => r.re.test(c.text) && !picked.some((p) => p.text === c.text) && !PERSONAL_ADVICE_RE.test(c.text) && c.score > 1);
      if (add) { if (picked.length >= max) picked.pop(); picked.push({ ...add, cite: [...add.cite] }); }
    }
    picked.sort((a, b) => a.slot - b.slot || b.score - a.score);
    return picked;
  }

  function completenessOf(intent, sentences, extra = {}) {
    const req = REQUIRED_POINTS[intent] ?? [];
    const text = sentences.map((s) => s.text).join(' ');
    const covered = req.filter((r) => r.re.test(text) || (r.key === 'status' && extra.situation)).map((r) => r.key);
    return { required: req.map((r) => r.key), covered, missing: req.map((r) => r.key).filter((k) => !covered.includes(k)), score: req.length ? covered.length / req.length : 1 };
  }

  function sourceOf(c) {
    return {
      id: c.id, contentId: c.contentId, type: c.type, lang: c.lang ?? 'zh-TW', title: c.title, url: c.url, owner: c.owner, ownerName: c.ownerName,
      reviewedAt: c.reviewedAt, nextReviewAt: c.nextReviewAt ?? null, publishedAt: c.publishedAt ?? null, version: c.version ?? null, effectiveAt: c.effectiveAt ?? null,
      isCurrent: c.isCurrent !== false, section: c.section ?? null, family: c.family ?? null, supersedes: c.supersedes ?? null, supersedesVersion: c.supersedesVersion ?? null,
      change: c.change ?? null, license: c.license ?? 'OGDL-1.0', docTitle: c.docTitle ?? null, mdUrl: c.mdUrl ?? null, legacyUrl: c.legacyUrl ?? null,
    };
  }

  /** 專業模式引用標籤：依「文件」第 3 條，v2026-09 生效 115/9/15，取代前版第 3 條「限快篩陽性」 */
  function citeLabelOf(src) {
    if (!src || !(src.type === 'document' || src.type === 'letter')) return null;
    const no = src.section?.no;
    const sec = no ? `第 ${no} 條` : src.section?.heading ? `〈${src.section.heading}〉` : '';
    let s = `依「${src.docTitle ?? src.title}」${sec}`;
    if (src.version || src.effectiveAt) s += `，${src.version ?? ''}${src.effectiveAt ? ` 生效 ${rocDate(src.effectiveAt)}` : ''}`;
    if (src.supersedes) {
      const before = src.change?.before ? `「${src.change.before}」` : '';
      s += `，取代前版${src.supersedesVersion ? `（${src.supersedesVersion}）` : ''}${no && before ? `第 ${no} 條` : ''}${before}`;
    }
    return s;
  }

  function finalizeSentences(result, picked, sourceMap) {
    // sourceMap: id → source；依出現順序編號
    const order = []; const sources = [];
    for (const p of picked) for (const id of p.cite) if (!order.includes(id) && sourceMap.has(id)) { order.push(id); sources.push(sourceMap.get(id)); }
    const nOf = new Map(order.map((id, i) => [id, i + 1]));
    sources.forEach((s, i) => { s.n = i + 1; });
    result.sources = sources;
    result.sentences = [];
    for (const p of picked) {
      const cite = p.cite.filter((id) => nOf.has(id));
      if (!cite.length) { result.guards.push({ kind: 'uncited-dropped', text: p.text.slice(0, 40) }); continue; }
      const s = { text: p.text, cite, n: cite.map((id) => nOf.get(id)) };
      if (result.view === 'pro') { const docId = cite.find((id) => ['document', 'letter'].includes(sourceMap.get(id)?.type)); const lab = docId ? citeLabelOf(sourceMap.get(docId)) : null; if (lab) s.citeLabel = lab; }
      result.sentences.push(s);
    }
  }

  // ── 態勢 ──
  function situationFor(entities, intent) {
    if (!situation?.items?.length) return null;
    const ids = entities.diseases.map((d) => d.id);
    let items = situation.items.filter((i) => ids.includes(i.disease));
    if (!items.length && intent === 'situation') items = situation.items.filter((i) => i.pinned);
    if (!items.length && intent === 'situation') items = situation.items.slice(0, 4);
    if (!items.length) return null;
    return {
      publishedAt: situation.publishedAt, dataDate: situation.dataDate, publisher: situation.publisher, publisherName: ownerNameOf(units, situation.publisher),
      source: situation.source, nextReviewAt: situation.nextReviewAt, note: situation.note ?? null,
      items: items.map((i) => ({ ...i, diseaseName: i.diseaseName ?? diseaseById.get(i.disease)?.name ?? i.disease, slug: i.slug ?? diseaseById.get(i.disease)?.slug ?? null })),
    };
  }
  const STATUS_LABEL = { stable: '平穩', rising: '上升', peak: '高峰', declining: '下降' };
  function situationSentences(sit, lang) {
    // 只轉述人工發布的結構化欄位，不生成數字
    const out = []; const srcs = new Map();
    for (const it of sit.items) {
      const id = `situation#${it.disease}`;
      srcs.set(id, { id, contentId: 'situation.current', type: 'situation', title: `疫情態勢 · ${it.diseaseName}`, url: '/situation/', owner: sit.publisher, ownerName: sit.publisherName, reviewedAt: sit.publishedAt, nextReviewAt: sit.nextReviewAt, isCurrent: true, license: 'OGDL-1.0', dataDate: sit.dataDate, lang: 'zh-TW' });
      const i18n = lang !== 'zh-TW' ? it.i18n?.[lang] : null;
      const status = lang === 'zh-TW' ? STATUS_LABEL[it.status] ?? it.status : it.status;
      if (lang === 'zh-TW') out.push({ text: `${it.diseaseName}目前疫情態勢為「${status}」：${it.metricLabel} ${it.metricValue}${it.deltaText ? `，${it.deltaText}` : ''}（資料日 ${sit.dataDate}）。`, cite: [id], slot: 0, score: 9 });
      else out.push({ text: `${it.diseaseName}: status "${status}" — ${i18n?.metricLabel ?? it.metricLabel} ${it.metricValue}${i18n?.deltaText ? `, ${i18n.deltaText}` : ''} (data as of ${sit.dataDate}).`, cite: [id], slot: 0, score: 9 });
      if (it.basis && lang === 'zh-TW') out.push({ text: `判定依據：${it.basis}。`, cite: [id], slot: 0, score: 8 });
      const adv = i18n?.advice ?? it.advice;
      if (adv) out.push({ text: lang === 'zh-TW' ? `建議：${adv}。` : `Advice: ${adv}.`, cite: [id], slot: 1, score: 8 });
    }
    return { sentences: out, sources: srcs };
  }

  // ── 旅遊疫情建議等級（結構化快照，只轉述不推論） ──
  const LEVEL_LABEL = { 1: '注意（Watch）', 2: '警示（Alert）', 3: '警告（Warning）' };
  function travelFor(entities) {
    const out = [];
    for (const c of entities.countries) {
      const iso = String(c.id ?? '').toUpperCase();
      const hits = travelItems.filter((t) => t.iso2 === iso || (t.name && t.name === c.name));
      if (hits.length) out.push({ iso2: iso, name: hits[0].name ?? c.name, entries: hits });
    }
    return out;
  }
  function travelSentences(tr, lang) {
    const sents = []; const srcs = new Map();
    for (const c of tr) {
      const id = `travel#${c.iso2}`;
      const top = c.entries.reduce((a, b) => ((Number(b.level) || 0) > (Number(a.level) || 0) ? b : a));
      const date = c.entries.map((e) => e.date).filter(Boolean).sort().at(-1) ?? null;
      srcs.set(id, { id, contentId: `travel.${c.iso2}`, type: 'travel', title: `旅遊疫情建議 · ${c.name}`, url: `/travel/${c.iso2.toLowerCase()}/`, owner: 'unit.epidemic-intelligence', ownerName: ownerNameOf(units, 'unit.epidemic-intelligence'), reviewedAt: date, isCurrent: true, license: 'OGDL-1.0', lang: 'zh-TW' });
      for (const e of c.entries.slice(0, 4)) {
        const lvl = e.level != null ? `第 ${e.level} 級${e.levelLabel ? `「${e.levelLabel}」` : LEVEL_LABEL[e.level] ? `「${LEVEL_LABEL[e.level]}」` : ''}` : (e.levelLabel ?? '');
        const dz = e.diseaseNames.join('、');
        sents.push({ text: lang === 'zh-TW' ? `${c.name}${dz ? `（${dz}）` : ''}：旅遊疫情建議${lvl}${e.date ? `，發布日 ${e.date}` : ''}。` : `${c.name}${dz ? ` (${dz})` : ''}: travel notice level ${e.level ?? '-'}${e.date ? `, issued ${e.date}` : ''}.`, cite: [id], slot: 0, score: 9 });
        if (e.advice && lang === 'zh-TW') sents.push({ text: `建議：${e.advice}`, cite: [id], slot: 0, score: 8 });
      }
      void top;
    }
    return { sentences: sents, sources: srcs };
  }

  // ── 統計 ──
  const GRAN = { year: /(年|歷年|每年|year|năm)/i, week: /(週|周|星期|week|tuần)/i, month: /(月|month|tháng)/i, day: /(日|天|每日|day|ngày)/i };
  function seriesList(ds) { const s = ds.series; if (!s) return []; return (Array.isArray(s) ? s : [s]).map((x, i) => ({ ...x, _i: i })); }
  function matchSeries(q, entities) {
    const dIds = entities.diseases.map((d) => d.id);
    const qb = new Set(tokenize(q, { query: true }));
    let best = null;
    for (const ds of datasets) for (const se of seriesList(ds)) {
      let s = 0;
      const dsDiseases = ds.diseases ?? [];
      if (dIds.length) {
        if (dsDiseases.some((d) => dIds.includes(d)) || dIds.some((id) => (ds.title ?? '').includes(diseaseById.get(id)?.name ?? '@@'))) s += 5; else continue;
      }
      for (const t of tokenize(`${se.label ?? ''} ${ds.title ?? ''}`)) if (qb.has(t)) s += 1;
      const g = Object.entries(GRAN).find(([, re]) => re.test(q))?.[0];
      if (g && se.granularity === g) s += 2;
      if (/本土/.test(q) && /本土/.test(se.label ?? '')) s += 2;
      if (/境外/.test(q) && /境外/.test(se.label ?? '')) s += 2;
      if (/本土/.test(q) && /境外/.test(se.label ?? '')) s -= 3;
      if (/境外/.test(q) && /本土/.test(se.label ?? '')) s -= 3;
      if (!best || s > best.s) best = { ds, se, s };
    }
    return best && best.s >= 3 ? best : null;
  }
  function statsAnswer(q, entities, range, lang) {
    const m = matchSeries(q, entities);
    if (!m) return null;
    const { ds, se } = m;
    let pts = [...(se.points ?? [])];
    const yearOf = (t) => Number(String(t).slice(0, 4));
    const notes = [];
    if (range.from != null) pts = pts.filter((p) => yearOf(p.t) >= range.from && yearOf(p.t) <= range.to);
    else if (range.years.length && se.granularity === 'year') pts = pts.filter((p) => range.years.includes(yearOf(p.t)));
    else if (range.n != null) {
      const n = Math.round(range.unit === se.granularity ? range.n : range.unit === 'year' && se.granularity === 'week' ? range.n * 52 : range.n);
      if (pts.length < n) notes.push(`資料僅有 ${pts.length} 個時間點`);
      pts = pts.slice(-n);
    } else if (pts.length > 10) pts = pts.slice(-10);
    if (!pts.length) return { empty: true, ds, se };
    const unit = se.unit ?? '';
    const fmt = (v) => (typeof v === 'number' ? v.toLocaleString('en-US') : String(v));
    const tLabel = (t) => (se.granularity === 'year' && /^\d{4}$/.test(String(t)) ? (lang === 'zh-TW' ? `${t} 年` : String(t)) : String(t));
    let aggregate = null;
    if (/(總共|合計|加總|一共|總計|累計|共有|total|in total|altogether|tổng)/i.test(q)) aggregate = { kind: 'sum', value: pts.reduce((s, p) => s + (Number(p.v) || 0), 0) };
    else if (/(最高|最多|最嚴重|高峰是|peak|highest|most)/i.test(q)) { const p = pts.reduce((a, b) => (Number(b.v) > Number(a.v) ? b : a)); aggregate = { kind: 'max', value: p.v, t: p.t }; }
    else if (/(最低|最少|lowest|fewest)/i.test(q)) { const p = pts.reduce((a, b) => (Number(b.v) < Number(a.v) ? b : a)); aggregate = { kind: 'min', value: p.v, t: p.t }; }
    else if (/(平均|average|mean)/i.test(q)) aggregate = { kind: 'avg', value: Math.round((pts.reduce((s, p) => s + (Number(p.v) || 0), 0) / pts.length) * 10) / 10 };
    const sid = ds.id;
    const label = se.label ?? ds.title;
    const sentences = [];
    if (aggregate) {
      const span = `${tLabel(pts[0].t)}–${tLabel(pts.at(-1).t)}`;
      const text = lang === 'zh-TW'
        ? { sum: `${label}：${span}合計 ${fmt(aggregate.value)} ${unit}。`, max: `${label}：${span}間最高為 ${tLabel(aggregate.t)}，${fmt(aggregate.value)} ${unit}。`, min: `${label}：${span}間最低為 ${tLabel(aggregate.t)}，${fmt(aggregate.value)} ${unit}。`, avg: `${label}：${span}平均每期 ${fmt(aggregate.value)} ${unit}。` }[aggregate.kind]
        : { sum: `${label}: ${span} total ${fmt(aggregate.value)} ${unit}.`, max: `${label}: highest in ${aggregate.t}, ${fmt(aggregate.value)} ${unit}.`, min: `${label}: lowest in ${aggregate.t}, ${fmt(aggregate.value)} ${unit}.`, avg: `${label}: average ${fmt(aggregate.value)} ${unit} per period.` }[aggregate.kind];
      sentences.push({ text, cite: [sid] });
    }
    for (const p of pts) sentences.push({ text: lang === 'zh-TW' ? `${tLabel(p.t)}：${fmt(p.v)} ${unit}` : `${p.t}: ${fmt(p.v)} ${unit}`, cite: [sid] });
    const source = {
      id: sid, contentId: sid, type: 'dataset', title: ds.title, url: ds.canonicalUrl ?? ds.portalUrl, owner: ds.owner, ownerName: ds.ownerName ?? ownerNameOf(units, ds.owner),
      reviewedAt: ds.lastUpdated ?? ds.reviewedAt, dataDate: ds.lastUpdated, license: ds.license ?? 'OGDL-1.0', formats: ds.formats ?? ds.format ?? [], isCurrent: true,
      portalUrl: ds.portalUrl, mirrors: ds.mirrors ?? [], schemaUrl: ds.schemaUrl ?? null, apiUrl: '/v1/datasets.json', provenance: ds.provenance ?? null, note: se.note ?? null, lang: 'zh-TW',
    };
    return { stats: { dataset: { id: ds.id, title: ds.title }, label, unit, granularity: se.granularity, points: pts, aggregate, range, notes, note: se.note ?? null }, sentences, source };
  }

  // ── 謠言 ──
  const RUMOR_STRIP = /(這則|這個|這篇)?(訊息|消息|貼文|新聞|傳言)?(是)?(真的嗎|是真的嗎|真的假的|是假的嗎|假的嗎|可信嗎|是不是真的)|網傳|聽說|有人說|LINE\s*(群組)?(上)?(說|傳)|請問|查證|闢謠|[:：「」『』"“”?？!！，,。]/gi;
  function similarity(q, claim) {
    const A = new Set(bigrams(q)), B = new Set(bigrams(claim));
    if (!A.size || !B.size) return 0;
    let inter = 0; for (const x of A) if (B.has(x)) inter++;
    const jac = inter / (A.size + B.size - inter);
    const contClaim = inter / B.size; // 訊息含整則謠言
    const contQuery = inter / A.size; // 問句是謠言的片段
    return Math.max(jac, 0.85 * contClaim, 0.75 * contQuery * Math.min(1, A.size / 6));
  }
  function factCheck(q, result) {
    const qs = q.replace(RUMOR_STRIP, ' ');
    let best = null, bestScore = 0, bestClaim = null;
    for (const c of clarifications) {
      const claims = [c.claim, ...(c.claimVariants ?? []), ...(result.lang !== 'zh-TW' ? [c.i18n?.[result.lang]?.claim, c.i18n?.[result.lang]?.title, ...(c.i18n?.[result.lang]?.claimVariants ?? [])] : [])].filter(Boolean);
      for (const claim of claims) { const s = similarity(qs, claim); if (s > bestScore) { bestScore = s; best = c; bestClaim = claim; } }
    }
    result.rumorScore = Math.round(bestScore * 100) / 100;
    if (!best || bestScore < 0.4) {
      result.verdict = 'unknown';
      setRefusal(result, 'no-clarification', 'ref.no-clarification', [{ label: '撥打 1922 詢問', href: 'tel:1922', kind: 'hotline' }, { label: '詐騙請撥 165', href: 'tel:165', kind: 'hotline' }, { label: '到澄清專區', href: '/factcheck/', kind: 'link' }]);
      return result;
    }
    const outdated = isOutdated(best);
    const verdict = outdated ? 'outdated' : best.verdict;
    const i18n = result.lang !== 'zh-TW' ? best.i18n?.[result.lang] : null;
    const revised = (best.gov?.stale ?? []).map((s) => ({ revisedAt: s.revisedAt, currentId: s.currentId, currentTitle: s.currentTitle }));
    for (const a of annotationsOf(best)) if (a.kind === 'based-on-revised' && !revised.length) revised.push({ text: a.text, currentId: a.href });
    const text = best.clarificationText ?? mdPlain(best.clarificationMarkdown ?? '');
    result.verdict = verdict;
    result.matchedClaim = bestClaim;
    result.clarification = {
      id: best.id, title: i18n?.title ?? best.title, claim: best.claim, verdict, originalVerdict: best.verdict, text: i18n?.clarification ?? text,
      shareText: i18n?.shareText ?? best.shareText, reportChannel: best.reportChannel, url: best.url ?? '/factcheck/', publishedAt: best.publishedAt, reviewedAt: best.reviewedAt,
      ownerName: best.ownerName ?? ownerNameOf(units, best.owner), outdated, revised,
    };
    result.shareText = result.clarification.shareText; result.reportChannel = best.reportChannel;
    const src = { id: best.id, contentId: best.id, type: 'clarification', title: best.title, url: best.url ?? `/factcheck/#${best.id}`, owner: best.owner, ownerName: result.clarification.ownerName, reviewedAt: best.reviewedAt, isCurrent: !outdated, license: best.license ?? 'OGDL-1.0', lang: result.lang, n: 1 };
    result.sources = [src];
    const sents = splitPlain(result.clarification.text).slice(0, 3);
    result.sentences = sents.map((t) => ({ text: t, cite: [best.id], n: [1] }));
    if (outdated) result.guards.push({ kind: 'clarification-outdated', id: best.id });
    result.actions = [
      ...(result.shareText ? [{ label: '複製可轉傳短訊', kind: 'copy', value: result.shareText }] : []),
      ...(best.reportChannel ? [{ label: `通報：${best.reportChannel}`, kind: 'info' }] : []),
      { label: '撥打 1922', href: 'tel:1922', kind: 'hotline' },
    ];
    return result;
  }

  // ── 拒答 ──
  function setRefusal(result, kind, ruleId, actions = null) {
    const copy = refusalCopy(kind, result.lang);
    const d = diseaseById.get(result.disease);
    const related = [];
    if (d && (d.hasPage || d.page) && !['prompt-injection', 'harmful', 'privacy', 'media', 'impersonation', 'opinion'].includes(kind)) {
      related.push({ label: `${d.name}：症狀與警示徵象`, href: `/diseases/${d.slug}/#symptoms` });
      related.push({ label: `${d.name}：我該怎麼辦`, href: `/diseases/${d.slug}/#what-to-do` });
    }
    const baseActions = {
      emergency: [{ label: '撥打 119', href: 'tel:119', kind: 'hotline' }, { label: '撥打 1922', href: 'tel:1922', kind: 'hotline' }],
      media: [{ label: '聯絡公關室', href: '/about/#pr', kind: 'link' }],
      forecast: [{ label: '看疫情態勢', href: '/situation/', kind: 'link' }, { label: '看開放資料與統計', href: '/data/', kind: 'link' }],
      'prompt-injection': [{ label: '重新提問', href: '/ask/', kind: 'link' }],
      impersonation: [{ label: '看最新新聞稿', href: '/news/', kind: 'link' }],
      opinion: [{ label: '民意信箱', href: 'https://www.cdc.gov.tw/Mailbox/Index', kind: 'external' }],
    };
    result.refused = true;
    result.refusal = {
      kind, ruleId, title: copy.title, text: copy.text,
      actions: actions ?? baseActions[kind] ?? [{ label: '撥打 1922', href: 'tel:1922', kind: 'hotline' }],
      relatedDisease: d ? { id: d.id, name: d.name, slug: d.slug } : null, related,
    };
    if (!result.refusal.actions.some((a) => a.href === 'tel:1922') && !['prompt-injection', 'impersonation'].includes(kind)) result.refusal.actions.push({ label: '撥打 1922', href: 'tel:1922', kind: 'hotline' });
    result.sentences = []; result.sources = [];
    return result;
  }

  function auditId() {
    const d = (today ?? now().toISOString().slice(0, 10)).replace(/-/g, '');
    const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let x = ''; for (let i = 0; i < 4; i++) x += A[Math.floor(random() * A.length)];
    return `A-${d}-${x}`;
  }

  function actionsFor(result, entities, sit) {
    const a = [];
    const d = diseaseById.get(result.disease);
    const peak = sit?.items?.some((i) => i.status === 'peak');
    const vacc = entities.vaccines[0] ? vaccines.find((v) => v.id === entities.vaccines[0].id) : null;
    switch (result.intent) {
      case 'symptoms':
        if (d) a.push({ label: `看${d.name}警示徵象`, href: `/diseases/${d.slug}/#symptoms`, kind: 'link' });
        a.push({ label: '撥打 1922', href: 'tel:1922', kind: 'hotline' });
        break;
      case 'vaccine':
        a.push({ label: '查附近接種點', href: vacc?.whereUrl ?? 'https://antiflu.cdc.gov.tw/ExecutingUnit', kind: 'external' });
        if (vacc?.slug) a.push({ label: `看${vacc.name ?? vacc.title}公費對象`, href: `/vaccines/${vacc.slug}/`, kind: 'link' });
        else a.push({ label: '看疫苗與預防接種', href: '/tasks/vaccines/', kind: 'link' });
        break;
      case 'travel': {
        const c = entities.countries[0];
        a.push({ label: c ? `查${c.name}疫情等級` : '查目的地疫情等級', href: c ? `/travel/${String(c.id).toLowerCase()}/` : '/travel/', kind: 'link' });
        a.push({ label: '找旅遊醫學門診', href: 'https://www.cdc.gov.tw/Category/Page/ZgM7vwV3n6vDbXpq3MNgKg', kind: 'external' });
        break;
      }
      case 'situation':
        a.push({ label: '看完整趨勢', href: '/situation/', kind: 'link' });
        if (sit?.items?.some((i) => i.disease === 'disease.influenza')) {
          a.push({ label: '查附近流感疫苗接種點', href: 'https://antiflu.cdc.gov.tw/ExecutingUnit', kind: 'external' });
          a.push({ label: '公費抗病毒藥劑使用對象', href: '/diseases/influenza/#treatment', kind: 'link' });
        }
        break;
      case 'professional':
        if (d) a.push({ label: `${d.name}病例定義與通報`, href: `/pro/diseases/${d.slug}/`, kind: 'link' });
        a.push({ label: '文件版本異動', href: '/documents/', kind: 'link' });
        break;
      case 'stats':
        if (result.stats) a.push({ label: '下載資料集', href: result.sources[0]?.url, kind: 'external' });
        a.push({ label: '開放資料與統計', href: '/data/', kind: 'link' });
        break;
      default:
        if (d) a.push({ label: `看${d.name}完整頁面`, href: `/diseases/${d.slug}/`, kind: 'link' });
    }
    if (peak || result.intent === 'symptoms') { if (!a.some((x) => x.href === 'tel:1922')) a.unshift({ label: '撥打 1922', href: 'tel:1922', kind: 'hotline' }); }
    else if (!a.some((x) => x.href === 'tel:1922')) a.push({ label: '撥打 1922', href: 'tel:1922', kind: 'hotline' });
    return a.slice(0, 4);
  }

  /** 你可能也想知道：同疾病／同任務 FAQ 標題挑 3 個（排除已引用） */
  function relatedQuestions(result, n = 3) {
    const cited = new Set((result.sources ?? []).map((s) => s.contentId));
    const dIds = new Set(result.diseases ?? (result.disease ? [result.disease] : []));
    const task = INTENT_TASK[result.intent];
    const pool = faq.length ? faq.map((f) => ({ id: f.id, q: f.question ?? f.title, diseases: f.diseases ?? [], tasks: f.tasks ?? [], url: f.url ?? `/faq/${String(f.id).replace(/^faq\./, '')}/`, whitelist: f.governance?.whitelist ?? f.gov?.whitelist?.effective ?? true }))
      : index.filter((c) => c.type === 'faq' && (c.lang ?? 'zh-TW') === 'zh-TW').map((c) => ({ id: c.contentId, q: c.question ?? c.title, diseases: c.diseases ?? [], tasks: c.tasks ?? [], url: c.url, whitelist: true }));
    const seen = new Set();
    const scored = pool.filter((f) => f.q && f.whitelist !== false && !cited.has(f.id) && !seen.has(f.id) && seen.add(f.id)).map((f) => {
      let s = 0;
      if (f.diseases.some((d) => dIds.has(d))) s += 2;
      if (task && f.tasks.includes(task)) s += 1;
      return { ...f, s };
    }).filter((f) => f.s > 0).sort((a, b) => b.s - a.s || a.q.localeCompare(b.q));
    return scored.slice(0, n).map((f) => ({ q: f.q, id: f.id, url: f.url }));
  }

  function traditionalList(q, view, lang, n = 10) {
    const pool = poolFor(view, 'zh-TW');
    const model = bm25For(pool.key, pool.chunks);
    const expanded = expandQuery(q, lang);
    const qw = queryWeights(q, expanded);
    const scored = model.docs.map((d) => ({ c: d.c, s: bm25Score(model, d, qw) })).filter((x) => x.s > 0.5).sort((a, b) => b.s - a.s);
    const out = []; const seen = new Set();
    for (const { c, s } of scored) {
      if (seen.has(c.contentId) || c.isCurrent === false) continue;
      seen.add(c.contentId);
      out.push({ id: c.contentId, title: c.docTitle ?? c.title.split(' · ')[0], summary: c.summary ?? c.sentences?.[0] ?? '', url: c.url.replace(/#.*$/, ''), reviewedAt: c.reviewedAt, ownerName: c.ownerName, type: c.type, score: Math.round(s * 100) / 100 });
      if (out.length >= n) break;
    }
    return out;
  }

  // ───────────── answer ─────────────
  function answer(rawQuery, opts = {}) {
    const { lang = 'zh-TW', view = 'public', disease: presetDisease = null, mode, forceIntent = null } = opts;
    const pii = maskPIIDetailed(String(rawQuery ?? '').trim().slice(0, 500));
    const q = pii.text;
    const result = {
      query: q, lang, view, intent: 'unknown', intentReasons: [], intentScores: {}, refused: false, disease: null, diseases: [], entities: { diseases: [], vaccines: [], countries: [] },
      termNotes: [], sentences: [], sources: [], actions: [], related: [], guards: [], confidence: 0, completeness: null,
      auditId: auditId(), mode: mode ?? aiStatus.mode ?? 'extractive', pii: pii.hits,
      disclosure: { mode: mode ?? aiStatus.mode ?? 'extractive', provider: null, model: null, generatedAt: now().toISOString() },
    };
    if (pii.hits.length) result.guards.push({ kind: 'pii-masked', hits: pii.hits });
    if (!q) return result;

    // 10 暫停
    if (aiStatus.paused) {
      result.paused = true; result.intent = 'paused'; result.pausedReason = aiStatus.reason ?? '';
      result.list = traditionalList(q, view, lang, 10);
      return result;
    }

    // 1 注入偵測
    const inj = detectInjection(q);
    if (inj.detected) { result.injection = inj; result.guards.push({ kind: 'prompt-injection', ruleId: inj.ruleId }); }

    // 實體與時間
    const entities = detectEntities(q);
    if (presetDisease && diseaseById.has(presetDisease) && !entities.diseases.some((d) => d.id === presetDisease)) entities.diseases.push({ id: presetDisease, name: diseaseById.get(presetDisease).name, pos: 999, preset: true });
    result.entities = entities;
    result.diseases = entities.diseases.map((d) => d.id);
    result.disease = entities.diseases.find((d) => !d.preset)?.id ?? entities.diseases[0]?.id ?? null;
    const range = parseTimeRange(q);
    const hasRange = range.n != null || range.from != null || (range.years.length > 0 && !/(出生|年次|以後|以前|之後|之前|born|sinh năm|sinh)/i.test(q));
    result.timeRange = hasRange ? range : null;

    // 2 意圖
    const ci = classifyIntent(q, { view, hasTimeRange: hasRange, hasDisease: !!result.disease });
    result.intent = ci.intent; result.intentReasons = ci.reasons; result.intentScores = ci.scores;
    if (forceIntent) { result.intent = forceIntent; result.intentReasons.push(`forced.${forceIntent}`); }

    // 3 拒答（謠言查證頁貼上的是網傳訊息本身：只套用注入、危害、隱私、冒名規則）
    const RUMOR_RULE_KINDS = new Set(['prompt-injection', 'harmful', 'privacy', 'impersonation']);
    for (const r of REFUSAL_RULES) {
      if (forceIntent === 'rumor' && !RUMOR_RULE_KINDS.has(r.kind)) continue;
      const hit = r.test ? r.test(q) : r.re.test(q);
      if (hit) { result.intentReasons.push(r.id); return setRefusal(result, r.kind, r.id); }
    }

    const expanded = expandQuery(q, lang);
    result.termNotes = expanded.notes;

    // 7 謠言
    if (result.intent === 'rumor') return factCheck(q, result);

    // 6 統計
    if (result.intent === 'stats') {
      const st = statsAnswer(q, entities, range, lang);
      if (st && !st.empty) {
        result.stats = st.stats; result.sources = [{ ...st.source, n: 1 }];
        result.sentences = st.sentences.map((s) => ({ ...s, n: [1] }));
        result.confidence = 0.9; result.completeness = { required: ['number'], covered: ['number'], missing: [], score: 1 };
        result.actions = actionsFor(result, entities, null);
        result.related = relatedQuestions(result);
        return result;
      }
      if (st?.empty) return setRefusal(result, 'no-data', 'ref.no-data', [{ label: '開放資料與統計', href: '/data/', kind: 'link' }]);
    }

    // 4 檢索（同語言 reviewed 優先，否則中文）
    const k = view === 'pro' ? 8 : 6;
    let chunks = [];
    if (lang !== 'zh-TW') {
      chunks = retrieve(q, { view, lang, k, intent: result.intent, entities, expanded, presetDisease, guards: result.guards });
      if (chunks.length && chunks[0]._score < 2.5) chunks = [];
    }
    if (!chunks.length) {
      chunks = retrieve(q, { view, lang: 'zh-TW', k, intent: result.intent, entities, expanded, presetDisease, guards: result.guards });
      if (lang !== 'zh-TW' && chunks.length) result.translationNote = 'showing-source';
    }
    result.retrieved = chunks;

    // 態勢（只讀結構化欄位）
    const sit = (result.intent === 'situation' || (result.disease && ['symptoms', 'vaccine', 'unknown'].includes(result.intent))) ? situationFor(entities, result.intent) : null;
    if (sit) { result.situation = sit; result.peak = sit.items.some((i) => i.status === 'peak'); }

    // 信心：查詢詞被最佳片段涵蓋的比例 ＋ 實體吻合
    if (chunks.length) {
      const qw = chunks.qWeights; const model = chunks.model;
      const topToks = new Set(tokenize(`${chunks[0].title} ${chunks[0].text}`));
      let cov = 0, tot = 0; for (const [t, w] of qw) { if (!model.has(t)) continue; const idf = model.idf(t) * w; tot += idf; if (topToks.has(t)) cov += idf; }
      const ent = result.disease ? ((chunks[0].diseases ?? []).includes(result.disease) ? 1 : 0) : 0.5;
      result.confidence = Math.round(Math.min(1, 0.6 * (cov / (tot || 1)) + 0.25 * ent + 0.15 * Math.min(1, chunks[0]._score / 12)) * 100) / 100;
    }

    // 5 組句
    const sourceMap = new Map(chunks.map((c) => [c.id, sourceOf(c)]));
    let picked = composeSentences(q, chunks, result.intent, view, result.guards);
    if (sit && (result.intent === 'situation' || (!picked.length && sit.items.length) || (result.peak && picked.length < 3))) {
      const ss = situationSentences(sit, lang);
      for (const [id, s] of ss.sources) sourceMap.set(id, s);
      picked = [...ss.sentences.slice(0, Math.max(2, 4 - picked.length)), ...picked].slice(0, view === 'pro' ? 5 : 4);
      result.confidence = Math.max(result.confidence, 0.8);
    }

    if (result.intent === 'travel' && entities.countries.length) {
      const tr = travelFor(entities);
      if (tr.length) {
        result.travel = tr;
        const ts = travelSentences(tr, lang);
        for (const [id, src] of ts.sources) sourceMap.set(id, src);
        picked = [...ts.sentences.slice(0, 2), ...picked].slice(0, 4);
        result.confidence = Math.max(result.confidence, 0.7);
      }
    }

    // 不確定 → 退回傳統列表
    let lowConf = result.confidence < 0.35 || !picked.length;
    if (!picked.length) {
      result.list = traditionalList(q, view, lang, 8);
      return setRefusal(result, 'no-source', 'ref.no-source', actionsFor(result, entities, sit));
    }
    const sitOnly = picked.length && picked.every((p) => p.cite.every((id) => id.startsWith('situation#')));
    if (lowConf && !sitOnly && !(sit && result.intent === 'situation') && !result.travel) {
      result.list = traditionalList(q, view, lang, 8);
      if (result.confidence < 0.3) return setRefusal(result, 'no-source', 'ref.low-confidence', actionsFor(result, entities, sit));
    }
    if (result.intent === 'unknown' && lowConf) {
      result.list = traditionalList(q, view, lang, 8);
      result.fallbackList = true;
    }
    finalizeSentences(result, picked, sourceMap);
    if (!result.sentences.length) return setRefusal(result, 'no-source', 'ref.no-source');
    result.completeness = completenessOf(result.intent, result.sentences, { situation: !!sit });
    result.actions = actionsFor(result, entities, sit);
    result.related = relatedQuestions(result);
    return result;
  }

  return {
    answer, retrieve, detectEntities, detectDisease, expandQuery, relatedQuestions, traditionalList,
    classifyIntent: (q, o) => classifyIntent(q, o), maskPII, detectInjection, statsAnswer, situationFor, citeLabelOf,
    get diseaseById() { return diseaseById; },
  };
}

// ───────────────────────── 小工具 ─────────────────────────

function mdPlain(md) {
  return String(md ?? '').replace(/```[\s\S]*?```/g, ' ').replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/^\s*#+\s*/gm, '').replace(/^\s*([-*+]|\d+\.)\s+/gm, '').replace(/[*_`~]+/g, '').replace(/[ \t]+/g, ' ').trim();
}

function normTravel(t) {
  const iso = String(t.iso2 ?? t.countryCode ?? t.iso ?? t.code ?? t.country_code ?? '').toUpperCase();
  const dn = t.diseaseNames ?? t.diseaseName ?? t.disease_name ?? t.diseases ?? t.disease ?? [];
  return {
    iso2: iso, name: t.countryName ?? t.nameZh ?? t.name ?? t.country ?? iso, level: t.level ?? t.alertLevel ?? t.levelNumber ?? t.severity ?? null,
    levelLabel: t.levelLabel ?? t.levelName ?? null, diseaseNames: (Array.isArray(dn) ? dn : [dn]).filter((x) => x && !String(x).startsWith('disease.')),
    date: t.publishedAt ?? t.updatedAt ?? t.date ?? t.effectiveAt ?? null, advice: t.advice ?? t.recommendation ?? null,
  };
}

/** 句切（中英標點、換行）；索引建置與前端共用 */
export function splitPlain(text) {
  return String(text ?? '')
    .split(/(?<=[。！？；])|(?<=[!?;])\s+|(?<=\.)\s+(?=[A-Z0-9(“"'])|\n+/)
    .map((s) => s.trim()).filter((s) => s.length >= 4 && /[\p{L}\p{N}]/u.test(s));
}

/** 相容舊名稱 */
export const REFUSAL_PATTERNS = REFUSAL_RULES;
