// 答案頁元件的 HTML 產生器（字串），答案頁、謠言查證、統計問答共用。全部插值經 esc()。
// 元件：4 AI 回答標示、5 拒答卡、6 回報與稽核編號、9 數字的來源卡；來源卡（三層露出）、態勢卡、判定 pill。
import { esc, url, LANG, barChart } from './data.js';
// 第四十輪：直接從 text.js／rules.js 取，不經 core.js——core.js 是整個引擎（約 70 KB），答案頁要等使用者提問才載入，畫面元件不能把它拉進初始載入
import { pdfHref } from './text.js';
import { isLowRelevance } from './rules.js';

// ───────── UI 字串（第四十八輪，#100：七語齊備，且依語言拆檔） ─────────
// 字串表在 src/client/i18n.ask.js（key 以 ans. 開頭），由 scripts/lib/i18n-split.mjs 依語言拆進 dist/assets/js/i18n.<lang>.js：
// 答案頁只下載當頁語言那一份，不再把七種語言全打包進 render.js（原本補齊 th／id／tl／ja 後會超出 240 KB 的引擎頁預算）。
// 瀏覽器：window.CDC.I18N 就是當頁語言（已套用 語言→英文→中文 的 fallback）。Node（測試、評估）：動態載入完整 i18n.js；
// 瀏覽器永遠不會執行這一行（下面的 globalThis.process 判斷），預算掃描也只追靜態 import，所以不計入上線大小。
const NODE_STRINGS = globalThis.process?.versions?.node ? (await import('../i18n.js')).STRINGS : null;
const ARRAY_KEYS = new Set(['reportKinds', 'channels']); // 以「|」串接存放的清單
const stringFor = (lang, key) => {
  const tab = globalThis.window?.CDC?.I18N;
  if (tab?.lang === lang) return tab.S[`ask.ui.${key}`];
  const S = NODE_STRINGS;
  return S ? (S[lang]?.[`ask.ui.${key}`] ?? S.en?.[`ask.ui.${key}`] ?? S['zh-TW']?.[`ask.ui.${key}`]) : undefined;
};
/** 介面字串；lang 預設為頁面語言（第四十輪：可指定語言，測試七語字串用） */
export function L(key, vars = {}, lang = LANG) {
  let v = stringFor(lang, key);
  if (v == null && lang !== 'zh-TW') v = stringFor('zh-TW', key);
  if (v == null) return key;
  if (ARRAY_KEYS.has(key)) return v.split('|');
  return v.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
}

// 權責單位名稱依頁面語言顯示（第四十八輪，#100）：索引分片裡的 ownerName 一律是中文，/en/ask/ 的來源卡因此出現「檢疫組」。
// 單位主檔（content/master/units.json → v1/units.json）有 nameEn；引擎載入後由 ui.js／factcheck.js／stats.js 呼叫 setUnits(deps.units)。
// 非中文頁一律用英文名（站內其他頁的 unitName() 也是這個規則），主檔查不到才退回中文，不顯示空白。
let UNIT_BY_ID = new Map();
let UNIT_BY_NAME = new Map();
export function setUnits(units) {
  UNIT_BY_ID = new Map((units ?? []).map((u) => [u.id, u]));
  UNIT_BY_NAME = new Map((units ?? []).map((u) => [u.name, u]));
}
export function ownerLabel(src) {
  const zh = src?.ownerName ?? src?.owner ?? '';
  if (LANG === 'zh-TW') return zh;
  const u = UNIT_BY_ID.get(src?.owner) ?? UNIT_BY_NAME.get(src?.ownerName);
  return u?.nameEn ?? zh;
}

const STATUS = { stable: { 'zh-TW': '平穩', en: 'Stable' }, rising: { 'zh-TW': '上升', en: 'Rising' }, peak: { 'zh-TW': '高峰', en: 'Peak' }, declining: { 'zh-TW': '下降', en: 'Declining' } };
const statusLabel = (s) => STATUS[s]?.[LANG] ?? STATUS[s]?.en ?? s;
const isExternal = (h) => /^https?:/.test(h ?? '');

export function link(href, text, cls = '') {
  const ext = isExternal(href);
  return `<a class="${cls}" href="${esc(url(href))}"${ext ? ' rel="noopener" target="_blank"' : ''}>${esc(text)}${ext ? `<span class="sr-only">${esc(L('newWindow'))}</span>` : ''}</a>`;
}

const LICENSE_LABEL = { 'OGDL-1.0': '政府資料開放授權條款第 1 版', 'CC0-1.0': 'CC0 1.0', 'CC-BY-4.0': 'CC BY 4.0' };

