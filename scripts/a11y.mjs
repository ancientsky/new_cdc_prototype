// 無障礙自動檢測（第二十四輪）：用 Playwright 開 Chromium，對 dist/ 的代表頁跑 axe-core。
/* global document */
// 用法：BASE_PATH='' node scripts/build.mjs && npm run a11y
//       或掃有子路徑的建置（CI 的做法，第五十六輪）：BASE_PATH=/repo/preview/pr-N DIST_DIR=… node scripts/build.mjs，
//       再以相同的 BASE_PATH、DIST_DIR 執行 npm run a11y（靜態伺服器把網址的 BASE_PATH 前綴去掉再對應到 DIST_DIR）。
// - 本腳本「不建置」，只讀 dist/（或 DIST_DIR）；沒有 dist 會明確報錯。
// - 每個樣板挑一頁代表，桌機 1280px 與手機 320px 各跑一次（320px 同時檢查橫向捲動，對應 WCAG 1.4.10 Reflow）。
// - serious／critical 違規 → exit 1；moderate／minor 只列警告（不擋合併），但數量會輸出：報告開頭、終端機最後一行，
//   以及 A11Y_JSON=路徑 的機器可讀摘要（第四十輪 #83：CI 的 PR 留言讀這份，讓「不擋但有警告」看得到，不會悄悄累積）。
// - 瀏覽器：CHROME_BIN 優先；其次本機 /opt/pw-browsers 內的 chromium；最後用 Playwright 內建（npx playwright install chromium）。
// - 結果同時輸出 Markdown 摘要：A11Y_REPORT=路徑 可另存檔；在 GitHub Actions 會自動附加到 job summary。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = process.env.DIST_DIR ? path.resolve(process.env.DIST_DIR) : path.join(ROOT, 'dist');
// 靜態伺服器要認得 basePath：與建置時的 BASE_PATH 相同（CI 掃預覽建置時是 /repo/preview/pr-N；本機用 BASE_PATH='' 最單純）
const BASE = (process.env.BASE_PATH ?? process.env.A11Y_BASE_PATH ?? '').replace(/\/$/, '');

