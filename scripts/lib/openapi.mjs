// OpenAPI 3.1 描述 v1/ 全部端點。schema 直接由 schemas/*.json（JSON Schema 2020-12）轉入 components.schemas，
// $ref 改寫為 #/components/schemas/<Name>；$defs 提升為獨立 component。
import fs from 'node:fs';
import path from 'node:path';
import { config, siteOrigin } from '../../site.config.mjs';
import { ROOT } from './load.mjs';

const SCHEMA_DIR = path.join(ROOT, 'schemas');
const pascal = (s) => s.replace(/^_/, '').replace(/(^|[-_])([a-z0-9])/g, (_, __, c) => c.toUpperCase());
const NAME_OF_FILE = { _common: 'ContentCommon', faq: 'Faq' };
const nameOfFile = (base) => NAME_OF_FILE[base] ?? pascal(base);
const ref = (name) => ({ $ref: `#/components/schemas/${name}` });

/** 讀 schemas/*.json → components.schemas */
export function schemaComponents() {
  const out = {};
  if (!fs.existsSync(SCHEMA_DIR)) return out;
  for (const f of fs.readdirSync(SCHEMA_DIR).filter((x) => x.endsWith('.json')).sort()) {
    const base = f.replace(/\.json$/, '');
    const name = nameOfFile(base);
    const raw = JSON.parse(fs.readFileSync(path.join(SCHEMA_DIR, f), 'utf8'));
    const rewrite = (node) => {
      if (Array.isArray(node)) return node.map(rewrite);
      if (!node || typeof node !== 'object') return node;
      const o = {};
      for (const [k, v] of Object.entries(node)) {
        if (k === '$id' || k === '$schema' || k === '$defs') continue;
        if (k === '$ref' && typeof v === 'string') { o.$ref = rewriteRef(v, name); continue; }
        o[k] = rewrite(v);
      }
      return o;
    };
    for (const [def, schema] of Object.entries(raw.$defs ?? {})) out[pascal(def)] = rewrite(schema);
    const body = rewrite(raw);
    if (Object.keys(body).some((k) => !['title', 'description'].includes(k))) out[name] = body;
  }
  return out;
}

