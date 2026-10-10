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
// 第五輪（ARCHITECTURE.md 13.1）：
//  R14 移轉清單：site.migrationLists（content/migration/*.json）→ site.migration（lists、byTarget、stats、pending）；
//      以 target 反向掛 item.gov.legacy = { urls, items, show, showUntil }；today > showLegacyUntil ⇒ show=false（自動退場）。
//      verified:false 不開待辦，只在後台列出。
// 第六輪（ARCHITECTURE 14.1／14.2）：
//  R15 推導移轉清單：content/migration/_disease-template.json（site.migrationTemplates）× 主檔每一種疾病 ⇒ 一份清單
//      （derived:true）；有疾病頁且 mapTo 命中 ⇒ merged／migrated；未命中 ⇒ pending；無疾病頁 ⇒ 清單 status:no-page、全部 pending。
//      人工清單（同 scope.disease）覆蓋：同 key 以人工為準，人工沒寫的 key 由模板補（omit 可排除）。
//      待辦聚合：每份清單只開一則 migration-pending（「{疾病}：N 個舊頁待移轉」），優先度依法定類別（第一、二類 high、
//      第三類 medium、第四、五類 low）。site.migration.stats 加 lists／derived／curated／noPage；byDisease Map。
//  R16 來源語言：item.sourceLang（預設 zh-TW）永遠可渲染、不算譯文；其他語言（含 zh-TW）以來源語言頂層欄位的 sourceHash 判斷過期。
// 第七輪（ARCHITECTURE 15.1）：
//  R17 招募職缺（job）：gov.jobStage＝manualStatus（cancelled／filled）＞ result ＞ upcoming（today < applyStart）＞ open（today ≤ deadlineAt）
//      ＞ screening（examPlan 有 date ≤ today）＞ closed。不是 upcoming／open ⇒ gov.closed（退出首頁與開放中清單）。result 公告超過 90 天
//      ⇒ gov.archivedStage（歷史）。gov.jobTab：open／upcoming／review（closed、screening）／result／history。待辦：job-result-overdue
//      （today > resultPlannedAt + 7 且無 result，owner 人事室、cc 用人單位，medium）、job-waitlist-expiring（備取 validUntil 14 日內，low）、
//      job-apply-url-dead（applyUrl 外部連結檢查失敗，取代 link-broken）。甄選結果個資閘門在 validate（建置失敗）；result／waitlistUpdates
//      不進答案索引（index-builder）。
//  R19 檔案資產（第八輪，ARCHITECTURE 16.1）：建置失敗的檢查在 scripts/lib/assets.mjs（validateAssets）；這裡只產生待辦：
//      attachment-no-accessible-version（medium）：附件 PDF 的 machineReadable 不是 true 且沒有 accessibleAlt（.md／.docx／.odt）；
//      image-license-missing（medium）：圖片授權待確認——非本署素材（license ≠ OGDL-1.0）缺 source，或 license 不在開放授權清單
//        （license 整個沒填是建置失敗，不走待辦）；
//      asset-orphan（low）：content/assets/{id}/ 有檔未宣告（site.assetReport.orphans，validateAssets 算出），每筆內容一則。
//      只對 published 且非 superseded 的內容開 attachment／image 待辦。item.gov.assets、site.gov.assets 為統計；
//      md() 的圖片 alt／width／height 由 setAssetRegistry(assetRegistryOf(site)) 提供（模板不必改呼叫方式）。
//      外部連結健康（R11）不檢 /files/（站內檔案由建置後連結檢查確認存在）。
//  R18 採購公告（tender）：gov.tenderStage＝manualStatus（failed／cancelled）＞ awarded（有 award）＞ open（today ≤ deadlineAt）
//      ＞ opened（today ≥ openingAt）＞ closed。待辦 tender-award-overdue（openingAt + 30 日仍無 award 且非 failed／cancelled，owner 秘書室、cc 需求單位）。
// 第九輪（ARCHITECTURE 17.1）：
//  R20 發布車道：gov.lane＝laneOfItem（content/governance/lanes.json：urgent:true 且型別允許 ⇒ emergency；否則依型別 fast／standard）、gov.laneLabel。
//  R21 排程發布：publishAt > 現在（真實時間 site.now／BUILD_NOW／Date.now()，不用 BUILD_TODAY）⇒ gov.publishScheduled、gov.scheduled、
//      lifecycle scheduled「排程中」、noindex、退出白名單（scheduled）、不算 totalPublished；對外輸出一律經 scripts/lib/lanes.mjs 的
//      isPublic()／publicView()（不渲染、不進索引／sitemap／API／RSS／llms.txt）。後台拿完整 site，列「排程中」。
//  R22 上線後複核：快車道／緊急發布已上線（isPublic）且 postPublishReview.status ≠ done ⇒ 待辦 post-publish-review
//      （owner 公關室〔lanes.json postPublishReviewer〕、cc 原 owner，期限＝上線時間（publishAt 或 publishedAt 00:00 台灣時間）+ 24h，
//      中優先；已過期限 ⇒ high、overdue）。車道上線前（lanes.json rules.postPublishReviewSince）發布且未宣告 postPublishReview 的舊內容不追溯。
//      PR 的 SLA 逾期（lane-sla-breach）是 CI 在 PR 上標籤與留言（.github/workflows/lane-sla.yml），不是建置待辦。
// annotations[]：{ kind, level, text, href（目標內容 id，沿用骨架語意）, targetId, path（目標前台路徑） }
//  另：白名單型別政策（allowedTypes 民眾＋專業、allowedTypesPro 只進專業）、失效版仍被引用、態勢層逾期。
import { createHash } from 'node:crypto';
import { addMonths, daysBetween } from './render.mjs';
import { jobPiiErrors } from './validate.mjs';
import { jobStageOf, tenderStageOf } from '../../src/client/careers-rules.js';
import { setAssetRegistry } from './markdown.mjs';
import { assetRegistryOf, assetUrl, extOf, imageLicenseProblems, needsAccessibleVersion } from './assets.mjs';
import { siteOrigin } from '../../site.config.mjs';
import { loadLanes, laneOfItem, isScheduled, isPublic, nowOf, publishAtMs, taipeiDate, taipeiTime } from './lanes.mjs';

// ───────────────────────── 常數與對照表 ─────────────────────────

/** 白名單不生效原因 → 人看得懂的中文 */
export const WHITELIST_REASON_LABELS = {
  'not-requested': '未申請進入 AI 白名單',
  'not-published': '尚未發布（草稿、審核中或已封存）',
  'type-not-allowed': '此內容型別不在白名單政策內',
  sensitivity: '敏感等級不允許（內部資料，或專業資料不得進民眾端）',
  'not-yet-effective': '本版尚未生效',
  scheduled: '排程發布，尚未上線',
  superseded: '已由新版取代（失效版本）',
  overdue: '已超過審閱期限，待權責單位重新審閱',
  'based-on-revised': '所依據的正本已修訂，衍生內容尚未更新',
  'predates-basis': '發布日早於現行正本生效日，不作為答案依據（僅保留加註）',
  'reverse-audit': '反向稽核命中與現行正本矛盾的敘述',
  'pdf-unreviewed': 'PDF 機器轉出的文字尚未經權責單位校對（docs/pdf-ingest.md）',
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
  'migration-pending': '舊頁待移轉',
  'job-result-overdue': '甄選結果逾期未公告',
  'job-waitlist-expiring': '備取有效期將屆',
  'job-apply-url-dead': '報名連結失效',
  'tender-award-overdue': '決標逾期未公告',
  'attachment-no-accessible-version': 'PDF 附件缺可及性版本',
  'image-license-missing': '圖片授權或來源待確認',
  'asset-orphan': '未宣告的孤兒檔',
  'post-publish-review': '上線後複核',
  'pdf-unreviewed': 'PDF 機讀版待校對',
};
/** 排程發布（publishAt 未到）的生命週期顯示文字（lifecycle 仍為 scheduled，與文件「尚未生效」共用代碼） */
export const SCHEDULED_PUBLISH_LABEL = '排程中';
/** 檔案資產待辦期限（日） */
export const ASSET_FIX_DAYS = 30;

