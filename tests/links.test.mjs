// 全站連結完整性：scripts/lib/check-internal-links.mjs（假 dist）＋ validate 佔位網址政策 ＋ /pending/、404 模板。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkInternalLinks, blacklistHit, summarize } from '../scripts/lib/check-internal-links.mjs';
import { validateSite, findPlaceholderUrls } from '../scripts/lib/validate.mjs';
import { loadSite } from '../scripts/lib/load.mjs';
import { makeCtx } from '../scripts/lib/pages.mjs';
import * as pending from '../src/templates/public/pending.mjs';
import * as notfound from '../src/templates/public/notfound.mjs';
import { mk, addItem, govern, config } from './helpers.mjs';

const SITE = 'https://proto.test';

function fakeDist(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdc-dist-'));
  for (const [rel, body] of Object.entries(files)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
  }
  return dir;
}
const page = (body, head = '') => `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;
const kinds = (list, kind) => list.filter((e) => e.kind === kind);

test('站內連結：存在／不存在、相對路徑、資料夾無斜線、query 忽略、basePath 缺漏、排除清單', () => {
  const dist = fakeDist({
    'index.html': page(`
      <a href="/base/about/">ok</a>
      <a href="/base/about">ok 無斜線</a>
      <a href="about/">ok 相對</a>
      <a href="./about/?tab=1">ok query</a>
      <a href="/base/style.css">ok 檔案</a>
      <a href="/base/missing/">壞</a>
      <a href="/about/">缺 basePath</a>
      <a href="/base/ask/?q=登革熱">排除</a>
      <a href="mailto:a@b.c">mail</a><a href="tel:1922">tel</a><a href="javascript:void(0)">js</a>
      <img src="img/none.svg" alt="">
      <img srcset="/base/img/a.svg 1x, /base/img/b.svg 2x" alt="">
      <form action="/base/ask/"></form>
      <div data-src-url="/base/v1/catalog.json"></div>
      <script>var s = '<a href="/base/in-script/">不掃</a>';</script>
      <!-- <a href="/base/in-comment/">不掃</a> -->`,
    `<link rel="stylesheet" href="/base/style.css"><link rel="canonical" href="${SITE}/base/">
      <meta property="og:image" content="${SITE}/base/img/og.png">
      <script type="application/ld+json">{"@type":"WebPage","url":"${SITE}/base/","subjectOf":{"contentUrl":"${SITE}/base/files/gone.pdf"}}</script>`),
    'about/index.html': page('<h2 id="team">小組</h2>'),
    'ask/index.html': page(''),
    'style.css': 'body{}',
    'img/a.svg': '<svg/>',
    'v1/catalog.json': '{}',
  });
  const res = checkInternalLinks(dist, { basePath: '/base', siteUrl: SITE, langs: config.langs });
  const missing = kinds(res.errors, 'missing').map((e) => e.target).sort();
  assert.deepEqual(missing, ['/files/gone.pdf', '/img/b.svg', '/img/none.svg', '/img/og.png', '/missing/']);
  assert.deepEqual(kinds(res.errors, 'missing-basepath').map((e) => e.href), ['/about/']);
  assert.ok(!res.errors.some((e) => /in-script|in-comment/.test(e.href)), 'script／註解內字串不掃');
  assert.ok(!res.errors.some((e) => /ask\/\?q=/.test(e.href)), '/ask/?q= 排除');
  assert.ok(res.errors.every((e) => e.from === '/index.html'));
  assert.equal(res.ok, false);
  assert.ok(res.counts.skipped >= 3, 'mailto／tel／javascript 略過');
  // 報告檔
  const rep = JSON.parse(fs.readFileSync(path.join(dist, 'v1/governance/link-report.json'), 'utf8'));
  assert.equal(rep.counts.errors, res.errors.length);
  assert.ok(rep.errorsByTarget.length >= 5);
  assert.ok(fs.existsSync(path.join(dist, 'v1/governance/external-links.json')));
  // console 摘要列出來源頁 → 目標
  const lines = []; summarize(res, { log: (m) => lines.push(m) });
  assert.ok(lines.some((l) => l.includes('/index.html → /base/missing/')));
});

test('錨點：同頁與他頁 id 檢查，找不到算 warning；#t= 媒體片段不檢', () => {
  const dist = fakeDist({
    'index.html': page('<h2 id="top-news">x</h2><a href="#top-news">同頁 ok</a><a href="#nope">同頁缺</a><a href="/base/about/#team">他頁 ok</a><a href="/base/about/#gone">他頁缺</a><a href="/base/about/#t=30">媒體</a><a name="legacy"></a><a href="#legacy">name ok</a>'),
    'about/index.html': page('<section id="team"></section>'),
  });
  const res = checkInternalLinks(dist, { basePath: '/base', siteUrl: SITE, write: false });
  assert.equal(res.errors.length, 0);
  assert.deepEqual(kinds(res.warnings, 'missing-anchor').map((w) => w.anchor).sort(), ['gone', 'nope']);
  assert.ok(!fs.existsSync(path.join(dist, 'v1/governance/link-report.json')), 'write:false 不寫檔');
});

test('相對路徑解析（../）與無 basePath 部署', () => {
  const dist = fakeDist({
    'a/b/index.html': page('<a href="../../about/">ok</a><a href="../c/">壞</a><a href="/about/">ok（無 basePath）</a>'),
    'about/index.html': page(''),
  });
  const res = checkInternalLinks(dist, { basePath: '', siteUrl: SITE, write: false });
  assert.deepEqual(res.errors.map((e) => [e.kind, e.target]), [['missing', '/a/c/']]);
});

test('外部連結：收集網域／次數／來源頁；黑名單（example.、placeholder、localhost、127.0.0.1、TODO、xxx）= error', () => {
  const dist = fakeDist({
    'index.html': page(`
      <a href="https://www.mohw.gov.tw/">衛福部</a><a href="https://www.mohw.gov.tw/">再一次</a>
      <a href="https://data.cdc.gov.tw/dataset/x">資料</a>
      <a href="https://example.gov.tw/a">示意</a>
      <a href="https://www.cdc.gov.tw/File/Get/placeholder-form-a">佔位</a>
      <a href="http://localhost:4173/">本機</a><a href="http://127.0.0.1/">本機</a>
      <a href="https://ok.gov.tw/TODO">待辦</a><a href="https://xxx.gov.tw/">xxx</a>
      <a href="//cdn.example.com/x.js">協定相對</a>`),
  });
  const res = checkInternalLinks(dist, { basePath: '/base', siteUrl: SITE });
  assert.equal(kinds(res.errors, 'blacklisted').length, 7);
  const ext = JSON.parse(fs.readFileSync(path.join(dist, 'v1/governance/external-links.json'), 'utf8'));
  const mohw = ext.domains.find((d) => d.domain === 'www.mohw.gov.tw');
  assert.equal(mohw.count, 2);
  assert.deepEqual(mohw.urls[0].sources, ['/index.html']);
  assert.ok(ext.domains.some((d) => d.domain === 'data.cdc.gov.tw'));
  assert.equal(blacklistHit('https://www.cdc.gov.tw/'), null);
  assert.equal(blacklistHit('https://www.cdc.gov.tw/Category/DiseaseManual'), null);
  assert.ok(blacklistHit('https://sub.example.com/'));
});

test('404.html：不得有相對路徑（Pages 會在任意路徑回應它）', () => {
  const dist = fakeDist({ '404.html': page('<a href="about/">相對</a><a href="/base/">ok</a><a href="#main">錨點</a><main id="main"></main>'), 'index.html': page('') });
  const res = checkInternalLinks(dist, { basePath: '/base', siteUrl: SITE, write: false });
  assert.deepEqual(res.errors.map((e) => e.kind), ['relative-in-404']);
});

test('效能：1,200 頁 × 80 連結 < 5 秒', () => {
  const files = { 'about/index.html': page('<p id="x"></p>') };
  const links = Array.from({ length: 80 }, (_, i) => `<a href="/base/p${i % 40}/">${i}</a><a href="https://www.cdc.gov.tw/${i}">e</a>`).join('');
  for (let i = 0; i < 1200; i++) files[`p${i}/index.html`] = page(links + '<a href="/base/about/#x">a</a>');
  const dist = fakeDist(files);
  const t0 = Date.now();
  const res = checkInternalLinks(dist, { basePath: '/base', siteUrl: SITE });
  assert.ok(Date.now() - t0 < 5000, `${Date.now() - t0} ms`);
  assert.equal(res.errors.length, 0);
  assert.equal(res.counts.pages, 1201);
});

test('validate：內容連結含 placeholder-／example.gov.tw／example.com ⇒ 治理門檻錯誤；legacyUrls 例外', () => {
  const item = mk({ type: 'service', forms: [{ label: '表', href: 'https://www.cdc.gov.tw/File/Get/placeholder-x' }], applyUrl: 'https://example.gov.tw/apply',
    legacyUrls: ['https://www.cdc.gov.tw/File/Get/placeholder-legacy'], introMarkdown: '見 [說明](https://www.example.com/a)。' });
  const hits = findPlaceholderUrls(item).map((h) => h.path).sort();
  assert.deepEqual(hits, ['/applyUrl', '/forms/0/href', '/introMarkdown']);
  assert.deepEqual(findPlaceholderUrls(mk({ type: 'faq', legacyUrls: ['https://example.gov.tw/old'] })), []);
  assert.deepEqual(findPlaceholderUrls(mk({ type: 'topic', links: [{ label: 'a', href: '/pending/?ref=x&doc=y' }, { label: 'b', href: 'https://www.mohw.gov.tw/' }] })), []);

  const site = loadSite(config);
  site.today = '2026-10-01';
  assert.deepEqual(validateSite(site).filter((e) => e.includes('佔位')), [], '語料不得含佔位網址');
  addItem(site, mk({ type: 'service', id: 'service.test-ph', slug: 'test-ph', forms: [{ label: '表', href: 'https://www.cdc.gov.tw/File/Get/placeholder-x' }] }));
  const errs = validateSite(site).filter((e) => e.includes('佔位'));
  assert.equal(errs.length, 1);
  assert.match(errs[0], /test\/service\.test-ph\.json: \/forms\/0\/href 含佔位／示意網址/);
});

test('/pending/：七語輸出、noindex；嵌入 ref 對照（含 basePath 的來源頁與權責單位）；文件名稱只用 textContent', () => {
  const site = govern('2026-10-01');
  const pg = pending.pages(site);
  assert.deepEqual(pg, [{ path: '/pending/', lang: '*', noindex: true, props: {} }]);
  const refs = pending.pendingRefs(site);
  assert.ok(refs.includes('service.lab-test-request'));
  assert.ok(refs.some((r) => r.startsWith('publication.')));
  const ctx = makeCtx(site, 'zh-TW', { path: '/pending/' });
  const out = String(pending.render(ctx, {}));
  const data = JSON.parse(out.match(/<script type="application\/json" id="pending-data">([\s\S]*?)<\/script>/)[1]);
  assert.equal(data.refs['service.lab-test-request'].href, `${config.basePath}/apply/lab-test-request/`);
  assert.ok(data.refs['service.lab-test-request'].owner);
  assert.ok(out.includes(pending.LEGACY_LIBRARY_URL));
  assert.ok(!/innerHTML/.test(out), '不以 innerHTML 插入 query 內容');
  assert.equal(pending.meta(ctx).noindex, true);
  const en = String(pending.render(makeCtx(site, 'en', { path: '/pending/' }), {}));
  assert.ok(en.includes('not yet migrated') || en.includes('not been migrated'));
});

test('404：連結皆為含 basePath 的絕對路徑，內含「你可能在找」建議區與資料端點', () => {
  const site = govern('2026-10-01');
  const ctx = makeCtx(site, 'zh-TW', { path: '/404.html' });
  const out = String(notfound.render(ctx, {}));
  const hrefs = [...out.matchAll(/\shref="([^"]*)"/g)].map((m) => m[1]);
  assert.ok(hrefs.length >= 5);
  for (const h of hrefs) assert.ok(/^(\/|tel:|https?:)/.test(h), `相對路徑：${h}`);
  if (config.basePath) for (const h of hrefs.filter((x) => x.startsWith('/'))) assert.ok(h.startsWith(`${config.basePath}/`), h);
  assert.ok(out.includes('data-nf-suggest'));
  const data = JSON.parse(out.match(/<script type="application\/json" id="nf-data">([\s\S]*?)<\/script>/)[1]);
  assert.equal(data.catalog, `${config.basePath}/v1/catalog.json`);
  assert.deepEqual(notfound.pages(), [{ path: '/404.html', file: true, noindex: true, props: {} }]);
});
