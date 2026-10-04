// 第七輪（ARCHITECTURE 15.1）：人才招募（job，人事室）與採購公告（tender，秘書室）
// schema、階段推導（不同 today）、manualStatus、待辦（job-result-overdue／job-waitlist-expiring／job-apply-url-dead／tender-award-overdue）、
// 甄選結果個資閘門（建置失敗）、result 不進答案索引、redirects moved、v1／feeds／sitemap／JSON-LD 輸出、答案引擎 careers／procurement、評估集。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSite, jobPiiErrors, maskedNameProblems, candidateNoProblems } from '../scripts/lib/validate.mjs';
import { jobStageOf, tenderStageOf, jobGov, pathOf, textOf, TODO_KIND_LABELS, JOB_STAGE_LABELS, TENDER_STAGE_LABELS } from '../scripts/lib/governance.mjs';
import { buildSearchIndex, JOB_INDEX_EXCLUDED_FIELDS } from '../scripts/lib/index-builder.mjs';
import { emitApi, buildRedirects, serverRedirects, buildLegacyMap } from '../scripts/lib/emit-api.mjs';
import { buildFeeds, derivePages, buildRobots, buildLlms } from '../scripts/lib/emit-seo.mjs';
import { jsonLdFor } from '../scripts/lib/jsonld.mjs';
import { buildOpenApi } from '../scripts/lib/openapi.mjs';
import { makeUrl } from '../scripts/lib/render.mjs';
import { engineFromSite, runEval } from '../eval/run-eval.mjs';
import { classifyIntent } from '../src/client/answer/core.js';
import { govern, addItem, memWriter, config } from './helpers.mjs';
import { loadSite } from '../scripts/lib/load.mjs';

const TODAY = '2026-10-01';
const site = govern(TODAY);
site.searchIndex = buildSearchIndex(site);
const jobs = site.collections.jobs;
const tenders = site.collections.tenders;
const byId = (id) => site.byId.get(id);
const todosOf = (s, kind) => s.gov.todos.filter((t) => t.kind === kind);

/** 合成職缺（共同欄位齊全；over 覆蓋） */
function job(over = {}) {
  const slug = over.slug ?? `t-${Math.random().toString(36).slice(2, 8)}`;
  return {
    id: `job.2026-09-01-${slug}`, type: 'job', slug, title: '測試職缺 1 名', owner: 'unit.personnel', publishedAt: '2026-09-01', reviewedAt: '2026-09-01', reviewPeriodMonths: 0,
    status: 'published', audience: ['public'], sensitivity: 'public', license: 'OGDL-1.0', languages: { 'zh-TW': { status: 'source' } }, summary: '測試摘要',
    aiWhitelist: { requested: true, approvedBy: 'unit.oasis', approvedAt: '2026-09-01' },
    hiringUnit: 'unit.it', jobType: '約聘人員', positions: 2, workplace: '臺北市中正區（測試）', salaryNote: '比照約用人員薪點 328 薪點起敘（示意）',
    qualifications: ['大學以上'], duties: ['系統維運'], requiredDocuments: ['履歷表'], applyStart: '2026-09-10', deadlineAt: '2026-09-30', applyMethod: 'online',
    examPlan: [{ stage: '書面審查', date: '2026-10-05' }, { stage: '口試', date: '2026-10-12' }], resultPlannedAt: '2026-10-20', contact: '人事室（02）2395-9825 轉分機（示意）',
    ...over,
  };
}
function tender(over = {}) {
  const slug = over.slug ?? `t-${Math.random().toString(36).slice(2, 8)}`;
  return {
    id: `tender.2026-09-01-${slug}`, type: 'tender', slug, title: '測試採購案', owner: 'unit.secretariat', publishedAt: '2026-09-01', reviewedAt: '2026-09-01', reviewPeriodMonths: 0,
    status: 'published', audience: ['public'], sensitivity: 'public', license: 'OGDL-1.0', languages: { 'zh-TW': { status: 'source' } }, summary: '測試摘要',
    aiWhitelist: { requested: true, approvedBy: 'unit.oasis', approvedAt: '2026-09-01' },
    requestingUnit: 'unit.it', tenderNo: 'CDC-115-T-001', method: '公開招標', budgetNtd: 1000000, category: '勞務', announcedAt: '2026-09-01', deadlineAt: '2026-09-20', openingAt: '2026-09-22',
    contact: '秘書室（02）2395-9825 轉分機（示意）', ...over,
  };
}
const ALL_NAMES = jobs.flatMap((j) => [...(j.result?.admitted ?? []), ...(j.result?.waitlist ?? []), ...(j.waitlistUpdates ?? [])]);

