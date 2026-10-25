// 第六十輪（Issue #127）：節慶主題是有日期的內容——schema、裝飾 token 白名單、對比、裝飾圖大小、生效區間重疊、
// layout 只在區間內加 data-theme 與主題 CSS、疫情中心 alertLevel=emergency 關掉主題、content/themes/ 走快車道。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { config, addItem } from './helpers.mjs';
import { loadSite, ROOT } from '../scripts/lib/load.mjs';
import { validateSite } from '../scripts/lib/validate.mjs';
import { layout } from '../src/templates/layout.mjs';
import { html } from '../scripts/lib/render.mjs';
import { t as T } from '../src/client/i18n.js';
import { classifyFile, laneForFiles, publishAtMs } from '../scripts/lib/lanes.mjs';
import { THEME_TOKENS, contrastRatio, themeProblems, overlappingThemes, themeState, themeCss, themeCssPath, svgProblems, DECORATION_MAX_BYTES, baseTokens } from '../scripts/lib/theme.mjs';

const readJSON = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const HW = () => readJSON('content/themes/halloween-2026.json');
const LNY = () => readJSON('content/themes/lny-2027.json');
const at = (s) => publishAtMs(s);
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="#d9661a"/></svg>';

function mkTheme(over = {}) {
  return {
    id: `theme.test-${Math.random().toString(36).slice(2, 8)}`, type: 'theme', title: '測試主題', owner: 'unit.pr', publishedAt: '2026-10-01', reviewedAt: '2026-10-01',
    reviewPeriodMonths: 0, status: 'published', audience: ['public'], sensitivity: 'public', license: 'OGDL-1.0', languages: { 'zh-TW': { status: 'source' } },
    summary: '測試', publishAt: '2030-01-01', unpublishAt: '2030-01-10', tokens: { '--theme-accent': '#b3202a' }, ...over,
  };
}

test('contrastRatio：WCAG 2.x 定義（黑白 21:1、同色 1:1、#777 對白約 4.48）', () => {
  assert.equal(contrastRatio('#000', '#fff'), 21);
  assert.equal(contrastRatio('#123456', '#123456'), 1);
  assert.ok(Math.abs(contrastRatio('#777777', '#ffffff') - 4.48) < 0.01);
  assert.equal(contrastRatio('red', '#fff'), null);
});

test('schema：示範主題通過；theme 型別必須有 publishAt、unpublishAt、tokens，owner 只能是公關室', () => {
  const site = loadSite(config);
  const ids = site.collections.themes.map((t) => t.id).sort();
  assert.deepEqual(ids, ['theme.halloween-2026', 'theme.lny-2027']);
  assert.deepEqual(validateSite(site).filter((e) => e.includes('content/themes/')), []);
  const bad = addItem(site, mkTheme({ owner: 'unit.acute-infectious', publishAt: undefined, unpublishAt: undefined, tokens: undefined }));
  const errs = validateSite(site).filter((e) => e.startsWith(bad.__file));
  for (const k of ['publishAt', 'unpublishAt', 'tokens']) assert.ok(errs.some((e) => e.includes(`'${k}'`)), `缺 ${k}：${errs.join('；')}`);
  assert.ok(errs.some((e) => /\/owner must be equal to constant/.test(e)), errs.join('；'));
  // 共同 type enum 與審閱週期都登記了
  assert.ok(readJSON('schemas/_common.json').properties.type.enum.includes('theme'));
  assert.equal(readJSON('content/master/review-periods.json').theme, 0);
  // 不進 AI 白名單
  const wl = readJSON('content/governance/whitelist.json');
  assert.ok(![...(wl.allowedTypes ?? []), ...(wl.allowedTypesPro ?? [])].includes('theme'));
});

test('validate：白名單外的 token、非色碼、直接填 --theme-decoration 都擋', () => {
  const p = themeProblems(mkTheme({ tokens: { '--status-peak': '#000000', '--ink': '#333', '--theme-accent': 'red; color: red', '--theme-decoration': 'url(x)' } }));
  assert.ok(p.some((m) => m.includes('tokens.--status-peak 不在可覆寫清單')), p.join('；'));
  assert.ok(p.some((m) => m.includes('tokens.--ink 不在可覆寫清單')));
  assert.ok(p.some((m) => m.includes('tokens.--theme-accent 必須是 #rgb 或 #rrggbb')));
  assert.ok(p.some((m) => m.includes('tokens.--theme-decoration 不能直接填')));
  // 白名單只有裝飾 token；沒有狀態色、文字色、焦點框
  assert.deepEqual(Object.keys(THEME_TOKENS).sort(), ['--theme-accent', '--theme-accent-2', '--theme-header-bg']);
  for (const k of Object.keys(THEME_TOKENS)) assert.ok(baseTokens().has(k), `tokens.css 要有 ${k} 的預設值`);
});

