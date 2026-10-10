// SVG 迷你圖：同構（Node 建置時與瀏覽器端皆可用），純函式、不碰 DOM。
// 用法：barChartSvg([4,6,9], { labels:['W33','W34','W35'], title:'本土病例', unit:'例' })
// 顏色走 CSS 變數（inline SVG 繼承頁面 tokens）；也可傳入任何 CSS 顏色字串。

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
const num = (n) => (Math.round(n * 100) / 100).toString();
const fmt = (v) => (Math.abs(v) >= 10000 ? v.toLocaleString('en-US') : String(v));

/**
 * 長條圖。最後一根實心（最新值），其餘淡化；每根標值；底線 + 三條淡格線。
 * @param {number[]} values
 * @param {{labels?:string[],color?:string,width?:number,height?:number,unit?:string,title?:string,desc?:string,highlightLast?:boolean}} o
 */
export function barChartSvg(values, o = {}) {
  const { labels = [], color = 'var(--green-700)', width = 560, height = 200, unit = '', title = '', desc = '', highlightLast = true } = o;
  const vals = (values ?? []).map(Number).filter((v) => Number.isFinite(v));
  if (!vals.length) return '';
  const n = vals.length;
  const pad = { t: 22, r: 8, b: 28, l: 8 };
  const max = Math.max(...vals, 1);
  const iw = width - pad.l - pad.r, ih = height - pad.t - pad.b;
  const slot = iw / n, bw = Math.min(40, slot * 0.64);
  const base = pad.t + ih;
  const grid = [0.5, 1].map((f) => `<line x1="${pad.l}" x2="${width - pad.r}" y1="${num(base - ih * f)}" y2="${num(base - ih * f)}" stroke="var(--line)" stroke-width="1" stroke-dasharray="3 4"/>`).join('');
  const everyLabel = n > 14 ? 2 : 1;
  const bars = vals.map((v, i) => {
    const h = Math.max(v > 0 ? 2 : 0, (v / max) * ih);
    const x = pad.l + i * slot + (slot - bw) / 2;
    const y = base - h;
    const last = i === n - 1;
    const opacity = highlightLast && !last ? 0.5 : 1;
    const showVal = n <= 16 || last;
    return `<g><rect x="${num(x)}" y="${num(y)}" width="${num(bw)}" height="${num(h)}" rx="3" style="fill:${color};opacity:${opacity}"><title>${esc(labels[i] ?? i + 1)}：${esc(fmt(v))}${esc(unit)}</title></rect>`
      + (showVal ? `<text x="${num(x + bw / 2)}" y="${num(y - 5)}" text-anchor="middle" font-size="11" font-weight="${last ? 700 : 400}" style="fill:var(--ink-2)">${esc(fmt(v))}</text>` : '')
      + (labels[i] != null && i % everyLabel === (n - 1) % everyLabel ? `<text x="${num(x + bw / 2)}" y="${num(base + 17)}" text-anchor="middle" font-size="11" style="fill:var(--ink-3)">${esc(labels[i])}</text>` : '')
      + '</g>';
  }).join('');
  const label = title || '長條圖';
  const table = vals.map((v, i) => `${labels[i] ?? i + 1}: ${v}${unit}`).join('；');
  return `<svg class="c-chart c-chart--bar" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${esc(label)}：${esc(table)}" preserveAspectRatio="xMidYMid meet"><title>${esc(label)}</title>${desc ? `<desc>${esc(desc)}</desc>` : ''}${grid}<line x1="${pad.l}" x2="${width - pad.r}" y1="${base}" y2="${base}" stroke="var(--ink-3)" stroke-width="1"/>${bars}</svg>`;
}

/** 折線圖（含端點與標值，適合 4–24 點） */
export function lineChartSvg(values, o = {}) {
  const { labels = [], color = 'var(--green-700)', width = 560, height = 200, unit = '', title = '' } = o;
  const vals = (values ?? []).map(Number).filter((v) => Number.isFinite(v));
  if (!vals.length) return '';
  const n = vals.length;
  const pad = { t: 24, r: 16, b: 28, l: 16 };
  const min = Math.min(...vals, 0), max = Math.max(...vals, 1);
  const iw = width - pad.l - pad.r, ih = height - pad.t - pad.b;
  const X = (i) => pad.l + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);
  const Y = (v) => pad.t + ih - ((v - min) / (max - min || 1)) * ih;
  const pts = vals.map((v, i) => `${num(X(i))},${num(Y(v))}`).join(' ');
  const dots = vals.map((v, i) => `<circle cx="${num(X(i))}" cy="${num(Y(v))}" r="${i === n - 1 ? 4.5 : 3}" style="fill:${i === n - 1 ? color : 'var(--white)'};stroke:${color}" stroke-width="2"><title>${esc(labels[i] ?? i + 1)}：${esc(fmt(v))}${esc(unit)}</title></circle>`
    + (n <= 12 || i === n - 1 ? `<text x="${num(X(i))}" y="${num(Y(v) - 9)}" text-anchor="middle" font-size="11" font-weight="${i === n - 1 ? 700 : 400}" style="fill:var(--ink-2)">${esc(fmt(v))}</text>` : '')
    + (labels[i] != null ? `<text x="${num(X(i))}" y="${height - 8}" text-anchor="middle" font-size="11" style="fill:var(--ink-3)">${esc(labels[i])}</text>` : '')).join('');
  const label = title || '折線圖';
  const table = vals.map((v, i) => `${labels[i] ?? i + 1}: ${v}${unit}`).join('；');
  const grid = [0, 0.5, 1].map((f) => `<line x1="${pad.l}" x2="${width - pad.r}" y1="${num(pad.t + ih * f)}" y2="${num(pad.t + ih * f)}" stroke="var(--line)" stroke-dasharray="3 4"/>`).join('');
  return `<svg class="c-chart c-chart--line" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${esc(label)}：${esc(table)}"><title>${esc(label)}</title>${grid}<polyline points="${pts}" fill="none" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" style="stroke:${color}"/>${dots}</svg>`;
}

/** 迷你趨勢線（無座標，卡片用） */
export function sparklineSvg(values, o = {}) {
  const { color = 'var(--green-700)', width = 120, height = 32, title = '' } = o;
  const vals = (values ?? []).map(Number).filter((v) => Number.isFinite(v));
  if (vals.length < 2) return '';
  const n = vals.length, pad = 3;
  const min = Math.min(...vals), max = Math.max(...vals);
  const X = (i) => pad + (i / (n - 1)) * (width - pad * 2);
  const Y = (v) => pad + (height - pad * 2) - ((v - min) / (max - min || 1)) * (height - pad * 2);
  const pts = vals.map((v, i) => `${num(X(i))},${num(Y(v))}`).join(' ');
  const label = title || `近 ${n} 期趨勢：${vals.join('、')}`;
  return `<svg class="c-chart c-chart--spark" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${esc(label)}"><polyline points="${pts}" fill="none" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" style="stroke:${color}"/><circle cx="${num(X(n - 1))}" cy="${num(Y(vals[n - 1]))}" r="3" style="fill:${color}"/></svg>`;
}

if (typeof window !== 'undefined') { window.CDC = window.CDC || {}; window.CDC.charts = { barChartSvg, lineChartSvg, sparklineSvg }; }
