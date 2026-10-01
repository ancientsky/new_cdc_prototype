// 治理規則測試：ARCHITECTURE.md 第 3 節規則 1–7 與規劃 7.4／7.5／7.7，每條至少一個測試。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSite } from '../scripts/lib/load.mjs';
import { validateSite } from '../scripts/lib/validate.mjs';
import { applyGovernance, WHITELIST_REASON_LABELS, LIFECYCLE_LABELS, TODO_KIND_LABELS, pathOf, langRenderable } from '../scripts/lib/governance.mjs';
import { govern, mk, addItem, config } from './helpers.mjs';
import { addMonths } from '../scripts/lib/render.mjs';
import { addDays } from '../scripts/lib/governance.mjs';

const MMR_OLD = 'doc.mmr-recommendation.2019-05-14';
const MMR_NEW = 'doc.mmr-recommendation.2025-04-16';
const NEWS_OLD = 'news.2025-01-09-mmr-adults-measles';

test('schema 與參照檢查全部通過', () => {
  const site = loadSite(config); site.today = '2026-10-01';
  assert.deepEqual(validateSite(site), []);
  applyGovernance(site);
  assert.deepEqual(site.gov.warnings, []);
});

// ── R1 逾期 ──
test('R1 逾期：時間前進讓內容逾期 → 退出白名單、黃色警示「最後審閱於」、逾期待辦', () => {
  const base = govern('2026-10-01');
  const d0 = base.byId.get('disease.dengue');
  const next = addMonths(d0.reviewedAt, d0.reviewPeriodMonths);
  assert.equal(d0.gov.nextReviewAt, next);
  const ok = govern(addDays(next, -1));
  assert.equal(ok.byId.get('disease.dengue').gov.overdue, false);
  const late = govern(addDays(next, 1));
  const d = late.byId.get('disease.dengue');
  assert.equal(d.gov.overdue, true);
  assert.equal(d.gov.whitelist.effective, false);
  assert.ok(d.gov.whitelist.reasons.includes('overdue'));
  assert.equal(d.gov.lifecycle, 'overdue');
  assert.equal(d.gov.lifecycleLabel, '逾期待審');
  const a = d.gov.annotations.find((x) => x.kind === 'overdue');
  assert.match(a.text, new RegExp(`最後審閱於 ${d0.reviewedAt}`));
  const t = late.gov.todos.find((x) => x.kind === 'overdue' && x.itemId === 'disease.dengue');
  assert.equal(t.dueAt, next); assert.equal(t.overdue, true); assert.equal(t.href, '/diseases/dengue/');
});

test('R1 到期提醒：30 日內 dueSoon（後台黃）', () => {
  const d0 = govern().byId.get('disease.dengue');
  const site = govern(addDays(d0.gov.nextReviewAt, -14));
  const d = site.byId.get('disease.dengue');
  assert.equal(d.gov.overdue, false); assert.equal(d.gov.dueSoon, true); assert.equal(d.gov.daysToReview, 14);
});

test('R1 新聞稿（reviewPeriodMonths=0）不算逾期，但 stale 規則仍適用', () => {
  const site = govern('2031-01-01');
  const n = site.byId.get('news.2026-09-22-enterovirus-alert');
  assert.equal(n.gov.nextReviewAt, null); assert.equal(n.gov.overdue, false); assert.ok(!n.gov.whitelist.reasons.includes('overdue'));
  const old = site.byId.get(NEWS_OLD);
  assert.equal(old.gov.overdue, false);
  assert.equal(old.gov.stale.length, 1);
});

// ── R2 版本鏈 ──
test('R2 MMR 108.5.14 版自動失效：noindex、.md 首行、退出白名單、指向現行版', () => {
  const site = govern();
  const old = site.byId.get(MMR_OLD), cur = site.byId.get(MMR_NEW);
  assert.equal(old.isCurrent, false); assert.equal(old.supersededBy, cur.id); assert.equal(cur.isCurrent, true);
  assert.equal(old.gov.superseded, true); assert.equal(old.gov.noindex, true);
  assert.match(old.gov.mdNotice, /^本版已由 114\.04\.16 版取代/);
  assert.equal(old.gov.whitelist.effective, false); assert.ok(old.gov.whitelist.reasons.includes('superseded'));
  assert.equal(old.gov.lifecycleLabel, '已失效');
  const ann = old.gov.annotations.find((a) => a.kind === 'superseded');
  assert.equal(ann.href, MMR_NEW); assert.equal(ann.path, '/documents/mmr-recommendation.2025-04-16/');
  assert.equal(cur.gov.lifecycle, 'current'); assert.equal(cur.gov.lifecycleLabel, '現行版'); assert.equal(cur.gov.noindex, false);
  const fam = site.gov.families.find((f) => f.family === 'doc.mmr-recommendation');
  assert.equal(fam.current, MMR_NEW); assert.ok(fam.versions.length >= 2);
});

