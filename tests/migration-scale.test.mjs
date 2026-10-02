// 第六輪（ARCHITECTURE 14.1）：移轉清單規模化——模板推導（主檔每種疾病一份）、人工清單覆蓋同 key、模板補齊、
// no-page 清單、每份清單聚合一則待辦（優先度依法定類別）、site.migration.stats／byDisease、v1/migration 輸出、推導項不進伺服器檔。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { govern, memWriter, config } from './helpers.mjs';
import { loadSite } from '../scripts/lib/load.mjs';
import { validateSite } from '../scripts/lib/validate.mjs';
import { emitApi, serverRedirects, legacyKey } from '../scripts/lib/emit-api.mjs';
import { MIGRATION_SEVERITY_BY_CATEGORY } from '../scripts/lib/governance.mjs';

const TEMPLATE_ID = 'migration-template.disease';
const site0 = govern('2026-10-01');
const template = site0.migrationTemplates.find((t) => t.id === TEMPLATE_ID);
const tplKeys = template.items.map((t) => t.key);
const pagesPublished = site0.collections.diseases.filter((d) => d.status === 'published').map((d) => d.id);

function emitted(today = '2026-10-01', mutate) {
  const site = govern(today, mutate);
  site.searchIndex = { public: [], pro: [] };
  site.evalReport = { total: 1, passed: 1, byCategory: { version: { total: 1, passed: 1 } } };
  const { files, write } = memWriter();
  emitApi(site, write);
  return { site, files, json: (p) => JSON.parse(files.get(p)) };
}

test('模板：content/migration/_disease-template.json 讀成 site.migrationTemplates（不是清單），schema 通過、涵蓋舊站疾病頁標準子頁', () => {
  assert.ok(template, '模板存在');
  assert.equal(template.type, 'migration-template');
  assert.ok(!site0.migrationLists.some((l) => l.id === TEMPLATE_ID || String(l.__file).includes('_disease-template')), '模板不混進人工清單');
  assert.deepEqual(validateSite(loadSite(config)).filter((e) => e.includes('migration')), []);
  for (const k of ['intro', 'intro-pathogen', 'intro-epidemiology', 'intro-transmission', 'intro-incubation', 'intro-symptoms', 'intro-prevention', 'intro-treatment',
    'vaccine', 'qa-list', 'materials-poster', 'materials-video', 'manual', 'case-definition', 'guideline', 'stats', 'lab', 'notify', 'news-list', 'links']) assert.ok(tplKeys.includes(k), `模板有 ${k}`);
  for (const t of template.items) assert.match(t.oldUrlPattern, /\{id\}/, `${t.key} 舊網址模式含 {id}`);
  const kinds = new Set(template.items.map((t) => t.mapTo.kind));
  for (const k of ['disease-block', 'related', 'master-field', 'page']) assert.ok(kinds.has(k), `mapTo kind ${k}`);
});

test('模板驗證：缺 {id}、mapTo 未知 kind、重複 key 都擋下；同一疾病兩份人工清單、omit 不在模板內也擋下', () => {
  const site = loadSite(config);
  site.today = '2026-10-01';
  const bad = structuredClone(site.migrationTemplates.find((t) => t.id === TEMPLATE_ID));
  bad.__file = 'test/_bad-template.json'; bad.id = 'migration-template.bad';
  bad.items[0].oldUrlPattern = 'https://www.cdc.gov.tw/Disease/SubIndex/AbC';
  bad.items[1].mapTo = { kind: 'magic' };
  bad.items[2].key = bad.items[3].key;
  site.migrationTemplates.push(bad);
  const tb = site.migrationLists.find((l) => l.id === 'migration.tuberculosis');
  site.migrationLists.push({ ...structuredClone(tb), id: 'migration.tb-dup', __file: 'test/tb-dup.json', omit: ['no-such-key'] });
  const errs = validateSite(site);
  const tplErrs = errs.filter((e) => e.startsWith('test/_bad-template.json'));
  assert.ok(tplErrs.some((e) => e.includes('/items/0/oldUrlPattern')), tplErrs.join('\n'));
  assert.ok(tplErrs.some((e) => e.includes('/items/1/mapTo')), tplErrs.join('\n'));
  assert.ok(tplErrs.some((e) => e.includes('key 重複')), tplErrs.join('\n'));
  const dupErrs = errs.filter((e) => e.startsWith('test/tb-dup.json'));
  assert.ok(dupErrs.some((e) => e.includes('已有人工清單 migration.tuberculosis')), dupErrs.join('\n'));
  assert.ok(dupErrs.some((e) => e.includes('omit no-such-key 不在模板')), dupErrs.join('\n'));
});

