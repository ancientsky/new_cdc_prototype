// 檔案資產（ARCHITECTURE 16.1）：附件、內文圖片、資料檔的宣告核對、自動補寫、複製到 dist。
//
// 放哪裡：content/assets/{content-id}/{file} → dist/files/{content-id}/{file}；公開網址 /files/{content-id}/{file}
//         （不含語言前綴，七語共用；HTML 輸出時 normalizeFileLinks() 統一成 basePath + /files/…）。
// 宣告：每筆內容的 assets[]（schemas/_common.json）。只有宣告的檔會被複製；未宣告的檔＝孤兒（警告＋待辦 asset-orphan）。
//
// 匯出：
//   validateAssets(site, config, { assetsDir })  → { errors[], warnings[], orphans[], files, bytes, byKind, items }（也掛 site.assetReport）
//   fixAssets(site, { assetsDir, write, root })  → { changed[], written[] }：補寫 bytes／sha256／mime／width／height 回 JSON（只改 assets 欄位文字）
//   copyAssets(site, dist, { assetsDir })        → { items, files, bytes }：只複製 published／archived 內容「有宣告」的檔
//   assetUrl(item, file)                         → '/files/{id}/{file}'（不含 basePath）
//   assetRegistryOf(site)                        → Map('/files/{id}/{file}' → { alt, width, height, kind })（md() 用）
//   normalizeFileLinks(html, { basePath, langs, siteUrl }) → HTML 內 /files/ 連結一律 basePath + /files/（去語言前綴）
//   inspectAsset(buf, ext)、imageSize(buf, ext)、svgProblems(text)、pdfHasTextLayer(buf)、suggestFileName(name)、fileNameProblems(name)
//   imageLicenseProblems(asset, allowed)、needsAccessibleVersion(asset)、assetSummary(item, toAbs)
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createHash } from 'node:crypto';
import { ROOT, CONTENT } from './load.mjs';

export const ASSETS_DIR = path.join(CONTENT, 'assets');

/** 副檔名 → 標準 mime（mime 欄位必須與此一致） */
export const MIME_BY_EXT = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  csv: 'text/csv',
  json: 'application/json',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  odt: 'application/vnd.oasis.opendocument.text',
  md: 'text/markdown',
  ics: 'text/calendar',
};
/** 副檔名 → 大小限制分組（site.config.assets.maxBytes 的 key）；文件類（docx、odt、md、ics）比照 PDF */
export const SIZE_GROUP = { pdf: 'pdf', docx: 'pdf', odt: 'pdf', md: 'pdf', ics: 'pdf', png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', svg: 'image', csv: 'data', json: 'data', xlsx: 'data' };
export const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'svg']);
export const DATA_EXT = new Set(['csv', 'json', 'xlsx']);
/** PDF 的可及性替代版本可用的格式 */
export const ACCESSIBLE_ALT_EXT = new Set(['md', 'docx', 'odt']);
export const KINDS = ['attachment', 'image', 'data'];
export const KIND_LABELS = { attachment: '附件', image: '內文圖片', data: '資料檔' };
/** 檔名規則：小寫英數、連字號、底線與點；首字英數；須有副檔名 */
export const FILE_NAME_RE = /^[a-z0-9][a-z0-9._-]*\.[a-z0-9]+$/;
/** 本署自製素材的授權（不需 source）；其他授權＝非本署素材，需 source */
export const OWN_LICENSE = 'OGDL-1.0';

export const DEFAULT_LIMITS = {
  maxBytes: { pdf: 20 * 1024 * 1024, image: 2 * 1024 * 1024, data: 50 * 1024 * 1024 },
  allowedExt: Object.keys(MIME_BY_EXT),
  maxFiles: 30,
};
const limitsOf = (config) => {
  const a = config?.assets ?? {};
  return { maxBytes: { ...DEFAULT_LIMITS.maxBytes, ...(a.maxBytes ?? {}) }, allowedExt: a.allowedExt ?? DEFAULT_LIMITS.allowedExt, maxFiles: a.maxFiles ?? DEFAULT_LIMITS.maxFiles };
};

// 這些欄位不掃 /files/ 引用（宣告本身、舊站網址、建置期欄位）
const REF_SKIP_KEYS = new Set(['assets', 'legacyUrls', 'gov', '__file', 'sourceHash', 'linkChecks']);

