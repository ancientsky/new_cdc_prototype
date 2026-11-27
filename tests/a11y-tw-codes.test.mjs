// 第七十五輪：新版「網站無障礙規範」附件一檢測碼預檢（scripts/a11y-tw.mjs；docs/a11y.md 第 12 節）。
// (a) 每個檢測碼各一個「不合格」與「合格」的小 HTML，確認判定規則本身；
// (b) 建置期處理（scripts/lib/a11y-text.mjs、Markdown 渲染器）產生的 title、scope、表情符號包裝；
// (c) 真實網站：有 dist 就掃 dist（本機建置後）；沒有 dist（CI 的純內容 PR 在建置前跑 test:content）就在記憶體裡渲染全站再掃。
//     為什麼放進 test:content：表格缺 scope、表情符號缺 title 這類問題是從內容（Markdown／JSON）進來的，純內容 PR 不跑瀏覽器檢測，
//     這裡是它們唯一會被擋下的地方（docs/deploy.md §28.4）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { checkHtml, checkCss, scanDist, summarize, CODES } from '../scripts/a11y-tw.mjs';
import { wrapEmoji, inlineLinkTitles, describeLink, isInlineLink, parseTree, walk } from '../scripts/lib/a11y-text.mjs';
import { md, tableScope, setMarkdownPage } from '../scripts/lib/markdown.mjs';
import { t as i18nT } from '../src/client/i18n.js';
import { govern, memWriter } from './helpers.mjs';
import { renderAllPages } from '../scripts/lib/pages.mjs';
import { ROOT } from '../scripts/lib/load.mjs';

const doc = (body, { lang = 'zh-TW', head = '<title>測試頁</title>' } = {}) =>
  `<!doctype html><html lang="${lang}"><head>${head}</head><body><main>${body}</main></body></html>`;
const codes = (h) => new Set(checkHtml(h).map((f) => f.code));
const T = (k, v) => i18nT('zh-TW', k, v);

// 每個檢測碼：[不合格的 HTML, 合格的 HTML]
const CASES = {
  HM1110100C: [doc('<img src="a.png">'), doc('<img src="a.png" alt="圖">')],
  HM1110101C: [
    doc('<map name="m"><area href="/x/" shape="rect" coords="0,0,1,1"></map>'),
    doc('<map name="m"><area href="/x/" alt="區域" shape="rect" coords="0,0,1,1"></map>'),
  ],
  HM1110103C: [
    doc('<p>洗手 🧼 很重要</p>'),
    doc('<p>洗手 <span role="img" aria-label="圖示" title="圖示">🧼</span> 很重要 <span aria-hidden="true">✓</span></p>'),
  ],
  HM1110104C: [doc('<form><input type="image" src="go.png"></form>'), doc('<form><input type="image" src="go.png" alt="送出"></form>')],
  HM1110105C: [doc('<object data="a.svg"></object>'), doc('<object data="a.svg" title="流程圖"></object>')],
  HM1110106C: [doc('<img src="d.png" alt="" title="裝飾">'), doc('<img src="d.png" alt="">')],
  HM1130100C: [doc('<h1>標題</h1><h3>跳級</h3>'), doc('<h1>標題</h1><h2>第二層</h2><h3>第三層</h3><h2>回到第二層</h2>')],
  HM1130101C: [
    doc('<table><thead><tr><th>欄</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>'),
    doc('<table><thead><tr><th scope="col">欄</th></tr></thead><tbody><tr><th scope="row">列</th><td>1</td></tr></tbody></table>'),
  ],
  HM1130102C: [
    doc('<table><tr><th id="h1">欄</th></tr><tr><td headers="nope">1</td></tr></table>'),
    doc('<table><tr><th id="h1">欄</th></tr><tr><td headers="h1">1</td></tr></table>'),
  ],
  HM1130103C: [
    doc('<form><label for="s">選</label><select id="s"><option>1</option></select></form>'),
    doc('<form><label for="s">選</label><select id="s"><optgroup label="群"><option>1</option></optgroup></select></form>'),
  ],
  HM1130104C: [
    doc('<form><input type="text" aria-label="只有 aria-label"></form>'),
    doc(
      '<form><label for="a">姓名</label><input id="a"><label>信箱 <input type="email"></label><input type="text" title="搜尋"><input type="hidden" name="x"></form>',
    ),
  ],
  HM1130105C: [
    doc('<form><label><input type="radio" name="r"> A</label><label><input type="radio" name="r"> B</label></form>'),
    doc(
      '<form><fieldset><legend>選一個</legend><label><input type="radio" name="r"> A</label><label><input type="radio" name="r"> B</label></fieldset></form>',
    ),
  ],
  HM1130200C: [doc('<p>שלום</p>'), doc('<p dir="rtl" lang="he">שלום</p>')],
  HM1240102C: [
    `<!doctype html><html lang="zh-TW"><head><title>x</title></head><body><div><a href="/x/">孤兒連結</a></div><a class="skip-link" href="#main">跳到主要內容</a></body></html>`,
    doc('<a href="/x/">在 main 裡</a>'),
  ],
  HM1240200C: ['<!doctype html><html lang="zh-TW"><head></head><body><main><p>沒有標題</p></main></body></html>', doc('<p>有標題</p>')],
  HM1240400C: [
    doc('<div><a href="/x/"><img src="i.png" alt="X"></a><a href="/x/">X</a></div>'),
    doc('<div><a href="/x/"><img src="i.png" alt=""> X</a></div>'),
  ],
  HM1240401C: [
    doc('<p>請看 <a href="/x/">說明</a> 再決定。</p><ul><li><a href="/y/"></a></li></ul>'),
    doc(
      '<p>請看 <a href="/x/" title="說明：測試頁">說明</a> 再決定。</p><ul><li><a href="/y/">單獨一個連結</a></li></ul><div><a href="/a/">選單一</a> <a href="/b/">選單二</a></div>',
    ),
  ],
  HM1310100C: ['<!doctype html><html><head><title>x</title></head><body><main></main></body></html>', doc('')],
  ME1320200C: [
    doc('<ul><li><a href="/files/x/report.docx">報告</a></li></ul>'),
    doc('<ul><li><a href="/files/x/report.pdf">報告</a></li><li><a href="/files/x/data.ods">資料</a></li></ul>'),
  ],
  HM1410201C: [doc('<iframe src="/map/"></iframe>'), doc('<iframe src="/map/" title="地圖"></iframe>')],
  CS2140401C: [doc('<p style="font-size:12px">小字</p>'), doc('<p style="font-size:.8125rem">小字</p>')],
  HM2310200C: [doc('<p>Taiwan Centers for Disease Control</p>'), doc('<p lang="en">Taiwan Centers for Disease Control</p><p>疾管署 CDC</p>')],
  FORM_FIELDSET: [
    doc('<form><label for="a">一</label><input id="a"><label for="b">二</label><input id="b"></form>'),
    doc('<form><fieldset><legend>篩選</legend><label for="a">一</label><input id="a"><label for="b">二</label><input id="b"></fieldset></form>'),
  ],
};

