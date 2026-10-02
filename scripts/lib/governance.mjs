// 治理引擎：人只填欄位，這裡算出所有狀態（ARCHITECTURE.md 第 3 節、規劃 7.4／7.5／7.7）。
// 不得在模板裡重算治理邏輯；模板只讀 item.gov 與 site.gov。
//
// 規則（寫死在引擎，不靠人記）：
//  R1 逾期：reviewedAt + reviewPeriodMonths < today ⇒ 退出白名單、狀況層黃色警示「最後審閱於…」、待辦。新聞稿（0 個月）不逾期。
//  R2 版本鏈：同 family 中 published 且 effectiveAt ≤ today 最新者為現行版；其餘舊版 superseded ⇒
//     noindex、.md 首行「本版已由…版取代」、退出白名單、redirects 對照、頁首紅色警示（保留存取）。
//  R3 basedOn：依據正本 family 有新版（effectiveAt > 本內容 publishedAt）且 reviewedAt < 新版 effectiveAt ⇒ stale：
//     自動加註、退出白名單、7 日待辦；新聞稿／通函發布早於正本生效日 ⇒ 永久加註（內文不改）且不作答案依據。
//  R4 反向稽核：auditRules（主檔或內容宣告）掃全站文字（含 i18n），命中 ⇒ 待辦＋退出白名單。
//  R5 翻譯：languages[lang].sourceHash（或 i18n[lang].sourceHash）≠ item.sourceHash ⇒ 譯文過期；一級內容只渲染 reviewed。
//  R6 資料集：lastUpdated 超過 updateFrequency 容許天數 ⇒ 待辦；license 非標準 ⇒ 待辦。
//  R7 AI 暫停：governance/ai-status.json paused ⇒ site.gov.pausedAI。
// 第二輪（ARCHITECTURE.md 第 11 節）：
//  R8 公告截止：news.deadlineAt < today ⇒ gov.closed、lifecycle closed「已截止」（不退白名單、不產生待辦）；7 日內 ⇒ gov.closingSoon。
//  R9 影音過時：media.producedAt 早於 basedOn 現行版 effectiveAt ⇒ 沿用 R3（加註、退出白名單），註記改「本影片依…製作」，
//     gov.mediaOutdated；待辦改為 media-outdated（high，更新說明欄或下架）。逐字稿 < 50 字 ⇒ media-no-transcript（medium）。
//  R10 專區到期：topic.endAt < today ⇒ gov.ended、lifecycle ended「已結束」（不退白名單；首頁列表由模板以 gov.ended 過濾）。
//  R11 外部連結健康：topic.links[]、service.forms[]／applyUrl、news.applyUrl、media.videoUrl、publication.pdfUrl、document.pdfUrl
//      → site.gov.externalLinks[]；status 由 scripts/fetch-data.mjs --check-links 寫回（陣列元素寫在元素上；單一欄位寫在
//      item.linkChecks[field]）。broken ⇒ link-broken 待辦（medium）；未檢查標 unchecked、不產生待辦。
//  R12 檢驗一致性：labtest.sendWithinHours > 主檔 notifyWithinHours ⇒ labtest-inconsistent（low）。
//  R13 通報時限表：site.gov.notifyTable 由 master/diseases.json＋labtests＋疾病頁 professional.caseDefinitionDoc 推導。
// annotations[]：{ kind, level, text, href（目標內容 id，沿用骨架語意）, targetId, path（目標前台路徑） }
//  另：白名單型別政策（allowedTypes 民眾＋專業、allowedTypesPro 只進專業）、失效版仍被引用、態勢層逾期。
import { createHash } from 'node:crypto';
import { addMonths, daysBetween } from './render.mjs';

// ───────────────────────── 常數與對照表 ─────────────────────────

/** 白名單不生效原因 → 人看得懂的中文 */
export const WHITELIST_REASON_LABELS = {
  'not-requested': '未申請進入 AI 白名單',
  'not-published': '尚未發布（草稿、審核中或已封存）',
  'type-not-allowed': '此內容型別不在白名單政策內',
  sensitivity: '敏感等級不允許（內部資料，或專業資料不得進民眾端）',
  'not-yet-effective': '本版尚未生效',
  superseded: '已由新版取代（失效版本）',
  overdue: '已超過審閱期限，待權責單位重新審閱',
  'based-on-revised': '所依據的正本已修訂，衍生內容尚未更新',
  'predates-basis': '發布日早於現行正本生效日，不作為答案依據（僅保留加註）',
  'reverse-audit': '反向稽核命中與現行正本矛盾的敘述',
};

export const LIFECYCLE_LABELS = {
  current: '現行版',
  superseded: '已失效',
  overdue: '逾期待審',
  'based-on-revised': '依據已修訂',
  draft: '草稿',
  archived: '封存',
  scheduled: '尚未生效',
  closed: '已截止',
  ended: '已結束',
};

export const TODO_KIND_LABELS = {
  'based-on-revised': '正本修訂連動',
  overdue: '審閱逾期',
  'translation-stale': '譯文過期',
  'license-missing': '授權非標準',
  'dataset-overdue': '資料集逾期未更新',
  'reverse-audit': '反向稽核命中',
  'superseded-still-linked': '仍連結失效版本',
  'situation-overdue': '態勢層逾期未更新',
  'media-outdated': '影音依據已修訂',
  'media-no-transcript': '影音缺逐字稿',
  'link-broken': '外部連結失效',
  'labtest-inconsistent': '檢驗與通報時限不一致',
};

export const SEVERITY_RANK = { high: 0, medium: 1, low: 2 };

/** 資料集更新頻率容許天數（含緩衝） */
export const DATASET_FREQ_DAYS = { daily: 2, weekly: 10, monthly: 40, quarterly: 100, yearly: 380, irregular: Infinity };
/** 正本修訂 → 民眾端衍生內容完成期限（7.7） */
export const BASIS_REVISION_DAYS = 7;
/** 中文更新 → 譯文複核期限 */
export const TRANSLATION_DUE_DAYS = 14;
/** 審閱到期提醒（30 日內黃） */
export const DUE_SOON_DAYS = 30;
/** 對外內容頁（KPI「有更新日與權責」分母） */
export const PUBLIC_PAGE_TYPES = new Set(['disease', 'vaccine', 'faq', 'clarification', 'news', 'letter', 'document', 'dataset', 'page', 'media', 'topic', 'service', 'publication', 'labtest', 'research']);
const NEWS_TYPES = new Set(['news', 'letter']);
/** 機關公告（/notices/）：news 中的人才招募、採購公告、其他訊息 */
export const NOTICE_TYPES = new Set(['recruit', 'procurement', 'other']);
/** 公告截止前提醒天數 */
export const CLOSING_SOON_DAYS = 7;
/** 已截止公告超過此天數仍 published ⇒ KPI「已截止未封存」 */
export const CLOSED_ARCHIVE_DAYS = 90;
/** 影音逐字稿最少字數 */
export const MIN_TRANSCRIPT_CHARS = 50;
/** 外部連結失效 → 修復期限 */
export const LINK_FIX_DAYS = 7;
/** 法定傳染病類別中文 */
export const LEGAL_CATEGORY_LABELS = { 1: '第一類', 2: '第二類', 3: '第三類', 4: '第四類', 5: '第五類' };
/** 通報時限（小時）→ 中文 */
export function notifyLabel(hours) {
  if (hours == null) return null;
  if (hours === 24) return '24 小時內';
  if (hours === 168) return '一週內';
  if (hours === 720) return '一個月內';
  if (hours % 24 === 0 && hours > 24) return `${hours / 24} 日內`;
  return `${hours} 小時內`;
}
/** 外部連結欄位定義：type → [{ field, list? }]（legacyUrls 不檢） */
export const EXTERNAL_LINK_FIELDS = {
  topic: [{ field: 'links', list: true }],
  service: [{ field: 'forms', list: true }, { field: 'applyUrl' }],
  news: [{ field: 'applyUrl' }],
  letter: [{ field: 'applyUrl' }],
  media: [{ field: 'videoUrl' }],
  publication: [{ field: 'pdfUrl' }],
  document: [{ field: 'pdfUrl' }],
};
/** basedOnVersionLabel 可能寫成畫面上的整句「依 114.04.16 建議製作」→ 取中間版本字樣 */
export function versionLabelOf(media) {
  const raw = String(media.basedOnVersionLabel ?? '').trim().replace(/^依\s*/, '').replace(/\s*製作$/, '').trim();
  return raw || media.producedAt;
}
const isHttp = (u) => typeof u === 'string' && /^https?:\/\//i.test(u);

