// JSON-LD 建構（附錄 A schema.org 對應 + cdc: 治理擴充）
// 模板呼叫：
//   jsonLdFor(ctx, item)            → object[]（依型別：MedicalWebPage+MedicalCondition / FAQPage / NewsArticle / DigitalDocument / Dataset / ClaimReview / WebPage）
//   orgJsonLd(ctx)                  → GovernmentOrganization（layout 每頁放一份）
//   websiteJsonLd(ctx)              → WebSite + SearchAction（首頁）
//   breadcrumbJsonLd(ctx, [{name, path}]) → BreadcrumbList
//   situationJsonLd(ctx, situation) → Dataset + cdc:situation（態勢層）
//   travelJsonLd(ctx, country, alerts) → SpecialAnnouncement + cdc:travel（旅遊疫情，自訂）
//   governanceExt(ctx, item)        → cdc:* 擴充欄位（owner、reviewedAt、nextReviewAt、version、whitelist…）
import { config, siteOrigin } from '../../site.config.mjs';
import { mdToText } from './markdown.mjs';
import { pathOf } from './governance.mjs';

/** cdc: 詞彙前綴；說明在 /developers/#vocab-<term> */
export const CDC_VOCAB = () => `${siteOrigin()}/developers/#vocab-`;
export const LICENSE_URLS = {
  'OGDL-1.0': 'https://data.gov.tw/license',
  'CC0-1.0': 'https://creativecommons.org/publicdomain/zero/1.0/',
  'CC-BY-4.0': 'https://creativecommons.org/licenses/by/4.0/',
};
export const licenseUrl = (id) => LICENSE_URLS[id] ?? id ?? null;
const CONTEXT = () => ['https://schema.org', { cdc: CDC_VOCAB() }];
const ORG_ID = () => `${siteOrigin()}/#org`;
const SITE_ID = () => `${siteOrigin()}/#website`;
const TAIWAN = { '@type': 'Country', name: '臺灣', alternateName: 'Taiwan', identifier: 'TW' };

const abs = (ctx, path, opts = {}) => {
  if (ctx?.url) return ctx.url(path, { absolute: true, ...opts });
  return `${siteOrigin()}${path}`;
};
/** 依語言取翻譯欄位，沒有就回中文 */
const tr = (ctx, item, field) => (ctx?.lang && ctx.lang !== 'zh-TW' ? item.i18n?.[ctx.lang]?.[field] : undefined) ?? item[field];
const clean = (o) => {
  for (const k of Object.keys(o)) if (o[k] == null || (Array.isArray(o[k]) && !o[k].length)) delete o[k];
  return o;
};
const unitOrg = (ctx, id) => {
  const u = ctx?.site?.unitById?.get(id);
  return clean({ '@type': 'GovernmentOrganization', name: u?.name ?? id, alternateName: u?.nameEn, identifier: id, parentOrganization: { '@id': ORG_ID() } });
};

export function orgJsonLd(ctx) {
  return clean({
    '@context': 'https://schema.org', '@type': 'GovernmentOrganization', '@id': ORG_ID(),
    name: config.name, alternateName: [config.nameEn, config.nameShort, 'Taiwan CDC'], url: `${siteOrigin()}/`,
    telephone: config.hotline,
    contactPoint: [
      { '@type': 'ContactPoint', telephone: config.hotline, contactType: '防疫諮詢專線', areaServed: 'TW', availableLanguage: ['zh-TW', 'en', 'ja', 'vi', 'id', 'th'] },
      { '@type': 'ContactPoint', telephone: config.hotlineIntl, contactType: 'international hotline', availableLanguage: ['en'] },
    ],
    sameAs: [config.legacyOrigin, config.openDataOrigin].filter(Boolean),
    parentOrganization: { '@type': 'GovernmentOrganization', name: '衛生福利部', alternateName: 'Ministry of Health and Welfare' },
    inLanguage: ctx?.lang,
  });
}

/** 首頁：WebSite + SearchAction（指向 /ask/?q=） */
export function websiteJsonLd(ctx) {
  const ask = abs(ctx, '/ask/');
  return {
    '@context': 'https://schema.org', '@type': 'WebSite', '@id': SITE_ID(),
    name: config.name, alternateName: config.nameEn, url: abs(ctx, '/'), inLanguage: ctx?.lang ?? 'zh-TW',
    publisher: { '@id': ORG_ID() },
    potentialAction: { '@type': 'SearchAction', target: { '@type': 'EntryPoint', urlTemplate: `${ask}?q={search_term_string}` }, 'query-input': 'required name=search_term_string' },
  };
}

