// 全站 Lighthouse 效能檢測（第七十二輪，docs/performance-lighthouse.md）。
//
// 用法：BASE_PATH='' node scripts/build.mjs && npm run perf:lighthouse
//   LH_RUNS=3            每頁每種裝置跑幾次（取中位數；預設 3）
//   LH_PAGES=/,/faq/     要量的路徑（逗號分隔；預設見 DEFAULT_PAGES）
//   LH_FORMS=mobile      裝置：mobile、desktop（逗號分隔；預設兩種都量）
//   LH_OUT=目錄          每次量測的 JSON＋HTML 報告存哪裡（預設 .local/lighthouse/，已在 .gitignore）
//   LH_JSON=路徑         中位數摘要另存 JSON（預設 <LH_OUT>/summary.json）
//   LH_MIN_PERF=90       任一頁效能分數中位數低於此值即 exit 1（不設＝只回報）
//   DIST_DIR=…           量哪個建置（預設 dist/）；CHROME_BIN=… 指定 Chromium（預設與 perf-ask.mjs 相同的找法）
//
// 為什麼不放進必要 CI（docs/architecture-decisions.md、docs/deploy.md §15）：
//   GitHub 代管 runner 的 CPU 忙閒差很多，同一份程式的 TBT／效能分數可跳 ±30%（第四十八輪 #103 決策 7 量過）。
//   放進必要檢查會讓無關的 PR 隨機紅燈，大家學會「紅燈重跑」，真的退步反而被忽略。所以只做手動＋每月排程的
//   .github/workflows/lighthouse.yml（不擋合併），數字貼在 PR 說明或文件裡比較。
//
// Lighthouse 的盲點：答案頁 /ask/?q=… 與搜尋頁的重活（下載索引、建引擎）是 import() 之後才做的，
// Lighthouse 的 TBT 只算到 TTI，這些工作只被算到一部分（/ask/?q=登革熱 手機：Lighthouse TBT 約 340 ms，perf:ask 約 600–700 ms）。
// 答案頁請以 npm run perf:ask 為準（量到答案畫出來為止）。網址照實傳給 Lighthouse（含 ?q=），摘要也記實際網址：
// 第七十二輪的基準量測曾因臨時腳本把「名稱=路徑」依每個 = 切開，把 /ask/?q=登革熱 量成 /ask/?q，答案頁誤得 100 分。
//
// 伺服器：沿用 perf-ask.mjs 的 gzip 靜態伺服器，Cache-Control 設成 GitHub Pages 的 max-age=600，讓快取稽核看到與線上相同的標頭。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveDist, chromePath } from './perf-ask.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = process.env.DIST_DIR ? path.resolve(process.env.DIST_DIR) : path.join(ROOT, 'dist');

export const DEFAULT_PAGES = [
  '/',
  '/ask/',
  '/ask/?q=登革熱',
  '/diseases/dengue/',
  '/news/',
  '/vaccines/schedule/',
  '/search/?q=登革熱',
  '/travel/',
  '/play/',
  '/faq/',
  '/en/',
];
export const CHROME_FLAGS = ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'];

/** Lighthouse 設定：手機用預設（Moto G Power、模擬慢速 4G、4 倍 CPU 降速）；桌機用 Lighthouse 官方桌機預設的數值 */
export function lhFlags(form, port) {
  const base = {
    port,
    output: ['json', 'html'],
    logLevel: 'error',
    onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
    throttlingMethod: 'simulate',
  };
  if (form === 'desktop') {
    return {
      ...base,
      formFactor: 'desktop',
      screenEmulation: { mobile: false, width: 1350, height: 940, deviceScaleFactor: 1, disabled: false },
      throttling: { rttMs: 40, throughputKbps: 10240, cpuSlowdownMultiplier: 1, requestLatencyMs: 0, downloadThroughputKbps: 0, uploadThroughputKbps: 0 },
    };
  }
  return { ...base, formFactor: 'mobile', screenEmulation: { mobile: true, width: 412, height: 823, deviceScaleFactor: 1.75, disabled: false } };
}

