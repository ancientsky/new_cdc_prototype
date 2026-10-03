// 第二輪輸出測試：新 API 端點（etag）、catalog 七類資產、疾病 related、openapi、sitemap 新路由、feeds、llms.txt、JSON-LD 六型別。
// 全部以合成資料驗證（不依賴 B2 內容筆數）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emitApi, etagOf, CATEGORY_OF, ASSET_CATEGORIES } from '../scripts/lib/emit-api.mjs';
import { emitSeo, derivePages, STATIC_PATHS } from '../scripts/lib/emit-seo.mjs';
import { jsonLdFor, aboutOrgJsonLd, isoDuration } from '../scripts/lib/jsonld.mjs';
import { ENDPOINTS } from '../scripts/lib/openapi.mjs';
import { makeUrl } from '../scripts/lib/render.mjs';
import { govern, memWriter, mk, addItem, config } from './helpers.mjs';

const TODAY = '2026-10-01';
function fixture(s) {
  addItem(s, mk({ type: 'media', id: 'media.test-r2-video', title: '登革熱衛教影片', diseases: ['disease.dengue'], youtubeId: 'abcDEF12345', durationSeconds: 95, poster: '/img/media/test.svg', producedAt: '2026-05-01', basedOn: ['doc.mmr-recommendation'], captions: ['zh-TW', 'en'] }));
  addItem(s, mk({ type: 'topic', id: 'topic.test-r2', slug: 'test-r2', diseases: ['disease.dengue'], endAt: '2026-09-30', contentIds: ['disease.dengue'], links: [{ label: '外站', href: 'https://x.gov.tw/', status: 'broken', lastCheckedAt: '2026-09-30' }, { label: '站內', href: '/faq/' }] }));
  addItem(s, mk({ type: 'service', id: 'service.test-r2', slug: 'test-r2', diseases: ['disease.dengue'], applyUrl: 'https://apply.gov.tw/x', legalBasis: ['傳染病防治法第 x 條'] }));
  addItem(s, mk({ type: 'publication', id: 'pub.test-r2-issue', title: '疫情報導 第 42 卷第 18 期', diseases: ['disease.dengue'], publishedAt: '2026-09-23', articles: [{ title: '2026 年登革熱本土疫情分析', pages: '233-240', diseases: ['disease.dengue'] }] }));
  addItem(s, mk({ type: 'publication', id: 'pub.test-r2-book', title: '防疫年報 2025', series: '年報', pubType: 'annual-report', volume: undefined, issue: undefined, issn: undefined, isbn: '978-626-000-000-0', edition: '初版', gpn: '1011400001', publishedAt: '2026-06-30' }));
  addItem(s, mk({ type: 'labtest', id: 'lab.test-r2', title: '登革熱病毒檢驗', disease: 'disease.dengue', sendWithinHours: 48 }));
  addItem(s, mk({ type: 'research', id: 'research.test-r2', title: '登革熱病媒監測研究', diseases: ['disease.dengue'], budgetNtd: 3000000, reportDoc: 'doc.mmr-recommendation.2025-04-16' }));
  addItem(s, mk({ type: 'news', id: 'news.test-r2-recruit', title: '徵求約用研究助理', newsType: 'recruit', deadlineAt: '2026-09-20', refNo: '疾管人字第 1150000002 號', positions: 1, applyUrl: 'https://web3.dgpa.gov.tw/x', bodyMarkdown: '職缺說明：協助登革熱監測資料整理。' }));
  addItem(s, mk({ type: 'news', id: 'news.test-r2-proc', title: '登革熱防治宣導委外案', newsType: 'procurement', deadlineAt: '2026-10-15', refNo: 'CDC115-R2', budgetNtd: 1500000, applyUrl: 'https://web.pcc.gov.tw/x' }));
  addItem(s, mk({ type: 'banner', id: 'banner.test-r2-ended', startAt: '2026-01-01', endAt: '2026-03-31', headline: '舊宣導' }));
  addItem(s, mk({ type: 'banner', id: 'banner.test-r2-next', startAt: '2026-12-01', endAt: '2026-12-31', headline: '新宣導' }));
}
const site = govern(TODAY, fixture);
site.searchIndex = { public: [], pro: [] };
const { files, write } = memWriter();
emitApi(site, write);
emitSeo(site, write);
const json = (p) => JSON.parse(files.get(p));
const ctx = (lang = 'zh-TW') => ({ site, lang, url: makeUrl(lang), path: '/', today: TODAY });
const ld = (id) => jsonLdFor(ctx(), site.byId.get(id));

