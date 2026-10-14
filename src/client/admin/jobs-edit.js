// /admin/jobs/edit/ 人才招募上架與異動：只做 DOM 綁定；組物件、異動判定、檢核都在 jobs-edit-core.js（純函式，有測試）。
// 第五十三輪（docs/deploy.md §25、guide-staff §56）：有寫入閘道時接上「送審與上線」（publish-gateway.js，與上架頁、疫情報導編輯頁同一套）：
//   存檔帶版本碼（getBaseHash）、被擋時「載入最新版（保留我的修改）」（reloadLatest）、從送審件開啟（?gw=）。沒有閘道時照舊只產生 JSON。
import { $, $$, esc, store, readEmbedded, copyText, downloadText } from './common.js';
import { liveItem, sameValue, editDiff, EDIT_DERIVED } from './preprocess.js';
import { contentVersion, NEW_VERSION } from './content-version.js';
import { initPublishGateway } from './publish-gateway.js';
import { resultTakenDown } from '../careers-rules.js';
import {
  emptyState, stateFromJob, buildJob, problemsOf, rowProblems, amendmentFor, cancelAmendment, amendmentsSorted, dateChanges, keyDates, exportFilename,
  jobStageOf, AMEND_KINDS, suggestedUnpublishAt,
} from './jobs-edit-core.js';
import { mergeFormEdit, changedFields, changedText, editorFieldLabel } from './edit-merge.js';
import { stripBuild, SLUG_RE } from './jobs-edit-core.js';

const D = readEmbedded('adm-jobs-data', { today: '', jobs: [], units: [], jobTypes: [], examStages: [], stages: {}, amendKinds: {}, sourceHashes: {}, resultTakenDown: [], versions: {} });
const KEY = 'cdc.admin.jobs-edit';
const TODAY = D.today;
const byId = new Map(D.jobs.map((j) => [j.id, j]));
const STAGE_BADGE = { upcoming: 'info', open: 'ok', closed: 'gray', screening: 'warn', result: 'ok', filled: 'gray', cancelled: 'gray' };

let state = emptyState();
let base = null; // 選到的既有職缺（原始資料）
let baseline = null; // B 區比對基準：原公告日期，或上一次加入異動紀錄後的日期
// 第五十二輪（docs/deploy.md §24）：修改既有職缺時，匯出＝以現行版為底，只套用同事改過的欄位。
// editBase＝表單剛帶入、還沒動過時的匯出（buildJob 經過真的表單來回一次的結果）；與目前的匯出逐欄比較，相同的欄位保留現行版原樣。
let editBase = null;
// 第五十三輪：同時修改的版本檢查（docs/deploy.md §23、§25）。live＝現行版（合併的底；網站上的，或送審件裡的）＋正本雜湊；
// source：live 從哪裡來（site／gateway）；version：live 的版本碼；savedVersion：這頁上次存進系統的版本碼 { id, hash }。
let live = null;
let source = 'site';
let version = NEW_VERSION;
let savedVersion = null;

const datesOf = (j) => ({ applyStart: j?.applyStart ?? '', deadlineAt: j?.deadlineAt ?? '', resultPlannedAt: j?.resultPlannedAt ?? '', examPlan: (j?.examPlan ?? []).map((e) => ({ stage: e.stage, date: e.date ?? '' })) });

