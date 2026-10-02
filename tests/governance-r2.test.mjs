// 第二輪治理規則測試（ARCHITECTURE.md 第 11 節）：公告截止、影音過時／逐字稿、專區到期、外部連結健康、
// 檢驗一致性、通報時限表、byOwner.types、KPI 四列。全部用合成資料（不依賴 B2 內容筆數）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LIFECYCLE_LABELS, TODO_KIND_LABELS, pathOf, mdPathOf, externalLinksOf, notifyLabel } from '../scripts/lib/governance.mjs';
import { govern, mk, addItem } from './helpers.mjs';

const TODAY = '2026-10-01';
const MMR_NEW = 'doc.mmr-recommendation.2025-04-16';
const todosOf = (site, id) => site.gov.todos.filter((t) => t.itemId === id);

// ── R8 公告截止 ──
test('R8 公告截止：deadlineAt < today ⇒ closed、lifecycle closed「已截止」、不產生待辦、不退白名單', () => {
  const site = govern(TODAY, (s) => {
    addItem(s, mk({ type: 'news', id: 'news.test-recruit-closed', newsType: 'recruit', deadlineAt: '2026-09-20', refNo: '疾管人字第 1150000001 號', positions: 2, applyUrl: 'https://web3.dgpa.gov.tw/want03front/AP/WANTF00003.aspx' }));
  });
  const n = site.byId.get('news.test-recruit-closed');
  assert.equal(n.gov.closed, true);
  assert.equal(n.gov.closingSoon, false);
  assert.equal(n.gov.notice, true);
  assert.equal(n.gov.lifecycle, 'closed');
  assert.equal(n.gov.lifecycleLabel, '已截止');
  assert.equal(n.gov.daysToDeadline, -11);
  assert.equal(n.gov.whitelist.effective, true, '已截止公告仍可被問到「上次招募是什麼時候」');
  assert.deepEqual(n.gov.whitelist.reasons, []);
  assert.deepEqual(todosOf(site, n.id).filter((t) => t.kind !== 'link-broken'), [], '截止不產生待辦');
  assert.ok(n.gov.annotations.some((a) => a.kind === 'closed' && a.text.includes('2026-09-20')));
});

test('R8 公告 7 日內截止 ⇒ closingSoon；截止日當天仍進行中；更遠或無截止日 ⇒ 都不是', () => {
  const site = govern(TODAY, (s) => {
    addItem(s, mk({ type: 'news', id: 'news.test-proc-soon', newsType: 'procurement', deadlineAt: '2026-10-05', refNo: 'CDC115-001', budgetNtd: 1200000 }));
    addItem(s, mk({ type: 'news', id: 'news.test-proc-today', newsType: 'procurement', deadlineAt: TODAY }));
    addItem(s, mk({ type: 'news', id: 'news.test-proc-later', newsType: 'procurement', deadlineAt: '2026-10-20' }));
    addItem(s, mk({ type: 'news', id: 'news.test-other-nodl', newsType: 'other' }));
  });
  const soon = site.byId.get('news.test-proc-soon');
  assert.equal(soon.gov.closingSoon, true); assert.equal(soon.gov.closed, false); assert.equal(soon.gov.daysToDeadline, 4);
  assert.equal(soon.gov.lifecycle, 'current');
  const today = site.byId.get('news.test-proc-today');
  assert.equal(today.gov.closed, false); assert.equal(today.gov.closingSoon, true);
  assert.equal(site.byId.get('news.test-proc-later').gov.closingSoon, false);
  const nodl = site.byId.get('news.test-other-nodl');
  assert.equal(nodl.gov.closed, false); assert.equal(nodl.gov.deadlineAt, null); assert.equal(nodl.gov.notice, true);
  assert.equal(site.byId.get('news.2026-09-22-enterovirus-alert').gov.notice, false, '新聞稿不是公告');
});

