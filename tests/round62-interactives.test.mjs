// 第六十二輪：彩蛋與互動模組是「有開關、有權責、有檔期的內容」（content/interactives/）——schema、放置位置白名單、basedOn 參照、
// 開關／檔期／疫情緊急三層顯示條件、首頁只在開著時長出小卡與「互動與遊戲」、外語首頁不出現、/play/ 頁與純文字版、後台開關頁、快車道。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { config, addItem, govern, mk } from './helpers.mjs';
import { loadSite, ROOT } from '../scripts/lib/load.mjs';
import { validateSite } from '../scripts/lib/validate.mjs';
import { makeCtx } from '../scripts/lib/pages.mjs';
import { classifyFile, publishAtMs } from '../scripts/lib/lanes.mjs';
import { KINDS, PLACEMENTS, interactiveProblems, interactivesState, interactiveStatus, pickOnThisDay, liveQuestions, emitInteractives, interactivePath, isInteractiveOn } from '../scripts/lib/interactives.mjs';
import * as home from '../src/templates/public/home.mjs';
import * as play from '../src/templates/public/play.mjs';
import * as admin from '../src/templates/admin/interactives.mjs';
import { layout } from '../src/templates/layout.mjs';

const readJSON = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const str = (x) => String(x);
const IDS = ['interactive.easter-egg-handwash', 'interactive.kids-quiz', 'interactive.on-this-day', 'interactive.policy-sim-dengue'];

function mkIx(over = {}) {
  return mk({
    type: 'interactive', id: `interactive.test-${Math.random().toString(36).slice(2, 8)}`, kind: 'kids-quiz', enabled: true, placements: ['home-bottom', 'play-hub'], owner: 'unit.pr', reviewPeriodMonths: 6,
    questions: [{ q: '測試題目？', choices: ['甲', '乙'], answer: 1, explain: '測試說明。', basedOn: 'disease.dengue' }], aiWhitelist: undefined, ...over,
  });
}
const render = (site, mod, pathStr, props) => str(mod.render(makeCtx(site, 'zh-TW', { path: pathStr, alternates: ['zh-TW'] }), props));

test('schema：四個示範模組通過；型別、審閱週期、車道、後台標籤都登記了；不進 AI 白名單', () => {
  const site = loadSite(config);
  assert.deepEqual(site.collections.interactives.map((i) => i.id).sort(), IDS);
  assert.deepEqual(validateSite(site).filter((e) => e.includes('content/interactives/')), []);
  assert.ok(readJSON('schemas/_common.json').properties.type.enum.includes('interactive'));
  assert.equal(readJSON('content/master/review-periods.json').interactive, 6);
  assert.ok(readJSON('content/governance/lanes.json').lanes.fast.types.includes('interactive'));
  const wl = readJSON('content/governance/whitelist.json');
  assert.ok(![...(wl.allowedTypes ?? []), ...(wl.allowedTypesPro ?? [])].includes('interactive'));
  const c = classifyFile('content/interactives/on-this-day.json');
  assert.equal(c.type, 'interactive'); assert.equal(c.lane, 'fast');
  // 每一種 kind 都有允許的位置；位置都有說明
  for (const [k, d] of Object.entries(KINDS)) for (const p of d.placements) assert.ok(PLACEMENTS[p], `${k} → ${p}`);
});

test('schema：缺 kind／enabled／placements、未知 kind、未知位置都擋', () => {
  const site = loadSite(config);
  const bad = addItem(site, mkIx({ kind: undefined, enabled: undefined, placements: undefined }));
  const errs = validateSite(site).filter((e) => e.startsWith(bad.__file));
  for (const k of ['kind', 'enabled', 'placements']) assert.ok(errs.some((e) => e.includes(`'${k}'`)), `缺 ${k}：${errs.join('；')}`);
  const site2 = loadSite(config);
  const bad2 = addItem(site2, mkIx({ kind: 'roulette', placements: ['sidebar'] }));
  const errs2 = validateSite(site2).filter((e) => e.startsWith(bad2.__file));
  assert.ok(errs2.some((e) => /kind/.test(e)) && errs2.some((e) => /placements/.test(e)), errs2.join('；'));
});

