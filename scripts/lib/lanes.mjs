// @ts-check
// 發布車道與排程發布（ARCHITECTURE 17.1）
//
// 一、車道：content/governance/lanes.json 定義 emergency／fast／standard 三條車道。
//   laneOfItem(item)            → 'emergency'｜'fast'｜'standard'（urgent:true 且型別允許 ⇒ emergency；否則依型別）
//   laneForFiles(files, opts)   → scripts/lane.mjs 與 CI 用的 JSON（多檔取最嚴格：standard ＞ fast ＞ emergency；opts.author 不在 allowedAuthors ⇒ 降為 standard）
//   authorAllowed(author, list, { teams }) → 第二十三輪：作者是否在車道授權名單（帳號或 team:<org>/<slug>）
//   slaOf(lane, since)          → { minutes|workingDays, dueAt, label }
// 二、排程發布：publishAt 以「真實現在時間」判斷（不受 BUILD_TODAY 影響），讓排程內容到點真的上線。
//   nowOf(site|now)             → 毫秒；優先 site.now（測試注入）→ 環境變數 BUILD_NOW → Date.now()
//   publishAtMs(v)              → 毫秒；只有日期 ⇒ 當日 00:00 台灣時間（+08:00）
//   isScheduled(item, now)      → publishAt > now
//   isPublic(item, now, { archived }) → 對外輸出的唯一判斷：published（archived:true 時含 archived）且非排程中
//   publicView(site, now)       → 去掉排程中內容的 site 淺拷貝（collections／all／byId 過濾；gov 與其他欄位共用）。
//                                 所有模板（含後台）、答案索引、API、SEO、檔案資產複製都吃這個 view；
//                                 後台要列「排程中」用 scheduledItems(view)（view.fullSite／view.hiddenScheduled），不要連到前台頁。
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './load.mjs';

export const LANES_PATH = path.join(ROOT, 'content/governance/lanes.json');
/** 嚴格度由低到高（多檔取最後者） */
export const LANE_STRICTNESS = ['emergency', 'fast', 'standard'];
const TZ = '+08:00';
const TZ_MS = 8 * 3600e3;

const cache = new Map();
/** 讀 lanes.json（依路徑快取） */
export function loadLanes(file = LANES_PATH) {
  if (!cache.has(file)) cache.set(file, JSON.parse(fs.readFileSync(file, 'utf8')));
  return cache.get(file);
}

/** lanes.json 形狀檢查（測試與 lane.mjs 用）：回傳錯誤字串陣列 */
export function validateLanes(cfg, allTypes = []) {
  const errs = [];
  if (!cfg || typeof cfg !== 'object') return ['lanes.json 不是物件'];
  const lanes = cfg.lanes ?? {};
  for (const k of LANE_STRICTNESS) {
    const l = lanes[k];
    if (!l) { errs.push(`缺車道 ${k}`); continue; }
    if (typeof l.label !== 'string' || !l.label) errs.push(`${k}.label 必填`);
    if (!Array.isArray(l.types)) errs.push(`${k}.types 必須是陣列`);
    if (typeof l.autoMerge !== 'boolean') errs.push(`${k}.autoMerge 必須是布林`);
    if (!Number.isInteger(l.requiredApprovals) || l.requiredApprovals < 0) errs.push(`${k}.requiredApprovals 必須是 ≥0 整數`);
    if (l.autoMerge && l.requiredApprovals !== 0) errs.push(`${k}：autoMerge 車道 requiredApprovals 必須為 0`);
    if (!l.autoMerge && !(l.requiredApprovals >= 1)) errs.push(`${k}：非自動合併車道至少要 1 位核准`);
    if (l.slaMinutes == null && l.slaWorkingDays == null) errs.push(`${k}：slaMinutes 或 slaWorkingDays 擇一必填`);
    if (l.autoMerge && !(l.postPublishReviewHours > 0)) errs.push(`${k}：自動合併車道必須有 postPublishReviewHours（上線後複核）`);
    // 第二十三輪（26.3）：能跳過人審的車道一定要有授權名單，否則任何有寫入權限的人都能直接上線
    if (l.autoMerge && !(Array.isArray(l.allowedAuthors) && l.allowedAuthors.length)) errs.push(`${k}：自動合併車道必須有 allowedAuthors（誰可以不經人審直接上線）`);
    if (l.allowedAuthors != null && (!Array.isArray(l.allowedAuthors) || l.allowedAuthors.some((a) => typeof a !== 'string' || !a.trim()))) errs.push(`${k}.allowedAuthors 必須是非空字串陣列`);
  }
  if (cfg.rules?.urgentAllowedAuthors != null && !Array.isArray(cfg.rules.urgentAllowedAuthors)) errs.push('rules.urgentAllowedAuthors 必須是陣列');
  for (const k of Object.keys(lanes)) if (!LANE_STRICTNESS.includes(k)) errs.push(`未知車道 ${k}`);
  const seen = new Map();
  for (const [k, l] of Object.entries(lanes)) for (const t of l.types ?? []) {
    if (seen.has(t)) errs.push(`型別 ${t} 同時在 ${seen.get(t)} 與 ${k}`);
    seen.set(t, k);
  }
  for (const t of allTypes) if (!seen.has(t)) errs.push(`內容型別 ${t} 沒有對應車道`);
  const urgentTypes = cfg.rules?.urgentAllowedTypes ?? [];
  if (!urgentTypes.length) errs.push('rules.urgentAllowedTypes 必填');
  return errs;
}

