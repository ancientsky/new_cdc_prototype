// /admin/publish/ 內文編輯器：所見即所得／Markdown／預覽 三頁籤，共用同一份資料（#f-body textarea 的 Markdown）。
//   所見即所得：contenteditable＋工具列（document.execCommand）；每次編輯用 md-convert.htmlToMd 寫回 textarea。
//   Markdown：既有 textarea。預覽：md-convert.mdToHtml（vendor 的 marked＋白名單淨化）＋站上 c-prose 樣式。
// 切換頁籤時只有「在所見即所得裡真的編輯過」才會把 textarea 改寫成轉換後的 Markdown，單純切過去看不會動到原文。
import { $, $$, store, url as siteUrl } from './common.js';
import { htmlToMd, mdToHtml, plainTextToHtml, safeUrl } from './md-convert.js';

const TAB_KEY = 'cdc.admin.editorTab';
const MODES = ['wys', 'md', 'prev'];
const TABLE_HTML = `<table><thead><tr><th>欄位一</th><th>欄位二</th><th>欄位三</th></tr></thead><tbody>${'<tr><td><br></td><td><br></td><td><br></td></tr>'.repeat(2)}</tbody></table><p><br></p>`;

/**
 * opts: { textarea, resolveImg(path)→blobUrl|null, getImages()→[{file,alt,path,blobUrl}], requestImage(), onFiles(FileList), onChange(), announce(msg) }
 */
