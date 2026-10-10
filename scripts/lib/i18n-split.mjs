// 介面字串依語言拆檔（第二十六輪，issue #34）。
// 來源仍是 src/client/i18n.js（Node 模板與測試照舊 import，API 不變）；
// 建置時為每種語言產出 dist/assets/js/i18n.<lang>.js，瀏覽器每頁只載入該頁語言那一份。
// 每個 key 只留「已解析」的一筆字串（依 t() 的規則：該語言 → 英文 → 中文），所以檔內沒有 fallback 邏輯。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STRINGS } from '../../src/client/i18n.js';

export const I18N_LANGS = Object.keys(STRINGS);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CLIENT_DIR = path.join(ROOT, 'src/client');

function walkJs(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkJs(p, out);
    else if (e.name.endsWith('.js') && !/^i18n(\.|$)/.test(e.name)) out.push(p);
  }
  return out;
}

/**
 * 瀏覽器端實際會用到的 key：掃 src/client 的原始碼，
 * (a) 原始碼出現的完整 key（'japply.js.r.job' 這種字面量）；
 * (b) 以「前綴.」形式出現的動態 key（`vxs.status.${s}` 會產生 token「vxs.status.」→ 該前綴下所有 key 都留）。
 * 寧可多留不可漏留；只在伺服器端模板用的 key（佔 i18n.js 的大宗）不會上線。
 * 新增動態組 key 的寫法時，務必讓前綴以「xxx.」字面量出現在 client 原始碼（tests/round26-i18n.test.mjs 會擋漏網）。
 */
export function clientKeys(allKeys) {
  const tokens = new Set();
  for (const f of walkJs(CLIENT_DIR)) for (const m of fs.readFileSync(f, 'utf8').matchAll(/[A-Za-z0-9][\w.-]*/g)) tokens.add(m[0]);
  const prefixes = [...tokens].filter((x) => x.endsWith('.') && x.length >= 4 && x.indexOf('.') < x.length - 1);
  return allKeys.filter((k) => tokens.has(k) || prefixes.some((pre) => k.startsWith(pre)));
}

/** 與 i18n.js 的 t() 同一條 fallback 規則，但回傳「未做佔位替換」的原始字串；只含瀏覽器會用到的 key */
export function resolveAll(lang) {
  const keys = new Set(Object.values(STRINGS).flatMap((o) => Object.keys(o)));
  const out = {};
  for (const k of clientKeys([...keys].sort())) {
    const s = STRINGS[lang]?.[k] ?? STRINGS.en?.[k] ?? STRINGS['zh-TW'][k];
    if (s != null) out[k] = s;
  }
  return out;
}

/** 單一語言模組原始碼：註冊到 window.CDC.I18N，由 i18n.runtime.js 的 t() 讀取 */
export function langModuleSource(lang) {
  return (
    `// 自動產生（scripts/lib/i18n-split.mjs），請勿手改；來源 src/client/i18n.js\n` +
    `const S=${JSON.stringify(resolveAll(lang))};\n` +
    `(window.CDC=window.CDC||{}).I18N={lang:${JSON.stringify(lang)},S};\nexport default S;\n`
  );
}

/** 在 dist/assets/js 寫出七個語言檔，移除完整的 i18n.js。回傳 { lang: bytes } */
export function emitI18nBundles(distDir) {
  const dir = path.join(distDir, 'assets/js');
  const sizes = {};
  for (const lang of I18N_LANGS) {
    const src = langModuleSource(lang);
    fs.writeFileSync(path.join(dir, `i18n.${lang}.js`), src);
    sizes[lang] = Buffer.byteLength(src);
  }
  fs.rmSync(path.join(dir, 'i18n.js'), { force: true }); // 完整七語檔只留給 Node 端，不上線
  return sizes;
}
