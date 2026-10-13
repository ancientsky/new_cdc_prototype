// /admin/intl-epidemic/ 國際疫情匯入（第四十三輪，docs/intl-epidemic.md 第 4、6 節）：
// 上方看「最後一次匯入」與退回／對不上清單（建置時的 data/snapshots/intl-epidemic-import.json；有閘道時瀏覽器再以 /api/gateway/intl-epidemic/status 覆蓋），
// 下方是備援用的手動匯入（貼上／上傳 JSON 或 CSV、單則表單 → 預覽 → 送出；沒有閘道就下載交換格式 JSON 交給資訊室）。
// 純邏輯在 src/client/admin/intl-epidemic-core.js（與模板共用 lastRunView），DOM 在 src/client/admin/intl-epidemic.js。
import { html } from '../../../scripts/lib/render.mjs';
import { pageHead, adminMeta, dataScript } from './_partials.mjs';
import { alertPageRows } from '../../../scripts/lib/travel-alerts.mjs';
import { lastRunView, fmtTaipei, UNMAPPED_KIND, MODE_LABEL, MODE_HELP, SOURCE_LABEL } from '../../client/admin/intl-epidemic-core.js';
export { layout } from './_layout.mjs';

export function pages() {
  return [{ path: '/admin/intl-epidemic/', props: {}, noindex: true }];
}
export function meta() {
  return adminMeta(
    '國際疫情匯入',
    'intl-epidemic',
    ['/assets/js/admin/intl-epidemic.js'],
    '國際重要疫情資訊的匯入狀態、退回與對不上主檔清單，以及備援用的手動匯入',
  );
}

const RECENT = 30;

/** 最後一次匯入（模板與 intl-epidemic.js 畫同一份 lastRunView） */
export function lastRunBox(run) {
  const v = lastRunView(run);
  if (!v) return html`<div class="adm-box adm-box--note"><strong>還沒有匯入紀錄</strong>第一次排程拉取、推送或手動匯入後，這裡會顯示結果。</div>`;
  return html`<div class="adm-box ${v.held ? 'adm-box--err' : 'adm-box--ok'}" data-ie-last>
      <strong>最後一次匯入：${fmtTaipei(v.at)}（台北時間）· ${v.sourceLabel}</strong>
      ${v.producer ? html`資料來自：${v.producer}。` : ''}${v.by ? html`經手：${v.by}。` : ''}${v.mode ? html`方式：${v.mode}。` : ''}
      ${v.held ? html`<p><b>整批保留不動：</b>網站沿用上一版清單，這批沒有上架。理由：${v.held.join('；')}</p>` : v.wroteSnapshot ? '' : html`<p>這批與網站現況相同，清單沒有變動。</p>`}
    </div>
    <div class="adm-statrow">
      ${v.stats.map(
        (s) =>
          html`<div class="adm-stat adm-stat--${s.tone}">
            <div class="adm-stat__label">${s.label}</div>
            <div class="adm-stat__value">${s.value}</div>
          </div>`,
      )}
    </div>`;
}

export function rejectedTable(run) {
  const list = run?.rejected ?? [];
  if (!list.length) return html`<p class="adm-muted">最後一次匯入沒有退回的則。</p>`;
  return html`<div class="adm-tablewrap" role="region" tabindex="0" aria-label="退回清單，可捲動">
    <table class="adm-table">
      <thead>
        <tr>
          <th scope="col">識別碼</th>
          <th scope="col">標題</th>
          <th scope="col">原因</th>
        </tr>
      </thead>
      <tbody>
        ${list.map(
          (r) =>
            html`<tr>
              <td><code>${r.id ?? `第 ${(r.index ?? 0) + 1} 則（沒有識別碼）`}</code></td>
              <td>${r.headline ?? '—'}</td>
              <td>${(r.errors ?? []).join('；')}</td>
            </tr>`,
        )}
      </tbody>
    </table>
  </div>`;
}

