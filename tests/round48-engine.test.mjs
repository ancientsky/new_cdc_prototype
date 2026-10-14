// 第四十八輪：答案引擎（issue #93 待確認標示、#94 民眾說法、#95 指名疫苗、#96 連接詞句、#101 外語退回中文、#102 低相關判斷）
// 與拒答文案依語言拆檔（JS 預算）。規則說明見 docs/ask-search-llm.md §12。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config } from '../site.config.mjs';
import { loadSite } from '../scripts/lib/load.mjs';
import { applyGovernance } from '../scripts/lib/governance.mjs';
import { buildSearchIndex } from '../scripts/lib/index-builder.mjs';
import { applyConsistency } from '../scripts/lib/consistency.mjs';
import { pendingReviewWarnings, contentWarnings, PENDING_REVIEW_MSG } from '../scripts/lib/validate.mjs';
import { emitRefusalBundles } from '../scripts/lib/i18n-split.mjs';
import { engineFromSite } from '../eval/run-eval.mjs';
import { createEngine } from '../src/client/answer/core.js';
import { groundingOf, judge } from '../src/client/answer/judge.js';
import { REFUSAL_TEXT, isLowRelevance, registerRefusalText, refusalCopy } from '../src/client/answer/rules.js';
import { REFUSAL_TEXT_I18N } from '../src/client/answer/refusal-i18n.js';
import { latinStems } from '../src/client/answer/lexicon.js';

globalThis.window ??= {};
globalThis.document ??= { documentElement: { lang: 'zh-TW', dataset: {} }, querySelector: () => null, head: { appendChild() {} }, createElement: () => ({}) };
globalThis.location ??= { pathname: '/ask/' };
const { sourceList } = await import('../src/client/answer/render.js');

let SITE = null;
function site() {
  if (SITE) return SITE;
  SITE = loadSite(config);
  SITE.today = '2026-10-14';
  applyGovernance(SITE);
  SITE.searchIndex = buildSearchIndex(SITE);
  applyConsistency(SITE);
  return SITE;
}
let ENGINE = null;
const engine = () => (ENGINE ??= engineFromSite(site()));
const cites = (r) => (r.sources ?? []).map((s) => s.contentId);
const text = (r) => (r.sentences ?? []).map((s) => s.text).join(' ');