test('R2 三版版本鏈：v1→v2→v3，supersededBy 指下一版、currentId 指現行版', () => {
  const site = govern('2026-10-01', (s) => {
    addItem(s, mk({ type: 'document', id: 'doc.test-chain.v1', family: 'doc.test-chain', version: 'v1', effectiveAt: '2020-01-01', publishedAt: '2020-01-01', reviewedAt: '2020-01-01', reviewPeriodMonths: 12 }));
    addItem(s, mk({ type: 'document', id: 'doc.test-chain.v2', family: 'doc.test-chain', version: 'v2', effectiveAt: '2023-01-01', publishedAt: '2023-01-01', supersedes: 'doc.test-chain.v1', reviewPeriodMonths: 12 }));
    addItem(s, mk({ type: 'document', id: 'doc.test-chain.v3', family: 'doc.test-chain', version: 'v3', effectiveAt: '2026-03-01', publishedAt: '2026-03-01', supersedes: 'doc.test-chain.v2', reviewPeriodMonths: 12 }));
  });
  const [v1, v2, v3] = ['v1', 'v2', 'v3'].map((v) => site.byId.get(`doc.test-chain.${v}`));
  assert.equal(v1.gov.supersededBy, v2.id); assert.equal(v2.gov.supersededBy, v3.id); assert.equal(v3.gov.supersededBy, null);
  assert.equal(v1.gov.currentId, v3.id); assert.equal(v2.gov.currentId, v3.id);
  assert.ok(v1.gov.superseded && v2.gov.superseded && !v3.gov.superseded);
  assert.match(v1.gov.mdNotice, /v3 版取代/);
  // 失效版不因審閱週期再產生逾期待辦
  assert.equal(v1.gov.overdue, false);
  assert.ok(!site.gov.todos.some((t) => t.itemId === v1.id && t.kind === 'overdue'));
  const fam = site.gov.families.find((f) => f.family === 'doc.test-chain');
  assert.deepEqual(fam.versions.map((v) => v.id), [v1.id, v2.id, v3.id]);
});

test('R2 尚未生效的新版不取代現行版；生效日一到自動切換', () => {
  const mutate = (s) => {
    addItem(s, mk({ type: 'document', id: 'doc.test-future.a', family: 'doc.test-future', version: 'A', effectiveAt: '2025-01-01', publishedAt: '2025-01-01', reviewPeriodMonths: 24, reviewedAt: '2026-01-01' }));
    addItem(s, mk({ type: 'document', id: 'doc.test-future.b', family: 'doc.test-future', version: 'B', effectiveAt: '2027-01-01', publishedAt: '2026-09-01', reviewPeriodMonths: 24, reviewedAt: '2026-09-01' }));
  };
  const before = govern('2026-10-01', mutate);
  assert.equal(before.byId.get('doc.test-future.a').isCurrent, true);
  const b = before.byId.get('doc.test-future.b');
  assert.equal(b.gov.scheduled, true); assert.ok(b.gov.whitelist.reasons.includes('not-yet-effective')); assert.equal(b.gov.lifecycle, 'scheduled');
  const after = govern('2027-01-02', mutate);
  assert.equal(after.byId.get('doc.test-future.b').isCurrent, true);
  assert.equal(after.byId.get('doc.test-future.a').gov.superseded, true);
});

