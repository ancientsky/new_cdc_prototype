#!/usr/bin/env node
// 模板驅動的模擬匯出產生器（ARCHITECTURE 17.3 第二批起）：任何有疾病頁的疾病都能產一份「像舊站」的匯出，不必像結核病首批逐頁手寫。
//   來源：content/migration/_disease-template.json（標準子頁樹 20 項）＋ content/migration/{slug}.json 人工例外清單（若有）＋ 近三年該疾病的新聞／通函／澄清稿（Bulletin 內頁，清單沒有，用來測 not-in-manifest）。
//   內文：反推自既有內容（疾病頁區塊、Q&A、文件、新聞、影音、檢驗、資料集），版型與 Word 殘留沿用 sim-export.mjs 的外殼與工具。
//   數字、網址 ID、PDF 內容皆為示意；正式匯出（資訊室從 CMS 匯出）取代整個目錄即可。
// 用法：node scripts/lib/legacy-import/sim-export-disease.mjs <disease.id|slug> [輸出目錄]   （預設 data/legacy-export/{slug}）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { BASE, esc, fakeId, P, LI, H, A, mdHtml, TABLE, pdfText, pdfScan, png, shell, qaPanels } from './sim-export.mjs';
import { expandTemplateItems } from './migration.mjs';
import { loadContentIndex } from './index.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const CONTENT = path.join(ROOT, 'content');
export const EXPORTED_AT = '2026-10-03';
const TEMPLATE_ID = 'migration-template.disease';
const NEWS_TYPEID = { press: '9', clarification: '8772', other: '11', letter: '11' };
const RECENT_NEWS_MAX = 5;
const RECENT_YEARS = 3;

// 模擬舊站快照（2026-10-03）：已自正式內容移除、但當時舊站上有的項目放在 data/legacy-export/_retired/（第二十輪：虛構的登革熱指引第 15～17 版與其通函）；
// 快照之後由 PDF 轉入的文件（有 derivedFrom）不屬於舊站，排除
const RETIRED = path.join(ROOT, 'data/legacy-export/_retired');
const filesOf = (d) => (fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith('.json')).map((f) => [f, path.join(d, f)]) : []);
const readDir = (d) => [...filesOf(d), ...(d.startsWith(CONTENT) ? filesOf(path.join(RETIRED, path.relative(CONTENT, d))) : [])]
  .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([, p]) => JSON.parse(fs.readFileSync(p, 'utf8'))).filter((j) => !j.derivedFrom);
const seed = (s) => parseInt(fakeId(s).replace(/[^0-9]/g, '').slice(0, 6) || '7', 10);
const firstPara = (md) => String(md ?? '').split(/\n{2,}/).map((x) => x.trim()).filter((x) => x && !/^#{1,6}\s/.test(x))[0] ?? '';
const stripHeadings = (md) => String(md ?? '').split('\n').filter((l) => !/^#{1,6}\s/.test(l)).join('\n').trim();
const latest = (arr) => [...arr].sort((a, b) => String(b.effectiveAt ?? b.publishedAt ?? '').localeCompare(String(a.effectiveAt ?? a.publishedAt ?? '')))[0] ?? null;

/** 既有內容索引：疾病頁、該疾病的 Q&A／文件／新聞／影音／檢驗／資料集／出版品／疫苗 */
function loadSources(dm) {
  const tied = (j) => [...(j.diseases ?? []), ...(j.basedOn ?? [])].includes(dm.id);
  const page = readDir(path.join(CONTENT, 'diseases')).find((d) => d.id === dm.id) ?? null;
  return {
    page,
    faq: readDir(path.join(CONTENT, 'faq')).filter(tied).sort((a, b) => a.id.localeCompare(b.id)),
    docs: readDir(path.join(CONTENT, 'documents')).filter(tied),
    news: readDir(path.join(CONTENT, 'news')).filter(tied),
    media: readDir(path.join(CONTENT, 'media')).filter(tied),
    labtests: readDir(path.join(CONTENT, 'labtests')).filter(tied),
    datasets: readDir(path.join(CONTENT, 'datasets')).filter(tied),
    publications: readDir(path.join(CONTENT, 'publications')).filter(tied),
    vaccines: readDir(path.join(CONTENT, 'vaccines')).filter(tied),
    byId: new Map([...readDir(path.join(CONTENT, 'documents')), ...readDir(path.join(CONTENT, 'news')), ...readDir(path.join(CONTENT, 'media')), ...readDir(path.join(CONTENT, 'vaccines')), ...readDir(path.join(CONTENT, 'publications')), ...readDir(path.join(CONTENT, 'topics'))].map((j) => [j.id, j])),
  };
}

const UNIT_LABEL = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(CONTENT, 'master/units.json'), 'utf8')).map((u) => [u.id, u.name ?? u.shortName ?? u.id]));

