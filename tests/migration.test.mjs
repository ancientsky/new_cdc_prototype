// 第五輪（ARCHITECTURE 13.1／13.2）：移轉清單 schema 與驗證、site.migration、gov.legacy、待辦、redirects 與伺服器對照檔、
// legacy-map key 正規化、analyze-404-log 三類分類。
// 第六輪（14.1）起疾病清單由模板推導、人工清單只寫例外 ⇒ 結核病清單筆數會隨模板增加，這裡改用相對條件
// （人工清單原有的 40 筆與 15/18/3/3/1 仍逐筆保留；規模化本身見 tests/migration-scale.test.mjs）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { govern, memWriter, config } from './helpers.mjs';
import { loadSite } from '../scripts/lib/load.mjs';
import { validateSite } from '../scripts/lib/validate.mjs';
import { emitApi, buildRedirects, legacyKey, serverRedirects, goneEntries } from '../scripts/lib/emit-api.mjs';
import { parseLog, detectFormat, analyze, toMarkdown, loadMigrationLists } from '../scripts/analyze-404-log.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, 'fixtures/access-404.log');
const MIGRATION_DIR = path.join(HERE, '../content/migration');

function emitted(today = '2026-10-01', mutate) {
  const site = govern(today, mutate);
  site.searchIndex = { public: [], pro: [] };
  site.evalReport = { total: 1, passed: 1, byCategory: { version: { total: 1, passed: 1 } } };
  const { files, write } = memWriter();
  emitApi(site, write);
  return { site, files, json: (p) => JSON.parse(files.get(p)) };
}

test('移轉清單：schema 與參照驗證通過；target 不存在、key 重複、缺 target 都會擋下', () => {
  const site = loadSite(config);
  site.today = '2026-10-01';
  assert.ok(site.migrationLists.some((l) => l.id === 'migration.tuberculosis'), '讀入 content/migration/tuberculosis.json');
  assert.deepEqual(validateSite(site).filter((e) => e.includes('migration')), []);
  const list = site.migrationLists.find((l) => l.id === 'migration.tuberculosis');
  assert.equal(list.type, 'migration');
  assert.ok(list.items.length >= 30 && list.items.length <= 40, `30–40 筆（實際 ${list.items.length}）`);
  assert.ok(list.items.every((i) => i.verified === false), '重建清單全部 verified:false');
  for (const t of ['page', 'qa', 'pdf', 'news-list', 'media', 'list', 'external']) assert.ok(list.items.some((i) => i.oldType === t), `涵蓋 oldType ${t}`);
  const dropped = list.items.filter((i) => i.status === 'dropped');
  assert.equal(dropped.length, 1); assert.ok(dropped[0].note, 'dropped 要寫 note');

  // 破壞性案例
  const bad = structuredClone(list);
  bad.__file = 'test/migration-bad.json';
  bad.id = 'migration.test-bad';
  bad.scope = { kind: 'category', name: '測試欄目' }; // 同一疾病只能一份人工清單（14.1），破壞性案例改用欄目範圍
  bad.items = [
    { key: 'a', oldTitle: 'A', oldUrl: 'https://www.cdc.gov.tw/Category/Page/{id}', oldType: 'page', verified: false, status: 'migrated', target: 'faq.no-such-thing' },
    { key: 'a', oldTitle: 'A2', oldUrl: 'https://www.cdc.gov.tw/Category/Page/{id}#2', oldType: 'page', verified: false, status: 'pending' },
    { key: 'b', oldTitle: 'B', oldUrl: 'https://www.cdc.gov.tw/Category/Page/{id}#3', oldType: 'page', verified: false, status: 'merged' },
    { key: 'c', oldTitle: 'C', oldUrl: 'https://www.cdc.gov.tw/Category/Page/{id}#4', oldType: 'page', verified: false, status: 'lost', target: 'disease.tuberculosis' },
  ];
  site.migrationLists.push(bad);
  const errs = validateSite(site).filter((e) => e.startsWith('test/migration-bad.json'));
  assert.ok(errs.some((e) => e.includes('target faq.no-such-thing 不存在')), errs.join('\n'));
  assert.ok(errs.some((e) => e.includes('key 重複')), errs.join('\n'));
  assert.ok(errs.some((e) => /items\/2.*(target|必須)/.test(e)), 'merged 缺 target');
  assert.ok(errs.some((e) => e.includes('/items/3/status')), 'status enum');
});

