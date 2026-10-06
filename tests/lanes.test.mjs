// 第九輪（ARCHITECTURE 17.1／17.2）：發布車道、排程發布（publishAt）、上線後複核待辦、CI 工作流程（字串檢查）。
// 時間：排程發布以真實現在時間判斷，測試一律以 site.now 注入（不依賴執行當下時間）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { ROOT } from '../scripts/lib/load.mjs';
import {
  loadLanes, validateLanes, laneOfItem, laneForFiles, classifyFile, slaOf, addWorkingDays, LANE_STRICTNESS,
  publishAtMs, nowOf, isScheduled, isPublic, publicView, scheduledItems,
} from '../scripts/lib/lanes.mjs';
import { TODO_KIND_LABELS, WHITELIST_REASON_LABELS, SCHEDULED_PUBLISH_LABEL, pathOf } from '../scripts/lib/governance.mjs';
import { emitApi } from '../scripts/lib/emit-api.mjs';
import { emitSeo, buildLlms, buildFeeds, derivePages } from '../scripts/lib/emit-seo.mjs';
import { siteForTemplate, makeCtx } from '../scripts/lib/pages.mjs';
import { buildSearchIndex } from '../scripts/lib/index-builder.mjs';
import { copyAssets } from '../scripts/lib/assets.mjs';
import { govern, mk, addItem, memWriter } from './helpers.mjs';

const TODAY = '2026-10-01';
// 注入的「現在」：2026-10-04 20:00 台灣時間
const NOW = Date.parse('2026-10-04T12:00:00Z');
const cfg = loadLanes();
const common = JSON.parse(fs.readFileSync(path.join(ROOT, 'schemas/_common.json'), 'utf8'));
const ALL_TYPES = common.properties.type.enum;
const todosOf = (site, id) => site.gov.todos.filter((t) => t.itemId === id);
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// ───────────────────────── lanes.json ─────────────────────────

test('lanes.json：形狀正確、三條車道、每個內容型別恰好一條車道、situation 走緊急發布', () => {
  assert.deepEqual(validateLanes(cfg, ALL_TYPES), []);
  assert.deepEqual(LANE_STRICTNESS, ['emergency', 'fast', 'standard']);
  assert.deepEqual(cfg.strictness, LANE_STRICTNESS);
  const { emergency, fast, standard } = cfg.lanes;
  assert.equal(emergency.label, '緊急發布'); assert.equal(fast.label, '快車道'); assert.equal(standard.label, '一般車道');
  assert.deepEqual(emergency.types, ['situation']);
  assert.deepEqual(emergency.alsoWhen, { urgent: true });
  assert.equal(emergency.slaMinutes, 10); assert.equal(fast.slaMinutes, 180); assert.equal(standard.slaWorkingDays, 2);
  assert.equal(emergency.autoMerge, true); assert.equal(fast.autoMerge, true); assert.equal(standard.autoMerge, false);
  assert.equal(standard.requiredApprovals, 1);
  assert.deepEqual(standard.reviewers, ['unit.pr']); assert.deepEqual(standard.tier1Reviewers, ['unit.pr', 'unit.oasis']);
  assert.equal(fast.postPublishReviewHours, 24); assert.equal(emergency.postPublishReviewHours, 24);
  assert.deepEqual(fast.types, ['news', 'letter', 'clarification', 'job', 'tender', 'banner']);
  assert.equal(cfg.rules.translationsNeverBlock, true);
  assert.equal(cfg.rules.ciIsTheReviewer, true);
  assert.deepEqual(cfg.rules.machineTranslationAllowedFor, ['news', 'faq', 'topic', 'service']);
  assert.deepEqual(cfg.rules.urgentAllowedTypes, ['news', 'letter', 'clarification']);
  // 驗證器抓得到錯
  const broken = structuredClone(cfg);
  broken.lanes.fast.types.push('disease');
  broken.lanes.standard.requiredApprovals = 0;
  const errs = validateLanes(broken, ALL_TYPES);
  assert.ok(errs.some((e) => e.includes('disease')), errs.join('；'));
  assert.ok(errs.some((e) => e.includes('至少要 1 位核准')), errs.join('；'));
  assert.ok(validateLanes({ lanes: {} }, ALL_TYPES).some((e) => e.includes('沒有對應車道')));
});