/** 一筆內容的外部連結：[{ url, field, label, lastCheckedAt, status }]（status 缺 ⇒ unchecked） */
export function externalLinksOf(item) {
  const out = [];
  for (const { field, list } of EXTERNAL_LINK_FIELDS[item.type] ?? []) {
    if (list) {
      (item[field] ?? []).forEach((l, i) => {
        if (!l || !isHttp(l.href)) return; // 站內連結不檢
        out.push({ url: l.href, field: `${field}[${i}]`, label: l.label ?? null, lastCheckedAt: l.lastCheckedAt ?? null, status: l.status ?? 'unchecked' });
      });
    } else if (isHttp(item[field])) {
      const chk = item.linkChecks?.[field] ?? {};
      out.push({ url: item[field], field, label: null, lastCheckedAt: chk.lastCheckedAt ?? null, status: chk.status ?? 'unchecked' });
    }
  }
  return out;
}

// ───────────────────────── 路徑 helper（與 4.1 路由一致） ─────────────────────────

/** 頁面 slug 與實際路由不同者（與 src/templates/public/_partials.mjs PAGE_PATHS 一致） */
const PAGE_SLUG_PATHS = { 'ai-policy': '/policy/ai/', privacy: '/policy/privacy/', 'open-data': '/policy/open-data/' };

/** id 去型別前綴：news.2026-09-22-x → 2026-09-22-x */
export function slugOf(item) { return String(item.id).replace(/^[a-z]+\./, ''); }

/** 前台頁路徑（不含 basePath 與語言前綴） */
export function pathOf(item) {
  switch (item?.type) {
    case 'disease': return `/diseases/${item.slug ?? slugOf(item)}/`;
    case 'vaccine': return `/vaccines/${item.slug ?? slugOf(item)}/`;
    case 'faq': return `/faq/${slugOf(item)}/`;
    case 'news': case 'letter': return `/news/${slugOf(item)}/`;
    case 'document': return `/documents/${slugOf(item)}/`;
    case 'clarification': return `/factcheck/#${item.id}`;
    case 'dataset': return `/data/#${item.id}`;
    case 'page': { const sl = String(item.slug ?? slugOf(item)).replace(/^\/+|\/+$/g, ''); return PAGE_SLUG_PATHS[sl] ?? `/${sl}/`; }
    case 'media': return `/media/${slugOf(item)}/`;
    case 'topic': return `/topics/${item.slug ?? slugOf(item)}/`;
    case 'service': return `/apply/${item.slug ?? slugOf(item)}/`;
    case 'publication': return `/publications/${slugOf(item)}/`;
    case 'labtest': return `/lab/${slugOf(item)}/`;
    case 'research': return `/research/${slugOf(item)}/`;
    default: return '/';
  }
}

/** 同頁 .md 機讀版路徑（只有獨立內容頁才有） */
export function mdPathOf(item) {
  const p = pathOf(item);
  if (p.includes('#') || p === '/') return null;
  return `${p.replace(/\/$/, '')}.md`;
}

export function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
}

const sha = (s, n = 8) => createHash('sha1').update(String(s)).digest('hex').slice(0, n);
const median = (arr) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b); const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : null);

/** 某內容在某語言是否可渲染（與 scripts/lib/pages.mjs 的 langAvailable 一致） */
export function langRenderable(site, item, lang) {
  if (lang === site.config.defaultLang || lang === 'zh-TW') return true;
  const st = item.languages?.[lang]?.status;
  if (!st || st === 'none' || st === 'pending') return false;
  if (site.config.tier1Types.includes(item.type)) return st === 'reviewed';
  return true;
}

// ───────────────────────── 主流程 ─────────────────────────

