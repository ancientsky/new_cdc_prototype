// 答案引擎：結構化資料（疫苗地圖連結、年齡與疫苗時程、旅遊疫情正規化、通報時限表）。第三十四輪自 core.js 拆出，ARCHITECTURE 第 40 章。
import { parseChineseNumber } from './text.js';

// ───────── 疫苗及流感藥劑地圖（vaxmap-next）深連結 ─────────
// 網址與 site.config.mjs 的 vaxmapUrl／vaxmapInfoUrl 相同。client 端無法 import site.config，所以在此寫死；
// 頁面可用 window.CDC.config = { vaxmapUrl, vaxmapInfoUrl } 覆寫（site 端若日後注入就不用改這裡）。
// 規則（docs/vaxmap-integration.md）：#g=flu|covid|pcv|antiviral；語言 zh-TW 不帶、其餘 lang=<碼>。
export const VAXMAP_URL = 'https://ancientsky.github.io/vaxmap-next/';
export const VAXMAP_INFO_URL = 'https://ancientsky.github.io/vaxmap-next/info.html';
export const VAXMAP_LANGS = new Set(['en', 'ja', 'vi', 'id', 'th', 'tl']);
export const VAXMAP_GROUP_OF = { 'vaccine.influenza': 'flu', 'vaccine.covid-19': 'covid', 'vaccine.pneumococcal': 'pcv' };
export const VAXMAP_GROUP_OF_DISEASE = { 'disease.influenza': 'flu', 'disease.covid-19': 'covid', 'disease.ipd': 'pcv' };
export const ANTIVIRAL_RE = /抗病毒|克流感|瑞樂沙|柏洛沙韋|antiviral|oseltamivir|tamiflu|xofluza|baloxavir|タミフル|ゾフルーザ|抗ウイルス|thuốc kháng vi-rút|antivirus|obat antiviral|ยาต้านไวรัส|gamot na antiviral/i;
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

// ───────── 第五十七輪：登革熱地圖深連結（docs/denguemap-integration.md 1.2；與 _partials.mjs 的 denguemapLink 同規則：繁中不帶、其他語言 lang=en）─────────
export const DENGUEMAP_URL = 'https://ancientsky.github.io/denguemap/';
export function denguemapHref(lang) {
  const cfg = (typeof window !== 'undefined' && window.CDC && window.CDC.config) || {};
  return `${cfg.denguemapUrl || DENGUEMAP_URL}#/map${lang && lang !== 'zh-TW' ? '?lang=en' : ''}`;
}

// ───────────────────────── 年齡／身分解析與疫苗時程比對（跨疫苗彙整） ─────────────────────────
// 「65 歲以上可以打哪些公費疫苗」「滿一歲的小孩要打什麼疫苗」這類問句沒有指定單一疫苗，
// 檢索只會撈到某一支疫苗頁；改由疫苗接種時程主檔（immunization-schedule）依年齡區間結構化組句。

export const AGE_N = '(\\d{1,3}|[零〇一二兩两三四五六七八九十百]+|半)';
export const AGE_Y = '\\s*(?:歲|歳|周歲|週歲)';
export const STAGE_RANGES = [['infant', 0, 23], ['child', 24, 83], ['school', 84, 227], ['adult', 228, 779], ['older', 780, Infinity]];
// 關鍵詞 → 年齡區間（月）與標籤；依序比對，同一問句可命中多個（取聯集）
export const AGE_KEYWORDS = [
  { re: /(新生兒|剛出生|出生時|newborn|trẻ sơ sinh)/i, min: 0, max: 0, label: '新生兒' },
  { re: /(嬰兒|寶寶|嬰幼兒|小嬰兒|\bbab(y|ies)\b|\binfants?\b|em bé)/i, min: 0, max: 23, label: '嬰幼兒' },
  { re: /(學齡前|幼兒園|幼稚園|托兒所|preschool)/i, min: 24, max: 83, label: '學齡前兒童' },
  { re: /(幼兒|幼童|\btoddlers?\b)/i, min: 0, max: 83, label: '幼兒' },
  { re: /(國小|小學|primary school|elementary)/i, min: 72, max: 143, label: '國小學童' },
  { re: /(國中|初中|junior high|middle school)/i, min: 144, max: 179, label: '國中生' },
  { re: /(高中|高職|五專|senior high|high school)/i, min: 180, max: 227, label: '高中職學生' },
  { re: /(青少年|\bteen(ager)?s?\b|adolescents?|thanh thiếu niên)/i, min: 120, max: 227, label: '青少年' },
  { re: /(學生|\bstudents?\b|học sinh)/i, min: 72, max: 227, label: '學生' },
  { re: /(兒童|小孩|孩子|小朋友|\bchild(ren)?\b|\bkids?\b|trẻ em|trẻ nhỏ)/i, min: 0, max: 143, label: '兒童' },
  { re: /(長者|老人|銀髮|長輩|年長者|老年人|阿公|阿嬤|爺爺|奶奶|\belderly\b|\bseniors?\b|older adults|người cao tuổi|người già)/i, min: 780, max: null, label: '65 歲以上長者' },
  { re: /(成人|成年人|大人|\badults?\b|người lớn|người trưởng thành)/i, min: 228, max: 779, label: '成人' },
];
export const PREGNANCY_RE = /(孕婦|懷孕|孕期|準媽媽|妊娠|pregnan|mang thai|bà bầu|phụ nữ có thai)/i;
export const INDIGENOUS_RE = /(原住民|indigenous|người bản địa|dân tộc thiểu số)/i;

