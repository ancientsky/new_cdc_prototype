// 疫苗接種時程地圖的前端：年齡輸入（歲＋月／生日）、#age／#vaccine／#sched 深連結、階段頁籤、標記詳情卡、現在可打／即將／應已完成／已超過可接種上限高亮、「已接種」勾選（#done=，第四十輪）。
// 純函式（刻度、年齡解析、狀態判斷、年齡文字）自成一體、可在 Node 測試，也供建置端模板畫 SVG 時共用同一份刻度。
// 沒有 JS 時：SVG 與表格仍完整可看，標記連到表格列錨點（#sched.xxx）。
import './i18n.runtime.js';

/* ───────── 刻度：分段非線性（月） ───────── */
/** [起月, 迄月, 寬度 px]：0–24 月逐月、2–6 歲、6–18 歲、18–50 歲、50–65 歲、65 歲以上 */
export const SEGMENTS = [[0, 24, 480], [24, 72, 150], [72, 216, 200], [216, 600, 150], [600, 780, 120], [780, 960, 120]];
export const END_MONTHS = 960;
export const PLOT_WIDTH = SEGMENTS.reduce((s, g) => s + g[2], 0);

/** 月齡 → 橫軸座標（超出範圍夾到邊界） */
export function xOf(months) {
  const m = Math.max(0, Math.min(END_MONTHS, Number(months) || 0));
  let x = 0;
  for (const [a, b, w] of SEGMENTS) {
    if (m <= b) return Math.round((x + ((m - a) / (b - a)) * w) * 10) / 10;
    x += w;
  }
  return PLOT_WIDTH;
}

/** 刻度點：[月齡, 標籤類型, 數字]；kind 'm' 月、'y' 歲 */
export const TICKS = [
  ...[0, 3, 6, 9, 12, 15, 18, 21, 24].map((m) => [m, 'm', m]),
  ...[4, 5, 6].map((y) => [y * 12, 'y', y]),
  ...[9, 12, 15, 18].map((y) => [y * 12, 'y', y]),
  ...[30, 40, 50].map((y) => [y * 12, 'y', y]),
  ...[55, 60, 65].map((y) => [y * 12, 'y', y]),
  ...[70, 80].map((y) => [y * 12, 'y', y]),
];

/** 階段頁籤：all＝全部；其餘依 scheduleItem.stage 分組，from／to 是該頁籤的可視範圍（月） */
export const TABS = [
  { id: 'all', stages: null, from: 0, to: END_MONTHS },
  { id: 'infant', stages: ['infant'], from: 0, to: 84 },
  { id: 'school', stages: ['child', 'school'], from: 48, to: 228 },
  { id: 'adult', stages: ['adult', 'pregnancy'], from: 216, to: END_MONTHS },
  { id: 'older', stages: ['older'], from: 600, to: END_MONTHS },
  { id: 'risk', stages: ['risk'], from: 0, to: END_MONTHS },
];
export const SOON_MONTHS = 6;

/* ───────── 年齡解析 ───────── */
/** 歲＋月 → 月齡；任一欄空白視為 0，兩欄皆空／非數字／負數／超過 120 歲 ⇒ null */
export function ageToMonths(years, months) {
  const blank = (v) => v === '' || v == null;
  if (blank(years) && blank(months)) return null;
  const y = blank(years) ? 0 : Number(years);
  const m = blank(months) ? 0 : Number(months);
  if (![y, m].every(Number.isFinite) || y < 0 || m < 0) return null;
  const total = Math.floor(y) * 12 + Math.floor(m);
  return total > 1440 ? null : total;
}

/** 生日（YYYY-MM-DD）與今天 → 滿幾個月；生日在未來或格式錯 ⇒ null */
export function monthsFromBirthday(birth, today) {
  const re = /^(\d{4})-(\d{2})-(\d{2})$/;
  const b = re.exec(String(birth ?? '')); const n = re.exec(String(today ?? ''));
  if (!b || !n) return null;
  let m = (Number(n[1]) - Number(b[1])) * 12 + (Number(n[2]) - Number(b[2]));
  if (Number(n[3]) < Number(b[3])) m -= 1;
  return m < 0 || m > 1440 ? null : m;
}

/** '#age' 參數值：'65'＝65 歲、'm12'＝12 個月；其他 ⇒ null */
export function parseAgeParam(v) {
  const s = String(v ?? '').trim().toLowerCase();
  let m;
  if ((m = /^m(\d{1,4})$/.exec(s))) return Number(m[1]) <= 1440 ? Number(m[1]) : null;
  if ((m = /^(\d{1,3})$/.exec(s))) return Number(m[1]) * 12 <= 1440 ? Number(m[1]) * 12 : null;
  return null;
}
/** 月齡 → '#age' 參數值：滿 2 歲且整歲用歲數，其餘用 m<月> */
export function formatAgeParam(months) {
  return months >= 24 && months % 12 === 0 ? String(months / 12) : `m${months}`;
}

/**
 * 第四十輪：「已接種」勾選 ⇄ '#done=' 參數值。存成去掉 'sched.' 前綴、逗號分隔、排序過的字串（網址短、同一組勾選永遠同一個網址）。
 * 為什麼放在網址而不是 localStorage：與 #age= 同一套機制（可分享給另一位家長、重新整理不會掉），而且不會在共用電腦上默默留下孩子的接種紀錄；
 * 關掉分頁或按「清除」就沒了。代價是網址會帶著勾選，所以頁面上明寫「分享網址會一起帶出」。
 */
export function parseDone(v) {
  const out = [];
  for (const raw of String(v ?? '').split(',')) {
    const x = raw.trim();
    if (!x) continue;
    const id = x.startsWith('sched.') ? x : `sched.${x}`;
    if (/^sched\.[\w.-]+$/.test(id) && !out.includes(id)) out.push(id);
  }
  return out;
}
export function formatDone(ids) {
  return [...new Set([...(ids ?? [])].filter((id) => /^sched\.[\w.-]+$/.test(id)))].sort().map((id) => id.slice(6)).join(',');
}

