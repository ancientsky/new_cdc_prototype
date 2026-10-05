#!/usr/bin/env node
// 指引與手冊欄目的模擬匯出（ARCHITECTURE 17.3 第七批）：舊站「指引及手冊」類頁面
//   來源：content/documents（已發布）依文件家族（family）反推成舊站欄目內頁（/Category/MPage/{id}）：頁面內文是現行版的摘要與前幾節，
//   附件列表放現行版 PDF ＋ 歷版 PDF（標籤帶版次與日期，測「一頁多版」拆舊版草稿）；流感抗病毒藥劑三個版次改以三頁呈現（測清單目標同家族串鏈）。
//   另合成新站沒有的頁：
//     - 狂犬病防治工作手冊兩個版次各一頁（/Category/DiseaseManual/，無清單目標，測「去版次同名＝同家族」與民國年生效日）
//     - 純 PDF 頁「人口密集機構感染管制措施指引」（內文只有下載連結，測 pdf-only 佔位）
//     - 歷版掃描檔「H7N9 流感防治工作指引（2017 年版）」（歷版麵包屑 ⇒ 封存；PDF 無文字層）
//     - 指引總覽列表頁（/Category/List/，skip-list）
//   數字、網址 ID、PDF 內容皆為示意；正式匯出（資訊室從 CMS 匯出欄目）取代整個目錄即可。
// 用法：node scripts/lib/legacy-import/sim-export-guidelines.mjs [輸出目錄]   （預設 data/legacy-export/guidelines）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { BASE, esc, fakeId, P, H, A, TABLE, mdHtml, pdfText, pdfScan, shell } from './sim-export.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const CONTENT = path.join(ROOT, 'content');
export const EXPORTED_AT = '2026-10-03';
const readAll = (dir) => fs.readdirSync(path.join(CONTENT, dir)).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(CONTENT, dir, f), 'utf8')));
const UNIT_NAME = { 'unit.acute-infectious': '急性傳染病組', 'unit.chronic-infectious': '慢性傳染病組', 'unit.infection-control': '感染管制及生物安全組', 'unit.lab': '檢驗及疫苗研製中心' };
const pdfName = (s) => `${String(s).replace(/[^a-z0-9.-]+/gi, '-').toLowerCase().replace(/^-+|-+$/g, '')}.pdf`;
const seed = (s) => parseInt(fakeId(s).replace(/[^0-9]/g, '').slice(0, 6) || '7', 10);
const ymd = (iso) => { const [y, m, d] = iso.split('-').map(Number); return `${y} 年 ${m} 月 ${d} 日`; };
const famKey = (family) => family.replace(/^doc\./, '');
/** 附件標籤用的版次字樣：parseVersion 認得的寫法（第 N 版、vN、YYYY 年版、民國 NNN.MM.DD） */
const versionLabel = (v) => (/^v\d+$/i.test(v) ? v : /^第.+版$/.test(v) ? v : /^\d{2,3}\.\d{1,2}\.\d{1,2}$/.test(v) ? `${v} 版` : /^(19|20)\d{2}-\d{2}$/.test(v) ? `${v.slice(0, 4)} 年版` : /^(19|20)\d{2}-\d{2}$/.test(v) ? `${v.slice(0, 4)} 年版` : /^(19|20)\d{2}$/.test(v) ? `${v} 年版` : null);

/** 與版次無關的文件名（去掉標題裡的版次括號） */
const baseTitle = (t) => t.replace(/[（(][^）)]*(版|年度|修訂)[^）)]*[）)]/g, '').replace(/^\d{4}[–-]\d{4}\s*年度/, '').trim();