/* ───────── 動態列 ───────── */
const opt = (list, v) => list.map((x) => `<option value="${esc(x)}"${x === v ? ' selected' : ''}>${esc(x)}</option>`).join('');
const del = (kind, i, label) => `<td><button type="button" class="adm-btn adm-btn--ghost adm-btn--sm" data-del="${kind}" data-i="${i}" aria-label="刪除${esc(label)}">刪除</button></td>`;
const inp = (k, v, { type = 'text', label = '', size = '' } = {}) => `<input type="${type}" data-k="${k}" value="${esc(v)}" aria-label="${esc(label)}"${size ? ` size="${size}"` : ''}${type === 'number' ? ' min="1" step="1" inputmode="numeric"' : ''} class="adm-input">`;
const why = '<p class="adm-jf-why" data-why hidden></p>';
const ROWS = {
  exam: { tbody: '#jf-exam', list: () => state.examPlan, blank: () => ({ stage: '口試', date: '', note: '' }),
    row: (e, i) => `<tr data-i="${i}"><td><select data-k="stage" class="adm-input" aria-label="第 ${i + 1} 階段">${opt(D.examStages, e.stage)}</select></td><td>${inp('date', e.date, { type: 'date', label: `第 ${i + 1} 階段日期` })}</td><td>${inp('note', e.note, { label: `第 ${i + 1} 階段備註` })}</td>${del('exam', i, `第 ${i + 1} 階段`)}</tr>` },
  am: { tbody: '#jf-am-list', list: () => state.amendments, blank: () => ({ date: TODAY, kind: 'correction', text: '' }),
    row: (a, i) => `<tr data-i="${i}"><td>${inp('date', a.date, { type: 'date', label: '異動日期' })}</td><td><select data-k="kind" class="adm-input" aria-label="異動類型">${Object.entries(AMEND_KINDS).map(([k, v]) => `<option value="${k}"${k === a.kind ? ' selected' : ''}>${v}</option>`).join('')}</select></td><td>${inp('text', a.text, { label: '異動說明' })}</td><td>${inp('refNo', a.refNo ?? '', { label: '異動字號', size: 12 })}</td>${del('am', i, '這筆異動紀錄')}</tr>` },
  admitted: { tbody: '#jf-admitted', list: () => state.result.admitted, blank: () => ({ seq: String(state.result.admitted.length + 1), candidateNo: '' }),
    row: (a, i) => `<tr data-i="${i}"><td>${inp('seq', a.seq, { type: 'number', label: '序號', size: 3 })}</td><td>${inp('candidateNo', a.candidateNo, { label: '報名編號' })}${why}</td>${del('admitted', i, `正取第 ${i + 1} 列`)}</tr>` },
  waitlist: { tbody: '#jf-waitlist', list: () => state.result.waitlist, blank: () => ({ rank: String(state.result.waitlist.length + 1), candidateNo: '', validUntil: state.result.waitlist.at(-1)?.validUntil ?? '' }),
    row: (a, i) => `<tr data-i="${i}"><td>${inp('rank', a.rank, { type: 'number', label: '順位', size: 3 })}</td><td>${inp('candidateNo', a.candidateNo, { label: '報名編號' })}${why}</td><td>${inp('validUntil', a.validUntil, { type: 'date', label: '備取有效至' })}</td>${del('waitlist', i, `備取第 ${i + 1} 列`)}</tr>` },
  wlu: { tbody: '#jf-wlu', list: () => state.waitlistUpdates, blank: () => ({ date: TODAY, candidateNo: '', note: '' }),
    row: (a, i) => `<tr data-i="${i}"><td>${inp('date', a.date, { type: 'date', label: '遞補日期' })}</td><td>${inp('candidateNo', a.candidateNo, { label: '報名編號' })}${why}</td><td>${inp('note', a.note, { label: '遞補說明' })}</td>${del('wlu', i, `遞補第 ${i + 1} 筆`)}</tr>` },
};
function renderRows(kind) { const R = ROWS[kind]; $(R.tbody).innerHTML = R.list().map(R.row).join(''); }
function readRows(kind) {
  const old = ROWS[kind].list();
  return $$(`${ROWS[kind].tbody} tr`).map((tr, i) => {
    const o = { ...(old[i] ?? {}) };
    for (const el of $$('[data-k]', tr)) o[el.dataset.k] = el.value;
    return o;
  });
}

