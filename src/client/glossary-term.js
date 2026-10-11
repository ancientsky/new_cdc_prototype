// 第四十輪（issue #72）：詞彙主檔（content/master/glossary.json）的統一查詢。Node 模板與瀏覽器共用，所以放在 src/client。
//
// 為什麼需要它：詞彙的印尼文欄位叫 `id_`——因為 `id` 已經是詞彙識別碼（term.influenza）。
// 只要有人寫 g[lang]，lang='id' 時就讀到識別碼，印尼文頁直接把「term.influenza」秀給民眾（第四十輪前 11 頁）。
// 規則集中在這裡：語言碼 → 欄位名稱的對照只寫一次；缺譯文依序退英文、中文；永遠不回傳識別碼。
// 建置時另有 dist 掃描（scripts/lib/i18n-quality.mjs）擋 term.* 外洩，這裡修、那裡擋。

/** 頁面語言碼 → 詞彙主檔欄位名稱。只有印尼文不同（id → id_） */
export const glossaryField = (lang) => (lang === 'id' ? 'id_' : lang);

const KEY_RE = /^term\./;
const usable = (v) => typeof v === 'string' && v.trim() !== '' && !KEY_RE.test(v);

/**
 * 回傳 { text, lang, machine }：text 是要顯示的詞；lang 是 text 實際的語言（退回英文／中文時與要求的不同，
 * 模板可據此加 lang 屬性）；machine 表示這個譯名是機器翻譯初稿、尚待多語審核人確認（glossary 的 machineTranslated）。
 */
export function glossaryTermInfo(g, lang) {
  if (!g) return { text: '', lang, machine: false };
  for (const l of [lang, 'en', 'zh-TW']) {
    const v = g[glossaryField(l)];
    if (usable(v)) return { text: v, lang: l, machine: l !== 'zh-TW' && (g.machineTranslated ?? []).includes(l) };
  }
  return { text: '', lang, machine: false };
}

/** 只要文字：lang 的譯名 → 英文 → 中文；都沒有回傳空字串（永不回傳 term.* 識別碼） */
export const glossaryTerm = (g, lang) => glossaryTermInfo(g, lang).text;
