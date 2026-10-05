// /admin/publish/ 互動：表單 ↔ localStorage(cdc.admin.draft) ↔ 預處理（preprocess.js）↔ 匯出 / 送複核。
import { $, $$, esc, store, v1, url, readEmbedded, today, downloadText, copyText, debounce, getUnit, unitLabel, normPath } from './common.js';
import * as P from './preprocess.js';
import { initEditor } from './editor.js';
import { initAssets } from './assets-panel.js';
import { zipBlob } from './zip-store.js';

const D = readEmbedded('adm-publish-data', {});
const KEY = 'cdc.admin.draft';
const form = $('#pub-form');
const resultEl = $('#pre-result');
const secEl = $('#pre-sec');
const statusEl = $('#f-status');
const typeLabel = (t) => P.TYPES.find((x) => x.value === t)?.label ?? t;

let basedOn = [];
let contentIds = []; // 專區：相關內容 id
let datasetIds = []; // 研究：資料集 id
let idTouched = false;
let A = null; // 最近一次預處理結果 {entities, structured, summary0, checks, locked, lex}
let sel = { chips: {}, manual: [], summary: '', st: {}, ack: false, stage: 'edit' };
let llmDrafts = {};
let ED = null; // 內文編輯器（editor.js）
let ASSETS = null; // 附件與圖片面板（assets-panel.js）
let lastId = ''; // 內容 ID 變動時，內文裡的 /files/{舊id}/ 引用跟著改
const LIMITS = P.normalizeLimits(window.CDC_ASSETS_LIMITS ?? D.assetsLimits);
const LANES = P.normalizeLanes(D.lanes); // 發布車道（建置時內嵌 content/governance/lanes.json；缺檔用契約預設）
let simShown = false; // 已按過「模擬送出」：重繪結果時一併重畫時間軸
let editing = null; // 修改已上架內容：{ id, original }（?edit={id}；匯出時以 P.mergeEdit 帶回表單沒有的欄位）

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
  ED?.flush();
  const type = val('#f-type');
  return {
    type, title: val('#f-title').trim(), body: val('#f-body'), assets: ASSETS?.meta() ?? [], owner: val('#f-owner'), period: val('#f-period'),
    audience: $$('input[name="audience"]:checked').map((x) => x.value), tasks: $$('input[name="tasks"]:checked').map((x) => x.value),
    basedOn: [...basedOn], langs: langState(), id: val('#f-id').trim(), idTouched,
    publishAtLocal: val('#f-publish-at'), publishAt: P.toPublishAtIso(val('#f-publish-at')), urgent: $('#f-urgent').checked,
    extra: {
      family: val('#x-family').trim(), docType: val('#x-doctype'), version: val('#x-version').trim(), effectiveAt: val('#x-effective'), supersedes: val('#x-supersedes'),
      letterNo: val('#x-letterno').trim(), claim: val('#x-claim').trim(), verdict: val('#x-verdict'), shareText: val('#x-share').trim(), disease: val('#x-disease'), vaccine: val('#x-vaccine'),
      // 影音
      mediaType: val('#x-mediatype'), youtube: val('#x-ytid').trim(), producedAt: val('#x-produced'), versionLabel: val('#x-vlabel').trim(), chapters: val('#x-chapters'), transcript: val('#x-transcript'),
      captions: $$('input[name="captions"]:checked').map((x) => x.value),
      // 專區
      topicKind: val('#x-topickind'), startAt: val('#x-startat'), endAt: val('#x-endat'), links: val('#x-links'), contentIds: [...contentIds],
      // 申請服務
      serviceType: val('#x-servicetype'), who: $$('input[name="who"]:checked').map((x) => x.value), steps: val('#x-steps'), docs: val('#x-docs'), slaDays: val('#x-sla'), fee: val('#x-fee').trim(),
      legal: val('#x-legal'), forms: val('#x-forms'), applyUrl: val('#x-applyurl').trim(), contact: val('#x-contact').trim(),
      // 出版品
      pubType: val('#x-pubtype'), series: val('#x-series').trim(), volume: val('#x-volume').trim(), issue: val('#x-issue').trim(), edition: val('#x-edition').trim(),
      isbn: val('#x-isbn').trim(), issn: val('#x-issn').trim(), gpn: val('#x-gpn').trim(), articles: val('#x-articles'),
      // 檢驗項目
      labDisease: val('#x-labdisease'), sendHours: val('#x-sendhours'), labs: $$('input[name="labs"]:checked').map((x) => x.value), specimens: val('#x-specimens'),
      // 研究
      year: val('#x-year'), projectStatus: val('#x-projstatus'), fundingType: val('#x-funding'), projectNo: val('#x-projno').trim(), piUnit: val('#x-piunit').trim(), datasets: [...datasetIds],
      // 招募／採購
      deadlineAt: val('#x-deadline'), refNo: val('#x-refno').trim(), newsApplyUrl: val('#x-napply').trim(), positions: val('#x-positions'), budgetNtd: val('#x-budget'),
    },
  };
}
function writeForm(s) {
  $('#f-type').value = s.type ?? 'faq';
  $('#f-title').value = s.title ?? ''; $('#f-body').value = s.body ?? '';
  if (Array.isArray(s.assets)) ASSETS?.restore(s.assets);
  ED?.refresh();
  if (s.owner) $('#f-owner').value = s.owner;
  $('#f-period').value = s.period ?? P.defaultsFor($('#f-type').value).reviewPeriodMonths;
  $$('input[name="audience"]').forEach((x) => { x.checked = (s.audience ?? ['public']).includes(x.value); });
  $$('input[name="tasks"]').forEach((x) => { x.checked = (s.tasks ?? []).includes(x.value); });
  basedOn = [...(s.basedOn ?? [])]; paintBased();
  $('#f-publish-at').value = s.publishAtLocal ?? ''; $('#f-urgent').checked = s.urgent === true;
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
  $('#x-mediatype').value = ex.mediaType || 'video'; $('#x-ytid').value = ex.youtube ?? ''; $('#x-produced').value = ex.producedAt ?? ''; $('#x-vlabel').value = ex.versionLabel ?? '';
  $('#x-chapters').value = ex.chapters ?? ''; $('#x-transcript').value = ex.transcript ?? ''; $('#x-transcript-count').textContent = `${(ex.transcript ?? '').length} 字`;
  $$('input[name="captions"]').forEach((x) => { x.checked = (ex.captions ?? []).includes(x.value); });
  $('#x-topickind').value = ex.topicKind || 'campaign'; $('#x-startat').value = ex.startAt ?? ''; $('#x-endat').value = ex.endAt ?? ''; $('#x-links').value = ex.links ?? '';
  contentIds = [...(ex.contentIds ?? [])]; paintChips('#x-content-chips', contentIds);
  $('#x-servicetype').value = ex.serviceType || 'data-request'; $$('input[name="who"]').forEach((x) => { x.checked = (ex.who ?? []).includes(x.value); });
  $('#x-steps').value = ex.steps ?? ''; $('#x-docs').value = ex.docs ?? ''; $('#x-sla').value = ex.slaDays ?? ''; $('#x-fee').value = ex.fee ?? ''; $('#x-legal').value = ex.legal ?? '';
  $('#x-forms').value = ex.forms ?? ''; $('#x-applyurl').value = ex.applyUrl ?? ''; $('#x-contact').value = ex.contact ?? '';
  $('#x-pubtype').value = ex.pubType || 'bulletin'; $('#x-series').value = ex.series ?? ''; $('#x-volume').value = ex.volume ?? ''; $('#x-issue').value = ex.issue ?? ''; $('#x-edition').value = ex.edition ?? '';
  $('#x-isbn').value = ex.isbn ?? ''; $('#x-issn').value = ex.issn ?? ''; $('#x-gpn').value = ex.gpn ?? ''; $('#x-articles').value = ex.articles ?? '';
  $('#x-labdisease').value = ex.labDisease ?? ''; $('#x-sendhours').value = ex.sendHours ?? ''; $$('input[name="labs"]').forEach((x) => { x.checked = (ex.labs ?? []).includes(x.value); }); $('#x-specimens').value = ex.specimens ?? '';
  $('#x-year').value = ex.year ?? ''; $('#x-projstatus').value = ex.projectStatus || 'ongoing'; $('#x-funding').value = ex.fundingType ?? ''; $('#x-projno').value = ex.projectNo ?? ''; $('#x-piunit').value = ex.piUnit ?? '';
  datasetIds = [...(ex.datasets ?? [])]; paintChips('#x-ds-chips', datasetIds);
  $('#x-deadline').value = ex.deadlineAt ?? ''; $('#x-refno').value = ex.refNo ?? ''; $('#x-napply').value = ex.newsApplyUrl ?? ''; $('#x-positions').value = ex.positions ?? ''; $('#x-budget').value = ex.budgetNtd ?? '';
  $('#f-id').value = s.id ?? ''; idTouched = !!s.idTouched; lastId = $('#f-id').value.trim();
  $('#f-body-count').textContent = `${(s.body ?? '').length} 字`;
}

