// 在 Node 跑評估集：與瀏覽器共用 src/client/answer/core.js（純函式）。
// Agent D 會補完判分細節（grounding、refusal precision、completeness、六指標）。
import { createEngine } from '../src/client/answer/core.js';

export async function runEval(site) {
  const qs = site.governance.evalSet.questions ?? [];
  const engine = createEngine({
    index: site.searchIndex.public, indexPro: site.searchIndex.pro, situation: site.situation,
    clarifications: site.collections.clarifications.map((c) => ({ id: c.id, claim: c.claim, claimVariants: c.claimVariants ?? [], verdict: c.gov.stale.length ? 'outdated' : c.verdict, title: c.title, shareText: c.shareText, reportChannel: c.reportChannel, url: `/factcheck/#${c.id}` })),
    glossary: site.master.glossary, diseases: site.master.diseases, datasets: site.collections.datasets.filter((d) => d.series).map((d) => ({ id: d.id, title: d.title, series: d.series, canonicalUrl: d.canonicalUrl, owner: d.owner, license: d.license, lastUpdated: d.lastUpdated })),
    aiStatus: site.governance.aiStatus, today: site.today,
  });
  const failures = [];
  const byCategory = {};
  let passed = 0;
  for (const q of qs) {
    const res = engine.answer(q.q, { lang: q.lang ?? 'zh-TW', view: q.category === 'professional' ? 'pro' : 'public' });
    const reasons = judge(q, res);
    byCategory[q.category] ??= { total: 0, passed: 0 };
    byCategory[q.category].total++;
    if (!reasons.length) { passed++; byCategory[q.category].passed++; } else failures.push({ id: q.id, q: q.q, category: q.category, reasons, got: { intent: res.intent, refused: res.refused, cites: res.sources?.map((s) => s.contentId) } });
  }
  const groundingTotal = qs.length ? Math.round((qs.filter((q) => !failures.some((f) => f.id === q.id && f.reasons.some((r) => r.startsWith('grounding')))).length / qs.length) * 1000) / 10 : null;
  return { version: site.governance.evalSet.version, runAt: new Date().toISOString(), today: site.today, total: qs.length, passed, failed: failures.length, byCategory, failures, metrics: { grounding: groundingTotal, refusalPrecision: pctOf(byCategory.refusal), versionAccuracy: pctOf(byCategory.version), factAccuracy: pctOf(byCategory.fact) } };
}

function pctOf(c) { return c?.total ? Math.round((c.passed / c.total) * 1000) / 10 : null; }

export function judge(q, res) {
  const e = q.expect ?? {};
  const reasons = [];
  if (e.refuse === true && !res.refused) reasons.push('應拒答但回答了');
  if (e.refuse === false && res.refused) reasons.push('不應拒答卻拒答');
  if (e.intent && res.intent !== e.intent) reasons.push(`意圖 ${res.intent} ≠ ${e.intent}`);
  const cites = (res.sources ?? []).map((s) => s.contentId);
  for (const m of e.mustCite ?? []) if (!cites.some((c) => c.startsWith(m))) reasons.push(`未引用 ${m}`);
  for (const m of e.mustNotCite ?? []) if (cites.some((c) => c.startsWith(m))) reasons.push(`引用了禁止來源 ${m}（失效版本）`);
  const text = (res.sentences ?? []).map((s) => s.text).join(' ') + ' ' + (res.refusal?.text ?? '') + ' ' + (res.verdict ?? '');
  for (const m of e.mustInclude ?? []) if (!text.includes(m)) reasons.push(`答案未包含「${m}」`);
  for (const m of e.mustNotInclude ?? []) if (text.includes(m)) reasons.push(`答案包含禁止字「${m}」`);
  if (e.verdict && res.verdict !== e.verdict) reasons.push(`判定 ${res.verdict} ≠ ${e.verdict}`);
  if (e.disease && res.disease !== e.disease) reasons.push(`疾病 ${res.disease} ≠ ${e.disease}`);
  // grounding：每句都要有 cite
  for (const s of res.sentences ?? []) if (!s.cite?.length) reasons.push(`grounding：句子無來源「${s.text.slice(0, 20)}」`);
  return reasons;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const { loadSite } = await import('../scripts/lib/load.mjs');
  const { config } = await import('../site.config.mjs');
  const { applyGovernance } = await import('../scripts/lib/governance.mjs');
  const { buildSearchIndex } = await import('../scripts/lib/index-builder.mjs');
  const { todayISO } = await import('../scripts/lib/render.mjs');
  const site = loadSite(config); site.today = process.env.BUILD_TODAY || todayISO();
  applyGovernance(site); site.searchIndex = buildSearchIndex(site);
  const r = await runEval(site);
  console.log(JSON.stringify({ ...r, failures: r.failures.slice(0, 50) }, null, 2));
  process.exit(r.byCategory.version && r.byCategory.version.passed !== r.byCategory.version.total ? 1 : 0);
}
