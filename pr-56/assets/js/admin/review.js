import { $, $$, esc, store, v1, readEmbedded, onUnit, getUnit, unitLabel, url, fmtDT } from './common.js';

const D = readEmbedded('adm-review-data', { items: [], demo: [] });
const TYPE = { disease: '疾病頁', faq: 'Q&A', news: '新聞稿', letter: '致醫界通函', clarification: '澄清', document: '文件', vaccine: '疫苗頁' };
const STEPS = ['承辦人確認預處理', '公關室內容審核', '多語審核', '發布'];
const WHO = ['承辦人', '公關室', '多語審核人', '發布（自動）'];
const LANG = { 'zh-TW': '中', en: 'EN', ja: 'JA', tl: 'TL', vi: 'VI', id: 'ID', th: 'TH' };
const LSTAT = { source: ['正本', 'ok'], reviewed: ['已複核', 'ok'], machine: ['機器翻譯', 'warn'], pending: ['待產生', 'gray'], none: ['不提供', 'gray'] };
const TIER1 = ['disease', 'vaccine', 'clarification', 'situation'];

let all = [];
let editingReturn = null;

async function load() {
  const rows = [...D.items.map((x) => ({ ...x, step: 2, src: 'catalog' }))];
  // 規格：讀 v1/catalog.json 中 status 為 review 的（若 API 有帶 status）
  const cat = await v1('catalog', []);
  for (const c of cat ?? []) if (c.status === 'review' && !rows.some((r) => r.id === c.id)) rows.push({ id: c.id, type: c.type, title: c.title, owner: c.owner, ownerName: c.ownerName, languages: Object.fromEntries((c.languages ?? []).map((l) => [l, 'reviewed'])), step: 2, src: 'catalog' });
  const local = (store.get('cdc.admin.queue', []) ?? []).map((q) => ({ id: q.id, type: q.type, title: q.title, owner: q.owner, ownerName: q.ownerName, languages: q.languages, step: q.step ?? 2, src: 'local', submittedAt: q.submittedAt, reds: q.reds, json: q.json }));
  for (const l of local) { const i = rows.findIndex((r) => r.id === l.id); if (i >= 0) rows[i] = l; else rows.push(l); }
  if (!rows.some((r) => r.src !== 'demo') && D.demo?.length) rows.push(...D.demo.map((d) => ({ ...d, src: 'demo' })));
  all = rows;
}
const acts = () => store.get('cdc.admin.reviewActions', {}) ?? {};
function stateOf(r) {
  const a = acts()[r.id];
  if (!a) return { step: r.step, state: 'pending' };
  return { step: a.step ?? r.step, state: a.state, reason: a.reason, at: a.at };
}
function mini(step, state) {
  return `<span class="adm-ministeps" aria-hidden="true">${[1, 2, 3, 4].map((n) => `<i class="${state === 'published' || n < step ? 'on' : n === step && state === 'pending' ? 'now' : ''}"></i>`).join('')}</span>`;
}
function render() {
  const u = getUnit(), show = $('#rv-state').value;
  const list = all.filter((r) => (u === 'all' || r.owner === u) && (show === 'all' || stateOf(r).state === 'pending'));
  $('#rv-unit').textContent = `· ${unitLabel()}`;
  $('#rv-count').textContent = `${list.length} 筆`;
  $('#rv-empty').hidden = list.length > 0;
  $('#rv-body').innerHTML = list.map((r) => {
    const s = stateOf(r);
    const langs = Object.entries(r.languages ?? {}).map(([k, v]) => { const [t, tone] = LSTAT[v] ?? [v, 'gray']; return `<span class="adm-badge adm-badge--${tone}" title="${esc(k)}：${t}">${LANG[k] ?? k} ${t}</span>`; }).join(' ');
    const rule = TIER1.includes(r.type) ? '一級 · 簽約審核必審' : '二級 · 先發布標示機器翻譯，每月抽審 10%';
    let act;
    if (s.state === 'published') act = `<span class="adm-badge adm-badge--ok">已發布（示範）</span>`;
    else if (s.state === 'returned') act = `<span class="adm-badge adm-badge--bad">已退回</span><div class="adm-muted">${esc(s.reason || '')}</div><button type="button" class="adm-btn adm-btn--ghost adm-btn--sm" data-act="reopen" data-id="${esc(r.id)}">重新送審（示範）</button>`;
    else if (editingReturn === r.id) act = `<div class="adm-field"><label for="rt-${esc(r.id)}" class="adm-muted">退回原因</label><input type="text" id="rt-${esc(r.id)}" class="adm-input" placeholder="例：用語請改為主檔用語"></div><div class="adm-actions" style="margin-top:6px"><button type="button" class="adm-btn adm-btn--danger adm-btn--sm" data-act="return-ok" data-id="${esc(r.id)}">確認退回</button><button type="button" class="adm-btn adm-btn--ghost adm-btn--sm" data-act="cancel">取消</button></div>`;
    else act = `<div class="adm-actions" style="margin:0"><button type="button" class="adm-btn adm-btn--sm" data-act="pass" data-id="${esc(r.id)}">通過${s.step >= 4 ? '並發布' : ''}</button><button type="button" class="adm-btn adm-btn--ghost adm-btn--sm" data-act="return" data-id="${esc(r.id)}">退回</button></div>`;
    return `<tr data-id="${esc(r.id)}"><td>${TYPE[r.type] ?? esc(r.type)}${r.src === 'demo' ? '<div><span class="adm-badge adm-badge--gray">示意</span></div>' : ''}</td>
      <td><strong>${esc(r.title)}</strong><div class="adm-muted"><code>${esc(r.id)}</code>${r.submittedAt ? ` · 送出於 ${fmtDT(r.submittedAt)}` : ''}${r.reds ? ` · <span class="adm-red">一致性紅框 ${r.reds}</span>` : ''}</div></td>
      <td>${esc(r.ownerName ?? r.owner)}</td>
      <td>${mini(s.step, s.state)} <strong>${s.state === 'published' ? '4 發布完成' : `${s.step} ${STEPS[s.step - 1]}`}</strong><div class="adm-muted">目前由：${s.state === 'pending' ? WHO[s.step - 1] : '—'}</div></td>
      <td>${langs || '<span class="adm-muted">—</span>'}<div class="adm-muted">${rule}</div></td><td>${act}</td></tr>`;
  }).join('');
}
$('#rv-body').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-act]'); if (!b) return;
  const id = b.dataset.id, a = acts(), r = all.find((x) => x.id === id);
  const msg = $('#rv-msg');
  if (b.dataset.act === 'pass') {
    const s = stateOf(r); const next = s.step + 1;
    a[id] = next > 4 ? { step: 4, state: 'published', at: new Date().toISOString() } : { step: next, state: 'pending', at: new Date().toISOString() };
    msg.textContent = next > 4 ? `「${r.title}」已通過全部步驟（示範）。正式環境：PR 合併後 CI 自動發布七語頁面、索引與 API。` : `「${r.title}」通過，進入第 ${next} 步「${STEPS[next - 1]}」。`;
  } else if (b.dataset.act === 'return') { editingReturn = id; render(); $(`#rt-${CSS.escape(id)}`)?.focus(); return; }
  else if (b.dataset.act === 'cancel') { editingReturn = null; render(); return; }
  else if (b.dataset.act === 'return-ok') {
    a[id] = { step: stateOf(r).step, state: 'returned', reason: ($(`#rt-${CSS.escape(id)}`)?.value ?? '').trim() || '（未填原因）', at: new Date().toISOString() }; editingReturn = null;
    msg.textContent = `「${r.title}」已退回承辦人修改（示範）。`;
  } else if (b.dataset.act === 'reopen') { delete a[id]; msg.textContent = `「${r.title}」重新送審，回到第 ${r.step} 步。`; }
  store.set('cdc.admin.reviewActions', a);
  document.dispatchEvent(new CustomEvent('adm:queue'));
  render();
});
$('#rv-state').addEventListener('change', render);
onUnit(render);
load().then(render);
void url;