test('佔位網址檢查：oldUrl／legacyRoot／legacyUrls 的 {id} 豁免，但新站內部欄位仍檢查', () => {
  const site = loadSite(config);
  site.today = '2026-10-01';
  const list = structuredClone(site.migrationLists.find((l) => l.id === 'migration.tuberculosis'));
  list.__file = 'test/migration-ph.json'; list.id = 'migration.test-ph'; list.scope = { kind: 'category', name: '測試欄目' };
  list.items = [{ key: 'x', oldTitle: 'X', oldUrl: 'https://www.cdc.gov.tw/File/Get/{id}', oldType: 'pdf', verified: false, status: 'pending', note: '新站暫放 https://www.example.com/x' }];
  site.migrationLists.push(list);
  const errs = validateSite(site).filter((e) => e.startsWith('test/migration-ph.json'));
  assert.equal(errs.length, 1, errs.join('\n'));
  assert.match(errs[0], /items\/0\/note 含佔位／示意網址/);
  // 內容的 legacyUrls 可含 {id}（schema 為 uri-template）
  assert.ok(site.byId.get('disease.tuberculosis').legacyUrls.some((u) => u.includes('{id}')));
  assert.deepEqual(validateSite(loadSite(config)).filter((e) => e.includes('legacyUrls')), []);
});

test('site.migration.stats：各狀態數量、總數、verified（結核病人工清單逐筆保留，模板補齊後筆數增加）', () => {
  const site = govern('2026-10-01');
  const m = site.migration;
  assert.ok(m && m.byTarget instanceof Map && m.byDisease instanceof Map);
  const raw = site.migrationLists.find((l) => l.id === 'migration.tuberculosis');
  const l = m.lists.find((x) => x.id === 'migration.tuberculosis');
  assert.equal(m.byDisease.get('disease.tuberculosis'), l);
  // 人工清單原有 40 筆全部保留、狀態不變（15/18/3/3/1）
  const manual = l.items.filter((i) => !i.derived);
  assert.equal(manual.length, raw.items.length);
  assert.equal(raw.items.length, 40);
  const count = (arr, st) => arr.filter((i) => i.status === st).length;
  assert.deepEqual(['migrated', 'merged', 'archived', 'pending', 'dropped'].map((st) => count(manual, st)), [15, 18, 3, 3, 1]);
  for (const it of raw.items) assert.equal(l.items.find((x) => x.key === it.key)?.status, it.status, it.key);
  // 模板補齊：清單筆數 ≥ 人工筆數，補上的都是 derived
  assert.ok(l.items.length > raw.items.length, `模板補齊（${l.items.length} > ${raw.items.length}）`);
  assert.equal(l.derivedItems, l.items.length - raw.items.length);
  // 清單統計＝逐筆計數；全站統計＝各清單加總
  for (const st of ['migrated', 'merged', 'archived', 'pending', 'dropped']) assert.equal(l.stats[st], count(l.items, st), st);
  assert.equal(l.stats.total, l.items.length); assert.equal(l.stats.verified, 0);
  assert.equal(l.stats.migrated + l.stats.merged + l.stats.archived + l.stats.pending + l.stats.dropped, l.stats.total);
  assert.ok(l.stats.migrated + l.stats.merged > l.stats.total / 2, '多數為 migrated／merged');
  for (const k of ['migrated', 'merged', 'archived', 'pending', 'dropped', 'verified', 'total']) assert.equal(m.stats[k], m.lists.reduce((n, x) => n + x.stats[k], 0), k);
  assert.equal(m.stats.migrated + m.stats.merged + m.stats.archived + m.stats.pending + m.stats.dropped, m.stats.total);
  assert.equal(m.pending.length, m.stats.pending);
  assert.equal(l.ownerName, '慢性傳染病組');
  assert.equal(site.gov.summary.migrationPending, m.stats.pending);
});

