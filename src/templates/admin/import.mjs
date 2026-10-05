// /admin/import/ 舊站匯入批次（ARCHITECTURE §17.3）：讀 data/legacy-import/*/report.json，顯示批次摘要、逐頁結果、草稿 JSON 下載、
// 與移轉清單的對照。草稿不在 content/ 裡（會與既有內容重複），所以這裡只讀不寫；草稿與報告以 pages() 的 file 選項原樣輸出到
// dist/admin/import/{batch}/…，後台頁面用連結下載、展開時才抓來顯示。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { html, raw } from '../../../scripts/lib/render.mjs';
import { pageHead, adminMeta } from './_partials.mjs';
import { layout as adminLayout } from './_layout.mjs';
import { ACTION_LABEL } from '../../../scripts/lib/legacy-import/migration.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const IMPORT_DIR = path.join(ROOT, 'data/legacy-import');

/** 版面：頁面本身用後台版面；下載檔（file:true）原樣輸出 */
export function layout(ctx, meta) {
  if (meta.rawFile) return String(meta.body);
  return adminLayout(ctx, meta);
}
export function meta(ctx, props) {
  if (props?.file) return { rawFile: true, noindex: true, title: '' };
  return adminMeta('舊站匯入批次', 'import', []);
}

const readText = (p) => fs.readFileSync(p, 'utf8');
function walkFiles(dir, base = dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name === 'assets') continue; out.push(...walkFiles(p, base)); } else out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out.sort();
}

/** 讀所有批次（沒有目錄或壞檔都回傳空，不報錯） */
export function loadBatches(dir = IMPORT_DIR) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).filter((x) => x.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const bdir = path.join(dir, e.name);
    const rp = path.join(bdir, 'report.json');
    if (!fs.existsSync(rp)) continue;
    try {
      const report = JSON.parse(readText(rp));
      const files = walkFiles(bdir).filter((f) => /^content\/.+\.json$/.test(f) || ['report.json', 'report.md', 'migration-patch.json'].includes(f));
      out.push({ batch: e.name, dir: bdir, report, files });
    } catch { /* 壞掉的批次略過 */ }
  }
  return out;
}

export function pages() {
  const out = [{ path: '/admin/import/', props: {}, noindex: true }];
  for (const b of loadBatches()) {
    for (const f of b.files) out.push({ path: `/admin/import/${b.batch}/${f}`, props: { file: true, content: readText(path.join(b.dir, f)) }, file: true, noindex: true });
  }
  return out;
}

const KIND = { 'disease-block': '併入疾病頁', faq: 'Q&A', news: '新聞', document: '文件', page: '頁面', list: '清單頁' };
const TYPE = { disease: '疾病頁', faq: 'Q&A', news: '新聞', document: '文件', page: '一般頁面', publication: '出版品', media: '影音', dataset: '資料集', labtest: '檢驗', service: '服務', clarification: '澄清稿', topic: '專區', vaccine: '疫苗', letter: '致醫界通函' };
const ACTION_TONE = { 'manual-review': 'bad', 'merge-into-disease': 'info', 'compare-existing': 'gray', archive: 'gray', drop: 'gray', 'skip-list': 'gray', 'skip-duplicate': 'gray', 'auto-ok': 'ok', 'review-before-publish': 'warn' };
const confTone = (c) => (c >= 0.8 ? 'ok' : c >= 0.6 ? 'warn' : 'bad');
const SEV = { error: '錯誤', warn: '警告', info: '提示' };

const tile = (label, value, note, tone = '') => html`<div class="adm-stat ${tone ? `adm-stat--${tone}` : ''}"><p class="adm-stat__label">${label}</p><p class="adm-stat__value">${value}</p><p class="adm-stat__note">${note}</p></div>`;

