#!/usr/bin/env node
// 第八輪（ARCHITECTURE 16.1）樣本檔案資產產生器：零依賴、可重跑（輸出固定，不含時間戳；同一份 Node 版本重跑 sha256 不變）。
// 產生到 content/assets/{content-id}/，最後印出每個檔的 bytes／sha256／mime 並呼叫 fixAssets 補寫回內容 JSON。
//
// 用法：node scripts/gen-sample-assets.mjs           產生檔案＋補寫 assets 欄位
//       node scripts/gen-sample-assets.mjs --no-fix  只產生檔案、印出數值（由同事自行貼回）
//
// 產出（皆為示意檔，非正式公告；PDF 文字層只用 Helvetica 寫英文與 ASCII 說明，中文字型不嵌入，中文標題放在 PDF 文件資訊）：
//   news.2026-09-21-flu-antiviral-revised/press-release.pdf   新聞稿全文（示意，單頁 PDF，含文字層）
//   news.2026-09-21-flu-antiviral-revised/chart-ili.svg       類流感門急診就診率週趨勢（示意，SVG）
//   doc.tb-guideline.2025-09-01/tb-guideline-v8.pdf           結核病診治指引第八版（示意封面＋章節）
//   doc.tb-guideline.2025-09-01/tb-guideline-v8.md            同上可及性版本（由內容檔 machineReadableMarkdown 產生）
//   publication.poster-tb-seven-languages/poster-tb-seven-languages.pdf  七語衛教海報（示意）
//   publication.poster-tb-seven-languages/poster-tb-seven-languages.md   同上七語純文字可及性版本
//   service.ltbi-treatment/ltbi-consent-form.pdf              潛伏結核感染治療同意書（示意表單）
//   service.ltbi-treatment/ltbi-consent-form.md               同上純文字可及性版本
//   dataset.tb-new-cases/tb-new-cases-sample.csv              結核病新案統計範例（示意數字）
//   topic.tb-prevention/end-tb-2035.png                       2035 消除結核目標路徑（示意長條圖，手寫 PNG 編碼）
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { ASSETS_DIR, inspectAsset, extOf, fixAssets } from './lib/assets.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const out = [];
function put(id, file, data) {
  const dir = path.join(ASSETS_DIR, id);
  fs.mkdirSync(dir, { recursive: true });
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
  fs.writeFileSync(path.join(dir, file), buf);
  out.push({ id, file, ...inspectAsset(buf, extOf(file)) });
}

// ───────────────────────── PDF（單頁、Type1 Helvetica、WinAnsi；含文字層） ─────────────────────────

const pdfStr = (s) => `(${String(s).replace(/[\\()]/g, (c) => `\\${c}`).replace(/[^\x20-\x7e]/g, '?')})`;
/** UTF-16BE hex 字串（文件資訊的中文標題） */
const pdfUtf16 = (s) => `<FEFF${Buffer.from(String(s), 'utf16le').swap16().toString('hex').toUpperCase()}>`;

/**
 * @param {{ title: string, titleEn: string, subject?: string, lang?: string, size?: [number, number], ops: string[] }} doc
 * ops：PDF 內容串流運算子（已排好座標）
 */