/* ───────── 表單 ↔ 狀態 ───────── */
const SIMPLE = {
  title: '#jf-title', summary: '#jf-summary', slug: '#jf-slug', refNo: '#jf-refno', hiringUnit: '#jf-unit', jobType: '#jf-type', positions: '#jf-positions', workplace: '#jf-workplace',
  salaryNote: '#jf-salary', qualifications: '#jf-qual', duties: '#jf-duties', requiredDocuments: '#jf-docs', applyStart: '#jf-start', deadlineAt: '#jf-deadline',
  applyMethod: '#jf-method', applyUrl: '#jf-applyurl', resultPlannedAt: '#jf-resultplan', contact: '#jf-contact', attachments: '#jf-att', manualStatusNote: '#jf-ms-note',
};
function fill(st) {
  state = st;
  for (const [k, sel] of Object.entries(SIMPLE)) $(sel).value = st[k] ?? '';
  $('#jf-pick').value = base?.id ?? 'new';
  $('#jf-slug').readOnly = !!base;
  $('#jf-slug').setAttribute('aria-readonly', base ? 'true' : 'false');
  const ms = $(`input[name="jf-ms"][value="${st.manualStatus ?? ''}"]`); if (ms) ms.checked = true;
  $('#jf-has-result').checked = !!st.hasResult;
  $('#jf-result').hidden = !st.hasResult;
  $('#jf-r-date').value = st.result.publishedAt ?? ''; $('#jf-r-ref').value = st.result.refNo ?? ''; $('#jf-r-note').value = st.result.note ?? '';
  $('#jf-r-unpub').value = st.result.unpublishAt ?? ''; $('#jf-r-ext').value = st.result.externalUrl ?? '';
  for (const k of Object.keys(ROWS)) renderRows(k);
}
function read() {
  const st = { ...state };
  for (const [k, sel] of Object.entries(SIMPLE)) st[k] = $(sel).value;
  st.manualStatus = $('input[name="jf-ms"]:checked')?.value ?? '';
  st.hasResult = $('#jf-has-result').checked;
  st.examPlan = readRows('exam');
  st.amendments = readRows('am');
  st.result = { ...state.result, publishedAt: $('#jf-r-date').value, unpublishAt: $('#jf-r-unpub').value, externalUrl: $('#jf-r-ext').value, refNo: $('#jf-r-ref').value, note: $('#jf-r-note').value, admitted: readRows('admitted'), waitlist: readRows('waitlist') };
  st.waitlistUpdates = readRows('wlu');
  state = st;
  return st;
}
const rawJob = () => buildJob(read(), { today: TODAY, base });
/** 現行版（content 檔的內容）＋建置的正本雜湊：mergeFormEdit 用它判斷改到中文時要不要把英譯標成「依舊版翻譯」 */
const liveOf = (job, sourceHash = D.sourceHashes?.[job?.id]) => (job ? { ...job, sourceHash: sourceHash ?? undefined } : null);
const currentJob = () => { const out = rawJob(); return base && editBase && live ? mergeFormEdit(out, live, editBase) : out; };
/**
 * 第五十三輪：從系統帶回的一筆（送審件或網站上的最新版）＝ content 檔，可能還留著已下架的名單。這頁是公開的靜態頁、從網站開啟時本來就沒有名單，
 * 所以帶回時也照建置的規則（careers-rules.js 的 resultTakenDown）拿掉，兩種開法的「現行版」才一致；存檔後名單就從檔案刪除（畫面會明說）。
 */
function takeDown(job) {
  if (!job?.result || !resultTakenDown(job, TODAY)) return job;
  const { publishedAt, unpublishAt, refNo } = job.result;
  const { waitlistUpdates, ...rest } = job;
  void waitlistUpdates;
  return { ...rest, result: { publishedAt, unpublishAt, ...(refNo ? { refNo } : {}) } };
}
const otherIds = () => D.jobs.map((j) => j.id).filter((id) => id !== base?.id);

