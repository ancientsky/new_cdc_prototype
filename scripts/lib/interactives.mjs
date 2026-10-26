// @ts-check
// 第六十二輪：互動模組（content/interactives/<slug>.json）——彩蛋與民眾互動是「有開關、有權責、有檔期的內容」，不是程式變更。
//
// 契約（細節與理由見 docs/interactives.md、ARCHITECTURE 64、architecture-decisions §47）：
//   - 四種 kind：on-this-day（歷史上的今天）、kids-quiz（兒童衛教小測驗）、policy-sim（防疫決策模擬）、easter-egg（首頁彩蛋）。
//     程式只認這四種；新種類要先寫程式與測試。
//   - 顯示條件（activeInteractives）：status=published、不在排程中、enabled=true、在檔期內（選填的 publishAt／unpublishAt，與節慶主題同一套真實時間判斷）、
//     而且疫情中心沒有發布 alertLevel=emergency。緊急時全部關閉，與節慶主題同一條規則（疫情嚴峻時網站不該在玩）。
//   - 放置位置（placements）是白名單：home-side 只給 on-this-day、brand 只給 easter-egg；版面只在這幾個「空位」長出卡片，其他地方不動。
//   - 正確性：歷史條目每一條都要有出處，verified=false 前台標「待確認」；測驗題與模擬選項都綁 basedOn（既有疾病頁／Q&A），
//     來源不在線上（下架、排程中、逾期被拿掉）時該題自動隱藏——互動內容不能比它依據的頁面更有把握。
//   - 外語：模組只在有譯文的語言顯示（目前只有中文），不會把中文塞進外語首頁。
import { publishAtMs, nowOf, taipeiTime, isPublic } from './lanes.mjs';

/** 四種模組與它們允許的放置位置 */
export const KINDS = {
  'on-this-day': { label: '歷史上的今天', placements: ['home-side', 'play-hub'] },
  'kids-quiz': { label: '兒童衛教小測驗', placements: ['home-bottom', 'play-hub'] },
  'policy-sim': { label: '防疫決策模擬', placements: ['home-bottom', 'play-hub'] },
  'easter-egg': { label: '首頁彩蛋', placements: ['brand'] },
};
export const PLACEMENTS = {
  'home-side': '首頁右側欄（澄清專區下方）',
  'home-bottom': '首頁最下方「互動與遊戲」',
  'play-hub': '/play/ 專頁',
  brand: '站名圖示（彩蛋）',
};
/** 彩蛋預設值 */
export const EGG_DEFAULTS = { taps: 5, keys: '1922' };

/** 模組 id → /play/<slug>/ 的 slug */
export const interactiveSlug = (item) => String(item?.id ?? '').replace(/^interactive\./, '');
/** 有自己頁面的模組（彩蛋沒有頁面） */
export const hasPage = (item) => item?.kind !== 'easter-egg';
export const interactivePath = (item) => (hasPage(item) ? `/play/${interactiveSlug(item)}/` : '/');

/** 檔期（毫秒）；兩個都沒填 ⇒ null（＝一直顯示）；只填一個也接受 */
export function windowOf(item) {
  const from = item?.publishAt ? publishAtMs(item.publishAt) : null;
  const to = item?.unpublishAt ? publishAtMs(item.unpublishAt) : null;
  if (from == null && to == null) return null;
  return { from: from ?? -Infinity, to: to ?? Infinity };
}

// ───────────────────────── 驗證（schema 以外） ─────────────────────────

/**
 * 單一模組的問題：放置位置白名單、檔期先後、各 kind 必備的區塊、測驗題答案序號、basedOn 參照、量表 key 對得上。
 * @param {any} item @param {{ byId?: Map<string, any> }} [site]
 */
