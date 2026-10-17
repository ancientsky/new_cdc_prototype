// 第五十七輪：登革熱地圖整合（docs/denguemap-integration.md）。
//   一、深連結 denguemapLink：視圖、county、type、country 白名單；語言對應（繁中不帶、其他語言 lang=en、嵌入必帶 zh|en）。
//   二、快照：summary＋manifest 嚴格驗證、先 Pages 版再 raw 版、抓不到保留既有快照、大小上限、dataset lastUpdated 同步。
//   三、疫情小卡：48 小時、cases stale、今年 cases-shortfall ⇒ 不顯示數字（舊年份的短缺不影響）；七語都有字串。
//   四、嵌入區塊、CSP frame-src 由設定推出並去重、連結檢查把 /denguemap/ 當外部、資料目錄與專區內容的治理欄位。
import './helpers.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../site.config.mjs';
import { loadSite } from '../scripts/lib/load.mjs';
import { applyGovernance } from '../scripts/lib/governance.mjs';
import { makeCtx } from '../scripts/lib/pages.mjs';
import { STRINGS } from '../src/client/i18n.js';
import { denguemapLink, denguemapButton } from '../src/templates/public/_partials.mjs';
import { denguemapCard, denguemapEmbed, DENGUEMAP_OF_DISEASE } from '../src/templates/public/_denguemap.mjs';
import {
  validateSummary,
  validateManifest,
  buildSnapshot,
  fetchDenguemap,
  fetchTextCapped,
  importDenguemap,
  denguemapState,
  taipeiMinute,
  isIsoDate,
  SNAPSHOT_FILE,
  MAX_BYTES,
} from '../scripts/lib/denguemap.mjs';
import { syncDenguemapDataset } from '../scripts/fetch-data.mjs';
import { securityHeaders } from '../scripts/lib/emit-headers.mjs';
import { siblingPrefixes } from '../scripts/lib/check-internal-links.mjs';
import { denguemapHref } from '../src/client/answer/structured.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'r57-'));
const MAP = 'https://ancientsky.github.io/denguemap/';

const SUMMARY = {
  asOf: '2026-10-17',
  latestOnset: '2026-10-14',
  year: 2026,
  ytd: { local: 14, imported: 186 },
  last7: { local: 0, imported: 5 },
  last14: { local: 2, imported: 18 },
  last30: { local: 3, imported: 33 },
  prevYtd: { local: 23, imported: 175 },
  byCounty: { 64000: { local: 10, imported: 32 }, 10013: { local: 2, imported: 3 }, 10007: { local: 2, imported: 15 } },
  topTowns14: [
    ['10013010', 2, 0],
    ['64000050', 0, 2],
  ],
};
const MANIFEST = {
  schema: 1,
  generatedAt: '2026-10-17T01:02:06Z',
  latestOnset: '2026-10-14',
  years: [2025, 2026],
  sources: {
    cases: { ok: true, stale: false, fetchedAt: '2026-10-17T01:02:06Z', records: 105233 },
    vector: { ok: true, stale: false, fetchedAt: '2026-10-17T01:02:06Z', records: 672 },
  },
  warnings: [],
  files: { 'summary.json': 'a1b2c3d4' },
};
const clone = (x) => structuredClone(x);
/** Prettier 會把 html`` 模板排版成多行；比對前把換行縮排收掉（不影響瀏覽器呈現的空白） */
const H = (x) =>
  x
    .toString()
    .replace(/\s*\n\s*/g, ' ')
    .replace(/ >/g, '>')
    .replace(/> </g, '><');
const NOW = Date.parse('2026-10-17T03:00:00Z');
const snap = (m = MANIFEST, s = SUMMARY) =>
  buildSnapshot({ manifest: m, summary: s, sourceUrl: `${MAP}data/summary.json`, fetchedAt: '2026-10-17T02:00:00.000Z' });

let _site;
function site() {
  if (!_site) {
    _site = loadSite(config);
    _site.today = '2026-10-01';
    applyGovernance(_site);
  }
  return _site;
}
const ctxWith = (lang, snapshot, now = NOW) => {
  const s = site();
  return makeCtx({ ...s, now, snapshots: { ...s.snapshots, denguemap: snapshot } }, lang);
};

