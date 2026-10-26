// 第六十五輪：智慧問答四個弱項（錯字、長輩說法、情境題、外語）的補法（docs/ask-search-llm.md §19）。
//   - 讀音容錯：同音字（登格熱）、注音（ㄉㄥ革熱、ㄉㄥ ㄍㄜˊ ㄖㄜˋ）、大千鍵盤亂碼（2/ ek6bk4）、注音文虛字（會傳染ㄇ）；
//     護欄：站上寫過的詞不改（結合≠結核）、英文與號碼不當亂碼、讀音表大小、用到才載入。
//   - 詞彙主檔 folk：長輩說法、台語候選詞只用在問句端，公開詞彙頁、索引不用。
//   - 模型改寫問句：只加詞、詞要站上真的有（vetTerms）、模型輸入有遮個資、拿不到改寫就照原結果；CI 不叫模型。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { config } from '../site.config.mjs';
import { loadSite } from '../scripts/lib/load.mjs';
import { applyGovernance } from '../scripts/lib/governance.mjs';
import { buildSearchIndex } from '../scripts/lib/index-builder.mjs';
import { applyConsistency } from '../scripts/lib/consistency.mjs';
import { decodeKeyboard } from '../src/client/answer/route-phonetic.js';
import { withFolk } from '../src/client/answer/lexicon.js';
import { llmRewriteQuery, REWRITE_PROMPT } from '../src/client/answer/llm.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let SITE = null;
function site() {
  if (SITE) return SITE;
  SITE = loadSite(config);
  SITE.today = '2026-10-01';
  applyGovernance(SITE);
  SITE.searchIndex = buildSearchIndex(SITE);
  applyConsistency(SITE);
  return SITE;
}
let ENGINE = null;
async function engine() {
  if (ENGINE) return ENGINE;
  const { engineFromSite } = await import('../eval/run-eval.mjs');
  return (ENGINE = engineFromSite(site()));
}
const ask = async (q, opts = {}) => (await engine()).answer(q, { lang: 'zh-TW', view: 'public', ...opts });
const cites = (r) => (r.sentences ?? []).flatMap((s) => s.cite ?? []);
const guard = (r, kind) => (r.guards ?? []).find((g) => g.kind === kind);

// ───────── 讀音容錯 ─────────

test('大千鍵盤：2/ ek6bk4 解回注音；英文、號碼、網址不是亂碼', () => {
  assert.equal(decodeKeyboard('2/ ek6bk4'), 'ㄉㄥ ㄍㄜˊ ㄖㄜˋ');
  assert.equal(decodeKeyboard('su3cl3'), 'ㄋㄧˇ ㄏㄠˇ');
  for (const s of ['covid', 'hpv', 'dengue fever', '0912345678', 'www.cdc.gov.tw', 'ns1', 'bnt', 'h5n1']) assert.equal(decodeKeyboard(s), null, s);
});

test('同音字：病名選錯同音字時依正確病名回答，畫面說明改了什麼', async () => {
  for (const [q, to, disease] of [['登格熱的症狀有哪些', '登革熱', 'disease.dengue'], ['麻診會傳染嗎', '麻疹', 'disease.measles'], ['屈公並是什麼', '屈公病', 'disease.chikungunya']]) {
    const r = await ask(q);
    assert.equal(r.refused, false, q);
    assert.equal(r.disease, disease, q);
    assert.ok(r.termNotes.some((n) => n.kind === 'typo' && n.to === to), `${q}：要有「以下依『${to}』回答」`);
    assert.ok(guard(r, 'phonetic'), q);
    assert.equal(r.query, q, '畫面與紀錄上的問句仍是民眾原本打的字');
  }
  // 兩個字都是同音錯字：第五十三輪的近似字修正（只改一個中間字）不處理，讀音比對處理
  const two = await ask('流行姓腮線炎');
  assert.equal(two.disease, 'disease.mumps');
  assert.equal(guard(two, 'near-miss'), undefined);
  assert.ok(two.termNotes.some((n) => n.to === '流行性腮腺炎'));
});

