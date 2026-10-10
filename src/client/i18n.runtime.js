// 瀏覽器端的 t()：只讀頁面載入的 i18n.<lang>.js 註冊在 window.CDC.I18N 的字串表（每頁一種語言）。
// 完整七語檔 i18n.js 只給 Node 端使用，不會上線（第二十六輪，issue #34）。
// 載入順序：layout 先放 <script type="module" src=".../i18n.<lang>.js">，再放 ui.js；module 依文件順序執行。
export function t(lang, key, vars = {}) {
  const tab = typeof window !== 'undefined' ? window.CDC?.I18N : undefined;
  const s = (tab && tab.lang === lang ? tab.S[key] : undefined) ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
}
if (typeof window !== 'undefined') {
  // Node 端（測試、模板）也會 import 本檔，只取 t()
  const CDC = (window.CDC = window.CDC || {});
  CDC.t = (k, v) => t(document.documentElement.lang, k, v);
}
