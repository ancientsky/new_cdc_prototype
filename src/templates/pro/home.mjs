// 專業人員專區 /pro/（wireframe 第 4 頁）
// 登入只加個人化，公開指引不設門檻；原型的「登入」只是示意，角色與訂閱都存在瀏覽器 localStorage。
import { html, raw } from '../../../scripts/lib/render.mjs';
import { proStyles } from './_styles.mjs';
import { servicesGrid, hrefFor, L } from '../public/_partials.mjs';
import { curricula, curriculumList } from '../public/_curriculum.mjs';

const ROLES = [
  { key: 'physician', zh: '醫師', en: 'Physician' },
  { key: 'nurse', zh: '護理', en: 'Nurse' },
  { key: 'infection-control', zh: '感染管制', en: 'Infection control' },
  { key: 'lab', zh: '檢驗', en: 'Laboratory' },
  { key: 'local-health', zh: '地方衛生單位', en: 'Local health unit' },
];

const SUBS = [
  { key: 'dengue', zh: '登革熱', en: 'Dengue', topics: ['disease.dengue'], on: true },
  { key: 'enterovirus', zh: '腸病毒', en: 'Enterovirus', topics: ['disease.enterovirus'], on: true },
  { key: 'amr', zh: '抗生素抗藥性', en: 'Antimicrobial resistance', topics: ['topic.amr'], on: true },
  { key: 'letters', zh: '致醫界通函', en: 'Letters to physicians', topics: ['letter'], on: true },
  { key: 'measles', zh: '麻疹 / MMR 建議', en: 'Measles / MMR', topics: ['disease.measles', 'vaccine.mmr'], on: false },
];

const TXT = {
  'zh-TW': {
    title: '專業人員專區', lead: '指引、手冊與通函的現行版本、異動對照與訂閱，都在這裡；公開指引不需登入。',
    login: '○○醫院 感染管制室 · 已登入（示意）', loginNote: '登入只加個人化，公開指引不設門檻',
    role: '您的角色', roleHint: '選擇後，下方文件與常用作業會依角色重新排序（只存在這台瀏覽器）。',
    ask: '專業問題', askLabel: '輸入專業問題', askPh: '登革熱檢體送驗的容器與時限', askMode: '專業模式：引用手冊條次與生效日，不做白話化', askBtn: '問',
    letter: '致醫界通函', letterGo: '全文與附件（含機讀版）→', letterDemo: '示意：目前語料庫尚無通函，此卡為版面示範',
    docs: '指引與手冊版本異動', docsSub: '僅顯示您訂閱的項目 · 舊版自動標示失效，仍可查閱', onlySub: '只顯示我訂閱的項目',
    current: '現行', prev: '前版', diff: '查看異動對照', nodiff: '無異動 —', expired: '已失效', none: '目前沒有已發布的專業文件。',
    tasks: '常用作業', sit: '現在的疫情（專業版）', sitSrc: '數據來源與下載', subs: '我的訂閱', subsNote: '新版發布或內容異動時以電子郵件通知。原型僅把偏好存在本機，不會真的寄信；正式環境由訂閱系統寄送。',
    copyRss: '複製 RSS/Atom 網址', copied: '已複製', ics: '下載 .ics 提醒', icsNote: '.ics 示範：把「下次審閱日」加進你的行事曆，提前 7 天提醒。',
    chain: '版本鏈', chainBody: '每份文件都記錄「取代誰、被誰取代、生效日」。舊版會自動標示失效、加上 noindex 並 301 導向現行版，但仍可在版本鏈中查閱。AI 回答若引用到失效版本，視為嚴重缺陷，評估集的版本題必須全對才能上線。',
    chainLink: '看版本鏈範例', status: '狀態', metric: '指標', illus: '示意數字', owner: '權責', reviewed: '審閱',
    curr: '傳染病核心教材', currSub: '給醫事與防疫人員的教學用教材；目前為示範匯入版，未查證，以 PDF 正本為準。', currAll: '全部核心教材與待匯入清單 →',
    svc: '應用專區', notices: '最新公告（人才／採購）', noticesAll: '全部公告 →', noticesNone: '目前沒有進行中的人才招募或採購公告。',
  },
  en: {
    title: 'Health professionals', lead: 'Current versions, change comparisons and subscriptions for guidelines, manuals and letters. Public guidance needs no login.',
    login: 'Example Hospital · Infection Control Office · signed in (demo)', loginNote: 'Signing in only personalises the page; public guidance is never gated',
    role: 'Your role', roleHint: 'Items below are re-ordered for your role (stored in this browser only).',
    ask: 'Professional question', askLabel: 'Ask a professional question', askPh: 'Specimen container and time limit for dengue testing', askMode: 'Professional mode: cites manual sections and effective dates, no plain-language rewriting', askBtn: 'Ask',
    letter: 'Letter to physicians', letterGo: 'Full text and attachments (machine-readable) →', letterDemo: 'Demo: no letter in the corpus yet; layout example only',
    docs: 'Guideline and manual version changes', docsSub: 'Only subscribed items · superseded versions are flagged but stay readable', onlySub: 'Show only my subscriptions',
    current: 'Current', prev: 'Previous', diff: 'View changes', nodiff: 'No change —', expired: 'superseded', none: 'No professional documents are published yet.',
    tasks: 'Common tasks', sit: 'Current outbreaks (professional view)', sitSrc: 'Sources and downloads', subs: 'My subscriptions', subsNote: 'You are notified by e-mail when a new version is published. The prototype only stores preferences locally and sends no mail.',
    copyRss: 'Copy RSS/Atom URL', copied: 'Copied', ics: 'Download .ics reminder', icsNote: '.ics demo: adds the next review date to your calendar with a 7-day reminder.',
    chain: 'Version chain', chainBody: 'Every document records what it supersedes, what supersedes it and its effective date. Old versions are flagged, set to noindex and redirected (301) to the current one, yet remain readable. An AI answer that cites a superseded version is a critical defect.',
    chainLink: 'See an example chain', status: 'Status', metric: 'Metric', illus: 'illustrative', owner: 'Owner', reviewed: 'Reviewed',
    curr: 'Core curriculum', currSub: 'Teaching material for health and public-health staff; current items are unverified demonstration imports, the official PDF prevails.', currAll: 'All core curricula and the import backlog →',
    svc: 'Applications and services', notices: 'Latest notices (recruitment / procurement)', noticesAll: 'All notices →', noticesNone: 'No open recruitment or procurement notices right now.',
  },
};