/** 解析 location.hash：'#age=m3&vaccine=vaccine.mmr&sched=sched.x&done=hepatitis-b-1,pcv-1'，也接受單獨的 '#sched.xxx'（無 JS 時標記的錨點）。 */
export function parseHash(hash) {
  const out = { months: null, vaccine: null, sched: null, done: [] };
  const s = String(hash ?? '').replace(/^#/, '');
  if (!s) return out;
  if (/^sched\.[\w.-]+$/.test(s)) { out.sched = s; return out; }
  for (const part of s.split('&')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i); let v = part.slice(i + 1);
    try { v = decodeURIComponent(v); } catch { /* 保持原樣 */ }
    if (k === 'age') out.months = parseAgeParam(v);
    else if (k === 'vaccine' && /^vaccine\.[\w.-]+$/.test(v)) out.vaccine = v;
    else if (k === 'sched' && /^sched\.[\w.-]+$/.test(v)) out.sched = v;
    else if (k === 'done') out.done = parseDone(v);
  }
  return out;
}
export function buildHash({ months = null, vaccine = null, sched = null, done = null } = {}) {
  const p = [];
  if (Number.isFinite(months) && months != null) p.push(`age=${formatAgeParam(months)}`);
  if (vaccine) p.push(`vaccine=${vaccine}`);
  if (sched) p.push(`sched=${sched}`);
  const d = formatDone(done ?? []);
  if (d) p.push(`done=${d}`);
  return p.length ? `#${p.join('&')}` : '';
}

/* ───────── 狀態與年齡文字 ───────── */
/** 可接種年齡上限（月，不含當月）：主檔 hardLimitMonths，內嵌 JSON 用 hard；沒有就是 null（＝主檔沒有上限，不得宣稱上限） */
export function hardLimitOf(item) {
  const v = item?.hardLimitMonths ?? item?.hard;
  return Number.isFinite(v) ? v : null;
}
/**
 * 年齡 → 狀態（第四十輪把舊的 past 拆成兩種）：
 * - due＝在建議區間內；soon＝SOON_MONTHS 內到下限；none＝尚早或未輸入年齡；situational＝孕婦／特殊情況，不看年齡。
 * - completed-expected＝已過「建議區間上限」ageMaxMonths。這只代表建議時間已過、一般應已完成，**不代表不能打**——
 *   0 歲 3 個月的寶寶多半已打過 B 肝第 1、2 劑，舊版把它們說成「已超過年齡上限」，家長會以為錯過了。
 * - past-limit＝已滿「可接種年齡上限」hardLimitMonths（不含當月）。只有主檔明確填了這個欄位才會出現；沒有欄位就不宣稱上限。
 */
export function statusFor(item, months) {
  if (months == null || !Number.isFinite(months)) return 'none';
  // 孕婦、特殊情況（暴露後、高風險）看身分或情況，不看年齡
  if (item.stage === 'pregnancy' || item.stage === 'risk') return 'situational';
  const min = item.ageMinMonths ?? item.min ?? 0;
  const max = item.ageMaxMonths !== undefined ? item.ageMaxMonths : item.max;
  if (months < min) return min - months <= SOON_MONTHS ? 'soon' : 'none';
  const hard = hardLimitOf(item);
  if (hard != null && months >= hard) return 'past-limit';
  if (max != null && months > max) return 'completed-expected';
  return 'due';
}
/** 可以勾「已接種」的狀態：現在可打、應已完成、已超過上限（已打完的人勾掉，就不會再被提醒）。即將／尚早／依情況不給勾，避免誤勾未來的劑次。 */
export const DONE_ELIGIBLE = ['due', 'completed-expected', 'past-limit'];
/** 套上使用者的「已接種」勾選（Set 或陣列）：勾過且狀態可勾 ⇒ done；其餘照 statusFor */
export function statusWithDone(item, months, done = null) {
  const s = statusFor(item, months);
  const has = done ? (typeof done.has === 'function' ? done.has(item.id) : done.includes(item.id)) : false;
  return has && DONE_ELIGIBLE.includes(s) ? 'done' : s;
}
/** 結果區的群組順序：先看「現在能做什麼」，再看「之前該做的」，已勾的收到最後 */
export const RESULT_ORDER = ['due', 'soon', 'completed-expected', 'past-limit', 'situational', 'done'];
/** 月齡＋勾選 → { 狀態: [項目…] }；每組依 byFunded 排（公費常規 → 符合條件公費 → 自費，同類再依與目前月齡的距離） */
export function groupResults(items, months, done = null) {
  const out = Object.fromEntries(RESULT_ORDER.map((s) => [s, []]));
  for (const i of items) { const s = statusWithDone(i, months, done); if (out[s]) out[s].push(i); }
  for (const s of RESULT_ORDER) out[s].sort((a, b) => byFunded(a, b, months));
  return out;
}
/** 一組內再依費用分小標（只回有項目的費用類別；順序固定，與 byFunded 一致） */
export const fundedBuckets = (list) => ['public', 'conditional', 'self'].map((f) => ({ funded: f, items: list.filter((i) => i.funded === f) })).filter((b) => b.items.length);
/**
 * 「現在可打」沒有任何公費（含條件公費）時，回傳公費常規項目所在的組（空陣列＝不用提示）。
 * 為什麼要：0 歲 3 個月時「現在可打」只剩輪狀病毒與 EV71 兩項自費，讀起來像「現在只能打自費」，其實公費常規在「應已完成」與「即將」。
 */
export function publicElsewhere(groups) {
  if ((groups.due ?? []).some((i) => i.funded === 'public' || i.funded === 'conditional')) return [];
  return ['completed-expected', 'soon'].filter((s) => (groups[s] ?? []).some((i) => i.funded === 'public'));
}

/** 月齡 → 人看的文字（t 為 (key, vars) 翻譯函式） */
export function formatAge(m, t) {
  if (m === 0) return t('vxs.fmt.birth');
  if (m < 24) return t('vxs.fmt.m', { n: m });
  if (m % 12 === 0) return t('vxs.fmt.y', { n: m / 12 });
  return t('vxs.fmt.ym', { y: Math.floor(m / 12), m: m % 12 });
}
export function ageRangeLabel(item, t) {
  const min = item.ageMinMonths ?? item.min; const max = item.ageMaxMonths !== undefined ? item.ageMaxMonths : item.max;
  if (max == null) return t('vxs.fmt.min', { a: formatAge(min, t) });
  if (max === min) return formatAge(min, t);
  return t('vxs.fmt.range', { a: formatAge(min, t), b: formatAge(max, t) });
}
/** 可接種上限的人看文字（沒有上限欄位 ⇒ 空字串；呼叫端據此決定要不要顯示，避免「沒有欄位卻宣稱上限」） */
export function hardLimitLabel(item, t) {
  const h = hardLimitOf(item);
  return h == null ? '' : t('vxs.hard.value', { a: formatAge(h, t) });
}
const FUNDED_ORDER = { public: 0, conditional: 1, self: 2 };
const minOf = (i) => i.ageMinMonths ?? i.min ?? 0;
/** 排序：公費 → 符合條件公費 → 自費；同類依與目前月齡的距離（65 歲時「長者」先於「嬰幼兒」），再依年齡下限 */
export const byFunded = (a, b, months = null) => (FUNDED_ORDER[a.funded] - FUNDED_ORDER[b.funded])
  || (months == null ? 0 : Math.abs(minOf(a) - months) - Math.abs(minOf(b) - months)) || (minOf(a) - minOf(b));