export function applyGovernance(site) {
  const today = site.today;
  const cfg = site.config;
  const policy = site.governance?.whitelist ?? {};
  const allowedPublic = new Set(policy.allowedTypes ?? []);
  const allowedPro = new Set(policy.allowedTypesPro ?? []);
  const unitName = (id) => site.unitById.get(id)?.name ?? id;
  const todos = [];
  const warnings = [];
  const addTodo = (t) => {
    const item = t.item;
    delete t.item;
    const todo = {
      id: t.id, kind: t.kind, kindLabel: TODO_KIND_LABELS[t.kind] ?? t.kind,
      itemId: item?.id ?? t.itemId, itemType: item?.type ?? t.itemType ?? null, itemTitle: item?.title ?? t.itemTitle ?? '',
      owner: t.owner ?? item?.owner, ownerName: unitName(t.owner ?? item?.owner),
      dueAt: t.dueAt, overdue: !!t.dueAt && t.dueAt < today,
      text: t.text, href: t.href ?? (item ? pathOf(item) : '/'), severity: t.severity ?? 'medium',
      ...Object.fromEntries(Object.entries(t).filter(([k]) => !['id', 'kind', 'owner', 'dueAt', 'text', 'href', 'severity'].includes(k))),
    };
    todos.push(todo);
    return todo;
  };

  // ── R2 版本鏈 ──
  const docsByFamily = new Map();
  for (const d of site.collections.documents ?? []) {
    const fam = d.family ?? d.id;
    if (!docsByFamily.has(fam)) docsByFamily.set(fam, []);
    docsByFamily.get(fam).push(d);
  }
  const byEff = (a, b) => (a.effectiveAt ?? '').localeCompare(b.effectiveAt ?? '') || String(a.version ?? '').localeCompare(String(b.version ?? '')) || a.id.localeCompare(b.id);
  const familyInfo = new Map();
  for (const [family, versions] of docsByFamily) {
    versions.sort(byEff);
    const effective = versions.filter((v) => v.status === 'published' && (v.effectiveAt ?? '') <= today);
    const current = effective.at(-1) ?? null;
    for (const v of versions) {
      v.isCurrent = v === current;
      const inChain = v.status === 'published' || v.status === 'archived';
      const next = inChain ? effective.find((p) => p !== v && byEff(p, v) > 0) : null;
      v.supersededBy = !v.isCurrent && next ? next.id : null;
    }
    familyInfo.set(family, { family, current, versions, title: current?.title ?? versions.at(-1)?.title });
  }
  const currentOfFamily = (family) => familyInfo.get(family)?.current ?? null;
  const resolveBasis = (ref) => {
    const item = site.byId.get(ref);
    if (item?.type === 'document') return { doc: currentOfFamily(item.family ?? item.id), family: item.family ?? item.id, item };
    if (familyInfo.has(ref)) return { doc: currentOfFamily(ref), family: ref, item: null };
    return { doc: null, family: null, item: item ?? null };
  };

  // ── 每筆內容 ──
  let whitelistCount = 0, totalPublished = 0;
  for (const item of site.all) {
    const isDoc = item.type === 'document';
    const published = item.status === 'published';
    const fam = isDoc ? familyInfo.get(item.family ?? item.id) : null;
    const current = fam?.current ?? null;
    const gov = {
      ownerName: unitName(item.owner),
      reviewPeriodMonths: item.reviewPeriodMonths,
      nextReviewAt: null, daysToReview: null, overdue: false, dueSoon: false,
      isCurrent: isDoc ? !!item.isCurrent : true,
      superseded: false, supersededBy: null, currentId: isDoc ? current?.id ?? null : item.id, scheduled: false,
      family: isDoc ? item.family ?? item.id : null,
      basisRevisions: [], stale: [], predatesBasis: false,
      annotations: [],
      whitelist: { requested: !!item.aiWhitelist?.requested, effective: false, reasons: [], reasonLabels: [], tier: null, public: false, pro: false },
      translationStale: {}, languageNotes: {}, renderableLangs: [],
      reverseAuditHits: [],
      noindex: false, mdNotice: null,
      lifecycle: 'current', lifecycleLabel: LIFECYCLE_LABELS.current,
    };
    item.gov = gov;

    // R8 公告截止（news／letter 有 deadlineAt）
    if (NEWS_TYPES.has(item.type)) {
      gov.notice = NOTICE_TYPES.has(item.newsType);
      if (item.deadlineAt) {
        gov.deadlineAt = item.deadlineAt;
        gov.daysToDeadline = daysBetween(today, item.deadlineAt);
        gov.closed = item.deadlineAt < today;
        gov.closingSoon = !gov.closed && gov.daysToDeadline <= CLOSING_SOON_DAYS;
        gov.closedDays = gov.closed ? daysBetween(item.deadlineAt, today) : 0;
        if (gov.closed && published) gov.annotations.push({ kind: 'closed', level: 'info', text: `本公告已於 ${item.deadlineAt} 截止，僅供查閱。`, href: null, path: null, deadlineAt: item.deadlineAt });
      } else { gov.closed = false; gov.closingSoon = false; gov.deadlineAt = null; gov.daysToDeadline = null; }
    }
    // R10 專區期間
    if (item.type === 'topic') {
      gov.upcoming = !!item.startAt && item.startAt > today;
      gov.ended = !!item.endAt && item.endAt < today;
      if (gov.ended && published) gov.annotations.push({ kind: 'ended', level: 'info', text: `本專區已於 ${item.endAt} 結束，保留供查閱。`, href: null, path: null, endAt: item.endAt });
    }
    // 宣導 Banner 檔期
    if (item.type === 'banner') {
      gov.campaignStatus = item.startAt && item.startAt > today ? 'upcoming' : item.endAt && item.endAt < today ? 'ended' : 'active';
    }
    // R9 影音：逐字稿
    if (item.type === 'media') {
      gov.transcriptChars = (item.transcriptMarkdown ?? '').trim().length;
      gov.hasTranscript = gov.transcriptChars >= MIN_TRANSCRIPT_CHARS;
      gov.mediaOutdated = false;
    }

    // R1 審閱週期
    if (item.reviewPeriodMonths > 0 && item.reviewedAt) {
      gov.nextReviewAt = addMonths(item.reviewedAt, item.reviewPeriodMonths);
      gov.daysToReview = daysBetween(today, gov.nextReviewAt);
    }

    // R2 版本鏈（文件）
    if (isDoc) {
      const inChain = item.status === 'published' || item.status === 'archived';
      gov.scheduled = item.status === 'published' && (item.effectiveAt ?? '') > today;
      gov.superseded = inChain && !item.isCurrent && !gov.scheduled && !!current && byEff(item, current) < 0;
      gov.supersededBy = gov.superseded ? item.supersededBy : null;
      if (gov.superseded) {
        const next = site.byId.get(item.supersededBy) ?? current;
        gov.noindex = true;
        gov.mdNotice = `本版已由 ${current.version ?? ''} 版取代（${current.effectiveAt} 生效），現行版：${pathOf(current)}`;
        gov.annotations.push({ kind: 'superseded', level: 'danger', text: `此為 ${item.version ?? ''} 版，已由 ${next.version ?? ''} 版取代（${next.effectiveAt} 生效）；本頁保留供查閱，現行版請見「${current.title}」。`, href: current.id, targetId: current.id, path: pathOf(current) });
      } else if (gov.scheduled) {
        gov.annotations.push({ kind: 'scheduled', level: 'info', text: `本版將於 ${item.effectiveAt} 生效${current ? `；生效前請以「${current.title}」為準` : ''}。`, href: current?.id ?? null, targetId: current?.id ?? null, path: current ? pathOf(current) : null });
      }
    }

    // R1 逾期（只對已發布且非失效內容；新聞稿 nextReviewAt=null 不逾期）
    const live = published && !gov.superseded && !gov.scheduled;
    if (live && gov.nextReviewAt) {
      gov.overdue = gov.nextReviewAt < today;
      gov.dueSoon = !gov.overdue && gov.daysToReview <= DUE_SOON_DAYS;
    }
    if (gov.overdue) {
      gov.annotations.push({ kind: 'overdue', level: 'warning', text: `本頁最後審閱於 ${item.reviewedAt}，已超過審閱期限（${gov.nextReviewAt}），內容可能過時，請以權責單位最新公告為準。`, href: null, path: null, reviewedAt: item.reviewedAt, nextReviewAt: gov.nextReviewAt });
    }

    // R3 basedOn 連動
    const isNews = NEWS_TYPES.has(item.type);
    const isMedia = item.type === 'media';
    // 影音以製作日比對（畫面內容在製作時就固定了）；其他以發布日比對
    const refDate = isMedia ? item.producedAt ?? item.publishedAt : item.publishedAt;
    for (const ref of item.basedOn ?? []) {
      const { doc } = resolveBasis(ref);
      if (!doc || doc === item || doc.family === item.family) continue;
      if (!(doc.effectiveAt > refDate)) continue;
      const resolved = item.reviewedAt >= doc.effectiveAt;
      const rev = { basedOn: ref, revisedAt: doc.effectiveAt, currentId: doc.id, currentTitle: doc.title, currentVersion: doc.version ?? null, currentHref: pathOf(doc), dueAt: addDays(doc.effectiveAt, BASIS_REVISION_DAYS), resolved, resolvedAt: resolved ? item.reviewedAt : null };
      gov.basisRevisions.push(rev);
      if (!resolved) gov.stale.push(rev);
      // 新聞稿與影音：內文／畫面不改，永久加註且不作答案依據
      if (isNews || isMedia) gov.predatesBasis = true;
    }
    // 去重（同一正本被多個 ref 指到）
    const uniq = (arr) => arr.filter((x, i, a) => a.findIndex((y) => y.currentId === x.currentId) === i);
    gov.basisRevisions = uniq(gov.basisRevisions); gov.stale = uniq(gov.stale);
    if (isMedia) gov.mediaOutdated = gov.basisRevisions.length > 0;
    const noteRevs = isNews || isMedia ? gov.basisRevisions : gov.stale;
    for (const s of noteRevs) {
      gov.annotations.push({
        kind: 'based-on-revised', level: 'warning',
        text: isMedia
          ? `本影片依 ${versionLabelOf(item)} 製作，所依據的「${s.currentTitle}」已於 ${s.revisedAt} 修訂，請以現行版為準`
          : isNews
          ? `本${item.newsType === 'letter' || item.type === 'letter' ? '通函' : '新聞稿'}發布於 ${item.publishedAt}，相關建議已於 ${s.revisedAt} 修訂，現行版請見「${s.currentTitle}」。`
          : `本內容發布於 ${item.publishedAt}，所依據的「${s.currentTitle}」已於 ${s.revisedAt} 修訂；權責單位更新前，請以現行版為準。`,
        href: s.currentId, targetId: s.currentId, path: s.currentHref, revisedAt: s.revisedAt, currentTitle: s.currentTitle,
      });
    }
    if (item.status === 'archived' && !gov.superseded) gov.annotations.push({ kind: 'archived', level: 'info', text: '本內容已封存，僅供查閱。', href: null, path: null });

    // R5 翻譯與可渲染語言
    for (const L of cfg.langs) {
      const lang = L.code;
      const renderable = langRenderable(site, item, lang);
      if (renderable) gov.renderableLangs.push(lang);
      if (lang === 'zh-TW') continue;
      const meta = item.languages?.[lang];
      if (!meta || meta.status === 'none' || meta.status === 'pending') {
        if (meta) gov.languageNotes[lang] = { status: meta.status, stale: false, renderable: false, note: '尚未提供此語言版本' };
        continue;
      }
      const hash = meta.sourceHash ?? item.i18n?.[lang]?.sourceHash ?? null;
      const stale = !!hash && hash !== item.sourceHash; // reviewed 但無 sourceHash ⇒ 視為最新（舊資料相容）
      gov.translationStale[lang] = stale;
      gov.languageNotes[lang] = {
        status: meta.status, stale, renderable,
        note: stale ? '中文已更新，譯文待複核'
          : meta.status === 'machine' ? (renderable ? '機器翻譯，尚未經人工複核' : '一級內容僅提供人工複核譯文，本語言改顯示英文或中文')
          : null,
      };
    }

    // 白名單（反向稽核後再定案）
    gov.whitelist.tier = allowedPublic.has(item.type) ? 'public' : allowedPro.has(item.type) ? 'pro' : null;
    gov.noindex ||= item.status === 'archived' || item.status === 'draft' || item.status === 'review';
  }

  // ── R4 反向稽核 ──
  const rules = [];
  const makeRule = (r, from, fromFamily, src) => {
    let re;
    try { re = new RegExp(r.pattern); } catch (e) { warnings.push(`auditRule ${from} pattern 無效：${r.pattern}（${e.message}）`); return; }
    rules.push({ id: `audit.${sha(`${from}|${r.pattern}`)}`, from, fromFamily, scope: r.scope ?? [], pattern: r.pattern, message: r.message, since: r.since ?? src?.effectiveAt ?? null, re });
  };
  for (const d of site.master.diseases ?? []) for (const r of d.auditRules ?? []) makeRule(r, d.id, null, null);
  for (const item of site.all) for (const r of item.auditRules ?? []) makeRule(r, item.id, item.family ?? null, item);
  // scope 索引：id / family / disease / vaccine → items
  const scopeIndex = new Map();
  const addIdx = (k, item) => { if (!k) return; if (!scopeIndex.has(k)) scopeIndex.set(k, new Set()); scopeIndex.get(k).add(item); };
  for (const item of site.all) {
    addIdx(item.id, item); addIdx(item.family, item);
    for (const d of item.diseases ?? []) addIdx(d, item);
    for (const v of item.vaccines ?? []) addIdx(v, item);
  }
  // 規則無 since ⇒ 以 scope 內現行文件最新生效日推估（MMR：2025-04-16）
  const currentDocs = (site.collections.documents ?? []).filter((d) => d.isCurrent);
  for (const rule of rules) {
    if (rule.since) continue;
    const scope = new Set(rule.scope);
    const dates = currentDocs.filter((d) => scope.has(d.family) || scope.has(d.id) || (d.diseases ?? []).some((x) => scope.has(x)) || (d.vaccines ?? []).some((x) => scope.has(x))).map((d) => d.effectiveAt);
    rule.since = dates.sort().at(-1) ?? null;
  }
  const textCache = new Map();
  const textFor = (item) => { if (!textCache.has(item)) textCache.set(item, textOf(item)); return textCache.get(item); };
  for (const rule of rules) {
    let candidates;
    if (rule.scope.length) { candidates = new Set(); for (const s of rule.scope) for (const it of scopeIndex.get(s) ?? []) candidates.add(it); } else candidates = site.all;
    for (const item of candidates) {
      if (item.id === rule.from || (item.family && (item.family === rule.from || item.family === rule.fromFamily))) continue;
      if (item.gov.superseded || item.status === 'archived') continue; // 失效版本本來就該有舊字
      const text = textFor(item);
      const m = rule.re.exec(text);
      if (!m) continue;
      const hit = { ruleId: rule.id, from: rule.from, term: m[0], rule: rule.message, snippet: text.slice(Math.max(0, m.index - 20), m.index + m[0].length + 20).replace(/\s+/g, ' ') };
      item.gov.reverseAuditHits.push(hit);
      // 已由 R3 涵蓋（衍生內容待修訂、或新聞稿已加註）就不重複開待辦
      const covered = item.gov.stale.length > 0 || item.gov.predatesBasis;
      hit.coveredBy = covered ? (item.gov.stale.length ? 'based-on-revised' : 'annotation') : null;
      if (!covered && item.status === 'published') {
        addTodo({ id: `reverse-audit:${item.id}:${rule.id}`, kind: 'reverse-audit', item, ruleId: rule.id,
          dueAt: rule.since ? addDays(rule.since, BASIS_REVISION_DAYS) : addDays(today, BASIS_REVISION_DAYS),
          severity: (item.audience ?? []).includes('public') ? 'high' : 'medium',
          text: `「${item.title}」出現「${m[0]}」：${rule.message}` });
      }
    }
  }

  // ── 白名單定案、註記待辦 ──
  for (const item of site.all) {
    const gov = item.gov;
    const r = gov.whitelist.reasons;
    if (!gov.whitelist.requested) r.push('not-requested');
    if (item.status !== 'published') r.push('not-published');
    if (!gov.whitelist.tier) r.push('type-not-allowed');
    if (item.sensitivity === 'internal' || (item.sensitivity === 'professional' && gov.whitelist.tier !== 'pro')) r.push('sensitivity');
    if (gov.scheduled) r.push('not-yet-effective');
    if (gov.superseded) r.push('superseded');
    if (gov.overdue) r.push('overdue');
    if (gov.stale.length) r.push('based-on-revised');
    if (gov.predatesBasis) r.push('predates-basis');
    if (gov.reverseAuditHits.length) r.push('reverse-audit');
    gov.whitelist.effective = r.length === 0;
    gov.whitelist.reasonLabels = r.map((x) => WHITELIST_REASON_LABELS[x] ?? x);
    gov.whitelist.public = gov.whitelist.effective && gov.whitelist.tier === 'public' && (item.audience ?? []).includes('public');
    gov.whitelist.pro = gov.whitelist.effective;
    if (item.status === 'published') totalPublished++;
    if (gov.whitelist.effective) whitelistCount++;

    // 生命週期標籤
    gov.lifecycle = item.status === 'draft' || item.status === 'review' ? 'draft'
      : gov.superseded ? 'superseded'
      : item.status === 'archived' ? 'archived'
      : gov.scheduled ? 'scheduled'
      : gov.closed ? 'closed'
      : gov.ended ? 'ended'
      : gov.overdue ? 'overdue'
      : gov.stale.length || gov.predatesBasis ? 'based-on-revised'
      : 'current';
    gov.lifecycleLabel = LIFECYCLE_LABELS[gov.lifecycle];

    // 待辦：逾期
    if (gov.overdue) {
      addTodo({ id: `overdue:${item.id}`, kind: 'overdue', item, dueAt: gov.nextReviewAt,
        severity: gov.whitelist.requested && (item.audience ?? []).includes('public') ? 'high' : 'medium',
        text: `「${item.title}」最後審閱於 ${item.reviewedAt}，已逾審閱期限（${gov.nextReviewAt}），已退出 AI 白名單` });
    }
    // 待辦：正本修訂連動
    for (const s of gov.stale) {
      if (item.type === 'media') {
        addTodo({ id: `media-outdated:${item.id}:${s.currentId}`, kind: 'media-outdated', item, dueAt: s.dueAt, severity: 'high', basisId: s.currentId, revisedAt: s.revisedAt,
          text: `影音「${item.title}」依 ${versionLabelOf(item)} 製作，所依據的「${s.currentTitle}」已於 ${s.revisedAt} 修訂：前台已自動加註並退出 AI 白名單，請於 ${BASIS_REVISION_DAYS} 日內更新說明欄或下架（重製後更新 producedAt）` });
        continue;
      }
      addTodo({ id: `based-on-revised:${item.id}:${s.currentId}`, kind: 'based-on-revised', item, dueAt: s.dueAt, severity: 'high', basisId: s.currentId, revisedAt: s.revisedAt,
        text: NEWS_TYPES.has(item.type)
          ? `「${item.title}」依據的「${s.currentTitle}」已於 ${s.revisedAt} 修訂：前台已自動加註（內文不改），請於 ${BASIS_REVISION_DAYS} 日內確認加註並更新審閱日，必要時發布更新稿`
          : `「${item.title}」依據的「${s.currentTitle}」已於 ${s.revisedAt} 修訂，請於 ${BASIS_REVISION_DAYS} 日內改寫並更新審閱日；完成前暫停進入 AI 白名單` });
    }
    // 待辦：譯文過期
    for (const [lang, stale] of Object.entries(gov.translationStale)) {
      if (!stale || item.status !== 'published') continue;
      const label = cfg.langs.find((l) => l.code === lang)?.label ?? lang;
      addTodo({ id: `translation-stale:${item.id}:${lang}`, kind: 'translation-stale', item, lang, dueAt: addDays(item.reviewedAt, TRANSLATION_DUE_DAYS),
        severity: cfg.tier1Types.includes(item.type) ? 'medium' : 'low', text: `「${item.title}」中文已更新，${label}（${lang}）譯文待複核` });
    }
    // 待辦：影音缺逐字稿
    if (item.type === 'media' && item.status === 'published' && !gov.hasTranscript) {
      addTodo({ id: `media-no-transcript:${item.id}`, kind: 'media-no-transcript', item, dueAt: addDays(item.publishedAt > today ? item.publishedAt : item.reviewedAt, BASIS_REVISION_DAYS), severity: 'medium',
        text: `影音「${item.title}」逐字稿不足 ${MIN_TRANSCRIPT_CHARS} 字（目前 ${gov.transcriptChars} 字）：逐字稿是 AI 唯一可引用的影片內容，也是無障礙必要條件，請補齊` });
    }
  }

  // ── R11 外部連結健康 ──
  const externalLinks = [];
  for (const item of site.all) {
    if (item.status !== 'published' && item.status !== 'archived') continue;
    const links = externalLinksOf(item);
    item.gov.linkHealth = { total: links.length, ok: 0, broken: 0, unchecked: 0 };
    for (const l of links) {
      const status = ['ok', 'broken'].includes(l.status) ? l.status : 'unchecked';
      item.gov.linkHealth[status]++;
      externalLinks.push({ url: l.url, itemId: item.id, itemType: item.type, itemTitle: item.title, owner: item.owner, ownerName: unitName(item.owner), field: l.field, label: l.label, lastCheckedAt: l.lastCheckedAt, status, path: pathOf(item) });
      if (status === 'broken' && item.status === 'published' && !item.gov.superseded) {
        addTodo({ id: `link-broken:${item.id}:${l.field}`, kind: 'link-broken', item, url: l.url, field: l.field, dueAt: addDays(l.lastCheckedAt ?? today, LINK_FIX_DAYS), severity: 'medium',
          text: `「${item.title}」的外部連結 ${l.field}${l.label ? `「${l.label}」` : ''}（${l.url}）於 ${l.lastCheckedAt ?? '最近一次檢查'} 檢查失敗，請更新網址或移除` });
      }
    }
  }

  // ── R12 檢驗一致性 ──
  const labtestsByDisease = new Map();
  for (const lt of site.collections.labtests ?? []) {
    const master = site.diseaseMasterById.get(lt.disease);
    const page = site.byId.get(lt.disease);
    const notify = master?.notifyWithinHours ?? null;
    const send = lt.sendWithinHours ?? null;
    lt.gov.labtestCheck = {
      disease: lt.disease, diseaseName: master?.name ?? lt.disease, notifyWithinHours: notify, sendWithinHours: send,
      consistent: !(send != null && notify != null && send > notify),
      diseasePage: page?.type === 'disease' ? page.id : null, diseaseSpecimen: !!page?.professional?.specimen,
    };
    if (lt.status === 'published' && !lt.gov.superseded) {
      if (!labtestsByDisease.has(lt.disease)) labtestsByDisease.set(lt.disease, []);
      labtestsByDisease.get(lt.disease).push(lt);
      if (!lt.gov.labtestCheck.consistent) {
        addTodo({ id: `labtest-inconsistent:${lt.id}`, kind: 'labtest-inconsistent', item: lt, dueAt: addDays(lt.reviewedAt, 30), severity: 'low',
          text: `檢驗項目「${lt.title}」送驗時限 ${send} 小時，長於「${master?.name ?? lt.disease}」通報時限 ${notify} 小時（${notifyLabel(notify)}），請確認是否一致` });
      }
    }
  }

  // ── R13 通報時限表 ──
  const notifyTable = buildNotifyTable(site, labtestsByDisease, currentOfFamily);

  // ── 失效版本仍被引用 ──
  const supersededDocs = (site.collections.documents ?? []).filter((d) => d.gov.superseded);
  if (supersededDocs.length) {
    const tokens = [];
    for (const d of supersededDocs) {
      const cur = currentOfFamily(d.family ?? d.id);
      const curTokens = new Set([cur?.pdfUrl, ...(cur?.legacyUrls ?? [])].filter(Boolean));
      for (const tok of [d.id, pathOf(d), d.pdfUrl, ...(d.legacyUrls ?? [])]) if (tok && !curTokens.has(tok)) tokens.push({ tok, doc: d, cur });
    }
    const skip = new Set(['gov', '__file', 'sourceHash', 'supersedes', 'supersededBy']);
    for (const item of site.all) {
      if (item.status !== 'published' || item.gov.superseded) continue;
      const fam = item.family ?? null;
      const hay = JSON.stringify(item, (k, v) => (skip.has(k) ? undefined : v));
      const seen = new Set();
      for (const { tok, doc, cur } of tokens) {
        if (fam && fam === (doc.family ?? doc.id)) continue;
        if (seen.has(doc.id) || !hay.includes(tok)) continue;
        seen.add(doc.id);
        addTodo({ id: `superseded-still-linked:${item.id}:${doc.id}`, kind: 'superseded-still-linked', item, basisId: doc.id,
          dueAt: addDays(cur?.effectiveAt ?? today, BASIS_REVISION_DAYS), severity: 'medium',
          text: `「${item.title}」仍連結失效版本「${doc.title}」，請改連現行版「${cur?.title ?? ''}」` });
      }
    }
  }

  // ── R6 資料集時效與授權 ──
  for (const ds of site.collections.datasets ?? []) {
    const limit = DATASET_FREQ_DAYS[ds.updateFrequency] ?? Infinity;
    ds.gov.datasetLagDays = ds.lastUpdated ? daysBetween(ds.lastUpdated, today) : null;
    ds.gov.datasetDueAt = ds.lastUpdated && limit !== Infinity ? addDays(ds.lastUpdated, limit) : null;
    ds.gov.datasetOverdue = ds.gov.datasetLagDays != null && limit !== Infinity ? ds.gov.datasetLagDays > limit : false;
    ds.gov.licenseStandard = cfg.licenses.allowed.includes(ds.license);
    if (ds.status !== 'published') continue;
    if (ds.gov.datasetOverdue) addTodo({ id: `dataset-overdue:${ds.id}`, kind: 'dataset-overdue', item: ds, dueAt: ds.gov.datasetDueAt, severity: 'medium',
      text: `資料集「${ds.title}」更新頻率 ${ds.updateFrequency}，最後更新 ${ds.lastUpdated}（已 ${ds.gov.datasetLagDays} 日），逾期未更新` });
    if (!ds.gov.licenseStandard) addTodo({ id: `license-missing:${ds.id}`, kind: 'license-missing', item: ds, dueAt: ds.reviewedAt, severity: 'medium',
      text: `資料集「${ds.title}」授權「${ds.license ?? '未標示'}」非標準授權（${cfg.licenses.allowed.join('、')}）${ds.licenseNote ? `；說明：${ds.licenseNote}` : ''}` });
  }

  // ── 態勢層 ──
  const sit = site.situation ?? {};
  const situationGov = {
    publishedAt: sit.publishedAt ?? null, dataDate: sit.dataDate ?? null, publisher: sit.publisher ?? null, publisherName: unitName(sit.publisher),
    nextReviewAt: sit.nextReviewAt ?? null,
    lagDays: sit.dataDate ? daysBetween(sit.dataDate, today) : null,
    overdue: !!sit.nextReviewAt && sit.nextReviewAt < today,
  };
  if (situationGov.overdue) addTodo({ id: `situation-overdue:${sit.publishedAt}`, kind: 'situation-overdue', itemId: 'situation.current', itemType: 'situation', itemTitle: '疫情態勢層', owner: sit.publisher,
    dueAt: sit.nextReviewAt, href: '/situation/', severity: 'high', text: `疫情態勢層（${sit.publishedAt} 發布、資料日 ${sit.dataDate}）已過下次審閱日 ${sit.nextReviewAt}，請疫情中心重新發布或確認` });

  todos.sort((a, b) => (b.overdue - a.overdue) || (a.dueAt ?? '').localeCompare(b.dueAt ?? '') || SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.id.localeCompare(b.id));
  const ids = new Set();
  for (const t of todos) { if (ids.has(t.id)) warnings.push(`待辦 id 重複：${t.id}`); ids.add(t.id); }

  // ── R7 AI 暫停 ──
  const aiStatus = site.governance?.aiStatus ?? {};

  // ── 版本鏈摘要（API／專業專區） ──
  const families = [...familyInfo.values()].map((f) => ({
    family: f.family, title: f.current?.title ?? f.title, current: f.current?.id ?? null, currentVersion: f.current?.version ?? null, currentEffectiveAt: f.current?.effectiveAt ?? null, currentHref: f.current ? pathOf(f.current) : null,
    versions: f.versions.map((v) => ({ id: v.id, version: v.version ?? null, effectiveAt: v.effectiveAt ?? null, status: v.status, isCurrent: !!v.isCurrent, superseded: !!v.gov.superseded, supersedes: v.supersedes ?? null, supersededBy: v.supersededBy ?? null, href: pathOf(v), lifecycle: v.gov.lifecycle })),
  }));

  site.gov = {
    today,
    pausedAI: !!aiStatus.paused,
    aiStatus: { paused: !!aiStatus.paused, reason: aiStatus.reason ?? '', updatedAt: aiStatus.updatedAt ?? null, updatedBy: aiStatus.updatedBy ?? null, mode: aiStatus.mode ?? cfg.ai?.defaultMode ?? 'extractive', fallback: aiStatus.fallback ?? null },
    whitelistCount, totalPublished,
    todos,
    situation: situationGov,
    families,
    docsByFamily,
    auditRules: rules.map(({ re, ...r }) => r),
    warnings,
    reasonLabels: WHITELIST_REASON_LABELS,
    lifecycleLabels: LIFECYCLE_LABELS,
    todoKindLabels: TODO_KIND_LABELS,
    externalLinks,
    linkHealth: summarizeLinks(externalLinks),
    notifyTable,
  };
  site.gov.byOwner = computeByOwner(site);
  site.gov.summary = computeSummary(site);
  // KPI 依賴 site.searchIndex 與 site.evalReport（建置後段才有）→ 每次讀取時計算
  Object.defineProperty(site.gov, 'kpi', { enumerable: true, configurable: true, get: () => computeKpi(site) });
  Object.defineProperty(site.gov, 'kpiByKey', { enumerable: false, configurable: true, get: () => Object.fromEntries(computeKpi(site).map((k) => [k.key, k])) });
  return site.gov;
}