/** 把一份文件（document）排成舊站檔案說明頁：摘要、前三節、檔案資訊表、下載連結 */
function docBody(doc, { versionLabel } = {}) {
  const secs = (doc.sections ?? []).slice(0, 3).map((s) => `${H(3, s.heading)}\n${mdHtml(stripHeadings(s.markdown))}`);
  const info = TABLE(['項目', '內容'], [['文件名稱', doc.title], ['版次', versionLabel ?? doc.version ?? '—'], ['生效日', doc.effectiveAt ?? doc.publishedAt ?? '—'], ['權責單位', UNIT_LABEL[doc.owner] ?? doc.owner], ['檔案格式', 'PDF']]);
  return [P(doc.summary), ...secs, info, P(`完整內容請下載附件：${A('__FILE__', `${doc.title}（PDF）`)}`)].join('\n');
}

/** 文件 → 示意 PDF（有文字層；archived／舊版用掃描檔） */
function docPdf(doc, { scan = false } = {}) {
  if (scan) return pdfScan(seed(doc.id));
  const lines = (doc.sections ?? []).slice(0, 6).map((s, i) => `${i + 1}. ${s.heading}`);
  return pdfText(doc.id, [`Effective: ${doc.effectiveAt ?? doc.publishedAt ?? ''}`, `Version: ${doc.version ?? ''}`, '', ...lines, '', 'Simulated export - not the real document.']);
}

const pdfName = (id) => `${String(id).replace(/^[a-z]+\./, '').replace(/[^a-z0-9.-]+/gi, '-').toLowerCase()}.pdf`;

/**
 * 模板項／人工例外項 → 頁面規格 { title?, pub, upd, tab?, typeid?, body(), attachments[], files{} }
 * attachments：{ name, label, url|null, buf }（url null ＝ 用假 File/Get ID；檔案頁的第一個附件網址＝頁面網址）
 */
