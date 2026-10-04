// 第八輪（Y2）：上架編輯器與附件／圖片面板。
//   單元：md-convert 雙向（含 Word 貼上清理、XSS 清除）、zip-store（用獨立的最小 ZIP reader 讀回、CRC32 對 node:zlib 與標準向量、unzip -t）、
//        檔名正規化、資產預檢規則、assets JSON 與放置路徑。
//   端到端：Playwright（有裝才跑；沒有 dist／playwright／chromium 就略過）——輸入所見即所得 → 切 Markdown → 預覽 → 加 PNG 與 PDF → 插圖 → 產生上架包。
//   截圖：SHOTS=1 npm test 會寫 docs/screenshots/admin-editor.png、admin-assets.png。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import net from 'node:net';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { marked } from 'marked';
import { htmlToMd, mdToHtml, sanitizeHtml, parseHtml, safeUrl, fileRefs, plainTextToHtml } from '../src/client/admin/md-convert.js';
import { createZip, crc32, zipPath } from '../src/client/admin/zip-store.js';
import * as P from '../src/client/admin/preprocess.js';
const { scanSvg, sniffMismatch, svgSize } = P;
import { config } from '../site.config.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const md2html = (m, o = {}) => mdToHtml(m, { marked, ...o });

// ───────────────────────── HTML → Markdown ─────────────────────────
test('htmlToMd：標題、段落、粗斜體、連結、圖片', () => {
  const out = htmlToMd('<h1>大</h1><h2>二</h2><h3>三</h3><h4>四</h4><h5>五</h5><p>這是<strong>粗</strong>、<b>也粗</b>、<em>斜</em>、<i>也斜</i>、<del>刪</del>。</p>'
    + '<p><a href="https://example.gov.tw/a?b=1&amp;c=2">外部</a> 與 <a href="/diseases/dengue/">站內</a></p><p><img src="/files/news.x/a.png" alt="圖 [一]"></p>');
  assert.equal(out, [
    '# 大', '## 二', '### 三', '#### 四', '#### 五',
    '這是**粗**、**也粗**、*斜*、*也斜*、~~刪~~。',
    '[外部](https://example.gov.tw/a?b=1&c=2) 與 [站內](/diseases/dengue/)',
    '![圖 \\[一\\]](/files/news.x/a.png)',
  ].join('\n\n'));
});

test('htmlToMd：粗斜體頭尾空白移到標記外；巢狀同種標記不重複', () => {
  assert.equal(htmlToMd('<p>a<strong> 粗 </strong>b</p>'), 'a **粗** b');
  assert.equal(htmlToMd('<p><strong>外<b>內</b></strong></p>'), '**外內**');
  assert.equal(htmlToMd('<p><strong> </strong>x</p>'), 'x');
  assert.equal(htmlToMd('<p><em><strong>粗斜</strong></em></p>'), '***粗斜***');
});

test('htmlToMd：巢狀清單（ul 內 ol、ol 內 ul、多層）', () => {
  const out = htmlToMd('<ul><li>甲<ol><li>甲一</li><li>甲二<ul><li>甲二a</li></ul></li></ol></li><li>乙</li></ul><ol start="3"><li>三</li><li>四</li></ol>');
  assert.equal(out, ['- 甲', '  1. 甲一', '  2. 甲二', '     - 甲二a', '- 乙', '', '3. 三', '4. 四'].join('\n'));
  // 反向：Markdown → HTML → Markdown 保持結構
  const again = htmlToMd(md2html(out));
  assert.equal(again, out);
});

test('htmlToMd：清單項目內的 <p>（Google Docs）與未封閉的 <li>', () => {
  assert.equal(htmlToMd('<ul><li><p>一</p></li><li><p>二</p></li></ul>'), '- 一\n- 二');
  assert.equal(htmlToMd('<ul><li>一<li>二<li>三</ul>'), '- 一\n- 二\n- 三');
});

test('htmlToMd：表格（thead／tbody、無 thead、| 跳脫、儲存格內換行與粗體、對齊忽略）', () => {
  assert.equal(
    htmlToMd('<table><thead><tr><th align="right">病名</th><th>潛伏期</th></tr></thead><tbody><tr><td>登革熱</td><td>3|14 天<br>（<b>約</b>）</td></tr><tr><td></td><td><br></td></tr></tbody></table>'),
    ['| 病名 | 潛伏期 |', '| --- | --- |', '| 登革熱 | 3\\|14 天<br>（**約**） |', '|   |   |'].join('\n'),
  );
  // 沒有 thead／th：第一列當表頭；欄數不齊補空
  assert.equal(htmlToMd('<table><tr><td>a</td><td>b</td></tr><tr><td>c</td></tr></table>'), '| a | b |\n| --- | --- |\n| c |   |');
  // 往返
  const t = '| A | B |\n| --- | --- |\n| 1 | 2 |';
  assert.equal(htmlToMd(md2html(t)), t);
});

test('htmlToMd：引用、分隔線、換行、code／pre', () => {
  assert.equal(htmlToMd('<blockquote><p>引一</p><p>引二</p></blockquote><hr><p>甲<br>乙</p>'), '> 引一\n>\n> 引二\n\n---\n\n甲\\\n乙');
  assert.equal(htmlToMd('<p>用 <code>npm run build</code> 與 <code>a`b</code></p>'), '用 `npm run build` 與 ``a`b``');
  assert.equal(htmlToMd('<pre><code class="language-js">const a = 1;\n  if (a) {}\n</code></pre>'), '```js\nconst a = 1;\n  if (a) {}\n```');
  assert.equal(htmlToMd('<p>尾端換行<br></p>'), '尾端換行');
});

test('htmlToMd：Markdown 特殊字元與行首語法被跳脫，往返不變', () => {
  const out = htmlToMd('<p># 不是標題</p><p>- 不是清單</p><p>1. 不是編號</p><p>*星* _底_ snake_case [括] a&amp;b &amp;copy; \\ `x`</p>');
  assert.equal(out, '\\# 不是標題\n\n\\- 不是清單\n\n1\\. 不是編號\n\n\\*星\\* \\_底\\_ snake_case \\[括\\] a&b &amp;copy; \\\\ \\`x\\`');
  const back = htmlToMd(md2html(out));
  assert.equal(back, out);
});

