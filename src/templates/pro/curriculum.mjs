// 第二十八輪：傳染病核心教材總覽 /pro/curriculum/（舊站「首頁／專業人員／傳染病核心教材」欄目的新去處）。
// 列表由內容自動產生：document 型別、docType: curriculum、已發布的現行版；另列移轉清單裡「舊站有、還沒匯入」的教材，
// 讓讀者知道少了哪些、權責單位是誰（content/migration/core-curriculum.json 的 pending 項目）。
import { html } from '../../../scripts/lib/render.mjs';
import { pageHead, ldFor, unitLink } from '../public/_partials.mjs';
import { curricula, curriculumList } from '../public/_curriculum.mjs';

const TXT = {
  'zh-TW': {
    title: '傳染病核心教材', pro: '專業人員專區',
    lead: '給醫事與防疫人員的教學用教材：每份教材列出學習目標、章節與出處。教材只供專業版智慧查詢引用。',
    note: '目前上架的是示範匯入版（第二十八輪）：教材 PDF 正本尚未取得，內容依公開摘錄與站內已匯入內容重建、未經權責單位查證，以疾管署 PDF 正本為準。',
    pendingH: '舊站其他核心教材（尚未匯入）', pendingNote: '以下是移轉清單中舊站有、新站還沒有的教材；權責單位取得 PDF 正本後依手冊轉檔上架。',
    howH: '承辦人：怎麼上架新版教材', how: '有 PDF 正本：用 PDF 轉檔工具轉成分章機讀版；沒有正本只能示範時：用重建版工具，每句標出處、找不到出處就寫「待補」。步驟見同事操作手冊第 31 節。',
  },
  en: {
    title: 'Communicable disease core curriculum', pro: 'Health professionals',
    lead: 'Teaching material for health and public-health staff: learning objectives, chapters and sources for each. Only the professional answer engine cites it.',
    note: 'The items below are demonstration imports (round 28): the original PDFs have not been obtained, so the content is rebuilt from public excerpts and content already on this site and is not verified. The official Taiwan CDC PDF prevails.',
    pendingH: 'Other legacy-site curricula (not yet imported)', pendingNote: 'Items in the migration list that exist on the old site but not here yet; the responsible unit uploads them once the original PDF is converted.',
    howH: 'For staff: publishing a new edition', how: 'With the original PDF, use the PDF conversion tool; without it (demonstration only), use the reconstruction tool and give a source for every sentence. See section 31 of the staff guide.',
  },
};

export function pages() {
  return [{ path: '/pro/curriculum/', lang: 'zh-TW' }, { path: '/pro/curriculum/', lang: 'en' }];
}

export function meta(ctx) {
  const T = TXT[ctx.lang] ?? TXT['zh-TW'];
  return { title: T.title, description: T.lead, jsonLd: ldFor(ctx, null, [{ label: T.pro, href: '/pro/' }, { label: T.title }]) };
}

/** 移轉清單裡還沒匯入的核心教材（pending）；清單不存在時回空陣列 */
export function pendingCurricula(site) {
  const list = (site.migrationLists ?? []).find((m) => m.id === 'migration.core-curriculum');
  return (list?.items ?? []).filter((it) => it.status === 'pending' && it.oldType !== 'list');
}

export function render(ctx) {
  const T = TXT[ctx.lang] ?? TXT['zh-TW'];
  const { site } = ctx;
  const list = curricula(site);
  const pending = pendingCurricula(site);
  return html`${pageHead(ctx, { trail: [{ label: T.pro, href: '/pro/' }, { label: T.title }], h1: T.title, lead: T.lead })}
<p class="c-alert c-alert--info" role="note">${T.note}</p>
<section class="c-block" aria-labelledby="curr-h"><h2 id="curr-h">${T.title}（${list.length}）</h2>
  ${curriculumList(ctx, list, { showDisease: true })}
</section>
${pending.length ? html`<section class="c-block" aria-labelledby="curr-pending-h"><h2 id="curr-pending-h">${T.pendingH}</h2>
  <p class="muted">${T.pendingNote}</p>
  <ul class="c-linklist">${pending.map((it) => html`<li>${it.oldTitle} <span class="muted">· ${unitLink(ctx, it.owner ?? 'unit.oasis')}</span></li>`)}</ul>
</section>` : ''}
<section class="c-block" aria-labelledby="curr-how-h"><h2 id="curr-how-h">${T.howH}</h2><p>${T.how}</p></section>`;
}