// ── R3 basedOn ──
test('R3 2025-01-09 新聞稿依據正本已修訂 → 自動加註（新聞稿措辭）、退出白名單、7 日待辦', () => {
  const site = govern();
  const n = site.byId.get(NEWS_OLD);
  assert.equal(n.gov.stale.length, 1); assert.equal(n.gov.stale[0].revisedAt, '2025-04-16'); assert.equal(n.gov.stale[0].currentId, MMR_NEW);
  assert.equal(n.gov.whitelist.effective, false);
  assert.ok(n.gov.whitelist.reasons.includes('based-on-revised')); assert.ok(n.gov.whitelist.reasons.includes('predates-basis'));
  const a = n.gov.annotations.find((x) => x.kind === 'based-on-revised');
  assert.match(a.text, /^本新聞稿發布於 2025-01-09，相關建議已於 2025-04-16 修訂，現行版請見/);
  assert.equal(a.href, MMR_NEW); assert.equal(a.path, '/documents/mmr-recommendation.2025-04-16/');
  const t = site.gov.todos.find((x) => x.kind === 'based-on-revised' && x.itemId === n.id);
  assert.equal(t.dueAt, '2025-04-23'); assert.equal(t.overdue, true); assert.equal(t.severity, 'high'); assert.equal(t.href, '/news/2025-01-09-mmr-adults-measles/');
  assert.equal(n.gov.lifecycleLabel, '依據已修訂');
  // 正本修訂後才發布的新聞稿不受影響
  const n2 = site.byId.get('news.2026-06-02-measles-travel-mmr-1966');
  assert.equal(n2.gov.stale.length, 0); assert.equal(n2.gov.predatesBasis, false);
});

test('R3 basedOn 指向 family 或指向特定舊版 id 都解析到現行版；指舊版另產生「仍連結失效版本」待辦', () => {
  const site = govern('2026-10-01', (s) => {
    addItem(s, mk({ id: 'faq.test-family', basedOn: ['doc.mmr-recommendation'], publishedAt: '2024-06-01', reviewedAt: '2025-01-01' }));
    addItem(s, mk({ id: 'faq.test-oldver', basedOn: [MMR_OLD], publishedAt: '2024-06-01', reviewedAt: '2025-01-01' }));
  });
  for (const id of ['faq.test-family', 'faq.test-oldver']) {
    const f = site.byId.get(id);
    assert.equal(f.gov.stale[0].currentId, MMR_NEW, id);
    assert.match(f.gov.annotations.find((a) => a.kind === 'based-on-revised').text, /^本內容發布於/);
    const t = site.gov.todos.find((x) => x.id === `based-on-revised:${id}:${MMR_NEW}`);
    assert.equal(t.dueAt, '2025-04-23');
  }
  assert.ok(site.gov.todos.some((t) => t.kind === 'superseded-still-linked' && t.itemId === 'faq.test-oldver'));
  assert.ok(!site.gov.todos.some((t) => t.kind === 'superseded-still-linked' && t.itemId === 'faq.test-family'));
});

test('R3 衍生內容複審（reviewedAt ≥ 新版生效日）後回到白名單；新聞稿則永久加註且不作答案依據', () => {
  const site = govern('2026-10-01', (s) => {
    addItem(s, mk({ id: 'faq.test-fixed', basedOn: ['doc.mmr-recommendation'], publishedAt: '2024-06-01', reviewedAt: '2026-05-01' }));
    s.byId.get(NEWS_OLD).reviewedAt = '2026-05-01';
  });
  const f = site.byId.get('faq.test-fixed');
  assert.equal(f.gov.stale.length, 0); assert.equal(f.gov.basisRevisions[0].resolved, true); assert.equal(f.gov.whitelist.effective, true);
  assert.equal(f.gov.annotations.length, 0);
  const n = site.byId.get(NEWS_OLD);
  assert.equal(n.gov.stale.length, 0);
  assert.equal(n.gov.predatesBasis, true);
  assert.ok(n.gov.annotations.some((a) => a.kind === 'based-on-revised'), '新聞稿內文不改，加註保留');
  assert.ok(n.gov.whitelist.reasons.includes('predates-basis'));
  assert.ok(!site.gov.todos.some((t) => t.kind === 'based-on-revised' && t.itemId === NEWS_OLD));
});

