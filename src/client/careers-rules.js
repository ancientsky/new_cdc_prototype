// 人才招募（job）與採購公告（tender）的共用規則：瀏覽器與 Node 共用的純函式，沒有任何 import。
// 第十六輪起由 scripts/lib/validate.mjs（個資閘門）與 governance.mjs（階段推導）移到這裡，讓後台上架表單在瀏覽器裡
// 用「同一份」規則即時檢核，不必再抄一份；CI 建置時跑的仍是這幾個函式（契約：ARCHITECTURE 15.1）。

/** 遮罩字（任一即可）：○ U+25CB、◯ U+25EF、〇 U+3007、＊ U+FF0A、* */
export const MASK_CHARS_RE = /[○◯〇＊*]/;
/** 完整姓名樣式：3 個以上連續中文字（王小明、歐陽小明）；遮罩後的「王○明」「歐陽○明」不會命中 */
export const FULL_NAME_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]{3,}/u;
/** 身分證字號／居留證號樣式（含新式居留證 8、9 開頭）：出現在任何結果欄位都擋下 */
export const NATIONAL_ID_RE = /[A-Z][1289]\d{8}/i;
/** 報名編號完整比對（契約：^[A-Z][12]\d{8}$ 一律擋下；這裡更嚴，任何位置出現都擋） */
export const CANDIDATE_NO_ID_RE = /^[A-Z][12]\d{8}$/i;

/** 單一遮罩姓名的問題（空陣列＝通過） */
export function maskedNameProblems(name) {
  const v = String(name ?? '').trim();
  const out = [];
  if (!v) { out.push('姓名欄空白'); return out; }
  if (!MASK_CHARS_RE.test(v)) out.push(`「${v}」沒有遮罩字（○、◯、〇、＊ 擇一，例：王○明）`);
  const m = v.match(FULL_NAME_RE);
  if (m) out.push(`「${v}」含 ${m[0].length} 個連續中文字，疑似完整姓名（只留姓與最後一字，中間以 ○ 遮罩）`);
  if (NATIONAL_ID_RE.test(v)) out.push(`「${v}」含身分證字號樣式`);
  return out;
}
/** 單一報名編號的問題 */
export function candidateNoProblems(no) {
  const v = String(no ?? '').trim();
  const out = [];
  if (!v) { out.push('報名編號空白'); return out; }
  if (CANDIDATE_NO_ID_RE.test(v) || NATIONAL_ID_RE.test(v)) out.push(`報名編號「${v.slice(0, 2)}********」疑似身分證字號（請改用報名編號，例：1150924-012）`);
  return out;
}

/**
 * 職缺甄選結果的個資閘門 → 錯誤訊息陣列（違反即建置失敗）。
 * 檢查 result.admitted[]、result.waitlist[]、waitlistUpdates[] 的 nameMasked 與 candidateNo；
 * result.note 與 waitlistUpdates[].note 不得含身分證字號樣式；正取人數不得超過名額。
 */
export function jobPiiErrors(job) {
  const errs = [];
  const head = '個資閘門（甄選結果只公布報名編號與遮罩姓名）';
  const rows = [
    ...(job.result?.admitted ?? []).map((r, i) => ({ at: `result.admitted[${i}]`, r })),
    ...(job.result?.waitlist ?? []).map((r, i) => ({ at: `result.waitlist[${i}]`, r })),
    ...(job.waitlistUpdates ?? []).map((r, i) => ({ at: `waitlistUpdates[${i}]`, r })),
  ];
  for (const { at, r } of rows) {
    for (const p of maskedNameProblems(r?.nameMasked)) errs.push(`${head}：${at}.nameMasked ${p}`);
    for (const p of candidateNoProblems(r?.candidateNo)) errs.push(`${head}：${at}.candidateNo ${p}`);
  }
  for (const [at, text] of [['result.note', job.result?.note], ...(job.waitlistUpdates ?? []).map((u, i) => [`waitlistUpdates[${i}].note`, u?.note])]) {
    if (text && NATIONAL_ID_RE.test(String(text))) errs.push(`${head}：${at} 含身分證字號樣式`);
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