export const extOf = (f) => (String(f ?? '').match(/\.([^./]+)$/)?.[1] ?? '').toLowerCase();
export const sha256Of = (buf) => createHash('sha256').update(buf).digest('hex');
const fmtBytes = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`);
const fileOf = (item) => item.__file ?? item.id;
const safeDecode = (s) => { try { return decodeURIComponent(s); } catch { return s; } };

/** 公開網址路徑（不含 basePath）：/files/{id}/{file} */
export function assetUrl(item, file) {
  const id = typeof item === 'string' ? item : item?.id;
  const f = typeof file === 'string' ? file : file?.file;
  return `/files/${id}/${f}`;
}

/** 不合法檔名 → 建議檔名（小寫、空白改連字號、去掉中文與符號；全被去掉時用 file-{hash}） */
export function suggestFileName(name) {
  const raw = String(name ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').trim();
  const ext = extOf(raw).replace(/[^a-z0-9]/g, '');
  const stem = ext ? raw.slice(0, raw.length - ext.length - 1) : raw;
  let base = stem.toLowerCase().replace(/[\s\u3000]+/g, '-').replace(/[^a-z0-9._-]+/g, '-').replace(/-{2,}/g, '-').replace(/^[-._]+|[-._]+$/g, '');
  if (!base) base = `file-${createHash('sha1').update(String(name ?? '')).digest('hex').slice(0, 6)}`;
  return ext ? `${base}.${ext}` : base;
}

/** 檔名問題（空陣列＝合法） */
export function fileNameProblems(name) {
  const f = String(name ?? '');
  const out = [];
  if (!f) return ['檔名空白'];
  if (f.includes('/') || f.includes('\\')) out.push('不可含路徑分隔字元（檔案直接放在 content/assets/{id}/ 下）');
  if (/\s/.test(f)) out.push('不可有空白');
  if (/[^\x00-\x7f]/.test(f)) out.push('不可有中文或全形字');
  if (/[A-Z]/.test(f)) out.push('只能用小寫');
  if (!extOf(f)) out.push('須有副檔名');
  if (!out.length && !FILE_NAME_RE.test(f)) out.push('只能用小寫英數、連字號、底線與點，且以英數開頭');
  return out;
}

// ───────────────────────── 檔案內容判讀（零依賴） ─────────────────────────

const startsWith = (buf, bytes) => bytes.every((b, i) => buf[i] === b);
/** 從內容判斷實際格式：pdf／png／jpeg／webp／zip（docx、xlsx、odt）／svg／text／binary */
export function sniff(buf) {
  if (!buf?.length) return 'empty';
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  if (startsWith(buf, [0x50, 0x4b, 0x03, 0x04])) return 'zip';
  const head = buf.subarray(0, 8192);
  if (head.includes(0)) return 'binary';
  if (/<svg[\s>]/i.test(buf.toString('utf8'))) return 'svg';
  return 'text';
}
const EXPECT_SNIFF = { pdf: ['pdf'], png: ['png'], jpg: ['jpeg'], jpeg: ['jpeg'], webp: ['webp'], svg: ['svg'], xlsx: ['zip'], docx: ['zip'], odt: ['zip'], csv: ['text'], md: ['text', 'svg'], json: ['text'], ics: ['text'] };

/** 圖片尺寸：PNG（IHDR）、JPEG（SOFn）、WebP（VP8／VP8L／VP8X）、SVG（width／height 或 viewBox）；讀不出回 null */
export function imageSize(buf, ext = extOf('')) {
  try {
    const kind = ext === 'svg' ? 'svg' : sniff(buf);
    if (kind === 'png' && buf.subarray(12, 16).toString('latin1') === 'IHDR') return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    if (kind === 'jpeg') {
      let i = 2;
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) { i++; continue; }
        const m = buf[i + 1];
        if (m === 0xff) { i++; continue; }
        if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
        const len = buf.readUInt16BE(i + 2);
        if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
        if (m === 0xda) break;
        i += 2 + len;
      }
      return null;
    }
    if (kind === 'webp') {
      const chunk = buf.subarray(12, 16).toString('latin1');
      if (chunk === 'VP8X') return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
      if (chunk === 'VP8L') { const b = buf.readUInt32LE(21); return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 }; }
      if (chunk === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
      return null;
    }
    if (kind === 'svg') {
      const tag = buf.toString('utf8').match(/<svg\b[^>]*>/i)?.[0];
      if (!tag) return null;
      const num = (name) => { const v = tag.match(new RegExp(`\\s${name}\\s*=\\s*["']\\s*([\\d.]+)\\s*(px)?\\s*["']`, 'i')); return v ? Math.round(Number(v[1])) : null; };
      let width = num('width'), height = num('height');
      const vb = tag.match(/\sviewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*["']/i);
      if ((!width || !height) && vb) { width ??= Math.round(Number(vb[1])); height ??= Math.round(Number(vb[2])); }
      return width && height ? { width, height } : null;
    }
  } catch { /* 檔頭不完整 */ }
  return null;
}

