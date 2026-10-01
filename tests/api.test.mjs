// API 輸出測試：記憶體 write 收集 v1/*.json 與 openapi.json，檢查外殼、etag、必要檔案、redirects。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emitApi, etagOf } from '../scripts/lib/emit-api.mjs';
import { ENDPOINTS } from '../scripts/lib/openapi.mjs';
import { govern, memWriter, config } from './helpers.mjs';

async function emitted(today = '2026-10-01') {
  const site = govern(today);
  try { const { buildSearchIndex } = await import('../scripts/lib/index-builder.mjs'); site.searchIndex = buildSearchIndex(site); } catch { site.searchIndex = { public: [], pro: [] }; }
  site.evalReport = { total: 1, passed: 1, byCategory: { version: { total: 1, passed: 1 } } };
  const { files, write } = memWriter();
  emitApi(site, write);
  const json = (p) => JSON.parse(files.get(p));
  return { site, files, json };
}

test('必要檔案都輸出（4.2 表＋search、tasks、governance、openapi）', async () => {
  const { files, site } = await emitted();
  const required = ['v1/index.json', 'v1/diseases.json', 'v1/vaccines.json', 'v1/faq.json', 'v1/news.json', 'v1/documents.json', 'v1/clarifications.json', 'v1/situation.json', 'v1/travel-alerts.json', 'v1/country-levels.json', 'v1/datasets.json', 'v1/catalog.json', 'v1/glossary.json', 'v1/units.json', 'v1/countries.json', 'v1/banners.json', 'v1/search-index.json', 'v1/search-index-pro.json', 'v1/search.json', 'v1/redirects.json',
    'v1/governance/kpi.json', 'v1/governance/todos.json', 'v1/governance/summary.json', 'v1/governance/by-owner.json', 'v1/governance/ai-status.json', 'v1/governance/whitelist.json', 'v1/governance/eval-set.json', 'v1/governance/eval-report.json', 'openapi.json'];
  for (const f of required) assert.ok(files.has(f), f);
  for (const d of site.collections.diseases) assert.ok(files.has(`v1/diseases/${d.slug}.json`));
  for (const t of config.tasks) assert.ok(files.has(`v1/tasks/${t.key}.json`), t.key);
});

test('外殼 meta：etag＝data 內容雜湊 12 碼、lastModified＝集合最大 reviewedAt；不含 __file', async () => {
  const { files, json } = await emitted();
  for (const [p, body] of files) {
    if (!p.startsWith('v1/')) continue;
    const j = JSON.parse(body);
    assert.equal(j.meta.api, 'v1', p);
    assert.match(j.meta.etag, /^[0-9a-f]{12}$/, p);
    assert.equal(j.meta.etag, etagOf(j.data), p);
    assert.ok(j.meta.lastModified, `${p} lastModified`);
    assert.ok(!body.includes('"__file"'), `${p} 含 __file`);
  }
  const faq = json('v1/faq.json');
  assert.equal(faq.meta.lastModified, faq.data.map((x) => x.reviewedAt).sort().at(-1));
  assert.equal(faq.meta.count, faq.data.length);
});

test('每筆內容：governance 摘要、i18n 原文保留、url', async () => {
  const { json } = await emitted();
  const d = json('v1/diseases/dengue.json').data;
  assert.equal(d.governance.owner, 'unit.acute-infectious');
  assert.ok(d.governance.nextReviewAt); assert.equal(typeof d.governance.whitelist, 'boolean');
  assert.equal(d.url, `${config.siteUrl}${config.basePath}/diseases/dengue/`);
  assert.ok(!('gov' in d));
  const faq = json('v1/faq.json').data.find((x) => x.id === 'faq.measles-mmr-adult-who');
  assert.ok(faq.i18n?.en?.answerMarkdown, 'i18n 保留');
  const news = json('v1/news.json').data;
  assert.deepEqual(news.map((n) => n.publishedAt), [...news.map((n) => n.publishedAt)].sort().reverse(), '近者在前');
  assert.ok(news.find((n) => n.id === 'news.2025-01-09-mmr-adults-measles').governance.annotations.some((a) => a.kind === 'based-on-revised'));
});

