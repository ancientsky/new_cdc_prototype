#!/usr/bin/env node
// 常見問答（Q&A）欄目的模擬匯出（ARCHITECTURE 17.3 第八批）：舊站 /Category/QAPage/ 的問答頁
//   來源：content/faq（已發布）依主題反推成欄目內頁：
//     - 疾病專題的 Q&A 頁：疾病批**還沒做**的疾病（新冠併發重症、B 型肝炎、HIV、百日咳、水痘）各一頁
//     - 跟疾病批**同一頁**（同網址）的結核病、登革熱 Q&A：直接複製疾病批匯出的那一頁（欄目匯出本來就會再匯一次），測「跨批重複」
//     - 不綁單一疾病的主題頁：預防接種、旅遊醫學、統計資料、謠言澄清（同一題會出現在疾病頁與主題頁，測同批重複）
//   另合成新站沒有的：
//     - 沒有 .panel 手風琴、只用 <h3>Q…</h3>／<p><strong>Q：</strong></p> 排版的問答頁（統計、謠言），測鬆散結構的拆題
//     - 「113 年度公費流感疫苗 Q&A」：答案寫的期限都已過（測 answer-dated）
//     - 英文問答頁（/En/Category/QAPage/，測 needs-source-zh）
//     - 整頁只有一題、標題就是問題的頁（測 faq-structure-missing 的退路對到既有題）
//     - 常見問答總覽列表頁（/Category/List/，skip-list）
//   數字、網址 ID 皆為示意；正式匯出（資訊室從 CMS 匯出欄目）取代整個目錄即可。
// 用法：node scripts/lib/legacy-import/sim-export-qa.mjs [輸出目錄]   （預設 data/legacy-export/qa）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { BASE, esc, fakeId, P, H, A, mdHtml, shell, qaPanels } from './sim-export.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const CONTENT = path.join(ROOT, 'content');
export const EXPORTED_AT = '2026-10-03';
// 模擬舊站快照（2026-10-03）：已自正式內容移除、但當時舊站上有的項目放在 data/legacy-export/_retired/（第二十輪：虛構的登革熱指引第 15～17 版與其通函）；
// 快照之後由 PDF 轉入的文件（有 derivedFrom）不屬於舊站，排除
const filesOf = (root, dir) => (fs.existsSync(path.join(root, dir)) ? fs.readdirSync(path.join(root, dir)).filter((f) => f.endsWith('.json')).map((f) => [f, path.join(root, dir, f)]) : []);
const readAll = (dir) => [...filesOf(CONTENT, dir), ...filesOf(path.join(ROOT, 'data/legacy-export/_retired'), dir)]
  .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([, p]) => JSON.parse(fs.readFileSync(p, 'utf8'))).filter((j) => !j.derivedFrom);

/** 鬆散結構一：每題一個 <h3>Q1. …</h3>，答案是接下來的段落（舊站有些頁是編輯手排，不是手風琴元件） */
const qaHeadings = (items) => items.map((it, i) => `${H(3, `Q${i + 1}. ${it.q}`)}\n${mdHtml(it.a)}`).join('\n');
/** 鬆散結構二：<p><strong>Q：…</strong></p><p>A：…</p>（Word 貼上的問答） */
const qaBold = (items) => items.map((it) => `<p class="MsoNormal"><strong>Q：${esc(it.q)}</strong></p>\n${mdHtml(`A：${it.a}`)}`).join('\n');