test('htmlToMd：貼上的 Word 內容（mso 註解、條件註解、MsoList、span／font／class／style 全清掉）', () => {
  const word = `<html xmlns:o="urn:schemas-microsoft-com:office:office"><head><meta charset=utf-8><style><!-- p.MsoNormal {margin:0cm} --></style></head><body lang=ZH-TW style='tab-interval:24.0pt'>
<!--StartFragment-->
<!--[if gte mso 9]><xml><o:OfficeDocumentSettings><o:AllowPNG/></o:OfficeDocumentSettings></xml><![endif]-->
<h1 class=MsoTitle><span lang=EN-US style='font-family:"Calibri Light"'>疾病管制署 <b>公告</b></span></h1>
<p class=MsoNormal style='margin-bottom:0cm'><span style='font-size:12.0pt;font-family:"Microsoft JhengHei";color:#333'>登革熱<font color=red>潛伏期</font>為 3 至 14 天。<o:p></o:p></span></p>
<p class=MsoNormal><span lang=EN-US style='mso-ansi-language:EN-US'><o:p>&nbsp;</o:p></span></p>
<p class=MsoListParagraphCxSpFirst style='margin-left:36.0pt;text-indent:-18.0pt;mso-list:l0 level1 lfo1'><![if !supportLists]><span style='font-family:Symbol;mso-fareast-font-family:Symbol;mso-bidi-font-family:Symbol'><span style='mso-list:Ignore'>·<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; </span></span></span><![endif]>發燒</p>
<p class=MsoListParagraphCxSpMiddle style='margin-left:72.0pt;text-indent:-18.0pt;mso-list:l0 level2 lfo1'><![if !supportLists]><span style='font-family:"Courier New"'><span style='mso-list:Ignore'>o<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; </span></span></span><![endif]>超過 38 度</p>
<p class=MsoListParagraphCxSpLast style='margin-left:36.0pt;text-indent:-18.0pt;mso-list:l0 level1 lfo1'><![if !supportLists]><span style='mso-list:Ignore'>·<span>&nbsp;</span></span><![endif]>頭痛</p>
<p class=MsoListParagraphCxSpFirst style='margin-left:36.0pt;text-indent:-18.0pt;mso-list:l1 level1 lfo2'><![if !supportLists]><span style='mso-list:Ignore'>1.<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp;&nbsp; </span></span><![endif]>先就醫</p>
<p class=MsoListParagraphCxSpLast style='margin-left:36.0pt;text-indent:-18.0pt;mso-list:l1 level1 lfo2'><![if !supportLists]><span style='mso-list:Ignore'>2.<span>&nbsp;</span></span><![endif]>再通報</p>
<table class=MsoTableGrid border=1 cellspacing=0 cellpadding=0 style='border-collapse:collapse;mso-table-layout-alt:fixed'><tr style='mso-yfti-irow:0;mso-yfti-firstrow:yes'><td width=100 valign=top style='width:75.0pt;border:solid windowtext 1.0pt'><p class=MsoNormal><b><span lang=EN-US>項目</span></b></p></td><td width=100 valign=top><p class=MsoNormal><b>說明</b></p></td></tr>
<tr><td><p class=MsoNormal>通報</p></td><td><p class=MsoNormal>24 小時內</p></td></tr></table>
<p class=MsoNormal><a href="https://www.cdc.gov.tw/" target="_blank"><span style='color:#0563C1'>疾管署</span></a></p>
<!--EndFragment--></body></html>`;
  const dropped = [];
  const out = htmlToMd(word, { dropped });
  assert.equal(out, [
    '# 疾病管制署 公告',
    '登革熱潛伏期為 3 至 14 天。',
    '- 發燒\n  - 超過 38 度\n- 頭痛',
    '1. 先就醫\n2. 再通報',
    '| **項目** | **說明** |\n| --- | --- |\n| 通報 | 24 小時內 |',
    '[疾管署](https://www.cdc.gov.tw/)',
  ].join('\n\n'));
  for (const bad of ['mso', 'span', 'font', 'style', 'class', 'Ignore', '<', '&nbsp;', 'StartFragment', 'Calibri']) assert.ok(!out.includes(bad), `轉出結果不該含 ${bad}`);
});

test('htmlToMd：Google Docs／網頁貼上（font-weight 700 的 span、b font-weight:normal 外殼、div、script／style 丟棄）', () => {
  const gdocs = '<meta charset=utf-8><b style="font-weight:normal;" id="docs-internal-guid-1"><p dir="ltr" style="line-height:1.38"><span style="font-size:11pt;font-weight:700">重點</span><span style="font-size:11pt;font-style:italic">斜</span><span style="font-weight:400">一般</span></p><br class="Apple-interchange-newline"></b>';
  assert.equal(htmlToMd(gdocs), '**重點***斜*一般');
  const web = '<div class="post"><script>alert(1)</script><style>.a{color:red}</style><div>第一段<span class="x"> 接著 </span></div><div><div>第二段</div></div><iframe src="//evil"></iframe><button>送出</button></div>';
  assert.equal(htmlToMd(web), '第一段 接著\n\n第二段');
});

test('htmlToMd：不安全或無法保存的內容被丟棄並提示', () => {
  const dropped = [];
  const out = htmlToMd('<p><a href="javascript:alert(1)">壞連結</a><img src="data:image/png;base64,AAAA" alt="貼圖"><img src="blob:http://x/1" alt="b"><img src="file:///C:/a.png"></p><p><img src="blob:http://x/2" data-md-src="/files/faq.a/p.png" alt="已選檔"></p>', { dropped });
  assert.equal(out, '壞連結\n\n![已選檔](/files/faq.a/p.png)');
  assert.equal(dropped.length, 3);
});

test('parseHtml：實體、屬性、不成對標籤、極深巢狀不當掉', () => {
  assert.equal(htmlToMd('<p>&lt;b&gt; &amp; &#x4e2d;&#25991; &hellip; &nbsp;x&bogus;</p>'), '\\<b> & 中文 … x&amp;bogus;');
  assert.equal(htmlToMd('<p>未封閉<b>粗<p>下一段'), '未封閉**粗**\n\n下一段');
  assert.doesNotThrow(() => htmlToMd('<div>'.repeat(5000) + 'x'));
  assert.doesNotThrow(() => parseHtml('<<<>>> <a href="x <b>'.repeat(200)));
});

// ───────────────────────── Markdown → HTML（白名單淨化）─────────────────────────
test('mdToHtml：支援子集渲染，CJK 粗體與站上一致', () => {
  const html = md2html('## 標題\n\n常見**咳嗽**、發燒與*斜體*。\n\n- 甲\n  - 乙\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n> 引用\n\n---\n\n![圖](/files/x/a.png)');
  for (const frag of ['<h2>標題</h2>', '<strong>咳嗽</strong>', '<em>斜體</em>', '<ul>', '<table>', '<th>a</th>', '<blockquote>', '<hr>', '<img src="/files/x/a.png" alt="圖">']) assert.ok(html.includes(frag), `缺 ${frag}\n${html}`);
});

test('mdToHtml：imgSrc 換成 blob URL 並保留原路徑；href 可加 basePath', () => {
  const html = md2html('![封面](/files/n.a/c.png) [去](/diseases/x/) [外](https://a.b/)', { imgSrc: (s) => (s === '/files/n.a/c.png' ? { src: 'blob:http://x/abc', orig: s } : null), href: (h) => (h.startsWith('/') ? `/base${h}` : h) });
  assert.match(html, /<img src="blob:http:\/\/x\/abc" alt="封面" data-md-src="\/files\/n.a\/c.png">/);
  assert.match(html, /href="\/base\/diseases\/x\/"/);
  assert.match(html, /href="https:\/\/a.b\/"/);
  // 轉回 Markdown 時還原原路徑
  assert.equal(htmlToMd(html), '![封面](/files/n.a/c.png) [去](/base/diseases/x/) [外](https://a.b/)');
});

