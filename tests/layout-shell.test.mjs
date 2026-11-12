// 第七十一輪（docs/architecture-ux-review.md 4.1、4.2、4.3、4.7）：站台外框（layout）與首頁外框元件。
// 本檔以「主題」命名（tests/README.md 的新規則），輪次寫在這裡：
//   - 兩個 skip link：「跳到主要內容」→「跳到主選單」，順序固定；#main-nav 有 tabindex="-1" 可接焦點（U2）
//   - 原型橫幅含「示範資料凍結於 {建置日}」，手機版兩行用的 class 都在（U1、U9）；正式模式不輸出橫幅與儀表板凍結註記
//   - 首頁「原型預覽：目前為做法 X」列預設 hidden，ui.js 只在 ?hero= 時取消（U1、U10）
//   - 頁尾「服務」欄分兩小組（<p class="site-footer__sub">，不是 h3），連結總數仍為 14（U8）
//   - 首頁影音卡：沒有縮圖時輸出純文字卡、沒有佔位圖；有縮圖的維持原樣（U3）
//   - /admin/ 與 /transparency/ KPI 上方的凍結註記（2.7）
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { govern, mk } from './helpers.mjs';
import { config } from '../site.config.mjs';
import { makeCtx } from '../scripts/lib/pages.mjs';
import { html } from '../scripts/lib/render.mjs';
import { layout, FOOT_SERVICES } from '../src/templates/layout.mjs';
import * as home from '../src/templates/public/home.mjs';
import * as admin from '../src/templates/admin/index.mjs';
import * as transparency from '../src/templates/public/transparency.mjs';
import { t, STRINGS } from '../src/client/i18n.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const TODAY = '2026-10-01';
const site = govern(TODAY);
const ctxOf = (lang = 'zh-TW', p = '/') => makeCtx(site, lang, { path: p, alternates: ['zh-TW', 'en'] });
const page = (lang = 'zh-TW') => String(layout(ctxOf(lang), { title: 'x', description: 'y', body: html`<p>hi</p>` }));
const LANGS = config.langs.map((l) => l.code);

