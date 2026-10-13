// 國際重要疫情資訊自動上架（docs/intl-epidemic.md）：交換格式、CSV／舊格式轉換、單則檢查、整批把關（第 5 節）、寫檔、CLI、排程拉取、治理待辦。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as R from '../src/client/intl-epidemic-rules.js';
import { parseFeed, validateFeed, planImport, applyImport, SNAPSHOT_FILE, RECORD_FILE } from '../scripts/lib/intl-epidemic.mjs';
import { importTravelEpidemic } from '../scripts/fetch-data.mjs';
import { govern } from './helpers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJSON = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const TODAY = '2026-10-13';
const NOW = '2026-10-13T02:00:00.000Z';
const NO_ALLOW = { numbers: new Set(), domains: [], entries: [], errors: [] };
const DISEASES = [
  { id: 'disease.dengue', name: '登革熱', nameEn: 'Dengue fever', aliases: ['骨痛熱症'] },
  { id: 'disease.measles', name: '麻疹', nameEn: 'Measles' },
  { id: 'disease.polio', name: '小兒麻痺症／急性無力肢體麻痺', nameEn: 'Poliomyelitis' },
];
const COUNTRIES = [
  { iso2: 'VN', name: '越南', nameEn: 'Vietnam' },
  { iso2: 'MX', name: '墨西哥', nameEn: 'Mexico' },
  { iso2: 'CA', name: '加拿大', nameEn: 'Canada' },
  { iso2: 'CD', name: '剛果民主共和國', nameEn: 'DR Congo' },
];
const CTX = { diseases: DISEASES, countries: COUNTRIES, allowlist: NO_ALLOW };

const item = (id, over = {}) => ({
  id,
  status: 'published',
  publishedAt: '2026-10-10T08:00:00+08:00',
  disease: '登革熱',
  headline: `越南-登革熱 ${id}`,
  body: `內文 ${id}`,
  areas: [{ country: '越南', iso2: 'VN' }],
  ...over,
});
const feedOf = (items, over = {}) => ({ version: '1', producer: '測試', mode: 'full', items, shape: 'v1', ...over });
const plan = (current, items, over = {}) => planImport({ current, feed: feedOf(items, over.feed), today: TODAY, now: NOW, source: 'feed', ...CTX, ...over });
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'intl-epi-'));

// ── CSV ──
test('parseCsv：BOM、CRLF、引號、"" 跳脫、引號內換行與逗號、空白列', () => {
  const text = '﻿id,headline,body,countries\r\na1,"甲,乙","第一行\r\n第二行 ""引號""",越南;墨西哥\r\n\r\na2,丙,丁,\n';
  const rows = R.parseCsv(text);
  assert.equal(rows.length, 2);
  assert.deepEqual(Object.keys(rows[0]), ['id', 'headline', 'body', 'countries']);
  assert.equal(rows[0].headline, '甲,乙');
  assert.equal(rows[0].body, '第一行\r\n第二行 "引號"');
  assert.equal(rows[1].countries, '');
  const items = R.fromCsvRows(rows);
  assert.equal(items[0].body, '第一行\n第二行 "引號"', 'body 換行統一成 \\n');
  assert.deepEqual(items[0].areas, [{ country: '越南' }, { country: '墨西哥' }]);
  assert.deepEqual(items[1].areas, []);
});

test('fromCsvRows：多國以 ; 分隔並依序配對 iso2／英文名／地區說明；等級文字轉數字', () => {
  const [it] = R.fromCsvRows([{ id: 'x', countries: '墨西哥;加拿大', countriesEn: 'Mexico;Canada', iso2s: 'mx;CA', areaDetail: '北部;', severity: '第二級' }]);
  assert.deepEqual(it.areas, [
    { country: '墨西哥', countryEn: 'Mexico', iso2: 'MX', detail: '北部' },
    { country: '加拿大', countryEn: 'Canada', iso2: 'CA' },
  ]);
  assert.equal(it.severity, 2);
});

