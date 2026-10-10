// v1/*.json 輸出（ARCHITECTURE.md 4.2、附錄 B）
// 外殼：{ meta: { api, generatedAt, buildDate, license, source, docs, etag, lastModified, count?, ... }, data }
// 靜態站無法送 ETag／Last-Modified header → meta.etag（data 內容 sha1 前 12 碼）與 meta.lastModified（集合最大 reviewedAt）。
import { createHash } from 'node:crypto';
import { config, siteOrigin } from '../../site.config.mjs';
import { pathOf, mdPathOf, WHITELIST_REASON_LABELS, LIFECYCLE_LABELS, TODO_KIND_LABELS, NOTICE_TYPES, legacyPathOf, isLegacyPattern, JOB_STAGE_LABELS, TENDER_STAGE_LABELS, JOB_TAB_LABELS, TENDER_TAB_LABELS } from './governance.mjs';
import { buildOpenApi } from './openapi.mjs';
import { citationOf, citationEnOf } from '../../src/client/bulletin-rules.js';
import { assetSummary, assetUrl } from './assets.mjs';
// 第九輪（ARCHITECTURE 17.1）：對外輸出一律經 isPublic()（published［＋archived］且 publishAt 已到）；emitApi 一進來就換成 publicView（排程中內容整筆消失，含治理待辦與版本鏈）
import { isPublic, nowOf, publicView } from './lanes.mjs';

export const etagOf = (data) => createHash('sha1').update(JSON.stringify(data) ?? 'null').digest('hex').slice(0, 12);
const absUrl = (p) => (p == null ? null : /^https?:/.test(p) ? p : `${siteOrigin()}${p}`);
const maxDate = (dates) => dates.filter(Boolean).sort().at(-1) ?? null;

/** 從資料推算 lastModified：陣列取各筆 reviewedAt／lastUpdated／publishedAt 最大值 */
export function lastModifiedOf(data) {
  const pick = (x) => (x && typeof x === 'object' ? x.reviewedAt ?? x.governance?.reviewedAt ?? x.lastUpdated ?? x.publishedAt ?? x.updatedAt ?? null : null);
  if (Array.isArray(data)) return maxDate(data.map(pick));
  return pick(data);
}

export function wrap(site, data, extra = {}, top = {}) {
  site.generatedAt ??= new Date().toISOString();
  const meta = {
    api: 'v1', generatedAt: site.generatedAt, buildDate: site.today, license: 'OGDL-1.0', licenseUrl: 'https://data.gov.tw/license',
    source: `${siteOrigin()}/`, docs: `${siteOrigin()}/developers/`, openapi: `${siteOrigin()}/openapi.json`,
    etag: etagOf(data), lastModified: lastModifiedOf(data) ?? site.today,
    ...(Array.isArray(data) ? { count: data.length } : {}),
    ...extra,
  };
  return JSON.stringify({ meta, data, ...top }, null, 2);
}

/** 每筆內容的治理摘要（API、catalog 共用） */
export function govSummary(item) {
  const g = item.gov;
  return {
    owner: item.owner, ownerName: g.ownerName, steward: item.steward ?? null,
    reviewedAt: item.reviewedAt, reviewPeriodMonths: item.reviewPeriodMonths, nextReviewAt: g.nextReviewAt, daysToReview: g.daysToReview, overdue: g.overdue, dueSoon: g.dueSoon,
    status: item.status, lifecycle: g.lifecycle, lifecycleLabel: g.lifecycleLabel,
    whitelist: g.whitelist.effective, whitelistTier: g.whitelist.tier, whitelistPublic: g.whitelist.public, whitelistReasons: g.whitelist.reasons, whitelistReasonLabels: g.whitelist.reasonLabels,
    isCurrent: g.isCurrent, superseded: g.superseded, supersededBy: g.supersededBy, currentId: g.currentId, noindex: g.noindex,
    stale: g.stale, basisRevisions: g.basisRevisions, predatesBasis: g.predatesBasis,
    annotations: g.annotations, reverseAuditHits: g.reverseAuditHits.length,
    ...(g.deadlineAt !== undefined ? { deadlineAt: g.deadlineAt, daysToDeadline: g.daysToDeadline, closed: g.closed, closingSoon: g.closingSoon } : {}),
    ...(g.ended !== undefined ? { ended: g.ended, upcoming: g.upcoming } : {}),
    ...(g.mediaOutdated !== undefined ? { mediaOutdated: g.mediaOutdated, hasTranscript: g.hasTranscript } : {}),
    ...(g.campaignStatus ? { campaignStatus: g.campaignStatus } : {}),
    ...(g.linkHealth?.total ? { linkHealth: g.linkHealth } : {}),
    ...(g.labtestCheck ? { labtestCheck: g.labtestCheck } : {}),
    ...(g.jobStage ? { jobStage: g.jobStage, jobStageLabel: g.jobStageLabel, jobTab: g.jobTab, archivedStage: g.archivedStage, resultOverdue: g.resultOverdue, resultDueAt: g.resultDueAt, applyHref: g.applyHref } : {}),
    ...(g.tenderStage ? { tenderStage: g.tenderStage, tenderStageLabel: g.tenderStageLabel, tenderTab: g.tenderTab, awardOverdue: g.awardOverdue, awardDueAt: g.awardDueAt } : {}),
    license: item.license, licenseNote: item.licenseNote ?? null, sensitivity: item.sensitivity, sourceHash: item.sourceHash,
    languages: item.languages, translationStale: g.translationStale, renderableLangs: g.renderableLangs,
  };
}

/** 內容的 API 表示：去掉 __file 與內部 gov；i18n 原文保留；加 governance、url、md */
export function apiItem(item) {
  const { __file, gov, ...rest } = item;
  const path = pathOf(item);
  const md = mdPathOf(item);
  // 第八輪（16.1）：assets 每筆加公開網址（/files/{id}/{file}，不含語言前綴）
  if (Array.isArray(rest.assets)) rest.assets = rest.assets.map((a) => (a?.file ? { ...a, url: absUrl(assetUrl(item, a)) } : a));
  return { ...rest, url: absUrl(path), path, md: md ? absUrl(md) : null, governance: govSummary(item) };
}
const strip = apiItem;
const noFile = (o) => { if (!o || typeof o !== 'object') return o; const { __file, ...r } = o; return r; };
const brief = (i) => ({ id: i.id, type: i.type, title: i.title, summary: i.summary, url: absUrl(pathOf(i)), path: pathOf(i), reviewedAt: i.reviewedAt, owner: i.owner, ownerName: i.gov.ownerName, lifecycle: i.gov.lifecycle, whitelist: i.gov.whitelist.effective });

