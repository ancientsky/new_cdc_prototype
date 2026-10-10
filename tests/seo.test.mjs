// SEO／機讀輸出測試：robots 三類 AI 爬蟲、sitemap 不含失效版、llms.txt 七語、feeds。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emitSeo, derivePages, AI_CRAWLERS } from '../scripts/lib/emit-seo.mjs';
import { govern, memWriter, config, mk, addItem } from './helpers.mjs';

function emitted(opts, mutate) {
  const site = govern('2026-10-01', mutate);
  const { files, write } = memWriter();
  emitSeo(site, write, opts);
  return { site, files };
}

test('robots.txt：三類 AI 爬蟲區塊、擋 /ask/ 與 /admin/（含語言前綴）、不擋失效版、列出全部 sitemap', () => {
  const { files } = emitted();
  // 第二十三輪：原型模式的 robots.txt 全擋，AI 政策版另存 robots.production.txt（SITE_MODE=production 時才是 robots.txt）
  const r = files.get(config.isPrototype ? 'robots.production.txt' : 'robots.txt');
  for (const group of Object.values(AI_CRAWLERS)) {
    assert.ok(r.includes(group.label), group.label);
    for (const a of group.agents) assert.match(r, new RegExp(`^User-agent: ${a}$`, 'm'));
  }
  for (const a of ['GPTBot', 'ClaudeBot', 'OAI-SearchBot', 'Google-Extended', 'PerplexityBot']) assert.match(r, new RegExp(`User-agent: ${a}`));
  assert.match(r, new RegExp(`Disallow: ${config.basePath}/admin/`));
  assert.match(r, new RegExp(`Disallow: ${config.basePath}/ask/`));
  assert.match(r, new RegExp(`Disallow: ${config.basePath}/en/ask/`));
  assert.ok(!/Disallow: .*documents/.test(r), '失效版用 noindex，不用 robots 擋');
  assert.match(r, /Bytespider\nUser-agent: img2dataset[\s\S]*?Disallow: \/\n/);
  for (const s of ['sitemap.xml', 'sitemap-diseases.xml', 'sitemap-news.xml', 'sitemap-documents.xml', 'sitemap-faq.xml', 'sitemap-en.xml']) assert.ok(r.includes(`Sitemap: ${config.siteUrl}${config.basePath}/${s}`), s);
});