export function ageNum(s) { const n = parseChineseNumber(s); return Number.isFinite(n) ? n : null; }
export function stagesOf(min, max) {
  const hi = max ?? Infinity;
  return STAGE_RANGES.filter(([, a, b]) => min <= b && hi >= a).map(([s]) => s);
}
export function yearsLabel(m) { return m % 12 === 0 ? `${m / 12} 歲` : m < 24 ? `${m} 個月` : `${Math.floor(m / 12)} 歲 ${m % 12} 個月`; }

/** 問句裡的數字年齡 → { min, max, label }（月）；找不到回 null */
export function numericAge(q) {
  const N = AGE_N, Y = AGE_Y;
  let m;
  // 區間：19 到 64 歲、6–12 歲
  if ((m = q.match(new RegExp(`${N}\\s*(?:歲|歳)?\\s*(?:到|至|~|～|-|–|—)\\s*${N}${Y}`)))) {
    const a = ageNum(m[1]), b = ageNum(m[2]);
    if (a != null && b != null && b >= a) return { min: Math.round(a * 12), max: Math.round(b * 12) + 11, label: `${a}–${b} 歲` };
  }
  // 歲＋月：1 歲 3 個月
  if ((m = q.match(new RegExp(`${N}${Y}\\s*(?:又|零)?\\s*${N}\\s*個?月`)))) {
    const a = ageNum(m[1]), b = ageNum(m[2]);
    if (a != null && b != null && b < 12) { const v = Math.round(a * 12 + b); return { min: v, max: v, label: yearsLabel(v) }; }
  }
  // 以上：65 歲以上、65 歲（含）以上、超過 65 歲、65+
  if ((m = q.match(new RegExp(`${N}${Y}\\s*(?:（含）|\\(含\\))?\\s*(?:以上|及以上|或以上|\\+)`))) || (m = q.match(new RegExp(`(?:超過|大於|年滿)\\s*${N}${Y}`))) || (m = q.match(/(?<![\w-])(\d{1,3})\s*\+/))) {
    const a = ageNum(m[1]);
    if (a != null) { const v = Math.round(a * 12); return { min: v, max: null, label: `${a} 歲以上${a >= 65 ? '長者' : ''}` }; }
  }
  // 「之前」：2 歲前、兩歲以前、6 個月之前（第三十七輪：原本被下面的「單純 N 歲」吃掉，「2 歲前」誤當成 2 歲那一年）
  // 「N 歲前要打哪些」問的是出生到滿 N 歲前的整段，等同「未滿 N 歲」
  if ((m = q.match(new RegExp(`${N}${Y}\\s*(?:以前|之前|前)`)))) {
    const a = ageNum(m[1]);
    if (a != null && a > 0) return { min: 0, max: Math.round(a * 12) - 1, label: `${a} 歲前` };
  }
  if ((m = q.match(new RegExp(`(?:出生)?\\s*${N}\\s*個(?:多)?月(?:大)?\\s*(?:以前|之前|前)(?!\\s*(?:打|接種|施打|注射)過)`))) && /(疫苗|預防針|接種|打)/.test(q.slice(m.index + m[0].length))) {
    const a = ageNum(m[1]);
    if (a != null && a > 0 && a <= 72) return { min: 0, max: Math.round(a) - 1, label: `${a} 個月前` };
  }
  // 以下：6 歲以下、未滿 5 歲
  if ((m = q.match(new RegExp(`(?:未滿|不到|小於)\\s*${N}${Y}`)))) {
    const a = ageNum(m[1]);
    if (a != null && a > 0) return { min: 0, max: Math.round(a * 12) - 1, label: `未滿 ${a} 歲` };
  }
  if ((m = q.match(new RegExp(`${N}${Y}\\s*(?:（含）|\\(含\\))?\\s*(?:以下|及以下|或以下)`)))) {
    const a = ageNum(m[1]);
    if (a != null) return { min: 0, max: Math.round(a * 12) + 11, label: `${a} 歲以下` };
  }
  // 月齡：6 個月大、滿 12 個月（「幾個月」不算）
  if ((m = q.match(new RegExp(`(?:滿)?\\s*${N}\\s*個(?:多)?月(?:大)?`))) && !/(近|過去|最近|前|間隔|隔|每|內|後)\s*$/.test(q.slice(0, m.index))) {
    const a = ageNum(m[1]);
    if (a != null && a <= 72) { const v = Math.round(a); return { min: v, max: v, label: a >= 12 && a % 12 === 0 ? `滿 ${a / 12} 歲` : `出生滿 ${a} 個月` }; }
  }
  // 滿 N 歲：取該月齡一點（滿一歲＝12 個月）
  if ((m = q.match(new RegExp(`滿\\s*${N}${Y}`)))) {
    const a = ageNum(m[1]);
    if (a != null) { const v = Math.round(a * 12); return { min: v, max: v, label: `滿 ${a} 歲` }; }
  }
  // 單純 N 歲：該歲整年
  if ((m = q.match(new RegExp(`${N}${Y}`)))) {
    const a = ageNum(m[1]);
    if (a != null && a <= 120) { const v = Math.round(a * 12); return { min: v, max: a < 1 ? v : v + 11, label: `${a} 歲` }; }
  }
  // 英文
  if ((m = q.match(/\b(\d{1,3})\s*(?:years?|yrs?)?(?:[\s-]*old)?\s*(?:and|or)\s*(?:older|over|above|up)\b/i)) || (m = q.match(/\b(?:over|above|older than|aged)\s*(\d{1,3})\s*(?:\+|years?|yrs?|and over|and older)?/i))) {
    const a = Number(m[1]); return { min: a * 12, max: null, label: `${a} 歲以上${a >= 65 ? '長者' : ''}` };
  }
  if ((m = q.match(/\bunder\s*(\d{1,3})\b/i))) { const a = Number(m[1]); if (a > 0) return { min: 0, max: a * 12 - 1, label: `未滿 ${a} 歲` }; }
  if ((m = q.match(/\b(\d{1,3})[\s-]*(?:months?|mos?)\b/i))) { const a = Number(m[1]); if (a <= 72) return { min: a, max: a, label: `出生滿 ${a} 個月` }; }
  if ((m = q.match(/\b(\d{1,3})[\s-]*(?:years?|yrs?|y\/o)\b/i))) { const a = Number(m[1]); if (a <= 120) return { min: a * 12, max: a * 12 + 11, label: `${a} 歲` }; }
  // 越南文
  if ((m = q.match(/(?:trên|từ)\s*(\d{1,3})\s*tuổi/i)) || (m = q.match(/(\d{1,3})\s*tuổi\s*trở lên/i))) { const a = Number(m[1]); return { min: a * 12, max: null, label: `${a} 歲以上${a >= 65 ? '長者' : ''}` }; }
  if ((m = q.match(/dưới\s*(\d{1,3})\s*tuổi/i))) { const a = Number(m[1]); if (a > 0) return { min: 0, max: a * 12 - 1, label: `未滿 ${a} 歲` }; }
  if ((m = q.match(/(\d{1,3})\s*tháng(?:\s*tuổi)?/i))) { const a = Number(m[1]); if (a <= 72) return { min: a, max: a, label: `出生滿 ${a} 個月` }; }
  if ((m = q.match(/(\d{1,3})\s*tuổi/i))) { const a = Number(m[1]); if (a <= 120) return { min: a * 12, max: a * 12 + 11, label: `${a} 歲` }; }
  // 第四十輪：他加祿（65 taong gulang）、印尼（usia 65 tahun）、泰文（อายุ 65 ปี、2 ขวบ）：首頁預設問題用得到
  if ((m = q.match(/(\d{1,3})\s*(?:taong gulang|taon)\b/i)) || (m = q.match(/(?:usia|umur)\s*(\d{1,3})/i)) || (m = q.match(/(\d{1,3})\s*tahun\b/i))
    || (m = q.match(/อายุ\s*(\d{1,3})/)) || (m = q.match(/(\d{1,3})\s*(?:ปี|ขวบ)/))) {
    const a = Number(m[1]); if (a <= 120) return { min: a * 12, max: a * 12 + 11, label: `${a} 歲` };
  }
  return null;
}