test('validate：位置白名單（歷史上的今天不能放首頁最下方、彩蛋只能在站名圖示）、答案序號、basedOn 參照、量表 key、預設結局', () => {
  const site = loadSite(config);
  const otd = site.byId.get('interactive.on-this-day');
  const p1 = interactiveProblems({ ...otd, placements: ['home-bottom'] }, site);
  assert.ok(p1.some((m) => m.includes('歷史上的今天 不能放在')), p1.join('；'));
  const egg = site.byId.get('interactive.easter-egg-handwash');
  assert.ok(interactiveProblems({ ...egg, placements: ['home-side'] }, site).some((m) => m.includes('首頁彩蛋 不能放在')));
  const q = interactiveProblems(mkIx({ questions: [{ q: '題？', choices: ['a', 'b'], answer: 2, explain: '說明。', basedOn: 'disease.nope' }] }), site);
  assert.ok(q.some((m) => m.includes('answer 2 超出選項範圍')), q.join('；'));
  assert.ok(q.some((m) => m.includes('basedOn disease.nope 不存在')));
  const sim = site.byId.get('interactive.policy-sim-dengue');
  const s1 = interactiveProblems({ ...sim, scenario: { ...sim.scenario, rounds: [{ title: 'x', prompt: 'y', options: [{ label: 'a', effects: { money: 5 }, feedback: 'f' }, { label: 'b', effects: {}, feedback: 'g' }] }], endings: [{ when: { breeding: { max: 10 } }, text: 'z' }] } }, site);
  assert.ok(s1.some((m) => m.includes('effects.money 不是量表')), s1.join('；'));
  assert.ok(s1.some((m) => m.includes('預設結局')));
  // 檔期先後
  assert.ok(interactiveProblems(mkIx({ publishAt: '2026-12-01', unpublishAt: '2026-11-01' }), site).some((m) => m.includes('必須晚於')));
  // 歷史條目：verified:true 要填 verifiedBy；無效日期
  const o1 = interactiveProblems({ ...otd, entries: [{ month: 2, day: 30, year: 2000, text: '測試', source: 's', verified: true }] }, site);
  assert.ok(o1.some((m) => m.includes('不是有效日期')) && o1.some((m) => m.includes('verifiedBy')), o1.join('；'));
  // 示範條目全部標 verified:false（尚未由企劃組核對）
  assert.ok(otd.entries.length >= 15 && otd.entries.every((e) => e.verified === false && e.source));
});

test('顯示條件：enabled=false、檔期未到／已過、未發布、排程中都不顯示；alertLevel=emergency 全部關閉；狀態字對應', () => {
  const at = (s) => publishAtMs(s);
  const base = (over = {}) => mkIx({ status: 'published', ...over });
  const now = at('2026-10-25');
  assert.equal(isInteractiveOn(base(), now), true);
  assert.equal(isInteractiveOn(base({ enabled: false }), now), false);
  assert.equal(isInteractiveOn(base({ publishAt: '2026-11-01' }), now), false);
  assert.equal(isInteractiveOn(base({ unpublishAt: '2026-10-25' }), now), false, 'unpublishAt 當日 00:00 起不顯示');
  assert.equal(isInteractiveOn(base({ publishAt: '2026-10-01', unpublishAt: '2026-11-01' }), now), true);
  assert.equal(isInteractiveOn(base({ status: 'draft' }), now), false);
  assert.equal(interactiveStatus(base({ enabled: false }), now), 'off');
  assert.equal(interactiveStatus(base({ publishAt: '2026-11-01' }), now), 'upcoming');
  assert.equal(interactiveStatus(base({ unpublishAt: '2026-10-01' }), now), 'ended');
  assert.equal(interactiveStatus(base({ status: 'draft' }), now), 'draft');
  const site = (alertLevel, items) => ({ collections: { interactives: items }, situation: { alertLevel } });
  const on = interactivesState(site('normal', [base(), base({ enabled: false })]), now);
  assert.equal(on.reason, 'active'); assert.equal(on.list.length, 1);
  const em = interactivesState(site('emergency', [base()]), now);
  assert.equal(em.reason, 'emergency'); assert.deepEqual(em.list, []); assert.match(em.message, /alertLevel=emergency/);
  assert.equal(interactivesState(site('normal', [base({ enabled: false })]), now).reason, 'none');
  // applyGovernance 寫 gov.interactiveStatus 與 site.interactives
  const g = govern('2026-10-25');
  assert.equal(g.interactives.reason, 'active');
  assert.deepEqual(g.interactives.list.map((i) => i.id).sort(), IDS);
  for (const id of IDS) assert.equal(g.byId.get(id).gov.interactiveStatus, 'on');
});

