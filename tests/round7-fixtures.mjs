// 第七輪（X2）測試共用：合成 8＋ 筆職缺與 7 筆標案，涵蓋各階段。不以 .test.mjs 結尾，不會被 node --test 直接執行。
// 與 X1 的真實內容（content/jobs、content/tenders）互不干擾：測試以 govern('2026-10-01', addCareers) 在載入後再加入合成內容。
import { mk, govern } from './helpers.mjs';

export const TODAY = '2026-10-01';

const REQ = { qualifications: ['公共衛生或相關科系畢業'], duties: ['協助疫情監測與資料整理'], requiredDocuments: ['履歷表', '學歷證件影本'], salaryNote: '比照約聘人員薪資，月薪約 4 萬元（示意）', workplace: '臺北市中正區林森南路 6 號', positions: 2, contact: '人事室 02-2395-9825（示意）' };

function job(slug, over) {
  const date = over.publishedAt ?? '2026-09-01';
  return mk({
    type: 'job', id: `job.${date}-${slug}`, slug, title: `測試職缺 ${slug}`, summary: `職缺摘要 ${slug}`, owner: 'unit.personnel', hiringUnit: 'unit.acute-infectious', jobType: '約聘人員', applyMethod: 'online',
    reviewPeriodMonths: 0, publishedAt: date, applyStart: '2026-09-20', deadlineAt: '2026-10-15', examPlan: [{ stage: '書面審查' }], ...REQ, ...over,
  });
}
const RESULT = {
  publishedAt: '2026-09-25', refNo: '疾管人字第 1150100245 號',
  admitted: [{ seq: 1, candidateNo: '1150924-012', nameMasked: '王○明' }, { seq: 2, candidateNo: '1150924-007', nameMasked: '林○' }],
  waitlist: [{ rank: 1, candidateNo: '1150924-021', nameMasked: '陳○宏', validUntil: '2027-03-25' }, { rank: 2, candidateNo: '1150924-018', nameMasked: '張○華', validUntil: '2027-03-25' }],
  note: '請於 10 月 15 日前攜帶身分證明文件至人事室報到。',
};

export function jobsFixture() {
  return [
    job('open-online', { deadlineAt: '2026-10-15', examPlan: [{ stage: '筆試', date: '2026-11-14', note: '上午 9 時' }, { stage: '口試', date: '2026-11-28' }], resultPlannedAt: '2026-12-10' }),
    job('open-external', { applyUrl: 'https://example.gov.tw/apply/123', deadlineAt: '2026-10-05', examPlan: [{ stage: '書面審查' }] }),
    job('open-email', { applyMethod: 'email', deadlineAt: '2026-10-20' }),
    job('upcoming', { applyStart: '2026-10-10', deadlineAt: '2026-10-30' }),
    job('closed-waiting', { deadlineAt: '2026-09-25', applyStart: '2026-09-10', examPlan: [{ stage: '筆試', date: '2026-10-20' }], resultPlannedAt: '2026-11-10' }),
    job('screening', { deadlineAt: '2026-09-15', applyStart: '2026-09-01', examPlan: [{ stage: '書面審查', date: '2026-09-20' }, { stage: '口試', date: '2026-10-12' }], resultPlannedAt: '2026-10-30' }),
    job('result-recent', { publishedAt: '2026-08-10', applyStart: '2026-08-10', deadlineAt: '2026-08-31', examPlan: [{ stage: '口試', date: '2026-09-15' }], result: RESULT,
      waitlistUpdates: [{ date: '2026-09-30', candidateNo: '1150924-021', nameMasked: '陳○宏', note: '遞補第 1 名' }] }),
    job('result-old', { publishedAt: '2026-03-01', applyStart: '2026-03-01', deadlineAt: '2026-03-20', examPlan: [{ stage: '口試', date: '2026-04-10' }], result: { ...RESULT, publishedAt: '2026-05-01', waitlist: [] } }),
    job('cancelled', { manualStatus: 'cancelled', manualStatusNote: '因員額調整停止甄選', deadlineAt: '2026-10-25' }),
  ];
}
function tender(slug, over) {
  const date = over.announcedAt ?? '2026-09-01';
  return mk({
    type: 'tender', id: `tender.${date}-${slug}`, slug, title: `測試標案 ${slug}`, summary: `標案摘要 ${slug}`, owner: 'unit.secretariat', requestingUnit: 'unit.it', tenderNo: `CDC115-${slug.length}0${slug.length}`, method: '公開招標', category: '勞務', budgetNtd: 3500000,
    publishedAt: date, announcedAt: date, deadlineAt: '2026-10-20', contact: '秘書室 02-2395-9825（示意）', reviewPeriodMonths: 0, pccUrl: 'https://web.pcc.gov.tw/tps/pss/tender.do?id=TEST', ...over,
  });
}
export function tendersFixture() {
  return [
    tender('open-one', { deadlineAt: '2026-10-20', openingAt: '2026-10-21' }),
    tender('closed-one', { deadlineAt: '2026-09-28', openingAt: '2026-10-05' }),
    tender('opened-one', { deadlineAt: '2026-09-20', openingAt: '2026-09-22' }),
    tender('opened-overdue', { announcedAt: '2026-07-01', deadlineAt: '2026-08-01', openingAt: '2026-08-05' }),
    tender('awarded-one', { announcedAt: '2026-08-01', deadlineAt: '2026-08-15', openingAt: '2026-08-18', award: { date: '2026-08-25', winner: '示範資訊股份有限公司', amountNtd: 3280000 } }),
    tender('awarded-two', { announcedAt: '2026-07-01', deadlineAt: '2026-07-15', openingAt: '2026-07-18', category: '財物', method: '限制性招標', award: { date: '2026-07-30', winner: '示範醫材有限公司', amountNtd: 980000, note: '議價後決標' } }),
    tender('failed-one', { announcedAt: '2026-08-01', deadlineAt: '2026-08-20', openingAt: '2026-08-25', manualStatus: 'failed' }),
  ];
}

/** 把合成內容加進 site（要在 applyGovernance 之前）。回傳 site。 */
export function addCareers(site, { jobs = jobsFixture(), tenders = tendersFixture() } = {}) {
  if (!site.unitById.has('unit.personnel')) { const u = { id: 'unit.personnel', name: '人事室', nameEn: 'Personnel Office', kind: 'office' }; site.master.units.push(u); site.unitById.set(u.id, u); }
  if (!site.unitById.has('unit.it')) { const u = { id: 'unit.it', name: '資訊室', nameEn: 'IT Office', kind: 'office' }; site.master.units.push(u); site.unitById.set(u.id, u); }
  for (const [col, list] of [['jobs', jobs], ['tenders', tenders]]) {
    site.collections[col] = [];
    for (const it of list) { it.__file = `test/${it.id}.json`; site.collections[col].push(it); site.all.push(it); site.byId.set(it.id, it); }
  }
  return site;
}
export const careersSite = () => govern(TODAY, (s) => addCareers(s));
export { govern };
