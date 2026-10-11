// /admin/ask-log/ 查詢紀錄報表（第四十一輪；docs/ask-log.md）。
// 先試開發伺服器的 /api/dev/ask-log/report（只有 npm run dev 在本機才有）；沒有就請同仁載入 npm run ask-log:report 產生的 report.json。
// 報表裡的問句是民眾輸入（已遮蔽），一律 esc() 後才放進畫面；檔案只讀進記憶體，不存 localStorage、不上傳。
import { $, esc, url } from './common.js';

const OUTCOME = { answered: '有答案', 'low-relevance': '低相關', stats: '統計', 'no-match': '查無', 'no-source': '依據不足', refused: '拒答', paused: '暫停' };
const HOW = { exact: '主檔已有', prefix: '前綴', suffix: '後綴', substring: '包含', edit: '拼字相近', token: '句中詞' };
let report = null;
let fromFile = false;

const kv = (o) =>
  Object.entries(o ?? {})
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${esc(OUTCOME[k] ?? k)} ${v}`)
    .join('、');
const cands = (list) =>
  list?.length
    ? list
        .map(
          (c) =>
            `<div><strong>${esc(c.canon)}</strong> <span class="adm-muted">← ${esc(c.matched)}（${esc(HOW[c.how] ?? c.how)}；<code>${esc(c.id)}</code>）</span></div>`,
        )
        .join('')
    : '<span class="adm-muted">—</span>';
/** 「加入詞彙主檔」：帶 alias（民眾用語）與 canon（候選正名）到詞彙主檔的新增表單；主檔已有的不給按鈕 */
function addLink(row) {
  const c = row.candidates?.[0];
  if (c?.how === 'exact') return '<span class="adm-muted">主檔已有，轉資訊室看引擎</span>';
  const sp = new URLSearchParams({ alias: row.q });
  if (c) sp.set('canon', c.canon);
  return `<a class="adm-btn adm-btn--sm adm-btn--ghost" href="${esc(url(`/admin/glossary/?${sp}#new-term`))}">加入詞彙主檔</a>`;
}
const qCell = (r) =>
  `<td><strong>${esc(r.q)}</strong><div class="adm-muted">${r.days} 天 · 最近 ${esc(String(r.lastSeen ?? '').slice(0, 10))}${r.intent ? ` · 意圖 ${esc(r.intent)}` : ''}</div></td>`;

function fill(id, rows, rowHtml) {
  $(`#${id}`).innerHTML = rows.map(rowHtml).join('');
  $(`#${id}-empty`).hidden = rows.length > 0;
  $(`#${id}-empty`).textContent = report ? '沒有達到門檻的問句。' : '尚無資料。';
}

function render() {
  if (!report) return;
  const K = Math.max(Number($('#al-min').value) || 0, fromFile ? report.minCount : 0);
  const pass = (r) => !K || r.days >= K || r.count >= K;
  const t = report.totals ?? {};
  const by = t.byOutcome ?? {};
  const un = (by['no-match'] ?? 0) + (by['no-source'] ?? 0);
  const pct = (x) => (t.events ? `${Math.round((x / t.events) * 1000) / 10}%` : '—');
  const tile = (label, value, note, tone = '') =>
    `<div class="adm-stat ${tone ? `adm-stat--${tone}` : ''}"><p class="adm-stat__label">${esc(label)}</p><p class="adm-stat__value">${esc(value)}</p><p class="adm-stat__note">${esc(note)}</p></div>`;
  $('#al-stats').innerHTML = [
    tile('提問筆數', t.events ?? 0, `${report.range?.from ?? '—'} ～ ${report.range?.to ?? '—'}（${report.range?.days ?? 0} 天）`, 'info'),
    tile('答不出來', un, `${pct(un)}（查無 ${by['no-match'] ?? 0}、依據不足 ${by['no-source'] ?? 0}）`, un ? 'warn' : 'ok'),
    tile('低相關', by['low-relevance'] ?? 0, pct(by['low-relevance'] ?? 0)),
    tile('未達門檻', t.hiddenQueries ?? 0, `種問句（${t.hiddenEvents ?? 0} 筆）只計數、不顯示文字；門檻 K＝${report.minCount}`),
  ].join('');
  $('#al-stats').hidden = false;
  fill(
    'al-un',
    (report.unanswered ?? []).filter(pass),
    (r) =>
      `<tr>${qCell(r)}<td>${r.unanswered}<div class="adm-muted">共 ${r.count}</div></td><td>${kv(r.outcomes)}</td><td>${kv(r.langs)}</td><td>${cands(r.candidates)}</td><td>${addLink(r)}</td></tr>`,
  );
  fill(
    'al-low',
    (report.lowRelevance ?? []).filter(pass),
    (r) => `<tr>${qCell(r)}<td>${r.lowRelevance}</td><td>${kv(r.langs)}</td><td>${cands(r.candidates)}</td><td>${addLink(r)}</td></tr>`,
  );
  fill(
    'al-ok',
    (report.answered ?? []).filter(pass),
    (r) =>
      `<tr>${qCell(r)}<td>${r.answered}</td><td>${kv(r.langs)}</td><td>${(r.top ?? []).map((x) => `<code>${esc(x)}</code>`).join(' ') || '<span class="adm-muted">—</span>'}</td></tr>`,
  );
}

function use(r, source) {
  if (!r || r.v !== 1 || !r.totals) throw new Error('不是查詢紀錄報表（缺 v:1 或 totals）');
  report = r;
  $('#al-source-text').textContent = source;
  render();
}

async function loadDev() {
  $('#al-status').textContent = '讀取中…';
  const min = $('#al-min').value;
  try {
    const res = await fetch(url(`/api/dev/ask-log/report${min ? `?min=${encodeURIComponent(min)}` : ''}`), { cache: 'no-store', credentials: 'same-origin' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    fromFile = false;
    use(await res.json(), `開發伺服器的模擬後端（.local/ask-log/，產生於 ${new Date().toLocaleString('zh-TW', { hour12: false })}）`);
    $('#al-status').textContent = '已讀取';
  } catch {
    $('#al-status').textContent = '';
    if (!report)
      $('#al-source-text').textContent =
        '這裡沒有查詢紀錄後端（GitHub Pages 原型站與正式站都不會在網頁上直接提供紀錄）。請用 npm run ask-log:report 產生 report.json（正式環境由收件系統匯出），再按「載入 report.json」。在本機 npm run dev 時，這頁會自動讀取。';
  }
}

$('#al-reload').addEventListener('click', loadDev);
$('#al-min').addEventListener('change', () => (fromFile ? render() : loadDev()));
$('#al-file').addEventListener('change', async (e) => {
  const f = e.target.files?.[0];
  if (!f) return;
  try {
    const r = JSON.parse(await f.text());
    fromFile = true;
    use(r, `檔案 ${f.name}（產生於 ${r.generatedAt ?? '—'}；只在這個分頁的記憶體裡）`);
    $('#al-status').textContent = '已載入';
  } catch (err) {
    $('#al-status').textContent = `無法讀取：${err.message}`;
  }
});
loadDev();