/** 麵包屑：items = [{ name, path }]（亦接受 { label, href }；path 由 ctx.url 加 basePath／語言） */
export function breadcrumbJsonLd(ctx, items) {
  return {
    '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => {
      const p = it.path ?? it.href;
      return clean({ '@type': 'ListItem', position: i + 1, name: String(it.name ?? it.label ?? ''), item: p ? abs(ctx, p) : undefined });
    }),
  };
}

/** cdc: 治理擴充（所有內容型別共用） */
export function governanceExt(ctx, item) {
  const g = item.gov ?? {};
  return {
    'cdc:id': item.id,
    'cdc:owner': ctx?.site?.unitById?.get(item.owner)?.name ?? item.owner,
    'cdc:ownerId': item.owner,
    'cdc:reviewedAt': item.reviewedAt,
    'cdc:nextReviewAt': g.nextReviewAt ?? null,
    'cdc:reviewPeriodMonths': item.reviewPeriodMonths,
    'cdc:status': item.status,
    'cdc:lifecycle': g.lifecycle ?? null,
    'cdc:version': item.version ?? null,
    'cdc:effectiveAt': item.effectiveAt ?? null,
    'cdc:isCurrent': g.isCurrent ?? true,
    'cdc:supersededBy': g.supersededBy ?? null,
    'cdc:aiWhitelist': !!g.whitelist?.effective,
    'cdc:sensitivity': item.sensitivity,
    'cdc:license': item.license,
    'cdc:basedOn': item.basedOn ?? [],
    'cdc:sourceHash': item.sourceHash ?? null,
  };
}

function baseOf(ctx, item, type) {
  const url = abs(ctx, pathOf(item));
  return clean({
    '@context': CONTEXT(), '@type': type, '@id': `${url}#main`, url,
    inLanguage: ctx?.lang ?? 'zh-TW',
    datePublished: item.publishedAt, dateModified: item.reviewedAt,
    license: licenseUrl(item.license), isAccessibleForFree: true,
    publisher: { '@id': ORG_ID(), '@type': 'GovernmentOrganization', name: config.name },
    keywords: item.keywords?.length ? item.keywords.join(', ') : undefined,
    ...governanceExt(ctx, item),
  });
}
const correctionsOf = (item) => (item.gov?.annotations ?? []).filter((a) => a.kind === 'based-on-revised' || a.kind === 'superseded')
  .map((a) => ({ '@type': 'CorrectionComment', text: a.text }));