/** 反向稽核掃描的全文（含 i18n） */
export function textOf(item) {
  const parts = [item.title, item.summary, item.question, item.answerMarkdown, item.bodyMarkdown, item.machineReadableMarkdown, item.clarificationMarkdown, item.claim, item.shareText, item.headline, item.subline];
  for (const b of item.blocks ?? []) parts.push(b.heading, b.markdown, b.warning, ...(b.cards ?? []).map((c) => `${c.if ?? ''} ${c.title ?? ''} ${c.text ?? ''}`));
  for (const s of item.sections ?? []) parts.push(s.heading, s.markdown);
  for (const v of Object.values(item.keyFacts ?? {})) parts.push(v);
  for (const p of item.publicFunded ?? []) parts.push(p.group, p.schedule, p.note);
  // 第二輪型別：影音逐字稿、專區／服務簡介、步驟、摘要、檢體說明、篇目
  parts.push(item.transcriptMarkdown, item.introMarkdown, item.abstractMarkdown, item.notesMarkdown, item.basedOnVersionLabel);
  for (const st of item.steps ?? []) parts.push(st.title, st.text);
  for (const a of item.articles ?? []) parts.push(a.title, a.abstract);
  for (const sp of item.specimens ?? []) parts.push(sp.name, sp.note);
  for (const c of item.chapters ?? []) parts.push(c.label);
  for (const f of item.faq ?? []) parts.push(f.q, f.a);
  for (const lang of Object.values(item.i18n ?? {})) parts.push(JSON.stringify(lang));
  return parts.filter(Boolean).join('\n');
}

