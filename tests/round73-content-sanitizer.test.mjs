// 第七十三輪（資安稽核 F-1／F-2／F5）：內容 HTML 白名單淨化、連結協定白名單（schema pattern＋safeHref 兩層）、answer 引擎輸入長度上限。
// 說明文件：docs/content-html-safety.md
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { md, mdInline } from '../scripts/lib/markdown.mjs';
import { html, safeHref } from '../scripts/lib/render.mjs';
import { validateSite } from '../scripts/lib/validate.mjs';
import { loadSite } from '../scripts/lib/load.mjs';
import { makeCtx } from '../scripts/lib/pages.mjs';
import * as diseaseTpl from '../src/templates/public/disease.mjs';
import { parseTimeRange, numbersByUnit, maskPII, maskPIIDetailed } from '../src/client/answer/text.js';
import { govern, config } from './helpers.mjs';

// 輸出裡不可出現的東西：可執行的協定、事件屬性、危險標籤
const DANGEROUS = /javascript:|vbscript:|data:|\son[a-z]+\s*=|<\s*(script|iframe|base|meta|link|form|input|object|embed|svg|math|style|foreignobject)\b|srcdoc|xlink:href|http-equiv/i;
/** 解掉實體後再檢查，避免 &#x61; 之類的寫法躲過斷言 */
const decoded = (s) => s.replace(/&#x([0-9a-f]+);?/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);?/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&(tab|newline);/gi, '').replace(/[\t\n\r]/g, '');

const PAYLOADS = [
  ['實體夾帶 javascript:（原始 <a>）', '<a href="jav&#x61;script:alert(1)">點我</a>'],
  ['實體夾帶 javascript:（Markdown 連結）', '[點我](jav&#x61;script:alert(1))'],
  ['javascript: 中間夾 &#x09;', '<a href="java&#x09;script:alert(1)">t</a>'],
  ['javascript: 中間夾換行', '<a href="java\nscript:alert(1)">n</a>'],
  ['十進位實體 &#106;', '<a href="&#106;avascript:alert(1)">e</a>'],
  ['大小寫混合＋前置空白', '<a href=" JaVaScRiPt:alert(1)">u</a>'],
  ['vbscript:', '<a href="vbscript:msgbox(1)">v</a>'],
  ['未閉合 <iframe srcdoc>', '<iframe srcdoc="<script>alert(1)</script>">'],
  ['<base href>', '<base href="https://evil.example/">'],
  ['<form action=外部>', '<form action="https://evil.example/"><input name="pw"><button>送出</button></form>'],
  ['<meta http-equiv=refresh>', '<meta http-equiv="refresh" content="0;url=https://evil.example/">'],
  ['<link rel=stylesheet>', '<link rel="stylesheet" href="https://evil.example/x.css">'],
  ['未閉合 <object>', '<object data="https://evil.example/x.swf">'],
  ['未閉合 <embed>', '<embed src="https://evil.example/x.swf">'],
  ['<svg><script>', '<svg><script>alert(1)</script></svg>'],
  ['<svg onload>', '<div>\n<svg onload="alert(1)"><circle r="1"/></svg>\n</div>'],
  ['<details ontoggle>', '<details ontoggle="alert(1)" open><summary>摘要</summary>內容</details>'],
  ['<math xlink:href>', '<math><mtext><a xlink:href="javascript:alert(1)">m</a></mtext></math>'],
  ['<img onerror>', '<img src="x" onerror="alert(1)">'],
  ['data: 連結', '<a href="data:text/html,<script>alert(1)</script>">d</a>'],
  ['data: 圖片', '<img src="data:image/svg+xml,<svg onload=alert(1)>">'],
  ['巢狀未閉合標籤', '<div><p>未閉合 <b>粗體 <a href="javascript:x">j'],
  ['標籤拆字', '<scr<script>ipt>alert(1)</script>'],
  ['style 屬性', '<p style="background:url(javascript:alert(1))">s</p>'],
  ['<style> 區塊', '<style>body{background:url(https://evil.example/)}</style>文字'],
];

for (const [name, payload] of PAYLOADS) {
  test(`md() 淨化：${name}`, () => {
    for (const out of [md(payload), mdInline(payload)]) {
      assert.doesNotMatch(decoded(out), DANGEROUS, out);
      assert.doesNotMatch(out, /\sstyle\s*=/i, out);
    }
  });
}

test('md()：保留文字內容（標籤拿掉、字留下），<details> 與 open 屬性保留', () => {
  assert.match(md('<details ontoggle="alert(1)" open><summary>摘要</summary>內容</details>'), /<details open=""><summary>摘要<\/summary>內容<\/details>/);
  assert.match(md('<a href="jav&#x61;script:alert(1)">點我</a>'), /<a>點我<\/a>/);
});

test('md()：協定相對 //host 視同 http(s)，保留', () => {
  assert.match(md('<a href="//cdn.example.org/x">pr</a>'), /href="\/\/cdn\.example\.org\/x"/);
});

test('md()：合法內容不受影響（表格、上下標、中日韓粗體、mailto／tel、站內與外部連結、頁碼標記）', () => {
  const out = md('常見**咳嗽**、發燒^1^，CO~2~。\n\n| 欄 | 值 |\n|:-|-:|\n| a | 1 |\n\n[信箱](mailto:a@cdc.gov.tw) [電話](tel:1922) [站內](/faq/) [外部](https://www.cdc.gov.tw/)\n\n<p class="c-pagemark" id="page-9"><span>第 9 頁</span></p>');
  assert.match(out, /常見<strong>咳嗽<\/strong>、發燒<sup>1<\/sup>，CO<sub>2<\/sub>/);
  assert.match(out, /<table>[\s\S]*<th align="left">欄<\/th>[\s\S]*<td align="right">1<\/td>/);
  assert.match(out, /href="mailto:a@cdc\.gov\.tw"/);
  assert.match(out, /href="tel:1922"/);
  assert.match(out, new RegExp(`href="${config.basePath}/faq/"`));
  assert.match(out, /href="https:\/\/www\.cdc\.gov\.tw\/"/);
  assert.match(out, /<p class="c-pagemark" id="page-9"><span>第 9 頁<\/span><\/p>/);
  assert.match(md('```js\nlet a = 1;\n```'), /<pre tabindex="0"><code class="language-js">let a = 1;\n<\/code><\/pre>/);
  assert.match(md('1. 甲\n2. 乙\n\n---\n\n> 引用\n\n行尾  \n換行'), /<ol>[\s\S]*<hr>[\s\S]*<blockquote>[\s\S]*行尾<br>換行/);
  assert.equal(md('他說 "好" 與 \'行\''), '<p>他說 &quot;好&quot; 與 &#39;行&#39;</p>\n', 'marked 的文字跳脫寫法不變（建置輸出逐位元相同）');
});

test('md()：資產登錄的圖片仍補上 alt／width／height、loading、decoding 與 basePath', () => {
  const out = md('![](/files/news.x/chart.png)', { id: 'news.x', assets: [{ file: 'chart.png', alt: '流感趨勢圖', width: 640, height: 360 }] });
  assert.equal(out, `<p><img src="${config.basePath}/files/news.x/chart.png" alt="流感趨勢圖" width="640" height="360" loading="lazy" decoding="async"></p>\n`);
  assert.match(md('<figure><img src="/files/news.x/chart.png" alt=""><figcaption>圖一</figcaption></figure>', { id: 'news.x', assets: [{ file: 'chart.png', alt: '流感趨勢圖' }] }), /<figure><img src="[^"]*\/files\/news\.x\/chart\.png" alt="流感趨勢圖" loading="lazy" decoding="async"><figcaption>圖一<\/figcaption><\/figure>/);
});

// ── 連結協定：第二層（模板 safeHref） ──
test('safeHref：只放行 http(s)／mailto／tel 與相對路徑；先解實體、去控制字元', () => {
  for (const bad of ['javascript:alert(1)', 'jav&#x61;script:x', 'jav&#x61script:x', 'java\tscript:x', ' JaVa&Tab;script:x', '\u0000javascript:x', 'java​script:x', 'javascript&colon;x', 'data:text/html,x', 'vbscript:x', 'file:///etc/passwd']) {
    assert.equal(safeHref(bad), '#', bad);
  }
  for (const ok of ['https://www.cdc.gov.tw/?a=1&b=2', 'http://x.tw', '/files/a.pdf', './a', '#top', '?q=a:b', '//cdn.x/y', 'mailto:a@b.tw', 'tel:1922', 'foo/bar:baz']) {
    assert.equal(safeHref(ok), ok, ok);
  }
});

test('html``：緊接 href=／src= 的插值自動過 safeHref，其他屬性與文字不受影響', () => {
  const v = 'javascript:alert(1)';
  assert.equal(String(html`<a href="${v}" title="${v}">${v}</a>`), '<a href="#" title="javascript:alert(1)">javascript:alert(1)</a>');
  assert.equal(String(html`<img src="${'data:image/png;base64,AAAA'}">`), '<img src="#">');
  assert.equal(String(html`<a href="${'https://a.tw/?x=1&y=2'}">`), '<a href="https://a.tw/?x=1&amp;y=2">');
});

test('answer 引擎 link()：危險協定改成 #', async () => {
  // answer/data.js 在模組層讀 document／window；Node 端給最小替身（只在本測試動態載入時用）
  globalThis.document ??= /** @type {any} */ ({ documentElement: { lang: 'zh-TW', dataset: {} } });
  globalThis.window ??= /** @type {any} */ ({});
  const { link } = await import('../src/client/answer/render.js');
  assert.match(link('javascript:alert(1)', 'x'), /href="#"/);
  assert.match(link('https://www.cdc.gov.tw/', 'x'), /href="https:\/\/www\.cdc\.gov\.tw\/"/);
  assert.match(link('tel:1922', 'x'), /href="tel:1922"/);
});

// ── 連結協定：第一層（schema pattern） ──
test('schema：materials[].url 為 javascript: ⇒ 驗證失敗；模板把它中和成 #', () => {
  const site = loadSite(config);
  const d = site.collections.diseases.find((x) => x.materials?.length);
  const errsBefore = validateSite(site).filter((e) => e.includes(d.id.replace(/^disease\./, '')));
  d.materials = [{ ...d.materials[0], url: 'javascript:alert(1)' }];
  const errs = validateSite(site).filter((e) => e.includes(d.id.replace(/^disease\./, '')) && !errsBefore.includes(e));
  assert.ok(errs.some((e) => /materials/.test(e) && /pattern/.test(e)), errs.join('\n'));
  for (const [col, key, mutate] of [
    ['datasets', 'resources', (x) => { x.resources = [{ name: 'x', format: 'csv', url: 'javascript:alert(1)' }]; }],
    ['news', 'attachments', (x) => { x.attachments = [{ label: 'x', url: 'data:text/html,x' }]; }],
    ['topics', 'links', (x) => { x.links = [{ label: 'x', href: 'vbscript:x' }]; }],
  ]) {
    const s = loadSite(config);
    const item = s.collections[col][0];
    const slug = item.id.split('.').slice(1).join('.');
    const before = validateSite(s).filter((e) => e.includes(slug));
    mutate(item);
    const after = validateSite(s).filter((e) => e.includes(slug) && !before.includes(e));
    assert.ok(after.some((e) => e.includes(key) && /pattern/.test(e)), `${col}.${key}：${after.join('\n')}`);
  }
});

test('模板：疾病頁 materials 的 javascript: 連結輸出為 href="#"', () => {
  const site = govern('2026-11-12', (s) => {
    const d = s.collections.diseases.find((x) => x.materials?.length);
    d.materials = [{ ...d.materials[0], url: 'jav&#x61;script:alert(1)' }, { ...d.materials[0], label: '正常連結', url: 'https://www.cdc.gov.tw/' }];
  });
  const d = site.collections.diseases.find((x) => x.materials?.some((m) => m.label === '正常連結'));
  const out = String(diseaseTpl.render(makeCtx(site, 'zh-TW', { path: `/diseases/${d.slug}/` }), { item: d }));
  assert.doesNotMatch(decoded(out), /href="javascript:/i);
  assert.match(out, /<a href="#" rel="noopener">/);
  assert.match(out, /<a href="https:\/\/www\.cdc\.gov\.tw\/" rel="noopener">正常連結 ↗<\/a>/);
});

// ── F-2：answer 引擎輸入長度上限 ──
test('text.js：5 萬字輸入在 100 ms 內返回；短輸入行為不變', () => {
  const cases = [
    () => parseTimeRange('一十'.repeat(25000) + '萬'),
    () => numbersByUnit('1'.repeat(50000)),
    () => maskPII('1.'.repeat(25000)),
    () => maskPIIDetailed('09'.repeat(25000)),
  ];
  for (const f of cases) {
    const t0 = performance.now(); f(); const ms = performance.now() - t0;
    assert.ok(ms < 100, `${f} 花了 ${ms.toFixed(1)} ms`);
  }
  assert.deepEqual(parseTimeRange('近 3 年的登革熱病例'), parseTimeRange('近 3 年的登革熱病例'.slice(0, 2000)));
  assert.equal(maskPII('我的電話 0912345678'), maskPII('我的電話 0912345678'.slice(0, 2000)));
  assert.match(maskPII('我的電話 0912345678'), /^我的電話 (?!0912345678)/);
});
