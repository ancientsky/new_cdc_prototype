// 第四十九輪：換句話說挑戰集（content/governance/eval-challenge.json）執行器。說明見 docs/eval-challenge.md。
//
// 為什麼另外一份：eval-set.json（擋建置、必須 100%）大多是官方題目原文，通過率會高估真實品質；
// 這份收的是民眾實際的問法（口語、俗稱、錯字、否定句、短句、長輩／家長說法、情境），量的是「類化能力」。
//
// 規則：
//   - 不擋建置：scripts/build.mjs（含 --check）與 CI 都不讀這個檔、不呼叫這支程式（tests/round49-challenge.test.mjs 檢查）。
//   - 永遠以結束碼 0 結束（題庫檔格式錯誤才回 2）；分數低不是錯誤，是要追蹤的數字。
//   - split=dev：失敗明細照列，可以拿來找引擎問題、修詞彙。
//   - split=holdout：只報分數，預設不列題目明細（--show-holdout 才列）；不要拿來調引擎，否則這個數字就不誠實了。
//   - 判分與 eval-set 完全相同（src/client/answer/judge.js）；另外多報一個「第一個來源就對」的比率（top-1），不影響通過與否。
//   - 第五十三輪：封存題組（題庫檔 sealed: true，例如 content/governance/eval-holdout2.json，見 docs/eval-challenge.md §11）：
//     全部題目都是 holdout、類型清單由題庫檔的 categories 自訂；報告只有總分、分組分數與失敗原因計數，
//     不列任何單題（連 id 都不列），--show-sealed 才列（只在稽核時用）。題目可帶 tags，報告另算各 tag 與「排除該 tag 後」的分數。
//
// CLI：node eval/run-challenge.mjs [--split=dev|holdout] [--category=faq|service|disease|multilingual] [--lang=en]
//        [--json] [--json=報告路徑] [--show-holdout] [--show-sealed] [--verbose] [--today=YYYY-MM-DD] [--file=題庫路徑]
//   npm run eval:challenge
//   npm run eval:holdout2      # = --file=content/governance/eval-holdout2.json（封存題組，只報分數）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runEval } from './run-eval.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CHALLENGE_PATH = path.join(ROOT, 'content/governance/eval-challenge.json');
export const SPLITS = ['dev', 'holdout'];
export const CATEGORIES = ['faq', 'service', 'disease', 'multilingual'];
export const HOLDOUT2_PATH = path.join(ROOT, 'content/governance/eval-holdout2.json');

const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : null);
const contentIdOf = (chunkId) => String(chunkId ?? '').split('#')[0];
/** 引用前綴清單：mustCite（全部）＋ mustCiteAny（任一）；top-1 只要第一個來源命中其中一個 */
const expectedPrefixes = (e = {}) => [...(e.mustCite ?? []), ...(e.mustCiteAny ?? [])];

export function loadChallenge(file = CHALLENGE_PATH) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * 題庫格式檢查（runner 與測試共用）。回傳問題清單；空陣列＝通過。
 * evalQuestions：eval-set.json 的題目（檢查不得重複原題）；knownId(prefix)：引用前綴是否對得到站內內容。
 */
export function validateChallenge(set, { evalQuestions = [], knownId = null } = {}) {
  const problems = [];
  const norm = (s) =>
    String(s ?? '')
      .toLowerCase()
      .replace(/[\s\p{P}\p{S}]/gu, '');
  const evalQs = new Set(evalQuestions.map((q) => norm(q.q)));
  const ids = new Set();
  const qs = new Set();
  if (!Array.isArray(set?.questions) || !set.questions.length) return ['questions 必須是非空陣列'];
  if (set.gating !== false) problems.push('gating 必須是 false（挑戰集不擋建置）');
  // 封存題組（第五十三輪）：只收 holdout；類型清單由題庫檔的 categories 自訂
  const sealed = set.sealed === true;
  const categories = sealed && set.categories ? Object.keys(set.categories) : CATEGORIES;
  for (const q of set.questions) {
    const tag = q?.id ?? JSON.stringify(q).slice(0, 40);
    if (!q?.id || typeof q.id !== 'string') problems.push(`${tag}：缺 id`);
    else if (ids.has(q.id)) problems.push(`${tag}：id 重複`);
    else ids.add(q.id);
    if (!q?.q || typeof q.q !== 'string') problems.push(`${tag}：缺 q`);
    if (!q?.expect || typeof q.expect !== 'object') problems.push(`${tag}：缺 expect`);
    if (sealed && q?.split !== 'holdout') problems.push(`${tag}：封存題組的 split 必須是 holdout`);
    else if (!SPLITS.includes(q?.split)) problems.push(`${tag}：split 必須是 dev 或 holdout`);
    if (!categories.includes(q?.category)) problems.push(`${tag}：category 必須是 ${categories.join('／')}`);
    if (!q?.source) problems.push(`${tag}：缺 source`);
    const n = norm(q?.q);
    if (n && qs.has(n)) problems.push(`${tag}：題目與本檔另一題重複`);
    qs.add(n);
    if (n && evalQs.has(n)) problems.push(`${tag}：題目與 eval-set.json 重複（挑戰集不收原題）`);
    const e = q?.expect ?? {};
    if (!expectedPrefixes(e).length && e.refuse !== true) problems.push(`${tag}：expect 須有 mustCite 或 mustCiteAny`);
    if (knownId) for (const p of [...expectedPrefixes(e), ...(e.mustNotCite ?? [])]) if (!knownId(p)) problems.push(`${tag}：引用前綴 ${p} 對不到站內內容`);
  }
  return problems;
}