// ── schema 與內容 ──
test('schema：職缺 ≥ 8、採購 ≥ 7，全部通過 schema 與跨檔檢查；owner 固定人事室／秘書室；id 與 slug 一致', () => {
  assert.ok(jobs.length >= 8, `職缺 ${jobs.length}`); assert.ok(tenders.length >= 7, `採購 ${tenders.length}`);
  const errs = validateSite(loadedFresh()).filter((e) => /content\/(jobs|tenders|migration\/(careers|procurement))/.test(e));
  assert.deepEqual(errs, []);
  for (const j of jobs) { assert.equal(j.owner, 'unit.personnel'); assert.equal(j.id, `job.${j.id.slice(4, 14)}-${j.slug}`); assert.ok(site.unitById.has(j.hiringUnit)); }
  for (const x of tenders) { assert.equal(x.owner, 'unit.secretariat'); assert.ok(site.unitById.has(x.requestingUnit)); }
  assert.equal(site.unitById.get('unit.personnel')?.name, '人事室');
  // schema 擋下：職類不在列舉、owner 不是人事室
  const s = loadedFresh();
  addItem(s, job({ slug: 'bad-type', jobType: '正職', owner: 'unit.it' }));
  const bad = validateSite(s).filter((e) => e.includes('bad-type'));
  assert.ok(bad.some((e) => /jobType/.test(e)) && bad.some((e) => /owner/.test(e)), bad.join('\n'));
});

test('內容階段分布（today 2026-10-01）：職缺 upcoming、open×3（含外部 applyUrl）、closed、screening、result×2（含備取與遞補）、cancelled；採購 open、closed、opened、awarded×2、failed', () => {
  const st = (k) => jobs.filter((j) => j.gov.jobStage === k);
  assert.ok(st('upcoming').length >= 1); assert.ok(st('open').length >= 3); assert.ok(st('open').some((j) => j.applyUrl));
  assert.ok(st('open').some((j) => j.gov.applyOnSite), '至少一則本站報名（模擬報名頁）');
  assert.ok(st('closed').length >= 1); assert.ok(st('screening').length >= 1); assert.ok(st('cancelled').length >= 1);
  assert.ok(st('result').length >= 2); assert.ok(st('result').some((j) => j.result.waitlist?.length)); assert.ok(st('result').some((j) => j.waitlistUpdates?.length));
  const ts = (k) => tenders.filter((x) => x.gov.tenderStage === k);
  for (const k of ['open', 'closed', 'opened', 'failed']) assert.ok(ts(k).length >= 1, k);
  assert.ok(ts('awarded').length >= 2);
  assert.deepEqual(Object.keys(site.gov.jobs.byStage).sort(), Object.keys(JOB_STAGE_LABELS).sort());
  assert.equal(site.gov.tenders.total, tenders.length);
  for (const j of jobs) assert.ok(JOB_STAGE_LABELS[j.gov.jobStage] === j.gov.jobStageLabel);
  for (const x of tenders) assert.ok(TENDER_STAGE_LABELS[x.gov.tenderStage] === x.gov.tenderStageLabel);
});

