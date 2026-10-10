// 專業人員專區／開發者入口／使用指南的前端互動。
// 所有 localStorage 讀寫都包 try/catch：無痕模式或被封鎖時頁面仍可使用，只是不記憶。
//   cdc.role           使用者角色（physician | nurse | infection-control | lab | local-health）
//   cdc.subscriptions  訂閱項目 key 陣列（原型：只存本機，不寄信）
//   cdc.reports        錯答回報（由答案頁寫入；透明報告頁只讀筆數）
const store = {
  get(k, fallback = null) { try { const v = localStorage.getItem(k); return v == null ? fallback : v; } catch { return fallback; } },
  set(k, v) { try { localStorage.setItem(k, v); return true; } catch { return false; } },
  json(k, fallback) { try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; } },
};
window.CDC = window.CDC || {};
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ── 專業層：只要在專業專區就切到專業顯示 ───────────────────────────────
if (document.body.classList.contains('pro') && document.querySelector('[data-pro-home]')) {
  document.documentElement.dataset.view = 'pro';
  store.set('cdc.view', 'pro');
}

// ── 角色 pill：排序「常用作業」與「版本異動」 ─────────────────────────
const ROLE_LABEL = { physician: '醫師', nurse: '護理', 'infection-control': '感染管制', lab: '檢驗', 'local-health': '地方衛生單位' };
function applyRole(role) {
  $$('[data-role]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.role === role)));
  $$('.js-role-sortable').forEach((list) => {
    const kids = [...list.children];
    if (!list.__orig) list.__orig = kids.slice();
    const match = (el) => !!role && (el.dataset.roles || '').split(/\s+/).includes(role);
    const sorted = list.__orig.slice().sort((a, b) => Number(match(b)) - Number(match(a)));
    sorted.forEach((el) => { el.classList.toggle('is-match', match(el)); list.appendChild(el); });
  });
  const hint = document.querySelector('[data-role-hint]');
  if (hint) hint.textContent = role ? `已依「${ROLE_LABEL[role] || role}」調整排序：符合角色的項目排在前面並標示底色（只存在這台瀏覽器）。` : hint.dataset.default || hint.textContent;
}
const hint0 = document.querySelector('[data-role-hint]');
if (hint0) hint0.dataset.default = hint0.textContent;
$$('[data-role]').forEach((b) => b.addEventListener('click', () => {
  const next = b.getAttribute('aria-pressed') === 'true' ? '' : b.dataset.role;
  store.set('cdc.role', next);
  applyRole(next);
}));
if ($$('[data-role]').length) applyRole(store.get('cdc.role', ''));

// ── 訂閱 chips ───────────────────────────────────────────────────────
const chips = $$('[data-sub]');
if (chips.length) {
  const saved = store.json('cdc.subscriptions', null);
  const active = new Set(Array.isArray(saved) ? saved : chips.filter((c) => c.dataset.subDefault === '1').map((c) => c.dataset.sub));
  const sync = () => {
    chips.forEach((c) => c.setAttribute('aria-pressed', String(active.has(c.dataset.sub))));
    filterBySubscription();
  };
  chips.forEach((c) => c.addEventListener('click', () => {
    active.has(c.dataset.sub) ? active.delete(c.dataset.sub) : active.add(c.dataset.sub);
    store.set('cdc.subscriptions', JSON.stringify([...active]));
    sync();
  }));
  const topicsOf = () => new Set(chips.filter((c) => active.has(c.dataset.sub)).flatMap((c) => (c.dataset.subTopics || '').split(/\s+/)));
  function filterBySubscription() {
    const only = document.querySelector('[data-sub-filter]')?.checked;
    const topics = topicsOf();
    $$('[data-doc-list] > li').forEach((li) => {
      const mine = (li.dataset.topics || '').split(/\s+/).some((t) => topics.has(t));
      li.hidden = !!only && !mine;
    });
  }
  document.querySelector('[data-sub-filter]')?.addEventListener('change', filterBySubscription);
  sync();
}

// ── 複製按鈕（RSS 網址、API 網址、程式碼） ───────────────────────────
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    const ta = Object.assign(document.createElement('textarea'), { value: text });
    ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove(); return ok;
  }
}
function flash(btn, msg) {
  const old = btn.dataset.label || btn.textContent;
  btn.dataset.label = old; btn.textContent = msg;
  clearTimeout(btn.__t); btn.__t = setTimeout(() => { btn.textContent = old; }, 1800);
}
document.addEventListener('click', async (e) => {
  const copy = e.target.closest('[data-copy]');
  if (copy) { const ok = await copyText(copy.dataset.copy); flash(copy, ok ? (copy.dataset.copied || '已複製') : '複製失敗，請手動選取'); return; }
  const copyFrom = e.target.closest('[data-copy-from]');
  if (copyFrom) { const src = document.querySelector(copyFrom.dataset.copyFrom); const ok = src && await copyText(src.textContent); flash(copyFrom, ok ? '已複製' : '複製失敗'); return; }
  const cite = e.target.closest('[data-cite]');
  if (cite) { const ok = await copyText(window.CDC.citation(cite)); flash(cite, ok ? '已複製引用格式' : '複製失敗'); }
});

