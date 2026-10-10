// 電子報訂閱的狀態機（第二十八輪，Issue #38）：瀏覽器模擬後端與 Node 的 HTTP 模擬後端「共用同一份」。
//
// 為什麼共用：兩種模擬後端若各寫一份邏輯，遲早行為不同（例如一邊會洩漏信箱是否已訂閱、另一邊不會），
// 示範就失去意義。這裡只放「訂閱、確認、退訂」的規則，不碰儲存與寄信——那兩件事由呼叫端用 load／save／mail 三個函式注入：
//   瀏覽器：load／save＝localStorage；mail＝把信放進頁面上的「模擬收件匣」
//   伺服器：load／save＝.local/subscriptions.json；mail＝寫 .eml 到 .local/outbox/
//   正式寄信服務：換成資料庫與真的寄信 API，狀態機本身（含不洩漏、冪等、逾期）原樣照做。
// 回傳一律是類 HTTP 的 { status, body, headers? }，HTTP 後端直接當回應，瀏覽器端再轉成 { ok, … }。
import { validateSubscription, validatePreferences, normalizeEmail, emailProblem, isToken, maskEmail, CONFIRM_TTL_MS } from './subscribe-rules.js';

export const PENDING_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_SUBSCRIPTIONS = 2000;
export const DEFAULT_LIMITS = { windowMs: 10 * 60 * 1000, perIp: 10, perEmail: 3 };

const view = (s) => ({ status: s.status, email: maskEmail(s.email), topics: s.topics, frequency: s.frequency, lang: s.lang });

/**
 * @param {{ load: () => {subscriptions: object[]}, save: (d: object) => void, mail: (kind: string, sub: object) => void,
 *           now?: () => number, uuid?: () => string, limits?: typeof DEFAULT_LIMITS }} deps
 */
