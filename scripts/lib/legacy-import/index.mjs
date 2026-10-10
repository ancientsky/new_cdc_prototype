// 舊站匯出批次轉換主流程（ARCHITECTURE 17.3）。
//   runImport({ exportDir, outDir, rulesPath?, applyMigration?, manifestPath?, slug?, contentDir?, now? }) → { report, patch, drafts, outDir }
// 兩階段：
//   1. 逐頁分析（URL 模式、類別→owner、疾病、移轉清單比對）＋抽內容＋轉 Markdown＋宣告資產 ⇒ 「單元」（一頁可產生多個單元：Q&A 每題一筆、疾病子頁併成區塊）
//   2. 組草稿 ⇒ schema 驗證 ⇒ 寫檔 ⇒ report.json／report.md／migration-patch.json（--apply-migration 才寫回清單）
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ROOT, CONTENT, readJSON } from '../load.mjs';
import { config } from '../../../site.config.mjs';
import { readExport } from './reader.mjs';
import {
  loadRules, parseUrl, matchUrlPattern, bulletinType, ownerForCategory, detectDiseases, blockKeyFor, mergeBlockFor, docTypeFor, stripTitlePrefix,
  normTitle, manifestPathRegex, ageYears, shortFor,
} from './rules.mjs';
import { extractPage, rewriteBody, toMd, splitSections, faqItems, bodyChecks, parseDate } from './convert.mjs';
import { tableProblems, plainText, textOf } from './html.mjs';
import { AssetBag, findExportFile } from './assets.mjs';
import { computeConfidence, needsReview, MARKDOWN_WARNING_CODES } from './confidence.mjs';
import { validateDraft } from './validate.mjs';
import { buildPatch, applyPatch, expandTemplateItems } from './migration.mjs';
import { renderReportMd } from './report.mjs';
import { STRUCTURED_TYPES, extractFields, serviceTypeFor, typeOfId, mdLinks } from './types.mjs';
import { faqItemsLoose, tasksFor, datedDeadlines, structuredFromText } from './qa.mjs';
import { countryFor, dynamicForm, vaccineCandidates, referenceMd } from './travel.mjs';
import { materialScope, materialKind, imageOnly, imageOnlyAbstract, imageGallery, langVariants, materialOutdated, externalSystemPage, SITE_LANGS } from './materials.mjs';
import { statScope, periodicalIssues, periodLabel, tableSeries, seriesGaps, statsStale, datasetByUrl, systemEntryHosts } from './statistics.mjs';

const h6 = (s) => createHash('sha1').update(String(s)).digest('hex').slice(0, 6);
const DIRS = { disease: 'diseases', faq: 'faq', news: 'news', document: 'documents', page: 'pages', publication: 'publications', media: 'media', dataset: 'datasets', labtest: 'labtests', service: 'services', clarification: 'clarifications', topic: 'topics', vaccine: 'vaccines', letter: 'news' };
const BLOCK_ORDER = ['what-to-do', 'symptoms', 'transmission', 'prevention', 'treatment', 'vaccine', 'situation', 'faq'];
const CONTENT_DIRS = ['diseases', 'faq', 'news', 'documents', 'clarifications', 'vaccines', 'datasets', 'banners', 'pages', 'media', 'topics', 'services', 'publications', 'labtests', 'research', 'jobs', 'tenders'];
const idRest = (id) => String(id).replace(/^[a-z]+\./, '');
const uniqBy = (arr, f) => { const seen = new Set(); return arr.filter((x) => { const k = f(x); if (seen.has(k)) return false; seen.add(k); return true; }); };

/** content/ 現有內容索引：id → { type, title, owner, file }；另建 faq 標題索引 */
export function loadContentIndex(contentDir = CONTENT) {
  const byId = new Map();
  const faqByTitle = new Map();
  const newsByTitle = new Map();
  for (const d of CONTENT_DIRS) {
    const dir = path.join(contentDir, d);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
      try {
        const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        if (j?.id) {
          // eslint-disable-next-line no-dupe-keys -- family／effectiveAt 重複宣告，後者生效；為保持輸出鍵順序不變暫不刪前者
          byId.set(j.id, { type: j.type, title: j.title, owner: j.owner, file: `content/${d}/${f}`, status: j.status, diseases: [...(j.diseases ?? []), ...(j.basedOn ?? [])], docType: j.docType, family: j.family ?? null, version: j.version ?? null, effectiveAt: j.effectiveAt ?? null, pubType: j.pubType, mediaType: j.mediaType, family: j.family, effectiveAt: j.effectiveAt ?? j.publishedAt,
            // 第十一批：資料集的正本與入口網址（datasetByUrl 依站外連結 host 對既有資料集）
            ...(j.type === 'dataset' ? { canonicalUrl: j.canonicalUrl ?? null, portalUrl: j.portalUrl ?? null } : {}) });
          if (j.type === 'faq') faqByTitle.set(normTitle(j.question ?? j.title), j.id);
          if (j.type === 'news' || j.type === 'letter' || j.type === 'clarification') newsByTitle.set(normTitle(j.title), j.id);
        }
      } catch { /* 壞檔略過；整站驗證會另外報 */ }
    }
  }
  return { byId, faqByTitle, newsByTitle };
}

