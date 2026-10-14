// 第四十八輪：#97 倒數改由瀏覽器重算、#98 窄螢幕／放大文字不橫向捲動、#99 頁籤標題層級、#100 答案頁多語字串。
// 版面的實測（scrollWidth、axe）在 npm run a11y；這裡是不需要瀏覽器的結構與單元斷言。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { govern, memWriter } from './helpers.mjs';
import { renderAllPages } from '../scripts/lib/pages.mjs';
import { taipeiToday, dayDiff, countdownView, applyCountdowns } from '../src/client/countdown.js';
import { isStrictCjkPage, checkI18nQuality, summarizeI18nQuality } from '../scripts/lib/i18n-quality.mjs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

/* ───────── #97 倒數 ───────── */
test('#97 台灣日界線：UTC 15:59:59 仍是當天，16:00:00 (= +08:00 午夜) 進入隔天', () => {
  assert.equal(taipeiToday(Date.parse('2026-10-14T15:59:59Z')), '2026-10-14');
  assert.equal(taipeiToday(Date.parse('2026-10-14T16:00:00Z')), '2026-10-15');
  assert.equal(taipeiToday(Date.parse('2026-10-14T00:00:00+08:00')), '2026-10-14');
  assert.equal(taipeiToday(Date.parse('2026-10-13T23:59:59+08:00')), '2026-10-13');
  assert.equal(taipeiToday(Date.parse('2026-12-31T16:00:00Z')), '2027-01-01');
});

test('#97 dayDiff：跨月、跨年、閏日；格式不對回 null', () => {
  assert.equal(dayDiff('2026-10-14', '2026-10-22'), 8);
  assert.equal(dayDiff('2026-10-22', '2026-10-14'), -8);
  assert.equal(dayDiff('2026-12-31', '2027-01-01'), 1);
  assert.equal(dayDiff('2028-02-28', '2028-03-01'), 2);
  assert.equal(dayDiff('2026-10-14', '2026-10-14'), 0);
  assert.equal(dayDiff('2026-10-14', ''), null);
  assert.equal(dayDiff(undefined, '2026-10-14'), null);
});

test('#97 午夜前後：同一個截止日，23:59 剩 1 天，過了午夜「今天截止」，再一分鐘已截止', () => {
  const t = (k, v = {}) => `${k}|${Object.values(v).join(',')}`;
  const at = (iso) => countdownView('left', dayDiff(taipeiToday(Date.parse(iso)), '2026-10-15'), '2026-10-15', t);
  assert.deepEqual(at('2026-10-14T23:59:00+08:00'), { text: 'notice.daysleft|1', tone: 'soon' });
  assert.deepEqual(at('2026-10-15T00:00:00+08:00'), { text: 'notice.today|', tone: 'soon' });
  assert.deepEqual(at('2026-10-15T23:59:00+08:00'), { text: 'notice.today|', tone: 'soon' });
  assert.deepEqual(at('2026-10-16T00:00:00+08:00'), { text: 'notice.closed.on|2026-10-15', tone: 'closed' });
  assert.deepEqual(countdownView('left', 21, '2026-11-04', t), { text: 'notice.daysleft|21', tone: 'open' });
  assert.equal(countdownView('opens', 3, 'x', t).text, 'job.opensin|3');
  assert.equal(countdownView('opens', 0, 'x', t).text, '', '開放日當天不再顯示「N 天後開放」');
  assert.equal(countdownView('campaign', 9, 'x', t).tone, 'ok');
  assert.equal(countdownView('campaign', 7, 'x', t).tone, 'warn');
  assert.equal(countdownView('left', null, 'x', t), null);
});

test('#97 applyCountdowns：依 data-deadline 改文字與樣式（假 DOM）', () => {
  const mk = (cls, deadline, kind) => {
    const set = new Set(cls.split(' '));
    return { dataset: { deadline, ...(kind ? { kind } : {}) }, hidden: false, textContent: '建置時', classList: { contains: (c) => set.has(c), add: (c) => set.add(c), remove: (...cs) => cs.forEach((c) => set.delete(c)), set } };
  };
  const a = mk('c-deadline c-deadline--open', '2026-10-22');
  const b = mk('c-deadline c-deadline--info', '2026-10-20', 'opens');
  const c = mk('c-pill c-pill--ok', '2026-10-30', 'campaign');
  const root = { querySelectorAll: () => [a, b, c] };
  const t = (k, v = {}) => `${k}${v.n ?? ''}`;
  assert.equal(applyCountdowns(root, t, Date.parse('2026-10-16T12:00:00+08:00')), 3);
  assert.equal(a.textContent, 'notice.daysleft6');
  assert.ok(a.classList.set.has('c-deadline--soon') && !a.classList.set.has('c-deadline--open'));
  assert.equal(b.textContent, 'job.opensin4');
  assert.equal(c.textContent, 'campaigns.daysleft14');
  assert.ok(c.classList.set.has('c-pill--ok'));
  applyCountdowns(root, t, Date.parse('2026-10-22T09:00:00+08:00'));
  assert.equal(a.textContent, 'notice.today');
  assert.equal(b.hidden, true);
});

