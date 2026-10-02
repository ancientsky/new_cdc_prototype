// /admin/links/ 外部連結健康：篩選、匯出 CSV、（若有）以 /v1/governance/links.json 覆蓋狀態與檢查日。
import { $, $$, followUnit, v1, toCSV, downloadText, today } from './common.js';

const rows = $$('#l-table tbody tr');
const BADGE = { ok: ['adm-badge--ok', 'ok 正常'], broken: ['adm-badge--bad', 'broken 失效'], unchecked: ['adm-badge--gray', 'unchecked 未檢查'] };

function apply() {
  const q = $('#l-q').value.trim().toLowerCase(), st = $('#l-state').value, ty = $('#l-type').value, u = $('#l-unit').value;
  let n = 0;
  for (const tr of rows) {
    const d = tr.dataset;
    const ok = (!q || d.q.includes(q)) && (!st || d.state === st) && (!ty || d.type === ty) && (u === 'all' || d.owner === u);
    tr.hidden = !ok; if (ok) n++;
  }
  $('#l-note').textContent = rows.length ? `${n} / ${rows.length} 條` : '';
}
function counts() {
  const c = { ok: 0, broken: 0, unchecked: 0 };
  for (const tr of rows) c[tr.dataset.state] = (c[tr.dataset.state] ?? 0) + 1;
  $('#l-total').textContent = rows.length; $('#l-ok').textContent = c.ok; $('#l-broken').textContent = c.broken; $('#l-unchecked').textContent = c.unchecked;
}
['#l-q', '#l-state', '#l-type'].forEach((s) => $(s).addEventListener('input', apply));
followUnit($('#l-unit'), apply);
$('#l-csv').addEventListener('click', () => {
  const head = ['來源內容', '欄位', '連結標籤', '網址', '最後檢查', '狀態'];
  const data = rows.filter((r) => !r.hidden).map((tr) => [`${$('a', tr).textContent} (${$('code', tr).textContent})`, ...$$('td', tr).slice(1, 3).map((td) => td.textContent.trim()), tr.dataset.href, $('[data-checked]', tr).textContent.trim(), tr.dataset.state]);
  downloadText(`cdc-external-links-${today()}.csv`, toCSV([head, ...data]), 'text/csv');
});

// 若治理引擎有輸出 links.json（CI 每日檢查結果），以它為準（容錯：格式不符就忽略）
(async () => {
  // 先看 /v1/index.json 有沒有登記這個端點，避免對不存在的檔案發出 404 請求
  const idx = await v1('index', []);
  const j = Array.isArray(idx) && idx.some((e) => e.path === '/v1/governance/links.json') ? await v1('governance/links', null) : null;
  const list = Array.isArray(j) ? j : Array.isArray(j?.links) ? j.links : Array.isArray(j?.items) ? j.items : null;
  if (list?.length) {
    const by = new Map(list.map((x) => [x.href ?? x.url, x]));
    for (const tr of rows) {
      const x = by.get(tr.dataset.href); if (!x || !BADGE[x.status]) continue;
      tr.dataset.state = x.status;
      $('[data-status]', tr).innerHTML = `<span class="adm-badge ${BADGE[x.status][0]}">${BADGE[x.status][1]}</span>`;
      const d = x.lastCheckedAt ?? x.checkedAt; if (d) $('[data-checked]', tr).textContent = d;
    }
    counts();
  }
  apply();
})();
