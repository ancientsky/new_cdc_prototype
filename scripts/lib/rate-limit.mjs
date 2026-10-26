// @ts-check
// 共用速率限制（第六十二輪，Issue #140「防 AI 自動化攻擊探測」）。
//
// 為什麼要有一份共用的：第二十八輪（電子報）、第四十一輪（問答紀錄）、第四十三輪（國際疫情推送）各自寫了一份「IP → 時間戳陣列」，
// 三份的記憶體上限做法都是「超過就整個清空」——攻擊者只要灌一萬個假 IP（或走 IPv6 一大段位址）就能把所有人的計數歸零，
// 等於節流可以被一鍵重設。寫入閘道則完全沒有節流。ARTEX 這類 AI 自動化滲透工具的特性是「便宜、平行、24 小時列舉端點」，
// 第一個 429 應該盡量早、盡量便宜地出現，而且規則要一致，所以收成一份，四個後端共用。
//
// 演算法：滑動記錄（sliding log）。每個 key 只記「被接受的請求」的時間戳，最多 max 筆，所以：
//   - 精準：視窗內被接受的請求永遠 ≤ max，retryAfter 是「最舊那筆離開視窗」的真實秒數，不是估計值；
//   - 記憶體有上限：每個 key 最多 max 個數字；key 數超過 maxKeys 時先清掉閒置（視窗內沒有紀錄）的 key，
//     仍超過才從「最早出現」的 key 開始淘汰（Map 保留插入順序）。絕不整個清空：清空等於讓攻擊者重設所有人的計數。
//   - 被拒絕的請求不記時間戳：持續猛打的用戶端平均每 windowMs/max 才會有一筆被放行，上限仍是 max／視窗。
// 正式環境：第一層應該是 WAF／CDN（docs/abuse-protection.md），本模組是應用程式這一層的「最後一道」，
// 也是資訊室實作收件系統時對照的參考行為（同樣的數字、同樣的 429 形狀）。

/**
 * @param {{ windowMs: number, max: number, now?: () => number, maxKeys?: number }} opts
 */
export function createRateLimiter({ windowMs, max, now = Date.now, maxKeys = 10_000 }) {
  if (!(windowMs > 0) || !(max > 0)) throw new Error('createRateLimiter：windowMs 與 max 必須是正數');
  /** @type {Map<string, { log: number[], denied: number }>} */
  const keys = new Map();
  let lastSweep = 0;

  /** 清掉視窗內已沒有任何紀錄的 key；每個視窗最多掃一次（攤提成本），或 key 太多時立刻掃 */
  function sweep(t) {
    for (const [k, v] of keys) if (!v.log.length || t - v.log[v.log.length - 1] >= windowMs) keys.delete(k);
    lastSweep = t;
  }

  /**
   * 記一次請求。
   * denied：這個 key 連續被拒絕的次數（下一次被接受時歸零）。呼叫端用 denied === 1 判斷「剛開始被擋」，
   * 只在那一刻寫稽核或告警——否則被灌的時候每個 429 都寫一筆，攻擊者反而能拿稽核檔來塞爆磁碟。
   * @param {string} key
   * @returns {{ ok: boolean, remaining: number, retryAfterSec: number, count: number, denied: number }}
   */
  function hit(key) {
    const t = now();
    if (t - lastSweep >= windowMs || keys.size > maxKeys) sweep(t);
    let v = keys.get(key);
    if (!v) {
      while (keys.size >= maxKeys) keys.delete(/** @type {string} */ (keys.keys().next().value)); // 掃過仍太多：淘汰最早出現的
      v = { log: [], denied: 0 };
      keys.set(key, v);
    }
    while (v.log.length && t - v.log[0] >= windowMs) v.log.shift();
    if (v.log.length >= max) {
      v.denied++;
      const retryAfterSec = Math.max(1, Math.ceil((v.log[0] + windowMs - t) / 1000));
      return { ok: false, remaining: 0, retryAfterSec, count: v.log.length, denied: v.denied };
    }
    v.log.push(t);
    v.denied = 0;
    return { ok: true, remaining: max - v.log.length, retryAfterSec: 0, count: v.log.length, denied: 0 };
  }

  return {
    hit,
    windowMs,
    max,
    /** 全部歸零（測試、或管理者手動解除） */
    reset: () => {
      keys.clear();
      lastSweep = 0;
    },
    get size() {
      return keys.size;
    },
  };
}

/** IPv4-mapped IPv6（::ffff:1.2.3.4）→ 1.2.3.4，讓同一個用戶端不會因為協定堆疊不同算成兩個 key */
export const normIp = (ip) => String(ip ?? '').replace(/^::ffff:/i, '');

/**
 * 信任的代理位址比對：精確位址或 IPv4 CIDR（例：10.0.0.0/8）。寫入閘道 header 模式的信任代理也用這一份（gateway/auth.mjs）。
 * @param {string[]} list
 * @returns {(ip: string | undefined) => boolean}
 */