function makePdf({ title, titleEn, subject = '', lang = 'en', size = [595, 842], ops }) {
  const content = ops.join('\n');
  const objs = [
    `<< /Type /Catalog /Pages 2 0 R /Lang ${pdfStr(lang)} /ViewerPreferences << /DisplayDocTitle true >> >>`,
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${size[0]} ${size[1]}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
    `<< /Title ${pdfUtf16(title)} /Subject ${pdfUtf16(subject || titleEn)} /Author ${pdfUtf16('衛生福利部疾病管制署（原型示意）')} /Keywords ${pdfStr('sample; demonstration; prototype')} /Creator ${pdfStr('scripts/gen-sample-assets.mjs')} /Producer ${pdfStr('cdc prototype (zero-dependency PDF writer)')} >>`,
  ];
  let body = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(Buffer.byteLength(body, 'latin1')); body += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(body, 'latin1');
  body += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  body += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info ${objs.length} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

/** 簡易排版：回傳運算子陣列 */
function layout({ header, headerSub, color = [0.0, 0.33, 0.55], lines, footer, size = [595, 842] }) {
  const [W, H] = size;
  const ops = [];
  ops.push(`${color.join(' ')} rg 0 ${H - 96} ${W} 96 re f`);
  ops.push(`BT /F2 20 Tf 1 1 1 rg 48 ${H - 52} Td ${pdfStr(header)} Tj ET`);
  if (headerSub) ops.push(`BT /F1 11 Tf 1 1 1 rg 48 ${H - 76} Td ${pdfStr(headerSub)} Tj ET`);
  // 示意標記（右上角）
  ops.push(`0.80 0.10 0.10 rg ${W - 170} ${H - 130} 122 22 re f`);
  ops.push(`BT /F2 11 Tf 1 1 1 rg ${W - 162} ${H - 123} Td ${pdfStr('SAMPLE / DEMO ONLY')} Tj ET`);
  let y = H - 160;
  for (const l of lines) {
    if (l === '') { y -= 10; continue; }
    const [font, sizePt, text, indent = 0] = typeof l === 'string' ? ['F1', 11, l] : l;
    ops.push(`BT /${font} ${sizePt} Tf 0.12 0.12 0.12 rg ${48 + indent} ${y} Td ${pdfStr(text)} Tj ET`);
    y -= sizePt + 7;
  }
  ops.push(`0.6 0.6 0.6 RG 0.5 w 48 64 m ${W - 48} 64 l S`);
  for (const [i, f] of (footer ?? []).entries()) ops.push(`BT /F1 8 Tf 0.35 0.35 0.35 rg 48 ${50 - i * 11} Td ${pdfStr(f)} Tj ET`);
  return ops;
}
const FOOTER = [
  'Demonstration file generated by scripts/gen-sample-assets.mjs for the Taiwan CDC website prototype (shi-yi wen-jian / sample document).',
  'Not an official publication. Chinese text is not embedded in this PDF; the authoritative Chinese text is on the web page and its .md version.',
];

// 1) 新聞稿 PDF
put('news.2026-09-21-flu-antiviral-revised', 'press-release.pdf', makePdf({
  title: '示意文件：類流感進入高峰期，65 歲以上有症狀者可直接使用公費抗病毒藥劑免快篩（新聞稿全文）',
  titleEn: 'Press release (sample): ILI peak declared; antivirals for people aged 65+ without a rapid test',
  ops: layout({
    header: 'Taiwan CDC Press Release (SAMPLE)', headerSub: 'Released 2026-09-21  |  Division of Acute Infectious Diseases',
    lines: [
      ['F2', 15, 'ILI peak declared: people aged 65+ with flu-like symptoms'],
      ['F2', 15, 'can receive government-funded antivirals without a rapid test'],
      '',
      'Emergency and outpatient visits for influenza-like illness (ILI) have risen for 4 consecutive weeks',
      'and are above the epidemic threshold. The ILI peak period starts today (2026-09-21).',
      '',
      ['F2', 12, 'What changes (Article 3 of the eligibility criteria):'],
      ['F1', 11, '- Aged 65 or older with ILI symptoms: physicians may prescribe directly; no positive rapid test needed.', 12],
      ['F1', 11, '- Children under 5: a positive rapid test is still required.', 12],
      '',
      ['F2', 12, 'Advice:'],
      ['F1', 11, '- Antivirals work best within 48 hours of symptom onset.', 12],
      ['F1', 11, '- Older adults with fever, cough or body aches should see a doctor early.', 12],
      ['F1', 11, '- Hotline: 1922 (from abroad +886-800-001922).', 12],
      '',
      ['F1', 10, 'Chart (sample): weekly ILI visit rate, see chart-ili.svg on the press release page.'],
    ],
    footer: FOOTER,
  }),
}));

// 2) 結核病診治指引 PDF（封面＋章節）
put('doc.tb-guideline.2025-09-01', 'tb-guideline-v8.pdf', makePdf({
  title: '示意文件：結核病診治指引（第八版）',
  titleEn: 'Taiwan Guidelines for TB Diagnosis and Treatment, 8th edition (sample)',
  ops: layout({
    header: 'Taiwan Guidelines for TB Diagnosis & Treatment', headerSub: '8th edition  |  Effective 2025-09-01  |  Division of Chronic Infectious Diseases',
    color: [0.16, 0.36, 0.25],
    lines: [
      ['F2', 15, 'Sample cover and table of contents'],
      '',
      ['F2', 12, 'Chapter 1  Diagnosis'],
      ['F1', 11, 'Molecular rapid testing (incl. rifampin resistance genes) as first-line test for all suspected cases.', 12],
      ['F2', 12, 'Chapter 2  Drug-susceptible TB'],
      ['F1', 11, '2HRZE/4HR remains standard; 4-month short regimen may be considered for eligible patients aged 12+.', 12],
      ['F2', 12, 'Chapter 3  Drug-resistant TB'],
      ['F1', 11, 'All-oral short regimen (about 6 months) preferred for RR-/MDR-TB; injectables no longer routine.', 12],
      ['F2', 12, 'Chapter 4  Latent TB infection'],
      ['F1', 11, 'Regimens 9H, 4R, 3HP, 3HR; new: 1HP (28 daily doses, aged 13+).', 12],
      ['F2', 12, 'Chapter 5  Special populations'],
      ['F1', 11, 'Children, pregnancy, HIV, diabetes, kidney and liver disease; rifamycin drug interactions.', 12],
      '',
      ['F1', 10, 'Accessible version: tb-guideline-v8.md (full Chinese text, machine-readable).'],
    ],
    footer: FOOTER,
  }),
}));

// 2b) 可及性版本：由內容檔 machineReadableMarkdown 產生（內容改了重跑即同步）
{
  const doc = JSON.parse(fs.readFileSync(path.join(ROOT, 'content/documents/tb-guideline.2025-09-01.json'), 'utf8'));
  const md = [
    '<!-- 可及性版本（示意）：由 scripts/gen-sample-assets.mjs 依內容檔 machineReadableMarkdown 產生；與 tb-guideline-v8.pdf 同一版次 -->',
    '',
    `> 版次：${doc.version} · 生效日：${doc.effectiveAt} · 權責單位：慢性傳染病組 · 授權：${doc.license}`,
    '> 本檔為原型示意文件，非正式公告文字；正式內容以疾病管制署公告之 PDF 正本為準。',
    '',
    doc.machineReadableMarkdown.trim(),
    '',
  ].join('\n');
  put('doc.tb-guideline.2025-09-01', 'tb-guideline-v8.md', md);
}

// 3) 七語衛教海報 PDF（A4 直式示意）
put('publication.poster-tb-seven-languages', 'poster-tb-seven-languages.pdf', makePdf({
  title: '示意文件：咳嗽兩週要就醫——結核病七語衛教海報',
  titleEn: 'Cough for two weeks? See a doctor. TB poster in seven languages (sample)',
  ops: layout({
    header: 'Cough for 2 weeks? See a doctor.', headerSub: 'TB awareness poster  |  2026 edition  |  7 languages (sample)',
    color: [0.62, 0.20, 0.08],
    lines: [
      ['F2', 16, 'TB can be cured. Treatment is free.'],
      '',
      ['F2', 12, 'English'],
      ['F1', 11, 'Cough over 2 weeks, phlegm, weight loss or night sweats? Please see a doctor.', 12],
      ['F2', 12, 'Tagalog'],
      ['F1', 11, 'Ubo nang higit 2 linggo? Magpatingin sa doktor. Libre ang gamutan.', 12],
      ['F2', 12, 'Bahasa Indonesia'],
      ['F1', 11, 'Batuk lebih dari 2 minggu? Segera periksa ke dokter. Pengobatan gratis.', 12],
      ['F2', 12, 'Tieng Viet (diacritics omitted in this sample)'],
      ['F1', 11, 'Ho tren 2 tuan? Hay di kham bac si. Dieu tri mien phi.', 12],
      ['F2', 12, 'zh-TW / ja / th'],
      ['F1', 11, 'Text not embedded in this sample PDF (no CJK/Thai fonts). See the web page for the full text.', 12],
      '',
      ['F1', 11, 'DOTS: a care worker supports you to take every dose.'],
      ['F1', 11, 'Hotline 1922 (from abroad +886-800-001922)'],
      '',
      ['F1', 10, 'Plain-text version in all seven languages: poster-tb-seven-languages.md'],
    ],
    footer: FOOTER,
  }),
}));

// 3b) 海報純文字版（七語；可及性版本，譯文為原型示意、未經審核）
put('publication.poster-tb-seven-languages', 'poster-tb-seven-languages.md', `<!-- 海報純文字可及性版本（示意）：與 poster-tb-seven-languages.pdf 同內容；由 scripts/gen-sample-assets.mjs 產生。譯文為原型示意，未經審核 -->

# 咳嗽兩週要就醫：結核病七語衛教海報（純文字版）

> 原型示意文件；海報圖片不承載唯一資訊，以下為海報全部文字。

## 繁體中文（zh-TW）

咳嗽兩週要就醫。咳嗽超過兩週、有痰、體重減輕、夜間盜汗，請儘速就醫。結核病可以治癒，治療免費；都治關懷員陪伴您按時服藥。防疫專線 1922。

## English（en）

Cough for two weeks? See a doctor. If you have had a cough for more than two weeks, phlegm, weight loss or night sweats, please see a doctor. TB can be cured and treatment is free. A DOTS care worker will support you to take every dose. Hotline 1922.

## 日本語（ja）

2週間以上せきが続いたら受診を。せきが2週間以上続く、たんが出る、体重が減る、寝汗をかく場合は、早めに医療機関を受診してください。結核は治る病気で、治療は無料です。服薬支援員が毎回の服薬をサポートします。相談ダイヤル 1922。

## Tiếng Việt（vi）

Ho hai tuần hãy đi khám. Nếu bạn ho trên hai tuần, có đờm, sụt cân hoặc đổ mồ hôi ban đêm, hãy đi khám bác sĩ. Bệnh lao có thể chữa khỏi và việc điều trị là miễn phí. Nhân viên chăm sóc DOTS sẽ hỗ trợ bạn uống thuốc đủ liều. Đường dây nóng 1922.

## Bahasa Indonesia（id）

Batuk dua minggu? Periksakan ke dokter. Jika Anda batuk lebih dari dua minggu, berdahak, berat badan turun, atau berkeringat di malam hari, segera periksakan diri ke dokter. TBC dapat disembuhkan dan pengobatannya gratis. Petugas DOTS akan mendampingi Anda minum obat setiap hari. Hotline 1922.

## ไทย（th）

ไอนานสองสัปดาห์ ควรไปพบแพทย์ หากไอติดต่อกันเกินสองสัปดาห์ มีเสมหะ น้ำหนักลด หรือมีเหงื่อออกตอนกลางคืน กรุณาไปพบแพทย์ วัณโรครักษาหายได้และรักษาฟรี เจ้าหน้าที่ DOTS จะช่วยดูแลให้กินยาครบทุกครั้ง สายด่วน 1922

## Tagalog（tl）

Ubo nang dalawang linggo? Magpatingin sa doktor. Kung higit dalawang linggo ka nang inuubo, may plema, pumapayat, o pinagpapawisan sa gabi, magpatingin agad sa doktor. Nagagamot ang TB at libre ang gamutan. Tutulungan ka ng DOTS care worker na inumin ang bawat dosis. Hotline 1922.
`);

// 4) 潛伏結核感染治療同意書 PDF＋純文字版
put('service.ltbi-treatment', 'ltbi-consent-form.pdf', makePdf({
  title: '示意文件：潛伏結核感染治療同意書',
  titleEn: 'Consent form for latent TB infection (LTBI) treatment (sample form)',
  ops: layout({
    header: 'LTBI Treatment Consent Form (SAMPLE)', headerSub: 'Latent tuberculosis infection  |  form layout only, not for actual use',
    color: [0.25, 0.25, 0.45],
    lines: [
      ['F2', 12, '1. Patient information (fill in at the health center)'],
      ['F1', 11, 'Name: ______________________    Date of birth: ____ / ____ / ______', 12],
      ['F1', 11, 'Contact: ____________________    Health center: _______________________', 12],
      '',
      ['F2', 12, '2. Regimen chosen with the physician (tick one)'],
      ['F1', 11, '[ ] 9H    [ ] 4R    [ ] 3HP    [ ] 3HR    [ ] 1HP', 12],
      '',
      ['F2', 12, '3. I understand that'],
      ['F1', 11, '- Treatment is free of charge and lowers the risk of developing active TB.', 12],
      ['F1', 11, '- I should tell my doctor about other medicines and avoid alcohol during treatment.', 12],
      ['F1', 11, '- I can stop and ask questions at any time; side effects should be reported early.', 12],
      '',
      ['F2', 12, '4. Signatures'],
      ['F1', 11, 'Patient (or guardian): ____________________   Date: ______________', 12],
      ['F1', 11, 'Physician: ______________________________   Date: ______________', 12],
      '',
      ['F1', 10, 'Plain-text accessible version: ltbi-consent-form.md'],
    ],
    footer: FOOTER,
  }),
}));
put('service.ltbi-treatment', 'ltbi-consent-form.md', `<!-- 純文字可及性版本（示意）：與 ltbi-consent-form.pdf 同內容；由 scripts/gen-sample-assets.mjs 產生 -->

# 潛伏結核感染治療同意書（示意表單）

> 原型示意文件，版面與欄位僅供展示，不得作為實際表單使用。正式表單請洽戶籍或居住地衛生所。

## 一、個案資料（由衛生所協助填寫）

- 姓名：
- 出生日期：
- 聯絡方式：
- 所屬衛生所：

## 二、與醫師討論後選擇的處方（擇一）

- [ ] 9H
- [ ] 4R
- [ ] 3HP
- [ ] 3HR
- [ ] 1HP

## 三、我已了解

1. 潛伏結核感染治療免費，可降低日後發病為活動性結核病的風險。
2. 治療期間應告知醫師正在使用的其他藥物，並避免飲酒。
3. 有任何疑問或副作用，可隨時向醫師或衛生所提出；必要時可停止治療。

## 四、簽名

- 個案（或法定代理人）簽名：　　　　日期：
- 醫師簽名：　　　　日期：

防疫專線 1922（國外 +886-800-001922）
`);

// ───────────────────────── SVG：類流感門急診就診率週趨勢（示意） ─────────────────────────
{
  const weeks = ['W31', 'W32', 'W33', 'W34', 'W35', 'W36', 'W37', 'W38'];
  const vals = [5.2, 5.6, 6.1, 6.9, 8.1, 9.0, 10.3, 12.0];
  const threshold = 7.0;
  const W = 640, H = 360, L = 56, R = 24, T = 48, B = 52;
  const x = (i) => L + (i * (W - L - R)) / (weeks.length - 1);
  const y = (v) => T + (H - T - B) * (1 - v / 14);
  const pts = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const grid = [0, 2, 4, 6, 8, 10, 12, 14].map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="#d9dde3" stroke-width="1"/><text x="${L - 8}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end" font-size="12" fill="#4b5563">${v}%</text>`).join('\n  ');
  const xl = weeks.map((w, i) => `<text x="${x(i).toFixed(1)}" y="${H - B + 20}" text-anchor="middle" font-size="12" fill="#4b5563">${w}</text>`).join('\n  ');
  const dots = vals.map((v, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="4" fill="#b42318"/>`).join('\n  ');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="t d" font-family="'Noto Sans TC', 'PingFang TC', 'Microsoft JhengHei', sans-serif">
  <title id="t">類流感門急診就診率週趨勢（示意）</title>
  <desc id="d">2026 年第 31 至 38 週類流感門急診就診率由 5.2% 上升到 12.0%，自第 34 週起超過流行閾值 7%，連續 4 週上升。數字為示意。</desc>
  <rect width="${W}" height="${H}" fill="#ffffff"/>
  <text x="${L}" y="28" font-size="16" font-weight="700" fill="#111827">類流感門急診就診率（示意）</text>
  ${grid}
  <line x1="${L}" x2="${W - R}" y1="${y(threshold).toFixed(1)}" y2="${y(threshold).toFixed(1)}" stroke="#b45309" stroke-width="2" stroke-dasharray="6 4"/>
  <text x="${W - R}" y="${(y(threshold) - 6).toFixed(1)}" text-anchor="end" font-size="12" fill="#b45309">流行閾值 ${threshold}%</text>
  <polyline points="${pts}" fill="none" stroke="#b42318" stroke-width="3" stroke-linejoin="round"/>
  ${dots}
  ${xl}
  <text x="${W - R}" y="${H - 8}" text-anchor="end" font-size="11" fill="#6b7280">資料：疾管署（示意數字，非正式統計）</text>
</svg>
`;
  put('news.2026-09-21-flu-antiviral-revised', 'chart-ili.svg', svg);
}

// ───────────────────────── PNG：2035 消除結核目標路徑（示意長條圖；手寫 PNG 編碼） ─────────────────────────

const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
/** RGB 像素陣列 → PNG（8 位元 RGB、無交錯、每列 filter 0；tEXt 註記示意） */
function encodePng(width, height, rgb, texts = {}) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let yy = 0; yy < height; yy++) { raw[yy * (width * 3 + 1)] = 0; rgb.copy(raw, yy * (width * 3 + 1) + 1, yy * width * 3, (yy + 1) * width * 3); }
  const textChunks = Object.entries(texts).map(([k, v]) => chunk('tEXt', Buffer.from(`${k}\0${v}`, 'latin1')));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), ...textChunks, chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
{
  const W = 480, H = 270;
  const px = Buffer.alloc(W * H * 3, 255);
  const fill = (x0, y0, x1, y1, [r, g, b]) => { for (let yy = Math.max(0, y0); yy < Math.min(H, y1); yy++) for (let xx = Math.max(0, x0); xx < Math.min(W, x1); xx++) { const i = (yy * W + xx) * 3; px[i] = r; px[i + 1] = g; px[i + 2] = b; } };
  // 每十萬人口發生率（示意）：2016 → 2035
  const years = [2016, 2018, 2020, 2022, 2024, 2026, 2028, 2030, 2032, 2035];
  const vals = [44, 40, 33, 30, 28, 26, 22, 18, 14, 10];
  const L = 40, R = 16, T = 20, B = 30, max = 50;
  const yOf = (v) => Math.round(T + (H - T - B) * (1 - v / max));
  for (const v of [10, 20, 30, 40, 50]) fill(L, yOf(v), W - R, yOf(v) + 1, [225, 229, 235]); // 格線
  fill(L, T, L + 2, H - B, [107, 114, 128]); fill(L, H - B, W - R, H - B + 2, [107, 114, 128]); // 座標軸
  const bw = Math.floor((W - L - R) / years.length);
  years.forEach((yr, i) => {
    const x0 = L + 6 + i * bw, x1 = x0 + bw - 12;
    const actual = yr <= 2024;
    fill(x0, yOf(vals[i]), x1, H - B, actual ? [31, 94, 140] : [143, 182, 211]); // 實際（深）／目標路徑（淺）
  });
  for (let xx = L; xx < W - R; xx += 12) fill(xx, yOf(10) - 1, xx + 7, yOf(10) + 2, [180, 35, 24]); // 2035 目標 10 虛線
  put('topic.tb-prevention', 'end-tb-2035.png', encodePng(W, H, px, { Title: 'End TB 2035 target pathway (sample)', Description: 'Sample chart: TB incidence per 100,000 falling from 44 (2016) to the 2035 target of 10. Demonstration only.', Software: 'scripts/gen-sample-assets.mjs' }));
}

// ───────────────────────── CSV：結核病新案統計範例（示意數字） ─────────────────────────
{
  const rows = [['year', 'sex', 'new_cases', 'incidence_per_100k', 'note']];
  const data = { 2021: [4520, 2310], 2022: [4380, 2210], 2023: [4310, 2150], 2024: [4180, 2090], 2025: [4020, 2010] };
  const pop = { 2021: [11.73, 11.83], 2022: [11.68, 11.81], 2023: [11.66, 11.79], 2024: [11.64, 11.78], 2025: [11.61, 11.77] }; // 百萬人（示意）
  for (const [yr, [m, f]] of Object.entries(data)) {
    rows.push([yr, 'male', m, (m / pop[yr][0] / 10).toFixed(1), '示意數字，非官方統計']);
    rows.push([yr, 'female', f, (f / pop[yr][1] / 10).toFixed(1), '示意數字，非官方統計']);
  }
  put('dataset.tb-new-cases', 'tb-new-cases-sample.csv', `${rows.map((r) => r.join(',')).join('\n')}\n`);
}

// ───────────────────────── 輸出 ─────────────────────────
console.log('[gen-sample-assets] 產生 %d 個檔 → %s', out.length, path.relative(ROOT, ASSETS_DIR));
for (const f of out) console.log(`  ${f.id}/${f.file}\n    mime ${f.mime}  bytes ${f.bytes}  sha256 ${f.sha256}${f.width ? `  ${f.width}×${f.height}` : ''}`);
if (!args.has('--no-fix')) {
  const { loadSite } = await import('./lib/load.mjs');
  const { config } = await import('../site.config.mjs');
  const site = loadSite(config);
  const r = fixAssets(site);
  console.log(`[gen-sample-assets] fixAssets：補寫 ${r.changed.length} 個檔的欄位、改寫 ${r.written.length} 個內容檔${r.written.length ? `（${r.written.join('、')}）` : ''}`);
  console.log('  （內容檔需先宣告 assets[]：file、kind、label／alt、license…；未宣告的檔會被列為孤兒檔）');
}
