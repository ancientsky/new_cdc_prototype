// 答案頁元件的 HTML 產生器（字串），答案頁、謠言查證、統計問答共用。全部插值經 esc()。
// 元件：4 AI 回答標示、5 拒答卡、6 回報與稽核編號、9 數字的來源卡；來源卡（三層露出）、態勢卡、判定 pill。
import { esc, url, LANG, barChart } from './data.js';

// ───────── UI 字串（zh-TW／en／vi；其他語言 fallback en） ─────────
const S = {
  'zh-TW': {
    answerH: '回答', answerSub: '僅引用官方內容，每句可點開原文', aiBadge: 'AI 整理', next: '接下來可以', sourcesH: '答案來源', relatedH: '你可能也想知道',
    moreH: '其他相關結果', listH: '搜尋結果', disclosure: '本回答由 AI 依官方內容整理，不提供個人診斷；有症狀請洽醫師或撥 1922。',
    modelExtractive: '模型：抽取式整理，未使用生成模型', modelLlm: '模型：{p} · {m}（BYOK，由你的瀏覽器直接呼叫）', report: '回報錯誤', helpful: '有幫助', auditId: '稽核編號',
    reportH: '回報這則回答', reportKind: '問題類型', reportKinds: ['內容錯誤', '已過時', '不完整', '引用來源不對', '其他'], reportText: '說明（請勿填寫個資）', send: '送出', reportDone: '已收到，承辦單位會依稽核編號查核。',
    owner: '權責單位', reviewed: '最後審閱', current: '現行版', currentYes: '是（現行有效）', currentNo: '否（已被取代）', license: '授權', openOriginal: '開啟原文', machine: '機讀版', version: '版次', effective: '生效日', supersedes: '取代',
    cite: '引用本頁', cited: '已複製引用', subscribe: '訂閱異動', subscribed: '已訂閱', nextReview: '下次審閱', section: '條次／段落', change: '本段異動', before: '修訂前', after: '修訂後',
    sitH: '現在的疫情', dataDate: '資料日', publisher: '發布', illustrative: '示意資料', statusBasis: '判定依據', seeTrend: '看完整趨勢',
    refusalH: '這個問題我不能替你判斷', why: '為什麼', call1922: '撥打 1922', relatedPages: '相關官方頁面',
    paused: 'AI 問答暫停中，目前提供傳統搜尋結果與 1922 人工諮詢。', pausedReason: '原因', updated: '更新',
    proLabel: '專業模式：引用手冊條次與生效日，不做白話化', translationSource: '此語言沒有經審核的譯文，以下為中文原文。', translationMachine: '以下為機器翻譯（鎖定官方譯名），以中文原文為準。',
    termNote: '「{from}」已改稱「{to}」，以下依現行名稱回答。', lowConf: '這個問題的意圖不夠明確，以下同時列出相關頁面。',
    verdict: { false: '錯誤', 'partly-true': '部分正確', outdated: '已過時', true: '正確', unknown: '查無澄清' }, verdictH: '查證結果', clarH: '官方澄清', shareH: '可轉傳的官方短訊', copy: '複製', copied: '已複製', reportChannel: '通報管道',
    outdatedNote: '已過時：所依據的「{t}」已於 {d} 修訂，請以現行版為準。', noPredict: '只呈現已發布的資料：不推論、不預測。', numberSource: '數字的來源', canonical: '正本', dataOwner: '資料權責', formats: '格式', api: 'API',
    statsH: '統計結果', total: '合計', max: '最高', min: '最低', avg: '平均', loading: '整理中…', llmWorking: '正在用 LLM 依同一批官方片段重新整理…', llmFallback: 'LLM 模式未能產生通過檢核的回答，已改顯示抽取式結果。', llmError: 'LLM 呼叫失敗：{m}。已改顯示抽取式結果。',
    llmDropped: '已刪除 {n} 句無法對應官方片段的句子。', empty: '請輸入問題。', side: { disease: '疾病百科', news: '最新新聞稿', data: '相關資料集', channels: '同一答案，三個管道', full: '完整頁面', symptoms: '症狀', transmission: '傳染途徑', incubation: '潛伏期', prevention: '預防', treatment: '治療', notify: '通報時限' },
    channels: ['網站：本頁的答案與來源', 'API：v1/search-index.json 同一份答案單元', '1922：話務人員使用相同的官方內容'],
    confidence: '信心', guards: '輸出檢查',
    media: { video: '影片', animation: '動畫', podcast: 'Podcast', short: '短影音' }, watchAt: '從 {t} 開始看', transcriptNote: '引用自官方影片逐字稿', basedOnLabel: '製作依據', producedAt: '製作日',
    steps: '步驟', stepsN: '{n} 個步驟', slaDays: '處理天數', days: '{n} 天', fee: '費用', applyPage: '前往申請頁', forms: '表單',
    specimen: '檢體', container: '容器', volume: '量', timing: '採檢時機', storage: '保存', transport: '運送', tests: '可做檢驗', turnaround: '週轉', sendWithin: '送驗時限', labs: '檢驗單位', hours: '{n} 小時',
    masterBasis: '依傳染病防治法公告', masterNote: '主檔結構化欄位，非檢索摘錄', notifyH: '通報時限', notifyCategory: '法定傳染病類別', notifyWithin: '應於', notifyReport: '通報專區', caseDef: '病例定義', labtestLink: '檢驗項目', diseasePage: '疾病頁',
    closed: '已截止', deadline: '截止日', notices: '全部公告', proOnlyNote: '專業內容',
  },
  en: {
    answerH: 'Answer', answerSub: 'Quotes official content only — tap a number to see the source', aiBadge: 'AI summary', next: 'What you can do next', sourcesH: 'Sources', relatedH: 'You may also want to know',
    moreH: 'Other related results', listH: 'Search results', disclosure: 'This answer was assembled by AI from official content. It is not a personal diagnosis; if you have symptoms, see a doctor or call 1922.',
    modelExtractive: 'Model: extractive (no generative model used)', modelLlm: 'Model: {p} · {m} (BYOK, called directly from your browser)', report: 'Report an error', helpful: 'Helpful', auditId: 'Audit ID',
    reportH: 'Report this answer', reportKind: 'Type', reportKinds: ['Incorrect', 'Outdated', 'Incomplete', 'Wrong source', 'Other'], reportText: 'Details (no personal data please)', send: 'Send', reportDone: 'Received. The responsible unit will review it using the audit ID.',
    owner: 'Responsible unit', reviewed: 'Last reviewed', current: 'Current version', currentYes: 'Yes', currentNo: 'No (superseded)', license: 'Licence', openOriginal: 'Open original', machine: 'Machine-readable', version: 'Version', effective: 'Effective', supersedes: 'Supersedes',
    cite: 'Cite this page', cited: 'Citation copied', subscribe: 'Subscribe to changes', subscribed: 'Subscribed', nextReview: 'Next review', section: 'Section', change: 'Change in this section', before: 'Before', after: 'After',
    sitH: 'Current situation', dataDate: 'Data as of', publisher: 'Published by', illustrative: 'Illustrative data', statusBasis: 'Basis', seeTrend: 'See full trend',
    refusalH: "I can't make this judgement for you", why: 'Why', call1922: 'Call 1922', relatedPages: 'Related official pages',
    paused: 'AI answers are paused. Keyword search results and the 1922 hotline are available.', pausedReason: 'Reason', updated: 'Updated',
    proLabel: 'Professional mode: cites manual sections and effective dates verbatim', translationSource: 'No reviewed translation is available; showing the Chinese original.', translationMachine: 'Machine translation (official terms locked). The Chinese original prevails.',
    termNote: '"{from}" is now called "{to}".', lowConf: 'Your question is ambiguous, so related pages are listed as well.',
    verdict: { false: 'False', 'partly-true': 'Partly true', outdated: 'Outdated', true: 'True', unknown: 'No clarification found' }, verdictH: 'Fact-check result', clarH: 'Official clarification', shareH: 'Shareable official message', copy: 'Copy', copied: 'Copied', reportChannel: 'Report to',
    outdatedNote: 'Outdated: "{t}" was revised on {d}. Please follow the current version.', noPredict: 'Published data only — no inference, no forecasts.', numberSource: 'Where this number comes from', canonical: 'Canonical source', dataOwner: 'Data owner', formats: 'Formats', api: 'API',
    statsH: 'Statistics', total: 'Total', max: 'Highest', min: 'Lowest', avg: 'Average', loading: 'Preparing…', llmWorking: 'Re-assembling with the LLM from the same official passages…', llmFallback: 'The LLM answer did not pass the grounding check; showing the extractive answer.', llmError: 'LLM call failed: {m}. Showing the extractive answer.',
    llmDropped: '{n} sentence(s) without matching official passages were removed.', empty: 'Please enter a question.', side: { disease: 'Disease facts', news: 'Latest press releases', data: 'Related datasets', channels: 'One answer, three channels', full: 'Full page', symptoms: 'Symptoms', transmission: 'Transmission', incubation: 'Incubation', prevention: 'Prevention', treatment: 'Treatment', notify: 'Notification' },
    channels: ['Web: this page with sources', 'API: the same answer units in v1/search-index.json', '1922: hotline staff use the same official content'],
    confidence: 'Confidence', guards: 'Output checks',
    media: { video: 'Video', animation: 'Animation', podcast: 'Podcast', short: 'Short video' }, watchAt: 'Watch from {t}', transcriptNote: 'Quoted from official video transcripts', basedOnLabel: 'Based on', producedAt: 'Produced',
    steps: 'Steps', stepsN: '{n} steps', slaDays: 'Processing time', days: '{n} days', fee: 'Fee', applyPage: 'Go to application page', forms: 'Forms',
    specimen: 'Specimen', container: 'Container', volume: 'Volume', timing: 'Timing', storage: 'Storage', transport: 'Transport', tests: 'Tests', turnaround: 'Turnaround', sendWithin: 'Send within', labs: 'Laboratories', hours: '{n} hours',
    masterBasis: 'Communicable Disease Control Act announcement', masterNote: 'Structured master data, not a retrieved excerpt', notifyH: 'Notification deadline', notifyCategory: 'Notifiable disease category', notifyWithin: 'Report within', notifyReport: 'Reporting', caseDef: 'Case definition', labtestLink: 'Lab tests', diseasePage: 'Disease page',
    closed: 'Closed', deadline: 'Deadline', notices: 'All notices', proOnlyNote: 'Professional content',
  },
  vi: {
    answerH: 'Câu trả lời', answerSub: 'Chỉ trích dẫn nội dung chính thức', aiBadge: 'AI tổng hợp', next: 'Bạn có thể', sourcesH: 'Nguồn', relatedH: 'Có thể bạn muốn biết',
    disclosure: 'Câu trả lời do AI tổng hợp từ nội dung chính thức, không phải chẩn đoán cá nhân; nếu có triệu chứng hãy đi khám hoặc gọi 1922 (có thông dịch).',
    report: 'Báo lỗi', helpful: 'Hữu ích', refusalH: 'Tôi không thể đánh giá thay bạn', call1922: 'Gọi 1922', translationSource: 'Chưa có bản dịch đã duyệt; hiển thị bản tiếng Trung gốc.', sitH: 'Tình hình dịch hiện nay',
    verdict: { false: 'Sai', 'partly-true': 'Đúng một phần', outdated: 'Đã lỗi thời', true: 'Đúng', unknown: 'Chưa có thông tin' },
  },
};
export function L(key, vars = {}) {
  const pick = (lang) => key.split('.').reduce((o, k) => (o == null ? o : o[k]), S[lang]);
  let v = pick(LANG);
  if (v == null) v = pick(LANG === 'zh-TW' ? 'zh-TW' : 'en');
  if (v == null) v = pick('zh-TW');
  if (typeof v === 'string') return v.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
  return v ?? key;
}