const NEW_ENDPOINTS = ['v1/media.json', 'v1/topics.json', 'v1/services.json', 'v1/publications.json', 'v1/labtests.json', 'v1/research.json', 'v1/notices.json', 'v1/notify-table.json', 'v1/campaigns.json', 'v1/governance/links.json'];

test('新端點存在、外殼 etag＝data 雜湊、列入 v1/index.json 與 openapi', () => {
  const idx = json('v1/index.json').data.map((e) => e.path);
  const o = JSON.parse(files.get('openapi.json'));
  for (const f of NEW_ENDPOINTS) {
    assert.ok(files.has(f), f);
    const j = json(f);
    assert.match(j.meta.etag, /^[0-9a-f]{12}$/, f);
    assert.equal(j.meta.etag, etagOf(j.data), f);
    assert.ok(j.meta.lastModified, `${f} lastModified`);
    assert.ok(!files.get(f).includes('"__file"'), f);
    assert.ok(idx.includes(`/${f}`), `index 缺 ${f}`);
    assert.ok(o.paths[`/${f}`], `openapi 缺 /${f}`);
  }
  for (const s of ['Media', 'Topic', 'Service', 'Publication', 'Labtest', 'Research', 'NotifyCategory', 'ExternalLink', 'PublicationSeries']) assert.ok(o.components.schemas[s], s);
  assert.ok(o.paths['/feeds/publications.xml'] && o.paths['/feeds/notices.xml']);
  assert.ok(ENDPOINTS.some(([p]) => p === '/v1/notify-table.json'));
  assert.ok(o.components.schemas.Todo.properties.kind.enum.includes('link-broken'));
  assert.ok(o.components.schemas.Governance.properties.lifecycle.enum.includes('closed'));
});

test('新端點內容：media／topics（ended）／publications（series 分組）／labtests（master）／research', () => {
  const media = json('v1/media.json').data.find((m) => m.id === 'media.test-r2-video');
  assert.equal(media.governance.mediaOutdated, false); assert.equal(media.governance.hasTranscript, true);
  assert.equal(media.path, '/media/test-r2-video/'); assert.ok(media.md.endsWith('/media/test-r2-video.md'));
  const topic = json('v1/topics.json').data.find((t) => t.id === 'topic.test-r2');
  assert.equal(topic.governance.ended, true); assert.equal(topic.links[0].status, 'broken');
  assert.equal(json('v1/services.json').data.find((x) => x.id === 'service.test-r2').path, '/apply/test-r2/');
  const pubs = json('v1/publications.json');
  assert.ok(Array.isArray(pubs.series));
  const bulletin = pubs.series.find((g) => g.series === '疫情報導');
  assert.ok(bulletin.items.includes('pub.test-r2-issue')); assert.equal(bulletin.count, bulletin.items.length);
  assert.ok(pubs.series.find((g) => g.series === '年報').items.includes('pub.test-r2-book'));
  const lab = json('v1/labtests.json').data.find((l) => l.id === 'lab.test-r2');
  assert.equal(lab.master.notifyWithinHours, 24); assert.equal(lab.governance.labtestCheck.consistent, false);
  assert.ok(json('v1/research.json').data.some((r) => r.id === 'research.test-r2'));
});

test('notices.json：只含 recruit／procurement／other，帶 closed；進行中排前', () => {
  const n = json('v1/notices.json');
  assert.ok(n.data.every((x) => ['recruit', 'procurement', 'other'].includes(x.newsType)));
  const rec = n.data.find((x) => x.id === 'news.test-r2-recruit');
  const proc = n.data.find((x) => x.id === 'news.test-r2-proc');
  assert.equal(rec.closed, true); assert.equal(proc.closed, false); assert.equal(proc.daysToDeadline, 14);
  assert.ok(n.data.indexOf(proc) < n.data.indexOf(rec));
  const firstClosed = n.data.findIndex((x) => x.closed);
  if (firstClosed >= 0) assert.ok(n.data.slice(firstClosed).every((x) => x.closed), '已截止全部在後');
  assert.equal(n.meta.open + n.meta.closed, n.data.length);
  assert.ok(!n.data.some((x) => x.newsType === 'press'));
});

