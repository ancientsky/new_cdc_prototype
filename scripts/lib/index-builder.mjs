// 答案單元索引（ARCHITECTURE.md 5.1）
// 把白名單內容切成「答案單元」→ v1/search-index.json（民眾）與 v1/search-index-pro.json（專業）。
//
// 切塊規則：
//   disease   八區塊各一塊（有文字者）＋ 一分鐘重點 ＋ 「我該怎麼辦」if 卡各一塊 ＋ 專業欄位（只進專業索引）
//   faq       問＋答一塊
//   news      段落切塊（每段 ≤ 300 字）；letter（致醫界通函）只進專業索引
//   document  sections 每段一塊（section 條號／標題、version、effectiveAt、family、supersedes、本段異動）；只進專業索引
//   clarification  一塊（含 verdict、claim）
//   vaccine   本文一塊 ＋ 公費對象每組一塊
//   dataset   series 不入索引（走統計問答）
//   ── 第二輪（ARCHITECTURE.md 11.3）──
//   media        逐字稿依 chapters 切塊（無章節則每 300 字）；url 帶 #t=秒；只收白名單（過時影片由治理引擎 stale／mediaOutdated 排除，這裡再自行推算一次）
//   topic        簡介一塊 ＋ 連結標題合併一塊（「專區提供：A、B、C。」）；已結束（gov.ended 或 endAt < today）不收
//   service      簡介（含申請對象）一塊；步驟合成一塊（「第 N 步：{title}。{text}（{who}，{days} 天）」）；應備文件一塊；處理天數／費用／法源一塊；FAQ 每題一塊
//   publication  摘要一塊；articles[] 每篇標題＋摘要一塊（帶篇目 diseases）
//   labtest      （專業）每個檢體一塊，結構化句；terms 加「檢體」「容器」「送驗」
//   research     （專業）摘要＋目標一塊
//   news other（機關公告）一塊（截止日結構化句＋本文）；closed（已截止）標記（第七輪前的 recruit／procurement 相容保留）
//   ── 第七輪（ARCHITECTURE 15.1）──
//   job       overview 一塊（職稱、用人單位、職類、名額、地點、報名期間、報名方式、薪資、結果已公告句）＋ details 一塊（工作內容、資格、應備文件、甄試方式）；
//             **result（正取／備取名單）與 waitlistUpdates（遞補）一律不入索引**：答案引擎問「誰錄取」只給結果頁連結。
//             chunk 帶 jobStage、applyStart、deadlineAt、hiringUnitName、positions、applyHref、hasResult、resultUrl（答案引擎 careers 意圖結構化列出）
//   tender    overview 一塊（案號、需求單位、採購方式、類別、預算、投標截止、開標、決標／流標）＋ scope 一塊（採購標的、特別規定、履約期限）；
//             chunk 帶 tenderStage、tenderNo、deadlineAt、openingAt、budgetNtd、pccUrl（procurement 意圖）
// 保證：失效版本（superseded）、逾期、依據正本已修訂（stale）的內容永遠不在索引。
// 多語：i18n[lang] 有 reviewed（且譯文未過期）者另出同語 chunk；machine 一律不出。
// 來源語言（ARCHITECTURE 14.2）：頂層欄位以 item.sourceLang（預設 zh-TW）出 chunk（英文來源 ⇒ 進英文索引）；
//   sourceLang≠zh-TW 時 i18n['zh-TW']（reviewed）另出中文 chunk（進中文索引）。topic／service 的譯文 chunk 需 i18n 有本文欄位才出。
import { splitPlain, parseChineseNumber } from '../../src/client/answer/core.js';
import { splitByPage } from './pdf-text.mjs';

const PAGE_MARK_TEST = /^〔p\.\d+〕$/m;

const MAX_PARA = 300;