// ---------- 型別連動 ----------
function applyTypeUI(resetDefaults = true) {
  const type = val('#f-type');
  $('[data-pub-title]').textContent = `${editing ? '修改已上架：' : '上架：'}${type === 'faq' ? '疾病 Q&A' : typeLabel(type)}`;
  const role = P.BODY_ROLE[type];
  $('#f-body-label').textContent = role ? role.label : '內文（中文正本）';
  $('#f-based-req').hidden = type !== 'media';
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
  $$('[data-for]', extra).forEach((el) => { const on = el.dataset.for.split(' ').includes(type); el.hidden = !on; any ||= on; });
  extra.hidden = !any;
  // 發布車道：urgent 只對允許型別顯示；換成不允許的型別就取消勾選並說明
  const ua = P.urgentAllowed(type, LANES);
  $('#f-urgent-wrap').hidden = !ua;
  if (!ua && $('#f-urgent').checked) { $('#f-urgent').checked = false; statusEl.textContent = '已取消「緊急發布」：只有新聞稿、致醫界通函、澄清可以用。'; }
  paintLane();
  if (resetDefaults) autoId();
}
/** 車道徽章與一句說明（隨型別、urgent、publishAt 即時更新），並顯示 urgent／publishAt 的預檢。 */
function paintLane() {
  const f = readForm();
  const lane = P.laneOf(f.type, f.urgent, LANES);
  const box = $('#lane-box');
  box.dataset.lane = lane.id;
  $('#lane-badge').textContent = lane.label;
  const at = P.publishAtMs(f.publishAt);
  $('#lane-text').textContent = `${P.laneSentence(lane, f.type, D.unitNames)}${Number.isFinite(at) ? `；排程 ${P.fmtTaipei(at)} 後上線` : ''}`;
  $('#f-timing-msgs').innerHTML = P.laneChecks(f, Date.now(), LANES).map((c) => `<li class="${c.level === 'error' ? 'adm-red' : 'adm-yellow'}">${esc(c.title)}：${esc(c.message)}</li>`).join('');
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
/** 內容 ID 變動：內文裡的 /files/{舊id}/… 引用同步改成新 id（附件路徑以 id 為資料夾） */
function setIdValue(v) {
  const el = $('#f-id');
  const old = lastId;
  el.value = v;
  const now = v.trim();
  if (old && now && old !== now) rewriteBody((b) => b.split(`/files/${old}/`).join(`/files/${now}/`));
  lastId = now;
}
function rewriteBody(fn) {
  ED?.flush();
  const ta = $('#f-body');
  const next = fn(ta.value);
  if (next === ta.value) return;
  ta.value = next;
  $('#f-body-count').textContent = `${next.length} 字`;
  ED?.refresh();
}
function autoId() {
  if (idTouched) return;
  const type = val('#f-type');
  const ex = readForm().extra;
  const dm = (D.diseaseMaster ?? []).find((d) => d.id === ex.disease);
  const vm = (D.vaccinesMaster ?? []).find((v) => v.id === ex.vaccine);
  const labD = (D.diseaseMaster ?? []).find((d) => d.id === ex.labDisease);
  const dslug = type === 'labtest' ? labD?.slug : A?.entities?.diseaseIds?.[0] ? (D.diseaseMaster ?? []).find((d) => d.id === A.entities.diseaseIds[0])?.slug : '';
  setIdValue(P.suggestId(type, { title: val('#f-title'), today: D.today, slug: type === 'disease' ? dm?.slug : type === 'vaccine' ? vm?.slug : dslug, family: ex.family, version: ex.effectiveAt }));
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

// 通用 combobox 選擇器（專區相關內容、研究資料集）：選到的 id 以 chips 呈現
function paintChips(sel, arr) {
  $(sel).innerHTML = arr.map((id, i) => `<li class="adm-chip">${esc(id)}<button type="button" data-prm="${i}" aria-label="移除 ${esc(id)}">×</button></li>`).join('');
}
function picker({ q, list, chips, arr, filter }) {
  const input = $(q), ul = $(list);
  input.addEventListener('input', () => {
    const v = input.value.trim().toLowerCase();
    if (!v) { ul.hidden = true; input.setAttribute('aria-expanded', 'false'); return; }
    const items = (D.catalog ?? []).filter(filter).filter((c) => !arr().includes(c.id) && (c.id.toLowerCase().includes(v) || c.title.toLowerCase().includes(v))).slice(0, 8);
    ul.innerHTML = items.length ? items.map((c) => `<li role="option"><button type="button" data-padd="${esc(c.id)}"><code>${esc(c.id)}</code>　${esc(c.title)}</button></li>`).join('') : '<li class="adm-muted" style="padding:6px 10px">沒有符合的內容</li>';
    ul.hidden = false; input.setAttribute('aria-expanded', 'true');
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape') ul.hidden = true; if (e.key === 'ArrowDown') $('button', ul)?.focus(); });
  ul.addEventListener('click', (e) => { const b = e.target.closest('[data-padd]'); if (!b) return; arr().push(b.dataset.padd); paintChips(chips, arr()); input.value = ''; ul.hidden = true; input.setAttribute('aria-expanded', 'false'); input.focus(); autosave(); if (A) paintResultKeepFocus(); });
  $(chips).addEventListener('click', (e) => { const b = e.target.closest('[data-prm]'); if (!b) return; arr().splice(Number(b.dataset.prm), 1); paintChips(chips, arr()); autosave(); });
}
picker({ q: '#x-content-q', list: '#x-content-list', chips: '#x-content-chips', arr: () => contentIds, filter: (c) => !['banner'].includes(c.type) });
picker({ q: '#x-ds-q', list: '#x-ds-list', chips: '#x-ds-chips', arr: () => datasetIds, filter: (c) => c.type === 'dataset' });

/** 影音：依據正本選定後，依據版本標示留空就帶入現行版次（可改）。 */
function fillVersionLabel() {
  if (val('#f-type') !== 'media' || val('#x-vlabel')) return;
  const b = P.resolveBasis(basedOn, D.families)[0];
  if (b?.current?.version) $('#x-vlabel').value = `${b.current.version} 建議`;
}

// ---------- 草稿 ----------
function saveDraft(msg) {
  const d = { ...readForm(), derived: sel, savedAt: new Date().toISOString() };
  store.set(KEY, d);
  if (msg) { statusEl.textContent = `已儲存草稿（${new Date().toLocaleTimeString('zh-TW', { hour12: false })}，僅存本機瀏覽器）`; }
}
const autosave = debounce(() => saveDraft(false), 400);

// ---------- 型別專屬：預處理文字與檢查 ----------
/** 送進實體抽取／一致性檢查的文字：標題＋內文＋該型別的文字欄位（影音＝逐字稿）。 */
function analysisText(st) {
  const ex = st.extra;
  const more = { media: [ex.transcript], service: [ex.steps, ex.docs, ex.legal], labtest: [ex.specimens], publication: [ex.articles], topic: [], research: [] }[st.type] ?? [];
  return [st.title, st.body, ...more].filter(Boolean).join('\n');
}
/** 每次重繪都重算的型別檢查（便宜且確定；改欄位立即反映）。 */
function typeChecks(f) {
  const ex = f.extra;
  if (f.type === 'media') return P.mediaChecks({ transcript: ex.transcript, producedAt: ex.producedAt, basedOn: f.basedOn, label: ex.versionLabel, youtube: ex.youtube, chapters: ex.chapters, captions: ex.captions }, D.families);
  if (f.type === 'labtest') return P.labtestChecks({ disease: ex.labDisease, specimens: ex.specimens, sendWithinHours: ex.sendHours }, D.diseaseMaster);
  return P.miscChecks(f.type, ex, D.today);
}
const laneCheckList = () => P.laneChecks(readForm(), Date.now(), LANES);
const allChecks = () => [...(A?.checks ?? []), ...typeChecks(readForm()), ...P.assetWarnings(exportObj(), LIMITS), ...laneCheckList().filter((c) => c.level !== 'error').map((c) => ({ ...c, level: c.level === 'warn' ? 'warn' : 'info' }))];

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
  const isMedia = st.type === 'media';
  const text = analysisText(st);
  const spoken = isMedia ? P.spokenToDigits(text) : text; // 逐字稿口語數字（二十四小時）→ 阿拉伯數字再比對
  const M = await loadMasters();
  const lex = P.buildLexicon(M);
  const entities = P.extractEntities(text, lex);
  const structured = P.extractStructured(spoken);
  const summary0 = P.suggestSummary(isMedia ? (st.body || st.extra.transcript || st.title) : (st.body || st.title), entities);
  // 疾病頁（取主要疾病的 v1/diseases/<slug>.json）
  const diseasePages = {};
  const pids = [...new Set([...(entities.relatedDiseaseIds ?? []).slice(0, 3)])];
  await Promise.all(pids.map(async (id) => {
    const m = (M.diseases ?? []).find((d) => d.id === id);
    if (m?.hasPage || m?.page) { const pg = await v1(`diseases/${m.slug}`, null); if (pg) diseasePages[id] = pg; }
  }));
  const checks = P.consistencyChecks({
    text: spoken, entities, structured, diseaseMaster: M.diseases, diseasePages, documents: M.documents, basedOn: st.basedOn, vaccinesMaster: M.vaccines, type: st.type,
    ...(isMedia ? { auditText: P.spokenToDigits(st.extra.transcript), auditLabel: '逐字稿' } : {}),
  });
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
  if (f.type === 'labtest' && f.extra.labDisease) dis.add(f.extra.labDisease);
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
  const out = P.buildExport({
    type: f.type, id: f.id, title: f.title, body: f.body, owner: f.owner, steward: editing?.original?.steward ?? `${unitLabel(f.owner) || ''}承辦人`, reviewPeriodMonths: f.period === '' ? 0 : f.period,
    audience: f.audience, tasks: f.tasks, basedOn: f.basedOn, langs: f.langs, summary: sel.summary, keywords: dv.keywords, diseases: dv.diseases, vaccines: dv.vaccines, countries: dv.countries,
    structured: dv.structured, extra, today: D.today, submitted: sel.stage === 'submitted', publishAt: f.publishAt, urgent: f.urgent && P.urgentAllowed(f.type, LANES),
    assets: P.buildAssetsJson(ASSETS?.exportList() ?? []),
  });
  return editing?.original && editing.id === f.id ? P.mergeEdit(out, editing.original) : out;
}

// ---------- 修改已上架內容（?edit={id}）：公開頁頁尾「同事修改這頁」進來 ----------
async function fetchForEdit(id) {
  const coll = P.collectionOfId(id);
  if (!coll) return null;
  if (coll === 'diseases') {
    const list = (await v1('diseases', [])) ?? [];
    const slug = list.find((d) => d.id === id)?.path?.split('/').filter(Boolean).pop();
    return slug ? (await v1(`diseases/${slug}`, null)) : null;
  }
  const list = (await v1(coll, [])) ?? [];
  return list.find((x) => x.id === id) ?? null;
}
function paintEditBox() {
  const box = $('#edit-box');
  if (!box) return;
  if (!editing) { box.hidden = true; box.innerHTML = ''; return; }
  const o = editing.original;
  const file = `content/${P.DIRS[o.type] ?? `${o.type}s`}/${String(o.id).replace(/^[a-z]+\./, '')}.json`;
  box.hidden = false;
  box.innerHTML = `<strong>修改已上架的內容</strong>${o.path ? `<a href="${esc(url(o.path))}" target="_blank" rel="noopener">${esc(o.title ?? o.id)}</a>` : esc(o.title ?? o.id)} <code>${esc(o.id)}</code>（發布 ${esc(o.publishedAt ?? '—')}，最後審閱 ${esc(o.reviewedAt ?? '—')}）。
  表單已帶入現行版；改好後照一般流程「送出預處理」→「產生上架包」，上架包會<strong>覆寫同一個檔</strong> <code>${esc(file)}</code>，PR 只會顯示你改的那幾行。發布日不變、審閱日改為今天；白名單與舊站網址等表單沒有的欄位會原樣保留。
  <span id="edit-diff" class="adm-muted"></span> <button type="button" class="adm-btn adm-btn--ghost" id="btn-edit-cancel">取消修改（清空）</button>`;
}
function paintEditDiff() {
  const el = $('#edit-diff');
  if (!el || !editing) return;
  const changed = P.editDiff(exportObj(), editing.original).filter((k) => k !== 'assets');
  el.textContent = changed.length ? `目前改動的欄位：${changed.join('、')}` : '目前與現行版相同。';
}
async function startEdit(id) {
  statusEl.textContent = `正在載入 ${id} 的現行版…`;
  const item = await fetchForEdit(id);
  if (!item) { editing = null; statusEl.textContent = `找不到已上架內容 ${id}（只能修改已發布且在 API 裡的內容；新聞只含近 200 則）。`; writeForm({ type: 'faq', id, idTouched: true }); applyTypeUI(true); return; }
  editing = { id: item.id, original: item };
  const f = P.itemToForm(item);
  contentIds = []; datasetIds = [];
  writeForm(f);
  idTouched = true;
  applyTypeUI(false); fillSupersedes(); $('#x-supersedes').value = f.extra.supersedes ?? '';
  paintEditBox();
  statusEl.textContent = `已載入現行版 ${item.id}，請直接修改。`;
  runPreprocess({ silent: true });
  paintEditDiff();
}
function missAll(obj) {
  const gone = (ASSETS?.missingFiles() ?? []).map((f) => `檔案 ${f}：重新整理後需要重新選取`);
  const lane = laneCheckList().filter((c) => c.level === 'error').map((c) => `${c.title}（${c.message}）`);
  return [...P.requiredCheck(obj, (D.units ?? []).map((u) => u.id), { limits: LIMITS }), ...langIssues(), ...gone, ...lane];
}
function langIssues() {
  const def = new Set(P.defaultsFor(val('#f-type')).langs);
  return P.LANGS.filter((l) => l.code !== 'zh-TW' && def.has(l.code) && !$(`input[name="lang"][value="${l.code}"]`).checked && !($(`input[data-reason="${l.code}"]`).value.trim())).map((l) => `${l.label} 取消提供但未填理由`);
}

function paintResult() {
  if (!A) return;
  const f = readForm();
  const { entities, structured, locked } = A;
  const checks = allChecks();
  const errs = checks.filter((c) => c.level === 'error'), warns = checks.filter((c) => c.level === 'warn'), oks = checks.filter((c) => c.level === 'ok'), infos = checks.filter((c) => c.level === 'info');
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
  const miss = missAll(obj);
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
    ${infos.map((c) => `<div class="adm-box adm-box--info"><strong>${esc(c.title)}</strong>${esc(c.message)}</div>`).join('')}
    ${!errs.length && !warns.length ? '<div class="adm-box adm-box--ok"><strong>未發現與主檔或現行版衝突</strong>仍請承辦人通讀確認。</div>' : ''}
    ${oks.length ? `<details class="adm-details"><summary>已比對且一致（${oks.length}）</summary>${oks.map((c) => `<div class="adm-box adm-box--ok"><strong>${esc(c.title)}</strong>${esc(c.message)}</div>`).join('')}</details>` : ''}</section>
  ${typeExtraHtml(f)}
  <section aria-labelledby="r-e"><h3 id="r-e">(e) 多語初稿</h3>
    <div class="adm-tablewrap"><table class="adm-table"><thead><tr><th>語言</th><th>初稿狀態</th><th>術語鎖定（詞彙主檔 locked）</th><th>複核規則</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="adm-muted">鎖定詞不得由機器自由翻譯，一律替換為主檔譯名。${key ? '偵測到本機 BYOK 金鑰，可由 LLM 模式產生初稿。' : '無 LLM 時只列出會鎖定的詞；初稿待啟用 LLM 模式（/ask/ 右上「進階」輸入自己的 key）後產生。'}</p></section>
  <section aria-labelledby="r-f"><h3 id="r-f">(f) 送複核</h3>
    <ol class="adm-steps">${steps.map(([a, b], i) => `<li class="${i < stage - 1 ? 'is-done' : i === stage - 1 ? 'is-now' : 'is-wait'}">${a}<small>${b}</small></li>`).join('')}</ol>
    ${miss.length ? `<div class="adm-box adm-box--warn" id="miss-box"><strong>送複核前仍需補齊</strong>${miss.map(esc).join('；')}</div>` : '<div class="adm-box adm-box--ok"><strong>必填欄位已齊</strong>正式驗證在 CI 的 JSON Schema。</div>'}
    <div id="ack-box"></div>
    <div class="adm-actions"><button type="button" class="adm-btn" id="btn-confirm" ${sel.stage === 'submitted' ? 'disabled' : ''}>確認並送複核</button><button type="button" class="adm-btn adm-btn--ghost" id="btn-return">退回修改</button>${sel.stage === 'submitted' ? `<a class="adm-btn adm-btn--ghost" href="${url('/admin/review/')}">前往複核區</a>` : ''}</div>
    <p class="adm-muted" id="submit-msg" role="status" aria-live="polite">${sel.stage === 'submitted' ? '已送複核（示範）：已加入本機複核佇列，狀態為第 2 步「公關室內容審核」。' : ''}</p></section>
  <section aria-labelledby="r-g"><h3 id="r-g">(g) 產生上架包</h3>
    <p class="adm-muted">上架包 ＝ <code>${esc(pathFor(obj))}</code>${obj.assets?.length ? ` ＋ ${obj.assets.length} 個檔案（<code>content/assets/${esc(obj.id)}/</code>）` : ''}。正式環境：解壓縮到 repo 根目錄 → 開 Pull Request → CI 驗證 schema、治理規則、檔案 sha256／大小／檔名與評估集 → 合併即發布。</p>
    <div class="adm-actions" style="margin-top:0"><button type="button" class="adm-btn" id="btn-zip">產生上架包（.zip）</button><button type="button" class="adm-btn adm-btn--ghost" id="btn-sim" aria-controls="sim-out">模擬送出</button><button type="button" class="adm-btn adm-btn--ghost" id="btn-dl">只下載 JSON</button><button type="button" class="adm-btn adm-btn--ghost" id="btn-copy">複製 JSON</button></div>
    <p class="adm-muted" id="pkg-msg" role="status" aria-live="polite"></p>
    <p class="adm-muted">「模擬送出」只示範送出之後會發生的事：原型不會開 PR、不呼叫任何 API。要真的交件，請用上面的 ZIP。</p>
    <div id="sim-out" tabindex="-1" aria-live="polite">${simShown ? simHtml(obj, f.type) : ''}</div>
    <h4 class="adm-sub">放在哪裡</h4>
    <pre class="adm-pre adm-tree" id="pkg-tree" tabindex="0" aria-label="上架包的檔案放置路徑">${esc(P.renderTree(P.packagePaths(obj, f.type)))}</pre>
    <h4 class="adm-sub">怎麼交（git／Pull Request）</h4>
    <ol class="adm-sop" id="pkg-git">${gitSteps(obj)}</ol>
    <h4 class="adm-sub">content JSON 預覽</h4>
    <pre class="adm-pre" id="exp-pre" tabindex="0">${esc(JSON.stringify(obj, null, 2))}</pre></section>`;
}
// ---------- 模擬送出（只是展示；ARCHITECTURE §17.4）----------
const SIM_STATUS = { ok: ['adm-badge--ok', '完成'], wait: ['adm-badge--warn', '等待中'], fail: ['adm-badge--bad', '未通過'], skip: ['adm-badge--gray', '未執行'] };
function simHtml(obj, uiType) {
  const miss = missAll(obj);
  const assetMsgs = new Set(P.assetIssues(obj, LIMITS).filter((i) => i.level === 'error').map((i) => i.msg));
  const failures = { assets: miss.filter((m) => assetMsgs.has(m) || /^檔案 /.test(m)), schema: miss.filter((m) => !assetMsgs.has(m) && !/^檔案 /.test(m)) };
  const tl = P.submitTimeline(obj, { lanes: LANES, names: D.unitNames, miss, failures, typeLabel: typeLabel(uiType), nowMs: Date.now() });
  const li = tl.steps.map((st, i) => {
    const [cls, label] = SIM_STATUS[st.status] ?? SIM_STATUS.skip;
    const checks = st.checks ? `<ul class="adm-tl__checks">${st.checks.map((c) => `<li class="${c.ok ? 'is-ok' : 'is-no'}"><span class="adm-tick ${c.ok ? 'adm-tick--ok' : 'adm-tick--no'}">${c.ok ? '✓' : '✗'}</span> ${esc(c.label)}<span class="adm-muted">　${esc(c.note)}</span></li>`).join('')}</ul>` : '';
    const issues = st.issues?.length ? `<ul class="adm-tl__issues">${st.issues.map((m) => `<li class="adm-red">${esc(m)}</li>`).join('')}</ul>` : '';
    const laneBadge = st.lane ? ` <span class="adm-lane__badge" data-lane="${esc(st.lane)}">${esc(tl.lane.label)}</span>` : '';
    return `<li class="adm-tl is-${st.status}"><span class="adm-tl__dot" aria-hidden="true">${i + 1}</span><div class="adm-tl__body">
      <div class="adm-tl__head"><strong>${esc(st.title)}</strong>${laneBadge} <span class="adm-badge ${cls}">${label}</span> <span class="adm-tl__at">${esc(st.at)}</span></div>
      ${st.detail.map((d) => `<p>${esc(d)}</p>`).join('')}${checks}${issues}
      ${st.previewUrl ? `<p>本例（PR #${esc(st.previewN)}，示意編號）：<code class="adm-tl__url">${esc(st.previewUrl)}</code></p>` : ''}
      <p class="adm-tl__sys">正式環境由系統代做。</p></div></li>`;
  }).join('');
  return `<section class="adm-sim" aria-labelledby="sim-h"><h4 class="adm-sub" id="sim-h">模擬送出：送出之後會發生的事 <span class="adm-lane__badge" data-lane="${esc(tl.lane.id)}">${esc(tl.lane.label)}</span></h4>
    <p class="adm-muted">示意。時間為預估（T＝按下送出），實測數字見《發布車道建議書》附錄。</p>
    <ol class="adm-timeline" aria-label="送出後的處理時間軸">${li}</ol>
    <div class="adm-box adm-box--note"><strong>承辦人只按一次「送出」</strong>建立分支、開 PR、跑檢查、判定車道、合併、部署、產生預覽網址，都是系統的工作；承辦人要做的只有填對欄位，以及（一般車道）等審核人看預覽。</div></section>`;
}
function showSim() {
  simShown = true;
  const out = $('#sim-out');
  out.innerHTML = simHtml(exportObj(), val('#f-type'));
  out.focus();
}
function pathFor(o) { return P.packagePaths(o, $('#f-type').value).json; }
function gitSteps(o) {
  const pp = P.packagePaths(o, $('#f-type').value);
  const slug = String(o.id ?? 'new').replace(/[^a-z0-9.-]+/gi, '-');
  const add = [pp.json, ...(o.assets?.length ? [`content/assets/${o.id}/`] : [])].join(' ');
  return [
    '把 ZIP 解壓縮到 repo 根目錄（資料夾已經是 <code>content/…</code>，不要改名；同名檔案是新版覆蓋舊版）。',
    `<code>git switch -c content/${esc(slug)}</code>`,
    `<code>git add ${esc(add)}</code>`,
    `<code>git commit -m "content: ${esc(o.id ?? '')} ${esc(o.title ?? '')}"</code>`,
    '<code>git push -u origin HEAD</code>，到 GitHub 開 Pull Request；CI 會驗證 schema、治理規則、檔案雜湊與評估集。',
    '若 CI 回報檔案 bytes／sha256 不符，在本機跑 <code>npm run build -- --fix-assets</code> 自動補寫，再 commit。',
    '公關室內容審核、多語審核通過後合併，即發布七語頁面、索引與 API。',
  ].map((x) => `<li>${x}</li>`).join('');
}

/** 型別專屬的結果區塊：影音＝說明欄第一行與章節；專區＝連結列預覽。 */
function typeExtraHtml(f) {
  const ex = f.extra;
  if (f.type === 'media') {
    const b = P.resolveBasis(f.basedOn, D.families)[0];
    const line = P.mediaDescriptionLine({ producedAt: ex.producedAt, label: ex.versionLabel, url: b?.url });
    const ch = P.parseChapters(ex.chapters).items;
    return `<section aria-labelledby="r-m"><h3 id="r-m">(m) 影音上架：說明欄與章節</h3>
      <p class="adm-muted">YouTube 說明欄第一行（7.7 第 4 點）；影片畫面片頭也要印同樣的製作日期與依據版本。</p>
      <pre class="adm-pre" id="desc-line" tabindex="0">${esc(line)}</pre>
      <div class="adm-actions" style="margin-top:6px"><button type="button" class="adm-btn adm-btn--ghost adm-btn--sm" id="btn-desc">複製說明欄第一行</button></div>
      <p class="adm-muted">章節 ${ch.length} 個${ch.length ? `：${ch.map((c) => `${Math.floor(c.t / 60)}:${String(c.t % 60).padStart(2, '0')} ${esc(c.label)}`).join('、')}` : '（未填）'}；逐字稿 ${(ex.transcript ?? '').length} 字；字幕 ${(ex.captions ?? []).length ? esc(ex.captions.join('、')) : '無'}。</p></section>`;
  }
  if (f.type === 'topic') {
    const l = P.parseLinks(ex.links).items;
    return `<section aria-labelledby="r-t"><h3 id="r-t">(t) 連結列預覽</h3>${l.length ? `<ul class="adm-kv">${l.map((x) => `<li><span class="adm-badge ${x.external ? 'adm-badge--info' : 'adm-badge--gray'}">${x.external ? '外部' : '站內'}</span> ${esc(x.label)} <code>${esc(x.href)}</code>${x.note ? `<span class="adm-muted">${esc(x.note)}</span>` : ''}</li>`).join('')}</ul>` : '<p class="adm-muted">尚未填連結列。</p>'}</section>`;
  }
  return '';
}

// ---------- 事件 ----------
form.addEventListener('submit', (e) => { e.preventDefault(); ED?.flush(); if (!val('#f-body').trim() && !val('#f-title').trim()) { statusEl.textContent = '請先填寫標題或內文。'; $('#f-title').focus(); return; } statusEl.textContent = ''; runPreprocess(); });
$('#btn-save').addEventListener('click', () => saveDraft(true));
$('#btn-clear').addEventListener('click', () => {
  simShown = false; store.del(KEY); sel = { chips: {}, manual: [], summary: '', st: {}, ack: false, stage: 'edit' }; A = null; llmDrafts = {}; idTouched = false; lastId = ''; ASSETS?.clear();
  writeForm({ type: 'faq', owner: getUnit() === 'all' ? undefined : getUnit(), audience: ['public'] }); applyTypeUI(true);
  resultEl.innerHTML = '<p class="adm-muted">已清空。</p>'; secEl.textContent = '尚未送出'; statusEl.textContent = '已清空草稿。';
});
const SAMPLES = {
  media: {
    type: 'media', title: '候診室衛教影片：成人要不要再打 MMR？（示範）', owner: 'unit.acute-infectious', audience: ['public'], tasks: ['vaccines'], basedOn: ['doc.mmr-recommendation'],
    body: '給候診民眾看的麻疹與 MMR 疫苗衛教短片。',
    extra: {
      mediaType: 'video', youtube: '', producedAt: '2025-01-10', versionLabel: '108.05.14 建議', chapters: '0 開場\n30 誰需要評估接種\n90 怎麼接種', captions: ['zh-TW'],
      transcript: '各位候診的朋友大家好，今天要談麻疹。麻疹的傳染力很強，潛伏期大約七到十八天。依照目前的建議，1981 年以後出生的成人，如果沒有接種紀錄，建議評估接種兩劑 MMR 疫苗。懷孕的女性不可以接種。麻疹是第二類法定傳染病，醫師發現疑似個案要在二十四小時內通報。',
    },
  },
  topic: {
    type: 'topic', title: '防災避難衛生須知（示範）', owner: 'unit.preparedness', audience: ['public'], tasks: [],
    body: '颱風、地震後避難所的傳染病預防重點：飲水、廁所衛生、洗手、咳嗽禮節與腹瀉症狀通報。',
    extra: { topicKind: 'emergency', startAt: '', endAt: '', links: '避難所衛生檢核表 | https://example.gov.tw/shelter-checklist | 示意連結\n腸病毒與腹瀉防治 | /diseases/enterovirus/\n撥打 1922 防疫專線 | tel:1922', contentIds: ['disease.enterovirus'] },
  },
  service: {
    type: 'service', title: '個案資料申請（示範）', owner: 'unit.epidemic-intelligence', audience: ['public', 'professional'], tasks: ['data'],
    body: '學研單位申請傳染病個案去連結資料作研究使用。',
    extra: { serviceType: 'data-request', who: ['研究者'], steps: '備齊文件 | 研究計畫書與倫理審查證明 | 申請人 | 3\n線上送件 | 於申請系統上傳 | 申請人 | 1\n審查 | 資料治理小組審查 | 承辦單位 | 14\n通知與提供 | 核准後以安全方式提供 | 承辦單位 | 7', docs: '申請書\n研究計畫書\n倫理審查核可證明', slaDays: '30', fee: '免費', legal: '傳染病防治法第 9 條', forms: '資料申請書 | https://example.gov.tw/forms/data-request.odt | odt', applyUrl: '', contact: '1922' },
  },
  publication: {
    type: 'publication', title: '疫情報導（示範卷期）', owner: 'unit.epidemic-intelligence', audience: ['public', 'professional'], tasks: [],
    body: '本期收錄登革熱本土疫情調查與腸病毒監測週報。',
    extra: { pubType: 'bulletin', series: '疫情報導', volume: '42', issue: '18', edition: '', isbn: '', issn: '1021-2477', gpn: '', articles: '登革熱本土疫情調查 | 示範作者甲、示範作者乙 | 241-250\n腸病毒監測週報 | 示範作者丙 | 251-256' },
  },
  labtest: {
    type: 'labtest', title: '登革熱檢驗項目（示範）', owner: 'unit.lab', audience: ['professional'], tasks: [],
    body: '',
    extra: { labDisease: 'disease.dengue', sendHours: '48', labs: ['cdc-lab', 'certified-lab'], specimens: '急性期血清 | 血清分離管 | 2–5 mL | 4°C 冷藏 | 48 小時內冷藏送達 | 發病 7 日內 | NS1 抗原、RT-PCR\n恢復期血清 | 血清分離管 | 2–5 mL | 4°C 冷藏 | 48 小時內冷藏送達 | 發病 14 日後 | IgM、IgG' },
  },
  research: {
    type: 'research', title: '登革熱病媒監測智慧化研究（示範）', owner: 'unit.acute-infectious', audience: ['professional'], tasks: ['data'],
    body: '以物聯網誘蚊產卵器資料建立登革熱病媒密度預警模型。',
    extra: { year: '2026', projectStatus: 'ongoing', fundingType: 'commissioned', projectNo: 'DOC-115-001', piUnit: '示範大學公共衛生學院', datasets: [] },
  },
};
$('#btn-sample').addEventListener('click', () => {
  const type = val('#f-type');
  const sm = SAMPLES[type];
  if (sm) { contentIds = []; datasetIds = []; writeForm(sm); }
  else writeForm({
    type: 'faq', title: '登革熱發燒後幾天內要就醫？', owner: 'unit.acute-infectious', audience: ['public'], tasks: ['symptoms', 'travel'], basedOn: ['disease.dengue'],
    body: '感染登革病毒後潛伏期約 3 至 14 天。出現發燒且有登革熱流行地區旅遊史或居住史者，應於 24 小時內就醫並主動告知醫師。退燒後 1 至 2 天是出現警示徵象的高風險期，若有持續嘔吐、腹痛、出血、嗜睡等情形應立即回診。\n\n登革出血熱屬於較嚴重的表現，須儘速住院觀察。屈公病的症狀與登革熱相似，屈公病疑似病例應於 24 小時內通報衛生局。',
  });
  idTouched = false; applyTypeUI(true); fillSupersedes(); autoId();
  statusEl.textContent = '已載入範例，按「送出預處理」。';
});
form.addEventListener('input', (e) => {
  if (e.target.id === 'f-body') $('#f-body-count').textContent = `${e.target.value.length} 字`;
  if (e.target.id === 'x-transcript') $('#x-transcript-count').textContent = `${e.target.value.length} 字`;
  if (e.target.id === 'f-id') {
    idTouched = !!e.target.value.trim();
    const now = e.target.value.trim();
    if (lastId && now && lastId !== now) rewriteBody((b) => b.split(`/files/${lastId}/`).join(`/files/${now}/`));
    lastId = now;
  }
  if (e.target.id === 'x-family') fillSupersedes();
  if (e.target.id === 'f-publish-at') paintLane();
  if (['f-title', 'x-family', 'x-effective', 'x-disease', 'x-vaccine', 'x-labdisease'].includes(e.target.id)) autoId();
  autosave();
});
form.addEventListener('change', (e) => {
  if (e.target.id === 'f-type') applyTypeUI(true);
  if (e.target.id === 'f-urgent' || e.target.id === 'f-publish-at') paintLane();
  if (e.target.name === 'lang') paintLangReasons();
  if (e.target.id === 'x-labdisease') { const d = D.diseaseMaster.find((x) => x.id === e.target.value); $('#x-sendhours-hint').textContent = d?.notifyWithinHours != null ? `${d.name}主檔通報時限 ${d.notifyWithinHours} 小時；送驗時限超過會警告。` : '超過主檔通報時限時會警告。'; autoId(); if (d && !val('#f-title')) $('#f-title').value = `${d.name}檢驗項目`; }
  if (e.target.id === 'x-disease' && e.target.value) { const d = D.diseaseMaster.find((x) => x.id === e.target.value); if (d && !val('#f-title')) $('#f-title').value = d.name; }
  autosave();
  if (A) paintResultKeepFocus();
});
function paintResultKeepFocus() { const id = document.activeElement?.id; paintResult(); if (id) document.getElementById(id)?.focus?.(); }
$('#f-based-q').addEventListener('input', (e) => searchBased(e.target.value));
$('#f-based-q').addEventListener('keydown', (e) => { if (e.key === 'Escape') { $('#f-based-list').hidden = true; } if (e.key === 'ArrowDown') $('#f-based-list button')?.focus(); });
$('#f-based-list').addEventListener('click', (e) => { const b = e.target.closest('[data-add]'); if (!b) return; basedOn.push(b.dataset.add); paintBased(); fillVersionLabel(); $('#f-based-q').value = ''; $('#f-based-list').hidden = true; $('#f-based-q').focus(); autosave(); });
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
  const miss = missAll(obj);
  const mb = $('#miss-box'); if (mb && !miss.length) paintResult();
}
resultEl.addEventListener('click', async (e) => {
  const t = e.target.closest('button'); if (!t) return;
  if (t.id === 'kw-add-btn') addKw();
  else if (t.dataset.kwrm) { sel.manual.splice(Number(t.dataset.kwrm), 1); paintResult(); autosave(); }
  else if (t.id === 'sum-reset') { sel.summary = A.summary0; paintResult(); autosave(); }
  else if (t.id === 'btn-zip') await buildPackage();
  else if (t.id === 'btn-sim') showSim();
  else if (t.id === 'btn-dl') { const o = exportObj(); downloadText(`${String(o.id).replace(/[^a-z0-9.-]/gi, '_')}.json`, `${JSON.stringify(o, null, 2)}\n`); }
  else if (t.id === 'btn-copy') copyText(`${JSON.stringify(exportObj(), null, 2)}\n`, t);
  else if (t.id === 'btn-desc') copyText($('#desc-line')?.textContent ?? '', t);
  else if (t.id === 'btn-return') { sel.stage = 'edit'; $('#submit-msg').textContent = '已退回修改：請在左側調整內文後重新「送出預處理」。'; $('#f-title').focus(); saveDraft(false); }
  else if (t.id === 'btn-confirm') confirmSubmit();
  else if (t.dataset.llm) llmOne(t.dataset.llm);
});

function downloadBlob(filename, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
/** 產生上架包：content/{dir}/{id}.json ＋ content/assets/{id}/{檔案}（store-only ZIP，全在瀏覽器內組成） */
async function buildPackage() {
  const msg = $('#pkg-msg');
  const obj = exportObj();
  if (!obj.id) { msg.textContent = '請先填寫「內容 ID」。'; $('#f-id').focus(); return; }
  const gone = ASSETS?.missingFiles() ?? [];
  if (gone.length) { msg.className = 'adm-red'; msg.textContent = `還有檔案需要重新選取才能打包：${gone.join('、')}`; return; }
  try {
    const pp = P.packagePaths(obj, val('#f-type'));
    const entries = [{ name: pp.json, data: `${JSON.stringify(obj, null, 2)}\n` }];
    for (const a of ASSETS.items()) {
      const bytes = await ASSETS.bytesOf(a);
      if (typeof a.bytes === 'number' && bytes.length !== a.bytes) throw new Error(`${a.file} 的大小在選取後變了，請重新選取`);
      entries.push({ name: `content/assets/${obj.id}/${a.file}`, data: bytes });
    }
    const blob = zipBlob(entries);
    const name = `${String(obj.id).replace(/[^a-z0-9._-]/gi, '_')}-package.zip`;
    downloadBlob(name, blob);
    const left = missAll(obj).length;
    msg.className = left ? 'adm-yellow' : 'adm-green';
    msg.textContent = `已產生 ${name}（${entries.length} 個檔案，${P.fmtBytes(blob.size)}）。${left ? `注意：仍有 ${left} 項必填待補，CI 會擋下，建議先補齊再交。` : '必填欄位已齊。'}`;
  } catch (err) { msg.className = 'adm-red'; msg.textContent = `產生上架包失敗：${String(err?.message ?? err)}`; }
}

function confirmSubmit() {
  const obj = exportObj();
  const miss = missAll(obj);
  const msg = $('#submit-msg');
  if (miss.length) { msg.textContent = `無法送複核，請先補齊：${miss.join('；')}`; msg.className = 'adm-red'; return; }
  const reds = allChecks().filter((c) => c.level === 'error').length;
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
function mountEditor() {
  const ta = $('#f-body');
  ASSETS = initAssets({
    root: $('#asset-panel'), limits: LIMITS, licenses: D.licenses,
    getContentId: () => $('#f-id').value.trim(), getBody: () => { ED?.flush(); return ta.value; },
    onChange: ({ structural } = {}) => { autosave(); if (structural) ED?.repaint(); repaintResultSoon(); },
    insertImage: (im) => ED?.insertImage(im),
    renameRefs: (from, to) => rewriteBody((b) => b.split(from).join(to)),
  });
  ED = initEditor({
    textarea: ta, resolveImg: (p) => ASSETS?.resolveImg(p),
    getImages: () => ASSETS?.images() ?? [], requestImage: () => ASSETS?.requestImage(), onFiles: (fs) => ASSETS?.addFiles(fs),
    onChange: () => { ASSETS?.refreshIssues(); },
  });
}
const repaintResultSoon = debounce(() => { if (A) paintResultKeepFocus(); }, 300);
(function init() {
  mountEditor();
  fillSupersedes();
  const u = getUnit();
  const saved = store.get(KEY);
  const qe = new URLSearchParams(location.search).get('edit');
  if (qe) { startEdit(qe.trim()); }
  else if (saved && (saved.title || saved.body)) {
    if (saved.derived) sel = { ...sel, ...saved.derived };
    writeForm(saved);
    statusEl.textContent = `已還原上次草稿（${saved.savedAt ? new Date(saved.savedAt).toLocaleString('zh-TW', { hour12: false }) : ''}）`;
    if (sel.stage !== 'edit' || (saved.derived && Object.keys(saved.derived.chips ?? {}).length)) runPreprocess({ silent: true });
  } else {
    const qt = new URLSearchParams(location.search).get('type');
    writeForm({ type: P.TYPES.some((t) => t.value === qt) ? qt : 'faq', owner: u !== 'all' ? u : undefined, audience: ['public'] });
    applyTypeUI(true);
  }
  document.addEventListener('adm:unit', () => { if (!val('#f-title') && !val('#f-body') && getUnit() !== 'all') $('#f-owner').value = getUnit(); });
  document.addEventListener('click', (e) => { if (e.target?.id === 'btn-edit-cancel') { editing = null; paintEditBox(); store.del(KEY); location.href = url('/admin/publish/'); } });
  form.addEventListener('input', debounce(() => { if (editing) paintEditDiff(); }, 400));
  window.__admPublish = { runPreprocess, exportObj, buildPackage, startEdit, get editing() { return editing; }, get editor() { return ED; }, get assets() { return ASSETS; }, get state() { return { sel, A }; } }; // 供自動化測試
})();
void normPath; void today;
