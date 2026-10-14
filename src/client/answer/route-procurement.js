// 答案引擎分支：採購公告（procurement 意圖：招標中標案列表、指名標案、決標）。
// 第四十九輪自 core.js 原封不動搬出（程式碼一字未改，git diff --color-moved 可對照），改成「問到這類問題才 import()」，
// 大多數問題（症狀、疫苗、出國、態勢…）不必下載這段程式；為什麼這樣拆、拆了什麼、沒拆什麼，見 docs/ask-search-llm.md §14。
// 由 core.js createEngine 內的 route('procurement') 建立：ctx 是同一個引擎閉包裡的狀態與共用函式（不是另一份引擎），所以行為與搬出前完全相同。
import { tr } from './lexicon.js';
import { PROCUREMENT_DETAIL_RE, focusOf } from './rules.js';
import createNoticeShared from './notices-shared.js';

export default function createProcurementRoute(ctx) {
  const { overviewChunks, setRefusal, tenderStageNow } = ctx;
  const { structuredFinish, pickSent, noticeTopicMiss } = createNoticeShared(ctx);

  function procurementAnswer(q, result, view) {
    const LL = result.lang;
    const all = overviewChunks('tender', view);
    const focus = all.filter((c) => focusOf(q, c));
    result.focusIds = focus.map((c) => c.contentId);
    const listLink = { label: tr(LL, '看全部採購公告', 'All procurement notices'), href: '/procurement/', kind: 'link' };
    if (PROCUREMENT_DETAIL_RE.test(q)) return null;
    const wantAward = /(決標|得標|流標|廢標)/.test(q) && !focus.length;
    let list = focus.length ? focus : wantAward ? all.filter((c) => ['awarded', 'failed', 'cancelled'].includes(tenderStageNow(c))) : all.filter((c) => tenderStageNow(c) === 'open');
    if (!list.length) return setRefusal(result, 'no-open-tender', 'ref.no-open-tender', [listLink]);
    list = [...list].sort((a, b) => (wantAward ? String(b.awardDate ?? b.deadlineAt).localeCompare(String(a.awardDate ?? a.deadlineAt)) : String(a.deadlineAt).localeCompare(String(b.deadlineAt))) || a.contentId.localeCompare(b.contentId)).slice(0, 5);
    const picked = [];
    for (const c of list) {
      const sents = wantAward ? [pickSent(c, /已於 .* 決標|流標|已取消/), pickSent(c, /案號/)] : [pickSent(c, /案號/), pickSent(c, /投標截止日/), ...(focus.length ? [pickSent(c, /已於 .* 決標|流標|已取消/)] : [])];
      for (const t of sents) if (t) picked.push({ text: t, cite: [c.id], chunk: c, slot: 0, score: 9 });
    }
    result.procurement = { mode: focus.length ? 'focus' : wantAward ? 'award' : 'list', structured: true, items: list.map((c) => ({ id: c.contentId, title: c.title, tenderNo: c.tenderNo, requestingUnitName: c.requestingUnitName, budgetNtd: c.budgetNtd, deadlineAt: c.deadlineAt, openingAt: c.openingAt, url: c.url, pccUrl: c.pccUrl ?? null, stage: tenderStageNow(c) })) };
    return structuredFinish(result, picked, list, { required: ['deadline'], markClosed: !wantAward });
  }
  return { noticeTopicMiss, procurementAnswer };
}