test('範例檔：JSON 與 CSV 兩份都能解析，同一則內容指紋相同；meta.note 標示示意', () => {
  const json = parseFeed(fs.readFileSync(path.join(ROOT, 'data/samples/intl-epidemic-feed.sample.json'), 'utf8'));
  const csv = parseFeed(fs.readFileSync(path.join(ROOT, 'data/samples/intl-epidemic-feed.sample.csv'), 'utf8'));
  assert.equal(json.shape, 'v1');
  assert.equal(csv.shape, 'csv');
  assert.match(json.note, /示意/);
  assert.match(json.note, /未驗證/);
  assert.ok(json.items.length >= 3 && json.items.length <= 4);
  assert.equal(csv.items.length, json.items.length);
  assert.equal(R.itemFingerprint(csv.items[0]), R.itemFingerprint(json.items[0]));
  assert.ok(json.items.some((x) => x.status === 'withdrawn'));
  const v = validateFeed(json, { today: TODAY, ...CTX });
  assert.deepEqual(v.envelopeErrors, []);
  assert.ok(
    v.results.every((r) => !r.errors.length),
    JSON.stringify(v.results.map((r) => r.errors)),
  );
  assert.ok(
    v.results.some((r) => r.unmapped.some((u) => u.kind === 'disease')),
    '有一則疾病對不上主檔',
  );
});

// ── 舊格式 → v1 ──
test('fromLegacyRows：id 取 epidemicId、逗號拆國家、alert_disease 缺時取標題疾病段、沒有國家時用標題地區', () => {
  const rows = [
    {
      sent: '2026-10-02T07:48:32+08:00',
      effective: '2026-10-02T07:48:32+08:00',
      expires: '2027-01-02T07:48:32+08:00',
      headline: '孟加拉/尚比亞-炭疽病',
      description: '  \r第一段 \r\r第二段  ',
      web: 'https://www.cdc.gov.tw/TravelEpidemic/Detail/X?epidemicId=lQu-5iNul8z5h5Up_56VCQ',
      alert_disease: '炭疽病',
      areaDesc: '孟加拉,尚比亞',
      areaDesc_EN: 'Bangladesh,Zambia',
      ISO3166: 'BD,ZM',
      areaDetail: null,
      severity_level: null,
    },
    {
      effective: '2026-09-30T08:15:44+08:00',
      headline: '歐洲/南非-呼吸道疾病',
      description: '內文',
      web: 'https://www.cdc.gov.tw/x?epidemicId=dAT_vx9BRnU-7cTwcLwW-A',
      alert_disease: null,
      areaDesc: '南非',
      ISO3166: 'ZA',
    },
    {
      effective: '2026-09-21T08:18:28+08:00',
      headline: '全球-新型A型流感(每週更新)',
      description: '內文',
      alert_disease: '新型A型流感',
      areaDesc: null,
      ISO3166: null,
    },
  ];
  const [a, b, c] = R.fromLegacyRows(rows);
  assert.equal(a.id, 'lQu-5iNul8z5h5Up_56VCQ');
  assert.equal(a.publishedAt, '2026-10-02T07:48:32+08:00');
  assert.equal(a.expiresAt, '2027-01-02T07:48:32+08:00');
  assert.equal(a.body, '第一段\n\n第二段');
  assert.deepEqual(a.areas, [
    { country: '孟加拉', countryEn: 'Bangladesh', iso2: 'BD' },
    { country: '尚比亞', countryEn: 'Zambia', iso2: 'ZM' },
  ]);
  assert.equal(a.sourceUrl, rows[0].web);
  assert.equal(b.disease, '呼吸道疾病');
  assert.deepEqual(c.areas, [{ country: '全球' }]);
  assert.match(c.id, /^h-[0-9a-z]+$/, '沒有 epidemicId ⇒ 標題＋日期的穩定雜湊');
  assert.equal(R.fromLegacyRows([rows[2]])[0].id, c.id, '同一列兩次算出同一個 id');
  for (const it of [a, b, c]) assert.deepEqual(R.checkItem(it, { today: TODAY, diseases: DISEASES, countries: COUNTRIES }).errors, [], it.id);
});

test('detectShape：v1、legacy（陣列或 { data }）、csv、看不懂', () => {
  assert.equal(R.detectShape({ version: '1', items: [] }), 'v1');
  assert.equal(R.detectShape([{ headline: 'a', effective: '2026-10-01' }]), 'legacy');
  assert.equal(R.detectShape({ meta: {}, data: [{ headline: 'a', description: 'b' }] }), 'legacy');
  assert.equal(R.detectShape('id,headline\n1,a'), 'csv');
  assert.equal(R.detectShape('{"version":"1","items":[]}'), 'v1');
  assert.equal(R.detectShape('hello'), 'unknown');
  assert.throws(() => parseFeed('hello'), /看不懂/);
});