// ── R4 反向稽核 ──
test('R4 反向稽核：麻疹主題內容出現「1981 年以後出生」即命中；新 FAQ 的否定句不命中', () => {
  const site = govern();
  const n = site.byId.get(NEWS_OLD);
  assert.ok(n.gov.reverseAuditHits.length >= 1);
  assert.equal(n.gov.reverseAuditHits[0].coveredBy, 'based-on-revised');
  const faq = site.byId.get('faq.measles-mmr-adult-who');
  assert.equal(faq.gov.reverseAuditHits.length, 0);
  assert.equal(site.byId.get(MMR_OLD).gov.reverseAuditHits.length, 0, '失效版不掃');
});

test('R4 反向稽核 scope：疾病不在 scope 不命中；在 scope 命中 → 待辦＋退出白名單；含 i18n', () => {
  const text = '建議 1981 年以後出生的成人接種。';
  const site = govern('2026-10-01', (s) => {
    addItem(s, mk({ id: 'faq.test-dengue-1981', diseases: ['disease.dengue'], answerMarkdown: text }));
    addItem(s, mk({ id: 'faq.test-measles-1981', diseases: ['disease.measles'], answerMarkdown: text }));
    addItem(s, mk({ id: 'faq.test-measles-i18n', diseases: ['disease.measles'], i18n: { en: { answerMarkdown: '日、韓為非流行區' } } }));
  });
  assert.equal(site.byId.get('faq.test-dengue-1981').gov.reverseAuditHits.length, 0);
  const hit = site.byId.get('faq.test-measles-1981');
  assert.equal(hit.gov.reverseAuditHits.length, 1);
  assert.ok(hit.gov.whitelist.reasons.includes('reverse-audit'));
  const t = site.gov.todos.find((x) => x.kind === 'reverse-audit' && x.itemId === hit.id);
  assert.ok(t); assert.equal(t.dueAt, '2025-04-23', '無 since 的規則以 scope 內現行文件生效日推估');
  assert.equal(site.byId.get('faq.test-measles-i18n').gov.reverseAuditHits.length, 1);
});

test('R4 內容宣告的 auditRules：無 scope 掃全站、自己的 family 不掃', () => {
  const site = govern('2026-10-01', (s) => {
    addItem(s, mk({ type: 'document', id: 'doc.test-rule.v1', family: 'doc.test-rule', version: 'v1', effectiveAt: '2026-05-01', publishedAt: '2026-05-01', reviewPeriodMonths: 12,
      machineReadableMarkdown: '# 規則來源\n\n示範：「白線斑蚊」一詞須改為學名寫法，此為示範文件內容，長度足夠通過機讀版檢查。', auditRules: [{ pattern: '白線斑蚊', message: '示範規則' }] }));
  });
  const dengue = site.byId.get('disease.dengue');
  assert.ok(dengue.gov.reverseAuditHits.some((h) => h.term === '白線斑蚊'));
  assert.equal(site.byId.get('doc.test-rule.v1').gov.reverseAuditHits.length, 0);
  const rule = site.gov.auditRules.find((r) => r.from === 'doc.test-rule.v1');
  assert.equal(rule.since, '2026-05-01');
});

// ── R5 翻譯 ──
test('R5 翻譯過期：languages[lang].sourceHash 不符 ⇒ stale＋待辦；reviewed 無 hash 視為最新；i18n.sourceHash 亦可', () => {
  const site = govern('2026-10-01', (s) => {
    const d = s.byId.get('disease.dengue');
    d.languages.en.sourceHash = 'deadbeef0000';
    d.languages.vi.sourceHash = d.sourceHash;
    const f = s.byId.get('faq.dengue-fever-when-to-see-doctor');
    f.i18n.en.sourceHash = 'cafe00000000';
  });
  const d = site.byId.get('disease.dengue');
  assert.equal(d.gov.translationStale.en, true);
  assert.equal(d.gov.translationStale.vi, false);
  assert.equal(d.gov.languageNotes.en.note, '中文已更新，譯文待複核');
  const t = site.gov.todos.find((x) => x.id === 'translation-stale:disease.dengue:en');
  assert.equal(t.dueAt, addDays(d.reviewedAt, 14)); assert.equal(t.lang, 'en');
  assert.equal(site.byId.get('faq.dengue-fever-when-to-see-doctor').gov.translationStale.en, true);
  const clean = govern();
  assert.equal(clean.byId.get('disease.dengue').gov.translationStale.en, false, 'reviewed 但沒有 sourceHash → 視為最新');
  assert.ok(!clean.gov.todos.some((x) => x.kind === 'translation-stale'));
});