export function interactiveProblems(item, site = {}) {
  const out = [];
  const def = KINDS[item?.kind];
  if (!def) { out.push(`kind ${JSON.stringify(item?.kind)} 不在可用清單（${Object.keys(KINDS).join('、')}）`); return out; }
  for (const p of item.placements ?? []) {
    if (!PLACEMENTS[p]) out.push(`placements 含未知位置 ${p}`);
    else if (!def.placements.includes(p)) out.push(`${def.label} 不能放在 ${PLACEMENTS[p]}（只准 ${def.placements.map((x) => PLACEMENTS[x]).join('、')}）`);
  }
  const w = windowOf(item);
  if (item.publishAt && publishAtMs(item.publishAt) == null) out.push(`publishAt（${item.publishAt}）不是有效日期`);
  if (item.unpublishAt && publishAtMs(item.unpublishAt) == null) out.push(`unpublishAt（${item.unpublishAt}）不是有效日期`);
  if (w && w.to <= w.from) out.push(`unpublishAt（${item.unpublishAt}）必須晚於 publishAt（${item.publishAt}）`);
  const byId = site?.byId instanceof Map ? site.byId : null;
  const ref = (id, where) => { if (byId && !byId.has(id)) out.push(`${where} basedOn ${id} 不存在`); };
  if (item.kind === 'on-this-day') {
    if (!item.entries?.length) out.push('on-this-day 必須有 entries（至少一條）');
    for (const [i, e] of (item.entries ?? []).entries()) {
      const d = new Date(Date.UTC(2001, (e.month ?? 1) - 1, e.day ?? 1));
      if (d.getUTCMonth() !== (e.month ?? 1) - 1) out.push(`entries[${i}] ${e.month}/${e.day} 不是有效日期`);
      if (e.verified && !e.verifiedBy) out.push(`entries[${i}] verified:true 但沒填 verifiedBy（誰核對的）`);
    }
  }
  if (item.kind === 'kids-quiz') {
    if (!item.questions?.length) out.push('kids-quiz 必須有 questions（至少一題）');
    for (const [i, q] of (item.questions ?? []).entries()) {
      if (!(q.answer >= 0 && q.answer < (q.choices?.length ?? 0))) out.push(`questions[${i}] answer ${q.answer} 超出選項範圍（0–${(q.choices?.length ?? 1) - 1}）`);
      if (new Set(q.choices ?? []).size !== (q.choices?.length ?? 0)) out.push(`questions[${i}] 選項重複`);
      ref(q.basedOn, `questions[${i}]`);
    }
  }
  if (item.kind === 'policy-sim') {
    const sc = item.scenario;
    if (!sc) out.push('policy-sim 必須有 scenario');
    else {
      const keys = new Set((sc.meters ?? []).map((m) => m.key));
      if (keys.size !== (sc.meters ?? []).length) out.push('scenario.meters 的 key 重複');
      for (const [r, round] of (sc.rounds ?? []).entries()) for (const [o, opt] of (round.options ?? []).entries()) {
        for (const k of Object.keys(opt.effects ?? {})) if (!keys.has(k)) out.push(`rounds[${r}].options[${o}].effects.${k} 不是量表（${[...keys].join('、')}）`);
        if (opt.basedOn) ref(opt.basedOn, `rounds[${r}].options[${o}]`);
      }
      for (const [i, e] of (sc.endings ?? []).entries()) for (const k of Object.keys(e.when ?? {})) if (!keys.has(k)) out.push(`endings[${i}].when.${k} 不是量表`);
      if (!(sc.endings ?? []).some((e) => !e.when || !Object.keys(e.when).length)) out.push('scenario.endings 要有一個沒有 when 的預設結局（任何分數都要有話說）');
    }
  }
  if (item.kind === 'easter-egg') {
    if (!item.egg) out.push('easter-egg 必須有 egg');
    if (item.egg?.link && byId) { /* 站內連結由建置的連結檢查把關 */ }
  }
  return out;
}

// ───────────────────────── 現在顯示哪些 ─────────────────────────

/** 在檔期內（沒填檔期＝一直在） */
export function inWindow(item, now) {
  const w = windowOf(item);
  if (!w) return true;
  const t = nowOf(now);
  return w.from <= t && t < w.to;
}

/** 單一模組此刻是否顯示（不含全站緊急關閉） */
export const isInteractiveOn = (item, now) => item?.type === 'interactive' && item.enabled === true && isPublic(item, nowOf(now)) && inWindow(item, now);