/* ───────── 預覽 ───────── */
const badge = (stage) => `<span class="adm-badge adm-badge--${STAGE_BADGE[stage] ?? 'gray'}">${esc(D.stages[stage] ?? stage)}</span>`;
function diffTable(changes) {
  return `<div class="adm-tablewrap"><table class="adm-table adm-jf-diff"><thead><tr><th scope="col">項目</th><th scope="col">原公告</th><th scope="col">改為</th></tr></thead><tbody>${changes.map((c) => `<tr><th scope="row">${esc(c.label)}</th><td><del>${esc(c.from || '（未定）')}</del></td><td><ins>${esc(c.to || '（另行公告）')}</ins></td></tr>`).join('')}</tbody></table></div>`;
}
function paint() {
  const job = currentJob();
  const problems = problemsOf(job, TODAY, otherIds());
  const stage = jobStageOf(job, TODAY);
  // B：自上次異動紀錄以來的變動
  const pending = baseline ? amendmentFor(baseline, job, '', TODAY) : null;
  $('#jf-b-diff').innerHTML = !base ? '<p class="adm-muted">新增職缺不需要異動紀錄；上線後再回來改日期時才需要。</p>'
    : pending.changes.length ? `${diffTable(pending.changes)}<p class="adm-jf-kind">將記為：<span class="adm-badge adm-badge--info">${esc(AMEND_KINDS[pending.kind])}</span> ${esc(pending.compare)}</p>`
      : '<p class="adm-muted">日期與上次公告相同。只想更正文字時，直接寫說明並加入（類型＝更正）。</p>';
  // 預覽
  const overall = base ? dateChanges(datesOf(base), job) : [];
  const changed = new Set(overall.map((c) => c.label));
  const prevOf = (label) => overall.find((c) => c.label === label)?.from;
  const kd = keyDates(job).map(([k, v]) => {
    const lab = { 報名開始: '報名開始日', 報名截止: '報名截止日', 結果預計公布: '結果預計公布日' }[k] ?? (k.startsWith('甄試：') ? `${k.slice(3)}日期` : k);
    return `<tr${changed.has(lab) ? ' class="adm-jf-changed"' : ''}><th scope="row">${esc(k)}</th><td>${esc(v)}${changed.has(lab) ? ` <span class="adm-muted">（原 <del>${esc(prevOf(lab) || '未定')}</del>）</span>` : ''}</td></tr>`;
  }).join('');
  const ams = amendmentsSorted(job.amendments);
  const rp = rowProblems(job);
  const rowBad = [...rp.admitted, ...rp.waitlist, ...rp.updates].filter((x) => x.length).length;
  const admittedN = job.result?.admitted?.length ?? 0;
  $('#jf-preview').innerHTML = `
    <div class="adm-jf-head"><p class="adm-jf-stage">建置日 ${esc(TODAY)} 的階段：${badge(stage)}</p><p class="adm-jf-title">${esc(job.title || '（職缺名稱）')}</p><p class="adm-muted"><code>${esc(job.id)}</code> → <code>/careers/${esc(job.slug || '{slug}')}/</code></p></div>
    <h3 class="adm-jf-h3">關鍵日期</h3><div class="adm-tablewrap"><table class="adm-table adm-jf-dates"><tbody>${kd || '<tr><td class="adm-muted">尚未填日期</td></tr>'}</tbody></table></div>
    <h3 class="adm-jf-h3">公告異動（前台依日期倒序）</h3>${ams.length ? `<ul class="adm-jf-amends">${ams.map((a) => `<li><span class="adm-badge adm-badge--${a.kind === 'cancel' ? 'warn' : a.kind === 'extend' ? 'info' : 'gray'}">${esc(AMEND_KINDS[a.kind] ?? a.kind)}</span> <time>${esc(a.date)}</time> ${esc(a.text)}${a.refNo ? ` <span class="adm-muted">（${esc(a.refNo)}）</span>` : ''}</li>`).join('')}</ul>` : '<p class="adm-muted">沒有異動紀錄。</p>'}
    ${job.result || job.waitlistUpdates ? `<h3 class="adm-jf-h3">甄選結果檢核</h3><ul class="adm-jf-checks">
      <li class="${rowBad ? 'is-no' : 'is-ok'}">${job.result?.externalUrl ? '✓ 名單在人事系統（建議做法），本站不存名單' : rowBad ? `✗ ${rowBad} 列報名編號未通過（左側標紅）` : `✓ ${[...rp.admitted, ...rp.waitlist, ...rp.updates].length} 列只有報名編號、不含姓名`}</li>
      <li class="${job.result?.unpublishAt ? 'is-ok' : 'is-no'}">${job.result?.unpublishAt ? `✓ ${esc(job.result.unpublishAt)} 起自動下架（建議值 ${esc(suggestedUnpublishAt(job.result) ?? '—')}）` : '✗ 沒有下架日'}</li>
      <li class="${job.positions != null && admittedN > job.positions ? 'is-no' : 'is-ok'}">${job.positions != null && admittedN > job.positions ? '✗' : '✓'} 正取 ${admittedN} ／ 名額 ${esc(job.positions ?? '—')}</li>
      <li class="${(job.result?.waitlist ?? []).some((w) => !w.validUntil) ? 'is-no' : 'is-ok'}">${(job.result?.waitlist ?? []).some((w) => !w.validUntil) ? '✗ 有備取沒有填有效期限' : `✓ 備取 ${(job.result?.waitlist ?? []).length} 位`}</li></ul>` : ''}`;
  // 結果列標紅
  for (const [kind, list] of [['admitted', rp.admitted], ['waitlist', rp.waitlist], ['wlu', rp.updates]]) {
    $$(`${ROWS[kind].tbody} tr`).forEach((tr, i) => {
      const msgs = list[i] ?? [];
      tr.classList.toggle('adm-jf-bad', msgs.length > 0);
      const w = $('[data-why]', tr); if (w) { w.hidden = !msgs.length; w.textContent = msgs.join('；'); }
      for (const el of $$('input[data-k="candidateNo"]', tr)) el.setAttribute('aria-invalid', msgs.length ? 'true' : 'false');
    });
  }
  const pii = problems.filter((p) => /^個資閘門|^甄選結果/.test(p));
  $('#jf-pii').innerHTML = job.result || job.waitlistUpdates ? (pii.length ? `<div class="adm-box adm-box--err" role="alert"><strong>個資檢核未通過（建置會失敗）</strong><ul>${pii.map((p) => `<li>${esc(p)}</li>`).join('')}</ul></div>` : '<div class="adm-box adm-box--ok"><strong>個資檢核通過</strong>與建置使用同一份規則。</div>') : '';
  $('#jf-cap').textContent = job.positions != null ? `正取 ${admittedN} ／ 名額 ${job.positions}` : '';
  // 發布前請補齊
  const extra = [];
  if (pending?.changes.length) extra.push(`日期已變動（${pending.compare}），但還沒按「加入異動紀錄」：民眾看不到改期原因`);
  const all = [...problems, ...extra];
  $('#jf-warn').innerHTML = all.length ? `<div class="adm-box adm-box--warn" role="status"><strong>發布前請補齊（${all.length}）</strong><ul class="adm-jf-list">${all.map((p) => `<li>${esc(p)}</li>`).join('')}</ul></div>`
    : '<div class="adm-box adm-box--ok"><strong>檢核全過</strong>可以匯出開 PR；CI 用的是同一份規則。</div>';
  // 匯出：改了哪些欄位（與現行版逐欄比較；已下架的甄選名單另外明說）
  const ch = base && live ? changedFields(job, live) : null;
  const gone = base && (D.resultTakenDown ?? []).includes(base.id) ? `　甄選結果已於 ${base.result?.unpublishAt ?? ''} 下架：這一頁沒有名單（網站已不輸出），匯出的檔案不含正取、備取與遞補名單；這正是下架後要從檔案刪除名單的做法，覆蓋原檔前請確認。` : '';
  $('#jf-changed').textContent = ch ? `${changedText(ch)}${gone}` : '';
  $('#jf-changed').dataset.changed = ch ? ch.fields.join(' ') : '';
  $('#jf-file').textContent = exportFilename(job);
  $('#jf-out').textContent = JSON.stringify(job, null, 2);
}