const STATUS = { stable: { 'zh-TW': '平穩', en: 'Stable' }, rising: { 'zh-TW': '上升', en: 'Rising' }, peak: { 'zh-TW': '高峰', en: 'Peak' }, declining: { 'zh-TW': '下降', en: 'Declining' } };
const statusLabel = (s) => STATUS[s]?.[LANG] ?? STATUS[s]?.en ?? s;
const isExternal = (h) => /^https?:/.test(h ?? '');

export function link(href, text, cls = '') {
  const ext = isExternal(href);
  return `<a class="${cls}" href="${esc(url(href))}"${ext ? ' rel="noopener" target="_blank"' : ''}>${esc(text)}${ext ? '<span class="sr-only">（另開視窗）</span>' : ''}</a>`;
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
  rows.push(...typeRows(src).map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`));
  add(L('owner'), esc(src.ownerName ?? src.owner));
  add(L('reviewed'), src.reviewedAt ? `<time datetime="${esc(src.reviewedAt)}">${esc(src.reviewedAt)}</time>` : '');
  add(L('current'), src.isCurrent === false ? `<span class="c-tag c-tag--warn">${esc(L('currentNo'))}</span>` : esc(L('currentYes')));
  add(L('license'), esc(LICENSE_LABEL[src.license] ?? src.license ?? 'OGDL-1.0'));
  if (pro || src.version) {
    add(L('version'), esc(src.version ?? ''));
    add(L('effective'), esc(src.effectiveAt ?? ''));
    if (src.section?.heading) add(L('section'), esc(src.section.no ? `第 ${src.section.no} 條 ${src.section.heading}` : src.section.heading));
    if (src.supersedes) add(L('supersedes'), `${esc(src.supersedesVersion ?? '')} ${link(`/documents/${String(src.supersedes).replace(/^doc\./, '')}/`, src.supersedes)}`);
    if (src.change?.before || src.change?.after) add(L('change'), `${src.change.before ? `<del>${esc(src.change.before)}</del> → ` : ''}<ins>${esc(src.change.after ?? '')}</ins>`);
    if (pro) add(L('nextReview'), esc(src.nextReviewAt ?? ''));
  }
  const btns = [
    link(src.url, L('openOriginal'), 'c-btn c-btn--sm'),
    src.mdUrl ? link(src.mdUrl, L('machine'), 'c-btn c-btn--sm c-btn--ghost') : '',
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
    rows.push([L('media.video'), `${src.poster ? `<img class="c-source-card__poster" src="${esc(url(src.poster, { noLang: true }))}" alt="" width="96" height="54" loading="lazy">` : ''}${link(src.url, L('watchAt', { t: src.timeLabel ?? mmss(src.t) }))} <span class="muted">${esc(label)}</span>`]);
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
  if (s.type === 'master') return `${s.subject ?? ''}${s.legalCategory ? ` · ${catLabel(s.legalCategory)}` : ''}${s.hoursLabel ? ` · ${s.hoursLabel}` : ''}`;
  if (s.type === 'service') return `${s.ownerName ?? ''}${s.stepsCount ? ` · ${L('stepsN', { n: s.stepsCount })}` : ''}${s.slaDays != null ? ` · ${L('slaDays')} ${L('days', { n: s.slaDays })}` : ''}`;
  if (s.type === 'labtest') return `${s.ownerName ?? ''}${s.specimen?.name ? ` · ${s.specimen.name}` : ''}${s.sendWithinHours != null ? ` · ${L('sendWithin')} ${L('hours', { n: s.sendWithinHours })}` : ''}`;
  return `${s.ownerName ?? ''} · ${L('reviewed')} ${s.reviewedAt ?? ''}${s.version ? ` · ${s.version}` : ''}${s.closed ? ` · ${L('closed')}` : ''}`;
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

/** 元件 4＋6：AI 揭露列、有幫助、回報（帶稽核編號） */
export function disclosureRow(result) {
  const d = result.disclosure ?? {};
  const model = d.mode === 'llm' || d.provider ? L('modelLlm', { p: d.provider ?? 'Anthropic', m: d.model ?? '' }) : L('modelExtractive');
  return `<div class="c-ai-disclosure" data-feedback data-audit-id="${esc(result.auditId)}" data-page="${esc(location.pathname)}">
    <p><span class="c-ai-badge">${esc(L('aiBadge'))}</span> ${esc(L('disclosure'))} <span class="c-ai-disclosure__model">${esc(model)}</span>${d.transcript ? ` <span class="c-ai-disclosure__transcript">${esc(d.note ?? L('transcriptNote'))}</span>` : ''}</p>
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

/** 態勢卡（只讀結構化欄位） */
export async function situationCards(sit) {
  if (!sit?.items?.length) return '';
  const cards = await Promise.all(sit.items.map(async (it) => {
    const labels = it.weeklyLabels ?? it.weekly?.map((_, i) => `W${i + 1}`);
    const chart = it.weekly?.length ? await barChart(it.weekly, { labels, unit: it.metricValue?.includes('%') ? '%' : '', title: it.metricLabel, width: 300, height: 110, color: `var(--status-${it.status}, currentColor)` }) : '';
    const i18n = LANG !== 'zh-TW' ? it.i18n?.[LANG] : null;
    return `<article class="c-sit-card c-sit-card--${esc(it.status)} c-answer-sit">
      <header><h3>${(() => { const nm = LANG !== 'zh-TW' ? (it.diseaseNameEn ?? it.diseaseName) : it.diseaseName; return it.slug ? link(`/diseases/${it.slug}/`, nm) : esc(nm); })()}</h3>
        <span class="c-status-tag c-status-tag--${esc(it.status)}">${esc(statusLabel(it.status))}</span>${it.illustrative ? ` <span class="c-tag">${esc(L('illustrative'))}</span>` : ''}</header>
      <p class="c-sit-card__metric"><span aria-hidden="true">${it.trend === 'up' ? '↑' : it.trend === 'down' ? '↓' : '→'}</span> <b>${esc(it.metricValue)}</b> <span class="muted">${esc(i18n?.metricLabel ?? it.metricLabel)}${it.deltaText ? `，${esc(i18n?.deltaText ?? it.deltaText)}` : ''}</span></p>
      ${it.peakCount != null ? `<p class="c-sit-card__sub"><b>${esc(it.peakCount)}</b> ${esc(it.peakCountLabel ?? '')}</p>` : ''}
      ${chart ? `<div class="c-sit-card__chart">${chart}</div>` : ''}
      ${it.basis ? `<p class="c-sit-card__basis"><b>${esc(L('statusBasis'))}：</b>${esc(i18n?.basis ?? it.basis)}</p>` : ''}
      <p class="c-provenance">${esc(L('dataDate'))} <time datetime="${esc(sit.dataDate)}">${esc(sit.dataDate)}</time> · ${esc(sit.publisherName ?? sit.publisher)} ${esc(L('publisher'))} · ${link('/situation/', L('seeTrend'))}</p>
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
    <div><dt>${esc(L('dataOwner'))}</dt><dd>${esc(src.ownerName ?? src.owner ?? '')}</dd></div>
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