/**
 * 年齡／身分解析：問句 → { minMonths, maxMonths, stages[], groups[], label }；沒有任何年齡或身分線索回 null。
 * minMonths／maxMonths：月齡區間（maxMonths null＝不設上限；只有孕婦／原住民等身分、沒有年齡時兩者皆 null）。
 * stages：infant | child | school | adult | older | pregnancy；groups：'孕婦'、'原住民'。
 * 數字年齡優先於關鍵詞（「滿一歲的小孩」取 12 個月，不取「兒童」整段）。
 */
export function ageProfileOf(rawQ) {
  const q = String(rawQ ?? '').normalize('NFKC');
  if (!q.trim()) return null;
  const groups = [];
  const pregnant = PREGNANCY_RE.test(q);
  if (pregnant) groups.push('孕婦');
  if (INDIGENOUS_RE.test(q)) groups.push('原住民');
  let min = null, max = null, label = '';
  const num = numericAge(q);
  if (num) { ({ min, max, label } = num); }
  else {
    const hits = AGE_KEYWORDS.filter((k) => k.re.test(q));
    // 「國中生」同時命中「學生」、「嬰幼兒」同時命中「幼兒」：較具體者在前，聯集只取第一組以外不重疊者
    const used = [];
    for (const k of hits) if (!used.some((u) => k.min >= u.min && (k.max ?? Infinity) <= (u.max ?? Infinity) || u.min >= k.min && (u.max ?? Infinity) <= (k.max ?? Infinity))) used.push(k);
    if (used.length) {
      min = Math.min(...used.map((k) => k.min));
      max = used.some((k) => k.max == null) ? null : Math.max(...used.map((k) => k.max));
      label = used.map((k) => k.label).join('、');
    }
  }
  if (min == null && !groups.length) return null;
  const stages = min == null ? [] : stagesOf(min, max);
  if (pregnant) stages.push('pregnancy');
  if (groups.includes('原住民')) label = `${label}原住民`;
  if (pregnant && !label.includes('孕婦')) label = label ? `${label}孕婦` : '孕婦';
  return { minMonths: min, maxMonths: min == null ? null : max, stages, groups, label };
}

