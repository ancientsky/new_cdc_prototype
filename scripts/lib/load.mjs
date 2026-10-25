// 讀取 content/ 與 data/snapshots/ → site.collections（第七輪加 jobs、tenders；＋ site.migrationLists：content/migration/*.json；
// 底線開頭的 content/migration/_*.json 是模板 → site.migrationTemplates，ARCHITECTURE 14.1）
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { normalizeCategory, DEFAULT_CATEGORIES } from '../../src/client/bulletin-rules.js';
import { sourcePickOf } from '../../src/client/source-pick.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const CONTENT = path.join(ROOT, 'content');
export const SNAPSHOTS = path.join(ROOT, 'data', 'snapshots');

export function readJSON(p, fallback = undefined) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) {
    if (fallback !== undefined) return fallback;
    throw new Error(`讀取 JSON 失敗 ${path.relative(ROOT, p)}: ${e.message}`);
  }
}

function readDirJSON(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => {
      const item = readJSON(path.join(dir, f));
      item.__file = path.relative(ROOT, path.join(dir, f));
      return item;
    });
}

/**
 * 來源語言正本的內容雜湊（翻譯過期偵測）。只取頂層欄位＝來源語言（item.sourceLang，預設 zh-TW）的文字；
 * i18n（含 sourceLang≠zh-TW 時的 i18n['zh-TW']）不參與，所以譯文更新不會讓其他語言過期（ARCHITECTURE 14.2）。
 */
export function sourceHashOf(item) {
  // 欄位清單在 src/client/source-pick.js（第五十一輪：後台修改已上架內容時也要用同一份判斷「有沒有改到正本」）
  return createHash('sha1').update(JSON.stringify(sourcePickOf(item))).digest('hex').slice(0, 12);
}