test('(a) 每個檢測碼都有「不合格」與「合格」兩個樣本，判定方向正確', () => {
  assert.deepEqual(Object.keys(CASES).sort(), Object.keys(CODES).sort(), '每個檢測碼都要有樣本');
  for (const [code, [bad, good]] of Object.entries(CASES)) {
    assert.ok(codes(bad).has(code), `${code}：不合格樣本應被判出`);
    assert.ok(!codes(good).has(code), `${code}：合格樣本不應被判出（實得 ${[...codes(good)].join('、')}）`);
  }
});

test('(a) 等級：AA 是 CS2140401C 與 HM2310200C；只有 HM1130103C、HM2310200C 與 FORM_FIELDSET 只列警告', () => {
  assert.deepEqual(
    Object.entries(CODES)
      .filter(([, c]) => c.warn)
      .map(([k]) => k)
      .sort(),
    ['FORM_FIELDSET', 'HM1130103C', 'HM2310200C'],
  );
  assert.deepEqual(
    Object.entries(CODES)
      .filter(([, c]) => c.level === 'AA')
      .map(([k]) => k)
      .sort(),
    ['CS2140401C', 'HM2310200C'],
  );
  const s = summarize([{ code: 'HM1110100C' }, { code: 'HM1130103C' }]);
  assert.deepEqual([s.fails, s.warnings], [1, 1]);
});

test('(a) CS2140401C：CSS 檔的 px 字級（含 var() 備援值）被判出，rem／em 不會', () => {
  assert.equal(checkCss('.a{font-size:12px}').length, 1);
  assert.equal(checkCss('.a{font-size:var(--fs-xs,12px)}').length, 1);
  assert.equal(checkCss('.a{font-size:.75rem;width:12px}/* font-size:12px */').length, 0);
});

test('(b) wrapEmoji：表情符號包成 role=img＋aria-label＋title；屬性值與已標示的不重包', () => {
  const out = wrapEmoji('洗手 🧼 <a href="/x/" title="🧼">連結</a> <span aria-hidden="true">✓</span> 🛡️👍🏽', '圖示');
  assert.equal(
    out,
    '洗手 <span role="img" aria-label="圖示" title="圖示">🧼</span> <a href="/x/" title="🧼">連結</a> <span aria-hidden="true">✓</span> <span role="img" aria-label="圖示" title="圖示">🛡️👍🏽</span>',
  );
  assert.equal(wrapEmoji('沒有表情符號 → ↗', '圖示'), '沒有表情符號 → ↗', '箭頭不是字符圖案');
  assert.ok(!codes(doc(`<p>${out}</p>`)).has('HM1110103C'));
});

