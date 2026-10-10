// 第二十五輪（Issue #25）：答案引擎「查無」相關度門檻。
// 站內沒有的主題要說 no-match，不能拿同字根的不相關片段充數；真正有內容的問題不能被誤擋。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../site.config.mjs';
import { loadSite } from '../scripts/lib/load.mjs';
import { applyGovernance } from '../scripts/lib/governance.mjs';
import { buildSearchIndex } from '../scripts/lib/index-builder.mjs';
import { engineFromSite } from '../eval/run-eval.mjs';
import { RELEVANCE, isLowRelevance } from '../src/client/answer/core.js';

let SITE = null;
function engine() {
  if (!SITE) { SITE = loadSite(config); SITE.today = '2026-10-01'; applyGovernance(SITE); SITE.searchIndex = buildSearchIndex(SITE); }
  return engineFromSite(SITE);
}

test('站內沒有的主題：no-match，不產生句子、不引用來源', () => {
  const e = engine();
  for (const q of ['被虎頭蜂螫傷怎麼辦', '量子電腦是什麼', '採購 透析膜', '股票怎麼買', '被水母螫傷怎麼辦', 'xyzzy foo']) { // 第二十八輪：抗蛇毒血清已有內容，改測其他咬螫傷
    const r = e.answer(q);
    assert.equal(r.refused, true, q);
    assert.equal(r.refusal.kind, 'no-match', q);
    assert.equal(r.refusal.title, '站內查無直接答案');
    assert.equal(r.sentences.length, 0, q);
    assert.equal(r.sources.length, 0, q);
    assert.ok(r.refusal.actions.some((a) => a.href === 'tel:1922'), `${q} 應有 1922`);
    assert.ok(r.refusal.actions.some((a) => a.kind === 'link'), `${q} 應有站內連結`);
  }
});

test('一般查無（無關主題）的行動：1922、傳染病索引、網站導覽', () => {
  const r = engine().answer('量子電腦是什麼');
  const hrefs = r.refusal.actions.map((a) => a.href);
  for (const h of ['tel:1922', '/diseases/', '/sitemap-page/']) assert.ok(hrefs.includes(h), h);
});

test('採購意圖：沒有任何標案提到主題詞 ⇒ no-match；一般「有哪些標案」仍列出', () => {
  const e = engine();
  const miss = e.answer('採購 透析膜');
  assert.equal(miss.intent, 'procurement');
  assert.equal(miss.refusal?.kind, 'no-match');
  assert.ok(miss.refusal.actions.some((a) => a.href === '/procurement/'));
  assert.ok(!miss.procurement, '不列不相關標案');
  const ok = e.answer('疾管署最近有哪些採購標案？截止日是什麼時候？');
  assert.equal(ok.refused, false);
  assert.ok(ok.procurement?.items.length);
});

test('真實問題不被誤擋，且帶有 relevance', () => {
  const e = engine();
  for (const q of ['登革熱 症狀', '狂犬病疫苗哪裡打', '流感疫苗誰可以打公費', 'MMR 成人']) {
    const r = e.answer(q);
    assert.equal(r.refused, false, q);
    assert.ok(r.sentences.length > 0, q);
    assert.ok(r.relevance >= RELEVANCE.lowBelow && r.relevance <= 1, `${q} relevance=${r.relevance}`);
  }
  const stats = e.answer('近五年登革熱本土病例');
  assert.equal(stats.refused, false);
  assert.equal(stats.stats ? true : stats.sentences.length > 0, true);
});

test('relevance 為 0–1 的數字；低相關度判斷只看門檻', () => {
  const r = engine().answer('抗蛇毒血清');
  assert.ok(typeof r.relevance === 'number' && r.relevance >= 0 && r.relevance <= 1);
  assert.equal(isLowRelevance({ relevance: RELEVANCE.lowBelow - 0.01 }), true);
  assert.equal(isLowRelevance({ relevance: RELEVANCE.lowBelow }), false);
  assert.equal(isLowRelevance({ relevance: null }), false);
});

test('評估集有 nomatch 類別，且全部期望 no-match', async () => {
  const qs = (SITE ?? (engine(), SITE)).governance.evalSet.questions.filter((x) => x.category === 'nomatch');
  assert.ok(qs.length >= 5);
  for (const x of qs) { assert.equal(x.expect.refuse, true); assert.equal(x.expect.refusalKind, 'no-match'); }
});