// ── R9 影音 ──
test('R9 影音過時：producedAt 早於正本現行版 ⇒ 加註「本影片依…製作」、mediaOutdated、退出白名單、media-outdated 待辦取代 based-on-revised', () => {
  const site = govern(TODAY, (s) => {
    addItem(s, mk({ type: 'media', id: 'media.test-mmr-old', title: 'MMR 衛教影片（舊）', producedAt: '2024-11-01', publishedAt: '2024-12-01', reviewedAt: '2025-01-01', reviewPeriodMonths: 24, basedOn: ['doc.mmr-recommendation'], basedOnVersionLabel: '108.05.14 版建議' }));
    addItem(s, mk({ type: 'media', id: 'media.test-mmr-nolabel', producedAt: '2025-03-01', publishedAt: '2025-03-10', reviewedAt: '2025-03-10', basedOn: ['doc.mmr-recommendation'] }));
  });
  const cur = site.byId.get(MMR_NEW);
  const m = site.byId.get('media.test-mmr-old');
  assert.equal(m.gov.mediaOutdated, true);
  assert.equal(m.gov.stale.length, 1);
  const a = m.gov.annotations.find((x) => x.kind === 'based-on-revised');
  assert.equal(a.text, `本影片依 108.05.14 版建議 製作，所依據的「${cur.title}」已於 2025-04-16 修訂，請以現行版為準`);
  assert.equal(a.href, MMR_NEW); assert.equal(a.path, pathOf(cur));
  assert.equal(m.gov.whitelist.effective, false);
  assert.ok(m.gov.whitelist.reasons.includes('based-on-revised'));
  assert.equal(m.gov.lifecycle, 'based-on-revised');
  const todos = todosOf(site, m.id);
  assert.ok(!todos.some((t) => t.kind === 'based-on-revised'), 'media-outdated 取代 based-on-revised');
  const t = todos.find((x) => x.kind === 'media-outdated');
  assert.equal(t.severity, 'high'); assert.match(t.text, /更新說明欄或下架/); assert.equal(t.dueAt, '2025-04-23'); assert.equal(t.href, '/media/test-mmr-old/');
  // 標籤寫成畫面整句「依 … 製作」也只取版本字樣
  const site2 = govern(TODAY, (s) => addItem(s, mk({ type: 'media', id: 'media.test-mmr-phrase', producedAt: '2024-11-01', basedOn: ['doc.mmr-recommendation'], basedOnVersionLabel: '依 108.05.14 版建議製作' })));
  assert.match(site2.byId.get('media.test-mmr-phrase').gov.annotations.find((x) => x.kind === 'based-on-revised').text, /^本影片依 108\.05\.14 版建議 製作，/);
  // 無 basedOnVersionLabel ⇒ 以 producedAt 表示
  const n = site.byId.get('media.test-mmr-nolabel');
  assert.match(n.gov.annotations.find((x) => x.kind === 'based-on-revised').text, /^本影片依 2025-03-01 製作，/);
});

test('R9 影音：製作日晚於正本現行版 ⇒ 不過時；說明欄更新（reviewedAt ≥ 修訂日）⇒ 待辦結案但加註保留、不回白名單', () => {
  const site = govern(TODAY, (s) => {
    addItem(s, mk({ type: 'media', id: 'media.test-mmr-new', producedAt: '2025-06-01', publishedAt: '2025-06-10', basedOn: ['doc.mmr-recommendation'] }));
    addItem(s, mk({ type: 'media', id: 'media.test-mmr-fixed', producedAt: '2024-11-01', publishedAt: '2024-12-01', reviewedAt: '2025-05-01', basedOn: ['doc.mmr-recommendation'] }));
  });
  const ok = site.byId.get('media.test-mmr-new');
  assert.equal(ok.gov.mediaOutdated, false); assert.equal(ok.gov.whitelist.effective, true); assert.equal(ok.gov.annotations.length, 0);
  const fixed = site.byId.get('media.test-mmr-fixed');
  assert.equal(fixed.gov.mediaOutdated, true); assert.equal(fixed.gov.stale.length, 0);
  assert.ok(fixed.gov.annotations.some((x) => x.kind === 'based-on-revised'), '畫面內容不變，加註保留');
  assert.ok(fixed.gov.whitelist.reasons.includes('predates-basis'));
  assert.ok(!todosOf(site, fixed.id).some((t) => t.kind === 'media-outdated'));
});

test('R9 影音無逐字稿（< 50 字）⇒ media-no-transcript 待辦（medium）；有逐字稿不產生', () => {
  const site = govern(TODAY, (s) => {
    addItem(s, mk({ type: 'media', id: 'media.test-no-tr', transcriptMarkdown: '（無）' }));
    addItem(s, mk({ type: 'media', id: 'media.test-has-tr' }));
  });
  const no = site.byId.get('media.test-no-tr');
  assert.equal(no.gov.hasTranscript, false); assert.equal(no.gov.transcriptChars, 3);
  const t = todosOf(site, no.id).find((x) => x.kind === 'media-no-transcript');
  assert.ok(t); assert.equal(t.severity, 'medium'); assert.match(t.text, /逐字稿/);
  const has = site.byId.get('media.test-has-tr');
  assert.equal(has.gov.hasTranscript, true);
  assert.ok(!todosOf(site, has.id).some((x) => x.kind === 'media-no-transcript'));
});

