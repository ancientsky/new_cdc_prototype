// 第四十七輪：主選單小型面板（點擊展開的 disclosure，不是整面 hover mega menu）。
// 只有「傳染病、疫苗、出國與入境」三項有面板；內容一律由入口頁已有的資料推導，不另維護一份（設計理由見 docs/navigation.md）。
// 規則：連結只指向已有路由、已發布內容或目標頁上真的存在的錨點 id；找不到就不輸出那一行（和 immunizationHub 同一風格）。
// 每個面板最多 9 個連結（含「前往○○專區」）、最少 4 個；每欄最多 5 個。
import { html, raw } from '../../../scripts/lib/render.mjs';
import { langAvailable } from '../../../scripts/lib/pages.mjs';
import { hrefFor, L, denguemapLink } from './_partials.mjs';
import { immunizationLinks } from './vaccines.mjs';
import * as TravelMap from './_travel-map.mjs';

/** 傳染病面板「近期與常見」最多幾個疾病頁（9 − 欄二 5 個 − 前往專區 1 個 = 3；同時符合每欄 ≤ 5）。
 *  第五十七輪：欄二加「登革熱地圖 ↗」（外部、開新視窗），疾病頁由 4 個減為 3 個。 */
export const DISEASE_MAX = 3;
/** 有面板的主選單項目：路徑 → 面板 key（之後要加面板：在 navPanels 加一組、在這裡登記） */
export const PANEL_OF = { '/diseases/': 'diseases', '/vaccines/': 'vaccines', '/travel/': 'travel' };

const col = (site, name) => site?.collections?.[name] ?? [];

/** 傳染病：先列疫情現況（situation/current.json）的疾病頁，再以 reviewedAt 最新的已發布疾病頁補足；去重 */
function diseaseLinks(ctx) {
  const { site, lang } = ctx;
  const ok = (d) => d && d.status === 'published' && langAvailable(site, d, lang);
  const all = col(site, 'diseases');
  const out = [];
  const add = (d) => {
    if (ok(d) && !out.includes(d) && out.length < DISEASE_MAX) out.push(d);
  };
  for (const it of site?.situation?.items ?? []) add(all.find((d) => d.id === it.disease));
  [...all]
    .filter(ok)
    .sort((a, b) => String(b.reviewedAt ?? '').localeCompare(String(a.reviewedAt ?? '')))
    .forEach(add);
  return out.map((d) => ({ href: hrefFor(ctx, d), label: L(ctx, d, 'title') }));
}

