// 第二十六輪（issue #34）：介面字串依語言拆檔、JS 預算。
// 不需要先 build 的部分：per-lang 模組大小、與 Node 端 t() 的一致性、執行期 t()。
// 需要 dist 的部分（頁面 JS 預算、Playwright 端到端）：dist 不存在時 skip。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import vm from 'node:vm';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { STRINGS, t as nodeT } from '../src/client/i18n.js';
import { I18N_LANGS, resolveAll, langModuleSource, clientKeys } from '../scripts/lib/i18n-split.mjs';
import { checkJsBudget } from '../scripts/lib/js-budget.mjs';
import { config } from '../site.config.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DIST = process.env.DIST_DIR ? path.resolve(process.env.DIST_DIR) : path.join(ROOT, 'dist');
const BUDGET_PER_LANG = 60 * 1024; // 每個語言檔的原始位元組上限（目前約 4–5 KB，留給成長）

test('七種語言各有一個 per-lang 模組，且每個都在預算內', () => {
  assert.deepEqual(I18N_LANGS, ['zh-TW', 'en', 'ja', 'tl', 'vi', 'id', 'th']);
  const full = fs.statSync(path.join(ROOT, 'src/client/i18n.js')).size;
  for (const lang of I18N_LANGS) {
    const bytes = Buffer.byteLength(langModuleSource(lang));
    assert.ok(bytes <= BUDGET_PER_LANG, `${lang} ${bytes} > ${BUDGET_PER_LANG}`);
    assert.ok(bytes < 0.25 * full, `${lang} 應遠小於完整 i18n.js`);
  }
});

test('per-lang 的每個字串 = Node 端 t() 的解析結果（該語言 → 英文 → 中文）', () => {
  for (const lang of I18N_LANGS) {
    const S = resolveAll(lang);
    const keys = Object.keys(S);
    assert.ok(keys.length > 50, `${lang} 至少要有數十個 client key`);
    for (const k of keys) assert.equal(nodeT(lang, k), S[k].replace(/\{(\w+)\}/g, ''), `${lang} ${k}`);
    for (const k of keys.filter((x) => /\{n\}/.test(S[x])).slice(0, 5))
      assert.equal(nodeT(lang, k, { n: 7 }), S[k].replaceAll('{n}', '7').replace(/\{(\w+)\}/g, ''));
  }
});

test('client 原始碼用到的 key（字面量與動態前綴）都被收進來；純伺服器端 key 不上線', () => {
  const all = Object.keys(STRINGS['zh-TW']);
  const used = new Set(clientKeys(all));
  for (const k of ['vxs.col.age', 'vxs.status.due', 'japply.js.r.job', 'pro.subscribe', 'copied', 'filter.count']) {
    if (all.includes(k)) assert.ok(used.has(k), `client 會用到 ${k}`);
  }
  assert.ok(used.size < all.length / 4, `client key ${used.size} 應遠少於全部 ${all.length}`);
});

test('執行期：載入 per-lang 模組 + i18n.runtime.js 後 window.CDC.t 與 Node t() 一致', async () => {
  const win = {};
  vm.runInNewContext(langModuleSource('vi').replace('export default S;', ''), { window: win });
  assert.equal(win.CDC.I18N.lang, 'vi');
  globalThis.window = win;
  globalThis.document = { documentElement: { lang: 'vi' } };
  try {
    const rt = await import(`${pathToFileURL(path.join(ROOT, 'src/client/i18n.runtime.js')).href}?r26`);
    const k = Object.keys(win.CDC.I18N.S).find((x) => /\{n\}/.test(win.CDC.I18N.S[x]));
    assert.equal(win.CDC.t(k, { n: 3 }), nodeT('vi', k, { n: 3 }));
    assert.equal(rt.t('vi', 'no.such.key'), 'no.such.key'); // 沒有的 key 顯示 key 本身
    assert.equal(rt.t('ja', k).replace(/\{.*?\}/g, ''), k, '頁面載入的是 vi，問 ja 不該拿到 vi 的字串');
  } finally {
    delete globalThis.window;
    delete globalThis.document;
  }
});

