// 疫苗接種時程地圖的前端：年齡輸入（歲＋月／生日）、#age／#vaccine／#sched 深連結、階段頁籤、標記詳情卡、現在可打／即將／已過高亮。
// 純函式（刻度、年齡解析、狀態判斷、年齡文字）自成一體、可在 Node 測試，也供建置端模板畫 SVG 時共用同一份刻度。
// 沒有 JS 時：SVG 與表格仍完整可看，標記連到表格列錨點（#sched.xxx）。
import './i18n.js';

/* ───────── 刻度：分段非線性（月） ───────── */
/** [起月, 迄月, 寬度 px]：0–24 月逐月、2–6 歲、6–18 歲、18–50 歲、50–65 歲、65 歲以上 */
export const SEGMENTS = [[0, 24, 480], [24, 72, 150], [72, 216, 150], [216, 600, 150], [600, 780, 120], [780, 960, 120]];
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
  ...[3, 4, 5, 6].map((y) => [y * 12, 'y', y]),
  ...[8, 10, 12, 15, 18].map((y) => [y * 12, 'y', y]),
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

/** 解析 location.hash：'#age=65&vaccine=vaccine.mmr&sched=sched.x'，也接受單獨的 '#sched.xxx'（無 JS 時標記的錨點）。 */
export function parseHash(hash) {
  const out = { months: null, vaccine: null, sched: null };
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
  }
  return out;
}
export function buildHash({ months = null, vaccine = null, sched = null } = {}) {
  const p = [];
  if (Number.isFinite(months) && months != null) p.push(`age=${formatAgeParam(months)}`);
  if (vaccine) p.push(`vaccine=${vaccine}`);
  if (sched) p.push(`sched=${sched}`);
  return p.length ? `#${p.join('&')}` : '';
}

/* ───────── 狀態與年齡文字 ───────── */
/** due＝現在在建議區間內；soon＝SOON_MONTHS 內到下限；past＝已超過上限；none＝尚早或未輸入年齡 */
export function statusFor(item, months) {
  if (months == null || !Number.isFinite(months)) return 'none';
  // 孕婦、特殊情況（暴露後、高風險）看身分或情況，不看年齡
  if (item.stage === 'pregnancy' || item.stage === 'risk') return 'situational';
  const min = item.ageMinMonths ?? item.min ?? 0;
  const max = item.ageMaxMonths !== undefined ? item.ageMaxMonths : item.max;
  if (months < min) return min - months <= SOON_MONTHS ? 'soon' : 'none';
  if (max != null && months > max) return 'past';
  return 'due';
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
const FUNDED_ORDER = { public: 0, conditional: 1, self: 2 };
const minOf = (i) => i.ageMinMonths ?? i.min ?? 0;
/** 排序：公費 → 符合條件公費 → 自費；同類依與目前月齡的距離（65 歲時「長者」先於「嬰幼兒」），再依年齡下限 */
export const byFunded = (a, b, months = null) => (FUNDED_ORDER[a.funded] - FUNDED_ORDER[b.funded])
  || (months == null ? 0 : Math.abs(minOf(a) - months) - Math.abs(minOf(b) - months)) || (minOf(a) - minOf(b));

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
  const state = { months: null, vaccine: null, sched: null, tab: 'all' };
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
    $$('.vxs-mk', svg).forEach((a) => { a.dataset.status = statusFor(byId.get(a.dataset.id), m); });
    $$('tr[data-sched]').forEach((tr) => { const s = statusFor(byId.get(tr.dataset.sched), m); tr.dataset.status = s; const c = tr.querySelector('[data-vxs-st]'); if (c) c.textContent = m == null ? '' : s === 'none' ? '' : T(`vxs.status.${s}`); });
    if (m == null) cursor.setAttribute('hidden', ''); else { cursor.removeAttribute('hidden'); const x = xOf(m); cursor.querySelector('line').setAttribute('x1', x); cursor.querySelector('line').setAttribute('x2', x); const tx = cursor.querySelector('text'); tx.setAttribute('x', x); tx.textContent = formatAge(m, T); }
    svg.classList.toggle('has-age', m != null);
    const box = $('[data-vxs-result]'); box.textContent = '';
    if (m == null) { box.hidden = true; return; }
    box.hidden = false;
    box.appendChild(mk('p', 'vxs-result__age', T('vxs.age.now', { age: formatAge(m, T) })));
    const groups = { due: [], soon: [], past: [], situational: [] };
    items.forEach((i) => { const s = statusFor(i, m); if (groups[s]) groups[s].push(i); });
    ['due', 'soon', 'past', 'situational'].forEach((s) => {
      const list = groups[s].sort((a, b) => byFunded(a, b, m));
      const wrap = s === 'past' ? mk('details', `vxs-result__grp vxs-result__grp--${s}`) : mk('div', `vxs-result__grp vxs-result__grp--${s}`);
      const head = mk(s === 'past' ? 'summary' : 'h3', null, `${T(`vxs.status.${s}`)}（${list.length}）`);
      wrap.appendChild(head);
      if (list.length) wrap.appendChild(mk('p', 'muted vxs-result__hint', T(`vxs.status.${s}.d`)));
      if (!list.length) { wrap.appendChild(mk('p', 'muted', T('vxs.res.none'))); box.appendChild(wrap); return; }
      const ul = mk('ul', 'vxs-result__list');
      list.forEach((i) => {
        const li = mk('li'); const a = mk('a', null, label(i)); a.href = `#${i.id}`; a.dataset.vxsPick = i.id;
        li.append(a, ' ', fundedPill(i.funded)); if (i.ver === false) li.append(' ', verPill());
        ul.appendChild(li);
      });
      wrap.appendChild(ul); box.appendChild(wrap);
    });
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
    const st = statusFor(i, state.months); if (st !== 'none') badges.append(' ', mk('span', `c-pill c-pill--${st === 'due' ? 'ok' : st === 'soon' || st === 'situational' ? 'info' : 'warn'}`, T(`vxs.status.${st}`)));
    const dl = mk('dl', 'vxs-detail__dl');
    const row = (k, val, isZh) => { if (!val) return; const d = mk('div'); const dd = mk('dd', null, val); if (isZh) zh(dd); d.append(mk('dt', null, T(k)), dd); dl.appendChild(d); };
    row('vxs.col.age', document.documentElement.lang === 'zh-TW' ? i.age : `${ageRangeLabel(i, T)}`, false);
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
  $('[data-vxs-clear]', form).addEventListener('click', () => { fb.value = ''; msg.textContent = ''; setAge(null); });
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
