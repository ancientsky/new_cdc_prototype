// 第二十八輪：傳染病核心教材（document 型別、docType: curriculum）的共用呈現。
// 用在三個地方：文件頁頂端（學習目標、示範匯入警示）、疾病頁專業版「核心教材」區塊、/pro/ 與 /pro/curriculum/ 的教材清單。
// 字串只放 zh-TW／en（教材只給專業人員，七語都 fallback 英文；不動共用的 i18n.js）。理由與契約：ARCHITECTURE §33。
import { html } from '../../../scripts/lib/render.mjs';
import { alertBox, hrefFor, L, pill, unitLink } from './_partials.mjs';

const S = {
  'zh-TW': {
    objectives: '學習目標', objectivesDraft: '學習目標與章節架構由本站示範擬定，尚未與教材原文核對。',
    reconstructedT: '示範匯入，不是教材原文', reconstructed: '尚未取得教材 PDF 正本。本頁依公開摘錄與站內已匯入的內容重建，每句標出處；（待補）處是教材有、本站找不到可查證來源的部分。未經權責單位查證，內容以疾管署 PDF 正本為準。',
    sourcesLink: '看資料來源與查證狀態', series: '系列', edition: '教材版次', audience: '對象', chapters: '{n} 章', pending: '待補 {n} 處',
    status: '未查證', statusOk: '已校對', open: '開啟教材', none: '目前沒有已上架的核心教材。', all: '全部核心教材 →', pdf: 'PDF 正本',
    pdfMissing: '未取得', pdfLegacy: '舊站檔案（未查證）',
  },
  en: {
    objectives: 'Learning objectives', objectivesDraft: 'Learning objectives and chapter outline are drafted by this site and not yet checked against the original material.',
    reconstructedT: 'Demonstration import, not the original text', reconstructed: 'The original PDF has not been obtained. This page is rebuilt from public excerpts and content already on this site, with a source for every sentence; “(待補)” marks parts the material covers but no verifiable source was found. Not verified by the responsible unit; the official Taiwan CDC PDF prevails.',
    sourcesLink: 'See sources and verification status', series: 'Series', edition: 'Edition', audience: 'For', chapters: '{n} chapters', pending: '{n} gaps',
    status: 'unverified', statusOk: 'proofread', open: 'Open', none: 'No core curriculum is published yet.', all: 'All core curricula →', pdf: 'Original PDF',
    pdfMissing: 'not obtained', pdfLegacy: 'legacy-site file (unverified)',
  },
};
export const CS = (ctx, key, vars = {}) => String((S[ctx.lang] ?? S.en)[key] ?? S['zh-TW'][key] ?? key).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');

export const isCurriculum = (d) => d?.type === 'document' && d.docType === 'curriculum';
export const isReconstructed = (d) => d?.derivedFrom?.sourceKind === 'reconstructed';

/** 已發布的現行版核心教材（可用疾病篩選），依疾病名排序 */
export function curricula(site, { disease = null } = {}) {
  return (site.collections.documents ?? [])
    .filter((d) => isCurriculum(d) && d.status === 'published' && d.isCurrent !== false && (!disease || d.diseases?.includes(disease)))
    .sort((a, b) => String(a.title).localeCompare(String(b.title), 'zh-Hant'));
}

/** 統計：章數、待補處數（給清單卡片） */
export function curriculumCounts(d) {
  const secs = d.sections ?? [];
  return {
    chapters: new Set(secs.map((s) => /^ch\d+/.exec(String(s.key))?.[0]).filter(Boolean)).size,
    pending: secs.reduce((n, s) => n + (String(s.markdown ?? '').match(/（待補[:：]/g)?.length ?? 0), 0),
  };
}

/** 文件頁頂端：示範匯入警示＋學習目標（id="objectives"，答案引擎的學習目標單元連到這裡） */
export function curriculumHead(ctx, d) {
  if (!isCurriculum(d)) return '';
  const { t } = ctx;
  const draft = d.curriculum?.chapterPlan === 'provisional';
  return html`${isReconstructed(d) ? alertBox('overdue', html`<strong class="c-alert__t">${CS(ctx, 'reconstructedT')}</strong> ${CS(ctx, 'reconstructed')} <a class="c-alert__go" href="#s-sources">${CS(ctx, 'sourcesLink')} →</a>`, { role: 'note' }) : ''}
  <dl class="c-provfull c-curr-meta">
    ${d.curriculum?.series ? html`<div><dt>${CS(ctx, 'series')}</dt><dd>${d.curriculum.series}</dd></div>` : ''}
    ${d.curriculum?.edition ? html`<div><dt>${CS(ctx, 'edition')}</dt><dd>${d.curriculum.edition}</dd></div>` : ''}
    ${d.roles?.length ? html`<div><dt>${CS(ctx, 'audience')}</dt><dd>${d.roles.map((r) => t(`role.${r}`)).join('、')}</dd></div>` : ''}
  </dl>
  ${d.learningObjectives?.length ? html`<section class="c-block c-curr-obj" id="objectives" aria-labelledby="h-objectives"><h2 id="h-objectives">${CS(ctx, 'objectives')}</h2>
    <ol>${d.learningObjectives.map((o) => html`<li>${o}</li>`)}</ol>
    ${draft ? html`<p class="muted">${CS(ctx, 'objectivesDraft')}</p>` : ''}
  </section>` : ''}`;
}

/** 教材卡：疾病頁、/pro/、/pro/curriculum/ 共用 */
export function curriculumCard(ctx, d, { showDisease = false } = {}) {
  const { fmtDate, t, site } = ctx;
  const c = curriculumCounts(d);
  const dis = showDisease ? (d.diseases ?? []).map((id) => site.diseaseMasterById?.get(id)?.name ?? id).join('、') : '';
  const pdfLabel = /^https?:/.test(d.pdfUrl ?? '') ? CS(ctx, 'pdfLegacy') : CS(ctx, 'pdfMissing');
  return html`<li class="c-currcard">
    <p class="c-currcard__t">${dis ? html`<span class="c-pill c-pill--info">${dis}</span> ` : ''}<a href="${hrefFor(ctx, d)}">${L(ctx, d, 'title')}</a></p>
    <p class="muted">${d.version} · ${t('prov.effective')} ${fmtDate(d.effectiveAt)} · ${unitLink(ctx, d.owner)} · ${CS(ctx, 'chapters', { n: c.chapters })}${c.pending ? ` · ${CS(ctx, 'pending', { n: c.pending })}` : ''}</p>
    <p>${d.derivedFrom && d.derivedFrom.reviewStatus !== 'reviewed' ? pill(CS(ctx, 'status'), 'warn') : pill(CS(ctx, 'statusOk'), 'ok')} <span class="muted">${CS(ctx, 'pdf')}：${pdfLabel}</span></p>
    ${d.learningObjectives?.length ? html`<details class="c-currcard__obj"><summary>${CS(ctx, 'objectives')}（${d.learningObjectives.length}）</summary><ol>${d.learningObjectives.map((o) => html`<li>${o}</li>`)}</ol></details>` : ''}
  </li>`;
}

export function curriculumList(ctx, list, opts = {}) {
  return list.length ? html`<ul class="c-currcards">${list.map((d) => curriculumCard(ctx, d, opts))}</ul>` : html`<p class="muted">${CS(ctx, 'none')}</p>`;
}
