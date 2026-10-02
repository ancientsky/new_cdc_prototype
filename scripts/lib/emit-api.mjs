// v1/*.json 輸出（ARCHITECTURE.md 4.2、附錄 B）
// 外殼：{ meta: { api, generatedAt, buildDate, license, source, docs, etag, lastModified, count?, ... }, data }
// 靜態站無法送 ETag／Last-Modified header → meta.etag（data 內容 sha1 前 12 碼）與 meta.lastModified（集合最大 reviewedAt）。
import { createHash } from 'node:crypto';
import { config, siteOrigin } from '../../site.config.mjs';
import { pathOf, mdPathOf, WHITELIST_REASON_LABELS, LIFECYCLE_LABELS, TODO_KIND_LABELS, NOTICE_TYPES } from './governance.mjs';
import { buildOpenApi } from './openapi.mjs';

export const etagOf = (data) => createHash('sha1').update(JSON.stringify(data) ?? 'null').digest('hex').slice(0, 12);
const absUrl = (p) => (p == null ? null : /^https?:/.test(p) ? p : `${siteOrigin()}${p}`);
const maxDate = (dates) => dates.filter(Boolean).sort().at(-1) ?? null;

/** 從資料推算 lastModified：陣列取各筆 reviewedAt／lastUpdated／publishedAt 最大值 */
export function lastModifiedOf(data) {
  const pick = (x) => (x && typeof x === 'object' ? x.reviewedAt ?? x.governance?.reviewedAt ?? x.lastUpdated ?? x.publishedAt ?? x.updatedAt ?? null : null);
  if (Array.isArray(data)) return maxDate(data.map(pick));
  return pick(data);
}

export function wrap(site, data, extra = {}, top = {}) {
  site.generatedAt ??= new Date().toISOString();
  const meta = {
    api: 'v1', generatedAt: site.generatedAt, buildDate: site.today, license: 'OGDL-1.0', licenseUrl: 'https://data.gov.tw/license',
    source: `${siteOrigin()}/`, docs: `${siteOrigin()}/developers/`, openapi: `${siteOrigin()}/openapi.json`,
    etag: etagOf(data), lastModified: lastModifiedOf(data) ?? site.today,
    ...(Array.isArray(data) ? { count: data.length } : {}),
    ...extra,
  };
  return JSON.stringify({ meta, data, ...top }, null, 2);
}

/** 每筆內容的治理摘要（API、catalog 共用） */
export function govSummary(item) {
  const g = item.gov;
  return {
    owner: item.owner, ownerName: g.ownerName, steward: item.steward ?? null,
    reviewedAt: item.reviewedAt, reviewPeriodMonths: item.reviewPeriodMonths, nextReviewAt: g.nextReviewAt, daysToReview: g.daysToReview, overdue: g.overdue, dueSoon: g.dueSoon,
    status: item.status, lifecycle: g.lifecycle, lifecycleLabel: g.lifecycleLabel,
    whitelist: g.whitelist.effective, whitelistTier: g.whitelist.tier, whitelistPublic: g.whitelist.public, whitelistReasons: g.whitelist.reasons, whitelistReasonLabels: g.whitelist.reasonLabels,
    isCurrent: g.isCurrent, superseded: g.superseded, supersededBy: g.supersededBy, currentId: g.currentId, noindex: g.noindex,
    stale: g.stale, basisRevisions: g.basisRevisions, predatesBasis: g.predatesBasis,
    annotations: g.annotations, reverseAuditHits: g.reverseAuditHits.length,
    ...(g.deadlineAt !== undefined ? { deadlineAt: g.deadlineAt, daysToDeadline: g.daysToDeadline, closed: g.closed, closingSoon: g.closingSoon } : {}),
    ...(g.ended !== undefined ? { ended: g.ended, upcoming: g.upcoming } : {}),
    ...(g.mediaOutdated !== undefined ? { mediaOutdated: g.mediaOutdated, hasTranscript: g.hasTranscript } : {}),
    ...(g.campaignStatus ? { campaignStatus: g.campaignStatus } : {}),
    ...(g.linkHealth?.total ? { linkHealth: g.linkHealth } : {}),
    ...(g.labtestCheck ? { labtestCheck: g.labtestCheck } : {}),
    license: item.license, licenseNote: item.licenseNote ?? null, sensitivity: item.sensitivity, sourceHash: item.sourceHash,
    languages: item.languages, translationStale: g.translationStale, renderableLangs: g.renderableLangs,
  };
}

