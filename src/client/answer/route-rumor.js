// 答案引擎分支：謠言查證（澄清稿比對；/factcheck/ 與答案頁 rumor 意圖）。
// 第四十九輪自 core.js 原封不動搬出（程式碼一字未改，git diff --color-moved 可對照），改成「問到這類問題才 import()」，
// 大多數問題（症狀、疫苗、出國、態勢…）不必下載這段程式；為什麼這樣拆、拆了什麼、沒拆什麼，見 docs/ask-search-llm.md §14。
// 由 core.js createEngine 內的 route('rumor') 建立：ctx 是同一個引擎閉包裡的狀態與共用函式（不是另一份引擎），所以行為與搬出前完全相同。
import { annotationsOf, isOutdated, ownerNameOf, tr } from './lexicon.js';
import { bigrams, mdPlain, splitPlain } from './text.js';

export default function createRumorRoute(ctx) {
  const { clarifications, units, setRefusal } = ctx;

  // ── 謠言 ──
  const RUMOR_STRIP = /(這則|這個|這篇)?(訊息|消息|貼文|新聞|傳言)?(是)?(真的嗎|是真的嗎|真的假的|是假的嗎|假的嗎|可信嗎|是不是真的)|網傳|聽說|有人說|LINE\s*(群組)?(上)?(說|傳)|請問|查證|闢謠|[:：「」『』"“”?？!！，,。]/gi;
  function similarity(q, claim) {
    const A = new Set(bigrams(q)), B = new Set(bigrams(claim));
    if (!A.size || !B.size) return 0;
    let inter = 0; for (const x of A) if (B.has(x)) inter++;
    const jac = inter / (A.size + B.size - inter);
    const contClaim = inter / B.size; // 訊息含整則謠言
    const contQuery = inter / A.size; // 問句是謠言的片段
    return Math.max(jac, 0.85 * contClaim, 0.75 * contQuery * Math.min(1, A.size / 6));
  }
  // 第四十輪：只問「這是真的嗎」、沒附訊息內容（首頁預設問題就是這樣）。拉丁字母語言的字元雙字很容易跟任何一則英文謠言撞到 0.4 以上，
  // 不能拿相似度判斷 ⇒ 直接回「目前沒有對應的官方澄清」並引導到澄清專區貼上訊息。七語的「光問句」寫法列在這裡。
  const RUMOR_ASK_ONLY = /^\s*((這則|這個|這篇)?(訊息|消息|貼文|新聞|傳言)?(是)?(真的嗎|是真的嗎|真的假的|是假的嗎|可信嗎)|is (?:this|that|it) (?:message |news |post |claim |text )?true|このメッセージは本当ですか|totoo ba(?: ang)?(?: mensaheng| balitang)?(?: ito| iyan)?|apakah (?:pesan|berita|kabar) ini benar|tin nhắn này có thật không|ข้อความนี้จริงหรือไม่|ข้อความนี้จริงไหม)\s*[?？!！。.]*\s*$/i;
  function factCheck(q, result) {
    const LL = result.lang;
    const qs = q.replace(RUMOR_STRIP, ' ');
    let best = null, bestScore = 0, bestClaim = null;
    if (RUMOR_ASK_ONLY.test(q)) {
      result.verdict = 'unknown'; result.guards.push({ kind: 'rumor-no-message' });
      return setRefusal(result, 'no-clarification', 'ref.no-clarification.empty', [{ label: tr(LL, '到澄清專區貼上訊息', 'Paste the message on the fact-check page'), href: '/factcheck/', kind: 'link' }, { label: tr(LL, '撥打 1922 詢問', 'Call 1922'), href: 'tel:1922', kind: 'hotline' }]);
    }
    for (const c of clarifications) {
      // 不在白名單的澄清只在「已過時」時使用（治理引擎判定依據已修訂，需告知民眾已過時）
      const wl = c.gov?.whitelist?.effective ?? c.governance?.whitelist;
      if (wl === false && !isOutdated(c)) continue;
      const claims = [c.claim, ...(c.claimVariants ?? []), ...(result.lang !== 'zh-TW' ? [c.i18n?.[result.lang]?.claim, c.i18n?.[result.lang]?.title, ...(c.i18n?.[result.lang]?.claimVariants ?? [])] : [])].filter(Boolean);
      for (const claim of claims) { const s = similarity(qs, claim); if (s > bestScore) { bestScore = s; best = c; bestClaim = claim; } }
    }
    result.rumorScore = Math.round(bestScore * 100) / 100;
    if (!best || bestScore < 0.4) {
      result.verdict = 'unknown';
      setRefusal(result, 'no-clarification', 'ref.no-clarification', [{ label: tr(LL, '撥打 1922 詢問', 'Call 1922'), href: 'tel:1922', kind: 'hotline' }, { label: tr(LL, '詐騙請撥 165', 'Scams: call 165'), href: 'tel:165', kind: 'hotline' }, { label: tr(LL, '到澄清專區', 'Fact-check page'), href: '/factcheck/', kind: 'link' }]);
      return result;
    }
    const outdated = isOutdated(best);
    const verdict = outdated ? 'outdated' : best.verdict;
    const i18n = result.lang !== 'zh-TW' ? best.i18n?.[result.lang] : null;
    const revised = (best.gov?.stale ?? best.governance?.stale ?? []).map((s) => ({ revisedAt: s.revisedAt, currentId: s.currentId, currentTitle: s.currentTitle }));
    for (const a of annotationsOf(best)) if (a.kind === 'based-on-revised' && !revised.length) revised.push({ text: a.text, currentId: a.href });
    const text = best.clarificationText ?? mdPlain(best.clarificationMarkdown ?? '');
    result.verdict = verdict;
    result.matchedClaim = bestClaim;
    result.clarification = {
      id: best.id, title: i18n?.title ?? best.title, claim: best.claim, verdict, originalVerdict: best.verdict, text: i18n?.clarification ?? text,
      shareText: i18n?.shareText ?? best.shareText, reportChannel: best.reportChannel, url: best.url ?? '/factcheck/', publishedAt: best.publishedAt, reviewedAt: best.reviewedAt,
      ownerName: best.ownerName ?? ownerNameOf(units, best.owner), outdated, revised,
    };
    result.shareText = result.clarification.shareText; result.reportChannel = best.reportChannel;
    const src = { id: best.id, contentId: best.id, type: 'clarification', title: best.title, url: best.url ?? `/factcheck/#${best.id}`, owner: best.owner, ownerName: result.clarification.ownerName, reviewedAt: best.reviewedAt, isCurrent: !outdated, license: best.license ?? 'OGDL-1.0', lang: result.lang, n: 1 };
    result.sources = [src];
    const sents = splitPlain(result.clarification.text).slice(0, 3);
    result.sentences = sents.map((t) => ({ text: t, cite: [best.id], n: [1] }));
    if (outdated) result.guards.push({ kind: 'clarification-outdated', id: best.id });
    result.actions = [
      ...(result.shareText ? [{ label: tr(LL, '複製可轉傳短訊', 'Copy shareable message'), kind: 'copy', value: result.shareText }] : []),
      ...(best.reportChannel ? [{ label: tr(LL, `通報：${best.reportChannel}`, `Report: ${best.reportChannel}`), kind: 'info' }] : []),
      { label: tr(LL, '撥打 1922', 'Call 1922'), href: 'tel:1922', kind: 'hotline' },
    ];
    return result;
  }
  return { factCheck };
}