/* ───────── 共用渲染（建置端與後台預覽同一份；回傳字串，文字一律 esc） ───────── */
export const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
export const LABEL_W = 150;
export const AXIS_H = 34;
export const LANE_H = 18;
export const ROW_PAD = 8;
export const FUNDED = ['public', 'conditional', 'self'];
export const STAGES = ['infant', 'child', 'school', 'adult', 'pregnancy', 'older', 'risk'];
const minOfItem = (i) => Number(i.ageMinMonths ?? i.min ?? 0);
const maxOfItem = (i) => (i.ageMaxMonths !== undefined ? i.ageMaxMonths : i.max);

/** 橫軸區間（px）；單一月齡畫成點（半徑 7，中心在該月中央），其餘畫橫條 */
export function spanOf(i) {
  const min = minOfItem(i); const max = maxOfItem(i);
  if (max === min) { const c = xOf(min + 0.5); return { x1: c - 8, x2: c + 8, point: true, c }; }
  const x1 = xOf(min); const x2 = Math.max(xOf((max ?? END_MONTHS) + 1), x1 + 10);
  return { x1, x2, point: false, open: max == null };
}
/** 同列內重疊的標記分到不同水平帶（lane） */
export function lanesOf(items) {
  const ends = []; const out = new Map();
  for (const i of items) {
    const s = spanOf(i); let l = ends.findIndex((e) => e + 3 <= s.x1);
    if (l < 0) { l = ends.length; ends.push(0); }
    ends[l] = s.x2; out.set(i.id, l);
  }
  return { lane: out, n: Math.max(1, ends.length) };
}
/** 依疫苗主檔順序分列；只列有時程項目的疫苗；每列依年齡下限排序；主檔沒有的疫苗 id 排最後（建置時 validate 會擋，這裡防呆） */
export function rowsOf(items, vaccines, { lang = 'zh-TW', hrefOf = () => null } = {}) {
  const rows = vaccines.map((m) => ({ id: m.id, name: lang === 'zh-TW' ? m.name : (m.nameEn ?? m.name), href: hrefOf(m), items: items.filter((i) => i.vaccine === m.id).sort((a, b) => minOfItem(a) - minOfItem(b)) })).filter((r) => r.items.length);
  for (const id of new Set(items.map((i) => i.vaccine))) if (!vaccines.some((m) => m.id === id)) rows.push({ id, name: id, href: null, items: items.filter((i) => i.vaccine === id) });
  return rows;
}
export const itemLabel = (i, lang) => (lang === 'zh-TW' || !i.labelEn ? i.label : i.labelEn);

/**
 * 時程地圖 SVG（字串）。rows 來自 rowsOf()；t 為翻譯函式。
 * 建置端用 raw() 嵌入頁面，後台改資料後用同一函式重畫預覽，所以同事在後台看到的就是前台會出現的圖。
 */
export function renderMapSvg(rows, { t, lang = 'zh-TW' }) {
  let y = AXIS_H; let ri = 0;
  const labels = []; const plots = [];
  for (const r of rows) {
    const { lane, n } = lanesOf(r.items);
    const h = n * LANE_H + ROW_PAD;
    const nm = esc(String(r.name).replace(/ vaccine$/i, ''));
    const text = `<text x="8" y="${h / 2 + 4}" class="vxs-rtext">${nm}</text>`;
    const marks = r.items.map((i) => {
      const s = spanOf(i); const cy = ROW_PAD / 2 + lane.get(i.id) * LANE_H + LANE_H / 2;
      const verified = i.verified !== false;
      const ttl = [itemLabel(i, lang), ageRangeLabel(i, t), t(`vxs.funded.${i.funded}`), verified ? '' : t('vxs.unverified.badge')].filter(Boolean).join(' · ');
      const shape = s.point ? `<circle class="vxs-shape" cx="${s.c}" cy="${cy}" r="7"/>` : `<rect class="vxs-shape" x="${s.x1}" y="${cy - 7}" width="${s.x2 - s.x1}" height="14" rx="7"/>${s.open ? `<path class="vxs-arrow" d="M${s.x2 - 9} ${cy - 4}l5 4l-5 4"/>` : ''}`;
      return `<a class="vxs-mk vxs-mk--${esc(i.funded)}${verified ? '' : ' is-unverified'}" href="#${esc(i.id)}" data-id="${esc(i.id)}" data-stage="${esc(i.stage)}"><title>${esc(ttl)}</title>${shape}</a>`;
    }).join('');
    labels.push(`<g class="vxs-rl" id="vaccine=${esc(r.id)}" data-row="${ri}" data-vaccine="${esc(r.id)}" transform="translate(0 ${y})"><rect class="vxs-rowbg" x="0" y="0" width="${LABEL_W}" height="${h}"/>${r.href ? `<a href="${esc(r.href)}">${text}</a>` : text}</g>`);
    plots.push(`<g class="vxs-rp" data-row="${ri}" data-vaccine="${esc(r.id)}" data-h="${h}" transform="translate(0 ${y})"><rect class="vxs-rowbg" x="0" y="0" width="${PLOT_WIDTH}" height="${h}"/>${marks}</g>`);
    y += h; ri++;
  }
  const total = y + 4;
  // 第一個與最後一個刻度文字靠邊對齊，不然會被裁切框切掉一半（匯出的圖尤其明顯）
  const ticks = TICKS.map(([mo, kind, n]) => { const x = xOf(mo); const anchor = mo === 0 ? 'start' : mo >= END_MONTHS ? 'end' : 'middle'; return `<line class="vxs-grid" x1="${x}" x2="${x}" y1="${AXIS_H - 6}" y2="2400"/><text class="vxs-tick" x="${mo === 0 ? 2 : x}" y="${AXIS_H - 12}" text-anchor="${anchor}">${esc(t(kind === 'm' ? 'vxs.tick.m' : 'vxs.tick.y', { n }))}</text>`; }).join('');
  return `<svg class="vxs-svg" data-label-w="${LABEL_W}" data-axis-h="${AXIS_H}" viewBox="0 0 ${LABEL_W + PLOT_WIDTH} ${total}" width="${LABEL_W + PLOT_WIDTH}" height="${total}" role="group" aria-labelledby="vxs-svg-t" aria-describedby="vxs-svg-d" focusable="false">
<title id="vxs-svg-t">${esc(t('vxs.map.t'))}</title><desc id="vxs-svg-d">${esc(t('vxs.map.desc'))}</desc>
<defs><pattern id="vxs-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" class="vxs-hatch-bg"/><line x1="0" y1="0" x2="0" y2="6" class="vxs-hatch-ln"/></pattern>
<clipPath id="vxs-clip"><rect x="${LABEL_W}" y="0" width="${PLOT_WIDTH}" height="${total}"/></clipPath></defs>
<g clip-path="url(#vxs-clip)"><g class="vxs-plot" transform="translate(${LABEL_W} 0)">${ticks}
<g class="vxs-cursor" hidden><line x1="0" x2="0" y1="${AXIS_H - 4}" y2="2400"/><text x="0" y="10" text-anchor="middle"></text></g>
${plots.join('\n')}</g></g>
${labels.join('\n')}
<rect class="vxs-axisbg" x="0" y="0" width="${LABEL_W}" height="${AXIS_H}"/><text class="vxs-axislabel" x="8" y="${AXIS_H - 12}">${esc(t('vxs.axis'))}</text>
</svg>`;
}