// ── 引用本頁 ─────────────────────────────────────────────────────────
// 格式：衛生福利部疾病管制署（{reviewedAt} 審閱）。{title}。{url}（{version}，生效 {effectiveAt}）
// 元素可帶 data-title / data-reviewed / data-url / data-version / data-effective；缺的從頁面推：
//   標題＝h1、網址＝canonical、審閱日＝.c-provenance 內第一個 YYYY-MM-DD 之後的「最後審閱」或 <html data-reviewed>
window.CDC.citation = (el = document.body) => {
  const d = el.dataset || {};
  const title = d.title || document.querySelector('h1')?.textContent.trim().replace(/\s+/g, ' ') || document.title;
  const url = d.url || document.querySelector('link[rel="canonical"]')?.href || location.href.split('#')[0];
  let reviewed = d.reviewed || document.documentElement.dataset.reviewed || '';
  if (!reviewed) {
    const prov = document.querySelector('.c-provenance')?.textContent || '';
    reviewed = (prov.match(/(?:最後審閱|Last reviewed)[：:\s]*(\d{4}-\d{2}-\d{2})/) || [])[1] || '';
  }
  const tail = d.version ? `（${d.version}${d.effective ? `，生效 ${d.effective}` : ''}）` : '';
  return `衛生福利部疾病管制署（${reviewed || '審閱日未標示'} 審閱）。${title}。${url}${tail}`;
};

// ── .ics 提醒（下次審閱日） ──────────────────────────────────────────
function icsEscape(s) { return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n'); }
function foldLine(line) { // RFC 5545：每行 ≤ 75 octets，這裡以字元保守折行
  const out = []; let cur = '';
  for (const ch of line) { if ((cur + ch).length > 60) { out.push(cur); cur = ' ' + ch; } else cur += ch; }
  out.push(cur); return out.join('\r\n');
}
window.CDC.buildIcs = ({ title, date, url, days = 7 }) => {
  const ymd = date.replace(/-/g, '');
  const next = new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10) + 1)).toISOString().slice(0, 10).replace(/-/g, '');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Taiwan CDC prototype//review reminder//ZH', 'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT', `UID:review-${ymd}-${Math.abs([...title].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7))}@cdc-prototype`,
    `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${ymd}`, `DTEND;VALUE=DATE:${next}`,
    foldLine(`SUMMARY:${icsEscape(`審閱提醒：${title}`)}`), foldLine(`DESCRIPTION:${icsEscape(`疾管署文件下次審閱日。${url || ''}`)}`),
    ...(url ? [foldLine(`URL:${url}`)] : []),
    'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:審閱提醒', `TRIGGER:-P${days}D`, 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n') + '\r\n';
};
$$('[data-ics]').forEach((b) => b.addEventListener('click', () => {
  if (!b.dataset.icsDate) return;
  const blob = new Blob([window.CDC.buildIcs({ title: b.dataset.icsTitle, date: b.dataset.icsDate, url: b.dataset.icsUrl })], { type: 'text/calendar;charset=utf-8' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'cdc-review-reminder.ics' });
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}));

