// @ts-check
// 共用速率限制（第六十三輪，Issue #140「防 AI 自動化攻擊探測」）。
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
import net from 'node:net';

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

/**
 * 位址正規化（第七十三輪擴充）：去空白與 IPv6 的 [ ]、IPv4-mapped IPv6（::ffff:1.2.3.4 或 ::ffff:102:304）→ 1.2.3.4、
 * IPv6 轉成 RFC 5952 標準寫法（小寫、最長的 0 段壓成 ::）。同一台機器不論協定堆疊或上一跳怎麼寫，都得到同一個字串，
 * 速率限制的 key 與信任代理的比對才不會被「換個寫法」繞過（2001:DB8::1、2001:db8:0:0::1 舊版會算成不同 key）。
 * 不是合法位址就原樣回傳（小寫、去空白），呼叫端用 net.isIP 判斷要不要採信。
 * @param {unknown} ip
 */
export function normIp(ip) {
  let a = String(ip ?? '')
    .trim()
    .toLowerCase();
  const br = /^\[(.*)\]$/.exec(a);
  if (br) a = br[1];
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(a);
  if (mapped && net.isIPv4(mapped[1])) return mapped[1];
  if (!net.isIPv6(a)) return a;
  let canon = a;
  try {
    canon = new URL(`http://[${a}]/`).hostname.slice(1, -1); // WHATWG URL 會把 IPv6 序列化成標準寫法
  } catch {
    return a;
  }
  const hexMapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(canon);
  if (hexMapped) {
    const hi = parseInt(hexMapped[1], 16);
    const lo = parseInt(hexMapped[2], 16);
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  }
  return canon;
}

/** 標準寫法的 IPv6 → 8 段 16 進位數字 */
function v6Groups(canon) {
  const [head, tail] = canon.includes('::') ? canon.split('::') : [canon, null];
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const fill = tail === null ? [] : Array(8 - h.length - t.length).fill('0');
  return [...h, ...fill, ...t].map((g) => parseInt(g, 16));
}

/**
 * 速率限制的 key：IPv4 用完整位址；IPv6 用所在的 /64（第七十三輪，稽核第 10 項）。
 * 為什麼是 /64：一般用戶（家用光纖、行動網路）拿到的是一整段 /64，自己就能換 2^64 個位址；
 * 以完整 IPv6 位址當 key，每個請求換一個位址就完全繞過限流。::1（本機）維持原樣。
 * @param {string} ip 已正規化的位址（normIp）
 */
export function rateKey(ip) {
  if (!net.isIPv6(ip) || ip === '::1') return ip;
  const g = v6Groups(ip).slice(0, 4);
  return `${normIp(`${g.map((x) => x.toString(16)).join(':')}::`)}/64`;
}

/**
 * 信任的代理位址比對：精確位址，或 IPv4／IPv6 的 CIDR（例：10.0.0.5、10.0.0.0/24、fd00::/8）。寫入閘道 header 模式的信任代理也用這一份（gateway/auth.mjs）。
 *
 * 第七十三輪（稽核第 5 項）：這份清單同時決定「誰送來的身分標頭可以相信」，打錯一個字就等於認證被繞過，所以寫錯一律**丟錯（啟動失敗）**，
 * 不再默默退回字串比對：
 *   - 前綴長度 IPv4 只能 0–32、IPv6 只能 0–128（舊版接受 /33，JS 位移取模後變成「信任半個 IPv4 網段」）；
 *   - 位址必須是 net.isIP 認得的（舊版 10.300.0.0/8 會被接受，意思也變了）；
 *   - IPv6 CIDR 真的照網段比對（舊版 fd00::/8 被當成字串，永遠比不中），大小寫與寫法先正規化；
 *   - 0.0.0.0/0、::/0（信任全世界）直接拒絕：沒有任何部署需要它，出現一定是設定錯誤。
 * @param {string[]} list
 * @returns {(ip: string | undefined) => boolean}
 */