test('validate：背景色與疊在上面的文字對比低於 4.5:1 ⇒ 擋', () => {
  const ok = themeProblems(mkTheme({ tokens: { '--theme-header-bg': '#fff7ee' } }));
  assert.deepEqual(ok, []);
  const dark = themeProblems(mkTheme({ tokens: { '--theme-header-bg': '#3a3a3a' } }));
  assert.ok(dark.some((m) => /--theme-header-bg #3a3a3a 與文字色 --ink/.test(m) && /低於 4\.5:1/.test(m)), dark.join('；'));
  // --ink-3（英文副名）比 --ink 淺，所以中間灰也會被抓到
  const mid = themeProblems(mkTheme({ tokens: { '--theme-header-bg': '#c8c8c8' } }));
  assert.ok(mid.some((m) => m.includes('--ink-3')), mid.join('；'));
  assert.ok(!mid.some((m) => m.includes('文字色 --ink（')), '--ink 對 #c8c8c8 仍 ≥ 4.5');
});

test('validate：裝飾 SVG 超過 50 KB、含腳本／外部參照／動畫 ⇒ 擋', () => {
  assert.deepEqual(svgProblems(SVG), []);
  const big = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="${'M0 0L1 1'.repeat(Math.ceil(DECORATION_MAX_BYTES / 8) + 10)}"/></svg>`;
  assert.ok(themeProblems(mkTheme({ decoration: { svg: big } })).some((m) => /超過 50 KB/.test(m)));
  assert.ok(svgProblems('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').some((m) => m.includes('script')));
  assert.ok(svgProblems('<svg xmlns="http://www.w3.org/2000/svg" onload="x()"></svg>').some((m) => m.includes('事件屬性')));
  assert.ok(svgProblems('<svg xmlns="http://www.w3.org/2000/svg"><a href="https://evil.example/"/></svg>').some((m) => m.includes('外部資源')));
  assert.ok(svgProblems('<svg xmlns="http://www.w3.org/2000/svg"><circle r="1"><animate attributeName="r" dur="1s"/></circle></svg>').some((m) => m.includes('動畫')));
});

test('validate：兩個已發布主題生效區間重疊 ⇒ 建置錯誤；首尾相接不算重疊', () => {
  const a = mkTheme({ publishAt: '2030-01-01', unpublishAt: '2030-01-10' });
  const b = mkTheme({ publishAt: '2030-01-09', unpublishAt: '2030-01-20' });
  const c = mkTheme({ publishAt: '2030-01-20', unpublishAt: '2030-01-25' });
  assert.deepEqual(overlappingThemes([a, b, c]).map(([x, y]) => [x.id, y.id]), [[a.id, b.id]]);
  assert.deepEqual(overlappingThemes([a, { ...b, status: 'draft' }]), []);
  const site = loadSite(config);
  addItem(site, a); const bb = addItem(site, b);
  const errs = validateSite(site);
  assert.ok(errs.some((e) => e.startsWith(bb.__file) && e.includes('重疊') && e.includes(a.id)), errs.filter((e) => e.includes('theme')).join('；'));
  // 示範的兩個主題不重疊
  assert.deepEqual(overlappingThemes([HW(), LNY()]), []);
});

test('themeState：只在 [publishAt, unpublishAt) 內生效（真實時間，以台灣時間 00:00 為界）', () => {
  const site = { collections: { themes: [HW(), LNY()] }, situation: {} };
  assert.equal(themeState(site, at('2026-10-23T23:59:59+08:00')).active, null);
  assert.equal(themeState(site, at('2026-10-24')).active?.id, 'theme.halloween-2026');
  assert.equal(themeState(site, at('2026-10-31T23:59:59+08:00')).active?.id, 'theme.halloween-2026');
  assert.equal(themeState(site, at('2026-11-01')).reason, 'none');
  assert.equal(themeState(site, at('2027-02-05')).active?.id, 'theme.lny-2027');
  assert.equal(themeState(site, at('2027-02-21')).active, null);
  // 草稿不生效
  assert.equal(themeState({ collections: { themes: [{ ...HW(), status: 'draft' }] }, situation: {} }, at('2026-10-25')).active, null);
});

test('alertLevel=emergency：不套用任何主題並說明原因；elevated／normal 不影響；schema 接受三個值', () => {
  const now = at('2026-10-25T12:00:00+08:00');
  const st = themeState({ collections: { themes: [HW()] }, situation: { alertLevel: 'emergency' } }, now);
  assert.equal(st.active, null); assert.equal(st.reason, 'emergency');
  assert.match(st.message, /alertLevel=emergency.*theme\.halloween-2026/);
  assert.equal(themeState({ collections: { themes: [HW()] }, situation: { alertLevel: 'elevated' } }, now).active?.id, 'theme.halloween-2026');
  const sch = readJSON('schemas/situation.json').properties.alertLevel;
  assert.deepEqual(sch.enum, ['normal', 'elevated', 'emergency']); assert.equal(sch.default, 'normal');
  const site = loadSite(config);
  site.situation.alertLevel = 'emergency';
  assert.deepEqual(validateSite(site).filter((e) => e.includes('situation/current.json')), []);
  site.situation.alertLevel = 'red';
  assert.ok(validateSite(site).some((e) => e.includes('situation/current.json') && e.includes('alertLevel')));
});

function page(theme) {
  const url = (x) => `${config.basePath}${x}`;
  const ctx = { lang: 'zh-TW', path: '/', url, t: (k, v) => T('zh-TW', k, v), fmtDate: (d) => d, site: { today: '2026-10-01', theme }, alternates: ['zh-TW'] };
  return String(layout(ctx, { title: 'x', description: 'y', body: html`<p>hi</p>` }));
}

test('layout：區間內 <html data-theme> ＋連一支主題 CSS；區間外與 emergency 時兩者都沒有', () => {
  const site = (alertLevel) => ({ collections: { themes: [HW()] }, situation: { alertLevel } });
  const on = page(themeState(site(), at('2026-10-25')));
  assert.match(on, /<html [^>]*data-theme="halloween-2026"[^>]*>/);
  assert.ok(on.includes(`<link rel="stylesheet" href="${config.basePath}/assets/styles/theme-halloween-2026.css" data-theme-css>`));
  assert.equal((on.match(/data-theme-css/g) ?? []).length, 1);
  for (const h of [page(themeState(site(), at('2026-11-01'))), page(themeState(site('emergency'), at('2026-10-25'))), page(undefined)]) {
    assert.ok(!/data-theme=/.test(h)); assert.ok(!/theme-[a-z0-9-]+\.css/.test(h));
  }
});

test('主題 CSS：只有一條 :root[data-theme] 規則、只有白名單 token 與裝飾圖；裝飾圖是背景圖（不進無障礙樹）', () => {
  const hw = HW();
  const css = themeCss(hw);
  assert.equal(themeCssPath(hw), '/assets/styles/theme-halloween-2026.css');
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, '').trim();
  assert.match(rules, /^:root\[data-theme="halloween-2026"\]\{[^{}]+\}$/);
  const props = rules.slice(rules.indexOf('{') + 1, -1).split(/;(?=--)/).map((d) => d.split(':')[0]);
  assert.deepEqual(props.sort(), ['--theme-accent', '--theme-accent-2', '--theme-decoration', '--theme-header-bg']);
  assert.match(css, /--theme-decoration:url\("data:image\/svg\+xml,%3Csvg/);
  assert.ok(!/[()'"]/.test(css.match(/data:image\/svg\+xml,([^"]*)"/)[1]), '編碼後不含可跳出 url("…") 的字元');
  assert.ok(Buffer.byteLength(css) < 4 * 1024, '主題 CSS 很小');
  // base.css 的裝飾圖是 ::after 背景圖，不是 <img>；tokens.css 的全站關動畫規則還在
  const base = fs.readFileSync(path.join(ROOT, 'src/styles/base.css'), 'utf8');
  assert.match(base, /html\[data-theme\] \.brand::after\{content:""[^}]*background:var\(--theme-decoration\)/);
  assert.match(fs.readFileSync(path.join(ROOT, 'src/styles/tokens.css'), 'utf8'), /prefers-reduced-motion: reduce\) \{ \* \{ animation: none !important/);
});

test('車道：content/themes/*.json 是快車道（公關室，與 Banner 相同）', () => {
  const c = classifyFile('content/themes/x.json');
  assert.equal(c.type, 'theme'); assert.equal(c.lane, 'fast');
  assert.equal(classifyFile('content/themes/halloween-2026.json').lane, 'fast');
  const r = laneForFiles(['content/themes/lny-2027.json'], { author: 'ancientsky' });
  assert.equal(r.lane, 'fast'); assert.equal(r.autoMerge, true); assert.equal(r.postPublishReview.owner, 'unit.pr');
});
