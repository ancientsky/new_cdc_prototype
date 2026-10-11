// @ts-check
// 可選 LLM 模式（BYOK）的設定與金鑰管理：答案頁一載入就要用（決定要不要顯示金鑰欄位），所以獨立成小檔。
// 第三十四輪（ARCHITECTURE 第 40 章）：提示詞、後檢、呼叫 API 的 llm.js 改成「同事開啟 LLM 模式並送出問題時」才以 import() 載入，
// 民眾端每次開答案頁不再下載那段程式。金鑰規則（只存本分頁 sessionStorage）見 llm.js 檔首與 ARCHITECTURE 26.4。

export const LLM_PROVIDER = 'Anthropic';
// 模型名稱由頁面帶入（ask.mjs 在 #ask-advanced 放 data-llm-model／data-llm-models，值來自 site.config.mjs ai），不寫死在程式；Node 測試沒有 document 時用備援值。
const FALLBACK_MODEL = 'claude-sonnet-5-5';
function advEl() { try { return globalThis.document?.getElementById('ask-advanced') ?? null; } catch { return null; } }
export function llmModels() { const v = advEl()?.dataset?.llmModels; const list = v ? v.split(',').map((x) => x.trim()).filter(Boolean) : []; return list.length ? list : [llmDefaultModel()]; }
export function llmDefaultModel() { return advEl()?.dataset?.llmModel || FALLBACK_MODEL; }
export const LLM_DEFAULT_MODEL = FALLBACK_MODEL; // 向後相容（舊測試引用）；實際以 llmDefaultModel() 為準
export const LLM_MODELS = [FALLBACK_MODEL, 'claude-opus-5-5']; // 向後相容；實際以 llmModels() 為準
const KEY_STORE = 'cdc.llmKey';
const MODEL_STORE = 'cdc.llmModel';

// ───────── key 管理（只在瀏覽器、只在本分頁） ─────────
function ss() { try { return globalThis.sessionStorage ?? null; } catch { return null; } }
function ls() { try { return globalThis.localStorage ?? null; } catch { return null; } }
/** 第二十三輪：舊版把 key 存在 localStorage；載入時一律清掉，避免殘留 */
export function purgeLegacyKey() { try { ls()?.removeItem(KEY_STORE); } catch { /* ignore */ } }
export function getKey() { try { return ss()?.getItem(KEY_STORE) || ''; } catch { return ''; } }
export function setKey(k) { try { if (k) ss()?.setItem(KEY_STORE, String(k).trim()); else ss()?.removeItem(KEY_STORE); } catch { /* 私密模式 */ } }
export function clearKey() { setKey(''); }
export function getModel() { try { const m = ss()?.getItem(MODEL_STORE); return llmModels().includes(m) ? m : llmDefaultModel(); } catch { return llmDefaultModel(); } }
export function setModel(m) { try { if (llmModels().includes(m)) ss()?.setItem(MODEL_STORE, m); } catch { /* ignore */ } }
export function hasKey() { return !!getKey(); }
/** 只有後台工作階段未過期時才開放 BYOK（同事示範用）。session 真偽由後台頁自己再驗；這裡只是「要不要顯示欄位」。 */
export function staffSessionActive(now = Date.now()) {
  try { const s = JSON.parse(ls()?.getItem('cdc.admin.session') ?? 'null'); return !!s && typeof s.exp === 'number' && now < s.exp; } catch { return false; }
}
