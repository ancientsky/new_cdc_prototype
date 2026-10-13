// /admin/intl-epidemic/ 國際疫情匯入：只做 DOM 綁定；解析、單則表單 → item、預覽檢查、摘要都在 intl-epidemic-core.js（純函式，有測試）。
// 有閘道（npm run dev 或正式環境）：狀態框改讀 /api/gateway/intl-epidemic/status；送出先試算（dry）給承辦人看「新增／更新／撤下幾則」，確認後才真的上架。
// 沒有閘道（GitHub Pages 靜態站）：送出＝下載交換格式 JSON，交給資訊室用 npm run intl:import 匯入。給同事看的文字不出現版本控制用語。
import { $, store, readEmbedded, downloadText } from './common.js';
import { detectGateway, el, clear, errorText } from './gateway-client.js';
import {
  parseInput,
  itemFromForm,
  previewRows,
  previewSummary,
  buildFeed,
  exportFilename,
  changesText,
  lastRunView,
  fmtTaipei,
  UNMAPPED_KIND,
  SOURCE_LABEL,
  SHAPE_LABEL,
} from './intl-epidemic-core.js';

const D = readEmbedded('adm-intl-data', { today: '', record: { lastRun: null, history: [] }, diseases: [], countries: [] });
const KEY = 'cdc.admin.intl-epidemic';
const CTX = { today: D.today, diseases: D.diseases, countries: D.countries };
let items = Array.isArray(store.get(KEY)?.items) ? store.get(KEY).items : [];
let gw = null;

const save = () => store.set(KEY, { items, savedAt: new Date().toISOString() });
const mode = () => $('input[name="ie-mode"]:checked')?.value ?? 'delta';
const table = (label, head, rows) =>
  el(
    'div',
    { class: 'adm-tablewrap', role: 'region', tabindex: '0', 'aria-label': label },
    el(
      'table',
      { class: 'adm-table' },
      el(
        'thead',
        {},
        el(
          'tr',
          {},
          head.map((h) => el('th', { scope: 'col', text: h })),
        ),
      ),
      el('tbody', {}, rows),
    ),
  );

