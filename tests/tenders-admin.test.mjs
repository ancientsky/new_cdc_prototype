// 第十六輪：採購公告上架與異動（/admin/tenders/edit/）。core 純函式、匯出 JSON 通過 schema、後台模板、前台「公告異動」區與列表 pill。
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeCtx } from '../scripts/lib/pages.mjs';
import { validateSite } from '../scripts/lib/validate.mjs';
import { loadSite } from '../scripts/lib/load.mjs';
import {
  buildTender, problemsOf, amendmentFor, cancelAmendment, exportFilename, dateChanges, parseAttachments, parseMoney, stageInfo, stripBuild,
} from '../src/client/admin/tenders-edit-core.js';
import * as adminEdit from '../src/templates/admin/tenders-edit.mjs';
import * as adminTenders from '../src/templates/admin/tenders.mjs';
import * as proc from '../src/templates/public/procurement.mjs';
import { govern, addItem, config } from './helpers.mjs';

const TODAY = '2026-10-01';
const site = govern(TODAY);
const tenders = site.collections.tenders;
const str = (r) => String(r);
const ctx = (path, lang = 'zh-TW') => makeCtx(site, lang, { path, alternates: ['zh-TW', 'en'] });
const ids = tenders.map((x) => x.id);

const FORM = {
  slug: 'mask-stock-116', title: '116 年度醫用口罩儲備採購案', summary: '醫用口罩儲備採購（示意）。', tenderNo: 'CDC-116-T-001', requestingUnit: 'unit.it',
  method: '公開招標', awardRule: '最低標', category: '財物', budgetNtd: '12,000,000', announcedAt: '2026-10-01', deadlineAt: '2026-10-20', openingAt: '2026-10-21',
  pccUrl: 'https://web.pcc.gov.tw/', scope: '醫用口罩 100 萬片\n\n外科口罩 50 萬片', specialTerms: '', attachments: '投標須知 | /pending/?ref=x&doc=投標須知 | PDF',
  contact: '疾管署秘書室：（02）2395-9825 轉分機（示意）', amendments: [], manualStatus: '', award: {},
};

test('buildTender（新增）：id＝tender.{公告日}-{slug}、共同欄位預設、textarea 拆行、金額去逗號、空欄位不輸出', () => {
  const t = buildTender(FORM, { today: TODAY });
  assert.equal(t.id, 'tender.2026-10-01-mask-stock-116');
  assert.equal(t.owner, 'unit.secretariat'); assert.equal(t.steward, '秘書室承辦人'); assert.equal(t.status, 'published');
  assert.deepEqual(t.audience, ['public']); assert.equal(t.license, 'OGDL-1.0'); assert.equal(t.reviewPeriodMonths, 0);
  assert.deepEqual(t.aiWhitelist, { requested: true, approvedBy: 'unit.oasis', approvedAt: TODAY });
  assert.deepEqual(t.languages, { 'zh-TW': { status: 'source' } });
  assert.equal(t.publishedAt, '2026-10-01'); assert.equal(t.reviewedAt, TODAY);
  assert.equal(t.budgetNtd, 12000000);
  assert.deepEqual(t.scope, ['醫用口罩 100 萬片', '外科口罩 50 萬片']);
  assert.ok(!('specialTerms' in t) && !('award' in t) && !('manualStatus' in t) && !('amendments' in t) && !('briefingAt' in t));
  assert.deepEqual(t.attachments, [{ label: '投標須知', url: '/pending/?ref=x&doc=投標須知', format: 'PDF' }]);
  assert.equal(exportFilename(t), 'content/tenders/2026-10-01-mask-stock-116.json');
  assert.deepEqual(problemsOf(t, TODAY, ids).filter((p) => p.level === 'error'), []);
});

test('buildTender（既有）：id／slug 鎖定，publishedAt、keywords、legacyIds、i18n、note 保留；建置欄位去掉', () => {
  const base = tenders.find((x) => x.slug === 'lab-reagents-115');
  const t = buildTender({ ...base, slug: 'hacked', award: base.award }, { today: TODAY, base });
  assert.equal(t.id, base.id); assert.equal(t.slug, 'lab-reagents-115');
  assert.equal(t.publishedAt, base.publishedAt); assert.deepEqual(t.keywords, base.keywords); assert.deepEqual(t.legacyIds, base.legacyIds); assert.equal(t.note, base.note);
  assert.equal(t.reviewedAt, TODAY);
  for (const k of ['gov', '__file', 'sourceHash']) assert.ok(!(k in t), k);
  assert.ok(!('gov' in stripBuild(base)) && !('__file' in stripBuild(base)));
  assert.equal(Object.keys(t).at(-1), 'note', 'note 固定放最後');
});