/** 分組統計：key(q) → { total, passed, pct, top1, top1Pct } */
function tally(rows, key) {
  const out = {};
  for (const r of rows) {
    const k = key(r);
    out[k] ??= { total: 0, passed: 0, pct: null, top1: 0, top1Pct: null };
    out[k].total++;
    if (r.ok) out[k].passed++;
    if (r.top1) out[k].top1++;
  }
  for (const v of Object.values(out)) {
    v.pct = pct(v.passed, v.total);
    v.top1Pct = pct(v.top1, v.total);
  }
  return out;
}

/**
 * 應引用的內容現在是否進得了答案索引（AI 白名單）。審閱逾期（governance R1）、依據正本已改版等會讓內容暫時退出白名單：
 * 這種題目答不出來不是引擎的錯，報告另列（source-not-in-ai-index），並另算一個「排除這些題」的通過率。
 * master／travel／dataset 等結構化來源不經白名單，一律視為可用。
 */
export function aiEligible(site, prefix) {
  if (!/^(faq|service|disease|topic|vaccine|media|page|labtest|news|clar)\./.test(prefix)) return true;
  return (site.all ?? []).some((it) => it.status === 'published' && it.id.startsWith(prefix) && it.gov?.whitelist?.effective !== false);
}

/** 失敗原因歸類（看報告時一眼知道是哪一種問題） */
export function failureKind(reasons = []) {
  const r = reasons.join('；');
  if (/不應拒答卻拒答/.test(r)) return 'refused';
  if (/未引用/.test(r)) return 'wrong-source';
  if (/禁止來源/.test(r)) return 'forbidden-source';
  if (/相關程度較低/.test(r)) return 'low-relevance';
  if (/grounding/.test(r)) return 'grounding';
  return 'other';
}

/**
 * 跑挑戰集。site：與 build 相同流程建好的 site（含 searchIndex）。回傳報告物件（可直接 JSON 化）。
 * opts.split／category／lang：只跑子集合；opts.showHoldout：報告裡列出 holdout 失敗題目文字。
 * 封存題組（set.sealed）：預設 failures 為空陣列（只留 byFailureKind 計數與 failuresHidden）；opts.showSealed 才列明細。
 */