test('72 種疾病都有清單：主檔每一種一份（byDisease），另有欄目清單；stats.lists／derived／curated／noPage／hasPage 一致', () => {
  const m = site0.migration;
  const diseases = site0.master.diseases;
  assert.equal(diseases.length, 72);
  assert.ok(m.byDisease instanceof Map);
  assert.equal(m.byDisease.size, 72, '每種疾病一份');
  for (const d of diseases) {
    const l = m.byDisease.get(d.id);
    assert.ok(l, d.id);
    assert.equal(l.disease, d.id); assert.equal(l.legalCategory, d.legalCategory); assert.equal(l.diseaseName, d.name);
    assert.equal(l.hasPage, pagesPublished.includes(d.id), `${d.id} hasPage`);
    assert.equal(typeof l.derived, 'boolean'); assert.equal(l.curated, !l.derived);
    assert.equal(l.slug, l.curated ? l.id.replace(/^migration\./, '') : d.slug);
    for (const k of tplKeys) assert.ok(l.items.some((i) => i.key === k) || (l.curated && site0.migrationLists.find((x) => x.id === l.id)?.omit?.includes(k)), `${d.slug} 有模板項 ${k}`);
  }
  assert.ok(m.lists.length >= 73, '72 份疾病清單＋欄目清單');
  assert.equal(m.stats.lists, m.lists.length);
  assert.equal(m.stats.derived + m.stats.curated, m.stats.lists);
  assert.equal(m.stats.derived, m.lists.filter((l) => l.derived).length);
  assert.equal(m.stats.curated, site0.migrationLists.length, '每份人工清單一份');
  assert.equal(m.stats.hasPage, pagesPublished.length);
  assert.equal(m.stats.hasPage, 16);
  assert.equal(m.stats.noPage, 72 - 16);
  assert.equal(m.stats.noPage, m.lists.filter((l) => l.status === 'no-page').length);
  assert.equal(m.stats.derivedItems + m.stats.curatedItems, m.stats.total);
  // 既有欄位相容（只加不減）
  for (const l of m.lists) for (const k of ['id', 'title', 'scope', 'owner', 'ownerName', 'status', 'reviewedAt', 'legacyRoot', 'showLegacyUntil', 'show', 'stats', 'items', 'derived', 'hasPage', 'disease', 'legalCategory', 'slug']) assert.ok(k in l, `${l.id} 缺 ${k}`);
  // 欄目清單（英文站國際合作）
  const intl = m.lists.find((l) => l.id === 'migration.international-cooperation');
  assert.ok(intl); assert.equal(intl.derived, false); assert.equal(intl.disease, null); assert.equal(intl.site, 'en'); assert.equal(intl.scope.kind, 'category');
  assert.ok(intl.items.length >= 10 && intl.items.length <= 12); assert.ok(intl.items.every((i) => i.verified === false));
});

