// 第三十四輪（ARCHITECTURE 第 40 章）：建置時壓縮瀏覽器端 JS。
//
// 做法：src/client 原封不動複製到 dist/assets/js 之後，用 esbuild 對 dist/assets/js 底下每個 .js「逐檔」壓縮（transform，不 bundle）：
//   - 每個檔仍是獨立的 ES module，import／export 名稱與檔案路徑不變，所以頁面 <script type="module" src> 與 import() 都不用改；
//   - 去掉註解與空白、縮短區域變數名；字串內容（中文、規則用的正規表示式）一字不改；
//   - 另外輸出 .js.map（source map），瀏覽器開發者工具可以對回原始碼與註解，除錯時不必看壓縮後的程式。
// 為什麼不在原始碼就寫精簡：src/client 的註解是寫給同事和 IT 看的（規則來源、決策理由），不能為了檔案大小刪掉。
// 為什麼不 bundle：每頁載入哪些檔由模板決定、js-budget 依 import 關係計算，逐檔壓縮不改這套結構，風險最小。
// 關掉：MINIFY=off npm run build（除錯時想直接在 dist 看原始碼）。
import fs from 'node:fs';
import path from 'node:path';

function walkJs(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkJs(p, out);
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

/**
 * 壓縮 dir 底下所有 .js（就地覆寫）並輸出同名 .js.map。
 * @param {string} dir 例：dist/assets/js
 * @param {{ enabled?: boolean }} [opts] enabled：預設為 MINIFY 環境變數不是 off
 * @returns {Promise<{ skipped: boolean, files: number, before: number, after: number }>}
 */
export async function minifyDir(dir, { enabled = process.env.MINIFY !== 'off' } = {}) {
  const files = walkJs(dir);
  if (!enabled) return { skipped: true, files: files.length, before: 0, after: 0 };
  const { transform } = await import('esbuild');
  let before = 0,
    after = 0;
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    const rel = path.relative(dir, f).split(path.sep).join('/');
    const r = await transform(src, {
      loader: 'js',
      format: 'esm',
      target: 'es2022',
      minify: true,
      charset: 'utf8', // 中文保持 UTF-8（預設會轉成 \uXXXX，一個字從 3 位元組變 6 位元組，反而更大）
      legalComments: 'none',
      sourcemap: 'external',
      sourcefile: rel,
      sourcesContent: true,
    });
    const base = path.basename(f);
    fs.writeFileSync(f, `${r.code}//# sourceMappingURL=${base}.map\n`);
    fs.writeFileSync(`${f}.map`, r.map);
    before += Buffer.byteLength(src);
    after += fs.statSync(f).size;
  }
  return { skipped: false, files: files.length, before, after };
}
