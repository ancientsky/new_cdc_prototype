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

// 檢驗意圖（lab）只在專業模式、或問句含專業詞時啟用；民眾問「要驗什麼」導向疾病頁「診斷與治療」區塊
export const LAB_PRO_RE = /(檢體|採檢|送驗|檢驗項目|拭子|檢驗單位|採血管|痰(液)?(檢體|抹片|培養)|驗痰|specimen)/i;
export const LAB_PUBLIC_RE = /(要驗什麼|驗什麼|要檢查什麼|做什麼檢查|怎麼驗|怎麼檢查|如何診斷|怎麼診斷|要抽血|需要抽血)/;
// 問句線索 → 型別加權（第二輪：影音、出版品）
const MEDIA_CUE = /(影片|影音|宣導片|衛教片|動畫|短片|短影音|Podcast|播客|YouTube|video)/i;
const RESEARCH_CUE = /(研究計畫|研究案|委託研究|成果報告|計畫編號|IRB|研究的?(目標|目的|結果|發現)|這項研究|哪些研究)/;
const PUB_CUE = /(哪一期|第幾期|那一期|哪期|期刊|疫情報導|年報|卷|出版品|手冊下載|刊登)/;
const OPEN_CUE = /(現在|目前|正在|有在|還有|進行中|開放|可以報名|可以投標|最新|最近|近期|還能)/;
const RECRUIT_CUE = /(招募|徵才|職缺|徵人|約聘|約僱|甄選|甄試|工作機會|缺額|招考|人員)/;
const PROCUREMENT_CUE = /(採購|標案|招標|投標|決標|公開評選|開標|案號)/;
// 第七輪（ARCHITECTURE 15.1）：人才招募（job）與採購公告（tender）
/** 問「誰錄取／錄取名單／結果」：不唸名單，只給結果頁連結 */
export const ADMIT_RE = /(錄取|正取|備取|遞補|榜單|放榜|上榜|甄選結果|甄試結果|錄用)/;
/** 職缺細節問句（資格、薪資、應備文件、甄試…）⇒ 走檢索組句（仍只用職缺片段） */
const CAREERS_DETAIL_RE = /(資格|條件|工作內容|做什麼|負責什麼|應備|文件|要準備|要帶|甄試方式|考什麼|筆試|口試|實作|薪水|薪資|待遇|薪點|月薪|多少錢|在哪上班|工作地點)/;
/** 採購細節問句（標的、規格、特別規定、履約）⇒ 走檢索組句 */
const PROCUREMENT_DETAIL_RE = /(採購標的|標的物|標的是|規格|特別規定|履約|服務期間|交貨|要買什麼|買什麼)/;
/** 職稱比對時去掉的泛用字 */
const JOB_TITLE_GENERIC_RE = /(徵求|名額|約聘|約僱|聘用|人員|招募|職缺|疾管署|疾病管制署|案|採購|勞務|財物|年度|\d+|[\s（）()「」、，,．.·－-])/g;
/** 問職稱（「防疫醫師」）或用人單位（「疫情中心」）⇒ 聚焦在相符的職缺／標案：title 去泛用字後的雙字片段命中 ≥ 2 個 */
function titleHits(q, title) {
  const t = String(title ?? '').replace(JOB_TITLE_GENERIC_RE, '');
  const grams = new Set(); for (let i = 0; i + 1 < t.length; i++) grams.add(t.slice(i, i + 2));
  let n = 0; for (const g of grams) if (q.includes(g)) n++;
  return n;
}
/** 問句是否指名某一則職缺／標案：職稱雙字片段命中 ≥ 2，或命中該則的辨識關鍵字（focusTerms，索引建置時由 keywords 去泛用詞） */
const focusOf = (q, c) => titleHits(q, c.title) >= 2 || (c.focusTerms ?? []).some((k) => q.toLowerCase().includes(String(k).toLowerCase()))
  || (!!c.tenderNo && q.toUpperCase().includes(String(c.tenderNo).toUpperCase()));

/** 旅遊疫情建議「變化」問句（最近哪些國家解除／調升…）；trv.change 意圖規則與 travelChanges 共用 */
const TRAVEL_CHANGE_KINDS = { lifted: /(解除|取消|撤銷|撤除|\blift(ed)?\b)/i, raised: /(調升|升級|提高|\braised?\b)/i, lowered: /(調降|降級|降低|\blowered\b)/i, new: /(新增|新發布|新列)/ };
const TRAVEL_CHANGE_RE = /((旅遊疫情建議|旅遊警示|疫情等級|旅遊等級).{0,12}(解除|取消|撤銷|調升|調降|升級|降級|新增|變化|異動|調整)|(解除|取消|撤銷|調升|調降|新增).{0,12}(旅遊疫情建議|旅遊警示|疫情等級)|travel (health )?(notices?|advisor(y|ies)).{0,20}\b(lifted|raised|lowered|changes?)\b)/i;

/**
 * 可解釋意圖規則。每條：{ id, intent, weight, re, note, gate? }。命中加權，最高分者為意圖；分數 < 2 → unknown。
 * view==='pro' 另加 pro.view 規則；gate:'lab' 的規則只在專業模式或含專業詞（LAB_PRO_RE）時計分。
 */
export const INTENT_RULES = [
  // 症狀
  { id: 'sym.symptom-words', intent: 'symptoms', weight: 2, re: /(發燒|發熱|咳嗽|紅疹|起疹|出疹|疹子|拉肚子|腹瀉|嘔吐|頭痛|喉嚨痛|流鼻水|肌肉痠痛|關節痛|後眼窩痛|全身痠痛|倦怠|嗜睡|抽搐|呼吸急促|水泡|口腔潰瘍|黃疸|血便)/, note: '症狀詞' },
  { id: 'sym.symptom-generic', intent: 'symptoms', weight: 2, re: /(症狀|徵象|徵兆|前兆|不舒服|病徵)/, note: '症狀泛稱' },
  { id: 'sym.seek-care', intent: 'symptoms', weight: 3, re: /(要不要看醫生|該不該就醫|何時就醫|什麼時候.{0,4}就醫|幾天內.{0,6}就醫|就醫|看醫生|看診|掛號|急診|回診)/, note: '就醫時機' },
  { id: 'sym.after-travel', intent: 'symptoms', weight: 6, re: /(回國|返國|回台|回來|入境).{0,8}(發燒|出疹|紅疹|起疹|腹瀉|拉肚子|不舒服|症狀|咳嗽)/, note: '返國後症狀' },
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
  { id: 'trv.change', intent: 'travel', weight: 3, re: TRAVEL_CHANGE_RE, note: '旅遊疫情建議的變化（新增／調升／調降／解除）' },
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
  // ── 第二輪（ARCHITECTURE.md 11.3）──
  // 申請：怎麼申請、要帶什麼、幾天、費用、黃皮書、證明、捐款、委託、預約
  { id: 'app.how', intent: 'apply', weight: 5, re: /(怎麼|如何|要怎麼|怎樣|去哪裡?|哪裡可以|在哪裡?)(線上)?(申請|辦理|預約|委託|捐款|捐贈|捐|索取|申辦|開立|補發)|申請(流程|方式|步驟|資格|條件|表單|書|窗口|管道)|線上申請|臨櫃/, note: '怎麼申請／辦理' },
  { id: 'app.documents', intent: 'apply', weight: 4, re: /(申請|辦理|委託|送件|臨櫃|預約|黃皮書|證明).{0,10}(要帶|帶什麼|準備什麼|準備哪些|要準備|附什麼|帶哪些)|(應備|需備|檢附).{0,4}(文件|證件|資料|表單)|帶哪些證件/, note: '應備文件' },
  { id: 'app.named', intent: 'apply', weight: 4, re: /(黃皮書|國際預防接種證明|預防接種證明|接種證明|個案資料申請|資料申請|研究資料|檢驗委託|委託檢驗|疫苗基金|捐款|捐贈|門診預約|預約門診)/, note: '具名服務（黃皮書、資料申請、檢驗委託、疫苗基金…）' },
  { id: 'app.generic', intent: 'apply', weight: 2, re: /(申請|委託|預約|證明書?|捐款|捐贈|核發)/, note: '申請泛稱' },
  { id: 'app.sla-fee', intent: 'apply', weight: 1, re: /(幾天|多久|幾個工作天|工作天|處理時間|審核時間|費用|規費|多少錢|收費|要錢嗎|免費嗎)/, note: '處理天數／費用（只加強，不單獨成立）' },
  // 檢驗（專業）：檢體、容器、送驗、保存、運送、檢驗項目、週轉
  { id: 'lab.specimen', intent: 'lab', weight: 4, gate: 'lab', re: /(檢體|採檢|送驗|採血|血清|拭子|痰(液)?(檢體|抹片|培養)|驗痰|幾套|幾管|採檢管|檢體瓶|specimen)/i, note: '檢體／採檢／送驗' },
  { id: 'lab.handling', intent: 'lab', weight: 3, gate: 'lab', re: /(檢體|採檢|拭子|血清|痰|全血|尿液|糞便).{0,6}(容器|保存|冷藏|冷凍|運送|寄送|溫度)|(容器|保存|運送).{0,4}檢體|週轉|幾天出(報告|結果)|多久出(報告|結果)/, note: '檢體容器、保存、運送、週轉（須與檢體詞同現，避免「積水容器」）' },
  { id: 'lab.tests', intent: 'lab', weight: 3, gate: 'lab', re: /(檢驗項目|要驗什麼|驗什麼|檢驗方法|PCR|核酸檢驗|抗原檢驗|抗體檢驗|IgM|NS1|病毒培養|檢驗單位|哪裡驗|送哪裡)/i, note: '檢驗項目／單位' },
  // 通報：時限、第幾類、法定傳染病分類（可由主檔直接回答）
  { id: 'ntf.within', intent: 'notify', weight: 6, re: /((幾|多少)\s*(個)?\s*(小時|天|日|週)|多久)(內|之內)?.{0,4}通報|通報(時限|期限|時間|期程)|報告時限|(應|要|需|需要|必須|應該)(在|於)?.{0,6}(小時|天|日|週)內(通報|報告)/, note: '通報時限' },
  { id: 'ntf.category', intent: 'notify', weight: 5, re: /(第\s*[一二三四五1-5]\s*類|第幾類|幾類|哪一類|哪類)(法定)?(傳染病)?|法定傳染病(分類|類別|有哪些|有幾類)|傳染病(分類|類別)/, note: '法定傳染病分類' },
  { id: 'ntf.generic', intent: 'notify', weight: 3, re: /(通報|要不要報|需不需要報|法定傳染病)/, note: '通報泛稱' },
  // 公告：人才招募、採購、截止
  { id: 'ntc.deadline', intent: 'notice', weight: 2, re: /(截止|報名期限|收件期限)/, note: '截止' },
  // 第七輪：人才招募（job）、採購公告（tender）各自成為意圖（原 ntc.recruit／ntc.procurement）
  { id: 'car.recruit', intent: 'careers', weight: 5, re: /(招募|徵才|職缺|徵人|約聘|約僱|甄選|甄試|工作機會|缺額|招考|人才招募|有缺|缺人|開缺|人事室|錄取|正取|備取|遞補|榜單|放榜|徵求.{0,6}(人員|醫師|助理|技工|研究員|技術員))/, note: '人才招募（職缺、甄選、錄取、人事室）' },
  { id: 'car.salary', intent: 'careers', weight: 3, re: /(薪水|薪資|待遇|薪點|月薪|起薪)/, note: '薪資待遇' },
  { id: 'car.apply', intent: 'careers', weight: 2, re: /(報名|投履歷|應徵|求職|上班)/, note: '報名（弱：與其他「報名」共用）' },
  { id: 'car.en', intent: 'careers', weight: 5, re: /\b(jobs?|vacanc(y|ies)|recruit\w*|hiring|careers?|job openings?)\b/i, note: 'English jobs words' },
  { id: 'prc.en', intent: 'procurement', weight: 5, re: /\b(tenders?|procurement|bidding)\b/i, note: 'English procurement words' },
  { id: 'prc.words', intent: 'procurement', weight: 5, re: /(採購|標案|招標|投標|決標|公開評選|開標|案號|流標|得標|廢標|政府電子採購網)/, note: '採購公告（招標、投標、決標）' },
];
/** 專業子意圖（專業模式下不被 professional 覆寫） */
export const PRO_SUB_INTENTS = ['apply', 'lab', 'notify', 'notice', 'careers', 'procurement'];

const INTENT_PRIORITY = ['rumor', 'stats', 'notify', 'careers', 'procurement', 'notice', 'apply', 'lab', 'professional', 'situation', 'travel', 'vaccine', 'symptoms'];