test('有疾病頁的 16 份清單：推導項依 mapTo 判定 merged／migrated／pending，數字合理', () => {
  const m = site0.migration;
  const withPage = m.lists.filter((l) => l.hasPage);
  assert.equal(withPage.length, 16);
  for (const l of withPage) {
    const st = l.stats;
    assert.equal(st.migrated + st.merged + st.archived + st.pending + st.dropped, st.total, l.slug);
    assert.ok(st.total >= tplKeys.length, `${l.slug} 至少模板筆數`);
    assert.ok(st.migrated + st.merged >= st.total / 2, `${l.slug} 多數已對應（${JSON.stringify(st)}）`);
    assert.notEqual(l.status, 'no-page');
    const d = l.items.filter((i) => i.derived);
    assert.ok(d.every((i) => i.verified === false && i.pattern === true), '推導項 verified:false、pattern:true');
    const intro = l.items.find((i) => i.key === 'intro');
    if (intro.derived) { assert.equal(intro.status, 'migrated'); assert.equal(intro.target, l.disease); }
    const sym = l.items.find((i) => i.key === 'intro-symptoms');
    if (sym.derived) { assert.equal(sym.status, 'merged'); assert.equal(sym.anchor, 'symptoms'); assert.equal(sym.to, `${l.pagePath}#symptoms`); }
    const notify = l.items.find((i) => i.key === 'notify');
    if (notify.derived) { assert.equal(notify.status, 'merged'); assert.equal(notify.to, `/report/#n-${site0.diseaseMasterById.get(l.disease).slug}`); }
    for (const i of d) {
      if (i.status === 'migrated' || i.status === 'merged') assert.ok(i.to, `${l.slug}/${i.key} 有轉址目的地`);
      if (i.status === 'pending') assert.match(i.note, /模板推導/);
      if (i.mapTo.kind === 'related' && i.status === 'migrated') { assert.ok(i.relatedIds.includes(i.target)); assert.ok(site0.byId.get(i.target)?.status === 'published'); }
    }
  }
  // 登革熱：病例定義、檢驗、統計由關聯內容命中
  const dg = m.byDisease.get('disease.dengue');
  const byKey = (k) => dg.items.find((i) => i.key === k);
  assert.equal(byKey('lab').target, 'labtest.dengue');
  assert.match(byKey('case-definition').target, /^doc\.case-definition-dengue/);
  assert.equal(byKey('qa-list').status, 'merged'); assert.equal(byKey('qa-list').anchor, 'faq'); assert.ok(byKey('qa-list').relatedIds.length >= 1);
  // 推導項掛回疾病頁 gov.legacy
  assert.ok(site0.byId.get('disease.rabies').gov.legacy.items.some((i) => i.derived && i.listId === 'migration.rabies'));
});

test('無疾病頁 ⇒ 清單 status:no-page、全部 pending，只開一則待辦「疾病頁尚未建立」，優先度依法定類別', () => {
  const m = site0.migration;
  const noPage = m.lists.filter((l) => l.status === 'no-page');
  assert.equal(noPage.length, 56);
  const todos = site0.gov.todos.filter((t) => t.kind === 'migration-pending');
  for (const l of noPage) {
    assert.equal(l.hasPage, false);
    assert.ok(l.items.every((i) => i.status === 'pending' && !i.target && !i.to), `${l.slug} 全部 pending`);
    assert.equal(l.stats.pending, l.items.length);
    const mine = todos.filter((t) => t.listId === l.id);
    assert.equal(mine.length, 1, `${l.slug} 一則待辦`);
    assert.equal(mine[0].text, `${l.diseaseName}：疾病頁尚未建立，${l.items.length} 個舊頁待移轉`);
    assert.equal(mine[0].noPage, true); assert.equal(mine[0].count, l.items.length);
    assert.equal(mine[0].severity, MIGRATION_SEVERITY_BY_CATEGORY[l.legalCategory]);
  }
  const sev = (slug) => todos.find((t) => t.listId === `migration.${slug}`).severity;
  assert.equal(sev('smallpox'), 'high', '第一類 high');
  assert.equal(sev('cholera'), 'high', '第二類 high');
  assert.equal(sev('mumps'), 'medium', '第三類 medium');
  assert.equal(sev('botulism'), 'low', '第四類 low');
  assert.equal(sev('ebola'), 'low', '第五類 low');
  // 待辦總數＝有 pending 的清單數（不再逐筆開）
  assert.equal(todos.length, m.lists.filter((l) => l.stats.pending > 0 && l.status !== 'archived').length);
  assert.ok(todos.length < m.stats.pending / 5, `聚合後待辦 ${todos.length} 則 ≪ 待移轉 ${m.stats.pending} 筆`);
});

