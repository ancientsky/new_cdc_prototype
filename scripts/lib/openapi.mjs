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
    overdue: { type: 'boolean' }, lifecycle: { enum: ['current', 'superseded', 'overdue', 'based-on-revised', 'draft', 'archived', 'scheduled'] }, lifecycleLabel: { type: 'string' },
    whitelist: { type: 'boolean' }, whitelistTier: { enum: ['public', 'pro', null] }, whitelistReasons: { type: 'array', items: { type: 'string' } },
    isCurrent: { type: 'boolean' }, superseded: { type: 'boolean' }, supersededBy: { type: ['string', 'null'] }, noindex: { type: 'boolean' },
    stale: { type: 'array', items: { type: 'object' } }, annotations: { type: 'array', items: { type: 'object', properties: { kind: { type: 'string' }, level: { enum: ['danger', 'warning', 'info'] }, text: { type: 'string' }, href: { type: ['string', 'null'], description: '目標內容 id' }, targetId: { type: ['string', 'null'] }, path: { type: ['string', 'null'], description: '目標前台路徑' } } } },
    translationStale: { type: 'object', additionalProperties: { type: 'boolean' } }, renderableLangs: { type: 'array', items: { type: 'string' } },
  },
};
const EXTRA = {
  Meta: META,
  Governance: GOV,
  ApiFields: { type: 'object', properties: { url: { type: 'string', format: 'uri' }, path: { type: 'string' }, md: { type: ['string', 'null'] }, governance: ref('Governance') } },
  Chunk: { type: 'object', description: '答案單元（ARCHITECTURE 5.1）', required: ['id', 'contentId', 'type', 'title', 'text', 'url'], properties: { id: { type: 'string' }, contentId: { type: 'string' }, type: { type: 'string' }, lang: { type: 'string' }, title: { type: 'string' }, text: { type: 'string' }, sentences: { type: 'array', items: { type: 'string' } }, url: { type: 'string' }, owner: { type: 'string' }, ownerName: { type: 'string' }, reviewedAt: { type: 'string' }, nextReviewAt: { type: ['string', 'null'] }, isCurrent: { type: 'boolean' }, whitelist: { type: 'boolean' }, terms: { type: 'array', items: { type: 'string' } } } },
  Todo: { type: 'object', required: ['id', 'kind', 'itemId', 'owner', 'dueAt', 'text'], properties: { id: { type: 'string' }, kind: { enum: ['based-on-revised', 'overdue', 'translation-stale', 'license-missing', 'dataset-overdue', 'reverse-audit', 'superseded-still-linked', 'situation-overdue'] }, itemId: { type: 'string' }, itemTitle: { type: 'string' }, owner: { type: 'string' }, ownerName: { type: 'string' }, dueAt: { type: ['string', 'null'] }, overdue: { type: 'boolean' }, text: { type: 'string' }, href: { type: 'string' }, severity: { enum: ['high', 'medium', 'low'] } } },
  Kpi: { type: 'object', required: ['key', 'label', 'current', 'unit'], properties: { key: { type: 'string' }, label: { type: 'string' }, current: { type: ['number', 'null'] }, numerator: { type: ['number', 'null'] }, denominator: { type: ['number', 'null'] }, pct: { type: ['number', 'null'] }, target1y: { type: ['number', 'null'] }, target3y: { type: ['number', 'null'] }, unit: { type: 'string' }, direction: { enum: ['higher', 'lower'] }, status: { enum: ['ok', 'warn', 'bad', 'pending', 'info'] }, note: { type: 'string' } } },
  CatalogEntry: { type: 'object', properties: { id: { type: 'string' }, type: { type: 'string' }, category: { type: 'string' }, title: { type: 'string' }, owner: { type: 'string' }, canonicalUrl: { type: 'string' }, license: { type: 'string' }, sensitivity: { type: 'string' }, reviewedAt: { type: 'string' }, nextReviewAt: { type: ['string', 'null'] }, whitelist: { type: 'boolean' }, isCurrent: { type: 'boolean' }, legacyUrls: { type: 'array', items: { type: 'string' } } } },
  Redirect: { type: 'object', required: ['from', 'to', 'status', 'kind'], properties: { from: { type: 'string' }, to: { type: 'string' }, toUrl: { type: 'string' }, status: { enum: [301, 302] }, kind: { enum: ['superseded', 'legacy', 'family-latest'] }, itemId: { type: 'string' }, currentId: { type: 'string' }, retained: { type: 'boolean' } } },
  DocumentFamily: { type: 'object', properties: { family: { type: 'string' }, title: { type: 'string' }, current: { type: ['string', 'null'] }, currentVersion: { type: ['string', 'null'] }, currentEffectiveAt: { type: ['string', 'null'] }, versions: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, version: { type: ['string', 'null'] }, effectiveAt: { type: ['string', 'null'] }, isCurrent: { type: 'boolean' }, superseded: { type: 'boolean' }, supersededBy: { type: ['string', 'null'] } } } } } },
  TaskBundle: { type: 'object', properties: { key: { type: 'string' }, label: { type: 'string' }, count: { type: 'integer' }, items: { type: 'array', items: { type: 'object' } }, byType: { type: 'object' } } },
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
  ['/v1/faq.json', 'content', 'Q&A（每題含 reviewedAt、owner、whitelist）', arr(withApi('Faq'))],
  ['/v1/news.json', 'content', '新聞稿／通函（近 200 則；annotations 為自動加註）', arr(withApi('News'))],
  ['/v1/documents.json', 'content', '文件全部版本；families 為版本鏈與現行版', arr(withApi('Document')), { families: arr(ref('DocumentFamily')) }],
  ['/v1/clarifications.json', 'content', '謠言澄清', arr(withApi('Clarification'))],
  ['/v1/situation.json', 'situation', '疫情態勢層（疫情中心人工發布，status 四級）', ref('Situation')],
  ['/v1/travel-alerts.json', 'situation', '國際旅遊疫情建議（快照／每日抓取）', arr(free)],
  ['/v1/country-levels.json', 'situation', '各國疫情等級', arr(free)],
  ['/v1/datasets.json', 'data', '資料目錄（CKAN 快照＋治理欄位）', arr(withApi('Dataset'))],
  ['/v1/catalog.json', 'data', '五類資產總目錄', arr(ref('CatalogEntry'))],
  ['/v1/glossary.json', 'data', '七語詞彙主檔', arr(ref('GlossaryTerm'))],
  ['/v1/units.json', 'data', '權責單位', arr(ref('Unit'))],
  ['/v1/countries.json', 'data', '國家主檔', arr(ref('Country'))],
  ['/v1/banners.json', 'content', '上架中的首頁 Banner', arr(withApi('Banner'))],
  ['/v1/search.json', 'search', '搜尋端點說明（靜態站＝search-index 別名）', free],
  ['/v1/search-index.json', 'search', '答案單元索引（民眾，只含白名單）', arr(ref('Chunk'))],
  ['/v1/search-index-pro.json', 'search', '答案單元索引（專業，只含現行版）', arr(ref('Chunk'))],
  ['/v1/tasks/{task}.json', 'content', '六任務入口聚合（依內容 tasks 欄位）', ref('TaskBundle')],
  ['/v1/redirects.json', 'meta', '舊版／舊網址 → 正本對照（301）', arr(ref('Redirect'))],
  ['/v1/governance/kpi.json', 'governance', '品質指標（規劃 7.5 全列）', arr(ref('Kpi'))],
  ['/v1/governance/todos.json', 'governance', '治理待辦（正本修訂連動、逾期、譯文過期、反向稽核…）', arr(ref('Todo'))],
  ['/v1/governance/summary.json', 'governance', '治理儀表板數字', free],
  ['/v1/governance/by-owner.json', 'governance', '各權責單位待辦／逾期／白名單／內容數', arr(free)],
  ['/v1/governance/ai-status.json', 'governance', 'AI 問答開關', ref('AiStatus')],
  ['/v1/governance/whitelist.json', 'governance', 'AI 白名單政策與每筆狀態', free],
  ['/v1/governance/eval-set.json', 'governance', '評估集（含版本題、拒答題）', ref('EvalSet')],
  ['/v1/governance/eval-report.json', 'governance', '評估報告', { oneOf: [free, { type: 'null' }] }],
];

