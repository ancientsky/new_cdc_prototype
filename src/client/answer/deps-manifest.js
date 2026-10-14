// 答案引擎要讀哪些 v1 JSON（第四十輪，Issue #80）：純資料，瀏覽器（data.js）與建置（scripts/lib/js-budget.mjs 的資料傳輸量門檻）共用同一份清單，
// 不會出現「前端多抓了一個檔、預算卻沒算到」。
//
// primary：任何問題都會用到（索引之外）；secondary：只有特定意圖才用到（旅遊等級、申請服務、通報時限表、影音海報、接種時程）。
// 兩批在真正提問時都要等齊（createEngine 需要完整資料）；差別只在預取的時機（見 data.js 的 prefetchEngine）。
// [名稱（v1/ 之後、不含 .json）, 讀不到時的預設值, 可選（先查 v1/index.json 有沒有列出，沒列出就不發請求）]
export const ENGINE_PRIMARY = [
  ['situation', null],
  ['answer/clarifications', []], // 第五十輪：只含已審閱譯文（一級內容不顯示機器初稿）
  ['glossary', []],
  ['diseases', []],
  ['answer/vaccines', []], // 第五十輪：精簡副本
  ['countries', []],
  ['answer/datasets', []], // 第四十九輪：精簡副本（不含譯文，見 emit-api.mjs）
  ['answer/faq', []], // 第五十輪：精簡副本
  ['units', []],
  ['governance/ai-status', {}],
];
export const ENGINE_SECONDARY = [
  ['travel-alerts', [], false],
  ['country-levels', [], false],
  ['answer/services', [], true],
  ['notify-table', null, true],
  ['answer/media', [], true],
  ['immunization-schedule', [], true],
  ['vaccine-master', [], true], // 第四十八輪（issue #95）：還沒有疫苗頁的疫苗也要認得（皮蛇疫苗）
];

/** 某語言的答案頁要下載的索引分片（中文正本一定要有：引擎查不到該語言的審閱譯文時退回中文） */
export function indexShardNames(base, lang) {
  return (lang === 'zh-TW' ? ['zh-TW'] : ['zh-TW', lang]).map((l) => `${base}.${l}`);
}
