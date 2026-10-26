// /admin/interactives/（第六十二輪）：互動模組的開關、檔期、放置位置、說明。
// 做法與其他編輯頁相同：頁面嵌入建置時的內容（adm-ix-data），表單只改四個欄位，其餘原樣保留；
// 輸出整筆 JSON（下載／複製），有寫入閘道時交給 publish-gateway.js 存檔、送審（版本碼 contentVersion，衝突時載入最新版）。
import { $, $$, esc, copyText, downloadText } from './common.js';
import { initPublishGateway } from './publish-gateway.js';
import { contentVersion } from './content-version.js';

const D = JSON.parse(document.getElementById('adm-ix-data')?.textContent ?? '{}');
const rows = D.items ?? [];
let cur = rows[0] ?? null; // { item, status, shown, unitName, extra, path }
let orig = cur ? structuredClone(cur.item) : null; // 開啟時的版本（版本碼用）
let savedVersion = null; // { id, hash }：這頁上次經閘道存好的版本

const pick = $('#ix-pick');
const slugOf = (id) => String(id ?? '').replace(/^interactive\./, '');

function fill() {
  if (!cur) return;
  const it = cur.item;
  $('#ix-enabled').checked = it.enabled === true;
  $('#ix-from').value = it.publishAt ?? '';
  $('#ix-to').value = it.unpublishAt ?? '';
  $('#ix-disclaimer').value = it.disclaimer ?? '';
  const allowed = D.kinds?.[it.kind]?.placements ?? [];
  $('#ix-placements').innerHTML = allowed.map((p) => `<label class="adm-pill"><input type="checkbox" name="ix-pl" value="${esc(p)}" ${(it.placements ?? []).includes(p) ? 'checked' : ''}><span>${esc(D.placements?.[p] ?? p)}</span></label>`).join('');
  $('#ix-file').textContent = `content/interactives/${slugOf(it.id)}.json`;
  paint();
}

/** 表單 → 整筆內容（只改四個欄位，其餘原樣） */
function exported() {
  const it = structuredClone(cur.item);
  it.enabled = $('#ix-enabled').checked;
  const from = $('#ix-from').value, to = $('#ix-to').value;
  if (from) it.publishAt = from; else delete it.publishAt;
  if (to) it.unpublishAt = to; else delete it.unpublishAt;
  const pl = $$('input[name="ix-pl"]:checked').map((x) => x.value);
  it.placements = pl;
  const dis = $('#ix-disclaimer').value.trim();
  if (dis) it.disclaimer = dis; else delete it.disclaimer;
  return it;
}

function problems(it) {
  const w = [];
  if (!it.placements?.length) w.push('沒有勾任何放置位置：開著也不會出現在任何地方');
  if (it.publishAt && it.unpublishAt && it.unpublishAt <= it.publishAt) w.push('檔期結束必須晚於開始');
  if (it.unpublishAt && it.unpublishAt <= D.today) w.push(`檔期結束（${it.unpublishAt}）已過：即使開著也不會顯示`);
  if (it.enabled && D.alertLevel === 'emergency') w.push('全站警戒等級為 emergency：開著也會被整批隱藏，等疫情中心解除才顯示');
  return w;
}

