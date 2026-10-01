// /admin/publish/ 互動：表單 ↔ localStorage(cdc.admin.draft) ↔ 預處理（preprocess.js）↔ 匯出 / 送複核。
import { $, $$, esc, store, v1, url, readEmbedded, today, downloadText, copyText, debounce, getUnit, unitLabel, normPath } from './common.js';
import * as P from './preprocess.js';

const D = readEmbedded('adm-publish-data', {});
const KEY = 'cdc.admin.draft';
const form = $('#pub-form');
const resultEl = $('#pre-result');
const secEl = $('#pre-sec');
const statusEl = $('#f-status');
const typeLabel = (t) => P.TYPES.find((x) => x.value === t)?.label ?? t;

let basedOn = [];
let idTouched = false;
let A = null; // 最近一次預處理結果 {entities, structured, summary0, checks, locked, lex}
let sel = { chips: {}, manual: [], summary: '', st: {}, ack: false, stage: 'edit' };
let llmDrafts = {};

// ---------- 表單讀寫 ----------
const val = (id) => $(id).value;
function langState() {
  const out = {};
  for (const l of P.LANGS) {
    if (l.code === 'zh-TW') continue;
    const cb = $(`input[name="lang"][value="${l.code}"]`);
    out[l.code] = { on: !!cb?.checked, reason: ($(`input[data-reason="${l.code}"]`)?.value ?? '').trim() };
  }
  return out;
}
function readForm() {
  const type = val('#f-type');
  return {
    type, title: val('#f-title').trim(), body: val('#f-body'), owner: val('#f-owner'), period: val('#f-period'),
    audience: $$('input[name="audience"]:checked').map((x) => x.value), tasks: $$('input[name="tasks"]:checked').map((x) => x.value),
    basedOn: [...basedOn], langs: langState(), id: val('#f-id').trim(), idTouched,
    extra: {
      family: val('#x-family').trim(), docType: val('#x-doctype'), version: val('#x-version').trim(), effectiveAt: val('#x-effective'), supersedes: val('#x-supersedes'),
      letterNo: val('#x-letterno').trim(), claim: val('#x-claim').trim(), verdict: val('#x-verdict'), shareText: val('#x-share').trim(), disease: val('#x-disease'), vaccine: val('#x-vaccine'),
    },
  };
}
function writeForm(s) {
  $('#f-type').value = s.type ?? 'faq';
  $('#f-title').value = s.title ?? ''; $('#f-body').value = s.body ?? '';
  if (s.owner) $('#f-owner').value = s.owner;
  $('#f-period').value = s.period ?? P.defaultsFor($('#f-type').value).reviewPeriodMonths;
  $$('input[name="audience"]').forEach((x) => { x.checked = (s.audience ?? ['public']).includes(x.value); });
  $$('input[name="tasks"]').forEach((x) => { x.checked = (s.tasks ?? []).includes(x.value); });
  basedOn = [...(s.basedOn ?? [])]; paintBased();
  applyTypeUI(false);
  for (const l of P.LANGS) {
    if (l.code === 'zh-TW') continue;
    const cb = $(`input[name="lang"][value="${l.code}"]`);
    if (s.langs?.[l.code]) cb.checked = !!s.langs[l.code].on;
    const r = $(`input[data-reason="${l.code}"]`); if (r) r.value = s.langs?.[l.code]?.reason ?? '';
  }
  paintLangReasons();
  const ex = s.extra ?? {};
  $('#x-family').value = ex.family ?? ''; $('#x-doctype').value = ex.docType || 'recommendation'; $('#x-version').value = ex.version ?? ''; $('#x-effective').value = ex.effectiveAt ?? '';
  fillSupersedes(); $('#x-supersedes').value = ex.supersedes ?? '';
  $('#x-letterno').value = ex.letterNo ?? ''; $('#x-claim').value = ex.claim ?? ''; $('#x-verdict').value = ex.verdict || 'false'; $('#x-share').value = ex.shareText ?? '';
  $('#x-disease').value = ex.disease ?? ''; $('#x-vaccine').value = ex.vaccine ?? '';
  $('#f-id').value = s.id ?? ''; idTouched = !!s.idTouched;
  $('#f-body-count').textContent = `${(s.body ?? '').length} 字`;
}

