// 第四十輪（issue #73）：疫情態勢的「數字＋單位」與「判定依據」在外語頁怎麼組字。Node 模板、API 輸出共用（純函式）。
//
// 為什麼不直接翻 metricValue：疫情中心填的是「本土 23 例」「8,700 人次」這種中文字串，數字每週變、單位幾乎不變。
// 若要求每週七語各填一次，一定會漏（第四十輪前 /en/diseases/dengue/ 就顯示「本土 23 例」）。
// 改成資料欄位（metricNumeric＋metricUnit）＋介面樣板（i18n sit.unit.*）：疫情中心只填數字，單位的翻譯寫一次就好。
// 判定依據（basis）是整句中文，無法用樣板組：有 i18n[lang].basis 就用，沒有就顯示翻譯好的通用說明，絕不把中文整句塞進外語頁。

const HAN = /[㐀-鿿]/;

/** 依語言格式化數字（8700 → en「8,700」、vi「8.700」）。Intl 不支援的語言退回英文格式 */
export function fmtNum(n, lang) {
  try {
    return new Intl.NumberFormat(lang === 'zh-TW' ? 'zh-TW' : lang).format(n);
  } catch {
    return new Intl.NumberFormat('en').format(n);
  }
}

/**
 * 外語頁的數字字串。t 是 (key, vars) => string（模板的 ctx.t 或 i18n.js 的 t 綁定語言）。
 * 順序：zh-TW 用正本 → i18n[lang].metricValue（疫情中心若自己填了就尊重）→ 數字＋單位樣板 →
 * 正本本身沒有中文（如「12%」）就用正本 → 只顯示數字。
 */
export function sitMetricValue(it, lang, t) {
  if (!it) return '';
  if (lang === 'zh-TW') return it.metricValue ?? '';
  const own = it.i18n?.[lang]?.metricValue;
  if (own) return own;
  const num = Number(it.metricNumeric);
  if (it.metricUnit && Number.isFinite(num)) {
    let s = t(`sit.unit.${it.metricUnit}`, { n: fmtNum(num, lang) });
    if (Number.isFinite(Number(it.metricImported))) s += ` ${t('sit.unit.imported', { n: fmtNum(Number(it.metricImported), lang) })}`;
    return s;
  }
  if (!HAN.test(it.metricValue ?? '')) return it.metricValue ?? '';
  return Number.isFinite(num) ? fmtNum(num, lang) : '';
}

/** 判定依據：zh-TW 用正本；外語用 i18n[lang].basis，沒有就用通用說明（generic=true 讓呼叫端知道這不是逐字翻譯） */
export function sitBasisInfo(it, lang, t) {
  if (!it) return { text: '', generic: false };
  if (lang === 'zh-TW') return { text: it.basis ?? '', generic: false };
  const own = it.i18n?.[lang]?.basis;
  if (own && !HAN.test(own)) return { text: own, generic: false };
  return { text: t('status.basis.generic'), generic: true };
}
export const sitBasis = (it, lang, t) => sitBasisInfo(it, lang, t).text;
