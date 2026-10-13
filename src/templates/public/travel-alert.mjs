// 每則國際重要疫情資訊頁 /travel/alerts/{id}/（第四十三輪，docs/intl-epidemic.md §4「前台」）。
// 資料：data/snapshots/travel-epidemic.json 每列（scripts/lib/travel-alerts.mjs 的 alertOf() 正規化）。
// 只有合法 id（[A-Za-z0-9_-]{1,64}）且未撤下（status≠withdrawn）的列才有頁；快照還沒有 id 時本模板不產生任何頁，
// /travel/ 與目的地頁的列表也維持舊行為（不連站內頁）。
// 七語：頁面骨架用 i18n（travel.alert.*）；內文、建議、地區細節只有中文 ⇒ 外語頁照樣顯示中文（lang="zh-TW"），並加一句「此則僅有中文」。
import { html, raw } from '../../../scripts/lib/render.mjs';
import { md } from '../../../scripts/lib/markdown.mjs';
import * as JL from '../../../scripts/lib/jsonld.mjs';
import { alertPageRows, alertPath, looksLikeMarkdown, paragraphsOf, excerptOf } from '../../../scripts/lib/travel-alerts.mjs';
import { ldFor, pageHead, sectionHead, askBox, hrefFor, L, diseasePage, feedback, zhOnlyTag } from './_partials.mjs';
import { travelStyles, areaChips, diseaseMasterOf, dname, cname, clinicLink } from './travel.mjs';

export function pages(site) {
  return alertPageRows(site).map((alert) => ({
    path: alertPath(alert.id),
    lang: '*',
    props: { alert },
    md: true,
    lastmod: alert.updated ?? alert.published ?? undefined,
  }));
}

const SRC_KEYS = new Set(['feed', 'push', 'official-export', 'manual']);
const sep = (ctx) => (ctx.lang === 'zh-TW' ? '、' : ', ');
const zhAttr = (ctx) => (ctx.lang === 'zh-TW' ? '' : raw(' lang="zh-TW"'));

/** 涉及國家名稱（依語言；主檔有就用主檔名稱） */
function areaNames(ctx, a) {
  const byIso = new Map((ctx.site.master.countries ?? []).map((c) => [c.iso2, c]));
  return a.areas
    .map((x) => {
      const c = x.iso2 ? byIso.get(x.iso2) : null;
      return c ? cname(ctx, c) : ((ctx.lang === 'zh-TW' ? (x.country ?? x.countryEn) : (x.countryEn ?? x.country)) ?? x.iso2);
    })
    .filter(Boolean)
    .join(sep(ctx));
}

/** 疾病名稱（外語頁：英文名或主檔英文名）；dname 吃 { disease, diseaseEn, diseaseId } */
const diseaseName = (ctx, a) => (a.disease ? dname(ctx, ctx.site, a) : '');

/** 頁標題：中文頁用 headline；外語頁用「疾病：國家」（headline 是中文，另列在頁首下方） */
function titleOf(ctx, a) {
  if (ctx.lang === 'zh-TW' && a.headline) return a.headline;
  const areas = areaNames(ctx, a);
  const disease = diseaseName(ctx, a);
  if (disease && areas) return ctx.t('travel.alert.h1', { disease, areas });
  return disease || areas || a.headline || a.id;
}

const diseasePageOf = (ctx, a) => {
  if (!a.disease && !a.diseaseId) return null;
  const m = diseaseMasterOf(ctx.site, a);
  return m ? diseasePage(ctx, m.id) : null;
};

const srcLabel = (ctx, a) => ctx.t(`travel.alert.src.${SRC_KEYS.has(a.provenance?.source) ? a.provenance.source : 'unknown'}`);

/** 內文：含 Markdown 就經 md() 淨化；否則每個換行一段 */
function bodyHtml(ctx, text) {
  if (!text) return '';
  if (looksLikeMarkdown(text)) return html`<div class="ta-body c-prose" ${zhAttr(ctx)}>${raw(md(text))}</div>`;
  return html`<div class="ta-body" ${zhAttr(ctx)}>${paragraphsOf(text).map((p) => html`<p>${p}</p>`)}</div>`;
}