// ---------- 型別連動 ----------
function applyTypeUI(resetDefaults = true) {
  const type = val('#f-type');
  $('[data-pub-title]').textContent = type === 'faq' ? '上架：疾病 Q&A' : `上架：${typeLabel(type)}`;
  const def = P.defaultsFor(type);
  if (resetDefaults) {
    $('#f-period').value = def.reviewPeriodMonths;
    for (const l of P.LANGS) if (l.code !== 'zh-TW') { $(`input[name="lang"][value="${l.code}"]`).checked = def.langs.includes(l.code); const r = $(`input[data-reason="${l.code}"]`); if (r) r.value = ''; }
    paintLangReasons();
  }
  $('#f-period-hint').textContent = `「${typeLabel(type)}」預設 ${def.reviewPeriodMonths === 0 ? '0（事件觸發，不定期）' : `${def.reviewPeriodMonths} 個月`}`;
  $('#f-langs-hint').textContent = `「${typeLabel(type)}」預設：${def.langs.length >= 7 ? '七語' : def.langs.map((c) => P.LANGS.find((l) => l.code === c).label).join('＋')}；取消預設勾選的語言須填理由。`;
  const extra = $('#f-extra');
  let any = false;
  $$('[data-for]', extra).forEach((el) => { const on = el.dataset.for === type; el.hidden = !on; any ||= on; });
  extra.hidden = !any;
  if (resetDefaults) autoId();
}
function paintLangReasons() {
  const def = new Set(P.defaultsFor(val('#f-type')).langs);
  for (const l of P.LANGS) {
    if (l.code === 'zh-TW') continue;
    const cb = $(`input[name="lang"][value="${l.code}"]`), r = $(`input[data-reason="${l.code}"]`);
    const need = !cb.checked && def.has(l.code);
    r.hidden = !need; r.required = need;
  }
}
function fillSupersedes() {
  const sel2 = $('#x-supersedes');
  const fam = val('#x-family');
  const cur = sel2.value;
  const fams = D.families ?? [];
  const list = fam ? fams.filter((f) => f.family === fam) : fams;
  sel2.innerHTML = '<option value="">（無，首版）</option>' + list.flatMap((f) => f.versions.map((v) => `<option value="${esc(v.id)}">${esc(v.id)}　${esc(v.version)}（${esc(v.effectiveAt)}${v.isCurrent ? ' · 現行' : ' · 舊版'}）</option>`)).join('');
  if (cur && [...sel2.options].some((o) => o.value === cur)) sel2.value = cur;
  else if (fam && list[0]) { const curV = list[0].versions.find((v) => v.isCurrent) ?? list[0].versions[0]; sel2.value = curV.id; }
}
function autoId() {
  if (idTouched) return;
  const type = val('#f-type');
  const ex = readForm().extra;
  const dm = (D.diseaseMaster ?? []).find((d) => d.id === ex.disease);
  const vm = (D.vaccinesMaster ?? []).find((v) => v.id === ex.vaccine);
  const dslug = A?.entities?.diseaseIds?.[0] ? (D.diseaseMaster ?? []).find((d) => d.id === A.entities.diseaseIds[0])?.slug : '';
  $('#f-id').value = P.suggestId(type, { title: val('#f-title'), today: D.today, slug: type === 'disease' ? dm?.slug : type === 'vaccine' ? vm?.slug : dslug, family: ex.family, version: ex.effectiveAt });
}

// ---------- 依據正本 ----------
function paintBased() {
  $('#f-based-chips').innerHTML = basedOn.map((id, i) => `<li class="adm-chip">${esc(id)}<button type="button" data-rm="${i}" aria-label="移除 ${esc(id)}">×</button></li>`).join('');
}
function searchBased(q) {
  const list = $('#f-based-list'), input = $('#f-based-q');
  q = q.trim().toLowerCase();
  if (!q) { list.hidden = true; input.setAttribute('aria-expanded', 'false'); return; }
  const items = [
    ...(D.families ?? []).map((f) => ({ id: f.family, label: `${f.title}　文件 family（自動指向現行版）` })),
    ...(D.catalog ?? []).map((c) => ({ id: c.id, label: c.title })),
  ].filter((x) => !basedOn.includes(x.id) && (x.id.toLowerCase().includes(q) || x.label.toLowerCase().includes(q))).slice(0, 8);
  list.innerHTML = items.length ? items.map((x) => `<li role="option"><button type="button" data-add="${esc(x.id)}"><code>${esc(x.id)}</code>　${esc(x.label)}</button></li>`).join('') : '<li class="adm-muted" style="padding:6px 10px">沒有符合的內容</li>';
  list.hidden = false; input.setAttribute('aria-expanded', 'true');
}

