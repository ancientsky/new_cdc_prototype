// 型別檢查用：頁面上由 i18n.runtime.js／pro.js 等先掛好的 window.CDC（見各檔檔首）。只宣告 answer/ 模組用到的欄位。
// 放這裡而不是改程式：checkJs 逐步擴大時，所有 src/client 檔共用同一份宣告。
interface Window {
  CDC?: {
    url?: (path: string) => string;
    t?: (key: string, vars?: Record<string, unknown>) => string;
    [k: string]: unknown;
  };
}