export function ipMatcher(list) {
  const bl = new net.BlockList();
  let any = false;
  for (const raw of list ?? []) {
    const r = String(raw).trim();
    if (!r) continue;
    const bad = (why) =>
      new Error(
        `信任代理清單（GATEWAY_TRUSTED_PROXIES）有誤：「${r.slice(0, 60)}」${why}。請寫代理本身的位址（例：10.0.0.5）或網段（例：10.0.0.0/24、fd00::/64）`,
      );
    const m = /^([^/]+)\/(\d{1,3})$/.exec(r);
    const addr = normIp(m ? m[1] : r);
    const fam = net.isIP(addr);
    if (!fam) throw bad('不是合法的 IP 位址');
    const type = fam === 4 ? 'ipv4' : 'ipv6';
    if (m) {
      const bits = Number(m[2]);
      const maxBits = fam === 4 ? 32 : 128;
      if (bits > maxBits) throw bad(`的前綴長度超過 ${maxBits}`);
      if (bits === 0) throw bad('等於信任所有位址（/0），不允許');
      bl.addSubnet(addr, bits, type);
    } else bl.addAddress(addr, type);
    any = true;
  }
  if (!any) return () => false;
  return (ip) => {
    const a = normIp(ip);
    const fam = net.isIP(a);
    return fam ? bl.check(a, fam === 4 ? 'ipv4' : 'ipv6') : false;
  };
}

/** X-Forwarded-For 的一段 → 正規化的位址（去掉 IPv4 的 :port 與 IPv6 的 [ ]）；看起來不像位址就回空字串 */
function hopAddr(s) {
  let a = String(s).trim();
  const v6 = /^\[([^\]]+)\](?::\d+)?$/.exec(a);
  if (v6) a = v6[1];
  else if (/^\d+\.\d+\.\d+\.\d+:\d+$/.test(a)) a = a.replace(/:\d+$/, '');
  if (a.includes('%')) return ''; // 帶 zone id 的連結本地位址（fe80::1%eth0）不是可路由的來源，當成看不懂
  a = normIp(a);
  return net.isIP(a) ? a : '';
}

/**
 * 用戶端的真實位址（正規化，未分組）。稽核紀錄、404 分析用這個；速率限制用 clientKey（IPv6 以 /64 分組）。
 *
 * 為什麼不能直接用 X-Forwarded-For：那是請求自己帶的標頭，任何人都能寫 `X-Forwarded-For: 1.2.3.4`。
 * 若照單全收，攻擊者每個請求換一個假 IP，就「自己選了自己的 key」，速率限制形同虛設（還能栽贓別人的 IP 讓他被擋）。
 * 所以：只有 TCP 連線的對端（socket.remoteAddress）是我們信任的反向代理時，才看 X-Forwarded-For，
 * 而且**從右往左**走：每一段都是「它右邊那台機器」看到的連線來源，只有信任的代理寫的才可信。
 *   - 遇到第一個不是我們代理的位址就停，回傳它（那一段是我們的代理親手加上的；用戶端偽造的只會在它左邊）。
 *   - 第七十三輪（稽核第 6 項）：整串都是信任位址時，回傳 socket 位址（離我們最近、確定是真的那台），
 *     不再回傳最左邊那段——最左邊是用戶端自己可以寫的，內網機器每個請求換一個 10.x 就能換 key、或嫁禍同事。
 *   - 第七十三輪：遇到看不懂的一段（例如帶 zone id 的 fe80::1%eth0）就停在那裡，回傳它右邊那段（或 socket），
 *     不再跳過它繼續往左找——跳過等於又走到用戶端偽造的區域。
 * 對端不是信任的代理 ⇒ 一律用 socket 位址（直連時這就是真實來源）。
 *
 * 部署提醒：閘道在反向代理後面卻沒設 GATEWAY_TRUSTED_PROXIES ⇒ 所有人共用代理的 IP 這一個 key，大家一起被限流（docs/deploy.md §31）。
 * GATEWAY_TRUSTED_PROXIES 只列代理本身（/32 或很小的網段），不要列同事電腦所在的網段。
 * @param {{ socket?: { remoteAddress?: string }, headers?: Record<string, any> }} req
 * @param {{ trustedProxies?: string[] | ((ip: string) => boolean) }} [opts]
 */