// ───────── 一、深連結 ─────────
test('denguemapLink：視圖與參數白名單、語言對應（zh-TW 不帶、en 與其他語言 lang=en）', () => {
  const zh = makeCtx(site(), 'zh-TW');
  assert.equal(denguemapLink(zh, {}), `${MAP}#/map`);
  assert.equal(denguemapLink(zh, { view: 'map', county: '64000', type: 'local' }), `${MAP}#/map?county=64000&type=local`);
  assert.equal(denguemapLink(zh, { view: 'nope' }), `${MAP}#/map`, '不認得的視圖退回 map');
  assert.equal(denguemapLink(zh, { county: '6400', type: 'weird' }), `${MAP}#/map`, '縣市碼不是 5 碼、type 不在白名單 ⇒ 丟棄');
  assert.equal(denguemapLink(zh, { view: 'vector', type: 'local' }), `${MAP}#/vector`, 'type 只在 map／trends');
  assert.equal(denguemapLink(zh, { view: 'imported', country: 'vn' }), `${MAP}#/imported?country=vn`);
  assert.equal(denguemapLink(zh, { view: 'imported', country: 'VN' }), `${MAP}#/imported`, '國碼必須兩個小寫字母');
  assert.equal(denguemapLink(zh, { view: 'map', country: 'vn' }), `${MAP}#/map`, 'country 只在 imported');
  assert.equal(denguemapLink(makeCtx(site(), 'en'), { view: 'trends' }), `${MAP}#/trends?lang=en`);
  for (const l of ['ja', 'vi', 'id', 'th', 'tl']) assert.equal(denguemapLink(makeCtx(site(), l), {}), `${MAP}#/map?lang=en`, `${l} → lang=en（地圖只有中英）`);
  assert.equal(denguemapLink(makeCtx(site(), 'vi'), { lang: null }), `${MAP}#/map`, 'lang:null 強制不帶');
  assert.equal(denguemapLink(zh, { lang: 'en' }), `${MAP}#/map?lang=en`);
  // 嵌入：search 帶 embed、theme、lang（繁中也要明帶 zh，免得地圖依瀏覽器語言切成英文）
  assert.equal(denguemapLink(zh, { view: 'vector', embed: true, theme: 'light' }), `${MAP}?embed=1&theme=light&lang=zh#/vector`);
  assert.equal(denguemapLink(makeCtx(site(), 'th'), { view: 'map', embed: true, theme: 'blue' }), `${MAP}?embed=1&lang=en#/map`, 'theme 不在白名單 ⇒ 丟棄');
  assert.equal(denguemapLink(zh, { view: 'map', embed: true, county: '64000' }), `${MAP}?embed=1&lang=zh#/map?county=64000`);
  // 按鈕：開新視窗 ↗、sr-only、title
  const b = denguemapButton(zh, { view: 'vector', label: '蚊媒地圖' }).toString();
  assert.match(b, /target="_blank" rel="noopener" title="開新視窗">蚊媒地圖 ↗<span class="sr-only">（開新視窗）<\/span>/);
  assert.match(denguemapButton(makeCtx(site(), 'en'), { label: 'Case map' }).toString(), /\(opens in a new window\)/);
  // 答案引擎（client 端，網址寫死）同規則
  assert.equal(denguemapHref('zh-TW'), `${MAP}#/map`);
  assert.equal(denguemapHref('vi'), `${MAP}#/map?lang=en`);
  assert.equal(config.denguemapUrl, MAP);
});

