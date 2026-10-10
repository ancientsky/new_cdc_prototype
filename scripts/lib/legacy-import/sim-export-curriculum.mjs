#!/usr/bin/env node
// 傳染病核心教材的模擬匯出（第十二批，第二十八輪，Issue #38）：舊站「傳染病核心教材」列表頁＋各疾病的教材頁。
//
// 這是模擬匯出，不是舊站資料：開發環境連不到 www.cdc.gov.tw。頁面標題、附件檔名與日期取自公開搜尋摘錄（未查證，見 README），
// 舊頁網址 ID 是 fakeId 產生的示意值；唯一寫死的是麻疹教材 PDF 的 /File/Get/ 網址（搜尋結果出現過的真網址，內容未取得）。
// 附件 PDF 是一頁英文的示意檔，不是教材內容。正式匯出（資訊室從 CMS 匯出欄目）取代整個目錄即可，不需要改程式。
//
// 為什麼這樣排：
//   - 教材頁放在 /Category/DiseaseTeach/（搜尋時看到的網址模式，與 DiseaseDefine 病例定義、DiseaseManual 工作手冊並列）；
//     規則檔的 disease-docs 模式把 Teach 判成 guideline，本批要驗證「標題寫核心教材 ⇒ curriculum」蓋過網址模式（docTypeStrongKeywords）
//   - 舊頁內文只有下載連結（教材本體是 PDF）⇒ 走 pdf-only 佔位，不整批轉 PDF（legacy-import 第 8 節）
//   - 登革熱、麻疹在新站已有示範匯入版（content/documents/curriculum-*.2026-10-10.json）⇒ 清單 target 指過去，草稿與既有內容比對
//   - 新型A型流感、鼠疫新站還沒有 ⇒ 清單 pending，/pro/curriculum/ 列為「舊站其他核心教材（尚未匯入）」
// 用法：node scripts/lib/legacy-import/sim-export-curriculum.mjs [輸出目錄]   （預設 data/legacy-export/core-curriculum）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { BASE, esc, fakeId, P, A, pdfText, shell } from './sim-export.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const EXPORTED_AT = '2026-10-10';

/** 教材頁：key＝清單 key＝側檔 tab；attachment.url 沒寫就用 fakeId；pub 沒寫 ⇒ 側檔不給發布日（測 date-missing） */
export const PAGES = [
  {
    key: 'dengue', disease: '登革熱', title: '登革熱核心教材', pub: '2025-04-18',
    att: { name: 'curriculum-dengue-2025-04.pdf', label: '2025-04-登革熱防治核心教材.pdf' },
    excerpt: '搜尋摘錄：疾管署「重要指引及教材」頁（https://www.cdc.gov.tw/Category/MPage/O5l65bHP7CwFNJOsF7wXbA）列有「登革熱核心教材」，檔名 2025-04-登革熱防治核心教材.pdf、最後更新 2025/4/18；未能重現，待確認。',
  },
  {
    key: 'measles', disease: '麻疹', title: '麻疹核心教材', pub: null,
    att: { name: 'curriculum-measles.pdf', label: '麻疹核心教材.pdf', url: 'https://www.cdc.gov.tw/File/Get/eH0KllYdi__tvUdV8al0lA' },
    excerpt: '搜尋結果標題「麻疹核心教材.pdf」（https://www.cdc.gov.tw/File/Get/eH0KllYdi__tvUdV8al0lA）；版次、日期與頁面網址都看不到，所以側檔沒有發布日。',
  },
  {
    key: 'novel-influenza-a', disease: '新型A型流感', title: '新型A型流感核心教材', pub: '2025-01-15',
    att: { name: 'curriculum-novel-influenza-a-11401.pdf', label: '新型A型流感_核心教材-11401版.pdf' },
    excerpt: '搜尋摘錄出現檔名「新型A型流感_核心教材-11401版.pdf」（114 年 1 月版）；發布日 2025-01-15 是示意值。',
  },
  {
    key: 'plague', disease: '鼠疫', title: '鼠疫核心教材', pub: '2025-03-18',
    att: { name: 'curriculum-plague-1140318.pdf', label: '鼠疫核心教材_1140318.pdf' },
    excerpt: '搜尋摘錄出現檔名「鼠疫核心教材_1140318.pdf」；發布日取檔名上的民國 114 年 3 月 18 日。',
  },
];

const LIST = { key: 'core-curriculum-list', title: '傳染病核心教材', crumbs: ['首頁', '專業人員', '傳染病核心教材'] };