test('XSS：script／事件屬性／javascript:／data:／iframe／svg／style 屬性全部清除', () => {
  const vectors = [
    '<script>alert(1)</script>', '<img src=x onerror=alert(1)>', '<a href="javascript:alert(1)">x</a>', '<a href="JaVa\tScRiPt:alert(1)">x</a>',
    '<a href="jav&#x61;script:alert(1)">x</a>', '<a href="&#106;avascript:alert(1)">x</a>', '<a href="  javascript:alert(1)">x</a>', '<a href="vbscript:msgbox(1)">x</a>',
    '<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">x</a>', '<img src="data:image/svg+xml,<svg onload=alert(1)>">',
    '<iframe src="//evil.example"></iframe>', '<svg onload=alert(1)><circle/></svg>', '<p style="background:url(javascript:alert(1))" onclick="alert(1)">p</p>',
    '<object data="x"></object><embed src="x">', '<form action="//evil"><input name=a><button>go</button></form>', '<style>body{display:none}</style>', '<math><mi xlink:href="javascript:alert(1)">x</mi></math>',
    '<a href="https://ok.example/" onmouseover="alert(1)" target="_blank" style="x:y" class="c" id="i">ok</a>', '<img src="https://ok.example/a.png" onload="alert(1)" srcset="x 1x" style="x:y">',
    '[x](javascript:alert(1))', '![x](javascript:alert(1))', '[x](data:text/html,<script>alert(1)</script>)', '<div><b onclick=alert(1)>b</b></div>', '<!--<script>alert(1)</script>-->',
  ];
  for (const v of vectors) {
    for (const out of [md2html(v), sanitizeHtml(v), md2html(`段落\n\n${v}\n\n段落`)]) {
      assert.ok(!/<\s*(script|iframe|object|embed|svg|style|form|input|button|math)\b/i.test(out), `殘留危險標籤：${v} → ${out}`);
      assert.ok(!/\son[a-z]+\s*=/i.test(out), `殘留事件屬性：${v} → ${out}`);
      assert.ok(!/(href|src)\s*=\s*"\s*(javascript|vbscript|data):/i.test(out), `殘留危險網址：${v} → ${out}`);
      assert.ok(!/\sstyle\s*=|\sclass="c"|\sid=/i.test(out), `殘留 style／class／id：${v} → ${out}`);
    }
  }
  // 合法內容保留
  assert.equal(sanitizeHtml('<a href="https://ok.example/" onmouseover="x" class="c">ok</a>'), '<a href="https://ok.example/">ok</a>');
  assert.equal(sanitizeHtml('<img src="https://ok.example/a.png" onload="x" alt="圖">'), '<img src="https://ok.example/a.png" alt="圖">');
  // 轉成 Markdown 這條路也不帶走危險東西
  const md = htmlToMd('<p onclick="x"><a href="javascript:alert(1)">連結</a><script>alert(1)</script><img src=x onerror=alert(1)></p>');
  assert.ok(!/script|javascript|onerror|onclick/i.test(md), md);
});

test('safeUrl／fileRefs／plainTextToHtml', () => {
  assert.equal(safeUrl('https://a.b/c'), 'https://a.b/c');
  assert.equal(safeUrl('/files/x/y.png'), '/files/x/y.png');
  assert.equal(safeUrl('mailto:a@b.c'), 'mailto:a@b.c');
  assert.equal(safeUrl('javascript:1'), '');
  assert.equal(safeUrl(' \u0001java\nscript:1'), '');
  assert.equal(safeUrl('data:text/html,x'), '');
  const refs = fileRefs('![圖](/files/news.a/c%20d.png) 與 [檔](/files/news.a/r.pdf) <img src="/files/news.b/z.png">');
  assert.deepEqual(refs.map((r) => [r.id, r.file, r.image]), [['news.a', 'c d.png', true], ['news.a', 'r.pdf', false], ['news.b', 'z.png', true]]);
  assert.equal(plainTextToHtml('甲\n乙\n\n丙 <b>'), '<p>甲<br>乙</p><p>丙 &lt;b&gt;</p>');
  assert.match(plainTextToHtml('# 標題\n\n- 一\n- 二', { marked }), /<h1>標題<\/h1>[\s\S]*<ul>/);
});

// ───────────────────────── zip-store ─────────────────────────
/** 獨立的最小 ZIP reader（與 zip-store 不共用任何程式）：EOCD → central directory → local header，逐欄位驗證 */
function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  assert.ok(eocd >= 0, '找不到 EOCD');
  const total = buf.readUInt16LE(eocd + 10);
  assert.equal(buf.readUInt16LE(eocd + 8), total);
  const cdSize = buf.readUInt32LE(eocd + 12), cdOff = buf.readUInt32LE(eocd + 16);
  assert.equal(cdOff + cdSize, eocd, 'central directory 必須緊接 EOCD');
  assert.equal(buf.readUInt16LE(eocd + 20), 0, '無 comment');
  const files = [];
  let p = cdOff;
  for (let n = 0; n < total; n++) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50, 'central header 簽章');
    const flags = buf.readUInt16LE(p + 8), method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16), csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), lho = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nlen).toString('utf8');
    p += 46 + nlen + elen + clen;
    // local header
    assert.equal(buf.readUInt32LE(lho), 0x04034b50, 'local header 簽章');
    assert.equal(buf.readUInt16LE(lho + 6), flags);
    assert.equal(buf.readUInt16LE(lho + 8), method);
    assert.equal(buf.readUInt32LE(lho + 14), crc);
    assert.equal(buf.readUInt32LE(lho + 18), csize);
    assert.equal(buf.readUInt32LE(lho + 22), usize);
    const ln = buf.readUInt16LE(lho + 26), le = buf.readUInt16LE(lho + 28);
    assert.equal(buf.subarray(lho + 30, lho + 30 + ln).toString('utf8'), name, 'local 與 central 檔名一致');
    const data = buf.subarray(lho + 30 + ln + le, lho + 30 + ln + le + csize);
    files.push({ name, flags, method, crc, size: usize, data });
  }
  assert.equal(p, eocd);
  return files;
}
const refCrc = (b) => (typeof zlib.crc32 === 'function' ? zlib.crc32(b) : (() => { // 後備：與 zip-store 不同寫法（逐位元、不查表）
  let c = 0xffffffff;
  for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
  return (c ^ 0xffffffff) >>> 0;
})());

test('crc32：標準向量、與 node:zlib 一致、可串接', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  assert.equal(crc32(new Uint8Array(0)), 0);
  const data = crypto.randomBytes(100000);
  assert.equal(crc32(data), refCrc(data));
  assert.equal(crc32(data.subarray(500), crc32(data.subarray(0, 500))), crc32(data));
});

test('zip-store：store-only ZIP 可被獨立 reader 讀回（檔名 UTF-8、CRC32、內容逐位元組相同）', () => {
  const png = crypto.randomBytes(5000);
  const entries = [
    { name: 'content/news/2026-10-01-測試.json', data: '{\n  "id": "news.2026-10-01-test",\n  "title": "標題含中文與 emoji 🙂"\n}\n' },
    { name: 'content/assets/news.2026-10-01-test/chart.png', data: png },
    { name: 'content/assets/news.2026-10-01-test/empty.md', data: new Uint8Array(0) },
    { name: 'content/assets/news.2026-10-01-test/big.csv', data: Buffer.alloc(300000, 'a,b,c\n') },
  ];
  const zip = Buffer.from(createZip(entries, { date: new Date(2026, 9, 1, 12, 30, 40) }));
  const files = readZip(zip);
  assert.deepEqual(files.map((f) => f.name), entries.map((e) => e.name));
  files.forEach((f, i) => {
    const src = typeof entries[i].data === 'string' ? Buffer.from(entries[i].data) : Buffer.from(entries[i].data);
    assert.equal(f.method, 0, 'store-only');
    assert.equal(f.flags & 0x0800, 0x0800, 'UTF-8 檔名旗標');
    assert.equal(f.size, src.length);
    assert.equal(f.crc, refCrc(src), `${f.name} CRC32`);
    assert.ok(f.data.equals(src), `${f.name} 內容`);
  });
  // DOS 時間：12:30:40 → 2 秒精度
  const dosTime = zip.readUInt16LE(10), dosDate = zip.readUInt16LE(12);
  assert.deepEqual([dosTime >> 11, (dosTime >> 5) & 63, (dosTime & 31) * 2], [12, 30, 40]);
  assert.deepEqual([(dosDate >> 9) + 1980, (dosDate >> 5) & 15, dosDate & 31], [2026, 10, 1]);
});

