// 答案引擎：意圖規則、拒答規則與查無門檻（治理人員最常審的一份；只有資料與規則，沒有檢索邏輯）。第三十四輪自 core.js 拆出，ARCHITECTURE 第 40 章。
import { detectInjection } from './text.js';
import { REFUSAL_TEXT_I18N } from './refusal-i18n.js';

// ───────────────────────── 2. 意圖規則 ─────────────────────────

export const PRO_TERMS = '通報|送驗|檢體|採檢|容器|運送|時限|病例定義|通函|致醫界|手冊|指引|工作手冊|防治手冊|第\\s*[\\d一二三四五六七八九十]+\\s*條|條文|條次|版次|新版|舊版|前版|改版|修訂|生效|快篩陽性|抗病毒藥劑使用對象|使用對象|疑似病例|確定病例|可能病例|檢驗|實驗室|ICD|隔離治療|接觸者|匡列|疫調|疫情調查|醫事人員|醫療院所|感染管制|感控|法定傳染病|傳染病類別|第[一二三四五]類|報告時限';

// 檢驗意圖（lab）只在專業模式、或問句含專業詞時啟用；民眾問「要驗什麼」導向疾病頁「診斷與治療」區塊
export const LAB_PRO_RE = /(檢體|採檢|送驗|檢驗項目|拭子|檢驗單位|採血管|痰(液)?(檢體|抹片|培養)|驗痰|specimen)/i;
export const LAB_PUBLIC_RE = /(要驗什麼|驗什麼|要檢查什麼|做什麼檢查|怎麼驗|怎麼檢查|如何診斷|怎麼診斷|要抽血|需要抽血)/;
// 問句線索 → 型別加權（第二輪：影音、出版品）
export const MEDIA_CUE = /(影片|影音|宣導片|衛教片|動畫|短片|短影音|Podcast|播客|YouTube|video)/i;
export const RESEARCH_CUE = /(研究計畫|研究案|委託研究|成果報告|計畫編號|IRB|研究的?(目標|目的|結果|發現)|這項研究|哪些研究)/;
export const NEWS_CUE = /(新聞|記者會|宣布|公布|當時|去年|前年|歷年|歷史|(?:20\d{2}|1[01]\d)\s*年(?!.{0,6}出生)|press release|announce)/i;
export const HISTORICAL_WEIGHT = 0.4;
export const PUB_CUE = /(哪一期|第幾期|那一期|哪期|期刊|疫情報導|年報|卷|出版品|手冊下載|刊登)/;
export const OPEN_CUE = /(現在|目前|正在|有在|還有|進行中|開放|可以報名|可以投標|最新|最近|近期|還能)/;
export const RECRUIT_CUE = /(招募|徵才|職缺|徵人|約聘|約僱|甄選|甄試|工作機會|缺額|招考|人員)/;
export const PROCUREMENT_CUE = /(採購|標案|招標|投標|決標|公開評選|開標|案號)/;
// 第七輪（ARCHITECTURE 15.1）：人才招募（job）與採購公告（tender）
/** 問「誰錄取／錄取名單／結果」：不唸名單，只給結果頁連結 */
export const ADMIT_RE = /(錄取|正取|備取|遞補|榜單|放榜|上榜|甄選結果|甄試結果|錄用)/;
/** 職缺細節問句（資格、薪資、應備文件、甄試…）⇒ 走檢索組句（仍只用職缺片段） */
export const CAREERS_DETAIL_RE = /(資格|條件|工作內容|做什麼|負責什麼|應備|文件|要準備|要帶|甄試方式|考什麼|筆試|口試|實作|薪水|薪資|待遇|薪點|月薪|多少錢|在哪上班|工作地點)/;
/** 採購細節問句（標的、規格、特別規定、履約）⇒ 走檢索組句 */
export const PROCUREMENT_DETAIL_RE = /(採購標的|標的物|標的是|規格|特別規定|履約|服務期間|交貨|要買什麼|買什麼)/;
/** 職稱比對時去掉的泛用字 */
export const JOB_TITLE_GENERIC_RE = /(徵求|名額|約聘|約僱|聘用|人員|招募|職缺|疾管署|疾病管制署|案|採購|勞務|財物|年度|\d+|[\s（）()「」、，,．.·－-])/g;
/** 問職稱（「防疫醫師」）或用人單位（「疫情中心」）⇒ 聚焦在相符的職缺／標案：title 去泛用字後的雙字片段命中 ≥ 2 個 */
export function titleHits(q, title) {
  const t = String(title ?? '').replace(JOB_TITLE_GENERIC_RE, '');
  const grams = new Set(); for (let i = 0; i + 1 < t.length; i++) grams.add(t.slice(i, i + 2));
  let n = 0; for (const g of grams) if (q.includes(g)) n++;
  return n;
}
/** 問句是否指名某一則職缺／標案：職稱雙字片段命中 ≥ 2，或命中該則的辨識關鍵字（focusTerms，索引建置時由 keywords 去泛用詞） */
export const focusOf = (q, c) => titleHits(q, c.title) >= 2 || (c.focusTerms ?? []).some((k) => q.toLowerCase().includes(String(k).toLowerCase()))
  || (!!c.tenderNo && q.toUpperCase().includes(String(c.tenderNo).toUpperCase()));