const summaryOf = (md, title, max = 120) => {
  // 摘要取前面的敘述段落：跳過表格、標題、圖片；第一段太短就接第二段
  const paras = String(md ?? '').split(/\n{2,}/).map((x) => x.trim()).filter((x) => x && !/^(\||#{1,6}\s|!\[|-{3,}$)/.test(x));
  const t = plainText(paras.slice(0, plainText(paras[0] ?? '').length < 40 ? 2 : 1).join('\n\n'));
  if (!t) return title;
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const end = Math.max(cut.lastIndexOf('。'), cut.lastIndexOf('；'), cut.lastIndexOf('！'));
  return end >= 30 ? cut.slice(0, end + 1) : `${cut.slice(0, max - 1)}…`;
};

function parseVersion(title) {
  let m = /第\s*([一二三四五六七八九十百零〇\d]+)\s*版/.exec(title);
  if (m) return `第${m[1]}版`;
  m = /(\d{2,3})\.(\d{1,2})\.(\d{1,2})/.exec(title);
  if (m) return m[0];
  m = /\bv(\d+)\b/i.exec(title);
  if (m) return `v${m[1]}`;
  m = /((?:19|20)\d{2})\s*年(?:版|度)/.exec(title); // 「2023 年版」「2026–2027 年度」；單純日期（2022 年 3 月）不算版次
  if (m) return `${m[1]} 年版`;
  return null;
}

const uniqIssues = (issues) => uniqBy(issues, (i) => `${i.code}|${i.message}`);

// ───── 第七批：文件版次鏈 ─────
const CN_DIGIT = { 零: 0, 〇: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
/** 中文數字（到百位）→ 整數：「十七」17、「二十」20、「一百零三」103 */
export function cnToInt(str) {
  if (/^\d+$/.test(str)) return Number(str);
  let n = 0, cur = 0;
  for (const ch of str) {
    if (ch === '百') { n += (cur || 1) * 100; cur = 0; } else if (ch === '十') { n += (cur || 1) * 10; cur = 0; } else if (ch in CN_DIGIT) cur = CN_DIGIT[ch];
  }
  return n + cur;
}
/** 版次排序用的數字：第 N 版→N、vN→N、YYYY 年版→YYYY、民國 NNN.MM.DD→西元日期數；看不出來→null */
export function versionRank(v) {
  if (!v) return null;
  let m = /第([一二三四五六七八九十百零〇\d]+)版/.exec(v); if (m) return cnToInt(m[1]);
  m = /^v(\d+)$/i.exec(String(v).trim()); if (m) return Number(m[1]);
  m = /((?:19|20)\d{2})\s*年/.exec(v); if (m) return Number(m[1]);
  m = /^(\d{2,3})\.(\d{1,2})\.(\d{1,2})$/.exec(String(v).trim()); if (m) return (Number(m[1]) + 1911) * 10000 + Number(m[2]) * 100 + Number(m[3]);
  return null;
}
/** 去掉版次、年份、日期與括號註記後的標題（正規化），同名即同一文件家族 */
export function versionFree(title) {
  return normTitle(String(title ?? '')
    .replace(/[（(][^）)]*(版|修訂|年|舊版|歷版|v\d+)[^）)]*[）)]/gi, '')
    .replace(/第[一二三四五六七八九十百零〇\d]+版/g, '')
    .replace(/\bv\d+\b/gi, '')
    .replace(/(?:19|20)\d{2}\s*年版?/g, '')
    .replace(/\d{2,3}\.\d{1,2}\.\d{1,2}/g, '')
    .replace(/(?:19|20)\d{2}-\d{2}-\d{2}/g, '')
    .replace(/\d{2,3}\s*年\s*\d{1,2}\s*月(?:\s*\d{1,2}\s*日)?/g, '')
    .replace(/(修訂|公告|核定)?版$/g, ''));
}
/** 從文字抽第一個日期（西元或民國）：「2025 年 9 月 1 日」「114.04.16」「民國 111 年 3 月」「2022-03-01」→ YYYY-MM-DD（缺日補 01） */
export function dateFromText(text) {
  const t = String(text ?? '');
  const pad = (n) => String(n).padStart(2, '0');
  const ok = (y, mo, d) => (y >= 1911 && y <= 2100 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31 ? `${y}-${pad(mo)}-${pad(d)}` : null);
  let m = /((?:19|20)\d{2})-(\d{2})-(\d{2})/.exec(t); if (m) return ok(+m[1], +m[2], +m[3]);
  m = /(?:民國\s*)?(\d{2,4})\s*年\s*(\d{1,2})\s*月(?:\s*(\d{1,2})\s*日)?/.exec(t);
  if (m) { const y = +m[1]; return ok(y < 1911 ? y + 1911 : y, +m[2], m[3] ? +m[3] : 1); }
  m = /(\d{2,3})\.(\d{1,2})\.(\d{1,2})/.exec(t); if (m) return ok(+m[1] + 1911, +m[2], +m[3]);
  return null;
}

/** 網址比對用的鍵：去協定、小寫、去尾斜線（舊站網址大小寫不敏感） */
export const normUrlKey = (u) => String(u ?? '').replace(/^https?:\/\//i, '').replace(/\/+$/, '').toLowerCase();

/** 同一個輸出根目錄下其他批次的 report.json → Map(網址鍵 → [{ batch, key, outputs }…])（同網址可能出現在多批）；沒有就空 Map */
export function loadPriorPages(rootDir, selfOut) {
  const map = new Map();
  if (!rootDir || !fs.existsSync(rootDir)) return map;
  for (const name of fs.readdirSync(rootDir).sort()) {
    const dir = path.join(rootDir, name);
    if (path.resolve(dir) === path.resolve(selfOut)) continue;
    const f = path.join(dir, 'report.json');
    if (!fs.existsSync(f)) continue;
    let r; try { r = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { continue; }
    for (const p of r.pages ?? []) {
      const k = normUrlKey(p.source?.url);
      if (!k) continue;
      if (!map.has(k)) map.set(k, []);
      map.get(k).push({ batch: r.batch ?? name, key: p.key, outputs: (p.outputs ?? []).filter((o) => o.role !== 'duplicate').map((o) => ({ id: o.id, type: o.type })) });
    }
  }
  return map;
}

// ───────────────────────────────────────── 主流程 ─────────────────────────────────────────

export function runImport(opts) {
  const {
    exportDir, outDir, rulesPath, applyMigration = false, manifestPath, contentDir = CONTENT,
    now = new Date().toISOString(), log = () => {},
  } = opts;
  if (!exportDir) throw new Error('缺匯出目錄');
  if (!outDir) throw new Error('缺 --out');
  const rules = loadRules(rulesPath);
  const exp = readExport(exportDir);
  const slug = opts.slug ?? path.basename(path.resolve(exportDir));
  const out = path.resolve(outDir);
  const exportedAt = exp.meta.exportedAt ?? now.slice(0, 10);
  const convertedAt = now;
  const siteBase = rules.siteBase ?? 'https://www.cdc.gov.tw';

  const master = {
    units: readJSON(path.join(contentDir, 'master/units.json'), []),
    diseases: readJSON(path.join(contentDir, 'master/diseases.json'), []),
    periods: readJSON(path.join(contentDir, 'master/review-periods.json'), {}),
    countries: readJSON(path.join(contentDir, 'master/countries.json'), []),
    vaccines: readJSON(path.join(contentDir, 'master/vaccines.json'), []),
  };
  const unitIds = new Set(master.units.filter((u) => u.publishes !== false).map((u) => u.id));
  const diseaseById = new Map(master.diseases.map((d) => [d.id, d]));
  const index = loadContentIndex(contentDir);
  // 第九批：已知疫苗名稱（主檔名稱＋別名＋content/vaccines/ 標題），小節提到主檔沒有的疫苗時提示另建 vaccine
  const knownVaccines = [...master.vaccines.flatMap((v) => [v.name, ...(v.aliases ?? [])]), ...[...index.byId.values()].filter((v) => v.type === 'vaccine').map((v) => v.title)].filter(Boolean);
  // 第八批：其他批次已轉過的頁（同網址）。欄目匯出會把疾病專題的 Q&A 再匯一次，這些頁歸疾病批；這裡讀同一個輸出根目錄下其他批次的 report.json
  const priorPages = loadPriorPages(opts.priorBatchesDir ?? path.dirname(out), out);

  // 移轉清單（選用）
  const mfPath = manifestPath ?? path.join(contentDir, 'migration', `${slug}.json`);
  // 沒有人工清單的疾病（slug 對得到主檔）⇒ 合成一份「只有模板」的清單做推導比對（治理引擎 R15 對每種疾病都這麼做）；合成清單不能 --apply-migration
  const slugDisease = master.diseases.find((d) => d.slug === slug) ?? null;
  const synthetic = !fs.existsSync(mfPath) && slugDisease ? { id: `migration.${slug}`, type: 'migration', title: `${slugDisease.name}（舊站疾病頁）→ 新站（模板推導，尚無人工清單）`, extends: 'migration-template.disease', scope: { kind: 'disease', disease: slugDisease.id }, items: [], synthetic: true } : null;
  const manifest = fs.existsSync(mfPath) ? { path: mfPath, data: JSON.parse(fs.readFileSync(mfPath, 'utf8')) } : synthetic ? { path: mfPath, data: synthetic, synthetic: true } : null;
  const mItems = manifest?.data.items ?? [];
  // 清單只寫例外（extends 模板）時，把模板依該疾病展開成推導項一起比對（治理引擎 R15 的作法）；推導項只進報告，不寫回清單
  const manifestDisease = manifest?.data.scope?.kind === 'disease' ? manifest.data.scope.disease ?? null : null;
  const derivedAll = manifest ? expandTemplateItems({ manifest: manifest.data, contentDir, index, diseaseById }) : [];
  const derivedCovered = derivedAll.filter((d) => d.coveredBy);
  const derivedItems = derivedAll.filter((d) => !d.coveredBy);
  const isPattern = (u) => /\{[a-z]+\}/i.test(String(u));
  const mRegex = [...mItems.map((it) => ({ it, derived: false })), ...derivedItems.map((it) => ({ it, derived: true }))]
    .map((m) => ({ ...m, re: manifestPathRegex(m.it.oldUrl), pattern: isPattern(m.it.oldUrl), frag: (String(m.it.oldUrl).split('#')[1] ?? ''), q: new URLSearchParams(String(m.it.oldUrl).split('#')[0].split('?')[1] ?? '') }));
  const mUsed = new Set();

  fs.rmSync(path.join(out, 'content'), { recursive: true, force: true });
  fs.rmSync(path.join(out, 'reference'), { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });

  const bags = new Map(); // draftId → AssetBag
  const bagOf = (id, stem) => {
    if (!bags.has(id)) bags.set(id, new AssetBag({ draftId: id, outDir: out, filesDir: exp.filesDir, fallbackStem: stem }));
    return bags.get(id);
  };
  const usedIds = new Map(); // draftId → page key（第一個產生者）
  const titleSeen = new Map(); // normTitle → page key
  const units = []; // 組草稿用
  const prs = []; // 每頁一筆報告紀錄

  // 第七批：去版次後同名的頁數（文件家族偵測用）
  const vfCount = new Map();
  for (const page of exp.pages) { const vf = versionFree(stripTitlePrefix(rules, page.side?.title ?? '')); if (vf) vfCount.set(vf, (vfCount.get(vf) ?? 0) + 1); }

  // ───── 第一階段：逐頁 ─────
  for (const page of exp.pages) {
    const side = page.side ?? {};
    const pr = {
      key: page.name, htmlFile: page.htmlFile,
      source: { url: side.url ?? '', title: '', category: side.category ?? '', publishedAt: null, updatedAt: null, breadcrumbs: [], tab: side.tab ?? '' },
      pattern: null, kind: 'page', type: 'page', manifestKey: null, target: null, targetExists: false, targetType: null,
      owner: null, ownerRule: null, diseases: [], issues: [], outputs: [], flags: {}, typeClear: true, attachmentsOk: true, unique: true, manifestDerived: false,
      word: null, stats: { images: 0, links: 0, legacyLinks: 0, attachments: 0 },
    };
    const issue = (code, severity, message) => pr.issues.push({ code, severity, message });
    const addIssues = (list) => { for (const i of list) pr.issues.push(i); };
    prs.push(pr);

    if (page.missingSide) issue('side-missing', 'warn', `缺同名側檔 ${page.name}.json，url／類別／日期無法取得`);
    const u = parseUrl(side.url ?? '', siteBase);
    const pat = side.url ? matchUrlPattern(rules, u) : null;
    const ext = extractPage(rules, page.html);
    const title = (side.title || ext.htmlTitle || page.name).trim();
    const breadcrumbs = side.breadcrumbs?.length ? side.breadcrumbs : ext.breadcrumbs;
    const publishedAt = side.publishedAt ?? ext.updatedAt ?? null;
    const updatedAt = side.updatedAt ?? ext.updatedAt ?? publishedAt;
    const tab = side.tab ?? u.hash ?? '';
    Object.assign(pr.source, { title, breadcrumbs, publishedAt: publishedAt ?? exportedAt, updatedAt, tab });
    if (!publishedAt) issue('date-missing', 'warn', `缺發布日，暫用匯出日 ${exportedAt}`);
    pr.word = ext.word;
    if (ext.word.elements) issue('word-cleaned', 'info', `清除 Word 貼上殘留 ${ext.word.elements} 處（mso 樣式 ${ext.word.styles}、Mso 類別 ${ext.word.classes}、命名空間標籤 ${ext.word.namespaced}）`);

    // 類別 → owner
    const category = side.category ?? '';
    const own = ownerForCategory(rules, category, breadcrumbs);
    const ds = detectDiseases(rules, master.diseases, [breadcrumbs.join('／'), title]);
    if (!ds.length && manifestDisease && diseaseById.has(manifestDisease)) {
      ds.push({ id: manifestDisease, hit: '(清單 scope)' });
      issue('disease-from-manifest', 'info', `麵包屑與標題看不出疾病，依移轉清單 scope 視為 ${diseaseById.get(manifestDisease)?.name ?? manifestDisease}`);
    }
    pr.diseases = ds.map((d) => d.id);
    // 第十批：素材頁（類別／麵包屑含 materialScopes）與它依標題／麵包屑看得出的素材型別（publication／media）
    const matScope = materialScope(rules, { category, breadcrumbs });
    const matKind0 = matScope ? materialKind(rules, { title, category, breadcrumbs }) : null;
    // 第十一批：統計頁（類別／麵包屑含 statScopes：統計專區、統計資料、Data & Statistics）
    const stScope = statScope(rules, { category, breadcrumbs });
    let owner = own?.owner ?? null;
    // 致醫界通函（第六批）：欄目雖歸公關室，通函的權責是該疾病的業務組（規則 categoryOwners.preferDiseaseFor: ["letter"]）
    const bt0 = bulletinType(rules, side.url);
    const letterHit = bt0?.newsType === 'letter' || (rules.letterTitle ? new RegExp(rules.letterTitle).test(title) : false);
    const ownRule = (rules.categoryOwners ?? []).find((c) => c.match === own?.rule);
    if (owner && letterHit && ownRule?.preferDiseaseFor?.includes('letter') && ds[0] && diseaseById.get(ds[0].id)?.owner) {
      owner = diseaseById.get(ds[0].id).owner;
      issue('owner-from-disease', 'info', `致醫界通函的權責單位依疾病主檔取 ${owner}（${diseaseById.get(ds[0].id)?.name ?? ds[0].id}），不歸新聞欄目的公關室`);
    }
    // 第十批：宣導素材欄目歸公關室，但有疾病的素材（海報、影片）權責是該疾病的業務組（規則 categoryOwners.preferDiseaseFor: ["material"]）
    if (owner && matKind0 && ownRule?.preferDiseaseFor?.includes('material') && ds[0] && diseaseById.get(ds[0].id)?.owner && diseaseById.get(ds[0].id).owner !== owner) {
      owner = diseaseById.get(ds[0].id).owner;
      issue('owner-from-disease', 'info', `素材的權責單位依疾病主檔取 ${owner}（${diseaseById.get(ds[0].id)?.name ?? ds[0].id}），不歸宣導素材欄目的公關室`);
    }
    if (!owner && rules.ownerFallbackToDisease && ds[0]) {
      owner = diseaseById.get(ds[0].id)?.owner ?? null;
      if (owner) issue('owner-from-disease', 'info', `類別「${category || '（無）'}」沒有對應規則，權責單位依疾病主檔取 ${owner}（${diseaseById.get(ds[0].id)?.name ?? ds[0].id}）`);
    }
    pr.ownerRule = own?.rule ?? (owner ? 'disease-fallback' : null);
    if (!owner) {
      issue('unmapped-category', 'warn', `未對應類別「${category || '（無）'}」：規則檔 categoryOwners 沒有對應的權責單位，暫填 ${rules.defaultOwner ?? 'unit.oasis'}，請補規則或人工指定`);
      owner = rules.defaultOwner ?? 'unit.oasis';
    }
    pr.owner = owner;
    pr.ownerMapped = !!pr.ownerRule;
    // 第八批：疾病專題的 Q&A 頁在欄目匯出裡會再出現一次（同網址）；它的「家」是該疾病的批次，疾病批已轉過就不重複出草稿，也不參與本批的清單比對（免得搶走別的清單項目）
    // 第九批：不綁疾病的主題頁（例如國際旅遊欄目裡複製的「國際旅遊常見問答」）的家由規則檔 homeBatches 依頁型決定（faq → qa 批）；本批永遠不讓給自己。
    // 目前只對 faq 啟用：news／document 也有欄目重複匯出的情形，但比對方式（標題、版次）不同，留待之後再開
    // 第十批：宣導素材欄目會把疾病專題的素材頁（海報、影片）再匯一次 ⇒ materialKind 命中的素材頁（欄目內頁或清單頁網址）也比照：
    // 有疾病 ⇒ 家批＝疾病 slug；沒有疾病 ⇒ 家是本批（不讓）
    const matDup = !!matKind0 && ['page', 'list'].includes(pat?.kind);
    // 第十一批：統計專區會把疾病專題的「統計資料」頁再匯一次 ⇒ 有疾病的統計頁也比照（家批＝疾病 slug；沒有疾病 ⇒ 家是本批）
    const statDup = stScope && !!ds[0] && ['page', 'list'].includes(pat?.kind);
    if ((pat?.kind === 'faq' || matDup || statDup) && side.url) {
      const home = ds[0] ? diseaseById.get(ds[0].id)?.slug ?? null : pat.kind === 'faq' ? rules.homeBatches?.[pat.kind] ?? null : null;
      const prior = home && home !== slug ? (priorPages.get(normUrlKey(side.url)) ?? []).find((x) => x.batch === home) : null;
      if (prior) {
        pr.flags.convertedElsewhere = { batch: prior.batch, key: prior.key };
        const dupType = pat.kind === 'faq' ? 'faq' : prior.outputs[0]?.type ?? matKind0?.type ?? 'dataset';
        pr.kind = dupType; pr.type = dupType; pr.pattern = pat.id;
        issue('converted-elsewhere', 'info', `同網址的頁已在 ${prior.batch} 批（${prior.key}）轉過，草稿 ${prior.outputs.map((o) => o.id).join('、') || '（無）'}；本批不重複出草稿，內容若有更新請在該批重跑`);
        for (const o of prior.outputs) pr.outputs.push({ id: o.id, type: o.type, role: 'duplicate', duplicateOf: `${prior.batch}/${prior.key}` });
        pr.issues = uniqIssues(pr.issues);
        continue;
      }
    }

    // 移轉清單比對
    let mi = null;
    if (manifest && side.url) {
      // 候選：路徑（{id} 佔位＝任一 ID）與 query 相符；人工項目排在推導項之前
      const cands = mRegex.filter((m) => !mUsed.has(`${m.derived ? 'd:' : ''}${m.it.key}`) && m.re.test(u.path)
        && [...m.q.keys()].filter((k) => k.toLowerCase() !== 'page' && !/^\{/.test(m.q.get(k))).every((k) => u.query.get(k) === m.q.get(k)));
      const byTab = cands.filter((m) => m.frag && m.frag === tab);
      const nt = normTitle(stripTitlePrefix(rules, title));
      // 去掉疾病名後再比一次：舊頁標題常是「登革熱 Q&A」，模板項只寫「Q&A」
      const dnames = ds.flatMap((d) => [diseaseById.get(d.id)?.name, ...(diseaseById.get(d.id)?.aliases ?? [])]).filter(Boolean);
      const ntBare = dnames.reduce((acc, n) => acc.split(normTitle(n)).join(''), nt);
      const byTitle = cands.filter((m) => { const o = normTitle(stripTitlePrefix(rules, m.it.oldTitle)); return o === nt || (o && o === ntBare); });
      const byTitleLoose = cands.filter((m) => { const o = normTitle(stripTitlePrefix(rules, m.it.oldTitle)); return o.length >= 3 && nt.length >= 3 && (o.includes(nt) || nt.includes(o)); });
      // {id} 佔位的網址會命中同一模式下的所有頁，所以只有 fragment 或標題也對得上才算；寫死 ID 的網址（只剩一個候選）才可直接採用
      const exact = cands.filter((m) => !m.pattern);
      // 模板推導的文件項（工作手冊、病例定義、治療指引）標題是通稱，舊頁標題是正式名稱（「…作業手冊」「…防治工作指引」），
      // 改用語意對：舊頁是文件型、標題看得出文件種類、且與推導項 mapTo.docType 相同
      // 模板項的 oldTitle 其實是舊站選單的「位置」（治療指引、工作手冊…），舊頁的最後一層麵包屑就是這個位置 ⇒ 位置相同即對應
      const crumbLast = normTitle(stripTitlePrefix(rules, breadcrumbs.at(-1) ?? ''));
      const byCrumb = crumbLast.length >= 2 ? cands.filter((m) => m.derived && normTitle(stripTitlePrefix(rules, m.it.oldTitle)) === crumbLast) : [];
      let dtHere = pat?.kind === 'document' ? docTypeFor(rules, title, pat, u) : null;
      if (dtHere && !dtHere.clear && breadcrumbs.length) { const byC = docTypeFor(rules, breadcrumbs.slice(-2).join('／'), null, u); if (byC.clear) dtHere = byC; }
      const byDocType = dtHere?.clear ? cands.filter((m) => m.derived && m.it.mapTo?.kind === 'related' && m.it.mapTo.type === 'document' && m.it.mapTo.docType === dtHere.docType) : [];
      const pick = byTab[0] ?? byTitle[0] ?? byTitleLoose[0] ?? (exact.length === 1 ? exact[0] : null) ?? byCrumb[0] ?? byDocType[0] ?? null;
      mi = pick?.it ?? null;
      pr.manifestDerived = !!pick?.derived;
      if (pick) mUsed.add(`${pick.derived ? 'd:' : ''}${pick.it.key}`);
      const ambiguous = !mi && cands.filter((m) => m.pattern).length;
      if (ambiguous) issue('manifest-ambiguous', 'info', `網址符合清單 ${ambiguous} 個 {id} 佔位項目的模式，但標題與分頁都對不上，不視為對應（避免錯配）`);
    }
    if (mi) {
      pr.manifestKey = mi.key; pr.target = mi.target ?? null;
      pr.manifestStatus = mi.status;
      if (mi.target) { const t = index.byId.get(mi.target); pr.targetExists = !!t; pr.targetType = t?.type ?? typeOfId(mi.target); }
    } else if (manifest) issue('not-in-manifest', 'warn', `移轉清單裡找不到對應的舊頁（建議新增一筆 pending 項目${derivedItems.length ? '；模板推導的標準子頁也沒對上' : ''}）`);
    if (pr.manifestDerived) issue('manifest-derived', 'info', `對到的是模板推導項 ${mi.key}（清單只寫例外），結果列在 migration-patch.json 的 derivedItems，不寫回清單`);

    // 第九批：資料產生頁（國際旅遊處方箋國家頁）：新站 /travel/{ISO2}/ 由每日資料快照產生，不轉內文、不出草稿；
    // 舊內文另存 reference/{pageKey}.md 供承辦人比對產生頁有沒有漏掉衛教文字。看不出國家 ⇒ 退回一般 page 草稿
    let generatedFallback = false;
    if (pat?.kind === 'generated') {
      const c = countryFor(master.countries, { query: u.query, title, breadcrumbs });
      if (c) {
        const newPath = String(pat.newPath ?? '/travel/{ISO2}/').replace('{ISO2}', c.iso2);
        pr.flags.generated = { iso2: c.iso2, newPath };
        pr.kind = 'generated'; pr.type = pat.type ?? 'page'; pr.pattern = pat.id;
        issue('generated-page', 'info', `新站 ${newPath} 由每日資料快照自動產生（國家 ${c.name}，${c.from === 'query' ? `網址 ${c.hit}` : `${c.from === 'title' ? '標題' : '麵包屑'}「${c.hit}」`}），不出草稿；舊網址請 301 到 ${newPath}，舊內文存 reference/${page.name}.md 供比對`);
        // 舊內文轉 Markdown：連結與圖片改成舊站絕對網址（不宣告資產，對照檔不上架）
        const pageUrl = u.origin ? `${u.origin}${u.rawPath}${u.search}` : siteBase;
        rewriteBody(ext.body, { siteBase, pageUrl, onImage: ({ src, alt }) => ({ src: new URL(src, pageUrl).href, alt }), onLink: () => null });
        const { markdown } = toMd(ext.body.children);
        const rel = `reference/${page.name}.md`;
        fs.mkdirSync(path.join(out, 'reference'), { recursive: true });
        fs.writeFileSync(path.join(out, rel), referenceMd({ title, url: side.url, iso2: c.iso2, newPath, markdown, exportedAt }));
        pr.reference = rel;
        pr.issues = uniqIssues(pr.issues);
        continue;
      }
      generatedFallback = true;
      issue('country-unknown', 'warn', `資料產生頁（${pat.label ?? pat.id}），但網址 query 與標題、麵包屑都對不到國家主檔，退回一般 page 草稿；請人工判斷對應的 ${pat.newPath ?? '/travel/{ISO2}/'}`);
    }

    // 側檔附件（第十一批移到型別判斷之前：統計頁依附件期別判斷是不是期刊）
    const attList = (side.attachments ?? []).map((a) => ({ ...a, file: a.file ?? decodeURIComponent(path.basename(parseUrl(a.url, siteBase).rawPath)) }));
    const attByPath = new Map();
    for (const a of attList) { const pu = parseUrl(a.url, siteBase); attByPath.set(`${pu.path}${pu.search}`.toLowerCase(), a); attByPath.set(pu.path.toLowerCase(), a); }
    pr.stats.attachments = attList.length;

    // 型別判斷
    const patKind = generatedFallback ? 'page' : pat?.kind ?? 'page';
    pr.pattern = pat?.id ?? null;
    let kind = patKind;
    let blockKey = null;
    let primary = ds[0]?.id ?? null;
    pr.typeClear = !!pat && pat.typeClear !== false && !generatedFallback;
    if (!pat) issue('type-unclear', 'warn', `網址「${side.url || '（空）'}」不符任何 URL 模式，暫以 page 處理`);
    if (kind === 'page' && pat?.mergeable && primary) {
      const k = mergeBlockFor(rules, { title, breadcrumbs, category });
      if (k) { kind = 'disease-block'; blockKey = k; }
    }
    if (kind === 'disease-block' && !blockKey) blockKey = blockKeyFor(rules, title) ?? (tab ? blockKeyFor(rules, tab) : null);
    if (kind === 'disease-block' && !primary) { kind = 'page'; pr.typeClear = false; issue('type-unclear', 'warn', '疾病頁子頁，但從麵包屑與標題找不到疾病，改以 page 處理'); }
    // 欄目內頁（MPage／Page）但移轉清單說它對應的是新站的一份文件 ⇒ 草稿直接建成 document（同 target id），不再以 page 暫存
    // 清單判定「併入」某份文件或疫苗頁（文字要人工併進目標）⇒ 草稿以 page 暫存、不搶目標 id；併入結構化型別（檢驗、資料集、服務…）則照目標型別建草稿供逐欄比對
    const mergedInto = pr.manifestStatus === 'merged' && pr.target && ['document', 'vaccine', 'topic', 'page'].includes(pr.targetType);
    if (mergedInto && kind !== 'disease-block') issue('merge-into-target', 'info', `清單判定併入 ${pr.target}（${pr.targetType}），草稿以 page 暫存，請人工把內容併進目標後刪除草稿`);
    if (kind === 'page' && !mergedInto && pr.targetExists && pr.targetType === 'document' && pat?.id !== 'category-list') {
      kind = 'document';
      issue('type-from-manifest', 'info', `清單對應的新站內容是文件 ${pr.target}，草稿依清單建成 document（舊頁本身是欄目內頁）`);
    }
    // 結構化型別直接產（第四批）：清單目標或模板推導項說新站是 publication／media／dataset／labtest／service／clarification ⇒ 草稿就建成那個型別
    const mapType = mi?.mapTo?.kind === 'related' ? mi.mapTo.type : null;
    const wantType = STRUCTURED_TYPES.has(pr.targetType) ? pr.targetType : STRUCTURED_TYPES.has(mapType) ? mapType : null;
    // 第五批：相關連結頁（模板 links → related topic）建成 topic；清單說「已移轉」到疫苗頁的疫苗專區頁（原本依關鍵字歸疾病頁疫苗區塊）建成 vaccine；「併入」仍照 mergedInto 走
    if (wantType && !mergedInto && (['page', 'list', 'document', 'news'].includes(kind) || (kind === 'disease-block' && wantType === 'vaccine')) && !(kind === 'news' && wantType !== 'clarification')) {
      if (kind === 'disease-block') blockKey = null;
      kind = wantType; pr.typeClear = true;
      issue('type-from-manifest', 'info', `清單對應的新站型別是 ${wantType}${pr.target ? `（${pr.target}）` : ''}，草稿直接建成 ${wantType}，看不出來的欄位以「（待補）」佔位`);
    }
    // 第十批：素材頁（欄目內頁網址、清單與模板都沒給型別）依標題或麵包屑建成 publication／media；清單 target／mapTo 優先
    const matKind = kind === 'page' && pat?.kind === 'page' && !generatedFallback && !wantType && !mergedInto && !pr.target && !mapType ? matKind0 : null;
    if (matKind) {
      kind = matKind.type; pr.typeClear = true;
      issue('type-from-category', 'info', `素材頁的${matKind.via === 'title' ? '標題' : '麵包屑'}有「${matKind.hit}」，草稿建成 ${matKind.type}（${matKind.pubType ? `pubType ${matKind.pubType}` : `mediaType ${matKind.mediaType}`}）`);
    }
    // 第十一批：統計頁（類別／麵包屑含 statScopes）——清單與模板都沒給型別時，依附件期別、表格時序、站外連結判斷是不是資料集
    //   期刊（≥ 3 期 PDF）⇒ dataset document-library；表格時序 ⇒ dataset structured-table；外部系統入口且站外連結 host 對到既有資料集 ⇒ 該 dataset（compare-existing）
    //   欄位（resources、series、lastUpdated…）在下面結構化型別那段補；清單給了 dataset target 的頁也一樣補
    const defaultYear = Number(String(updatedAt ?? publishedAt ?? exportedAt).slice(0, 4)) || null;
    const periodical = stScope || kind === 'dataset' || kind === 'publication' ? periodicalIssues(attList, { defaultYear }) : null;
    let statById = null;
    if (stScope && kind === 'page' && pat?.kind === 'page' && !generatedFallback && !wantType && !mergedInto && !pr.target && !mapType && !matKind) {
      const preMd = toMd(ext.body.children).markdown; // 改寫前的預覽（不改節點）：只用來判型別
      const ts = periodical ? null : tableSeries(preMd);
      const hosts = periodical || ts ? [] : systemEntryHosts({ markdown: preMd, stat: {} });
      const hit = hosts.length ? datasetByUrl(mdLinks(preMd), index) : null;
      if (periodical || ts || (hit && !hit.ambiguous)) {
        kind = 'dataset'; pr.typeClear = true;
        if (hit && !hit.ambiguous) statById = hit.id;
        issue('type-from-category', 'info', `統計頁${periodical ? `的附件是 ${periodical.issues.length} 期期刊` : ts ? '的表格是時序' : `連到外部系統（${hit.host}），對到既有資料集 ${hit.id}`}，草稿建成 dataset${periodical ? '（document-library）' : ts ? '（structured-table）' : ''}`);
      }
    }
    // 澄清稿：Bulletin typeid 是澄清 ⇒ clarification（claim／verdict），不再以 news 暫存
    if (kind === 'news' && bulletinType(rules, u)?.type === 'clarification') { kind = 'clarification'; issue('type-from-bulletin', 'info', '公告類別是澄清稿，草稿建成 clarification（claim／verdict 由標題與內文推斷）'); }
    // 服務型頁面：合約院所查詢、責任醫院名單等，依標題關鍵字建 service（查詢清單本身不轉成文章）
    if ((kind === 'list' || kind === 'page') && !wantType && serviceTypeFor(rules, title)) { kind = 'service'; issue('type-from-keywords', 'info', `標題看起來是查詢／申辦服務（${serviceTypeFor(rules, title).serviceType}），草稿建成 service；名單類資料請改掛 dataset`); }
    if (kind === 'list') issue('list-page', 'info', '清單頁（連結集合）：新站的列表由系統依內容自動產生，通常不需轉換；草稿僅供比對連結');
    pr.kind = kind;
    pr.type = kind === 'disease-block' ? 'disease' : kind === 'list' ? 'page' : kind;

    // 年代與處理旗標
    const hist = (rules.historicalKeywords ?? []).some((k) => breadcrumbs.join('／').includes(k) || title.includes(k));
    pr.flags.historical = hist;
    if (hist) issue('historical-version', 'info', '歷史版本：建議封存（舊版保留查閱），不取代現行版');
    const drop = (rules.dropRules ?? []).find((r) => r.titleKeywords?.some((k) => title.includes(k)) && (!r.publishedBefore || (publishedAt ?? exportedAt) < r.publishedBefore));
    if (drop) { pr.flags.drop = true; issue('old-content', 'info', drop.note); }
    const yrs = ageYears(updatedAt, exportedAt);
    if (!drop && yrs != null && yrs > (rules.thresholds?.archiveAfterYears ?? 3) && pr.kind !== 'document') { pr.flags.old = true; issue('old-content', 'info', `最後更新於 ${updatedAt}（${yrs.toFixed(1)} 年前），建議走久遠封存而非上線`); }

    // 抽內容：先決定輸出單元的 id，再改寫圖片與連結
    const dis = primary ? diseaseById.get(primary) : null;
    const short = primary ? shortFor(rules, primary) : 'x';

    /** 為某 draftId 建改寫 ctx，並先把 sidecar 附件宣告進該 bag */
    const makeCtx = (draftId, stem, { withAttachments }) => {
      const bag = bagOf(draftId, stem);
      const fileOf = new Map();
      if (withAttachments) {
        for (const a of attList) {
          const r = bag.add({ src: a.file, as: 'attachment', label: a.label, pageKey: page.name });
          addIssues(r.issues);
          if (!r.ok) pr.attachmentsOk = false; else fileOf.set(a, r.file);
        }
      }
      return {
        siteBase, pageUrl: u.origin ? `${u.origin}${u.rawPath}${u.search}` : siteBase, fileLinkRe: rules.extraction?.attachmentLinkPattern,
        onImage: ({ src, alt, title: t }) => {
          const name = decodeURIComponent(path.basename(parseUrl(src, siteBase).rawPath));
          const r = bag.add({ src: name, as: 'image', alt, title: t, pageKey: page.name });
          addIssues(r.issues);
          if (!r.ok) { pr.attachmentsOk = false; return null; }
          return { src: `/files/${draftId}/${r.file}`, alt: r.asset.alt };
        },
        onLink: (abs) => {
          const a = attByPath.get(`${decodeURIComponent(abs.pathname)}${abs.search}`.toLowerCase()) ?? attByPath.get(decodeURIComponent(abs.pathname).toLowerCase());
          if (!a) return null;
          const f = fileOf.get(a);
          return f ? `/files/${draftId}/${f}` : ''; // '' ＝ 側檔有列但檔案缺（已報 attachment-missing），不再重複報
        },
      };
    };
    const afterRewrite = (stat) => {
      pr.stats.images += stat.images; pr.stats.links += stat.links; pr.stats.legacyLinks += stat.legacyLinks;
      for (const l of stat.unlistedFileLinks) { pr.attachmentsOk = false; issue('unlisted-file-link', 'warn', `內文有檔案連結 ${l} 不在側檔 attachments，未轉成附件`); }
      for (const m of stat.missingImages) issue('image-missing', 'error', `圖片 ${m} 找不到檔案`);
      // 第十批：素材頁或出版品／影音同頁多張圖 ⇒ 建成一筆、多個 image 資產
      const g = (matScope || kind === 'publication' || kind === 'media') && kind !== 'faq' ? imageGallery(stat.images) : 0;
      if (g) issue('image-gallery', 'info', `同頁 ${g} 張圖建成一筆、多個 image 資產，不拆成 ${g} 筆`);
    };
    // 第十批：附件 label／檔名看得出語言版本 ⇒ 一筆內容、多語檔案；站上七語以外的（簡體）只留附件
    const langPending = [];
    if ((matScope || kind === 'publication' || kind === 'media') && (STRUCTURED_TYPES.has(kind) || kind === 'page')) {
      const lv = langVariants(attList);
      const others = [...lv.keys()].filter((l) => l !== 'zh-TW');
      if (others.length) {
        const site = others.filter((l) => SITE_LANGS.has(l));
        langPending.push(...site);
        const off = others.filter((l) => !SITE_LANGS.has(l));
        issue('lang-variants', 'info', `附件含 ${site.length} 種語言版本（${site.join('、') || '無'}）：一筆內容、多語檔案；languages 標 pending，請補 i18n 標題與摘要${off.length ? `；${off.join('、')} 不在站上七語，只保留附件、不列入 languages` : ''}`);
      }
    }
    const checks = (markdown, nodeForTables, stat, dropped) => addIssues(bodyChecks({ markdown, dropped, tables: tableProblems(nodeForTables), media: stat.media, minChars: rules.thresholds?.minBodyChars ?? 40 }));
    const reserveId = (wanted, fallback) => {
      let id = wanted;
      if (usedIds.has(id)) { id = fallback; let n = 2; const base = id; while (usedIds.has(id)) id = `${base}-${n++}`; }
      usedIds.set(id, page.name);
      return id;
    };
    // 第九批：小節標題提到主檔沒有的疫苗（黃熱病、流行性腦脊髓膜炎、傷寒…）⇒ 一則提示，名稱記在草稿 conversion.vaccineCandidates（轉 Markdown 前掃 h2–h4）
    const scanVaccines = () => {
      const vc = vaccineCandidates(ext.body, knownVaccines);
      if (vc.length) issue('vaccine-not-in-master', 'info', `小節提到主檔沒有的疫苗：${vc.join('、')}；建議新增 vaccine 主檔與疫苗頁後，把這些小節改建成 vaccine`);
      return vc;
    };
    // 第十一批：dataset 草稿的統計欄位（期刊 resources、表格 series、外部系統入口的既有資料集）；覆蓋 extractFields 的 category／updateFrequency／lastUpdated／resources
    const statDatasetFields = ({ ex, id, markdown, stat, periodical: per, stScope: sc }) => {
      const f = ex.fields;
      const dropNote = (re) => { ex.notes = ex.notes.filter((n) => !re.test(n)); };
      if (per) {
        const bag = bags.get(id);
        f.category = 'document-library';
        if (per.granularity !== 'issue') { f.updateFrequency = { week: 'weekly', month: 'monthly', year: 'yearly' }[per.granularity]; dropNote(/updateFrequency/); }
        if (per.latest?.date) f.lastUpdated = per.latest.date;
        f.resources = per.issues.map((x) => { const file = bag?.bySrc.get(`attachment:${x.file}`)?.file ?? x.file; return { label: x.label, href: `/files/${id}/${file}`, format: String(file.split('.').pop()).toUpperCase() }; });
        f.formats = [...new Set([...(f.formats ?? []), ...f.resources.map((r) => r.format)])];
        // 期別缺號只附在提示裡（週報偶有停刊或合刊，不當警告）
        const miss = ['week', 'month', 'year'].includes(per.granularity) && per.issues.every((x) => x.year != null)
          ? seriesGaps({ granularity: per.granularity, points: per.issues.map((x) => ({ t: per.granularity === 'week' ? `${x.year}-W${String(x.no).padStart(2, '0')}` : per.granularity === 'month' ? `${x.year}-${String(x.no).padStart(2, '0')}` : String(x.year), v: 0 })) }).filter((g) => g.startsWith('缺'))
          : [];
        issue('periodical-issues', 'info', `${per.issues.length} 期、最新 ${periodLabel({ ...per.latest, granularity: per.granularity })}${miss.length ? `（期間${miss.slice(0, 6).join('、')}${miss.length > 6 ? ` 等 ${miss.length} 期` : ''}）` : ''}；期別不是版次，建成一筆資料集逐期列 resources`);
      }
      const ts = tableSeries(markdown);
      if (ts) {
        if (!per) f.category = 'structured-table';
        const { note, ...rest } = ts;
        f.series = { ...rest, ...(note ? { note } : {}) };
        const ys = ts.points.map((x) => x.t);
        issue('series-extracted', 'info', `${ts.points.length} 點、${ys[0]}–${ys.at(-1)}、${ts.unit}（${ts.label}）${note ? `；${note}` : ''}`);
        const gaps = seriesGaps(ts);
        if (gaps.length) issue('series-gaps', 'warn', `時序有缺期或重複：${gaps.slice(0, 6).join('、')}${gaps.length > 6 ? ` 等 ${gaps.length} 項` : ''}`);
        const st = statsStale(ts, exportedAt);
        if (st) issue('stats-stale', 'warn', `最新一筆 ${st.latest}，資料可能已停更或開放平臺有新版（依匯出日應至少到 ${st.expected}）`);
      }
      // 外部系統入口：站外連結 host 對到既有資料集 ⇒ 記 dataset-by-url；canonicalUrl 以該資料集為準
      const hosts = sc ? systemEntryHosts({ markdown, stat }) : [];
      const hit = sc ? datasetByUrl(mdLinks(markdown), index) : null;
      if (hosts.length) issue('external-system', 'info', `舊頁主要連到外部系統（網域 ${hosts.join('、')}）：新站以資料集入口呈現`);
      if (hit && !hit.ambiguous && (hosts.length || ex.pending.includes('canonicalUrl'))) {
        const x = index.byId.get(hit.id);
        if (hosts.length) issue('dataset-by-url', 'info', `依站外連結 host ${hit.host} 對到既有資料集 ${hit.id}${id === hit.id ? '' : `（草稿 id 是 ${id}，請比對）`}`);
        if (x?.canonicalUrl && (id === hit.id || ex.pending.includes('canonicalUrl'))) {
          f.canonicalUrl = x.canonicalUrl;
          if (x.portalUrl) f.portalUrl = x.portalUrl;
          ex.pending = ex.pending.filter((k) => k !== 'canonicalUrl');
          dropNote(/canonicalUrl/);
        }
      } else if (hit?.ambiguous && hosts.length) issue('dataset-by-url', 'info', `站外連結 host ${hit.host} 對到 ${hit.candidates} 筆既有資料集、沒有 canonicalUrl 完全相等者，無法判定是哪一筆`);
      // 清單 target 指到既有資料集、舊頁本身沒有開放資料連結（例如只放 PDF 的疫苗接種率頁）⇒ canonicalUrl 沿用既有資料集，不留待補
      if (ex.pending.includes('canonicalUrl')) {
        const own = index.byId.get(id);
        if (own?.canonicalUrl) {
          f.canonicalUrl = own.canonicalUrl;
          if (own.portalUrl) f.portalUrl = own.portalUrl;
          ex.pending = ex.pending.filter((k) => k !== 'canonicalUrl');
          dropNote(/canonicalUrl/);
          issue('dataset-by-url', 'info', `canonicalUrl 沿用既有資料集 ${id}（清單 target 指定）`);
        }
      }
    };
    const shortKey = pr.manifestKey ?? h6(side.url || page.name);
    const slugStem = pr.manifestKey ? (pr.manifestKey.startsWith(`${short}-`) ? pr.manifestKey : `${short}-${pr.manifestKey}`) : `${short}-${shortKey}`;

    if (kind === 'disease-block') {
      // 併入疾病頁：id＝disease.xxx（多頁共用一份草稿）
      const draftId = primary;
      const vaccineCands = scanVaccines();
      const ctx = makeCtx(draftId, slugStem, { withAttachments: true });
      const stat = rewriteBody(ext.body, ctx);
      afterRewrite(stat);
      const unitBase = { pageKey: page.name, kind, type: 'disease', draftId, diseaseId: primary, vaccineCandidates: vaccineCands };
      const heading = (rules.blockHeadings ?? {});
      if (blockKey) {
        const { markdown, dropped } = toMd(ext.body.children);
        checks(markdown, ext.body, stat, dropped);
        units.push({ ...unitBase, blocks: [{ key: blockKey, heading: heading[blockKey] ?? blockKey, markdown, source: page.name }] });
        pr.outputs.push({ id: draftId, type: 'disease', role: 'merged', block: blockKey });
      } else {
        // 疾病介紹總覽：前言→摘要，各小節依標題關鍵字進區塊
        const { preamble, sections } = splitSections(ext.body);
        const pre = toMd(preamble);
        const blocks = [];
        const unassigned = [];
        let dropped = [...pre.dropped];
        let allMd = pre.markdown;
        for (const s of sections) {
          const k = blockKeyFor(rules, s.heading);
          const r = toMd(s.nodes);
          dropped = dropped.concat(r.dropped);
          allMd += `\n\n${r.markdown}`;
          if (k) blocks.push({ key: k, heading: heading[k] ?? k, markdown: r.markdown ? `### ${s.heading}\n\n${r.markdown}` : '', source: page.name });
          else {
            unassigned.push({ heading: s.heading, markdown: r.markdown });
            issue('section-unassigned', 'warn', `小節「${s.heading}」標題沒有對到任何區塊關鍵字，未併入；內容保留在草稿的 conversion.unassigned`);
          }
        }
        checks(allMd, ext.body, stat, dropped);
        units.push({ ...unitBase, blocks, summaryMd: pre.markdown, unassigned });
        pr.outputs.push({ id: draftId, type: 'disease', role: 'merged', block: blocks.map((b) => b.key).join('、') || null });
        if (!blocks.length) { pr.typeClear = false; issue('type-unclear', 'warn', '疾病介紹總覽沒有任何小節對到區塊'); }
      }
    } else if (kind === 'faq') {
      let items = faqItems(rules, ext.container);
      if (!items.length) {
        // 第八批：沒有手風琴元件、編輯手排的問答頁（<h3>Q1. …</h3> 或 <p><strong>Q：…</strong></p> ＋ 答案段落）
        items = faqItemsLoose(ext.body);
        if (items.length) issue('faq-structure-loose', 'info', `沒有 .panel 結構，依「Q 開頭的標題／段落」拆成 ${items.length} 題，請核對題目與答案的切分`);
      }
      if (!items.length) {
        issue('faq-structure-missing', 'warn', '找不到 Q&A 結構（.panel／.panel-title／.panel-body），整頁當作一題處理');
        items = [{ question: stripTitlePrefix(rules, title), answerNode: ext.body }];
      }
      // 英文問答頁（/En/…）：來源語言是英文、新站以中文為正本 ⇒ 要補中文版
      const faqLang = pat?.lang && pat.lang !== 'zh-TW' ? pat.lang : null;
      if (faqLang) issue('needs-source-zh', 'warn', `來源語言 ${faqLang}：新站以中文為正本（治理規則 18），請補中文版後再上線`);
      if (items.length > 1 && !pr.target) issue('one-to-many', 'info', `一頁 ${items.length} 題、清單沒有單一目標：status 維持 pending，請決定併入疾病頁（merged）或各題獨立（新站以 tasks 歸類）`);
      let first = true;
      const taskNotes = [];
      for (const it of items) {
        const nq = normTitle(it.question);
        let id = index.faqByTitle.get(nq) ?? (items.length === 1 && pr.target?.startsWith('faq.') ? pr.target : null) ?? `faq.${short}-legacy-${h6(it.question)}`;
        if (usedIds.has(id)) {
          pr.unique = false;
          pr.outputs.push({ id, type: 'faq', role: 'duplicate', duplicateOf: usedIds.get(id) });
          issue('duplicate-title', 'warn', `問題「${it.question}」已由 ${usedIds.get(id)} 轉出（${id}），本頁不重複輸出`);
          continue;
        }
        usedIds.set(id, page.name);
        const ctx = makeCtx(id, `${short}-q`, { withAttachments: first && attList.length > 0 });
        first = false;
        const stat = rewriteBody(it.answerNode, ctx);
        afterRewrite(stat);
        const { markdown, dropped } = toMd(it.answerNode.children);
        checks(markdown, it.answerNode, stat, dropped);
        // 第八批：tasks 由關鍵字給、答案期限已過要警告、問「多久／幾劑」的題抽結構化候選
        const answerText = plainText(markdown);
        const tasks = faqLang ? [] : tasksFor(rules, it.question, answerText);
        if (tasks.length) taskNotes.push(`「${it.question}」→ ${tasks.join('、')}`);
        const conv = {};
        const dated = datedDeadlines(`${it.question} ${answerText}`, now);
        if (dated.allPast) {
          conv.dated = dated.deadlines;
          issue('answer-dated', 'warn', `「${it.question}」的答案寫的期限都已過（${dated.deadlines.map((d) => d.text).join('、')}）：請確認是否已有新年度版本或應封存`);
        }
        const structured = faqLang ? null : structuredFromText(it.question, answerText);
        if (structured) { conv.structuredFromText = true; issue('structured-from-text', 'info', `「${it.question}」從答案抽出結構化候選 ${JSON.stringify(structured)}，請確認後保留或刪除`); }
        units.push({ pageKey: page.name, kind, type: 'faq', draftId: id, question: it.question, markdown, diseaseId: primary, publishedAt: publishedAt ?? exportedAt, tasks, structured, lang: faqLang, conv });
        pr.outputs.push({ id, type: 'faq', role: 'draft' });
      }
      if (taskNotes.length) issue('tasks-from-keywords', 'info', `tasks 依題目關鍵字給：${taskNotes.join('；')}`);
      else if (!faqLang && pr.outputs.some((o) => o.role === 'draft')) issue('tasks-unknown', 'info', '題目沒有命中 faqTasks 關鍵字，tasks 留空，請人工補');
    } else if (kind === 'news') {
      const bt = bulletinType(rules, u);
      if (!bt || bt.unknown) { pr.typeClear = false; issue('type-unclear', 'warn', bt ? `Bulletin typeid=${bt.typeid} 不在規則檔 bulletinTypes，暫以其他訊息（other）處理` : '網址沒有 typeid，暫以其他訊息（other）處理'); }
      if (bt?.hint) issue('news-type-hint', 'info', bt.hint);
      // 英文新聞稿（typeid 158）：來源語言是英文、新站以中文為正本 ⇒ 要補中文版才能上線，不走二級自動上線
      if (bt?.lang && bt.lang !== 'zh-TW') issue('needs-source-zh', 'warn', `來源語言 ${bt.lang}：新站以中文為正本（治理規則 18），請補中文版後再上線；不列入 auto-ok`);
      // 既有新聞依標題對上 ⇒ 用既有 id（標 existing 供比對），否則新 id
      const byTitleId = index.newsByTitle.get(normTitle(stripTitlePrefix(rules, title)));
      const id = reserveId(pr.target?.startsWith('news.') ? pr.target : byTitleId ?? `news.${(publishedAt ?? exportedAt)}-legacy-${h6(side.url)}`, `news.${publishedAt ?? exportedAt}-legacy-${h6(side.url + page.name)}`);
      const ctx = makeCtx(id, `${short}-news`, { withAttachments: true });
      const stat = rewriteBody(ext.body, ctx);
      afterRewrite(stat);
      const { markdown, dropped } = toMd(ext.body.children);
      checks(markdown, ext.body, stat, dropped);
      // 致醫界通函（第六批）：Bulletin typeid 48 或標題「致醫界通函第 N 號」⇒ type letter、letterNo 由標題抽；對象醫療院所
      const letterNo = rules.letterTitle ? new RegExp(rules.letterTitle).exec(title)?.[1] ?? null : null;
      const isLetter = bt?.newsType === 'letter' || letterNo != null;
      if (isLetter && bt?.newsType !== 'letter') issue('news-type-hint', 'info', '標題是致醫界通函，草稿建成 letter（typeid 不是通函類別）');
      if (isLetter && letterNo == null) issue('field-guessed', 'info', '通函標題看不出號次，letterNo 待補');
      units.push({ pageKey: page.name, kind, type: 'news', draftId: id, title: stripTitlePrefix(rules, title), markdown, newsType: isLetter ? 'letter' : bt?.newsType ?? 'other', letter: isLetter, letterNo, lang: bt?.lang, diseaseId: primary, publishedAt: publishedAt ?? exportedAt });
      pr.outputs.push({ id, type: 'news', role: 'draft' });
    } else if (kind === 'document') {
      const dt = docTypeFor(rules, title, pat, u);
      if (!dt.clear) issue('doctype-guessed', 'info', '標題與網址看不出文件種類，暫填 guideline');
      // 第七批：生效日優先從標題（「2025 年 9 月版」「114.04.16」）抽，其次內文開頭「…年…月…日修訂／生效」，最後才用發布日
      const effTitle = dateFromText(title);
      const effBody0 = /((?:民國\s*)?\d{2,4}\s*年\s*\d{1,2}\s*月(?:\s*\d{1,2}\s*日)?|\d{2,3}\.\d{1,2}\.\d{1,2}|(?:19|20)\d{2}-\d{2}-\d{2})[^\n。]{0,12}?(修訂|生效|公告|發布|公布|核定|實施)/.exec(textOf(ext.body).slice(0, 600));
      const effBody = effBody0 ? dateFromText(effBody0[1]) : null;
      // 標題只有年月（「113 年 12 月修訂版」）而內文有完整日期（「113 年 12 月 20 日修訂生效」）時，以內文為準
      const titleHasDay = /\d{1,2}\s*日|\d{2,3}\.\d{1,2}\.\d{1,2}|(?:19|20)\d{2}-\d{2}-\d{2}/.test(title);
      const effText = effTitle && (titleHasDay || !effBody) ? effTitle : effBody ?? effTitle;
      const eff = effText ?? publishedAt ?? exportedAt;
      if (effText && effText !== (publishedAt ?? exportedAt)) issue('effective-from-text', 'info', `生效日 ${eff} 取自${effTitle ? '標題' : '內文'}（舊頁發布日 ${publishedAt ?? '缺'}）`);
      // 第七批：去版次後同名的多頁 ⇒ 同一文件家族（family 依標題，不依網址），版次鏈在第一階段結束後依生效日串
      const vf = versionFree(stripTitlePrefix(rules, title));
      const sharesTitle = !pr.target?.startsWith('doc.') && (vfCount.get(vf) ?? 0) > 1;
      // 家族：清單目標存在 ⇒ 用既有文件的 family（id 不一定以日期結尾，如 doc.guidance-dengue.v17）；否則由目標 id 去掉版次段
      const family0 = pr.target?.startsWith('doc.') ? (index.byId.get(pr.target)?.family ?? pr.target.replace(/\.(\d{4}-\d{2}-\d{2}|v\d+)$/i, '')) : sharesTitle ? `doc.${short}-${h6(vf)}` : `doc.${short}-${pr.manifestKey ?? h6(side.url)}`;
      if (sharesTitle) issue('version-family', 'info', `去掉版次後與另外 ${vfCount.get(vf) - 1} 頁同名，視為同一文件家族 ${family0}；版次鏈依生效日串接，舊版建議封存`);
      let id = pr.target?.startsWith('doc.') ? pr.target : `${family0}.${eff}`;
      if (usedIds.has(id)) {
        issue('target-shared', 'info', `與 ${usedIds.get(id)} 指向同一個對應 ${id}（不同版次），改以 ${family0}.${eff} 另列一版`);
        id = `${family0}.${eff}`;
      }
      id = reserveId(id, `${family0}.${eff}`);
      const family = index.byId.get(id)?.family ?? (id === pr.target ? family0 : id.replace(/\.\d{4}-\d{2}-\d{2}(-\d+)?$/, ''));
      const ctx = makeCtx(id, slugStem, { withAttachments: true });
      const stat = rewriteBody(ext.body, ctx);
      afterRewrite(stat);
      let { markdown, dropped } = toMd(ext.body.children);
      checks(markdown, ext.body, stat, dropped);
      const version = parseVersion(title);
      if (!version) issue('version-unknown', 'info', `標題看不出版次，version 暫填 ${eff}`);
      const mainBag = bags.get(id);
      const pdfAtts = attList.filter((a) => /\.pdf$/i.test(a.file));
      // 第七批：舊頁只有「請下載附件」、正本在 PDF ⇒ 純 PDF 文件：機讀正本以「（待補）」佔位，不整批轉 PDF（第 8 節），上架前由權責單位提供文字版
      const pdfOnly = pdfAtts.length > 0 && plainText(markdown).replace(/\s/g, '').length < (rules.thresholds?.minBodyChars ?? 40);
      if (pdfOnly) {
        issue('pdf-only', 'warn', `舊頁內文只有下載連結，正本是 PDF「${pdfAtts[0].label ?? pdfAtts[0].file}」；machineReadableMarkdown 以（待補）佔位，PDF 不整批轉（第 8 節），上架前請提供文字版`);
        issue('fields-pending', 'info', '待補欄位：machineReadableMarkdown（正本文字版）');
        markdown = `（待補：本文件正本為 PDF「${pdfAtts[0].label ?? pdfAtts[0].file}」，舊頁只有下載連結。上架前請權責單位提供文字版（assets-policy 第 4 節），或確認僅以附件提供。）${markdown.trim() ? `\n\n${markdown.trim()}` : ''}`;
      }
      units.push({ pageKey: page.name, kind, type: 'document', draftId: id, title: stripTitlePrefix(rules, title), markdown, docType: dt.docType, version: version ?? eff, effectiveAt: eff, family, diseaseId: primary, publishedAt: eff, pdfOnly, conv: pdfOnly ? { pdfOnly: true } : {} });
      pr.outputs.push({ id, type: 'document', role: 'draft' });
      // 第七批：一頁多版——附件列表裡標了別的版次的 PDF（「…第七版（2022 年 3 月）」）⇒ 同家族的舊版各建一份純 PDF 草稿（只搬檔，不轉內文），生效日從附件標籤抽
      const curRank = versionRank(version);
      for (const a of pdfAtts) {
        const v = parseVersion(a.label ?? '');
        const labelName = versionFree(String(a.label ?? '').replace(/[（(]\s*pdf\s*[）)]/gi, '').replace(/\.pdf$/i, ''));
        // 只有「頁面本身版次已知、附件標籤版次不同、去版次後同名」才算另一版次；附表、申請書等不同名附件不拆
        if (!version || !v || v === version || labelName !== vf || (curRank != null && versionRank(v) === curRank)) continue;
        const effOld = dateFromText(String(a.label ?? '').replace(v, ''));
        // 新站已有同家族、同生效日（或同版次）的文件 ⇒ 沿用它的 id（供比對），否則 family.生效日
        const vr = versionRank(v);
        const existingOld = [...index.byId.entries()].find(([xid, x]) => x.type === 'document' && x.family === family && xid !== id && ((effOld && x.effectiveAt === effOld) || (x.version && (x.version === v || (vr != null && versionRank(x.version) === vr)))))?.[0] ?? null;
        const oldId0 = existingOld ?? `${family}.${effOld ?? eff}`;
        const oldId = reserveId(usedIds.has(oldId0) ? `${oldId0}-${versionRank(v) ?? 'x'}` : oldId0, `${oldId0}-${versionRank(v) ?? 'x'}`);
        const oldBag = bagOf(oldId, slugStem);
        const r = oldBag.add({ src: a.file, as: 'attachment', label: a.label, pageKey: page.name });
        addIssues(r.issues.filter((i) => i.code !== 'file-renamed'));
        if (!r.ok) continue;
        // 檔案改歸舊版草稿，主草稿不重複宣告
        if (mainBag) { const i = mainBag.assets.findIndex((x) => x.kind === 'attachment' && x.label === (String(a.label ?? '').trim() || a.file.replace(/\.[^.]+$/, ''))); if (i >= 0) { try { fs.rmSync(path.join(out, 'content/assets', id, mainBag.assets[i].file)); } catch { /* 已不存在 */ } mainBag.assets.splice(i, 1); } }
        if (!effOld) issue('version-date-unknown', 'warn', `附件「${a.label}」是 ${v}，但標籤看不出生效日，暫用 ${eff}；請人工補日期再排版次鏈`);
        issue('version-from-attachment', 'info', `附件「${a.label}」是另一版次（${v}），另建純 PDF 草稿 ${oldId}（同家族 ${family}，不轉內文）`);
        units.push({ pageKey: page.name, kind, type: 'document', draftId: oldId, title: `${stripTitlePrefix(rules, title).replace(version ?? '\u0000', '').replace(/（\s*）/g, '').trim()}（${v}）`, markdown: `（待補：本版次正本為 PDF「${a.label}」，由舊頁「${title}」的附件列表拆出，不轉內文；僅供查閱的失效版本。）`, docType: dt.docType, version: v, effectiveAt: effOld ?? eff, family, diseaseId: primary, publishedAt: effOld ?? eff, pdfOnly: true, fromAttachment: true, conv: { pdfOnly: true, fromAttachment: true } });
        pr.outputs.push({ id: oldId, type: 'document', role: 'draft' });
      }
    } else if (STRUCTURED_TYPES.has(kind)) {
      const prefix = kind === 'clarification' ? 'clar' : kind;
      const eff = publishedAt ?? exportedAt;
      const byTitleId = kind === 'clarification' ? index.newsByTitle.get(normTitle(stripTitlePrefix(rules, title))) : null;
      // 專區（相關連結）不沿用推導目標的 id：推導到的是「與此疾病相關的某個專區」，不是同一份內容，只列為比對對象；其他型別同 id 供逐欄比對
      const wanted = pr.target && typeOfId(pr.target) === kind && kind !== 'topic' ? pr.target
        : statById ?? (byTitleId && typeOfId(byTitleId) === 'clarification' ? byTitleId : null)
        ?? (kind === 'clarification' ? `clar.${eff}-${short}-${h6(side.url)}` : kind === 'labtest' ? `labtest.${dis?.slug ?? short}` : kind === 'topic' && pr.manifestKey === 'links' ? `topic.${dis?.slug ?? short}-links` : `${prefix}.${slugStem}`);
      if (usedIds.has(wanted)) issue('target-shared', 'info', `與 ${usedIds.get(wanted)} 指向同一個對應 ${wanted}，另以新 id 列一份供人工刪一份`);
      // 既有新聞其實是澄清（newsType clarification）而新草稿是 clarification 型別 ⇒ 列為比對對象
      if (kind === 'clarification' && byTitleId && typeOfId(byTitleId) !== 'clarification' && !pr.target) { pr.target = byTitleId; pr.targetExists = true; pr.targetType = typeOfId(byTitleId); issue('type-upgrade', 'info', `既有內容 ${byTitleId} 以 news 存放同一則澄清，新草稿改為 clarification 型別，請比對後擇一`); }
      const id = reserveId(wanted, `${prefix}.${slugStem}-${h6(side.url + page.name)}`);
      const ctx = makeCtx(id, slugStem, { withAttachments: true });
      const stat = rewriteBody(ext.body, ctx);
      afterRewrite(stat);
      const { markdown, dropped } = toMd(ext.body.children);
      checks(markdown, ext.body, stat, dropped);
      // 影音型別本來就是嵌入影片，不算「未轉入的媒體」
      if (kind === 'media') pr.issues = pr.issues.filter((i) => i.code !== 'embedded-media');
      const professional = (rules.audience?.professionalCategories ?? []).some((c) => (category + breadcrumbs.join('／')).includes(c));
      const mapTo = matKind ? { ...(mi?.mapTo ?? {}), ...(matKind.pubType ? { pubType: matKind.pubType } : {}), ...(matKind.mediaType ? { mediaType: matKind.mediaType } : {}) } : mi?.mapTo;
      const ex = extractFields(kind, { title: stripTitlePrefix(rules, title), markdown, mapTo, dm: dis, pageUrl: side.url, publishedAt: eff, updatedAt, exportedAt, media: stat.media, assets: bags.get(id)?.assets ?? [], draftId: id, professional, short, rules, category, summary: summaryOf(markdown, '', 100) });
      // 第十批：海報／單張只有圖 ⇒ 文字版待補（可及性）；摘要放既有文字＋圖片 alt 條列＋佔位
      if (kind === 'publication' && imageOnly({ markdown, images: stat.images, minChars: rules.thresholds?.minBodyChars ?? 40 })) {
        issue('image-only', 'warn', '圖片承載唯一資訊：海報／單張的文字要另有純文字版（可及性），abstractMarkdown 以（待補）佔位');
        ex.fields.abstractMarkdown = imageOnlyAbstract(markdown, (bags.get(id)?.assets ?? []).filter((a) => a.kind === 'image'));
        ex.pending.push('abstractMarkdown');
      }
      // 第十批：素材早於依據正本（同疾病現行文件）的生效日 ⇒ 上線前確認內容；basedOn 加該文件
      const outdated = (kind === 'publication' || kind === 'media') && primary ? materialOutdated({ publishedAt: eff, diseaseId: primary, contentIndex: index }) : null;
      if (outdated) issue('material-outdated', 'warn', `素材製作日 ${eff} 時依據的 ${outdated.supersededId}（${outdated.supersededAt}）已於 ${outdated.effectiveAt} 被 ${outdated.docId} 取代；上線前請確認內容仍正確（治理 R9 影音過時的事前版）`);
      // 第十一批：統計資料集的欄位——期刊逐期列 resources、表格時序進 series、外部系統入口對既有資料集補 canonicalUrl
      if (kind === 'dataset') statDatasetFields({ ex, id, markdown, stat, periodical, stScope });
      else if (kind === 'publication' && periodical && stScope) issue('periodical-issues', 'info', `附件是 ${periodical.issues.length} 期期刊、最新 ${periodLabel({ ...periodical.latest, granularity: periodical.granularity })}；期別不是版次，不拆版次鏈，各期附件留在本筆`);
      if (ex.pending.length) issue('fields-pending', 'warn', `${kind} 的欄位從舊頁看不出來，以「（待補）」佔位：${ex.pending.join('、')}`);
      for (const n of ex.notes) issue('field-guessed', 'info', n);
      // 模板位置的標題是通稱（「檢驗資訊」「統計資料」），草稿標題補上疾病名才能在列表裡分辨
      const t0 = stripTitlePrefix(rules, title);
      const utitle = kind !== 'clarification' && dis?.name && !t0.includes(dis.name) ? `${dis.name}${t0}` : t0;
      units.push({ pageKey: page.name, kind, type: kind, draftId: id, title: utitle, markdown, fields: ex.fields, diseaseId: primary, publishedAt: eff, basedOnDoc: outdated?.docId ?? null, langPending });
      pr.outputs.push({ id, type: kind, role: 'draft' });
    } else {
      // page（含清單頁）
      const wanted = pr.target?.startsWith('page.') ? pr.target : `page.${slugStem}`;
      const id = reserveId(wanted, `page.${short}-${shortKey}-${h6(side.url + page.name)}`);
      const conv = {};
      if (kind === 'page') {
        // 第九批：查詢表單頁（國家下拉選單之類）：新站以功能取代，表單控制項不轉入內文，草稿只留說明文字
        const df = dynamicForm(ext.body);
        if (df) { pr.flags.dynamicForm = { options: df.options }; issue('dynamic-form', 'warn', `舊頁是查詢表單（${df.options} 個選項），新站以功能取代（請在清單填寫去處）；表單控制項不轉入內文`); }
        const vc = scanVaccines();
        if (vc.length) conv.vaccineCandidates = vc;
      }
      const ctx = makeCtx(id, slugStem, { withAttachments: true });
      const stat = rewriteBody(ext.body, ctx);
      afterRewrite(stat);
      const { markdown, dropped } = toMd(ext.body.children);
      checks(markdown, ext.body, stat, dropped);
      // 第十批：舊頁主要連到外部系統（字少、沒有站內連結、有站外連結）⇒ 提示以入口連結呈現；動作不變
      // 第十一批：統計頁改用 systemEntryHosts（疾管署子網域系統也算外部系統）
      const extHosts = kind === 'page' ? (stScope ? systemEntryHosts : externalSystemPage)({ markdown, stat }) : [];
      if (extHosts.length) { pr.flags.externalSystem = { hosts: extHosts }; issue('external-system', 'info', `舊頁主要連到外部系統（網域 ${extHosts.join('、')}）：新站以入口連結呈現，建議 /services/ 放入口或清單填 newPath（例 /data/）`); }
      // 第十一批：統計頁的外部系統入口，host 對到多筆既有資料集（資料開放平臺首頁）⇒ 無法判定，維持 page
      const dsHit = extHosts.length && stScope ? datasetByUrl(mdLinks(markdown), index) : null;
      if (dsHit?.ambiguous) issue('dataset-by-url', 'info', `站外連結 host ${dsHit.host} 對到 ${dsHit.candidates} 筆既有資料集、沒有 canonicalUrl 完全相等者，無法判定是哪一筆，維持 page`);
      // 第十一批：英文列表頁（category-list-en）等 lang 不是中文的網址模式 ⇒ 草稿帶 sourceLang
      const pageLang = pat?.lang && pat.lang !== 'zh-TW' ? pat.lang : null;
      units.push({ pageKey: page.name, kind, type: 'page', draftId: id, title: stripTitlePrefix(rules, title), markdown, diseaseId: primary, publishedAt: publishedAt ?? exportedAt, conv, langPending, lang: pageLang });
      pr.outputs.push({ id, type: 'page', role: 'draft' });
      if (pr.targetExists && pr.targetType !== 'page' && !mergedInto) issue('target-type-differs', 'info', `對應的新站內容是 ${pr.target}（${pr.targetType}），草稿以 page 暫存，請比對後改建為 ${pr.targetType}`);
    }

    // 重複標題（非 FAQ）
    if (kind !== 'faq') {
      const nt = normTitle(stripTitlePrefix(rules, title));
      if (titleSeen.has(nt)) { pr.unique = false; issue('duplicate-title', 'warn', `標題與 ${titleSeen.get(nt)} 重複`); } else titleSeen.set(nt, page.name);
    }
    pr.issues = uniqIssues(pr.issues);
  }

  // ───── 信心、處理狀態與建議動作 ─────
  const weights = rules.confidence ?? {};
  for (const pr of prs) {
    const markdownClean = !pr.issues.some((i) => MARKDOWN_WARNING_CODES.has(i.code));
    const attOk = pr.attachmentsOk && !pr.issues.some((i) => ['attachment-missing', 'asset-too-large', 'asset-ext-not-allowed', 'unlisted-file-link'].includes(i.code));
    const { confidence, parts } = computeConfidence({ typeClear: pr.typeClear, ownerMapped: pr.ownerMapped, markdownClean, attachmentsOk: attOk, unique: pr.unique }, weights);
    pr.confidence = confidence; pr.parts = parts;
    pr.needsReview = needsReview(confidence, rules);
    pr.existing = pr.targetExists || pr.outputs.some((o) => o.role !== 'duplicate' && index.byId.has(o.id));
    pr.compareWith = uniqBy([...pr.outputs.filter((o) => index.byId.has(o.id)).map((o) => o.id), ...(pr.targetExists ? [pr.target] : [])].map((id) => ({ id })), (x) => x.id).map((x) => x.id);
    pr.action = decideAction(pr, rules);
  }

  // ───── 第七批：文件版次鏈——同家族依生效日（再依版次數字）排序，新版 supersedes 舊版；舊版那一頁建議封存 ─────
  {
    const fams = new Map();
    for (const un of units) if (un.type === 'document') { if (!fams.has(un.family)) fams.set(un.family, []); fams.get(un.family).push(un); }
    const prByKey0 = new Map(prs.map((p) => [p.key, p]));
    for (const [family, us] of fams) {
      if (us.length < 2) continue;
      us.sort((a, b) => a.effectiveAt.localeCompare(b.effectiveAt) || ((versionRank(a.version) ?? 0) - (versionRank(b.version) ?? 0)));
      for (let i = 0; i < us.length; i++) {
        const un = us[i];
        un.supersedes = i > 0 ? us[i - 1].draftId : null;
        un.conv = { ...(un.conv ?? {}), versionChain: { family, position: i + 1, of: us.length, current: i === us.length - 1, ...(i < us.length - 1 ? { supersededBy: us[i + 1].draftId } : {}) } };
        const pr = prByKey0.get(un.pageKey);
        if (!pr) continue;
        const own = pr.outputs.some((o) => o.id === un.draftId && o.role === 'draft') && !un.fromAttachment;
        if (i < us.length - 1 && own && !pr.flags.historical) {
          pr.flags.historical = true;
          pr.issues.push({ code: 'historical-version', severity: 'info', message: `同家族 ${family} 有更新的版次 ${us[us.length - 1].draftId}（${us[us.length - 1].version}，${us[us.length - 1].effectiveAt} 生效）；本頁是舊版，建議封存（保留查閱、加失效警示）` });
          pr.action = decideAction(pr, rules);
        }
        if (i === us.length - 1 && own) pr.issues.push({ code: 'version-chain', severity: 'info', message: `版次鏈 ${family}：${us.map((x) => `${x.version}（${x.effectiveAt}）`).join(' → ')}；本版為現行版，supersedes ${un.supersedes}` });
      }
    }
  }

  // ───── 第二階段：組草稿 ─────
  const drafts = [];
  const common = (id, type, title, extra) => {
    const published = extra.publishedAt ?? exportedAt;
    return {
      id, type, title,
      ...extra.head,
      owner: extra.owner, publishedAt: published, reviewedAt: exportedAt, reviewPeriodMonths: master.periods[type] ?? 12, status: 'review',
      audience: extra.audience, sensitivity: 'public', license: 'OGDL-1.0',
      ...(extra.diseases?.length ? { diseases: extra.diseases } : {}),
      aiWhitelist: { requested: false }, languages: { 'zh-TW': { status: 'source' } },
      ...(extra.sourceLang ? { sourceLang: extra.sourceLang } : {}),
      summary: extra.summary,
    };
  };
  const prByKey = new Map(prs.map((p) => [p.key, p]));
  const audienceFor = (type, pr) => (pr && (rules.audience?.professionalCategories ?? []).some((c) => (pr.source.category + pr.source.breadcrumbs.join('／')).includes(c)) && type !== 'disease' ? ['professional'] : (rules.audience?.byType?.[type] ?? ['public']));
  const ownerOf = (pr) => pr.owner;
  const finish = (draft, srcPrs, extraConv = {}) => {
    const bag = bags.get(draft.id);
    const issuesRaw = uniqIssues(srcPrs.flatMap((p) => p.issues));
    const wc = issuesRaw.filter((i) => i.code === 'word-cleaned');
    const issuesAll = wc.length > 1
      ? [...issuesRaw.filter((i) => i.code !== 'word-cleaned'), { code: 'word-cleaned', severity: 'info', message: `清除 Word 貼上殘留共 ${wc.reduce((a, i) => a + Number(/殘留 (\d+) 處/.exec(i.message)?.[1] ?? 0), 0)} 處（${wc.length} 個來源頁）` }]
      : issuesRaw;
    const conf = Math.round((srcPrs.reduce((a, p) => a + p.confidence, 0) / srcPrs.length) * 100) / 100;
    draft.legacyUrls = uniqBy(srcPrs.map((p) => p.source.url).filter((x) => /^https?:\/\//.test(x)), (x) => x);
    if (bag?.assets.length) draft.assets = bag.assets;
    const compare = uniqBy([...(index.byId.has(draft.id) ? [{ id: draft.id }] : []), ...srcPrs.filter((p) => p.targetExists && p.outputs.filter((o) => o.role !== 'duplicate').length === 1).map((p) => ({ id: p.target }))], (x) => x.id).map((x) => x.id);
    draft.conversion = {
      mode: 'auto', confidence: conf, issues: issuesAll.map(({ code, severity, message }) => ({ code, severity, message })),
      sourceUrl: srcPrs[0].source.url, convertedAt,
      ...(srcPrs.length > 1 ? { sourceUrls: uniqBy(srcPrs.map((p) => p.source.url), (x) => x) } : {}),
      ...(compare.length ? { existing: true, compareWith: compare } : {}),
      ...extraConv,
    };
    return draft;
  };

  const diseaseUnits = new Map();
  for (const un of units) if (un.type === 'disease') { if (!diseaseUnits.has(un.draftId)) diseaseUnits.set(un.draftId, []); diseaseUnits.get(un.draftId).push(un); }

  for (const un of units) {
    const pr = prByKey.get(un.pageKey);
    if (un.type === 'disease') continue;
    const dmeta = un.diseaseId ? diseaseById.get(un.diseaseId) : null;
    const diseases = uniqBy([...(un.diseaseId ? [un.diseaseId] : []), ...pr.diseases.slice(1)].map((id) => ({ id })), (x) => x.id).map((x) => x.id);
    const base = (title, summaryMd, type) => common(un.draftId, type, title, { owner: ownerOf(pr), publishedAt: un.publishedAt, audience: audienceFor(type, pr), diseases, summary: summaryOf(summaryMd, title) });
    let d;
    if (un.type === 'faq') {
      d = base(un.question, un.markdown, 'faq');
      Object.assign(d, { question: un.question, answerMarkdown: un.markdown });
      if (un.tasks?.length) d.tasks = un.tasks;
      if (un.diseaseId) d.basedOn = [un.diseaseId];
      if (un.structured) d.structured = un.structured;
      if (un.lang && un.lang !== 'zh-TW') d.sourceLang = un.lang;
    } else if (un.type === 'news') {
      d = base(un.title, un.markdown, un.letter ? 'letter' : 'news');
      d.type = un.letter ? 'letter' : 'news';
      d.reviewPeriodMonths = master.periods.news ?? 0;
      Object.assign(d, { newsType: un.newsType, bodyMarkdown: un.markdown });
      if (un.letter && un.letterNo != null) d.letterNo = Number(un.letterNo);
      if (un.lang && un.lang !== 'zh-TW') d.sourceLang = un.lang;
    } else if (un.type === 'document') {
      d = base(un.title, un.markdown, 'document');
      Object.assign(d, { family: un.family, docType: un.docType, version: un.version, effectiveAt: un.effectiveAt, machineReadableMarkdown: un.markdown });
      if (un.supersedes !== undefined) d.supersedes = un.supersedes;
      const bag = bags.get(un.draftId);
      const pdf = bag?.assets.find((a) => a.file.endsWith('.pdf') && a.kind === 'attachment');
      if (pdf) d.pdfUrl = `/files/${un.draftId}/${pdf.file}`;
    } else if (STRUCTURED_TYPES.has(un.type)) {
      d = base(un.title, un.markdown, un.type);
      Object.assign(d, un.fields);
      if (un.type === 'clarification') d.summary = un.fields.shareText;
      if (un.type === 'publication' && !d.pdfUrl) { const pdf = bags.get(un.draftId)?.assets.find((a) => a.file.endsWith('.pdf') && a.kind === 'attachment'); if (pdf) d.pdfUrl = `/files/${un.draftId}/${pdf.file}`; }
      // 第十批：publication 也填 basedOn；素材早於依據正本時加上該文件
      if (un.diseaseId && ['labtest', 'media', 'clarification', 'vaccine', 'publication'].includes(un.type)) d.basedOn = [un.diseaseId, ...(un.basedOnDoc ? [un.basedOnDoc] : [])];
    } else {
      d = base(un.title, un.markdown, 'page');
      Object.assign(d, { slug: idRest(un.draftId), bodyMarkdown: un.markdown });
      if (un.lang) d.sourceLang = un.lang;
    }
    // 第十批：附件有其他語言版本 ⇒ languages 標 pending（i18n 標題與摘要待補）
    for (const l of un.langPending ?? []) if (!d.languages[l]) d.languages[l] = { status: 'pending' };
    drafts.push(finish(d, [pr], un.conv ?? {}));
  }

  for (const [id, us] of diseaseUnits) {
    const dm = diseaseById.get(id);
    const srcPrs = uniqBy(us.map((x) => prByKey.get(x.pageKey)), (p) => p.key);
    const bmap = new Map();
    for (const un of us) for (const b of un.blocks) {
      if (!bmap.has(b.key)) bmap.set(b.key, { key: b.key, heading: b.heading, parts: [] });
      if (b.markdown) bmap.get(b.key).parts.push(b.markdown);
    }
    const blocks = BLOCK_ORDER.map((k) => {
      const e = bmap.get(k);
      const md = e?.parts.join('\n\n') ?? '';
      return md ? { key: k, heading: e.heading, markdown: md } : { key: k, heading: rules.blockHeadings?.[k] ?? k, markdown: '', status: 'pending' };
    });
    const firstSentence = (k) => { const b = blocks.find((x) => x.key === k); const t = plainText((b?.markdown ?? '').split('\n').filter((l) => !/^#{1,6}\s/.test(l)).join('\n')); return t ? summaryOf(t, '', 60) : '（待補：舊頁沒有對應段落）'; };
    const intro = us.find((x) => x.summaryMd);
    const unassigned = us.flatMap((x) => x.unassigned ?? []);
    const prFirst = srcPrs[0];
    const d = common(id, 'disease', dm?.name ?? id, {
      owner: dm?.owner ?? ownerOf(prFirst), publishedAt: prFirst.source.publishedAt, audience: rules.audience?.byType?.disease ?? ['public', 'professional'], diseases: [id],
      summary: summaryOf(intro?.summaryMd || blocks.find((b) => b.markdown)?.markdown || '', dm?.name ?? id),
      head: { slug: dm?.slug ?? idRest(id), nameEn: dm?.nameEn ?? '' },
    });
    // 疾病頁固定欄位：從主檔帶入，舊頁文字只進 blocks
    Object.assign(d, {
      aliases: dm?.aliases ?? [], legalCategory: dm?.legalCategory ?? 3, icd10: dm?.icd10 ?? [], ...(dm?.notifyWithinHours != null ? { notifyWithinHours: dm.notifyWithinHours } : {}), transmission: dm?.transmission ?? [],
      keyFacts: { symptoms: firstSentence('symptoms'), transmission: firstSentence('transmission'), prevention: firstSentence('prevention') },
      blocks,
    });
    // 欄位順序：head 先、再治理欄位——common 已處理；slug／nameEn 放在 head
    const extra = { mergedFrom: srcPrs.map((p) => ({ page: p.key, url: p.source.url, blocks: us.filter((x) => x.pageKey === p.key).flatMap((x) => x.blocks.map((b) => b.key)) })) };
    if (intro?.summaryMd) extra.introMarkdown = intro.summaryMd;
    if (unassigned.length) extra.unassigned = unassigned;
    const vcs = [...new Set(us.flatMap((x) => x.vaccineCandidates ?? []))];
    if (vcs.length) extra.vaccineCandidates = vcs;
    drafts.push(finish(d, srcPrs, extra));
  }

  // ───── 驗證與寫檔 ─────
  const env = { units: unitIds, diseaseIds: new Set(master.diseases.map((d) => d.id)), licenses: config.licenses?.allowed, assetsDir: path.join(out, 'content/assets') };
  const draftRecs = [];
  for (const d of drafts) {
    const rel = `content/${DIRS[d.type]}/${idRest(d.id)}.json`;
    fs.mkdirSync(path.dirname(path.join(out, rel)), { recursive: true });
    fs.writeFileSync(path.join(out, rel), `${JSON.stringify(d, null, 2)}\n`);
    const errors = validateDraft(d, env);
    draftRecs.push({
      id: d.id, type: d.type, title: d.title, file: rel, confidence: d.conversion.confidence, existing: !!d.conversion.existing, compareWith: d.conversion.compareWith ?? [],
      status: d.status, owner: d.owner, assets: (d.assets ?? []).length, schemaValid: errors.length === 0, errors,
      sourcePages: uniqBy(units.filter((x) => x.draftId === d.id).map((x) => ({ k: x.pageKey })), (x) => x.k).map((x) => x.k),
      merged: d.type === 'disease',
    });
  }
  for (const pr of prs) {
    for (const o of pr.outputs) {
      const rec = draftRecs.find((r) => r.id === o.id);
      if (rec) { o.file = rec.file; o.schemaValid = rec.schemaValid; }
      if (rec && !rec.schemaValid) pr.issues.push({ code: 'schema-invalid', severity: 'error', message: `草稿 ${rec.id} 未通過 schema 驗證：${rec.errors.slice(0, 3).join('；')}` });
    }
  }

  // ───── 報告與移轉清單 ─────
  const patch = buildPatch({ manifest, prs, units, index, exportedAt, slug, rules, derivedItems });
  if (patch && derivedCovered.length) patch.derivedCovered = derivedCovered.map((d) => ({ key: d.key, oldTitle: d.oldTitle, coveredBy: d.coveredBy, target: d.target }));
  const sum = summarize({ prs, draftRecs, bags, patch, manifest, exp, exportedAt });
  // 二級（近年新聞 auto-ok）抽樣檢視名單（第六批）：依網址雜湊排序取前 ceil(n × sampleRate)，重跑結果固定，公關室照名單抽看
  const autoOk = prs.filter((p) => p.action === 'auto-ok');
  const sampleRate = rules.thresholds?.sampleRate ?? 0.1;
  const sampling = { rate: sampleRate, autoOk: autoOk.length, picked: [...autoOk].sort((a, b) => h6(a.source.url).localeCompare(h6(b.source.url))).slice(0, Math.ceil(autoOk.length * sampleRate)).map((p) => ({ key: p.key, title: p.source.title, url: p.source.url, draftId: p.outputs[0]?.id ?? null })) };
  const report = {
    format: 'cdc-legacy-import-report/1',
    batch: slug, generatedAt: convertedAt, exportedAt, simulated: exp.meta.simulated === true,
    source: { dir: path.relative(ROOT, exp.dir) || exp.dir, note: exp.meta.source ?? null, site: exp.meta.site ?? siteBase },
    rules: { file: rules.__file, version: rules.version },
    manifest: manifest ? { id: manifest.data.id, file: manifest.synthetic ? null : path.relative(ROOT, manifest.path), synthetic: !!manifest.synthetic, items: mItems.length, extends: manifest.data.extends ?? null, derivedItems: derivedItems.length, derivedCovered: derivedCovered.map((d) => ({ key: d.key, coveredBy: d.coveredBy, target: d.target })), disease: manifestDisease } : null,
    summary: sum,
    pages: prs.map((p) => ({
      key: p.key, file: p.htmlFile, source: { url: p.source.url, title: p.source.title, category: p.source.category, publishedAt: p.source.publishedAt, updatedAt: p.source.updatedAt, breadcrumbs: p.source.breadcrumbs, tab: p.source.tab },
      pattern: p.pattern, kind: p.kind, type: p.type, manifestKey: p.manifestKey, manifestDerived: p.manifestDerived, target: p.target, targetExists: p.targetExists, existing: p.existing, compareWith: p.compareWith,
      owner: p.owner, ownerRule: p.ownerRule, diseases: p.diseases, outputs: p.outputs, confidence: p.confidence, parts: p.parts, needsReview: p.needsReview,
      issues: p.issues, action: p.action, flags: p.flags, stats: p.stats, ...(p.reference ? { reference: p.reference } : {}),
    })),
    drafts: draftRecs,
    sampling,
    migration: { patchFile: 'migration-patch.json', applied: false, summary: patch.summary },
  };
  fs.writeFileSync(path.join(out, 'migration-patch.json'), `${JSON.stringify(patch, null, 2)}\n`);
  if (applyMigration) {
    if (!manifest || manifest.synthetic) throw new Error(`找不到移轉清單 ${path.relative(ROOT, mfPath)}（${manifest?.synthetic ? '這批只有模板推導，沒有人工清單檔可寫' : '無法'}），無法 --apply-migration`);
    const res = applyPatch(manifest.path, patch);
    report.migration = { ...report.migration, applied: true, file: path.relative(ROOT, manifest.path), ...res };
    patch.applied = res;
    fs.writeFileSync(path.join(out, 'migration-patch.json'), `${JSON.stringify(patch, null, 2)}\n`);
  }
  fs.writeFileSync(path.join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(path.join(out, 'report.md'), renderReportMd(report, patch));
  log(`輸出 ${drafts.length} 份草稿 → ${path.relative(ROOT, out)}`);
  return { report, patch, drafts, outDir: out };
}

export function decideAction(pr, rules) {
  // 第九批：新站由資料產生的頁（/travel/{ISO2}/），不轉內文；舊網址 301 到產生頁
  if (pr.flags.generated) return 'skip-generated';
  if (pr.flags.drop) return 'drop';
  if (pr.flags.historical) return 'archive';
  if (pr.flags.convertedElsewhere) return 'skip-duplicate';
  // 第八批：整頁每一題都已由本批其他頁轉出（Q&A 題目重複）且沒有清單目標可比對 ⇒ 不重複出草稿
  if (pr.outputs.length && pr.outputs.every((o) => o.role === 'duplicate') && !pr.targetExists) return 'skip-duplicate';
  if (pr.kind === 'list' && !pr.stats.attachments && !pr.stats.images) return 'skip-list';
  if (pr.needsReview) return 'manual-review';
  if (pr.kind === 'disease-block') return 'merge-into-disease';
  if (pr.existing) return 'compare-existing';
  if (pr.flags.old) return 'archive';
  if (pr.kind === 'news' && pr.confidence >= (rules.thresholds?.autoConfidence ?? 0.8) && !pr.issues.some((i) => i.severity !== 'info')) return 'auto-ok';
  return 'review-before-publish';
}

function summarize({ prs, draftRecs, bags, patch, manifest, exp, exportedAt }) {
  const byType = {};
  for (const d of draftRecs) byType[d.type] = (byType[d.type] ?? 0) + 1;
  const byKind = {};
  for (const p of prs) byKind[p.kind] = (byKind[p.kind] ?? 0) + 1;
  const byAction = {};
  for (const p of prs) byAction[p.action] = (byAction[p.action] ?? 0) + 1;
  const asset = { total: 0, attachment: 0, image: 0, data: 0, needsAlt: 0, noTextLayer: 0 };
  for (const b of bags.values()) { const s = b.summary(); for (const k of Object.keys(asset)) asset[k] += s[k]; }
  const avg = prs.length ? Math.round((prs.reduce((a, p) => a + p.confidence, 0) / prs.length) * 100) / 100 : 0;
  return {
    pages: prs.length, drafts: draftRecs.length, mergedPages: prs.filter((p) => p.kind === 'disease-block').length,
    byType, byKind, byAction, avgConfidence: avg, needsReview: prs.filter((p) => p.needsReview).length,
    existing: prs.filter((p) => p.existing).length, schemaInvalid: draftRecs.filter((d) => !d.schemaValid).length,
    assets: asset, issues: { error: prs.flatMap((p) => p.issues).filter((i) => i.severity === 'error').length, warn: prs.flatMap((p) => p.issues).filter((i) => i.severity === 'warn').length, info: prs.flatMap((p) => p.issues).filter((i) => i.severity === 'info').length },
    manifest: manifest ? { items: manifest.data.items.length, matched: patch.summary.matched, missingPages: patch.summary.missingPages, derivedItems: patch.summary.derivedItems ?? 0, derivedMatched: patch.summary.derivedMatched ?? 0 } : null,
    // 資料產生頁本來就不出草稿（第九批），不算「沒有輸出」
    generated: prs.filter((p) => p.flags.generated).length,
    exportedAt, pagesWithoutOutput: prs.filter((p) => !p.outputs.length && !p.flags.generated).length,
  };
}

export { findExportFile, parseDate, textOf };