// ───────── 二、快照 ─────────
test('validateSummary／validateManifest：正確資料通過、只輸出契約欄位；各種壞資料被擋', () => {
  assert.ok(isIsoDate('2026-02-28') && !isIsoDate('2026-02-30') && !isIsoDate('2026-1-01'));
  const ok = validateSummary(SUMMARY);
  assert.ok(ok.ok, ok.errors.join('；'));
  const m = validateManifest(MANIFEST);
  assert.ok(m.ok, m.errors.join('；'));
  assert.deepEqual(Object.keys(m.value), ['schema', 'generatedAt', 'latestOnset', 'sources', 'warnings']);
  assert.deepEqual(m.value.sources.cases, { ok: true, stale: false, fetchedAt: '2026-10-17T01:02:06Z' }, 'records 等非必要欄位不進快照');
  const bad = (mut) => {
    const s = clone(SUMMARY);
    mut(s);
    return validateSummary(s);
  };
  for (const [why, mut] of [
    ['負數', (s) => (s.ytd.local = -1)],
    ['小數', (s) => (s.last14.imported = 1.5)],
    ['字串數字', (s) => (s.prevYtd.local = '23')],
    ['日期格式', (s) => (s.asOf = '2026/10/17')],
    ['不存在的日期', (s) => (s.latestOnset = '2026-02-30')],
    ['發病日晚於 asOf', (s) => (s.latestOnset = '2026-10-18')],
    ['縣市碼', (s) => (s.byCounty['640'] = { local: 0, imported: 0 })],
    ['縣市合計大於今年', (s) => (s.byCounty['64000'].local = 99)],
    ['鄉鎮碼', (s) => (s.topTowns14 = [['6400009', 1, 0]])],
    ['鄉鎮數字型別', (s) => (s.topTowns14 = [[64000090, 1, 0]])],
    ['7／14／30 天不遞增', (s) => (s.last7.local = 5)],
    ['year', (s) => (s.year = 2030)],
    ['缺欄位', (s) => delete s.last30],
  ])
    assert.equal(bad(mut).ok, false, why);
  const badM = (mut) => {
    const x = clone(MANIFEST);
    mut(x);
    return validateManifest(x);
  };
  assert.equal(badM((x) => (x.generatedAt = '2026-10-17 01:02')).ok, false, 'generatedAt 要 ISO UTC');
  assert.equal(badM((x) => delete x.sources.cases).ok, false, '一定要有 cases');
  assert.equal(badM((x) => (x.sources.cases.stale = 'no')).ok, false);
  assert.equal(badM((x) => (x.warnings = [{ code: 'cases-shortfall', year: 2026, got: -1 }])).ok, false);
  assert.equal(badM((x) => (x.warnings = [{ code: '<script>' }])).ok, false);
  assert.ok(badM((x) => (x.warnings = [{ code: 'cases-shortfall', year: 2023, type: 'local', got: 951, expected: 24794 }])).ok);
  // 一新一舊：latestOnset 不同 ⇒ 不接受
  assert.throws(() => snap({ ...MANIFEST, latestOnset: '2026-10-13' }), /latestOnset 不同/);
  const sn = snap();
  assert.deepEqual(Object.keys(sn), ['schema', 'label', 'mode', 'fetchedAt', 'sourceUrl', 'manifest', 'summary']);
});

/** 假 fetch：url → { status, body } */
function fakeFetch(routes, calls = []) {
  return async (url) => {
    calls.push(url);
    const r = routes[url];
    if (!r) throw new Error('fetch failed');
    const body = typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
    return new Response(body, { status: r.status ?? 200, headers: r.headers ?? {} });
  };
}
const PAGES = config.denguemapDataUrl,
  RAW = config.denguemapRawDataUrl;