export const CATEGORY_OF = {
  disease: 'content-page', faq: 'content-page', vaccine: 'content-page', clarification: 'content-page', page: 'content-page', banner: 'content-page',
  news: 'press', letter: 'press', document: 'document-library',
  media: 'media', topic: 'content-page', service: 'content-page', publication: 'document-library', labtest: 'content-page', research: 'document-library',
  job: 'press', tender: 'press',
};
/** 七類資產（7.7 第 1 點：原五類＋新聞稿、影音宣導素材） */
export const ASSET_CATEGORIES = {
  'open-dataset': '開放資料集', 'stats-system': '統計查詢系統', 'structured-table': '結構化表格', 'document-library': '文件庫',
  'content-page': '內容頁', press: '新聞稿／公告', media: '影音宣導素材',
};
/** 內容的關聯疾病（diseases[]、labtest.disease、出版品篇目、專區 contentIds） */
export function diseasesOf(item) {
  const set = new Set(item.diseases ?? []);
  if (item.disease) set.add(item.disease);
  for (const a of item.articles ?? []) for (const d of a.diseases ?? []) set.add(d);
  for (const id of item.contentIds ?? []) if (String(id).startsWith('disease.')) set.add(id);
  return [...set];
}

/**
 * 舊網址正規化 key（v1/legacy-map.json 的 key；/legacy/、404 頁與 analyze-404-log 共用同一規則）：
 * 去網域、去 hash、百分比編碼統一（decodeURI 後 encodeURI，失敗保留原樣）、小寫、去尾斜線（根目錄保留 "/"）、
 * query 去掉 page 參數（其餘參數保留原順序；無剩餘參數則去掉 "?"）。
 *   https://www.cdc.gov.tw/Bulletin/List/AbC/?page=2  →  /bulletin/list/abc
 */
