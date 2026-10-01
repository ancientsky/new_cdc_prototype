// 站台設定。所有 agent 從這裡取語言、basePath、網址；不要在其他地方硬編。
export const config = {
  name: '衛生福利部疾病管制署',
  nameShort: '疾管署',
  nameEn: 'Taiwan Centers for Disease Control',
  // GitHub Pages 專案頁：https://ancientsky.github.io/new_cdc_prototype/
  // 本機預覽：BASE_PATH='' node scripts/build.mjs
  basePath: (process.env.BASE_PATH ?? '/new_cdc_prototype').replace(/\/$/, ''),
  siteUrl: process.env.SITE_URL ?? 'https://ancientsky.github.io',
  // 現行官網（來源連結、legacyUrls 用）
  legacyOrigin: 'https://www.cdc.gov.tw',
  openDataOrigin: 'https://data.cdc.gov.tw',
  hotline: '1922',
  hotlineIntl: '+886-800-001922',
  defaultLang: 'zh-TW',
  // 七語：繁中為正本語言；其他語言依內容 languages[lang].status 決定是否渲染
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
