import { $, esc, v1, url, readEmbedded } from './common.js';
import { judge as localJudge } from './judge.js';

const D = readEmbedded('adm-eval-data', { report: {}, metrics: [], categoryLabel: {} });
const pctOf = (c) => (c?.total ? Math.round((c.passed / c.total) * 1000) / 10 : null);

function metricVals(rep) {
  const m = rep.metrics ?? {}, bc = rep.byCategory ?? {};
  const safe = { total: (bc.adversarial?.total ?? 0) + (bc.refusal?.total ?? 0), passed: (bc.adversarial?.passed ?? 0) + (bc.refusal?.passed ?? 0) };
  return { grounding: m.grounding ?? null, refusalPrecision: m.refusalPrecision ?? pctOf(bc.refusal), versionAccuracy: m.versionAccuracy ?? pctOf(bc.version), factAccuracy: m.factAccuracy ?? pctOf(bc.fact), overall: rep.total ? Math.round((rep.passed / rep.total) * 1000) / 10 : null, safety: pctOf(safe) };
}
function paint(rep, note) {
  const vals = metricVals(rep);
  $('#ev-tiles').innerHTML = D.metrics.map((m) => { const v = vals[m.key]; const tone = v == null ? 'info' : v >= m.min ? 'ok' : 'bad'; return `<div class="adm-stat adm-stat--${tone}"><p class="adm-stat__label">${esc(m.label)}</p><p class="adm-stat__value">${v == null ? '—' : `${v}%`}</p><p class="adm-stat__note">門檻 ≥ ${m.min}%${v == null ? '（尚無題目）' : ''} ${esc(m.hint)}</p></div>`; }).join('');
  $('#ev-cats').innerHTML = Object.entries(rep.byCategory ?? {}).map(([k, c]) => `<tr><td>${esc(D.categoryLabel[k] ?? k)}</td><td class="num">${c.passed} / ${c.total}</td><td><span class="${c.passed === c.total ? 'adm-green' : 'adm-red'}">${c.total ? Math.round((c.passed / c.total) * 100) : 0}%</span></td></tr>`).join('');
  const failed = new Set((rep.failures ?? []).map((f) => f.id));
  $('#ev-vq').innerHTML = D.versionQs.map((q) => `<li><span class="adm-badge adm-badge--${failed.has(q.id) ? 'bad' : 'ok'}">${failed.has(q.id) ? '未通過' : '通過'}</span> <code>${esc(q.id)}</code> ${esc(q.q)}</li>`).join('') || '<li class="adm-muted">評估集目前沒有版本題。</li>';
  $('#ev-fails').innerHTML = (rep.failures ?? []).length
    ? `<div class="adm-tablewrap"><table class="adm-table"><thead><tr><th scope="col">題號</th><th scope="col">類別</th><th scope="col">問題</th><th scope="col">原因</th><th scope="col">實際</th></tr></thead><tbody>${rep.failures.map((f) => `<tr><td><code>${esc(f.id)}</code></td><td>${esc(D.categoryLabel[f.category] ?? f.category)}</td><td>${esc(f.q)}</td><td>${esc((f.reasons ?? []).join('；'))}</td><td class="adm-muted">${f.got ? `意圖 ${esc(f.got.intent)}；${f.got.refused ? '拒答' : '回答'}；引用 ${esc((f.got.cites ?? []).join(', ') || '—')}` : ''}</td></tr>`).join('')}</tbody></table></div>`
    : '<div class="adm-box adm-box--ok"><strong>全部通過</strong>沒有失敗題目。</div>';
  $('#ev-meta').textContent = `評估集 ${rep.version ?? ''}：${rep.total} 題，通過 ${rep.passed}，失敗 ${rep.total - rep.passed}${note ? `（${note}）` : ''}`;
}

async function rerun() {
  const btn = $('#ev-run'), st = $('#ev-status');
  btn.disabled = true; st.textContent = '載入答案引擎與索引…';
  const t0 = performance.now();
  try {
    const core = await import(url('/assets/js/answer/core.js'));
    const [index, indexPro, situation, clar, glossary, diseases, datasets, aiBase, evalSet] = await Promise.all(['search-index', 'search-index-pro', 'situation', 'clarifications', 'glossary', 'diseases', 'datasets', 'governance/ai-status', 'governance/eval-set'].map((n) => v1(n, null)));
    if (!index || !evalSet) throw new Error('讀不到 /v1/search-index.json 或 eval-set.json');
    const override = (() => { try { const o = JSON.parse(localStorage.getItem('cdc.aiStatusOverride')); return o && typeof o.paused === 'boolean' ? o : null; } catch { return null; } })();
    // 評估看的是內容與規則本身，不受本機的暫停覆寫影響
    const aiStatus = { ...(aiBase ?? {}), paused: false };
    void override;
    const engine = core.createEngine({
      index, indexPro: indexPro ?? [], situation, glossary: glossary ?? [], diseases: diseases ?? [], aiStatus, today: document.body.dataset.today,
      clarifications: (clar ?? []).map((c) => ({ id: c.id, claim: c.claim, claimVariants: c.claimVariants ?? [], verdict: (c.governance?.annotations ?? []).some((a) => a.kind === 'based-on-revised') ? 'outdated' : c.verdict, title: c.title, shareText: c.shareText, reportChannel: c.reportChannel, url: `/factcheck/#${c.id}` })),
      datasets: (datasets ?? []).filter((d) => d.series).map((d) => ({ id: d.id, title: d.title, series: d.series, canonicalUrl: d.canonicalUrl, owner: d.owner, license: d.license, lastUpdated: d.lastUpdated })),
    });
    const judge = core.judge ?? localJudge;
    const failures = [], byCategory = {};
    let passed = 0;
    for (const q of evalSet.questions ?? []) {
      st.textContent = `評估中… ${q.id}`;
      const res = engine.answer(q.q, { lang: q.lang ?? 'zh-TW', view: q.category === 'professional' ? 'pro' : 'public' });
      const reasons = judge(q, res);
      (byCategory[q.category] ??= { total: 0, passed: 0 }).total++;
      if (!reasons.length) { passed++; byCategory[q.category].passed++; } else failures.push({ id: q.id, q: q.q, category: q.category, reasons, got: { intent: res.intent, refused: res.refused, cites: (res.sources ?? []).map((s) => s.contentId) } });
    }
    const total = (evalSet.questions ?? []).length;
    const grounding = total ? Math.round(((total - failures.filter((f) => f.reasons.some((r) => r.startsWith('grounding'))).length) / total) * 1000) / 10 : null;
    const rep = { version: evalSet.version, total, passed, failed: failures.length, byCategory, failures, metrics: { grounding, refusalPrecision: pctOf(byCategory.refusal), versionAccuracy: pctOf(byCategory.version), factAccuracy: pctOf(byCategory.fact) } };
    paint(rep, '瀏覽器重跑');
    const same = rep.passed === D.report.passed && rep.total === D.report.total;
    st.textContent = `完成：${rep.passed}/${rep.total} 題通過，耗時 ${Math.round(performance.now() - t0)} ms；${same ? '與建置時結果一致' : `與建置時（${D.report.passed}/${D.report.total}）不同，可能是本機快取或索引版本差異`}`;
  } catch (err) {
    st.textContent = `重跑失敗：${String(err?.message ?? err)}`;
  } finally { btn.disabled = false; }
}
$('#ev-run').addEventListener('click', rerun);
