// 第四十一輪：民眾用語 vs 官方用語。「covid」「做愛」曾整題查無（找不到足夠的官方依據）：
// 拉丁名稱是整字比對，COVID-19 的別名沒有 COVID；站上內容一律寫「性行為」，詞彙主檔沒有橋接口語。
// 修法：詞彙主檔補別名／新詞條（資料），引擎只加一條通則：「≥4 字母-數字」拉丁名的字母詞幹也當別名（有歧義就不加）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../site.config.mjs';
import { loadSite } from '../scripts/lib/load.mjs';
import { applyGovernance } from '../scripts/lib/governance.mjs';
import { buildSearchIndex } from '../scripts/lib/index-builder.mjs';
import { engineFromSite } from '../eval/run-eval.mjs';
import { createEngine } from '../src/client/answer/core.js';
import { latinStems } from '../src/client/answer/lexicon.js';

let SITE = null;
function site() {
  if (!SITE) {
    SITE = loadSite(config);
    SITE.today = '2026-10-11';
    applyGovernance(SITE);
    SITE.searchIndex = buildSearchIndex(SITE);
  }
  return SITE;
}
let ENGINE = null;
const engine = () => (ENGINE ??= engineFromSite(site(), { random: () => 0.5 }));
const ids = (r) => r.sources.map((s) => s.id);

// 合成資料：只放詞幹規則用得到的欄位，確認是引擎通則在作用，而不是詞彙主檔剛好有 COVID 這個別名
const synthetic = (extra = {}) =>
  createEngine({
    diseases: [
      { id: 'disease.covid-19', name: '新冠併發重症', aliases: ['COVID-19', '新冠'] },
      { id: 'disease.avian-flu', name: '新型A型流感', aliases: ['H5N1'] },
      { id: 'disease.ev', name: '腸病毒', aliases: ['EV71'] },
      ...(extra.diseases ?? []),
    ],
    glossary: [
      { id: 'term.covid-19', 'zh-TW': '新冠併發重症', aliases: ['COVID-19', '新冠'], refs: ['disease.covid-19'], domain: 'disease' },
      ...(extra.glossary ?? []),
    ],
    vaccines: extra.vaccines ?? [],
    countries: extra.countries ?? [],
  });

test('latinStems：只認「≥4 字母-數字」；詞幹已是已知名稱或兩個對象搶同一詞幹時不加', () => {
  const known = new Set(['h5n1', 'ev71']);
  assert.deepEqual(
    latinStems(
      [
        ['COVID-19', 'a'],
        ['H5N1', 'b'],
        ['EV71', 'c'],
        ['EV-71', 'c'],
        ['SARS-CoV-2', 'd'],
      ],
      known,
    ),
    [['covid', 'a']],
    'EV-71 字母不到 4 個、SARS-CoV-2 數字後還有連字號，都不套用',
  );
  assert.deepEqual(
    latinStems(
      [
        ['COVID-19', 'a'],
        ['Covid-19', 'a'],
      ],
      new Set(),
    ),
    [['covid', 'a']],
    '同一對象的多個寫法只算一次',
  );
  assert.deepEqual(
    latinStems(
      [
        ['ABCD-1', 'a'],
        ['ABCD-2', 'b'],
      ],
      new Set(),
    ),
    [],
    '兩個不同對象推出同一詞幹：歧義，不加',
  );
  assert.deepEqual(latinStems([['COVID-19', 'a']], new Set(['covid'])), [], '詞幹本來就是已知名稱：不動（同一個＝資料已有；別的＝不能搶）');
});

test('詞幹規則（合成資料）：covid 認得是新冠，且同義詞展開會補上 COVID-19 讓 BM25 找得到片段', () => {
  const e = synthetic();
  for (const q of ['covid', 'Covid', 'COVID 症狀', 'covid怎麼預防']) {
    assert.deepEqual(
      e.detectEntities(q).diseases.map((d) => d.id),
      q === 'covid怎麼預防' ? [] : ['disease.covid-19'],
      q,
    );
  }
  assert.ok(e.expandQuery('covid').added.includes('COVID-19'), `應展開 COVID-19：${e.expandQuery('covid').added}`);
  assert.deepEqual(e.detectEntities('H5').diseases, [], 'H5N1 沒有連字號、字母不到 4 個，不產生詞幹');
  assert.deepEqual(e.detectEntities('EV').diseases, [], 'EV71 不產生詞幹');
});

