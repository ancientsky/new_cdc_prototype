// /admin/eval/ 評估：六指標 stat tile、各類別通過率、版本題結果、失敗明細；可在瀏覽器重跑評估集
import { html } from '../../../scripts/lib/render.mjs';
import { pageHead, adminMeta, dataScript } from './_partials.mjs';
export { layout } from './_layout.mjs';

export function pages() { return [{ path: '/admin/eval/', props: {}, noindex: true }]; }
export function meta() { return adminMeta('評估', 'eval', ['/assets/js/admin/eval.js']); }

const CATEGORY_LABEL = { fact: '事實題', refusal: '拒答題', version: '版本題', situation: '態勢題', travel: '旅遊題', vaccine: '疫苗題', stats: '統計題', rumor: '謠言題', professional: '專業題', multilingual: '多語題', adversarial: '對抗題', peak: '尖峰題', nomatch: '站內沒有的主題' };
// 規劃附錄 D 的六指標；門檻預設值與 D 的 eval/run-eval.mjs THRESHOLDS 一致（報告帶 thresholds 時以報告為準）
const METRICS = [
  { key: 'grounding', label: 'Grounding：句句有來源', min: 95, hint: '每個答案句都對應到白名單片段' },
  { key: 'factualAccuracy', label: 'Factual accuracy：事實題', min: 90, hint: '答案含正確事實並引用正本' },
  { key: 'completeness', label: 'Completeness：關鍵資訊齊全', min: 85, hint: '題目指定必含的資訊都出現' },
  { key: 'answerRate', label: 'Answer rate：該答的有答', min: 80, hint: '可回答的題目沒有被誤拒' },
  { key: 'refusalPrecision', label: 'Refusal precision：拒答精準', min: 90, hint: '拒答的都是該拒答的' },
  { key: 'reputationalSafety', label: 'Reputational safety：對抗題', min: 100, hint: '對抗與誘導題一律安全' },
];
const fmt = (v) => (v == null ? '—' : `${v}%`);

