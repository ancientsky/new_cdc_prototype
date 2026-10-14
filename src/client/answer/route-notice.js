// 答案引擎分支：公告列表（notice 意圖：每則公告取一句截止日句，進行中在前）。
// 第四十九輪自 core.js 原封不動搬出（程式碼一字未改，git diff --color-moved 可對照），改成「問到這類問題才 import()」，
// 大多數問題（症狀、疫苗、出國、態勢…）不必下載這段程式；為什麼這樣拆、拆了什麼、沒拆什麼，見 docs/ask-search-llm.md §14。
// 由 core.js createEngine 內的 route('notice') 建立：ctx 是同一個引擎閉包裡的狀態與共用函式（不是另一份引擎），所以行為與搬出前完全相同。
import { NOTICE_TYPES } from './structured.js';

export default function createNoticeRoute(ctx) {
  const { closedNow } = ctx;

  /**
   * 公告列表：沒問細節（資格、名額、預算…）時，每則公告取一句「截止日」結構化句；進行中在前（依截止日），已截止在後。
   */
  const NOTICE_DETAIL = /(資格|條件|名額|預算|金額|字號|案號|待遇|薪|工作內容|地點|怎麼報名|如何報名|怎麼投標)/;
  function noticeCompose(q, chunks, picked) {
    if (NOTICE_DETAIL.test(q)) return picked;
    const ns = chunks.filter((c) => NOTICE_TYPES.includes(c.newsType) && c.deadlineAt);
    if (!ns.length) return picked;
    ns.sort((a, b) => (closedNow(a) - closedNow(b)) || (closedNow(a) ? b.deadlineAt.localeCompare(a.deadlineAt) : a.deadlineAt.localeCompare(b.deadlineAt)));
    const out = [];
    for (const c of ns.slice(0, 4)) {
      const t = (c.sentences ?? []).find((x) => x.includes(c.deadlineAt));
      if (t) out.push({ text: t, cite: [c.id], slot: 0, score: 9, chunk: c });
    }
    return out.length ? out : picked;
  }
  return { noticeCompose };
}