test('答得出來的問句不跑讀音容錯（常見問題不需要任何分支）：被狗咬、出國、問疫苗地點', async () => {
  const { createEngine } = await import('../src/client/answer/core.js');
  const e = await engine();
  for (const q of ['被狗咬怎麼辦', '去泰國要注意什麼', '流感疫苗去哪裡打']) assert.equal(guard(await ask(q), 'phonetic'), undefined, q);
  assert.equal(typeof createEngine, 'function');
  assert.ok(e.isWeak(await ask('登格熱', { phonetic: false })), '同音字的原樣結果是答不好，才會觸發');
});

test('注音：夾在病名裡、整個病名打注音、忘了切輸入法，都對到登革熱', async () => {
  for (const q of ['ㄉㄥ革熱怎麼預防', 'ㄉㄥ ㄍㄜˊ ㄖㄜˋ', '2/ ek6bk4']) {
    const r = await ask(q);
    assert.equal(r.disease, 'disease.dengue', q);
    assert.ok(r.termNotes.some((n) => n.kind === 'typo'), q);
  }
});

test('注音文：句尾單獨的聲母換回虛字（會傳染ㄇ→嗎），不另外提示', async () => {
  const r = await ask('登革熱會傳染ㄇ');
  assert.equal(r.disease, 'disease.dengue');
  assert.ok(guard(r, 'phonetic')?.fixes.some((f) => f.how === 'particle'));
  assert.equal(r.termNotes.filter((n) => n.kind === 'typo').length, 0);
});

test('護欄：站上寫過的詞不改（結合疫苗≠結核）；答得好的問句不載入讀音容錯', async () => {
  const r = await ask('結合疫苗');
  assert.equal(guard(r, 'phonetic'), undefined);
  assert.ok(!r.termNotes.some((n) => n.to === '結核病'));
  const ok = await ask('登革熱的症狀');
  assert.equal(guard(ok, 'phonetic'), undefined);
});

test('外語頁不跑讀音容錯；opts.phonetic=false 可關閉', async () => {
  const r = await ask('登格熱', { phonetic: false });
  assert.equal(guard(r, 'phonetic'), undefined);
  const en = await ask('dengue symptoms', { lang: 'en' });
  assert.equal(guard(en, 'phonetic'), undefined);
});

test('讀音表：壓縮後 ≤ 20 KB；只由 route-phonetic.js 載入，core.js 沒有靜態 import', () => {
  const data = fs.readFileSync(path.join(ROOT, 'src/client/answer/zhuyin-data.js'));
  assert.ok(zlib.gzipSync(data, { level: 6 }).length <= 20 * 1024, `讀音表 gzip ${zlib.gzipSync(data).length} bytes`);
  const core = read('src/client/answer/core.js');
  assert.ok(!/^import .*zhuyin-data/m.test(core) && !/^import .*route-phonetic/m.test(core), 'core.js 不可靜態 import 讀音容錯');
  assert.match(core, /phonetic: \(\) => import\('\.\/route-phonetic\.js'\)/);
  assert.match(read('src/client/answer/route-phonetic.js'), /await import\('\.\/zhuyin-data\.js'\)/);
});

// ───────── 詞彙主檔 folk（長輩說法、台語） ─────────

test('folk：候選詞都有來源與狀態；問句端當別名用', async () => {
  const gl = site().master.glossary;
  const folk = gl.flatMap((g) => (g.folk ?? []).map((f) => ({ ...f, term: g.id })));
  assert.ok(folk.length >= 10);
  for (const f of folk) {
    assert.ok(['candidate', 'confirmed'].includes(f.status), f.text);
    assert.ok(f.source, `${f.text} 要寫來源`);
    assert.ok(f.text.length >= 2, '單字別名會到處誤中');
  }
  for (const [q, disease] of [['出麻會傳染嗎', 'disease.measles'], ['被狗咬會得瘋狗病嗎', 'disease.rabies'], ['寒熱仔是什麼病', 'disease.malaria'], ['百日嗽要打疫苗嗎', 'disease.pertussis']]) {
    const r = await ask(q);
    assert.equal(r.disease, disease, q);
  }
  const merged = withFolk(gl).find((g) => g.id === 'term.measles');
  assert.ok(merged.aliases.includes('出麻'));
  assert.ok(!gl.find((g) => g.id === 'term.measles').aliases?.includes('出麻'), 'withFolk 不改原本的主檔物件');
});

