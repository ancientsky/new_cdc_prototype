// 疾病頁（骨架版；Agent C 依 wireframe 第 7 頁補完八區塊、一分鐘重點、三層露出、JSON-LD）
import { html, raw } from '../../../scripts/lib/render.mjs';
import { md } from '../../../scripts/lib/markdown.mjs';

export function meta(ctx, { item }) { return { title: item.title, description: item.summary, item }; }

export function render(ctx, { item }) {
  const { site, t, url, fmtDate } = ctx;
  const owner = site.unitById.get(item.owner);
  const sit = site.situation.items.find((i) => i.disease === item.id);
  return html`
<article class="disease">
  <header class="disease__head">
    ${sit ? html`<p class="c-status-line"><span class="c-status-tag c-status-tag--${sit.status}">目前疫情：${t(`status.${sit.status}`)}</span> ${sit.metricLabel} ${sit.metricValue} · ${t('dataDate')} ${fmtDate(site.situation.dataDate)} <a href="${url('/situation/')}">看趨勢與地圖</a></p>` : ''}
    <h1>${item.title} <small lang="en">${item.nameEn}</small> <small>· 第${item.legalCategory}類法定傳染病</small></h1>
    <p class="lead">${item.summary}</p>
    <p class="c-provenance">${t('prov.owner')}：${owner?.name} · ${t('prov.reviewed')}：${fmtDate(item.reviewedAt)} · ${t('prov.next')}：${fmtDate(item.gov.nextReviewAt)} ${item.gov.whitelist.effective ? html`· <span class="ok">本頁可被 AI 引用 · 結構化資料已提供</span>` : ''}</p>
    ${item.gov.annotations.map((a) => html`<div class="c-alert c-alert--${a.kind}" role="alert">${a.text}</div>`)}
  </header>
  <aside class="keyfacts"><h2>一分鐘重點</h2><dl>${Object.entries(item.keyFacts).map(([k, v]) => html`<div><dt>${{ incubation: '潛伏期', symptoms: '主要症狀', transmission: '傳染途徑', prevention: '預防', notify: '通報時限' }[k] ?? k}</dt><dd>${v}</dd></div>`)}</dl><p class="muted">來源：傳染病主檔 ${item.id} · 與 AI 問答共用同一份資料</p></aside>
  ${item.blocks.map((b) => html`<section id="${b.key}"><h2>${b.heading}</h2>${b.cards?.length ? html`<div class="cards cards--3">${b.cards.map((c) => html`<div class="c-ifcard"><span class="muted">如果你</span><strong>${c.if}</strong><p>${c.text}</p></div>`)}</div>` : ''}${raw(md(b.markdown))}${b.warning ? html`<div class="c-warning"><strong>警示徵象，出現任一項請立即就醫：</strong>${b.warning}</div>` : ''}</section>`)}
  <details class="c-page-data"><summary>${t('pagedata.title')}</summary><ul><li>schema.org/MedicalCondition · JSON-LD</li><li>API：<a href="${url(`/v1/diseases/${item.slug}.json`, { noLang: true })}">/v1/diseases/${item.slug}.json</a></li><li>機讀版：<a href="${url(`/diseases/${item.slug}.md`)}">${item.slug}.md</a></li><li>授權：${site.config.licenses.labels[item.license] ?? item.license}</li><li>${item.gov.whitelist.effective ? t('pagedata.whitelist') : `${t('pagedata.notwhitelist')}（${item.gov.whitelist.reasons.join('、')}）`}</li></ul></details>
</article>`;
}

export function markdown(ctx, { item }) {
  const owner = ctx.site.unitById.get(item.owner);
  const lines = [`# ${item.title}（${item.nameEn}）`, '', `> 權責單位：${owner?.name} · 最後審閱：${item.reviewedAt} · 下次審閱：${item.gov.nextReviewAt} · 授權：${item.license} · 正本：${ctx.url(`/diseases/${item.slug}/`, { absolute: true })}`];
  for (const a of item.gov.annotations) lines.push(`> ⚠ ${a.text}`);
  lines.push('', item.summary, '', '## 一分鐘重點', ...Object.entries(item.keyFacts).map(([k, v]) => `- ${k}: ${v}`));
  for (const b of item.blocks) { lines.push('', `## ${b.heading}`, ''); if (b.cards) for (const c of b.cards) lines.push(`- 如果你${c.if}：${c.text}`); if (b.markdown) lines.push(b.markdown); if (b.warning) lines.push('', `**警示徵象：**${b.warning}`); }
  return lines.join('\n') + '\n';
}