export const TABLE_COLS = ['vaccine', 'dose', 'age', 'stage', 'funded', 'group', 'interval', 'note', 'source'];
const pillOf = (f) => (f === 'public' ? 'ok' : f === 'conditional' ? 'info' : 'neutral');
/**
 * 同資料表格（字串）。sourceOf(item) → { href, ext }：建置端把站內網址加 basePath／語言；後台直接用主檔的網址。
 * zhAttr：非中文頁把中文欄位加 lang="zh-TW"（讀屏正確發音）。
 */
export function renderTableHtml(rows, { t, lang = 'zh-TW', sourceOf = (i) => (i.source?.url ? { href: i.source.url, ext: /^https?:/.test(i.source.url) } : null), scrollLabel = '' }) {
  const z = lang === 'zh-TW' ? '' : ' lang="zh-TW"';
  const head = `${TABLE_COLS.map((c) => `<th scope="col">${esc(t(`vxs.col.${c}`))}</th>`).join('')}<th scope="col" class="vxs-jsonly">${esc(t('vxs.col.status'))}</th>`;
  const body = rows.flatMap((r) => r.items.map((i) => {
    const src = sourceOf(i);
    const hard = hardLimitLabel(i, t);
    const ageText = (lang === 'zh-TW' ? (i.ageLabel ?? ageRangeLabel(i, t)) : ageRangeLabel(i, t)) + (hard ? `；${t('vxs.hard.label')}：${hard}` : '');
    return `<tr id="${esc(i.id)}" data-sched="${esc(i.id)}" data-vaccine="${esc(r.id)}">
<th scope="row">${esc(r.name)}</th><td${z}>${esc(i.dose ?? itemLabel(i, lang))}</td><td>${esc(ageText)}${hard && i.hardLimitVerified === false ? ` <span class="c-pill c-pill--warn">${esc(t('vxs.unverified.badge'))}</span>` : ''}</td><td>${esc(t(`vxs.stage.${i.stage}`))}</td>
<td><span class="c-pill c-pill--${pillOf(i.funded)}">${esc(t(`vxs.funded.${i.funded}`))}</span>${i.verified === false ? ` <span class="c-pill c-pill--warn">${esc(t('vxs.unverified.badge'))}</span>` : ''}</td>
<td${z}>${esc(i.group ?? '')}</td><td${z}>${esc(i.interval ?? '')}${i.recurring === 'yearly' ? ` ${esc(t('vxs.recurring.yearly'))}` : ''}</td><td${z}>${esc(i.note ?? '')}${i.startAt ? ` ${esc(t('vxs.col.period'))}：${esc(i.startAt)}${i.endAt ? ` – ${esc(i.endAt)}` : ''}` : ''}</td>
<td>${src?.href ? `<a href="${esc(src.href)}"${src.ext ? ' target="_blank" rel="noopener"' : ''}${z}>${esc(i.source?.title ?? src.href)}</a>` : ''}</td><td class="vxs-jsonly" data-vxs-st></td></tr>`;
  })).join('\n');
  return `<div class="c-tablewrap" role="region" tabindex="0" aria-label="${esc(scrollLabel)}"><table class="c-table vxs-table"><caption class="sr-only">${esc(t('vxs.table.t'))}</caption><thead><tr>${head}</tr></thead><tbody>
${body}
</tbody></table></div>`;
}

