// 無障礙自動檢測（第二十四輪）：用 Playwright 開 Chromium，對 dist/ 的代表頁跑 axe-core。
/* global document */
// 用法：BASE_PATH='' node scripts/build.mjs && npm run a11y
// - 本腳本「不建置」，只讀 dist/（或 DIST_DIR）；沒有 dist 會明確報錯。
// - 每個樣板挑一頁代表，桌機 1280px 與手機 320px 各跑一次（320px 同時檢查橫向捲動，對應 WCAG 1.4.10 Reflow）。
// - serious／critical 違規 → exit 1；moderate／minor 只列警告。
// - 瀏覽器：CHROME_BIN 優先；其次本機 /opt/pw-browsers 內的 chromium；最後用 Playwright 內建（npx playwright install chromium）。
// - 結果同時輸出 Markdown 摘要：A11Y_REPORT=路徑 可另存檔；在 GitHub Actions 會自動附加到 job summary。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = process.env.DIST_DIR ? path.resolve(process.env.DIST_DIR) : path.join(ROOT, 'dist');
// 靜態伺服器要認得 basePath；建置時用 BASE_PATH='' 最單純，沒設則沿用站台設定
const BASE = (process.env.BASE_PATH ?? process.env.A11Y_BASE_PATH ?? '').replace(/\/$/, '');

/** 代表頁：每種樣板一頁；dist 內不存在的路徑會被略過並列警告 */
export const PAGES = [
  '/', '/diseases/dengue/', '/diseases/', '/vaccines/', '/travel/', '/news/', '/faq/', '/ask/', '/situation/', '/data/', '/pro/',
  '/admin/', '/admin/publish/', '/en/', '/vi/',
  // 第二十八輪：全文搜尋——空狀態與「已有查詢結果」兩種畫面都要掃（結果清單是動態產生的）
  '/search/', '/search/?q=%E7%99%BB%E9%9D%A9%E7%86%B1&type=faq,news',
];
export const VIEWPORTS = [{ name: '桌機 1280', width: 1280, height: 900 }, { name: '手機 320', width: 320, height: 700 }];
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa', 'best-practice'];
const BLOCKING = new Set(['serious', 'critical']);

const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.md': 'text/markdown; charset=utf-8', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

function serve() {
  const server = http.createServer((req, res) => {
    let url = decodeURIComponent(req.url.split('?')[0]);
    if (BASE && url.startsWith(BASE)) url = url.slice(BASE.length) || '/';
    let file = path.join(DIST, url);
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) { file = path.join(DIST, '404.html'); res.statusCode = 404; }
    if (!fs.existsSync(file)) { res.statusCode = 404; return res.end('not found'); }
    res.setHeader('Content-Type', types[path.extname(file)] ?? 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port })));
}

function chromePath() {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  try {
    const d = fs.readdirSync(root).filter((x) => /^chromium-\d+$/.test(x)).sort().pop();
    const p = d && path.join(root, d, 'chrome-linux', 'chrome');
    if (p && fs.existsSync(p)) return p;
  } catch { /* 沒有就用 Playwright 內建 */ }
  return undefined;
}

