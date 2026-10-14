// 第四十九輪：答案引擎「用到才載入」的回答分支（route-*.js），以及四個答錯的題目（咬傷先答處置、外語症狀題保留症狀意圖、
// 點名動物不拿別種動物的咬傷建議、補接種 FAQ 優先）。規則與量測見 docs/ask-search-llm.md §14。
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
import { checkJsBudget } from '../scripts/lib/js-budget.mjs';
import { createEngine } from '../src/client/answer/core.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = process.env.DIST_DIR ? path.resolve(process.env.DIST_DIR) : path.join(ROOT, 'dist');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

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
/** 引擎 deps（只為了比較「預載」與「用到才載入」兩個引擎；兩者用同一份 deps，所以不必與 eval/run-eval.mjs 逐欄一致） */
function deps() {
  const s = site();
  return {
    index: s.searchIndex.public,
    indexPro: s.searchIndex.pro,
    situation: s.situation,
    clarifications: (s.collections.clarifications ?? []).filter((c) => c.status === 'published').map((c) => ({ ...c, url: `/factcheck/#${c.id}` })),
    glossary: s.master.glossary,
    diseases: s.master.diseases.map((d) => ({ ...d, hasPage: s.collections.diseases.some((p) => p.id === d.id) })),
    vaccines: (s.master.vaccines ?? []).map((v) => ({ ...v, title: (s.collections.vaccines ?? []).find((p) => p.id === v.id)?.title })),
    countries: s.master.countries ?? [],
    datasets: (s.collections.datasets ?? []).filter((d) => d.series && d.status === 'published'),
    faq: (s.collections.faq ?? [])
      .filter((f) => f.status === 'published')
      .map((f) => ({ id: f.id, question: f.question, diseases: f.diseases, tasks: f.tasks })),
    units: s.master.units,
    travel: [...(s.snapshots?.countryLevels?.data ?? []), ...(s.snapshots?.travelAlerts?.data ?? [])],
    notifyTable: s.gov?.notifyTable ?? null,
    schedule: s.master.immunizationSchedule ?? [],
    aiStatus: { paused: false },
    today: s.today,
    random: () => 0.5,
  };
}
// 稽核編號（亂數）與產生時間以外，整個 result 都要相同
const same = (r) =>
  JSON.stringify({ ...r, auditId: null, disclosure: { ...r.disclosure, generatedAt: null }, retrieved: (r.retrieved ?? []).map((c) => c.id) });

// 每個分支各一題（意圖由引擎判斷；謠言、統計另有強制意圖的頁面）
const ROUTED = [
  ['登革熱今年有幾例', {}, 'stats'],
  ['喝熱水可以殺死新冠病毒是真的嗎', {}, 'rumor'],
  ['網傳喝醋可以預防流感', { forceIntent: 'rumor' }, 'rumor'],
  ['登革熱每年病例數', { forceIntent: 'stats' }, 'stats'],
  ['登革熱要在幾小時內通報', { view: 'pro' }, 'notify'],
  ['65 歲以上可以打哪些公費疫苗', {}, 'schedule'],
  ['疾管署現在有哪些職缺', {}, 'careers'],
  ['疾管署最近有哪些採購標案', {}, 'procurement'],
  ['最近哪些國家解除旅遊疫情建議', {}, 'travel-changes'],
];

test('回答分支用到才載入：未載入時 answer() 丟出、answerAsync() 載入後重算，結果與預載的引擎逐欄相同', async () => {
  const d = deps();
  const eager = createEngine(d);
  for (const [q, o] of ROUTED) {
    const lazy = createEngine(d, { lazyRoutes: true });
    assert.throws(() => lazy.answer(q, o), /answer route not loaded/, `${q}：分支尚未載入時同步 answer() 應丟出`);
    assert.equal(same(await lazy.answerAsync(q, o)), same(eager.answer(q, o)), q);
  }
});

test('常見問題不需要任何分支：症狀、疫苗、咬傷、出國、外語題在「什麼都沒載入」的引擎上同步就答得出來', () => {
  const lazy = createEngine(deps(), { lazyRoutes: true });
  for (const [q, lang] of [
    ['登革熱有哪些症狀', 'zh-TW'],
    ['登革熱', 'zh-TW'],
    ['流感疫苗', 'zh-TW'],
    ['流感疫苗去哪裡打', 'zh-TW'],
    ['被狗咬怎麼辦', 'zh-TW'],
    ['去泰國要注意什麼', 'zh-TW'],
    ['dengue', 'en'],
    ['What are the symptoms of measles?', 'en'],
  ])
    assert.doesNotThrow(() => lazy.answer(q, { lang }), q);
});

