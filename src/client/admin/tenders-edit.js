// /admin/tenders/edit/ 採購公告上架與異動：只做 DOM 綁定；組物件、檢核、異動紀錄都在 tenders-edit-core.js。
import { $, esc, store, readEmbedded, copyText, downloadText } from './common.js';
import {
  buildTender, problemsOf, amendmentFor, cancelAmendment, exportFilename, dateChanges, describeChanges, stageInfo, sortedAmendments,
  attachmentsText, slugOfId, DATE_FIELDS,
} from './tenders-edit-core.js';

const D = readEmbedded('adm-tenders-data', { tenders: [], units: [], stages: {}, amendKinds: {} });
const KEY = 'cdc.admin.tenders-edit';
const TODAY = D.today;
const byId = new Map(D.tenders.map((x) => [x.id, x]));
const KIND = D.amendKinds ?? {};

let base = null; // 既有標案（新增時 null）
let orig = {}; // 帶入時的日期（預覽新舊對照用）
let mark = {}; // 上次加入異動紀錄時的日期（判斷還有沒有未記錄的改期）
let amendments = []; // 含既有紀錄；本次新增的帶 _new
let autoCancel = null; // C 區自動加入的那一筆

const datesOf = (x) => Object.fromEntries(Object.keys(DATE_FIELDS).map((k) => [k, x?.[k] ?? '']));
const asText = (v) => (Array.isArray(v) ? v.join('\n') : v ?? '');
const val = (id) => $(`#${id}`).value;
const setVal = (id, v) => { $(`#${id}`).value = v ?? ''; };

function fill(x) {
  base = x?.id && byId.has(x.id) ? byId.get(x.id) : null;
  const t = x ?? {};
  setVal('tf-pick', base?.id ?? '');
  setVal('tf-title', t.title); setVal('tf-summary', t.summary); setVal('tf-slug', t.slug ?? (t.id ? slugOfId(t.id) : ''));
  setVal('tf-no', t.tenderNo); setVal('tf-unit', t.requestingUnit); setVal('tf-method', t.method); setVal('tf-rule', t.awardRule); setVal('tf-cat', t.category);
  setVal('tf-budget', t.budgetNtd); setVal('tf-announced', t.announcedAt); setVal('tf-deadline', t.deadlineAt); setVal('tf-opening', t.openingAt); setVal('tf-briefing', t.briefingAt);
  setVal('tf-pcc', t.pccUrl); setVal('tf-scope', asText(t.scope)); setVal('tf-terms', asText(t.specialTerms)); setVal('tf-period', t.contractPeriod);
  setVal('tf-att', Array.isArray(t.attachments) ? attachmentsText(t.attachments) : t.attachments); setVal('tf-contact', t.contact);
  const ms = $(`input[name="tf-ms"][value="${t.manualStatus ?? ''}"]`); if (ms) ms.checked = true;
  setVal('tf-ms-note', t.manualStatusNote);
  setVal('tf-aw-date', t.award?.date); setVal('tf-aw-winner', t.award?.winner); setVal('tf-aw-amount', t.award?.amountNtd); setVal('tf-aw-note', t.award?.note);
  setVal('tf-am-text', ''); setVal('tf-am-ref', '');
  amendments = (t.amendments ?? []).map((a) => ({ ...a }));
  autoCancel = amendments.find((a) => a._auto) ?? null;
  setVal('tf-cancel-text', autoCancel?.text ?? '');
  orig = datesOf(base ?? {}); mark = x?._mark ?? datesOf(base ?? {});
  $('#tf-slug').readOnly = !!base; $('#tf-slug-lock').hidden = !base;
  $('#tf-b-new').hidden = !!base; $('#tf-b-body').hidden = !base;
}

function read() {
  return {
    slug: val('tf-slug').trim(), title: val('tf-title'), summary: val('tf-summary'), tenderNo: val('tf-no'), requestingUnit: val('tf-unit'), method: val('tf-method'), awardRule: val('tf-rule'),
    category: val('tf-cat'), budgetNtd: val('tf-budget'), announcedAt: val('tf-announced'), deadlineAt: val('tf-deadline'), openingAt: val('tf-opening'), briefingAt: val('tf-briefing'),
    pccUrl: val('tf-pcc'), scope: val('tf-scope'), specialTerms: val('tf-terms'), contractPeriod: val('tf-period'), attachments: val('tf-att'), contact: val('tf-contact'),
    amendments, manualStatus: $('input[name="tf-ms"]:checked')?.value ?? '', manualStatusNote: val('tf-ms-note'),
    award: { date: val('tf-aw-date'), winner: val('tf-aw-winner'), amountNtd: val('tf-aw-amount'), note: val('tf-aw-note') },
  };
}
const current = () => buildTender(read(), { today: TODAY, base });
const otherIds = () => D.tenders.map((x) => x.id).filter((id) => id !== base?.id);