test('sitemap index＋分類 sitemap；documents 只含現行版，失效版不出現在任何 sitemap', () => {
  const { files } = emitted();
  const index = files.get('sitemap.xml');
  assert.match(index, /<sitemapindex/);
  for (const n of ['pages', 'diseases', 'news', 'documents', 'faq', ...config.langs.filter((l) => l.code !== 'zh-TW').map((l) => l.code)]) {
    assert.ok(files.has(`sitemap-${n}.xml`), n);
    assert.ok(index.includes(`/sitemap-${n}.xml</loc>`), `index 缺 ${n}`);
  }
  const docs = files.get('sitemap-documents.xml');
  assert.ok(docs.includes('/documents/mmr-recommendation.2025-04-16/'));
  for (const [name, xml] of files) if (name.startsWith('sitemap')) assert.ok(!xml.includes('mmr-recommendation.2019-05-14'), `${name} 含失效版`);
  assert.ok(files.get('sitemap-diseases.xml').includes(`${config.basePath}/diseases/dengue/</loc>`));
  assert.match(files.get('sitemap-diseases.xml'), /hreflang="vi"/);
  assert.match(files.get('sitemap-diseases.xml'), /hreflang="x-default"/);
  // 一級內容只有 reviewed 語言進該語 sitemap
  const dengue = govern().byId.get('disease.dengue');
  for (const l of config.langs.filter((x) => x.code !== 'zh-TW')) assert.equal(files.get(`sitemap-${l.code}.xml`).includes(`/${l.code}/diseases/dengue/</loc>`), dengue.gov.renderableLangs.includes(l.code), l.code);
  assert.ok(!/\/(admin|ask)\//.test([...files.entries()].filter(([n]) => n.startsWith('sitemap')).map(([, x]) => x).join('')), 'sitemap 不含 admin／ask');
});

test('derivePages：新版未生效／草稿不進 sitemap；傳入實際頁面時排除 noindex', () => {
  const site = govern('2026-10-01', (s) => {
    addItem(s, mk({ id: 'faq.test-draft-seo', status: 'draft' }));
  });
  const paths = derivePages(site).map((p) => p.path);
  assert.ok(!paths.includes('/faq/test-draft-seo/'));
  assert.ok(paths.includes('/tasks/symptoms/'));
  const { files } = emitted({ pages: [{ path: '/', lang: 'zh-TW' }, { path: '/documents/mmr-recommendation.2019-05-14/', lang: 'zh-TW', noindex: false }, { path: '/faq/x/', lang: 'zh-TW', noindex: true }, { path: '/admin/', lang: 'zh-TW' }] });
  const all = [...files.entries()].filter(([n]) => n.startsWith('sitemap')).map(([, x]) => x).join('');
  assert.ok(!all.includes('2019-05-14'), '即使頁面清單沒標 noindex，失效版仍排除');
  assert.ok(!all.includes('/faq/x/')); assert.ok(!all.includes('/admin/'));
});

test('llms.txt 七語都存在；只列現行版與該語可渲染內容', () => {
  const { files } = emitted();
  assert.ok(files.has('llms.txt'));
  for (const l of config.langs.filter((x) => x.code !== 'zh-TW')) assert.ok(files.has(`${l.code}/llms.txt`), l.code);
  const zh = files.get('llms.txt');
  assert.match(zh, /^# /);
  assert.match(zh, /^> /m);
  assert.ok(zh.includes('/diseases/dengue.md'));
  assert.ok(zh.includes('mmr-recommendation.2025-04-16.md'));
  assert.ok(!zh.includes('mmr-recommendation.2019-05-14'), '失效版不列');
  assert.ok(zh.includes('/openapi.json'));
  const dengue = govern().byId.get('disease.dengue');
  for (const l of config.langs.filter((x) => x.code !== 'zh-TW')) assert.equal(files.get(`${l.code}/llms.txt`).includes(`/${l.code}/diseases/dengue.md`), dengue.gov.renderableLangs.includes(l.code), `${l.code}：一級內容只列 reviewed`);
  assert.ok(files.get('en/llms.txt').includes('Taiwan Centers for Disease Control'));
});

test('feeds：RSS 2.0、guid 為穩定 id、文件異動含取代關係', () => {
  const { files, site } = emitted();
  const news = files.get('feeds/news.xml');
  assert.match(news, /<rss version="2\.0"/);
  assert.ok(news.includes('<guid isPermaLink="false">news.2025-01-09-mmr-adults-measles</guid>'));
  assert.ok(news.includes('【加註】本新聞稿發布於 2025-01-09'));
  const docs = files.get('feeds/documents.xml');
  assert.ok(docs.includes('<guid isPermaLink="false">doc.mmr-recommendation.2025-04-16</guid>'));
  assert.ok(docs.includes('取代 108.05.14 版'));
  assert.ok(files.get('feeds/situation.xml').includes(`<guid isPermaLink="false">situation.${site.situation.publishedAt}</guid>`));
});

test('RSS pubDate：日期補台灣時間 00:00 再轉 RFC 822（UTC 表示）；date-time 內容檔也能用', async () => {
  const { toRfc822 } = await import('../scripts/lib/dates.mjs');
  const { files } = emitted();
  assert.match(files.get('feeds/news.xml'), /<pubDate>[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT<\/pubDate>/);
  assert.equal(toRfc822('2025-01-09'), 'Wed, 08 Jan 2025 16:00:00 GMT');
  assert.equal(toRfc822('2025-01-09T10:30:00+08:00'), 'Thu, 09 Jan 2025 02:30:00 GMT');
});
