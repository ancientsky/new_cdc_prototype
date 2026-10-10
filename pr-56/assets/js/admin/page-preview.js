// /admin/publish/ 右側「頁面預覽」（第二十二輪，借 TinaCMS 的 contextual editing 概念）：
//   表單一邊打、右邊即時長出「上線後長什麼樣」的頁面；點預覽裡的任一區塊就跳到左側對應欄位（並打開摺疊的群組），
//   反過來，游標在哪個欄位，預覽裡對應的區塊就亮起。這裡只做「對應」與「渲染」，不碰表單資料；資料一律由 publish.js 的 readForm() 給。
//   renderPreviewHtml() 是純函式（Node 測試直接呼叫），initPagePreview() 才碰 DOM。
// 不 import common.js（它一載入就碰 document），renderPreviewHtml 才能在 Node 測試裡直接跑。
const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** 預覽區塊 → 表單欄位（左邊的 id 是預覽 data-field；右邊是 focusField 要找的目標與反向亮起用的選擇器） */
export const FIELD_MAP = {
  'f-type': { focus: '#f-type', within: '#f-type, #lane-box', label: '型別' },
  'f-title': { focus: '#f-title', within: '#f-title', label: '標題' },
  'f-owner': { focus: '#f-owner', within: '#f-owner, #f-period', label: '權責單位與審閱週期' },
  'f-body': { focus: '#f-wys, #f-body', within: '.adm-editor', label: '內文' },
  'asset-panel': { focus: '#as-pick', within: '#asset-panel', label: '附件與圖片' },
  'f-based-q': { focus: '#f-based-q', within: '#f-based-q, #f-based-list, #f-based-chips', label: '依據正本' },
  'f-audience': { focus: '#f-audience input', within: '#f-audience', label: '對象' },
  'f-tasks': { focus: '#f-tasks input', within: '#f-tasks', label: '任務入口' },
  'f-extra': { focus: '#f-extra input:not([hidden]), #f-extra select, #f-extra textarea', within: '#f-extra', label: '型別專屬欄位' },
  'f-langs': { focus: '#f-langs input:not([disabled])', within: '#f-langs, #g-langs > summary', label: '提供語言' },
  'f-timing': { focus: '#f-publish-at', within: '#f-timing, #g-timing > summary', label: '發布時間' },
  'f-id': { focus: '#f-id', within: '#f-id', label: '內容 ID' },
};