export function unmappedTable(run, { glossaryHref = '/admin/glossary/' } = {}) {
  const list = run?.unmapped ?? [];
  if (!list.length) return html`<p class="adm-muted">疾病與國家都對得上主檔。</p>`;
  return html`<p class="adm-hint">
      這些則已經上架，只是沒有連到疾病頁或目的地頁。到<a href="${glossaryHref}">詞彙主檔</a>或疾病主檔、國家主檔補上別名後，下次匯入會自動對上。
    </p>
    <div class="adm-tablewrap" role="region" tabindex="0" aria-label="對不上主檔清單，可捲動">
      <table class="adm-table">
        <thead>
          <tr>
            <th scope="col">種類</th>
            <th scope="col">收到的值</th>
            <th scope="col">涉及的則</th>
          </tr>
        </thead>
        <tbody>
          ${list.map(
            (u) =>
              html`<tr>
                <td>${UNMAPPED_KIND[u.kind] ?? u.kind}</td>
                <td><strong>${u.value}</strong></td>
                <td>${(u.ids ?? []).map((id, k) => html`${k ? '、' : ''}<code>${id}</code>`)}</td>
              </tr>`,
          )}
        </tbody>
      </table>
    </div>`;
}

export function historyTable(history) {
  const list = (history ?? []).slice(0, 30);
  if (!list.length) return html`<p class="adm-muted">尚無紀錄。</p>`;
  return html`<div class="adm-tablewrap" role="region" tabindex="0" aria-label="匯入歷史，可捲動">
    <table class="adm-table">
      <thead>
        <tr>
          <th scope="col">時間（台北）</th>
          <th scope="col">來源</th>
          <th scope="col">收到</th>
          <th scope="col">新增／更新／撤下</th>
          <th scope="col">退回</th>
          <th scope="col">對不上</th>
          <th scope="col">結果</th>
        </tr>
      </thead>
      <tbody>
        ${list.map(
          (h) =>
            html`<tr>
              <td>${fmtTaipei(h.at)}</td>
              <td>${SOURCE_LABEL[h.source] ?? h.source}${h.by ? html`<div class="adm-muted">${h.by}</div>` : ''}</td>
              <td>${h.received ?? 0}</td>
              <td>${h.counts?.new ?? 0}／${h.counts?.updated ?? 0}／${h.counts?.withdrawn ?? 0}</td>
              <td>${h.counts?.rejected ?? 0}</td>
              <td>${h.unmapped ?? 0}</td>
              <td>
                ${
                  h.held
                    ? html`<span class="adm-badge adm-badge--bad">整批保留</span>`
                    : h.wroteSnapshot
                      ? html`<span class="adm-badge adm-badge--ok">已上架</span>`
                      : html`<span class="adm-badge adm-badge--gray">無變動</span>`
                }
              </td>
            </tr>`,
        )}
      </tbody>
    </table>
  </div>`;
}