/** 意圖判斷：回傳 { intent, reasons[], scores{} } */
export function classifyIntent(q, { view = 'public', hasTimeRange = false, hasDisease = false, hasCountry = false } = {}) {
  const scores = {}; const reasons = [];
  // 研究計畫問句（「血清抗體盛行率研究」）不是在問送驗規定，除非明講檢體／送驗／採檢
  const labGate = (view === 'pro' || LAB_PRO_RE.test(q)) && !(RESEARCH_CUE.test(q) && !/(檢體|送驗|採檢|容器)/.test(q));
  // 刊名「疫情報導」不是在問疫情現況（出版品問句交給檢索與 PUB_CUE 型別加權）
  const qi = q.replace(/疫情報導/g, '期刊');
  if (qi !== q) reasons.push('pub.bulletin-name');
  for (const r of INTENT_RULES) {
    if (r.gate === 'lab' && !labGate) continue;
    if (r.re.test(qi)) { scores[r.intent] = (scores[r.intent] ?? 0) + r.weight; reasons.push(r.id); }
  }
  if (hasTimeRange) { scores.stats = (scores.stats ?? 0) + 3; reasons.push('sta.time-range'); }
  if (hasCountry) { scores.travel = (scores.travel ?? 0) + 2; reasons.push('trv.country-entity'); }
  if (view === 'pro') {
    scores.professional = (scores.professional ?? 0) + 4; reasons.push('pro.view');
    // 專業子意圖（檢驗、通報、申請、公告）與 professional 同享專業模式加權，具體者優先
    for (const k of PRO_SUB_INTENTS) if ((scores[k] ?? 0) >= 2) { scores[k] += 4; reasons.push(`pro.view-${k}`); }
  }
  // 「現在疫情」與統計詞同時出現且沒有時間範圍 → 疫情優先（態勢卡回答）
  if (scores.situation && scores.stats && !hasTimeRange && /(現在|目前|最近|本週|這週|嚴重嗎)/.test(q)) { scores.stats -= 2; reasons.push('sit.over-stats'); }
  let best = 'unknown', bestScore = 0;
  for (const intent of INTENT_PRIORITY) { const s = scores[intent] ?? 0; if (s > bestScore) { best = intent; bestScore = s; } }
  if (bestScore < 2) { best = 'unknown'; if (hasDisease) reasons.push('unk.disease-only'); }
  // 專業模式：除謠言、統計、疫情外，一律以專業意圖回答（引用條次與版次，不白話化）
  if (view === 'pro' && !['rumor', 'stats', 'situation', 'professional', ...PRO_SUB_INTENTS].includes(best)) { best = 'professional'; reasons.push('pro.view-override'); }
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
  { id: 'ref.privacy', kind: 'privacy', test: (q) => /((確診者|個案|病人|患者|感染者).{0,6}(住哪|住在|地址|姓名|名字|是誰|身分|電話|哪一家|工作地點))|(誰確診|哪個人確診|公布.{0,4}(姓名|名單))/.test(q) && !(ADMIT_RE.test(q) && !/(確診|個案|病人|患者|感染)/.test(q)), note: '他人個資（問職缺錄取名單另由 careers 意圖只給結果頁連結）' },
  { id: 'ref.privacy.admitted', kind: 'privacy', re: /(錄取|正取|備取|遞補|上榜|應考|考生|報名者).{0,12}(住哪|住在|地址|電話|手機|身分證|生日|幾歲|年紀|全名|真名|本名|完整姓名|學校|畢業|臉書|IG|照片)/, note: '錄取者個資（只公布報名編號與遮罩姓名）' },
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
    'pro-only': { title: '檢驗與送驗規定屬專業內容', text: '檢體採集、容器、保存運送與送驗時限是給醫療院所與檢驗人員的專業內容，請切換專業模式或到檢驗專區查詢。想了解疾病怎麼診斷，可看疾病頁「診斷與治療」。' },
    'no-open-job': { title: '目前沒有開放報名的職缺', text: '疾管署目前沒有報名中的職缺。即將開放、審查中與歷次錄取結果請看「人才招募」頁，也可訂閱人才招募 RSS。' },
    'no-job-result': { title: '目前沒有已公告的甄選結果', text: '目前沒有已公告甄選結果的職缺。甄選結果只在各職缺頁公布報名編號與遮罩姓名，答案不會唸出名單。' },
    'no-open-tender': { title: '目前沒有招標中的標案', text: '疾管署目前沒有投標期間內的採購案。已截止、已開標、決標與流標的案件請看「採購公告」頁；正式公告以政府電子採購網為準。' },
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
    'pro-only': { title: 'Specimen rules are professional content', text: 'Specimen collection, containers, storage and shipping rules are for healthcare and laboratory staff. Switch to professional mode or see the laboratory testing page.' },
    'no-open-job': { title: 'No open vacancies right now', text: 'Taiwan CDC has no vacancies open for application at the moment. See the Jobs page for upcoming vacancies and past results.' },
    'no-job-result': { title: 'No published selection results', text: 'No selection results have been published. Results list only applicant numbers and masked names on each vacancy page; this service does not read out the list.' },
    'no-open-tender': { title: 'No open tenders right now', text: 'Taiwan CDC has no tenders open for bids at the moment. See the Procurement page; official notices are on the Government e-Procurement System.' },
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
  [/要驗什麼|驗什麼|怎麼驗|怎麼檢查|做什麼檢查|要檢查什麼|如何診斷|怎麼診斷/, '診斷 檢驗 治療'],
  [/怎麼申請|如何申請|申請流程|怎麼辦理/, '申請 步驟'], [/要帶什麼|準備什麼|帶哪些/, '應備文件 準備'],
  [/影片|宣導片|衛教片|動畫/, '影片 影音'], [/職缺|徵才|徵人/, '招募'], [/標案|招標|投標/, '採購'],
];

function lc(s) { return String(s ?? '').toLowerCase(); }
/** 介面字（建議行動標籤）：中文以外一律英文 */
function tr(lang, zh, en) { return lang === 'zh-TW' ? zh : en; }