// ── 階段推導 ──
test('jobStage 依 today 推導：upcoming → open（含截止當天）→ closed → screening；result 優先；manualStatus 覆蓋；result 90 天後 archivedStage（歷史）', () => {
  const j = job();
  assert.equal(jobStageOf(j, '2026-09-09'), 'upcoming');
  assert.equal(jobStageOf(j, '2026-09-10'), 'open');
  assert.equal(jobStageOf(j, '2026-09-30'), 'open', '截止當天仍可報名');
  assert.equal(jobStageOf(j, '2026-10-01'), 'closed');
  assert.equal(jobStageOf(j, '2026-10-05'), 'screening', 'examPlan 日期已到');
  const r = job({ result: { publishedAt: '2026-10-20', admitted: [{ seq: 1, candidateNo: '1150901-001', nameMasked: '王○明' }] } });
  assert.equal(jobStageOf(r, '2026-10-21'), 'result');
  assert.equal(jobGov(r, '2027-01-18').archivedStage, false, '第 90 天仍在錄取結果');
  assert.equal(jobGov(r, '2027-01-19').archivedStage, true);
  assert.equal(jobGov(r, '2027-01-19').jobTab, 'history');
  assert.equal(jobGov(j, '2026-10-01').jobTab, 'review'); assert.equal(jobGov(j, '2026-09-15').jobTab, 'open'); assert.equal(jobGov(j, '2026-09-01').jobTab, 'upcoming');
  // manualStatus 覆蓋日期與 result
  assert.equal(jobStageOf({ ...j, manualStatus: 'cancelled' }, '2026-09-15'), 'cancelled');
  assert.equal(jobStageOf({ ...r, manualStatus: 'filled' }, '2026-10-21'), 'filled');
  assert.equal(jobGov({ ...j, manualStatus: 'cancelled' }, '2026-09-15').jobTab, 'history');
  // closed／open 與首頁退場旗標
  assert.equal(jobGov(j, '2026-09-15').closed, false); assert.equal(jobGov(j, '2026-10-01').closed, true);
  assert.equal(jobGov(j, '2026-09-25').closingSoon, true);
  // 報名入口：online 無 applyUrl ⇒ 本站 /careers/{slug}/apply/；外部 ⇒ applyUrl
  assert.equal(jobGov(j, '2026-09-15').applyHref, `/careers/${j.slug}/apply/`);
  assert.equal(jobGov({ ...j, applyUrl: 'https://web3.dgpa.gov.tw/' }, '2026-09-15').applyHref, 'https://web3.dgpa.gov.tw/');
  assert.equal(jobGov({ ...j, applyMethod: 'mail' }, '2026-09-15').applyHref, null);
  // 時間軸：current 一個
  assert.equal(jobGov(j, '2026-10-06').timeline.filter((x) => x.current).length, 1);
});

test('tenderStage 依 today 推導：open（含截止當天）→ closed → opened（開標日起）；award ⇒ awarded；manualStatus failed／cancelled 覆蓋', () => {
  const t = tender();
  assert.equal(tenderStageOf(t, '2026-09-20'), 'open');
  assert.equal(tenderStageOf(t, '2026-09-21'), 'closed');
  assert.equal(tenderStageOf(t, '2026-09-22'), 'opened');
  assert.equal(tenderStageOf({ ...t, award: { date: '2026-10-01', winner: '示意公司' } }, '2026-10-02'), 'awarded');
  assert.equal(tenderStageOf({ ...t, manualStatus: 'failed' }, '2026-09-22'), 'failed');
  assert.equal(tenderStageOf({ ...t, manualStatus: 'cancelled' }, '2026-09-10'), 'cancelled');
});

test('同一份內容在不同 today：已截止職缺退出開放中（gov.closed、lifecycle 已截止），不產生截止待辦', () => {
  const s1 = govern('2026-09-15', (s) => addItem(s, job({ slug: 'flow' })));
  const s2 = govern('2026-10-01', (s) => addItem(s, job({ slug: 'flow' })));
  const a = s1.byId.get('job.2026-09-01-flow'), b = s2.byId.get('job.2026-09-01-flow');
  assert.equal(a.gov.jobStage, 'open'); assert.equal(a.gov.closed, false); assert.equal(a.gov.lifecycle, 'current');
  assert.equal(b.gov.jobStage, 'closed'); assert.equal(b.gov.closed, true); assert.equal(b.gov.lifecycle, 'closed');
  assert.ok(b.gov.annotations.some((x) => x.kind === 'closed' && x.text.includes('2026-09-30')));
  assert.equal(b.gov.whitelist.effective, true, '已截止職缺仍可回答「上次招募」');
  assert.deepEqual(s2.gov.todos.filter((t) => t.itemId === b.id), []);
});