function build(ctx) {
  const { site, t, url } = ctx;
  const name = (k) => t(`nav.${k}`);
  const goto = (k, path) => ({ href: url(path), label: t('nav.panel.goto', { name: name(k) }) });

  // 疫苗：與 /vaccines/ 的預防接種專區導覽（immunizationHub）同一份連結資料，兩邊同步
  // 本語言沒有版本（會連到中文頁、標題也是中文）的內容不放進面板：每頁都有主選單，外語頁不該因此滿版中文
  const vx = immunizationLinks(ctx).filter((l) => !l.fallback);
  const pick = (key) => vx.find((l) => l.key === key);
  const vxLink = (l) => (l ? { href: l.href, label: l.label, ...(l.ext ? { ext: true } : {}) } : null);

  // 出國與入境：錨點 id 與 travel.mjs 實際輸出一致（tv-lookup 是 section id，其餘是 h2 id）；世界地圖區塊沒有地圖模組時不輸出
  const tv = (id, label) => ({ href: `${url('/travel/')}#${id}`, label });
  const quarantineDoc = col(site, 'documents').some((d) => d.isCurrent && d.status === 'published' && /檢疫/.test(d.title ?? ''));
  const hasMap = typeof TravelMap.worldMap === 'function';

  return {
    diseases: {
      cols: [
        { title: t('nav.panel.recent'), links: diseaseLinks(ctx) },
        {
          title: t('nav.panel.find'),
          links: [
            { href: url('/diseases/'), label: t('nav.panel.all.diseases', { n: site?.master?.diseases?.length ?? 0 }) },
            { href: url('/situation/'), label: t('nav.situation') },
            // 第五十七輪：登革熱地圖（概念原型，docs/denguemap-integration.md 1.2）；與疫苗面板的 vaxmap 同為外部連結、開新視窗 ↗
            site?.config?.denguemapUrl ? { href: denguemapLink(ctx, { view: 'map' }), label: t('denguemap.short'), ext: true } : null,
            { href: url('/documents/'), label: t('nav.panel.docs.pro'), pro: true },
            { href: url('/report/'), label: t('nav.panel.report.pro'), pro: true },
          ].filter(Boolean),
        },
      ],
      all: goto('diseases', '/diseases/'),
    },
    vaccines: {
      cols: [
        { title: t('nav.panel.getvax'), links: ['schedule', 'bygroup', 'vaxmap', 'record'].map((k) => vxLink(pick(k))).filter(Boolean) },
        { title: t('nav.panel.apply'), links: [vxLink(pick('injury')), vxLink(vx.find((l) => l.group === 'fund')), vxLink(pick('stats'))].filter(Boolean) },
      ],
      all: goto('vaccines', '/vaccines/'),
    },
    travel: {
      cols: [
        {
          title: t('nav.panel.before'),
          links: [
            tv('tv-lookup', t('travel.lookup.t')),
            { href: url('/tasks/travel/'), label: t('nav.panel.prep') },
            tv('tv-tb-h', t('travel.table.t')),
            hasMap ? tv('tv-mp-h', t('travel.map.t')) : null,
          ].filter(Boolean),
        },
        {
          title: t('nav.panel.latest'),
          links: [
            tv('tv-ch-h', t('nav.panel.changes')),
            tv('tv-nw-h', t('nav.panel.news')),
            quarantineDoc ? { href: url('/documents/'), label: t('nav.panel.quarantine.pro'), pro: true } : null,
          ].filter(Boolean),
        },
      ],
      all: goto('travel', '/travel/'),
    },
  };
}

// 每頁都會呼叫：同一個 site＋語言＋網址前綴只算一次
const memo = new WeakMap();
/** @returns {{ diseases: any, vaccines: any, travel: any }} */
export function navPanels(ctx) {
  const site = ctx.site;
  if (!site || typeof site !== 'object') return build(ctx);
  const key = `${ctx.lang}|${ctx.url('/')}`;
  let m = memo.get(site);
  if (!m) memo.set(site, (m = new Map()));
  if (!m.has(key)) m.set(key, build(ctx));
  return m.get(key);
}

const CHEV = raw(
  '<svg class="c-nav__chev" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M6 9l6 6 6-6"/></svg>',
);

/** 一個面板的標記：<details data-nav-dd> 包 summary（只有 chevron＋sr-only 名稱）與面板；面板內不放標題元素 */
export function navPanelHtml(ctx, key, label) {
  const { t } = ctx;
  const p = navPanels(ctx)[key];
  if (!p) return '';
  const li = (l) =>
    html`<li${l.pro ? raw(' class="c-pro-only"') : ''}><a href="${l.href}"${l.ext ? raw(' target="_blank" rel="noopener"') : ''}>${l.label}${l.ext ? html` ↗<span class="sr-only">${ctx.lang === 'zh-TW' ? `（${t('denguemap.newwin')}）` : ` (${t('denguemap.newwin')})`}</span>` : ''}</a></li>`;
  return html`<details class="c-nav__dd" data-nav-dd>
    <summary class="c-nav__more"><span class="sr-only">${t('nav.more', { name: label })}</span>${CHEV}</summary>
    <div class="c-nav__panel" id="nav-panel-${key}" role="group" aria-label="${t('nav.panel.label', { name: label })}">
      ${p.cols
        .filter((c) => c.links.length)
        .map(
          (c) =>
            html`<div class="c-nav__col">
              <p class="c-nav__panel-t">${c.title}</p>
              <ul class="c-nav__panel-l">
                ${c.links.map(li)}
              </ul>
            </div>`,
        )}
      <p class="c-nav__panel-all"><a href="${p.all.href}">${p.all.label}</a></p>
    </div>
  </details>`;
}