/** SVG 安全掃描：<script>、on*= 事件屬性、javascript: 連結、外部實體 → 問題陣列 */
export function svgProblems(text) {
  const s = String(text ?? '');
  const out = [];
  if (/<script\b/i.test(s)) out.push('含 <script>');
  const ev = s.match(/\son\w+\s*=/i);
  if (ev) out.push(`含事件屬性 ${ev[0].trim()}`);
  if (/(?:href|xlink:href)\s*=\s*["']\s*javascript:/i.test(s)) out.push('含 javascript: 連結');
  if (/<!ENTITY/i.test(s)) out.push('含 <!ENTITY> 宣告');
  return out;
}

/** PDF 是否有文字層：找 BT … Tj／TJ 文字繪製運算子（含 FlateDecode 壓縮串流） */
export function pdfHasTextLayer(buf) {
  const s = buf.toString('latin1');
  const TEXT_RE = /\bBT\b[\s\S]*?(?:\)\s*Tj|\]\s*TJ|>\s*Tj|\)\s*'|\)\s*")/;
  const re = /stream\r?\n/g;
  let m, n = 0;
  while ((m = re.exec(s)) && n++ < 500) {
    const start = m.index + m[0].length;
    const end = s.indexOf('endstream', start);
    if (end < 0) break;
    const dict = s.slice(Math.max(0, m.index - 400), m.index);
    const raw = buf.subarray(start, end);
    let text = null;
    if (/\/FlateDecode/.test(dict.slice(dict.lastIndexOf('<<')))) {
      try { text = zlib.inflateSync(raw).toString('latin1'); } catch { try { text = zlib.inflateSync(raw.subarray(0, raw.length - 1)).toString('latin1'); } catch { text = null; } }
    } else text = raw.toString('latin1');
    if (text && TEXT_RE.test(text)) return true;
    re.lastIndex = end;
  }
  return false;
}

/** 讀檔並判讀：{ bytes, sha256, mime, sniffed, width, height } */
export function inspectAsset(buf, ext) {
  const out = { bytes: buf.length, sha256: sha256Of(buf), mime: MIME_BY_EXT[ext] ?? null, sniffed: sniff(buf) };
  if (IMAGE_EXT.has(ext)) Object.assign(out, imageSize(buf, ext) ?? {});
  return out;
}

/** 圖片授權問題（待辦 image-license-missing）：缺 license；非本署素材（license ≠ OGDL-1.0）缺 source；license 不在開放授權清單 */
export function imageLicenseProblems(a, allowed = ['OGDL-1.0', 'CC0-1.0', 'CC-BY-4.0']) {
  const out = [];
  if (!a?.license) { out.push('缺授權（license）'); return out; }
  if (a.license !== OWN_LICENSE && !String(a.source ?? '').trim()) out.push(`非本署素材（授權 ${a.license}）未註明來源（source）`);
  if (!allowed.includes(a.license)) out.push(`授權「${a.license}」不在開放授權清單（${allowed.join('、')}），請確認可公開再利用的範圍並於 source 註明授權來源`);
  return out;
}

/** PDF 附件需要可及性版本？（attachment、.pdf、machineReadable 不是 true、沒有 accessibleAlt） */
export const needsAccessibleVersion = (a) => a?.kind === 'attachment' && extOf(a.file) === 'pdf' && a.machineReadable !== true && !a.accessibleAlt;

// ───────────────────────── 引用掃描 ─────────────────────────