// ── 待辦 ──
test('待辦：job-result-overdue（結果預定日 + 7 天仍無 result，owner 人事室、cc 用人單位）', () => {
  const s = govern('2026-10-28', (x) => { addItem(x, job({ slug: 'late', resultPlannedAt: '2026-10-20' })); addItem(x, job({ slug: 'ontime', resultPlannedAt: '2026-10-22' })); });
  const t = todosOf(s, 'job-result-overdue').filter((x) => x.itemId.startsWith('job.2026-09-01-'));
  assert.deepEqual(t.map((x) => x.itemId), ['job.2026-09-01-late']);
  assert.equal(t[0].owner, 'unit.personnel'); assert.deepEqual(t[0].cc, ['unit.it']); assert.equal(t[0].severity, 'medium'); assert.equal(t[0].dueAt, '2026-10-27');
  assert.equal(TODO_KIND_LABELS['job-result-overdue'], '甄選結果逾期未公告');
  // 有 result 或 cancelled 不開
  const s2 = govern('2026-10-28', (x) => addItem(x, job({ slug: 'late2', manualStatus: 'cancelled' })));
  assert.equal(todosOf(s2, 'job-result-overdue').filter((x) => x.itemId === 'job.2026-09-01-late2').length, 0);
});

test('待辦：job-waitlist-expiring（備取 validUntil 14 天內，low；已遞補者不算）', () => {
  const res = { publishedAt: '2026-10-01', admitted: [{ seq: 1, candidateNo: '1150901-001', nameMasked: '王○明' }],
    waitlist: [{ rank: 1, candidateNo: '1150901-002', nameMasked: '林○', validUntil: '2026-10-20' }, { rank: 2, candidateNo: '1150901-003', nameMasked: '陳○華', validUntil: '2026-10-20' }, { rank: 3, candidateNo: '1150901-004', nameMasked: '張○', validUntil: '2026-12-31' }] };
  const s = govern('2026-10-10', (x) => addItem(x, job({ slug: 'wl', result: res, waitlistUpdates: [{ date: '2026-10-05', candidateNo: '1150901-002', nameMasked: '林○', note: '遞補' }] })));
  const t = todosOf(s, 'job-waitlist-expiring').find((x) => x.itemId === 'job.2026-09-01-wl');
  assert.ok(t); assert.equal(t.severity, 'low'); assert.deepEqual(t.ranks, [2]); assert.equal(t.dueAt, '2026-10-20');
  assert.ok(!/[○◯〇]/.test(t.text), '待辦文字不放姓名');
  const far = govern('2026-09-01', (x) => addItem(x, job({ slug: 'wl2', result: res })));
  assert.equal(todosOf(far, 'job-waitlist-expiring').filter((x) => x.itemId === 'job.2026-09-01-wl2').length, 0);
});

test('待辦：job-apply-url-dead（外部報名連結檢查失敗，報名中 ⇒ high；取代 link-broken）', () => {
  const s = govern('2026-09-15', (x) => addItem(x, job({ slug: 'dead', applyUrl: 'https://web3.dgpa.gov.tw/x', linkChecks: { applyUrl: { lastCheckedAt: '2026-09-14', status: 'broken' } } })));
  const t = todosOf(s, 'job-apply-url-dead').find((x) => x.itemId === 'job.2026-09-01-dead');
  assert.ok(t); assert.equal(t.severity, 'high'); assert.equal(t.owner, 'unit.personnel');
  assert.equal(todosOf(s, 'link-broken').filter((x) => x.itemId === 'job.2026-09-01-dead').length, 0);
  assert.ok(s.gov.externalLinks.some((l) => l.itemId === 'job.2026-09-01-dead' && l.status === 'broken'));
});

