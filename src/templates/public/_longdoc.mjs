// 第二十一輪：長文件閱讀版面（PDF 轉來的指引、手冊）。說明與理由見 docs/pdf-ingest.md 第 8 節、ARCHITECTURE §24。
//
// 問題：114 頁的指引轉成 45 段之後一路攤開，頁面有六萬像素長，目錄是 45 行重複「第一章 疾病介紹 · …」的長標題，
// 手機上變成 45 顆按鈕；讀者找不到自己要的那一節，也看不出文件有幾章。
// 做法（只改呈現，不改資料；sections、#s-{key}、#page-N 錨點都不變，所以智慧查詢的引用連結照樣有效）：
//   1. 依段落 key 分章（ch1-*、ch2-*…；附件 annex-* 併成一組），頂端一排章節卡：章名、頁碼範圍、節數。
//   2. 章底下每一節是 <details>：標題只留「第一節 疾病特性」（章名已在上面），右邊標頁碼；預設收合。
//      章的導言（ch2 這種 level 2、key 等於章代號的段落）直接攤開，讀者先看到這章在講什麼。
//   3. 表單、地圖附件標「表單（看 PDF）」，展開只剩一句「請看 PDF 第 N 頁」，不再佔版面。
//   4. 「一、（一）1.（1）」開頭的段落依層級縮排、短標題加粗；頁碼標記縮成右側小字。
//   5. 連到 #page-N 或 #s-{key} 時，ui.js 會打開所在的那一節再捲過去；列印前全部展開。
// 為什麼用 <details> 而不是分頁（每章一頁）：一頁才能 Ctrl+F 全文搜尋、整份列印，而且答案引用的網址不用改；
// <details> 沒有 JavaScript 也能用（螢幕報讀器會念「已收合／已展開」），Chrome 連到收合區塊裡的錨點也會自動展開。
import { html, raw } from '../../../scripts/lib/render.mjs';

/**
 * 要不要用長文件版面：有頁碼範圍（PDF 轉來）或段落很多。短文件（5～10 段的病例定義、建議）維持原樣。
 * 第二十八輪：核心教材（doc.docType === 'curriculum'）一律套用——教材是「分章讀」的文件，就算章節少也要章節卡與收合。
 */
export function isLongDoc(sections = [], doc = null) {
  return doc?.docType === 'curriculum' || sections.some((s) => Array.isArray(s.pages)) || sections.length >= 12;
}

const segs = (heading) => String(heading ?? '').split(' · ').map((x) => x.trim()).filter(Boolean);
const span = (list) => {
  const ps = list.flatMap((s) => (Array.isArray(s.pages) ? s.pages : []));
  return ps.length ? [Math.min(...ps), Math.max(...ps)] : null;
};

/**
 * 段落 → 章組。回傳 [{ id, key, title, kind: 'chapter'|'annex'|'single', pages, intro, items: [{ s, part, short }] }]，順序同原文。
 * - ch{N}* 同一章：title 取標題第一段（「第一章 疾病介紹」）；key 剛好是 ch{N} 的段落是導言。
 *   三段式標題（「第一章 疾病介紹 · 登革熱 · 第一節 疾病特性」）的中間段是分部（登革熱／屈公病），最後一段是短標題。
 * - annex-* 全部併成「附件」一組，短標題用完整附件名。
 * - 其他（前言、參考文獻、一般文件的段落）各自一組，整段當導言。
 */
export function groupSections(sections = [], { annexTitle = '附件' } = {}) {
  const groups = [];
  const byId = new Map();
  for (const s of sections) {
    const key = String(s.key ?? '');
    const ch = key.match(/^(ch\d+)(?:-|$)/)?.[1];
    const gid = ch ?? (/^annex-/.test(key) ? 'annex' : key);
    let g = byId.get(gid);
    if (!g) {
      const kind = ch ? 'chapter' : gid === 'annex' ? 'annex' : 'single';
      g = { id: gid, key: gid, kind, title: kind === 'annex' ? annexTitle : segs(s.heading)[0] ?? key, intro: null, items: [] };
      byId.set(gid, g);
      groups.push(g);
    }
    if (g.kind === 'single' || (g.kind === 'chapter' && key === ch)) { g.intro = s; continue; }
    const p = segs(s.heading);
    const short = g.kind === 'annex' ? s.heading : p.length > 1 ? p[p.length - 1] : s.heading;
    const part = g.kind === 'chapter' && p.length > 2 ? p[1] : null;
    g.items.push({ s, part, short });
  }
  for (const g of groups) g.pages = span([g.intro, ...g.items.map((i) => i.s)].filter(Boolean));
  return groups;
}

// ── 公文條列縮排：壹、→ 一、→（一）→ 1. →（1）。後面沒有編號的段落沿用上一個編號的內文縮排。 ──
const MARKERS = [
  [0, /^[壹貳參肆伍陸柒捌玖拾]+、/],
  [1, /^[一二三四五六七八九十]+、/],
  [2, /^[（(][一二三四五六七八九十]+[）)]/],
  [3, /^\d+\s*[.、．]/],
  [4, /^[（(]\d+[）)]/],
];
const levelOf = (text) => MARKERS.find(([, re]) => re.test(text))?.[0] ?? null;
const plain = (h) => h.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();