// ── R10 專區到期 ──
test('R10 專區 endAt < today ⇒ ended、lifecycle ended「已結束」，不退白名單；未到期／未開始', () => {
  const site = govern(TODAY, (s) => {
    addItem(s, mk({ type: 'topic', id: 'topic.test-ended', slug: 'test-ended', startAt: '2025-11-01', endAt: '2026-09-30' }));
    addItem(s, mk({ type: 'topic', id: 'topic.test-running', slug: 'test-running', startAt: '2026-09-01', endAt: '2026-12-31' }));
    addItem(s, mk({ type: 'topic', id: 'topic.test-upcoming', slug: 'test-upcoming', startAt: '2026-11-01' }));
  });
  const e = site.byId.get('topic.test-ended');
  assert.equal(e.gov.ended, true); assert.equal(e.gov.lifecycle, 'ended'); assert.equal(e.gov.lifecycleLabel, '已結束');
  assert.equal(e.gov.whitelist.effective, true, '不退白名單');
  assert.ok(e.gov.annotations.some((a) => a.kind === 'ended'));
  assert.deepEqual(todosOf(site, e.id), []);
  const r = site.byId.get('topic.test-running');
  assert.equal(r.gov.ended, false); assert.equal(r.gov.lifecycle, 'current');
  assert.equal(site.byId.get('topic.test-upcoming').gov.upcoming, true);
});

test('宣導 Banner 檔期：campaignStatus active／upcoming／ended', () => {
  const site = govern(TODAY, (s) => {
    addItem(s, mk({ type: 'banner', id: 'banner.test-past', startAt: '2026-06-01', endAt: '2026-08-31', headline: 'x' }));
    addItem(s, mk({ type: 'banner', id: 'banner.test-now', startAt: '2026-09-01', endAt: '2026-10-31', headline: 'x' }));
    addItem(s, mk({ type: 'banner', id: 'banner.test-next', startAt: '2026-11-01', endAt: '2026-12-31', headline: 'x' }));
  });
  assert.equal(site.byId.get('banner.test-past').gov.campaignStatus, 'ended');
  assert.equal(site.byId.get('banner.test-now').gov.campaignStatus, 'active');
  assert.equal(site.byId.get('banner.test-next').gov.campaignStatus, 'upcoming');
});