test('documents.json：全部版本＋families 版本鏈與現行版', async () => {
  const { json } = await emitted();
  const docs = json('v1/documents.json');
  const old = docs.data.find((d) => d.id === 'doc.mmr-recommendation.2019-05-14');
  assert.equal(old.isCurrent, false); assert.equal(old.supersededBy, 'doc.mmr-recommendation.2025-04-16');
  const fam = docs.families.find((f) => f.family === 'doc.mmr-recommendation');
  assert.equal(fam.current, 'doc.mmr-recommendation.2025-04-16');
  assert.equal(fam.versions.filter((v) => v.isCurrent).length, 1);
  assert.ok(fam.versions.find((v) => v.id === 'doc.mmr-recommendation.2019-05-14').superseded);
});

test('redirects.json 含 MMR 舊版 → 現行版（301）與 legacyUrls 對照', async () => {
  const { json } = await emitted();
  const r = json('v1/redirects.json').data;
  const old = r.find((x) => x.kind === 'superseded' && x.itemId === 'doc.mmr-recommendation.2019-05-14');
  assert.equal(old.status, 301); assert.equal(old.from, '/documents/mmr-recommendation.2019-05-14/'); assert.equal(old.to, '/documents/mmr-recommendation.2025-04-16/');
  const legacyOld = r.find((x) => x.kind === 'legacy' && x.itemId === 'doc.mmr-recommendation.2019-05-14');
  assert.equal(legacyOld.to, '/documents/mmr-recommendation.2025-04-16/', '舊 PDF 網址導向現行版');
  assert.ok(r.some((x) => x.kind === 'legacy' && x.itemId === 'disease.dengue' && x.to === '/diseases/dengue/'));
  assert.ok(r.some((x) => x.kind === 'family-latest' && x.from === '/documents/mmr-recommendation/'));
});

test('tasks／search／governance 端點形狀', async () => {
  const { json, site } = await emitted();
  const vac = json('v1/tasks/vaccines.json').data;
  assert.equal(vac.key, 'vaccines'); assert.ok(vac.items.length > 0);
  assert.ok(!vac.items.some((i) => i.id === 'doc.mmr-recommendation.2019-05-14'), '失效版不進任務入口');
  assert.ok(vac.items.every((i) => site.byId.get(i.id).tasks.includes('vaccines')));
  assert.equal(json('v1/search.json').meta.aliasOf, '/v1/search-index.json');
  const kpi = json('v1/governance/kpi.json').data;
  assert.ok(kpi.length >= 13);
  assert.equal(kpi.find((k) => k.key === 'eval-version-accuracy').current, 100);
  const todos = json('v1/governance/todos.json');
  assert.equal(todos.meta.overdue, todos.data.filter((t) => t.overdue).length);
  const wl = json('v1/governance/whitelist.json').data;
  assert.ok(wl.reasonLabels.superseded);
  assert.ok(json('v1/governance/by-owner.json').data.some((r) => r.unit === 'unit.vaccine'));
  const idx = json('v1/index.json').data;
  assert.ok(idx.some((e) => e.path === '/v1/catalog.json'));
});

test('openapi.json：3.1、servers＝siteOrigin、$ref 全部可解析、涵蓋全部 v1 端點', async () => {
  const { files } = await emitted();
  const o = JSON.parse(files.get('openapi.json'));
  assert.equal(o.openapi, '3.1.0');
  assert.equal(o.servers[0].url, `${config.siteUrl}${config.basePath}`);
  const refs = [];
  (function walk(n) { if (Array.isArray(n)) n.forEach(walk); else if (n && typeof n === 'object') for (const [k, v] of Object.entries(n)) (k === '$ref' ? refs.push(v) : walk(v)); })(o);
  assert.ok(refs.length > 20);
  for (const r of refs) {
    let node = o;
    for (const part of r.replace(/^#\//, '').split('/')) node = node?.[part];
    assert.ok(node !== undefined, `無法解析 ${r}`);
  }
  for (const s of ['Disease', 'Faq', 'News', 'Document', 'Dataset', 'Situation', 'Unit', 'DiseaseMaster', 'Meta', 'Governance', 'Todo', 'Kpi']) assert.ok(o.components.schemas[s], s);
  const templated = ENDPOINTS.map(([p]) => new RegExp(`^${p.replace(/\{[^}]+\}/g, '[^/]+').replace(/\./g, '\\.')}$`));
  for (const f of files.keys()) if (f.startsWith('v1/')) assert.ok(templated.some((re) => re.test(`/${f}`)), `openapi 未描述 /${f}`);
});
