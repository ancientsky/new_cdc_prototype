// 後台共用片段（Agent E）。底線開頭＝不會被當成頁面模板自動登錄。
// 原則：治理狀態一律來自 item.gov / site.gov（建置時由引擎算），這裡只做呈現，不重算規則。
import { html, raw, jsonScript, esc, daysBetween } from '../../../scripts/lib/render.mjs';
import { config } from '../../../site.config.mjs';
import { allJobs, allTenders, applyOnSite, jobStage, jobIsHistory, tenderStage, jobPath, tenderPath, MASK_RE } from '../public/_careers.mjs';

export const DEFAULT_UNIT = 'unit.acute-infectious';

export const TYPE_LABEL = {
  disease: '疾病頁', faq: 'Q&A', news: '新聞稿', letter: '致醫界通函', clarification: '澄清', document: '文件', vaccine: '疫苗頁',
  dataset: '資料集', banner: '宣導 Banner', page: '一般頁面',
  media: '影音', topic: '專區', service: '申請服務', publication: '出版品', labtest: '檢驗項目', research: '研究計畫', job: '招募職缺', tender: '採購公告',
};
/** news 型別的 newsType（含人才招募、採購公告）。 */
export const NEWS_SUBTYPE_LABEL = { press: '新聞稿', letter: '致醫界通函', clarification: '澄清稿', other: '其他訊息', recruit: '人才招募', procurement: '採購公告' };
export const STATUS_LABEL = { draft: '草稿', review: '複核中', published: '已發布', archived: '已封存' };
export const CATEGORY_LABEL = {
  'open-dataset': '開放資料集', 'stats-system': '統計系統', 'structured-table': '結構化表格', 'document-library': '文件庫',
  'content-page': '內容頁', press: '新聞稿／公告', media: '影音宣導素材', topic: '專區', service: '申請服務', publication: '出版品', labtest: '檢驗項目', research: '研究計畫',
};
export const KIND_LABEL = {
  'based-on-revised': '依據正本已修訂', 'reverse-audit': '反向稽核命中', overdue: '逾期', 'translation-stale': '翻譯過期',
  'dataset-overdue': '資料集逾期', 'license-missing': '授權缺漏', 'superseded-still-linked': '失效版仍被連結', 'situation-overdue': '態勢層逾期',
  'media-outdated': '影音過時', 'media-no-transcript': '無逐字稿', 'link-broken': '連結失效', 'labtest-inconsistent': '檢驗不一致',
  'migration-pending': '舊頁待移轉',
  'job-result-overdue': '招募結果逾期', 'job-waitlist-expiring': '備取將到期', 'job-apply-url-dead': '報名網址失效', 'tender-award-overdue': '決標逾期',
};
export const KIND_ORDER = ['based-on-revised', 'reverse-audit', 'overdue', 'translation-stale', 'dataset-overdue', 'license-missing', 'superseded-still-linked', 'situation-overdue', 'media-outdated', 'media-no-transcript', 'link-broken', 'labtest-inconsistent', 'migration-pending', 'job-result-overdue', 'job-waitlist-expiring', 'job-apply-url-dead', 'tender-award-overdue'];
export const WL_REASON_LABEL = {
  'not-published': '尚未發布', overdue: '逾期未審閱', superseded: '已被新版取代', sensitivity: '敏感等級非公開',
  'based-on-revised': '依據正本已修訂', 'not-requested': '未申請進白名單', 'type-not-allowed': '型別不在白名單政策', 'reverse-audit': '反向稽核命中',
};
export const FREQ_LABEL = { daily: '每日', weekly: '每週', monthly: '每月', quarterly: '每季', yearly: '每年', irregular: '不定期' };
export const SENS_LABEL = { public: '公開', professional: '專業人員', internal: '內部' };
export const LANGS = [
  { code: 'zh-TW', label: '繁體中文' }, { code: 'en', label: 'English' }, { code: 'ja', label: '日本語' }, { code: 'tl', label: 'Tagalog' },
  { code: 'vi', label: 'Tiếng Việt' }, { code: 'id', label: 'Bahasa Indonesia' }, { code: 'th', label: 'ไทย' },
];
export const NAV = [
  { key: 'mine', href: '/admin/mine/', label: '我的內容' },
  { key: 'publish', href: '/admin/publish/', label: '上架新內容' },
  { key: 'review', href: '/admin/review/', label: '複核區', count: 'review' },
  { key: 'due', href: '/admin/due/', label: '審閱到期', count: 'due' },
  { key: 'catalog', href: '/admin/catalog/', label: '資料目錄' },
  { key: 'notices', href: '/admin/notices/', label: '公告', count: 'notices' },
  { key: 'jobs', href: '/admin/jobs/', label: '人才招募', count: 'jobs' },
  { key: 'tenders', href: '/admin/tenders/', label: '採購', count: 'tenders' },
  { key: 'media', href: '/admin/media/', label: '影音', count: 'media' },
  { key: 'links', href: '/admin/links/', label: '連結', count: 'links' },
  { key: 'migration', href: '/admin/migration/', label: '移轉進度', count: 'migration' },
  { key: 'import', href: '/admin/import/', label: '舊站匯入' },
  { key: 'glossary', href: '/admin/glossary/', label: '詞彙主檔' },
  { key: 'situation', href: '/admin/situation/', label: '態勢發布' },
  { key: 'todos', href: '/admin/todos/', label: '連動待辦', count: 'todos' },
  { key: 'ai-status', href: '/admin/ai-status/', label: 'AI 開關' },
  { key: 'reports', href: '/admin/reports/', label: '回報' },
  { key: 'eval', href: '/admin/eval/', label: '評估' },
  { key: 'dashboard', href: '/admin/', label: '儀表板' },
];