// ── 主檔對應 ──
test('mapDisease／mapCountry：全半形斜線、康熙部首、別名、英文名、iso2 優先', () => {
  assert.equal(R.mapDisease('小兒麻痺症/急性無力肢體麻痺', DISEASES)?.id, 'disease.polio');
  assert.equal(R.mapDisease('骨痛熱症', DISEASES)?.id, 'disease.dengue');
  assert.equal(R.mapDisease('measles', DISEASES)?.id, 'disease.measles');
  assert.equal(R.mapDisease('不明原因發燒', DISEASES), null);
  assert.equal(R.mapCountry({ country: '別名不對', iso2: 'VN' }, COUNTRIES)?.iso2, 'VN');
  assert.equal(R.mapCountry('墨西哥', COUNTRIES)?.iso2, 'MX');
  assert.equal(R.mapCountry({ countryEn: 'canada' }, COUNTRIES)?.iso2, 'CA');
  assert.equal(R.normName('⽐'), R.normName('比'), 'NFKC：康熙部首與一般字視為相同');
});

// ── 單則檢查 ──
test('checkItem：白話錯誤（缺必填、未來日期、iso2 格式、太長）；withdrawn 只需 id；對不上主檔只是警告', () => {
  const ctx = { today: TODAY, diseases: DISEASES, countries: COUNTRIES };
  const ok = R.checkItem(item('a1'), ctx);
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.diseaseId, 'disease.dengue');
  assert.deepEqual(ok.iso2s, ['VN']);

  const future = R.checkItem(item('a2', { publishedAt: '2026-10-14' }), ctx);
  assert.equal(future.errors.length, 1);
  assert.equal(future.errors[0].field, 'publishedAt');
  assert.match(future.errors[0].message, /明天以後/);
  assert.deepEqual(R.checkItem(item('a3', { publishedAt: '2026-10-13T23:00:00+08:00' }), ctx).errors, [], '今天稍晚仍可');

  const bad = R.checkItem({ id: 'a 4', headline: 'x'.repeat(121), areas: [{ country: '越南', iso2: 'vn' }] }, ctx);
  const fields = bad.errors.map((e) => e.field);
  for (const f of ['id', 'publishedAt', 'headline', 'body', 'disease', 'areas[0].iso2']) assert.ok(fields.includes(f), `${f}：${JSON.stringify(bad.errors)}`);
  for (const e of bad.errors) assert.ok(e.label && e.message && !/undefined/.test(e.message), JSON.stringify(e));
  assert.match(bad.errors.find((e) => e.field === 'headline').message, /121 字，上限 120 字/);

  assert.deepEqual(R.checkItem({ id: 'gone', status: 'withdrawn' }, ctx).errors, []);
  const um = R.checkItem(item('a5', { disease: '不明原因發燒群聚', areas: [{ country: '亞特蘭提斯' }, { country: '全球' }] }), ctx);
  assert.deepEqual(um.errors, []);
  assert.deepEqual(
    um.unmapped.map((u) => [u.kind, u.value]),
    [
      ['disease', '不明原因發燒群聚'],
      ['country', '亞特蘭提斯'],
    ],
    '全球不算對不上',
  );
});

test('schema：不符 schema 的單則退回、附白話原因，其他照常上架', () => {
  const items = [item('s1'), item('s2'), item('s3'), item('s4'), item('s5'), item('s6', { severity: 5, areas: [{ detail: '沒有國家' }] })];
  const p = plan(null, items, { mode: 'delta' });
  assert.equal(p.held, false);
  assert.equal(p.report.counts.rejected, 1);
  assert.equal(p.report.rejected[0].id, 's6');
  assert.ok(p.report.rejected[0].errors.some((m) => /等級只能是/.test(m)));
  assert.ok(p.report.rejected[0].errors.some((m) => /國家名稱（country）或 ISO 國碼/.test(m)));
  assert.deepEqual(p.changes.new, ['s1', 's2', 's3', 's4', 's5']);
  const v = validateFeed(
    feedOf([
      { id: 'x', status: 'published', publishedAt: '2026-10-01', disease: 'a', headline: 'h', body: 'b', areas: [{ iso2: 'VN' }], sourceUrl: 'ftp://x' },
    ]),
    { today: TODAY, ...CTX },
  );
  assert.ok(v.results[0].errors.some((e) => e.field === 'sourceUrl'));
  const env = validateFeed({ version: '2', items: [] }, { today: TODAY, ...CTX });
  assert.equal(env.envelopeErrors.length, 1);
});

