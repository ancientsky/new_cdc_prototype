// 第七十二輪：Lighthouse 效能檢測後的修正（docs/performance-lighthouse.md）
//   A. 建置時壓縮 CSS（scripts/lib/minify.mjs 的 minifyCssDir；MINIFY=off 可關）
//   B. 首頁「從其他語言來的提示」連結預先帶 href（Lighthouse SEO crawlable-anchors）
//   C. dist/headers/ 輸出快取規則（headers.json 的 cache 區塊、nginx.conf、_headers、README 的 IIS 片段）
//   D. npm run perf:lighthouse 與手動／每月的 lighthouse.yml（不是必要檢查）
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { govern, config } from './helpers.mjs';
import { makeCtx } from '../scripts/lib/pages.mjs';
import * as home from '../src/templates/public/home.mjs';
import { minifyCssDir } from '../scripts/lib/minify.mjs';
import { securityHeaders, renderNginx, renderNetlify, renderReadme, renderIisCache, emitHeaders, CACHE_RULES } from '../scripts/lib/emit-headers.mjs';
import { lhFlags, median, pickMetrics, toMarkdown, DEFAULT_PAGES } from '../scripts/perf-lighthouse.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

/* ───────── A. CSS 壓縮 ───────── */
const SAMPLE_CSS = `/* 第七十二輪測試：這段註解要被拿掉 */
:root {
  --green-700: #1b5e3f;   /* 主色 */
  --space-3: 0.75rem;
}

.c-note::before {
  content: "提醒：";
  color: var(--green-700);
  margin: 0px 0px 0px 0px;
}
`;

test('A minifyCssDir：變小、去註解，--token 值與 content 裡的中文原樣保留（UTF-8，不轉跳脫）', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r72-css-'));
  fs.mkdirSync(path.join(dir, 'sub'));
  const f = path.join(dir, 'sub', 'a.css');
  fs.writeFileSync(f, SAMPLE_CSS);
  fs.writeFileSync(path.join(dir, 'not-css.txt'), '/* 不是 CSS */');
  const r = await minifyCssDir(dir, { enabled: true });
  assert.equal(r.skipped, false);
  assert.equal(r.files, 1, '只處理 .css（含子資料夾）');
  const out = fs.readFileSync(f, 'utf8');
  assert.ok(Buffer.byteLength(out) < Buffer.byteLength(SAMPLE_CSS), '變小');
  assert.equal(r.before, Buffer.byteLength(SAMPLE_CSS));
  assert.equal(r.after, Buffer.byteLength(out));
  assert.ok(!out.includes('/*'), '註解拿掉');
  assert.match(out, /--green-700:\s?#1b5e3f/, 'token 值保留');
  assert.ok(out.includes('提醒：'), 'content 裡的中文保留為 UTF-8');
  assert.ok(!/\\[0-9a-f]{4}/i.test(out), '沒有轉成 \\XXXX 跳脫');
  assert.equal(fs.readFileSync(path.join(dir, 'not-css.txt'), 'utf8'), '/* 不是 CSS */');
});

test('A minifyCssDir：enabled:false（MINIFY=off）一個位元組都不動', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r72-css-off-'));
  const f = path.join(dir, 'a.css');
  fs.writeFileSync(f, SAMPLE_CSS);
  const r = await minifyCssDir(dir, { enabled: false });
  assert.deepEqual(r, { skipped: true, files: 1, before: 0, after: 0 });
  assert.equal(fs.readFileSync(f, 'utf8'), SAMPLE_CSS);
});

test('A build.mjs：CSS 壓縮在主題 CSS 寫入之後、正式拆分（dist-profile）之前；有 [build] 紀錄', () => {
  const b = read('scripts/build.mjs');
  const theme = b.indexOf('themeCss(site.theme.active)');
  const css = b.indexOf("minifyCssDir(path.join(DIST, 'assets/styles'))");
  const split = b.indexOf('splitForProduction(DIST');
  assert.ok(theme > 0 && css > theme && split > css, '順序：主題 CSS → 壓縮 → 正式拆分');
  assert.ok(b.includes('CSS 壓縮 → assets/styles') && b.includes('CSS 壓縮：略過（MINIFY=off）'));
});

