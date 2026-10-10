// 第十六輪：人才招募後台上架與異動表單（/admin/jobs/edit/）。
// 測純函式（src/client/admin/jobs-edit-core.js）、匯出 JSON 通過 schema 與跨檔檢查、後台模板渲染、前台「公告異動」區與「有異動」標籤。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyState, stateFromJob, buildJob, problemsOf, rowProblems, amendmentFor, cancelAmendment, amendmentsSorted, exportFilename, parseAttachments, attachmentsText,
  stripBuild, jobStageOf, suggestedUnpublishAt,
} from '../src/client/admin/jobs-edit-core.js';
import { jobPiiErrors } from '../src/client/careers-rules.js';
import { validateSite } from '../scripts/lib/validate.mjs';
import { loadSite } from '../scripts/lib/load.mjs';
import { makeCtx } from '../scripts/lib/pages.mjs';
import * as adminEdit from '../src/templates/admin/jobs-edit.mjs';
import * as adminJobs from '../src/templates/admin/jobs.mjs';
import * as careers from '../src/templates/public/careers.mjs';
import { govern, addItem, config } from './helpers.mjs';

const TODAY = '2026-10-01';
const site = govern(TODAY);
const str = (r) => String(r);
const DEMO_ID = 'job.2026-09-24-research-assistant-epi';

/** 一份填好的新增職缺表單 */
function filledState(over = {}) {
  return {
    ...emptyState(), title: '疫情中心徵求約聘研究助理 1 名', summary: '負責監測資料整理。', slug: 'epi-assistant-test', refNo: '疾管人字第 1150100300 號',
    hiringUnit: 'unit.epidemic-intelligence', jobType: '約聘人員', positions: '2', workplace: '臺北市中正區林森南路 6 號', salaryNote: '比照約用人員薪點（示意）',
    qualifications: '大學以上\n\n具統計軟體經驗者優先', duties: '資料清理\n統計分析', requiredDocuments: '履歷表', applyStart: '2026-10-01', deadlineAt: '2026-10-15', applyMethod: 'online',
    examPlan: [{ stage: '書面審查', date: '2026-10-16', note: '' }, { stage: '口試', date: '', note: '另行通知' }], resultPlannedAt: '2026-10-30', contact: '人事室（02）2395-9825 轉分機（示意）',
    attachments: '甄選簡章（PDF） | /pending/?ref=x&doc=簡章 | pdf', ...over,
  };
}

// ── 純函式：組物件 ──
test('buildJob：新增職缺套用共同欄位預設；id＝job.{今天}-{slug}；每行一項；空白列與空值不輸出', () => {
  const j = buildJob(filledState(), { today: TODAY });
  assert.equal(j.id, 'job.2026-10-01-epi-assistant-test');
  assert.equal(j.type, 'job'); assert.equal(j.owner, 'unit.personnel'); assert.equal(j.steward, '人事室承辦人');
  assert.equal(j.status, 'published'); assert.deepEqual(j.audience, ['public']); assert.equal(j.sensitivity, 'public'); assert.equal(j.license, 'OGDL-1.0');
  assert.deepEqual(j.aiWhitelist, { requested: true, approvedBy: 'unit.oasis', approvedAt: TODAY });
  assert.deepEqual(j.languages, { 'zh-TW': { status: 'source' } });
  assert.equal(j.reviewPeriodMonths, 0); assert.equal(j.publishedAt, TODAY); assert.equal(j.reviewedAt, TODAY);
  assert.equal(j.positions, 2);
  assert.deepEqual(j.qualifications, ['大學以上', '具統計軟體經驗者優先']);
  assert.deepEqual(j.examPlan, [{ stage: '書面審查', date: '2026-10-16' }, { stage: '口試', note: '另行通知' }]);
  assert.deepEqual(j.attachments, [{ label: '甄選簡章（PDF）', url: '/pending/?ref=x&doc=簡章', format: 'pdf' }]);
  for (const k of ['applyUrl', 'manualStatus', 'result', 'waitlistUpdates', 'amendments']) assert.ok(!(k in j), k);
  assert.equal(exportFilename(j), 'content/jobs/2026-10-01-epi-assistant-test.json');
});

