#!/usr/bin/env node
// 統計專區欄目的模擬匯出（ARCHITECTURE 17.3 第十一批）：舊站 /Category/List/ZrvS2zJwZ03tl8CbKYdI8g 底下的頁面
//   對應既有新站資料集（content/datasets）與統計年報出版品：
//     - 列表 2 頁（統計專區、英文 Data & Statistics；skip-list）
//     - 外部系統入口 3 頁（傳染病統計資料查詢系統、疾管署資料開放平臺、防疫資料庫）
//     - 期刊頁 4 頁（疫情監測速訊、流感速訊、腸病毒疫情週報、COVID-19 週報：一頁列很多期 PDF）
//     - 統計表頁 3 頁（境外移入確定病例統計、常規疫苗接種完成率、法定傳染病死亡統計）
//     - 統計年報 1 頁（傳染病統計暨監視年報，六期 PDF）
//     - 另複製結核病批、登革熱批匯出的「統計資料」頁各 1 頁（同網址，測跨批重複）
//   數字全部示意。
//   真實 ID：統計專區根 ZrvS2zJwZ03tl8CbKYdI8g、法定傳染病境外移入確定病例統計 5Q6qrh5kM6TnpnRpy3XDfQ、
//   防疫資料庫 i5N2W9G-FWJkh3agfLA-Kg、疫情監測速訊 94JVbJ2BFjR_3MTi-9s9Cg、英文 Data & Statistics gK4BJWe3qYlmNxYJBqEcxA。
//   其餘 ID 為示意（/Category/MPage/{id}）。正式匯出（資訊室從 CMS 匯出欄目）取代整個目錄即可。
// 用法：node scripts/lib/legacy-import/sim-export-statistics.mjs [輸出目錄]   （預設 data/legacy-export/statistics）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { BASE, esc, fakeId, P, H, A, TABLE, pdfText, shell } from './sim-export.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const EXPORTED_AT = '2026-10-03';

const TOP = ['首頁', '統計專區'];
const ROOT_ID = 'ZrvS2zJwZ03tl8CbKYdI8g';
const EN_ROOT_ID = 'gK4BJWe3qYlmNxYJBqEcxA';

