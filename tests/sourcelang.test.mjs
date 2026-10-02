// 第六輪（ARCHITECTURE 14.2）：內容來源語言 sourceLang。
// en 來源在 /en/ 用頂層欄位、在 zh-TW 用 i18n['zh-TW']；缺 zh-TW 譯文驗證失敗；langAvailable／langOk／langRenderable 一致；
// 譯文過期以來源語言計算；答案索引語言依 sourceLang（英文來源進英文索引、中文譯文進中文索引）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { govern, mk, addItem, config } from './helpers.mjs';
import { loadSite, sourceHashOf } from '../scripts/lib/load.mjs';
import { validateSite, sourceLangErrors } from '../scripts/lib/validate.mjs';
import { langAvailable, makeCtx } from '../scripts/lib/pages.mjs';
import { langRenderable } from '../scripts/lib/governance.mjs';
import { L, langOk } from '../src/templates/public/_partials.mjs';
import { buildSearchIndex } from '../scripts/lib/index-builder.mjs';
import * as pageTpl from '../src/templates/public/page.mjs';

const INTL = ['topic.international-cooperation', 'service.international-training-application', 'page.international-ihr-focal-point', 'page.international-multilateral', 'page.international-bilateral',
  'page.international-training', 'page.international-global-health-security', 'page.international-publications-en',
  'news.2026-05-22-international-wha-technical-exchange', 'news.2026-08-17-international-fetp-workshop', 'news.2026-09-15-international-health-mou'];

/** 合成一筆英文來源內容（不依賴真實內容） */
function enItem(over = {}) {
  return mk({
    type: 'faq', sourceLang: 'en', title: 'Who can apply?', question: 'Who can apply?', answerMarkdown: 'Foreign health officials can apply online.', summary: 'English source summary.',
    languages: { en: { status: 'source' }, 'zh-TW': { status: 'reviewed', reviewedAt: '2026-09-30', reviewer: '內部審核人' }, ja: { status: 'none' } },
    i18n: { 'zh-TW': { title: '誰可以申請？', question: '誰可以申請？', answerMarkdown: '外國衛生官員可線上申請。', summary: '中文譯文摘要。' } },
    ...over,
  });
}

test('國際合作內容：全部 sourceLang en、languages.en＝source、附 zh-TW reviewed 譯文；驗證通過', () => {
  const site = govern('2026-10-01');
  for (const id of INTL) {
    const it = site.byId.get(id);
    assert.ok(it, id);
    assert.equal(it.sourceLang, 'en', id);
    assert.equal(it.languages.en.status, 'source', id);
    assert.equal(it.languages['zh-TW'].status, 'reviewed', id);
    assert.ok(it.i18n['zh-TW'].title && it.i18n['zh-TW'].summary, `${id} 中文譯文`);
    assert.equal(it.owner, 'unit.international');
    assert.deepEqual(sourceLangErrors(it), [], id);
    assert.equal(it.gov.sourceLang, 'en');
    assert.equal(it.gov.translationStale['zh-TW'], false, `${id} 中文譯文未過期（sourceHash 一致）`);
    assert.ok(!('en' in it.gov.translationStale), '來源語言不算譯文');
  }
  assert.equal(site.unitById.get('unit.international').name, '國際合作組');
  assert.deepEqual(validateSite(loadSite(config)).filter((e) => /international/.test(e)), []);
});

test('L()：en 來源在 /en/ 用頂層欄位、在 zh-TW 用 i18n["zh-TW"]；zh-TW 來源行為不變', () => {
  const site = govern('2026-10-01');
  const tp = site.byId.get('topic.international-cooperation');
  const en = makeCtx(site, 'en'), zh = makeCtx(site, 'zh-TW'), ja = makeCtx(site, 'ja');
  assert.equal(L(en, tp, 'title'), 'International Cooperation');
  assert.equal(L(zh, tp, 'title'), '國際合作');
  assert.equal(L(zh, tp, 'introMarkdown'), tp.i18n['zh-TW'].introMarkdown);
  assert.equal(L(ja, tp, 'title'), 'International Cooperation', '沒有日文譯文 ⇒ 來源語言（英文）');
  assert.equal(L(zh, tp, 'priority'), tp.priority, 'i18n 沒有的欄位 ⇒ 頂層');
  const dg = site.byId.get('disease.dengue');
  assert.equal(L(zh, dg, 'title'), dg.title);
  assert.equal(L(en, dg, 'title'), dg.i18n.en.title);
});

