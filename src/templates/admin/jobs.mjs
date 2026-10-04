// /admin/jobs/ 人才招募管理（人事室；ARCHITECTURE 15.2）：職缺與階段表、待辦、結果上架檢核（遮罩、正取數 ≤ 名額、備取有效期）。
// 階段與待辦一律來自治理引擎（item.gov.jobStage、site.gov.todos）；這裡只呈現，不重算規則。
import { html } from '../../../scripts/lib/render.mjs';
import { pageHead, adminMeta, jobRows, todoList, daysBetween } from './_partials.mjs';
export { layout } from './_layout.mjs';

export function pages() { return [{ path: '/admin/jobs/', props: {}, noindex: true }]; }
export function meta() { return adminMeta('人才招募管理', 'jobs', []); }

const STAGE = {
  upcoming: ['即將開放', 'info'], open: ['報名中', 'ok'], closed: ['已截止', 'gray'], screening: ['審查與甄試中', 'warn'], result: ['已公布結果', 'ok'], filled: ['已額滿', 'gray'], cancelled: ['已取消', 'gray'],
};
const JOB_KINDS = ['job-result-overdue', 'job-waitlist-expiring', 'job-apply-url-dead'];
const badge = (stage) => { const [l, k] = STAGE[stage] ?? [stage, 'gray']; return html`<span class="adm-badge adm-badge--${k}">${l}</span>`; };

