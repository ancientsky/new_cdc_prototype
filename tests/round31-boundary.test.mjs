// 第三十一輪：詞典邊界。字元 bigram 檢索下，「性病」藏在「急性病毒性A型肝炎」裡、「性傳染病」藏在「慢性傳染病組」裡，
// 問「性病」曾答出 A 型肝炎（Yulun 2026-10-10 回報）。已知名詞只在「別的更長已知名詞」裡出現時不算命中。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../site.config.mjs';
import { loadSite } from '../scripts/lib/load.mjs';
import { applyGovernance } from '../scripts/lib/governance.mjs';
import { buildSearchIndex } from '../scripts/lib/index-builder.mjs';
import { engineFromSite } from '../eval/run-eval.mjs';
import { buildLexicon } from '../src/client/answer/core.js';

let SITE = null;
function site() {
  if (!SITE) {
    SITE = loadSite(config);
    SITE.today = '2026-10-10';
    applyGovernance(SITE);
    SITE.searchIndex = buildSearchIndex(SITE);
  }
  return SITE;
}
const engine = () => engineFromSite(site());

test('buildLexicon：wholeHit 只認「不是躲在別的名詞裡」的出現；同一個東西的長短形式不互相遮蔽；疫苗名不遮疾病', () => {
  const lex = buildLexicon({
    diseases: [
      { id: 'disease.hepatitis-a', name: '急性病毒性A型肝炎', aliases: ['A型肝炎', 'A肝'] },
      { id: 'disease.hiv', name: '人類免疫缺乏病毒感染', aliases: ['愛滋', '愛滋病'] },
      { id: 'disease.covid-19', name: '新冠併發重症', aliases: ['新冠'] },
    ],
    glossary: [
      { id: 'term.sti', 'zh-TW': '性傳染病', aliases: ['性病', 'STI'], domain: 'general', refs: [] },
      { id: 'term.chronic', 'zh-TW': '慢性病', domain: 'general', refs: [] },
    ],
    vaccines: [{ id: 'vaccine.covid-19', name: '新冠疫苗' }],
    units: [
      { id: 'unit.chronic', name: '慢性傳染病組' },
      { id: 'unit.acute', name: '急性傳染病組' },
    ],
  });
  assert.equal(lex.wholeHit('急性病毒性a型肝炎潛伏期', '性病'), false, '性病躲在急性病毒性A型肝炎裡');
  assert.equal(lex.wholeHit('高風險慢性病人', '性病'), false, '性病躲在慢性病裡');
  assert.equal(lex.wholeHit('性病多半可以治療', '性病'), true);
  assert.equal(lex.wholeHit('急性病毒性a型肝炎也是性病', '性病'), true, '另有一次獨立出現就算');
  assert.equal(lex.wholeHit('慢性傳染病組徵求約僱人員', '性傳染病'), false, '性傳染病躲在慢性傳染病組裡');
  assert.equal(lex.wholeHit('愛滋病毒篩檢', '愛滋'), true, '愛滋／愛滋病同一個病，不遮蔽');
  assert.equal(lex.wholeHit('新冠疫苗接種對象', '新冠'), true, '疫苗名不遮它的疾病');
  // 問句斷詞：取最長、不重疊
  assert.deepEqual(
    lex.phrasesIn('急性傳染病組').map((p) => p.name),
    ['急性傳染病組'],
    '取最長：單位名，不是裡面的性傳染病',
  );
  assert.deepEqual(
    lex.phrasesIn('性病症狀').map((p) => p.name),
    ['性病'],
  );
  assert.equal(lex.segment('性病症狀'), '性病 症狀');
  assert.equal(lex.expandable('急性病毒性A型肝炎', '性病'), false);
  assert.equal(lex.expandable('性病怎麼預防', '性病'), true);
  assert.equal(lex.expandable('新冠疫苗', '新冠'), true);
});

test('問「性病」（民眾／專業）：導到性傳染病專區，不再引用 A 型肝炎或慢性傳染病組職缺', () => {
  const e = engine();
  for (const view of ['public', 'pro']) {
    const r = e.answer('性病', { view });
    assert.equal(r.refused, false, `${view} 不應拒答`);
    const ids = r.sources.map((s) => s.id);
    assert.ok(
      ids.some((id) => id.startsWith('topic.sti-resources') || id.startsWith('topic.anonymous-testing')),
      `${view} 應引用性傳染病專區：${ids}`,
    );
    assert.ok(!ids.some((id) => /hepatitis|job\./.test(id)), `${view} 不得引用肝炎或職缺：${ids}`);
    assert.ok(!r.sentences.some((s) => /A型肝炎|慢性病/.test(s.text)), `${view} 句子不得提到 A 型肝炎／慢性病`);
  }
});

test('同義詞展開：性病／STD → 性傳染病；「急性傳染病組」裡的「性傳染病」不展開', () => {
  const e = engine();
  assert.ok(e.expandQuery('性病').added.includes('性傳染病'));
  assert.ok(e.expandQuery('STD').added.includes('性傳染病'));
  assert.ok(!e.expandQuery('急性傳染病組負責什麼').added.includes('性病'));
  assert.ok(e.expandQuery('B型肝炎疫苗').added.length > 0, '疫苗名不遮蔽疾病別名，照常展開');
});

test('索引端：A 型肝炎片段不再被標上「性傳染病／性病」術語；性傳染病專區片段有「性病」別名可直接命中', () => {
  const idx = site().searchIndex.public;
  const hepA = idx.filter((c) => c.contentId === 'disease.hepatitis-a');
  assert.ok(hepA.length);
  for (const c of hepA) assert.ok(!(c.terms ?? []).includes('性病') && !(c.terms ?? []).includes('性傳染病'), `${c.id} 不應有性病術語：${c.terms}`);
  const sti = idx.find((c) => c.contentId === 'topic.sti-resources');
  assert.ok((sti.terms ?? []).includes('性病'), `性傳染病專區應帶別名：${sti.terms}`);
});

test('相關度：「性病症狀」的假 bigram「病症」不算進涵蓋率；「性病有哪些」不再 no-match', () => {
  const e = engine();
  for (const q of ['性病症狀', '性病有哪些']) {
    const r = e.answer(q);
    assert.equal(r.refused, false, `${q}：${r.refusal?.kind} ${JSON.stringify(r.relevanceInfo)}`);
  }
});

test('回歸：A 型肝炎、新冠疫苗、慢性傳染病組職缺本身的問題照常回答', () => {
  const e = engine();
  assert.ok(e.answer('A型肝炎會怎麼傳染').sources.some((s) => s.id.startsWith('disease.hepatitis-a')));
  assert.equal(e.answer('新冠疫苗誰可以打').refused, false);
  assert.ok(e.answer('慢性傳染病組有職缺嗎').sources.some((s) => s.type === 'job'));
});