// ---------- 草稿 ----------
function saveDraft(msg) {
  const d = { ...readForm(), derived: sel, savedAt: new Date().toISOString() };
  store.set(KEY, d);
  if (msg) { statusEl.textContent = `已儲存草稿（${new Date().toLocaleTimeString('zh-TW', { hour12: false })}，僅存本機瀏覽器）`; }
}
const autosave = debounce(() => saveDraft(false), 400);

// ---------- 預處理 ----------
async function loadMasters() {
  const [glossary, diseases, vaccinePages, countries, documents] = await Promise.all([v1('glossary', []), v1('diseases', []), v1('vaccines', []), v1('countries', []), v1('documents', [])]);
  const vm = new Map((D.vaccinesMaster ?? []).map((v) => [v.id, { ...v }]));
  for (const p of vaccinePages ?? []) vm.set(p.id, { ...(vm.get(p.id) ?? {}), id: p.id, name: p.title ?? p.name, aliases: p.aliases, nameEn: p.nameEn, diseases: p.diseases ?? vm.get(p.id)?.diseases });
  return { glossary, diseases, vaccines: [...vm.values()], countries, documents };
}

async function runPreprocess({ silent = false } = {}) {
  const t0 = performance.now();
  resultEl.setAttribute('aria-busy', 'true');
  const st = readForm();
  const text = `${st.title}\n${st.body}`;
  const M = await loadMasters();
  const lex = P.buildLexicon(M);
  const entities = P.extractEntities(text, lex);
  const structured = P.extractStructured(text);
  const summary0 = P.suggestSummary(st.body || st.title, entities);
  // 疾病頁（取主要疾病的 v1/diseases/<slug>.json）
  const diseasePages = {};
  const pids = [...new Set([...(entities.relatedDiseaseIds ?? []).slice(0, 3)])];
  await Promise.all(pids.map(async (id) => {
    const m = (M.diseases ?? []).find((d) => d.id === id);
    if (m?.hasPage || m?.page) { const pg = await v1(`diseases/${m.slug}`, null); if (pg) diseasePages[id] = pg; }
  }));
  const checks = P.consistencyChecks({ text, entities, structured, diseaseMaster: M.diseases, diseasePages, documents: M.documents, basedOn: st.basedOn, vaccinesMaster: M.vaccines, type: st.type });
  const locked = P.lockedTerms(text, M.glossary);
  A = { entities, structured, summary0, checks, locked, M, text };
  // 預設勾選：已對應與主題詞勾選、未對應詞不勾
  if (!silent || !Object.keys(sel.chips).length) {
    sel.chips = {}; for (const m of entities.mapped) sel.chips[chipKey(m)] = true; for (const u of entities.unmapped) sel.chips[`u:${u.term}`] = false;
    sel.st = {}; for (const s of structured) sel.st[s.key] = true;
    sel.summary = summary0;
  } else {
    // 還原草稿：沿用使用者先前的選擇，新出現者用預設
    for (const m of entities.mapped) sel.chips[chipKey(m)] ??= true; for (const u of entities.unmapped) sel.chips[`u:${u.term}`] ??= false;
    for (const s of structured) sel.st[s.key] ??= true;
    sel.summary ||= summary0;
  }
  if (!silent) { sel.stage = sel.stage === 'submitted' ? 'pre' : 'pre'; sel.ack = false; }
  autoId();
  const secs = ((performance.now() - t0) / 1000);
  secEl.textContent = silent ? '已還原上次草稿' : `完成於送出後 ${secs < 0.05 ? '< 0.1' : secs.toFixed(1)} 秒`;
  paintResult();
  resultEl.setAttribute('aria-busy', 'false');
  saveDraft(false);
  if (!silent) resultEl.focus?.();
}
const chipKey = (m) => `${m.kind}:${m.id ?? m.label}`;