/* ───────── 事件 ───────── */
function load(id) {
  base = id && id !== 'new' ? byId.get(id) ?? null : null;
  const { stage, ...clean } = base ?? {};
  if (base) base = clean;
  live = liveOf(base); source = 'site'; savedVersion = null;
  version = base ? (D.versions?.[base.id] ?? contentVersion(base)) : NEW_VERSION;
  baseline = base ? datesOf(base) : null;
  fill(base ? stateFromJob(base) : emptyState());
  editBase = base ? rawJob() : null; // 表單帶入後（經過真的欄位）立刻記下，之後才分得出哪些欄位是同事改的
  $('#jf-am-msg').textContent = '';
}
/** 第五十三輪：表單帶入系統送回的一筆（送審件，或網站上的最新版）並重新記 editBase */
function openItem(item, { version: v, source: src, sourceHash = null }) {
  const clean = takeDown(stripBuild(item));
  if (!$(`#jf-pick option[value="${CSS.escape(clean.id)}"]`)) $('#jf-pick').append(new Option(`${clean.title}（送審中）`, clean.id));
  base = clean;
  live = liveOf(clean, sourceHash);
  source = src; savedVersion = null;
  version = v ?? contentVersion(item);
  baseline = datesOf(clean);
  fill(stateFromJob(clean));
  editBase = rawJob();
}
/** 存檔時要帶給閘道的版本碼：上次存進系統的、或開啟時的；新職缺是 new */
function getBaseHash() {
  const id = currentJob().id;
  if (savedVersion?.id === id) return savedVersion.hash;
  if (live && live.id === id) return version;
  return NEW_VERSION;
}
/** 換了要處理的職缺 ⇒ 網址不再指向原本的送審件；送審面板重新檢查這筆的送審件與網站版本 */
function targetChanged() {
  if (new URLSearchParams(location.search).has('gw')) { try { history.replaceState(null, '', location.pathname); } catch { /* 不能改網址也沒關係 */ } }
  document.dispatchEvent(new CustomEvent('adm:gw-target'));
}
$('#jf-pick').addEventListener('change', (e) => { load(e.target.value); paint(); targetChanged(); });
$('#jf-form').addEventListener('input', (e) => {
  if (e.target.id === 'jf-ms-note') syncAutoCancel();
  if (e.target.closest('#jf-am-list')) { const i = Number(e.target.closest('tr')?.dataset.i); if (state.amendments[i]) state.amendments[i]._auto = false; }
  paint();
});
$('#jf-form').addEventListener('change', (e) => {
  if (e.target.name === 'jf-ms') { read(); syncAutoCancel(true); }
  if (e.target.id === 'jf-has-result') {
    read();
    $('#jf-result').hidden = !state.hasResult;
    if (state.hasResult && !state.result.publishedAt) { state.result.publishedAt = TODAY; $('#jf-r-date').value = TODAY; }
    if (state.hasResult && !state.result.externalUrl && !state.result.admitted.length) { state.result.admitted.push(ROWS.admitted.blank()); renderRows('admitted'); }
  }
  // 第三十輪：下架日沒填時，依公告日與備取有效期自動帶入預設值（之後人事室可改）
  if (state.hasResult && !$('#jf-r-unpub').value) { const d = suggestedUnpublishAt({ publishedAt: $('#jf-r-date').value, waitlist: readRows('waitlist') }); if (d) $('#jf-r-unpub').value = d; }
  paint();
});
/** C：選取消／補實時自動追加一筆 kind=cancel（今天、尚未手動改過文字者隨理由更新）；改回「維持自動」時移除自動加的那筆 */
function syncAutoCancel(structural = false) {
  read();
  const ms = state.manualStatus;
  const idx = state.amendments.findIndex((a) => a._auto);
  const auto = cancelAmendment(ms, state.manualStatusNote, TODAY);
  if (!auto) { if (idx >= 0 && structural) { state.amendments.splice(idx, 1); renderRows('am'); } return; }
  if (idx >= 0) { state.amendments[idx] = { ...state.amendments[idx], text: auto.text, _auto: true }; }
  else if (structural) state.amendments.push({ ...auto, _auto: true });
  renderRows('am');
}
$('#jf-form').addEventListener('click', (e) => {
  const b = e.target.closest('[data-del]');
  if (!b) return;
  read();
  ROWS[b.dataset.del].list().splice(Number(b.dataset.i), 1);
  renderRows(b.dataset.del); paint();
});
for (const [kind, btn] of [['exam', '#jf-exam-add'], ['admitted', '#jf-admitted-add'], ['waitlist', '#jf-waitlist-add'], ['wlu', '#jf-wlu-add']]) {
  $(btn).addEventListener('click', () => { read(); ROWS[kind].list().push(ROWS[kind].blank()); renderRows(kind); paint(); $(`${ROWS[kind].tbody} tr:last-child input, ${ROWS[kind].tbody} tr:last-child select`)?.focus(); });
}
$('#jf-am-add').addEventListener('click', () => {
  const job = currentJob();
  const r = amendmentFor(baseline ?? datesOf(job), job, $('#jf-am-text').value, TODAY, $('#jf-am-ref').value);
  if (!r.amendment) { $('#jf-am-msg').textContent = '沒有日期變動，也沒有寫說明：沒有可加入的異動。'; return; }
  state.amendments.push(r.amendment);
  baseline = datesOf(job);
  $('#jf-am-text').value = ''; $('#jf-am-ref').value = '';
  renderRows('am');
  $('#jf-am-msg').textContent = `已加入一筆「${AMEND_KINDS[r.kind]}」異動紀錄。`;
  paint();
});
function saveLocal() { read(); store.set(KEY, { pick: base?.id ?? 'new', state, baseline, editBase, gwVersion: savedVersion, ...(source === 'gateway' && live ? { gwLive: live, gwLiveVersion: version } : {}), savedAt: new Date().toISOString() }); }
$('#jf-save').addEventListener('click', () => { saveLocal(); $('#jf-msg').textContent = '草稿已存在這台電腦的瀏覽器。'; });
$('#jf-reset').addEventListener('click', () => { store.del(KEY); load($('#jf-pick').value); paint(); targetChanged(); $('#jf-msg').textContent = '已放棄草稿，重新帶入目前公告內容。'; });
$('#jf-copy').addEventListener('click', (e) => copyText(`${$('#jf-out').textContent}\n`, e.currentTarget));
$('#jf-dl').addEventListener('click', () => downloadText(exportFilename(currentJob()).split('/').pop(), `${$('#jf-out').textContent}\n`));

