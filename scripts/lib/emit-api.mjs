// v1/*.json 輸出（骨架版；Agent A 補完 openapi.json、catalog、redirects 與各端點細節）
import { siteOrigin } from '../../site.config.mjs';

export function wrap(site, data, extra = {}) {
  return JSON.stringify({ meta: { api: 'v1', generatedAt: new Date().toISOString(), buildDate: site.today, license: 'OGDL-1.0', source: `${siteOrigin()}/`, docs: `${siteOrigin()}/developers/`, ...extra }, data }, null, 2);
}

export function govSummary(item) {
  const g = item.gov;
  return { owner: item.owner, reviewedAt: item.reviewedAt, nextReviewAt: g.nextReviewAt, overdue: g.overdue, status: item.status, whitelist: g.whitelist.effective, whitelistReasons: g.whitelist.reasons, superseded: g.superseded, supersededBy: g.supersededBy, isCurrent: g.isCurrent, annotations: g.annotations, license: item.license, sensitivity: item.sensitivity, languages: item.languages };
}

const strip = (item) => { const { __file, gov, ...rest } = item; return { ...rest, governance: govSummary(item) }; };

export function emitApi(site, write) {
  const c = site.collections;
  write('v1/diseases.json', wrap(site, site.master.diseases.map((d) => ({ ...d, page: c.diseases.find((p) => p.id === d.id) ? `/diseases/${d.slug}/` : null }))));
  for (const d of c.diseases) write(`v1/diseases/${d.slug}.json`, wrap(site, strip(d)));
  write('v1/vaccines.json', wrap(site, c.vaccines.map(strip)));
  write('v1/faq.json', wrap(site, c.faq.map(strip)));
  write('v1/news.json', wrap(site, c.news.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)).slice(0, 200).map(strip)));
  write('v1/documents.json', wrap(site, c.documents.map(strip)));
  write('v1/clarifications.json', wrap(site, c.clarifications.map(strip)));
  write('v1/situation.json', wrap(site, { ...site.situation, history: undefined, items: site.situation.items.map((it) => ({ ...it, diseaseName: site.diseaseMasterById.get(it.disease)?.name, slug: site.diseaseMasterById.get(it.disease)?.slug })) }));
  write('v1/travel-alerts.json', wrap(site, site.snapshots.travelAlerts.data, { provenance: site.snapshots.travelAlerts.meta }));
  write('v1/country-levels.json', wrap(site, site.snapshots.countryLevels.data, { provenance: site.snapshots.countryLevels.meta }));
  write('v1/datasets.json', wrap(site, c.datasets.map(strip)));
  write('v1/glossary.json', wrap(site, site.master.glossary));
  write('v1/units.json', wrap(site, site.master.units));
  write('v1/countries.json', wrap(site, site.master.countries));
  write('v1/banners.json', wrap(site, c.banners.filter((b) => b.startAt <= site.today && b.endAt >= site.today).map(strip)));
  write('v1/search-index.json', wrap(site, site.searchIndex.public));
  write('v1/search-index-pro.json', wrap(site, site.searchIndex.pro));
  write('v1/governance/kpi.json', wrap(site, site.gov.kpi));
  write('v1/governance/todos.json', wrap(site, site.gov.todos));
  write('v1/governance/ai-status.json', wrap(site, site.governance.aiStatus));
  write('v1/governance/whitelist.json', wrap(site, { policy: site.governance.whitelist, items: site.all.map((i) => ({ id: i.id, type: i.type, title: i.title, effective: i.gov.whitelist.effective, reasons: i.gov.whitelist.reasons })) }));
  write('v1/governance/eval-set.json', wrap(site, site.governance.evalSet));
  write('v1/governance/eval-report.json', wrap(site, site.evalReport));
  write('v1/catalog.json', wrap(site, site.all.filter((i) => i.status === 'published').map((i) => ({ id: i.id, type: i.type, title: i.title, owner: i.owner, ownerName: site.unitById.get(i.owner)?.name, canonicalUrl: i.canonicalUrl ?? null, license: i.license, sensitivity: i.sensitivity, reviewedAt: i.reviewedAt, nextReviewAt: i.gov.nextReviewAt, whitelist: i.gov.whitelist.effective, legacyUrls: i.legacyUrls ?? [] }))));
  write('v1/redirects.json', wrap(site, c.documents.filter((d) => !d.isCurrent && d.supersededBy).map((d) => ({ from: `/documents/${d.id.replace(/^doc\./, '')}/`, to: `/documents/${d.supersededBy.replace(/^doc\./, '')}/`, status: 301, legacy: d.legacyUrls ?? [] }))));
}