export async function runChallenge(site, set, { split = null, category = null, lang = null, showHoldout = false, showSealed = false } = {}) {
  const sealed = set.sealed === true;
  let questions = set.questions ?? [];
  if (split) questions = questions.filter((q) => q.split === split);
  if (category) questions = questions.filter((q) => q.category === category);
  if (lang) questions = questions.filter((q) => (q.lang ?? 'zh-TW') === lang);
  const byId = new Map(questions.map((q) => [q.id, q]));
  const r = await runEval(site, { set: { ...set, questions } });

  const rows = r.results.map((x) => {
    const q = byId.get(x.id);
    const first = contentIdOf(x.got.cites?.[0]);
    const exp = expectedPrefixes(q.expect);
    const top1 = q.expect?.refuse === true ? x.ok : !!first && exp.some((p) => first.startsWith(p));
    const blocked = exp.length > 0 && !exp.some((p) => aiEligible(site, p));
    return {
      id: x.id,
      ok: x.ok,
      top1,
      blocked,
      split: q.split,
      category: q.category,
      lang: q.lang ?? 'zh-TW',
      style: q.style ?? '—',
      source: q.source,
      tags: q.tags ?? [],
    };
  });
  const rowById = new Map(rows.map((x) => [x.id, x]));
  const failures = r.failures.map((f) => {
    const q = byId.get(f.id);
    const row = rowById.get(f.id);
    const kind = row.blocked ? 'source-not-in-ai-index' : failureKind(f.reasons);
    const base = { id: f.id, split: q.split, category: q.category, lang: row.lang, style: row.style, source: q.source, kind };
    if (sealed ? !showSealed : q.split === 'holdout' && !showHoldout) return base;
    return {
      ...base,
      q: f.q,
      reasons: f.reasons.slice(0, 3),
      expected: expectedPrefixes(q.expect),
      cited: [...new Set((f.got.cites ?? []).map(contentIdOf))].slice(0, 4),
      intent: f.got.intent,
      refused: f.got.refused ? f.got.refusalKind : null,
    };
  });
  const all = tally(rows, () => 'all').all ?? { total: 0, passed: 0, pct: null, top1: 0, top1Pct: null };
  const eligible = rows.filter((x) => !x.blocked);
  const blockedSources = [...new Set(rows.filter((x) => x.blocked).map((x) => x.source.split('#')[0]))];
  // 題目 tags（第五十三輪，目前只有封存題組用）：各 tag 的分數，以及排除該 tag 後的分數。沒有 tags 的題庫不加這兩欄（報告與過去相同）。
  const tagNames = [...new Set(rows.flatMap((x) => x.tags))].sort();
  const tallyAll = (subset) => tally(subset, () => 'all').all ?? null;
  const byTagFields = tagNames.length
    ? {
        byTag: Object.fromEntries(tagNames.map((t) => [t, tallyAll(rows.filter((x) => x.tags.includes(t)))])),
        excludingTag: Object.fromEntries(tagNames.map((t) => [t, tallyAll(rows.filter((x) => !x.tags.includes(t)))])),
      }
    : {};
  const byFailureKind = failures.reduce((m, f) => ((m[f.kind] = (m[f.kind] ?? 0) + 1), m), {});
  const hideAll = sealed && !showSealed;
  return {
    kind: sealed ? 'eval-sealed-holdout' : 'eval-challenge',
    gating: false,
    version: set.version,
    today: r.today,
    runAt: r.runAt,
    filter: { split, category, lang },
    total: all.total,
    passed: all.passed,
    pct: all.pct,
    top1: all.top1,
    top1Pct: all.top1Pct,
    // 應引用的內容目前不在答案索引（例如審閱逾期退出白名單）的題數；pctEligible＝排除這些題後的通過率（引擎本身的表現）
    blocked: rows.length - eligible.length,
    blockedSources,
    pctEligible: pct(eligible.filter((x) => x.ok).length, eligible.length),
    bySplit: tally(rows, (x) => x.split),
    byCategory: tally(rows, (x) => x.category),
    byLang: tally(rows, (x) => x.lang),
    byStyle: tally(rows, (x) => x.style),
    ...byTagFields,
    byFailureKind,
    holdoutDetail: showHoldout,
    ...(sealed ? { sealed: true, itemDetail: !hideAll, failuresHidden: hideAll ? failures.length : 0 } : {}),
    failures: hideAll ? [] : failures,
  };
}

