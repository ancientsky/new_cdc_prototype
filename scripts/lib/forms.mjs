// 第三十輪（#55）：表單端點設定（site.config.mjs 的 forms）。
//
// 為什麼：報名資料、署長信箱來信、訂閱者 email 都是個資，不能進 Git（公開、永久），也不該進這個靜態網站。
// 網站只負責「把表單畫出來、送到機關的個資表單系統」，資料存在那一邊（有存取控制、保存期限、稽核紀錄）。
// 所以端點是設定，不是程式：資訊室決定收件系統後，只要建置時設環境變數，不必改程式。
//
// 規則：
//   - endpoint：'' 或 https:// 網址（本機測試允許 http://localhost、http://127.0.0.1）。
//   - mode：mock（原型模擬，預設）｜post（直接 POST 到 endpoint）｜link（只限署長信箱：連到 petitionUrl 的既有陳情系統）。
//   - 實際生效：post 要有 endpoint；link 要有 petitionUrl；否則一律 mock。設定矛盾（post 沒 endpoint 等）在建置時報錯，不默默退回。
//   - CSP：只有「生效中的 post 端點」的來源會加進 connect-src 與 form-action（formOrigins）；不會多開任何來源。
export const FORM_KEYS = ['careersApply', 'directorMailbox', 'newsletter'];
const MODES = { careersApply: ['mock', 'post'], directorMailbox: ['mock', 'post', 'link'], newsletter: ['mock', 'post'] };
const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/;