export function createService({ load, save, mail, now = () => Date.now(), uuid = () => globalThis.crypto.randomUUID(), limits = DEFAULT_LIMITS }) {
  const hits = new Map(); // 節流：key → 時間戳陣列（記憶體；重啟即清空，模擬用）
  const throttled = (key, max) => {
    const t = now();
    const list = (hits.get(key) ?? []).filter((x) => t - x < limits.windowMs);
    if (list.length >= max) { hits.set(key, list); return Math.ceil((limits.windowMs - (t - list[0])) / 1000); }
    list.push(t); hits.set(key, list);
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((x) => t - x < limits.windowMs)) hits.delete(k);
    return 0;
  };
  const rate = (wait) => ({ status: 429, body: { error: 'rate', retryAfter: wait }, headers: { 'Retry-After': String(wait) } });
  const open = () => {
    const data = load();
    const t = now();
    // 資料最小化：未確認超過 7 天的申請自動清除
    data.subscriptions = data.subscriptions.filter((s) => s.status !== 'pending' || t - Date.parse(s.createdAt) < PENDING_RETENTION_MS);
    return { data, t, iso: new Date(t).toISOString() };
  };
  const byManage = (data, token) => (isToken(token) ? data.subscriptions.find((s) => s.manageToken === token) : undefined);

  return {
    /** 申請訂閱。不論信箱是否已存在，對呼叫端一律回 202 { status:'pending' }（不洩漏誰訂閱了）。 */
    subscribe(input, { ip = 'local' } = {}) {
      if (typeof input?.website === 'string' && input.website.trim()) return { status: 202, body: { status: 'pending' } }; // 蜜罐：假裝成功、不存
      const v = validateSubscription(input);
      if (!v.ok) return { status: 400, body: { error: 'invalid', fields: v.errors } };
      const wait = throttled(`ip:${ip}`, limits.perIp) || throttled(`email:${v.value.email}`, limits.perEmail);
      if (wait) return rate(wait);
      const { data, t, iso } = open();
      let s = data.subscriptions.find((x) => x.email === v.value.email);
      if (!s && data.subscriptions.length >= MAX_SUBSCRIPTIONS) return { status: 503, body: { error: 'full' } };
      if (s?.status === 'confirmed') {
        mail('already', s); // 已訂閱：不改設定，只寄一封「管理／退訂」信給信箱主人
      } else {
        if (!s) { s = { id: uuid(), email: v.value.email, createdAt: iso, manageToken: uuid() }; data.subscriptions.push(s); }
        Object.assign(s, { topics: v.value.topics, frequency: v.value.frequency, lang: v.value.lang, status: 'pending', confirmToken: uuid(), confirmExpiresAt: new Date(t + CONFIRM_TTL_MS).toISOString(), updatedAt: iso, consentAt: iso });
        save(data);
        mail('confirm', s);
      }
      return { status: 202, body: { status: 'pending' } };
    },

    /** 點確認連結。冪等：重複點（含郵件安全掃描器預先打開連結）不會出錯。 */
    confirm(token) {
      const { data, t, iso } = open();
      const s = isToken(token) ? data.subscriptions.find((x) => x.confirmToken === token) : undefined;
      if (!s) return { status: 404, body: { error: 'notfound' } };
      if (s.status === 'confirmed') return { status: 200, body: { ...view(s), manageToken: s.manageToken, already: true } };
      if (s.status === 'unsubscribed') return { status: 410, body: { error: 'unsubscribed' } };
      if (t > Date.parse(s.confirmExpiresAt)) return { status: 410, body: { error: 'expired' } };
      s.status = 'confirmed'; s.confirmedAt = iso; s.updatedAt = iso;
      save(data);
      mail('welcome', s);
      return { status: 200, body: { ...view(s), manageToken: s.manageToken } };
    },

    /** 用 manageToken 查目前設定 */
    status(token) {
      const { data } = open();
      const s = byManage(data, token);
      return s ? { status: 200, body: view(s) } : { status: 404, body: { error: 'notfound' } };
    },

    /** 改主題、頻率、語言（不能改信箱：換信箱＝退訂後重新訂閱，才會再做一次雙重確認） */
    update(token, prefs) {
      const { data, iso } = open();
      const s = byManage(data, token);
      if (!s || s.status === 'unsubscribed') return { status: 404, body: { error: 'notfound' } };
      const v = validatePreferences(prefs);
      if (!v.ok) return { status: 400, body: { error: 'invalid', fields: v.errors } };
      Object.assign(s, v.value, { updatedAt: iso });
      save(data);
      return { status: 200, body: view(s) };
    },

    /** 退訂。冪等；只保留「不要再寄」的抑制紀錄（信箱＋狀態），偏好與確認 token 清掉。 */
    unsubscribe(token) {
      const { data, iso } = open();
      const s = byManage(data, token);
      if (!s) return { status: 404, body: { error: 'notfound' } };
      if (s.status !== 'unsubscribed') {
        const was = s.status;
        Object.assign(s, { status: 'unsubscribed', unsubscribedAt: iso, updatedAt: iso, topics: [], confirmToken: null });
        save(data);
        if (was === 'confirmed') mail('goodbye', s);
      }
      return { status: 200, body: { status: 'unsubscribed' } };
    },

    /** 忘了管理連結：寄一封給「已確認」的信箱；不論有沒有訂閱，回應相同 */
    manageLink(email, { ip = 'local' } = {}) {
      const e = normalizeEmail(email);
      if (emailProblem(e)) return { status: 400, body: { error: 'invalid', fields: { email: 'invalid' } } };
      const wait = throttled(`ip:${ip}`, limits.perIp) || throttled(`email:${e}`, limits.perEmail);
      if (wait) return rate(wait);
      const { data } = open();
      const s = data.subscriptions.find((x) => x.email === e && x.status === 'confirmed');
      if (s) mail('manage', s);
      return { status: 202, body: { status: 'sent-if-subscribed' } };
    },
  };
}