export const median = (xs) => {
  const s = xs.filter((v) => typeof v === 'number' && !Number.isNaN(v)).sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) / 2)] : null;
};

/** 一份 lhr → 要比較的數字 */
export function pickMetrics(lhr) {
  const a = lhr.audits;
  const score = (k) => (lhr.categories[k]?.score == null ? null : Math.round(lhr.categories[k].score * 100));
  const rb = a['render-blocking-insight'] ?? a['render-blocking-resources'];
  return {
    perf: score('performance'),
    a11y: score('accessibility'),
    bp: score('best-practices'),
    seo: score('seo'),
    fcp: a['first-contentful-paint']?.numericValue ?? null,
    lcp: a['largest-contentful-paint']?.numericValue ?? null,
    tbt: a['total-blocking-time']?.numericValue ?? null,
    cls: a['cumulative-layout-shift']?.numericValue ?? null,
    si: a['speed-index']?.numericValue ?? null,
    transferKB: a['total-byte-weight']?.numericValue == null ? null : a['total-byte-weight'].numericValue / 1024,
    requests: a['network-requests']?.details?.items?.length ?? null,
    renderBlockingMs: rb?.metricSavings?.FCP ?? rb?.numericValue ?? null,
    failed: Object.values(lhr.categories)
      .flatMap((c) => c.auditRefs.filter((r) => r.weight > 0).map((r) => r.id))
      .filter((id) => a[id]?.score !== null && a[id]?.score < 1 && a[id]?.scoreDisplayMode === 'binary'),
  };
}

const fmt = {
  s: (ms) => (ms == null ? '—' : `${(ms / 1000).toFixed(1)} s`),
  ms: (ms) => (ms == null ? '—' : `${Math.round(ms)} ms`),
  kb: (kb) => (kb == null ? '—' : `${Math.round(kb)} KB`),
  cls: (v) => (v == null ? '—' : v.toFixed(3)),
};

/** 摘要 → markdown 表（貼到文件、PR 說明或 $GITHUB_STEP_SUMMARY） */
export function toMarkdown(rows) {
  const out = [
    '| 路徑 | 裝置 | 效能（各次） | 中位 | 無障礙 | 最佳實務 | SEO | FCP | LCP | TBT | CLS | SI | 傳輸 | 請求 | 擋畫面估計 |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const r of rows) {
    const m = r.median;
    out.push(
      `| \`${r.path}\` | ${r.form === 'desktop' ? '桌機' : '手機'} | ${r.runs.map((x) => x.perf).join('/')} | ${m.perf} | ${m.a11y} | ${m.bp} | ${m.seo} | ${fmt.s(m.fcp)} | ${fmt.s(m.lcp)} | ${fmt.ms(m.tbt)} | ${fmt.cls(m.cls)} | ${fmt.s(m.si)} | ${fmt.kb(m.transferKB)} | ${m.requests ?? '—'} | ${fmt.ms(m.renderBlockingMs)} |`,
    );
  }
  return out.join('\n');
}