test('歷史上的今天：同日 → 同月下一條 → 跨年第一條；測驗題只留 basedOn 在線上的', () => {
  const site = govern('2026-10-25');
  const otd = site.byId.get('interactive.on-this-day');
  const e1 = pickOnThisDay(otd.entries, '07-23');
  assert.equal(e1.exact, true); assert.deepEqual(e1.entries.map((e) => e.year).sort(), [2013, 2022]);
  const e2 = pickOnThisDay(otd.entries, '10-25');
  assert.equal(e2.exact, false); assert.equal(e2.mmdd, '10-26');
  const e3 = pickOnThisDay(otd.entries, '12-31');
  assert.equal(e3.exact, false); assert.equal(e3.mmdd, '01-15', '跨年回到第一條');
  assert.deepEqual(pickOnThisDay([], '01-01'), { entries: [], exact: false, mmdd: '01-01' });
  // 測驗：把一題的依據改成草稿 ⇒ 該題隱藏
  const quiz = site.byId.get('interactive.kids-quiz');
  const all = liveQuestions(site, quiz);
  assert.equal(all.length, quiz.questions.length);
  const dengue = site.byId.get('disease.dengue');
  const saved = dengue.status; dengue.status = 'draft';
  const fewer = liveQuestions(site, quiz);
  assert.equal(fewer.length, quiz.questions.length - quiz.questions.filter((q) => q.basedOn === 'disease.dengue').length);
  dengue.status = saved;
  // 每題都綁站內內容、說明與選項都在長度內
  for (const q of quiz.questions) { assert.ok(site.byId.has(q.basedOn), q.basedOn); assert.ok(q.answer < q.choices.length); }
});

