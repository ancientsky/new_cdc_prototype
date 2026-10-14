// 第四十九輪：清單／導覽頁的「顯示什麼語言的標題、連到哪個語言的頁面」共用規則。
// 為什麼獨立成檔：_partials.mjs 的 titleLink 是第四十輪的全站清單規則（顯示英文標題時仍連到中文頁，因為當時英文頁不一定存在）；
// 網站導覽、申請服務總覽這類「列出全站」的頁面需要更嚴格：顯示英文標題就連到英文頁（頁面真的存在才連），中文獨有的項目整批標示、不假裝是頁面語言。
import { html, raw, makeUrl } from '../../../scripts/lib/render.mjs';
import { localText, langOk, itemPath, langSpan, zhOnlyTag } from './_partials.mjs';

/**
 * 該項目在清單中該連到哪裡：頁面語言有版本 → 頁面語言；否則英文有版本（且頁面不是英文）→ 英文；否則中文正本（來源語言）。
 * 回傳 { href, hreflang }（hreflang 為 null 表示與頁面同語言）。
 * 連到英文頁時要求 langOk(en)；makeUrl 本身也會查頁面登錄表，英文頁不存在會退回無前綴（中文）網址，所以不會產生死連結。
 */
export function listTarget(ctx, item) {
  const p = itemPath(item);
  const src = item.sourceLang ?? 'zh-TW';
  if (langOk(ctx.site, item, ctx.lang)) return { href: ctx.url(p), hreflang: null };
  if (ctx.lang !== 'en' && langOk(ctx.site, item, 'en') && (item.i18n?.en || src === 'en')) return { href: makeUrl('en')(p), hreflang: 'en' };
  return { href: ctx.url(p, { noLang: true }), hreflang: src };
}

/** 清單項目的文字與連結（不含「僅有中文」標記；中文獨有者由呼叫端決定整批怎麼標） */
export function listEntry(ctx, item, { field = 'title', fallbackField = null } = {}) {
  let r = localText(ctx, item, field);
  if ((r.text == null || r.text === '') && fallbackField) r = localText(ctx, item, fallbackField);
  return { item, r, ...listTarget(ctx, item) };
}

export const entryLink = (ctx, e, { cls = '' } = {}) =>
  html`<a${cls ? raw(` class="${cls}"`) : ''} href="${e.href}"${e.hreflang ? raw(` hreflang="${e.hreflang}"`) : ''}>${langSpan(ctx, e.r)}</a>`;

/** 把一批項目分成「頁面語言或英文有標題」與「只有中文」兩堆（zh-TW 頁全部算第一堆） */
export function splitByLang(ctx, entries) {
  if (ctx.lang === 'zh-TW') return { native: entries, zhOnly: [] };
  return { native: entries.filter((e) => !e.r.zhOnly), zhOnly: entries.filter((e) => e.r.zhOnly) };
}

/** 單一項目旁的「僅有中文」小標（短清單用；長清單改用 splitByLang 收進摺疊區） */
export const zhOnlyBadge = (ctx, e) => (e.r.zhOnly ? html`${zhOnlyTag(ctx)} ` : '');

/**
 * 內文區塊（Markdown 本文、摘要）的語言選擇：頁面語言 → 英文 → 中文（與清單標題同一條 localText 規則）。
 * 回傳 { text, lang, zhOnly, shown }：shown＝'' 表示就是頁面語言；'en' 表示頁面語言沒有、改用英文；'zh-TW' 表示只有中文。
 * 呼叫端把 lang 屬性加在包住文字的元素上（`langAttr(ctx, r)`），並用 `shownNote(ctx, r)` 在區塊前加一行說明。
 */
export function pick(ctx, item, field) {
  const r = localText(ctx, item, field);
  return { ...r, shown: r.lang === ctx.lang ? '' : r.lang };
}
/** 與頁面語言不同時回傳 ` lang="xx"`（給 html 模板用 raw 插入） */
export const langAttr = (ctx, r) => (r.lang && r.lang !== ctx.lang ? raw(` lang="${r.lang}"`) : '');
/** 區塊前的小說明：英文後備→「Shown in English」；只有中文→「僅有中文」標記。頁面語言本身不顯示 */
export function shownNote(ctx, r) {
  if (!r.shown) return '';
  return r.shown === 'en' ? html`<p class="c-shown"><span class="c-zhonly">${ctx.t('i18n.shownEn')}</span></p>` : html`<p class="c-shown">${zhOnlyTag(ctx)}</p>`;
}

/**
 * 一級內容（疾病、疫苗、澄清、疫情）專用的取字：只認 reviewed 的譯文（頁面語言 → 英文），否則中文正本。
 * 為什麼另寫一個而不是用 localText：localText 不看審核狀態（二級內容可用機器初稿），一級內容規則是機器初稿不上線（docs/i18n.md §4）。
 */
export function reviewedText(ctx, item, field = 'title') {
  const src = item.sourceLang ?? 'zh-TW';
  if (ctx.lang === src) return { text: item[field], lang: src, zhOnly: false, shown: '' };
  const ok = (l) => item.languages?.[l]?.status === 'reviewed' && item.i18n?.[l]?.[field];
  if (ok(ctx.lang)) return { text: item.i18n[ctx.lang][field], lang: ctx.lang, zhOnly: false, shown: '' };
  if (ctx.lang !== 'zh-TW' && ok('en')) return { text: item.i18n.en[field], lang: 'en', zhOnly: false, shown: 'en' };
  const zh = src === 'zh-TW' ? item[field] : (item.i18n?.['zh-TW']?.[field] ?? item[field]);
  return { text: zh, lang: 'zh-TW', zhOnly: ctx.lang !== 'zh-TW', shown: ctx.lang === 'zh-TW' ? '' : 'zh-TW' };
}
/** 外語頁上沒有譯文的中文片段（表格儲存格、備註）：包 lang="zh-TW"，不假裝是頁面語言 */
export const zhText = (ctx, text) => (ctx.lang === 'zh-TW' || text == null || text === '' ? text : html`<span lang="zh-TW">${text}</span>`);

/**
 * 翻譯狀態標記該顯示哪一種：狀態不是 reviewed ＝ 機器；reviewed 但實際顯示的欄位列在 `i18n.<lang>.machineFields`（審核後才補上的機器初稿）＝ 機器。
 * 為什麼要有 machineFields：頁面型內容（page）的英文常是「標題與摘要已審、本文尚未譯」；補本文的機器初稿時不能順便把整頁標成 reviewed，
 * 也不能把 languages.en 降級（會讓已審的標題摘要也被當成機器）。逐欄記錄＝誠實，審核通過後刪掉該欄位名稱即可。
 */
export function badgeKind(item, lang, fields = []) {
  if (item.languages?.[lang]?.status !== 'reviewed') return 'machine';
  const mf = item.i18n?.[lang]?.machineFields ?? [];
  return fields.some((f) => mf.includes(f)) ? 'machine' : 'reviewed';
}
