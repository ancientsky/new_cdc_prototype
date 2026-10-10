// SEO／機讀輸出：sitemap index + 分類 sitemap、robots.txt（附錄 H）、llms.txt（七語）、feeds/*.xml（RSS 2.0）
//
// emitSeo(site, write, { pages }?)：
//   - 預設由集合推算頁面（與 4.1 路由、pages.mjs 的 langAvailable 規則一致：用 item.gov.renderableLangs）。
//   - 若整合者傳入實際頁面清單（renderAllPages 收集的 [{path, lang, noindex, file}]），以實際清單為準：
//       emitSeo(site, writeOut, { pages: await collectPages(site) })
// 失效版本：不進 sitemap、頁面 noindex，但 robots.txt 不擋（要讓爬蟲讀得到 noindex，見 7.7(3)）。
import { config } from '../../site.config.mjs';
import { makeUrl } from './render.mjs';
import { toRfc822 } from './dates.mjs';
import { pathOf, mdPathOf, NOTICE_TYPES } from './governance.mjs';
// 第九輪（ARCHITECTURE 17.1）：排程中（publishAt 未到）內容不進 sitemap／llms.txt／RSS：各輸出函式先換成 publicView，再以 isPublic() 過濾
import { isPublic, nowOf, publicView } from './lanes.mjs';

const LANGS = () => config.langs.map((l) => l.code);
const urlFns = new Map();
const urlFor = (lang) => { if (!urlFns.has(lang)) urlFns.set(lang, makeUrl(lang)); return urlFns.get(lang); };
/** 某語言的絕對網址 */
export const absUrl = (path, lang = 'zh-TW') => urlFor(lang)(path, { absolute: true });
const apiUrl = (p) => absUrl(p, 'zh-TW');
export const xmlEsc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const maxDate = (arr) => arr.filter(Boolean).sort().at(-1) ?? null;
const rfc822 = toRfc822; // 第二十五輪：日期輸出一律經 dates.mjs

/** 靜態頁（zh-TW；其他語言是否存在依模板而定，推算模式只確定首頁為七語） */
export const STATIC_PATHS = ['/', '/situation/', '/diseases/', '/vaccines/', '/travel/', '/factcheck/', '/data/', '/news/', '/faq/', '/documents/', '/pro/', '/developers/', '/policy/ai/', '/policy/privacy/', '/policy/open-data/', '/policy/legal/', '/policy/foia/', '/policy/security/', '/policy/copyright/', '/accessibility/', '/about/', '/transparency/', '/guide/', '/glossary/', '/subscribe/',
  // 第二輪（ARCHITECTURE 11.2）
  '/campaigns/', '/media/', '/services/', '/apply/', '/publications/', '/lab/', '/report/', '/research/', '/notices/', '/contact/',
  // 第七輪（ARCHITECTURE 15.2）：人才招募、採購公告（列表頁七語；/careers/{slug}/apply/ 模擬報名頁 noindex，不進 sitemap）
  '/careers/', '/procurement/'];
