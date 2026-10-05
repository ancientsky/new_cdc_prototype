// /admin/tenders/edit/ 採購公告上架與異動的純函式（不碰 DOM）。瀏覽器與 Node 測試共用。
// 階段推導與個資樣式一律用 ../careers-rules.js（CI 建置時跑的也是同一份），這裡不再抄一份規則。
import { tenderStageOf, NATIONAL_ID_RE } from '../careers-rules.js';

export { tenderStageOf };

/** 階段中文與後台徽章色（與 /admin/tenders/ 一致） */
export const STAGE_LABEL = {
  open: { label: '招標中', badge: 'ok' }, closed: { label: '已截止', badge: 'gray' }, opened: { label: '已開標', badge: 'info' },
  awarded: { label: '已決標', badge: 'ok' }, failed: { label: '流標', badge: 'warn' }, cancelled: { label: '已撤銷', badge: 'gray' },
};
/** 異動種類中文（前台 i18n proc.amend.kind.* 的中文與此一致） */
export const AMEND_KIND_LABEL = { extend: '展延', reschedule: '改期', correction: '更正', cancel: '流標／取消', other: '其他' };
/** 可異動的日期欄位 */
export const DATE_FIELDS = { deadlineAt: '投標截止日', openingAt: '開標日', briefingAt: '廠商說明會' };
export const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
export const ID_PREFIX_RE = /^tender\.\d{4}-\d{2}-\d{2}-/;
/** 建置時才加上的欄位：匯出與嵌入資料都要去掉 */
export const BUILD_FIELDS = ['gov', 'sourceHash'];
export const DEFAULTS = {
  owner: 'unit.secretariat', steward: '秘書室承辦人', status: 'published', audience: ['public'], sensitivity: 'public', license: 'OGDL-1.0',
  reviewPeriodMonths: 0, approvedBy: 'unit.oasis',
};

/** 去掉建置欄位（gov、sourceHash、__file 等底線開頭欄位） */
export function stripBuild(item) {
  return Object.fromEntries(Object.entries(item ?? {}).filter(([k]) => !k.startsWith('__') && !BUILD_FIELDS.includes(k)));
}
export const slugOfId = (id) => String(id ?? '').replace(ID_PREFIX_RE, '');