test('pending ⇒ 每份清單聚合一則 migration-pending 待辦（連到後台）；verified:false 不開待辦', () => {
  const site = govern('2026-10-01');
  const todos = site.gov.todos.filter((t) => t.kind === 'migration-pending');
  assert.equal(todos.length, site.migration.lists.filter((l) => l.stats.pending > 0 && l.status !== 'archived').length, '每份有待移轉的清單一則');
  assert.equal(new Set(todos.map((t) => t.listId)).size, todos.length);
  for (const t of todos) {
    assert.equal(t.itemType, 'migration'); assert.equal(t.href, '/admin/migration/'); assert.ok(t.dueAt); assert.equal(t.kindLabel, '舊頁待移轉');
    assert.equal(t.count, site.migration.lists.find((l) => l.id === t.listId).stats.pending);
  }
  const tb = todos.find((t) => t.listId === 'migration.tuberculosis');
  assert.ok(tb, '結核病清單一則');
  assert.equal(tb.severity, 'medium', '第三類 ⇒ medium'); assert.equal(tb.owner, 'unit.chronic-infectious');
  assert.ok(tb.pendingKeys.includes('training-slides'), '教育訓練教材待移轉');
  assert.match(tb.text, /^結核病：\d+ 個舊頁待移轉/);
  // 不是 pending 的（含 verified:false）不計
  const l = site.migration.lists.find((x) => x.id === 'migration.tuberculosis');
  assert.equal(tb.count, l.items.filter((i) => i.status === 'pending').length);
  // 把一筆 pending 改 migrated ⇒ 同一則待辦的筆數少 1（不是少一則）
  const s2 = govern('2026-10-01', (s) => { const it = s.migrationLists.find((x) => x.id === 'migration.tuberculosis').items.find((i) => i.key === 'training-slides'); it.status = 'migrated'; it.target = 'topic.tb-prevention'; });
  const tb2 = s2.gov.todos.find((t) => t.kind === 'migration-pending' && t.listId === 'migration.tuberculosis');
  assert.equal(tb2.count, tb.count - 1);
  assert.equal(s2.gov.todos.filter((t) => t.kind === 'migration-pending').length, todos.length);
});

test('gov.legacy 以 target 反向掛到新站內容；失效版 target 的轉址導向現行版', () => {
  const site = govern('2026-10-01');
  const tb = site.byId.get('disease.tuberculosis');
  assert.ok(tb.gov.legacy, '疾病頁有 gov.legacy');
  assert.equal(tb.gov.legacy.show, true);
  assert.equal(tb.gov.legacy.showUntil, '2027-12-31');
  assert.equal(tb.gov.legacy.items.length, tb.gov.legacy.count);
  assert.deepEqual(tb.gov.legacy.urls, tb.gov.legacy.items.map((i) => i.oldUrl));
  assert.ok(tb.gov.legacy.items.every((i) => i.target === 'disease.tuberculosis'));
  assert.ok(tb.gov.legacy.items.some((i) => i.anchor === 'symptoms' && i.to === '/diseases/tuberculosis/#symptoms'));
  assert.deepEqual(site.migration.byTarget.get('disease.tuberculosis'), tb.gov.legacy.items);
  // 其他型別也掛得到（服務、Q&A、文件）
  for (const id of ['service.tb-treatment-subsidy', 'faq.ltbi-treat-or-not', 'doc.tb-guideline.2025-09-01', 'topic.tb-prevention']) assert.ok(site.byId.get(id).gov.legacy?.items.length, id);
  // 沒有對應的內容 gov.legacy＝null（第六輪起每個疾病頁都有推導清單對應，改用政策頁）
  assert.equal(site.byId.get('page.privacy').gov.legacy, null);
  assert.ok(site.byId.get('disease.dengue').gov.legacy?.count > 0, '推導清單也掛到疾病頁');
  // 第七版（失效）：legacy 掛在舊版頁，轉址 to 指向現行第八版
  const old = site.byId.get('doc.tb-guideline.2022-03-01');
  assert.equal(old.gov.superseded, true);
  const it = old.gov.legacy.items[0];
  assert.equal(it.status, 'archived'); assert.equal(it.to, '/documents/tb-guideline.2025-09-01/'); assert.equal(it.redirectsToCurrent, true);
  assert.equal(it.pattern, false, '舊版 PDF 檔名可確定，不是佔位');
});

test('showLegacyUntil 過期 ⇒ gov.legacy.show=false（自動退場，不需人工）', () => {
  const before = govern('2027-12-31');
  assert.equal(before.byId.get('disease.tuberculosis').gov.legacy.show, true, '截止日當天仍顯示');
  const after = govern('2028-01-01');
  const lg = after.byId.get('disease.tuberculosis').gov.legacy;
  assert.equal(lg.show, false);
  assert.ok(lg.items.length > 0, '資料仍在（後台與 API 可用），只是前台不顯示');
  assert.equal(after.migration.lists[0].show, false);
});

