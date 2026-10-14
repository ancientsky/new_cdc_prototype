// /admin/publish/ 的「送審與上線」面板（第三十輪）：有寫入閘道時，「儲存草稿／送審」直接交給閘道；沒有閘道就不出現。
// 同事只看到狀態（草稿、審核中、退回、已核准、已上線）、退回意見與歷程；背後的版本紀錄由閘道處理。
// 所有畫面文字以 textContent 寫入（el()），不把任何使用者資料塞進 innerHTML。
//
// 第五十二輪：同時修改（docs/deploy.md §23、guide-staff §54）
//   - 存檔與送審帶「開啟時的版本碼」（baseHash）。編輯頁有 getBaseHash() 就用它的（上架頁）；沒有的（疫情報導等）就用這裡記的：
//     從送審件開啟（?gw=）時閘道給的碼、這頁上次存好時閘道回的碼；都沒有就不送（閘道照舊接受）。
//   - 開啟時就說：這筆內容已有進行中的送審件（誰、什麼狀態、從那一件繼續）；網站上的版本比這頁顯示的新。
//   - 存檔被擋（409 stale）：說明誰、何時、改了什麼；「載入最新版（保留我的修改）」與「下載我這一版」，不丟掉同事的修改。
//   - 疫情報導（§23.5、§24.7）：exportExtra 可以多給 categories（分類主檔 { items, start }）；重新開啟送審件時，閘道送回的配套內容與分類主檔
//     交給 loadItem／reloadLatest（meta.companions、meta.categories），頁面據以帶回表單；分類衝突（kind: categories）交給 reloadCategories。
//     頁面換了要改的內容（例：疫情報導的「選文章」）⇒ 發 adm:gw-target 事件，這裡重新檢查（進行中的送審件、網站版本）。
import { $, $$, store, downloadText } from './common.js';
import { detectGateway, el, clear, fmtTime, errorText, STATUS_TONE } from './gateway-client.js';

const CUR_KEY = 'cdc.admin.gwCurrent'; // { contentId, sid }：這台電腦上次處理的送審件
// 錯誤欄位 → 表單上的欄位（點錯誤訊息就跳過去）
const FIELD_INPUT = { title: '#f-title', question: '#f-title', id: '#f-id', owner: '#f-owner', reviewPeriodMonths: '#f-period', summary: '#sum', answerMarkdown: '#f-wys', bodyMarkdown: '#f-wys', clarificationMarkdown: '#f-wys', introMarkdown: '#f-wys', abstractMarkdown: '#f-wys', publishAt: '#f-publish-at', basedOn: '#f-based-q' };

/**
 * @typedef {{ theirs: string[], mine: string[], conflicts: { label: string, yours: string }[] }} MergeSummary
 * @typedef {{ companions?: any[], files?: { name: string, base64: string }[], categories?: { items: any[], start: any[] }|null }} Extra
 * @param {{ exportObj: () => any, loadItem: (item: any, meta?: { contentHash?: string, update?: any, companions?: any[], categories?: any }) => Promise<void>|void, getContentId: () => string, exportExtra?: () => Promise<Extra>|Extra, fieldInput?: Record<string, string>, onSaved?: (sub: any) => void,
 *   getBaseHash?: () => string|undefined, reloadLatest?: (item: any, version: string, o: { source: 'site'|'gateway', data?: any }) => Promise<MergeSummary>|MergeSummary, getEditTarget?: () => ({ id: string, type: string, version?: string }|null),
 *   reloadCategories?: (stale: { rows: any[], conflicts: any[] }) => Promise<MergeSummary>|MergeSummary }} api
 *   exportExtra（第四十五輪）：跟內容一起送的配套內容（如新卷期）與附件（PDF、圖），疫情報導後台用；fieldInput：欄位 → 表單選擇器（預設是 /admin/publish/ 的）
 *   第五十二輪：getBaseHash（這頁依哪一版改的）、reloadLatest（載入最新版並重新套用同事的修改）、getEditTarget（修改已上架內容時：開啟時檢查網站版本）——都可省略
 */