// ───────────────────────── 第七輪：招募職缺與採購公告（ARCHITECTURE 15.1） ─────────────────────────

/** 職缺階段（gov.jobStage）中文 */
export const JOB_STAGE_LABELS = { upcoming: '即將開放報名', open: '報名中', closed: '已截止（待甄試）', screening: '審查與甄試中', result: '已公告甄選結果', filled: '已補實', cancelled: '已停止甄選' };
/** 採購階段（gov.tenderStage）中文 */
export const TENDER_STAGE_LABELS = { open: '招標中', closed: '已截止（待開標）', opened: '已開標（待決標）', awarded: '已決標', failed: '流標', cancelled: '已取消' };
/** /careers/ 頁籤（gov.jobTab）與 /procurement/ 頁籤（gov.tenderTab） */
export const JOB_TAB_LABELS = { open: '開放中', upcoming: '即將開放', review: '審查與甄試中', result: '錄取結果', history: '歷史' };
export const TENDER_TAB_LABELS = { open: '招標中', closed: '已截止', opened: '已開標', awarded: '已決標', failed: '流標' };
/** 結果預定日後幾天仍無 result ⇒ job-result-overdue */
export const JOB_RESULT_GRACE_DAYS = 7;
/** result 公告後幾天移入「歷史」 */
export const JOB_HISTORY_DAYS = 90;
/** 備取有效期幾天內屆滿 ⇒ job-waitlist-expiring */
export const WAITLIST_EXPIRING_DAYS = 14;
/** 開標後幾天仍無決標 ⇒ tender-award-overdue */
export const TENDER_AWARD_DAYS = 30;
/** 本站模擬報名頁（只在 open 且 applyMethod online、無外部 applyUrl 時由模板輸出） */
export const jobApplyPath = (job) => `${pathOf(job).replace(/\/$/, '')}/apply/`;

export { jobStageOf, tenderStageOf } from '../../src/client/careers-rules.js';

/** 移轉清單狀態（ARCHITECTURE 13.1） */
export const MIGRATION_STATUS_LABELS = { migrated: '已移轉', merged: '已併入', archived: '已封存', pending: '待移轉', dropped: '不移轉' };
/** 移轉後新增的治理要求（展示用 chip） */
export const MIGRATION_REQUIREMENT_LABELS = {
  owner: '權責單位', reviewedAt: '審閱日', reviewPeriod: '審閱週期', basedOn: '依據正本', machineReadable: '機讀版', languages: '多語狀態',
  versionChain: '版本鏈', aiWhitelist: 'AI 白名單', structuredData: '結構化資料', accessibility: '無障礙', license: '授權標示', linkCheck: '連結健康檢查',
};
/** 舊頁待移轉的預設完成期限（清單 reviewedAt 起算） */
export const MIGRATION_PENDING_DAYS = 60;
const PLACEHOLDER_SEG_RE = /\{[^}]*\}/;
/** 舊網址 → 站內 path＋query（去網域、去 hash，保留大小寫）：https://www.cdc.gov.tw/Disease/SubIndex/{id}#x → /Disease/SubIndex/{id} */
export function legacyPathOf(url) {
  const s = String(url ?? '').trim().replace(/#.*$/, '').replace(/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i, '');
  return !s ? '/' : s.startsWith('/') ? s : `/${s}`;
}
/** 舊網址含 URI Template 佔位（{id}）⇒ 只是 URL 模式，不能當實際轉址來源 */
export const isLegacyPattern = (url) => PLACEHOLDER_SEG_RE.test(legacyPathOf(url));

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
export const PUBLIC_PAGE_TYPES = new Set(['disease', 'vaccine', 'faq', 'clarification', 'news', 'letter', 'document', 'dataset', 'page', 'media', 'topic', 'service', 'publication', 'labtest', 'research', 'job', 'tender']);
const NEWS_TYPES = new Set(['news', 'letter']);
/**
 * 機關公告（/notices/）：news 中的其他訊息。第七輪起人才招募改 job、採購公告改 tender 型別；
 * recruit／procurement 只為相容既有（第七輪前）資料與測試保留，schemas/news.json 已不接受。
 */
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
  job: [{ field: 'applyUrl' }],
  tender: [{ field: 'pccUrl' }],
};
/** basedOnVersionLabel 可能寫成畫面上的整句「依 114.04.16 建議製作」→ 取中間版本字樣 */
export function versionLabelOf(media) {
  const raw = String(media.basedOnVersionLabel ?? '').trim().replace(/^依\s*/, '').replace(/\s*製作$/, '').trim();
  return raw || media.producedAt;
}
/** 本站檔案（/files/…，含本站絕對網址）：由建置後的站內連結檢查確認存在，不列入外部連結健康檢查 */
export const isSiteFile = (u) => typeof u === 'string' && (u.startsWith('/files/') || u.startsWith(`${siteOrigin()}/files/`));
const isHttp = (u) => typeof u === 'string' && /^https?:\/\//i.test(u) && !isSiteFile(u);

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
const PAGE_SLUG_PATHS = { 'ai-policy': '/policy/ai/', privacy: '/policy/privacy/', 'open-data': '/policy/open-data/', legal: '/policy/legal/', foia: '/policy/foia/', 'security-policy': '/policy/security/', copyright: '/policy/copyright/' };

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
    // 第七輪：id job.{yyyy-mm-dd}-{slug} → /careers/{slug}/；tender 同理 → /procurement/{slug}/
    case 'job': return `/careers/${item.slug ?? slugOf(item).replace(/^\d{4}-\d{2}-\d{2}-/, '')}/`;
    case 'tender': return `/procurement/${item.slug ?? slugOf(item).replace(/^\d{4}-\d{2}-\d{2}-/, '')}/`;
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

/** 語言中文名（待辦與譯文狀態說明用） */
export const LANG_NAME_ZH = { 'zh-TW': '中文', en: '英文', ja: '日文', tl: '他加祿文', vi: '越南文', id: '印尼文', th: '泰文' };
/** 內容的來源語言（ARCHITECTURE 14.2；預設 zh-TW） */
export const sourceLangOf = (item) => item?.sourceLang ?? 'zh-TW';

/** 某內容在某語言是否可渲染（與 scripts/lib/pages.mjs 的 langAvailable 一致）：來源語言與 zh-TW 永遠可渲染 */
export function langRenderable(site, item, lang) {
  if (lang === sourceLangOf(item) || lang === site.config.defaultLang || lang === 'zh-TW') return true;
  const st = item.languages?.[lang]?.status;
  if (!st || st === 'none' || st === 'pending') return false;
  if (site.config.tier1Types.includes(item.type)) return st === 'reviewed';
  return true;
}

// ───────────────────────── 主流程 ─────────────────────────