// ---------- 渲染結果 ----------
function derive() {
  const kw = new Set(); const dis = new Set(), vac = new Set(), cty = new Set();
  if (A) {
    for (const m of A.entities.mapped) if (sel.chips[chipKey(m)]) {
      kw.add(m.label);
      if (m.kind === 'disease') dis.add(m.id); if (m.kind === 'vaccine') vac.add(m.id); if (m.kind === 'country') cty.add(m.id);
    }
    for (const u of A.entities.unmapped) if (sel.chips[`u:${u.term}`]) kw.add(u.term);
  }
  for (const k of sel.manual) kw.add(k);
  const f = readForm();
  if (f.type === 'disease' && f.extra.disease) dis.add(f.extra.disease);
  if (f.type === 'vaccine' && f.extra.vaccine) vac.add(f.extra.vaccine);
  const structured = {};
  for (const s of A?.structured ?? []) if (sel.st[s.key]) structured[s.key] = s.value;
  return { keywords: [...kw], diseases: [...dis], vaccines: [...vac], countries: [...cty], structured };
}
function exportObj() {
  const f = readForm();
  const dv = derive();
  const dm = (D.diseaseMaster ?? []).find((d) => d.id === f.extra.disease);
  const vm = (D.vaccinesMaster ?? []).find((v) => v.id === f.extra.vaccine);
  const extra = { ...f.extra, ...(f.type === 'disease' && dm ? { slug: dm.slug, nameEn: dm.nameEn, legalCategory: dm.legalCategory } : {}), ...(f.type === 'vaccine' && vm ? { slug: vm.slug, nameEn: vm.nameEn } : {}) };
  return P.buildExport({
    type: f.type, id: f.id, title: f.title, body: f.body, owner: f.owner, steward: `${unitLabel(f.owner) || ''}承辦人`, reviewPeriodMonths: f.period === '' ? 0 : f.period,
    audience: f.audience, tasks: f.tasks, basedOn: f.basedOn, langs: f.langs, summary: sel.summary, keywords: dv.keywords, diseases: dv.diseases, vaccines: dv.vaccines, countries: dv.countries,
    structured: dv.structured, extra, today: D.today, submitted: sel.stage === 'submitted',
  });
}
function langIssues() {
  const def = new Set(P.defaultsFor(val('#f-type')).langs);
  return P.LANGS.filter((l) => l.code !== 'zh-TW' && def.has(l.code) && !$(`input[name="lang"][value="${l.code}"]`).checked && !($(`input[data-reason="${l.code}"]`).value.trim())).map((l) => `${l.label} 取消提供但未填理由`);
}