function batchSection(ctx, b) {
  const { url } = ctx;
  const r = b.report;
  const s = r.summary;
  const base = `/admin/import/${b.batch}`;
  const dl = (rel) => url(`${base}/${rel}`, { noLang: true });
  const mig = r.migration ?? {};
  const ps = mig.summary ?? {};
  const chg = mig.applied ? mig.statusChanges?.length ?? 0 : ps.statusChanges ?? 0;
  const actions = Object.entries(s.byAction ?? {}).sort((a, c) => c[1] - a[1]);
  const draftsById = new Map(r.drafts.map((d) => [d.id, d]));
  const warnPages = r.pages.filter((p) => p.issues.some((i) => i.severity !== 'info')).length;
  return html`
<section class="adm-card imp-batch" id="batch-${b.batch}" aria-labelledby="imp-h-${b.batch}" data-batch="${b.batch}">
  <h2 id="imp-h-${b.batch}">批次：${b.batch}</h2>
  <p class="adm-card__sub">匯出日 ${r.exportedAt} · 規則檔 <code>${r.rules.file}</code> · 匯出目錄 <code>${r.source.dir}</code>${r.manifest ? html` · 移轉清單 <code>${r.manifest.file}</code>（${r.manifest.items} 筆）` : ''}</p>
  ${r.simulated ? html`<div class="adm-box adm-box--warn" role="note"><strong>這是模擬匯出</strong>${r.source.note ?? '開發環境連不到舊站，依移轉清單合成。'}正式匯出取代 <code>${r.source.dir}</code> 後重跑 <code>node scripts/import-legacy.mjs</code> 即可。</div>` : ''}
  <div class="adm-statrow" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))" aria-label="批次摘要">
    ${tile('舊頁數', html`<span id="imp-pages">${s.pages}</span>`, `${Object.entries(s.byKind).map(([k, v]) => `${KIND[k] ?? k} ${v}`).join('、')}`, 'info')}
    ${tile('草稿', s.drafts, Object.entries(s.byType).map(([k, v]) => `${TYPE[k] ?? k} ${v}`).join('、'), 'info')}
    ${tile('平均信心', html`<span id="imp-avg">${s.avgConfidence}</span>`, '型別 .4 · 單位 .2 · 轉換 .2 · 附件 .1 · 無重複 .1', s.avgConfidence >= 0.8 ? 'ok' : 'warn')}
    ${tile('需人工檢視', html`<span id="imp-review">${s.needsReview}</span>`, '信心低於 0.6', s.needsReview ? 'bad' : 'ok')}
    ${tile('有警告的頁', warnPages, `錯誤 ${s.issues.error} · 警告 ${s.issues.warn}`, warnPages ? 'warn' : 'ok')}
    ${tile('附件與圖片', s.assets.total, `附件 ${s.assets.attachment} · 圖 ${s.assets.image} · 資料 ${s.assets.data}；待補 alt ${s.assets.needsAlt}、PDF 無文字層 ${s.assets.noTextLayer}`, s.assets.needsAlt || s.assets.noTextLayer ? 'warn' : 'ok')}
    ${tile('既有內容已存在', s.existing, '草稿僅供比對，不建議覆蓋', '')}
  </div>
  <p><strong>建議動作分布：</strong> ${actions.map(([a, n]) => html`<span class="adm-badge adm-badge--${ACTION_TONE[a] ?? 'gray'}">${ACTION_LABEL[a] ?? a} ${n}</span> `)}</p>
  <div class="adm-grid adm-grid--2" style="margin-bottom:var(--sp-4)">
    <div class="adm-box adm-box--info"><strong>對應移轉清單</strong>
      ${r.manifest ? html`<p style="margin:.3em 0 0">${r.manifest.id}：對上 ${ps.matched ?? 0} / ${ps.items ?? 0} 筆；status 變化 <strong>${chg}</strong> 筆${mig.applied ? '（已套用）' : '（未套用）'}；note 更新 ${mig.applied ? mig.noteChanges : ps.noteChanges} 筆；仍待移轉 ${ps.stillPending ?? 0}；與清單判定不同 ${ps.conflicts ?? 0}。<code>verified</code> 不動。</p>
      <p style="margin:.3em 0 0"><a href="${url('/admin/migration/', { noLang: true })}">到「移轉進度」看逐筆對照 →</a> · <a href="${url('/v1/migration/index.json', { noLang: true })}">v1/migration/index.json</a></p>` : html`<p style="margin:.3em 0 0">這個批次沒有指定移轉清單。</p>`}
    </div>
    <div class="adm-box adm-box--note"><strong>下載報告</strong>
      <p style="margin:.3em 0 0"><a href="${dl('report.md')}" data-dl="report.md"><code>report.md</code></a>（給人讀） · <a href="${dl('report.json')}" data-dl="report.json"><code>report.json</code></a> · <a href="${dl('migration-patch.json')}" data-dl="migration-patch.json"><code>migration-patch.json</code></a></p>
      <p style="margin:.3em 0 0" class="adm-muted">草稿與 assets 在 <code>data/legacy-import/${b.batch}/content/</code>；確認後由承辦人搬進 <code>content/</code> 開 PR，不會自動入庫。</p>
    </div>
  </div>

  <div class="adm-filters" role="group" aria-label="篩選逐頁結果">
    <div class="adm-field"><label for="imp-act-${b.batch}">建議動作</label>
      <select id="imp-act-${b.batch}" data-f="action"><option value="all">全部</option>${actions.map(([a, n]) => html`<option value="${a}">${ACTION_LABEL[a] ?? a}（${n}）</option>`)}</select></div>
    <div class="adm-field"><label for="imp-kind-${b.batch}">舊頁型別</label>
      <select id="imp-kind-${b.batch}" data-f="kind"><option value="all">全部</option>${Object.entries(s.byKind).map(([k, n]) => html`<option value="${k}">${KIND[k] ?? k}（${n}）</option>`)}</select></div>
    <div class="adm-field adm-field--grow"><label for="imp-q-${b.batch}">搜尋標題、網址、目標</label><input type="search" id="imp-q-${b.batch}" data-f="q" autocomplete="off"></div>
    <label class="adm-check"><input type="checkbox" data-f="review"> 只看需人工檢視</label>
    <label class="adm-check"><input type="checkbox" data-f="warn"> 只看有警告</label>
    <span class="adm-count-note" data-note aria-live="polite"></span>
  </div>
  <div class="adm-tablewrap"><table class="adm-table imp-table" aria-label="${b.batch} 逐頁轉換結果">
    <caption>每列一個舊頁；信心＝型別對應 .4 + 單位對應 .2 + Markdown 無轉換警告 .2 + 附件全找到 .1 + 無重複 .1。</caption>
    <thead><tr><th scope="col">#</th><th scope="col">來源</th><th scope="col">型別 → 草稿</th><th scope="col">目標（新站）</th><th scope="col" class="num">信心</th><th scope="col">問題</th><th scope="col">建議動作</th></tr></thead>
    <tbody>${r.pages.map((p, i) => {
    const probs = p.issues.filter((x) => x.severity !== 'info');
    const infos = p.issues.filter((x) => x.severity === 'info');
    return html`<tr class="imp-row" data-action="${p.action}" data-kind="${p.kind}" data-review="${p.needsReview ? 1 : 0}" data-warn="${probs.length ? 1 : 0}" data-q="${`${p.source.title} ${p.source.url} ${p.target ?? ''} ${p.outputs.map((o) => o.id).join(' ')}`.toLowerCase()}">
      <td class="num">${i + 1}</td>
      <td><strong>${p.source.title}</strong><div class="adm-muted">${p.source.breadcrumbs.filter((x) => x !== '首頁').join('／')}</div><div class="adm-muted imp-url"><code>${String(p.source.url).replace(/^https?:\/\/(www\.)?cdc\.gov\.tw/, '').slice(0, 60)}${String(p.source.url).replace(/^https?:\/\/(www\.)?cdc\.gov\.tw/, '').length > 60 ? '…' : ''}</code></div></td>
      <td><span class="adm-badge adm-badge--gray">${KIND[p.kind] ?? p.kind}</span>
        ${p.outputs.map((o) => {
      const d = draftsById.get(o.id);
      return html`<div class="imp-out"><details class="adm-details imp-draft" data-src="${o.file && !o.role?.startsWith('dup') ? dl(o.file) : ''}">
          <summary><code>${o.id}</code>${o.role === 'merged' ? html` <span class="adm-muted">併入${o.block ? `：${o.block}` : ''}</span>` : ''}${o.role === 'duplicate' ? html` <span class="adm-muted">重複，未輸出（同 ${o.duplicateOf}）</span>` : ''}</summary>
          ${o.file && o.role !== 'duplicate' ? html`<p class="imp-actions"><a class="adm-btn adm-btn--ghost adm-btn--sm" href="${dl(o.file)}" download>下載 JSON</a> <button type="button" class="adm-btn adm-btn--ghost adm-btn--sm" data-copy>複製 JSON</button>${d ? html` <span class="adm-muted">schema ${d.schemaValid ? '通過' : '未通過'} · 信心 ${d.confidence}</span>` : ''}</p><pre class="adm-pre" data-pre tabindex="0" hidden></pre><noscript><a href="${dl(o.file)}">開啟 JSON</a></noscript>` : ''}
        </details></div>`;
    })}</td>
      <td>${p.target ? html`<code>${p.target}</code>` : html`<span class="adm-muted">—</span>`}${p.existing ? html`<div><span class="adm-badge adm-badge--info">既有內容已存在，供比對</span></div>` : ''}${p.manifestKey ? html`<div class="adm-muted">清單 key：<code>${p.manifestKey}</code></div>` : ''}</td>
      <td class="num"><span class="adm-badge adm-badge--${confTone(p.confidence)}">${p.confidence}</span></td>
      <td>${probs.length ? html`<details class="adm-details"><summary>${probs.some((x) => x.severity === 'error') ? html`<span class="adm-badge adm-badge--bad">錯誤</span> ` : ''}${probs.length} 項${infos.length ? html` <span class="adm-muted">+ 提示 ${infos.length}</span>` : ''}</summary>
        <ul class="imp-issues">${[...probs, ...infos].map((x) => html`<li data-sev="${x.severity}"><span class="adm-muted">${SEV[x.severity]}</span> ${x.message}</li>`)}</ul></details>` : html`<span class="adm-muted">${infos.length ? `無（提示 ${infos.length}）` : '無'}</span>`}</td>
      <td><span class="adm-badge adm-badge--${ACTION_TONE[p.action] ?? 'gray'}">${ACTION_LABEL[p.action] ?? p.action}</span></td>
    </tr>`;
  })}</tbody></table></div>
</section>`;
}

