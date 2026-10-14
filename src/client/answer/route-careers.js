// 答案引擎分支：人才招募（careers 意圖：開放中職缺列表、指名職缺、甄選結果只給連結）。
// 第四十九輪自 core.js 原封不動搬出（程式碼一字未改，git diff --color-moved 可對照），改成「問到這類問題才 import()」，
// 大多數問題（症狀、疫苗、出國、態勢…）不必下載這段程式；為什麼這樣拆、拆了什麼、沒拆什麼，見 docs/ask-search-llm.md §14。
// 由 core.js createEngine 內的 route('careers') 建立：ctx 是同一個引擎閉包裡的狀態與共用函式（不是另一份引擎），所以行為與搬出前完全相同。
import { tr } from './lexicon.js';
import { ADMIT_RE, CAREERS_DETAIL_RE, focusOf } from './rules.js';
import createNoticeShared from './notices-shared.js';

export default function createCareersRoute(ctx) {
  const { jobStageNow, overviewChunks, setRefusal, todayRt } = ctx;
  const { structuredFinish, pickSent, noticeTopicMiss } = createNoticeShared(ctx);

  function careersAnswer(q, result, view) {
    const LL = result.lang;
    const all = overviewChunks('job', view);
    const focus = all.filter((c) => focusOf(q, c));
    result.focusIds = focus.map((c) => c.contentId);
    // 用人單位、職類只當篩選條件（仍只列開放中）
    const byCat = all.filter((c) => (c.hiringUnitName && q.includes(c.hiringUnitName)) || (c.jobType && q.includes(c.jobType)));
    const careersLink = { label: tr(LL, '看全部職缺', 'All vacancies'), href: '/careers/', kind: 'link' };
    // 問錄取結果：不唸名單，給結果頁連結
    if (ADMIT_RE.test(q)) {
      let pool = (focus.length ? focus : all).filter((c) => c.hasResult || c.resultPlannedAt);
      if (!focus.length) pool = pool.filter((c) => c.hasResult);
      pool.sort((a, b) => (b.hasResult - a.hasResult) || (a.archivedStage - b.archivedStage) || String(b.resultPublishedAt ?? b.resultPlannedAt ?? '').localeCompare(String(a.resultPublishedAt ?? a.resultPlannedAt ?? '')));
      pool = pool.slice(0, 3);
      if (!pool.length) return setRefusal(result, 'no-job-result', 'ref.no-job-result', [careersLink]);
      const picked = pool.map((c) => ({ text: pickSent(c, /甄選結果(已於|預計)/), cite: [c.id], chunk: c, slot: 0, score: 9 })).filter((p) => p.text);
      const items = pool.map((c) => ({ id: c.contentId, title: c.title, url: c.url, resultUrl: c.resultUrl, resultPublishedAt: c.resultPublishedAt ?? null, resultPlannedAt: c.resultPlannedAt ?? null, stage: jobStageNow(c) }));
      result.careers = { mode: 'admitted', structured: true, privacy: true, items, note: tr(LL, '甄選結果只在職缺頁公布報名編號（不公布姓名），答案不唸出名單；請以報名編號自行核對。', 'Results list only application numbers (no names) on the vacancy page; this answer does not read out the list.') };
      const acts = items.filter((x) => x.resultUrl).slice(0, 2).map((x) => ({ label: tr(LL, `看「${x.title}」甄選結果`, 'See selection result'), href: x.resultUrl, kind: 'link' }));
      result.guards.push({ kind: 'admitted-list-withheld', ids: items.map((x) => x.id) });
      return structuredFinish(result, picked, pool, { required: ['result-link'], actions: [...acts, careersLink], markClosed: false });
    }
    // 指名職缺並問薪資：職缺概要句＋薪資句
    if (focus.length && /(薪水|薪資|待遇|薪點|月薪|多少錢|起薪)/.test(q)) {
      const pickedS = [];
      for (const c of focus.slice(0, 3)) for (const t of [pickSent(c, /用人，職類為/), pickSent(c, /薪資待遇/)]) if (t) pickedS.push({ text: t, cite: [c.id], chunk: c, slot: 0, score: 9 });
      result.careers = { mode: 'focus', structured: true, items: focus.slice(0, 3).map((c) => ({ id: c.contentId, title: c.title, url: c.url, stage: jobStageNow(c) })) };
      return structuredFinish(result, pickedS, focus.slice(0, 3), { required: ['salary'], markClosed: true });
    }
    if (CAREERS_DETAIL_RE.test(q)) return null; // 資格、薪資、應備文件…：走檢索組句
    const openOf = (arr) => arr.filter((c) => jobStageNow(c) === 'open');
    let list = focus.length ? focus : openOf(byCat).length ? openOf(byCat) : openOf(all);
    if (!focus.length && byCat.length && !openOf(byCat).length && list.length) result.guards.push({ kind: 'category-no-open', fallback: 'all-open' });
    if (!list.length) {
      result.careers = { mode: 'list', structured: true, items: [], upcoming: all.filter((c) => jobStageNow(c) === 'upcoming').map((c) => ({ id: c.contentId, title: c.title, url: c.url, applyStart: c.applyStart, deadlineAt: c.deadlineAt })) };
      return setRefusal(result, 'no-open-job', 'ref.no-open-job', [careersLink]);
    }
    list = [...list].sort((a, b) => String(a.deadlineAt).localeCompare(String(b.deadlineAt)) || a.contentId.localeCompare(b.contentId)).slice(0, 5);
    const picked = [];
    for (const c of list) {
      const s1 = pickSent(c, /用人，職類為/); const s2 = pickSent(c, /報名期間/);
      for (const t of [s1, s2]) if (t) picked.push({ text: t, cite: [c.id], chunk: c, slot: 0, score: 9 });
      if (focus.length && !['open', 'upcoming'].includes(jobStageNow(c))) { const s3 = pickSent(c, /甄選結果(已於|預計)|已停止甄選|已補實/); if (s3) picked.push({ text: s3, cite: [c.id], chunk: c, slot: 0, score: 9 }); }
    }
    result.careers = { mode: focus.length ? 'focus' : 'list', structured: true, items: list.map((c) => ({ id: c.contentId, title: c.title, hiringUnitName: c.hiringUnitName, positions: c.positions, applyStart: c.applyStart, deadlineAt: c.deadlineAt,
      daysLeft: c.deadlineAt ? Math.round((Date.parse(c.deadlineAt) - Date.parse(todayRt())) / 864e5) : null, url: c.url, applyHref: c.applyHref ?? null, applyExternal: !!c.applyExternal, stage: jobStageNow(c) })) };
    return structuredFinish(result, picked, list, { required: ['deadline'], markClosed: true });
  }
  return { noticeTopicMiss, careersAnswer };
}
