// /admin/jobs/edit/ 人才招募上架與異動：只做 DOM 綁定；組物件、異動判定、檢核都在 jobs-edit-core.js（純函式，有測試）。
import { $, $$, esc, store, readEmbedded, copyText, downloadText } from './common.js';
import {
  emptyState, stateFromJob, buildJob, problemsOf, rowProblems, amendmentFor, cancelAmendment, amendmentsSorted, dateChanges, keyDates, exportFilename,
  jobStageOf, AMEND_KINDS,
} from './jobs-edit-core.js';

const D = readEmbedded('adm-jobs-data', { today: '', jobs: [], units: [], jobTypes: [], examStages: [], stages: {}, amendKinds: {} });
const KEY = 'cdc.admin.jobs-edit';
const TODAY = D.today;
const byId = new Map(D.jobs.map((j) => [j.id, j]));
const STAGE_BADGE = { upcoming: 'info', open: 'ok', closed: 'gray', screening: 'warn', result: 'ok', filled: 'gray', cancelled: 'gray' };

let state = emptyState();
let base = null; // 選到的既有職缺（原始資料）
let baseline = null; // B 區比對基準：原公告日期，或上一次加入異動紀錄後的日期

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
  admitted: { tbody: '#jf-admitted', list: () => state.result.admitted, blank: () => ({ seq: String(state.result.admitted.length + 1), candidateNo: '', nameMasked: '' }),
    row: (a, i) => `<tr data-i="${i}"><td>${inp('seq', a.seq, { type: 'number', label: '序號', size: 3 })}</td><td>${inp('candidateNo', a.candidateNo, { label: '報名編號' })}</td><td>${inp('nameMasked', a.nameMasked, { label: '遮罩姓名', size: 8 })}${why}</td>${del('admitted', i, `正取第 ${i + 1} 列`)}</tr>` },
  waitlist: { tbody: '#jf-waitlist', list: () => state.result.waitlist, blank: () => ({ rank: String(state.result.waitlist.length + 1), candidateNo: '', nameMasked: '', validUntil: state.result.waitlist.at(-1)?.validUntil ?? '' }),
    row: (a, i) => `<tr data-i="${i}"><td>${inp('rank', a.rank, { type: 'number', label: '順位', size: 3 })}</td><td>${inp('candidateNo', a.candidateNo, { label: '報名編號' })}</td><td>${inp('nameMasked', a.nameMasked, { label: '遮罩姓名', size: 8 })}${why}</td><td>${inp('validUntil', a.validUntil, { type: 'date', label: '備取有效至' })}</td>${del('waitlist', i, `備取第 ${i + 1} 列`)}</tr>` },
  wlu: { tbody: '#jf-wlu', list: () => state.waitlistUpdates, blank: () => ({ date: TODAY, candidateNo: '', nameMasked: '', note: '' }),
    row: (a, i) => `<tr data-i="${i}"><td>${inp('date', a.date, { type: 'date', label: '遞補日期' })}</td><td>${inp('candidateNo', a.candidateNo, { label: '報名編號' })}</td><td>${inp('nameMasked', a.nameMasked, { label: '遮罩姓名', size: 8 })}${why}</td><td>${inp('note', a.note, { label: '遞補說明' })}</td>${del('wlu', i, `遞補第 ${i + 1} 筆`)}</tr>` },
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
  for (const k of Object.keys(ROWS)) renderRows(k);
}
function read() {
  const st = { ...state };
  for (const [k, sel] of Object.entries(SIMPLE)) st[k] = $(sel).value;
  st.manualStatus = $('input[name="jf-ms"]:checked')?.value ?? '';
  st.hasResult = $('#jf-has-result').checked;
  st.examPlan = readRows('exam');
  st.amendments = readRows('am');
  st.result = { ...state.result, publishedAt: $('#jf-r-date').value, refNo: $('#jf-r-ref').value, note: $('#jf-r-note').value, admitted: readRows('admitted'), waitlist: readRows('waitlist') };
  st.waitlistUpdates = readRows('wlu');
  state = st;
  return st;
}
const currentJob = () => buildJob(read(), { today: TODAY, base });
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
      <li class="${rowBad ? 'is-no' : 'is-ok'}">${rowBad ? `✗ ${rowBad} 列遮罩姓名或報名編號未通過（左側標紅）` : `✓ ${[...rp.admitted, ...rp.waitlist, ...rp.updates].length} 列遮罩姓名與報名編號都通過`}</li>
      <li class="${job.positions != null && admittedN > job.positions ? 'is-no' : 'is-ok'}">${job.positions != null && admittedN > job.positions ? '✗' : '✓'} 正取 ${admittedN} ／ 名額 ${esc(job.positions ?? '—')}</li>
      <li class="${(job.result?.waitlist ?? []).some((w) => !w.validUntil) ? 'is-no' : 'is-ok'}">${(job.result?.waitlist ?? []).some((w) => !w.validUntil) ? '✗ 有備取沒有填有效期限' : `✓ 備取 ${(job.result?.waitlist ?? []).length} 位`}</li></ul>` : ''}`;
  // 結果列標紅
  for (const [kind, list] of [['admitted', rp.admitted], ['waitlist', rp.waitlist], ['wlu', rp.updates]]) {
    $$(`${ROWS[kind].tbody} tr`).forEach((tr, i) => {
      const msgs = list[i] ?? [];
      tr.classList.toggle('adm-jf-bad', msgs.length > 0);
      const w = $('[data-why]', tr); if (w) { w.hidden = !msgs.length; w.textContent = msgs.join('；'); }
      for (const el of $$('input[data-k="nameMasked"], input[data-k="candidateNo"]', tr)) el.setAttribute('aria-invalid', msgs.length ? 'true' : 'false');
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
  // 匯出
  $('#jf-file').textContent = exportFilename(job);
  $('#jf-out').textContent = JSON.stringify(job, null, 2);
}

/* ───────── 事件 ───────── */
function load(id) {
  base = id && id !== 'new' ? byId.get(id) ?? null : null;
  const { stage, ...clean } = base ?? {};
  if (base) base = clean;
  baseline = base ? datesOf(base) : null;
  fill(base ? stateFromJob(base) : emptyState());
  $('#jf-am-msg').textContent = '';
}
$('#jf-pick').addEventListener('change', (e) => { load(e.target.value); paint(); });
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
    if (state.hasResult && !state.result.admitted.length) { state.result.admitted.push(ROWS.admitted.blank()); renderRows('admitted'); }
  }
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
$('#jf-save').addEventListener('click', () => { read(); store.set(KEY, { pick: base?.id ?? 'new', state, baseline, savedAt: new Date().toISOString() }); $('#jf-msg').textContent = '草稿已存在這台電腦的瀏覽器。'; });
$('#jf-reset').addEventListener('click', () => { store.del(KEY); load($('#jf-pick').value); paint(); $('#jf-msg').textContent = '已放棄草稿，重新帶入目前公告內容。'; });
$('#jf-copy').addEventListener('click', (e) => copyText(`${$('#jf-out').textContent}\n`, e.currentTarget));
$('#jf-dl').addEventListener('click', () => downloadText(exportFilename(currentJob()).split('/').pop(), `${$('#jf-out').textContent}\n`));

// 初始：網址 ?id=job.… 優先，其次本機草稿，否則新增
const qid = new URLSearchParams(location.search).get('id');
const saved = store.get(KEY);
if (qid && byId.has(qid)) load(qid);
else if (saved?.state && (saved.pick === 'new' || byId.has(saved.pick))) {
  load(saved.pick);
  baseline = saved.baseline ?? baseline;
  fill({ ...emptyState(), ...saved.state, result: { ...emptyState().result, ...(saved.state.result ?? {}) } });
  $('#jf-msg').textContent = `已還原 ${saved.savedAt ? saved.savedAt.slice(0, 16).replace('T', ' ') : ''} 的本機草稿。`;
} else load('new');
paint();