// ── R11 外部連結健康 ──
test('R11 外部連結：收成 site.gov.externalLinks；broken ⇒ link-broken 待辦（含網址與欄位）；未檢查標 unchecked 不開待辦；站內連結不收', () => {
  const site = govern(TODAY, (s) => {
    addItem(s, mk({ type: 'topic', id: 'topic.test-links', slug: 'test-links', links: [
      { label: '站內', href: '/faq/' },
      { label: '正常外站', href: 'https://www.mohw.gov.tw/', external: true, lastCheckedAt: '2026-09-28', status: 'ok' },
      { label: '失連外站', href: 'https://gone.example.gov.tw/page', external: true, lastCheckedAt: '2026-09-28', status: 'broken' },
      { label: '未檢查', href: 'https://www.who.int/', external: true },
    ] }));
    addItem(s, mk({ type: 'service', id: 'service.test-apply', slug: 'test-apply', applyUrl: 'https://apply.example.gov.tw/form', linkChecks: { applyUrl: { lastCheckedAt: '2026-09-29', status: 'broken' } },
      forms: [{ label: '申請書', href: 'https://www.cdc.gov.tw/File/Get/form-a', lastCheckedAt: '2026-09-29', status: 'ok' }] }));
    addItem(s, mk({ type: 'news', id: 'news.test-notice-link', newsType: 'recruit', applyUrl: 'https://web3.dgpa.gov.tw/x' }));
    addItem(s, mk({ type: 'publication', id: 'pub.test-pdf', pdfUrl: 'https://www.cdc.gov.tw/File/Get/pub.pdf', linkChecks: { pdfUrl: { lastCheckedAt: '2026-09-29', status: 'ok' } } }));
    addItem(s, mk({ type: 'media', id: 'media.test-video', videoUrl: 'https://www.youtube.com/watch?v=abc', linkChecks: { videoUrl: { lastCheckedAt: '2026-09-29', status: 'broken' } } }));
  });
  const links = site.gov.externalLinks.filter((l) => l.itemId.includes('.test-'));
  const by = (id, field) => links.find((l) => l.itemId === id && l.field === field);
  assert.equal(links.filter((l) => l.itemId === 'topic.test-links').length, 3, '站內連結不收');
  assert.equal(by('topic.test-links', 'links[1]').status, 'ok');
  assert.equal(by('topic.test-links', 'links[2]').status, 'broken');
  assert.equal(by('topic.test-links', 'links[3]').status, 'unchecked');
  assert.equal(by('topic.test-links', 'links[3]').lastCheckedAt, null);
  assert.equal(by('service.test-apply', 'applyUrl').status, 'broken');
  assert.equal(by('service.test-apply', 'forms[0]').status, 'ok');
  assert.equal(by('news.test-notice-link', 'applyUrl').status, 'unchecked');
  assert.equal(by('pub.test-pdf', 'pdfUrl').status, 'ok');
  assert.equal(by('media.test-video', 'videoUrl').status, 'broken');
  for (const k of ['url', 'itemId', 'field', 'lastCheckedAt', 'status']) assert.ok(k in links[0], k);
  const lb = site.gov.todos.filter((t) => t.kind === 'link-broken' && t.itemId.includes('.test-'));
  assert.deepEqual(lb.map((t) => t.id).sort(), ['link-broken:media.test-video:videoUrl', 'link-broken:service.test-apply:applyUrl', 'link-broken:topic.test-links:links[2]']);
  const t = lb.find((x) => x.itemId === 'topic.test-links');
  assert.equal(t.severity, 'medium'); assert.ok(t.text.includes('https://gone.example.gov.tw/page')); assert.ok(t.text.includes('links[2]'));
  assert.equal(t.dueAt, '2026-10-05');
  assert.deepEqual(site.byId.get('topic.test-links').gov.linkHealth, { total: 3, ok: 1, broken: 1, unchecked: 1 });
  assert.ok(site.gov.linkHealth.broken >= 3);
  // 文件 pdfUrl 也收
  assert.ok(site.gov.externalLinks.some((l) => l.itemType === 'document' && l.field === 'pdfUrl'));
  // helper 與引擎一致
  assert.equal(externalLinksOf(site.byId.get('topic.test-links')).length, 3);
});

// ── R12 檢驗一致性 ──
test('R12 檢驗：送驗時限 > 主檔通報時限 ⇒ labtest-inconsistent（low）；相等不開；疾病頁有 specimen 記錄', () => {
  const site = govern(TODAY, (s) => {
    addItem(s, mk({ type: 'labtest', id: 'lab.test-dengue-slow', disease: 'disease.dengue', sendWithinHours: 48 }));
    addItem(s, mk({ type: 'labtest', id: 'lab.test-dengue-ok', disease: 'disease.dengue', sendWithinHours: 24 }));
  });
  const slow = site.byId.get('lab.test-dengue-slow');
  assert.equal(slow.gov.labtestCheck.notifyWithinHours, 24);
  assert.equal(slow.gov.labtestCheck.consistent, false);
  assert.equal(slow.gov.labtestCheck.diseaseSpecimen, true, '登革熱疾病頁有 professional.specimen');
  const t = todosOf(site, slow.id).find((x) => x.kind === 'labtest-inconsistent');
  assert.equal(t.severity, 'low'); assert.match(t.text, /48 小時/); assert.equal(t.href, '/lab/test-dengue-slow/');
  const ok = site.byId.get('lab.test-dengue-ok');
  assert.equal(ok.gov.labtestCheck.consistent, true);
  assert.ok(!todosOf(site, ok.id).some((x) => x.kind === 'labtest-inconsistent'));
});