// ───────── 疫苗及流感藥劑地圖（vaxmap-next）深連結 ─────────
// 網址與 site.config.mjs 的 vaxmapUrl／vaxmapInfoUrl 相同。client 端無法 import site.config，所以在此寫死；
// 頁面可用 window.CDC.config = { vaxmapUrl, vaxmapInfoUrl } 覆寫（site 端若日後注入就不用改這裡）。
// 規則（docs/vaxmap-integration.md）：#g=flu|covid|pcv|antiviral；語言 zh-TW 不帶、其餘 lang=<碼>。
const VAXMAP_URL = 'https://ancientsky.github.io/vaxmap-next/';
const VAXMAP_INFO_URL = 'https://ancientsky.github.io/vaxmap-next/info.html';
const VAXMAP_LANGS = new Set(['en', 'ja', 'vi', 'id', 'th', 'tl']);
const VAXMAP_GROUP_OF = { 'vaccine.influenza': 'flu', 'vaccine.covid-19': 'covid', 'vaccine.pneumococcal': 'pcv' };
const VAXMAP_GROUP_OF_DISEASE = { 'disease.influenza': 'flu', 'disease.covid-19': 'covid', 'disease.ipd': 'pcv' };
const ANTIVIRAL_RE = /抗病毒|克流感|瑞樂沙|柏洛沙韋|antiviral|oseltamivir|tamiflu|xofluza|baloxavir|タミフル|ゾフルーザ|抗ウイルス|thuốc kháng vi-rút|antivirus|obat antiviral|ยาต้านไวรัส|gamot na antiviral/i;
export function vaxmapHref(group, lang, { info = false, anchor = '' } = {}) {
  const cfg = (typeof window !== 'undefined' && window.CDC && window.CDC.config) || {};
  const lg = VAXMAP_LANGS.has(lang) ? `lang=${lang}` : '';
  if (info) {
    const h = [anchor, lg].filter(Boolean).join('&');
    return (cfg.vaxmapInfoUrl || VAXMAP_INFO_URL) + (h ? `#${h}` : '');
  }
  const h = [group ? `g=${group}` : '', lg].filter(Boolean).join('&');
  return (cfg.vaxmapUrl || VAXMAP_URL) + (h ? `#${h}` : '');
}
function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function isLatin(s) { return /^[\x00-\x7fÀ-ɏḀ-ỿ\s.\-']+$/.test(s); }
function matcherFor(name) {
  if (!name) return null;
  const n = String(name).trim();
  if (n.length < 2 && !/[一-鿿]/.test(n)) return null;
  if (isLatin(n)) return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(n).replace(/\\s+/g, '\\s*')}(?![\\p{L}\\p{N}])`, 'iu');
  // 中英混排名稱（A 肝、MMR 疫苗、B 型肝炎）：空白可有可無
  let pat = '';
  const chars = [...n.replace(/\s+/g, ' ')];
  chars.forEach((ch, i) => {
    if (ch === ' ') { pat += '\\s*'; return; }
    const prev = chars[i - 1];
    if (prev && prev !== ' ' && (/[A-Za-z0-9]/.test(prev) !== /[A-Za-z0-9]/.test(ch))) pat += '\\s*';
    pat += escapeRe(ch);
  });
  return new RegExp(pat, 'i');
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
    services = [], notifyTable = null, media = [],
  } = deps;
  // 第二輪 deps：services（申請頁 actions）、notifyTable（通報時限表，補病例定義與檢驗連結）、media（影片海報等，可選）
  const serviceById = new Map((Array.isArray(services) ? services : []).map((x) => [x.id, x]));
  const mediaById = new Map((Array.isArray(media) ? media : []).map((x) => [x.id, x]));
  const notifyRows = normalizeNotifyTable(notifyTable);
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
  /** 實體名稱與其別名的 token（實體加權已處理，BM25 端降權，避免同病所有片段分數一樣高） */
  function entityTokens(entities) {
    const names = new Set();
    for (const d of entities?.diseases ?? []) {
      const dz = diseaseById.get(d.id);
      for (const n of [d.name, dz?.name, ...(dz?.aliases ?? []), dz?.nameEn]) if (n) names.add(n);
      for (const g of glossary) if ((g.refs ?? []).includes(d.id)) for (const n of [g['zh-TW'], ...(g.aliases ?? []), ...(g.deprecated ?? []), g.en]) if (n) names.add(n);
    }
    const span = [...(entities?.diseases ?? []), ...(entities?.vaccines ?? [])].filter((x) => !x.derived && !x.preset).map((x) => x.name);
    return { toks: new Set(tokenize([...names].join(' '))), spanToks: new Set(tokenize(span.join(' '))), names: new Set([...names].map(lc)) };
  }
  function queryWeights(q, expanded, ent = null) {
    const w = new Map();
    const et = ent?.toks ?? new Set();
    const st = ent?.spanToks ?? new Set();
    for (const t of tokenize(q, { query: true })) w.set(t, st.has(t) ? 0.25 : 1);
    for (const t of tokenize(expanded.added.join(' '), { query: true })) if (!w.has(t)) w.set(t, et.has(t) ? 0.1 : 0.7);
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
    const ent = entityTokens(entities);
    const qw = queryWeights(q, expanded, ent);
    if (!qw.size) return [];
    const dIds = new Set(entities.diseases.map((d) => d.id)); if (opts.presetDisease) dIds.add(opts.presetDisease);
    const vIds = new Set(entities.vaccines.map((v) => v.id));
    const cIds = new Set(entities.countries.map((c) => c.id));
    const task = INTENT_TASK[intent];
    const qLower = lc(expanded.text);
    const wantOpen = OPEN_CUE.test(q);
    const noticeType = RECRUIT_CUE.test(q) && !PROCUREMENT_CUE.test(q) ? 'recruit' : PROCUREMENT_CUE.test(q) && !RECRUIT_CUE.test(q) ? 'procurement' : null;
    const labPublic = view !== 'pro' && LAB_PUBLIC_RE.test(q);
    const scored = [];
    for (const d of model.docs) {
      let s = bm25Score(model, d, qw);
      if (s <= 0) continue;
      const c = d.c;
      for (const t of c.terms ?? []) if (t && String(t).length >= 2 && !ent.names.has(lc(t)) && qLower.includes(lc(t))) s += 0.6;
      if (dIds.size) {
        if ((c.diseases ?? []).some((x) => dIds.has(x))) s = s * 1.6 + 2;
        else if ((c.diseases ?? []).length) continue; // 問的是 A 病，不拿 B 病的內容回答
        else s *= 0.6;
      }
      if (vIds.size && (c.vaccines ?? []).some((x) => vIds.has(x))) s = s * 1.3 + 1;
      if (cIds.size) {
        if ((c.countries ?? []).some((x) => cIds.has(x))) s = s * 1.3 + 1;
        else if ((c.countries ?? []).length) continue; // 問泰國，不拿日本的內容回答
      }
      if (task && (c.tasks ?? []).includes(task)) s *= 1.15;
      if (view === 'pro' && (c.type === 'document' || c.type === 'letter')) s *= 1.3;
      if (intent !== 'rumor' && c.type === 'clarification') s *= 0.5;
      // 第二輪：意圖 → 型別加權；問句線索（影片、哪一期）→ 型別加權
      if ((intent === 'apply' || intent === 'notify') && c.type === 'service') s = s * 1.8 + 2;
      if (intent === 'lab' && c.type === 'labtest') s = s * 1.8 + 2;
      if (intent === 'notice') {
        if (NOTICE_TYPES.includes(c.newsType)) s = s * 2 + 2; else s *= 0.4;
        if (noticeType && NOTICE_TYPES.includes(c.newsType) && c.newsType !== noticeType) s *= 0.3; // 問職缺不拿標案
        if (NOTICE_TYPES.includes(c.newsType) && !closedNow(c)) s *= 1.2; // 進行中優先
        if (wantOpen && closedNow(c)) { guards.push({ kind: 'closed-dropped', id: c.id }); continue; }
      }
      // 第七輪：careers → 職缺、procurement → 標案；問「現在／開放」不拿已截止
      if (intent === 'careers' || intent === 'procurement') {
        const want = intent === 'careers' ? 'job' : 'tender';
        if (c.type === want) s = s * 2 + 2; else s *= 0.4;
        if (c.type === want && !closedNow(c)) s *= 1.2;
        if (wantOpen && c.type === want && closedNow(c)) { guards.push({ kind: 'closed-dropped', id: c.id }); continue; }
      }
      if (c.type === 'media') s = MEDIA_CUE.test(q) ? s * 1.6 + 1.5 : s * 0.85;
      if (c.type === 'publication' && PUB_CUE.test(q)) s = s * 1.6 + 1.5;
      if (c.type === 'research' && RESEARCH_CUE.test(q)) s = s * 1.6 + 1.5;
      if (labPublic && c.block === 'treatment') s = s * 1.5 + 1;
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
    apply: [/(第\s*\d+\s*步|步驟|申請對象|線上申請|填寫|送件|臨櫃)/, /(申請需準備|文件|證件|護照|身分證|表單)/, /(處理天數|\d+\s*天|費用|元|免費|法源)/],
    lab: [/(容器|管|mL|ml|毫升|保存|運送|°C|冷藏|冷凍)/, /(送驗時限|小時|週轉|檢驗單位|可做)/],
    notice: [/(截止|報名|投標)/, /(名額|預算|字號)/],
    careers: [/(報名期間|截止|名額)/, /(資格|工作內容|應備文件|甄試|薪資)/],
    procurement: [/(投標截止|開標|決標)/, /(案號|預算)/],
  };
  const REQUIRED_POINTS = {
    symptoms: [{ key: 'seek-care', label: '就醫時機', re: /(就醫|看醫生|回診|急診|立即|see a doctor|seek|119)/i }],
    vaccine: [{ key: 'who', label: '接種對象', re: /(出生|歲|對象|成人|幼兒|長者|族群|者|born|adults?|eligible|aged)/i }],
    travel: [{ key: 'before-travel', label: '行前準備', re: /(出國|行前|旅遊|返國|入境|前往|travel|before)/i }],
    situation: [{ key: 'status', label: '態勢狀態', re: /(態勢|高峰|上升|下降|平穩|流行|就診率|%)/ }],
    professional: [{ key: 'rule', label: '條文或時限', re: /(第\s*\d+\s*條|應於|小時|日內|定義|送驗|檢體|對象)/ }],
    apply: [{ key: 'how', label: '申請方式', re: /(第\s*\d+\s*步|申請|填寫|線上|送件|臨櫃|向)/ }],
    lab: [{ key: 'specimen', label: '檢體與容器', re: /(檢體|容器|血清|拭子|管|痰)/ }],
    notice: [{ key: 'deadline', label: '截止日', re: /截止/ }],
    careers: [{ key: 'job', label: '職缺資訊', re: /(報名期間|資格|工作內容|應備文件|甄試|薪資|名額)/ }],
    procurement: [{ key: 'tender', label: '標案資訊', re: /(案號|投標截止|標的|決標|預算)/ }],
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
    const neToks = [...qw.entries()].filter(([t, w]) => w >= 0.5 && model.has(t)).map(([t]) => t);
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
        if (sen.length > (sen.includes('： ') ? 200 : 140)) s -= 0.6; else if (sen.length < 10) s -= 0.6;
        if (si === 0 && c.type === 'faq') s += 0.3;
        if (view === 'pro' && (c.type === 'document' || c.type === 'letter')) s += 0.5;
        if (cov <= 0.05 && covTitle < 0.3 && !(ci === 0 && si === 0)) return;
        // 問句除了病名還有其他關鍵詞時，句子（或其片段標題）至少要命中一個，避免「只因為同一種病」被選入
        if (neToks.length && !neToks.some((t) => toks.has(t) || titleToks.has(t)) && !(ci === 0 && si === 0)) return;
        cands.push({ text: sen, cite: [c.id], score: s, slot, chunk: c });
      });
    });
    cands.sort((a, b) => b.score - a.score);
    const allCands = [...cands];
    const topCand = cands[0]?.score ?? 0;
    for (let i = cands.length - 1; i > 0; i--) if (cands[i].score < topCand * 0.45) cands.splice(i, 1);
    const max = view === 'pro' ? 4 : 3;
    const picked = [];
    // 數字不同的兩句不是同義句（例：不同公告的字號、名額），不合併引用
    const nums = (t) => (String(t).match(/\d+/g) ?? []).join(',');
    const similar = (a, b) => { if (nums(a) !== nums(b)) return 0; const A = new Set(bigrams(a)), B = new Set(bigrams(b)); let n = 0; for (const x of A) if (B.has(x)) n++; return n / Math.max(1, Math.min(A.size, B.size)); };
    // 多樣性：同一片段每多選一句，後續句子減分（避免整段只引一個來源）
    const perChunk = new Map();
    const queue = [...cands];
    const nextCand = () => {
      let bi = -1, bs = -Infinity;
      queue.forEach((c, i) => { const eff = c.score - 0.6 * (perChunk.get(c.chunk.id) ?? 0) - 0.4 * (perChunk.get(c.chunk.contentId) ?? 0); if (eff > bs) { bs = eff; bi = i; } });
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
      perChunk.set(c.chunk.contentId, (perChunk.get(c.chunk.contentId) ?? 0) + 1);
      if (picked.length >= max) break;
    }
    // completeness：意圖必要要點（＋問句線索要點）缺漏時，從候選補入
    const req = requiredFor(intent, q);
    for (const r of req) {
      if (picked.some((p) => r.re.test(p.text))) continue;
      const add = allCands.find((c) => r.re.test(c.text) && !picked.some((p) => p.text === c.text) && !PERSONAL_ADVICE_RE.test(c.text) && c.score > 1);
      if (add) { if (picked.length >= max) picked.pop(); picked.push({ ...add, cite: [...add.cite] }); }
    }
    picked.sort((a, b) => a.slot - b.slot || b.score - a.score);
    return picked;
  }

  const QUERY_POINTS = [
    { cue: /(預防|防範|怎麼避免|如何避免|防治)/, key: 'prevention', label: '預防作法', re: /(預防|防蚊|長袖|清除|積水|巡、倒|洗手|口罩|接種|避免)/ },
    { cue: /(怎麼辦|該怎麼做|如何處理|要注意什麼)/, key: 'action', label: '該怎麼做', re: /(就醫|撥打|立即|請|應|建議)/ },
    { cue: /(多久|幾天|幾小時|何時|什麼時候)/, key: 'time', label: '時間', re: /\d|[一二三四五六七八九十]+\s*(天|週|小時|個月|日)/ },
    { cue: /(要帶|準備什麼|準備哪些|應備|文件|證件)/, key: 'documents', label: '應備文件', re: /(準備|文件|證|表|護照)/, intents: ['apply'] },
    { cue: /(費用|多少錢|收費|免費|規費)/, key: 'fee', label: '費用', re: /(元|費|免費)/, intents: ['apply'] },
    { cue: /(誰能|誰可以|哪些人|資格|對象)/, key: 'who', label: '申請對象', re: /(對象|資格|醫師|醫療院所|民眾|研究|機關|衛生局|者)/, intents: ['apply'] },
    { cue: /(溫度|保存|冷藏|冷凍)/, key: 'storage', label: '保存條件', re: /(保存|°C|冷藏|冷凍|室溫)/, intents: ['lab'] },
  ];
  function requiredFor(intent, q) {
    const out = [...(REQUIRED_POINTS[intent] ?? [])];
    for (const p of QUERY_POINTS) if (p.cue.test(q) && (!p.intents || p.intents.includes(intent)) && !out.some((x) => x.key === p.key)) out.push(p);
    return out;
  }
  function completenessOf(intent, sentences, extra = {}) {
    const req = requiredFor(intent, extra.q ?? '');
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
      ...typeExtras(c),
    };
  }
  /** 來源卡的型別專屬欄位（media 時間戳、service 步驟數與天數、labtest 檢體表、公告截止） */
  function typeExtras(c) {
    switch (c.type) {
      case 'media': {
        const m = mediaById.get(c.contentId);
        return { mediaType: c.mediaType ?? m?.mediaType ?? 'video', chapter: c.chapter ?? null, t: c.t ?? 0, timeLabel: mmssOf(c.t ?? 0), poster: c.poster ?? m?.poster ?? null, producedAt: c.producedAt ?? m?.producedAt ?? null, basedOnVersionLabel: c.basedOnVersionLabel ?? m?.basedOnVersionLabel ?? null, durationSeconds: c.durationSeconds ?? m?.durationSeconds ?? null };
      }
      case 'service': {
        const sv = serviceById.get(c.contentId);
        return { serviceType: c.serviceType ?? sv?.serviceType ?? null, slug: c.slug ?? sv?.slug ?? null, stepsCount: c.stepsCount ?? sv?.steps?.length ?? null, slaDays: c.slaDays ?? sv?.slaDays ?? null, fee: c.fee ?? sv?.fee ?? null, applyUrl: c.applyUrl ?? sv?.applyUrl ?? null, forms: c.forms ?? sv?.forms ?? [] };
      }
      case 'labtest': return { specimen: c.specimen ?? null, sendWithinHours: c.sendWithinHours ?? null, labs: c.labs ?? [] };
      case 'publication': return { series: c.series ?? null, volume: c.volume ?? null, issue: c.issue ?? null, article: c.article ?? null, cover: c.cover ?? null };
      case 'research': return { year: c.year ?? null, projectStatus: c.projectStatus ?? null, piUnit: c.piUnit ?? null };
      case 'topic': return { links: c.links ?? null };
      case 'job': return { jobStage: jobStageNow(c), hiringUnitName: c.hiringUnitName ?? null, positions: c.positions ?? null, applyStart: c.applyStart ?? null, deadlineAt: c.deadlineAt ?? null, applyHref: c.applyHref ?? null, applyExternal: !!c.applyExternal, hasResult: !!c.hasResult, resultUrl: c.resultUrl ?? null, closed: closedNow(c) };
      case 'tender': return { tenderStage: tenderStageNow(c), tenderNo: c.tenderNo ?? null, requestingUnitName: c.requestingUnitName ?? null, deadlineAt: c.deadlineAt ?? null, openingAt: c.openingAt ?? null, budgetNtd: c.budgetNtd ?? null, pccUrl: c.pccUrl ?? null, closed: closedNow(c) };
      default:
        if (NOTICE_TYPES.includes(c.newsType)) return { newsType: c.newsType, closed: closedNow(c), deadlineAt: c.deadlineAt ?? null, refNo: c.refNo ?? null, applyUrl: c.applyUrl ?? null };
        return {};
    }
  }
  /** 公告是否已截止（建置時標記，或以引擎 today 再算一次） */
  function closedNow(c) {
    if (c.type === 'job') return !['open', 'upcoming'].includes(jobStageNow(c));
    if (c.type === 'tender') return tenderStageNow(c) !== 'open';
    return !!(c.closed || (c.deadlineAt && today && c.deadlineAt < today));
  }
  /** 第七輪：職缺／標案階段以引擎 today 再算一次（索引建置日可能較舊）；與治理引擎 jobStageOf／tenderStageOf 同規則 */
  function todayRt() { return today ?? now().toISOString().slice(0, 10); }
  function jobStageNow(c) {
    if (c.manualStatus) return c.manualStatus;
    if (c.hasResult) return 'result';
    const T = todayRt();
    if (c.applyStart && T < c.applyStart) return 'upcoming';
    if (!c.deadlineAt || T <= c.deadlineAt) return 'open';
    return c.jobStage === 'screening' ? 'screening' : 'closed';
  }
  function tenderStageNow(c) {
    if (c.manualStatus) return c.manualStatus;
    if (c.awarded) return 'awarded';
    const T = todayRt();
    if (!c.deadlineAt || T <= c.deadlineAt) return 'open';
    if (c.openingAt && T >= c.openingAt) return 'opened';
    return 'closed';
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
      items: items.map((i) => ({ ...i, diseaseName: i.diseaseName ?? diseaseById.get(i.disease)?.name ?? i.disease, diseaseNameEn: diseaseById.get(i.disease)?.nameEn ?? null, slug: i.slug ?? diseaseById.get(i.disease)?.slug ?? null })),
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
      else out.push({ text: `${it.diseaseNameEn ?? it.diseaseName}: status "${status}" — ${i18n?.metricLabel ?? it.metricLabel} ${it.metricValue}${i18n?.deltaText ? `, ${i18n.deltaText}` : ''} (data as of ${sit.dataDate}).`, cite: [id], slot: 0, score: 9 });
      if (it.basis && lang === 'zh-TW') out.push({ text: `判定依據：${it.basis}。`, cite: [id], slot: 0, score: 8 });
      const adv = i18n?.advice ?? it.advice;
      if (adv) out.push({ text: lang === 'zh-TW' ? `建議：${adv}。` : `Advice: ${adv}.`, cite: [id], slot: 1, score: 8 });
    }
    return { sentences: out, sources: srcs };
  }

  // ── 旅遊疫情建議等級（結構化快照，只轉述不推論） ──
  const LEVEL_LABEL = { 1: '注意（Watch）', 2: '警示（Alert）', 3: '警告（Warning）' };
  const LEVEL_ZH = { 1: '一', 2: '二', 3: '三' };
  function travelFor(entities) {
    // 等級一律以「依國家彙整」的等級表（country-epid-level，Diseases[]）為準；近 30 天消息只當新聞，不拿來推等級。
    const out = [];
    for (const c of entities.countries) {
      const iso = String(c.id ?? '').toUpperCase();
      const hits = travelItems.filter((t) => t.iso2 === iso || (t.name && t.name === c.name));
      const table = hits.filter((h) => h.aggregate);
      const news = hits.filter((h) => !h.aggregate);
      if (!hits.length) continue;
      let entries; let background = [];
      if (table.length) {
        const row = table[0];
        // 背景提醒（ARCHITECTURE 12.1：同病同級涵蓋 ≥ 50% 國家，如新冠併發重症第一級）不逐病列，另成一句全球背景提醒
        const details = row.details ?? [];
        background = details.filter((d) => d.background).map((d) => ({ level: d.level, levelLabel: d.levelLabel, disease: d.disease, date: d.date }));
        entries = details.filter((d) => !d.background).map((d) => ({ level: d.level, levelLabel: d.levelLabel, diseaseNames: [d.disease].filter(Boolean), date: d.date, advice: d.advice ?? null, area: d.area ?? null }));
        if (!entries.length) entries = [{ level: 0, levelLabel: row.targetedLevelLabel ?? '無針對性旅遊疫情建議', diseaseNames: [], date: row.date, advice: null, none: true, targeted: true }];
      } else {
        entries = news.map((h) => ({ level: h.level, levelLabel: h.levelLabel, diseaseNames: h.diseaseNames, date: h.date, advice: h.advice }));
      }
      out.push({ iso2: iso, name: (table[0] ?? news[0]).name ?? c.name, entries, background, news });
    }
    return out;
  }
  function travelSentences(tr, lang) {
    const sents = []; const srcs = new Map();
    for (const c of tr) {
      const id = `travel#${c.iso2}`;
      const top = c.entries.reduce((a, b) => ((Number(b.level) || 0) > (Number(a.level) || 0) ? b : a));
      const date = c.entries.map((e) => e.date).filter(Boolean).sort().at(-1) ?? null;
      srcs.set(id, { id, contentId: `travel.${c.iso2}`, type: 'travel', title: `旅遊疫情建議 · ${c.name}`, url: `/travel/${c.iso2.toUpperCase()}/`, owner: 'unit.epidemic-intelligence', ownerName: ownerNameOf(units, 'unit.epidemic-intelligence'), reviewedAt: date, isCurrent: true, license: 'OGDL-1.0', lang: 'zh-TW' });
      for (const e of c.entries.slice(0, 4)) {
        if (e.none || !(Number(e.level) > 0)) {
          sents.push({ text: lang === 'zh-TW' ? `${c.name}目前無針對性旅遊疫情建議，請遵守一般預防措施（勤洗手、防蚊、注意飲食衛生）。` : `${c.name}: no targeted travel health notice at present; follow general precautions.`, cite: [id], slot: 0, score: 9 });
          continue;
        }
        const lvl = e.levelLabel ? `「${e.levelLabel}」` : e.level != null ? `第 ${e.level} 級${LEVEL_LABEL[e.level] ? `「${LEVEL_LABEL[e.level]}」` : ''}` : '';
        const dz = e.diseaseNames.join('、') + (e.area ? `，${e.area}` : '');
        sents.push({ text: lang === 'zh-TW' ? `${c.name}${dz ? `（${dz}）` : ''}：旅遊疫情建議${lvl}${e.date ? `，發布日 ${e.date}` : ''}。` : `${c.name}${dz ? ` (${dz})` : ''}: travel notice level ${e.level ?? '-'}${e.date ? `, issued ${e.date}` : ''}.`, cite: [id], slot: 0, score: 9 });
        if (e.advice && lang === 'zh-TW') sents.push({ text: e.advice, cite: [id], slot: 0, score: 8 });
      }
      void top;
    }
    // 全球背景提醒：各國共通，只說一次（放在逐國句之後；answer() 會保留這一句）
    const bg = new Map();
    for (const c of tr) for (const b of c.background ?? []) if (!bg.has(`${b.disease}|${b.level}`)) bg.set(`${b.disease}|${b.level}`, b);
    if (bg.size && tr[0]) {
      const id = `travel#${tr[0].iso2}`;
      const list = [...bg.values()];
      sents.push({
        background: true, cite: [id], slot: 0, score: 7,
        text: lang === 'zh-TW'
          ? `全球背景提醒：${list.map((b) => `${b.disease}第${LEVEL_ZH[b.level] ?? b.level}級${LEVEL_LABEL[b.level] ? `「${LEVEL_LABEL[b.level]}」` : ''}${b.date ? `（${b.date} 起，多數國家皆列）` : ''}`).join('、')}，遵守一般預防措施即可。`
          : `Global background notice: ${list.map((b) => `${b.disease} level ${b.level}`).join(', ')} applies to most countries; follow usual precautions.`,
      });
    }
    return { sentences: sents, sources: srcs };
  }

  // ── 旅遊疫情建議的變化（近 30 天新增／調升／調降／解除；資料為等級表各國 RecentChanges） ──
  const KIND_ZH = { new: '新增', raised: '調升', lowered: '調降', lifted: '解除', renewed: '重新發布' };
  const KIND_EN = { new: 'new', raised: 'raised', lowered: 'lowered', lifted: 'lifted', renewed: 'renewed' };
  function travelChanges(q, lang, days = 30) {
    if (!TRAVEL_CHANGE_RE.test(q)) return null;
    const rows = travelItems.filter((t) => t.aggregate);
    // 新格式等級表（有 Targeted*）一律附事件快照推得的 RecentChanges（無變化的國家不帶此欄）；舊快照沒有變化資料 ⇒ 不回答
    if (!rows.length || !rows.some((r) => Array.isArray(r.recentChanges) || r.targetedLevel != null)) return null;
    const asOf = today ?? now().toISOString().slice(0, 10);
    const since = new Date(Date.parse(`${asOf}T00:00:00Z`) - days * 864e5).toISOString().slice(0, 10);
    const all = rows.flatMap((r) => (r.recentChanges ?? []).map((c) => ({ ...c, iso2: r.iso2, name: r.name }))).filter((e) => e.date <= asOf).sort((a, b) => b.date.localeCompare(a.date));
    const recent = all.filter((e) => e.date >= since);
    const asked = Object.entries(TRAVEL_CHANGE_KINDS).filter(([, re]) => re.test(q)).map(([k]) => k);
    const kinds = asked.length ? asked : ['lifted', 'raised', 'lowered', 'new'];
    const id = 'travel#changes';
    const src = { id, contentId: 'travel.changes', type: 'travel', title: '旅遊疫情建議 · 近期變化', url: '/travel/', owner: 'unit.epidemic-intelligence', ownerName: ownerNameOf(units, 'unit.epidemic-intelligence'), reviewedAt: all[0]?.date ?? null, isCurrent: true, license: 'OGDL-1.0', lang: 'zh-TW' };
    const zh = lang === 'zh-TW';
    const fmt = (e) => `${e.name}${e.Disease ? `（${e.Disease}${e.Area ? `，${e.Area}` : ''}，${e.date}）` : `（${e.date}）`}`;
    const sents = [];
    for (const k of kinds) {
      const hits = recent.filter((e) => e.kind === k);
      if (hits.length) sents.push({ text: zh ? `近 ${days} 天${KIND_ZH[k]}旅遊疫情建議的有：${hits.slice(0, 8).map(fmt).join('、')}${hits.length > 8 ? ` 等 ${hits.length} 則` : ''}。` : `Travel notices ${KIND_EN[k]} in the last ${days} days: ${hits.slice(0, 8).map((e) => `${e.name} (${e.Disease}, ${e.date})`).join('; ')}.`, cite: [id], slot: 0, score: 9 });
      else if (asked.length) {
        const older = all.filter((e) => e.kind === k);
        sents.push({ text: zh ? `近 ${days} 天（${since} 起）沒有${KIND_ZH[k]}的旅遊疫情建議${older.length ? `；較早一則為${fmt(older[0])}` : ''}。` : `No travel notices ${KIND_EN[k]} in the last ${days} days (since ${since}).`, cite: [id], slot: 0, score: 9 });
      }
    }
    const n = (k) => recent.filter((e) => e.kind === k).length;
    sents.push({ text: zh ? `近 ${days} 天變化：新增 ${n('new')}、調升 ${n('raised')}、調降 ${n('lowered')}、解除 ${n('lifted')}；各國現行等級請查目的地。` : `Last ${days} days: ${n('new')} new, ${n('raised')} raised, ${n('lowered')} lowered, ${n('lifted')} lifted.`, cite: [id], slot: 0, score: 8 });
    return { sentences: sents, sources: new Map([[id, src]]) };
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
    const LL = result.lang;
    const qs = q.replace(RUMOR_STRIP, ' ');
    let best = null, bestScore = 0, bestClaim = null;
    for (const c of clarifications) {
      // 不在白名單的澄清只在「已過時」時使用（治理引擎判定依據已修訂，需告知民眾已過時）
      const wl = c.gov?.whitelist?.effective ?? c.governance?.whitelist;
      if (wl === false && !isOutdated(c)) continue;
      const claims = [c.claim, ...(c.claimVariants ?? []), ...(result.lang !== 'zh-TW' ? [c.i18n?.[result.lang]?.claim, c.i18n?.[result.lang]?.title, ...(c.i18n?.[result.lang]?.claimVariants ?? [])] : [])].filter(Boolean);
      for (const claim of claims) { const s = similarity(qs, claim); if (s > bestScore) { bestScore = s; best = c; bestClaim = claim; } }
    }
    result.rumorScore = Math.round(bestScore * 100) / 100;
    if (!best || bestScore < 0.4) {
      result.verdict = 'unknown';
      setRefusal(result, 'no-clarification', 'ref.no-clarification', [{ label: tr(LL, '撥打 1922 詢問', 'Call 1922'), href: 'tel:1922', kind: 'hotline' }, { label: tr(LL, '詐騙請撥 165', 'Scams: call 165'), href: 'tel:165', kind: 'hotline' }, { label: tr(LL, '到澄清專區', 'Fact-check page'), href: '/factcheck/', kind: 'link' }]);
      return result;
    }
    const outdated = isOutdated(best);
    const verdict = outdated ? 'outdated' : best.verdict;
    const i18n = result.lang !== 'zh-TW' ? best.i18n?.[result.lang] : null;
    const revised = (best.gov?.stale ?? best.governance?.stale ?? []).map((s) => ({ revisedAt: s.revisedAt, currentId: s.currentId, currentTitle: s.currentTitle }));
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
      ...(result.shareText ? [{ label: tr(LL, '複製可轉傳短訊', 'Copy shareable message'), kind: 'copy', value: result.shareText }] : []),
      ...(best.reportChannel ? [{ label: tr(LL, `通報：${best.reportChannel}`, `Report: ${best.reportChannel}`), kind: 'info' }] : []),
      { label: tr(LL, '撥打 1922', 'Call 1922'), href: 'tel:1922', kind: 'hotline' },
    ];
    return result;
  }

  // ── 通報時限（結構化回答，不走檢索）：只讀傳染病主檔＋通報時限表 ──
  const NOTIFY_HOW_RE = /(怎麼|如何|流程|方式|哪裡|向誰|找誰|群聚)/;
  const NOTIFY_PERSONAL_RE = new RegExp(`${PERSON}.{0,10}(得了|得到|感染|確診|疑似|好像得|可能得)`);
  function masterSource(d, row, cat) {
    return {
      id: `master.diseases#${d ? d.id : `category-${cat}`}`, contentId: 'master.diseases', type: 'master', lang: 'zh-TW',
      title: '傳染病主檔 · 傳染病防治法公告', subject: d ? d.name : `第${CAT_ZH[cat] ?? cat}類法定傳染病`, basis: '傳染病防治法公告',
      url: `/report/#category-${cat}`, owner: d?.owner ?? 'unit.epidemic-intelligence', ownerName: ownerNameOf(units, d?.owner ?? 'unit.epidemic-intelligence'),
      reviewedAt: null, nextReviewAt: null, isCurrent: true, license: 'OGDL-1.0', mdUrl: null,
      legalCategory: cat, notifyWithinHours: d?.notifyWithinHours ?? null, hoursLabel: d ? notifyHoursLabel(d.notifyWithinHours) : null,
      caseDefinitionUrl: row?.caseDefinitionPath ?? null, labtestUrl: row?.labtestPath ?? null, diseaseUrl: row?.path ?? (d && (d.hasPage || d.page) ? `/diseases/${d.slug}/` : null),
    };
  }
  function notifyAnswer(q, result, entities) {
    const LL = result.lang;
    const picked = []; const sources = []; const items = [];
    const ds = entities.diseases.filter((x) => !x.derived).map((x) => diseaseById.get(x.id)).filter((d) => d && d.legalCategory != null && d.notifyWithinHours != null);
    if (entities.diseases.some((x) => !x.derived) && !ds.length) return null; // 問的是非法定傳染病：交給檢索
    // 沒有疾病、問的是「怎麼通報／群聚通報流程」而非時限或類別 ⇒ 交給檢索（申請服務：群聚通報、法定傳染病通報）
    if (!ds.length && NOTIFY_HOW_RE.test(q) && !/(第\s*[一二三四五1-5]\s*類|幾類|哪一?類|時限|多久|幾小時|幾天)/.test(q)) return null;
    if (ds.length) {
      for (const d of ds.slice(0, 3)) {
        const cat = d.legalCategory; const row = notifyRows.get(d.id) ?? null;
        const src = masterSource(d, row, cat);
        const text = LL === 'zh-TW'
          ? `${d.name}${d.nameEn ? `（${d.nameEn}）` : ''}為第${CAT_ZH[cat] ?? cat}類法定傳染病，應於${hoursPhrase(d.notifyWithinHours)}通報。`
          : `${d.nameEn ?? d.name} is a Category ${cat} notifiable disease and must be reported within ${d.notifyWithinHours} hours.`;
        picked.push({ text, cite: [src.id] }); sources.push(src);
        items.push({ id: d.id, name: d.name, nameEn: d.nameEn ?? null, legalCategory: cat, categoryLabel: `第${CAT_ZH[cat] ?? cat}類`, notifyWithinHours: d.notifyWithinHours, hoursLabel: notifyHoursLabel(d.notifyWithinHours),
          caseDefinitionUrl: src.caseDefinitionUrl, labtestUrl: src.labtestUrl, diseaseUrl: src.diseaseUrl, reportUrl: src.url });
      }
    } else {
      const m = q.match(/第\s*([一二三四五1-5])\s*類/);
      const want = m ? (Number(m[1]) || parseChineseNumber(m[1])) : null;
      const byCat = new Map();
      for (const d of diseases) if (d.legalCategory != null && d.notifyWithinHours != null) { if (!byCat.has(d.legalCategory)) byCat.set(d.legalCategory, []); byCat.get(d.legalCategory).push(d); }
      const cats = [...byCat.keys()].sort((a, b) => a - b).filter((c) => want == null || c === want);
      if (!cats.length) return null;
      for (const cat of cats) {
        const list = byCat.get(cat);
        const counts = new Map(); for (const d of list) counts.set(d.notifyWithinHours, (counts.get(d.notifyWithinHours) ?? 0) + 1);
        const [h0] = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
        const examples = list.filter((d) => d.notifyWithinHours === h0).slice(0, 3).map((d) => d.name).join('、');
        const others = [...counts.keys()].filter((h) => h !== h0).sort((a, b) => a - b).map((h) => {
          const names = list.filter((d) => d.notifyWithinHours === h).map((d) => d.name);
          return `${names.length <= 3 ? names.join('、') : `${names.slice(0, 3).join('、')}等 ${names.length} 種`}應於${hoursPhrase(h)}通報`;
        });
        const src = masterSource(null, null, cat);
        const text = `第${CAT_ZH[cat] ?? cat}類法定傳染病（主檔共 ${list.length} 種，如${examples}）${others.length ? '多數' : ''}應於${hoursPhrase(h0)}通報${others.length ? `；其中${others.join('，')}` : ''}。`;
        picked.push({ text, cite: [src.id] }); sources.push(src);
        items.push({ id: null, name: `第${CAT_ZH[cat] ?? cat}類法定傳染病`, legalCategory: cat, categoryLabel: `第${CAT_ZH[cat] ?? cat}類`, notifyWithinHours: h0, hoursLabel: notifyHoursLabel(h0), count: list.length, reportUrl: src.url });
      }
    }
    const sourceMap = new Map(sources.map((x) => [x.id, x]));
    finalizeSentences(result, picked, sourceMap);
    // 結構化片段也放進 retrieved，讓 grounding 檢核可逐句比對
    result.retrieved = sources.map((x) => { const sents = picked.filter((p) => p.cite[0] === x.id).map((p) => p.text); return { id: x.id, contentId: x.contentId, type: 'master', title: x.title, url: x.url, sentences: sents, text: sents.join(' ') }; });
    const personal = NOTIFY_PERSONAL_RE.test(q);
    result.notify = {
      items, structured: true, source: 'master.diseases', basis: '傳染病防治法公告', personal,
      note: result.view === 'pro' ? null : tr(LL, '法定傳染病由診治醫師依規定通報；民眾發現疑似病例或群聚，請撥打 1922 防疫專線。', 'Notifiable diseases are reported by the attending physician. If you suspect a case or cluster, call the 1922 hotline.'),
    };
    result.confidence = 0.95;
    result.completeness = { required: ['category', 'hours'], covered: ['category', 'hours'], missing: [], score: 1 };
    const a = [];
    if (personal || result.view !== 'pro') a.push({ label: tr(LL, '撥打 1922', 'Call 1922'), href: 'tel:1922', kind: 'hotline' });
    const it = items[0];
    a.push({ label: tr(LL, '前往通報專區', 'Reporting'), href: it?.reportUrl ?? '/report/', kind: 'link' });
    if (it?.caseDefinitionUrl) a.push({ label: tr(LL, `${it.name}病例定義`, `Case definition: ${it.nameEn ?? it.name}`), href: it.caseDefinitionUrl, kind: 'link' });
    if (it?.labtestUrl) a.push({ label: tr(LL, `${it.name}檢驗項目`, `Lab tests: ${it.nameEn ?? it.name}`), href: it.labtestUrl, kind: 'link' });
    if (it?.diseaseUrl && a.length < 4) a.push({ label: tr(LL, `看${it.name}完整頁面`, `${it.nameEn ?? it.name}: full page`), href: it.diseaseUrl, kind: 'link' });
    if (!a.some((x) => x.href === 'tel:1922')) a.push({ label: tr(LL, '撥打 1922', 'Call 1922'), href: 'tel:1922', kind: 'hotline' });
    result.actions = a.slice(0, 4);
    result.related = relatedQuestions(result);
    return result;
  }

  // ── 第七輪：人才招募／採購公告（結構化回答：只讀索引中職缺／標案的結構化句與欄位，不走全文檢索） ──
  // 個資：職缺 chunk 不含 result／waitlistUpdates（index-builder 排除），問「誰錄取」只引用「甄選結果已於…公告，名單只公布報名編號與遮罩姓名」句並給結果頁連結。
  function overviewChunks(type, view) {
    const seen = new Set();
    return poolFor(view, 'zh-TW').chunks.filter((c) => c.type === type && c.block === 'overview' && !seen.has(c.contentId) && seen.add(c.contentId));
  }
  function structuredFinish(result, picked, chunks, extra) {
    const sourceMap = new Map(chunks.map((c) => [c.id, sourceOf(c)]));
    // （已截止）只標在報名期間／投標截止句，避免「已決標（已截止）」之類的重複標示
    const marked = picked.map((p) => (extra.markClosed && closedNow(p.chunk) && /(報名期間|投標截止日)/.test(p.text) && !p.text.includes('已截止') ? { ...p, text: `${p.text}${CLOSED_MARK}`, closed: true } : p));
    finalizeSentences(result, marked, sourceMap);
    for (const s of result.sentences) { const p = marked.find((x) => x.text === s.text); if (p?.closed) s.closed = true; }
    result.retrieved = chunks;
    if (result.lang !== 'zh-TW') result.translationNote = 'showing-source'; // 職缺與標案內容只有中文正本
    result.confidence = 0.9;
    result.completeness = { required: extra.required ?? ['deadline'], covered: extra.required ?? ['deadline'], missing: [], score: 1 };
    result.actions = actionsFor(result, result.entities ?? { diseases: [], vaccines: [], countries: [] }, null);
    if (extra.actions) result.actions = [...extra.actions, ...result.actions.filter((x) => !extra.actions.some((y) => y.href === x.href))].slice(0, 4);
    result.related = [];
    return result;
  }
  const pickSent = (c, re) => (c.sentences ?? []).find((x) => re.test(x));
  function careersAnswer(q, result, view) {
    const LL = result.lang;
    const all = overviewChunks('job', view);
    const focus = all.filter((c) => focusOf(q, c));
    result.focusIds = focus.map((c) => c.contentId);
    // 用人單位、職類只當篩選條件（仍只列開放中）
    const byCat = all.filter((c) => (c.hiringUnitName && q.includes(c.hiringUnitName)) || (c.jobType && q.includes(c.jobType)));
    const careersLink = { label: tr(LL, '看全部職缺', 'All vacancies'), href: '/careers/', kind: 'link' };
    // 問錄取結果：不唸名單，給結果頁連結
    if (ADMIT_RE.test(q)) {
      let pool = (focus.length ? focus : all).filter((c) => c.hasResult || c.resultPlannedAt);
      if (!focus.length) pool = pool.filter((c) => c.hasResult);
      pool.sort((a, b) => (b.hasResult - a.hasResult) || (a.archivedStage - b.archivedStage) || String(b.resultPublishedAt ?? b.resultPlannedAt ?? '').localeCompare(String(a.resultPublishedAt ?? a.resultPlannedAt ?? '')));
      pool = pool.slice(0, 3);
      if (!pool.length) return setRefusal(result, 'no-job-result', 'ref.no-job-result', [careersLink]);
      const picked = pool.map((c) => ({ text: pickSent(c, /甄選結果(已於|預計)/), cite: [c.id], chunk: c, slot: 0, score: 9 })).filter((p) => p.text);
      const items = pool.map((c) => ({ id: c.contentId, title: c.title, url: c.url, resultUrl: c.resultUrl, resultPublishedAt: c.resultPublishedAt ?? null, resultPlannedAt: c.resultPlannedAt ?? null, stage: jobStageNow(c) }));
      result.careers = { mode: 'admitted', structured: true, privacy: true, items, note: tr(LL, '甄選結果只在職缺頁公布報名編號與遮罩姓名，答案不唸出名單。', 'Results list only applicant numbers and masked names on the vacancy page; this answer does not read out the list.') };
      const acts = items.filter((x) => x.resultUrl).slice(0, 2).map((x) => ({ label: tr(LL, `看「${x.title}」甄選結果`, 'See selection result'), href: x.resultUrl, kind: 'link' }));
      result.guards.push({ kind: 'admitted-list-withheld', ids: items.map((x) => x.id) });
      return structuredFinish(result, picked, pool, { required: ['result-link'], actions: [...acts, careersLink], markClosed: false });
    }
    // 指名職缺並問薪資：職缺概要句＋薪資句
    if (focus.length && /(薪水|薪資|待遇|薪點|月薪|多少錢|起薪)/.test(q)) {
      const pickedS = [];
      for (const c of focus.slice(0, 3)) for (const t of [pickSent(c, /用人，職類為/), pickSent(c, /薪資待遇/)]) if (t) pickedS.push({ text: t, cite: [c.id], chunk: c, slot: 0, score: 9 });
      result.careers = { mode: 'focus', structured: true, items: focus.slice(0, 3).map((c) => ({ id: c.contentId, title: c.title, url: c.url, stage: jobStageNow(c) })) };
      return structuredFinish(result, pickedS, focus.slice(0, 3), { required: ['salary'], markClosed: true });
    }
    if (CAREERS_DETAIL_RE.test(q)) return null; // 資格、薪資、應備文件…：走檢索組句
    const openOf = (arr) => arr.filter((c) => jobStageNow(c) === 'open');
    let list = focus.length ? focus : openOf(byCat).length ? openOf(byCat) : openOf(all);
    if (!focus.length && byCat.length && !openOf(byCat).length && list.length) result.guards.push({ kind: 'category-no-open', fallback: 'all-open' });
    if (!list.length) {
      result.careers = { mode: 'list', structured: true, items: [], upcoming: all.filter((c) => jobStageNow(c) === 'upcoming').map((c) => ({ id: c.contentId, title: c.title, url: c.url, applyStart: c.applyStart, deadlineAt: c.deadlineAt })) };
      return setRefusal(result, 'no-open-job', 'ref.no-open-job', [careersLink]);
    }
    list = [...list].sort((a, b) => String(a.deadlineAt).localeCompare(String(b.deadlineAt)) || a.contentId.localeCompare(b.contentId)).slice(0, 5);
    const picked = [];
    for (const c of list) {
      const s1 = pickSent(c, /用人，職類為/); const s2 = pickSent(c, /報名期間/);
      for (const t of [s1, s2]) if (t) picked.push({ text: t, cite: [c.id], chunk: c, slot: 0, score: 9 });
      if (focus.length && !['open', 'upcoming'].includes(jobStageNow(c))) { const s3 = pickSent(c, /甄選結果(已於|預計)|已停止甄選|已補實/); if (s3) picked.push({ text: s3, cite: [c.id], chunk: c, slot: 0, score: 9 }); }
    }
    result.careers = { mode: focus.length ? 'focus' : 'list', structured: true, items: list.map((c) => ({ id: c.contentId, title: c.title, hiringUnitName: c.hiringUnitName, positions: c.positions, applyStart: c.applyStart, deadlineAt: c.deadlineAt,
      daysLeft: c.deadlineAt ? Math.round((Date.parse(c.deadlineAt) - Date.parse(todayRt())) / 864e5) : null, url: c.url, applyHref: c.applyHref ?? null, applyExternal: !!c.applyExternal, stage: jobStageNow(c) })) };
    return structuredFinish(result, picked, list, { required: ['deadline'], markClosed: true });
  }
  function procurementAnswer(q, result, view) {
    const LL = result.lang;
    const all = overviewChunks('tender', view);
    const focus = all.filter((c) => focusOf(q, c));
    result.focusIds = focus.map((c) => c.contentId);
    const listLink = { label: tr(LL, '看全部採購公告', 'All procurement notices'), href: '/procurement/', kind: 'link' };
    if (PROCUREMENT_DETAIL_RE.test(q)) return null;
    const wantAward = /(決標|得標|流標|廢標)/.test(q) && !focus.length;
    let list = focus.length ? focus : wantAward ? all.filter((c) => ['awarded', 'failed', 'cancelled'].includes(tenderStageNow(c))) : all.filter((c) => tenderStageNow(c) === 'open');
    if (!list.length) return setRefusal(result, 'no-open-tender', 'ref.no-open-tender', [listLink]);
    list = [...list].sort((a, b) => (wantAward ? String(b.awardDate ?? b.deadlineAt).localeCompare(String(a.awardDate ?? a.deadlineAt)) : String(a.deadlineAt).localeCompare(String(b.deadlineAt))) || a.contentId.localeCompare(b.contentId)).slice(0, 5);
    const picked = [];
    for (const c of list) {
      const sents = wantAward ? [pickSent(c, /已於 .* 決標|流標|已取消/), pickSent(c, /案號/)] : [pickSent(c, /案號/), pickSent(c, /投標截止日/), ...(focus.length ? [pickSent(c, /已於 .* 決標|流標|已取消/)] : [])];
      for (const t of sents) if (t) picked.push({ text: t, cite: [c.id], chunk: c, slot: 0, score: 9 });
    }
    result.procurement = { mode: focus.length ? 'focus' : wantAward ? 'award' : 'list', structured: true, items: list.map((c) => ({ id: c.contentId, title: c.title, tenderNo: c.tenderNo, requestingUnitName: c.requestingUnitName, budgetNtd: c.budgetNtd, deadlineAt: c.deadlineAt, openingAt: c.openingAt, url: c.url, pccUrl: c.pccUrl ?? null, stage: tenderStageNow(c) })) };
    return structuredFinish(result, picked, list, { required: ['deadline'], markClosed: !wantAward });
  }

  // ── 拒答 ──
  function setRefusal(result, kind, ruleId, actions = null) {
    const LL = result.lang;
    const copy = refusalCopy(kind, result.lang);
    const d = diseaseById.get(result.disease);
    const related = [];
    if (d && (d.hasPage || d.page) && !['prompt-injection', 'harmful', 'privacy', 'media', 'impersonation', 'opinion'].includes(kind)) {
      related.push({ label: tr(LL, `${d.name}：症狀與警示徵象`, `${d.nameEn ?? d.name}: symptoms and warning signs`), href: `/diseases/${d.slug}/#symptoms` });
      related.push({ label: tr(LL, `${d.name}：我該怎麼辦`, `${d.nameEn ?? d.name}: what to do`), href: `/diseases/${d.slug}/#what-to-do` });
    }
    const baseActions = {
      emergency: [{ label: tr(LL, '撥打 119', 'Call 119'), href: 'tel:119', kind: 'hotline' }, { label: tr(LL, '撥打 1922', 'Call 1922'), href: 'tel:1922', kind: 'hotline' }],
      media: [{ label: tr(LL, '聯絡公關室', 'Public Relations Office'), href: '/about/#pr', kind: 'link' }],
      forecast: [{ label: tr(LL, '看疫情態勢', 'Current situation'), href: '/situation/', kind: 'link' }, { label: tr(LL, '看開放資料與統計', 'Open data & statistics'), href: '/data/', kind: 'link' }],
      'prompt-injection': [{ label: tr(LL, '重新提問', 'Ask again'), href: '/ask/', kind: 'link' }],
      impersonation: [{ label: tr(LL, '看最新新聞稿', 'Latest press releases'), href: '/news/', kind: 'link' }],
      opinion: [{ label: tr(LL, '民意信箱', 'Public opinion mailbox'), href: 'https://www.cdc.gov.tw/Mailbox/Index', kind: 'external' }],
    };
    result.refused = true;
    result.refusal = {
      kind, ruleId, title: copy.title, text: copy.text,
      actions: actions ?? baseActions[kind] ?? [{ label: tr(LL, '撥打 1922', 'Call 1922'), href: 'tel:1922', kind: 'hotline' }],
      relatedDisease: d ? { id: d.id, name: d.name, slug: d.slug } : null, related,
    };
    if (!result.refusal.actions.some((a) => a.href === 'tel:1922') && !['prompt-injection', 'impersonation', 'no-open-job', 'no-job-result', 'no-open-tender'].includes(kind)) result.refusal.actions.push({ label: tr(LL, '撥打 1922', 'Call 1922'), href: 'tel:1922', kind: 'hotline' });
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
    const LL = result.lang;
    const a = [];
    const d = diseaseById.get(result.disease);
    const peak = sit?.items?.some((i) => i.status === 'peak');
    const vacc = entities.vaccines[0] ? vaccines.find((v) => v.id === entities.vaccines[0].id) : null;
    switch (result.intent) {
      case 'symptoms':
        if (d) a.push({ label: tr(LL, `看${d.name}警示徵象`, `Warning signs of ${d.nameEn ?? d.name}`), href: `/diseases/${d.slug}/#symptoms`, kind: 'link' });
        a.push({ label: tr(LL, '撥打 1922', 'Call 1922'), href: 'tel:1922', kind: 'hotline' });
        break;
      case 'vaccine':
        if (ANTIVIRAL_RE.test(result.query ?? '')) a.push({ label: tr(LL, '查附近有流感抗病毒藥劑的院所', 'Find clinics with flu antivirals'), href: vaxmapHref('antiviral', LL), kind: 'external' });
        else if (vacc && !VAXMAP_GROUP_OF[vacc.id]) a.push({ label: tr(LL, '接種資訊（vaxmap）', 'Vaccination info (vaxmap)'), href: vaxmapHref(null, LL, { info: true, anchor: 'where' }), kind: 'external' });
        else a.push({ label: tr(LL, '查附近接種點', 'Find a vaccination site'), href: vaxmapHref(VAXMAP_GROUP_OF[vacc?.id] ?? VAXMAP_GROUP_OF_DISEASE[result.disease] ?? null, LL), kind: 'external' });
        if (vacc?.slug) a.push({ label: tr(LL, `看${vacc.name ?? vacc.title}公費對象`, `Who is eligible: ${vacc.nameEn ?? vacc.name ?? vacc.title}`), href: `/vaccines/${vacc.slug}/`, kind: 'link' });
        else a.push({ label: tr(LL, '看疫苗與預防接種', 'Vaccines & immunization'), href: '/tasks/vaccines/', kind: 'link' });
        break;
      case 'travel': {
        const c = entities.countries[0];
        a.push({ label: c ? tr(LL, `查${c.name}疫情等級`, `Travel notice: ${c.name}`) : tr(LL, '查目的地疫情等級', 'Destination travel notice'), href: c ? `/travel/${String(c.id).toUpperCase()}/` : '/travel/', kind: 'link' });
        a.push({ label: tr(LL, '找旅遊醫學門診', 'Find a travel medicine clinic'), href: 'https://www.cdc.gov.tw/Category/Page/ZgM7vwV3n6vDbXpq3MNgKg', kind: 'external' });
        break;
      }
      case 'situation':
        a.push({ label: tr(LL, '看完整趨勢', 'See full trend'), href: '/situation/', kind: 'link' });
        if (sit?.items?.some((i) => i.disease === 'disease.influenza')) {
          a.push({ label: tr(LL, '查附近流感疫苗接種點', 'Find a flu vaccination site'), href: vaxmapHref('flu', LL), kind: 'external' });
          a.push({ label: tr(LL, '查附近有抗病毒藥劑的院所', 'Find clinics with flu antivirals'), href: vaxmapHref('antiviral', LL), kind: 'external' });
          a.push({ label: tr(LL, '公費抗病毒藥劑使用對象', 'Who gets publicly funded antivirals'), href: '/diseases/influenza/#treatment', kind: 'link' });
        }
        break;
      case 'professional':
        if (d) a.push({ label: tr(LL, `${d.name}病例定義與通報`, `${d.nameEn ?? d.name}: case definition & reporting`), href: `/pro/diseases/${d.slug}/`, kind: 'link' });
        a.push({ label: tr(LL, '文件版本異動', 'Document version changes'), href: '/documents/', kind: 'link' });
        break;
      case 'notify': // 「怎麼通報」走檢索（群聚通報、法定傳染病通報服務）時
      case 'apply': {
        if (result.intent === 'notify') a.push({ label: tr(LL, '前往通報專區', 'Reporting'), href: '/report/', kind: 'link' });
        const svcSrc = (result.sources ?? []).find((s) => s.type === 'service');
        const sv = svcSrc ? serviceById.get(svcSrc.contentId) : null;
        const slug = svcSrc?.slug ?? sv?.slug ?? null;
        const forms = (svcSrc?.forms?.length ? svcSrc.forms : sv?.forms) ?? [];
        const applyUrl = svcSrc?.applyUrl ?? sv?.applyUrl ?? null;
        if (svcSrc) a.push({ label: tr(LL, '前往申請頁', 'Go to application page'), href: slug ? `/apply/${slug}/` : String(svcSrc.url).replace(/#.*$/, ''), kind: 'link' });
        if (forms[0]?.href) a.push({ label: tr(LL, '下載表單', 'Download form'), href: forms[0].href, kind: /^https?:/.test(forms[0].href) ? 'external' : 'link', format: forms[0].format ?? null });
        if (applyUrl) a.push({ label: tr(LL, '線上申請', 'Apply online'), href: applyUrl, kind: /^https?:/.test(applyUrl) ? 'external' : 'link' });
        if (!svcSrc) a.push({ label: tr(LL, '看全部申請項目', 'All applications & services'), href: '/apply/', kind: 'link' });
        break;
      }
      case 'lab': {
        const lt = (result.sources ?? []).find((s) => s.type === 'labtest');
        if (lt) a.push({ label: tr(LL, `看${lt.title.split(' · ')[0]}`, 'See lab test details'), href: String(lt.url).replace(/#.*$/, ''), kind: 'link' });
        if (result.view !== 'pro') a.push({ label: tr(LL, '以專業模式查詢', 'Ask in professional mode'), href: `/ask/?q=${encodeURIComponent(result.query)}&view=pro`, kind: 'link' });
        a.push({ label: tr(LL, '檢驗專區', 'Laboratory testing'), href: '/lab/', kind: 'link' });
        a.push({ label: tr(LL, '檢驗委託申請', 'Request lab testing'), href: '/apply/', kind: 'link' });
        break;
      }
      case 'notice': {
        const open = (result.sources ?? []).find((s) => NOTICE_TYPES.includes(s.newsType) && !s.closed && s.applyUrl);
        a.push({ label: tr(LL, '看全部公告', 'All notices'), href: '/notices/', kind: 'link' });
        if (open) a.push({ label: tr(LL, open.newsType === 'procurement' ? '前往投標網站' : '前往報名網站', 'Apply / bid'), href: open.applyUrl, kind: /^https?:/.test(open.applyUrl) ? 'external' : 'link' });
        break;
      }
      case 'careers': {
        const jobSrc = (result.sources ?? []).find((s) => s.type === 'job');
        if (jobSrc?.jobStage === 'open' && jobSrc.applyHref) a.push({ label: tr(LL, jobSrc.applyExternal ? '前往報名網站' : '線上報名', 'Apply'), href: jobSrc.applyHref, kind: /^https?:/.test(jobSrc.applyHref) ? 'external' : 'link' });
        if (jobSrc) a.push({ label: tr(LL, '看職缺詳情', 'Vacancy details'), href: String(jobSrc.url).replace(/#.*$/, ''), kind: 'link' });
        a.push({ label: tr(LL, '看全部職缺', 'All vacancies'), href: '/careers/', kind: 'link' });
        return a.slice(0, 4); // 招募問題不附 1922
      }
      case 'procurement': {
        const tSrc = (result.sources ?? []).find((s) => s.type === 'tender');
        if (tSrc) a.push({ label: tr(LL, '看標案詳情', 'Tender details'), href: String(tSrc.url).replace(/#.*$/, ''), kind: 'link' });
        if (tSrc?.pccUrl && tSrc.tenderStage === 'open') a.push({ label: tr(LL, '政府電子採購網', 'Government e-Procurement System'), href: tSrc.pccUrl, kind: 'external' });
        a.push({ label: tr(LL, '看全部採購公告', 'All procurement notices'), href: '/procurement/', kind: 'link' });
        return a.slice(0, 4);
      }
      case 'stats':
        if (result.stats) a.push({ label: tr(LL, '下載資料集', 'Download dataset'), href: result.sources[0]?.url, kind: 'external' });
        a.push({ label: tr(LL, '開放資料與統計', 'Open data & statistics'), href: '/data/', kind: 'link' });
        break;
      default:
        if (d) a.push({ label: tr(LL, `看${d.name}完整頁面`, `${d.nameEn ?? d.name}: full page`), href: `/diseases/${d.slug}/`, kind: 'link' });
    }
    if (peak || result.intent === 'symptoms') { if (!a.some((x) => x.href === 'tel:1922')) a.unshift({ label: tr(LL, '撥打 1922', 'Call 1922'), href: 'tel:1922', kind: 'hotline' }); }
    else if (!a.some((x) => x.href === 'tel:1922')) a.push({ label: tr(LL, '撥打 1922', 'Call 1922'), href: 'tel:1922', kind: 'hotline' });
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
    const all = model.docs.map((d) => ({ c: d.c, s: bm25Score(model, d, qw) })).sort((a, b) => b.s - a.s);
    const topS = all[0]?.s ?? 0;
    const scored = all.filter((x) => x.s > 0.5 && x.s >= topS * 0.25);
    const out = []; const seen = new Set();
    for (const { c, s } of scored) {
      if (seen.has(c.contentId) || c.isCurrent === false) continue;
      seen.add(c.contentId);
      out.push({ id: c.contentId, title: c.docTitle ?? c.title.split(' · ')[0], summary: c.summary ?? c.sentences?.[0] ?? '', url: c.url.replace(/#.*$/, ''), reviewedAt: c.reviewedAt, ownerName: c.ownerName, type: c.type, score: Math.round(s * 100) / 100 });
      if (out.length >= n) break;
    }
    return out;
  }

  /**
   * 申請「怎麼辦」：以最相關申請服務的步驟塊為主體（每步一句，依序），再補應備文件、（問到時）天數／費用。
   * 句子仍逐字出自索引片段；步驟塊不在檢索結果時從同一索引池取出並列入 retrieved。
   */
  const APPLY_HOW = /(怎麼|如何|流程|步驟|程序|方式|怎樣|去哪|哪裡)/;
  function applyCompose(q, chunks, picked, view, sourceMap, result) {
    const top = chunks.find((c) => c.type === 'service');
    if (!top || !APPLY_HOW.test(q)) return picked;
    const pool = poolFor(view, 'zh-TW').chunks;
    const get = (key) => chunks.find((c) => c.id === `${top.contentId}#${key}`) ?? pool.find((c) => c.id === `${top.contentId}#${key}`);
    const steps = get('steps');
    if (!steps) return picked;
    const use = (c) => { if (!sourceMap.has(c.id)) { sourceMap.set(c.id, sourceOf(c)); result.retrieved = [...(result.retrieved ?? []), c]; } return c; };
    const out = steps.sentences.slice(0, 5).map((t, i) => ({ text: t, cite: [use(steps).id], slot: 0, score: 9 - i * 0.01, chunk: steps }));
    const docs = get('documents');
    if (docs && !/(幾天|多久|費用|多少錢)/.test(q)) out.push({ text: docs.sentences[0], cite: [use(docs).id], slot: 1, score: 8, chunk: docs });
    const sla = get('sla');
    if (sla && /(幾天|多久|費用|多少錢|收費|免費)/.test(q)) for (const t of sla.sentences.filter((x) => /(天|費)/.test(x)).slice(0, 2)) out.push({ text: t, cite: [use(sla).id], slot: 1, score: 8, chunk: sla });
    result.guards.push({ kind: 'apply-steps', id: steps.id });
    return out.slice(0, 7);
  }

  /**
   * 公告列表：沒問細節（資格、名額、預算…）時，每則公告取一句「截止日」結構化句；進行中在前（依截止日），已截止在後。
   */
  const NOTICE_DETAIL = /(資格|條件|名額|預算|金額|字號|案號|待遇|薪|工作內容|地點|怎麼報名|如何報名|怎麼投標)/;
  function noticeCompose(q, chunks, picked) {
    if (NOTICE_DETAIL.test(q)) return picked;
    const ns = chunks.filter((c) => NOTICE_TYPES.includes(c.newsType) && c.deadlineAt);
    if (!ns.length) return picked;
    ns.sort((a, b) => (closedNow(a) - closedNow(b)) || (closedNow(a) ? b.deadlineAt.localeCompare(a.deadlineAt) : a.deadlineAt.localeCompare(b.deadlineAt)));
    const out = [];
    for (const c of ns.slice(0, 4)) {
      const t = (c.sentences ?? []).find((x) => x.includes(c.deadlineAt));
      if (t) out.push({ text: t, cite: [c.id], slot: 0, score: 9, chunk: c });
    }
    return out.length ? out : picked;
  }

  /**
   * 公告句後處理：
   *  - notice 意圖：每則被引用的公告至少帶出一句截止日句（索引建置時產生的結構化句）；
   *  - 任何意圖：出自已截止公告的句子加「（已截止）」（以引擎 today 再算一次，避免索引過期）。
   */
  function markNotices(picked, result) {
    const out = [...picked];
    if (result.intent === 'notice') {
      const seen = new Set();
      for (const p of picked) {
        const c = p.chunk; if (!c || !NOTICE_TYPES.includes(c.newsType) || seen.has(c.id)) continue;
        seen.add(c.id);
        if (!c.deadlineAt || out.some((x) => x.chunk?.id === c.id && x.text.includes(c.deadlineAt))) continue;
        const ds = (c.sentences ?? []).find((x) => x.includes(c.deadlineAt));
        if (ds) out.splice(out.indexOf(p), 0, { ...p, text: ds, cite: [c.id], slot: 0, score: p.score + 1 });
      }
    }
    return out.map((p) => {
      const c = p.chunk;
      if (c && (NOTICE_TYPES.includes(c.newsType) || ((c.type === 'job' || c.type === 'tender') && /(報名期間|投標截止日)/.test(p.text))) && closedNow(c)) {
        if (!p.text.includes('已截止')) return { ...p, text: `${p.text}${CLOSED_MARK}`, closed: true };
        return { ...p, closed: true };
      }
      return p;
    });
  }

  // ───────────── answer ─────────────
  function answer(rawQuery, opts = {}) {
    const { lang = 'zh-TW', view = 'public', disease: presetDisease = null, mode, forceIntent = null } = opts;
    const LL = lang;
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
    result.disease = entities.diseases.find((d) => !d.preset && !d.derived)?.id ?? entities.diseases.find((d) => !d.derived)?.id ?? null;
    // 出國：目的地旅遊疫情建議列出的疾病，也作為檢索實體（問泰國 → 帶出登革熱的預防內容）
    if (entities.countries.length && !entities.diseases.length) {
      for (const c of travelFor(entities)) for (const e of c.entries) for (const dn of e.diseaseNames) {
        for (const d of detectEntities(dn).diseases) if (!entities.diseases.some((x) => x.id === d.id)) entities.diseases.push({ ...d, pos: 900, derived: true });
      }
    }
    const range = parseTimeRange(q);
    const hasRange = range.n != null || range.from != null || (range.years.length > 0 && !/(出生|年次|以後|以前|之後|之前|born|sinh năm|sinh)/i.test(q));
    result.timeRange = hasRange ? range : null;

    // 2 意圖
    const ci = classifyIntent(q, { view, hasTimeRange: hasRange, hasDisease: !!result.disease, hasCountry: entities.countries.length > 0 });
    result.intent = ci.intent; result.intentReasons = ci.reasons; result.intentScores = ci.scores;
    if (forceIntent) { result.intent = forceIntent; result.intentReasons.push(`forced.${forceIntent}`); }
    // 第七輪：問句指名某職缺／標案並問細節（「防疫醫師的資格」「官網改版標案的規格」）⇒ careers／procurement
    if (!forceIntent && !['careers', 'procurement', 'rumor', 'stats', 'notify'].includes(result.intent)) {
      if (CAREERS_DETAIL_RE.test(q) && overviewChunks('job', view).some((c) => titleHits(q, c.title) >= 3 || (c.focusTerms ?? []).some((k) => q.includes(k)))) { result.intent = 'careers'; result.intentReasons.push('car.title-match'); }
      else if (PROCUREMENT_DETAIL_RE.test(q) && overviewChunks('tender', view).some((c) => focusOf(q, c))) { result.intent = 'procurement'; result.intentReasons.push('prc.title-match'); }
    }

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
      if (st?.empty) return setRefusal(result, 'no-data', 'ref.no-data', [{ label: tr(LL, '開放資料與統計', 'Open data & statistics'), href: '/data/', kind: 'link' }]);
    }

    // 檢驗（民眾模式）：檢驗項目表只在專業索引 ⇒ 導向專業模式／檢驗專區／疾病頁診斷與治療，不拿民眾片段硬湊
    if (result.intent === 'lab' && view !== 'pro') {
      const dz = diseaseById.get(result.disease);
      const acts = [
        { label: tr(LL, '以專業模式查詢', 'Ask in professional mode'), href: `/ask/?q=${encodeURIComponent(q)}&view=pro`, kind: 'link' },
        { label: tr(LL, '檢驗專區', 'Laboratory testing'), href: dz ? `/lab/${dz.slug}/` : '/lab/', kind: 'link' },
        ...(dz && (dz.hasPage || dz.page) ? [{ label: tr(LL, `看${dz.name}診斷與治療`, `${dz.nameEn ?? dz.name}: diagnosis & treatment`), href: `/diseases/${dz.slug}/#treatment`, kind: 'link' }] : []),
      ];
      return setRefusal(result, 'pro-only', 'ref.lab-pro-only', acts);
    }

    // 通報時限：主檔結構化回答（不走檢索）
    if (result.intent === 'notify') {
      const na = notifyAnswer(q, result, entities);
      if (na) return na;
    }

    // 第七輪：人才招募／採購公告（結構化列表、「誰錄取」只給結果頁連結）；細節問句才走檢索
    if (result.intent === 'careers') { const ca = careersAnswer(q, result, view); if (ca) return ca; }
    if (result.intent === 'procurement') { const pa = procurementAnswer(q, result, view); if (pa) return pa; }

    // 4 檢索（同語言 reviewed 優先，否則中文）
    const k = view === 'pro' ? 10 : 8;
    let chunks = [];
    if (lang !== 'zh-TW') {
      chunks = retrieve(q, { view, lang, k, intent: result.intent, entities, expanded, presetDisease, guards: result.guards });
      if (chunks.length && chunks[0]._score < 2.5) chunks = [];
    }
    if (!chunks.length) {
      chunks = retrieve(q, { view, lang: 'zh-TW', k, intent: result.intent, entities, expanded, presetDisease, guards: result.guards });
      if (lang !== 'zh-TW' && chunks.length) result.translationNote = 'showing-source';
    }
    // 沒有疾病實體時：以最相關片段的疾病為主，不混入其他疾病的片段
    if (!entities.diseases.length && chunks.length && (chunks[0].diseases ?? []).length && !['situation', 'stats', 'rumor'].includes(result.intent)) {
      const dom = new Set(chunks[0].diseases);
      const kept = chunks.filter((c) => !(c.diseases ?? []).length || c.diseases.some((d) => dom.has(d)));
      kept.qWeights = chunks.qWeights; kept.model = chunks.model;
      chunks = kept;
      result.guards.push({ kind: 'dominant-disease', diseases: [...dom] });
    }
    // 第二輪：意圖對應型別有夠相關的片段時，優先只用該型別（apply → service、lab → labtest、notice → 公告）
    //   問句線索：「影片」→ media、「哪一期」→ publication
    const PREFER = { apply: (c) => c.type === 'service', lab: (c) => c.type === 'labtest', notice: (c) => NOTICE_TYPES.includes(c.newsType), notify: (c) => c.type === 'service', careers: (c) => c.type === 'job', procurement: (c) => c.type === 'tender' };
    const preferFn = PREFER[result.intent] ?? (MEDIA_CUE.test(q) ? (c) => c.type === 'media' : RESEARCH_CUE.test(q) ? (c) => c.type === 'research' : PUB_CUE.test(q) ? (c) => c.type === 'publication' : null);
    if (preferFn && chunks.length) {
      const pref = chunks.filter(preferFn);
      if (pref.length && pref[0]._score >= chunks[0]._score * 0.5) {
        // 使用者明說要影片／期刊 ⇒ 只用該型別；意圖推得的偏好 ⇒ 仍保留分數更高的其他片段
        const byCue = !PREFER[result.intent];
        // 「最新的影片」：依製作日排序加權（只轉述欄位，不推論）
        if (byCue && /(最新|新版|重製|最近)/.test(q) && pref[0].type === 'media') {
          const newest = pref.map((c) => c.producedAt ?? '').sort().at(-1);
          for (const c of pref) if (c.producedAt === newest) c._score = Math.round(c._score * 1.3 * 1000) / 1000;
          pref.sort((a, b) => b._score - a._score);
        }
        const kept = [...pref, ...(byCue ? [] : chunks.filter((c) => !preferFn(c) && c._score >= pref[0]._score))].slice(0, k);
        kept.sort((a, b) => b._score - a._score);
        kept.qWeights = chunks.qWeights; kept.model = chunks.model;
        if (kept.length < chunks.length) result.guards.push({ kind: 'prefer-type', intent: result.intent, type: pref[0].type, dropped: chunks.length - kept.length });
        chunks = kept;
      }
    }
    // 第七輪：問句指名某一則職缺／標案 ⇒ 只用那幾則的片段
    if ((result.intent === 'careers' || result.intent === 'procurement') && result.focusIds?.length) {
      const kept = chunks.filter((c) => result.focusIds.includes(c.contentId));
      if (kept.length) { kept.qWeights = chunks.qWeights; kept.model = chunks.model; if (kept.length < chunks.length) result.guards.push({ kind: 'focus', ids: result.focusIds, dropped: chunks.length - kept.length }); chunks = kept; }
    }
    result.retrieved = chunks;

    // 公告意圖但檢索不到任何公告（全部截止、或尚未進白名單）⇒ 不拿無關片段硬湊，導向公告頁
    if (result.intent === 'notice' && !chunks.some((c) => NOTICE_TYPES.includes(c.newsType))) {
      result.list = traditionalList(q, view, lang, 5);
      return setRefusal(result, 'no-source', 'ref.no-notice', [{ label: tr(LL, '看全部公告', 'All notices'), href: '/notices/', kind: 'link' }, { label: tr(LL, '撥打 1922', 'Call 1922'), href: 'tel:1922', kind: 'hotline' }]);
    }

    // 職缺／採購細節問句檢索不到對應型別 ⇒ 導向列表頁，不拿無關片段硬湊
    if ((result.intent === 'careers' && !chunks.some((c) => c.type === 'job')) || (result.intent === 'procurement' && !chunks.some((c) => c.type === 'tender'))) {
      const href = result.intent === 'careers' ? '/careers/' : '/procurement/';
      return setRefusal(result, 'no-source', `ref.no-${result.intent}`, [{ label: tr(LL, result.intent === 'careers' ? '看全部職缺' : '看全部採購公告', result.intent === 'careers' ? 'All vacancies' : 'All procurement notices'), href, kind: 'link' }]);
    }

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
    if (result.intent === 'apply' || result.intent === 'notify') picked = applyCompose(q, chunks, picked, view, sourceMap, result);
    if (result.intent === 'notice') { picked = noticeCompose(q, chunks, picked); if (picked.length) result.confidence = Math.max(result.confidence, 0.6); }
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
        // 全球背景提醒：目的地沒有針對性建議時緊接在「目前無針對性建議」之後；有針對性建議時排在最後（有空位才出現）
        const bgS = ts.sentences.filter((x) => x.background);
        const main = ts.sentences.filter((x) => !x.background).slice(0, 2);
        const noneOnly = tr.every((c) => c.entries.every((e) => e.none));
        picked = (noneOnly ? [...main, ...bgS, ...picked] : [...main, ...picked, ...bgS]).slice(0, 4);
        result.confidence = Math.max(result.confidence, 0.7);
      }
    } else if (result.intent === 'travel') {
      const ch = travelChanges(q, lang);
      if (ch?.sentences.length) {
        result.travelChanges = true;
        for (const [id, src] of ch.sources) sourceMap.set(id, src);
        picked = [...ch.sentences.slice(0, 3), ...picked].slice(0, 4);
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
    if (lowConf && !sitOnly && !(sit && result.intent === 'situation') && !result.travel && !result.travelChanges) {
      result.list = traditionalList(q, view, lang, 8);
      if (result.confidence < 0.3) return setRefusal(result, 'no-source', 'ref.low-confidence', actionsFor(result, entities, sit));
    }
    if (result.intent === 'unknown' && lowConf) {
      result.list = traditionalList(q, view, lang, 8);
      result.fallbackList = true;
    }
    picked = markNotices(picked, result);
    finalizeSentences(result, picked, sourceMap);
    if (!result.sentences.length) return setRefusal(result, 'no-source', 'ref.no-source');
    for (const s of result.sentences) { const p = picked.find((x) => x.text === s.text); if (p?.closed) s.closed = true; }
    result.completeness = completenessOf(result.intent, result.sentences, { situation: !!sit, q });
    result.actions = actionsFor(result, entities, sit);
    // 民眾問「要驗什麼」：導向疾病頁「診斷與治療」區塊（檢驗細節屬專業內容）
    const dz = diseaseById.get(result.disease);
    if (view !== 'pro' && dz && (dz.hasPage || dz.page) && LAB_PUBLIC_RE.test(q)) {
      result.labRedirect = true;
      result.actions = [{ label: tr(LL, `看${dz.name}診斷與治療`, `${dz.nameEn ?? dz.name}: diagnosis & treatment`), href: `/diseases/${dz.slug}/#treatment`, kind: 'link' }, ...result.actions.filter((x) => !x.href?.endsWith('#treatment'))].slice(0, 4);
    }
    // 影片逐字稿引用揭露
    if (result.sources.some((x) => x.type === 'media')) { result.disclosure.transcript = true; result.disclosure.note = tr(LL, '引用自官方影片逐字稿', 'Quoted from official video transcripts'); }
    if (result.sources.some((x) => x.closed)) result.hasClosedNotice = true;
    result.related = relatedQuestions(result);
    return result;
  }

  return {
    answer, retrieve, detectEntities, detectDisease, expandQuery, relatedQuestions, traditionalList,
    classifyIntent: (q, o) => classifyIntent(q, o), maskPII, detectInjection, statsAnswer, situationFor, citeLabelOf, notifyRows,
    get diseaseById() { return diseaseById; },
  };
}

// ───────────────────────── 小工具 ─────────────────────────

function mdPlain(md) {
  return String(md ?? '').replace(/```[\s\S]*?```/g, ' ').replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/^\s*#+\s*/gm, '').replace(/^\s*([-*+]|\d+\.)\s+/gm, '').replace(/[*_`~]+/g, '').replace(/[ \t]+/g, ' ').trim();
}

function normTravel(t) {
  const iso = String(t.iso2 ?? t.ISO2 ?? t.countryCode ?? t.iso ?? t.code ?? t.country_code ?? '').toUpperCase();
  const dn = t.diseaseNames ?? t.diseaseName ?? t.disease_name ?? t.Disease ?? t.disease ?? (Array.isArray(t.diseases) ? t.diseases : null) ?? [];
  return {
    iso2: iso, name: t.countryName ?? t.Country ?? t.nameZh ?? t.name ?? t.country ?? iso, nameEn: t.CountryEn ?? t.nameEn ?? null,
    level: t.LevelCode ?? t.levelCode ?? t.level ?? t.alertLevel ?? t.levelNumber ?? t.severity ?? null,
    levelLabel: t.levelLabel ?? t.Level ?? t.levelName ?? null, diseaseNames: (Array.isArray(dn) ? dn : [dn]).filter((x) => x && typeof x === 'string' && !x.startsWith('disease.')),
    date: t.StartDate ?? t.publishedAt ?? t.updatedAt ?? t.date ?? t.effectiveAt ?? null, advice: t.Summary ?? t.advice ?? t.recommendation ?? null,
    aggregate: Array.isArray(t.Diseases), url: t.Url ?? t.url ?? null,
    // 針對性等級（排除全球背景提醒；ARCHITECTURE 12.1）；舊快照沒有 Targeted* 時退回含背景的等級
    targetedLevel: t.TargetedLevelCode ?? t.targetedLevel ?? null, targetedLevelLabel: t.TargetedLevel ?? t.targetedLevelLabel ?? null,
    targetedDiseases: t.TargetedDisease ? String(t.TargetedDisease).split('、').filter(Boolean) : [], targetedDate: t.TargetedStartDate ?? null,
    details: Array.isArray(t.Diseases) ? t.Diseases.map((d) => ({ disease: d.Disease ?? d.disease ?? null, level: d.LevelCode ?? d.levelCode ?? d.level ?? null, levelLabel: d.Level ?? d.levelLabel ?? null, date: d.StartDate ?? d.date ?? null, area: d.Area ?? d.area ?? null, advice: d.Summary ?? d.advice ?? null, background: d.Background === true || d.background === true })).filter((d) => d.disease) : [],
    recentChanges: Array.isArray(t.RecentChanges) ? t.RecentChanges.filter((c) => c && c.date && c.kind) : undefined,
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

// ───────────────────────── 第二輪小工具 ─────────────────────────

export const NOTICE_TYPES = ['recruit', 'procurement'];
/** 已截止公告句的標記（grounding 檢核時會先去除再比對原文） */
export const CLOSED_MARK = '（已截止）';
const CAT_ZH = { 1: '一', 2: '二', 3: '三', 4: '四', 5: '五' };
/** 通報時限（小時）→ 中文；一週、一個月附小時數 */
export function notifyHoursLabel(h) {
  if (h == null) return '';
  if (h === 168) return '一週（168 小時）內';
  if (h === 720) return '一個月（720 小時）內';
  if (h % 24 === 0 && h > 24) return `${h / 24} 日（${h} 小時）內`;
  return `${h} 小時內`;
}
/** 「應於」後的時限片語：數字開頭前加空白（應於 24 小時內），中文開頭不加（應於一週（168 小時）內） */
function hoursPhrase(h) { const l = notifyHoursLabel(h); return /^\d/.test(l) ? ` ${l}` : l; }
function mmssOf(t) { const n = Math.max(0, Math.round(Number(t) || 0)); return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`; }
/**
 * 通報時限表（治理引擎 site.gov.notifyTable／v1/notify-table.json）→ Map(diseaseId → row)。
 * 容錯：[{legalCategory, diseases:[row]}]（分組）、[row]、{rows|items|data:[…]}、{ [id]: row }；不存在回空 Map。
 */
export function normalizeNotifyTable(t) {
  const out = new Map();
  if (!t) return out;
  let arr = Array.isArray(t) ? t : Array.isArray(t.rows) ? t.rows : Array.isArray(t.items) ? t.items : Array.isArray(t.data) ? t.data : Object.entries(t).map(([id, r]) => ({ id, ...(r && typeof r === 'object' ? r : {}) }));
  arr = arr.flatMap((g) => (Array.isArray(g?.diseases) ? g.diseases.map((r) => ({ legalCategory: g.legalCategory, ...r })) : [g]));
  for (const r of arr) { const id = r?.id ?? r?.disease ?? r?.diseaseId; if (id) out.set(id, r); }
  return out;
}
