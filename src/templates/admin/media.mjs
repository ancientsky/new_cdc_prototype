// /admin/media/ 影音管理（7.7 第 4 點）：每支影片的依據正本、製作日、是否過時、逐字稿字數、字幕語言、反向稽核命中；產生 YouTube 說明欄第一行
import { html } from '../../../scripts/lib/render.mjs';
import { pageHead, dataScript, adminMeta, unitOptions, mediaRows, LANGS } from './_partials.mjs';
export { layout } from './_layout.mjs';

export function pages() { return [{ path: '/admin/media/', props: {}, noindex: true }]; }
export function meta() { return adminMeta('影音管理', 'media', ['/assets/js/admin/media.js']); }

const MTYPE = { video: '影片', animation: '動畫', podcast: 'Podcast', short: '短影音' };
const langName = (c) => LANGS.find((l) => l.code === c)?.label ?? c;

export function render(ctx) {
  const { site, url } = ctx;
  const rows = mediaRows(site);
  const n = rows.length;
  const tr = rows.filter((r) => r.hasTranscript).length;
  const cur = rows.filter((r) => r.basisCurrent).length;
  const out = rows.filter((r) => r.outdated).length;
  const hit = rows.filter((r) => r.audit.length).length;
  const data = Object.fromEntries(rows.map((r) => [r.id, { producedAt: r.producedAt, label: r.label, url: r.curUrl, outdated: r.outdated, curVersion: r.curVersion, curEffectiveAt: r.curEffectiveAt, title: r.title }]));
  return html`
${pageHead({
    title: '影音管理',
    what: '每支影片的依據正本、製作日、是否已被正本修訂「追過」、逐字稿字數、字幕語言與反向稽核命中。影片不再只是一個 YouTube 連結，而是和文字內容一樣有版本、有權責、會過時的治理對象。',
    flow: '影片是 media 型別（content/media/）：必填 basedOn 與逐字稿；producedAt 早於依據正本現行版 effectiveAt ⇒ 引擎自動標「過時」、退出 AI 白名單、產生待辦「影音過時」。逐字稿進 AI 索引（可引用到影片＋章節時間）。',
  })}
<div class="adm-statrow">
  <div class="adm-stat adm-stat--info"><p class="adm-stat__label">影片總數</p><p class="adm-stat__value">${n}</p><p class="adm-stat__note">影片、動畫、Podcast、短影音</p></div>
  <div class="adm-stat ${n && tr < n ? 'adm-stat--bad' : 'adm-stat--ok'}"><p class="adm-stat__label">有逐字稿</p><p class="adm-stat__value">${tr}<small style="font-size:var(--fs-md)"> / ${n}</small></p><p class="adm-stat__note">目標 100%</p></div>
  <div class="adm-stat ${n && cur < n ? 'adm-stat--warn' : 'adm-stat--ok'}"><p class="adm-stat__label">依據正本現行版</p><p class="adm-stat__value">${cur}<small style="font-size:var(--fs-md)"> / ${n}</small></p><p class="adm-stat__note">其餘為過時或未填依據</p></div>
  <div class="adm-stat ${out ? 'adm-stat--bad' : 'adm-stat--ok'}"><p class="adm-stat__label">過時</p><p class="adm-stat__value">${out}</p><p class="adm-stat__note">已自動產生待辦</p></div>
  <div class="adm-stat ${hit ? 'adm-stat--bad' : 'adm-stat--ok'}"><p class="adm-stat__label">反向稽核命中</p><p class="adm-stat__value">${hit}</p><p class="adm-stat__note">逐字稿含失效說法</p></div>
</div>

<details class="adm-details adm-card" open><summary>正本修訂後，過時的影片怎麼處理？（三選一）</summary>
  <div class="adm-sop-box" style="margin-top:var(--sp-3)">
    <ol>
      <li><strong>更新說明欄</strong>：影片內容大致仍可用、只有少數數字或條件變動。YouTube 說明欄第一行改成新的「製作日期 · 依據 · 正本」，並在說明欄置頂補充修訂要點；影片頁的逐字稿同步加註。</li>
      <li><strong>加資訊卡</strong>：重點差異出現在特定時間點。在 YouTube 該秒數加資訊卡（Cards）「此處建議已修訂，請見正本」，連到現行版；影片頁章節標註。</li>
      <li><strong>下架</strong>：核心結論已不成立（例如成人 MMR 評估對象改變）。影片設為不公開，<code>status</code> 改 <code>archived</code>，並排入重製；重製版上架時依現行版製作，待辦自動消失。</li>
    </ol>
    <p class="adm-muted" style="margin:var(--sp-2) 0 0">不論哪一種，影片頁都會由引擎自動加註「本影片依 {版本} 製作，建議已於 {日期} 修訂」，在人處理完之前民眾不會被誤導。</p>
  </div></details>

<section class="adm-card" aria-labelledby="m-h"><h2 id="m-h">影片清單</h2>
  <div class="adm-filters">
    <div class="adm-field adm-field--grow"><label for="m-q">搜尋（標題或識別碼）</label><input type="search" id="m-q"></div>
    <div class="adm-field"><label for="m-unit">單位</label><select id="m-unit">${unitOptions(site, { all: true, selected: 'all' })}</select></div>
    <div class="adm-field"><label for="m-flag">狀態</label><select id="m-flag"><option value="">全部</option><option value="outdated">過時</option><option value="notr">無逐字稿</option><option value="audit">反向稽核命中</option><option value="nobasis">未填依據正本</option></select></div>
    <a class="adm-btn adm-btn--ghost" href="${url('/admin/publish/?type=media', { noLang: true })}">上架新影音</a>
    <span class="adm-count-note" id="m-note" aria-live="polite"></span>
  </div>
  <div class="adm-tablewrap" role="region" tabindex="0" aria-label="表格，可捲動"><table class="adm-table" id="m-table"><caption>逐字稿字數不含空白；「過時」＝製作日早於依據正本現行版生效日（優先採引擎的 gov.mediaOutdated，無則由欄位推算）。</caption>
    <thead><tr><th scope="col">影片</th><th scope="col">依據正本</th><th scope="col">製作日</th><th scope="col">是否過時</th><th scope="col">逐字稿</th><th scope="col">字幕</th><th scope="col">反向稽核</th><th scope="col">說明欄</th></tr></thead>
    <tbody>${rows.map((r) => html`<tr data-id="${r.id}" data-owner="${r.owner}" data-q="${`${r.id} ${r.title}`.toLowerCase()}" data-outdated="${r.outdated ? 1 : 0}" data-notr="${r.hasTranscript ? 0 : 1}" data-audit="${r.audit.length ? 1 : 0}" data-nobasis="${r.noBasis ? 1 : 0}">
      <td>${r.front ? html`<a href="${url(r.front)}">${r.title}</a>` : r.title}<div class="adm-muted"><code>${r.id}</code> · ${MTYPE[r.mediaType] ?? r.mediaType}${r.youtubeId ? ` · YouTube ${r.youtubeId}` : ' · 示意海報'}${r.status !== 'published' ? ` · ${r.status}` : ''}</div></td>
      <td>${r.noBasis ? html`<span class="adm-badge adm-badge--bad">未填</span>` : r.basis.map((b) => html`<div>${b.path ? html`<a href="${url(b.path)}">${b.title}</a>` : b.title}${b.version ? html`<div class="adm-muted">現行版 ${b.version}（${b.effectiveAt} 生效）</div>` : ''}</div>`)}${r.label ? html`<div class="adm-muted">影片標示：${r.label}</div>` : ''}</td>
      <td>${r.producedAt ?? '—'}</td>
      <td>${r.noBasis ? html`<span class="adm-badge adm-badge--gray">無依據</span>` : r.outdated ? html`<span class="adm-badge adm-badge--bad">過時</span><div class="adm-muted">早於現行版 ${r.curEffectiveAt ?? ''}</div>` : html`<span class="adm-badge adm-badge--ok">依據現行版</span>`}</td>
      <td>${r.hasTranscript ? html`<span class="adm-tick adm-tick--ok" role="img" aria-label="有逐字稿">✓</span> ${r.transcriptChars.toLocaleString('en-US')} 字` : html`<span class="adm-tick adm-tick--no" role="img" aria-label="無逐字稿">✗</span> ${r.transcriptChars ? `${r.transcriptChars} 字（過短）` : '無'}`}${r.chapters ? html`<div class="adm-muted">${r.chapters} 個章節</div>` : ''}</td>
      <td>${r.captions.length ? r.captions.map(langName).join('、') : html`<span class="adm-muted">無字幕</span>`}</td>
      <td>${r.audit.length ? html`<span class="adm-badge adm-badge--bad">命中 ${r.audit.length}</span><ul class="adm-muted" style="margin:4px 0 0;padding-left:1.1em">${r.audit.map((a) => html`<li>「${a.match}」${a.message}</li>`)}</ul>` : html`<span class="adm-muted">無</span>`}</td>
      <td><button type="button" class="adm-btn adm-btn--ghost adm-btn--sm" data-desc="${r.id}">產生說明欄文字</button></td></tr>`)}</tbody></table></div>
  <p class="adm-empty" id="m-empty" ${n ? 'hidden' : ''}>目前沒有影音內容。<a href="${url('/admin/publish/?type=media', { noLang: true })}">到上架表單新增影音</a>，或在 content/media/ 加檔。</p>
  <div class="adm-desc-out" id="desc-box" hidden>
    <h3 style="margin:0 0 var(--sp-2)" id="desc-title">YouTube 說明欄文字</h3>
    <p class="adm-muted">第一行固定格式（7.7 第 4 點）；畫面片頭也要印同樣的製作日期與依據版本。</p>
    <pre class="adm-pre" id="desc-out" tabindex="0"></pre>
    <div class="adm-actions"><button type="button" class="adm-btn" id="desc-copy">複製</button></div>
  </div>
</section>
${dataScript('adm-media-data', data)}`;
}