test('R5 可渲染語言：一級內容 machine 不渲染；非一級 machine 可渲染；與 pages.langAvailable 一致', async () => {
  const site = govern();
  const d = site.byId.get('disease.dengue');
  for (const l of config.langs) assert.equal(d.gov.renderableLangs.includes(l.code), l.code === 'zh-TW' || d.languages?.[l.code]?.status === 'reviewed', l.code);
  const machineLang = Object.entries(d.languages).find(([, m]) => m.status === 'machine')?.[0];
  if (machineLang) assert.match(d.gov.languageNotes[machineLang].note, /一級內容/);
  assert.deepEqual(site.byId.get('faq.dengue-fever-when-to-see-doctor').gov.renderableLangs, config.langs.map((l) => l.code));
  let langAvailable;
  try { ({ langAvailable } = await import('../scripts/lib/pages.mjs')); } catch { return; } // 模板未就緒時略過一致性比對
  for (const item of site.all) for (const l of config.langs) {
    assert.equal(item.gov.renderableLangs.includes(l.code), langAvailable(site, item, l.code), `${item.id} ${l.code}`);
    assert.equal(langRenderable(site, item, l.code), langAvailable(site, item, l.code));
  }
});

// ── R6 資料集 ──
test('R6 資料集逾期：daily 超過 2 日 ⇒ datasetOverdue＋待辦＋KPI 下降', () => {
  const mutate = (s) => { const x = s.byId.get('dataset.dengue-daily'); x.updateFrequency = 'daily'; x.lastUpdated = '2026-09-30'; };
  const ok = govern('2026-10-01', mutate);
  assert.equal(ok.byId.get('dataset.dengue-daily').gov.datasetOverdue, false);
  const late = govern('2026-10-10', mutate);
  const ds = late.byId.get('dataset.dengue-daily');
  assert.equal(ds.gov.datasetOverdue, true); assert.equal(ds.gov.datasetLagDays, 10);
  const t = late.gov.todos.find((x) => x.kind === 'dataset-overdue' && x.itemId === ds.id);
  assert.equal(t.dueAt, '2026-10-02'); assert.equal(t.href, '/data/#dataset.dengue-daily');
  assert.ok(late.gov.kpiByKey['dataset-fresh'].current < 100);
});

test('R6 授權非標準 ⇒ license-missing 待辦＋KPI', () => {
  const site = govern('2026-10-01', (s) => { const ds = s.byId.get('dataset.dengue-daily'); ds.license = 'CC-BY-NC-4.0'; ds.licenseNote = '測試'; });
  const t = site.gov.todos.find((x) => x.kind === 'license-missing');
  assert.ok(t); assert.match(t.text, /CC-BY-NC-4\.0/);
  assert.ok(site.gov.kpiByKey['dataset-license'].current < 100);
});

// ── R7 暫停 ──
test('R7 AI 暫停旗標：ai-status.paused ⇒ site.gov.pausedAI', () => {
  assert.equal(govern().gov.pausedAI, false);
  const site = govern('2026-10-01', (s) => { s.governance.aiStatus = { ...s.governance.aiStatus, paused: true, reason: '測試' }; });
  assert.equal(site.gov.pausedAI, true); assert.equal(site.gov.aiStatus.reason, '測試'); assert.equal(site.gov.summary.pausedAI, true);
});