const FEEDS = [
  ['/feeds/news.xml', '新聞稿 RSS 2.0（guid＝內容 id）'],
  ['/feeds/documents.xml', '文件版本異動 RSS 2.0'],
  ['/feeds/situation.xml', '疫情態勢發布 RSS 2.0'],
];

export function buildOpenApi(site) {
  const schemas = { ...schemaComponents(), ...EXTRA };
  const paths = {};
  for (const [p, tag, summary, data, top] of ENDPOINTS) {
    const params = [];
    if (p.includes('{slug}')) params.push({ name: 'slug', in: 'path', required: true, schema: { type: 'string', enum: (site?.collections?.diseases ?? []).map((d) => d.slug) }, description: '疾病頁 slug（見 /v1/diseases.json 的 api 欄位）' });
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
        '- 失效版本 `isCurrent:false`，請改用 `supersededBy`／`families[].current`；舊網址對照見 `/v1/redirects.json`。',
        '- 變更事件：`/feeds/news.xml`、`/feeds/documents.xml`、`/feeds/situation.xml`。',
      ].join('\n'),
      contact: { name: config.name, url: `${siteOrigin()}/developers/` },
      license: { name: '政府資料開放授權條款－第 1 版', identifier: 'OGDL-Taiwan-1.0', url: 'https://data.gov.tw/license' },
    },
    servers: [{ url: siteOrigin(), description: 'GitHub Pages（原型）' }],
    tags: [
      { name: 'content', description: '內容層（疾病、Q&A、新聞、文件、疫苗、澄清）' },
      { name: 'situation', description: '態勢層與旅遊疫情' },
      { name: 'data', description: '資料目錄與主檔' },
      { name: 'search', description: '答案單元索引' },
      { name: 'governance', description: '治理（KPI、待辦、白名單、AI 狀態、評估）' },
      { name: 'meta', description: '端點清單與轉址' },
      { name: 'feeds', description: '變更事件（RSS 2.0）' },
    ],
    paths,
    components: { schemas },
  };
}
