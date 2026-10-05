// 第十二輪（第五批前置）：後台「修改已上架內容」的純函式——API 一筆 → 表單 → 匯出 → 併回現行版；PR 只該多出真正改動的欄位。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as P from '../src/client/admin/preprocess.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const apiLike = (item) => ({ ...item, url: 'https://example/x/', path: '/x/', md: null, governance: { lifecycle: 'current' } });
const roundTrip = (item, patch = (f) => f) => {
  const f = patch(P.itemToForm(apiLike(item)));
  const out = P.buildExport({
    type: f.type, id: f.id, title: f.title, body: f.body, owner: f.owner, steward: item.steward, reviewPeriodMonths: f.period, audience: f.audience, tasks: f.tasks, basedOn: f.basedOn, langs: f.langs,
    summary: item.summary, keywords: item.keywords, diseases: item.diseases, vaccines: item.vaccines, countries: item.countries, today: '2026-10-05', extra: f.extra,
  });
  return P.mergeEdit(out, apiLike(item));
};

test('collectionOfId：id 前綴 → v1 集合；未知前綴 null', () => {
  assert.equal(P.collectionOfId('faq.dengue-painkiller'), 'faq'); assert.equal(P.collectionOfId('doc.flu-vaccine-manual.2026-09-16'), 'documents');
  assert.equal(P.collectionOfId('clar.2026-01-01-x'), 'clarifications'); assert.equal(P.collectionOfId('disease.dengue'), 'diseases'); assert.equal(P.collectionOfId('banner.x'), null);
});

test('Q&A 不改任何欄位：匯出併回後與現行版只差審閱日與狀態（PR 不會出現無關改動）', () => {
  const item = read('content/faq/dengue-painkiller.json');
  const merged = roundTrip(item);
  assert.deepEqual(P.editDiff(merged, apiLike(item)), []);
  assert.equal(merged.publishedAt, item.publishedAt); assert.equal(merged.reviewedAt, '2026-10-05'); assert.equal(merged.answerMarkdown, item.answerMarkdown);
  assert.deepEqual(merged.aiWhitelist, item.aiWhitelist); assert.equal(merged.status, 'draft');
  assert.ok(!('url' in merged) && !('governance' in merged) && !('path' in merged), 'API 專用欄位不寫回');
});

test('改一段內文：只有 answerMarkdown 在 editDiff 裡；發布日與白名單不動', () => {
  const item = read('content/faq/dengue-painkiller.json');
  const merged = roundTrip(item, (f) => ({ ...f, body: `${f.body}\n\n（補充：以上為示範修改。）` }));
  assert.deepEqual(P.editDiff(merged, apiLike(item)), ['answerMarkdown']);
  assert.equal(merged.publishedAt, item.publishedAt);
});

test('疾病頁：blocks ↔ 「## 區塊標題」內文可往返；只改一個區塊，其餘區塊、keyFacts、slug、法定類別原樣保留', () => {
  const item = read('content/diseases/dengue.json');
  const f = P.itemToForm(apiLike(item));
  assert.equal(f.type, 'disease'); assert.equal(f.extra.disease, 'disease.dengue');
  for (const b of item.blocks) assert.ok(f.body.includes(`## ${b.heading}`), b.heading);
  const same = roundTrip(item);
  assert.deepEqual(same.blocks, item.blocks); assert.deepEqual(same.keyFacts, item.keyFacts); assert.equal(same.slug, item.slug); assert.equal(same.legalCategory, item.legalCategory);
  assert.deepEqual(P.editDiff(same, apiLike(item)), []);
  const first = item.blocks.find((b) => b.markdown);
  const edited = roundTrip(item, (fm) => ({ ...fm, body: fm.body.replace(`## ${first.heading}\n\n${first.markdown.trim()}`, `## ${first.heading}\n\n${first.markdown.trim()}\n\n新增一句。`) }));
  assert.deepEqual(P.editDiff(edited, apiLike(item)), ['blocks']);
  assert.ok(edited.blocks.find((b) => b.key === first.key).markdown.endsWith('新增一句。'));
  assert.deepEqual(edited.blocks.filter((b) => b.key !== first.key), item.blocks.filter((b) => b.key !== first.key));
});

test('文件與專區：版本鏈欄位、連結清單（標題 | 網址 | 備註）往返不失真；既有附件照舊宣告', () => {
  const doc = read('content/documents/flu-vaccine-manual.2026-09-16.json');
  const fd = P.itemToForm(apiLike(doc));
  assert.equal(fd.extra.family, doc.family); assert.equal(fd.extra.version, String(doc.version)); assert.equal(fd.extra.supersedes, doc.supersedes ?? '');
  const md = roundTrip(doc);
  assert.equal(md.family, doc.family); assert.equal(md.machineReadableMarkdown, doc.machineReadableMarkdown); assert.equal(md.effectiveAt, doc.effectiveAt);
  if (doc.assets?.length) assert.deepEqual(md.assets, doc.assets);
  const topic = read('content/topics/amr-one-health.json');
  const ft = P.itemToForm(apiLike(topic));
  assert.equal(ft.extra.topicKind, topic.kind); assert.equal(ft.extra.links.split('\n').length, topic.links.length);
  const mt = roundTrip(topic);
  assert.deepEqual(mt.links.map((l) => [l.label, l.href]), topic.links.map((l) => [l.label, l.href]));
  assert.equal(mt.image, topic.image); assert.equal(mt.priority, topic.priority);
});

test('通函與澄清：型別由 newsType 判回 letter；claim／verdict／shareText 帶入表單', () => {
  const letter = fs.readdirSync(path.join(ROOT, 'content/news')).map((f) => read(`content/news/${f}`)).find((n) => n.newsType === 'letter' || n.type === 'letter');
  if (letter) { const f = P.itemToForm(apiLike(letter)); assert.equal(f.type, 'letter'); assert.equal(f.extra.letterNo, letter.letterNo == null ? '' : String(letter.letterNo)); }
  const clar = fs.readdirSync(path.join(ROOT, 'content/clarifications')).map((f) => read(`content/clarifications/${f}`))[0];
  const fc = P.itemToForm(apiLike(clar));
  assert.equal(fc.type, 'clarification'); assert.equal(fc.extra.claim, clar.claim); assert.equal(fc.extra.verdict, clar.verdict); assert.equal(fc.body, clar.clarificationMarkdown);
});
