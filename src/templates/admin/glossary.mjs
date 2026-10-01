// /admin/glossary/ 詞彙主檔：七語對照、鎖定詞、別名、deprecated 舊名、引用內容；新增詞彙（示範）輸出 JSON 片段
import { html } from '../../../scripts/lib/render.mjs';
import { pageHead, adminMeta, dataScript, LANGS, frontPath } from './_partials.mjs';
export { layout } from './_layout.mjs';

export function pages() { return [{ path: '/admin/glossary/', props: {}, noindex: true }]; }
export function meta() { return adminMeta('詞彙主檔', 'glossary', ['/assets/js/admin/glossary.js']); }

const textOf = (i) => [i.title, i.summary, i.question, i.answerMarkdown, i.bodyMarkdown, i.machineReadableMarkdown, i.clarificationMarkdown, ...(i.keywords ?? []), ...(i.blocks ?? []).map((b) => `${b.markdown ?? ''} ${(b.cards ?? []).map((c) => `${c.title} ${c.text}`).join(' ')}`)].filter(Boolean).join('\n');
const tr = (g, code) => (code === 'id' ? (g.id_ ?? g['id-ID'] ?? '') : (g[code] ?? ''));

export function render(ctx) {
  const { site, url } = ctx;
  const gl = site.master.glossary;
  const texts = site.all.filter((i) => i.status !== 'archived').map((i) => ({ i, t: textOf(i) }));
  const usage = (g) => {
    const forms = [g['zh-TW'], ...(g.aliases ?? []), ...(g.deprecated ?? [])].filter(Boolean);
    const ref = new Set(g.refs ?? []);
    return texts.filter(({ i, t }) => ref.has(i.id) || forms.some((f) => t.includes(f))).map(({ i }) => i);
  };
  const cols = LANGS.filter((l) => l.code !== 'zh-TW');
  return html`
${pageHead({ title: '詞彙主檔', what: '七語詞彙主檔：同一個概念只有一個正名。標「鎖定」的詞，機器翻譯時不得自由翻譯，一律替換成這裡的譯名；deprecated 是不再使用的舊名，預處理遇到會提醒改用正名。', flow: 'content/master/glossary.json（Git 管理）→ 建置輸出 /v1/glossary.json → 上架預處理與答案引擎共用。新增或修改詞彙＝開 PR，由 OASIS 與多語審核人複核。' })}
<section class="adm-card" aria-labelledby="g-h"><h2 id="g-h">詞彙表（${gl.length} 筆）</h2>
  <div class="adm-filters"><div class="adm-field adm-field--grow"><label for="g-q">搜尋（任何語言、別名、舊名）</label><input type="search" id="g-q"></div>
    <label class="adm-pill" style="align-self:end"><input type="checkbox" id="g-locked"><span>只看鎖定詞</span></label><span class="adm-count-note" id="g-count" aria-live="polite"></span></div>
  <div class="adm-tablewrap"><table class="adm-table" id="g-table"><thead><tr><th scope="col">繁中正名</th><th scope="col">別名／舊名</th>${cols.map((l) => html`<th scope="col" lang="${l.code}">${l.label}</th>`)}<th scope="col">鎖定</th><th scope="col">引用內容</th></tr></thead>
  <tbody>${gl.map((g) => { const u = usage(g); return html`<tr data-locked="${g.locked ? 1 : 0}" data-q="${[g['zh-TW'], ...(g.aliases ?? []), ...(g.deprecated ?? []), ...LANGS.map((l) => tr(g, l.code)), g.id].join(' ').toLowerCase()}">
    <td><strong>${g['zh-TW']}</strong><div class="adm-muted"><code>${g.id}</code>${g.domain ? ` · ${g.domain}` : ''}</div>${g.note ? html`<div class="adm-muted">${g.note}</div>` : ''}</td>
    <td>${(g.aliases ?? []).map((a) => html`<span class="adm-chip adm-chip--plain">${a}</span> `)}${(g.deprecated ?? []).map((a) => html`<span class="adm-chip adm-chip--warn" title="舊名，不再使用"><span class="adm-term-del">${a}</span>（停用）</span> `)}</td>
    ${cols.map((l) => html`<td lang="${l.code}">${tr(g, l.code) || html`<span class="adm-muted">—</span>`}</td>`)}
    <td>${g.locked ? html`<span class="adm-badge adm-badge--info">鎖定</span>` : html`<span class="adm-muted">否</span>`}</td>
    <td>${u.length ? html`${u.length} 筆<div class="adm-muted">${u.slice(0, 3).map((i) => { const p = frontPath(i); return p ? html`<a href="${url(p)}">${i.id}</a> ` : html`${i.id} `; })}${u.length > 3 ? '…' : ''}</div>` : html`<span class="adm-muted">0</span>`}</td></tr>`; })}</tbody></table></div></section>

<section class="adm-card" aria-labelledby="gn-h" id="new-term"><h2 id="gn-h">新增詞彙（示範）</h2>
  <p class="adm-card__sub">填完後輸出可貼進 <code>content/master/glossary.json</code> 的 JSON 片段，再開 Pull Request。不會真的寫入主檔。</p>
  <form id="g-form" class="adm-form" novalidate>
    <div class="adm-grid adm-grid--3">
      <div class="adm-field"><label for="n-zh">繁中正名</label><input type="text" id="n-zh" required></div>
      <div class="adm-field"><label for="n-id">詞彙 ID</label><input type="text" id="n-id" placeholder="term.chikungunya"><span class="adm-hint">小寫英文、數字、連字號</span></div>
      <div class="adm-field"><label for="n-domain">領域</label><select id="n-domain">${['disease', 'vaccine', 'org', 'procedure', 'place', 'general'].map((d) => html`<option value="${d}">${d}</option>`)}</select></div>
      <div class="adm-field"><label for="n-aliases">別名（逗號分隔）</label><input type="text" id="n-aliases"></div>
      <div class="adm-field"><label for="n-dep">停用舊名 deprecated（逗號分隔）</label><input type="text" id="n-dep"></div>
      <div class="adm-field"><label for="n-refs">關聯內容 refs（逗號分隔）</label><input type="text" id="n-refs" placeholder="disease.chikungunya"></div>
    </div>
    <div class="adm-grid adm-grid--3">${cols.map((l) => html`<div class="adm-field"><label for="n-lang-${l.code}" lang="${l.code}">${l.label}</label><input type="text" id="n-lang-${l.code}" data-lang="${l.code}" lang="${l.code}"></div>`)}</div>
    <div class="adm-field"><label for="n-note">備註</label><input type="text" id="n-note"></div>
    <label class="adm-pill" style="width:fit-content"><input type="checkbox" id="n-locked" checked><span>鎖定（機器翻譯不得自由翻譯）</span></label>
    <div id="n-warn" aria-live="polite"></div>
    <pre class="adm-pre" id="n-out" tabindex="0">{ }</pre>
    <div class="adm-actions"><button type="button" class="adm-btn" id="n-copy">複製 JSON</button><button type="button" class="adm-btn adm-btn--ghost" id="n-dl">下載 .json</button></div>
  </form></section>
${dataScript('adm-glossary-data', gl.map((g) => ({ id: g.id, zh: g['zh-TW'], aliases: g.aliases ?? [], deprecated: g.deprecated ?? [] })))}`;
}