// 初始：網址 ?id=job.… 優先，其次本機草稿，否則新增
const qid = new URLSearchParams(location.search).get('id');
const saved = store.get(KEY);
if (qid && byId.has(qid)) load(qid);
else if (saved?.state && (saved.pick === 'new' || byId.has(saved.pick))) {
  load(saved.pick);
  // 第五十三輪：從送審件帶回的草稿 ⇒ 現行版仍是那一版（editBase 是依它記的）；上次存進系統的版本碼也帶回來
  if (saved.gwLive && (saved.pick === 'new' || saved.gwLive.id === saved.pick)) { base = stripBuild(saved.gwLive); live = saved.gwLive; source = 'gateway'; version = saved.gwLiveVersion ?? contentVersion(live); }
  if (saved.gwVersion?.id && saved.gwVersion?.hash) savedVersion = saved.gwVersion;
  baseline = saved.baseline ?? baseline;
  if (saved.editBase && base) editBase = saved.editBase; // 草稿開始時的 base：之後 main 上被別人改的欄位，不會被當成同事改的
  fill({ ...emptyState(), ...saved.state, result: { ...emptyState().result, ...(saved.state.result ?? {}) } });
  $('#jf-msg').textContent = `已還原 ${saved.savedAt ? saved.savedAt.slice(0, 16).replace('T', ' ') : ''} 的本機草稿。`;
} else load('new');
paint();