export function formatReport(rep, { verbose = false } = {}) {
  const out = [];
  const line = (label, v) =>
    `  ${label.padEnd(14)} ${String(v.passed).padStart(4)}/${String(v.total).padEnd(4)} ${v.pct == null ? '—' : `${v.pct}%`.padStart(6)}   第一來源就對 ${v.top1Pct == null ? '—' : `${v.top1Pct}%`}`;
  out.push(
    rep.sealed
      ? `盲測題組（封存，只報分數）${rep.version} · today=${rep.today} · 不擋建置（gating=false）`
      : `換句話說挑戰集 ${rep.version} · today=${rep.today} · 不擋建置（gating=false）`,
  );
  out.push(line('全部', rep));
  if (rep.blocked) out.push(`  （其中 ${rep.blocked} 題應引用的內容目前不在答案索引：${rep.blockedSources.join('、')}；排除後通過率 ${rep.pctEligible}%）`);
  if (rep.byTag) {
    out.push('\n依標記（tag）：');
    for (const [k, v] of Object.entries(rep.byTag)) {
      out.push(line(k, v));
      const ex = rep.excludingTag?.[k];
      if (ex) out.push(line(`排除 ${k}`, ex));
    }
  }
  out.push('\n依切分（dev 可拿來修引擎；holdout 只看分數）：');
  for (const [k, v] of Object.entries(rep.bySplit)) out.push(line(k, v));
  out.push('\n依內容類型：');
  for (const [k, v] of Object.entries(rep.byCategory)) out.push(line(k, v));
  out.push('\n依語言：');
  for (const [k, v] of Object.entries(rep.byLang)) out.push(line(k, v));
  out.push('\n依問法：');
  for (const [k, v] of Object.entries(rep.byStyle)) out.push(line(k, v));
  out.push(
    `\n失敗原因：${
      Object.entries(rep.byFailureKind)
        .map(([k, n]) => `${k} ${n}`)
        .join('、') || '無'
    }`,
  );
  const shown = rep.failures.filter((f) => f.q);
  const hidden = rep.failures.length - shown.length;
  if (shown.length) {
    out.push('\n失敗明細（問句 → 實際引用）：');
    for (const f of shown) {
      out.push(`  ✗ ${f.id} [${f.split}·${f.category}·${f.lang}·${f.style}] ${f.q}`);
      out.push(`      → ${f.refused ? `拒答（${f.refused}）` : f.cited.length ? f.cited.join(', ') : '（無來源）'}；應引用 ${f.expected.join(' / ')}`);
      if (verbose) out.push(`      ${f.reasons.join('；')}（意圖 ${f.intent}）`);
    }
  }
  if (hidden && !rep.sealed) out.push(`\n另有 ${hidden} 題 holdout 失敗未列出明細（holdout 不拿來調引擎；確需查看請加 --show-holdout）。`);
  if (rep.failuresHidden) out.push(`\n封存題組：${rep.failuresHidden} 題失敗不列明細（不得拿來調引擎；稽核時才加 --show-sealed）。`);
  return out.join('\n');
}

// ───────── CLI ─────────
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = Object.fromEntries(
    process.argv.slice(2).map((a) => {
      const [k, ...v] = a.replace(/^--/, '').split('=');
      return [k, v.length ? v.join('=') : true];
    }),
  );
  const file = typeof args.file === 'string' ? path.resolve(args.file) : CHALLENGE_PATH;
  let set;
  try {
    set = loadChallenge(file);
  } catch (err) {
    console.error(`讀不到挑戰集 ${file}：${err.message}`);
    process.exit(2);
  }
  const problems = validateChallenge(set);
  if (problems.length) {
    console.error(`挑戰集格式錯誤（${problems.length}）：\n  ${problems.slice(0, 20).join('\n  ')}`);
    process.exit(2);
  }
  const { loadSite } = await import('../scripts/lib/load.mjs');
  const { config } = await import('../site.config.mjs');
  const { applyGovernance } = await import('../scripts/lib/governance.mjs');
  const { buildSearchIndex } = await import('../scripts/lib/index-builder.mjs');
  const { applyConsistency } = await import('../scripts/lib/consistency.mjs');
  const { todayISO } = await import('../scripts/lib/render.mjs');
  const site = loadSite(config);
  site.today = typeof args.today === 'string' ? args.today : process.env.BUILD_TODAY || todayISO();
  applyGovernance(site);
  site.searchIndex = buildSearchIndex(site);
  applyConsistency(site); // 與 build.mjs、run-eval.mjs 同順序
  const opt = (k) => (typeof args[k] === 'string' ? args[k] : null);
  const rep = await runChallenge(site, set, {
    split: opt('split'),
    category: opt('category'),
    lang: opt('lang'),
    showHoldout: !!args['show-holdout'],
    showSealed: !!args['show-sealed'],
  });
  if (args.json === true) console.log(JSON.stringify(rep, null, 2));
  else {
    console.log(formatReport(rep, { verbose: !!args.verbose }));
    if (typeof args.json === 'string') {
      fs.mkdirSync(path.dirname(path.resolve(args.json)), { recursive: true });
      fs.writeFileSync(path.resolve(args.json), JSON.stringify(rep, null, 1) + '\n');
      console.log(`\nJSON 報告 → ${args.json}`);
    }
  }
  process.exit(0);
}
