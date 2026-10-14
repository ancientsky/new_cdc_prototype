// 第四十九輪：換句話說挑戰集（content/governance/eval-challenge.json）與不擋建置的執行器（eval/run-challenge.mjs）。
// 這裡只檢查題庫格式與「不擋建置」這條規則，不檢查通過率（通過率是要追蹤的數字，不是門檻）。說明見 docs/eval-challenge.md。
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
import { CHALLENGE_PATH, CATEGORIES, SPLITS, loadChallenge, validateChallenge, runChallenge, formatReport, failureKind } from '../eval/run-challenge.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SET = loadChallenge();
const EVAL_SET = JSON.parse(fs.readFileSync(path.join(ROOT, 'content/governance/eval-set.json'), 'utf8'));

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

/** 引用前綴是否對得到站內東西：內容 id 前綴、主檔（master.diseases／master.immunization-schedule）、旅遊國家（travel.JP） */
function knownId(prefix) {
  const s = site();
  if (prefix.startsWith('master.')) {
    const key = prefix.slice(7).replace(/-(\w)/g, (_, c) => c.toUpperCase());
    return s.master[key] != null;
  }
  if (prefix.startsWith('travel.')) return (s.master.countries ?? []).some((c) => String(c.iso2 ?? c.id ?? '').toUpperCase() === prefix.slice(7).toUpperCase());
  return (s.all ?? []).some((it) => it.status === 'published' && it.id.startsWith(prefix));
}

test('挑戰集格式：每題有 id／q／expect／split／category／source，id 不重複，不擋建置（gating=false）', () => {
  assert.ok(CHALLENGE_PATH.endsWith(path.join('content', 'governance', 'eval-challenge.json')) && fs.existsSync(CHALLENGE_PATH));
  assert.equal(SET.gating, false);
  assert.ok(SET.questions.length >= 400, `題數 ${SET.questions.length}`);
  const problems = validateChallenge(SET, { evalQuestions: EVAL_SET.questions });
  assert.deepEqual(problems, []);
  const ids = SET.questions.map((q) => q.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const q of SET.questions) {
    assert.ok(SPLITS.includes(q.split), q.id);
    assert.ok(CATEGORIES.includes(q.category), q.id);
    assert.equal(typeof q.q, 'string', q.id);
    assert.equal(typeof q.expect, 'object', q.id);
  }
});

test('挑戰集不收 eval-set.json 的原題（正規化後比對：忽略空白、標點、大小寫）', () => {
  const norm = (s) => s.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
  const evalQs = new Set(EVAL_SET.questions.map((q) => norm(q.q)));
  const dup = SET.questions.filter((q) => evalQs.has(norm(q.q))).map((q) => q.id);
  assert.deepEqual(dup, []);
  // validateChallenge 也要抓得到：故意塞一題原題
  const probe = { ...SET, questions: [...SET.questions.slice(0, 2), { ...SET.questions[0], id: 'X-DUP', q: EVAL_SET.questions[0].q }] };
  assert.ok(validateChallenge(probe, { evalQuestions: EVAL_SET.questions }).some((p) => p.includes('X-DUP') && p.includes('eval-set')));
});

test('挑戰集引用的每個 id（mustCite／mustCiteAny／mustNotCite）都對得到站內內容', () => {
  const problems = validateChallenge(SET, { knownId });
  assert.deepEqual(problems, []);
  assert.ok(validateChallenge({ ...SET, questions: [{ ...SET.questions[0], expect: { mustCiteAny: ['faq.no-such-faq'] } }] }, { knownId }).length > 0);
});

test('涵蓋：67 則 FAQ、16 個申請服務、16 個疾病頁（症狀／預防／疫苗／就醫）都有題目；五種外語都有', () => {
  const sources = new Set(SET.questions.map((q) => q.source));
  const s = site();
  const published = (type) => s.all.filter((it) => it.type === type && it.status === 'published').map((it) => it.id);
  for (const id of published('faq')) assert.ok(sources.has(id), `缺 FAQ ${id}`);
  for (const id of published('service')) assert.ok(sources.has(id), `缺服務 ${id}`);
  for (const id of published('disease')) for (const a of ['symptoms', 'prevention', 'vaccine', 'care']) assert.ok(sources.has(`${id}#${a}`), `缺 ${id}#${a}`);
  const langs = new Set(SET.questions.map((q) => q.lang ?? 'zh-TW'));
  for (const l of ['en', 'id', 'th', 'tl', 'vi']) assert.ok(langs.has(l), `缺 ${l}`);
});