// ───────── #93 待確認 ─────────
test('#93：引用 verification: pending 的內容，句尾加「（待確認）」；grounding 照樣通過；來源卡摘要列就標「內容待確認」', () => {
  const r = engine().answer('嬰兒怎麼預防 RSV', { lang: 'zh-TW' });
  assert.ok(cites(r).includes('faq.infant-rsv-prevention'));
  assert.ok(r.sentences.length > 0);
  for (const s of r.sentences) { assert.ok(s.text.endsWith('（待確認）'), s.text); assert.equal(s.pending, '（待確認）'); }
  const g = groundingOf(r);
  assert.equal(g.grounded, g.total, `grounding ${g.bad.join('／')}`);
  const html = sourceList(r.sources);
  assert.match(html.split('</summary>')[0], /c-tag--warn">內容待確認</);
  // 已確認內容不加
  const ok = engine().answer('登革熱症狀', { lang: 'zh-TW' });
  assert.ok(!text(ok).includes('（待確認）'));
});

test('#93：時程表句已經有「（待確認）」時不重複加', () => {
  const r = engine().answer('新生兒要打什麼疫苗', { lang: 'zh-TW' });
  for (const s of r.sentences) assert.doesNotMatch(s.text, /（待確認）（待確認）/);
});

test('#93：驗證規則——待確認內容的 aiWhitelist.approvedAt＝reviewedAt＝publishedAt 只警告，不進 validateSite 錯誤、不汙染 contentWarnings', () => {
  const fake = { all: [
    { __file: 'a.json', status: 'published', publishedAt: '2026-10-11', reviewedAt: '2026-10-11', aiWhitelist: { approvedAt: '2026-10-11' }, verification: { status: 'pending' } },
    { __file: 'b.json', status: 'published', publishedAt: '2026-10-11', reviewedAt: '2026-10-12', aiWhitelist: { approvedAt: '2026-10-12' }, verification: { status: 'pending' } },
    { __file: 'c.json', status: 'published', publishedAt: '2026-10-11', reviewedAt: '2026-10-11', aiWhitelist: { approvedAt: '2026-10-11' }, verification: { status: 'confirmed' } },
    { __file: 'd.json', status: 'draft', publishedAt: '2026-10-11', reviewedAt: '2026-10-11', aiWhitelist: { approvedAt: '2026-10-11' }, verification: { status: 'pending' } },
  ] };
  const w = pendingReviewWarnings(fake);
  assert.equal(w.length, 1);
  assert.ok(w[0].startsWith('a.json: ') && w[0].includes(PENDING_REVIEW_MSG));
  const real = loadSite(config);
  assert.ok(pendingReviewWarnings(real).some((x) => x.includes('infant-rsv-prevention')), '現有內容會被警告（不擋建置）');
  assert.deepEqual(contentWarnings(real), []);
});

// ───────── #94 民眾說法 ─────────
test('#94：主題錨點（內容關鍵字）——呼吸道融合病毒、餵母乳、漏打的口語、查接種紀錄、鼬獾', () => {
  const E = engine();
  const rsv = E.answer('新生兒呼吸道融合病毒要打針嗎', { lang: 'zh-TW' });
  assert.ok(!rsv.schedule, '不改走年齡時程表');
  assert.equal(cites(rsv)[0], 'faq.infant-rsv-prevention');
  const bf = E.answer('餵母乳可以打新冠疫苗嗎', { lang: 'zh-TW' });
  assert.ok(cites(bf).includes('faq.pregnancy-breastfeeding-vaccination'), cites(bf).join());
  const cu = E.answer('小孩五合一晚了兩個月才打可以嗎', { lang: 'zh-TW' });
  assert.equal(cu.refused, false);
  assert.equal(cites(cu)[0], 'faq.catch-up-vaccination');
  const rec = E.answer('打過什麼疫苗要去哪裡查', { lang: 'zh-TW' });
  assert.equal(rec.intent, 'apply');
  assert.ok(!rec.whereAsk);
  assert.ok(cites(rec).includes('service.vaccination-record-reissue'), cites(rec).join());
  assert.ok(!cites(rec).includes('faq.influenza-vaccine-where'));
  const bite = E.answer('被鼬獾咬', { lang: 'zh-TW' });
  assert.equal(bite.refused, false);
  assert.ok(cites(bite).every((c) => /rabies/.test(c)), cites(bite).join());
});

test('#94：錨點不越過「問 A 病不拿 B 病」——流感停課不拿腸病毒停課標準回答；去哪裡打疫苗仍是接種點', () => {
  const E = engine();
  for (const q of ['流感停課', '流感班上幾個人要停課']) assert.ok(!cites(E.answer(q, { lang: 'zh-TW' })).some((c) => /enterovirus|ev-/.test(c)), q);
  const where = E.answer('公費流感疫苗去哪裡打', { lang: 'zh-TW' });
  assert.equal(where.whereAsk, true);
  assert.equal(where.intent, 'vaccine');
});

// ───────── #95 指名疫苗 ─────────
function miniVaccineEngine(extraChunks = []) {
  const base = { type: 'faq', lang: 'zh-TW', whitelist: true, isCurrent: true, owner: 'unit.x', ownerName: '測試組', reviewedAt: '2026-10-01', url: '/faq/x/', countries: [], tasks: ['vaccines'], audience: ['public'] };
  const ch = (id, title, sents, extra = {}) => ({ ...base, id, contentId: id.split('#')[0], title, text: sents.join(' '), sentences: sents, terms: [], diseases: ['disease.x'], vaccines: [], ...extra });
  const index = [
    ch('vaccine.a#v', '甲疫苗', ['甲疫苗公費對象為出生滿 12 個月的幼兒，接種 1 劑。', '甲疫苗為活性減毒疫苗，可預防某某病。'], { type: 'vaccine', vaccines: ['vaccine.a'] }),
    ch('faq.a-doses#a', '甲疫苗要打幾劑？', ['公費甲疫苗於幼兒出生滿 12 個月接種 1 劑。', '醫界建議 4–6 歲可再自費接種第 2 劑。']),
    ch('disease.x#vaccine', '某某病 · 疫苗', ['甲疫苗為活性減毒疫苗，公費對象為出生滿 12 個月的幼兒。'], { type: 'disease' }),
    ch('disease.x#symptoms', '某某病 · 症狀', ['某某病會出現發燒與水泡，請就醫。'], { type: 'disease' }),
    ...['一', '二', '三', '四', '五', '六'].map((n) => ch(`faq.filler-${n}#a`, `其他問題${n}`, [`第${n}則與疫苗無關的衛教說明，請勤洗手並注意飲食衛生。`], { diseases: [] })),
    ...extraChunks.map((c) => ch(c.id, c.title, c.sentences, c.extra)),
  ];
  return createEngine({
    index, today: '2026-10-14',
    diseases: [{ id: 'disease.x', name: '某某病', aliases: [] }],
    vaccines: [
      { id: 'vaccine.a', slug: 'a', name: '甲疫苗', aliases: [], diseases: ['disease.x'], hasPage: true },
      { id: 'vaccine.b', slug: 'b', name: '乙疫苗', nameEn: 'B vaccine', aliases: ['皮乙疫苗'], diseases: ['disease.x'], hasPage: false },
    ],
    schedule: [{ id: 'sched.b', vaccine: 'vaccine.b', label: '乙疫苗 2 劑', funded: 'self', ageMinMonths: 600 }],
  });
}

test('#95：問句點名的疫苗沒有任何片段講到、同一疾病另有別支疫苗 ⇒ 不答別支疫苗，回「本站尚無○○專頁」並連到時程表那一列', () => {
  for (const q of ['乙疫苗公費嗎', '皮乙疫苗去哪裡打', '皮乙疫苗']) {
    const r = miniVaccineEngine().answer(q, { lang: 'zh-TW' });
    assert.equal(r.refused, true, q);
    assert.equal(r.refusal.kind, 'no-match');
    assert.ok(r.guards.some((g) => g.reason === 'vaccine-no-page' && g.vaccine === 'vaccine.b'), q);
    assert.match(r.refusal.text, /本站尚無乙疫苗專頁/);
    assert.ok(r.refusal.actions.some((a) => a.href === '/vaccines/schedule/#sched.b'));
    assert.ok(r.refusal.actions.some((a) => a.href === 'tel:1922'));
    assert.deepEqual(r.sources, []);
  }
  const en = miniVaccineEngine().answer('乙疫苗公費嗎', { lang: 'en' });
  assert.match(en.refusal.text, /no page on the B vaccine/);
});

test('#95：那支疫苗有片段時用它回答，並排除只講別支疫苗的片段；問別支疫苗本身照常回答', () => {
  const E = miniVaccineEngine([{ id: 'vaccine.b#v', title: '乙疫苗', sentences: ['乙疫苗為成人自費接種的疫苗，共接種 2 劑。'], extra: { type: 'vaccine', vaccines: ['vaccine.b'] } }]);
  const r = E.answer('乙疫苗公費嗎', { lang: 'zh-TW' });
  assert.equal(r.refused, false);
  assert.deepEqual([...new Set(cites(r))], ['vaccine.b']);
  assert.ok(!text(r).includes('甲疫苗'));
  const a = miniVaccineEngine().answer('甲疫苗公費嗎', { lang: 'zh-TW' });
  assert.equal(a.refused, false);
  assert.ok(cites(a).includes('vaccine.a') || cites(a).includes('faq.a-doses'));
});

test('#95：實站（不論帶狀疱疹疫苗頁是否已上線）皮蛇疫苗不答成水痘疫苗', () => {
  const s = site();
  const without = engineFromSite({ ...s, searchIndex: { public: s.searchIndex.public.filter((c) => c.contentId !== 'vaccine.zoster' && !(c.vaccines ?? []).includes('vaccine.zoster') && !/帶狀疱疹|皮蛇|zoster/i.test(`${c.title ?? ''} ${c.text ?? ''} ${c.question ?? ''} ${c.contentId}`)), pro: s.searchIndex.pro } });
  for (const E of [engine(), without]) {
    for (const q of ['皮蛇疫苗', '皮蛇疫苗公費嗎', '帶狀疱疹疫苗去哪裡打']) {
      const r = E.answer(q, { lang: 'zh-TW' });
      assert.ok(!cites(r).some((c) => /varicella/.test(c)), `${q}：${cites(r).join()}`);
      // 帶狀疱疹疫苗頁上線後，頁面本身會寫「皮蛇疫苗不是水痘疫苗」——只在沒有專頁時要求答案不出現「水痘疫苗」
      if (E === without) assert.ok(!text(r).includes('水痘疫苗'), q);
    }
  }
  const r = without.answer('皮蛇疫苗公費嗎', { lang: 'zh-TW' });
  assert.equal(r.refused, true);
  assert.match(r.refusal.text, /本站尚無帶狀疱疹疫苗專頁/);
  assert.ok(r.refusal.actions.some((a) => a.href === '/vaccines/schedule/#sched.zoster'));
});

// ───────── #96 連接詞句 ─────────
test('#96：連接詞開頭的句子——上一句也選入就接在一起（原文連續、grounding 通過），否則不選', () => {
  const E = engine();
  const r = E.answer('流感班上幾個人要停課', { lang: 'zh-TW' });
  assert.ok(!r.sentences.some((s) => /^(但|不過|因此|此外|另外)/.test(s.text)), text(r));
  assert.ok(!text(r).includes('正在哺乳'));
  const bf = E.answer('哺乳期間可以打疫苗嗎', { lang: 'zh-TW' });
  const joined = bf.sentences.find((s) => s.text.includes('告知醫師'));
  assert.ok(joined, text(bf));
  assert.match(joined.text, /^哺乳期間：.*；\s但個別疫苗/);
  const g = groundingOf(bf);
  assert.equal(g.grounded, g.total);
  for (const s of [...r.sentences, ...bf.sentences]) assert.doesNotMatch(s.text, /^(但|不過|然而|此外|因此|所以|此時|這時|其中)/);
});

// ───────── #102 低相關判斷 ─────────
test('#102：答案切題（同一疾病、同一面向）時不標「相關程度較低」；查無門檻不變', () => {
  const E = engine();
  for (const q of ['咳嗽三週了會不會是肺結核，要去哪裡看', '肺結核看病要錢嗎', '被流浪貓抓傷要打狂犬病疫苗嗎']) {
    const r = E.answer(q, { lang: 'zh-TW' });
    assert.equal(r.refused, false, q);
    assert.equal(isLowRelevance(r), false, `${q}：${r.relevance}`);
    assert.ok(r.topicMatch, q);
    assert.deepEqual(judge({ q, expect: { lowRelevance: false } }, r).filter((x) => x.includes('相關程度')), []);
  }
  assert.equal(isLowRelevance({ relevance: 0.5 }), true);
  assert.equal(isLowRelevance({ relevance: 0.5, topicMatch: 'faq' }), false);
  for (const q of ['量子電腦的散熱設計怎麼做', '抗蛇毒血清的價格是多少錢一支，可以網購嗎']) {
    const r = E.answer(q, { lang: 'zh-TW' });
    if (!r.refused) assert.ok(!r.topicMatch || r.relevance >= 0.6, q);
  }
  assert.equal(E.answer('量子電腦的散熱設計怎麼做', { lang: 'zh-TW' }).refused, true);
});

// ───────── #101 外語 ─────────
test('#101：外語問句主題已確認（詞彙主檔各語名稱、跨語言錨點）⇒ 以中文原文回答並附 translationSource，不判查無', () => {
  const E = engine();
  for (const [q, lang, want] of [
    ['Apa gejala demam berdarah?', 'id', 'dengue'],
    ['Apa gejala dan cara mencegah demam berdarah?', 'id', 'dengue'],
    ['อาการไข้เลือดออกมีอะไรบ้าง', 'th', 'dengue'],
    ['Nakagat ako ng aso, ano ang dapat kong gawin?', 'tl', 'rabies'],
  ]) {
    const r = E.answer(q, { lang });
    assert.equal(r.refused, false, q);
    assert.equal(r.translationNote, 'showing-source', q);
    assert.ok(cites(r).some((c) => c.includes(want)), `${q}：${cites(r).join()}`);
  }
});

test('#101：拉丁多字名稱的短稱（尾字本身是同一對象的別名才去掉）', () => {
  const pairs = [['Demam berdarah dengue', 'd'], ['Dengue', 'd'], ['Sốt xuất huyết Dengue', 'd'], ['Japanese encephalitis vaccine', 'v']];
  const out = Object.fromEntries(latinStems(pairs, new Set()));
  assert.equal(out['demam berdarah'], 'd');
  assert.equal(out['sốt xuất huyết'], 'd');
  assert.ok(!('japanese encephalitis' in out), '尾字 vaccine 不是同一對象的名稱，不去掉');
  // 兩個對象推出同一短稱 ⇒ 都不加
  const amb = latinStems([['Foo bar baz', 'x'], ['Baz', 'x'], ['Foo bar qux', 'y'], ['Qux', 'y']], new Set());
  assert.deepEqual(amb, []);
});

// ───────── 拒答文案依語言拆檔 ─────────
test('拒答文案拆檔：原始碼 REFUSAL_TEXT 七語齊全；建置產出每語一檔、dist 的 refusal-i18n.js 為空物件；registerRefusalText 不覆寫已有語言', () => {
  for (const l of ['ja', 'tl', 'vi', 'id', 'th']) assert.equal(REFUSAL_TEXT[l], REFUSAL_TEXT_I18N[l]);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r48-'));
  fs.mkdirSync(path.join(dir, 'assets/js/answer'), { recursive: true });
  const sizes = emitRefusalBundles(dir);
  assert.deepEqual(Object.keys(sizes).sort(), ['id', 'ja', 'th', 'tl', 'vi']);
  assert.match(fs.readFileSync(path.join(dir, 'assets/js/answer/refusal-i18n.js'), 'utf8'), /export const REFUSAL_TEXT_I18N = \{\};/);
  const th = fs.readFileSync(path.join(dir, 'assets/js/answer/refusal-i18n.th.js'), 'utf8');
  assert.equal(JSON.parse(th.replace(/^\/\/.*\n/, '').replace(/^export default /, '').replace(/;\s*$/, ''))['no-match'].title, REFUSAL_TEXT_I18N.th['no-match'].title);
  const before = refusalCopy('no-match', 'th').title;
  registerRefusalText('th', { 'no-match': { title: 'X', text: 'Y' } });
  assert.equal(refusalCopy('no-match', 'th').title, before);
  fs.rmSync(dir, { recursive: true, force: true });
});