test('(b) 行內連結 title：包含連結文字、上下文是前面最近的標題；外站與下載檔另外標示；不重複、不動單獨的連結', () => {
  const h = inlineLinkTitles(
    doc(
      '<h1>登革熱</h1><h2>預防</h2><p>請看 <a href="/x/">說明 →</a>、<a href="https://www.who.int/a">WHO</a> 與 <a href="/files/a/b.csv">資料</a>。</p><ul><li><a href="/solo/">單獨</a></li></ul><h2>標題裡 <a href="/h/">連結</a></h2>',
    ),
    { t: T, siteHost: 'ancientsky.github.io' },
  );
  const titles = [...h.matchAll(/<a [^>]*?title="([^"]*)"[^>]*>/g)].map((m) => m[1]);
  assert.deepEqual(titles, ['說明：預防', 'WHO：預防（外部網站：www.who.int）', '下載 CSV：資料：預防', '連結：預防']);
  assert.ok(!/href="\/solo\/" title/.test(h), '單獨佔一個清單項目的連結不加（那是 AAA 的 HM3240900C）');
  assert.ok(!codes(h).has('HM1240401C'));
  // 名稱含標籤（WCAG 2.5.3）：title 一定包含可見文字，也不只等於可見文字
  for (const text of ['CSV', '看趨勢與地圖', 'Influenza']) {
    const tt = describeLink({ text, contexts: ['', text, ''], href: '/x/', t: T });
    assert.ok(tt.includes(text) && tt !== text, tt);
  }
  assert.equal(
    describeLink({ text: 'Influenza', contexts: ['Current outbreaks'], href: '/x/', t: (k, v) => i18nT('en', k, v) }),
    'Influenza – Current outbreaks',
    '字詞用當頁語言',
  );
  const tree = parseTree('<p><a href="/a/">一</a> <a href="/b/">二</a></p><p>文字<a href="/c/">三</a></p>');
  assert.deepEqual([...walk(tree)].filter((e) => e.name === 'a').map(isInlineLink), [false, false, true], '只和其他連結並列不算行內');
});

test('(b) Markdown：表格 th 有 scope；設定當頁語言後，行內連結補 title、表情符號包 title', () => {
  assert.equal(
    tableScope('<table><thead><tr><th>a</th><th align="left">b</th></tr></thead><tbody><tr><th>r</th><td>1</td></tr></tbody></table>'),
    '<table><thead><tr><th scope="col">a</th><th scope="col" align="left">b</th></tr></thead><tbody><tr><th scope="row">r</th><td>1</td></tr></tbody></table>',
  );
  assert.match(md('| 欄 | 值 |\n|---|---|\n| a | b |'), /<th scope="col">欄<\/th>/);
  assert.ok(!/title=/.test(md('## 段落\n\n請看 [說明](/x/)。')), '沒設定當頁語言（單元測試、閘道預覽）時不補，輸出與改版前相同');
  setMarkdownPage({ t: T, siteHost: 'ancientsky.github.io' });
  try {
    const out = md('## 聯絡方式\n\n請看 [說明](/x/) 🧼\n\n沒有標題的段落要等整頁那一次。');
    assert.match(out, /<a href="[^"]*\/x\/" title="說明：聯絡方式">說明<\/a> <span role="img" aria-label="圖示" title="圖示">🧼<\/span>/);
    assert.ok(!/title=/.test(md('請看 [說明](/x/)。')), '片段裡沒有標題可當上下文：留給 pages.mjs 對整頁補（那時才知道頁面標題）');
  } finally {
    setMarkdownPage(null);
  }
});

// ── (c) 真實網站 ──
const DIST = process.env.DIST_DIR ? path.resolve(process.env.DIST_DIR) : path.join(ROOT, 'dist');
const fmt = (fails) =>
  fails
    .slice(0, 12)
    .map((f) => `  ${f.code} ${f.page}：${f.snippet}`)
    .join('\n');

test('(c) 全站沒有 A／AA 級檢測碼不合格（有 dist 掃 dist，沒有就在記憶體渲染全站）', async () => {
  let findings;
  if (fs.existsSync(path.join(DIST, 'index.html'))) {
    findings = scanDist(DIST).findings;
  } else {
    const mem = memWriter();
    await renderAllPages(govern('2026-10-01'), mem.write);
    findings = [];
    for (const [rel, h] of mem.files) if (rel.endsWith('.html')) for (const f of checkHtml(h)) findings.push({ ...f, page: `/${rel}` });
    const styles = path.join(ROOT, 'src/styles');
    for (const f of fs.readdirSync(styles).filter((x) => x.endsWith('.css')))
      for (const x of checkCss(fs.readFileSync(path.join(styles, f), 'utf8'))) findings.push({ ...x, page: `src/styles/${f}` });
  }
  const fails = findings.filter((f) => !CODES[f.code]?.warn);
  assert.equal(fails.length, 0, `檢測碼不合格 ${fails.length} 項（npm run a11y:tw 看完整報告；規則見 docs/a11y.md 第 12 節）：\n${fmt(fails)}`);
});
