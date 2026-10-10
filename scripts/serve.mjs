// 本機預覽：node scripts/serve.mjs [port]；會依 basePath 服務 dist/
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../site.config.mjs';
import { ROOT } from './lib/load.mjs';
import { createSubscriptionApi } from './lib/subscribe-mock.mjs';
import { createGatewayApi } from './lib/gateway/index.mjs';

const DIST = process.env.DIST_DIR ? path.resolve(process.env.DIST_DIR) : path.join(ROOT, 'dist');
const port = Number(process.argv[2] || process.env.PORT || 4173);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.md': 'text/markdown; charset=utf-8', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

// 第二十八輪：電子報訂閱的 HTTP 模擬後端（/api/*，資料與模擬信件寫在 .local/，見 scripts/lib/subscribe-mock.mjs）
const subscribeApi = createSubscriptionApi();
// 第三十輪：寫入閘道（/api/gateway/*；後台的儲存草稿／送審／退回／核准上線，背後寫進 .local/gateway-repo/，見 scripts/lib/gateway/）。GATEWAY=off 可關閉
const gateway = process.env.GATEWAY === 'off' ? null : createGatewayApi();

http.createServer(async (req, res) => {
  const parsed = new URL(req.url, 'http://localhost');
  let url;
  try { url = decodeURIComponent(parsed.pathname); } catch { res.statusCode = 400; return res.end('bad request'); }
  if (config.basePath && url.startsWith(config.basePath)) url = url.slice(config.basePath.length) || '/';
  if (gateway && await gateway.handle(req, res, url, parsed.searchParams)) return;
  if (await subscribeApi.handle(req, res, url, parsed.searchParams)) return;
  let file = path.join(DIST, url);
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { file = path.join(DIST, '404.html'); res.statusCode = 404; }
  if (!fs.existsSync(file)) { res.statusCode = 404; return res.end('not found'); }
  res.setHeader('Content-Type', types[path.extname(file)] ?? 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
}).listen(port, () => console.log(`http://localhost:${port}${config.basePath}/\n訂閱模擬後端：/api/health；模擬信件 → ${path.relative(ROOT, subscribeApi.outboxDir)}/${gateway ? `\n寫入閘道：/api/gateway/health（身分：${gateway.config.auth.mode}；版本庫 → ${path.relative(ROOT, gateway.config.git.dir)}/）` : ''}`));
