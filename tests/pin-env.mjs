// 測試環境釘選（第四十九輪）：讓整套測試與呼叫端的環境變數無關。
//
// 為什麼需要：site.config.mjs 在「被 import 的當下」讀 process.env.BASE_PATH／SITE_URL／SITE_MODE。
// 開發者為了量效能、跑無障礙或 e2e 常在 shell 裡設 BASE_PATH=''（或整個 session export 過），
// 這時 `npm test` 的模板測試仍期待預設的 /new_cdc_prototype（約 24 個測試紅燈，且訊息只說「正規表示式不符」，很難聯想到環境變數）。
// 根因不是測試寫錯，而是測試的輸入有一部分來自呼叫端的環境。
//
// 做法：在任何人 import site.config.mjs 之前，把這三個變數從 process.env 移除（設定檔就回到預設值）。
//   - 呼叫端原本設的 BASE_PATH 存到 CALLER_BASE_PATH（只供偵錯；e2e 測試不看它，看 dist 自己：tests/helpers.mjs 的 distBasePath()）。
//   - 由 package.json 的 `node --test --import ./tests/pin-env.mjs` 確保在每個測試檔之前執行；
//     tests/helpers.mjs 也在第一行 import 本檔，所以直接 `node --test tests/某檔.test.mjs` 也一樣（前提是該檔先 import helpers，
//     或不 import site.config.mjs 在 helpers 之前——有疑慮就用 npm test 或自己加 --import）。
//   - TEST_KEEP_ENV=1：不釘選（刻意想用自己的 BASE_PATH 跑模板測試時；預期會有測試因 basePath 不同而失敗）。
// 需要 BASE_PATH='' 的 dist（e2e：round26、28、30、34、40、47 與 admin-editor）不受影響：它們讀 dist/index.html 的 data-base 決定要用哪個 basePath，
// 並在啟動 scripts/serve.mjs 時明確傳 BASE_PATH（見 helpers.mjs 的 distBasePath／distEnv）。
if (process.env.TEST_KEEP_ENV !== '1') {
  if ('BASE_PATH' in process.env && !('CALLER_BASE_PATH' in process.env)) process.env.CALLER_BASE_PATH = process.env.BASE_PATH;
  for (const k of ['BASE_PATH', 'SITE_URL', 'SITE_MODE', 'ADMIN_ORIGIN']) delete process.env[k]; // 第六十三輪：ADMIN_ORIGIN 會把後台連結改成絕對網址
}