/** 來源卡內容（三層露出的按需層）。pro：加版次／生效日／取代、引用本頁、訂閱異動 */
export function sourceCardBody(src, { pro = false } = {}) {
  const rows = [];
  const add = (k, v) => { if (v) rows.push(`<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`); };
  add(L('canonical'), link(src.url, src.docTitle ?? src.title));
  if (src.type === 'master') {
    add(L('notifyCategory'), src.legalCategory ? `<span class="c-notify-pill c-notify-pill--${esc(src.legalCategory)}">${esc(catLabel(src.legalCategory))}</span>` : '');
    add(L('notifyH'), esc(src.hoursLabel ?? ''));
    add(L('masterBasis'), esc(L('masterNote')));
  }
  // 第十四輪：疫苗接種時程表（主檔）來源卡
  if (src.type === 'schedule') add(L('scheduleBasis'), esc(L('scheduleNote')));
  rows.push(...typeRows(src).map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`));
  add(L('owner'), esc(ownerLabel(src)));
  add(L('reviewed'), src.reviewedAt ? `<time datetime="${esc(src.reviewedAt)}">${esc(src.reviewedAt)}</time>` : '');
  if (src.verification === 'pending') add(L('verification'), `<span class="c-tag c-tag--warn">${esc(L('verificationPending'))}</span>`);
  add(L('current'), src.isCurrent === false ? `<span class="c-tag c-tag--warn">${esc(L('currentNo'))}</span>` : esc(L('currentYes')));
  add(L('license'), esc(LICENSE_LABEL[src.license] ?? src.license ?? 'OGDL-1.0'));
  if (pro || src.version) {
    add(L('version'), esc(src.version ?? ''));
    add(L('effective'), esc(src.effectiveAt ?? ''));
    if (src.section?.heading) add(L('section'), esc(src.section.no ? `第 ${src.section.no} 條 ${src.section.heading}` : src.section.heading));
    if (src.pdfPage) add(L('pdfPage'), esc(String(src.pdfPage)));
    if (src.extraction) add(L('extraction'), src.extraction.reviewStatus === 'reviewed' ? esc(L('extractionReviewed')) : `<span class="c-tag c-tag--warn">${esc(L(src.extraction.sourceKind === 'reconstructed' ? 'extractionReconstructed' : 'extractionMachine'))}</span>`);
    if (src.supersedes) add(L('supersedes'), `${esc(src.supersedesVersion ?? '')} ${link(`/documents/${String(src.supersedes).replace(/^doc\./, '')}/`, src.supersedes)}`);
    if (src.change?.before || src.change?.after) add(L('change'), `${src.change.before ? `<del>${esc(src.change.before)}</del> → ` : ''}<ins>${esc(src.change.after ?? '')}</ins>`);
    if (pro) add(L('nextReview'), esc(src.nextReviewAt ?? ''));
  }
  const btns = [
    link(src.url, L('openOriginal'), 'c-btn c-btn--sm'),
    src.mdUrl ? link(src.mdUrl, L('machine'), 'c-btn c-btn--sm c-btn--ghost') : '',
    src.extraction?.pdfUrl ? link(pdfHref(src), L('openPdf'), 'c-btn c-btn--sm c-btn--ghost') : '',
  ];
  if (pro) {
    btns.push(`<button type="button" class="c-btn c-btn--sm c-btn--ghost" data-answer-cite="${esc(src.id)}">${esc(L('cite'))}</button>`);
    btns.push(`<button type="button" class="c-btn c-btn--sm c-btn--ghost" data-subscribe="${esc(src.contentId ?? src.id)}" data-on="${esc(L('subscribed'))}" data-off="${esc(L('subscribe'))}" aria-pressed="false">${esc(L('subscribe'))}</button>`);
  }
  return `<dl class="c-deflist c-deflist--sm">${rows.join('')}</dl><p class="c-source-card__actions">${btns.join(' ')}</p>`;
}

const CAT_ZH = { 1: '一', 2: '二', 3: '三', 4: '四', 5: '五' };
const catLabel = (c) => (LANG === 'zh-TW' ? `第${CAT_ZH[c] ?? c}類` : `Category ${c}`);
export function mmss(t) { const n = Math.max(0, Math.round(Number(t) || 0)); return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`; }

/** 來源卡型別專屬列：media（海報、章節時間戳）、service（步驟數、處理天數、表單）、labtest（檢體表縮版）、公告（截止） */
export function typeRows(src) {
  const rows = [];
  if (src.type === 'media') {
    const label = `${L(`media.${src.mediaType ?? 'video'}`)}${src.chapter?.label ? ` · ${src.chapter.label}` : ''} · ${src.timeLabel ?? mmss(src.t)}`;
    rows.push([L('media.video'), `${src.poster ? `<img class="c-source-card__poster" src="${esc(url(src.poster, { noLang: true }))}" alt="" width="96" height="54" loading="lazy" onerror="this.remove()">` : ''}${link(src.url, L('watchAt', { t: src.timeLabel ?? mmss(src.t) }))} <span class="muted">${esc(label)}</span>`]);
    if (src.basedOnVersionLabel) rows.push([L('basedOnLabel'), esc(src.basedOnVersionLabel)]);
    if (src.producedAt) rows.push([L('producedAt'), esc(src.producedAt)]);
  }
  if (src.type === 'service') {
    if (src.stepsCount) rows.push([L('steps'), esc(L('stepsN', { n: src.stepsCount }))]);
    if (src.slaDays != null) rows.push([L('slaDays'), esc(L('days', { n: src.slaDays }))]);
    if (src.fee) rows.push([L('fee'), esc(src.fee)]);
    if (src.forms?.length) rows.push([L('forms'), src.forms.slice(0, 3).map((f) => link(f.href, `${f.label}${f.format ? `（${f.format}）` : ''}`)).join('、')]);
  }
  if (src.type === 'labtest' && src.specimen) {
    const sp = src.specimen;
    const cells = [[L('container'), sp.container], [L('volume'), sp.volume], [L('timing'), sp.timing], [L('storage'), sp.storage], [L('transport'), sp.transport], [L('tests'), (sp.tests ?? []).join('、')], [L('turnaround'), sp.turnaroundDays != null ? L('days', { n: sp.turnaroundDays }) : ''], [L('sendWithin'), src.sendWithinHours != null ? L('hours', { n: src.sendWithinHours }) : ''], [L('labs'), (src.labs ?? []).join('、')]].filter(([, v]) => v);
    rows.push([`${L('specimen')}：${sp.name}`, `<table class="c-table c-table--sm c-labtest-mini"><tbody>${cells.map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</tbody></table>`]);
  }
  if (src.deadlineAt) rows.push([L('deadline'), `${esc(src.deadlineAt)}${src.closed ? ` <span class="c-tag c-tag--warn">${esc(L('closed'))}</span>` : ''}`]);
  return rows;
}

/** 來源卡摘要列（summary 第二行）：依型別顯示「影片 · 章節 · mm:ss」「主檔 · 依法公告」等 */
export function sourceMeta(s) {
  if (s.type === 'media') return `${L(`media.${s.mediaType ?? 'video'}`)}${s.chapter?.label ? ` · ${s.chapter.label}` : ''} · ${s.timeLabel ?? mmss(s.t)}${s.producedAt ? ` · ${L('producedAt')} ${s.producedAt}` : ''}`;
  if (s.type === 'schedule') return `${ownerLabel(s)} · ${L('scheduleBasis')}`;
  if (s.type === 'master') return `${s.subject ?? ''}${s.legalCategory ? ` · ${catLabel(s.legalCategory)}` : ''}${s.hoursLabel ? ` · ${s.hoursLabel}` : ''}`;
  if (s.type === 'service') return `${ownerLabel(s)}${s.stepsCount ? ` · ${L('stepsN', { n: s.stepsCount })}` : ''}${s.slaDays != null ? ` · ${L('slaDays')} ${L('days', { n: s.slaDays })}` : ''}`;
  if (s.type === 'labtest') return `${ownerLabel(s)}${s.specimen?.name ? ` · ${s.specimen.name}` : ''}${s.sendWithinHours != null ? ` · ${L('sendWithin')} ${L('hours', { n: s.sendWithinHours })}` : ''}`;
  if (s.historical) return `${ownerLabel(s)} · ${L('historicalSrc', { d: s.publishedAt ?? s.reviewedAt ?? '' })}`;
  return `${ownerLabel(s)} · ${L('reviewed')} ${s.reviewedAt ?? ''}${s.version ? ` · ${s.version}` : ''}${s.closed ? ` · ${L('closed')}` : ''}`;
}

/** 通報時限結構化卡（類別 pill、時限大字、連結）：r.notify 存在時取代一般句子列表的上方 */
export function notifyBlock(result) {
  const n = result.notify; if (!n?.items?.length) return '';
  const card = (it) => `<article class="c-notify-card c-notify-card--${esc(it.legalCategory)}">
      <header><span class="c-notify-pill c-notify-pill--${esc(it.legalCategory)}">${esc(it.categoryLabel ?? catLabel(it.legalCategory))}</span> <h3>${esc(it.name)}${it.nameEn ? ` <span class="muted">${esc(it.nameEn)}</span>` : ''}</h3></header>
      <p class="c-notify-card__hours"><span class="c-notify-card__lead">${esc(L('notifyWithin'))}</span> <b>${esc(it.hoursLabel)}</b>${it.count ? ` <span class="muted">· ${esc(it.count)}</span>` : ''}</p>
      <p class="c-notify-card__links">${[
    link(it.reportUrl ?? '/report/', L('notifyReport'), 'c-btn c-btn--sm'),
    it.caseDefinitionUrl ? link(it.caseDefinitionUrl, L('caseDef'), 'c-btn c-btn--sm c-btn--ghost') : '',
    it.labtestUrl ? link(it.labtestUrl, L('labtestLink'), 'c-btn c-btn--sm c-btn--ghost') : '',
    it.diseaseUrl ? link(it.diseaseUrl, L('diseasePage'), 'c-btn c-btn--sm c-btn--ghost') : '',
  ].filter(Boolean).join(' ')}</p>
    </article>`;
  return `<section class="c-answer__notify" aria-labelledby="notify-h"><h2 id="notify-h">${esc(L('notifyH'))} <span class="c-answer__sub">· ${esc(n.basis ?? L('masterBasis'))}</span></h2>
    <div class="c-notify-grid">${n.items.map(card).join('')}</div>
    ${n.note ? `<p class="c-answer__notify-note">${esc(n.note)}</p>` : ''}</section>`;
}

/** APA 式引用（含審閱日） */
export function apaCitation(src) {
  const owner = src.ownerName ?? '衛生福利部疾病管制署';
  const date = src.effectiveAt ?? src.reviewedAt ?? '';
  const abs = new URL(url(src.url), location.origin).href;
  return `${owner}（${date ? date.slice(0, 4) : 'n.d.'}）。${src.docTitle ?? src.title}${src.version ? `（${src.version}）` : ''}。衛生福利部疾病管制署。最後審閱 ${src.reviewedAt ?? ''}。${abs}`;
}

/** §39.4 */
export function conflictNotes(result) {
  if (!result.conflicts?.length) return '';
  return result.conflicts.map((c) => `<div class="c-alert c-alert--overdue c-answer__conflict" role="note"><p><strong>${esc(L('conflictH'))}</strong> ${esc(L('conflictText', {
    a: c.prefer.title, ad: c.prefer.date ?? '', av: (c.prefer.values ?? []).join('、'), b: c.other.title, bd: c.other.date ?? '', bv: (c.other.values ?? []).join('、'), u: c.unit,
  }))}</p><p>${link(c.prefer.url, c.prefer.title)} · ${link(c.other.url, c.other.title)}</p></div>`).join('');
}

/** 「答案來源」卡列表 */
export function sourceList(sources, { pro = false } = {}) {
  if (!sources?.length) return '';
  return `<section class="c-answer__sources" aria-labelledby="ans-src-h"><h3 id="ans-src-h">${esc(L('sourcesH'))}</h3><ol class="c-source-list">${sources.map((s) => `
    <li id="src-${esc(s.n)}"><details class="c-source-card c-source-card--${esc(s.type ?? 'content')}" data-group="answer-sources"${pro ? ' open' : ''}>
      <summary><span class="c-source-card__n" aria-hidden="true">${esc(s.n)}</span><span class="c-source-card__t">${s.type === 'media' ? '<span class="c-source-card__kind" aria-hidden="true">▶</span> ' : ''}${esc(s.title)}</span><span class="c-source-card__m">${esc(sourceMeta(s))}</span></summary>
      <div class="c-source-card__body">${sourceCardBody(s, { pro })}</div>
    </details></li>`).join('')}</ol></section>`;
}

/** 句子＋來源編號（點開浮出來源卡） */
export function sentenceList(result, { pro = false } = {}) {
  const byN = new Map((result.sources ?? []).map((s) => [s.n, s]));
  return `<ol class="c-answer__sents">${(result.sentences ?? []).map((s, i) => `
    <li class="c-answer__sent${s.closed ? ' c-answer__sent--closed' : ''}"><p>${esc(s.text)}${(s.n ?? []).map((n) => `<sup><button type="button" class="c-cite" aria-expanded="false" aria-controls="cite-pop-${i}-${n}" data-n="${esc(n)}" aria-label="${esc(`${L('sourcesH')} ${n}：${byN.get(n)?.title ?? ''}`)}">${esc(n)}</button></sup>`).join('')}</p>
      ${pro && s.citeLabel ? `<p class="c-answer__citelabel">${esc(s.citeLabel)}</p>` : ''}
      ${s.original ? `<p class="c-answer__original" lang="zh-TW">${esc(s.original)}</p>` : ''}
      ${(s.n ?? []).map((n) => `<div class="c-source-card c-cite-pop" id="cite-pop-${i}-${n}" role="region" aria-label="${esc(`${L('sourcesH')} ${n}`)}" hidden><p class="c-cite-pop__t"><b>${esc(n)}</b> ${esc(byN.get(n)?.title ?? '')}</p>${byN.get(n) ? sourceCardBody(byN.get(n), { pro }) : ''}</div>`).join('')}
    </li>`).join('')}</ol>`;
}

/** 第二十五輪：相關度高於拒答線但偏低 ⇒ 顯示「相關程度較低」，且不再把「僅引用官方內容」當成信心宣稱 */
export { isLowRelevance };

/**
 * 第四十輪（issue #84）：這次有沒有「產生答案」。拒答、查無、找不到澄清或統計時，畫面上只有固定說明文字與連結，
 * 沒有任何 AI 整理的句子 ⇒ 不該掛「AI 整理」標章與「模型：抽取式整理」（那等於宣稱 AI 回答了）。
 */
export function isNoAnswer(result) {
  if (!result || result.paused) return false;
  return !!result.refused || (!result.sentences?.length && !result.stats && !result.clarification && !result.situation);
}

/** 元件 4＋6：AI 揭露列、有幫助、回報（帶稽核編號）。未產生答案時改為中性說明（稽核編號、回報照留，方便追查拒答是否合理） */
export function disclosureRow(result) {
  const d = result.disclosure ?? {};
  const model = d.mode === 'llm' || d.provider ? L('modelLlm', { p: d.provider ?? 'Anthropic', m: d.model ?? '' }) : L('modelExtractive');
  const none = isNoAnswer(result);
  const head = none
    ? `<p><span class="c-noanswer-badge">${esc(L('noAnswerBadge'))}</span> ${esc(L('noAnswer'))}</p>`
    : `<p><span class="c-ai-badge">${esc(L('aiBadge'))}</span> ${esc(L('disclosure'))} <span class="c-ai-disclosure__model">${esc(model)}</span>${d.transcript ? ` <span class="c-ai-disclosure__transcript">${esc(d.note ?? L('transcriptNote'))}</span>` : ''}</p>`;
  return `<div class="c-ai-disclosure${none ? ' c-ai-disclosure--none' : ''}" data-feedback data-audit-id="${esc(result.auditId)}" data-page="${esc(location.pathname)}"${none ? ' data-no-answer' : ''}>
    ${head}
    <p class="c-ai-disclosure__meta"><span>${esc(L('auditId'))} <code data-audit-slot>${esc(result.auditId)}</code></span>
      <button type="button" class="c-btn c-btn--sm c-btn--ghost" data-act="helpful" aria-pressed="false">${esc(L('helpful'))}</button></p>
    <details class="c-answer-report" data-group="answer-report"><summary class="c-btn c-btn--sm c-btn--ghost">${esc(L('report'))}</summary>
      <form class="c-feedback__form" data-answer-report>
        <p><b>${esc(L('reportH'))}</b> · ${esc(L('auditId'))} <code>${esc(result.auditId)}</code></p>
        <fieldset><legend>${esc(L('reportKind'))}</legend>${L('reportKinds').map((k, i) => `<label><input type="radio" name="kind" value="${esc(k)}"${i === 0 ? ' checked' : ''}> ${esc(k)}</label>`).join(' ')}</fieldset>
        <p><label>${esc(L('reportText'))}<br><textarea name="text" rows="3" maxlength="1000"></textarea></label></p>
        <p><button type="submit" class="c-btn c-btn--sm">${esc(L('send'))}</button></p>
        <p class="c-feedback__done" role="status" hidden>${esc(L('reportDone'))} <code>${esc(result.auditId)}</code></p>
      </form>
    </details>
  </div>`;
}

/** 元件 5：拒答卡 */
export function refusalCard(result) {
  const r = result.refusal;
  return `<section class="c-refusal c-refusal--${esc(r.kind)}" aria-labelledby="refusal-h">
    <h2 id="refusal-h">${esc(r.title ?? L('refusalH'))}</h2>
    <p><b>${esc(L('why'))}：</b>${esc(r.text)}</p>
    <p class="c-refusal__actions">${(r.actions ?? []).map((a) => (a.href?.startsWith('tel:') ? `<a class="c-btn c-btn--primary" href="${esc(a.href)}">${esc(a.label)}</a>` : a.href ? link(a.href, a.label, 'c-btn c-btn--ghost') : `<span class="c-tag">${esc(a.label)}</span>`)).join(' ')}</p>
    ${r.related?.length ? `<div class="c-refusal__related"><h3>${esc(L('relatedPages'))}</h3><ul>${r.related.map((x) => `<li>${link(x.href, x.label)}</li>`).join('')}</ul></div>` : ''}
  </section>`;
}

// 第四十輪（#83）：疫情卡的標題是 h2。這一段在答案區塊之前、緊接 sr-only 的 h1，用 h3 會 h1→h3 跳級（axe heading-order）；
// 它本身是帶 aria-label 的獨立區塊，與下方「回答」同層，所以是 h2。
/** 態勢卡（只讀結構化欄位） */
// 疫情態勢卡的自由文字（metricLabel／deltaText／basis）是疫情中心填的整句，外語版可能只翻了一部分
// （例：tl 有 metricLabel 沒有 deltaText，卡片就變成「Bagong lokal na kaso ngayong linggo，集中於南部縣市」）。
// 第四十八輪（#100）規則：整張卡只用同一種語言——當頁語言的三個欄位都齊（有中文原文的欄位都有非中文譯文）就用當頁語言，
// 否則整張卡改用英文版（en 缺的欄位就不顯示，basis 用通用說明），絕不把中文整句塞進外語頁，也不一句兩種語言混著。
const HAN = /[㐀-鿿]/;
const SIT_FIELDS = ['metricLabel', 'deltaText', 'basis'];
function sitI18n(it) {
  if (LANG === 'zh-TW') return null;
  const complete = (t) => t && SIT_FIELDS.every((f) => !it[f] || (t[f] && !HAN.test(t[f])));
  const own = it.i18n?.[LANG];
  if (complete(own)) return own;
  const en = it.i18n?.en;
  return en ? Object.fromEntries(Object.entries(en).filter(([, v]) => !HAN.test(String(v)))) : {};
}
const sitNumber = (it) => (HAN.test(it.metricValue ?? '') ? String(it.metricNumeric ?? '') : (it.metricValue ?? ''));
const sitGenericBasis = () => globalThis.window?.CDC?.t?.('status.basis.generic') ?? '';
export async function situationCards(sit) {
  if (!sit?.items?.length) return '';
  const cards = await Promise.all(sit.items.map(async (it) => {
    const labels = it.weeklyLabels ?? it.weekly?.map((_, i) => `W${i + 1}`);
    const chart = it.weekly?.length ? await barChart(it.weekly, { labels, unit: it.metricValue?.includes('%') ? '%' : '', title: it.metricLabel, width: 300, height: 110, color: `var(--status-${it.status}, currentColor)` }) : '';
    const i18n = sitI18n(it);
    return `<article class="c-sit-card c-sit-card--${esc(it.status)} c-answer-sit">
      <header><h2>${(() => { const nm = LANG !== 'zh-TW' ? (it.diseaseNameEn ?? it.diseaseName) : it.diseaseName; return it.slug ? link(`/diseases/${it.slug}/`, nm) : esc(nm); })()}</h2>
        <span class="c-status-tag c-status-tag--${esc(it.status)}">${esc(statusLabel(it.status))}</span>${it.illustrative ? ` <span class="c-tag">${esc(L('illustrative'))}</span>` : ''}</header>
      <p class="c-sit-card__metric"><span aria-hidden="true">${it.trend === 'up' ? '↑' : it.trend === 'down' ? '↓' : '→'}</span> <b>${esc(i18n ? (i18n.metricValue ?? sitNumber(it)) : it.metricValue)}</b> <span class="muted">${esc(i18n ? i18n.metricLabel ?? '' : it.metricLabel)}${(i18n ? i18n.deltaText : it.deltaText) ? `，${esc(i18n ? i18n.deltaText : it.deltaText)}` : ''}</span></p>
      ${it.peakCount != null ? `<p class="c-sit-card__sub"><b>${esc(it.peakCount)}</b> ${esc(it.peakCountLabel ?? '')}</p>` : ''}
      ${chart ? `<div class="c-sit-card__chart">${chart}</div>` : ''}
      ${it.basis ? `<p class="c-sit-card__basis"><b>${esc(L('statusBasis'))}：</b>${esc(i18n ? (i18n.basis ?? sitGenericBasis()) : it.basis)}</p>` : ''}
      <p class="c-provenance">${esc(L('dataDate'))} <time datetime="${esc(sit.dataDate)}">${esc(sit.dataDate)}</time> · ${LANG === 'zh-TW' ? `${esc(sit.publisherName ?? sit.publisher)} ${esc(L('publisher'))}` : `${esc(L('publisher'))} ${esc(sit.publisherNameEn ?? sit.publisherName ?? sit.publisher)}`} ·${link('/situation/', L('seeTrend'))}</p>
    </article>`;
  }));
  return `<section class="c-answer__situation" aria-label="${esc(L('sitH'))}">${cards.join('')}</section>`;
}

/** 謠言判定 */
export function verdictBlock(result) {
  const c = result.clarification;
  if (!c) return '';
  const id = `share-${esc(result.auditId)}`;
  const rev = c.revised?.[0];
  return `<section class="c-factcheck" aria-labelledby="fc-h">
    <h2 id="fc-h">${esc(L('verdictH'))} <span class="c-verdict c-verdict--${esc(result.verdict)}">${esc(L(`verdict.${result.verdict}`))}</span></h2>
    ${result.verdict === 'outdated' ? `<p class="c-alert c-alert--revised">${esc(L('outdatedNote', { t: rev?.currentTitle ?? '依據正本', d: rev?.revisedAt ?? '' }))}${rev?.currentId ? ` ${link(`/documents/${String(rev.currentId).replace(/^doc\./, '')}/`, L('current'))}` : ''}</p>` : ''}
    <blockquote class="c-factcheck__claim">${esc(c.claim)}</blockquote>
    <h3>${esc(L('clarH'))}</h3><p>${esc(c.text)}</p>
    ${c.shareText ? `<div class="c-factcheck__share"><h3>${esc(L('shareH'))}</h3><p id="${id}">${esc(c.shareText)}</p><button type="button" class="c-btn c-btn--sm" data-copy-text="${esc(c.shareText)}">${esc(L('copy'))}</button></div>` : ''}
    ${c.reportChannel ? `<p><b>${esc(L('reportChannel'))}：</b>${esc(c.reportChannel)}</p>` : ''}
  </section>`;
}

/** 元件 9：數字的來源卡 */
export function numberSource(src) {
  const formats = (src.formats ?? []).join(' / ');
  return `<details class="c-number-source c-source-card" open><summary>${esc(L('numberSource'))}</summary><dl class="c-deflist c-deflist--sm">
    <div><dt>${esc(L('canonical'))}</dt><dd>${link(src.url, src.title)}</dd></div>
    <div><dt>${esc(L('dataDate'))}</dt><dd>${esc(src.dataDate ?? src.reviewedAt ?? '')}</dd></div>
    <div><dt>${esc(L('dataOwner'))}</dt><dd>${esc(ownerLabel(src))}</dd></div>
    <div><dt>${esc(L('license'))}</dt><dd>${esc(LICENSE_LABEL[src.license] ?? src.license ?? '')}</dd></div>
    <div><dt>${esc(L('formats'))}</dt><dd>${esc(formats || 'CSV / JSON')} · ${link(src.url, 'CSV')} · ${link(src.url, 'JSON')} · ${link(src.apiUrl ?? '/v1/datasets.json', 'API')}</dd></div>
    ${src.provenance?.mode ? `<div><dt>provenance</dt><dd>${esc(src.provenance.mode)} · ${esc(src.provenance.fetchedAt ?? '')}</dd></div>` : ''}
  </dl>${src.note ? `<p class="muted">${esc(src.note)}</p>` : ''}</details>`;
}

/** 統計結果：數字磚＋長條圖＋數字的來源卡 */
export async function statsBlock(result) {
  const st = result.stats; const src = result.sources?.[0];
  if (!st) return '';
  const fmt = (v) => (typeof v === 'number' ? v.toLocaleString('en-US') : String(v));
  const agg = st.aggregate;
  const tile = agg ? `<div class="c-stat-tile"><span class="c-stat-tile__label">${esc(L(agg.kind === 'sum' ? 'total' : agg.kind))}${agg.t ? ` · ${esc(agg.t)}` : ''}</span><span class="c-stat-tile__num">${esc(fmt(agg.value))}</span><span class="c-stat-tile__sub">${esc(st.unit)}</span></div>`
    : `<div class="c-stat-tile"><span class="c-stat-tile__label">${esc(st.points.at(-1).t)}</span><span class="c-stat-tile__num">${esc(fmt(st.points.at(-1).v))}</span><span class="c-stat-tile__sub">${esc(st.unit)}</span></div>`;
  const chart = await barChart(st.points.map((p) => Number(p.v)), { labels: st.points.map((p) => String(p.t)), unit: st.unit, title: st.label, width: 520, height: 180 });
  return `<section class="c-answer__stats" aria-labelledby="stats-h"><h2 id="stats-h">${esc(L('statsH'))}：${esc(st.label)}</h2>
    <div class="c-answer__stats-row">${tile}<div class="c-answer__chart">${chart}</div></div>
    <table class="c-table c-table--sm"><caption class="sr-only">${esc(st.label)}</caption><thead><tr><th scope="col">${esc(st.granularity ?? '')}</th><th scope="col">${esc(st.unit)}</th></tr></thead><tbody>${st.points.map((p) => `<tr><th scope="row">${esc(p.t)}</th><td>${esc(fmt(p.v))}</td></tr>`).join('')}</tbody></table>
    <p class="c-answer__nopredict">${esc(L('noPredict'))}${st.notes?.length ? ` ${esc(st.notes.join('；'))}` : ''}</p>
    ${src ? numberSource(src) : ''}
  </section>`;
}

/** 第二十八輪：連到 /search/?q=（Pagefind 全文搜尋）。答案頁的關鍵字清單是「最接近的幾筆」，全文搜尋才是「所有含這個詞的頁面＋篩選」。 */
export function fullTextLink(q) {
  if (!q) return '';
  const href = `${url('/search/')}?q=${encodeURIComponent(q)}`;
  return `<p class="c-answer__fulltext"><a class="c-btn c-btn--ghost c-btn--sm" href="${esc(href)}" data-fulltext>${esc(L('fullSearch', { q }))}</a> <span class="muted">${esc(L('fullSearchNote'))}</span></p>`;
}

export function traditionalList(list, title = L('listH')) {
  if (!list?.length) return '';
  return `<section class="c-answer__list" aria-labelledby="list-h"><h2 id="list-h">${esc(title)}</h2><ol class="c-result-list">${list.map((x) => `<li>${link(x.url, x.title, 'c-result-list__t')}<p>${esc(x.summary ?? '')}</p><p class="c-provenance">${esc(x.ownerName ?? '')} · ${esc(L('reviewed'))} ${esc(x.reviewedAt ?? '')}</p></li>`).join('')}</ol></section>`;
}

/** 共用互動：引用編號浮層（一次一張）、複製、引用本頁、回報表單 */
export function wireInteractions(container, getResult) {
  container.addEventListener('click', async (e) => {
    const btn = e.target.closest('.c-cite');
    if (btn) {
      const pop = document.getElementById(btn.getAttribute('aria-controls'));
      const open = btn.getAttribute('aria-expanded') !== 'true';
      container.querySelectorAll('.c-cite[aria-expanded="true"]').forEach((b) => { b.setAttribute('aria-expanded', 'false'); const p = document.getElementById(b.getAttribute('aria-controls')); if (p) p.hidden = true; });
      if (open && pop) { btn.setAttribute('aria-expanded', 'true'); pop.hidden = false; }
      return;
    }
    const cp = e.target.closest('[data-copy-text]');
    if (cp) { try { await navigator.clipboard.writeText(cp.dataset.copyText); } catch { /* ignore */ } flash(cp, L('copied')); return; }
    const ci = e.target.closest('[data-answer-cite]');
    if (ci) {
      const src = getResult()?.sources?.find((s) => s.id === ci.dataset.answerCite);
      if (src) { try { await navigator.clipboard.writeText(apaCitation(src)); } catch { /* ignore */ } flash(ci, L('cited')); }
    }
  });
  container.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const b = container.querySelector('.c-cite[aria-expanded="true"]');
    if (b) { b.setAttribute('aria-expanded', 'false'); const p = document.getElementById(b.getAttribute('aria-controls')); if (p) p.hidden = true; b.focus(); }
  });
  container.addEventListener('submit', (e) => {
    const form = e.target.closest('[data-answer-report]');
    if (!form) return;
    e.preventDefault();
    const r = getResult(); if (!r) return;
    const fd = new FormData(form);
    const rec = {
      id: `R-${r.auditId.slice(2)}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`, auditId: r.auditId, page: location.pathname + location.search, at: new Date().toISOString(),
      kind: fd.get('kind'), text: String(fd.get('text') ?? '').slice(0, 1000), query: r.query, intent: r.intent, mode: r.disclosure?.mode, model: r.disclosure?.model ?? null,
      sources: (r.sources ?? []).map((s) => s.contentId ?? s.id), owners: [...new Set((r.sources ?? []).map((s) => s.owner).filter(Boolean))], refused: !!r.refused, lang: r.lang,
    };
    try {
      if (window.CDC?.reports?.add) window.CDC.reports.add(rec);
      else { const all = JSON.parse(localStorage.getItem('cdc.reports') || '[]'); all.push(rec); localStorage.setItem('cdc.reports', JSON.stringify(all)); }
    } catch { /* 私密模式 */ }
    form.querySelector('.c-feedback__done').hidden = false;
    form.querySelector('textarea').value = '';
  });
  // C 的 ui.js 未載入時的「有幫助」備援
  if (!window.CDC?.reports) {
    container.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act="helpful"]'); if (!b) return;
      const id = b.closest('[data-audit-id]')?.dataset.auditId;
      try { const m = JSON.parse(localStorage.getItem('cdc.helpful') || '{}'); if (m[id]) delete m[id]; else m[id] = new Date().toISOString(); localStorage.setItem('cdc.helpful', JSON.stringify(m)); b.setAttribute('aria-pressed', String(!!m[id])); } catch { /* ignore */ }
    });
  }
}

function flash(el, text) { const old = el.textContent; el.textContent = text; setTimeout(() => { el.textContent = old; }, 1600); }

/** answer.css 若尚未被頁面引入就補上 */
export function ensureStyles() {
  if (document.querySelector('link[href*="answer.css"]')) return;
  const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = url('/assets/styles/answer.css', { noLang: true });
  document.head.appendChild(l);
}