function paintAmends() {
  $('#tf-amends').innerHTML = amendments.length ? sortedAmendments(amendments).map((a) => {
    const i = amendments.indexOf(a);
    return `<li class="adm-tf-amend${a._new ? ' is-new' : ''}"><span class="adm-badge adm-badge--${a.kind === 'cancel' ? 'warn' : a.kind === 'extend' ? 'info' : 'gray'}">${esc(KIND[a.kind] ?? a.kind)}</span> <time>${esc(a.date)}</time> ${esc(a.text)}${a.refNo ? ` <span class="adm-muted">（${esc(a.refNo)}）</span>` : ''}${a._new ? ` <button type="button" class="adm-btn adm-btn--ghost adm-btn--sm" data-del="${i}">移除</button>` : ' <span class="adm-muted">已公告</span>'}</li>`;
  }).join('') : '<li class="adm-muted">尚無異動紀錄。</li>';
}

function previewHtml(t) {
  const st = stageInfo(t, TODAY);
  const now = datesOf(t);
  const ch = base ? dateChanges(orig, now) : [];
  const row = (label, v, k) => {
    const c = ch.find((x) => x.field === k);
    const cell = c ? `<del>${esc(c.from || '（未定）')}</del> → <ins>${esc(c.to || '（取消）')}</ins>` : esc(v || '—');
    return `<tr${c ? ' class="adm-tf-changed"' : ''}><th scope="row">${label}</th><td>${cell}</td></tr>`;
  };
  const am = sortedAmendments(t.amendments ?? []);
  return `<div class="adm-tf-head"><span class="adm-badge adm-badge--${st.badge}">${esc(st.label)}</span> <span class="adm-muted">以 ${esc(TODAY)} 推導（同 CI）</span></div>
  <h3 class="adm-tf-title">${esc(t.title || '（標案名稱）')}</h3>
  <p class="adm-muted">前台：/procurement/${esc(t.slug || 'slug')}/ · <code>${esc(t.id)}</code></p>
  <table class="adm-table adm-tf-dates"><tbody>
    ${row('公告日', t.announcedAt, 'announcedAt')}${row('投標截止', t.deadlineAt, 'deadlineAt')}${row('廠商說明會', t.briefingAt, 'briefingAt')}${row('開標', t.openingAt, 'openingAt')}
    <tr><th scope="row">決標</th><td>${t.award ? `${esc(t.award.date || '（日期未填）')}｜${esc(t.award.winner || '（廠商未填）')}${t.award.amountNtd != null ? `｜NT$ ${esc(Number(t.award.amountNtd).toLocaleString('en-US'))}` : ''}` : t.manualStatus ? esc(t.manualStatus === 'failed' ? `流標${t.manualStatusNote ? `：${t.manualStatusNote}` : ''}` : `廢標／取消${t.manualStatusNote ? `：${t.manualStatusNote}` : ''}`) : '—'}</td></tr>
  </tbody></table>
  ${ch.length || amendments.some((a) => a._new) ? '<div class="adm-box adm-box--note adm-tf-pcc"><strong>以政府電子採購網為準</strong>本站更正後，請到採購網核對同一案的更正公告日期一致；不一致以採購網為準，並回來修正。</div>' : ''}
  <h4 class="adm-tf-h3">公告異動（前台依日期倒序）</h4>
  ${am.length ? `<ul class="adm-tf-amends adm-tf-amends--pv">${am.map((a) => `<li><span class="adm-badge adm-badge--gray">${esc(KIND[a.kind] ?? a.kind)}</span> <time>${esc(a.date)}</time> ${esc(a.text)}${a.refNo ? `（${esc(a.refNo)}）` : ''}</li>`).join('')}</ul>` : '<p class="adm-muted">沒有異動紀錄。</p>'}`;
}

function paint() {
  const t = current();
  $('#tf-slug-echo').textContent = t.slug || 'slug';
  const pending = base ? dateChanges(mark, datesOf(t)) : [];
  $('#tf-diff').innerHTML = pending.length
    ? `<ul class="adm-tf-difflist">${pending.map((c) => `<li><b>${esc(c.label)}</b>：<del>${esc(c.from || '（未定）')}</del> → <ins>${esc(c.to || '（取消）')}</ins></li>`).join('')}</ul>`
    : '<p class="adm-muted">日期沒有變動。</p>';
  $('#tf-am-text').placeholder = pending.length ? describeChanges(pending) : '只改內容時，寫一句更正說明';
  paintAmends();
  $('#tf-preview').innerHTML = previewHtml(t);
  const w = problemsOf(t, TODAY, otherIds());
  if (pending.length) w.push({ level: 'warn', field: 'amendments', text: `時程已改（${pending.map((c) => c.label).join('、')}）但還沒按「加入異動紀錄」：前台不會告訴廠商改了什麼` });
  const errs = w.filter((x) => x.level === 'error'), warns = w.filter((x) => x.level === 'warn');
  $('#tf-warn').innerHTML = (errs.length ? `<div class="adm-box adm-box--warn" role="status"><strong>發布前請補齊（${errs.length}）</strong><ul class="adm-tf-list">${errs.map((x) => `<li>${esc(x.text)}</li>`).join('')}</ul></div>` : '<div class="adm-box adm-box--ok"><strong>必填與日期檢核都通過</strong>可以匯出開 PR。</div>')
    + (warns.length ? `<div class="adm-box adm-box--note"><strong>提醒（${warns.length}）</strong><ul class="adm-tf-list">${warns.map((x) => `<li>${esc(x.text)}</li>`).join('')}</ul></div>` : '');
  $('#tf-file').textContent = exportFilename(t);
  $('#tf-out').textContent = JSON.stringify(t, null, 2);
}

