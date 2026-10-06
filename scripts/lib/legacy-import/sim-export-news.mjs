#!/usr/bin/env node
// 新聞與公告欄目的模擬匯出（ARCHITECTURE 17.3 第六批）：舊站 Bulletin 內頁（新聞稿 typeid 9、致醫界通函 48、澄清稿 8772、其他訊息 11、英文新聞稿 158）
//   來源：content/news（已發布）＋ content/clarifications（已發布）反推成「像舊站」的 Bulletin 頁，另合成：
//     - 近年但新站沒有的新聞稿（測二級「近年新聞 auto-ok ＋ 抽樣」）
//     - 超過三年的新聞稿與活動訊息（測三級「久遠封存」與 dropRules）
//     - 英文新聞稿（typeid 158，sourceLang en，需補中文版）
//     - 新聞列表頁（Bulletin/List，skip-list）
//   這批沒有移轉清單：新聞不是「一頁對一頁」搬，而是依三級處理決定上線、封存或不轉；清單只在舊網址要轉址時才需要（migration-playbook 2.x）。
//   數字、網址 ID、PDF 內容皆為示意；正式匯出（資訊室從 CMS 匯出 Bulletin 欄目）取代整個目錄即可。
// 用法：node scripts/lib/legacy-import/sim-export-news.mjs [輸出目錄]   （預設 data/legacy-export/news）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { BASE, esc, fakeId, P, A, mdHtml, pdfText, pdfScan, shell } from './sim-export.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const CONTENT = path.join(ROOT, 'content');
export const EXPORTED_AT = '2026-10-03';
const TYPEID = { press: '9', letter: '48', clarification: '8772', other: '11', en: '158' };
const LABEL = { 9: '新聞稿', 48: '致醫界通函', 8772: '澄清稿', 11: '其他訊息', 158: 'Press Releases' };

// 模擬舊站快照（2026-10-03）：已自正式內容移除、但當時舊站上有的項目放在 data/legacy-export/_retired/（第二十輪：虛構的登革熱指引第 15～17 版與其通函）；
// 快照之後由 PDF 轉入的文件（有 derivedFrom）不屬於舊站，排除
const filesOf = (root, dir) => (fs.existsSync(path.join(root, dir)) ? fs.readdirSync(path.join(root, dir)).filter((f) => f.endsWith('.json')).map((f) => [f, path.join(root, dir, f)]) : []);
const readAll = (dir) => [...filesOf(CONTENT, dir), ...filesOf(path.join(ROOT, 'data/legacy-export/_retired'), dir)]
  .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([, p]) => JSON.parse(fs.readFileSync(p, 'utf8'))).filter((j) => !j.derivedFrom);