/** 內容在前台的路徑（不含 basePath）。找不到對應頁回傳 null。 */
export function frontPath(item) {
  const rest = String(item.id ?? '').replace(/^[a-z]+\./, '');
  switch (item.type) {
    case 'disease': return `/diseases/${item.slug ?? rest}/`;
    case 'faq': return `/faq/${rest}/`;
    case 'news': case 'letter': return `/news/${rest}/`;
    case 'document': return `/documents/${rest}/`;
    case 'vaccine': return `/vaccines/${item.slug ?? rest}/`;
    case 'media': return `/media/${rest}/`;
    case 'topic': return `/topics/${item.slug ?? rest}/`;
    case 'service': return `/apply/${item.slug ?? rest}/`;
    case 'publication': return `/publications/${rest}/`;
    case 'labtest': return `/lab/${rest}/`;
    case 'research': return `/research/${rest}/`;
    case 'job': return jobPath(item);
    case 'tender': return tenderPath(item);
    case 'clarification': return '/factcheck/';
    case 'dataset': return '/data/';
    default: return null;
  }
}

export function categoryOf(item) {
  if (item.type === 'dataset') return item.category ?? 'open-dataset';
  if (['news', 'letter', 'clarification'].includes(item.type)) return 'press';
  if (item.type === 'document') return 'document-library';
  if (['media', 'topic', 'service', 'publication', 'labtest', 'research'].includes(item.type)) return item.type;
  return 'content-page';
}