export function render(ctx) {
  const { site, url } = ctx;
  const rec = site.snapshots?.intlImport ?? { lastRun: null, history: [] };
  const run = rec.lastRun ?? null;
  const current = alertPageRows(site)
    .slice()
    .sort((a, b) => String(b.publishedAt ?? '').localeCompare(String(a.publishedAt ?? '')) || a.id.localeCompare(b.id))
    .slice(0, RECENT);
  const total = alertPageRows(site).length;
  const countries = (site.master.countries ?? []).filter((c) => c.iso2).sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh-Hant'));
  const data = {
    today: site.today,
    record: { lastRun: run, history: (rec.history ?? []).slice(0, 30) },
    diseases: (site.master.diseases ?? []).map((d) => ({ id: d.id, name: d.name, nameEn: d.nameEn ?? null, aliases: d.aliases ?? [] })),
    countries: countries.map((c) => ({ iso2: c.iso2, name: c.name, nameEn: c.nameEn ?? null, aliases: c.aliases ?? [] })),
  };
  return html` ${pageHead({
      title: '國際疫情匯入',
      what: '「國際重要疫情資訊」（/travel/ 近 30 天清單與每則的站內頁）的資料由疫情中心的資料庫送來，網站不再人工抄寫，也不再另設一道人審：機器先把關（格式、日期、個資、對不上主檔、一次少掉一半），有問題的則退回、整批可疑就保留不動。這一頁看最後一次匯入的結果，並在資料庫或系統斷線時手動補登。',
      flow: '三條路、同一套把關。(1) 排程拉取：每天固定時間向疫情中心的匯出網址拉一次（預設做法）；(2) 推送：疫情中心系統核定一則時直接送到網站，分鐘級上架（急件用）；(3) 手動：在本頁貼上、上傳或逐則填寫後送出（備援）。三條路的結果都記在下方的匯入紀錄，整批保留與對不上主檔會自動產生待辦給疫情中心。',
    })}

    <section class="adm-card" aria-labelledby="ie-status-h">
      <h2 id="ie-status-h">匯入狀態</h2>
      <p class="adm-card__sub" id="ie-status-src">依建置時的匯入紀錄（${site.today}）。</p>
      <div id="ie-last">${lastRunBox(run)}</div>
      <h3>退回的則</h3>
      <div id="ie-rejected">${rejectedTable(run)}</div>
      <h3>對不上主檔</h3>
      <div id="ie-unmapped">${unmappedTable(run, { glossaryHref: url('/admin/glossary/', { noLang: true }) })}</div>
    </section>

    <section class="adm-card" aria-labelledby="ie-manual-h">
      <h2 id="ie-manual-h">手動匯入（備援）</h2>
      <p class="adm-card__sub">平常不需要用：資料庫核定後會自動送來。只有排程或推送斷線、或要緊急補登一則時才用這裡。先加入預覽清單，檢查沒問題再送出。</p>
      <div class="adm-split adm-split--even">
        <div>
          <h3>貼上或上傳</h3>
          <p class="adm-hint">接受交換格式 v1 的 JSON、CSV（第一列是欄名，多國以 ; 分隔），或現行官網 ExportJSON 的內容；系統自動判斷格式。</p>
          <div class="adm-field"><label for="ie-paste">貼上內容</label><textarea id="ie-paste" rows="8" class="adm-input" spellcheck="false"></textarea></div>
          <div class="adm-field">
            <label for="ie-file">或選擇檔案（.json、.csv）</label><input type="file" id="ie-file" accept=".json,.csv,application/json,text/csv" />
          </div>
          <div class="adm-actions"><button type="button" class="adm-btn" id="ie-parse">讀入到預覽清單</button></div>
          <p class="adm-muted" id="ie-parse-msg" role="status" aria-live="polite"></p>
        </div>
        <form id="ie-form" class="adm-form" novalidate>
          <h3>逐則填寫</h3>
          <div class="adm-field">
            <label for="ie-id">識別碼（選填）</label><input type="text" id="ie-id" class="adm-input" placeholder="留空自動產生" /><span class="adm-hint"
              >資料庫有主鍵就填主鍵；更正同一則時識別碼不能變。</span
            >
          </div>
          <div class="adm-grid adm-grid--2">
            <div class="adm-field">
              <label for="ie-published">發布時間<span class="adm-req">（必填）</span></label
              ><input type="datetime-local" id="ie-published" class="adm-input" />
            </div>
            <div class="adm-field"><label for="ie-expires">下架時間（選填）</label><input type="datetime-local" id="ie-expires" class="adm-input" /></div>
          </div>
          <div class="adm-field">
            <label for="ie-disease">疾病<span class="adm-req">（必填）</span></label
            ><input type="text" id="ie-disease" class="adm-input" list="ie-disease-list" autocomplete="off" /><datalist id="ie-disease-list">
              ${data.diseases.map((d) => html`<option value="${d.name}"></option>`)}</datalist
            ><span class="adm-hint">用疾病主檔的名稱，才會連到疾病頁。</span>
          </div>
          <div class="adm-field">
            <label for="ie-headline">標題<span class="adm-req">（必填）</span></label
            ><input type="text" id="ie-headline" class="adm-input" maxlength="120" placeholder="國家-疾病（例：越南-登革熱）" />
          </div>
          <div class="adm-field">
            <label for="ie-body">內文<span class="adm-req">（必填）</span></label
            ><textarea id="ie-body" rows="5" class="adm-input"></textarea>
          </div>
          <div class="adm-field">
            <label for="ie-instruction">建議（選填）</label><input type="text" id="ie-instruction" class="adm-input" placeholder="提醒遵守當地的一般預防措施" />
          </div>
          <div class="adm-field">
            <label for="ie-countries">國家（可多選：按住 Ctrl 或 ⌘ 點選）<span class="adm-req">（至少一個）</span></label>
            <select id="ie-countries" class="adm-input" multiple size="8">
              ${countries.map((c) => html`<option value="${c.iso2}">${c.name}（${c.iso2}）</option>`)}
            </select>
          </div>
          <div class="adm-field">
            <label for="ie-other">國家主檔沒有的國家／地區（選填）</label
            ><input type="text" id="ie-other" class="adm-input" placeholder="名稱或兩碼 ISO 國碼，多個以 ; 分隔" />
          </div>
          <div class="adm-field">
            <label for="ie-source">原始網址（選填）</label><input type="url" id="ie-source" class="adm-input" placeholder="https://" />
          </div>
          <div class="adm-actions">
            <button type="button" class="adm-btn" id="ie-add">加入預覽清單</button><button type="reset" class="adm-btn adm-btn--ghost">清空表單</button>
          </div>
          <p class="adm-muted" id="ie-form-msg" role="status" aria-live="polite"></p>
        </form>
      </div>

      <h3 id="ie-preview-h">預覽清單</h3>
      <p class="adm-muted" id="ie-summary" role="status" aria-live="polite">清單是空的。</p>
      <div class="adm-tablewrap" role="region" tabindex="0" aria-labelledby="ie-preview-h">
        <table class="adm-table">
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">識別碼</th>
              <th scope="col">發布時間</th>
              <th scope="col">標題</th>
              <th scope="col">疾病</th>
              <th scope="col">國家</th>
              <th scope="col">檢查結果</th>
              <th scope="col"><span class="adm-sr-only">操作</span></th>
            </tr>
          </thead>
          <tbody id="ie-preview"></tbody>
        </table>
      </div>

      <fieldset class="adm-fieldset">
        <legend>匯入方式</legend>
        <div class="adm-pills adm-pills--col" role="radiogroup" aria-label="匯入方式">
          ${['delta', 'full'].map(
            (k) =>
              html`<label class="adm-pill adm-pill--desc"
                ><input type="radio" name="ie-mode" value="${k}" ${k === 'delta' ? 'checked' : ''} /><span
                  ><b>${MODE_LABEL[k]}</b><small>${MODE_HELP[k]}</small></span
                ></label
              >`,
          )}
        </div>
      </fieldset>
      <div class="adm-actions">
        <button type="button" class="adm-btn" id="ie-send">送出上架</button
        ><button type="button" class="adm-btn adm-btn--ghost" id="ie-clear">清空預覽清單</button>
      </div>
      <div id="ie-result" role="status" aria-live="polite"></div>
    </section>

    <section class="adm-card" aria-labelledby="ie-current-h">
      <h2 id="ie-current-h">現行清單（最近 ${current.length} 則，共 ${total} 則）</h2>
      ${
        current.length
          ? html`<div class="adm-tablewrap" role="region" tabindex="0" aria-label="現行清單，可捲動">
              <table class="adm-table">
                <thead>
                  <tr>
                    <th scope="col">發布</th>
                    <th scope="col">標題</th>
                    <th scope="col">疾病</th>
                    <th scope="col">國家</th>
                    <th scope="col">來源</th>
                  </tr>
                </thead>
                <tbody>
                  ${current.map(
                    (a) =>
                      html`<tr>
                        <td>${a.published ?? '—'}</td>
                        <td><a href="${url(`/travel/alerts/${a.id}/`)}">${a.headline ?? a.id}</a></td>
                        <td>${a.disease ?? '—'}</td>
                        <td>
                          ${
                            (a.areas ?? [])
                              .map((x) => x.country ?? x.iso2)
                              .filter(Boolean)
                              .join('、') || '—'
                          }
                        </td>
                        <td>${a.provenance?.source ? (SOURCE_LABEL[a.provenance.source] ?? a.provenance.source) : '—'}</td>
                      </tr>`,
                  )}
                </tbody>
              </table>
            </div>`
          : html`<p class="adm-muted">目前沒有上架中的國際疫情資訊。</p>`
      }
      <p class="adm-muted">前台：<a href="${url('/travel/')}">/travel/</a></p>
    </section>

    <section class="adm-card" aria-labelledby="ie-history-h">
      <h2 id="ie-history-h">匯入紀錄（近 30 次）</h2>
      <div id="ie-history">${historyTable(rec.history)}</div>
    </section>
    ${dataScript('adm-intl-data', data)}`;
}
