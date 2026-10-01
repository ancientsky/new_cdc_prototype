// HTML 模板工具：html`` 標籤模板自動跳脫，raw() 才不跳脫。
import { config } from '../../site.config.mjs';

export class Raw {
  constructor(s) { this.s = String(s); }
  toString() { return this.s; }
}
export const raw = (s) => new Raw(s);

export function esc(v) {
  if (v instanceof Raw) return v.s;
  if (v == null || v === false) return '';
  return String(v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function html(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => {
    out += s;
    if (i < vals.length) {
      const v = vals[i];
      if (Array.isArray(v)) out += v.map((x) => (x instanceof Raw ? x.s : esc(x))).join('');
      else out += v instanceof Raw ? v.s : esc(v);
    }
  });
  return new Raw(out);
}

export const attr = esc;

/** 建立 ctx.url：加 basePath 與語言前綴。絕對網址原樣回傳。 */
export function makeUrl(lang = config.defaultLang) {
  const langDef = config.langs.find((l) => l.code === lang) ?? config.langs[0];
  return function url(path, { noLang = false, absolute = false } = {}) {
    if (/^https?:\/\//.test(path) || path.startsWith('mailto:') || path.startsWith('tel:')) return path;
    const p = path.startsWith('/') ? path : `/${path}`;
    const langPrefix = noLang ? '' : langDef.path;
    const rel = `${config.basePath}${langPrefix}${p}`.replace(/\/{2,}/g, '/');
    return absolute ? `${config.siteUrl}${rel}` : rel;
  };
}

export function fmtDate(iso, lang = 'zh-TW') {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  if (!y) return iso;
  if (lang === 'zh-TW') return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  try {
    return new Intl.DateTimeFormat(lang === 'tl' ? 'fil' : lang, { year: 'numeric', month: 'short', day: 'numeric' })
      .format(new Date(Date.UTC(y, m - 1, d)));
  } catch { return iso; }
}

export function todayISO(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export function addMonths(iso, months) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + months, d));
  return dt.toISOString().slice(0, 10);
}

export function daysBetween(a, b) {
  const da = new Date(`${a}T00:00:00Z`), db = new Date(`${b}T00:00:00Z`);
  return Math.round((db - da) / 86400000);
}

export function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9一-鿿]+/g, '-').replace(/^-|-$/g, '');
}

export function truncate(s, n = 120) {
  s = String(s ?? '');
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

export function jsonScript(obj) {
  // 安全嵌入 JSON 到 <script>：避免 </script> 注入
  return JSON.stringify(obj).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}