/** 把 site.all 攤平成後台用列（可直接 JSON 嵌入頁面）。 */
export function catalogRows(site) {
  const licOk = new Set(site.config.licenses.allowed);
  const mediaById = new Map(mediaRows(site).map((r) => [r.id, r]));
  const linksByItem = new Map();
  for (const l of linkRows(site)) { const h = linksByItem.get(l.itemId) ?? { ok: 0, broken: 0, unchecked: 0, total: 0 }; h[l.status] = (h[l.status] ?? 0) + 1; h.total++; linksByItem.set(l.itemId, h); }
  const noticeById = new Map(noticeRows(site).map((r) => [r.id, r]));
  return site.all.map((i) => {
    const mr = mediaById.get(i.id), nr = noticeById.get(i.id);
    const g = i.gov ?? { whitelist: { effective: false, reasons: [] }, stale: [], reverseAuditHits: [], annotations: [] };
    return {
      id: i.id, type: i.type, title: i.title, owner: i.owner, ownerName: site.unitById.get(i.owner)?.name ?? i.owner, steward: i.steward ?? '',
      status: i.status, publishedAt: i.publishedAt, reviewedAt: i.reviewedAt, reviewPeriodMonths: i.reviewPeriodMonths,
      nextReviewAt: g.nextReviewAt ?? null, daysToReview: g.daysToReview ?? null, overdue: !!g.overdue,
      superseded: !!g.superseded, supersededBy: g.supersededBy ?? null, stale: (g.stale ?? []).length, audit: (g.reverseAuditHits ?? []).length,
      wl: !!g.whitelist?.effective, wlReasons: g.whitelist?.reasons ?? [],
      wlReasonText: (g.whitelist?.reasons ?? []).map((x) => site.gov?.reasonLabels?.[x] ?? WL_REASON_LABEL[x] ?? x),
      lifecycle: g.lifecycle ?? null, lifecycleLabel: g.lifecycleLabel ?? null, wlRequested: !!(i.aiWhitelist?.requested),
      license: i.license, licenseOk: licOk.has(i.license), sensitivity: i.sensitivity, category: categoryOf(i),
      canonicalUrl: i.canonicalUrl ?? null, legacy: (i.legacyUrls ?? [])[0] ?? null, updateFrequency: i.updateFrequency ?? null, lastUpdated: i.lastUpdated ?? null,
      datasetOverdue: !!g.datasetOverdue, front: frontPath(i), version: i.version ?? null, family: i.family ?? null, basedOn: i.basedOn ?? [],
      diseases: i.diseases ?? [], languages: Object.fromEntries(Object.entries(i.languages ?? {}).map(([k, v]) => [k, v.status])),
      newsType: i.newsType ?? null, notice: nr ? { deadlineAt: nr.deadlineAt, days: nr.days, closed: nr.closed, closingSoon: nr.closingSoon } : null,
      media: mr ? { hasTranscript: mr.hasTranscript, basisCurrent: mr.basisCurrent, outdated: mr.outdated, transcriptChars: mr.transcriptChars } : null,
      linkHealth: i.type === 'topic' ? (linksByItem.get(i.id) ?? { ok: 0, broken: 0, unchecked: 0, total: 0 }) : null,
    };
  });
}

/** 生命週期標籤（HTML）。 */
export function lifecycleBadges(r) {
  const out = [html`<span class="adm-badge ${r.status === 'published' ? 'adm-badge--ok' : r.status === 'review' ? 'adm-badge--info' : 'adm-badge--gray'}">${STATUS_LABEL[r.status] ?? r.status}</span>`];
  if (r.superseded) out.push(html`<span class="adm-badge adm-badge--bad">已失效（被取代）</span>`);
  if (r.overdue) out.push(html`<span class="adm-badge adm-badge--warn">逾期未審閱</span>`);
  if (r.stale) out.push(html`<span class="adm-badge adm-badge--revised">依據正本已修訂</span>`);
  if (r.audit) out.push(html`<span class="adm-badge adm-badge--bad">反向稽核命中</span>`);
  return out;
}

export function wlCell(r) {
  if (r.wl) return html`<span class="adm-badge adm-badge--ok">生效</span>`;
  const why = (r.wlReasonText ?? (r.wlReasons ?? []).map((x) => WL_REASON_LABEL[x] ?? x)).join('、');
  return html`<span class="adm-badge adm-badge--gray">不生效</span>${why ? html` <span class="adm-muted">${why}</span>` : ''}`;
}

export function pageHead({ title, what, flow }) {
  return html`<header class="adm-pagehead"><h1>${title}</h1><p class="adm-pagehead__what">${what}</p>${flow ? html`<p class="adm-pagehead__flow"><strong>正式環境：</strong>${flow}</p>` : ''}</header>`;
}

export function unitOptions(site, { all = true, selected = DEFAULT_UNIT, allLabel = '全部單位' } = {}) {
  return [
    ...(all ? [html`<option value="all">${allLabel}</option>`] : []),
    ...site.master.units.filter((u) => u.publishes !== false).map((u) => html`<option value="${u.id}" ${u.id === selected ? raw('selected') : ''}>${u.name}</option>`),
  ];
}

export function dataScript(id, obj) {
  return raw(`<script type="application/json" id="${id}">${jsonScript(obj)}</script>`);
}