test('notify-table.json＝site.gov.notifyTable；campaigns.json 三種狀態；governance/links.json', () => {
  assert.deepEqual(json('v1/notify-table.json').data, JSON.parse(JSON.stringify(site.gov.notifyTable)));
  const c = json('v1/campaigns.json');
  const st = (id) => c.data.find((b) => b.id === id)?.campaignStatus;
  assert.equal(st('banner.test-r2-ended'), 'ended'); assert.equal(st('banner.test-r2-next'), 'upcoming');
  assert.ok(c.data.some((b) => b.campaignStatus === 'active'));
  const order = { active: 0, upcoming: 1, ended: 2 };
  assert.deepEqual(c.data.map((b) => order[b.campaignStatus]), [...c.data.map((b) => order[b.campaignStatus])].sort((a, b) => a - b));
  const links = json('v1/governance/links.json');
  const l = links.data.find((x) => x.itemId === 'topic.test-r2');
  assert.equal(l.status, 'broken'); assert.equal(l.field, 'links[0]'); assert.equal(l.url, 'https://x.gov.tw/');
  assert.equal(links.meta.broken, links.data.filter((x) => x.status === 'broken').length);
});

test('catalog.json：七類資產（含 media、press）、新型別 category 對應', () => {
  assert.deepEqual(Object.keys(ASSET_CATEGORIES).sort(), ['content-page', 'document-library', 'media', 'open-dataset', 'press', 'stats-system', 'structured-table']);
  assert.deepEqual({ media: CATEGORY_OF.media, topic: CATEGORY_OF.topic, service: CATEGORY_OF.service, publication: CATEGORY_OF.publication, labtest: CATEGORY_OF.labtest, research: CATEGORY_OF.research },
    { media: 'media', topic: 'content-page', service: 'content-page', publication: 'document-library', labtest: 'content-page', research: 'document-library' });
  const cat = json('v1/catalog.json');
  const by = (id) => cat.data.find((x) => x.id === id)?.category;
  assert.equal(by('media.test-r2-video'), 'media'); assert.equal(by('news.test-r2-recruit'), 'press');
  assert.equal(by('pub.test-r2-issue'), 'document-library'); assert.equal(by('research.test-r2'), 'document-library');
  assert.equal(by('lab.test-r2'), 'content-page'); assert.equal(by('service.test-r2'), 'content-page');
  assert.deepEqual(cat.meta.categories.map((x) => x.key).sort(), Object.keys(ASSET_CATEGORIES).sort());
  for (const row of cat.meta.categories) assert.equal(row.count, cat.data.filter((x) => x.category === row.key).length, row.key);
  assert.ok(cat.data.every((x) => ASSET_CATEGORIES[x.category]), '每筆都屬七類之一');
});

test('v1/diseases/{slug}.json related 補 media、labtests、services、publications、topics', () => {
  const rel = json('v1/diseases/dengue.json').data.related;
  for (const k of ['media', 'labtests', 'services', 'publications', 'topics']) assert.ok(Array.isArray(rel[k]), k);
  assert.ok(rel.media.some((x) => x.id === 'media.test-r2-video'));
  assert.ok(rel.labtests.some((x) => x.id === 'lab.test-r2'));
  assert.ok(rel.services.some((x) => x.id === 'service.test-r2'));
  assert.ok(rel.publications.some((x) => x.id === 'pub.test-r2-issue'));
  assert.ok(rel.topics.some((x) => x.id === 'topic.test-r2'));
});

