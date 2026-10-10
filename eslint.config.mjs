// ESLint flat config（第二十六輪，issue #42）。
// 原則：先擋「真的會出錯」的問題（未定義變數、重複 key、不可達程式碼…），風格交給 Prettier／編輯器。
// 這份設定是為了讓既有程式碼不用大改就能通過；要收緊規則請逐條調整並在 PR 說明理由。
import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['dist/**', 'node_modules/**', '.claude/**', 'previews/**', 'data/**', 'content/**', 'src/public/**', 'eval/out/**'] },
  js.configs.recommended,
  {
    languageOptions: { ecmaVersion: 2024, sourceType: 'module' },
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    rules: {
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_', ignoreRestSiblings: true }],
      'no-empty': ['error', { allowEmptyCatch: true }], // 「任何情況都不能丟例外」的 try/catch 空區塊是刻意的
      'no-useless-escape': 'off', // 正規表示式裡多餘的跳脫不影響行為
      'no-control-regex': 'off', // 文字清理用的控制字元範圍
      'no-misleading-character-class': 'off', // 零寬／組合字元處理
      'no-irregular-whitespace': 'off', // 內容規則會刻意處理全形空白、NBSP
      'no-prototype-builtins': 'off',
      'no-useless-assignment': 'off', // 「先給預設值再覆蓋」的寫法在既有程式碼很常見，不影響行為
      'no-regex-spaces': 'off', // 測試裡刻意用多個空白比對版面
      'preserve-caught-error': 'off', // 重新丟錯時不強制附 cause
      'no-cond-assign': ['error', 'except-parens'],
    },
  },
  // 瀏覽器端
  { files: ['src/client/**/*.js'], languageOptions: { globals: { ...globals.browser } } },
  // Node 端：建置腳本、模板、測試、評估
  { files: ['scripts/**/*.mjs', 'src/templates/**/*.mjs', 'tests/**/*.mjs', 'eval/**/*.mjs', 'site.config.mjs', 'eslint.config.mjs'], languageOptions: { globals: { ...globals.node } } },
  // 會在 Node 與瀏覽器兩邊執行的檔（答案引擎、i18n、共用規則）
  { files: ['src/client/answer/core.js', 'src/client/i18n.js', 'src/client/i18n.runtime.js', 'src/client/**/*-rules.js', 'src/client/**/*-core.js', 'src/client/vaxschedule.js'], languageOptions: { globals: { ...globals.browser, ...globals.node } } },
  // 測試裡用 page.evaluate 把函式送進瀏覽器執行
  { files: ['tests/**/*.mjs'], languageOptions: { globals: { ...globals.browser } } },
];