export function generateCurriculum(outDir) {
  const out = path.resolve(outDir);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(path.join(out, 'files'), { recursive: true });
  const urlOf = (p) => `${BASE}/Category/DiseaseTeach/${fakeId(`curriculum:${p.key}`)}`;
  const write = (stem, { url, title, crumbs, pub, upd, tab, atts, bodyHtml }) => {
    const fileList = atts.length ? `<div class="file-list"><h4>相關檔案</h4><ul>${atts.map((a) => `<li><a href="${esc(a.url)}">${esc(a.label)}</a> <span class="size">(PDF)</span></li>`).join('')}</ul></div>` : '';
    fs.writeFileSync(path.join(out, `${stem}.html`), shell({ title, crumbs, bodyHtml: `${bodyHtml}\n${fileList}`, updated: upd ?? '', menuActive: '教育訓練' }));
    fs.writeFileSync(path.join(out, `${stem}.json`), `${JSON.stringify({ url, title, category: crumbs.slice(1).join('／'), ...(pub ? { publishedAt: pub, updatedAt: upd ?? pub } : {}), breadcrumbs: crumbs, tab, attachments: atts.map((a) => ({ url: a.url, label: a.label, file: a.name })) }, null, 2)}\n`);
    for (const a of atts) if (a.buf) fs.writeFileSync(path.join(out, 'files', a.name), a.buf);
  };
  PAGES.forEach((p, i) => {
    const att = { ...p.att, url: p.att.url ?? `${BASE}/File/Get/${fakeId(`curriculum:${p.key}:0`)}`, buf: pdfText(`Core curriculum: ${p.key} (SAMPLE)`, ['Simulated export of a Taiwan CDC core curriculum page - not the real document.', 'Chapters, objectives and text are not reproduced here.']) };
    write(`${String(i + 1).padStart(2, '0')}-curriculum-${p.key}`, {
      url: urlOf(p), title: p.title, crumbs: ['首頁', '傳染病介紹', p.disease, '傳染病核心教材'], pub: p.pub, upd: p.pub, tab: p.key, atts: [att],
      bodyHtml: P('全文請下載附件。'),
    });
  });
  write(`${String(PAGES.length + 1).padStart(2, '0')}-${LIST.key}`, {
    url: `${BASE}/Category/List/${fakeId('curriculum:list')}`, title: LIST.title, crumbs: LIST.crumbs, pub: EXPORTED_AT, upd: EXPORTED_AT, tab: LIST.key, atts: [],
    bodyHtml: `<ul class="doc-list">${PAGES.map((p) => `<li>${A(urlOf(p), p.title)}</li>`).join('')}</ul>`,
  });
  const pages = PAGES.length + 1;
  fs.writeFileSync(path.join(out, '_export.json'), `${JSON.stringify({
    format: 'cdc-legacy-export/1', simulated: true, exportedAt: EXPORTED_AT, site: BASE, batch: 'core-curriculum', pages,
    source: `模擬匯出：傳染病核心教材（列表頁 1 頁＋疾病教材頁 ${PAGES.length} 頁）。標題、附件檔名與日期取自公開搜尋摘錄、未查證；頁面網址 ID 是示意值（只有麻疹教材 PDF 的 /File/Get/ 網址是搜尋結果出現過的真網址）；附件 PDF 是示意檔，不是教材內容。正式匯出取代整個目錄即可。`,
    generator: 'scripts/lib/legacy-import/sim-export-curriculum.mjs',
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(out, 'README.md'), readme(pages));
  return { dir: out, pages, files: fs.readdirSync(path.join(out, 'files')).length };
}

const readme = (n) => `# 舊站匯出（模擬）：傳染病核心教材（第十二批，第二十八輪）

> **這是模擬匯出，不是舊站資料。** 開發環境連不到 www.cdc.gov.tw，這 ${n} 頁由 \`scripts/lib/legacy-import/sim-export-curriculum.mjs\` 合成。
> 頁面網址 ID、發布日（除另註者）與附件 PDF 內容都是示意；**正式匯出取代整個目錄即可**，不需要改程式。

## 每頁的依據（都未查證）

| 頁 | 標題 | 附件檔名 | 依據 |
| --- | --- | --- | --- |
${PAGES.map((p) => `| ${p.key} | ${p.title} | ${p.att.label} | ${p.excerpt} |`).join('\n')}
| ${LIST.key} | ${LIST.title} | — | 舊站有「首頁／專業人員／傳染病核心教材」入口（content/migration/legacy-services.json）；實際是列表頁還是欄目頁（MPage）待資訊室確認，這裡以列表頁（/Category/List/）示意 |

## 重新產生

\`\`\`
node scripts/lib/legacy-import/sim-export-curriculum.mjs data/legacy-export/core-curriculum
\`\`\`

## 轉換

\`\`\`
node scripts/import-legacy.mjs data/legacy-export/core-curriculum --out data/legacy-import/core-curriculum --now 2026-10-10T03:00:00Z --apply-migration
\`\`\`

移轉清單：\`content/migration/core-curriculum.json\`。結果與教訓見 \`docs/legacy-import.md\` 第 10.13 節。
`;

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const r = generateCurriculum(process.argv[2] ?? path.join(ROOT, 'data/legacy-export/core-curriculum'));
  console.log(`模擬匯出 core-curriculum：${r.pages} 頁、files/ ${r.files} 個檔 → ${path.relative(ROOT, r.dir)}`);
}