test('v1/redirects.json：含 migration 項（verified、pattern）；dropped／pending 無 target 不轉址；不與 legacy 重複', () => {
  const { json, site } = emitted();
  const r = json('v1/redirects.json');
  const allMig = r.data.filter((x) => x.kind === 'migration');
  assert.equal(allMig.length, site.migration.lists.reduce((n, l) => n + l.items.filter((i) => i.to && i.status !== 'dropped').length, 0));
  const mig = allMig.filter((x) => x.listId === 'migration.tuberculosis');
  const list = site.migration.lists.find((l) => l.id === 'migration.tuberculosis');
  assert.equal(mig.length, list.items.filter((i) => i.target && i.status !== 'dropped').length);
  assert.ok(mig.every((x) => x.status === 301 && typeof x.verified === 'boolean' && typeof x.pattern === 'boolean' && x.listId === 'migration.tuberculosis'));
  assert.ok(mig.every((x) => !x.from.includes('#') && !/^https?:/.test(x.from)), 'from 去網域與 hash');
  const intro = mig.find((x) => x.key === 'intro');
  assert.equal(intro.from, '/Disease/SubIndex/{id}'); assert.equal(intro.pattern, true); assert.equal(intro.to, '/diseases/tuberculosis/');
  assert.equal(mig.find((x) => x.key === 'intro-symptoms').to, '/diseases/tuberculosis/#symptoms');
  const g7 = mig.find((x) => x.key === 'guideline-7th');
  assert.equal(g7.pattern, false); assert.equal(g7.to, '/documents/tb-guideline.2025-09-01/'); assert.equal(g7.targetId, 'doc.tb-guideline.2022-03-01');
  assert.ok(!mig.some((x) => x.key === 'event-2019'), 'dropped 不轉址');
  assert.ok(!mig.some((x) => x.key === 'training-slides'), 'pending 無 target 不轉址');
  // 同一舊網址已有 migration 項 ⇒ 不再出 legacy 項
  const keys = new Set(mig.map((x) => legacyKey(x.from)));
  assert.ok(!r.data.some((x) => x.kind === 'legacy' && keys.has(legacyKey(x.fromPath))));
  assert.equal(r.meta.byKind.migration, allMig.length);
  // 既有對照不受影響
  assert.ok(r.data.some((x) => x.kind === 'legacy' && x.itemId === 'disease.dengue' && x.to === '/diseases/dengue/'));
});

// 伺服器檔測試用：在旅遊清單加一筆確定網址的 dropped（410 gone 行是設計，playbook 2.3），確保 gone 行的格式也被驗到
const GONE_URL = 'https://www.cdc.gov.tw/Category/List/GoneTestOnly';
const addGone = (site) => {
  const list = site.migrationLists.find((l) => l.id === 'migration.travel');
  list.items.push({ key: 'gone-test', oldTitle: '測試用已移除列表', oldUrl: GONE_URL, oldType: 'list', verified: false, status: 'dropped', note: '測試' });
};

