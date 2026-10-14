// 第五十二輪（2026-10-14）：依挑戰集 dev 失敗類型修答案引擎的換句話說能力（docs/eval-challenge.md §10）。
// 這裡的題目都是「同一類說法」的其他問法，不是挑戰集原題（原題留在挑戰集量 dev／holdout）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../site.config.mjs';
import { loadSite } from '../scripts/lib/load.mjs';
import { applyGovernance } from '../scripts/lib/governance.mjs';
import { buildSearchIndex } from '../scripts/lib/index-builder.mjs';
import { applyConsistency } from '../scripts/lib/consistency.mjs';
import { tokenize, foldVariants } from '../src/client/answer/text.js';
import { matcherFor, PARAPHRASE, CLUSTER_DESC_RE } from '../src/client/answer/lexicon.js';
import { facetsOf } from '../src/client/answer/rules.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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
async function engine() {
  if (ENGINE) return ENGINE;
  const { engineFromSite } = await import('../eval/run-eval.mjs');
  ENGINE = engineFromSite(site());
  return ENGINE;
}
const ask = async (q, lang = 'zh-TW') => (await engine()).answer(q, { lang, view: 'public' });
const cites = (r) => (r.sentences ?? []).flatMap((s) => s.cite);
const first = (r) => r.sentences?.[0]?.cite?.[0] ?? '';
const lowRel = (r) => typeof r.relevance === 'number' && r.relevance < 0.6 && !r.topicMatch;

