// JSON-LD 建構（骨架；Agent A 補完 MedicalCondition / FAQPage / NewsArticle / DigitalDocument / Dataset / GovernmentOrganization + cdc:governance 擴充）
// 模板呼叫：jsonLdFor(ctx, item) → object[]；orgJsonLd(ctx) → object
import { config, siteOrigin } from '../../site.config.mjs';

export function orgJsonLd(ctx) {
  return { '@context': 'https://schema.org', '@type': 'GovernmentOrganization', name: config.name, alternateName: config.nameEn, url: `${siteOrigin()}/`, telephone: config.hotline, parentOrganization: { '@type': 'GovernmentOrganization', name: '衛生福利部' } };
}

export function governanceExt(ctx, item) {
  const g = item.gov ?? {};
  return {
    'cdc:owner': ctx.site.unitById.get(item.owner)?.name ?? item.owner,
    'cdc:reviewedAt': item.reviewedAt, 'cdc:nextReviewAt': g.nextReviewAt ?? null, 'cdc:status': item.status,
    'cdc:version': item.version ?? null, 'cdc:isCurrent': g.isCurrent ?? true, 'cdc:supersededBy': g.supersededBy ?? null,
    'cdc:aiWhitelist': !!g.whitelist?.effective, 'cdc:license': item.license, 'cdc:id': item.id,
  };
}

export function jsonLdFor(ctx, item) {
  const base = { '@context': ['https://schema.org', { cdc: `${siteOrigin()}/developers/#vocab` }], url: `${config.siteUrl}${ctx.url(ctx.path ?? '/')}`, inLanguage: ctx.lang, dateModified: item.reviewedAt, datePublished: item.publishedAt, license: item.license, publisher: { '@type': 'GovernmentOrganization', name: config.name }, ...governanceExt(ctx, item) };
  switch (item.type) {
    case 'disease': return [{ ...base, '@type': 'MedicalCondition', name: item.title, alternateName: [item.nameEn, ...(item.aliases ?? [])], description: item.summary, code: (item.icd10 ?? []).map((c) => ({ '@type': 'MedicalCode', codeValue: c, codingSystem: 'ICD-10' })) }];
    case 'faq': return [{ ...base, '@type': 'FAQPage', mainEntity: [{ '@type': 'Question', name: item.question, acceptedAnswer: { '@type': 'Answer', text: item.answerMarkdown } }] }];
    case 'news': case 'letter': return [{ ...base, '@type': 'NewsArticle', headline: item.title, description: item.summary }];
    case 'document': return [{ ...base, '@type': 'DigitalDocument', name: item.title, version: item.version, description: item.summary }];
    case 'dataset': return [{ ...base, '@type': 'Dataset', name: item.title, description: item.summary, distribution: (item.formats ?? []).map((f) => ({ '@type': 'DataDownload', encodingFormat: f, contentUrl: item.canonicalUrl })) }];
    default: return [{ ...base, '@type': 'WebPage', name: item.title, description: item.summary }];
  }
}