/** 通報時限表：[{ legalCategory, label, diseases: [{ id, slug, name, nameEn, notifyWithinHours, notifyLabel, hasPage, path, caseDefinitionDoc?, labtestId? }] }] */
function buildNotifyTable(site, labtestsByDisease, currentOfFamily) {
  const resolveDoc = (ref) => {
    if (!ref) return null;
    const it = site.byId.get(ref);
    const cur = it?.type === 'document' ? currentOfFamily(it.family ?? it.id) : currentOfFamily(ref);
    return cur ?? (it?.type === 'document' ? it : null);
  };
  const groups = new Map();
  for (const d of site.master.diseases ?? []) {
    const cat = d.legalCategory ?? null;
    if (!groups.has(cat)) groups.set(cat, []);
    const page = site.byId.get(d.id);
    const hasPage = page?.type === 'disease' && page.status === 'published';
    const lts = labtestsByDisease.get(d.id) ?? [];
    const cdRef = (hasPage ? page.professional?.caseDefinitionDoc : null) ?? lts.find((l) => l.caseDefinitionDoc)?.caseDefinitionDoc ?? null;
    const cdDoc = resolveDoc(cdRef);
    const row = {
      id: d.id, slug: d.slug, name: d.name, nameEn: d.nameEn ?? null, legalName: d.legalName ?? null,
      notifyWithinHours: d.notifyWithinHours ?? null, notifyLabel: notifyLabel(d.notifyWithinHours),
      hasPage, path: hasPage ? pathOf(page) : null,
    };
    if (cdRef) Object.assign(row, { caseDefinitionDoc: cdRef, caseDefinitionCurrentId: cdDoc?.id ?? null, caseDefinitionPath: cdDoc ? pathOf(cdDoc) : null });
    if (lts.length) Object.assign(row, { labtestId: lts[0].id, labtestPath: pathOf(lts[0]), labtestIds: lts.map((l) => l.id) });
    groups.get(cat).push(row);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a ?? 99) - (b ?? 99))
    .map(([cat, diseases]) => ({
      legalCategory: cat, label: LEGAL_CATEGORY_LABELS[cat] ?? '未分類',
      diseases: diseases.sort((a, b) => (a.notifyWithinHours ?? 1e9) - (b.notifyWithinHours ?? 1e9) || a.name.localeCompare(b.name, 'zh-Hant')),
    }));
}