const STYLE = `
.imp-table{min-width:980px;table-layout:fixed}
.imp-table th:nth-child(1){width:34px}
.imp-table th:nth-child(2){width:22%}.imp-table th:nth-child(3){width:24%}.imp-table th:nth-child(4){width:17%}
.imp-table th:nth-child(5){width:58px}.imp-table th:nth-child(6){width:11%}
.imp-table td{vertical-align:top;overflow-wrap:anywhere}
.imp-url{font-size:var(--fs-xs);word-break:break-all}
.imp-out{margin-top:6px}.imp-out summary{font-size:var(--fs-sm)}
.imp-actions{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:6px 0}
.imp-issues{margin:6px 0 0;padding-left:1.1em;font-size:var(--fs-sm)}
.imp-issues li[data-sev=error]{color:var(--alert-overdue)}
.imp-row[hidden]{display:none}
`;

const SCRIPT = `(function(){
  var secs=document.querySelectorAll('.imp-batch');
  secs.forEach(function(sec){
    var f={action:'all',kind:'all',q:'',review:false,warn:false};
    var rows=[].slice.call(sec.querySelectorAll('.imp-row'));
    var note=sec.querySelector('[data-note]');
    function apply(){
      var n=0;
      rows.forEach(function(r){
        var ok=(f.action==='all'||r.dataset.action===f.action)&&(f.kind==='all'||r.dataset.kind===f.kind)&&(!f.q||r.dataset.q.indexOf(f.q)>=0)&&(!f.review||r.dataset.review==='1')&&(!f.warn||r.dataset.warn==='1');
        r.hidden=!ok; if(ok)n++;
      });
      if(note)note.textContent='顯示 '+n+' / '+rows.length+' 頁';
    }
    sec.querySelectorAll('[data-f]').forEach(function(el){
      el.addEventListener(el.type==='checkbox'||el.tagName==='SELECT'?'change':'input',function(){
        var k=el.dataset.f; f[k]=el.type==='checkbox'?el.checked:(k==='q'?el.value.trim().toLowerCase():el.value); apply();
      });
    });
    apply();
    var cache={};
    function load(d){
      var src=d.dataset.src; if(!src)return Promise.resolve('');
      if(cache[src])return Promise.resolve(cache[src]);
      return fetch(src).then(function(r){return r.text();}).then(function(t){cache[src]=t;return t;});
    }
    sec.querySelectorAll('details.imp-draft').forEach(function(d){
      d.addEventListener('toggle',function(){
        if(!d.open)return; var pre=d.querySelector('[data-pre]'); if(!pre||pre.dataset.loaded)return;
        load(d).then(function(t){pre.textContent=t;pre.hidden=false;pre.dataset.loaded='1';}).catch(function(){pre.textContent='讀取失敗，請改用「下載 JSON」。';pre.hidden=false;});
      });
      var b=d.querySelector('[data-copy]');
      if(b)b.addEventListener('click',function(){
        load(d).then(function(t){return navigator.clipboard.writeText(t);}).then(function(){var o=b.textContent;b.textContent='已複製';setTimeout(function(){b.textContent=o;},1500);}).catch(function(){b.textContent='請改用下載';});
      });
    });
  });
})();`;

