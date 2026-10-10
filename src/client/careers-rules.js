// 人才招募（job）與採購公告（tender）的共用規則：瀏覽器與 Node 共用的純函式，沒有任何 import。
// 第十六輪起由 scripts/lib/validate.mjs（個資閘門）與 governance.mjs（階段推導）移到這裡，讓後台上架表單在瀏覽器裡
// 用「同一份」規則即時檢核，不必再抄一份；CI 建置時跑的仍是這幾個函式（契約：ARCHITECTURE 15.1）。
//
// 第三十輪（#55，ARCHITECTURE 35）：甄選結果**不再公布姓名**（連遮罩姓名 nameMasked 也不行），只公布報名編號；
// 結果必須有下架日 result.unpublishAt，下架日起建置不再輸出名單；正式站建議用 result.externalUrl（名單留在人事系統，JSON 只放連結）。
// 為什麼連遮罩姓名都拿掉：名單一旦進 Git 就永遠留在歷史裡，「李○翰＋資訊室系統分析師＋2026 年」仍可能指認出一個人；
// 只有報名編號時，除了本人與人事室，沒有人能把編號對回某個人。

/** 遮罩字（任一即可）：○ U+25CB、◯ U+25EF、〇 U+3007、＊ U+FF0A、* */
export const MASK_CHARS_RE = /[○◯〇＊*]/;
/** 遮罩姓名樣式（中文字＋遮罩字）：出現在結果說明文字（note）裡也擋，代表有人把姓名寫進說明 */
export const MASKED_NAME_RE = /[㐀-䶿一-鿿][○◯〇＊*]{1,2}[㐀-䶿一-鿿]?/u;
/** 身分證字號／居留證號樣式（含新式居留證 8、9 開頭）：出現在任何結果欄位都擋下 */
export const NATIONAL_ID_RE = /[A-Z][1289]\d{8}/i;
/** 報名編號完整比對（契約：^[A-Z][12]\d{8}$ 一律擋下；這裡更嚴，任何位置出現都擋） */
export const CANDIDATE_NO_ID_RE = /^[A-Z][12]\d{8}$/i;
/** 「像姓名」的欄位名：結果每一列只允許下面 RESULT_ROW_KEYS 的欄位，名稱含 name、姓名、名字者一律當成姓名欄 */
export const NAME_FIELD_RE = /name|姓名|名字/i;
/** 結果各列允許的欄位（schema 的 additionalProperties:false 也會擋；這裡給人看得懂的錯誤訊息） */
export const RESULT_ROW_KEYS = {
  admitted: ['seq', 'candidateNo'],
  waitlist: ['rank', 'candidateNo', 'validUntil'],
  updates: ['date', 'candidateNo', 'note'],
};

/* ───────── 下架日（result.unpublishAt） ───────── */
/** 預設下架日：結果公告日起 3 個月（與「錄取結果」頁籤 90 天移入歷史一致）；有備取者至少到最後一位備取有效期限的隔天 */
export const RESULT_DEFAULT_MONTHS = 3;
/** 最短公告期間：公告後至少 30 日（應考人要看得到結果；也涵蓋常見的申復／救濟期間） */
export const RESULT_MIN_DAYS = 30;
/** 最長公告期間：公告後 12 個月（名單不應長期公開；要更久請改用 externalUrl，由人事系統自己管） */
export const RESULT_MAX_MONTHS = 12;
/** 下架前幾天開待辦 job-result-unpublish */
export const RESULT_UNPUBLISH_NOTICE_DAYS = 14;

const DAY = 86400000;
const isoOf = (ms) => new Date(ms).toISOString().slice(0, 10);
const msOf = (iso) => Date.parse(`${iso}T00:00:00Z`);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isDate = (v) => DATE_RE.test(String(v ?? ''));
/** ISO 日期加天數 */
export const plusDays = (iso, n) => isoOf(msOf(iso) + n * DAY);
/** ISO 日期加月數（月底對齊：1/31 + 1 個月 = 2/28） */
export function plusMonths(iso, n) {
  const [y, m, d] = String(iso).split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return isoOf(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(d, last)));
}
/** 最後一位備取的有效期限（沒有 ⇒ null） */
export const lastValidUntil = (result) => (result?.waitlist ?? []).map((w) => w?.validUntil).filter(isDate).sort().pop() ?? null;
/**
 * 預設下架日 = max(公告日 + 3 個月, 最後一位備取有效期限的隔天)。
 * 後台表單勾選「公告甄選結果」時自動帶入；人事室可以改，但要在 jobResultProblems() 的上下限內。
 */