export function generateGuidelines(outDir) {
  const master = JSON.parse(fs.readFileSync(path.join(CONTENT, 'master/diseases.json'), 'utf8'));
  const dName = (id) => master.find((d) => d.id === id)?.name ?? '';
  const docs = readAll('documents').filter((d) => d.status === 'published');
  const fams = new Map();
  for (const d of docs) { if (!fams.has(d.family)) fams.set(d.family, []); fams.get(d.family).push(d); }
  const items = [];
  const SEPARATE = new Set(['doc.flu-antiviral-eligibility']); // 歷版各自一頁（清單各有目標）
  for (const [family, vs] of [...fams.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    vs.sort((a, b) => a.effectiveAt.localeCompare(b.effectiveAt));
    const cur = vs.at(-1);
    const older = vs.slice(0, -1);
    const area = cur.owner === 'unit.infection-control' ? '感染管制' : dName(cur.diseases?.[0]) || '其他';
    const key = famKey(family);
    const sections = (d) => (d.sections ?? []).slice(0, 3).map((s) => `${H(3, s.heading)}\n${mdHtml(s.markdown)}`).join('\n');
    const info = (d) => TABLE(['項目', '內容'], [['文件名稱', d.title], ['版次', d.version], ['生效日', d.effectiveAt], ['權責單位', UNIT_NAME[d.owner] ?? d.owner], ['檔案格式', 'PDF']]);
    const pdfOf = (d, label) => ({ name: pdfName(`${famKey(d.family)}-${d.effectiveAt}`), label, buf: pdfText(`${d.title} (SAMPLE)`, [`Version ${d.version}, effective ${d.effectiveAt}.`, 'Simulated export of a Taiwan CDC guideline - not the real document.', ...(d.sections ?? []).slice(0, 2).map((s) => `${s.heading}: ${String(s.markdown).replace(/[^\x20-\x7e]/g, '').slice(0, 60)}`)]) });
    const page = (d, { tab, pub, upd, atts, extraBody = '' }) => items.push({
      key: tab, tab, url: `${BASE}/Category/MPage/${fakeId(`guidelines:${tab}`)}`, title: d.title, pub, upd, atts, source: d.id,
      crumbs: ['首頁', '傳染病介紹', area, '指引及手冊', ...(d === cur ? [] : ['歷版'])],
      body: () => [P(d.summary), sections(d), P(`本版自 ${ymd(d.effectiveAt)} 生效${d.supersedes ? `，取代前一版（${vs.find((x) => x.id === d.supersedes)?.version ?? '舊版'}）` : ''}。${extraBody}`), info(d)].join('\n'),
    });
    if (SEPARATE.has(family)) {
      for (const d of vs) page(d, { tab: d === cur ? key : `${key}-${d.version}`, pub: d.publishedAt, upd: d === cur ? EXPORTED_AT.replace('10-03', '09-20') : d.publishedAt, atts: [pdfOf(d, `${d.title}（PDF）`)] });
      continue;
    }
    // 一頁多版：現行版內文 ＋ 附件列表（現行版 PDF ＋ 歷版 PDF，標籤帶版次與日期）
    const atts = [pdfOf(cur, `${cur.title}（PDF）`)];
    for (const o of older) {
      const vl = versionLabel(o.version);
      atts.push(pdfOf(o, vl ? `${baseTitle(o.title)}（${vl}，${ymd(o.effectiveAt)}）（PDF）` : `${o.title}（${ymd(o.effectiveAt)}）（PDF）`));
    }
    const upd = cur.effectiveAt < '2026-01-01' ? '2026-01-15' : cur.publishedAt; // 頁面更新日常晚於生效日（測 effective-from-text）
    page(cur, { tab: key, pub: vs[0].publishedAt, upd, atts, extraBody: older.length ? `歷版請見下方附件（${older.map((o) => o.version).join('、')}），僅供查閱。` : '' });
  }
  // ── 合成：新站沒有的頁 ──
  const synth = [];
  const rabiesBody = (v) => [P(`狂犬病防治工作手冊（${v}）供衛生局（所）、動物防疫機關與醫療院所執行狂犬病暴露後處置、動物咬傷通報與疫苗、免疫球蛋白申領使用。`), H(3, '一、暴露後處置'), P('依暴露等級（WHO 第一至三級）評估傷口處理、疫苗接種與免疫球蛋白使用；第三級暴露應於 24 小時內完成首劑接種並注射免疫球蛋白。'), H(3, '二、通報與檢體'), P('疑似狂犬病病例與可疑動物咬傷依傳染病防治法通報，動物檢體送農業部獸醫研究所檢驗。')].join('\n');
  synth.push({ key: 'rabies-manual-2019', url: `${BASE}/Category/DiseaseManual/${fakeId('guidelines:rabies-2019')}`, title: '狂犬病防治工作手冊（108 年版）', pub: '2019-06-01', upd: '2019-06-01', crumbs: ['首頁', '傳染病介紹', '狂犬病', '指引及手冊'], tab: 'rabies-manual-2019',
    atts: [{ name: 'rabies-manual-2019.pdf', label: '狂犬病防治工作手冊（108 年版）（PDF）', buf: pdfText('Rabies control manual 2019 (SAMPLE)', ['Simulated export - not the real document.']) }], body: () => rabiesBody('108 年版') });
  synth.push({ key: 'rabies-manual', url: `${BASE}/Category/DiseaseManual/${fakeId('guidelines:rabies-2024')}`, title: '狂犬病防治工作手冊（113 年 12 月修訂版）', pub: '2025-02-03', upd: '2025-02-03', crumbs: ['首頁', '傳染病介紹', '狂犬病', '指引及手冊'], tab: 'rabies-manual',
    atts: [{ name: 'rabies-manual-2024.pdf', label: '狂犬病防治工作手冊（113 年 12 月修訂版）（PDF）', buf: pdfText('Rabies control manual 2024 revision (SAMPLE)', ['Simulated export - not the real document.']) }], body: () => [P('本手冊自 113 年 12 月 20 日修訂生效，取代 108 年版。'), rabiesBody('113 年 12 月修訂版')].join('\n') });
  synth.push({ key: 'crowded-ic-guideline', url: `${BASE}/Category/DiseaseTeach/${fakeId('guidelines:crowded-ic')}`, title: '人口密集機構感染管制措施指引', pub: '2025-06-30', upd: '2025-06-30', crumbs: ['首頁', '感染管制', '指引及手冊'], tab: 'crowded-ic-guideline',
    atts: [{ name: 'crowded-institution-ic-guideline.pdf', label: '人口密集機構感染管制措施指引（2025 年 6 月版）（PDF）', buf: pdfText('Infection control guideline for crowded institutions, June 2025 (SAMPLE)', ['Chapter 1 Scope. Chapter 2 Standard precautions. Chapter 3 Outbreak response.', 'Simulated export - not the real document.']) }], body: () => P('本指引全文請下載附件。') });
  synth.push({ key: 'h7n9-guideline-2017', url: `${BASE}/Category/DiseaseTeach/${fakeId('guidelines:h7n9-2017')}`, title: 'H7N9 流感防治工作指引（2017 年版）', pub: '2017-04-10', upd: '2017-04-10', crumbs: ['首頁', '傳染病介紹', '流感', '指引及手冊', '歷版'], tab: 'h7n9-guideline-2017',
    atts: [{ name: 'h7n9-guideline-2017.pdf', label: 'H7N9 流感防治工作指引（2017 年版）（PDF，掃描檔）', buf: pdfScan(seed('h7n9')) }], body: () => P('歷版文件，全文請見附件（掃描檔）。') });
  for (const s of synth) items.push({ ...s, source: null });
  items.sort((a, b) => a.key.localeCompare(b.key));

  const out = path.resolve(outDir);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(path.join(out, 'files'), { recursive: true });
  let n = 0;
  const write = (stem, it) => {
    const atts = it.atts.map((a, i) => ({ ...a, url: `${BASE}/File/Get/${fakeId(`guidelines:${it.key}:${i}`)}` }));
    const fileList = atts.length ? `<div class="file-list"><h4>相關檔案</h4><ul>${atts.map((a) => `<li><a href="${esc(a.url)}">${esc(a.label)}</a> <span class="size">(PDF)</span></li>`).join('')}</ul></div>` : '';
    fs.writeFileSync(path.join(out, `${stem}.html`), shell({ title: it.title, crumbs: it.crumbs, bodyHtml: `${it.body()}\n${fileList}`, updated: it.upd, menuActive: '指引及手冊' }));
    fs.writeFileSync(path.join(out, `${stem}.json`), `${JSON.stringify({ url: it.url, title: it.title, category: it.crumbs.slice(1).join('／'), publishedAt: it.pub, updatedAt: it.upd, breadcrumbs: it.crumbs, ...(it.tab ? { tab: it.tab } : {}), attachments: atts.map((a) => ({ url: a.url, label: a.label, file: a.name })) }, null, 2)}\n`);
    for (const a of atts) if (a.buf) fs.writeFileSync(path.join(out, 'files', a.name), a.buf);
  };
  for (const it of items) { n++; write(`${String(n).padStart(2, '0')}-${it.key}`, it); }
  n++;
  write(`${String(n).padStart(2, '0')}-guidelines-list`, {
    key: 'guidelines-list', url: `${BASE}/Category/List/${fakeId('guidelines:list')}`, title: '防疫指引與手冊總覽', pub: EXPORTED_AT, upd: EXPORTED_AT, crumbs: ['首頁', '指引及手冊'], tab: 'guidelines-list', atts: [],
    body: () => `<ul class="doc-list">${items.filter((i) => i.source).map((i) => `<li><span class="date">${esc(i.upd)}</span> ${A(i.url, i.title)}</li>`).join('')}</ul>`,
  });
  const counts = { families: fams.size, pages: n, existing: items.filter((i) => i.source).length, synth: synth.length, versionsInAttachments: items.reduce((a, i) => a + Math.max(0, i.atts.length - 1), 0) };
  fs.writeFileSync(path.join(out, '_export.json'), `${JSON.stringify({
    format: 'cdc-legacy-export/1', simulated: true, exportedAt: EXPORTED_AT, site: BASE, batch: 'guidelines', pages: n,
    source: `模擬匯出：指引及手冊欄目。由既有 content/documents ${docs.length} 份（${counts.families} 個文件家族）反推成欄目內頁 ${counts.existing} 頁（歷版多以同頁附件呈現，共 ${counts.versionsInAttachments} 份歷版 PDF；流感抗病毒藥劑三版各一頁），另合成新站沒有的頁 ${counts.synth} 頁與列表頁 1 頁；不是舊站的真實資料（網址 ID、數字、PDF 內容皆為示意）。正式匯出取代整個目錄即可。`,
    generator: 'scripts/lib/legacy-import/sim-export-guidelines.mjs',
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(out, 'README.md'), readme(counts));
  return { dir: out, files: fs.readdirSync(path.join(out, 'files')).length, ...counts };
}

const readme = (c) => `# 舊站匯出（模擬）：指引及手冊欄目（第七批）

> **這是模擬匯出。** 開發環境連不到 www.cdc.gov.tw，這 ${c.pages} 頁由 \`scripts/lib/legacy-import/sim-export-guidelines.mjs\` 合成：既有 content/documents 依文件家族反推成舊站欄目內頁 ${c.existing} 頁（頁面內文是現行版，歷版 ${c.versionsInAttachments} 份放在同頁的附件列表、標籤帶版次與日期；流感抗病毒藥劑的三個版次各自一頁），另合成新站沒有的 ${c.synth} 頁（狂犬病手冊兩版各一頁、純 PDF 的感染管制指引、歷版掃描檔）與一頁總覽列表。網址中的 ID、PDF 內容都是示意。**正式匯出取代整個目錄即可**，不需要改程式。

## 重新產生

\`\`\`
node scripts/lib/legacy-import/sim-export-guidelines.mjs data/legacy-export/guidelines
\`\`\`

## 轉換

\`\`\`
node scripts/import-legacy.mjs data/legacy-export/guidelines --out data/legacy-import/guidelines --apply-migration
\`\`\`

移轉清單：\`content/migration/guidelines.json\`（欄目範圍，逐份文件家族一筆；歷版與合成頁另列）。匯出格式見 \`docs/legacy-import.md\` 第 2 節。
`;

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const r = generateGuidelines(process.argv[2] ?? path.join(ROOT, 'data/legacy-export/guidelines'));
  console.log(`模擬匯出 guidelines：${r.pages} 頁（文件家族 ${r.families}、既有 ${r.existing}、合成 ${r.synth}、歷版附件 ${r.versionsInAttachments}）、files/ ${r.files} 個檔 → ${path.relative(ROOT, r.dir)}`);
}