export function render(ctx, props = {}) {
  if (props.file) return props.content;
  const batches = loadBatches();
  const head = pageHead({
    title: '舊站匯入批次',
    what: '舊站 CMS 的匯出（每頁 HTML＋側檔）經 scripts/import-legacy.mjs 一鍵轉成內容草稿：HTML 轉 Markdown、附件與圖片宣告進 assets、依規則對應型別與權責單位，並算出信心分數。這裡列出每一批的結果，讓承辦人知道哪些可以直接核對、哪些要人工檢視。草稿不會自動進 content/。',
    flow: '資訊室從舊站 CMS 匯出一個欄目樹（照匯出格式）→ 執行 import-legacy 產生草稿與報告 → 承辦人在本頁依信心與問題逐頁檢視，一級內容（疾病頁、指引、手冊）一律人工確認 → 確認後把草稿與 assets 搬進 content/ 開 PR（走一般車道）→ 移轉清單的 status／target 隨之更新。',
  });
  if (!batches.length) {
    return html`${head}<div class="adm-box adm-box--info" role="note"><strong>目前沒有匯入批次</strong>執行 <code>node scripts/import-legacy.mjs &lt;匯出目錄&gt; --out data/legacy-import/&lt;批次名&gt;</code> 後，重新建置即可在這裡看到結果。</div>`;
  }
  return html`${head}<style>${raw(STYLE)}</style>${batches.map((b) => batchSection(ctx, b))}<script>${raw(SCRIPT)}</script>`;
}