function paintResult() {
  if (!A) return;
  const f = readForm();
  const { entities, structured, checks, locked } = A;
  const errs = checks.filter((c) => c.level === 'error'), warns = checks.filter((c) => c.level === 'warn'), oks = checks.filter((c) => c.level === 'ok');
  const chip = (m) => `<li><label class="adm-chip${m.kind === 'topic' ? ' adm-chip--plain' : ''}"><input type="checkbox" data-chip="${esc(chipKey(m))}" ${sel.chips[chipKey(m)] ? 'checked' : ''}> ${esc(m.label)}${m.id && m.kind !== 'term' ? ` · <code>${esc(m.id)}</code>` : ''}${m.via?.length ? `<span class="adm-muted">（文中寫作「${esc(m.via.join('、'))}」）</span>` : ''}${m.locked ? '<span class="adm-badge adm-badge--info" title="詞彙主檔鎖定詞：機器翻譯不得自由翻譯">鎖定</span>' : ''}</label></li>`;
  const unm = (u) => `<li><label class="adm-chip adm-chip--warn"><input type="checkbox" data-chip="u:${esc(u.term)}" ${sel.chips[`u:${u.term}`] ? 'checked' : ''}> 『${esc(u.term)}』未在主檔 → 建議新增別名／詞彙<span class="adm-muted">（${esc(u.reason.join('、'))}）</span></label> <a class="adm-muted" href="${url('/admin/glossary/')}?new=${encodeURIComponent(u.term)}">加到詞彙主檔</a></li>`;
  const dep = entities.deprecated.map((d) => `<li><span class="adm-chip adm-chip--warn">『${esc(d.term)}』為停用舊名 → 請改用『${esc(d.preferred)}』</span></li>`).join('');
  const key = store.raw('cdc.llmKey');
  const rows = P.LANGS.filter((l) => l.code !== 'zh-TW').map((l) => {
    const want = f.langs[l.code]?.on;
    const termsTxt = locked.length ? locked.map((t) => `<span class="adm-chip adm-chip--plain">${esc(t.zh)} → ${esc(t.tr[l.code] || '（主檔缺此語）')}</span>`).join(' ') : '<span class="adm-muted">本文未命中鎖定詞</span>';
    const draft = llmDrafts[l.code];
    const stat = !want ? `<span class="adm-badge adm-badge--gray">不提供</span> <span class="adm-muted">${esc(f.langs[l.code]?.reason || '')}</span>` : draft?.text ? `<span class="adm-badge adm-badge--warn">機器初稿（待複核）</span><details><summary>檢視初稿</summary><div class="adm-muted" style="white-space:pre-wrap">${esc(draft.text)}</div></details>` : draft?.error ? `<span class="adm-badge adm-badge--bad">產生失敗</span> <span class="adm-muted">${esc(draft.error)}</span>` : `待產生（需啟用 LLM 模式）${key ? ` <button type="button" class="adm-btn adm-btn--ghost adm-btn--sm" data-llm="${l.code}">以 LLM 產生</button>` : ''}`;
    return `<tr><td>${esc(l.label)}</td><td>${stat}</td><td>${termsTxt}</td><td>${want ? esc(P.reviewRule(f.type)) : '—'}</td></tr>`;
  }).join('');
  const dv = derive();
  const obj = exportObj();
  const miss = [...P.requiredCheck(obj, (D.units ?? []).map((u) => u.id)), ...langIssues()];
  const steps = [['承辦人確認預處理', '本頁'], ['公關室內容審核', '內容、用語、標示'], ['多語審核', '一級簽約審核／二級抽審'], ['發布', '七語頁面、索引、API 同步']];
  const stage = sel.stage === 'submitted' ? 2 : 1;
  resultEl.innerHTML = `
  <section aria-labelledby="r-a"><h3 id="r-a">(a) 關鍵字與實體（已對應主檔）</h3>
    <ul class="adm-chips">${entities.mapped.map(chip).join('') || '<li class="adm-muted">未找到可對應主檔的詞</li>'}</ul>
    ${entities.unmapped.length || dep ? `<h4 class="adm-muted" style="margin:10px 0 4px">未對應詞與停用詞</h4><ul class="adm-chips">${entities.unmapped.map(unm).join('')}${dep}</ul>` : ''}
    <div class="adm-row" style="margin-top:8px"><div class="adm-field" style="flex:1 1 200px"><label for="kw-add" class="adm-muted">手動新增關鍵字</label><input type="text" id="kw-add" placeholder="輸入後按 Enter"></div><button type="button" class="adm-btn adm-btn--ghost adm-btn--sm" id="kw-add-btn">加入</button></div>
    <ul class="adm-chips" id="kw-manual">${sel.manual.map((k, i) => `<li class="adm-chip">${esc(k)}<button type="button" data-kwrm="${i}" aria-label="移除 ${esc(k)}">×</button></li>`).join('')}</ul>
    <p class="adm-muted">勾選者會寫入 content JSON 的 <code>keywords</code>／<code>diseases</code>／<code>vaccines</code>／<code>countries</code>（目前 ${dv.keywords.length} 個關鍵字）。</p></section>
  <section aria-labelledby="r-b"><h3 id="r-b">(b) 摘要與 meta description 建議</h3>
    <div class="adm-field"><label for="sum" class="adm-muted">抽取式（第一句或最高資訊密度句），可編輯</label><textarea id="sum" rows="3" style="min-height:70px">${esc(sel.summary)}</textarea><span class="adm-counter ${sel.summary.length > 120 ? 'adm-counter--over' : ''}" id="sum-count">${sel.summary.length} / 120 字</span></div>
    <button type="button" class="adm-btn adm-btn--ghost adm-btn--sm" id="sum-reset">重新擬摘要</button></section>
  <section aria-labelledby="r-c"><h3 id="r-c">(c) 結構化欄位建議</h3>
    ${structured.length ? `<ul class="adm-kv">${structured.map((s) => `<li><label><input type="checkbox" data-st="${esc(s.key)}" ${sel.st[s.key] ? 'checked' : ''}> <span>${esc(s.label)}：<code>${esc(s.value)}</code> <span class="adm-muted">原文「${esc(s.evidence)}」→ <code>structured.${esc(s.key)}</code></span></span></label></li>`).join('')}</ul>` : '<p class="adm-muted">內文未找到可抽出的數字欄位（潛伏期、時限、年份、劑數、年齡）。</p>'}</section>
  <section aria-labelledby="r-d"><h3 id="r-d">(d) 一致性檢查</h3>
    ${errs.map((c) => `<div class="adm-box adm-box--err" role="alert"><strong>${esc(c.title)}</strong>${esc(c.message)}</div>`).join('')}
    ${warns.map((c) => `<div class="adm-box adm-box--warn"><strong>${esc(c.title)}</strong>${esc(c.message)}</div>`).join('')}
    ${!errs.length && !warns.length ? '<div class="adm-box adm-box--ok"><strong>未發現與主檔或現行版衝突</strong>仍請承辦人通讀確認。</div>' : ''}
    ${oks.length ? `<details class="adm-details"><summary>已比對且一致（${oks.length}）</summary>${oks.map((c) => `<div class="adm-box adm-box--ok"><strong>${esc(c.title)}</strong>${esc(c.message)}</div>`).join('')}</details>` : ''}</section>
  <section aria-labelledby="r-e"><h3 id="r-e">(e) 多語初稿</h3>
    <div class="adm-tablewrap"><table class="adm-table"><thead><tr><th>語言</th><th>初稿狀態</th><th>術語鎖定（詞彙主檔 locked）</th><th>複核規則</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="adm-muted">鎖定詞不得由機器自由翻譯，一律替換為主檔譯名。${key ? '偵測到本機 BYOK 金鑰，可由 LLM 模式產生初稿。' : '無 LLM 時只列出會鎖定的詞；初稿待啟用 LLM 模式（/ask/ 右上「進階」輸入自己的 key）後產生。'}</p></section>
  <section aria-labelledby="r-f"><h3 id="r-f">(f) 送複核</h3>
    <ol class="adm-steps">${steps.map(([a, b], i) => `<li class="${i < stage - 1 ? 'is-done' : i === stage - 1 ? 'is-now' : 'is-wait'}">${a}<small>${b}</small></li>`).join('')}</ol>
    ${miss.length ? `<div class="adm-box adm-box--warn" id="miss-box"><strong>送複核前仍需補齊</strong>${miss.map(esc).join('；')}</div>` : '<div class="adm-box adm-box--ok"><strong>必填欄位已齊</strong>正式驗證在 CI 的 JSON Schema。</div>'}
    <div id="ack-box"></div>
    <div class="adm-actions"><button type="button" class="adm-btn" id="btn-confirm" ${sel.stage === 'submitted' ? 'disabled' : ''}>確認並送複核</button><button type="button" class="adm-btn adm-btn--ghost" id="btn-return">退回修改</button>${sel.stage === 'submitted' ? `<a class="adm-btn adm-btn--ghost" href="${url('/admin/review/')}">前往複核區</a>` : ''}</div>
    <p class="adm-muted" id="submit-msg" role="status" aria-live="polite">${sel.stage === 'submitted' ? '已送複核（示範）：已加入本機複核佇列，狀態為第 2 步「公關室內容審核」。' : ''}</p></section>
  <section aria-labelledby="r-g"><h3 id="r-g">(g) 匯出 content JSON</h3>
    <p class="adm-muted">建議放入 <code>${esc(pathFor(obj))}</code>。正式環境：此檔進入 content/ 並開 Pull Request，CI 驗證 schema、治理規則與評估集後合併即發布。</p>
    <pre class="adm-pre" id="exp-pre" tabindex="0">${esc(JSON.stringify(obj, null, 2))}</pre>
    <div class="adm-actions"><button type="button" class="adm-btn" id="btn-dl">下載 .json</button><button type="button" class="adm-btn adm-btn--ghost" id="btn-copy">複製</button></div></section>`;
}
const DIRS = { faq: 'faq', disease: 'diseases', news: 'news', letter: 'news', document: 'documents', clarification: 'clarifications', vaccine: 'vaccines' };
function pathFor(o) {
  const rest = String(o.id ?? '').replace(/^[a-z]+\./, '') || 'new';
  return `content/${DIRS[$('#f-type').value] ?? 'faq'}/${rest}.json`;
}