/** 時程地圖網址的年齡參數：滿歲 → '65'；未滿 2 歲或非整歲 → 'm12' */
export function ageHashOf(profile) {
  if (!profile || profile.minMonths == null) return '';
  const m = profile.minMonths;
  return m >= 24 && m % 12 === 0 ? String(m / 12) : `m${m}`;
}

// 問「哪些／什麼疫苗」：即使問句帶了某疫苗名稱，也走跨疫苗彙整
export const WHICH_VACCINE_RE = /((哪些|哪幾|哪種|什麼|甚麼|那些)\s*(公費)?\s*(疫苗|預防針|針)|(要|可以|能|該)打(什麼|哪些|甚麼)|打哪些|(疫苗|預防針)\s*(有|是)?\s*(哪些|哪幾種|什麼|甚麼)|which vaccines?|what vaccines?|vắc[\s-]?xin (nào|gì)|\ban(?:ong|o ang)\b.{0,20}\bbakuna\b|\bvaksin\b.{0,12}\bapa\b|\bapa\b.{0,12}\bvaksin\b|วัคซีน.{0,12}อะไร|どの.{0,8}ワクチン)/i;
// 意圖未定但問句明顯在問疫苗（年齡／身分＋疫苗詞）
export const SCHEDULE_VACCINE_RE = /(疫苗|預防針|接種|打針|vaccin|vắc[\s-]?xin|tiêm|ワクチン|bakuna|vaksin|วัคซีน)/i;

export const FUNDED_RANK = { public: 0, conditional: 1, self: 2 };
export const STAGE_ORDER = ['infant', 'child', 'school', 'adult', 'pregnancy', 'older', 'risk'];