const CSS = `
.ta-meta{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:4px var(--sp-4);margin:var(--sp-3) 0 0;max-width:860px}
.ta-meta dt{color:var(--ink-3);font-size:var(--fs-sm)} .ta-meta dd{margin:0}
.ta-meta .tv-chips{margin:0}
.ta-zh{margin:var(--sp-2) 0 0;color:var(--ink-2)}
.ta-asof{max-width:860px;border:1px solid var(--line);border-left:4px solid var(--ink-3);border-radius:var(--radius);background:var(--paper);padding:var(--sp-2) var(--sp-4);font-size:var(--fs-sm);color:var(--ink-2)}
.ta-body{max-width:860px} .ta-body p{margin:0 0 var(--sp-3)}
.ta-src{max-width:860px} .ta-src ul{margin:0;padding-left:1.1em} .ta-src li{margin:2px 0}
@media (max-width:720px){.ta-meta{grid-template-columns:1fr}}
`;

export function meta(ctx, { alert: a } = {}) {
  const { t } = ctx;
  const title = titleOf(ctx, a);
  const description =
    ctx.lang === 'zh-TW' && a.body
      ? excerptOf(a.body, 120)
      : t('travel.alert.desc', { date: a.published ?? '', disease: diseaseName(ctx, a) || '—', areas: areaNames(ctx, a) || '—' });
  const jsonLd = ldFor(ctx, null, [{ label: t('nav.travel'), href: '/travel/' }, { label: title }]);
  try {
    jsonLd.push(JL.travelAlertJsonLd(ctx, a));
  } catch {
    /* JSON-LD 失敗不拖垮頁面 */
  }
  return { title: `${title} · ${t('travel.alert.kind')}`, description, jsonLd, pagefind: { type: 'travel', audience: ['public'] } };
}

export function render(ctx, { alert: a } = {}) {
  const { t, url, fmtDate } = ctx;
  const title = titleOf(ctx, a);
  const dp = diseasePageOf(ctx, a);
  const dn = diseaseName(ctx, a);
  const zh = ctx.lang !== 'zh-TW';
  const metaList = html`<dl class="ta-meta">
    ${
      a.published
        ? html`<dt>${t('travel.alert.published')}</dt>
            <dd><time datetime="${a.published}">${fmtDate(a.published)}</time></dd>`
        : ''
    }
    ${
      a.updated && a.updated !== a.published
        ? html`<dt>${t('travel.alert.updated')}</dt>
            <dd><time datetime="${a.updated}">${fmtDate(a.updated)}</time></dd>`
        : ''
    }
    ${
      dn
        ? html`<dt>${t('travel.alert.disease')}</dt>
            <dd>${dp ? html`<a href="${hrefFor(ctx, dp)}">${dn}</a>` : dn}</dd>`
        : ''
    }
    ${
      a.areas.length
        ? html`<dt>${t('travel.alert.areas')}</dt>
            <dd>
              <ul class="tv-chips">
                ${areaChips(ctx, a.areas)}
              </ul>
            </dd>`
        : ''
    }
  </dl>`;
  const head = pageHead(ctx, {
    trail: [{ label: t('nav.travel'), href: '/travel/' }, { label: title }],
    h1: title,
    lead: t('travel.alert.kind'),
    tags: html`${zh && a.headline ? html`<p class="ta-zh">${zhOnlyTag(ctx)} <span lang="zh-TW">${a.headline}</span></p>` : ''}${metaList}`,
  });
  const refs = a.references ?? [];
  const p = a.provenance;
  const askAreas = areaNames(ctx, a) || dn;
  return html`${travelStyles}<style>
      ${raw(CSS)}
    </style>
    <div class="tv ta">
      ${head}
      <p class="ta-asof">${t('travel.alert.asof', { date: a.published ? fmtDate(a.published) : '—' })}${zh ? html` ${t('travel.alert.zhonly')}` : ''}</p>
      ${a.body ? html`<section aria-labelledby="ta-b-h">${sectionHead(ctx, { id: 'ta-b-h', title: t('travel.alert.body') })}${bodyHtml(ctx, a.body)}</section>` : ''}
      ${a.instruction ? html`<section aria-labelledby="ta-i-h">${sectionHead(ctx, { id: 'ta-i-h', title: t('travel.alert.instruction') })}${bodyHtml(ctx, a.instruction)}</section>` : ''}
      <section class="ta-src" aria-labelledby="ta-s-h">
        ${sectionHead(ctx, { id: 'ta-s-h', title: t('travel.alert.source') })}
        <ul>
          <li>
            ${srcLabel(ctx, a)}${p?.producer ? html` · ${t('travel.alert.producer')}${ctx.lang === 'zh-TW' ? '：' : ': '}<span${zhAttr(ctx)}>${p.producer}</span>` : ''}
          </li>
          ${a.sourceUrl ? html`<li><a href="${a.sourceUrl}" rel="noopener">${t('travel.alert.original')} ↗</a></li>` : ''}
          ${refs.length ? html`<li>${t('travel.alert.refs')}：${refs.map((r, i) => html`${i ? sep(ctx) : ''}<a href="${r.url}" rel="noopener">${r.title}</a>`)}</li>` : ''}
        </ul>
      </section>
      <section class="tv-rel" aria-labelledby="ta-r-h">
        ${sectionHead(ctx, { id: 'ta-r-h', title: t('travel.alert.related') })}
        <ul>
          ${dp ? html`<li><a href="${hrefFor(ctx, dp)}">${t('travel.alert.diseasePage', { name: L(ctx, dp, 'title') })}</a></li>` : ''}
          <li>${clinicLink(ctx)}</li>
          <li><a href="${url('/travel/')}#tv-nw-h">${t('travel.alert.all')}</a></li>
        </ul>
      </section>
      <section class="c-ask-inline">
        ${askBox(ctx, { id: 'taq', size: 'md', task: 'travel', placeholder: askAreas ? t('travel.alert.ask.ph', { areas: askAreas }) : t('travel.ask.ph') })}
      </section>
      ${feedback(ctx, { page: ctx.path })}
    </div>`;
}