test('同一批重複的 id 以最後一筆為準（記警告）', () => {
  const p = plan(null, [item('d1', { headline: '舊' }), item('d1', { headline: '新' })], { mode: 'delta' });
  assert.equal(p.snapshotRows.length, 1);
  assert.equal(p.snapshotRows[0].headline, '新');
  assert.ok(p.report.warnings.some((w) => /不只一次/.test(w.message)));
});

test('個資：內文疑似含手機號碼 ⇒ 該則退回，紀錄只有遮罩值', () => {
  const p = plan(null, [item('p1', { body: '請洽承辦人 0912-345-678' }), ...['p2', 'p3', 'p4', 'p5', 'p6'].map((id) => item(id))], { mode: 'delta' });
  assert.equal(p.report.counts.rejected, 1);
  const rj = p.report.rejected[0];
  assert.equal(rj.id, 'p1');
  assert.match(rj.errors.join(), /個資/);
  assert.doesNotMatch(JSON.stringify(p.report), /0912-345-678/);
});

// ── 整批把關 ──
test('退回超過 20% ⇒ 整批保留（held）：快照不覆寫、只寫紀錄', () => {
  const current = { meta: { mode: 'live', label: 'x' }, data: plan(null, [item('c1'), item('c2')], { mode: 'delta' }).snapshotRows };
  const items = [item('n1'), item('n2'), item('n3'), item('n4', { publishedAt: '2026-12-01' })]; // 1/4＝25%
  const p = plan(current, items, { mode: 'delta' });
  assert.equal(p.held, true);
  assert.match(p.report.held.reasons.join(), /退回 1／4 則（25%），超過 20%/);
  assert.deepEqual(p.snapshotRows, current.data);
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, SNAPSHOT_FILE), JSON.stringify(current));
  const before = fs.readFileSync(path.join(dir, SNAPSHOT_FILE), 'utf8');
  const r = applyImport(p, { snapshotsDir: dir });
  assert.equal(fs.readFileSync(path.join(dir, SNAPSHOT_FILE), 'utf8'), before, '快照不動');
  assert.deepEqual(r.wrote, [path.join(dir, RECORD_FILE)]);
  const rec = JSON.parse(fs.readFileSync(path.join(dir, RECORD_FILE), 'utf8'));
  assert.ok(rec.lastRun.held.reasons.length);
  assert.equal(rec.lastRun.wroteSnapshot, false);
  assert.equal(rec.history.length, 1);
  // 剛好 20% 不保留
  assert.equal(plan(current, [...['m1', 'm2', 'm3', 'm4'].map((id) => item(id)), item('m5', { publishedAt: '2026-12-01' })], { mode: 'delta' }).held, false);
});

test('full 模式：會讓現行清單少掉一半以上 ⇒ held；收到 0 則 ⇒ held', () => {
  const current = plan(
    null,
    ['f1', 'f2', 'f3', 'f4'].map((id) => item(id)),
    { mode: 'delta' },
  ).snapshotRows;
  const half = plan(current, [item('f1'), item('f2')]);
  assert.equal(half.held, true);
  assert.match(half.report.held.reasons.join(), /從 4 則變成 2 則/);
  assert.equal(half.snapshotRows.length, 4);
  const one = plan(
    current,
    ['f1', 'f2', 'f3'].map((id) => item(id)),
  );
  assert.equal(one.held, false, '少 1／4 不保留');
  assert.deepEqual(one.changes.withdrawn, [{ id: 'f4', reason: 'missing' }]);
  const empty = plan(current, []);
  assert.equal(empty.held, true);
  assert.match(empty.report.held.reasons.join(), /0 則/);
  assert.equal(plan(current, [], { mode: 'delta' }).held, false, 'delta 收到 0 則＝沒有變動');
});