/** 對 md() 產生的 HTML 加縮排 class：c-ol{層級}（編號段落）、c-olc{層級}（接續段落、清單）、c-olh（短的編號標題）。 */
export function outline(htmlStr) {
  let cur = null; // 目前所在的編號層級
  return String(htmlStr).replace(/<(p|ol|ul)>([\s\S]*?)<\/\1>/g, (m, tag, inner) => {
    if (tag === 'p') {
      const text = plain(inner);
      const lv = levelOf(text);
      if (lv != null) {
        cur = lv;
        const head = lv <= 1 && text.length <= 24 && !/[。；]$/.test(text);
        return `<p class="c-ol${lv}${head ? ' c-olh' : ''}">${inner}</p>`;
      }
    }
    return cur == null ? m : `<${tag} class="c-olc${cur}">${inner}</${tag}>`;
  });
}

const pagesLabel = (t, p) => (!p ? '' : p[0] === p[1] ? t('ld.page', { a: p[0] }) : t('ld.pages', { a: p[0], b: p[1] }));

/**
 * 長文件主欄：章節卡＋展開收合鈕＋各章。body(s) 由呼叫端提供（含頁碼錨點，與舊版面同一套）。
 */
export function longDocMain(ctx, sections, body) {
  const { t } = ctx;
  const groups = groupSections(sections, { annexTitle: t('ld.annex') });
  const kindTag = (s) => (s.kind === 'form' ? t('ld.form') : s.kind === 'figure' ? t('ld.figure') : '');
  const item = (it) => html`<details class="c-ldsec${it.s.kind && it.s.kind !== 'text' ? ' c-ldsec--pdfonly' : ''}" id="s-${it.s.key}">
    <summary><span class="c-ldsec__t">${it.short}</span>${kindTag(it.s) ? html`<span class="c-ldsec__kind">${kindTag(it.s)}</span>` : ''}<span class="c-ldsec__p">${pagesLabel(t, it.s.pages)}</span></summary>
    <div class="c-ldsec__body c-prose">${raw(outline(body(it.s)))}</div>
  </details>`;
  const items = (g) => {
    let part = null;
    return g.items.map((it) => {
      const head = it.part && it.part !== part ? html`<h3 class="c-ldpart">${it.part}</h3>` : '';
      part = it.part ?? part;
      return html`${head}${item(it)}`;
    });
  };
  // 不入索引的單段（參考文獻）也收合；其他單段（前言）直接攤開
  const intro = (g) => {
    const s = g.intro;
    if (!s) return '';
    if (g.kind === 'single' && s.index === false) return item({ s, short: s.heading });
    return html`<div class="c-ldintro c-prose" id="s-${s.key}">${raw(outline(body(s)))}</div>`;
  };
  const count = (g) => g.items.length;
  return html`<nav class="c-ldmap" id="ld-map" aria-label="${t('ld.map')}">
    <h2 class="c-ldmap__t">${t('ld.map')}</h2>
    <ol class="c-ldmap__list">${groups.map((g) => html`<li><a href="#g-${g.id}"><span class="c-ldmap__name">${g.title}</span><span class="c-ldmap__meta">${pagesLabel(t, g.pages)}${count(g) ? html` · ${t('ld.count', { n: count(g) })}` : ''}</span></a></li>`)}</ol>
    <p class="c-ldmap__tools"><span class="muted">${t('ld.hint')}</span> <button type="button" class="c-btn c-btn--ghost c-btn--sm" data-ld-toggle="open">${t('ld.expand')}</button> <button type="button" class="c-btn c-btn--ghost c-btn--sm" data-ld-toggle="close">${t('ld.collapse')}</button></p>
  </nav>
  <div class="c-longdoc">${groups.map((g) => html`<section class="c-ldch c-ldch--${g.kind}" id="g-${g.id}">
    <h2><span>${g.title}</span><span class="c-ldch__p">${pagesLabel(t, g.pages)}</span><a class="c-ldch__top" href="#ld-map">${t('ld.top')}</a></h2>
    ${intro(g)}
    ${items(g)}
  </section>`)}</div>`;
}

/** 側欄目錄：章為第一層，節為第二層（短標題）。 */
export function longDocToc(ctx, sections, { before = '', after = '' } = {}) {
  const { t } = ctx;
  const groups = groupSections(sections, { annexTitle: t('ld.annex') });
  return html`<nav class="c-aside-card c-toc c-toc--long" aria-label="${t('disease.toc')}"><h2>${t('disease.toc')}</h2><ol>${before}${groups.map((g) => html`<li><a href="#g-${g.id}">${g.title}</a>${g.items.length ? html`<ol>${g.items.map((it) => html`<li><a href="#s-${it.s.key}">${it.part ? `${it.part}・` : ''}${it.short}</a></li>`)}</ol>` : ''}</li>`)}${after}</ol></nav>`;
}
