// scripts/fetch-data.mjs --check-links：以注入的 fetch 與暫存 content 目錄測試，不連外。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkLinks, checkUrl, runLinkChecks, linkTargetsOf, isPlaceholderUrl } from '../scripts/fetch-data.mjs';

const quiet = () => {};
const res = (status, headers = {}) => ({ status, headers: { get: (k) => headers[k.toLowerCase()] ?? null }, body: null });

function tmpContent() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdc-links-'));
  const put = (sub, name, obj) => { fs.mkdirSync(path.join(dir, sub), { recursive: true }); fs.writeFileSync(path.join(dir, sub, name), JSON.stringify(obj, null, 2) + '\n'); };
  put('topics', 'a.json', { id: 'topic.a', type: 'topic', title: 'A', summary: '不變', links: [
    { label: '站內', href: '/faq/' },
    { label: '好', href: 'https://ok.gov.tw/' },
    { label: '壞', href: 'https://gone.gov.tw/x' },
    { label: '佔位', href: 'https://www.cdc.gov.tw/File/Get/placeholder-abc' },
  ], legacyUrls: ['https://legacy.gov.tw/never-checked'] });
  put('services', 's.json', { id: 'service.s', type: 'service', title: 'S', applyUrl: 'https://ok.gov.tw/apply', forms: [{ label: '表', href: 'https://head405.gov.tw/form.pdf' }] });
  put('news', 'n.json', { id: 'news.n', type: 'news', newsType: 'recruit', title: 'N', applyUrl: 'https://ok.gov.tw/' });
  put('documents', 'd.json', { id: 'doc.d', type: 'document', title: 'D', pdfUrl: 'https://gone.gov.tw/d.pdf' });
  return dir;
}
const read = (dir, sub, name) => JSON.parse(fs.readFileSync(path.join(dir, sub, name), 'utf8'));

test('linkTargetsOf：只收定義欄位的 http(s) 網址，legacyUrls 與站內連結不收；佔位網址判定', () => {
  const t = linkTargetsOf({ type: 'topic', links: [{ href: '/x/' }, { href: 'https://a.gov.tw/' }], legacyUrls: ['https://b.gov.tw/'] });
  assert.deepEqual(t, [{ url: 'https://a.gov.tw/', field: 'links', list: true, index: 1 }]);
  assert.deepEqual(linkTargetsOf({ type: 'media', videoUrl: 'https://youtu.be/x' }), [{ url: 'https://youtu.be/x', field: 'videoUrl' }]);
  assert.deepEqual(linkTargetsOf({ type: 'faq', applyUrl: 'https://a.gov.tw/' }), []);
  assert.ok(isPlaceholderUrl('https://www.cdc.gov.tw/File/Get/placeholder-123'));
  assert.ok(isPlaceholderUrl('https://example.com/a'));
  assert.ok(!isPlaceholderUrl('https://www.cdc.gov.tw/File/Get/abc'));
});

test('checkUrl：HEAD 成功 ok；HEAD 405 改 GET；404 broken；403 無法判定；代理拒絕＝連線失敗', async () => {
  const fetchImpl = async (url, { method }) => {
    if (url.includes('head405')) return method === 'HEAD' ? res(405) : res(200);
    if (url.includes('gone')) return res(404);
    if (url.includes('forbid')) return res(403);
    if (url.includes('proxy')) return res(403, { 'x-deny-reason': 'host_not_allowed' });
    if (url.includes('down')) throw new TypeError('fetch failed');
    return res(200);
  };
  assert.equal((await checkUrl('https://ok.gov.tw/', { fetchImpl })).status, 'ok');
  assert.deepEqual(await checkUrl('https://head405.gov.tw/', { fetchImpl }), { status: 'ok', code: 200, network: false });
  assert.equal((await checkUrl('https://gone.gov.tw/', { fetchImpl })).status, 'broken');
  assert.equal((await checkUrl('https://forbid.gov.tw/', { fetchImpl })).status, 'indeterminate');
  const p = await checkUrl('https://proxy.gov.tw/', { fetchImpl });
  assert.equal(p.network, true); assert.match(p.error, /proxy/);
  assert.equal((await checkUrl('https://down.gov.tw/', { fetchImpl })).network, true);
});