/**
 * 第二十五輪（ARCHITECTURE 28.1）：查無門檻。BM25 只要有一個雙字片段撞到就會出分數（「抗蛇毒血清」撞到「病毒血症」），
 * 所以在組句前先驗證「問句的主題詞有沒有被最佳片段涵蓋」；不夠就說站內查無，不硬拼不相關的引用。
 *   minTop：最佳片段 BM25 分數下限（涵蓋率 ≥ highCoverage 時放寬，hardMinTop 為絕對下限）；minCoverage：問句有效詞（依 IDF 加權）被前 3 片段涵蓋的比例下限
 *   （問句已認出病名／疫苗／國家時改用 minCoverageEntity 並略過泛用詞檢查：檢索本身已限定在該實體，雜訊主要來自無實體的問句）；
 *   minMatchedIdf：命中的詞中最稀有者的 IDF（相對於語料最大 IDF 的比例）下限，且涵蓋率低於 genericMaxCoverage（只命中常見泛用詞＝沒命中主題）；
 *   lowBelow：高於拒答線但低於此值 ⇒ UI 顯示「與你的問題相關程度較低」。
 */
export const RELEVANCE = { refChunks: 500, hardMinTop: 3, minTop: 8, highCoverage: 0.85, minCoverage: 0.28, minCoverageEntity: 0, minMatchedIdf: 0.3, genericMaxCoverage: 0.5, lowBelow: 0.6 };

/**
 * 相關度高於拒答線但偏低（UI 顯示「與你的問題相關程度較低」，不再宣稱僅引用官方內容的信心）。
 * 第四十八輪（issue #102）：引擎判定答案切題（result.topicMatch，見 core.js）時不標低相關——
 * 相關度分數是「問句的字被片段涵蓋多少」，口語問句（咳嗽三週了會不會是肺結核，要去哪裡看）字多、涵蓋率天生低，分數低不等於答偏。
 */
export function isLowRelevance(result) { return typeof result?.relevance === 'number' && result.relevance < RELEVANCE.lowBelow && !result.topicMatch; }
/**
 * 第四十八輪（issue #102）：問句的「面向」詞組（費用、就醫、疫苗、症狀、預防、傳染、咬抓傷）。
 * 問句與第一句答案（或它出自的 FAQ 題目、片段標題）落在同一個面向、且講的是同一個疾病 ⇒ 答案切題（topicMatch），不標低相關。
 */