test('folk：索引與公開詞彙頁不用（候選詞不對外宣稱是官方別名、不改變索引排序）', () => {
  const ib = read('scripts/lib/index-builder.mjs');
  assert.ok(!/withFolk|\.folk/.test(ib), 'index-builder 不讀 folk');
  for (const f of fs.readdirSync(path.join(ROOT, 'src/templates/public'))) assert.ok(!/\.folk\b/.test(read(`src/templates/public/${f}`)), f);
  const chunks = site().searchIndex.public.filter((c) => (c.terms ?? []).includes('出麻'));
  assert.equal(chunks.length, 0);
});

test('台語腹瀉說法只在問句端換（漏屎→腹瀉），詞彙主檔不新增「腹瀉」詞條', async () => {
  const { PARAPHRASE } = await import('../src/client/answer/lexicon.js');
  assert.ok(PARAPHRASE.some(([re, zh]) => re.test('漏屎') && zh.includes('腹瀉')));
  assert.ok(!site().master.glossary.some((g) => g['zh-TW'] === '腹瀉'));
});

// ───────── 模型改寫問句 ─────────

test('vetTerms：只留站上真的有的詞，最多 8 個', async () => {
  const e = await engine();
  assert.deepEqual(e.vetTerms(['德國麻疹', '孕婦', '這個詞站上絕對沒有寫過', 'x', '<b>']), ['德國麻疹', '孕婦']);
  assert.ok(e.vetTerms(Array.from({ length: 20 }, () => '登革熱')).length === 1);
});

test('extraTerms：只加詞、原問句不變；情境題（懷孕時出疹又發燒）加上站內用語後答得到德國麻疹', async () => {
  const before = await ask('懷孕時出疹又發燒怎麼辦');
  const e = await engine();
  assert.ok(e.isWeak(before), '原樣問答不好（這題是挑戰集 dev 題）');
  const after = await ask('懷孕時出疹又發燒怎麼辦', { extraTerms: e.vetTerms(['德國麻疹', '孕婦', '出疹', '發燒']) });
  assert.equal(e.isWeak(after), false);
  assert.ok(cites(after).some((c) => c.startsWith('disease.rubella')));
  assert.deepEqual(guard(after, 'query-rewrite').terms, ['德國麻疹', '孕婦', '出疹', '發燒']);
  assert.equal(after.query, '懷孕時出疹又發燒怎麼辦');
});

test('llmRewriteQuery：個資先遮、病名只能從清單挑、模型錯誤時回空陣列', async () => {
  let sent = null;
  const fake = async (_url, init) => {
    sent = JSON.parse(init.body);
    return { ok: true, json: async () => ({ model: 'm', content: [{ type: 'text', text: JSON.stringify({ terms: ['孕婦', 'fever'], diseases: ['德國麻疹', '自創病名'] }) }] }) };
  };
  const r = await llmRewriteQuery('我電話0912345678，懷孕發燒起疹子', { key: 'k', diseaseNames: ['德國麻疹', '麻疹'], fetchImpl: fake });
  assert.ok(!sent.messages[0].content.includes('0912345678'), '問句送出前要遮個資');
  assert.equal(sent.system, REWRITE_PROMPT);
  assert.deepEqual(r.terms, ['德國麻疹', '孕婦']);
  const bad = await llmRewriteQuery('懷孕發燒', { key: 'k', fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}) }) });
  assert.deepEqual(bad.terms, []);
  assert.ok(bad.error);
});

test('改寫只在答不好時才叫、只在 BYOK 模式；CI 與建置不呼叫 run-rewrite', () => {
  const ui = read('src/client/answer/ui.js');
  assert.match(ui, /if \(llmEnabled\(\) && !result\.paused && !result\.injection && engine\.isWeak\(result\)\)/);
  const pkg = read('package.json');
  for (const f of ['.github/workflows/pages.yml', 'scripts/build.mjs']) if (fs.existsSync(path.join(ROOT, f))) assert.ok(!read(f).includes('run-rewrite'), f);
  assert.ok(pkg.includes('"eval:rewrite"'));
});