test('skip link：「跳到主要內容」之後是「跳到主選單」（#main-nav），兩者都在原型橫幅之前；#main-nav 有 tabindex="-1"', () => {
  for (const lang of LANGS) {
    const h = page(lang);
    const links = [...h.matchAll(/<a class="skip-link[^"]*" href="([^"]+)"[^>]*>([^<]*)<\/a>/g)];
    assert.equal(links.length, 2, `${lang} 兩個 skip link`);
    assert.deepEqual(
      links.map((m) => m[1]),
      ['#main', '#main-nav'],
      `${lang} 順序`,
    );
    assert.equal(links[0][2], t(lang, 'skip'));
    assert.equal(links[1][2], t(lang, 'skip.nav'));
    assert.ok(h.indexOf('href="#main-nav"') < h.indexOf('c-proto-banner'), `${lang} 第二個 skip link 在橫幅之前`);
    assert.match(h, /<nav id="main-nav" class="c-nav" tabindex="-1"/, `${lang} #main-nav 可聚焦`);
    assert.match(h, /data-skip-nav/, 'ui.js 用來在手機版先展開選單的掛鉤');
  }
  assert.notEqual(t('ja', 'skip.nav'), t('en', 'skip.nav'), '七語字串（非英文語言有各自翻譯）');
  for (const lang of LANGS) assert.ok(STRINGS[lang]['skip.nav'], `${lang} skip.nav`);
  // 兩個 skip link 聚焦時不重疊：第二個有自己的 top
  const css = fs.readFileSync(path.join(ROOT, 'src/styles/base.css'), 'utf8');
  assert.match(css, /\.skip-link--nav\{top:/);
  // 手機版主選單收合時，ui.js 先展開再聚焦
  const ui = fs.readFileSync(path.join(ROOT, 'src/client/ui.js'), 'utf8');
  assert.match(ui, /\[data-skip-nav\][\s\S]{0,400}is-open[\s\S]{0,200}nav\.focus\(\)/);
});

test('原型橫幅：七語都含「示範資料凍結於 {建置日}」；文字與連結各有 class 供手機版排兩行', () => {
  for (const lang of LANGS) {
    const h = page(lang);
    const banner = h.match(/<div class="c-proto-banner"[\s\S]*?<\/div><\/div>/)[0];
    assert.ok(banner.includes(t(lang, 'proto.banner.frozen', { date: TODAY })), `${lang} 凍結日`);
    assert.ok(banner.includes(TODAY), `${lang} 日期`);
    assert.match(banner, /class="c-proto-banner__text"/);
    assert.match(banner, /class="c-proto-banner__cta" href="https:\/\/www\.cdc\.gov\.tw/);
  }
  const css = fs.readFileSync(path.join(ROOT, 'src/styles/base.css'), 'utf8');
  const mobile = css.match(/@media \(max-width:640px\)\{[^}]*\.c-proto-banner__in[\s\S]*?\n\}/)?.[0] ?? '';
  assert.match(mobile, /\.c-proto-banner__cta\{order:2/, '連結與標籤同一行');
  assert.match(mobile, /\.c-proto-banner__text\{order:3;flex-basis:100%/, '說明自成第二行');
});

test('首頁「原型預覽」列預設 hidden；ui.js 只在網址帶 ?hero= 時取消 hidden；文案不變', () => {
  for (const lang of ['zh-TW', 'en']) {
    const h = String(home.render(ctxOf(lang)));
    const bar = h.match(/<div class="c-promo__preview"[^>]*>/)[0];
    assert.match(bar, /data-hero-bar hidden/, `${lang} 預設隱藏`);
    assert.ok(h.includes(t(lang, 'home.preview.switch')), `${lang} 文案仍在`);
  }
  const ui = fs.readFileSync(path.join(ROOT, 'src/client/ui.js'), 'utf8');
  assert.match(ui, /q0\.has\('hero'\)\) bar\.hidden = false/);
});

test('頁尾「服務」欄：兩個小標（民眾申辦、機關資訊；<p> 不是 h3），各組 <ul> 以 aria-labelledby 指向小標，連結總數仍為 14', () => {
  assert.equal(FOOT_SERVICES.length, 2);
  assert.equal(
    FOOT_SERVICES.reduce((n, g) => n + g.links.length, 0),
    14,
  );
  for (const lang of ['zh-TW', 'en', 'th']) {
    const h = page(lang);
    const col = h.match(/<nav class="site-footer__col" aria-labelledby="ft-svc">[\s\S]*?<\/nav>/)[0];
    const subs = [...col.matchAll(/<p class="site-footer__sub" id="([^"]+)">([^<]+)<\/p><ul aria-labelledby="([^"]+)">/g)];
    assert.equal(subs.length, 2, `${lang} 兩個小標`);
    assert.deepEqual(
      subs.map((m) => m[2]),
      [t(lang, 'footer.sub.citizen'), t(lang, 'footer.sub.agency')],
    );
    for (const m of subs) assert.equal(m[1], m[3], 'ul 指向自己的小標');
    assert.equal(/<h3/.test(col), false, '不用 h3');
    assert.equal((col.match(/<a href=/g) ?? []).length, 14, `${lang} 連結數不變`);
    // 民眾申辦組：申請、通報、檢驗、訂閱（含一行說明）、全文搜尋
    const first = col.slice(col.indexOf('ft-svc-citizen'), col.indexOf('ft-svc-agency'));
    for (const p of ['/apply/', '/report/', '/lab/', '/subscribe/', '/search/']) assert.ok(first.includes(`${p}"`), `${lang} 民眾申辦含 ${p}`);
    assert.ok(first.includes(t(lang, 'footer.subscribe.note')), '訂閱的一行說明保留');
    // 頁尾欄數不變（服務、關於與政策、開放資料與開發者、聯絡）
    assert.equal((h.match(/class="site-footer__col[ "]/g) ?? []).length, 4);
  }
  for (const k of ['footer.sub.citizen', 'footer.sub.agency']) for (const lang of LANGS) assert.ok(STRINGS[lang][k], `${lang} ${k}`);
});

test('首頁影音卡：沒有縮圖時輸出純文字卡（標題、時長、依據），沒有佔位圖；有縮圖的維持原樣', () => {
  const ctx = ctxOf();
  const noPoster = mk({ type: 'media', title: '沒有縮圖的影片', basedOnVersionLabel: '114.04.16 版建議' });
  delete noPoster.poster;
  const card = String(home.homeMediaCard(ctx, noPoster));
  assert.match(card, /class="c-media-card c-media-card--text/);
  assert.equal(/c-media-card__poster|<svg|<img/.test(card), false, '沒有佔位圖區塊');
  assert.ok(card.includes('沒有縮圖的影片'), '標題');
  assert.ok(card.includes(`${t('zh-TW', 'media.duration')} 1:35`), '時長');
  assert.ok(card.includes('114.04.16 版建議'), '依據正本');
  // 空字串也算沒有縮圖
  assert.match(String(home.homeMediaCard(ctx, { ...noPoster, poster: '' })), /c-media-card--text/);
  // 有縮圖：與 _partials 的 mediaCard 相同
  const withPoster = site.collections.media.find((m) => m.poster && m.status === 'published');
  const c2 = String(home.homeMediaCard(ctx, withPoster));
  assert.match(c2, /<div class="c-media-card__poster"><img class="c-media-card__img"/);
  assert.equal(c2.includes('c-media-card--text'), false);
  // 首頁實際輸出：影音區塊由 homeMediaCard 產生（目前 13 筆都有縮圖，所以仍是圖卡）
  const h = String(home.render(ctx));
  const sec = h.match(/<section class="c-home__media"[\s\S]*?<\/section>/)[0];
  assert.equal((sec.match(/class="c-media-card[ "]/g) ?? []).length, 3);
});

test('/admin/ 與 /transparency/：KPI 上方有「示範站凍結於 {建置日}，以下為當日計算」（原型模式）', () => {
  const note = `示範站凍結於 ${TODAY}，以下為當日計算。`;
  const a = String(admin.render(ctxOf('zh-TW', '/admin/')));
  assert.ok(a.includes(note), 'admin');
  assert.ok(a.indexOf('data-freeze-note') < a.indexOf('<table class="adm-table"><caption>資料來源：/v1/governance/kpi.json'), 'admin 在 KPI 表之前');
  const tr = String(transparency.render(ctxOf('zh-TW', '/transparency/')));
  assert.ok(tr.includes(note), 'transparency');
  assert.ok(tr.indexOf('data-freeze-note') < tr.indexOf('class="pf-tiles"'), 'transparency 在摘要之前');
});

test('正式模式（SITE_MODE=production）：不輸出原型橫幅與凍結註記；skip link 與頁尾分組照常', () => {
  const u = (rel) => pathToFileURL(path.join(ROOT, rel)).href;
  const code = `
    const { govern } = await import(${JSON.stringify(u('tests/helpers.mjs'))});
    const { makeCtx } = await import(${JSON.stringify(u('scripts/lib/pages.mjs'))});
    const { layout } = await import(${JSON.stringify(u('src/templates/layout.mjs'))});
    const admin = await import(${JSON.stringify(u('src/templates/admin/index.mjs'))});
    const tr = await import(${JSON.stringify(u('src/templates/public/transparency.mjs'))});
    const site = govern('2026-10-01');
    const c = (p) => makeCtx(site, 'zh-TW', { path: p, alternates: ['zh-TW'] });
    const h = String(layout(c('/'), { title: 'x', body: '' }));
    console.log(JSON.stringify({
      banner: h.includes('c-proto-banner'), skips: (h.match(/class="skip-link/g) || []).length, subs: (h.match(/site-footer__sub/g) || []).length,
      admin: String(admin.render(c('/admin/'))).includes('data-freeze-note'), tr: String(tr.render(c('/transparency/'))).includes('data-freeze-note'),
    }));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, TEST_KEEP_ENV: '1', SITE_MODE: 'production' },
  });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.deepEqual(out, { banner: false, skips: 2, subs: 2, admin: false, tr: false });
});
