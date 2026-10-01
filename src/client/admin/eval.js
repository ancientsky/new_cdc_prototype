import { $, esc, v1, url, readEmbedded } from './common.js';
import { runAll } from './judge.js';

const D = readEmbedded('adm-eval-data', { report: {}, metrics: [], categoryLabel: {} });
const fmt = (v) => (v == null ? '—' : `${v}%`);

function paint(rep, note) {
  const m = rep.metrics ?? {};
  $('#ev-tiles').innerHTML = D.metrics.map((x) => { const v = m[x.key] ?? null; const tone = v == null ? 'info' : v >= x.min ? 'ok' : 'bad'; return `<div class="adm-stat adm-stat--${tone}"><p class="adm-stat__label">${esc(x.label)}</p><p class="adm-stat__value">${fmt(v)}</p><p class="adm-stat__note">門檻 ≥ ${x.min}%${v == null ? '（尚無題目）' : ''} · ${esc(x.hint)}</p></div>`; }).join('');
  $('#ev-cats').innerHTML = Object.entries(rep.byCategory ?? {}).map(([k, c]) => `<tr><td>${esc(D.categoryLabel[k] ?? k)}</td><td class="num">${c.passed} / ${c.total}${c.skipped ? ` <span class="adm-muted">(略過 ${c.skipped})</span>` : ''}</td><td><span class="${c.passed === c.total ? 'adm-green' : 'adm-red'}">${c.total ? Math.round((c.passed / c.total) * 100) : 0}%</span></td></tr>`).join('');
  const failed = new Set((rep.failures ?? []).map((f) => f.id));
  $('#ev-vq').innerHTML = D.versionQs.map((q) => `<li><span class="adm-badge adm-badge--${failed.has(q.id) ? 'bad' : 'ok'}">${failed.has(q.id) ? '未通過' : '通過'}</span> <code>${esc(q.id)}</code> ${esc(q.q)}</li>`).join('') || '<li class="adm-muted">評估集目前沒有版本題。</li>';
  $('#ev-fails').innerHTML = (rep.failures ?? []).length
    ? `<div class="adm-tablewrap"><table class="adm-table"><thead><tr><th scope="col">題號</th><th scope="col">類別</th><th scope="col">問題</th><th scope="col">原因</th><th scope="col">實際</th></tr></thead><tbody>${rep.failures.map((f) => `<tr><td><code>${esc(f.id)}</code></td><td>${esc(D.categoryLabel[f.category] ?? f.category)}</td><td>${esc(f.q)}</td><td>${esc((f.reasons ?? []).join('；'))}</td><td class="adm-muted">${f.got ? `意圖 ${esc(f.got.intent)}；${f.got.refused ? `拒答 ${esc(f.got.refusalKind ?? '')}` : '回答'}；引用 ${esc((f.got.cites ?? []).join(', ') || '—')}` : ''}</td></tr>`).join('')}</tbody></table></div>`
    : '<div class="adm-box adm-box--ok"><strong>全部通過</strong>沒有失敗題目。</div>';
  $('#ev-meta').textContent = `評估集 ${rep.version ?? ''}：${rep.total} 題，通過 ${rep.passed}，失敗 ${rep.failed}${rep.skippedCount ? `，略過 ${rep.skippedCount}` : ''}${note ? `（${note}）` : ''}`;
  $('#ev-gate').textContent = `版本題閘門：${rep.versionGate ? '通過（100%）' : '未通過，不得上線'}。`;
}

/** requires（內容 id／前綴）是否存在：用 v1/catalog.json、situation、datasets 近似 build 時的 contentExists */
async function makeExists() {
  const [catalog, situation, datasets, levels, alerts] = await Promise.all([v1('catalog', []), v1('situation', null), v1('datasets', []), v1('country-levels', []), v1('travel-alerts', [])]);
  const ids = (catalog ?? []).map((c) => c.id);
  const travel = [...(Array.isArray(levels) ? levels : []), ...(Array.isArray(alerts) ? alerts : [])];
  return (ref) => {
    if (ref.startsWith('situation:')) return (situation?.items ?? []).some((i) => i.disease === ref.slice(10));
    if (ref.startsWith('travel:')) { const iso = ref.slice(7).toUpperCase(); return travel.some((t) => String(t.iso2 ?? t.countryCode ?? t.iso ?? t.code ?? '').toUpperCase() === iso); }
    if (ref.startsWith('dataset-series:')) return (datasets ?? []).some((d) => d.id === ref.slice(15) && d.series);
    return ids.some((id) => id === ref || id.startsWith(ref));
  };
}

async function rerun() {
  const btn = $('#ev-run'), st = $('#ev-status');
  btn.disabled = true; st.textContent = '載入答案引擎與資料…';
  const t0 = performance.now();
  try {
    const data = await import(url('/assets/js/answer/data.js'));
    const core = await import(url('/assets/js/answer/core.js'));
    const [pubL, proL, evalSet, exists] = await Promise.all([data.loadEngine('public'), data.loadEngine('pro'), v1('governance/eval-set', null), makeExists()]);
    if (!evalSet) throw new Error('讀不到 /v1/governance/eval-set.json');
    // 評估看內容與規則本身，不受本機的暫停覆寫影響：用同一份 deps 重建引擎並強制 paused:false
    const mk = (x) => ({ engine: core.createEngine({ ...x.deps, aiStatus: { ...x.deps.aiStatus, paused: false } }) });
    const pub = mk(pubL), pro = mk(proL);
    st.textContent = '評估中…';
    const rep = runAll(evalSet.questions ?? [], (q) => {
      const view = q.view ?? (q.category === 'professional' ? 'pro' : 'public');
      return (view === 'pro' ? pro : pub).engine.answer(q.q, { lang: q.lang ?? 'zh-TW', view, disease: q.disease ?? null });
    }, exists);
    rep.version = evalSet.version;
    paint(rep, '瀏覽器重跑');
    const same = rep.passed === D.report.passed && rep.total === D.report.total;
    st.textContent = `完成：${rep.passed}/${rep.total} 題通過，耗時 ${Math.round(performance.now() - t0)} ms；${same ? '與建置時結果一致' : `與建置時（${D.report.passed}/${D.report.total}）不同——常見原因：瀏覽器端少了建置期才有的資料，請以 CI 報告為準`}`;
  } catch (err) {
    st.textContent = `重跑失敗：${String(err?.message ?? err)}`;
  } finally { btn.disabled = false; }
}
$('#ev-run').addEventListener('click', rerun);