/* ───────── 第五十三輪：送審與上線（有寫入閘道時才出現；GitHub Pages 與 ?gateway=off 仍只產生 JSON） ───────── */
const GW_FIELDS = { id: '#jf-slug', slug: '#jf-slug', title: '#jf-title', summary: '#jf-summary', refNo: '#jf-refno', hiringUnit: '#jf-unit', jobType: '#jf-type', positions: '#jf-positions', workplace: '#jf-workplace', salaryNote: '#jf-salary', qualifications: '#jf-qual', duties: '#jf-duties', requiredDocuments: '#jf-docs', applyStart: '#jf-start', deadlineAt: '#jf-deadline', applyMethod: '#jf-method', applyUrl: '#jf-applyurl', examPlan: '#jf-exam-add', resultPlannedAt: '#jf-resultplan', contact: '#jf-contact', attachments: '#jf-att', amendments: '#jf-am-text', manualStatus: '#jf-ms-note', manualStatusNote: '#jf-ms-note', result: '#jf-has-result', waitlistUpdates: '#jf-wlu-add' };
/**
 * 載入最新版（保留我的修改）：與疫情報導編輯頁同一個做法（docs/deploy.md §23.5）。
 * 「我改的欄位」＝表單匯出跟 editBase 不同的欄位；「別人改的」＝最新版跟我開啟時的版本（live）不同的欄位。
 * 先以最新版重新帶入表單、重新記 editBase，再把我改、別人沒改的欄位寫回表單；兩邊都改的先用最新版，列出我的值。
 */