// ── R13 通報時限表 ──
test('R13 通報時限表：依類別分組、每種主檔疾病恰一列、含疾病頁／病例定義／檢驗項目連結', () => {
  const site = govern(TODAY, (s) => {
    addItem(s, mk({ type: 'labtest', id: 'lab.test-measles', disease: 'disease.measles', sendWithinHours: 24 }));
  });
  const table = site.gov.notifyTable;
  assert.ok(Array.isArray(table) && table.length >= 1);
  const cats = table.map((g) => g.legalCategory);
  assert.deepEqual(cats, [...cats].sort((a, b) => a - b), '依類別排序');
  for (const g of table) {
    assert.ok(g.label.startsWith('第')); assert.ok(Array.isArray(g.diseases));
    for (const d of g.diseases) for (const k of ['id', 'slug', 'name', 'nameEn', 'notifyWithinHours', 'hasPage']) assert.ok(k in d, `${d.id}.${k}`);
  }
  const rows = table.flatMap((g) => g.diseases);
  assert.equal(rows.length, site.master.diseases.length);
  assert.equal(new Set(rows.map((r) => r.id)).size, rows.length);
  const dengue = rows.find((r) => r.id === 'disease.dengue');
  assert.equal(dengue.hasPage, true); assert.equal(dengue.path, '/diseases/dengue/');
  assert.equal(dengue.notifyWithinHours, 24); assert.equal(dengue.notifyLabel, '24 小時內');
  assert.equal(dengue.caseDefinitionDoc, 'doc.case-definition-dengue');
  assert.equal(table.find((g) => g.diseases.includes(dengue)).legalCategory, 2);
  const measles = rows.find((r) => r.id === 'disease.measles');
  assert.ok(measles.labtestIds.includes('lab.test-measles'));
  assert.equal(measles.labtestId, measles.labtestIds[0]); assert.equal(measles.labtestPath, pathOf(site.byId.get(measles.labtestId)));
  const noPage = rows.find((r) => r.id === 'disease.smallpox');
  assert.equal(noPage.hasPage, false); assert.equal(noPage.path, null); assert.ok(!('labtestId' in noPage));
  assert.equal(notifyLabel(168), '一週內'); assert.equal(notifyLabel(720), '一個月內');
});

// ── byOwner ──
test('byOwner：每單位 types 計數加總＝content、latestReviewedAt＝最大審閱日', () => {
  const site = govern(TODAY, (s) => {
    addItem(s, mk({ type: 'media', id: 'media.test-owner', owner: 'unit.vaccine', reviewedAt: '2026-09-30' }));
  });
  for (const r of site.gov.byOwner) {
    assert.equal(Object.values(r.types).reduce((a, b) => a + b, 0), r.content, r.unit);
    const items = site.all.filter((i) => i.owner === r.unit);
    assert.equal(r.latestReviewedAt, items.map((i) => i.reviewedAt).sort().at(-1) ?? null, r.unit);
  }
  const vac = site.gov.byOwner.find((r) => r.unit === 'unit.vaccine');
  assert.ok(vac.types.media >= 1); assert.ok(vac.types.faq >= 1);
  assert.ok(vac.latestReviewedAt >= '2026-09-30');
});