function rewriteRef(v, selfName) {
  const m = v.match(/^(?:https:\/\/cdc-prototype\/schemas\/)?([^#]*?)(?:\.json)?(#.*)?$/);
  const file = m?.[1] ?? '';
  const frag = m?.[2] ?? '';
  const def = frag.match(/^#\/\$defs\/([^/]+)(.*)$/);
  if (def) return `#/components/schemas/${pascal(def[1])}${def[2]}`;
  const target = file ? nameOfFile(file) : selfName;
  return `#/components/schemas/${target}${frag.replace(/^#/, '')}`;
}

const META = {
  type: 'object', required: ['api', 'generatedAt', 'license', 'etag', 'lastModified'],
  properties: {
    api: { const: 'v1' }, generatedAt: { type: 'string', format: 'date-time' }, buildDate: { type: 'string', format: 'date' },
    license: { type: 'string' }, licenseUrl: { type: 'string', format: 'uri' }, source: { type: 'string', format: 'uri' }, docs: { type: 'string', format: 'uri' }, openapi: { type: 'string', format: 'uri' },
    etag: { type: 'string', description: '本檔 data 內容 sha1 前 12 碼（靜態站無法送 ETag header，請以此判斷是否變更）', pattern: '^[0-9a-f]{12}$' },
    lastModified: { type: ['string', 'null'], description: '集合內最大 reviewedAt（或資料日）' },
    count: { type: 'integer' }, provenance: { type: 'object' }, aliasOf: { type: 'string' },
  },
};
const GOV = {
  type: 'object', description: '治理摘要（由治理引擎計算，不手填）',
  properties: {
    owner: { type: 'string' }, ownerName: { type: 'string' }, reviewedAt: { type: 'string', format: 'date' }, nextReviewAt: { type: ['string', 'null'], format: 'date' },
    overdue: { type: 'boolean' }, lifecycle: { enum: ['current', 'superseded', 'overdue', 'based-on-revised', 'draft', 'archived', 'scheduled', 'closed', 'ended'] }, lifecycleLabel: { type: 'string' },
    whitelist: { type: 'boolean' }, whitelistTier: { enum: ['public', 'pro', null] }, whitelistReasons: { type: 'array', items: { type: 'string' } },
    isCurrent: { type: 'boolean' }, superseded: { type: 'boolean' }, supersededBy: { type: ['string', 'null'] }, noindex: { type: 'boolean' },
    stale: { type: 'array', items: { type: 'object' } }, annotations: { type: 'array', items: { type: 'object', properties: { kind: { type: 'string' }, level: { enum: ['danger', 'warning', 'info'] }, text: { type: 'string' }, href: { type: ['string', 'null'], description: '目標內容 id' }, targetId: { type: ['string', 'null'] }, path: { type: ['string', 'null'], description: '目標前台路徑' } } } },
    translationStale: { type: 'object', additionalProperties: { type: 'boolean' } }, renderableLangs: { type: 'array', items: { type: 'string' } },
    deadlineAt: { type: ['string', 'null'], format: 'date', description: '公告截止日（news）' }, daysToDeadline: { type: ['integer', 'null'] },
    closed: { type: 'boolean', description: '公告已截止（不退白名單）' }, closingSoon: { type: 'boolean', description: '7 日內截止' },
    ended: { type: 'boolean', description: '專區已結束（topic.endAt < today）' }, upcoming: { type: 'boolean' },
    mediaOutdated: { type: 'boolean', description: '影音製作日早於依據正本現行版生效日' }, hasTranscript: { type: 'boolean' },
    campaignStatus: { enum: ['active', 'upcoming', 'ended'] },
    linkHealth: { type: 'object', properties: { total: { type: 'integer' }, ok: { type: 'integer' }, broken: { type: 'integer' }, unchecked: { type: 'integer' } } },
    labtestCheck: { type: 'object', properties: { disease: { type: 'string' }, notifyWithinHours: { type: ['integer', 'null'] }, sendWithinHours: { type: ['integer', 'null'] }, consistent: { type: 'boolean' }, diseasePage: { type: ['string', 'null'] }, diseaseSpecimen: { type: 'boolean' } } },
    jobStage: { enum: ['upcoming', 'open', 'closed', 'screening', 'result', 'filled', 'cancelled'], description: '職缺階段（第七輪 R17）：manualStatus ＞ result ＞ today < applyStart（upcoming）＞ today ≤ deadlineAt（open）＞ examPlan 有 date ≤ today（screening）＞ closed' },
    jobStageLabel: { type: 'string' }, jobTab: { enum: ['open', 'upcoming', 'review', 'result', 'history'], description: '/careers/ 頁籤；result 公告超過 90 天、filled、cancelled ⇒ history' },
    archivedStage: { type: 'boolean', description: '職缺甄選結果公告超過 90 天（移入歷史）' }, resultOverdue: { type: 'boolean', description: 'today > resultPlannedAt + 7 且無 result' }, resultDueAt: { type: ['string', 'null'] },
    resultUnpublishAt: { type: ['string', 'null'], description: '第三十輪：甄選結果下架日（result.unpublishAt）' }, resultTakenDown: { type: 'boolean', description: 'today ≥ unpublishAt：名單已不輸出' }, resultExternal: { type: 'boolean', description: '名單在人事系統（result.externalUrl），本站不存名單' },
    applyHref: { type: ['string', 'null'], description: '報名入口：外部 applyUrl，或本站 /careers/{slug}/apply/（applyMethod online 且無 applyUrl）' },
    tenderStage: { enum: ['open', 'closed', 'opened', 'awarded', 'failed', 'cancelled'], description: '採購階段（第七輪 R18）：manualStatus ＞ award（awarded）＞ today ≤ deadlineAt（open）＞ today ≥ openingAt（opened）＞ closed' },
    tenderStageLabel: { type: 'string' }, tenderTab: { enum: ['open', 'closed', 'opened', 'awarded', 'failed'] },
    awardOverdue: { type: 'boolean', description: 'openingAt + 30 日仍無 award 且非 failed／cancelled' }, awardDueAt: { type: ['string', 'null'] },
  },
};
const TIMELINE = { type: 'array', description: '時間軸（模板用）：done＝已發生、current＝目前階段', items: { type: 'object', properties: { key: { type: 'string' }, label: { type: 'string' }, date: { type: ['string', 'null'] }, endDate: { type: 'string' }, planned: { type: 'boolean' }, done: { type: 'boolean' }, current: { type: 'boolean' }, note: { type: ['string', 'null'] } } } };
const EXTRA = {
  Meta: META,
  Governance: GOV,
  ApiFields: { type: 'object', properties: { url: { type: 'string', format: 'uri' }, path: { type: 'string' }, md: { type: ['string', 'null'] }, governance: ref('Governance') } },
  Chunk: { type: 'object', description: '答案單元（ARCHITECTURE 5.1）', required: ['id', 'contentId', 'type', 'title', 'text', 'url'], properties: { id: { type: 'string' }, contentId: { type: 'string' }, type: { type: 'string' }, lang: { type: 'string' }, title: { type: 'string' }, text: { type: 'string' }, sentences: { type: 'array', items: { type: 'string' } }, url: { type: 'string' }, owner: { type: 'string' }, ownerName: { type: 'string' }, reviewedAt: { type: 'string' }, nextReviewAt: { type: ['string', 'null'] }, isCurrent: { type: 'boolean' }, whitelist: { type: 'boolean' }, terms: { type: 'array', items: { type: 'string' } } } },
  Todo: { type: 'object', required: ['id', 'kind', 'itemId', 'owner', 'dueAt', 'text'], properties: { id: { type: 'string' }, kind: { enum: ['based-on-revised', 'overdue', 'translation-stale', 'license-missing', 'dataset-overdue', 'reverse-audit', 'superseded-still-linked', 'situation-overdue', 'media-outdated', 'media-no-transcript', 'link-broken', 'labtest-inconsistent', 'migration-pending', 'job-result-overdue', 'job-waitlist-expiring', 'job-apply-url-dead', 'job-result-unpublish', 'tender-award-overdue', 'attachment-no-accessible-version', 'image-license-missing', 'asset-orphan', 'post-publish-review'] }, itemId: { type: 'string' }, itemTitle: { type: 'string' }, owner: { type: 'string' }, ownerName: { type: 'string' }, dueAt: { type: ['string', 'null'] }, overdue: { type: 'boolean' }, text: { type: 'string' }, href: { type: 'string' }, severity: { enum: ['high', 'medium', 'low'] }, count: { type: 'integer', description: 'migration-pending：本清單待移轉筆數（每份清單聚合一則）' }, listId: { type: 'string' }, legalCategory: { type: ['integer', 'null'] }, noPage: { type: 'boolean' } } },
  Kpi: { type: 'object', required: ['key', 'label', 'current', 'unit'], properties: { key: { type: 'string' }, label: { type: 'string' }, current: { type: ['number', 'null'] }, numerator: { type: ['number', 'null'] }, denominator: { type: ['number', 'null'] }, pct: { type: ['number', 'null'] }, target1y: { type: ['number', 'null'] }, target3y: { type: ['number', 'null'] }, unit: { type: 'string' }, direction: { enum: ['higher', 'lower'] }, status: { enum: ['ok', 'warn', 'bad', 'pending', 'info'] }, note: { type: 'string' } } },
  CatalogEntry: { type: 'object', properties: { id: { type: 'string' }, type: { type: 'string' }, category: { type: 'string' }, title: { type: 'string' }, owner: { type: 'string' }, canonicalUrl: { type: 'string' }, license: { type: 'string' }, sensitivity: { type: 'string' }, reviewedAt: { type: 'string' }, nextReviewAt: { type: ['string', 'null'] }, whitelist: { type: 'boolean' }, isCurrent: { type: 'boolean' }, legacyUrls: { type: 'array', items: { type: 'string' } } } },
  Redirect: { type: 'object', required: ['from', 'to', 'status', 'kind'], properties: {
    from: { type: 'string', description: 'legacy：現行官網完整網址；migration：舊網址去網域與 hash 後的 path＋query；其他：新站路徑' }, fromPath: { type: 'string', description: 'legacy：from 去網域與 hash' },
    to: { type: 'string', description: '新站路徑（不含 basePath；migration 可含 #錨點）' }, toUrl: { type: 'string' }, status: { enum: [301, 302] },
    kind: { enum: ['superseded', 'legacy', 'family-latest', 'migration', 'moved'], description: 'moved＝新站內部換型別搬家（第七輪：/news/{舊 slug}/ → /careers/{slug}/、/procurement/{slug}/），legacyId 為舊內容 id' }, legacyId: { type: 'string' }, itemId: { type: ['string', 'null'], description: '實際導向的內容 id（移轉到站內共用頁、無對應內容時為 null）' }, currentId: { type: 'string' }, retained: { type: 'boolean' },
    pattern: { type: 'boolean', description: '舊網址含 {id} 佔位（URL 模式）：只進文件，不進伺服器對照檔與 legacy-map' },
    verified: { type: 'boolean', description: 'migration：權責單位已核對舊網址與對應' }, listId: { type: 'string', description: 'migration：移轉清單 id' }, key: { type: 'string', description: 'migration：清單內舊頁 key' },
    oldUrl: { type: 'string' }, oldTitle: { type: 'string' }, migrationStatus: { enum: ['migrated', 'merged', 'archived', 'pending'] }, targetId: { type: ['string', 'null'], description: 'migration：清單填的 target（失效版文件時與 itemId 不同；去處為 newPath 時為 null）' }, newPath: { type: 'string', description: 'migration：去處為系統產生頁／功能頁路徑（非內容 id，例 /travel/JP/）時＝to' }, archivedAt: { type: 'string' } } },
  LegacyMap: { type: 'object', description: '{ 正規化舊網址: 新站路徑 }。key 規則：去網域、去 hash、百分比編碼統一、小寫、去尾斜線、query 去掉 page 參數', additionalProperties: { type: 'string' } },
  LegacyPattern: { type: 'object', properties: { pattern: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' }, kind: { enum: ['legacy', 'migration'] }, itemId: { type: 'string' }, listId: { type: ['string', 'null'] }, key: { type: ['string', 'null'] }, oldTitle: { type: ['string', 'null'] } } },
  DocumentFamily: { type: 'object', properties: { family: { type: 'string' }, title: { type: 'string' }, current: { type: ['string', 'null'] }, currentVersion: { type: ['string', 'null'] }, currentEffectiveAt: { type: ['string', 'null'] }, versions: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, version: { type: ['string', 'null'] }, effectiveAt: { type: ['string', 'null'] }, isCurrent: { type: 'boolean' }, superseded: { type: 'boolean' }, supersededBy: { type: ['string', 'null'] } } } } } },
  TaskBundle: { type: 'object', properties: { key: { type: 'string' }, label: { type: 'string' }, count: { type: 'integer' }, items: { type: 'array', items: { type: 'object' } }, byType: { type: 'object' } } },
  NotifyCategory: { type: 'object', required: ['legalCategory', 'diseases'], description: '通報時限表（依法定傳染病類別分組）', properties: {
    legalCategory: { type: ['integer', 'null'], minimum: 1, maximum: 5 }, label: { type: 'string' },
    diseases: { type: 'array', items: { type: 'object', required: ['id', 'slug', 'name', 'notifyWithinHours', 'hasPage'], properties: {
      id: { type: 'string' }, slug: { type: 'string' }, name: { type: 'string' }, nameEn: { type: ['string', 'null'] }, legalName: { type: ['string', 'null'] },
      notifyWithinHours: { type: ['integer', 'null'] }, notifyLabel: { type: ['string', 'null'] }, hasPage: { type: 'boolean' }, path: { type: ['string', 'null'] },
      caseDefinitionDoc: { type: 'string' }, caseDefinitionCurrentId: { type: ['string', 'null'] }, caseDefinitionPath: { type: ['string', 'null'] },
      labtestId: { type: 'string' }, labtestPath: { type: 'string' }, labtestIds: { type: 'array', items: { type: 'string' } } } } },
  } },
  ExternalLink: { type: 'object', required: ['url', 'itemId', 'field', 'status'], properties: { url: { type: 'string', format: 'uri' }, itemId: { type: 'string' }, itemType: { type: 'string' }, itemTitle: { type: 'string' }, owner: { type: 'string' }, ownerName: { type: 'string' }, field: { type: 'string', description: '欄位，例：links[0]、applyUrl、pdfUrl' }, label: { type: ['string', 'null'] }, lastCheckedAt: { type: ['string', 'null'], format: 'date' }, status: { enum: ['ok', 'broken', 'unchecked'] }, path: { type: 'string' } } },
  PublicationSeries: { type: 'object', properties: { series: { type: 'string' }, seriesEn: { type: ['string', 'null'] }, pubType: { type: ['string', 'null'] }, issn: { type: ['string', 'null'] }, count: { type: 'integer' }, latest: { type: ['string', 'null'] }, items: { type: 'array', items: { type: 'string' } } } },
  MigrationListSummary: { type: 'object', required: ['id', 'slug', 'title', 'derived', 'curated', 'status', 'stats'], description: '移轉清單摘要（ARCHITECTURE 14.1）', properties: {
    id: { type: 'string', description: 'migration.{slug}' }, slug: { type: 'string' }, title: { type: 'string' }, scope: { type: 'object' },
    disease: { type: ['string', 'null'] }, diseaseName: { type: ['string', 'null'] }, legalCategory: { type: ['integer', 'null'], minimum: 1, maximum: 5 },
    hasPage: { type: ['boolean', 'null'], description: '疾病頁是否已上架（欄目清單為 null）' }, pagePath: { type: ['string', 'null'] },
    derived: { type: 'boolean', description: '整份由模板推導（無人工清單）' }, curated: { type: 'boolean', description: '有人工清單（content/migration/{slug}.json）' },
    status: { type: 'string', description: 'published／archived；推導且疾病頁不存在＝no-page' }, site: { enum: ['zh-TW', 'en'], description: '舊站語言版' },
    owner: { type: 'string' }, ownerName: { type: 'string' }, reviewedAt: { type: ['string', 'null'] }, showLegacyUntil: { type: ['string', 'null'] }, show: { type: 'boolean' },
    stats: { type: 'object', properties: Object.fromEntries(['migrated', 'merged', 'archived', 'pending', 'dropped', 'verified', 'unverified', 'total'].map((k) => [k, { type: 'integer' }])) },
    derivedItems: { type: 'integer' }, curatedItems: { type: 'integer' }, todoId: { type: ['string', 'null'], description: '聚合待辦 id（每份清單一則 migration-pending）' },
    url: { type: 'string' }, path: { type: 'string' } } },
  MigrationListDetail: { allOf: [ref('MigrationListSummary'), { type: 'object', properties: {
    legacyRoot: { type: ['string', 'null'] }, sourceNote: { type: ['string', 'null'] }, summary: { type: ['string', 'null'] }, file: { type: ['string', 'null'] },
    extends: { type: ['string', 'null'] }, templateId: { type: ['string', 'null'] },
    items: { type: 'array', items: { allOf: [ref('MigrationItem'), { type: 'object', properties: {
      derived: { type: 'boolean', description: '此筆由模板推導（人工清單沒寫的 key）' }, mapTo: { type: 'object', description: '模板的對應規則' },
      relatedIds: { type: 'array', items: { type: 'string' }, description: 'related 命中的全部內容 id' },
      owner: { type: 'string' }, ownerName: { type: 'string' }, statusLabel: { type: 'string' }, fromPath: { type: 'string' }, pattern: { type: 'boolean' },
      targetType: { type: ['string', 'null'] }, targetTitle: { type: ['string', 'null'] }, targetPath: { type: ['string', 'null'] }, to: { type: ['string', 'null'] }, toId: { type: ['string', 'null'] } } }] } } } }] },
  Endpoint: { type: 'object', properties: { path: { type: 'string' }, url: { type: 'string' }, description: { type: 'string' }, count: { type: ['integer', 'null'] } } },
};

const withApi = (name) => ({ allOf: [ref(name), ref('ApiFields')] });
const arr = (s) => ({ type: 'array', items: s });
const free = { type: 'object', additionalProperties: true };

/** 端點定義：[path, tag, summary, dataSchema, extraTop?] */
export const ENDPOINTS = [
  ['/v1/index.json', 'meta', '端點清單', arr(ref('Endpoint'))],
  ['/v1/diseases.json', 'content', '傳染病主檔（含疾病頁連結與治理摘要）', arr({ allOf: [ref('DiseaseMaster'), { type: 'object', properties: { page: { type: ['string', 'null'] }, api: { type: ['string', 'null'] }, governance: { oneOf: [ref('Governance'), { type: 'null' }] } } }] })],
  ['/v1/diseases/{slug}.json', 'content', '疾病頁（八區塊、一分鐘重點、治理摘要、相關內容）', withApi('Disease')],
  ['/v1/vaccines.json', 'content', '疫苗頁', arr(withApi('Vaccine'))],
  ['/v1/immunization-schedule.json', 'content', '疫苗接種時程表（主檔）', arr({ type: 'object' })],
  ['/v1/faq.json', 'content', 'Q&A（每題含 reviewedAt、owner、whitelist）', arr(withApi('Faq'))],
  ['/v1/news.json', 'content', '新聞稿／通函（近 200 則；annotations 為自動加註）', arr(withApi('News'))],
  ['/v1/documents.json', 'content', '文件全部版本；families 為版本鏈與現行版', arr(withApi('Document')), { families: arr(ref('DocumentFamily')) }],
  ['/v1/clarifications.json', 'content', '謠言澄清', arr(withApi('Clarification'))],
  ['/v1/situation.json', 'situation', '疫情態勢層（疫情中心人工發布，status 四級）', ref('Situation')],
  ['/v1/travel-alerts.json', 'situation', '國際旅遊疫情建議（快照／每日抓取）', arr(free)],
  ['/v1/country-levels.json', 'situation', '各國疫情等級', arr(free)],
  ['/v1/country-changes.json', 'situation', '旅遊疫情建議變化事件（kind：new／raised／lowered／lifted／renewed）', arr(free)],
  ['/v1/country-background.json', 'situation', '全球背景提醒（同一疾病同一等級涵蓋 ≥ 50% 國家）', arr(free)],
  ['/v1/datasets.json', 'data', '資料目錄（CKAN 快照＋治理欄位）', arr(withApi('Dataset'))],
  ['/v1/catalog.json', 'data', '五類資產總目錄', arr(ref('CatalogEntry'))],
  ['/v1/glossary.json', 'data', '七語詞彙主檔', arr(ref('GlossaryTerm'))],
  ['/v1/units.json', 'data', '權責單位', arr(ref('Unit'))],
  ['/v1/countries.json', 'data', '國家主檔', arr(ref('Country'))],
  ['/v1/banners.json', 'content', '上架中的首頁 Banner', arr(withApi('Banner'))],
  ['/v1/campaigns.json', 'content', '全部宣導 Banner（campaignStatus：active／upcoming／ended）', arr({ allOf: [ref('Banner'), ref('ApiFields'), { type: 'object', properties: { campaignStatus: { enum: ['active', 'upcoming', 'ended'] } } }] })],
  ['/v1/media.json', 'content', '影音宣導素材（逐字稿、章節、依據正本；governance.mediaOutdated）', arr(withApi('Media'))],
  ['/v1/topics.json', 'content', '專區／專題（governance.ended；links[].status 外部連結檢查）', arr(withApi('Topic'))],
  ['/v1/services.json', 'content', '申請／服務（步驟、應備文件、處理天數、表單）', arr(withApi('Service'))],
  ['/v1/publications.json', 'content', '出版品（書目、卷期）；series 為系列分組', arr(withApi('Publication')), { series: arr(ref('PublicationSeries')) }],
  ['/v1/articles.json', 'content', '疫情報導文章（第二十九輪）：全文 sections、作者與單位、頁碼、圖表、引用格式；issue 為所屬卷期摘要', arr({ allOf: [ref('Article'), ref('ApiFields'), { type: 'object', properties: { issue: { type: ['object', 'null'] }, citation: { type: 'string' }, citationEn: { type: 'string' } } }] })],
  ['/v1/labtests.json', 'professional', '檢驗項目（疾病 × 檢體 × 容器 × 保存運送 × 時限）', arr({ allOf: [ref('Labtest'), ref('ApiFields'), { type: 'object', properties: { master: { oneOf: [ref('DiseaseMaster'), { type: 'null' }] } } }] })],
  ['/v1/research.json', 'professional', '研究計畫', arr(withApi('Research'))],
  ['/v1/notices.json', 'content', '機關公告：其他訊息（closed、closingSoon、daysToDeadline）；人才招募見 /v1/jobs.json、採購公告見 /v1/tenders.json', arr({ allOf: [ref('News'), ref('ApiFields'), { type: 'object', properties: { closed: { type: 'boolean' }, closingSoon: { type: 'boolean' }, daysToDeadline: { type: ['integer', 'null'] } } }] })],
  ['/v1/jobs.json', 'content', '人才招募職缺（人事室；stage／stageLabel 由治理引擎推導、tab 為 /careers/ 頁籤；result 只含報名編號（不公布姓名）、unpublishAt 起不再含名單、externalUrl＝名單在人事系統；不進 AI 答案索引；timeline 為時間軸）',
    arr({ allOf: [ref('Job'), ref('ApiFields'), { type: 'object', properties: { stage: { enum: ['upcoming', 'open', 'closed', 'screening', 'result', 'filled', 'cancelled'] }, stageLabel: { type: 'string' }, tab: { enum: ['open', 'upcoming', 'review', 'result', 'history'] }, tabLabel: { type: 'string' }, archivedStage: { type: 'boolean' }, hiringUnitName: { type: 'string' }, applyHref: { type: ['string', 'null'] }, applyOnSite: { type: 'boolean' }, daysToDeadline: { type: ['integer', 'null'] }, closingSoon: { type: 'boolean' }, resultUrl: { type: ['string', 'null'] }, timeline: TIMELINE } }] })],
  ['/v1/tenders.json', 'content', '採購公告（秘書室；stage：open／closed／opened／awarded／failed／cancelled；正式公告以政府電子採購網為準）',
    arr({ allOf: [ref('Tender'), ref('ApiFields'), { type: 'object', properties: { stage: { enum: ['open', 'closed', 'opened', 'awarded', 'failed', 'cancelled'] }, stageLabel: { type: 'string' }, tab: { enum: ['open', 'closed', 'opened', 'awarded', 'failed'] }, tabLabel: { type: 'string' }, requestingUnitName: { type: 'string' }, daysToDeadline: { type: ['integer', 'null'] }, closingSoon: { type: 'boolean' }, awardOverdue: { type: 'boolean' }, timeline: TIMELINE } }] })],
  ['/v1/notify-table.json', 'professional', '法定傳染病通報時限表（由傳染病主檔自動產生）', arr(ref('NotifyCategory'))],
  ['/v1/search.json', 'search', '搜尋端點說明（靜態站＝search-index 別名）', free],
  ['/v1/search-index.json', 'search', '答案單元索引（民眾，只含白名單）', arr(ref('Chunk'))],
  ['/v1/search-index-pro.json', 'search', '答案單元索引（專業，只含現行版）', arr(ref('Chunk'))],
  ['/v1/tasks/{task}.json', 'content', '六任務入口聚合（依內容 tasks 欄位）', ref('TaskBundle')],
  ['/v1/redirects.json', 'meta', '舊版／舊網址 → 正本對照（301；kind：superseded／family-latest／legacy／migration；pattern 項只進文件）', arr(ref('Redirect'))],
  ['/v1/legacy-map.json', 'meta', '舊網址精簡對照（404 頁與 /legacy/ 查詢用）；patterns＝{id} 佔位的 URL 模式（不可自動轉址）、gone＝不移轉（建議 410）、ambiguous＝同一舊網址對到多個新頁（不輸出）', ref('LegacyMap'),
    { patterns: arr(ref('LegacyPattern')), gone: arr({ type: 'object', properties: { key: { type: 'string' }, from: { type: 'string' }, pattern: { type: 'boolean' }, listId: { type: 'string' }, migrationKey: { type: 'string' }, oldTitle: { type: 'string' }, note: { type: ['string', 'null'] }, status: { const: 410 } } }),
      ambiguous: arr({ type: 'object', properties: { key: { type: 'string' }, from: { type: 'string' }, candidates: { type: 'array', items: { type: 'string' } }, itemIds: { type: 'array', items: { type: 'string' } } } }) }],
  ['/v1/migration/index.json', 'meta', '移轉清單摘要（ARCHITECTURE 14.1）：主檔每一種疾病一份（derived＝由模板 content/migration/_disease-template.json 推導；curated＝有人工清單覆蓋同 key；status no-page＝疾病頁尚未建立、全部待移轉）＋欄目清單（如英文站 International Cooperation）；meta.stats 含 lists／derived／curated／noPage', arr(ref('MigrationListSummary'))],
  ['/v1/migration/{slug}.json', 'meta', '單一移轉清單完整內容：items[].derived＝由模板推導（舊網址皆 {id} 佔位，轉址為 pattern，不進伺服器對照檔）；可下載後改寫成人工清單（只留例外）', ref('MigrationListDetail')],
  ['/v1/governance/kpi.json', 'governance', '品質指標（規劃 7.5 全列）', arr(ref('Kpi'))],
  ['/v1/governance/todos.json', 'governance', '治理待辦（正本修訂連動、逾期、譯文過期、反向稽核…）', arr(ref('Todo'))],
  ['/v1/governance/summary.json', 'governance', '治理儀表板數字', free],
  ['/v1/governance/by-owner.json', 'governance', '各權責單位待辦／逾期／白名單／內容數', arr(free)],
  ['/v1/governance/links.json', 'governance', '外部連結健康（fetch-data --check-links 寫回）', arr(ref('ExternalLink'))],
  ['/v1/governance/ai-status.json', 'governance', 'AI 問答開關', ref('AiStatus')],
  ['/v1/governance/whitelist.json', 'governance', 'AI 白名單政策與每筆狀態', free],
  ['/v1/governance/eval-set.json', 'governance', '評估集（含版本題、拒答題）', ref('EvalSet')],
  ['/v1/governance/eval-report.json', 'governance', '評估報告', { oneOf: [free, { type: 'null' }] }],
];

const FEEDS = [
  ['/feeds/news.xml', '新聞稿 RSS 2.0（guid＝內容 id）'],
  ['/feeds/documents.xml', '文件版本異動 RSS 2.0'],
  ['/feeds/situation.xml', '疫情發布 RSS 2.0'],
  ['/feeds/publications.xml', '出版品 RSS 2.0（疫情報導卷期、年報、手冊）'],
  ['/feeds/notices.xml', '機關公告 RSS 2.0（其他訊息；含截止日）'],
  ['/feeds/careers.xml', '人才招募 RSS 2.0（職缺公告、甄選結果 id#result、遞補 id#waitlist-N 各一筆；名單只在職缺頁）'],
  ['/feeds/procurement.xml', '採購公告 RSS 2.0（招標公告、決標 id#award、流標各一筆）'],
];

export function buildOpenApi(site) {
  const schemas = { ...schemaComponents(), ...EXTRA };
  const paths = {};
  for (const [p, tag, summary, data, top] of ENDPOINTS) {
    const params = [];
    if (p.startsWith('/v1/migration/') && p.includes('{slug}')) params.push({ name: 'slug', in: 'path', required: true, schema: { type: 'string', enum: (site?.migration?.lists ?? []).map((l) => l.slug) }, description: '移轉清單 slug（見 /v1/migration/index.json）' });
    else if (p.includes('{slug}')) params.push({ name: 'slug', in: 'path', required: true, schema: { type: 'string', enum: (site?.collections?.diseases ?? []).map((d) => d.slug) }, description: '疾病頁 slug（見 /v1/diseases.json 的 api 欄位）' });
    if (p.includes('{task}')) params.push({ name: 'task', in: 'path', required: true, schema: { type: 'string', enum: config.tasks.map((t) => t.key) } });
    const opId = `get${p.replace(/\.json$/, '').split(/[/{}-]+/).filter(Boolean).map((x) => x[0].toUpperCase() + x.slice(1)).join('')}`;
    paths[p] = {
      get: {
        operationId: opId, tags: [tag], summary, parameters: params.length ? params : undefined,
        responses: {
          200: {
            description: 'OK', content: { 'application/json': { schema: { type: 'object', required: ['meta', 'data'], properties: { meta: ref('Meta'), data, ...(top ?? {}) } } } },
          },
          404: { description: '不存在' },
        },
      },
    };
    if (!params.length) delete paths[p].get.parameters;
  }
  for (const [p, summary] of FEEDS) {
    paths[p] = { get: { operationId: `feed${p.split('/').pop().replace('.xml', '').replace(/^./, (c) => c.toUpperCase())}`, tags: ['feeds'], summary, responses: { 200: { description: 'RSS 2.0', content: { 'application/rss+xml': { schema: { type: 'string' } } } } } } };
  }
  return {
    openapi: '3.1.0',
    jsonSchemaDialect: 'https://json-schema.org/draft/2020-12/schema',
    info: {
      title: `${config.name} 開放 API（原型）`, version: '1.0.0',
      summary: '單一 v1、JSON、靜態檔案；變更事件以 RSS 提供。',
      description: [
        '內容與資料只存一份（content/），本 API 為建置產生的靜態 JSON。',
        '- 每個檔案外殼 `{ meta, data }`；`meta.etag` 為 data 內容雜湊、`meta.lastModified` 為集合最大審閱日（靜態站無法送 ETag／Last-Modified header）。',
        '- 每筆內容附 `governance`：權責單位、審閱日、下次審閱日、是否現行版、AI 白名單與不生效原因、自動加註。',
        '- 失效版本 `isCurrent:false`，請改用 `supersededBy`／`families[].current`；舊網址對照見 `/v1/redirects.json` 與精簡版 `/v1/legacy-map.json`；伺服器對照檔：`/redirects/nginx.map`、`/redirects/web.config.rewritemap.xml`、`/redirects/_redirects`。',
        '- 舊站移轉清單：`/v1/migration/index.json`（各清單摘要）與 `/v1/migration/{slug}.json`（完整清單）；疾病清單由模板推導，人工清單只寫例外。',
        '- 內容可宣告 `sourceLang`（預設 zh-TW）：頂層欄位為來源語言，其他語言（含 zh-TW 譯文）在 `i18n`；`governance.translationStale` 以來源語言判斷。',
        '- 人才招募 `/v1/jobs.json`（人事室）與採購公告 `/v1/tenders.json`（秘書室）：`stage` 由治理引擎依日期推導；甄選結果只公布報名編號、不公布姓名，到下架日（result.unpublishAt）自動停止輸出名單（建置時個資閘門檢查），且不進 AI 答案索引。',
        '- 變更事件：`/feeds/news.xml`、`/feeds/documents.xml`、`/feeds/situation.xml`、`/feeds/publications.xml`、`/feeds/notices.xml`、`/feeds/careers.xml`、`/feeds/procurement.xml`。',
      ].join('\n'),
      contact: { name: config.name, url: `${siteOrigin()}/developers/` },
      license: { name: '政府資料開放授權條款－第 1 版', identifier: 'OGDL-Taiwan-1.0', url: 'https://data.gov.tw/license' },
    },
    servers: [{ url: siteOrigin(), description: 'GitHub Pages（原型）' }],
    tags: [
      { name: 'content', description: '內容層（疾病、Q&A、新聞、文件、疫苗、澄清、影音、專區、申請服務、出版品、公告、人才招募、採購公告）' },
      { name: 'situation', description: '態勢層與旅遊疫情' },
      { name: 'data', description: '資料目錄與主檔' },
      { name: 'search', description: '答案單元索引' },
      { name: 'professional', description: '專業（檢驗項目、研究計畫、通報時限表）' },
      { name: 'governance', description: '治理（KPI、待辦、白名單、AI 狀態、評估）' },
      { name: 'meta', description: '端點清單與轉址' },
      { name: 'feeds', description: '變更事件（RSS 2.0）' },
    ],
    paths,
    components: { schemas },
  };
}
