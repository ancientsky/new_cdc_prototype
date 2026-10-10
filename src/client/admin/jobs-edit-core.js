// /admin/jobs/edit/ 人才招募上架與異動：純函式（不碰 DOM），瀏覽器與測試共用。
// 表單狀態（全部是字串或簡單陣列）→ job 物件；異動紀錄判定；發布前問題清單；匯出檔名。
// 個資檢核直接用 ../careers-rules.js（與 CI 的 scripts/lib/validate.mjs 同一份），所以表單說「通過」，建置就一定通過。
import { jobPiiErrors, jobResultProblems, candidateNoProblems, jobStageOf, defaultUnpublishAt, NATIONAL_ID_RE } from '../careers-rules.js';

export { jobStageOf };
/** 第三十輪：建議下架日（與建置同一份規則：max(公告日 + 3 個月, 最後一位備取有效期限隔天)） */
export const suggestedUnpublishAt = (result) => defaultUnpublishAt(result);

export const JOB_TYPES = ['約聘人員', '約僱人員', '聘用研究員', '公費醫師', '技工工友駐衛警', '公務人員商調', '計畫助理', '臨時人員'];
export const EXAM_STAGES = ['書面審查', '筆試', '口試', '實作', '體能'];
export const APPLY_METHODS = { online: '線上報名', email: '電子郵件', mail: '郵寄', 'in-person': '親送' };
export const AMEND_KINDS = { extend: '展延', reschedule: '改期', correction: '更正', cancel: '取消', other: '其他' };
export const MANUAL_STATUS = { '': '維持自動（依日期與結果推導）', cancelled: '停止甄選（cancelled）', filled: '已補實（filled）' };
export const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** 建置時才加上的欄位：匯出時一律去掉 */
const BUILD_KEYS = new Set(['gov', 'sourceHash']);