function specFor(item, dm, src) {
  const page = src.page;
  const block = (k) => page?.blocks?.find((b) => b.key === k) ?? null;
  const blockMd = (k) => block(k)?.markdown ?? '';
  const pub = page?.publishedAt ?? '2019-01-01';
  const upd = page?.reviewedAt ?? EXPORTED_AT;
  const kf = page?.keyFacts ?? {};
  const target = item.target ? src.byId.get(item.target) : null;
  const m = item.mapTo ?? {};
  const frag = String(item.oldUrl ?? '').split('#')[1] ?? '';
  const legalLabel = { 1: '第一類', 2: '第二類', 3: '第三類', 4: '第四類', 5: '第五類' }[dm.legalCategory] ?? '—';
  const notifyLabel = dm.notifyWithinHours == null ? '依規定' : dm.notifyWithinHours <= 24 ? `${dm.notifyWithinHours} 小時內` : `${Math.round(dm.notifyWithinHours / 24)} 日內`;
  const factsTable = () => TABLE(['項目', '內容'], [['法定傳染病類別', legalLabel], ['通報時限', notifyLabel], ['ICD-10', (dm.icd10 ?? []).join('、') || '—'], ['主要傳染途徑', kf.transmission ?? ((dm.transmission ?? []).join('、') || '—')], ['潛伏期', kf.incubation ?? dm.incubation ?? '—']]);
  const trendTable = () => {
    const s = seed(dm.id);
    const rows = [2021, 2022, 2023, 2024, 2025].map((y, i) => [String(y), String(((s * (i + 3)) % 900) + 100), String(((s * (i + 7)) % 400) / 10)]);
    return TABLE(['年度', '確定病例數（示意）', '每十萬人口發生率（示意）'], rows);
  };
  const chartPng = () => png(160, 90, [0.3, 0.55, 0.42, 0.8, 0.65], [27, 111, 170]);
  const generic = (title) => P(`${title}：本頁內容由舊站「${dm.name}」專區移入，請權責單位確認是否仍為現行版本。`);

  switch (item.key) {
    case 'intro': return { pub, upd, body: () => [P(page?.summary ?? dm.name), factsTable(), H(3, '致病原'), mdHtml(firstPara(blockMd('transmission')) || `${dm.name}的致病原資料待補。`)].join('\n') };
    case 'intro-pathogen': return { pub, upd, tab: frag, body: () => mdHtml(firstPara(blockMd('transmission')) || `${dm.name}的致病原資料待補。`) };
    case 'intro-epidemiology': return { pub, upd, tab: frag, body: () => [mdHtml(stripHeadings(blockMd('situation')) || `${dm.name}流行病學資料待補。`), P('近年確定病例趨勢如下表與圖（**示意數字，非正式統計**，正式數字見統計資料）：'), trendTable(), `<p class="MsoNormal"><img src="/Upload/images/${dm.slug}-trend.png" width="320"></p>`].join('\n'), files: { [`${dm.slug}-trend.png`]: chartPng() } };
    case 'intro-transmission': return { pub, upd, tab: frag, body: () => mdHtml(stripHeadings(blockMd('transmission'))) };
    case 'intro-incubation': return { pub, upd, tab: frag, body: () => [P(`${dm.name}的潛伏期為 **${kf.incubation ?? dm.incubation ?? '依文獻'}**。`), TABLE(['項目', '內容'], [['潛伏期', kf.incubation ?? dm.incubation ?? '—'], ['可傳染期', kf.transmission ? `病媒／接觸相關（${kf.transmission}）` : '依疾病而異']])].join('\n') };
    case 'intro-symptoms': return { pub, upd, tab: frag, body: () => `${mdHtml(stripHeadings(blockMd('symptoms')))}${block('symptoms')?.warning ? `\n${P(`**注意：**${block('symptoms').warning}`)}` : ''}` };
    case 'intro-prevention': return { pub, upd, tab: frag, body: () => mdHtml(stripHeadings(blockMd('prevention'))) };
    case 'intro-treatment': return { pub, upd, tab: frag, body: () => mdHtml(stripHeadings(blockMd('treatment'))) };
    case 'vaccine': {
      const v = src.vaccines[0];
      return { pub, upd, tab: frag, body: () => [mdHtml(stripHeadings(blockMd('vaccine')) || `${dm.name}目前沒有可用疫苗，預防以阻斷傳染途徑為主。`), v ? TABLE(['對象', '劑次', '費用'], [[(v.targetGroups ?? ['依接種建議']).join('、'), String(v.doses ?? '—'), v.publicFunded ? '公費' : '自費']]) : ''].join('\n') };
    }
    case 'qa-list': return { pub: src.faq[0]?.publishedAt ?? pub, upd, body: () => (src.faq.length ? qaPanels(src.faq.map((f) => ({ q: f.question ?? f.title, a: f.answerMarkdown }))) : P(`${dm.name}常見問題整理中。`)) };
    case 'materials-poster': return {
      pub, upd, tab: frag,
      body: () => [P(`${dm.name}宣導單張與海報，歡迎下載運用（多國語言版本見附件）。`), `<ul>${['中文', '英文', '越南文', '印尼文', '泰文'].map((l) => `<li>${A('__FILE__', `${dm.name}防治海報（${l}）`)}</li>`).join('')}</ul>`, `<p class="MsoNormal"><img src="/Upload/images/${dm.slug}-poster.png" width="240"></p>`].join('\n'),
      attachments: [{ name: `${dm.slug}-poster-7lang.pdf`, label: `${dm.name}防治海報（七語）`, url: null, buf: pdfScan(seed(`${dm.id}:poster`)) }],
      files: { [`${dm.slug}-poster.png`]: png(120, 160, [0.9, 0.7, 0.8, 0.6], [200, 60, 60]) },
    };
    case 'materials-video': {
      const v = src.media.find((x) => x.mediaType === 'video' || x.youtubeId) ?? src.media[0];
      return { pub: v?.publishedAt ?? pub, upd, tab: frag, body: () => [P(v?.summary ?? `${dm.name}宣導影片。`), `<iframe width="560" height="315" src="https://www.youtube.com/embed/${esc(v?.youtubeId ?? 'xxxxxxxxxxx')}" frameborder="0" allowfullscreen></iframe>`, ...(v?.transcriptMarkdown ? [H(3, '影片文字稿'), mdHtml(stripHeadings(v.transcriptMarkdown).slice(0, 600))] : [])].join('\n') };
    }
    case 'manual': {
      const d = latest(src.docs.filter((x) => x.docType === 'manual')) ?? src.publications.find((x) => x.pubType === 'manual') ?? null;
      if (!d) return { pub, upd, body: () => generic('工作手冊'), attachments: [{ name: `${dm.slug}-manual.pdf`, label: `${dm.name}防治工作手冊`, url: null, buf: pdfText(`${dm.slug} manual`, ['Simulated manual']) }] };
      return { pub: d.publishedAt ?? pub, upd: d.reviewedAt ?? upd, title: d.title, body: () => (d.type === 'document' ? docBody(d) : [P(d.summary), mdHtml(stripHeadings(d.abstractMarkdown ?? '')), P(`下載：${A('__FILE__', `${d.title}（PDF）`)}`)].join('\n')), attachments: [{ name: pdfName(d.id), label: d.title, url: null, buf: d.type === 'document' ? docPdf(d) : pdfText(d.id, [d.title]) }] };
    }
    case 'case-definition': {
      const d = latest(src.docs.filter((x) => x.docType === 'case-definition'));
      if (!d) return { pub, upd, body: () => generic('病例定義') };
      return { pub: d.publishedAt ?? pub, upd: d.reviewedAt ?? upd, title: d.title, body: () => docBody(d), attachments: [{ name: pdfName(d.id), label: d.title, url: null, buf: docPdf(d) }] };
    }
    case 'guideline': {
      const d = latest(src.docs.filter((x) => x.docType === 'guideline'));
      if (!d) return { pub, upd, body: () => generic('治療指引') };
      return { pub: d.publishedAt ?? pub, upd: d.reviewedAt ?? upd, title: d.title, body: () => docBody(d), attachments: [{ name: pdfName(d.id), label: d.title, url: null, buf: docPdf(d) }] };
    }
    case 'stats': {
      const ds = src.datasets[0];
      const csv = Buffer.from(`year,cases,rate\n${[2021, 2022, 2023, 2024, 2025].map((y, i) => `${y},${((seed(dm.id) * (i + 3)) % 900) + 100},${((seed(dm.id) * (i + 7)) % 400) / 10}`).join('\n')}\n`, 'utf8');
      return { pub, upd, tab: frag, body: () => [P(ds?.summary ?? `${dm.name}統計資料。`), trendTable(), P(`資料檔：${A('__FILE__', `${dm.name}年度統計（CSV）`)}；更多資料見${A('https://data.cdc.gov.tw/', '疾管署資料開放平臺')}。`)].join('\n'), attachments: [{ name: `${dm.slug}-stats.csv`, label: `${dm.name}年度統計（CSV，示意）`, url: null, buf: csv }] };
    }
    case 'lab': {
      const l = src.labtests[0];
      return { pub: l?.publishedAt ?? pub, upd: l?.reviewedAt ?? upd, tab: frag, body: () => [P(l?.summary ?? `${dm.name}檢驗項目與送驗規定。`), ...(l ? [TABLE(['項目', '內容'], [['檢體', (l.specimens ?? []).map((s) => (typeof s === 'string' ? s : s.type ?? s.name ?? JSON.stringify(s))).join('、') || '—'], ['送驗時限', l.sendWithinHours ? `${l.sendWithinHours} 小時內` : '—'], ['生物安全等級', l.biosafetyLevel ?? '—']]), mdHtml(stripHeadings(l.notesMarkdown ?? ''))] : [])].join('\n') };
    }
    case 'notify': return { pub, upd, tab: frag, body: () => [P(`${dm.name}為${legalLabel}法定傳染病，醫師診治病人或檢驗結果符合通報定義時，應於 **${notifyLabel}** 完成通報。`), TABLE(['項目', '內容'], [['法定類別', legalLabel], ['通報時限', notifyLabel], ['通報方式', '傳染病通報系統（NIDRS）'], ['通報定義', `見「${dm.name}病例定義」`]]), ...(page?.professional?.notifyNote ? [P(page.professional.notifyNote)] : [])].join('\n') };
    case 'news-list': return { pub, upd, body: () => `<ul class="news-list">${src.news.slice(0, 8).map((n) => `<li><span class="date">${esc(n.publishedAt)}</span> ${A(`${BASE}/Bulletin/Detail/${fakeId(`news:${n.id}`)}?typeid=${NEWS_TYPEID[n.newsType ?? n.type] ?? '9'}`, n.title)}</li>`).join('')}</ul>` };
    case 'links': return { pub, upd, tab: frag, body: () => `<ul>${[['世界衛生組織（WHO）', 'https://www.who.int/'], ['美國疾病管制與預防中心（US CDC）', 'https://www.cdc.gov/'], ['衛生福利部', 'https://www.mohw.gov.tw/'], ['疾管署資料開放平臺', 'https://data.cdc.gov.tw/']].map(([t, u]) => `<li>${A(u, t)}</li>`).join('')}</ul>` };
    default: break;
  }

  // 人工例外項：依 oldType 與對應的新站內容反推（Bulletin 內頁一律當新聞／通函處理，不看 oldType）
  const t = target;
  if (/\/Bulletin\/Detail\//.test(String(item.oldUrl))) {
    const n = t?.type === 'news' || t?.type === 'letter' || t?.type === 'clarification' ? t : null;
    // 標題用清單的 oldTitle（清單寫的就是舊頁標題；近年新聞項的 oldTitle 本來就是新聞標題）
    return { pub: n?.publishedAt ?? pub, upd: n?.publishedAt ?? upd, typeid: NEWS_TYPEID[n?.newsType ?? n?.type] ?? '9', body: () => mdHtml(stripHeadings(n?.bodyMarkdown ?? `${item.oldTitle}。`)) };
  }
  const archived = item.status === 'archived' || /舊版|歷年|\d{4}[–-]\d{4}/.test(item.oldTitle);
  switch (item.oldType) {
    case 'pdf': {
      const d = t?.type === 'document' ? t : latest(src.docs.filter((x) => item.oldTitle.includes(String(x.version ?? '')) && x.version));
      if (d) return { pub: d.publishedAt ?? pub, upd: archived ? d.publishedAt ?? upd : d.reviewedAt ?? upd, body: () => docBody(d, { versionLabel: d.version }), attachments: [{ name: pdfName(d.id), label: d.title, url: null, buf: docPdf(d, { scan: archived }) }] };
      return { pub: archived ? '2019-01-01' : pub, upd: archived ? '2020-12-31' : upd, body: () => [generic(item.oldTitle), P(`下載：${A('__FILE__', `${item.oldTitle}（PDF）`)}`)].join('\n'), attachments: [{ name: pdfName(item.key), label: item.oldTitle, url: null, buf: archived ? pdfScan(seed(item.key)) : pdfText(item.key, [item.oldTitle]) }] };
    }
    case 'media': {
      const v = t?.type === 'media' ? t : src.media[0];
      return { pub: v?.publishedAt ?? pub, upd, body: () => [P(v?.summary ?? item.oldTitle), `<iframe width="560" height="315" src="https://www.youtube.com/embed/${esc(v?.youtubeId ?? 'xxxxxxxxxxx')}" frameborder="0" allowfullscreen></iframe>`].join('\n') };
    }
    case 'news-list': return { pub, upd, body: () => `<ul class="news-list">${src.news.slice(0, 6).map((n) => `<li><span class="date">${esc(n.publishedAt)}</span> ${A(`${BASE}/Bulletin/Detail/${fakeId(`news:${n.id}`)}?typeid=${NEWS_TYPEID[n.newsType ?? n.type] ?? '9'}`, n.title)}</li>`).join('')}</ul>` };
    case 'qa': return { pub, upd, body: () => qaPanels(src.faq.slice(0, 3).map((f) => ({ q: f.question ?? f.title, a: f.answerMarkdown }))) };
    case 'list': case 'external': {
      if (archived) return { pub: '2015-06-01', upd: '2020-12-31', body: () => [P(`${item.oldTitle}（歷年資料，僅供查閱）。`), `<ul>${[2015, 2016, 2017, 2018, 2019, 2020].map((y) => `<li>${A('#', `${y} 年${dm.name}宣導海報`)}</li>`).join('')}</ul>`].join('\n') };
      const links = (t?.type === 'media' ? [t] : src.media).slice(0, 3).map((v) => `<li>${A(`${BASE}/Category/MPage/${fakeId(`media:${v.id}`)}`, v.title)}</li>`);
      return { pub, upd, body: () => [P(t?.summary ?? `${item.oldTitle}：相關資料清單。`), ...(t?.type === 'document' ? [docBody(t)] : []), `<ul>${links.join('')}${['北區', '中區', '南區', '高屏區', '東區'].map((r) => `<li>${A('#', `${r}：${item.oldTitle}`)}</li>`).join('')}</ul>`, ...(t?.type === 'media' ? [] : [trendTable()])].join('\n'), ...(t?.type === 'document' ? { attachments: [{ name: pdfName(t.id), label: t.title, url: null, buf: docPdf(t) }] } : {}) };
    }
    case 'news': case 'letter': {
      const n = t?.type === 'news' || t?.type === 'letter' ? t : null;
      return { pub: n?.publishedAt ?? pub, upd: n?.publishedAt ?? upd, typeid: NEWS_TYPEID[n?.newsType ?? n?.type] ?? '9', title: n?.title ?? item.oldTitle, body: () => mdHtml(stripHeadings(n?.bodyMarkdown ?? `${item.oldTitle}。`)) };
    }
    default: {
      // page：對應文件 → 文件說明頁；對應疾病頁 → 專區首頁（摘要＋連結）；對應疫苗 → 疫苗專區；其他 → 一般說明
      if (t?.type === 'document') return { pub: t.publishedAt ?? pub, upd: t.reviewedAt ?? upd, body: () => docBody(t), attachments: [{ name: pdfName(t.id), label: t.title, url: null, buf: docPdf(t) }] };
      if (t?.type === 'disease' || /專區/.test(item.oldTitle)) return { pub, upd, body: () => [P(page?.summary ?? dm.name), H(3, '專區內容'), `<ul>${['疾病介紹', 'Q&A', '宣導素材', '指引及手冊', '統計資料', '最新消息'].map((x) => `<li>${A(`${BASE}/Category/List/${fakeId(`${dm.id}:${x}`)}`, x)}</li>`).join('')}</ul>`, factsTable()].join('\n') };
      if (t?.type === 'vaccine') return { pub: t.publishedAt ?? pub, upd: t.reviewedAt ?? upd, body: () => [P(t.summary ?? item.oldTitle), mdHtml(stripHeadings(t.bodyMarkdown ?? t.notesMarkdown ?? '')), TABLE(['對象', '劑次', '費用'], [[(t.targetGroups ?? ['依接種建議']).join('、'), String(t.doses ?? '—'), t.publicFunded ? '公費' : '自費']])].join('\n') };
      if (t?.type === 'news' || t?.type === 'letter') return { pub: t.publishedAt ?? pub, upd: t.publishedAt ?? upd, typeid: NEWS_TYPEID[t.newsType ?? t.type] ?? '9', title: t.title, body: () => mdHtml(stripHeadings(t.bodyMarkdown ?? '')) };
      if (t?.type === 'media') return { pub: t.publishedAt ?? pub, upd, body: () => [P(t.summary ?? item.oldTitle), `<iframe width="560" height="315" src="https://www.youtube.com/embed/${esc(t.youtubeId ?? 'xxxxxxxxxxx')}" frameborder="0" allowfullscreen></iframe>`].join('\n') };
      return { pub, upd, body: () => [generic(item.oldTitle), ...(item.key.includes('migrant') || /外籍|移工|多語/.test(item.oldTitle) ? [`<ul>${['英文', '越南文', '印尼文', '泰文', '菲律賓文'].map((l) => `<li>${A('__FILE__', `${dm.name}防治宣導單張（${l}）`)}</li>`).join('')}</ul>`] : [LI('相關規定與作法請洽地方衛生局。')])].join('\n'), ...(item.key.includes('migrant') || /外籍|移工|多語/.test(item.oldTitle) ? { attachments: [{ name: `${dm.slug}-migrant-leaflet.pdf`, label: `${dm.name}防治宣導單張（多語）`, url: null, buf: pdfScan(seed(`${item.key}:leaflet`)) }] } : {}) };
    }
  }
}

