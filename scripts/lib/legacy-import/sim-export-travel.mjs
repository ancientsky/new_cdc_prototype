#!/usr/bin/env node
// 國際旅遊與健康欄目的模擬匯出（ARCHITECTURE 17.3 第九批）：舊站 /Category/List/tRbpXpZM7EO3-dkc4RYZuQ 底下的頁面
//   對應既有新站內容（content/services、datasets、media、diseases、faq）與新站由資料產生的頁：
//     - 列表頁 4 頁（欄目總覽、旅遊醫學、國際旅遊保健資訊、國際疫情訊息列表；skip-list）
//     - 動態查詢頁「國際旅遊處方箋」（<form>＋231 個 <option>，測動態頁偵測）
//     - 6 個國家結果頁（同一路徑、只差 ?iso=，新站由 /travel/{ISO2}/ 資料產生，測「由資料產生」判定）
//     - 內容頁：旅遊醫學門診（合約院所表）、國際預防接種及藥物（含主檔沒有的疫苗）、出國前／返國後注意事項、
//       黃皮書申請（含 PDF 附件）、疫情建議等級表、瘧疾預防用藥（併入疾病頁）、宣導影片（iframe）
//     - 另複製 Q&A 批匯出的「國際旅遊常見問答」頁（同網址，測跨批重複）
//   數字、電話、醫院名單、網址 ID（除標明的真實 ID 外）皆為示意；/TravelEpidemic/Prescription/ 是推測的網址模式。
//   正式匯出（資訊室從 CMS 匯出欄目）取代整個目錄即可。
// 用法：node scripts/lib/legacy-import/sim-export-travel.mjs [輸出目錄]   （預設 data/legacy-export/travel）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { BASE, esc, fakeId, P, LI, LIO, H, A, TABLE, mdHtml, pdfText, shell } from './sim-export.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const CONTENT = path.join(ROOT, 'content');
export const EXPORTED_AT = '2026-10-03';
const J = (p) => JSON.parse(fs.readFileSync(path.join(CONTENT, p), 'utf8'));

const TOP = ['首頁', '國際旅遊與健康'];
const MED = [...TOP, '旅遊醫學'];
const RX = [...MED, '國際旅遊處方箋'];