export const QUERY_FACETS = [/(費用|錢|自付|自費|部分負擔|免費|公費|補助|健保)/, /(就醫|看醫生|看病|看診|門診|哪裡看|掛號|胸腔科|醫院)/, /(疫苗|接種|打針|施打|補打|漏打|晚打|才打|打過|打了)/, /(症狀|徵兆|徵象|前兆)/, /(預防|防範|避免)/, /(傳染|傳播|會傳)/, /(咬|抓傷)/];
/** 問句去掉功能詞後才斷詞，避免「苗哪」「裡打」這種跨功能詞的雜訊雙字拉低涵蓋率 */
export const QUERY_FUNC_RE = /(請問|想問|我想知道|可以|怎麼辦|怎麼|怎樣|如何|什麼|哪裡|哪些|哪個|哪一|是否|有沒有|能不能|會不會|需不需要|應該|是不是|告訴我|知道|幫我|一下|的話|為什麼|為何|多少|有哪|[的了嗎呢吧啊是在有沒不也都就還和與及或我你他她它們這那哪要會能請問想誰幾])/g;

/** 旅遊疫情建議「變化」問句（最近哪些國家解除／調升…）；trv.change 意圖規則與 travelChanges 共用 */
export const TRAVEL_CHANGE_KINDS = { lifted: /(解除|取消|撤銷|撤除|\blift(ed)?\b)/i, raised: /(調升|升級|提高|\braised?\b)/i, lowered: /(調降|降級|降低|\blowered\b)/i, new: /(新增|新發布|新列)/ };
export const TRAVEL_CHANGE_RE = /((旅遊疫情建議|旅遊警示|疫情等級|旅遊等級).{0,12}(解除|取消|撤銷|調升|調降|升級|降級|新增|變化|異動|調整)|(解除|取消|撤銷|調升|調降|新增).{0,12}(旅遊疫情建議|旅遊警示|疫情等級)|travel (health )?(notices?|advisor(y|ies)).{0,20}\b(lifted|raised|lowered|changes?)\b)/i;

/**
 * 第四十輪：服務型問句線索（issue #78／#75）。查紀錄、申請、補發、去哪裡拿／辦、某某「在哪裡」（句尾）、英文 where can I get／how do I get。
 * 只認「取得某樣東西」的動詞；「麻疹在哪裡流行」不是服務問句（「在哪裡」必須在句尾或接取得類動詞）。
 */
export const SERVICE_CUE = /(怎麼查|如何查|哪裡查|去哪裡?(查|申請|辦|拿|領|補|索取|下載|取得)|哪裡(可以|能)?(查|申請|辦|拿|領|補|索取|下載|取得)|在哪(裡)?(查|申請|辦|拿|領|補|索取|下載|取得)?\s*[?？]?\s*$|怎麼(申請|取得|拿到|補發|下載|辦理)|如何(申請|取得|補發|下載|辦理)|\bwhere (?:can|do|should) i (?:get|find|apply|obtain|download)\b|\bhow (?:do|can) i (?:get|apply|obtain|find|download)\b)/i;
/** 「去哪裡打疫苗」：找接種點（疫苗意圖＋vaxmap 連結），不當成申請服務 */
export const VAX_WHERE_RE = /((哪裡|哪邊|在哪|去哪).{0,8}(打|接種|施打)|(打|接種|施打).{0,6}(哪裡|哪邊|在哪)|(疫苗|預防針).{0,6}(哪裡|哪邊|在哪)|\bwhere\b.{0,40}\b(vaccin\w*|shots?|jabs?|immuni[sz]\w*)|\b(vaccin\w*|shots?|jabs?)\b.{0,30}\bwhere\b|ở đâu.{0,20}(tiêm|vắc)|(tiêm|vắc[\s-]?xin).{0,30}ở đâu)/i;

/** 第四十八輪（issue #94）：要查的是「紀錄」（打過什麼疫苗、接種紀錄、兒童健康手冊）⇒ 申請服務（紀錄補發），不是找接種點，即使句子也有「疫苗…去哪裡」 */
export const RECORD_RE = /(紀錄|記錄|打過(什麼|哪些|幾劑)|接種過|健康手冊|黃卡)/;

/**
 * 第四十九輪：咬傷／抓傷問句（被鼬獾咬、被狗咬了、咬傷、抓到）。這類問句要的是「被咬了該怎麼做」，
 * 所以「題目或適用情境本身就是咬傷」的答案單元（FAQ 題目、疾病頁 what-to-do 卡片的「如果被動物咬傷或抓傷」）優先（core.js 問句型態錨點）。
 */