test('頁面：/en/ 渲染英文頂層、zh-TW 渲染中文譯文（page 型）', () => {
  const site = govern('2026-10-01');
  const p = site.byId.get('page.international-ihr-focal-point');
  const hEn = String(pageTpl.render(makeCtx(site, 'en', { path: '/international/ihr-focal-point/' }), { item: p }));
  const hZh = String(pageTpl.render(makeCtx(site, 'zh-TW', { path: '/international/ihr-focal-point/' }), { item: p }));
  assert.ok(hEn.includes('IHR National Focal Point (24/7)'));
  assert.ok(hEn.includes('+886-800-001922'));
  assert.ok(hZh.includes(p.i18n['zh-TW'].title));
  assert.ok(hZh.includes('國際衛生條例'));
  assert.ok(!hZh.includes('What the focal point does'), 'zh-TW 不顯示英文本文');
  // pages()：en 與 zh-TW 都輸出，ja（none）不輸出
  const out = pageTpl.pages(site).filter((x) => x.props.item.id === p.id).map((x) => x.lang).sort();
  assert.deepEqual(out, ['en', 'zh-TW']);
});

test('langAvailable／langOk／langRenderable：來源語言永遠可渲染、zh-TW 永遠可渲染、其他語言照既有規則', () => {
  const site = govern('2026-10-01');
  const tp = site.byId.get('topic.international-cooperation');
  for (const fn of [(l) => langAvailable(site, tp, l), (l) => langOk(site, tp, l), (l) => langRenderable(site, tp, l)]) {
    assert.equal(fn('en'), true); assert.equal(fn('zh-TW'), true); assert.equal(fn('ja'), false); assert.equal(fn('vi'), false);
  }
  assert.deepEqual(tp.gov.renderableLangs, ['zh-TW', 'en']);
  // 一級內容（tier1）以英文為來源：en 一律可渲染（不受「只渲染 reviewed」限制）；其他語言 machine 仍不渲染
  const tier1 = site.config.tier1Types[0];
  const x = { type: tier1, sourceLang: 'en', languages: { en: { status: 'source' }, 'zh-TW': { status: 'machine' }, ja: { status: 'machine' } } };
  assert.equal(langAvailable(site, x, 'en'), true);
  assert.equal(langAvailable(site, x, 'zh-TW'), true, '中文官網不能沒有中文');
  assert.equal(langAvailable(site, x, 'ja'), false);
  assert.equal(langRenderable(site, x, 'ja'), langAvailable(site, x, 'ja'));
  // 全部內容三個函式一致
  for (const item of site.all) for (const l of config.langs.map((c) => c.code)) {
    const a = langAvailable(site, item, l);
    assert.equal(langOk(site, item, l), a, `${item.id} ${l}`);
    assert.equal(langRenderable(site, item, l), a, `${item.id} ${l}`);
  }
});

test('驗證：sourceLang≠zh-TW 缺 i18n["zh-TW"]、zh-TW 標 none／pending、來源語言未標 source、其他語言標 source 都失敗', () => {
  const site = loadSite(config);
  site.today = '2026-10-01';
  const cases = {
    'no-zh': enItem({ i18n: {} }),
    'zh-none': enItem({ languages: { en: { status: 'source' }, 'zh-TW': { status: 'none' } } }),
    'zh-pending': enItem({ languages: { en: { status: 'source' }, 'zh-TW': { status: 'pending' } } }),
    'en-not-source': enItem({ languages: { en: { status: 'reviewed' }, 'zh-TW': { status: 'reviewed' } } }),
    'zh-also-source': enItem({ languages: { en: { status: 'source' }, 'zh-TW': { status: 'source' } } }),
    'zh-no-title': enItem({ i18n: { 'zh-TW': { summary: '只有摘要' } } }),
    ok: enItem(),
  };
  for (const [k, it] of Object.entries(cases)) { it.id = `faq.test-src-${k}`; addItem(site, it); it.__file = `test/${k}.json`; }
  const errs = validateSite(site);
  const of = (k) => errs.filter((e) => e.startsWith(`test/${k}.json`));
  assert.ok(of('no-zh').some((e) => e.includes('i18n["zh-TW"]')), of('no-zh').join('\n'));
  assert.ok(of('zh-none').some((e) => e.includes('reviewed 或 machine')), of('zh-none').join('\n'));
  assert.ok(of('zh-pending').some((e) => e.includes('reviewed 或 machine')));
  assert.ok(of('en-not-source').some((e) => e.includes('languages.en.status 必須為 source')));
  assert.ok(of('zh-also-source').some((e) => e.includes('languages.zh-TW.status 為 source')));
  assert.ok(of('zh-no-title').some((e) => e.includes('i18n["zh-TW"].title 必填')));
  assert.deepEqual(of('ok'), []);
  // schema：sourceLang 只能是七語
  const bad = enItem({ sourceLang: 'fr' }); bad.id = 'faq.test-src-fr'; addItem(site, bad); bad.__file = 'test/fr.json';
  assert.ok(validateSite(site).some((e) => e.startsWith('test/fr.json') && e.includes('/sourceLang')));
  // 既有 zh-TW 來源內容不受影響
  assert.deepEqual(validateSite(loadSite(config)).filter((e) => e.includes('source')), []);
});