const MD_IMG_RE = /!\[([^\]]*)\]\(\s*<?(\/files\/[^)\s>]+)>?(?:\s+["'][^"']*["'])?\s*\)/g;
const HTML_IMG_RE = /<img\b[^>]*?\ssrc\s*=\s*["'](\/files\/[^"']+)["'][^>]*>/gi;
const ANY_REF_RE = /(?<=^|[\s("'<=[])\/files\/([^/\s)"'<>?#]+)\/([^/\s)"'<>?#]+)/g;

/** 一筆內容裡的 /files/ 引用 → [{ path, id, file, image, alt, field }]（image：Markdown 圖片或 <img>） */
export function fileRefsOf(item) {
  const refs = [];
  const parse = (p) => { const m = safeDecode(p.replace(/[?#].*$/, '')).match(/^\/files\/([^/]+)\/([^/]+)$/); return m ? { id: m[1], file: m[2] } : null; };
  const visit = (v, field) => {
    if (typeof v === 'string') {
      if (!v.includes('/files/')) return;
      const imgSpans = [];
      for (const m of v.matchAll(MD_IMG_RE)) { const r = parse(m[2]); imgSpans.push(m.index + m[0].indexOf(m[2])); if (r) refs.push({ path: m[2], ...r, image: true, alt: m[1].trim(), field }); }
      for (const m of v.matchAll(HTML_IMG_RE)) {
        const r = parse(m[1]); imgSpans.push(m.index + m[0].indexOf(m[1]));
        const alt = m[0].match(/\salt\s*=\s*["']([^"']*)["']/i)?.[1] ?? '';
        if (r) refs.push({ path: m[1], ...r, image: true, alt: alt.trim(), field });
      }
      for (const m of v.matchAll(ANY_REF_RE)) {
        if (imgSpans.includes(m.index)) continue;
        const r = parse(m[0]);
        if (r) refs.push({ path: m[0], ...r, image: false, alt: null, field });
      }
      return;
    }
    if (Array.isArray(v)) { v.forEach((x, i) => visit(x, `${field}[${i}]`)); return; }
    if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (!REF_SKIP_KEYS.has(k)) visit(x, field ? `${field}.${k}` : k);
  };
  visit(item, '');
  return refs;
}

// ───────────────────────── 驗證 ─────────────────────────

/**
 * 檔案資產驗證（建置的 validate 階段呼叫；errors 併入治理門檻失敗輸出）。
 * @returns {{ errors: string[], warnings: string[], orphans: {id:string, file:string, bytes:number}[], files: number, bytes: number, byKind: object, items: number }}
 */
export function validateAssets(site, config = site.config, { assetsDir = ASSETS_DIR } = {}) {
  const lim = limitsOf(config);
  const errors = [];
  const warnings = [];
  const orphans = [];
  const byKind = { attachment: 0, image: 0, data: 0 };
  let files = 0, bytes = 0, items = 0;
  const err = (item, msg) => errors.push(`${fileOf(item)}: ${msg}`);
  const warn = (item, msg) => warnings.push(`${fileOf(item)}: ${msg}`);
  const declared = new Map(); // id → Map(file → asset)
  const fix = '（可執行 npm run build -- --fix-assets 自動補寫）';

  for (const item of site.all ?? []) {
    if (item.assets == null) continue;
    if (!Array.isArray(item.assets)) { err(item, 'assets 必須是陣列'); continue; }
    items++;
    const map = new Map();
    declared.set(item.id, map);
    if (item.assets.length > lim.maxFiles) err(item, `assets 共 ${item.assets.length} 個檔，超過每筆上限 ${lim.maxFiles} 個`);
    item.assets.forEach((a, i) => {
      const at = `assets[${i}]${a?.file ? `（${a.file}）` : ''}`;
      if (!a || typeof a !== 'object' || typeof a.file !== 'string' || !a.file) { err(item, `${at} 缺 file（content/assets/${item.id}/ 下的檔名）`); return; }
      if (map.has(a.file)) err(item, `${at} 檔名重複宣告`);
      map.set(a.file, a);
      const ext = extOf(a.file);
      const nameProblems = fileNameProblems(a.file);
      if (nameProblems.length) err(item, `${at} 檔名不合法：${nameProblems.join('、')}；建議改為「${suggestFileName(a.file)}」（檔案與宣告一起改名）`);
      if (!lim.allowedExt.includes(ext)) err(item, `${at} 副檔名 .${ext || '（無）'} 不在允許清單（${lim.allowedExt.join('、')}）`);
      if (!KINDS.includes(a.kind)) err(item, `${at} kind 必須是 ${KINDS.join('／')}`);
      if (a.kind === 'image' && !IMAGE_EXT.has(ext)) err(item, `${at} kind image 只能是圖片（${[...IMAGE_EXT].join('、')}）；其他檔案請改 kind attachment`);
      if (a.kind === 'data' && !DATA_EXT.has(ext)) err(item, `${at} kind data 只能是資料檔（${[...DATA_EXT].join('、')}）；文件請改 kind attachment`);
      if ((a.kind === 'attachment' || a.kind === 'data') && !String(a.label ?? '').trim()) err(item, `${at} ${KIND_LABELS[a.kind]}必須填 label（顯示名稱，如「新聞稿全文（PDF）」）`);
      if (a.kind === 'image') {
        if (!String(a.license ?? '').trim()) err(item, `${at} 圖片必須填 license（本署自製填 OGDL-1.0；非本署素材另填 source）`);
        if (a.alt != null && String(a.alt).length > 150) err(item, `${at} alt 超過 150 字（目前 ${String(a.alt).length} 字）；長說明請放內文`);
      }
      if (a.accessibleAlt) {
        if (a.accessibleAlt === a.file) err(item, `${at} accessibleAlt 不可指向自己`);
        else if (!item.assets.some((x) => x?.file === a.accessibleAlt)) err(item, `${at} accessibleAlt「${a.accessibleAlt}」未在本筆 assets 宣告（可及性版本也要放進 content/assets/${item.id}/ 並宣告）`);
        if (!ACCESSIBLE_ALT_EXT.has(extOf(a.accessibleAlt))) err(item, `${at} accessibleAlt 只能是 ${[...ACCESSIBLE_ALT_EXT].map((x) => `.${x}`).join('、')}`);
      }

      // 檔案本身（檔名含路徑字元時不讀，避免跳出 content/assets/{id}/）
      if (/[\\/]|\.\./.test(a.file)) return;
      const p = path.join(assetsDir, item.id, a.file);
      let st = null;
      try { st = fs.statSync(p); } catch { /* 不存在 */ }
      if (!st || !st.isFile()) { err(item, `${at} 檔案不存在：${path.relative(ROOT, p)}（請放入檔案，或從 assets 移除這一筆）`); return; }
      const buf = fs.readFileSync(p);
      const info = inspectAsset(buf, ext);
      files++; bytes += info.bytes;
      if (byKind[a.kind] != null) byKind[a.kind]++;
      const group = SIZE_GROUP[ext];
      const max = group ? lim.maxBytes[group] : null;
      if (max != null && info.bytes > max) err(item, `${at} ${fmtBytes(info.bytes)} 超過${group === 'image' ? '圖片' : group === 'data' ? '資料檔' : ' PDF／文件'}上限 ${fmtBytes(max)}`);
      if (a.bytes == null) err(item, `${at} 缺 bytes（實際 ${info.bytes}）${fix}`);
      else if (a.bytes !== info.bytes) err(item, `${at} bytes 不符：宣告 ${a.bytes}、實際 ${info.bytes}（檔案已更換？確認後貼回實際值${fix}）`);
      if (!a.sha256) err(item, `${at} 缺 sha256（實際 ${info.sha256}）${fix}`);
      else if (a.sha256 !== info.sha256) err(item, `${at} sha256 不符：宣告 ${a.sha256}、實際 ${info.sha256}（檔案已更換？確認後貼回實際值${fix}）`);
      if (!a.mime) err(item, `${at} 缺 mime（應為 ${info.mime ?? '?'}）${fix}`);
      else if (info.mime && a.mime !== info.mime) err(item, `${at} mime「${a.mime}」與副檔名 .${ext} 不一致（應為 ${info.mime}）`);
      const expect = EXPECT_SNIFF[ext];
      if (expect && !expect.includes(info.sniffed)) err(item, `${at} 檔案內容與副檔名 .${ext} 不符（內容判讀為 ${info.sniffed}）`);
      if (ext === 'json' && info.sniffed === 'text') { try { JSON.parse(buf.toString('utf8')); } catch (e) { err(item, `${at} JSON 無法解析：${e.message}`); } }
      if (ext === 'svg') for (const pb of svgProblems(buf.toString('utf8'))) err(item, `${at} SVG 不安全：${pb}（請移除後重新匯出）`);
      if (IMAGE_EXT.has(ext) && info.width && info.height) {
        if ((a.width != null && a.width !== info.width) || (a.height != null && a.height !== info.height)) warn(item, `${at} width／height 宣告 ${a.width ?? '?'}×${a.height ?? '?'}，實際 ${info.width}×${info.height}${fix}`);
      }
      if (ext === 'pdf' && a.machineReadable === true && !pdfHasTextLayer(buf)) warn(item, `${at} 宣告 machineReadable:true，但偵測不到文字層（掃描檔？）；請確認或改為 false 並附可及性版本`);
    });
  }

  // 引用：/files/{id}/{file} 必須宣告；Markdown 圖片必須是 kind image 且 alt（Markdown 或 assets.alt）非空
  const imageAltOk = new Map(); // `${id}/${file}` → { anyRef, emptyRef }
  for (const item of site.all ?? []) {
    for (const r of fileRefsOf(item)) {
      const target = site.byId?.get?.(r.id) ?? (site.all ?? []).find((x) => x.id === r.id);
      if (!target) { err(item, `${r.field} 引用 ${r.path}，但內容 ${r.id} 不存在`); continue; }
      const a = declared.get(r.id)?.get(r.file);
      if (!a) { err(item, `${r.field} 引用 ${r.path}，但 ${r.id} 的 assets 未宣告 ${r.file}（檔案放 content/assets/${r.id}/ 並在 assets 宣告）`); continue; }
      if (r.image) {
        if (a.kind !== 'image') err(item, `${r.field} 以圖片引用 ${r.path}，但宣告的 kind 是 ${a.kind}（內文圖片請宣告 kind image）`);
        const k = `${r.id}/${r.file}`;
        const s = imageAltOk.get(k) ?? { anyRef: false, emptyRef: [] };
        s.anyRef = true;
        if (!r.alt) s.emptyRef.push({ item, field: r.field });
        imageAltOk.set(k, s);
      }
    }
  }
  for (const [id, map] of declared) {
    const item = site.byId?.get?.(id) ?? (site.all ?? []).find((x) => x.id === id);
    for (const [file, a] of map) {
      if (a.kind !== 'image' || String(a.alt ?? '').trim()) continue;
      const s = imageAltOk.get(`${id}/${file}`);
      if (!s?.anyRef) err(item, `assets（${file}）圖片必須填 alt（替代文字，≤ 150 字）`);
      else for (const e of s.emptyRef) err(e.item, `${e.field} 圖片 /files/${id}/${file} 沒有替代文字：Markdown ![替代文字](…) 或 assets.alt 擇一必填`);
    }
  }

  // 孤兒檔與不存在的內容 id
  if (fs.existsSync(assetsDir)) {
    for (const d of fs.readdirSync(assetsDir, { withFileTypes: true })) {
      if (d.name.startsWith('.') || d.name.startsWith('_')) continue;
      const rel = path.relative(ROOT, path.join(assetsDir, d.name));
      if (!d.isDirectory()) { warnings.push(`${rel}: content/assets/ 下只放以內容 id 命名的資料夾，這個檔案不會被複製`); continue; }
      const item = site.byId?.get?.(d.name) ?? (site.all ?? []).find((x) => x.id === d.name);
      if (!item) { errors.push(`${rel}/: 內容 id ${d.name} 不存在（內容改名或刪除時，資料夾要一起搬移或刪除）`); continue; }
      const map = declared.get(d.name) ?? new Map();
      for (const f of fs.readdirSync(path.join(assetsDir, d.name), { withFileTypes: true })) {
        if (f.name.startsWith('.')) continue;
        if (f.isDirectory()) { warnings.push(`${rel}/${f.name}/: 不支援子資料夾，檔案請直接放在 ${rel}/`); continue; }
        if (map.has(f.name)) continue;
        const sz = fs.statSync(path.join(assetsDir, d.name, f.name)).size;
        orphans.push({ id: d.name, file: f.name, bytes: sz });
        warnings.push(`${rel}/${f.name}: 孤兒檔（${item.__file ?? d.name} 的 assets 未宣告，不會複製到 dist）；請宣告或刪除`);
      }
    }
  }

  const report = { errors, warnings, orphans, files, bytes, byKind, items };
  site.assetReport = report;
  return report;
}

// ───────────────────────── --fix-assets ─────────────────────────

const ASSET_KEY_ORDER = ['file', 'kind', 'label', 'alt', 'mime', 'bytes', 'sha256', 'width', 'height', 'machineReadable', 'accessibleAlt', 'version', 'effectiveAt', 'source', 'license'];
/** 依標準欄位順序排列（未知欄位放最後，保留） */
export function orderAsset(a) {
  const out = {};
  for (const k of ASSET_KEY_ORDER) if (a[k] !== undefined) out[k] = a[k];
  for (const [k, v] of Object.entries(a)) if (!(k in out)) out[k] = v;
  return out;
}

/** 找出 JSON 文字中頂層 key 的值範圍 → { start, end, indent }；找不到回 null（字串感知的極簡掃描器） */
export function topLevelValueSpan(text, key) {
  let depth = 0, i = 0;
  const n = text.length;
  const readString = (j) => { j++; while (j < n) { if (text[j] === '\\') { j += 2; continue; } if (text[j] === '"') return j + 1; j++; } return n; };
  while (i < n) {
    const ch = text[i];
    if (ch === '"') {
      const end = readString(i);
      if (depth === 1) {
        let j = end; while (/\s/.test(text[j] ?? '')) j++;
        if (text[j] === ':' && JSON.parse(text.slice(i, end)) === key) {
          j++; while (/\s/.test(text[j] ?? '')) j++;
          const start = j;
          let d = 0, k = j;
          while (k < n) {
            const c = text[k];
            if (c === '"') { k = readString(k); if (d === 0) break; continue; }
            if (c === '{' || c === '[') d++;
            else if (c === '}' || c === ']') { d--; if (d === 0) { k++; break; } if (d < 0) break; }
            else if (d === 0 && (c === ',' || c === '\n')) break;
            k++;
          }
          const lineStart = text.lastIndexOf('\n', i) + 1;
          return { start, end: k, indent: text.slice(lineStart, i).match(/^\s*/)[0] };
        }
      }
      i = end; continue;
    }
    if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') depth--;
    i++;
  }
  return null;
}

/** 把頂層 key 的值換成 value（兩格縮排、對齊原縮排），其餘文字原樣保留；找不到 key 回 null */
export function replaceTopLevelValue(text, key, value) {
  const span = topLevelValueSpan(text, key);
  if (!span) return null;
  const body = JSON.stringify(value, null, 2).split('\n').map((l, i) => (i ? span.indent + l : l)).join('\n');
  return text.slice(0, span.start) + body + text.slice(span.end);
}

/**
 * 補寫 bytes／sha256／mime／width／height（PNG／JPEG／WebP／SVG 讀檔頭）回內容 JSON：只替換 assets 欄位那一段文字，其餘格式不動。
 * 也更新記憶體中的 item.assets（之後的驗證直接通過）。
 * @returns {{ changed: {id:string, file:string, fields:string[]}[], written: string[] }}
 */
export function fixAssets(site, { assetsDir = ASSETS_DIR, write = true, root = ROOT } = {}) {
  const changed = [];
  const written = [];
  for (const item of site.all ?? []) {
    if (!Array.isArray(item.assets) || !item.assets.length) continue;
    let dirty = false;
    const next = item.assets.map((a) => {
      if (!a?.file) return a;
      const p = path.join(assetsDir, item.id, a.file);
      if (!fs.existsSync(p)) return a;
      const ext = extOf(a.file);
      const info = inspectAsset(fs.readFileSync(p), ext);
      const upd = { ...a };
      const fields = [];
      const set = (k, v) => { if (v != null && upd[k] !== v) { upd[k] = v; fields.push(k); } };
      set('bytes', info.bytes);
      set('sha256', info.sha256);
      set('mime', info.mime);
      if (IMAGE_EXT.has(ext)) { set('width', info.width); set('height', info.height); }
      if (!fields.length) return a;
      dirty = true;
      changed.push({ id: item.id, file: a.file, fields });
      return orderAsset(upd);
    });
    if (!dirty) continue;
    item.assets = next;
    if (!write || !item.__file) continue;
    const fp = path.join(root, item.__file);
    if (!fs.existsSync(fp)) continue;
    const text = fs.readFileSync(fp, 'utf8');
    const raw = JSON.parse(text);
    if (raw.id !== item.id) continue;
    let out = replaceTopLevelValue(text, 'assets', next);
    if (out == null) out = `${JSON.stringify({ ...raw, assets: next }, null, 2)}\n`;
    JSON.parse(out); // 保險：寫回前確認仍是合法 JSON
    if (out !== text) { fs.writeFileSync(fp, out); written.push(item.__file); }
  }
  return { changed, written };
}

// ───────────────────────── 輸出 ─────────────────────────

/** 只複製 published／archived 內容「有宣告且存在」的檔 → dist/files/{id}/{file} */
export function copyAssets(site, dist, { assetsDir = ASSETS_DIR, statuses = ['published', 'archived'] } = {}) {
  let items = 0, files = 0, bytes = 0;
  for (const item of site.all ?? []) {
    if (!Array.isArray(item.assets) || !item.assets.length || !statuses.includes(item.status)) continue;
    let n = 0;
    for (const a of item.assets) {
      if (!a?.file || fileNameProblems(a.file).length) continue;
      const src = path.join(assetsDir, item.id, a.file);
      if (!fs.existsSync(src)) continue;
      const dst = path.join(dist, 'files', item.id, a.file);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
      n++; files++; bytes += fs.statSync(src).size;
    }
    if (n) items++;
  }
  return { items, files, bytes };
}

/** md() 用的全站登錄：'/files/{id}/{file}' → { alt, width, height, kind } */
export function assetRegistryOf(site) {
  const map = new Map();
  for (const item of site.all ?? []) {
    for (const a of Array.isArray(item.assets) ? item.assets : []) {
      if (a?.file) map.set(assetUrl(item, a), { alt: a.alt ?? null, width: a.width ?? null, height: a.height ?? null, kind: a.kind ?? null });
    }
  }
  return map;
}

/** API／catalog 用摘要：[{ file, kind, label, url, bytes, mime, machineReadable, alt?, accessibleAlt? }] */
export function assetSummary(item, toAbs = (p) => p) {
  return (Array.isArray(item.assets) ? item.assets : []).filter((a) => a?.file).map((a) => {
    const o = { file: a.file, kind: a.kind, label: a.label ?? null, url: toAbs(assetUrl(item, a)), bytes: a.bytes ?? null, mime: a.mime ?? null, machineReadable: a.machineReadable ?? null };
    if (a.kind === 'image') o.alt = a.alt ?? null;
    if (a.accessibleAlt) o.accessibleAlt = toAbs(assetUrl(item, a.accessibleAlt));
    return o;
  });
}

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/**
 * HTML 內的 /files/ 連結正規化：檔案網址不含語言前綴（七語共用）。模板以 ctx.url() 產生附件連結時會加上 /en 等語言前綴、
 * 或直接輸出 /files/… 而漏掉 basePath；這裡在寫檔前統一改成 {basePath}/files/…（屬性值與 siteUrl 開頭的絕對網址）。
 */
export function normalizeFileLinks(htmlStr, { basePath = '', langs = [], siteUrl = '' } = {}) {
  const s = String(htmlStr);
  if (!s.includes('/files/')) return s;
  const bp = basePath.replace(/\/$/, '');
  const langAlt = langs.map((l) => (typeof l === 'string' ? `/${l}` : l.path)).filter(Boolean).map(escRe).join('|');
  const langGrp = langAlt ? `(?:${langAlt})?` : '';
  let out = s.replace(new RegExp(`(=\\s*["'])(?:${escRe(bp)})?${langGrp}/files/`, 'g'), `$1${bp}/files/`);
  if (siteUrl && langAlt) out = out.replace(new RegExp(`${escRe(siteUrl.replace(/\/$/, '') + bp)}(?:${langAlt})/files/`, 'g'), `${siteUrl.replace(/\/$/, '')}${bp}/files/`);
  return out;
}
