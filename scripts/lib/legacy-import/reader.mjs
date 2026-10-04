// 讀舊站匯出目錄（格式見 data/legacy-export/README 與 docs/legacy-import.md）。
//
// 匯出格式（我們定義，正式站由資訊室從 CMS 資料庫匯出成這個樣子）：
//   {dir}/_export.json         選填：{ exportedAt: 'YYYY-MM-DD', simulated?: true, source?: '…', site?: 'https://…' }
//   {dir}/{name}.html          一頁一檔：舊站頁面的完整 HTML（含版型外殼；只取內容區）
//   {dir}/{name}.json          同名側檔：{ url, title, category, publishedAt, updatedAt, breadcrumbs[], attachments[{url,label,file}], typeid?, tab? }
//   {dir}/files/…              附件與內文圖片（side file attachments[].file 與 <img src> 的檔名指向這裡）
// 或一個 {dir}/index.json 陣列：每筆＝側檔欄位＋ html（內嵌字串）或 htmlFile（相對路徑）。
import fs from 'node:fs';
import path from 'node:path';

export const SIDE_FIELDS = ['url', 'title', 'category', 'publishedAt', 'updatedAt', 'breadcrumbs', 'attachments', 'typeid', 'tab'];

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

/** @returns {{ dir, meta: {exportedAt, simulated, source, site}, pages: {name, htmlFile, html, side}[], filesDir }} */
export function readExport(dir) {
  const root = path.resolve(dir);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error(`匯出目錄不存在：${dir}`);
  const metaFile = path.join(root, '_export.json');
  const meta = fs.existsSync(metaFile) ? readJson(metaFile) : {};
  const pages = [];
  const indexFile = path.join(root, 'index.json');
  if (fs.existsSync(indexFile)) {
    const arr = readJson(indexFile);
    if (!Array.isArray(arr)) throw new Error('index.json 必須是陣列');
    arr.forEach((side, i) => {
      const name = side.name ?? String(i + 1).padStart(3, '0');
      let html = side.html;
      let htmlFile = null;
      if (html == null && side.htmlFile) { htmlFile = path.join(root, side.htmlFile); html = fs.readFileSync(htmlFile, 'utf8'); }
      pages.push({ name, htmlFile: htmlFile ? path.relative(root, htmlFile) : null, html: html ?? '', side });
    });
  } else {
    const names = fs.readdirSync(root).filter((f) => f.endsWith('.html')).sort();
    for (const f of names) {
      const stem = f.replace(/\.html$/, '');
      const sideFile = path.join(root, `${stem}.json`);
      const side = fs.existsSync(sideFile) ? readJson(sideFile) : {};
      pages.push({ name: stem, htmlFile: f, html: fs.readFileSync(path.join(root, f), 'utf8'), side, missingSide: !fs.existsSync(sideFile) });
    }
  }
  return { dir: root, meta, pages, filesDir: path.join(root, 'files') };
}
