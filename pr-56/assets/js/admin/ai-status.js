import { $, esc, store, readEmbedded, copyText, downloadText, unitLabel } from './common.js';
const D = readEmbedded('adm-ai-data', { base: {} });
const KEY = 'cdc.aiStatusOverride';
const ov = () => { const o = store.get(KEY); return o && typeof o.paused === 'boolean' ? o : null; };
const effective = () => { const o = ov(); return o ? { ...D.base, ...o } : { ...D.base }; };
const unitName = (id) => $(`#as-unit option[value="${CSS.escape(id)}"]`)?.textContent ?? id;
function paint() {
  const e = effective(), o = ov();
  const box = $('#as-state');
  box.classList.toggle('adm-bigswitch--paused', !!e.paused);
  $('#as-label').textContent = e.paused ? 'AI 問答：暫停中（已切回傳統搜尋）' : 'AI 問答：運作中';
  $('#as-detail').textContent = e.paused ? `原因：${e.reason || '—'}` : `模式：${D.base.mode === 'llm' ? 'LLM' : '抽取式'}${D.base.beta ? '（Beta）' : ''}；每句答案附來源編號`;
  $('#as-override-text').textContent = o ? `${o.paused ? '暫停' : '恢復'}；原因：${o.reason || '—'}；${new Date(o.updatedAt).toLocaleString('zh-TW', { hour12: false })}；${unitName(o.updatedBy)}` : '無（使用建置版本）';
  $('#as-pause').disabled = !!e.paused; $('#as-resume').disabled = !e.paused;
  const out = { paused: !!e.paused, reason: e.paused ? (e.reason ?? '') : '', updatedAt: (o ?? D.base).updatedAt, updatedBy: (o ?? D.base).updatedBy, ...(D.base.mode ? { mode: D.base.mode } : {}), ...(D.base.beta != null ? { beta: D.base.beta } : {}), ...(D.base.fallback ? { fallback: D.base.fallback } : {}) };
  $('#as-out').textContent = JSON.stringify(out, null, 2);
}
function set(paused) {
  const reason = $('#as-reason').value.trim(), msg = $('#as-msg');
  if (paused && !reason) { msg.innerHTML = '<div class="adm-box adm-box--err"><strong>請先填寫暫停原因</strong>原因會顯示在前台橫幅並寫入稽核紀錄。</div>'; $('#as-reason').focus(); return; }
  const rec = { paused, reason: paused ? reason : (reason || '已恢復'), updatedAt: new Date().toISOString(), updatedBy: $('#as-unit').value };
  store.set(KEY, rec);
  // 相容：答案頁目前讀的是 cdc.aiStatus（{paused, reason, until}）；兩個 key 同步寫入
  store.set('cdc.aiStatus', { paused, reason: rec.reason, until: null, updatedAt: rec.updatedAt, updatedBy: rec.updatedBy });
  msg.innerHTML = `<div class="adm-box adm-box--ok"><strong>${paused ? '已暫停 AI 問答' : '已恢復 AI 問答'}</strong>${paused ? '答案頁已改為傳統搜尋列表。' : '答案頁恢復產生答案句。'}（原型即時生效；正式環境 ≤ 15 分鐘）</div>`;
  paint();
}
$('#as-pause').addEventListener('click', () => set(true));
$('#as-resume').addEventListener('click', () => set(false));
$('#as-clear').addEventListener('click', () => { store.del(KEY); store.del('cdc.aiStatus'); $('#as-msg').innerHTML = '<div class="adm-box adm-box--note"><strong>已清除本機覆寫</strong>回到建置版本。</div>'; paint(); });
$('#as-copy').addEventListener('click', (e) => copyText(`${$('#as-out').textContent}\n`, e.currentTarget));
$('#as-dl').addEventListener('click', () => downloadText('ai-status.json', `${$('#as-out').textContent}\n`));
$('#as-unit').value = D.defaultUnit && $('#as-unit option[value="unit.oasis"]') ? 'unit.oasis' : $('#as-unit').value;
paint();
void esc; void unitLabel;
