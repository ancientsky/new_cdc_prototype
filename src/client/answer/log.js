// 智慧問答查詢紀錄（第四十一輪；說明見 docs/ask-log.md）。
//
// 目的：讓同仁知道「哪些常被問的問題答不出來」，好補詞彙主檔與內容（以前只能靠碰巧發現，例如 covid、做愛）。
// ui.js 在答案畫出來之後才以 import() 載入本檔：不在初始畫面、也不在引擎的靜態 import 閉包裡，所以不吃引擎頁 240 KB 的 JS 預算；
// 任何錯誤一律吞掉，紀錄失敗絕不影響答案。
//
// 送什麼：只有下面 askLogEvent() 列出的欄位。問句是引擎「已遮蔽個資」的版本（result.query），這裡再遮一次（雙保險），截到 200 字。
// 不送什麼：IP 衍生資料、cookie、使用者 ID、referrer、User-Agent、完整網址（只送 pathname，不含 ?q=）、秒以下的時間。
// 不送的情況：瀏覽器開了「不要追蹤」（Do Not Track）或 Global Privacy Control、設定為 off、問句是空的、
//   mock 模式但頁面不是由本機開發伺服器（scripts/serve.mjs，localhost）提供——GitHub Pages 原型站沒有後端，不把民眾的問句送給託管平台。
//   判斷方式：serve.mjs 回應時設一個標記 cookie（MOCK_COOKIE，只表示「這裡有模擬後端」，不含任何資料）；其他靜態伺服器沒有它，
//   所以不會打一個必定 404 的請求（瀏覽器會把 404 記成 console 錯誤，端到端測試也會因此失敗）。
//
// 為什麼用 fetch keepalive、而不是 sendBeacon 當主要管道：sendBeacon 無法關掉 Referer 與 cookie。
// 若正式端點與網站同網域，Referer 會是完整網址（含未遮蔽的 ?q=），會落進伺服器存取紀錄；fetch 可以指定 referrerPolicy:'no-referrer'
// 與 credentials:'omit'，keepalive 也一樣能在使用者馬上離開頁面時送達。只有瀏覽器不支援 fetch 時才退回 sendBeacon，
// 而且只在跨網域端點（post 模式）才用——跨網域時本站的 Referrer-Policy（strict-origin-when-cross-origin）只會送出網域，不含問句。
import { maskPII } from './text.js';
import { isLowRelevance } from './rules.js';

export const ASK_LOG_PATH = '/api/ask-log';
const LOOPBACK = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/;
export const MOCK_COOKIE = 'cdc_ask_log_mock';

/** 這題的結果歸類：answered｜low-relevance｜stats｜no-match｜no-source｜refused｜paused */
export function outcomeOf(r) {
  if (r?.paused) return 'paused';
  if (r?.refused) return ['no-match', 'no-source'].includes(r.refusal?.kind) ? r.refusal.kind : 'refused';
  if (r?.stats) return 'stats';
  return isLowRelevance(r) ? 'low-relevance' : 'answered';
}

/** 由答案結果組出一筆紀錄；問句是空的回傳 null。page＝location.pathname（只取路徑）；now＝Date；ev＝建置版本 */
export function askLogEvent(r, { page = '', now = new Date(), ev = '' } = {}) {
  const q = maskPII(String(r?.query ?? ''))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
  if (!q) return null;
  const ids = [];
  for (const x of r.sources?.length ? r.sources : (r.retrieved ?? [])) {
    const id = String(x?.contentId ?? x?.id ?? '').slice(0, 80);
    if (id && !ids.includes(id)) ids.push(id);
    if (ids.length === 3) break;
  }
  return {
    v: 1,
    q,
    lang: r.lang ?? null,
    view: r.view ?? null,
    outcome: outcomeOf(r),
    refusalKind: r.refusal?.kind ?? null,
    intent: r.intent ?? null,
    disease: r.disease ?? null,
    relevance: typeof r.relevance === 'number' ? Math.round(r.relevance * 100) / 100 : null,
    top: ids,
    page: String(page).split(/[?#]/)[0].slice(0, 200),
    t: `${now.toISOString().slice(0, 16)}Z`, // 只到分鐘
    ev: String(ev ?? '').slice(0, 40),
  };
}

/** 使用者的隱私偏好：Do Not Track 或 Global Privacy Control 任一開啟 ⇒ 不記錄 */
export const privacyOptOut = (nav) => nav?.doNotTrack === '1' || nav?.globalPrivacyControl === true;

/**
 * 送出一筆。cfg＝.c-askpage 的 dataset（askLog、askLogEndpoint、askLogEv）。回傳是否有送出（測試用）；失敗靜默
 * @param {any} r 引擎的答案結果
 * @param {{ askLog?: string, askLogEndpoint?: string, askLogEv?: string }} [cfg]
 * @param {any} [env] 瀏覽器全域（測試時傳替身）
 */
export function sendAskLog(r, cfg = {}, env = globalThis) {
  try {
    const nav = env.navigator;
    const loc = env.location ?? {};
    if (privacyOptOut(nav)) return false;
    let url = '';
    if (cfg.askLog === 'post' && /^https:\/\//.test(cfg.askLogEndpoint ?? '')) url = cfg.askLogEndpoint;
    else if (cfg.askLog === 'mock' && LOOPBACK.test(loc.hostname ?? '') && new RegExp(`(^|; )${MOCK_COOKIE}=1`).test(env.document?.cookie ?? ''))
      url = `${env.document?.documentElement?.dataset?.base ?? ''}${ASK_LOG_PATH}`;
    if (!url) return false;
    const ev = askLogEvent(r, { page: loc.pathname, ev: cfg.askLogEv });
    if (!ev) return false;
    const body = JSON.stringify(ev);
    // text/plain 是 CORS「簡單請求」型別：跨網域端點不必處理預檢（OPTIONS）；端點一律把本體當 JSON 解析
    const type = 'text/plain;charset=UTF-8';
    const cross = cfg.askLog === 'post';
    if (typeof env.fetch === 'function') {
      env
        .fetch(url, {
          method: 'POST',
          body,
          keepalive: true,
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
          mode: cross ? 'no-cors' : 'same-origin',
          headers: { 'Content-Type': type },
        })
        .catch(() => {});
      return true;
    }
    if (cross && typeof nav?.sendBeacon === 'function') return nav.sendBeacon(url, new Blob([body], { type }));
  } catch {
    /* 紀錄失敗不影響答案 */
  }
  return false;
}