// ── 使用指南：分頁（沒有 JS 時三段全部顯示） ─────────────────────────
const tabsRoot = document.querySelector('[data-tabs-root]');
if (tabsRoot) {
  const panels = $$('section[data-tab]', tabsRoot);
  const links = $$('[data-tab-link]');
  const show = (id) => {
    const target = panels.some((p) => p.dataset.tab === id) ? id : panels[0].dataset.tab;
    panels.forEach((p) => p.classList.toggle('is-active', p.dataset.tab === target));
    links.forEach((a) => (a.dataset.tabLink === target ? a.setAttribute('aria-current', 'true') : a.removeAttribute('aria-current')));
  };
  tabsRoot.dataset.tabs = 'on';
  const fromHash = () => {
    const h = location.hash.replace('#', '');
    const owner = panels.find((p) => p.dataset.tab === h || p.querySelector(`[id="${CSS.escape(h)}"]`));
    show(owner ? owner.dataset.tab : (store.get('cdc.guideTab') || panels[0].dataset.tab));
  };
  links.forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); history.replaceState(null, '', `#${a.dataset.tabLink}`); store.set('cdc.guideTab', a.dataset.tabLink); show(a.dataset.tabLink); }));
  window.addEventListener('hashchange', fromHash);
  fromHash();
}

// ── 開發者入口：即時讀 openapi.json 畫端點表、示範嵌入態勢卡 ───────────
const oa = document.querySelector('[data-openapi]');
if (oa) {
  (async () => {
    try {
      const spec = await (await fetch(`${document.documentElement.dataset.base || ''}/openapi.json`)).json();
      const paths = Object.entries(spec.paths || {});
      const rows = paths.map(([p, ops]) => {
        const op = ops.get || Object.values(ops)[0] || {};
        return `<tr><td><code>${p.replace(/</g, '&lt;')}</code></td><td>${String(op.summary || op.description || '').replace(/</g, '&lt;')}</td></tr>`;
      }).join('');
      oa.innerHTML = `<p><strong>openapi.json 目前宣告 ${paths.length} 個端點</strong>（OpenAPI ${spec.openapi || '3.x'}，版本 ${spec.info?.version || '—'}）：</p><div class="pf-table-wrap"><table class="pf-table"><thead><tr><th>路徑</th><th>摘要</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    } catch (err) {
      oa.innerHTML = '<p class="muted">無法讀取 openapi.json（本機預覽或尚未建置時可能發生）。上方端點清單仍可使用。</p>';
    }
  })();
}
const demo = document.querySelector('[data-embed-demo]');
if (demo) {
  const btn = document.querySelector('[data-embed-run]');
  btn?.addEventListener('click', async () => {
    demo.textContent = '讀取中…';
    try {
      const j = await (await fetch(`${document.documentElement.dataset.base || ''}/v1/situation.json`)).json();
      const lab = { stable: '平穩', rising: '上升', peak: '高峰', declining: '下降' };
      demo.innerHTML = (j.data.items || []).map((i) => `<div class="pf-tile"><b>${(i.metricValue || '').replace(/</g, '&lt;')}</b><span>${(i.diseaseName || i.disease).replace(/</g, '&lt;')} · ${lab[i.status] || i.status}</span><small>${(i.metricLabel || '').replace(/</g, '&lt;')}</small></div>`).join('') + `<p class="muted" style="grid-column:1/-1">資料日 ${j.data.dataDate} · 發布：${j.data.publisher} · 授權 ${j.meta.license}</p>`;
    } catch { demo.textContent = '讀取失敗（請確認已建置 v1/situation.json）。'; }
  });
}

// ── 透明報告：本機回報筆數 ───────────────────────────────────────────
const localReports = document.querySelector('[data-local-reports]');
if (localReports) {
  const list = store.json('cdc.reports', []);
  const n = Array.isArray(list) ? list.length : 0;
  localReports.textContent = String(n);
}