function paint() {
  const it = exported();
  const on = it.enabled;
  const box = $('#ix-switch');
  box.classList.toggle('adm-bigswitch--paused', !on);
  const upcoming = it.publishAt && it.publishAt > D.today, ended = it.unpublishAt && it.unpublishAt <= D.today;
  $('#ix-state').textContent = `${it.title}：${!on ? '已關閉' : upcoming ? `開啟，${it.publishAt} 起顯示` : ended ? '開啟，但檔期已結束' : '開啟中'}`;
  $('#ix-detail').textContent = `${D.kinds?.[it.kind]?.label ?? it.kind}・${cur.unitName}・${cur.extra}${cur.shown ? '・建置時顯示中' : ''}`;
  const w = problems(it);
  $('#ix-warn').innerHTML = w.length ? `<div class="adm-box adm-box--warn"><strong>請注意</strong><ul class="adm-list">${w.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : '';
  $('#ix-out').textContent = JSON.stringify(it, null, 2);
}

pick.innerHTML = rows.map((r) => `<option value="${esc(r.item.id)}">${esc(r.item.title)}（${esc(D.statusLabel?.[r.status] ?? r.status)}）</option>`).join('');
pick.addEventListener('change', () => { cur = rows.find((r) => r.item.id === pick.value) ?? cur; orig = structuredClone(cur.item); savedVersion = null; fill(); document.dispatchEvent(new CustomEvent('adm:gw-target')); });
$('#ix-form').addEventListener('input', paint);
$('#ix-form').addEventListener('change', paint);
$('#ix-reset').addEventListener('click', () => { fill(); $('#ix-msg').textContent = '已以目前內容重填。'; });
$('#ix-copy').addEventListener('click', (e) => copyText(`${$('#ix-out').textContent}\n`, e.currentTarget));
$('#ix-dl').addEventListener('click', () => downloadText(`${slugOf(cur.item.id)}.json`, `${$('#ix-out').textContent}\n`));
fill();

/** 閘道回「網站上有更新的版本」：以最新版為底，重新套上這頁改的四個欄位（都是單值，直接以我的為準並列出差異） */
function reloadLatest(latest) {
  const mine = exported();
  const theirs = [], conflicts = [];
  for (const k of ['enabled', 'publishAt', 'unpublishAt', 'placements', 'disclaimer']) {
    const a = JSON.stringify(orig?.[k]), b = JSON.stringify(latest?.[k]), m = JSON.stringify(mine[k]);
    if (a !== b && m === a) theirs.push(k); // 我沒改、別人改了 → 用最新版
    else if (a !== b && m !== a) conflicts.push({ label: k, yours: m ?? '（空白）' }); // 兩邊都改 → 保留我的，列出來
  }
  const next = structuredClone(latest);
  for (const k of ['enabled', 'publishAt', 'unpublishAt', 'placements', 'disclaimer']) {
    if (theirs.includes(k)) continue;
    if (mine[k] === undefined) delete next[k]; else next[k] = mine[k];
  }
  cur = { ...cur, item: next };
  orig = structuredClone(latest);
  fill();
  return { theirs, mine: Object.keys(mine).filter((k) => JSON.stringify(mine[k]) !== JSON.stringify(orig[k])), conflicts };
}

initPublishGateway({
  exportObj: () => exported(),
  getContentId: () => cur?.item?.id ?? '',
  loadItem: (item, meta = {}) => { if (item?.id) { cur = { ...(rows.find((r) => r.item.id === item.id) ?? cur), item }; orig = structuredClone(item); if (meta.contentHash) savedVersion = { id: item.id, hash: meta.contentHash }; fill(); } },
  fieldInput: { enabled: '#ix-enabled', publishAt: '#ix-from', unpublishAt: '#ix-to', placements: '#ix-placements', disclaimer: '#ix-disclaimer' },
  getBaseHash: () => (savedVersion?.id === cur?.item?.id ? savedVersion.hash : contentVersion(orig)),
  getEditTarget: () => (cur ? { id: cur.item.id, type: 'interactive', version: contentVersion(orig) } : null),
  reloadLatest,
  downloadName: () => `${slugOf(cur?.item?.id)}.json`,
  onSaved: (sub) => { if (sub?.contentHash) savedVersion = { id: sub.contentId, hash: sub.contentHash }; $('#ix-msg').textContent = sub?.status === 'published' ? '已上線（下次建置生效）。' : '已存到閘道。'; },
});
window.__admInteractives = { exported, reloadLatest, get cur() { return cur; } }; // 供自動化測試