export const BITE_RE = /(被.{0,8}(咬|抓)|咬傷|抓傷|咬到|抓到|咬了)/;
/** 咬傷問句點名的動物（犬＝狗）。答案單元的題目／標題點名了別的動物、又沒寫泛稱「動物」⇒ 不拿來回答（被狗咬不引用蛇咬的「五要五不」） */
export const ANIMAL_RE = /(狗|犬|貓|鼬獾|白鼻心|錢鼠|老鼠|蝙蝠|猴|蛇|松鼠)/g;

/**
 * 可解釋意圖規則。每條：{ id, intent, weight, re, note, gate? }。命中加權，最高分者為意圖；分數 < 2 → unknown。
 * view==='pro' 另加 pro.view 規則；gate:'lab' 的規則只在專業模式或含專業詞（LAB_PRO_RE）時計分。
 */
export const INTENT_RULES = [
  // 症狀
  { id: 'sym.symptom-words', intent: 'symptoms', weight: 2, re: /(發燒|發熱|咳嗽|紅疹|起疹|出疹|疹子|拉肚子|腹瀉|嘔吐|頭痛|喉嚨痛|流鼻水|肌肉痠痛|關節痛|後眼窩痛|全身痠痛|倦怠|嗜睡|抽搐|呼吸急促|水泡|口腔潰瘍|黃疸|血便)/, note: '症狀詞' },
  { id: 'sym.symptom-generic', intent: 'symptoms', weight: 2, re: /(症狀|徵象|徵兆|前兆|不舒服|病徵|長什麼樣子?|會怎樣|會怎麼樣|什麼感覺|是什麼樣子)/, note: '症狀泛稱（第四十九輪：「會怎樣」「長什麼樣子」）' },
  { id: 'sym.seek-care', intent: 'symptoms', weight: 3, re: /(要不要看醫生|該不該就醫|何時就醫|什麼時候.{0,4}就醫|幾天內.{0,6}就醫|就醫|看醫生|看診|掛號|急診|回診)/, note: '就醫時機' },
  { id: 'sym.after-travel', intent: 'symptoms', weight: 6, re: /(回國|返國|回台|回來|入境).{0,8}(發燒|出疹|紅疹|起疹|腹瀉|拉肚子|不舒服|症狀|咳嗽)/, note: '返國後症狀' },
  { id: 'sym.what-to-do', intent: 'symptoms', weight: 1, re: /(怎麼辦|該怎麼做|如何處理)/, note: '求助語' },
  { id: 'sym.en', intent: 'symptoms', weight: 3, re: /\b(fever|symptoms?|rash|cough|diarrh?ea|vomit\w*|headache|see a doctor|seek (medical )?care|hospital|clinic)\b/i, note: 'English symptom words' },
  { id: 'sym.vi', intent: 'symptoms', weight: 3, re: /(sốt|triệu chứng|phát ban|ho\b|tiêu chảy|nôn|đi khám|bác sĩ)/i, note: 'Vietnamese symptom words' },
  // 疫苗
  { id: 'vac.vaccine-words', intent: 'vaccine', weight: 3, re: /(疫苗|接種|預防針|施打|追加劑|打針|打一劑|劑次)/, note: '疫苗詞' },
  { id: 'vac.public-funded', intent: 'vaccine', weight: 2, re: /(公費(?!的?(藥|抗病毒|口服))|自費|接種對象|接種時程|接種點|合約院所|幾歲.{0,4}打)/, note: '公費／時程（第四十九輪：「公費的藥」是抗病毒藥，不是疫苗）' },
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
  { id: 'sit.vi', intent: 'situation', weight: 3, re: /(tình hình dịch|dịch bệnh hiện nay|đang bùng phát|nghiêm trọng)/i, note: 'Vietnamese situation words' },
  // 謠言
  { id: 'rum.ask-true', intent: 'rumor', weight: 5, re: /(是真的嗎|真的嗎|是假的|假的嗎|真的假的|是不是真的|可信嗎|謠言|網傳|傳言|聽說|闢謠|查證|假訊息|假新聞|詐騙|這則|這篇|這個訊息|訊息說|LINE\s*(上|群組)?(說|傳)|群組(說|傳)|轉傳|長輩圖|有人說)/i, note: '查證語' },
  { id: 'rum.en', intent: 'rumor', weight: 5, re: /\b(is it true|is this true|is (?:this|that|the) (?:message|news|post|claim|text) true|rumou?r|fake news|hoax|scam|fact[- ]check|i heard that)\b/i, note: 'English rumor words' },
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
  { id: 'car.apply', intent: 'careers', weight: 2, re: /((?<!(受訓|訓練|課程|研習|講習|活動).{0,8})報名|投履歷|應徵|求職|疾管署.{0,6}上班)/, note: '報名（弱：與其他「報名」共用；第四十九輪：受訓／課程的報名不算，「上班」只算「去疾管署上班」——上班族、回去上班是在問自己的健康）' },
  { id: 'car.en', intent: 'careers', weight: 5, re: /\b(jobs?|vacanc(y|ies)|recruit\w*|hiring|careers?|job openings?)\b/i, note: 'English jobs words' },
  { id: 'prc.en', intent: 'procurement', weight: 5, re: /\b(tenders?|procurement|bidding)\b/i, note: 'English procurement words' },
  { id: 'prc.words', intent: 'procurement', weight: 5, re: /(採購|標案|招標|投標|決標|公開評選|開標|案號|流標|得標|廢標|政府電子採購網)/, note: '採購公告（招標、投標、決標）' },
  // ── 第四十輪（issue #70／#75）──
  // 日、他加祿、印尼、泰文的意圖線索：首頁「各語言預設問題」要能被認出意圖（態勢卡、時程主檔、旅遊等級才接得上）。只是加權線索，不翻譯問句。
  { id: 'sit.ml', intent: 'situation', weight: 3, re: /(深刻|流行状況|感染状況|\bmalala\b|\bsitwasyon\b|\bparah\b|\bsituasi\b|\bwabah\b|รุนแรง|สถานการณ์|ระบาด)/i, note: '日／他加祿／印尼／泰文：嚴重、疫情狀況' },
  { id: 'vac.ml', intent: 'vaccine', weight: 3, re: /(ワクチン|予防接種|\bbakuna\b|\bmagpabakuna\b|\bvaksin\w*|\bimunisasi\b|วัคซีน)/i, note: '日／他加祿／印尼／泰文：疫苗' },
  { id: 'trv.ml', intent: 'travel', weight: 3, re: /(旅行|渡航|\bbiyahe\b|\bpaglalakbay\b|\bperjalanan\b|\bbepergian\b|เดินทาง|ไปต่างประเทศ)/i, note: '日／他加祿／印尼／泰文：旅遊' },
  { id: 'rum.ml', intent: 'rumor', weight: 5, re: /(本当ですか|デマ|うわさ|\btotoo ba\b|\btsismis\b|pekeng balita|\bapakah\b.{0,30}\bbenar\b|\bhoaks\b|จริงหรือไม่|จริงไหม|ข่าวปลอม)/i, note: '日／他加祿／印尼／泰文：是真的嗎' },
  // 第四十輪（issue #78／#75）：服務型問句「怎麼查／怎麼申請／去哪裡拿／在哪裡／how do I get」⇒ 申請服務（services）優先。
  // 「去哪裡打疫苗」是找接種點，不是申請服務 ⇒ 由 VAX_WHERE_RE 排除，留在疫苗意圖（actions 帶接種點地圖、答案帶地點句）。
  { id: 'svc.where-how', intent: 'apply', weight: 4, test: (q) => SERVICE_CUE.test(q) && (!VAX_WHERE_RE.test(q) || RECORD_RE.test(q)), note: '服務型問句（怎麼查、怎麼申請、去哪裡拿、在哪裡、how do I get）；問去哪裡打疫苗除外（查接種紀錄不算）' },
];
/** 專業子意圖（專業模式下不被 professional 覆寫） */
export const PRO_SUB_INTENTS = ['apply', 'lab', 'notify', 'notice', 'careers', 'procurement'];