export function generateTravel(outDir) {
  const countries = J('master/countries.json');
  const byIso = new Map(countries.map((c) => [c.iso2, c]));
  const items = [];
  const page = (key, o) => items.push({ key, atts: [], ...o });
  const pid = (s) => fakeId(`travel:${s}`);
  const rxPath = `${BASE}/TravelEpidemic/Prescription/${pid('prescription-detail')}`;

  // ── 動態查詢頁 ──
  page('prescription-query', {
    url: `${BASE}/Category/MPage/${pid('prescription')}`, title: '國際旅遊處方箋', crumbs: [...MED, '國際旅遊處方箋'], pub: '2016-05-01', upd: '2026-09-01',
    body: () => `${P('選擇目的地，即可查詢當地流行疾病、建議疫苗與行前注意事項。')}
<form class="travel-rx" method="get" action="/TravelEpidemic/Prescription/${pid('prescription-detail')}"><label for="iso">目的地</label><select id="iso" name="iso">${countries.map((c) => `<option value="${esc(c.iso2)}">${esc(c.name)}</option>`).join('')}</select> <label><input type="checkbox" name="special" value="1"> 特殊族群（孕婦、幼兒、慢性病）</label> <button type="submit" class="btn btn-primary">查詢</button></form>
<p class="note">建議出國前 4 至 6 週查詢並至旅遊醫學門診評估。</p>`,
  });

  // ── 國家結果頁 ──
  const rx = {
    JP: { rows: [['麻疹', '第一級：注意', '出國前確認 MMR 接種史，未具免疫力者出發前 2 至 4 週接種'], ['日本腦炎', '第一級：注意', '郊區停留或夏季長住者可評估接種'], ['登革熱', '無特別建議', '日本境內傳播風險低，一般防蚊即可']], vac: ['MMR（麻疹、腮腺炎、德國麻疹）', '日本腦炎疫苗（長期停留郊區者）'], tips: ['入境日本前確認麻疹免疫力，旅途中避免接觸疑似病例。', '返國後 21 天內如出現發燒、出疹，請戴口罩就醫並主動告知旅遊史。'] },
    TH: { rows: [['登革熱', '第一級：注意', '全年皆有傳播，雨季較高，白天、傍晚加強防蚊'], ['瘧疾', '第一級：注意', '邊境山區有傳播，進入該區前請諮詢預防用藥'], ['日本腦炎', '第一級：注意', '農村地區長期停留者建議接種']], vac: ['A 型肝炎疫苗', '日本腦炎疫苗', '狂犬病疫苗（長期停留或接觸動物者）'], tips: ['使用含 DEET 防蚊液，穿著長袖衣褲，避免接觸流浪動物。', '返國後 21 天內發燒請就醫並說明曾赴泰國。'] },
    VN: { rows: [['登革熱', '第二級：警示', '各地皆有疫情，避免蚊蟲叮咬並清除住所積水'], ['麻疹', '第一級：注意', '出國前確認 MMR 接種史'], ['日本腦炎', '第一級：注意', '郊區長期停留者建議接種']], vac: ['MMR', 'A 型肝炎疫苗', '日本腦炎疫苗'], tips: ['避免飲用生水與未煮熟食物。', '返國後出現發燒、頭痛、肌肉痛請儘速就醫並告知旅遊史。'] },
    KE: { rows: [['黃熱病', '第二級：警示', '入境須持黃熱病疫苗接種證明（黃皮書）；出發前至少 10 日接種'], ['瘧疾', '第二級：警示', '全國多數地區有傳播，請依醫師處方服用預防藥物'], ['麻疹', '第一級：注意', '出國前確認 MMR 接種史']], vac: ['黃熱病疫苗（入境要求）', 'A 型肝炎疫苗', '傷寒疫苗', '狂犬病疫苗（長期停留者）'], tips: ['黃皮書需隨身攜帶，入境與轉機時可能查驗。', '返國後 21 天內發燒，請就醫並說明曾赴非洲瘧疾流行區。'] },
    BR: { rows: [['黃熱病', '第二級：警示', '部分州屬為建議接種區，入境須持黃熱病疫苗接種證明（黃皮書）'], ['登革熱', '第二級：警示', '全國皆有疫情，雨季尤其高峰，嚴格防蚊'], ['瘧疾', '第一級：注意', '亞馬遜地區有傳播，進入前請諮詢預防用藥']], vac: ['黃熱病疫苗', 'A 型肝炎疫苗', '傷寒疫苗'], tips: ['前往亞馬遜、中西部森林地區前至少 10 日完成黃熱病疫苗接種。', '返國後發燒、黃疸請立即就醫並告知旅遊史。'] },
    IN: { rows: [['登革熱', '第二級：警示', '雨季（6 至 10 月）疫情上升，加強防蚊'], ['瘧疾', '第一級：注意', '東北與中部部分地區有傳播，請諮詢預防用藥'], ['麻疹', '第一級：注意', '出國前確認 MMR 接種史']], vac: ['A 型肝炎疫苗', '傷寒疫苗', 'MMR', '狂犬病疫苗（接觸動物風險高者）'], tips: ['避免飲用未煮沸或未瓶裝的水，食物須充分煮熟。', '被動物咬傷或抓傷請立即清洗傷口並就醫評估狂犬病暴露後處置。'] },
  };
  for (const iso of ['BR', 'IN', 'JP', 'KE', 'TH', 'VN']) {
    const c = byIso.get(iso);
    if (!c) throw new Error(`master countries 沒有 ${iso}`);
    const r = rx[iso];
    page(`rx-${iso.toLowerCase()}`, {
      url: `${rxPath}?iso=${iso}`, title: `國際旅遊處方箋：${c.name}`, crumbs: [...RX, c.name], pub: '2024-01-15', upd: '2026-06-30',
      body: () => [H(3, '當地流行疾病'), TABLE(['疾病', '旅遊疫情建議等級', '建議'], r.rows), H(3, '建議疫苗'), ...r.vac.map((v) => LI(v)), H(3, '行前與返國注意'), ...r.tips.map((t) => P(t))].join('\n'),
    });
  }

  // ── 內容頁 ──
  const hospitals = [
    ['北部', '示意醫院甲（臺北）', '臺北市示意區示意路 1 號', '02-0000-0001', '週一至週五 08:30–12:00、週三下午 14:00–17:00'],
    ['北部', '示意醫院乙（新北）', '新北市示意區示意街 2 號', '02-0000-0002', '週二、週四 14:00–17:00'],
    ['北部', '示意醫院丙（桃園）', '桃園市示意區示意路 3 號', '03-000-0003', '週一至週五 08:30–11:30'],
    ['北部', '示意醫院丁（基隆）', '基隆市示意區示意路 4 號', '02-0000-0004', '週三 14:00–17:00'],
    ['中部', '示意醫院戊（臺中）', '臺中市示意區示意大道 5 號', '04-0000-0005', '週一至週五 08:30–12:00'],
    ['中部', '示意醫院己（彰化）', '彰化縣示意鎮示意路 6 號', '04-0000-0006', '週二、週五 14:00–17:00'],
    ['南部', '示意醫院庚（臺南）', '臺南市示意區示意路 7 號', '06-000-0007', '週一至週五 08:30–11:30'],
    ['南部', '示意醫院辛（高雄）', '高雄市示意區示意路 8 號', '07-000-0008', '週一、週三、週五 14:00–17:00'],
    ['南部', '示意醫院壬（屏東）', '屏東縣示意市示意路 9 號', '08-000-0009', '週四 08:30–11:30'],
    ['東部', '示意醫院癸（花蓮）', '花蓮縣示意市示意路 10 號', '03-000-0010', '週二、週四 08:30–11:30'],
    ['東部', '示意醫院子（臺東）', '臺東縣示意市示意路 11 號', '089-00-0011', '週三 14:00–17:00'],
    ['東部', '示意醫院丑（宜蘭）', '宜蘭縣示意市示意路 12 號', '03-000-0012', '週一、週五 08:30–11:30'],
  ];
  page('travel-clinics', {
    url: `${BASE}/Category/Page/ucmuQnzcJPue77qHt0IXeg`, title: '旅遊醫學門診', crumbs: [...MED, '旅遊醫學門診'], pub: '2015-06-01', upd: '2026-05-20',
    body: () => [P('旅遊醫學門診提供出國前健康諮詢、疫苗接種與預防用藥處方，部分院所需事先預約。建議出國前 4 至 6 週就診，醫師會依目的地、行程與個人健康狀況給予建議。'), TABLE(['區域', '合約醫院', '地址', '電話', '門診時間'], hospitals), P('上述院所同時受理國際預防接種證明書（黃皮書）的申請與接種，請攜帶護照就診。（名單與電話為示意）')].join('\n'),
  });
  page('vaccines-medications', {
    url: `${BASE}/Category/MPage/6786`, title: '國際預防接種及藥物', crumbs: [...MED, '國際預防接種及藥物'], pub: '2016-03-01', upd: '2026-04-10',
    body: () => [
      H(3, '黃熱病疫苗'), P('黃熱病疫苗接種一劑即可終身有效，接種後約 10 日生效。前往要求黃熱病接種證明的國家，須於出發前至少 10 日完成接種並取得國際預防接種證明書（黃皮書）。'), P('疫苗僅能於指定的黃熱病疫苗接種單位接種，請先向旅遊醫學門診預約。'),
      H(3, '流行性腦脊髓膜炎疫苗'), P('前往沙烏地阿拉伯朝覲（Hajj）或副朝（Umrah）者，入境要求須持有流行性腦脊髓膜炎疫苗接種證明，請於出發前 10 日至 3 年內完成接種。'),
      H(3, '傷寒疫苗'), P('前往南亞、東南亞、非洲等衛生條件較差地區，且停留時間較長或飲食衛生難以掌握者，建議接種傷寒疫苗，並注意飲水與食物安全。'),
      H(3, '瘧疾預防用藥'), P('依前往地區的瘧疾抗藥性選擇預防藥物，須經醫師處方。通常於出發前開始服用，停留期間持續服用，返國後仍需續服一段時間，請依處方完成療程。'), P('同時須落實防蚊措施，藥物不能取代防蚊。'),
      H(3, '其他建議疫苗'), P('A 型肝炎疫苗：前往衛生條件欠佳地區建議接種。日本腦炎疫苗：前往亞洲鄉村地區且停留較久者建議接種。'), P('狂犬病疫苗：前往狂犬病流行地區、可能接觸動物或長期停留者，可評估暴露前接種。'),
    ].join('\n'),
  });
  page('before-departure', {
    url: `${BASE}/Category/MPage/dD0xcwJor_qG8nlP5UiL4g`, title: '出國前注意事項', crumbs: [...MED, '出國前注意事項'], pub: '2014-09-01', upd: '2026-02-11',
    body: () => [
      H(3, '查詢疫情等級'), P('出發前請至疾管署網站查詢目的地的旅遊疫情建議等級，依等級提高警覺並採取相應防護措施。'),
      H(3, '旅遊醫學門診'), P('建議出國前 4 至 6 週到旅遊醫學門診諮詢，評估是否需要疫苗或預防用藥。'),
      H(3, '準備物品'), LI('個人慢性病藥物與處方（隨身攜帶）'), LI('防蚊液、口罩、乾洗手'), LI('國際預防接種證明書（黃皮書）與護照影本'), LI('旅遊平安險與緊急聯絡資訊'),
    ].join('\n'),
  });
  page('after-return', {
    url: `${BASE}/Category/MPage/${pid('after-return')}`, title: '返國後注意事項', crumbs: [...MED, '返國後注意事項'], pub: '2014-09-01', upd: '2025-12-01',
    body: () => [P('返國後 21 天內如出現發燒或出疹，請儘速就醫，並主動告知醫師旅遊史（國家、地區、停留日期與活動）。'), P('如有疑問可撥打免付費防疫專線 1922（或 0800-001922）諮詢。入境時如被檢測出發燒，請配合機場檢疫人員的篩檢與後續追蹤。'), P('就醫時請戴口罩，避免搭乘大眾運輸工具，減少傳染給他人的機會。')].join('\n'),
  });
  page('yellow-fever-certificate', {
    url: `${BASE}/Category/MPage/${pid('yellow-fever-cert')}`, title: '國際預防接種證明書（黃皮書）申請', crumbs: [...MED, '國際預防接種證明書'], pub: '2018-01-10', upd: '2026-03-03',
    atts: [{ name: 'yellow-fever-certificate-application.pdf', label: '國際預防接種證明書申請書（PDF）', url: `${BASE}/File/Get/${pid('ycert-form')}`, buf: pdfText('International Certificate of Vaccination application (SAMPLE)', ['Simulated export - not the real form.', 'Applicant name, passport number, vaccine, date of vaccination.']) }],
    body: () => [
      H(3, '誰需要'), P('前往要求黃熱病等接種證明的國家，或自黃熱病流行國家入境他國者，須持有國際預防接種證明書（俗稱黃皮書）。'),
      H(3, '如何申請'), LIO(1, '先至旅遊醫學門診預約並接種疫苗。'), LIO(2, '攜帶護照與申請書至原接種單位或當地衛生所。'), LIO(3, '填寫申請書並繳交相片。'), LIO(4, '審核後核發證明書，通常可當場領取。'),
      H(3, '費用'), P('證明書工本費新臺幣 100 元（示意）；疫苗費用另計，依各院所公告。'),
      H(3, '補發'), P('證明書遺失或毀損，請攜帶護照與身分證明文件至原核發單位申請補發。'),
    ].join('\n'),
  });
  page('travel-epidemic-levels', {
    url: `${BASE}/Category/MPage/${pid('levels')}`, title: '國際旅遊疫情建議等級表', crumbs: [...TOP, '國際旅遊疫情建議等級'], pub: '2012-01-01', upd: '2026-10-01',
    body: () => [P('國際旅遊疫情建議等級分為三級：第一級注意（Watch）、第二級警示（Alert）、第三級警告（Warning），依疫情嚴重度與傳播風險隨時調整。'),
      TABLE(['等級', '國家／地區', '疾病', '生效日'], [['第三級：警告', '示意國家甲', '伊波拉病毒感染', '2026-08-01'], ['第三級：警告', '示意國家乙', '霍亂', '2026-09-12'], ['第二級：警示', '巴西', '登革熱', '2026-05-15'], ['第二級：警示', '越南', '登革熱', '2026-06-20'], ['第二級：警示', '肯亞', '黃熱病', '2026-04-01'], ['第二級：警示', '印度', '登革熱', '2026-07-10'], ['第一級：注意', '日本', '麻疹', '2026-05-11'], ['第一級：注意', '泰國', '登革熱', '2026-03-01'], ['第一級：注意', '示意國家丙', '屈公病', '2026-08-18'], ['第一級：注意', '示意國家丁', '猴痘', '2026-09-01']]),
      `<p>資料下載：${A(`${BASE}/CountryEpidLevel/ExportJSON`, 'JSON 格式')}、${A(`${BASE}/CountryEpidLevel/ExportCSV`, 'CSV 格式')}</p>`].join('\n'),
  });
  page('malaria-prophylaxis', {
    url: `${BASE}/Category/MPage/${pid('malaria-rx')}`, title: '瘧疾預防用藥', crumbs: [...MED, '瘧疾預防用藥'], pub: '2019-05-05', upd: '2026-01-20',
    body: () => [H(3, '預防'), P('前往瘧疾流行地區前，請至旅遊醫學門診評估是否需要預防用藥，並同時做好防蚊措施。'), LI('藥物選擇：依目的地的瘧疾抗藥性由醫師處方。'), LI('服藥時程：出發前開始服用，停留期間持續，返國後依處方續服。'), LI('防蚊：穿著長袖衣褲，使用含 DEET 的防蚊液，睡覺時使用蚊帳。')].join('\n'),
  });
  page('travel-video', {
    url: `${BASE}/Category/MPage/${pid('video')}`, title: '出國前 4 到 6 週，先到旅遊醫學門診（宣導影片）', crumbs: [...TOP, '宣導素材'], pub: '2025-03-01', upd: '2025-03-01',
    body: () => [P('出國前 4 到 6 週先到旅遊醫學門診，讓疫苗有時間產生保護力。'), '<iframe src="https://www.youtube.com/embed/SAMPLE000" title="宣導影片"></iframe>', P('文字稿摘要：出國前評估目的地風險，由醫師建議疫苗與預防用藥，返國後如有不適請主動告知旅遊史。')].join('\n'),
  });

  // ── 列表頁（最後建立，連結其他頁）──
  const NEWS = ['2025-01-09-mmr-adults-measles', '2025-02-18-dengue-imported-spring', '2026-05-11-japan-measles-level1', '2026-06-02-measles-travel-mmr-1966', '2026-07-21-dengue-first-local', '2026-08-18-dengue-rising-south'].map((f) => J(`news/${f}.json`));
  const linkList = (cls, arr) => () => `<ul class="${cls}">${arr().map((i) => `<li>${A(i.url, i.title)}</li>`).join('')}</ul>`;
  const content = () => items.filter((i) => !i.isList);
  page('travel-news-list', { isList: true, url: `${BASE}/Bulletin/List/${pid('news-list')}`, title: '國際疫情訊息', crumbs: [...TOP, '國際疫情'], pub: EXPORTED_AT, upd: EXPORTED_AT,
    body: () => `<ul class="news-list">${NEWS.map((n) => `<li><span class="date">${esc(n.publishedAt)}</span> ${A(`${BASE}/Bulletin/Detail/${fakeId(`news:${n.id}`)}?typeid=9`, n.title)}</li>`).join('')}</ul>` });
  page('travel-medicine-list', { isList: true, url: `${BASE}/Category/List/3GJWZ0ETfmdGzIS7H0Jucg`, title: '旅遊醫學', crumbs: [...MED], pub: EXPORTED_AT, upd: EXPORTED_AT,
    body: linkList('doc-list', () => content().filter((i) => i.crumbs.length >= 3 && i.crumbs[2] === '旅遊醫學' && i.crumbs.length <= 4)) });
  page('travel-health-info-list', { isList: true, url: `${BASE}/Category/List/HJ0FrBEq15g18TFKowY7lg`, title: '國際旅遊保健資訊', crumbs: [...TOP, '國際旅遊保健資訊'], pub: EXPORTED_AT, upd: EXPORTED_AT,
    body: linkList('doc-list', () => content().filter((i) => ['travel-epidemic-levels', 'travel-video', 'before-departure', 'after-return'].includes(i.key))) });
  page('travel-list', { isList: true, url: `${BASE}/Category/List/tRbpXpZM7EO3-dkc4RYZuQ`, title: '國際旅遊與健康', crumbs: [...TOP], pub: EXPORTED_AT, upd: EXPORTED_AT,
    body: linkList('doc-list', () => content().filter((i) => !i.key.startsWith('rx-'))) });

  // ── 複製 Q&A 批的國際旅遊常見問答頁 ──
  const copies = [];
  const srcQa = path.join(ROOT, 'data/legacy-export/qa/11-travel-qa');
  if (fs.existsSync(`${srcQa}.html`) && fs.existsSync(`${srcQa}.json`)) copies.push({ key: 'travel-faq', html: `${srcQa}.html`, json: `${srcQa}.json` });

  // ── 寫檔 ──
  const out = path.resolve(outDir);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(path.join(out, 'files'), { recursive: true });
  const all = [...items.map((it) => ({ kind: 'gen', key: it.key, it })), ...copies.map((c) => ({ kind: 'copy', key: c.key, c }))].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  let n = 0;
  const write = (stem, it) => {
    const fileList = it.atts.length ? `<div class="file-list"><h4>相關檔案</h4><ul>${it.atts.map((a) => `<li><a href="${esc(a.url)}">${esc(a.label)}</a> <span class="size">(PDF)</span></li>`).join('')}</ul></div>` : '';
    fs.writeFileSync(path.join(out, `${stem}.html`), shell({ title: it.title, crumbs: it.crumbs, bodyHtml: `${it.body()}\n${fileList}`, updated: it.upd, menuActive: '國際旅遊與健康' }));
    fs.writeFileSync(path.join(out, `${stem}.json`), `${JSON.stringify({ url: it.url, title: it.title, category: it.crumbs.slice(1).join('／'), publishedAt: it.pub, updatedAt: it.upd, breadcrumbs: it.crumbs, attachments: it.atts.map((a) => ({ url: a.url, label: a.label, file: a.name })) }, null, 2)}\n`);
    for (const a of it.atts) fs.writeFileSync(path.join(out, 'files', a.name), a.buf);
  };
  const stems = [];
  for (const a of all) {
    n++;
    const stem = `${String(n).padStart(2, '0')}-${a.key}`;
    stems.push(stem);
    if (a.kind === 'copy') { fs.copyFileSync(a.c.html, path.join(out, `${stem}.html`)); fs.copyFileSync(a.c.json, path.join(out, `${stem}.json`)); } else write(stem, a.it);
  }
  const counts = { pages: n, generated: items.length, copied: copies.length, countries: countries.length, stems };
  fs.writeFileSync(path.join(out, '_export.json'), `${JSON.stringify({
    format: 'cdc-legacy-export/1', simulated: true, exportedAt: EXPORTED_AT, site: BASE, batch: 'travel', pages: n,
    source: `模擬匯出：國際旅遊與健康欄目。依既有新站內容（旅遊醫學門診、黃皮書、疫情建議等級、宣導影片、瘧疾）反推 ${items.length} 頁：列表 4 頁、國際旅遊處方箋查詢頁（含 ${countries.length} 國下拉）1 頁、國家結果頁 6 頁、內容頁 8 頁；另複製 Q&A 批匯出的國際旅遊常見問答頁 ${copies.length} 頁。列表頁、旅遊醫學門診、國際預防接種及藥物、出國前注意事項的網址 ID 為舊站真實 ID，其餘網址 ID、國家結果頁路徑（/TravelEpidemic/Prescription/，推測的模式）、醫院名單、電話與數字皆為示意，不是舊站的真實資料。正式匯出取代整個目錄即可。`,
    generator: 'scripts/lib/legacy-import/sim-export-travel.mjs',
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(out, 'README.md'), readme(counts));
  return { dir: out, ...counts };
}

const readme = (c) => `# 舊站匯出（模擬）：國際旅遊與健康欄目（第九批）

> **這是模擬匯出。** 開發環境連不到 www.cdc.gov.tw，這 ${c.pages} 頁由 \`scripts/lib/legacy-import/sim-export-travel.mjs\` 合成：欄目列表 4 頁、動態查詢頁「國際旅遊處方箋」（<form>＋${c.countries} 國下拉選單）、6 個國家結果頁（同一路徑、僅 \`?iso=\` 不同）、旅遊醫學門診／國際預防接種及藥物／出國前與返國後注意事項／黃皮書申請（含 PDF 附件）／疫情建議等級表／瘧疾預防用藥／宣導影片等內容頁，另**原樣複製**Q&A 批匯出的「國際旅遊常見問答」${c.copied} 頁（\`travel-faq\`）。
>
> 欄目總覽、旅遊醫學、國際旅遊保健資訊、旅遊醫學門診、國際預防接種及藥物、出國前注意事項的網址 ID 是真實的；其餘 ID、醫院名單、電話、等級表數字皆為**示意**。\`/TravelEpidemic/Prescription/\` 是**推測的網址模式**，正式匯出以真實網址為準。**正式匯出取代整個目錄即可**，不需要改程式。

## 重新產生

\`\`\`
node scripts/lib/legacy-import/sim-export-travel.mjs data/legacy-export/travel
\`\`\`

## 轉換

\`\`\`
node scripts/import-legacy.mjs data/legacy-export/travel --out data/legacy-import/travel --apply-migration
\`\`\`

移轉清單：\`content/migration/travel.json\`（欄目範圍，逐頁一筆）。\`travel-faq\` 與 Q&A 批是同一頁（同網址），不列入清單，轉換器會判定為「已在 qa 批轉過」。匯出格式見 \`docs/legacy-import.md\` 第 2 節。
`;

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const r = generateTravel(process.argv[2] ?? path.join(ROOT, 'data/legacy-export/travel'));
  console.log(`模擬匯出 travel：${r.pages} 頁（產生 ${r.generated}、複製 ${r.copied}）→ ${path.relative(ROOT, r.dir)}`);
}
