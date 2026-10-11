/* global window, document */
// 智慧問答頁手機效能量測（第四十輪，Issue #80）：Playwright＋Chrome DevTools Protocol，模擬 Lighthouse 手機設定。
//
// 用法：BASE_PATH='' node scripts/build.mjs && node scripts/perf-ask.mjs
//   PERF_RUNS=3        每個情境跑幾次（取中位數；預設 3）
//   PERF_JSON=路徑     另存 JSON 結果
//   PERF_MAX_TBT_MS=…  /ask/?q=登革熱 的 TBT 中位數超過即 exit 1（不設＝只回報）
//   CHROME_BIN=…       指定 Chromium；預設用 /opt/pw-browsers 內最新的 chromium-*
//
// 為什麼不直接跑 Lighthouse：CI 與原型環境沒有 Lighthouse，且 Lighthouse 的 TBT 只算 FCP～TTI 之間，
// 答案頁的重活（下載索引、建引擎、檢索）常落在 TTI 判定附近，分數跳動大。這裡量的是「從開頁到答案畫出來」整段：
//   - longTaskMs：所有 long task（> 50 ms）的總長
//   - tbtMs：每個 long task 超過 50 ms 的部分加總（TBT 的定義，但區間延長到答案出現為止，比 Lighthouse 嚴格）
//   - transferKB：所有 response 的實際傳輸位元組（CDP encodedDataLength；本腳本的伺服器像 GitHub Pages 一樣 gzip 文字檔）
//   - jsonKB／jsKB：其中 JSON 與 JS 的傳輸量；answerMs：答案出現的時間；lcpMs：最大內容繪製
// 設定：4 倍 CPU 降速、412×823 手機視窗（Lighthouse 預設的 Moto G Power）、不降網速（網速只影響等待，不影響 TBT；
// 傳輸量另外列出，用 transferKB 判斷網路成本）。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = process.env.DIST_DIR ? path.resolve(process.env.DIST_DIR) : path.join(ROOT, 'dist');
const BASE = (process.env.BASE_PATH ?? '').replace(/\/$/, '');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};
const GZIP = new Set(['.html', '.css', '.js', '.json', '.svg']);

/** 情境：無 q 的初始畫面、帶 q 的深連結（Lighthouse 量的就是這個）、英文版 */
export const SCENARIOS = [
  { name: '/ask/（無 q）', path: '/ask/', waitAnswer: false },
  { name: '/ask/?q=登革熱', path: `/ask/?q=${encodeURIComponent('登革熱')}`, waitAnswer: true },
  { name: '/en/ask/?q=dengue', path: '/en/ask/?q=dengue', waitAnswer: true },
];

export function chromePath() {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;
  const root = '/opt/pw-browsers';
  if (fs.existsSync(root)) {
    const d = fs
      .readdirSync(root)
      .filter((x) => /^chromium-\d+$/.test(x))
      .sort()
      .pop();
    if (d) return path.join(root, d, 'chrome-linux/chrome');
  }
  return undefined;
}

/** 靜態伺服器（含 gzip，接近 GitHub Pages 的傳輸量） */
export function serveDist(dist = DIST) {
  const server = http.createServer((req, res) => {
    let url = decodeURIComponent(req.url.split('?')[0]);
    if (BASE && url.startsWith(BASE)) url = url.slice(BASE.length) || '/';
    let file = path.join(dist, url);
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) {
      file = path.join(dist, '404.html');
      res.statusCode = 404;
    }
    const ext = path.extname(file);
    res.setHeader('Content-Type', TYPES[ext] ?? 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    if (GZIP.has(ext) && /\bgzip\b/.test(req.headers['accept-encoding'] ?? '')) {
      res.setHeader('Content-Encoding', 'gzip');
      fs.createReadStream(file)
        .pipe(zlib.createGzip({ level: 6 }))
        .pipe(res);
    } else fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, origin: `http://127.0.0.1:${server.address().port}${BASE}` })));
}

