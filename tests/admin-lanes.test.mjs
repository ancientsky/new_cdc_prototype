// 第九輪（Z3）：後台 /admin/publish/ 的車道徽章、排程與緊急發布預檢、模擬送出時間軸（純函式）。
import test from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../src/client/admin/preprocess.js';

const NAMES = { 'unit.pr': '公關室', 'unit.oasis': 'OASIS（資料與 AI 組幕僚）' };
const NOW = Date.parse('2026-10-04T12:00:00+08:00');

test('normalizeLanes：缺檔或欄位缺漏時用契約預設，三條車道都在', () => {
  for (const raw of [undefined, null, {}, { lanes: { fast: { slaMinutes: 60 } } }]) {
    const c = P.normalizeLanes(raw);
    assert.deepEqual(Object.keys(c.lanes).sort(), ['emergency', 'fast', 'standard']);
    assert.ok(c.lanes.fast.types.includes('news'));
    assert.equal(c.rules.ciIsTheReviewer, true);
  }
  assert.equal(P.normalizeLanes({ lanes: { fast: { slaMinutes: 60 } } }).lanes.fast.slaMinutes, 60);
});

test('laneOf：依型別與 urgent 判定車道；urgent 對不允許型別無效；未知型別走一般車道', () => {
  assert.equal(P.laneOf('news').id, 'fast');
  assert.equal(P.laneOf('clarification').id, 'fast');
  assert.equal(P.laneOf('news', true).id, 'emergency');
  assert.equal(P.laneOf('letter', true).id, 'emergency');
  assert.equal(P.laneOf('faq', true).id, 'standard', 'faq 不可 urgent');
  for (const t of ['disease', 'vaccine', 'document', 'faq', 'topic', 'service', 'publication', 'labtest', 'research', 'media']) assert.equal(P.laneOf(t).id, 'standard', t);
  assert.equal(P.laneOf('something-new').id, 'standard');
  assert.equal(P.laneOf('recruit').id, 'fast', '舊 recruit 草稿視同 news');
  for (const t of P.TYPES.map((x) => x.value)) assert.ok(['fast', 'standard'].includes(P.laneOf(t).id), `${t} 每個上架型別都有車道`);
});

test('laneSentence：三句說明；一級內容的審核人含 OASIS', () => {
  assert.match(P.laneSentence(P.laneOf('news'), 'news', NAMES), /^快車道：送出後約 3 分鐘上線，公關室 24 小時內複核$/);
  assert.match(P.laneSentence(P.laneOf('faq'), 'faq', NAMES), /^一般車道：需 1 位審核（公關室），SLA 2 個工作天$/);
  assert.match(P.laneSentence(P.laneOf('disease'), 'disease', NAMES), /^一般車道：需 1 位審核（公關室、OASIS），SLA 2 個工作天$/);
  assert.match(P.laneSentence(P.laneOf('news', true), 'news', NAMES), /^緊急發布：立即上線並通知複核/);
});

test('laneChecks：urgent 只能用於允許型別；publishAt 必須晚於現在；兩者併用警告', () => {
  const codes = (o) => P.laneChecks(o, NOW).map((c) => `${c.level}:${c.code}`);
  assert.deepEqual(codes({ type: 'news', urgent: true }), []);
  assert.deepEqual(codes({ type: 'faq', urgent: true }), ['error:urgent-type']);
  assert.deepEqual(codes({ type: 'news', publishAt: '2026-10-05T09:00:00+08:00' }), []);
  assert.deepEqual(codes({ type: 'news', publishAt: '2026-10-04T11:59:00+08:00' }), ['error:publish-at-past']);
  assert.deepEqual(codes({ type: 'news', publishAt: '2026-10-04T12:00:00+08:00' }), ['error:publish-at-past'], '等於現在也不行');
  assert.deepEqual(codes({ type: 'news', publishAt: 'bad' }), ['error:publish-at-format']);
  assert.deepEqual(codes({ type: 'news', urgent: true, publishAt: '2026-10-05T09:00:00+08:00' }), ['warn:urgent-and-scheduled']);
});