test('zip-store：路徑安全（拒絕 ..、正規化反斜線與開頭斜線）', () => {
  assert.equal(zipPath('/a\\b//c.txt'), 'a/b/c.txt');
  assert.throws(() => zipPath('../etc/passwd'));
  assert.throws(() => zipPath('a/../../b'));
  assert.throws(() => createZip([{ name: '', data: '' }]));
  const files = readZip(Buffer.from(createZip([{ name: '\\content\\a.json', data: '{}' }])));
  assert.equal(files[0].name, 'content/a.json');
});

test('zip-store：系統 unzip／python zipfile 也能驗證（有裝才跑）', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zipchk-'));
  const f = path.join(tmp, 'p.zip');
  const png = crypto.randomBytes(2048);
  fs.writeFileSync(f, createZip([{ name: 'content/news/a.json', data: '{"a":"中文"}\n' }, { name: 'content/assets/news.a/中.png', data: png }]));
  let ran = false;
  const u = spawnSync('unzip', ['-t', f], { encoding: 'utf8' });
  if (!u.error) { ran = true; assert.equal(u.status, 0, u.stdout + u.stderr); assert.match(u.stdout, /No errors detected/); }
  const py = spawnSync('python3', ['-c', 'import sys,zipfile;z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None;print(",".join(sorted(z.namelist())))', f], { encoding: 'utf8' });
  if (!py.error && py.status === 0) { ran = true; assert.equal(py.stdout.trim(), 'content/assets/news.a/中.png,content/news/a.json'); }
  fs.rmSync(tmp, { recursive: true, force: true });
  if (!ran) t.skip('系統沒有 unzip 與 python3');
});

// ───────────────────────── 檔名、限制、資產預檢 ─────────────────────────
test('normalizeAssetName：空白、大小寫、中文、符號、重複、副檔名', () => {
  const n = (s, taken) => P.normalizeAssetName(s, taken);
  assert.equal(n('Press Release (Final).PDF').name, 'press-release-final.pdf');
  assert.deepEqual(n('press-release.pdf'), { name: 'press-release.pdf', changed: false, notes: [] });
  const zh = n('新聞稿 全文.pdf');
  assert.equal(zh.name, 'file.pdf');
  assert.ok(zh.notes.some((x) => /中文/.test(x)) && zh.notes.some((x) => /空白/.test(x)), zh.notes.join('|'));
  assert.equal(n('週報 ILI 趨勢圖.png').name, 'ili.png');
  assert.equal(n('a__b--c..d.JPEG').name, 'a_b-c.d.jpeg');
  assert.equal(n('...hidden.png').name, 'hidden.png');
  assert.equal(n('C:\\fakepath\\圖表.PNG').name, 'file.png');
  assert.equal(n('chart.png', ['chart.png']).name, 'chart-2.png');
  assert.equal(n('chart.png', ['chart.png', 'chart-2.png']).name, 'chart-3.png');
  assert.equal(n('Ünïcode.csv').name, 'unicode.csv');
  assert.ok(P.ASSET_NAME_RE.test(n('任何 奇怪 名稱 !!.pdf').name));
  for (const s of ['a b.pdf', '中文.pdf', 'A.pdf', '.hidden', '-x.png', 'x y']) assert.ok(!P.ASSET_NAME_RE.test(s), s);
});

test('檔案限制：預設值、site.config.assets（Y1）、window.CDC_ASSETS_LIMITS 各種寫法', () => {
  const d = P.normalizeLimits();
  assert.deepEqual([d.pdfBytes, d.imageBytes, d.dataBytes, d.maxFiles], [20 * 1048576, 2 * 1048576, 50 * 1048576, 30]);
  assert.deepEqual(d.extensions, ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'svg', 'csv', 'json', 'xlsx', 'docx', 'odt', 'md', 'ics']);
  const fromCfg = P.normalizeLimits(config.assets); // 契約 16.1：config.assets；若 Y1 尚未加入則為預設
  assert.deepEqual([fromCfg.pdfBytes, fromCfg.imageBytes, fromCfg.dataBytes, fromCfg.maxFiles], [d.pdfBytes, d.imageBytes, d.dataBytes, d.maxFiles]);
  const custom = P.normalizeLimits({ pdfMB: 5, imageMB: 1, dataBytes: 1000000, maxFiles: 3, extensions: ['.PDF', 'png'] });
  assert.deepEqual([custom.pdfBytes, custom.imageBytes, custom.dataBytes, custom.maxFiles, custom.extensions], [5 * 1048576, 1048576, 1000000, 3, ['pdf', 'png']]);
  const nested = P.normalizeLimits({ maxBytes: { pdf: 1048576, image: 524288, data: 2097152 }, allowedExt: ['pdf'], maxFiles: 7 });
  assert.deepEqual([nested.pdfBytes, nested.imageBytes, nested.dataBytes, nested.maxFiles, nested.extensions], [1048576, 524288, 2097152, 7, ['pdf']]);
  assert.equal(P.assetKindFor('a.PNG'), 'image');
  assert.equal(P.assetKindFor('a.csv'), 'data');
  assert.equal(P.assetKindFor('a.pdf'), 'attachment');
  assert.equal(P.assetKindFor('a.docx'), 'attachment');
  assert.equal(P.assetMimeFor('x.svg'), 'image/svg+xml');
});

test('SVG 掃描、檔頭簽章、SVG 尺寸', () => {
  assert.equal(scanSvg('<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>'), '');
  assert.match(scanSvg('<svg><script>alert(1)</script></svg>'), /script/);
  assert.match(scanSvg('<svg onload="x()"></svg>'), /事件/);
  assert.match(scanSvg('<svg><rect onclick = "x"/></svg>'), /事件/);
  assert.match(scanSvg('<svg><a href="javascript:x()"/></svg>'), /javascript/);
  assert.match(scanSvg('<svg><foreignObject/></svg>'), /foreignObject/);
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(sniffMismatch('png', png), '');
  assert.match(sniffMismatch('png', Buffer.from('%PDF-1.4')), /簽章/);
  assert.equal(sniffMismatch('pdf', Buffer.from('%PDF-1.4')), '');
  assert.match(sniffMismatch('pdf', png), /簽章/);
  assert.equal(sniffMismatch('csv', png), '');
  assert.deepEqual(svgSize('<svg width="120" height="80px">'), { width: 120, height: 80 });
  assert.deepEqual(svgSize('<svg viewBox="0 0 640 480">'), { width: 640, height: 480 });
});

const mkObj = (assets, body = '') => ({ id: 'news.2026-10-01-x', type: 'news', bodyMarkdown: body, assets });
const A = (o) => ({ file: 'chart.png', kind: 'image', alt: '趨勢圖', mime: 'image/png', bytes: 1000, sha256: 'a'.repeat(64), license: 'OGDL-1.0', ...o });
const codes = (obj, lim) => P.assetIssues(obj, lim).map((i) => `${i.level}:${i.code}${i.file ? `:${i.file}` : ''}`).sort();

test('資產預檢：完整且內文引用 ⇒ 無問題', () => {
  const o = mkObj([A({}), { file: 'press.pdf', kind: 'attachment', label: '新聞稿（PDF）', mime: 'application/pdf', bytes: 2000, sha256: 'b'.repeat(64), machineReadable: true }], '![趨勢圖](/files/news.2026-10-01-x/chart.png)\n\n[下載](/files/news.2026-10-01-x/press.pdf)');
  assert.deepEqual(codes(o), []);
});