/* ───────── 狀態框（與模板 lastRunBox／rejectedTable／unmappedTable／historyTable 同內容） ───────── */
function paintStatus(rec) {
  const run = rec?.lastRun ?? null;
  const v = lastRunView(run);
  const last = clear($('#ie-last'));
  if (!v)
    last.append(el('div', { class: 'adm-box adm-box--note' }, el('strong', { text: '還沒有匯入紀錄' }), '第一次排程拉取、推送或手動匯入後，這裡會顯示結果。'));
  else {
    last.append(
      el(
        'div',
        { class: `adm-box ${v.held ? 'adm-box--err' : 'adm-box--ok'}`, 'data-ie-last': true },
        el('strong', { text: `最後一次匯入：${fmtTaipei(v.at)}（台北時間）· ${v.sourceLabel}` }),
        v.producer ? `資料來自：${v.producer}。` : '',
        v.by ? `經手：${v.by}。` : '',
        v.mode ? `方式：${v.mode}。` : '',
        v.held
          ? el('p', {}, el('b', { text: '整批保留不動：' }), `網站沿用上一版清單，這批沒有上架。理由：${v.held.join('；')}`)
          : v.wroteSnapshot
            ? null
            : el('p', { text: '這批與網站現況相同，清單沒有變動。' }),
      ),
      el(
        'div',
        { class: 'adm-statrow' },
        v.stats.map((s) =>
          el(
            'div',
            { class: `adm-stat adm-stat--${s.tone}` },
            el('div', { class: 'adm-stat__label', text: s.label }),
            el('div', { class: 'adm-stat__value', text: s.value }),
          ),
        ),
      ),
    );
  }
  const rej = clear($('#ie-rejected'));
  const rl = run?.rejected ?? [];
  rej.append(
    rl.length
      ? table(
          '退回清單，可捲動',
          ['識別碼', '標題', '原因'],
          rl.map((r) =>
            el(
              'tr',
              {},
              el('td', {}, el('code', { text: r.id ?? `第 ${(r.index ?? 0) + 1} 則（沒有識別碼）` })),
              el('td', { text: r.headline ?? '—' }),
              el('td', { text: (r.errors ?? []).join('；') }),
            ),
          ),
        )
      : el('p', { class: 'adm-muted', text: '最後一次匯入沒有退回的則。' }),
  );
  const un = clear($('#ie-unmapped'));
  const ul = run?.unmapped ?? [];
  if (!ul.length) un.append(el('p', { class: 'adm-muted', text: '疾病與國家都對得上主檔。' }));
  else
    un.append(
      el('p', { class: 'adm-hint', text: '這些則已經上架，只是沒有連到疾病頁或目的地頁。到詞彙主檔或疾病主檔、國家主檔補上別名後，下次匯入會自動對上。' }),
      table(
        '對不上主檔清單，可捲動',
        ['種類', '收到的值', '涉及的則'],
        ul.map((u) =>
          el(
            'tr',
            {},
            el('td', { text: UNMAPPED_KIND[u.kind] ?? u.kind }),
            el('td', {}, el('strong', { text: u.value })),
            el('td', { text: (u.ids ?? []).join('、') }),
          ),
        ),
      ),
    );
  const hist = clear($('#ie-history'));
  const hl = (rec?.history ?? []).slice(0, 30);
  hist.append(
    hl.length
      ? table(
          '匯入歷史，可捲動',
          ['時間（台北）', '來源', '收到', '新增／更新／撤下', '退回', '對不上', '結果'],
          hl.map((h) =>
            el(
              'tr',
              {},
              el('td', { text: fmtTaipei(h.at) }),
              el('td', {}, SOURCE_LABEL[h.source] ?? h.source, h.by ? el('div', { class: 'adm-muted', text: h.by }) : null),
              el('td', { text: h.received ?? 0 }),
              el('td', { text: `${h.counts?.new ?? 0}／${h.counts?.updated ?? 0}／${h.counts?.withdrawn ?? 0}` }),
              el('td', { text: h.counts?.rejected ?? 0 }),
              el('td', { text: h.unmapped ?? 0 }),
              el(
                'td',
                {},
                h.held
                  ? el('span', { class: 'adm-badge adm-badge--bad', text: '整批保留' })
                  : h.wroteSnapshot
                    ? el('span', { class: 'adm-badge adm-badge--ok', text: '已上架' })
                    : el('span', { class: 'adm-badge adm-badge--gray', text: '無變動' }),
              ),
            ),
          ),
        )
      : el('p', { class: 'adm-muted', text: '尚無紀錄。' }),
  );
}

async function refreshStatus() {
  if (!gw?.user) return;
  const r = await gw.get('/intl-epidemic/status');
  if (!r.ok) {
    $('#ie-status-src').textContent = `依建置時的匯入紀錄（${D.today}）。即時紀錄讀不到：${errorText(r)}`;
    return;
  }
  paintStatus(r.data);
  $('#ie-status-src').textContent = `即時：網站系統目前的匯入紀錄（${fmtTaipei(new Date().toISOString())} 讀取）。`;
}

