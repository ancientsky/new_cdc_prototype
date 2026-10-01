// 測試共用：載入站台、注入合成內容、記憶體 write。（不以 .test.mjs 結尾，不會被 node --test 直接執行）
import { config } from '../site.config.mjs';
import { loadSite, sourceHashOf } from '../scripts/lib/load.mjs';
import { applyGovernance } from '../scripts/lib/governance.mjs';

const COLLECTION_OF = { disease: 'diseases', faq: 'faq', news: 'news', letter: 'news', document: 'documents', clarification: 'clarifications', vaccine: 'vaccines', dataset: 'datasets', banner: 'banners', page: 'pages' };

/** 建一筆合成內容（共同欄位齊全） */
export function mk(over = {}) {
  const type = over.type ?? 'faq';
  const base = {
    id: `${type === 'document' ? 'doc' : type}.test-${Math.random().toString(36).slice(2, 8)}`, type, title: '測試內容', owner: 'unit.vaccine',
    publishedAt: '2024-01-01', reviewedAt: '2026-09-01', reviewPeriodMonths: 6, status: 'published', audience: ['public'], sensitivity: 'public', license: 'OGDL-1.0',
    languages: { 'zh-TW': { status: 'source' } }, summary: '測試摘要', aiWhitelist: { requested: true, approvedBy: 'unit.oasis', approvedAt: '2026-09-01' },
  };
  if (type === 'faq') Object.assign(base, { question: over.title ?? '測試問題？', answerMarkdown: '測試答案。' });
  if (type === 'news') Object.assign(base, { newsType: 'press', bodyMarkdown: '測試新聞內文。', reviewPeriodMonths: 0 });
  if (type === 'document') Object.assign(base, { docType: 'guideline', machineReadableMarkdown: '# 測試文件\n\n本文件內容足夠長以通過機讀版檢查，這是一段示範文字，請勿引用。' });
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
