// 本機預覽：node scripts/serve.mjs [port]；會依 basePath 服務 dist/
import http from 'node:http';
import path from 'node:path';
import { config } from '../site.config.mjs';
import { ROOT } from './lib/load.mjs';
import { createSubscriptionApi } from './lib/subscribe-mock.mjs';
import { createGatewayApi } from './lib/gateway/index.mjs';
import { createAskLogApi } from './lib/ask-log-mock.mjs';
import { createIntlFeedApi } from './lib/intl-feed-api.mjs';
import { createStaticHandler, devEndpointsFrom, STATIC_TYPES } from './lib/static-serve.mjs';

const DIST = process.env.DIST_DIR ? path.resolve(process.env.DIST_DIR) : path.join(ROOT, 'dist');
const port = Number(process.argv[2] || process.env.PORT || 4173);
// 第七十三輪（安全稽核，docs/deploy.md §35）：開發用端點（/api/dev/outbox、/api/dev/ask-log/report）只在本機開發時開。
// SITE_MODE／NODE_ENV=production、GATEWAY_TRUSTED_PROXIES、PUBLIC_ORIGIN 任何一個有設 ⇒ 關；DEV_ENDPOINTS=off 關、=on 強制開（印警告）
const dev = devEndpointsFrom(process.env);
if (dev.forced) console.warn(`[serve] 警告：DEV_ENDPOINTS=on 強制開啟開發用端點（模擬信件匣含所有訂閱者信箱與 token）。${dev.reasons.length ? `偵測到正式環境訊號：${dev.reasons.join('、')}。` : ''}正式環境不得開啟。`);

// 第二十八輪：電子報訂閱的 HTTP 模擬後端（/api/*，資料與模擬信件寫在 .local/，見 scripts/lib/subscribe-mock.mjs）
// 第六十三輪（Issue #140）：三個模擬後端的速率限制（docs/deploy.md §31）。MOCK_RATE_LIMIT=off 關閉（端到端測試用：Playwright 一分鐘內點很多下）；
// 放在反向代理後面試跑時，代理位址與閘道共用 GATEWAY_TRUSTED_PROXIES（才採信 X-Forwarded-For）
const mockRateOff = process.env.MOCK_RATE_LIMIT === 'off';
const trustedProxies = String(process.env.GATEWAY_TRUSTED_PROXIES ?? '').split(/[,\s]+/).filter(Boolean);
const subscribeApi = createSubscriptionApi({ trustedProxies, devOutbox: dev.on, ...(mockRateOff ? { httpRate: null } : {}) });
// 第三十輪：寫入閘道（/api/gateway/*；後台的儲存草稿／送審／退回／核准上線，背後寫進 .local/gateway-repo/，見 scripts/lib/gateway/）。GATEWAY=off 可關閉
const gateway = process.env.GATEWAY === 'off' ? null : createGatewayApi();
// 第四十一輪：智慧問答查詢紀錄的模擬後端（POST /api/ask-log → .local/ask-log/；本機報表 /api/dev/ask-log/report，見 scripts/lib/ask-log-mock.mjs、docs/ask-log.md）
// 要掛在訂閱模擬後端之前：訂閱模擬後端對不認得的 /api/ 路徑一律回 404。
const askLogApi = createAskLogApi({ trustedProxies, devReport: dev.on, ...(mockRateOff ? { rate: null } : {}) });
// 第四十三輪：國際重要疫情資訊推送端點（POST /api/intl-epidemic，Bearer INTL_FEED_TOKEN；沒設定權杖時回 503，見 scripts/lib/intl-feed-api.mjs、docs/intl-epidemic.md）。
// 有閘道就共用它的版本庫與稽核紀錄；同樣要掛在訂閱模擬後端之前。
const intlFeedApi = createIntlFeedApi({ gitProvider: gateway?.git, audit: gateway?.audit, trustedProxies, ...(mockRateOff ? { rate: null } : {}) });

// 第七十三輪：路徑穿越（..%2f）、讀檔錯誤讓 process 當掉、非 GET/HEAD 也能取檔——三件事都在 static-serve.mjs 修，並有回歸測試
const serveStatic = createStaticHandler({
  distDir: DIST,
  types: STATIC_TYPES,
  onBeforeSend: (res) => res.setHeader('Set-Cookie', askLogApi.cookie), // 第四十一輪：告訴答案頁「這裡有查詢紀錄模擬後端」（只是標記，不含資料）
});
const bp = config.basePath;

http.createServer(async (req, res) => {
  try {
    const parsed = new URL(req.url ?? '/', 'http://localhost');
    let url;
    try { url = decodeURIComponent(parsed.pathname); } catch { res.statusCode = 400; return res.end('bad request'); }
    if (url.includes('\0')) { res.statusCode = 400; return res.end('bad request'); }
    // 第七十三輪（稽核 §18-b）：basePath 前綴要有邊界——/new_cdc_prototypeXYZ 不是 /new_cdc_prototype/XYZ
    if (bp && (url === bp || url.startsWith(`${bp}/`))) url = url.slice(bp.length) || '/';
    if (gateway && await gateway.handle(req, res, url, parsed.searchParams)) return;
    if (await intlFeedApi.handle(req, res, url, parsed.searchParams)) return;
    if (await askLogApi.handle(req, res, url, parsed.searchParams)) return;
    if (await subscribeApi.handle(req, res, url, parsed.searchParams)) return;
    serveStatic(req, res, url);
  } catch (e) {
    // 最外層：任何沒接住的錯誤只回 500，不讓整個 process（含寫入閘道）停擺
    console.error('[serve] 處理請求失敗：', e?.message ?? e);
    if (!res.headersSent) { res.statusCode = 500; res.end('server error'); } else res.destroy();
  }
}).listen(port, () => console.log(`http://localhost:${port}${config.basePath}/\n訂閱模擬後端：/api/health；模擬信件 → ${path.relative(ROOT, subscribeApi.outboxDir)}/\n查詢紀錄模擬後端：POST /api/ask-log → ${path.relative(ROOT, askLogApi.dir)}/（報表：/admin/ask-log/）\n國際疫情推送端點：POST /api/intl-epidemic（${intlFeedApi.enabled ? '已啟用' : '未啟用：沒設 INTL_FEED_TOKEN'}）\n開發用端點（/api/dev/outbox、/api/dev/ask-log/report）：${dev.on ? (dev.forced ? `已開啟（DEV_ENDPOINTS=on 強制；正式環境不得開啟）` : '已開啟（本機開發；只接受本機直連）') : `已關閉（${dev.reasons.join('、')}）`}${gateway ? `\n寫入閘道：/api/gateway/health（身分：${gateway.config.auth.mode}；版本庫 → ${path.relative(ROOT, gateway.config.git.dir)}/）` : ''}`));