test('buildJob：既有職缺保留 id／slug／publishedAt／keywords／languages／i18n，表單改 slug 也不會改；去掉建置欄位', () => {
  const base = site.byId.get(DEMO_ID);
  assert.ok(base.gov && base.__file, '測試前提：載入的職缺帶有建置欄位');
  const st = { ...stateFromJob(stripBuild(base)), slug: 'hacked', title: '改過的標題' };
  const j = buildJob(st, { today: '2026-10-02', base });
  assert.equal(j.id, DEMO_ID); assert.equal(j.slug, 'research-assistant-epi'); assert.equal(j.publishedAt, base.publishedAt);
  assert.deepEqual(j.keywords, base.keywords); assert.deepEqual(j.languages, base.languages); assert.deepEqual(j.i18n, base.i18n);
  assert.equal(j.reviewedAt, '2026-10-02'); assert.equal(j.title, '改過的標題');
  for (const k of ['gov', '__file', 'sourceHash']) assert.ok(!(k in j), k);
  assert.equal(exportFilename(j), 'content/jobs/2026-09-24-research-assistant-epi.json');
  // 表單 ↔ 物件來回不失真
  const round = buildJob(stateFromJob(stripBuild(base)), { today: base.reviewedAt, base });
  for (const k of ['qualifications', 'duties', 'requiredDocuments', 'examPlan', 'attachments', 'amendments', 'applyUrl', 'deadlineAt', 'resultPlannedAt']) assert.deepEqual(round[k], base[k], k);
});

test('附件文字「標題 | 網址 | 格式」來回轉換', () => {
  const list = parseAttachments('簡章 | /a.pdf | pdf\n報名表 | /b.odt\n\n');
  assert.deepEqual(list, [{ label: '簡章', url: '/a.pdf', format: 'pdf' }, { label: '報名表', url: '/b.odt' }]);
  assert.equal(attachmentsText(list), '簡章 | /a.pdf | pdf\n報名表 | /b.odt');
});

// ── 異動 kind 判定 ──
test('amendmentFor：截止日變晚＝extend；其他日期變動＝reschedule；只有說明＝correction；沒變動也沒說明＝不產生', () => {
  const before = buildJob(filledState(), { today: TODAY });
  const ext = amendmentFor(before, { ...before, deadlineAt: '2026-10-22' }, '', TODAY, '疾管人字第 1 號');
  assert.equal(ext.kind, 'extend');
  assert.match(ext.compare, /報名截止日由 2026-10-15 展延至 2026-10-22/);
  assert.deepEqual(ext.amendment, { date: TODAY, kind: 'extend', text: ext.compare, refNo: '疾管人字第 1 號' });
  // 截止日提前不是展延
  assert.equal(amendmentFor(before, { ...before, deadlineAt: '2026-10-10' }, '', TODAY).kind, 'reschedule');
  const exam = amendmentFor(before, { ...before, examPlan: [{ stage: '書面審查', date: '2026-10-20' }, { stage: '口試' }] }, '書面審查改期', TODAY);
  assert.equal(exam.kind, 'reschedule'); assert.equal(exam.amendment.text, '書面審查改期');
  assert.deepEqual(exam.changes.map((c) => [c.label, c.from, c.to]), [['書面審查日期', '2026-10-16', '2026-10-20']]);
  assert.equal(amendmentFor(before, { ...before, resultPlannedAt: '2026-11-05' }, '', TODAY).kind, 'reschedule');
  const fix = amendmentFor(before, before, '更正：聯絡分機', TODAY);
  assert.equal(fix.kind, 'correction'); assert.equal(fix.changes.length, 0); assert.equal(fix.amendment.text, '更正：聯絡分機');
  assert.equal(amendmentFor(before, before, '  ', TODAY).amendment, null);
  // 截止日變晚＋其他日期一起改，仍算展延
  assert.equal(amendmentFor(before, { ...before, deadlineAt: '2026-10-20', resultPlannedAt: '2026-11-06' }, '', TODAY).kind, 'extend');
});