export async function initPublishGateway(api) {
  const panel = $('#gw-panel');
  if (!panel) return null;
  const gw = await detectGateway();
  if (!gw) return null;
  document.body.classList.add('adm-gw');
  panel.hidden = false;
  const localSave = $('#btn-save');
  if (localSave) { localSave.textContent = '暫存在這台電腦'; localSave.title = 'Ctrl+S：只存在這台電腦的瀏覽器，同事看不到'; }
  const stateEl = $('#gw-state'), statusEl = $('#gw-status'), errBox = $('#gw-errors'), notes = $('#gw-notes'), hist = $('#gw-history'), approvals = $('#gw-approvals');
  const btnSave = $('#gw-save'), btnSubmit = $('#gw-submit');
  let current = null;
  let tracked = null; // { sid, hash }：從送審件開啟或這頁上次存好時的版本碼（編輯頁自己沒管版本碼時用）
  let blocked = ''; // 不該在這頁存的原因（例：已有進行中的送審件，這頁卻是網站版本）
  // 版本相關的提醒放在自己的區塊（paint() 會清掉退回意見區，這裡不跟著清）
  const sync = el('div', { id: 'gw-sync', 'aria-live': 'polite' });
  notes.before(sync);

  if (!gw.user) {
    stateEl.textContent = '無法使用';
    statusEl.textContent = errorText({ data: gw.error });
    if (gw.error?.loginUrl) statusEl.append(' ', el('a', { href: `${gw.error.loginUrl}?next=${encodeURIComponent(location.pathname.replace(/^.*?(\/admin\/)/, '$1'))}`, text: '用機關帳號登入' }));
    btnSave.disabled = true; btnSubmit.disabled = true;
    return gw;
  }

  function say(text, tone = '') { statusEl.textContent = text; statusEl.className = tone ? `adm-${tone}` : 'adm-muted'; }
  function paint() {
    const st = current?.status ?? null;
    stateEl.textContent = current ? current.statusLabel : '尚未送審';
    stateEl.className = `adm-badge adm-badge--${STATUS_TONE[st] ?? 'gray'}`;
    approvals.textContent = current && st === 'in_review' ? `需要 ${current.requiredApprovals} 位審核，已核准 ${current.approvals.length} 位` : current?.scheduledFor && st === 'approved' ? `排程 ${current.scheduledFor} 上線` : '';
    const locked = st === 'in_review';
    btnSave.disabled = locked || !!blocked; btnSubmit.disabled = locked || !!blocked;
    btnSubmit.textContent = st === 'returned' ? '修改完成，再送審' : '送審';
    // 退回意見（最新在前）
    clear(notes);
    const returns = (current?.comments ?? []).filter((c) => c.kind === 'return');
    if (returns.length && ['returned', 'draft'].includes(st)) {
      const last = returns[returns.length - 1];
      notes.append(el('div', { class: 'adm-box adm-box--warn' }, el('strong', { text: `${last.name} 退回修改（${fmtTime(last.at)}）` }), el('p', { class: 'gw-comment', text: last.text })));
    }
    clear(hist);
    for (const h of [...(current?.history ?? [])].reverse()) hist.append(el('li', {}, el('span', { text: `${fmtTime(h.at)}　${h.label}` }), el('span', { class: 'adm-muted', text: `　${h.name}` })));
    $('#gw-history-wrap').hidden = !current?.history?.length;
  }
  function showErrors(fields) {
    clear(errBox);
    errBox.hidden = !fields?.length;
    if (!fields?.length) return;
    const list = el('ul', {});
    for (const f of fields) {
      const target = (api.fieldInput ?? FIELD_INPUT)[f.field];
      list.append(el('li', {}, target ? el('button', { type: 'button', class: 'adm-linkbtn', dataset: { target }, text: f.message }) : f.message));
    }
    errBox.append(el('strong', { text: '還需要修正這些地方（點一下就跳到該欄位）' }), list);
  }
  errBox.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-target]');
    if (!b) return;
    if (b.dataset.target === '#sum') $('#pt-res')?.click();
    const t = $(b.dataset.target);
    t?.closest('details')?.setAttribute('open', '');
    t?.focus();
  });
  function remember() { if (current) store.set(CUR_KEY, { contentId: current.contentId, sid: current.id }); }

  /* ───────── 第五十二輪：版本提醒 ───────── */
  const box = (tone, ...kids) => el('div', { class: `adm-box adm-box--${tone}`, role: tone === 'warn' ? 'alert' : 'status' }, ...kids);
  const gwLink = (sid) => `${location.pathname}?gw=${encodeURIComponent(sid)}`;
  /** 我這一版：下載成 JSON（任何情況都不丟掉同事的修改） */
  function downloadMine(obj = api.exportObj()) { downloadText(`${String(obj?.id ?? 'content').replace(/[^a-z0-9.-]/gi, '_')}-我的版本.json`, `${JSON.stringify(obj, null, 2)}\n`); }
  const dlBtn = (obj) => { const b = el('button', { type: 'button', class: 'adm-btn adm-btn--ghost adm-btn--sm', text: '下載我這一版（JSON）' }); b.addEventListener('click', () => downloadMine(obj)); return b; };
  /** 存檔要帶的版本碼 */
  function baseHashFor(body) {
    if (api.getBaseHash) return api.getBaseHash();
    return tracked && tracked.sid === body.submissionId ? tracked.hash : undefined;
  }
  /**
   * 「已有進行中的送審件」：這頁的內容不是那一件的版本 ⇒ 請從那一件繼續（存檔鈕先停用）。
   * mismatch：true＝確定不是那一件的版本；false＝正在接著改那一件；null＝不知道（編輯頁沒管版本碼）
   */
  function showOpen(open, { mismatch }) {
    clear(sync);
    const who = open.editors?.map((e) => e.name).join('、') || '同事';
    if (open.companionOf) {
      sync.append(box('warn', el('strong', { text: '這筆內容正在另一個送審件裡' }), el('p', { text: `它是送審件「${open.companionOf}」的配套內容（${open.statusLabel}，承辦：${who}）。那一件結束前，這裡不能另外修改。` })));
      blocked = '配套內容'; paint(); return;
    }
    const tail = mismatch === true ? '你現在看到的是網站上的版本，不含那一件的修改；在這裡改了也存不進去（會蓋掉那一件）。請改從那一件繼續，兩個人的名字都會列在承辦。'
      : mismatch === false ? '你正在接著改這一件。' : '如果你不是從那一件開啟的，請改從那一件繼續，以免蓋掉那一件的修改。';
    const p1 = el('p', { text: `「${open.title}」已經有一個進行中的送審件（${open.statusLabel}，承辦：${who}，最後更新 ${fmtTime(open.updatedAt)}）。${tail}` });
    const go = el('a', { class: 'adm-btn adm-btn--sm', href: gwLink(open.id), text: open.status === 'in_review' ? '查看那一件（審核中）' : '從那一件繼續' });
    sync.append(box(mismatch === false ? 'info' : 'warn', el('strong', { text: '已有進行中的送審件' }), p1, mismatch === false ? null : go));
    if (mismatch) { blocked = '已有進行中的送審件'; paint(); }
  }
  /** 載入最新版（保留我的修改）之後：說明對方改了什麼、我的哪些修改已重新套用、哪些欄位兩邊都改了（列出我原本的值） */
  function showMerged(sum, mine, extraText = '') {
    clear(sync);
    const kids = [el('strong', { text: '已載入最新版' })];
    if (extraText) kids.push(el('p', { text: extraText }));
    if (sum.theirs?.length) kids.push(el('p', { text: `在你開啟之後，別人改了：${sum.theirs.join('、')}。` }));
    if (sum.mine?.length) kids.push(el('p', { text: `你的修改已重新套用：${sum.mine.join('、')}。請確認後再存。` }));
    else if (!sum.conflicts?.length) kids.push(el('p', { text: '你還沒有改任何欄位，可以直接修改。' }));
    if (sum.conflicts?.length) {
      kids.push(el('p', {}, el('strong', { text: `這些欄位你們兩邊都改了，現在顯示的是最新版；你原本寫的在下面，請自己決定要不要重新改：` })));
      for (const c of sum.conflicts) kids.push(el('details', {}, el('summary', { text: c.label }), el('pre', { class: 'adm-pre', tabindex: '0', text: c.yours })));
    }
    kids.push(el('p', { class: 'adm-muted', text: '你原本的整份內容也另存在這台電腦；需要時可以下載。' }), dlBtn(mine));
    sync.append(box(sum.conflicts?.length ? 'warn' : 'info', ...kids));
  }
  /** 閘道說「送審件開始之後網站版本已更新，已併入」（從送審件開啟時） */
  function showUpdate(update) {
    clear(sync);
    const kids = [el('strong', { text: '網站上的版本已更新，已併進這個送審件' }), el('p', { text: `${update.text}系統已把這些更新放進這個送審件，你的修改都還在；存檔時會以網站最新版為底。` })];
    if (update.conflicts?.length) {
      kids.push(el('p', {}, el('strong', { text: '這些欄位網站上和這個送審件都改了，現在顯示的是網站上的；送審件原本的值在下面，請確認：' })));
      for (const c of update.conflicts) kids.push(el('details', {}, el('summary', { text: c.label }), el('pre', { class: 'adm-pre', tabindex: '0', text: c.yours })));
    }
    sync.append(box('warn', ...kids));
  }
  /** 載入最新版：送審件的（?gw=）或網站上的現行版；然後把同事的修改重新套用上去 */
  async function reloadFrom(st) {
    const mine = api.exportObj();
    say('正在載入最新版…');
    if (st.kind === 'categories' && api.reloadCategories) { // 疫情報導分類：閘道已附上網站上的主檔，不必再抓
      const sum = await api.reloadCategories(st.categories ?? { rows: [], conflicts: [] });
      blocked = ''; paint(); showMerged(sum, mine, '疫情報導的分類已換成網站上最新的主檔，你加或改的分類已重新套用。');
    } else if (st.submissionId) {
      const [d, c] = await Promise.all([gw.get(`/items/${st.submissionId}`), gw.get(`/items/${st.submissionId}/content`)]);
      if (!d.ok || !c.ok || !c.data?.item) { say(errorText(d.ok ? c : d), 'red'); return; }
      current = d.data; remember();
      try { history.replaceState(null, '', gwLink(st.submissionId)); } catch { /* 不能改網址也沒關係 */ }
      tracked = { sid: current.id, hash: c.data.contentHash };
      const sum = await api.reloadLatest(c.data.item, c.data.contentHash, { source: 'gateway', data: c.data });
      blocked = ''; paint(); showMerged(sum, mine, c.data.update?.text ?? '');
    } else {
      const r = await gw.get(`/current?contentId=${encodeURIComponent(mine.id)}&type=${encodeURIComponent(mine.type)}`);
      if (!r.ok || !r.data?.item) { say(errorText(r), 'red'); return; }
      const sum = await api.reloadLatest(r.data.item, r.data.contentHash, { source: 'site', data: r.data });
      blocked = ''; paint(); showMerged(sum, mine);
    }
    say('已載入最新版，請確認後再存。', 'green');
  }
  /** 存檔被擋（409 stale／exists）：說明＋怎麼辦 */
  function showStale(data) {
    clear(sync);
    const st = data.stale ?? {};
    const kids = [el('strong', { text: st.kind === 'exists' ? '網站上已經有這個內容 ID' : '這一版還沒有存：別人在你開啟之後改過' }), el('p', { text: data.message })];
    const row = el('div', { class: 'adm-actions' });
    if (['site', 'draft', 'open', 'moved', 'categories'].includes(st.kind)) {
      if (st.kind === 'categories' ? api.reloadCategories : api.reloadLatest) {
        const b = el('button', { type: 'button', class: 'adm-btn adm-btn--sm', text: '載入最新版（保留我的修改）' });
        b.addEventListener('click', () => { b.disabled = true; reloadFrom(st).finally(() => { b.disabled = false; }); });
        row.append(b);
      } else row.append(el('a', { class: 'adm-btn adm-btn--sm', href: st.submissionId ? gwLink(st.submissionId) : location.href, target: '_blank', rel: 'noopener', text: '在新分頁開啟最新版' }));
    }
    row.append(dlBtn());
    kids.push(row);
    if (!api.reloadLatest && st.kind !== 'exists') kids.push(el('p', { class: 'adm-muted', text: '你在這頁的修改仍在（也已存在這台電腦）；請在新分頁對照最新版，把你的修改重新填一次再存。' }));
    sync.append(box('warn', ...kids));
  }
  /** 修改已上架內容（?edit=）開啟時：網站上的版本有沒有更新、有沒有進行中的送審件 */
  async function checkCurrent(cid) {
    const target = api.getEditTarget?.() ?? null;
    let type = target?.type;
    if (!type) { try { type = api.exportObj()?.type; } catch { type = ''; } }
    if (!cid || !type) return;
    const base = api.getBaseHash ? api.getBaseHash() : undefined;
    const r = await gw.get(`/current?contentId=${encodeURIComponent(cid)}&type=${encodeURIComponent(type)}${base ? `&base=${encodeURIComponent(base)}` : ''}`);
    if (!r.ok) return;
    const c = r.data;
    if (c.open && !(current && current.id === c.open.id && tracked)) { showOpen(c.open, { mismatch: base ? base !== c.open.contentHash : null }); return; }
    if (c.stale?.kind === 'exists' && !target) { clear(sync); sync.append(box('warn', el('strong', { text: '網站上已經有這個內容 ID' }), el('p', { text: `${c.stale.text}要修改它，請從那一頁的「修改這頁」進來；如果是新內容，請換一個內容 ID。` }))); return; }
    if (c.stale?.kind === 'site' && target && c.item && api.reloadLatest) {
      clear(sync);
      const b = el('button', { type: 'button', class: 'adm-btn adm-btn--sm', text: '載入最新版' });
      b.addEventListener('click', () => { b.disabled = true; reloadFrom({ kind: 'site' }).finally(() => { b.disabled = false; }); });
      sync.append(box('warn', el('strong', { text: '網站上有更新的版本' }), el('p', { text: `${c.stale.text}請先載入最新版再改（已經改了也沒關係，你的修改會保留）。` }), b));
    }
  }

  async function refresh({ skipGw = false } = {}) {
    const qs = new URLSearchParams(location.search);
    const sid = qs.get('gw');
    blocked = ''; clear(sync);
    if (sid && /^gw-\d{8}-[0-9a-f]{6}$/.test(sid) && !current && !skipGw) {
      const [d, c] = await Promise.all([gw.get(`/items/${sid}`), gw.get(`/items/${sid}/content`)]);
      if (d.ok) {
        current = d.data;
        if (c.ok && c.data?.item) { tracked = { sid, hash: c.data.contentHash }; await api.loadItem(c.data.item, { contentHash: c.data.contentHash, update: c.data.update, companions: c.data.companions, categories: c.data.categories }); }
        remember(); paint();
        say(current.status === 'returned' ? '這筆內容被退回了，請依意見修改後再送審。' : `已開啟送審中的內容（${current.statusLabel}）。`);
        if (c.data?.update) showUpdate(c.data.update);
        return;
      }
      say(errorText(d), 'red');
    }
    const cid = api.getContentId();
    if (!cid) { current = null; paint(); return; }
    const r = await gw.get(`/items?view=mine&contentId=${encodeURIComponent(cid)}`);
    if (r.ok) { current = r.data.items[0] ?? null; if (current) remember(); paint(); }
    await checkCurrent(cid);
  }

  async function act(kind) {
    const item = api.exportObj();
    const body = { item, ...(current && ['draft', 'returned'].includes(current.status) && current.contentId === item.id ? { submissionId: current.id } : {}) };
    const baseHash = baseHashFor(body);
    if (baseHash) body.baseHash = baseHash;
    btnSave.disabled = true; btnSubmit.disabled = true;
    say(kind === 'save' ? '檢查並儲存中…' : '檢查並送審中…');
    if (api.exportExtra) {
      const extra = await api.exportExtra();
      if (extra?.companions?.length) body.companions = extra.companions;
      if (extra?.categories) body.categories = extra.categories;
      if (extra?.files?.length) { body.files = extra.files; say(`${kind === 'save' ? '檢查並儲存中' : '檢查並送審中'}（含 ${extra.files.length} 個附件）…`); }
    }
    const r = await gw.post(kind === 'save' ? '/drafts' : '/submit', body);
    if (r.ok) {
      current = r.data; remember(); showErrors([]); clear(sync);
      if (current.contentHash) tracked = { sid: current.id, hash: current.contentHash };
      paint(); api.onSaved?.(current);
      say(kind === 'save' ? `已儲存草稿（${fmtTime(current.updatedAt)}）。同單位的同事也看得到這一版。` : current.status === 'published' ? '已上線。' : `已送審，已通知審核人。需要 ${current.requiredApprovals} 位核准。`, 'green');
    } else {
      paint();
      showErrors(r.data?.fields ?? []);
      say(errorText(r), 'red');
      if (r.status === 409 && (r.data?.stale || r.data?.error === 'exists')) { showStale(r.data); say('這一版還沒有存，原因與做法見上方。', 'red'); }
      else if (r.status === 409 && r.data?.open?.submissionId) sync.append(box('warn', el('p', { text: r.data.message }), el('a', { class: 'adm-btn adm-btn--sm', href: gwLink(r.data.open.submissionId), text: '從那一件繼續' })));
      if (r.data?.fields?.length) errBox.focus();
    }
  }
  btnSave.addEventListener('click', () => act('save'));
  btnSubmit.addEventListener('click', () => act('submit'));
  $('#f-id')?.addEventListener('change', () => { current = null; tracked = null; refresh(); });
  $$('#btn-clear').forEach((b) => b.addEventListener('click', () => { current = null; tracked = null; blocked = ''; clear(sync); paint(); }));
  // 第五十二輪：編輯頁換了要改的內容（疫情報導的「選文章」）⇒ 重新找這筆內容的送審件、重新檢查網站版本
  document.addEventListener('adm:gw-target', () => { current = null; tracked = null; refresh({ skipGw: true }); });
  await refresh();
  return gw;
}