/* ───────── CSV（下載按鈕與建置時 /vaccines/schedule.csv 同一函式） ───────── */
export const CSV_COLS = ['id', 'vaccine', 'vaccineName', 'label', 'dose', 'ageLabel', 'ageMinMonths', 'ageMaxMonths', 'hardLimitMonths', 'hardLimitNote', 'hardLimitSourceUrl', 'hardLimitVerified', 'stage', 'funded', 'group', 'interval', 'recurring', 'startAt', 'endAt', 'note', 'sourceTitle', 'sourceUrl', 'verified'];
export function scheduleCsv(items, nameOf = (id) => id, t = null) {
  const cell = (v) => { const s = v == null ? '' : String(v); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const headers = t ? CSV_COLS.map((c) => ({ id: t('vxs.col.id'), vaccine: 'vaccine id', vaccineName: t('vxs.col.vaccine'), label: t('vxs.col.dose'), dose: 'dose', ageLabel: t('vxs.col.age'), ageMinMonths: 'ageMinMonths', ageMaxMonths: 'ageMaxMonths', hardLimitMonths: 'hardLimitMonths', hardLimitNote: t('vxs.hard.label'), hardLimitSourceUrl: 'hardLimitSourceUrl', hardLimitVerified: 'hardLimitVerified', stage: t('vxs.col.stage'), funded: t('vxs.col.funded'), group: t('vxs.col.group'), interval: t('vxs.col.interval'), recurring: t('vxs.col.recurring'), startAt: 'startAt', endAt: 'endAt', note: t('vxs.col.note'), sourceTitle: t('vxs.col.source'), sourceUrl: 'sourceUrl', verified: 'verified' }[c])) : CSV_COLS;
  const lines = [headers.map(cell).join(',')];
  for (const i of items) {
    const row = { ...i, vaccineName: nameOf(i.vaccine), sourceTitle: i.source?.title ?? '', sourceUrl: i.source?.url ?? '', verified: i.verified === false ? 'false' : 'true', ageMaxMonths: i.ageMaxMonths ?? '',
      // 第四十輪：可接種上限四欄；沒有上限時全部空白（不是 0、不是 false），讀 CSV 的人才分得出「沒有上限」與「上限未核對」
      hardLimitMonths: i.hardLimitMonths ?? '', hardLimitNote: i.hardLimitNote ?? '', hardLimitSourceUrl: i.hardLimitSource?.url ?? '', hardLimitVerified: i.hardLimitMonths == null ? '' : String(i.hardLimitVerified === true) };
    lines.push(CSV_COLS.map((c) => cell(row[c])).join(','));
  }
  return `﻿${lines.join('\r\n')}\r\n`;
}

/* ───────── 圖片匯出：把畫面上的 SVG 變成可離線開啟的檔案 ───────── */
/** 匯出時要帶走的樣式屬性（頁面用 CSS 變數上色，離線 SVG 沒有這些變數，所以逐元素寫成實際值） */
const EXPORT_PROPS = ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'font-size', 'font-family', 'font-weight', 'opacity'];
/**
 * 複製目前地圖（只含目前頁籤看得到的列）、把 CSS 算出的顏色寫進元素、去掉互動用的游標線，加上標題、日期與圖例文字。
 * 回傳 { svg: 字串, width, height }。只在瀏覽器執行（需要 getComputedStyle）。
 */
export function exportSvg(svgEl, { title, subtitle = '', legend = [], bg = '#ffffff' } = {}) {
  const clone = svgEl.cloneNode(true);
  const srcAll = svgEl.querySelectorAll('*'); const dstAll = clone.querySelectorAll('*');
  const drop = [];
  dstAll.forEach((d, idx) => {
    const s = srcAll[idx];
    if (d.classList?.contains('is-off') || d.classList?.contains('vxs-cursor')) { drop.push(d); return; }
    const cs = getComputedStyle(s);
    for (const p of EXPORT_PROPS) { const v = cs.getPropertyValue(p); if (v && v !== 'none' && v !== 'normal' && !(p === 'opacity' && v === '1')) d.setAttribute(p, v); }
    if (d.tagName === 'a') { d.removeAttribute('href'); d.removeAttribute('data-status'); }
    d.removeAttribute('tabindex');
  });
  drop.forEach((d) => d.remove());
  const vb = (svgEl.getAttribute('viewBox') ?? '').split(/\s+/).map(Number);
  const w = vb[2] || Number(svgEl.getAttribute('width')); const h = vb[3] || Number(svgEl.getAttribute('height'));
  const PAD = 16; const HEAD = title ? 44 : 0; const FOOT = legend.length ? 28 : 0;
  const W = w + PAD * 2; const H = h + HEAD + FOOT + PAD * 2;
  clone.setAttribute('x', PAD); clone.setAttribute('y', PAD + HEAD); clone.setAttribute('width', w); clone.setAttribute('height', h);
  clone.removeAttribute('class'); clone.removeAttribute('style');
  const font = getComputedStyle(svgEl).fontFamily || 'sans-serif';
  const ink = getComputedStyle(svgEl).color || '#222';
  const head = title ? `<text x="${PAD}" y="${PAD + 22}" font-family="${esc(font)}" font-size="18" font-weight="700" fill="${esc(ink)}">${esc(title)}</text>${subtitle ? `<text x="${PAD}" y="${PAD + 40}" font-family="${esc(font)}" font-size="11" fill="${esc(ink)}" opacity=".75">${esc(subtitle)}</text>` : ''}` : '';
  const foot = legend.length ? `<text x="${PAD}" y="${H - PAD - 8}" font-family="${esc(font)}" font-size="11" fill="${esc(ink)}">${esc(legend.join('　'))}</text>` : '';
  const inner = new XMLSerializer().serializeToString(clone);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${esc(font)}"><rect width="${W}" height="${H}" fill="${esc(bg)}"/>${head}${inner}${foot}</svg>`;
  return { svg, width: W, height: H };
}
export function downloadBlob(filename, blob) {
  const a = document.createElement('a'); const u = URL.createObjectURL(blob);
  a.href = u; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 2000);
}
/** SVG 字串 → PNG Blob（scale 2 = 兩倍解析度，列印不糊） */
export function svgToPng(svg, width, height, scale = 2) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement('canvas'); c.width = Math.round(width * scale); c.height = Math.round(height * scale);
        const g = c.getContext('2d'); g.scale(scale, scale); g.drawImage(img, 0, 0);
        c.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob'))), 'image/png');
      } catch (e) { reject(e); }
    };
    img.onerror = () => reject(new Error('svg-load'));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}