test('sitemap：新靜態路由與詳頁；sitemap-media.xml、sitemap-publications.xml 新增並列入 index', () => {
  for (const p of ['/campaigns/', '/media/', '/services/', '/apply/', '/publications/', '/lab/', '/report/', '/research/', '/notices/', '/contact/']) assert.ok(STATIC_PATHS.includes(p), p);
  const pages = derivePages(site);
  const has = (p) => pages.some((x) => x.path === p && x.lang === 'zh-TW');
  for (const p of ['/campaigns/', '/report/', '/notices/', '/contact/', '/media/test-r2-video/', '/topics/test-r2/', '/apply/test-r2/', '/publications/pub.test-r2-issue/'.replace('pub.', ''), '/lab/test-r2/', '/research/test-r2/']) assert.ok(has(p), p);
  const index = files.get('sitemap.xml');
  for (const n of ['media', 'publications']) {
    assert.ok(files.has(`sitemap-${n}.xml`), n);
    assert.ok(index.includes(`/sitemap-${n}.xml</loc>`), `index 缺 ${n}`);
  }
  assert.ok(files.get('sitemap-media.xml').includes(`${config.basePath}/media/test-r2-video/</loc>`));
  assert.ok(files.get('sitemap-publications.xml').includes(`${config.basePath}/publications/test-r2-issue/</loc>`));
  const pagesXml = files.get('sitemap-pages.xml');
  for (const p of ['/report/', '/lab/test-r2/', '/apply/test-r2/', '/topics/test-r2/']) assert.ok(pagesXml.includes(`${config.basePath}${p}</loc>`), p);
  // 語言依 renderableLangs：只有中文的合成內容不進英文 sitemap
  assert.ok(!files.get('sitemap-en.xml').includes('/en/media/test-r2-video/'));
});

test('feeds：publications.xml 與 notices.xml（RSS 2.0、guid＝id、截止與書目）', () => {
  const p = files.get('feeds/publications.xml');
  assert.match(p, /<rss version="2\.0"/);
  assert.ok(p.includes('<guid isPermaLink="false">pub.test-r2-issue</guid>'));
  assert.ok(p.includes('第 42 卷') && p.includes('ISSN 1818-6858'));
  assert.ok(p.includes('ISBN 978-626-000-000-0'));
  const n = files.get('feeds/notices.xml');
  assert.ok(n.includes('<guid isPermaLink="false">news.test-r2-recruit</guid>'));
  assert.ok(n.includes('【已截止】徵求約用研究助理'));
  assert.ok(n.includes('截止日：2026-10-15') && n.includes('字號：CDC115-R2'));
  assert.ok(!n.includes('news.2026-09-22-enterovirus-alert'), '新聞稿不進公告 feed');
});

test('llms.txt：影音逐字稿、申請服務、出版品、檢驗項目（專業）、通報時限表段落', () => {
  const zh = files.get('llms.txt');
  for (const h of ['## 影音逐字稿', '## 申請服務', '## 出版品', '## 檢驗項目（專業）', '## 通報時限表']) assert.ok(zh.includes(h), h);
  assert.ok(zh.includes('/media/test-r2-video.md'));
  assert.ok(zh.includes('/apply/test-r2.md'));
  assert.ok(zh.includes('/lab/test-r2.md'));
  assert.ok(zh.includes('/v1/notify-table.json'));
  assert.ok(files.get('en/llms.txt').includes('## Notifiable disease reporting deadlines'));
});

test('JSON-LD：media VideoObject（duration、embedUrl nocookie、transcript、Clip 章節）', () => {
  assert.equal(isoDuration(95), 'PT1M35S'); assert.equal(isoDuration(3600), 'PT1H'); assert.equal(isoDuration(0), 'PT0S');
  const v = ld('media.test-r2-video')[0];
  assert.equal(v['@type'], 'VideoObject');
  assert.equal(v.uploadDate, site.byId.get('media.test-r2-video').publishedAt);
  assert.equal(v.duration, 'PT1M35S');
  assert.equal(v.embedUrl, 'https://www.youtube-nocookie.com/embed/abcDEF12345');
  assert.ok(v.thumbnailUrl.endsWith('/img/media/test.svg'));
  assert.ok(v.transcript.includes('登革熱'));
  assert.deepEqual(v.hasPart.map((c) => [c['@type'], c.startOffset, c.endOffset]), [['Clip', 0, 30], ['Clip', 30, 95]]);
  assert.equal(v['cdc:mediaOutdated'], false);
  assert.ok('cdc:owner' in v);
});