export async function runAll({
  pages = DEFAULT_PAGES,
  forms = ['mobile', 'desktop'],
  runs = 3,
  outDir = path.join(ROOT, '.local/lighthouse'),
  log = console.log,
} = {}) {
  if (!fs.existsSync(path.join(DIST, 'index.html'))) throw new Error(`找不到 ${DIST}/index.html：請先 BASE_PATH='' node scripts/build.mjs`);
  if (!fs.readFileSync(path.join(DIST, 'index.html'), 'utf8').includes('data-base=""')) {
    throw new Error(`${DIST} 不是根路徑建置：請用 BASE_PATH='' node scripts/build.mjs 重建（本腳本在 / 提供 dist）`);
  }
  fs.mkdirSync(outDir, { recursive: true });
  const { default: lighthouse } = await import('lighthouse');
  const chromeLauncher = await import('chrome-launcher');
  let bin = chromePath();
  if (!bin) {
    try {
      const { chromium } = await import('playwright');
      bin = chromium.executablePath();
    } catch {
      /* 交給 chrome-launcher 自己找系統上的 Chrome */
    }
  }
  const { server, origin } = await serveDist(DIST, { cacheControl: 'max-age=600' });
  const chrome = await chromeLauncher.launch({ chromePath: bin, chromeFlags: CHROME_FLAGS });
  const rows = [];
  try {
    for (const p of pages) {
      for (const form of forms) {
        const all = [];
        for (let i = 0; i < runs; i++) {
          const rr = await lighthouse(`${origin}${encodeURI(p)}`, lhFlags(form, chrome.port));
          if (!rr) throw new Error(`Lighthouse 沒有回傳結果：${p}`);
          const tag = `${p.replace(/[^\w]+/g, '_').replace(/^_|_$/g, '') || 'home'}-${form}-${i + 1}`;
          const [json, htmlReport] = /** @type {string[]} */ (rr.report);
          fs.writeFileSync(path.join(outDir, `${tag}.json`), json);
          fs.writeFileSync(path.join(outDir, `${tag}.html`), htmlReport);
          all.push(pickMetrics(rr.lhr));
        }
        const med = {};
        for (const k of Object.keys(all[0])) if (k !== 'failed') med[k] = median(all.map((r) => r[k]));
        const row = { path: p, form, runs: all.map(({ failed, ...r }) => r), median: med, failed: [...new Set(all.flatMap((r) => r.failed))] };
        rows.push(row);
        log(
          `${p.padEnd(22)} ${form.padEnd(7)} 效能 ${all.map((r) => r.perf).join('/')}（中位 ${med.perf}）無障礙 ${med.a11y} 最佳實務 ${med.bp} SEO ${med.seo}｜FCP ${fmt.s(med.fcp)} LCP ${fmt.s(med.lcp)} TBT ${fmt.ms(med.tbt)} CLS ${fmt.cls(med.cls)}｜${fmt.kb(med.transferKB)}、${med.requests} 個請求、擋畫面估計 ${fmt.ms(med.renderBlockingMs)}${row.failed.length ? `｜未過：${row.failed.join('、')}` : ''}`,
        );
      }
    }
  } finally {
    await chrome.kill();
    server.close();
  }
  return rows;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outDir = process.env.LH_OUT ? path.resolve(process.env.LH_OUT) : path.join(ROOT, '.local/lighthouse');
  const pages = process.env.LH_PAGES
    ? process.env.LH_PAGES.split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : DEFAULT_PAGES;
  const forms = (process.env.LH_FORMS || 'mobile,desktop')
    .split(',')
    .map((s) => s.trim())
    .filter((f) => f === 'mobile' || f === 'desktop');
  const rows = await runAll({ pages, forms, runs: Number(process.env.LH_RUNS) || 3, outDir });
  const summary = process.env.LH_JSON ? path.resolve(process.env.LH_JSON) : path.join(outDir, 'summary.json');
  fs.writeFileSync(summary, `${JSON.stringify({ generatedAt: new Date().toISOString(), runs: Number(process.env.LH_RUNS) || 3, rows }, null, 2)}\n`);
  console.log(`\n${toMarkdown(rows)}\n`);
  console.log(`報告 → ${path.relative(ROOT, outDir) || outDir}/（每次量測的 .json／.html）；摘要 → ${path.relative(ROOT, summary) || summary}`);
  console.log('提醒：/ask/?q=… 的重活多半在 TTI 之後，Lighthouse 的 TBT 只算到一部分；答案頁請以 npm run perf:ask 為準。');
  const min = Number(process.env.LH_MIN_PERF);
  const low = min ? rows.filter((r) => r.median.perf != null && r.median.perf < min) : [];
  if (low.length) {
    console.error(`✗ 效能分數中位數低於 LH_MIN_PERF=${min}：${low.map((r) => `${r.path}（${r.form}）${r.median.perf}`).join('、')}`);
    process.exit(1);
  }
}
