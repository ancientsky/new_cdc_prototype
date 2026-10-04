#!/usr/bin/env node
// 模擬匯出產生器（ARCHITECTURE 17.3）：開發環境連不到 www.cdc.gov.tw，所以依 content/migration/tuberculosis.json 的 40 筆人工項目，
// 合成一份「像舊站」的匯出：Bootstrap 版型外殼、麵包屑、Word 貼上的 span／mso 樣式、表格、附件連結、圖片、Q&A 手風琴。
// 內文文字反推自既有結核病內容（疾病頁區塊、Q&A、文件摘要）；數字與醫院名單皆為示意。
// 可重跑、輸出固定：  node scripts/lib/legacy-import/sim-export.mjs [輸出目錄]   （預設 data/legacy-export/tuberculosis）
// 正式匯出（資訊室從 CMS 資料庫匯出成同樣格式）直接取代這個目錄即可。
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const C = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, 'content', p), 'utf8'));
export const BASE = 'https://www.cdc.gov.tw';
export const EXPORTED_AT = '2026-10-03';

// ───────────────────────── 小工具 ─────────────────────────
export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const fakeId = (s) => createHash('sha256').update(`sim:${s}`).digest('base64url').slice(0, 22);

/** 內嵌標記：**粗體**、[文字](網址) */
export const inl = (t) => esc(t)
  .replace(/\*\*([^*]+)\*\*/g, '<b style="mso-bidi-font-weight:normal"><span lang="ZH-TW" style="font-family:\'新細明體\',serif">$1</span></b>')
  .replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, '$1<i style="mso-bidi-font-style:normal">$2</i>')
  .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2"><span lang="ZH-TW">$1</span></a>');

export const SPAN = (t) => `<span lang="ZH-TW" style="font-size:12.0pt;font-family:'新細明體',serif;mso-ascii-font-family:'Times New Roman';mso-hansi-font-family:'Times New Roman'">${t}</span>`;
/** Word 貼上的一般段落（MsoNormal＋mso 樣式＋ <o:p>） */
export const P = (t) => `<p class="MsoNormal" style="margin:0cm;margin-bottom:.0001pt;text-align:justify;text-justify:inter-ideograph;line-height:150%">${SPAN(inl(t))}<span lang="EN-US" style="font-size:12.0pt"><o:p></o:p></span></p>`;
/** Word 貼上的清單項目（mso-list） */
export const LI = (t, level = 1) => `<p class="MsoListParagraph" style="margin-left:${18 + 18 * level}pt;text-indent:-18.0pt;mso-list:l0 level${level} lfo1"><![if !supportLists]><span lang="EN-US" style="font-family:Symbol;mso-fareast-font-family:Symbol;mso-bidi-font-family:Symbol"><span style="mso-list:Ignore">·<span style="font:7.0pt 'Times New Roman'">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; </span></span></span><![endif]>${SPAN(inl(t))}</p>`;
/** Word 編號清單項目（標記「1.」） */
export const LIO = (n, t) => `<p class="MsoListParagraph" style="margin-left:36.0pt;text-indent:-18.0pt;mso-list:l1 level1 lfo2"><![if !supportLists]><span lang="EN-US"><span style="mso-list:Ignore">${n}.<span style="font:7.0pt 'Times New Roman'">&nbsp;&nbsp;&nbsp;&nbsp; </span></span></span><![endif]>${SPAN(inl(t))}</p>`;
export const H = (n, t) => `<h${n}><span lang="ZH-TW" style="font-family:'微軟正黑體',sans-serif">${esc(t)}</span></h${n}>`;
export const A = (href, t) => `<a href="${esc(href)}">${esc(t)}</a>`;