/* ───────── 瀏覽器端互動 ───────── */
function init() {
  const dataEl = document.getElementById('vxs-data');
  const root = document.querySelector('[data-vxs]');
  if (!dataEl || !root) return;
  let data;
  try { data = JSON.parse(dataEl.textContent); } catch { return; }
  const T = (k, v) => window.CDC.t(k, v);
  const items = data.items; const byId = new Map(items.map((i) => [i.id, i]));
  const $ = (s, el = root) => el.querySelector(s);
  const $$ = (s, el = root) => [...el.querySelectorAll(s)];
  const svg = $('.vxs-svg');
  // done：使用者勾「已接種」的時程 id（只活在網址 #done=，見 parseDone 的說明）
  const state = { months: null, vaccine: null, sched: null, tab: 'all', done: new Set() };
  const LABEL_W = Number(svg.dataset.labelW); const AXIS_H = Number(svg.dataset.axisH);
  const clip = svg.querySelector('#vxs-clip rect'); const plot = $('.vxs-plot', svg);
  const cursor = $('.vxs-cursor', svg);
  const zh = (el) => { if (document.documentElement.lang !== 'zh-TW') el.setAttribute('lang', 'zh-TW'); return el; };
  const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  /* 頁籤與版面：列依頁籤過濾、重新計算 y，viewBox 與裁切框跟著頁籤範圍 */
  function layout() {
    const tab = TABS.find((x) => x.id === state.tab) ?? TABS[0];
    const stages = tab.stages;
    let y = AXIS_H;
    $$('.vxs-rp', svg).forEach((rp) => {
      const rl = svg.querySelector(`.vxs-rl[data-row="${rp.dataset.row}"]`);
      const mks = $$('.vxs-mk', rp);
      let any = false;
      mks.forEach((a) => { const on = !stages || stages.includes(a.dataset.stage); a.classList.toggle('is-off', !on); if (on) any = true; });
      rp.classList.toggle('is-off', !any); rl.classList.toggle('is-off', !any);
      if (any) { rp.setAttribute('transform', `translate(0 ${y})`); rl.setAttribute('transform', `translate(0 ${y})`); y += Number(rp.dataset.h); }
    });
    const x0 = xOf(tab.from); const x1 = xOf(tab.to);
    plot.setAttribute('transform', `translate(${LABEL_W - x0} 0)`);
    const w = LABEL_W + (x1 - x0);
    clip.setAttribute('x', LABEL_W); clip.setAttribute('width', x1 - x0); clip.setAttribute('height', y + 4);
    svg.setAttribute('viewBox', `0 0 ${w} ${y + 4}`);
    svg.setAttribute('width', w); svg.setAttribute('height', y + 4);
    $$('.vxs-bg', svg).forEach((r) => { r.setAttribute('height', y - AXIS_H); });
    $$('[data-vxs-tab]').forEach((b) => { const on = b.dataset.vxsTab === state.tab; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; });
    const sel = $(`[data-vxs-tab="${state.tab}"]`);
    if (sel) $('#vxs-map')?.setAttribute('aria-labelledby', sel.id);
  }

  /* 年齡：標記狀態、游標線、結果清單 */
  function paintStatus() {
    const m = state.months;
    const st = (id) => statusWithDone(byId.get(id), m, state.done);
    $$('.vxs-mk', svg).forEach((a) => { a.dataset.status = st(a.dataset.id); });
    $$('tr[data-sched]').forEach((tr) => { const s = st(tr.dataset.sched); tr.dataset.status = s; const c = tr.querySelector('[data-vxs-st]'); if (c) c.textContent = m == null ? '' : s === 'none' ? '' : T(`vxs.status.${s}`); });
    if (m == null) cursor.setAttribute('hidden', ''); else { cursor.removeAttribute('hidden'); const x = xOf(m); cursor.querySelector('line').setAttribute('x1', x); cursor.querySelector('line').setAttribute('x2', x); const tx = cursor.querySelector('text'); tx.setAttribute('x', x); tx.textContent = formatAge(m, T); }
    svg.classList.toggle('has-age', m != null);
    const box = $('[data-vxs-result]');
    // 重畫前記住焦點在哪一組的第幾個勾選框；重畫後聚焦同一組同位置的勾選框（勾掉的那筆已移到「已接種」，焦點留在原組的下一筆，
    // 鍵盤使用者可以一路往下勾，也不會每勾一次就把收起來的「已接種」撐開）
    const act = document.activeElement;
    const focusAt = act?.dataset?.vxsDone ? { grp: act.dataset.grp, idx: $$(`[data-vxs-done][data-grp="${act.dataset.grp}"]`, box).indexOf(act) } : null;
    const wasOpen = new Set($$('details[data-grp]', box).filter((d) => d.open).map((d) => d.dataset.grp));
    box.textContent = '';
    if (m == null) { box.hidden = true; return; }
    box.hidden = false;
    box.appendChild(mk('p', 'vxs-result__age', T('vxs.age.now', { age: formatAge(m, T) })));
    const groups = groupResults(items, m, state.done);
    const elsewhere = publicElsewhere(groups);
    RESULT_ORDER.forEach((s) => {
      const list = groups[s];
      if (s === 'done' && !list.length) return; // 沒勾任何劑次就不出現「已接種（0）」
      if (s === 'past-limit' && !list.length) return; // 只有主檔有上限欄位的項目會進這組；空的不顯示，免得讀者以為有「上限」這回事
      // 摺疊規則：應已完成在嬰幼兒與學齡前（未滿 7 歲）展開，因為家長要在這裡勾已接種；成人看到二十筆嬰幼兒劑次只是雜訊，收起來。已接種一律收起。
      const fold = s === 'done' || (s === 'completed-expected' && m >= 84);
      const wrap = mk(fold ? 'details' : 'div', `vxs-result__grp vxs-result__grp--${s}`);
      if (fold) { wrap.dataset.grp = s; if (wasOpen.has(s)) wrap.open = true; }
      wrap.appendChild(mk(fold ? 'summary' : 'h3', null, `${T(`vxs.status.${s}`)}（${list.length}）`));
      if (list.length) wrap.appendChild(mk('p', 'muted vxs-result__hint', T(`vxs.status.${s}.d`)));
      if (s === 'due' && elsewhere.length) wrap.appendChild(mk('p', 'vxs-result__note', T('vxs.res.publicElsewhere', { where: elsewhere.map((x) => `「${T(`vxs.short.${x}`)}」`).join(T('vxs.res.or')) })));
      if (!list.length) { wrap.appendChild(mk('p', 'muted', T('vxs.res.none'))); box.appendChild(wrap); return; }
      for (const b of fundedBuckets(list)) {
        wrap.appendChild(mk('h4', `vxs-result__sub vxs-result__sub--${b.funded}`, T(`vxs.res.funded.${b.funded}`)));
        const ul = mk('ul', 'vxs-result__list');
        b.items.forEach((i) => {
          const li = mk('li'); const a = mk('a', null, label(i)); a.href = `#${i.id}`; a.dataset.vxsPick = i.id;
          li.append(a);
          if (i.ver === false) li.append(' ', verPill());
          if (s === 'past-limit') { const h = hardLimitLabel(i, T); if (h) li.append(mk('span', 'vxs-result__hard', `${T('vxs.hard.label')}：${h}`)); }
          if (s === 'done' || DONE_ELIGIBLE.includes(s)) {
            const lb = mk('label', 'vxs-done'); const cb = mk('input'); cb.type = 'checkbox'; cb.checked = s === 'done'; cb.dataset.vxsDone = i.id; cb.dataset.grp = s;
            cb.setAttribute('aria-label', `${T('vxs.done.label')}：${label(i)}`);
            lb.append(cb, ` ${T('vxs.done.label')}`); li.append(lb);
          }
          ul.appendChild(li);
        });
        wrap.appendChild(ul);
      }
      box.appendChild(wrap);
    });
    if (groups.done.length || groups['completed-expected'].length || groups.due.length) box.appendChild(mk('p', 'muted vxs-result__privacy', T('vxs.done.note', { clear: T('vxs.age.clear') })));
    if (focusAt) {
      const same = $$(`[data-vxs-done][data-grp="${focusAt.grp}"]`, box);
      const el = same[Math.min(focusAt.idx, same.length - 1)] ?? box.querySelector('.vxs-result__age');
      if (el === box.querySelector('.vxs-result__age')) el.tabIndex = -1;
      el?.focus({ preventScroll: true });
    }
  }
  const label = (i) => (document.documentElement.lang === 'zh-TW' || !i.labelEn ? i.label : i.labelEn);
  const fundedPill = (f) => mk('span', `c-pill c-pill--${f === 'public' ? 'ok' : f === 'conditional' ? 'info' : 'neutral'}`, T(`vxs.funded.${f}`));
  const verPill = () => mk('span', 'c-pill c-pill--warn', T('vxs.unverified.badge'));

  /* 疫苗列高亮 */
  function paintVaccine() {
    $$('.vxs-rl, .vxs-rp', svg).forEach((g) => g.classList.toggle('is-focus', !!state.vaccine && g.dataset.vaccine === state.vaccine));
    $$('tr[data-vaccine]').forEach((tr) => tr.classList.toggle('is-focus', !!state.vaccine && tr.dataset.vaccine === state.vaccine));
  }

  /* 詳情卡 */
  function paintDetail() {
    const box = $('#vxs-detail'); box.textContent = '';
    $$('.vxs-mk', svg).forEach((a) => a.classList.toggle('is-sel', a.dataset.id === state.sched));
    $$('tr[data-sched]').forEach((tr) => tr.classList.toggle('is-sel', tr.dataset.sched === state.sched));
    const i = byId.get(state.sched);
    if (!i) { box.appendChild(mk('p', 'muted', T('vxs.detail.hint'))); return; }
    const v = data.vaccines[i.v] ?? {};
    const h = mk('h3', null, label(i)); zh(h);
    const badges = mk('p', 'vxs-detail__badges'); badges.append(fundedPill(i.funded)); if (i.ver === false) badges.append(' ', verPill());
    const st = statusWithDone(i, state.months, state.done); if (st !== 'none') badges.append(' ', mk('span', `c-pill c-pill--${st === 'due' || st === 'done' ? 'ok' : st === 'soon' || st === 'situational' ? 'info' : 'warn'}`, T(`vxs.status.${st}`)));
    const dl = mk('dl', 'vxs-detail__dl');
    const row = (k, val, isZh) => { if (!val) return; const d = mk('div'); const dd = mk('dd', null, val); if (isZh) zh(dd); d.append(mk('dt', null, T(k)), dd); dl.appendChild(d); };
    row('vxs.col.age', document.documentElement.lang === 'zh-TW' ? i.age : `${ageRangeLabel(i, T)}`, false);
    // 可接種上限：只有主檔有 hardLimitMonths 才出現；數值未核對時明寫「待承辦人確認」，依據文字是中文（非中文頁加 lang）
    const hard = hardLimitLabel(i, T);
    if (hard) row('vxs.hard.label', `${hard}${i.hardLimitVerified === false ? `（${T('vxs.unverified.badge')}）` : ''}`, false);
    row('vxs.hard.note', i.hardLimitNote, true);
    row('vxs.col.dose', i.dose, true);
    row('vxs.col.interval', i.interval, true);
    row('vxs.col.group', i.group, true);
    if (i.recurring === 'yearly') row('vxs.col.recurring', T('vxs.recurring.yearly'), false);
    if (i.startAt) row('vxs.col.period', i.endAt ? `${i.startAt} – ${i.endAt}` : `${i.startAt} ~`, false);
    row('vxs.col.note', i.note, true);
    const links = mk('p', 'c-linkrow vxs-detail__links');
    if (v.href) { const a = mk('a', 'c-btn c-btn--ghost', `${T('vxs.detail.vaccine')}：${v.name}`); a.href = v.href; links.appendChild(a); }
    if (v.where) { const a = mk('a', 'c-btn', `${v.whereLabel} ↗`); a.href = v.where; a.target = '_blank'; a.rel = 'noopener'; links.appendChild(a); }
    if (i.src?.url) { const a = mk('a', null, `${T('vxs.detail.source')}：${i.src.title}`); a.href = i.src.url; if (i.src.ext) { a.target = '_blank'; a.rel = 'noopener'; } zh(a); links.appendChild(a); }
    if (i.hardLimitSource?.url) { const a = mk('a', null, `${T('vxs.hard.source')}：${i.hardLimitSource.title}`); a.href = i.hardLimitSource.url; if (i.hardLimitSource.ext) { a.target = '_blank'; a.rel = 'noopener'; } zh(a); links.appendChild(a); }
    const close = mk('button', 'c-btn c-btn--ghost vxs-detail__close', T('vxs.detail.close')); close.type = 'button'; close.addEventListener('click', () => select(null));
    box.append(h, badges, dl, links, close);
  }

  function writeHash() {
    const h = buildHash(state);
    try { history.replaceState(null, '', location.pathname + location.search + h); } catch { /* 忽略 */ }
  }
  function select(id, { scroll = false } = {}) {
    state.sched = id; if (id && byId.has(id)) ensureTab(byId.get(id));
    paintDetail(); writeHash();
    if (id && scroll) $('#vxs-detail')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  /* 選到的標記若不在目前頁籤，切到所屬頁籤 */
  function ensureTab(i) {
    const tab = TABS.find((x) => x.id === state.tab);
    if (tab.stages && !tab.stages.includes(i.stage)) { state.tab = TABS.find((x) => x.stages?.includes(i.stage))?.id ?? 'all'; layout(); }
  }

  /* 年齡表單 */
  const form = $('[data-vxs-form]'); const fy = $('[name=years]', form); const fm = $('[name=months]', form); const fb = $('[name=birth]', form); const msg = $('[data-vxs-msg]');
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  fb.max = today();
  function setAge(m, { fill = true } = {}) {
    state.months = m;
    if (fill) { fy.value = m == null ? '' : Math.floor(m / 12); fm.value = m == null ? '' : m % 12; }
    paintStatus(); paintDetail(); writeHash();
  }
  form.addEventListener('submit', (e) => {
    e.preventDefault(); msg.textContent = '';
    let m = fb.value ? monthsFromBirthday(fb.value, today()) : ageToMonths(fy.value, fm.value);
    if (m == null) { msg.textContent = T('vxs.age.bad'); return; }
    if (fb.value) fb.value = '';
    setAge(m);
  });
  // 清除＝年齡與「已接種」勾選一起清掉（網址也不再帶 #done=），共用電腦上按一下就不留痕跡
  $('[data-vxs-clear]', form).addEventListener('click', () => { fb.value = ''; msg.textContent = ''; state.done = new Set(); setAge(null); });
  /* 已接種勾選：改 state.done → 重畫結果、地圖與表格狀態 → 寫回網址 */
  $('[data-vxs-result]').addEventListener('change', (e) => {
    const cb = e.target.closest('[data-vxs-done]'); if (!cb) return;
    const next = new Set(state.done);
    if (cb.checked) next.add(cb.dataset.vxsDone); else next.delete(cb.dataset.vxsDone);
    state.done = next; paintStatus(); paintDetail(); writeHash();
  });
  [fy, fm].forEach((el) => el.addEventListener('input', () => { if (fy.value || fm.value) fb.value = ''; }));

  /* 頁籤 */
  const tabBtns = $$('[data-vxs-tab]');
  tabBtns.forEach((b, idx) => {
    b.addEventListener('click', () => { state.tab = b.dataset.vxsTab; layout(); });
    b.addEventListener('keydown', (e) => {
      const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!d) return; e.preventDefault();
      const n = tabBtns[(idx + d + tabBtns.length) % tabBtns.length]; n.focus(); n.click();
    });
  });

  /* 下載：PNG／SVG 取目前頁籤的畫面；CSV 取全部資料（與 /vaccines/schedule.csv 同欄位） */
  const toMaster = (i) => ({ id: i.id, vaccine: i.v, label: i.label, labelEn: i.labelEn, dose: i.dose, ageLabel: i.age, ageMinMonths: i.ageMinMonths, ageMaxMonths: i.ageMaxMonths, stage: i.stage, funded: i.funded, group: i.group, interval: i.interval, recurring: i.recurring, startAt: i.startAt, endAt: i.endAt, note: i.note, source: i.src ? { title: i.src.title, url: i.src.url } : undefined, verified: i.ver !== false, hardLimitMonths: i.hardLimitMonths ?? undefined, hardLimitNote: i.hardLimitNote ?? undefined, hardLimitSource: i.hardLimitSource ? { title: i.hardLimitSource.title, url: i.hardLimitSource.url } : undefined, hardLimitVerified: i.hardLimitVerified ?? undefined });
  const stamp = () => today();
  const dlMsg = $('[data-vxs-dlmsg]');
  const say = (txt) => { if (dlMsg) dlMsg.textContent = txt; };
  const tabName = () => T(`vxs.tab.${state.tab}`);
  const exportNow = () => exportSvg(svg, {
    title: `${T('vxs.title')}（${tabName()}）`,
    subtitle: T('vxs.dl.stamp', { date: stamp(), url: location.origin + location.pathname }),
    legend: [...['public', 'conditional', 'self'].map((f) => `${f === 'public' ? '●' : f === 'conditional' ? '▨' : '○'} ${T(`vxs.funded.${f}`)}`), items.some((i) => i.ver === false) ? `┈ ${T('vxs.unverified.badge')}` : ''].filter(Boolean),
  });
  const fileBase = () => `${T('vxs.file')}-${state.tab}-${stamp()}`;
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-vxs-dl]'); if (!b) return;
    e.preventDefault();
    try {
      if (b.dataset.vxsDl === 'svg') { const { svg: out } = exportNow(); downloadBlob(`${fileBase()}.svg`, new Blob([out], { type: 'image/svg+xml;charset=utf-8' })); }
      else if (b.dataset.vxsDl === 'png') { const { svg: out, width, height } = exportNow(); downloadBlob(`${fileBase()}.png`, await svgToPng(out, width, height)); }
      else if (b.dataset.vxsDl === 'csv') downloadBlob(`${T('vxs.file')}-${stamp()}.csv`, new Blob([scheduleCsv(items.map(toMaster), (id) => data.vaccines[id]?.name ?? id, T)], { type: 'text/csv;charset=utf-8' }));
      say(T('vxs.dl.done'));
    } catch { say(T('vxs.dl.fail')); }
  });
  /* 放大檢視：預設整張圖縮到版面寬度；勾選後用原始尺寸、可左右捲動 */
  const zoom = $('[data-vxs-zoom]');
  if (zoom) zoom.addEventListener('change', () => { $('#vxs-map').classList.toggle('is-zoom', zoom.checked); });

  /* 標記、結果清單、表格列的點擊 */
  root.addEventListener('click', (e) => {
    const a = e.target.closest('.vxs-mk, [data-vxs-pick]'); if (!a) return;
    e.preventDefault(); select(a.dataset.id ?? a.dataset.vxsPick, { scroll: true });
  });

  /* 由 hash 套用狀態（不回寫 hash，避免蓋掉使用者貼進來的參數） */
  function fromHash() {
    const h = parseHash(location.hash);
    state.vaccine = h.vaccine;
    state.sched = byId.has(h.sched) ? h.sched : null;
    state.months = h.months;
    state.done = new Set(h.done.filter((id) => byId.has(id)));
    if (h.months != null) { fy.value = Math.floor(h.months / 12); fm.value = h.months % 12; } else { fy.value = ''; fm.value = ''; }
    if (state.vaccine && state.tab !== 'all') state.tab = 'all';
    if (state.sched) ensureTab(byId.get(state.sched));
    layout(); paintStatus(); paintVaccine(); paintDetail();
    if (state.vaccine) svg.querySelector(`.vxs-rl[data-vaccine="${state.vaccine}"]`)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }
  window.addEventListener('hashchange', fromHash);
  fromHash();
  root.classList.add('is-ready');
}
if (typeof document !== 'undefined') { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init(); }
