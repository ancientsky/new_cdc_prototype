// 讀取 content/ 與 data/snapshots/ → site.collections（第七輪加 jobs、tenders；＋ site.migrationLists：content/migration/*.json；
// 底線開頭的 content/migration/_*.json 是模板 → site.migrationTemplates，ARCHITECTURE 14.1）
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

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
  const pick = {
    title: item.title, summary: item.summary, question: item.question, answerMarkdown: item.answerMarkdown,
    bodyMarkdown: item.bodyMarkdown, blocks: item.blocks, keyFacts: item.keyFacts, machineReadableMarkdown: item.machineReadableMarkdown,
    clarificationMarkdown: item.clarificationMarkdown, claim: item.claim, publicFunded: item.publicFunded, headline: item.headline,
    transcriptMarkdown: item.transcriptMarkdown, introMarkdown: item.introMarkdown, steps: item.steps, abstractMarkdown: item.abstractMarkdown, specimens: item.specimens, articles: item.articles,
    // 連結檢查寫回的欄位（lastCheckedAt、status）不算內容變更，剔除後再雜湊
    links: item.links?.map(({ lastCheckedAt, status, ...rest }) => rest),
    forms: item.forms?.map(({ lastCheckedAt, status, ...rest }) => rest),
    // 第七輪（ARCHITECTURE 15.1）：職缺與採購公告的正文欄位（不含 result／waitlistUpdates／award：結果公告不影響譯文）
    duties: item.duties, qualifications: item.qualifications, requiredDocuments: item.requiredDocuments, salaryNote: item.salaryNote, workplace: item.workplace,
    scope: item.scope, specialTerms: item.specialTerms,
  };
  return createHash('sha1').update(JSON.stringify(pick)).digest('hex').slice(0, 12);
}

export function loadSite(config) {
  const master = {
    units: readJSON(path.join(CONTENT, 'master/units.json')),
    diseases: readJSON(path.join(CONTENT, 'master/diseases.json')),
    vaccines: readJSON(path.join(CONTENT, 'master/vaccines.json'), []),
    countries: readJSON(path.join(CONTENT, 'master/countries.json'), []),
    glossary: readJSON(path.join(CONTENT, 'master/glossary.json'), []),
    reviewPeriods: readJSON(path.join(CONTENT, 'master/review-periods.json')),
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
    // 第七輪（ARCHITECTURE 15.1）：人才招募（人事室）與採購公告（秘書室）
    jobs: readDirJSON(path.join(CONTENT, 'jobs')),
    tenders: readDirJSON(path.join(CONTENT, 'tenders')),
  };
  for (const list of Object.values(collections)) for (const item of list) item.sourceHash = sourceHashOf(item);

  const situation = readJSON(path.join(CONTENT, 'situation/current.json'));
  situation.history = readDirJSON(path.join(CONTENT, 'situation/history'));
  const governance = {
    aiStatus: readJSON(path.join(CONTENT, 'governance/ai-status.json')),
    whitelist: readJSON(path.join(CONTENT, 'governance/whitelist.json')),
    evalSet: readJSON(path.join(CONTENT, 'governance/eval-set.json'), { version: '0', questions: [] }),
  };
  const snapshots = {
    travelAlerts: readJSON(path.join(SNAPSHOTS, 'travel-epidemic.json'), { meta: { mode: 'missing' }, data: [] }),
    countryLevels: readJSON(path.join(SNAPSHOTS, 'country-epid-level.json'), { meta: { mode: 'missing' }, data: [] }),
    // 旅遊疫情建議事件流（ARCHITECTURE 12.1；kind：new／raised／lowered／lifted／renewed）
    countryEvents: readJSON(path.join(SNAPSHOTS, 'country-epid-events.json'), { meta: { mode: 'missing' }, data: [] }),
    ckan: readJSON(path.join(SNAPSHOTS, 'ckan-packages.json'), { meta: { mode: 'missing' }, data: [] }),
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