/** 簡易 Markdown（段落、- 清單、###/#### 標題、**粗體**、*斜體*）→ Word 貼上 HTML */
export function mdHtml(md) {
  const out = [];
  let para = [];
  const flush = () => { if (para.length) { out.push(P(para.join(''))); para = []; } };
  for (const line of String(md).split('\n')) {
    if (!line.trim()) { flush(); continue; }
    if (/^\s*-\s+/.test(line)) { flush(); out.push(LI(line.replace(/^\s*-\s+/, ''))); continue; }
    const ol = /^\s*(\d+)\.\s+(.*)$/.exec(line);
    if (ol) { flush(); out.push(LIO(ol[1], ol[2])); continue; }
    const h = /^(#{3,4})\s+(.*)$/.exec(line);
    if (h) { flush(); out.push(H(h[1].length, h[2])); continue; }
    para.push(line);
  }
  flush();
  return out.join('\n');
}

/** 表格；儲存格可為字串或 { t, rowspan, colspan } */
export function TABLE(head, rows, { caption } = {}) {
  const cell = (c, tag) => {
    const o = typeof c === 'object' ? c : { t: c };
    const attrs = `${o.rowspan ? ` rowspan="${o.rowspan}"` : ''}${o.colspan ? ` colspan="${o.colspan}"` : ''}`;
    return `<${tag}${attrs} style="border:solid windowtext 1.0pt;padding:0cm 5.4pt 0cm 5.4pt"><p class="MsoNormal" style="margin:0cm;margin-bottom:.0001pt;text-align:${tag === 'th' ? 'center' : 'left'}">${tag === 'th' ? `<b>${SPAN(inl(o.t))}</b>` : SPAN(inl(o.t))}<o:p></o:p></p></${tag}>`;
  };
  return `<table class="table table-bordered table-striped" border="1" cellspacing="0" cellpadding="0" style="border-collapse:collapse;border:none;mso-border-alt:solid windowtext .5pt;mso-yfti-tbllook:1184">${caption ? `<caption>${esc(caption)}</caption>` : ''}<thead><tr>${head.map((h) => cell(h, 'th')).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => cell(c, 'td')).join('')}</tr>`).join('')}</tbody></table>`;
}

// ───────────────────────── 檔案產生（PDF、PNG、CSV） ─────────────────────────
const pdfStr = (s) => `(${String(s).replace(/[\\()]/g, (c) => `\\${c}`).replace(/[^\x20-\x7e]/g, '?')})`;
function buildPdf(objs) {
  let body = '%PDF-1.4\n';
  const offs = [];
  objs.forEach((o, i) => { offs.push(Buffer.byteLength(body, 'latin1')); body += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(body, 'latin1');
  body += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}
/** 有文字層的單頁 PDF（Helvetica，只放 ASCII；中文標題見 .md 與 HTML 說明） */
export function pdfText(title, lines) {
  const ops = ['BT', '/F1 18 Tf', '50 780 Td', `${pdfStr(title)} Tj`, '/F1 11 Tf', '0 -28 Td', '14 TL', ...lines.map((l) => `${pdfStr(l)} Tj T*`), 'ET'].join('\n');
  return buildPdf([
    '<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    `<< /Length ${Buffer.byteLength(ops, 'latin1')} >>\nstream\n${ops}\nendstream`,
  ]);
}
/** 掃描檔式 PDF：整頁是一張影像，沒有任何文字運算子（pdfHasTextLayer 為 false） */
export function pdfScan(seed) {
  const w = 16, h = 20;
  const raw = Buffer.alloc(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw[y * w + x] = ((x * 7 + y * 13 + seed) % 5 === 0) ? 40 : 235;
  return rebuildScan(zlib.deflateSync(raw), 'q 480 0 0 600 57 120 cm /Im1 Do Q');
}
function rebuildScan(img, ops) {
  // 影像串流含二進位，改以 Buffer 逐段組裝（xref 偏移用 latin1 位元組長度）
  const parts = [];
  const offs = [];
  let size = 0;
  const push = (b) => { const buf = Buffer.isBuffer(b) ? b : Buffer.from(b, 'latin1'); parts.push(buf); size += buf.length; };
  push('%PDF-1.4\n');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im1 4 0 R >> >> /Contents 5 0 R >>',
    null,
    `<< /Length ${ops.length} >>\nstream\n${ops}\nendstream`,
  ];
  objs.forEach((o, i) => {
    offs.push(size);
    push(`${i + 1} 0 obj\n`);
    if (o === null) { push(`<< /Type /XObject /Subtype /Image /Width 16 /Height 20 /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${img.length} >>\nstream\n`); push(img); push('\nendstream'); } else push(o);
    push('\nendobj\n');
  });
  const xref = size;
  push(`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return Buffer.concat(parts);
}

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
/** 小型 PNG（RGB）：長條圖示意 */
export function png(w, h, bars, color) {
  const rows = [];
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(1 + w * 3);
    for (let x = 0; x < w; x++) {
      const bi = Math.floor((x * bars.length) / w);
      const barTop = h - Math.round(bars[bi] * (h - 8));
      const onBar = y >= barTop && (x * bars.length) % w > w / bars.length / 4;
      const c = onBar ? color : y === h - 1 ? [120, 120, 120] : [250, 250, 250];
      row[1 + x * 3] = c[0]; row[2 + x * 3] = c[1]; row[3 + x * 3] = c[2];
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}

// ───────────────────────── 內容來源（既有結核病內容） ─────────────────────────
const disease = C('diseases/tuberculosis.json');
const block = (k) => disease.blocks.find((b) => b.key === k);
const faq = (id) => C(`faq/${id}.json`);
const doc = (id) => C(`documents/${id}.json`);

/** 頁面外殼（Bootstrap 3 版型、導覽、麵包屑、側欄、頁尾） */
export function shell({ title, crumbs, bodyHtml, updated, menuActive }) {
  const menu = ['疾病介紹', '預防接種', 'Q&A', '宣導素材', '指引及手冊', '通報定義', '通報', '檢驗', '統計資料', '防治政策', '外籍人士健檢', '研究成果', '教育訓練', '相關連結', '最新消息', '活動訊息'];
  return `<!DOCTYPE html>
<html lang="zh-Hant-TW">
<head>
<meta charset="utf-8">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Microsoft Word 15">
<title>${esc(title)} - 衛生福利部疾病管制署</title>
<link href="/Content/bootstrap.min.css" rel="stylesheet">
<link href="/Content/font-awesome.min.css" rel="stylesheet">
<link href="/Content/cdc-site.css?v=20190102" rel="stylesheet">
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Normal</w:View><w:Zoom>0</w:Zoom></w:WordDocument></xml><![endif]-->
<script src="/Scripts/jquery-1.10.2.min.js"></script>
<script src="/Scripts/bootstrap.min.js"></script>
<script>(function(i,s,o,g,r,a,m){i['GoogleAnalyticsObject']=r;})(window,document,'script','//www.google-analytics.com/analytics.js','ga');ga('create','UA-00000000-1','auto');ga('send','pageview');</script>
</head>
<body class="cdc-site">
<a class="sr-only sr-only-focusable" href="#CCMS_Content">跳到主要內容區塊</a>
<header class="navbar navbar-default navbar-fixed-top" role="banner">
  <div class="container">
    <div class="navbar-header"><a class="navbar-brand" href="/"><img src="/Content/images/logo.png" alt="衛生福利部疾病管制署"></a></div>
    <nav><ul class="nav navbar-nav"><li><a href="/">首頁</a></li><li><a href="/Disease/Index">傳染病介紹</a></li><li><a href="/Category/Page/0">防疫專題</a></li><li><a href="/Bulletin/List/0">新聞與公告</a></li><li><a href="/Category/MPage/0">出國旅遊</a></li></ul></nav>
    <form class="navbar-form navbar-right" action="/Search"><input type="text" name="q" class="form-control" placeholder="站內搜尋"><button type="submit" class="btn btn-default">搜尋</button></form>
  </div>
</header>
<div class="container" style="margin-top:70px">
  <ol class="breadcrumb">${crumbs.map((c, i) => (i === crumbs.length - 1 ? `<li class="active">${esc(c)}</li>` : `<li><a href="#">${esc(c)}</a></li>`)).join('')}</ol>
  <div class="row">
    <aside class="col-md-3 hidden-xs sidebar"><ul class="nav nav-pills nav-stacked">${menu.map((m) => `<li${m === menuActive ? ' class="active"' : ''}><a href="/Category/List/0">${esc(m)}</a></li>`).join('')}</ul></aside>
    <div class="col-md-9">
      <div id="CCMS_Content" class="cp">
        <h2 class="title">${esc(title)}</h2>
        <div class="share-bar"><a href="#" onclick="window.print();return false;">友善列印</a> <a href="#">分享至 Facebook</a> <a href="#">LINE</a></div>
        <div class="content-body">
${bodyHtml}
        </div>
        <div class="update">最後更新時間：${updated.replace(/-/g, '/')}　<span class="counter">瀏覽人次：${1000 + (title.length * 137) % 9000}</span></div>
      </div>
    </div>
  </div>
</div>
<footer class="footer"><div class="container"><p>衛生福利部疾病管制署　地址：10050 臺北市中正區林森南路 6 號　1922 防疫達人專線</p><p>瀏覽人次：1,234,567　版權所有 © 衛生福利部疾病管制署</p></div></footer>
</body>
</html>
`;
}

/** Q&A 手風琴（Bootstrap panel） */
export function qaPanels(items) {
  return `<div class="panel-group" id="accordion">${items.map((it, i) => `
<div class="panel panel-default">
  <div class="panel-heading"><h4 class="panel-title"><a data-toggle="collapse" data-parent="#accordion" href="#q${i + 1}">Q${i + 1}. ${esc(it.q)}</a></h4></div>
  <div id="q${i + 1}" class="panel-collapse collapse${i === 0 ? ' in' : ''}"><div class="panel-body">${mdHtml(it.a)}</div></div>
</div>`).join('')}</div>`;
}

// ───────────────────────── 40 頁規格 ─────────────────────────
// 每頁：publishedAt、updatedAt、body()、attachments[]、files{}（on-disk 檔名 → Buffer）、extra（typeid、tab…）
const A_PDF = (name, label, url, buf) => ({ name, label, url, buf });

function specs(manifestItems) {
  const m = new Map(manifestItems.map((i) => [i.key, i]));
  const docPara = (id) => { const d = doc(id); return [P(d.summary), ...(d.sections ?? []).slice(0, 3).map((s) => `${H(3, s.heading)}\n${mdHtml(s.markdown)}`)].join('\n'); };
  const fileTable = (d, edition) => TABLE(['項目', '內容'], [['文件名稱', d.title], ['版次', edition ?? d.version], ['生效日', d.effectiveAt], ['權責單位', '慢性傳染病組'], ['檔案格式', 'PDF']]);
  const S = {};

  S.intro = {
    pub: '2018-03-01', upd: '2026-03-10',
    body: () => [
      P(disease.summary),
      TABLE(['項目', '內容'], [['法定傳染病類別', '第三類（多重抗藥性結核病為第二類）'], ['通報時限', '一週內（多重抗藥性結核病 24 小時內）'], ['ICD-10', 'A15–A19'], ['主要傳染途徑', '空氣傳染（飛沫核）'], ['好發族群', '65 歲以上長者、糖尿病、洗腎、HIV 感染者']]),
      H(3, '致病原'),
      mdHtml(block('transmission').markdown.split('### 傳染方式')[0].replace('### 致病原\n', '').trim()),
    ].join('\n'),
  };
  S['intro-epidemiology'] = {
    pub: '2018-03-01', upd: '2026-04-02', tab: 'epidemiology',
    body: () => [
      mdHtml(block('situation').markdown.split('### 2035')[0].replace('### 流行病學\n', '').trim()),
      P('近年新案數趨勢如下表（**示意數字，非正式統計**，正式數字見統計資料）：'),
      TABLE(['年度', '新案數（示意）', '發生率（每十萬人口，示意）'], [['2005', '16,472', '72.5'], ['2010', '14,267', '61.7'], ['2015', '9,776', '41.7'], ['2020', '7,333', '31.0'], ['2024', '5,100', '22.0']]),
    ].join('\n'),
  };
  S['intro-transmission'] = { pub: '2018-03-01', upd: '2026-03-10', tab: 'transmission', body: () => mdHtml(block('transmission').markdown.replace(/### 致病原[\s\S]*?(?=### 傳染方式)/, '')) };
  S['intro-symptoms'] = { pub: '2018-03-01', upd: '2026-03-10', tab: 'symptoms', body: () => `${mdHtml(block('symptoms').markdown)}\n${P(`**注意：**${block('symptoms').warning}`)}` };
  S['intro-treatment'] = { pub: '2018-03-01', upd: '2026-05-12', tab: 'treatment', body: () => mdHtml(block('treatment').markdown) };
  S.bcg = {
    pub: '2019-06-01', upd: '2026-02-18', tab: 'bcg',
    body: () => [
      mdHtml(block('vaccine').markdown),
      TABLE(['對象', '接種時間', '劑次', '費用'], [['嬰兒', '出生滿 5 個月（建議 5–8 個月）', '1 劑', '公費'], ['成人', '不需補種', '—', '—']]),
    ].join('\n'),
  };

  const qa = [faq('tb-cough-two-weeks'), faq('ltbi-treat-or-not'), faq('tb-dots-what'), faq('tb-contact-screening'), faq('mdr-tb'), faq('tb-treatment-cost'), faq('tb-foreigner-health-check'), faq('tb-contagious-after-treatment')];
  S['qa-list'] = { pub: '2020-03-24', upd: '2026-09-22', body: () => qaPanels(qa.map((f) => ({ q: f.question, a: f.answerMarkdown }))) };
  S['qa-cough'] = { pub: '2020-03-24', upd: '2026-04-01', tab: 'cough', body: () => qaPanels([{ q: qa[0].question, a: qa[0].answerMarkdown }]) };
  S['qa-ltbi'] = { pub: '2026-09-15', upd: '2026-09-22', tab: 'ltbi', body: () => qaPanels([{ q: qa[1].question, a: qa[1].answerMarkdown }]) };

  const posterPdf = pdfText('TB poster - 7 languages (SAMPLE)', ['Cough for two weeks? See a doctor.', 'Treatment is free. DOTS supporters will accompany you.', 'Languages: zh-TW, English, Japanese, Vietnamese, Indonesian, Thai, Tagalog.', 'SAMPLE FILE FOR PROTOTYPE - NOT AN OFFICIAL NOTICE.']);
  S['materials-poster'] = {
    pub: '2026-03-20', upd: '2026-03-20', tab: 'posters',
    body: () => [P('咳嗽超過兩週請就醫，結核病可以治癒，治療免費。海報提供繁中、英、日、越、印、泰、菲七種語言，歡迎下載張貼於移工宿舍與社區。'), `<p><img src="/Upload/images/2026/03/tb-poster-7lang-thumb.png" title="結核病七語衛教海報縮圖" class="img-responsive" width="160" height="100"></p>`, P('檔案請見下方附件（A4 示意版）。')].join('\n'),
    attachments: [A_PDF('tb-poster-7lang.pdf', '結核病七語衛教海報（PDF）', `${BASE}/File/Get/${fakeId('poster')}`, posterPdf)],
    files: { 'tb-poster-7lang-thumb.png': png(160, 100, [0.4, 0.7, 0.55, 0.9, 0.65, 0.8, 0.5], [0, 90, 140]) },
  };
  const video = (k) => { const v = C(`media/${k}.json`); return v; };
  const vid1 = video('tb-cough-two-weeks'), vid2 = video('migrant-worker-health-check');
  S['materials-video'] = { pub: '2024-03-24', upd: '2026-03-24', tab: 'video', body: () => [P(`**${vid1.title}**`), P(vid1.summary), `<div class="embed-responsive embed-responsive-16by9"><iframe class="embed-responsive-item" src="https://www.youtube.com/embed/SAMPLE000" allowfullscreen></iframe></div>`, P('影片長度約 1 分 35 秒，附中文字幕。')].join('\n') };
  S['materials-migrant'] = { pub: '2024-06-18', upd: '2026-03-24', tab: 'migrant-video', body: () => [P(`**${vid2.title}**`), P(vid2.summary), `<div class="embed-responsive embed-responsive-16by9"><iframe class="embed-responsive-item" src="https://www.youtube.com/embed/SAMPLE111" allowfullscreen></iframe></div>`].join('\n') };

  const docFile = (key, id, pdfName, label, { scan = false, edition } = {}) => {
    const d = doc(id);
    const buf = scan ? pdfScan(key.length) : pdfText(d.title.replace(/[^\x20-\x7e]/g, '').trim() || `Document ${key}`, ['SAMPLE FILE FOR PROTOTYPE - NOT AN OFFICIAL NOTICE.', `Edition: ${edition ?? d.version}`, 'Chapters are summarised in the prototype content page.']);
    return { d, buf, att: A_PDF(pdfName, label, null, buf) };
  };
  const mkDocPage = (key, id, pdfName, label, pub, opts = {}) => {
    const x = docFile(key, id, pdfName, label, opts);
    return {
      pub, upd: opts.upd ?? pub, fileUrl: opts.fileUrl,
      body: () => [fileTable(x.d, opts.edition), docPara(id), P(`下載：[${label}](__FILE__)`)].join('\n'),
      attachments: [x.att],
    };
  };
  S['guideline-current'] = mkDocPage('guideline-current', 'tb-guideline.2025-09-01', 'tb-guideline-v8.pdf', '結核病診治指引（第八版）PDF', '2025-09-01', { upd: '2026-01-08' });
  S['guideline-7th'] = mkDocPage('guideline-7th', 'tb-guideline.2022-03-01', '結核病診治指引第七版.pdf', '結核病診治指引（第七版）PDF', '2022-03-01', { scan: true });
  S['ltbi-guideline'] = mkDocPage('ltbi-guideline', 'ltbi-guideline.2024-01-01', 'LTBI guideline 2024.pdf', '潛伏結核感染診治指引 PDF', '2024-01-01');
  S['ltbi-guideline-old'] = mkDocPage('ltbi-guideline-old', 'ltbi-guideline.2024-01-01', '潛伏結核感染治療指引.pdf', '潛伏結核感染治療指引（舊版）PDF', '2021-05-01', { scan: true, edition: '2021 年版' });
  S['contact-guideline'] = mkDocPage('contact-guideline', 'tb-contact-investigation.2025-01-01', 'tb-contact-investigation-2025.pdf', '結核病接觸者檢查指引 PDF', '2025-01-01');
  S['dots-manual'] = mkDocPage('dots-manual', 'dots-manual.2025-01-01', 'dots-manual-2025.pdf', '都治計畫作業手冊 PDF', '2025-01-01');
  S['tb-manual'] = mkDocPage('tb-manual', 'tb-manual.2025-07-01', 'tb-manual-2025.pdf', '結核病防治工作手冊 PDF', '2025-07-01');
  S['tb-manual-2019'] = mkDocPage('tb-manual-2019', 'tb-manual.2025-07-01', '結核病防治工作手冊2019年版.pdf', '結核病防治工作手冊（2019 年版）PDF', '2019-06-28', { scan: true, edition: '2019 年版' });

  const cd = doc('tb-case-definition.2024-01-01');
  S['case-definition'] = {
    pub: '2024-01-01', upd: '2026-06-30',
    body: () => [P(cd.summary), ...cd.sections.map((s) => `${H(3, s.heading)}\n${mdHtml(s.markdown)}`), TABLE(['分類', '條件'], [['確定病例', '具結核病臨床症狀或影像，且檢驗確認（培養、分子檢測或病理）'], ['極可能病例', '臨床條件符合，但檢驗未確認，經醫師診斷並給予完整治療'], ['疑似病例', '有症狀但尚未完成檢驗']])].join('\n'),
  };
  S.notify = {
    pub: '2019-01-15', upd: '2026-05-05', tab: 'notify',
    body: () => [P('結核病為第三類法定傳染病，醫師診斷後應依規定通報；多重抗藥性結核病為第二類。'), TABLE(['類別', '病名', '通報時限'], [['第二類', '多重抗藥性結核病', '24 小時內'], ['第三類', '結核病', '一週內']]), P('通報請至「傳染病通報系統」或填寫通報單傳真至轄區管制中心。')].join('\n'),
    attachments: [A_PDF('tb-notify-form.pdf', '傳染病通報單（PDF）', `${BASE}/File/Get/${fakeId('notify-form')}`, pdfText('Notifiable disease report form (SAMPLE)', ['SAMPLE FILE FOR PROTOTYPE - NOT AN OFFICIAL FORM.']))],
  };
  S.lab = {
    pub: '2019-01-15', upd: '2026-02-26', tab: 'lab',
    body: () => [P('疑似結核病個案應連續收集 **3 套痰液**（至少 1 套為晨痰）送驗，進行抗酸菌塗片、培養與**分子快速檢測**（含 rifampin 抗藥基因）。'), TABLE(['檢體', '容器', '保存與運送', '檢驗項目'], [['痰液', '無菌痰盒', '4°C 冷藏，24 小時內送達', '塗片、培養、分子快速檢測'], ['支氣管沖洗液', '無菌試管', '4°C 冷藏，24 小時內送達', '塗片、培養、分子快速檢測'], ['血液（IGRA）', '專用採血管', '室溫，16 小時內送達', '丙型干擾素釋放試驗']]), P('填寫送驗單：[結核病檢驗送驗單（PDF）](__FILE__)')].join('\n'),
    attachments: [A_PDF('tb-lab-request-form.pdf', '結核病檢驗送驗單（PDF）', `${BASE}/File/Get/${fakeId('lab-form')}`, pdfText('Tuberculosis specimen request form (SAMPLE)', ['SAMPLE FILE FOR PROTOTYPE - NOT AN OFFICIAL FORM.']))],
  };
  S.stats = {
    pub: '2018-03-01', upd: '2026-09-20', tab: 'statistics',
    body: () => [P('結核病統計資料由疫情中心定期更新，歷年新案數與發生率可下載 CSV，或至傳染病統計資料查詢系統自行查詢。'), `<p><img src="/Upload/images/2026/09/tb-new-cases-trend.png" alt="結核病新案數歷年趨勢長條圖（示意）" class="img-responsive" width="240" height="120"></p>`, `<ul class="list-unstyled"><li>${A('https://nidss.cdc.gov.tw/', '傳染病統計資料查詢系統')}</li><li>${A('https://data.cdc.gov.tw/', '疾管署開放資料')}</li><li>${A('/Bulletin/List/0', '結核病新聞稿')}</li></ul>`].join('\n'),
    attachments: [A_PDF('tb-new-cases-by-year.csv', '結核病歷年新案數（CSV，示意數字）', `${BASE}/File/Get/${fakeId('stats-csv')}`, Buffer.from('year,new_cases,rate_per_100k\n2005,16472,72.5\n2010,14267,61.7\n2015,9776,41.7\n2020,7333,31.0\n2024,5100,22.0\n', 'utf8'))],
    files: { 'tb-new-cases-trend.png': png(240, 120, [1, 0.88, 0.7, 0.55, 0.45, 0.4], [20, 110, 80]) },
  };
  S['annual-report'] = {
    pub: '2025-12-31', upd: '2026-01-15',
    body: () => [P('結核病年報彙整每年新案、死亡、治療成果與高風險族群分析。'), TABLE(['項目', '內容'], [['書名', '結核病年報 2024'], ['ISBN', '978-000-00-0000-0（示意）'], ['GPN', '0000000000（示意）'], ['版次', '2025 年 12 月第 1 版'], ['頁數', '186']]), P('全文下載：[結核病年報 2024（PDF）](__FILE__)')].join('\n'),
    attachments: [A_PDF('tb-annual-report-2024.pdf', '結核病年報 2024（PDF）', `${BASE}/File/Get/${fakeId('annual')}`, pdfScan(7))],
  };

  const prog = (k) => disease.professional.programs.find((p) => p.key === k);
  S.dots = { pub: '2019-01-15', upd: '2026-08-20', tab: 'dots', body: () => [P(prog('dots').summary), LI('社區都治：關懷員每日到府或約定地點送藥到手、親眼看服藥'), LI('機構都治：矯正機關、長照機構由機構人員執行'), LI('進階都治（DOTS-Plus）：多重抗藥性結核病，由專責團隊執行'), P(faq('tb-dots-what').answerMarkdown)].join('\n') };
  const ltbiSvc = C('services/ltbi-treatment.json');
  S.ltbi = { pub: '2019-01-15', upd: '2026-09-22', tab: 'ltbi', body: () => [P(ltbiSvc.summary), mdHtml(ltbiSvc.introMarkdown)].join('\n') };
  S.contact = { pub: '2019-01-15', upd: '2026-09-15', tab: 'contact', body: () => [P(prog('contact-investigation').summary), mdHtml(faq('tb-contact-screening').answerMarkdown)].join('\n') };
  S.mdr = { pub: '2019-01-15', upd: '2026-09-15', tab: 'mdr', body: () => [P(prog('mdr-tmtc').summary), mdHtml(faq('mdr-tb').answerMarkdown)].join('\n') };
  S['mdr-hospitals'] = {
    pub: '2020-06-01', upd: '2026-07-01',
    body: () => [P('抗藥性結核病醫療照護團隊（TMTC）醫院名單（**示意名單，非正式公告**）：'), TABLE(['區域', '醫院', '聯絡窗口'], [[{ t: '北區', rowspan: 2 }, '示意醫院 A', '感染科'], ['示意醫院 B', '胸腔內科'], [{ t: '中區', rowspan: 2 }, '示意醫院 C', '胸腔內科'], ['示意醫院 D', '感染科'], [{ t: '南區與東區', colspan: 1 }, '示意醫院 E', '胸腔內科']])].join('\n'),
  };
  const end35 = C('news/2026-03-24-world-tb-day-end-tb-2035.json');
  S['end-tb-2035'] = { pub: '2019-01-15', upd: '2026-03-24', tab: 'end-tb-2035', body: () => [P(prog('end-tb-2035').summary), mdHtml(end35.bodyMarkdown.split('\n\n').slice(0, 2).join('\n\n'))].join('\n') };
  S['high-risk'] = { pub: '2019-01-15', upd: '2026-06-01', tab: 'high-risk', body: () => [P(prog('high-risk-screening').summary), ...prog('high-risk-screening').groups.map((g) => LI(g))].join('\n') };
  const sub = C('services/tb-treatment-subsidy.json');
  S.subsidy = {
    pub: '2019-01-15', upd: '2026-04-14', tab: 'subsidy',
    body: () => [mdHtml(sub.introMarkdown), P('個案另有需要時可填寫：[結核病醫療費用補助申請表（PDF）](__FILE__)')].join('\n'),
    attachments: [A_PDF('tb-subsidy-application.pdf', '結核病醫療費用補助申請表（PDF）', `${BASE}/File/Get/${fakeId('subsidy')}`, pdfText('TB treatment subsidy application (SAMPLE)', ['SAMPLE FILE FOR PROTOTYPE - NOT AN OFFICIAL FORM.']))],
  };
  S.foreigner = { pub: '2019-01-15', upd: '2026-09-15', tab: 'foreigner', body: () => [mdHtml(faq('tb-foreigner-health-check').answerMarkdown), TABLE(['對象', '健檢時機', '含胸部 X 光'], [['外籍移工', '入國前、入國後 3 個工作日內、聘僱期間', '是'], ['居留、定居', '申請時檢附健檢證明', '是']])].join('\n') };
  const rs = C('research/2025-migrant-tb-active-case-finding.json');
  S.research = {
    pub: '2025-12-01', upd: '2026-02-01', tab: 'migrant-tb-research',
    body: () => [P(`**${rs.title}**`), P(rs.abstractMarkdown), P('成果報告全文：[研究成果摘要（PDF）](__FILE__)')].join('\n'),
    attachments: [A_PDF('research-migrant-tb-summary.pdf', '研究成果摘要（PDF）', `${BASE}/File/Get/${fakeId('research')}`, pdfText('Migrant TB active case finding - summary (SAMPLE)', ['SAMPLE FILE FOR PROTOTYPE - NOT AN OFFICIAL REPORT.']))],
  };
  S['training-slides'] = {
    pub: '2023-08-10', upd: '2024-11-12', tab: 'training',
    body: () => [P('結核病教育訓練教材（投影片）：醫事人員在職訓練用。'), LI('[第一單元：結核病診斷與通報（PDF）](__FILE1__)'), LI('[第二單元：都治與接觸者檢查（PDF）](__FILE2__)')].join('\n'),
    attachments: [A_PDF('tb-training-part1.pdf', '第一單元：結核病診斷與通報（PDF）', `${BASE}/File/Get/${fakeId('train1')}`, pdfScan(11)), A_PDF('tb-training-part2.pdf', '第二單元：都治與接觸者檢查（PDF）', `${BASE}/File/Get/${fakeId('train2')}`, null)],
  };
  S.links = { pub: '2018-03-01', upd: '2025-05-05', tab: 'links', body: () => `<ul><li>${A('https://www.who.int/health-topics/tuberculosis', 'WHO：Tuberculosis')}</li><li>${A('https://www.cdc.gov/tb/', 'US CDC：Tuberculosis')}</li><li>${A('https://www.tbcare.org.tw/', '台灣防癆協會')}</li></ul>` };
  S['news-list'] = {
    pub: '2018-03-01', upd: '2026-09-21',
    body: () => `<ul class="list-group">${[['2026-08-20', '都治成效公布：完治率持續提升'], ['2026-03-24', '2035 消除結核：世界結核病日呼籲'], ['2025-03-24', '世界結核病日：咳嗽兩週請就醫']].map(([d, t], i) => `<li class="list-group-item"><span class="date">${d}</span> ${A(`/Bulletin/Detail/${fakeId(`n${i}`)}?typeid=9`, t)}</li>`).join('')}</ul>`,
  };
  const news = C('news/2025-03-24-world-tb-day.json');
  S['news-world-tb-day-2025'] = {
    pub: '2025-03-24', upd: '2025-03-24', typeid: '9', tab: '2025-world-tb-day',
    title: `新聞稿：${news.title}`,
    body: () => [mdHtml(news.bodyMarkdown), P('新聞稿全文：[新聞稿（PDF）](__FILE__)')].join('\n'),
    attachments: [A_PDF('world-tb-day-2025-press.pdf', '新聞稿（PDF）', `${BASE}/File/Get/${fakeId('press2025')}`, pdfText('World TB Day 2025 press release (SAMPLE)', ['SAMPLE FILE FOR PROTOTYPE - NOT AN OFFICIAL NOTICE.']))],
  };
  S['event-2019'] = { pub: '2019-03-01', upd: '2019-04-10', tab: 'event-2019', body: () => [P('2019 世界結核病日健走活動報名即日起開始。'), LI('日期：2019 年 3 月 24 日'), LI('報名截止：2019 年 3 月 15 日')].join('\n') };

  void m;
  return S;
}

// ───────────────────────── 輸出 ─────────────────────────
export function generate(outDir) {
  const manifest = C('migration/tuberculosis.json');
  const S = specs(manifest.items);
  const out = path.resolve(outDir);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(path.join(out, 'files'), { recursive: true });
  let n = 0;
  const written = [];
  for (const it of manifest.items) {
    const s = S[it.key];
    if (!s) throw new Error(`模擬匯出缺頁面規格：${it.key}`);
    n++;
    const stem = `${String(n).padStart(2, '0')}-${it.key}`;
    // 舊網址：{id} 以穩定的假 ID 取代；疾病頁子頁共用同一個網址（分頁以 tab 區分）
    const parts = it.oldUrl.split('#');
    const shared = /\/Disease\/SubIndex\//.test(parts[0]);
    const url = parts[0].replace(/\{id\}/g, fakeId(shared ? 'Disease/SubIndex/tuberculosis' : `${new URL(parts[0].replace(/\{[a-z]+\}/gi, 'x')).pathname}:${it.key}`)).replace(/\{infoId\}/g, fakeId(`${it.key}:info`)).replace(/\{uaid\}/g, fakeId(`${it.key}:uaid`));
    const typeidMatch = /typeid=(\d+)/.exec(url);
    const atts = (s.attachments ?? []).map((a, i) => ({ url: a.url ?? url, label: a.label, file: a.name, _buf: a.buf, _i: i }));
    // 檔案頁（File/Get）：附件就是這個網址本身
    if (/\/(File\/Get|Uploads)\//.test(url) && atts[0] && !s.attachments[0].url) atts[0].url = url;
    atts.forEach((a, i) => { if (a.url === null) a.url = `${BASE}/File/Get/${fakeId(`${it.key}:${i}`)}`; });
    let body = s.body();
    const fileLink = (i) => atts[i]?.url ?? '#';
    body = body.replace(/__FILE__/g, fileLink(0)).replace(/__FILE1__/g, fileLink(0)).replace(/__FILE2__/g, fileLink(1));
    const title = s.title ?? it.oldTitle;
    const crumbs = ['首頁', '傳染病與防疫專題', ...String(it.oldPath).split('／')];
    const category = String(it.oldPath).split('／').slice(0, 2).join('／');
    const fileList = atts.length ? `<div class="file-list"><h4>相關檔案</h4><ul>${atts.map((a) => `<li><a href="${esc(a.url)}">${esc(a.label)}</a> <span class="size">(${esc(path.extname(a.file).slice(1).toUpperCase())})</span></li>`).join('')}</ul></div>` : '';
    const html = shell({ title, crumbs, bodyHtml: `${body}\n${fileList}`, updated: s.upd, menuActive: String(it.oldPath).split('／')[1] ?? '' });
    fs.writeFileSync(path.join(out, `${stem}.html`), html);
    const side = {
      url, title, category, publishedAt: s.pub, updatedAt: s.upd, breadcrumbs: crumbs,
      ...(typeidMatch ? { typeid: typeidMatch[1] } : {}), ...(s.tab ? { tab: s.tab } : {}),
      attachments: atts.map((a) => ({ url: a.url, label: a.label, file: a.file })),
    };
    fs.writeFileSync(path.join(out, `${stem}.json`), `${JSON.stringify(side, null, 2)}\n`);
    for (const a of atts) if (a._buf) fs.writeFileSync(path.join(out, 'files', a.file), a._buf);
    for (const [f, buf] of Object.entries(s.files ?? {})) fs.writeFileSync(path.join(out, 'files', f), buf);
    written.push(stem);
  }
  fs.writeFileSync(path.join(out, '_export.json'), `${JSON.stringify({
    format: 'cdc-legacy-export/1', simulated: true, exportedAt: EXPORTED_AT, site: BASE, batch: 'tuberculosis', pages: n,
    source: '模擬匯出：依 content/migration/tuberculosis.json 的 40 筆人工項目合成，不是舊站的真實資料（網址 ID、數字、醫院名單皆為示意）。正式匯出取代整個目錄即可。',
    generator: 'scripts/lib/legacy-import/sim-export.mjs',
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(out, 'README.md'), README);
  return { dir: out, pages: n, files: fs.readdirSync(path.join(out, 'files')).length };
}

const README = `# 舊站匯出（模擬）：結核病專區

> **這是模擬匯出。** 開發環境連不到 www.cdc.gov.tw，所以這 40 頁是依 \`content/migration/tuberculosis.json\` 的 40 筆人工項目合成的：HTML 長得像舊站（Bootstrap 版型外殼、麵包屑、側欄、Word 貼上的 \`span／mso\` 樣式、表格、附件連結、圖片、Q&A 手風琴），內文文字反推自既有結核病內容，網址中的 ID、統計數字、醫院名單、PDF 內容都是示意。**正式匯出取代整個目錄即可**，不需要改程式。

## 重新產生

\`\`\`
node scripts/lib/legacy-import/sim-export.mjs data/legacy-export/tuberculosis
\`\`\`

## 匯出格式（資訊室從 CMS 資料庫匯出時照這個做）

每頁兩個檔，檔名相同：

| 檔案 | 內容 |
| --- | --- |
| \`{name}.html\` | 舊站頁面的完整 HTML（含版型外殼；轉換時只取內容區 \`#CCMS_Content\`，外殼規則見 \`content/migration/import/_import-rules.json\` 的 \`extraction\`） |
| \`{name}.json\` | 側檔，欄位如下 |
| \`files/\` | 附件與內文圖片，檔名對應側檔 \`attachments[].file\` 與 \`<img src>\` 的檔名 |
| \`_export.json\` | 選填：\`exportedAt\`（草稿的 reviewedAt）、\`simulated\`、\`source\`、\`site\` |

也可以只給一個 \`index.json\` 陣列，每筆＝側檔欄位加 \`html\`（內嵌字串）或 \`htmlFile\`（相對路徑）。

### 側檔欄位

| 欄位 | 型別 | 說明 |
| --- | --- | --- |
| \`url\` | string | 舊站完整網址（用來比對 URL 模式與移轉清單） |
| \`title\` | string | 頁面標題 |
| \`category\` | string | 欄目階層，以「／」分隔（例：\`結核病／防治政策\`），用來對應權責單位 |
| \`publishedAt\` | date | 首次發布日（YYYY-MM-DD） |
| \`updatedAt\` | date | 最後更新日 |
| \`breadcrumbs\` | string[] | 麵包屑（含「首頁」） |
| \`attachments\` | [{url,label,file}] | 附件：舊站檔案網址、顯示名稱、\`files/\` 內的檔名 |
| \`typeid\` | string | 選填：Bulletin 的 typeid（9 新聞稿、8772 澄清、11 其他、158 英文）；也可只寫在 \`url\` 的 query |
| \`tab\` | string | 選填：同一網址內的分頁錨點（疾病頁的 #symptoms 之類） |

## 轉換

\`\`\`
node scripts/import-legacy.mjs data/legacy-export/tuberculosis --out data/legacy-import/tuberculosis --apply-migration
\`\`\`

輸出在 \`data/legacy-import/tuberculosis/\`（草稿、assets、report.json、report.md、migration-patch.json），後台 \`/admin/import/\` 可看。
`;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = process.argv[2] ?? path.join(ROOT, 'data/legacy-export/tuberculosis');
  const r = generate(dir);
  console.log(`模擬匯出：${r.pages} 頁、files/ ${r.files} 個檔 → ${path.relative(ROOT, r.dir)}`);
}