/**
 * 依年齡／身分篩出時程項目：回傳 [{ ...item, effFunded }]，依 funded（public → conditional → self）、stage、月齡排序。
 * - 已過 endAt 的不列；特殊情況（risk）與孕期（pregnancy）項目只在問句帶該身分時才列。
 * - group 指名特定身分（原住民、孕婦）而問句沒有該身分 ⇒ 降為 conditional（符合條件才公費）。
 * - ageLabel／group 寫「YYYY 年（含）以後出生」⇒ 以 today 換算年齡上限（65 歲長者不會被列入 1966 年以後出生的 MMR）。
 */
export function matchSchedule(items, profile, { today = null } = {}) {
  if (!profile || !Array.isArray(items)) return [];
  const hasRange = profile.minMonths != null;
  const pMin = profile.minMonths ?? 0, pMax = profile.maxMonths ?? Infinity;
  const year = today ? Number(String(today).slice(0, 4)) : null;
  const out = [];
  for (const it of items) {
    if (!it || !it.vaccine) continue;
    if (it.endAt && today && it.endAt < today) continue;
    const stage = it.stage ?? '';
    const text = `${it.group ?? ''} ${it.ageLabel ?? ''}`;
    if (stage === 'risk' && !profile.stages.includes('risk')) continue;
    if (stage === 'pregnancy' && !profile.stages.includes('pregnancy')) continue;
    let aMax = it.ageMaxMonths ?? Infinity;
    const born = text.match(/(\d{4})\s*年\s*(?:（含）|\(含\))?\s*以後出生/);
    if (born && year) aMax = Math.min(aMax, (year - Number(born[1])) * 12 + 11);
    const aMin = it.ageMinMonths ?? 0;
    let ok;
    if (hasRange) ok = aMin <= pMax && aMax >= pMin;
    else ok = (profile.groups.includes('孕婦') && (stage === 'pregnancy' || /孕婦/.test(text))) || (profile.groups.includes('原住民') && /原住民/.test(text));
    if (!ok) continue;
    let effFunded = it.funded ?? 'self';
    if (effFunded === 'public' && /原住民/.test(text) && !profile.groups.includes('原住民')) effFunded = 'conditional';
    if (effFunded === 'public' && stage !== 'pregnancy' && /孕婦/.test(it.group ?? '') && !profile.groups.includes('孕婦')) effFunded = 'conditional';
    // 主檔標「符合條件公費」而問句已自報該身分（原住民、孕婦）⇒ 對這個人就是公費
    if (effFunded === 'conditional' && ((profile.groups.includes('原住民') && /原住民/.test(text)) || (profile.groups.includes('孕婦') && /孕婦/.test(text)))) effFunded = 'public';
    out.push({ ...it, effFunded });
  }
  out.sort((a, b) => (FUNDED_RANK[a.effFunded] ?? 3) - (FUNDED_RANK[b.effFunded] ?? 3)
    || STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage) || (a.ageMinMonths ?? 0) - (b.ageMinMonths ?? 0));
  return out;
}


// ───────────────────────── 旅遊疫情建議正規化 ─────────────────────────

export function normTravel(t) {
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


// ───────────────────────── 通報時限表、公告 ─────────────────────────

export const NOTICE_TYPES = ['recruit', 'procurement'];
/** 已截止公告句的標記（grounding 檢核時會先去除再比對原文） */
export const CLOSED_MARK = '（已截止）';
export const CAT_ZH = { 1: '一', 2: '二', 3: '三', 4: '四', 5: '五' };
/** 通報時限（小時）→ 中文；一週、一個月附小時數 */
export function notifyHoursLabel(h) {
  if (h == null) return '';
  if (h === 168) return '一週（168 小時）內';
  if (h === 720) return '一個月（720 小時）內';
  if (h % 24 === 0 && h > 24) return `${h / 24} 日（${h} 小時）內`;
  return `${h} 小時內`;
}
/** 「應於」後的時限片語：數字開頭前加空白（應於 24 小時內），中文開頭不加（應於一週（168 小時）內） */
export function hoursPhrase(h) { const l = notifyHoursLabel(h); return /^\d/.test(l) ? ` ${l}` : l; }
export function mmssOf(t) { const n = Math.max(0, Math.round(Number(t) || 0)); return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`; }
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