const slug = (id) => String(id).replace(/^[a-z]+\./, '');
const ym = (iso) => (iso ? iso.slice(0, 7).replace('-', '/') : '');

/** 取出各文件家族的 [現行版, 前版...]；容錯：沒有文件也能渲染。 */
function documentRows(site) {
  const fam = site.gov?.docsByFamily instanceof Map ? site.gov.docsByFamily : new Map();
  const rows = [];
  for (const [family, versions] of fam) {
    const sorted = [...versions].filter((v) => v.status !== 'draft').sort((a, b) => (b.effectiveAt ?? '').localeCompare(a.effectiveAt ?? ''));
    const current = sorted.find((v) => v.isCurrent) ?? sorted[0];
    if (!current) continue;
    if (!(current.audience ?? []).includes('professional')) continue;
    if (current.docType === 'curriculum') continue; // 第二十八輪：核心教材另列一張卡
    rows.push({ family, current, older: sorted.filter((v) => v !== current) });
  }
  return rows.sort((a, b) => (b.current.effectiveAt ?? '').localeCompare(a.current.effectiveAt ?? ''));
}

function latestLetter(site) {
  return [...(site.collections.news ?? [])]
    .filter((n) => (n.type === 'letter' || n.newsType === 'letter') && n.status === 'published')
    .sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''))[0] ?? null;
}

export function pages() {
  return [{ path: '/pro/', lang: 'zh-TW' }, { path: '/pro/', lang: 'en' }];
}

export function meta(ctx) {
  const T = TXT[ctx.lang] ?? TXT['zh-TW'];
  return { title: T.title, description: T.lead, bodyClass: 'pro', scripts: ['/assets/js/pro.js'] };
}