// ── 白名單型別政策 ──
test('白名單型別政策：allowedTypes／allowedTypesPro／sensitivity／未申請', () => {
  const site = govern('2026-10-01', (s) => {
    addItem(s, mk({ id: 'faq.test-internal', sensitivity: 'internal' }));
    addItem(s, mk({ id: 'faq.test-pro-sens', sensitivity: 'professional' }));
    addItem(s, mk({ type: 'document', id: 'doc.test-prodoc.v1', family: 'doc.test-prodoc', version: '1', effectiveAt: '2026-01-01', reviewPeriodMonths: 12, sensitivity: 'professional', audience: ['professional'] }));
    addItem(s, mk({ id: 'faq.test-noreq', aiWhitelist: undefined }));
    addItem(s, mk({ id: 'faq.test-draft', status: 'draft' }));
  });
  const banner = site.byId.get('banner.2026-flu-vaccine');
  assert.ok(banner.gov.whitelist.reasons.includes('type-not-allowed'));
  assert.ok(site.byId.get('faq.test-internal').gov.whitelist.reasons.includes('sensitivity'));
  assert.ok(site.byId.get('faq.test-pro-sens').gov.whitelist.reasons.includes('sensitivity'));
  const pd = site.byId.get('doc.test-prodoc.v1');
  assert.equal(pd.gov.whitelist.effective, true); assert.equal(pd.gov.whitelist.tier, 'pro'); assert.equal(pd.gov.whitelist.public, false);
  assert.equal(site.byId.get(MMR_NEW).gov.whitelist.tier, 'pro', '文件只進專業版');
  assert.equal(site.byId.get('faq.measles-mmr-adult-who').gov.whitelist.public, true);
  assert.ok(site.byId.get('faq.test-noreq').gov.whitelist.reasons.includes('not-requested'));
  const dr = site.byId.get('faq.test-draft');
  assert.ok(dr.gov.whitelist.reasons.includes('not-published')); assert.equal(dr.gov.lifecycleLabel, '草稿'); assert.equal(dr.gov.noindex, true);
});

test('每個白名單原因、生命週期、待辦種類都有中文對照', () => {
  const site = govern('2027-08-01', (s) => {
    addItem(s, mk({ id: 'faq.test-arch', status: 'archived' }));
    const ds = s.byId.get('dataset.dengue-daily'); ds.license = 'X'; ds.licenseNote = 'x';
    s.byId.get('disease.dengue').languages.en.sourceHash = 'zzz';
  });
  for (const i of site.all) {
    for (const r of i.gov.whitelist.reasons) assert.ok(WHITELIST_REASON_LABELS[r], r);
    assert.equal(i.gov.whitelist.reasonLabels.length, i.gov.whitelist.reasons.length);
    assert.ok(LIFECYCLE_LABELS[i.gov.lifecycle]);
  }
  assert.equal(site.byId.get('faq.test-arch').gov.lifecycleLabel, '封存');
  for (const t of site.gov.todos) assert.ok(TODO_KIND_LABELS[t.kind], t.kind);
  for (const v of ['現行版', '已失效', '逾期待審', '依據已修訂', '草稿', '封存']) assert.ok(Object.values(LIFECYCLE_LABELS).includes(v));
});

// ── 待辦形狀 ──
test('待辦：id 穩定唯一、欄位齊全、href 依型別', () => {
  const a = govern('2027-08-01'), b = govern('2027-08-01');
  assert.deepEqual(a.gov.todos.map((t) => t.id), b.gov.todos.map((t) => t.id), '同輸入同 id');
  const ids = a.gov.todos.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const t of a.gov.todos) {
    for (const k of ['id', 'kind', 'itemId', 'itemTitle', 'owner', 'ownerName', 'dueAt', 'overdue', 'text', 'href', 'severity']) assert.ok(t[k] !== undefined, `${t.id} 缺 ${k}`);
    assert.equal(t.overdue, t.dueAt < a.today);
    assert.ok(['high', 'medium', 'low'].includes(t.severity));
  }
  assert.equal(pathOf({ type: 'faq', id: 'faq.abc' }), '/faq/abc/');
  assert.equal(pathOf({ type: 'news', id: 'news.2026-x' }), '/news/2026-x/');
  assert.equal(pathOf({ type: 'document', id: 'doc.a.2025-01-01' }), '/documents/a.2025-01-01/');
  assert.equal(pathOf({ type: 'disease', id: 'disease.dengue', slug: 'dengue' }), '/diseases/dengue/');
  assert.equal(pathOf({ type: 'clarification', id: 'clar.x' }), '/factcheck/#clar.x');
});

