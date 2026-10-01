// 評估集執行器：在 Node 跑 content/governance/eval-set.json，與瀏覽器共用 src/client/answer/core.js（純函式）。
// 附錄 D 六指標：Grounding ≥95%、Factual accuracy ≥90%、Completeness ≥85%、Answer rate ≥80%、Refusal precision ≥90%、Reputational safety 100%。
// 版本題（category=version）必須全對才能上線（build.mjs --check 強制）。
//
// CLI：node eval/run-eval.mjs [--verbose] [--category=x] [--json] [--today=YYYY-MMDD]
//
// 題目格式：
// { id, q, category, lang?, view?, disease?, requires?: [contentId 或前綴], note?, expect: {
//     refuse?: bool, refusalKind?: string, intent?: string, intentAny?: [], disease?: string, verdict?: string,
//     mustInclude?: [], mustIncludeAny?: [], mustNotInclude?: [], mustCite?: [前綴], mustCiteAny?: [前綴], mustNotCite?: [前綴],
//     situation?: bool, stats?: bool, aggregate?: 'sum'|'max'|'min'|'avg', points?: n, action?: href 片段, translationNote?: string,
//     citeLabel?: bool, minSentences?: n } }
// requires 中的內容不存在 → 該題 skipped（不計分，報告列出），避免內容尚未建置時誤擋上線。
import { createEngine } from '../src/client/answer/core.js';
import { scoreEvalSet, THRESHOLDS, judge, groundingOf } from '../src/client/answer/judge.js';

export { scoreEvalSet, THRESHOLDS, judge, groundingOf };

/** 由建置期的 site 物件建立引擎（與前端從 v1/*.json 建立的引擎同一份核心） */
export function engineFromSite(site, extra = {}) {
  const unitName = (id) => site.unitById?.get(id)?.name ?? id;
  return createEngine({
    index: site.searchIndex.public,
    indexPro: site.searchIndex.pro,
    situation: site.situation,
    clarifications: (site.collections.clarifications ?? []).filter((c) => c.status === 'published').map((c) => ({
      id: c.id, title: c.title, claim: c.claim, claimVariants: c.claimVariants ?? [], verdict: c.verdict, gov: c.gov, i18n: c.i18n,
      shareText: c.shareText, reportChannel: c.reportChannel, clarificationMarkdown: c.clarificationMarkdown, owner: c.owner, ownerName: unitName(c.owner),
      publishedAt: c.publishedAt, reviewedAt: c.reviewedAt, license: c.license, url: `/factcheck/#${c.id}`,
    })),
    glossary: site.master.glossary,
    diseases: site.master.diseases.map((d) => ({ ...d, hasPage: d.hasPage ?? site.collections.diseases.some((p) => p.id === d.id) })),
    vaccines: [
      ...(site.master.vaccines ?? []).map((v) => { const page = (site.collections.vaccines ?? []).find((p) => p.id === v.id); return { ...v, whereUrl: page?.whereUrl, title: page?.title }; }),
      ...(site.collections.vaccines ?? []).filter((p) => !(site.master.vaccines ?? []).some((v) => v.id === p.id)).map((p) => ({ id: p.id, slug: p.slug, name: p.title, nameEn: p.nameEn, aliases: p.aliases, diseases: p.diseases, whereUrl: p.whereUrl })),
    ],
    countries: site.master.countries ?? [],
    datasets: (site.collections.datasets ?? []).filter((d) => d.series && d.status === 'published').map((d) => ({ ...d, ownerName: unitName(d.owner) })),
    faq: (site.collections.faq ?? []).filter((f) => f.status === 'published').map((f) => ({ id: f.id, question: f.question, diseases: f.diseases, tasks: f.tasks, whitelist: f.gov?.whitelist?.effective !== false && !f.gov?.stale?.length })),
    units: site.master.units,
    travel: [...(site.snapshots?.countryLevels?.data ?? []), ...(site.snapshots?.travelAlerts?.data ?? [])],
    aiStatus: { ...site.governance.aiStatus, paused: false, ...(extra.aiStatus ?? {}) },
    today: site.today,
    random: extra.random,
  });
}