export function applyGovernance(site) {
  const today = site.today;
  const cfg = site.config;
  // 第九輪：排程發布以真實現在時間判斷（測試以 site.now 注入）；車道設定可由 site.governance.lanes 覆寫
  const now = nowOf(site);
  const lanesCfg = site.governance?.lanes ?? loadLanes();
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
    // 排程發布（publishAt 未到）的版本還沒上線，不能取代現行版（R21）
    const effective = versions.filter((v) => v.status === 'published' && (v.effectiveAt ?? '') <= today && !isScheduled(v, now));
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
    // R17／R18 招募職缺與採購公告
    if (item.type === 'job') Object.assign(gov, jobGov(item, today, published));
    if (item.type === 'tender') Object.assign(gov, tenderGov(item, today, published));
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

    // R20 發布車道、R21 排程發布（publishAt 未到）
    gov.lane = laneOfItem(item, lanesCfg);
    gov.laneLabel = lanesCfg.lanes?.[gov.lane]?.label ?? gov.lane;
    gov.publishAt = item.publishAt ?? null;
    gov.publishScheduled = published && isScheduled(item, now);
    if (gov.publishScheduled) {
      const at = publishAtMs(item.publishAt);
      gov.scheduled = true;
      gov.noindex = true;
      gov.publishAtLocal = taipeiTime(at);
      gov.annotations.push({ kind: 'scheduled', level: 'info', text: `本內容排程於 ${taipeiTime(at)}（台灣時間）上線；上線前不對外輸出。`, href: null, targetId: null, path: null, publishAt: item.publishAt });
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

    // R5 翻譯與可渲染語言（R16：以來源語言為準；sourceLang≠zh-TW 時 zh-TW 也是譯文）
    const srcLang = sourceLangOf(item);
    gov.sourceLang = srcLang;
    const srcLabel = srcLang === 'zh-TW' ? '中文' : `${LANG_NAME_ZH[srcLang] ?? srcLang}正本`;
    for (const L of cfg.langs) {
      const lang = L.code;
      const renderable = langRenderable(site, item, lang);
      if (renderable) gov.renderableLangs.push(lang);
      if (lang === srcLang) continue;
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
        note: stale ? `${srcLabel}已更新，譯文待複核`
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
    if (gov.publishScheduled) r.push('scheduled');
    else if (gov.scheduled) r.push('not-yet-effective');
    if (gov.superseded) r.push('superseded');
    if (gov.overdue) r.push('overdue');
    if (gov.stale.length) r.push('based-on-revised');
    if (gov.predatesBasis) r.push('predates-basis');
    if (gov.reverseAuditHits.length) r.push('reverse-audit');
    // 第十九輪：PDF 機器轉出、尚未校對的文件不進白名單（專業版仍可檢索，但來源卡標「未校對，以 PDF 為準」）
    if (item.derivedFrom && item.derivedFrom.reviewStatus !== 'reviewed') {
      r.push('pdf-unreviewed');
      if (item.status === 'published' && !gov.superseded) {
        const df = item.derivedFrom;
        const tables = [...(df.tablePages ?? []), ...(df.inlineTablePages ?? [])].sort((a, b) => a - b);
        // 第二十八輪：重建版（沒有 PDF 正本、由有出處的句子拼成）不能「校對完改 reviewed」，要做的是取得正本、重新轉檔、刪掉重建版
        const text = df.sourceKind === 'reconstructed'
          ? `「${item.title}」是沒有 PDF 正本時的重建版（${df.extractedAt ?? '日期不明'}，來源見文末「資料來源與查證狀態」），不是教材原文：請提供 PDF 正本，以 scripts/pdf-to-md.mjs 轉出同家族（${item.family ?? item.id}）的正式版本後刪除本重建版；在那之前請逐條核對來源表並補上「（待補）」處（guide-staff §31）`
          : `「${item.title}」的機讀版由 ${df.file} 機器轉出（${df.extractedAt ?? '日期不明'}），尚未校對：請對照 PDF 原頁抽查章節與條文${tables.length ? `，並把第 ${tables.join('、')} 頁的表格轉成 Markdown 表格` : ''}${df.redTextChanges === 'not-captured' ? '；紅字修訂處抽成文字後已無顏色，請填「本版異動」（changes）' : ''}；完成後把 derivedFrom.reviewStatus 改成 reviewed（guide-staff §20）`;
        addTodo({ id: `pdf-unreviewed:${item.id}`, kind: 'pdf-unreviewed', item, dueAt: addDays(df.extractedAt ?? item.publishedAt ?? today, ASSET_FIX_DAYS), severity: 'medium', text });
      }
    }
    gov.whitelist.effective = r.length === 0;
    gov.whitelist.reasonLabels = r.map((x) => WHITELIST_REASON_LABELS[x] ?? x);
    gov.whitelist.public = gov.whitelist.effective && gov.whitelist.tier === 'public' && (item.audience ?? []).includes('public');
    gov.whitelist.pro = gov.whitelist.effective;
    if (item.status === 'published' && !gov.publishScheduled) totalPublished++;
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
    gov.lifecycleLabel = gov.lifecycle === 'scheduled' && gov.publishScheduled ? SCHEDULED_PUBLISH_LABEL : LIFECYCLE_LABELS[gov.lifecycle];

    // R22 上線後複核（快車道／緊急發布）
    const laneDef = lanesCfg.lanes?.[gov.lane];
    if (laneDef?.postPublishReviewHours && isPublic(item, now)) {
      const st = item.postPublishReview?.status ?? null;
      const since = lanesCfg.rules?.postPublishReviewSince ?? '0000-00-00';
      const inScope = !!item.postPublishReview || item.urgent === true || !!item.publishAt || (item.publishedAt ?? '') >= since;
      if (inScope) {
        const liveAt = Math.max(publishAtMs(item.publishAt) ?? 0, publishAtMs(item.publishedAt) ?? 0);
        const dueMs = liveAt + laneDef.postPublishReviewHours * 3600e3;
        const done = st === 'done';
        const ppOverdue = !done && now > dueMs;
        gov.postPublishReview = { required: true, status: st ?? 'pending', done, dueAt: new Date(dueMs).toISOString(), dueAtLocal: taipeiTime(dueMs), overdue: ppOverdue, reviewer: laneDef.postPublishReviewer ?? 'unit.pr', reviewedBy: item.postPublishReview?.reviewedBy ?? null, reviewedAt: item.postPublishReview?.reviewedAt ?? null };
        if (!done) {
          addTodo({ id: `post-publish-review:${item.id}`, kind: 'post-publish-review', item, owner: laneDef.postPublishReviewer ?? 'unit.pr', ccOwner: item.owner,
            dueAt: taipeiDate(dueMs), dueAtTime: new Date(dueMs).toISOString(), overdue: ppOverdue, severity: ppOverdue ? 'high' : 'medium', lane: gov.lane, laneLabel: gov.laneLabel,
            text: `${gov.laneLabel}已上線的「${item.title}」尚未完成上線後複核：請於 ${taipeiTime(dueMs)}（上線後 ${laneDef.postPublishReviewHours} 小時）前確認內容，完成後在 postPublishReview 標 done${ppOverdue ? '（已逾期）' : ''}` });
        }
      } else gov.postPublishReview = { required: false, status: st ?? 'legacy' };
    } else gov.postPublishReview = { required: false, status: item.postPublishReview?.status ?? null };

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
        severity: cfg.tier1Types.includes(item.type) || lang === 'zh-TW' ? 'medium' : 'low',
        text: `「${item.title}」${gov.sourceLang !== 'zh-TW' ? `${LANG_NAME_ZH[gov.sourceLang] ?? gov.sourceLang}正本` : '中文'}已更新，${label}（${lang}）譯文待複核` });
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
        if (item.type === 'job' && l.field === 'applyUrl') {
          // R17：職缺外部報名連結失效（報名中／即將開放 ⇒ high：民眾無法報名）
          const live = ['open', 'upcoming'].includes(item.gov.jobStage);
          addTodo({ id: `job-apply-url-dead:${item.id}`, kind: 'job-apply-url-dead', item, url: l.url, field: l.field, cc: [item.hiringUnit].filter(Boolean),
            dueAt: live ? addDays(l.lastCheckedAt ?? today, 1) : addDays(l.lastCheckedAt ?? today, LINK_FIX_DAYS), severity: live ? 'high' : 'medium', stage: item.gov.jobStage,
            text: `職缺「${item.title}」的外部報名連結（${l.url}）於 ${l.lastCheckedAt ?? '最近一次檢查'} 檢查失敗${live ? '，目前仍在報名期間，請立即更新報名網址或改用本站報名頁' : '，請更新或移除'}` });
          continue;
        }
        addTodo({ id: `link-broken:${item.id}:${l.field}`, kind: 'link-broken', item, url: l.url, field: l.field, dueAt: addDays(l.lastCheckedAt ?? today, LINK_FIX_DAYS), severity: 'medium',
          text: `「${item.title}」的外部連結 ${l.field}${l.label ? `「${l.label}」` : ''}（${l.url}）於 ${l.lastCheckedAt ?? '最近一次檢查'} 檢查失敗，請更新網址或移除` });
      }
    }
  }

  // ── R17／R18 招募與採購待辦 ──
  for (const job of site.collections.jobs ?? []) {
    if (job.status !== 'published' || !job.gov) continue;
    const g = job.gov;
    if (g.resultOverdue) {
      addTodo({ id: `job-result-overdue:${job.id}`, kind: 'job-result-overdue', item: job, owner: 'unit.personnel', cc: [job.hiringUnit].filter(Boolean), ccNames: [job.hiringUnit].filter(Boolean).map(unitName),
        dueAt: g.resultDueAt, severity: 'medium', stage: g.jobStage, resultPlannedAt: job.resultPlannedAt,
        text: `職缺「${job.title}」預定 ${job.resultPlannedAt} 公告甄選結果，已逾 ${JOB_RESULT_GRACE_DAYS} 日仍未上架：請人事室會同${unitName(job.hiringUnit)}公告結果（只公布報名編號與遮罩姓名），或更新預定日` });
    }
    if (g.waitlistExpiring?.length) {
      const first = g.waitlistExpiring[0];
      addTodo({ id: `job-waitlist-expiring:${job.id}`, kind: 'job-waitlist-expiring', item: job, owner: 'unit.personnel', cc: [job.hiringUnit].filter(Boolean), ccNames: [job.hiringUnit].filter(Boolean).map(unitName),
        dueAt: first.validUntil, severity: 'low', ranks: g.waitlistExpiring.map((w) => w.rank), count: g.waitlistExpiring.length,
        text: `職缺「${job.title}」備取第 ${g.waitlistExpiring.map((w) => w.rank).join('、')} 名有效期將於 ${first.validUntil} 屆滿（剩 ${first.daysLeft} 日）：如需遞補請於期限前公告，屆滿後不再遞補` });
    }
  }
  for (const td of site.collections.tenders ?? []) {
    if (td.status !== 'published' || !td.gov) continue;
    if (td.gov.awardOverdue) {
      addTodo({ id: `tender-award-overdue:${td.id}`, kind: 'tender-award-overdue', item: td, owner: 'unit.secretariat', cc: [td.requestingUnit].filter(Boolean), ccNames: [td.requestingUnit].filter(Boolean).map(unitName),
        dueAt: td.gov.awardDueAt, severity: 'medium', stage: td.gov.tenderStage, openingAt: td.openingAt,
        text: `標案「${td.title}」（${td.tenderNo}）已於 ${td.openingAt} 開標，逾 ${TENDER_AWARD_DAYS} 日仍無決標或流標紀錄：請秘書室會同${unitName(td.requestingUnit)}更新決標資訊（award）或標記流標／取消（manualStatus）` });
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

  // ── R19 檔案資產（ARCHITECTURE 16.1） ──
  const assetGov = buildAssetGov(site, { addTodo, today, allowed: cfg.licenses?.allowed ?? [] });

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

  // ── R14 移轉清單 ──
  site.migration = buildMigration(site, { addTodo, unitName });

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
    assets: assetGov,
    notifyTable,
    // 第七輪：招募與採購階段統計（後台儀表板、/careers/、/procurement/ 頁籤計數）
    jobs: stageStats(site.collections.jobs, 'jobStage', 'jobTab', JOB_STAGE_LABELS, JOB_TAB_LABELS),
    tenders: stageStats(site.collections.tenders, 'tenderStage', 'tenderTab', TENDER_STAGE_LABELS, TENDER_TAB_LABELS),
    jobStageLabels: JOB_STAGE_LABELS, tenderStageLabels: TENDER_STAGE_LABELS, jobTabLabels: JOB_TAB_LABELS, tenderTabLabels: TENDER_TAB_LABELS,
  };
  site.gov.byOwner = computeByOwner(site);
  site.gov.summary = computeSummary(site);
  // KPI 依賴 site.searchIndex 與 site.evalReport（建置後段才有）→ 每次讀取時計算
  Object.defineProperty(site.gov, 'kpi', { enumerable: true, configurable: true, get: () => computeKpi(site) });
  Object.defineProperty(site.gov, 'kpiByKey', { enumerable: false, configurable: true, get: () => Object.fromEntries(computeKpi(site).map((k) => [k.key, k])) });
  return site.gov;
}