test('譯文過期以來源語言計算：改英文頂層 ⇒ zh-TW 譯文過期＋待辦「英文正本已更新」；只改中文譯文不會讓自己過期', () => {
  const base = govern('2026-10-01');
  const id = 'topic.international-cooperation';
  assert.equal(base.byId.get(id).languages['zh-TW'].sourceHash, sourceHashOf(base.byId.get(id)), '內容檔記錄的 sourceHash＝英文頂層雜湊');
  const s1 = govern('2026-10-01', (s) => { const it = s.byId.get(id); it.introMarkdown += '\n\n- **New** — added in English.'; it.sourceHash = sourceHashOf(it); });
  const it1 = s1.byId.get(id);
  assert.equal(it1.gov.translationStale['zh-TW'], true);
  assert.match(it1.gov.languageNotes['zh-TW'].note, /^英文正本已更新/);
  const todo = s1.gov.todos.find((t) => t.id === `translation-stale:${id}:zh-TW`);
  assert.ok(todo, '中文譯文待複核待辦');
  assert.match(todo.text, /英文正本已更新，繁體中文（zh-TW）譯文待複核/);
  assert.equal(todo.severity, 'medium', '中文官網的中文譯文過期至少 medium');
  const s2 = govern('2026-10-01', (s) => { const it = s.byId.get(id); it.i18n['zh-TW'].introMarkdown += '（修訂）'; it.sourceHash = sourceHashOf(it); });
  assert.equal(s2.byId.get(id).gov.translationStale['zh-TW'], false);
  // 過期的中文譯文不進中文索引；英文來源 chunk 照常
  s1.searchIndex = buildSearchIndex(s1);
  const ch = s1.searchIndex.public.filter((c) => c.contentId === id);
  assert.ok(ch.some((c) => c.lang === 'en'));
  assert.ok(!ch.some((c) => c.lang === 'zh-TW'), '過期譯文退出中文索引');
});

test('答案索引：英文來源 chunk 進英文索引（頂層文字），zh-TW 譯文 chunk 進中文索引（i18n 文字），不混語', () => {
  const site = govern('2026-10-01');
  site.searchIndex = buildSearchIndex(site);
  const idx = site.searchIndex.public;
  for (const id of ['topic.international-cooperation', 'service.international-training-application', 'news.2026-08-17-international-fetp-workshop']) {
    const ch = idx.filter((c) => c.contentId === id);
    const en = ch.filter((c) => c.lang === 'en'), zh = ch.filter((c) => c.lang === 'zh-TW');
    assert.ok(en.length && zh.length, `${id} 兩種語言都有 chunk`);
    assert.ok(en.every((c) => c.id.endsWith('@en')), '英文 chunk id 帶 @en');
    assert.ok(en.every((c) => !/[一-鿿]/.test(c.text)), `${id} 英文 chunk 不含中文：${en.find((c) => /[一-鿿]/.test(c.text))?.text}`);
    assert.ok(zh.every((c) => /[一-鿿]/.test(c.text)), `${id} 中文 chunk 為中文`);
  }
  const svcEn = idx.find((c) => c.id === 'service.international-training-application#steps@en');
  assert.match(svcEn.text, /^Step 1: Choose a program\./);
  const svcZh = idx.find((c) => c.id === 'service.international-training-application#steps');
  assert.match(svcZh.text, /^第 1 步：選擇訓練計畫。/);
  // 頁面（page 型）不在白名單政策內 ⇒ 不進索引
  assert.ok(!idx.some((c) => c.contentId.startsWith('page.international-')));
  // 既有中文來源內容：中文 chunk 無 @ 後綴
  assert.ok(idx.some((c) => c.contentId === 'disease.dengue' && c.lang === 'zh-TW' && !c.id.includes('@')));
});