test('測試題不是挑戰集或評估集原題（行為測試用同類的其他問法）', () => {
  const ch = JSON.parse(fs.readFileSync(path.join(ROOT, 'content/governance/eval-challenge.json'), 'utf8'));
  const ev = JSON.parse(fs.readFileSync(path.join(ROOT, 'content/governance/eval-set.json'), 'utf8'));
  const taken = new Set([...ch.questions, ...(ch.promoted ?? []), ...ev.questions].map((x) => x.q));
  const mine = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').match(/ask\('([^']+)'/g).map((s) => s.slice(5, -1));
  assert.ok(mine.length >= 15);
  for (const q of mine) assert.ok(!taken.has(q), `測試題與題庫重複：${q}`);
});

// ───────── 一、字形與問句詞 ─────────
test('異體字摺疊：台／臺、裏／裡在問句與文件兩端一致', () => {
  assert.equal(foldVariants('台灣的醫院裏'), '臺灣的醫院裡');
  assert.deepEqual(tokenize('台灣'), tokenize('臺灣'));
  assert.deepEqual(tokenize('來台工作', { query: true }), tokenize('來臺工作', { query: true }));
});

test('問句端拿掉「什」的疑問詞碎片；「麼處」「去哪」這類能對到 FAQ 題目的照留；文件端不動', () => {
  const q = tokenize('PrEP是什麼', { query: true });
  assert.ok(!q.some((t) => t.includes('什')), q.join(','));
  assert.ok(tokenize('PrEP 是什麼？').includes('是什'), '文件端照舊');
  assert.ok(tokenize('群聚怎麼處理', { query: true }).includes('麼處'));
  assert.ok(tokenize('流感疫苗去哪打', { query: true }).includes('去哪'));
  assert.ok(!tokenize('哪一個比較好', { query: true }).includes('哪一'));
});

test('拉丁名稱與中文相鄰也認得（HIV疫苗、感染covid），拉丁字母／數字邊界照擋（EV ≠ EV71、flu ≠ influenza）', () => {
  assert.ok(matcherFor('HIV').test('HIV疫苗'));
  assert.ok(matcherFor('HIV').test('感染HIV會怎樣'));
  assert.ok(matcherFor('covid').test('covid疫苗'));
  assert.ok(!matcherFor('EV').test('EV71疫苗'));
  assert.ok(!matcherFor('flu').test('influenza'));
  assert.ok(!matcherFor('HIV').test('HIVE'));
});

// ───────── 二、疾病頁面向段落 ─────────
test('面向分類：症狀／傳染／預防／治療／疫苗；沒有面向詞就不分類', () => {
  assert.deepEqual(facetsOf('會不會癢'), ['symptoms']);
  assert.deepEqual(facetsOf('會傳給家人嗎'), ['transmission']);
  assert.deepEqual(facetsOf('有藥醫嗎'), ['treatment']);
  assert.deepEqual(facetsOf('有預防針嗎'), ['vaccine']);
  assert.deepEqual(facetsOf('怎麼防'), ['prevention']);
  assert.deepEqual(facetsOf('最近疫情如何'), []);
});

test('點名疾病＋問治療 ⇒ 先答疾病頁「診斷與治療」段，不先答同病的症狀 FAQ', async () => {
  const r = await ask('麻疹有藥可以治療嗎');
  assert.equal(r.refused, false);
  assert.equal(first(r), 'disease.measles#treatment');
});

test('點名疾病＋問傳染 ⇒ 先答疾病頁「怎麼傳染」段', async () => {
  const r = await ask('登革熱會怎麼傳給別人');
  assert.equal(first(r), 'disease.dengue#transmission');
  const r2 = await ask('水痘會傳給大人嗎');
  assert.ok(cites(r2).includes('disease.varicella#transmission'), cites(r2).join(','));
  assert.equal(lowRel(r2), false);
});

test('點名疾病＋問症狀的口語（會不會癢）⇒ 症狀段', async () => {
  const r = await ask('腸病毒會不會癢');
  assert.equal(first(r), 'disease.enterovirus#symptoms');
});

test('面向加權不越過同病、也講這個面向的 FAQ／疫苗頁：公費流感疫苗對象仍先答 FAQ；點名疫苗時不拿疾病頁疫苗段', async () => {
  const r = await ask('哪些人可以打公費流感疫苗');
  assert.equal(first(r), 'faq.flu-vaccine-who#a');
  const r2 = await ask('成人需要補打MMR嗎');
  assert.ok(!/^disease\./.test(first(r2)), first(r2));
});

test('疾病頁的「疫苗」段（沒有疫苗頁的疾病）：中英混打的病名也答得到', async () => {
  const r = await ask('HIV疫苗打了嗎');
  assert.equal(r.refused, false);
  assert.ok(cites(r).includes('disease.hiv#vaccine'), cites(r).join(','));
});

test('點名疫苗時，同義詞展開的全名（麻疹腮腺炎德國麻疹混合疫苗）比照實體名稱降權：時程句不因寫了全名就蓋過補接種 FAQ', async () => {
  const r = await ask('MMR 漏打了怎麼辦');
  assert.ok(cites(r).includes('faq.catch-up-vaccination#a'), cites(r).join(','));
  assert.ok(first(r).startsWith('faq.'), first(r));
});

// ───────── 三、民眾描述 → 站內用語 ─────────
test('「好幾個人一起發燒／拉肚子」＝疑似群聚 ⇒ 群聚通報（1922）；只說「麻疹群聚」問的是疫情，不走群聚通報', async () => {
  for (const q of ['宿舍好幾個人一起發燒', '班上好幾個同學都在拉肚子']) {
    const r = await ask(q);
    assert.ok(cites(r).some((id) => id.startsWith('service.cluster-report-1922') || id.startsWith('faq.flu-school-cluster')), `${q}：${cites(r).join(',')}`);
    assert.equal(lowRel(r), false, q);
  }
  assert.ok(!CLUSTER_DESC_RE.test('最近麻疹群聚的情況'));
  const r = await ask('最近麻疹群聚的情況');
  assert.ok(!cites(r).some((id) => id.startsWith('service.cluster-report-1922')), cites(r).join(','));
});

test('「體檢／健檢」只在問句端換成健康檢查，抗體檢驗、檢體檢驗、人體檢體不算（詞界）', async () => {
  const rule = PARAPHRASE.find(([, to]) => to === '健康檢查');
  assert.ok(rule);
  for (const s of ['移工要做體檢', '公司健檢']) assert.ok(rule[0].test(s), s);
  for (const s of ['抗體檢驗', '檢體檢驗', '人體檢體']) assert.ok(!rule[0].test(s), s);
  const r = await ask('移工來台要做體檢嗎');
  assert.equal(r.refused, false);
  assert.ok(cites(r).includes('faq.tb-foreigner-health-check#a'), cites(r).join(','));
});

test('沒有自己疾病頁的病名（抗藥性結核）：標在別的疾病、內文明寫這個病名的片段可以用', async () => {
  const r = await ask('抗藥性結核病治療要錢嗎');
  assert.ok(cites(r).includes('faq.tb-treatment-cost#a'), cites(r).join(','));
});

// ───────── 四、路由 ─────────
test('時程表只在沒點名疾病（或問「哪些疫苗」）時走：問年齡＋點名疾病的預防，答疾病頁', async () => {
  const r = await ask('一歲要打哪些疫苗');
  assert.ok(cites(r).includes('master.immunization-schedule'));
  const r2 = await ask('一歲小孩怎麼預防百日咳');
  assert.ok(first(r2).startsWith('disease.pertussis'), first(r2));
  assert.ok(!cites(r2).includes('master.immunization-schedule'));
});

test('謠言問句沒有澄清稿、但有對題 FAQ ⇒ 改答 FAQ（標 rumor-faq-fallback）；有澄清稿的照舊走事實查核', async () => {
  const r = await ask('簡訊叫我點連結登記公費疫苗是真的嗎');
  assert.equal(r.refused, false);
  assert.ok(r.guards.some((g) => g.kind === 'rumor-faq-fallback'));
  assert.ok(first(r).startsWith('faq.'), first(r));
  const r2 = await ask('聽說喝醋可以預防流感是真的嗎');
  assert.ok(!r2.guards.some((g) => g.kind === 'rumor-faq-fallback'));
  assert.ok(cites(r2).some((id) => id.startsWith('clar.')));
});

test('影片第一句的「「片名」為疾管署影片」在沒問影片時不當第一句', async () => {
  const r = await ask('PrEP是什麼東西');
  assert.ok(r.sentences?.length);
  assert.ok(!/^「[^」]+」為疾管署/.test(r.sentences[0].text), r.sentences[0].text);
});

// ───────── 五、外語 ─────────
test('外語「咳嗽兩週」（印尼文、越南文）⇒ 結核病，答案句是中文原文（不放機器翻譯）', async () => {
  for (const [q, lang] of [['Batuk lebih dari dua minggu harus ke dokter?', 'id'], ['ho hai tuần rồi', 'vi']]) {
    const r = await ask(q, lang);
    assert.equal(r.refused, false, q);
    assert.ok(cites(r).some((id) => id.startsWith('disease.tuberculosis')), `${q}：${cites(r).join(',')}`);
    assert.equal(lowRel(r), false, q);
    for (const s of r.sentences) assert.ok(/[一-鿿]/.test(s.text), `應是中文原文：${s.text}`);
  }
});

test('外語同語言池相關度不足 ⇒ 改用中文原文池重答（same-lang-retry-zh），不是拒答', async () => {
  const r = await ask('ไอมาสองสัปดาห์', 'th');
  assert.equal(r.refused, false);
  // 第五十三輪：泰文語料這題只撞到澄清稿，現在更早一步就改用中文原文（same-lang-clarification-only）；兩條路都是「改用中文、不拒答」
  assert.ok(r.guards.some((g) => g.kind === 'same-lang-retry-zh' || g.kind === 'same-lang-clarification-only'));
  assert.ok(cites(r).some((id) => id.startsWith('disease.tuberculosis')));
});