/**
 * R19 檔案資產：item.gov.assets、待辦（attachment-no-accessible-version、image-license-missing、asset-orphan）、md() 圖片登錄。
 * @returns site.gov.assets 統計 { items, files, bytes, byKind, orphans, orphanFiles[], noAccessibleVersion, imageLicense }
 */
function buildAssetGov(site, { addTodo, today, allowed }) {
  setAssetRegistry(assetRegistryOf(site));
  const stats = { items: 0, files: 0, bytes: 0, byKind: { attachment: 0, image: 0, data: 0 }, orphans: 0, orphanFiles: [], noAccessibleVersion: 0, imageLicense: 0 };
  for (const item of site.all) {
    const list = (Array.isArray(item.assets) ? item.assets : []).filter((a) => a?.file);
    if (!item.gov) continue;
    const g = { count: list.length, attachments: 0, images: 0, data: 0, bytes: 0, noAccessibleVersion: [], licenseIssues: [] };
    item.gov.assets = g;
    if (!list.length) continue;
    stats.items++;
    for (const a of list) {
      stats.files++;
      if (stats.byKind[a.kind] != null) stats.byKind[a.kind]++;
      if (a.kind === 'attachment') g.attachments++; else if (a.kind === 'image') g.images++; else if (a.kind === 'data') g.data++;
      g.bytes += a.bytes ?? 0; stats.bytes += a.bytes ?? 0;
      if (needsAccessibleVersion(a)) g.noAccessibleVersion.push(a.file);
      if (a.kind === 'image') { const p = imageLicenseProblems(a, allowed); if (p.length) g.licenseIssues.push({ file: a.file, problems: p }); }
    }
    if (item.status !== 'published' || item.gov.superseded) continue;
    for (const file of g.noAccessibleVersion) {
      const a = list.find((x) => x.file === file);
      stats.noAccessibleVersion++;
      addTodo({ id: `attachment-no-accessible-version:${item.id}:${file}`, kind: 'attachment-no-accessible-version', item, file, url: assetUrl(item, file),
        dueAt: addDays(item.reviewedAt ?? today, ASSET_FIX_DAYS), severity: 'medium',
        text: `「${item.title}」的附件「${a?.label ?? file}」是 PDF 且未標示有文字層（machineReadable），也沒有可及性版本：請附同名 .md（或 .docx／.odt）並填 accessibleAlt，或確認 PDF 有文字層後改 machineReadable:true` });
    }
    for (const { file, problems } of g.licenseIssues) {
      stats.imageLicense++;
      addTodo({ id: `image-license-missing:${item.id}:${file}`, kind: 'image-license-missing', item, file, url: assetUrl(item, file),
        dueAt: addDays(item.reviewedAt ?? today, ASSET_FIX_DAYS), severity: 'medium',
        text: `「${item.title}」的圖片 ${file}：${problems.join('；')}` });
    }
  }
  const orphansById = new Map();
  for (const o of site.assetReport?.orphans ?? []) { if (!orphansById.has(o.id)) orphansById.set(o.id, []); orphansById.get(o.id).push(o); }
  for (const [id, list] of orphansById) {
    const item = site.byId.get(id);
    stats.orphans += list.length;
    stats.orphanFiles.push(...list.map((o) => ({ id, file: o.file, bytes: o.bytes ?? null })));
    addTodo({ id: `asset-orphan:${id}`, kind: 'asset-orphan', item, itemId: id, files: list.map((o) => o.file), count: list.length,
      dueAt: addDays(today, ASSET_FIX_DAYS), severity: 'low',
      text: `content/assets/${id}/ 有 ${list.length} 個檔未在 assets 宣告（${list.map((o) => o.file).join('、')}）：不會複製到網站；請宣告或刪除` });
  }
  return stats;
}

