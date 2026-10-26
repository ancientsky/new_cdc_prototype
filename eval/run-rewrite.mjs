// 第六十五輪：比較「有無模型改寫問句」的盲測分數（docs/ask-search-llm.md §19.4）。
//
// 為什麼要另外一支：改寫要叫模型，CI 與一般建置不叫模型（發布流程 0 次 LLM 呼叫），所以不能放進 eval:challenge；
// 但要不要在正式站開這個功能，必須拿同一份盲測題比較前後差異才知道值不值得（第五十三輪結論：規則式調整已到天花板）。
//
// 做法（與答案頁 ui.js 相同的流程）：
//   1. 每題先照原樣問；答不好（查無、依據不足、勉強相關）的題目才請模型改寫。
//   2. 模型給的詞過 engine.vetTerms（站上真的有的詞才用），加進檢索再問一次；改寫後也答不好就維持原結果。
//   3. 只印兩次的總分與分組分數，不印任何題目（封存題組的規則不因為這支程式而放寬）。
//
// 模型的回覆存在 .local/rewrite-cache.json（不進版控：裡面有題目原文），同一題第二次跑不再叫模型；--offline 只用快取。
//
// 用法：
//   ANTHROPIC_API_KEY=… node eval/run-rewrite.mjs                                  # 預設跑封存盲測 eval-holdout2.json
//   node eval/run-rewrite.mjs --file=content/governance/eval-challenge.json --offline
//   LLM_PROXY_URL=https://機關代理/v1/messages node eval/run-rewrite.mjs            # 正式環境走機關代理（金鑰在代理端）
//   選項：--model=claude-sonnet-5-5  --today=YYYY-MM-DD  --cache=路徑
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOLDOUT2_PATH, loadChallenge, runChallenge, formatReport } from './run-challenge.mjs';
import { engineFromSite } from './run-eval.mjs';
import { llmRewriteQuery } from '../src/client/answer/llm.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.length ? v.join('=') : true]; }));
const file = typeof args.file === 'string' ? path.resolve(args.file) : HOLDOUT2_PATH;
const cachePath = path.resolve(typeof args.cache === 'string' ? args.cache : path.join(ROOT, '.local/rewrite-cache.json'));
const model = typeof args.model === 'string' ? args.model : 'claude-sonnet-5-5';
const key = process.env.ANTHROPIC_API_KEY ?? '';
const apiUrl = process.env.LLM_PROXY_URL || undefined;

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
applyConsistency(site);

const set = loadChallenge(file);
const cache = fs.existsSync(cachePath) ? JSON.parse(fs.readFileSync(cachePath, 'utf8')) : {};
const ckey = (q) => `${model}\u0000${q.lang ?? 'zh-TW'}\u0000${q.q}`;
const engine = engineFromSite(site);
const diseaseNames = (site.master.diseases ?? []).map((d) => d.name);

// 1. 找出答不好的題目，向模型要改寫詞（有快取就不叫）
let called = 0, weak = 0, failed = 0; const weakQs = [];
for (const q of set.questions ?? []) {
  const r = engine.answer(q.q, { lang: q.lang ?? 'zh-TW', view: q.view ?? 'public', disease: q.disease ?? null });
  if (!engine.isWeak(r)) continue;
  weak++; weakQs.push(q);
  if (cache[ckey(q)]) continue;
  if (args.offline || (!key && !apiUrl)) continue;
  const rw = await llmRewriteQuery(r.query, { key, model, lang: q.lang ?? 'zh-TW', diseaseNames, fetchImpl: globalThis.fetch, apiUrl });
  if (rw.error) { failed++; continue; }
  cache[ckey(q)] = rw.terms; called++;
}
fs.mkdirSync(path.dirname(cachePath), { recursive: true });
fs.writeFileSync(cachePath, JSON.stringify(cache, null, 1) + '\n');
const missing = weakQs.filter((q) => !cache[ckey(q)]).length;

// 2. 兩次分數：原樣、加上改寫詞
const before = await runChallenge(site, set);
const wrap = (e) => ({
  ...e,
  answer(q, o = {}) {
    const r = e.answer(q, o);
    if (!e.isWeak(r)) return r;
    const terms = e.vetTerms(cache[`${model}\u0000${o.lang ?? 'zh-TW'}\u0000${q}`] ?? []);
    if (!terms.length) return r;
    const r2 = e.answer(q, { ...o, extraTerms: terms });
    return e.isWeak(r2) ? r : r2;
  },
});
const after = await runChallenge(site, set, { wrapEngine: wrap });

const pct = (x) => (x?.pct == null ? '—' : `${x.passed}/${x.total} ${x.pct}%`);
console.log(`模型改寫問句對照 · ${path.relative(ROOT, file)} · 模型 ${model} · today=${site.today}`);
console.log(`答不好而需要改寫的題數 ${weak}；本次呼叫模型 ${called} 次（失敗 ${failed}）；其中沒有改寫詞的 ${missing} 題${!key && !apiUrl && !args.offline ? '（沒有 ANTHROPIC_API_KEY／LLM_PROXY_URL，只用快取）' : ''}`);
console.log(`  全部    改寫前 ${pct({ passed: before.passed, total: before.total, pct: before.pct })} → 改寫後 ${pct({ passed: after.passed, total: after.total, pct: after.pct })}`);
for (const g of ['byLang', 'byStyle']) for (const k of Object.keys(before[g] ?? {})) {
  const a = before[g][k], b = after[g]?.[k];
  if (a?.passed !== b?.passed) console.log(`  ${k.padEnd(8)}改寫前 ${pct(a)} → 改寫後 ${pct(b)}`);
}
if (args.verbose) console.log('\n' + formatReport(after));