export function jsonLdFor(ctx, item) {
  const name = tr(ctx, item, 'title');
  const description = tr(ctx, item, 'summary');
  switch (item.type) {
    case 'disease': {
      const condition = clean({
        '@type': 'MedicalCondition', '@id': `${abs(ctx, pathOf(item))}#condition`, name, alternateName: [item.nameEn, ...(item.aliases ?? [])].filter(Boolean), description,
        code: (item.icd10 ?? []).map((c) => ({ '@type': 'MedicalCode', codeValue: c, codingSystem: 'ICD-10' })),
        signOrSymptom: (item.keyFacts?.symptoms ?? '').split(/[、,，]/).map((s) => s.trim()).filter(Boolean).map((s) => ({ '@type': 'MedicalSignOrSymptom', name: s })),
        'cdc:legalCategory': item.legalCategory ?? null,
        'cdc:notifyWithinHours': item.notifyWithinHours ?? null,
        'cdc:incubation': item.incubation ?? null,
        'cdc:transmission': item.transmission ?? [],
      });
      return [clean({ ...baseOf(ctx, item, 'MedicalWebPage'), name, description, lastReviewed: item.reviewedAt, reviewedBy: unitOrg(ctx, item.owner), audience: audienceOf(item), about: condition, mainEntity: { '@id': condition['@id'] } })];
    }
    case 'faq': {
      const q = tr(ctx, item, 'question') ?? name;
      const a = mdToText(tr(ctx, item, 'answerMarkdown'));
      return [clean({ ...baseOf(ctx, item, 'FAQPage'), name: q, description, lastReviewed: item.reviewedAt, reviewedBy: unitOrg(ctx, item.owner),
        mainEntity: [{ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a, dateModified: item.reviewedAt, author: unitOrg(ctx, item.owner) } }] })];
    }
    case 'news': case 'letter':
      return [clean({ ...baseOf(ctx, item, 'NewsArticle'), headline: String(name).slice(0, 110), name, description,
        author: unitOrg(ctx, item.owner), sourceOrganization: { '@id': ORG_ID() },
        articleSection: item.newsType ?? item.type, correction: correctionsOf(item),
        about: (item.diseases ?? []).map((d) => ({ '@type': 'MedicalCondition', name: ctx?.site?.diseaseMasterById?.get(d)?.name ?? d, identifier: d })) })];
    case 'document': {
      const g = item.gov ?? {};
      const successor = g.supersededBy ? ctx?.site?.byId?.get(g.supersededBy) : null;
      const current = g.currentId && g.currentId !== item.id ? ctx?.site?.byId?.get(g.currentId) : null;
      return [clean({ ...baseOf(ctx, item, 'DigitalDocument'), name, description, version: item.version, datePublished: item.effectiveAt ?? item.publishedAt,
        author: unitOrg(ctx, item.owner), genre: item.docType,
        expires: successor?.effectiveAt, // 失效版：新版生效日起不再適用
        encoding: item.pdfUrl ? [{ '@type': 'MediaObject', encodingFormat: 'application/pdf', contentUrl: item.pdfUrl }] : undefined,
        associatedMedia: { '@type': 'MediaObject', encodingFormat: 'text/markdown', contentUrl: abs(ctx, `${pathOf(item).replace(/\/$/, '')}.md`) },
        isBasedOn: item.supersedes ? abs(ctx, pathOf(ctx?.site?.byId?.get(item.supersedes) ?? { type: 'document', id: item.supersedes })) : undefined,
        'cdc:family': item.family, 'cdc:supersedes': item.supersedes ?? null, 'cdc:current': current ? abs(ctx, pathOf(current)) : null,
        'cdc:changes': item.changes ?? [] })];
    }
    case 'dataset': return [datasetJsonLd(ctx, item)];
    case 'clarification':
      return [clean({ ...baseOf(ctx, item, 'ClaimReview'), name, description, claimReviewed: item.claim, author: unitOrg(ctx, item.owner),
        reviewRating: { '@type': 'Rating', ratingValue: { false: 1, outdated: 2, 'partly-true': 3 }[item.verdict] ?? 1, bestRating: 5, worstRating: 1, alternateName: { false: '錯誤', outdated: '已過時', 'partly-true': '部分正確' }[item.verdict] ?? item.verdict },
        itemReviewed: { '@type': 'Claim', text: item.claim, appearance: (item.channels ?? []).map((c) => ({ '@type': 'CreativeWork', name: c })) },
        'cdc:verdict': item.verdict, 'cdc:shareText': tr(ctx, item, 'shareText') })];
    case 'vaccine':
      return [clean({ ...baseOf(ctx, item, 'MedicalWebPage'), name, description, lastReviewed: item.reviewedAt, reviewedBy: unitOrg(ctx, item.owner), audience: audienceOf(item),
        about: clean({ '@type': 'Drug', name, alternateName: [item.nameEn, ...(item.aliases ?? [])].filter(Boolean), drugClass: { '@type': 'DrugClass', name: 'Vaccine' } }),
        'cdc:publicFunded': item.publicFunded ?? [] })];
    default:
      return [clean({ ...baseOf(ctx, item, 'WebPage'), name, description, lastReviewed: item.reviewedAt, reviewedBy: unitOrg(ctx, item.owner) })];
  }
}

function audienceOf(item) {
  return (item.audience ?? []).map((a) => (a === 'professional' ? { '@type': 'MedicalAudience', audienceType: 'Clinician' } : { '@type': 'PeopleAudience', audienceType: 'Public' }));
}