/** 階段統計：{ total, byStage, byTab, stageLabels, tabLabels }（只計 published） */
function stageStats(list, stageKey, tabKey, stageLabels, tabLabels) {
  const pub = (list ?? []).filter((x) => x.status === 'published' && x.gov);
  const byStage = Object.fromEntries(Object.keys(stageLabels).map((k) => [k, 0]));
  const byTab = Object.fromEntries(Object.keys(tabLabels).map((k) => [k, 0]));
  for (const x of pub) { byStage[x.gov[stageKey]] = (byStage[x.gov[stageKey]] ?? 0) + 1; byTab[x.gov[tabKey]] = (byTab[x.gov[tabKey]] ?? 0) + 1; }
  return { total: pub.length, byStage, byTab };
}

/** R17：職缺的 gov 欄位（Object.assign 到 item.gov） */
export function jobGov(job, today, published = job.status === 'published') {
  const stage = jobStageOf(job, today);
  const daysSinceResult = job.result?.publishedAt ? daysBetween(job.result.publishedAt, today) : null;
  const archivedStage = stage === 'result' && daysSinceResult != null && daysSinceResult > JOB_HISTORY_DAYS;
  const tab = archivedStage || stage === 'filled' || stage === 'cancelled' ? 'history'
    : stage === 'open' ? 'open' : stage === 'upcoming' ? 'upcoming' : stage === 'closed' || stage === 'screening' ? 'review' : 'result';
  const daysToDeadline = job.deadlineAt ? daysBetween(today, job.deadlineAt) : null;
  const applyOnSite = job.applyMethod === 'online' && !job.applyUrl;
  const resultDueAt = job.resultPlannedAt ? addDays(job.resultPlannedAt, JOB_RESULT_GRACE_DAYS) : null;
  const resultOverdue = !job.result && !job.manualStatus && !!resultDueAt && today > resultDueAt && ['closed', 'screening'].includes(stage);
  const waitlistExpiring = stage === 'result' ? (job.result?.waitlist ?? [])
    .filter((w) => w.validUntil && !(job.waitlistUpdates ?? []).some((u) => u.candidateNo === w.candidateNo))
    .map((w) => ({ rank: w.rank, validUntil: w.validUntil, daysLeft: daysBetween(today, w.validUntil) }))
    .filter((w) => w.daysLeft >= 0 && w.daysLeft <= WAITLIST_EXPIRING_DAYS)
    .sort((a, b) => a.validUntil.localeCompare(b.validUntil) || a.rank - b.rank) : [];
  const pii = job.result || job.waitlistUpdates?.length ? jobPiiErrors(job) : [];
  const admitted = job.result?.admitted?.length ?? 0;
  // 時間軸（模板 /careers/{slug}/ 用）：done＝已發生；current＝目前所在
  const timeline = [
    { key: 'announced', label: '公告', date: job.publishedAt },
    { key: 'apply', label: '報名期間', date: job.applyStart, endDate: job.deadlineAt },
    ...(job.examPlan ?? []).map((e, i) => ({ key: `exam-${i + 1}`, label: e.stage, date: e.date ?? null, note: e.note ?? null })),
    { key: 'result', label: '甄選結果', date: job.result?.publishedAt ?? job.resultPlannedAt ?? null, planned: !job.result },
    ...(job.waitlistUpdates ?? []).map((u, i) => ({ key: `waitlist-${i + 1}`, label: '遞補公告', date: u.date })),
  ].map((x) => ({ ...x, done: !!x.date && (x.endDate ?? x.date) < today || (x.key === 'result' && !!job.result) }));
  const currentKey = stage === 'upcoming' ? 'announced' : stage === 'open' ? 'apply' : stage === 'result' ? ((job.waitlistUpdates ?? []).length ? `waitlist-${job.waitlistUpdates.length}` : 'result')
    : stage === 'closed' || stage === 'screening' ? ([...timeline].reverse().find((x) => x.key.startsWith('exam-') && x.date && x.date <= today)?.key ?? 'apply') : null;
  for (const x of timeline) x.current = x.key === currentKey;
  const out = {
    jobStage: stage, jobStageLabel: JOB_STAGE_LABELS[stage], jobTab: tab, jobTabLabel: JOB_TAB_LABELS[tab],
    archivedStage, daysSinceResult,
    deadlineAt: job.deadlineAt ?? null, daysToDeadline,
    closed: !['upcoming', 'open'].includes(stage), closingSoon: stage === 'open' && daysToDeadline != null && daysToDeadline <= CLOSING_SOON_DAYS,
    daysToOpen: stage === 'upcoming' && job.applyStart ? daysBetween(today, job.applyStart) : null,
    applyOnSite, applyHref: job.applyUrl ?? (applyOnSite ? jobApplyPath(job) : null), applyExternal: !!job.applyUrl,
    resultDueAt, resultOverdue, waitlistExpiring,
    resultCheck: job.result ? { masked: !pii.some((e) => e.startsWith('個資閘門')), errors: pii, admitted, positions: job.positions, withinPositions: admitted <= (job.positions ?? Infinity),
      waitlist: job.result.waitlist?.length ?? 0, waitlistValid: (job.result.waitlist ?? []).every((w) => !w.validUntil || w.validUntil >= job.result.publishedAt), updates: job.waitlistUpdates?.length ?? 0 } : null,
    timeline,
  };
  out.annotations = [];
  if (published) {
    if (stage === 'closed' || stage === 'screening') out.annotations.push({ kind: 'closed', level: 'info', text: `本職缺已於 ${job.deadlineAt} 截止報名${job.result ? '' : job.resultPlannedAt ? `，甄選結果預計 ${job.resultPlannedAt} 公布` : ''}。`, href: null, path: null, deadlineAt: job.deadlineAt });
    if (stage === 'result') out.annotations.push({ kind: 'job-result', level: 'info', text: `甄選結果已於 ${job.result.publishedAt} 公告；名單只公布報名編號與遮罩姓名。`, href: null, path: `${pathOf(job)}#result` });
    if (stage === 'cancelled') out.annotations.push({ kind: 'cancelled', level: 'info', text: `本職缺已停止甄選${job.manualStatusNote ? `（${job.manualStatusNote}）` : ''}。`, href: null, path: null });
    if (stage === 'filled') out.annotations.push({ kind: 'filled', level: 'info', text: `本職缺已補實${job.manualStatusNote ? `（${job.manualStatusNote}）` : ''}。`, href: null, path: null });
  }
  return out;
}

