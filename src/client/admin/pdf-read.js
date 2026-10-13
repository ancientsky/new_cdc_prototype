// 第四十五輪：在瀏覽器裡讀 PDF（pdf.js，/vendor/pdfjs/，用到才載入）：抽每頁文字層字塊與內嵌圖片。
// 只做「跟 pdf.js 講話」這一層；排版成稿件文字、配圖說都在 pdf-manuscript.js（純函式，有測試）。
// 為什麼在瀏覽器做：原型放在 GitHub Pages 沒有伺服器；正式站若有後端，同樣的純函式可以改吃 pdftotext 的輸出（docs/bulletin.md §14）。
import { url } from './common.js';

let lib = null;
/** 載入 pdf.js（一次）。失敗回 null（例如 vendor 檔沒部署），呼叫端退回「請自己貼文字」 */
export async function loadPdfjs() {
  if (lib) return lib;
  try {
    // 檔名用 .js 不用 .mjs：IIS 等伺服器預設不認 .mjs（回 404 或 octet-stream，瀏覽器就拒絕當模組載入）
    const m = await import(url('/vendor/pdfjs/pdf.min.js'));
    m.GlobalWorkerOptions.workerSrc = url('/vendor/pdfjs/pdf.worker.min.js');
    lib = m;
    return lib;
  } catch { return null; }
}

/** 簡單指紋：寬高＋抽樣 64 個像素值（判斷同一張圖是否重複出現） */
function fingerprintOf(ctx, width, height) {
  try {
    const step = Math.max(1, Math.floor(Math.min(width, height) / 8));
    const parts = [];
    for (let y = 0; y < height && parts.length < 64; y += step) for (let x = 0; x < width && parts.length < 64; x += step) { const d = ctx.getImageData(x, y, 1, 1).data; parts.push((d[0] >> 5) * 64 + (d[1] >> 5) * 8 + (d[2] >> 5)); }
    return parts.join(',');
  } catch { return ''; }
}

/** pdf.js 圖片物件（{ bitmap } 或 { data, width, height, kind }）→ canvas */
function toCanvas(img) {
  const canvas = document.createElement('canvas');
  const width = img.width ?? img.bitmap?.width, height = img.height ?? img.bitmap?.height;
  if (!width || !height) return null;
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (img.bitmap) { ctx.drawImage(img.bitmap, 0, 0); return canvas; }
  if (!img.data) return null;
  const out = ctx.createImageData(width, height);
  const src = img.data;
  const n = width * height;
  if (img.kind === 1) { // 灰階 1 bpc（每像素一個 bit）
    for (let i = 0; i < n; i++) { const bit = (src[i >> 3] >> (7 - (i & 7))) & 1; const v = bit ? 255 : 0; out.data[i * 4] = v; out.data[i * 4 + 1] = v; out.data[i * 4 + 2] = v; out.data[i * 4 + 3] = 255; }
  } else if (img.kind === 2) { // RGB 24 bpp
    for (let i = 0; i < n; i++) { out.data[i * 4] = src[i * 3]; out.data[i * 4 + 1] = src[i * 3 + 1]; out.data[i * 4 + 2] = src[i * 3 + 2]; out.data[i * 4 + 3] = 255; }
  } else if (src.length === n * 4) out.data.set(src);
  else return null;
  ctx.putImageData(out, 0, 0);
  return canvas;
}
/** pdf.js 物件表：已解好直接拿；還沒解好就用回呼等（逾時回 null） */
function objOf(objs, name, ms = 8000) {
  if (!objs) return Promise.resolve(null);
  try { if (objs.has(name)) return Promise.resolve(objs.get(name)); } catch { /* 還沒解好 */ }
  return new Promise((res) => { let done = false; const t = setTimeout(() => { if (!done) { done = true; res(null); } }, ms); try { objs.get(name, (o) => { if (!done) { done = true; clearTimeout(t); res(o); } }); } catch { clearTimeout(t); done = true; res(null); } });
}
const toPngBlob = (canvas) => new Promise((res) => canvas.toBlob((b) => res(b), 'image/png'));

/**
 * 讀一份 PDF → { pages:[{ items:[{str,x,y,w,h,size}], width, height }], images:[{ key, page, order, width, height, fingerprint, blob }] }
 * y 已換成「從頁面上緣往下」，給 pdf-manuscript.js 的 linesFromItems 用。
 * @param {Uint8Array} bytes
 * @param {{ maxPages?: number, onProgress?: (done:number, total:number) => void }} [opts]
 */
export async function extractPdf(bytes, { maxPages = 60, onProgress = () => {} } = {}) {
  const pdfjs = await loadPdfjs();
  if (!pdfjs) throw new Error('pdfjs-unavailable');
  // 複製一份再交給 pdf.js：它會把 ArrayBuffer 轉移（transfer）給 worker，原本的 bytes 會變成空的，之後就沒辦法再當附件上傳
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, disableFontFace: true });
  const doc = await task.promise;
  const pages = [];
  const images = [];
  const total = Math.min(doc.numPages, maxPages);
  for (let n = 1; n <= total; n++) {
    const page = await doc.getPage(n);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const items = [];
    for (const t of tc.items) {
      if (!('str' in t)) continue;
      const [a, b, , d, e, f] = t.transform;
      if (Math.abs(b) > Math.abs(a)) continue; // 直排的字（頁緣的側標「疫情描述」）會黏進同一基線的橫排行，略過
      const size = Math.hypot(a, b) || Math.abs(d) || t.height || 10;
      items.push({ str: t.str, x: e, y: vp.height - f, w: t.width, h: t.height || size, size });
    }
    pages.push({ items, width: vp.width, height: vp.height });
    // 圖片：operator list 裡的 paintImageXObject／paintInlineImageXObject
    try {
      const ops = await page.getOperatorList();
      let order = 0;
      for (let i = 0; i < ops.fnArray.length; i++) {
        const fn = ops.fnArray[i];
        let img = null;
        if (fn === pdfjs.OPS.paintImageXObject) {
          const name = ops.argsArray[i][0];
          // objs.get(name) 在圖還沒解碼完時會丟錯（has() 回 false）；用回呼版等它解完，最多等 8 秒
          img = await objOf(page.objs, name) ?? await objOf(page.commonObjs, name);
        } else if (fn === pdfjs.OPS.paintInlineImageXObject) img = ops.argsArray[i][0];
        if (!img) continue;
        const canvas = toCanvas(img);
        if (!canvas) continue;
        const blob = await toPngBlob(canvas);
        if (!blob) continue;
        const fp = fingerprintOf(canvas.getContext('2d'), canvas.width, canvas.height);
        images.push({ key: `p${n}-${order}`, page: n, order: order++, width: canvas.width, height: canvas.height, fingerprint: fp, blob });
      }
    } catch { /* 圖抽不出來不影響文字 */ }
    page.cleanup?.();
    onProgress(n, total);
  }
  await task.destroy();
  return { pages, images, numPages: doc.numPages ?? total };
}
