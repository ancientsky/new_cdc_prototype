// @ts-check
// 第五十四輪：「可以要求所有存檔都帶版本碼了嗎？」的就緒檢查（docs/deploy.md §26.3）。
//
// Yulun 2026-10-15 同意 §25.6 的建議：稽核紀錄連續約兩週沒有漏帶版本碼，再設 GATEWAY_REQUIRE_BASE_HASH=1。
// 這裡把「連續兩週沒有漏帶」變成可以重跑、結果一致的判斷，而不是請資訊室同事自己去翻 JSONL：
//   - 寫入：同事從頁面送來的存草稿、送審（稽核 fromPage: true；閘道自己組的「不用修改，再送出」、重新審閱不算，它們本來就不需要版本碼）
//   - 漏帶：寫入的稽核記了 baseHash: "missing"；開關打開之後則是被擋的 428（reason: version_required）——兩種都代表「還有頁面或腳本沒帶」
//   - 就緒：最近 N 天（預設 14，台灣日期）沒有任何漏帶，而且這段期間真的有人存過檔（預設至少 1 次；沒人用的兩週不能證明什麼），
//          而且稽核紀錄的雜湊鏈完整（被改過的紀錄不能拿來下判斷）
// 純函式，CLI 是 scripts/gateway-basehash.mjs（npm run gateway:basehash）。
import { verifyAudit } from './store.mjs';

const TZ_MS = 8 * 3600e3;
const WRITE_ACTIONS = new Set(['save-draft', 'submit']);
/** ISO 時間 → 台灣日期 YYYY-MM-DD */
export const taipeiDay = (iso) => new Date(Date.parse(iso) + TZ_MS).toISOString().slice(0, 10);
const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400e3).toISOString().slice(0, 10);

/** 一筆稽核是不是「漏帶版本碼」：照收時記 missing、要求時被擋（428） */
export const isMissing = (e) =>
  WRITE_ACTIONS.has(e.action) && ((e.result === 'ok' && e.baseHash === 'missing') || (e.result === 'denied' && e.reason === 'version_required'));
/** 一筆稽核是不是「同事從頁面送來的寫入」（成功的，或因漏帶被擋的） */
export const isPageWrite = (e) => WRITE_ACTIONS.has(e.action) && ((e.result === 'ok' && (e.fromPage === true || e.baseHash === 'missing')) || isMissing(e));

/**
 * @param {any[]} entries 稽核紀錄（一行一筆，照檔案順序）
 * @param {{ today: string, days?: number, minWrites?: number }} o today：台灣日期 YYYY-MM-DD（含當天往回算 days 天）
 */
export function baseHashReadiness(entries, { today, days = 14, minWrites = 1 }) {
  const chain = verifyAudit(entries);
  const from = addDays(today, -(days - 1));
  const writes = entries.filter(isPageWrite);
  const missing = writes.filter(isMissing);
  const inWindow = (e) => {
    const d = taipeiDay(e.at);
    return d >= from && d <= today;
  };
  const winWrites = writes.filter(inWindow);
  const winMissing = missing.filter(inWindow);
  const lastMissing = missing.at(-1) ?? null;
  const firstDay = entries.length ? taipeiDay(entries[0].at) : null;
  /** 漏帶的來源：同一個帳號＋同一筆內容只列一次，給資訊室去找是哪個頁面或腳本 */
  const sources = [];
  for (const e of winMissing) {
    const key = `${e.actor?.account ?? '?'}|${e.contentId ?? '?'}|${e.action}`;
    const s = sources.find((x) => x.key === key);
    if (s) {
      s.count++;
      s.last = e.at;
    } else
      sources.push({
        key,
        account: e.actor?.account ?? null,
        name: e.actor?.name ?? null,
        unit: e.actor?.unit ?? null,
        contentId: e.contentId ?? null,
        action: e.action,
        result: e.result,
        count: 1,
        first: e.at,
        last: e.at,
      });
  }
  const reasons = [];
  if (!chain.ok) reasons.push(`稽核紀錄的雜湊鏈在第 ${chain.brokenAt} 筆斷了（有人改過或刪過紀錄），不能拿來判斷；請資訊室先查明`);
  if (!firstDay || firstDay > from) reasons.push(`稽核紀錄還不滿 ${days} 天（最早一筆是 ${firstDay ?? '沒有紀錄'}，要從 ${from} 或更早開始）`);
  if (winMissing.length) reasons.push(`最近 ${days} 天（${from}～${today}）有 ${winMissing.length} 次存檔沒帶版本碼，來自 ${sources.length} 個來源`);
  if (winWrites.length < minWrites) reasons.push(`最近 ${days} 天只有 ${winWrites.length} 次從頁面存檔（至少要 ${minWrites} 次，沒人用的期間證明不了什麼）`);
  const cleanSince = lastMissing ? addDays(taipeiDay(lastMissing.at), 1) : firstDay;
  return {
    ready: reasons.length === 0,
    today,
    from,
    days,
    minWrites,
    chain,
    totals: { entries: entries.length, writes: writes.length, missing: missing.length },
    window: { writes: winWrites.length, missing: winMissing.length },
    lastMissing: lastMissing ? { at: lastMissing.at, account: lastMissing.actor?.account ?? null, contentId: lastMissing.contentId ?? null } : null,
    cleanSince,
    sources: sources.map(({ key, ...s }) => s),
    reasons,
  };
}

/** 給人看的報告（資訊室、OASIS） */
export function readinessText(r) {
  const lines = [];
  lines.push(
    r.ready
      ? `✅ 可以打開：最近 ${r.days} 天（${r.from}～${r.today}）${r.window.writes} 次從頁面存檔，全部都帶了版本碼。`
      : `⏳ 還不能打開 GATEWAY_REQUIRE_BASE_HASH=1：`,
  );
  for (const x of r.reasons) lines.push(`  - ${x}`);
  lines.push(`稽核紀錄共 ${r.totals.entries} 筆；從頁面存檔 ${r.totals.writes} 次，其中沒帶版本碼 ${r.totals.missing} 次。`);
  if (r.lastMissing)
    lines.push(
      `最後一次沒帶：${r.lastMissing.at}（帳號 ${r.lastMissing.account ?? '?'}，內容 ${r.lastMissing.contentId ?? '?'}）；從 ${r.cleanSince} 起沒有再發生。`,
    );
  if (r.sources.length) {
    lines.push('最近期間沒帶版本碼的來源（請找出是哪個舊頁面或腳本）：');
    for (const s of r.sources)
      lines.push(
        `  - ${s.name ?? s.account ?? '?'}（${s.account ?? '?'}，${s.unit ?? '?'}）${s.action === 'submit' ? '送審' : '存草稿'} ${s.contentId ?? '?'}：${s.count} 次${s.result === 'denied' ? '（已被擋）' : ''}，最後 ${s.last}`,
      );
  }
  if (r.ready) lines.push('下一步：在閘道的環境變數設 GATEWAY_REQUIRE_BASE_HASH=1 並重新啟動（docs/deploy.md §25.6、§26.3）。');
  return lines.join('\n');
}
