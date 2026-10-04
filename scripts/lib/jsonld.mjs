// JSON-LD 建構（附錄 A schema.org 對應 + cdc: 治理擴充）
// 模板呼叫：
//   jsonLdFor(ctx, item)            → object[]（依型別：MedicalWebPage+MedicalCondition / FAQPage / NewsArticle / DigitalDocument / Dataset / ClaimReview / WebPage）
//   orgJsonLd(ctx)                  → GovernmentOrganization（layout 每頁放一份）
//   websiteJsonLd(ctx)              → WebSite + SearchAction（首頁）
//   breadcrumbJsonLd(ctx, [{name, path}]) → BreadcrumbList
//   situationJsonLd(ctx, situation) → Dataset + cdc:situation（態勢層）
//   travelJsonLd(ctx, country, alerts) → SpecialAnnouncement + cdc:travel（旅遊疫情，自訂）
//   governanceExt(ctx, item)        → cdc:* 擴充欄位（owner、reviewedAt、nextReviewAt、version、whitelist…）
//   第二輪：media → VideoObject（Clip 章節）、topic → CollectionPage、service → GovernmentService＋HowTo、
//          publication → PublicationIssue／Book、labtest → MedicalTest、research → ResearchProject、
//          news(recruit) → JobPosting、news(procurement) → WebPage＋cdc:refNo／cdc:validThrough（第七輪前相容）
//   第七輪：job → JobPosting（title、datePosted、validThrough、employmentType、hiringOrganization、jobLocation、totalJobOpenings；
//          薪資以 description 文字呈現，不給 baseSalary；甄選名單不放進 JSON-LD）、
//          tender → GovernmentService＋Offer（簡化：預算、公告／截止日、政府電子採購網連結、決標）
//   aboutOrgJsonLd(ctx)             → GovernmentOrganization＋subOrganization[]（/about/ 組織架構，master/units＋site.gov.byOwner）
import { config, siteOrigin } from '../../site.config.mjs';
import { mdToText } from './markdown.mjs';
import { pathOf, mdPathOf } from './governance.mjs';

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