// ---------- 事件 ----------
form.addEventListener('submit', (e) => { e.preventDefault(); if (!val('#f-body').trim() && !val('#f-title').trim()) { statusEl.textContent = '請先填寫標題或內文。'; $('#f-title').focus(); return; } statusEl.textContent = ''; runPreprocess(); });
$('#btn-save').addEventListener('click', () => saveDraft(true));
$('#btn-clear').addEventListener('click', () => {
  store.del(KEY); sel = { chips: {}, manual: [], summary: '', st: {}, ack: false, stage: 'edit' }; A = null; llmDrafts = {}; idTouched = false;
  writeForm({ type: 'faq', owner: getUnit() === 'all' ? undefined : getUnit(), audience: ['public'] }); applyTypeUI(true);
  resultEl.innerHTML = '<p class="adm-muted">已清空。</p>'; secEl.textContent = '尚未送出'; statusEl.textContent = '已清空草稿。';
});
$('#btn-sample').addEventListener('click', () => {
  writeForm({
    type: 'faq', title: '登革熱發燒後幾天內要就醫？', owner: 'unit.acute-infectious', audience: ['public'], tasks: ['symptoms', 'travel'], basedOn: ['disease.dengue'],
    body: '感染登革病毒後潛伏期約 3 至 14 天。出現發燒且有登革熱流行地區旅遊史或居住史者，應於 24 小時內就醫並主動告知醫師。退燒後 1 至 2 天是出現警示徵象的高風險期，若有持續嘔吐、腹痛、出血、嗜睡等情形應立即回診。\n\n登革出血熱屬於較嚴重的表現，須儘速住院觀察。屈公病的症狀與登革熱相似，屈公病疑似病例應於 24 小時內通報衛生局。',
  });
  idTouched = false; applyTypeUI(true); fillSupersedes(); autoId();
  statusEl.textContent = '已載入範例，按「送出預處理」。';
});
form.addEventListener('input', (e) => {
  if (e.target.id === 'f-body') $('#f-body-count').textContent = `${e.target.value.length} 字`;
  if (e.target.id === 'f-id') idTouched = !!e.target.value.trim();
  if (e.target.id === 'x-family') fillSupersedes();
  if (['f-title', 'x-family', 'x-effective', 'x-disease', 'x-vaccine'].includes(e.target.id)) autoId();
  autosave();
});
form.addEventListener('change', (e) => {
  if (e.target.id === 'f-type') applyTypeUI(true);
  if (e.target.name === 'lang') paintLangReasons();
  if (e.target.id === 'x-disease' && e.target.value) { const d = D.diseaseMaster.find((x) => x.id === e.target.value); if (d && !val('#f-title')) $('#f-title').value = d.name; }
  autosave();
  if (A) paintResultKeepFocus();
});
function paintResultKeepFocus() { const id = document.activeElement?.id; paintResult(); if (id) document.getElementById(id)?.focus?.(); }
$('#f-based-q').addEventListener('input', (e) => searchBased(e.target.value));
$('#f-based-q').addEventListener('keydown', (e) => { if (e.key === 'Escape') { $('#f-based-list').hidden = true; } if (e.key === 'ArrowDown') $('#f-based-list button')?.focus(); });
$('#f-based-list').addEventListener('click', (e) => { const b = e.target.closest('[data-add]'); if (!b) return; basedOn.push(b.dataset.add); paintBased(); $('#f-based-q').value = ''; $('#f-based-list').hidden = true; $('#f-based-q').focus(); autosave(); });
$('#f-based-chips').addEventListener('click', (e) => { const b = e.target.closest('[data-rm]'); if (!b) return; basedOn.splice(Number(b.dataset.rm), 1); paintBased(); autosave(); });