export function counts(site) {
  const rows = site.all;
  const review = rows.filter((i) => i.status === 'review').length;
  const due = rows.filter((i) => i.status === 'published' && !i.gov?.superseded && i.gov?.nextReviewAt && i.gov.daysToReview != null && i.gov.daysToReview <= 30).length;
  const todos = todoList(site).length;
  const media = mediaRows(site).filter((m) => m.outdated || !m.hasTranscript).length;
  const links = linkRows(site).filter((l) => l.status === 'broken').length;
  const notices = noticeRows(site).filter((n) => n.closed && !n.archived).length;
  const migration = site.migration?.stats?.pending ?? (site.migration?.pending?.length ?? 0);
  const jobs = jobRows(site).filter((j) => j.attention).length;
  const tenders = tenderRows(site).filter((x) => x.attention).length;
  return { review, due, todos, media, links, notices, migration, jobs, tenders };
}

export function daysText(d) {
  if (d == null) return '事件觸發';
  if (d < 0) return `已逾期 ${-d} 日`;
  if (d === 0) return '今日到期';
  return `${d} 日後`;
}

export { html, raw, esc, jsonScript, daysBetween };

/** 後台頁的標準 meta。 */
export function adminMeta(title, key, scripts = [], description = '') {
  return { title: `${title}（內容管理後台）`, description: description || `${title}：疾管署 AI-ready 新官網原型之內容管理後台示範頁`, noindex: true, adminKey: key, scripts };
}

// ───────── 取值輔助（A 的治理引擎持續演進，這裡一律防禦式讀取）─────────
export function sitGov(site) {
  const g = site.gov?.situation;
  const sit = site.situation ?? {};
  const lag = g?.lagDays ?? (sit.dataDate ? daysBetween(sit.dataDate, site.today) : null);
  const nextReviewAt = g?.nextReviewAt ?? sit.nextReviewAt ?? null;
  return { dataDate: g?.dataDate ?? sit.dataDate ?? null, publishedAt: g?.publishedAt ?? sit.publishedAt ?? null, publisher: sit.publisher, nextReviewAt, lagDays: lag, overdue: g?.overdue ?? (nextReviewAt ? nextReviewAt < site.today : false) };
}
export function todoList(site) {
  const base = site.gov?.todos ?? [];
  return [...base, ...derivedTodos(site, base)].map((t, i) => ({
    ...t,
    id: t.id ?? `${t.kind}:${t.itemId}:${i}`,
    ownerName: t.ownerName ?? site.unitById.get(t.owner)?.name ?? t.owner,
    itemTitle: t.itemTitle ?? site.byId.get(t.itemId)?.title ?? t.itemId,
    overdue: t.overdue ?? (t.dueAt ? t.dueAt < site.today : false),
  }));
}
export function byOwnerRows(site) {
  if (Array.isArray(site.gov?.byOwner) && site.gov.byOwner.length) return site.gov.byOwner;
  const map = new Map();
  const row = (id) => { if (!map.has(id)) map.set(id, { unit: id, name: site.unitById.get(id)?.name ?? id, content: 0, published: 0, whitelist: 0, overdue: 0, dueSoon: 0, stale: 0, todos: 0, todosOverdue: 0 }); return map.get(id); };
  for (const i of site.all) { const r = row(i.owner); r.content++; if (i.status === 'published') r.published++; if (i.gov?.whitelist?.effective) r.whitelist++; if (i.gov?.overdue) r.overdue++; if ((i.gov?.stale ?? []).length) r.stale++; }
  for (const t of todoList(site)) { if (!t.owner) continue; const r = row(t.owner); r.todos++; if (t.overdue) r.todosOverdue++; }
  return [...map.values()];
}
/** KPI 進度（0–100）：越高越好看「目前 / 三年目標」；越低越好看「目標 / 目前」。 */
export function kpiProgress(k) {
  if (k.current == null) return null;
  const t3 = k.target3y ?? k.target1y;
  if (t3 == null) return null;
  if (k.direction === 'lower') return k.current <= t3 ? 100 : t3 > 0 ? Math.max(0, Math.round((t3 / k.current) * 100)) : 0;
  return t3 > 0 ? Math.min(100, Math.round((k.current / t3) * 100)) : 100;
}
export const fmtNum = (v, unit) => (v == null ? '—' : `${v}${unit === '%' ? '%' : ''}`);


