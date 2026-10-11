// 第四十輪（issue #70、#75）：首頁 chip1–4 與語言頁「給移工與外籍人士」卡片問句是民眾第一次按的問題，
// 七語每一句都在評估集（HP 題，preset 欄位記 i18n key）。這裡確保題目文字與介面字串一致——
// 改了 i18n 的預設問句卻沒同步評估集，這支測試會失敗，避免評估集測的是已經不存在的問句。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { t } from '../src/client/i18n.js';

const LANGS = ['zh-TW', 'en', 'ja', 'tl', 'vi', 'id', 'th'];
const KEYS = ['home.chip1', 'home.chip2', 'home.chip3', 'home.chip4', 'home.foreign.q'];
const set = JSON.parse(fs.readFileSync(new URL('../content/governance/eval-set.json', import.meta.url), 'utf8'));
const hp = set.questions.filter((x) => x.preset);

test('七語 × 五個預設問句都在評估集', () => {
  for (const lang of LANGS)
    for (const key of KEYS) {
      const x = hp.find((q) => q.preset === key && (q.lang ?? 'zh-TW') === lang);
      assert.ok(x, `缺 ${lang} ${key}`);
    }
  assert.equal(hp.length, LANGS.length * KEYS.length);
});

test('評估集題目文字與介面字串一致', () => {
  for (const x of hp) assert.equal(x.q, t(x.lang ?? 'zh-TW', x.preset), `${x.id} ${x.preset}`);
});

test('預設問句不得是提示注入拒答，也不得是 no-match（chip4 只問「是真的嗎」例外：應為 no-clarification）', () => {
  for (const x of hp) {
    assert.notEqual(x.expect.refusalKind, 'prompt-injection', x.id);
    assert.notEqual(x.expect.refusalKind, 'no-match', x.id);
    if (x.preset === 'home.chip4') assert.equal(x.expect.refusalKind, 'no-clarification', x.id);
    else assert.equal(x.expect.refuse, false, x.id);
  }
});
