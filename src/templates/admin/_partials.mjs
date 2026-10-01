// 後台共用片段（Agent E）。底線開頭＝不會被當成頁面模板自動登錄。
// 原則：治理狀態一律來自 item.gov / site.gov（建置時由引擎算），這裡只做呈現，不重算規則。
import { html, raw, jsonScript, esc, daysBetween } from '../../../scripts/lib/render.mjs';

export const DEFAULT_UNIT = 'unit.acute-infectious';

export const TYPE_LABEL = {
  disease: '疾病頁', faq: 'Q&A', news: '新聞稿', letter: '致醫界通函', clarification: '澄清', document: '文件', vaccine: '疫苗頁',
  dataset: '資料集', banner: '宣導 Banner', page: '一般頁面',
};
export const STATUS_LABEL = { draft: '草稿', review: '複核中', published: '已發布', archived: '已封存' };
export const CATEGORY_LABEL = {
  'open-dataset': '開放資料集', 'stats-system': '統計系統', 'structured-table': '結構化表格', 'document-library': '文件庫',
  'content-page': '內容頁', press: '新聞稿', media: '影音',
};
export const KIND_LABEL = {
  'based-on-revised': '依據正本已修訂', 'reverse-audit': '反向稽核命中', overdue: '逾期', 'translation-stale': '翻譯過期',
  'dataset-overdue': '資料集逾期', 'license-missing': '授權缺漏', 'superseded-still-linked': '失效版仍被連結', 'situation-overdue': '態勢層逾期',
};
export const KIND_ORDER = ['based-on-revised', 'reverse-audit', 'overdue', 'translation-stale', 'dataset-overdue', 'license-missing', 'superseded-still-linked', 'situation-overdue'];
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
    case 'clarification': return '/factcheck/';
    case 'dataset': return '/data/';
    default: return null;
  }
}

export function categoryOf(item) {
  if (item.type === 'dataset') return item.category ?? 'open-dataset';
  if (['news', 'letter', 'clarification'].includes(item.type)) return 'press';
  if (item.type === 'document') return 'document-library';
  return 'content-page';
}

/** 把 site.all 攤平成後台用列（可直接 JSON 嵌入頁面）。 */
export function catalogRows(site) {
  const licOk = new Set(site.config.licenses.allowed);
  return site.all.map((i) => {
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
    ...site.master.units.map((u) => html`<option value="${u.id}" ${u.id === selected ? raw('selected') : ''}>${u.name}</option>`),
  ];
}

export function dataScript(id, obj) {
  return raw(`<script type="application/json" id="${id}">${jsonScript(obj)}</script>`);
}

export function counts(site) {
  const rows = site.all;
  const review = rows.filter((i) => i.status === 'review').length;
  const due = rows.filter((i) => i.status === 'published' && !i.gov?.superseded && i.gov?.nextReviewAt && i.gov.daysToReview != null && i.gov.daysToReview <= 30).length;
  const todos = (site.gov?.todos ?? []).length;
  return { review, due, todos };
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
  return (site.gov?.todos ?? []).map((t, i) => ({
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