/** 代表頁：每種樣板一頁；dist 內不存在的路徑會被略過並列警告 */
export const PAGES = [
  '/', '/diseases/dengue/', '/diseases/', '/vaccines/', '/travel/', '/news/', '/faq/', '/ask/', '/procurement/', '/careers/', '/situation/', '/data/', '/pro/',
  '/ask/?q=%E7%99%BB%E9%9D%A9%E7%86%B1', // 第四十輪（#83）：答案卡渲染後的畫面（標題層級只有載入答案後才看得到，空的 /ask/ 掃不到）
  '/subscribe/', '/en/subscribe/', '/topics/antivenom/', '/admin/', '/admin/publish/', '/admin/review/', '/en/', '/vi/', // 第三十輪：複核區（線上審核區塊要有閘道才顯示，另在 tests/round30-gateway.test.mjs 的端到端跑 axe）
  '/documents/curriculum-dengue.2026-10-10/', // 第二十八輪：核心教材（長文件版面＋學習目標＋示範匯入警示）
  // 第二十八輪：全文搜尋——空狀態與「已有查詢結果」兩種畫面都要掃（結果清單是動態產生的）
  '/search/', '/search/?q=%E7%99%BB%E9%9D%A9%E7%86%B1&type=faq,news',
  // 第五十一輪：精選結果卡（英文版有該語言頁；印尼文版退回中文正本、帶 lang／hreflang 與「此語言無此頁」標記）
  '/en/search/?q=dengue', '/id/search/?q=demam%20berdarah',
  // 第六十二輪：互動與彩蛋（測驗與模擬是動態產生的按鈕；後台開關頁）
  '/play/', '/play/kids-quiz/', '/play/policy-sim-dengue/', '/play/on-this-day/', '/admin/interactives/',
  '/play/hiv-myths/', // 第六十四輪：一般民眾衛教測驗（quiz 種類，真的／假的兩選項）
];
// 第四十八輪（#98）：新增「文字 200%／390」——390 px 寬、根字級放大到 200%（WCAG 1.4.4 放大文字＋1.4.10 Reflow 的實際合併情境）；
// 這個模式與 320 px 一樣要檢查橫向捲動，並列為阻擋項。
export const VIEWPORTS = [{ name: '桌機 1280', width: 1280, height: 900 }, { name: '手機 320', width: 320, height: 700 }, { name: '文字 200%／390', width: 390, height: 700, fontScale: 200 }];
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
  // 第五十六輪：同站資源回 404（CSS、JS、索引、答案資料）＝掃到的畫面和民眾看到的不同（最常見是 BASE_PATH 與建置不一致）→ 列為阻擋。
  // /api/ 是動態端點（例如電子報頁探測 /api/health，靜態主機本來就沒有，頁面會退回模擬模式），不算靜態資源
  const missing = []; // { page, vp, url }
  let runs = 0;
  try {
    for (const vp of VIEWPORTS) {
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
      for (const p of PAGES) {
        // 全文搜尋的「有結果」畫面要 Pagefind 索引；用 PAGEFIND=off 建置的 dist（本機快速檢查）沒有索引，列為略過而不是逾時失敗。CI 的 dist 一定有索引。
        const noIndex = p.includes('/search/?q=') && !fs.existsSync(path.join(DIST, 'pagefind'));
        if (noIndex || !exists(p)) { if (!skipped.includes(p)) skipped.push(p); continue; }
        const page = await ctx.newPage();
        page.on('response', (r) => {
          const u = r.url();
          const rel = u.slice(`http://127.0.0.1:${port}`.length).split('?')[0];
          if (r.status() === 404 && u.startsWith(`http://127.0.0.1:${port}/`) && !rel.startsWith(`${BASE}/api/`)) missing.push({ page: p, vp: vp.name, url: u.slice(`http://127.0.0.1:${port}`.length) });
        });
        try {
          const resp = await page.goto(`${origin}${p}`, { waitUntil: 'networkidle' });
          // 第五十六輪：BASE_PATH 對不上時伺服器回 404.html，axe 會掃到錯誤頁卻顯示通過；主文件不是 2xx 就當整個檢測失敗
          if (!resp || resp.status() >= 400) throw new Error(`${p}：HTTP ${resp ? resp.status() : '無回應'}（BASE_PATH「${BASE}」與 DIST_DIR 的建置是否一致？）`);
          if (vp.fontScale) await page.evaluate((pct) => { document.documentElement.style.fontSize = `${pct}%`; }, vp.fontScale);
          if (p.includes('/ask/?q=')) await page.waitForSelector('#answer[aria-busy="false"]', { timeout: 15000 }); // 答案由前端引擎渲染，等到有內容才掃（逾時 ⇒ 失敗，比掃到空畫面誠實）
          if (p.includes('/search/?q=')) await page.waitForSelector('#search-results li', { timeout: 15000 }); // 全文搜尋：等 Pagefind 載入並畫出結果才掃（逾時 ⇒ 例外 ⇒ 整個檢測失敗，比掃到空畫面誠實）
          await page.waitForTimeout(300);
          const res = await new AxeBuilder({ page }).withTags(TAGS).analyze();
          runs++;
          for (const v of res.violations) {
            findings.push({ page: p, vp: vp.name, rule: v.id, impact: v.impact, help: v.help, helpUrl: v.helpUrl, nodes: v.nodes.map((n) => ({ target: n.target.join(' '), html: short(n.html) })) });
          }
          if (vp.width <= 390) {
            const w = await page.evaluate(/* eslint-disable-line no-undef -- 在瀏覽器裡執行 */() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
            if (w.s > w.c) overflow.push({ page: p, vp: vp.name, scrollWidth: w.s, clientWidth: w.c });
          }
        } finally { await page.close(); }
      }
      await ctx.close();
    }
  } finally { await browser.close(); server.close(); }

  const blocking = findings.filter((f) => BLOCKING.has(f.impact));
  const nBlock = blocking.length + overflow.length + missing.length;
  const warn = findings.filter((f) => !BLOCKING.has(f.impact));
  const md = [];
  md.push('## 無障礙檢測（axe-core）', '');
  md.push(`- 掃描：${runs} 次（${PAGES.length - skipped.length} 頁 × ${VIEWPORTS.map((v) => v.name).join('、')}）；規則集：${TAGS.join(', ')}`);
  if (skipped.length) md.push(`- 略過（dist 內沒有）：${skipped.join('、')}`);
  md.push(`- 結果：**${nBlock} 項阻擋**（serious／critical${overflow.length ? '＋橫向捲動' : ''}${missing.length ? '＋同站資源 404' : ''}）、${warn.length} 項警告（moderate／minor）`);
  // 警告依規則別統計（同一規則在不同頁、不同視窗各算一筆，與下方表格列數一致）
  const warningRules = {};
  for (const f of warn) warningRules[f.rule] = (warningRules[f.rule] ?? 0) + 1;
  if (warn.length) md.push(`- 警告不擋合併，但請排進待辦：${Object.entries(warningRules).map(([r, n]) => `${r}×${n}`).join('、')}`);
  md.push('');
  const table = (rows, title) => {
    if (!rows.length) return;
    md.push(`### ${title}`, '', '| 影響 | 規則 | 頁面 | 視窗 | 節點數 | 範例節點 |', '|---|---|---|---|---|---|');
    for (const f of rows) md.push(`| ${f.impact} | [${f.rule}](${f.helpUrl}) ${f.help} | \`${f.page}\` | ${f.vp} | ${f.nodes.length} | \`${f.nodes[0].target.replace(/\|/g, '\\|')}\` |`);
    md.push('');
  };
  table(blocking, '阻擋（serious／critical）');
  if (missing.length) {
    md.push('### 阻擋：同站資源 404（掃到的畫面不完整；先確認 BASE_PATH 與 DIST_DIR 的建置一致）', '', '| 頁面 | 視窗 | 404 的網址 |', '|---|---|---|');
    for (const m of missing.slice(0, 50)) md.push(`| \`${m.page}\` | ${m.vp} | \`${m.url}\` |`);
    if (missing.length > 50) md.push(`| … | | 另有 ${missing.length - 50} 筆 |`);
    md.push('');
  }
  if (overflow.length) {
    md.push('### 阻擋：橫向捲動（320 px／文字 200%＋390 px；WCAG 1.4.10）', '', '| 頁面 | 視窗 | scrollWidth | clientWidth |', '|---|---|---|---|');
    for (const o of overflow) md.push(`| \`${o.page}\` | ${o.vp} | ${o.scrollWidth} | ${o.clientWidth} |`);
    md.push('');
  }
  table(warn, '警告（moderate／minor，不擋合併）');
  if (!findings.length && !overflow.length && !missing.length) md.push('沒有任何違規。', '');
  const report = md.join('\n');
  console.log(report);
  for (const f of blocking) console.log(`\n[${f.impact}] ${f.rule} @ ${f.page} (${f.vp})\n` + f.nodes.slice(0, 4).map((n) => `  - ${n.target}\n    ${n.html}`).join('\n'));
  console.log(`\n[a11y] 阻擋 ${nBlock}、警告 ${warn.length}（moderate／minor，不擋合併）${warn.length ? `：${Object.entries(warningRules).map(([r, n]) => `${r}×${n}`).join('、')}` : ''}`);
  if (process.env.A11Y_JSON) {
    const summary = { runs, blocking: nBlock, warnings: warn.length, warningRules };
    try { fs.writeFileSync(process.env.A11Y_JSON, `${JSON.stringify(summary)}\n`); } catch { /* 摘要寫不出去不影響結果 */ }
  }
  if (process.env.A11Y_REPORT) fs.writeFileSync(process.env.A11Y_REPORT, `${report}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) { try { fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`); } catch { /* 摘要寫不進去不影響結果 */ } }
  process.exit(nBlock ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