test('資產預檢：圖片缺 alt、alt 過長、缺授權、非本署缺來源、未引用', () => {
  assert.deepEqual(codes(mkObj([A({ alt: '' })], '![](/files/news.2026-10-01-x/chart.png)')), ['error:alt:chart.png']);
  assert.deepEqual(codes(mkObj([A({ alt: '' })], '![內文有 alt](/files/news.2026-10-01-x/chart.png)')), ['warn:alt-json:chart.png']);
  assert.deepEqual(codes(mkObj([A({ alt: 'x'.repeat(151) })], '![x](/files/news.2026-10-01-x/chart.png)')), ['error:alt-long:chart.png']);
  assert.deepEqual(codes(mkObj([A({ license: '' })], '![a](/files/news.2026-10-01-x/chart.png)')), ['error:license:chart.png']);
  assert.deepEqual(codes(mkObj([A({ license: 'CC-BY-4.0' })], '![a](/files/news.2026-10-01-x/chart.png)')), ['warn:source:chart.png']);
  assert.deepEqual(codes(mkObj([A({ license: 'CC-BY-4.0', source: '某某網站' })], '![a](/files/news.2026-10-01-x/chart.png)')), []);
  assert.deepEqual(codes(mkObj([A({})], '沒有引用')), ['warn:unreferenced:chart.png']);
  assert.deepEqual(codes(mkObj([A({})], '<img src="/files/news.2026-10-01-x/chart.png" alt="x">')), []);
});

test('資產預檢：附件缺 label、資料檔缺 label', () => {
  const att = { file: 'a.docx', kind: 'attachment', mime: P.assetMimeFor('a.docx'), bytes: 10, sha256: 'c'.repeat(64) };
  assert.deepEqual(codes(mkObj([att])), ['error:label:a.docx']);
  assert.deepEqual(codes(mkObj([{ ...att, file: 'd.csv', kind: 'data', mime: 'text/csv' }])), ['error:label:d.csv']);
  assert.deepEqual(codes(mkObj([{ ...att, label: '表單' }])), []);
});

test('資產預檢：超限（PDF／圖片／資料檔）、空檔、檔數、副檔名、mime 與副檔名不符', () => {
  const MB = 1048576;
  const pdf = (bytes) => ({ file: 'p.pdf', kind: 'attachment', label: 'P', mime: 'application/pdf', bytes, sha256: 'd'.repeat(64), machineReadable: true });
  assert.deepEqual(codes(mkObj([pdf(20 * MB)])), []);
  assert.deepEqual(codes(mkObj([pdf(20 * MB + 1)])), ['error:size:p.pdf']);
  assert.deepEqual(codes(mkObj([A({ bytes: 2 * MB + 1 })], '![a](/files/news.2026-10-01-x/chart.png)')), ['error:size:chart.png']);
  assert.deepEqual(codes(mkObj([{ file: 'd.csv', kind: 'data', label: 'D', mime: 'text/csv', bytes: 50 * MB + 1, sha256: 'e'.repeat(64) }])), ['error:size:d.csv']);
  assert.deepEqual(codes(mkObj([{ file: 'd.csv', kind: 'data', label: 'D', mime: 'text/csv', bytes: 50 * MB, sha256: 'e'.repeat(64) }])), []);
  assert.deepEqual(codes(mkObj([pdf(0)])), ['error:empty:p.pdf']);
  assert.deepEqual(codes(mkObj([pdf(MB + 1)]), { pdfBytes: MB }), ['error:size:p.pdf']);
  const many = Array.from({ length: 31 }, (_, i) => ({ file: `f${i}.md`, kind: 'attachment', label: 'x', mime: 'text/markdown', bytes: 1, sha256: 'f'.repeat(64) }));
  assert.ok(codes(mkObj(many)).includes('error:too-many'));
  assert.ok(!codes(mkObj(many.slice(0, 30))).includes('error:too-many'));
  assert.ok(codes(mkObj([{ ...pdf(1), file: 'x.exe' }])).includes('error:ext:x.exe'));
  assert.ok(codes(mkObj([{ ...pdf(1), mime: 'image/png' }])).includes('error:mime:p.pdf'));
});

test('資產預檢：檔名不合法並給建議檔名、重複檔名', () => {
  const o = mkObj([{ file: '新聞稿 全文.pdf', kind: 'attachment', label: 'x', mime: 'application/pdf', bytes: 1, sha256: 'a'.repeat(64), machineReadable: true }]);
  const issues = P.assetIssues(o);
  const bad = issues.find((i) => i.code === 'name');
  assert.ok(bad && /建議「file\.pdf」/.test(bad.msg), JSON.stringify(issues));
  const dup = mkObj([A({}), A({})], '![a](/files/news.2026-10-01-x/chart.png)');
  assert.ok(codes(dup).includes('error:duplicate:chart.png'));
});

test('資產預檢：內文引用未宣告／引用他人檔案／把附件當圖片', () => {
  assert.deepEqual(codes(mkObj([], '![a](/files/news.2026-10-01-x/missing.png)')), ['error:undeclared:missing.png']);
  assert.deepEqual(codes(mkObj([], '[檔](/files/news.2026-10-01-x/missing.pdf)')), ['error:undeclared:missing.pdf']);
  assert.deepEqual(codes(mkObj([], '![a](/files/news.other/x.png)')), ['error:foreign:x.png']);
  const pdf = { file: 'p.pdf', kind: 'attachment', label: 'P', mime: 'application/pdf', bytes: 1, sha256: 'a'.repeat(64), machineReadable: true };
  assert.deepEqual(codes(mkObj([pdf], '![p](/files/news.2026-10-01-x/p.pdf)')), ['error:not-image:p.pdf']);
  assert.deepEqual(codes(mkObj([pdf], '[p](/files/news.2026-10-01-x/p.pdf)')), []);
  // 其他 Markdown 欄位（blocks[].markdown、answerMarkdown）也會掃
  assert.deepEqual(codes({ id: 'faq.x', answerMarkdown: '![a](/files/faq.x/n.png)', assets: [] }), ['error:undeclared:n.png']);
  assert.deepEqual(codes({ id: 'disease.x', blocks: [{ key: 'a', markdown: '![a](/files/disease.x/n.png)' }], assets: [] }), ['error:undeclared:n.png']);
});

test('資產預檢：PDF 未勾 machineReadable 且無 .md 替代 ⇒ 警告；有替代檔或同名 .md ⇒ 通過', () => {
  const pdf = (o) => ({ file: 'scan.pdf', kind: 'attachment', label: '掃描', mime: 'application/pdf', bytes: 1, sha256: 'a'.repeat(64), machineReadable: false, ...o });
  assert.deepEqual(codes(mkObj([pdf({})])), ['warn:pdf-accessible:scan.pdf']);
  const md = { file: 'scan.md', kind: 'attachment', label: '文字版', mime: 'text/markdown', bytes: 1, sha256: 'b'.repeat(64), machineReadable: true };
  assert.deepEqual(codes(mkObj([pdf({}), md])), []);
  assert.deepEqual(codes(mkObj([pdf({ accessibleAlt: 'alt-text.docx' }), { ...md, file: 'alt-text.docx', mime: P.assetMimeFor('a.docx') }])), []);
  assert.deepEqual(codes(mkObj([pdf({ machineReadable: true })])), []);
});