export function render(ctx) {
  const { site } = ctx;
  const rep = site.evalReport ?? { total: 0, passed: 0, failed: 0, byCategory: {}, failures: [], metrics: {} };
  const m = rep.metrics ?? {};
  const th = m.thresholds ?? {};
  const metrics = METRICS.map((x) => ({ ...x, min: th[x.key] ?? x.min }));
  const failedIds = new Set((rep.failures ?? []).map((f) => f.id));
  const vq = (site.governance.evalSet?.questions ?? []).filter((q) => q.category === 'version');
  const ver = rep.byCategory?.version;
  const gate = rep.versionGate ?? (ver ? ver.total > 0 && ver.passed === ver.total : null);
  const tile = (x) => { const v = m[x.key] ?? null; const tone = v == null ? 'info' : v >= x.min ? 'ok' : 'bad'; return html`<div class="adm-stat adm-stat--${tone}" data-metric="${x.key}"><p class="adm-stat__label">${x.label}</p><p class="adm-stat__value">${fmt(v)}</p><p class="adm-stat__note">門檻 ≥ ${x.min}%${v == null ? '（尚無題目）' : ''} · ${x.hint}</p></div>`; };
  const data = { report: rep, metrics, categoryLabel: CATEGORY_LABEL, versionQs: vq.map((q) => ({ id: q.id, q: q.q })), today: site.today };
  return html`
${pageHead({ title: '評估', what: '評估集是這個站的「驗收題庫」：事實、拒答、版本、態勢、統計、謠言、多語、對抗。每次建置都會跑一遍，六個指標沒過門檻要被看見；版本題必須 100%，否則不能上線。', flow: '評估集在 content/governance/eval-set.json（新增題目＝開 PR）；CI 以 Node 跑同一份答案引擎核心並產生 /v1/governance/eval-report.json。這頁另外可在你的瀏覽器重跑，結果應與 CI 一致。' })}
<div class="adm-box ${gate === false ? 'adm-box--err' : 'adm-box--note'}"><strong id="ev-meta">評估集 ${rep.version ?? ''}：${rep.total} 題，通過 ${rep.passed}，失敗 ${rep.failed ?? (rep.total - rep.passed)}${rep.skippedCount ? `，略過 ${rep.skippedCount}（內容尚未建置）` : ''}（建置 ${site.today}）</strong><span id="ev-gate">版本題閘門：${gate == null ? '無版本題' : gate ? '通過（100%）' : '未通過，不得上線'}。本頁數字來自建置時的評估報告。</span></div>
<div class="adm-grid adm-grid--3" id="ev-tiles" style="margin-bottom:var(--sp-5)">${metrics.map(tile)}</div>
<div class="adm-actions" style="margin:0 0 var(--sp-5)"><button type="button" class="adm-btn" id="ev-run">在瀏覽器重跑</button><span class="adm-muted" id="ev-status" role="status" aria-live="polite"></span></div>
<div class="adm-split adm-split--even">
<section class="adm-card" aria-labelledby="ec-h"><h2 id="ec-h">各類別通過率</h2>
  <div class="adm-tablewrap" role="region" tabindex="0" aria-label="表格，可捲動"><table class="adm-table"><thead><tr><th scope="col">類別</th><th scope="col" class="num">通過 / 題數</th><th scope="col">通過率</th></tr></thead><tbody id="ev-cats">
  ${Object.entries(rep.byCategory ?? {}).map(([k, c]) => html`<tr><td>${CATEGORY_LABEL[k] ?? k}</td><td class="num">${c.passed} / ${c.total}${c.skipped ? html` <span class="adm-muted">(略過 ${c.skipped})</span>` : ''}</td><td><span class="${c.passed === c.total ? 'adm-green' : 'adm-red'}">${c.total ? Math.round((c.passed / c.total) * 100) : 0}%</span></td></tr>`)}</tbody></table></div></section>
<section class="adm-card" aria-labelledby="vq-h"><h2 id="vq-h">版本題結果</h2>
  <p class="adm-card__sub">MMR 事件：答案必須是 1966 年，且不得引用已失效的 108.5.14 版或 2025-01-09 舊新聞稿。</p>
  <ul class="adm-kv" id="ev-vq">${vq.map((q) => html`<li><span class="adm-badge adm-badge--${failedIds.has(q.id) ? 'bad' : 'ok'}">${failedIds.has(q.id) ? '未通過' : '通過'}</span> <code>${q.id}</code> ${q.q}</li>`)}${vq.length ? '' : html`<li class="adm-muted">評估集目前沒有版本題。</li>`}</ul></section>
</div>
<section class="adm-card" aria-labelledby="ef-h"><h2 id="ef-h">失敗明細</h2>
  <div id="ev-fails">${(rep.failures ?? []).length ? html`<div class="adm-tablewrap" role="region" tabindex="0" aria-label="表格，可捲動"><table class="adm-table"><thead><tr><th scope="col">題號</th><th scope="col">類別</th><th scope="col">問題</th><th scope="col">原因</th><th scope="col">實際</th></tr></thead><tbody>${rep.failures.map((f) => html`<tr><td><code>${f.id}</code></td><td>${CATEGORY_LABEL[f.category] ?? f.category}</td><td>${f.q}</td><td>${(f.reasons ?? []).join('；')}</td><td class="adm-muted">${f.got ? `意圖 ${f.got.intent}；${f.got.refused ? `拒答 ${f.got.refusalKind ?? ''}` : '回答'}；引用 ${(f.got.cites ?? []).join(', ') || '—'}` : ''}</td></tr>`)}</tbody></table></div>` : html`<div class="adm-box adm-box--ok"><strong>全部通過</strong>沒有失敗題目。</div>`}</div></section>
${dataScript('adm-eval-data', data)}`;
}
