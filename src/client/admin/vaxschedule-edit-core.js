// 疫苗接種時程表後台（/admin/vaccines/schedule/）的純函式（第三十六輪）：表單 ⇄ 主檔一筆、檢查（與 CI 的 validate 同規則）、新 id、月齡換算。
// 不碰 DOM，Node 測試直接 import（tests/round36-vaxschedule.test.mjs）。
export const STAGE_LABEL = { infant: '嬰幼兒（0–2 歲）', child: '學齡前', school: '學生', adult: '成人', pregnancy: '孕婦', older: '長者（65 歲以上）', risk: '特殊情況' };
export const FUNDED_LABEL = { public: '公費', conditional: '符合條件公費', self: '自費' };
export const FIELD_LABEL = { id: '編號', vaccine: '疫苗', label: '項目名稱', dose: '劑次', ageMinMonths: '年齡下限', ageMaxMonths: '年齡上限', ageLabel: '年齡（人看的寫法）', stage: '階段', funded: '費用', group: '公費對象', interval: '間隔', note: '備註', sourceTitle: '來源名稱', sourceUrl: '來源網址', startAt: '生效日', endAt: '結束日', recurring: '每年接種', verified: '已核對' };
const ID_RE = /^sched\.[a-z0-9][a-z0-9-]*$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 空表單 */
export function emptyState(vaccine = '') {
  return { id: '', vaccine, label: '', labelEn: '', dose: '', ageY: '', ageM: '', maxY: '', maxM: '', noMax: false, ageLabel: '', stage: 'infant', funded: 'public', group: '', interval: '', recurring: false, startAt: '', endAt: '', note: '', sourceTitle: '', sourceUrl: '', verified: false };
}
/** 月 → { y, m }；null ⇒ 空 */
export const splitMonths = (mo) => (mo == null || mo === '' ? { y: '', m: '' } : { y: String(Math.floor(Number(mo) / 12)), m: String(Number(mo) % 12) });
/** 歲＋月 → 月；兩欄皆空 ⇒ null；非法 ⇒ NaN */
export function joinMonths(y, m) {
  const by = y === '' || y == null; const bm = m === '' || m == null;
  if (by && bm) return null;
  const yy = by ? 0 : Number(y); const mm = bm ? 0 : Number(m);
  if (!Number.isFinite(yy) || !Number.isFinite(mm) || yy < 0 || mm < 0) return NaN;
  return Math.round(yy * 12 + mm);
}
/** 主檔一筆 → 表單 */
export function stateFromItem(i) {
  const a = splitMonths(i.ageMinMonths); const b = splitMonths(i.ageMaxMonths);
  return {
    id: i.id ?? '', vaccine: i.vaccine ?? '', label: i.label ?? '', labelEn: i.labelEn ?? '', dose: i.dose ?? '', ageY: a.y, ageM: a.m, maxY: b.y, maxM: b.m, noMax: i.ageMaxMonths == null,
    ageLabel: i.ageLabel ?? '', stage: i.stage ?? 'infant', funded: i.funded ?? 'public', group: i.group ?? '', interval: i.interval ?? '', recurring: i.recurring === 'yearly',
    startAt: i.startAt ?? '', endAt: i.endAt ?? '', note: i.note ?? '', sourceTitle: i.source?.title ?? '', sourceUrl: i.source?.url ?? '', verified: i.verified !== false,
  };
}
const trim = (v) => String(v ?? '').trim();
/** 表單 → 主檔一筆（空值不輸出；欄位順序固定，diff 才好看） */
export function buildItem(s) {
  const min = joinMonths(s.ageY, s.ageM);
  const max = s.noMax ? null : joinMonths(s.maxY, s.maxM);
  const out = { id: trim(s.id), vaccine: trim(s.vaccine), label: trim(s.label) };
  if (trim(s.labelEn)) out.labelEn = trim(s.labelEn);
  out.ageMinMonths = Number.isFinite(min) ? min : (min === null ? 0 : min);
  out.ageMaxMonths = s.noMax ? null : (max === null ? out.ageMinMonths : max);
  out.stage = s.stage; out.funded = s.funded;
  if (trim(s.dose)) out.dose = trim(s.dose);
  if (trim(s.ageLabel)) out.ageLabel = trim(s.ageLabel);
  if (trim(s.group)) out.group = trim(s.group);
  if (trim(s.interval)) out.interval = trim(s.interval);
  if (s.recurring) out.recurring = 'yearly';
  if (trim(s.startAt)) out.startAt = trim(s.startAt);
  if (trim(s.endAt)) out.endAt = trim(s.endAt);
  if (trim(s.note)) out.note = trim(s.note);
  if (trim(s.sourceTitle) || trim(s.sourceUrl)) out.source = { title: trim(s.sourceTitle), url: trim(s.sourceUrl) };
  out.verified = !!s.verified;
  return out;
}
/**
 * 一筆的問題清單（與 scripts/lib/validate.mjs 的 schema＋跨檔檢查同義，翻成同事看得懂的話）。
 * others：同份主檔其他筆（查 id 重複）；vaccineIds：疫苗主檔 id。
 */