test('requiredCheck：資產 error 進必補清單、warn 不進；無 assets 時行為不變', () => {
  const base = P.buildExport({ type: 'news', id: 'news.2026-10-01-x', title: 't', body: '![a](/files/news.2026-10-01-x/n.png)', owner: 'unit.acute-infectious', today: '2026-10-01', summary: 's', audience: ['public'], langs: {}, reviewPeriodMonths: 0 });
  const owners = ['unit.acute-infectious'];
  assert.deepEqual(P.requiredCheck({ ...base, bodyMarkdown: '無圖' }, owners), []);
  const miss = P.requiredCheck(base, owners);
  assert.equal(miss.length, 1);
  assert.match(miss[0], /沒有在附件與圖片中宣告/);
  const o = { ...base, bodyMarkdown: '![](/files/news.2026-10-01-x/n.png)', assets: P.buildAssetsJson([{ file: 'n.png', kind: 'image', alt: '', license: '', mime: 'image/png', bytes: 5, sha256: 'a'.repeat(64) }]) };
  const miss2 = P.requiredCheck(o, owners);
  assert.ok(miss2.some((m) => /缺替代文字/.test(m)) && miss2.some((m) => /缺授權/.test(m)), miss2.join('\n'));
  const warnOnly = { ...base, assets: P.buildAssetsJson([{ file: 'n.png', kind: 'image', alt: 'a', license: 'CC-BY-4.0', mime: 'image/png', bytes: 5, sha256: 'a'.repeat(64) }]) };
  assert.deepEqual(P.requiredCheck(warnOnly, owners), []);
  const w = P.assetWarnings(warnOnly);
  assert.equal(w.length, 1);
  assert.deepEqual([w[0].level, w[0].code], ['warn', 'asset-source']);
});

test('buildAssetsJson：欄位與順序（file、kind、label、alt、mime、bytes、sha256、machineReadable、accessibleAlt、license、source、width、height）', () => {
  const out = P.buildAssetsJson([
    { file: 'chart-ili.png', kind: 'image', label: '', alt: ' 流感趨勢 ', mime: 'image/png', bytes: 1234, sha256: 'ab'.repeat(32), machineReadable: true, license: 'OGDL-1.0', source: '', width: 640, height: 480 },
    { file: 'press-release.pdf', kind: 'attachment', label: '新聞稿全文（PDF）', alt: '不該出現', mime: 'application/pdf', bytes: 99, sha256: 'cd'.repeat(32), machineReadable: false, accessibleAlt: 'press-release.md', license: 'x' },
    { file: 'data.csv', kind: 'data', label: '資料', mime: 'text/csv', bytes: 5, sha256: '' },
  ]);
  assert.deepEqual(Object.keys(out[0]), ['file', 'kind', 'alt', 'mime', 'bytes', 'sha256', 'license', 'width', 'height']);
  assert.equal(out[0].alt, '流感趨勢');
  assert.deepEqual(Object.keys(out[1]), ['file', 'kind', 'label', 'mime', 'bytes', 'sha256', 'machineReadable', 'accessibleAlt']);
  assert.equal(out[1].machineReadable, false);
  assert.deepEqual(out[2], { file: 'data.csv', kind: 'data', label: '資料', mime: 'text/csv', bytes: 5 });
  const exp = P.buildExport({ type: 'news', id: 'news.a', title: 't', body: 'b', owner: 'o', today: '2026-10-01', langs: {}, assets: out });
  assert.deepEqual(exp.assets, out);
  assert.equal(P.buildExport({ type: 'news', id: 'news.a', title: 't', body: 'b', owner: 'o', today: '2026-10-01', langs: {} }).assets, undefined);
});

test('packagePaths／renderTree：放置路徑與樹狀圖', () => {
  const obj = { id: 'news.2026-10-01-x', assets: [{ file: 'press.pdf' }, { file: 'chart.png' }] };
  const pp = P.packagePaths(obj, 'news');
  assert.deepEqual(pp, { json: 'content/news/2026-10-01-x.json', assets: ['content/assets/news.2026-10-01-x/press.pdf', 'content/assets/news.2026-10-01-x/chart.png'] });
  assert.equal(P.packagePaths({ id: 'doc.mmr', assets: [] }, 'document').json, 'content/documents/mmr.json');
  assert.equal(P.renderTree(pp), [
    '（repo 根目錄）', '└─ content/', '   ├─ news/', '   │  └─ 2026-10-01-x.json   ← content JSON', '   └─ assets/', '      └─ news.2026-10-01-x/', '         ├─ press.pdf', '         └─ chart.png',
  ].join('\n'));
});

// ───────────────────────── 端到端（Playwright）─────────────────────────
const PW = process.env.PW_MODULE || '/tmp/claude-0/-home-user-new-cdc-prototype/dd0b2a7d-938a-5a8a-a024-801e7fcada0e/scratchpad/pw/node_modules/playwright/index.mjs';
const CHROME = process.env.CHROME_BIN || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const DIST = process.env.DIST_DIR ? path.resolve(process.env.DIST_DIR) : path.join(ROOT, 'dist');
const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });

