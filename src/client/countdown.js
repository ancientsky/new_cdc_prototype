// 「剩 N 天」「N 天後開放」的瀏覽器端重算（第四十八輪，Issue #97）。
//
// 為什麼：模板在建置時用 site.today 算好倒數字串寫進 HTML；部署網站是靜態檔，建置之後過了幾天，頁面還是寫著建置當天算的天數
// （pages.yml 以固定日期建置時，實際只剩 9 天，網頁卻寫「剩 21 天」）。截止日本身（data-deadline）是不變的事實，天數不是——
// 所以 HTML 只輸出日期與「建置日算的天數」當沒有 JS 時的後備，載入後由這支用瀏覽器現在的日期重算。
// 日界線固定用台灣時間（UTC+8，與 scripts/lib/dates.mjs 的 `T00:00:00+08:00` 一致）：人在外國、裝置時區不是台灣時，
// 「今天截止」仍以台灣的午夜為準。
//
// 標記：<span data-deadline="YYYY-MM-DD" data-kind="left|opens|campaign">建置時算好的文字</span><span class="c-asof">（以建置日計）</span>
//   後面的 .c-asof 是沒有 JS 時的後備提示，css 以 html.js 隱藏（EARLY_JS 在 <head> 就加上 js class，所以不會閃一下）
//   left     → 剩 N 天（notice.daysleft）／今天截止（notice.today）／已過期（notice.closed.on）
//   opens    → N 天後開放（job.opensin）；開放日當天與之後不顯示倒數（清空）
//   campaign → 剩 N 天下架（campaigns.daysleft）
// 把這支放在 ui.js（每個公開頁都會載入），不另開 bundle：只多約 1 KB，不必為倒數的頁面各自再 import 一次。
import './i18n.runtime.js';

const TAIPEI_OFFSET_MS = 8 * 3600 * 1000;

/** 台灣時間的「今天」YYYY-MM-DD。now 可傳毫秒時間戳或 Date（測試用） */
export function taipeiToday(now = Date.now()) {
  return new Date(Number(now) + TAIPEI_OFFSET_MS).toISOString().slice(0, 10);
}

/** 兩個 YYYY-MM-DD 之間差幾天（to - from）；格式不對回 null */
export function dayDiff(from, to) {
  const ok = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s ?? '');
  if (!ok(from) || !ok(to)) return null;
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

/** 依 kind 與剩餘天數決定文字與樣式。t(key, vars) 是 i18n 的 t；回傳 { text, tone }，tone：soon／open／info／closed／ok／warn／'' */
export function countdownView(kind, days, deadline, t) {
  if (days == null) return null;
  if (kind === 'opens') return days > 0 ? { text: t('job.opensin', { n: days }), tone: 'info' } : { text: '', tone: '' };
  if (kind === 'campaign') return { text: t('campaigns.daysleft', { n: Math.max(days, 0) }), tone: days <= 7 ? 'warn' : 'ok' };
  if (days < 0) return { text: t('notice.closed.on', { date: deadline }), tone: 'closed' };
  if (days === 0) return { text: t('notice.today'), tone: 'soon' };
  return { text: t('notice.daysleft', { n: days }), tone: days <= 7 ? 'soon' : 'open' };
}

const TONE_CLASSES = ['c-deadline--soon', 'c-deadline--open', 'c-deadline--info', 'c-deadline--closed', 'c-pill--ok', 'c-pill--warn'];

/** 重算 root 底下所有 [data-deadline]；now 可注入（測試）。回傳處理的元素數 */
export function applyCountdowns(root, t, now = Date.now()) {
  const today = taipeiToday(now);
  let n = 0;
  root.querySelectorAll('[data-deadline]').forEach((el) => {
    const v = countdownView(el.dataset.kind || 'left', dayDiff(today, el.dataset.deadline), el.dataset.deadline, t);
    if (!v) return;
    el.textContent = v.text;
    el.hidden = !v.text;
    el.classList.remove(...TONE_CLASSES);
    if (v.tone) el.classList.add(el.classList.contains('c-pill') ? `c-pill--${v.tone}` : `c-deadline--${v.tone}`);
    n++;
  });
  return n;
}
