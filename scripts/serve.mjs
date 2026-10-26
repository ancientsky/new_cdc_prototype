// 本機預覽：node scripts/serve.mjs [port]；會依 basePath 服務 dist/
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../site.config.mjs';
import { ROOT } from './lib/load.mjs';
import { createSubscriptionApi } from './lib/subscribe-mock.mjs';
import { createGatewayApi } from './lib/gateway/index.mjs';
import { createAskLogApi } from './lib/ask-log-mock.mjs';
import { createIntlFeedApi } from './lib/intl-feed-api.mjs';

const DIST = process.env.DIST_DIR ? path.resolve(process.env.DIST_DIR) : path.join(ROOT, 'dist');
const port = Number(process.argv[2] || process.env.PORT || 4173);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.md': 'text/markdown; charset=utf-8', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

// 第二十八輪：電子報訂閱的 HTTP 模擬後端（/api/*，資料與模擬信件寫在 .local/，見 scripts/lib/subscribe-mock.mjs）
// 第六十二輪（Issue #140）：三個模擬後端的速率限制（docs/deploy.md §31）。MOCK_RATE_LIMIT=off 關閉（端到端測試用：Playwright 一分鐘內點很多下）；
// 放在反向代理後面試跑時，代理位址與閘道共用 GATEWAY_TRUSTED_PROXIES（才採信 X-Forwarded-For）
const mockRateOff = process.env.MOCK_RATE_LIMIT === 'off';
const trustedProxies = String(process.env.GATEWAY_TRUSTED_PROXIES ?? '').split(/[,\s]+/).filter(Boolean);
const subscribeApi = createSubscriptionApi({ trustedProxies, ...(mockRateOff ? { httpRate: null } : {}) });
// 第三十輪：寫入閘道（/api/gateway/*；後台的儲存草稿／送審／退回／核准上線，背後寫進 .local/gateway-repo/，見 scripts/lib/gateway/）。GATEWAY=off 可關閉
const gateway = process.env.GATEWAY === 'off' ? null : createGatewayApi();
// 第四十一輪：智慧問答查詢紀錄的模擬後端（POST /api/ask-log → .local/ask-log/；本機報表 /api/dev/ask-log/report，見 scripts/lib/ask-log-mock.mjs、docs/ask-log.md）
// 要掛在訂閱模擬後端之前：訂閱模擬後端對不認得的 /api/ 路徑一律回 404。
const askLogApi = createAskLogApi({ trustedProxies, ...(mockRateOff ? { rate: null } : {}) });
// 第四十三輪：國際重要疫情資訊推送端點（POST /api/intl-epidemic，Bearer INTL_FEED_TOKEN；沒設定權杖時回 503，見 scripts/lib/intl-feed-api.mjs、docs/intl-epidemic.md）。
// 有閘道就共用它的版本庫與稽核紀錄；同樣要掛在訂閱模擬後端之前。
const intlFeedApi = createIntlFeedApi({ gitProvider: gateway?.git, audit: gateway?.audit, trustedProxies, ...(mockRateOff ? { rate: null } : {}) });

http.createServer(async (req, res) => {
  const parsed = new URL(req.url, 'http://localhost');
  let url;
  try { url = decodeURIComponent(parsed.pathname); } catch { res.statusCode = 400; return res.end('bad request'); }
  if (config.basePath && url.startsWith(config.basePath)) url = url.slice(config.basePath.length) || '/';
  if (gateway && await gateway.handle(req, res, url, parsed.searchParams)) return;
  if (await intlFeedApi.handle(req, res, url, parsed.searchParams)) return;
  if (await askLogApi.handle(req, res, url, parsed.searchParams)) return;
  if (await subscribeApi.handle(req, res, url, parsed.searchParams)) return;
  let file = path.join(DIST, url);
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { file = path.join(DIST, '404.html'); res.statusCode = 404; }
  if (!fs.existsSync(file)) { res.statusCode = 404; return res.end('not found'); }
  res.setHeader('Set-Cookie', askLogApi.cookie); // 第四十一輪：告訴答案頁「這裡有查詢紀錄模擬後端」（只是標記，不含資料）
  res.setHeader('Content-Type', types[path.extname(file)] ?? 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
}).listen(port, () => console.log(`http://localhost:${port}${config.basePath}/\n訂閱模擬後端：/api/health；模擬信件 → ${path.relative(ROOT, subscribeApi.outboxDir)}/\n查詢紀錄模擬後端：POST /api/ask-log → ${path.relative(ROOT, askLogApi.dir)}/（報表：/api/dev/ask-log/report、/admin/ask-log/）\n國際疫情推送端點：POST /api/intl-epidemic（${intlFeedApi.enabled ? '已啟用' : '未啟用：沒設 INTL_FEED_TOKEN'}）${gateway ? `\n寫入閘道：/api/gateway/health（身分：${gateway.config.auth.mode}；版本庫 → ${path.relative(ROOT, gateway.config.git.dir)}/）` : ''}`));