test('三種伺服器對照檔：由 redirects.json 轉出、不含 pattern 項、跳過歧義與根目錄；dropped 確定網址輸出 410 gone 行', () => {
  const { files, json, site } = emitted('2026-10-01', addGone);
  const redirects = json('v1/redirects.json').data;
  const nginx = files.get('redirects/nginx.map');
  const iis = files.get('redirects/web.config.rewritemap.xml');
  const nf = files.get('redirects/_redirects');
  assert.ok(nginx && iis && nf);
  for (const raw of [nginx, iis, nf]) {
    const body = raw.replace(/^#.*$/gm, '').replace(/<!--[\s\S]*?-->/g, ''); // 去掉註解（註解裡會說明 {id} 規則）
    assert.ok(!body.includes('{id}') && !/%7Bid%7D/i.test(body), 'pattern 項不進伺服器檔');
    assert.ok(body.includes('/documents/tb-guideline.2025-09-01/'), '第七版 PDF → 現行第八版');
    assert.ok(body.includes('/diseases/dengue/'), '既有 legacyUrls 也輸出');
    assert.ok(!/\/Disease\/Index\b/.test(body), '一對多的舊總覽頁（歧義）不輸出');
  }
  const { entries } = serverRedirects(redirects);
  assert.ok(entries.length > 0);
  const gone = goneEntries(site).filter((g) => !g.pattern);
  assert.ok(gone.some((g) => g.migrationKey === 'gone-test'), '確定網址的 dropped 進 gone');
  assert.ok(entries.every((e) => !redirects.find((r) => r.kind === 'migration' && r.pattern && legacyKey(r.from) === e.key)));
  // nginx：每筆一行、引號包住（值含 # 也安全）、case-insensitive
  // gone（status: dropped、非 pattern）每筆一行 410（設計如此，見 docs/migration-playbook.md 2.3）
  const nginxRules = nginx.split('\n').filter((l) => l && !l.startsWith('#'));
  assert.equal(nginxRules.length, entries.length + gone.length);
  const nginxGone = nginxRules.filter((l) => / "410"; # gone: /.test(l));
  assert.equal(nginxGone.length, gone.length);
  assert.ok(nginxGone.some((l) => l.includes('GoneTestOnly') && l.endsWith('# gone: 測試用已移除列表')), nginxGone.join('\n'));
  assert.ok(nginxRules.filter((l) => !nginxGone.includes(l)).every((l) => /^"~\*\^.+\$" "\/[^"]*";( # unverified)?$/.test(l)), nginxRules.find((l) => !/^"~\*/.test(l)));
  assert.ok(nginxRules.some((l) => l.endsWith('# unverified')), '移轉清單未核對者加註');
  // _redirects：from to 301
  const nfRules = nf.split('\n').filter((l) => l && !l.startsWith('#'));
  assert.equal(nfRules.length, entries.length + gone.length);
  const nfGone = nfRules.filter((l) => /  \/410\.html  410  # gone: /.test(l));
  assert.equal(nfGone.length, gone.length);
  assert.ok(nfRules.filter((l) => !nfGone.includes(l)).every((l) => /^\/\S+( \S+=\S+)*  \/\S*  301$/.test(l)), nfRules.join('\n'));
  assert.ok(nfRules.some((l) => / typeid=9  /.test(l)), 'query 以 Netlify 參數語法');
  // IIS：XML、rewriteMap、Permanent
  assert.match(iis, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(iis, /<rewriteMap name="CdcLegacyRedirects"/);
  assert.match(iis, /redirectType="Permanent"/);
  assert.ok((iis.match(/<add key=/g) ?? []).length >= entries.length + gone.length);
  assert.equal((iis.match(/ value="410" \/> <!-- gone: /g) ?? []).length, gone.length);
  assert.ok(!/&(?!amp;|lt;|gt;|quot;)/.test(iis), 'XML 已跳脫');
  // 端點清單列出三個檔
  const idx = json('v1/index.json').data;
  for (const f of ['/redirects/nginx.map', '/redirects/web.config.rewritemap.xml', '/redirects/_redirects', '/v1/legacy-map.json']) assert.ok(idx.some((e) => e.path === f), f);
});

test('移轉清單 newPath：去處為系統產生頁／功能頁（非內容 id）⇒ 301 到該路徑、進伺服器檔與 legacy-map、不是 410；validate／schema 規則', () => {
  const { files, json, site } = emitted();
  const travel = site.migration.lists.find((l) => l.id === 'migration.travel');
  const it = (k) => travel.items.find((i) => i.key === k);
  // governance：to＝newPath，toId null，不掛 gov.legacy
  assert.equal(it('travel-list').status, 'migrated'); assert.equal(it('travel-list').to, '/travel/'); assert.equal(it('travel-list').toId, null);
  assert.equal(it('rx-jp').to, '/travel/JP/'); assert.equal(it('travel-news-list').to, '/news/');
  assert.ok(!site.migration.byTarget.has(undefined) && ![...site.migration.byTarget.values()].flat().some((x) => x.newPath), 'newPath 項不進 byTarget');
  // redirects.json：kind migration、itemId／targetId null、pattern 照舊
  const redirects = json('v1/redirects.json').data;
  const r = redirects.find((x) => x.kind === 'migration' && x.key === 'travel-list');
  assert.equal(r.to, '/travel/'); assert.equal(r.status, 301); assert.equal(r.itemId, null); assert.equal(r.targetId, null); assert.equal(r.newPath, '/travel/'); assert.equal(r.pattern, false);
  const jp = redirects.find((x) => x.kind === 'migration' && x.key === 'rx-jp');
  assert.equal(jp.to, '/travel/JP/'); assert.equal(jp.pattern, true, '舊網址含 {id} ⇒ pattern，只進文件');
  // 伺服器檔與 legacy-map：確定網址的列表頁 301 到 /travel/，不出 410
  const nginx = files.get('redirects/nginx.map');
  assert.match(nginx, /"~\*\^\/category\/list\/trbpxpzm7eo3-dkc4ryzuq[^"]*" "\/travel\/";/i);
  assert.ok(!/category\/list\/trbpxpzm7eo3-dkc4ryzuq.*"410"/i.test(nginx), '不再是 410');
  const lm = json('v1/legacy-map.json');
  assert.equal(lm.data['/category/list/trbpxpzm7eo3-dkc4ryzuq'], '/travel/');
  assert.ok(!lm.gone.some((g) => g.listId === 'migration.travel'), JSON.stringify(lm.gone));
  // validate：newPath 取代 target；兩者並存、都沒填都擋
  const s2 = loadSite(config);
  s2.today = '2026-10-01';
  assert.deepEqual(validateSite(s2).filter((e) => e.includes('migration')), []);
  const bad = structuredClone(s2.migrationLists.find((l) => l.id === 'migration.travel'));
  bad.__file = 'test/migration-np.json'; bad.id = 'migration.test-np';
  bad.items = [
    { key: 'a', oldTitle: 'A', oldUrl: 'https://www.cdc.gov.tw/X/1', oldType: 'list', verified: false, status: 'migrated', newPath: '/travel/' },
    { key: 'b', oldTitle: 'B', oldUrl: 'https://www.cdc.gov.tw/X/2', oldType: 'list', verified: false, status: 'migrated', newPath: '/travel/', target: 'disease.malaria' },
    { key: 'c', oldTitle: 'C', oldUrl: 'https://www.cdc.gov.tw/X/3', oldType: 'list', verified: false, status: 'archived' },
    { key: 'd', oldTitle: 'D', oldUrl: 'https://www.cdc.gov.tw/X/4', oldType: 'list', verified: false, status: 'migrated', newPath: 'travel/JP/' },
  ];
  s2.migrationLists.push(bad);
  const errs = validateSite(s2).filter((e) => e.startsWith('test/migration-np.json'));
  assert.ok(!errs.some((e) => /items\/0/.test(e)), errs.join('\n'));
  assert.ok(errs.some((e) => /items\/1.*(target 與 newPath 只能擇一|must NOT be valid)/.test(e)), errs.join('\n'));
  assert.ok(errs.some((e) => /items\/2.*(必須填 target|must match a schema in anyOf|must have required)/.test(e)), errs.join('\n'));
  assert.ok(errs.some((e) => /items\/3\/newPath/.test(e)), errs.join('\n'));
});

test('legacy-map key 正規化：去網域、去 hash、小寫、去尾斜線、去 page 參數；map 內容與伺服器檔一致', () => {
  assert.equal(legacyKey('https://www.cdc.gov.tw/Bulletin/List/AbC/?page=2'), '/bulletin/list/abc');
  assert.equal(legacyKey('https://www.cdc.gov.tw/Bulletin/Detail/AbC?typeid=9&page=3#top'), '/bulletin/detail/abc?typeid=9');
  assert.equal(legacyKey('/Bulletin/Detail/AbC?Page=3&typeid=9'), '/bulletin/detail/abc?typeid=9');
  assert.equal(legacyKey('HTTP://WWW.CDC.GOV.TW/Disease/SubIndex/XyZ/'), '/disease/subindex/xyz');
  assert.equal(legacyKey('https://www.cdc.gov.tw/'), '/');
  assert.equal(legacyKey('https://www.cdc.gov.tw'), '/');
  assert.equal(legacyKey('Disease/Index'), '/disease/index');
  assert.equal(legacyKey('/Uploads/archives/結核病.pdf'), legacyKey('/Uploads/archives/%E7%B5%90%E6%A0%B8%E7%97%85.pdf'), '中文與百分比編碼同 key');
  assert.equal(legacyKey('/Disease/SubIndex/{id}#intro'), '/disease/subindex/{id}', '佔位保留大括號');
  const { json } = emitted();
  const lm = json('v1/legacy-map.json');
  assert.equal(lm.meta.api, 'v1');
  const keys = Object.keys(lm.data);
  assert.ok(keys.length > 0);
  for (const k of keys) {
    assert.equal(k, legacyKey(k), `key 已正規化：${k}`);
    assert.equal(k, k.toLowerCase());
    assert.ok(!k.includes('#') && !/\/$/.test(k) && !/[?&]page=/.test(k) && !k.includes('{'), k);
    assert.ok(lm.data[k].startsWith('/'), '值為新站路徑');
  }
  assert.equal(lm.data[legacyKey('https://www.cdc.gov.tw/Disease/SubIndex/WYbKe3aE7LiY5gb-eA8PBw')], '/diseases/dengue/');
  assert.equal(lm.data[legacyKey('/Uploads/archives/結核病診治指引第七版.pdf')], '/documents/tb-guideline.2025-09-01/');
  assert.ok(lm.patterns.some((p) => p.pattern === '/disease/subindex/{id}' && p.to === '/diseases/tuberculosis/'), 'patterns 只供說明');
  assert.ok(lm.gone.some((g) => g.migrationKey === 'event-2019' && g.status === 410));
  assert.ok(lm.ambiguous.some((a) => a.key === '/disease/index'));
});

test('analyze-404-log：Nginx combined 三類分類＋待補對照草稿；Markdown 與 JSON', () => {
  const text = fs.readFileSync(FIXTURE, 'utf8');
  assert.equal(detectFormat(text), 'nginx');
  const { entries } = parseLog(text);
  assert.ok(entries.length >= 20);
  const { json } = emitted();
  const report = analyze(entries, { map: json('v1/legacy-map.json'), migrationLists: loadMigrationLists(MIGRATION_DIR) });
  const { redirect, missing, gone } = report.categories;
  assert.equal(report.notFound, entries.filter((e) => e.status === 404).length);
  // 1. 可直接 301：大小寫、尾斜線、page 參數都正規化到同一筆
  const tb7 = redirect.find((r) => r.to === '/documents/tb-guideline.2025-09-01/');
  assert.ok(tb7); assert.equal(tb7.count, 3, '大小寫不同的百分比編碼合併');
  assert.equal(redirect.find((r) => r.to === '/diseases/dengue/').count, 2, '尾斜線與大小寫合併');
  assert.ok(redirect.some((r) => r.to === '/faq/measles-mmr-adult-who/'), '?page=2 忽略');
  // 2. 待補對照：符合移轉清單 {id} 模式或舊站路徑族
  const sub = missing.find((m) => m.key === '/disease/subindex/qk3nt0brzu7mwc1ylpxa2g');
  assert.ok(sub); assert.equal(sub.count, 3);
  assert.ok(sub.candidates.some((c) => c.listId === 'migration.tuberculosis' && c.key === 'intro'), '候選：結核病清單的 SubIndex 模式');
  assert.ok(missing.some((m) => m.key.startsWith('/file/get/')));
  assert.ok(missing.some((m) => m.key.startsWith('/infectionreport/info/') && m.candidates.some((c) => c.key === 'annual-report')));
  assert.equal(report.drafts.length, missing.length);
  for (const d of report.drafts) {
    assert.equal(d.status, 'pending'); assert.equal(d.verified, false); assert.match(d.oldUrl, /^https:\/\/www\.cdc\.gov\.tw\//); assert.match(d.key, /^[a-z0-9][a-z0-9-]*$/);
  }
  // 3. 真的不存在
  assert.deepEqual(gone.map((g) => g.key).sort(), ['/images/2015/banner-old.jpg', '/phpmyadmin/index.php', '/wp-login.php']);
  assert.ok(gone.every((g) => g.suggest === 410));
  // 200／301 不計
  assert.ok(![...redirect, ...missing, ...gone].some((x) => x.key === '/diseases/tuberculosis'));
  const md = toMarkdown(report, { sources: ['tests/fixtures/access-404.log'], format: 'nginx' });
  assert.match(md, /^# 404 log 分析報表/);
  for (const h of ['## 1. 可直接 301', '## 2. 待補對照', '## 3. 真的不存在（建議 410）', '```json']) assert.ok(md.includes(h), h);
});

test('analyze-404-log：IIS W3C 格式（#Fields 欄位順序）自動判斷；移轉清單 dropped 的確定網址歸 410', () => {
  const iis = [
    '#Software: Microsoft Internet Information Services 10.0',
    '#Version: 1.0',
    '#Date: 2026-10-01 00:00:00',
    '#Fields: date time s-ip cs-method cs-uri-stem cs-uri-query s-port cs-username c-ip cs(User-Agent) cs(Referer) sc-status sc-substatus sc-win32-status time-taken',
    '2026-10-01 00:00:01 10.0.0.1 GET /Disease/SubIndex/WYbKe3aE7LiY5gb-eA8PBw - 443 - 203.0.113.9 Mozilla/5.0 - 404 0 2 15',
    '2026-10-01 00:00:02 10.0.0.1 GET /Bulletin/Detail/RQMqkQ2-D6sOpVi8dnV75w typeid=9&page=1 443 - 203.0.113.9 Mozilla/5.0 https://www.google.com/ 404 0 2 12',
    '2026-10-01 00:00:03 10.0.0.1 GET /Category/List/Zz9YxW8vU7tS6rQ5pO4nMl - 443 - 203.0.113.9 Mozilla/5.0 - 404 0 2 9',
    '2026-10-01 00:00:04 10.0.0.1 GET /Category/Page/OldEvent2019Signup - 443 - 203.0.113.9 Mozilla/5.0 - 404 0 2 9',
    '2026-10-01 00:00:05 10.0.0.1 GET /cgi-bin/test.cgi - 443 - 203.0.113.9 Mozilla/5.0 - 404 0 2 9',
    '2026-10-01 00:00:06 10.0.0.1 GET /diseases/tuberculosis/ - 443 - 203.0.113.9 Mozilla/5.0 - 200 0 0 30',
  ].join('\r\n');
  assert.equal(detectFormat(iis), 'iis');
  const { entries } = parseLog(iis);
  assert.equal(entries.length, 6);
  assert.equal(entries[1].path, '/Bulletin/Detail/RQMqkQ2-D6sOpVi8dnV75w?typeid=9&page=1');
  assert.equal(entries[1].referer, 'https://www.google.com/');
  const { json } = emitted();
  const lists = loadMigrationLists(MIGRATION_DIR);
  // 示範：把 dropped 的活動頁改成確定網址 ⇒ 精確命中時歸 410
  const ev = lists.find((l) => l.id === 'migration.tuberculosis').items.find((i) => i.key === 'event-2019');
  ev.oldUrl = 'https://www.cdc.gov.tw/Category/Page/OldEvent2019Signup';
  const { categories } = analyze(entries, { map: json('v1/legacy-map.json').data, migrationLists: lists });
  assert.deepEqual(categories.redirect.map((r) => r.to).sort(), ['/diseases/dengue/', '/news/2026-06-02-measles-travel-mmr-1966/']);
  assert.deepEqual(categories.missing.map((m) => m.key), ['/category/list/zz9yxw8vu7ts6rq5po4nml']);
  assert.deepEqual(categories.gone.map((g) => g.key).sort(), ['/category/page/oldevent2019signup', '/cgi-bin/test.cgi']);
  assert.match(categories.gone.find((g) => g.key.startsWith('/category/page/')).reason, /dropped/);
});

test('結核病回補內容：文件版本鏈、Q&A ≥ 8、專區、服務、新聞、疾病頁防治計畫', () => {
  const site = govern('2026-10-01');
  const fam = site.gov.families.find((f) => f.family === 'doc.tb-guideline');
  assert.equal(fam.current, 'doc.tb-guideline.2025-09-01');
  assert.ok(fam.versions.find((v) => v.id === 'doc.tb-guideline.2022-03-01').superseded);
  assert.ok(site.byId.get('doc.tb-guideline.2025-09-01').changes.length >= 3);
  for (const f of ['doc.ltbi-guideline', 'doc.tb-contact-investigation', 'doc.dots-manual', 'doc.tb-case-definition', 'doc.tb-manual']) assert.ok(site.gov.families.some((x) => x.family === f && x.current), f);
  const faqs = site.collections.faq.filter((f) => f.diseases?.includes('disease.tuberculosis'));
  assert.ok(faqs.length >= 8, `結核病 Q&A ${faqs.length} 題`);
  for (const id of ['topic.tb-prevention', 'service.tb-treatment-subsidy', 'service.ltbi-treatment', 'news.2026-03-24-world-tb-day-end-tb-2035', 'news.2026-08-20-dots-outcomes']) {
    const it = site.byId.get(id);
    assert.ok(it, id); assert.equal(it.status, 'published');
    assert.equal(it.gov.whitelist.effective, true, `${id} 進白名單：${it.gov.whitelist.reasons}`);
    assert.ok(it.legacyUrls?.length, `${id} 有 legacyUrls`);
  }
  const tb = site.byId.get('disease.tuberculosis');
  assert.equal(tb.professional.caseDefinitionDoc, 'doc.tb-case-definition');
  const keys = tb.professional.programs.map((p) => p.key);
  for (const k of ['dots', 'ltbi', 'contact-investigation', 'mdr-tmtc', 'end-tb-2035', 'high-risk-screening']) assert.ok(keys.includes(k), k);
  assert.equal(tb.gov.whitelist.effective, true);
  // 新內容不產生治理待辦（除了移轉 pending）
  const tbTodos = site.gov.todos.filter((t) => t.kind !== 'migration-pending' && /tb|ltbi|dots|tubercul/.test(t.itemId));
  assert.deepEqual(tbTodos.map((t) => t.id), []);
});