test('toPublishAtIso／publishAtMs／fmtTaipei：datetime-local 視為臺北時間', () => {
  assert.equal(P.toPublishAtIso('2026-10-05T09:00'), '2026-10-05T09:00:00+08:00');
  assert.equal(P.toPublishAtIso(''), '');
  assert.equal(P.toPublishAtIso('2026-10-05'), '');
  assert.equal(P.publishAtMs('2026-10-05T09:00'), Date.parse('2026-10-05T01:00:00Z'));
  assert.equal(P.publishAtMs('2026-10-05'), Date.parse('2026-10-04T16:00:00Z'));
  assert.ok(Number.isNaN(P.publishAtMs('')));
  assert.equal(P.fmtTaipei(Date.parse('2026-10-05T01:00:00Z')), '2026-10-05 09:00');
});

test('buildExport：publishAt／urgent 只在有值時寫出', () => {
  const base = { type: 'news', id: 'news.2026-10-05-x', title: 't', body: 'b', owner: 'unit.pr', today: '2026-10-04', summary: 's', langs: {} };
  const a = P.buildExport(base);
  assert.equal('publishAt' in a, false); assert.equal('urgent' in a, false);
  const b = P.buildExport({ ...base, publishAt: '2026-10-05T09:00:00+08:00', urgent: false });
  assert.equal(b.publishAt, '2026-10-05T09:00:00+08:00'); assert.equal('urgent' in b, false);
  assert.equal(P.buildExport({ ...base, urgent: true }).urgent, true);
});

test('submitTimeline：快車道自動合併、一般車道等待審核、緊急車道、排程、CI 失敗', () => {
  const o = { id: 'news.2026-10-05-x', title: '標題', type: 'news', assets: [] };
  const keys = (t) => t.steps.map((s) => s.key);
  const fast = P.submitTimeline(o, { names: NAMES, nowMs: NOW });
  assert.deepEqual(keys(fast), ['branch', 'pr', 'ci', 'lane', 'merge', 'deploy', 'preview', 'review']);
  assert.equal(fast.lane.id, 'fast');
  assert.equal(fast.steps.find((s) => s.key === 'merge').title, '自動合併');
  assert.ok(fast.steps.every((s) => s.system && /正式環境由系統代做/.test(s.system)), '每一步都附「正式環境由系統代做」');
  assert.equal(fast.steps.find((s) => s.key === 'ci').checks.length, 5);
  assert.match(fast.previewUrl, /^https:\/\/ancientsky\.github\.io\/new_cdc_prototype\/preview\/pr-\d+\/$/);

  const std = P.submitTimeline({ ...o, type: 'disease' }, { names: NAMES, nowMs: NOW });
  assert.equal(std.lane.id, 'standard');
  assert.deepEqual(keys(std), ['branch', 'pr', 'ci', 'lane', 'merge', 'deploy', 'preview']);
  const m = std.steps.find((s) => s.key === 'merge');
  assert.equal(m.title, '等待審核'); assert.equal(m.status, 'wait');
  assert.match(m.detail.join(''), /公關室、OASIS/);
  assert.match(std.steps.find((s) => s.key === 'lane').detail[0], /SLA 2 個工作天/);

  const em = P.submitTimeline({ ...o, urgent: true }, { names: NAMES, nowMs: NOW });
  assert.equal(em.lane.id, 'emergency');
  assert.match(em.steps.find((s) => s.key === 'lane').detail[0], /urgent/);

  const sched = P.submitTimeline({ ...o, publishAt: '2026-10-05T09:00:00+08:00' }, { names: NAMES, nowMs: NOW });
  assert.equal(sched.scheduled, true);
  assert.equal(sched.steps.find((s) => s.key === 'deploy').status, 'wait');
  assert.match(sched.steps.find((s) => s.key === 'deploy').detail[0], /每 2 小時/);

  const bad = P.submitTimeline(o, { names: NAMES, nowMs: NOW, miss: ['owner'], failures: { schema: ['owner'] } });
  assert.equal(bad.steps.find((s) => s.key === 'ci').status, 'fail');
  assert.equal(bad.steps.find((s) => s.key === 'ci').checks.find((c) => c.key === 'schema').ok, false);
  assert.equal(bad.steps.find((s) => s.key === 'merge').status, 'skip');
  assert.equal(bad.steps.find((s) => s.key === 'preview').status, 'skip');
});