// ───────── 第二輪（ARCHITECTURE §11）：影音、公告、外部連結的後台取值 ─────────
export const addDays = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const isHttp = (u) => /^https?:\/\//i.test(String(u ?? ''));
/** B2 內容的標示常寫成「依 114.04.16 建議製作」：去掉頭尾的「依」「製作」，免得說明欄變成「依據 依 …」。 */
export const cleanLabel = (l) => String(l ?? '').trim().replace(/^依據?\s*/, '').replace(/\s*製作$/, '');
export const HAS_TRANSCRIPT_MIN = 50; // 逐字稿少於這個字數視為「沒有」（與引擎 MIN_TRANSCRIPT_CHARS 一致）
export const absUrl = (path) => `${config.siteUrl}${config.basePath}${path}`;

/** 文件 family → { family, title, versions[] 新到舊, current }。 */
function docFamilies(site) {
  const map = new Map();
  for (const d of site.collections.documents ?? []) {
    if (!d.family) continue;
    if (!map.has(d.family)) map.set(d.family, { family: d.family, versions: [] });
    map.get(d.family).versions.push(d);
  }
  for (const f of map.values()) {
    f.versions.sort((a, b) => String(b.effectiveAt).localeCompare(String(a.effectiveAt)));
    f.current = f.versions.find((v) => v.gov?.isCurrent) ?? f.versions.find((v) => v.status === 'published') ?? f.versions[0];
    f.title = String(f.current?.title ?? f.family).replace(/（.*版）$/, '');
  }
  return map;
}
/** basedOn 的每一項（文件 id、family 或其他內容 id）解析成正本資訊。 */
function resolveBasis(site, refs = []) {
  const fams = docFamilies(site);
  return refs.map((ref) => {
    const doc = site.byId.get(ref);
    const fam = fams.get(ref) ?? (doc?.family ? fams.get(doc.family) : null);
    if (fam) return { ref, kind: 'document', family: fam.family, title: fam.title, current: fam.current, used: doc ?? null, path: frontPath(fam.current) };
    if (doc) return { ref, kind: doc.type, family: null, title: doc.title, current: doc, used: doc, path: frontPath(doc), diseases: doc.diseases ?? [] };
    return { ref, kind: 'unknown', family: null, title: ref, current: null, used: null, path: null };
  });
}
function auditHitsOf(site, item, text, basis) {
  const out = [];
  const seen = new Set();
  for (const h of item.gov?.reverseAuditHits ?? []) { const k = h.rule ?? h.message ?? h.term; if (!seen.has(k)) { seen.add(k); out.push({ match: h.term ?? h.snippet ?? '', message: h.rule ?? h.message ?? '' }); } }
  const scope = new Set([...(item.diseases ?? []), ...basis.flatMap((b) => [...(b.current?.diseases ?? []), ...(b.diseases ?? [])]), ...(item.basedOn ?? [])]);
  for (const d of site.master.diseases ?? []) for (const r of d.auditRules ?? []) {
    if (r.scope?.length && !r.scope.some((x) => scope.has(x))) continue;
    try { const m = new RegExp(r.pattern).exec(String(text).replace(/[（(]含[）)]/g, '')); if (m && !seen.has(r.message)) { seen.add(r.message); out.push({ match: m[0], message: r.message }); } } catch { /* 無效 regex 略過 */ }
  }
  return out;
}

/** 影音管理列（每支影片）。優先用引擎算好的 gov；沒有就由 producedAt vs 正本現行版 effectiveAt 推算。 */
export function mediaRows(site) {
  return (site.collections.media ?? []).map((m) => {
    const g = m.gov ?? {};
    const basis = resolveBasis(site, m.basedOn ?? []);
    const b0 = basis.find((b) => b.current) ?? null;
    const computed = basis.some((b) => b.kind === 'document' && b.current?.effectiveAt && m.producedAt && m.producedAt < b.current.effectiveAt);
    const outdated = g.mediaOutdated != null ? !!g.mediaOutdated : ((g.stale ?? []).length > 0 || computed);
    const transcript = String(m.transcriptMarkdown ?? '');
    const chars = g.transcriptChars ?? transcript.replace(/\s/g, '').length;
    const hasTranscript = g.hasTranscript != null ? !!g.hasTranscript : chars >= HAS_TRANSCRIPT_MIN;
    const curPath = b0?.path ?? null;
    return {
      id: m.id, title: m.title, owner: m.owner, ownerName: site.unitById.get(m.owner)?.name ?? m.owner, status: m.status, front: frontPath(m), mediaType: m.mediaType ?? 'video',
      youtubeId: m.youtubeId ?? null, producedAt: m.producedAt ?? null, label: cleanLabel(m.basedOnVersionLabel), basedOn: m.basedOn ?? [],
      basis: basis.map((b) => ({ ref: b.ref, title: b.title, version: b.current?.version ?? null, effectiveAt: b.current?.effectiveAt ?? null, path: b.path })),
      curVersion: b0?.current?.version ?? null, curEffectiveAt: b0?.current?.effectiveAt ?? null, curPath, curUrl: curPath ? absUrl(curPath) : null,
      noBasis: !(m.basedOn ?? []).length, outdated, basisCurrent: basis.length > 0 && !outdated, transcriptChars: chars, hasTranscript,
      captions: m.captions ?? [], chapters: (m.chapters ?? []).length, audit: auditHitsOf(site, m, `${transcript}\n${m.title ?? ''}\n${m.summary ?? ''}`, basis),
      wl: !!g.whitelist?.effective,
    };
  });
}

