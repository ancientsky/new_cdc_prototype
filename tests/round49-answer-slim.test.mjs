// 第四十九輪：答案引擎改讀 v1/answer/{services,media,datasets}.json（不含譯文的精簡副本，見 scripts/lib/emit-api.mjs、docs/deploy.md §20.3）。
//   - 精簡副本 ＝ 完整 API 去掉 i18n／languages，其他欄位與順序完全相同（引擎拿到的資料不變，答案不變）
//   - 答案頁的清單（deps-manifest.js）指向精簡副本，不再下載含七語譯文的完整檔
//   - 完整的 v1/services.json 等對外 API 仍在、仍含譯文（對外契約不變）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENGINE_PRIMARY, ENGINE_SECONDARY } from '../src/client/answer/deps-manifest.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = process.env.DIST_DIR ? path.resolve(process.env.DIST_DIR) : path.join(ROOT, 'dist');
const NAMES = ['services', 'media', 'datasets', 'faq', 'vaccines']; // 第五十輪加 faq、vaccines
const hasDist = NAMES.every((n) => fs.existsSync(path.join(DIST, 'v1/answer', `${n}.json`)));
const read = (rel) => {
  const j = JSON.parse(fs.readFileSync(path.join(DIST, 'v1', rel), 'utf8'));
  return j && typeof j === 'object' && 'data' in j ? j.data : j; // 與 data.js 的 v1() 相同：有信封就取 data
};

test('deps-manifest：答案頁讀精簡副本，不讀含譯文的完整檔', () => {
  const names = [...ENGINE_PRIMARY, ...ENGINE_SECONDARY].map((e) => e[0]);
  for (const n of NAMES) {
    assert.ok(names.includes(`answer/${n}`), `清單應含 answer/${n}`);
    assert.ok(!names.includes(n), `清單不應再含完整的 ${n}`);
  }
});

test('精簡副本 ＝ 完整 API 去掉 i18n／languages（其他欄位與順序相同）；完整檔仍含譯文', { skip: !hasDist && '尚未建置 dist' }, () => {
  for (const n of NAMES) {
    const full = read(`${n}.json`);
    const slim = read(`answer/${n}.json`);
    assert.equal(slim.length, full.length, n);
    const strip = ({ i18n: _i, languages: _l, ...rest }) => rest;
    assert.deepEqual(slim, full.map(strip), n);
    assert.ok(slim.every((x) => !('i18n' in x) && !('languages' in x)), `${n} 精簡副本不應含譯文`);
  }
  assert.ok(read('services.json').some((x) => x.i18n), '完整的 services.json 仍應含譯文（對外 API 不變）');
});

test('v1/index.json 列出精簡副本（services、media 是可選檔，data.js 的 v1Optional 先查清單才下載）', { skip: !hasDist && '尚未建置 dist' }, () => {
  const idx = read('index.json');
  const paths = new Set((Array.isArray(idx) ? idx : []).map((x) => x.path));
  for (const n of [...NAMES, 'clarifications']) assert.ok(paths.has(`/v1/answer/${n}.json`), `index.json 應列出 /v1/answer/${n}.json`);
});

// 第五十輪：澄清是一級內容，答案頁（謠言查證分支）會顯示外語澄清，所以副本只留「已審閱」語言的譯文，機器初稿不得進來
test('澄清副本：i18n 只含 languages 標 reviewed 的語言；其他欄位與完整檔相同', { skip: !hasDist && '尚未建置 dist' }, () => {
  const full = read('clarifications.json');
  const slim = read('answer/clarifications.json');
  assert.equal(slim.length, full.length);
  for (const [i, c] of slim.entries()) {
    for (const l of Object.keys(c.i18n ?? {})) assert.equal(c.languages?.[l]?.status, 'reviewed', `${c.id} 的 ${l} 不是 reviewed 卻進了答案副本`);
    const { i18n: _a, ...a } = c;
    const { i18n: _b, ...b } = full[i];
    assert.deepEqual(a, b, c.id);
  }
  const names = [...ENGINE_PRIMARY, ...ENGINE_SECONDARY].map((e) => e[0]);
  assert.ok(names.includes('answer/clarifications') && !names.includes('clarifications'));
});