/** 內容連結欄位：外部網址原樣；站內路徑（/pending/…）→ 絕對網址 */
const linkAbs = (ctx, u) => (!u || /^https?:\/\//.test(u) ? u : abs(ctx, u, { noLang: true }));
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

/** /about/：GovernmentOrganization＋subOrganization[]（由 master/units 產生；每單位附負責內容數與白名單數） */
export function aboutOrgJsonLd(ctx) {
  const site = ctx?.site;
  const stats = new Map((site?.gov?.byOwner ?? []).map((r) => [r.unit, r]));
  return clean({
    ...orgJsonLd(ctx), '@context': CONTEXT(),
    url: abs(ctx, '/about/'),
    subOrganization: (site?.master?.units ?? []).map((u) => clean({
      '@type': 'GovernmentOrganization', '@id': `${siteOrigin()}/about/#${u.id}`, name: u.name, alternateName: u.nameEn, identifier: u.id,
      parentOrganization: { '@id': ORG_ID() }, description: u.duties ?? u.description,
      'cdc:kind': u.kind ?? null, 'cdc:contentCount': stats.get(u.id)?.content ?? 0, 'cdc:whitelistCount': stats.get(u.id)?.whitelist ?? 0,
    })),
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

/** 秒 → ISO 8601 duration（PT1M35S） */
export function isoDuration(sec) {
  if (sec == null || !Number.isFinite(Number(sec))) return undefined;
  let n = Math.max(0, Math.round(Number(sec)));
  const h = Math.floor(n / 3600); n -= h * 3600;
  const m = Math.floor(n / 60); const s = n - m * 60;
  return `PT${h ? `${h}H` : ''}${m ? `${m}M` : ''}${s || (!h && !m) ? `${s}S` : ''}`;
}
const SERVICE_OUTPUT = { 'data-request': '資料提供', 'lab-request': '檢驗報告', certificate: '證明文件', donation: '捐款收據', clinic: '門診服務', notification: '通報受理', license: '許可文件', other: '服務結果' };
const LAB_LABELS = { 'cdc-lab': '疾管署檢驗中心', 'certified-lab': '認可檢驗機構', 'hospital-lab': '醫院檢驗單位', 'regional-lab': '區域實驗室' };
const asAsset = (ctx, p) => (p ? abs(ctx, p, { noLang: true }) : undefined);
const diseaseRef = (ctx, id) => clean({ '@type': 'MedicalCondition', name: ctx?.site?.diseaseMasterById?.get(id)?.name ?? id, alternateName: ctx?.site?.diseaseMasterById?.get(id)?.nameEn, identifier: id });
/** 作者欄：本站不放真人姓名，作者一律是機關／單位名 → Organization */
const authorOf = (name) => ({ '@type': 'Organization', name });
const TAIPEI = { '@type': 'Place', address: { '@type': 'PostalAddress', addressLocality: '臺北市', addressRegion: '臺北市', addressCountry: 'TW' } };

/** 職類 → schema.org employmentType */
export const EMPLOYMENT_TYPE = {
  約聘人員: ['FULL_TIME', 'TEMPORARY'], 約僱人員: ['FULL_TIME', 'TEMPORARY'], 聘用研究員: ['FULL_TIME', 'TEMPORARY'], 計畫助理: ['FULL_TIME', 'TEMPORARY'],
  公費醫師: ['FULL_TIME'], 技工工友駐衛警: ['FULL_TIME'], 公務人員商調: ['FULL_TIME'], 臨時人員: ['TEMPORARY'],
};
/** 工作地點文字 → Place（取開頭縣市為 addressRegion；其餘原文放 streetAddress） */
export function placeOfWorkplace(workplace) {
  const w = String(workplace ?? '').trim();
  const m = w.match(/^([\u4e00-\u9fff]{1,3}[市縣])/);
  return clean({ '@type': 'Place', address: clean({ '@type': 'PostalAddress', streetAddress: w || undefined, addressRegion: m ? m[1].replace(/^台/, '臺') : undefined, addressCountry: 'TW' }) });
}
const endOfDay = (d) => (d ? `${d}T23:59:59+08:00` : undefined);

/** 職缺 → JobPosting（只讀職缺正文欄位；result／waitlistUpdates 不輸出） */
export function jobPostingJsonLd(ctx, item) {
  const name = tr(ctx, item, 'title');
  const unit = ctx?.site?.unitById?.get(item.hiringUnit);
  const lines = [
    tr(ctx, item, 'summary'),
    item.duties?.length ? `工作內容：${item.duties.join('；')}` : null,
    item.qualifications?.length ? `資格條件：${item.qualifications.join('；')}` : null,
    item.salaryNote ? `薪資待遇：${item.salaryNote}` : null,
    item.requiredDocuments?.length ? `應備文件：${item.requiredDocuments.join('、')}` : null,
    item.examPlan?.length ? `甄試方式：${item.examPlan.map((e) => `${e.stage}${e.date ? `（${e.date}）` : ''}`).join('、')}` : null,
  ].filter(Boolean);
  const g = item.gov ?? {};
  const applyHref = g.applyHref ?? item.applyUrl ?? null;
  return clean({ ...baseOf(ctx, item, 'JobPosting'), title: name, name, description: lines.join('\n'),
    datePosted: item.publishedAt, validThrough: endOfDay(item.deadlineAt),
    employmentType: EMPLOYMENT_TYPE[item.jobType] ?? ['OTHER'],
    hiringOrganization: { '@type': 'GovernmentOrganization', '@id': ORG_ID(), name: config.name, sameAs: config.legacyOrigin },
    jobLocation: placeOfWorkplace(item.workplace), totalJobOpenings: item.positions,
    identifier: item.refNo ? { '@type': 'PropertyValue', name: config.name, value: item.refNo } : undefined,
    responsibilities: item.duties?.join('；'), qualifications: item.qualifications?.join('；'),
    directApply: !!g.applyOnSite, sameAs: item.applyUrl,
    potentialAction: applyHref && ['open'].includes(g.jobStage) ? { '@type': 'ApplyAction', target: /^https?:/.test(applyHref) ? applyHref : abs(ctx, applyHref) } : undefined,
    'cdc:hiringUnit': unit?.name ?? item.hiringUnit, 'cdc:jobType': item.jobType, 'cdc:salaryNote': item.salaryNote,
    'cdc:jobStage': g.jobStage ?? null, 'cdc:applyStart': item.applyStart, 'cdc:refNo': item.refNo ?? null, 'cdc:closed': !!g.closed,
    'cdc:resultPublishedAt': item.result?.publishedAt ?? null });
}

/** 採購公告 → GovernmentService＋Offer（簡化） */
export function tenderJsonLd(ctx, item) {
  const name = tr(ctx, item, 'title');
  const g = item.gov ?? {};
  return clean({ ...baseOf(ctx, item, 'GovernmentService'), name, description: tr(ctx, item, 'summary'), serviceType: `政府採購（${item.category}）`,
    provider: unitOrg(ctx, item.owner), areaServed: TAIWAN, identifier: item.tenderNo,
    availableChannel: item.pccUrl ? { '@type': 'ServiceChannel', name: '政府電子採購網', serviceUrl: item.pccUrl } : undefined,
    offers: clean({ '@type': 'Offer', name: `${item.method}${item.awardRule ? `（${item.awardRule}）` : ''}`, category: item.category, price: item.budgetNtd, priceCurrency: 'TWD',
      availabilityStarts: item.announcedAt, availabilityEnds: endOfDay(item.deadlineAt), validThrough: endOfDay(item.deadlineAt), url: item.pccUrl, seller: { '@id': ORG_ID() } }),
    'cdc:tenderNo': item.tenderNo, 'cdc:method': item.method, 'cdc:requestingUnit': ctx?.site?.unitById?.get(item.requestingUnit)?.name ?? item.requestingUnit,
    'cdc:budgetNtd': item.budgetNtd, 'cdc:openingAt': item.openingAt ?? null, 'cdc:tenderStage': g.tenderStage ?? null, 'cdc:closed': !!g.closed,
    'cdc:award': item.award ? clean({ date: item.award.date, winner: item.award.winner, amountNtd: item.award.amountNtd }) : null });
}

export function jsonLdFor(ctx, item) {
  const name = tr(ctx, item, 'title');
  const description = tr(ctx, item, 'summary');
  switch (item.type) {
    case 'job': return [jobPostingJsonLd(ctx, item)];
    case 'tender': return [tenderJsonLd(ctx, item)];
    case 'media': {
      const url = abs(ctx, pathOf(item));
      const chapters = item.chapters ?? [];
      const md = mdPathOf(item);
      return [clean({ ...baseOf(ctx, item, 'VideoObject'), name, description: description ?? name,
        uploadDate: item.publishedAt, dateCreated: item.producedAt, duration: isoDuration(item.durationSeconds),
        thumbnailUrl: asAsset(ctx, item.poster),
        embedUrl: item.youtubeId ? `https://www.youtube-nocookie.com/embed/${item.youtubeId}` : undefined,
        contentUrl: item.videoUrl, transcript: mdToText(tr(ctx, item, 'transcriptMarkdown')) || undefined,
        author: unitOrg(ctx, item.owner), genre: item.mediaType,
        subtitleLanguage: item.captions?.length ? item.captions : undefined,
        associatedMedia: md ? { '@type': 'MediaObject', encodingFormat: 'text/markdown', contentUrl: abs(ctx, md), name: '逐字稿（機讀版）' } : undefined,
        hasPart: chapters.map((ch, i) => clean({ '@type': 'Clip', name: ch.label, startOffset: ch.t, endOffset: chapters[i + 1]?.t ?? item.durationSeconds, url: `${url}#t=${ch.t}` })),
        about: (item.diseases ?? []).map((d) => diseaseRef(ctx, d)),
        correction: correctionsOf(item),
        'cdc:producedAt': item.producedAt ?? null, 'cdc:basedOnVersionLabel': item.basedOnVersionLabel ?? null,
        'cdc:mediaOutdated': !!item.gov?.mediaOutdated, 'cdc:hasTranscript': item.gov?.hasTranscript ?? null })];
    }
    case 'topic': {
      const links = item.links ?? [];
      return [clean({ ...baseOf(ctx, item, 'CollectionPage'), name, description, lastReviewed: item.reviewedAt, reviewedBy: unitOrg(ctx, item.owner),
        about: (item.diseases ?? []).map((d) => diseaseRef(ctx, d)),
        mainEntity: links.length ? { '@type': 'ItemList', numberOfItems: links.length, itemListElement: links.map((l, i) => clean({ '@type': 'ListItem', position: i + 1, name: l.label, url: /^https?:/.test(l.href) ? l.href : abs(ctx, l.href) })) } : undefined,
        hasPart: (item.contentIds ?? []).map((id) => ctx?.site?.byId?.get(id)).filter(Boolean).map((x) => ({ '@type': 'WebPage', name: x.title, url: abs(ctx, pathOf(x)) })),
        expires: item.endAt, 'cdc:startAt': item.startAt ?? null, 'cdc:endAt': item.endAt ?? null, 'cdc:ended': !!item.gov?.ended, 'cdc:kind': item.kind ?? null })];
    }
    case 'service': {
      const url = abs(ctx, pathOf(item));
      const steps = item.steps ?? [];
      const svc = clean({ ...baseOf(ctx, item, 'GovernmentService'), name, description, serviceType: item.serviceType,
        provider: unitOrg(ctx, item.owner), areaServed: TAIWAN,
        audience: (item.whoCanApply ?? []).map((w) => ({ '@type': 'Audience', audienceType: w })),
        availableChannel: clean({ '@type': 'ServiceChannel', name: item.applyUrl ? '線上申請' : '服務說明', serviceUrl: item.applyUrl ?? url, processingTime: item.slaDays ? `P${item.slaDays}D` : undefined }),
        serviceOutput: { '@type': 'Thing', name: SERVICE_OUTPUT[item.serviceType] ?? SERVICE_OUTPUT.other },
        termsOfService: item.legalBasis?.length ? item.legalBasis.join('；') : undefined,
        'cdc:slaDays': item.slaDays ?? null, 'cdc:fee': item.fee ?? null, 'cdc:requiredDocuments': item.requiredDocuments ?? [] });
      const howto = clean({ '@context': CONTEXT(), '@type': 'HowTo', '@id': `${url}#howto`, url, name: `如何申請：${name}`, inLanguage: ctx?.lang ?? 'zh-TW',
        totalTime: item.slaDays ? `P${item.slaDays}D` : undefined,
        supply: (item.requiredDocuments ?? []).map((d) => ({ '@type': 'HowToSupply', name: d })),
        step: steps.map((st, i) => clean({ '@type': 'HowToStep', position: i + 1, name: st.title, text: st.text ?? st.title, url: `${url}#step-${i + 1}` })) });
      return [svc, howto];
    }
    case 'publication': {
      const isIssue = item.issue != null || item.pubType === 'bulletin';
      const common = { name, description, author: (item.authors?.length ? item.authors.map(authorOf) : [unitOrg(ctx, item.owner)]),
        numberOfPages: item.pages, abstract: mdToText(tr(ctx, item, 'abstractMarkdown')) || undefined, image: asAsset(ctx, item.cover),
        identifier: item.gpn ? [{ '@type': 'PropertyValue', propertyID: 'GPN', value: item.gpn }] : undefined,
        encoding: item.pdfUrl ? [{ '@type': 'MediaObject', encodingFormat: 'application/pdf', contentUrl: linkAbs(ctx, item.pdfUrl) }] : undefined,
        hasPart: (item.articles ?? []).map((a) => clean({ '@type': 'ScholarlyArticle', headline: a.title, name: a.title, pagination: a.pages, author: (a.authors ?? []).map(authorOf), sameAs: a.doi ? `https://doi.org/${a.doi}` : undefined, abstract: a.abstract })),
        'cdc:series': item.series, 'cdc:pubType': item.pubType };
      if (isIssue) {
        return [clean({ ...baseOf(ctx, item, 'PublicationIssue'), ...common, issueNumber: item.issue != null ? String(item.issue) : undefined, datePublished: item.publishedAt,
          isPartOf: clean({ '@type': ['PublicationVolume', 'Periodical'], name: item.series, alternateName: item.seriesEn, volumeNumber: item.volume != null ? String(item.volume) : undefined, issn: item.issn, publisher: { '@id': ORG_ID() } }) })];
      }
      return [clean({ ...baseOf(ctx, item, 'Book'), ...common, isbn: item.isbn, bookEdition: item.edition, issn: item.issn,
        isPartOf: item.series ? clean({ '@type': 'CreativeWorkSeries', name: item.series, alternateName: item.seriesEn }) : undefined, offers: item.price ? { '@type': 'Offer', price: item.price, priceCurrency: 'TWD' } : undefined })];
    }
    case 'labtest': {
      const specimens = item.specimens ?? [];
      return [clean({ ...baseOf(ctx, item, 'MedicalTest'), name, description, audience: audienceOf(item),
        usedToDiagnose: diseaseRef(ctx, item.disease),
        usesDevice: [...new Set(specimens.map((s) => s.container).filter(Boolean))].map((c) => ({ '@type': 'MedicalDevice', name: c })),
        relevantSpecialty: 'https://schema.org/LaboratoryScience',
        'cdc:specimens': specimens.map((s) => clean({ name: s.name, timing: s.timing, container: s.container, volume: s.volume, storage: s.storage, transport: s.transport, tests: s.tests, turnaroundDays: s.turnaroundDays, note: s.note })),
        'cdc:labs': (item.labs ?? []).map((l) => LAB_LABELS[l] ?? l), 'cdc:sendWithinHours': item.sendWithinHours ?? null,
        'cdc:notifyWithinHours': ctx?.site?.diseaseMasterById?.get(item.disease)?.notifyWithinHours ?? null,
        'cdc:biosafetyLevel': item.biosafetyLevel ?? null })];
    }
    case 'research': {
      const report = item.reportDoc ? ctx?.site?.byId?.get(item.reportDoc) : null;
      return [clean({ ...baseOf(ctx, item, 'ResearchProject'), name, description,
        identifier: item.projectNo, foundingDate: item.year ? String(item.year) : undefined,
        sponsor: { '@id': ORG_ID(), '@type': 'GovernmentOrganization', name: config.name },
        member: item.piUnit ? { '@type': 'Organization', name: item.piUnit } : undefined,
        funding: item.budgetNtd ? { '@type': 'MonetaryGrant', funder: { '@id': ORG_ID() }, amount: { '@type': 'MonetaryAmount', value: item.budgetNtd, currency: 'TWD' } } : undefined,
        subjectOf: item.reportDoc ? { '@type': 'DigitalDocument', name: report?.title ?? '成果報告', url: report ? abs(ctx, pathOf(report)) : linkAbs(ctx, item.reportDoc) } : undefined,
        knowsAbout: (item.diseases ?? []).map((d) => diseaseRef(ctx, d)),
        'cdc:year': item.year ?? null, 'cdc:projectStatus': item.projectStatus, 'cdc:fundingType': item.fundingType ?? null, 'cdc:objectives': item.objectives ?? [],
        'cdc:irb': item.irb ?? null })];
    }
    case 'news': case 'letter':
      if (item.newsType === 'recruit') {
        return [clean({ ...baseOf(ctx, item, 'JobPosting'), title: name, name, description: mdToText(tr(ctx, item, 'bodyMarkdown')) || description,
          datePosted: item.publishedAt, validThrough: item.deadlineAt,
          hiringOrganization: { '@type': 'GovernmentOrganization', '@id': ORG_ID(), name: config.name, sameAs: config.legacyOrigin },
          jobLocation: TAIPEI, totalJobOpenings: item.positions, identifier: item.refNo ? { '@type': 'PropertyValue', name: config.name, value: item.refNo } : undefined,
          directApply: false, sameAs: item.applyUrl, 'cdc:refNo': item.refNo ?? null, 'cdc:closed': !!item.gov?.closed })];
      }
      if (item.newsType === 'procurement') {
        return [clean({ ...baseOf(ctx, item, 'WebPage'), name, description, author: unitOrg(ctx, item.owner), lastReviewed: item.reviewedAt,
          significantLink: item.applyUrl, 'cdc:refNo': item.refNo ?? null, 'cdc:validThrough': item.deadlineAt ?? null, 'cdc:budgetNtd': item.budgetNtd ?? null, 'cdc:closed': !!item.gov?.closed })];
      }
      return [clean({ ...baseOf(ctx, item, 'NewsArticle'), headline: String(name).slice(0, 110), name, description,
        author: unitOrg(ctx, item.owner), sourceOrganization: { '@id': ORG_ID() },
        articleSection: item.newsType ?? item.type, correction: correctionsOf(item),
        'cdc:refNo': item.refNo, 'cdc:deadlineAt': item.deadlineAt,
        about: (item.diseases ?? []).map((d) => ({ '@type': 'MedicalCondition', name: ctx?.site?.diseaseMasterById?.get(d)?.name ?? d, identifier: d })) })];
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
    case 'document': {
      const g = item.gov ?? {};
      const successor = g.supersededBy ? ctx?.site?.byId?.get(g.supersededBy) : null;
      const current = g.currentId && g.currentId !== item.id ? ctx?.site?.byId?.get(g.currentId) : null;
      return [clean({ ...baseOf(ctx, item, 'DigitalDocument'), name, description, version: item.version, datePublished: item.effectiveAt ?? item.publishedAt,
        author: unitOrg(ctx, item.owner), genre: item.docType,
        expires: successor?.effectiveAt, // 失效版：新版生效日起不再適用
        encoding: item.pdfUrl ? [{ '@type': 'MediaObject', encodingFormat: 'application/pdf', contentUrl: linkAbs(ctx, item.pdfUrl) }] : undefined,
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