export function defaultUnpublishAt(result) {
  if (!isDate(result?.publishedAt)) return null;
  const base = plusMonths(result.publishedAt, RESULT_DEFAULT_MONTHS);
  const wl = lastValidUntil(result);
  const afterWl = wl ? plusDays(wl, 1) : null;
  return afterWl && afterWl > base ? afterWl : base;
}
/** 名單是否已下架（下架日當天起 today ≥ unpublishAt 就不再輸出） */
export const resultTakenDown = (job, today) => !!(job?.result?.unpublishAt && today && String(today) >= String(job.result.unpublishAt));
/** 這份結果有沒有帶名單（正取／備取／遞補任一有列） */
export const resultHasList = (job) => !!((job?.result?.admitted ?? []).length || (job?.result?.waitlist ?? []).length || (job?.waitlistUpdates ?? []).length);

/**
 * 甄選結果的形式與下架日規則 → 錯誤訊息陣列（違反即建置失敗）。today 用來判斷「已下架、名單已從 JSON 移除」的合法狀態。
 * - 必須有 unpublishAt；不得早於公告日 + 30 日、不得晚於公告日 + 12 個月；有備取者必須晚於最後一位備取有效期限（有效期內不能先下架）。
 * - externalUrl（名單放人事系統）與 JSON 名單只能擇一；兩者都沒有，只有在已下架（名單已依規定移除）時才合法。
 */
export function jobResultProblems(job, today = null) {
  const r = job?.result;
  if (!r) return [];
  const out = [];
  const head = '甄選結果公告規則';
  const hasList = resultHasList(job);
  if (!r.unpublishAt) out.push(`${head}：result.unpublishAt（下架日）必填${defaultUnpublishAt(r) ? `，建議 ${defaultUnpublishAt(r)}（公告日 + ${RESULT_DEFAULT_MONTHS} 個月，且晚於最後一位備取有效期限）` : ''}`);
  else if (isDate(r.unpublishAt) && isDate(r.publishedAt)) {
    const min = plusDays(r.publishedAt, RESULT_MIN_DAYS);
    const max = plusMonths(r.publishedAt, RESULT_MAX_MONTHS);
    if (r.unpublishAt < min) out.push(`${head}：下架日 ${r.unpublishAt} 太早，公告後至少要公開 ${RESULT_MIN_DAYS} 日（最早 ${min}）`);
    if (r.unpublishAt > max) out.push(`${head}：下架日 ${r.unpublishAt} 太晚，名單最多公開 ${RESULT_MAX_MONTHS} 個月（最晚 ${max}）；需要更久請改用 externalUrl 由人事系統提供`);
    const wl = lastValidUntil(r);
    if (wl && r.unpublishAt <= wl) out.push(`${head}：下架日 ${r.unpublishAt} 不得早於或等於備取有效期限 ${wl}（備取有效期間內名單必須看得到；最早 ${plusDays(wl, 1)}）`);
  }
  if (r.externalUrl && hasList) out.push(`${head}：已填 result.externalUrl（名單由人事系統提供）就不得再把名單（admitted／waitlist／waitlistUpdates）放進 JSON，請擇一（建議只留 externalUrl）`);
  if (r.externalUrl && !/^(https:\/\/|\/pending\/\?)/.test(String(r.externalUrl))) out.push(`${head}：result.externalUrl 必須是 https:// 網址（人事系統的結果查詢頁或 PDF）`);
  // 兩者都沒有：只有「已過下架日、名單已依規定從 JSON 移除」才合法（admitted: [] 代表從缺，也合法）
  if (!r.externalUrl && !r.admitted && !resultTakenDown(job, today)) out.push(`${head}：result 需要 externalUrl（建議：連到人事系統的結果頁）或 admitted 名單其中之一`);
  return out;
}