test('詞幹規則（合成資料）歧義：詞幹已是別的疾病／國家名稱，或兩個疾病共用詞幹時，一律不加', () => {
  const taken = synthetic({ diseases: [{ id: 'disease.other', name: '別的病', aliases: ['COVID'] }] });
  assert.deepEqual(
    taken.detectEntities('covid').diseases.map((d) => d.id),
    ['disease.other'],
    '不能把別的病的名稱搶過來',
  );
  const country = synthetic({ countries: [{ iso2: 'XX', name: '某國', nameEn: 'Covid' }] });
  assert.deepEqual(country.detectEntities('covid').diseases, [], '詞幹是國家名：不加成疾病');
  const twin = synthetic({ diseases: [{ id: 'disease.covid-twin', name: '假想病', aliases: ['COVID-20'] }] });
  assert.deepEqual(twin.detectEntities('covid').diseases, [], 'COVID-19 與 COVID-20 是不同疾病：詞幹 COVID 有歧義，不加');
  assert.ok(!twin.expandQuery('covid').added.includes('COVID-19'));
  assert.deepEqual(
    twin.detectEntities('COVID-19').diseases.map((d) => d.id),
    ['disease.covid-19'],
    '全名照常命中',
  );
});

test('實際站台：covid／Covid／新冠病毒 答出新冠，不再查無', () => {
  for (const q of ['covid', 'Covid', 'COVID', '新冠病毒']) {
    const r = engine().answer(q);
    assert.equal(r.refused, false, q);
    assert.ok(
      ids(r).some((id) => id.startsWith('disease.covid-19')),
      `${q}：${ids(r)}`,
    );
  }
});

test('詞彙主檔 term.sexual-contact：做愛／上床／性交 展開成性行為，答出性行為相關疾病，不拿登革熱或職缺充數', () => {
  const g = site().master.glossary.find((t) => t.id === 'term.sexual-contact');
  assert.equal(g['zh-TW'], '性行為');
  assert.deepEqual(g.refs, [], '統稱不是單一疾病，refs 留空');
  assert.deepEqual([...g.machineTranslated].sort(), ['en', 'id', 'ja', 'th', 'tl', 'vi'], '外語譯名是 Claude 草擬，要標待審');
  const e = engine();
  assert.ok(e.expandQuery('做愛').added.includes('性行為'));
  for (const view of ['public', 'pro']) {
    for (const q of ['做愛', '上床', '性交', '做愛會得什麼病']) {
      const r = e.answer(q, { view });
      assert.equal(r.refused, false, `${view} ${q}`);
      assert.ok(
        ids(r).some((id) => /^(disease\.(hiv|hepatitis-a|mpox|syphilis)|topic\.(sti-resources|prep|anonymous-testing))/.test(id)),
        `${view} ${q}：${ids(r)}`,
      );
      assert.ok(!ids(r).some((id) => /dengue|^job\./.test(id)), `${view} ${q} 不得引用登革熱或職缺：${ids(r)}`);
    }
  }
});

test('詞界：「短暫性交叉免疫」裡的「性交」不算；登革熱片段不被標上性行為術語', () => {
  const idx = [...site().searchIndex.public, ...site().searchIndex.pro];
  const dengue = idx.filter((c) => /交叉免疫/.test(c.text ?? ''));
  assert.ok(dengue.length, '登革熱教材應有「交叉免疫」片段');
  for (const c of dengue) assert.ok(!(c.terms ?? []).includes('性行為'), `${c.id} 不應有性行為術語：${c.terms}`);
  // 反過來：真的在講性行為的片段有帶上口語別名，民眾用口語問可以直接命中
  const hiv = idx.find((c) => c.id === 'disease.hiv#transmission');
  assert.ok((hiv.terms ?? []).includes('做愛'), `${hiv?.id}：${hiv?.terms}`);
});

test('回歸：急性傳染病組這類單位名裡的「性傳染病」仍不展開；安全性行為、口肛性行為、性病照常回答', () => {
  const e = engine();
  assert.ok(!e.expandQuery('急性傳染病組負責什麼').added.includes('性病'));
  const unit = e.answer('急性傳染病組負責什麼');
  assert.ok(!ids(unit).some((id) => /^topic\.(sti-resources|anonymous-testing|prep)/.test(id)), `單位名不得導到性傳染病專區：${ids(unit)}`);
  for (const q of ['安全性行為', '口肛性行為', '性病']) assert.equal(e.answer(q).refused, false, q);
  assert.ok(ids(e.answer('性病')).some((id) => id.startsWith('topic.sti-resources')));
});