function summarizeLinks(links) {
  const by = { ok: 0, broken: 0, unchecked: 0 };
  for (const l of links) by[l.status]++;
  const checked = by.ok + by.broken;
  return { total: links.length, ...by, checked, lastCheckedAt: links.map((l) => l.lastCheckedAt).filter(Boolean).sort().at(-1) ?? null, healthyPct: pct(by.ok, links.length) };
}

function computeByOwner(site) {
  const map = new Map();
  const row = (id) => {
    if (!map.has(id)) {
      const u = site.unitById.get(id);
      map.set(id, { unit: id, name: u?.name ?? id, nameEn: u?.nameEn ?? null, kind: u?.kind ?? null, content: 0, published: 0, whitelist: 0, overdue: 0, dueSoon: 0, stale: 0, todos: 0, todosOverdue: 0, todosHigh: 0, types: {}, latestReviewedAt: null });
    }
    return map.get(id);
  };
  for (const u of site.master.units ?? []) row(u.id);
  for (const item of site.all) {
    const r = row(item.owner);
    r.content++;
    r.types[item.type] = (r.types[item.type] ?? 0) + 1;
    if (item.reviewedAt && (!r.latestReviewedAt || item.reviewedAt > r.latestReviewedAt)) r.latestReviewedAt = item.reviewedAt;
    if (item.status === 'published') r.published++;
    if (item.gov.whitelist.effective) r.whitelist++;
    if (item.gov.overdue) r.overdue++;
    if (item.gov.dueSoon) r.dueSoon++;
    if (item.gov.stale.length) r.stale++;
  }
  for (const t of site.gov.todos) {
    if (!t.owner) continue;
    const r = row(t.owner);
    r.todos++; if (t.overdue) r.todosOverdue++; if (t.severity === 'high') r.todosHigh++;
  }
  return [...map.values()].sort((a, b) => b.todosOverdue - a.todosOverdue || b.todos - a.todos || b.content - a.content || a.unit.localeCompare(b.unit));
}