test('_common.json：publishAt（date-time 或 date）、urgent（只限 news／letter／clarification）、postPublishReview', () => {
  const ajv = new Ajv2020({ allErrors: true, strict: false, allowUnionTypes: true });
  addFormats(ajv);
  for (const f of fs.readdirSync(path.join(ROOT, 'schemas')).filter((x) => x.endsWith('.json'))) {
    const s = JSON.parse(read(`schemas/${f}`)); ajv.addSchema(s, s.$id);
  }
  const vNews = ajv.getSchema('https://cdc-prototype/schemas/news.json');
  const vFaq = ajv.getSchema('https://cdc-prototype/schemas/faq.json');
  const ok = (v, x) => { const r = v(x); return r || (v.errors ?? []).map((e) => `${e.instancePath} ${e.message}`).join('; '); };
  const news = mk({ type: 'news', id: 'news.2026-10-05-schema-test' });
  delete news.aiWhitelist;
  assert.equal(ok(vNews, news), true);
  assert.equal(ok(vNews, { ...news, publishAt: '2026-10-05T09:00:00+08:00' }), true);
  assert.equal(ok(vNews, { ...news, publishAt: '2026-10-05' }), true);
  assert.notEqual(vNews({ ...news, publishAt: '明天早上' }), true, 'publishAt 格式錯誤要擋');
  assert.equal(ok(vNews, { ...news, urgent: true, postPublishReview: { status: 'pending' } }), true);
  assert.equal(ok(vNews, { ...news, postPublishReview: { status: 'done', reviewedBy: 'unit.pr', reviewedAt: '2026-10-05T10:00:00+08:00' } }), true);
  assert.notEqual(vNews({ ...news, postPublishReview: { status: 'maybe' } }), true);
  assert.notEqual(vNews({ ...news, postPublishReview: {} }), true, 'status 必填');
  const faq = mk({ type: 'faq', id: 'faq.schema-urgent-test' });
  delete faq.aiWhitelist;
  assert.equal(ok(vFaq, faq), true);
  assert.equal(ok(vFaq, { ...faq, urgent: false }), true, 'urgent:false 任何型別都可');
  assert.notEqual(vFaq({ ...faq, urgent: true }), true, 'urgent:true 只限 news／letter／clarification');
});

// ───────────────────────── 車道推導 ─────────────────────────

test('laneOfItem：依型別；urgent:true（允許型別）⇒ 緊急發布；其他型別標 urgent 無效', () => {
  assert.equal(laneOfItem({ type: 'news' }), 'fast');
  assert.equal(laneOfItem({ type: 'letter' }), 'fast');
  assert.equal(laneOfItem({ type: 'job' }), 'fast');
  assert.equal(laneOfItem({ type: 'banner' }), 'fast');
  assert.equal(laneOfItem({ type: 'news', urgent: true }), 'emergency');
  assert.equal(laneOfItem({ type: 'clarification', urgent: true }), 'emergency');
  assert.equal(laneOfItem({ type: 'situation' }), 'emergency');
  assert.equal(laneOfItem({ type: 'disease' }), 'standard');
  assert.equal(laneOfItem({ type: 'faq', urgent: true }), 'standard');
  assert.equal(laneOfItem({ type: 'tender', urgent: true }), 'fast');
  assert.equal(laneOfItem({ type: 'unknown' }), 'standard');
});