/** 分類 sitemap（zh-TW）；其餘語言各一份 sitemap-{lang}.xml */
export const SITEMAP_GROUPS = ['pages', 'diseases', 'news', 'documents', 'faq', 'media', 'publications'];
/** 推算模式下七語皆輸出的靜態頁（與民眾端模板 lang:'*' 一致；任務頁與旅遊國家頁亦為七語） */
export const LOCALIZED_STATIC_PATHS = ['/', '/situation/', '/diseases/', '/vaccines/', '/travel/', '/factcheck/', '/data/', '/news/', '/faq/', '/documents/', '/careers/', '/procurement/'];
const EXCLUDE = [/^\/admin\//, /^\/ask\//, /^\/404\.html$/, /^\/careers\/[^/]+\/apply\//];

/** 由集合推算全部可索引頁面：[{ path, lang, lastmod, group }] */
export function derivePages(fullSite) {
  const site = publicView(fullSite);
  const now = nowOf(site);
  const c = site.collections;
  const pub = (arr) => (arr ?? []).filter((i) => isPublic(i, now) && !i.gov?.superseded && !i.gov?.scheduled);
  const latest = maxDate(site.all.filter((i) => isPublic(i, now)).map((i) => i.reviewedAt)) ?? site.today;
  const out = [];
  const add = (path, langs, lastmod, group) => { for (const lang of langs) out.push({ path, lang, lastmod, group }); };
  const groupMax = (arr) => maxDate(arr.map((i) => i.reviewedAt)) ?? latest;
  const listLast = { '/diseases/': groupMax(pub(c.diseases)), '/news/': groupMax(pub(c.news)), '/faq/': groupMax(pub(c.faq)), '/documents/': groupMax(pub(c.documents)), '/vaccines/': groupMax(pub(c.vaccines)), '/factcheck/': groupMax(pub(c.clarifications)), '/data/': groupMax(pub(c.datasets)), '/situation/': site.situation?.publishedAt ?? latest,
    '/campaigns/': groupMax(pub(c.banners)), '/media/': groupMax(pub(c.media)), '/services/': groupMax(pub(c.services)), '/apply/': groupMax(pub(c.services)), '/publications/': groupMax(pub(c.publications)),
    '/lab/': groupMax(pub(c.labtests)), '/research/': groupMax(pub(c.research)), '/notices/': groupMax(pub(c.news).filter((n) => NOTICE_TYPES.has(n.newsType))), '/report/': site.today,
    '/careers/': groupMax(pub(c.jobs)), '/procurement/': groupMax(pub(c.tenders)) };
  for (const p of STATIC_PATHS) add(p, LOCALIZED_STATIC_PATHS.includes(p) ? LANGS() : ['zh-TW'], listLast[p] ?? latest, 'pages');
  for (const t of config.tasks) add(`/tasks/${t.key}/`, LANGS(), latest, 'pages');
  for (const ctry of site.master.countries ?? []) if (ctry.iso2) add(`/travel/${ctry.iso2.toUpperCase()}/`, LANGS(), site.snapshots?.travelAlerts?.meta?.fetchedAt?.slice?.(0, 10) ?? latest, 'pages');
  const contentGroups = [['diseases', c.diseases], ['vaccines', c.vaccines], ['faq', c.faq], ['news', c.news], ['documents', c.documents],
    ['media', c.media], ['publications', c.publications], ['publications', c.articles], ['pages', c.topics], ['pages', c.services], ['pages', c.labtests], ['pages', c.research], ['pages', c.jobs], ['pages', c.tenders]];
  for (const [group, arr] of contentGroups) for (const i of pub(arr)) add(pathOf(i), i.gov?.renderableLangs ?? ['zh-TW'], i.reviewedAt, group === 'vaccines' ? 'pages' : group);
  for (const pg of pub(c.pages)) add(pathOf(pg), pg.gov?.renderableLangs ?? ['zh-TW'], pg.reviewedAt, 'pages');
  // 去重（content/pages 可能與靜態頁重疊）
  const seen = new Set();
  return out.filter((p) => { const k = `${p.lang}|${p.path}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

/** 由模板實際收集頁面（async；整合者可用來取代推算） */
export async function collectPages(fullSite) {
  const site = publicView(fullSite);
  const { loadTemplates } = await import('./pages.mjs');
  const mods = await loadTemplates();
  const out = [];
  for (const { mod } of mods) {
    if (typeof mod.pages !== 'function') continue;
    for (const p of mod.pages(site)) {
      const langs = p.lang === '*' ? LANGS() : [p.lang ?? 'zh-TW'];
      for (const lang of langs) out.push({ path: p.path, lang, noindex: !!(p.noindex || p.props?.item?.gov?.noindex), file: !!p.file, lastmod: p.props?.item?.reviewedAt });
    }
  }
  return out;
}

function groupOf(path) {
  const m = path.match(/^\/(diseases|news|documents|faq|media|publications)\/[^/]+\/(?:\d+\/)?$/);
  return m ? m[1] : 'pages';
}

function normalizePages(site, pages) {
  // 用完整 site 對照：排程中內容 gov.noindex=true ⇒ 即使頁面清單裡有也排除
  const byPath = new Map((site.fullSite ?? site).all.map((i) => [pathOf(i), i]));
  const latest = maxDate(site.all.map((i) => i.reviewedAt)) ?? site.today;
  return pages
    .filter((p) => !p.noindex && !p.file && p.path.endsWith('/') && !EXCLUDE.some((re) => re.test(p.path)))
    .filter((p) => { const it = byPath.get(p.path); return !(it?.gov?.superseded || it?.gov?.noindex); })
    .map((p) => ({ path: p.path, lang: p.lang ?? 'zh-TW', lastmod: p.lastmod ?? byPath.get(p.path)?.reviewedAt ?? latest, group: groupOf(p.path) }));
}

function urlset(entries, altMap) {
  const body = entries.map((e) => {
    const alts = altMap.get(e.path) ?? [];
    const links = alts.length > 1
      ? [...alts.map((l) => `    <xhtml:link rel="alternate" hreflang="${l}" href="${xmlEsc(absUrl(e.path, l))}"/>`), `    <xhtml:link rel="alternate" hreflang="x-default" href="${xmlEsc(absUrl(e.path, alts.includes('zh-TW') ? 'zh-TW' : alts[0]))}"/>`]
      : [];
    return [`  <url>`, `    <loc>${xmlEsc(absUrl(e.path, e.lang))}</loc>`, e.lastmod ? `    <lastmod>${e.lastmod}</lastmod>` : null, ...links, `  </url>`].filter(Boolean).join('\n');
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${body}\n</urlset>\n`;
}

/** 回傳 { 'sitemap.xml': ..., 'sitemap-diseases.xml': ... } */
export function buildSitemaps(site, pages) {
  const list = pages ? normalizePages(site, pages) : derivePages(site);
  const altMap = new Map();
  for (const p of list) { if (!altMap.has(p.path)) altMap.set(p.path, []); altMap.get(p.path).push(p.lang); }
  const files = {};
  const zh = list.filter((p) => p.lang === 'zh-TW');
  for (const g of SITEMAP_GROUPS) files[`sitemap-${g}.xml`] = { entries: zh.filter((p) => p.group === g) };
  for (const lang of LANGS().filter((l) => l !== 'zh-TW')) files[`sitemap-${lang}.xml`] = { entries: list.filter((p) => p.lang === lang) };
  const out = {};
  const index = [];
  for (const [name, { entries }] of Object.entries(files)) {
    out[name] = urlset(entries, altMap);
    index.push({ name, lastmod: maxDate(entries.map((e) => e.lastmod)) ?? site.today });
  }
  out['sitemap.xml'] = `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${index.map((s) => `  <sitemap><loc>${xmlEsc(apiUrl(`/${s.name}`))}</loc><lastmod>${s.lastmod}</lastmod></sitemap>`).join('\n')}\n</sitemapindex>\n`;
  return out;
}

// ───────────────────────── robots.txt（附錄 H） ─────────────────────────

export const AI_CRAWLERS = {
  search: { label: '一、AI 搜尋與使用者即時查詢（回答時引用並附連結）：允許公開內容', agents: ['OAI-SearchBot', 'ChatGPT-User', 'Claude-SearchBot', 'Claude-User', 'PerplexityBot', 'Perplexity-User', 'DuckAssistBot'] },
  training: { label: '二、AI 模型訓練：允許公開正本內容（政府資料開放授權條款），排除後台與答案頁', agents: ['GPTBot', 'ClaudeBot', 'Google-Extended', 'Applebot-Extended', 'CCBot', 'meta-externalagent', 'Amazonbot'] },
  blocked: { label: '三、未揭露用途或不遵守本站 AI 政策之爬蟲：不允許', agents: ['Bytespider', 'img2dataset', 'omgili', 'Diffbot'] },
};

export function buildRobots(site) {
  const base = config.basePath || '';
  const disallow = [];
  for (const l of config.langs) for (const p of ['/ask/', '/admin/']) disallow.push(`${base}${l.path}${p}`);
  // 第七輪：職缺模擬報名頁（/careers/{slug}/apply/）不給爬蟲（頁面另有 noindex）；* 萬用字元為主要搜尋引擎支援的擴充語法
  for (const l of config.langs) disallow.push(`${base}${l.path}/careers/*/apply/`);
  // 第九輪（17.2）：PR 預覽站（previews 分支複製到 /preview/pr-{N}/）不給爬蟲
  disallow.push(`${base}/preview/`);
  const uniqDis = [...new Set(disallow)];
  const block = (agents, rules) => `${agents.map((a) => `User-agent: ${a}`).join('\n')}\n${rules.join('\n')}`;
  const allowRules = [`Allow: ${base}/`, ...uniqDis.map((d) => `Disallow: ${d}`)];
  const lines = [
    `# ${config.name}（${config.nameEn}）新官網原型 robots.txt`,
    `# 政策依據：AI 與資料使用聲明 ${absUrl('/policy/ai/')}`,
    `# 機讀版：每個內容頁同路徑加 .md（例：${absUrl('/diseases/dengue.md')}）；AI 用索引：${absUrl('/llms.txt')}`,
    '# 失效版本（已由新版取代）允許爬取，以頁面 <meta name="robots" content="noindex"> 退出索引，不在此封鎖。',
    '# 正式站本檔置於網域根目錄；原型位於 GitHub Pages 專案路徑，僅供示範。',
    '',
    '# 一般搜尋引擎',
    block(['*'], allowRules),
    '',
    `# ${AI_CRAWLERS.search.label}`,
    block(AI_CRAWLERS.search.agents, allowRules),
    '',
    `# ${AI_CRAWLERS.training.label}`,
    block(AI_CRAWLERS.training.agents, allowRules),
    '',
    `# ${AI_CRAWLERS.blocked.label}`,
    block(AI_CRAWLERS.blocked.agents, ['Disallow: /']),
    '',
    `Sitemap: ${apiUrl('/sitemap.xml')}`,
    ...['pages', 'diseases', 'news', 'documents', 'faq'].map((g) => `Sitemap: ${apiUrl(`/sitemap-${g}.xml`)}`),
    ...LANGS().filter((l) => l !== 'zh-TW').map((l) => `Sitemap: ${apiUrl(`/sitemap-${l}.xml`)}`),
    '',
  ];
  return lines.join('\n');
}

// ───────────────────────── llms.txt（七語） ─────────────────────────

const L10N = {
  'zh-TW': { title: `${config.name}（Taiwan CDC）`, intro: '本檔列出可供 AI 系統引用的正本內容與資料出口。內容與資料只存一份，頁面、API、機讀版（.md）皆由同一份正本產生。', rules: ['引用時請附頁面 URL 與「最後審閱日」；每個 .md 首段即為權責單位、審閱日、版本與授權。', '文件有版本鏈：只引用現行版（`/v1/documents.json` 的 `isCurrent:true`）。失效版頁面保留查閱但標示 noindex 與頁首警示，.md 第一行註明已被取代。', '新聞稿若發布早於所依據正本的修訂日，頁首會自動加註；請以現行正本為準，不以舊新聞稿作答案依據。', '疫情態勢四級（stable／rising／peak／declining）由疫情中心人工發布，請直接引用 `/v1/situation.json`，勿自行推論。', '授權：政府資料開放授權條款第 1 版（OGDL-1.0）。'], diseases: '疾病', faq: '常見問答', news: '新聞稿（近 30 則）', documents: '文件與指引（現行版）', vaccines: '疫苗', situation: '疫情態勢', api: 'API 與資料', optional: 'Optional', other: '其他語言', policy: 'AI 與資料使用聲明', opendata: '開放資料政策',
    media: '影音逐字稿', mediaNote: '影片內容以逐字稿為準；標示「依據已修訂」者製作早於現行正本，請改引現行版。', services: '申請服務', publications: '出版品', labtests: '檢驗項目（專業）', notify: '通報時限表', notifyNote: '法定傳染病類別與通報時限由傳染病主檔自動產生，請直接引用。', notices: '機關公告（人才招募、採購）', careers: '人才招募（開放中與即將開放職缺）', procurement: '採購公告（招標中）' },
  en: { title: 'Taiwan Centers for Disease Control (Taiwan CDC)', intro: 'Authoritative content and data endpoints that AI systems may cite. Each page, API record and machine-readable (.md) file is generated from a single source of truth. Traditional Chinese is the source language; only reviewed translations are listed for priority content.', rules: ['Cite the page URL and its "last reviewed" date; every .md file starts with owner, review date, version and licence.', 'Documents are versioned: cite only the current version (`isCurrent:true` in `/v1/documents.json`). Superseded versions remain accessible but are noindex and flagged on the first line.', 'Press releases published before a revision of the guidance they rely on are annotated automatically; use the current guidance, not the older release.', 'Epidemic situation levels are published manually by the Epidemic Intelligence Center; quote `/v1/situation.json`, do not infer.', 'Licence: Open Government Data License, Taiwan, v1.0.'], diseases: 'Diseases', faq: 'FAQ', news: 'News releases', documents: 'Documents and guidance (current versions)', vaccines: 'Vaccines', situation: 'Epidemic situation', api: 'API and data', optional: 'Optional', other: 'Other languages', policy: 'AI and data use statement', opendata: 'Open data policy',
    media: 'Video transcripts', mediaNote: 'Cite video content from transcripts only; items flagged as based on revised guidance predate the current version.', services: 'Applications and services', publications: 'Publications', labtests: 'Laboratory tests (professional)', notify: 'Notifiable disease reporting deadlines', notifyNote: 'Generated from the notifiable disease master list; quote directly.', notices: 'Notices (recruitment, procurement)', careers: 'Jobs (open and upcoming)', procurement: 'Procurement (open tenders)' },
  ja: { title: '台湾衛生福利部疾病管制署（Taiwan CDC）', intro: 'AI システムが引用できる正本コンテンツとデータの一覧です。中国語（繁体字）が正本で、優先コンテンツは人による確認済みの翻訳のみ掲載します。', rules: ['引用時はページ URL と最終確認日を明記してください。', '文書は現行版のみ引用してください（/v1/documents.json の isCurrent:true）。', 'ライセンス：台湾政府オープンデータライセンス第 1 版。'], diseases: '感染症', faq: 'よくある質問', news: 'プレスリリース', documents: '文書（現行版）', vaccines: 'ワクチン', situation: '流行状況', api: 'API とデータ', optional: 'Optional', other: '他の言語', policy: 'AI とデータ利用に関する声明', opendata: 'オープンデータ方針' },
  tl: { title: 'Taiwan Centers for Disease Control (Taiwan CDC)', intro: 'Mga opisyal na nilalaman at data na maaaring banggitin ng mga AI system. Ang Traditional Chinese ang orihinal na wika; mga na-review na salin lamang ang nakalista para sa pangunahing nilalaman.', rules: ['Banggitin ang URL ng pahina at ang petsa ng huling pagsusuri.', 'Banggitin lamang ang kasalukuyang bersyon ng mga dokumento (isCurrent:true sa /v1/documents.json).', 'Lisensya: Open Government Data License, Taiwan, v1.0.'], diseases: 'Mga sakit', faq: 'Mga madalas itanong', news: 'Mga balita', documents: 'Mga dokumento (kasalukuyang bersyon)', vaccines: 'Mga bakuna', situation: 'Kalagayan ng epidemya', api: 'API at data', optional: 'Optional', other: 'Iba pang wika', policy: 'Pahayag sa AI at paggamit ng data', opendata: 'Patakaran sa open data' },
  vi: { title: 'Cục Kiểm soát Dịch bệnh Đài Loan (Taiwan CDC)', intro: 'Danh sách nội dung chính thức và dữ liệu mà hệ thống AI có thể trích dẫn. Tiếng Trung phồn thể là ngôn ngữ gốc; nội dung ưu tiên chỉ liệt kê bản dịch đã được duyệt.', rules: ['Khi trích dẫn, ghi rõ URL trang và ngày duyệt gần nhất.', 'Chỉ trích dẫn phiên bản hiện hành của tài liệu (isCurrent:true trong /v1/documents.json).', 'Giấy phép: Giấy phép Dữ liệu Mở Chính phủ Đài Loan, phiên bản 1.0.'], diseases: 'Bệnh truyền nhiễm', faq: 'Câu hỏi thường gặp', news: 'Thông cáo báo chí', documents: 'Tài liệu (phiên bản hiện hành)', vaccines: 'Vắc-xin', situation: 'Tình hình dịch', api: 'API và dữ liệu', optional: 'Optional', other: 'Ngôn ngữ khác', policy: 'Tuyên bố về AI và sử dụng dữ liệu', opendata: 'Chính sách dữ liệu mở' },
  id: { title: 'Taiwan Centers for Disease Control (Taiwan CDC)', intro: 'Daftar konten resmi dan data yang dapat dikutip oleh sistem AI. Bahasa Mandarin tradisional adalah bahasa sumber; konten prioritas hanya mencantumkan terjemahan yang telah ditinjau.', rules: ['Saat mengutip, sertakan URL halaman dan tanggal tinjauan terakhir.', 'Kutip hanya versi dokumen yang berlaku (isCurrent:true di /v1/documents.json).', 'Lisensi: Open Government Data License, Taiwan, v1.0.'], diseases: 'Penyakit', faq: 'Tanya jawab', news: 'Siaran pers', documents: 'Dokumen (versi berlaku)', vaccines: 'Vaksin', situation: 'Situasi epidemi', api: 'API dan data', optional: 'Optional', other: 'Bahasa lain', policy: 'Pernyataan AI dan penggunaan data', opendata: 'Kebijakan data terbuka' },
  th: { title: 'กรมควบคุมโรคไต้หวัน (Taiwan CDC)', intro: 'รายการเนื้อหาทางการและข้อมูลที่ระบบ AI สามารถอ้างอิงได้ ภาษาจีนตัวเต็มเป็นภาษาต้นฉบับ เนื้อหาสำคัญแสดงเฉพาะคำแปลที่ผ่านการตรวจทานแล้ว', rules: ['เมื่ออ้างอิง โปรดระบุ URL ของหน้าและวันที่ตรวจทานล่าสุด', 'อ้างอิงเฉพาะเอกสารฉบับปัจจุบัน (isCurrent:true ใน /v1/documents.json)', 'สัญญาอนุญาต: Open Government Data License, Taiwan, v1.0'], diseases: 'โรคติดต่อ', faq: 'คำถามที่พบบ่อย', news: 'ข่าวประชาสัมพันธ์', documents: 'เอกสาร (ฉบับปัจจุบัน)', vaccines: 'วัคซีน', situation: 'สถานการณ์การระบาด', api: 'API และข้อมูล', optional: 'Optional', other: 'ภาษาอื่น', policy: 'แถลงการณ์ด้าน AI และการใช้ข้อมูล', opendata: 'นโยบายข้อมูลเปิด' },
};

const tr = (item, lang, field) => (lang === 'zh-TW' ? item[field] : item.i18n?.[lang]?.[field] ?? item[field]);

export function buildLlms(fullSite, lang = 'zh-TW') {
  const site = publicView(fullSite);
  const now = nowOf(site);
  const T = { ...L10N.en, ...(L10N[lang] ?? {}) };
  const c = site.collections;
  const ok = (i) => isPublic(i, now) && !i.gov?.superseded && !i.gov?.scheduled && (i.gov?.renderableLangs ?? ['zh-TW']).includes(lang);
  const line = (i) => {
    const md = mdPathOf(i);
    const title = tr(i, lang, i.type === 'faq' ? 'question' : 'title') ?? i.title;
    const sum = tr(i, lang, 'summary') ?? '';
    const flag = i.gov?.lifecycle && i.gov.lifecycle !== 'current' ? ` [${i.gov.lifecycleLabel}]` : '';
    return `- [${title}](${absUrl(md ?? pathOf(i), lang)}): ${sum}${flag}（${i.reviewedAt}）`.replace(/\s+/g, ' ').trim();
  };
  const section = (heading, items) => (items.length ? [`## ${heading}`, '', ...items.map(line), ''] : []);
  const byDate = (a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? '');
  const media = [...(c.media ?? [])].filter(ok).sort(byDate);
  const out = [
    `# ${T.title}`, '',
    `> ${T.intro}`, '',
    ...T.rules.map((r) => `- ${r}`), '',
    ...section(T.diseases, (c.diseases ?? []).filter(ok)),
    ...section(T.vaccines, (c.vaccines ?? []).filter(ok)),
    ...section(T.faq, (c.faq ?? []).filter(ok)),
    ...section(T.documents, (c.documents ?? []).filter(ok)),
    ...section(T.news, [...(c.news ?? [])].filter(ok).filter((n) => !NOTICE_TYPES.has(n.newsType)).sort(byDate).slice(0, 30)),
    ...(media.length ? [`## ${T.media}`, '', `> ${T.mediaNote}`, '', ...media.map(line), ''] : []),
    ...section(T.services, (c.services ?? []).filter(ok)),
    ...section(T.publications, [...(c.publications ?? [])].filter(ok).sort(byDate).slice(0, 30)),
    ...section(T.labtests, (c.labtests ?? []).filter(ok)),
    ...section(T.notices, [...(c.news ?? [])].filter(ok).filter((n) => NOTICE_TYPES.has(n.newsType) && !n.gov?.closed).sort(byDate).slice(0, 20)),
    // 第七輪：開放中／即將開放職缺、招標中標案（甄選名單不列；結果請看職缺頁）
    ...section(T.careers, [...(c.jobs ?? [])].filter(ok).filter((j) => ['open', 'upcoming'].includes(j.gov?.jobStage)).sort(byDate)),
    ...section(T.procurement, [...(c.tenders ?? [])].filter(ok).filter((x) => x.gov?.tenderStage === 'open').sort(byDate)),
    `## ${T.notify}`, '',
    `> ${T.notifyNote}`, '',
    `- [${T.notify}](${absUrl('/report/', 'zh-TW')}): ${(site.gov?.notifyTable ?? []).map((g) => `${g.label} ${g.diseases.length}`).join('、')}`,
    `- [notify-table.json](${apiUrl('/v1/notify-table.json')})`, '',
    `## ${T.situation}`, '',
    `- [${T.situation}](${absUrl('/situation/', lang)}): ${site.situation?.publishedAt ?? ''} · data ${site.situation?.dataDate ?? ''}`,
    `- [situation.json](${apiUrl('/v1/situation.json')})`,
    `- [RSS](${apiUrl('/feeds/situation.xml')})`, '',
    `## ${T.api}`, '',
    `- [OpenAPI 3.1](${apiUrl('/openapi.json')})`,
    `- [v1 index](${apiUrl('/v1/index.json')})`,
    `- [catalog.json](${apiUrl('/v1/catalog.json')})`,
    `- [diseases.json](${apiUrl('/v1/diseases.json')})`,
    `- [faq.json](${apiUrl('/v1/faq.json')})`,
    `- [documents.json](${apiUrl('/v1/documents.json')})`,
    `- [search-index.json](${apiUrl('/v1/search-index.json')})`,
    `- [glossary.json](${apiUrl('/v1/glossary.json')})`,
    `- [redirects.json](${apiUrl('/v1/redirects.json')})`,
    `- [media.json](${apiUrl('/v1/media.json')}) · [services.json](${apiUrl('/v1/services.json')}) · [publications.json](${apiUrl('/v1/publications.json')}) · [labtests.json](${apiUrl('/v1/labtests.json')}) · [notices.json](${apiUrl('/v1/notices.json')}) · [jobs.json](${apiUrl('/v1/jobs.json')}) · [tenders.json](${apiUrl('/v1/tenders.json')})`,
    `- [RSS news](${apiUrl('/feeds/news.xml')}) · [RSS documents](${apiUrl('/feeds/documents.xml')}) · [RSS publications](${apiUrl('/feeds/publications.xml')}) · [RSS notices](${apiUrl('/feeds/notices.xml')}) · [RSS careers](${apiUrl('/feeds/careers.xml')}) · [RSS procurement](${apiUrl('/feeds/procurement.xml')})`, '',
    `## ${T.optional}`, '',
    `- [${T.policy}](${absUrl('/policy/ai/', 'zh-TW')})`,
    `- [${T.opendata}](${absUrl('/policy/open-data/', 'zh-TW')})`,
    `- [Developers](${absUrl('/developers/', 'zh-TW')})`,
    `- ${T.other}: ${config.langs.filter((l) => l.code !== lang).map((l) => `[${l.label}](${absUrl('/llms.txt', l.code)})`).join(' · ')}`, '',
  ];
  return out.join('\n');
}

// ───────────────────────── feeds（RSS 2.0） ─────────────────────────

function rss({ title, link, self, description, items, lastBuild }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>${xmlEsc(title)}</title>
  <link>${xmlEsc(link)}</link>
  <atom:link href="${xmlEsc(self)}" rel="self" type="application/rss+xml"/>
  <description>${xmlEsc(description)}</description>
  <language>zh-TW</language>
  <lastBuildDate>${rfc822(lastBuild)}</lastBuildDate>
${items.map((it) => `  <item>
    <title>${xmlEsc(it.title)}</title>
    <link>${xmlEsc(it.link)}</link>
    <guid isPermaLink="false">${xmlEsc(it.guid)}</guid>
    <pubDate>${rfc822(it.date)}</pubDate>
${(it.categories ?? []).map((cat) => `    <category>${xmlEsc(cat)}</category>`).join('\n')}
    <description>${xmlEsc(it.description)}</description>
  </item>`).join('\n')}
</channel>
</rss>
`;
}

/** 出版品書目一行（卷期、版次、ISBN、ISSN、GPN） */
export function bibOf(p) {
  return [
    p.volume != null ? `第 ${p.volume} 卷` : '', p.issue != null ? `第 ${p.issue} 期` : '', p.edition ? `${p.edition}` : '',
    p.isbn ? `ISBN ${p.isbn}` : '', p.issn ? `ISSN ${p.issn}` : '', p.gpn ? `GPN ${p.gpn}` : '',
  ].filter(Boolean).join('，');
}

export function buildFeeds(fullSite) {
  const site = publicView(fullSite);
  const now = nowOf(site);
  const live = (i) => isPublic(i, now);
  const c = site.collections;
  const news = (c.news ?? []).filter(live).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.id.localeCompare(b.id)).slice(0, 50);
  const newsXml = rss({
    title: `${config.name} 新聞稿與通函`, link: absUrl('/news/'), self: apiUrl('/feeds/news.xml'), description: '新聞稿、致醫界通函、澄清稿；所依據正本修訂時自動加註。',
    lastBuild: maxDate(news.map((n) => n.reviewedAt)) ?? site.today,
    items: news.map((n) => ({
      title: n.title, link: absUrl(pathOf(n)), guid: n.id, date: n.publishedAt, categories: [n.newsType ?? n.type, ...(n.diseases ?? []).map((d) => site.diseaseMasterById.get(d)?.name ?? d)],
      description: [n.summary, ...(n.gov?.annotations ?? []).filter((a) => a.kind === 'based-on-revised').map((a) => `【加註】${a.text}`)].join(' '),
    })),
  });
  const docs = (c.documents ?? []).filter((d) => isPublic(d, now, { archived: true })).sort((a, b) => (b.effectiveAt ?? '').localeCompare(a.effectiveAt ?? '') || a.id.localeCompare(b.id));
  const docItems = [];
  for (const d of docs) {
    const prev = d.supersedes ? site.byId.get(d.supersedes) : null;
    const changes = (d.changes ?? []).map((ch) => `${ch.section}：${ch.before ? `${ch.before} → ` : ''}${ch.after}`).join('；');
    docItems.push({
      title: `${d.title}${d.isCurrent ? '（現行版）' : d.gov?.superseded ? '（已失效）' : ''}`, link: absUrl(pathOf(d)), guid: d.id, date: d.effectiveAt ?? d.publishedAt,
      categories: [d.docType, d.family, d.gov?.lifecycleLabel].filter(Boolean),
      description: [`版本 ${d.version ?? ''} 於 ${d.effectiveAt} 生效。`, prev ? `取代 ${prev.version ?? prev.id} 版。` : '', changes ? `異動：${changes}` : '', d.gov?.superseded ? `本版已由 ${site.byId.get(d.gov.currentId)?.version ?? d.gov.currentId} 版取代。` : ''].filter(Boolean).join(' '),
    });
  }
  const docsXml = rss({ title: `${config.name} 文件版本異動`, link: absUrl('/documents/'), self: apiUrl('/feeds/documents.xml'), description: '手冊、指引、病例定義、接種建議的新版發布與取代關係（guid＝版本 id）。', lastBuild: maxDate(docs.map((d) => d.effectiveAt)) ?? site.today, items: docItems });
  const sit = site.situation ?? {};
  const pubs = [sit, ...(sit.history ?? [])].filter((s) => s.publishedAt);
  const seen = new Set();
  const sitItems = pubs.filter((s) => (seen.has(s.publishedAt) ? false : seen.add(s.publishedAt))).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)).map((s) => ({
    title: `疫情態勢更新（資料日 ${s.dataDate ?? s.publishedAt}）`, link: absUrl('/situation/'), guid: `situation.${s.publishedAt}`, date: s.publishedAt, categories: ['situation'],
    description: (s.items ?? []).map((it) => `${site.diseaseMasterById.get(it.disease)?.name ?? it.disease}：${{ stable: '平穩', rising: '上升', peak: '高峰', declining: '下降' }[it.status] ?? it.status}${it.metricValue ? `（${it.metricLabel ?? ''} ${it.metricValue}）` : ''}`).join('；'),
  }));
  const sitXml = rss({ title: `${config.name} 疫情態勢`, link: absUrl('/situation/'), self: apiUrl('/feeds/situation.xml'), description: '疫情中心人工發布的各疾病態勢（四級）。', lastBuild: sit.publishedAt ?? site.today, items: sitItems });
  // 出版品
  // 第二十九輪：出版品 RSS 同時列出疫情報導的每一篇全文文章（訂閱者看得到篇名與摘要，不必等整本 PDF）
  const artList = (c.articles ?? []).filter(live).map((a) => ({ ...a, _issue: site.byId.get(a.issueId) }));
  const pubList = [...(c.publications ?? []).filter(live), ...artList].sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)) || a.id.localeCompare(b.id)).slice(0, 60);
  const pubXml = rss({
    title: `${config.name} 出版品`, link: absUrl('/publications/'), self: apiUrl('/feeds/publications.xml'), description: '疫情報導卷期、年報、手冊、海報等出版品（guid＝出版品 id）。',
    lastBuild: maxDate(pubList.map((p) => p.publishedAt)) ?? site.today,
    items: pubList.map((p) => ({
      title: p.type === 'article' ? `${p.title}（${p._issue?.title ?? '疫情報導'}）` : p.title, link: absUrl(pathOf(p)), guid: p.id, date: p.publishedAt,
      categories: p.type === 'article' ? ['疫情報導', 'article', p.articleType].filter(Boolean) : [p.series, p.pubType].filter(Boolean),
      description: p.type === 'article' ? [(p.authors ?? []).map((a) => a.name).join('、'), p.summary, p.pages ? `頁 ${p.pages}` : ''].filter(Boolean).join(' · ') : [p.summary, bibOf(p), ...(p.articles ?? []).slice(0, 10).map((a) => `・${a.title}`)].filter(Boolean).join(' '),
    })),
  });
  // 機關公告
  const NOTICE_LABEL = { recruit: '人才招募', procurement: '採購公告', other: '其他訊息' }; // recruit／procurement：第七輪前相容
  const notices = (c.news ?? []).filter((n) => live(n) && NOTICE_TYPES.has(n.newsType)).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.id.localeCompare(b.id)).slice(0, 50);
  const noticeXml = rss({
    title: `${config.name} 機關公告`, link: absUrl('/notices/'), self: apiUrl('/feeds/notices.xml'), description: '其他機關公告（含字號與截止日，截止後標示「已截止」）；人才招募見 feeds/careers.xml、採購公告見 feeds/procurement.xml。',
    lastBuild: maxDate(notices.map((n) => n.publishedAt)) ?? site.today,
    items: notices.map((n) => ({
      title: `${n.gov?.closed ? '【已截止】' : ''}${n.title}`, link: absUrl(pathOf(n)), guid: n.id, date: n.publishedAt, categories: [NOTICE_LABEL[n.newsType] ?? n.newsType, n.gov?.closed ? '已截止' : null].filter(Boolean),
      description: [n.summary, n.refNo ? `字號：${n.refNo}` : '', n.deadlineAt ? `截止日：${n.deadlineAt}` : '', n.positions ? `名額：${n.positions}` : '', n.budgetNtd ? `預算金額：新臺幣 ${n.budgetNtd.toLocaleString('en-US')} 元` : '', n.applyUrl ? `報名／投標：${n.applyUrl}` : ''].filter(Boolean).join(' '),
    })),
  });
  // 第七輪：人才招募（職缺公告一筆＋甄選結果一筆＋每次遞補一筆；名單不放進 feed，只給結果頁連結）
  const unitName = (id) => site.unitById?.get(id)?.name ?? id;
  const jobsPub = (c.jobs ?? []).filter(live);
  const careerItems = [];
  for (const j of jobsPub) {
    careerItems.push({
      title: `${j.gov?.jobStage && !['open', 'upcoming'].includes(j.gov.jobStage) ? `【${j.gov.jobStageLabel}】` : ''}${j.title}`, link: absUrl(pathOf(j)), guid: j.id, date: j.publishedAt,
      categories: ['人才招募', j.jobType, unitName(j.hiringUnit), j.gov?.jobStageLabel].filter(Boolean),
      description: [j.summary, j.refNo ? `字號：${j.refNo}` : '', `名額：${j.positions} 名`, `報名期間：${j.applyStart} 至 ${j.deadlineAt}`, `工作地點：${j.workplace}`, j.gov?.applyHref ? `報名：${/^https?:/.test(j.gov.applyHref) ? j.gov.applyHref : absUrl(j.gov.applyHref)}` : ''].filter(Boolean).join(' '),
    });
    if (j.result?.publishedAt) careerItems.push({
      title: `【甄選結果】${j.title}`, link: absUrl(`${pathOf(j)}#result`), guid: `${j.id}#result`, date: j.result.publishedAt, categories: ['人才招募', '甄選結果'],
      description: `正取 ${j.result.admitted?.length ?? 0} 名${j.result.waitlist?.length ? `、備取 ${j.result.waitlist.length} 名` : ''}；名單只公布報名編號與遮罩姓名，請至職缺頁查看。${j.result.refNo ? `字號：${j.result.refNo}` : ''}`,
    });
    (j.waitlistUpdates ?? []).forEach((u, i) => careerItems.push({
      title: `【遞補公告】${j.title}`, link: absUrl(`${pathOf(j)}#result`), guid: `${j.id}#waitlist-${i + 1}`, date: u.date, categories: ['人才招募', '遞補公告'],
      description: '備取人員遞補；名單只公布報名編號與遮罩姓名，請至職缺頁查看。',
    }));
  }
  careerItems.sort((a, b) => b.date.localeCompare(a.date) || a.guid.localeCompare(b.guid));
  const careersXml = rss({
    title: `${config.name} 人才招募`, link: absUrl('/careers/'), self: apiUrl('/feeds/careers.xml'), description: '人事室發布的職缺公告、甄選結果與遞補公告（guid：職缺 id；結果為 id#result、遞補為 id#waitlist-N）。名單只在職缺頁公布報名編號與遮罩姓名。',
    lastBuild: maxDate(careerItems.map((x) => x.date)) ?? site.today, items: careerItems.slice(0, 50),
  });
  // 第七輪：採購公告（招標公告一筆＋決標／流標一筆）
  const tendersPub = (c.tenders ?? []).filter(live);
  const procItems = [];
  const ntd = (n) => `新臺幣 ${Number(n).toLocaleString('en-US')} 元`;
  for (const x of tendersPub) {
    procItems.push({
      title: `${x.gov?.tenderStage && x.gov.tenderStage !== 'open' ? `【${x.gov.tenderStageLabel}】` : ''}${x.title}`, link: absUrl(pathOf(x)), guid: x.id, date: x.announcedAt ?? x.publishedAt,
      categories: ['採購公告', x.method, x.category, unitName(x.requestingUnit), x.gov?.tenderStageLabel].filter(Boolean),
      description: [x.summary, `案號：${x.tenderNo}`, `預算金額：${ntd(x.budgetNtd)}`, `投標截止：${x.deadlineAt}`, x.openingAt ? `開標：${x.openingAt}` : '', x.pccUrl ? `政府電子採購網：${x.pccUrl}` : ''].filter(Boolean).join(' '),
    });
    if (x.award) procItems.push({
      title: `【決標】${x.title}`, link: absUrl(`${pathOf(x)}#award`), guid: `${x.id}#award`, date: x.award.date, categories: ['採購公告', '決標'],
      description: [`案號：${x.tenderNo}`, `決標日：${x.award.date}`, x.award.amountNtd != null ? `決標金額：${ntd(x.award.amountNtd)}` : '', `得標廠商：${x.award.winner}`].filter(Boolean).join(' '),
    });
    if (x.manualStatus === 'failed' || x.manualStatus === 'cancelled') procItems.push({
      title: `【${x.manualStatus === 'failed' ? '流標' : '取消'}】${x.title}`, link: absUrl(`${pathOf(x)}#award`), guid: `${x.id}#${x.manualStatus}`, date: x.openingAt ?? x.deadlineAt, categories: ['採購公告', x.manualStatus === 'failed' ? '流標' : '取消'],
      description: [`案號：${x.tenderNo}`, x.manualStatusNote ?? ''].filter(Boolean).join(' '),
    });
  }
  procItems.sort((a, b) => b.date.localeCompare(a.date) || a.guid.localeCompare(b.guid));
  const procXml = rss({
    title: `${config.name} 採購公告`, link: absUrl('/procurement/'), self: apiUrl('/feeds/procurement.xml'), description: '秘書室發布的招標公告與決標／流標（guid：標案 id；決標為 id#award）。正式公告以政府電子採購網為準。',
    lastBuild: maxDate(procItems.map((x) => x.date)) ?? site.today, items: procItems.slice(0, 50),
  });
  return { 'feeds/news.xml': newsXml, 'feeds/documents.xml': docsXml, 'feeds/situation.xml': sitXml, 'feeds/publications.xml': pubXml, 'feeds/notices.xml': noticeXml, 'feeds/careers.xml': careersXml, 'feeds/procurement.xml': procXml };
}