export function legacyKey(input) {
  let s = String(input ?? '').trim().replace(/#.*$/, '').replace(/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i, '');
  try { s = encodeURI(decodeURI(s)).replace(/%7B/gi, '{').replace(/%7D/gi, '}'); } catch { /* 編碼不完整：保留原字串 */ }
  const i = s.indexOf('?');
  let p = (i < 0 ? s : s.slice(0, i)) || '/';
  if (!p.startsWith('/')) p = `/${p}`;
  p = p.replace(/\/+$/, '') || '/';
  const qs = (i < 0 ? '' : s.slice(i + 1)).split('&').filter((kv) => kv && kv.split('=')[0].toLowerCase() !== 'page');
  return `${p}${qs.length ? `?${qs.join('&')}` : ''}`.toLowerCase();
}

/** 舊網址是否屬現行官網（同網域換站才轉址；其他網域的 legacyUrls 不進伺服器對照檔） */
const isLegacyHost = (url) => {
  const m = String(url ?? '').match(/^https?:\/\/([^/?#]+)/i);
  if (!m) return String(url ?? '').startsWith('/');
  try { return m[1].toLowerCase() === new URL(config.legacyOrigin).host.toLowerCase(); } catch { return false; }
};

/**
 * 新站內部搬家（kind: moved）：內容換型別後的舊新站路徑 → 新路徑（第七輪：recruit／procurement 新聞 → job／tender）。
 * legacyIds 只支援 news.*（validate 檢查）：舊路徑 /news/{slug}/。
 */
export function movedRedirects(site) {
  const out = [];
  const now = nowOf(site);
  for (const item of site.all) {
    if (!isPublic(item, now, { archived: true })) continue;
    for (const old of item.legacyIds ?? []) {
      const from = pathOf({ type: String(old).split('.')[0], id: old });
      if (!from || from === '/' || from === pathOf(item)) continue;
      out.push({ from, fromPath: from, to: pathOf(item), toUrl: absUrl(pathOf(item)), status: 301, kind: 'moved', itemId: item.id, legacyId: old,
        note: '內容換型別搬家（第七輪：人才招募 → /careers/、採購公告 → /procurement/）；舊路徑轉到新路徑' });
    }
  }
  return out;
}

/** 301 對照表：失效版 → 現行版；family 穩定網址 → 現行版；現行官網 legacyUrls → 新路徑；移轉清單（kind: migration）舊頁 → 新頁；新站內部搬家（kind: moved） */
export function buildRedirects(site) {
  const out = [];
  // 移轉清單（ARCHITECTURE 13.1）：from＝舊網址去網域與 hash；to＝target 路徑＋anchor（target 為失效版 ⇒ 現行版；無 target 有 newPath ⇒ newPath，itemId null）。
  // 含 {id} 佔位者 pattern:true（只是 URL 模式），不進伺服器對照檔與 legacy-map，只進文件。dropped／無 target 的 pending 不轉址。
  const migrationKeys = new Set();
  const migration = [];
  for (const list of site.migration?.lists ?? []) {
    for (const it of list.items) {
      if (!it.to || it.status === 'dropped') continue;
      const e = { from: it.fromPath, to: it.to, toUrl: absUrl(it.to), status: 301, kind: 'migration', itemId: it.toId, listId: list.id, key: it.key,
        oldUrl: it.oldUrl, oldTitle: it.oldTitle, migrationStatus: it.status, verified: !!it.verified, pattern: !!it.pattern,
        ...(it.redirectsToCurrent ? { currentId: it.toId, archivedAt: it.targetPath, targetId: it.target } : {}),
        ...(it.newPath && !it.target ? { newPath: it.newPath, targetId: null } : {}) };
      migration.push(e);
      migrationKeys.add(legacyKey(e.from));
    }
  }
  for (const f of site.gov.families) {
    const cur = f.current ? site.byId.get(f.current) : null;
    if (!cur) continue;
    out.push({ from: `/documents/${f.family.replace(/^doc\./, '')}/`, to: pathOf(cur), toUrl: absUrl(pathOf(cur)), status: 302, kind: 'family-latest', itemId: cur.id, note: '版本族穩定網址，永遠指向現行版' });
    for (const v of f.versions) {
      if (!v.superseded) continue;
      out.push({ from: v.href, to: pathOf(cur), toUrl: absUrl(pathOf(cur)), status: 301, kind: 'superseded', itemId: v.id, currentId: cur.id, retained: true,
        note: '失效版：原頁保留存取（noindex＋頁首警示），搜尋與 AI 引用一律以現行版為準；正式站外部舊連結以 301 轉址' });
    }
  }
  const now = nowOf(site);
  for (const item of site.all) {
    if (!isPublic(item, now, { archived: true })) continue;
    const target = item.gov.superseded ? site.byId.get(item.gov.currentId) ?? item : item;
    for (const from of item.legacyUrls ?? []) {
      const fromPath = legacyPathOf(from);
      if (migrationKeys.has(legacyKey(fromPath))) continue; // 已由移轉清單對照（較精確：含錨點、狀態、核對）
      out.push({ from, fromPath, to: pathOf(target), toUrl: absUrl(pathOf(target)), status: 301, kind: 'legacy', itemId: item.id, pattern: isLegacyPattern(from), ...(target !== item ? { currentId: target.id, archivedAt: pathOf(item) } : {}) });
    }
  }
  out.push(...migration);
  out.push(...movedRedirects(site));
  return out;
}

/**
 * 伺服器對照檔與 legacy-map 用的轉址清單（純由 redirects.json 推導）：
 * 只取舊網址 → 新網址的 301（kind migration／legacy，第七輪加 moved：新站內部換型別搬家），排除 pattern（{id} 佔位）、非現行官網網域、根目錄 "/"、
 * 轉到自己；同一正規化 key 有多個不同目的地 ⇒ 移轉清單優先，否則列為 ambiguous 不輸出（避免把舊總覽頁導到任一子頁）。
 * 不含 superseded（失效版頁面保留存取）與 family-latest（新站內部 302，由部署設定另處理）。
 */
export function serverRedirects(redirects) {
  const groups = new Map();
  for (const r of redirects) {
    if (r.status !== 301 || !['migration', 'legacy', 'moved'].includes(r.kind) || r.pattern) continue;
    const src = r.kind === 'migration' ? r.oldUrl ?? r.from : r.from;
    if (!isLegacyHost(src)) continue;
    const from = r.fromPath ?? legacyPathOf(r.from);
    const key = legacyKey(from);
    if (key === '/' || key === legacyKey(r.to)) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ ...r, from, key });
  }
  const entries = [], ambiguous = [];
  for (const [key, rs] of groups) {
    const mig = rs.filter((r) => r.kind === 'migration');
    const pool = mig.length ? mig : rs;
    const tos = [...new Set(pool.map((r) => r.to))];
    if (tos.length > 1) { ambiguous.push({ key, from: pool[0].from, candidates: tos, itemIds: [...new Set(pool.map((r) => r.itemId))] }); continue; }
    const r = pool[0];
    entries.push({ key, from: r.from, to: r.to, status: 301, kind: r.kind, itemId: r.itemId, verified: r.kind === 'migration' ? !!r.verified : null, listId: r.listId ?? null });
  }
  entries.sort((a, b) => a.key.localeCompare(b.key));
  ambiguous.sort((a, b) => a.key.localeCompare(b.key));
  return { entries, ambiguous };
}

const reEscape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const xmlEscape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const splitQuery = (from) => { const i = from.indexOf('?'); return i < 0 ? [from, ''] : [from.slice(0, i), from.slice(i + 1)]; };
function serverHeader(site, entries, ambiguous, comment, extra = []) {
  const unverified = entries.filter((e) => e.verified === false).length;
  return [
    `${comment} 舊網址 → 新網址 301 對照（由 v1/redirects.json 自動產生，請勿手改；ARCHITECTURE 13.1）`,
    `${comment} 產生日：${site.today}；${entries.length} 筆（其中移轉清單未核對 verified:false ${unverified} 筆，上線前請權責單位確認）`,
    `${comment} 不含：{id} 佔位的 URL 模式、失效版文件頁（原頁保留）、版本族穩定網址（302）；同一舊網址對到多個新頁者 ${ambiguous.length} 筆不輸出`,
    `${comment} 目標路徑不含 basePath（正式站部署於網域根）；比對不分大小寫`,
    ...extra.map((x) => `${comment} ${x}`),
  ];
}

/** Nginx：map $request_uri → 新網址（引號包住，避免 # 被當成註解） */
export function toNginxMap(site, { entries, ambiguous }, gone = []) {
  const lines = serverHeader(site, entries, ambiguous, '#', [
    '用法（http 區塊）：map $request_uri $cdc_new_uri { default ""; include /etc/nginx/redirects/nginx.map; }',
    '        （server 區塊）：if ($cdc_new_uri = "410") { return 410; } if ($cdc_new_uri) { return 301 $cdc_new_uri; }',
    `值為 "410" 者＝已移除、不轉址（移轉清單 status: dropped），共 ${(gone ?? []).filter((g) => !g.pattern).length} 筆`,
  ]);
  const nginxRe = (from) => { const [p, q] = splitQuery(from); return q ? `^${reEscape(p)}/?\\?${reEscape(q)}(?:&.*)?$` : `^${reEscape(p.replace(/\/+$/, ''))}/?(?:\\?.*)?$`; };
  for (const e of entries) lines.push(`"~*${nginxRe(e.from)}" "${e.to}";${e.verified === false ? ' # unverified' : ''}`);
  for (const g of (gone ?? []).filter((x) => !x.pattern)) lines.push(`"~*${nginxRe(g.from)}" "410"; # gone: ${g.oldTitle ?? g.migrationKey}`);
  return `${lines.join('\n')}\n`;
}

/** IIS URL Rewrite：rewriteMap（key＝REQUEST_URI，含 query）＋一條套用規則；貼進 web.config 的 <system.webServer> */
export function toIisRewriteMap(site, { entries, ambiguous }, gone = []) {
  const head = serverHeader(site, entries, ambiguous, '', ['用法：把 <rewrite> 內容併入 web.config 的 <system.webServer>；rewriteMap 比對 {REQUEST_URI}（含 query）。', `value 為 410 者＝已移除、回 410 不轉址，共 ${(gone ?? []).filter((g) => !g.pattern).length} 筆`]);
  const adds = [];
  for (const e of entries) {
    const keys = new Set([e.from]);
    const [p, q] = splitQuery(e.from);
    keys.add(`${p.endsWith('/') ? p.replace(/\/+$/, '') : `${p}/`}${q ? `?${q}` : ''}`);
    for (const k of keys) if (k && k !== '/') adds.push(`      <add key="${xmlEscape(k)}" value="${xmlEscape(e.to)}" />${e.verified === false ? ' <!-- unverified -->' : ''}`);
  }
  for (const g of (gone ?? []).filter((x) => !x.pattern)) adds.push(`      <add key="${xmlEscape(g.from)}" value="410" /> <!-- gone: ${xmlEscape(g.oldTitle ?? g.migrationKey)} -->`);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<!--\n${head.map((l) => `  ${l.trim()}`).join('\n')}\n-->`,
    '<rewrite>',
    '  <rewriteMaps>',
    '    <rewriteMap name="CdcLegacyRedirects" defaultValue="" ignoreCase="true">',
    ...adds,
    '    </rewriteMap>',
    '  </rewriteMaps>',
    '  <rules>',
    '    <rule name="CdcLegacyGone" stopProcessing="true">',
    '      <match url=".*" />',
    '      <conditions><add input="{CdcLegacyRedirects:{REQUEST_URI}}" pattern="^410$" /></conditions>',
    '      <action type="CustomResponse" statusCode="410" statusReason="Gone" statusDescription="此內容已移除" />',
    '    </rule>',
    '    <rule name="CdcLegacyRedirect" stopProcessing="true">',
    '      <match url=".*" />',
    '      <conditions><add input="{CdcLegacyRedirects:{REQUEST_URI}}" pattern="(.+)" /></conditions>',
    '      <action type="Redirect" url="{C:1}" redirectType="Permanent" appendQueryString="false" />',
    '    </rule>',
    '  </rules>',
    '</rewrite>',
    '',
  ].join('\n');
}

/** Netlify／Cloudflare Pages _redirects：`from to 301`；含 query 的舊網址以 Netlify 參數比對語法（Cloudflare 不支援 query 比對，會比對路徑） */
export function toRedirectsFile(site, { entries, ambiguous }, gone = []) {
  const lines = serverHeader(site, entries, ambiguous, '#');
  for (const e of entries) {
    const [p, q] = splitQuery(e.from);
    const params = q ? ` ${q.split('&').filter(Boolean).join(' ')}` : '';
    lines.push(`${p}${params}  ${e.to}  301`);
  }
  for (const g of (gone ?? []).filter((x) => !x.pattern)) lines.push(`${splitQuery(g.from)[0]}  /410.html  410  # gone: ${g.oldTitle ?? g.migrationKey}`);
  return `${lines.join('\n')}\n`;
}

/** v1/legacy-map.json：{ "<正規化舊網址>": "<新路徑>" }＋patterns（{id} 佔位，只供說明，不可自動轉址）＋gone（不移轉，建議 410） */
export function buildLegacyMap(site, redirects, server = serverRedirects(redirects)) {
  const map = {};
  for (const e of server.entries) map[e.key] = e.to;
  const patterns = redirects.filter((r) => r.pattern && (r.kind === 'migration' || r.kind === 'legacy'))
    .map((r) => ({ pattern: legacyKey(r.fromPath ?? r.from), from: r.fromPath ?? legacyPathOf(r.from), to: r.to, kind: r.kind, itemId: r.itemId, listId: r.listId ?? null, key: r.key ?? null, oldTitle: r.oldTitle ?? null }))
    .filter((x, i, a) => a.findIndex((y) => y.pattern === x.pattern && y.to === x.to) === i);
  return { map, patterns, gone: goneEntries(site), ambiguous: server.ambiguous };
}

/** v1/migration/index.json 的一列 */
export function migrationSummary(l) {
  return {
    id: l.id, slug: l.slug, title: l.title, scope: l.scope, disease: l.disease ?? null, diseaseName: l.diseaseName ?? null, legalCategory: l.legalCategory ?? null,
    hasPage: l.hasPage ?? null, pagePath: l.pagePath ?? null, derived: !!l.derived, curated: !!l.curated, status: l.status, site: l.site ?? 'zh-TW',
    owner: l.owner, ownerName: l.ownerName, reviewedAt: l.reviewedAt ?? null, showLegacyUntil: l.showLegacyUntil ?? null, show: l.show,
    stats: l.stats, derivedItems: l.derivedItems ?? 0, curatedItems: l.curatedItems ?? l.items.length, todoId: l.todoId ?? null,
    url: absUrl(l.apiPath ?? `/v1/migration/${l.slug}.json`), path: l.apiPath ?? `/v1/migration/${l.slug}.json`,
  };
}
/** v1/migration/{slug}.json 的 data：清單欄位＋逐筆（去掉建置期欄位以外原樣保留） */
export function migrationDetail(l) {
  const items = l.items.map(({ listId, show, ...it }) => it);
  return {
    ...migrationSummary(l), legacyRoot: l.legacyRoot ?? null, sourceNote: l.sourceNote ?? null, summary: l.summary ?? null, file: l.file ?? null,
    extends: l.extends ?? null, templateId: l.templateId ?? null, items,
  };
}

/** 不移轉（status: dropped）的舊頁 → 建議回 410（內容已移除，不轉址）；{id} 佔位者 pattern:true 不進伺服器檔 */
export function goneEntries(site) {
  const gone = [];
  for (const list of site.migration?.lists ?? []) for (const it of list.items) {
    if (it.status !== 'dropped' || !it.fromPath) continue;
    gone.push({ key: legacyKey(it.fromPath), from: it.fromPath, pattern: !!it.pattern, listId: list.id, migrationKey: it.key, oldTitle: it.oldTitle, note: it.note ?? null, status: 410 });
  }
  return gone;
}

export function emitApi(fullSite, write) {
  const site = publicView(fullSite);
  const now = nowOf(site);
  const c = site.collections;
  const manifest = [];
  const put = (file, data, extra, top, description) => {
    write(file, wrap(site, data, extra, top));
    manifest.push({ path: `/${file}`, url: absUrl(`/${file}`), description: description ?? '', count: Array.isArray(data) ? data.length : null });
  };
  const published = (arr) => (arr ?? []).filter((i) => isPublic(i, now, { archived: true }));

  // 疾病：主檔 + 疾病頁
  const pageById = new Map(c.diseases.map((p) => [p.id, p]));
  const related = new Map(); // disease id → { faq, news, documents, vaccines, datasets, clarifications, media, labtests, services, publications, topics }
  const RELATED_KEY = { faq: 'faq', news: 'news', letter: 'news', document: 'documents', vaccine: 'vaccines', dataset: 'datasets', clarification: 'clarifications', media: 'media', labtest: 'labtests', service: 'services', publication: 'publications', topic: 'topics' };
  for (const item of site.all) {
    if (!isPublic(item, now) || item.gov.superseded) continue;
    for (const d of diseasesOf(item)) {
      if (!related.has(d)) related.set(d, { faq: [], news: [], documents: [], vaccines: [], datasets: [], clarifications: [], media: [], labtests: [], services: [], publications: [], topics: [] });
      const key = RELATED_KEY[item.type];
      if (key) related.get(d)[key].push(brief(item));
    }
  }
  put('v1/diseases.json', site.master.diseases.map((d) => {
    const p = pageById.get(d.id);
    return { ...d, page: p && isPublic(p, now) ? absUrl(pathOf(p)) : null, path: p ? pathOf(p) : null, api: p ? absUrl(`/v1/diseases/${p.slug}.json`) : null, governance: p ? govSummary(p) : null };
  }), {}, {}, '傳染病主檔（含疾病頁連結與治理摘要）');
  for (const d of c.diseases) {
    put(`v1/diseases/${d.slug}.json`, { ...strip(d), master: site.diseaseMasterById.get(d.id) ?? null, related: related.get(d.id) ?? null }, {}, {}, `疾病頁：${d.title}`);
  }
  put('v1/vaccines.json', published(c.vaccines).map(strip), {}, {}, '疫苗頁');
  // 疫苗接種時程表（主檔；時程地圖與答案引擎的年齡查詢用）
  put('v1/immunization-schedule.json', site.master.immunizationSchedule ?? [], {}, {}, '疫苗接種時程表');
  put('v1/faq.json', published(c.faq).map(strip), {}, {}, 'Q&A');
  put('v1/news.json', [...published(c.news)].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.id.localeCompare(b.id)).slice(0, 200).map(strip), {}, {}, '新聞稿／通函（近 200 則，含自動加註）');
  put('v1/documents.json', [...published(c.documents)].sort((a, b) => (a.family ?? '').localeCompare(b.family ?? '') || (a.effectiveAt ?? '').localeCompare(b.effectiveAt ?? '')).map(strip), {}, { families: site.gov.families }, '文件全部版本（isCurrent、supersedes、supersededBy）；families 為版本鏈');
  put('v1/clarifications.json', published(c.clarifications).map(strip), {}, {}, '謠言澄清');

  // 態勢層
  const sit = site.situation ?? {};
  put('v1/situation.json', {
    ...noFile(sit), history: (sit.history ?? []).map((h) => ({ publishedAt: h.publishedAt, dataDate: h.dataDate, items: (h.items ?? []).map((it) => ({ disease: it.disease, status: it.status })) })),
    items: (sit.items ?? []).map((it) => ({ ...it, diseaseName: site.diseaseMasterById.get(it.disease)?.name, slug: site.diseaseMasterById.get(it.disease)?.slug, page: pageById.has(it.disease) ? absUrl(pathOf(pageById.get(it.disease))) : null })),
    governance: site.gov.situation,
  }, { lastModified: sit.publishedAt ?? site.today }, {}, '疫情態勢層（疫情中心人工發布）');
  const snap = (s) => s ?? { meta: { mode: 'missing' }, data: [] };
  const ta = snap(site.snapshots?.travelAlerts), cl = snap(site.snapshots?.countryLevels);
  put('v1/travel-alerts.json', ta.data ?? [], { provenance: ta.meta, lastModified: ta.meta?.fetchedAt?.slice?.(0, 10) ?? site.today }, {}, '國際旅遊疫情建議（快照或每日抓取）');
  put('v1/country-levels.json', cl.data ?? [], { provenance: cl.meta, lastModified: cl.meta?.fetchedAt?.slice?.(0, 10) ?? site.today }, {}, '各國疫情等級');
  // ARCHITECTURE 12.1：事件流（近 400 天，kind＝new／raised／lowered／lifted／renewed）與全球背景提醒
  const ce = snap(site.snapshots?.countryEvents);
  put('v1/country-changes.json', ce.data ?? [], { provenance: ce.meta, changeSummary30: cl.meta?.changeSummary30 ?? null, lastModified: ce.meta?.fetchedAt?.slice?.(0, 10) ?? site.today }, {}, '旅遊疫情建議變化事件（新增、調升、調降、解除、重發；依日期降冪）');
  put('v1/country-background.json', cl.meta?.background ?? [], { backgroundRule: cl.meta?.backgroundRule ?? null, provenance: { mode: cl.meta?.mode ?? 'missing', fetchedAt: cl.meta?.fetchedAt ?? null, dataDate: cl.meta?.dataDate ?? null, sourceUrl: cl.meta?.sourceUrl ?? null }, lastModified: cl.meta?.fetchedAt?.slice?.(0, 10) ?? site.today }, {}, '全球背景提醒（同一疾病同一等級涵蓋 ≥ 50% 國家者，不逐國列出）');
  put('v1/datasets.json', published(c.datasets).map(strip), {}, {}, '資料目錄（CKAN 快照＋治理欄位）');
  put('v1/glossary.json', site.master.glossary ?? [], { lastModified: site.today }, {}, '七語詞彙主檔');
  put('v1/units.json', site.master.units ?? [], { lastModified: site.today }, {}, '權責單位');
  put('v1/countries.json', site.master.countries ?? [], { lastModified: site.today }, {}, '國家主檔');
  // ── 第二輪：影音、專區、申請服務、出版品、檢驗、研究、公告、通報時限、宣導檔期 ──
  const byPubDesc = (a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? '') || a.id.localeCompare(b.id);
  put('v1/media.json', [...published(c.media)].sort(byPubDesc).map(strip), {}, {}, '影音宣導素材（含逐字稿、章節、依據正本與是否過時）');
  put('v1/topics.json', [...published(c.topics)].sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99) || a.id.localeCompare(b.id)).map(strip), {}, {}, '專區／專題（ended＝已結束；links 含外部連結檢查狀態）');
  put('v1/services.json', [...published(c.services)].sort((a, b) => a.id.localeCompare(b.id)).map(strip), {}, {}, '申請／服務（步驟、應備文件、處理天數、表單）');
  const pubs = [...published(c.publications)].sort((a, b) => (a.series ?? '').localeCompare(b.series ?? '') || String(b.volume ?? '').localeCompare(String(a.volume ?? ''), undefined, { numeric: true }) || String(b.issue ?? '').localeCompare(String(a.issue ?? ''), undefined, { numeric: true }) || byPubDesc(a, b));
  const seriesMap = new Map();
  for (const p of pubs) {
    const k = p.series ?? '其他';
    if (!seriesMap.has(k)) seriesMap.set(k, { series: k, seriesEn: p.seriesEn ?? null, pubType: p.pubType ?? null, issn: p.issn ?? null, count: 0, latest: null, items: [] });
    const g = seriesMap.get(k);
    g.count++; g.items.push(p.id);
    if (!g.latest || (p.publishedAt ?? '') > (site.byId.get(g.latest)?.publishedAt ?? '')) g.latest = p.id;
  }
  put('v1/publications.json', pubs.map(strip), {}, { series: [...seriesMap.values()] }, '出版品（書目完整；series 為系列分組）');
  // 第二十九輪（ARCHITECTURE 34）：疫情報導文章（全文 sections、作者單位、頁碼、引用格式）；依卷期倒序、篇次正序
  const issueOf = (a) => site.byId.get(a.issueId);
  const arts = [...published(c.articles)].sort((a, b) => String(issueOf(b)?.publishedAt ?? '').localeCompare(String(issueOf(a)?.publishedAt ?? '')) || (a.articleNo ?? 0) - (b.articleNo ?? 0));
  put('v1/articles.json', arts.map((a) => ({ ...strip(a), issue: issueOf(a) ? { id: a.issueId, volume: issueOf(a).volume ?? null, issue: issueOf(a).issue ?? null, publishedAt: issueOf(a).publishedAt ?? null, pdfUrl: issueOf(a).pdfUrl ?? null } : null, citation: citationOf(a, issueOf(a)), citationEn: citationEnOf(a, issueOf(a)) })), {}, {}, '疫情報導文章（全文 sections、作者與單位、頁碼、圖表說明、引用格式；issue 為所屬卷期）');
  put('v1/labtests.json', [...published(c.labtests)].sort((a, b) => a.id.localeCompare(b.id)).map((l) => ({ ...strip(l), master: noFile(site.diseaseMasterById.get(l.disease)) ?? null })), {}, {}, '檢驗項目（疾病 × 檢體 × 容器 × 保存運送 × 時限；含與通報時限一致性）');
  put('v1/research.json', [...published(c.research)].sort((a, b) => (b.year ?? 0) - (a.year ?? 0) || a.id.localeCompare(b.id)).map(strip), {}, {}, '研究計畫（年度、狀態、成果報告、資料集）');
  const notices = published(c.news).filter((n) => NOTICE_TYPES.has(n.newsType))
    .sort((a, b) => (a.gov.closed - b.gov.closed) || (a.gov.closed ? (b.deadlineAt ?? '').localeCompare(a.deadlineAt ?? '') : (a.deadlineAt ?? '9999').localeCompare(b.deadlineAt ?? '9999')) || byPubDesc(a, b))
    .map((n) => ({ ...strip(n), closed: !!n.gov.closed, closingSoon: !!n.gov.closingSoon, daysToDeadline: n.gov.daysToDeadline ?? null }));
  put('v1/notices.json', notices, { open: notices.filter((n) => !n.closed).length, closed: notices.filter((n) => n.closed).length }, {}, '機關公告：其他訊息（closed＝已截止；進行中依截止日排序）；人才招募見 jobs.json、採購公告見 tenders.json');
  // 第七輪（ARCHITECTURE 15.1）：人才招募、採購公告（stage 由治理引擎推導）
  const JOB_TAB_ORDER = Object.keys(JOB_TAB_LABELS);
  const jobs = published(c.jobs)
    .sort((a, b) => JOB_TAB_ORDER.indexOf(a.gov.jobTab) - JOB_TAB_ORDER.indexOf(b.gov.jobTab) || (a.gov.jobTab === 'open' || a.gov.jobTab === 'upcoming' ? (a.deadlineAt ?? '').localeCompare(b.deadlineAt ?? '') : byPubDesc(a, b)) || a.id.localeCompare(b.id))
    .map((j) => ({ ...strip(j), stage: j.gov.jobStage, stageLabel: j.gov.jobStageLabel, tab: j.gov.jobTab, tabLabel: j.gov.jobTabLabel, archivedStage: j.gov.archivedStage,
      hiringUnitName: site.unitById.get(j.hiringUnit)?.name ?? j.hiringUnit, applyHref: j.gov.applyHref, applyOnSite: j.gov.applyOnSite, daysToDeadline: j.gov.daysToDeadline, closingSoon: j.gov.closingSoon,
      resultUrl: j.result ? absUrl(`${pathOf(j)}#result`) : null, timeline: j.gov.timeline }));
  // 備取有效期已過者不輸出（與頁面一致）
  for (const j of jobs) if (j.result?.waitlist) j.result = { ...j.result, waitlist: j.result.waitlist.filter((w) => !w.validUntil || String(w.validUntil) >= String(site.today)) };
  put('v1/jobs.json', jobs, { stageLabels: JOB_STAGE_LABELS, tabLabels: JOB_TAB_LABELS, byStage: site.gov.jobs?.byStage ?? {}, byTab: site.gov.jobs?.byTab ?? {}, owner: 'unit.personnel',
    privacy: '甄選結果（result）只公布序號與報名編號，不公布姓名（第三十輪起連遮罩姓名都不公布，建置時個資閘門檢查，有姓名欄即建置失敗）；result.unpublishAt（下架日）起名單不再輸出（result 只剩 publishedAt／unpublishAt／refNo）；result.externalUrl＝名單在人事系統，本站不存名單。result 與 waitlistUpdates 不進 AI 答案索引。' }, {},
    '人才招募職缺（stage：upcoming／open／closed／screening／result／filled／cancelled；tab：open／upcoming／review／result／history）');
  const TENDER_TAB_ORDER = Object.keys(TENDER_TAB_LABELS);
  const tenders = published(c.tenders)
    .sort((a, b) => TENDER_TAB_ORDER.indexOf(a.gov.tenderTab) - TENDER_TAB_ORDER.indexOf(b.gov.tenderTab) || (a.gov.tenderStage === 'open' ? (a.deadlineAt ?? '').localeCompare(b.deadlineAt ?? '') : (b.deadlineAt ?? '').localeCompare(a.deadlineAt ?? '')) || a.id.localeCompare(b.id))
    .map((x) => ({ ...strip(x), stage: x.gov.tenderStage, stageLabel: x.gov.tenderStageLabel, tab: x.gov.tenderTab, tabLabel: x.gov.tenderTabLabel,
      requestingUnitName: site.unitById.get(x.requestingUnit)?.name ?? x.requestingUnit, daysToDeadline: x.gov.daysToDeadline, closingSoon: x.gov.closingSoon, awardOverdue: x.gov.awardOverdue, timeline: x.gov.timeline }));
  put('v1/tenders.json', tenders, { stageLabels: TENDER_STAGE_LABELS, tabLabels: TENDER_TAB_LABELS, byStage: site.gov.tenders?.byStage ?? {}, byTab: site.gov.tenders?.byTab ?? {}, owner: 'unit.secretariat',
    note: '正式招標文件、投標與決標公告以政府電子採購網為準' }, {},
    '採購公告（stage：open／closed／opened／awarded／failed／cancelled）');
  const nt = site.gov.notifyTable ?? [];
  put('v1/notify-table.json', nt, { lastModified: site.today, diseases: nt.reduce((n, g) => n + g.diseases.length, 0), source: `${siteOrigin()}/report/` }, {}, '法定傳染病通報時限表（由傳染病主檔自動產生）');
  const STATUS_ORDER = { active: 0, upcoming: 1, ended: 2 };
  const campaigns = published(c.banners)
    .sort((a, b) => STATUS_ORDER[a.gov.campaignStatus] - STATUS_ORDER[b.gov.campaignStatus] || (a.priority ?? 99) - (b.priority ?? 99) || (b.startAt ?? '').localeCompare(a.startAt ?? ''))
    .map((b) => ({ ...strip(b), campaignStatus: b.gov.campaignStatus }));
  put('v1/campaigns.json', campaigns, { active: campaigns.filter((x) => x.campaignStatus === 'active').length, upcoming: campaigns.filter((x) => x.campaignStatus === 'upcoming').length, ended: campaigns.filter((x) => x.campaignStatus === 'ended').length }, {}, '全部宣導 Banner（campaignStatus：active／upcoming／ended）');

  put('v1/banners.json', (c.banners ?? []).filter((b) => isPublic(b, now) && b.startAt <= site.today && b.endAt >= site.today).sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99)).map(strip), {}, {}, '目前上架中的首頁 Banner');

  // 五類資產總目錄
  const catalog = site.all.filter((i) => isPublic(i, now)).map((i) => ({
    // tender.category（財物／勞務／工程）不是資產類別 ⇒ 只採用七類資產內的 category
    id: i.id, type: i.type, category: (ASSET_CATEGORIES[i.category] ? i.category : null) ?? CATEGORY_OF[i.type] ?? 'content-page', title: i.title, owner: i.owner, ownerName: i.gov.ownerName,
    canonicalUrl: i.canonicalUrl ?? absUrl(pathOf(i)), page: absUrl(pathOf(i)), md: mdPathOf(i) ? absUrl(mdPathOf(i)) : null,
    license: i.license, sensitivity: i.sensitivity, reviewedAt: i.reviewedAt, nextReviewAt: i.gov.nextReviewAt, lifecycle: i.gov.lifecycle,
    isCurrent: i.gov.isCurrent, whitelist: i.gov.whitelist.effective, languages: i.gov.renderableLangs, legacyUrls: i.legacyUrls ?? [],
    // 第八輪（16.1）：檔案資產摘要（file、kind、label、url、bytes、mime、machineReadable；圖片含 alt）
    assets: assetSummary(i, absUrl),
  }));
  const categories = Object.entries(ASSET_CATEGORIES).map(([key, label]) => ({ key, label, count: catalog.filter((x) => x.category === key).length }));
  put('v1/catalog.json', catalog, { categories }, {}, '七類資產總目錄（開放資料集、統計查詢系統、結構化表格、文件庫、內容頁、新聞稿／公告、影音宣導素材）');

  // 搜尋（靜態版＝答案單元索引）
  const si = site.searchIndex ?? { public: [], pro: [] };
  put('v1/search-index.json', si.public, { lastModified: lastModifiedOf(si.public) ?? site.today }, {}, '答案單元索引（民眾，只含白名單）');
  put('v1/search-index-pro.json', si.pro, { lastModified: lastModifiedOf(si.pro) ?? site.today }, {}, '答案單元索引（專業，只含現行版）');
  put('v1/search.json', {
    endpoint: absUrl('/v1/search-index.json'), proEndpoint: absUrl('/v1/search-index-pro.json'),
    description: '靜態站沒有伺服器端搜尋：/v1/search 即答案單元索引（search-index.json）。下載後於用戶端以 bigram＋詞彙主檔同義詞＋BM25 檢索；只含 AI 白名單內容，失效版本不在索引中。',
    chunks: si.public.length, chunksPro: si.pro.length,
    chunkFields: ['id', 'contentId', 'type', 'lang', 'title', 'text', 'sentences', 'url', 'owner', 'ownerName', 'reviewedAt', 'nextReviewAt', 'audience', 'tasks', 'diseases', 'vaccines', 'countries', 'version', 'effectiveAt', 'isCurrent', 'whitelist', 'terms'],
    glossary: absUrl('/v1/glossary.json'), ui: absUrl('/ask/'),
  }, { aliasOf: '/v1/search-index.json', lastModified: site.today }, {}, '搜尋端點說明（＝search-index 別名）');

  // 六任務入口聚合
  for (const task of config.tasks) {
    const items = site.all.filter((i) => isPublic(i, now) && !i.gov.superseded && (i.tasks ?? []).includes(task.key) && i.type !== 'banner')
      .sort((a, b) => (b.reviewedAt ?? '').localeCompare(a.reviewedAt ?? '') || a.id.localeCompare(b.id));
    const byType = {};
    for (const i of items) (byType[i.type] ??= []).push(brief(i));
    const extra = task.key === 'situation' ? { situation: (sit.items ?? []).map((it) => ({ disease: it.disease, diseaseName: site.diseaseMasterById.get(it.disease)?.name, status: it.status, metricLabel: it.metricLabel, metricValue: it.metricValue })) } : {};
    put(`v1/tasks/${task.key}.json`, { key: task.key, label: task.label, sub: task.sub, page: absUrl(`/tasks/${task.key}/`), count: items.length, items: items.map(brief), byType, ...extra },
      { lastModified: lastModifiedOf(items) ?? site.today }, {}, `任務入口：${task.label}`);
  }

  // 301 對照（含移轉清單）＋伺服器對照檔三格式＋精簡 legacy-map（ARCHITECTURE 13.1）
  const redirects = buildRedirects(site);
  const byKind = redirects.reduce((o, r) => ({ ...o, [r.kind]: (o[r.kind] ?? 0) + 1 }), {});
  put('v1/redirects.json', redirects, { lastModified: site.today, byKind, patterns: redirects.filter((r) => r.pattern).length, unverified: redirects.filter((r) => r.verified === false).length }, {}, '舊版／舊網址 → 正本對照（301；kind：superseded／family-latest／legacy／migration／moved；pattern＝{id} 佔位的 URL 模式，不進伺服器對照檔；moved＝新站內部換型別搬家）');
  const server = serverRedirects(redirects);
  const gone = goneEntries(site);
  for (const [file, text, description] of [
    ['redirects/nginx.map', toNginxMap(site, server, gone), 'Nginx map（$request_uri → 新網址；410 為已移除）'],
    ['redirects/web.config.rewritemap.xml', toIisRewriteMap(site, server, gone), 'IIS URL Rewrite rewriteMap＋301／410 規則'],
    ['redirects/_redirects', toRedirectsFile(site, server, gone), 'Netlify／Cloudflare Pages _redirects（含 410）'],
  ]) {
    write(file, text);
    manifest.push({ path: `/${file}`, url: absUrl(`/${file}`), description: `${description}：舊網址 → 新網址 301（由 redirects.json 產生，不含 pattern 項）`, count: server.entries.length });
  }
  // 移轉清單（ARCHITECTURE 14.1）：各清單摘要＋每份完整清單（含 derived 標記，可下載當人工清單起點）
  const mig = site.migration;
  if (mig?.lists) {
    const summaries = mig.lists.map((l) => migrationSummary(l));
    put('v1/migration/index.json', summaries, { lastModified: site.today, stats: mig.stats, template: mig.template ?? null, statusLabels: mig.statusLabels }, {},
      '移轉清單摘要：主檔每種疾病一份（derived＝模板推導、curated＝有人工清單；status no-page＝疾病頁尚未建立）＋欄目清單；stats 為全站統計');
    for (const l of mig.lists) write(`v1/migration/${l.slug}.json`, wrap(site, migrationDetail(l), { lastModified: l.reviewedAt ?? site.today, count: l.items.length }));
    manifest.push({ path: '/v1/migration/{slug}.json', url: absUrl('/v1/migration/{slug}.json'), description: `單一移轉清單完整內容（${mig.lists.length} 份；items[].derived＝由模板推導；可下載後改寫成 content/migration/{slug}.json 人工清單，只留例外）`, count: mig.lists.length });
  }
  const lm = buildLegacyMap(site, redirects, server);
  put('v1/legacy-map.json', lm.map, {
    lastModified: site.today, count: Object.keys(lm.map).length,
    keyRule: '去網域、去 hash、百分比編碼統一、小寫、去尾斜線（根目錄保留 /）、query 去掉 page 參數（其餘保留原順序）',
    valueRule: '新站路徑（不含 basePath 與語言前綴；可含 #錨點）',
  }, { patterns: lm.patterns, gone: lm.gone, ambiguous: lm.ambiguous }, '舊網址精簡對照 { 正規化舊網址: 新路徑 }（404 頁與 /legacy/ 查詢用）；patterns 為 {id} 佔位的 URL 模式（不可自動轉址）、gone 為不移轉（建議 410）');

  // 治理
  const todos = site.gov.todos;
  put('v1/governance/kpi.json', site.gov.kpi, { lastModified: site.today, quarter: quarterOf(site.today) }, {}, '品質指標（7.5 全列）');
  put('v1/governance/todos.json', todos, { lastModified: site.today, overdue: todos.filter((t) => t.overdue).length, kindLabels: TODO_KIND_LABELS }, {}, '治理待辦');
  put('v1/governance/summary.json', site.gov.summary, { lastModified: site.today }, {}, '治理儀表板數字');
  put('v1/governance/by-owner.json', site.gov.byOwner, { lastModified: site.today }, {}, '各權責單位待辦／逾期／白名單／內容數');
  const lh = site.gov.linkHealth ?? {};
  put('v1/governance/links.json', site.gov.externalLinks ?? [], { lastModified: lh.lastCheckedAt ?? site.today, ok: lh.ok ?? 0, broken: lh.broken ?? 0, unchecked: lh.unchecked ?? 0, checker: 'node scripts/fetch-data.mjs --check-links' }, {}, '外部連結健康（status：ok／broken／unchecked）');
  put('v1/governance/ai-status.json', site.governance.aiStatus, { lastModified: site.governance.aiStatus?.updatedAt?.slice?.(0, 10) ?? site.today }, {}, 'AI 問答開關');
  put('v1/governance/whitelist.json', {
    policy: site.governance.whitelist, reasonLabels: WHITELIST_REASON_LABELS, lifecycleLabels: LIFECYCLE_LABELS,
    effective: site.gov.whitelistCount, totalPublished: site.gov.totalPublished,
    items: site.all.map((i) => ({ id: i.id, type: i.type, title: i.title, owner: i.owner, tier: i.gov.whitelist.tier, requested: i.gov.whitelist.requested, effective: i.gov.whitelist.effective, public: i.gov.whitelist.public, reasons: i.gov.whitelist.reasons, reasonLabels: i.gov.whitelist.reasonLabels, lifecycle: i.gov.lifecycle })),
  }, { lastModified: site.governance.whitelist?.approvedAt ?? site.today }, {}, 'AI 白名單政策與每筆狀態');
  put('v1/governance/eval-set.json', site.governance.evalSet, { lastModified: site.today }, {}, '評估集');
  put('v1/governance/eval-report.json', site.evalReport ?? null, { lastModified: site.today }, {}, '評估報告');

  // 端點索引 + OpenAPI
  put('v1/index.json', manifest.slice(), { lastModified: site.today }, {}, '端點清單');
  write('openapi.json', JSON.stringify(buildOpenApi(site), null, 2));
  return manifest;
}

function quarterOf(iso) { const [y, m] = iso.split('-').map(Number); return `${y}Q${Math.ceil(m / 3)}`; }
