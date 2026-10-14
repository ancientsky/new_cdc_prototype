// 第四十九輪（Issue #103）：專業版索引差異分片。
//   - 純函式 diffProIndex／applyProDelta：順序、omit、內容不同、指紋不符、位置不合理
//   - dist：民眾版分片 + 差異分片 ＝ 完整專業版分片（逐位元，含順序）；完整的 -pro 檔與 v1/index.json 清單、openapi 都還在
//   - data.js proIndexShards（以假的 document／fetch 在 Node 執行）：合併結果與完整專業版分片相同；差異分片缺檔或對不上時退回完整分片
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRO_DELTA_BASE, applyProDelta, diffProIndex, proDeltaShardNames } from '../src/client/answer/index-delta.js';
import { buildProDeltaShards } from '../scripts/lib/index-builder.mjs';
import { config } from './helpers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = process.env.DIST_DIR ? path.resolve(process.env.DIST_DIR) : path.join(ROOT, 'dist');
const hasDist = fs.existsSync(path.join(DIST, 'v1/search-index-pro-delta.zh-TW.json'));
const c = (id, extra = {}) => ({ id, lang: 'zh-TW', text: id, ...extra });
const readV1 = (name) => JSON.parse(fs.readFileSync(path.join(DIST, 'v1', `${name}.json`), 'utf8'));

test('diffProIndex／applyProDelta：專業版獨有片段插回原位置（順序一致）；不修改輸入', () => {
  const pub = [c('a'), c('b'), c('c'), c('d')];
  const pro = [c('x1'), c('a'), c('b'), c('x2'), c('c'), c('d'), c('x3')];
  const snapshot = JSON.stringify([pub, pro]);
  const delta = diffProIndex(pub, pro);
  assert.deepEqual(delta.at, [0, 3, 6]);
  assert.deepEqual(delta.chunks.map((x) => x.id), ['x1', 'x2', 'x3']);
  assert.deepEqual(delta.omit, []);
  assert.deepEqual(delta.base, { count: 4, first: 'a', last: 'd' });
  assert.deepEqual(applyProDelta(pub, delta), pro);
  assert.equal(JSON.stringify([pub, pro]), snapshot, '輸入不被修改');
  // 經過 JSON 來回（真正的檔案）也一樣
  assert.deepEqual(applyProDelta(pub, JSON.parse(JSON.stringify(delta))), pro);
});

test('diffProIndex：民眾版有而專業版沒有（omit）、同 id 但內容不同（以專業版為準）、完全相同（空差異）', () => {
  const pub = [c('a'), c('b'), c('c')];
  const pro = [c('a'), c('b', { text: '專業版改過' }), c('z')];
  const d = diffProIndex(pub, pro);
  assert.deepEqual(d.omit, ['b', 'c']);
  assert.deepEqual(d.chunks.map((x) => x.id), ['b', 'z']);
  assert.deepEqual(applyProDelta(pub, d), pro);
  const same = diffProIndex(pub, pub.map((x) => ({ ...x })));
  assert.deepEqual([same.at, same.chunks, same.omit], [[], [], []]);
  assert.deepEqual(applyProDelta(pub, same), pub);
  assert.deepEqual(applyProDelta([], diffProIndex([], [])), []);
});

test('applyProDelta：版本、指紋、位置不合理時回傳 null（呼叫端退回完整專業版分片）', () => {
  const pub = [c('a'), c('b')];
  const d = diffProIndex(pub, [c('a'), c('x'), c('b')]);
  assert.ok(applyProDelta(pub, d));
  assert.equal(applyProDelta([c('a')], d), null, '民眾版分片筆數不同（快取新舊錯位）');
  assert.equal(applyProDelta([c('a'), c('B')], d), null, '最後一筆 id 不同');
  assert.equal(applyProDelta(pub, { ...d, v: 2 }), null, '不認得的格式版本');
  assert.equal(applyProDelta(pub, { ...d, at: [5] }), null, '位置超出範圍');
  assert.equal(applyProDelta(pub, { ...d, at: [1, 1], chunks: [c('x'), c('y')] }), null, '位置重複／不遞增');
  assert.equal(applyProDelta(pub, null), null);
  assert.equal(applyProDelta(null, d), null);
  assert.equal(applyProDelta(pub, { ...d, at: [] }), null, 'at 與 chunks 長度不同');
});