const blk = (field, inner, { cls = '', tag = 'div' } = {}) => {
  const label = FIELD_MAP[field]?.label ?? field;
  return `<${tag} class="adm-pv__blk ${cls}" data-field="${esc(field)}" tabindex="0" role="button" aria-label="編輯${esc(label)}（跳到左側欄位）" title="點一下跳到「${esc(label)}」">${inner}</${tag}>`;
};
const ph = (t) => `<span class="adm-pv__ph">${esc(t)}</span>`;
const lines = (s) => String(s ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

/**
 * 純函式：把表單狀態畫成「公開頁長相」的 HTML。
 * f：readForm() 的結果；h：{ md(markdown)→html, typeLabel(type), unitName(id), laneLabel, basedTitle(id)→string, langLabel(code), today, assets:[{file,kind,alt,title}], summary }
 */
export function renderPreviewHtml(f, h) {
  const typeLabel = h.typeLabel?.(f.type) ?? f.type;
  const unit = h.unitName?.(f.owner) ?? f.owner ?? '';
  const title = f.title ? esc(f.title) : ph('（尚未填標題）');
  const bodyHtml = f.body?.trim() ? (h.md?.(f.body) ?? `<p>${esc(f.body)}</p>`) : `<p>${ph('（尚未填內文。左側用所見即所得或 Markdown 打字，這裡會跟著更新。）')}</p>`;
  const based = (f.basedOn ?? []);
  const langsOn = ['zh-TW', ...Object.entries(f.langs ?? {}).filter(([, v]) => v?.on).map(([k]) => k)];
  const langsOff = Object.entries(f.langs ?? {}).filter(([, v]) => !v?.on).map(([k]) => k);
  const timing = f.urgent ? '緊急發布：送出後立即上線，公關室事後複核' : f.publishAtLocal ? `排程：${esc(f.publishAtLocal.replace('T', ' '))}（臺北時間）後上線` : '核准後立即上線';
  const assets = h.assets ?? [];
  const extra = extraHtml(f, h);
  const audience = (f.audience ?? []).map((a) => ({ public: '民眾', professional: '專業人員' }[a] ?? a));
  const tasks = (f.tasks ?? []);
  return `
<div class="adm-pv" lang="zh-TW">
  <div class="adm-pv__chrome" aria-hidden="true"><span></span><span></span><span></span><span class="adm-pv__url">${esc(h.siteBase ?? '')}/…/${esc(f.id || 'xxx')}/</span></div>
  <div class="adm-pv__page">
    ${blk('f-type', `<p class="adm-pv__crumb">首頁 › ${esc(typeLabel)}${h.laneLabel ? ` <span class="adm-badge adm-badge--info">${esc(h.laneLabel)}</span>` : ''}</p>`)}
    ${blk('f-title', `<h1 class="adm-pv__h1">${title}</h1>`)}
    ${blk('f-owner', `<p class="adm-pv__prov">權責單位：<strong>${esc(unit) || ph('（未選）')}</strong> · 最後審閱 ${esc(h.today ?? '')}${f.period !== '' && f.period != null ? ` · 每 ${esc(f.period)} 個月審閱` : ''}</p>`)}
    ${blk('f-audience', `<p class="adm-pv__tags">對象：${audience.length ? audience.map((a) => `<span class="adm-pv__tag">${esc(a)}</span>`).join('') : ph('（未選對象）')}</p>`)}
    ${h.summary ? `<p class="adm-pv__summary">${esc(h.summary)}</p>` : ''}
    ${blk('f-body', `<div class="c-prose adm-pv__body">${bodyHtml}</div>`, { cls: 'adm-pv__blk--body' })}
    ${extra}
    ${blk('asset-panel', `<h2 class="adm-pv__h2">附件與圖片</h2>${assets.length ? `<ul class="adm-pv__list">${assets.map((a) => `<li><span class="adm-pv__kind">${esc(a.kind ?? 'file')}</span> ${esc(a.title || a.alt || a.file)} <span class="muted">${esc(a.file)}</span></li>`).join('')}</ul>` : `<p>${ph('（沒有附件；把檔案拖到左側「附件與圖片」）')}</p>`}`)}
    ${blk('f-based-q', `<h2 class="adm-pv__h2">依據正本</h2>${based.length ? `<ul class="adm-pv__list">${based.map((b) => `<li>${esc(h.basedTitle?.(b) ?? b)} <code>${esc(b)}</code></li>`).join('')}</ul>` : `<p>${ph(f.type === 'media' ? '（影音必填依據正本）' : '（未填；衍生內容請填，正本修訂時才會收到待辦）')}</p>`}`)}
    ${blk('f-tasks', `<p class="adm-pv__tags">任務入口：${tasks.length ? tasks.map((t) => `<span class="adm-pv__tag">${esc(h.taskLabel?.(t) ?? t)}</span>`).join('') : ph('（不出現在任務入口）')}</p>`)}
    <div class="adm-pv__foot">
      ${blk('f-langs', `<p>提供語言：${langsOn.map((c) => `<span class="adm-pv__tag">${esc(h.langLabel?.(c) ?? c)}</span>`).join('')}${langsOff.length ? ` <span class="muted">不提供：${langsOff.map((c) => esc(h.langLabel?.(c) ?? c)).join('、')}</span>` : ''}</p>`)}
      ${blk('f-timing', `<p>發布：${timing}</p>`)}
      ${blk('f-id', `<p>內容 ID：<code>${esc(f.id || 'xxx')}</code> · 機讀版 <code>${esc(f.id || 'xxx')}.md</code> · API <code>/v1/…</code></p>`)}
    </div>
  </div>
</div>`;
}

function extraHtml(f, h) {
  const ex = f.extra ?? {};
  const kv = (rows) => `<dl class="adm-pv__kv">${rows.filter(([, v]) => v).map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`;
  switch (f.type) {
    case 'document': return blk('f-extra', `<h2 class="adm-pv__h2">版本</h2>${kv([['family', ex.family], ['版次', ex.version], ['生效日', ex.effectiveAt], ['取代', ex.supersedes]])}`);
    case 'letter': return blk('f-extra', `<p class="adm-pv__prov">通函號：${ex.letterNo ? esc(ex.letterNo) : ph('（未填）')}</p>`);
    case 'clarification': return blk('f-extra', `<div class="adm-pv__verdict">網傳：${ex.claim ? esc(ex.claim) : ph('（未填網傳訊息）')}<br>查證結果：<strong>${esc({ false: '不實', 'partly-true': '部分屬實', outdated: '已過時', true: '屬實' }[ex.verdict] ?? ex.verdict ?? '')}</strong>${ex.shareText ? `<br>可轉傳短訊：${esc(ex.shareText)}` : ''}</div>`);
    case 'media': {
      const ch = lines(ex.chapters);
      const tr = lines(ex.transcript);
      return blk('f-extra', `<div class="adm-pv__video">${ex.youtube ? `YouTube ${esc(ex.youtube)}` : '示意海報'} · ${esc(ex.mediaType || 'video')}${ex.versionLabel ? ` · 依 ${esc(ex.versionLabel)} 製作` : ''}${ex.producedAt ? ` · ${esc(ex.producedAt)}` : ''}</div>
        ${ch.length ? `<h2 class="adm-pv__h2">章節</h2><ol class="adm-pv__list">${ch.map((c) => `<li>${esc(c)}</li>`).join('')}</ol>` : ''}
        <h2 class="adm-pv__h2">逐字稿</h2>${tr.length ? `<p>${esc(tr.slice(0, 3).join(' '))}${tr.length > 3 ? ' …' : ''}</p>` : `<p>${ph('（逐字稿必填，進索引與反向稽核）')}</p>`}`);
    }
    case 'topic': return blk('f-extra', `<h2 class="adm-pv__h2">連結列</h2>${lines(ex.links).length ? `<ul class="adm-pv__list">${lines(ex.links).map((l) => { const [t, u] = l.split('|').map((s) => s.trim()); return `<li>${esc(t)} <span class="muted">${esc(u ?? '')}</span></li>`; }).join('')}</ul>` : `<p>${ph('（未填連結）')}</p>`}${ex.startAt || ex.endAt ? `<p class="adm-pv__prov">${esc(ex.startAt || '')} ～ ${esc(ex.endAt || '（不下架）')}</p>` : ''}`);
    case 'service': return blk('f-extra', `<h2 class="adm-pv__h2">申請步驟</h2>${lines(ex.steps).length ? `<ol class="adm-pv__list">${lines(ex.steps).map((l) => `<li>${esc(l.split('|')[0].trim())}</li>`).join('')}</ol>` : `<p>${ph('（未填步驟）')}</p>`}${kv([['承諾天數', ex.slaDays], ['費用', ex.fee], ['聯絡窗口', ex.contact]])}`);
    case 'publication': return blk('f-extra', kv([['系列', ex.series], ['卷／期', [ex.volume, ex.issue].filter(Boolean).join(' / ')], ['ISSN', ex.issn], ['ISBN', ex.isbn], ['GPN', ex.gpn]]));
    case 'labtest': return blk('f-extra', `<h2 class="adm-pv__h2">檢體</h2>${lines(ex.specimens).length ? `<ul class="adm-pv__list">${lines(ex.specimens).map((l) => `<li>${esc(l.split('|')[0].trim())}</li>`).join('')}</ul>` : `<p>${ph('（未填檢體）')}</p>`}${ex.sendHours ? `<p class="adm-pv__prov">送驗時限 ${esc(ex.sendHours)} 小時</p>` : ''}`);
    case 'research': return blk('f-extra', kv([['年度', ex.year], ['狀態', ex.projectStatus], ['計畫編號', ex.projectNo], ['執行機構', ex.piUnit]]));
    case 'disease': return blk('f-extra', `<p class="adm-pv__prov">對應主檔：${ex.disease ? `<code>${esc(ex.disease)}</code>` : ph('（未選）')}</p>`);
    case 'vaccine': return blk('f-extra', `<p class="adm-pv__prov">對應主檔：${ex.vaccine ? `<code>${esc(ex.vaccine)}</code>` : ph('（未選）')}</p>`);
    default: return '';
  }
}

/**
 * 掛到 DOM。opts：{ root, form, getState()→readForm(), helpers()→h, onFocusField(field) 選填, debounceMs }
 * 回傳 { repaint(), focusField(field) }
 */
export function initPagePreview(opts) {
  const root = opts.root;
  const form = opts.form;
  // 第二十九輪：其他後台表單（疫情報導文章）可帶自己的欄位對照表與渲染函式；沒帶就是 /admin/publish/ 的預設
  const MAP = opts.fieldMap ?? FIELD_MAP;
  const render = opts.render ?? renderPreviewHtml;
  let timer = 0;
  let active = null;

  function repaint() {
    const f = opts.getState();
    root.innerHTML = render(f, opts.helpers());
    root.querySelectorAll('img[data-md-src][src^="data:"]').forEach((im) => { im.alt = `${im.alt || '圖片'}（尚未選取檔案，上線後顯示）`; im.classList.add('adm-img-missing'); im.removeAttribute('src'); });
    if (active) root.querySelector(`[data-field="${active}"]`)?.classList.add('is-active');
  }
  const soon = () => { clearTimeout(timer); timer = setTimeout(repaint, opts.debounceMs ?? 250); };

  /** 從預覽跳到欄位：打開摺疊群組、捲到看得見、聚焦、閃一下。 */
  function focusField(field) {
    const m = MAP[field]; if (!m) return;
    const target = m.focus.split(',').map((s) => form.querySelector(s.trim())).find((el) => el && !el.hidden && !el.closest('[hidden]'));
    const wrap = m.within.split(',').map((s) => form.querySelector(s.trim())).find(Boolean);
    const el = target ?? wrap; if (!el) return;
    let d = el.closest('details'); while (d) { d.open = true; d = d.parentElement?.closest('details'); }
    if (field === 'f-body') form.querySelector('[role="tab"][aria-selected="true"]')?.click?.(); // 讓目前頁籤重新計算高度
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    try { target?.focus({ preventScroll: true }); } catch { /* ignore */ }
    const box = (target ?? el).closest('.adm-field, .adm-fieldset, .adm-assets, .adm-editor, details') ?? el;
    box.classList.remove('adm-field--hit'); void box.offsetWidth; box.classList.add('adm-field--hit');
    setTimeout(() => box.classList.remove('adm-field--hit'), 1400);
    opts.onFocusField?.(field);
  }

  root.addEventListener('click', (e) => { const b = e.target.closest('[data-field]'); if (!b || e.target.closest('a')) return; e.preventDefault(); focusField(b.dataset.field); });
  root.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-field]')) { e.preventDefault(); focusField(e.target.dataset.field); } });

  // 反向：游標在哪個欄位，預覽對應區塊亮起
  function fieldOf(el) {
    for (const [field, m] of Object.entries(MAP)) if (el.closest(m.within)) return field;
    return null;
  }
  form.addEventListener('focusin', (e) => {
    const field = fieldOf(e.target);
    if (field === active) return;
    active = field;
    root.querySelectorAll('.adm-pv__blk.is-active').forEach((x) => x.classList.remove('is-active'));
    if (field) { const b = root.querySelector(`[data-field="${field}"]`); if (b) { b.classList.add('is-active'); if (root.closest('.adm-result')?.scrollHeight > root.closest('.adm-result')?.clientHeight) b.scrollIntoView({ block: 'nearest' }); } }
  });

  return { repaint, repaintSoon: soon, focusField };
}