export function render(ctx) {
  const { site, url, fmtDate, t } = ctx;
  const T = TXT[ctx.lang] ?? TXT['zh-TW'];
  const en = ctx.lang === 'en';
  const rows = documentRows(site);
  const letter = latestLetter(site);
  const sitItems = site.situation?.items ?? [];
  const nextReviews = rows.map((r) => r.current.gov?.nextReviewAt).filter(Boolean).sort();
  const icsDate = nextReviews[0] ?? '';
  const icsTitle = rows.find((r) => r.current.gov?.nextReviewAt === icsDate)?.current.title ?? '文件審閱';
  const rssUrl = url('/feeds/documents.xml', { noLang: true, absolute: true });
  const owner = (id) => site.unitById?.get(id)?.name ?? id;
  const askUrl = (q) => url(`/ask/?q=${encodeURIComponent(q)}&view=pro`);

  const tasks = [
    { href: 'https://nidrs.cdc.gov.tw/', ext: true, title: '法定傳染病通報', title_en: 'Notifiable disease reporting', sub: '連結現行通報系統（NIDRS）', sub_en: 'Opens the current NIDRS reporting system', roles: 'physician infection-control local-health' },
    { href: askUrl('檢體送驗規定 容器 時限 表單'), title: '檢體送驗規定', title_en: 'Specimen submission rules', sub: '容器 · 時限 · 表單', sub_en: 'Containers · time limits · forms', roles: 'lab physician local-health' },
    { href: url('/diseases/'), title: '臨床處置指引', title_en: 'Clinical management guidance', sub: '依病別查詢', sub_en: 'Look up by disease', roles: 'physician nurse' },
    { href: url('/topics/antivenom/#s-professional'), title: '抗蛇毒血清', title_en: 'Antivenom', sub: '血清種類 · 儲備點 · 調度', sub_en: 'Products · stock points · transfers', roles: 'physician nurse' },
    { href: askUrl('感染管制查核 醫院 長照機構'), title: '感染管制查核', title_en: 'Infection-control audits', sub: '醫院 · 長照機構', sub_en: 'Hospitals · long-term care', roles: 'infection-control nurse local-health' },
  ];

  // 第七輪：招募與採購改為 job／tender 型別，階段由治理引擎推導；只列開放中的前兩筆
  const openNotices = [
    ...(site.collections.jobs ?? []).filter((j) => j.status === 'published' && j.gov?.jobStage === 'open').map((j) => ({ ...j, kindLabel: en ? 'Recruitment' : '人才招募' })),
    ...(site.collections.tenders ?? []).filter((t) => t.status === 'published' && t.gov?.tenderStage === 'open').map((t) => ({ ...t, kindLabel: en ? 'Procurement' : '採購公告' })),
  ].sort((a, b) => (a.deadlineAt ?? '9999-12-31').localeCompare(b.deadlineAt ?? '9999-12-31')).slice(0, 2);
  const noticeItem = (n) => html`<li class="c-notice"><span class="c-pill c-pill--neutral">${n.kindLabel}</span> <a href="${hrefFor(ctx, n)}">${L(ctx, n, 'title')}</a>${n.deadlineAt ? html` <span class="muted">${en ? 'Deadline' : '截止'} ${ctx.fmtDate(n.deadlineAt)}</span>` : ''}</li>`;
  return html`${proStyles}
<script>try{localStorage.setItem('cdc.view','pro')}catch(e){}document.documentElement.dataset.view='pro'</script>
<div class="pf" data-pro-home>
  <div class="pf-bar">
    <div><strong>${en ? 'Taiwan CDC · Health professionals' : '疾管署 · 專業人員專區'}</strong></div>
    <div class="pf-login" data-pro-login>${T.login}<small>${T.loginNote}</small></div>
  </div>
  <h1 style="margin-top:var(--sp-5)">${T.title}</h1>
  <p class="lead">${T.lead}</p>

  <section class="pf-card" aria-labelledby="role-h">
    <h2 id="role-h" style="font-size:var(--fs-lg);margin:0">${T.role}</h2>
    <div role="group" aria-label="${T.role}"><ul class="pf-pills">
      ${ROLES.map((r) => html`<li><button type="button" class="pf-pill" data-role="${r.key}" aria-pressed="false">${en ? r.en : r.zh}</button></li>`)}
    </ul></div>
    <p class="pf-hint" data-role-hint>${T.roleHint}</p>
  </section>

  <section class="pf-card" aria-labelledby="ask-h" style="margin-top:var(--sp-4)">
    <h2 id="ask-h" style="font-size:var(--fs-lg);margin:0">${T.ask}</h2>
    <form class="pf-ask" action="${url('/ask/')}" method="get" role="search">
      <input type="hidden" name="view" value="pro">
      <label class="sr-only" for="pro-q" style="position:absolute;left:-9999px">${T.askLabel}</label>
      <input id="pro-q" type="search" name="q" placeholder="${T.askPh}" autocomplete="off">
      <button class="pf-btn pf-btn--navy" type="submit">${T.askBtn}</button>
    </form>
    <p class="pf-hint"><span class="pf-badge">${T.askMode}</span></p>
  </section>

  <div class="pf-grid">
    <div>
      ${letter ? html`
      <section class="pf-card pf-card--letter" aria-labelledby="letter-h">
        <h2 id="letter-h" style="font-size:var(--fs-lg)">${T.letter}${letter.letterNo ? ` ${en ? 'No. ' : '第 '}${letter.letterNo}${en ? '' : ' 號'}` : ''} · ${fmtDate(letter.publishedAt)}</h2>
        <p><strong>${letter.title}</strong></p>
        <p>${letter.summary}</p>
        <p><a href="${url(`/news/${slug(letter.id)}/`)}">${T.letterGo}</a></p>
      </section>` : html`
      <section class="pf-card pf-card--letter" aria-labelledby="letter-h">
        <h2 id="letter-h" style="font-size:var(--fs-lg)">${T.letter}${en ? ' No. 616' : '第 616 號'} · 2026-09-18</h2>
        <p class="muted">${T.letterDemo}</p>
        <p><a href="${url('/news/')}">${T.letterGo}</a></p>
      </section>`}

      <section class="pf-card" aria-labelledby="docs-h">
        <h2 id="docs-h" style="font-size:var(--fs-lg);margin:0">${T.docs}</h2>
        <p class="pf-hint">${T.docsSub}</p>
        <label class="pf-hint"><input type="checkbox" data-sub-filter> ${T.onlySub}</label>
        ${rows.length ? html`<ul class="pf-rows js-role-sortable" data-doc-list>
          ${rows.map(({ current: c, older }) => {
            const prev = older[0];
            const topics = [...(c.diseases ?? []), ...(c.vaccines ?? []), c.docType === 'letter' ? 'letter' : ''].filter(Boolean).join(' ');
            const hasDiff = prev && (c.changes ?? []).length > 0;
            return html`<li data-roles="${(c.roles ?? ['physician', 'nurse', 'infection-control', 'lab', 'local-health']).join(' ')}" data-topics="${topics}">
              <div>
                <a class="pf-row__title" href="${url(`/documents/${slug(c.id)}/`)}">${c.title}</a>
                <div class="pf-row__ver">${T.current} ${ym(c.effectiveAt)}${prev ? html` · ${T.prev} ${ym(prev.effectiveAt)}` : ''} <span class="pf-badge pf-badge--ok">${c.version}</span> <span class="pf-badge">${owner(c.owner)}</span></div>
                ${older.map((o) => html`<div class="pf-row__old"><a href="${url(`/documents/${slug(o.id)}/`, { noLang: true })}">${o.version}</a>（${T.expired}，${ym(o.effectiveAt)}）</div>`)}
              </div>
              <div>${hasDiff ? html`<a class="pf-btn" href="${url(`/documents/${slug(c.id)}/#changes`)}">${T.diff}</a>` : html`<span class="muted">${T.nodiff}</span>`}</div>
            </li>`;
          })}
        </ul>` : html`<p class="muted">${T.none}</p>`}
      </section>

      <section class="pf-card" aria-labelledby="curr-h">
        <h2 id="curr-h" style="font-size:var(--fs-lg);margin:0">${T.curr}</h2>
        <p class="pf-hint">${T.currSub}</p>
        ${curriculumList(ctx, curricula(site), { showDisease: true })}
        <p class="pf-hint"><a href="${url('/pro/curriculum/')}">${T.currAll}</a></p>
      </section>

      <section class="pf-card" aria-labelledby="svc-h">
        <h2 id="svc-h" style="font-size:var(--fs-lg);margin:0 0 var(--sp-3)">${T.svc}</h2>
        ${servicesGrid(ctx, { heading: T.svc })}
      </section>

      <section class="pf-card" aria-labelledby="tasks-h">
        <h2 id="tasks-h" style="font-size:var(--fs-lg);margin:0 0 var(--sp-3)">${T.tasks}</h2>
        <div class="pf-tasks js-role-sortable">
          ${tasks.map((k) => html`<a class="pf-task" href="${k.href}" data-roles="${k.roles}" ${k.ext ? raw('rel="noopener" target="_blank"') : ''}><strong>${en ? k.title_en : k.title}${k.ext ? ' ↗' : ''}</strong><span>${en ? k.sub_en : k.sub}</span></a>`)}
        </div>
      </section>
    </div>

    <div>
      <section class="pf-card" aria-labelledby="sit-h">
        <h2 id="sit-h" style="font-size:var(--fs-lg);margin:0">${T.sit}</h2>
        ${sitItems.length ? html`
        <div class="pf-table-wrap"><table class="pf-table">
          <thead><tr><th scope="col">${en ? 'Disease' : '疾病'}</th><th scope="col">${T.status}</th><th scope="col">${T.metric}</th></tr></thead>
          <tbody>${sitItems.map((i) => {
            const d = site.diseaseMasterById?.get(i.disease);
            return html`<tr>
              <th scope="row">${d?.slug && site.collections.diseases.some((p) => p.id === i.disease) ? html`<a href="${url(`/diseases/${d.slug}/`)}">${en ? d.nameEn ?? d.name : d.name}</a>` : (en ? d?.nameEn ?? i.disease : d?.name ?? i.disease)}</th>
              <td><span class="c-status-tag c-status-tag--${i.status}">${t(`status.${i.status}`)}</span></td>
              <td>${(en ? i.i18n?.en?.metricValue : null) ?? i.metricValue}<br><small>${(en ? i.i18n?.en?.metricLabel : null) ?? i.metricLabel}${i.illustrative ? ` · ${T.illus}` : ''}</small></td>
            </tr>`;
          })}</tbody>
        </table></div>
        <p class="pf-hint">${en ? 'Data date' : '資料日'} ${fmtDate(site.situation.dataDate)} · ${en ? 'Published by' : '發布'}：${owner(site.situation.publisher)}</p>
        <p class="pf-hint">${T.sitSrc}：<a href="https://nidss.cdc.gov.tw/" rel="noopener" target="_blank">NIDSS ↗</a> · <a href="${url('/v1/situation.json', { noLang: true })}">/v1/situation.json</a> · <a href="${url('/situation/')}">${en ? 'Trends' : '趨勢與發布依據'}</a></p>` : html`<p class="muted">—</p>`}
      </section>

      <section class="pf-card" aria-labelledby="ntc-h">
        <h2 id="ntc-h" style="font-size:var(--fs-lg);margin:0">${T.notices}</h2>
        ${openNotices.length ? html`<ul class="c-noticelist c-noticelist--compact">${openNotices.map(noticeItem)}</ul>` : html`<p class="muted">${T.noticesNone}</p>`}
        <p class="pf-hint"><a href="${url('/notices/')}">${T.noticesAll}</a></p>
      </section>

      <section class="pf-card" aria-labelledby="subs-h">
        <h2 id="subs-h" style="font-size:var(--fs-lg);margin:0">${T.subs}</h2>
        <div role="group" aria-label="${T.subs}"><ul class="pf-pills">
          ${SUBS.map((s) => html`<li><button type="button" class="pf-chip" data-sub="${s.key}" data-sub-topics="${s.topics.join(' ')}" data-sub-default="${s.on ? '1' : '0'}" aria-pressed="${s.on ? 'true' : 'false'}">${en ? s.en : s.zh}</button></li>`)}
        </ul></div>
        <p class="pf-hint">${T.subsNote}</p>
        <p style="display:flex;flex-wrap:wrap;gap:var(--sp-2);margin:var(--sp-3) 0 0">
          <button type="button" class="pf-btn" data-copy="${rssUrl}" data-copied="${T.copied}">${T.copyRss}</button>
          <button type="button" class="pf-btn" data-ics data-ics-title="${icsTitle}" data-ics-date="${icsDate}" data-ics-url="${url('/pro/', { absolute: true })}" ${icsDate ? '' : raw('disabled')}>${T.ics}</button>
        </p>
        <p class="pf-hint"><code>${rssUrl}</code></p>
        <p class="pf-hint">${T.icsNote}</p>
      </section>

      <section class="pf-card pf-card--note" aria-labelledby="chain-h">
        <h2 id="chain-h" style="font-size:var(--fs-lg);margin:0">${T.chain}</h2>
        <p>${T.chainBody}</p>
        <p><a href="${url('/documents/')}">${T.chainLink}</a> · <a href="${url('/guide/#pro')}">${en ? 'How to use this area' : '專業人員使用指南'}</a></p>
      </section>
    </div>
  </div>
</div>`;
}