export function render(ctx) {
  const { site, url } = ctx;
  const rows = jobRows(site);
  const todos = todoList(site).filter((t) => JOB_KINDS.includes(t.kind));
  const withResult = rows.filter((r) => r.checks);
  const n = (st) => rows.filter((r) => r.stage === st).length;
  const bad = withResult.filter((r) => r.checksBad).length;
  const mark = (c) => html`<span class="${c.ok ? 'adm-green' : 'adm-red'}" aria-label="${c.ok ? '通過' : '未通過'}">${c.ok ? '✓' : '✗'}</span> ${c.text}`;
  return html`
${pageHead({
    title: '人才招募管理',
    what: '人事室的招募職缺總覽：每則職缺目前在哪個階段、倒數、報名方式（站內模擬報名或外部系統）、待辦，以及甄選結果上架前的檢核。',
    flow: '職缺是 content/jobs/ 的 job 檔；新增、公布結果與遞補都是改檔開 PR。階段由日期與 result 欄位推導，截止當天、甄試日到期都不需要任何人動手；結果上架時建置會強制檢查遮罩姓名。',
  })}
<div class="adm-box adm-box--note" role="note"><strong>結果只公布報名編號與遮罩姓名</strong>
  <code>result.admitted／waitlist／waitlistUpdates</code> 的 <code>nameMasked</code> 必須含遮罩字（○◯〇＊），且不得出現完整中文姓名樣式；<code>candidateNo</code> 不得像身分證字號。違反時建置失敗，不能上線。AI 問答不會唸出名單，只給結果頁連結。</div>

<div class="adm-statrow" style="margin-top:var(--sp-4)">
  <div class="adm-stat adm-stat--info"><p class="adm-stat__label">報名中</p><p class="adm-stat__value">${n('open')}</p><p class="adm-stat__note">含外部報名系統 ${rows.filter((r) => r.stage === 'open' && r.external).length} 則</p></div>
  <div class="adm-stat"><p class="adm-stat__label">即將開放</p><p class="adm-stat__value">${n('upcoming')}</p><p class="adm-stat__note">已公告、未開始報名</p></div>
  <div class="adm-stat"><p class="adm-stat__label">審查與甄試中</p><p class="adm-stat__value">${n('closed') + n('screening')}</p><p class="adm-stat__note">已截止、等結果</p></div>
  <div class="adm-stat adm-stat--ok"><p class="adm-stat__label">已公布結果</p><p class="adm-stat__value">${n('result')}</p><p class="adm-stat__note">90 天後自動進歷史</p></div>
  <div class="adm-stat ${bad || rows.some((r) => r.resultOverdue) ? 'adm-stat--bad' : 'adm-stat--ok'}"><p class="adm-stat__label">需處理</p><p class="adm-stat__value">${rows.filter((r) => r.attention).length}</p><p class="adm-stat__note">結果逾期或檢核未過</p></div>
</div>

<section class="adm-card" aria-labelledby="j-h"><h2 id="j-h">職缺與階段</h2>
  <p class="adm-card__sub">前台：<a href="${url('/careers/')}">/careers/</a>。依報名截止日排序；歷史＝結果公布滿 90 天、已額滿或已取消。</p>
  <div class="adm-tablewrap"><table class="adm-table"><caption>共 ${rows.length} 則職缺（建置日 ${site.today}）</caption>
    <thead><tr><th scope="col">職缺</th><th scope="col">階段</th><th scope="col">用人單位</th><th scope="col" class="num">名額</th><th scope="col">報名期間</th><th scope="col">倒數</th><th scope="col">報名方式</th><th scope="col">結果</th></tr></thead>
    <tbody>${rows.map((r) => html`<tr data-id="${r.id}" data-stage="${r.stage}">
      <td><a href="${url(r.front)}">${r.title}</a><div class="adm-muted"><code>${r.id}</code> · ${r.jobType}</div></td>
      <td>${badge(r.stage)}${r.history ? html` <span class="adm-badge adm-badge--gray">歷史</span>` : ''}${r.status !== 'published' ? html` <span class="adm-badge adm-badge--info">${r.status}</span>` : ''}</td>
      <td>${r.hiringName || '—'}</td>
      <td class="num">${r.positions ?? '—'}</td>
      <td>${r.applyStart ?? '—'} ～ ${r.deadlineAt ?? '—'}</td>
      <td>${r.stage === 'open' && r.daysLeft != null ? html`<span class="adm-badge adm-badge--${r.daysLeft <= 7 ? 'warn' : 'ok'}">${r.daysLeft === 0 ? '今日截止' : `剩 ${r.daysLeft} 日`}</span>` : r.stage === 'upcoming' ? html`<span class="adm-muted">${r.applyStart} 開放</span>` : '—'}</td>
      <td>${r.external ? html`<a href="${r.applyUrl}" rel="noopener">外部系統</a>` : html`<span class="adm-muted">${r.onSite ? '站內模擬報名' : { email: '電子郵件', mail: '郵寄', 'in-person': '親送' }[r.applyMethod] ?? '—'}</span>`}</td>
      <td>${r.resultAt ? html`${r.resultAt}${r.waitlistUpdates ? html` <span class="adm-muted">（遞補 ${r.waitlistUpdates} 次）</span>` : ''}` : r.resultOverdue ? html`<span class="adm-badge adm-badge--bad">預計 ${r.resultPlannedAt}，逾 ${r.resultOverdueDays} 日</span>` : r.resultPlannedAt ? html`<span class="adm-muted">預計 ${r.resultPlannedAt}</span>` : '—'}</td></tr>`)}</tbody></table></div>
  ${rows.length ? '' : html`<p class="adm-empty">尚無職缺資料。</p>`}
</section>

<section class="adm-card" aria-labelledby="c-h"><h2 id="c-h">結果上架檢核</h2>
  <p class="adm-card__sub">只檢查已有 <code>result</code> 的職缺。三項都通過才算可上架；「遮罩」未過時建置本來就會失敗，這裡是上架前的提早提醒。</p>
  ${withResult.length ? html`<div class="adm-tablewrap"><table class="adm-table"><caption>${withResult.length} 則職缺有甄選結果；${bad ? `${bad} 則未通過` : '全部通過'}</caption>
    <thead><tr><th scope="col">職缺</th><th scope="col">遮罩檢核</th><th scope="col">正取數 ≤ 名額</th><th scope="col">備取有效期</th><th scope="col">結果</th></tr></thead>
    <tbody>${withResult.map((r) => html`<tr data-id="${r.id}"><td><a href="${url(r.front)}#result">${r.title}</a><div class="adm-muted"><code>${r.id}</code></div></td>
      <td data-check="mask">${mark(r.checks.mask)}</td><td data-check="capacity">${mark(r.checks.capacity)}</td><td data-check="waitlist">${mark(r.checks.waitlist)}</td>
      <td>${r.checksBad ? html`<span class="adm-badge adm-badge--bad">需修正</span>` : html`<span class="adm-badge adm-badge--ok">可上架</span>`}</td></tr>`)}</tbody></table></div>` : html`<p class="adm-empty">目前沒有已公布結果的職缺。</p>`}
</section>

<section class="adm-card" aria-labelledby="t-h"><h2 id="t-h">待辦（人事室）</h2>
  <p class="adm-card__sub">由引擎依欄位產生：結果逾期（預計公布日 + 7 日仍無結果）、備取 14 日內到期、外部報名網址失效。完整清單見 <a href="${url('/admin/todos/', { noLang: true })}#job-result-overdue">連動待辦</a>。</p>
  ${todos.length ? html`<div class="adm-tablewrap"><table class="adm-table"><thead><tr><th scope="col">類型</th><th scope="col">職缺</th><th scope="col">說明</th><th scope="col">期限</th></tr></thead>
    <tbody>${todos.map((t) => html`<tr><td><span class="adm-badge adm-badge--warn">${{ 'job-result-overdue': '結果逾期', 'job-waitlist-expiring': '備取將到期', 'job-apply-url-dead': '報名網址失效' }[t.kind]}</span></td><td>${t.itemTitle}<div class="adm-muted"><code>${t.itemId}</code></div></td><td>${t.text ?? ''}</td><td>${t.dueAt ?? '—'}${t.dueAt && t.dueAt < site.today ? html` <span class="adm-badge adm-badge--bad">逾期 ${-daysBetween(site.today, t.dueAt)} 日</span>` : ''}</td></tr>`)}</tbody></table></div>`
    : html`<div class="adm-box adm-box--ok"><strong>目前沒有招募待辦</strong>結果都按時上架，備取也都在有效期內。</div>`}
</section>`;
}