test('buildProDeltaShards：逐語言驗證；專業版與民眾版對不上時建置丟錯', () => {
  const si = { public: [c('a'), c('b'), c('e1', { lang: 'en' })], pro: [c('a'), c('p'), c('b'), c('e1', { lang: 'en' })] };
  const out = buildProDeltaShards(si, ['zh-TW', 'en', 'ja']);
  assert.deepEqual(Object.keys(out), ['zh-TW', 'en', 'ja']);
  assert.deepEqual(out['zh-TW'].chunks.map((x) => x.id), ['p']);
  assert.deepEqual([out.en.chunks.length, out.ja.chunks.length], [0, 0]);
  assert.deepEqual(proDeltaShardNames('zh-TW'), [`${PRO_DELTA_BASE}.zh-TW`]);
  assert.deepEqual(proDeltaShardNames('en'), [`${PRO_DELTA_BASE}.zh-TW`, `${PRO_DELTA_BASE}.en`]);
});

test('dist：每個語言「民眾版分片 + 差異分片」逐位元等於完整專業版分片；完整檔照舊輸出並列在 v1/index.json 與 openapi', (tc) => {
  if (!hasDist) return tc.skip('dist 尚未建置');
  for (const { code } of config.langs) {
    const pub = readV1(`search-index.${code}`).data;
    const pro = readV1(`search-index-pro.${code}`).data;
    const deltaFile = readV1(`${PRO_DELTA_BASE}.${code}`);
    assert.equal(deltaFile.meta.lang, code);
    assert.equal(deltaFile.meta.deltaOf, `/v1/search-index.${code}.json`);
    assert.equal(deltaFile.meta.count, deltaFile.data.chunks.length);
    assert.equal(JSON.stringify(applyProDelta(pub, deltaFile.data)), JSON.stringify(pro), `${code} 合併結果與完整專業版分片不同`);
    assert.ok(fs.statSync(path.join(DIST, `v1/search-index-pro.${code}.json`)).size > 0);
  }
  assert.ok(fs.existsSync(path.join(DIST, 'v1/search-index-pro.json')), '對外的完整專業版索引照舊輸出');
  const zhDelta = readV1(`${PRO_DELTA_BASE}.zh-TW`).data;
  assert.ok(zhDelta.chunks.length > 100 && zhDelta.chunks.every((x) => !readV1('search-index.zh-TW').data.some((p) => p.id === x.id)), '中文差異分片只有專業獨有片段');
  const listed = readV1('index').data.map((x) => x.path);
  for (const { code } of config.langs) assert.ok(listed.includes(`/v1/${PRO_DELTA_BASE}.${code}.json`), `v1/index.json 列出 ${code} 差異分片`);
  assert.ok(JSON.parse(fs.readFileSync(path.join(DIST, 'openapi.json'), 'utf8')).paths[`/v1/${PRO_DELTA_BASE}.{lang}.json`], 'openapi 有差異分片');
  assert.ok(readV1('search').data.proDeltaShards['zh-TW'], 'v1/search.json 列出差異分片網址');
});