/** 公告管理列：人才招募、採購公告、其他訊息。截止狀態優先用引擎的 gov.closed／closingSoon，否則由 deadlineAt 推算。 */
export function noticeRows(site) {
  const today = site.today;
  return (site.collections.news ?? []).filter((n) => ['recruit', 'procurement', 'other'].includes(n.newsType)).map((n) => {
    const g = n.gov ?? {};
    const days = n.deadlineAt ? daysBetween(today, n.deadlineAt) : null;
    const closed = g.closed != null ? !!g.closed : (days != null && days < 0);
    const closingSoon = g.closingSoon != null ? !!g.closingSoon : (!closed && days != null && days <= 7);
    return {
      id: n.id, title: n.title, newsType: n.newsType, owner: n.owner, ownerName: site.unitById.get(n.owner)?.name ?? n.owner, status: n.status, front: frontPath(n),
      deadlineAt: n.deadlineAt ?? null, days, closed, closingSoon, open: !closed && n.status === 'published', archived: n.status === 'archived',
      refNo: n.refNo ?? '', applyUrl: n.applyUrl ?? '', positions: n.positions ?? null, budgetNtd: n.budgetNtd ?? null, publishedAt: n.publishedAt,
    };
  }).sort((a, b) => String(a.deadlineAt ?? '9999').localeCompare(String(b.deadlineAt ?? '9999')));
}

/** 全部外部連結（專區連結、申請網址與表單、公告報名網址、出版品 PDF、影片網址）。 */
export function linkRows(site) {
  // 引擎已彙整（site.gov.externalLinks，含 CI 檢查結果）就直接用；否則由內容欄位自行收集
  if (Array.isArray(site.gov?.externalLinks)) {
    return site.gov.externalLinks.map((l) => ({
      itemId: l.itemId, itemTitle: l.itemTitle, itemType: l.itemType, owner: l.owner, ownerName: l.ownerName ?? site.unitById.get(l.owner)?.name ?? l.owner,
      front: site.byId.get(l.itemId) ? frontPath(site.byId.get(l.itemId)) : null, field: l.field, label: l.label ?? '', href: l.url ?? l.href,
      lastCheckedAt: l.lastCheckedAt ?? null, status: ['ok', 'broken'].includes(l.status) ? l.status : 'unchecked',
    }));
  }
  const out = [];
  const add = (item, field, label, href, extra = {}) => {
    if (!isHttp(href)) return;
    out.push({
      itemId: item.id, itemTitle: item.title, itemType: item.type, owner: item.owner, ownerName: site.unitById.get(item.owner)?.name ?? item.owner, front: frontPath(item),
      field, label, href, lastCheckedAt: (item.linkChecks?.[field] ?? extra).lastCheckedAt ?? null, status: ['ok', 'broken'].includes((item.linkChecks?.[field] ?? extra).status) ? (item.linkChecks?.[field] ?? extra).status : 'unchecked',
    });
  };
  for (const t of site.collections.topics ?? []) (t.links ?? []).forEach((l, i) => add(t, `links[${i}]`, l.label, l.href, l));
  for (const sv of site.collections.services ?? []) {
    add(sv, 'applyUrl', '線上申請', sv.applyUrl);
    (sv.forms ?? []).forEach((f, i) => add(sv, `forms[${i}]`, f.label, f.href));
  }
  for (const n of site.collections.news ?? []) add(n, 'applyUrl', '報名／投標', n.applyUrl);
  for (const p of site.collections.publications ?? []) add(p, 'pdfUrl', 'PDF', p.pdfUrl);
  for (const m of site.collections.media ?? []) add(m, 'videoUrl', '影片網址', m.videoUrl);
  return out;
}
export const linkCounts = (rows) => ({ ok: rows.filter((r) => r.status === 'ok').length, broken: rows.filter((r) => r.status === 'broken').length, unchecked: rows.filter((r) => r.status === 'unchecked').length, total: rows.length });