export const INTENT_PRIORITY = ['rumor', 'stats', 'notify', 'careers', 'procurement', 'notice', 'apply', 'lab', 'professional', 'situation', 'travel', 'vaccine', 'symptoms'];

/** 意圖判斷：回傳 { intent, reasons[], scores{} } */
/** 第四十九輪：解釋型問句（定義、原因、代表什麼） */
export const EXPLAIN_RE = /(是什麼|是指什麼|指的是|在算什麼|算什麼|什麼意思|的意思|為什麼|為何|是不是代表|代表什麼|怎麼算|定義)/;
export function classifyIntent(q, { view = 'public', hasTimeRange = false, hasDisease = false, hasCountry = false } = {}) {
  const scores = {}; const reasons = [];
  // 研究計畫問句（「血清抗體盛行率研究」）不是在問送驗規定，除非明講檢體／送驗／採檢
  const labGate = (view === 'pro' || LAB_PRO_RE.test(q)) && !(RESEARCH_CUE.test(q) && !/(檢體|送驗|採檢|容器)/.test(q));
  // 刊名「疫情報導」不是在問疫情現況（出版品問句交給檢索與 PUB_CUE 型別加權）
  const qi = q.replace(/疫情報導/g, '期刊');
  if (qi !== q) reasons.push('pub.bulletin-name');
  for (const r of INTENT_RULES) {
    if (r.gate === 'lab' && !labGate) continue;
    if (r.test ? r.test(qi) : r.re.test(qi)) { scores[r.intent] = (scores[r.intent] ?? 0) + r.weight; reasons.push(r.id); }
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
  // 第四十九輪：問「是什麼／為什麼／代表什麼」是要解釋，不是要數字（「就診率是在算什麼」「流感疫苗為什麼每年打」）；問句另有數量詞或時間範圍才仍算統計
  if (scores.stats && !hasTimeRange && EXPLAIN_RE.test(q) && !/(幾例|多少例|多少人|病例數|個案數|人數|數據|趨勢|統計)/.test(q)) { scores.stats = 0; reasons.push('sta.explain'); }
  let best = 'unknown', bestScore = 0;
  for (const intent of INTENT_PRIORITY) { const s = scores[intent] ?? 0; if (s > bestScore) { best = intent; bestScore = s; } }
  if (bestScore < 2) { best = 'unknown'; if (hasDisease) reasons.push('unk.disease-only'); }
  // 專業模式：除謠言、統計、疫情外，一律以專業意圖回答（引用條次與版次，不白話化）
  if (view === 'pro' && !['rumor', 'stats', 'situation', 'professional', ...PRO_SUB_INTENTS].includes(best)) { best = 'professional'; reasons.push('pro.view-override'); }
  return { intent: best, reasons, scores };
}

// ───────────────────────── 3. 拒答規則 ─────────────────────────

export const PERSON = '(我|我的|本人|小孩|孩子|小朋友|兒子|女兒|寶寶|嬰兒|媽媽|爸爸|阿公|阿嬤|爺爺|奶奶|家人|老公|老婆|先生|太太|男友|女友|朋友|同事|室友|鄰居|學生)';
export const DRUGS = '(普拿疼|乙醯胺酚|阿斯匹靈|布洛芬|ibuprofen|克流感|tamiflu|瑞樂沙|速克流|抗生素|退燒藥|止痛藥|消炎藥|類固醇|伊維菌素|奎寧|抗病毒藥)';

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
  { id: 'ref.privacy.admitted', kind: 'privacy', re: /(錄取|正取|備取|遞補|上榜|應考|考生|報名者).{0,12}(住哪|住在|地址|電話|手機|身分證|生日|幾歲|年紀|全名|真名|本名|完整姓名|學校|畢業|臉書|IG|照片)/, note: '錄取者個資（只公布報名編號，不公布姓名）' },
];