function syncCancel() {
  const ms = $('input[name="tf-ms"]:checked')?.value ?? '';
  if (!ms) { if (autoCancel) amendments = amendments.filter((a) => a !== autoCancel); autoCancel = null; setVal('tf-cancel-text', ''); return; }
  const fresh = cancelAmendment(ms, val('tf-ms-note'), TODAY);
  if (!autoCancel) { autoCancel = { ...fresh, _new: true, _auto: true }; amendments.push(autoCancel); setVal('tf-cancel-text', autoCancel.text); }
  else if (!autoCancel._edited) { autoCancel.text = fresh.text; setVal('tf-cancel-text', fresh.text); }
}

function addAmendment() {
  const t = current();
  const a = amendmentFor(mark, datesOf(t), val('tf-am-text'), TODAY, val('tf-am-ref'));
  if (!a) { $('#tf-msg').textContent = '日期沒有變動、也沒有寫說明，沒有東西可以加入。'; return; }
  amendments.push({ ...a, _new: true });
  mark = datesOf(t);
  setVal('tf-am-text', ''); setVal('tf-am-ref', '');
  $('#tf-msg').textContent = `已加入一筆「${KIND[a.kind] ?? a.kind}」異動紀錄。`;
  paint();
}

function save() {
  const form = read();
  store.set(KEY, { pick: base?.id ?? '', form: { ...form, id: base?.id, amendments, _mark: mark }, savedAt: new Date().toISOString() });
  $('#tf-msg').textContent = '草稿已存在本機瀏覽器。';
}

$('#tf-form').addEventListener('input', (e) => {
  if (e.target.id === 'tf-cancel-text' && autoCancel) { autoCancel.text = e.target.value; autoCancel._edited = true; }
  if (e.target.id === 'tf-ms-note') syncCancel();
  if (e.target.id === 'tf-slug') e.target.value = e.target.value.toLowerCase();
  paint();
});
$('#tf-form').addEventListener('change', (e) => {
  if (e.target.id === 'tf-pick') { fill(e.target.value ? byId.get(e.target.value) : null); $('#tf-msg').textContent = ''; }
  if (e.target.name === 'tf-ms') syncCancel();
  paint();
});
$('#tf-amends').addEventListener('click', (e) => {
  const b = e.target.closest('[data-del]'); if (!b) return;
  const a = amendments[Number(b.dataset.del)];
  amendments = amendments.filter((x) => x !== a);
  if (a === autoCancel) { autoCancel = null; const r = $('input[name="tf-ms"][value=""]'); if (r) r.checked = true; setVal('tf-cancel-text', ''); }
  paint();
});
$('#tf-am-add').addEventListener('click', addAmendment);
$('#tf-aw-clear').addEventListener('click', () => { ['tf-aw-date', 'tf-aw-winner', 'tf-aw-amount', 'tf-aw-note'].forEach((id) => setVal(id, '')); paint(); });
$('#tf-save').addEventListener('click', save);
$('#tf-reset').addEventListener('click', () => { const id = val('tf-pick'); fill(id ? byId.get(id) : null); store.del(KEY); $('#tf-msg').textContent = '已重新帶入，草稿已清除。'; paint(); });
$('#tf-copy').addEventListener('click', (e) => copyText(`${$('#tf-out').textContent}\n`, e.currentTarget));
$('#tf-dl').addEventListener('click', () => downloadText(exportFilename(current()).split('/').pop(), `${$('#tf-out').textContent}\n`));

// 初始：網址 ?id= 指定 → 本機草稿 → 空白新增
const qid = new URLSearchParams(location.search).get('id');
const saved = store.get(KEY);
if (qid && byId.has(qid)) fill(byId.get(qid));
else if (saved?.form) { fill(saved.form); $('#tf-msg').textContent = `已還原本機草稿（${saved.savedAt?.slice(0, 16).replace('T', ' ') ?? ''}）。`; }
else { fill(null); setVal('tf-announced', TODAY); }
paint();
