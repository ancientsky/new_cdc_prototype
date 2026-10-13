// 第四十七輪：主選單小型面板（點擊展開的 <details data-nav-dd>，不是整面 hover mega menu）。
// 結構斷言用 renderAllPages（不需瀏覽器）；端到端（Playwright）需要先 build，沒有 dist／Chromium 就 skip。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { govern, memWriter, config } from './helpers.mjs';
import { renderAllPages } from '../scripts/lib/pages.mjs';
import { langAvailable } from '../scripts/lib/pages.mjs';
import { DISEASE_MAX } from '../src/templates/public/_nav-panels.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DIST = process.env.DIST_DIR ? path.resolve(process.env.DIST_DIR) : path.join(ROOT, 'dist');
const site = govern('2026-10-13');
const mem = memWriter();
await renderAllPages(site, mem.write);

const LANGS = config.langs;
const fileOf = (p) => [`${p}index.html`.replace(/^\//, ''), `${p}.html`.replace(/^\//, '')].find((x) => mem.files.has(x));
const page = (p) => {
  const k = fileOf(p);
  assert.ok(k, `找不到輸出頁 ${p}`);
  return mem.files.get(k);
};
const homeOf = (L) => page(`${L.path}/`);
const navOf = (h) => h.match(/<nav id="main-nav"[\s\S]*?<\/nav>/)[0];
const ddsOf = (h) => [...navOf(h).matchAll(/<details class="c-nav__dd" data-nav-dd>[\s\S]*?<\/details>/g)].map((m) => m[0]);
const panelOf = (h, key) => {
  const d = ddsOf(h).find((x) => x.includes(`id="nav-panel-${key}"`));
  assert.ok(d, `找不到面板 ${key}`);
  return d;
};
const hrefsOf = (frag) => [...frag.matchAll(/<a [^>]*href="([^"]+)"/g)].map((m) => m[1]);
const tagsOf = (frag) => [...frag.matchAll(/<a [^>]*>/g)].map((m) => m[0]);
const unescape = (s) => s.replace(/&amp;/g, '&');
/** 站內網址 → 輸出檔路徑（去掉 basePath 與 #…） */
const outPathOf = (href) => {
  let p = unescape(href).split('#')[0].split('?')[0];
  if (config.basePath && p.startsWith(config.basePath)) p = p.slice(config.basePath.length);
  return p || '/';
};

test('七語首頁都有恰好 3 個面板；summary 只有 .sr-only 名稱＋chevron，不加 aria-label／aria-expanded／role；面板 id 唯一', () => {
  for (const L of LANGS) {
    const h = homeOf(L);
    const dds = ddsOf(h);
    assert.equal(dds.length, 3, `${L.code} 面板數`);
    assert.equal((navOf(h).match(/data-nav-dd/g) ?? []).length, 3, L.code);
    for (const d of dds) {
      const sum = d.match(/<summary[^>]*>[\s\S]*?<\/summary>/)[0];
      const tag = sum.match(/<summary[^>]*>/)[0];
      assert.match(tag, /class="c-nav__more"/);
      assert.doesNotMatch(tag, /aria-label|aria-expanded|role=/, `${L.code} summary 不加 ARIA：${tag}`);
      const sr = sum.match(/<span class="sr-only">([^<]+)<\/span>/);
      assert.ok(sr && sr[1].trim(), `${L.code} summary 要有 sr-only 名稱`);
      assert.match(sum, /<svg class="c-nav__chev"[^>]*aria-hidden="true"/);
    }
    const ids = dds.map((d) => d.match(/id="(nav-panel-[a-z]+)"/)[1]);
    assert.deepEqual(ids, ['nav-panel-diseases', 'nav-panel-vaccines', 'nav-panel-travel'], L.code);
    for (const id of ids) assert.equal((h.match(new RegExp(`id="${id}"`, 'g')) ?? []).length, 1, `${L.code} ${id} 唯一`);
  }
});

test('每個面板 4–9 個連結、每欄 ≤ 5；站內連結有輸出檔、#錨點在目標頁存在；外部連結 rel="noopener"', () => {
  for (const L of LANGS) {
    const h = homeOf(L);
    for (const d of ddsOf(h)) {
      const tags = tagsOf(d);
      assert.ok(tags.length >= 4 && tags.length <= 9, `${L.code} 面板連結數 ${tags.length}`);
      for (const c of d.matchAll(/<ul class="c-nav__panel-l">([\s\S]*?)<\/ul>/g)) assert.ok(tagsOf(c[1]).length <= 5, `${L.code} 每欄 ≤ 5`);
      for (const tg of tags) {
        const href = unescape(tg.match(/href="([^"]+)"/)[1]);
        if (/^https?:/.test(href)) {
          assert.match(tg, /rel="noopener"/, `外部連結 ${href}`);
          assert.match(tg, /target="_blank"/, `外部連結 ${href}`);
          continue;
        }
        const p = outPathOf(href);
        const k = fileOf(p);
        assert.ok(k, `${L.code} 面板連結沒有對應輸出頁：${href}`);
        const hash = href.split('#')[1];
        if (hash) assert.ok(mem.files.get(k).includes(`id="${hash}"`), `${L.code} ${p} 沒有 id="${hash}"`);
      }
    }
  }
});

test('疫苗面板的每個連結都在 /vaccines/ 的預防接種專區導覽（.vx-hub）裡：兩邊同一份資料', () => {
  for (const L of LANGS) {
    const panel = panelOf(homeOf(L), 'vaccines');
    const hub = page(`${L.path}/vaccines/`).match(/<section class="c-hub vx-hub"[\s\S]*?<\/section>/)[0];
    const hubHrefs = new Set(hrefsOf(hub));
    const links = hrefsOf(panel.replace(/<p class="c-nav__panel-all">[\s\S]*?<\/p>/, ''));
    assert.ok(links.length >= 4, `${L.code} 疫苗面板至少 4 個`);
    for (const href of links) assert.ok(hubHrefs.has(href), `${L.code} 疫苗面板連結不在 .vx-hub：${href}`);
  }
});

test('傳染病面板：疫情現況的疾病（有已發布、本語言可用的頁）依序排在最前面；數量 ≤ 6；不重複', () => {
  assert.ok(DISEASE_MAX <= 6);
  for (const L of LANGS) {
    const panel = panelOf(homeOf(L), 'diseases');
    const col1 = panel.match(/<ul class="c-nav__panel-l">([\s\S]*?)<\/ul>/)[1];
    const hrefs = hrefsOf(col1);
    assert.ok(hrefs.length >= 1 && hrefs.length <= 6, `${L.code} 數量 ${hrefs.length}`);
    assert.equal(new Set(hrefs).size, hrefs.length, `${L.code} 不重複`);
    const sitPages = site.situation.items
      .map((it) => site.collections.diseases.find((d) => d.id === it.disease && d.status === 'published'))
      .filter((d) => d && langAvailable(site, d, L.code))
      .filter((d, i, a) => a.indexOf(d) === i);
    const expect = sitPages.slice(0, DISEASE_MAX).map((d) => `/diseases/${d.slug}/`);
    expect.forEach((p, i) => assert.ok(outPathOf(hrefs[i]).endsWith(p), `${L.code} 第 ${i + 1} 個應為 ${p}，實際 ${hrefs[i]}`));
  }
});

test('專業用連結（c-pro-only）在 / 與 /pro/ 都輸出：靠 CSS 隱藏，不靠模板分支', () => {
  for (const p of ['/', '/pro/']) {
    const nav = navOf(page(p));
    assert.match(nav, /<li class="c-pro-only"><a href="[^"]*\/documents\/"/, p);
    assert.match(nav, /<li class="c-pro-only"><a href="[^"]*\/report\/"/, p);
  }
  assert.match(
    fs.readFileSync(path.join(ROOT, 'src/styles/base.css'), 'utf8') + fs.readFileSync(path.join(ROOT, 'src/styles/components.css'), 'utf8'),
    /html\[data-view="public"\] \.c-pro-only\{display:none/,
  );
});

test('base.css：不以 :hover 開面板；.c-nav 為 containing block；桌機面板 absolute、手機 static', () => {
  const css = fs.readFileSync(path.join(ROOT, 'src/styles/base.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of css.matchAll(/([^{}]+)\{/g)) {
    const sel = m[1];
    if (sel.includes(':hover')) assert.doesNotMatch(sel, /c-nav__panel|c-nav__dd/, `不得 hover 開面板：${sel.trim()}`);
  }
  const start = css.indexOf('@media (max-width:959px){');
  assert.ok(start > 0);
  let depth = 0;
  let end = start;
  for (let i = css.indexOf('{', start); i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) {
      end = i;
      break;
    }
  }
  const mobile = css.slice(start, end);
  const desktop = css.slice(0, start) + css.slice(end);
  assert.match(desktop, /(^|[}\s])\.c-nav\{[^}]*position:relative/);
  assert.match(desktop, /\.c-nav__panel\{[^}]*position:absolute/);
  assert.match(desktop, /\.c-nav__item--panel\{[^}]*position:static/);
  assert.doesNotMatch(desktop, /\.c-nav__(?:item|dd|more)\{[^}]*position:relative/, '桌機 item／details／summary 不設 relative（overflow 裁切陷阱）');
  assert.match(mobile, /\.c-nav__panel\{[^}]*position:static/);
});

test('ui.js：同時只開一個、Esc 關閉、焦點移出關閉', () => {
  const ui = fs.readFileSync(path.join(ROOT, 'src/client/ui.js'), 'utf8');
  assert.match(ui, /data-nav-dd/);
  assert.match(ui, /'Escape'/);
  assert.match(ui, /focusout/);
  assert.doesNotMatch(ui, /mouseenter|mouseover|pointerenter/, '不用 hover 開啟');
});

test('面板內沒有標題元素；後台頁不含 data-nav-dd', () => {
  for (const L of LANGS) for (const d of ddsOf(homeOf(L))) assert.doesNotMatch(d, /<h[1-6][\s>]/, L.code);
  const admin = [...mem.files.keys()].filter((k) => k.startsWith('admin/') && k.endsWith('.html'));
  assert.ok(admin.length > 0, '有後台輸出頁');
  for (const k of admin) assert.ok(!mem.files.get(k).includes('data-nav-dd'), k);
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

test('端到端：桌機點擊開合、同時只開一個、Esc 與點外面關閉、不被裁切；手機手風琴在文件流中；axe 無 serious／critical', async (tc) => {
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
    // ── 桌機 1280px ──
    const deskCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const desk = await deskCtx.newPage();
    const errors = [];
    desk.on('pageerror', (e) => errors.push(String(e)));
    await desk.goto(`${base}/`, { waitUntil: 'networkidle' });
    const dd = desk.locator('details[data-nav-dd]');
    assert.equal(await dd.count(), 3);
    const isOpen = (i) => dd.nth(i).evaluate((d) => d.open);
    await dd.nth(0).locator('summary').click();
    assert.equal(await isOpen(0), true, '點 ▾ 打開');
    assert.ok(await desk.locator('#nav-panel-diseases').isVisible(), '面板可見');
    // 不被 .c-nav__in 的 overflow 裁掉：面板中央那一點是面板自己的元素
    const hit = await desk.evaluate(() => {
      const p = document.getElementById('nav-panel-diseases');
      const r = p.getBoundingClientRect();
      const el = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(r.height - 4, 40));
      return { inside: p.contains(el), h: r.height, w: r.width };
    });
    assert.ok(hit.inside && hit.h > 60 && hit.w > 600, `面板未被裁切：${JSON.stringify(hit)}`);
    await dd.nth(1).locator('summary').click();
    assert.equal(await isOpen(1), true);
    assert.equal(await isOpen(0), false, '開另一個時前一個關閉');
    await desk.keyboard.press('Escape');
    assert.equal(await isOpen(1), false, 'Esc 關閉');
    assert.equal(
      await desk.evaluate(
        () =>
          document.activeElement?.matches('details[data-nav-dd] > summary') &&
          document.activeElement.closest('details').querySelector('#nav-panel-vaccines') !== null,
      ),
      true,
      '焦點回到 summary',
    );
    await dd.nth(2).locator('summary').click();
    assert.equal(await isOpen(2), true);
    await desk.locator('.site-footer__meta').click();
    assert.equal(await isOpen(2), false, '點面板外面關閉');
    // axe：開一個面板後掃首頁
    await dd.nth(0).locator('summary').click();
    let AxeBuilder = null;
    try {
      ({ AxeBuilder } = await import('@axe-core/playwright'));
    } catch {
      tc.diagnostic('沒有 @axe-core/playwright，略過 axe');
    }
    if (AxeBuilder) {
      const axe = await new AxeBuilder({ page: desk }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
      const serious = axe.violations.filter((v) => ['serious', 'critical'].includes(v.impact));
      assert.deepEqual(
        serious.map((v) => `${v.id}: ${v.nodes[0]?.target}`),
        [],
      );
    }
    assert.deepEqual(errors, []);
    await deskCtx.close();

    // ── 手機 390px：選單 → ▾ → 面板在文件流中、位於 summary 下方 ──
    const mobCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const mob = await mobCtx.newPage();
    await mob.goto(`${base}/`, { waitUntil: 'networkidle' });
    await mob.locator('.c-nav__toggle').click();
    await mob.locator('details[data-nav-dd]').nth(1).locator('summary').click();
    const m = await mob.evaluate(() => {
      const d = document.querySelectorAll('details[data-nav-dd]')[1];
      const s = d.querySelector('summary').getBoundingClientRect();
      const p = d.querySelector('.c-nav__panel');
      const r = p.getBoundingClientRect();
      return { open: d.open, pos: getComputedStyle(p).position, top: r.top, sBottom: s.bottom, w: r.width, vw: innerWidth };
    });
    assert.equal(m.open, true);
    assert.equal(m.pos, 'static', '手機面板在文件流中');
    assert.ok(m.top >= m.sBottom - 1, `面板在 summary 下方：${JSON.stringify(m)}`);
    assert.ok(m.w > m.vw * 0.8, `面板吃滿寬度：${JSON.stringify(m)}`);
    assert.ok(await mob.locator('#nav-panel-vaccines a').first().isVisible());
    await mobCtx.close();
  } finally {
    await browser.close();
    srv.kill();
  }
});
