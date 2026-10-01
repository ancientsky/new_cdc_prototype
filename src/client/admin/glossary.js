import { $, $$, esc, readEmbedded, copyText, downloadText, debounce } from './common.js';
const G = readEmbedded('adm-glossary-data', []);
const rows = $$('#g-table tbody tr');
function apply() {
  const q = $('#g-q').value.trim().toLowerCase(), lk = $('#g-locked').checked;
  let n = 0;
  for (const tr of rows) { const ok = (!q || tr.dataset.q.includes(q)) && (!lk || tr.dataset.locked === '1'); tr.hidden = !ok; if (ok) n++; }
  $('#g-count').textContent = `${n} / ${rows.length} 筆`;
}
$('#g-q').addEventListener('input', apply); $('#g-locked').addEventListener('change', apply); apply();

const split = (s) => s.split(/[,，、]/).map((x) => x.trim()).filter(Boolean);
const val = (id) => $(id).value.trim();
function build() {
  const o = { id: val('#n-id') || 'term.', 'zh-TW': val('#n-zh') };
  const al = split(val('#n-aliases')); if (al.length) o.aliases = al;
  for (const l of ['en', 'ja', 'tl', 'vi', 'id', 'th']) { const v = val(`#n-lang-${l}`); if (v) o[l === 'id' ? 'id_' : l] = v; } // 主檔的印尼語欄位是 id_（id 已被詞彙 ID 使用）
  o.domain = $('#n-domain').value; o.locked = $('#n-locked').checked;
  const dep = split(val('#n-dep')); if (dep.length) o.deprecated = dep;
  const refs = split(val('#n-refs')); if (refs.length) o.refs = refs;
  if (val('#n-note')) o.note = val('#n-note');
  return o;
}
function paint() {
  const o = build(), warn = [];
  if (!/^term\.[a-z0-9][a-z0-9.-]*$/.test(o.id)) warn.push('詞彙 ID 需為 term.xxx（小寫英數與連字號）');
  if (!o['zh-TW']) warn.push('請填繁中正名');
  if (G.some((g) => g.id === o.id)) warn.push(`詞彙 ID ${o.id} 已存在`);
  const forms = [o['zh-TW'], ...(o.aliases ?? [])];
  for (const g of G) { const hit = forms.find((f) => f && (g.zh === f || g.aliases.includes(f) || g.deprecated.includes(f))); if (hit) warn.push(`「${hit}」已存在於 ${g.id}（${g.zh}）`); }
  if (o.locked) for (const l of ['en', 'ja', 'tl', 'vi', 'id_', 'th']) if (!o[l]) { warn.push('鎖定詞需要七語譯名齊全，目前缺：' + ['en', 'ja', 'tl', 'vi', 'id_', 'th'].filter((x) => !o[x]).join('、')); break; }
  $('#n-warn').innerHTML = warn.map((w) => `<div class="adm-box adm-box--warn">${esc(w)}</div>`).join('');
  $('#n-out').textContent = JSON.stringify(o, null, 2);
}
$('#g-form').addEventListener('input', debounce(paint, 80));
$('#g-form').addEventListener('change', paint);
$('#n-zh').addEventListener('input', () => { if (!$('#n-id').dataset.touched) { /* ID 需英文，不自動轉換 */ } });
$('#n-id').addEventListener('input', () => { $('#n-id').dataset.touched = '1'; });
$('#n-copy').addEventListener('click', (e) => copyText($('#n-out').textContent, e.currentTarget));
$('#n-dl').addEventListener('click', () => downloadText(`${(build().id || 'term').replace(/[^a-z0-9.-]/g, '_')}.json`, `${$('#n-out').textContent}\n`));
// ?new=詞 → 由上架預處理的「未對應詞」帶入
const nw = new URLSearchParams(location.search).get('new');
if (nw) { $('#n-zh').value = nw; $('#new-term').scrollIntoView(); $('#n-id').focus(); }
paint();
