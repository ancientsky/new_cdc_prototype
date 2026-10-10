// 第七輪：人才招募（job）與採購公告（tender）共用的取值與呈現輔助。底線開頭＝不會被當成頁面模板自動登錄。
// 原則：階段一律優先讀治理引擎算好的 item.gov.jobStage／tenderStage；引擎還沒有（或測試用合成內容）時才由欄位推導，結果與契約（ARCHITECTURE 15.1）一致。
import { html } from '../../../scripts/lib/render.mjs';
import { pill, slugOf, daysUntil } from './_partials.mjs';

/* ───────── 取集合（容錯：collections.jobs／job；tenders／tender） ───────── */
export const allJobs = (site) => site.collections?.jobs ?? site.collections?.job ?? [];
export const allTenders = (site) => site.collections?.tenders ?? site.collections?.tender ?? [];
export const jobsOf = (site) => allJobs(site).filter((j) => j.status === 'published');
export const tendersOf = (site) => allTenders(site).filter((x) => x.status === 'published');

/* ───────── 路徑 ───────── */
export const jobSlug = (j) => j.slug ?? slugOf(j).replace(/^\d{4}-\d{2}-\d{2}-/, '');
export const jobPath = (j) => `/careers/${jobSlug(j)}/`;
export const applyPath = (j) => `${jobPath(j)}apply/`;
export const tenderSlug = (x) => x.slug ?? slugOf(x).replace(/^\d{4}-\d{2}-\d{2}-/, '');
/** 本站（模擬）報名頁只給 applyMethod 為 online 且沒有外部 applyUrl 的職缺（ARCHITECTURE 15.1） */
export const applyOnSite = (j) => (typeof j.gov?.applyOnSite === 'boolean' ? j.gov.applyOnSite : (j.applyMethod ?? 'online') === 'online' && !j.applyUrl);
export const tenderPath = (x) => `/procurement/${tenderSlug(x)}/`;

/* ───────── 階段 ───────── */
export const JOB_STAGES = ['upcoming', 'open', 'closed', 'screening', 'result', 'filled', 'cancelled'];
export const TENDER_STAGES = ['open', 'closed', 'opened', 'awarded', 'failed', 'cancelled'];
export const HISTORY_DAYS = 90;

export function jobStage(site, j) {
  if (j.gov?.jobStage) return j.gov.jobStage;
  if (j.manualStatus) return j.manualStatus;
  const today = site.today;
  if (j.result) return 'result';
  if (j.applyStart && today < j.applyStart) return 'upcoming';
  if (!j.deadlineAt || today <= j.deadlineAt) return 'open';
  return (j.examPlan ?? []).some((e) => e.date && e.date <= today) ? 'screening' : 'closed';
}
/** result 後 90 天、或已額滿／取消，歸入「歷史」 */
export function jobIsHistory(site, j, stage = jobStage(site, j)) {
  if (j.gov?.jobTab) return j.gov.jobTab === 'history';
  if (stage === 'filled' || stage === 'cancelled') return true;
  if (stage === 'result') { const d = daysUntil(j.result?.publishedAt ?? site.today, site.today); return d != null && d > HISTORY_DAYS; }
  return false;
}
export const JOB_TABS = ['open', 'upcoming', 'review', 'result', 'history'];
export function jobTab(site, j) {
  if (j.gov?.jobTab) return j.gov.jobTab;
  const st = jobStage(site, j);
  if (jobIsHistory(site, j, st)) return 'history';
  if (st === 'open') return 'open';
  if (st === 'upcoming') return 'upcoming';
  if (st === 'closed' || st === 'screening') return 'review';
  return 'result';
}
export function tenderStage(site, x) {
  if (x.gov?.tenderStage) return x.gov.tenderStage;
  if (x.manualStatus) return x.manualStatus;
  if (x.award) return 'awarded';
  const today = site.today;
  if (x.openingAt && today >= x.openingAt) return 'opened';
  if (x.deadlineAt && today > x.deadlineAt) return 'closed';
  return 'open';
}
export const TENDER_TABS = ['open', 'closed', 'opened', 'awarded', 'failed'];
export const tenderTab = (site, x) => { if (x.gov?.tenderTab) return x.gov.tenderTab; const st = tenderStage(site, x); return st === 'cancelled' ? 'failed' : st; };

/* ───────── 小元件 ───────── */
const STAGE_KIND = { upcoming: 'info', open: 'ok', closed: 'neutral', screening: 'warn', result: 'ok', filled: 'neutral', cancelled: 'neutral', opened: 'info', awarded: 'ok', failed: 'warn' };
export const stagePill = (ctx, stage, kind = 'job') => pill(ctx.t(`${kind}.stage.${stage}`), STAGE_KIND[stage] ?? 'neutral');

/** 倒數：upcoming「N 天後開放」、open「剩 N 天」（7 日內黃）、今日截止；其他階段回傳空字串 */
export function jobCountdown(ctx, j, stage) {
  const { t, site } = ctx;
  if (stage === 'upcoming') { const d = daysUntil(site.today, j.applyStart); return d == null ? '' : html`<span class="c-deadline c-deadline--info">${t('job.opensin', { n: d })}</span>`; }
  if (stage !== 'open') return '';
  const d = daysUntil(site.today, j.deadlineAt);
  if (d == null) return '';
  if (d === 0) return html`<span class="c-deadline c-deadline--soon">${t('notice.today')}</span>`;
  return html`<span class="c-deadline ${d <= 7 ? 'c-deadline--soon' : 'c-deadline--open'}">${t('notice.daysleft', { n: d })}</span>`;
}
export function tenderCountdown(ctx, x, stage) {
  const { t, site } = ctx;
  if (stage !== 'open') return '';
  const d = daysUntil(site.today, x.deadlineAt);
  if (d == null) return '';
  if (d === 0) return html`<span class="c-deadline c-deadline--soon">${t('notice.today')}</span>`;
  return html`<span class="c-deadline ${d <= 7 ? 'c-deadline--soon' : 'c-deadline--open'}">${t('notice.daysleft', { n: d })}</span>`;
}

// 第三十輪（#55）：名單不再有姓名欄，原本顯示端的 safeName()（漏遮時補遮罩）一併移除——模板根本不讀姓名，資料漏放也不會被印出來。
export const money = (n) => (n == null || n === '' ? '—' : `NT$ ${Number(n).toLocaleString('en-US')}`);

/** 工作地點 → 篩選用的縣市（取開頭的「○○市／縣」；取不到就取第一段） */
export function placeOf(workplace) {
  const w = String(workplace ?? '').trim();
  const m = w.match(/^[一-鿿]{1,3}[市縣]/);
  return m ? m[0].replace(/^台/, '臺') : (w.split(/[、，,／/（( ]/)[0] || w);
}
