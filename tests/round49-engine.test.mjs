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
