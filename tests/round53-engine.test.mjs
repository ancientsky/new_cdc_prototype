// 第五十三輪（2026-10-14）：依挑戰集 dev 失敗類型修答案引擎（docs/eval-challenge.md §12）；另驗屈公病、日本腦炎兩頁
// 依 Yulun 2026-10-14 決定「假設權責組室已重新審過」後回到 AI 白名單與答案索引。
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
import { INTENT_RULES, REFUSAL_RULES } from '../src/client/answer/rules.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REREVIEWED = ['disease.chikungunya', 'disease.japanese-encephalitis'];

function governed(today) {
  const s = loadSite(config);
  s.today = today;
  applyGovernance(s);
  s.searchIndex = buildSearchIndex(s);
  applyConsistency(s);
  return s;
}
let SITE = null;
const site = () => (SITE ??= governed('2026-10-14'));
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
const guard = (r, kind) => (r.guards ?? []).find((g) => g.kind === kind);

test('測試題不是挑戰集或評估集原題（行為測試用同類的其他問法）', () => {
  const ch = JSON.parse(fs.readFileSync(path.join(ROOT, 'content/governance/eval-challenge.json'), 'utf8'));
  const ev = JSON.parse(fs.readFileSync(path.join(ROOT, 'content/governance/eval-set.json'), 'utf8'));
  const taken = new Set([...ch.questions, ...(ch.promoted ?? []), ...ev.questions].map((x) => x.q));
  // 本檔所有單引號字串裡有中日泰越文字或問號的（問句可能寫在 ask() 裡，也可能寫在逐題的陣列裡）
  const mine = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').match(/'[^'\n]+'/g).map((s) => s.slice(1, -1)).filter((s) => /[\u3400-\u9fff\u0e00-\u0e7f?]|[ăâđêôơư]/i.test(s));
  assert.ok(mine.length >= 30, String(mine.length));
  for (const q of mine) assert.ok(!taken.has(q), `測試題與題庫重複：${q}`);
});

// ───────── 〇、屈公病、日本腦炎：假設重審後回到白名單（Yulun 2026-10-14 決定） ─────────
test('屈公病、日本腦炎頁：審閱日 2026-10-14，BUILD_TODAY=2026-10-01 與 2026-10-14 都在 AI 白名單、不逾期', () => {
  for (const today of ['2026-10-01', '2026-10-14']) {
    const s = governed(today);
    for (const id of REREVIEWED) {
      const item = s.byId.get(id);
      assert.equal(item.reviewedAt, '2026-10-14', id);
      assert.equal(item.gov.overdue, false, `${id} @ ${today}`);
      assert.equal(item.gov.nextReviewAt, '2027-10-14', id);
      assert.equal(item.gov.whitelist.effective, true, `${id} @ ${today}：${item.gov.whitelist.reasons.join('、')}`);
      assert.equal(item.gov.whitelist.public, true, id);
      const chunks = s.searchIndex.public.filter((c) => c.contentId === id);
      assert.ok(chunks.length >= 5, `${id} 進了答案索引（${chunks.length} 段）`);
      // 機器翻譯不進答案索引：只有中文正本的段落
      assert.deepEqual([...new Set(chunks.map((c) => c.lang ?? 'zh-TW'))], ['zh-TW'], id);
      // 機器翻譯草稿（en、vi、id…）也不在頁面上呈現：可呈現的語言只有中文正本
      assert.ok(Object.values(item.languages).some((l) => l.status === 'machine'), `${id} 有機器翻譯草稿（測試前提）`);
      assert.deepEqual(item.gov.renderableLangs, ['zh-TW'], id);
    }
    // 這次只重審這兩頁：tb-cough-two-weeks、mpox-who-vaccine 不動（第五十四輪 Yulun 另決定那兩則也視為已審，日期是 2026-10-15，tests/round54-decisions.test.mjs）
    for (const id of ['faq.tb-cough-two-weeks', 'faq.mpox-who-vaccine']) assert.notEqual(s.byId.get(id).reviewedAt, '2026-10-14', id);
  }
});