resultEl.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.chip) sel.chips[t.dataset.chip] = t.checked;
  else if (t.dataset.st) sel.st[t.dataset.st] = t.checked;
  else return;
  refreshExport(); autosave();
});
resultEl.addEventListener('input', (e) => {
  if (e.target.id === 'sum') { sel.summary = e.target.value; const c = $('#sum-count'); c.textContent = `${sel.summary.length} / 120 字`; c.classList.toggle('adm-counter--over', sel.summary.length > 120); refreshExport(); autosave(); }
});
resultEl.addEventListener('keydown', (e) => { if (e.target.id === 'kw-add' && e.key === 'Enter') { e.preventDefault(); addKw(); } });
function addKw() { const i = $('#kw-add'); const v = i.value.trim(); if (v && !sel.manual.includes(v)) { sel.manual.push(v); paintResult(); $('#kw-add')?.focus(); autosave(); } }
function refreshExport() {
  const obj = exportObj();
  const pre = $('#exp-pre'); if (pre) pre.textContent = JSON.stringify(obj, null, 2);
  const miss = [...P.requiredCheck(obj, (D.units ?? []).map((u) => u.id)), ...langIssues()];
  const mb = $('#miss-box'); if (mb && !miss.length) paintResult();
}
resultEl.addEventListener('click', async (e) => {
  const t = e.target.closest('button'); if (!t) return;
  if (t.id === 'kw-add-btn') addKw();
  else if (t.dataset.kwrm) { sel.manual.splice(Number(t.dataset.kwrm), 1); paintResult(); autosave(); }
  else if (t.id === 'sum-reset') { sel.summary = A.summary0; paintResult(); autosave(); }
  else if (t.id === 'btn-dl') { const o = exportObj(); downloadText(`${String(o.id).replace(/[^a-z0-9.-]/gi, '_')}.json`, `${JSON.stringify(o, null, 2)}\n`); }
  else if (t.id === 'btn-copy') copyText(`${JSON.stringify(exportObj(), null, 2)}\n`, t);
  else if (t.id === 'btn-return') { sel.stage = 'edit'; $('#submit-msg').textContent = '已退回修改：請在左側調整內文後重新「送出預處理」。'; $('#f-title').focus(); saveDraft(false); }
  else if (t.id === 'btn-confirm') confirmSubmit();
  else if (t.dataset.llm) llmOne(t.dataset.llm);
});