test('dist：完整 i18n.js 不上線、每頁 JS 在預算內、每頁只載入自己語言那一份', (tc) => {
  if (!fs.existsSync(path.join(DIST, 'index.html'))) return tc.skip('dist 尚未建置');
  assert.ok(!fs.existsSync(path.join(DIST, 'assets/js/i18n.js')), 'dist 不應有完整 i18n.js');
  for (const lang of I18N_LANGS) {
    const f = path.join(DIST, `assets/js/i18n.${lang}.js`);
    assert.ok(fs.existsSync(f), `缺 ${f}`);
    assert.ok(fs.statSync(f).size <= BUDGET_PER_LANG, `${lang} 超過預算`);
  }
  const r = checkJsBudget(DIST, { basePath: config.basePath });
  assert.ok(
    r.ok,
    `超預算：${r.public.over
      .slice(0, 5)
      .map((x) => `${x.page} ${x.bytes}`)
      .join('；')}`,
  );
  const html = fs.readFileSync(path.join(DIST, 'vi/index.html'), 'utf8');
  assert.match(html, /assets\/js\/i18n\.vi\.js/);
  assert.doesNotMatch(html, /i18n\.(zh-TW|en|ja|tl|id|th)\.js/);
  assert.ok(html.indexOf('i18n.vi.js') < html.indexOf('assets/js/ui.js'), 'i18n 模組必須排在 ui.js 之前');
});

// ───────────────────────── 端到端（Playwright）─────────────────────────
const PW = process.env.PW_MODULE || '/opt/node22/lib/node_modules/playwright/index.mjs';
const CHROME = process.env.CHROME_BIN || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const freePort = () =>
  new Promise((res) => {
    const s = net.createServer();
    s.listen(0, () => {
      const p = s.address().port;
      s.close(() => res(p));
    });
  });

test('端到端：/、/vi/、/admin/、/ask/ 無 console 錯誤，client JS 渲染翻譯字串', async (tc) => {
  if (!fs.existsSync(path.join(DIST, 'index.html'))) return tc.skip('dist 尚未建置');
  if (!fs.existsSync(PW) || !fs.existsSync(CHROME)) return tc.skip('沒有 Playwright／Chromium');
  const { chromium } = await import(pathToFileURL(PW).href);
  const port = await freePort();
  const srv = spawn(process.execPath, [path.join(ROOT, 'scripts/serve.mjs'), String(port)], {
    cwd: ROOT,
    stdio: 'ignore',
    env: { ...process.env, DIST_DIR: DIST },
  });
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  try {
    const base = `http://localhost:${port}${config.basePath}`;
    for (let i = 0; i < 50; i++) {
      try {
        if ((await fetch(`${base}/`)).ok) break;
      } catch {
        /* wait */
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    const ctx = await browser.newContext();
    for (const p of ['/', '/vi/', '/admin/', '/ask/', '/vi/vaccines/schedule/']) {
      const page = await ctx.newPage();
      const errors = [];
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text());
      });
      page.on('pageerror', (e) => errors.push(String(e)));
      await page.goto(`${base}${p}`, { waitUntil: 'networkidle' });
      assert.deepEqual(errors, [], `${p} console 錯誤`);
      if (!p.startsWith('/admin')) {
        const lang = await page.evaluate(() => document.documentElement.lang);
        const got = await page.evaluate(() => window.CDC?.t?.('filter.count', { n: 1, total: 2 }));
        assert.equal(got, nodeT(lang, 'filter.count', { n: 1, total: 2 }), `${p} 的 CDC.t`);
        assert.notEqual(got, 'filter.count');
      }
      if (p === '/vi/vaccines/schedule/') {
        const txt = await page.locator('body').innerText();
        assert.ok(txt.includes(nodeT('vi', 'vxs.col.age')) || txt.includes(nodeT('vi', 'vxs.status.due')), '時程地圖由 client JS 渲染的越南語字串');
      }
      await page.close();
    }
  } finally {
    await browser.close();
    srv.kill();
  }
});

// 第二十八輪：glossary.js 仍 import './i18n.js'，拆檔後 dist 沒有這個檔，整支模組載入失敗、詞彙篩選失效。
test('瀏覽器端模組不得 import 完整的 ./i18n.js（dist 只有 i18n.<lang>.js 與 i18n.runtime.js）', () => {
  const dir = new URL('../src/client/', import.meta.url);
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(new URL(`${e.name}/`, d)) : e.name.endsWith('.js') ? [new URL(e.name, d)] : []));
  const bad = walk(dir).filter((f) => !f.pathname.endsWith('/i18n.js') && /import\s+(?:[^'"]*from\s+)?['"](?:\.\.?\/)+i18n\.js['"]/.test(fs.readFileSync(f, 'utf8')));
  assert.deepEqual(bad.map((f) => f.pathname.split('/src/client/')[1]), []);
});