/** R18：採購公告的 gov 欄位 */
export function tenderGov(td, today, published = td.status === 'published') {
  const stage = tenderStageOf(td, today);
  const tab = stage === 'cancelled' ? 'failed' : stage;
  const daysToDeadline = td.deadlineAt ? daysBetween(today, td.deadlineAt) : null;
  const awardDueAt = td.openingAt ? addDays(td.openingAt, TENDER_AWARD_DAYS) : null;
  const awardOverdue = stage === 'opened' && !!awardDueAt && today > awardDueAt;
  const timeline = [
    { key: 'announced', label: '公告', date: td.announcedAt },
    ...(td.briefingAt ? [{ key: 'briefing', label: '廠商說明會', date: td.briefingAt }] : []),
    { key: 'deadline', label: '投標截止', date: td.deadlineAt },
    ...(td.openingAt ? [{ key: 'opening', label: '開標', date: td.openingAt }] : []),
    { key: 'award', label: stage === 'failed' ? '流標' : stage === 'cancelled' ? '取消' : '決標', date: td.award?.date ?? null, planned: !td.award },
  ].map((x) => ({ ...x, done: x.key === 'award' ? !!td.award || stage === 'failed' || stage === 'cancelled' : !!x.date && x.date < today }));
  const currentKey = { open: 'deadline', closed: td.openingAt ? 'opening' : 'deadline', opened: 'award', awarded: 'award', failed: 'award', cancelled: 'award' }[stage];
  for (const x of timeline) x.current = x.key === currentKey;
  const out = {
    tenderStage: stage, tenderStageLabel: TENDER_STAGE_LABELS[stage], tenderTab: tab, tenderTabLabel: TENDER_TAB_LABELS[tab],
    deadlineAt: td.deadlineAt ?? null, daysToDeadline, closed: stage !== 'open', closingSoon: stage === 'open' && daysToDeadline != null && daysToDeadline <= CLOSING_SOON_DAYS,
    daysToOpening: td.openingAt ? daysBetween(today, td.openingAt) : null, awardDueAt, awardOverdue, timeline,
  };
  out.annotations = [];
  if (published) {
    if (stage === 'closed' || stage === 'opened') out.annotations.push({ kind: 'closed', level: 'info', text: `本案已於 ${td.deadlineAt} 截止投標${stage === 'opened' ? `，${td.openingAt} 開標，決標結果待公告` : td.openingAt ? `，預定 ${td.openingAt} 開標` : ''}。`, href: null, path: null, deadlineAt: td.deadlineAt });
    if (stage === 'awarded') out.annotations.push({ kind: 'awarded', level: 'info', text: `本案已於 ${td.award.date} 決標。`, href: null, path: null });
    if (stage === 'failed') out.annotations.push({ kind: 'failed', level: 'info', text: `本案流標${td.manualStatusNote ? `（${td.manualStatusNote}）` : ''}。`, href: null, path: null });
    if (stage === 'cancelled') out.annotations.push({ kind: 'cancelled', level: 'info', text: `本案已取消${td.manualStatusNote ? `（${td.manualStatusNote}）` : ''}。`, href: null, path: null });
  }
  return out;
}

/**
 * R14／R15 移轉清單 → site.migration，並把 gov.legacy 掛到 target 內容。
 * 清單來源：①主檔每一種疾病 × 模板（推導）＋同疾病的人工清單（覆蓋同 key）；②其他範圍（category）的人工清單。
 * lists[] 欄位（13.1 既有，只加不減）：id、title、scope、owner、ownerName、status（推導無頁＝'no-page'）、reviewedAt、nextReviewAt、
 *   legacyRoot、showLegacyUntil、show、sourceNote、summary、file、stats、items；
 *   第六輪新增：slug、derived（整份由模板推導）、curated（有人工清單）、hasPage、disease、diseaseName、legalCategory、pageId、pagePath、
 *   site（舊站語言版）、extends、templateId、derivedItems、curatedItems、apiPath。
 * lists[].items[] 擴充欄位：listId、owner、fromPath（去網域與 hash）、pattern（含 {id} 佔位）、statusLabel、
 *   targetType／targetTitle／targetPath、to（實際轉址目的地：target 路徑＋anchor；target 為失效版文件 ⇒ 現行版）、toId、show；
 *   第六輪：derived（此筆由模板推導）、mapTo、relatedIds（related 命中的全部內容 id）。
 *   第九輪：newPath（去處為路徑而非內容 id；to＝newPath＋anchor，不掛 gov.legacy、不進 byTarget）。
 */
export const MIGRATION_TEMPLATE_DISEASE = 'migration-template.disease';
/** 待辦優先度依法定類別（14.1：第一、二類高） */
export const MIGRATION_SEVERITY_BY_CATEGORY = { 1: 'high', 2: 'high', 3: 'medium', 4: 'low', 5: 'low' };
const MIGRATION_DUE_DAYS_BY_SEVERITY = { high: 30, medium: MIGRATION_PENDING_DAYS, low: 90 };
const MAPTO_LABELS = {
  faq: 'Q&A', document: '文件', media: '影音', labtest: '檢驗項目', dataset: '資料集', news: '新聞稿', publication: '出版品', topic: '專區', service: '申請服務',
  manual: '工作手冊', guideline: '指引', 'case-definition': '病例定義', recommendation: '建議', form: '表單',
};
const BLOCK_LABELS = { 'what-to-do': '我該怎麼辦', symptoms: '症狀', transmission: '傳染方式', prevention: '預防', treatment: '治療', vaccine: '疫苗', situation: '疫情與統計', faq: '常見問題' };
const hasValue = (v) => v != null && v !== '' && !(Array.isArray(v) && !v.length) && !(typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length);

/** 內容關聯的疾病（diseases[]、labtest.disease、出版品篇目、專區 contentIds；與 emit-api diseasesOf 同規則） */
function linkedDiseases(item) {
  const set = new Set(item.diseases ?? []);
  if (item.disease) set.add(item.disease);
  for (const a of item.articles ?? []) for (const d of a.diseases ?? []) set.add(d);
  for (const id of item.contentIds ?? []) if (String(id).startsWith('disease.')) set.add(id);
  return set;
}

/** mapTo → 命中結果 { status, target, anchor, toPath, relatedIds, note } 或 null（未命中） */
export function resolveMapTo(site, dm, page, mapTo) {
  if (!page || !mapTo) return null;
  switch (mapTo.kind) {
    case 'disease-page':
      return { status: 'migrated', target: page.id, note: '移轉為新站疾病頁' };
    case 'disease-block': {
      const b = (page.blocks ?? []).find((x) => x.key === mapTo.block);
      const filled = b && b.status !== 'pending' && (String(b.markdown ?? '').trim() || b.warning || b.cards?.length || b.datasets?.length);
      return filled ? { status: 'merged', target: page.id, anchor: mapTo.block, note: `併入疾病頁「${b.heading ?? BLOCK_LABELS[mapTo.block] ?? mapTo.block}」區塊` } : null;
    }
    case 'master-field': {
      const v = page[mapTo.field] ?? dm[mapTo.field];
      return hasValue(v) ? { status: 'merged', target: page.id, anchor: mapTo.anchor, note: `併入疾病頁（結構化欄位 ${mapTo.field}）` } : null;
    }
    case 'page': {
      const anchor = mapTo.anchor ? mapTo.anchor.replace(/\{slug\}/g, dm.slug) : undefined;
      const content = site.all.find((i) => i.status === 'published' && !i.gov?.publishScheduled && pathOf(i) === mapTo.path) ?? null;
      return { status: 'merged', target: content?.id, anchor, toPath: mapTo.path, note: `併入站內共用頁 ${mapTo.path}${anchor ? `#${anchor}` : ''}` };
    }
    case 'related': {
      const docRefs = new Set([page.professional?.caseDefinitionDoc, page.professional?.manualDoc, ...(page.relatedDocuments ?? [])].filter(Boolean));
      const dsRefs = new Set([...(dm.datasets ?? []), ...(page.blocks ?? []).flatMap((b) => b.datasets ?? [])]);
      const hits = site.all.filter((i) => {
        if (i.type !== mapTo.type) return false;
        if (i.status !== 'published' || i.gov?.superseded || i.gov?.publishScheduled) return false; // 排程中（R21）還沒上線
        if (mapTo.type === 'news' && NOTICE_TYPES.has(i.newsType)) return false;
        if (mapTo.docType && i.docType !== mapTo.docType) return false;
        if (mapTo.mediaType && !mapTo.mediaType.includes(i.mediaType)) return false;
        if (mapTo.pubType && i.pubType !== mapTo.pubType) return false;
        if (linkedDiseases(i).has(dm.id)) return true;
        if (i.type === 'document' && (docRefs.has(i.id) || docRefs.has(i.family))) return true;
        if (i.type === 'dataset' && dsRefs.has(i.id)) return true;
        return false;
      }).sort((a, b) => (b.isCurrent === true) - (a.isCurrent === true) || String(b.reviewedAt ?? '').localeCompare(String(a.reviewedAt ?? '')) || a.id.localeCompare(b.id));
      if (!hits.length) return null;
      const label = MAPTO_LABELS[mapTo.docType] ?? MAPTO_LABELS[mapTo.type] ?? mapTo.type;
      if (mapTo.into === 'disease-page') return { status: 'merged', target: page.id, anchor: mapTo.anchor, relatedIds: hits.map((h) => h.id), note: `併入疾病頁${mapTo.anchor ? `「${BLOCK_LABELS[mapTo.anchor] ?? mapTo.anchor}」` : ''}（新站有 ${hits.length} 則${label}）` };
      return { status: 'migrated', target: hits[0].id, relatedIds: hits.map((h) => h.id), note: `移轉為「${hits[0].title}」${hits.length > 1 ? `（另有 ${hits.length - 1} 則相關${label}）` : ''}` };
    }
    default: return null;
  }
}

/** 模板一筆 → 某疾病的推導項 */
function deriveItem(site, dm, page, t) {
  const base = {
    key: t.key, oldTitle: t.oldTitle, oldPath: `${dm.name}／${t.oldPath ?? t.oldTitle}`, oldUrl: t.oldUrlPattern, oldType: t.oldType,
    verified: false, derived: true, mapTo: t.mapTo, newRequirements: t.newRequirements ?? [],
  };
  if (!page) return { ...base, status: 'pending', note: '疾病頁尚未建立；建立後依模板自動對應' };
  const hit = resolveMapTo(site, dm, page, t.mapTo);
  if (!hit) {
    const m = t.mapTo ?? {};
    const want = m.kind === 'disease-block' ? `疾病頁「${BLOCK_LABELS[m.block] ?? m.block}」區塊尚無內容`
      : m.kind === 'master-field' ? `疾病頁與主檔尚無 ${m.field}`
      : m.kind === 'related' ? `新站尚無關聯本疾病的${MAPTO_LABELS[m.docType] ?? MAPTO_LABELS[m.type] ?? m.type}`
      : '新站尚無對應';
    return { ...base, status: 'pending', note: `${want}（模板推導）` };
  }
  const { toPath, ...rest } = hit;
  const out = { ...base, ...Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)) };
  if (toPath) out.toPath = toPath;
  return out;
}