/* ───────── B. 首頁提示連結有 href ───────── */
test('B 首頁「從其他語言來的提示」每個 data-from-alt 連結都有 href（指向該語言首頁），仍預設 hidden', () => {
  const site = govern('2026-10-11');
  for (const lang of ['zh-TW', 'en', 'id']) {
    const h = String(home.render(makeCtx(site, lang, { path: '/', alternates: config.langs.map((l) => l.code) })));
    const anchors = [...h.matchAll(/<a\b[^>]*data-from-alt="([^"]+)"[^>]*>/g)];
    assert.ok(anchors.length >= config.langs.length - 1, `${lang}：每個其他語言一個連結`);
    for (const [tag, code] of anchors) {
      const L = config.langs.find((x) => x.code === code);
      assert.ok(tag.includes(` href="${config.basePath}${L.path}/"`), `${lang} → ${code} 要有 href：${tag}`);
      assert.ok(/\bhidden\b/.test(tag), '仍預設 hidden（前端驗證 from 後才顯示）');
    }
  }
  // 前端照舊用 from 覆寫成「該語言的同一頁」
  assert.ok(read('src/client/ui.js').includes("a.setAttribute('href', `${CDC.base}${a.dataset.langPath || ''}${from}`)"));
});

/* ───────── C. 快取規則 ───────── */
test('C 快取規則：三類（no-cache／1 小時／immutable），每類有路徑與理由；/assets 不是 immutable', () => {
  assert.deepEqual(
    CACHE_RULES.map((r) => r.id),
    ['no-cache', 'revalidate-hour', 'immutable'],
  );
  for (const r of CACHE_RULES) assert.ok(r.paths.length && r.why.length > 10 && r.cacheControl, r.id);
  const by = Object.fromEntries(CACHE_RULES.map((r) => [r.id, r]));
  assert.equal(by['no-cache'].cacheControl, 'no-cache');
  assert.ok(by['no-cache'].paths.includes('/pagefind/pagefind-entry.json') && by['no-cache'].paths.includes('/v1/**'));
  assert.equal(by['revalidate-hour'].cacheControl, 'public, max-age=3600, stale-while-revalidate=86400');
  assert.deepEqual(by['revalidate-hour'].paths, ['/assets/**', '/img/**', '/files/**']);
  assert.equal(by.immutable.cacheControl, 'public, max-age=31536000, immutable');
  assert.ok(by.immutable.paths.includes('/pagefind/pagefind.*.pf_meta'));
});

test('C headers.json 有 cache 區塊；nginx.conf 有 immutable 與 no-cache 規則，且每個 location 重列安全標頭', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r72-hdr-'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<script>1</script>');
  const out = new Map();
  emitHeaders(dir, (rel, body) => out.set(rel, body));
  const j = JSON.parse(out.get('headers/headers.json'));
  assert.deepEqual(
    j.cache.map((r) => r.id),
    ['no-cache', 'revalidate-hour', 'immutable'],
  );
  assert.ok(j.headers['Content-Security-Policy'], 'headers 形狀不變');
  const H = securityHeaders({ hashes: [] });
  const ng = renderNginx(H, undefined, { prefix: '' });
  assert.match(ng, /^add_header Cache-Control "no-cache";$/m, '伺服器層預設 no-cache');
  assert.match(
    ng,
    /^location \^~ \/pagefind\/index\/ \{\n(?: {2}add_header [^\n]+\n)+ {2}add_header Cache-Control "public, max-age=31536000, immutable";\n\}/m,
  );
  assert.match(ng, /^location ~ \^\/pagefind\/pagefind\\\.\[\^\/\]\+\\\.pf_meta\$ \{/m);
  assert.match(ng, /^location \^~ \/assets\/ \{[\s\S]*?add_header Cache-Control "public, max-age=3600, stale-while-revalidate=86400";\n\}/m);
  // 子 location 一有 add_header 就不繼承上層 ⇒ 每個 location 都要重列全部安全標頭
  const blocks = [...ng.matchAll(/^location [^\n]+\{\n([\s\S]*?)\n\}/gm)].map((m) => m[1]);
  assert.equal(blocks.length, 7);
  for (const b of blocks) for (const k of Object.keys(H)) assert.ok(b.includes(`add_header ${k} `), `location 內缺 ${k}`);
  // basePath 前綴
  assert.ok(renderNginx(H, undefined, { prefix: '/new_cdc_prototype' }).includes('location ^~ /new_cdc_prototype/assets/ {'));
  // 寫進 dist 的也有（emitHeaders 用 config.basePath）
  assert.ok(out.get('headers/nginx.conf').includes('immutable') && out.get('headers/nginx.conf').includes('add_header Cache-Control "no-cache";'));
});