test('屈公病、日本腦炎回到索引後，引擎拿得到這兩頁', async () => {
  assert.ok(cites(await ask('得了屈公病關節會痛多久')).some((id) => id.startsWith('disease.chikungunya#')));
  assert.ok(cites(await ask('日本腦炎是怎麼傳染的')).some((id) => id.startsWith('disease.japanese-encephalitis#')));
});

// ───────── 一、病名錯一個字（近似字） ─────────
test('病名／疫苗名錯一個中間字：照正名回答，並附「你輸入的是…」說明', async () => {
  for (const [q, from, to] of [
    ['流行性腮線炎要打疫苗嗎', '流行性腮線炎', '流行性腮腺炎'],
    ['日本腦焱疫苗', '日本腦焱疫苗', '日本腦炎疫苗'],
    ['侵襲性肺炎練球菌感染症', '侵襲性肺炎練球菌感染症', '侵襲性肺炎鏈球菌感染症'],
  ]) {
    const r = await ask(q);
    assert.ok(!r.refused, q);
    assert.deepEqual(guard(r, 'near-miss')?.fixes, [{ from, to }], q);
    assert.ok(r.termNotes.some((n) => n.kind === 'typo' && n.from === from && n.to === to), q);
    assert.equal(r.query, q, '問句本身照原樣保留');
  }
  const mumps = await ask('流行性腮線炎要打疫苗嗎');
  assert.ok(first(mumps).startsWith('vaccine.mmr'), first(mumps));
});

test('「被X咬」的同音錯字（苟、枸→狗）：認得是咬傷問題', async () => {
  for (const q of ['被苟咬了怎麼辦', '被枸咬傷要打針嗎']) {
    const r = await ask(q);
    assert.ok(guard(r, 'near-miss'), q);
    assert.ok(cites(r).some((id) => id.startsWith('faq.rabies-bite')), `${q} → ${cites(r).join(',')}`);
  }
});

test('近似字修正的界線：兩個字不同、首尾字不同、真的字（咬舌頭）、站內自己用到的字串都不改', async () => {
  for (const q of ['流行姓腮線炎', '咬到舌頭怎麼辦', '舌頭被咬破要擦藥嗎', '被喉嚨卡到魚刺', '自費流感疫苗多少錢', '日本腦炎疫情', '人類免疫缺乏病毒傳染防治條例', '肉毒桿菌抗毒素']) {
    const r = await ask(q);
    assert.equal(guard(r, 'near-miss'), undefined, q);
    // 第六十五輪：兩個同音字都錯（流行姓腮線炎）改由讀音容錯處理（route-phonetic.js，tests/round65-ask-weakspots.test.mjs），不是近似字修正
    if (!guard(r, 'phonetic')) assert.ok(!(r.termNotes ?? []).some((n) => n.kind === 'typo'), q);
  }
  // 只在中文提問時做
  const en = await ask('mumps vacine', 'en');
  assert.equal(guard(en, 'near-miss'), undefined);
});

// ───────── 二、問名詞的意思 ─────────
test('問名詞的意思：由「什麼是 X」那則單元回答，不由剛好提到 X 的新聞或專題開頭', async () => {
  const r = await ask('抗藥性結核病是什麼');
  assert.equal(first(r), 'faq.mdr-tb#a');
  const d = await ask('流感併發重症是指什麼');
  assert.equal(first(d), 'faq.influenza-severe-what#a');
});

test('問名詞的意思但另有面向（症狀、治療）：不套定義單元', async () => {
  const r = await ask('登革熱的症狀是什麼');
  assert.ok(!first(r).startsWith('faq.'), first(r));
  assert.ok(cites(r).some((id) => id === 'disease.dengue#symptoms'));
});

// ───────── 三、兩支疫苗的間隔或同時接種 ─────────
test('兩支疫苗隔多久／同一天打：由講這兩支疫苗的單元回答，開頭不插疫情態勢', async () => {
  for (const q of ['流感疫苗跟新冠疫苗要隔幾天', '流感和新冠疫苗要分開打嗎']) {
    const r = await ask(q);
    assert.equal(first(r), 'faq.flu-covid-same-day#a', q);
    assert.ok(!cites(r)[0].startsWith('situation#'), q);
  }
});