/* ───────── 預覽清單 ───────── */
function paintPreview() {
  const rows = previewRows(items, CTX);
  const tb = clear($('#ie-preview'));
  for (const r of rows) {
    const check = r.errors.length
      ? el(
          'ul',
          { class: 'adm-red' },
          r.errors.map((m) => el('li', { text: m })),
        )
      : el(
          'div',
          {},
          el('span', { class: 'adm-badge adm-badge--ok', text: '可上架' }),
          r.warnings.length
            ? el(
                'ul',
                { class: 'adm-text-warn' },
                r.warnings.map((m) => el('li', { text: m })),
              )
            : null,
        );
    tb.append(
      el(
        'tr',
        { class: r.bad ? 'adm-ie-bad' : null, 'data-bad': r.bad ? 'true' : null },
        el('td', { text: r.index + 1 }),
        el('td', {}, el('code', { text: r.id ?? '—' })),
        el('td', { text: r.publishedAt ?? '—' }),
        el('td', { text: r.headline || '—' }),
        el(
          'td',
          {},
          r.disease || '—',
          r.disease ? el('div', { class: r.diseaseName ? 'adm-muted' : 'adm-text-warn', text: r.diseaseName ? `→ ${r.diseaseName}` : '對不上疾病主檔' }) : null,
        ),
        el(
          'td',
          {},
          r.countries.map((c, k) =>
            el('span', { class: c.mapped || c.global ? null : 'adm-text-warn', text: `${k ? '、' : ''}${c.label}${c.mapped || c.global ? '' : '（對不上）'}` }),
          ),
        ),
        el('td', {}, check),
        el(
          'td',
          {},
          el('button', {
            type: 'button',
            class: 'adm-btn adm-btn--ghost adm-btn--sm',
            'data-del': String(r.index),
            'aria-label': `移除第 ${r.index + 1} 則`,
            text: '移除',
          }),
        ),
      ),
    );
  }
  const s = previewSummary(rows);
  $('#ie-summary').textContent = s.total
    ? `${s.text}。${s.willHold ? '有錯的超過兩成：送出後整批會被保留不動，請先修正或移除有錯的則。' : s.bad ? '有錯的則送出後會被退回，其他照常上架。' : ''}`
    : '清單是空的。';
}
function add(list, msg) {
  items = [...items, ...list];
  save();
  paintPreview();
  if (msg) msg.textContent = `已加入 ${list.length} 則到預覽清單。`;
}

$('#ie-parse').addEventListener('click', async () => {
  const msg = $('#ie-parse-msg');
  const file = $('#ie-file').files?.[0];
  let text = $('#ie-paste').value;
  if (file) {
    if (file.size > 2 * 1024 * 1024) {
      msg.textContent = '檔案超過 2 MB：請分批匯入。';
      return;
    }
    text = await file.text();
  }
  const r = parseInput(text);
  if (r.error) {
    msg.textContent = r.error;
    return;
  }
  if (r.mode) {
    const radio = $(`input[name="ie-mode"][value="${r.mode}"]`);
    if (radio) radio.checked = true;
  }
  add(r.items, msg);
  msg.textContent = `讀到 ${SHAPE_LABEL[r.shape] ?? r.shape}，${r.items.length} 則已加入預覽清單${r.mode ? `；資料本身標示的匯入方式是「${r.mode}」，已幫你選好` : ''}。`;
  $('#ie-paste').value = '';
  $('#ie-file').value = '';
});

$('#ie-add').addEventListener('click', () => {
  const f = {
    id: $('#ie-id').value,
    publishedAt: $('#ie-published').value,
    expiresAt: $('#ie-expires').value,
    disease: $('#ie-disease').value,
    headline: $('#ie-headline').value,
    body: $('#ie-body').value,
    instruction: $('#ie-instruction').value,
    iso2s: [...$('#ie-countries').selectedOptions].map((o) => o.value),
    otherCountries: $('#ie-other').value,
    sourceUrl: $('#ie-source').value,
  };
  const item = itemFromForm(f, { countries: D.countries });
  add([item], $('#ie-form-msg'));
  const bad = previewRows([item], CTX)[0];
  $('#ie-form-msg').textContent = bad.bad ? `已加入，但這一則有錯：${bad.errors.join('；')}` : `已加入預覽清單（識別碼 ${item.id}）。`;
});

