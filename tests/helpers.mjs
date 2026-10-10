// 測試共用：載入站台、注入合成內容、記憶體 write。（不以 .test.mjs 結尾，不會被 node --test 直接執行）
import { config } from '../site.config.mjs';
import { loadSite, sourceHashOf } from '../scripts/lib/load.mjs';
import { applyGovernance } from '../scripts/lib/governance.mjs';

const COLLECTION_OF = { disease: 'diseases', faq: 'faq', news: 'news', letter: 'news', document: 'documents', clarification: 'clarifications', vaccine: 'vaccines', dataset: 'datasets', banner: 'banners', page: 'pages', media: 'media', topic: 'topics', service: 'services', publication: 'publications', labtest: 'labtests', research: 'research', job: 'jobs', tender: 'tenders', article: 'articles' };
const ID_PREFIX = { document: 'doc', publication: 'pub', labtest: 'lab', article: 'article' };
const LONG_TRANSCRIPT = '（旁白）出現發燒、頭痛、後眼窩痛、肌肉關節痛等症狀，請儘速就醫並告知醫師旅遊史。清除積水容器，落實巡、倒、清、刷，是預防登革熱最有效的方法。';

/** 建一筆合成內容（共同欄位齊全） */
export function mk(over = {}) {
  const type = over.type ?? 'faq';
  const base = {
    id: `${ID_PREFIX[type] ?? type}.test-${Math.random().toString(36).slice(2, 8)}`, type, title: '測試內容', owner: 'unit.acute-infectious',
    publishedAt: '2024-01-01', reviewedAt: '2026-09-01', reviewPeriodMonths: 6, status: 'published', audience: ['public'], sensitivity: 'public', license: 'OGDL-1.0',
    languages: { 'zh-TW': { status: 'source' } }, summary: '測試摘要', aiWhitelist: { requested: true, approvedBy: 'unit.oasis', approvedAt: '2026-09-01' },
  };
  if (type === 'faq') Object.assign(base, { question: over.title ?? '測試問題？', answerMarkdown: '測試答案。' });
  if (type === 'news') Object.assign(base, { newsType: 'press', bodyMarkdown: '測試新聞內文。', reviewPeriodMonths: 0 });
  if (type === 'document') Object.assign(base, { docType: 'guideline', machineReadableMarkdown: '# 測試文件\n\n本文件內容足夠長以通過機讀版檢查，這是一段示範文字，請勿引用。' });
  if (type === 'media') Object.assign(base, { mediaType: 'video', producedAt: '2026-01-01', transcriptMarkdown: LONG_TRANSCRIPT, basedOn: ['doc.mmr-recommendation'], durationSeconds: 95, youtubeId: null, chapters: [{ t: 0, label: '開場' }, { t: 30, label: '症狀' }] });
  if (type === 'topic') Object.assign(base, { slug: `t-${Math.random().toString(36).slice(2, 8)}`, kind: 'resource-hub', introMarkdown: '測試專區簡介。', links: [{ label: '站內', href: '/faq/' }] });
  if (type === 'service') Object.assign(base, { slug: `s-${Math.random().toString(36).slice(2, 8)}`, serviceType: 'data-request', whoCanApply: ['研究者'], steps: [{ title: '線上申請', text: '填寫申請表。' }, { title: '審查', days: 10 }], requiredDocuments: ['申請書'], slaDays: 14 });
  if (type === 'publication') Object.assign(base, { series: '疫情報導', pubType: 'bulletin', volume: 42, issue: 18, issn: '1818-6858', reviewPeriodMonths: 0, abstractMarkdown: '本期摘要。' });
  if (type === 'labtest') Object.assign(base, { disease: 'disease.dengue', audience: ['professional'], specimens: [{ name: '急性期血清', container: '無菌試管', volume: '2–5 mL', storage: '4°C', transport: '4°C 冷藏 48 小時內送達', timing: '發病 7 日內', tests: ['RT-PCR', 'NS1'] }], labs: ['cdc-lab'], sendWithinHours: 24, reviewPeriodMonths: 12 });
  if (type === 'article') Object.assign(base, { issueId: 'publication.bulletin-42-13', articleNo: 9, articleType: 'original', authors: [{ name: '測試單位', unit: '疫情中心' }], pages: '90-95', reviewPeriodMonths: 0, abstractMarkdown: '測試摘要段落。', sections: [{ key: 'intro', heading: '前言', markdown: '測試前言。' }, { key: 'methods', heading: '方法', markdown: '測試方法。' }] });
  if (type === 'research') Object.assign(base, { year: 2026, projectStatus: 'ongoing', fundingType: 'commissioned', piUnit: '測試大學公共衛生學院', abstractMarkdown: '研究摘要。', audience: ['professional'], reviewPeriodMonths: 12, projectNo: 'MOHW115-CDC-C-001' });
  return { ...base, ...over };
}

/** 把合成內容加進 site（collections、all、byId） */
export function addItem(site, item) {
  item.__file = `test/${item.id}.json`;
  item.sourceHash = sourceHashOf(item);
  const col = COLLECTION_OF[item.type];
  (site.collections[col] ??= []).push(item);
  site.all.push(item);
  site.byId.set(item.id, item);
  return item;
}

/** 載入站台 → 可選 mutate → 治理 */
export function govern(today = '2026-10-01', mutate) {
  const site = loadSite(config);
  site.today = today;
  if (mutate) mutate(site);
  applyGovernance(site);
  return site;
}

/** 記憶體 write：回傳 { write, files: Map } */
export function memWriter() {
  const files = new Map();
  return { files, write: (rel, content) => files.set(rel, String(content)) };
}

export { config };