test('runLinkChecks：同站併發 ≤ 3', async () => {
  const active = new Map(); let maxSeen = 0;
  const fetchImpl = async (url) => {
    const h = new URL(url).host;
    active.set(h, (active.get(h) ?? 0) + 1); maxSeen = Math.max(maxSeen, active.get(h));
    await new Promise((r) => setTimeout(r, 5));
    active.set(h, active.get(h) - 1);
    return res(200);
  };
  const urls = Array.from({ length: 10 }, (_, i) => `https://same.gov.tw/${i}`).concat(Array.from({ length: 5 }, (_, i) => `https://other.gov.tw/${i}`));
  const r = await runLinkChecks(urls, { fetchImpl });
  assert.equal(r.size, 15); assert.ok(maxSeen <= 3, `max ${maxSeen}`); assert.equal(maxSeen, 3);
});

test('checkLinks：寫回 lastCheckedAt／status（陣列元素寫在元素、單一欄位寫 linkChecks），其他欄位不動；佔位與站內不檢', async () => {
  const dir = tmpContent();
  const before = read(dir, 'topics', 'a.json');
  const calls = [];
  const fetchImpl = async (url, { method }) => { calls.push(url); if (url.includes('gone')) return res(404); if (url.includes('head405') && method === 'HEAD') return res(405); return res(200); };
  const s = await checkLinks({ contentDir: dir, fetchImpl, today: '2026-10-01', logger: quiet });
  assert.equal(s.offline, false); assert.equal(s.placeholders, 1);
  assert.ok(!calls.some((u) => u.includes('placeholder') || u.includes('legacy')), '佔位與 legacyUrls 不檢');
  const t = read(dir, 'topics', 'a.json');
  assert.deepEqual(t.links[0], before.links[0], '站內連結不動');
  assert.deepEqual(t.links[1], { ...before.links[1], lastCheckedAt: '2026-10-01', status: 'ok' });
  assert.deepEqual(t.links[2], { ...before.links[2], lastCheckedAt: '2026-10-01', status: 'broken' });
  assert.deepEqual(t.links[3], before.links[3], '佔位不寫');
  const { links: _a, ...restBefore } = before; const { links: _b, ...restAfter } = t;
  assert.deepEqual(restAfter, restBefore, '只改 lastCheckedAt／status');
  const sv = read(dir, 'services', 's.json');
  assert.deepEqual(sv.linkChecks, { applyUrl: { status: 'ok', lastCheckedAt: '2026-10-01' } });
  assert.equal(sv.forms[0].status, 'ok', 'HEAD 405 → GET 200');
  assert.deepEqual(read(dir, 'documents', 'd.json').linkChecks.pdfUrl, { status: 'broken', lastCheckedAt: '2026-10-01' });
  assert.equal(read(dir, 'news', 'n.json').linkChecks.applyUrl.status, 'ok');
  assert.equal(new Set(calls.filter((u) => u === 'https://ok.gov.tw/')).size, 1, '同網址只檢一次');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('checkLinks：全部失敗（沙箱無法連外）⇒ 不改任何檔、回報 offline；dry 不寫檔；上限 300', async () => {
  const dir = tmpContent();
  const snapshot = () => Object.fromEntries(['topics/a.json', 'services/s.json', 'news/n.json', 'documents/d.json'].map((f) => [f, fs.readFileSync(path.join(dir, f), 'utf8')]));
  const orig = snapshot();
  const offline = await checkLinks({ contentDir: dir, fetchImpl: async () => { throw new TypeError('fetch failed'); }, today: '2026-10-01', logger: quiet });
  assert.equal(offline.offline, true); assert.deepEqual(snapshot(), orig);
  const denied = await checkLinks({ contentDir: dir, fetchImpl: async () => res(403, { 'x-deny-reason': 'host_not_allowed' }), today: '2026-10-01', logger: quiet });
  assert.equal(denied.offline, true); assert.deepEqual(snapshot(), orig);
  const dry = await checkLinks({ contentDir: dir, fetchImpl: async () => res(200), today: '2026-10-01', dry: true, logger: quiet });
  assert.ok(dry.changedFiles.length > 0); assert.deepEqual(snapshot(), orig, 'dry 不寫檔');
  const capped = await checkLinks({ contentDir: dir, fetchImpl: async () => res(200), today: '2026-10-01', dry: true, maxUrls: 2, logger: quiet });
  assert.equal(capped.checked, 2); assert.equal(capped.skippedOverLimit, capped.urls - 2);
  fs.rmSync(dir, { recursive: true, force: true });
});