export const REFUSAL_TEXT = {
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
    'no-match': { title: '站內查無直接答案', text: '本站目前沒有內容直接回答這個問題，為避免拿不相關的內容充數，我不勉強作答。你可以撥打 1922 防疫專線詢問，或從傳染病索引、網站導覽找找看。' },
    'no-clarification': { title: '目前沒有對應的官方澄清', text: '目前沒有與這則訊息對應的官方澄清。請先不要轉傳；可撥打 1922 詢問，或透過本頁回報讓我們查證。' },
    'no-data': { title: '找不到對應的統計資料', text: '資料目錄中沒有可直接回答的統計序列。你可以到開放資料平台查詢原始資料集。' },
    'pro-only': { title: '檢驗與送驗規定屬專業內容', text: '檢體採集、容器、保存運送與送驗時限是給醫療院所與檢驗人員的專業內容，請切換專業模式或到檢驗專區查詢。想了解疾病怎麼診斷，可看疾病頁「診斷與治療」。' },
    'no-open-job': { title: '目前沒有開放報名的職缺', text: '疾管署目前沒有報名中的職缺。即將開放、審查中與歷次錄取結果請看「人才招募」頁，也可訂閱人才招募 RSS。' },
    'no-job-result': { title: '目前沒有已公告的甄選結果', text: '目前沒有已公告甄選結果的職缺。甄選結果只在各職缺頁公布報名編號（不公布姓名），答案不會唸出名單。' },
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
    'no-match': { title: 'No direct answer on this site', text: 'This site has no content that directly answers this question, and I will not pad the answer with unrelated content. Please call the 1922 hotline, or browse the diseases index or site map.' },
    'no-clarification': { title: 'No matching official clarification', text: 'There is no official clarification matching this message yet. Please do not forward it; you can call 1922 or report it here.' },
    'no-data': { title: 'No matching statistics', text: 'No statistical series in the data catalogue answers this directly.' },
    'pro-only': { title: 'Specimen rules are professional content', text: 'Specimen collection, containers, storage and shipping rules are for healthcare and laboratory staff. Switch to professional mode or see the laboratory testing page.' },
    'no-open-job': { title: 'No open vacancies right now', text: 'Taiwan CDC has no vacancies open for application at the moment. See the Jobs page for upcoming vacancies and past results.' },
    'no-job-result': { title: 'No published selection results', text: 'No selection results have been published. Results list only application numbers (no names) on each vacancy page; this service does not read out the list.' },
    'no-open-tender': { title: 'No open tenders right now', text: 'Taiwan CDC has no tenders open for bids at the moment. See the Procurement page; official notices are on the Government e-Procurement System.' },
  },
  // ── 第四十輪（issue #70）：日、他加祿、越、印尼、泰五語為「機器初稿，待多語審核」（REFUSAL_TEXT_STATUS）。只譯最常出現的拒答／查無；其餘 kind 退回英文。
  // 原則：句子短、不加新資訊（只說「不能判斷、請就醫、撥 1922」），審核時只需核對語氣與用詞。
  // 第四十八輪：五語文案搬到 refusal-i18n.js（建置時依語言拆檔，答案頁只載當頁語言；見該檔說明）
  ...REFUSAL_TEXT_I18N,
};

/** 第四十輪：各語拒答文案的審核狀態（machine-draft＝機器初稿，待多語審核；審過改 reviewed 並在 PR 記審核人） */
export const REFUSAL_TEXT_STATUS = { 'zh-TW': 'source', en: 'reviewed', ja: 'machine-draft', tl: 'machine-draft', vi: 'machine-draft', id: 'machine-draft', th: 'machine-draft' };

/** 第四十八輪：答案頁載入當頁語言的拒答文案拆檔（refusal-i18n.<lang>.js）後併入；原始碼裡本來就齊全，已有的語言不覆寫 */
export function registerRefusalText(lang, text) { REFUSAL_TEXT[lang] ??= text; }

/** 拒答文案：該語言有就用該語言；沒有的 kind 退回英文（中文頁退回中文），再退回中文 */
export function refusalCopy(kind, lang) {
  const own = REFUSAL_TEXT[lang]?.[kind];
  if (own) return own;
  return (lang === 'zh-TW' ? null : REFUSAL_TEXT.en[kind]) ?? REFUSAL_TEXT['zh-TW'][kind] ?? REFUSAL_TEXT['zh-TW']['no-source'];
}

