#!/usr/bin/env node
// 宣導素材欄目的模擬匯出（ARCHITECTURE 17.3 第十批）：舊站 /Category/List/VOFCg57Yk3iO3I_WxoXOIA 底下的頁面
//   對應既有新站內容（content/media、publications、datasets）與新站由資料產生的頁：
//     - 列表頁 6 頁（宣導素材、海報、單張、手冊、多媒體、影片；skip-list）
//     - MPage 3 頁（多國語言衛教素材＝既有資料集、商業媒體運用一覽表（大表＋CSV）、數位學習課程（站外連結））
//     - 素材內頁 9 頁（海報系列多圖、七語海報、純圖單張、久遠海報、懶人包圖卡、手冊、無文字稿影片、1922 社群入口）
//     - 既有 media 反推 3 頁（影片、動畫、廣播；內文＝摘要＋iframe／audio＋影片文字稿前兩章）
//     - 另複製結核病批匯出的 3 頁宣導素材（同網址、含附件與圖檔，測跨批重複）
//   數字、經費、網址 ID（除標明的真實 ID 外）皆為示意。
//   真實 ID：宣導素材根 VOFCg57Yk3iO3I_WxoXOIA、多媒體 slfvh8DLgS6fkbLiuN-WHg、影片 DWSgB84e8MEvXgBqiQmR6A、
//   多國語言衛教素材 Y_AH_Ka7q03cfN15CyI-nQ、商業媒體運用一覽表 -2qVuGOsbhtkGWlpYw1scA、數位學習課程 1ptYuzMUqvZ6J2QOzSLk6A。
//   素材內頁的 /Category/ListContent/{listId}?uaid={id} 是推測的網址模式。正式匯出（資訊室從 CMS 匯出欄目）取代整個目錄即可。
// 用法：node scripts/lib/legacy-import/sim-export-materials.mjs [輸出目錄]   （預設 data/legacy-export/materials）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { BASE, esc, fakeId, P, LI, H, A, TABLE, mdHtml, pdfText, png, shell } from './sim-export.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const CONTENT = path.join(ROOT, 'content');
export const EXPORTED_AT = '2026-10-03';
const J = (p) => JSON.parse(fs.readFileSync(path.join(CONTENT, p), 'utf8'));

const TOP = ['首頁', '宣導素材'];
const MM = [...TOP, '多媒體'];
const POSTER = [...TOP, '海報'];
const LEAFLET = [...TOP, '單張'];
const MANUAL = [...TOP, '手冊'];

const ROOT_ID = 'VOFCg57Yk3iO3I_WxoXOIA';
const MULTIMEDIA_ID = 'slfvh8DLgS6fkbLiuN-WHg';
const VIDEOS_ID = 'DWSgB84e8MEvXgBqiQmR6A';