test('fetchDenguemap：先抓 Pages 版，失敗（連線、HTTP、驗證、超過大小）才抓 raw；summary 與 manifest 一定同一來源', async () => {
  const calls = [];
  const ok = await fetchDenguemap({
    bases: [PAGES, RAW],
    fetchImpl: fakeFetch({ [`${PAGES}manifest.json`]: { body: MANIFEST }, [`${PAGES}summary.json`]: { body: SUMMARY } }, calls),
    now: () => '2026-10-17T02:00:00.000Z',
  });
  assert.equal(ok.snapshot.sourceUrl, `${PAGES}summary.json`);
  assert.ok(
    calls.every((u) => u.startsWith(PAGES)),
    '第一個來源成功就不碰 raw',
  );
  // Pages 連不上（沙箱的情況）⇒ raw
  const r1 = await fetchDenguemap({
    bases: [PAGES, RAW],
    fetchImpl: fakeFetch({ [`${RAW}manifest.json`]: { body: MANIFEST }, [`${RAW}summary.json`]: { body: SUMMARY } }),
    now: () => '2026-10-17T02:00:00.000Z',
  });
  assert.equal(r1.snapshot.sourceUrl, `${RAW}summary.json`);
  assert.equal(r1.attempts.length, 1);
  // Pages 的 summary 驗證不過 ⇒ 整組改用 raw（不會 Pages 的 manifest 配 raw 的 summary）
  const broken = clone(SUMMARY);
  broken.ytd.local = -3;
  const r2 = await fetchDenguemap({
    bases: [PAGES, RAW],
    fetchImpl: fakeFetch({
      [`${PAGES}manifest.json`]: { body: MANIFEST },
      [`${PAGES}summary.json`]: { body: broken },
      [`${RAW}manifest.json`]: { body: MANIFEST },
      [`${RAW}summary.json`]: { body: SUMMARY },
    }),
    now: () => '2026-10-17T02:00:00.000Z',
  });
  assert.equal(r2.snapshot.sourceUrl, `${RAW}summary.json`);
  assert.match(r2.attempts[0].error, /驗證失敗/);
  // 全部失敗 ⇒ 丟出、列出每個來源的原因
  await assert.rejects(
    fetchDenguemap({
      bases: [PAGES, RAW],
      fetchImpl: fakeFetch({
        [`${PAGES}manifest.json`]: { status: 404, body: '' },
        [`${RAW}manifest.json`]: { body: 'not json' },
        [`${RAW}summary.json`]: { body: SUMMARY },
      }),
    }),
    (e) => e.attempts.length === 2 && /HTTP 404/.test(e.message) && /不是 JSON/.test(e.message),
  );
  // 大小上限：Content-Length 先擋；沒有 Content-Length 也邊讀邊擋
  await assert.rejects(fetchTextCapped('u', 10, { fetchImpl: fakeFetch({ u: { body: 'x'.repeat(5), headers: { 'content-length': '999' } } }) }), /超過上限/);
  await assert.rejects(fetchTextCapped('u', 10, { fetchImpl: fakeFetch({ u: { body: 'x'.repeat(50) } }) }), /超過上限/);
  assert.equal(await fetchTextCapped('u', 10, { fetchImpl: fakeFetch({ u: { body: '{"a":1}' } }) }), '{"a":1}');
  assert.ok(MAX_BYTES.summary <= 64 * 1024 && MAX_BYTES.manifest <= 256 * 1024);
});

test('importDenguemap：成功寫快照；失敗保留既有快照只記 lastLiveAttempt；從沒有快照 ⇒ mode:missing 空殼；一律不丟例外', async () => {
  const dir = tmpDir();
  const cfg = { denguemapDataUrl: PAGES, denguemapRawDataUrl: RAW };
  const logs = [];
  const good = fakeFetch({ [`${RAW}manifest.json`]: { body: MANIFEST }, [`${RAW}summary.json`]: { body: SUMMARY } });
  const r = await importDenguemap({ config: cfg, snapshotsDir: dir, fetchImpl: good, now: () => '2026-10-17T02:00:00.000Z', logger: (m) => logs.push(m) });
  assert.equal(r.ok, true);
  const saved = JSON.parse(fs.readFileSync(path.join(dir, SNAPSHOT_FILE), 'utf8'));
  assert.equal(saved.summary.ytd.local, 14);
  assert.equal(saved.manifest.generatedAt, MANIFEST.generatedAt);
  assert.ok(!('files' in saved.manifest) && !('years' in saved.manifest));
  const fail = await importDenguemap({ config: cfg, snapshotsDir: dir, fetchImpl: fakeFetch({}), now: () => '2026-10-17T05:00:00.000Z', logger: () => {} });
  assert.equal(fail.ok, false);
  const kept = JSON.parse(fs.readFileSync(path.join(dir, SNAPSHOT_FILE), 'utf8'));
  assert.deepEqual(kept.summary, saved.summary, '資料不變');
  assert.equal(kept.lastLiveAttempt.ok, false);
  assert.equal(kept.lastLiveAttempt.at, '2026-10-17T05:00:00.000Z');
  const empty = tmpDir();
  await importDenguemap({ config: cfg, snapshotsDir: empty, fetchImpl: fakeFetch({}), logger: () => {} });
  const shell = JSON.parse(fs.readFileSync(path.join(empty, SNAPSHOT_FILE), 'utf8'));
  assert.equal(shell.mode, 'missing');
  assert.equal(denguemapState(shell, { now: NOW }).state, 'missing');
  // dry：不寫檔
  const dryDir = tmpDir();
  await importDenguemap({ config: cfg, snapshotsDir: dryDir, dry: true, fetchImpl: good, now: () => '2026-10-17T02:00:00.000Z', logger: () => {} });
  assert.equal(fs.existsSync(path.join(dryDir, SNAPSHOT_FILE)), false);
});

