// 第二十一輪：長文件閱讀版面（src/templates/public/_longdoc.mjs；docs/pdf-ingest.md 第 8 節）。
// 只改呈現：每個段落仍有 id="s-{key}"、每頁仍有一個 id="page-N"，智慧查詢的引用連結不必改。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { govern } from './helpers.mjs';
import { makeCtx } from '../scripts/lib/pages.mjs';
import { buildSearchIndex } from '../scripts/lib/index-builder.mjs';
import * as documents from '../src/templates/public/documents.mjs';
import { isLongDoc, groupSections, outline } from '../src/templates/public/_longdoc.mjs';

const ID = 'doc.guidance-dengue.2026-02';
const site = govern('2026-10-06');
const doc = site.byId.get(ID);
const page = (d) => String(documents.render(makeCtx(site, 'zh-TW', { path: '/documents/x/' }), { item: d }));

test('哪些文件用長文件版面：PDF 轉來（有頁碼範圍）或 12 段以上；一般短文件維持原樣', () => {
  assert.equal(isLongDoc(doc.sections), true);
  assert.equal(isLongDoc([{ key: 'a' }, { key: 'b' }]), false);
  assert.equal(isLongDoc(Array.from({ length: 12 }, (_, i) => ({ key: `s${i}` }))), true);
  const short = site.byId.get('doc.case-definition-dengue.2026-01-01');
  const html = page(short);
  assert.doesNotMatch(html, /c-longdoc|c-ldmap/);
  for (const s of short.sections) assert.match(html, new RegExp(`id="s-${s.key}"`));
});

test('分章：前言、六章、參考文獻、附件共 9 組；章名取標題第一段，導言與分部（登革熱／屈公病）正確', () => {
  const g = groupSections(doc.sections);
  assert.deepEqual(g.map((x) => x.id), ['preface', 'ch1', 'ch2', 'ch3', 'ch4', 'ch5', 'ch6', 'references', 'annex']);
  const ch1 = g.find((x) => x.id === 'ch1');
  assert.equal(ch1.title, '第一章 疾病介紹');
  assert.equal(ch1.intro, null, '第一章沒有導言段');
  assert.deepEqual(ch1.items.map((i) => i.part), ['登革熱', '登革熱', '登革熱', '屈公病', '屈公病', '屈公病']);
  assert.equal(ch1.items[0].short, '第一節 疾病特性');
  assert.deepEqual(ch1.pages, [3, 18]);
  const ch2 = g.find((x) => x.id === 'ch2');
  assert.equal(ch2.intro.key, 'ch2');
  assert.equal(ch2.items.length, 5);
  const ch5 = g.find((x) => x.id === 'ch5');
  assert.deepEqual(ch5.items.map((i) => i.short), ['第一節 病例群聚定義', '第二節 病例群聚解除機制', '第三節 病例群聚防治工作要點', '屈公病']);
  const annex = g.find((x) => x.id === 'annex');
  assert.equal(annex.items.length, 12);
  assert.deepEqual(annex.pages, [72, 114]);
  // 每個段落剛好出現一次（沒有掉段）
  const keys = g.flatMap((x) => [x.intro?.key, ...x.items.map((i) => i.s.key)]).filter(Boolean);
  assert.deepEqual(keys, doc.sections.map((s) => s.key));
});

test('文件頁：章節卡、每段 id 與每頁錨點唯一（引用不會斷）、表單附件標「看 PDF」、側欄目錄兩層', () => {
  const html = page(doc);
  assert.match(html, /<nav class="c-ldmap" id="ld-map"/);
  assert.equal((html.match(/class="c-ldmap__list"/g) ?? []).length, 1);
  for (const s of doc.sections) assert.equal((html.match(new RegExp(`id="s-${s.key}"`, 'g')) ?? []).length, 1, s.key);
  const ids = [...html.matchAll(/id="(page-\d+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length, '頁碼錨點不重複');
  for (const p of [1, 22, 45, 55, 77]) assert.ok(ids.includes(`page-${p}`), `page-${p}`);
  // 智慧查詢索引裡這份文件的每一塊，網址錨點都找得到
  const chunks = buildSearchIndex(site).pro.filter((c) => c.contentId === ID);
  assert.ok(chunks.length > 60);
  for (const c of chunks) assert.ok(html.includes(`id="${c.url.split('#')[1]}"`), c.url);
  assert.match(html, /<details class="c-ldsec c-ldsec--pdfonly" id="s-annex-3">[\s\S]*?表單・看 PDF/);
  assert.match(html, /<details class="c-ldsec" id="s-references">/, '參考文獻不入索引，也收合');
  assert.match(html, /<div class="c-ldintro c-prose" id="s-preface">/, '前言直接攤開');
  assert.match(html, /<nav class="c-aside-card c-toc c-toc--long"[\s\S]*?<a href="#g-ch1">第一章 疾病介紹<\/a><ol><li><a href="#s-ch1-dengue-s1">登革熱・第一節 疾病特性<\/a>/);
  assert.match(html, /<span class="c-ldsec__p">第 55 頁<\/span>/);
});

test('公文條列縮排：壹、一、（一）1.（1）依層級加 class，接續段落沿用上一層', () => {
  const out = outline('<p>壹、登革熱</p>\n<p>一、臨床條件</p>\n<p>突發發燒並伴隨下列任二項以上症狀</p>\n<p>（一）頭痛</p>\n<p>2.持續性嘔吐</p>\n<p>（1）應記錄</p>\n<ol>\n<li>x</li>\n</ol>\n<p class="c-pagemark" id="page-3"><span>第 3 頁</span></p>');
  assert.match(out, /<p class="c-ol0 c-olh">壹、登革熱<\/p>/);
  assert.match(out, /<p class="c-ol1 c-olh">一、臨床條件<\/p>/);
  assert.match(out, /<p class="c-olc1">突發發燒/);
  assert.match(out, /<p class="c-ol2">（一）頭痛/);
  assert.match(out, /<p class="c-ol3">2\.持續性嘔吐/);
  assert.match(out, /<p class="c-ol4">（1）應記錄/);
  assert.match(out, /<ol class="c-olc4">/);
  assert.match(out, /<p class="c-pagemark" id="page-3">/, '有 class 的段落（頁碼標記）不動');
  // 長句的「一、」不當標題
  assert.doesNotMatch(outline('<p>一、各縣市轄區內如已發生登革熱群聚疫情，地方政府應視疫情規模執行防疫工作。</p>'), /c-olh/);
});

test('瀏覽器端：連到收合段落裡的錨點會先打開該段；全部展開／收合；列印前全展開', () => {
  const ui = fs.readFileSync('src/client/ui.js', 'utf8');
  assert.match(ui, /function openTo\(hash, scroll\)/);
  assert.match(ui, /addEventListener\('hashchange'/);
  assert.match(ui, /\[data-ld-toggle\]/);
  assert.match(ui, /addEventListener\('beforeprint'/);
});
