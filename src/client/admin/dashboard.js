// /admin/ 儀表板：本機覆寫（AI 開關、待辦完成）疊加、單位卡標示、季報 Markdown 匯出。
import { $, $$, store, readEmbedded, onUnit, getUnit, downloadText, copyText, fmtDT } from './common.js';

const D = readEmbedded('adm-dash-data', {});
const pad = (s, n) => String(s).padEnd(n);

// AI 狀態：本機覆寫優先
function aiNow() {
  const o = store.get('cdc.aiStatusOverride');
  return o && typeof o.paused === 'boolean' ? { ...D.ai, ...o, local: true } : { ...D.ai, local: false };
}
function paintAI() {
  const a = aiNow();
  $('#dash-ai').textContent = a.paused ? '暫停中' : '運作中';
  $('#dash-ai-note').textContent = a.paused ? `原因：${a.reason || '—'}${a.local ? '（本機覆寫）' : ''}` : (a.local ? '本機覆寫：已恢復' : `模式：${D.ai.mode === 'llm' ? 'LLM' : '抽取式'}；前往「AI 開關」可暫停`);
  const tile = $('#dash-ai').closest('.adm-stat');
  tile.classList.toggle('adm-stat--bad', !!a.paused); tile.classList.toggle('adm-stat--ok', !a.paused);
}
paintAI();

// 待辦完成（本機）
function paintDone() {
  const done = store.get('cdc.admin.todoDone', {}) ?? {};
  const n = (D.todos ?? []).filter((t) => done[t.id]).length;
  const el = $('#dash-done');
  if (el) el.textContent = n ? `（本機已標記完成 ${n} 件）` : '';
}
paintDone();

onUnit((u) => {
  $$('#unit-cards .adm-unitcard').forEach((c) => { const me = c.dataset.unit === u; $('[data-me]', c).hidden = !me; c.style.borderColor = me ? 'var(--green-600)' : ''; c.style.borderWidth = me ? '2px' : ''; });
});

function quarterOf(iso) { const [y, m] = iso.split('-').map(Number); return `${y} 年第 ${Math.ceil(m / 3)} 季`; }
function buildMarkdown() {
  const a = aiNow();
  const done = store.get('cdc.admin.todoDone', {}) ?? {};
  const todos = D.todos ?? [];
  const open = todos.filter((t) => !done[t.id]);
  const L = [];
  L.push(`# 疾管署資料治理季報（${quarterOf(D.today)}）`, '', `> 資料基準日：${D.today}；由後台儀表板自動彙整（原型示範）。數字皆由內容欄位於建置時計算。`, '');
  L.push('## 一、品質指標（規劃 7.5）', '', '| 指標 | 目前 | 第一年目標 | 第三年目標 | 狀態 |', '| --- | ---: | ---: | ---: | --- |');
  const fv = (v, u, dir) => (v == null ? '—' : `${dir === 'lower' ? '≤ ' : ''}${v}${u === '%' ? '%' : ` ${u ?? ''}`.trimEnd()}`);
  const st = { ok: '達標', warn: '接近', bad: '未達標', pending: '待量測', info: '參考' };
  for (const k of D.kpi ?? []) L.push(`| ${k.label} | ${k.current == null ? (k.key === 'link-health' ? '尚未執行檢查' : '待量測') : fv(k.current, k.unit)} | ${fv(k.target1y, k.unit, k.direction)} | ${fv(k.target3y, k.unit, k.direction)} | ${st[k.status] ?? ''} |`);
  L.push('', '## 二、AI 白名單與開關', '', `- 白名單生效 ${D.whitelist.effective} / 已發布 ${D.whitelist.published} 筆`, `- AI 問答：${a.paused ? `暫停中（${a.reason || '未填原因'}）` : '運作中'}${a.local ? '（本機示範覆寫）' : ''}`);
  if (D.eval) L.push(`- 評估集：${D.eval.passed}/${D.eval.total} 題通過${D.eval.version ? `；版本題 ${D.eval.version.passed}/${D.eval.version.total}` : ''}`);
  const s = D.situation ?? {};
  L.push('', '## 三、疫情態勢層', '', `- 資料日 ${s.dataDate ?? '—'}，距今 ${s.lagDays ?? '—'} 日；下次審閱日 ${s.nextReviewAt ?? '—'}${s.overdue ? '（已逾期，待疫情中心重新發布）' : ''}`);
  L.push('', `## 四、系統待辦（共 ${todos.length} 件，本機標記完成 ${todos.length - open.length} 件）`, '');
  const byKind = {};
  for (const t of todos) (byKind[t.kind] ??= []).push(t);
  if (!todos.length) L.push('目前沒有待辦。');
  for (const [k, list] of Object.entries(byKind)) { L.push(`### ${D.kindNames?.[k] ?? k}（${list.length}）`, ''); for (const t of list) L.push(`- ${done[t.id] ? '[x]' : '[ ]'} ${t.ownerName}：${t.itemTitle}（期限 ${t.dueAt ?? '—'}${t.overdue ? '，已逾期' : ''}）`); L.push(''); }
  L.push('## 五、各單位現況', '', '| 單位 | 內容 | 已發布 | 白名單 | 逾期未審 | 依據已修訂 | 待辦 |', '| --- | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const o of D.owners ?? []) L.push(`| ${o.name} | ${o.content} | ${o.published} | ${o.whitelist} | ${o.overdue} | ${o.stale} | ${o.todos} |`);
  const x = D.extra;
  if (x) L.push('', '## 六、公告、影音與外部連結', '', `- 公告：進行中 ${x.notices.open}、7 日內截止 ${x.notices.soon}、已截止未封存 ${x.notices.closedUnarchived}（共 ${x.notices.total} 則）`, `- 影音：共 ${x.media.total} 支，有逐字稿 ${x.media.transcript}、依據正本現行版 ${x.media.current}`, `- 外部連結：ok ${x.links.ok}、broken ${x.links.broken}、unchecked ${x.links.unchecked}（共 ${x.links.total} 條）`);
  L.push('', '---', '*本季報由後台自動產生，無人工填報；若與正式資料有出入，以 /v1/governance/*.json 為準。*');
  void pad; void fmtDT;
  return `${L.join('\n')}\n`;
}
let md = '';
$('#q-gen').addEventListener('click', () => {
  md = buildMarkdown();
  const pre = $('#q-out'); pre.textContent = md; pre.hidden = false;
  $('#q-copy').disabled = false; $('#q-dl').disabled = false;
});
$('#q-copy').addEventListener('click', (e) => copyText(md, e.currentTarget));
$('#q-dl').addEventListener('click', () => downloadText(`governance-quarterly-${D.today}.md`, md, 'text/markdown'));
void getUnit;