/** Markdown → 句子陣列（保留清單項目邊界；不吃連字號） */
export function mdSentences(markdown) {
  if (!markdown) return [];
  const lines = String(markdown)
    .replace(/```[\s\S]*?```/g, '\n')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .split(/\n/)
    .map((l) => l.replace(/^\s*#{1,6}\s+/, '').replace(/^\s*>\s?/, '').replace(/^\s*([-*+]|\d+[.)])\s+/, '').replace(/\*\*|__|`/g, '').replace(/(^|[^*])\*([^*]+)\*/g, '$1$2').replace(/^\|.*\|$/, (row) => row.replace(/\|/g, ' ').replace(/[-:]{3,}/g, ' ')).trim())
    .filter(Boolean);
  return lines.flatMap((l) => splitPlain(l));
}

/** 相容舊 API：純文字句切 */
export function splitSentences(text) { return splitPlain(text); }

/** 段落切塊：依空行分段；超過 300 字依句子再切 */
export function paragraphs(markdown, max = MAX_PARA) {
  const out = [];
  for (const para of String(markdown ?? '').split(/\n\s*\n/)) {
    const sents = mdSentences(para);
    let cur = [];
    let len = 0;
    for (const s of sents) {
      if (len + s.length > max && cur.length) { out.push(cur); cur = []; len = 0; }
      cur.push(s); len += s.length;
    }
    if (cur.length) out.push(cur);
  }
  return out;
}

function glossaryHits(site, text) {
  const hits = [];
  for (const g of site.master.glossary ?? []) {
    for (const w of [g['zh-TW'], ...(g.aliases ?? [])].filter(Boolean)) if (w.length >= 2 && text.includes(w)) { hits.push(g['zh-TW'], w); break; }
  }
  return hits;
}

function diseaseNames(site, ids) {
  const out = [];
  for (const id of ids ?? []) { const d = site.diseaseMasterById.get(id); if (d) out.push(d.name, ...(d.aliases ?? []).filter((a) => a.length >= 2)); }
  return out;
}

/** 路徑（與 governance.pathOf 一致；避免相依順序時自備一份） */
function pathOf(item) {
  const slug = String(item.id).replace(/^[a-z]+\./, '');
  switch (item.type) {
    case 'disease': return `/diseases/${item.slug ?? slug}/`;
    case 'vaccine': return `/vaccines/${item.slug ?? slug}/`;
    case 'faq': return `/faq/${slug}/`;
    case 'news': case 'letter': return `/news/${slug}/`;
    case 'document': return `/documents/${slug}/`;
    case 'clarification': return `/factcheck/#${item.id}`;
    case 'media': return `/media/${slug}/`;
    case 'topic': return `/topics/${item.slug ?? slug}/`;
    case 'service': return `/apply/${item.slug ?? slug}/`;
    case 'publication': return `/publications/${slug}/`;
    case 'labtest': return `/lab/${slug}/`;
    case 'research': return `/research/${slug}/`;
    case 'job': return `/careers/${item.slug ?? slug.replace(/^\d{4}-\d{2}-\d{2}-/, '')}/`;
    case 'tender': return `/procurement/${item.slug ?? slug.replace(/^\d{4}-\d{2}-\d{2}-/, '')}/`;
    default: return '/';
  }
}

export const LAB_LABELS = { 'cdc-lab': '疾管署檢驗及疫苗研製中心', 'certified-lab': '認可檢驗機構', 'hospital-lab': '醫院檢驗室', 'regional-lab': '區域檢驗實驗室' };
const NOTICE_TERMS = { recruit: ['招募', '徵才', '職缺', '人才招募'], procurement: ['採購', '標案', '招標', '採購公告'] };

/** 職缺報名方式（中文） */
export const APPLY_METHOD_LABELS = { online: '線上報名', email: '電子郵件報名', mail: '郵寄報名', 'in-person': '親自送件報名' };
/** 職缺不得進索引的欄位（個資：甄選名單與遞補公告） */
export const JOB_INDEX_EXCLUDED_FIELDS = ['result', 'waitlistUpdates'];
const fmtNtd = (n) => Number(n).toLocaleString('en-US');
/** 職缺／標案關鍵字中的泛用詞（不拿來判斷「問的是哪一則」） */
const FOCUS_GENERIC = new Set(['人才招募', '招募', '職缺', '徵才', '甄選', '報名', '約聘', '約僱', '採購公告', '採購', '招標', '標案', '投標', '決標', '流標', '勞務採購', '財物採購', '公開招標', '政府電子採購網', '公費疫苗']);
/** 可辨識單一職缺／標案的關鍵字（答案引擎聚焦用）：keywords 去掉泛用詞與 2 字以下 */
export const focusTermsOf = (item) => (item.keywords ?? []).filter((k) => String(k).length >= 3 && !FOCUS_GENERIC.has(k));
const quoted = (t) => (/^[「『]/.test(t) || String(t).includes('」') ? t : `「${t}」`);
/** 職缺 → 索引句（只讀白名單欄位；不讀 result 名單與 waitlistUpdates） */
export function jobSentences(item, site) {
  const unitName = (id) => site?.unitById?.get(id)?.name ?? id;
  const t = quoted(item.title);
  const overview = [
    `${t}由${unitName(item.hiringUnit)}用人，職類為${item.jobType}，名額 ${item.positions} 名，工作地點：${item.workplace}。`,
    `${t}報名期間 ${item.applyStart} 至 ${item.deadlineAt}，${APPLY_METHOD_LABELS[item.applyMethod] ?? item.applyMethod}${item.applyUrl ? '（外部報名系統）' : item.applyMethod === 'online' ? '（本站報名頁）' : ''}。`,
    `${t}薪資待遇：${String(item.salaryNote).replace(/[。]$/, '')}。`,
  ];
  if (item.result?.publishedAt) overview.push(`${t}甄選結果已於 ${item.result.publishedAt} 公告，名單只公布報名編號與遮罩姓名，請至職缺頁「甄選結果」查看。`);
  else if (item.resultPlannedAt && item.manualStatus !== 'cancelled') overview.push(`${t}甄選結果預計 ${item.resultPlannedAt} 公告。`);
  if (item.manualStatus === 'cancelled') overview.push(`${t}已停止甄選${item.manualStatusNote ? `（${String(item.manualStatusNote).replace(/[。]$/, '')}）` : ''}。`);
  if (item.manualStatus === 'filled') overview.push(`${t}已補實。`);
  const details = [
    ...(item.duties?.length ? [`${t}工作內容：${item.duties.map((x) => String(x).replace(/[。；]$/, '')).join('；')}。`] : []),
    ...(item.qualifications?.length ? [`${t}資格條件：${item.qualifications.map((x) => String(x).replace(/[。；]$/, '')).join('；')}。`] : []),
    ...(item.requiredDocuments?.length ? [`${t}應備文件：${item.requiredDocuments.join('、')}。`] : []),
    ...(item.examPlan?.length ? [`${t}甄試方式：${item.examPlan.map((e) => `${e.stage}${e.date ? `（${e.date}）` : ''}`).join('、')}。`] : []),
  ];
  return { overview, details };
}
/** 採購公告 → 索引句 */
export function tenderSentences(item, site) {
  const unitName = (id) => site?.unitById?.get(id)?.name ?? id;
  const t = quoted(item.title);
  const overview = [
    `${t}（案號 ${item.tenderNo}）由${unitName(item.requestingUnit)}需求，採${item.method}${item.awardRule ? `（${item.awardRule}）` : ''}，${item.category}採購，預算金額 ${fmtNtd(item.budgetNtd)} 元。`,
    `${t}投標截止日 ${item.deadlineAt}${item.openingAt ? `，開標日 ${item.openingAt}` : ''}。`,
  ];
  if (item.award) overview.push(`${t}已於 ${item.award.date} 決標${item.award.amountNtd != null ? `，決標金額 ${fmtNtd(item.award.amountNtd)} 元` : ''}，得標廠商：${item.award.winner}。`);
  if (item.manualStatus === 'failed') overview.push(`${t}流標${item.manualStatusNote ? `（${String(item.manualStatusNote).replace(/[。]$/, '')}）` : ''}。`);
  if (item.manualStatus === 'cancelled') overview.push(`${t}已取消${item.manualStatusNote ? `（${String(item.manualStatusNote).replace(/[。]$/, '')}）` : ''}。`);
  const scope = [
    ...(item.scope?.length ? [`${t}採購標的：${item.scope.map((x) => String(x).replace(/[。；]$/, '')).join('；')}。`] : []),
    ...(item.specialTerms?.length ? [`${t}特別規定：${item.specialTerms.map((x) => String(x).replace(/[。；]$/, '')).join('；')}。`] : []),
    ...(item.contractPeriod ? [`${t}履約期限：${String(item.contractPeriod).replace(/[。]$/, '')}。`] : []),
  ];
  return { overview, scope };
}

/** 秒 → m:ss（逐字稿章節標示） */
export function mmss(t) { const n = Math.max(0, Math.round(Number(t) || 0)); return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`; }

/** 公告是否已截止：優先治理引擎 gov.closed，否則 deadlineAt < today 自行推算 */
export function isClosed(item, today) {
  if (typeof item.gov?.closed === 'boolean') return item.gov.closed;
  return !!(item.deadlineAt && today && item.deadlineAt < today);
}
/** 專區是否已結束：gov.ended，否則 endAt < today */
export function isEnded(item, today) {
  if (typeof item.gov?.ended === 'boolean') return item.gov.ended;
  return !!(item.endAt && today && item.endAt < today);
}
/**
 * 影片是否依據過時正本：gov.mediaOutdated（治理引擎）優先；否則自行推算：
 * basedOn 指向的文件（或其 family 的現行版）effectiveAt 晚於 producedAt，或依據已被取代、或 gov.stale 有值。
 */
export function isMediaOutdated(site, item) {
  const g = item.gov ?? {};
  if (typeof g.mediaOutdated === 'boolean') return g.mediaOutdated;
  if (g.mediaOutdated && typeof g.mediaOutdated === 'object') return true;
  if ((g.stale?.length ?? 0) > 0 || g.predatesBasis) return true;
  const produced = item.producedAt; if (!produced) return false;
  const docs = site.collections?.documents ?? [];
  for (const ref of item.basedOn ?? []) {
    const base = site.byId?.get(ref);
    const family = base?.family ?? (docs.some((d) => d.family === ref) ? ref : null);
    const current = family ? docs.filter((d) => d.family === family && d.gov?.isCurrent !== false && d.status !== 'archived' && !d.gov?.superseded).map((d) => d.effectiveAt).filter(Boolean).sort().at(-1) : base?.effectiveAt;
    if (current && current > produced) return true;
    if (base?.gov?.superseded) return true;
  }
  return false;
}

/**
 * 逐字稿切塊：回傳 [{ t, chapter|null, sentences[] }]。
 * 1) 逐字稿內有時間戳（[1:23]、(01:23)、行首 1:23、## 1:23 標題）→ 依時間戳切，歸到 t 所在章節；
 * 2) 有 chapters 且逐字稿標題數＝章節數 → 依標題切；
 * 3) 有 chapters → 依字數比例估算時間（語速固定假設，需 durationSeconds；無則平均分配段落）；
 * 4) 無 chapters → 每 300 字一塊，t 依字數比例估算。
 */
export function transcriptChunks(item, max = MAX_PARA) {
  const md = String(item.transcriptMarkdown ?? '');
  const chapters = [...(item.chapters ?? [])].filter((c) => Number.isFinite(Number(c.t))).sort((a, b) => a.t - b.t);
  const chapterAt = (t) => { let c = null; for (const ch of chapters) if (ch.t <= t) c = ch; return c ?? chapters[0] ?? null; };
  const TS = /^\s*(?:#{1,6}\s*)?(?:\*\*|__)?\s*[\[(（]?((?:\d{1,2}:)?\d{1,2}:\d{2})[\])）]?\s*[-–—:：]?\s*/;
  const labelSet = new Set(chapters.map((c) => String(c.label).trim()));
  // 時間戳所在行若只是章節標題（**[00:30] 標題**），標題不當作逐字稿句子
  const restOf = (l) => { const r = l.replace(TS, '').replace(/^(\*\*|__)|(\*\*|__)\s*$/g, '').trim(); return labelSet.has(r) || /^(\*\*|__).*(\*\*|__)$/.test(l.trim()) ? '' : r; };
  const toSec = (s) => s.split(':').map(Number).reduce((a, b) => a * 60 + b, 0);
  const lines = md.split(/\n/);
  // 1) 時間戳
  if (lines.filter((l) => TS.test(l)).length >= 2) {
    const segs = []; let cur = null;
    for (const l of lines) {
      const m = l.match(TS);
      if (m) { cur = { t: toSec(m[1]), lines: [restOf(l)] }; segs.push(cur); } else if (cur) cur.lines.push(l); else { cur = { t: 0, lines: [l] }; segs.push(cur); }
    }
    // 同章節合併
    const out = [];
    for (const sg of segs) {
      const ch = chapters.length ? chapterAt(sg.t) : null;
      const sents = mdSentences(sg.lines.join('\n'));
      if (!sents.length) continue;
      const last = out.at(-1);
      if (last && ch && last.chapter === ch && last.sentences.join('').length + sents.join('').length <= max * 2) last.sentences.push(...sents);
      else out.push({ t: ch && chapters.length && ch.t <= sg.t ? (last?.chapter === ch ? sg.t : ch.t) : sg.t, chapter: ch, sentences: sents });
    }
    return out;
  }
  // 2) 依標題
  const heads = lines.map((l, i) => (/^\s*#{1,6}\s+/.test(l) ? i : -1)).filter((i) => i >= 0);
  if (chapters.length && heads.length === chapters.length) {
    return chapters.map((ch, k) => ({ t: ch.t, chapter: ch, sentences: mdSentences(lines.slice(heads[k] + 1, heads[k + 1] ?? lines.length).join('\n')) })).filter((x) => x.sentences.length);
  }
  // 3)、4) 依字數比例
  const sents = mdSentences(md);
  const total = sents.reduce((s, x) => s + x.length, 0) || 1;
  const dur = Number(item.durationSeconds) || 0;
  if (chapters.length) {
    const groups = new Map(chapters.map((c) => [c, []]));
    let pos = 0;
    sents.forEach((x, i) => {
      const t = dur ? (pos / total) * dur : null;
      const ch = t != null ? chapterAt(t) : chapters[Math.min(chapters.length - 1, Math.floor((i / sents.length) * chapters.length))];
      groups.get(ch).push(x); pos += x.length;
    });
    return chapters.map((ch) => ({ t: ch.t, chapter: ch, sentences: groups.get(ch) })).filter((x) => x.sentences.length);
  }
  const out = []; let cur = []; let len = 0; let pos = 0; let start = 0;
  for (const x of sents) {
    if (len + x.length > max && cur.length) { out.push({ t: dur ? Math.floor((start / total) * dur) : 0, chapter: null, sentences: cur }); cur = []; len = 0; start = pos; }
    cur.push(x); len += x.length; pos += x.length;
  }
  if (cur.length) out.push({ t: dur ? Math.floor((start / total) * dur) : 0, chapter: null, sentences: cur });
  return out;
}

/** 檢驗項目結構化句（每個檢體兩句） */
export function labtestSentences(item, sp, site) {
  const d = site?.diseaseMasterById?.get(item.disease);
  const dname = d?.name ?? String(item.disease ?? '').replace(/^disease\./, '');
  const parts = [sp.container, sp.volume, sp.timing].filter(Boolean).join('，');
  const tail = [
    sp.storage ? `保存 ${sp.storage}` : null, sp.transport ? `運送 ${sp.transport}` : null,
  ].filter(Boolean).join('，');
  const segs = [parts, tail, sp.tests?.length ? `可做 ${sp.tests.join('、')}` : null, sp.turnaroundDays != null ? `週轉 ${sp.turnaroundDays} 天` : null].filter(Boolean);
  const s1 = `${dname}${sp.name}：${segs.join('；')}。`;
  const labs = (item.labs ?? []).map((l) => LAB_LABELS[l] ?? l);
  const s2parts = [item.sendWithinHours != null ? `送驗時限 ${item.sendWithinHours} 小時` : null, labs.length ? `檢驗單位 ${labs.join('、')}` : null].filter(Boolean);
  const out = [s1];
  if (s2parts.length) out.push(`${dname}${sp.name}${s2parts.join('；')}。`);
  if (sp.note) out.push(...splitPlain(sp.note));
  return out;
}

/** 申請步驟句：「第 N 步：{title}。{text}（{who}，{days} 天）」 */
export function serviceStepSentence(step, i, lang = 'zh-TW') {
  if (lang !== 'zh-TW') {
    const parenEn = [step.who, step.days == null ? null : step.days === 0 ? 'same day' : `${step.days} day${step.days === 1 ? '' : 's'}`].filter(Boolean).join(', ');
    const textEn = step.text ? String(step.text).trim().replace(/[。.]?$/, '') : '';
    const titleEn = String(step.title).replace(/[。.]$/, '');
    return `Step ${i + 1}: ${titleEn}.${textEn ? ` ${textEn}` : ''}${parenEn ? ` (${parenEn})` : ''}.`.replace(/\.\.$/, '.');
  }
  const paren = [step.who, step.days == null ? null : step.days === 0 ? '當日' : `${step.days} 天`].filter(Boolean).join('，');
  const text = step.text ? String(step.text).trim().replace(/[。.]?$/, '') : '';
  const title = String(step.title).replace(/[。.]$/, '');
  if (!text) return `第 ${i + 1} 步：${title}${paren ? `（${paren}）` : ''}。`;
  return `第 ${i + 1} 步：${title}。${text}${paren ? `（${paren}）` : ''}。`;
}

function sectionNo(s) {
  if (s.no != null) return String(s.no);
  const m = `${s.heading ?? ''} ${s.key ?? ''}`.match(/第\s*([\d一二三四五六七八九十]+)\s*[條點章節]|^(?:art|sec|s)?-?(\d+)$/i);
  if (!m) return null;
  const raw = m[1] ?? m[2];
  return /^\d+$/.test(raw) ? raw : String(parseChineseNumber(raw) ?? raw);
}

export function buildSearchIndex(site) {
  const pub = [], pro = [];
  const today = site.today;
  const srcLangOf = (item) => item.sourceLang ?? 'zh-TW';
  const langsOf = (item) => Object.entries(item.languages ?? {}).filter(([l, m]) => l !== srcLangOf(item) && m?.status === 'reviewed' && !item.gov?.translationStale?.[l] && item.i18n?.[l]).map(([l]) => l);

  function make(item, key, title, sentences, url, extra = {}) {
    const sents = (sentences ?? []).map((s) => String(s).trim()).filter((s) => s.length >= 4);
    if (!sents.length) return null;
    const unit = site.unitById.get(item.owner);
    const text = sents.join(' ');
    const lang = extra.lang ?? 'zh-TW';
    const terms = Array.from(new Set([
      ...(extra.keywords ?? item.keywords ?? []), ...(item.aliases ?? []), ...diseaseNames(site, item.diseases), ...glossaryHits(site, `${title} ${text}`),
      ...(extra.extraTerms ?? []),
    ].filter((t) => t && String(t).length >= 2)));
    delete extra.extraTerms;
    delete extra.keywords; // 譯文 chunk 用譯文關鍵字（i18n[lang].keywords），不 spread 進 chunk
    return {
      id: `${item.id}#${key}${lang !== 'zh-TW' ? `@${lang}` : ''}`, contentId: item.id, type: item.type, lang,
      title, text, sentences: sents, url, summary: extra.summary ?? item.summary ?? null,
      owner: item.owner, ownerName: unit?.name ?? item.owner, reviewedAt: item.reviewedAt, nextReviewAt: item.gov?.nextReviewAt ?? null, publishedAt: item.publishedAt ?? null,
      audience: item.audience ?? [], tasks: item.tasks ?? [], diseases: item.diseases ?? [], vaccines: item.vaccines ?? [], countries: item.countries ?? [],
      version: item.version ?? null, effectiveAt: item.effectiveAt ?? null, family: item.family ?? null, supersedes: item.supersedes ?? null,
      isCurrent: item.gov?.isCurrent !== false, whitelist: !!item.gov?.whitelist?.effective, license: item.license ?? 'OGDL-1.0',
      mdUrl: url.startsWith('/factcheck') ? null : `${url.replace(/#.*$/, '').replace(/\/$/, '')}.md`,
      legacyUrl: (item.legacyUrls ?? []).find((u) => !/[{}]/.test(String(u))) ?? null, // 略過 {id} 佔位的舊網址
      terms,
      ...extra,
    };
  }

  function eligiblePublic(item) {
    const g = item.gov; if (!g) return false;
    if (item.type === 'topic' && isEnded(item, today)) return false;
    if (item.type === 'media' && isMediaOutdated(site, item)) return false;
    if (['document', 'letter'].includes(item.type)) return false; // 文件庫、通函只供專業版（whitelist.tier = pro）
    if (typeof g.whitelist?.public === 'boolean') return g.whitelist.public; // 治理引擎算好的民眾白名單
    return !!g.whitelist?.effective && (item.audience ?? []).includes('public');
  }
  function eligiblePro(item) {
    const g = item.gov; if (!g) return false;
    if (item.type === 'topic' && isEnded(item, today)) return false;
    if (item.type === 'media' && isMediaOutdated(site, item)) return false;
    if (g.superseded || g.isCurrent === false || g.overdue || (g.stale?.length ?? 0) > 0 || g.predatesBasis) return false;
    if (item.status !== 'published') return false;
    if (g.whitelist?.effective) return true;
    return ['document', 'letter'].includes(item.type) && item.sensitivity === 'public' && g.isCurrent !== false && !(g.reverseAuditHits?.length);
  }

  for (const item of site.all) {
    const toPub = eligiblePublic(item);
    const toPro = eligiblePro(item);
    if (!toPub && !toPro) continue;
    const out = [];
    const base = pathOf(item);
    const add = (c, { proOnly = false } = {}) => { if (c) out.push({ c, proOnly }); };

    // 譯文只取 i18n[lang] 本身的欄位（不 fallback 來源語言，避免來源語言句子被標成其他語言 chunk）
    const srcLang = srcLangOf(item);
    const variants = [{ lang: srcLang, src: item, isSource: true }, ...langsOf(item).map((l) => ({ lang: l, isSource: false, src: { title: item.i18n[l].title ?? (l === 'en' ? item.nameEn : null) ?? item.title, ...item.i18n[l] } }))];
    for (const { lang, src, isSource } of variants) {
      const L = { lang, ...(isSource ? {} : { keywords: src.keywords ?? item.keywords }), ...(!isSource && srcLang !== 'zh-TW' ? { summary: src.summary ?? item.summary } : {}) };
      const zh = lang === 'zh-TW';
      switch (item.type) {
        case 'disease': {
          const blocks = src.blocks ?? [];
          for (const b of blocks) {
            const zhBlock = (item.blocks ?? []).find((x) => x.key === b.key) ?? b;
            if (!isSource && !b.markdown && !b.warning && !b.cards?.length) continue;
            const warnLabel = { 'zh-TW': '警示徵象：', en: 'Warning signs: ', vi: 'Dấu hiệu cảnh báo: ' }[lang] ?? '';
            const sents = [...mdSentences(b.markdown), ...(b.warning ? splitPlain(`${warnLabel}${b.warning}`) : [])];
            add(make(item, b.key, `${src.title ?? item.title} · ${b.heading ?? zhBlock.heading}`, sents, `${base}#${b.key}`, { ...L, block: b.key }));
            (b.cards ?? []).forEach((card, i) => {
              const pre = { 'zh-TW': '如果', en: 'If you ', vi: 'Nếu ' }[lang] ?? '';
              const sent = [card.if ? `${pre}${card.if}${lang === 'zh-TW' ? '：' : ': '}${card.title}${lang === 'zh-TW' ? '。' : '.'}` : null, ...splitPlain(card.text)].filter(Boolean);
              add(make(item, `${b.key}#card-${i + 1}`, `${src.title ?? item.title} · ${card.title}`, sent, `${base}#${b.key}`, { ...L, block: b.key, card: { if: card.if, title: card.title } }));
            });
          }
          const kf = src.keyFacts ?? {};
          const label = lang === 'zh-TW' ? { incubation: '潛伏期', symptoms: '主要症狀', transmission: '傳染途徑', prevention: '預防', treatment: '治療', notify: '通報時限' } : { incubation: 'Incubation', symptoms: 'Symptoms', transmission: 'Transmission', prevention: 'Prevention', treatment: 'Treatment', notify: 'Notification' };
          add(make(item, 'keyfacts', `${src.title ?? item.title} · ${lang === 'zh-TW' ? '一分鐘重點' : 'Key facts'}`, Object.entries(kf).map(([k, v]) => `${src.title ?? item.title}${lang === 'zh-TW' ? '' : ' — '}${label[k] ?? k}${lang === 'zh-TW' ? '：' : ': '}${v}${lang === 'zh-TW' ? '。' : '.'}`), base, { ...L, block: 'keyfacts' }));
          if (isSource && item.professional) {
            const p = item.professional;
            const sents = [p.notifyNote, p.specimen ? `檢體：${p.specimen}` : null, p.caseDefinition ? `病例定義：${p.caseDefinition}` : null].filter(Boolean).flatMap((x) => splitPlain(x));
            add(make(item, 'professional', `${item.title} · 專業人員重點`, sents, `${base}#professional`, { ...L, block: 'professional', audience: ['professional'] }), { proOnly: true });
          }
          break;
        }
        case 'faq':
          add(make(item, 'a', src.question ?? item.question ?? item.title, mdSentences(src.answerMarkdown ?? ''), base, { ...L, question: src.question ?? item.question, extraTerms: [src.question ?? item.question] }));
          break;
        case 'news': case 'letter': {
          if (['recruit', 'procurement'].includes(item.newsType)) {
            if (!isSource) break;
            const closed = isClosed(item, today);
            const kind = item.newsType === 'recruit' ? '招募' : '採購';
            const head = [
              item.deadlineAt ? `${/^[「『]/.test(item.title) || item.title.includes('」') ? item.title : `「${item.title}」`}${item.newsType === 'recruit' ? '報名' : '投標'}截止日 ${item.deadlineAt}${closed ? '（已截止）' : ''}。` : null,
              [item.refNo ? `公告字號 ${item.refNo}` : null, item.positions != null ? `名額 ${item.positions} 名` : null, item.budgetNtd != null ? `預算金額 ${Number(item.budgetNtd).toLocaleString('en-US')} 元` : null].filter(Boolean).join('；') || null,
            ].filter(Boolean).map((x) => (/[。]$/.test(x) ? x : `${x}。`));
            // 本文：略過 Markdown 標題行（「職缺內容」之類不是句子）
            const body = mdSentences(String(src.bodyMarkdown ?? '').replace(/^\s*#{1,6}\s+.*$/gm, '')).slice(0, 8);
            add(make(item, 'notice', item.title, [...head, ...body], base, {
              ...L, newsType: item.newsType, closed, deadlineAt: item.deadlineAt ?? null, refNo: item.refNo ?? null, applyUrl: item.applyUrl ?? null,
              positions: item.positions ?? null, budgetNtd: item.budgetNtd ?? null, extraTerms: [kind, ...NOTICE_TERMS[item.newsType], ...(closed ? ['已截止'] : ['進行中'])],
            }));
            break;
          }
          const paras = paragraphs(src.bodyMarkdown ?? '');
          paras.forEach((p, i) => add(make(item, `p${i + 1}`, src.title ?? item.title, p, base, { ...L, newsType: item.newsType ?? null, letterNo: item.letterNo ?? null }), { proOnly: item.type === 'letter' }));
          break;
        }
        case 'document': {
          if (!isSource && !src.sections) break;
          const prev = item.supersedes ? site.byId.get(item.supersedes) : null;
          const secs = src.sections?.length ? src.sections : [{ key: 'body', heading: src.title ?? item.title, markdown: src.machineReadableMarkdown ?? '' }];
          // 第十九輪：PDF 轉來的段落帶頁碼標記 〔p.N〕→ 每頁切一塊，引用時能說「PDF 第 N 頁」並連到 #page-N；
          // index:false 的段落（表單、地圖、參考文獻）不入索引（docs/pdf-ingest.md）
          const extraction = item.derivedFrom ? { reviewStatus: item.derivedFrom.reviewStatus ?? 'machine', pdfUrl: item.pdfUrl ?? null, pageOffset: item.derivedFrom.pdfPageOffset ?? null } : null;
          for (const s of secs) {
            if (s.index === false) continue;
            const no = sectionNo(s);
            const change = (item.changes ?? []).find((ch) => ch.section === s.heading || ch.section === s.key || (no && String(ch.section).includes(`第 ${no} 條`)) || (no && String(ch.section).includes(`第${no}條`))) ?? null;
            const parts = PAGE_MARK_TEST.test(s.markdown ?? '') ? splitByPage(s.markdown) : [{ page: null, text: s.markdown }];
            for (const part of parts) {
              const key = part.page ? `${s.key}-p${part.page}` : s.key;
              add(make(item, key, `${src.title ?? item.title} · ${s.heading}`, mdSentences(part.text), part.page ? `${base}#page-${part.page}` : `${base}#s-${s.key}`, {
                ...L, docTitle: src.title ?? item.title, docType: item.docType ?? null,
                section: { key: s.key, heading: s.heading, no }, supersedesVersion: prev?.version ?? null,
                change: change ? { kind: change.kind ?? null, before: change.before ?? null, after: change.after ?? null } : null,
                ...(part.page ? { pdfPage: part.page } : {}), ...(extraction ? { extraction } : {}),
              }), { proOnly: true });
            }
          }
          break;
        }
        case 'clarification':
          add(make(item, 'c', src.title ?? item.title, [...mdSentences(src.clarificationMarkdown ?? ''), ...(src.shareText ? splitPlain(src.shareText) : [])], base, { ...L, verdict: item.gov?.stale?.length ? 'outdated' : item.verdict, claim: item.claim, extraTerms: [item.claim, ...(item.claimVariants ?? [])] }));
          break;
        case 'vaccine': {
          add(make(item, 'v', src.title ?? item.title, mdSentences(src.bodyMarkdown ?? ''), base, { ...L }));
          const groups = src.publicFunded ?? [];
          groups.forEach((g, i) => {
            if (g.endAt && today && g.endAt < today) return; // 已結束的公費期間不入索引
            const when = g.startAt || g.endAt ? `（${g.startAt ?? ''}${g.endAt ? ` 至 ${g.endAt}` : ' 起'}）` : '';
            // 句型只做欄位串接，不加「公費」字樣（自費族群也可能列在 publicFunded，由 note 說明）
            const sent = lang === 'zh-TW' ? `${item.title}接種對象：${g.group}，${g.schedule}${g.note ? `（${g.note}）` : ''}${when}。` : `${src.title ?? item.title} — ${g.group}: ${g.schedule}${g.note ? ` (${g.note})` : ''}.`;
            add(make(item, `pf-${i + 1}`, `${src.title ?? item.title} · ${lang === 'zh-TW' ? '接種對象與時程' : 'Who and when'}`, [sent], `${base}#public-funded`, { ...L, group: g.group }));
          });
          if (isSource && item.precautions) add(make(item, 'precautions', `${item.title} · 注意事項`, mdSentences(item.precautions), `${base}#precautions`, { ...L }));
          break;
        }
        case 'media': {
          if (!isSource) break; // 逐字稿只有來源語言正本
          const id = String(item.id).replace(/^media\./, '');
          // 第一塊前加一句結構化影片資訊（片名、製作日、依據版本），讓「哪一支影片」「依哪一版製作」可被引用
          const MT = { video: '影片', animation: '動畫影片', podcast: 'Podcast 節目', short: '短影音' };
          const meta = `「${item.title}」為疾管署${MT[item.mediaType] ?? '影片'}${item.producedAt ? `，${item.producedAt} 製作` : ''}${item.basedOnVersionLabel ? `，${String(item.basedOnVersionLabel).replace(/[。]$/, '')}` : ''}。`;
          const usedKeys = new Set();
          for (const [k, seg] of transcriptChunks(item).entries()) {
            const t = Math.max(0, Math.round(seg.t ?? 0));
            const chapter = seg.chapter ? { t: seg.chapter.t, label: seg.chapter.label } : null;
            let key = `t${t}`; for (let n = 2; usedKeys.has(key); n++) key = `t${t}-${n}`;
            usedKeys.add(key);
            add(make(item, key, `${item.title} · ${chapter?.label ?? mmss(t)}`, k === 0 ? [meta, ...seg.sentences] : seg.sentences, `/media/${id}/#t=${t}`, {
              ...L, mediaType: item.mediaType ?? 'video', producedAt: item.producedAt ?? null, basedOnVersionLabel: item.basedOnVersionLabel ?? null,
              chapter, t, poster: item.poster ?? null, durationSeconds: item.durationSeconds ?? null, youtubeId: item.youtubeId ?? null, basedOn: item.basedOn ?? [],
              extraTerms: ['影片', '影音', '宣導影片', '逐字稿', ...(item.series ? [item.series] : []), ...(chapter?.label ? [chapter.label] : [])],
            }));
          }
          break;
        }
        case 'topic': {
          if (!isSource && !src.introMarkdown) break; // 譯文需有簡介本文才出 chunk（只有標題摘要的譯文不入索引）
          const title = src.title ?? item.title;
          const intro = mdSentences(src.introMarkdown ?? '');
          add(make(item, 'intro', title, intro.length ? intro : splitPlain(src.summary ?? item.summary ?? ''), base, { ...L, kind: item.kind ?? null, extraTerms: zh ? ['專區'] : ['topic', 'hub'] }));
          const linkLabel = (l) => String((isSource ? l.label : l.i18n?.[lang]?.label) ?? '').trim();
          const labels = (item.links ?? []).map(linkLabel).filter(Boolean);
          if (labels.length) add(make(item, 'links', zh ? `${title} · 專區連結` : `${title} · Links`, [zh ? `${title}專區提供：${labels.join('、')}。` : `${title} provides: ${labels.join('; ')}.`], `${base}#links`, { ...L, links: (item.links ?? []).map((l) => ({ label: linkLabel(l) || l.label, href: l.href, external: !!l.external, status: l.status ?? null })), extraTerms: [...(zh ? ['專區'] : []), ...labels] }));
          break;
        }
        case 'service': {
          if (!isSource && !src.introMarkdown && !src.steps) break; // 譯文需有簡介或步驟才出 chunk
          const pick = (f) => src[f] ?? (isSource ? item[f] : undefined);
          const title = src.title ?? item.title;
          const svc = { serviceType: item.serviceType ?? null, slaDays: item.slaDays ?? null, stepsCount: (item.steps ?? []).length, applyUrl: item.applyUrl ?? null, forms: (item.forms ?? []).map((f) => ({ label: f.label, href: f.href, format: f.format ?? null })), fee: pick('fee') ?? null, slug: item.slug ?? null };
          const whoList = pick('whoCanApply') ?? [];
          const terms = [...(zh ? ['申請', '怎麼申請'] : ['apply', 'application', 'how to apply']), ...whoList];
          const who = whoList.length ? [zh ? `${title}申請對象：${whoList.join('、')}。` : `Who can apply for ${title}: ${whoList.join('; ')}.`] : [];
          const intro = mdSentences(pick('introMarkdown') ?? '');
          add(make(item, 'intro', title, [...(intro.length ? intro : splitPlain(src.summary ?? item.summary ?? '')), ...who], base, { ...L, ...svc, block: 'intro', extraTerms: terms }));
          const steps = pick('steps') ?? [];
          if (steps.length) add(make(item, 'steps', zh ? `${title} · 申請步驟` : `${title} · Steps`, steps.map((st, i) => serviceStepSentence(st, i, lang)), `${base}#steps`, { ...L, ...svc, block: 'steps', extraTerms: [...terms, ...(zh ? ['步驟', '流程'] : ['steps', 'procedure'])] }));
          const docs = pick('requiredDocuments') ?? [];
          if (docs.length) add(make(item, 'documents', zh ? `${title} · 應備文件` : `${title} · Required documents`, [zh ? `${title}申請需準備：${docs.join('、')}。` : `Documents required for ${title}: ${docs.join('; ')}.`], `${base}#documents`, { ...L, ...svc, block: 'documents', extraTerms: [...terms, ...(zh ? ['應備文件', '要帶什麼', '準備'] : ['documents', 'required'])] }));
          const fee = pick('fee');
          const legal = pick('legalBasis') ?? [];
          const sla = zh ? [
            item.slaDays != null ? `${title}處理天數：${item.slaDays} 天。` : null,
            fee ? `${title}費用：${String(fee).replace(/[。]$/, '')}。` : null,
            legal.length ? `${title}法源依據：${legal.join('、')}。` : null,
          ] : [
            item.slaDays != null ? `${title} processing time: ${item.slaDays} days.` : null,
            fee ? `${title} fee: ${String(fee).replace(/[.。]$/, '')}.` : null,
            legal.length ? `${title} legal basis: ${legal.join('; ')}.` : null,
          ];
          const slaS = sla.filter(Boolean);
          if (slaS.length) add(make(item, 'sla', zh ? `${title} · 處理天數、費用與法源` : `${title} · Processing time, fee and legal basis`, slaS, `${base}#sla`, { ...L, ...svc, block: 'sla', extraTerms: [...terms, ...(zh ? ['天數', '幾天', '費用', '法源'] : ['days', 'fee', 'cost'])] }));
          (pick('faq') ?? []).forEach((f, i) => add(make(item, `faq-${i + 1}`, f.q, splitPlain(f.a), `${base}#faq`, { ...L, ...svc, block: 'faq', question: f.q, extraTerms: [...terms, f.q] })));
          break;
        }
        case 'publication': {
          if (!isSource) break;
          const vol = [item.volume != null ? `第 ${item.volume} 卷` : null, item.issue != null ? `第 ${item.issue} 期` : null].filter(Boolean).join('');
          const pubExtra = { pubType: item.pubType ?? null, series: item.series ?? null, volume: item.volume ?? null, issue: item.issue ?? null, cover: item.cover ?? null };
          const pterms = [item.series, vol, item.volume != null ? `${item.volume}卷` : null, item.issue != null ? `${item.issue}期` : null, '出版品', '期刊'].filter(Boolean);
          const abs = mdSentences(item.abstractMarkdown ?? '');
          add(make(item, 'abstract', `${item.title}${vol && !item.title.includes(vol) ? ` · ${vol}` : ''}`, abs.length ? abs : splitPlain(item.summary ?? ''), base, { ...L, ...pubExtra, extraTerms: pterms }));
          (item.articles ?? []).forEach((a, i) => {
            const sents = [`${item.series ?? item.title}${vol}〈${a.title}〉${a.pages ? `（頁 ${a.pages}）` : ''}。`, ...splitPlain(a.abstract ?? '')];
            add(make(item, `art-${i + 1}`, `${item.title} · ${a.title}`, sents, `${base}#art-${i + 1}`, { ...L, ...pubExtra, article: { title: a.title, pages: a.pages ?? null, doi: a.doi ?? null }, diseases: a.diseases?.length ? a.diseases : item.diseases ?? [], extraTerms: [...pterms, a.title] }));
          });
          break;
        }
        case 'labtest': {
          if (!isSource) break;
          const dz = [item.disease, ...(item.diseases ?? [])].filter((x, i, a) => x && a.indexOf(x) === i);
          const labs = (item.labs ?? []).map((l) => LAB_LABELS[l] ?? l);
          (item.specimens ?? []).forEach((sp, i) => {
            add(make({ ...item, diseases: dz }, `sp-${i + 1}`, `${item.title} · ${sp.name}`, labtestSentences(item, sp, site), `${base}#sp-${i + 1}`, {
              ...L, diseases: dz, audience: ['professional'],
              specimen: { name: sp.name, container: sp.container ?? null, volume: sp.volume ?? null, timing: sp.timing ?? null, storage: sp.storage ?? null, transport: sp.transport ?? null, tests: sp.tests ?? [], turnaroundDays: sp.turnaroundDays ?? null },
              sendWithinHours: item.sendWithinHours ?? null, labs,
              extraTerms: ['檢體', '容器', '送驗', '採檢', '保存', '運送', sp.name, ...(sp.tests ?? [])],
            }), { proOnly: true });
          });
          if (item.notesMarkdown) add(make({ ...item, diseases: dz }, 'notes', `${item.title} · 注意事項`, mdSentences(item.notesMarkdown), `${base}#notes`, { ...L, diseases: dz, audience: ['professional'], extraTerms: ['檢體', '送驗'] }), { proOnly: true });
          break;
        }
        case 'job': {
          if (!isSource) break; // 職缺內容以中文正本為準（i18n 只有標題摘要）
          // 個資：只讀 jobSentences（白名單欄位）；result／waitlistUpdates 不進任何 chunk 欄位
          const { overview, details } = jobSentences(item, site);
          const g = item.gov ?? {};
          const unitName = site.unitById.get(item.hiringUnit)?.name ?? item.hiringUnit;
          const jobExtra = {
            jobStage: g.jobStage ?? null, jobStageLabel: g.jobStageLabel ?? null, jobTab: g.jobTab ?? null, archivedStage: !!g.archivedStage,
            slug: item.slug ?? null, jobType: item.jobType, hiringUnit: item.hiringUnit, hiringUnitName: unitName, positions: item.positions, workplace: item.workplace,
            applyStart: item.applyStart, deadlineAt: item.deadlineAt, applyMethod: item.applyMethod, applyHref: g.applyHref ?? item.applyUrl ?? null, applyExternal: !!item.applyUrl,
            manualStatus: item.manualStatus ?? null, hasResult: !!item.result, resultPublishedAt: item.result?.publishedAt ?? null, resultPlannedAt: item.resultPlannedAt ?? null,
            resultUrl: item.result ? `${base}#result` : null, closed: !!g.closed, focusTerms: focusTermsOf(item),
          };
          const terms = ['人才招募', '招募', '職缺', '徵才', '甄選', '報名', item.jobType, unitName, ...(item.result ? ['甄選結果', '錄取'] : [])];
          add(make(item, 'overview', item.title, overview, base, { ...L, ...jobExtra, block: 'overview', extraTerms: terms }));
          add(make(item, 'details', `${item.title} · 工作內容與資格`, details, `${base}#details`, { ...L, ...jobExtra, block: 'details', extraTerms: [...terms, '資格', '條件', '應備文件', '甄試'] }));
          break;
        }
        case 'tender': {
          if (!isSource) break;
          const { overview, scope } = tenderSentences(item, site);
          const g = item.gov ?? {};
          const unitName = site.unitById.get(item.requestingUnit)?.name ?? item.requestingUnit;
          const tenderExtra = {
            tenderStage: g.tenderStage ?? null, tenderStageLabel: g.tenderStageLabel ?? null, tenderTab: g.tenderTab ?? null, slug: item.slug ?? null,
            tenderNo: item.tenderNo, method: item.method, category: item.category, budgetNtd: item.budgetNtd, requestingUnit: item.requestingUnit, requestingUnitName: unitName,
            announcedAt: item.announcedAt, deadlineAt: item.deadlineAt, openingAt: item.openingAt ?? null, pccUrl: item.pccUrl ?? null,
            manualStatus: item.manualStatus ?? null, awarded: !!item.award, awardDate: item.award?.date ?? null, closed: !!g.closed, focusTerms: focusTermsOf(item),
          };
          const terms = ['採購公告', '採購', '招標', '標案', '投標', item.method, item.category, unitName, ...(item.award ? ['決標'] : []), ...(item.manualStatus === 'failed' ? ['流標'] : [])];
          add(make(item, 'overview', item.title, overview, base, { ...L, ...tenderExtra, block: 'overview', extraTerms: terms }));
          if (scope.length) add(make(item, 'scope', `${item.title} · 採購標的`, scope, `${base}#scope`, { ...L, ...tenderExtra, block: 'scope', extraTerms: [...terms, '標的', '規格'] }));
          break;
        }
        case 'research': {
          if (!isSource) break;
          const obj = item.objectives?.length ? [`研究目標：${item.objectives.map((o) => String(o).replace(/[。；;]$/, '')).join('；')}。`] : [];
          const abs = mdSentences(item.abstractMarkdown ?? '');
          add(make(item, 'abstract', item.title, [...(abs.length ? abs : splitPlain(item.summary ?? '')), ...obj], base, {
            ...L, audience: ['professional'], year: item.year ?? null, projectStatus: item.projectStatus ?? null, piUnit: item.piUnit ?? null, projectNo: item.projectNo ?? null,
            extraTerms: ['研究計畫', '研究', item.piUnit, item.projectNo, item.year ? `${item.year}` : null].filter(Boolean),
          }), { proOnly: true });
          break;
        }
        default: break;
      }
    }
    for (const { c, proOnly } of out) {
      if (toPub && !proOnly) pub.push(c);
      if (toPro) pro.push(c);
    }
  }

  // 防呆：唯一 id
  const dedupe = (arr) => { const seen = new Set(); return arr.filter((c) => (seen.has(c.id) ? false : seen.add(c.id))); };
  const P = dedupe(pub), R = dedupe(pro);
  // byType：民眾索引各型別塊數（新型別即使 0 也列出，方便儀表板看出「內容尚未進來」）；byTypePro：專業索引
  const TYPES = ['disease', 'faq', 'news', 'clarification', 'vaccine', 'media', 'topic', 'service', 'publication', 'job', 'tender'];
  const TYPES_PRO = [...TYPES, 'document', 'letter', 'labtest', 'research'];
  const byType = Object.fromEntries(TYPES.map((t) => [t, 0]));
  for (const c of P) byType[c.type] = (byType[c.type] ?? 0) + 1;
  const byTypePro = Object.fromEntries(TYPES_PRO.map((t) => [t, 0]));
  for (const c of R) byTypePro[c.type] = (byTypePro[c.type] ?? 0) + 1;
  const notices = { open: P.filter((c) => c.newsType && ['recruit', 'procurement'].includes(c.newsType) && !c.closed).length, closed: P.filter((c) => c.newsType && c.closed).length };
  const jobs = { open: P.filter((c) => c.type === 'job' && c.block === 'overview' && c.jobStage === 'open').length, total: P.filter((c) => c.type === 'job' && c.block === 'overview').length };
  const tenders = { open: P.filter((c) => c.type === 'tender' && c.block === 'overview' && c.tenderStage === 'open').length, total: P.filter((c) => c.type === 'tender' && c.block === 'overview').length };
  const byLang = {};
  for (const c of [...P, ...R]) byLang[c.lang] = (byLang[c.lang] ?? 0) + 1;
  const result = { public: P, pro: R };
  Object.defineProperty(result, 'stats', { value: { chunks: P.length, chunksPro: R.length, byType, byTypePro, byLang, notices, jobs, tenders }, enumerable: true });
  return result;
}
