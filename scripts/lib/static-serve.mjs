// @ts-check
// scripts/serve.mjs 的靜態檔服務與「開發用端點開不開」的判斷（第七十三輪安全稽核，docs/deploy.md §35）。
//
// 為什麼抽成一個模組：serve.mjs 一被 import 就開始監聽埠，沒辦法在測試裡直接呼叫；
// 路徑穿越、讀檔錯誤、HTTP 方法這三件事是「部署前必修」，必須有回歸測試（tests/round73-server-hardening.test.mjs）。
//
// 1.【嚴重】路徑穿越：舊版 `decodeURIComponent(pathname)` 之後直接 `path.join(DIST, url)`。WHATWG URL 只正規化字面上的 `..` 與 `%2e%2e`，
//    `%2f` 不算路徑分隔，所以 `/..%2fpackage.json` 原樣通過，解碼後變成 `/../package.json`，join 之後就走出 dist/——
//    實測可以讀 repo 原始碼、/etc/passwd、/proc/self/environ（裡面有 GITLAB_TOKEN、GATEWAY_SESSION_SECRET 等全部祕密）。
//    現在：解碼後含 \0 ⇒ 400；以 path.resolve(DIST, '.' + url) 算出絕對路徑，必須等於 DIST 或在 DIST/ 底下；
//    再用 realpath 解開 symlink 後檢查一次（dist 內若有 symlink 指向外面，一樣拒絕）；只服務一般檔案（目錄改找 index.html，FIFO／裝置檔一律不給）。
// 2.【高】讀檔錯誤讓整個 process 當掉：createReadStream 沒有 'error' 處理，EIO（/proc/self/mem）、EACCES、
//    或「existsSync 與 open 之間檔案剛好被 npm run build 刪掉」的 ENOENT，都會變成未處理的例外，連寫入閘道一起停擺。
//    現在：串流錯誤 ⇒ 還沒送標頭就回 404／500，送了就中斷連線；同一種錯誤每分鐘只記一行 log（不讓人用錯誤灌爆 log）。
// 3. 只有 GET／HEAD 能取靜態檔，其他方法 405（稽核 §18-c：舊版 DELETE /index.html 也回 200）。
import fs from 'node:fs';
import path from 'node:path';

export const STATIC_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.md': 'text/markdown; charset=utf-8',
  '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};

/** p 是否等於 root 或在 root 底下（root 是絕對路徑） */
export function isInside(root, p) {
  return p === root || p.startsWith(root.endsWith(path.sep) ? root : root + path.sep);
}

/** realpath；不存在就回 null */
function real(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return null;
  }
}

/**
 * 已解碼、已去掉 basePath 的網址路徑 → dist 裡可以服務的檔案絕對路徑；不能服務（不存在、走出 dist、不是一般檔案）回 null。
 * @param {string} distDir
 * @param {string} url
 * @returns {string | null}
 */
export function resolveStatic(distDir, url) {
  if (typeof url !== 'string' || url.includes('\0')) return null;
  const root = path.resolve(distDir);
  let file = path.resolve(root, `.${url.startsWith('/') ? '' : '/'}${url}`);
  if (!isInside(root, file)) return null; // 第一道：字面上就走出 dist（..%2f、..%5c 在 Windows 上也一樣）
  const rootReal = real(root);
  if (!rootReal) return null;
  let st;
  try {
    st = fs.statSync(file);
    if (st.isDirectory()) {
      file = path.join(file, 'index.html');
      st = fs.statSync(file);
    }
  } catch {
    return null;
  }
  if (!st.isFile()) return null; // FIFO、裝置檔、socket：不給（/dev/zero 這類會無限串流）
  const fileReal = real(file);
  if (!fileReal || !isInside(rootReal, fileReal)) return null; // 第二道：解開 symlink 後仍要在 dist 裡
  return fileReal;
}

/**
 * 開發用端點（/api/dev/outbox、/api/dev/ask-log/report）要不要開。
 * 預設開（npm run dev 的本機開發）；看到任何「這是正式或對外部署」的訊號就關：
 *   SITE_MODE=production、NODE_ENV=production、有設 GATEWAY_TRUSTED_PROXIES（前面有反向代理）、有設 PUBLIC_ORIGIN（有對外網址）、DEV_ENDPOINTS=off。
 * DEV_ENDPOINTS=on 可強制打開（例如在測試機上排錯），啟動時會印警告。
 * 為什麼不能只靠「只限本機」：同機反向代理（deploy.md §14.5）轉進來的外部請求，socket 對端都是 127.0.0.1（稽核第 3 項）。
 * @param {Record<string, string | undefined>} [env]
 * @returns {{ on: boolean, forced: boolean, reasons: string[] }}
 */
export function devEndpointsFrom(env = process.env) {
  const v = String(env.DEV_ENDPOINTS ?? '')
    .trim()
    .toLowerCase();
  const reasons = [];
  if (env.SITE_MODE === 'production') reasons.push('SITE_MODE=production');
  if (env.NODE_ENV === 'production') reasons.push('NODE_ENV=production');
  if (String(env.GATEWAY_TRUSTED_PROXIES ?? '').trim()) reasons.push('GATEWAY_TRUSTED_PROXIES 有設定');
  if (String(env.PUBLIC_ORIGIN ?? '').trim()) reasons.push('PUBLIC_ORIGIN 有設定');
  if (v === 'off') reasons.push('DEV_ENDPOINTS=off');
  if (v === 'on') return { on: true, forced: true, reasons };
  return { on: reasons.length === 0, forced: false, reasons };
}

/**
 * 建立靜態檔處理函式。
 * @param {{ distDir: string, types?: Record<string, string>, onBeforeSend?: (res: import('node:http').ServerResponse) => void, log?: (msg: string) => void, now?: () => number }} opts
 */
export function createStaticHandler({ distDir, types = STATIC_TYPES, onBeforeSend, log = (m) => console.error(m), now = Date.now }) {
  const lastLogged = new Map(); // 錯誤碼 → 上次記 log 的時間（同一種錯誤每分鐘只記一行）
  const logOnce = (code, msg) => {
    const t = now();
    if (t - (lastLogged.get(code) ?? -Infinity) < 60_000) return;
    lastLogged.set(code, t);
    log(msg);
  };
  const plain = (res, status, text, headers = {}) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
    res.end(text);
    return true;
  };

  /**
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   * @param {string} url 已解碼、已去掉 basePath 的路徑
   */
  return function serveStatic(req, res, url) {
    const method = req.method ?? 'GET';
    if (method !== 'GET' && method !== 'HEAD') {
      req.resume?.();
      return plain(res, 405, 'method not allowed', { Allow: 'GET, HEAD' });
    }
    if (url.includes('\0')) return plain(res, 400, 'bad request');
    let file = resolveStatic(distDir, url);
    if (!file) {
      res.statusCode = 404;
      file = resolveStatic(distDir, '/404.html');
      if (!file) return plain(res, 404, 'not found');
    }
    onBeforeSend?.(res);
    res.setHeader('Content-Type', types[path.extname(file)] ?? 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (method === 'HEAD') return (res.end(), true);
    const stream = fs.createReadStream(file);
    stream.on('error', (e) => {
      const code = /** @type {any} */ (e)?.code ?? 'EUNKNOWN';
      logOnce(code, `[serve] 讀檔失敗（${code}）：${path.relative(distDir, file) || file}`);
      if (!res.headersSent) {
        res.statusCode = code === 'ENOENT' ? 404 : 500;
        res.removeHeader('Content-Type');
        res.end();
      } else res.destroy();
    });
    stream.pipe(res);
    return true;
  };
}