test('結核病人工清單覆蓋推導：同 key 以人工為準、人工沒寫的 key 由模板補；omit 排除、extends:none 不補', () => {
  const m = site0.migration;
  const raw = site0.migrationLists.find((l) => l.id === 'migration.tuberculosis');
  const tb = m.byDisease.get('disease.tuberculosis');
  assert.equal(tb.id, 'migration.tuberculosis'); assert.equal(tb.curated, true); assert.equal(tb.derived, false); assert.equal(tb.hasPage, true);
  assert.equal(tb.extends, TEMPLATE_ID);
  // 同 key：人工為準（notify 人工對到通報服務；模板會對到 /report/）
  const notify = tb.items.find((i) => i.key === 'notify');
  assert.equal(notify.derived, false); assert.equal(notify.target, 'service.notifiable-disease-report');
  assert.equal(tb.items.filter((i) => i.key === 'notify').length, 1, '不重複');
  // 模板補齊：人工沒有的 key
  const added = tplKeys.filter((k) => !raw.items.some((i) => i.key === k));
  assert.ok(added.length > 0);
  for (const k of added) { const it = tb.items.find((i) => i.key === k); assert.ok(it?.derived, `模板補 ${k}`); assert.equal(it.listId, tb.id); }
  assert.ok(added.includes('intro-incubation') && tb.items.find((i) => i.key === 'intro-incubation').status === 'merged');
  assert.equal(tb.items.length, raw.items.length + added.length);
  assert.equal(tb.derivedItems, added.length); assert.equal(tb.curatedItems, raw.items.length);
  // omit：不補指定 key
  const s2 = govern('2026-10-01', (s) => { s.migrationLists.find((l) => l.id === 'migration.tuberculosis').omit = ['vaccine', 'intro-pathogen']; });
  const tb2 = s2.migration.byDisease.get('disease.tuberculosis');
  assert.ok(!tb2.items.some((i) => i.key === 'vaccine' || i.key === 'intro-pathogen'));
  assert.equal(tb2.items.length, tb.items.length - 2);
  // extends:none：只用人工清單
  const s3 = govern('2026-10-01', (s) => { s.migrationLists.find((l) => l.id === 'migration.tuberculosis').extends = 'none'; });
  const tb3 = s3.migration.byDisease.get('disease.tuberculosis');
  assert.equal(tb3.items.length, raw.items.length); assert.ok(tb3.items.every((i) => !i.derived)); assert.equal(tb3.extends, 'none');
});

test('合併規則：無頁疾病的人工清單 ⇒ 人工項照寫、模板項全 pending；改 status 立即反映在聚合待辦', () => {
  const site = govern('2026-10-01', (s) => {
    s.migrationLists.push({
      id: 'migration.smallpox', type: 'migration', title: '天花（舊站）→ 新站', owner: 'unit.preparedness', publishedAt: '2026-10-01', reviewedAt: '2026-10-01', reviewPeriodMonths: 3,
      status: 'published', audience: ['professional'], sensitivity: 'public', license: 'OGDL-1.0', languages: { 'zh-TW': { status: 'source' } }, summary: '測試', __file: 'test/smallpox.json',
      scope: { kind: 'disease', disease: 'disease.smallpox' }, extends: TEMPLATE_ID, legacyRoot: 'https://www.cdc.gov.tw/Disease/SubIndex/{id}', showLegacyUntil: '2027-12-31',
      items: [
        { key: 'intro', oldTitle: '疾病介紹', oldUrl: 'https://www.cdc.gov.tw/Disease/SubIndex/{id}', oldType: 'page', verified: true, status: 'dropped', note: '已根除，舊頁不移轉' },
        { key: 'smallpox-vaccine-stock', oldTitle: '天花疫苗儲備', oldUrl: 'https://www.cdc.gov.tw/Category/MPage/{id}#stock', oldType: 'page', verified: false, status: 'merged', target: 'topic.amr-one-health' },
      ],
    });
  });
  const l = site.migration.byDisease.get('disease.smallpox');
  assert.equal(l.curated, true); assert.equal(l.hasPage, false); assert.equal(l.status, 'no-page');
  assert.equal(l.items.length, tplKeys.length + 1, '模板項＋人工額外一筆');
  assert.equal(l.items[0].key, 'intro'); assert.equal(l.items[0].status, 'dropped'); assert.equal(l.items[0].derived, false);
  assert.equal(l.items.at(-1).key, 'smallpox-vaccine-stock');
  assert.equal(l.stats.pending, tplKeys.length - 1);
  const todo = site.gov.todos.find((t) => t.listId === 'migration.smallpox');
  assert.equal(todo.count, tplKeys.length - 1); assert.equal(todo.owner, 'unit.preparedness'); assert.equal(todo.severity, 'high');
  assert.equal(site.migration.stats.curated, site0.migration.stats.curated + 1);
  assert.equal(site.migration.stats.derived, site0.migration.stats.derived - 1);
});