const stripImages = (md) => String(md ?? '').replace(/!\[[^\]]*\]\([^)]*\)\n?/g, '');
const stripHeadings = (md) => String(md ?? '').replace(/^#{1,2}\s+.*$/gm, '').trim();
const slugOf = (id) => String(id).replace(/^[a-z]+\./, '');
const pdfName = (s) => `${String(s).replace(/[^a-z0-9.-]+/gi, '-').toLowerCase().replace(/^-+|-+$/g, '')}.pdf`;
const seed = (s) => parseInt(fakeId(s).replace(/[^0-9]/g, '').slice(0, 6) || '7', 10);
const VERDICT = { false: '不實訊息', 'partly-true': '部分正確', outdated: '已過時', true: '正確' };

/** 合成的近年新聞（新站沒有 ⇒ 不會對到既有 id ⇒ 信心夠就 auto-ok） */
const RECENT_SYNTH = [
  ['2026-09-24', '疾管署公布第 38 週傳染病監測週報：類流感就診率續升，腸病毒疫情趨緩', ['類流感門急診就診率較前一週上升 8%，65 歲以上占比最高。', '腸病毒門急診就診人次連續兩週下降，仍請家長留意重症前兆病徵。', '登革熱本土病例本週新增 3 例，均在南部。']],
  ['2026-09-12', '登革熱防治：疾管署與高雄市政府聯合孳生源清除，呼籲民眾巡倒清刷', ['9 月 12 日起一週為孳生源清除週，衛生局與里辦公處逐戶訪查。', '民眾請每週檢查住家內外積水容器。']],
  ['2026-08-28', '疾管署提醒：開學季腸病毒傳播風險升高，落實洗手與生病不上學', ['幼兒園與托育機構請加強環境清消。', '出現嗜睡、持續嘔吐、肌躍型抽搐等重症前兆請立即就醫。']],
  ['2026-08-05', '麻疹境外移入病例新增 1 例，疾管署公布接觸者活動史並呼籲 1966 年後出生者評估接種 MMR', ['個案於潛伏期間曾搭乘國際航班，同班機旅客已掌握。', '前往流行地區前請評估接種。']],
  ['2026-07-10', '疾管署公布 2025 年結核病防治成果：新案數續降，都治完治率達 9 成', ['2025 年新案發生率每十萬人口 27 例。', '潛伏結核感染治療完治率 85%。']],
  ['2026-06-20', '夏季出國旅遊前請先查疫情：疾管署更新國際旅遊疫情建議等級', ['東南亞多國登革熱流行，南亞與非洲部分地區屈公病疫情。', '出國前 4 至 6 週至旅遊醫學門診評估。']],
];
/** 合成的久遠新聞（超過三年 ⇒ 封存；含 dropRules「活動報名」） */
const OLD_SYNTH = [
  ['2022-10-01', '111 年度公費流感疫苗 10 月 1 日起分階段開打', '公費流感疫苗分兩階段開打，第一階段對象為醫事人員、65 歲以上長者與學齡前幼兒。', '9'],
  ['2022-03-24', '世界結核病日：疾管署呼籲咳嗽超過兩週請就醫', '結核病是可治癒的疾病，規則服藥六個月以上即可治癒。', '9'],
  ['2021-05-15', 'COVID-19 疫情說明記者會（第 120 場）', '今日新增本土病例，請民眾落實防疫新生活運動。', '9'],
  ['2020-12-15', '活動報名：2021 年世界結核病日健走活動開放報名', '活動已於 2021 年 3 月舉辦完畢。', '11'],
  ['2020-04-01', 'COVID-19 疫情說明記者會（第 60 場）', '今日新增境外移入病例，入境者一律居家檢疫 14 天。', '9'],
  ['2019-11-20', '登革熱疫情趨緩，疾管署感謝地方政府與民眾共同努力', '本年度本土登革熱疫情已趨緩，仍請持續清除孳生源。', '9'],
];

export function generateNews(outDir) {
  const news = readAll('news').filter((n) => n.status === 'published');
  const clars = readAll('clarifications').filter((c) => c.status === 'published');
  const items = [];
  for (const n of news) {
    const typeid = n.type === 'letter' || n.newsType === 'letter' ? TYPEID.letter : TYPEID[n.newsType] ?? TYPEID.other;
    const atts = [];
    for (const a of n.attachments ?? []) atts.push({ name: pdfName(`${slugOf(n.id)}-${atts.length + 1}`), label: a.label, buf: pdfText(a.label, [`Attachment of ${n.id}`, 'Simulated export - not the real document.']) });
    for (const a of n.assets ?? []) if (a.kind === 'attachment') atts.push({ name: a.file, label: a.label ?? a.file, buf: pdfText(a.label ?? a.file, [`Attachment of ${n.id}`, 'Simulated export - not the real document.']) });
    items.push({ key: slugOf(n.id), typeid, title: n.title, pub: n.publishedAt, upd: n.publishedAt, body: () => mdHtml(stripHeadings(stripImages(n.bodyMarkdown ?? n.summary ?? ''))), atts, source: n.id });
  }
  for (const c of clars) {
    items.push({
      key: slugOf(c.id), typeid: TYPEID.clarification, title: c.title, pub: c.publishedAt, upd: c.publishedAt, atts: [], source: c.id,
      body: () => [P(`網傳：${c.claim}`), P(`查核結果：${VERDICT[c.verdict] ?? c.verdict}`), mdHtml(stripHeadings(stripImages(c.clarificationMarkdown ?? ''))), P(c.shareText ?? '')].join('\n'),
    });
  }
  // 英文新聞稿：取兩則有英文版的近年新聞（typeid 158；只有英文內文，需補中文版）
  for (const n of news.filter((x) => x.i18n?.en?.title && x.newsType === 'press').slice(0, 2)) {
    items.push({ key: `en-${slugOf(n.id)}`, typeid: TYPEID.en, title: n.i18n.en.title, pub: n.publishedAt, upd: n.publishedAt, atts: [], source: n.id, lang: 'en', body: () => [P(n.i18n.en.summary ?? n.i18n.en.title), P('Taiwan Centers for Disease Control (Taiwan CDC) press release. Full English text is a simulated export; Chinese source is the authoritative version.')].join('\n') });
  }
  for (const [pub, title, lines] of RECENT_SYNTH) items.push({ key: `${pub}-synth`, typeid: TYPEID.press, title, pub, upd: pub, atts: [], source: null, body: () => lines.map((l) => P(l)).join('\n') });
  for (const [pub, title, text, typeid] of OLD_SYNTH) items.push({ key: `${pub}-old`, typeid, title, pub, upd: pub, atts: pub < '2021-01-01' ? [{ name: pdfName(`${pub}-old`), label: `${title}（PDF）`, buf: pdfScan(seed(`${pub}:${title}`)) }] : [], source: null, body: () => P(text) });
  items.sort((a, b) => b.pub.localeCompare(a.pub) || a.key.localeCompare(b.key));

  const out = path.resolve(outDir);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(path.join(out, 'files'), { recursive: true });
  let n = 0;
  const write = (stem, { url, title, crumbs, body, pub, upd, typeid, atts }) => {
    const fileList = atts.length ? `<div class="file-list"><h4>相關檔案</h4><ul>${atts.map((a) => `<li><a href="${esc(a.url)}">${esc(a.label)}</a> <span class="size">(PDF)</span></li>`).join('')}</ul></div>` : '';
    fs.writeFileSync(path.join(out, `${stem}.html`), shell({ title, crumbs, bodyHtml: `${body}\n${fileList}`, updated: upd, menuActive: '' }));
    fs.writeFileSync(path.join(out, `${stem}.json`), `${JSON.stringify({ url, title, category: crumbs.slice(1).join('／'), publishedAt: pub, updatedAt: upd, breadcrumbs: crumbs, ...(typeid ? { typeid } : {}), attachments: atts.map((a) => ({ url: a.url, label: a.label, file: a.name })) }, null, 2)}\n`);
    for (const a of atts) if (a.buf) fs.writeFileSync(path.join(out, 'files', a.name), a.buf);
  };
  for (const it of items) {
    n++;
    const stem = `${String(n).padStart(3, '0')}-${it.key}`;
    const url = `${BASE}/Bulletin/Detail/${fakeId(`bulletin:${it.key}`)}?typeid=${it.typeid}`;
    const atts = it.atts.map((a, i) => ({ ...a, url: `${BASE}/File/Get/${fakeId(`bulletin:${it.key}:${i}`)}` }));
    const label = LABEL[it.typeid] ?? '新聞稿';
    const crumbs = it.lang === 'en' ? ['Home', 'News', label] : ['首頁', '新聞與公告', label];
    write(stem, { url, title: it.title, crumbs, body: it.body(), pub: it.pub, upd: it.upd, typeid: it.typeid, atts });
  }
  // 列表頁（新站自動產生，不轉）
  n++;
  write(`${String(n).padStart(3, '0')}-news-list`, {
    url: `${BASE}/Bulletin/List/${fakeId('bulletin:list:9')}?typeid=9`, title: '新聞稿', crumbs: ['首頁', '新聞與公告', '新聞稿'], pub: EXPORTED_AT, upd: EXPORTED_AT, typeid: '9', atts: [],
    body: `<ul class="news-list">${items.filter((i) => i.typeid === '9').slice(0, 10).map((i) => `<li><span class="date">${esc(i.pub)}</span> ${A(`${BASE}/Bulletin/Detail/${fakeId(`bulletin:${i.key}`)}?typeid=9`, i.title)}</li>`).join('')}</ul>`,
  });
  const counts = { existing: items.filter((i) => i.source && !i.lang).length, en: items.filter((i) => i.lang === 'en').length, recentSynth: RECENT_SYNTH.length, oldSynth: OLD_SYNTH.length, clarifications: clars.length };
  fs.writeFileSync(path.join(out, '_export.json'), `${JSON.stringify({
    format: 'cdc-legacy-export/1', simulated: true, exportedAt: EXPORTED_AT, site: BASE, batch: 'news', pages: n,
    source: `模擬匯出：新聞與公告欄目（Bulletin）。由既有 content/news ${counts.existing - counts.clarifications} 則、content/clarifications ${counts.clarifications} 則反推，另合成近年新聞 ${counts.recentSynth} 則（新站沒有）、久遠新聞 ${counts.oldSynth} 則、英文新聞稿 ${counts.en} 則、列表頁 1 頁；不是舊站的真實資料（網址 ID、數字、PDF 內容皆為示意）。正式匯出取代整個目錄即可。`,
    generator: 'scripts/lib/legacy-import/sim-export-news.mjs',
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(out, 'README.md'), readme({ ...counts, pages: n }));
  return { dir: out, pages: n, files: fs.readdirSync(path.join(out, 'files')).length, ...counts };
}

const readme = (c) => `# 舊站匯出（模擬）：新聞與公告欄目（第六批）

> **這是模擬匯出。** 開發環境連不到 www.cdc.gov.tw，這 ${c.pages} 頁由 \`scripts/lib/legacy-import/sim-export-news.mjs\` 合成：既有 content/news（${c.existing - c.clarifications} 則）與 content/clarifications（${c.clarifications} 則）反推成舊站 Bulletin 內頁（新聞稿 typeid 9、致醫界通函 48、澄清稿 8772、其他訊息 11），另合成新站沒有的近年新聞 ${c.recentSynth} 則、超過三年的久遠新聞 ${c.oldSynth} 則（含一則「活動報名」）、英文新聞稿 ${c.en} 則（typeid 158）與一頁列表頁。網址中的 ID、PDF 內容都是示意。**正式匯出取代整個目錄即可**，不需要改程式。

這批**沒有移轉清單**：新聞不是一頁對一頁搬，而是依三級處理（docs/legacy-import.md 第 7 節）決定上線、封存或不轉；報告另附二級抽樣名單。

## 重新產生

\`\`\`
node scripts/lib/legacy-import/sim-export-news.mjs data/legacy-export/news
\`\`\`

## 轉換

\`\`\`
node scripts/import-legacy.mjs data/legacy-export/news --out data/legacy-import/news --now 2026-10-05T02:30:00Z
\`\`\`
`;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = generateNews(process.argv[2] ?? path.join(ROOT, 'data/legacy-export/news'));
  console.log(`模擬匯出 news：${r.pages} 頁（既有新聞／澄清 ${r.existing}、合成近年 ${r.recentSynth}、久遠 ${r.oldSynth}、英文 ${r.en}）、files/ ${r.files} 個檔 → ${path.relative(ROOT, r.dir)}`);
}