const exists = (p) => fs.existsSync(path.join(DIST, p.split('?')[0].replace(/^\//, ''), 'index.html'));
const short = (s, n = 140) => (s.length > n ? `${s.slice(0, n)}…` : s).replace(/\s+/g, ' ');

async function main() {
  if (!fs.existsSync(path.join(DIST, 'index.html'))) {
    console.error(`找不到 ${DIST}/index.html。請先建置：BASE_PATH='' node scripts/build.mjs（本腳本不會自己建置）`);
    process.exit(2);
  }
  const { chromium } = await import('playwright');
  const { AxeBuilder } = await import('@axe-core/playwright');
  const { server, port } = await serve();
  const origin = `http://127.0.0.1:${port}${BASE}`;
  const browser = await chromium.launch({ executablePath: chromePath(), args: ['--no-sandbox'] });
  const findings = []; // { page, vp, rule, impact, help, helpUrl, nodes:[{target, summary}] }
  const overflow = []; // { page, vp, scrollWidth, clientWidth }
  const skipped = [];
  let runs = 0;
  try {
    for (const vp of VIEWPORTS) {
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
      for (const p of PAGES) {
        if (!exists(p)) { if (!skipped.includes(p)) skipped.push(p); continue; }
        const page = await ctx.newPage();
        try {
          await page.goto(`${origin}${p}`, { waitUntil: 'networkidle' });
          if (p.includes('/search/?q=')) await page.waitForSelector('#search-results li', { timeout: 15000 }); // 全文搜尋：等 Pagefind 載入並畫出結果才掃（逾時 ⇒ 例外 ⇒ 整個檢測失敗，比掃到空畫面誠實）
          await page.waitForTimeout(300);
          const res = await new AxeBuilder({ page }).withTags(TAGS).analyze();
          runs++;
          for (const v of res.violations) {
            findings.push({ page: p, vp: vp.name, rule: v.id, impact: v.impact, help: v.help, helpUrl: v.helpUrl, nodes: v.nodes.map((n) => ({ target: n.target.join(' '), html: short(n.html) })) });
          }
          if (vp.width <= 320) {
            const w = await page.evaluate(/* eslint-disable-line no-undef -- 在瀏覽器裡執行 */() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
            if (w.s > w.c) overflow.push({ page: p, vp: vp.name, scrollWidth: w.s, clientWidth: w.c });
          }
        } finally { await page.close(); }
      }
      await ctx.close();
    }
  } finally { await browser.close(); server.close(); }

  const blocking = findings.filter((f) => BLOCKING.has(f.impact));
  const warn = findings.filter((f) => !BLOCKING.has(f.impact));
  const md = [];
  md.push('## 無障礙檢測（axe-core）', '');
  md.push(`- 掃描：${runs} 次（${PAGES.length - skipped.length} 頁 × ${VIEWPORTS.map((v) => v.name).join('、')}）；規則集：${TAGS.join(', ')}`);
  if (skipped.length) md.push(`- 略過（dist 內沒有）：${skipped.join('、')}`);
  md.push(`- 結果：**${blocking.length + overflow.length} 項阻擋**（serious／critical${overflow.length ? '＋320px 橫向捲動' : ''}）、${warn.length} 項警告（moderate／minor）`, '');
  const table = (rows, title) => {
    if (!rows.length) return;
    md.push(`### ${title}`, '', '| 影響 | 規則 | 頁面 | 視窗 | 節點數 | 範例節點 |', '|---|---|---|---|---|---|');
    for (const f of rows) md.push(`| ${f.impact} | [${f.rule}](${f.helpUrl}) ${f.help} | \`${f.page}\` | ${f.vp} | ${f.nodes.length} | \`${f.nodes[0].target.replace(/\|/g, '\\|')}\` |`);
    md.push('');
  };
  table(blocking, '阻擋（serious／critical）');
  if (overflow.length) {
    md.push('### 阻擋：320px 橫向捲動（WCAG 1.4.10）', '', '| 頁面 | scrollWidth | clientWidth |', '|---|---|---|');
    for (const o of overflow) md.push(`| \`${o.page}\` | ${o.scrollWidth} | ${o.clientWidth} |`);
    md.push('');
  }
  table(warn, '警告（moderate／minor，不擋合併）');
  if (!findings.length && !overflow.length) md.push('沒有任何違規。', '');
  const report = md.join('\n');
  console.log(report);
  for (const f of blocking) console.log(`\n[${f.impact}] ${f.rule} @ ${f.page} (${f.vp})\n` + f.nodes.slice(0, 4).map((n) => `  - ${n.target}\n    ${n.html}`).join('\n'));
  if (process.env.A11Y_REPORT) fs.writeFileSync(process.env.A11Y_REPORT, `${report}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) { try { fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`); } catch { /* 摘要寫不進去不影響結果 */ } }
  process.exit(blocking.length || overflow.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