export function generateMaterials(outDir) {
  const items = [];
  const page = (key, o) => items.push({ key, atts: [], imgs: [], ...o });
  const mid = (s) => fakeId(`materials:${s}`);
  const listId = (s) => mid(`list-${s}`);
  const content = (list, key) => `${BASE}/Category/ListContent/${listId(list)}?uaid=${mid(key)}`;
  const pdf = (name, label, title, lines = ['Simulated export - not the real file.']) => ({ name, label, url: `${BASE}/File/Get/${mid(`file:${name}`)}`, buf: pdfText(title, lines), type: 'PDF' });
  const img = (file, ym, w, h, bars, color, alt) => ({ file, src: `/Upload/images/${ym}/${file}`, alt, buf: png(w, h, bars, color) });
  const IMG = (i) => `<p><img src="${i.src}"${i.alt ? ` alt="${esc(i.alt)}"` : ''} class="img-responsive" width="${i.w ?? 240}" height="${i.h ?? 160}"></p>`;
  const media = (id) => J(`media/${id}.json`);

  // ── MPage ──
  const langs = ['English', 'Tiếng Việt', 'Bahasa Indonesia', 'ไทย', 'Tagalog', '日本語', '簡體中文', '中文版'];
  const multi = [
    pdf('dengue-leaflet-en.pdf', '登革熱防治單張（English）', 'Dengue leaflet (SAMPLE)'),
    pdf('dengue-leaflet-vi.pdf', '登革熱防治單張（Tiếng Việt）', 'Dengue leaflet vi (SAMPLE)'),
    pdf('tb-poster-id.pdf', '結核病衛教海報（Bahasa Indonesia）', 'TB poster id (SAMPLE)'),
    pdf('flu-vaccine-poster-th.pdf', '流感疫苗海報（ไทย）', 'Flu vaccine poster th (SAMPLE)'),
    pdf('ev-handwashing-leaflet-tl.pdf', '腸病毒洗手單張（Tagalog）', 'EV handwashing leaflet tl (SAMPLE)'),
    pdf('measles-leaflet-ja.pdf', '麻疹防治單張（日本語）', 'Measles leaflet ja (SAMPLE)'),
    pdf('mpox-leaflet-zh-cn.pdf', 'M痘衛教單張（簡體中文）', 'Mpox leaflet zh-CN (SAMPLE)'),
    pdf('dengue-leaflet-zh.pdf', '登革熱防治單張（中文版）', 'Dengue leaflet zh-TW (SAMPLE)'),
  ];
  const cellLink = (a, t) => `<a href="${esc(a.url)}">${esc(t)}</a>`;
  const multiTable = () => `<table class="table table-bordered" border="1"><thead><tr><th>疾病／素材</th>${langs.map((l) => `<th>${esc(l)}</th>`).join('')}</tr></thead><tbody>${multi.map((a) => {
    const lang = langs.find((l) => a.label.includes(`（${l}）`));
    return `<tr><td>${esc(a.label.replace(/（[^）]*）$/, ''))}</td>${langs.map((l) => `<td>${l === lang ? cellLink(a, 'PDF') : ''}</td>`).join('')}</tr>`;
  }).join('')}</tbody></table>`;
  page('multilingual-materials', {
    url: `${BASE}/Category/MPage/Y_AH_Ka7q03cfN15CyI-nQ`, title: '多國語言衛教素材', crumbs: [...TOP, '多國語言衛教素材'], pub: '2015-01-01', upd: '2026-09-18',
    atts: multi,
    body: () => `${P('為服務在臺的新住民、移工與外籍旅客，本署提供多國語言衛教素材，涵蓋登革熱、結核病、流感疫苗、腸病毒、麻疹與 M痘等主題，歡迎下載使用。')}\n${multiTable()}`,
  });
  const years = [2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];
  const mediaTypes = ['電視', '廣播', '網路', '戶外', '平面', '電視', '網路', '廣播', '社群', '戶外', '網路', '社群'];
  const topics = ['登革熱', '腸病毒', '流感疫苗', '愛滋防治', '麻疹', '新冠肺炎', '新冠疫苗', '洗手', '流感疫苗', '登革熱', '結核病', 'M痘'];
  const rows = years.map((y, i) => [`${y}`, mediaTypes[i], `${topics[i]}宣導`, i % 2 ? '公關室' : '疾管署', `${(300 + i * 40)} 萬元（示意）`]);
  const csv = Buffer.from(`年度,媒體類型,宣導主題,委託單位,經費_萬元(示意)\n${rows.map((r) => [r[0], r[1], r[2], r[3], r[4].replace(/\D.*$/, '')].join(',')).join('\n')}\n`, 'utf8');
  page('commercial-media-table', {
    url: `${BASE}/Category/MPage/-2qVuGOsbhtkGWlpYw1scA`, title: '防疫衛教宣導之商業媒體運用情形一覽表', crumbs: [...TOP, '防疫衛教宣導之商業媒體運用情形一覽表'], pub: '2018-03-01', upd: '2026-08-31',
    atts: [{ name: 'commercial-media-usage.csv', label: '商業媒體運用情形一覽表（CSV，示意數字）', url: `${BASE}/File/Get/${mid('file:commercial-media-csv')}`, buf: csv, type: 'CSV' }],
    body: () => `${P('依預算法及政府機關政策文宣規定，揭露本署歷年防疫衛教宣導委託商業媒體（電視、廣播、網路、戶外、平面、社群）運用情形。經費為示意數字。')}\n${TABLE(['年度', '媒體類型', '宣導主題', '委託單位', '經費'], rows)}`,
  });
  page('e-learning', {
    url: `${BASE}/Category/MPage/1ptYuzMUqvZ6J2QOzSLk6A`, title: '數位學習課程', crumbs: [...TOP, '數位學習課程'], pub: '2017-06-01', upd: '2026-05-05',
    body: () => `${P('疾管署提供防疫人員與一般民眾的線上數位學習課程，完成課程可取得時數認證。')}\n<ul><li>${A('https://e-learning.example.gov.tw/course/infection-control', '感染管制數位學習平臺')}</li><li>${A('https://e-learning.example.gov.tw/course/public', '民眾防疫知識線上課程')}</li></ul>`,
  });

  // ── 素材內頁 ──
  const sixImgs = [
    img('dengue-patrol-1.png', '2026/07', 240, 160, [1, 0.6, 0.8, 0.4], [0, 100, 140], '巡：巡視住家內外積水容器'),
    img('dengue-patrol-2.png', '2026/07', 240, 160, [0.5, 1, 0.7, 0.3], [0, 120, 90], '倒：把積水倒掉'),
    img('dengue-patrol-3.png', '2026/07', 240, 160, [0.9, 0.4, 0.6, 0.8], [140, 90, 0], '清：清除不要的容器'),
    img('dengue-patrol-4.png', '2026/07', 240, 160, [0.3, 0.7, 1, 0.5], [120, 0, 90], null),
    img('dengue-patrol-5.png', '2026/07', 240, 160, [0.6, 0.9, 0.4, 0.7], [60, 60, 140], null),
    img('dengue-patrol-6.png', '2026/07', 240, 160, [0.8, 0.5, 0.9, 0.2], [0, 140, 140], null),
  ];
  page('poster-dengue-patrol-series', {
    url: content('posters', 'poster-dengue-patrol-series'), title: '登革熱「巡、倒、清、刷」海報系列', crumbs: [...POSTER, '登革熱「巡、倒、清、刷」海報系列'], pub: '2026-07-01', upd: '2026-07-01',
    imgs: sixImgs, atts: [pdf('dengue-patrol-series.pdf', '海報系列（PDF）', 'Dengue patrol poster series (SAMPLE)')],
    body: () => `${P('登革熱「巡、倒、清、刷」海報系列，提供各縣市衛生局與社區張貼。')}\n${sixImgs.map(IMG).join('\n')}`,
  });
  const fluLabels = ['中文版', 'English', '日本語', 'Tiếng Việt', 'Bahasa Indonesia', 'ไทย', 'Tagalog'];
  const fluImg = img('flu-vaccine-poster.png', '2026/09', 240, 160, [0.4, 0.8, 1, 0.6], [0, 90, 140], '流感疫苗接種宣導海報縮圖');
  page('poster-flu-vaccine-7lang', {
    url: content('posters', 'poster-flu-vaccine-7lang'), title: '流感疫苗接種宣導海報（七語）', crumbs: [...POSTER, '流感疫苗接種宣導海報（七語）'], pub: '2026-09-01', upd: '2026-09-01',
    imgs: [fluImg],
    atts: fluLabels.map((l, i) => pdf(`flu-vaccine-poster-${['zh', 'en', 'ja', 'vi', 'id', 'th', 'tl'][i]}.pdf`, `流感疫苗接種海報（${l}）`, `Flu vaccination poster ${l} (SAMPLE)`)),
    body: () => `${P('每年秋冬流感疫苗開打，海報提供七種語言版本，歡迎下載張貼。')}\n${IMG(fluImg)}`,
  });
  const evImg = img('ev-handwashing-steps.png', '2026/04', 240, 160, [0.5, 0.9, 0.7, 0.4, 1], [0, 120, 90], null);
  page('leaflet-ev-handwashing', {
    url: content('leaflets', 'leaflet-ev-handwashing'), title: '腸病毒洗手五步驟單張', crumbs: [...LEAFLET, '腸病毒洗手五步驟單張'], pub: '2026-04-10', upd: '2026-04-10',
    imgs: [evImg], body: () => IMG(evImg),
  });
  const mImg = img('measles-2019-poster.png', '2019/03', 240, 160, [0.7, 0.5, 0.9], [140, 60, 0], '麻疹防治宣導海報縮圖');
  page('poster-measles-2019', {
    url: content('posters', 'poster-measles-2019'), title: '麻疹防治宣導海報（2019 年版）', crumbs: [...POSTER, '麻疹防治宣導海報（2019 年版）'], pub: '2019-09-01', upd: '2019-09-01',
    imgs: [mImg], atts: [pdf('measles-poster-2019.pdf', '麻疹防治海報（PDF）', 'Measles poster 2019 (SAMPLE)')],
    body: () => `${P('麻疹傳染力強，出國前確認疫苗接種史，出現發燒出疹請戴口罩就醫。')}\n${IMG(mImg)}`,
  });
  const cImgs = [img('covid-new-life-1.png', '2021/05', 240, 160, [0.6, 0.8, 0.5], [0, 90, 140], '新生活運動：戴口罩'), img('covid-new-life-2.png', '2021/05', 240, 160, [0.9, 0.4, 0.7], [90, 0, 140], '新生活運動：勤洗手')];
  page('poster-covid-new-life-2021', {
    url: content('posters', 'poster-covid-new-life-2021'), title: '防疫新生活運動海報（COVID-19）', crumbs: [...POSTER, '防疫新生活運動海報（COVID-19）'], pub: '2021-05-20', upd: '2021-05-20',
    imgs: cImgs, atts: [pdf('covid-new-life-2021.pdf', '防疫新生活運動海報（PDF）', 'COVID-19 new life poster (SAMPLE)')],
    body: () => `${P('COVID-19 疫情期間的防疫新生活運動，提醒民眾戴口罩、勤洗手、保持社交距離。')}\n${cImgs.map(IMG).join('\n')}`,
  });
  const mpImgs = [1, 2, 3, 4].map((n) => img(`mpox-card-${n}.png`, '2026/05', 240, 240, [0.4 + n * 0.1, 0.9 - n * 0.1, 0.6, 0.8], [30 * n, 100, 140 - 20 * n], `M痘防治懶人包第 ${n} 張：${['認識 M痘', '如何傳染', '如何預防', '疫苗接種'][n - 1]}`));
  page('infographic-mpox', {
    url: content('posters', 'infographic-mpox'), title: 'M痘防治懶人包（社群圖卡）', crumbs: [...POSTER, 'M痘防治懶人包（社群圖卡）'], pub: '2026-05-15', upd: '2026-05-15',
    imgs: mpImgs,
    body: () => [P('M痘（原稱猴痘）主要透過密切接觸傳染，包括皮膚與病灶接觸、性接觸及飛沫。大多數患者症狀輕微，約二至四週自行痊癒，但免疫低下者可能較嚴重。'), P('預防方式包括避免與疑似病例的皮膚病灶直接接觸、保持手部衛生、有高風險暴露者可評估接種疫苗。出現發燒、淋巴結腫大與皮疹時，請戴口罩就醫並主動告知接觸史。'), P('本懶人包整理為四張圖卡，適合在社群媒體分享，也可下載列印張貼於診所與社區據點。'), ...mpImgs.map(IMG)].join('\n'),
  });
  page('manual-ltc-ic-public', {
    url: content('manuals', 'manual-ltc-ic-public'), title: '長照機構感染管制手冊（宣導版）', crumbs: [...MANUAL, '長照機構感染管制手冊（宣導版）'], pub: '2026-03-01', upd: '2026-03-01',
    atts: [pdf('ltc-infection-control-public.pdf', '長照機構感染管制手冊宣導版（PDF）', 'LTC infection control manual, public edition (SAMPLE)')],
    body: () => P('本手冊宣導版整理長照機構常見感染管制重點，包括手部衛生、標準防護措施、群聚事件通報與疫苗接種，供機構人員與家屬參考。完整正本請見長照機構感染管制手冊。'),
  });
  page('video-rabies-pets', {
    url: content('videos', 'video-rabies-pets'), title: '寵物打狂犬病疫苗：守護家人也守護毛孩（影片）', crumbs: [...MM, '影片', '寵物打狂犬病疫苗：守護家人也守護毛孩（影片）'], pub: '2026-08-20', upd: '2026-08-20',
    body: () => `${P('狂犬病疫苗不只保護寵物，也保護全家人，帶毛孩定期接種。')}\n<iframe src="https://www.youtube.com/embed/xxxxxxxxxxx" title="寵物打狂犬病疫苗影片"></iframe>`,
  });
  page('fb-1922', {
    url: content('community', 'fb-1922'), title: '1922 防疫達人（Facebook／LINE）', crumbs: [...TOP, '社群', '1922 防疫達人（Facebook／LINE）'], pub: '2020-02-01', upd: '2026-06-01',
    body: () => `${P('加入 1922 防疫達人社群，第一時間取得防疫資訊。')}\n${P('請透過下列官方社群入口加入。')}\n<ul><li>${A('https://www.facebook.com/1922.example', '1922 防疫達人 Facebook 粉絲專頁')}</li><li>${A('https://line.me/R/ti/p/@1922example', '1922 防疫達人 LINE 官方帳號')}</li></ul>`,
  });

  // ── 既有 media 反推 ──
  const fromMedia = (key, id, crumbs, embed) => {
    const m = media(id);
    const chapters = String(m.transcriptMarkdown).split(/\n\n(?=\*\*\[)/).slice(0, 2);
    page(key, {
      url: content(crumbs.includes('影片') ? 'videos' : 'multimedia', key), title: m.title, crumbs: [...crumbs, m.title], pub: m.publishedAt, upd: m.publishedAt,
      body: () => `${P(m.summary)}\n${embed}\n${H(3, '影片文字稿')}\n${chapters.map((c) => mdHtml(c.replace(/^\*\*(\[[^\]]*\][^*]*)\*\*/m, '### $1'))).join('\n')}`,
    });
  };
  fromMedia('video-dengue-village-chief', 'dengue-village-chief', [...MM, '影片'], '<iframe src="https://www.youtube.com/embed/xxxxxxxxxxx" title="影片"></iframe>');
  fromMedia('animation-ev-handwashing', 'enterovirus-handwashing', [...MM, '動畫'], '<iframe src="https://www.youtube.com/embed/yyyyyyyyyyy" title="動畫"></iframe>');
  fromMedia('podcast-amr', 'amr-one-health-podcast', [...MM, '廣播'], '<audio controls src="/Upload/audio/2026/09/amr-one-health-podcast.mp3"></audio>');

  // ── 列表頁（最後建立，連結其他頁）──
  const linkList = (pred) => () => `<ul class="doc-list">${items.filter((i) => !i.isList && pred(i)).map((i) => `<li>${A(i.url, i.title)}</li>`).join('')}</ul>`;
  const under = (name) => (i) => i.crumbs[2] === name;
  const lst = (key, url, title, crumbs, pred) => page(key, { isList: true, url, title, crumbs, pub: EXPORTED_AT, upd: EXPORTED_AT, body: linkList(pred) });
  lst('list-materials', `${BASE}/Category/List/${ROOT_ID}`, '宣導素材', [...TOP], () => true);
  lst('list-posters', `${BASE}/Category/List/${listId('posters')}`, '海報', POSTER, under('海報'));
  lst('list-leaflets', `${BASE}/Category/List/${listId('leaflets')}`, '單張', LEAFLET, under('單張'));
  lst('list-manuals', `${BASE}/Category/List/${listId('manuals')}`, '手冊', MANUAL, under('手冊'));
  lst('list-multimedia', `${BASE}/Category/ListMovie/${MULTIMEDIA_ID}`, '多媒體', MM, under('多媒體'));
  lst('list-videos', `${BASE}/Category/ListMovie/${VIDEOS_ID}`, '影片', [...MM, '影片'], (i) => i.crumbs[2] === '多媒體' && i.crumbs[3] === '影片');

  // ── 複製結核病批的三頁宣導素材（連同附件與圖檔）──
  const copies = [];
  const srcTb = path.join(ROOT, 'data/legacy-export/tuberculosis');
  for (const [key, stem] of [['poster-tb-7lang', '10-materials-poster'], ['video-tb-cough', '11-materials-video'], ['video-tb-migrant', '12-materials-migrant']]) {
    const html = path.join(srcTb, `${stem}.html`); const json = path.join(srcTb, `${stem}.json`);
    if (!fs.existsSync(html) || !fs.existsSync(json)) continue;
    const meta = JSON.parse(fs.readFileSync(json, 'utf8'));
    const files = new Set((meta.attachments ?? []).map((a) => a.file));
    for (const m of fs.readFileSync(html, 'utf8').matchAll(/\/Upload\/images\/[^"']*\/([^/"']+\.(?:png|jpe?g|gif))/gi)) files.add(m[1]);
    copies.push({ key, html, json, files: [...files] });
  }

  // ── 寫檔 ──
  const out = path.resolve(outDir);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(path.join(out, 'files'), { recursive: true });
  const all = [...items.map((it) => ({ kind: 'gen', key: it.key, it })), ...copies.map((c) => ({ kind: 'copy', key: c.key, c }))].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  let n = 0;
  const write = (stem, it) => {
    const fileList = it.atts.length ? `<div class="file-list"><h4>相關檔案</h4><ul>${it.atts.map((a) => `<li><a href="${esc(a.url)}">${esc(a.label)}</a> <span class="size">(${a.type ?? 'PDF'})</span></li>`).join('')}</ul></div>` : '';
    fs.writeFileSync(path.join(out, `${stem}.html`), shell({ title: it.title, crumbs: it.crumbs, bodyHtml: `${it.body()}\n${fileList}`, updated: it.upd, menuActive: '宣導素材' }));
    fs.writeFileSync(path.join(out, `${stem}.json`), `${JSON.stringify({ url: it.url, title: it.title, category: it.crumbs.slice(1).join('／'), publishedAt: it.pub, updatedAt: it.upd, breadcrumbs: it.crumbs, attachments: it.atts.map((a) => ({ url: a.url, label: a.label, file: a.name })) }, null, 2)}\n`);
    for (const a of it.atts) fs.writeFileSync(path.join(out, 'files', a.name), a.buf);
    for (const i of it.imgs) fs.writeFileSync(path.join(out, 'files', i.file), i.buf);
  };
  const stems = [];
  for (const a of all) {
    n++;
    const stem = `${String(n).padStart(2, '0')}-${a.key}`;
    stems.push(stem);
    if (a.kind === 'copy') {
      fs.copyFileSync(a.c.html, path.join(out, `${stem}.html`)); fs.copyFileSync(a.c.json, path.join(out, `${stem}.json`));
      for (const f of a.c.files) { const s = path.join(srcTb, 'files', f); if (fs.existsSync(s)) fs.copyFileSync(s, path.join(out, 'files', f)); }
    } else write(stem, a.it);
  }
  const counts = { pages: n, generated: items.length, copied: copies.length, stems };
  fs.writeFileSync(path.join(out, '_export.json'), `${JSON.stringify({
    format: 'cdc-legacy-export/1', simulated: true, exportedAt: EXPORTED_AT, site: BASE, batch: 'materials', pages: n,
    source: `模擬匯出：宣導素材欄目。依既有新站內容（content/media 三筆、多國語言衛教素材資料集、長照感管手冊）反推 ${items.length} 頁：列表 6 頁、MPage 3 頁、素材內頁 9 頁、既有 media 反推 3 頁；另複製結核病批匯出的 3 頁宣導素材（同網址，含附件與圖檔）。宣導素材根、多媒體、影片、多國語言衛教素材、商業媒體運用一覽表、數位學習課程的網址 ID 為舊站真實 ID；其餘 ID、素材內頁路徑（/Category/ListContent/{listId}?uaid={id}，推測的模式）、經費、數字與連結皆為示意，不是舊站的真實資料。正式匯出取代整個目錄即可。`,
    generator: 'scripts/lib/legacy-import/sim-export-materials.mjs',
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(out, 'README.md'), readme(counts));
  return { dir: out, ...counts };
}

const readme = (c) => `# 舊站匯出（模擬）：宣導素材欄目（第十批）

> **這是模擬匯出。** 開發環境連不到 www.cdc.gov.tw，這 ${c.pages} 頁由 \`scripts/lib/legacy-import/sim-export-materials.mjs\` 合成：列表 6 頁（宣導素材、海報、單張、手冊、多媒體、影片）、MPage 3 頁（多國語言衛教素材、商業媒體運用一覽表、數位學習課程）、素材內頁 9 頁（多圖海報系列、七語海報、純圖單張、久遠海報、懶人包圖卡、手冊、無文字稿影片、1922 社群入口等）、既有 media 反推 3 頁（影片、動畫、廣播），另**原樣複製**結核病批匯出的 ${c.copied} 頁宣導素材（連同附件與圖檔）。
>
> 宣導素材根、多媒體、影片、多國語言衛教素材、商業媒體運用一覽表、數位學習課程的網址 ID 是**真實**的；其餘 ID、經費、數字、站外連結皆為**示意**。素材內頁的 \`/Category/ListContent/{listId}?uaid={id}\` 是**推測的網址模式**，正式匯出以真實網址為準。**正式匯出取代整個目錄即可**，不需要改程式。

## 重新產生

\`\`\`
node scripts/lib/legacy-import/sim-export-materials.mjs data/legacy-export/materials
\`\`\`

## 轉換

\`\`\`
node scripts/import-legacy.mjs data/legacy-export/materials --out data/legacy-import/materials --apply-migration
\`\`\`

移轉清單：\`content/migration/materials.json\`（欄目範圍，逐頁一筆；複製的 3 頁與結核病批是同一頁，不列入清單，轉換器會判定為「已在 tuberculosis 批轉過」）。匯出格式見 \`docs/legacy-import.md\` 第 2 節。
`;

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const r = generateMaterials(process.argv[2] ?? path.join(ROOT, 'data/legacy-export/materials'));
  console.log(`模擬匯出 materials：${r.pages} 頁（產生 ${r.generated}、複製 ${r.copied}）→ ${path.relative(ROOT, r.dir)}`);
}