export function generateQa(outDir) {
  const master = JSON.parse(fs.readFileSync(path.join(CONTENT, 'master/diseases.json'), 'utf8'));
  const dName = (id) => master.find((d) => d.id === id)?.name ?? '';
  const faqs = readAll('faq').filter((f) => f.status === 'published');
  const byId = new Map(faqs.map((f) => [f.id, f]));
  const F = (...ids) => ids.map((id) => { const f = byId.get(`faq.${id}`); if (!f) throw new Error(`content/faq 沒有 ${id}`); return { q: f.question, a: f.answerMarkdown, src: f.id }; });
  const items = [];
  const page = (key, o) => items.push({ key, atts: [], ...o });

  // ── 疾病專題 Q&A（疾病批還沒做的疾病）──
  const diseasePage = (key, diseaseId, ids, pub, upd) => {
    const name = dName(diseaseId);
    page(key, { url: `${BASE}/Category/QAPage/${fakeId(`qa:${diseaseId}`)}`, title: `${name} Q&A`, category: `${name}／Q&A`, crumbs: ['首頁', '傳染病與防疫專題', name, 'Q&A'], pub, upd, body: () => qaPanels(F(...ids)) });
  };
  diseasePage('covid-qa', 'disease.covid-19', ['covid-antiviral', 'covid-vaccine-who', 'flu-covid-same-day'], '2023-05-01', '2026-03-10');
  diseasePage('hepatitis-b-qa', 'disease.hepatitis-b', ['hepb-newborn'], '2019-08-12', '2024-11-05');
  diseasePage('hiv-qa', 'disease.hiv', ['hiv-pep', 'hiv-test-where'], '2018-12-01', '2026-06-18');
  diseasePage('pertussis-qa', 'disease.pertussis', ['pregnant-tdap'], '2021-03-15', '2025-09-02');
  diseasePage('varicella-qa', 'disease.varicella', ['varicella-vaccine-doses'], '2020-06-30', '2025-01-20');

  // ── 跟疾病批同一頁：直接複製疾病批匯出的 Q&A 頁（同網址、同內容）──
  const copies = [];
  for (const [key, from] of [['tuberculosis-qa', 'tuberculosis/07-qa-list'], ['dengue-qa', 'dengue/10-qa-list']]) {
    const src = path.join(ROOT, 'data/legacy-export', from);
    if (fs.existsSync(`${src}.json`) && fs.existsSync(`${src}.html`)) copies.push({ key, html: `${src}.html`, json: `${src}.json` });
  }

  // ── 主題頁（不綁單一疾病）──
  page('vaccination-qa', {
    url: `${BASE}/Category/QAPage/${fakeId('qa:vaccination')}`, title: '預防接種常見問答', category: '預防接種／常見問答', crumbs: ['首頁', '預防接種', '常見問答'], pub: '2019-04-01', upd: '2026-08-30',
    body: () => qaPanels([
      ...F('hpv-vaccine-who', 'pcv-elderly', 'bcg-when', 'flu-vaccine-every-year', 'varicella-vaccine-doses'),
      { q: '成人需要補打哪些疫苗？', a: '成人建議依年齡與風險評估接種：**每年一劑流感疫苗**；65 歲以上接種肺炎鏈球菌疫苗；1970 年以後出生、沒有麻疹抗體證明者可接種一劑 MMR；育齡婦女確認水痘、德國麻疹免疫力；孕婦每次懷孕第 28 至 36 週接種一劑 Tdap。詳細建議請洽預防接種合約院所或各地衛生局。' },
      { q: '流感疫苗打完多久才有保護力？', a: '接種流感疫苗後約 **2 週**產生足夠保護力，保護效果可維持約 **6 個月**；因此建議在流感季開始前（每年 10 月）接種。' },
    ]),
  });
  page('travel-qa', {
    url: `${BASE}/Category/QAPage/${fakeId('qa:travel')}`, title: '國際旅遊常見問答', category: '國際旅遊與健康／常見問答', crumbs: ['首頁', '國際旅遊與健康', '常見問答'], pub: '2017-11-20', upd: '2026-07-01',
    body: () => qaPanels([
      ...F('travel-clinic', 'travel-japan-measles', 'travel-malaria-prevention', 'travel-return-fever', 'yellow-fever-certificate'),
      { q: '出國前多久要到旅遊醫學門診諮詢？', a: '建議出國前 **4 至 6 週**到旅遊醫學門診諮詢，讓疫苗有時間產生保護力、也能完成需要多劑的疫苗；臨時出國仍可就診，醫師會依行程調整建議。' },
    ]),
  });
  page('stats-qa', {
    url: `${BASE}/Category/QAPage/${fakeId('qa:stats')}`, title: '統計資料常見問答', category: '統計資料／常見問答', crumbs: ['首頁', '統計資料', '常見問答'], pub: '2016-09-01', upd: '2026-01-12',
    body: () => qaHeadings([...F('stats-ili-rate', 'stats-where-data'), { q: '傳染病統計多久更新一次？', a: '法定傳染病通報與確定病例數每週更新（每週二）；年報於次年 6 月公布；資料開放平臺的資料集依各資料集的更新頻率同步。' }]),
  });
  page('rumor-qa', {
    url: `${BASE}/Category/QAPage/${fakeId('qa:rumor')}`, title: '謠言澄清常見問答', category: '新聞與公告／澄清專區／常見問答', crumbs: ['首頁', '新聞與公告', '澄清專區', '常見問答'], pub: '2021-02-08', upd: '2026-09-05',
    body: () => qaBold([...F('rumor-mmr-autism', 'rumor-sms-link'), { q: '網傳多喝熱水、多曬太陽可以預防流感，是真的嗎？', a: '沒有科學證據顯示喝熱水或曬太陽能預防流感。預防流感最有效的方法是**每年接種流感疫苗**、勤洗手、有症狀戴口罩並在家休息；網路傳言請先到疾管署澄清專區查證。' }]),
  });
  // ── 答案期限都已過的頁（113 年度公費流感疫苗）──
  page('flu-season-2024-qa', {
    url: `${BASE}/Category/QAPage/${fakeId('qa:flu-2024')}`, title: '113 年度公費流感疫苗接種 Q&A', category: '預防接種／流感疫苗／常見問答', crumbs: ['首頁', '預防接種', '流感疫苗', '常見問答'], pub: '2024-09-20', upd: '2024-12-02',
    body: () => qaPanels([
      { q: '113 年度公費流感疫苗什麼時候開打？', a: '113 年度公費流感疫苗自 **113 年 10 月 1 日**起分兩階段開打：第一階段為 65 歲以上長者、學齡前幼兒、醫事人員等；第二階段自 113 年 11 月 1 日起開放 50 至 64 歲無高風險慢性病成人。接種期間至 114 年 3 月 31 日或疫苗用完為止。' },
      { q: '113 年度公費流感疫苗有哪些廠牌？', a: '113 年度採購四價流感疫苗共 3 家廠牌，均為 6 個月以上適用；各院所依配送量提供，民眾無法指定廠牌。' },
      { q: '錯過第一階段，之後還能打嗎？', a: '可以。只要符合公費對象且疫苗尚有庫存，於接種期間（至 114 年 3 月 31 日止）皆可至合約院所接種。' },
    ]),
  });
  // ── 英文問答頁 ──
  const enQ = (id) => { const f = byId.get(`faq.${id}`); return f?.i18n?.en ? { q: f.i18n.en.question, a: f.i18n.en.answerMarkdown } : null; };
  page('dengue-en-qa', {
    url: `${BASE}/En/Category/QAPage/${fakeId('qa:en-dengue')}`, title: 'Dengue Fever FAQ', category: 'Diseases／Dengue Fever／FAQ', crumbs: ['Home', 'Diseases', 'Dengue Fever', 'FAQ'], pub: '2022-06-01', upd: '2026-07-15', lang: 'en',
    body: () => qaPanels([enQ('dengue-fever-when-to-see-doctor'), enQ('dengue-container-check'), { q: 'Can I take painkillers if I suspect dengue?', a: 'Use **acetaminophen (paracetamol)** for fever and pain. Avoid aspirin and NSAIDs such as ibuprofen, which can increase bleeding risk. See a doctor promptly if warning signs appear.' }].filter(Boolean)),
  });
  // ── 整頁只有一題、標題就是問題（沒有手風琴結構）──
  const rb = byId.get('faq.rabies-bite');
  page('single-qa', {
    url: `${BASE}/Category/QAPage/${fakeId('qa:rabies-bite')}`, title: rb.question, category: '狂犬病／Q&A', crumbs: ['首頁', '傳染病與防疫專題', '狂犬病', 'Q&A'], pub: '2013-08-05', upd: '2025-10-10',
    body: () => mdHtml(rb.answerMarkdown),
  });

  // ── 寫檔 ──
  const out = path.resolve(outDir);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(path.join(out, 'files'), { recursive: true });
  const all = [...items.map((it) => ({ kind: 'gen', key: it.key, it })), ...copies.map((c) => ({ kind: 'copy', key: c.key, c }))].sort((a, b) => a.key.localeCompare(b.key));
  let n = 0;
  const write = (stem, it) => {
    fs.writeFileSync(path.join(out, `${stem}.html`), shell({ title: it.title, crumbs: it.crumbs, bodyHtml: it.body(), updated: it.upd, menuActive: it.lang === 'en' ? 'FAQ' : '常見問答' }));
    fs.writeFileSync(path.join(out, `${stem}.json`), `${JSON.stringify({ url: it.url, title: it.title, category: it.category, publishedAt: it.pub, updatedAt: it.upd, breadcrumbs: it.crumbs, attachments: [] }, null, 2)}\n`);
  };
  for (const a of all) {
    n++;
    const stem = `${String(n).padStart(2, '0')}-${a.key}`;
    if (a.kind === 'copy') { fs.copyFileSync(a.c.html, path.join(out, `${stem}.html`)); fs.copyFileSync(a.c.json, path.join(out, `${stem}.json`)); } else write(stem, a.it);
  }
  n++;
  write(`${String(n).padStart(2, '0')}-qa-list`, {
    url: `${BASE}/Category/List/${fakeId('qa:list')}`, title: '常見問答總覽', category: '常見問答', crumbs: ['首頁', '常見問答'], pub: EXPORTED_AT, upd: EXPORTED_AT,
    body: () => `<ul class="doc-list">${items.map((i) => `<li><span class="date">${esc(i.upd)}</span> ${A(i.url, i.title)}</li>`).join('')}</ul>`,
  });
  const questions = items.reduce((acc, i) => acc + (i.body().match(/panel panel-default|<h3>|<strong>Q：/g) ?? []).length, 0);
  const counts = { pages: n, generated: items.length, copied: copies.length, questions };
  fs.writeFileSync(path.join(out, '_export.json'), `${JSON.stringify({
    format: 'cdc-legacy-export/1', simulated: true, exportedAt: EXPORTED_AT, site: BASE, batch: 'qa', pages: n,
    source: `模擬匯出：常見問答（Q&A）欄目。由既有 content/faq ${faqs.length} 題反推成問答頁 ${items.length} 頁（約 ${questions} 題，含新站沒有的題與鬆散排版、過期年度、英文頁、單題頁），另複製疾病批匯出裡同網址的 Q&A 頁 ${copies.length} 頁（結核病、登革熱）與列表頁 1 頁；不是舊站的真實資料（網址 ID、數字皆為示意）。正式匯出取代整個目錄即可。`,
    generator: 'scripts/lib/legacy-import/sim-export-qa.mjs',
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(out, 'README.md'), readme(counts));
  return { dir: out, ...counts };
}

const readme = (c) => `# 舊站匯出（模擬）：常見問答（Q&A）欄目（第八批）

> **這是模擬匯出。** 開發環境連不到 www.cdc.gov.tw，這 ${c.pages} 頁由 \`scripts/lib/legacy-import/sim-export-qa.mjs\` 合成：既有 content/faq 依主題反推成問答頁 ${c.generated} 頁（疾病批還沒做的疾病專題、預防接種、旅遊、統計、謠言澄清；含新站沒有的題、沒有手風琴元件的鬆散排版、期限已過的年度 Q&A、英文頁、整頁一題的頁），另**原樣複製**疾病批匯出裡同網址的結核病、登革熱 Q&A 頁 ${c.copied} 頁（欄目匯出本來就會把疾病專題的 Q&A 再匯一次），與一頁總覽列表。網址中的 ID 都是示意。**正式匯出取代整個目錄即可**，不需要改程式。

## 重新產生

\`\`\`
node scripts/lib/legacy-import/sim-export-qa.mjs data/legacy-export/qa
\`\`\`

## 轉換

\`\`\`
node scripts/import-legacy.mjs data/legacy-export/qa --out data/legacy-import/qa --apply-migration
\`\`\`

移轉清單：\`content/migration/qa.json\`（欄目範圍，逐頁一筆；疾病批已處理的結核病、登革熱 Q&A 頁不列，由轉換器依同網址判定「已在疾病批轉過」）。匯出格式見 \`docs/legacy-import.md\` 第 2 節。
`;

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const r = generateQa(process.argv[2] ?? path.join(ROOT, 'data/legacy-export/qa'));
  console.log(`模擬匯出 qa：${r.pages} 頁（產生 ${r.generated}、複製 ${r.copied}、約 ${r.questions} 題）→ ${path.relative(ROOT, r.dir)}`);
}