export function initEditor(opts) {
  const ta = opts.textarea;
  const wys = $('#f-wys');
  const prev = $('#f-preview');
  const bar = $('#ed-toolbar');
  const linkBox = $('#ed-linkbox');
  const imgBox = $('#ed-imgbox');
  const tabs = Object.fromEntries(MODES.map((m) => [m, $(`#et-${m}`)]));
  const panels = Object.fromEntries(MODES.map((m) => [m, $(`#ep-${m}`)]));
  const notice = $('#ed-notice');
  let mode = 'wys';
  let dirty = false; // 所見即所得有尚未寫回 textarea 的編輯
  let stale = true; // textarea 比 wys 新（需要重畫 wys）
  let lastRange = null;
  let timer = 0;
  const getMarked = () => (typeof window !== 'undefined' ? window.marked : null);
  const say = (m) => { if (notice) notice.textContent = m; };

  const imgSrc = (src) => { const u = opts.resolveImg?.(src); return u ? { src: u, orig: src } : null; };
  const baseHref = (h) => (/^\/(?!\/)/.test(h) ? siteUrl(h) : h);

  // ---------- 渲染 ----------
  function renderWys() {
    wys.innerHTML = mdToHtml(ta.value, { marked: getMarked(), imgSrc }) || '<p><br></p>';
    stale = false; dirty = false;
  }
  function renderPreview() {
    const html = mdToHtml(ta.value, { marked: getMarked(), imgSrc, href: baseHref });
    prev.innerHTML = html || '<p class="adm-muted">（內文是空的）</p>';
    $$('a', prev).forEach((a) => { a.target = '_blank'; a.rel = 'noopener'; });
    // 檔案尚未選取的內文圖片：標示出來，免得以為壞掉
    $$('img', prev).forEach((im) => {
      const s = im.getAttribute('src') ?? '';
      if (/^\/files\//.test(s)) { im.alt = `${im.alt || '圖片'}（尚未選取檔案，上線後顯示）`; im.classList.add('adm-img-missing'); im.removeAttribute('src'); }
    });
  }
  /** 把所見即所得的內容寫回 textarea（Markdown），並通知表單 */
  function flush() {
    clearTimeout(timer);
    if (mode !== 'wys' || !dirty) return;
    dirty = false;
    const dropped = [];
    const md = htmlToMd(wys.innerHTML, { dropped });
    if (md !== ta.value) { ta.value = md; ta.dispatchEvent(new Event('input', { bubbles: true })); }
    if (dropped.length) say(dropped.join('；'));
  }
  const schedule = () => { dirty = true; clearTimeout(timer); timer = setTimeout(flush, 150); opts.onChange?.(); };

  // ---------- 頁籤 ----------
  function setMode(m, focus = false) {
    if (!MODES.includes(m)) m = 'wys';
    if (m !== mode) flush();
    mode = m;
    for (const k of MODES) {
      tabs[k].setAttribute('aria-selected', String(k === m));
      tabs[k].tabIndex = k === m ? 0 : -1;
      panels[k].hidden = k !== m;
    }
    if (m === 'wys') { if (stale || !wys.innerHTML.trim()) renderWys(); }
    if (m === 'prev') renderPreview();
    store.set(TAB_KEY, m);
    if (focus) (m === 'wys' ? wys : m === 'md' ? ta : prev).focus?.();
    hidePopovers();
  }
  MODES.forEach((m) => tabs[m].addEventListener('click', () => setMode(m, true)));
  $('[role="tablist"]', tabs.wys.closest('.adm-editor')).addEventListener('keydown', (e) => {
    const i = MODES.indexOf(mode);
    let j = -1;
    if (e.key === 'ArrowRight') j = (i + 1) % MODES.length; else if (e.key === 'ArrowLeft') j = (i + MODES.length - 1) % MODES.length;
    else if (e.key === 'Home') j = 0; else if (e.key === 'End') j = MODES.length - 1;
    if (j < 0) return;
    e.preventDefault(); setMode(MODES[j]); tabs[MODES[j]].focus();
  });

  // ---------- 選取範圍 ----------
  const inWys = (node) => node && wys.contains(node.nodeType === 1 ? node : node.parentNode);
  /** 記下編輯區內目前的選取（selectionchange 是非同步且會合併，焦點移走前要同步記一次） */
  function snapshot() {
    const s = document.getSelection();
    if (s && s.rangeCount && inWys(s.anchorNode)) { lastRange = s.getRangeAt(0).cloneRange(); return true; }
    return false;
  }
  document.addEventListener('selectionchange', () => { if (snapshot()) paintState(); });
  wys.addEventListener('focusout', snapshot);
  function restoreRange() {
    const s = document.getSelection();
    if (document.activeElement === wys && s.rangeCount && inWys(s.anchorNode)) return; // 已在編輯區內：沿用目前選取（selectionchange 是非同步的，lastRange 可能過時）
    wys.focus();
    if (lastRange && inWys(lastRange.startContainer)) { s.removeAllRanges(); s.addRange(lastRange); return; }
    const r = document.createRange(); r.selectNodeContents(wys); r.collapse(false); s.removeAllRanges(); s.addRange(r);
  }
  const ancestor = (sel) => { const s = document.getSelection(); let n = s?.anchorNode; if (!inWys(n)) return null; if (n.nodeType === 3) n = n.parentNode; return n.closest?.(sel) && wys.contains(n.closest(sel)) ? n.closest(sel) : null; };

  // ---------- 工具列 ----------
  const STATE = { bold: 'strong,b', italic: 'em,i', ul: 'ul', ol: 'ol', h2: 'h2', h3: 'h3', quote: 'blockquote' };
  function paintState() {
    if (mode !== 'wys') return;
    for (const [cmd, sel] of Object.entries(STATE)) { const b = $(`[data-cmd="${cmd}"]`, bar); if (b) b.setAttribute('aria-pressed', String(!!ancestor(sel))); }
  }
  function exec(cmd, val) {
    restoreRange();
    document.execCommand('styleWithCSS', false, false);
    document.execCommand(cmd, false, val);
    schedule(); paintState();
  }
  function block(tag) {
    restoreRange();
    const cur = ancestor(tag);
    document.execCommand('formatBlock', false, cur ? 'p' : tag);
    schedule(); paintState();
  }
  function insertHtml(html) { restoreRange(); document.execCommand('insertHTML', false, html); schedule(); }

  /** 表格：insertHTML 在 Chrome 會把 <table> 拆壞，改用 DOM 直接插在游標所在區塊後面（空段落則取代） */
  function insertTable() {
    restoreRange();
    const tpl = document.createElement('template');
    tpl.innerHTML = TABLE_HTML;
    const s = document.getSelection();
    let blk = s.anchorNode && inWys(s.anchorNode) ? (s.anchorNode.nodeType === 1 ? s.anchorNode : s.anchorNode.parentNode) : wys;
    while (blk && blk.parentNode !== wys && blk !== wys) blk = blk.parentNode;
    const frag = tpl.content;
    const firstCell = frag.querySelector('th');
    if (!blk || blk === wys) wys.appendChild(frag);
    else if (!blk.textContent.trim() && blk.tagName === 'P') blk.replaceWith(frag);
    else blk.after(frag);
    const r = document.createRange(); r.selectNodeContents(firstCell); s.removeAllRanges(); s.addRange(r);
    schedule();
  }
  const COMMANDS = {
    h2: () => block('h2'), h3: () => block('h3'),
    bold: () => exec('bold'), italic: () => exec('italic'),
    ul: () => exec('insertUnorderedList'), ol: () => exec('insertOrderedList'),
    link: () => openLink(), table: () => { insertTable(); say('已插入 3×3 表格（第一列為表頭）'); },
    image: () => openImages(), quote: () => block('blockquote'),
    hr: () => { exec('insertHorizontalRule'); },
    undo: () => exec('undo'),
  };
  bar.addEventListener('mousedown', (e) => { if (e.target.closest('button')) { snapshot(); e.preventDefault(); } }); // 不奪走選取
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-cmd]'); if (!b) return;
    hidePopovers(b.dataset.cmd === 'link' || b.dataset.cmd === 'image' ? b.dataset.cmd : '');
    COMMANDS[b.dataset.cmd]?.();
  });
  // 工具列方向鍵（roving tabindex）
  bar.addEventListener('keydown', (e) => {
    const btns = $$('button[data-cmd]', bar);
    const i = btns.indexOf(document.activeElement);
    if (i < 0 || !['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const j = e.key === 'Home' ? 0 : e.key === 'End' ? btns.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + btns.length) % btns.length;
    btns.forEach((b, k) => { b.tabIndex = k === j ? 0 : -1; }); btns[j].focus();
  });
  bar.addEventListener('focusin', (e) => { const b = e.target.closest('button[data-cmd]'); if (b) $$('button[data-cmd]', bar).forEach((x) => { x.tabIndex = x === b ? 0 : -1; }); });

  // ---------- 連結 ----------
  function hidePopovers(except = '') {
    if (except !== 'link') linkBox.hidden = true;
    if (except !== 'image') imgBox.hidden = true;
  }
  function openLink() {
    snapshot();
    restoreRange();
    const a = ancestor('a');
    const sel = document.getSelection();
    $('#ed-link-url').value = a?.getAttribute('href') ?? '';
    $('#ed-link-err').textContent = '';
    $('#ed-link-rm').hidden = !a;
    linkBox.dataset.collapsed = String(!a && sel.isCollapsed);
    linkBox.hidden = false;
    $('#ed-link-url').focus();
  }
  function applyLink() {
    let u = $('#ed-link-url').value.trim();
    if (u && !/^([a-z][a-z0-9+.-]*:|\/|#)/i.test(u)) u = `https://${u}`;
    const ok = safeUrl(u);
    if (!u || !ok) { $('#ed-link-err').textContent = '請輸入 http(s)://、mailto:、tel: 或站內路徑（/ 開頭）。'; $('#ed-link-url').focus(); return; }
    linkBox.hidden = true;
    restoreRange();
    const s = document.getSelection();
    if (s.isCollapsed && !ancestor('a')) {
      const esc = (x) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
      document.execCommand('insertHTML', false, `<a href="${esc(ok)}">${esc(ok)}</a>`);
    } else {
      document.execCommand('createLink', false, ok);
    }
    schedule(); wys.focus();
  }
  $('#ed-link-ok').addEventListener('click', applyLink);
  $('#ed-link-rm').addEventListener('click', () => { linkBox.hidden = true; restoreRange(); document.execCommand('unlink'); schedule(); });
  $('#ed-link-cancel').addEventListener('click', () => { linkBox.hidden = true; wys.focus(); });
  linkBox.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); applyLink(); } if (e.key === 'Escape') { e.preventDefault(); linkBox.hidden = true; restoreRange(); } });

  // ---------- 圖片 ----------
  function openImages() {
    snapshot();
    const list = opts.getImages?.() ?? [];
    const ul = $('#ed-img-list');
    ul.innerHTML = list.length
      ? list.map((im, i) => `<li><button type="button" class="adm-btn adm-btn--ghost adm-btn--sm" data-img="${i}">插入 ${escText(im.file)}${im.alt ? `（${escText(im.alt)}）` : '（尚未填替代文字）'}</button></li>`).join('')
      : '<li class="adm-muted">還沒有圖片檔。請按「從電腦選圖片…」，或把圖片拖到下方「附件與圖片」。</li>';
    imgBox.hidden = false;
    ($('button', ul) ?? $('#ed-img-add')).focus();
  }
  const escText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  $('#ed-img-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-img]'); if (!b) return;
    const im = (opts.getImages?.() ?? [])[Number(b.dataset.img)];
    imgBox.hidden = true;
    if (im) insertImage(im);
  });
  $('#ed-img-add').addEventListener('click', () => { imgBox.hidden = true; opts.requestImage?.(); });
  $('#ed-img-cancel').addEventListener('click', () => { imgBox.hidden = true; restoreRange(); });
  imgBox.addEventListener('keydown', (e) => { if (e.key === 'Escape') { imgBox.hidden = true; restoreRange(); } });

  /** 在游標處插入圖片。im：{ path, alt, blobUrl } */
  function insertImage(im) {
    if (/\/files\/\//.test(im.path)) { say('請先填寫「內容 ID」（頁面下方），圖片路徑會用到它。'); return; }
    const alt = (im.alt ?? '').replace(/[\r\n]+/g, ' ');
    if (mode === 'wys') {
      const a = alt.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
      const src = (im.blobUrl || im.path).replace(/"/g, '&quot;');
      insertHtml(`<img src="${src}" alt="${a}" data-md-src="${im.path.replace(/"/g, '&quot;')}">`);
      flush();
    } else {
      const md = `![${alt.replace(/[\\[\]]/g, '\\$&')}](${im.path})`;
      const v = ta.value;
      const at = Number.isFinite(ta.selectionStart) ? ta.selectionStart : v.length;
      const end = Number.isFinite(ta.selectionEnd) ? ta.selectionEnd : at;
      const before = v.slice(0, at), after = v.slice(end);
      const pre = !before || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
      const post = !after || after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n';
      ta.value = `${before}${pre}${md}${post}${after}`;
      const caret = (before + pre + md).length;
      ta.setSelectionRange(caret, caret);
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      stale = true;
      if (mode === 'prev') renderPreview();
    }
    say(`已在游標處插入圖片 ${im.path}`);
  }

  // ---------- 所見即所得事件 ----------
  wys.addEventListener('input', schedule);
  wys.addEventListener('blur', flush);
  wys.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      if (k === 'b') { e.preventDefault(); COMMANDS.bold(); } else if (k === 'i') { e.preventDefault(); COMMANDS.italic(); } else if (k === 'k') { e.preventDefault(); COMMANDS.link(); }
    }
  });
  const cleanFrom = (dt) => {
    const dropped = [];
    const h = dt.getData('text/html');
    const html = h ? mdToHtml(htmlToMd(h, { dropped }), { marked: getMarked(), imgSrc }) : plainTextToHtml(dt.getData('text/plain'), { marked: getMarked(), imgSrc });
    if (dropped.length) say(dropped.join('；'));
    return html;
  };
  wys.addEventListener('paste', (e) => {
    const dt = e.clipboardData; if (!dt) return;
    e.preventDefault();
    const html = cleanFrom(dt);
    if (html) { document.execCommand('insertHTML', false, html); schedule(); say('已貼上，並清成支援的格式（標題、段落、清單、表格、連結、粗斜體）'); }
  });
  wys.addEventListener('dragover', (e) => { e.preventDefault(); });
  wys.addEventListener('drop', (e) => {
    e.preventDefault();
    const dt = e.dataTransfer; if (!dt) return;
    if (dt.files?.length) { opts.onFiles?.(dt.files); return; }
    const r = document.caretRangeFromPoint?.(e.clientX, e.clientY);
    if (r) { const s = document.getSelection(); s.removeAllRanges(); s.addRange(r); }
    const html = cleanFrom(dt);
    if (html) { document.execCommand('insertHTML', false, html); schedule(); }
  });

  // ---------- Markdown 頁籤：快捷鍵與同步 ----------
  function wrapSel(l, r, placeholder) {
    const a = ta.selectionStart, b = ta.selectionEnd, v = ta.value;
    const mid = v.slice(a, b) || placeholder;
    ta.value = v.slice(0, a) + l + mid + r + v.slice(b);
    ta.setSelectionRange(a + l.length, a + l.length + mid.length);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }
  ta.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'b') { e.preventDefault(); wrapSel('**', '**', '粗體'); }
    else if (k === 'i') { e.preventDefault(); wrapSel('*', '*', '斜體'); }
    else if (k === 'k') {
      e.preventDefault();
      const a = ta.selectionStart, b = ta.selectionEnd, v = ta.value;
      const text = v.slice(a, b) || '連結文字';
      ta.value = `${v.slice(0, a)}[${text}](https://)${v.slice(b)}`;
      const s = a + text.length + 3;
      ta.setSelectionRange(s, s + 8);
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  ta.addEventListener('input', () => { if (mode !== 'wys') stale = true; });

  // ---------- 對外 ----------
  const initial = store.get(TAB_KEY);
  setMode(MODES.includes(initial) ? initial : 'wys');
  try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch { /* ignore */ }
  // vendor 的 marked 若比腳本晚載入，載好後重畫一次
  if (!getMarked()) window.addEventListener('load', () => { if (getMarked()) { stale = true; if (mode === 'wys') renderWys(); if (mode === 'prev') renderPreview(); } }, { once: true });
  return {
    get mode() { return mode; },
    setMode,
    flush,
    insertImage,
    /** textarea 被程式改寫（載入草稿、範例、清空）或檔案（blob URL）有變時呼叫 */
    refresh() { clearTimeout(timer); dirty = false; stale = true; if (mode === 'wys') renderWys(); else if (mode === 'prev') renderPreview(); },
    /** 只重畫預覽／圖片（不動 textarea） */
    repaint() { if (mode === 'prev') renderPreview(); else if (mode === 'wys' && !dirty && ta.value.includes('/files/')) { stale = true; renderWys(); } },
  };
}