function tinyPng() { // 64×48 實心 PNG（含正確 CRC）
  const W = 64, H = 48;
  const raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) { const o = y * (W * 3 + 1); raw[o] = 0; for (let x = 0; x < W; x++) { raw[o + 1 + x * 3] = 27; raw[o + 2 + x * 3] = 94 + (y % 40); raw[o + 3 + x * 3] = 63; } }
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(refCrc(td)); return Buffer.concat([len, td, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
function tinyPdf() {
  const text = 'BT /F1 18 Tf 72 720 Td (Press release - sample) Tj ET';
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let out = '%PDF-1.4\n'; const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  return Buffer.from(out);
}
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

test('端到端：所見即所得 → Markdown → 預覽 → 加 PNG 與 PDF → 插圖 → 產生上架包', async (t) => {
  if (!fs.existsSync(path.join(DIST, 'admin/publish/index.html'))) return t.skip('dist 尚未建置（BUILD_TODAY=2026-10-01 npm run build）');
  if (!fs.existsSync(PW) || !fs.existsSync(CHROME)) return t.skip('沒有 Playwright／Chromium');
  const { chromium } = await import(pathToFileURL(PW).href);
  const port = await freePort();
  const srv = spawn(process.execPath, [path.join(ROOT, 'scripts/serve.mjs'), String(port)], { cwd: ROOT, stdio: 'ignore', env: { ...process.env, DIST_DIR: DIST } });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'adm-e2e-'));
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const errors = [];
  try {
    const base = `http://localhost:${port}${config.basePath}`;
    for (let i = 0; i < 50; i++) { try { if ((await fetch(`${base}/admin/publish/`)).ok) break; } catch { /* wait */ } await new Promise((r) => setTimeout(r, 100)); }
    const ctx = await browser.newContext({ viewport: { width: 1360, height: 1100 }, acceptDownloads: true });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(`${base}/admin/publish/`);
    await page.waitForSelector('#f-wys');
    // 無障礙結構
    assert.equal(await page.getAttribute('#f-wys', 'role'), 'textbox');
    assert.equal(await page.getAttribute('#f-wys', 'aria-multiline'), 'true');
    assert.ok(await page.getAttribute('#f-wys', 'aria-label'));
    assert.equal(await page.locator('[role="tablist"] [role="tab"]').count(), 3);
    assert.equal(await page.getAttribute('#et-wys', 'aria-selected'), 'true');
    for (const b of await page.locator('#ed-toolbar button').all()) assert.ok(await b.getAttribute('aria-label'), '工具列按鈕要有 aria-label');
    assert.ok(await page.evaluate(() => typeof window.marked?.parse === 'function'), 'vendor marked 要載入（含 basePath）');
    assert.match(await page.locator('#f-body-hint').innerText(), /存檔一律是 Markdown/);

    await page.selectOption('#f-type', 'news');
    await page.fill('#f-title', '流感抗病毒藥劑建議修訂（編輯器示範）');
    await page.fill('#f-id', 'news.2026-10-01-editor-demo');
    // ① 所見即所得輸入
    await page.click('#f-wys');
    await page.keyboard.type('疾管署今天公布流感抗病毒藥劑建議修訂。');
    await page.keyboard.press('Enter');
    await page.click('[data-cmd="h2"]');
    await page.keyboard.type('重點');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Control+b');
    await page.keyboard.type('高風險族群');
    await page.keyboard.press('Control+b');
    await page.keyboard.type('應儘早就醫。');
    await page.keyboard.press('Enter');
    await page.click('[data-cmd="ul"]');
    await page.keyboard.type('65 歲以上');
    await page.keyboard.press('Enter');
    await page.keyboard.type('孕婦');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.click('[data-cmd="table"]');
    assert.equal(await page.locator('#f-wys table th').count(), 3);
    assert.equal(await page.locator('#f-wys table tr').count(), 3);
    // 連結（Ctrl+K）
    await page.locator('#f-wys p', { hasText: '疾管署今天' }).click();
    await page.keyboard.press('End');
    await page.keyboard.type(' 詳見');
    await page.keyboard.press('Control+k');
    await page.fill('#ed-link-url', 'cdc.gov.tw');
    await page.click('#ed-link-ok');
    // ② 切 Markdown：看轉換結果
    await page.click('#et-md');
    const md1 = await page.inputValue('#f-body');
    assert.match(md1, /^疾管署今天公布流感抗病毒藥劑建議修訂。 詳見\[https:\/\/cdc\.gov\.tw\]\(https:\/\/cdc\.gov\.tw\)/m);
    assert.match(md1, /^## 重點$/m);
    assert.match(md1, /\*\*高風險族群\*\*應儘早就醫。/);
    assert.match(md1, /^- 65 歲以上\n- 孕婦$/m);
    assert.match(md1, /^\| 欄位一 \| 欄位二 \| 欄位三 \|\n\| --- \| --- \| --- \|\n/m);
    assert.equal(await page.getAttribute('#et-md', 'aria-selected'), 'true');
    assert.equal(await page.isHidden('#f-wys'), true);
    // 在 Markdown 改 → 切回所見即所得會即時轉換
    await page.fill('#f-body', `${md1}\n\n### 追加小節\n\n在 Markdown 頁籤補的 *斜體*。`);
    await page.click('#et-wys');
    assert.equal(await page.locator('#f-wys h3').innerText(), '追加小節');
    assert.equal(await page.locator('#f-wys em').innerText(), '斜體');
    // 單純切頁籤不改寫原文
    await page.click('#et-md');
    assert.ok((await page.inputValue('#f-body')).includes('### 追加小節'));
    assert.match(await page.locator('#f-body-count').innerText(), /^\d+ 字$/);
    // ③ 預覽（站上 c-prose）
    await page.click('#et-prev');
    assert.ok(await page.locator('#f-preview').evaluate((el) => el.classList.contains('c-prose')));
    for (const sel of ['h2', 'h3', 'strong', 'em', 'ul li', 'table th', 'a[href="https://cdc.gov.tw"]']) assert.ok(await page.locator(`#f-preview ${sel}`).count() >= 1, `預覽缺 ${sel}`);

    // ④ 加一個 PNG 與一個 PDF（檔名含空白與中文，驗證正規化）
    const png = tinyPng(), pdf = tinyPdf();
    // 以 buffer 傳入（檔名含空白與中文；暫存檔路徑含非 ASCII 時部分環境的 Playwright 會失敗）
    const pngFile = { name: '流感 趨勢圖 ILI.png', mimeType: 'image/png', buffer: png }, pdfFile = { name: 'Press Release 新聞稿.pdf', mimeType: 'application/pdf', buffer: pdf };
    await page.setInputFiles('#as-input', [pngFile, pdfFile]);
    await page.waitForSelector('#as-list li[data-uid]');
    assert.equal(await page.locator('#as-list > li').count(), 2);
    const names = await page.locator('#as-list [data-f="file"]').evaluateAll((els) => els.map((e) => e.value));
    assert.deepEqual(names, ['ili.png', 'press-release.pdf']);
    assert.match(await page.locator('#as-msg').innerText(), /已加入 2 個檔案/);
    assert.match(await page.locator('#as-list').innerText(), /檔名含中文/);
    assert.match(await page.locator('#as-list').innerText(), /請確認 PDF 有文字層/);
    // 預檢：圖片缺 alt／license、PDF 預設勾選 machineReadable
    assert.match(await page.locator('#as-list').innerText(), /圖片缺替代文字/);
    assert.equal(await page.locator('#as-list [data-f="machineReadable"]').isChecked(), true);
    assert.match(await page.locator('#as-list li').first().innerText(), /64×48/);
    await page.fill('#as-list li:nth-child(1) [data-f="alt"]', '2026 年流感門診就診率趨勢圖');
    await page.fill('#as-list li:nth-child(1) [data-f="license"]', 'OGDL-1.0');
    await page.fill('#as-list li:nth-child(2) [data-f="label"]', '新聞稿全文（PDF）');
    await page.locator('#as-list li:nth-child(2) [data-f="label"]').blur();
    // ⑤ 插圖：Markdown 頁籤的游標處
    await page.click('#et-md');
    await page.evaluate(() => { const ta = document.querySelector('#f-body'); const i = ta.value.indexOf('### 追加小節'); ta.focus(); ta.setSelectionRange(i, i); });
    await page.click('#as-list li:nth-child(1) [data-act="insert"]');
    const md2 = await page.inputValue('#f-body');
    assert.ok(md2.includes('![2026 年流感門診就診率趨勢圖](/files/news.2026-10-01-editor-demo/ili.png)\n\n### 追加小節'), md2);
    // 預覽用 blob URL
    await page.click('#et-prev');
    const src = await page.locator('#f-preview img').getAttribute('src');
    assert.match(src, /^blob:/);
    assert.ok(await page.locator('#f-preview img').evaluate((im) => im.complete && im.naturalWidth === 64));
    // 所見即所得也用 blob，轉回 Markdown 還原 /files/ 路徑
    await page.click('#et-wys');
    assert.match(await page.locator('#f-wys img').getAttribute('src'), /^blob:/);
    assert.equal(await page.locator('#f-wys img').getAttribute('data-md-src'), '/files/news.2026-10-01-editor-demo/ili.png');
    await page.locator('#f-wys h2').click(); await page.keyboard.press('End'); await page.keyboard.type('！');
    await page.click('#et-md');
    const md3 = await page.inputValue('#f-body');
    assert.ok(md3.includes('(/files/news.2026-10-01-editor-demo/ili.png)') && !md3.includes('blob:'), md3);
    assert.match(md3, /^## 重點！$/m);
    // 內文再補一個 PDF 連結（附件）
    await page.fill('#f-body', `${md3}\n\n[新聞稿全文（PDF）](/files/news.2026-10-01-editor-demo/press-release.pdf)`);

    // ⑥ 移除仍被引用的檔案 ⇒ 警告、需再按一次
    await page.click('#as-list li:nth-child(1) [data-act="remove"]');
    assert.equal(await page.locator('#as-list > li').count(), 2);
    assert.match(await page.locator('#as-list li:nth-child(1)').innerText(), /內文仍引用這個檔案/);
    await page.click('#as-list li:nth-child(1) [data-act="cancel-remove"]');
    assert.equal(await page.locator('#as-list > li').count(), 2);

    // ⑦ 預處理 → 預檢 → 產生上架包
    await page.selectOption('#f-owner', 'unit.acute-infectious');
    await page.click('#btn-submit');
    await page.waitForSelector('#btn-zip');
    assert.match(await page.locator('#pkg-tree').innerText(), /content\/\n\s+├─ news\/[\s\S]*2026-10-01-editor-demo\.json[\s\S]*assets\/[\s\S]*ili\.png[\s\S]*press-release\.pdf/);
    assert.match(await page.locator('#pkg-git').innerText(), /git switch -c content\/news\.2026-10-01-editor-demo/);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btn-zip')]);
    assert.equal(dl.suggestedFilename(), 'news.2026-10-01-editor-demo-package.zip');
    const zpath = path.join(tmp, 'pkg.zip');
    await dl.saveAs(zpath);
    const files = readZip(fs.readFileSync(zpath));
    assert.deepEqual(files.map((f) => f.name).sort(), [
      'content/assets/news.2026-10-01-editor-demo/ili.png', 'content/assets/news.2026-10-01-editor-demo/press-release.pdf', 'content/news/2026-10-01-editor-demo.json',
    ]);
    const byName = Object.fromEntries(files.map((f) => [f.name, f]));
    assert.ok(byName['content/assets/news.2026-10-01-editor-demo/ili.png'].data.equals(png));
    assert.ok(byName['content/assets/news.2026-10-01-editor-demo/press-release.pdf'].data.equals(pdf));
    for (const f of files) assert.equal(f.crc, refCrc(f.data));
    const json = JSON.parse(byName['content/news/2026-10-01-editor-demo.json'].data.toString('utf8'));
    assert.equal(json.id, 'news.2026-10-01-editor-demo');
    assert.equal(json.type, 'news');
    assert.ok(json.bodyMarkdown.includes('![2026 年流感門診就診率趨勢圖](/files/news.2026-10-01-editor-demo/ili.png)'));
    assert.deepEqual(json.assets, [
      { file: 'ili.png', kind: 'image', label: '流感 趨勢圖 ILI', alt: '2026 年流感門診就診率趨勢圖', mime: 'image/png', bytes: png.length, sha256: sha(png), license: 'OGDL-1.0', width: 64, height: 48 },
      { file: 'press-release.pdf', kind: 'attachment', label: '新聞稿全文（PDF）', mime: 'application/pdf', bytes: pdf.length, sha256: sha(pdf), machineReadable: true },
    ]);
    // 預檢：全部齊備時無資產類必補項
    assert.deepEqual(P.assetIssues(json).filter((i) => i.level === 'error'), []);
    // 只下載 JSON 仍保留
    const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('#btn-dl')]);
    assert.match(dl2.suggestedFilename(), /\.json$/);

    // ⑧ 重新整理：草稿還原內文與 metadata，檔案需重選（不存檔案內容）
    await page.click('#btn-save');
    await page.reload();
    await page.waitForSelector('#as-list li[data-uid]');
    assert.equal(await page.locator('#as-list > li').count(), 2);
    assert.match(await page.locator('#as-list').innerText(), /需重新選取檔案/);
    assert.equal(await page.evaluate(() => Object.keys(localStorage).some((k) => /blob|file/i.test(k) && k !== 'cdc.admin.draft')), false);
    const draft = JSON.parse(await page.evaluate(() => localStorage.getItem('cdc.admin.draft')));
    assert.equal(draft.assets.length, 2);
    assert.ok(draft.assets.every((a) => !('blob' in a) && !('data' in a)));
    await page.setInputFiles('#as-input', [pngFile, pdfFile]);
    await page.waitForFunction(() => !document.querySelector('#as-list').innerText.includes('需重新選取檔案'));
    assert.equal(await page.locator('#as-list > li').count(), 2);
    assert.equal(await page.locator('#as-list li:nth-child(1) [data-f="alt"]').inputValue(), '2026 年流感門診就診率趨勢圖');

    // ⑨ 壞檔案被拒收：SVG 含 script、副檔名不允許、內容與副檔名不符
    const bad = (name, buf) => ({ name, mimeType: 'application/octet-stream', buffer: Buffer.from(buf) });
    await page.setInputFiles('#as-input', [bad('evil.svg', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), bad('run.exe', 'MZ'), bad('fake.png', pdf)]);
    await page.waitForFunction(() => /3 個被拒收/.test(document.querySelector('#as-msg').innerText));
    const rej = await page.locator('#as-msg').innerText();
    assert.match(rej, /evil\.svg：SVG 內含 <script>/);
    assert.match(rej, /run\.exe：不允許的副檔名/);
    assert.match(rej, /fake\.png：內容不是有效的 \.png/);
    assert.equal(await page.locator('#as-list > li').count(), 2);

    // ⑨b 貼上 Word 內容：清成支援子集（在所見即所得裡貼上 → 轉成 Markdown）；Markdown 頁籤的 Ctrl+B
    await page.fill('#f-body', '');
    await page.click('#et-wys');
    await page.evaluate(() => {
      const dt = new DataTransfer();
      dt.setData('text/html', "<p class=MsoNormal><span style='font-family:Calibri;color:red'>貼上<b>粗體</b></span><o:p></o:p></p><p class=MsoListParagraph style='mso-list:l0 level1 lfo1'><![if !supportLists]><span style='mso-list:Ignore'>·<span>&nbsp;</span></span><![endif]>項目甲</p><p class=MsoListParagraph style='mso-list:l0 level2 lfo1'><![if !supportLists]><span style='mso-list:Ignore'>o<span>&nbsp;</span></span><![endif]>子項</p><script>window.__pwned = 1</script><img src='file:///C:/Users/a/x.png' onerror='window.__pwned = 1'>");
      dt.setData('text/plain', '貼上粗體');
      const el = document.querySelector('#f-wys'); el.focus();
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    });
    const wysHtml = await page.locator('#f-wys').innerHTML();
    assert.ok(!/<span|style=|class=|mso|<script|onerror|<img/i.test(wysHtml), wysHtml);
    assert.ok(/<ul>[\s\S]*<ul>/.test(wysHtml), '巢狀清單');
    assert.equal(await page.evaluate(() => window.__pwned), undefined);
    await page.click('#et-md');
    assert.equal(await page.inputValue('#f-body'), '貼上**粗體**\n\n- 項目甲\n  - 子項');
    await page.fill('#f-body', '貼上粗體');
    await page.evaluate(() => { const ta = document.querySelector('#f-body'); ta.focus(); ta.setSelectionRange(2, 4); });
    await page.keyboard.press('Control+b');
    assert.equal(await page.inputValue('#f-body'), '貼上**粗體**');
    await page.keyboard.press('Control+i');
    assert.equal(await page.inputValue('#f-body'), '貼上***粗體***');

    // ⑩ 截圖
    if (process.env.SHOTS) {
      const dir = path.join(ROOT, 'docs/screenshots');
      await page.fill('#f-body', md3);
      await page.click('#et-wys');
      await page.locator('#f-wys').evaluate((el) => { el.scrollTop = 0; });
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.locator('.adm-editor').screenshot({ path: path.join(dir, 'admin-editor.png') });
      await page.locator('#asset-panel').screenshot({ path: path.join(dir, 'admin-assets.png') });
    }
    assert.deepEqual(errors, []);
  } catch (e) {
    if (errors.length) e.message += `\n頁面錯誤：${errors.join(' | ')}`;
    throw e;
  } finally {
    await browser.close();
    srv.kill();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('md-convert：Word 的 <b style="mso-bidi-font-weight:normal"> 仍是粗體；真正 font-weight:normal 的 <b> 才不是', () => {
  assert.match(htmlToMd('<p><b style="mso-bidi-font-weight:normal">重點</b>內容</p>'), /\*\*重點\*\*/);
  assert.doesNotMatch(htmlToMd('<p><b style="font-weight:normal">非粗</b>內容</p>'), /\*\*非粗\*\*/);
});