test('syncDenguemapDataset：lastUpdated＝generatedAt 的臺北日期、provenance.fetchedAt＝抓取日，沒變不寫檔', () => {
  const dir = tmpDir();
  const src = JSON.parse(fs.readFileSync(path.join(ROOT, 'content/datasets/denguemap-summary.json'), 'utf8'));
  fs.writeFileSync(
    path.join(dir, 'denguemap-summary.json'),
    JSON.stringify({ ...src, lastUpdated: '2026-10-01', provenance: { ...src.provenance, fetchedAt: '2026-10-01' } }, null, 2) + '\n',
  );
  // 2026-10-17T17:30Z ＝ 臺北 10-18 01:30
  const s = buildSnapshot({
    manifest: { ...MANIFEST, generatedAt: '2026-10-17T17:30:00Z' },
    summary: SUMMARY,
    sourceUrl: `${RAW}summary.json`,
    fetchedAt: '2026-10-17T18:00:00.000Z',
  });
  assert.deepEqual(syncDenguemapDataset(s, { datasetsDir: dir }), ['lastUpdated', 'provenance']);
  const out = JSON.parse(fs.readFileSync(path.join(dir, 'denguemap-summary.json'), 'utf8'));
  assert.equal(out.lastUpdated, '2026-10-18');
  assert.equal(out.provenance.fetchedAt, '2026-10-17');
  assert.equal(out.provenance.mode, 'snapshot', '其他欄位不動');
  assert.deepEqual(syncDenguemapDataset(s, { datasetsDir: dir }), []);
  assert.equal(taipeiMinute('2026-10-17T01:02:06Z'), '2026-10-17 09:02');
});

test('已提交的快照通過驗證、來源是 Pages 或 raw 的 summary.json', () => {
  const sn = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/snapshots', SNAPSHOT_FILE), 'utf8'));
  assert.ok(validateSummary(sn.summary).ok && validateManifest(sn.manifest).ok);
  assert.ok([`${PAGES}summary.json`, `${RAW}summary.json`].includes(sn.sourceUrl));
  assert.equal(sn.manifest.latestOnset, sn.summary.latestOnset);
  assert.equal(site().snapshots.denguemap.summary.year, sn.summary.year, 'loadSite 讀得到');
});

// ───────── 三、疫情小卡 ─────────
test('denguemapState：48 小時、cases stale／ok:false、今年 cases-shortfall ⇒ stale；舊年份短缺不影響', () => {
  const s0 = snap();
  assert.deepEqual(denguemapState(s0, { now: NOW, maxAgeHours: 48 }).state, 'ok');
  assert.equal(denguemapState(s0, { now: Date.parse('2026-10-19T01:02:06Z'), maxAgeHours: 48 }).state, 'ok', '剛好 48 小時仍算新');
  assert.deepEqual(denguemapState(s0, { now: Date.parse('2026-10-19T01:03:00Z'), maxAgeHours: 48 }).reasons, ['too-old']);
  const m1 = clone(MANIFEST);
  m1.sources.cases = { ok: false, stale: true, fetchedAt: '2026-10-16T01:00:00Z' };
  assert.deepEqual(denguemapState(snap(m1), { now: NOW }).reasons, ['cases-stale']);
  const m2 = clone(MANIFEST);
  m2.warnings = [{ code: 'cases-shortfall', year: 2026, type: 'local', got: 3, expected: 14 }];
  assert.deepEqual(denguemapState(snap(m2), { now: NOW }).reasons, ['cases-shortfall']);
  const m3 = clone(MANIFEST);
  m3.warnings = [
    { code: 'cases-shortfall', year: 2023, type: 'local', got: 951, expected: 24794 },
    { code: 'imported-shortfall', got: 294, expected: 894 },
  ];
  assert.equal(denguemapState(snap(m3), { now: NOW }).state, 'ok', '2023 年的歷史短缺不影響今年的數字');
  assert.equal(denguemapState(null, { now: NOW }).state, 'missing');
  assert.equal(denguemapState({ manifest: { bad: 1 }, summary: SUMMARY }, { now: NOW }).state, 'missing', '快照被手改壞 ⇒ 當作沒有');
});