test('cancelAmendment：取消／補實自動產生 kind=cancel；維持自動不產生；amendmentsSorted 依日期倒序', () => {
  assert.deepEqual(cancelAmendment('cancelled', '因員額調整', TODAY), { date: TODAY, kind: 'cancel', text: '本職缺停止甄選，不再受理報名：因員額調整' });
  assert.match(cancelAmendment('filled', '', TODAY).text, /已補實/);
  assert.equal(cancelAmendment('', 'x', TODAY), null);
  const s = amendmentsSorted([{ date: '2026-09-01', text: 'a' }, { date: '2026-09-20', text: 'b' }, { date: '2026-09-01', text: 'c' }]);
  assert.deepEqual(s.map((a) => a.text), ['b', 'c', 'a']);
});

// ── 問題清單 ──
test('problemsOf：必填缺漏、日期先後、slug 格式與重複、取消卻有結果、取消沒有異動紀錄', () => {
  const ok = buildJob(filledState(), { today: TODAY });
  const ids = site.collections.jobs.map((j) => j.id);
  assert.deepEqual(problemsOf(ok, TODAY, ids), []);
  const empty = problemsOf(buildJob(emptyState(), { today: TODAY }), TODAY, ids);
  for (const k of ['職缺名稱', '摘要', 'slug', '用人單位', '職類', '名額', '工作地點', '薪資待遇', '資格條件', '工作內容', '應備文件', '報名開始日', '報名截止日', '聯絡窗口', '結果預計公布日']) assert.ok(empty.some((p) => p.includes(k)), k);
  const has = (j, re) => problemsOf(j, TODAY, ids).some((p) => re.test(p));
  assert.ok(has({ ...ok, applyStart: '2026-10-20' }, /報名開始日 2026-10-20 晚於截止日/));
  assert.ok(has({ ...ok, examPlan: [{ stage: '筆試', date: '2026-10-10' }] }, /甄試「筆試」日期 2026-10-10 早於報名截止/));
  assert.ok(has({ ...ok, resultPlannedAt: '2026-10-14' }, /結果預計公布日 2026-10-14 早於報名截止/));
  assert.ok(has(buildJob(filledState({ slug: 'Bad_Slug' }), { today: TODAY }), /slug「Bad_Slug」格式不符/));
  assert.ok(has(buildJob(filledState({ slug: 'research-assistant-epi' }), { today: TODAY }), /與既有職缺 job\.2026-09-24-research-assistant-epi 重複/));
  // 編輯既有職缺時，呼叫端排除它自己 → 不算重複
  const demo = site.byId.get(DEMO_ID);
  assert.ok(!problemsOf(stripBuild(demo), TODAY, ids.filter((x) => x !== DEMO_ID)).some((p) => /重複/.test(p)));
  const cancelled = { ...ok, manualStatus: 'cancelled', result: { publishedAt: '2026-10-20', admitted: [] } };
  assert.ok(has(cancelled, /已取消（停止甄選）的職缺不得有甄選結果/));
  assert.ok(has(cancelled, /異動紀錄沒有「取消」/));
  assert.ok(!has({ ...ok, manualStatus: 'filled', amendments: [cancelAmendment('filled', '', TODAY)] }, /異動紀錄沒有/));
  assert.ok(has({ ...ok, amendments: [{ date: TODAY, kind: 'correction', text: '更正 A123456789 的報名資料' }] }, /異動說明.*含身分證字號樣式/));
});