export function clientIp(req, { trustedProxies = [] } = {}) {
  const sock = normIp(req?.socket?.remoteAddress) || 'unknown';
  const trusted = typeof trustedProxies === 'function' ? trustedProxies : ipMatcher(trustedProxies);
  if (!trusted(sock)) return sock;
  const raw = req.headers?.['x-forwarded-for'];
  const hops = (Array.isArray(raw) ? raw.join(',') : String(raw ?? '')).split(',').filter((s) => s.trim() !== '');
  let last = sock; // 目前走到的最左邊「可信」位址
  for (let i = hops.length - 1; i >= 0; i--) {
    const a = hopAddr(hops[i]);
    if (!a) return last; // 看不懂：停，不再往左（左邊都是用戶端可寫的）
    if (!trusted(a)) return a;
    last = a;
  }
  return sock; // 整串都是我們的代理（內部健康檢查）或沒有標頭 ⇒ 代理本身（socket）
}

/**
 * 速率限制用的用戶端 key：clientIp 再依 rateKey 分組（IPv6 → /64）。
 * @param {{ socket?: { remoteAddress?: string }, headers?: Record<string, any> }} req
 * @param {{ trustedProxies?: string[] | ((ip: string) => boolean) }} [opts]
 */
export function clientKey(req, opts = {}) {
  return rateKey(clientIp(req, opts));
}

/* ───────── 「這個請求真的是本機直連嗎」（第七十三輪，稽核第 3 項） ───────── */

/** 反向代理會加的標頭。本機 socket＋這些標頭 ⇒ 前面有一台同機代理，「只限本機」的判斷不能成立 */
export const PROXY_HEADERS = ['x-forwarded-for', 'forwarded', 'x-real-ip', 'x-forwarded-host'];
const LOOPBACK_RE = /^(::1|127\.\d{1,3}\.\d{1,3}\.\d{1,3})$/;
/** @param {unknown} ip */
export const isLoopbackIp = (ip) => LOOPBACK_RE.test(normIp(ip));
/** @param {{ headers?: Record<string, any> }} req */
export const hasProxyHeaders = (req) => PROXY_HEADERS.some((h) => req?.headers?.[h] != null && req.headers[h] !== '');
/**
 * 開發用端點（模擬信件匣、查詢紀錄報表、閘道 dev 登入）的門：socket 是 loopback，**而且**沒有任何代理標頭。
 * 為什麼要看標頭：deploy.md §14.5 的架構是「反向代理在同一台 → 本服務」，這時每個經過代理的外部請求，socket 對端都是 127.0.0.1；
 * 只看 socket 就等於對全世界開放。代理一定會加 X-Forwarded-For／Forwarded 之類的標頭，看到就拒絕。
 * @param {{ socket?: { remoteAddress?: string }, headers?: Record<string, any> }} req
 */
export const isDirectLoopback = (req) => isLoopbackIp(req?.socket?.remoteAddress) && !hasProxyHeaders(req);

/**
 * 信件與通知裡連結的來源（不含 basePath）。第七十三輪（稽核第 4 項）：
 * 設了 PUBLIC_ORIGIN 就只用它；沒設時只接受 localhost／127.x／[::1]（任何埠）的 Host，其他一律 http://localhost。
 * 為什麼：舊版沒設 PUBLIC_ORIGIN 時直接用請求的 Host，攻擊者送 `Host: cdc-gov-tw.evil.example` 就能讓機關寄出
 * 「帶真的 token、但網址指向攻擊者」的官方信件（Host 標頭污染），受害者一點就把管理權交出去。
 * @param {{ headers?: Record<string, any> }} req
 * @param {string} [publicOrigin]
 */
export function linkOrigin(req, publicOrigin = '') {
  if (publicOrigin) return String(publicOrigin).replace(/\/+$/, '');
  const host = String(req?.headers?.host ?? '');
  return /^(localhost|127\.\d{1,3}\.\d{1,3}\.\d{1,3}|\[::1\])(:\d{1,5})?$/i.test(host) ? `http://${host.toLowerCase()}` : 'http://localhost';
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