/* ───────── 小工具 ───────── */
const s = (v) => String(v ?? '').trim();
/** textarea 每行一項 → 陣列（去空行） */
export const linesOf = (text) => String(text ?? '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
/** 「標題 | 網址 | 格式」每行一筆 → attachments[] */
export function parseAttachments(text) {
  return linesOf(text).map((line) => {
    const [label = '', url = '', format = ''] = line.split('|').map((x) => x.trim());
    return { label, url, ...(format ? { format } : {}) };
  }).filter((a) => a.label || a.url);
}
export const attachmentsText = (list) => (list ?? []).map((a) => [a.label, a.url, a.format].filter((x) => x != null && x !== '').join(' | ')).join('\n');
/** id 的公告日（job.YYYY-MM-DD-slug） */
export const idDateOf = (id) => (String(id ?? '').match(/^job\.(\d{4}-\d{2}-\d{2})-/) ?? [])[1] ?? null;
export const jobIdOf = (date, slug) => `job.${date}-${slug}`;
/** 去掉建置欄位（gov、__file、sourceHash…），回傳可寫回 content/ 的乾淨物件 */
export function stripBuild(job) {
  return Object.fromEntries(Object.entries(job ?? {}).filter(([k]) => !k.startsWith('__') && !BUILD_KEYS.has(k)));
}
const intOrNull = (v) => { const n = Number(s(v)); return s(v) !== '' && Number.isInteger(n) ? n : null; };

/* ───────── 表單狀態 ↔ job ───────── */
/** 新增職缺的空白表單狀態 */
export function emptyState() {
  return {
    mode: 'new', title: '', summary: '', slug: '', refNo: '', hiringUnit: '', jobType: '', positions: '', workplace: '', salaryNote: '',
    qualifications: '', duties: '', requiredDocuments: '', applyStart: '', deadlineAt: '', applyMethod: 'online', applyUrl: '',
    examPlan: [{ stage: '書面審查', date: '', note: '' }], resultPlannedAt: '', contact: '', attachments: '',
    amendments: [], manualStatus: '', manualStatusNote: '',
    hasResult: false, result: { publishedAt: '', unpublishAt: '', externalUrl: '', refNo: '', note: '', admitted: [], waitlist: [] }, waitlistUpdates: [],
  };
}
/** 既有職缺 → 表單狀態（選到既有職缺＝帶入全部欄位） */
export function stateFromJob(job) {
  const r = job.result;
  return {
    mode: job.id, title: job.title ?? '', summary: job.summary ?? '', slug: job.slug ?? '', refNo: job.refNo ?? '', hiringUnit: job.hiringUnit ?? '', jobType: job.jobType ?? '',
    positions: job.positions != null ? String(job.positions) : '', workplace: job.workplace ?? '', salaryNote: job.salaryNote ?? '',
    qualifications: (job.qualifications ?? []).join('\n'), duties: (job.duties ?? []).join('\n'), requiredDocuments: (job.requiredDocuments ?? []).join('\n'),
    applyStart: job.applyStart ?? '', deadlineAt: job.deadlineAt ?? '', applyMethod: job.applyMethod ?? 'online', applyUrl: job.applyUrl ?? '',
    examPlan: (job.examPlan ?? []).map((e) => ({ stage: e.stage ?? '書面審查', date: e.date ?? '', note: e.note ?? '' })),
    resultPlannedAt: job.resultPlannedAt ?? '', contact: job.contact ?? '', attachments: attachmentsText(job.attachments),
    amendments: (job.amendments ?? []).map((a) => ({ ...a })), manualStatus: job.manualStatus ?? '', manualStatusNote: job.manualStatusNote ?? '',
    hasResult: !!r,
    result: {
      publishedAt: r?.publishedAt ?? '', unpublishAt: r?.unpublishAt ?? '', externalUrl: r?.externalUrl ?? '', refNo: r?.refNo ?? '', note: r?.note ?? '',
      admitted: (r?.admitted ?? []).map((a) => ({ seq: a.seq != null ? String(a.seq) : '', candidateNo: a.candidateNo ?? '' })),
      waitlist: (r?.waitlist ?? []).map((w) => ({ rank: w.rank != null ? String(w.rank) : '', candidateNo: w.candidateNo ?? '', validUntil: w.validUntil ?? '' })),
    },
    waitlistUpdates: (job.waitlistUpdates ?? []).map((u) => ({ date: u.date ?? '', candidateNo: u.candidateNo ?? '', note: u.note ?? '' })),
  };
}

/**
 * 表單狀態 → 完整 job 物件（可直接存成 content/jobs/{yyyy-mm-dd}-{slug}.json）。
 * base：選到的既有職缺（未選＝新增）。既有職缺的 id、slug、publishedAt、keywords、languages、i18n、legacyIds 等表單沒有的欄位一律保留。
 */
export function buildJob(state, { today, base = null } = {}) {
  const old = base ? stripBuild(base) : {};
  const publishedAt = old.publishedAt ?? today;
  const slug = base ? (old.slug ?? s(state.slug)) : s(state.slug);
  const id = base ? old.id : jobIdOf(publishedAt, slug || '（未填）');
  const ms = s(state.manualStatus);
  const rows = (list, keys) => (list ?? []).filter((r) => keys.some((k) => s(r[k])));
  // 第三十輪（#55）：結果列只有序號／順位、報名編號（與備取有效期）；姓名欄一律不輸出（舊草稿裡的 nameMasked 也會被丟掉）。
  // 填了 externalUrl（名單在人事系統）而沒有任何名單列 ⇒ 不輸出 admitted。
  const admittedRows = rows(state.result?.admitted, ['seq', 'candidateNo']);
  const ext = s(state.result?.externalUrl);
  const result = state.hasResult ? {
    publishedAt: s(state.result?.publishedAt),
    ...(s(state.result?.unpublishAt) ? { unpublishAt: s(state.result.unpublishAt) } : {}),
    ...(ext ? { externalUrl: ext } : {}),
    ...(s(state.result?.refNo) ? { refNo: s(state.result.refNo) } : {}),
    ...(!ext || admittedRows.length ? { admitted: admittedRows.map((a, i) => ({ seq: intOrNull(a.seq) ?? i + 1, candidateNo: s(a.candidateNo) })) } : {}),
    ...(rows(state.result?.waitlist, ['rank', 'candidateNo']).length ? {
      waitlist: rows(state.result.waitlist, ['rank', 'candidateNo']).map((w, i) => ({ rank: intOrNull(w.rank) ?? i + 1, candidateNo: s(w.candidateNo), ...(s(w.validUntil) ? { validUntil: s(w.validUntil) } : {}) })),
    } : {}),
    ...(s(state.result?.note) ? { note: s(state.result.note) } : {}),
    ...(old.result?.attachments ? { attachments: old.result.attachments } : {}),
  } : null;
  const wlu = rows(state.waitlistUpdates, ['date', 'candidateNo']).map((u) => ({ date: s(u.date), candidateNo: s(u.candidateNo), ...(s(u.note) ? { note: s(u.note) } : {}) }));
  const attachments = parseAttachments(state.attachments).map((a) => {
    const prev = (old.attachments ?? []).find((x) => x.url === a.url);
    return prev && prev.machineReadable != null ? { ...a, machineReadable: prev.machineReadable } : a;
  });
  const amendments = (state.amendments ?? []).filter((a) => s(a.text)).map((a) => ({ date: s(a.date) || today, kind: a.kind in AMEND_KINDS ? a.kind : 'other', text: s(a.text), ...(s(a.refNo) ? { refNo: s(a.refNo) } : {}) }));
  const job = {
    id, type: 'job', title: s(state.title), owner: 'unit.personnel', steward: old.steward ?? '人事室承辦人',
    publishedAt, reviewedAt: today, reviewPeriodMonths: 0, status: 'published', audience: ['public'], sensitivity: 'public', license: 'OGDL-1.0',
    aiWhitelist: { requested: true, approvedBy: 'unit.oasis', approvedAt: today },
    languages: old.languages ?? { 'zh-TW': { status: 'source' } },
    summary: s(state.summary),
    ...(old.keywords ? { keywords: old.keywords } : {}),
    ...(old.i18n ? { i18n: old.i18n } : {}),
    slug,
    ...(old.legacyIds ? { legacyIds: old.legacyIds } : {}),
    ...(old.legacyUrls ? { legacyUrls: old.legacyUrls } : {}),
    ...(s(state.refNo) ? { refNo: s(state.refNo) } : {}),
    hiringUnit: s(state.hiringUnit), jobType: s(state.jobType), positions: intOrNull(state.positions), workplace: s(state.workplace), salaryNote: s(state.salaryNote),
    qualifications: linesOf(state.qualifications), duties: linesOf(state.duties), requiredDocuments: linesOf(state.requiredDocuments),
    applyStart: s(state.applyStart), deadlineAt: s(state.deadlineAt), applyMethod: s(state.applyMethod) || 'online',
    ...(s(state.applyUrl) ? { applyUrl: s(state.applyUrl) } : {}),
    examPlan: (state.examPlan ?? []).filter((e) => s(e.stage)).map((e) => ({ stage: s(e.stage), ...(s(e.date) ? { date: s(e.date) } : {}), ...(s(e.note) ? { note: s(e.note) } : {}) })),
    ...(s(state.resultPlannedAt) ? { resultPlannedAt: s(state.resultPlannedAt) } : {}),
    contact: s(state.contact),
    ...(attachments.length ? { attachments } : {}),
    ...(amendments.length ? { amendments } : {}),
    ...(ms ? { manualStatus: ms } : {}),
    ...(ms && s(state.manualStatusNote) ? { manualStatusNote: s(state.manualStatusNote) } : {}),
    ...(result ? { result } : {}),
    ...(wlu.length ? { waitlistUpdates: wlu } : {}),
  };
  // 其餘表單沒有的欄位（assets、postPublishReview、note…）原樣保留，放在最後
  for (const [k, v] of Object.entries(old)) if (!(k in job) && !['manualStatus', 'manualStatusNote', 'result', 'waitlistUpdates', 'amendments', 'applyUrl', 'refNo', 'resultPlannedAt', 'attachments'].includes(k)) job[k] = v;
  if (job.positions == null) delete job.positions;
  return job;
}

/* ───────── 異動紀錄 ───────── */
/** 有時程意義的日期欄位：before → after 的對照（只列有變動者） */
export function dateChanges(before, after) {
  const out = [];
  const add = (field, label, from, to) => { if ((from ?? '') !== (to ?? '')) out.push({ field, label, from: from || '', to: to || '' }); };
  add('applyStart', '報名開始日', before?.applyStart, after?.applyStart);
  add('deadlineAt', '報名截止日', before?.deadlineAt, after?.deadlineAt);
  const a = before?.examPlan ?? [], b = after?.examPlan ?? [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    add(`examPlan[${i}]`, `${b[i]?.stage ?? a[i]?.stage ?? '甄試'}日期`, a[i]?.date, b[i]?.date);
  }
  add('resultPlannedAt', '結果預計公布日', before?.resultPlannedAt, after?.resultPlannedAt);
  return out;
}
const changeText = (c) => (c.from && c.to ? `${c.label}由 ${c.from} ${c.field === 'deadlineAt' && c.to > c.from ? '展延' : '改'}至 ${c.to}` : c.to ? `${c.label}訂為 ${c.to}` : `${c.label}（原 ${c.from}）改為另行公告`);
/**
 * 比對異動前後 → { kind, changes, compare, amendment }。
 * kind：deadlineAt 變晚＝extend；其他日期有變動＝reschedule；日期都沒變、只有說明＝correction。
 * compare：新舊日期對照（給民眾看的一句話，text 留空時當作異動說明）。
 */
export function amendmentFor(before, after, text, today, refNo = '') {
  const changes = dateChanges(before, after);
  const dl = changes.find((c) => c.field === 'deadlineAt');
  const kind = dl && dl.from && dl.to && dl.to > dl.from ? 'extend' : changes.length ? 'reschedule' : 'correction';
  const compare = changes.map(changeText).join('；');
  const t = s(text) || compare;
  const amendment = t ? { date: today, kind, text: t.slice(0, 300), ...(s(refNo) ? { refNo: s(refNo) } : {}) } : null;
  return { kind, changes, compare, amendment };
}
/** 取消／補實時自動追加的異動紀錄（kind=cancel；文字可再編修） */
export function cancelAmendment(manualStatus, note, today) {
  if (manualStatus !== 'cancelled' && manualStatus !== 'filled') return null;
  const why = s(note);
  const text = manualStatus === 'cancelled' ? `本職缺停止甄選，不再受理報名${why ? `：${why}` : '。'}` : `本職缺已補實，不再受理報名${why ? `：${why}` : '。'}`;
  return { date: today, kind: 'cancel', text };
}
/** 依日期倒序（同日保留原順序的反向，最新加入者在前） */
export const amendmentsSorted = (list) => (list ?? []).map((a, i) => ({ a, i })).sort((x, y) => String(y.a.date).localeCompare(String(x.a.date)) || y.i - x.i).map((x) => x.a);

/* ───────── 檢核 ───────── */
/** 結果表每一列的個資問題（給表單把列標紅）：{ admitted: string[][], waitlist: string[][], updates: string[][] }（第三十輪起只剩報名編號要檢查） */
export function rowProblems(job) {
  const row = (r) => candidateNoProblems(r?.candidateNo);
  return {
    admitted: (job.result?.admitted ?? []).map(row),
    waitlist: (job.result?.waitlist ?? []).map(row),
    updates: (job.waitlistUpdates ?? []).map(row),
  };
}
/**
 * 發布前問題清單（字串陣列；空陣列＝可匯出開 PR）。
 * existingIds：其他職缺的 id（編輯既有職缺時請排除它自己），用來檢查 slug 重複。
 * 規則與 CI（schemas/job.json、scripts/lib/validate.mjs）一致；個資檢核直接呼叫 jobPiiErrors()。
 */
export function problemsOf(job, today, existingIds = []) {
  const p = [];
  const need = (v, label) => { if (v == null || v === '' || (Array.isArray(v) && !v.length)) p.push(`${label}未填`); };
  need(job.title, '職缺名稱（title）'); need(job.summary, '摘要（summary）'); need(job.slug, '網址代稱（slug）');
  need(job.hiringUnit, '用人單位'); need(job.jobType, '職類'); need(job.positions, '名額');
  need(job.workplace, '工作地點'); need(job.salaryNote, '薪資待遇'); need(job.qualifications, '資格條件（至少一項）'); need(job.duties, '工作內容（至少一項）');
  need(job.requiredDocuments, '應備文件（至少一項）'); need(job.applyStart, '報名開始日'); need(job.deadlineAt, '報名截止日'); need(job.contact, '聯絡窗口');
  need(job.resultPlannedAt, '結果預計公布日（逾期提醒以此為基準）');
  if (job.slug && !SLUG_RE.test(job.slug)) p.push(`slug「${job.slug}」格式不符：只能用小寫英文、數字與連字號，且不能以連字號開頭`);
  const dup = (existingIds ?? []).find((x) => x !== job.id && String(x).replace(/^job\.\d{4}-\d{2}-\d{2}-/, '') === job.slug);
  if (job.slug && dup) p.push(`slug「${job.slug}」與既有職缺 ${dup} 重複（前台路徑會衝突）`);
  if (job.positions != null && (!Number.isInteger(job.positions) || job.positions < 1)) p.push('名額需為 1 以上的整數');
  if (job.jobType && !JOB_TYPES.includes(job.jobType)) p.push(`職類「${job.jobType}」不在八種職類內`);
  for (const [k, label] of [['applyStart', '報名開始日'], ['deadlineAt', '報名截止日'], ['resultPlannedAt', '結果預計公布日']]) if (job[k] && !DATE_RE.test(job[k])) p.push(`${label}格式需為 YYYY-MM-DD`);
  if (job.applyStart && job.deadlineAt && job.applyStart > job.deadlineAt) p.push(`報名開始日 ${job.applyStart} 晚於截止日 ${job.deadlineAt}`);
  for (const e of job.examPlan ?? []) if (e.date && job.deadlineAt && e.date < job.deadlineAt) p.push(`甄試「${e.stage}」日期 ${e.date} 早於報名截止 ${job.deadlineAt}`);
  if (job.resultPlannedAt && job.deadlineAt && job.resultPlannedAt < job.deadlineAt) p.push(`結果預計公布日 ${job.resultPlannedAt} 早於報名截止 ${job.deadlineAt}`);
  if (job.applyUrl && !/^https?:\/\//.test(job.applyUrl)) p.push('外部報名網址需以 http:// 或 https:// 開頭');
  for (const a of job.attachments ?? []) if (!a.label || !a.url) p.push(`附件「${a.label || a.url}」需同時有標題與網址（每行：標題 | 網址 | 格式）`);
  for (const a of job.amendments ?? []) if (String(a.text).length > 300) p.push(`異動說明（${a.date}）超過 300 字`);
  for (const a of job.amendments ?? []) if (NATIONAL_ID_RE.test(String(a.text))) p.push(`異動說明（${a.date}）含身分證字號樣式：公開文字不得含個資`);
  if (job.manualStatus === 'cancelled' && job.result) p.push('已取消（停止甄選）的職缺不得有甄選結果：請先移除結果，或改選「已補實」');
  if (job.manualStatus && !(job.amendments ?? []).some((a) => a.kind === 'cancel')) p.push('已選取消／補實，但異動紀錄沒有「取消」一筆（民眾看不到原因）');
  if (job.result) {
    if (!job.result.publishedAt) p.push('甄選結果的公告日未填');
    else if (job.deadlineAt && job.result.publishedAt < job.deadlineAt) p.push(`結果公告日 ${job.result.publishedAt} 早於報名截止 ${job.deadlineAt}`);
    const seqs = (job.result.admitted ?? []).map((a) => a.seq); if (seqs.some((x, i) => seqs.indexOf(x) !== i)) p.push('正取序號重複');
    const ranks = (job.result.waitlist ?? []).map((a) => a.rank); if (ranks.some((x, i) => ranks.indexOf(x) !== i)) p.push('備取順位重複');
  }
  for (const u of job.waitlistUpdates ?? []) if (!u.date) p.push(`遞補公告（${u.candidateNo || '未填編號'}）的日期未填`);
  if ((job.waitlistUpdates ?? []).length && !job.result) p.push('有遞補公告但沒有甄選結果');
  p.push(...jobPiiErrors(job));
  p.push(...jobResultProblems(job, today)); // 第三十輪：下架日必填與上下限、externalUrl 與名單擇一
  return p;
}

/** 關鍵日期一覽（預覽用） */
export function keyDates(job) {
  return [
    ['公告日', job.publishedAt], ['報名開始', job.applyStart], ['報名截止', job.deadlineAt],
    ...(job.examPlan ?? []).map((e) => [`甄試：${e.stage}`, e.date || '另行公告']),
    ['結果預計公布', job.resultPlannedAt], ...(job.result ? [['結果公告', job.result.publishedAt], ['結果下架', job.result.unpublishAt]] : []),
  ].filter(([, v]) => v);
}

/** 應存的檔名：content/jobs/{id 的日期}-{slug}.json */
export function exportFilename(job) {
  const date = idDateOf(job.id) ?? job.publishedAt;
  return `content/jobs/${date}-${job.slug || 'slug'}.json`;
}