test('個資檢核：表單與 CI 用同一份 jobPiiErrors／jobResultProblems；姓名欄一律不輸出；未通過的列逐條回報原因；正取超過名額擋下', () => {
  const st = filledState({
    positions: '1', hasResult: true,
    // 第三十輪：舊草稿可能還有 nameMasked ⇒ buildJob 一律丟掉，不會匯出
    result: { publishedAt: '2026-10-20', unpublishAt: '', externalUrl: '', refNo: '', note: '', admitted: [{ seq: '1', candidateNo: 'A123456789', nameMasked: '王小明' }, { seq: '2', candidateNo: '1151001-002' }], waitlist: [{ rank: '1', candidateNo: '1151001-003', validUntil: '2027-04-20' }] },
    waitlistUpdates: [{ date: '2026-11-01', candidateNo: '1151001-003', nameMasked: '陳大華', note: '' }],
  });
  const j = buildJob(st, { today: TODAY });
  assert.deepEqual(j.result.admitted[0], { seq: 1, candidateNo: 'A123456789' });
  assert.ok(!/nameMasked|王小明|陳大華/.test(JSON.stringify(j)), '匯出的 JSON 不含姓名');
  const pii = jobPiiErrors(j);
  const p = problemsOf(j, TODAY, []);
  for (const e of pii) assert.ok(p.includes(e), `problemsOf 應包含 CI 的錯誤：${e}`);
  assert.ok(p.some((x) => /正取 2 名超過名額 1 名/.test(x)));
  assert.ok(p.some((x) => /result\.admitted\[0\]\.candidateNo/.test(x)));
  assert.ok(p.some((x) => /unpublishAt（下架日）必填/.test(x)), '沒有下架日擋下');
  const rows = rowProblems(j);
  assert.equal(rows.admitted[0].length, 1, rows.admitted[0].join('\n')); // 編號像身分證
  assert.deepEqual(rows.admitted[1], []); assert.deepEqual(rows.waitlist[0], []); assert.deepEqual(rows.updates[0], []);
  // 修好後全過（下架日用建議值：公告日 + 3 個月與備取有效期隔天取晚者）
  assert.equal(suggestedUnpublishAt(j.result), '2027-04-21');
  const fixed = buildJob({ ...st, positions: '2', result: { ...st.result, unpublishAt: suggestedUnpublishAt(j.result), admitted: [{ seq: '1', candidateNo: '1151001-001' }, st.result.admitted[1]] } }, { today: TODAY });
  assert.deepEqual(problemsOf(fixed, TODAY, []), []);
  assert.equal(jobStageOf(fixed, TODAY), 'result');
  // externalUrl（名單在人事系統）：不輸出 admitted；同時有名單 ⇒ 擇一錯誤
  const ext = buildJob({ ...st, positions: '2', result: { publishedAt: '2026-10-20', unpublishAt: '2027-01-20', externalUrl: 'https://hr.cdc.gov.tw/results/115-001', refNo: '', note: '', admitted: [], waitlist: [] }, waitlistUpdates: [] }, { today: TODAY });
  assert.equal(ext.result.externalUrl, 'https://hr.cdc.gov.tw/results/115-001'); assert.ok(!('admitted' in ext.result));
  assert.deepEqual(problemsOf(ext, TODAY, []), []);
  const both = buildJob({ ...st, positions: '2', result: { ...ext.result, admitted: [{ seq: '1', candidateNo: '1151001-001' }], waitlist: [] }, waitlistUpdates: [] }, { today: TODAY });
  assert.ok(problemsOf(both, TODAY, []).some((x) => /externalUrl.*擇一/.test(x)));
});

// ── 匯出 JSON 通過 schema 與跨檔檢查 ──
test('匯出的 JSON（新增、展延、取消、公布結果）加進 site 後通過 validateSite', () => {
  const fresh = () => { const s = loadSite(config); s.today = TODAY; return s; };
  const errsOf = (s, id) => validateSite(s).filter((e) => e.includes(id.replace(/^job\./, '')));
  // 新增
  const created = buildJob(filledState(), { today: TODAY });
  let s = fresh(); addItem(s, created);
  assert.deepEqual(errsOf(s, created.id), []);
  // 既有職缺：展延＋取消＋結果（分開驗）
  const base = site.byId.get('job.2026-09-28-lab-technician-respiratory');
  const st = stateFromJob(stripBuild(base));
  const ext = { ...st, deadlineAt: '2026-10-19', examPlan: st.examPlan.map((e) => ({ ...e, date: e.date && e.date < '2026-10-19' ? '2026-10-20' : e.date })) };
  const am = amendmentFor(base, buildJob(ext, { today: TODAY, base }), '', TODAY).amendment;
  const extended = buildJob({ ...ext, amendments: [...ext.amendments, am] }, { today: TODAY, base });
  assert.equal(extended.amendments.at(-1).kind, 'extend');
  s = fresh(); s.all = s.all.filter((x) => x.id !== base.id); s.collections.jobs = s.collections.jobs.filter((x) => x.id !== base.id); s.byId.delete(base.id); addItem(s, extended);
  assert.deepEqual(errsOf(s, base.id), []);
  const cancelled = buildJob({ ...st, manualStatus: 'cancelled', manualStatusNote: '員額調整', amendments: [cancelAmendment('cancelled', '員額調整', TODAY)] }, { today: TODAY, base });
  assert.deepEqual(problemsOf(cancelled, TODAY, []), []);
  s = fresh(); s.all = s.all.filter((x) => x.id !== base.id); s.collections.jobs = s.collections.jobs.filter((x) => x.id !== base.id); s.byId.delete(base.id); addItem(s, cancelled);
  assert.deepEqual(errsOf(s, base.id), []);
  const resulted = buildJob({ ...st, hasResult: true, result: { publishedAt: '2026-10-30', unpublishAt: '2027-05-01', refNo: '疾管人字第 2 號', note: '請於 11 月 5 日前報到。', admitted: [{ seq: '1', candidateNo: '1150928-004' }], waitlist: [{ rank: '1', candidateNo: '1150928-009', validUntil: '2027-04-30' }] } }, { today: TODAY, base });
  s = fresh(); s.all = s.all.filter((x) => x.id !== base.id); s.collections.jobs = s.collections.jobs.filter((x) => x.id !== base.id); s.byId.delete(base.id); addItem(s, resulted);
  assert.deepEqual(errsOf(s, base.id), []);
  // 反例：schema 擋下錯的 amendments kind
  s = fresh(); addItem(s, { ...created, id: 'job.2026-10-01-bad-amend', slug: 'bad-amend', amendments: [{ date: TODAY, kind: 'delay', text: 'x' }] });
  assert.ok(validateSite(s).some((e) => e.includes('bad-amend') && /amendments/.test(e)));
});