function urlOk(u) {
  if (!u) return true;
  if (!/^https:\/\//.test(u) && !LOCAL.test(u)) return false;
  try { new URL(u); return true; } catch { return false; }
}

/** 單一表單的生效設定：{ key, mode（設定值）, active（實際：mock|post|link）, endpoint, origin, petitionUrl, receiver } */
export function formSetting(cfg, key) {
  const f = cfg?.forms?.[key] ?? {};
  const endpoint = String(f.endpoint ?? '').trim();
  const petitionUrl = String(f.petitionUrl ?? '').trim();
  const mode = f.mode || (endpoint ? 'post' : 'mock');
  let active = 'mock';
  if (mode === 'post' && endpoint && urlOk(endpoint)) active = 'post';
  else if (mode === 'link' && key === 'directorMailbox' && petitionUrl && urlOk(petitionUrl)) active = 'link';
  let origin = '';
  if (active === 'post') origin = new URL(endpoint).origin;
  return { key, mode, active, endpoint: active === 'post' ? endpoint : '', origin, petitionUrl: active === 'link' ? petitionUrl : '', receiver: f.receiver ?? '' };
}

/** 設定檢查：回傳錯誤字串（build.mjs 併進治理門檻） */
export function formErrors(cfg) {
  const errs = [];
  for (const key of FORM_KEYS) {
    const f = cfg?.forms?.[key];
    if (!f) { errs.push(`[表單端點] forms.${key} 未設定`); continue; }
    const endpoint = String(f.endpoint ?? '').trim();
    const mode = f.mode || (endpoint ? 'post' : 'mock');
    if (!MODES[key].includes(mode)) errs.push(`[表單端點] forms.${key}.mode 只能是 ${MODES[key].join('｜')}（現在是 ${mode}）`);
    if (!urlOk(endpoint)) errs.push(`[表單端點] forms.${key}.endpoint 必須是 https:// 網址（現在是 ${endpoint}）`);
    if (mode === 'post' && !endpoint) errs.push(`[表單端點] forms.${key}.mode 是 post 但沒有 endpoint（FORM_${envKey(key)}_ENDPOINT）`);
    if (mode === 'link' && !String(f.petitionUrl ?? '').trim()) errs.push(`[表單端點] forms.${key}.mode 是 link 但沒有 petitionUrl（FORM_DIRECTOR_MAILBOX_PETITION_URL）`);
    if (f.petitionUrl && !urlOk(String(f.petitionUrl))) errs.push(`[表單端點] forms.${key}.petitionUrl 必須是 https:// 網址`);
    if (mode === 'mock' && endpoint) errs.push(`[表單端點] forms.${key} 有 endpoint 卻設 mode=mock：資料不會送出。請把 mode 改 post，或清空 endpoint`);
  }
  return errs;
}
export const envKey = (key) => key.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase();

/** 生效中的 post 端點來源（去重、排序）：emit-headers 加進 connect-src 與 form-action */
export function formOrigins(cfg) {
  return [...new Set(FORM_KEYS.map((k) => formSetting(cfg, k)).filter((s) => s.active === 'post').map((s) => s.origin))].sort();
}

// ───────── 第四十一輪：智慧問答查詢紀錄（site.config.mjs 的 askLog；docs/ask-log.md）─────────
//
// 為什麼放在這裡：查詢紀錄的端點和表單端點是同一類設定——「資料送去哪個機關系統」由資訊室決定、建置時用環境變數帶入，
// 網址規則（https、本機例外）、設定矛盾要在建置時報錯、生效中的端點來源要進 CSP，這些規則都一樣，所以共用 urlOk 與同一套檢查風格。
// 與表單不同的地方：
//   - mode 多一個 off（完全不記錄）；預設 mock＝送到本機開發伺服器的模擬後端（scripts/lib/ask-log-mock.mjs）。
//   - 送出用 navigator.sendBeacon，CSP 只管 connect-src；不需要 form-action。
//   - retentionDays 是「原始紀錄保存天數」（預設 90）：模擬後端照做；正式端點要自己照做（見 docs/ask-log.md）。
export const ASK_LOG_MODES = ['mock', 'post', 'off'];
export const ASK_LOG_DEFAULT_RETENTION_DAYS = 90;

/** 查詢紀錄的生效設定：{ mode（設定值）, active（實際：mock|post|off）, endpoint, origin, retentionDays } */
export function askLogSetting(cfg) {
  const a = cfg?.askLog ?? {};
  const endpoint = String(a.endpoint ?? '').trim();
  const mode = a.mode || (endpoint ? 'post' : 'mock');
  let active = 'mock';
  if (mode === 'off') active = 'off';
  else if (mode === 'post' && endpoint && urlOk(endpoint)) active = 'post';
  const days = Number(a.retentionDays);
  return {
    mode,
    active,
    endpoint: active === 'post' ? endpoint : '',
    origin: active === 'post' ? new URL(endpoint).origin : '',
    retentionDays: Number.isInteger(days) && days > 0 ? days : ASK_LOG_DEFAULT_RETENTION_DAYS,
  };
}

/** 設定檢查：回傳錯誤字串（build.mjs 併進治理門檻；與 formErrors 同樣「設定矛盾就擋，不默默退回」） */
export function askLogErrors(cfg) {
  const a = cfg?.askLog;
  if (!a) return [];
  const errs = [];
  const endpoint = String(a.endpoint ?? '').trim();
  const mode = a.mode || (endpoint ? 'post' : 'mock');
  if (!ASK_LOG_MODES.includes(mode)) errs.push(`[查詢紀錄] askLog.mode 只能是 ${ASK_LOG_MODES.join('｜')}（現在是 ${mode}）`);
  if (!urlOk(endpoint)) errs.push(`[查詢紀錄] askLog.endpoint 必須是 https:// 網址（現在是 ${endpoint}）`);
  if (mode === 'post' && !endpoint) errs.push('[查詢紀錄] askLog.mode 是 post 但沒有 endpoint（ASK_LOG_ENDPOINT）');
  if (mode === 'mock' && endpoint) errs.push('[查詢紀錄] askLog 有 endpoint 卻設 mode=mock：紀錄不會送到該端點。請把 mode 改 post，或清空 endpoint');
  if (mode === 'off' && endpoint) errs.push('[查詢紀錄] askLog 有 endpoint 卻設 mode=off：請清空 endpoint，避免誤以為有在記錄');
  const rd = a.retentionDays;
  if (rd != null && rd !== '' && !(Number.isInteger(Number(rd)) && Number(rd) > 0)) errs.push(`[查詢紀錄] askLog.retentionDays 必須是正整數（現在是 ${rd}）`);
  return errs;
}

/** 生效中的查詢紀錄 post 端點來源（0 或 1 個）：emit-headers 只加進 connect-src（sendBeacon／fetch 受 connect-src 管） */
export function askLogOrigins(cfg) {
  const s = askLogSetting(cfg);
  return s.active === 'post' ? [s.origin] : [];
}
