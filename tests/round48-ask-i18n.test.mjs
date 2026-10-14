// 第四十八輪 #100：答案頁（render.js）的多語字串、單位名稱、外部連結提示、疫情態勢卡。
// render.js 依賴瀏覽器的 document／window／location：這裡給最小的替身（語言設成 en，供 ownerLabel 測試），只用來產生 HTML 字串。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { STRINGS } from '../src/client/i18n.js';
import { ROWS_ASK } from '../src/client/i18n.ask.js';
import { resolveAll, askModuleSource } from '../scripts/lib/i18n-split.mjs';

globalThis.window ??= {};
globalThis.document ??= { documentElement: { lang: 'en', dataset: {} }, querySelector: () => null, head: { appendChild() {} }, createElement: () => ({}) };
globalThis.location ??= { pathname: '/en/ask/', origin: 'http://x' };
const R = await import('../src/client/answer/render.js');

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const HAN = /[㐀-鿿]/;

test('#100 答案頁字串：ja／tl／vi／id／th 與 zh-TW／en 同一組 key，無缺漏、佔位符一致、外語無中文', () => {
  const ph = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
  const keys = Object.keys(ROWS_ASK);
  assert.ok(keys.length >= 150);
  assert.ok(keys.every((k) => k.startsWith('ask.ui.')));
  for (const lang of ['en', 'ja', 'tl', 'vi', 'id', 'th']) {
    for (const k of keys) {
      const v = STRINGS[lang][k];
      assert.ok(v && v.length, `${lang} 缺 ${k}`);
      assert.equal(ph(v), ph(STRINGS['zh-TW'][k]), `${lang} ${k} 佔位符不同`);
      if (lang !== 'ja') assert.ok(!HAN.test(v), `${lang} ${k} 含中文：${v}`);
    }
  }
  assert.deepEqual(Object.keys(STRINGS.th).filter((k) => k.startsWith('ask.ui.')).sort(), keys.sort());
});

test('#100 L() 在 th／id／tl 回傳該語言（含清單 key），不再是英文', () => {
  const answerH = { th: 'คำตอบ', id: 'Jawaban', tl: 'Sagot', ja: '回答', vi: 'Câu trả lời', en: 'Answer', 'zh-TW': '回答' };
  for (const [lg, v] of Object.entries(answerH)) assert.equal(R.L('answerH', {}, lg), v);
  for (const lg of ['th', 'id', 'tl']) {
    assert.notEqual(R.L('answerSub', {}, lg), R.L('answerSub', {}, 'en'));
    assert.notEqual(R.L('modelExtractive', {}, lg), R.L('modelExtractive', {}, 'en'));
    assert.notEqual(R.L('aiBadge', {}, lg), R.L('aiBadge', {}, 'en'));
    assert.notEqual(R.L('next', {}, lg), R.L('next', {}, 'en'));
    assert.ok(Array.isArray(R.L('reportKinds', {}, lg)) && R.L('reportKinds', {}, lg).length === 5);
    assert.equal(R.L('verdict.false', {}, lg), STRINGS[lg]['ask.ui.verdict.false']);
  }
  assert.equal(R.L('modelLlm', { p: 'P', m: 'M' }, 'en'), 'Model: P · M (BYOK, called directly from your browser)');
});

test('#100 分檔：答案頁字串另成 i18n.ask.<lang>.js，不進一般語言檔；th 檔合併前綴後等於完整字串', () => {
  for (const lang of ['zh-TW', 'th']) {
    assert.ok(!Object.keys(resolveAll(lang)).some((k) => k.startsWith('ask.ui.')), '一般語言檔不應含 ask.ui.*');
    const win = {};
    new Function('window', askModuleSource(lang).replace('export default S;', ''))(Object.assign(win, { CDC: { I18N: { lang, S: { x: 1 } } } }));
    assert.equal(win.CDC.I18N.S.x, 1);
    assert.equal(win.CDC.I18N.S['ask.ui.answerH'], STRINGS[lang]['ask.ui.answerH']);
  }
});

test('#100 來源卡的權責單位依頁面語言顯示（/en/ask/ 不再出現「檢疫組」）', () => {
  const units = JSON.parse(read('content/master/units.json'));
  R.setUnits(units);
  const src = { type: 'page', owner: 'unit.quarantine', ownerName: '檢疫組', url: '/travel/', title: 'T', docTitle: 'T', reviewedAt: '2026-10-01' };
  assert.equal(R.ownerLabel(src), 'Division of Quarantine');
  assert.equal(R.ownerLabel({ ownerName: '急性傳染病組' }), 'Division of Acute Infectious Diseases', '只有中文名稱時也能反查');
  assert.equal(R.ownerLabel({ owner: 'unit.nope', ownerName: '某組' }), '某組', '主檔查不到時退回中文而不是空白');
  const body = R.sourceCardBody(src);
  assert.match(body, /Division of Quarantine/);
  assert.doesNotMatch(body, /檢疫組/);
});

test('#100 外部連結的 sr-only 提示依語言；render.js 不再有硬編碼的「另開視窗」', () => {
  assert.doesNotMatch(read('src/client/answer/render.js'), /另開視窗/);
  assert.match(R.link('https://example.org/', 'x'), /\(opens in a new window\)/);
  assert.match(R.L('newWindow', {}, 'th'), /หน้าต่างใหม่/);
  assert.equal(R.L('newWindow', {}, 'zh-TW'), '（另開視窗）');
});

test('#100 疫情態勢卡：外語欄位不齊時整張卡改用英文，不混入中文整句', async () => {
  const it = {
    status: 'rising', trend: 'up', diseaseName: '登革熱', diseaseNameEn: 'Dengue', metricLabel: '本週本土病例', metricValue: '本土 23 例', metricNumeric: 23, deltaText: '集中於南部縣市', basis: '本土病例連續上升',
    i18n: { en: { metricLabel: 'New local cases this week', deltaText: 'mostly in southern counties', basis: 'Local cases rising' }, tl: { metricLabel: 'Bagong lokal na kaso ngayong linggo' } },
  };
  globalThis.document.documentElement.lang = 'en';
  const html = await R.situationCards({ items: [it], dataDate: '2026-10-14', publisher: 'unit.epidemic-intelligence', publisherNameEn: 'Epidemic Intelligence Center' });
  assert.ok(!HAN.test(html), html);
  assert.match(html, /New local cases this week/);
  assert.match(html, /mostly in southern counties/);
});

test('#100 dist 的非中文頁沒有硬編碼的「（另開視窗）」（dist 不存在則略過）', { skip: !fs.existsSync(new URL('../dist/en/index.html', import.meta.url)) }, () => {
  const bad = [];
  const root = new URL('../dist/', import.meta.url).pathname;
  for (const lang of ['en', 'ja', 'tl', 'vi', 'id', 'th']) {
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = `${d}/${e.name}`;
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith('.html') && fs.readFileSync(p, 'utf8').includes('（另開視窗）')) bad.push(p.replace(root, ''));
      }
    };
    walk(`${root}${lang}`);
  }
  assert.deepEqual(bad.slice(0, 5), []);
  // 引擎頁的客戶端 JS 也不得寫死
  for (const f of fs.readdirSync(`${root}assets/js/answer`)) if (f.endsWith('.js')) assert.ok(!fs.readFileSync(`${root}assets/js/answer/${f}`, 'utf8').includes('另開視窗'), f);
});
