// /admin/publish/ 的「附件與圖片」面板（第八輪 Y2，ARCHITECTURE §16.2）。
// 檔案只存在記憶體（File 物件）：不上傳、不進 localStorage；localStorage 只留 metadata，重新整理後會提示重新選檔。
// 純規則（檔名正規化、限制、預檢、assets JSON）在 preprocess.js，這裡負責 DOM、讀檔、Web Crypto、SVG 掃描、圖片寬高。
import { $, $$, esc } from './common.js';
import * as P from './preprocess.js';

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
/** SHA-256（Web Crypto）；不可用（非安全來源）時回傳空字串，預檢會提示。 */
export async function sha256Hex(blobOrBytes) {
  try {
    const buf = blobOrBytes instanceof Uint8Array ? blobOrBytes : await blobOrBytes.arrayBuffer();
    return hex(await crypto.subtle.digest('SHA-256', buf));
  } catch { return ''; }
}
/** SVG 內容掃描：<script>、on*= 事件屬性、javascript: 網址、foreignObject 一律拒收。回傳原因或空字串。 */
export function scanSvg(text) {
  const t = String(text);
  if (/<\s*script/i.test(t)) return 'SVG 內含 <script>';
  if (/[\s"'/]on[a-z]+\s*=/i.test(t)) return 'SVG 內含事件屬性（on…=）';
  if (/javascript\s*:/i.test(t)) return 'SVG 內含 javascript: 網址';
  if (/<\s*foreignObject/i.test(t)) return 'SVG 內含 foreignObject';
  return '';
}
/** 檔頭簽章與副檔名是否相符（只檢查有固定簽章的格式）。回傳錯誤說明或空字串。 */
export function sniffMismatch(ext, head) {
  const b = head;
  const at = (i, s) => [...s].every((c, k) => b[i + k] === c.charCodeAt(0));
  const is = {
    pdf: at(0, '%PDF'),
    png: b[0] === 0x89 && at(1, 'PNG'),
    jpg: b[0] === 0xff && b[1] === 0xd8, jpeg: b[0] === 0xff && b[1] === 0xd8,
    webp: at(0, 'RIFF') && at(8, 'WEBP'),
    xlsx: at(0, 'PK'), docx: at(0, 'PK'), odt: at(0, 'PK'),
  }[ext];
  return is === false ? `內容不是有效的 .${ext} 檔（檔頭簽章不符）` : '';
}
/** 讀 SVG 的 width／height（數字）或 viewBox */
export function svgSize(text) {
  const m = /<svg\b[^>]*>/i.exec(text)?.[0] ?? '';
  const num = (n) => { const v = new RegExp(`\\s${n}\\s*=\\s*["']?\\s*([\\d.]+)\\s*(?:px)?\\s*["']`, 'i').exec(m); return v ? Math.round(Number(v[1])) : 0; };
  let w = num('width'), h = num('height');
  const vb = /viewBox\s*=\s*["']\s*[-\d.]+[ ,]+[-\d.]+[ ,]+([\d.]+)[ ,]+([\d.]+)/i.exec(m);
  if ((!w || !h) && vb) { w = Math.round(Number(vb[1])); h = Math.round(Number(vb[2])); }
  return w && h ? { width: w, height: h } : {};
}
function imageSize(url) {
  return new Promise((resolve) => {
    const im = new Image();
    im.onload = () => resolve(im.naturalWidth && im.naturalHeight ? { width: im.naturalWidth, height: im.naturalHeight } : {});
    im.onerror = () => resolve({});
    im.src = url;
  });
}

const KIND_LABEL = Object.fromEntries(P.ASSET_KINDS);
const TYPE_BADGE = { pdf: 'PDF', png: 'PNG', jpg: 'JPG', jpeg: 'JPG', webp: 'WEBP', svg: 'SVG', csv: 'CSV', json: 'JSON', xlsx: 'XLSX', docx: 'DOCX', odt: 'ODT', md: 'MD', ics: 'ICS' };

/**
 * opts: {
 *   root, limits, licenses[], getContentId(), getBody(),
 *   onChange({structural}), insertImage({path,alt,blobUrl}), renameRefs(from,to), announce(msg)
 * }
 */
export function initAssets(opts) {
  const root = opts.root;
  const limits = P.normalizeLimits(opts.limits);
  const list = $('#as-list', root);
  const msgEl = $('#as-msg', root);
  const input = $('#as-input', root);
  const drop = $('#as-drop', root);
  const summary = $('#as-summary', root);
  let items = []; // 見下方 makeItem
  let uidN = 0;
  let pendingRemove = null;
  const say = (m) => { msgEl.textContent = m; };
  const id = () => opts.getContentId?.() ?? '';
  const pathOf = (a) => `/files/${id()}/${a.file}`;
  const changed = (structural = false) => { paint(structural); opts.onChange?.({ structural }); };

  // ---------- 匯出／還原 ----------
  const toRaw = (a) => ({ file: a.file, kind: a.kind, label: a.label, alt: a.alt, mime: a.mime, bytes: a.bytes, sha256: a.sha256, machineReadable: a.machineReadable, accessibleAlt: a.accessibleAlt, license: a.license, source: a.source, width: a.width, height: a.height });
  const meta = () => items.map((a) => ({ origName: a.origName, ...toRaw(a) }));
  const restore = (arr) => {
    items.forEach((a) => a.blobUrl && URL.revokeObjectURL(a.blobUrl));
    items = (arr ?? []).filter((m) => m && m.file).map((m) => makeItem({ ...m, origName: m.origName ?? m.file }, null));
    paint(true);
  };
  function makeItem(m, file) {
    return {
      uid: `a${++uidN}`, origName: m.origName ?? m.file, file: m.file, kind: m.kind ?? P.assetKindFor(m.file), label: m.label ?? '', alt: m.alt ?? '',
      machineReadable: m.machineReadable ?? true, accessibleAlt: m.accessibleAlt ?? '', license: m.license ?? '', source: m.source ?? '',
      mime: m.mime ?? P.assetMimeFor(m.file), bytes: m.bytes, sha256: m.sha256 ?? '', width: m.width, height: m.height,
      blob: file, blobUrl: file && P.assetKindFor(m.file) === 'image' ? URL.createObjectURL(file) : '', missing: !file, notes: m.notes ?? [],
    };
  }
  const issuesObj = () => ({ id: id(), bodyMarkdown: opts.getBody?.() ?? '', assets: items.map((a) => ({ ...P.buildAssetsJson([a])[0], missing: a.missing })) });
  /** 供 publish.js 組 content JSON（含尚需重選檔案者的 metadata） */
  const exportList = () => items.map(toRaw);

  // ---------- 加檔 ----------
  async function addFiles(fileList) {
    const files = [...fileList];
    const rejected = [];
    let added = 0;
    const insertedImages = [];
    for (const f of files) {
      const norm = P.normalizeAssetName(f.name, items.map((a) => a.file));
      const ext = P.assetExt(norm.name);
      // 還原草稿後的待重選項目：同名就補上檔案
      const hole = items.find((a) => a.missing && (a.file === norm.name || a.origName === f.name || a.file === P.normalizeAssetName(f.name).name));
      if (!hole && items.length >= limits.maxFiles) { rejected.push(`${f.name}：已達每筆內容 ${limits.maxFiles} 個檔案的上限`); continue; }
      if (!limits.extensions.includes(ext)) { rejected.push(`${f.name}：不允許的副檔名 .${ext || '（無）'}（允許：${limits.extensions.join('、')}）`); continue; }
      let head;
      try { head = new Uint8Array(await f.slice(0, 16).arrayBuffer()); } catch { rejected.push(`${f.name}：無法讀取檔案`); continue; }
      const mm = sniffMismatch(ext, head);
      if (mm) { rejected.push(`${f.name}：${mm}`); continue; }
      let svgText = '';
      if (ext === 'svg') {
        svgText = await f.text();
        const why = scanSvg(svgText);
        if (why) { rejected.push(`${f.name}：${why}，已拒收（請用圖片編輯軟體重新匯出乾淨的 SVG）`); continue; }
      }
      const sha = await sha256Hex(f);
      const kind = hole ? hole.kind : P.assetKindFor(norm.name);
      const base = {
        origName: f.name, file: hole ? hole.file : norm.name, kind, mime: P.assetMimeFor(norm.name), bytes: f.size, sha256: sha,
        label: hole ? hole.label : f.name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' '), notes: hole ? [] : norm.notes,
      };
      let item;
      if (hole) { // 補檔：保留使用者填過的欄位，只更新檔案相關欄位
        if (hole.blobUrl) URL.revokeObjectURL(hole.blobUrl);
        Object.assign(hole, { origName: f.name, mime: base.mime, bytes: f.size, sha256: sha, blob: f, missing: false, blobUrl: kind === 'image' ? URL.createObjectURL(f) : '' });
        item = hole;
      } else {
        item = makeItem({ ...base, machineReadable: true }, f);
        items.push(item);
      }
      if (kind === 'image') {
        const dim = ext === 'svg' ? svgSize(svgText) : await imageSize(item.blobUrl);
        item.width = dim.width; item.height = dim.height;
        if (!hole) insertedImages.push(item);
      }
      added++;
    }
    const parts = [];
    if (added) parts.push(`已加入 ${added} 個檔案`);
    if (rejected.length) parts.push(`${rejected.length} 個被拒收：${rejected.join('；')}`);
    say(parts.join('。') || '沒有加入任何檔案');
    changed(true);
    return { added, rejected, images: insertedImages };
  }
  /** 從工具列「從電腦選圖片…」進來：加入後直接插入內文 */
  let insertAfterAdd = false;
  async function onPicked(files) {
    const r = await addFiles(files);
    if (insertAfterAdd) {
      insertAfterAdd = false;
      for (const im of r.images) insertImg(im);
    }
  }
  function insertImg(a) {
    if (!id()) { say('請先填寫「內容 ID」（頁面下方），圖片路徑會用到它。'); return; }
    opts.insertImage?.({ path: pathOf(a), alt: a.alt, blobUrl: a.blobUrl });
    if (!a.alt.trim()) say(`已插入 ${a.file}，但還沒填替代文字（alt）——圖片必填。`);
    paint();
  }

  // ---------- 畫面 ----------
  function issueMap() {
    const m = new Map();
    for (const i of P.assetIssues(issuesObj(), limits)) { const k = i.file ?? ''; if (!m.has(k)) m.set(k, []); m.get(k).push(i); }
    return m;
  }
  const field = (a, key, label, inner, extra = '') => `<div class="adm-field ${extra}"><label for="as-${a.uid}-${key}">${label}</label>${inner}</div>`;
  function rowHtml(a, issues) {
    const ext = P.assetExt(a.file);
    const isImg = a.kind === 'image';
    const isPdf = ext === 'pdf' && a.kind === 'attachment';
    const refCount = P.bodyFileRefs(opts.getBody?.() ?? '').filter((r) => r.id === id() && r.file === a.file).length;
    const sizeTxt = typeof a.bytes === 'number' ? P.fmtBytes(a.bytes) : '—';
    const lim = P.assetLimitFor(a.kind, limits);
    const thumb = isImg && a.blobUrl ? `<img src="${esc(a.blobUrl)}" alt="">` : `<span>${esc(TYPE_BADGE[ext] ?? ext.toUpperCase())}</span>`;
    const altOptions = items.filter((x) => x !== a && /\.(md|docx|odt)$/.test(x.file)).map((x) => `<option value="${esc(x.file)}" ${a.accessibleAlt === x.file ? 'selected' : ''}>${esc(x.file)}</option>`).join('');
    const errs = issues.filter((i) => i.level === 'error'), warns = issues.filter((i) => i.level === 'warn');
    const warnPending = pendingRemove === a.uid;
    return `<li class="adm-asset${errs.length ? ' adm-asset--err' : ''}" data-uid="${a.uid}" aria-label="${esc(a.file)}">
  <div class="adm-asset__head">
    <span class="adm-asset__thumb" aria-hidden="true">${thumb}</span>
    <div class="adm-asset__title"><strong>${esc(a.file)}</strong>
      <span class="adm-muted">${esc(KIND_LABEL[a.kind] ?? a.kind)} · ${esc(a.mime || '—')} · ${esc(sizeTxt)}（上限 ${esc(P.fmtBytes(lim))}）${a.width ? ` · ${a.width}×${a.height}` : ''}</span>
      <span class="adm-muted adm-asset__hash">sha256 ${a.sha256 ? `<code>${esc(a.sha256.slice(0, 16))}…</code>` : '（無）'}</span>
      ${a.missing ? '<span class="adm-badge adm-badge--warn">需重新選取檔案</span>' : ''}</div>
    <div class="adm-asset__acts">
      ${isImg && !a.missing ? `<button type="button" class="adm-btn adm-btn--sm" data-act="insert">插入圖片到內文</button>` : ''}
      <button type="button" class="adm-btn adm-btn--ghost adm-btn--sm" data-act="remove" aria-label="移除 ${esc(a.file)}">${warnPending ? '確認移除' : '移除'}</button>
    </div>
  </div>
  ${warnPending ? `<div class="adm-box adm-box--warn" role="alert"><strong>內文仍引用這個檔案（${refCount} 處）</strong>移除後內文的圖片或連結會失效（建置時會失敗）。再按一次「確認移除」才會移除。<button type="button" class="adm-btn adm-btn--ghost adm-btn--sm" data-act="cancel-remove">取消</button></div>` : ''}
  ${a.missing ? `<div class="adm-box adm-box--info">瀏覽器不保存檔案內容。請把原檔再拖進來（檔名相同會自動接回這一列）。</div>` : ''}
  <div class="adm-grid adm-grid--2 adm-asset__fields">
    ${field(a, 'file', '檔名（小寫英數、連字號、底線、點）', `<input type="text" id="as-${a.uid}-file" data-f="file" value="${esc(a.file)}" spellcheck="false" autocomplete="off">`)}
    ${field(a, 'kind', '種類', `<select id="as-${a.uid}-kind" data-f="kind">${P.ASSET_KINDS.map(([v, l]) => `<option value="${v}" ${a.kind === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`)}
    ${isImg
    ? field(a, 'alt', '替代文字 alt<span class="adm-req"> · 必填（≤ 150 字）</span>', `<input type="text" id="as-${a.uid}-alt" data-f="alt" value="${esc(a.alt)}" maxlength="150" aria-required="true" placeholder="描述圖片內容，給看不到圖的人">`, 'adm-field--wide')
    : field(a, 'label', '顯示名稱 label<span class="adm-req"> · 必填</span>', `<input type="text" id="as-${a.uid}-label" data-f="label" value="${esc(a.label)}" aria-required="true" placeholder="例：新聞稿全文（PDF）">`, 'adm-field--wide')}
    ${isImg ? `${field(a, 'license', '授權 license<span class="adm-req"> · 必填</span>', `<input type="text" id="as-${a.uid}-license" data-f="license" list="as-licenses" value="${esc(a.license)}" aria-required="true" placeholder="例：OGDL-1.0">`)}
    ${field(a, 'source', '來源 source（非本署素材必填）', `<input type="text" id="as-${a.uid}-source" data-f="source" value="${esc(a.source)}" placeholder="例：示意圖，本署自製">`)}
    ${field(a, 'label', '顯示名稱 label（選填）', `<input type="text" id="as-${a.uid}-label" data-f="label" value="${esc(a.label)}">`, 'adm-field--wide')}` : ''}
    ${a.kind === 'attachment' ? `<div class="adm-field adm-field--wide"><label class="adm-check"><input type="checkbox" id="as-${a.uid}-mr" data-f="machineReadable" ${a.machineReadable ? 'checked' : ''}> 這個檔案是機器可讀的${isPdf ? '（PDF 有文字層）' : ''}</label>
      ${isPdf ? `<span class="adm-hint">請確認 PDF 有文字層：在 PDF 閱讀器裡能選取、複製文字，就是有；掃描影像沒有。瀏覽器無法判斷，所以由你勾選。${a.machineReadable ? '' : '沒有文字層時請另附 .md／.docx／.odt 替代版。'}</span>` : ''}</div>
      ${isPdf && !a.machineReadable ? field(a, 'alt2', '無障礙替代檔（同內容的 .md／.docx／.odt）', `<select id="as-${a.uid}-alt2" data-f="accessibleAlt"><option value="">（沒有）</option>${altOptions}</select>`, 'adm-field--wide') : ''}` : ''}
  </div>
  ${a.notes?.length ? `<p class="adm-hint adm-asset__notes">${a.notes.map(esc).join('；')}。</p>` : ''}
  <ul class="adm-asset__issues" role="list" data-issues>${issuesHtml(errs, warns)}</ul>
</li>`;
  }
  const issuesHtml = (errs, warns) => [...errs.map((i) => `<li class="adm-red">${esc(i.msg)}</li>`), ...warns.map((i) => `<li class="adm-yellow">${esc(i.msg)}</li>`)].join('');
  function paint(structural = true) {
    const all = issueMap();
    const total = [...all.values()].flat();
    const nErr = total.filter((i) => i.level === 'error').length, nWarn = total.filter((i) => i.level === 'warn').length;
    const global = (all.get('') ?? []).map((i) => `<li class="${i.level === 'error' ? 'adm-red' : 'adm-yellow'}">${esc(i.msg)}</li>`).join('');
    summary.innerHTML = items.length
      ? `共 ${items.length} 個檔案（上限 ${limits.maxFiles}）· ${nErr ? `<span class="adm-red">${nErr} 項需修正</span>` : '<span class="adm-green">必填欄位已齊</span>'}${nWarn ? ` · <span class="adm-yellow">${nWarn} 項建議</span>` : ''}`
      : '尚未加入任何檔案。';
    $('#as-global', root).innerHTML = global;
    if (structural) {
      list.innerHTML = items.map((a) => rowHtml(a, all.get(a.file) ?? [])).join('');
    } else {
      for (const li of $$('li[data-uid]', list)) {
        const a = items.find((x) => x.uid === li.dataset.uid); if (!a) continue;
        const is = all.get(a.file) ?? [];
        $('[data-issues]', li).innerHTML = issuesHtml(is.filter((i) => i.level === 'error'), is.filter((i) => i.level === 'warn'));
        li.classList.toggle('adm-asset--err', is.some((i) => i.level === 'error'));
      }
    }
  }

  // ---------- 事件 ----------
  const itemOf = (el) => items.find((a) => a.uid === el.closest('li[data-uid]')?.dataset.uid);
  list.addEventListener('input', (e) => {
    const a = itemOf(e.target); const f = e.target.dataset.f; if (!a || !f || f === 'file' || f === 'kind' || f === 'machineReadable' || f === 'accessibleAlt') return;
    a[f] = e.target.value;
    changed(false);
  });
  list.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('input[type="text"]')) { e.preventDefault(); e.target.blur(); } });
  list.addEventListener('change', (e) => {
    const a = itemOf(e.target); const f = e.target.dataset.f; if (!a || !f) return;
    if (f === 'file') {
      const old = a.file;
      const n = P.normalizeAssetName(e.target.value, items.filter((x) => x !== a).map((x) => x.file));
      if (n.name !== old) {
        const ext0 = P.assetExt(old), ext1 = P.assetExt(n.name);
        a.file = n.name; a.notes = n.notes;
        if (ext0 !== ext1) { a.mime = P.assetMimeFor(n.name); }
        const body = opts.getBody?.() ?? '';
        if (P.bodyFileRefs(body).some((r) => r.id === id() && r.file === old)) opts.renameRefs?.(`/files/${id()}/${old}`, `/files/${id()}/${a.file}`);
        say(`檔名改為 ${a.file}${n.notes.length ? `：${n.notes.join('；')}` : ''}`);
      }
      changed(true);
    } else if (f === 'kind') {
      a.kind = e.target.value;
      changed(true);
    } else if (f === 'machineReadable') { a.machineReadable = e.target.checked; changed(true); }
    else if (f === 'accessibleAlt') { a.accessibleAlt = e.target.value; changed(false); }
  });
  list.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]'); if (!b) return;
    const a = itemOf(b); if (!a) return;
    if (b.dataset.act === 'insert') insertImg(a);
    else if (b.dataset.act === 'cancel-remove') { pendingRemove = null; changed(true); }
    else if (b.dataset.act === 'remove') {
      const refs = P.bodyFileRefs(opts.getBody?.() ?? '').filter((r) => r.id === id() && r.file === a.file).length;
      if (refs && pendingRemove !== a.uid) { pendingRemove = a.uid; paint(true); $(`li[data-uid="${a.uid}"] [data-act="remove"]`, list)?.focus(); say(`內文仍引用 ${a.file}（${refs} 處），再按一次「確認移除」才會移除。`); return; }
      if (a.blobUrl) URL.revokeObjectURL(a.blobUrl);
      items = items.filter((x) => x !== a); pendingRemove = null;
      say(`已移除 ${a.file}${refs ? '；內文的引用請一併處理' : ''}`);
      changed(true);
      $('#as-pick', root).focus();
    }
  });
  $('#as-pick', root).addEventListener('click', () => { insertAfterAdd = false; input.click(); });
  input.addEventListener('change', async () => { const fs = [...input.files]; input.value = ''; if (fs.length) await onPicked(fs); });
  ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('is-over'); }));
  ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('is-over'); }));
  drop.addEventListener('drop', (e) => { if (e.dataTransfer?.files?.length) onPicked([...e.dataTransfer.files]); });
  // 拖到頁面其他地方不要讓瀏覽器直接開檔
  window.addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); });
  window.addEventListener('drop', (e) => { if (e.dataTransfer?.types?.includes('Files') && !e.defaultPrevented) e.preventDefault(); });

  paint(true);
  return {
    limits,
    items: () => items,
    meta, restore, exportList,
    count: () => items.length,
    clear() { items.forEach((a) => a.blobUrl && URL.revokeObjectURL(a.blobUrl)); items = []; paint(true); },
    addFiles: onPicked,
    /** 工具列「從電腦選圖片…」：選完直接插入內文 */
    requestImage() { insertAfterAdd = true; input.click(); },
    /** 內文路徑 /files/{id}/{file} → blob URL（供預覽與所見即所得顯示尚未進 repo 的圖） */
    resolveImg(path) {
      const m = /^\/files\/([^/]+)\/(.+)$/.exec(path); if (!m) return null;
      const a = items.find((x) => x.file === decodeURIComponent(m[2]) && x.blobUrl);
      return a && decodeURIComponent(m[1]) === id() ? a.blobUrl : null;
    },
    images: () => items.filter((a) => a.kind === 'image').map((a) => ({ file: a.file, alt: a.alt, path: pathOf(a), blobUrl: a.blobUrl })),
    /** 有 metadata 但沒有檔案內容的項目（無法放進 ZIP） */
    missingFiles: () => items.filter((a) => a.missing).map((a) => a.file),
    /** 取檔案位元組放進 ZIP */
    async bytesOf(a) { return new Uint8Array(await a.blob.arrayBuffer()); },
    repaint: () => paint(true),
    refreshIssues: () => paint(false),
  };
}