/** 內容的 API 表示：去掉 __file 與內部 gov；i18n 原文保留；加 governance、url、md */
export function apiItem(item) {
  const { __file, gov, ...rest } = item;
  const path = pathOf(item);
  const md = mdPathOf(item);
  return { ...rest, url: absUrl(path), path, md: md ? absUrl(md) : null, governance: govSummary(item) };
}
const strip = apiItem;
const noFile = (o) => { if (!o || typeof o !== 'object') return o; const { __file, ...r } = o; return r; };
const brief = (i) => ({ id: i.id, type: i.type, title: i.title, summary: i.summary, url: absUrl(pathOf(i)), path: pathOf(i), reviewedAt: i.reviewedAt, owner: i.owner, ownerName: i.gov.ownerName, lifecycle: i.gov.lifecycle, whitelist: i.gov.whitelist.effective });

export const CATEGORY_OF = {
  disease: 'content-page', faq: 'content-page', vaccine: 'content-page', clarification: 'content-page', page: 'content-page', banner: 'content-page',
  news: 'press', letter: 'press', document: 'document-library',
  media: 'media', topic: 'content-page', service: 'content-page', publication: 'document-library', labtest: 'content-page', research: 'document-library',
};
/** 七類資產（7.7 第 1 點：原五類＋新聞稿、影音宣導素材） */
export const ASSET_CATEGORIES = {
  'open-dataset': '開放資料集', 'stats-system': '統計查詢系統', 'structured-table': '結構化表格', 'document-library': '文件庫',
  'content-page': '內容頁', press: '新聞稿／公告', media: '影音宣導素材',
};
/** 內容的關聯疾病（diseases[]、labtest.disease、出版品篇目、專區 contentIds） */
export function diseasesOf(item) {
  const set = new Set(item.diseases ?? []);
  if (item.disease) set.add(item.disease);
  for (const a of item.articles ?? []) for (const d of a.diseases ?? []) set.add(d);
  for (const id of item.contentIds ?? []) if (String(id).startsWith('disease.')) set.add(id);
  return [...set];
}

/** 301 對照表：失效版 → 現行版；family 穩定網址 → 現行版；現行官網 legacyUrls → 新路徑 */
export function buildRedirects(site) {
  const out = [];
  for (const f of site.gov.families) {
    const cur = f.current ? site.byId.get(f.current) : null;
    if (!cur) continue;
    out.push({ from: `/documents/${f.family.replace(/^doc\./, '')}/`, to: pathOf(cur), toUrl: absUrl(pathOf(cur)), status: 302, kind: 'family-latest', itemId: cur.id, note: '版本族穩定網址，永遠指向現行版' });
    for (const v of f.versions) {
      if (!v.superseded) continue;
      out.push({ from: v.href, to: pathOf(cur), toUrl: absUrl(pathOf(cur)), status: 301, kind: 'superseded', itemId: v.id, currentId: cur.id, retained: true,
        note: '失效版：原頁保留存取（noindex＋頁首警示），搜尋與 AI 引用一律以現行版為準；正式站外部舊連結以 301 轉址' });
    }
  }
  for (const item of site.all) {
    if (item.status !== 'published' && item.status !== 'archived') continue;
    const target = item.gov.superseded ? site.byId.get(item.gov.currentId) ?? item : item;
    for (const from of item.legacyUrls ?? []) {
      out.push({ from, to: pathOf(target), toUrl: absUrl(pathOf(target)), status: 301, kind: 'legacy', itemId: item.id, ...(target !== item ? { currentId: target.id, archivedAt: pathOf(item) } : {}) });
    }
  }
  return out;
}

