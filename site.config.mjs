// 站台設定。所有 agent 從這裡取語言、basePath、網址；不要在其他地方硬編。
/** 表單端點的環境變數覆寫（第三十輪）：FORM_{KEY}_ENDPOINT、FORM_{KEY}_MODE；沒設 mode 時有 endpoint ＝ post、沒有 ＝ mock */
function formEnv(key) {
  const endpoint = (process.env[`FORM_${key}_ENDPOINT`] ?? '').trim();
  return { endpoint, mode: (process.env[`FORM_${key}_MODE`] ?? '').trim() || (endpoint ? 'post' : 'mock') };
}
export const config = {
  name: '衛生福利部疾病管制署',
  nameShort: '疾管署',
  nameEn: 'Taiwan Centers for Disease Control',
  // GitHub Pages 專案頁：https://ancientsky.github.io/new_cdc_prototype/
  // 本機預覽：BASE_PATH='' node scripts/build.mjs
  basePath: (process.env.BASE_PATH ?? '/new_cdc_prototype').replace(/\/$/, ''),
  siteUrl: process.env.SITE_URL ?? 'https://ancientsky.github.io',
  // 第二十三輪（ARCHITECTURE 26.1）：站台模式。prototype（預設）＝公開示範站：每頁 noindex、robots.txt 全擋、每頁頂端「非官方原型」橫幅；
  // production＝正式站：SITE_MODE=production 建置才拿掉上述三項，robots.txt 改用 AI 政策版（附錄 H）。原型版 robots 另輸出 robots.production.txt 供對照。
  mode: process.env.SITE_MODE === 'production' ? 'production' : 'prototype',
  // 現行官網（來源連結、legacyUrls 用）
  legacyOrigin: 'https://www.cdc.gov.tw',
  openDataOrigin: 'https://data.cdc.gov.tw',
  // 疫苗及流感藥劑地圖：原型一律導向改良版 vaxmap-next（深連結：#g=flu|covid|pcv|antiviral&city=…&lang=en…）
  vaxmapUrl: 'https://ancientsky.github.io/vaxmap-next/',
  vaxmapInfoUrl: 'https://ancientsky.github.io/vaxmap-next/info.html',
  hotline: '1922',
  hotlineIntl: '+886-800-001922',
  defaultLang: 'zh-TW',
  // 七語：繁中為正本語言；其他語言依內容 languages[lang].status 決定是否渲染
  get isPrototype() { return this.mode !== 'production'; },
  // 正式官網（原型橫幅導向用）
  officialUrl: 'https://www.cdc.gov.tw/',
  langs: [
    { code: 'zh-TW', label: '繁體中文', dir: 'ltr', path: '' },
    { code: 'en', label: 'English', dir: 'ltr', path: '/en' },
    { code: 'ja', label: '日本語', dir: 'ltr', path: '/ja' },
    { code: 'tl', label: 'Tagalog', dir: 'ltr', path: '/tl' },
    { code: 'vi', label: 'Tiếng Việt', dir: 'ltr', path: '/vi' },
    { code: 'id', label: 'Bahasa Indonesia', dir: 'ltr', path: '/id' },
    { code: 'th', label: 'ไทย', dir: 'ltr', path: '/th' },
  ],
  // 一級內容：這些型別的非中文版本必須 reviewed 才渲染該語言頁
  tier1Types: ['disease', 'vaccine', 'clarification', 'situation'],
  // 六任務入口
  tasks: [
    { key: 'symptoms', label: '有症狀怎麼辦', sub: '症狀對照 · 該不該就醫 · 附近資源' },
    { key: 'vaccines', label: '疫苗與預防接種', sub: '我該打什麼 · 哪裡打 · 接種時程' },
    { key: 'travel', label: '出國與入境', sub: '目的地疫情等級 · 行前準備 · 旅遊醫學門診' },
    { key: 'situation', label: '現在的疫情', sub: '即時態勢 · 趨勢圖 · 地圖' },
    { key: 'rumor', label: '謠言查證', sub: '貼上訊息查真假 · 可轉傳的官方澄清' },
    { key: 'data', label: '開放資料與統計', sub: '資料集 · 統計查詢 · API' },
  ],
  // AI 揭露（臺北市指引：揭露廠商與生成方式）
  ai: {
    defaultMode: 'extractive', // extractive | llm
    modelDisclosure: '預設為抽取式整理（不使用生成模型）；啟用 LLM 模式時顯示供應商與模型名稱',
    llmProvider: 'Anthropic',
    llmModel: 'claude-sonnet-5-5',
    llmModels: ['claude-sonnet-5-5', 'claude-opus-5-5'], // 答案頁下拉可選；第二十三輪起由頁面 data 屬性帶給 llm.js，不在程式寫死
  },
  // 第八輪（ARCHITECTURE 16.1）：檔案資產（content/assets/{content-id}/ → dist/files/{content-id}/，公開網址 /files/{content-id}/{file}）
  // 超限、副檔名不在清單、檔數超過 maxFiles ⇒ 建置失敗（scripts/lib/assets.mjs）。後台上架包預檢也讀這裡（site.config.assets）。
  assets: {
    maxBytes: {
      pdf: 20 * 1024 * 1024, // PDF 與文件類（docx、odt、md、ics 比照）
      image: 2 * 1024 * 1024, // png、jpg、jpeg、webp、svg
      data: 50 * 1024 * 1024, // csv、json、xlsx
    },
    allowedExt: ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'svg', 'csv', 'json', 'xlsx', 'docx', 'odt', 'md', 'ics'],
    maxFiles: 30, // 一筆內容最多幾個檔
    altMaxLength: 150,
  },
  // 第三十輪（#55）：表單端點。報名、署長信箱、電子報訂閱的個資不進 Git、也不進本站：endpoint 有值且 mode 為 post ⇒ 頁面直接 POST 到機關的個資表單系統；
  // endpoint 空字串 ⇒ 沿用原型模擬（報名存瀏覽器、署長信箱 mailto／複製、電子報瀏覽器或本機模擬後端）。
  // 署長信箱另有 mode:'link'＋petitionUrl：直接連到機關既有的陳情系統（建議做法，不必另建收件系統）。
  // 建置時可用環境變數覆寫（FORM_CAREERS_APPLY_ENDPOINT／_MODE 等）；端點的來源會自動加進 CSP 的 connect-src 與 form-action（scripts/lib/forms.mjs、emit-headers.mjs）。
  // receiver＝收件單位（頁面的個資蒐集告知會寫出來）。契約、保存期限與誰要確認什麼：docs/deploy.md 第 13 節。
  forms: {
    careersApply: { ...formEnv('CAREERS_APPLY'), receiver: 'unit.personnel' },
    directorMailbox: { ...formEnv('DIRECTOR_MAILBOX'), receiver: 'unit.secretariat', petitionUrl: process.env.FORM_DIRECTOR_MAILBOX_PETITION_URL ?? '' },
    newsletter: { ...formEnv('NEWSLETTER'), receiver: 'unit.pr' },
  },
  licenses: {
    allowed: ['OGDL-1.0', 'CC0-1.0', 'CC-BY-4.0'],
    labels: {
      'OGDL-1.0': '政府資料開放授權條款第 1 版',
      'CC0-1.0': 'CC0 1.0 公眾領域貢獻宣告',
      'CC-BY-4.0': 'CC BY 4.0',
    },
  },
};

export function siteOrigin() {
  return `${config.siteUrl}${config.basePath}`;
}
