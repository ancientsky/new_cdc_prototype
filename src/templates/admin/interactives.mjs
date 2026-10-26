// /admin/interactives/ 互動與彩蛋（第六十二輪）：每個互動模組一個開關（enabled）、選填檔期、放置位置；顯示為什麼現在有／沒有出現。
// 開關本身是內容 JSON 的一個欄位：這頁產生改好的整筆 JSON（下載／複製），有寫入閘道時直接存檔、送審（快車道，公關室 24 小時內複核）。
import { html } from '../../../scripts/lib/render.mjs';
import { pageHead, adminMeta, dataScript, gatewayPanel } from './_partials.mjs';
import { KINDS, PLACEMENTS, INTERACTIVE_STATUS_LABEL, interactivePath, hasPage } from '../../../scripts/lib/interactives.mjs';
export { layout } from './_layout.mjs';

export function pages() { return [{ path: '/admin/interactives/', props: {}, noindex: true }]; }
export function meta() { return adminMeta('互動與彩蛋', 'interactives', ['/assets/js/admin/interactives.js']); }

/** 建置時加的欄位不送回閘道、也不算進版本碼 */
const clean = (it) => Object.fromEntries(Object.entries(it).filter(([k]) => !k.startsWith('__') && k !== 'gov' && k !== 'sourceHash'));