test('態勢層逾期 ⇒ 待辦；資料延遲 KPI', () => {
  const mutate = (s) => { s.situation.dataDate = '2026-09-21'; s.situation.publishedAt = '2026-09-21'; s.situation.nextReviewAt = '2026-09-28'; };
  const site = govern('2026-10-01', mutate);
  assert.equal(site.gov.situation.lagDays, 10);
  assert.ok(site.gov.todos.some((t) => t.kind === 'situation-overdue' && t.href === '/situation/'));
  assert.equal(site.gov.kpiByKey['situation-latency'].current, 10);
  const fresh = govern('2026-09-22', mutate);
  assert.ok(!fresh.gov.todos.some((t) => t.kind === 'situation-overdue'));
  assert.equal(fresh.gov.kpiByKey['situation-latency'].status, 'ok');
});

// ── KPI／byOwner／summary ──
test('KPI 涵蓋 7.5 全部 13 列；版本題正確率由 evalReport 延後計算', () => {
  const site = govern();
  const keys = site.gov.kpi.map((k) => k.key);
  for (const k of ['provenance', 'dataset-license', 'dataset-fresh', 'doc-machine-readable', 'en-sync', 'seven-lang', 'openapi', 'situation-latency', 'publish-lead-time', 'revision-to-annotation', 'stale-derived', 'superseded-indexed', 'eval-version-accuracy']) assert.ok(keys.includes(k), k);
  for (const k of site.gov.kpi) for (const f of ['label', 'unit', 'status']) assert.ok(k[f] !== undefined, `${k.key}.${f}`);
  assert.equal(site.gov.kpiByKey['publish-lead-time'].current, null);
  assert.match(site.gov.kpiByKey['publish-lead-time'].note, /待量測/);
  assert.equal(site.gov.kpiByKey['eval-version-accuracy'].current, null);
  site.evalReport = { byCategory: { version: { total: 4, passed: 4 } } };
  assert.equal(site.gov.kpiByKey['eval-version-accuracy'].current, 100);
  assert.ok(site.gov.kpiByKey['stale-derived'].current >= 1);
  assert.equal(site.gov.kpiByKey['stale-derived'].current, site.all.filter((i) => i.status === 'published' && i.gov.stale.length).length);
  assert.ok(site.gov.kpiByKey['revision-to-annotation'].current > 7);
  assert.equal(site.gov.kpiByKey['superseded-indexed'].current, 0);
  site.searchIndex = { public: [{ contentId: MMR_OLD }], pro: [] };
  assert.equal(site.gov.kpiByKey['superseded-indexed'].current, 1, '有索引時以實際索引檢查');
});

test('byOwner 與 summary：每單位待辦／逾期／白名單／內容數，加總一致', () => {
  const site = govern('2027-08-01');
  const rows = site.gov.byOwner;
  assert.ok(rows.length >= site.master.units.length);
  assert.equal(rows.reduce((n, r) => n + r.content, 0), site.all.length);
  assert.equal(rows.reduce((n, r) => n + r.todos, 0), site.gov.todos.filter((t) => t.owner).length);
  assert.equal(rows.reduce((n, r) => n + r.whitelist, 0), site.gov.whitelistCount);
  const acute = rows.find((r) => r.unit === 'unit.acute-infectious');
  assert.equal(acute.name, '急性傳染病組'); assert.ok(acute.todosOverdue >= 1);
  const s = site.gov.summary;
  assert.equal(s.todos, site.gov.todos.length); assert.equal(s.whitelist, site.gov.whitelistCount); assert.equal(s.contentTotal, site.all.length);
  assert.ok(s.overdueContent >= 1);
});

test('效能：600 筆內容 + 99 主檔，在 1.5 秒內完成', () => {
  const t0 = Date.now();
  govern('2026-10-01', (s) => {
    for (let i = 0; i < 600; i++) addItem(s, mk({ id: `faq.perf-${i}`, diseases: [i % 2 ? 'disease.measles' : 'disease.dengue'], basedOn: i % 5 ? [] : ['doc.mmr-recommendation'], answerMarkdown: `第 ${i} 題的答案文字，說明接種與就醫時機。`.repeat(5) }));
    while (s.master.diseases.length < 99) s.master.diseases.push({ ...s.master.diseases[0], id: `disease.perf-${s.master.diseases.length}`, auditRules: [{ scope: [`disease.perf-${s.master.diseases.length}`], pattern: 'x{3}', message: 'perf' }] });
  });
  assert.ok(Date.now() - t0 < 1500, `${Date.now() - t0} ms`);
});
