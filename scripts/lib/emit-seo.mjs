// sitemap、robots.txt、llms.txt（骨架版；Agent A 補完分類 sitemap、七語 llms、.md 生成 helper）
import { config, siteOrigin } from '../../site.config.mjs';
import { makeUrl } from './render.mjs';

export function emitSeo(site, write) {
  const origin = siteOrigin();
  const u = makeUrl('zh-TW');
  const abs = (p) => `${config.siteUrl}${u(p)}`;
  const urls = ['/', '/situation/', '/diseases/', '/vaccines/', '/travel/', '/factcheck/', '/data/', '/news/', '/faq/', '/documents/', '/pro/', '/developers/', '/policy/ai/', '/transparency/', '/guide/'];
  for (const d of site.collections.diseases) urls.push(`/diseases/${d.slug}/`);
  for (const n of site.collections.news) urls.push(`/news/${n.id.replace(/^news\./, '')}/`);
  for (const d of site.collections.documents.filter((x) => x.isCurrent)) urls.push(`/documents/${d.id.replace(/^doc\./, '')}/`);
  write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((p) => `  <url><loc>${abs(p)}</loc><lastmod>${site.today}</lastmod></url>`).join('\n')}\n</urlset>\n`);
  write('robots.txt', `# ${config.name} 新官網原型\n# 政策依據：AI 與資料使用聲明 ${abs('/policy/ai/')}\nUser-agent: *\nAllow: /\nDisallow: ${config.basePath}/ask/\nDisallow: ${config.basePath}/admin/\n\nSitemap: ${abs('/sitemap.xml')}\n`);
  write('llms.txt', `# ${config.name}（Taiwan CDC）新官網原型\n\n> 本檔列出可供 AI 系統引用的正本內容與資料出口；引用時請附頁面 URL 與「最後審閱日」。\n\n## API\n- [傳染病主檔](${abs('/v1/diseases.json')})\n- [疫情態勢](${abs('/v1/situation.json')})\n- [FAQ](${abs('/v1/faq.json')})\n- [資料目錄](${abs('/v1/catalog.json')})\n- [OpenAPI](${abs('/openapi.json')})\n`);
  void origin;
}
