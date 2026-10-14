// 第五十三輪：盲測題組 holdout v2（content/governance/eval-holdout2.json）與執行器的封存模式（eval/run-challenge.mjs）。
// 這裡只檢查題庫格式、引用的內容都存在且已發布、執行器預設不列單題明細、建置不讀這份題庫；不檢查通過率，
// 也刻意不在測試裡跑題庫本身的題目（封存題組不能變成任何人每天看的數字）。說明見 docs/eval-challenge.md §11。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { config } from '../site.config.mjs';
import { loadSite } from '../scripts/lib/load.mjs';
import { applyGovernance } from '../scripts/lib/governance.mjs';
import { buildSearchIndex } from '../scripts/lib/index-builder.mjs';
import { applyConsistency } from '../scripts/lib/consistency.mjs';
import { HOLDOUT2_PATH, loadChallenge, validateChallenge, runChallenge, formatReport } from '../eval/run-challenge.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SET = loadChallenge(HOLDOUT2_PATH);
const readJSON = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const EVAL_SET = readJSON('content/governance/eval-set.json');
const CHALLENGE = readJSON('content/governance/eval-challenge.json');
const LANGS = ['zh-TW', 'en', 'ja', 'vi', 'id', 'th', 'tl'];
const norm = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, '');

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

/** 引用前綴是否對得到「已發布」的站內內容：內容 id 前綴、主檔（master.immunization-schedule）、旅遊國家（travel.TH） */
function knownId(prefix) {
  const s = site();
  if (prefix.startsWith('master.')) return s.master[prefix.slice(7).replace(/-(\w)/g, (_, c) => c.toUpperCase())] != null;
  if (prefix.startsWith('travel.')) return (s.master.countries ?? []).some((c) => String(c.iso2 ?? '').toUpperCase() === prefix.slice(7).toUpperCase());
  return (s.all ?? []).some((it) => it.status === 'published' && it.id.startsWith(prefix));
}

/** 不取自題庫的合成題目：一題一定失敗、一題應拒答。只用來驗證執行器的封存行為。 */
const PROBE_FAIL = {
  id: 'X-SEALED-FAIL',
  category: 'disease',
  source: 'probe',
  style: '口語',
  split: 'holdout',
  q: '被狗咬到要打狂犬病疫苗嗎探針題',
  expect: { refuse: false, mustCiteAny: ['service.media-interview-request'], lowRelevance: false },
};
const PROBE_REFUSE = {
  id: 'X-SEALED-REFUSE',
  category: 'out-of-scope',
  source: 'probe',
  style: '短句',
  split: 'holdout',
  q: '台北哪裡的滷肉飯最好吃探針題',
  expect: { refuse: true },
};
const probeSet = () => ({ ...SET, questions: [PROBE_FAIL, PROBE_REFUSE] });