/** 模組的狀態字（後台列表用） */
export function interactiveStatus(item, now) {
  if (item.status !== 'published') return item.status === 'archived' ? 'archived' : 'draft';
  if (!item.enabled) return 'off';
  const w = windowOf(item);
  const t = nowOf(now);
  if (w && t < w.from) return 'upcoming';
  if (w && t >= w.to) return 'ended';
  return 'on';
}
export const INTERACTIVE_STATUS_LABEL = { on: '開啟中', off: '已關閉', upcoming: '尚未開始', ended: '檔期已結束', draft: '草稿', archived: '已封存' };

/**
 * 這次建置顯示的互動模組。→ { list, reason: 'active'|'none'|'emergency', alertLevel, message }
 * site 用完整 site 或 publicView 都可以（排程中的從 fullSite 找也會被 isPublic 擋掉）。
 */
export function interactivesState(site, now = nowOf(site)) {
  const all = (site?.fullSite ?? site)?.collections?.interactives ?? [];
  const on = all.filter((i) => isInteractiveOn(i, now));
  const alertLevel = site?.situation?.alertLevel ?? 'normal';
  const ids = on.map((i) => i.id).join('、');
  if (!on.length) return { list: [], reason: 'none', alertLevel, message: '互動模組：目前沒有開啟中的模組' };
  if (alertLevel === 'emergency') return { list: [], reason: 'emergency', alertLevel, message: `互動模組：疫情中心發布 alertLevel=emergency（content/situation/current.json），不顯示 ${ids}` };
  const ends = on.filter((i) => windowOf(i)?.to && Number.isFinite(windowOf(i).to)).map((i) => `${i.id} 至 ${taipeiTime(windowOf(i).to)}`);
  return { list: on, reason: 'active', alertLevel, message: `互動模組：顯示 ${on.length} 個（${ids}）${ends.length ? `；有檔期：${ends.join('、')}` : ''}` };
}

/** 顯示中、且放在某位置的模組 */
export const interactivesAt = (site, placement) => (site?.interactives?.list ?? []).filter((i) => (i.placements ?? []).includes(placement));

// ───────────────────────── 各 kind 的資料整理 ─────────────────────────

/** 測驗題：只留 basedOn 在線上的題（來源下架、排程中、未發布 ⇒ 該題不出） */
export function liveQuestions(site, item, now = nowOf(site)) {
  const byId = site?.byId ?? new Map();
  return (item?.questions ?? []).filter((q) => isPublic(byId.get(q.basedOn), now));
}

/** MM-DD 的「歷史上的今天」：同日 → 同月最近的下一條 → 全年最近的下一條（跨年）。回 { entries, exact, mmdd } */
export function pickOnThisDay(entries, mmdd) {
  const [mm, dd] = String(mmdd).split('-').map(Number);
  const sorted = [...(entries ?? [])].sort((a, b) => a.month - b.month || a.day - b.day || a.year - b.year);
  const exact = sorted.filter((e) => e.month === mm && e.day === dd);
  if (exact.length) return { entries: exact, exact: true, mmdd };
  const key = (e) => e.month * 100 + e.day;
  const next = sorted.find((e) => key(e) > mm * 100 + dd) ?? sorted[0];
  if (!next) return { entries: [], exact: false, mmdd };
  return { entries: sorted.filter((e) => e.month === next.month && e.day === next.day), exact: false, mmdd: `${String(next.month).padStart(2, '0')}-${String(next.day).padStart(2, '0')}` };
}

/** 公開 JSON（/v1/interactives/<slug>.json）：給首頁小卡依瀏覽器日期換條目用；只有顯示中的模組才輸出 */
export function emitInteractives(site, writeOut) {
  let n = 0;
  for (const it of site?.interactives?.list ?? []) {
    if (it.kind !== 'on-this-day') continue;
    writeOut(`v1/interactives/${interactiveSlug(it)}.json`, JSON.stringify({ id: it.id, title: it.title, owner: it.owner, disclaimer: it.disclaimer ?? null, entries: it.entries.map((e) => ({ month: e.month, day: e.day, year: e.year, text: e.text, source: e.source, sourceUrl: e.sourceUrl ?? null, verified: !!e.verified, link: e.link ?? null })) }, null, 2));
    n++;
  }
  return n;
}