/** 引擎產生的待辦優先；引擎尚未涵蓋的（同 kind＋同內容沒有待辦），後台依欄位補推算，讓頁籤不是空的。 */
function derivedTodos(site, base) {
  const has = (kind, itemId) => base.some((t) => t.kind === kind && (itemId == null || t.itemId === itemId));
  const out = [];
  const due = addDays(site.today, 7);
  {
    for (const m of mediaRows(site).filter((r) => r.outdated && !has('media-outdated', r.id))) {
      const b = m.basis.find((x) => x.version);
      out.push({ kind: 'media-outdated', itemId: m.id, owner: m.owner, dueAt: due, derived: true,
        text: `影片製作於 ${m.producedAt}，早於依據正本${b ? `《${b.title}》現行版 ${b.version}（${b.effectiveAt} 生效）` : '現行版'}。請擇一：更新說明欄、加資訊卡、或下架。` });
    }
  }
  {
    for (const m of mediaRows(site).filter((r) => !r.hasTranscript && !has('media-no-transcript', r.id))) out.push({ kind: 'media-no-transcript', itemId: m.id, owner: m.owner, dueAt: addDays(site.today, 14), derived: true, text: '影片沒有逐字稿（或過短）：補逐字稿後才能進 AI 索引與反向稽核。' });
  }
  {
    for (const l of linkRows(site).filter((r) => r.status === 'broken' && !base.some((t) => t.kind === 'link-broken' && t.itemId === r.itemId && String(t.text ?? '').includes(r.href)))) out.push({ kind: 'link-broken', itemId: l.itemId, owner: l.owner, dueAt: due, derived: true, text: `外部連結失效：${l.label}（${l.href}）。請更新網址或移除。` });
  }
  // 第七輪：引擎（governance.mjs）已產生這四種待辦時以引擎為準；沒有時由欄位補推算
  for (const j of jobRows(site)) {
    if (j.resultOverdue && !has('job-result-overdue', j.id)) out.push({ kind: 'job-result-overdue', itemId: j.id, owner: 'unit.personnel', dueAt: addDays(j.resultPlannedAt, 7), derived: true, text: `預計 ${j.resultPlannedAt} 公布結果，已逾 ${j.resultOverdueDays} 日仍未上架。請上架甄選結果或更新預計日。` });
    const wl = (allJobs(site).find((x) => x.id === j.id)?.result?.waitlist ?? []).filter((w) => w.validUntil && w.validUntil >= site.today && w.validUntil <= addDays(site.today, 14));
    if (wl.length && !has('job-waitlist-expiring', j.id)) out.push({ kind: 'job-waitlist-expiring', itemId: j.id, owner: 'unit.personnel', dueAt: wl.map((w) => w.validUntil).sort()[0], derived: true, text: `${wl.length} 位備取的有效期在 14 日內屆滿。` });
  }
  for (const x of tenderRows(site)) if (x.awardOverdue && !has('tender-award-overdue', x.id)) out.push({ kind: 'tender-award-overdue', itemId: x.id, owner: 'unit.secretariat', dueAt: addDays(x.openingAt, 30), derived: true, text: `開標日 ${x.openingAt} 起已逾 ${x.sinceOpen} 日仍無決標資訊。請上架決標資訊或標示流標。` });
  return out;
}

/* ───────── 第七輪：人才招募（人事室）與採購公告（秘書室） ───────── */
const dayDiff = (a, b) => (a && b ? daysBetween(a, b) : null);
/**
 * 職缺列：階段優先用 gov.jobStage。結果上架檢核（只對有 result 的職缺）：
 *  - mask：正取／備取／遞補的 nameMasked 是否全含遮罩字（○◯〇＊）
 *  - capacity：正取數 ≤ 名額
 *  - waitlist：備取皆有 validUntil、且最晚有效期未過今日（沒有備取視為不適用）
 */