test('C _headers 只列與平台預設不同的路徑、彼此不重疊；README 有快取表與 IIS 片段', () => {
  const H = securityHeaders({ hashes: [] });
  const nf = renderNetlify(H, undefined, { prefix: '' });
  const paths = nf.split('\n').filter((l) => /^\//.test(l));
  assert.deepEqual(paths, ['/*', '/assets/*', '/img/*', '/files/*', '/pagefind/index/*', '/pagefind/fragment/*', '/pagefind/filter/*', '/pagefind/*.pf_meta']);
  assert.equal((nf.match(/Cache-Control: /g) ?? []).length, 7, '每條路徑只有一個 Cache-Control');
  assert.ok(!/^\s+Cache-Control: no-cache/m.test(nf), '不另寫 no-cache（避免與其他規則的值被逗號合併）');
  const iis = renderIisCache({ prefix: '' });
  assert.ok(iis.includes('<clientCache cacheControlMode="DisableCache" />'));
  assert.ok(iis.includes('<location path="assets">') && iis.includes('cacheControlMaxAge="365.00:00:00"'));
  const rd = renderReadme(H, { pages: 1, count: 0, firstSeen: {} });
  for (const s of ['## 快取規則', 'immutable', 'stale-while-revalidate', 'clientCache', '<location path=', 'curl -sI']) assert.ok(rd.includes(s), s);
});

/* ───────── D. perf:lighthouse ───────── */
test('D perf-lighthouse：桌機用 Lighthouse 桌機預設數值；中位數；摘要表；預設頁含答案頁與搜尋頁', () => {
  const d = lhFlags('desktop', 9222);
  assert.equal(d.formFactor, 'desktop');
  assert.deepEqual(d.screenEmulation, { mobile: false, width: 1350, height: 940, deviceScaleFactor: 1, disabled: false });
  assert.equal(d.throttling.rttMs, 40);
  assert.equal(d.throttling.throughputKbps, 10240);
  assert.equal(d.throttling.cpuSlowdownMultiplier, 1);
  const m = lhFlags('mobile', 9222);
  assert.equal(m.formFactor, 'mobile');
  assert.equal(m.throttling, undefined, '手機用 Lighthouse 預設節流');
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, null, 5]), 1);
  for (const p of ['/', '/ask/', '/ask/?q=登革熱', '/diseases/dengue/', '/vaccines/schedule/', '/search/?q=登革熱', '/travel/', '/en/'])
    assert.ok(DEFAULT_PAGES.includes(p), p);
  const lhr = {
    categories: { performance: { score: 0.99, auditRefs: [] }, seo: { score: 0.66, auditRefs: [{ id: 'is-crawlable', weight: 1 }] } },
    audits: {
      'first-contentful-paint': { numericValue: 1100 },
      'total-byte-weight': { numericValue: 2048 },
      'render-blocking-insight': { metricSavings: { FCP: 410 } },
      'is-crawlable': { score: 0, scoreDisplayMode: 'binary' },
    },
  };
  const met = pickMetrics(lhr);
  assert.equal(met.perf, 99);
  assert.equal(met.seo, 66);
  assert.equal(met.transferKB, 2);
  assert.equal(met.renderBlockingMs, 410);
  assert.deepEqual(met.failed, ['is-crawlable']);
  const md = toMarkdown([{ path: '/', form: 'mobile', runs: [met], median: met }]);
  assert.match(md, /^\| `\/` \| 手機 \| 99 \| 99 \|/m);
});

test('D package.json、.gitignore、lighthouse.yml：手動＋每月、唯讀、固定 SHA、不是 PR 檢查', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.scripts['perf:lighthouse'], 'node scripts/perf-lighthouse.mjs');
  assert.match(pkg.devDependencies.lighthouse, /^\^13\./);
  assert.ok(read('.gitignore').split('\n').includes('.local/'), '報告預設寫在 .local/lighthouse/');
  const wf = read('.github/workflows/lighthouse.yml');
  assert.ok(wf.includes('workflow_dispatch:') && wf.includes('schedule:'));
  assert.ok(!/^\s+(pull_request|push):/m.test(wf), '不在 PR／push 跑（不是必要檢查）');
  assert.match(wf.split(/\njobs:\n/)[0], /permissions:\n  contents: read\n/);
  assert.ok(wf.includes('concurrency:'));
  assert.ok(wf.includes("BASE_PATH=''") && wf.includes('node scripts/perf-lighthouse.mjs') && wf.includes('GITHUB_STEP_SUMMARY'));
  // 跟其他工作流程用同一個固定 SHA
  const dast = read('.github/workflows/dast.yml');
  for (const m of wf.matchAll(/uses:\s*([^\s#]+)/g))
    assert.ok(dast.includes(m[1]) || read('.github/workflows/pages.yml').includes(m[1]), `${m[1]} 與既有工作流程同一個 SHA`);
});

test('文件：performance-lighthouse.md 存在並被 README、ARCHITECTURE、決策紀錄、deploy.md 引用', () => {
  const doc = read('docs/performance-lighthouse.md');
  for (const s of ['## 1.', '## 2.', '## 3.', '## 4.', '## 5.', '## 6.', '## 7.', 'perf:ask', 'perf:lighthouse', 'crawlable-anchors', 'render-blocking'])
    assert.ok(doc.includes(s), s);
  for (const f of ['README.md', 'ARCHITECTURE.md', 'docs/architecture-decisions.md', 'docs/deploy.md'])
    assert.ok(read(f).includes('performance-lighthouse.md'), f);
});