export function problemsOf(item, { others = [], vaccineIds = [] } = {}) {
  const p = [];
  if (!item.id) p.push({ field: 'id', message: '編號必填（例：sched.mmr-1）' });
  else if (!ID_RE.test(item.id)) p.push({ field: 'id', message: '編號只能用 sched. 開頭加小寫英文、數字與連字號' });
  else if (others.some((o) => o.id === item.id)) p.push({ field: 'id', message: `編號 ${item.id} 已有另一筆在用` });
  if (!item.vaccine) p.push({ field: 'vaccine', message: '請選疫苗' });
  else if (vaccineIds.length && !vaccineIds.includes(item.vaccine)) p.push({ field: 'vaccine', message: `疫苗 ${item.vaccine} 不在疫苗主檔，請先在 content/master/vaccines.json 新增` });
  if (!item.label) p.push({ field: 'label', message: '項目名稱必填（例：MMR 疫苗 第 1 劑）' });
  if (!Number.isFinite(item.ageMinMonths) || item.ageMinMonths < 0) p.push({ field: 'ageMinMonths', message: '年齡下限要填（歲或月至少一欄，可填 0）' });
  if (item.ageMaxMonths != null && !Number.isFinite(item.ageMaxMonths)) p.push({ field: 'ageMaxMonths', message: '年齡上限格式不對' });
  else if (item.ageMaxMonths != null && Number.isFinite(item.ageMinMonths) && item.ageMaxMonths < item.ageMinMonths) p.push({ field: 'ageMaxMonths', message: '年齡上限小於下限（CI 會擋）' });
  if (!STAGE_LABEL[item.stage]) p.push({ field: 'stage', message: '階段不在允許清單' });
  if (!FUNDED_LABEL[item.funded]) p.push({ field: 'funded', message: '費用不在允許清單' });
  if (item.funded === 'conditional' && !item.group) p.push({ field: 'group', message: '「符合條件公費」要寫清楚條件（公費對象）' });
  if (!item.ageLabel) p.push({ field: 'ageLabel', message: '建議填「年齡（人看的寫法）」，表格與問答會直接顯示它' });
  for (const k of ['startAt', 'endAt']) if (item[k] && !DATE_RE.test(item[k])) p.push({ field: k, message: `${FIELD_LABEL[k]}請寫成 2026-01-15` });
  if (item.startAt && item.endAt && item.endAt < item.startAt) p.push({ field: 'endAt', message: '結束日早於生效日' });
  if (item.source && (!item.source.title || !item.source.url)) p.push({ field: item.source.title ? 'sourceUrl' : 'sourceTitle', message: '來源要同時有名稱與網址' });
  if (item.source?.url && !/^(https?:\/\/|\/)/.test(item.source.url)) p.push({ field: 'sourceUrl', message: '來源網址請填完整網址（https://…）或站內路徑（/vaccines/…）' });
  if (!item.source) p.push({ field: 'sourceTitle', message: '沒有來源：前台不會顯示依據，建議填疾管署公告網址', level: 'warn' });
  if (!item.verified) p.push({ field: 'verified', message: '尚未勾「已核對」：前台會標「待承辦人確認」', level: 'warn' });
  return p;
}
export const errorsOnly = (p) => p.filter((x) => x.level !== 'warn');
/** 整份主檔的問題（每筆的錯誤 ＋ 跨筆 id 重複） */
export function problemsOfAll(items, vaccineIds = []) {
  const out = [];
  items.forEach((it, idx) => { for (const p of errorsOnly(problemsOf(it, { others: items.filter((_, j) => j !== idx), vaccineIds }))) out.push({ index: idx, id: it.id, ...p }); });
  return out;
}
/** 新 id：sched.{疫苗 slug}-{流水}，避開已存在者 */
export function nextId(vaccineId, items) {
  const base = `sched.${String(vaccineId ?? '').replace(/^vaccine\./, '') || 'new'}`;
  const used = new Set(items.map((i) => i.id));
  if (!used.has(`${base}-1`) && !used.has(base)) return `${base}-1`;
  let n = 1; while (used.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}
/** 月 → 人看的字（表單旁的提示） */
export function monthsText(mo) {
  if (mo == null || !Number.isFinite(mo)) return '—';
  if (mo === 0) return '出生';
  if (mo < 24) return `${mo} 個月`;
  return mo % 12 === 0 ? `${mo / 12} 歲` : `${Math.floor(mo / 12)} 歲 ${mo % 12} 個月`;
}
/** 匯出用：去掉 undefined、保持欄位順序；id 依疫苗主檔順序再依年齡下限排序（與前台一致、diff 穩定） */
export function sortedForExport(items, vaccineOrder = []) {
  const rank = new Map(vaccineOrder.map((id, i) => [id, i]));
  return [...items].sort((a, b) => ((rank.get(a.vaccine) ?? 999) - (rank.get(b.vaccine) ?? 999)) || (a.ageMinMonths - b.ageMinMonths) || String(a.id).localeCompare(String(b.id)));
}
/** 兩版主檔的差異摘要（給送審說明用）：新增、刪除、修改的 id */
export function diffSummary(before, after) {
  const b = new Map(before.map((i) => [i.id, JSON.stringify(i)])); const a = new Map(after.map((i) => [i.id, JSON.stringify(i)]));
  const added = [...a.keys()].filter((id) => !b.has(id)); const removed = [...b.keys()].filter((id) => !a.has(id));
  const changed = [...a.keys()].filter((id) => b.has(id) && b.get(id) !== a.get(id));
  return { added, removed, changed, dirty: added.length + removed.length + changed.length > 0 };
}
