// 職缺（route-careers.js）與標案（route-procurement.js）兩個回答分支共用的函式：結構化回答收尾、挑句、「問的主題站內沒有」判斷。
// 第四十九輪自 core.js 原封不動搬出（程式碼一字未改）；兩個分支各自靜態 import 本檔，js-budget 把本檔算進各分支的大小。
import { lc } from './lexicon.js';
import { ADMIT_RE, CAREERS_DETAIL_RE, OPEN_CUE, PROCUREMENT_DETAIL_RE, QUERY_FUNC_RE } from './rules.js';
import { CLOSED_MARK } from './structured.js';
import { tokenize } from './text.js';

export default function createNoticeShared(ctx) {
  const { actionsFor, closedNow, finalizeSentences, poolFor, sourceOf } = ctx;

  // ── 第七輪：人才招募／採購公告（結構化回答：只讀索引中職缺／標案的結構化句與欄位，不走全文檢索） ──
  // 個資：職缺 chunk 不含 result／waitlistUpdates（index-builder 排除），問「誰錄取」只引用「甄選結果已於…公告，名單只公布報名編號」句並給結果頁連結。
  function structuredFinish(result, picked, chunks, extra) {
    const sourceMap = new Map(chunks.map((c) => [c.id, sourceOf(c)]));
    // （已截止）只標在報名期間／投標截止句，避免「已決標（已截止）」之類的重複標示
    const marked = picked.map((p) => (extra.markClosed && closedNow(p.chunk) && /(報名期間|投標截止日)/.test(p.text) && !p.text.includes('已截止') ? { ...p, text: `${p.text}${CLOSED_MARK}`, closed: true } : p));
    finalizeSentences(result, marked, sourceMap);
    result.retrieved = chunks;
    if (result.lang !== 'zh-TW') result.translationNote = 'showing-source'; // 職缺與標案內容只有中文正本
    result.confidence = 0.9;
    result.completeness = { required: extra.required ?? ['deadline'], covered: extra.required ?? ['deadline'], missing: [], score: 1 };
    result.actions = actionsFor(result, result.entities ?? { diseases: [], vaccines: [], countries: [] }, null);
    if (extra.actions) result.actions = [...extra.actions, ...result.actions.filter((x) => !extra.actions.some((y) => y.href === x.href))].slice(0, 4);
    result.related = [];
    return result;
  }
  const pickSent = (c, re) => (c.sentences ?? []).find((x) => re.test(x));
  /**
   * 職缺／標案問句的「主題詞」：去掉意圖線索、泛用詞與功能詞後剩下的中文／英數詞（≥ 2 字）。
   * 有主題詞，但同型別的所有片段都沒有出現其中任何一個雙字片段 ⇒ true（查無）。沒有主題詞（「現在有哪些標案」）⇒ false。
   */
  const NOTICE_GENERIC_RE = /(疾管署|疾病管制署|本署|機關|單位|時候|日期|何時|公告|公開|招標|採購|標案|投標|決標|開標|案號|預算|廠商|招募|徵才|徵人|職缺|約聘|約僱|甄選|甄試|工作機會|缺額|招考|人員|報名|截止|資格|條件|薪資|薪水|待遇|文件|規格|標的|有哪些|有沒有|現在|目前|最近|最新|近期|正在|進行中|開放|還有|還能|可以|一覽|列表|清單|查詢|資訊|相關|關於|所有|全部)/g;
  function noticeTopicMiss(q, type, view) {
    const residual = String(q).normalize('NFKC').toLowerCase().replace(NOTICE_GENERIC_RE, ' ').replace(QUERY_FUNC_RE, ' ').replace(OPEN_CUE, ' ').replace(ADMIT_RE, ' ').replace(CAREERS_DETAIL_RE, ' ').replace(PROCUREMENT_DETAIL_RE, ' ').replace(/\d+/g, ' ');
    const terms = tokenize(residual, { query: true }).filter((t) => t.length >= 2 || /[a-z]/.test(t));
    if (!terms.length) return false;
    const chunks = poolFor(view, 'zh-TW').chunks.filter((c) => c.type === type);
    if (!chunks.length) return false;
    const hay = lc(chunks.map((c) => `${c.title} ${(c.focusTerms ?? []).join(' ')} ${c.text}`).join(' '));
    return !terms.some((t) => hay.includes(t));
  }
  return { structuredFinish, pickSent, noticeTopicMiss };
}