function contentExists(site, ref) {
  if (ref.startsWith('situation:')) return (site.situation?.items ?? []).some((i) => i.disease === ref.slice(10));
  if (ref.startsWith('travel:')) { const iso = ref.slice(7).toUpperCase(); return [...(site.snapshots?.countryLevels?.data ?? []), ...(site.snapshots?.travelAlerts?.data ?? [])].some((t) => String(t.iso2 ?? t.countryCode ?? t.iso ?? t.code ?? '').toUpperCase() === iso); }
  if (ref.startsWith('dataset-series:')) return (site.collections.datasets ?? []).some((d) => d.id === ref.slice(15) && d.series);
  if (site.byId?.has(ref)) return true;
  for (const item of site.all ?? []) if (item.status === 'published' && (item.id.startsWith(ref) || item.family === ref)) return true;
  return false;
}

export async function runEval(site, { category = null } = {}) {
  // 固定亂數，讓稽核編號在報告中可重現
  let seed = 7; const random = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  const engine = engineFromSite(site, { random });
  return scoreEvalSet(engine, site.governance.evalSet ?? {}, { exists: (r) => contentExists(site, r), category, today: site.today });
}

// ───────── CLI ─────────
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());
if (isMain) {
  const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
  const { loadSite } = await import('../scripts/lib/load.mjs');
  const { config } = await import('../site.config.mjs');
  const { applyGovernance } = await import('../scripts/lib/governance.mjs');
  const { buildSearchIndex } = await import('../scripts/lib/index-builder.mjs');
  const { todayISO } = await import('../scripts/lib/render.mjs');
  const site = loadSite(config); site.today = typeof args.today === 'string' ? args.today : process.env.BUILD_TODAY || todayISO();
  applyGovernance(site); site.searchIndex = buildSearchIndex(site);
  const r = await runEval(site, { category: typeof args.category === 'string' ? args.category : null });
  if (args.json) console.log(JSON.stringify({ ...r, results: undefined }, null, 2));
  else {
    const m = r.metrics;
    const row = (k, label) => `  ${label.padEnd(22)} ${m[k] == null ? '—' : `${m[k]}%`.padStart(7)}  門檻 ${THRESHOLDS[k]}%  ${m.pass[k] == null ? '' : m.pass[k] ? '✓' : '✗'}`;
    console.log(`評估集 ${r.version} · today=${r.today} · ${r.total} 題（通過 ${r.passed}、失敗 ${r.failed}、略過 ${r.skippedCount}）`);
    console.log(row('grounding', 'Grounding'));
    console.log(row('factualAccuracy', 'Factual accuracy'));
    console.log(row('completeness', 'Completeness'));
    console.log(row('answerRate', 'Answer rate'));
    console.log(row('refusalPrecision', 'Refusal precision'));
    console.log(row('reputationalSafety', 'Reputational safety'));
    console.log(`  版本題閘門 versionGate: ${r.versionGate ? '通過' : '未通過'}（${r.byCategory.version?.passed ?? 0}/${r.byCategory.version?.total ?? 0}）`);
    console.log('\n各類別：');
    for (const [k, c] of Object.entries(r.byCategory)) console.log(`  ${k.padEnd(14)} ${String(c.passed).padStart(3)}/${String(c.total).padEnd(3)} ${c.pct == null ? '' : `${c.pct}%`}${c.skipped ? `（略過 ${c.skipped}）` : ''}`);
    if (r.failures.length) {
      console.log('\n失敗：');
      for (const f of r.failures) {
        console.log(`  ✗ ${f.id} [${f.category}] ${f.q}`);
        console.log(`      ${f.reasons.join('；')}`);
        if (args.verbose) console.log(`      got: ${JSON.stringify(f.got)}`);
      }
    }
    if (args.verbose && r.skipped.length) { console.log('\n略過（內容尚未存在）：'); for (const s of r.skipped) console.log(`  · ${s.id} ${s.q} ← 缺 ${s.missing.join(', ')}`); }
    if (args.verbose) { console.log('\n全部：'); for (const x of r.results) console.log(`  ${x.ok ? '✓' : '✗'} ${x.id} ${x.got.intent} ${x.got.refused ? `拒答:${x.got.refusalKind}` : ''} ${x.got.cites.join(',')}`); }
  }
  process.exit(r.byCategory.version && !r.versionGate ? 1 : 0);
}