test('amendmentFor：截止變晚＝extend、其他改期＝reschedule、只有說明＝correction、什麼都沒改＝null；空說明自動擬', () => {
  const before = { deadlineAt: '2026-10-15', openingAt: '2026-10-16' };
  const ext = amendmentFor(before, { deadlineAt: '2026-10-22', openingAt: '2026-10-23' }, '', TODAY, '疾管秘字第 1 號');
  assert.equal(ext.kind, 'extend'); assert.equal(ext.date, TODAY); assert.equal(ext.refNo, '疾管秘字第 1 號');
  assert.match(ext.text, /投標截止日由 2026-10-15 展延至 2026-10-22/); assert.match(ext.text, /開標日由 2026-10-16 改為 2026-10-23/);
  assert.equal(amendmentFor(before, { ...before, openingAt: '2026-10-20' }, '開標日改期', TODAY).kind, 'reschedule');
  assert.equal(amendmentFor(before, { ...before, deadlineAt: '2026-10-10' }, '提前截止', TODAY).kind, 'reschedule', '截止提前不是展延');
  assert.equal(amendmentFor(before, { ...before, briefingAt: '2026-10-05' }, '', TODAY).kind, 'reschedule');
  const cor = amendmentFor(before, before, '更正採購範圍第 2 組品項名稱', TODAY);
  assert.equal(cor.kind, 'correction'); assert.ok(!('refNo' in cor));
  assert.equal(amendmentFor(before, before, '  ', TODAY), null);
  assert.deepEqual(dateChanges(before, { deadlineAt: '2026-10-15', openingAt: '2026-10-16', briefingAt: '' }), []);
  assert.deepEqual(cancelAmendment('failed', '截止時無廠商投標', TODAY), { date: TODAY, kind: 'cancel', text: '本標案流標：截止時無廠商投標' });
  assert.equal(cancelAmendment('', '', TODAY), null);
});

test('problemsOf：必填、日期先後、slug 格式與重複、award 與 manualStatus 並存、身分證字號樣式、pccUrl 空白提醒', () => {
  const errs = (t, list = ids) => problemsOf(t, TODAY, list).filter((p) => p.level === 'error').map((p) => p.text).join('\n');
  const warns = (t) => problemsOf(t, TODAY, ids).filter((p) => p.level === 'warn').map((p) => p.text).join('\n');
  const ok = buildTender(FORM, { today: TODAY });
  assert.match(errs(buildTender({ ...FORM, title: '', contact: '' }, { today: TODAY })), /標案名稱未填[\s\S]*聯絡窗口未填/);
  assert.match(errs(buildTender({ ...FORM, slug: 'Bad_Slug' }, { today: TODAY })), /只能用小寫英文/);
  assert.match(errs(buildTender({ ...FORM, slug: 'campaign-video' }, { today: TODAY })), /與既有標案重複/);
  assert.match(errs(buildTender({ ...FORM, announcedAt: '2026-10-25' }, { today: TODAY })), /公告日 2026-10-25 晚於投標截止日/);
  assert.match(errs(buildTender({ ...FORM, openingAt: '2026-10-19' }, { today: TODAY })), /開標日 2026-10-19 早於投標截止日/);
  assert.match(errs(buildTender({ ...FORM, budgetNtd: '12.5 萬' }, { today: TODAY })), /預算金額要填整數/);
  const aw = (award, extra = {}) => buildTender({ ...FORM, ...extra, award }, { today: TODAY });
  assert.match(errs(aw({ date: '2026-10-20', winner: '甲公司' })), /決標日 2026-10-20 早於開標日 2026-10-21/);
  assert.match(errs(aw({ date: '2026-10-21', winner: '' })), /得標廠商未填/);
  assert.match(errs(aw({ date: '2026-10-21', winner: 'A123456789 王小明' })), /得標廠商含身分證字號樣式/);
  assert.match(errs(aw({ date: '2026-10-21', winner: '甲公司', note: '負責人 B223456789' })), /決標備註含身分證字號樣式/);
  assert.match(errs(aw({ date: '2026-10-21', winner: '甲公司' }, { manualStatus: 'failed', manualStatusNote: 'x' })), /已有決標資訊，不得再標「流標」/);
  assert.match(warns(buildTender({ ...FORM, pccUrl: '' }, { today: TODAY })), /政府電子採購網連結空白/);
  assert.equal(errs(ok), '');
  assert.equal(parseMoney(''), undefined); assert.equal(parseMoney('NT$ 1,200'), 1200); assert.ok(Number.isNaN(parseMoney('abc')));
  assert.deepEqual(parseAttachments('A | /x\n\nB|https://y|CSV'), [{ label: 'A', url: '/x' }, { label: 'B', url: 'https://y', format: 'CSV' }]);
});