test('#97 模板輸出 data-deadline 與「以 … 計」後備提示（/procurement/、/careers/、/notices/）', async () => {
  const site = govern('2026-10-14');
  const mem = memWriter();
  await renderAllPages(site, mem.write);
  for (const p of ['procurement/index.html', 'careers/index.html', 'notices/index.html']) {
    const h = mem.files.get(p);
    assert.ok(h, p);
    assert.match(h, /<span class="c-deadline [^"]*" data-deadline="\d{4}-\d{2}-\d{2}" data-kind="(left|opens)">[^<]+<\/span><span class="c-asof">（以 2026-10-14 計）<\/span>/, p);
  }
  assert.match(mem.files.get('en/procurement/index.html'), /class="c-asof">\(as of 2026-10-14\)</);
  assert.ok(mem.files.has('campaigns/index.html'));
  // 後台頁不載入重算，標明天數以建置日計
  assert.match(mem.files.get('admin/jobs/index.html'), /倒數天數以建置日 2026-10-14 計/);
  // 沒有 JS 時的提示只在 html.js 以外顯示
  assert.match(read('src/styles/components.css'), /html\.js \.c-asof\{display:none\}/);
});

/* ───────── #98 版面 ───────── */
test('#98 css：職缺卡側欄與問題框可縮、可換行；a11y 腳本有「文字 200%／390」與新頁面', () => {
  const careers = read('src/styles/careers.css');
  assert.match(careers, /\.c-job__side\{[^}]*flex:0 1 auto;min-width:0;max-width:100%/);
  assert.match(careers, /\.c-job__side \.c-deadline\{white-space:normal\}/);
  const comp = read('src/styles/components.css');
  assert.match(comp, /\.c-askbox\{min-width:0;max-width:100%/);
  assert.match(comp, /flex:1 1 9rem/);
  assert.match(comp, /\.c-askpage__bar \.c-askbox\{flex:1 1 min\(420px,100%\)\}/);
  const a11y = read('scripts/a11y.mjs');
  assert.match(a11y, /name: '文字 200%／390', width: 390, height: 700, fontScale: 200/);
  assert.match(a11y, /'\/procurement\/', '\/careers\/'/);
  assert.match(a11y, /vp\.fontScale/);
});

/* ───────── #99 標題層級 ───────── */
test('#99 頁籤面板的 h2 在螢幕上是「只給螢幕閱讀器」而不是 display:none；標案／職缺每個面板都有 h2', async () => {
  const comp = read('src/styles/components.css');
  assert.doesNotMatch(comp, /\.c-tabs__print\{display:none\}/);
  assert.match(comp, /\.c-tabs__print\{position:absolute;[^}]*clip:rect\(0,0,0,0\)/);
  const site = govern('2026-10-14');
  const mem = memWriter();
  await renderAllPages(site, mem.write);
  for (const p of ['procurement/index.html', 'careers/index.html']) {
    const h = mem.files.get(p);
    const panels = h.split('role="tabpanel"').slice(1);
    assert.ok(panels.length >= 4, p);
    for (const pn of panels) {
      const iH2 = pn.indexOf('<h2 class="c-tabs__print">');
      assert.ok(iH2 >= 0, `${p}：面板缺 h2`);
      const iH3 = pn.indexOf('<h3');
      assert.ok(iH3 < 0 || iH2 < iH3, `${p}：h3 之前要先有 h2`);
    }
  }
});

/* ───────── #100(c) CJK 比例檢查 ───────── */
test('#100 高流量頁（/<lang>/、/<lang>/ask/）超標＝建置失敗，其他頁維持警告', () => {
  for (const ok of ['/en/index.html', '/th/index.html', '/vi/ask/index.html', '/tl/ask/index.html', '/th/sitemap-page/index.html', '/en/apply/index.html']) assert.ok(isStrictCjkPage(ok), ok); // 第四十九輪起 apply 與 sitemap-page 也是高流量頁
  for (const no of ['/en/about/index.html', '/en/diseases/index.html', '/index.html', '/ask/index.html']) assert.ok(!isStrictCjkPage(no), no);
  const log = () => {};
  const base = { termLeaks: [], cjk: { threshold: 0.15, checked: 2, worst: [], byLang: {} } };
  const row = (page) => ({ page, lang: 'en', ratio: 0.4, cjk: 4, total: 10, sample: [] });
  const warnOnly = { ...base, cjk: { ...base.cjk, over: [row('/en/about/index.html')], strictOver: [] } };
  assert.equal(summarizeI18nQuality(warnOnly, { log, mode: 'warn' }).fail, false);
  const strict = { ...base, cjk: { ...base.cjk, over: [row('/en/ask/index.html')], strictOver: [row('/en/ask/index.html')] } };
  assert.equal(summarizeI18nQuality(strict, { log, mode: 'warn' }).fail, true);
});

test('#100 目前 dist 的外語首頁與問答頁都低於門檻（dist 不存在則略過）', { skip: !fs.existsSync(new URL('../dist/en/index.html', import.meta.url)) }, () => {
  const rep = checkI18nQuality(new URL('../dist', import.meta.url).pathname);
  assert.deepEqual(rep.cjk.strictOver.map((r) => r.page), []);
});