export function emitApi(site, write) {
  const c = site.collections;
  const manifest = [];
  const put = (file, data, extra, top, description) => {
    write(file, wrap(site, data, extra, top));
    manifest.push({ path: `/${file}`, url: absUrl(`/${file}`), description: description ?? '', count: Array.isArray(data) ? data.length : null });
  };
  const published = (arr) => (arr ?? []).filter((i) => i.status === 'published' || i.status === 'archived');

  // 疾病：主檔 + 疾病頁
  const pageById = new Map(c.diseases.map((p) => [p.id, p]));
  const related = new Map(); // disease id → { faq, news, documents, vaccines, datasets, clarifications, media, labtests, services, publications, topics }
  const RELATED_KEY = { faq: 'faq', news: 'news', letter: 'news', document: 'documents', vaccine: 'vaccines', dataset: 'datasets', clarification: 'clarifications', media: 'media', labtest: 'labtests', service: 'services', publication: 'publications', topic: 'topics' };
  for (const item of site.all) {
    if (item.status !== 'published' || item.gov.superseded) continue;
    for (const d of diseasesOf(item)) {
      if (!related.has(d)) related.set(d, { faq: [], news: [], documents: [], vaccines: [], datasets: [], clarifications: [], media: [], labtests: [], services: [], publications: [], topics: [] });
      const key = RELATED_KEY[item.type];
      if (key) related.get(d)[key].push(brief(item));
    }
  }
  put('v1/diseases.json', site.master.diseases.map((d) => {
    const p = pageById.get(d.id);
    return { ...d, page: p && p.status === 'published' ? absUrl(pathOf(p)) : null, path: p ? pathOf(p) : null, api: p ? absUrl(`/v1/diseases/${p.slug}.json`) : null, governance: p ? govSummary(p) : null };
  }), {}, {}, '傳染病主檔（含疾病頁連結與治理摘要）');
  for (const d of c.diseases) {
    put(`v1/diseases/${d.slug}.json`, { ...strip(d), master: site.diseaseMasterById.get(d.id) ?? null, related: related.get(d.id) ?? null }, {}, {}, `疾病頁：${d.title}`);
  }
  put('v1/vaccines.json', published(c.vaccines).map(strip), {}, {}, '疫苗頁');
  put('v1/faq.json', published(c.faq).map(strip), {}, {}, 'Q&A');
  put('v1/news.json', [...published(c.news)].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.id.localeCompare(b.id)).slice(0, 200).map(strip), {}, {}, '新聞稿／通函（近 200 則，含自動加註）');
  put('v1/documents.json', [...published(c.documents)].sort((a, b) => (a.family ?? '').localeCompare(b.family ?? '') || (a.effectiveAt ?? '').localeCompare(b.effectiveAt ?? '')).map(strip), {}, { families: site.gov.families }, '文件全部版本（isCurrent、supersedes、supersededBy）；families 為版本鏈');
  put('v1/clarifications.json', published(c.clarifications).map(strip), {}, {}, '謠言澄清');

  // 態勢層
  const sit = site.situation ?? {};
  put('v1/situation.json', {
    ...noFile(sit), history: (sit.history ?? []).map((h) => ({ publishedAt: h.publishedAt, dataDate: h.dataDate, items: (h.items ?? []).map((it) => ({ disease: it.disease, status: it.status })) })),
    items: (sit.items ?? []).map((it) => ({ ...it, diseaseName: site.diseaseMasterById.get(it.disease)?.name, slug: site.diseaseMasterById.get(it.disease)?.slug, page: pageById.has(it.disease) ? absUrl(pathOf(pageById.get(it.disease))) : null })),
    governance: site.gov.situation,
  }, { lastModified: sit.publishedAt ?? site.today }, {}, '疫情態勢層（疫情中心人工發布）');
  const snap = (s) => s ?? { meta: { mode: 'missing' }, data: [] };
  const ta = snap(site.snapshots?.travelAlerts), cl = snap(site.snapshots?.countryLevels);
  put('v1/travel-alerts.json', ta.data ?? [], { provenance: ta.meta, lastModified: ta.meta?.fetchedAt?.slice?.(0, 10) ?? site.today }, {}, '國際旅遊疫情建議（快照或每日抓取）');
  put('v1/country-levels.json', cl.data ?? [], { provenance: cl.meta, lastModified: cl.meta?.fetchedAt?.slice?.(0, 10) ?? site.today }, {}, '各國疫情等級');
  put('v1/datasets.json', published(c.datasets).map(strip), {}, {}, '資料目錄（CKAN 快照＋治理欄位）');
  put('v1/glossary.json', site.master.glossary ?? [], { lastModified: site.today }, {}, '七語詞彙主檔');
  put('v1/units.json', site.master.units ?? [], { lastModified: site.today }, {}, '權責單位');
  put('v1/countries.json', site.master.countries ?? [], { lastModified: site.today }, {}, '國家主檔');
  // ── 第二輪：影音、專區、申請服務、出版品、檢驗、研究、公告、通報時限、宣導檔期 ──
  const byPubDesc = (a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? '') || a.id.localeCompare(b.id);
  put('v1/media.json', [...published(c.media)].sort(byPubDesc).map(strip), {}, {}, '影音宣導素材（含逐字稿、章節、依據正本與是否過時）');
  put('v1/topics.json', [...published(c.topics)].sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99) || a.id.localeCompare(b.id)).map(strip), {}, {}, '專區／專題（ended＝已結束；links 含外部連結檢查狀態）');
  put('v1/services.json', [...published(c.services)].sort((a, b) => a.id.localeCompare(b.id)).map(strip), {}, {}, '申請／服務（步驟、應備文件、處理天數、表單）');
  const pubs = [...published(c.publications)].sort((a, b) => (a.series ?? '').localeCompare(b.series ?? '') || String(b.volume ?? '').localeCompare(String(a.volume ?? ''), undefined, { numeric: true }) || String(b.issue ?? '').localeCompare(String(a.issue ?? ''), undefined, { numeric: true }) || byPubDesc(a, b));
  const seriesMap = new Map();
  for (const p of pubs) {
    const k = p.series ?? '其他';
    if (!seriesMap.has(k)) seriesMap.set(k, { series: k, seriesEn: p.seriesEn ?? null, pubType: p.pubType ?? null, issn: p.issn ?? null, count: 0, latest: null, items: [] });
    const g = seriesMap.get(k);
    g.count++; g.items.push(p.id);
    if (!g.latest || (p.publishedAt ?? '') > (site.byId.get(g.latest)?.publishedAt ?? '')) g.latest = p.id;
  }
  put('v1/publications.json', pubs.map(strip), {}, { series: [...seriesMap.values()] }, '出版品（書目完整；series 為系列分組）');
  put('v1/labtests.json', [...published(c.labtests)].sort((a, b) => a.id.localeCompare(b.id)).map((l) => ({ ...strip(l), master: noFile(site.diseaseMasterById.get(l.disease)) ?? null })), {}, {}, '檢驗項目（疾病 × 檢體 × 容器 × 保存運送 × 時限；含與通報時限一致性）');
  put('v1/research.json', [...published(c.research)].sort((a, b) => (b.year ?? 0) - (a.year ?? 0) || a.id.localeCompare(b.id)).map(strip), {}, {}, '研究計畫（年度、狀態、成果報告、資料集）');
  const notices = published(c.news).filter((n) => NOTICE_TYPES.has(n.newsType))
    .sort((a, b) => (a.gov.closed - b.gov.closed) || (a.gov.closed ? (b.deadlineAt ?? '').localeCompare(a.deadlineAt ?? '') : (a.deadlineAt ?? '9999').localeCompare(b.deadlineAt ?? '9999')) || byPubDesc(a, b))
    .map((n) => ({ ...strip(n), closed: !!n.gov.closed, closingSoon: !!n.gov.closingSoon, daysToDeadline: n.gov.daysToDeadline ?? null }));
  put('v1/notices.json', notices, { open: notices.filter((n) => !n.closed).length, closed: notices.filter((n) => n.closed).length }, {}, '機關公告：人才招募、採購公告、其他訊息（closed＝已截止；進行中依截止日排序）');
  const nt = site.gov.notifyTable ?? [];
  put('v1/notify-table.json', nt, { lastModified: site.today, diseases: nt.reduce((n, g) => n + g.diseases.length, 0), source: `${siteOrigin()}/report/` }, {}, '法定傳染病通報時限表（由傳染病主檔自動產生）');
  const STATUS_ORDER = { active: 0, upcoming: 1, ended: 2 };
  const campaigns = (c.banners ?? []).filter((b) => b.status === 'published' || b.status === 'archived')
    .sort((a, b) => STATUS_ORDER[a.gov.campaignStatus] - STATUS_ORDER[b.gov.campaignStatus] || (a.priority ?? 99) - (b.priority ?? 99) || (b.startAt ?? '').localeCompare(a.startAt ?? ''))
    .map((b) => ({ ...strip(b), campaignStatus: b.gov.campaignStatus }));
  put('v1/campaigns.json', campaigns, { active: campaigns.filter((x) => x.campaignStatus === 'active').length, upcoming: campaigns.filter((x) => x.campaignStatus === 'upcoming').length, ended: campaigns.filter((x) => x.campaignStatus === 'ended').length }, {}, '全部宣導 Banner（campaignStatus：active／upcoming／ended）');

  put('v1/banners.json', (c.banners ?? []).filter((b) => b.status === 'published' && b.startAt <= site.today && b.endAt >= site.today).sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99)).map(strip), {}, {}, '目前上架中的首頁 Banner');

  // 五類資產總目錄
  const catalog = site.all.filter((i) => i.status === 'published').map((i) => ({
    id: i.id, type: i.type, category: i.category ?? CATEGORY_OF[i.type] ?? 'content-page', title: i.title, owner: i.owner, ownerName: i.gov.ownerName,
    canonicalUrl: i.canonicalUrl ?? absUrl(pathOf(i)), page: absUrl(pathOf(i)), md: mdPathOf(i) ? absUrl(mdPathOf(i)) : null,
    license: i.license, sensitivity: i.sensitivity, reviewedAt: i.reviewedAt, nextReviewAt: i.gov.nextReviewAt, lifecycle: i.gov.lifecycle,
    isCurrent: i.gov.isCurrent, whitelist: i.gov.whitelist.effective, languages: i.gov.renderableLangs, legacyUrls: i.legacyUrls ?? [],
  }));
  const categories = Object.entries(ASSET_CATEGORIES).map(([key, label]) => ({ key, label, count: catalog.filter((x) => x.category === key).length }));
  put('v1/catalog.json', catalog, { categories }, {}, '七類資產總目錄（開放資料集、統計查詢系統、結構化表格、文件庫、內容頁、新聞稿／公告、影音宣導素材）');

  // 搜尋（靜態版＝答案單元索引）
  const si = site.searchIndex ?? { public: [], pro: [] };
  put('v1/search-index.json', si.public, { lastModified: lastModifiedOf(si.public) ?? site.today }, {}, '答案單元索引（民眾，只含白名單）');
  put('v1/search-index-pro.json', si.pro, { lastModified: lastModifiedOf(si.pro) ?? site.today }, {}, '答案單元索引（專業，只含現行版）');
  put('v1/search.json', {
    endpoint: absUrl('/v1/search-index.json'), proEndpoint: absUrl('/v1/search-index-pro.json'),
    description: '靜態站沒有伺服器端搜尋：/v1/search 即答案單元索引（search-index.json）。下載後於用戶端以 bigram＋詞彙主檔同義詞＋BM25 檢索；只含 AI 白名單內容，失效版本不在索引中。',
    chunks: si.public.length, chunksPro: si.pro.length,
    chunkFields: ['id', 'contentId', 'type', 'lang', 'title', 'text', 'sentences', 'url', 'owner', 'ownerName', 'reviewedAt', 'nextReviewAt', 'audience', 'tasks', 'diseases', 'vaccines', 'countries', 'version', 'effectiveAt', 'isCurrent', 'whitelist', 'terms'],
    glossary: absUrl('/v1/glossary.json'), ui: absUrl('/ask/'),
  }, { aliasOf: '/v1/search-index.json', lastModified: site.today }, {}, '搜尋端點說明（＝search-index 別名）');

  // 六任務入口聚合
  for (const task of config.tasks) {
    const items = site.all.filter((i) => i.status === 'published' && !i.gov.superseded && (i.tasks ?? []).includes(task.key) && i.type !== 'banner')
      .sort((a, b) => (b.reviewedAt ?? '').localeCompare(a.reviewedAt ?? '') || a.id.localeCompare(b.id));
    const byType = {};
    for (const i of items) (byType[i.type] ??= []).push(brief(i));
    const extra = task.key === 'situation' ? { situation: (sit.items ?? []).map((it) => ({ disease: it.disease, diseaseName: site.diseaseMasterById.get(it.disease)?.name, status: it.status, metricLabel: it.metricLabel, metricValue: it.metricValue })) } : {};
    put(`v1/tasks/${task.key}.json`, { key: task.key, label: task.label, sub: task.sub, page: absUrl(`/tasks/${task.key}/`), count: items.length, items: items.map(brief), byType, ...extra },
      { lastModified: lastModifiedOf(items) ?? site.today }, {}, `任務入口：${task.label}`);
  }

  // 301 對照
  put('v1/redirects.json', buildRedirects(site), { lastModified: site.today }, {}, '舊版／舊網址 → 正本對照（301）');

  // 治理
  const todos = site.gov.todos;
  put('v1/governance/kpi.json', site.gov.kpi, { lastModified: site.today, quarter: quarterOf(site.today) }, {}, '品質指標（7.5 全列）');
  put('v1/governance/todos.json', todos, { lastModified: site.today, overdue: todos.filter((t) => t.overdue).length, kindLabels: TODO_KIND_LABELS }, {}, '治理待辦');
  put('v1/governance/summary.json', site.gov.summary, { lastModified: site.today }, {}, '治理儀表板數字');
  put('v1/governance/by-owner.json', site.gov.byOwner, { lastModified: site.today }, {}, '各權責單位待辦／逾期／白名單／內容數');
  const lh = site.gov.linkHealth ?? {};
  put('v1/governance/links.json', site.gov.externalLinks ?? [], { lastModified: lh.lastCheckedAt ?? site.today, ok: lh.ok ?? 0, broken: lh.broken ?? 0, unchecked: lh.unchecked ?? 0, checker: 'node scripts/fetch-data.mjs --check-links' }, {}, '外部連結健康（status：ok／broken／unchecked）');
  put('v1/governance/ai-status.json', site.governance.aiStatus, { lastModified: site.governance.aiStatus?.updatedAt?.slice?.(0, 10) ?? site.today }, {}, 'AI 問答開關');
  put('v1/governance/whitelist.json', {
    policy: site.governance.whitelist, reasonLabels: WHITELIST_REASON_LABELS, lifecycleLabels: LIFECYCLE_LABELS,
    effective: site.gov.whitelistCount, totalPublished: site.gov.totalPublished,
    items: site.all.map((i) => ({ id: i.id, type: i.type, title: i.title, owner: i.owner, tier: i.gov.whitelist.tier, requested: i.gov.whitelist.requested, effective: i.gov.whitelist.effective, public: i.gov.whitelist.public, reasons: i.gov.whitelist.reasons, reasonLabels: i.gov.whitelist.reasonLabels, lifecycle: i.gov.lifecycle })),
  }, { lastModified: site.governance.whitelist?.approvedAt ?? site.today }, {}, 'AI 白名單政策與每筆狀態');
  put('v1/governance/eval-set.json', site.governance.evalSet, { lastModified: site.today }, {}, '評估集');
  put('v1/governance/eval-report.json', site.evalReport ?? null, { lastModified: site.today }, {}, '評估報告');

  // 端點索引 + OpenAPI
  put('v1/index.json', manifest.slice(), { lastModified: site.today }, {}, '端點清單');
  write('openapi.json', JSON.stringify(buildOpenApi(site), null, 2));
  return manifest;
}

function quarterOf(iso) { const [y, m] = iso.split('-').map(Number); return `${y}Q${Math.ceil(m / 3)}`; }