export function ipMatcher(list) {
  const rules = (list ?? [])
    .map((x) => String(x).trim())
    .filter(Boolean)
    .map((r) => {
      const m = /^(\d+\.\d+\.\d+\.\d+)\/(\d{1,2})$/.exec(r);
      if (!m) return (/** @type {string} */ ip) => ip === r;
      const toInt = (/** @type {string} */ a) => a.split('.').reduce((n, o) => n * 256 + Number(o), 0);
      const bits = Number(m[2]);
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
      const net = (toInt(m[1]) & mask) >>> 0;
      return (/** @type {string} */ ip) => /^\d+\.\d+\.\d+\.\d+$/.test(ip) && (toInt(ip) & mask) >>> 0 === net;
    });
  return (ip) => rules.some((f) => f(normIp(ip)));
}

/** X-Forwarded-For 的一段 → 位址（去掉 IPv4 的 :port 與 IPv6 的 [ ]）；看起來不像位址就回空字串 */
function hopAddr(s) {
  let a = String(s).trim();
  const v6 = /^\[([0-9a-f:.]+)\](?::\d+)?$/i.exec(a);
  if (v6) a = v6[1];
  else if (/^\d+\.\d+\.\d+\.\d+:\d+$/.test(a)) a = a.replace(/:\d+$/, '');
  a = normIp(a);
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(a) || /^[0-9a-f:]+$/i.test(a) ? a : '';
}

/**
 * 速率限制用的用戶端 key（IP 字串）。
 *
 * 為什麼不能直接用 X-Forwarded-For：那是請求自己帶的標頭，任何人都能寫 `X-Forwarded-For: 1.2.3.4`。
 * 若照單全收，攻擊者每個請求換一個假 IP，就「自己選了自己的 key」，速率限制形同虛設（還能栽贓別人的 IP 讓他被擋）。
 * 所以：只有 TCP 連線的對端（socket.remoteAddress）是我們信任的反向代理時，才看 X-Forwarded-For，
 * 而且從右往左跳過信任的代理，取「最後一個不是我們代理的位址」——那一段是我們的代理親手加上的，用戶端偽造的只會在它左邊。
 * 對端不是信任的代理 ⇒ 一律用 socket 位址（直連時這就是真實來源）。
 *
 * 部署提醒：閘道在反向代理後面卻沒設 GATEWAY_TRUSTED_PROXIES ⇒ 所有人共用代理的 IP 這一個 key，大家一起被限流（docs/deploy.md §31）。
 * @param {{ socket?: { remoteAddress?: string }, headers?: Record<string, any> }} req
 * @param {{ trustedProxies?: string[] | ((ip: string) => boolean) }} [opts]
 */
export function clientKey(req, { trustedProxies = [] } = {}) {
  const sock = normIp(req?.socket?.remoteAddress) || 'unknown';
  const trusted = typeof trustedProxies === 'function' ? trustedProxies : ipMatcher(trustedProxies);
  if (!trusted(sock)) return sock;
  const raw = req.headers?.['x-forwarded-for'];
  const hops = (Array.isArray(raw) ? raw.join(',') : String(raw ?? '')).split(',').map(hopAddr).filter(Boolean);
  for (let i = hops.length - 1; i >= 0; i--) if (!trusted(hops[i])) return hops[i];
  return hops[0] ?? sock; // 整串都是我們的代理（內部健康檢查）⇒ 最左邊那個；沒有標頭 ⇒ 代理本身
}

/** 429 的白話訊息：不說門檻、不說是哪一層擋的（不給列舉的人調參數的線索） */
export const RATE_MESSAGE = '操作太頻繁，請稍後再試';

/**
 * 送出通用的 429（JSON）：{ error, message, ...extra }＋Retry-After＋Cache-Control: no-store。
 * 有傳 req 就先把請求本體放掉（丟棄）：沒讀本體就回應，連線上殘留的資料會讓下一個請求解析錯亂或連線被重設。
 * 各後端可以帶自己的錯誤碼（電子報與問答紀錄的既有契約是 'rate'，前端依此顯示訊息），預設 'rate_limited'。
 * @param {import('node:http').ServerResponse} res
 * @param {number} retryAfterSec
 * @param {{ req?: import('node:http').IncomingMessage, error?: string, message?: string, extra?: Record<string, unknown>, headers?: Record<string, string> }} [opts]
 */
export function tooMany(res, retryAfterSec, { req, error = 'rate_limited', message = RATE_MESSAGE, extra = {}, headers = {} } = {}) {
  req?.resume?.();
  res.statusCode = 429;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Retry-After', String(Math.max(1, Math.ceil(retryAfterSec))));
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(JSON.stringify({ error, message, ...extra }));
  return true;
}