test('未來日期的那則退回；已在清單上的同一則保留上一版', () => {
  const current = plan(
    null,
    ['u1', 'u2', 'u3', 'u4', 'u5', 'u6'].map((id) => item(id)),
    { mode: 'delta' },
  ).snapshotRows;
  const p = plan(current, ['u1', 'u2', 'u3', 'u4', 'u5'].map((id) => item(id)).concat(item('u6', { headline: '改壞了', publishedAt: '2027-01-01' })));
  assert.equal(p.held, false);
  assert.equal(p.report.rejected[0].id, 'u6');
  assert.equal(p.snapshotRows.find((r) => r.id === 'u6').headline, '越南-登革熱 u6');
  assert.deepEqual(p.changes.withdrawn, []);
});

test('withdrawn 從現行清單移除；已過下架時間也移除；delta 模式沒送來的照舊', () => {
  const current = plan(
    null,
    ['w1', 'w2', 'w3', 'w4'].map((id) => item(id)),
    { mode: 'delta' },
  ).snapshotRows;
  const p = plan(current, [{ id: 'w1', status: 'withdrawn' }, item('w2', { expiresAt: '2026-10-12' })], { mode: 'delta' });
  assert.equal(p.held, false);
  assert.deepEqual(p.changes.withdrawn, [
    { id: 'w1', reason: 'withdrawn' },
    { id: 'w2', reason: 'expired' },
  ]);
  assert.deepEqual(p.snapshotRows.map((r) => r.id).sort(), ['w3', 'w4']);
});

test('與上次完全相同 ⇒ unchanged、noop，兩個檔都不寫（不產生 commit）；內容改了 ⇒ updated', () => {
  const dir = tmpDir();
  const items = ['k1', 'k2', 'k3'].map((id) => item(id));
  const first = plan(null, items);
  applyImport(first, { snapshotsDir: dir });
  const snap = JSON.parse(fs.readFileSync(path.join(dir, SNAPSHOT_FILE), 'utf8'));
  assert.equal(snap.meta.source, 'feed');
  assert.equal(snap.meta.importMode, 'full');
  assert.equal(snap.meta.mode, 'live', 'meta.mode 維持 live（/travel/ 的資料狀態標籤用）');
  assert.equal(snap.meta.sourceUrl, undefined, 'feed 來源不寫網址');
  const second = planImport({ current: snap, feed: feedOf(items), today: TODAY, now: '2026-10-14T02:00:00.000Z', source: 'feed', ...CTX });
  assert.equal(second.noop, true);
  assert.deepEqual(second.changes.unchanged, ['k1', 'k2', 'k3']);
  const before = [SNAPSHOT_FILE, RECORD_FILE].map((f) => fs.readFileSync(path.join(dir, f), 'utf8'));
  const r = applyImport(second, { snapshotsDir: dir });
  assert.deepEqual(r.wrote, []);
  assert.deepEqual(
    [SNAPSHOT_FILE, RECORD_FILE].map((f) => fs.readFileSync(path.join(dir, f), 'utf8')),
    before,
  );
  const third = planImport({
    current: snap,
    feed: feedOf([item('k1', { body: '改了內文' }), items[1], items[2]]),
    today: TODAY,
    now: NOW,
    source: 'feed',
    ...CTX,
  });
  assert.deepEqual(third.changes.updated, ['k1']);
  assert.equal(third.snapshotRows.find((x) => x.id === 'k1').Summary, '改了內文');
});

test('快照列：保留既有欄位名（Disease、Country、ISO2、StartDate、Summary、Url、headline…）並新增 id、status、areas、iso2s、body、diseaseId、provenance', () => {
  const [row] = plan(null, [
    item('r1', {
      areas: [
        { country: '墨西哥', iso2: 'MX' },
        { country: '加拿大', iso2: 'CA', detail: '安大略省' },
      ],
      sourceUrl: 'https://example.gov.tw/a',
      severity: 2,
    }),
  ]).snapshotRows;
  assert.equal(row.Disease, '登革熱');
  assert.equal(row.Country, '墨西哥,加拿大');
  assert.equal(row.ISO2, 'MX');
  assert.equal(row.ISO3166, 'MX,CA');
  assert.equal(row.StartDate, '2026-10-10');
  assert.equal(row.Summary, '內文 r1');
  assert.equal(row.description, '內文 r1');
  assert.equal(row.Url, 'https://example.gov.tw/a');
  assert.equal(row.effective, '2026-10-10T08:00:00+08:00');
  assert.equal(row.LevelCode, 2);
  assert.equal(row.areaDetail, '加拿大：安大略省');
  assert.deepEqual(row.iso2s, ['MX', 'CA']);
  assert.equal(row.diseaseId, 'disease.dengue');
  assert.deepEqual(Object.keys(row.provenance).sort(), ['by', 'hash', 'importedAt', 'producer', 'source']);
});