test('首頁（中文）：右側欄小卡、最下方「互動與遊戲」、彩蛋設定節點與一支小腳本；全部關閉時都沒有；外語首頁沒有', () => {
  const site = govern('2026-10-25');
  const h = render(site, home, '/');
  assert.match(h, /<section class="c-otd c-otd--card" data-otd data-otd-src="[^"]*\/v1\/interactives\/on-this-day\.json" data-today="10-25"/);
  assert.ok(h.includes('歷史上的今天') && h.includes('今天沒有紀錄，最近的一條是 10/26'), '建置日沒有條目 ⇒ 顯示最近一條');
  assert.ok(h.includes('待確認'), '未核對的條目標「待確認」');
  assert.match(h, /<section class="c-home__play"[^>]*>[\s\S]*c-playcard[\s\S]*\/play\/kids-quiz\/[\s\S]*\/play\/policy-sim-dengue\//);
  assert.match(h, /<div data-egg hidden data-egg-triggers="brand-taps,keys" data-egg-taps="5" data-egg-keys="1922" data-egg-title="你發現了彩蛋！"/);
  assert.deepEqual(home.meta(makeCtx(site, 'zh-TW', { path: '/' })).scripts, ['/assets/js/interactives-home.js']);
  // 外語首頁：沒有譯文 ⇒ 什麼都不出現、也不多載腳本
  const enCtx = makeCtx(site, 'en', { path: '/', alternates: ['zh-TW', 'en'] });
  const he = str(home.render(enCtx));
  assert.ok(!he.includes('data-otd') && !he.includes('c-home__play') && !he.includes('data-egg'), '外語首頁沒有互動模組');
  assert.deepEqual(home.meta(enCtx).scripts, []);
  // 全部關掉 ⇒ 中文首頁也沒有
  const off = govern('2026-10-25', (s) => { for (const i of s.collections.interactives) i.enabled = false; });
  const ho = render(off, home, '/');
  assert.ok(!ho.includes('data-otd') && !ho.includes('c-home__play') && !ho.includes('data-egg'));
  assert.deepEqual(home.meta(makeCtx(off, 'zh-TW', { path: '/' })).scripts, []);
  // 疫情緊急 ⇒ 同樣沒有
  const em = govern('2026-10-25', (s) => { s.situation.alertLevel = 'emergency'; });
  assert.ok(!render(em, home, '/').includes('data-otd'));
  assert.equal(em.interactives.reason, 'emergency');
});

test('/play/：專頁列出有頁面且開著的模組；模組頁有純文字版與資料 JSON、依據連結、示範標示；彩蛋沒有頁面；頁尾有連結', () => {
  const site = govern('2026-10-25');
  const pages = play.pages(site);
  assert.deepEqual(pages.map((p) => p.path).sort(), ['/play/', '/play/kids-quiz/', '/play/on-this-day/', '/play/policy-sim-dengue/']);
  assert.ok(pages.every((p) => !p.lang), '模組頁目前只有中文');
  assert.equal(interactivePath(site.byId.get('interactive.easter-egg-handwash')), '/');
  const hub = render(site, play, '/play/', {});
  assert.ok(hub.includes('/play/kids-quiz/') && hub.includes('/play/policy-sim-dengue/') && hub.includes('/play/on-this-day/'));
  const quiz = render(site, play, '/play/kids-quiz/', { id: 'interactive.kids-quiz' });
  assert.match(quiz, /data-play-kind="kids-quiz"/);
  assert.match(quiz, /<script type="application\/json" data-quiz-data>/);
  assert.match(quiz, /<div class="c-quiz__stage" data-quiz-stage hidden>/);
  assert.ok((quiz.match(/<details class="c-quiz__q">/g) ?? []).length === 8, '沒有 JS 時 8 題都是 <details>');
  assert.ok(quiz.includes('依據：') && quiz.includes('/faq/dengue-container-check/'));
  assert.ok(quiz.includes('示範內容，待權責單位確認'));
  const sim = render(site, play, '/play/policy-sim-dengue/', { id: 'interactive.policy-sim-dengue' });
  assert.match(sim, /data-sim-data/); assert.ok(sim.includes('教學用簡化模型'));
  assert.ok((sim.match(/<details class="c-sim__round">/g) ?? []).length === 4);
  const otd = render(site, play, '/play/on-this-day/', { id: 'interactive.on-this-day' });
  assert.match(otd, /data-otd-today data-today="10-25"/);
  assert.ok(otd.includes('id="otd-m7"') && otd.includes('出處：'));
  assert.ok((otd.match(/待確認/g) ?? []).length >= 15);
  // 模組頁的 meta 帶 play.js；專頁不帶
  assert.deepEqual(play.meta(makeCtx(site, 'zh-TW', { path: '/play/kids-quiz/' }), { id: 'interactive.kids-quiz' }).scripts, ['/assets/js/play.js']);
  assert.equal(play.meta(makeCtx(site, 'zh-TW', { path: '/play/' }), {}).scripts, undefined);
  // 頁尾連結（七語都有，外語退回中文正本由 makeUrl 處理）
  const ctx = makeCtx(site, 'vi', { path: '/', alternates: ['zh-TW', 'vi'] });
  const foot = str(layout(ctx, { title: 'x', description: 'y', body: '' }));
  assert.ok(foot.includes('Trò chơi &amp; tương tác') || foot.includes('Trò chơi & tương tác'));
  // 關掉的模組不出現在 /play/、也沒有自己的頁
  const off = govern('2026-10-25', (s) => { s.byId.get('interactive.kids-quiz').enabled = false; });
  assert.ok(!play.pages(off).some((p) => p.path === '/play/kids-quiz/'));
  assert.ok(!render(off, play, '/play/', {}).includes('/play/kids-quiz/'));
});

test('v1/interactives/<slug>.json：只輸出顯示中的「歷史上的今天」；關掉就沒有檔', () => {
  const site = govern('2026-10-25');
  const files = {};
  assert.equal(emitInteractives(site, (p, c) => { files[p] = c; }), 1);
  const j = JSON.parse(files['v1/interactives/on-this-day.json']);
  assert.equal(j.id, 'interactive.on-this-day'); assert.ok(j.entries.length >= 15);
  assert.deepEqual(Object.keys(j.entries[0]).sort(), ['day', 'link', 'month', 'source', 'sourceUrl', 'text', 'verified', 'year']);
  const off = govern('2026-10-25', (s) => { s.byId.get('interactive.on-this-day').enabled = false; });
  assert.equal(emitInteractives(off, () => {}), 0);
});

test('後台 /admin/interactives/：清單列出四個模組與狀態、嵌入資料不含建置欄位、有開關表單與送審面板；導覽列有入口', () => {
  const site = govern('2026-10-25');
  const h = render(site, admin, '/admin/interactives/');
  for (const id of IDS) assert.ok(h.includes(`data-ix-row="${id}"`), id);
  assert.ok(h.includes('目前顯示 4 個模組') && h.includes('開啟中・顯示中'));
  assert.ok(h.includes('條待確認'), '歷史條目待確認數');
  const data = JSON.parse(h.match(/<script type="application\/json" id="adm-ix-data">([\s\S]*?)<\/script>/)[1]);
  assert.equal(data.items.length, 4);
  for (const r of data.items) { assert.ok(!('gov' in r.item) && !('__file' in r.item) && !('sourceHash' in r.item)); assert.equal(r.status, 'on'); }
  assert.ok(h.includes('id="ix-enabled"') && h.includes('id="gw-panel"') && h.includes('id="ix-from"'));
  const em = govern('2026-10-25', (s) => { s.situation.alertLevel = 'emergency'; });
  assert.ok(render(em, admin, '/admin/interactives/').includes('全站緊急警戒：互動模組全部隱藏'));
  const nav = fs.readFileSync(path.join(ROOT, 'src/templates/admin/_partials.mjs'), 'utf8');
  assert.match(nav, /key: 'interactives', href: '\/admin\/interactives\/'/);
  assert.equal(admin.pages()[0].path, '/admin/interactives/');
});

test('前端：play.js 與 interactives-home.js 存在、不塞 innerHTML、只用 textContent／建節點；彩蛋對話框可用 Esc 關', () => {
  const p = fs.readFileSync(path.join(ROOT, 'src/client/play.js'), 'utf8');
  const hme = fs.readFileSync(path.join(ROOT, 'src/client/interactives-home.js'), 'utf8');
  for (const src of [p, hme]) assert.ok(!/\.innerHTML\s*=/.test(src), '前台互動不用 innerHTML');
  assert.match(hme, /e\.key === 'Escape'/);
  assert.match(hme, /aria-modal/);
  assert.match(p, /role: 'meter'/);
  assert.ok(!/animation|transition/.test(fs.readFileSync(path.join(ROOT, 'src/styles/components.css'), 'utf8').split('第六十二輪')[1].replace(/transition:border-color \.15s,box-shadow \.15s/g, '')), '互動元件沒有動畫');
});