export function loadSite(config) {
  const master = {
    units: readJSON(path.join(CONTENT, 'master/units.json')),
    diseases: readJSON(path.join(CONTENT, 'master/diseases.json')),
    vaccines: readJSON(path.join(CONTENT, 'master/vaccines.json'), []),
    // 疫苗接種時程表（時程地圖與答案引擎的年齡查詢用；ARCHITECTURE 18.1）
    immunizationSchedule: readJSON(path.join(CONTENT, 'master/immunization-schedule.json'), []),
    countries: readJSON(path.join(CONTENT, 'master/countries.json'), []),
    glossary: readJSON(path.join(CONTENT, 'master/glossary.json'), []),
    reviewPeriods: readJSON(path.join(CONTENT, 'master/review-periods.json')),
    // 第三十五輪：疫情報導分類主檔（官網左側分類；後台「分類管理」可加）；沒有檔時用 bulletin-rules 的預設
    bulletinCategories: readJSON(path.join(CONTENT, 'master/bulletin-categories.json'), DEFAULT_CATEGORIES),
    // 第四十九輪：檢驗檢體用語對照（受控詞彙，機器初稿）；/lab/ 的外語頁用，沒有檔就整頁維持中文
    labTerms: readJSON(path.join(CONTENT, 'master/lab-terms.json'), { terms: {} }),
  };
  const collections = {
    diseases: readDirJSON(path.join(CONTENT, 'diseases')),
    faq: readDirJSON(path.join(CONTENT, 'faq')),
    news: readDirJSON(path.join(CONTENT, 'news')),
    documents: readDirJSON(path.join(CONTENT, 'documents')),
    clarifications: readDirJSON(path.join(CONTENT, 'clarifications')),
    vaccines: readDirJSON(path.join(CONTENT, 'vaccines')),
    datasets: readDirJSON(path.join(CONTENT, 'datasets')),
    banners: readDirJSON(path.join(CONTENT, 'banners')),
    pages: readDirJSON(path.join(CONTENT, 'pages')),
    media: readDirJSON(path.join(CONTENT, 'media')),
    topics: readDirJSON(path.join(CONTENT, 'topics')),
    services: readDirJSON(path.join(CONTENT, 'services')),
    publications: readDirJSON(path.join(CONTENT, 'publications')),
    labtests: readDirJSON(path.join(CONTENT, 'labtests')),
    research: readDirJSON(path.join(CONTENT, 'research')),
    // 第二十九輪（ARCHITECTURE 34）：疫情報導文章，一篇一檔；卷期頁由 issueId 相同的文章自動組成
    articles: readDirJSON(path.join(CONTENT, 'articles')).map((a) => (a.articleType ? { ...a, articleType: normalizeCategory(a.articleType) } : a)), // 舊代號（outbreak-report…）對應到分類主檔
    // 第七輪（ARCHITECTURE 15.1）：人才招募（人事室）與採購公告（秘書室）
    jobs: readDirJSON(path.join(CONTENT, 'jobs')),
    tenders: readDirJSON(path.join(CONTENT, 'tenders')),
    // 第六十輪（Issue #127）：節慶主題（公關室；有生效區間的頁首裝飾，不是頁面：不進索引、sitemap、目錄。scripts/lib/theme.mjs）
    themes: readDirJSON(path.join(CONTENT, 'themes')),
  };
  for (const list of Object.values(collections)) for (const item of list) item.sourceHash = sourceHashOf(item);

  const situation = readJSON(path.join(CONTENT, 'situation/current.json'));
  situation.history = readDirJSON(path.join(CONTENT, 'situation/history'));
  const governance = {
    aiStatus: readJSON(path.join(CONTENT, 'governance/ai-status.json')),
    whitelist: readJSON(path.join(CONTENT, 'governance/whitelist.json')),
    // 第三十三輪：跨內容說法不一致的判定（scripts/lib/consistency.mjs、guide-staff §37）
    consistency: readJSON(path.join(CONTENT, 'governance/consistency.json'), { version: 1, decisions: [] }),
    evalSet: readJSON(path.join(CONTENT, 'governance/eval-set.json'), { version: '0', questions: [] }),
  };
  const snapshots = {
    travelAlerts: readJSON(path.join(SNAPSHOTS, 'travel-epidemic.json'), { meta: { mode: 'missing' }, data: [] }),
    countryLevels: readJSON(path.join(SNAPSHOTS, 'country-epid-level.json'), { meta: { mode: 'missing' }, data: [] }),
    // 旅遊疫情建議事件流（ARCHITECTURE 12.1；kind：new／raised／lowered／lifted／renewed）
    countryEvents: readJSON(path.join(SNAPSHOTS, 'country-epid-events.json'), { meta: { mode: 'missing' }, data: [] }),
    ckan: readJSON(path.join(SNAPSHOTS, 'ckan-packages.json'), { meta: { mode: 'missing' }, data: [] }),
    // 第四十三輪：國際重要疫情資訊匯入紀錄（scripts/lib/intl-epidemic.mjs；治理引擎據此產生 intl-feed-held／intl-feed-unmapped 待辦）
    intlImport: readJSON(path.join(SNAPSHOTS, 'intl-epidemic-import.json'), { version: 1, lastRun: null, history: [] }),
    // 第五十七輪：登革熱地圖 summary＋manifest 子集（scripts/fetch-data.mjs 的 importDenguemap；疾病頁疫情小卡讀它，過期規則在 _denguemap.mjs）
    denguemap: readJSON(path.join(SNAPSHOTS, 'denguemap-summary.json'), { mode: 'missing', fetchedAt: null, sourceUrl: null, manifest: null, summary: null }),
  };
  // 移轉清單（ARCHITECTURE 13.1）：舊站專區 → 新站內容的逐頁對照。不是對外內容頁，不放進 collections／all
  // （不進索引、sitemap、白名單、KPI）；治理引擎據此算 site.migration 與 item.gov.legacy。
  // 第六輪（14.1）：底線開頭的檔案是模板（type migration-template），由治理引擎對主檔每種疾病推導清單。
  const migrationFiles = readDirJSON(path.join(CONTENT, 'migration'));
  const isTemplateFile = (x) => path.basename(x.__file ?? '').startsWith('_') || x.type === 'migration-template';
  const migrationLists = migrationFiles.filter((x) => !isTemplateFile(x));
  const migrationTemplates = migrationFiles.filter(isTemplateFile);
  const all = Object.values(collections).flat();
  const byId = new Map(all.map((i) => [i.id, i]));
  const unitById = new Map(master.units.map((u) => [u.id, u]));
  const diseaseMasterById = new Map(master.diseases.map((d) => [d.id, d]));
  return { config, master, collections, migrationLists, migrationTemplates, situation, governance, snapshots, all, byId, unitById, diseaseMasterById };
}