// ───────────────────────── data.js proIndexShards（假 document／fetch） ─────────────────────────
async function loadData(lang, fetchImpl) {
  const saved = { document: globalThis.document, window: globalThis.window, fetch: globalThis.fetch, location: globalThis.location };
  globalThis.document = { documentElement: { lang, dataset: { base: '' } } };
  globalThis.window = {};
  globalThis.location = { search: '' };
  globalThis.fetch = fetchImpl;
  try { return await import(`../src/client/answer/data.js?lang=${lang}&t=${Math.random()}`); } finally {
    // data.js 在載入時就讀完 document／window，之後 proIndexShards 只用 fetch；還原其餘全域，fetch 留著到測試結束
    globalThis.document = saved.document; globalThis.window = saved.window; globalThis.location = saved.location;
    globalThis.__savedFetch = saved.fetch;
  }
}
const distFetch = (overrides = {}, seen = []) => async (url) => {
  const m = /\/v1\/(.+)\.json$/.exec(String(url));
  seen.push(m?.[1]);
  if (m && m[1] in overrides) return overrides[m[1]];
  const f = m && path.join(DIST, 'v1', `${m[1]}.json`);
  if (!f || !fs.existsSync(f)) return { ok: false, status: 404, json: async () => ({}) };
  return { ok: true, status: 200, json: async () => JSON.parse(fs.readFileSync(f, 'utf8')) };
};
const restoreFetch = () => { if ('__savedFetch' in globalThis) { globalThis.fetch = globalThis.__savedFetch; delete globalThis.__savedFetch; } };

test('data.js proIndexShards：zh-TW 與 en（中文在前）合併結果等於完整專業版分片；只下載民眾版分片與差異分片', async (tc) => {
  if (!hasDist) return tc.skip('dist 尚未建置');
  try {
    for (const lang of ['zh-TW', 'en']) {
      const seen = [];
      const data = await loadData(lang, distFetch({}, seen));
      const got = await data.proIndexShards();
      const want = (lang === 'zh-TW' ? ['zh-TW'] : ['zh-TW', lang]).flatMap((l) => readV1(`search-index-pro.${l}`).data);
      assert.equal(JSON.stringify(got), JSON.stringify(want), `${lang} 專業版索引與完整分片不同`);
      assert.ok(!seen.some((n) => n?.startsWith('search-index-pro.')), `${lang}：不下載完整專業版分片（${seen}）`);
      assert.ok(seen.includes('search-index-pro-delta.zh-TW') && seen.includes('search-index.zh-TW'));
    }
  } finally { restoreFetch(); }
});

test('data.js proIndexShards：差異分片 404、格式不認得、與民眾版分片對不上 ⇒ 退回完整專業版分片（答案不變）', async (tc) => {
  if (!hasDist) return tc.skip('dist 尚未建置');
  try {
    const want = readV1('search-index-pro.zh-TW').data;
    const miss = { ok: false, status: 404, json: async () => ({}) };
    const cases = {
      '404': { 'search-index-pro-delta.zh-TW': miss },
      '格式版本不認得': { 'search-index-pro-delta.zh-TW': { ok: true, status: 200, json: async () => ({ meta: {}, data: { ...readV1('search-index-pro-delta.zh-TW').data, v: 99 } }) } },
      '民眾版分片是舊快取（筆數不同）': { 'search-index.zh-TW': { ok: true, status: 200, json: async () => ({ meta: {}, data: readV1('search-index.zh-TW').data.slice(1) }) } },
    };
    for (const [name, overrides] of Object.entries(cases)) {
      const seen = [];
      const data = await loadData('zh-TW', distFetch(overrides, seen));
      const got = await data.proIndexShards();
      assert.equal(JSON.stringify(got), JSON.stringify(want), `${name}：應退回完整專業版分片`);
      assert.ok(seen.includes('search-index-pro.zh-TW'), `${name}：有改抓完整分片`);
    }
  } finally { restoreFetch(); }
});

test('data.js 與建置共用同一份差異分片規則：data.js 從 index-delta.js 取檔名與合併函式（動態載入），不自己寫一份', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/client/answer/data.js'), 'utf8');
  assert.match(src, /import\('\.\/index-delta\.js'\)/, '專業版才動態載入，民眾版初始 JS 不多一個檔');
  assert.ok(!/^import .*index-delta/m.test(src), '不靜態 import');
  assert.ok(!/['"`]search-index-pro-delta/.test(src), '檔名字串只寫在 index-delta.js（data.js 註解可以提）');
  assert.equal(PRO_DELTA_BASE, 'search-index-pro-delta');
});