/** 主檔一種疾病 → 清單原料（模板推導＋人工覆蓋） */
function composeDiseaseList(site, dm, template, manual) {
  const pageRaw = site.byId.get(dm.id);
  const page = pageRaw?.type === 'disease' && pageRaw.status === 'published' ? pageRaw : null;
  const tplId = manual?.extends ?? MIGRATION_TEMPLATE_DISEASE;
  const useTpl = tplId !== 'none' ? template : null; // 目前只有疾病模板；extends 指向不存在的模板由 validate 擋下
  const omit = new Set(manual?.omit ?? []);
  const manualByKey = new Map((manual?.items ?? []).map((it) => [it.key, it]));
  // 人工例外已指向同一份新站內容（例如疫苗專區的作業手冊＝模板「工作手冊」位置）⇒ 推導項標 coveredBy，狀態跟例外走，不再各算一筆
  const manualByTarget = new Map((manual?.items ?? []).filter((it) => it.target && it.target !== page?.id).map((it) => [it.target, it]));
  const items = [];
  const seen = new Set();
  for (const t of useTpl?.items ?? []) {
    if (manualByKey.has(t.key)) { items.push({ ...manualByKey.get(t.key), derived: false }); seen.add(t.key); continue; }
    if (omit.has(t.key)) continue;
    const d = deriveItem(site, dm, page, t);
    const cover = d.target && d.target !== page?.id ? manualByTarget.get(d.target) : null;
    items.push(cover ? { ...d, status: cover.status, coveredBy: cover.key, note: `模板位置已由人工例外「${cover.oldTitle}」涵蓋（同一份新站內容 ${d.target}），不另計` } : d);
  }
  for (const it of manual?.items ?? []) if (!seen.has(it.key)) items.push({ ...it, derived: false });
  const status = !page ? (manual?.status === 'archived' ? 'archived' : 'no-page') : (manual?.status ?? 'published');
  return {
    raw: manual ?? null,
    id: manual?.id ?? `migration.${dm.slug}`,
    slug: manual ? String(manual.id).replace(/^migration\./, '') : dm.slug,
    title: manual?.title ?? `${dm.name}（舊站疾病頁）→ 新站`,
    scope: manual?.scope ?? { kind: 'disease', disease: dm.id },
    owner: manual?.owner ?? dm.owner ?? page?.owner ?? useTpl?.owner ?? 'unit.oasis',
    status,
    reviewedAt: manual?.reviewedAt ?? useTpl?.reviewedAt ?? null,
    reviewPeriodMonths: manual?.reviewPeriodMonths ?? useTpl?.reviewPeriodMonths ?? 0,
    legacyRoot: manual?.legacyRoot ?? useTpl?.legacyRoot ?? null,
    showLegacyUntil: manual?.showLegacyUntil ?? useTpl?.showLegacyUntil ?? null,
    sourceNote: manual?.sourceNote ?? useTpl?.sourceNote ?? null,
    summary: manual?.summary ?? null,
    file: manual?.__file ?? null,
    derived: !manual, curated: !!manual, hasPage: !!page, disease: dm.id, diseaseName: dm.name, legalCategory: dm.legalCategory ?? null,
    pageId: page?.id ?? null, pagePath: page ? pathOf(page) : null, site: 'zh-TW',
    extends: useTpl ? useTpl.id : 'none', templateId: useTpl?.id ?? null,
    items,
  };
}

