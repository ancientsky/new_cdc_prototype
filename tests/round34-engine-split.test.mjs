// 第三十四輪：答案引擎拆檔、生成式模式用到才載入、建置時 JS 壓縮（ARCHITECTURE 第 40 章、guide-staff §38）。
// Yulun 2026-10-10：「開另一輪處理，也把這些說明寫到手冊」（接續第三十三輪「智慧問答的程式大小已到預算上限附近」）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as core from '../src/client/answer/core.js';
import * as text from '../src/client/answer/text.js';
import * as rules from '../src/client/answer/rules.js';
import * as lexicon from '../src/client/answer/lexicon.js';
import * as structured from '../src/client/answer/structured.js';
import * as llm from '../src/client/answer/llm.js';
import * as llmKey from '../src/client/answer/llm-key.js';
import { minifyDir } from '../scripts/lib/minify.mjs';
import { checkJsBudget, DEFAULT_ENGINE_KB, DEFAULT_PUBLIC_KB } from '../scripts/lib/js-budget.mjs';
import { config } from '../site.config.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = process.env.DIST_DIR ? path.resolve(process.env.DIST_DIR) : path.join(ROOT, 'dist');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('core.js 照舊提供拆檔前的所有對外名稱，而且就是新模組的同一個物件（呼叫端不必改）', () => {
  const before = [
    'createEngine',
    'maskPII',
    'maskPIIDetailed',
    'detectInjection',
    'tokenize',
    'bigrams',
    'parseChineseNumber',
    'parseTimeRange',
    'rocDate',
    'numbersByUnit',
    'pdfHref',
    'splitPlain',
    'LAB_PRO_RE',
    'LAB_PUBLIC_RE',
    'ADMIT_RE',
    'RELEVANCE',
    'isLowRelevance',
    'INTENT_RULES',
    'PRO_SUB_INTENTS',
    'classifyIntent',
    'REFUSAL_RULES',
    'REFUSAL_PATTERNS',
    'vaxmapHref',
    'buildLexicon',
    'ageProfileOf',
    'ageHashOf',
    'matchSchedule',
    'NOTICE_TYPES',
    'CLOSED_MARK',
    'notifyHoursLabel',
    'normalizeNotifyTable',
  ];
  for (const n of before) assert.ok(n in core, `core.js 少了 ${n}`);
  assert.equal(core.tokenize, text.tokenize);
  assert.equal(core.REFUSAL_RULES, rules.REFUSAL_RULES);
  assert.equal(core.REFUSAL_PATTERNS, rules.REFUSAL_RULES);
  assert.equal(core.buildLexicon, lexicon.buildLexicon);
  assert.equal(core.matchSchedule, structured.matchSchedule);
  assert.equal(llm.getKey, llmKey.getKey, 'llm.js 照舊 re-export 金鑰函式（後台多語初稿用）');
});

test('分工：rules.js 只放規則與文案（不碰檢索），core.js 只剩 createEngine', () => {
  const src = read('src/client/answer/rules.js');
  assert.ok(!/function bm25|from '\.\/core\.js'/.test(src), 'rules.js 不含檢索計分、也不反向依賴 core.js');
  const c = read('src/client/answer/core.js');
  assert.ok(!/^export const (INTENT_RULES|REFUSAL_RULES)\b/m.test(c), '規則表不應再寫在 core.js');
  assert.equal([...c.matchAll(/^export function (\w+)/gm)].map((m) => m[1]).join(), 'createEngine');
});

test('答案頁不靜態載入 llm.js（民眾不下載生成式模式的程式）；金鑰欄位只靠 llm-key.js', () => {
  const ui = read('src/client/answer/ui.js');
  assert.ok(!/from '\.\/llm\.js'/.test(ui), 'ui.js 不可 import … from llm.js');
  assert.match(ui, /from '\.\/llm-key\.js'/);
  assert.match(ui, /import\('\.\/llm\.js'\)/, '送出時才 import()');
  assert.ok(!/from '\.\/llm\.js'/.test(read('src/client/answer/llm-key.js')));
});

test('minifyDir：逐檔壓縮、export 名稱與中文字串原樣、輸出 source map；MINIFY=off 不動檔案', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mz-'));
  try {
    fs.mkdirSync(path.join(dir, 'answer'));
    const a = `// 註解：給同事看的說明，上線時去掉\nexport const RULE = /(登革熱|麻疹)/;\n/** 說明 */\nexport function hello(name) {\n  const greeting = '您好，' + name;\n  return greeting;\n}\n`;
    const b = `import { hello, RULE } from './a.js';\nexport const out = hello('疾管署') + (RULE.test('登革熱') ? '✓' : '');\n`;
    fs.writeFileSync(path.join(dir, 'answer/a.js'), a);
    fs.writeFileSync(path.join(dir, 'answer/b.js'), b);
    const off = await minifyDir(dir, { enabled: false });
    assert.equal(off.skipped, true);
    assert.equal(fs.readFileSync(path.join(dir, 'answer/a.js'), 'utf8'), a);
    const r = await minifyDir(dir, { enabled: true });
    assert.equal(r.files, 2);
    assert.ok(r.after < r.before);
    const ma = fs.readFileSync(path.join(dir, 'answer/a.js'), 'utf8');
    assert.ok(!ma.includes('註解'), '註解去掉');
    assert.ok(ma.includes('您好') && ma.includes('登革熱'), '中文以 UTF-8 原字保留（不轉 \\uXXXX）');
    assert.match(ma, /\/\/# sourceMappingURL=a\.js\.map\n$/);
    const map = JSON.parse(fs.readFileSync(path.join(dir, 'answer/a.js.map'), 'utf8'));
    assert.deepEqual(map.sources, ['answer/a.js']);
    assert.ok(map.sourcesContent[0].includes('給同事看的說明'), 'source map 帶原始碼與註解，除錯時對得回去');
    const mod = await import(pathToFileURL(path.join(dir, 'answer/b.js')).href);
    assert.equal(mod.out, '您好，疾管署✓', '壓縮後模組之間照樣 import／export');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('預算：引擎頁 240 KB（原 320），公開頁 120 KB', () => {
  assert.equal(DEFAULT_ENGINE_KB, 240);
  assert.equal(DEFAULT_PUBLIC_KB, 120);
});

test('dist：答案頁壓縮後在新預算內、不含 llm.js、有 source map', (tc) => {
  const ask = path.join(DIST, 'ask/index.html');
  if (!fs.existsSync(ask)) return tc.skip('dist 尚未建置');
  const core = fs.readFileSync(path.join(DIST, 'assets/js/answer/core.js'), 'utf8');
  if (core.includes('// 答案引擎核心')) return tc.skip('dist 是 MINIFY=off 建置');
  const r = checkJsBudget(DIST, { basePath: config.basePath });
  const row = r.rows.find((x) => x.page === 'ask/index.html');
  assert.ok(row.engine && row.bytes <= DEFAULT_ENGINE_KB * 1024, `ask ${row.bytes}`);
  assert.ok(r.engine.max <= DEFAULT_ENGINE_KB * 1024, `最大引擎頁 ${r.engine.maxPage} ${r.engine.max}`);
  assert.ok(fs.existsSync(path.join(DIST, 'assets/js/answer/core.js.map')));
});