test('待辦：tender-award-overdue（開標 + 30 天仍無決標且非流標／取消，owner 秘書室、cc 需求單位）', () => {
  const s = govern('2026-10-23', (x) => {
    addItem(x, tender({ slug: 'late' })); addItem(x, tender({ slug: 'failed', manualStatus: 'failed' }));
    addItem(x, tender({ slug: 'awarded', award: { date: '2026-10-01', winner: '示意公司' } })); addItem(x, tender({ slug: 'recent', openingAt: '2026-09-30', deadlineAt: '2026-09-29' }));
  });
  const ids = todosOf(s, 'tender-award-overdue').map((x) => x.itemId).filter((x) => x.startsWith('tender.2026-09-01-'));
  assert.deepEqual(ids, ['tender.2026-09-01-late']);
  const t = todosOf(s, 'tender-award-overdue').find((x) => x.itemId === 'tender.2026-09-01-late');
  assert.equal(t.owner, 'unit.secretariat'); assert.deepEqual(t.cc, ['unit.it']); assert.equal(t.dueAt, '2026-10-22');
  // 實際內容：傳染病監測資料分析系統擴充案已開標逾 30 日
  assert.ok(todosOf(site, 'tender-award-overdue').some((x) => x.itemId === 'tender.2026-07-29-surveillance-system-expansion'));
  assert.ok(todosOf(site, 'job-result-overdue').length >= 1); assert.ok(todosOf(site, 'job-waitlist-expiring').length >= 1);
});

// ── 個資閘門 ──
function loadedFresh() { const s = loadSite(config); s.today = TODAY; return s; }
test('個資閘門：未遮罩姓名、完整姓名樣式、身分證字號樣式的報名編號 ⇒ validate 錯誤（建置失敗），訊息清楚', () => {
  assert.deepEqual(maskedNameProblems('王○明'), []); assert.deepEqual(maskedNameProblems('林○'), []); assert.deepEqual(maskedNameProblems('歐陽○明'), []); assert.deepEqual(maskedNameProblems('李＊華'), []);
  assert.ok(maskedNameProblems('王小明').length === 2, '沒遮罩＋3 字完整姓名');
  assert.ok(maskedNameProblems('王小明○').some((m) => m.includes('連續中文字')));
  assert.deepEqual(candidateNoProblems('1150924-012'), []);
  assert.ok(candidateNoProblems('A123456789')[0].includes('疑似身分證字號'));
  assert.ok(!candidateNoProblems('A123456789')[0].includes('3456789'), '錯誤訊息本身不印出完整號碼');
  const s = loadedFresh();
  addItem(s, job({ slug: 'pii', result: { publishedAt: '2026-10-20', admitted: [{ seq: 1, candidateNo: 'A123456789', nameMasked: '王小明' }], waitlist: [{ rank: 1, candidateNo: '1150901-009', nameMasked: '陳大文' }] },
    waitlistUpdates: [{ date: '2026-10-25', candidateNo: 'B223456789', nameMasked: '林○' }] }));
  const errs = validateSite(s).filter((e) => e.includes('pii'));
  assert.ok(errs.length >= 4, errs.join('\n'));
  assert.ok(errs.some((e) => e.includes('個資閘門') && e.includes('result.admitted[0].nameMasked') && e.includes('王小明')));
  assert.ok(errs.some((e) => e.includes('result.admitted[0].candidateNo') && e.includes('身分證字號')));
  assert.ok(errs.some((e) => e.includes('result.waitlist[0].nameMasked')));
  assert.ok(errs.some((e) => e.includes('waitlistUpdates[0].candidateNo')));
  // 正取超過名額、note 含身分證字號也擋
  const over = jobPiiErrors(job({ positions: 1, result: { publishedAt: '2026-10-20', note: '請 A123456789 報到', admitted: [{ seq: 1, candidateNo: '1150901-001', nameMasked: '王○明' }, { seq: 2, candidateNo: '1150901-002', nameMasked: '林○' }] } }));
  assert.ok(over.some((e) => e.includes('超過名額'))); assert.ok(over.some((e) => e.includes('result.note')));
  // 實際內容全部通過，且結果檢核摘要給後台
  for (const j of jobs.filter((x) => x.result)) { assert.deepEqual(jobPiiErrors(j), []); assert.equal(j.gov.resultCheck.masked, true); assert.equal(j.gov.resultCheck.withinPositions, true); }
});