export function jobRows(site) {
  const today = site.today;
  return allJobs(site).map((j) => {
    const stage = jobStage(site, j);
    const r = j.result ?? null;
    const names = r ? [...(r.admitted ?? []), ...(r.waitlist ?? []), ...(j.waitlistUpdates ?? [])] : [];
    const maskBad = names.filter((n) => !MASK_RE.test(String(n.nameMasked ?? ''))).length;
    const admitted = r ? (r.admitted ?? []).length : null;
    const wl = r ? (r.waitlist ?? []) : [];
    const noValid = wl.filter((w) => !w.validUntil).length;
    const lastValid = wl.map((w) => w.validUntil).filter(Boolean).sort().pop() ?? null;
    const checks = r ? {
      mask: { ok: maskBad === 0, text: maskBad === 0 ? `${names.length} 筆姓名全含遮罩字` : `${maskBad} 筆姓名沒有遮罩字（建置會失敗）` },
      capacity: { ok: j.positions == null || admitted <= j.positions, text: `正取 ${admitted} ／ 名額 ${j.positions ?? '—'}` },
      waitlist: wl.length ? { ok: noValid === 0 && (!lastValid || lastValid >= today), text: noValid ? `${noValid} 位備取沒有有效期` : lastValid && lastValid < today ? `備取有效期已於 ${lastValid} 屆滿` : `備取 ${wl.length} 位，有效至 ${lastValid ?? '—'}` } : { ok: true, text: '無備取' },
    } : null;
    const resultDue = j.resultPlannedAt && !r && ['closed', 'screening'].includes(stage) ? dayDiff(j.resultPlannedAt, today) : null;
    const resultOverdue = resultDue != null && resultDue > 7;
    const checksBad = checks ? Object.values(checks).some((c) => !c.ok) : false;
    return {
      id: j.id, title: j.title, status: j.status, stage, history: jobIsHistory(site, j, stage), jobType: j.jobType ?? '', hiringUnit: j.hiringUnit, hiringName: site.unitById.get(j.hiringUnit)?.name ?? j.hiringUnit ?? '',
      positions: j.positions ?? null, applyStart: j.applyStart ?? null, deadlineAt: j.deadlineAt ?? null, resultPlannedAt: j.resultPlannedAt ?? null, resultAt: r?.publishedAt ?? null,
      external: !!j.applyUrl, onSite: applyOnSite(j), applyMethod: j.applyMethod ?? '', applyUrl: j.applyUrl ?? '', daysLeft: stage === 'open' ? dayDiff(today, j.deadlineAt) : null, front: jobPath(j),
      checks, checksBad, resultOverdue, resultOverdueDays: resultOverdue ? resultDue : 0, waitlistUpdates: (j.waitlistUpdates ?? []).length,
      attention: checksBad || resultOverdue,
    };
  }).sort((a, b) => String(a.deadlineAt ?? '9999').localeCompare(String(b.deadlineAt ?? '9999')));
}
export function tenderRows(site) {
  const today = site.today;
  return allTenders(site).map((x) => {
    const stage = tenderStage(site, x);
    const sinceOpen = x.openingAt && !x.award && !['failed', 'cancelled'].includes(stage) ? dayDiff(x.openingAt, today) : null;
    const awardOverdue = sinceOpen != null && sinceOpen > 30;
    return {
      id: x.id, title: x.title, status: x.status, stage, tenderNo: x.tenderNo ?? '', method: x.method ?? '', category: x.category ?? '', budgetNtd: x.budgetNtd ?? null,
      requestingUnit: x.requestingUnit, requestingName: site.unitById.get(x.requestingUnit)?.name ?? x.requestingUnit ?? '',
      announcedAt: x.announcedAt ?? null, deadlineAt: x.deadlineAt ?? null, openingAt: x.openingAt ?? null, awardAt: x.award?.date ?? null, winner: x.award?.winner ?? '',
      pccUrl: x.pccUrl ?? '', front: tenderPath(x), daysLeft: stage === 'open' ? dayDiff(today, x.deadlineAt) : null,
      sinceOpen, awardOverdue, attention: awardOverdue,
    };
  }).sort((a, b) => String(a.deadlineAt ?? '9999').localeCompare(String(b.deadlineAt ?? '9999')));
}