/** 單一報名編號的問題 */
export function candidateNoProblems(no) {
  const v = String(no ?? '').trim();
  const out = [];
  if (!v) { out.push('報名編號空白'); return out; }
  if (CANDIDATE_NO_ID_RE.test(v) || NATIONAL_ID_RE.test(v)) out.push(`報名編號「${v.slice(0, 2)}********」疑似身分證字號（請改用報名編號，例：1150924-012）`);
  if (/[㐀-鿿]/u.test(v)) out.push('報名編號含中文字（疑似把姓名寫進編號；只能用英數與連字號）');
  return out;
}
/** 單一結果列的姓名欄問題：任何像姓名的欄位（nameMasked、name、fullName、姓名…）都不得出現 */
export function nameFieldProblems(row, kind = 'admitted') {
  const allowed = RESULT_ROW_KEYS[kind] ?? [];
  const out = [];
  for (const k of Object.keys(row ?? {})) {
    if (allowed.includes(k)) continue;
    if (NAME_FIELD_RE.test(k)) out.push(`有 ${k} 欄位：甄選結果不公布姓名（含遮罩姓名），請刪除此欄，只留報名編號`);
    else out.push(`有不允許的欄位 ${k}（只能有 ${allowed.join('、')}）`);
  }
  return out;
}

/**
 * 職缺甄選結果的個資閘門 → 錯誤訊息陣列（違反即建置失敗）。
 * 檢查 result.admitted[]、result.waitlist[]、waitlistUpdates[]：不得有任何姓名欄（含遮罩姓名）、candidateNo 不得像身分證字號；
 * result.note、waitlistUpdates[].note 不得含身分證字號或遮罩姓名樣式；正取人數不得超過名額、報名編號不得重複。
 */
export function jobPiiErrors(job) {
  const errs = [];
  const head = '個資閘門（甄選結果只公布報名編號，不公布姓名）';
  const rows = [
    ...(job.result?.admitted ?? []).map((r, i) => ({ at: `result.admitted[${i}]`, r, kind: 'admitted' })),
    ...(job.result?.waitlist ?? []).map((r, i) => ({ at: `result.waitlist[${i}]`, r, kind: 'waitlist' })),
    ...(job.waitlistUpdates ?? []).map((r, i) => ({ at: `waitlistUpdates[${i}]`, r, kind: 'updates' })),
  ];
  for (const { at, r, kind } of rows) {
    for (const p of nameFieldProblems(r, kind)) errs.push(`${head}：${at} ${p}`);
    for (const p of candidateNoProblems(r?.candidateNo)) errs.push(`${head}：${at}.candidateNo ${p}`);
  }
  for (const [at, text] of [['result.note', job.result?.note], ...(job.waitlistUpdates ?? []).map((u, i) => [`waitlistUpdates[${i}].note`, u?.note])]) {
    if (!text) continue;
    if (NATIONAL_ID_RE.test(String(text))) errs.push(`${head}：${at} 含身分證字號樣式`);
    const m = String(text).match(MASKED_NAME_RE);
    if (m) errs.push(`${head}：${at} 含疑似遮罩姓名「${[...m[0]][0]}＊」：說明文字不得寫姓名，改寫報名編號`);
  }
  const admitted = job.result?.admitted?.length ?? 0;
  if (job.positions != null && admitted > job.positions) errs.push(`甄選結果：正取 ${admitted} 名超過名額 ${job.positions} 名`);
  const inResult = [...(job.result?.admitted ?? []), ...(job.result?.waitlist ?? [])].map((r) => r?.candidateNo).filter(Boolean);
  const dupNo = inResult.filter((x, i, a) => a.indexOf(x) !== i);
  if (dupNo.length) errs.push(`甄選結果：報名編號重複 ${[...new Set(dupNo)].join('、')}`);
  return errs;
}


/** 職缺階段（純函式；today 為 ISO 日期） */
export function jobStageOf(job, today) {
  if (job.manualStatus === 'cancelled' || job.manualStatus === 'filled') return job.manualStatus;
  if (job.result) return 'result';
  if (job.applyStart && today < job.applyStart) return 'upcoming';
  if (!job.deadlineAt || today <= job.deadlineAt) return 'open';
  if ((job.examPlan ?? []).some((e) => e.date && e.date <= today)) return 'screening';
  return 'closed';
}
/** 採購階段（純函式） */
export function tenderStageOf(tender, today) {
  if (tender.manualStatus === 'failed' || tender.manualStatus === 'cancelled') return tender.manualStatus;
  if (tender.award) return 'awarded';
  if (!tender.deadlineAt || today <= tender.deadlineAt) return 'open';
  if (tender.openingAt && today >= tender.openingAt) return 'opened';
  return 'closed';
}