/** 同頁 .md 機讀版：欄位用該語言標籤，內文保留中文原文 */
export function markdown(ctx, { alert: a } = {}) {
  const { t } = ctx;
  const line = (s) => String(s ?? '').replace(/\n+/g, ' ');
  const dp = diseasePageOf(ctx, a);
  const out = [`# ${titleOf(ctx, a)}`, ''];
  if (ctx.lang !== 'zh-TW' && a.headline) out.push(`> ${t('travel.alert.zhonly')} ${a.headline}`, '');
  out.push(`- ID：${a.id}`);
  if (a.published) out.push(`- ${t('travel.alert.published')}：${a.published}`);
  if (a.updated && a.updated !== a.published) out.push(`- ${t('travel.alert.updated')}：${a.updated}`);
  if (a.disease) out.push(`- ${t('travel.alert.disease')}：${diseaseName(ctx, a)}${dp ? `（${hrefFor(ctx, dp)}）` : ''}`);
  if (a.areas.length)
    out.push(
      `- ${t('travel.alert.areas')}：${a.areas.map((x) => `${x.country ?? x.countryEn ?? x.iso2}${x.iso2 ? ` ${x.iso2}` : ''}${x.detail ? `（${line(x.detail)}）` : ''}`).join('、')}`,
    );
  out.push(
    `- ${t('travel.alert.source')}：${srcLabel(ctx, a)}${a.provenance?.producer ? ` · ${a.provenance.producer}` : ''}${a.sourceUrl ? ` · ${a.sourceUrl}` : ''}`,
    '',
  );
  out.push(`> ${t('travel.alert.asof', { date: a.published ?? '—' })}`, '');
  if (a.body) out.push(`## ${t('travel.alert.body')}`, '', a.body, '');
  if (a.instruction) out.push(`## ${t('travel.alert.instruction')}`, '', a.instruction, '');
  if (a.references?.length) out.push(`## ${t('travel.alert.refs')}`, '', ...a.references.map((r) => `- [${line(r.title)}](${r.url})`), '');
  return out.join('\n');
}