$('#ie-preview').addEventListener('click', (e) => {
  const b = e.target.closest?.('[data-del]');
  if (!b) return;
  items = items.filter((_, i) => i !== Number(b.dataset.del));
  save();
  paintPreview();
});
$('#ie-clear').addEventListener('click', () => {
  items = [];
  save();
  paintPreview();
  clear($('#ie-result'));
});

/* ───────── 送出 ───────── */
function resultBox(res, { dry }) {
  const d = res.data ?? {};
  const held = d.held;
  const box = el(
    'div',
    { class: `adm-box ${held ? 'adm-box--err' : dry ? 'adm-box--info' : 'adm-box--ok'}` },
    el('strong', {
      text: dry
        ? held
          ? '試算：這批會被整批保留不動'
          : '試算結果（還沒有上架）'
        : held
          ? '整批保留不動：沒有上架'
          : d.noop
            ? '與網站現況相同，沒有變動'
            : '已上架',
    }),
    el('p', { text: changesText(d) }),
    held ? el('p', { text: `理由：${(d.heldReasons ?? []).join('；')}` }) : null,
    d.rejected?.length
      ? el(
          'ul',
          {},
          d.rejected.map((r) => el('li', { text: `${r.id ?? `第 ${(r.index ?? 0) + 1} 則`}：${(r.errors ?? []).join('；')}` })),
        )
      : null,
    !dry && !held && !d.noop ? el('p', { text: '網站重新建置後（通常幾分鐘內）前台就會看到。' }) : null,
  );
  return box;
}

async function send() {
  const out = clear($('#ie-result'));
  if (!items.length) {
    out.append(el('p', { class: 'adm-muted', text: '預覽清單是空的：先貼上、上傳或逐則填寫。' }));
    return;
  }
  const feed = buildFeed(items, { mode: mode(), producer: '後台手動匯入', now: new Date().toISOString() });
  if (!gw?.user) {
    const name = exportFilename(D.today);
    downloadText(name, `${JSON.stringify(feed, null, 2)}\n`);
    out.append(
      el(
        'div',
        { class: 'adm-box adm-box--note' },
        el('strong', { text: `已下載 ${name}` }),
        `這個環境沒有連上網站系統，無法直接上架。請把檔案交給資訊室，以 npm run intl:import -- ${name} --mode ${mode()} 匯入（同一套檢查）。`,
      ),
    );
    return;
  }
  $('#ie-send').disabled = true;
  try {
    const dry = await gw.post('/intl-epidemic/import', { feed, mode: mode(), dry: true });
    if (!dry.ok && dry.status !== 202) {
      out.append(el('div', { class: 'adm-box adm-box--err' }, el('strong', { text: '無法試算' }), errorText(dry)));
      return;
    }
    out.append(resultBox(dry, { dry: true }));
    if (dry.data?.held) return;
    const go = el('button', { type: 'button', class: 'adm-btn', text: `確認上架（${changesText(dry.data)}）` });
    const cancel = el('button', { type: 'button', class: 'adm-btn adm-btn--ghost', text: '先不要' });
    out.append(el('div', { class: 'adm-actions' }, go, cancel));
    cancel.addEventListener('click', () => clear(out));
    go.addEventListener('click', async () => {
      go.disabled = true;
      const r = await gw.post('/intl-epidemic/import', { feed, mode: mode(), dry: false });
      clear(out);
      if (!r.ok && r.status !== 202) {
        out.append(el('div', { class: 'adm-box adm-box--err' }, el('strong', { text: '上架失敗' }), errorText(r)));
        return;
      }
      out.append(resultBox(r, { dry: false }));
      if (!r.data?.held) {
        items = [];
        save();
        paintPreview();
      }
      refreshStatus();
    });
  } finally {
    $('#ie-send').disabled = false;
  }
}
$('#ie-send').addEventListener('click', send);

paintPreview();
detectGateway().then((g) => {
  gw = g;
  $('#ie-send').textContent = gw?.user ? '送出上架（先試算）' : '送出：下載交換格式檔';
  refreshStatus();
});