test('v1/migration：index.json 各清單摘要＋每份 {slug}.json 完整清單（derived 標記）；openapi 有描述', () => {
  const { files, json, site } = emitted();
  const idx = json('v1/migration/index.json');
  assert.equal(idx.meta.api, 'v1');
  assert.equal(idx.data.length, site.migration.lists.length);
  assert.equal(idx.meta.stats.lists, site.migration.lists.length);
  assert.equal(idx.meta.stats.noPage, 56);
  for (const s of idx.data) {
    assert.ok(files.has(`v1/migration/${s.slug}.json`), s.slug);
    assert.equal(s.path, `/v1/migration/${s.slug}.json`);
    for (const k of ['id', 'title', 'derived', 'curated', 'hasPage', 'status', 'stats', 'legalCategory', 'disease']) assert.ok(k in s, `${s.slug} 缺 ${k}`);
  }
  const dg = json('v1/migration/rabies.json');
  assert.equal(dg.data.derived, true); assert.equal(dg.data.items.length, tplKeys.length);
  assert.ok(dg.data.items.every((i) => i.derived === true && i.mapTo && i.verified === false));
  assert.ok(!('listId' in dg.data.items[0]), '建置期欄位不輸出');
  const tb = json('v1/migration/tuberculosis.json');
  assert.equal(tb.data.curated, true);
  assert.ok(tb.data.items.some((i) => i.derived) && tb.data.items.some((i) => !i.derived));
  assert.equal(tb.meta.count, tb.data.items.length);
  const sp = json('v1/migration/smallpox.json');
  assert.equal(sp.data.status, 'no-page'); assert.equal(sp.data.hasPage, false);
  // 端點清單與 OpenAPI
  const ep = json('v1/index.json').data;
  assert.ok(ep.some((e) => e.path === '/v1/migration/index.json'));
  assert.ok(ep.some((e) => e.path === '/v1/migration/{slug}.json'));
  assert.ok(!ep.some((e) => e.path === '/v1/migration/rabies.json'), '逐份清單不灌進端點清單');
  const o = JSON.parse(files.get('openapi.json'));
  assert.ok(o.paths['/v1/migration/index.json'] && o.paths['/v1/migration/{slug}.json']);
  const slugParam = o.paths['/v1/migration/{slug}.json'].get.parameters[0];
  assert.ok(slugParam.schema.enum.includes('rabies') && slugParam.schema.enum.includes('international-cooperation'));
  assert.ok(o.components.schemas.MigrationListSummary && o.components.schemas.MigrationListDetail && o.components.schemas.MapTo);
});

test('推導項全部 pattern:true：進 redirects.json 與 legacy-map patterns，不進伺服器對照檔與 legacy-map 精確對照', () => {
  const { files, json, site } = emitted();
  const redirects = json('v1/redirects.json').data;
  const derivedLists = new Set(site.migration.lists.filter((l) => l.derived).map((l) => l.id));
  const derivedR = redirects.filter((r) => r.kind === 'migration' && derivedLists.has(r.listId));
  assert.ok(derivedR.length > 100, `推導轉址 ${derivedR.length} 筆`);
  assert.ok(derivedR.every((r) => r.pattern === true && r.verified === false));
  // 人工清單中由模板補的項也是 pattern
  const tbDerivedKeys = new Set(site.migration.byDisease.get('disease.tuberculosis').items.filter((i) => i.derived).map((i) => i.key));
  assert.ok(redirects.filter((r) => r.listId === 'migration.tuberculosis' && tbDerivedKeys.has(r.key)).every((r) => r.pattern));
  // 伺服器檔：不含推導清單
  const { entries } = serverRedirects(redirects);
  assert.ok(!entries.some((e) => derivedLists.has(e.listId)));
  for (const f of ['redirects/nginx.map', 'redirects/_redirects', 'redirects/web.config.rewritemap.xml']) {
    const body = files.get(f).replace(/^#.*$/gm, '').replace(/<!--[\s\S]*?-->/g, '');
    assert.ok(!body.includes('{id}') && !/%7Bid%7D/i.test(body), `${f} 不含 {id}`);
    assert.ok(!body.includes('/report/#n-'), `${f} 不含推導的通報表錨點`);
  }
  const lm = json('v1/legacy-map.json');
  assert.ok(Object.keys(lm.data).every((k) => !k.includes('{')));
  assert.ok(lm.patterns.some((p) => p.listId === 'migration.rabies' && p.to === '/diseases/rabies/#symptoms' && p.oldTitle === '發病症狀'), '/legacy/ 模式比對可用');
});