function computeSummary(site) {
  const all = site.all;
  const pub = all.filter((i) => i.status === 'published');
  const todos = site.gov.todos;
  const byKind = {};
  for (const t of todos) byKind[t.kind] = (byKind[t.kind] ?? 0) + 1;
  const byLifecycle = {};
  for (const i of all) byLifecycle[i.gov.lifecycle] = (byLifecycle[i.gov.lifecycle] ?? 0) + 1;
  return {
    today: site.today,
    contentTotal: all.length,
    published: pub.length,
    whitelist: site.gov.whitelistCount,
    whitelistPublic: all.filter((i) => i.gov.whitelist.public).length,
    whitelistPct: pct(site.gov.whitelistCount, pub.length),
    todos: todos.length,
    todosOverdue: todos.filter((t) => t.overdue).length,
    todosHigh: todos.filter((t) => t.severity === 'high').length,
    todosByKind: byKind,
    byLifecycle,
    overdueContent: all.filter((i) => i.gov.overdue).length,
    dueSoon: all.filter((i) => i.gov.dueSoon).length,
    supersededDocs: all.filter((i) => i.gov.superseded).length,
    documentFamilies: site.gov.families.length,
    staleDerived: all.filter((i) => i.gov.stale.length).length,
    reverseAuditHits: all.reduce((n, i) => n + i.gov.reverseAuditHits.length, 0),
    translationStale: all.reduce((n, i) => n + Object.values(i.gov.translationStale).filter(Boolean).length, 0),
    datasets: (site.collections.datasets ?? []).length,
    datasetsOverdue: (site.collections.datasets ?? []).filter((d) => d.gov.datasetOverdue).length,
    licenseNonStandard: (site.collections.datasets ?? []).filter((d) => !d.gov.licenseStandard).length,
    pausedAI: site.gov.pausedAI,
    aiMode: site.gov.aiStatus.mode,
    situationDataDate: site.gov.situation.dataDate,
    situationLagDays: site.gov.situation.lagDays,
    situationOverdue: site.gov.situation.overdue,
    noticesOpen: all.filter((i) => i.gov.notice && i.status === 'published' && i.gov.deadlineAt && !i.gov.closed).length,
    noticesClosed: all.filter((i) => i.gov.closed).length,
    noticesClosingSoon: all.filter((i) => i.gov.closingSoon && i.status === 'published').length,
    topicsEnded: all.filter((i) => i.gov.ended).length,
    media: (site.collections.media ?? []).length,
    mediaOutdated: all.filter((i) => i.gov.mediaOutdated).length,
    mediaNoTranscript: (site.collections.media ?? []).filter((m) => !m.gov.hasTranscript).length,
    linksTotal: site.gov.linkHealth.total,
    linksBroken: site.gov.linkHealth.broken,
    linksUnchecked: site.gov.linkHealth.unchecked,
    labtestsInconsistent: (site.collections.labtests ?? []).filter((l) => l.gov.labtestCheck && !l.gov.labtestCheck.consistent).length,
  };
}

function kpiStatus(k) {
  if (k.current == null) return 'pending';
  const tgt = k.target1y;
  if (tgt == null) return 'info';
  if (k.direction === 'lower') return k.current <= tgt ? 'ok' : k.current <= tgt * 2 + 1 ? 'warn' : 'bad';
  return k.current >= tgt ? 'ok' : k.current >= tgt * 0.8 ? 'warn' : 'bad';
}