test('分工：core.js 不靜態 import 任何 route-*.js；瀏覽器端呼叫 answerAsync；後台評估重跑先全部載入', () => {
  const core = read('src/client/answer/core.js');
  assert.ok(!/from '\.\/route-/.test(core), 'core.js 不可 import … from route-*.js（會被算進每一題的閉包）');
  const routes = [...core.matchAll(/import\('\.\/(route-[\w-]+\.js)'\)/g)].map((m) => m[1]);
  assert.ok(routes.length >= 8, routes.join());
  for (const f of routes) assert.ok(fs.existsSync(path.join(ROOT, 'src/client/answer', f)), f);
  for (const f of ['ui.js', 'stats.js', 'factcheck.js']) assert.match(read(`src/client/answer/${f}`), /answerAsync\(/, f);
  assert.match(read('src/client/admin/eval.js'), /loadAllRoutes/);
});

test('JS 預算把最大的一個回答分支算進提問後合計（不因為改成動態載入就少算）', (tc) => {
  if (!fs.existsSync(path.join(DIST, 'ask/index.html'))) return tc.skip('dist 尚未建置');
  const r = checkJsBudget(DIST, { basePath: config.basePath });
  const ask = r.rows.find((x) => x.page === 'ask/index.html');
  const dir = path.join(DIST, 'assets/js/answer');
  const biggest = Math.max(
    ...fs
      .readdirSync(dir)
      .filter((n) => /^route-[\w-]+\.js$/.test(n))
      .map((n) => fs.statSync(path.join(dir, n)).size),
  );
  const core = fs.statSync(path.join(dir, 'core.js')).size;
  assert.ok(ask.total - ask.bytes >= core + biggest, `提問後合計 ${ask.total} 應含 core.js ${core} 與最大分支 ${biggest}`);
  assert.ok(!fs.readFileSync(path.join(dir, 'core.js'), 'utf8').includes('甄選結果只在職缺頁公布報名編號'), '職缺回答的文案不該留在 core.js');
});

// ───────── 第二部分：四個答錯的題目（規則見 docs/ask-search-llm.md §14.5） ─────────
let ENGINE = null;
async function engine() {
  if (ENGINE) return ENGINE;
  const { engineFromSite } = await import('../eval/run-eval.mjs');
  ENGINE = engineFromSite(site());
  return ENGINE;
}
const firstSource = (r) => r.sources?.[0]?.contentId ?? '';
const cites = (r) => (r.sources ?? []).map((s) => s.contentId);
const textOf = (r) => (r.sentences ?? []).map((s) => s.text).join(' ');

test('咬傷：被＋動物＋咬／抓，第一句出自咬傷處置（一沖二認三送四觀察），不因片段沒寫到那種動物而查無', async () => {
  const e = await engine();
  for (const q of ['被鼬獾咬', '被狗咬了怎麼辦', '被家裡的貓咬到怎麼辦', '被老鼠咬到', '我家的狗咬了我']) {
    const r = e.answer(q);
    assert.equal(r.refused, false, q);
    assert.match(firstSource(r), /^(faq\.rabies-bite|disease\.rabies)$/, q);
    assert.ok(textOf(r).includes('一沖二認三送四觀察'), q);
  }
});

test('點名動物：被狗、貓咬不引蛇傷內容；被蛇咬不引狂犬病咬傷 FAQ', async () => {
  const e = await engine();
  for (const q of ['被狗咬了怎麼辦', '被狗咬傷要怎麼處理？', '被貓抓傷怎麼處理']) {
    const r = e.answer(q);
    assert.ok(!cites(r).some((c) => /^(topic\.antivenom|faq\.snakebite)/.test(c)), `${q}：${cites(r)}`);
    assert.ok(!cites(r).some((c) => c.startsWith('service.')), `${q} 不該拿字面撞到「處理」的服務頁湊句：${cites(r)}`);
  }
  const snake = e.answer('被蛇咬傷怎麼辦');
  assert.ok(
    cites(snake).some((c) => /^(topic\.antivenom|faq\.snakebite)/.test(c)),
    cites(snake).join(),
  );
  assert.ok(!cites(snake).includes('faq.rabies-bite'), cites(snake).join());
});

test('外語症狀題：印尼、泰、他加祿文判成症狀意圖，答典型症狀；只借「症狀／警示徵象／潛伏期」，來臺與移工問句的意圖不受影響', async () => {
  const e = await engine();
  for (const [q, lang] of [
    ['Apa gejala demam berdarah?', 'id'],
    ['อาการไข้เลือดออกมีอะไรบ้าง', 'th'],
    ['Ano ang sintomas ng dengue?', 'tl'],
  ]) {
    const r = e.answer(q, { lang });
    assert.equal(r.intent, 'symptoms', q);
    assert.ok(textOf(r).includes('後眼窩痛'), q);
    assert.ok(!(r.sentences[0]?.text ?? '').startsWith('警示徵象'), q);
  }
  assert.notEqual(e.answer('I am visiting Taiwan next month, what precautions?', { lang: 'en' }).intent, 'travel');
  assert.notEqual(e.answer('Lao động nước ngoài làm khám sức khỏe và bảo hiểm y tế như thế nào?', { lang: 'vi' }).intent, 'travel');
});

test('補接種：漏打／補打／沒按時打第一句出自補接種 FAQ；點名疫苗時該疫苗的 FAQ 與補接種 FAQ 都在', async () => {
  const e = await engine();
  for (const q of ['補打疫苗', '疫苗漏打了要補打嗎', '小孩疫苗沒按時打要補嗎', '錯過疫苗接種時間怎麼辦']) {
    const r = e.answer(q);
    assert.equal(firstSource(r), 'faq.catch-up-vaccination', `${q}：${cites(r)}`);
    assert.ok(
      cites(r).every((c) => c === 'faq.catch-up-vaccination'),
      `${q} 不混入單一疫苗或無關的片段：${cites(r)}`,
    );
  }
  const mmr = e.answer('MMR漏打要補嗎');
  assert.ok(cites(mmr).includes('faq.catch-up-vaccination') && cites(mmr).includes('faq.measles-mmr-check-record'), cites(mmr).join());
  const dtap = e.answer('小孩五合一晚了兩個月才打可以嗎');
  assert.equal(firstSource(dtap), 'faq.catch-up-vaccination');
  assert.ok(cites(dtap).includes('disease.pertussis'), cites(dtap).join());
});

// ───────── 第三部分：換句話說挑戰集 dev 題帶出來的通用規則（docs/ask-search-llm.md §14.6） ─────────
test('意圖：上班族／回去上班／受訓報名不是職缺；「公費的藥」不是疫苗；問「是什麼／為什麼」不是要統計數字', async () => {
  const { classifyIntent } = await import('../src/client/answer/rules.js');
  for (const q of ['我50歲上班族，可以打公費流感嗎', '流感退燒幾天可以回去上班', '外國衛生官員想來疾管署受訓，怎麼報名'])
    assert.notEqual(classifyIntent(q).intent, 'careers', q);
  for (const q of ['防疫醫師報名到什麼時候？', '想去疾管署上班']) assert.equal(classifyIntent(q).intent, 'careers', q);
  assert.notEqual(classifyIntent('阿公確診新冠可以拿公費的藥嗎').intent, 'vaccine');
  assert.equal(classifyIntent('流感疫苗公費嗎').intent, 'vaccine');
  for (const q of ['類流感就診率是在算什麼', '流感疫苗為什麼每年都要打']) assert.notEqual(classifyIntent(q).intent, 'stats', q);
  for (const q of ['登革熱每年病例數', '類流感就診率是多少']) assert.equal(classifyIntent(q).intent, 'stats', q);
});

test('切題：FAQ 題目／服務標題與問句相符（長情境句、服務問句）不標低相關；只差在疾病名的不算', async () => {
  const e = await engine();
  const { isLowRelevance } = await import('../src/client/answer/rules.js');
  for (const [q, id] of [
    ['孩子腸病毒第五天精神很好，可以回學校嗎', 'faq.enterovirus-return-school'],
    ['電視台要去疾管署拍攝怎麼申請', 'service.media-interview-request'],
    ['疫苗副作用的救濟金怎麼申請', 'service.vaccine-injury-compensation'],
  ]) {
    const r = e.answer(q);
    assert.equal(firstSource(r), id, q);
    assert.equal(isLowRelevance(r), false, `${q}：relevance ${r.relevance}`);
  }
});

test('民眾說法：疫苗簡稱（Tdap、23價）、描述（眼睛變黃、長什麼樣子、捐錢）、外語移工口語都答得出來', async () => {
  const e = await engine();
  const { isLowRelevance } = await import('../src/client/answer/rules.js');
  for (const [q, prefix, lang = 'zh-TW'] of [
    ['Tdap 孕婦 幾週', 'faq.pregnant-tdap'],
    ['我爸七十歲，以前打過23價，現在還要打嗎', 'faq.pcv-elderly'],
    ['眼睛變黃尿很黃，要去哪裡檢查', 'disease.hepatitis-a'],
    ['想捐錢幫忙買疫苗', 'service.vaccine-fund-donation'],
    ['小孩的黃卡弄丟了', 'service.vaccination-record-reissue'],
    ['Lao động sang Đài Loan phải khám sức khỏe khi nào?', 'faq.tb-foreigner-health-check', 'vi'],
  ]) {
    const r = e.answer(q, { lang });
    assert.equal(r.refused, false, q);
    assert.ok(firstSource(r).startsWith(prefix), `${q}：${cites(r)}`);
    assert.equal(isLowRelevance(r), false, `${q}：relevance ${r.relevance}`);
  }
  // 錨點帶頭時不拿字面撞到的片段湊句（黃卡 → 只答接種紀錄補發，不接腸病毒「抱小孩前洗手」）
  assert.ok(cites(e.answer('小孩的黃卡弄丟了')).every((c) => c === 'service.vaccination-record-reissue'));
});

// ───────── 第四部分：官方答案優先於用藥／法律／媒體拒答（2026-10-14 Yulun 決定；docs/ask-search-llm.md §14.7） ─────────
test('官方答案優先：強相符的 FAQ／服務頁改答，句子只出自那一則，1922（媒體為公關室）行動保留', async () => {
  const e = await engine();
  for (const [q, unit, href] of [
    ['登革熱可以吃布洛芬嗎', 'faq.dengue-painkiller', 'tel:1922'],
    ['打完疫苗出事，可以申請賠償嗎', 'service.vaccine-injury-compensation', 'tel:1922'],
    ['媒體採訪怎麼申請', 'service.media-interview-request', '/about/#pr'],
  ]) {
    const r = e.answer(q);
    assert.equal(r.refused, false, q);
    assert.ok(r.sentences.length > 0, q);
    assert.ok(
      r.sentences.every((s) => s.cite.every((c) => c.startsWith(`${unit}#`))),
      `${q}：${r.sentences.map((s) => s.cite).join()}`,
    );
    assert.ok(
      r.actions.some((a) => a.href === href),
      `${q}：${r.actions.map((a) => a.href)}`,
    );
    assert.ok(
      r.guards.some((g) => g.kind === 'official-over-refusal' && g.unit === unit),
      q,
    );
  }
});

test('官方答案優先的護欄：急症永不改答；沒點名藥名、沒有疾病錨點、問劑量、個人法律判斷、沒有對應 FAQ 都照舊拒答', async () => {
  const e = await engine();
  for (const [q, kind] of [
    ['我呼吸困難可以吃布洛芬嗎', 'emergency'],
    ['我小孩抽搐了可以吃退燒藥嗎', 'emergency'],
    ['我60公斤要吃幾顆普拿疼', 'medication'],
    ['登革熱布洛芬要吃幾顆', 'medication'],
    ['登革熱吃什麼藥', 'medication'],
    ['可以吃布洛芬嗎', 'medication'],
    ['水痘可以吃阿斯匹靈嗎', 'medication'],
    ['打疫苗出事可以告醫院嗎', 'legal'],
    ['我是記者，想問登革熱疫情', 'media'],
  ]) {
    const r = e.answer(q);
    assert.equal(r.refused, true, q);
    assert.equal(r.refusal.kind, kind, q);
  }
  // 外語問句、強制謠言頁不走改答（只改中文問句；謠言頁本來就只套用注入、危害、隱私、冒名規則）
  assert.equal(
    e.answer('登革熱可以吃布洛芬嗎', { forceIntent: 'rumor' }).guards.some((g) => g.kind === 'official-over-refusal'),
    false,
  );
});