// ── 後台模板 ──
test('/admin/jobs/edit/：頁面登錄、表單四區塊與欄位 id、資料島不含建置欄位', () => {
  assert.deepEqual(adminEdit.pages(), [{ path: '/admin/jobs/edit/', props: {}, noindex: true }]);
  const m = adminEdit.meta();
  assert.match(m.title, /^人才招募上架與異動/); assert.equal(m.adminKey, 'jobs'); assert.deepEqual(m.scripts, ['/assets/js/admin/jobs-edit.js']); assert.equal(m.noindex, true);
  const h = str(adminEdit.render(makeCtx(site, 'zh-TW', { path: '/admin/jobs/edit/', alternates: ['zh-TW'] })));
  for (const id of ['jf-form', 'jf-pick', 'jf-a', 'jf-b', 'jf-c', 'jf-d', 'jf-title', 'jf-slug', 'jf-unit', 'jf-type', 'jf-deadline', 'jf-exam', 'jf-am-add', 'jf-am-list', 'jf-has-result', 'jf-admitted', 'jf-waitlist', 'jf-wlu', 'jf-preview', 'jf-warn', 'jf-out', 'jf-file', 'jf-copy', 'jf-dl']) assert.ok(h.includes(`id="${id}"`), id);
  assert.ok(h.includes('<option value="new">'));
  assert.ok(h.includes(`<option value="${DEMO_ID}">`));
  for (const k of ['cancelled', 'filled']) assert.ok(h.includes(`name="jf-ms" value="${k}"`), k);
  assert.match(h, /快車道/);
  const island = h.match(/<script type="application\/json" id="adm-jobs-data">([\s\S]*?)<\/script>/);
  assert.ok(island, '資料島');
  const data = JSON.parse(island[1]);
  assert.equal(data.today, TODAY);
  assert.equal(data.jobs.length, site.collections.jobs.length);
  assert.equal(data.jobTypes.length, 8);
  assert.equal(data.stages.open, '報名中');
  assert.ok(data.units.some((u) => u.id === 'unit.personnel' && u.name === '人事室'));
  for (const j of data.jobs) { assert.ok(!('gov' in j) && !('__file' in j) && !('sourceHash' in j), j.id); assert.ok(j.stage, j.id); }
});

test('/admin/jobs/：有按鈕連到上架表單，每列有「異動」連結', () => {
  const h = str(adminJobs.render(makeCtx(site, 'zh-TW', { path: '/admin/jobs/', alternates: ['zh-TW'] })));
  assert.match(h, /href="\/new_cdc_prototype\/admin\/jobs\/edit\/"/);
  assert.ok(h.includes(`/admin/jobs/edit/?id=${encodeURIComponent(DEMO_ID)}`));
  assert.match(h, /上架與異動」表單/);
});