test('疫情小卡：ok 顯示今年／去年同期／近 14 天／最新發病日／資料時間（臺北）＋來源卡（疫情中心、非官方站）；stale 不出現任何數字', () => {
  const html = H(denguemapCard(ctxWith('zh-TW', snap())));
  assert.match(html, /data-denguemap-state="ok"/);
  assert.match(
    html,
    /2026 年本土病例<\/dt><dd><b class="c-dmcard__n">14<\/b><span class="c-dmcard__u">例<\/span><span class="c-dmcard__sub">2025 年同期 23 例<\/span>/,
  );
  assert.match(html, /2026 年境外移入病例<\/dt><dd><b class="c-dmcard__n">186</);
  assert.match(html, /近 14 天本土病例<\/dt><dd><b class="c-dmcard__n">2</);
  assert.match(html, /近 14 天境外移入病例<\/dt><dd><b class="c-dmcard__n">18</);
  assert.match(html, /最新發病日<\/b><time datetime="2026-10-14">2026-10-14<\/time>/);
  assert.match(html, /資料時間<\/b><time datetime="2026-10-17T01:02:06Z">2026-10-17 09:02<\/time>（臺北時間）/);
  assert.match(html, /近 14 天有本土病例的鄉鎮市區<\/b> 1</, '只數本土 > 0 的鄉鎮');
  assert.match(html, /<dt>Owner<\/dt><dd>疫情中心<\/dd>/);
  assert.match(html, /登革熱地圖（概念原型、非官方站）/);
  assert.match(html, /href="https:\/\/ancientsky\.github\.io\/denguemap\/#\/map\?type=local" target="_blank"/);
  assert.match(html, /href="[^"]*\/topics\/denguemap\/">登革熱地圖專區 →/);
  for (const [why, m] of [
    ['too-old', MANIFEST],
    ['cases-shortfall', { ...clone(MANIFEST), warnings: [{ code: 'cases-shortfall', year: 2026, type: 'imported', got: 1, expected: 186 }] }],
  ]) {
    const now = why === 'too-old' ? Date.parse('2026-10-20T00:00:00Z') : NOW;
    const h = H(denguemapCard(ctxWith('zh-TW', snap(m), now)));
    assert.match(h, /data-denguemap-state="stale"/, why);
    assert.match(h, /資料更新中，請開啟登革熱地圖查看。/);
    assert.ok(!/c-dmcard__n/.test(h) && !/>14</.test(h) && !/186/.test(h), `${why}：不顯示任何數字`);
    assert.match(h, /開啟登革熱地圖 ↗/);
  }
  assert.match(H(denguemapCard(ctxWith('zh-TW', snap(), Date.parse('2026-10-20T00:00:00Z')))), /最近一次取得的資料已超過 48 小時。/);
  assert.match(H(denguemapCard(ctxWith('zh-TW', null))), /data-denguemap-state="missing"[\s\S]*尚未取得登革熱地圖的資料/);
});