// ── KPI 四列 ──
test('KPI 新增四列：media-transcript、media-current-basis、link-health、notices-closed-unarchived', () => {
  const add = (s) => {
    addItem(s, mk({ type: 'media', id: 'media.test-kpi-ok', producedAt: '2026-01-01' }));
    addItem(s, mk({ type: 'media', id: 'media.test-kpi-bad', producedAt: '2024-01-01', transcriptMarkdown: '' }));
    addItem(s, mk({ type: 'topic', id: 'topic.test-kpi', slug: 'test-kpi', links: [
      { label: 'a', href: 'https://a.gov.tw/', lastCheckedAt: '2026-09-30', status: 'ok' },
      { label: 'b', href: 'https://b.gov.tw/', lastCheckedAt: '2026-09-30', status: 'broken' },
    ] }));
    addItem(s, mk({ type: 'news', id: 'news.test-kpi-old-closed', newsType: 'recruit', deadlineAt: '2026-06-01' }));
    addItem(s, mk({ type: 'news', id: 'news.test-kpi-recent-closed', newsType: 'recruit', deadlineAt: '2026-09-01' }));
    addItem(s, mk({ type: 'news', id: 'news.test-kpi-archived', newsType: 'procurement', deadlineAt: '2026-01-01', status: 'archived' }));
  };
  const base = govern(TODAY).gov.kpiByKey;
  const site = govern(TODAY, add);
  const k = site.gov.kpiByKey;
  for (const key of ['media-transcript', 'media-current-basis', 'link-health', 'notices-closed-unarchived']) {
    assert.ok(k[key], key);
    for (const f of ['label', 'unit', 'status', 'target1y', 'direction']) assert.ok(k[key][f] !== undefined, `${key}.${f}`);
  }
  assert.equal(k['media-transcript'].target1y, 100);
  assert.equal(k['media-current-basis'].target1y, 100);
  assert.equal(k['link-health'].target1y, 95);
  assert.equal(k['notices-closed-unarchived'].target1y, 0);
  assert.equal(k['notices-closed-unarchived'].direction, 'lower');
  const d = (key, f) => (k[key][f] ?? 0) - (base[key][f] ?? 0);
  assert.equal(d('media-transcript', 'denominator'), 2); assert.equal(d('media-transcript', 'numerator'), 1);
  assert.equal(d('media-current-basis', 'denominator'), 2); assert.equal(d('media-current-basis', 'numerator'), 1);
  assert.ok(k['media-current-basis'].items.includes('media.test-kpi-bad'));
  assert.equal(d('link-health', 'denominator'), 2); assert.equal(d('link-health', 'numerator'), 1);
  assert.notEqual(k['link-health'].current, null);
  // 全站都未檢查過 ⇒ pending（不顯示 0%）
  const unchecked = govern(TODAY, (s) => { for (const i of s.all) { delete i.linkChecks; for (const l of i.links ?? []) { delete l.status; delete l.lastCheckedAt; } for (const f of i.forms ?? []) { delete f.status; delete f.lastCheckedAt; } } });
  assert.equal(unchecked.gov.kpiByKey['link-health'].current, null); assert.equal(unchecked.gov.kpiByKey['link-health'].status, 'pending');
  assert.equal(d('notices-closed-unarchived', 'current'), 1, '截止超過 90 天且仍 published 才計；封存與 30 天內不計');
  assert.ok(k['notices-closed-unarchived'].items.includes('news.test-kpi-old-closed'));
  assert.notEqual(k['notices-closed-unarchived'].status, 'ok');
  assert.equal(k['media-current-basis'].current, Math.round((k['media-current-basis'].numerator / k['media-current-basis'].denominator) * 1000) / 10);
});

// ── 對照表與路徑 ──
test('新生命週期／待辦種類有中文；六型別 pathOf／mdPathOf', () => {
  assert.equal(LIFECYCLE_LABELS.closed, '已截止'); assert.equal(LIFECYCLE_LABELS.ended, '已結束');
  for (const k of ['media-outdated', 'media-no-transcript', 'link-broken', 'labtest-inconsistent']) assert.ok(TODO_KIND_LABELS[k], k);
  const cases = [
    [{ type: 'media', id: 'media.flu-2026' }, '/media/flu-2026/', '/media/flu-2026.md'],
    [{ type: 'topic', id: 'topic.prep', slug: 'prep' }, '/topics/prep/', '/topics/prep.md'],
    [{ type: 'service', id: 'service.data-request', slug: 'data-request' }, '/apply/data-request/', '/apply/data-request.md'],
    [{ type: 'publication', id: 'pub.bulletin-42-18' }, '/publications/bulletin-42-18/', '/publications/bulletin-42-18.md'],
    [{ type: 'labtest', id: 'lab.dengue' }, '/lab/dengue/', '/lab/dengue.md'],
    [{ type: 'research', id: 'research.amr-2026' }, '/research/amr-2026/', '/research/amr-2026.md'],
  ];
  for (const [item, p, md] of cases) { assert.equal(pathOf(item), p); assert.equal(mdPathOf(item), md); }
  // 所有待辦都有中文種類
  const site = govern(TODAY, (s) => {
    addItem(s, mk({ type: 'media', id: 'media.test-labels', transcriptMarkdown: '', producedAt: '2024-01-01' }));
    addItem(s, mk({ type: 'labtest', id: 'lab.test-labels', sendWithinHours: 999 }));
  });
  for (const t of site.gov.todos) assert.ok(TODO_KIND_LABELS[t.kind], t.kind);
  for (const i of site.all) assert.ok(LIFECYCLE_LABELS[i.gov.lifecycle], i.gov.lifecycle);
  const s = site.gov.summary;
  for (const k of ['noticesClosed', 'topicsEnded', 'mediaOutdated', 'linksBroken', 'labtestsInconsistent']) assert.equal(typeof s[k], 'number', k);
});