// ── AI 白名單：名單不進索引 ──
test('result／waitlistUpdates 不進答案索引（民眾與專業）：任何 chunk 都沒有遮罩姓名或報名編號；textOf 也不含', () => {
  assert.deepEqual(JOB_INDEX_EXCLUDED_FIELDS, ['result', 'waitlistUpdates']);
  const chunks = [...site.searchIndex.public, ...site.searchIndex.pro].filter((c) => c.type === 'job');
  assert.ok(chunks.length >= jobs.length, '職缺有進索引（白名單）');
  const blob = JSON.stringify(chunks);
  assert.ok(ALL_NAMES.length > 0);
  for (const r of ALL_NAMES) { assert.ok(!blob.includes(r.nameMasked), r.nameMasked); assert.ok(!blob.includes(r.candidateNo), r.candidateNo); }
  for (const c of chunks) for (const f of JOB_INDEX_EXCLUDED_FIELDS) assert.ok(!(f in c), `${c.id} 有 ${f}`);
  for (const j of jobs) { const t = textOf(j); for (const r of [...(j.result?.admitted ?? []), ...(j.result?.waitlist ?? [])]) assert.ok(!t.includes(r.nameMasked)); }
  const sa = site.searchIndex.public.find((c) => c.id === 'job.2026-08-10-system-analyst#overview');
  assert.ok(sa.sentences.some((x) => x.includes('只公布報名編號與遮罩姓名')));
  assert.equal(sa.resultUrl, '/careers/system-analyst/#result');
  assert.ok(site.searchIndex.public.some((c) => c.type === 'tender'), '採購公告進民眾索引');
});

// ── 轉址 ──
test('redirects：舊 /news/{slug}/ → /careers/{slug}/、/procurement/{slug}/（kind moved）；進伺服器對照與 legacy-map', () => {
  const r = buildRedirects(site);
  const moved = r.filter((x) => x.kind === 'moved');
  const legacy = [...jobs, ...tenders].flatMap((x) => (x.legacyIds ?? []).map((id) => [id, x]));
  assert.equal(legacy.length, 8, '8 則舊新聞有 legacyIds（官網改版案示意標案已移除，不保留轉址）');
  for (const [old, item] of legacy) {
    assert.ok(!site.byId.has(old), `${old} 舊檔已刪除`);
    const m = moved.find((x) => x.legacyId === old);
    assert.ok(m, old); assert.equal(m.from, `/news/${old.replace(/^news\./, '')}/`); assert.equal(m.to, pathOf(item)); assert.equal(m.status, 301);
  }
  assert.equal(pathOf(byId('job.2026-09-30-epidemic-physician')), '/careers/epidemic-physician/');
  assert.equal(pathOf(byId('tender.2026-09-15-antiviral-115')), '/procurement/antiviral-115/');
  const lm = buildLegacyMap(site, r, serverRedirects(r));
  assert.equal(lm.map['/news/2026-09-30-recruit-epidemic-physician'], '/careers/epidemic-physician/');
  assert.equal(lm.map['/news/2026-02-20-procurement-flu-vaccine'], '/procurement/flu-vaccine-115/');
  // 移轉清單：欄目清單、owner、verified:false、target 存在
  const lists = site.migration.lists.filter((l) => ['migration.careers', 'migration.procurement'].includes(l.id));
  assert.equal(lists.length, 2);
  assert.equal(lists.find((l) => l.id === 'migration.careers').owner, 'unit.personnel'); assert.equal(lists.find((l) => l.id === 'migration.procurement').owner, 'unit.secretariat');
  for (const l of lists) { assert.equal(l.scope.kind, 'category'); assert.ok(l.items.length >= 6 && l.items.length <= 8); assert.ok(l.items.every((i) => i.verified === false)); assert.ok(l.legacyRoot.startsWith('https://www.cdc.gov.tw/Category/List/')); }
  assert.ok(byId('job.2026-08-10-system-analyst').gov.legacy?.count >= 2);
});