// ── 前台 ──
test('前台詳情：「公告異動」區在時間軸之後、依日期倒序、kind pill 與字號；14 天內有頁首提示', () => {
  const s = govern(TODAY, (x) => {
    const d = x.byId.get(DEMO_ID);
    d.amendments = [...d.amendments, { date: '2026-09-25', kind: 'correction', text: '更正聯絡分機' }];
  });
  const j = s.byId.get(DEMO_ID);
  const ctx = (lang = 'zh-TW') => makeCtx(s, lang, { path: '/careers/research-assistant-epi/', alternates: ['zh-TW', 'en'] });
  const h = str(careers.render(ctx(), { item: j }));
  const sec = h.match(/<section class="c-block c-amend-sec" id="amendments"[\s\S]*?<\/section>/)?.[0];
  assert.ok(sec, '公告異動區');
  assert.ok(h.indexOf('id="timeline"') < h.indexOf('id="amendments"'));
  assert.match(sec, /<h2 id="h-amend">公告異動<\/h2>/);
  assert.ok(sec.indexOf('2026-09-30') < sec.indexOf('2026-09-25'), '新到舊');
  assert.match(sec, /<span class="c-pill c-pill--info">展延<\/span>/);
  assert.match(sec, /<span class="c-pill c-pill--neutral">更正<\/span>/);
  assert.match(sec, /疾管人字第 1150100262 號/);
  assert.match(h, /data-amend-recent>本公告 2026-09-30 有異動：報名截止日由 2026-10-20 展延至 2026-10-27/);
  const en = str(careers.render(ctx('en'), { item: j }));
  assert.match(en, /Notice amendments/); assert.match(en, /This notice was amended on/); assert.match(en, />Extended</);
  // 超過 14 天不提示，但異動區仍在
  const later = govern('2026-10-20');
  const hl = str(careers.render(makeCtx(later, 'zh-TW', { path: '/careers/research-assistant-epi/', alternates: ['zh-TW'] }), { item: later.byId.get(DEMO_ID) }));
  assert.ok(!hl.includes('data-amend-recent')); assert.ok(hl.includes('id="amendments"'));
  // 沒有異動的職缺沒有這一區
  const plain = str(careers.render(ctx(), { item: s.byId.get('job.2026-09-28-lab-technician-respiratory') }));
  assert.ok(!plain.includes('id="amendments"') && !plain.includes('data-amend-recent'));
  // .md 機讀版
  const md = careers.markdown(ctx(), { item: j });
  assert.match(md, /## 公告異動\n\n- 2026-09-30［展延］報名截止日由 2026-10-20 展延至 2026-10-27/);
  assert.ok(md.indexOf('［展延］') < md.indexOf('［更正］'));
});

test('前台列表：有異動且非歷史的職缺卡加「有異動」；歷史（已取消）不加', () => {
  const s = govern(TODAY, (x) => { x.byId.get('job.2026-09-21-intl-affairs-assistant').amendments = [{ date: '2026-09-28', kind: 'cancel', text: '停止甄選' }]; });
  const h = str(careers.render(makeCtx(s, 'zh-TW', { path: '/careers/', alternates: ['zh-TW', 'en'] })));
  const cards = h.split('<li class="c-job"').slice(1);
  const card = (slug) => cards.find((c) => c.includes(`/careers/${slug}/"`)) ?? '';
  assert.match(card('research-assistant-epi'), /data-amended><span class="c-pill c-pill--warn">有異動<\/span>/);
  assert.ok(!card('intl-affairs-assistant').includes('data-amended'), '歷史不標');
  assert.ok(!card('lab-technician-respiratory').includes('data-amended'));
});

test('示範資料：一筆報名中的職缺有 extend 異動（截止日延一週），且整站通過驗證', () => {
  const j = site.byId.get(DEMO_ID);
  assert.equal(j.gov.jobStage, 'open');
  assert.equal(j.deadlineAt, '2026-10-27');
  assert.deepEqual(j.amendments.map((a) => a.kind), ['extend']);
  assert.match(j.amendments[0].text, /2026-10-20.*2026-10-27/);
  const s = loadSite(config); s.today = TODAY;
  assert.deepEqual(validateSite(s).filter((e) => /content\/jobs/.test(e)), []);
});