/** 第二十三輪（ARCHITECTURE 26.1）：原型模式的 robots.txt——全擋。正式版（AI 政策版）另存 robots.production.txt 供對照與部署時替換。 */
export function buildPrototypeRobots() {
  return [
    `# ${config.name}（${config.nameEn}）新官網原型：非官方網站，內容為示意，不開放索引。`,
    '# 正式站請改以 SITE_MODE=production 建置，會輸出 AI 政策版 robots.txt（本目錄的 robots.production.txt 即為該版本）。',
    '# 每頁另有 <meta name="robots" content="noindex, nofollow">；GitHub Pages 無法加 X-Robots-Tag 標頭，正式環境見 docs/deploy.md §10。',
    '',
    'User-agent: *',
    'Disallow: /',
    '',
  ].join('\n');
}

export function emitSeo(site, write, opts = {}) {
  const maps = buildSitemaps(site, opts.pages);
  for (const [name, xml] of Object.entries(maps)) write(name, xml);
  if (config.isPrototype) { write('robots.txt', buildPrototypeRobots()); write('robots.production.txt', buildRobots(site)); }
  else write('robots.txt', buildRobots(site));
  for (const l of config.langs) write(`${l.path.replace(/^\//, '')}${l.path ? '/' : ''}llms.txt`, buildLlms(site, l.code));
  for (const [name, xml] of Object.entries(buildFeeds(site))) write(name, xml);
  return Object.keys(maps);
}