// ── 輸出 ──
const { files, write } = memWriter();
emitApi(site, write);
const feeds = buildFeeds(site);
const jsonOut = (p) => JSON.parse(files.get(p));
test('v1/jobs.json、v1/tenders.json：含 stage／stageLabel／tab，列入 index 與 openapi', () => {
  const j = jsonOut('v1/jobs.json');
  assert.equal(j.data.length, jobs.length);
  for (const x of j.data) { assert.ok(JOB_STAGE_LABELS[x.stage]); assert.equal(x.stageLabel, JOB_STAGE_LABELS[x.stage]); assert.ok(x.tab); assert.ok(x.governance.jobStage); }
  assert.equal(j.data[0].tab, 'open', '開放中排最前');
  assert.ok(j.meta.privacy.includes('遮罩姓名'));
  const t = jsonOut('v1/tenders.json');
  assert.equal(t.data.length, tenders.length);
  for (const x of t.data) { assert.ok(TENDER_STAGE_LABELS[x.stage]); assert.equal(x.stageLabel, TENDER_STAGE_LABELS[x.stage]); }
  const idx = jsonOut('v1/index.json').data.map((e) => e.path);
  assert.ok(idx.includes('/v1/jobs.json') && idx.includes('/v1/tenders.json'));
  const o = buildOpenApi(site);
  assert.ok(o.paths['/v1/jobs.json'] && o.paths['/v1/tenders.json'] && o.paths['/feeds/careers.xml'] && o.paths['/feeds/procurement.xml']);
  assert.ok(o.components.schemas.Job && o.components.schemas.Tender);
  const r = jsonOut('v1/redirects.json');
  assert.ok(r.meta.byKind.moved >= 8);
  assert.equal(jsonOut('v1/catalog.json').data.find((x) => x.id === 'tender.2026-09-15-antiviral-115').category, 'press');
});

test('feeds：careers.xml（職缺＋甄選結果＋遞補各一筆、不含名單）、procurement.xml（招標＋決標＋流標各一筆）', () => {
  const c = feeds['feeds/careers.xml'];
  assert.ok(c.includes('<guid isPermaLink="false">job.2026-08-10-system-analyst</guid>'));
  assert.ok(c.includes('<guid isPermaLink="false">job.2026-08-10-system-analyst#result</guid>'));
  assert.ok(c.includes('job.2026-08-10-system-analyst#waitlist-1'));
  for (const r of ALL_NAMES) { assert.ok(!c.includes(r.nameMasked), r.nameMasked); assert.ok(!c.includes(r.candidateNo)); }
  const p = feeds['feeds/procurement.xml'];
  assert.ok(p.includes('tender.2026-02-20-flu-vaccine-115#award')); assert.ok(p.includes('tender.2026-08-18-cold-chain-monitor#failed'));
  assert.ok(p.includes('<guid isPermaLink="false">tender.2026-09-15-antiviral-115</guid>'));
});

test('sitemap／robots／llms：/careers/、/procurement/ 與各職缺、標案頁；模擬報名頁不收、robots 擋', () => {
  const pages = derivePages(site).filter((p) => p.lang === 'zh-TW').map((p) => p.path);
  for (const p of ['/careers/', '/procurement/', '/careers/epidemic-physician/', '/procurement/antiviral-115/']) assert.ok(pages.includes(p), p);
  assert.ok(!pages.some((p) => p.includes('/apply/') && p.startsWith('/careers/')));
  assert.ok(derivePages(site).some((p) => p.path === '/careers/' && p.lang === 'en'), '列表頁七語');
  assert.match(buildRobots(site), new RegExp(`Disallow: ${config.basePath}/careers/\\*/apply/`));
  const llms = buildLlms(site, 'zh-TW');
  assert.ok(llms.includes('jobs.json') && llms.includes('feeds/careers.xml'));
});

test('JSON-LD：job → JobPosting（validThrough、employmentType、hiringOrganization、jobLocation；不含名單）；tender → GovernmentService＋Offer', () => {
  const ctx = { site, lang: 'zh-TW', url: makeUrl('zh-TW'), path: '/', today: TODAY };
  const [jp] = jsonLdFor(ctx, byId('job.2026-08-10-system-analyst'));
  assert.equal(jp['@type'], 'JobPosting');
  assert.equal(jp.datePosted, '2026-08-10'); assert.equal(jp.validThrough, '2026-08-31T23:59:59+08:00');
  assert.deepEqual(jp.employmentType, ['FULL_TIME', 'TEMPORARY']);
  assert.equal(jp.hiringOrganization['@type'], 'GovernmentOrganization'); assert.equal(jp.jobLocation.address.addressRegion, '臺北市');
  assert.equal(jp.totalJobOpenings, 1); assert.ok(jp.description.includes('薪資待遇')); assert.equal(jp.baseSalary, undefined);
  assert.ok(!JSON.stringify(jp).includes('李○翰'));
  const [open] = jsonLdFor(ctx, byId('job.2026-09-30-epidemic-physician'));
  assert.equal(open.directApply, true); assert.ok(open.potentialAction.target.endsWith('/careers/epidemic-physician/apply/'));
  const [gs] = jsonLdFor(ctx, byId('tender.2026-09-15-antiviral-115'));
  assert.equal(gs['@type'], 'GovernmentService'); assert.equal(gs.offers['@type'], 'Offer'); assert.equal(gs.offers.price, 96000000); assert.equal(gs.offers.priceCurrency, 'TWD');
  assert.equal(gs.identifier, 'CDC-115-AC-031');
});