test('laneForFiles：單檔快車道自動合併；多檔取最嚴格；一級內容加 OASIS；程式／文件變更一律一般車道', () => {
  const since = '2026-10-05T01:00:00Z';
  const fast = laneForFiles(['content/news/2026-10-05-x.json'], { since });
  assert.equal(fast.lane, 'fast'); assert.equal(fast.label, '快車道'); assert.equal(fast.ghLabel, 'lane:fast');
  assert.equal(fast.autoMerge, true); assert.equal(fast.requiredApprovals, 0); assert.deepEqual(fast.reviewers, []);
  assert.deepEqual(fast.postPublishReview, { owner: 'unit.pr', ownerName: '公關室', hours: 24 });
  assert.equal(fast.sla.dueAt, '2026-10-05T04:00:00.000Z');
  assert.deepEqual(fast.files, [{ file: 'content/news/2026-10-05-x.json', type: 'news', lane: 'fast', reason: fast.files[0].reason }]);
  for (const k of ['lane', 'label', 'autoMerge', 'requiredApprovals', 'reviewers', 'sla', 'files', 'reasons']) assert.ok(k in fast, k);

  const mixed = laneForFiles(['content/news/x.json', 'content/diseases/dengue.json'], { since });
  assert.equal(mixed.lane, 'standard');
  assert.equal(mixed.autoMerge, false); assert.equal(mixed.requiredApprovals, 1);
  assert.equal(mixed.tier1, true);
  assert.deepEqual(mixed.reviewers, ['unit.pr', 'unit.oasis']);
  assert.deepEqual(mixed.reviewerAccounts, ['ancientsky']);
  assert.deepEqual(mixed.reviewerNames, ['公關室', 'AI推動辦公室']);
  assert.deepEqual(mixed.files.map((f) => [f.file, f.type, f.lane]), [['content/news/x.json', 'news', 'fast'], ['content/diseases/dengue.json', 'disease', 'standard']]);
  assert.ok(mixed.reasons.some((r) => r.includes('多檔取最嚴格')));
  assert.equal(mixed.postPublishReview, null);

  const code = laneForFiles(['scripts/build.mjs', 'src/templates/public/news.mjs', 'docs/deploy.md', 'content/news/x.json'], { since });
  assert.equal(code.lane, 'standard'); assert.equal(code.tier1, false); assert.deepEqual(code.reviewers, ['unit.pr']);
  assert.ok(code.reasons.includes('程式／文件變更需審核'));
  assert.equal(code.files.find((f) => f.file === 'scripts/build.mjs').reason, '程式／文件變更需審核');

  const faq = laneForFiles(['content/faq/x.json'], { since });
  assert.equal(faq.lane, 'standard'); assert.equal(faq.tier1, false);
  assert.equal(laneForFiles(['content/situation/current.json'], { since }).lane, 'emergency');
  assert.equal(laneForFiles(['content/situation/current.json', 'content/jobs/x.json'], { since }).lane, 'fast');
  assert.equal(laneForFiles(['content/master/diseases.json'], { since }).lane, 'standard');
  assert.equal(laneForFiles(['content/governance/lanes.json'], { since }).lane, 'standard');
  const none = laneForFiles([], { since });
  assert.equal(none.lane, 'standard'); assert.ok(none.reasons[0].includes('沒有變更檔案'));
});