/** 資料集：data.gov.tw 詮釋資料相容（identifier、keywords、spatialCoverage、temporalCoverage、isAccessibleForFree） */
export function datasetJsonLd(ctx, item) {
  const pts = item.series?.points ?? [];
  const temporal = pts.length ? `${pts[0].t}/${pts.at(-1).t}` : item.publishedAt ? `${item.publishedAt}/..` : undefined;
  const dists = (item.resources?.length ? item.resources : (item.formats ?? []).map((f) => ({ format: f, url: item.canonicalUrl })))
    .map((r) => clean({ '@type': 'DataDownload', name: r.name, encodingFormat: r.format, contentUrl: r.url ?? item.canonicalUrl }));
  return clean({
    ...baseOf(ctx, item, 'Dataset'), url: item.canonicalUrl ?? abs(ctx, pathOf(item)),
    name: tr(ctx, item, 'title'), description: tr(ctx, item, 'summary'),
    identifier: [item.id, item.ckanName].filter(Boolean),
    keywords: item.keywords ?? [],
    spatialCoverage: TAIWAN, temporalCoverage: temporal,
    dateModified: item.lastUpdated ?? item.reviewedAt,
    creator: unitOrg(ctx, item.owner), isAccessibleForFree: true,
    sameAs: item.mirrors ?? [], distribution: dists,
    includedInDataCatalog: { '@type': 'DataCatalog', name: '疾病管制署資料開放平臺', url: config.openDataOrigin },
    measurementTechnique: item.series?.label,
    'cdc:updateFrequency': item.updateFrequency, 'cdc:category': item.category, 'cdc:datasetOverdue': !!item.gov?.datasetOverdue,
  });
}

/** 態勢層：Dataset + cdc:situation（status 四級由疫情中心人工發布） */
export function situationJsonLd(ctx, situation) {
  const s = situation ?? ctx?.site?.situation ?? {};
  const unit = ctx?.site?.unitById?.get(s.publisher);
  return clean({
    '@context': CONTEXT(), '@type': 'Dataset', '@id': `${abs(ctx, '/situation/')}#situation`, url: abs(ctx, '/situation/'),
    name: '疫情態勢層', alternateName: 'Taiwan CDC epidemic situation', inLanguage: ctx?.lang ?? 'zh-TW',
    description: '疫情中心依既有監測門檻人工發布的各疾病態勢（stable／rising／peak／declining），不由模型推論。',
    datePublished: s.publishedAt, dateModified: s.publishedAt, temporalCoverage: s.dataDate, spatialCoverage: TAIWAN,
    creator: clean({ '@type': 'GovernmentOrganization', name: unit?.name ?? s.publisher, identifier: s.publisher }),
    publisher: { '@id': ORG_ID(), '@type': 'GovernmentOrganization', name: config.name },
    license: licenseUrl('OGDL-1.0'), isAccessibleForFree: true,
    distribution: [{ '@type': 'DataDownload', encodingFormat: 'application/json', contentUrl: abs(ctx, '/v1/situation.json', { noLang: true }) }],
    variableMeasured: (s.items ?? []).map((it) => clean({ '@type': 'PropertyValue', name: it.metricLabel, value: it.metricValue, description: it.basis, 'cdc:disease': it.disease })),
    'cdc:dataDate': s.dataDate, 'cdc:nextReviewAt': s.nextReviewAt, 'cdc:source': s.source,
    'cdc:situation': (s.items ?? []).map((it) => ({ disease: it.disease, status: it.status, trend: it.trend, advice: it.advice, illustrative: !!it.illustrative })),
  });
}

/** 旅遊疫情（自訂）：SpecialAnnouncement + cdc:travel */
export function travelJsonLd(ctx, country, alerts = []) {
  const path = `/travel/${String(country.iso2 ?? country.id ?? '').toUpperCase()}/`;
  return clean({
    '@context': CONTEXT(), '@type': 'SpecialAnnouncement', '@id': `${abs(ctx, path)}#travel`, url: abs(ctx, path), inLanguage: ctx?.lang ?? 'zh-TW',
    name: `${country.name ?? country.nameEn} 旅遊疫情建議`, category: 'https://www.wikidata.org/wiki/Q81068910',
    spatialCoverage: clean({ '@type': 'Country', name: country.name, alternateName: country.nameEn, identifier: country.iso2 }),
    datePosted: alerts.map((a) => a.publishedAt ?? a.date).filter(Boolean).sort().at(-1),
    publisher: { '@id': ORG_ID(), '@type': 'GovernmentOrganization', name: config.name },
    'cdc:travel': alerts.map((a) => clean({ disease: a.disease ?? a.diseaseName, level: a.level, levelLabel: a.levelLabel, advice: a.advice, publishedAt: a.publishedAt ?? a.date })),
  });
}