// ── repo 內的快照（第四十三輪以舊格式跑一次匯入器重寫） ──
test('data/snapshots/travel-epidemic.json：每列有新欄位、provenance.source 為 official-export；再匯入一次＝noop', () => {
  const snap = readJSON('data/snapshots/travel-epidemic.json');
  assert.equal(snap.meta.mode, 'live');
  assert.equal(snap.meta.source, 'official-export');
  assert.ok(snap.meta.importedAt && snap.meta.producer);
  const ids = new Set();
  for (const r of snap.data) {
    assert.ok(R.ID_RE.test(r.id), r.id);
    assert.ok(!ids.has(r.id), `id 重複 ${r.id}`);
    ids.add(r.id);
    assert.equal(r.status, 'published');
    assert.ok(Array.isArray(r.areas) && Array.isArray(r.iso2s));
    assert.equal(r.provenance.source, 'official-export');
    for (const k of ['Disease', 'StartDate', 'Summary', 'headline', 'description', 'effective', 'web']) assert.ok(k in r, `${r.id} 缺 ${k}`);
  }
  const again = planImport({ current: snap, feed: parseFeed(snap, { shape: 'legacy' }), today: TODAY, now: NOW, source: 'official-export' });
  assert.equal(again.noop, true, describe(again));
  const rec = readJSON('data/snapshots/intl-epidemic-import.json');
  assert.ok(rec.lastRun && Array.isArray(rec.history) && rec.history.length <= 30);
});
const describe = (p) => JSON.stringify(p.report.counts);

// ── CLI ──
test('CLI --dry：印出結果、不寫任何檔', () => {
  const dir = tmpDir();
  fs.copyFileSync(path.join(ROOT, 'data/snapshots', SNAPSHOT_FILE), path.join(dir, SNAPSHOT_FILE));
  const before = fs.readFileSync(path.join(dir, SNAPSHOT_FILE), 'utf8');
  const r = spawnSync(
    process.execPath,
    ['scripts/intl-epidemic.mjs', 'data/samples/intl-epidemic-feed.sample.json', '--dry', '--today', TODAY, '--snapshots', dir],
    { cwd: ROOT, encoding: 'utf8' },
  );
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /新增 3/);
  assert.match(r.stdout, /不明原因發燒群聚/);
  assert.match(r.stdout, /\(dry\)/);
  assert.equal(fs.readFileSync(path.join(dir, SNAPSHOT_FILE), 'utf8'), before);
  assert.equal(fs.existsSync(path.join(dir, RECORD_FILE)), false);
  const bad = spawnSync(process.execPath, ['scripts/intl-epidemic.mjs', 'data/samples/nope.json', '--snapshots', dir], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(bad.status, 1);
});

