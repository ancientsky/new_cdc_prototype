// 第八輪（ARCHITECTURE 16.1）：檔案資產——宣告核對、--fix-assets、複製到 dist、內文圖片渲染、治理待辦、catalog、連結檢查。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import {
  validateAssets, fixAssets, copyAssets, assetUrl, normalizeFileLinks, imageSize, svgProblems, pdfHasTextLayer, sha256Of,
  suggestFileName, fileNameProblems, replaceTopLevelValue, fileRefsOf, imageLicenseProblems, ASSETS_DIR, MIME_BY_EXT,
} from '../scripts/lib/assets.mjs';
import { md, setAssetRegistry, getAssetRegistry } from '../scripts/lib/markdown.mjs';
import { emitApi } from '../scripts/lib/emit-api.mjs';
import { externalLinksOf } from '../scripts/lib/governance.mjs';
import { checkInternalLinks } from '../scripts/lib/check-internal-links.mjs';
import { loadSite } from '../scripts/lib/load.mjs';
import { makeCtx } from '../scripts/lib/pages.mjs';
import * as newsTpl from '../src/templates/public/news.mjs';
import { mk, addItem, govern, memWriter, config } from './helpers.mjs';

// ───────────────────────── 測試素材 ─────────────────────────

const tmpDir = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
/** 合法單頁 PDF（含文字層）；withText:false ⇒ 無 BT…Tj */
function tinyPdf(withText = true) {
  const content = withText ? 'BT /F1 12 Tf 72 720 Td (Hello sample) Tj ET' : '0 0 1 rg 72 72 100 100 re f';
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${content.length} >>\nstream\n${content}\nendstream`];
  let body = '%PDF-1.4\n'; const off = [];
  objs.forEach((o, i) => { off.push(body.length); body += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = body.length;
  body += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${off.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}
/** 壓縮串流版 PDF（FlateDecode）＝文字層偵測要能解壓 */
function flatePdf() {
  const z = zlib.deflateSync(Buffer.from('BT /F1 12 Tf 72 720 Td (Compressed) Tj ET'));
  return Buffer.concat([Buffer.from(`%PDF-1.5\n1 0 obj\n<< /Length ${z.length} /Filter /FlateDecode >>\nstream\n`, 'latin1'), z, Buffer.from('\nendstream\nendobj\n/Font\n%%EOF\n', 'latin1')]);
}
/** 1×1 以上的 PNG（只需檔頭正確即可判讀尺寸） */
function tinyPng(w = 3, h = 2) {
  const crcT = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h, 200); for (let y = 0; y < h; y++) raw[y * (w * 3 + 1)] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const SAFE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180"><title>圖</title><rect width="320" height="180" fill="#fff"/></svg>\n';

/** 建一個暫存 assets 目錄：{ 'id/file': Buffer|string } */
function fakeAssets(files) {
  const dir = tmpDir('cdc-assets-');
  for (const [rel, body] of Object.entries(files)) { const p = path.join(dir, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, body); }
  return dir;
}
/** 宣告（自動填正確的 bytes／sha256／mime） */
function decl(buf, file, extra = {}) {
  const ext = file.split('.').pop();
  return { file, mime: MIME_BY_EXT[ext], bytes: buf.length, sha256: sha256Of(buf), ...extra };
}
const miniSite = (items) => ({ all: items, byId: new Map(items.map((i) => [i.id, i])), config });
const withFile = (it) => Object.assign(it, { __file: `test/${it.id}.json` });

// ───────────────────────── 真實內容 ─────────────────────────

test('repo 內容：檔案資產全部通過驗證；至少 6 筆內容有 assets、至少 3 筆 /pending/ 改成 /files/', () => {
  const site = loadSite(config);
  const r = validateAssets(site, config);
  assert.deepEqual(r.errors, [], r.errors.join('\n'));
  assert.deepEqual(r.orphans, []);
  const withAssets = site.all.filter((i) => i.assets?.length);
  assert.ok(withAssets.length >= 6, `有 assets 的內容 ${withAssets.length} 筆`);
  for (const k of ['attachment', 'image', 'data']) assert.ok(r.byKind[k] >= 1, `至少一個 ${k}`);
  // 原本指向 /pending/ 的三個欄位
  assert.match(site.byId.get('doc.tb-guideline.2025-09-01').pdfUrl, /^\/files\/doc\.tb-guideline\.2025-09-01\/.+\.pdf$/);
  assert.match(site.byId.get('publication.poster-tb-seven-languages').pdfUrl, /^\/files\/publication\.poster-tb-seven-languages\/.+\.pdf$/);
  assert.match(site.byId.get('service.ltbi-treatment').forms[0].href, /^\/files\/service\.ltbi-treatment\/.+\.pdf$/);
  // 新聞稿：PDF 附件＋內文 SVG；專區圖片有 source／license；資料集有 kind data
  const news = site.byId.get('news.2026-09-18-flu-antiviral-extended');
  assert.ok(news.assets.some((a) => a.kind === 'attachment' && a.file.endsWith('.pdf')));
  assert.ok(news.assets.some((a) => a.kind === 'image' && a.file.endsWith('.svg')));
  assert.match(news.bodyMarkdown, /!\[[^\]]*\]\(\/files\/news\.2026-09-18-flu-antiviral-extended\/chart-ili\.svg\)/);
  const img = site.byId.get('topic.tb-prevention').assets.find((a) => a.kind === 'image');
  assert.ok(img.source && img.license && img.width && img.height);
  assert.ok(site.byId.get('dataset.tb-new-cases').assets.some((a) => a.kind === 'data' && a.file.endsWith('.csv')));
  // 文件 PDF 有可及性版本
  const doc = site.byId.get('doc.tb-guideline.2025-09-01');
  const pdf = doc.assets.find((a) => a.file.endsWith('.pdf'));
  assert.ok(pdf.accessibleAlt && doc.assets.some((a) => a.file === pdf.accessibleAlt));
  // 樣本 PDF 有文字層
  assert.equal(pdfHasTextLayer(fs.readFileSync(path.join(ASSETS_DIR, news.id, 'press-release.pdf'))), true);
});

// ───────────────────────── 驗證：各種錯誤 ─────────────────────────

test('宣告缺檔、hash／bytes 不符、mime 與副檔名不一致、內容與副檔名不符 → 各自錯誤（訊息給實際值）', () => {
  const pdf = tinyPdf();
  const png = tinyPng();
  const dir = fakeAssets({ 'faq.a1/ok.pdf': pdf, 'faq.a1/changed.pdf': pdf, 'faq.a1/fake.png': 'not a png', 'faq.a1/wrong-mime.pdf': pdf, 'faq.a1/nohash.png': png });
  const item = withFile(mk({ id: 'faq.a1', assets: [
    decl(pdf, 'ok.pdf', { kind: 'attachment', label: '正常', machineReadable: true }),
    { file: 'missing.pdf', kind: 'attachment', label: '缺檔', mime: 'application/pdf', bytes: 1, sha256: 'a'.repeat(64) },
    decl(pdf, 'changed.pdf', { kind: 'attachment', label: '換過', sha256: 'b'.repeat(64), bytes: 10 }),
    decl(Buffer.from('not a png'), 'fake.png', { kind: 'image', alt: '假圖', license: 'OGDL-1.0' }),
    decl(pdf, 'wrong-mime.pdf', { kind: 'attachment', label: 'mime 錯', mime: 'application/octet-stream' }),
    { file: 'nohash.png', kind: 'image', alt: '缺 hash', license: 'OGDL-1.0' },
  ] }));
  const r = validateAssets(miniSite([item]), config, { assetsDir: dir });
  const has = (re) => r.errors.some((e) => re.test(e));
  assert.ok(!r.errors.some((e) => e.includes('（ok.pdf）')), '正常檔不報錯');
  assert.ok(has(/missing\.pdf.*檔案不存在/), '缺檔');
  assert.ok(has(new RegExp(`changed\\.pdf.*sha256 不符：宣告 b{64}、實際 ${sha256Of(pdf)}`)), 'hash 不符給實際值');
  assert.ok(has(new RegExp(`changed\\.pdf.*bytes 不符：宣告 10、實際 ${pdf.length}`)), 'bytes 不符');
  assert.ok(has(/fake\.png.*內容與副檔名 \.png 不符/), '內容判讀');
  assert.ok(has(/wrong-mime\.pdf.*mime「application\/octet-stream」與副檔名 \.pdf 不一致（應為 application\/pdf）/), 'mime 不一致');
  assert.ok(has(new RegExp(`nohash\\.png.*缺 sha256（實際 ${sha256Of(png)}）`)), '缺 sha256 印出正確值');
  assert.ok(has(/nohash\.png.*缺 bytes/) && has(/nohash\.png.*缺 mime（應為 image\/png）/));
  assert.ok(r.errors.every((e) => e.startsWith('test/faq.a1.json: ')), '錯誤訊息以內容檔路徑開頭');
});

test('檔名不合法（空白、中文、大寫）→ 錯誤並給建議檔名；副檔名不在允許清單、kind 與副檔名不合、缺 label', () => {
  assert.equal(suggestFileName('Press Release 2026.PDF'), 'press-release-2026.pdf');
  assert.equal(suggestFileName('Chart_ILI v2.png'), 'chart_ili-v2.png');
  assert.match(suggestFileName('新聞稿.pdf'), /^file-[0-9a-f]{6}\.pdf$/);
  assert.deepEqual(fileNameProblems('press-release.pdf'), []);
  assert.ok(fileNameProblems('新聞稿.pdf').includes('不可有中文或全形字'));
  assert.ok(fileNameProblems('a b.pdf').includes('不可有空白'));
  assert.ok(fileNameProblems('Report.pdf').includes('只能用小寫'));
  const dir = fakeAssets({ 'faq.a2/Press Release.pdf': tinyPdf(), 'faq.a2/run.exe': 'MZ', 'faq.a2/table.csv': 'a,b\n1,2\n', 'faq.a2/note.md': '# x\n' });
  const item = withFile(mk({ id: 'faq.a2', assets: [
    decl(tinyPdf(), 'Press Release.pdf', { kind: 'attachment', label: 'x' }),
    { file: 'run.exe', kind: 'attachment', label: '執行檔' },
    decl(Buffer.from('a,b\n1,2\n'), 'table.csv', { kind: 'image', alt: '表', license: 'OGDL-1.0' }),
    decl(Buffer.from('# x\n'), 'note.md', { kind: 'attachment' }),
  ] }));
  const r = validateAssets(miniSite([item]), config, { assetsDir: dir });
  const has = (re) => r.errors.some((e) => re.test(e));
  assert.ok(has(/Press Release\.pdf.*檔名不合法：不可有空白、只能用小寫；建議改為「press-release\.pdf」/));
  assert.ok(has(/run\.exe.*副檔名 \.exe 不在允許清單/));
  assert.ok(has(/table\.csv.*kind image 只能是圖片/));
  assert.ok(has(/note\.md.*附件必須填 label/));
});

test('SVG 含 <script> 或 on*= ⇒ 建置失敗；安全 SVG 通過並讀出 viewBox 尺寸', () => {
  assert.deepEqual(svgProblems(SAFE_SVG), []);
  assert.ok(svgProblems('<svg><script>alert(1)</script></svg>').includes('含 <script>'));
  assert.ok(svgProblems('<svg onload="x()"></svg>').some((p) => p.startsWith('含事件屬性 onload')));
  assert.ok(svgProblems('<svg><a href="javascript:alert(1)"/></svg>').includes('含 javascript: 連結'));
  const bad = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect onclick="steal()" width="10" height="10"/><script>1</script></svg>';
  const dir = fakeAssets({ 'faq.a3/bad.svg': bad, 'faq.a3/ok.svg': SAFE_SVG });
  const item = withFile(mk({ id: 'faq.a3', assets: [decl(Buffer.from(bad), 'bad.svg', { kind: 'image', alt: '壞圖', license: 'OGDL-1.0' }), decl(Buffer.from(SAFE_SVG), 'ok.svg', { kind: 'image', alt: '好圖', license: 'OGDL-1.0' })] }));
  const r = validateAssets(miniSite([item]), config, { assetsDir: dir });
  assert.ok(r.errors.some((e) => /bad\.svg.*SVG 不安全：含 <script>/.test(e)));
  assert.ok(r.errors.some((e) => /bad\.svg.*SVG 不安全：含事件屬性 onclick/.test(e)));
  assert.ok(!r.errors.some((e) => e.includes('ok.svg')), r.errors.join('\n'));
  assert.deepEqual(imageSize(Buffer.from(SAFE_SVG), 'svg'), { width: 320, height: 180 });
});

test('圖片無 alt ⇒ 建置失敗（Markdown alt 與 assets.alt 擇一非空即可）；無 license ⇒ 建置失敗；引用未宣告／kind 不是 image ⇒ 失敗', () => {
  const png = tinyPng();
  const dir = fakeAssets({ 'news.a4/a.png': png, 'news.a4/b.png': png, 'news.a4/c.png': png, 'news.a4/d.png': png, 'news.a4/doc.pdf': tinyPdf() });
  const item = withFile(mk({ type: 'news', id: 'news.a4',
    bodyMarkdown: '![](/files/news.a4/a.png)\n\n![有 Markdown 替代文字](/files/news.a4/b.png)\n\n![](/files/news.a4/c.png)\n\n![圖](/files/news.a4/doc.pdf)\n\n[未宣告](/files/news.a4/ghost.pdf)\n\n![x](/files/news.nobody/x.png)',
    assets: [
      decl(png, 'a.png', { kind: 'image', license: 'OGDL-1.0' }), // 無 alt、Markdown 也空 ⇒ 錯
      decl(png, 'b.png', { kind: 'image', license: 'OGDL-1.0' }), // Markdown 有 alt ⇒ 過
      decl(png, 'c.png', { kind: 'image', alt: 'assets 的替代文字', license: 'OGDL-1.0' }), // assets 有 alt ⇒ 過
      decl(png, 'd.png', { kind: 'image', alt: '未引用但缺授權' }), // 缺 license ⇒ 錯
      decl(tinyPdf(), 'doc.pdf', { kind: 'attachment', label: '文件', machineReadable: true }),
    ] }));
  const r = validateAssets(miniSite([item]), config, { assetsDir: dir });
  const has = (re) => r.errors.some((e) => re.test(e));
  assert.ok(has(/bodyMarkdown 圖片 \/files\/news\.a4\/a\.png 沒有替代文字/), r.errors.join('\n'));
  assert.ok(!has(/b\.png 沒有替代文字/) && !has(/c\.png 沒有替代文字/));
  assert.ok(has(/d\.png.*圖片必須填 license/));
  assert.ok(has(/以圖片引用 \/files\/news\.a4\/doc\.pdf，但宣告的 kind 是 attachment/));
  assert.ok(has(/引用 \/files\/news\.a4\/ghost\.pdf，但 news\.a4 的 assets 未宣告 ghost\.pdf/));
  assert.ok(has(/引用 \/files\/news\.nobody\/x\.png，但內容 news\.nobody 不存在/));
  // 圖片沒被引用也沒 alt ⇒ 錯
  const dir2 = fakeAssets({ 'faq.a5/x.png': png });
  const r2 = validateAssets(miniSite([withFile(mk({ id: 'faq.a5', assets: [decl(png, 'x.png', { kind: 'image', license: 'OGDL-1.0' })] }))]), config, { assetsDir: dir2 });
  assert.ok(r2.errors.some((e) => /x\.png）圖片必須填 alt/.test(e)));
  // 引用掃描：附件欄位、HTML <img>、i18n 都算
  const refs = fileRefsOf({ id: 'news.z', attachments: [{ url: '/files/news.z/a.pdf' }], i18n: { en: { bodyMarkdown: '<img src="/files/news.z/b.png" alt="">' } }, legacyUrls: ['/files/news.z/skip.pdf'] });
  assert.deepEqual(refs.map((x) => [x.file, x.image]), [['a.pdf', false], ['b.png', true]]);
});

test('大小上限、每筆檔數上限、孤兒檔（警告）、content/assets 下的 id 不存在（錯誤）、accessibleAlt 未宣告', () => {
  const png = tinyPng();
  const dir = fakeAssets({ 'faq.a6/a.png': png, 'faq.a6/orphan.txt': 'x', 'faq.a6/doc.pdf': tinyPdf(false), 'faq.gone/x.pdf': tinyPdf() });
  const item = withFile(mk({ id: 'faq.a6', assets: [decl(png, 'a.png', { kind: 'image', alt: '圖', license: 'OGDL-1.0' }), decl(tinyPdf(false), 'doc.pdf', { kind: 'attachment', label: '文件', accessibleAlt: 'doc.md' })] }));
  const tight = { ...config, assets: { ...config.assets, maxBytes: { ...config.assets.maxBytes, image: 10 }, maxFiles: 1 } };
  const r = validateAssets(miniSite([item]), tight, { assetsDir: dir });
  const has = (re) => r.errors.some((e) => re.test(e));
  assert.ok(has(/a\.png）.* 超過圖片上限 10 B/), r.errors.join('\n'));
  assert.ok(has(/assets 共 2 個檔，超過每筆上限 1 個/));
  assert.ok(has(/accessibleAlt「doc\.md」未在本筆 assets 宣告/));
  assert.ok(has(/faq\.gone\/: 內容 id faq\.gone 不存在/));
  assert.deepEqual(r.orphans.map((o) => `${o.id}/${o.file}`), ['faq.a6/orphan.txt']);
  assert.ok(r.warnings.some((w) => /orphan\.txt: 孤兒檔/.test(w)));
  assert.ok(!r.errors.some((e) => e.includes('orphan.txt')), '孤兒檔只警告');
  // 預設上限（20 MB／2 MB／50 MB）來自 site.config
  assert.equal(config.assets.maxBytes.pdf, 20 * 1024 * 1024);
  assert.equal(config.assets.maxBytes.image, 2 * 1024 * 1024);
  assert.equal(config.assets.maxBytes.data, 50 * 1024 * 1024);
  assert.equal(config.assets.maxFiles, 30);
});

test('PDF 文字層偵測：未壓縮與 FlateDecode 都讀得到；純圖形 PDF ⇒ 宣告 machineReadable:true 時警告', () => {
  assert.equal(pdfHasTextLayer(tinyPdf(true)), true);
  assert.equal(pdfHasTextLayer(flatePdf()), true);
  assert.equal(pdfHasTextLayer(tinyPdf(false)), false);
  const scan = tinyPdf(false);
  const dir = fakeAssets({ 'faq.a7/scan.pdf': scan });
  const r = validateAssets(miniSite([withFile(mk({ id: 'faq.a7', assets: [decl(scan, 'scan.pdf', { kind: 'attachment', label: '掃描檔', machineReadable: true })] }))]), config, { assetsDir: dir });
  assert.deepEqual(r.errors, []);
  assert.ok(r.warnings.some((w) => /scan\.pdf.*偵測不到文字層/.test(w)));
});

// ───────────────────────── 治理待辦 ─────────────────────────

test('治理：PDF 無可及性版本 ⇒ attachment-no-accessible-version（medium）；非本署圖片缺 source ⇒ image-license-missing；孤兒檔 ⇒ asset-orphan（low）', () => {
  let pubA, pubB, draft;
  const site = govern('2026-10-01', (s) => {
    pubA = addItem(s, mk({ type: 'publication', assets: [
      { file: 'scan.pdf', kind: 'attachment', label: '掃描版', machineReadable: false },
      { file: 'ok.pdf', kind: 'attachment', label: '有替代', machineReadable: false, accessibleAlt: 'ok.md' },
      { file: 'ok.md', kind: 'attachment', label: '純文字版', machineReadable: true },
      { file: 'text.pdf', kind: 'attachment', label: '有文字層', machineReadable: true },
      { file: 'unknown.pdf', kind: 'attachment', label: '未標示' },
      { file: 'photo.jpg', kind: 'image', alt: '照片', license: 'CC-BY-4.0' }, // 非本署、缺 source ⇒ 待辦
      { file: 'photo2.jpg', kind: 'image', alt: '照片', license: 'CC-BY-4.0', source: 'WHO（CC BY 4.0）' }, // 有 source ⇒ 不開
      { file: 'own.png', kind: 'image', alt: '自製', license: 'OGDL-1.0' }, // 本署素材 ⇒ 不開
      { file: 'nc.png', kind: 'image', alt: '限制授權', license: 'CC-BY-NC-4.0', source: '某學會' }, // 非開放授權 ⇒ 待辦
    ] }));
    pubB = addItem(s, mk({ type: 'publication' }));
    draft = addItem(s, mk({ type: 'publication', status: 'draft', assets: [{ file: 'd.pdf', kind: 'attachment', label: '草稿' }] }));
    s.assetReport = { orphans: [{ id: pubB.id, file: 'old.pdf', bytes: 10 }, { id: pubB.id, file: 'old.png', bytes: 5 }] };
  });
  const todos = (kind, id) => site.gov.todos.filter((t) => t.kind === kind && t.itemId === id);
  const acc = todos('attachment-no-accessible-version', pubA.id);
  assert.deepEqual(acc.map((t) => t.file).sort(), ['scan.pdf', 'unknown.pdf']);
  assert.ok(acc.every((t) => t.severity === 'medium' && t.url === assetUrl(pubA, t.file) && t.kindLabel === 'PDF 附件缺可及性版本'));
  const lic = todos('image-license-missing', pubA.id);
  assert.deepEqual(lic.map((t) => t.file).sort(), ['nc.png', 'photo.jpg']);
  assert.ok(lic.find((t) => t.file === 'photo.jpg').text.includes('未註明來源（source）'));
  assert.ok(lic.find((t) => t.file === 'nc.png').text.includes('不在開放授權清單'));
  assert.ok(lic.every((t) => t.severity === 'medium'));
  const orphan = todos('asset-orphan', pubB.id);
  assert.equal(orphan.length, 1, '同一筆內容的孤兒檔聚合成一則');
  assert.equal(orphan[0].severity, 'low');
  assert.deepEqual(orphan[0].files, ['old.pdf', 'old.png']);
  assert.equal(site.gov.todos.filter((t) => t.itemId === draft.id).length, 0, '草稿不開資產待辦');
  assert.equal(pubA.gov.assets.count, 9);
  assert.deepEqual(pubA.gov.assets.noAccessibleVersion.sort(), ['scan.pdf', 'unknown.pdf']);
  assert.equal(site.gov.assets.orphans, 2);
  // 授權規則本身
  assert.deepEqual(imageLicenseProblems({ license: 'OGDL-1.0' }, config.licenses.allowed), []);
  assert.deepEqual(imageLicenseProblems({}, config.licenses.allowed), ['缺授權（license）']);
});

test('外部連結健康檢查不碰 /files/（站內檔案由建置後連結檢查確認）', () => {
  const sv = mk({ type: 'service', forms: [{ label: '表單', href: '/files/service.x/form.pdf' }, { label: '本站絕對網址', href: `${config.siteUrl}${config.basePath}/files/service.x/form.md` }, { label: '外部', href: 'https://www.gov.tw/form.pdf' }] });
  assert.deepEqual(externalLinksOf(sv).map((l) => l.url), ['https://www.gov.tw/form.pdf']);
  const pub = mk({ type: 'publication', pdfUrl: '/files/pub.x/a.pdf' });
  assert.deepEqual(externalLinksOf(pub), []);
});

// ───────────────────────── --fix-assets ─────────────────────────

test('fixAssets：補寫 bytes／sha256／mime／width／height 回 JSON，只動 assets 那一段（其餘格式原樣）；之後驗證通過', () => {
  const root = tmpDir('cdc-fix-');
  const png = tinyPng(7, 5);
  const svg = SAFE_SVG;
  const pdf = tinyPdf();
  const dir = fakeAssets({ 'faq.fix/pic.png': png, 'faq.fix/pic.svg': svg, 'faq.fix/doc.pdf': pdf });
  // 故意用非標準縮排的其他欄位，確認不被重排
  const text = `{
  "id": "faq.fix",
  "type": "faq",
  "audience": ["public"],
  "assets": [
    { "file": "pic.png", "kind": "image", "alt": "小圖", "license": "OGDL-1.0" },
    { "file": "pic.svg", "kind": "image", "alt": "向量圖", "license": "OGDL-1.0", "sha256": "${'0'.repeat(64)}" },
    { "file": "doc.pdf", "kind": "attachment", "label": "文件", "machineReadable": true }
  ],
  "summary": "不動 { \\"assets\\": [] } 這段字串"
}
`;
  fs.mkdirSync(path.join(root, 'content/faq'), { recursive: true });
  const rel = 'content/faq/fix.json';
  fs.writeFileSync(path.join(root, rel), text);
  const item = { ...JSON.parse(text), __file: rel };
  const site = miniSite([item]);
  const r = fixAssets(site, { assetsDir: dir, root });
  assert.deepEqual(r.written, [rel]);
  assert.deepEqual(r.changed.map((c) => c.file), ['pic.png', 'pic.svg', 'doc.pdf']);
  const out = fs.readFileSync(path.join(root, rel), 'utf8');
  const j = JSON.parse(out);
  assert.deepEqual([j.assets[0].width, j.assets[0].height, j.assets[0].mime, j.assets[0].bytes, j.assets[0].sha256], [7, 5, 'image/png', png.length, sha256Of(png)]);
  assert.deepEqual([j.assets[1].width, j.assets[1].height, j.assets[1].sha256], [320, 180, sha256Of(Buffer.from(svg))]);
  assert.equal(j.assets[2].mime, 'application/pdf');
  assert.ok(out.includes('"audience": ["public"],'), '其他欄位格式不變');
  assert.ok(out.includes('"summary": "不動 { \\"assets\\": [] } 這段字串"'), '字串內的 assets 不受影響');
  assert.ok(out.includes('  "assets": [\n    {\n      "file": "pic.png",\n      "kind": "image",'), 'assets 以兩格縮排寫回、欄位依標準順序');
  assert.ok(out.endsWith('}\n'));
  assert.deepEqual(validateAssets(site, config, { assetsDir: dir }).errors, []);
  // 再跑一次：不再改寫
  assert.deepEqual(fixAssets(miniSite([{ ...JSON.parse(out), __file: rel }]), { assetsDir: dir, root }).written, []);
  // replaceTopLevelValue：找不到 key ⇒ null
  assert.equal(replaceTopLevelValue('{ "a": 1 }', 'assets', []), null);
});

test('imageSize：PNG、JPEG（SOF0）、WebP（VP8X）檔頭', () => {
  assert.deepEqual(imageSize(tinyPng(11, 4), 'png'), { width: 11, height: 4 });
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x2a, 0x00, 0x40, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(imageSize(jpeg, 'jpg'), { width: 64, height: 42 });
  const webp = Buffer.alloc(30);
  webp.write('RIFF', 0, 'latin1'); webp.write('WEBP', 8, 'latin1'); webp.write('VP8X', 12, 'latin1');
  webp.writeUIntLE(99, 24, 3); webp.writeUIntLE(49, 27, 3);
  assert.deepEqual(imageSize(webp, 'webp'), { width: 100, height: 50 });
});

// ───────────────────────── 複製到 dist ─────────────────────────

test('copyAssets：只複製 published／archived 內容有宣告的檔到 dist/files/{id}/；孤兒檔與草稿不複製', () => {
  const pdf = tinyPdf();
  const dir = fakeAssets({ 'faq.cp/a.pdf': pdf, 'faq.cp/orphan.pdf': pdf, 'faq.arch/b.pdf': pdf, 'faq.draft/c.pdf': pdf });
  const items = [
    mk({ id: 'faq.cp', assets: [decl(pdf, 'a.pdf', { kind: 'attachment', label: 'a' })] }),
    mk({ id: 'faq.arch', status: 'archived', assets: [decl(pdf, 'b.pdf', { kind: 'attachment', label: 'b' })] }),
    mk({ id: 'faq.draft', status: 'draft', assets: [decl(pdf, 'c.pdf', { kind: 'attachment', label: 'c' })] }),
  ];
  const dist = tmpDir('cdc-dist-files-');
  const r = copyAssets(miniSite(items), dist, { assetsDir: dir });
  assert.deepEqual([r.items, r.files, r.bytes], [2, 2, pdf.length * 2]);
  assert.ok(fs.existsSync(path.join(dist, 'files/faq.cp/a.pdf')));
  assert.ok(fs.existsSync(path.join(dist, 'files/faq.arch/b.pdf')));
  assert.ok(!fs.existsSync(path.join(dist, 'files/faq.cp/orphan.pdf')));
  assert.ok(!fs.existsSync(path.join(dist, 'files/faq.draft')));
  assert.equal(sha256Of(fs.readFileSync(path.join(dist, 'files/faq.cp/a.pdf'))), sha256Of(pdf));
  assert.equal(assetUrl(items[0], 'a.pdf'), '/files/faq.cp/a.pdf');
  assert.equal(assetUrl('faq.cp', { file: 'a.pdf' }), '/files/faq.cp/a.pdf');
});

// ───────────────────────── 渲染 ─────────────────────────

test('md()：/files/ 圖片加 basePath、以 assets.alt 補空白 alt、加 width／height 與 loading="lazy"', () => {
  const prev = getAssetRegistry();
  try {
    const assets = [{ file: 'c.png', kind: 'image', alt: '趨勢圖（示意）', width: 640, height: 360 }];
    const out = md('文字\n\n![](/files/news.r1/c.png)\n\n![自己的 alt](/files/news.r1/c.png)\n\n![](https://example.org/x.png)', { assets, id: 'news.r1' });
    const imgs = out.match(/<img[^>]*>/g);
    assert.equal(imgs.length, 3);
    assert.ok(imgs[0].includes(`src="${config.basePath}/files/news.r1/c.png"`), imgs[0]);
    assert.ok(imgs[0].includes('alt="趨勢圖（示意）"') && imgs[0].includes('width="640"') && imgs[0].includes('height="360"'));
    assert.ok(imgs[1].includes('alt="自己的 alt"'), 'Markdown 有 alt 時保留');
    assert.ok(imgs.every((t) => t.includes('loading="lazy"') && t.includes('decoding="async"')));
    assert.ok(!imgs[2].includes('width='), '非本站檔案不加尺寸');
    // 全站登錄（治理引擎設定）：模板不必傳第二參數
    setAssetRegistry(new Map([['/files/news.r2/d.svg', { alt: '登錄的 alt', width: 10, height: 20 }]]));
    const viaReg = md('![](/files/news.r2/d.svg)');
    assert.match(viaReg, /alt="登錄的 alt" width="10" height="20" loading="lazy"/);
  } finally { setAssetRegistry(prev); }
});

test('新聞稿頁：內文圖片帶 assets.alt、lazy、尺寸；附件連結（含英文頁）正規化為 basePath + /files/（不含語言前綴）', () => {
  const site = govern('2026-10-01');
  const n = site.byId.get('news.2026-09-18-flu-antiviral-extended');
  const zh = String(newsTpl.render(makeCtx(site, 'zh-TW', { path: '/news/2026-09-18-flu-antiviral-extended/' }), { item: n }));
  const img = zh.match(/<img[^>]*chart-ili\.svg[^>]*>/)?.[0];
  assert.ok(img, '內文有圖');
  const alt = n.assets.find((a) => a.file === 'chart-ili.svg').alt;
  assert.ok(img.includes(`alt="${alt}"`), img);
  assert.ok(img.includes('loading="lazy"') && img.includes('width="640"') && img.includes('height="360"'));
  assert.ok(img.includes(`src="${config.basePath}/files/news.2026-09-18-flu-antiviral-extended/chart-ili.svg"`));
  const en = String(newsTpl.render(makeCtx(site, 'en', { path: '/news/2026-09-18-flu-antiviral-extended/' }), { item: n }));
  const fixed = normalizeFileLinks(en, { basePath: config.basePath, langs: config.langs, siteUrl: config.siteUrl });
  assert.ok(fixed.includes(`href="${config.basePath}/files/news.2026-09-18-flu-antiviral-extended/press-release.pdf"`), '英文頁附件不帶 /en/');
  assert.ok(!/\/en\/files\//.test(fixed));
});

test('normalizeFileLinks：去語言前綴、補 basePath、本站絕對網址也處理；外部網址不動', () => {
  const opts = { basePath: '/base', langs: config.langs, siteUrl: 'https://proto.test' };
  const html = '<a href="/base/en/files/a.b/x.pdf">1</a><a href="/files/a.b/x.pdf">2</a><img src="/base/files/a.b/y.png"><a href="https://proto.test/base/vi/files/a.b/x.pdf">3</a><a href="https://who.int/en/files/z.pdf">4</a><a href="/base/en/news/">5</a>';
  const out = normalizeFileLinks(html, opts);
  assert.equal((out.match(/"\/base\/files\/a\.b\//g) ?? []).length, 3);
  assert.ok(out.includes('https://proto.test/base/files/a.b/x.pdf'));
  assert.ok(out.includes('https://who.int/en/files/z.pdf'));
  assert.ok(out.includes('/base/en/news/'));
  assert.equal(normalizeFileLinks('<p>no files</p>', opts), '<p>no files</p>');
});

// ───────────────────────── API 與連結檢查 ─────────────────────────

test('catalog.json 每筆有 assets 摘要（file、kind、label、url、bytes、machineReadable）；v1 內容 assets 帶 url', () => {
  const site = govern('2026-10-01');
  const { files, write } = memWriter();
  emitApi(site, write);
  const cat = JSON.parse(files.get('v1/catalog.json')).data;
  assert.ok(cat.every((x) => Array.isArray(x.assets)), '每筆都有 assets 陣列');
  assert.ok(cat.every((x) => x.title), 'catalog 每筆有 title');
  const news = cat.find((x) => x.id === 'news.2026-09-18-flu-antiviral-extended');
  const pdf = news.assets.find((a) => a.file === 'press-release.pdf');
  assert.deepEqual(Object.keys(pdf).slice(0, 7), ['file', 'kind', 'label', 'url', 'bytes', 'mime', 'machineReadable']);
  assert.equal(pdf.url, `${config.siteUrl}${config.basePath}/files/news.2026-09-18-flu-antiviral-extended/press-release.pdf`);
  assert.equal(pdf.machineReadable, true);
  assert.ok(news.assets.find((a) => a.kind === 'image').alt);
  const doc = cat.find((x) => x.id === 'doc.tb-guideline.2025-09-01');
  assert.match(doc.assets.find((a) => a.file.endsWith('.pdf')).accessibleAlt, /\/files\/doc\.tb-guideline\.2025-09-01\/tb-guideline-v8\.md$/);
  assert.ok(cat.find((x) => x.id === 'dataset.tb-new-cases').assets.some((a) => a.kind === 'data'));
  const v1news = JSON.parse(files.get('v1/news.json')).data.find((x) => x.id === news.id);
  assert.ok(v1news.assets.every((a) => a.url.startsWith(`${config.siteUrl}${config.basePath}/files/`)));
});

test('連結檢查：/files/ 是站內連結，檔案不存在 ⇒ error（附說明）；存在則通過', () => {
  const dir = tmpDir('cdc-dist-');
  const w = (rel, body) => { const p = path.join(dir, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, body); };
  w('index.html', '<!doctype html><html><body><a href="/base/files/news.a/ok.pdf">ok</a><a href="/base/files/news.a/gone.pdf">gone</a><a href="/base/en/files/news.a/ok.pdf">lang</a><img src="/base/files/news.a/ok.svg" alt=""></body></html>');
  w('files/news.a/ok.pdf', '%PDF-1.4');
  w('files/news.a/ok.svg', SAFE_SVG);
  const res = checkInternalLinks(dir, { basePath: '/base', siteUrl: 'https://proto.test', langs: config.langs, write: false });
  const miss = res.errors.filter((e) => e.kind === 'missing');
  assert.deepEqual(miss.map((e) => e.target).sort(), ['/en/files/news.a/ok.pdf', '/files/news.a/gone.pdf']);
  assert.ok(miss.every((e) => e.asset === true && e.hint));
  assert.ok(miss.find((e) => e.target.startsWith('/en/')).hint.includes('不含語言前綴'));
  assert.equal(res.counts.internalOk, 2);
});