function buildMigration(site, { addTodo, unitName }) {
  const today = site.today;
  const template = (site.migrationTemplates ?? []).find((t) => t.id === MIGRATION_TEMPLATE_DISEASE) ?? null;
  const manualByDisease = new Map();
  const otherManual = [];
  for (const raw of site.migrationLists ?? []) {
    const d = raw.scope?.kind === 'disease' ? raw.scope.disease : null;
    if (d && site.diseaseMasterById.has(d) && !manualByDisease.has(d)) manualByDisease.set(d, raw);
    else otherManual.push(raw);
  }
  const sources = [];
  for (const dm of site.master.diseases ?? []) sources.push(composeDiseaseList(site, dm, template, manualByDisease.get(dm.id)));
  for (const raw of otherManual) {
    const dm = raw.scope?.disease ? site.diseaseMasterById.get(raw.scope.disease) : null;
    sources.push({
      raw, id: raw.id, slug: String(raw.id).replace(/^migration\./, ''), title: raw.title, scope: raw.scope ?? null, owner: raw.owner, status: raw.status,
      reviewedAt: raw.reviewedAt ?? null, reviewPeriodMonths: raw.reviewPeriodMonths ?? 0, legacyRoot: raw.legacyRoot ?? null, showLegacyUntil: raw.showLegacyUntil ?? null,
      sourceNote: raw.sourceNote ?? null, summary: raw.summary ?? null, file: raw.__file ?? null,
      derived: false, curated: true, hasPage: null, disease: dm?.id ?? null, diseaseName: dm?.name ?? null, legalCategory: dm?.legalCategory ?? null,
      pageId: null, pagePath: null, site: raw.scope?.site ?? 'zh-TW', extends: raw.extends ?? 'none', templateId: null,
      items: (raw.items ?? []).map((it) => ({ ...it, derived: false })),
    });
  }

  const lists = [];
  const byTarget = new Map();
  const byDisease = new Map();
  const ZERO = () => ({ migrated: 0, merged: 0, archived: 0, pending: 0, dropped: 0, verified: 0, unverified: 0, total: 0 });
  const stats = { ...ZERO(), lists: 0, derived: 0, curated: 0, noPage: 0, hasPage: 0, derivedItems: 0, curatedItems: 0 };
  const pending = [];
  for (const src of sources) {
    const showUntil = src.showLegacyUntil ?? null;
    const show = !showUntil || today <= showUntil;
    const lstats = ZERO();
    const items = src.items.map((it) => {
      const target = it.target ? site.byId.get(it.target) ?? null : null;
      const dest = target?.gov?.superseded ? site.byId.get(target.gov.currentId) ?? target : target;
      const anchor = it.anchor ? `#${it.anchor}` : '';
      // newPath：去處不是內容 id，而是系統產生頁／功能頁（例：/travel/JP/）；target 優先
      const to = dest ? (pathOf(dest).includes('#') ? pathOf(dest) : `${pathOf(dest)}${anchor}`) : it.toPath ? `${it.toPath}${anchor}` : it.newPath ? `${it.newPath}${anchor}` : null;
      const owner = it.owner ?? src.owner;
      const { toPath, ...rest } = it;
      return {
        ...rest, listId: src.id, owner, ownerName: unitName(owner),
        statusLabel: MIGRATION_STATUS_LABELS[it.status] ?? it.status,
        fromPath: legacyPathOf(it.oldUrl), pattern: isLegacyPattern(it.oldUrl),
        targetType: target?.type ?? null, targetTitle: target?.title ?? null, targetPath: target ? pathOf(target) : toPath ?? it.newPath ?? null,
        to, toId: dest?.id ?? null, redirectsToCurrent: !!(dest && target && dest !== target),
        show,
      };
    });
    for (const it of items) {
      for (const st of [stats, lstats]) {
        st.total++;
        if (st[it.status] !== undefined) st[it.status]++;
        if (it.verified) st.verified++; else st.unverified++;
      }
      if (it.derived) stats.derivedItems++; else stats.curatedItems++;
      if (it.target) {
        if (!byTarget.has(it.target)) byTarget.set(it.target, []);
        byTarget.get(it.target).push(it);
      }
      if (it.status === 'pending') pending.push(it);
    }
    const list = {
      id: src.id, title: src.title, scope: src.scope, owner: src.owner, ownerName: unitName(src.owner), status: src.status,
      reviewedAt: src.reviewedAt, nextReviewAt: src.reviewPeriodMonths > 0 && src.reviewedAt ? addMonths(src.reviewedAt, src.reviewPeriodMonths) : null,
      legacyRoot: src.legacyRoot, showLegacyUntil: showUntil, show, sourceNote: src.sourceNote, summary: src.summary,
      file: src.file, stats: lstats, items,
      slug: src.slug, derived: src.derived, curated: src.curated, hasPage: src.hasPage, disease: src.disease, diseaseName: src.diseaseName,
      legalCategory: src.legalCategory, pageId: src.pageId, pagePath: src.pagePath, site: src.site, extends: src.extends, templateId: src.templateId,
      derivedItems: items.filter((i) => i.derived).length, curatedItems: items.filter((i) => !i.derived).length,
      apiPath: `/v1/migration/${src.slug}.json`,
    };
    lists.push(list);
    stats.lists++;
    if (list.derived) stats.derived++; else stats.curated++;
    if (list.status === 'no-page') stats.noPage++;
    if (list.hasPage) stats.hasPage++;
    if (list.disease && !byDisease.has(list.disease)) byDisease.set(list.disease, list);

    // 待辦聚合（14.1）：每份清單一則
    const pend = items.filter((i) => i.status === 'pending');
    if (pend.length && site.unitById.has(list.owner) && list.status !== 'archived') {
      const severity = list.legalCategory ? MIGRATION_SEVERITY_BY_CATEGORY[list.legalCategory] ?? 'medium' : 'medium';
      const explicit = pend.map((i) => i.dueAt).filter(Boolean).sort()[0];
      const name = list.diseaseName ?? list.title;
      list.todoId = `migration-pending:${list.id}`;
      addTodo({
        id: list.todoId, kind: 'migration-pending', itemId: list.id, itemType: 'migration', itemTitle: list.title,
        owner: list.owner, dueAt: explicit ?? addDays(list.reviewedAt ?? today, MIGRATION_DUE_DAYS_BY_SEVERITY[severity]), href: '/admin/migration/', severity,
        listId: list.id, count: pend.length, pendingKeys: pend.map((i) => i.key), disease: list.disease, legalCategory: list.legalCategory, noPage: list.status === 'no-page', derived: list.derived,
        text: list.status === 'no-page'
          ? `${name}：疾病頁尚未建立，${pend.length} 個舊頁待移轉`
          : `${name}：${pend.length} 個舊頁待移轉${pend.length <= 3 ? `（${pend.map((i) => i.oldTitle).join('、')}）` : ''}`,
      });
    }
  }
  // 反向掛到新站內容：item.gov.legacy（模板「本頁取代舊網站 N 個頁面」）
  const listById = new Map(lists.map((l) => [l.id, l]));
  for (const item of site.all) {
    const its = byTarget.get(item.id);
    if (!item.gov) continue;
    if (!its?.length) { item.gov.legacy = null; continue; }
    const until = its.map((x) => listById.get(x.listId)?.showLegacyUntil).filter(Boolean).sort().at(-1) ?? null;
    item.gov.legacy = {
      count: its.length, urls: its.map((x) => x.oldUrl), items: its,
      show: its.some((x) => x.show), showUntil: until, showLegacyUntil: until, lists: [...new Set(its.map((x) => x.listId))],
    };
  }
  return { lists, byTarget, byDisease, stats, pending, template: template ? { id: template.id, title: template.title, items: template.items.length, file: template.__file ?? null } : null, statusLabels: MIGRATION_STATUS_LABELS, requirementLabels: MIGRATION_REQUIREMENT_LABELS };
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
  // 第七輪：職缺與採購正文（不含 result／waitlistUpdates：名單不進稽核文字與索引）
  for (const k of ['duties', 'qualifications', 'requiredDocuments', 'scope', 'specialTerms']) for (const x of item[k] ?? []) parts.push(x);
  parts.push(item.salaryNote, item.contractPeriod);
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
    noticesClosed: all.filter((i) => i.gov.notice && i.gov.closed).length,
    noticesClosingSoon: all.filter((i) => i.gov.closingSoon && i.status === 'published').length,
    topicsEnded: all.filter((i) => i.gov.ended).length,
    media: (site.collections.media ?? []).length,
    mediaOutdated: all.filter((i) => i.gov.mediaOutdated).length,
    mediaNoTranscript: (site.collections.media ?? []).filter((m) => !m.gov.hasTranscript).length,
    linksTotal: site.gov.linkHealth.total,
    linksBroken: site.gov.linkHealth.broken,
    linksUnchecked: site.gov.linkHealth.unchecked,
    labtestsInconsistent: (site.collections.labtests ?? []).filter((l) => l.gov.labtestCheck && !l.gov.labtestCheck.consistent).length,
    migrationTotal: site.migration?.stats.total ?? 0,
    migrationPending: site.migration?.stats.pending ?? 0,
    migrationUnverified: site.migration?.stats.unverified ?? 0,
    // 第七輪
    jobs: site.gov.jobs?.total ?? 0, jobsOpen: site.gov.jobs?.byStage.open ?? 0, jobsByStage: site.gov.jobs?.byStage ?? {},
    jobsResultOverdue: (site.collections.jobs ?? []).filter((j) => j.gov?.resultOverdue).length,
    tenders: site.gov.tenders?.total ?? 0, tendersOpen: site.gov.tenders?.byStage.open ?? 0, tendersByStage: site.gov.tenders?.byStage ?? {},
    tendersAwardOverdue: (site.collections.tenders ?? []).filter((x) => x.gov?.awardOverdue).length,
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
  const closedUnarchived = pub.filter((i) => i.gov.notice && i.gov.closed && i.gov.closedDays > CLOSED_ARCHIVE_DAYS); // 職缺／標案保留歷史，不計

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