export function generateStatistics(outDir) {
  const items = [];
  const page = (key, o) => items.push({ key, atts: [], imgs: [], ...o });
  const sid = (s) => fakeId(`statistics:${s}`);
  const mpage = (key) => `${BASE}/Category/MPage/${sid(key)}`;
  const pdf = (name, label, title, lines = ['Simulated export - not the real file. Numbers are illustrative.']) => ({ name, label, url: `${BASE}/File/Get/${sid(`file:${name}`)}`, buf: pdfText(title, lines), type: 'PDF' });

  // ── 外部系統入口 ──
  page('nidss', {
    url: mpage('nidss'), title: '傳染病統計資料查詢系統', crumbs: [...TOP, '傳染病統計資料查詢系統'], pub: '2012-01-01', upd: '2026-08-12',
    body: () => `${P('傳染病統計資料查詢系統提供法定傳染病通報病例、確定病例與死亡等統計的線上查詢與下載。')}\n${P('請由下列系統入口進入查詢。')}\n<ul><li>${A('https://nidss.cdc.gov.tw/', '傳染病統計資料查詢系統（NIDSS）')}</li></ul>`,
  });
  page('open-data-portal', {
    url: mpage('open-data-portal'), title: '疾管署資料開放平臺', crumbs: [...TOP, '疾管署資料開放平臺'], pub: '2018-05-01', upd: '2026-07-20',
    body: () => `${P('疾管署資料開放平臺提供機器可讀的開放資料集，包括每週監測、病例統計與疫苗接種資料，依政府資料開放授權條款提供。')}\n<ul><li>${A('https://data.cdc.gov.tw/', '疾管署資料開放平臺')}</li></ul>`,
  });
  page('epidemic-database', {
    url: `${BASE}/Category/MPage/i5N2W9G-FWJkh3agfLA-Kg`, title: '防疫資料庫', crumbs: [...TOP, '防疫資料庫'], pub: '2014-03-01', upd: '2026-06-30',
    body: () => `${P('防疫資料庫彙整傳染病通報、監測與統計資料，供研究與防疫人員查詢。')}\n${P('法定傳染病統計請至傳染病統計資料查詢系統，開放資料請至資料開放平臺。')}\n<ul><li>${A('https://data.cdc.gov.tw/', '疾管署資料開放平臺')}</li><li>${A('https://nidss.cdc.gov.tw/nndss/', '法定傳染病統計查詢')}</li></ul>`,
  });

  // ── 期刊頁 ──
  const weeks = (from, to, fn) => Array.from({ length: to - from + 1 }, (_, i) => fn(from + i));
  page('surveillance-express', {
    url: `${BASE}/Category/MPage/94JVbJ2BFjR_3MTi-9s9Cg`, title: '疫情監測速訊', crumbs: [...TOP, '疫情監測速訊'], pub: '2016-01-01', upd: '2026-10-02',
    atts: weeks(33, 40, (w) => pdf(`surveillance-express-2026-w${w}.pdf`, `疫情監測速訊 2026 年第 ${w} 週`, `Surveillance express 2026 W${w} (SAMPLE)`)),
    body: () => P('疫情監測速訊每週發布國內外傳染病監測重點，包括法定傳染病通報趨勢與重要疫情摘要。下列為近期各期。'),
  });
  page('flu-express', {
    url: mpage('flu-express'), title: '流感速訊', crumbs: [...TOP, '流感速訊'], pub: '2015-10-01', upd: '2026-09-30',
    atts: weeks(35, 40, (w) => pdf(`flu-express-w${w}.pdf`, `流感速訊 第 ${w} 週`, `Influenza express W${w} (SAMPLE)`)),
    body: () => `${P('流感速訊每週彙整流感門急診就診、重症與病毒型別監測結果。')}\n${P('更多流感資訊請見流感防疫專區。')}\n<ul><li>${A('https://antiflu.cdc.gov.tw/', '流感防治網')}</li></ul>`,
  });
  page('ev-weekly', {
    url: mpage('ev-weekly'), title: '腸病毒疫情週報', crumbs: [...TOP, '腸病毒疫情週報'], pub: '2015-04-01', upd: '2026-10-01',
    atts: weeks(36, 40, (w) => pdf(`ev-weekly-115-w${w}.pdf`, `腸病毒疫情週報 115 年第 ${w} 週`, `Enterovirus weekly report 115 W${w} (SAMPLE)`)),
    body: () => P('腸病毒疫情週報每週彙整門急診就診人次、重症病例與病毒型別監測，提供各界掌握疫情趨勢。'),
  });
  page('covid-weekly', {
    url: mpage('covid-weekly'), title: 'COVID-19 週報', crumbs: [...TOP, 'COVID-19 週報'], pub: '2023-05-01', upd: '2026-10-02',
    atts: [37, 38, 40, 41].map((w) => pdf(`covid-weekly-2026-w${w}.pdf`, `COVID-19 週報 2026 年第 ${w} 週`, `COVID-19 weekly report 2026 W${w} (SAMPLE)`)),
    body: () => P('COVID-19 週報彙整本土確定病例、重症與死亡、疫苗接種與病毒變異株監測。本頁僅列出部分期別。'),
  });

  // ── 統計表頁 ──
  const imported = [[2016, 387, 18.9], [2017, 412, 19.6], [2018, 439, 20.4], [2019, 471, 21.8], [2020, 142, 11.3], [2021, 96, 7.9], [2022, 168, 10.2], [2023, 523, 24.1], [2024, 604, 26.7], [2025, 651, 28.0]];
  const importedCsv = Buffer.from(`年,境外移入確定病例數(示意),占全部確定病例比率_百分比(示意)\n${imported.map((r) => r.join(',')).join('\n')}\n`, 'utf8');
  page('imported-cases', {
    url: `${BASE}/Category/Page/5Q6qrh5kM6TnpnRpy3XDfQ`, title: '法定傳染病境外移入確定病例統計', crumbs: [...TOP, '法定傳染病境外移入確定病例統計'], pub: '2016-01-01', upd: '2026-09-10',
    atts: [{ name: 'imported-cases-by-year.csv', label: '法定傳染病境外移入確定病例統計（CSV，示意數字）', url: `${BASE}/File/Get/${sid('file:imported-cases-csv')}`, buf: importedCsv, type: 'CSV' }],
    body: () => `${P('法定傳染病境外移入確定病例統計：歷年境外移入確定病例數及占全部確定病例之比率。數字為示意。')}\n${TABLE(['年', '境外移入確定病例數', '占全部確定病例比率（%）'], imported.map(([y, n, r]) => [String(y), String(n), r.toFixed(1)]))}`,
  });
  const vc = [[104, 97.2], [105, 97.5], [106, 97.8], [107, 98.0], [108, 98.1], [109, 97.4], [110, 96.9], [111, 97.3], [112, 97.9], [113, 98.2], [114, 98.4]];
  page('vaccine-coverage', {
    url: mpage('vaccine-coverage'), title: '常規疫苗接種完成率', crumbs: [...TOP, '常規疫苗接種完成率'], pub: '2016-01-01', upd: '2026-09-15',
    body: () => `${P('國內兒童常規疫苗歷年接種完成率（民國年）。數字為示意。')}\n${TABLE(['年', '接種完成率（%）'], vc.map(([y, r]) => [String(y), r.toFixed(1)]))}`,
  });
  const deaths = [[2015, 28], [2016, 31], [2017, 35], [2018, 33], [2020, 29], [2021, 41], [2022, 57]];
  page('death-stats', {
    url: mpage('death-stats'), title: '法定傳染病死亡統計', crumbs: [...TOP, '法定傳染病死亡統計'], pub: '2016-01-01', upd: '2024-03-15',
    body: () => `${P('法定傳染病歷年死亡人數統計。數字為示意。')}\n${TABLE(['年', '死亡人數'], deaths.map(([y, n]) => [String(y), String(n)]))}`,
  });

  // ── 統計年報 ──
  page('annual-report', {
    url: mpage('annual-report'), title: '傳染病統計暨監視年報', crumbs: [...TOP, '傳染病統計暨監視年報'], pub: '2016-06-01', upd: '2026-06-20',
    atts: [2020, 2021, 2022, 2023, 2024, 2025].map((y) => pdf(`statistics-annual-${y}.pdf`, `傳染病統計暨監視年報 ${y} 年`, `Annual report of infectious disease statistics ${y} (SAMPLE)`)),
    body: () => P('傳染病統計暨監視年報彙整每年法定傳染病通報與監測統計、疫情分析與防治成果，各年度年報如下。'),
  });

  // ── 列表頁（最後建立，連結其他頁）──
  const list = (key, url, title, crumbs, lang, mk) => page(key, { isList: true, lang, url, title, crumbs, pub: EXPORTED_AT, upd: EXPORTED_AT, body: mk });
  list('list-statistics', `${BASE}/Category/List/${ROOT_ID}`, '統計專區', [...TOP], 'zh',
    () => `<ul class="doc-list">${items.filter((i) => !i.isList).map((i) => `<li>${A(i.url, i.title)}</li>`).join('')}</ul>`);
  const en = [['Notifiable Disease Statistics (NIDSS)', 'nidss'], ['Open Data Portal', 'open-data-portal'], ['Weekly Surveillance Express', 'surveillance-express'], ['Influenza Express', 'flu-express'], ['Annual Report of Infectious Disease Statistics', 'annual-report']];
  list('list-statistics-en', `${BASE}/En/Category/List/${EN_ROOT_ID}`, 'Data & Statistics', ['Home', 'Data & Statistics'], 'en',
    () => `<ul class="doc-list">${en.map(([t, k]) => `<li>${A(items.find((i) => i.key === k).url, t)}</li>`).join('')}</ul>`);

  // ── 複製結核病批、登革熱批的「統計資料」頁（連同附件）──
  const copies = [];
  for (const [key, dir, stem] of [['tb-stats', 'tuberculosis', '24-stats'], ['dengue-stats', 'dengue', '14-stats']]) {
    const base = path.join(ROOT, 'data/legacy-export', dir);
    const html = path.join(base, `${stem}.html`); const json = path.join(base, `${stem}.json`);
    if (!fs.existsSync(html) || !fs.existsSync(json)) continue;
    const meta = JSON.parse(fs.readFileSync(json, 'utf8'));
    const files = new Set((meta.attachments ?? []).map((a) => a.file));
    for (const m of fs.readFileSync(html, 'utf8').matchAll(/\/Upload\/images\/[^"']*\/([^/"']+\.(?:png|jpe?g|gif))/gi)) files.add(m[1]);
    copies.push({ key, base, html, json, files: [...files] });
  }

  // ── 寫檔 ──
  const out = path.resolve(outDir);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(path.join(out, 'files'), { recursive: true });
  const all = [...items.map((it) => ({ kind: 'gen', key: it.key, it })), ...copies.map((c) => ({ kind: 'copy', key: c.key, c }))].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  let n = 0;
  const write = (stem, it) => {
    const fileList = it.atts.length ? `<div class="file-list"><h4>相關檔案</h4><ul>${it.atts.map((a) => `<li><a href="${esc(a.url)}">${esc(a.label)}</a> <span class="size">(${a.type ?? 'PDF'})</span></li>`).join('')}</ul></div>` : '';
    fs.writeFileSync(path.join(out, `${stem}.html`), shell({ title: it.title, crumbs: it.crumbs, bodyHtml: `${it.body()}\n${fileList}`, updated: it.upd, menuActive: '統計專區' }));
    fs.writeFileSync(path.join(out, `${stem}.json`), `${JSON.stringify({ url: it.url, title: it.title, category: it.crumbs.slice(1).join('／'), publishedAt: it.pub, updatedAt: it.upd, breadcrumbs: it.crumbs, attachments: it.atts.map((a) => ({ url: a.url, label: a.label, file: a.name })) }, null, 2)}\n`);
    for (const a of it.atts) fs.writeFileSync(path.join(out, 'files', a.name), a.buf);
  };
  const stems = [];
  for (const a of all) {
    n++;
    const stem = `${String(n).padStart(2, '0')}-${a.key}`;
    stems.push(stem);
    if (a.kind === 'copy') {
      fs.copyFileSync(a.c.html, path.join(out, `${stem}.html`)); fs.copyFileSync(a.c.json, path.join(out, `${stem}.json`));
      for (const f of a.c.files) { const s = path.join(a.c.base, 'files', f); if (fs.existsSync(s)) fs.copyFileSync(s, path.join(out, 'files', f)); }
    } else write(stem, a.it);
  }
  const counts = { pages: n, generated: items.length, copied: copies.length, stems };
  fs.writeFileSync(path.join(out, '_export.json'), `${JSON.stringify({
    format: 'cdc-legacy-export/1', simulated: true, exportedAt: EXPORTED_AT, site: BASE, batch: 'statistics', pages: n,
    source: `模擬匯出：統計專區欄目。依既有新站內容（content/datasets、統計年報出版品）反推 ${items.length} 頁：列表 2 頁（含英文 Data & Statistics）、外部系統入口 3 頁、期刊頁 4 頁（週速訊／週報，一頁列多期 PDF）、統計表頁 3 頁、統計年報 1 頁；另複製結核病批與登革熱批匯出的「統計資料」頁各 1 頁（同網址，含附件）。統計專區根、英文 Data & Statistics、法定傳染病境外移入確定病例統計、防疫資料庫、疫情監測速訊的網址 ID 為舊站真實 ID；其餘 ID、數字與連結皆為示意，不是舊站的真實資料。正式匯出取代整個目錄即可。`,
    generator: 'scripts/lib/legacy-import/sim-export-statistics.mjs',
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(out, 'README.md'), readme(counts));
  return { dir: out, ...counts };
}

const readme = (c) => `# 舊站匯出（模擬）：統計專區欄目（第十一批）

> **這是模擬匯出。** 開發環境連不到 www.cdc.gov.tw，這 ${c.pages} 頁由 \`scripts/lib/legacy-import/sim-export-statistics.mjs\` 合成：列表 2 頁（統計專區、英文 Data & Statistics）、外部系統入口 3 頁（傳染病統計資料查詢系統、疾管署資料開放平臺、防疫資料庫）、期刊頁 4 頁（疫情監測速訊、流感速訊、腸病毒疫情週報、COVID-19 週報）、統計表頁 3 頁（境外移入確定病例、常規疫苗接種完成率、法定傳染病死亡統計）、統計年報 1 頁，另**原樣複製**結核病批與登革熱批匯出的「統計資料」頁各 1 頁（共 ${c.copied} 頁，連同附件）。
>
> 統計專區根、英文 Data & Statistics、法定傳染病境外移入確定病例統計、防疫資料庫、疫情監測速訊的網址 ID 是**真實**的；其餘 ID、**所有統計數字**、站外連結皆為**示意**。**正式匯出取代整個目錄即可**，不需要改程式。

## 重新產生

\`\`\`
node scripts/lib/legacy-import/sim-export-statistics.mjs data/legacy-export/statistics
\`\`\`

## 轉換

\`\`\`
node scripts/import-legacy.mjs data/legacy-export/statistics --out data/legacy-import/statistics --apply-migration
\`\`\`

移轉清單：\`content/migration/statistics.json\`（欄目範圍，逐頁一筆共 14 筆；複製的 2 頁與結核病批、登革熱批是同一頁，不列入清單，轉換器會判定為「已在前批轉過」）。匯出格式見 \`docs/legacy-import.md\` 第 2 節。
`;

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const r = generateStatistics(process.argv[2] ?? path.join(ROOT, 'data/legacy-export/statistics'));
  console.log(`模擬匯出 statistics：${r.pages} 頁（產生 ${r.generated}、複製 ${r.copied}）→ ${path.relative(ROOT, r.dir)}`);
}
