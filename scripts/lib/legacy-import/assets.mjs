// 附件與內文圖片：複製到 {out}/content/assets/{draft-id}/、算 sha256／bytes／尺寸、PDF 文字層偵測、圖片 needsAlt。
// 判讀函式全部沿用 scripts/lib/assets.mjs（Y1），這裡只負責「匯出檔 → 資產宣告」。
import fs from 'node:fs';
import path from 'node:path';
import {
  inspectAsset, extOf, pdfHasTextLayer, suggestFileName, fileNameProblems, MIME_BY_EXT, IMAGE_EXT, DATA_EXT, SIZE_GROUP, DEFAULT_LIMITS, OWN_LICENSE,
} from '../assets.mjs';

const SNIFF_OK = { pdf: ['pdf'], png: ['png'], jpg: ['jpeg'], jpeg: ['jpeg'], webp: ['webp'], svg: ['svg'], docx: ['zip'], xlsx: ['zip'], odt: ['zip'] };

const decode = (s) => { try { return decodeURIComponent(s); } catch { return s; } };

/** 在匯出的 files/ 下找檔：精確 → 不分大小寫 → 只比檔名（忽略子目錄） */
export function findExportFile(filesDir, name) {
  if (!name || !fs.existsSync(filesDir)) return null;
  const want = decode(String(name)).replace(/^\/+/, '');
  const direct = path.join(filesDir, want);
  if (path.resolve(direct).startsWith(path.resolve(filesDir) + path.sep) && fs.existsSync(direct) && fs.statSync(direct).isFile()) return direct;
  const base = path.basename(want).toLowerCase();
  const stack = [filesDir];
  while (stack.length) {
    const d = stack.pop();
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) stack.push(path.join(d, e.name));
      else if (e.name.toLowerCase() === base) return path.join(d, e.name);
    }
  }
  return null;
}

/** 一筆草稿的資產集合 */
export class AssetBag {
  constructor({ draftId, outDir, filesDir, fallbackStem = 'file' }) {
    this.draftId = draftId; this.outDir = outDir; this.filesDir = filesDir; this.fallbackStem = fallbackStem;
    this.assets = []; this.issues = []; this.bySrc = new Map(); this.used = new Set();
  }

  /** 正規化檔名（小寫英數連字號；全中文檔名無法音譯時用 stem-序號）並確保同筆內唯一 */
  uniqueName(original) {
    const ext = extOf(original);
    let name = fileNameProblems(original).length ? suggestFileName(original) : original;
    if (/^file-[0-9a-f]{6}\./.test(name) || !/[a-z]{2}/.test(name.replace(/\.[^.]+$/, ''))) name = `${this.fallbackStem}-${this.assets.length + 1}.${ext}`;
    let n = 2;
    const stem = name.replace(/\.[^.]+$/, '');
    while (this.used.has(name)) name = `${stem}-${n++}.${ext}`;
    this.used.add(name);
    return name;
  }

  /**
   * 加入一個檔案。opts：{ src(匯出內名稱或路徑), as: 'attachment'|'image', label, alt, title, pageKey }
   * 回傳 { ok, asset?, file?, renamed?, issues[] }（缺檔 ok:false）
   */
  add({ src, as = 'attachment', label, alt = '', title = '', pageKey = '' }) {
    const key = `${as}:${decode(src)}`;
    if (this.bySrc.has(key)) return { ok: true, ...this.bySrc.get(key), reused: true, issues: [] };
    const issues = [];
    const found = findExportFile(this.filesDir, src);
    const original = path.basename(decode(String(src)));
    if (!found) {
      issues.push({ code: as === 'image' ? 'image-missing' : 'attachment-missing', severity: 'error', message: `${as === 'image' ? '圖片' : '附件'}「${original}」在匯出的 files/ 找不到` });
      return { ok: false, issues };
    }
    const ext = extOf(original);
    if (!MIME_BY_EXT[ext]) {
      issues.push({ code: 'asset-ext-not-allowed', severity: 'error', message: `「${original}」副檔名 .${ext} 不在允許清單，未轉入` });
      return { ok: false, issues };
    }
    const buf = fs.readFileSync(found);
    const info = inspectAsset(buf, ext);
    const group = SIZE_GROUP[ext];
    const max = DEFAULT_LIMITS.maxBytes[group];
    if (max && buf.length > max) {
      issues.push({ code: 'asset-too-large', severity: 'error', message: `「${original}」${(buf.length / 1024 / 1024).toFixed(1)} MB 超過 ${group} 上限 ${(max / 1024 / 1024).toFixed(0)} MB，未轉入` });
      return { ok: false, issues };
    }
    if (SNIFF_OK[ext] && !SNIFF_OK[ext].includes(info.sniffed)) {
      issues.push({ code: 'asset-type-mismatch', severity: 'warn', message: `「${original}」副檔名 .${ext} 但內容判讀為 ${info.sniffed}` });
    }
    const file = this.uniqueName(original);
    const renamed = file !== original;
    if (renamed) issues.push({ code: 'file-renamed', severity: 'info', message: `檔名「${original}」不合規則，改為 ${file}` });
    const dir = path.join(this.outDir, 'content/assets', this.draftId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, file), buf);

    const a = { file, kind: as === 'image' ? 'image' : DATA_EXT.has(ext) ? 'data' : 'attachment' };
    if (a.kind === 'image') {
      const altText = String(alt ?? '').trim();
      const fallback = altText || String(title ?? '').trim() || file.replace(/\.[^.]+$/, '');
      a.alt = fallback.slice(0, 150);
      a.license = OWN_LICENSE;
      a.needsAlt = !altText;
      a.mime = info.mime; a.bytes = info.bytes; a.sha256 = info.sha256;
      if (info.width) { a.width = info.width; a.height = info.height; }
      if (a.needsAlt) issues.push({ code: 'image-no-alt', severity: 'warn', message: `圖片「${original}」舊頁沒有替代文字，暫用${title ? '圖片標題' : '檔名'}「${a.alt}」，請補 alt（needsAlt）` });
      issues.push({ code: 'image-license-assumed', severity: 'info', message: `圖片「${original}」授權暫填 ${OWN_LICENSE}（假設為本署自製素材），請確認來源；非本署素材須補 source` });
    } else {
      a.label = String(label ?? '').trim() || original.replace(/\.[^.]+$/, '');
      a.mime = info.mime; a.bytes = info.bytes; a.sha256 = info.sha256;
      if (ext === 'pdf') {
        a.machineReadable = pdfHasTextLayer(buf);
        a.accessibleAlt = null;
        if (!a.machineReadable) issues.push({ code: 'pdf-no-text-layer', severity: 'warn', message: `PDF「${original}」沒有文字層（掃描檔），上架前須附同名 .md／.docx 可及性版本，或重做有文字層的 PDF` });
      } else a.machineReadable = true;
    }
    this.assets.push(a);
    const res = { file, asset: a, renamed };
    this.bySrc.set(key, res);
    for (const i of issues) this.issues.push(i);
    return { ok: true, ...res, issues };
  }

  summary() {
    const by = { attachment: 0, image: 0, data: 0 };
    for (const a of this.assets) by[a.kind]++;
    return { total: this.assets.length, ...by, needsAlt: this.assets.filter((a) => a.needsAlt).length, noTextLayer: this.assets.filter((a) => a.machineReadable === false).length };
  }
}