test('holdout v2 格式：封存、不擋建置、約 200 題、全部 holdout，類型／問法／語言都在題庫宣告的清單內', () => {
  assert.ok(HOLDOUT2_PATH.endsWith(path.join('content', 'governance', 'eval-holdout2.json')) && fs.existsSync(HOLDOUT2_PATH));
  assert.equal(SET.sealed, true);
  assert.equal(SET.gating, false);
  assert.ok(SET.questions.length >= 180 && SET.questions.length <= 300, `題數 ${SET.questions.length}`);
  assert.deepEqual(validateChallenge(SET, { evalQuestions: EVAL_SET.questions }), []);
  const cats = Object.keys(SET.categories);
  const styles = Object.keys(SET.styles);
  const tags = Object.keys(SET.tags ?? {});
  for (const q of SET.questions) {
    assert.match(q.id, /^H2-\d{3}$/, q.id);
    assert.equal(q.split, 'holdout', q.id);
    assert.ok(cats.includes(q.category), `${q.id} category ${q.category}`);
    assert.ok(styles.includes(q.style), `${q.id} style ${q.style}`);
    assert.ok(LANGS.includes(q.lang ?? 'zh-TW'), `${q.id} lang ${q.lang}`);
    for (const t of q.tags ?? []) assert.ok(tags.includes(t), `${q.id} tag ${t}`);
    const e = q.expect;
    if (e.refuse === true) assert.ok(!e.mustCiteAny && !e.mustCite, `${q.id}：拒答題不應列應引用內容`);
    else
      assert.ok(e.refuse === false && e.mustCiteAny?.length && e.lowRelevance === false, `${q.id}：作答題要有 refuse:false、mustCiteAny、lowRelevance:false`);
  }
  // 七種語言、九個類型都有題目；拒答題（含急症）有一定數量；屈公病與日本腦炎都有
  const has = (f) => new Set(SET.questions.map(f));
  for (const l of LANGS) assert.ok(has((q) => q.lang ?? 'zh-TW').has(l), `缺 ${l}`);
  for (const c of cats) assert.ok(has((q) => q.category).has(c), `缺類型 ${c}`);
  assert.ok(SET.questions.filter((q) => q.expect.refuse).length >= 15);
  assert.ok(SET.questions.some((q) => q.expect.refusalKind === 'emergency'));
  for (const d of ['disease.chikungunya', 'disease.japanese-encephalitis'])
    assert.ok(
      SET.questions.some((q) => q.expect.mustCiteAny?.includes(d)),
      `缺 ${d}`,
    );
});

test('holdout v2 引用的每個 id（mustCiteAny／mustNotCite）都存在且已發布；chik-je 標記的題目都以這兩個疾病頁為依據', () => {
  assert.deepEqual(validateChallenge(SET, { knownId }), []);
  assert.ok(
    validateChallenge({ ...SET, questions: [{ ...SET.questions[0], expect: { refuse: false, mustCiteAny: ['faq.no-such-faq'] } }] }, { knownId }).length > 0,
  );
  for (const q of SET.questions.filter((x) => x.tags?.includes('chik-je'))) {
    assert.ok(
      q.expect.mustCiteAny.some((p) => /^(disease|labtest)\.(chikungunya|japanese-encephalitis)$/.test(p)),
      q.id,
    );
  }
});

test('holdout v2 不收評估集或挑戰集（含已升格）的題目（正規化後比對）', () => {
  const others = new Set([...EVAL_SET.questions, ...CHALLENGE.questions, ...(CHALLENGE.promoted ?? [])].map((q) => norm(q.q)));
  assert.deepEqual(
    SET.questions.filter((q) => others.has(norm(q.q))).map((q) => q.id),
    [],
  );
  const mine = SET.questions.map((q) => norm(q.q));
  assert.equal(new Set(mine).size, mine.length);
});

test('validateChallenge：封存題組不收 dev、類型必須在題庫宣告的清單內；一般挑戰集照舊', () => {
  const q0 = SET.questions[0];
  assert.ok(validateChallenge({ ...SET, questions: [{ ...q0, split: 'dev' }] }).some((p) => p.includes('holdout')));
  assert.ok(validateChallenge({ ...SET, questions: [{ ...q0, category: 'faq' }] }).some((p) => p.includes('category')));
  // 一般挑戰集（沒有 sealed）仍只收四個固定類型
  assert.deepEqual(validateChallenge(CHALLENGE, { evalQuestions: EVAL_SET.questions }), []);
  assert.ok(validateChallenge({ ...CHALLENGE, questions: [{ ...CHALLENGE.questions[0], category: 'disease-x' }] }).length > 0);
});