// ───────────────────────── 時間 ─────────────────────────

/** publishAt（date-time 或 date）→ 毫秒；只有日期 ⇒ 當日 00:00 台灣時間；無效 ⇒ null */
export function publishAtMs(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return v;
  const s = String(v).trim();
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00${TZ}` : s;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/** 「現在」毫秒：nowOf(site) 讀 site.now；nowOf(ms|Date|ISO) 直接轉；都沒有 ⇒ BUILD_NOW ⇒ Date.now() */
export function nowOf(x) {
  const v = x && typeof x === 'object' && !(x instanceof Date) ? x.now : x;
  const t = publishAtMs(v);
  if (t != null) return t;
  const env = publishAtMs(process.env.BUILD_NOW);
  return env ?? Date.now();
}

/** 毫秒 → 台灣日期 YYYY-MM-DD */
export const taipeiDate = (ms) => new Date(ms + TZ_MS).toISOString().slice(0, 10);
/** 毫秒 → 台灣時間顯示「2026-10-05 09:00」 */
export const taipeiTime = (ms) => new Date(ms + TZ_MS).toISOString().slice(0, 16).replace('T', ' ');

// ───────────────────────── 排程發布 ─────────────────────────

/** publishAt 尚未到（以真實現在時間判斷） */
export function isScheduled(item, now) {
  const t = publishAtMs(item?.publishAt);
  return t != null && t > nowOf(now);
}

/**
 * 對外輸出的唯一判斷（頁面、索引、sitemap、API、RSS、llms.txt）：
 * status published（archived:true 時也接受 archived）且 publishAt 已到。
 */
export function isPublic(item, now, { archived = false } = {}) {
  if (!item) return false;
  const ok = item.status === 'published' || (archived && item.status === 'archived');
  return ok && !isScheduled(item, now);
}

/** 排程中的內容（published 且 publishAt 未到）；傳 publicView 也可（從 fullSite 找）——後台列「排程中」用 */
export function scheduledItems(site, now = nowOf(site)) {
  return ((site.fullSite ?? site).all ?? []).filter((i) => i.status === 'published' && isScheduled(i, now));
}

/**
 * 去掉排程中內容的 site 淺拷貝。沒有排程中內容 ⇒ 原樣回傳 site（零成本、零行為差異）。
 * view.hiddenScheduled 為被藏起來的內容；view.fullSite 指回完整 site。
 */
export function publicView(site, now = nowOf(site)) {
  if (!site || site.__publicView) return site;
  const hidden = new Set((site.all ?? []).filter((i) => isScheduled(i, now)));
  if (!hidden.size) return site;
  const keep = (arr) => arr.filter((i) => !hidden.has(i));
  const collections = Object.fromEntries(Object.entries(site.collections ?? {}).map(([k, v]) => [k, Array.isArray(v) ? keep(v) : v]));
  const byId = new Map([...(site.byId ?? new Map())].filter(([, i]) => !hidden.has(i)));
  const hiddenIds = new Set([...hidden].map((i) => i.id));
  // 治理彙整中指向排程中內容的部分也一併去掉（待辦、版本鏈）
  const gov = site.gov ? {
    ...site.gov,
    todos: (site.gov.todos ?? []).filter((t) => !hiddenIds.has(t.itemId)),
    families: (site.gov.families ?? []).map((f) => ({ ...f, versions: (f.versions ?? []).filter((v) => !hiddenIds.has(v.id)) })),
  } : site.gov;
  return { ...site, collections, all: keep(site.all), byId, gov, now, __publicView: true, hiddenScheduled: [...hidden], fullSite: site };
}

// ───────────────────────── 車道 ─────────────────────────

/** 某筆內容（或 { type, urgent }）的車道 */
export function laneOfItem(item, cfg = loadLanes()) {
  const urgentTypes = cfg.rules?.urgentAllowedTypes ?? ['news', 'letter', 'clarification'];
  if (item?.urgent === true && urgentTypes.includes(item.type)) return 'emergency';
  for (const k of LANE_STRICTNESS) if ((cfg.lanes[k]?.types ?? []).includes(item?.type)) return k;
  return 'standard';
}

/**
 * 第二十三輪（26.3）：作者是否在名單內。名單項目：GitHub 帳號（不分大小寫）或 `team:<org>/<slug>`；
 * team 成員資格由 CI 另查（teams 參數傳入作者所屬的 team slug 清單），本機沒資料就當不在 team 內。
 * 回傳 { allowed, reason }。
 */
export function authorAllowed(author, list, { teams = [] } = {}) {
  const a = String(author ?? '').trim().toLowerCase();
  if (!a) return { allowed: false, reason: '未提供 PR 作者' };
  const names = (list ?? []).map((x) => String(x).trim().toLowerCase()).filter(Boolean);
  if (!names.length) return { allowed: false, reason: '車道沒有授權名單' };
  if (names.includes(a)) return { allowed: true, reason: `作者 ${author} 在名單內` };
  const myTeams = new Set((teams ?? []).map((t) => String(t).trim().toLowerCase()));
  const hit = names.find((n) => n.startsWith('team:') && myTeams.has(n.slice(5)));
  if (hit) return { allowed: true, reason: `作者 ${author} 屬於 ${hit}` };
  return { allowed: false, reason: `作者 ${author} 不在授權名單內（${list.join('、')}）` };
}

/** 取兩車道中較嚴格者 */
export const stricter = (a, b) => (LANE_STRICTNESS.indexOf(a) >= LANE_STRICTNESS.indexOf(b) ? a : b);

/** 加 N 個工作天（台灣時間，週六日不算；國定假日原型不處理） */
export function addWorkingDays(ms, n) {
  let t = ms, added = 0;
  while (added < n) {
    t += 86400e3;
    const dow = new Date(t + TZ_MS).getUTCDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return t;
}

/** 車道 SLA：從 since（PR 開啟時間）起算 */
export function slaOf(laneKey, since = Date.now(), cfg = loadLanes()) {
  const l = cfg.lanes[laneKey] ?? {};
  const from = nowOf(since);
  if (l.slaMinutes != null) {
    const due = from + l.slaMinutes * 60e3;
    const label = l.slaMinutes % 60 === 0 && l.slaMinutes >= 60 ? `${l.slaMinutes / 60} 小時` : `${l.slaMinutes} 分鐘`;
    return { minutes: l.slaMinutes, workingDays: null, label, since: new Date(from).toISOString(), dueAt: new Date(due).toISOString(), dueAtLocal: taipeiTime(due) };
  }
  const days = l.slaWorkingDays ?? 2;
  const due = addWorkingDays(from, days);
  return { minutes: null, workingDays: days, label: `${days} 個工作天`, since: new Date(from).toISOString(), dueAt: new Date(due).toISOString(), dueAtLocal: taipeiTime(due) };
}

/** content/ 子目錄 → 型別 */
export const DIR_TYPE = {
  diseases: 'disease', faq: 'faq', news: 'news', documents: 'document', clarifications: 'clarification', vaccines: 'vaccine', datasets: 'dataset',
  banners: 'banner', pages: 'page', media: 'media', topics: 'topic', services: 'service', publications: 'publication', labtests: 'labtest',
  research: 'research', jobs: 'job', tenders: 'tender', migration: 'migration', situation: 'situation', articles: 'article',
};

const readJSONSafe = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };

/** 掃 content/ 建 id → { file, type, urgent }（資產檔找所屬內容用） */
function contentIndex(root) {
  const idx = new Map();
  const base = path.join(root, 'content');
  for (const dir of Object.keys(DIR_TYPE)) {
    const d = path.join(base, dir);
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d).filter((x) => x.endsWith('.json'))) {
      const j = readJSONSafe(path.join(d, f));
      if (j?.id) idx.set(j.id, { file: `content/${dir}/${f}`, type: j.type ?? DIR_TYPE[dir], urgent: j.urgent === true });
    }
  }
  return idx;
}

/**
 * 單一變更檔案 → { file, type, lane, reason }
 * @param {string} file
 * @param {{ root?: string, cfg?: any, index?: () => any }} [opts]
 */
export function classifyFile(file, { root = ROOT, cfg = loadLanes(), index } = {}) {
  const f = String(file).trim().replace(/\\/g, '/').replace(/^\.\//, '');
  const std = (reason, type = null) => ({ file: f, type, lane: 'standard', reason });
  const m = f.match(/^content\/([^/]+)\/(.+)$/);
  if (!m) {
    if (f.startsWith('data/snapshots/')) return std('官方資料快照變更需審核（排程回寫直接進 main，不經 PR）');
    return std('程式／文件變更需審核');
  }
  const [, dir, rest] = m;
  if (dir === 'situation') return { file: f, type: 'situation', lane: laneOfItem({ type: 'situation' }, cfg), reason: '疫情態勢層' };
  if (dir === 'governance') return std('治理設定變更需審核');
  if (dir === 'master') return std('主檔變更需審核');
  if (dir === 'assets') {
    const id = rest.split('/')[0];
    const owner = index?.().get(id);
    if (!owner) return std(`找不到檔案資產所屬內容 ${id}`);
    const lane = laneOfItem(owner, cfg);
    return { file: f, type: owner.type, lane, reason: `檔案資產，隨所屬內容 ${id}${owner.urgent ? '（urgent）' : ''}` };
  }
  const dirType = DIR_TYPE[dir];
  if (!dirType) return std(`content/${dir}/ 不是內容型別目錄`);
  if (dir === 'migration') return { file: f, type: 'migration', lane: laneOfItem({ type: 'migration' }, cfg), reason: '移轉清單' };
  const j = f.endsWith('.json') ? readJSONSafe(path.join(root, f)) : null;
  const type = j?.type ?? dirType;
  const lane = laneOfItem({ type, urgent: j?.urgent === true }, cfg);
  const reason = lane === 'emergency' ? `${type} 標記 urgent` : j ? `型別 ${type}` : `型別 ${type}（檔案不在工作目錄：已刪除或尚未取出，依目錄推定）`;
  return { file: f, type, lane, reason };
}

/**
 * 變更檔案清單 → CI 用 JSON：
 * { lane, label, ghLabel, autoMerge, requiredApprovals, reviewers, reviewerAccounts, sla, postPublishReview, files:[{file,type,lane,reason}], reasons:[] }
 */
export function laneForFiles(files, { root = ROOT, cfg = loadLanes(), since = Date.now(), tier1Types = ['disease', 'vaccine', 'clarification', 'situation'], author = null, teams = [] } = {}) {
  let idx;
  const index = () => (idx ??= contentIndex(root));
  const list = [...new Set((files ?? []).map((x) => String(x).trim()).filter(Boolean))];
  const classified = list.map((f) => classifyFile(f, { root, cfg, index }));
  const reasons = [];
  let lane = classified.length ? classified.map((c) => c.lane).reduce(stricter, LANE_STRICTNESS[0]) : 'standard';
  if (!classified.length) reasons.push('沒有變更檔案，無法判定車道，採一般車道');
  for (const c of classified) reasons.push(`${c.file}：${c.reason} → ${cfg.lanes[c.lane].label}`);
  const lanesUsed = new Set(classified.map((c) => c.lane));
  if (lanesUsed.size > 1) reasons.push(`多檔取最嚴格：${cfg.lanes[lane].label}`);
  if (classified.some((c) => c.reason === '程式／文件變更需審核')) reasons.push('程式／文件變更需審核');
  // 第二十三輪（26.3）：自動合併車道還要看「誰」送的。不在名單 ⇒ 降為一般車道（檔案分類不變，只是要 1 位核准）；
  // 沒傳作者（本機跑、舊 CI）也視為不在名單，寧可多一道人審。urgent 另看 rules.urgentAllowedAuthors。
  let authorGate = null;
  if (cfg.lanes[lane]?.autoMerge) {
    const gate = authorAllowed(author, cfg.lanes[lane].allowedAuthors, { teams });
    const urgentFiles = classified.filter((c) => c.lane === 'emergency' && /urgent/.test(c.reason));
    const urgentGate = urgentFiles.length && cfg.rules?.urgentAllowedAuthors ? authorAllowed(author, cfg.rules.urgentAllowedAuthors, { teams }) : { allowed: true, reason: null };
    authorGate = { author: author ?? null, allowed: gate.allowed && urgentGate.allowed, reason: gate.allowed ? (urgentGate.allowed ? gate.reason : `urgent：${urgentGate.reason}`) : gate.reason, requestedLane: lane };
    if (!authorGate.allowed) { reasons.push(`${authorGate.reason} ⇒ 降為${cfg.lanes.standard.label}（需人審）`); lane = 'standard'; }
    else reasons.push(authorGate.reason);
  }
  const l = cfg.lanes[lane];
  let reviewers = [...(l.reviewers ?? [])];
  const tier1 = lane === 'standard' && classified.some((c) => c.lane === 'standard' && tier1Types.includes(c.type));
  if (tier1 && l.tier1Reviewers) { reviewers = [...new Set([...reviewers, ...l.tier1Reviewers])]; reasons.push(`含一級內容（${[...new Set(classified.filter((c) => tier1Types.includes(c.type)).map((c) => c.type))].join('、')}），審核人加 ${l.tier1Reviewers.join('、')}`); }
  const acc = cfg.reviewerAccounts ?? {};
  const units = readJSONSafe(path.join(root, 'content/master/units.json')) ?? readJSONSafe(path.join(ROOT, 'content/master/units.json')) ?? [];
  const unitName = (id) => units.find((u) => u.id === id)?.name ?? id;
  const reviewerAccounts = [...new Set(reviewers.map((r) => acc[r] ?? acc.default).filter(Boolean))];
  return {
    lane, label: l.label, ghLabel: `lane:${lane}`, description: l.description ?? null,
    autoMerge: !!l.autoMerge, requiredApprovals: l.requiredApprovals ?? 0, reviewers, reviewerNames: reviewers.map(unitName), reviewerAccounts, tier1, authorGate,
    sla: slaOf(lane, since, cfg),
    postPublishReview: l.postPublishReviewHours ? { owner: l.postPublishReviewer ?? 'unit.pr', ownerName: unitName(l.postPublishReviewer ?? 'unit.pr'), hours: l.postPublishReviewHours } : null,
    files: classified.map(({ file, type, lane: ln, reason }) => ({ file, type, lane: ln, reason })),
    reasons,
  };
}