/** 量一次：回傳 { tbtMs, longTaskMs, longTasks, transferKB, jsonKB, jsKB, requests, answerMs, lcpMs, jsonFiles } */
export async function measure(browser, url, { waitAnswer = true, cpu = 4 } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 823 }, deviceScaleFactor: 1.75, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
  const reqs = new Map();
  let bytes = 0;
  const byType = { json: 0, js: 0 };
  const jsonFiles = [];
  cdp.on('Network.responseReceived', (e) => reqs.set(e.requestId, e.response.url));
  cdp.on('Network.loadingFinished', (e) => {
    bytes += e.encodedDataLength;
    const u = (reqs.get(e.requestId) ?? '').split('?')[0];
    if (u.endsWith('.json')) {
      byType.json += e.encodedDataLength;
      jsonFiles.push(`${u.replace(/^https?:\/\/[^/]+/, '')} ${(e.encodedDataLength / 1024).toFixed(1)}KB`);
    } else if (u.endsWith('.js')) byType.js += e.encodedDataLength;
  });
  await page.addInitScript(() => {
    window.__perf = { long: [], lcp: 0 };
    try {
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) window.__perf.long.push(e.duration);
      }).observe({ type: 'longtask', buffered: true });
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) window.__perf.lcp = e.startTime;
      }).observe({ type: 'largest-contentful-paint', buffered: true });
    } catch {
      /* 不支援就留空 */
    }
  });
  // 主執行緒 long task 以 trace 為準（與 Lighthouse 相同來源：renderer 主執行緒上 > 50 ms 的頂層 RunTask）；
  // PerformanceObserver 的 longtask 會漏掉 JSON 解析、GC 等不歸屬於腳本的工作，只當對照
  await browser.startTracing(page, { categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline'] });
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'load' });
  let answerMs = null;
  if (waitAnswer) {
    await page.waitForFunction(
      () => document.querySelector('#answer .c-answer__inner') && document.querySelector('#answer')?.getAttribute('aria-busy') === 'false',
      null,
      { timeout: 120000 },
    );
    answerMs = Date.now() - t0;
  }
  // 讓答案之後的 idle 預取與 long task 有機會發生、被記錄（量的是使用者在這段時間內感受到的阻塞）
  await page.waitForTimeout(2500);
  const perf = await page.evaluate(() => window.__perf);
  const trace = JSON.parse((await browser.stopTracing()).toString('utf8'));
  await ctx.close();
  const long = mainThreadLongTasks(trace);
  const observed = perf?.long ?? [];
  return {
    tbtMs: Math.round(long.reduce((s, d) => s + Math.max(0, d - 50), 0)),
    longTaskMs: Math.round(long.reduce((s, d) => s + d, 0)),
    longTasks: long.length,
    observedLongTaskMs: Math.round(observed.reduce((s, d) => s + d, 0)),
    transferKB: +(bytes / 1024).toFixed(1),
    jsonKB: +(byType.json / 1024).toFixed(1),
    jsKB: +(byType.js / 1024).toFixed(1),
    requests: reqs.size,
    answerMs,
    lcpMs: Math.round(perf?.lcp ?? 0),
    jsonFiles,
  };
}

/** trace → renderer 主執行緒上 > 50 ms 的頂層工作（毫秒陣列） */
export function mainThreadLongTasks(trace) {
  const events = trace.traceEvents ?? trace;
  const main = new Set(events.filter((e) => e.name === 'thread_name' && e.args?.name === 'CrRendererMain').map((e) => `${e.pid}:${e.tid}`));
  const tasks = events.filter(
    (e) => e.ph === 'X' && (e.name === 'RunTask' || e.name === 'ThreadControllerImpl::RunTask') && main.has(`${e.pid}:${e.tid}`) && e.dur > 50000,
  );
  // 同一執行緒上巢狀的 RunTask 只算最外層
  tasks.sort((a, b) => a.ts - b.ts);
  const out = [];
  let end = -1;
  for (const t of tasks) {
    if (t.ts < end) continue;
    out.push(t.dur / 1000);
    end = t.ts + t.dur;
  }
  return out;
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) / 2)] : null;
};

/** 每個情境跑 runs 次，數值取中位數 */
export async function runAll({ runs = 3, scenarios = SCENARIOS, log = console.log } = {}) {
  if (!fs.existsSync(path.join(DIST, 'ask/index.html'))) throw new Error(`找不到 ${DIST}/ask/index.html：請先 BASE_PATH='' node scripts/build.mjs`);
  const { chromium } = await import('playwright');
  const { server, origin } = await serveDist();
  const browser = await chromium.launch({ executablePath: chromePath(), args: ['--no-sandbox'] });
  const out = [];
  try {
    for (const sc of scenarios) {
      const all = [];
      for (let i = 0; i < runs; i++) all.push(await measure(browser, `${origin}${sc.path}`, sc));
      const pick = (k) => median(all.map((r) => r[k]).filter((v) => v !== null));
      const row = {
        name: sc.name,
        tbtMs: pick('tbtMs'),
        longTaskMs: pick('longTaskMs'),
        longTasks: pick('longTasks'),
        transferKB: pick('transferKB'),
        jsonKB: pick('jsonKB'),
        jsKB: pick('jsKB'),
        answerMs: pick('answerMs'),
        lcpMs: pick('lcpMs'),
        requests: pick('requests'),
        jsonFiles: all[0].jsonFiles,
      };
      out.push(row);
      log(
        `${sc.name}：TBT ${row.tbtMs} ms（long task 合計 ${row.longTaskMs} ms，${row.longTasks} 個）、傳輸 ${row.transferKB} KB（JSON ${row.jsonKB}、JS ${row.jsKB}）、${row.requests} 個請求、答案 ${row.answerMs ?? '—'} ms、LCP ${row.lcpMs} ms`,
      );
    }
  } finally {
    await browser.close();
    server.close();
  }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rows = await runAll({ runs: Number(process.env.PERF_RUNS) || 3 });
  if (process.env.PERF_JSON) fs.writeFileSync(process.env.PERF_JSON, `${JSON.stringify(rows, null, 2)}\n`);
  for (const r of rows) console.log(`  ${r.name} JSON：${r.jsonFiles.join('、') || '（無）'}`);
  const max = Number(process.env.PERF_MAX_TBT_MS);
  const deep = rows.find((r) => r.name === '/ask/?q=登革熱');
  if (max && deep && deep.tbtMs > max) {
    console.error(`✗ /ask/?q=登革熱 TBT ${deep.tbtMs} ms 超過 PERF_MAX_TBT_MS=${max}`);
    process.exit(1);
  }
}