// ───────── 四、接觸者 ─────────
test('「接觸到 X 病的人」：由該病的接觸者單元回答', async () => {
  const r = await ask('接觸到麻疹的人要注意什麼');
  assert.equal(first(r), 'faq.measles-exposed-what-to-do#a');
  const tb = await ask('我跟結核病人有接觸怎麼辦');
  assert.equal(first(tb), 'faq.tb-contact-screening#a');
});

test('問通報（專業問題）時不走接觸者單元', async () => {
  const r = await ask('結核病接觸者要通報嗎');
  assert.ok(!cites(r).includes('faq.tb-contact-screening#a'), cites(r).join(','));
});

// ───────── 五、處方代號（3HP、1HP、IGRA…） ─────────
test('問句裡的英數代號：只留寫到該代號的段落', async () => {
  const r = await ask('1HP要吃幾天');
  assert.ok(guard(r, 'code-focus'));
  assert.match(r.sentences[0].text, /1HP/);
  // 以單元為單位：引用的每個單元都寫到 3HP（剛好講到「副作用」「都治」但沒寫 3HP 的新聞、FAQ 不留）
  const side = await ask('3HP會有副作用嗎');
  assert.ok(guard(side, 'code-focus'));
  const unitText = (id) => site().searchIndex.public.filter((c) => c.contentId === id).map((c) => `${c.title} ${c.text}`).join(' ');
  for (const id of new Set(side.sources.map((s) => s.contentId ?? s.id))) assert.match(unitText(id), /3HP/, id);
});

// ───────── 六、旅遊門診與回國 ─────────
test('出國前「看什麼門診／掛哪一科」：由旅遊醫學門診的單元回答，不被旅遊內容裡提到的麻疹蓋過', async () => {
  for (const q of ['出國以前要掛哪一科', '出國之前要先去哪裡看診']) {
    const r = await ask(q);
    assert.match(first(r), /^(faq\.travel-clinic|service\.travel-clinic-appointment)#/, `${q} → ${cites(r).join(',')}`);
  }
  // 問句沒有可對到的門診名稱：不套這個問句型態
  const r = await ask('咳了一個月要看哪一科');
  assert.ok(!cites(r).some((id) => id.includes('travel-clinic')), cites(r).join(','));
});

test('「從國外／東南亞回來」＝回國：答回國後注意事項；「從醫院回來」不算', async () => {
  const r = await ask('從國外回來發燒怎麼辦');
  assert.ok(cites(r).includes('faq.travel-return-fever#a'), cites(r).join(','));
  const h = await ask('從醫院回來要洗手嗎');
  assert.ok(!cites(h).some((id) => /travel|imported-return/.test(id)), cites(h).join(','));
});

// ───────── 七、外語問句 ─────────
test('外語問句同語言只有「澄清」類段落（不是在問謠言）：改用中文正本回答', async () => {
  for (const [q, lang] of [['Kapan vaksin flu gratis mulai?', 'id'], ['วัคซีนไข้หวัดใหญ่ฟรีเริ่มเมื่อไหร่', 'th']]) {
    const r = await ask(q, lang);
    assert.ok(guard(r, 'same-lang-clarification-only'), q);
    assert.ok(!r.refused, q);
    assert.ok(cites(r).every((id) => !id.includes('@')), cites(r).join(','));
  }
});

test('主題錨點：沒命中但第一段就是問句點名的疾病 ⇒ 保留（topic-anchor-partial）；「來臺」這類嚴格錨點照舊要命中', async () => {
  const part = await ask('Can migrant workers get a free flu vaccine?', 'en');
  assert.ok(guard(part, 'topic-anchor-partial'));
  assert.ok(first(part).startsWith('vaccine.influenza'), first(part));
  const strict = await ask('I am visiting Taiwan, do I need a measles vaccine?', 'en');
  assert.equal(guard(strict, 'topic-anchor-partial'), undefined);
  assert.ok(guard(strict, 'topic-anchor-miss'));
  assert.ok(!cites(strict).some((id) => id.startsWith('vaccine.')), cites(strict).join(','));
});

// ───────── 八、規則表瘦身 ─────────
test('意圖／拒答規則表不帶 note 欄位（說明寫在原始碼註解，不進前端包）', () => {
  for (const r of [...INTENT_RULES, ...REFUSAL_RULES]) assert.ok(!('note' in r), r.id ?? String(r.re));
});