test('stageInfo 用 careers-rules 的 tenderStageOf：流標覆蓋、決標、招標中', () => {
  const t = buildTender(FORM, { today: TODAY });
  assert.deepEqual(stageInfo(t, TODAY), { stage: 'open', label: '招標中', badge: 'ok' });
  assert.equal(stageInfo({ ...t, manualStatus: 'failed' }, TODAY).label, '流標');
  assert.equal(stageInfo({ ...t, award: { date: '2026-10-22', winner: 'x' } }, '2026-10-23').stage, 'awarded');
});

test('匯出 JSON 經 validateSite 通過 schema 與跨檔檢查（新增、展延、流標、決標四種）', () => {
  const base = tenders.find((x) => x.slug === 'datacenter-ops');
  const ext = amendmentFor(base, { ...base, deadlineAt: '2026-11-19', openingAt: '2026-11-20' }, '', TODAY, '疾管秘字第 1150001001 號（示意）');
  const variants = [
    buildTender(FORM, { today: TODAY }),
    buildTender({ ...base, slug: 'mask-x', deadlineAt: '2026-11-19', openingAt: '2026-11-20', amendments: [...(base.amendments ?? []), ext] }, { today: TODAY, base }),
  ];
  const failedBase = tenders.find((x) => x.slug === 'surveillance-system-expansion');
  variants.push(buildTender({ ...failedBase, manualStatus: 'failed', manualStatusNote: '無廠商投標', amendments: [cancelAmendment('failed', '無廠商投標', TODAY)] }, { today: TODAY, base: failedBase }));
  const ppe = tenders.find((x) => x.slug === 'ppe-warehouse');
  variants.push(buildTender({ ...ppe, award: { date: '2026-10-05', winner: '丙物流股份有限公司（示意）', amountNtd: '3,100,000' } }, { today: TODAY, base: ppe }));
  for (const t of variants) {
    assert.deepEqual(problemsOf(t, TODAY, ids.filter((id) => id !== t.id)).filter((p) => p.level === 'error'), [], t.id);
    const s = loadSite(config); s.today = TODAY;
    const json = JSON.parse(JSON.stringify(t));
    const i = s.all.findIndex((x) => x.id === json.id);
    json.__file = exportFilename(json);
    if (i >= 0) { const col = s.collections.tenders; col[col.findIndex((x) => x.id === json.id)] = json; s.all[i] = json; s.byId.set(json.id, json); } else addItem(s, json);
    const errs = validateSite(s).filter((e) => e.includes(json.__file) || e.includes(json.id));
    assert.deepEqual(errs, [], json.id);
  }
  assert.equal(variants[1].amendments.at(-1).kind, 'extend');
});

test('後台 /admin/tenders/edit/：表單四區、預覽與匯出、資料島含標案（不含 gov）、單位與列舉', () => {
  assert.deepEqual(adminEdit.pages(), [{ path: '/admin/tenders/edit/', props: {}, noindex: true }]);
  const m = adminEdit.meta();
  assert.match(m.title, /^採購公告上架與異動/); assert.equal(m.adminKey, 'tenders'); assert.deepEqual(m.scripts, ['/assets/js/admin/tenders-edit.js']);
  const h = str(adminEdit.render(ctx('/admin/tenders/edit/')));
  for (const k of ['id="tf-form"', 'id="tf-pick"', 'id="tf-sec-a"', 'id="tf-sec-b"', 'id="tf-sec-c"', 'id="tf-sec-d"', 'id="tf-slug"', 'id="tf-am-add"', 'name="tf-ms" value="failed"', 'name="tf-ms" value="cancelled"', 'id="tf-aw-winner"', 'id="tf-preview"', 'id="tf-warn"', 'id="tf-out"', 'id="tf-file"', 'id="tf-copy"', 'id="tf-dl"']) assert.ok(h.includes(k), k);
  assert.match(h, /以政府電子採購網為準/);
  const m2 = h.match(/<script type="application\/json" id="adm-tenders-data">([\s\S]*?)<\/script>/);
  assert.ok(m2, '資料島');
  const data = JSON.parse(m2[1]);
  assert.equal(data.today, TODAY);
  assert.equal(data.tenders.length, tenders.length);
  assert.ok(data.tenders.every((x) => !('gov' in x) && !('__file' in x) && !('sourceHash' in x)));
  assert.ok(data.units.some((u) => u.id === 'unit.secretariat' && u.name));
  assert.deepEqual(data.enums.category, ['財物', '勞務', '工程']);
  assert.equal(data.stages.failed.label, '流標'); assert.equal(data.amendKinds.extend, '展延');
});