test('疫情小卡七語：每個 denguemap.* 字串七語齊備（英文單位刻意留空）；英文頁沒有中文介面字、日期依語言格式', () => {
  const keys = Object.keys(STRINGS['zh-TW']).filter((k) => k.startsWith('denguemap.'));
  assert.ok(keys.length >= 30);
  for (const l of ['en', 'ja', 'tl', 'vi', 'id', 'th']) for (const k of keys) assert.ok(k in STRINGS[l], `${l} ${k}`);
  assert.equal(STRINGS.en['denguemap.unit'], '');
  const en = H(denguemapCard(ctxWith('en', snap())));
  assert.match(en, /Local cases in 2026<\/dt><dd><b class="c-dmcard__n">14<\/b><span class="c-dmcard__sub">Same period in 2025: 23/);
  assert.match(en, /Latest onset date<\/b><time datetime="2026-10-14">Oct 14, 2026/);
  assert.match(en, /\(Taipei time\)/);
  const enText = en.replace(/<[^>]+>/g, ' ');
  assert.ok(!/[一-鿿]/.test(enText.replace(/疫情中心/g, '')), `英文小卡不應有中文（權責單位名稱除外）：${enText.match(/[一-鿿]+/g)}`);
  for (const l of ['vi', 'th', 'ja'])
    assert.match(H(denguemapCard(ctxWith(l, snap()))), /#\/map\?type=local&amp;lang=en|#\/map\?type=local&lang=en/, `${l} 的按鈕帶 lang=en`);
});

test('疾病頁入口：登革熱疫情區塊有小卡、屈公病預防區塊有蚊媒地圖；專區頁嵌入與 iframe 屬性', () => {
  assert.deepEqual(DENGUEMAP_OF_DISEASE['disease.dengue'], { card: true });
  assert.equal(DENGUEMAP_OF_DISEASE['disease.chikungunya'].vectorIn, 'prevention');
  const ids = site().collections.diseases.map((d) => d.id);
  for (const id of Object.keys(DENGUEMAP_OF_DISEASE)) assert.ok(ids.includes(id), id);
  const zh = ctxWith('zh-TW', snap());
  const e = H(denguemapEmbed(zh, { views: ['map', 'vector', 'imported', 'bogus'] }));
  assert.match(
    e,
    /<iframe class="c-dmembed__frame" id="denguemap-frame" name="denguemap-frame" src="https:\/\/ancientsky\.github\.io\/denguemap\/\?embed=1&amp;theme=light&amp;lang=zh#\/map"/,
  );
  for (const attr of [
    'title="登革熱地圖：病例地圖（嵌入）"',
    'loading="lazy"',
    'referrerpolicy="no-referrer"',
    'allow="fullscreen"',
    'sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"',
  ])
    assert.ok(e.includes(attr), attr);
  assert.equal((e.match(/data-dm-view=/g) ?? []).length, 3, '不認得的視圖被丟掉');
  assert.match(e, /href="[^"]*embed=1[^"]*#\/vector" target="denguemap-frame"/, '切換用 target 指向 iframe，沒有 JS 也能切');
  assert.match(e, /<noscript>/);
  assert.match(e, /地圖沒有顯示？ <a id="dm-full" href="https:\/\/ancientsky\.github\.io\/denguemap\/#\/map" target="_blank"/);
  assert.match(e, /class="skip-link c-dmembed__skip" href="#dmembed-after"/);
  assert.match(H(denguemapEmbed(ctxWith('en', snap()))), /\?embed=1&amp;theme=light&amp;lang=en#\/map/);
  // 專區內容：治理欄位齊全、嵌入設定
  const tp = site().byId.get('topic.denguemap');
  assert.ok(tp && tp.status === 'published');
  for (const k of ['owner', 'publishedAt', 'reviewedAt', 'reviewPeriodMonths', 'audience', 'sensitivity', 'license', 'languages', 'summary'])
    assert.ok(tp[k] != null, k);
  assert.equal(tp.owner, 'unit.epidemic-intelligence');
  assert.deepEqual(tp.embed, { kind: 'denguemap', views: ['map', 'clusters', 'vector', 'imported'], card: true });
  assert.ok(!JSON.stringify(tp.embed).includes('http'), '嵌入網址由 site.config 推出，內容檔不寫網址');
});

test('資料目錄：dataset.denguemap-summary 的正本、頻率（daily＝容許 2 天＝小卡 48 小時）與權責', () => {
  const ds = site().byId.get('dataset.denguemap-summary');
  assert.ok(ds);
  assert.equal(ds.canonicalUrl, `${PAGES}summary.json`);
  assert.equal(ds.updateFrequency, 'daily');
  assert.equal(config.denguemapMaxAgeHours, 48);
  assert.equal(ds.owner, 'unit.epidemic-intelligence');
  assert.equal(ds.provenance.mode, 'snapshot');
  assert.ok(ds.diseases.includes('disease.dengue'));
  assert.ok(ds.gov && ds.gov.datasetOverdue === false);
});

// ───────── 四、CSP 與連結檢查 ─────────
test('CSP frame-src：地圖來源由設定推出並去重（原型與 vaxmap 同源 ⇒ 字串不變）；換網域時自動加入', () => {
  const csp = securityHeaders()['Content-Security-Policy'];
  assert.match(csp, /frame-src https:\/\/ancientsky\.github\.io https:\/\/www\.youtube-nocookie\.com https:\/\/www\.youtube\.com;/);
  assert.equal((csp.match(/ancientsky\.github\.io/g) ?? []).length, 1, '同源只出現一次');
  const prod = securityHeaders({ denguemapOrigin: 'https://denguemap.cdc.gov.tw' })['Content-Security-Policy'];
  assert.match(prod, /frame-src https:\/\/ancientsky\.github\.io https:\/\/denguemap\.cdc\.gov\.tw https:\/\/www\.youtube-nocookie\.com/);
  assert.match(prod, /frame-ancestors 'self'/);
  assert.deepEqual(siblingPrefixes('https://ancientsky.github.io', [config.vaxmapUrl, config.vaxmapInfoUrl, config.denguemapUrl]), [
    '/vaxmap-next/',
    '/denguemap/',
  ]);
  for (const f of ['scripts/build.mjs', 'scripts/lib/check-internal-links.mjs'])
    assert.match(fs.readFileSync(path.join(ROOT, f), 'utf8'), /siblingUrls: \[config\.vaxmapUrl, config\.vaxmapInfoUrl, config\.denguemapUrl\]/, f);
});

test('pages.yml：每次建置前重抓登革熱地圖（失敗不擋建置）；文件存在', () => {
  const y = fs.readFileSync(path.join(ROOT, '.github/workflows/pages.yml'), 'utf8');
  assert.match(
    y,
    /- name: Refresh dengue map summary[^\n]*\n\s+if: steps\.refresh\.outputs\.refresh != 'true'\n\s+run: node scripts\/fetch-data\.mjs --denguemap\n\s+continue-on-error: true/,
  );
  assert.ok(y.indexOf('fetch-data.mjs --denguemap') < y.indexOf('run: npm run build'), '在建置之前');
  const doc = fs.readFileSync(path.join(ROOT, 'docs/denguemap-integration.md'), 'utf8');
  for (const h of ['## 0.', '## 1.', '## 2.', '## 3.', '## 4.', '## 5.']) assert.ok(doc.includes(h), h);
});

// ───────── dist（若已建置）─────────
test(
  'dist（若已建置）：登革熱頁有小卡、屈公病頁有蚊媒地圖、專區頁中英都有 iframe、headers 的 frame-src',
  { skip: !fs.existsSync(path.join(ROOT, 'dist/diseases/dengue/index.html')) },
  () => {
    const read = (p) => fs.readFileSync(path.join(ROOT, 'dist', p), 'utf8');
    for (const p of ['diseases/dengue/index.html', 'en/diseases/dengue/index.html', 'vi/diseases/dengue/index.html'])
      assert.match(read(p), /id="denguemap-card"[^>]*data-denguemap-state="(ok|stale|missing)"/, p);
    assert.match(read('diseases/chikungunya/index.html'), /denguemap\/#\/vector"[^>]*target="_blank"/);
    for (const p of ['topics/denguemap/index.html', 'en/topics/denguemap/index.html'])
      assert.match(read(p), /<iframe\s+class="c-dmembed__frame"[^>]*loading="lazy"/, p);
    assert.match(read('topics/denguemap.md'), /## 互動地圖/);
    assert.match(read('diseases/dengue.md'), /登革熱地圖（概念原型、非官方站）/);
    if (fs.existsSync(path.join(ROOT, 'dist/headers/headers.json')))
      assert.match(JSON.parse(read('headers/headers.json')).headers['Content-Security-Policy'], /frame-src https:\/\/ancientsky\.github\.io /);
  },
);