// ── 答案引擎 ──
test('答案引擎 careers：結構化列開放中職缺（職稱、用人單位、名額、報名期間、連結）；「誰錄取」只給結果頁連結不唸名單；無開放中 ⇒ 說沒有並給 /careers/', () => {
  assert.equal(classifyIntent('疾管署有缺嗎').intent, 'careers');
  assert.equal(classifyIntent('人事室電話').intent, 'careers');
  assert.equal(classifyIntent('最近有哪些招標案').intent, 'procurement');
  const eng = engineFromSite(site);
  const r = eng.answer('疾管署有缺嗎');
  assert.equal(r.intent, 'careers'); assert.equal(r.refused, false); assert.equal(r.careers.structured, true);
  const open = jobs.filter((j) => j.gov.jobStage === 'open').map((j) => j.id).sort();
  assert.deepEqual(r.careers.items.map((x) => x.id).sort(), open);
  assert.ok(r.sources.every((x) => x.type === 'job' && !x.closed));
  assert.ok(r.sentences.some((x) => x.text.includes('名額')) && r.sentences.some((x) => x.text.includes('報名期間')));
  assert.ok(r.actions.some((a) => a.href === '/careers/'));
  const w = eng.answer('誰錄取了？');
  assert.equal(w.intent, 'careers'); assert.equal(w.careers.mode, 'admitted'); assert.equal(w.careers.privacy, true);
  const text = JSON.stringify([w.sentences, w.actions, w.careers]);
  for (const x of ALL_NAMES) { assert.ok(!text.includes(x.nameMasked), x.nameMasked); assert.ok(!text.includes(x.candidateNo)); }
  assert.ok(w.actions.some((a) => a.href === '/careers/system-analyst/#result'));
  assert.ok(w.sentences.every((x) => x.text.includes('遮罩姓名')));
  assert.equal(eng.answer('錄取的人全名是什麼').refusal?.kind, 'privacy');
  // 一年後：沒有開放中職缺
  const later = engineFromSite({ ...site, today: '2027-06-01' });
  const none = later.answer('現在有職缺嗎');
  assert.equal(none.refused, true); assert.equal(none.refusal.kind, 'no-open-job'); assert.ok(none.refusal.actions.some((a) => a.href === '/careers/'));
});

test('答案引擎 procurement：列招標中標案（案號、預算、投標截止），指名標案可問決標', () => {
  const eng = engineFromSite(site);
  const r = eng.answer('疾管署最近有哪些標案在招標？');
  assert.equal(r.intent, 'procurement');
  const open = tenders.filter((x) => x.gov.tenderStage === 'open').map((x) => x.id).sort();
  assert.deepEqual(r.procurement.items.map((x) => x.id).sort(), open);
  assert.ok(r.sentences.some((x) => x.text.includes('投標截止日')));
  const a = eng.answer('流感疫苗採購案決標了嗎');
  assert.ok(a.sources.every((x) => x.contentId === 'tender.2026-02-20-flu-vaccine-115'));
  assert.ok(a.sentences.some((x) => x.text.includes('決標')));
});

test('評估集：notice 類（職缺、採購、誰錄取、錄取者個資）全部通過，且至少新增 3 題', async () => {
  const qs = site.governance.evalSet.questions.filter((q) => q.category === 'notice');
  assert.ok(qs.length >= 5);
  assert.ok(qs.some((q) => q.expect.mustNotInclude?.includes('○') && q.expect.intent === 'careers'), '「誰錄取」題檢查不出現遮罩姓名');
  const rep = await runEval(site, { category: 'notice' });
  assert.equal(rep.skippedCount, 0, JSON.stringify(rep.skipped));
  assert.equal(rep.failed, 0, JSON.stringify(rep.failures, null, 1));
});