test('laneForFiles：讀檔判斷 urgent 與型別；檔案資產隨所屬內容；缺檔依目錄推定', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-'));
  try {
    fs.mkdirSync(path.join(root, 'content/news'), { recursive: true });
    fs.mkdirSync(path.join(root, 'content/assets/news.2026-10-05-urgent'), { recursive: true });
    fs.mkdirSync(path.join(root, 'content/assets/faq.orphan-owner'), { recursive: true });
    fs.writeFileSync(path.join(root, 'content/news/2026-10-05-urgent.json'), JSON.stringify({ id: 'news.2026-10-05-urgent', type: 'news', urgent: true }));
    fs.writeFileSync(path.join(root, 'content/news/2026-10-05-letter.json'), JSON.stringify({ id: 'news.2026-10-05-letter', type: 'letter' }));
    const urgent = laneForFiles(['content/news/2026-10-05-urgent.json'], { root });
    assert.equal(urgent.lane, 'emergency'); assert.equal(urgent.label, '緊急發布'); assert.equal(urgent.sla.minutes, 10);
    assert.equal(laneForFiles(['content/news/2026-10-05-urgent.json', 'content/news/2026-10-05-letter.json'], { root }).lane, 'fast');
    const letter = classifyFile('content/news/2026-10-05-letter.json', { root });
    assert.equal(letter.type, 'letter'); assert.equal(letter.lane, 'fast');
    const asset = laneForFiles(['content/assets/news.2026-10-05-urgent/a.pdf'], { root });
    assert.equal(asset.lane, 'emergency'); assert.equal(asset.files[0].type, 'news');
    assert.equal(laneForFiles(['content/assets/faq.orphan-owner/a.pdf'], { root }).lane, 'standard');
    assert.ok(classifyFile('content/news/gone.json', { root }).reason.includes('依目錄推定'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('SLA：分鐘制與工作天制（週末不算，台灣時間）', () => {
  assert.equal(slaOf('emergency', '2026-10-05T01:00:00Z').dueAt, '2026-10-05T01:10:00.000Z');
  const f = slaOf('fast', '2026-10-05T01:00:00Z');
  assert.equal(f.label, '3 小時'); assert.equal(f.dueAtLocal, '2026-10-05 12:00');
  // 2026-10-02 是週五：+2 工作天 ⇒ 週二
  const s = slaOf('standard', '2026-10-02T02:00:00Z');
  assert.equal(s.label, '2 個工作天'); assert.equal(s.workingDays, 2);
  assert.equal(s.dueAt, '2026-10-06T02:00:00.000Z');
  assert.equal(new Date(addWorkingDays(Date.parse('2026-10-05T02:00:00Z'), 2)).toISOString(), '2026-10-07T02:00:00.000Z');
});

test('scripts/lane.mjs CLI：參數或 stdin，輸出 JSON', () => {
  const cli = path.join(ROOT, 'scripts/lane.mjs');
  const a = spawnSync(process.execPath, [cli, 'content/news/x.json', 'content/diseases/dengue.json'], { encoding: 'utf8', cwd: ROOT });
  assert.equal(a.status, 0, a.stderr);
  const ja = JSON.parse(a.stdout);
  assert.equal(ja.lane, 'standard'); assert.equal(ja.files.length, 2); assert.equal(ja.requiredApprovals, 1);
  const b = spawnSync(process.execPath, [cli, '--since=2026-10-05T01:00:00Z'], { encoding: 'utf8', cwd: ROOT, input: 'content/news/x.json\ncontent/jobs/y.json\n' });
  assert.equal(b.status, 0, b.stderr);
  const jb = JSON.parse(b.stdout);
  assert.equal(jb.lane, 'fast'); assert.equal(jb.autoMerge, true); assert.equal(jb.files.length, 2);
  assert.equal(jb.sla.dueAt, '2026-10-05T04:00:00.000Z');
});

// ───────────────────────── 排程發布 ─────────────────────────

test('publishAt 時間判斷：只有日期 ⇒ 台灣 00:00；以注入的 now 判斷，不用 BUILD_TODAY', () => {
  assert.equal(publishAtMs('2026-10-05'), Date.parse('2026-10-04T16:00:00Z'));
  assert.equal(publishAtMs('2026-10-05T09:00:00+08:00'), Date.parse('2026-10-05T01:00:00Z'));
  assert.equal(publishAtMs(null), null); assert.equal(publishAtMs('亂寫'), null);
  assert.equal(nowOf({ now: NOW }), NOW); assert.equal(nowOf(NOW), NOW); assert.equal(nowOf('2026-10-04T12:00:00Z'), NOW);
  const item = { status: 'published', publishAt: '2026-10-05T09:00:00+08:00' };
  assert.equal(isScheduled(item, NOW), true); assert.equal(isPublic(item, NOW), false);
  assert.equal(isScheduled(item, Date.parse('2026-10-05T01:00:01Z')), false, '到點就上線');
  assert.equal(isPublic(item, Date.parse('2026-10-05T01:00:01Z')), true);
  assert.equal(isPublic({ status: 'draft' }, NOW), false);
  assert.equal(isPublic({ status: 'archived' }, NOW), false);
  assert.equal(isPublic({ status: 'archived' }, NOW, { archived: true }), true);
  assert.equal(isPublic({ status: 'published' }, NOW), true, '沒有 publishAt ⇒ 立即');
});

/** 合成站：排程中新聞、已到點新聞、緊急澄清（逾期未複核）、已複核、車道上線前的舊新聞、一般車道 Q&A */
function scheduledSite() {
  return govern(TODAY, (s) => {
    s.now = NOW;
    addItem(s, mk({ type: 'news', id: 'news.2026-10-05-embargo', title: '排程中的禁發新聞稿', publishedAt: '2026-10-05', reviewedAt: '2026-10-04', publishAt: '2026-10-05T09:00:00+08:00', diseases: ['disease.dengue'], tasks: ['situation'], summary: '禁發摘要禁發摘要' }));
    addItem(s, mk({ type: 'news', id: 'news.2026-10-04-released', title: '已到點的排程新聞稿', publishedAt: '2026-10-04', reviewedAt: '2026-10-04', publishAt: '2026-10-04T08:00:00+08:00' }));
    addItem(s, mk({ type: 'clarification', id: 'clarification.test-urgent', title: '緊急澄清', publishedAt: '2026-10-02', reviewedAt: '2026-10-02', reviewPeriodMonths: 12, urgent: true, postPublishReview: { status: 'pending' } }));
    addItem(s, mk({ type: 'news', id: 'news.2026-10-04-reviewed', title: '已複核新聞', publishedAt: '2026-10-04', reviewedAt: '2026-10-04', postPublishReview: { status: 'done', reviewedBy: 'unit.pr', reviewedAt: '2026-10-04' } }));
    addItem(s, mk({ type: 'news', id: 'news.2026-09-30-legacy', title: '車道上線前的舊新聞', publishedAt: '2026-09-30', reviewedAt: '2026-09-30' }));
    addItem(s, mk({ type: 'faq', id: 'faq.test-standard-lane', title: '一般車道 Q&A？', publishedAt: '2026-10-04', reviewedAt: '2026-10-04' }));
  });
}

test('治理：gov.lane、gov.scheduled（publishAt > now）⇒ 排程中、noindex、退出白名單、不算已發布', () => {
  const site = scheduledSite();
  const e = site.byId.get('news.2026-10-05-embargo');
  assert.equal(e.gov.lane, 'fast'); assert.equal(e.gov.laneLabel, '快車道');
  assert.equal(e.gov.scheduled, true); assert.equal(e.gov.publishScheduled, true);
  assert.equal(e.gov.lifecycle, 'scheduled'); assert.equal(e.gov.lifecycleLabel, SCHEDULED_PUBLISH_LABEL); assert.equal(SCHEDULED_PUBLISH_LABEL, '排程中');
  assert.equal(e.gov.noindex, true);
  assert.equal(e.gov.publishAtLocal, '2026-10-05 09:00');
  assert.ok(e.gov.whitelist.reasons.includes('scheduled')); assert.equal(e.gov.whitelist.effective, false);
  assert.ok(WHITELIST_REASON_LABELS.scheduled);
  assert.deepEqual(todosOf(site, e.id).filter((t) => t.kind === 'post-publish-review'), [], '還沒上線不用複核');
  const r = site.byId.get('news.2026-10-04-released');
  assert.equal(r.gov.scheduled, false); assert.equal(r.gov.publishScheduled, false); assert.equal(r.gov.lifecycle, 'current');
  assert.equal(site.byId.get('clarification.test-urgent').gov.lane, 'emergency');
  assert.equal(site.byId.get('faq.test-standard-lane').gov.lane, 'standard');
  assert.deepEqual(scheduledItems(site).map((i) => i.id), [e.id]);
  // 排程中不算已發布
  const totalPublished = site.all.filter((i) => i.status === 'published').length;
  assert.equal(site.gov.totalPublished, totalPublished - 1);
  // 時間到了（重建）⇒ 自動上線
  const later = govern(TODAY, (s) => { s.now = Date.parse('2026-10-05T01:00:00Z'); addItem(s, mk({ type: 'news', id: 'news.2026-10-05-embargo', publishedAt: '2026-10-05', publishAt: '2026-10-05T09:00:00+08:00' })); });
  assert.equal(later.byId.get('news.2026-10-05-embargo').gov.scheduled, false);
  assert.equal(later.byId.get('news.2026-10-05-embargo').gov.whitelist.effective, true);
});

test('治理：post-publish-review 待辦（快車道／緊急發布已上線未複核；owner 公關室；期限上線 + 24h；逾期升 high）', () => {
  const site = scheduledSite();
  assert.equal(TODO_KIND_LABELS['post-publish-review'], '上線後複核');
  const rel = todosOf(site, 'news.2026-10-04-released').filter((t) => t.kind === 'post-publish-review');
  assert.equal(rel.length, 1);
  assert.equal(rel[0].owner, 'unit.pr'); assert.equal(rel[0].ownerName, '公關室'); assert.equal(rel[0].ccOwner, 'unit.acute-infectious');
  assert.equal(rel[0].severity, 'medium'); assert.equal(rel[0].overdue, false);
  assert.equal(rel[0].dueAtTime, '2026-10-05T00:00:00.000Z', 'publishAt 2026-10-04 08:00 +08 + 24h');
  assert.equal(rel[0].dueAt, '2026-10-05');
  assert.equal(rel[0].lane, 'fast');
  assert.ok(rel[0].text.includes('快車道') && rel[0].text.includes('postPublishReview'));
  const urg = todosOf(site, 'clarification.test-urgent').filter((t) => t.kind === 'post-publish-review');
  assert.equal(urg.length, 1);
  assert.equal(urg[0].severity, 'high', '逾期升高'); assert.equal(urg[0].overdue, true);
  assert.equal(urg[0].dueAtTime, '2026-10-02T16:00:00.000Z', 'publishedAt 2026-10-02 00:00 +08 + 24h');
  assert.equal(urg[0].lane, 'emergency'); assert.ok(urg[0].text.includes('緊急發布'));
  assert.equal(site.byId.get('clarification.test-urgent').gov.postPublishReview.overdue, true);
  assert.deepEqual(todosOf(site, 'news.2026-10-04-reviewed').filter((t) => t.kind === 'post-publish-review'), [], 'done 不開待辦');
  assert.equal(site.byId.get('news.2026-10-04-reviewed').gov.postPublishReview.done, true);
  assert.deepEqual(todosOf(site, 'news.2026-09-30-legacy').filter((t) => t.kind === 'post-publish-review'), [], '車道上線前的舊內容不追溯');
  assert.deepEqual(todosOf(site, 'faq.test-standard-lane').filter((t) => t.kind === 'post-publish-review'), [], '一般車道上線前已審，不需上線後複核');
  // 既有內容（publishedAt 早於車道上線日）不產生任何上線後複核待辦
  const base = govern(TODAY);
  assert.deepEqual(base.gov.todos.filter((t) => t.kind === 'post-publish-review').map((t) => t.itemId), []);
});

test('排程中不輸出：publicView、API（news／catalog／tasks／whitelist／todos）、sitemap、llms.txt、RSS、答案索引、模板 pages()', async () => {
  const site = scheduledSite();
  const E = 'news.2026-10-05-embargo', R = 'news.2026-10-04-released';
  const embargo = site.byId.get(E);
  const view = publicView(site);
  assert.notEqual(view, site);
  assert.equal(view.byId.has(E), false); assert.equal(view.byId.has(R), true);
  assert.ok(!view.all.includes(embargo)); assert.ok(!view.collections.news.includes(embargo));
  assert.equal(publicView(view), view, '冪等');
  const plain = govern(TODAY, (s) => { s.now = NOW; });
  assert.equal(publicView(plain), plain, '沒有排程中內容 ⇒ 原樣回傳');

  // API
  const api = memWriter();
  emitApi(site, api.write);
  const data = (f) => JSON.parse(api.files.get(f)).data;
  assert.ok(!data('v1/news.json').some((n) => n.id === E)); assert.ok(data('v1/news.json').some((n) => n.id === R));
  assert.ok(!data('v1/catalog.json').some((n) => n.id === E)); assert.ok(data('v1/catalog.json').some((n) => n.id === R));
  assert.ok(!data('v1/tasks/situation.json').items.some((n) => n.id === E));
  assert.ok(!data('v1/governance/whitelist.json').items.some((n) => n.id === E));
  assert.ok(!data('v1/governance/todos.json').some((t) => t.itemId === E));
  assert.ok(!JSON.stringify(data('v1/diseases/dengue.json').related ?? {}).includes(E));
  for (const [f, body] of api.files) assert.ok(!body.includes('禁發摘要禁發摘要') && !body.includes(E), `${f} 洩漏排程中內容`);

  // SEO：sitemap、llms.txt、RSS
  const seo = memWriter();
  emitSeo(site, seo.write);
  const p = pathOf(embargo);
  for (const [f, body] of seo.files) {
    assert.ok(!body.includes(p), `${f} 含排程中頁面 ${p}`);
    assert.ok(!body.includes('排程中的禁發新聞稿'), `${f} 含排程中標題`);
  }
  assert.ok(seo.files.get('sitemap-news.xml').includes(pathOf(site.byId.get(R))));
  assert.ok(!buildLlms(site).includes(p));
  assert.ok(!buildFeeds(site)['feeds/news.xml'].includes(E));
  assert.ok(!derivePages(site).some((x) => x.path === p));

  // 答案索引（建置時以 publicView 建）
  const idx = buildSearchIndex(publicView(site));
  assert.ok(![...idx.public, ...idx.pro].some((c) => c.contentId === E || String(c.id).includes(E)));
  assert.ok(idx.pro.some((c) => c.contentId === R || String(c.id).includes(R)) || idx.public.some((c) => c.contentId === R), '已到點的有進索引');

  // 模板：一律拿 publicView（不渲染；後台也不會連到不存在的前台頁）；後台以 scheduledItems(view) 列「排程中」
  const newsMod = await import('../src/templates/public/news.mjs');
  const pubSite = siteForTemplate(site, 'public/news.mjs');
  const paths = newsMod.pages(pubSite).map((x) => x.path);
  assert.ok(!paths.includes(p)); assert.ok(paths.includes(pathOf(site.byId.get(R))));
  const list = String(newsMod.render(makeCtx(pubSite, 'zh-TW', { path: '/news/', alternates: ['zh-TW'] }), {}));
  assert.ok(!list.includes('排程中的禁發新聞稿'));
  const adminSite = siteForTemplate(site, 'admin/catalog.mjs');
  assert.equal(adminSite.byId.has(E), false);
  assert.deepEqual(scheduledItems(adminSite).map((i) => i.id), [E]);
  assert.deepEqual(adminSite.hiddenScheduled.map((i) => i.id), [E]);

  // 檔案資產：建置以 publicView 複製
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-assets-'));
  try {
    const assetsDir = path.join(tmp, 'src');
    fs.mkdirSync(path.join(assetsDir, E), { recursive: true });
    fs.writeFileSync(path.join(assetsDir, E, 'embargo.txt'), 'x');
    embargo.assets = [{ file: 'embargo.txt', kind: 'data', label: '禁發附件' }];
    copyAssets(publicView(site), path.join(tmp, 'dist'), { assetsDir });
    assert.equal(fs.existsSync(path.join(tmp, 'dist/files', E, 'embargo.txt')), false);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); delete embargo.assets; }
});

test('robots.txt：PR 預覽（/preview/）不給爬蟲', async () => {
  const { buildRobots } = await import('../scripts/lib/emit-seo.mjs');
  const { config } = await import('../site.config.mjs');
  assert.match(buildRobots(govern(TODAY)), new RegExp(`Disallow: ${config.basePath}/preview/`));
});

// ───────────────────────── CI 工作流程（字串檢查；真正端到端由整合者開測試 PR 驗證） ─────────────────────────

/** 極簡 YAML 檢查：無 tab、縮排為 2 的倍數、頂層鍵 name／on／permissions／jobs 存在 */
function yamlSanity(rel) {
  const text = read(rel);
  const problems = [];
  text.split('\n').forEach((line, i) => {
    if (line.includes('\t')) problems.push(`${rel}:${i + 1} 有 tab`);
    const ind = line.match(/^ */)[0].length;
    if (line.trim() && ind % 2) problems.push(`${rel}:${i + 1} 縮排 ${ind} 不是 2 的倍數`);
  });
  for (const k of ['name:', 'on:', 'permissions:', 'jobs:']) if (!new RegExp(`^${k}`, 'm').test(text)) problems.push(`${rel} 缺頂層 ${k}`);
  return { text, problems };
}
const has = (text, needles, rel) => { for (const n of needles) assert.ok(text.includes(n), `${rel} 缺「${n}」`); };

test('content-pr.yml：觸發、權限、併發、檢查、車道、預覽、留言、標籤、合併', () => {
  const rel = '.github/workflows/content-pr.yml';
  const { text, problems } = yamlSanity(rel);
  assert.deepEqual(problems, []);
  has(text, [
    'pull_request:', 'types: [opened, synchronize, reopened]',
    'contents: write', 'pull-requests: write', 'actions: write',
    'concurrency:', 'content-pr-${{ github.event.pull_request.number }}',
    'actions/checkout@v4', 'fetch-depth: 0', 'actions/setup-node@v4', 'node-version: 22', 'npm ci', 'npm test',
    'BUILD_TODAY=2026-10-01 node scripts/build.mjs --check',
    'node scripts/lane.mjs', 'git diff --name-only origin/main...HEAD',
    'preview/pr-${{ github.event.pull_request.number }}', 'BUILD_TODAY: 2026-10-01', 'SITE_URL: https://', 'LINK_CHECK: warn', 'npm run build',
    'previews', '--orphan', '--force-with-lease', 'github-actions[bot]', 'for attempt in',
    'gh workflow run pages.yml --ref main',
    '<!-- lane-bot -->', 'gh api', '-X PATCH', 'gh pr comment',
    'gh label create', 'gh pr edit', '--add-label',
    'gh pr merge', '--squash --delete-branch',
    'gh pr view', '--json reviews', 'APPROVED', '等待審核：需', 'SLA 至',
    'secrets.GITHUB_TOKEN',
  ], rel);
  // 合併後再觸發一次 pages.yml（GITHUB_TOKEN 的 push 不會觸發工作流程）
  assert.ok(/merged == 'true'/.test(text));
});

test('preview-cleanup.yml、lane-sla.yml：PR 關閉刪預覽並重新部署；每小時 SLA 逾期留言＋sla:breach（只一次）', () => {
  const c = yamlSanity('.github/workflows/preview-cleanup.yml');
  assert.deepEqual(c.problems, []);
  has(c.text, ['pull_request:', 'types: [closed]', 'contents: write', 'actions: write', 'previews', 'pr-$PR', 'gh workflow run pages.yml --ref main', '--force-with-lease'], 'preview-cleanup.yml');
  const s = yamlSanity('.github/workflows/lane-sla.yml');
  assert.deepEqual(s.problems, []);
  has(s.text, ['schedule:', "cron: '23 * * * *'", 'pull-requests: write', 'gh pr list', 'lane:', 'slaOf', 'sla:breach', 'gh pr comment', 'gh pr edit', '--add-label', 'gh label create'], 'lane-sla.yml');
  assert.ok(s.text.includes('names.includes("sla:breach")'), '已有標籤就跳過（只留一次）');
});

test('pages.yml：每 2 小時建置；fetch 只在手動或 02 UTC；previews 分支複製進 dist/preview（不存在略過）', () => {
  const rel = '.github/workflows/pages.yml';
  const { text, problems } = yamlSanity(rel);
  assert.deepEqual(problems, []);
  has(text, [
    "cron: '0 */2 * * *'", 'workflow_dispatch:', 'refresh:', 'date -u +%H', '"02"',
    "steps.refresh.outputs.refresh == 'true'", 'npm run fetch', 'git push origin HEAD:main',
    'git fetch --depth 1 origin', 'origin/previews', 'PREVIEWS_DIR', 'previews 分支不存在', 'dist/preview',
    'path: dist', 'actions/deploy-pages@v4', 'npm test', 'npm run build',
  ], rel);
  assert.ok(!text.includes("cron: '0 3 * * *'"));
  assert.ok(!/if: github.event_name != 'push'/.test(text), '快照回寫不再以 push 與否判斷');
  // build.mjs 會在連結檢查之後複製 PREVIEWS_DIR
  const build = read('scripts/build.mjs');
  assert.ok(build.includes('PREVIEWS_DIR') && build.includes("'preview'"));
});

test('CODEOWNERS：以註解標單位、帳號用 @ancientsky；一級內容目錄有對應', () => {
  const text = read('.github/CODEOWNERS');
  for (const line of text.split('\n').filter((l) => l.trim() && !l.startsWith('#'))) assert.match(line, /^\S+ @ancientsky$/, line);
  for (const d of ['/content/diseases/', '/content/vaccines/', '/content/documents/', '/content/faq/', '/content/news/', '/content/situation/']) assert.ok(text.includes(`${d} @ancientsky`), d);
  for (const u of ['公關室', 'OASIS', '疫情中心', '人事室', '秘書室', '資訊室']) assert.ok(text.includes(u), u);
});
