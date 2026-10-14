// 答案引擎分支：統計問答（資料集 series 的加總／最高／最低／平均；/data/ 的統計問答與答案頁 stats 意圖）。
// 第四十九輪自 core.js 原封不動搬出（程式碼一字未改，git diff --color-moved 可對照），改成「問到這類問題才 import()」，
// 大多數問題（症狀、疫苗、出國、態勢…）不必下載這段程式；為什麼這樣拆、拆了什麼、沒拆什麼，見 docs/ask-search-llm.md §14。
// 由 core.js createEngine 內的 route('stats') 建立：ctx 是同一個引擎閉包裡的狀態與共用函式（不是另一份引擎），所以行為與搬出前完全相同。
import { ownerNameOf } from './lexicon.js';
import { tokenize } from './text.js';

export default function createStatsRoute(ctx) {
  const { datasets, diseaseById, units } = ctx;

  // ── 統計 ──
  const GRAN = { year: /(年|歷年|每年|year|năm)/i, week: /(週|周|星期|week|tuần)/i, month: /(月|month|tháng)/i, day: /(日|天|每日|day|ngày)/i };
  function seriesList(ds) { const s = ds.series; if (!s) return []; return (Array.isArray(s) ? s : [s]).map((x, i) => ({ ...x, _i: i })); }
  function matchSeries(q, entities) {
    const dIds = entities.diseases.map((d) => d.id);
    const qb = new Set(tokenize(q, { query: true }));
    let best = null;
    for (const ds of datasets) for (const se of seriesList(ds)) {
      let s = 0;
      const dsDiseases = ds.diseases ?? [];
      if (dIds.length) {
        if (dsDiseases.some((d) => dIds.includes(d)) || dIds.some((id) => (ds.title ?? '').includes(diseaseById.get(id)?.name ?? '@@'))) s += 5; else continue;
      }
      for (const t of tokenize(`${se.label ?? ''} ${ds.title ?? ''}`)) if (qb.has(t)) s += 1;
      const g = Object.entries(GRAN).find(([, re]) => re.test(q))?.[0];
      if (g && se.granularity === g) s += 2;
      if (/本土/.test(q) && /本土/.test(se.label ?? '')) s += 2;
      if (/境外/.test(q) && /境外/.test(se.label ?? '')) s += 2;
      if (/本土/.test(q) && /境外/.test(se.label ?? '')) s -= 3;
      if (/境外/.test(q) && /本土/.test(se.label ?? '')) s -= 3;
      if (!best || s > best.s) best = { ds, se, s };
    }
    return best && best.s >= 3 ? best : null;
  }
  function statsAnswer(q, entities, range, lang) {
    const m = matchSeries(q, entities);
    if (!m) return null;
    const { ds, se } = m;
    let pts = [...(se.points ?? [])];
    const yearOf = (t) => Number(String(t).slice(0, 4));
    const notes = [];
    if (range.from != null) pts = pts.filter((p) => yearOf(p.t) >= range.from && yearOf(p.t) <= range.to);
    else if (range.years.length && se.granularity === 'year') pts = pts.filter((p) => range.years.includes(yearOf(p.t)));
    else if (range.n != null) {
      const n = Math.round(range.unit === se.granularity ? range.n : range.unit === 'year' && se.granularity === 'week' ? range.n * 52 : range.n);
      if (pts.length < n) notes.push(`資料僅有 ${pts.length} 個時間點`);
      pts = pts.slice(-n);
    } else if (pts.length > 10) pts = pts.slice(-10);
    if (!pts.length) return { empty: true, ds, se };
    const unit = se.unit ?? '';
    const fmt = (v) => (typeof v === 'number' ? v.toLocaleString('en-US') : String(v));
    const tLabel = (t) => (se.granularity === 'year' && /^\d{4}$/.test(String(t)) ? (lang === 'zh-TW' ? `${t} 年` : String(t)) : String(t));
    let aggregate = null;
    if (/(總共|合計|加總|一共|總計|累計|共有|total|in total|altogether|tổng)/i.test(q)) aggregate = { kind: 'sum', value: pts.reduce((s, p) => s + (Number(p.v) || 0), 0) };
    else if (/(最高|最多|最嚴重|高峰是|peak|highest|most)/i.test(q)) { const p = pts.reduce((a, b) => (Number(b.v) > Number(a.v) ? b : a)); aggregate = { kind: 'max', value: p.v, t: p.t }; }
    else if (/(最低|最少|lowest|fewest)/i.test(q)) { const p = pts.reduce((a, b) => (Number(b.v) < Number(a.v) ? b : a)); aggregate = { kind: 'min', value: p.v, t: p.t }; }
    else if (/(平均|average|mean)/i.test(q)) aggregate = { kind: 'avg', value: Math.round((pts.reduce((s, p) => s + (Number(p.v) || 0), 0) / pts.length) * 10) / 10 };
    const sid = ds.id;
    const label = se.label ?? ds.title;
    const sentences = [];
    if (aggregate) {
      const span = `${tLabel(pts[0].t)}–${tLabel(pts.at(-1).t)}`;
      const text = lang === 'zh-TW'
        ? { sum: `${label}：${span}合計 ${fmt(aggregate.value)} ${unit}。`, max: `${label}：${span}間最高為 ${tLabel(aggregate.t)}，${fmt(aggregate.value)} ${unit}。`, min: `${label}：${span}間最低為 ${tLabel(aggregate.t)}，${fmt(aggregate.value)} ${unit}。`, avg: `${label}：${span}平均每期 ${fmt(aggregate.value)} ${unit}。` }[aggregate.kind]
        : { sum: `${label}: ${span} total ${fmt(aggregate.value)} ${unit}.`, max: `${label}: highest in ${aggregate.t}, ${fmt(aggregate.value)} ${unit}.`, min: `${label}: lowest in ${aggregate.t}, ${fmt(aggregate.value)} ${unit}.`, avg: `${label}: average ${fmt(aggregate.value)} ${unit} per period.` }[aggregate.kind];
      sentences.push({ text, cite: [sid] });
    }
    for (const p of pts) sentences.push({ text: lang === 'zh-TW' ? `${tLabel(p.t)}：${fmt(p.v)} ${unit}` : `${p.t}: ${fmt(p.v)} ${unit}`, cite: [sid] });
    const source = {
      id: sid, contentId: sid, type: 'dataset', title: ds.title, url: ds.canonicalUrl ?? ds.portalUrl, owner: ds.owner, ownerName: ds.ownerName ?? ownerNameOf(units, ds.owner),
      reviewedAt: ds.lastUpdated ?? ds.reviewedAt, dataDate: ds.lastUpdated, license: ds.license ?? 'OGDL-1.0', formats: ds.formats ?? ds.format ?? [], isCurrent: true,
      portalUrl: ds.portalUrl, mirrors: ds.mirrors ?? [], schemaUrl: ds.schemaUrl ?? null, apiUrl: '/v1/datasets.json', provenance: ds.provenance ?? null, note: se.note ?? null, lang: 'zh-TW',
    };
    return { stats: { dataset: { id: ds.id, title: ds.title }, label, unit, granularity: se.granularity, points: pts, aggregate, range, notes, note: se.note ?? null }, sentences, source };
  }
  return { statsAnswer };
}