test('後台 /admin/tenders/：flow 提到表單、表格上方有按鈕連到 /admin/tenders/edit/', () => {
  const h = str(adminTenders.render(ctx('/admin/tenders/')));
  assert.match(h, /採購公告上架與異動/);
  assert.ok(h.indexOf('/admin/tenders/edit/') > 0 && h.indexOf('/admin/tenders/edit/') < h.indexOf('<table'));
});

test('前台詳情：示範標案有「公告異動」區（時程之後、倒序、kind pill、字號），14 天內頁首提示；.md 也列出', () => {
  const x = tenders.find((t) => t.slug === 'campaign-video');
  assert.ok(x.amendments?.some((a) => a.kind === 'extend'), '示範資料要有展延紀錄');
  assert.equal(x.deadlineAt, '2026-10-22');
  const h = str(proc.render(ctx('/procurement/campaign-video/'), { item: x }));
  assert.ok(h.includes('id="amendments"'));
  assert.ok(h.indexOf('id="timeline"') < h.indexOf('id="amendments"'), '放在時程之後');
  assert.match(h, /<h2 id="h-amend">公告異動<\/h2>/);
  assert.match(h, /c-pill c-pill--info">展延<\/span>/);
  assert.match(h, /字號：疾管秘字第 1150000930 號/);
  assert.match(h, /c-tamend-recent/);
  assert.ok(h.indexOf('c-tamend-recent') < h.indexOf('id="info"'), '提示在頁首附近');
  const en = str(proc.render(ctx('/en/procurement/campaign-video/', 'en'), { item: x }));
  assert.match(en, /Notice amendments/); assert.match(en, />Extended</);
  const md = proc.markdown(ctx('/procurement/campaign-video/'), { item: x });
  assert.match(md, /## 公告異動\n\n- 2026-09-30［展延］投標截止日由 2026-10-15 展延至 2026-10-22/);
  // 倒序、超過 14 天不提示、沒有 amendments 就沒有區塊
  const two = { ...x, amendments: [{ date: '2026-08-01', kind: 'correction', text: '舊的更正' }, { date: '2026-09-10', kind: 'reschedule', text: '新的改期' }] };
  const h2 = str(proc.render(ctx('/procurement/campaign-video/'), { item: two }));
  assert.ok(h2.indexOf('新的改期') < h2.indexOf('舊的更正'));
  assert.ok(!h2.includes('c-tamend-recent'), '最新一筆超過 14 天不提示');
  const none = str(proc.render(ctx('/procurement/campaign-video/'), { item: { ...x, amendments: undefined } }));
  assert.ok(!none.includes('id="amendments"'));
});

test('前台列表：有異動且階段為 open／closed／opened 的卡片加「有異動」pill；已決標不加', () => {
  const h = str(proc.render(ctx('/procurement/'), {}));
  const card = h.match(/<li class="c-job c-tender" data-stage="open">(?:(?!<\/li>)[\s\S])*?campaign-video[\s\S]*?<\/li>/);
  assert.ok(card, '找到 campaign-video 卡片');
  assert.match(card[0], /c-pill c-pill--warn">有異動<\/span>/);
  const s2 = govern(TODAY, (s) => {
    const base = s.collections.tenders.find((t) => t.slug === 'lab-reagents-115');
    base.amendments = [{ date: '2026-07-01', kind: 'extend', text: '展延' }];
  });
  const h2 = str(proc.render(makeCtx(s2, 'zh-TW', { path: '/procurement/', alternates: ['zh-TW'] }), {}));
  const aw = h2.match(/<li class="c-job c-tender" data-stage="awarded">(?:(?!<\/li>)[\s\S])*?lab-reagents-115[\s\S]*?<\/li>/);
  assert.ok(aw && !aw[0].includes('有異動'));
});