/** textarea 每行一項 */
export const linesOf = (text) => String(text ?? '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
/** 附件：每行「標題 | 網址 | 格式」（格式選填） */
export function parseAttachments(text) {
  return linesOf(text).map((line) => {
    const [label = '', url = '', format = ''] = line.split('|').map((s) => s.trim());
    return { label, url, ...(format ? { format } : {}) };
  });
}
export const attachmentsText = (list = []) => list.map((a) => [a.label, a.url, a.format].filter((v, i) => i < 2 || v).join(' | ')).join('\n');

/** 金額字串 → 整數（容許逗號、空白、NT$）；空白回 undefined，非數字回 NaN */
export function parseMoney(v) {
  if (v == null) return undefined;
  if (typeof v === 'number') return v;
  const s = String(v).replace(/[,\s，]|NT\$|元/gi, '');
  if (!s) return undefined;
  return /^\d+$/.test(s) ? Number(s) : NaN;
}

const put = (o, k, v) => {
  if (v == null || v === '' || (Array.isArray(v) && !v.length) || (typeof v === 'number' && Number.isNaN(v))) delete o[k];
  else o[k] = v;
};

/**
 * 表單值 → tender 物件（schema/tender.json）。
 * form：{ slug, title, summary, tenderNo, requestingUnit, method, awardRule, category, budgetNtd, announcedAt, deadlineAt, openingAt, briefingAt,
 *         pccUrl, scope(text|array), specialTerms(text|array), contractPeriod, attachments(text|array), contact, amendments[], manualStatus, manualStatusNote, award{date,winner,amountNtd,note} }
 * base：既有標案（編輯時；id／slug 鎖定、publishedAt／keywords／languages／i18n／legacyIds／note 等保留）；新增時為 null。
 */
export function buildTender(form, { today, base = null } = {}) {
  const f = form ?? {};
  const b = base ? stripBuild(base) : null;
  const slug = b ? (b.slug ?? slugOfId(b.id)) : String(f.slug ?? '').trim();
  const announcedAt = f.announcedAt || '';
  const id = b ? b.id : `tender.${announcedAt || today}-${slug}`;
  const asList = (v) => (Array.isArray(v) ? v.map((s) => String(s).trim()).filter(Boolean) : linesOf(v));
  const atts = Array.isArray(f.attachments) ? f.attachments : parseAttachments(f.attachments);

  // 共同欄位（順序跟既有檔案一致）；既有標案保留 steward、publishedAt、languages、keywords
  const out = {
    id, type: 'tender', title: String(f.title ?? '').trim(), owner: DEFAULTS.owner, steward: b?.steward || DEFAULTS.steward,
    publishedAt: b?.publishedAt || announcedAt || today, reviewedAt: today, reviewPeriodMonths: DEFAULTS.reviewPeriodMonths, status: DEFAULTS.status,
    audience: [...DEFAULTS.audience], sensitivity: DEFAULTS.sensitivity, license: DEFAULTS.license,
    aiWhitelist: { requested: true, approvedBy: DEFAULTS.approvedBy, approvedAt: today },
    languages: b?.languages ?? { 'zh-TW': { status: 'source' } },
    summary: String(f.summary ?? '').trim(),
  };
  // 表單不管的既有欄位（keywords、i18n、legacyIds、note、vaccines…）原樣帶過去
  const MANAGED = new Set([...Object.keys(out), 'slug', 'requestingUnit', 'tenderNo', 'method', 'awardRule', 'budgetNtd', 'category', 'announcedAt', 'deadlineAt', 'openingAt', 'briefingAt',
    'pccUrl', 'scope', 'specialTerms', 'contractPeriod', 'attachments', 'contact', 'amendments', 'manualStatus', 'manualStatusNote', 'award']);
  if (b) for (const [k, v] of Object.entries(b)) if (!MANAGED.has(k)) out[k] = v;

  out.slug = slug;
  put(out, 'requestingUnit', f.requestingUnit);
  put(out, 'tenderNo', String(f.tenderNo ?? '').trim());
  put(out, 'method', f.method);
  put(out, 'awardRule', f.awardRule);
  put(out, 'budgetNtd', parseMoney(f.budgetNtd));
  if (Number.isNaN(parseMoney(f.budgetNtd))) out.budgetNtd = String(f.budgetNtd); // 留著讓檢核與 schema 擋下
  put(out, 'category', f.category);
  put(out, 'announcedAt', announcedAt);
  put(out, 'deadlineAt', f.deadlineAt);
  put(out, 'openingAt', f.openingAt);
  put(out, 'briefingAt', f.briefingAt);
  put(out, 'pccUrl', String(f.pccUrl ?? '').trim());
  put(out, 'scope', asList(f.scope));
  put(out, 'specialTerms', asList(f.specialTerms));
  put(out, 'contractPeriod', String(f.contractPeriod ?? '').trim());
  put(out, 'attachments', atts);
  put(out, 'contact', String(f.contact ?? '').trim());
  put(out, 'amendments', (f.amendments ?? []).map((a) => ({ date: a.date, kind: a.kind, text: String(a.text ?? '').trim(), ...(a.refNo ? { refNo: String(a.refNo).trim() } : {}) })));
  put(out, 'manualStatus', f.manualStatus || '');
  put(out, 'manualStatusNote', f.manualStatus ? String(f.manualStatusNote ?? '').trim() : '');
  const aw = f.award ?? {};
  if (aw.date || aw.winner || aw.amountNtd || aw.note) {
    const award = { date: aw.date || '', winner: String(aw.winner ?? '').trim() };
    put(award, 'amountNtd', parseMoney(aw.amountNtd));
    if (Number.isNaN(parseMoney(aw.amountNtd))) award.amountNtd = String(aw.amountNtd);
    put(award, 'note', String(aw.note ?? '').trim());
    out.award = award;
  } else delete out.award;
  // 固定把 note 放最後（既有檔案的習慣）
  if ('note' in out) { const n = out.note; delete out.note; out.note = n; }
  return out;
}

/** 日期欄位的新舊差異 → [{ field, label, from, to }] */
export function dateChanges(before, after) {
  return Object.entries(DATE_FIELDS)
    .filter(([k]) => (before?.[k] ?? '') !== (after?.[k] ?? ''))
    .map(([k, label]) => ({ field: k, label, from: before?.[k] ?? '', to: after?.[k] ?? '' }));
}
/** 依日期差異自動擬一句給廠商看的說明 */
export function describeChanges(changes) {
  return changes.map((c) => {
    if (!c.from) return `${c.label}訂於 ${c.to}`;
    if (!c.to) return `${c.label}（原 ${c.from}）取消`;
    const verb = c.field === 'deadlineAt' && c.to > c.from ? '展延至' : '改為';
    return `${c.label}由 ${c.from} ${verb} ${c.to}`;
  }).join('；');
}

/**
 * 一筆時程異動紀錄。kind：deadlineAt 變晚＝extend，其他日期變動＝reschedule，沒改日期只有說明＝correction。
 * text 空白時以 describeChanges 自動擬；沒改日期也沒說明 ⇒ null。
 */
export function amendmentFor(before, after, text, today, refNo = '') {
  const ch = dateChanges(before, after);
  const t = String(text ?? '').trim();
  if (!ch.length && !t) return null;
  const dl = ch.find((c) => c.field === 'deadlineAt');
  const kind = !ch.length ? 'correction' : dl && dl.from && dl.to && dl.to > dl.from ? 'extend' : 'reschedule';
  return { date: today, kind, text: t || describeChanges(ch), ...(String(refNo ?? '').trim() ? { refNo: String(refNo).trim() } : {}) };
}
/** 流標／取消的異動紀錄（文字可再編） */
export function cancelAmendment(manualStatus, note, today) {
  if (!manualStatus) return null;
  const head = manualStatus === 'failed' ? '本標案流標' : '本標案廢標／取消';
  const n = String(note ?? '').trim();
  return { date: today, kind: 'cancel', text: n ? `${head}：${n}` : `${head}。` };
}

/** 應存的檔名：content/tenders/{yyyy-mm-dd}-{slug}.json */
export function exportFilename(tender) {
  const rest = ID_PREFIX_RE.test(String(tender?.id ?? '')) ? String(tender.id).replace(/^tender\./, '') : `${tender?.announcedAt || 'yyyy-mm-dd'}-${tender?.slug || 'slug'}`;
  return `content/tenders/${rest}.json`;
}

const REQUIRED = { title: '標案名稱', summary: '摘要', slug: '網址代稱（slug）', tenderNo: '標案案號', requestingUnit: '需求單位', method: '採購方式', category: '標的分類', budgetNtd: '預算金額', announcedAt: '公告日', deadlineAt: '投標截止日', contact: '聯絡窗口' };

/**
 * 發布前檢核 → [{ level: 'error'|'warn', field, text }]。error＝CI 會擋或資料不合理；warn＝提醒。
 * existingIds：其他既有標案的 id（編輯既有標案時請排除自己），用來找 slug 重複。
 */
export function problemsOf(t, today, existingIds = []) {
  const out = [];
  const err = (field, text) => out.push({ level: 'error', field, text });
  const warn = (field, text) => out.push({ level: 'warn', field, text });
  for (const [k, label] of Object.entries(REQUIRED)) if (t[k] == null || t[k] === '') err(k, `${label}未填`);
  if (t.slug && !SLUG_RE.test(t.slug)) err('slug', `網址代稱「${t.slug}」只能用小寫英文、數字與連字號，且不能以連字號開頭`);
  if (t.slug && [...existingIds].some((id) => slugOfId(id) === t.slug)) err('slug', `網址代稱「${t.slug}」與既有標案重複（前台路徑 /procurement/${t.slug}/ 會衝突）`);
  if (t.budgetNtd != null && t.budgetNtd !== '' && !(Number.isInteger(t.budgetNtd) && t.budgetNtd >= 0)) err('budgetNtd', '預算金額要填整數（新臺幣元，不加小數）');
  if (t.announcedAt && t.deadlineAt && t.announcedAt > t.deadlineAt) err('announcedAt', `公告日 ${t.announcedAt} 晚於投標截止日 ${t.deadlineAt}`);
  if (t.openingAt && t.deadlineAt && t.openingAt < t.deadlineAt) err('openingAt', `開標日 ${t.openingAt} 早於投標截止日 ${t.deadlineAt}`);
  if (t.briefingAt && t.deadlineAt && t.briefingAt > t.deadlineAt) warn('briefingAt', `廠商說明會 ${t.briefingAt} 晚於投標截止日 ${t.deadlineAt}`);
  if (t.announcedAt && t.announcedAt > today) warn('announcedAt', `公告日 ${t.announcedAt} 晚於今天；建置當天就會上架，若要排程請改用 publishAt`);
  if (!t.pccUrl) warn('pccUrl', '政府電子採購網連結空白：前台不會有「至採購網投標」按鈕，請補上');
  else if (!/^https?:\/\//i.test(t.pccUrl)) err('pccUrl', '政府電子採購網連結要以 https:// 開頭');
  (t.attachments ?? []).forEach((a, i) => { if (!a.label || !a.url) err('attachments', `附件第 ${i + 1} 行少了標題或網址（格式：標題 | 網址 | 格式）`); });
  (t.amendments ?? []).forEach((a, i) => {
    if (!a.text) err('amendments', `異動紀錄第 ${i + 1} 筆沒有說明`);
    else if (a.text.length > 300) err('amendments', `異動紀錄第 ${i + 1} 筆說明超過 300 字`);
    if (NATIONAL_ID_RE.test(a.text ?? '')) err('amendments', `異動紀錄第 ${i + 1} 筆含身分證字號樣式`);
  });
  if (t.manualStatus && !t.manualStatusNote) warn('manualStatusNote', '流標／取消請寫原因（會顯示在前台）');
  if (t.award && t.manualStatus) err('manualStatus', `已有決標資訊，不得再標「${t.manualStatus === 'failed' ? '流標' : '廢標／取消'}」；請擇一`);
  const a = t.award;
  if (a) {
    if (!a.winner) err('award.winner', '得標廠商未填');
    if (!a.date) err('award.date', '決標日未填');
    if (a.date && t.openingAt && a.date < t.openingAt) err('award.date', `決標日 ${a.date} 早於開標日 ${t.openingAt}`);
    if (a.date && t.deadlineAt && a.date < t.deadlineAt) err('award.date', `決標日 ${a.date} 早於投標截止日 ${t.deadlineAt}`);
    if (a.date && a.date > today) warn('award.date', `決標日 ${a.date} 晚於今天`);
    if (NATIONAL_ID_RE.test(a.winner ?? '')) err('award.winner', '得標廠商含身分證字號樣式：只公布法人名稱，不放個人身分證字號');
    if (NATIONAL_ID_RE.test(a.note ?? '')) err('award.note', '決標備註含身分證字號樣式');
    if (a.amountNtd != null && !(Number.isInteger(a.amountNtd) && a.amountNtd >= 0)) err('award.amountNtd', '決標金額要填整數（新臺幣元）');
    else if (a.amountNtd != null && Number.isInteger(t.budgetNtd) && a.amountNtd > t.budgetNtd) warn('award.amountNtd', '決標金額高於預算，請再確認');
  }
  return out;
}

/** 預覽用：階段＋中文 */
export function stageInfo(t, today) {
  const stage = tenderStageOf(t, today);
  return { stage, ...(STAGE_LABEL[stage] ?? { label: stage, badge: 'gray' }) };
}
/** 異動紀錄依日期倒序（同日保留後加的在前） */
export const sortedAmendments = (list = []) => list.map((a, i) => ({ a, i })).sort((x, y) => String(y.a.date).localeCompare(String(x.a.date)) || y.i - x.i).map((x) => x.a);