test('JSON-LD：topic CollectionPage、service GovernmentService＋HowTo、publication PublicationIssue／Book', () => {
  const t = ld('topic.test-r2')[0];
  assert.equal(t['@type'], 'CollectionPage'); assert.equal(t['cdc:ended'], true); assert.equal(t.mainEntity.itemListElement.length, 2);
  const [svc, howto] = ld('service.test-r2');
  assert.equal(svc['@type'], 'GovernmentService'); assert.equal(svc.serviceType, 'data-request');
  assert.equal(svc.provider['@type'], 'GovernmentOrganization'); assert.equal(svc.availableChannel.serviceUrl, 'https://apply.gov.tw/x');
  assert.ok(svc.serviceOutput.name); assert.ok(!('hoursAvailable' in svc));
  assert.equal(howto['@type'], 'HowTo'); assert.equal(howto.step.length, 2); assert.equal(howto.step[0]['@type'], 'HowToStep'); assert.equal(howto.step[1].position, 2);
  assert.equal(howto.supply[0].name, '申請書');
  const issue = ld('pub.test-r2-issue')[0];
  assert.equal(issue['@type'], 'PublicationIssue'); assert.equal(issue.issueNumber, '18');
  assert.deepEqual(issue.isPartOf['@type'], ['PublicationVolume', 'Periodical']);
  assert.equal(issue.isPartOf.issn, '1818-6858'); assert.equal(issue.isPartOf.volumeNumber, '42');
  assert.equal(issue.hasPart[0]['@type'], 'ScholarlyArticle');
  const book = ld('pub.test-r2-book')[0];
  assert.equal(book['@type'], 'Book'); assert.equal(book.isbn, '978-626-000-000-0'); assert.equal(book.bookEdition, '初版');
});

test('JSON-LD：labtest MedicalTest、research ResearchProject、recruit JobPosting、procurement WebPage＋cdc:refNo', () => {
  const lab = ld('lab.test-r2')[0];
  assert.equal(lab['@type'], 'MedicalTest');
  assert.equal(lab.usedToDiagnose['@type'], 'MedicalCondition'); assert.equal(lab.usedToDiagnose.identifier, 'disease.dengue');
  assert.equal(lab['cdc:specimens'][0].name, '急性期血清'); assert.equal(lab['cdc:sendWithinHours'], 48); assert.equal(lab['cdc:notifyWithinHours'], 24);
  const r = ld('research.test-r2')[0];
  assert.equal(r['@type'], 'ResearchProject'); assert.equal(r['cdc:projectStatus'], 'ongoing'); assert.equal(r.funding.amount.value, 3000000);
  assert.ok(r.subjectOf.url.includes('/documents/'));
  const job = ld('news.test-r2-recruit')[0];
  assert.equal(job['@type'], 'JobPosting');
  assert.equal(job.title, '徵求約用研究助理'); assert.equal(job.validThrough, '2026-09-20'); assert.equal(job.datePosted, site.byId.get('news.test-r2-recruit').publishedAt);
  assert.equal(job.hiringOrganization['@type'], 'GovernmentOrganization'); assert.equal(job.jobLocation.address.addressLocality, '臺北市');
  assert.equal(job.totalJobOpenings, 1); assert.equal(job['cdc:closed'], true);
  const proc = ld('news.test-r2-proc')[0];
  assert.equal(proc['@type'], 'WebPage'); assert.equal(proc['cdc:refNo'], 'CDC115-R2'); assert.equal(proc['cdc:validThrough'], '2026-10-15');
  assert.equal(ld('news.2026-09-22-enterovirus-alert')[0]['@type'], 'NewsArticle', '一般新聞稿不變');
});

test('JSON-LD：/about/ GovernmentOrganization＋subOrganization[]（units）', () => {
  const o = aboutOrgJsonLd(ctx());
  assert.equal(o['@type'], 'GovernmentOrganization');
  assert.equal(o.subOrganization.length, site.master.units.length);
  const vac = o.subOrganization.find((u) => u.identifier === 'unit.acute-infectious');
  assert.equal(vac['@type'], 'GovernmentOrganization'); assert.ok(vac.name); assert.ok(vac['cdc:contentCount'] >= 1);
  assert.equal(vac.parentOrganization['@id'], o['@id']);
});