// ── 排程拉取（fetch-data） ──
test('fetch-data：INTL_FEED_URL 有設 ⇒ 拉 v1 feed（帶 Bearer），provenance.source＝feed，網址不寫進快照；連不上 ⇒ 不改檔', async () => {
  const dir = tmpDir();
  fs.copyFileSync(path.join(ROOT, 'data/snapshots', SNAPSHOT_FILE), path.join(dir, SNAPSHOT_FILE));
  const sample = readJSON('data/samples/intl-epidemic-feed.sample.json');
  const calls = [];
  const fetchJSON = async (url, headers) => {
    calls.push({ url, headers });
    return sample;
  };
  const env = { INTL_FEED_URL: 'https://intranet.example.gov.tw/secret-feed', INTL_FEED_TOKEN: 'tkn' };
  const logs = [];
  const r = await importTravelEpidemic({ env, dry: false, fetchJSON, snapshotsDir: dir, now: NOW, logger: (m) => logs.push(m) });
  assert.equal(r.source, 'feed');
  assert.deepEqual(calls, [{ url: env.INTL_FEED_URL, headers: { Authorization: 'Bearer tkn' } }]);
  const snap = JSON.parse(fs.readFileSync(path.join(dir, SNAPSHOT_FILE), 'utf8'));
  assert.equal(snap.meta.source, 'feed');
  const added = snap.data
    .filter((x) => x.provenance?.source === 'feed')
    .map((x) => x.id)
    .sort();
  assert.deepEqual(added, ['sample-2026-1011-unknown-disease', 'sample-2026-1012-measles-multi', 'sample-2026-1013-dengue-vn']);
  const all = fs.readFileSync(path.join(dir, SNAPSHOT_FILE), 'utf8') + fs.readFileSync(path.join(dir, RECORD_FILE), 'utf8') + logs.join('\n');
  assert.doesNotMatch(all, /secret-feed|tkn/);

  // 沒設 ⇒ 官網匯出（舊格式），一樣進匯入器
  const legacyCalls = [];
  const dir2 = tmpDir();
  const cur = readJSON('data/snapshots/travel-epidemic.json');
  fs.writeFileSync(path.join(dir2, SNAPSHOT_FILE), JSON.stringify(cur));
  const r2 = await importTravelEpidemic({
    env: { INTL_FEED_URL: '' },
    dry: false,
    fetchJSON: async (url, h) => {
      legacyCalls.push([url, h]);
      return cur.data;
    },
    snapshotsDir: dir2,
    now: NOW,
    logger: () => {},
  });
  assert.equal(r2.source, 'official-export');
  assert.match(legacyCalls[0][0], /TravelEpidemic\/ExportJSON/);
  assert.deepEqual(legacyCalls[0][1], {});

  // 連不上 ⇒ 不改檔
  const dir3 = tmpDir();
  fs.writeFileSync(path.join(dir3, SNAPSHOT_FILE), JSON.stringify(cur));
  const r3 = await importTravelEpidemic({
    env,
    dry: false,
    fetchJSON: async () => {
      throw new Error(`fetch failed ${env.INTL_FEED_URL}`);
    },
    snapshotsDir: dir3,
    now: NOW,
    logger: (m) => logs.push(m),
  });
  assert.equal(r3.ok, false);
  assert.doesNotMatch(r3.error, /secret-feed/);
  assert.equal(fs.readFileSync(path.join(dir3, SNAPSHOT_FILE), 'utf8'), JSON.stringify(cur));
  assert.equal(fs.existsSync(path.join(dir3, RECORD_FILE)), false);
});

// ── 治理待辦 ──
test('治理：匯入紀錄 held ⇒ intl-feed-held（high）；對不上主檔 ⇒ intl-feed-unmapped（medium），owner 疫情中心', () => {
  const dir = tmpDir();
  const p = plan(null, [item('g1', { disease: '不明原因發燒群聚' }), item('g2', { areas: [{ country: '亞特蘭提斯' }] }), item('g3')], { mode: 'delta' });
  const { record } = applyImport(p, { snapshotsDir: dir });
  const held = { ...record.lastRun, held: { reasons: ['測試：退回 3／5 則（60%），超過 20%'] } };
  const site = govern(TODAY, (s) => {
    s.snapshots.intlImport = { version: 1, lastRun: held, history: [] };
  });
  const todos = site.gov.todos.filter((t) => t.kind.startsWith('intl-feed-'));
  const h = todos.find((t) => t.kind === 'intl-feed-held');
  const u = todos.find((t) => t.kind === 'intl-feed-unmapped');
  assert.ok(h && u, JSON.stringify(todos));
  assert.equal(h.owner, 'unit.epidemic-intelligence');
  assert.equal(h.severity, 'high');
  assert.match(h.text, /整批保留/);
  assert.equal(u.severity, 'medium');
  assert.match(u.text, /不明原因發燒群聚/);
  assert.match(u.text, /亞特蘭提斯/);
  assert.match(u.text, /2 則/);
  assert.equal(h.kindLabel, '國際疫情匯入整批保留');
  // 缺紀錄檔 ⇒ 沒有這兩種待辦、不出錯
  const none = govern(TODAY, (s) => {
    s.snapshots.intlImport = { version: 1, lastRun: null, history: [] };
  });
  assert.equal(none.gov.todos.filter((t) => t.kind.startsWith('intl-feed-')).length, 0);
});