function reloadLatest(item, v, { source: src = 'site' } = {}) {
  const mineFull = currentJob();
  const raw = rawJob();
  try { store.set('cdc.admin.staleCopy', { id: mineFull.id, savedAt: new Date().toISOString(), item: mineFull }); } catch { /* 存不下就算了，畫面仍會列出我的值 */ }
  const label = (k) => `${editorFieldLabel(k)}${editorFieldLabel(k) === k ? '' : `（${k}）`}`;
  const show = (x) => (x == null ? '（空白）' : typeof x === 'string' ? x : JSON.stringify(x, null, 1));
  const before = live && live.id === item.id && editBase ? live : null;
  const oldBaseline = baseline;
  const latest = liveItem(takeDown(stripBuild(item)));
  if (!before) {
    openItem(item, { version: v, source: src, sourceHash: item.sourceHash ?? null });
    paint(); saveLocal();
    return { theirs: [], mine: [], conflicts: editDiff(mineFull, latest).map((k) => ({ field: k, label: label(k), yours: show(mineFull[k]) })) };
  }
  const mineKeys = [...new Set([...Object.keys(raw), ...Object.keys(editBase)])].filter((k) => !EDIT_DERIVED.includes(k) && !sameValue(raw[k], editBase[k]));
  const theirKeys = editDiff(latest, before);
  const conflicts = mineKeys.filter((k) => theirKeys.includes(k) && !sameValue(mineFull[k], latest[k]));
  const reapply = { ...latest };
  for (const k of mineKeys) { if (conflicts.includes(k)) continue; if (mineFull[k] === undefined) delete reapply[k]; else reapply[k] = mineFull[k]; }
  openItem(item, { version: v, source: src, sourceHash: item.sourceHash ?? null });
  if (mineKeys.length) fill(stateFromJob(reapply));
  // 我已經記過異動紀錄（日期的比對基準移過）⇒ 沿用我的基準，不重複提醒「日期變了還沒記」
  if (mineKeys.includes('amendments') && !conflicts.includes('amendments') && oldBaseline) baseline = oldBaseline;
  paint(); saveLocal();
  return { theirs: theirKeys.map(label), mine: mineKeys.filter((k) => !conflicts.includes(k)).map(label), conflicts: conflicts.map((k) => ({ field: k, label: label(k), yours: show(mineFull[k]) })) };
}
initPublishGateway({
  exportObj: () => currentJob(),
  getContentId: () => { const j = currentJob(); const slug = String(j.id ?? '').replace(/^job\.\d{4}-\d{2}-\d{2}-/, ''); return /^job\.\d{4}-\d{2}-\d{2}-/.test(j.id ?? '') && SLUG_RE.test(slug) ? j.id : ''; },
  loadItem: (item, meta = {}) => { openItem(item, { version: meta.contentHash, source: 'gateway' }); paint(); },
  fieldInput: GW_FIELDS,
  getBaseHash,
  getEditTarget: () => (live && source === 'site' ? { id: live.id, type: 'job', version } : null),
  reloadLatest,
  onSaved: (sub) => {
    if (sub?.contentHash) savedVersion = { id: sub.contentId, hash: sub.contentHash };
    saveLocal();
    if (sub?.status === 'published') $('#jf-msg').textContent = '職缺已上線。';
  },
});
window.__admJobs = { currentJob, getBaseHash, reloadLatest, get live() { return live; }, get editBase() { return editBase; }, get version() { return version; }, get source() { return source; } }; // 供自動化測試