function confirmSubmit() {
  const obj = exportObj();
  const miss = [...P.requiredCheck(obj, (D.units ?? []).map((u) => u.id)), ...langIssues()];
  const msg = $('#submit-msg');
  if (miss.length) { msg.textContent = `無法送複核，請先補齊：${miss.join('；')}`; msg.className = 'adm-red'; return; }
  const reds = A.checks.filter((c) => c.level === 'error').length;
  if (reds && !sel.ack) {
    sel.ack = true; $('#btn-confirm').textContent = '仍要送複核（已知有紅框）';
    msg.className = 'adm-red'; msg.textContent = `一致性檢查仍有 ${reds} 項紅框（例如依據正本失效或與現行版矛盾）。建議先修正；若確認要送，再按一次。`; return;
  }
  sel.stage = 'submitted'; sel.ack = false;
  const queue = store.get('cdc.admin.queue', []) ?? [];
  const entry = { id: obj.id, type: obj.type, title: obj.title, owner: obj.owner, ownerName: unitLabel(obj.owner), step: 2, submittedAt: new Date().toISOString(), languages: Object.fromEntries(Object.entries(obj.languages).map(([k, v]) => [k, v.status])), reds, tier1: P.TIER1.includes(obj.type), json: obj };
  const i = queue.findIndex((q) => q.id === entry.id);
  if (i >= 0) queue[i] = entry; else queue.push(entry);
  store.set('cdc.admin.queue', queue);
  const acts = store.get('cdc.admin.reviewActions', {}) ?? {}; delete acts[entry.id]; store.set('cdc.admin.reviewActions', acts);
  document.dispatchEvent(new CustomEvent('adm:queue'));
  paintResult(); saveDraft(false);
  $('#submit-msg')?.focus?.();
}

async function llmOne(lang) {
  const f = readForm();
  llmDrafts[lang] = { pending: true };
  try {
    const mod = await import(url('/assets/js/answer/llm.js'));
    const key = store.raw('cdc.llmKey');
    if (typeof mod.translateWithGlossary === 'function') {
      // 約定介面（若答案引擎日後提供）
      const res = await mod.translateWithGlossary({ text: `${f.title}\n\n${f.body}`, lang, glossary: A.M.glossary, apiKey: key, key });
      llmDrafts[lang] = { text: typeof res === 'string' ? res : (res?.text ?? res?.translation ?? JSON.stringify(res, null, 2)) };
    } else if (typeof mod.llmTranslate === 'function') {
      // 目前答案引擎提供的是 llmTranslate（鎖定詞先換成 placeholder，翻譯後還原為主檔譯名；譯文數字必須與原文一致）
      const sentences = P.splitSentences(`${f.title}。${f.body}`).map((t, i) => ({ text: t, cite: [`draft#${i}`] }));
      const res = await mod.llmTranslate({ sentences }, { lang, glossary: A.M.glossary });
      if (res?.llmError) throw new Error(res.llmError.message || res.llmError.kind);
      llmDrafts[lang] = { text: (res?.sentences ?? []).map((s) => (s.translationDropped ? `【數字不符，請人工翻譯】${s.original}` : s.text)).join('\n') };
    } else { llmDrafts[lang] = { error: '答案引擎尚未提供翻譯函式（略過）' }; }
  } catch (err) { llmDrafts[lang] = { error: String(err?.message ?? err).slice(0, 120) }; }
  paintResultKeepFocus();
}

// ---------- 啟動 ----------
(function init() {
  fillSupersedes();
  const u = getUnit();
  const saved = store.get(KEY);
  if (saved && (saved.title || saved.body)) {
    if (saved.derived) sel = { ...sel, ...saved.derived };
    writeForm(saved);
    statusEl.textContent = `已還原上次草稿（${saved.savedAt ? new Date(saved.savedAt).toLocaleString('zh-TW', { hour12: false }) : ''}）`;
    if (sel.stage !== 'edit' || (saved.derived && Object.keys(saved.derived.chips ?? {}).length)) runPreprocess({ silent: true });
  } else {
    writeForm({ type: 'faq', owner: u !== 'all' ? u : undefined, audience: ['public'] });
    applyTypeUI(true);
  }
  document.addEventListener('adm:unit', () => { if (!val('#f-title') && !val('#f-body') && getUnit() !== 'all') $('#f-owner').value = getUnit(); });
  window.__admPublish = { runPreprocess, exportObj, get state() { return { sel, A }; } }; // 供自動化測試
})();
void normPath; void today;