test('執行器：封存題組預設只報分數，不列任何單題（連 id 都不列）；--show-sealed 才列', async () => {
  const set = probeSet();
  const rep = await runChallenge(site(), set);
  assert.equal(rep.kind, 'eval-sealed-holdout');
  assert.equal(rep.sealed, true);
  assert.equal(rep.itemDetail, false);
  assert.equal(rep.total, 2);
  assert.deepEqual(rep.failures, []);
  assert.ok(rep.failuresHidden >= 1);
  assert.equal(
    Object.values(rep.byFailureKind).reduce((a, b) => a + b, 0),
    rep.failuresHidden,
  );
  assert.ok(rep.byCategory.disease && rep.byLang['zh-TW'] && rep.byStyle['口語']);
  const json = JSON.stringify(rep);
  const text = formatReport(rep, { verbose: true });
  for (const s of [json, text]) {
    assert.ok(!s.includes(PROBE_FAIL.q) && !s.includes(PROBE_REFUSE.q), '不得出現題目文字');
    assert.ok(!s.includes('X-SEALED-'), '不得出現題目 id');
  }
  assert.match(text, /封存題組：\d+ 題失敗不列明細/);
  assert.match(text, /--show-sealed/);
  // --show-holdout 不會打開封存題組
  const rep1 = await runChallenge(site(), set, { showHoldout: true });
  assert.deepEqual(rep1.failures, []);
  // 明確加 --show-sealed 才列
  const rep2 = await runChallenge(site(), set, { showSealed: true });
  assert.equal(rep2.itemDetail, true);
  assert.equal(rep2.failuresHidden, 0);
  assert.equal(rep2.failures.find((f) => f.id === PROBE_FAIL.id)?.q, PROBE_FAIL.q);
});

test('執行器：tags 另算分數與「排除該 tag 後」的分數；沒有 tags、沒有 sealed 的一般挑戰集報告欄位不變', async () => {
  const tagged = { ...probeSet(), questions: [{ ...PROBE_FAIL, tags: ['t1'] }, PROBE_REFUSE] };
  const rep = await runChallenge(site(), tagged);
  assert.equal(rep.byTag.t1.total, 1);
  assert.equal(rep.excludingTag.t1.total, 1);
  assert.match(formatReport(rep), /排除 t1/);
  const plain = { ...CHALLENGE, questions: CHALLENGE.questions.filter((q) => q.split === 'dev').slice(0, 2) };
  const rep2 = await runChallenge(site(), plain);
  assert.equal(rep2.kind, 'eval-challenge');
  for (const k of ['sealed', 'itemDetail', 'failuresHidden', 'byTag', 'excludingTag']) assert.ok(!(k in rep2), `一般挑戰集不應有 ${k}`);
});

test('CLI：npm run eval:holdout2 指向題庫；預設輸出（文字與 --json）不含題目文字與 id', () => {
  const pkg = readJSON('package.json');
  assert.match(pkg.scripts['eval:holdout2'], /run-challenge\.mjs --file=content\/governance\/eval-holdout2\.json/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'holdout2-'));
  try {
    const file = path.join(dir, 'probe.json');
    fs.writeFileSync(file, JSON.stringify(probeSet()));
    for (const extra of [[], ['--json']]) {
      const out = execFileSync(process.execPath, [path.join(ROOT, 'eval/run-challenge.mjs'), `--file=${file}`, '--today=2026-10-14', ...extra], {
        cwd: ROOT,
        encoding: 'utf8',
      });
      assert.ok(!out.includes(PROBE_FAIL.q) && !out.includes(PROBE_REFUSE.q) && !out.includes('X-SEALED-'), `輸出含單題明細（${extra.join(' ') || '文字'}）`);
      if (!extra.length) assert.match(out, /盲測題組（封存，只報分數）/);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('建置不讀 holdout v2：scripts／src／.github 不引用 eval-holdout2；build／check／test／eval／dev 指令也不呼叫', () => {
  const offenders = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(mjs|js|yml|yaml)$/.test(e.name) && /eval-holdout2|holdout2/.test(fs.readFileSync(p, 'utf8'))) offenders.push(path.relative(ROOT, p));
    }
  };
  for (const d of ['scripts', 'src', '.github']) if (fs.existsSync(path.join(ROOT, d))) walk(path.join(ROOT, d));
  assert.deepEqual(offenders, []);
  const pkg = readJSON('package.json');
  for (const k of ['build', 'check', 'test', 'eval', 'dev']) assert.doesNotMatch(pkg.scripts[k] ?? '', /holdout/, k);
  assert.ok(!JSON.stringify(Object.keys(site().governance)).toLowerCase().includes('holdout'));
});
