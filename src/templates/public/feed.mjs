// /news/feed.xml：RSS 2.0（新聞稿與澄清）。使用自己的 layout 輸出 XML。
import { config, siteOrigin } from '../../../site.config.mjs';
import { itemPath, publishedOf, byDateDesc } from './_partials.mjs';

const x = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export function meta() { return {}; }
export function render(ctx) {
  const { site } = ctx;
  const items = [...publishedOf(site, 'news'), ...publishedOf(site, 'clarifications')].sort(byDateDesc).slice(0, 50);
  const link = (i) => `${config.siteUrl}${config.basePath}${itemPath(i)}`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>${x(config.name)} · 新聞稿與澄清</title><link>${x(siteOrigin())}/news/</link><description>${x(config.nameEn)} press releases and clarifications</description><language>zh-TW</language>
${items.map((i) => `<item><title>${x(i.title)}</title><link>${x(link(i))}</link><guid isPermaLink="false">${x(i.id)}</guid><pubDate>${new Date(`${i.publishedAt}T00:00:00+08:00`).toUTCString()}</pubDate><description>${x(i.summary)}</description></item>`).join('\n')}
</channel></rss>
`;
}
export function layout(ctx, { body }) { return String(body); }
export function pages() { return [{ path: '/news/feed.xml', file: true, props: {} }]; }