/** 7.5 品質指標表（13 列）＋第二輪四列（影音逐字稿、影音依據現行、外部連結健康、已截止未封存公告）＋白名單參考列。每季報告與後台儀表板共用。 */
export function computeKpi(site) {
  const cfg = site.config;
  const all = site.all;
  const pub = all.filter((i) => i.status === 'published');
  const contentPages = pub.filter((i) => PUBLIC_PAGE_TYPES.has(i.type) && !i.gov.superseded);
  const withProv = contentPages.filter((i) => i.owner && site.unitById.has(i.owner) && i.reviewedAt);
  const ds = (site.collections.datasets ?? []).filter((d) => d.status === 'published');
  const dsLic = ds.filter((d) => d.gov.licenseStandard);
  const dsFresh = ds.filter((d) => !d.gov.datasetOverdue);
  const docs = (site.collections.documents ?? []).filter((d) => d.isCurrent);
  const docsMr = docs.filter((d) => (d.machineReadableMarkdown ?? '').trim().length > 50);
  const enBase = pub.filter((i) => cfg.tier1Types.includes(i.type) || i.type === 'faq');
  const enSync = enBase.filter((i) => i.languages?.en?.status === 'reviewed' && !i.gov.translationStale.en);
  const tier1 = pub.filter((i) => cfg.tier1Types.includes(i.type));
  const sevenLang = tier1.filter((i) => cfg.langs.every((l) => i.gov.renderableLangs.includes(l.code)));
  const lag = site.gov.situation.lagDays;
  // 正本修訂 → 衍生內容處理天數（已完成：reviewedAt − 修訂日；未完成：today − 修訂日，即仍開著的待辦）
  const events = [];
  for (const i of pub) for (const r of i.gov.basisRevisions) events.push({ resolved: r.resolved, days: daysBetween(r.revisedAt, r.resolved ? r.resolvedAt : site.today) });
  const eventsWithin = events.filter((e) => e.resolved && e.days <= BASIS_REVISION_DAYS);
  const staleItems = pub.filter((i) => i.gov.stale.length);
  // 失效版本仍在搜尋結果：搜尋索引已建（emit 階段）就實際檢查；否則以白名單判定
  const superseded = (site.collections.documents ?? []).filter((d) => d.gov.superseded);
  const supersededIds = new Set(superseded.map((d) => d.id));
  let supersededIndexed;
  if (site.searchIndex) {
    const hit = new Set();
    for (const c of [...(site.searchIndex.public ?? []), ...(site.searchIndex.pro ?? [])]) if (supersededIds.has(c.contentId)) hit.add(c.contentId);
    supersededIndexed = hit.size;
  } else supersededIndexed = superseded.filter((d) => d.gov.whitelist.effective || !d.gov.noindex).length;
  const ver = site.evalReport?.byCategory?.version;
  // 第二輪：影音、外部連結、公告
  const media = pub.filter((i) => i.type === 'media');
  const mediaTr = media.filter((i) => i.gov.hasTranscript);
  const mediaCur = media.filter((i) => !i.gov.mediaOutdated);
  const links = site.gov.externalLinks ?? [];
  const linksOk = links.filter((l) => l.status === 'ok');
  const closedUnarchived = pub.filter((i) => i.gov.closed && i.gov.closedDays > CLOSED_ARCHIVE_DAYS);

  const rows = [
    { key: 'provenance', label: '對外內容頁有更新日與權責單位', current: pct(withProv.length, contentPages.length), numerator: withProv.length, denominator: contentPages.length, target1y: 100, target3y: 100, unit: '%' },
    { key: 'dataset-license', label: '開放資料集授權標示一致', current: pct(dsLic.length, ds.length), numerator: dsLic.length, denominator: ds.length, target1y: 100, target3y: 100, unit: '%' },
    { key: 'dataset-fresh', label: '資料集在更新頻率內更新', current: pct(dsFresh.length, ds.length), numerator: dsFresh.length, denominator: ds.length, target1y: 90, target3y: 98, unit: '%' },
    { key: 'doc-machine-readable', label: '文件有機讀版（現行版）', current: pct(docsMr.length, docs.length), numerator: docsMr.length, denominator: docs.length, target1y: 100, target3y: 100, unit: '%' },
    { key: 'en-sync', label: '英文版與中文同步（一級內容與 Q&A）', current: pct(enSync.length, enBase.length), numerator: enSync.length, denominator: enBase.length, target1y: 91, target3y: 100, unit: '%' },
    { key: 'seven-lang', label: '一級內容七語涵蓋（人工複核）', current: pct(sevenLang.length, tier1.length), numerator: sevenLang.length, denominator: tier1.length, target1y: 50, target3y: 100, unit: '%', note: '一級內容需 reviewed 才計入；態勢層另以 i18n 欄位提供' },
    { key: 'openapi', label: '對外資料出口有 OpenAPI 文件', current: 100, numerator: 1, denominator: 1, target1y: 100, target3y: 100, unit: '%', note: 'v1/ 全部端點由 openapi.json 描述（建置產生）' },
    { key: 'situation-latency', label: '態勢層資料延遲（資料日距今）', current: lag, target1y: 1, target3y: 1, unit: '日', direction: 'lower', note: `資料日 ${site.gov.situation.dataDate ?? '—'}；目標 ≤ 1 日` },
    { key: 'publish-lead-time', label: '上架到發布中位時間', current: null, target1y: 3, target3y: 1, unit: '日', direction: 'lower', note: '待量測：原型無送審時間戳，正式版由 PR 開啟到合併時間計算' },
    { key: 'revision-to-annotation', label: '正本修訂到衍生內容加註天數（中位數）', current: median(events.map((e) => e.days)), numerator: eventsWithin.length, denominator: events.length, target1y: BASIS_REVISION_DAYS, target3y: 1, unit: '日', direction: 'lower', note: `共 ${events.length} 件連動事件，${events.filter((e) => !e.resolved).length} 件未完成（以今日計）；7 日內完成 ${eventsWithin.length} 件` },
    { key: 'stale-derived', label: '已修訂正本仍有未加註衍生內容', current: staleItems.length, target1y: 0, target3y: 0, unit: '件', direction: 'lower', items: staleItems.map((i) => i.id) },
    { key: 'superseded-indexed', label: '失效版本仍在搜尋結果', current: supersededIndexed, target1y: 0, target3y: 0, unit: '件', direction: 'lower', note: site.searchIndex ? '以實際答案單元索引檢查' : '失效版自動 noindex、退出白名單，由引擎保證' },
    { key: 'eval-version-accuracy', label: '評估集版本題正確率', current: ver?.total ? pct(ver.passed, ver.total) : null, numerator: ver?.passed ?? null, denominator: ver?.total ?? null, target1y: 100, target3y: 100, unit: '%', note: ver ? '建置時以評估集計算；未達 100% 不得上線' : '待評估集執行（建置後段產生）' },
    { key: 'media-transcript', label: '影音有逐字稿比例', current: pct(mediaTr.length, media.length), numerator: mediaTr.length, denominator: media.length, target1y: 100, target3y: 100, unit: '%', note: `逐字稿 ≥ ${MIN_TRANSCRIPT_CHARS} 字才計入；逐字稿是 AI 唯一可引用的影片內容` },
    { key: 'media-current-basis', label: '影音依據正本為現行版比例', current: pct(mediaCur.length, media.length), numerator: mediaCur.length, denominator: media.length, target1y: 100, target3y: 100, unit: '%', note: '製作日早於依據正本現行版生效日者不計入', items: media.filter((i) => i.gov.mediaOutdated).map((i) => i.id) },
    { key: 'link-health', label: '外部連結已檢查且正常比例', current: links.some((l) => l.status !== 'unchecked') ? pct(linksOk.length, links.length) : null, numerator: linksOk.length, denominator: links.length, target1y: 95, target3y: 99, unit: '%', note: `共 ${links.length} 個外部連結：正常 ${linksOk.length}、失效 ${links.filter((l) => l.status === 'broken').length}、未檢查 ${links.filter((l) => l.status === 'unchecked').length}（由 fetch-data --check-links 檢查${links.some((l) => l.status !== 'unchecked') ? '' : '；尚未執行檢查'}）` },
    { key: 'notices-closed-unarchived', label: `已截止超過 ${CLOSED_ARCHIVE_DAYS} 天仍上架的公告`, current: closedUnarchived.length, target1y: 0, target3y: 0, unit: '件', direction: 'lower', items: closedUnarchived.map((i) => i.id) },
    { key: 'whitelist', label: 'AI 白名單生效內容數（參考）', current: site.gov.whitelistCount, numerator: site.gov.whitelistCount, denominator: pub.length, target1y: null, target3y: null, unit: '筆', reference: true },
  ];
  for (const r of rows) {
    r.direction ??= 'higher';
    r.pct = r.unit === '%' ? r.current : (r.denominator ? pct(r.numerator, r.denominator) : null);
    r.status = kpiStatus(r);
  }
  return rows;
}