export function render(ctx) {
  const { site, url } = ctx;
  const all = (site.fullSite ?? site).collections.interactives ?? [];
  const shown = new Set((site.interactives?.list ?? []).map((i) => i.id));
  const st = site.interactives ?? { reason: 'none', alertLevel: 'normal', message: '' };
  const unitName = (id) => site.unitById.get(id)?.name ?? id;
  const live = (id) => { const it = site.byId.get(id); return it && it.status === 'published' && !it.gov?.noindex; };
  const extra = (it) => {
    if (it.kind === 'on-this-day') { const n = (it.entries ?? []).filter((e) => !e.verified).length; return n ? `${n}／${it.entries.length} 條待確認` : `${it.entries.length} 條，全部已核對`; }
    if (it.kind === 'kids-quiz') { const hid = (it.questions ?? []).filter((q) => !live(q.basedOn)).length; return `${it.questions.length} 題${hid ? `，${hid} 題因依據不在線上而隱藏` : ''}`; }
    if (it.kind === 'policy-sim') return `${it.scenario?.rounds?.length ?? 0} 回合、${it.scenario?.meters?.length ?? 0} 個量表`;
    if (it.kind === 'easter-egg') return `觸發：${(it.egg?.triggers ?? []).map((t) => (t === 'brand-taps' ? `連點站名圖示 ${it.egg.taps ?? 5} 下` : `輸入 ${it.egg.keys ?? '1922'}`)).join('、')}`;
    return '';
  };
  const data = {
    today: site.today, alertLevel: st.alertLevel, reason: st.reason, kinds: KINDS, placements: PLACEMENTS, statusLabel: INTERACTIVE_STATUS_LABEL,
    items: all.map((it) => ({ item: clean(it), status: it.gov?.interactiveStatus ?? 'draft', shown: shown.has(it.id), unitName: unitName(it.owner), extra: extra(it), path: hasPage(it) ? interactivePath(it) : '/' })),
  };
  return html`
${pageHead({ title: '互動與彩蛋', what: '網站的彩蛋與互動模組——歷史上的今天、兒童衛教小測驗、防疫決策模擬、首頁彩蛋——每一個都是一筆內容，有自己的開關、檔期與權責單位。這頁看目前哪些在線上、為什麼，並切換開關。', flow: '切換開關或改檔期 → 儲存／送審（快車道：檢查通過即上線，公關室 24 小時內複核）。沒有寫入閘道時下載 JSON 覆蓋 content/interactives/<slug>.json 開 PR。疫情中心發布 alertLevel=emergency 時全部自動隱藏，不必在這裡一個個關。' })}
${dataScript('adm-ix-data', data)}
<div class="adm-box ${st.reason === 'emergency' ? 'adm-box--err' : st.reason === 'active' ? 'adm-box--ok' : 'adm-box--note'}"><strong>${st.reason === 'emergency' ? '全站緊急警戒：互動模組全部隱藏' : st.reason === 'active' ? `目前顯示 ${shown.size} 個模組` : '目前沒有顯示中的模組'}</strong>${st.message}。全站警戒等級 <code>${st.alertLevel}</code>（<a href="${url('/admin/situation/', { noLang: true })}">疫情發布</a>）。</div>
<section class="adm-card" aria-labelledby="ix-list-h"><h2 id="ix-list-h">模組清單</h2>
<div class="adm-tablewrap" role="region" tabindex="0" aria-label="表格，可捲動"><table class="adm-table"><caption>content/interactives/：${all.length} 筆。狀態＝開關與檔期；「顯示中」另看全站警戒。</caption>
<thead><tr><th>模組</th><th>種類</th><th>權責單位</th><th>狀態</th><th>放置位置</th><th>檔期</th><th>內容</th><th>前台</th></tr></thead>
<tbody>${all.map((it) => html`<tr data-ix-row="${it.id}">
  <td><strong>${it.title}</strong><br><code>${it.id}</code></td>
  <td>${KINDS[it.kind]?.label ?? it.kind}</td>
  <td>${unitName(it.owner)}</td>
  <td><span class="adm-badge adm-badge--${shown.has(it.id) ? 'ok' : it.gov?.interactiveStatus === 'on' ? 'warn' : 'gray'}" data-ix-status>${INTERACTIVE_STATUS_LABEL[it.gov?.interactiveStatus] ?? it.gov?.interactiveStatus}${shown.has(it.id) ? '・顯示中' : it.gov?.interactiveStatus === 'on' ? '・被全站警戒隱藏' : ''}</span></td>
  <td>${(it.placements ?? []).map((p) => PLACEMENTS[p] ?? p).join('、')}</td>
  <td>${it.publishAt || it.unpublishAt ? `${it.publishAt ?? '—'} ～ ${it.unpublishAt ?? '—'}` : '不限'}</td>
  <td>${extra(it)}</td>
  <td>${hasPage(it) ? html`<a href="${url(interactivePath(it), { noLang: true })}">開頁面 ↗</a>` : html`<a href="${url('/', { noLang: true })}">首頁 ↗</a>`}</td>
</tr>`)}</tbody></table></div>
</section>
<div class="adm-split">
<section class="adm-card" aria-labelledby="ix-form-h"><h2 id="ix-form-h">開關與檔期</h2>
  <form id="ix-form" class="adm-form" novalidate>
    <div class="adm-field"><label for="ix-pick">要改哪一個模組</label><select id="ix-pick">${all.map((it) => html`<option value="${it.id}">${it.title}</option>`)}</select></div>
    <div class="adm-bigswitch" id="ix-switch"><div><p class="adm-bigswitch__state" id="ix-state" role="status" aria-live="polite"></p><p class="adm-muted" id="ix-detail" style="margin:0"></p></div>
      <label class="adm-pill" style="margin-left:auto"><input type="checkbox" id="ix-enabled"><span>開啟（enabled）</span></label></div>
    <div class="adm-grid adm-grid--2" style="margin-top:var(--sp-4)"><div class="adm-field"><label for="ix-from">檔期開始（選填）</label><input type="date" id="ix-from"><span class="adm-hint">含當日 00:00（台灣時間）。空白＝不限。</span></div>
      <div class="adm-field"><label for="ix-to">檔期結束（選填）</label><input type="date" id="ix-to"><span class="adm-hint">到這天 00:00 起不顯示；要整天都有就填隔天。</span></div></div>
    <fieldset class="adm-fieldset"><legend>放置位置</legend><div class="adm-pills" id="ix-placements"></div><p class="adm-hint">每種模組只能放在它允許的位置（例：歷史上的今天只能在首頁右側欄與 /play/；彩蛋只在站名圖示）。</p></fieldset>
    <div class="adm-field"><label for="ix-disclaimer">模組下方的一句說明（選填）</label><input type="text" id="ix-disclaimer" maxlength="200"></div>
    <div class="adm-actions"><button type="button" class="adm-btn adm-btn--ghost" id="ix-reset">以目前內容重填</button><button type="button" class="adm-btn adm-btn--ghost" id="ix-copy">複製 JSON</button><button type="button" class="adm-btn" id="ix-dl">下載 JSON</button></div>
    <p class="adm-muted" id="ix-msg" role="status" aria-live="polite"></p>
  </form>
  ${gatewayPanel('儲存草稿＝只有你看得到；送審＝走快車道，機器檢查通過即上線，公關室 24 小時內複核。改的只有開關、檔期、位置與說明；條目、題目與情境請在內容檔改。')}
</section>
<section class="adm-card" aria-labelledby="ix-out-h"><h2 id="ix-out-h">改好的內容 JSON</h2>
  <p class="adm-card__sub">覆蓋 <code id="ix-file">content/interactives/…json</code>；其他欄位原樣保留。</p>
  <div id="ix-warn"></div>
  <pre class="adm-pre" id="ix-out" tabindex="0">{ }</pre>
  <details class="adm-details" style="margin-top:var(--sp-3)"><summary>規則摘要（給同事）</summary><ul class="adm-list">
    <li>開關關掉＝前台立刻不顯示（下次建置），內容不必下架；再開就回來。</li>
    <li>檔期用真實時間判斷，到期自動不顯示，不必有人去關；主站每 2 小時重建，最多晚 2 小時。</li>
    <li>疫情中心發布 <code>alertLevel=emergency</code> 時，所有模組一起隱藏（疫情嚴峻時網站不該在玩）。</li>
    <li>歷史條目每一條都有出處；<code>verified:false</code> 前台標「待確認」。核對完請改 <code>verified:true</code> 並填 <code>verifiedBy</code>。</li>
    <li>測驗題與模擬選項綁站內疾病頁／Q&A；依據下架或過期時那一題自動隱藏。</li>
  </ul></details>
</section>
</div>`;
}