test('dev／holdout 約各半，且每個來源題（兩題以上）兩邊都有', () => {
  const dev = SET.questions.filter((q) => q.split === 'dev').length;
  const ratio = dev / SET.questions.length;
  assert.ok(ratio > 0.4 && ratio < 0.6, `dev 比例 ${ratio}`);
  const bySource = new Map();
  for (const q of SET.questions) bySource.set(q.source, [...(bySource.get(q.source) ?? []), q.split]);
  // 升格進評估集的題目記在 promoted（docs/eval-challenge.md §3、§8）；dev 題升格後，那個來源可能只剩 holdout，這是預期的。
  const promotedIds = new Set((SET.promoted ?? []).map((p) => p.id));
  const promotedDevSources = new Set((SET.promoted ?? []).filter((p) => p.split === 'dev' && p.source).map((p) => p.source));
  for (const [src, splits] of bySource) {
    if (splits.length < 2) continue;
    const ok = (splits.includes('dev') || promotedDevSources.has(src)) && splits.includes('holdout');
    assert.ok(ok, `${src} 只有 ${splits[0]}`);
  }
  // 升格的題目必須真的離開挑戰集，而且不可以是 holdout（holdout 題不得拿來修引擎，見 §3）
  for (const q of SET.questions) assert.ok(!promotedIds.has(q.id), `${q.id} 已升格卻還在挑戰集`);
});

test('建置不讀挑戰集：build.mjs／scripts／src 不引用 eval-challenge 或 run-challenge；CI 與 build／check／test 指令也不呼叫', () => {
  const offenders = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(mjs|js|yml|yaml)$/.test(e.name) && /eval-challenge|run-challenge/.test(fs.readFileSync(p, 'utf8'))) offenders.push(path.relative(ROOT, p));
    }
  };
  for (const d of ['scripts', 'src', '.github']) if (fs.existsSync(path.join(ROOT, d))) walk(path.join(ROOT, d));
  assert.deepEqual(offenders, []);
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.match(pkg.scripts['eval:challenge'], /run-challenge\.mjs/);
  for (const k of ['build', 'check', 'test', 'eval', 'dev']) assert.doesNotMatch(pkg.scripts[k] ?? '', /challenge/, k);
  // 載入的 site 裡也沒有挑戰集（load.mjs 只讀 eval-set.json）
  assert.ok(!JSON.stringify(Object.keys(site().governance)).includes('hallenge'));
  assert.ok(!site().governance.evalSet.questions.some((q) => String(q.id).startsWith('CH-')));
});

test('執行器：分切分／類型／語言統計；holdout 失敗預設不列題目文字；永不當門檻', async () => {
  const pick = [
    ...SET.questions.filter((q) => q.split === 'dev').slice(0, 4),
    ...SET.questions.filter((q) => q.split === 'holdout').slice(0, 4),
    ...SET.questions.filter((q) => q.lang === 'vi').slice(0, 2),
  ];
  // 故意放一題一定失敗的 holdout 題，確認明細被隱藏
  const bad = { ...pick[5], id: 'X-FAIL', split: 'holdout', expect: { refuse: false, mustCiteAny: ['service.media-interview-request'] } };
  const set = { ...SET, questions: [...pick, bad] };
  const rep = await runChallenge(site(), set);
  assert.equal(rep.gating, false);
  assert.equal(rep.total, pick.length + 1);
  assert.ok(rep.bySplit.dev && rep.bySplit.holdout);
  assert.ok(rep.byLang.vi && rep.byLang['zh-TW']);
  assert.ok(Object.keys(rep.byCategory).every((k) => CATEGORIES.includes(k)));
  const f = rep.failures.find((x) => x.id === 'X-FAIL');
  assert.ok(f && f.kind === 'wrong-source' && f.q === undefined, '預設不列 holdout 題目');
  const rep2 = await runChallenge(site(), set, { showHoldout: true });
  assert.equal(rep2.failures.find((x) => x.id === 'X-FAIL').q, bad.q);
  assert.match(formatReport(rep), /holdout 失敗未列出明細/);
  assert.equal(failureKind(['不應拒答卻拒答（no-match）']), 'refused');
});