/** 近三年的新聞／通函／澄清稿 → Bulletin 內頁（清單裡沒有，測 not-in-manifest 與 auto-ok） */
function recentNewsItems(dm, src, covered = new Set()) {
  const cutoff = `${Number(EXPORTED_AT.slice(0, 4)) - RECENT_YEARS}-01-01`;
  return src.news.filter((n) => n.status === 'published' && (n.publishedAt ?? '') >= cutoff && !covered.has(n.id)).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)).slice(0, RECENT_NEWS_MAX)
    .map((n) => ({ key: `news-${n.id.replace(/^news\./, '')}`, oldTitle: n.title, oldPath: `${dm.name}／最新消息`, oldUrl: `${BASE}/Bulletin/Detail/{id}?typeid=${NEWS_TYPEID[n.newsType ?? n.type] ?? '9'}`, oldType: n.type === 'letter' ? 'letter' : 'news', target: n.id, extra: true }));
}

/** 主入口：疾病 id（或 slug）→ 匯出目錄 */
export function generateDisease(diseaseRef, outDir) {
  const master = JSON.parse(fs.readFileSync(path.join(CONTENT, 'master/diseases.json'), 'utf8'));
  const dm = master.find((d) => d.id === diseaseRef || d.slug === diseaseRef || d.id === `disease.${diseaseRef}`);
  if (!dm) throw new Error(`主檔找不到疾病 ${diseaseRef}`);
  const src = loadSources(dm);
  if (!src.page) throw new Error(`${dm.name} 還沒有疾病頁（content/diseases/${dm.slug}.json），模擬匯出沒有內容可反推`);
  const tplFile = path.join(CONTENT, 'migration/_disease-template.json');
  const tpl = JSON.parse(fs.readFileSync(tplFile, 'utf8'));
  if (tpl.id !== TEMPLATE_ID) throw new Error(`模板 id 不是 ${TEMPLATE_ID}`);
  // 舊站快照當時的清單（之後改過目標的放在 _retired/migration/）
  const mfFile = [path.join(RETIRED, 'migration', `${dm.slug}.json`), path.join(CONTENT, 'migration', `${dm.slug}.json`)].find((f) => fs.existsSync(f)) ?? path.join(CONTENT, 'migration', `${dm.slug}.json`);
  const manual = fs.existsSync(mfFile) ? JSON.parse(fs.readFileSync(mfFile, 'utf8')) : null;
  const manualByKey = new Map((manual?.items ?? []).map((i) => [i.key, i]));
  const omit = new Set(manual?.omit ?? []);
  const legacyRootId = /\/Disease\/SubIndex\/([^/{#?]+)/.exec(manual?.legacyRoot ?? '')?.[1] ?? fakeId(`Disease/SubIndex/${dm.slug}`);

  // 模板位置哪些要產，跟轉換器的推導規則同一套（expandTemplateItems）：人工例外已指向同一份新站內容的位置不再另產一頁，
  // 否則同一份文件會從兩個舊網址各來一份（第三批作業手冊的情況）
  const derivedKeys = new Set(expandTemplateItems({
    manifest: manual ?? { extends: TEMPLATE_ID, scope: { kind: 'disease', disease: dm.id }, items: [] },
    contentDir: CONTENT, index: loadContentIndex(CONTENT), diseaseById: new Map(master.map((d) => [d.id, d])),
  }).filter((d) => !d.coveredBy).map((d) => d.key));
  const items = [];
  for (const t of tpl.items) {
    if (omit.has(t.key)) continue;
    if (manualByKey.has(t.key)) { items.push({ ...manualByKey.get(t.key), mapTo: manualByKey.get(t.key).mapTo ?? t.mapTo, derived: false }); continue; }
    if (!derivedKeys.has(t.key)) continue;
    items.push({ key: t.key, oldTitle: t.oldTitle, oldPath: `${dm.name}／${t.oldPath ?? t.oldTitle}`, oldUrl: t.oldUrlPattern, oldType: t.oldType, mapTo: t.mapTo, derived: true });
  }
  for (const it of manual?.items ?? []) if (!items.some((x) => x.key === it.key)) items.push({ ...it, derived: false });
  const news = recentNewsItems(dm, src, new Set(items.map((i) => i.target).filter(Boolean)));
  const all = [...items, ...news];

  const out = path.resolve(outDir);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(path.join(out, 'files'), { recursive: true });
  let n = 0;
  const written = [];
  for (const it of all) {
    const s = specFor(it, dm, src);
    n++;
    const stem = `${String(n).padStart(2, '0')}-${it.key}`;
    const parts = String(it.oldUrl).split('#');
    const shared = /\/Disease\/SubIndex\//.test(parts[0]);
    let url = parts[0].replace(/\{id\}/g, shared ? legacyRootId : fakeId(`${dm.slug}:${it.key}`)).replace(/\{[a-z]+\}/gi, fakeId(`${dm.slug}:${it.key}:x`));
    const typeid = s.typeid ?? /typeid=(\d+)/.exec(url)?.[1] ?? null;
    if (s.typeid && !/typeid=/.test(url)) url = `${url}${url.includes('?') ? '&' : '?'}typeid=${s.typeid}`;
    const atts = (s.attachments ?? []).map((a, i) => ({ url: a.url ?? (/\/(File\/Get|Uploads)\//.test(url) && i === 0 ? url : `${BASE}/File/Get/${fakeId(`${dm.slug}:${it.key}:${i}`)}`), label: a.label, file: a.name, _buf: a.buf }));
    let body = s.body();
    body = body.replace(/__FILE__/g, atts[0]?.url ?? '#');
    const title = s.title ?? it.oldTitle;
    const pathParts = String(it.oldPath ?? it.oldTitle).split('／');
    const crumbs = ['首頁', '傳染病與防疫專題', ...(pathParts[0] === dm.name ? pathParts : [dm.name, ...pathParts])];
    const catParts = crumbs.slice(2);
    const category = catParts.slice(0, 2).join('／');
    const fileList = atts.length ? `<div class="file-list"><h4>相關檔案</h4><ul>${atts.map((a) => `<li><a href="${esc(a.url)}">${esc(a.label)}</a> <span class="size">(${esc(path.extname(a.file).slice(1).toUpperCase())})</span></li>`).join('')}</ul></div>` : '';
    const html = shell({ title, crumbs, bodyHtml: `${body}\n${fileList}`, updated: s.upd, menuActive: catParts[1] ?? '' });
    fs.writeFileSync(path.join(out, `${stem}.html`), html);
    const side = {
      url, title, category, publishedAt: s.pub, updatedAt: s.upd, breadcrumbs: crumbs,
      ...(typeid ? { typeid } : {}), ...(s.tab ? { tab: s.tab } : {}),
      attachments: atts.map((a) => ({ url: a.url, label: a.label, file: a.file })),
    };
    fs.writeFileSync(path.join(out, `${stem}.json`), `${JSON.stringify(side, null, 2)}\n`);
    for (const a of atts) if (a._buf) fs.writeFileSync(path.join(out, 'files', a.file), a._buf);
    for (const [f, buf] of Object.entries(s.files ?? {})) fs.writeFileSync(path.join(out, 'files', f), buf);
    written.push(stem);
  }
  fs.writeFileSync(path.join(out, '_export.json'), `${JSON.stringify({
    format: 'cdc-legacy-export/1', simulated: true, exportedAt: EXPORTED_AT, site: BASE, batch: dm.slug, pages: n, disease: dm.id,
    source: `模擬匯出：依 content/migration/_disease-template.json（標準子頁 ${items.filter((i) => i.derived).length} 項）${manual ? `＋ content/migration/${dm.slug}.json（人工例外 ${items.filter((i) => !i.derived).length} 項）` : ''}＋ 近 ${RECENT_YEARS} 年新聞 ${news.length} 篇合成，不是舊站的真實資料（網址 ID、數字、PDF 內容皆為示意）。正式匯出取代整個目錄即可。`,
    generator: 'scripts/lib/legacy-import/sim-export-disease.mjs',
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(out, 'README.md'), readme(dm, { template: items.filter((i) => i.derived).length, manual: items.filter((i) => !i.derived).length, news: news.length, pages: n }));
  return { dir: out, pages: n, files: fs.readdirSync(path.join(out, 'files')).length, template: items.filter((i) => i.derived).length, manual: items.filter((i) => !i.derived).length, news: news.length, disease: dm.id };
}

const readme = (dm, c) => `# 舊站匯出（模擬）：${dm.name}專區

> **這是模擬匯出。** 開發環境連不到 www.cdc.gov.tw，這 ${c.pages} 頁由 \`scripts/lib/legacy-import/sim-export-disease.mjs\` 依**標準疾病頁模板**（\`content/migration/_disease-template.json\`，${c.template} 項）＋**人工例外清單**（\`content/migration/${dm.slug}.json\`，${c.manual} 項）＋近三年新聞 ${c.news} 篇合成：HTML 長得像舊站（Bootstrap 版型外殼、麵包屑、側欄、Word 貼上的 \`span／mso\` 樣式、表格、附件連結、圖片、Q&A 手風琴），內文反推自既有的${dm.name}內容，網址中的 ID、統計數字、PDF 內容都是示意。**正式匯出取代整個目錄即可**，不需要改程式。

與結核病首批（逐頁手寫規格）不同，這份是模板驅動的：任何有疾病頁的疾病都能用同一支程式產出。

## 重新產生

\`\`\`
node scripts/lib/legacy-import/sim-export-disease.mjs ${dm.id} data/legacy-export/${dm.slug}
\`\`\`

## 匯出格式

與結核病批次相同，見 \`data/legacy-export/tuberculosis/README.md\` 與 \`docs/legacy-import.md\` 第 2 節。

## 轉換

\`\`\`
node scripts/import-legacy.mjs data/legacy-export/${dm.slug} --out data/legacy-import/${dm.slug} --apply-migration
\`\`\`
`;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const ref = process.argv[2];
  if (!ref) { console.error('用法：node scripts/lib/legacy-import/sim-export-disease.mjs <disease.id|slug> [輸出目錄]'); process.exit(2); }
  const slug = ref.replace(/^disease\./, '');
  const r = generateDisease(ref, process.argv[3] ?? path.join(ROOT, 'data/legacy-export', slug));
  console.log(`模擬匯出 ${r.disease}：${r.pages} 頁（模板 ${r.template}、人工例外 ${r.manual}、近年新聞 ${r.news}）、files/ ${r.files} 個檔 → ${path.relative(ROOT, r.dir)}`);
}
